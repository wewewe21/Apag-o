// Gera a arquitetura estatica a partir do Grid: pisos, paredes finas, tetos, escada e agua.
import * as THREE from 'three';
import { CELL, WALL_T, WALL_H, DOOR_H, BASEMENT_Y } from '../config.js';

const TEX_W = 2.5;   // metros cobertos por uma repeticao de textura na horizontal

export class Batch {
  constructor() { this.b = new Map(); }
  get(key) {
    let a = this.b.get(key);
    if (!a) { a = { p: [], n: [], uv: [] }; this.b.set(key, a); }
    return a;
  }
  // quad com 4 vertices em ordem anti-horaria vista pela normal
  quad(key, v0, v1, v2, v3, n, uv) {
    const a = this.get(key);
    for (const [v, t] of [[v0, uv[0]], [v1, uv[1]], [v2, uv[2]], [v0, uv[0]], [v2, uv[2]], [v3, uv[3]]]) {
      a.p.push(v[0], v[1], v[2]); a.n.push(n[0], n[1], n[2]); a.uv.push(t[0], t[1]);
    }
  }
  meshes(materialFor) {
    const out = [];
    for (const [key, a] of this.b) {
      if (!a.p.length) continue;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(a.p, 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute(a.n, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(a.uv, 2));
      g.computeBoundingSphere();
      const m = new THREE.Mesh(g, materialFor(key));
      m.name = key;
      m.receiveShadow = true;
      m.castShadow = key.startsWith('wall');
      m.matrixAutoUpdate = false;
      out.push(m);
    }
    return out;
  }
}

export function buildArchitecture(grid, T, quality) {
  const L = grid.L;
  const batch = new Batch();
  const half = CELL / 2, t = WALL_T / 2;

  const zoneOfPoint = (px, pz) => {
    const x = grid.cellX(px), y = grid.cellY(pz);
    if (!grid.inb(x, y)) return null;
    if (grid.isFloor(x, y)) return grid.zoneAt(x, y);
    const sx = px - grid.cx(x) >= 0 ? 1 : -1, sy = pz - grid.cz(y) >= 0 ? 1 : -1;
    const q = grid.quadCell(x, y, sx, sy);
    return q ? grid.zoneAt(q[0], q[1]) : null;
  };
  const insideWall = (px, pz) => {
    const x = grid.cellX(px), y = grid.cellY(pz);
    if (!grid.inb(x, y)) return true;
    for (const b of grid.boxes[grid.idx(x, y)]) {
      if (b.door || !b.kind) continue;
      if (px > b.x0 + 1e-4 && px < b.x1 - 1e-4 && pz > b.z0 + 1e-4 && pz < b.z1 - 1e-4) return true;
    }
    return false;
  };
  const stairRun = (px, pz) => {
    for (const s of grid.stairs) {
      if (s.horiz && px >= s.a - 1e-4 && px <= s.b + 1e-4 && pz > (s.y0 - 0.5) * CELL && pz < (s.y1 + 1.5) * CELL) return s;
      if (!s.horiz && pz >= s.a - 1e-4 && pz <= s.b + 1e-4 && px > (s.x0 - 0.5) * CELL && px < (s.x1 + 1.5) * CELL) return s;
    }
    return null;
  };

  // ---------- pisos e tetos ----------
  const floorQuad = (x0, z0, x1, z1, zoneKey, y) => {
    const Z = L.zones[zoneKey];
    const fk = 'floor:' + Z.floor;
    const u0 = x0 / TEX_W, u1 = x1 / TEX_W, v0 = z0 / TEX_W, v1 = z1 / TEX_W;
    batch.quad(fk, [x0, y, z1], [x1, y, z1], [x1, y, z0], [x0, y, z0], [0, 1, 0], [[u0, v1], [u1, v1], [u1, v0], [u0, v0]]);
    if (Z.ceil !== 'sky') {
      const ck = 'ceil:' + Z.ceil, cy = y + WALL_H;
      batch.quad(ck, [x0, cy, z0], [x1, cy, z0], [x1, cy, z1], [x0, cy, z1], [0, -1, 0], [[u0, v0], [u1, v0], [u1, v1], [u0, v1]]);
    }
    if (Z.water) {
      batch.quad('water', [x0, y + 0.2, z1], [x1, y + 0.2, z1], [x1, y + 0.2, z0], [x0, y + 0.2, z0], [0, 1, 0], [[u0, v1], [u1, v1], [u1, v0], [u0, v0]]);
    }
  };

  for (let y = 0; y < grid.H; y++) for (let x = 0; x < grid.W; x++) {
    const c = grid.char(x, y);
    const x0 = x * CELL, z0 = y * CELL;
    if (c === '.') {
      floorQuad(x0, z0, x0 + CELL, z0 + CELL, grid.zoneAt(x, y), grid.levelBase(x, y));
    } else if (c === '=') {
      // coberto pela escada
    } else if (grid.isBoundaryWall(x, y)) {
      for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
        const q = grid.quadCell(x, y, sx, sy);
        if (!q) continue;
        const qx0 = x0 + (sx > 0 ? half : 0), qz0 = z0 + (sy > 0 ? half : 0);
        const mx = qx0 + half / 2, mz = qz0 + half / 2;
        if (stairRun(mx, mz)) continue;
        let lvl;
        if (grid.char(q[0], q[1]) === '=') lvl = grid.floorY(mx, mz);
        else lvl = grid.levelBase(q[0], q[1]);
        const zk = grid.char(q[0], q[1]) === '=' ? grid.zoneAt(x, y) || 'z' : grid.zoneAt(q[0], q[1]);
        floorQuad(qx0, qz0, qx0 + half, qz0 + half, zk, lvl);
      }
    }
  }

