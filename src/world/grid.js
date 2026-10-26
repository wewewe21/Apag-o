// Logica espacial do mapa (sem three.js, testavel no node):
// paredes finas, colisao, linha de visao, pathfinding (A*), propagacao de som.
import { CELL, WALL_T, WALL_H, BASEMENT_Y, CREATURE } from '../config.js';

const WALLISH = new Set(['#', 'M', 'D', 'K', 'J', 'X']);
export const DOORISH = new Set(['D', 'K', 'J', 'X']);
const DIRS4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];

export class Grid {
  constructor(L) {
    this.L = L;
    this.W = L.W; this.H = L.H;
    const n = this.W * this.H;
    this.navBlock = new Uint8Array(n);      // moveis que bloqueiam a celula para a IA
    this.boxes = Array.from({ length: n }, () => []);
    this.doors = new Map();                  // idx -> porta
    this.light = new Float32Array(n);        // 0..1 luz ambiente (lampadas de teto)
    this.boundary = new Uint8Array(n);
    this._stamp = 1;
    this._computeBoundary();
    this._findStairs();
    this._buildWallBoxes();
  }

  // ---------- consultas basicas ----------
  idx(x, y) { return y * this.W + x; }
  inb(x, y) { return x >= 0 && y >= 0 && x < this.W && y < this.H; }
  char(x, y) { return this.inb(x, y) ? this.L.grid[y][x] : '#'; }
  isFloor(x, y) { const c = this.char(x, y); return c === '.' || c === '='; }
  isDoor(x, y) { return DOORISH.has(this.char(x, y)); }
  isWallish(x, y) { return WALLISH.has(this.char(x, y)); }
  zoneAt(x, y) { return this.inb(x, y) ? this.L.zone[y][x] : null; }
  zoneCfg(x, y) { const z = this.zoneAt(x, y); return z ? this.L.zones[z] : null; }
  cellX(wx) { return Math.floor(wx / CELL); }
  cellY(wz) { return Math.floor(wz / CELL); }
  cx(x) { return (x + 0.5) * CELL; }
  cz(y) { return (y + 0.5) * CELL; }

  levelBase(x, y) {
    const z = this.L.zones[this.zoneAt(x, y)];
    return z && z.level < 0 ? BASEMENT_Y : 0;
  }

  _computeBoundary() {
    for (let y = 0; y < this.H; y++) for (let x = 0; x < this.W; x++) {
      if (!this.isWallish(x, y)) continue;
      if (this.isDoor(x, y)) { this.boundary[this.idx(x, y)] = 1; continue; }
      let b = 0;
      for (let dy = -1; dy <= 1 && !b; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (this.isFloor(x + dx, y + dy)) { b = 1; break; }
      }
      this.boundary[this.idx(x, y)] = b;
    }
  }

  isBoundaryWall(x, y) { return this.inb(x, y) && this.boundary[this.idx(x, y)] === 1; }

  // ha "braco" de parede ligando (x,y) ao vizinho?
  arm(x, y, dx, dy) {
    return this.isBoundaryWall(x, y) && this.isBoundaryWall(x + dx, y + dy);
  }

  // orientacao de uma porta: 'h' = parede corre em x (porta atravessada no eixo z)
  doorAxis(x, y) {
    if (this.isWallish(x - 1, y) && this.isWallish(x + 1, y)) return 'h';
    if (this.isWallish(x, y - 1) && this.isWallish(x, y + 1)) return 'v';
    return this.isFloor(x, y - 1) || this.isFloor(x, y + 1) ? 'h' : 'v';
  }

  // A qual celula de piso pertence o quadrante (sx,sy) de uma celula de parede?
  quadCell(x, y, sx, sy) {
    const c = this.char(x, y);
    if (!WALLISH.has(c)) return [x, y];
    if (DOORISH.has(c)) {
      const ax = this.doorAxis(x, y);
      const nx = ax === 'h' ? x : x + sx, ny = ax === 'h' ? y + sy : y;
      return this.isFloor(nx, ny) ? [nx, ny] : null;
    }
    const opts = [];
    if (!this.arm(x, y, sx, 0)) opts.push([x + sx, y]);
    if (!this.arm(x, y, 0, sy)) opts.push([x, y + sy]);
    opts.push([x + sx, y + sy]);
    for (const [a, b] of opts) if (this.isFloor(a, b)) return [a, b];
    return null;
  }

