// Monta o mundo: arquitetura, portas, moveis, itens, esconderijos, dutos, placas e luzes.
import * as THREE from 'three';
import { CELL, WALL_T, WALL_H, BASEMENT_Y } from '../config.js';
import { buildLayout, ZONES, FUSE_TABLES } from './layout.js';
import { Grid } from './grid.js';
import { buildArchitecture } from './builder.js';
import { buildTextures, splatTexture, textTexture } from './textures.js';
import * as P from './props.js';
import { Door } from './doors.js';
import { Lighting } from './lighting.js';
import { mulberry32 } from '../core/rng.js';
import { ChildWard } from './child-ward.js';
import { ModelLibrary } from './models.js';

const T_HALF = WALL_T / 2;
const DIRS = [[0, -1], [1, 0], [0, 1], [-1, 0]];

export class World {
  // models: ModelLibrary opcional (modelos 3D em assets/models). Sem ela (e no servidor) tudo e feito de primitivas, como sempre.
  constructor(scene, quality, onProgress = () => {}, models = null) {
    this.scene = scene;
    this.models = models instanceof ModelLibrary ? models : null;
    this.quality = quality;
    this.onProgress = onProgress;
    this.interactables = [];
    this.hideSpots = [];
    this.items = [];
    this.vents = [];
    this.doorsList = [];
    this.dynamic = [];       // objetos com update(dt)
    this.propBoxes = [];     // caixas de colisao/visao dos moveis (o servidor multiplayer recria a mesma colisao a partir delas)
    this.staticRoot = new THREE.Group();
    this.rng = mulberry32(1313);
  }

  async build() {
    const step = async (msg) => { this.onProgress(msg); await new Promise(r => setTimeout(r, 0)); };
    await step('Planta do prédio');
    this.L = buildLayout();
    this.grid = new Grid(this.L);
    await step('Texturas: azulejos, concreto, ferrugem');
    this.T = buildTextures(this.quality.texture);
    this.M = P.makeMaterials(this.T);
    this.M.models = this.models;               // as fabricas de props (props.js) consultam, ex.: corpo coberto na maca
    await step('Paredes e pisos');
    const arch = buildArchitecture(this.grid, this.T, this.quality);
    this.archMaterials = arch.materials;
    for (const m of arch.meshes) this.scene.add(m);
    this.archMeshes = arch.meshes;
    await step('Portas');
    this._buildDoors();
    await step('Mobília e objetos');
    this._placeExplicit();
    this._buildDrawerBank();
    this._scatter();
    this._signsAndDecals();
    this._mergeStatic();
    this.childWard = new ChildWard(this);
    this.childWard.build();
    await step('Iluminação');
    this.lighting = new Lighting(this, this.quality);
    this.lighting.placeFromLayout();
    this.lighting.buildMeshes(this.M);
    this.lighting.setPowered([], false);
    await step('Pronto');
  }

  // ---------- utilidades de posicionamento ----------
  wallDirs(x, y) {
    const g = this.grid;
    return DIRS.filter(([dx, dy]) => g.isWallish(x + dx, y + dy) && !g.isDoor(x + dx, y + dy));
  }
  // posicao encostada na parede (dir = direcao da parede a partir da celula)
  anchor(x, y, dir, depth, along = 0) {
    const g = this.grid;
    const off = CELL - T_HALF - depth / 2 - 0.01;
    const px = g.cx(x) + dir[0] * off + (dir[1] !== 0 ? along : 0);
    const pz = g.cz(y) + dir[1] * off + (dir[0] !== 0 ? along : 0);
    return new THREE.Vector3(px, g.levelBase(x, y), pz);
  }
  yawFacingAway(dir) { return Math.atan2(-dir[0], -dir[1]); }

