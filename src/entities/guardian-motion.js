// Performance shaping for Guardiao's authored body. Kimodo remains the motion
// source; this pass resolves its human skeleton against the actual FBX limbs.
// All lengths, directions and sole samples come from the model's bind skin.
import * as THREE from 'three';

const SIDES = ['Left', 'Right'];
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const LOCOMOTION = /^(walk|run|stalk|creep|limp)$/;
const smooth = (v, target, dt, speed) => v + (target - v) * (1 - Math.exp(-Math.max(0, dt) * speed));
const ease = v => { const t = clamp(v, 0, 1); return t * t * (3 - 2 * t); };
const canonical = name => name.replace(/^.*mixamorig[:_]?/i, '').replace(/[:_]/g, '');

export class GuardianMotion {
  constructor(adapter) {
    this.rig = adapter; this.bones = adapter.bones;
    this._v = Array.from({ length: 24 }, () => new THREE.Vector3());
    this._q = Array.from({ length: 8 }, () => new THREE.Quaternion());
    this._rootPosition = new THREE.Vector3(); this._rootQuaternion = new THREE.Quaternion();
    this._previousRoot = new THREE.Vector3(); this._previousRootQ = new THREE.Quaternion();
    this._hasPreviousRoot = false; this._active = false; this._clip = '';
    this._mass = { sway: 0, compression: 0, lastLeft: 0, lastRight: 0 };
    this.legs = {}; this.arms = {}; this.feet = {};
    const bind = adapter.bind;
    for (const side of SIDES) {
      const thigh = bind.get(side + 'UpLeg'), knee = bind.get(side + 'Leg'), ankle = bind.get(side + 'Foot');
      const shoulder = bind.get(side + 'Arm'), elbow = bind.get(side + 'ForeArm'), wrist = bind.get(side + 'Hand');
      if (thigh && knee && ankle) this.legs[side] = { upper: thigh.rigPosition.distanceTo(knee.rigPosition), lower: knee.rigPosition.distanceTo(ankle.rigPosition) };
      if (shoulder && elbow && wrist) this.arms[side] = { upper: shoulder.rigPosition.distanceTo(elbow.rigPosition), lower: elbow.rigPosition.distanceTo(wrist.rigPosition) };
      const hand = bind.get(side + 'Hand'), middle = bind.get(side + 'HandMiddle1');
      if (hand && middle) this.arms[side].handDirection = middle.rigPosition.clone().sub(hand.rigPosition).normalize();
      this.feet[side] = { samples: [], active: false, exhausted: false, weight: 0, target: new THREE.Vector3(), quaternion: new THREE.Quaternion(), toeQuaternion: new THREE.Quaternion(), last: new THREE.Vector3(), slip: 0, error: 0 };
    }
    // Separate real weighted foot/toe probes from hand support. No borrowed
    // ankle height can guarantee where this creature's large soles touch.
    for (const sample of adapter.supportSamples) {
      const indices = sample.mesh.geometry.getAttribute('skinIndex'), weights = sample.mesh.geometry.getAttribute('skinWeight');
      let dominant = -1, weight = 0;
      for (let k = 0; k < 4; k++) if (weights.getComponent(sample.index, k) > weight) {
        weight = weights.getComponent(sample.index, k); dominant = indices.getComponent(sample.index, k);
      }
      const name = canonical(sample.mesh.skeleton.bones[dominant]?.name ?? '');
      for (const side of SIDES) if (name.startsWith(side + 'Foot') || name.startsWith(side + 'Toe')) this.feet[side].samples.push(sample);
    }
    const torso = bind.get('Spine2'), l = bind.get('LeftArm'), r = bind.get('RightArm');
    this.body = {
      shoulderWidth: l && r ? l.rigPosition.distanceTo(r.rigPosition) : 0.42,
      hipWidth: bind.get('LeftUpLeg').rigPosition.distanceTo(bind.get('RightUpLeg').rigPosition),
      height: adapter.root.userData.guardianAsset?.height ?? 1.75,
      chestHeight: torso?.rigPosition.y ?? 1.28,
    };
    this._measureRadii();
    this.metrics = { heavy: false, stance: 0, elbows: 0, planted: 0, maxSlip: 0, soleError: 0, ikReachClamp: 0, armDeflection: 0 };
  }

