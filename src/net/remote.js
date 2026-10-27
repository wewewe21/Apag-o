// Jogadores remotos: avatar procedural, interpolacao suave, lanterna, nome e passos; aparicao do espirito para os vivos.
import * as THREE from 'three';
import { COOP } from '../shared/coop.js';
import { FLAG } from './protocol.js';
import { clamp, damp } from '../core/rng.js';
import { footstepSurfaceAt } from '../core/footsteps.js';

const COLORS = [0x8fa3b8, 0xb8a58f, 0x9bb88f, 0xb88f9b];   // uma cor de camisola por jogador
const SPOT_POOL = 3;
// silhueta de quem esta atras de uma parede, vista pelo espirito: fria, translucida, sem escrever profundidade
const XRAY_MAT = new THREE.MeshBasicMaterial({
  color: 0x7fb4ff, transparent: true, opacity: 0.2, depthTest: true, depthFunc: THREE.GreaterDepth, depthWrite: false, toneMapped: false,
  polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
});

function nameTexture(name) {
  const c = document.createElement('canvas'); c.width = 256; c.height = 64;
  const g = c.getContext('2d');
  g.font = '600 34px "Barlow Condensed", "Arial Narrow", sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.lineWidth = 6; g.strokeStyle = 'rgba(0,0,0,0.85)'; g.strokeText(name, 128, 34);
  g.fillStyle = '#d9d2c1'; g.fillText(name, 128, 34);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

class Avatar {
  constructor(id, name, color, spectator) {
    this.id = id; this.name = name;
    this.group = new THREE.Group();
    const skin = new THREE.MeshStandardMaterial({ color: 0xc9a893, roughness: 0.8 });
    const cloth = new THREE.MeshStandardMaterial({ color, roughness: 0.95 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x25282a, roughness: 0.9 });
    this.mats = [skin, cloth, dark];
    const add = (geo, mat, x, y, z, parent = this.group) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = true; parent.add(m); return m; };
    this.body = new THREE.Group(); this.group.add(this.body);
    add(new THREE.BoxGeometry(0.4, 0.62, 0.22), cloth, 0, 1.15, 0, this.body);
    this.head = new THREE.Group(); this.head.position.set(0, 1.5, 0); this.body.add(this.head);
    add(new THREE.SphereGeometry(0.12, 12, 10), skin, 0, 0.1, 0, this.head);
    add(new THREE.BoxGeometry(0.14, 0.05, 0.05), dark, 0, 0.09, 0.11, this.head);
    const leg = () => { const p = new THREE.Group(); p.position.y = 0.85; add(new THREE.BoxGeometry(0.15, 0.85, 0.16), dark, 0, -0.42, 0, p); return p; };
    const arm = () => { const p = new THREE.Group(); p.position.y = 1.42; add(new THREE.BoxGeometry(0.1, 0.55, 0.11), cloth, 0, -0.26, 0, p); return p; };
    this.legL = leg(); this.legL.position.x = -0.1; this.legR = leg(); this.legR.position.x = 0.1;
    this.armL = arm(); this.armL.position.x = -0.27; this.armR = arm(); this.armR.position.x = 0.27;
    this.body.add(this.legL, this.legR, this.armL, this.armR);
    this.torch = add(new THREE.CylinderGeometry(0.03, 0.035, 0.18, 8), dark, 0.03, -0.5, 0.1, this.armR); this.torch.rotation.x = Math.PI / 2;
    this.tag = new THREE.Sprite(new THREE.SpriteMaterial({ map: nameTexture(name), transparent: true, depthWrite: false, depthTest: true }));
    this.tag.scale.set(0.9, 0.225, 1); this.tag.position.y = 2.05; this.group.add(this.tag);
    this.phase = 0; this.stride = 0; this.spot = null;
    this.setSpectator(spectator);
    // interpolacao
    this.buf = []; this.cur = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, crouch: 0, flags: 0, fl: 0 };
    this.lastFoot = null;
  }
  setSpectator(on) {
    this.spectator = on;
    this._look();
    this.tag.material.opacity = on ? 0.6 : 1;
  }
  _look() {
    const on = this.spectator, nv = this.xrayOn;
    for (const m of this.mats) { m.transparent = on; m.opacity = on ? 0.35 : 1; m.emissive = new THREE.Color(on ? 0x223a55 : nv ? 0x1b2c3e : 0x000000); }
  }
  // Visao de espirito: alem do avatar normal (visivel com linha de visao), uma silhueta fraca que so aparece ATRAS de paredes e
  // objetos (GreaterDepth: passa so onde o avatar esta tapado). Assim "vejo direto" e "vejo atraves da parede" ficam bem diferentes.
  setXray(on) {
    if (on && !this.xray) {
      const src = []; this.group.traverse(o => { if (o.isMesh) src.push(o); });
      this.xray = src.map(o => {
        const x = new THREE.Mesh(o.geometry, XRAY_MAT);
        x.userData.xray = true; x.renderOrder = 6; x.position.copy(o.position); x.rotation.copy(o.rotation); x.scale.copy(o.scale);
        o.parent.add(x); return x;
      });
    }
    this.xrayOn = on; this._look();
    if (this.xray) for (const x of this.xray) x.visible = on;
    this.tag.material.depthTest = !on;            // o nome tambem aparece atras da parede
  }
  push(t, s) { this.buf.push({ t, ...s }); if (this.buf.length > 12) this.buf.shift(); }
  // amostra no instante `rt` (segundos, mesmo relogio de push) com interpolacao entre os dois estados vizinhos
  sample(rt) {
    const b = this.buf;
    if (!b.length) return null;
    if (rt <= b[0].t) return b[0];
    for (let i = b.length - 1; i > 0; i--) {
      if (b[i - 1].t <= rt) {
        const a = b[i - 1], c = b[i], k = c.t > a.t ? clamp((rt - a.t) / (c.t - a.t), 0, 1) : 1;
        let dy = c.yaw - a.yaw; while (dy > Math.PI) dy -= Math.PI * 2; while (dy < -Math.PI) dy += Math.PI * 2;
        return { x: a.x + (c.x - a.x) * k, y: a.y + (c.y - a.y) * k, z: a.z + (c.z - a.z) * k, yaw: a.yaw + dy * k, pitch: a.pitch + (c.pitch - a.pitch) * k, crouch: a.crouch + (c.crouch - a.crouch) * k, flags: c.flags, fl: c.fl };
      }
    }
    return b[b.length - 1];       // atrasou: fica no ultimo estado conhecido (sem extrapolar para dentro de paredes)
  }
}