  // ---------- escadas ----------
  _findStairs() {
    this.stairs = [];
    const seen = new Set();
    for (let y = 0; y < this.H; y++) for (let x = 0; x < this.W; x++) {
      if (this.char(x, y) !== '=' || seen.has(this.idx(x, y))) continue;
      // corrida horizontal ou vertical
      let x1 = x, y1 = y;
      const horiz = this.char(x + 1, y) === '=';
      if (horiz) while (this.char(x1 + 1, y) === '=') x1++;
      else while (this.char(x, y1 + 1) === '=') y1++;
      for (let yy = y; yy <= y1; yy++) for (let xx = x; xx <= x1; xx++) seen.add(this.idx(xx, yy));
      const lvl = (cx, cy) => (this.zoneCfg(cx, cy)?.level ?? 0) < 0 ? BASEMENT_Y : 0;
      const startY = horiz ? lvl(x - 1, y) : lvl(x, y - 1);
      const endY = horiz ? lvl(x1 + 1, y) : lvl(x, y1 + 1);
      this.stairs.push({ x0: x, y0: y, x1, y1, horiz, startY, endY,
        a: horiz ? x * CELL : y * CELL, b: horiz ? (x1 + 1) * CELL : (y1 + 1) * CELL });
    }
  }

  stairAt(x, y) {
    for (const s of this.stairs) {
      if (s.horiz) { if (y >= s.y0 - 1 && y <= s.y1 + 1 && x >= s.x0 && x <= s.x1) return s; }
      else if (x >= s.x0 - 1 && x <= s.x1 + 1 && y >= s.y0 && y <= s.y1) return s;
    }
    return null;
  }

  // altura do piso num ponto do mundo
  floorY(wx, wz) {
    const x = this.cellX(wx), y = this.cellY(wz);
    for (const s of this.stairs) {
      const inRun = s.horiz
        ? (x >= s.x0 && x <= s.x1 && y >= s.y0 - 1 && y <= s.y1 + 1)
        : (y >= s.y0 && y <= s.y1 && x >= s.x0 - 1 && x <= s.x1 + 1);
      if (inRun) {
        // rampa continua para a fisica; os degraus sao so visuais
        const t = ((s.horiz ? wx : wz) - s.a) / (s.b - s.a);
        const tt = Math.min(1, Math.max(0, t));
        return s.startY + (s.endY - s.startY) * tt;
      }
    }
    let c = [x, y];
    if (this.isWallish(x, y)) {
      const sx = wx - this.cx(x) >= 0 ? 1 : -1;
      const sy = wz - this.cz(y) >= 0 ? 1 : -1;
      c = this.quadCell(x, y, sx, sy) || [x, y];
    }
    return this.levelBase(c[0], c[1]);
  }

  // ---------- caixas de colisao ----------
  addBox(b) {
    // b: {x0,x1,z0,z1, vision:bool, door?:obj, tag?}
    const cx0 = Math.max(0, this.cellX(b.x0)), cx1 = Math.min(this.W - 1, this.cellX(b.x1 - 1e-6));
    const cy0 = Math.max(0, this.cellY(b.z0)), cy1 = Math.min(this.H - 1, this.cellY(b.z1 - 1e-6));
    for (let y = cy0; y <= cy1; y++) for (let x = cx0; x <= cx1; x++) this.boxes[this.idx(x, y)].push(b);
    if (this._bb) this._bb.fill(0);          // o cache de "cabe a criatura?" ficou velho
    return b;
  }