  _measureRadii() {
    const regions = new Map();
    for (const cap of this.rig._capsules) {
      cap.baseRadius = cap.radius; cap.heavyRadius = cap.radius;
      const names = cap.a === 'Hips' ? ['Hips', 'Spine'] : cap.a === 'Spine1' ? ['Spine1', 'Spine2'] : [cap.a];
      for (const name of names) regions.set(name, cap);
    }
    let armRadius = 0.035;
    this.rig.root.traverse(mesh => {
      if (!mesh.isSkinnedMesh) return;
      const weights = mesh.geometry.attributes.skinWeight, indices = mesh.geometry.attributes.skinIndex;
      for (let i = 0; i < weights.count; i++) {
        let dominant = 0, weight = 0;
        for (let k = 0; k < 4; k++) if (weights.getComponent(i, k) > weight) { weight = weights.getComponent(i, k); dominant = indices.getComponent(i, k); }
        if (weight < 0.7) continue;
        const name = canonical(mesh.skeleton.bones[dominant]?.name ?? ''), region = regions.get(name);
        const arm = /^(Left|Right)ForeArm$/.test(name);
        if (!region && !arm) continue;
        const a = region?.a ?? name, b = region?.b ?? name.replace('ForeArm', 'Hand');
        this._v[1].copy(this.rig.bind.get(a).rigPosition); this._v[2].copy(this.rig.bind.get(b).rigPosition);
        mesh.getVertexPosition(i, this._v[0]); mesh.localToWorld(this._v[0]); this._v[0].applyMatrix4(this.rig._rigInv);
        this._v[3].subVectors(this._v[2], this._v[1]); this._v[4].subVectors(this._v[0], this._v[1]);
        const t = clamp(this._v[4].dot(this._v[3]) / this._v[3].lengthSq(), 0, 1);
        this._v[4].copy(this._v[1]).addScaledVector(this._v[3], t);
        // Rounded capsules conservatively cover the dense central skin rather
        // than treating spiky extrema as a full solid cylinder around a joint.
        const radius = this._v[0].distanceTo(this._v[4]) * 0.82;
        if (region) region.heavyRadius = Math.max(region.heavyRadius, radius);
        if (arm) armRadius = Math.max(armRadius, radius);
      }
    });
    this.body.armRadius = armRadius;
    this.body.capsuleRadii = this.rig._capsules.map(cap => ({ a: cap.a, radius: cap.heavyRadius }));
  }

  reset() {
    for (const side of SIDES) { this.feet[side].active = false; this.feet[side].exhausted = false; this.feet[side].weight = 0; }
    this._hasPreviousRoot = false; this._clip = ''; this._mass.sway = 0; this._mass.compression = 0; this._mass.lastLeft = 0; this._mass.lastRight = 0;
  }

  apply(dt, time, state) {
    if (!state.heavy) { if (this._active) this.reset(); this._active = false; this.metrics.heavy = false; return; }
    this._active = true; this.metrics.heavy = true;
    if (state.clip !== this._clip) {
      for (const side of SIDES) { this.feet[side].active = false; this.feet[side].exhausted = false; }
      this._clip = state.clip;
    }
    const moving = LOCOMOTION.test(state.clip), crawl = state.clip === 'crawl';
    const contacts = state.contacts ?? { left: 0, right: 0 };
    const left = clamp(contacts.left ?? 0, 0, 1), right = clamp(contacts.right ?? 0, 0, 1);
    const support = left - right;
    // This is a restrained mass response, not another gait oscillator. The
    // generated hip weight shift remains intact, with a slow eight-mm settle.
    this._mass.sway = smooth(this._mass.sway, moving ? support * 0.008 : 0, dt, 5.5);
    // A native loop may contain several strides. Contact rise and double
    // support identify real landings; clip phase is not a synthetic step clock.
    const rise = Math.max(0, left - this._mass.lastLeft, right - this._mass.lastRight);
    const landing = dt > 0 ? clamp(rise / Math.max(dt * 4.5, 0.025), 0, 1) : 0;
    const settle = Math.min(left, right) * 0.005 + landing * 0.004;
    this._mass.compression = smooth(this._mass.compression, moving ? Math.min(0.008, settle) : 0, dt, 7);
    this._mass.lastLeft = left; this._mass.lastRight = right;
    if (!crawl && this.bones.Hips) {
      this.rig._rigPoint(this.bones.Hips, this._v[0]);
      this._v[0].x += this._mass.sway; this._v[0].y -= this._mass.compression;
      this._setRigPosition(this.bones.Hips, this._v[0]);
    }
    // Large shoulders move as a connected mass. Attenuate residual casual
    // chest swing without deleting authored recoil, roar or attack poses.
    const restraint = moving ? 0.80 : state.clip === 'idle' ? 0.88 : 1;
    for (const name of ['Spine', 'Spine1', 'Spine2']) {
      const bone = this.bones[name], bind = this.rig.bind.get(name);
      if (!bone || restraint === 1) continue;
      bone.quaternion.slerpQuaternions(bind.quaternion, bone.quaternion, restraint);
    }
    if (!crawl) {
      // A tiny uneven inhale communicates living weight without the old
      // stretched-neck bob/twitch. The hips and clavicles keep their skin bind.
      const spine = this.bones.Spine2;
      if (spine && /^(idle|walk|stalk|creep|limp)$/.test(state.clip)) {
        this._q[0].setFromAxisAngle(this._v[0].set(1, 0, 0), Math.sin(time * 0.85 + 0.35) * 0.008);
        spine.quaternion.multiply(this._q[0]);
      }
      this.rig.root.updateWorldMatrix(false, true);
      this._widenSupport(state, moving);
      this._shapeArms(time, state, moving);
    }
    this.rig.root.updateWorldMatrix(false, true);
    this.rig._rigPoint(this.bones.LeftFoot, this._v[0]); this.rig._rigPoint(this.bones.RightFoot, this._v[1]);
    this.metrics.stance = Math.abs(this._v[0].x - this._v[1].x);
    this.rig._rigPoint(this.bones.LeftForeArm, this._v[0]); this.rig._rigPoint(this.bones.RightForeArm, this._v[1]);
    this.metrics.elbows = Math.abs(this._v[0].x - this._v[1].x);
  }

