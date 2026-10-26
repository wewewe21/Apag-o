"""Valida, otimiza e publica os modelos baixados do Tripo.

    python -I tools/tripo/process.py                  # todos os que estao em tools/tripo/raw/
    python -I tools/tripo/process.py hospital_bed     # so um
    python -I tools/tripo/process.py --check-only     # so valida e relata (nao escreve nada)
    python -I tools/tripo/process.py --max-texture 1024

Entrada : tools/tripo/raw/<id>/model.glb   (quarentena: dado nao confiavel, so lido como bytes/JSON)
Saida   : assets/models/<id>.glb  +  assets/models/manifest.json
O que faz: valida o GLB de forma estrita (formato, extensoes, referencias, limites), reduz e recomprime as texturas (menos MB para o
navegador baixar e menos memoria de video), mede triangulos/caixa/texturas e grava a especificacao do jogo (tamanho alvo, tipos que
substitui, material) junto. A normalizacao de escala/origem/frente acontece no carregamento (src/world/models.js).
"""
import io
import json
import os
import struct
import sys
import time
from pathlib import Path

from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent))
from glb import GlbError, read_glb, write_glb  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
# TRIPO_RAW_DIR / TRIPO_OUT_DIR existem so para os testes (nao tocam nas pastas reais)
RAW = Path(os.environ.get("TRIPO_RAW_DIR") or ROOT / "tools" / "tripo" / "raw")
OUT = Path(os.environ.get("TRIPO_OUT_DIR") or ROOT / "assets" / "models")
ASSETS = json.loads((ROOT / "tools" / "tripo" / "assets.json").read_text(encoding="utf-8"))
Image.MAX_IMAGE_PIXELS = 64 * 1024 * 1024

# extensoes que o GLTFLoader do jogo entende sem decodificadores extras
OK_EXT = {"KHR_materials_unlit", "KHR_materials_emissive_strength", "KHR_materials_specular", "KHR_materials_ior",
          "KHR_materials_clearcoat", "KHR_materials_sheen", "KHR_texture_transform", "KHR_materials_pbrSpecularGlossiness",
          "KHR_materials_transmission", "KHR_materials_volume", "KHR_mesh_quantization", "KHR_materials_iridescence"}
BAD_REQUIRED = {"KHR_draco_mesh_compression", "EXT_meshopt_compression", "KHR_texture_basisu", "EXT_texture_webp"}
MAX_TRIS_FACTOR = 1.6


def accessor_count(gltf, idx):
    return gltf["accessors"][idx]["count"]


def validate(gltf, binary):
    """Levanta GlbError se algo for inseguro ou o jogo nao conseguir carregar."""
    if gltf.get("asset", {}).get("version") != "2.0":
        raise GlbError("asset.version diferente de 2.0")
    required = set(gltf.get("extensionsRequired", []))
    bad = required & BAD_REQUIRED
    if bad:
        raise GlbError(f"extensao obrigatoria sem decodificador no jogo: {sorted(bad)}")
    for b in gltf.get("buffers", []):
        if "uri" in b:
            raise GlbError("buffer com URI externa/embutida: so GLB com chunk binario e aceito")
    if len(gltf.get("buffers", [])) > 1:
        raise GlbError("mais de um buffer")
    for im in gltf.get("images", []):
        if "uri" in im:
            raise GlbError("imagem com URI: so imagens embutidas no binario sao aceitas")
        if "bufferView" not in im:
            raise GlbError("imagem sem bufferView")
    for i, bv in enumerate(gltf.get("bufferViews", [])):
        off, ln = bv.get("byteOffset", 0), bv["byteLength"]
        if off < 0 or ln < 0 or off + ln > len(binary):
            raise GlbError(f"bufferView {i} fora do chunk binario")
    if not gltf.get("meshes"):
        raise GlbError("sem malhas")


def stats(gltf):
    tris = verts = 0
    mn = [float("inf")] * 3
    mx = [float("-inf")] * 3
    for mesh in gltf.get("meshes", []):
        for prim in mesh.get("primitives", []):
            mode = prim.get("mode", 4)
            pos = prim.get("attributes", {}).get("POSITION")
            if pos is None:
                continue
            a = gltf["accessors"][pos]
            verts += a["count"]
            if "min" in a and "max" in a:
                for k in range(3):
                    mn[k], mx[k] = min(mn[k], a["min"][k]), max(mx[k], a["max"][k])
            n = accessor_count(gltf, prim["indices"]) if "indices" in prim else a["count"]
            if mode == 4:
                tris += n // 3
            elif mode in (5, 6):
                tris += max(0, n - 2)
    return tris, verts, (mn, mx)


def image_roles(gltf):
    """indice da imagem -> {'base','normal','other'} (qual textura e a de cor)."""
    role = {}
    tex_img = {i: t.get("source") for i, t in enumerate(gltf.get("textures", []))}
    for m in gltf.get("materials", []):
        pbr = m.get("pbrMetallicRoughness", {})
        for key, r in (("baseColorTexture", "base"), ("metallicRoughnessTexture", "other")):
            t = pbr.get(key)
            if t and tex_img.get(t["index"]) is not None:
                role.setdefault(tex_img[t["index"]], r)
        for key in ("normalTexture", "occlusionTexture", "emissiveTexture"):
            t = m.get(key)
            if t and tex_img.get(t["index"]) is not None:
                role.setdefault(tex_img[t["index"]], "normal" if key == "normalTexture" else "other")
    return role