export class RemotePlayers {
  constructor(game) {
    this.g = game; this.scene = game.scene;
    this.avatars = new Map();
    this.root = new THREE.Group(); this.scene.add(this.root);
    // luzes de lanterna dos outros: quantidade fixa (mudar o numero de luzes recompila os shaders)
    this.spots = [];
    for (let i = 0; i < SPOT_POOL; i++) {
      const s = new THREE.SpotLight(0xfff1dc, 0, 20, 0.42, 0.45, 2); s.castShadow = false;
      const t = new THREE.Object3D(); this.scene.add(s, t); s.target = t;
      this.spots.push({ s, t, owner: null });
    }
    this.now = 0;
    this.meta = new Map();        // id -> { name, colorIdx }
    this.xray = false;            // true enquanto EU sou espirito
  }

  setXray(on) { this.xray = !!on; for (const a of this.avatars.values()) a.setXray(this.xray); }

  setPlayers(list, meId) {
    this.meId = meId;
    list.forEach((p, i) => { if (!this.meta.has(p.id)) this.meta.set(p.id, { name: p.name, color: COLORS[i % COLORS.length] }); else this.meta.get(p.id).name = p.name; });
  }
  name(id) { return this.meta.get(id)?.name ?? '?'; }

  _avatar(id, spectator) {
    let a = this.avatars.get(id);
    if (!a) {
      const m = this.meta.get(id) || { name: '?', color: COLORS[0] };
      a = new Avatar(id, m.name, m.color, spectator);
      this.root.add(a.group); this.avatars.set(id, a);
      if (this.xray) a.setXray(true);
    }
    return a;
  }

