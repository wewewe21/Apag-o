// Adaptador visual SOMA -> Mixamo. Os offsets, pesos e inversas do FBX nunca
// recebem o alongamento do corpo antigo; transfere orientacoes e movimento da raiz.
import * as THREE from 'three';
import { GuardianMotion } from './guardian-motion.js';
import { SkinwalkerMotion } from './skinwalker-motion.js';

const canonical = name => name.replace(/^.*mixamorig[:_]?/i, '').replace(/[:_]/g, '');
const MAP = {
  Hips: 'Hips', Spine: 'Spine1', Spine1: 'Spine2', Spine2: 'Chest',
  Neck: 'Neck2', Head: 'Head', JawDowm: 'Jaw', LeftEye: 'LeftEye', RightEye: 'RightEye',
};
for (const side of ['Left', 'Right']) {
  for (const limb of ['Shoulder', 'Arm', 'ForeArm', 'Hand', 'Foot', 'ToeBase']) MAP[side + limb] = side + limb;
  MAP[side + 'UpLeg'] = side + 'Leg'; MAP[side + 'Leg'] = side + 'Shin';
}
const CHILD = {
  Spine: ['Spine1', 'Spine2'], Spine1: ['Spine2', 'Chest'], Spine2: ['Neck', 'Neck1'],
  Neck: ['Head', 'Head'],
};
for (const side of ['Left', 'Right']) {
  CHILD[side + 'Shoulder'] = [side + 'Arm', side + 'Arm'];
  CHILD[side + 'Arm'] = [side + 'ForeArm', side + 'ForeArm'];
  CHILD[side + 'ForeArm'] = [side + 'Hand', side + 'Hand'];
  CHILD[side + 'Hand'] = [side + 'HandMiddle1', side + 'HandMiddleEnd'];
  CHILD[side + 'UpLeg'] = [side + 'Leg', side + 'Shin'];
  CHILD[side + 'Leg'] = [side + 'Foot', side + 'Foot'];
  CHILD[side + 'Foot'] = [side + 'ToeBase', side + 'ToeBase'];
}
const SIDES = ['Left', 'Right'], DIGITS = ['Thumb', 'Index', 'Middle', 'Ring', 'Pinky'];
const ARM_BONES = ['Arm', 'ForeArm'], FINGER_JOINT_WEIGHT = [0, 0.72, 1, 0.82];
const HEAVY_JOINT_WEIGHT = [0, 0.5, 1.1, 0.85], HEAVY_DIGIT_WEIGHT = [0.56, 0.84, 1, 1.06, 1.13];
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const DIRECTIONS = [];
for (let x = -1; x <= 1; x++) for (let y = -1; y <= 1; y++) for (let z = -1; z <= 1; z++) {
  if (x || y || z) DIRECTIONS.push(new THREE.Vector3(x, y, z).normalize());
}

// Closest points on two finite segments, including coincident/zero-length ones.
// The outputs are owned scratch vectors; no frame allocations are required.
function closestSegments(p1, q1, p2, q2, out1, out2, scratch) {
  const [d1, d2, r] = scratch;
  d1.subVectors(q1, p1); d2.subVectors(q2, p2); r.subVectors(p1, p2);
  const a = d1.lengthSq(), e = d2.lengthSq(), f = d2.dot(r);
  let s = 0, t = 0;
  if (a < 1e-12 && e < 1e-12) { out1.copy(p1); out2.copy(p2); return; }
  if (a < 1e-12) t = clamp(f / e, 0, 1);
  else {
    const c = d1.dot(r);
    if (e < 1e-12) s = clamp(-c / a, 0, 1);
    else {
      const b = d1.dot(d2), den = a * e - b * b;
      if (den > 1e-12) s = clamp((b * f - c * e) / den, 0, 1);
      t = (b * s + f) / e;
      if (t < 0) { t = 0; s = clamp(-c / a, 0, 1); }
      else if (t > 1) { t = 1; s = clamp((b - c) / a, 0, 1); }
    }
  }
  out1.copy(p1).addScaledVector(d1, s); out2.copy(p2).addScaledVector(d2, t);
}