  // ---------- escadas ----------
  for (const s of grid.stairs) {
    const steps = Math.max(2, Math.round(Math.abs(s.endY - s.startY) / 0.2));
    const run = (s.b - s.a) / steps;
    // largura: de laje a laje
    const w0 = s.horiz ? (s.y0 - 0.5) * CELL + t : (s.x0 - 0.5) * CELL + t;
    const w1 = s.horiz ? (s.y1 + 1.5) * CELL - t : (s.x1 + 1.5) * CELL - t;
    let prevTop = s.startY;
    for (let i = 0; i < steps; i++) {
      const top = s.startY + (s.endY - s.startY) * (i + 1) / steps + (s.endY < s.startY ? 0.2 * 0 : 0);
      const a0 = s.a + i * run, a1 = a0 + run;
      const yTop = s.endY < s.startY ? s.startY + (s.endY - s.startY) * (i + 0.5) / steps : top;
      if (s.horiz) {
        batch.quad('floor:concrete', [a0, yTop, w1], [a1, yTop, w1], [a1, yTop, w0], [a0, yTop, w0], [0, 1, 0],
          [[a0 / TEX_W, w1 / TEX_W], [a1 / TEX_W, w1 / TEX_W], [a1 / TEX_W, w0 / TEX_W], [a0 / TEX_W, w0 / TEX_W]]);
        // espelho do degrau (face vertical voltada para quem desce)
        const yA = Math.max(prevTop, yTop), yB = Math.min(prevTop, yTop);
        const n = s.endY < s.startY ? [1, 0, 0] : [-1, 0, 0];
        if (n[0] > 0) batch.quad('wall:concrete', [a0, yB, w1], [a0, yB, w0], [a0, yA, w0], [a0, yA, w1], n, [[0, 0], [1, 0], [1, 0.07], [0, 0.07]]);
        else batch.quad('wall:concrete', [a0, yB, w0], [a0, yB, w1], [a0, yA, w1], [a0, yA, w0], n, [[0, 0], [1, 0], [1, 0.07], [0, 0.07]]);
      } else {
        batch.quad('floor:concrete', [w0, yTop, a1], [w1, yTop, a1], [w1, yTop, a0], [w0, yTop, a0], [0, 1, 0],
          [[w0 / TEX_W, a1 / TEX_W], [w1 / TEX_W, a1 / TEX_W], [w1 / TEX_W, a0 / TEX_W], [w0 / TEX_W, a0 / TEX_W]]);
      }
      prevTop = yTop;
    }
    // teto inclinado
    const cA = s.startY + WALL_H, cB = s.endY + WALL_H;
    if (s.horiz) {
      batch.quad('ceil:concrete', [s.a, cA, w0], [s.b, cB, w0], [s.b, cB, w1], [s.a, cA, w1], [0, -1, 0],
        [[0, 0], [2, 0], [2, 1], [0, 1]]);
    }
  }