  nearDoor(x, y, r = 1) {
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) if (this.grid.isDoor(x + dx, y + dy)) return true;
    return false;
  }

  // adiciona um objeto estatico com colisao
  // Troca o VISUAL do prop por um modelo 3D (se a biblioteca tiver um para esse tipo). Colisao, navegacao e tamanho (res.w/d) continuam
  // os do prop procedural e o modelo nunca passa da pegada dele. Partes marcadas userData.overlay (corpo na maca, bandeja) so ficam
  // se o modelo pedir (spec.keepOverlay).
  skin(kind, res) {
    const lib = this.models;
    if (!lib || !lib.has(kind)) return res;
    const inst = lib.instance(kind, { w: res.w, d: res.d });
    if (!inst) return res;
    const spec = lib.templates.get(lib.byKind.get(kind))?.spec;
    const keep = !!spec?.keepOverlay;
    for (const c of [...res.g.children]) {
      if (!(keep && c.userData.overlay)) res.g.remove(c);
      else if (spec.overlayY) c.position.y += spec.overlayY;        // o modelo tem o colchao/tampo numa altura diferente da do prop procedural: o corpo apoia nele
    }
    res.g.add(inst);
    res.g.userData.glb = true;
    return res;
  }

  addProp(res, pos, yaw, opts = {}) {
    const { g } = res;
    g.position.copy(pos); g.rotation.y = yaw + (g.rotation.y || 0);
    (opts.dynamic || g.userData.glb ? this.scene : this.staticRoot).add(g);          // modelos 3D nao entram na fusao estatica (tem material proprio)
    if (opts.collide !== false && res.w) {
      const rot = Math.abs(Math.sin(yaw)) > 0.5;
      const hw = (rot ? res.d : res.w) / 2 + (opts.pad ?? 0), hd = (rot ? res.w : res.d) / 2 + (opts.pad ?? 0);
      const b = { x0: pos.x - hw, x1: pos.x + hw, z0: pos.z - hd, z1: pos.z + hd, vision: !!opts.tall, kind: null, prop: true };
      this.grid.addBox(b);
      this.propBoxes.push(b);
      if (opts.nav) this._navBlock(b);
      res.box = b;
    }
    return res;
  }

  _navBlock(b) {
    const g = this.grid;
    for (let y = g.cellY(b.z0); y <= g.cellY(b.z1); y++) for (let x = g.cellX(b.x0); x <= g.cellX(b.x1); x++) {
      if (!g.inb(x, y) || !g.isFloor(x, y)) continue;
      const cx = g.cx(x), cz = g.cz(y), m = 0.28;
      if (b.x1 > cx - m && b.x0 < cx + m && b.z1 > cz - m && b.z0 < cz + m) g.navBlock[g.idx(x, y)] = 1;
    }
  }

  // ---------- portas ----------
  _buildDoors() {
    const g = this.grid;
    for (let y = 0; y < g.H; y++) for (let x = 0; x < g.W; x++) {
      const c = g.char(x, y);
      if (!'DKJX'.includes(c)) continue;
      if (c === 'X' && g.char(x - 1, y) === 'X') continue;
      const d = new Door(this, x, y, c);
      this.doorsList.push(d);
      if (c === 'X') this.exitDoor = d;
      this.interactables.push({
        kind: 'door', door: d, obj: d.group, radius: 1.3,
        pos: () => new THREE.Vector3(d.cx, d.base + 1.1, d.cz),
        prompt: (game) => game.doorPrompt(d),
        use: (game) => game.useDoor(d),
      });
    }
  }

  // ---------- objetos explicitos do layout ----------
  _placeExplicit() {
    const g = this.grid, M = this.M, rng = this.rng;
    this.surfaces = new Map();   // "x,y" -> altura da superficie
    const key = (x, y) => x + ',' + y;
    this.occupied = new Set();

    for (const o of this.L.objects) {
      const dirs = Number.isInteger(o.x) && Number.isInteger(o.y) ? this.wallDirs(o.x, o.y) : [];
      const dir = dirs[0] || [0, -1];
      switch (o.type) {
        case 'playerStart': this.playerStart = { x: (o.x + 0.5) * CELL, z: (o.y + 0.5) * CELL, yaw: o.yaw }; break;
        case 'checkpoint': this.checkpoint = { x: (o.x + 0.5) * CELL, z: (o.y + 0.5) * CELL, yaw: o.yaw }; break;
        case 'creatureSpawn': this.creatureSpawn = { x: g.cx(o.x), z: g.cz(o.y) }; break;
        case 'exitTrigger': this.exitTrigger = { x: (o.x + 0.5) * CELL, z: (o.y + 0.5) * CELL }; break;
        case 'locker': {
          const res = P.locker(M);
          const pos = this.anchor(o.x, o.y, dir, res.d);
          const yaw = this.yawFacingAway(dir);
          this.addProp(res, pos, yaw, { tall: true, dynamic: true });
          const fwd = new THREE.Vector3(-dir[0], 0, -dir[1]);
          const spot = {
            type: 'locker', x: pos.x, z: pos.z, base: pos.y, yaw, fwd, res, cell: [o.x, o.y],
            camPos: pos.clone().add(new THREE.Vector3(0, P.LOCKER.eyeY, 0)).addScaledVector(fwd, P.LOCKER.eyeBack),
            exitPos: pos.clone().addScaledVector(fwd, 0.75),
            inspectPos: pos.clone().addScaledVector(fwd, 1.0),
            open: 0, target: 0,
          };
          this.hideSpots.push(spot);
          this.dynamic.push({ update: (dt) => { spot.open += Math.sign(spot.target - spot.open) * Math.min(Math.abs(spot.target - spot.open), dt * 4); res.pivot.rotation.y = -spot.open * 1.7; } });
          this.interactables.push({ kind: 'hide', spot, obj: res.g, radius: 0.9, pos: () => pos.clone().setY(pos.y + 1.2), prompt: (game) => game.hidePrompt(spot), use: (game) => game.toggleHide(spot) });
          this.occupied.add(key(o.x, o.y));
          break;
        }
        case 'bed': {
          const res = this.skin(o.kind === 'gurney' ? 'gurney' : 'bed:' + o.kind, P.bed(M, o.kind, rng));
          // cabeceira na parede, cama avanca para dentro da sala
          const pos = this.anchor(o.x, o.y, dir, res.d);
          const yaw = this.yawFacingAway(dir);
          this.addProp(res, pos, yaw, { nav: true, dynamic: false });
          const fwd = new THREE.Vector3(-dir[0], 0, -dir[1]);
          const side = new THREE.Vector3(fwd.z, 0, -fwd.x);
          // lado livre: o que nao encosta em parede
          const sx = g.cellX(pos.x + side.x * 1.2), sy = g.cellY(pos.z + side.z * 1.2);
          const sideSign = g.isFloor(sx, sy) ? 1 : -1;
          const out = side.clone().multiplyScalar(sideSign);
          const spot = {
            type: 'bed', x: pos.x, z: pos.z, base: pos.y, yaw: Math.atan2(out.x, out.z), fwd: out, res, cell: [o.x, o.y],
            camPos: pos.clone().add(new THREE.Vector3(0, 0.28, 0)).addScaledVector(out, 0.1),
            exitPos: pos.clone().addScaledVector(out, 0.95),
            inspectPos: pos.clone().addScaledVector(out, 1.1),
            clearance: res.clearance,
          };
          this.hideSpots.push(spot);
          this.interactables.push({ kind: 'hide', spot, obj: res.g, radius: 1.2, pos: () => pos.clone().setY(pos.y + 0.5), prompt: (game) => game.hidePrompt(spot), use: (game) => game.toggleHide(spot) });
          if (o.kind === 'ward') this._curtain(pos, yaw, rng);
          this.occupied.add(key(o.x, o.y));
          break;
        }
        case 'autopsyTable': {
          const res = this.skin('autopsyTable', P.autopsyTable(M, rng));
          this.addProp(res, new THREE.Vector3(g.cx(o.x), g.levelBase(o.x, o.y), g.cz(o.y) + CELL * 0.3), 0, { nav: true });
          this.occupied.add(key(o.x, o.y));
          break;
        }
        case 'desk': {
          const len = o.len * CELL * 0.92;
          const res = P.desk(M, len, o.kind, rng);
          const dirN = dirs.find(d => d[1] !== 0) || dir;
          const cx = g.cx(o.x) + (o.len - 1) * CELL / 2;
          let pos, yaw;
          if (o.kind === 'reception') { pos = new THREE.Vector3(cx, 0, g.cz(o.y)); yaw = 0; }
          else if (dirs.length && (o.kind === 'bench' || o.kind === 'office') && dirN[1] !== 0 && o.len > 1) {
            pos = this.anchor(o.x, o.y, dirN, res.d); pos.x = cx; yaw = this.yawFacingAway(dirN);
          } else { pos = new THREE.Vector3(cx, g.levelBase(o.x, o.y), g.cz(o.y)); yaw = 0; }
          pos.y = g.levelBase(o.x, o.y);
          this.addProp(res, pos, yaw, { nav: true });
          for (let i = 0; i < o.len; i++) { this.surfaces.set(key(o.x + i, o.y), { y: pos.y + res.top, x: g.cx(o.x + i), z: pos.z, kind: o.kind === 'bench' || o.kind === 'lab' ? 'bench' : 'desk' }); this.occupied.add(key(o.x + i, o.y)); }
          break;
        }
        case 'nurseStation': { const res = P.nurseStation(M, rng); this.addProp(res, new THREE.Vector3(g.cx(o.x), 0, g.cz(o.y)), Math.PI / 2, { nav: true }); this.occupied.add(key(o.x, o.y)); break; }
        case 'cart': {
          const res = this.skin('cart', P.cart(M, rng));
          const pos = this.anchor(o.x, o.y, dir, res.d);
          this.addProp(res, pos, this.yawFacingAway(dir), {});
          this.surfaces.set(key(o.x, o.y), { y: pos.y + res.top, x: pos.x, z: pos.z, kind: 'cart' });
          this.occupied.add(key(o.x, o.y));
          break;
        }
        case 'nightstand': {
          const res = P.sideTable(M);
          const pos = this.anchor(o.x, o.y, dir, res.d);
          this.addProp(res, pos, this.yawFacingAway(dir), {});
          this.surfaces.set(key(o.x, o.y), { y: pos.y + res.top, x: pos.x, z: pos.z, kind: 'nightstand' });
          this.occupied.add(key(o.x, o.y));
          break;
        }
        case 'shelf': {
          const res = P.shelf(M, rng, this.L.zone[o.y][o.x] === 'f' ? 'bottles' : this.L.zone[o.y][o.x] === 'q' ? 'mixed' : 'boxes');
          const vert = g.isFloor(o.x, o.y - 1) && g.isFloor(o.x, o.y + 1) && (this._isShelf(o.x, o.y - 1) || this._isShelf(o.x, o.y + 1));
          this.addProp(res, new THREE.Vector3(g.cx(o.x), g.levelBase(o.x, o.y), g.cz(o.y)), vert ? Math.PI / 2 : 0, { nav: true, tall: true });
          this.occupied.add(key(o.x, o.y));
          break;
        }
        case 'boiler': { const res = P.boiler(M); this.addProp(res, new THREE.Vector3(g.cx(o.x), BASEMENT_Y, g.cz(o.y)), 0, { nav: true, tall: true }); this.occupied.add(key(o.x, o.y)); break; }
        case 'generator': { const res = P.generator(M); this.addProp(res, new THREE.Vector3(g.cx(o.x), BASEMENT_Y, g.cz(o.y)), 0, { nav: true, tall: true }); this.generatorPos = new THREE.Vector3(g.cx(o.x), BASEMENT_Y + 1, g.cz(o.y)); this.occupied.add(key(o.x, o.y)); break; }
        case 'incinerator': { const res = P.incinerator(M); const pos = this.anchor(o.x, o.y, dir, res.d); this.addProp(res, pos, this.yawFacingAway(dir), { nav: true, tall: true }); this.occupied.add(key(o.x, o.y)); break; }
        case 'breakerBoard': { const res = P.breakerBoard(M); const d = [1, 0]; const pos = this.anchor(o.x, o.y, d, res.d); this.addProp(res, pos, this.yawFacingAway(d), { collide: false }); break; }
        case 'vent': {
          const res = P.vent(M);
          const pos = this.anchor(o.x, o.y, dir, 0.06);
          this.addProp(res, pos, this.yawFacingAway(dir), { collide: false, dynamic: true });
          this.vents.push({ x: g.cx(o.x), z: g.cz(o.y), base: pos.y, grate: res.g, cell: [o.x, o.y], mouth: pos.clone() });
          break;
        }
        case 'mapPoster': this._mapPoster(o); break;
        case 'panel': this.panelSpec = o; break;
      }
    }
    // itens depois dos moveis (precisam das superficies)
    for (const o of this.L.objects) {
      if (['fuse', 'key', 'battery', 'note'].includes(o.type) && !o.drawer) this._placeItem(o);
      if (o.type === 'fuse' && o.drawer) this.drawerFuse = { id: o.id, num: o.drawer };
    }
    this._addFuseTables();
  }

  // mesinhas de apoio extras (ver FUSE_TABLES): so movel; o fusivel sorteado pousa em cima delas
  _addFuseTables() {
    const M = this.M;
    for (const [cx, cy] of FUSE_TABLES) {
      const k = cx + ',' + cy;
      if (this.surfaces.has(k) || this.occupied.has(k)) continue;
      const dirs = this.wallDirs(cx, cy);
      if (!dirs.length) continue;
      const res = P.sideTable(M);
      const pos = this.anchor(cx, cy, dirs[0], res.d);
      this.addProp(res, pos, this.yawFacingAway(dirs[0]), {});
      this.surfaces.set(k, { y: pos.y + res.top, x: pos.x, z: pos.z, kind: 'table' });
      this.occupied.add(k);
    }
  }

  _isShelf(x, y) { return this.L.objects.some(o => o.type === 'shelf' && o.x === x && o.y === y); }

  _curtain(pos, yaw, rng) {
    const g = new THREE.Group();
    const M = this.M;
    const h = 2.15;
    const bar = (x0, z0, x1, z1) => { const m = P.box(g, M.chrome, Math.max(0.02, Math.abs(x1 - x0)), 0.02, Math.max(0.02, Math.abs(z1 - z0)), (x0 + x1) / 2, h, (z0 + z1) / 2); m.castShadow = false; };
    bar(-0.75, -1.0, -0.75, 1.1); bar(0.75, -1.0, 0.75, 1.1);
    // cortina ondulada de um lado, parcialmente puxada
    const geo = new THREE.PlaneGeometry(1.8, 1.75, 24, 1);
    const p = geo.attributes.position;
    for (let i = 0; i < p.count; i++) p.setZ(i, Math.sin(p.getX(i) * 9) * 0.05);
    geo.computeVertexNormals();
    const cur = new THREE.Mesh(geo, M.curtain);
    cur.rotation.y = Math.PI / 2; cur.position.set(rng() < 0.5 ? -0.75 : 0.75, h - 0.9, 0.2 + rng() * 0.3);
    cur.castShadow = true;
    g.add(cur);
    g.position.copy(pos); g.rotation.y = yaw;
    this.staticRoot.add(g);
  }

  _placeItem(o) {
    const g = this.grid, M = this.M;
    const k = o.x + ',' + o.y;
    let s = this.surfaces.get(k);
    if (!s) {
      const dirs = this.wallDirs(o.x, o.y);
      if (dirs.length && o.type !== 'note') {
        const res = P.sideTable(M);
        const pos = this.anchor(o.x, o.y, dirs[0], res.d);
        this.addProp(res, pos, this.yawFacingAway(dirs[0]), {});
        s = { y: pos.y + res.top, x: pos.x, z: pos.z, kind: 'table' };
      } else {
        s = { y: g.levelBase(o.x, o.y), x: g.cx(o.x) + (this.rng() - 0.5) * 0.4, z: g.cz(o.y) + (this.rng() - 0.5) * 0.4 };
      }
    }
    this.spawnItem(o.type, o.id, new THREE.Vector3(s.x + (this.rng() - 0.5) * 0.15, s.y + 0.002, s.z + (this.rng() - 0.5) * 0.1));
  }

  spawnItem(type, id, pos, parent = null) {
    const M = this.M;
    const mesh = type === 'fuse' ? P.fuseMesh(M) : type === 'battery' ? P.batteryMesh(M) : type === 'key' ? P.keyMesh(M) : P.noteMesh(M);
    mesh.position.copy(pos);
    (parent || this.scene).add(mesh);
    // brilho que so aparece quando a lanterna ilumina o item
    const glint = new THREE.Sprite(new THREE.SpriteMaterial({ map: this._glintTex(), color: type === 'fuse' ? 0xfff0c0 : 0xd8f0ff, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }));
    glint.scale.setScalar(type === 'note' ? 0.35 : 0.25);
    glint.position.set(0, 0.05, 0);
    mesh.add(glint);
    const item = { type, id, mesh, glint, taken: false, home: pos.clone(), parent };
    this.items.push(item);
    this.interactables.push({
      kind: 'item', item, obj: mesh, radius: 0.5,
      pos: () => mesh.getWorldPosition(new THREE.Vector3()),
      prompt: (game) => game.itemPrompt(item),
      use: (game) => game.takeItem(item),
      enabled: () => !item.taken && mesh.visible,
    });
    return item;
  }

  _glintTex() {
    if (this._gt) return this._gt;
    const s = 64, c = document.createElement('canvas'); c.width = c.height = s;
    const g = c.getContext('2d');
    const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grd.addColorStop(0, 'rgba(255,255,255,1)'); grd.addColorStop(0.2, 'rgba(255,255,255,0.35)'); grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd; g.fillRect(0, 0, s, s);
    g.fillStyle = 'rgba(255,255,255,0.8)'; g.fillRect(31, 4, 2, 56); g.fillRect(4, 31, 56, 2);
    this._gt = new THREE.CanvasTexture(c);
    return this._gt;
  }

  // ---------- necroterio: banco de gavetas ----------
  _buildDrawerBank() {
    const g = this.grid, M = this.M;
    const cells = [];
    for (let x = 0; x < g.W; x++) if (g.char(x, 0) === 'M') cells.push(x);
    if (!cells.length) return;
    const x0 = cells[0] * CELL, x1 = (cells[cells.length - 1] + 1) * CELL;
    const zf = CELL + 0.003;   // face frontal
    const cols = cells.length * 2, rows = 3;
    const cw = (x1 - x0) / cols, rh = 0.6, y0 = 0.12;
    // textura com as portas, numeros e puxadores
    const W = 2048, Hh = 512;
    const c = document.createElement('canvas'); c.width = W; c.height = Hh;
    const ctx = c.getContext('2d');
    const bankH = 2.9;
    const ppm = Hh / bankH;
    ctx.fillStyle = '#6c706f'; ctx.fillRect(0, 0, W, Hh);
    const nz = mulberry32(55);
    this.drawers = [];
    for (let col = 0; col < cols; col++) for (let row = 0; row < rows; row++) {
      const num = col * rows + row + 1;
      const px = col * W / cols, pw = W / cols;
      const py = Hh - (y0 + (row + 1) * rh) * ppm, ph = rh * ppm;
      const v = 150 + nz() * 30;
      ctx.fillStyle = `rgb(${v},${v + 3},${v + 2})`; ctx.fillRect(px + 5, py + 5, pw - 10, ph - 10);
      ctx.strokeStyle = '#2a2c2b'; ctx.lineWidth = 3; ctx.strokeRect(px + 5, py + 5, pw - 10, ph - 10);
      ctx.fillStyle = '#c8c9c4'; ctx.fillRect(px + pw * 0.3, py + ph * 0.62, pw * 0.4, 7);   // puxador
      ctx.fillStyle = '#e4dcc0'; ctx.fillRect(px + pw * 0.36, py + ph * 0.18, pw * 0.28, ph * 0.22);
      ctx.fillStyle = '#1a1a1a'; ctx.font = `bold ${ph * 0.17}px "Courier New", monospace`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(String(num), px + pw / 2, py + ph * 0.29);
      // ferrugem escorrida
      if (nz() < 0.4) { ctx.fillStyle = 'rgba(90,50,20,0.35)'; ctx.fillRect(px + pw * nz(), py + ph * 0.7, 3, ph * 0.5 * nz()); }
      this.drawers.push({ num, col, row, x: x0 + (col + 0.5) * cw, y: y0 + (row + 0.5) * rh, w: cw, h: rh, open: 0, target: 0, content: null, mesh: null });
    }
    const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
    const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.4, metalness: 0.55 });
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(x1 - x0, bankH), mat);
    plane.position.set((x0 + x1) / 2, bankH / 2, zf);
    plane.receiveShadow = true;
    this.scene.add(plane);
    this.drawerPlane = plane;
    this.drawerBank = { x0, x1, zf, cw, rh, y0 };

    // conteudo das gavetas
    const r = mulberry32(77);
    for (const d of this.drawers) {
      const k = r();
      d.content0 = k < 0.35 ? 'cadaver' : k < 0.55 ? 'bag' : k < 0.62 ? 'scratches' : 'empty';      // o que a gaveta tem quando NAO guarda fusivel
      d.content = d.num === 13 ? 'fuse' : d.content0;                                                // (padrao: o fusivel 4 na gaveta 13; placeFuses() sorteia outra)
    }
    // gaveta ja aberta e vazia: de onde ele saiu
    const lair = this.drawers.find(d => d.num === 23);
    lair.content = 'scratches';

    for (const d of this.drawers) {
      this.interactables.push({
        kind: 'drawer', drawer: d, obj: plane, radius: 0.45,
        pos: () => new THREE.Vector3(d.x, d.y, zf + 0.05),
        prompt: (game) => game.drawerPrompt(d),
        use: (game) => game.toggleDrawer(d),
      });
    }
    this._openDrawerNow(lair, true);
  }

  // cria a gaveta fisica (frente + bandeja + conteudo) e desliza para fora
  drawerMesh(d) {
    if (d.mesh) return d.mesh;
    const M = this.M, bank = this.drawerBank;
    const g = new THREE.Group();
    const cav = new THREE.Mesh(new THREE.BoxGeometry(d.w - 0.06, d.h - 0.06, 0.02), M.black);
    cav.position.set(d.x, d.y, bank.zf + 0.006);
    this.scene.add(cav);
    d.cavity = cav;
    P.box(g, M.steel, d.w - 0.07, d.h - 0.07, 0.04, 0, 0, 0);
    P.box(g, M.chrome, d.w * 0.4, 0.03, 0.04, 0, -d.h * 0.12, 0.03);
    const tray = new THREE.Group(); tray.position.set(0, -d.h / 2 + 0.06, -1.0); g.add(tray);
    d.tray = tray;
    P.box(tray, M.steel, d.w - 0.1, 0.03, 1.95, 0, 0, 0);
    if (d.content === 'cadaver' || d.content === 'fuse') {
      const holder = new THREE.Group(); holder.rotation.y = Math.PI; tray.add(holder);
      const r = mulberry32(d.num);
      P.bed; // (usa a mesma rotina do corpo coberto)
      const body = new THREE.Group();
      P.sph(body, M.sheet, 0.12, 0.11, 0.14, 0, 0.1, -0.78);
      P.sph(body, M.sheet, 0.22, 0.12, 0.45, 0, 0.1, -0.25);
      P.sph(body, M.sheet, 0.2, 0.09, 0.5, 0, 0.07, 0.35);
      P.sph(body, M.flesh, 0.04, 0.09, 0.05, 0.07, 0.1, 0.88); P.sph(body, M.flesh, 0.04, 0.09, 0.05, -0.07, 0.1, 0.88);
      P.box(body, M.tag, 0.05, 0.08, 0.004, 0.07, 0.03, 0.95, 0.2, 0, 0.3);
      holder.add(body);
    } else if (d.content === 'bag') {
      P.sph(tray, M.bag, 0.24, 0.12, 0.9, 0, 0.1, 0);
    } else if (d.content === 'scratches') {
      for (let i = 0; i < 5; i++) P.box(tray, M.blood, 0.01, 0.002, 0.3 + i * 0.05, -0.1 + i * 0.05, 0.017, 0.4, 0, 0.1, 0);
    }
    g.position.set(d.x, d.y, bank.zf);
    this.scene.add(g);
    d.mesh = g;
    if (d.content === 'fuse' && this.drawerFuse && d.num === this.drawerFuse.num) {
      const it = this.spawnItem('fuse', this.drawerFuse.id, new THREE.Vector3(0.05, 0.2, -0.9), tray);
      d.item = it;
    }
    return g;
  }

  // ---------- fusiveis sorteados ----------
  // item de fusivel de numero `id` que esta em uso nesta partida (os "sobrando" ficam escondidos e nao contam)
  fuseItem(id) { return this.items.find(i => i.type === 'fuse' && i.id === id && !i.unused) || null; }

  // tira o fusivel de dentro de uma gaveta (e devolve a gaveta ao conteudo natural)
  clearDrawerFuse() {
    for (const d of this.drawers || []) {
      if (d.item) {
        const it = d.item;
        it.mesh.parent?.remove(it.mesh);
        this.items.splice(this.items.indexOf(it), 1);
        const ix = this.interactables.findIndex(x => x.item === it); if (ix >= 0) this.interactables.splice(ix, 1);
        d.item = null;
      }
      if (d.content === 'fuse') d.content = d.content0;
    }
    this.drawerFuse = null;
  }

  // Aplica a distribuicao dos fusiveis desta partida: list = [{ id, x, y, z, drawer? }].
  // Move os fusiveis do cenario para os pontos sorteados, cria os que faltam e coloca um dentro da gaveta sorteada; esconde os que sobram.
  placeFuses(list) {
    this.clearDrawerFuse();
    const used = new Set();
    for (const a of list) {
      if (a.drawer != null) {
        const d = this.drawers.find(x => x.num === a.drawer);
        if (!d) continue;
        d.content = 'fuse'; this.drawerFuse = { id: a.id, num: a.drawer };
        if (d.mesh && d.tray) d.item = this.spawnItem('fuse', a.id, new THREE.Vector3(0.05, 0.2, -0.9), d.tray);     // gaveta ja montada: coloca o fusivel na bandeja
        continue;
      }
      let it = this.items.find(i => i.type === 'fuse' && i.id === a.id && !i.parent && !used.has(i));
      if (!it) it = this.spawnItem('fuse', a.id, new THREE.Vector3(a.x, a.y, a.z));
      used.add(it);
      it.unused = false; it.taken = false; it.mesh.visible = true; it.glint.material.opacity = 0;
      it.home.set(a.x, a.y, a.z); it.mesh.position.set(a.x, a.y, a.z);
      it.mesh.rotation.set(0, (a.id * 2.399963) % (Math.PI * 2), 0);
    }
    // fusiveis do cenario que nao receberam ponto (o id foi para a gaveta): somem
    for (const it of this.items) {
      if (it.type === 'fuse' && !it.parent && !used.has(it)) { it.unused = true; it.taken = true; it.mesh.visible = false; }
    }
  }

  _openDrawerNow(d, instant) {
    this.drawerMesh(d);
    d.target = 1; if (instant) d.open = 1;
    this._updateDrawer(d, 0);
  }

  _updateDrawer(d, dt) {
    if (!d.mesh) return;
    d.open += Math.sign(d.target - d.open) * Math.min(Math.abs(d.target - d.open), dt * 1.6);
    const e = 1 - Math.pow(1 - d.open, 2);
    d.mesh.position.z = this.drawerBank.zf + e * 1.05;
    d.mesh.visible = d.open > 0.001;
    d.cavity.visible = d.open > 0.001;
  }

  // ---------- planta de evacuacao ----------
  _mapPoster(o) {
    const g = this.grid;
    const canvas = this.renderMapCanvas(512, 400, { poster: true });
    const tex = new THREE.CanvasTexture(canvas); tex.colorSpace = THREE.SRGBColorSpace;
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.7), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.7 }));
    const dir = [-1, 0];
    const pos = this.anchor(o.x, o.y, dir, 0.02);
    mesh.position.set(pos.x, 1.55, pos.z);
    mesh.rotation.y = this.yawFacingAway(dir);
    const frame = new THREE.Mesh(new THREE.BoxGeometry(0.96, 0.76, 0.02), this.M.black);
    frame.position.set(-0.012, 0, 0); frame.rotation.y = Math.PI / 2;
    mesh.add(frame); frame.position.set(0, 0, -0.012); frame.rotation.y = 0;
    this.scene.add(mesh);
    const item = this.mapItem = { type: 'map', mesh, taken: false };
    this.interactables.push({
      kind: 'map', obj: mesh, radius: 0.7, pos: () => mesh.position.clone(),
      prompt: () => 'Arrancar a planta de evacuação', use: (game) => game.takeMap(item),
      enabled: () => !item.taken,
    });
  }

  renderMapCanvas(w, h, opts = {}) {
    const g = this.grid, L = this.L;
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const ctx = c.getContext('2d');
    ctx.fillStyle = opts.poster ? '#d9d2bd' : '#141816'; ctx.fillRect(0, 0, w, h);
    const s = Math.min((w - 20) / g.W, (h - 40) / g.H);
    const ox = (w - g.W * s) / 2, oy = 28;
    for (let y = 0; y < g.H; y++) for (let x = 0; x < g.W; x++) {
      const ch = g.char(x, y);
      const z = g.zoneAt(x, y);
      if (ch === '.' || ch === '=') {
        const Z = L.zones[z];
        ctx.fillStyle = opts.poster ? (Z.level < 0 ? '#a9b3aa' : '#f1ecde') : (Z.level < 0 ? '#2f3a34' : '#3c463f');
        if (z === 'o') ctx.fillStyle = opts.poster ? '#c8c2b0' : '#262a28';
        ctx.fillRect(ox + (x - 0.5) * s, oy + (y - 0.5) * s, s * 2, s * 2);
      }
    }
    // paredes
    ctx.fillStyle = opts.poster ? '#2b2b28' : '#9aa89e';
    for (const b of g.wallBoxes) {
      ctx.fillRect(ox + (b.x0 / CELL - 0.5) * s + s / 2, oy + (b.z0 / CELL - 0.5) * s + s / 2, Math.max(1, (b.x1 - b.x0) / CELL * s), Math.max(1, (b.z1 - b.z0) / CELL * s));
    }
    // portas
    for (const d of this.doorsList || []) {
      ctx.fillStyle = d.kind === 'X' ? '#2e7d32' : d.kind === 'K' ? '#b8860b' : opts.poster ? '#8d6e4a' : '#6f8a78';
      ctx.fillRect(ox + (d.cx / CELL) * s - s * 0.35, oy + (d.cz / CELL) * s - s * 0.35, s * 0.7, s * 0.7);
    }
    // nomes das zonas
    ctx.font = `${Math.max(8, s * 0.9)}px "Barlow Condensed", "Arial Narrow", sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = opts.poster ? '#3a3024' : '#c9d6cc';
    const seen = new Set();
    for (const r of L.rooms) {
      if (seen.has(r.z) || r.z === 'z') continue;
      const w_ = r.x1 - r.x0, h_ = r.y1 - r.y0;
      if (w_ < 2 && h_ < 2 && r.z !== 'p') continue;
      seen.add(r.z);
      const nm = L.zones[r.z].name.toUpperCase();
      ctx.fillText(nm, ox + ((r.x0 + r.x1 + 1) / 2) * s, oy + ((r.y0 + r.y1 + 1) / 2) * s);
    }
    ctx.fillStyle = opts.poster ? '#7a1a12' : '#e05a4a';
    ctx.font = `bold ${Math.max(10, s * 1.2)}px "Barlow Condensed", "Arial Narrow", sans-serif`;
    ctx.textAlign = 'left';
    ctx.fillText(opts.poster ? 'PLANTA DE EVACUAÇÃO — HOSPITAL-COLÔNIA SANTA LÚCIA' : 'HOSPITAL-COLÔNIA SANTA LÚCIA', 10, 14);
    if (opts.poster) { ctx.fillText('SUBSOLO ►', ox + 47 * s, oy + 40 * s - 6); }
    this.mapTransform = { ox, oy, s };
    return c;
  }

  // ---------- espalhamento procedural de moveis ----------
  _scatter() {
    const g = this.grid, M = this.M, rng = mulberry32(2024);
    const pools = {
      h: [['wheelchair', 3], ['gurney', 2], ['bench', 2], ['radiator', 2], ['extinguisher', 1], ['trash', 2], ['iv', 1], ['cabinet', 1]],
      r: [['bench', 4], ['trash', 1], ['radiator', 1], ['extinguisher', 1]],
      p: [['trash', 1], ['radiator', 1], ['wheelchair', 1]],
      e: [['iv', 3], ['side', 2], ['wheelchair', 1], ['cabinet', 1], ['radiator', 1]],
      m: [['gurney', 2], ['sink', 1], ['cabinet', 1]],
      t: [['cabinet', 2], ['sink', 2], ['side', 1]],
      l: [['cabinet', 3], ['sink', 1], ['filing', 1]],
      f: [['cabinet', 3], ['filing', 1]],
      a: [['filing', 3], ['cabinet', 1], ['radiator', 1]],
      q: [['filing', 4]],
      d: [['crate', 3], ['barrel', 1], ['wheelchair', 1]],
      s: [['barrel', 2], ['crate', 2], ['gurney', 1], ['wheelchair', 1]],
      i: [['barrel', 2], ['crate', 2]],
      n: [['restraint', 2], ['wheelchair', 1]],
      u: [['gurney', 3], ['crate', 1]],
      c: [['barrel', 3], ['crate', 1]],
      g: [['barrel', 2], ['crate', 2], ['filing', 1]],
      w: [['barrel', 1], ['crate', 1]],
    };
    const density = { h: 0.16, r: 0.12, p: 0.1, e: 0.2, m: 0.14, t: 0.2, l: 0.25, f: 0.25, a: 0.25, q: 0.2, d: 0.3, s: 0.12, i: 0.3, n: 0.25, u: 0.2, c: 0.25, g: 0.2, w: 0.1 };
    const make = (k) => {
      switch (k) {
        case 'wheelchair': return P.wheelchair(M, rng);
        case 'gurney': return P.bed(M, 'gurney', rng);
        case 'bench': return P.bench(M);
        case 'radiator': return P.radiator(M);
        case 'extinguisher': return P.extinguisher(M);
        case 'trash': return P.trashBin(M);
        case 'iv': return P.ivStand(M);
        case 'cabinet': return P.cabinet(M, rng);
        case 'filing': return P.filingCabinet(M);
        case 'side': return P.sideTable(M);
        case 'sink': return P.sink(M);
        case 'crate': return P.crate(M, rng);
        case 'barrel': return P.barrel(M, rng);
        case 'restraint': return P.restraintChair(M);
      }
    };
    const pick = (list) => { let tot = list.reduce((a, b) => a + b[1], 0), r = rng() * tot; for (const [k, w] of list) { if ((r -= w) <= 0) return k; } return list[0][0]; };
    const used = new Set();
    for (let y = 0; y < g.H; y++) for (let x = 0; x < g.W; x++) {
      if (g.char(x, y) !== '.') continue;
      const z = g.zoneAt(x, y);
      const pool = pools[z];
      if (!pool || this.occupied.has(x + ',' + y)) continue;
      const dirs = this.wallDirs(x, y);
      if (!dirs.length || this.nearDoor(x, y, 1)) continue;
      if (rng() > density[z]) continue;
      const dir = dirs[Math.floor(rng() * dirs.length)];
      const uk = `${x + dir[0]},${y + dir[1]},${dir[0]},${dir[1]}`;
      if (used.has(uk)) continue;
      // evita vizinhos imediatos na mesma parede
      if (used.has(`${x + dir[0] + dir[1]},${y + dir[1] + dir[0]},${dir[0]},${dir[1]}`) || used.has(`${x + dir[0] - dir[1]},${y + dir[1] - dir[0]},${dir[0]},${dir[1]}`)) continue;
      const k = pick(pool);
      const res = this.skin(k, make(k));
      const long = k === 'gurney';
      const depth = long ? res.w : res.d;
      const pos = this.anchor(x, y, dir, Math.min(depth, 0.9));
      let yaw = this.yawFacingAway(dir);
      if (long) yaw += Math.PI / 2;          // maca paralela a parede
      this.addProp(res, pos, yaw, { tall: ['cabinet', 'filing'].includes(k), pad: -0.05 });
      used.add(uk);
    }
    // canos no teto do subsolo
    for (const r of this.L.rooms) {
      if (!['s', 'c', 'g', 'i'].includes(r.z)) continue;
      const lenX = (r.x1 - r.x0 + 2) * CELL, lenZ = (r.y1 - r.y0 + 2) * CELL;
      const along = lenX >= lenZ;
      const res = P.pipes(M, (along ? lenX : lenZ) - 0.3, rng);
      const cx = (r.x0 + r.x1 + 1) / 2 * CELL, cz = (r.y0 + r.y1 + 1) / 2 * CELL;
      res.g.position.set(cx + (along ? 0 : -0.5), BASEMENT_Y + WALL_H - 0.35, cz + (along ? -0.6 : 0));
      if (!along) res.g.rotation.y = Math.PI / 2;
      this.staticRoot.add(res.g);
    }
    // papelada e entulho pelo chao
    for (let i = 0; i < 260; i++) {
      const x = Math.floor(rng() * g.W), y = Math.floor(rng() * g.H);
      if (g.char(x, y) !== '.' || g.zoneAt(x, y) === 'o') continue;
      const base = g.levelBase(x, y);
      const px = g.cx(x) + (rng() - 0.5) * CELL, pz = g.cz(y) + (rng() - 0.5) * CELL;
      if (rng() < 0.7) {
        const p = P.box(this.staticRoot, M.paper, 0.21, 0.002, 0.297, px, base + 0.003 + rng() * 0.004, pz, (rng() - 0.5) * 0.1, rng() * 6, 0);
        p.castShadow = false;
      } else {
        const b = P.box(this.staticRoot, rng() < 0.5 ? M.cardboard : M.rust, 0.05 + rng() * 0.2, 0.02 + rng() * 0.05, 0.05 + rng() * 0.2, px, base + 0.02, pz, 0, rng() * 6, 0);
        b.castShadow = false;
      }
    }
  }

  // ---------- placas, pichacoes e manchas ----------
  _signsAndDecals() {
    const g = this.grid, L = this.L;
    // placa com o nome da sala acima de cada porta, do lado de fora
    for (const d of this.doorsList) {
      if (d.kind === 'X') continue;
      const sides = d.axis === 'h' ? [[0, -1], [0, 1]] : [[-1, 0], [1, 0]];
      const zs = sides.map(([dx, dy]) => g.zoneAt(d.x + dx, d.y + dy));
      for (let i = 0; i < 2; i++) {
        const here = zs[i], there = zs[1 - i];
        if (!here || !there || here === there) continue;
        const corridorish = ['h', 's', 'r', 'p'].includes(here);
        if (!corridorish) continue;
        const nm = L.zones[there].name.toUpperCase();
        const s = P.sign(nm, { w: Math.min(1.1, 0.25 + nm.length * 0.06), h: 0.2 });
        const [dx, dy] = sides[i];
        s.position.set(d.cx + dx * (T_HALF + 0.015), d.base + 2.42, d.cz + dy * (T_HALF + 0.015));
        s.rotation.y = Math.atan2(dx, dy);
        this.scene.add(s);
      }
    }
    // pichacoes (dicas diegeticas)
    const tag = (x, y, dir, text, opts = {}) => {
      const m = P.graffiti(text, opts);
      const off = CELL - T_HALF - 0.012;
      m.position.set(g.cx(x) + dir[0] * off + (opts.along ?? 0) * (dir[1] !== 0 ? 1 : 0), g.levelBase(x, y) + (opts.y ?? 1.6), g.cz(y) + dir[1] * off + (opts.along ?? 0) * (dir[0] !== 0 ? 1 : 0));
      m.rotation.y = Math.atan2(-dir[0], -dir[1]);
      this.scene.add(m);
    };
    tag(2, 13, [0, -1], 'ELE ODEIA A LUZ', { w: 1.8, h: 0.4 });
    tag(8, 17, [1, 0], 'NOS OLHOS', { w: 1.3, h: 0.4, rot: 0.05 });
    tag(2, 24, [0, 1], 'NÃO APAGUE', { w: 1.4, h: 0.4 });
    tag(20, 11, [0, -1], '13', { w: 0.8, h: 0.8, y: 1.9, font: '700 300px "Special Elite", monospace' });
    tag(44, 10, [0, 1], 'ELE ANDA PELOS DUTOS', { w: 2.0, h: 0.35, y: -1.2 });
    tag(52, 16, [-1, 0], 'NOTURNOS', { w: 1.4, h: 0.4, y: 1.8 });
    tag(34, 22, [1, 0], 'ESCONDA-SE', { w: 1.3, h: 0.35, y: 1.3, color: 'rgba(30,30,30,0.8)' });
    tag(29, 25, [0, 1], 'NÃO OLHE PARA TRÁS', { w: 1.8, h: 0.35, y: 1.9 });

    // manchas no chao: sangue, arrasto ate o necroterio, pocas
    const splat = (x, z, y, s, rot, tex) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(s, s), new THREE.MeshStandardMaterial({ map: tex, transparent: true, depthWrite: false, roughness: 0.25, polygonOffset: true, polygonOffsetFactor: -3 }));
      m.rotation.x = -Math.PI / 2; m.rotation.z = rot; m.position.set(x, y + 0.004, z); m.renderOrder = 1;
      this.scene.add(m);
    };
    const blood = splatTexture(3), blood2 = splatTexture(9), drag = splatTexture(5, [60, 10, 8], 'drag'), dirt = splatTexture(12, [40, 34, 22]);
    const rng = mulberry32(99);
    // rastro de arrasto do corredor ate a porta do necroterio
    for (let i = 0; i < 8; i++) splat(g.cx(20) + Math.sin(i) * 0.2, g.cz(11) - i * 0.6 + 1.6, 0, 1.4, 0, drag);
    for (let i = 0; i < 28; i++) {
      const x = Math.floor(rng() * g.W), y = Math.floor(rng() * g.H);
      if (g.char(x, y) !== '.' || g.zoneAt(x, y) === 'o' || g.zoneAt(x, y) === 'w') continue;
      splat(g.cx(x) + (rng() - 0.5), g.cz(y) + (rng() - 0.5), g.levelBase(x, y), 0.6 + rng() * 1.6, rng() * 6, rng() < 0.4 ? (rng() < 0.5 ? blood : blood2) : dirt);
    }
  }

  // agrupa moveis estaticos por material em blocos de 10x10 celulas (menos draw calls)
  _mergeStatic() {
    this.staticRoot.updateMatrixWorld(true);
    const buckets = new Map();
    const chunk = 10 * CELL;
    this.staticRoot.traverse((o) => {
      if (!o.isMesh) return;
      const wp = new THREE.Vector3(); o.getWorldPosition(wp);
      const key = o.material.uuid + '|' + Math.floor(wp.x / chunk) + '|' + Math.floor(wp.z / chunk) + '|' + (o.castShadow ? 1 : 0);
      let b = buckets.get(key);
      if (!b) { b = { mat: o.material, list: [], shadow: o.castShadow }; buckets.set(key, b); }
      b.list.push(o);
    });
    for (const b of buckets.values()) {
      const pos = [], nor = [], uv = [];
      for (const m of b.list) {
        let geo = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone();
        geo.applyMatrix4(m.matrixWorld);
        const p = geo.attributes.position, n = geo.attributes.normal, u = geo.attributes.uv;
        for (let i = 0; i < p.count; i++) {
          pos.push(p.getX(i), p.getY(i), p.getZ(i));
          nor.push(n.getX(i), n.getY(i), n.getZ(i));
          uv.push(u ? u.getX(i) : 0, u ? u.getY(i) : 0);
        }
        geo.dispose();
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
      geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      geo.computeBoundingSphere();
      const mesh = new THREE.Mesh(geo, b.mat);
      mesh.castShadow = b.shadow; mesh.receiveShadow = true;
      mesh.matrixAutoUpdate = false;
      this.scene.add(mesh);
    }
    this.staticRoot.clear();
  }

  // Devolve TODO o estado mutavel do mundo ao inicio da partida: itens, gavetas, portas, esconderijos, luzes.
  // (Usado pelo Hardcore ao morrer e pelas novas rodadas do cooperativo; nao mexe no jogador nem na criatura.)
  resetState() {
    for (const it of this.items) {
      if (it.unused) { it.taken = true; it.mesh.visible = false; continue; }
      it.taken = false; it.mesh.visible = true; it.glint.material.opacity = 0;
    }
    if (this.mapItem) { this.mapItem.taken = false; this.mapItem.mesh.visible = true; }
    for (const d of this.drawers || []) {
      d.target = d.open = d.num === 23 ? 1 : 0;      // a gaveta 23 ja nasce aberta (de onde ele saiu)
      if (d.mesh) this._updateDrawer(d, 0);
    }
    for (const d of this.doorsList) d.reset();
    for (const s of this.hideSpots) { s.open = 0; s.target = 0; s.compromised = false; if (s.res.pivot) s.res.pivot.rotation.y = 0; }
    for (const v of this.vents) v.grate.rotation.x = 0;
    this.lighting.reset();
  }

  update(dt) {
    for (const d of this.doorsList) d.update(dt);
    for (const o of this.dynamic) o.update(dt);
    if (this.drawers) for (const d of this.drawers) if (d.mesh && d.open !== d.target) this._updateDrawer(d, dt);
  }
}