  _buildWallBoxes() {
    const t = WALL_T / 2;
    this.wallBoxes = [];
    for (let y = 0; y < this.H; y++) for (let x = 0; x < this.W; x++) {
      if (!this.isBoundaryWall(x, y)) continue;
      const c = this.char(x, y);
      const cx = this.cx(x), cz = this.cz(y);
      const x0 = x * CELL, x1 = (x + 1) * CELL, z0 = y * CELL, z1 = (y + 1) * CELL;
      if (DOORISH.has(c)) {
        // batentes nas bordas da celula da porta (a folha e adicionada pela propria porta)
        const ax = this.doorAxis(x, y);
        const jam = 0.09;
        const pair = c === 'X' ? this._exitJambs(x, y) : [true, true];
        if (ax === 'h') {
          if (pair[0]) this._wallBox(x0, x0 + jam, cz - t, cz + t, x, y, 'jamb');
          if (pair[1]) this._wallBox(x1 - jam, x1, cz - t, cz + t, x, y, 'jamb');
        } else {
          if (pair[0]) this._wallBox(cx - t, cx + t, z0, z0 + jam, x, y, 'jamb');
          if (pair[1]) this._wallBox(cx - t, cx + t, z1 - jam, z1, x, y, 'jamb');
        }
        continue;
      }
      const aE = this.arm(x, y, 1, 0), aW = this.arm(x, y, -1, 0);
      const aS = this.arm(x, y, 0, 1), aN = this.arm(x, y, 0, -1);
      // caixa horizontal e vertical (centro incluso em ambas quando necessario)
      if (aE || aW || (!aN && !aS)) this._wallBox(aW ? x0 : cx - t, aE ? x1 : cx + t, cz - t, cz + t, x, y, 'wall');
      if (aN || aS) this._wallBox(cx - t, cx + t, aN ? z0 : cz - t, aS ? z1 : cz + t, x, y, 'wall');
      if (c === 'M') {
        // banco de gavetas: bloco que avanca ate a borda da celula voltada para a sala
        for (const [dx, dy] of DIRS4) {
          if (!this.isFloor(x + dx, y + dy)) continue;
          if (dy === 1) this._wallBox(x0, x1, cz, z1, x, y, 'drawers', { face: 's' });
          if (dy === -1) this._wallBox(x0, x1, z0, cz, x, y, 'drawers', { face: 'n' });
          if (dx === 1) this._wallBox(cx, x1, z0, z1, x, y, 'drawers', { face: 'e' });
          if (dx === -1) this._wallBox(x0, cx, z0, z1, x, y, 'drawers', { face: 'w' });
        }
      }
    }
  }

  // porta principal dupla ocupa duas celulas: sem batente entre elas
  _exitJambs(x, y) {
    const leftIsX = this.char(x - 1, y) === 'X', rightIsX = this.char(x + 1, y) === 'X';
    return [!leftIsX, !rightIsX];
  }

  _wallBox(x0, x1, z0, z1, gx, gy, kind, extra = {}) {
    const b = { x0, x1, z0, z1, vision: true, kind, gx, gy, ...extra };
    this.wallBoxes.push(b);
    return this.addBox(b);
  }

  boxActive(b) {
    if (b.door) return b.door.blocking();
    if (b.disabled) return false;
    return true;
  }

  // empurra um circulo para fora das caixas; retorna [x,z]
  collideCircle(px, pz, r, opts = {}) {
    for (let iter = 0; iter < 3; iter++) {
      const stamp = ++this._stamp;
      const cx0 = this.cellX(px - r - 0.01), cx1 = this.cellX(px + r + 0.01);
      const cy0 = this.cellY(pz - r - 0.01), cy1 = this.cellY(pz + r + 0.01);
      let moved = false;
      for (let y = cy0; y <= cy1; y++) for (let x = cx0; x <= cx1; x++) {
        if (!this.inb(x, y)) continue;
        for (const b of this.boxes[this.idx(x, y)]) {
          if (b._s === stamp) continue; b._s = stamp;
          if (!this.boxActive(b) || (opts.ignore && opts.ignore(b))) continue;
          const qx = Math.max(b.x0, Math.min(px, b.x1));
          const qz = Math.max(b.z0, Math.min(pz, b.z1));
          let dx = px - qx, dz = pz - qz;
          const d2 = dx * dx + dz * dz;
          if (d2 >= r * r) continue;
          if (d2 > 1e-8) {
            const d = Math.sqrt(d2);
            px = qx + dx / d * r; pz = qz + dz / d * r;
          } else {
            // centro dentro da caixa: sai pelo lado mais proximo
            const l = px - b.x0, rr = b.x1 - px, u = pz - b.z0, dd = b.z1 - pz;
            const m = Math.min(l, rr, u, dd);
            if (m === l) px = b.x0 - r; else if (m === rr) px = b.x1 + r;
            else if (m === u) pz = b.z0 - r; else pz = b.z1 + r;
          }
          moved = true;
        }
      }
      if (!moved) break;
    }
    return [px, pz];
  }