def optimize_images(gltf, binary, max_tex):
    """Reduz e recomprime as texturas; devolve (novo_bin, relatorio). Reconstroi o chunk binario compactado e alinhado."""
    views = gltf.get("bufferViews", [])
    new_data = {}
    report = []
    roles = image_roles(gltf)
    for i, im in enumerate(gltf.get("images", [])):
        bv = views[im["bufferView"]]
        raw = binary[bv.get("byteOffset", 0):bv.get("byteOffset", 0) + bv["byteLength"]]
        try:
            img = Image.open(io.BytesIO(raw))
            img.load()
        except Exception as e:  # imagem corrompida / formato desconhecido
            raise GlbError(f"imagem {i} ilegivel: {e}") from None
        w0, h0 = img.size
        scale = min(1.0, max_tex / max(w0, h0))
        if scale < 1.0:
            img = img.resize((max(1, round(w0 * scale)), max(1, round(h0 * scale))), Image.LANCZOS)
        role = roles.get(i, "base")
        has_alpha = img.mode in ("RGBA", "LA") or (img.mode == "P" and "transparency" in img.info)
        buf = io.BytesIO()
        if role == "base" and not has_alpha:
            img.convert("RGB").save(buf, "JPEG", quality=84, optimize=True, progressive=False)
            mime = "image/jpeg"
        else:
            img.save(buf, "PNG", optimize=True)
            mime = "image/png"
        out = buf.getvalue()
        if len(out) >= len(raw) and scale >= 1.0 and im.get("mimeType") == mime:
            out = raw                      # nao piorar
        new_data[im["bufferView"]] = out
        im["mimeType"] = mime
        report.append({"index": i, "role": role, "from": [w0, h0], "to": list(img.size), "bytes_in": len(raw), "bytes_out": len(out), "mime": mime})
    chunks, offset = [], 0
    for i, bv in enumerate(views):
        data = new_data.get(i, binary[bv.get("byteOffset", 0):bv.get("byteOffset", 0) + bv["byteLength"]])
        pad = -offset % 4
        if pad:
            chunks.append(b"\x00" * pad)
            offset += pad
        bv["byteOffset"], bv["byteLength"] = offset, len(data)
        chunks.append(data)
        offset += len(data)
    out_bin = b"".join(chunks)
    gltf["buffers"][0]["byteLength"] = len(out_bin)
    return out_bin, report


def process(asset, max_tex, check_only):
    src = RAW / asset["id"] / "model.glb"
    if not src.exists():
        return None
    data = src.read_bytes()
    gltf, binary = read_glb(data)
    validate(gltf, binary)
    tris, verts, (mn, mx) = stats(gltf)
    limit = asset.get("face_limit", ASSETS["defaults"]["face_limit"])
    info = {"id": asset["id"], "tris": tris, "verts": verts, "bounds": [mn, mx], "bytes_in": len(data)}
    if tris > limit * MAX_TRIS_FACTOR:
        info["warn"] = f"{tris} triangulos acima do esperado ({limit})"
    ext = max(b - a for a, b in zip(mn, mx)) if all(abs(v) < 1e30 for v in mn + mx) else 0
    if ext <= 0 or ext > 1e5:
        raise GlbError(f"caixa do modelo insana (extensao {ext})")
    if check_only:
        info["textures"] = [{"index": i} for i, _ in enumerate(gltf.get("images", []))]
        return info
    out_bin, tex = optimize_images(gltf, binary, max_tex)
    OUT.mkdir(parents=True, exist_ok=True)
    glb = write_glb(gltf, out_bin)
    (OUT / f"{asset['id']}.glb").write_bytes(glb)
    info.update({"textures": tex, "bytes_out": len(glb)})
    return info


def main(argv):
    max_tex = int(ASSETS["defaults"].get("maxTexture", 1024))
    check = "--check-only" in argv
    if "--max-texture" in argv:
        max_tex = int(argv[argv.index("--max-texture") + 1])
    ids = [a for a in argv if not a.startswith("--") and not a.isdigit()]
    todo = [a for a in sorted(ASSETS["assets"], key=lambda a: a["priority"]) if not ids or a["id"] in ids]
    lib_path = OUT / "manifest.json"
    lib = {"version": 1, "models": {}}
    if lib_path.exists() and not check:
        lib = json.loads(lib_path.read_text(encoding="utf-8"))
    done = 0
    for asset in todo:
        try:
            info = process(asset, max_tex, check)
        except GlbError as e:
            print(f"! {asset['id']}: REJEITADO - {e}")
            continue
        if info is None:
            print(f"- {asset['id']}: sem arquivo em tools/tripo/raw/{asset['id']}/model.glb")
            continue
        done += 1
        mb = lambda n: f"{n / 1048576:.2f} MB"
        line = f"+ {asset['id']}: {info['tris']} tri, {info['verts']} vert, {mb(info['bytes_in'])}"
        if not check:
            line += f" -> {mb(info['bytes_out'])}; texturas " + ", ".join(f"{t['from'][0]}x{t['from'][1]}->{t['to'][0]}x{t['to'][1]}" for t in info["textures"])
        print(line + (f"  AVISO: {info['warn']}" if "warn" in info else ""))
        if not check:
            spec = {k: asset[k] for k in ("size", "replaces", "material", "keepOverlay", "overlayY", "grow", "yaw", "fit", "front") if k in asset}
            lib["models"][asset["id"]] = {
                "file": f"{asset['id']}.glb", "bytes": info["bytes_out"], "tris": info["tris"], "verts": info["verts"],
                "bounds": info["bounds"], "textures": [[t["to"][0], t["to"][1]] for t in info["textures"]], "spec": spec,
            }
    if not check and done:
        lib["generated"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        lib_path.write_text(json.dumps(lib, indent=2) + "\n", encoding="utf-8")
        print(f"manifesto atualizado: {lib_path} ({len(lib['models'])} modelos)")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
