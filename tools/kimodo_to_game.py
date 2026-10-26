#!/usr/bin/env python3
"""Empacota os movimentos gerados pelo kimodo.cpp em um JSON compacto para o jogo.

Para cada clipe:
  * alinha a direcao (locomocao anda para +Z; clipes parados comecam olhando +Z)
  * clipes de locomocao: acha o melhor trecho de loop (menor diferenca de pose),
    remove o deslocamento linear (anda "no lugar") e mede a velocidade media
  * clipes pontuais (ataque, recuo...): mantem o deslocamento da raiz (root motion)
  * quantiza quaternions em int16 e posicoes da raiz em milimetros (int16), base64

Uso:
  python tools/kimodo_to_game.py            -> assets/anim/creature.json (clipes escolhidos)
  python tools/kimodo_to_game.py --all      -> tools/preview/all_clips.json (todas as seeds, p/ comparar)
"""
import argparse
import base64
import json
import math
import struct
from pathlib import Path

HERE = Path(__file__).resolve().parent
RAW = HERE / "kimodo_raw"

NAMES = ["Hips", "Spine1", "Spine2", "Chest", "Neck1", "Neck2", "Head", "Jaw",
         "LeftEye", "RightEye", "LeftShoulder", "LeftArm", "LeftForeArm", "LeftHand",
         "LeftHandThumbEnd", "LeftHandMiddleEnd", "RightShoulder", "RightArm", "RightForeArm",
         "RightHand", "RightHandThumbEnd", "RightHandMiddleEnd", "LeftLeg", "LeftShin", "LeftFoot",
         "LeftToeBase", "RightLeg", "RightShin", "RightFoot", "RightToeBase"]
PARENTS = [-1, 0, 1, 2, 3, 4, 5, 6, 6, 6, 3, 10, 11, 12, 13, 13, 3, 16, 17, 18, 19, 19, 0, 22, 23, 24, 0, 26, 27, 28]
OFFSETS = [
    [0.0, 0.988, 0.0], [-0.00013727, 0.0500376256, -0.00053726669], [-1.86574103e-09, 0.0712530139, -0.000298248546],
    [-5.75188398e-09, 0.0755006305, -0.00815970992], [-0.00181676517, 0.263112953, -0.00553348292],
    [-2.85102231e-08, 0.0770939664, 0.0230258546], [-4.5975437e-08, 0.0612891595, 0.0195370861],
    [2.63687901e-05, 0.0047559225, 0.0309494062], [0.0320638079, 0.0538020513, 0.0758688308],
    [-0.0322244017, 0.05361869, 0.0755823359], [0.0162165175, 0.232371641, 0.0511341324],
    [0.149198457, 2.19397873e-08, -0.0550232576], [0.287393078, 2.50268389e-09, -2.58787737e-05],
    [0.270939812, -7.06625108e-09, 2.60897248e-05], [0.122686267, -0.0322017573, 0.0483306876],
    [0.190119595, -0.00312878387, -0.000339570373], [-0.0138011824, 0.231803086, 0.0521415786],
    [-0.150371962, 1.17387901e-07, -0.0554560437], [-0.287366393, 1.87628082e-08, -2.59709359e-05],
    [-0.271336198, -1.16767401e-09, 2.61269368e-05], [-0.122642483, -0.0321145448, 0.0480403904],
    [-0.190005945, -0.00306615542, -0.0003157343], [0.10043214, -0.0843452671, 0.0259565473],
    [-1e-08, -0.432217537, -0.00802912805], [1e-08, -0.421550959, -0.0348152298],
    [0.0, -0.0505947206, 0.132315294], [-0.10047278, -0.0829525995, 0.0262031695],
    [1e-08, -0.433622059, -0.00805555828], [2e-08, -0.421173943, -0.0347839785],
    [-3.42907669e-09, -0.0507960932, 0.132841956],
]
J = len(NAMES)
FPS = 30.0

# como cada clipe e usado no jogo
CLIP_KIND = {
    "walk": "loop", "limp": "loop", "stalk": "loop", "run": "loop", "crawl": "loop", "creep": "loop", "prowl": "loop",
    "look": "idle", "idle": "idle", "inspect": "oneshot", "attack": "oneshot",
    "recoil": "oneshot", "roar": "oneshot", "pain": "oneshot",
}
# clipes usados so como camada curta: guarda apenas os primeiros N quadros (30 fps)
TRIM = {"pain": 24}
# seed escolhida para o jogo (ajustada depois de comparar no preview)
CHOICE = {
    "walk": 7, "limp": 1, "stalk": 3, "run": 5, "crawl": 1, "look": 4, "idle": 1,
    "inspect": 1, "attack": 3, "recoil": 8, "roar": 1, "pain": 2,
    "creep": 12,          # marcha lenta de patrulha (passos normais; a "limp" arrasta a perna)
}


