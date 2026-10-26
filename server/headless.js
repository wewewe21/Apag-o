// Mundo sem grafico para o servidor: grid + colisao dos moveis + portas + esconderijos + dutos + lampadas,
// reconstruidos a partir de worldspec.json (gerado por scripts/gen-worldspec.mjs a partir do mesmo World do cliente).
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { buildLayout } from '../src/world/layout.js';
import { Grid, DOORISH } from '../src/world/grid.js';
import { DoorCore } from '../src/world/doorcore.js';
import { computeLightMap, lightAt } from '../src/world/lightmap.js';
import { SECTOR_ORDER } from '../src/world/layout.js';

let _spec = null;
export function loadSpec(path = new URL('./worldspec.json', import.meta.url)) {
  if (!_spec) _spec = JSON.parse(readFileSync(path, 'utf8'));
  return _spec;
}

const V3 = (a) => new THREE.Vector3(a[0], a[1], a[2]);

// lampadas do servidor: so o necessario para o mapa de luz (a IA decide por onde anda e o quanto ve com ele)
export class ServerLighting {
  constructor(grid, lampSpecs) {
    this.grid = grid;
    this.lamps = lampSpecs.map((l, i) => ({ ...l, id: i, state0: l.state, on: false, level: 1 }));
    this.powered = new Set([0]);
    this.blackout = false;
  }
  setPowered(sectors) {
    this.powered = new Set([0, ...sectors]);
    for (const l of this.lamps) l.on = !this.blackout ? this.powered.has(l.sector) : l.type === 'emerg';
    this.computeLightMap();
  }
  setBlackout(on) { this.blackout = on; this.setPowered([...this.powered].filter(s => s !== 0)); }
  computeLightMap() { computeLightMap(this.grid, this.lamps); }
  lightAt(x, z) { return lightAt(this.grid, x, z); }
  reset() { this.blackout = false; for (const l of this.lamps) l.state = l.state0; this.setPowered([]); }
  dead() { const out = []; this.lamps.forEach((l, i) => { if (l.state === 'dead' && l.state0 !== 'dead') out.push(i); }); return out; }
}

export class HeadlessWorld {
  constructor(spec = loadSpec()) {
    this.spec = spec;
    this.L = buildLayout();
    const g = this.grid = new Grid(this.L);
    for (const b of spec.propBoxes) g.addBox({ x0: b[0], x1: b[1], z0: b[2], z1: b[3], vision: !!b[4], kind: null, prop: true });
    for (const i of spec.navBlock) g.navBlock[i] = 1;

    // portas (mesma ordem/criterio do World._buildDoors)
    this.doors = [];
    for (let y = 0; y < g.H; y++) for (let x = 0; x < g.W; x++) {
      const c = g.char(x, y);
      if (!'DKJX'.includes(c)) continue;
      if (c === 'X' && g.char(x - 1, y) === 'X') continue;
      const d = new DoorCore(g, x, y, c);
      d.id = this.doors.length; d.sent = null;
      this.doors.push(d);
      if (c === 'X') this.exitDoor = d;
    }
    this.hideSpots = spec.hideSpots.map((s, i) => ({
      id: i, type: s.type, x: s.x, z: s.z, base: s.base, yaw: s.yaw, cell: s.cell,
      fwd: V3(s.fwd), camPos: V3(s.camPos), exitPos: V3(s.exitPos), inspectPos: V3(s.inspectPos),
      open: 0, target: 0, compromised: false, occupant: null,
    }));
    this.vents = spec.vents.map((v, i) => ({ id: i, x: v.x, z: v.z, base: v.base, cell: v.cell, mouth: V3(v.mouth), grate: { rotation: { x: 0 } } }));
    this.lighting = new ServerLighting(g, spec.lamps);
    this.lighting.setPowered([]);
    this.creatureSpawn = spec.creatureSpawn;
    this.playerStart = spec.playerStart;
    this.exitTrigger = spec.exitTrigger;
    this.panel = spec.panel;
    this.itemDefs = spec.items;
    this.drawers = spec.drawers;
  }

  // mesmo estado do inicio da partida (nova rodada)
  reset() {
    for (const d of this.doors) { d.resetState(); d.sent = null; }
    for (const s of this.hideSpots) { s.open = 0; s.target = 0; s.compromised = false; s.occupant = null; }
    for (const v of this.vents) v.grate.rotation.x = 0;
    this.lighting.reset();
  }

  // sectores acesos com n fusiveis instalados (os 6 primeiros acendem um setor cada; o 7o completa)
  sectorsFor(n) { return SECTOR_ORDER.slice(0, Math.min(n, SECTOR_ORDER.length)); }

  update(dt) { for (const d of this.doors) d.step(dt); }

  // posicao livre e alcancavel perto de (x,z), no mesmo andar: usada para soltar fusiveis e posicionar jogadores
  freeSpotNear(x, z, minR = 0, maxR = 3, radius = 0.32, ignoreProps = false) {
    const g = this.grid;
    const cands = [];
    for (let a = 0; a < 32; a++) for (let r = minR; r <= maxR; r += 0.4) {
      const ang = a / 32 * Math.PI * 2;
      const px = x + Math.cos(ang) * r, pz = z + Math.sin(ang) * r;
      const cx = g.cellX(px), cy = g.cellY(pz);
      if (!g.isFloor(cx, cy) || g.navBlock[g.idx(cx, cy)]) continue;
      const [qx, qz] = g.collideCircle(px, pz, radius);
      if (Math.hypot(qx - px, qz - pz) > 0.02) continue;
      if (!g.segmentClear(x, z, px, pz, false, (b) => !!b.door || (ignoreProps && b.prop))) continue;        // sem parede no meio: acessivel a pe
      cands.push({ x: px, z: pz, d: r + a * 1e-3 });
    }
    cands.sort((p, q) => p.d - q.d);
    const c = cands[0];
    return c ? { x: c.x, z: c.z, y: g.floorY(c.x, c.z) } : null;
  }
}

export { DOORISH };