export class GuardianRig {
  constructor(sourceRig, sourceBones, targetRoot, skeletonData) {
    this.sourceRig = sourceRig; this.sourceBones = sourceBones; this.root = targetRoot;
    if (!targetRoot.parent) sourceRig.add(targetRoot);
    this.bones = {}; this.bind = new Map(); this.entries = []; this.fingers = [];
    this.supportSamples = []; this.skinSamples = []; this.eyeGlows = [];
    this.profile = targetRoot.userData.guardianAsset?.profile ?? 'guardian';
    this.metrics = { beforeClearance: 0, afterClearance: 0, maxCorrection: 0, corrections: 0, supportSamples: 0 };
    this._v = Array.from({ length: 18 }, () => new THREE.Vector3());
    this._segmentScratch = this._v.slice(4, 7);
    this._q = Array.from({ length: 8 }, () => new THREE.Quaternion());
    this._rigInv = new THREE.Matrix4();
    this._rigQ = new THREE.Quaternion(); this._rigQInv = new THREE.Quaternion();
    this._curl = 0.25; this._clip = 'idle';
    sourceRig.updateWorldMatrix(true, false);
    // SkinnedMesh updates its attached bind inverse in updateMatrixWorld,
    // not in Object3D.updateWorldMatrix. Flush after parenting/scaling before
    // measuring any actual skin vertex (otherwise its parent scale doubles).
    sourceRig.updateMatrixWorld(true); this._captureRigTransform();
    targetRoot.traverse(o => { if (o.isBone) this.bones[canonical(o.name)] = o; });
    for (const [name, bone] of Object.entries(this.bones)) {
      this.bind.set(name, { position: bone.position.clone(), quaternion: bone.quaternion.clone(),
        rigPosition: this._rigPoint(bone, new THREE.Vector3()), rigQuaternion: this._rigQuaternion(bone, new THREE.Quaternion()) });
    }
    const offsets = new Map(skeletonData.names.map((name, i) => [name, new THREE.Vector3().fromArray(skeletonData.offsets[i])]));
    for (const [name, sourceName] of Object.entries(MAP)) {
      const bone = this.bones[name], source = sourceBones[sourceName];
      if (!bone || !source) continue;
      const correction = new THREE.Quaternion(), pair = CHILD[name];
      if (pair && this.bind.has(pair[0]) && offsets.has(pair[1])) {
        const targetDir = this.bind.get(pair[0]).rigPosition.clone().sub(this.bind.get(name).rigPosition).normalize();
        // Both skeletons reference +Z front. FBX's local +Y limbs are not SOMA's
        // local +/-X arms: align the actual bind directions before transferring.
        correction.setFromUnitVectors(targetDir, offsets.get(pair[1]).clone().normalize());
      }
      correction.multiply(this.bind.get(name).rigQuaternion);
      this.entries.push({ name, bone, source, correction });
    }
    // Parent-before-child order makes the local reconstruction deterministic.
    const depth = b => { let n = 0; while (b && b !== targetRoot) { n++; b = b.parent; } return n; };
    this.entries.sort((a, b) => depth(a.bone) - depth(b.bone));
    this._sourceHipRest = offsets.get('Hips')?.clone() ?? new THREE.Vector3(0, 0.988, 0);
    this._hipRatio = (this.bind.get('Hips')?.rigPosition.y ?? 0.99) / this._sourceHipRest.y;
    this._initFingers(); this._initSkinProbes(); this._initEyeGlow();
    this._headAnchor = this._skinAnchor('Head'); this._chestAnchor = this._skinAnchor('Spine2');
    this._capsules = [
      ['Hips', 'Spine1', 0.100], ['Spine1', 'Neck', 0.132],
      ['LeftUpLeg', 'LeftLeg', 0.063], ['LeftLeg', 'LeftFoot', 0.047],
      ['RightUpLeg', 'RightLeg', 0.063], ['RightLeg', 'RightFoot', 0.047],
    ].filter(([a, b]) => this.bones[a] && this.bones[b]).map(([a, b, radius]) => ({ a, b, radius,
      p: new THREE.Vector3(), q: new THREE.Vector3() }));
    this._armBase = new Map();
    for (const side of SIDES) for (const name of ARM_BONES) this._armBase.set(side + name, new THREE.Quaternion());
    this.motion = this.profile === 'skinwalker' ? new SkinwalkerMotion(this, skeletonData) : new GuardianMotion(this);
    this.strideScale = this.motion.strideScale ?? 1;
    if (targetRoot.userData.guardianAsset) targetRoot.userData.guardianAsset.strideScale = this.strideScale;
    this._armRadius = 0.035;
  }

