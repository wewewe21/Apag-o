// Lampadas: posicionamento, setores de energia, mapa de luz (para a IA),
// pool de luzes dinamicas perto do jogador, piscadas e brilhos.
import * as THREE from 'three';
import { CELL, WALL_H, BASEMENT_Y } from '../config.js';
import { mulberry32 } from '../core/rng.js';
import { computeLightMap, lightAt } from './lightmap.js';

const TYPES = {
  fluor:  { color: 0xcfe8e0, intensity: 9,  distance: 10, power: 1.0, radius: 5.5, hang: 0.06 },
  bulb:   { color: 0xffc98a, intensity: 5,  distance: 8,  power: 0.75, radius: 4.5, hang: 0.6 },
  surg:   { color: 0xe8f4ff, intensity: 16, distance: 9,  power: 1.2, radius: 5,   hang: 0.9 },
  emerg:  { color: 0xff2a1a, intensity: 2.2, distance: 6, power: 0.18, radius: 3,  hang: 0 },
  street: { color: 0xffb070, intensity: 18, distance: 16, power: 1.0, radius: 7,   hang: 0 },
};

function haloTexture() {
  const s = 64, c = document.createElement('canvas'); c.width = c.height = s;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  grd.addColorStop(0, 'rgba(255,255,255,1)'); grd.addColorStop(0.15, 'rgba(255,255,255,0.55)');
  grd.addColorStop(0.45, 'rgba(255,255,255,0.12)'); grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd; g.fillRect(0, 0, s, s);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

export class Lighting {
  constructor(world, quality) {
    this.world = world;
    this.grid = world.grid;
    this.scene = world.scene;
    this.lamps = [];
    this.powered = new Set([0]);
    this.blackout = false;
    this.poolSize = quality.lights;
    this.pool = [];
    this.assignTimer = 0;
    this.rng = mulberry32(4242);
    for (let i = 0; i < this.poolSize; i++) {
      const l = new THREE.PointLight(0xffffff, 0, 8, 2);
      l.userData.lamp = null; l.userData.fade = 0;
      this.scene.add(l);
      this.pool.push(l);
    }
  }

  // ---------- posicionamento ----------
  placeFromLayout() {
    const L = this.grid.L, rng = this.rng;
    for (const r of L.rooms) {
      const Z = L.zones[r.z];
      if (!Z || Z.lamp === 'none' || Z.lamp === 'emerg' || !Z.spacing) continue;
      const vx0 = r.x0 - 0.5, vx1 = r.x1 + 1.5, vy0 = r.y0 - 0.5, vy1 = r.y1 + 1.5;
      const lx = vx1 - vx0, ly = vy1 - vy0;
      const nx = lx <= 3.2 ? 1 : Math.max(1, Math.round(lx / Z.spacing));
      const ny = ly <= 3.2 ? 1 : Math.max(1, Math.round(ly / Z.spacing));
      if (Z.lamp === 'street') {
        this.addLamp('street', (vx0 + 1.2) * CELL, (vy1 - 1.2) * CELL, 0, r.z, 0);
        continue;
      }
      for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
        const cx = vx0 + (i + 0.5) * lx / nx, cy = vy0 + (j + 0.5) * ly / ny;
        const gx = Math.floor(cx), gy = Math.floor(cy);
        const base = Z.level < 0 ? BASEMENT_Y : 0;
        // nao duplica lampadas em celulas de sobreposicao
        if (this.lamps.some(l => Math.hypot(l.x - cx * CELL, l.z - cy * CELL) < CELL * 1.2)) continue;
        this.addLamp(Z.lamp, cx * CELL, cy * CELL, base, r.z, Z.sector, rng() < Z.broken);
      }
    }
    for (const o of L.objects) {
      if (o.type !== 'emerg') continue;
      const g = this.grid;
      // encosta na parede mais proxima
      let best = null;
      for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) if (g.isWallish(o.x + dx, o.y + dy) && !g.isDoor(o.x + dx, o.y + dy)) { best = [dx, dy]; break; }
      const [dx, dy] = best || [0, -1];
      const off = CELL - 0.12 - 0.06;
      const base = g.levelBase(o.x, o.y);
      this.addLamp('emerg', g.cx(o.x) + dx * off, g.cz(o.y) + dy * off, base, g.zoneAt(o.x, o.y), 0, false, [dx, dy]);
    }
  }

  addLamp(type, x, z, base, zone, sector, broken = false, wallDir = null) {
    const T = TYPES[type];
    const r = this.rng();
    const state = broken ? (r < 0.55 ? 'dead' : 'dying') : 'ok';
    const lamp = {
      type, x, z, base, zone, sector, state, wallDir,
      y: type === 'emerg' ? base + 2.35 : type === 'street' ? base + 4.2 : base + WALL_H - T.hang,
      color: new THREE.Color(T.color), intensity: T.intensity * (0.85 + this.rng() * 0.3), distance: T.distance,
      power: T.power, radius: T.radius, seed: this.rng() * 1000, level: 0, on: false, startup: 0,
      cell: [this.grid.cellX(x), this.grid.cellY(z)],
    };
    lamp.state0 = state;     // estado de fabrica (para reiniciar a partida)
    if (type === 'fluor') lamp.rotY = this._corridorAxis(lamp.cell[0], lamp.cell[1]);
    this.lamps.push(lamp);
    return lamp;
  }

  _corridorAxis(x, y) {
    const g = this.grid;
    let hx = 0, vy = 0;
    for (let i = -2; i <= 2; i++) { if (g.isFloor(x + i, y)) hx++; if (g.isFloor(x, y + i)) vy++; }
    return hx >= vy ? 0 : Math.PI / 2;
  }

  // ---------- malhas (luminarias + brilhos) ----------
  buildMeshes(M) {
    const byType = {};
    for (const l of this.lamps) (byType[l.type] ||= []).push(l);
    this.glowMeshes = [];
    const dummy = new THREE.Object3D();
    const housing = new THREE.MeshStandardMaterial({ color: 0x8c8e88, roughness: 0.6, metalness: 0.4 });
    const shade = new THREE.MeshStandardMaterial({ color: 0x2d3a33, roughness: 0.5, metalness: 0.5, side: THREE.DoubleSide });
    const staticParts = new THREE.Group();

    for (const [type, list] of Object.entries(byType)) {
      let glowGeo;
      if (type === 'fluor') glowGeo = new THREE.BoxGeometry(1.15, 0.035, 0.1);
      else if (type === 'bulb') glowGeo = new THREE.SphereGeometry(0.055, 10, 8);
      else if (type === 'surg') glowGeo = new THREE.CircleGeometry(0.28, 20).rotateX(Math.PI / 2);
      else if (type === 'emerg') glowGeo = new THREE.BoxGeometry(0.22, 0.09, 0.05);
      else glowGeo = new THREE.SphereGeometry(0.16, 10, 8);
      const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false });
      const im = new THREE.InstancedMesh(glowGeo, mat, list.length);
      im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      list.forEach((l, i) => {
        dummy.position.set(l.x, l.y - (type === 'fluor' ? 0.06 : 0), l.z);
        dummy.rotation.set(0, l.rotY || 0, 0);
        if (type === 'emerg' && l.wallDir) dummy.rotation.y = Math.atan2(l.wallDir[0], l.wallDir[1]);
        dummy.updateMatrix();
        im.setMatrixAt(i, dummy.matrix);
        im.setColorAt(i, new THREE.Color(0));
        l.glow = { mesh: im, index: i };
        // partes estaticas
        const g = new THREE.Group();
        g.position.set(l.x, l.y, l.z); g.rotation.y = dummy.rotation.y;
        if (type === 'fluor') {
          const h = new THREE.Mesh(new THREE.BoxGeometry(1.25, 0.06, 0.26), housing); h.position.y = 0.0; g.add(h);
        } else if (type === 'bulb') {
          const cord = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.55, 4), M.black); cord.position.y = 0.3; g.add(cord);
          const sh = new THREE.Mesh(new THREE.ConeGeometry(0.2, 0.14, 14, 1, true), shade); sh.position.y = 0.07; g.add(sh);
        } else if (type === 'surg') {
          const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.85, 6), housing); arm.position.y = 0.45; g.add(arm);
          const head = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.4, 0.14, 20, 1, true), housing); head.position.y = 0.06; g.add(head);
          const cap = new THREE.Mesh(new THREE.CircleGeometry(0.34, 20).rotateX(-Math.PI / 2), housing); cap.position.y = 0.13; g.add(cap);
        } else if (type === 'emerg') {
          const b = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.14, 0.09), housing); b.position.z = -0.05; g.add(b);
          const cage = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.12, 0.08), new THREE.MeshStandardMaterial({ color: 0x222222, wireframe: true })); cage.position.z = 0.01; g.add(cage);
        } else if (type === 'street') {
          const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.09, 4.3, 8), M.steelDark); pole.position.y = -2.15; g.add(pole);
        }
        staticParts.add(g);
      });
      im.instanceColor.setUsage(THREE.DynamicDrawUsage);
      im.frustumCulled = false;
      this.scene.add(im);
      this.glowMeshes.push(im);
    }
    this.scene.add(staticParts);

    // halos (um unico draw call)
    const hp = new Float32Array(this.lamps.length * 3), hc = new Float32Array(this.lamps.length * 3);
    this.lamps.forEach((l, i) => { hp[i * 3] = l.x; hp[i * 3 + 1] = l.y - (l.type === 'fluor' ? 0.1 : 0); hp[i * 3 + 2] = l.z; });
    const hg = new THREE.BufferGeometry();
    hg.setAttribute('position', new THREE.BufferAttribute(hp, 3));
    hg.setAttribute('color', new THREE.BufferAttribute(hc, 3));
    this.haloColors = hc;
    this.halo = new THREE.Points(hg, new THREE.PointsMaterial({ size: 1.6, map: haloTexture(), vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true, toneMapped: false }));
    this.halo.frustumCulled = false;
    this.scene.add(this.halo);
  }

  // ---------- energia ----------
  setPowered(sectors, withStartup = true) {
    this.powered = new Set([0, ...sectors]);
    for (const l of this.lamps) {
      const was = l.on;
      l.on = !this.blackout ? this.powered.has(l.sector) : l.type === 'emerg';
      if (l.on && !was && withStartup) l.startup = l.type === 'fluor' ? 1.4 + this.rng() * 1.2 : 0.3;
    }
    this.computeLightMap();
  }

  // lampadas queimadas voltam ao que eram, sem energia nos setores e sem apagao geral
  reset() {
    this.blackout = false;
    for (const l of this.lamps) { l.state = l.state0; l.startup = 0; }
    this.setPowered([], false);
  }

  setBlackout(on) {
    this.blackout = on;
    this.setPowered([...this.powered].filter(s => s !== 0), false);
  }

  computeLightMap() { computeLightMap(this.grid, this.lamps); }

  lightAt(wx, wz) { return lightAt(this.grid, wx, wz); }

  // ---------- quadro a quadro ----------
  flicker(l, t, dt, creature) {
    if (!l.on || l.state === 'dead') return 0;
    let v = 1;
    const s = l.seed;
    if (l.type === 'emerg') {
      v = 0.75 + 0.25 * Math.sin(t * (this.blackout ? 7 : 1.3) + s);
    } else if (l.state === 'dying') {
      const burst = Math.sin(t * 0.37 + s) > 0.55;
      v = burst ? (Math.sin(t * 43 + s * 3) > 0.1 ? 1 : 0.05) : (Math.sin(t * 2.1 + s) > 0.985 ? 0.8 : 0.02);
    } else {
      v = 0.96 + 0.04 * Math.sin(t * 120 + s);
      if (Math.sin(t * 0.21 + s * 1.7) > 0.992) v *= 0.3;
    }
    if (l.startup > 0) {
      l.startup -= dt;
      v *= (Math.sin(t * 37 + s) > 0.3 || l.startup < 0.15) ? 1 : 0.05;
    }
    if (creature && l.type !== 'emerg') {
      // a criatura "bebe" a luz: lampadas perto dela gaguejam
      const d = Math.hypot(creature.x - l.x, creature.z - l.z);
      if (d < 7 && Math.abs(creature.y - l.base) < 3) {
        const k = 1 - d / 7;
        v *= (Math.sin(t * 29 + s) > k * 1.4 - 0.6) ? 1 - k * 0.6 : 0.03;
      }
    }
    return v;
  }

  update(dt, t, camPos, creature) {
    const col = new THREE.Color();
    let i = 0;
    for (const l of this.lamps) {
      l.level = this.flicker(l, t, dt, creature);
      const b = l.level;
      col.copy(l.color).multiplyScalar(l.type === 'emerg' ? 2.2 * b : 1.6 * b + (l.on ? 0 : 0.02));
      if (!l.on || l.state === 'dead') col.setRGB(0.03, 0.03, 0.03);
      l.glow.mesh.setColorAt(l.glow.index, col);
      // halo some perto da camera (senao vira um borrao gigante)
      const dc = Math.hypot(l.x - camPos.x, l.y - camPos.y, l.z - camPos.z);
      const near = Math.min(1, Math.max(0, (dc - 1.2) / 2.5));
      const hb = (l.type === 'emerg' ? 0.35 : 0.22) * b * (l.state === 'dead' ? 0 : 1) * near;
      this.haloColors[i * 3] = l.color.r * hb; this.haloColors[i * 3 + 1] = l.color.g * hb; this.haloColors[i * 3 + 2] = l.color.b * hb;
      i++;
    }
    for (const m of this.glowMeshes) m.instanceColor.needsUpdate = true;
    this.halo.geometry.attributes.color.needsUpdate = true;

    // reatribui as luzes dinamicas
    this.assignTimer -= dt;
    if (this.assignTimer <= 0) { this.assignTimer = 0.2; this._assign(camPos); }
    for (const pl of this.pool) {
      const l = pl.userData.lamp;
      if (!l) { pl.intensity = 0; continue; }
      pl.userData.fade = Math.min(1, pl.userData.fade + dt * 5);
      pl.intensity = l.intensity * l.level * pl.userData.fade;
    }
  }

  _assign(cam) {
    const g = this.grid;
    const cands = [];
    for (const l of this.lamps) {
      if (!l.on || l.state === 'dead') continue;
      if (Math.abs(l.base - (cam.y > -1.5 ? 0 : BASEMENT_Y)) > 3 && l.type !== 'street') continue;
      const d = Math.hypot(l.x - cam.x, l.z - cam.z);
      if (d > 26) continue;
      let score = d;
      if (!g.segmentClear(cam.x, cam.z, l.x, l.z, true)) score += 9;
      if (this.pool.some(p => p.userData.lamp === l)) score -= 2.5;
      score -= l.type === 'emerg' ? -3 : 0;
      cands.push([score, l]);
    }
    cands.sort((a, b) => a[0] - b[0]);
    const chosen = new Set(cands.slice(0, this.poolSize).map(c => c[1]));
    const free = [];
    for (const pl of this.pool) {
      if (pl.userData.lamp && chosen.has(pl.userData.lamp)) chosen.delete(pl.userData.lamp);
      else free.push(pl);
    }
    for (const l of chosen) {
      const pl = free.pop(); if (!pl) break;
      pl.userData.lamp = l; pl.userData.fade = 0;
      pl.color.copy(l.color); pl.distance = l.distance;
      pl.position.set(l.x, l.y - 0.15, l.z);
      if (l.type === 'emerg' && l.wallDir) pl.position.set(l.x - l.wallDir[0] * 0.3, l.y, l.z - l.wallDir[1] * 0.3);
    }
    for (const pl of free) { pl.userData.lamp = null; }
  }
}