  // ---------- paredes ----------
  const segSplit = (a, b) => {
    // quebra em pedacos alinhados a meia celula
    const pts = [a];
    const step = half;
    let k = Math.floor(a / step + 1e-6) + 1;
    while (k * step < b - 1e-6) { pts.push(k * step); k++; }
    pts.push(b);
    return pts;
  };

  const wallRange = (zoneKey, px, pz) => {
    const Z = L.zones[zoneKey];
    if (Z.stairs) return [BASEMENT_Y - 0.05, WALL_H + 0.05];
    const x = grid.cellX(px), y = grid.cellY(pz);
    const s = stairRun(px, pz);
    if (s) return [BASEMENT_Y - 0.05, WALL_H + 0.05];
    const base = Z.level < 0 ? BASEMENT_Y : 0;
    if (Z.outside) return [base - 0.05, base + (grid.char(x, y) === '#' && zoneKey === 'o' ? 3.4 : 3.4)];
    return [base - 0.05, base + WALL_H + 0.05];
  };

  const emitFace = (kind, ax, az, bx, bz, nx, nz, box) => {
    // face vertical de (ax,az) a (bx,bz); normal (nx,nz)
    const horiz = Math.abs(nz) > 0.5;
    const from = horiz ? Math.min(ax, bx) : Math.min(az, bz);
    const to = horiz ? Math.max(ax, bx) : Math.max(az, bz);
    const pts = segSplit(from, to);
    for (let i = 0; i < pts.length - 1; i++) {
      const s0 = pts[i], s1 = pts[i + 1];
      if (s1 - s0 < 1e-4) continue;
      const mid = (s0 + s1) / 2;
      const px = horiz ? mid : ax + nx * 0.04, pz = horiz ? az + nz * 0.04 : mid;
      if (insideWall(px, pz)) continue;
      const zk = zoneOfPoint(px, pz);
      if (!zk) continue;
      const Z = L.zones[zk];
      const [y0, y1] = wallRange(zk, px, pz);
      const base = Z.level < 0 ? BASEMENT_Y : 0;
      let mat = kind === 'drawers' ? 'mat:steelwall' : 'wall:' + Z.wall;
      if (Z.outside) mat = 'wall:facade';
      const v0 = (y0 - base) / WALL_H, v1 = (y1 - base) / WALL_H;
      let q0, q1;
      if (horiz) {
        q0 = [s0, 0, az]; q1 = [s1, 0, az];
        if (nz < 0) [q0, q1] = [q1, q0];
      } else {
        q0 = [ax, 0, s0]; q1 = [ax, 0, s1];
        if (nx > 0) [q0, q1] = [q1, q0];
      }
      const u0 = (horiz ? q0[0] : q0[2]) / TEX_W, u1 = (horiz ? q1[0] : q1[2]) / TEX_W;
      batch.quad(mat, [q0[0], y0, q0[2]], [q1[0], y0, q1[2]], [q1[0], y1, q1[2]], [q0[0], y1, q0[2]], [nx, 0, nz],
        [[u0, v0], [u1, v0], [u1, v1], [u0, v1]]);
      if (Z.outside) {
        // tampa superior do muro
        const tt = WALL_T;
        batch.quad('wall:facade', [q0[0], y1, q0[2]], [q1[0], y1, q1[2]], [q1[0] - nx * tt, y1, q1[2] - nz * tt], [q0[0] - nx * tt, y1, q0[2] - nz * tt], [0, 1, 0],
          [[0, 0], [1, 0], [1, 0.05], [0, 0.05]]);
      }
    }
  };

  for (const b of grid.wallBoxes) {
    emitFace(b.kind, b.x0, b.z0, b.x1, b.z0, 0, -1, b);   // norte
    emitFace(b.kind, b.x0, b.z1, b.x1, b.z1, 0, 1, b);    // sul
    emitFace(b.kind, b.x0, b.z0, b.x0, b.z1, -1, 0, b);   // oeste
    emitFace(b.kind, b.x1, b.z0, b.x1, b.z1, 1, 0, b);    // leste
  }