  // segmento 2D livre de paredes/moveis altos? (linha de visao)
  segmentClear(ax, az, bx, bz, visionOnly = true, ignore = null) {
    const stamp = ++this._stamp;
    const dx = bx - ax, dz = bz - az;
    let x = this.cellX(ax), y = this.cellY(az);
    const tx = this.cellX(bx), ty = this.cellY(bz);
    const stepX = dx > 0 ? 1 : -1, stepY = dz > 0 ? 1 : -1;
    const tDeltaX = dx !== 0 ? Math.abs(CELL / dx) : Infinity;
    const tDeltaY = dz !== 0 ? Math.abs(CELL / dz) : Infinity;
    let tMaxX = dx !== 0 ? ((stepX > 0 ? (x + 1) * CELL - ax : ax - x * CELL) / Math.abs(dx)) : Infinity;
    let tMaxY = dz !== 0 ? ((stepY > 0 ? (y + 1) * CELL - az : az - y * CELL) / Math.abs(dz)) : Infinity;
    for (let guard = 0; guard < 400; guard++) {
      if (!this.inb(x, y)) return false;
      for (const b of this.boxes[this.idx(x, y)]) {
        if (b._s === stamp) continue; b._s = stamp;
        if (visionOnly && !b.vision) continue;
        if (!this.boxActive(b) || (ignore && ignore(b))) continue;
        if (segBox(ax, az, dx, dz, b)) return false;
      }
      if (x === tx && y === ty) return true;
      if (tMaxX < tMaxY) { if (tMaxX > 1) return true; tMaxX += tDeltaX; x += stepX; }
      else { if (tMaxY > 1) return true; tMaxY += tDeltaY; y += stepY; }
    }
    return true;
  }

  // ---------- navegacao da criatura ----------
  navWalkable(x, y, agent = 'creature') {
    if (!this.inb(x, y)) return false;
    const c = this.char(x, y);
    if (c === '.' || c === '=') return !this.navBlock[this.idx(x, y)] && !(agent === 'creature' && this.bodyBlocked(x, y));
    if (DOORISH.has(c)) {
      const d = this.doors.get(this.idx(x, y));
      if (!d) return false;
      return agent === 'creature' ? d.creaturePassable() : !d.blocking();
    }
    return false;
  }

  // o corpo da criatura (circulo) cabe no CENTRO desta celula sem encostar em parede/movel fixo? (portas nao contam: tem logica propria)
  bodyBlocked(x, y) {
    const i = this.idx(x, y);
    const c = this._bb || (this._bb = new Uint8Array(this.W * this.H));
    if (c[i]) return c[i] === 2;
    const px = this.cx(x), pz = this.cz(y);
    const [qx, qz] = this.collideCircle(px, pz, CREATURE.bodyRadius - 0.04, { ignore: (b) => !!b.door });
    c[i] = Math.hypot(qx - px, qz - pz) > 0.06 ? 2 : 1;
    return c[i] === 2;
  }

  // ponto (px,pz) livre para o corpo da criatura?
  bodyFreeAt(px, pz, r = CREATURE.bodyRadius - 0.04) {
    const [qx, qz] = this.collideCircle(px, pz, r, { ignore: (b) => !!b.door });
    return Math.hypot(qx - px, qz - pz) <= 0.04;
  }

  // custo extra de uma celula (a criatura evita luz)
  navCost(x, y, avoidLight) {
    let c = 1;
    if (avoidLight) c += this.light[this.idx(x, y)] * avoidLight;
    if (this.isDoor(x, y)) c += 0.5;
    return c;
  }