  _setRigPosition(bone, point) {
    this._v[23].copy(point).applyMatrix4(this.rig.sourceRig.matrixWorld);
    bone.parent.worldToLocal(this._v[23]); bone.position.copy(this._v[23]); bone.updateWorldMatrix(false, true);
  }

  _aim(bone, child, direction, strength = 1, maxAngle = Math.PI) {
    this.rig._rigPoint(bone, this._v[17]); this.rig._rigPoint(child, this._v[18]);
    this._v[18].sub(this._v[17]).normalize(); this._v[19].copy(direction).normalize();
    this._q[0].setFromUnitVectors(this._v[18], this._v[19]);
    const angle = this._q[0].angleTo(this._q[1].identity());
    const amount = Math.min(strength, maxAngle / Math.max(angle, 1e-8));
    this._q[0].slerp(this._q[1], 1 - amount);
    this.rig._rigQuaternion(bone, this._q[2]); this._q[2].premultiply(this._q[0]);
    this.rig._setRigQuaternion(bone, this._q[2]); bone.updateWorldMatrix(false, true);
    return angle * amount;
  }

  _widenSupport(state, moving) {
    if (!moving && !/^(idle|look|inspect|roar|shield)$/.test(state.clip)) return;
    this.rig._rigPoint(this.bones.Hips, this._v[0]); const centerX = this._v[0].x;
    const width = this.body.hipWidth + this.body.shoulderWidth * (state.clip === 'run' ? 0.24 : 0.31);
    for (const side of SIDES) {
      const sign = side === 'Left' ? 1 : -1, ankle = this.bones[side + 'Foot'];
      ankle.getWorldQuaternion(this._q[7]);
      this.rig._rigPoint(ankle, this._v[1]);
      this._v[1].x = centerX + sign * Math.max(width * 0.5, (this._v[1].x - centerX) * sign);
      this._v[1].applyMatrix4(this.rig.sourceRig.matrixWorld);
      // Keep the generated fore/aft step and knee pole; only adapt stance width.
      this._solveLimb(side, false, this._v[1], null);
      this._setWorldQuaternion(ankle, this._q[7]);
    }
  }