# ---------------- quaternions (x,y,z,w) ----------------
def qmul(a, b):
    ax, ay, az, aw = a
    bx, by, bz, bw = b
    return (aw * bx + ax * bw + ay * bz - az * by,
            aw * by - ax * bz + ay * bw + az * bx,
            aw * bz + ax * by - ay * bx + az * bw,
            aw * bw - ax * bx - ay * by - az * bz)


def qrot(q, v):
    x, y, z, w = q
    vx, vy, vz = v
    # v' = q v q*
    tx = 2 * (y * vz - z * vy)
    ty = 2 * (z * vx - x * vz)
    tz = 2 * (x * vy - y * vx)
    return (vx + w * tx + (y * tz - z * ty),
            vy + w * ty + (z * tx - x * tz),
            vz + w * tz + (x * ty - y * tx))


def qyaw(theta):
    return (0.0, math.sin(theta / 2), 0.0, math.cos(theta / 2))


def qdot(a, b):
    return sum(x * y for x, y in zip(a, b))


def qnorm(q):
    n = math.sqrt(qdot(q, q)) or 1.0
    return tuple(c / n for c in q)


def slerp(a, b, t):
    d = qdot(a, b)
    if d < 0:
        b = tuple(-c for c in b)
        d = -d
    if d > 0.9995:
        return qnorm(tuple(x + (y - x) * t for x, y in zip(a, b)))
    th = math.acos(max(-1.0, min(1.0, d)))
    s = math.sin(th)
    wa = math.sin((1 - t) * th) / s
    wb = math.sin(t * th) / s
    return tuple(wa * x + wb * y for x, y in zip(a, b))


# ---------------- carga ----------------
def load(dirpath: Path):
    rb = (dirpath / "local_rotations_xyzw.f32").read_bytes()
    pb = (dirpath / "root_positions.f32").read_bytes()
    F = len(pb) // 12
    root = [struct.unpack_from("<3f", pb, i * 12) for i in range(F)]
    rot = []
    for f in range(F):
        rot.append([struct.unpack_from("<4f", rb, (f * J + j) * 16) for j in range(J)])
    return root, rot


def yaw_of_forward(q):
    fx, _, fz = qrot(q, (0.0, 0.0, 1.0))
    return math.atan2(fx, fz)


def align(root, rot, theta):
    """gira tudo em -theta em torno de Y e zera a origem XZ."""
    qy = qyaw(-theta)
    x0, _, z0 = root[0]
    out_root, out_rot = [], []
    for (x, y, z), frame in zip(root, rot):
        rx, _, rz = qrot(qy, (x - x0, 0.0, z - z0))
        out_root.append((rx, y, rz))
        f2 = list(frame)
        f2[0] = qnorm(qmul(qy, frame[0]))
        out_rot.append(f2)
    return out_root, out_rot


def make_continuous(rot):
    for f in range(1, len(rot)):
        for j in range(J):
            if qdot(rot[f][j], rot[f - 1][j]) < 0:
                rot[f][j] = tuple(-c for c in rot[f][j])


def pose_dist(fa, fb):
    # ignora a rotacao global da raiz em yaw (so a pose importa)
    d = 0.0
    for j in range(1, J):
        d += 1.0 - abs(qdot(fa[j], fb[j]))
    return d


def best_loop(root, rot, min_len, max_len, skip=8):
    F = len(rot)
    best = None
    for i in range(skip, F - min_len):
        for L in range(min_len, min(max_len, F - i - 1) + 1):
            j = i + L
            d = pose_dist(rot[i], rot[j])
            # velocidade tambem deve bater
            dv = pose_dist(rot[i + 1], rot[j + 1]) if j + 1 < F else d
            dy = abs(root[i][1] - root[j][1]) * 4
            score = d + 0.5 * dv + dy
            if best is None or score < best[0]:
                best = (score, i, j)
    return best


