import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import * as THREE from 'three';
import { parseGuardianForInspection } from '../guardian-asset-inspect.mjs';
import { createGuardianInstance } from '../../src/entities/guardian-asset.js';
import { GuardianRig } from '../../src/entities/guardian-rig.js';
import { CreatureModel } from '../../src/entities/creature.js';

const data = JSON.parse(fs.readFileSync(new URL('../../assets/anim/creature.json', import.meta.url), 'utf8'));
// Before native generation returns, the exact real previous clips exercise
// adaptation; after return this same oracle samples the fresh production data.
const { asset, sha256 } = await parseGuardianForInspection();
assert.equal(sha256, '4412ad966cebca0cff7cca2675f1538aa228ffea97a08fe050d45513b0f5f1d0');
const fixtureData = structuredClone(data); fixtureData.guardianMotion = { ...fixtureData.guardianMotion, version: 1 };
const model = new CreatureModel(fixtureData, {}, {}, asset), adapter = model.guardian;
const root = model.guardianRoot;
const hashGeometry = geometry => {
  const hash = createHash('sha256');
  for (const [name, attr] of Object.entries(geometry.attributes)) { hash.update(name); hash.update(Buffer.from(attr.array.buffer, attr.array.byteOffset, attr.array.byteLength)); }
  return hash.digest('hex');
};
const skin = []; root.traverse(mesh => {
  if (mesh.isSkinnedMesh) skin.push({ mesh, hash: hashGeometry(mesh.geometry), inverse: mesh.skeleton.boneInverses.map(m => m.toArray()), order: mesh.skeleton.bones.map(b => b.uuid) });
});
assert.equal(adapter.fingers.length, 30);
assert.ok(adapter.motion.feet.Left.samples.length > 20 && adapter.motion.feet.Right.samples.length > 20, 'weighted sole probes on both actual feet');
assert.ok(adapter.motion.body.shoulderWidth > 0.40 && adapter.motion.body.shoulderWidth < 0.45, 'actual normalized shoulder span');
assert.ok(adapter.motion.legs.Left.upper > 0.38 && adapter.motion.legs.Left.lower > 0.40, 'measured FBX limb lengths');
const records = []; let minStance = Infinity, minElbows = Infinity, minClearance = Infinity, headMotion = 0;
for (const clip of Object.keys(data.clips).filter(key => key !== 'shield')) {
  model.mixer.stopAllAction(); model.cancelFlinch(); model.setShield(0); model.current = null;
  model.play(clip, 0, { restart: true }); adapter.resetMotion(); model.groundOffset = 0;
  let previousHead; const frames = data.clips[clip].frames;
  const sampleCount = Math.min(frames, 60);
  for (let i = 0; i < sampleCount; i++) {
    const t = i / sampleCount * (frames - 1) / data.fps;
    model.actions[clip].time = t; model.update(0, 0, t);
    // dt0 seeks do not advance mass/finger springs; exercise that part directly.
    model.guardianState.phase = t / model.duration(clip);
    adapter.update(1 / 30, t, model.guardianState);
    const y = adapter.supportY(); model.rig.position.y -= y; model.rig.updateMatrixWorld(true);
    adapter.ground(1 / 30, 0, model.guardianState);
    assert.ok(Number.isFinite(adapter.supportY()), `finite support ${clip}`);
    assert.ok(Object.values(adapter.bones).every(b => b.quaternion.toArray().every(Number.isFinite)), `finite bones ${clip}`);
    assert.ok(adapter.metrics.maxCorrection <= 0.461, `bounded separation ${clip}`);
    assert.ok(adapter.motion.metrics.ikReachClamp < 0.25, `bounded IK reach ${clip}`);
    minClearance = Math.min(minClearance, adapter.measureClearance());
    if (/^(walk|stalk|creep|limp|run|idle)$/.test(clip)) {
      minStance = Math.min(minStance, adapter.motion.metrics.stance);
      minElbows = Math.min(minElbows, adapter.motion.metrics.elbows);
      assert.ok(adapter.motion.metrics.stance > 0.27, `wide support ${clip}: ${adapter.motion.metrics.stance}`);
      assert.ok(adapter.motion.metrics.elbows > 0.53, `arms clear broad torso ${clip}: ${adapter.motion.metrics.elbows}`);
    }
    const head = adapter.headWorld(); if (previousHead) headMotion += head.distanceTo(previousHead); previousHead = head;
    if (i === sampleCount - 1) {
      const bounds = new THREE.Box3().setFromObject(root, true).expandByScalar(0.035);
      assert.ok(bounds.containsPoint(adapter.headWorld()), `${clip} head anchor follows skin`);
      assert.ok(bounds.containsPoint(adapter.chestWorld()), `${clip} chest anchor follows skin`);
    }
  }
  records.push({ clip, samples: sampleCount, stance: +adapter.motion.metrics.stance.toFixed(4), elbows: +adapter.motion.metrics.elbows.toFixed(4) });
}
assert.ok(headMotion > 0.1, 'all real generated clips retain body movement');
assert.ok(minClearance > -0.015, `forearm/body clearance ${minClearance}`);