  _shapeArms(time, state, moving) {
    const shield = clamp(state.shield ?? 0, 0, 1);
    const faceGuard = shield > 0.02 || state.clip === 'shield';
    const idle = /^(idle|look|inspect)$/.test(state.clip);
    const full = moving || idle;
    const intensity = full ? (state.pain ? 0.42 : 0.88) : state.clip === 'roar' ? 0.30 : 0.12;
    this.metrics.armDeflection = 0;
    for (const side of SIDES) {
      const sign = side === 'Left' ? 1 : -1;
      const upper = this.bones[side + 'Arm'], elbow = this.bones[side + 'ForeArm'], hand = this.bones[side + 'Hand'];
      if (!upper || !elbow || !hand) continue;
      if (faceGuard) {
        this.rig.headWorld(this._v[0]);
        const scale = this.rig.sourceRig.getWorldScale(this._v[1]).y;
        // Hands bracket the actual skull, instead of shielding the abdomen.
        this._v[2].set(sign * 0.085, -0.03 + (sign > 0 ? 0.025 : -0.025), 0.145).multiplyScalar(scale).applyQuaternion(this.rig._rigQ).add(this._v[0]);
        hand.getWorldPosition(this._v[3]); this._v[2].lerpVectors(this._v[3], this._v[2], state.clip === 'shield' ? 1 : shield);
        this.rig._rigPoint(upper, this._v[4]);
        this._v[5].copy(this._v[4]).add(this._v[6].set(sign * 0.20, 0.015, 0.085)).applyMatrix4(this.rig.sourceRig.matrixWorld);
        this._solveLimb(side, true, this._v[2], this._v[5]);
        this._aim(hand, this.bones[side + 'HandMiddle1'], this._v[0].set(sign * 0.10, 0.94, 0.32), shield > 0 ? shield : 1, 2.1);
        continue;
      }
      const attackGrab = state.clip === 'attack' ? ease(((state.phase ?? 0) - 0.10) / 0.16) * (1 - ease(((state.phase ?? 0) - 0.55) / 0.25)) : 0;
      if (attackGrab > 0.005) {
        // The native heavy lunge supplies torso/feet; fit its active grab to
        // this body's shorter, broad arms. Both claws reach the player instead
        // of one wrist curling over the face as a human-sized guard gesture.
        this.rig.chestWorld(this._v[0]); this._v[0].applyMatrix4(this.rig._rigInv);
        this.rig._rigPoint(upper, this._v[4]);
        this._v[2].set(this._v[0].x + sign * 0.145, this._v[0].y + 0.035 + sign * 0.012, this._v[4].z + (this.arms[side].upper + this.arms[side].lower) * 0.87);
        this.rig._rigPoint(hand, this._v[3]); this._v[2].lerpVectors(this._v[3], this._v[2], attackGrab).applyMatrix4(this.rig.sourceRig.matrixWorld);
        this._v[5].copy(this._v[4]).add(this._v[6].set(sign * 0.16, -0.02, 0.22)).applyMatrix4(this.rig.sourceRig.matrixWorld);
        this._solveLimb(side, true, this._v[2], this._v[5]);
        this._aim(hand, this.bones[side + 'HandMiddle1'], this._v[0].set(sign * 0.06, -0.12, 1), attackGrab, 2.2);
        this._protectReach(side, upper, hand);
        continue;
      }
      // Bent, broad upper arms carry the forearms clear of the dense torso.
      // Delayed low swing comes from the generated reach, not a mirrored sine.
      this.rig._rigPoint(elbow, this._v[0]); this.rig._rigPoint(hand, this._v[1]);
      const generatedFore = this._v[1].sub(this._v[0]).normalize();
      const reach = clamp(generatedFore.z, -0.48, 0.48);
      this._v[2].set(sign * (state.clip === 'run' ? 0.69 : 0.78), -1, 0.11 + reach * 0.20);
      this.metrics.armDeflection = Math.max(this.metrics.armDeflection, this._aim(upper, elbow, this._v[2], intensity, 0.85));
      this._v[2].set(sign * 0.34, -1, 0.28 + reach * 0.28 + (idle ? Math.sin(time * 0.64 + sign * 1.2) * 0.025 : 0));
      this._aim(elbow, hand, this._v[2], intensity * 0.78, 0.75);
      if (full) this._aim(hand, this.bones[side + 'HandMiddle1'], this._v[2].set(sign * 0.12, -1, 0.31), 0.58, 0.70);
      else {
        // Retargeted human grabs can fold the forearm into the larger chest.
        // Preserve the authored hand height/reach, but reserve real skin space
        // in front of the chest; an outward elbow pole keeps the arm readable.
        this._protectReach(side, upper, hand);
      }
    }
  }