  findPath(sx, sy, tx, ty, opts = {}) {
    const W = this.W, n = W * this.H;
    if (!this.inb(sx, sy) || !this.inb(tx, ty)) return null;
    const avoid = opts.avoidLight ?? 0;
    const maxNodes = opts.maxNodes ?? 4000;
    const g = this._g || (this._g = new Float32Array(n));
    const from = this._from || (this._from = new Int32Array(n));
    const seen = this._seen || (this._seen = new Uint32Array(n));
    const closed = this._closed || (this._closed = new Uint32Array(n));
    const run = this._run = (this._run || 0) + 1;
    const start = this.idx(sx, sy), goal = this.idx(tx, ty);
    const heap = new MinHeap();
    const h = (i) => { const x = i % W, y = (i / W) | 0; const ddx = Math.abs(x - tx), ddy = Math.abs(y - ty); return (ddx + ddy) + (Math.SQRT2 - 2) * Math.min(ddx, ddy); };
    g[start] = 0; seen[start] = run; from[start] = -1;
    heap.push(start, h(start));
    let expanded = 0;
    let best = start, bestH = h(start);
    while (heap.size) {
      const cur = heap.pop();
      if (closed[cur] === run) continue;
      closed[cur] = run;
      if (cur === goal) break;
      if (++expanded > maxNodes) break;
      const cx = cur % W, cy = (cur / W) | 0;
      const hc = h(cur); if (hc < bestH) { bestH = hc; best = cur; }
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const nx = cx + dx, ny = cy + dy;
        if (!this.navWalkable(nx, ny, opts.agent)) continue;
        if (dx && dy) {
          if (!this.navWalkable(cx + dx, cy, opts.agent) || !this.navWalkable(cx, cy + dy, opts.agent)) continue;
          if (this.isDoor(nx, ny) || this.isDoor(cx, cy)) continue;
        }
        const ni = ny * W + nx;
        if (closed[ni] === run) continue;
        if (opts.maxLight !== undefined && this.light[ni] > opts.maxLight && this.light[cur] <= opts.maxLight) continue;
        const step = (dx && dy ? Math.SQRT2 : 1) * this.navCost(nx, ny, avoid);
        const ng = g[cur] + step;
        if (seen[ni] !== run || ng < g[ni]) {
          seen[ni] = run; g[ni] = ng; from[ni] = cur;
          heap.push(ni, ng + h(ni));
        }
      }
    }
    let end = closed[goal] === run ? goal : (opts.partial ? best : -1);
    if (end < 0) return null;
    const path = [];
    for (let i = end; i !== -1; i = from[i]) { path.push(i); if (path.length > n) break; }
    path.reverse();
    return path.map(i => [i % W, (i / W) | 0]);
  }

  // transforma caminho de celulas em pontos do mundo, cortando cantos quando da
  smoothPath(cells, agent = 'creature') {
    if (!cells || !cells.length) return [];
    const pts = cells.map(([x, y]) => [this.cx(x), this.cz(y)]);
    const out = [pts[0]];
    let anchor = 0;
    for (let i = 2; i < pts.length; i++) {
      if (!this.corridorClear(pts[anchor], pts[i], 0.3, agent)) {
        out.push(pts[i - 1]); anchor = i - 1;
      }
    }
    if (pts.length > 1) out.push(pts[pts.length - 1]);
    return out;
  }

  corridorClear(a, b, half, agent) {
    const dx = b[0] - a[0], dz = b[1] - a[1];
    const len = Math.hypot(dx, dz);
    if (len < 1e-4) return true;
    const nx = -dz / len * half, nz = dx / len * half;
    const steps = Math.ceil(len / 0.35);
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      for (const o of [-1, 0, 1]) {
        const px = a[0] + dx * t + nx * o, pz = a[1] + dz * t + nz * o;
        if (!this.navWalkable(this.cellX(px), this.cellY(pz), agent)) return false;
        if (o === 0 && agent === 'creature' && !this.isDoor(this.cellX(px), this.cellY(pz)) && !this.bodyFreeAt(px, pz)) return false;      // o atalho nao pode passar por dentro de movel
      }
    }
    return true;
  }

  // distancia percorrida pelo som (Dijkstra limitado); portas fechadas abafam
  soundDistance(ax, az, bx, bz, maxDist) {
    const W = this.W;
    const s = this.idx(this.cellX(ax), this.cellY(az));
    const t = this.idx(this.cellX(bx), this.cellY(bz));
    if (s === t) return Math.hypot(ax - bx, az - bz);
    const dist = this._sd || (this._sd = new Float32Array(W * this.H));
    const seen = this._ss || (this._ss = new Uint32Array(W * this.H));
    const run = this._srun = (this._srun || 0) + 1;
    const heap = new MinHeap();
    dist[s] = 0; seen[s] = run; heap.push(s, 0);
    const maxCells = maxDist / CELL;
    while (heap.size) {
      const cur = heap.pop();
      const d = dist[cur];
      if (cur === t) return d * CELL;
      if (d > maxCells) break;
      const cx = cur % W, cy = (cur / W) | 0;
      for (const [dx, dy] of DIRS4) {
        const nx = cx + dx, ny = cy + dy;
        if (!this.inb(nx, ny)) continue;
        const c = this.char(nx, ny);
        let cost = 1;
        if (c === '.' || c === '=') cost = 1;
        else if (DOORISH.has(c)) { const door = this.doors.get(this.idx(nx, ny)); cost = door && door.blocking() ? 3.5 : 1; }
        else continue;
        const ni = ny * W + nx;
        const nd = d + cost;
        if (seen[ni] !== run || nd < dist[ni]) { seen[ni] = run; dist[ni] = nd; heap.push(ni, nd); }
      }
    }
    return Infinity;
  }

  randomCellNear(x, y, rMin, rMax, rng, filter) {
    for (let i = 0; i < 40; i++) {
      const a = rng() * Math.PI * 2, r = rMin + rng() * (rMax - rMin);
      const cx = Math.round(x + Math.cos(a) * r / CELL), cy = Math.round(y + Math.sin(a) * r / CELL);
      if (this.navWalkable(cx, cy) && this.isFloor(cx, cy) && (!filter || filter(cx, cy))) return [cx, cy];
    }
    return null;
  }

  // celulas conectadas a partir de (sx,sy) (checagem de conectividade)
  reachable(sx, sy, agent = 'player-all') {
    const W = this.W, out = new Uint8Array(W * this.H);
    const q = [[sx, sy]]; out[this.idx(sx, sy)] = 1;
    while (q.length) {
      const [x, y] = q.pop();
      for (const [dx, dy] of DIRS4) {
        const nx = x + dx, ny = y + dy;
        if (!this.inb(nx, ny) || out[this.idx(nx, ny)]) continue;
        const c = this.char(nx, ny);
        const ok = (c === '.' || c === '=' || DOORISH.has(c)) && !this.navBlock[this.idx(nx, ny)];
        if (!ok) continue;
        out[this.idx(nx, ny)] = 1; q.push([nx, ny]);
      }
    }
    return out;
  }
}