  // snapshot do servidor: lista [id,x,y,z,yaw,pitch,crouch,flags,flFocus]
  onSnap(list, t) {
    const seen = new Set();
    for (const e of list) {
      const [id, x, y, z, yaw, pitch, crouch, flags, fl] = e;
      const spectator = !!(flags & (FLAG.SPECTATOR | FLAG.ESCAPED));
      const a = this._avatar(id, spectator);
      if (a.spectator !== spectator) a.setSpectator(spectator);
      a.push(t, { x, y, z, yaw, pitch, crouch, flags, fl });
      seen.add(id);
    }
    for (const [id, a] of this.avatars) if (!seen.has(id)) { a.group.visible = false; a.gone = true; } else { a.gone = false; }
  }

  remove(id) { const a = this.avatars.get(id); if (a) { this.root.remove(a.group); this.avatars.delete(id); } }
  clear() { for (const id of [...this.avatars.keys()]) this.remove(id); }

  update(dt, nowSec) {
    this.now = nowSec;
    const rt = nowSec - COOP.interpDelay;
    let spotIdx = 0;
    const cam = this.g.camera.position;
    for (const a of this.avatars.values()) {
      const st = a.gone ? null : a.sample(rt);
      if (!st) { a.group.visible = false; continue; }
      const hidden = !!(st.flags & FLAG.HIDDEN), offline = !!(st.flags & FLAG.OFFLINE);
      a.group.visible = !hidden;
      const moved = a.lastFoot ? Math.hypot(st.x - a.lastFoot.x, st.z - a.lastFoot.z) : 0;
      a.group.position.set(st.x, st.y, st.z);
      a.group.rotation.y = st.yaw + Math.PI;               // yaw do jogador: frente = -Z; o avatar tem a frente em +Z
      a.head.rotation.x = -st.pitch * 0.8;
      const crouch = st.crouch;
      a.body.scale.y = 1 - crouch * 0.3; a.body.position.y = -crouch * 0.05;
      // caminhada: balanco proporcional a velocidade real
      const speed = dt > 0 ? moved / dt : 0;
      const target = clamp(speed / 3.5, 0, 1.4);
      a.stride = damp(a.stride, target, 10, dt);
      a.phase += dt * (2.2 + speed * 2.2);
      const sw = Math.sin(a.phase) * 0.7 * a.stride;
      a.legL.rotation.x = sw; a.legR.rotation.x = -sw; a.armL.rotation.x = -sw * 0.8;
      a.armR.rotation.x = (st.flags & FLAG.FLASH) ? -1.35 + st.pitch * 0.4 : sw * 0.8;
      // passos posicionais
      if (a.lastFoot && !a.spectator && !hidden) {
        a.footAcc = (a.footAcc || 0) + moved;
        const stride = (st.flags & FLAG.SPRINT) ? 1.05 : 0.75;
        if (a.footAcc >= stride && moved > 0.001) { a.footAcc = 0; this.g.audio?.footstep(footstepSurfaceAt(this.g, st.x, st.z), (st.flags & FLAG.SPRINT) ? 0.9 : crouch > 0.5 ? 0.25 : 0.55, { x: st.x, y: st.y, z: st.z }); }
      }
      a.lastFoot = { x: st.x, z: st.z };
      // nome: some com a distancia
      const d = Math.hypot(st.x - cam.x, st.z - cam.z);
      a.tag.visible = !a.spectator && d < (a.xrayOn ? 30 : 14) && !offline;
      a.tag.material.opacity = clamp(1.4 - d / (a.xrayOn ? 22 : 10), 0, 1);
      const blink = !offline || Math.floor(nowSec * 3) % 2 === 0;
      a.group.traverse(o => { if (o.isMesh) o.visible = o.userData.xray ? (blink && a.xrayOn) : blink; });   // pisca se estiver sem conexao
      // lanterna
      const fl = !!(st.flags & FLAG.FLASH) && !hidden && !a.spectator;
      if (fl && spotIdx < SPOT_POOL) {
        const sp = this.spots[spotIdx++];
        const cp = Math.cos(st.pitch), dir = new THREE.Vector3(-Math.sin(st.yaw) * cp, Math.sin(st.pitch), -Math.cos(st.yaw) * cp);
        const eye = st.y + 1.5 - crouch * 0.6;
        sp.s.position.set(st.x + Math.cos(st.yaw) * 0.2, eye - 0.15, st.z - Math.sin(st.yaw) * 0.2);
        sp.t.position.copy(sp.s.position).add(dir);
        sp.s.angle = 0.42 - st.fl * 0.22; sp.s.distance = 22 + st.fl * 8;
        sp.s.intensity = (34 + st.fl * 60);
        sp.owner = a.id;
      }
    }
    for (; spotIdx < SPOT_POOL; spotIdx++) this.spots[spotIdx].s.intensity = 0;
  }
}

