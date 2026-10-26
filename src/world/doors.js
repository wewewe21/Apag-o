// Portas: abrem para longe de quem empurra, bloqueiam passagem e visao quando fechadas.
import * as THREE from 'three';
import { CELL, WALL_T, DOOR_H, BASEMENT_Y } from '../config.js';
import { box, cyl, sign } from './props.js';
import { DoorCore, DOOR_JAM as JAM } from './doorcore.js';

export class Door extends DoorCore {
  constructor(world, x, y, kind) {
    super(world.grid, x, y, kind);       // estado, colisao e visao: ver doorcore.js (o servidor usa o mesmo codigo)
    const grid = world.grid;
    this.world = world;
    const zc = grid.zoneCfg(x, y);
    this.style = kind === 'X' ? 'exit' : kind === 'K' || kind === 'J' ? 'rust' : zc ? ({ ward: 'wood', clinic: 'wood', cell: 'cell', morgue: 'steel', office: 'office', concrete: 'rust', brick: 'rust' }[zc.wall] || 'wood') : 'wood';

    this.group = new THREE.Group();
    this.group.position.set(this.cx, this.base, this.cz);
    if (this.axis === 'v') this.group.rotation.y = -Math.PI / 2;   // abertura ao longo de z
    world.scene.add(this.group);
    this._buildMesh(world.M);
  }

  _buildMesh(M) {
    const w = this.width, h = this.exit ? 2.62 : DOOR_H - 0.05;
    const mat = { wood: M.cabinet, office: M.wood, cell: M.locker, steel: M.steel, rust: M.rust, exit: M.steelDark }[this.style];
    // guarnicao (moldura) dos dois lados
    const t = WALL_T / 2 + 0.02;
    for (const s of [-1, 1]) {
      box(this.group, M.steelDark, 0.07, h + 0.07, 0.03, -w / 2 - 0.035, (h + 0.07) / 2, s * t);
      box(this.group, M.steelDark, 0.07, h + 0.07, 0.03, w / 2 + 0.035, (h + 0.07) / 2, s * t);
      box(this.group, M.steelDark, w + 0.14, 0.07, 0.03, 0, h + 0.035, s * t);
    }
    this.leaves = [];
    const mkLeaf = (lw, hingeX, flip) => {
      const pivot = new THREE.Group();
      pivot.position.set(hingeX, 0, 0);
      this.group.add(pivot);
      const leaf = new THREE.Group();
      leaf.scale.x = flip ? -1 : 1;
      pivot.add(leaf);
      box(leaf, mat, lw - 0.01, h - 0.01, 0.05, lw / 2, h / 2, 0);
      if (this.style === 'wood' || this.style === 'office' || this.style === 'steel') {
        // janela aramada / vigia
        if (this.style === 'steel') cyl(leaf, M.glass, 0.13, 0.055, lw / 2, 1.5, 0, Math.PI / 2, 0, 0);
        else box(leaf, M.glass, 0.3, 0.45, 0.055, lw / 2, 1.45, 0);
        box(leaf, M.steel, lw - 0.06, 0.25, 0.056, lw / 2, 0.14, 0);   // chapa de chute
      }
      if (this.style === 'cell') {
        box(leaf, M.black, 0.28, 0.06, 0.056, lw / 2, 1.2, 0);           // fenda de comida
        cyl(leaf, M.chrome, 0.015, 0.056, lw / 2, 1.58, 0, Math.PI / 2, 0, 0);
        for (let i = 0; i < 3; i++) box(leaf, M.steelDark, lw - 0.04, 0.04, 0.056, lw / 2, 0.3 + i * 0.75, 0);
      }
      if (this.exit) {
        for (const s of [-1, 1]) box(leaf, M.chrome, lw * 0.75, 0.05, 0.05, lw * 0.5, 1.0, s * 0.06);
        box(leaf, M.glass, lw * 0.5, 0.7, 0.055, lw / 2, 1.8, 0);
      }
      // macaneta
      for (const s of [-1, 1]) box(leaf, M.chrome, 0.12, 0.025, 0.025, lw - 0.12, 1.0, s * 0.045);
      this.leaves.push({ pivot, leaf, flip });
    };
    if (this.exit) {
      mkLeaf(w / 2, -w / 2, false);
      mkLeaf(w / 2, w / 2, true);
      // trava magnetica e placa de saida
      const lock = new THREE.Group(); lock.position.set(0, h + 0.18, WALL_T / 2 + 0.06); this.group.add(lock);
      box(lock, M.steelDark, 0.5, 0.12, 0.08, 0, 0, 0);
      this.led = new THREE.Mesh(new THREE.SphereGeometry(0.025, 8, 6), new THREE.MeshBasicMaterial({ color: 0xff2010 }));
      this.led.position.set(0.18, 0, 0.045); lock.add(this.led);
      const s = sign('SAÍDA', { w: 0.9, h: 0.28, bg: '#1b3b22', color: '#cfe8c8' });
      s.position.set(0, h + 0.5, WALL_T / 2 + 0.02); this.group.add(s);
      this.exitSign = s;
      const s2 = s.clone(); s2.rotation.y = Math.PI; s2.position.z = -WALL_T / 2 - 0.02; this.group.add(s2);
    } else {
      mkLeaf(w, -w / 2, false);
    }
    if (this.kind === 'K') {
      const s = sign('SUBSOLO · ACESSO RESTRITO', { w: 0.8, h: 0.18, bg: '#b8a340', color: '#1a1a14' });
      // porta vertical: +z local aponta para o corredor (oeste)
      s.position.set(w / 2, 1.62, 0.03); this.leaves[0].leaf.add(s);
      this.padlock = new THREE.Group();
      box(this.padlock, M.brass, 0.07, 0.08, 0.03, 0, 0, 0);
      cyl(this.padlock, M.chrome, 0.025, 0.02, 0, 0.055, 0, Math.PI / 2, 0, 0);
      this.padlock.position.set(w - 0.12, 1.0, 0.07);
      this.leaves[0].leaf.add(this.padlock);
    }
    if (this.kind === 'J') {
      // cano atravessado na macaneta, visivel so do lado de dentro (leste = -z local)
      this.bar = new THREE.Group();
      cyl(this.bar, M.rust, 0.03, 1.5, 0, 0, 0, 0, 0, 1.1);
      this.bar.position.set(w * 0.35, 0.8, -0.28);
      this.group.add(this.bar);
    }
  }

  // volta ao estado inicial da partida (fechada, trancada/emperrada conforme o tipo)
  reset() {
    this.resetState();
    if (this.padlock) this.padlock.visible = true;
    if (this.bar) this.bar.visible = true;
    for (const l of this.leaves) l.pivot.rotation.y = 0;
  }

  update(dt) {
    if (!this.step(dt)) return;
    this._pose();
  }

  // posiciona as folhas conforme `open` (0..1) sem animar (estado recebido do servidor)
  snap(v) { this.open = this.target = v; this._pose(); }

  _pose() {
    const e = this.open < 0.5 ? 2 * this.open * this.open : 1 - Math.pow(-2 * this.open + 2, 2) / 2;
    const ang = e * 1.5;
    if (this.exit) {
      this.leaves[0].pivot.rotation.y = -ang;
      this.leaves[1].pivot.rotation.y = ang;
    } else {
      this.leaves[0].pivot.rotation.y = this.dir * ang;
    }
  }
}
