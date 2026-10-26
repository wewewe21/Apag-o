"""Gera GLB SINTETICOS que imitam a saida do Tripo, so para TESTAR o pipeline e a integracao sem gastar credito.
Nunca vao para o jogo (ficam em tools/test/fixtures). Propositalmente "dificeis": escala arbitraria, origem fora do centro, frente em -Z
(o jogo espera +Z), textura 2048x2048 grande demais e uma 'ponta' que mostra para onde a frente aponta.

    python -I tools/test/fixtures/make_synthetic_models.py            # escreve tools/test/fixtures/raw/<id>/model.glb
"""
import io
import struct
import sys
from pathlib import Path

import numpy as np
from PIL import Image

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parents[1] / "tripo"))
from glb import write_glb  # noqa: E402

FACES = [  # normal, 4 cantos (CCW visto de fora)
    ((0, 0, 1), [(-1, -1, 1), (1, -1, 1), (1, 1, 1), (-1, 1, 1)]),
    ((0, 0, -1), [(1, -1, -1), (-1, -1, -1), (-1, 1, -1), (1, 1, -1)]),
    ((1, 0, 0), [(1, -1, 1), (1, -1, -1), (1, 1, -1), (1, 1, 1)]),
    ((-1, 0, 0), [(-1, -1, -1), (-1, -1, 1), (-1, 1, 1), (-1, 1, -1)]),
    ((0, 1, 0), [(-1, 1, 1), (1, 1, 1), (1, 1, -1), (-1, 1, -1)]),
    ((0, -1, 0), [(-1, -1, -1), (1, -1, -1), (1, -1, 1), (-1, -1, 1)]),
]


def box(center, size, band):
    """24 vertices, 36 indices; a UV cai na faixa horizontal 'band' (0..1) da textura (cada peca com uma cor)."""
    pos, nor, uv, idx = [], [], [], []
    for n, corners in FACES:
        base = len(pos)
        for k, c in enumerate(corners):
            pos.append([center[i] + c[i] * size[i] / 2 for i in range(3)])
            nor.append(list(n))
            uv.append([(k in (1, 2)) * 0.9 + 0.05, band[0] + (band[1] - band[0]) * (0.1 + 0.8 * (k in (2, 3)))])
        idx += [base, base + 1, base + 2, base, base + 2, base + 3]
    return pos, nor, uv, idx


