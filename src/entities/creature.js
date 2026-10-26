// "O Noturno": movimentos Kimodo retargetados ao FBX original da criatura.
// O controlador SOMA mantém as mesmas interfaces da IA e do cooperativo.
import * as THREE from 'three';
import { clamp, damp, lerp } from '../core/rng.js';
import { createGuardianInstance } from './guardian-asset.js';
import { GuardianRig } from './guardian-rig.js';
import { DeathPose } from './deathpose.js';
import { sampleCreatureClearance } from '../shared/creature-clearance.js';

const S = 1.3;   // escala geral (1.75 m -> ~2.3 m)
// envelope (s) da reacao de dor: sobe rapido, segura, solta; peak = peso maximo da camada aditiva
export const FLINCH = { speed: 1.6, attack: 0.12, hold: 0.16, release: 0.28, peak: 0.85 };
// alongamento extra de ossos (multiplica o offset do filho em relacao ao pai)
const STRETCH = {
  Neck1: 1.2, Neck2: 1.9, Head: 1.5, Spine2: 1.1, Chest: 1.12,
  LeftForeArm: 1.45, RightForeArm: 1.45, LeftHand: 1.55, RightHand: 1.55,
  LeftHandThumbEnd: 1.4, RightHandThumbEnd: 1.4, LeftHandMiddleEnd: 1.9, RightHandMiddleEnd: 1.9,
  LeftShin: 1.15, RightShin: 1.15, LeftFoot: 1.2, RightFoot: 1.2, LeftToeBase: 1.3, RightToeBase: 1.3,
};
const LEG_STRETCH = 1.17;
const EFFECTIVE_STRIDE = Math.sqrt(S * LEG_STRETCH);

function decode(b64, scale) {
  const bin = atob(b64);
  const u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  const i16 = new Int16Array(u8.buffer);
  const out = new Float32Array(i16.length);
  for (let i = 0; i < i16.length; i++) out[i] = i16[i] / scale;
  return out;
}

export async function loadCreatureAnims(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error('animacoes da criatura nao encontradas: ' + url);
  return res.json();
}

export class CreatureModel {
  constructor(data, M, T, guardianAsset = null) {
    this.data = data;
    this.skinwalkerMotion = !!guardianAsset && data.guardianMotion?.version === 2 && data.guardianMotion.profile === 'skinwalker';
    this.heavyMotion = !!guardianAsset && (data.guardianMotion?.version === 1 || this.skinwalkerMotion);
    this.profile = data.guardianMotion;
    this.strideScale = this.skinwalkerMotion ? (this.profile.strideScale || 1) : EFFECTIVE_STRIDE;
    this.clearance = {}; this.motionPosition = new THREE.Vector3(); this.motionSpeed = 0;
    this.guardianState = { heavy: this.heavyMotion, clip: 'idle', phase: 0,
      contacts: { left: 0, right: 0 }, floorY: 0, playback: 1, pain: false,
      shield: 0, jawOpen: 0.2, eyeshine: 0, burnGlow: 0,
      profile: this.skinwalkerMotion ? 'skinwalker' : 'guardian', clearance: null };
    this.group = new THREE.Group();      // posicao/rotacao no mundo
    this.rig = new THREE.Group();        // escala + correcao de altura
    this.rig.scale.setScalar(S);
    this.group.add(this.rig);
    const sk = data.skeleton;
    this.names = sk.names;
    this.bones = {};
    this.boneList = sk.names.map((nm, j) => {
      const b = new THREE.Object3D();
      b.name = nm;
      const off = new THREE.Vector3().fromArray(sk.offsets[j]);
      if (!this.heavyMotion && STRETCH[nm]) off.multiplyScalar(STRETCH[nm]);
      b.position.copy(off);
      b.userData.rest = off.clone();
      this.bones[nm] = b;
      return b;
    });
    sk.names.forEach((nm, j) => {
      const p = sk.parents[j];
      (p < 0 ? this.rig : this.boneList[p]).add(this.boneList[j]);
    });
    if (guardianAsset) {
      // O SOMA continua como controlador invisivel; somente o FBX e renderizado.
      this.eyeMat = new THREE.MeshStandardMaterial({ emissive: 0xd8ff9a, emissiveIntensity: 0 });
      this.eyeHalos = [];
      this.guardianRoot = createGuardianInstance(guardianAsset, this.skinwalkerMotion ? {height: 3 / S, profile: 'skinwalker'} : undefined);
      this.rig.add(this.guardianRoot);
      this.guardian = new GuardianRig(this.rig, this.bones, this.guardianRoot, sk);
      if (this.skinwalkerMotion) this.strideScale = this.profile.strideScale || this.guardian.motion?.worldStrideScale || (this.guardian.strideScale * S) || 1;
    } else {
      this._buildMaterials(M, T);
      this._buildBody(M);
    }
    this._buildClips();
    this.mixer = new THREE.AnimationMixer(this.rig);
    this.actions = {};
    for (const [k, clip] of Object.entries(this.clips)) {
      const a = this.mixer.clipAction(clip);
      const info = data.clips[k];
      if (!info.loop) { a.setLoop(THREE.LoopOnce, 1); a.clampWhenFinished = true; }
      this.actions[k] = a;
    }
    this._baseActions = Object.entries(this.actions).filter(([key]) => key !== 'pain' && key !== 'shield');
    this.painAct = this.actions.pain || null;     // camada aditiva curta; peso controlado por flinch()/update()
    this.painT = -1;
    this.current = null;
    this.eyeshine = 0; this.burnGlow = 0; this.jawOpen = 0.2; this.shield = 0;
    this.lookTarget = null; this.lookWeight = 0;
    this.twitch = new THREE.Quaternion(); this.twitchTimer = 1;
    this.groundOffset = 0;
    this.deathPose = new DeathPose(this);      // cena de morte: so age quando a DeathScene liga (on)
    this.play('idle', 0);
  }