  // vergas acima das portas
  for (let y = 0; y < grid.H; y++) for (let x = 0; x < grid.W; x++) {
    const c = grid.char(x, y);
    if (!'DKJX'.includes(c)) continue;
    const ax = grid.doorAxis(x, y);
    const zk = grid.zoneAt(x, y);
    let base = grid.levelBase(x, y);
    const top = c === 'X' ? 2.7 : DOOR_H;
    const x0 = x * CELL, x1 = x0 + CELL, z0 = y * CELL, z1 = z0 + CELL;
    const cx = grid.cx(x), cz = grid.cz(y);
    const sides = ax === 'h' ? [[0, -1], [0, 1]] : [[-1, 0], [1, 0]];
    for (const [nx, nz] of sides) {
      const px = cx + nx * (t + 0.1), pz = cz + nz * (t + 0.1);
      const zz = zoneOfPoint(px, pz) || zk;
      const Z = L.zones[zz];
      const mat = Z.outside ? 'wall:facade' : 'wall:' + Z.wall;
      const lb = Z.level < 0 ? BASEMENT_Y : base;
      const y0 = lb + top, y1 = lb + WALL_H + 0.05;
      const v0 = top / WALL_H, v1 = 1;
      if (ax === 'h') {
        const zf = cz + nz * t;
        const a = nz < 0 ? [x1, zf] : [x0, zf], bb = nz < 0 ? [x0, zf] : [x1, zf];
        batch.quad(mat, [a[0], y0, a[1]], [bb[0], y0, bb[1]], [bb[0], y1, bb[1]], [a[0], y1, a[1]], [0, 0, nz], [[0, v0], [CELL / TEX_W, v0], [CELL / TEX_W, v1], [0, v1]]);
      } else {
        const xf = cx + nx * t;
        const a = nx > 0 ? [xf, z1] : [xf, z0], bb = nx > 0 ? [xf, z0] : [xf, z1];
        batch.quad(mat, [a[0], y0, a[1]], [bb[0], y0, bb[1]], [bb[0], y1, bb[1]], [a[0], y1, a[1]], [nx, 0, 0], [[0, v0], [CELL / TEX_W, v0], [CELL / TEX_W, v1], [0, v1]]);
      }
    }
    // face de baixo da verga
    const Zd = L.zones[zk] || L.zones.h;
    const yb = (Zd.level < 0 ? BASEMENT_Y : base) + top;
    if (ax === 'h') batch.quad('wall:' + Zd.wall, [x0, yb, cz - t], [x1, yb, cz - t], [x1, yb, cz + t], [x0, yb, cz + t], [0, -1, 0], [[0, 0], [0.5, 0], [0.5, 0.05], [0, 0.05]]);
    else batch.quad('wall:' + Zd.wall, [cx - t, yb, z0], [cx - t, yb, z1], [cx + t, yb, z1], [cx + t, yb, z0], [0, -1, 0], [[0, 0], [0.5, 0], [0.5, 0.05], [0, 0.05]]);
  }

  // ---------- materiais ----------
  const mats = new Map();
  const std = (tex, opts = {}) => new THREE.MeshStandardMaterial({
    map: tex.map, normalMap: tex.normalMap, roughness: opts.rough ?? 0.85, metalness: opts.metal ?? 0,
    normalScale: new THREE.Vector2(opts.ns ?? 1, opts.ns ?? 1), color: opts.color ?? 0xffffff,
  });
  const materialFor = (key) => {
    if (mats.has(key)) return mats.get(key);
    const [kind, name] = key.split(':');
    let m;
    if (kind === 'wall') m = std(T.wall[name] || T.wall.concrete, { rough: name === 'morgue' ? 0.45 : 0.88, ns: 1.2 });
    else if (kind === 'floor') m = std(T.floor[name] || T.floor.concrete, { rough: name === 'morgue' ? 0.4 : name === 'checker' || name === 'lino' ? 0.55 : 0.8 });
    else if (kind === 'ceil') m = std(T.ceil[name] || T.ceil.concrete, { rough: 0.95, color: 0xb8b8b0 });
    else if (key === 'mat:steelwall') { m = std(T.mat.steel, { rough: 0.4, metal: 0.6 }); m.map.repeat.set(1, 1); }
    else if (key === 'water') {
      m = new THREE.MeshStandardMaterial({ color: 0x0d120e, roughness: 0.06, metalness: 0.1, transparent: true, opacity: 0.88,
        normalMap: T.floor.concrete.normalMap, normalScale: new THREE.Vector2(0.25, 0.25) });
      m.userData.water = true;
    } else m = new THREE.MeshStandardMaterial({ color: 0x777777 });
    mats.set(key, m);
    return m;
  };

  const meshes = batch.meshes(materialFor);
  return { meshes, materials: mats };
}