  _protectReach(side, upper, hand) {
    const sign = side === 'Left' ? 1 : -1;
    this.rig._rigPoint(hand, this._v[0]); this.rig._rigPoint(this.bones.Spine2, this._v[1]);
    this.rig._rigPoint(upper, this._v[4]);
    const front = this._v[1].z + this.body.capsuleRadii[1].radius + this.body.armRadius + 0.014;
    if (this._v[0].y > this.body.chestHeight - 0.31 && this._v[0].y < this.body.chestHeight + 0.34 && Math.abs(this._v[0].x - this._v[1].x) < 0.25 && this._v[0].z < front) {
      this._v[0].z = front;
      this._v[0].x = this._v[1].x + sign * Math.max(0.105, (this._v[0].x - this._v[1].x) * sign);
      this._v[0].applyMatrix4(this.rig.sourceRig.matrixWorld);
      this._v[5].copy(this._v[4]).add(this._v[6].set(sign * 0.18, -0.035, 0.10)).applyMatrix4(this.rig.sourceRig.matrixWorld);
      this._solveLimb(side, true, this._v[0], this._v[5]);
    }
  }

  _setWorldQuaternion(bone, q) {
    bone.parent.getWorldQuaternion(this._q[6]).invert(); bone.quaternion.copy(this._q[6]).multiply(q).normalize(); bone.updateWorldMatrix(false, true);
  }

  _solveLimb(side, arm, target, pole) {
    const upper = this.bones[side + (arm ? 'Arm' : 'UpLeg')], lower = this.bones[side + (arm ? 'ForeArm' : 'Leg')], end = this.bones[side + (arm ? 'Hand' : 'Foot')];
    if (!upper || !lower || !end) return;
    upper.getWorldPosition(this._v[7]); lower.getWorldPosition(this._v[8]); end.getWorldPosition(this._v[9]);
    const lenA = this._v[7].distanceTo(this._v[8]), lenB = this._v[8].distanceTo(this._v[9]);
    this._v[10].subVectors(target, this._v[7]);
    const originalDistance = this._v[10].length(), distance = clamp(originalDistance, Math.abs(lenA - lenB) + 1e-5, (lenA + lenB) * 0.998);
    if (distance < 1e-5) return;
    this.metrics.ikReachClamp = Math.max(this.metrics.ikReachClamp, Math.abs(originalDistance - distance));
    this._v[10].normalize();
    this._v[11].copy(pole ?? this._v[8]).sub(this._v[7]);
    this._v[11].addScaledVector(this._v[10], -this._v[11].dot(this._v[10]));
    if (this._v[11].lengthSq() < 1e-8) {
      this._v[11].set(arm ? (side === 'Left' ? 1 : -1) : 0, 0, 1).applyQuaternion(this.rig._rigQ);
      this._v[11].addScaledVector(this._v[10], -this._v[11].dot(this._v[10]));
    }
    this._v[11].normalize();
    const projection = (lenA * lenA - lenB * lenB + distance * distance) / (2 * distance);
    const altitude = Math.sqrt(Math.max(0, lenA * lenA - projection * projection));
    this._v[12].copy(this._v[7]).addScaledVector(this._v[10], projection).addScaledVector(this._v[11], altitude);
    this._v[13].copy(this._v[7]).addScaledVector(this._v[10], distance);
    this._v[14].subVectors(this._v[8], this._v[7]).normalize(); this._v[15].subVectors(this._v[12], this._v[7]).normalize();
    this._q[3].setFromUnitVectors(this._v[14], this._v[15]); upper.getWorldQuaternion(this._q[4]); this._q[4].premultiply(this._q[3]); this._setWorldQuaternion(upper, this._q[4]);
    lower.getWorldPosition(this._v[8]); end.getWorldPosition(this._v[9]);
    this._v[14].subVectors(this._v[9], this._v[8]).normalize(); this._v[15].subVectors(this._v[13], this._v[8]).normalize();
    this._q[3].setFromUnitVectors(this._v[14], this._v[15]); lower.getWorldQuaternion(this._q[4]); this._q[4].premultiply(this._q[3]); this._setWorldQuaternion(lower, this._q[4]);
  }

  soleY(side) {
    this.rig.root.updateMatrixWorld(true); let y = Infinity;
    for (const sample of this.feet[side].samples) {
      sample.mesh.getVertexPosition(sample.index, this._v[20]); sample.mesh.localToWorld(this._v[20]); y = Math.min(y, this._v[20].y);
    }
    return Number.isFinite(y) ? y : this.bones[side + 'Foot'].getWorldPosition(this._v[20]).y;
  }