  setEnvironment(grid) { this.environment = grid; this.motionPosition.copy(this.group.position); }

  _buildMaterials(M, T) {
    this.skin = new THREE.MeshStandardMaterial({
      map: T.mat.skin.map, normalMap: T.mat.skin.normalMap, normalScale: new THREE.Vector2(1.4, 1.4),
      color: 0xf2f1ea, roughness: 0.62, metalness: 0,
    });
    this.skinDark = new THREE.MeshStandardMaterial({ color: 0x1c1618, roughness: 0.8 });
    this.bone = this.skin;
    this.nail = new THREE.MeshStandardMaterial({ color: 0x22201c, roughness: 0.3 });
    this.teeth = new THREE.MeshStandardMaterial({ color: 0xbfb49a, roughness: 0.35 });
    this.gums = new THREE.MeshStandardMaterial({ color: 0x3a1418, roughness: 0.3 });
    this.eyeMat = new THREE.MeshStandardMaterial({ color: 0x050505, roughness: 0.05, emissive: 0xd8ff9a, emissiveIntensity: 0 });
    this.cloth = new THREE.MeshStandardMaterial({ map: T.mat.strap.map, normalMap: T.mat.strap.normalMap, color: 0x8c877a, roughness: 0.95, side: THREE.DoubleSide });
    this.stitch = new THREE.MeshStandardMaterial({ color: 0x1c0d0c, roughness: 0.7 });
    this.M = M;
  }