def process(name, dirpath: Path):
    kind = CLIP_KIND[name]
    root, rot = load(dirpath)
    F = len(root)
    disp = (root[-1][0] - root[0][0], root[-1][2] - root[0][2])
    dist = math.hypot(*disp)
    if kind == "loop" and dist > 0.3:
        theta = math.atan2(disp[0], disp[1])
    else:
        theta = yaw_of_forward(rot[0][0])
    root, rot = align(root, rot, theta)
    make_continuous(rot)
    info = {"name": name, "src": dirpath.name, "srcFrames": F}

    if kind == "loop":
        lo, hi = (20, 70) if name != "crawl" else (30, 100)
        score, i, j = best_loop(root, rot, lo, hi)
        seg_root = root[i:j]
        seg_rot = [list(fr) for fr in rot[i:j]]
        n = len(seg_rot)
        # velocidade media (para sincronizar passos com o movimento no jogo)
        dz = root[j][2] - root[i][2]
        dx = root[j][0] - root[i][0]
        speed = math.hypot(dx, dz) / (n / FPS)
        # remove a deriva linear => anda no lugar
        out_root = []
        for k, (x, y, z) in enumerate(seg_root):
            t = k / n
            out_root.append((x - (root[i][0] + dx * t), y, z - (root[i][2] + dz * t)))
        # suaviza a emenda do loop (ultimos 6 quadros tendem ao primeiro)
        blend = min(6, n // 4)
        for k in range(blend):
            f = n - blend + k
            t = (k + 1) / (blend + 1)
            for jj in range(J):
                seg_rot[f][jj] = slerp(seg_rot[f][jj], seg_rot[0][jj], t)
            x, y, z = out_root[f]
            x0, y0, z0 = out_root[0]
            out_root[f] = (x + (x0 - x) * t, y + (y0 - y) * t, z + (z0 - z) * t)
        make_continuous(seg_rot)
        info.update(loop=True, rootMotion=False, speed=round(speed, 3), loopScore=round(score, 4),
                    range=[i, j])
        rot, root = seg_rot, out_root
    elif kind == "idle":
        info.update(loop=True, rootMotion=False, speed=0.0)
        x0, _, z0 = root[0]
        root = [(0.0, y, 0.0) for (x, y, z) in root]
        # cross-fade do fim para o comeco
        blend = 10
        n = len(rot)
        for k in range(blend):
            f = n - blend + k
            t = (k + 1) / (blend + 1)
            for jj in range(J):
                rot[f][jj] = slerp(rot[f][jj], rot[0][jj], t)
            root[f] = (0.0, root[f][1] + (root[0][1] - root[f][1]) * t, 0.0)
        make_continuous(rot)
    else:
        info.update(loop=False, rootMotion=True, speed=0.0,
                    travel=[round(root[-1][0], 3), round(root[-1][2], 3)])

    if name in TRIM:
        rot, root = rot[:TRIM[name]], root[:TRIM[name]]
        info["travel"] = [round(root[-1][0], 3), round(root[-1][2], 3)]
    info["frames"] = len(rot)
    info["rot"] = b64_int16([c for fr in rot for q in fr for c in q], 32767)
    info["root"] = b64_int16([c for p in root for c in p], 1000)
    return info


def b64_int16(values, scale):
    ints = [max(-32767, min(32767, int(round(v * scale)))) for v in values]
    return base64.b64encode(struct.pack(f"<{len(ints)}h", *ints)).decode("ascii")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--all", action="store_true", help="exporta todas as seeds para comparar no preview")
    args = ap.parse_args()

    clips = {}
    for d in sorted(RAW.iterdir()):
        if not (d / "local_rotations_xyzw.f32").exists():
            continue
        name, _, seed = d.name.rpartition("_s")
        if name not in CLIP_KIND:
            continue
        if not args.all and CHOICE.get(name) != int(seed):
            continue
        info = process(name, d)
        key = d.name if args.all else name
        clips[key] = info
        extra = f"loop {info.get('range')} score {info.get('loopScore')}" if info.get("loop") and "range" in info else ""
        print(f"{key:12s} frames {info['frames']:4d}  speed {info['speed']:.2f} m/s  "
              f"{'travel ' + str(info.get('travel')) if info.get('travel') else ''} {extra}")

    out = {
        "source": "kimodo.cpp (NVIDIA Kimodo SOMA RP v1.1), texto -> movimento",
        "fps": FPS,
        "skeleton": {"names": NAMES, "parents": PARENTS, "offsets": OFFSETS},
        "clips": clips,
    }
    if args.all:
        path = HERE / "preview" / "all_clips.json"
    else:
        path = HERE.parent / "assets" / "anim" / "creature.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(out, separators=(",", ":")), encoding="utf-8")
    print(f"-> {path} ({path.stat().st_size // 1024} KB)")


if __name__ == "__main__":
    main()

