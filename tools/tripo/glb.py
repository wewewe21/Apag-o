"""Leitor/escritor minimo de GLB (glTF 2.0 binario), so com a biblioteca padrao.

Os GLB vindos do Tripo sao DADO NAO CONFIAVEL: aqui eles so sao lidos como bytes e JSON (nada e executado) e validados de forma
estrita antes de qualquer outro uso. Rode os scripts que leem esses arquivos com `python -I` (modo isolado).
"""
import json
import struct

MAGIC = 0x46546C67          # "glTF"
CHUNK_JSON = 0x4E4F534A     # "JSON"
CHUNK_BIN = 0x004E4942      # "BIN\0"
MAX_JSON = 16 * 1024 * 1024


class GlbError(ValueError):
    pass


def read_glb(data: bytes):
    """Devolve (gltf: dict, bin: bytes). Levanta GlbError se o arquivo nao for um GLB 2.0 bem formado."""
    if len(data) < 28:
        raise GlbError("arquivo pequeno demais para ser um GLB")
    magic, version, length = struct.unpack_from("<III", data, 0)
    if magic != MAGIC:
        raise GlbError("cabecalho nao e 'glTF'")
    if version != 2:
        raise GlbError(f"versao glTF {version} nao suportada (esperado 2)")
    if length != len(data):
        raise GlbError(f"tamanho declarado ({length}) difere do arquivo ({len(data)})")
    pos, gltf, binary = 12, None, b""
    while pos < length:
        if pos + 8 > length:
            raise GlbError("chunk truncado")
        clen, ctype = struct.unpack_from("<II", data, pos)
        pos += 8
        if clen % 4 or pos + clen > length:
            raise GlbError("chunk com tamanho invalido")
        chunk = data[pos:pos + clen]
        pos += clen
        if ctype == CHUNK_JSON and gltf is None:
            if clen > MAX_JSON:
                raise GlbError("JSON grande demais")
            try:
                gltf = json.loads(chunk.decode("utf-8").rstrip("\x00 "))
            except (UnicodeDecodeError, json.JSONDecodeError) as e:
                raise GlbError(f"JSON invalido: {e}") from None
        elif ctype == CHUNK_BIN and not binary:
            binary = bytes(chunk)
    if gltf is None:
        raise GlbError("sem chunk JSON")
    return gltf, binary


def write_glb(gltf: dict, binary: bytes) -> bytes:
    js = json.dumps(gltf, separators=(",", ":")).encode("utf-8")
    js += b" " * (-len(js) % 4)
    out = struct.pack("<II", len(js), CHUNK_JSON) + js
    if binary:
        pad = b"\x00" * (-len(binary) % 4)
        out += struct.pack("<II", len(binary) + len(pad), CHUNK_BIN) + binary + pad
    return struct.pack("<III", MAGIC, 2, 12 + len(out)) + out