// Aparicao do espirito para os vivos (~1 s): silhueta palida e translucida, sem colisao, sem nome, sem interacao.
// O servidor decide quando e onde; o morto nao controla nada disso.
function specterMesh() {
  const g = new THREE.Group();
  const glow = new THREE.MeshBasicMaterial({ color: 0xb9d2ff, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, toneMapped: false });
  const dark = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0, depthWrite: false });
  const gown = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.4, 1.55, 14, 4, true), glow); gown.position.y = 0.95;
  const pos = gown.geometry.attributes.position;
  for (let i = 0; i < pos.count; i++) { const y = pos.getY(i); if (y < -0.6) pos.setY(i, y - Math.random() * 0.25); pos.setX(i, pos.getX(i) + Math.sin(y * 9 + i) * 0.02); }   // barra esfarrapada
  g.add(gown);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.12, 12, 10), glow); head.scale.set(0.9, 1.35, 0.95); head.position.y = 1.86; g.add(head);
  for (const sx of [-1, 1]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.03, 8, 6), dark); eye.position.set(sx * 0.045, 1.9, 0.1); eye.scale.set(1, 1.5, 0.6); g.add(eye);
    const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.018, 1.05, 6), glow); arm.position.set(sx * 0.26, 1.15, 0.03); arm.rotation.z = sx * 0.12; g.add(arm);
  }
  g.userData.mats = [glow, dark];
  return g;
}

export class GhostApparition {
  constructor(game) {
    this.g = game;
    this.mesh = specterMesh(); this.mesh.visible = false;
    game.scene.add(this.mesh);
    this.t = -1; this.dur = 1;
    this.light = new THREE.PointLight(0x7aa0d0, 0, 6, 2); game.scene.add(this.light);
  }
  show(x, y, z, yaw, dur = 1) {
    this.mesh.position.set(x, y, z); this.mesh.rotation.y = yaw; this.mesh.visible = true;
    this.t = 0; this.dur = dur; this.light.position.set(x, y + 1.4, z);
    this.g.audio?.whisper({ x, y: y + 1.5, z });
  }
  update(dt) {
    if (this.t < 0) return;
    this.t += dt;
    const k = this.t / this.dur;
    if (k >= 1) { this.hide(); return; }
    const a = Math.min(1, k / 0.15) * Math.min(1, (1 - k) / 0.3);         // entra rapido, some devagar
    const flick = 0.75 + 0.25 * Math.sin(this.t * 40);
    const [glow, dark] = this.mesh.userData.mats;
    glow.opacity = 0.42 * a * flick; dark.opacity = 0.9 * a;
    this.mesh.position.y += Math.sin(this.t * 5) * 0.0006;
    this.light.intensity = 2.5 * a;
  }
  hide() { this.t = -1; this.mesh.visible = false; this.light.intensity = 0; }
}