  // ---------- corpo (partes rigidas presas aos ossos) ----------
  _seg(parentName, childName, r0, r1, mat, opts = {}) {
    const parent = this.bones[parentName], child = this.bones[childName];
    const v = child.userData.rest.clone();
    const len = v.length();
    const geo = new THREE.CylinderGeometry(r1, r0, len * (opts.lenK ?? 1), opts.seg ?? 8, 1);
    geo.translate(0, len * (opts.lenK ?? 1) / 2, 0);
    const m = new THREE.Mesh(geo, mat);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), v.clone().normalize());
    if (opts.flat) m.scale.set(opts.flat, 1, 1);
    m.castShadow = true;
    parent.add(m);
    return m;
  }
  _ball(boneName, r, mat, pos = [0, 0, 0], scale = [1, 1, 1]) {
    const m = new THREE.Mesh(new THREE.SphereGeometry(r, 12, 10), mat);
    m.position.fromArray(pos); m.scale.fromArray(scale); m.castShadow = true;
    this.bones[boneName].add(m);
    return m;
  }

  _buildBody(M) {
    const sk = this.skin;
    // pelve e coluna (abdomen fundo)
    this._ball('Hips', 0.09, sk, [0, 0.02, -0.02], [1.45, 0.62, 0.85]);
    this._seg('Hips', 'Spine1', 0.07, 0.06, sk);
    this._seg('Spine1', 'Spine2', 0.06, 0.055, sk);
    this._seg('Spine2', 'Chest', 0.055, 0.075, sk);
    // caixa toracica: torso magro + costelas marcando a pele
    const chest = this.bones.Chest;
    const neckOff = this.bones.Neck1.userData.rest;
    const torso = new THREE.Mesh(new THREE.SphereGeometry(0.13, 16, 12), sk);
    torso.position.set(0, neckOff.y * 0.45, -0.01); torso.scale.set(1.25, 1.6, 0.75); torso.castShadow = true;
    chest.add(torso);
    // omoplatas salientes e trapezio ligando ao pescoco
    for (const sx of [-1, 1]) {
      const blade = new THREE.Mesh(new THREE.SphereGeometry(0.07, 10, 8), sk);
      blade.position.set(sx * 0.09, neckOff.y * 0.62, -0.07); blade.scale.set(1, 1.4, 0.5); chest.add(blade);
      const trap = new THREE.Mesh(new THREE.SphereGeometry(0.06, 10, 8), sk);
      trap.position.set(sx * 0.07, neckOff.y * 0.9, -0.02); trap.scale.set(1.5, 0.7, 0.9); chest.add(trap);
    }
    // camisola de hospital rasgada pendurada nos ombros (tiras)
    const gown = new THREE.MeshStandardMaterial({ color: 0x8c989a, roughness: 0.95, side: THREE.DoubleSide, map: this.cloth.map });
    const strip = (parent, x, y, z, w, len, rx, ry) => {
      const geo = new THREE.PlaneGeometry(w, len, 1, 6);
      const p = geo.attributes.position;
      for (let i = 0; i < p.count; i++) {
        const yy = p.getY(i);
        p.setZ(i, Math.sin(yy * 9 + x * 20) * 0.012);
        if (yy < -len / 2 + 0.01) p.setY(i, yy + (Math.random() * 0.12));   // barra esfarrapada
      }
      geo.translate(0, -len / 2, 0);
      geo.computeVertexNormals();
      const m = new THREE.Mesh(geo, gown);
      m.position.set(x, y, z); m.rotation.set(rx, ry, 0);
      parent.add(m);
      return m;
    };
    for (let i = 0; i < 5; i++) strip(chest, -0.12 + i * 0.06, neckOff.y * 0.85, -0.11, 0.07, 0.55 + Math.random() * 0.35, 0.12, 0);
    for (let i = 0; i < 3; i++) strip(chest, -0.08 + i * 0.08, neckOff.y * 0.3, 0.1, 0.06, 0.35 + Math.random() * 0.3, -0.15, 0);
    for (let i = 0; i < 4; i++) strip(this.bones.Hips, -0.1 + i * 0.065, 0.02, 0.09 - (i % 2) * 0.16, 0.06, 0.25 + Math.random() * 0.25, 0, 0);
    for (let i = 0; i < 6; i++) {
      const rib = new THREE.Mesh(new THREE.TorusGeometry(0.125 - i * 0.004, 0.009, 5, 18, Math.PI * 1.25), sk);
      rib.rotation.set(Math.PI / 2 + 0.25, 0, Math.PI * 0.12 - Math.PI);
      rib.position.set(0, neckOff.y * 0.12 + i * 0.038, 0.015);
      rib.scale.set(1.08, 0.78, 1);
      chest.add(rib);
    }
    // incisao de autopsia em Y costurada
    const yCut = (x0, y0, x1, y1) => {
      const a = new THREE.Vector3(x0, y0, 0.095), b = new THREE.Vector3(x1, y1, 0.095);
      const len = a.distanceTo(b);
      const m = new THREE.Mesh(new THREE.BoxGeometry(0.006, len, 0.004), this.stitch);
      m.position.copy(a).add(b).multiplyScalar(0.5);
      m.rotation.z = Math.atan2(-(x1 - x0), y1 - y0);
      chest.add(m);
      const n = Math.floor(len / 0.018);
      for (let i = 0; i < n; i++) {
        const s = new THREE.Mesh(new THREE.BoxGeometry(0.022, 0.003, 0.004), this.stitch);
        s.position.lerpVectors(a, b, (i + 0.5) / n); s.position.z += 0.002; s.rotation.z = m.rotation.z;
        chest.add(s);
      }
    };
    const ty = neckOff.y * 0.78;
    yCut(-0.1, ty, 0, neckOff.y * 0.45); yCut(0.1, ty, 0, neckOff.y * 0.45); yCut(0, neckOff.y * 0.45, 0, -0.12);
    // restos da camisa de forca: faixas e fivelas
    for (const [y, r] of [[neckOff.y * 0.25, 0.132], [neckOff.y * 0.02, 0.1]]) {
      const band = new THREE.Mesh(new THREE.TorusGeometry(r, 0.018, 4, 20), this.cloth);
      band.rotation.x = Math.PI / 2; band.position.set(0, y, 0); band.scale.set(1.05, 0.8, 1.6);
      chest.add(band);
      const buckle = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.035, 0.012), M.brass);
      buckle.position.set(0.06, y, -0.1); chest.add(buckle);
    }
    // pescoco longo com vertebras
    this._seg('Chest', 'Neck1', 0.06, 0.04, sk, { lenK: 1.0 });
    this._seg('Neck1', 'Neck2', 0.036, 0.032, sk);
    this._seg('Neck2', 'Head', 0.032, 0.036, sk);
    for (const [bn, k] of [['Neck1', 0.3], ['Neck2', 0.25], ['Neck2', 0.7]]) {
      const off = this.bones[bn === 'Neck1' ? 'Neck2' : 'Head'].userData.rest;
      this._ball(bn, 0.018, this.bone, [off.x * k, off.y * k, off.z * k - 0.03]);
    }
    // cabeca: cranio alongado, orbitas fundas, olhos grandes
    const head = this.bones.Head;
    const skull = new THREE.Mesh(new THREE.SphereGeometry(0.1, 18, 14), sk);
    skull.position.set(0, 0.075, -0.02); skull.scale.set(0.84, 1.3, 1.05); skull.castShadow = true;
    head.add(skull);
    const face = new THREE.Mesh(new THREE.SphereGeometry(0.075, 14, 10), sk);
    face.position.set(0, 0.02, 0.035); face.scale.set(0.95, 1.35, 0.8); head.add(face);
    const brow = new THREE.Mesh(new THREE.SphereGeometry(0.06, 12, 8), sk);
    brow.position.set(0, 0.085, 0.065); brow.scale.set(1.2, 0.32, 0.7); head.add(brow);
    for (const sx of [-1, 1]) {
      const sock = new THREE.Mesh(new THREE.SphereGeometry(0.034, 12, 10), this.skinDark);
      sock.position.set(sx * 0.034, 0.05, 0.078); sock.scale.set(1.05, 1.0, 0.55); head.add(sock);
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.023, 12, 10), this.eyeMat);
      eye.position.set(sx * 0.034, 0.048, 0.083); head.add(eye);
      const cheek = new THREE.Mesh(new THREE.SphereGeometry(0.026, 8, 6), sk);
      cheek.position.set(sx * 0.052, 0.005, 0.07); cheek.scale.set(1, 1.2, 0.7); head.add(cheek);
    }
    // cavidade nasal
    const nose = new THREE.Mesh(new THREE.ConeGeometry(0.012, 0.03, 3), this.skinDark);
    nose.position.set(0, 0.012, 0.1); nose.rotation.x = Math.PI; head.add(nose);
    // cabelo ralo e oleoso
    for (let i = 0; i < 9; i++) {
      const s = new THREE.Mesh(new THREE.BoxGeometry(0.004, 0.18 + Math.random() * 0.14, 0.01), this.skinDark);
      const a = (i / 8 - 0.5) * 2.2;
      s.position.set(Math.sin(a) * 0.08, 0.05, -0.04 + Math.cos(a) * 0.03 - 0.04);
      s.rotation.set(0.3, 0, a * 0.2); head.add(s);
    }
    // mandibula (osso Jaw) com dentes
    const jaw = this.bones.Jaw;
    const jawM = new THREE.Mesh(new THREE.SphereGeometry(0.055, 12, 8, 0, Math.PI * 2, Math.PI * 0.35, Math.PI * 0.65), sk);
    jawM.position.set(0, -0.02, 0.035); jawM.scale.set(0.95, 1.4, 1.25); jaw.add(jawM);
    const mouth = new THREE.Mesh(new THREE.SphereGeometry(0.04, 10, 6), this.gums);
    mouth.position.set(0, -0.025, 0.05); mouth.scale.set(0.9, 0.7, 0.7); jaw.add(mouth);
    for (let i = 0; i < 8; i++) {
      const a = (i / 7 - 0.5) * 1.8;
      const tUp = new THREE.Mesh(new THREE.ConeGeometry(0.006, 0.03, 4), this.teeth);
      tUp.position.set(Math.sin(a) * 0.042, 0.005, 0.075 + Math.cos(a) * 0.012); tUp.rotation.x = Math.PI; head.add(tUp);
      const tDn = new THREE.Mesh(new THREE.ConeGeometry(0.005, 0.026, 4), this.teeth);
      tDn.position.set(Math.sin(a) * 0.04, -0.045, 0.08 + Math.cos(a) * 0.01); jaw.add(tDn);
    }
    // bracos longos, cotovelos ossudos
    for (const side of ['Left', 'Right']) {
      this._seg('Chest', side + 'Shoulder', 0.03, 0.028, sk);
      this._seg(side + 'Shoulder', side + 'Arm', 0.03, 0.04, sk);
      this._ball(side + 'Arm', 0.04, sk);
      this._seg(side + 'Arm', side + 'ForeArm', 0.034, 0.026, sk);
      this._ball(side + 'ForeArm', 0.029, sk, [0, 0, -0.01]);
      this._seg(side + 'ForeArm', side + 'Hand', 0.027, 0.02, sk);
      // mao: palma + dedos longos terminando em unhas escuras
      const hand = this.bones[side + 'Hand'];
      const mid = this.bones[side + 'HandMiddleEnd'].userData.rest.clone();
      const thumb = this.bones[side + 'HandThumbEnd'].userData.rest.clone();
      const palm = new THREE.Mesh(new THREE.SphereGeometry(0.04, 10, 8), sk);
      palm.position.copy(mid).multiplyScalar(0.28); palm.scale.set(1.3, 0.45, 1.0); hand.add(palm);
      const dir = mid.clone().normalize();
      const up = new THREE.Vector3(0, 1, 0);
      const across = new THREE.Vector3().crossVectors(dir, up).normalize();
      for (let f = 0; f < 4; f++) {
        const spread = (f - 1.5) * 0.017;
        const base = mid.clone().multiplyScalar(0.42).addScaledVector(across, spread);
        const len = mid.length() * (0.8 - Math.abs(f - 1.3) * 0.1);
        const fg = new THREE.Group(); fg.position.copy(base); hand.add(fg);
        fg.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().addScaledVector(across, spread * 1.5).normalize());
        fg.rotateX(0.35);
        const p1 = new THREE.Mesh(new THREE.CylinderGeometry(0.0055, 0.0075, len * 0.5, 5), sk); p1.position.y = len * 0.25; fg.add(p1);
        const k2 = new THREE.Group(); k2.position.y = len * 0.5; k2.rotation.x = 0.75; fg.add(k2);
        const p2 = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.0055, len * 0.42, 5), sk); p2.position.y = len * 0.21; k2.add(p2);
        const nail = new THREE.Mesh(new THREE.ConeGeometry(0.005, 0.035, 4), this.nail); nail.position.y = len * 0.44; nail.rotation.x = 0.4; k2.add(nail);
      }
      const tg = new THREE.Group(); tg.position.copy(thumb).multiplyScalar(0.25); hand.add(tg);
      tg.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), thumb.clone().normalize());
      const th = new THREE.Mesh(new THREE.CylinderGeometry(0.007, 0.01, thumb.length() * 0.9, 5), sk); th.position.y = thumb.length() * 0.45; tg.add(th);
      // tira de couro pendurada no antebraco
      const strap = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.26, 0.006), this.cloth);
      strap.position.copy(this.bones[side + 'Hand'].userData.rest).multiplyScalar(0.5); strap.position.y -= 0.12;
      this.bones[side + 'ForeArm'].add(strap);
    }
    // pernas magras, joelhos salientes
    for (const side of ['Left', 'Right']) {
      this._seg('Hips', side + 'Leg', 0.06, 0.055, sk);
      this._seg(side + 'Leg', side + 'Shin', 0.058, 0.036, sk);
      this._ball(side + 'Shin', 0.04, sk, [0, 0, 0.02]);
      this._seg(side + 'Shin', side + 'Foot', 0.034, 0.024, sk);
      this._seg(side + 'Foot', side + 'ToeBase', 0.03, 0.022, sk, { flat: 1.5 });
      const toes = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.02, 0.08), sk);
      toes.position.set(0, -0.005, 0.04); this.bones[side + 'ToeBase'].add(toes);
    }
    // etiqueta de necroterio no dedao direito
    const tag = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.08, 0.003), this.M.tag);
    tag.position.set(0.02, -0.06, 0.07); tag.rotation.set(0.2, 0.3, 0.2);
    this.bones.RightToeBase.add(tag);
    const str = new THREE.Mesh(new THREE.CylinderGeometry(0.001, 0.001, 0.06, 3), this.stitch);
    str.position.set(0.01, -0.025, 0.07); this.bones.RightToeBase.add(str);

    // brilho dos olhos visivel de longe (halo aditivo)
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const g = c.getContext('2d');
    const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grd.addColorStop(0, 'rgba(255,255,230,1)'); grd.addColorStop(0.25, 'rgba(210,255,150,0.5)'); grd.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grd; g.fillRect(0, 0, 64, 64);
    const tex = new THREE.CanvasTexture(c);
    this.eyeHalos = [];
    for (const sx of [-1, 1]) {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, color: 0xe0ffb0, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
      sp.scale.setScalar(0.12); sp.position.set(sx * 0.036, 0.045, 0.1);
      head.add(sp); this.eyeHalos.push(sp);
    }
    this.group.traverse(o => { if (o.isMesh) { o.castShadow = true; o.frustumCulled = false; } });
  }

  // ---------- animacao ----------
  _buildClips() {
    const d = this.data, J = d.skeleton.names.length;
    this.clips = {}; this.rootData = {};
    for (const [k, info] of Object.entries(d.clips)) {
      const rot = decode(info.rot, 32767), root = decode(info.root, 1000);
      const F = info.frames, fps = d.fps;
      const times = new Float32Array(F + (info.loop ? 1 : 0));
      for (let i = 0; i < times.length; i++) times[i] = i / fps;
      const tracks = [];
      for (let j = 0; j < J; j++) {
        const vals = new Float32Array(times.length * 4);
        for (let f = 0; f < times.length; f++) {
          const src = ((f % F) * J + j) * 4;
          vals.set([rot[src], rot[src + 1], rot[src + 2], rot[src + 3]], f * 4);
        }
        tracks.push(new THREE.QuaternionKeyframeTrack(d.skeleton.names[j] + '.quaternion', times, vals));
      }
      // raiz: so a altura (e balanco lateral nos loops). O deslocamento vai para a IA.
      const pv = new Float32Array(times.length * 3);
      for (let f = 0; f < times.length; f++) {
        const s = (f % F) * 3;
        const lx = info.loop ? root[s] : 0, lz = info.loop ? root[s + 2] : 0;
        pv.set([lx, root[s + 1] * (this.heavyMotion ? 1 : LEG_STRETCH * 0.98), lz], f * 3);
      }
      tracks.push(new THREE.VectorKeyframeTrack('Hips.position', times, pv));
      this.clips[k] = new THREE.AnimationClip(k, times[times.length - 1], tracks);
      this.rootData[k] = { root, frames: F, fps, info };
    }
    // dor (Kimodo): camada ADITIVA so do tronco, cabeca e bracos, relativa ao primeiro quadro; nao mexe em pernas nem na raiz
    const pain = this.clips.pain;
    if (pain) {
      const upper = /^(Spine1|Spine2|Chest|Neck1|Neck2|Head|Jaw|LeftShoulder|LeftArm|LeftForeArm|LeftHand|RightShoulder|RightArm|RightForeArm|RightHand)\.quaternion$/;
      const c = new THREE.AnimationClip('pain', pain.duration, pain.tracks.filter(t => upper.test(t.name)));
      THREE.AnimationUtils.makeClipAdditive(c, 0, c, d.fps);
      this.clips.pain = c;
    }
    // Native doorway performance affects the upper body only. Feet and their
    // contact phase continue on the current walking/running action.
    const doorway = d.guardianMotion?.visualLayers?.doorway;
    this.doorwayTracks = [];
    if (this.skinwalkerMotion && doorway?.rot) {
      const rot = decode(doorway.rot, 32767), F = doorway.frames;
      const times = Float32Array.from({length:F + 1}, (_,i) => i / d.fps);
      const upper = new Set(doorway.upperBodyBones || ['Spine1','Spine2','Chest','Neck1','Neck2','Head','LeftShoulder','LeftArm','LeftForeArm','LeftHand','RightShoulder','RightArm','RightForeArm','RightHand']);
      d.skeleton.names.forEach((name,j) => {
        if (!upper.has(name)) return;
        const vals = new Float32Array(times.length * 4);
        for (let f=0; f<times.length; f++) vals.set(rot.subarray(((f%F)*J+j)*4, ((f%F)*J+j)*4+4), f*4);
        const track = new THREE.QuaternionKeyframeTrack(name+'.quaternion',times,vals);
        this.doorwayTracks.push({bone:this.bones[name], interpolant:track.createInterpolant(new Float32Array(4)), q:new THREE.Quaternion()});
      });
      this.doorwayDuration = F / d.fps;
    }
    // escudo: so os bracos, pose do "recuo" cobrindo o rosto
    const rec = this.clips.recoil;
    if (rec) {
      const armTracks = rec.tracks.filter(t => /(Shoulder|Arm|ForeArm|Hand)\.quaternion/.test(t.name)).map(t => {
        const fi = 12, stride = 4;
        const v = t.values.slice(fi * stride, fi * stride + 4);
        const vv = new Float32Array(8); vv.set(v, 0); vv.set(v, 4);
        return new THREE.QuaternionKeyframeTrack(t.name, [0, 1], vv);
      });
      this.clips.shield = new THREE.AnimationClip('shield', 1, armTracks);
      this.data.clips.shield = { loop: true, speed: 0 };
    }
  }

  clipSpeed(name) { return (this.data.clips[name]?.speed || 1) * this.strideScale; }
  duration(name) { return this.clips[name]?.duration ?? 1; }

  play(name, fade = 0.3, opts = {}) {
    const a = this.actions[name];
    if (!a) return;
    if (this.current === name && !opts.restart) return;
    if (opts.restart && this.heavyMotion) this.guardian.resetMotion();
    const prev = this.current ? this.actions[this.current] : null;
    a.reset();
    a.enabled = true;
    a.setEffectiveWeight(1);
    a.setEffectiveTimeScale(opts.timeScale ?? 1);
    a.play();
    if (prev && prev !== a) {
      if (fade > 0) prev.crossFadeTo(a, fade, false);
      else prev.stop();
    }
    this.current = name;
    this.oneshotT = 0;
  }

  // tempo normalizado de um clipe pontual (para root motion)
  rootAt(name, t) {
    const r = this.rootData[name]; if (!r) return [0, 0];
    const f = clamp(t * r.fps, 0, r.frames - 1);
    const i = Math.floor(f), k = f - i, j = Math.min(r.frames - 1, i + 1);
    return [lerp(r.root[i * 3], r.root[j * 3], k) * S, lerp(r.root[i * 3 + 2], r.root[j * 3 + 2], k) * S];
  }

  // reacao curta de dor (~0,5 s) quando a luz queima o rosto. Nao muda estado, velocidade nem colisao da criatura.
  // Retorna false se ja ha uma em andamento ou se o clipe nao existe (sem sobreposicao de animacoes).
  flinch(strength = 1) {
    if (!this.painAct || this.painT >= 0) return false;
    this.painT = 0; this.painStrength = strength;
    this.painAct.reset(); this.painAct.enabled = true; this.painAct.setEffectiveTimeScale(FLINCH.speed);
    this.painAct.setEffectiveWeight(0); this.painAct.play();
    return true;
  }
  cancelFlinch() { if (this.painT >= 0) { this.painT = -1; this.painAct.stop(); } }

  _updateFlinch(dt) {
    if (this.painT < 0) return;
    this.painT += dt;
    const t = this.painT, F = FLINCH;
    const env = t < F.attack ? t / F.attack : t < F.attack + F.hold ? 1 : Math.max(0, 1 - (t - F.attack - F.hold) / F.release);
    // se ela ja esta com os bracos no rosto (escudo), a dor soma menos
    this.painAct.setEffectiveWeight(env * env * (3 - 2 * env) * F.peak * this.painStrength * (1 - Math.min(0.7, this.shield * 0.7)));
    if (t >= F.attack + F.hold + F.release) { this.painT = -1; this.painAct.stop(); }
  }

  setShield(w) {
    const a = this.actions.shield;
    if (!a) return;
    this.shield = w;
    if (w > 0.01) { if (!a.isRunning()) { a.reset(); a.play(); } a.setEffectiveWeight(w * 1.6); }
    else if (a.isRunning()) a.stop();
  }

  colliderReach() {
    const p = this.profile?.anatomy?.clips?.[this.current];
    return p ? p.headReach : null;
  }

  update(dt, floorY, time) {
    this._dt = dt;
    this._updateFlinch(dt);
    this.mixer.update(dt);
    // camadas procedurais so sobre uma pose recem-escrita pelo mixer (senao acumulariam)
    const cur = this.current && this.actions[this.current];
    const fresh = !!(cur && cur.enabled && cur.isScheduled());
    if (!fresh && this.current) this.play(this.data.clips[this.current]?.loop ? this.current : 'idle', 0, { restart: true });
    if (this.skinwalkerMotion && this.environment) {
      const moved = this.group.position.distanceTo(this.motionPosition);
      const speed = dt > 0 && moved < 2 ? moved / dt : this.motionSpeed;
      this.motionSpeed = damp(this.motionSpeed, speed, 12, dt);
      this.motionPosition.copy(this.group.position);
      sampleCreatureClearance(this.environment, this.group.position.x, this.group.position.z, this.group.rotation.y,
        floorY, this.motionSpeed, dt, this.clearance);
      this.guardianState.clearance = this.clearance;
    }
    if (fresh && this.doorwayTracks.length && this.clearance.duck > 0.01) {
      const phase = cur.time / this.duration(this.current);
      const layerTime = (phase % 1) * this.doorwayDuration;
      const w = Math.min(0.75, this.clearance.duck * 0.75);
      for (const tr of this.doorwayTracks) tr.bone.quaternion.slerp(tr.q.fromArray(tr.interpolant.evaluate(layerTime)), w);
    }
    // postura corcunda: coluna curvada, pescoco projetado para frente, cabeca erguida (abutre)
    const h = this.hunch ?? (this.heavyMotion ? 0 : 1);
    if (h > 0 && fresh) {
      const q = new THREE.Quaternion(), X = new THREE.Vector3(1, 0, 0);
      for (const [bn, a] of [['Spine1', 0.12], ['Spine2', 0.16], ['Chest', 0.16], ['Neck1', 0.35], ['Neck2', 0.1], ['Head', -0.45]]) {
        this.bones[bn].quaternion.multiply(q.setFromAxisAngle(X, a * h));
      }
      // ombros caidos para frente
      const Y = new THREE.Vector3(0, 1, 0);
      this.bones.LeftShoulder.quaternion.multiply(q.setFromAxisAngle(Y, -0.25 * h));
      this.bones.RightShoulder.quaternion.multiply(q.setFromAxisAngle(Y, 0.25 * h));
    }
    if (this.deathPose.on) this.deathPose.applySoma(time);
    this.rig.updateMatrixWorld(true);
    // cabeca procura o alvo
    if (this.lookTarget && this.lookWeight > 0.01) this._aimHead(this.lookTarget, this.lookWeight);
    // tiques da cabeca (espasmos)
    if (!this.heavyMotion) {
      this.twitchTimer -= dt;
      if (this.twitchTimer <= 0) {
        this.twitchTimer = 0.6 + Math.random() * 3.5;
        this.twitch.setFromEuler(new THREE.Euler((Math.random() - 0.5) * 0.6, (Math.random() - 0.5) * 0.9, (Math.random() - 0.5) * 1.1));
        this._twitchAmt = 1;
      }
      this._twitchAmt = Math.max(0, (this._twitchAmt || 0) - dt * 4);
      if (this._twitchAmt > 0) this.bones.Head.quaternion.slerp(this.bones.Head.quaternion.clone().multiply(this.twitch), this._twitchAmt * 0.5);
    }
    // mandibula
    const jaw = this.jawOpen + Math.sin(time * 1.3) * 0.04;
    this.bones.Jaw.quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), jaw));
    // brilho dos olhos
    const e = clamp(this.eyeshine + this.burnGlow, 0, 1.5);
    this.eyeMat.emissiveIntensity = e * 5;
    this.eyeMat.emissive.setRGB(1, 1 - this.burnGlow * 0.6, 0.6 - this.burnGlow * 0.5);
    for (const h of this.eyeHalos) { h.material.opacity = clamp(e, 0, 1); h.scale.setScalar(0.1 + e * 0.12); }
    // apoia os pes (ou maos, se engatinhando) no chao
    this.rig.position.y = 0;
    this.rig.updateMatrixWorld(true);
    let minY = Infinity;
    if (this.guardian) {
      const state = this.guardianState, action = this.current && this.actions[this.current];
      state.clip = this.current; state.floorY = floorY;
      state.phase = action ? action.time / this.duration(this.current) : 0;
      state.playback = action?.getEffectiveTimeScale() ?? 1;
      state.shield = this.shield; state.jawOpen = this.jawOpen;
      state.eyeshine = this.eyeshine; state.burnGlow = this.burnGlow; state.pain = this.painT >= 0;
      this._sampleFootContacts(state.contacts);
      this.guardian.update(dt, time, state);
      minY = this.guardian.supportY();
    } else {
      const v = new THREE.Vector3();
      for (const n of ['LeftToeBase', 'RightToeBase', 'LeftFoot', 'RightFoot', 'LeftHandMiddleEnd', 'RightHandMiddleEnd']) {
        this.bones[n].getWorldPosition(v);
        minY = Math.min(minY, v.y - (n.includes('Hand') ? 0.02 : n.includes('Toe') ? 0.035 : 0.06));
      }
    }
    const want = floorY - minY;
    this.groundOffset = Math.abs(want - this.groundOffset) > 0.5 ? want : damp(this.groundOffset, want, 12, dt);
    this.rig.position.y = this.groundOffset / this.group.scale.y;
    this.rig.updateMatrixWorld(true);
    if (this.heavyMotion) this.guardian.ground?.(dt, floorY, this.guardianState);
    if(this.skinwalkerMotion && this.afterPose?.()) {
      this.group.updateMatrixWorld(true);
      if(this.environment)sampleCreatureClearance(this.environment,this.group.position.x,this.group.position.z,
        this.group.rotation.y,floorY,this.motionSpeed,0,this.clearance);
      this.guardian.motion.resolveEnvironment?.(this.guardianState);
      this.guardian.ground?.(0,floorY,this.guardianState);
    }
    if (this.deathPose.on) this.deathPose.applyFbx(dt, time);
  }

  // Contact curves come from Kimodo foot motion. Blend them with the same
  // action weights as the pose, so a transition does not abruptly pin a foot.
  _sampleFootContacts(out) {
    out.left = 0; out.right = 0;
    if (!this.heavyMotion) return out;
    let total = 0;
    for (const [key, action] of this._baseActions) {
      if (!action.enabled || !action.isScheduled()) continue;
      const weight = action.getEffectiveWeight();
      if (weight <= 0) continue;
      const info = this.data.clips[key], curves = info?.contacts;
      total += weight;
      if (!curves?.left?.length || !curves?.right?.length) continue;
      const n = curves.left.length, frame = clamp(action.time * this.data.fps, 0, info.loop ? n : n - 1);
      const i = Math.floor(frame) % n, j = info.loop ? (i + 1) % n : Math.min(n - 1, i + 1), k = frame - Math.floor(frame);
      out.left += lerp(curves.left[i], curves.left[j], k) * weight;
      out.right += lerp(curves.right[i], curves.right[j], k) * weight;
    }
    if (total > 0) { out.left = clamp(out.left / total, 0, 1); out.right = clamp(out.right / total, 0, 1); }
    return out;
  }

  _aimHead(target, w) {
    const head = this.bones.Head, neck = this.bones.Neck2;
    const hp = this.heavyMotion ? this.headWorld() : head.getWorldPosition(new THREE.Vector3());
    const dir = this._aimDirection(target.clone().sub(hp).normalize());
    for (const [bone, k] of [[neck, 0.5], [head, 0.92]]) {      // quase travado: a cabeca nao balanca junto com o passo
      const wq = bone.getWorldQuaternion(new THREE.Quaternion());
      const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(wq);
      const delta = new THREE.Quaternion().setFromUnitVectors(fwd, dir);
      // limita o giro
      const ang = 2 * Math.acos(clamp(delta.w, -1, 1));
      const maxA = 1.9;
      if (ang > maxA) delta.slerp(new THREE.Quaternion(), 1 - maxA / ang);
      const target = new THREE.Quaternion().slerpQuaternions(new THREE.Quaternion(), delta, w * k).multiply(wq);
      const pq = bone.parent.getWorldQuaternion(new THREE.Quaternion()).invert();
      bone.quaternion.copy(pq.multiply(target));
      bone.updateMatrixWorld(true);
    }
  }

  // Direcao que a cabeca realmente persegue: o alvo, mas dentro do que um pescoco alcanca (~100 graus para cada lado do corpo, ~50 para cima/baixo).
  // Com o olhar fixo permanente ela anda de costas para o jogador o tempo todo: a direcao "exatamente atras" e ambigua e a cabeca pularia de um ombro
  // para o outro. Entao: ao olhar por cima do ombro o lado so troca depois de o alvo passar bem do outro lado, e o giro tem velocidade maxima.
  _aimDirection(dir) {
    const A = this._aim || (this._aim = { yaw: 0, pitch: 0, side: 1 });
    const by = this.group.rotation.y, c = Math.cos(by), sn = Math.sin(by);
    const lx = dir.x * c - dir.z * sn, lz = dir.x * sn + dir.z * c;          // alvo no referencial do corpo
    const e = Math.atan2(lx, lz), pitch = clamp(Math.atan2(dir.y, Math.hypot(lx, lz)), -0.9, 0.9);
    const MAXYAW = 1.75;
    let want = e;
    if (Math.abs(e) > MAXYAW) {
      const exactlyBehind = Math.abs(e) > Math.PI - 0.45;                      // faixa estreita atras do corpo: mantem o ombro de antes
      want = (exactlyBehind ? A.side : Math.sign(e)) * MAXYAW;
    } else if (e !== 0) A.side = Math.sign(e);
    const dt = this._dt || 1 / 60, step = 8 * dt;                              // no maximo ~460 graus/s: a cabeca nunca "teleporta"
    A.yaw += clamp(want - A.yaw, -step, step); A.pitch += clamp(pitch - A.pitch, -step, step);
    const cp = Math.cos(A.pitch), fx = Math.sin(A.yaw) * cp, fz = Math.cos(A.yaw) * cp;
    return new THREE.Vector3(fx * c + fz * sn, Math.sin(A.pitch), -fx * sn + fz * c);   // de volta ao mundo
  }

  headWorld(out = new THREE.Vector3()) {
    if (this.guardian) return this.guardian.headWorld(out);
    return this.bones.Head.localToWorld(out.set(0, 0.05, 0.06));
  }
  chestWorld(out = new THREE.Vector3()) {
    if (this.guardian) return this.guardian.chestWorld(out);
    return this.bones.Chest.localToWorld(out.set(0, 0.12, 0.05));
  }
}