  ground(dt, floorY, state) {
    this.metrics.planted = 0; this.metrics.maxSlip = 0; this.metrics.soleError = 0; this.metrics.ikReachClamp = 0;
    if (!state.heavy || state.clip === 'crawl') { this.reset(); return; }
    const moving = LOCOMOTION.test(state.clip);
    this.rig.sourceRig.getWorldPosition(this._rootPosition); this.rig.sourceRig.getWorldQuaternion(this._rootQuaternion);
    const scale = this.rig.sourceRig.getWorldScale(this._v[21]).y;
    const teleported = this._hasPreviousRoot && (this._rootPosition.distanceTo(this._previousRoot) > scale * 0.55 || this._rootQuaternion.angleTo(this._previousRootQ) > 0.85);
    if (teleported) for (const side of SIDES) { this.feet[side].active = false; this.feet[side].exhausted = false; }
    this._previousRoot.copy(this._rootPosition); this._previousRootQ.copy(this._rootQuaternion); this._hasPreviousRoot = true;
    for (const side of SIDES) {
      const foot = this.feet[side], bone = this.bones[side + 'Foot'], toe = this.bones[side + 'ToeBase'];
      const confidence = moving ? clamp(state.contacts?.[side.toLowerCase()] ?? 0, 0, 1) : /^(idle|look|inspect|roar|shield)$/.test(state.clip) ? 0.88 : 0;
      bone.getWorldPosition(this._v[0]); bone.getWorldQuaternion(this._q[7]);
      toe?.getWorldQuaternion(this._q[0]);
      const sole = this.soleY(side);
      if (confidence < 0.18) { foot.active = false; foot.exhausted = false; }
      if (!foot.active && !foot.exhausted && confidence > 0.60 && Math.abs(sole - floorY) < scale * 0.15) {
        foot.active = true; foot.target.copy(this._v[0]); foot.target.y += floorY - sole + scale * 0.002;
        foot.quaternion.copy(this._q[7]); foot.toeQuaternion.copy(this._q[0]); foot.last.copy(foot.target);
      }
      if (!foot.active) { foot.weight = 0; continue; }
      // Contacts stay in world space as the boss root advances. Release an
      // impossible reach rather than popping its pelvis or stretching a bone.
      this.bones[side + 'UpLeg'].getWorldPosition(this._v[1]);
      const reach = (this.legs[side].upper + this.legs[side].lower) * scale;
      if (this._v[1].distanceTo(foot.target) > reach * 0.999) { foot.active = false; foot.exhausted = true; foot.weight = 0; continue; }
      foot.weight = clamp((confidence - 0.18) / 0.64, 0, 1);
      this._v[2].lerpVectors(this._v[0], foot.target, foot.weight);
      this._solveLimb(side, false, this._v[2], null);
      this._q[5].slerpQuaternions(this._q[7], foot.quaternion, foot.weight); this._setWorldQuaternion(bone, this._q[5]);
      // The large toe skin joins the grounded sole at full support. Release
      // its plant with the contact curve so the generated toe-off returns.
      if (toe) { this._q[1].slerpQuaternions(this._q[0], foot.toeQuaternion, foot.weight); this._setWorldQuaternion(toe, this._q[1]); }
      // Contact release restores the generated heel-to-toe roll. Resolve the
      // changing sole during that blend instead of assuming captured ankle
      // height remains valid. Visual IK correction is bounded to5cm/scale.
      const soleCorrection = clamp(floorY + scale * 0.002 - this.soleY(side), -scale * 0.05, scale * 0.05) * foot.weight;
      if (Math.abs(soleCorrection) > scale * 0.0005) {
        this._v[4].copy(this._v[2]); this._v[4].y += soleCorrection;
        // Do not exchange a stable horizontal plant for a hyperextended knee.
        // A raw contact at full reach can keep its authored toe clearance.
        if (this._v[1].distanceTo(this._v[4]) < reach * 0.996) {
          foot.target.y += soleCorrection; this._v[2].copy(this._v[4]);
          this._solveLimb(side, false, this._v[2], null); this._setWorldQuaternion(bone, this._q[5]);
        }
      }
      bone.getWorldPosition(this._v[3]);
      foot.slip = Math.hypot(this._v[3].x - foot.target.x, this._v[3].z - foot.target.z);
      foot.error = Math.abs(this.soleY(side) - floorY);
      this.metrics.maxSlip = Math.max(this.metrics.maxSlip, foot.slip); this.metrics.soleError = Math.max(this.metrics.soleError, foot.error); this.metrics.planted++;
    }
    this.rig.root.updateMatrixWorld(true);
    // Leg IK changes thigh capsules; finish the bounded anatomical pass once.
    this.rig._separateArms(); this.rig.metrics.afterClearance = this.rig.measureClearance();
    void dt;
  }
}