function segBox(ax, az, dx, dz, b) {
  let t0 = 0, t1 = 1;
  if (Math.abs(dx) < 1e-9) { if (ax < b.x0 || ax > b.x1) return false; }
  else {
    let ta = (b.x0 - ax) / dx, tb = (b.x1 - ax) / dx;
    if (ta > tb) [ta, tb] = [tb, ta];
    t0 = Math.max(t0, ta); t1 = Math.min(t1, tb);
    if (t0 > t1) return false;
  }
  if (Math.abs(dz) < 1e-9) { if (az < b.z0 || az > b.z1) return false; }
  else {
    let ta = (b.z0 - az) / dz, tb = (b.z1 - az) / dz;
    if (ta > tb) [ta, tb] = [tb, ta];
    t0 = Math.max(t0, ta); t1 = Math.min(t1, tb);
    if (t0 > t1) return false;
  }
  return true;
}

export class MinHeap {
  constructor() { this.k = []; this.p = []; }
  get size() { return this.k.length; }
  push(key, pri) {
    const k = this.k, p = this.p;
    let i = k.length; k.push(key); p.push(pri);
    while (i > 0) {
      const par = (i - 1) >> 1;
      if (p[par] <= pri) break;
      k[i] = k[par]; p[i] = p[par]; i = par;
    }
    k[i] = key; p[i] = pri;
  }
  pop() {
    const k = this.k, p = this.p;
    const top = k[0];
    const lk = k.pop(), lp = p.pop();
    if (k.length) {
      let i = 0; const n = k.length;
      while (true) {
        let l = 2 * i + 1, r = l + 1, m = i;
        let mp = lp;
        if (l < n && p[l] < mp) { m = l; mp = p[l]; }
        if (r < n && p[r] < mp) { m = r; mp = p[r]; }
        if (m === i) break;
        k[i] = k[m]; p[i] = p[m]; i = m;
      }
      k[i] = lk; p[i] = lp;
    }
    return top;
  }
}

export { WALL_H };