  _captureRigTransform() {
    this._rigInv.copy(this.sourceRig.matrixWorld).invert();
    this.sourceRig.getWorldQuaternion(this._rigQ); this._rigQInv.copy(this._rigQ).invert();
  }
  _rigPoint(bone, out) { return bone.getWorldPosition(out).applyMatrix4(this._rigInv); }
  _rigQuaternion(bone, out) { bone.getWorldQuaternion(out); return out.premultiply(this._rigQInv); }
  _setRigQuaternion(bone, quaternion) {
    this._rigQuaternion(bone.parent, this._q[6]).invert();
    bone.quaternion.copy(this._q[6]).multiply(quaternion).normalize();
    // Descendants are updated together after retarget; during separation their
    // getWorldPosition calls update only the needed ancestor chain.
    bone.updateWorldMatrix(false, false);
  }

  _initFingers() {
    for (const side of SIDES) {
      const hand = this.bind.get(side + 'Hand'), middle = this.bind.get(side + 'HandMiddle1'), index = this.bind.get(side + 'HandIndex1'), pinky = this.bind.get(side + 'HandPinky1');
      if (!hand || !middle) continue;
      const extension = middle.rigPosition.clone().sub(hand.rigPosition).normalize();
      // Across the real knuckles establishes the palm plane. Its sign is
      // selected toward the underside (-Y in this model's T bind pose).
      const across = index && pinky ? index.rigPosition.clone().sub(pinky.rigPosition).normalize() : new THREE.Vector3(0, 0, 1);
      const palm = new THREE.Vector3().crossVectors(extension, across).normalize();
      if (palm.y > 0) palm.negate();
      if (palm.lengthSq() < 0.5) palm.set(0, -1, 0);
      for (let digit = 0; digit < DIGITS.length; digit++) for (let joint = 1; joint <= 3; joint++) {
        const name = side + 'Hand' + DIGITS[digit] + joint, bone = this.bones[name], b = this.bind.get(name), next = this.bind.get(side + 'Hand' + DIGITS[digit] + (joint + 1));
        if (!bone || !next) continue;
        const dir = next.rigPosition.clone().sub(b.rigPosition).normalize();
        const toward = palm.clone();
        if (digit === 0) toward.add(middle.rigPosition.clone().sub(b.rigPosition).normalize().multiplyScalar(0.45)).normalize();
        const axis = new THREE.Vector3().crossVectors(dir, toward).normalize().applyQuaternion(b.rigQuaternion.clone().invert());
        const spreadAxis = palm.clone().applyQuaternion(b.rigQuaternion.clone().invert());
        this.fingers.push({ bone, bind: b.quaternion, axis, spreadAxis, digit, joint, side: side === 'Left' ? 1 : -1 });
      }
    }
  }