model.mixer.stopAllAction(); model.current = null; model.play('attack', 0, { restart: true });
model.actions.attack.time = model.duration('attack') * 0.38; model.update(1 / 100000, 0, 0.76);
const grabChest = adapter.chestWorld().applyMatrix4(adapter._rigInv);
for (const side of ['Left', 'Right']) {
  const wrist = adapter._rigPoint(adapter.bones[side + 'Hand'], new THREE.Vector3());
  const shoulder = adapter._rigPoint(adapter.bones[side + 'Arm'], new THREE.Vector3());
  assert.ok(wrist.z - shoulder.z > 0.32, `${side} attack reaches forward rather than guarding face`);
  assert.ok(Math.abs(wrist.y - grabChest.y) < 0.12, `${side} grab wrist fitted to actual chest/neck height`);
  const digit = adapter._rigPoint(adapter.bones[side + 'HandMiddle1'], new THREE.Vector3()).sub(wrist).normalize();
  assert.ok(digit.z > 0.60, `${side} claw points toward victim`);
}

// Shield must protect the actual face. Its hands must rise materially above
// the belly-level old retarget, within the measured arm's reachable envelope.
model.mixer.stopAllAction(); model.current = null; model.play('idle', 0, { restart: true }); model.setShield(1);
for (let i = 0; i < 30; i++) model.update(1 / 30, 0, i / 30);
const head = adapter.headWorld();
for (const side of ['Left', 'Right']) {
  const hand = adapter.bones[side + 'Hand'].getWorldPosition(new THREE.Vector3());
  assert.ok(hand.y > head.y - 0.22, `shield protects face ${side}: hand${hand.y} head${head.y}`);
  assert.ok(hand.distanceTo(head) < 0.34, `${side} shield hands bracket actual skull`);
}
assert.ok(adapter._curl < 0.065, 'face guard opens palms');
model.setShield(0); model.flinch(1); for (let i = 0; i < 35; i++) model.update(1 / 30, 0, i / 30);
assert.equal(model.painT, -1, 'additive pain releases normally');

// World-space plant oracle uses the real FBX and a controlled bent-knee stance.
// It intentionally moves/yaws/scales the gameplay root. An adapter that merely
// moves the feet in local space fails the lock and unchanged-root checks.
const group = new THREE.Group(), source = new THREE.Group(), target = createGuardianInstance(asset);
group.add(source); source.scale.setScalar(1.3); source.add(target);
const sourceBones = {}, list = data.skeleton.names.map((name, i) => {
  const b = new THREE.Object3D(); b.name = name; b.position.fromArray(data.skeleton.offsets[i]); sourceBones[name] = b; return b;
});
list.forEach((b, i) => (data.skeleton.parents[i] < 0 ? source : list[data.skeleton.parents[i]]).add(b));
const controlled = new GuardianRig(source, sourceBones, target, data.skeleton);
for (const side of ['Left', 'Right']) { sourceBones[side + 'Leg'].rotation.x = -0.22; sourceBones[side + 'Shin'].rotation.x = 0.44; }
sourceBones.Hips.position.y -= 0.04;
group.position.set(4, -4, 8); group.rotation.y = 0.7; group.scale.setScalar(0.7);
const state = { heavy: true, clip: 'walk', phase: 0.2, contacts: { left: 1, right: 0 }, shield: 0 };
let maxSlip = 0, maxSoleError = 0; const plantFrames = 22;
for (let i = 0; i < plantFrames; i++) {
  group.position.z += 0.002; source.position.y = 0; source.updateMatrixWorld(true);
  controlled.update(1 / 60, i / 60, state);
  source.position.y = (-4 - controlled.supportY()) / group.scale.y; source.updateMatrixWorld(true);
  const rootBefore = group.position.clone(), yawBefore = group.quaternion.clone();
  controlled.ground(1 / 60, -4, state);
  assert.deepEqual(group.position.toArray(), rootBefore.toArray(), 'IK cannot alter gameplay translation');
  assert.deepEqual(group.quaternion.toArray(), yawBefore.toArray(), 'IK cannot alter gameplay yaw');
  assert.equal(controlled.motion.metrics.planted, 1, 'left foot planted, right foot free');
  maxSlip = Math.max(maxSlip, controlled.motion.metrics.maxSlip); maxSoleError = Math.max(maxSoleError, controlled.motion.metrics.soleError);
}
assert.ok(maxSlip < 0.009, `planted foot horizontal slide ${maxSlip}`);
assert.ok(maxSoleError < 0.012, `weighted sole floor error ${maxSoleError}`);
const locked = controlled.motion.feet.Left.target.clone();
state.contacts.left = 0; controlled.update(1 / 60, 0.5, state); controlled.ground(1 / 60, -4, state);
assert.equal(controlled.motion.metrics.planted, 0, 'swing contact releases foot lock');
state.contacts.left = 1; group.position.x += 4;
controlled.update(1 / 60, 0.6, state); source.position.y = (-4 - controlled.supportY()) / group.scale.y; source.updateMatrixWorld(true); controlled.ground(1 / 60, -4, state);
assert.ok(controlled.motion.feet.Left.target.distanceTo(locked) > 3, 'teleports clear stale world plant');
controlled.resetMotion(); assert.ok(!controlled.motion.feet.Left.active && !controlled.motion.feet.Right.active);
// A corrupt sole/lock must make these numerical oracles fail; finite values
// and a manually-labelled planted state are insufficient evidence.
controlled.motion.feet.Left.target.y += 0.2;
assert.throws(() => assert.ok(Math.abs(controlled.motion.feet.Left.target.y - (-4)) < 0.12));
const savedCapsules = controlled._capsules;
controlled._capsules = [{ a: 'LeftForeArm', b: 'LeftHand', radius: 0.1, p: new THREE.Vector3(), q: new THREE.Vector3() }];
assert.throws(() => assert.ok(controlled.measureClearance() >= 0)); controlled._capsules = savedCapsules;