def texture(size=2048):
    """Faixas sujas (ferrugem, cinza, verde-azulado, lona) com ruido leve; JPEG grande de proposito."""
    rng = np.random.default_rng(7)
    colors = [(120, 80, 55), (150, 152, 148), (95, 120, 110), (170, 165, 150), (60, 62, 64), (140, 110, 90)]
    img = np.zeros((size, size, 3), np.float32)
    h = size // len(colors)
    for i, c in enumerate(colors):
        img[i * h:(i + 1) * h] = c
    noise = rng.normal(0, 9, (size // 8, size // 8, 1)).repeat(8, 0).repeat(8, 1)
    img = np.clip(img + noise + rng.normal(0, 4, img.shape), 0, 255).astype(np.uint8)
    buf = io.BytesIO()
    Image.fromarray(img).save(buf, "JPEG", quality=90)
    return buf.getvalue()


def build_glb(parts, scale, offset, jpeg):
    pos, nor, uv, idx = [], [], [], []
    for p in parts:
        base = len(pos)
        a, b, c, d = box(*p)
        pos += a; nor += b; uv += c; idx += [i + base for i in d]
    P = np.array(pos, np.float32); N = np.array(nor, np.float32); U = np.array(uv, np.float32); I = np.array(idx, np.uint16)
    # origem fora do centro, como nos modelos gerados
    P += np.array(offset, np.float32)
    chunks, views = [], []

    def add(data, target=None):
        pad = -sum(len(c) for c in chunks) % 4
        if pad:
            chunks.append(b"\x00" * pad)
        off = sum(len(c) for c in chunks)
        chunks.append(data)
        v = {"buffer": 0, "byteOffset": off, "byteLength": len(data)}
        if target:
            v["target"] = target
        views.append(v)
        return len(views) - 1

    bv_p, bv_n, bv_u, bv_i, bv_img = add(P.tobytes(), 34962), add(N.tobytes(), 34962), add(U.tobytes(), 34962), add(I.tobytes(), 34963), add(jpeg)
    total = sum(len(c) for c in chunks)
    gltf = {
        "asset": {"version": "2.0", "generator": "synthetic-fixture"},
        "scene": 0, "scenes": [{"nodes": [0]}],
        "nodes": [{"mesh": 0, "name": "synthetic", "scale": [scale] * 3}],
        "meshes": [{"primitives": [{"attributes": {"POSITION": 0, "NORMAL": 1, "TEXCOORD_0": 2}, "indices": 3, "material": 0}]}],
        "materials": [{"pbrMetallicRoughness": {"baseColorTexture": {"index": 0}, "metallicFactor": 1.0, "roughnessFactor": 1.0}}],
        "textures": [{"source": 0}], "images": [{"bufferView": bv_img, "mimeType": "image/jpeg"}],
        "accessors": [
            {"bufferView": bv_p, "componentType": 5126, "count": len(P), "type": "VEC3", "min": P.min(0).tolist(), "max": P.max(0).tolist()},
            {"bufferView": bv_n, "componentType": 5126, "count": len(N), "type": "VEC3"},
            {"bufferView": bv_u, "componentType": 5126, "count": len(U), "type": "VEC2"},
            {"bufferView": bv_i, "componentType": 5123, "count": len(I), "type": "SCALAR"},
        ],
        "bufferViews": views, "buffers": [{"byteLength": total}],
    }
    return write_glb(gltf, b"".join(chunks))


def band(i):
    return (i / 6, (i + 1) / 6)


def wheelchair():
    # unidades "do modelo": ~3.2x o tamanho real; frente (apoios de pe e ponta) em -Z; origem deslocada
    parts = [
        ((0, 0.52, 0.00), (0.50, 0.06, 0.52), band(4)),     # assento
        ((0, 0.95, 0.27), (0.50, 0.80, 0.05), band(4)),     # encosto (atras = +Z)
        ((-0.33, 0.30, 0.15), (0.05, 0.60, 0.60), band(1)),  # roda esquerda
        ((0.33, 0.30, 0.15), (0.05, 0.60, 0.60), band(1)),   # roda direita
        ((-0.25, 0.30, -0.45), (0.05, 0.50, 0.05), band(1)),  # haste da frente
        ((0.25, 0.30, -0.45), (0.05, 0.50, 0.05), band(1)),
        ((0.0, 0.10, -0.60), (0.40, 0.04, 0.22), band(0)),  # apoio de pe, frente (-Z): ferrugem
        ((0.0, 0.58, -0.30), (0.10, 0.06, 0.55), band(5)),  # braco central so para dar assimetria
    ]
    return build_glb(parts, 3.2, (0.55, 0.12, -0.35), texture())


def bed():
    parts = [
        ((0, 0.55, 0), (0.90, 0.16, 2.0), band(3)),        # colchao
        ((0, 0.40, 0), (0.92, 0.05, 2.04), band(1)),       # estrado
        ((0, 0.85, -1.0), (0.92, 0.9, 0.05), band(0)),     # cabeceira alta (-Z)
        ((0, 0.70, 1.0), (0.92, 0.6, 0.05), band(0)),      # pe baixo (+Z)
        ((-0.46, 0.25, -1.0), (0.05, 0.5, 0.05), band(1)),
        ((0.46, 0.25, -1.0), (0.05, 0.5, 0.05), band(1)),
        ((-0.46, 0.25, 1.0), (0.05, 0.5, 0.05), band(1)),
        ((0.46, 0.25, 1.0), (0.05, 0.5, 0.05), band(1)),
    ]
    return build_glb(parts, 1.7, (-0.4, 0.3, 0.9), texture())


def gurney():
    parts = [
        ((0, 0.80, 0), (0.62, 0.06, 1.90), band(1)),        # tampo
        ((0, 0.86, 0), (0.50, 0.05, 1.70), band(3)),        # colchonete
        ((-0.26, 0.40, -0.80), (0.04, 0.80, 0.04), band(1)), ((0.26, 0.40, -0.80), (0.04, 0.80, 0.04), band(1)),
        ((-0.26, 0.40, 0.80), (0.04, 0.80, 0.04), band(1)), ((0.26, 0.40, 0.80), (0.04, 0.80, 0.04), band(1)),
        ((0, 0.30, 0), (0.50, 0.03, 1.50), band(4)),        # prateleira de baixo
        ((0, 0.95, -0.95), (0.66, 0.10, 0.05), band(0)),    # cabeceira (-Z)
    ]
    return build_glb(parts, 2.4, (-0.3, 0.0, 0.5), texture())


def body():
    # corpo coberto: pes em +Z (como o corpo procedural do jogo)
    parts = [
        ((0, 0.10, -0.75), (0.22, 0.20, 0.30), band(3)),    # cabeca
        ((0, 0.12, -0.25), (0.46, 0.24, 0.65), band(3)),    # torso
        ((0, 0.09, 0.45), (0.34, 0.18, 0.80), band(3)),     # pernas
        ((-0.08, 0.07, 0.92), (0.09, 0.12, 0.12), band(5)), ((0.08, 0.07, 0.92), (0.09, 0.12, 0.12), band(5)),  # pes
    ]
    return build_glb(parts, 1.3, (0.2, 0.05, -0.1), texture())


MODELS = (("wheelchair", wheelchair), ("hospital_bed", bed), ("gurney", gurney), ("covered_body", body))


def publish():
    """processa os sinteticos com o MESMO process.py usado nos reais e ajusta o que so um olho humano define (aqui: a frente)."""
    import json, os, subprocess
    env = dict(os.environ, TRIPO_RAW_DIR=str(HERE / "raw"), TRIPO_OUT_DIR=str(HERE / "models"))
    subprocess.run([sys.executable, "-I", str(HERE.parents[1] / "tripo" / "process.py"), *[n for n, _ in MODELS]], env=env, check=True)
    mf = HERE / "models" / "manifest.json"
    lib = json.loads(mf.read_text(encoding="utf-8"))
    lib["models"]["wheelchair"]["spec"]["yaw"] = 180      # o sintetico nasce olhando para -Z
    lib["generated"] = "fixture"
    mf.write_text(json.dumps(lib, indent=2) + chr(10), encoding="utf-8")


if __name__ == "__main__":
    for name, fn in MODELS:
        d = HERE / "raw" / name
        d.mkdir(parents=True, exist_ok=True)
        data = fn()
        (d / "model.glb").write_bytes(data)
        print(f"{name}: {len(data) / 1048576:.2f} MB")
    publish()