  _initSkinProbes() {
    this.root.traverse(mesh => {
      if (!mesh.isSkinnedMesh) return;
      const weights = mesh.geometry.getAttribute('skinWeight'), indices = mesh.geometry.getAttribute('skinIndex');
      const position = mesh.geometry.getAttribute('position');
      if (!weights || !indices || !position) return;
      const groups = new Map();
      for (let i = 0; i < position.count; i++) {
        let dominant = -1, maxW = 0, secondary = -1, secondaryW = 0, supportWeight = 0;
        for (let k = 0; k < 4; k++) {
          const w = weights.getComponent(i, k), j = indices.getComponent(i, k);
          if (w > maxW) { secondary=dominant;secondaryW=maxW;dominant = j; maxW = w; }
          else if(w>secondaryW){secondary=j;secondaryW=w;}
          if (/^(Left|Right)(Hand|Foot|Toe)/.test(canonical(mesh.skeleton.bones[j]?.name ?? ''))) supportWeight += w;
        }
        const bone = mesh.skeleton.bones[dominant], name = canonical(bone?.name ?? '');
        const support = supportWeight >= 0.7 && /^(Left|Right)(Hand|Foot|Toe)/.test(name);
        if (!support && this.profile !== 'skinwalker') continue;
        if (maxW < 0.35 || !bone) continue;
        mesh.getVertexPosition(i, this._v[0]); mesh.localToWorld(this._v[0]); bone.worldToLocal(this._v[0]);
        // Vertices blending a different neighbour deform differently even
        // when their dominant bone matches. Freeze extrema per influence pair
        // so mixed clavicle/neck skin cannot escape a dominant-only envelope.
        let group=this.profile==='skinwalker' && secondaryW>0.10 ? name+'|'+secondary : name;
        if(this.profile==='skinwalker' && /Arm|Leg|Hand|Foot|Toe|Neck/.test(name)) {
          const child=bone.children.find(o=>o.isBone),length=child?.position.length()??10;
          // A long limb can cross a thin leaf while both extrema are outside.
          // Longitudinal skin slices retain real interior surface samples,
          // including the long digit/nail shafts; endpoints alone cannot pass.
          const slice=clamp(Math.floor(this._v[0].y/Math.max(length*0.25,0.001)),-2,5);
          group+='@'+slice;
        }
        if (!groups.has(group)) groups.set(group, DIRECTIONS.map(() => ({ score: -Infinity, index: -1 })));
        const records = groups.get(group);
        for (let d = 0; d < DIRECTIONS.length; d++) {
          const score = this._v[0].dot(DIRECTIONS[d]);
          if (score > records[d].score) { records[d].score = score; records[d].index = i; }
        }
      }
      const selected = new Set();
      for (const records of groups.values()) for (const r of records) if (r.index >= 0) selected.add(r.index);
      for (const index of selected) {
        let dominant = -1, maxW = 0, supportWeight = 0;
        for (let k = 0; k < 4; k++) {
          const w = weights.getComponent(index, k), j = indices.getComponent(index, k);
          if (w > maxW) { dominant = j; maxW = w; }
          if (/^(Left|Right)(Hand|Foot|Toe)/.test(canonical(mesh.skeleton.bones[j]?.name ?? ''))) supportWeight += w;
        }
        const name = canonical(mesh.skeleton.bones[dominant]?.name ?? ''), sample = { mesh, index, bone: name };
        if(this.profile==='skinwalker' && mesh.bindMode==='attached' && !mesh.geometry.morphAttributes.position?.length) {
          sample.influences=[];
          const vertex=new THREE.Vector3().fromBufferAttribute(position,index).applyMatrix4(mesh.bindMatrix);
          for(let k=0;k<4;k++) {
            const weight=weights.getComponent(index,k);if(weight<=0)continue;
            const j=indices.getComponent(index,k);
            sample.influences.push({bone:mesh.skeleton.bones[j],weight,point:vertex.clone().applyMatrix4(mesh.skeleton.boneInverses[j])});
          }
        }
        if (supportWeight >= 0.7 && /^(Left|Right)(Hand|Foot|Toe)/.test(name)) this.supportSamples.push(sample);
        if (this.profile === 'skinwalker') this.skinSamples.push(sample);
      }
    });
    this.metrics.supportSamples = this.supportSamples.length;
  }

  _skinAnchor(name) {
    const bone = this.bones[name];
    if (!bone) return { bone: this.root, position: new THREE.Vector3(0, name === 'Head' ? 1.6 : 1.25, 0) };
    const bounds = new THREE.Box3(), p = new THREE.Vector3();
    this.root.traverse(mesh => {
      if (!mesh.isSkinnedMesh) return;
      const weights = mesh.geometry.getAttribute('skinWeight'), indices = mesh.geometry.getAttribute('skinIndex'), count = weights?.count ?? 0;
      for (let i = 0; i < count; i++) {
        let weight = 0;
        for (let k = 0; k < 4; k++) if (mesh.skeleton.bones[indices.getComponent(i, k)] === bone) weight += weights.getComponent(i, k);
        if (weight < 0.7) continue;
        mesh.getVertexPosition(i, p); mesh.localToWorld(p); bone.worldToLocal(p); bounds.expandByPoint(p);
      }
    });
    return { bone, position: bounds.isEmpty() ? new THREE.Vector3() : bounds.getCenter(new THREE.Vector3()) };
  }