const locomotion = [];
if (data.guardianMotion?.version === 1) for (const clip of ['walk', 'stalk', 'creep', 'limp', 'run']) {
  model.group.position.set(0, 0, 0); model.group.quaternion.identity(); model.group.scale.setScalar(1);
  model.mixer.stopAllAction(); model.current = null; model.play(clip, 0, { restart: true }); adapter.resetMotion();
  let hardFrames = 0, hardSlip = 0, hardFloor = 0, plantedFrames = 0;
  for (let i = 0; i < 300; i++) {
    model.group.position.z += model.clipSpeed(clip) / 60; model.update(1 / 60, 0, i / 60);
    plantedFrames += adapter.motion.metrics.planted;
    for (const side of ['Left', 'Right']) {
      const foot = adapter.motion.feet[side];
      if (foot.active && foot.weight > 0.99) {
        hardFrames++; hardSlip = Math.max(hardSlip, foot.slip); hardFloor = Math.max(hardFloor, foot.error);
      }
    }
  }
  assert.ok(hardFrames > 10 && plantedFrames > 60, `${clip} production curves produce real moving-world plants`);
  assert.ok(hardSlip < 0.004, `${clip} hard support horizontal slip ${hardSlip}`);
  assert.ok(hardFloor < 0.006, `${clip} weighted hard-support sole floor error ${hardFloor}`);
  locomotion.push({ clip, frames: 300, plantedFrames, hardFrames, hardSlip, hardFloor });
}

// The profile is opt-in. Plain retarget continues to reproduce the source
// directions exactly, including when that source is the newly generated set.
controlled.update(0, 0, { heavy: false, clip: 'idle' });
const point = b => source.worldToLocal(b.getWorldPosition(new THREE.Vector3()));
const actualDir = point(controlled.bones.LeftForeArm).sub(point(controlled.bones.LeftArm)).normalize();
const expectedDir = new THREE.Vector3().fromArray(data.skeleton.offsets[data.skeleton.names.indexOf('LeftForeArm')]).normalize();
assert.ok(actualDir.distanceTo(expectedDir) < 1e-5, 'legacy/plain retarget remains opt-in exact');
for (const record of skin) {
  assert.equal(hashGeometry(record.mesh.geometry), record.hash, 'geometry and skin buffers immutable');
  assert.deepEqual(record.mesh.skeleton.boneInverses.map(m => m.toArray()), record.inverse, 'inverse binds immutable');
  assert.deepEqual(record.mesh.skeleton.bones.map(b => b.uuid), record.order, 'joint order immutable');
}
console.log(JSON.stringify({ nativeData: data.guardianMotion?.version === 1, records, minStance, minElbows, minClearance, headMotion, plantFrames, maxSlip, maxSoleError, locomotion, sourceHash: sha256 }));
console.log('GUARDIAN_HEAVY_RIG_VERIFIED');