  _initEyeGlow() {
    for (const side of SIDES) {
      const bone = this.bones[side + 'Eye']; if (!bone) continue;
      const scale = bone.getWorldScale(this._v[0]).x / this.sourceRig.getWorldScale(this._v[1]).x;
      const material = new THREE.MeshBasicMaterial({ color: 0xe0ffb0, transparent: true, opacity: 0,
        depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false });
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.0045 / scale, 8, 6), material);
      eye.name = 'GuardiaoEyeGlow'; eye.position.z = 0.007 / scale;
      eye.visible = false; eye.frustumCulled = false; bone.add(eye); this.eyeGlows.push(eye);
    }
  }

  update(dt, time, state = {}) {
    const { clip = 'idle', shield = 0, jawOpen = 0.2, eyeshine = 0, burnGlow = 0, heavy = false } = state;
    this._armRadius = heavy ? this.motion.body.armRadius : 0.035;
    for (const cap of this._capsules) cap.radius = heavy ? cap.heavyRadius : cap.baseRadius;
    this._clip = clip; this.sourceRig.updateWorldMatrix(true, true); this._captureRigTransform();
    // Reset immutable bind-local values first, including unused tips and jawUp.
    // Repeated calls at one sampled time therefore never compound rotations.
    for (const [name, b] of this.bind) {
      this.bones[name].position.copy(b.position); this.bones[name].quaternion.copy(b.quaternion);
    }
    this.root.updateWorldMatrix(false, true);
    const hips = this.bones.Hips, hipBind = this.bind.get('Hips');
    if (hips && this.sourceBones.Hips) {
      this._v[0].copy(this.sourceBones.Hips.position).sub(this._sourceHipRest).multiplyScalar(this._hipRatio).add(hipBind.rigPosition);
      this._v[0].applyMatrix4(this.sourceRig.matrixWorld); hips.parent.worldToLocal(this._v[0]); hips.position.copy(this._v[0]);
      hips.updateWorldMatrix(false, true);
    }
    for (const e of this.entries) {
      this._rigQuaternion(e.source, this._q[0]).multiply(e.correction);
      this._setRigQuaternion(e.bone, this._q[0]);
    }
    this.motion.apply(dt, time, state);
    // Source Jaw already carries the original mouth envelope. The optional
    // parameter is retained for callers, never layered on that envelope twice.
    void jawOpen;
    const stateCurl = clip === 'crawl' ? 0.06 : clip === 'attack' ? 0.50 : clip === 'run' ? 0.43 : clip === 'pain' || clip === 'recoil' ? 0.38 : /walk|stalk|creep|limp/.test(clip) ? 0.31 : clip === 'roar' ? 0.40 : 0.24;
    const heavyCurl = clip === 'crawl' ? 0.10 : clip === 'attack' ? 0.78 : clip === 'run' ? 0.70 : clip === 'pain' || clip === 'recoil' ? 0.53 : /walk|stalk|creep|limp/.test(clip) ? 0.58 : clip === 'roar' ? 0.75 : 0.50;
    const guard = clip === 'shield' ? 1 : clamp(shield, 0, 1);
    const skinwalker = this.profile === 'skinwalker';
    const still = clip === 'idle' || clip === 'look';      // parada: dedos longos, retos e bem abertos (entidade), nao garra caida de zumbi
    const skinCurl = clip === 'attack' ? 0.32 : clip === 'pain' || clip === 'recoil' ? 0.23 : clip === 'crawl' ? 0.035 : clip === 'run' ? 0.16 : still ? 0.04 : 0.10;
    const wantCurl = skinwalker ? skinCurl * (1 - guard) + 0.025 * guard : (heavy ? heavyCurl : stateCurl) * (1 - guard) + (heavy ? 0.04 : 0.10) * guard;
    this._curl += (wantCurl - this._curl) * (1 - Math.exp(-Math.max(0, dt) * 12));
    for (const f of this.fingers) {
      const pulse = Math.sin(time * (skinwalker ? 1.71 : heavy ? 1.35 : clip === 'run' ? 5.1 : 2.15) + f.digit * 1.07 + f.side * 0.93) * (clip === 'crawl' ? 0.012 : skinwalker ? 0.036 : heavy ? 0.028 : 0.045);
      const jointWeight = skinwalker ? [0,0.42,0.82,1.02][f.joint] : heavy ? HEAVY_JOINT_WEIGHT[f.joint] : FINGER_JOINT_WEIGHT[f.joint];
      const digitWeight = skinwalker ? [0.52,0.86,1,1.12,1.22][f.digit] : heavy ? HEAVY_DIGIT_WEIGHT[f.digit] : f.digit === 0 ? 0.62 : 1;
      const curl = clamp(this._curl + pulse + (f.digit === 4 ? 0.045 : 0), 0.018, heavy ? 1.08 : 0.62) * digitWeight * jointWeight;
      f.bone.quaternion.copy(f.bind).multiply(this._q[1].setFromAxisAngle(f.axis, curl));
      if (f.joint === 1 && f.digit > 0) f.bone.quaternion.multiply(this._q[1].setFromAxisAngle(f.spreadAxis, (f.digit - 2.5) * (skinwalker ? (still ? 0.1 : 0.055) : heavy ? 0.065 : 0.023) * (1 - this._curl * (heavy ? 0.5 : 1))));
    }
    this.root.updateWorldMatrix(false, true);
    this.metrics.beforeClearance = this.measureClearance(); this.metrics.maxCorrection = 0; this.metrics.corrections = 0;
    for (const side of SIDES) for (const name of ARM_BONES) {
      const bone = this.bones[side + name]; if (bone) this._armBase.get(side + name).copy(bone.quaternion);
    }
    this._separateArms(); this.metrics.afterClearance = this.measureClearance();
    this.motion.resolveEnvironment?.(state);
    const glow = clamp(eyeshine + burnGlow, 0, 1.5);
    for (const eye of this.eyeGlows) {
      eye.visible = glow > 0.005; eye.material.opacity = clamp(glow, 0, 1);
      eye.material.color.setRGB(1, 1 - burnGlow * 0.6, Math.max(0.05, 0.6 - burnGlow * 0.5));
    }
  }

  ground(dt, floorY = 0, state = {}) { this.motion.ground(dt, floorY, state); }
  resetMotion() { this.motion.reset(); }

  // Cached extrema are selected from actual weighted skin in every bone's bind
  // space. Callers may inspect them without replacing the authoritative binds.
  skinBounds(region = /./, out = new THREE.Box3()) {
    this.root.updateMatrixWorld(true); out.makeEmpty();
    for (const sample of this.skinSamples) {
      if (!region.test(sample.bone)) continue;
      this.sampleSkinWorld(sample,this._v[0]); out.expandByPoint(this._v[0]);
    }
    return out;
  }

  sampleSkinWorld(sample,out=new THREE.Vector3()) {
    if(!sample.influences){sample.mesh.getVertexPosition(sample.index,out);return sample.mesh.localToWorld(out);}
    // In attached mode meshWorld * bindMatrixInverse is identity. Immutable
    // bind-space influence points let probes evaluate the exact same LBS with
    // fewer repeated attribute/matrix operations; dense mesh QA stays separate.
    let x=0,y=0,z=0;
    for(const influence of sample.influences) {
      const e=influence.bone.matrixWorld.elements,p=influence.point,w=influence.weight;
      x+=(e[0]*p.x+e[4]*p.y+e[8]*p.z+e[12])*w;
      y+=(e[1]*p.x+e[5]*p.y+e[9]*p.z+e[13])*w;
      z+=(e[2]*p.x+e[6]*p.y+e[10]*p.z+e[14])*w;
    }
    return out.set(x,y,z);
  }

  _refreshCapsules() {
    for (const cap of this._capsules) { this._rigPoint(this.bones[cap.a], cap.p); this._rigPoint(this.bones[cap.b], cap.q); }
  }
  measureClearance() {
    this._refreshCapsules(); let clearance = Infinity;
    for (const side of SIDES) {
      const elbow = this.bones[side + 'ForeArm'], hand = this.bones[side + 'Hand']; if (!elbow || !hand) continue;
      this._rigPoint(elbow, this._v[0]); this._rigPoint(hand, this._v[1]);
      for (const cap of this._capsules) {
        closestSegments(this._v[0], this._v[1], cap.p, cap.q, this._v[2], this._v[3], this._segmentScratch);
        clearance = Math.min(clearance, this._v[2].distanceTo(this._v[3]) - cap.radius - this._armRadius);
      }
    }
    return clearance;
  }

  _separateArms() {
    this._refreshCapsules();
    for (let iteration = 0; iteration < 4; iteration++) for (const side of SIDES) {
      const arm = this.bones[side + 'Arm'], elbow = this.bones[side + 'ForeArm'], hand = this.bones[side + 'Hand'];
      if (!arm || !elbow || !hand) continue;
      const sign = side === 'Left' ? 1 : -1;
      for (const cap of this._capsules) {
        this._rigPoint(elbow, this._v[0]); this._rigPoint(hand, this._v[1]);
        closestSegments(this._v[0], this._v[1], cap.p, cap.q, this._v[2], this._v[3], this._segmentScratch);
        const distance = this._v[2].distanceTo(this._v[3]), required = cap.radius + this._armRadius + 0.008;
        if (distance >= required) continue;
        const away = this._v[7].subVectors(this._v[2], this._v[3]);
        away.y *= 0.15;
        if (away.lengthSq() < 1e-8) away.set(sign, 0, 0.3);
        // When an arm has crossed the centre plane, push it back to its own
        // side rather than making the crossing worse. Keep crawl height.
        if (away.x * sign < 0 && Math.abs(away.x) > Math.abs(away.z) * 0.8) away.x = Math.abs(away.x) * sign;
        away.normalize();
        const target = this._v[8].copy(this._v[2]).addScaledVector(away, required - distance);
        this._rotatePointAway(arm, this._v[2], target, 0.46, side + 'Arm');
        // A short forearm adjustment completes the clearance without changing
        // the shoulder/clavicle or replacing the authored reach animation.
        this._rigPoint(hand, this._v[9]);
        this._v[10].copy(this._v[9]).addScaledVector(away, (required - distance) * 0.35);
        this._rotatePointAway(elbow, this._v[9], this._v[10], 0.32, side + 'ForeArm');
      }
    }
  }

  _rotatePointAway(bone, point, target, budget, key) {
    this._rigPoint(bone, this._v[11]);
    this._v[12].subVectors(point, this._v[11]); this._v[13].subVectors(target, this._v[11]);
    if (this._v[12].lengthSq() < 1e-8 || this._v[13].lengthSq() < 1e-8) return;
    this._q[2].setFromUnitVectors(this._v[12].normalize(), this._v[13].normalize());
    const angle = this._q[2].angleTo(this._q[3].identity());
    if (angle > 0.12) this._q[2].slerp(this._q[3], 1 - 0.12 / angle);
    this._rigQuaternion(bone, this._q[4]); this._q[4].premultiply(this._q[2]);
    this._setRigQuaternion(bone, this._q[4]);
    const baseline = this._armBase.get(key), total = baseline.angleTo(bone.quaternion);
    if (total > budget) { bone.quaternion.slerpQuaternions(baseline, bone.quaternion, budget / total); bone.updateWorldMatrix(false, true); }
    this.metrics.maxCorrection = Math.max(this.metrics.maxCorrection, Math.min(total, budget)); this.metrics.corrections++;
  }

  supportY() {
    this.root.updateWorldMatrix(true, false); this.root.updateMatrixWorld(true); let min = Infinity;
    for (const sample of this.supportSamples) {
      this.sampleSkinWorld(sample,this._v[0]); min = Math.min(min, this._v[0].y);
    }
    if (Number.isFinite(min)) return min;
    // Geometry-free rigs are useful in tests. Real FBX always uses skin probes.
    for (const side of SIDES) for (const name of ['Foot', 'ToeBase', 'Hand']) {
      const bone = this.bones[side + name]; if (bone) min = Math.min(min, bone.getWorldPosition(this._v[0]).y);
    }
    return min;
  }
  headWorld(out = new THREE.Vector3()) { return this._headAnchor.bone.localToWorld(out.copy(this._headAnchor.position)); }
  chestWorld(out = new THREE.Vector3()) { return this._chestAnchor.bone.localToWorld(out.copy(this._chestAnchor.position)); }
}
