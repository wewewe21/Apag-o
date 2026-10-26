import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import * as THREE from 'three';
import { CreatureModel } from '../../src/entities/creature.js';
import { AnimData } from '../../src/shared/animdata.js';
import { NetCreature } from '../../src/net/netcreature.js';
import { CREATURE_STATES, CLIPS } from '../../src/net/protocol.js';
import { parseGuardianForInspection } from '../guardian-asset-inspect.mjs';

const hash = data => createHash('sha256').update(data).digest('hex');
const json = async file => JSON.parse(await fs.readFile(file, 'utf8'));
const baseline = await json('.unlazy/guardian-motion/baseline.json');
for (const [file, expected] of Object.entries(baseline.hashes)) {
  assert.equal(hash(await fs.readFile(file)), expected, `${file}: unrelated game/asset unchanged`);
}
assert.throws(() => assert.equal(hash(Buffer.from('changed')), hash(Buffer.from('original'))), 'fingerprint detects an actual alteration');
const data = await json('assets/anim/creature.json');
const old = await json('.unlazy/guardian-motion/original-creature.json');
const keys = Object.keys(old.clips);
assert.deepEqual(Object.keys(data.clips).sort(), keys.toSorted());
assert.deepEqual(data.skeleton, old.skeleton);
assert.equal(data.guardianMotion.version, 1);
for (const key of keys) assert.notEqual(data.clips[key].rot, old.clips[key].rot, `${key}: recreated motion`);
const { asset } = await parseGuardianForInspection();
const model = new CreatureModel(structuredClone(data), null, null, asset);
const server = new AnimData(data), oldServer = new AnimData(old);
assert.ok(model.heavyMotion);
assert.deepEqual(Object.keys(model.actions).sort(), [...keys, 'shield'].sort());
assert.deepEqual(model.bones.LeftForeArm.position.toArray(), data.skeleton.offsets[data.skeleton.names.indexOf('LeftForeArm')], 'heavy controller uses natural limb offsets');
for (const key of keys) {
  assert.ok(Math.abs(model.duration(key) - server.duration(key)) < 0.000001, `${key}: client/server duration`);
  assert.equal(model.clipSpeed(key), server.clipSpeed(key), `${key}: client/server stride`);
  for (const t of [0, 0.4, model.duration(key) * 0.6, model.duration(key)]) {
    assert.deepEqual(model.rootAt(key, t), server.rootAt(key, t), `${key}: client/server displacement`);
    if (!data.clips[key].loop) {
      assert.ok(Math.abs(server.rootAt(key, t)[0] - oldServer.rootAt(key, t)[0]) < 0.00001);
      assert.ok(Math.abs(server.rootAt(key, t)[1] - oldServer.rootAt(key, t)[1]) < 0.00001);
    }
  }
  if (!data.clips[key].loop) assert.equal(data.clips[key].frames, old.clips[key].frames, `${key}: gameplay reaction window`);
}
let skin;
model.guardianRoot.traverse(o => { if (o.isSkinnedMesh) skin = o; });
assert.equal(skin.name, 'parasiteZombie');
const vertices = Array.from({length: 30}, (_, i) => Math.floor(i * (skin.geometry.attributes.position.count - 1) / 29));
const sample = () => {
  model.group.updateMatrixWorld(true);
  return vertices.map(i => skin.getVertexPosition(i, new THREE.Vector3()).applyMatrix4(skin.matrixWorld));
};
const begin = key => {
  model.mixer.stopAllAction(); model.cancelFlinch(); model.setShield(0); model.current = null;
  model.play(key, 0, {restart: true}); model.groundOffset = 0;
  model.update(1 / 30, 0, 0);
};
const movement = {};
for (const key of keys.filter(k => k !== 'pain')) {
  begin(key); const before = sample(), fingers = model.guardian.fingers.map(f => f.bone.quaternion.clone());
  for (let i = 0; i < Math.min(35, Math.floor(model.duration(key) * 20)); i++) model.update(1 / 30, 0, i / 30);
  const after = sample();
  const delta = Math.max(...after.map((p, i) => p.distanceTo(before[i])));
  assert.ok(delta > 0.004, `${key}: original skin actually moves`); movement[key] = +delta.toFixed(3);
  assert.ok(model.guardian.fingers.some((f, i) => f.bone.quaternion.angleTo(fingers[i]) > 0.002), `${key}: fingers move`);
  assert.ok(Number.isFinite(model.guardian.supportY()));
  assert.ok(model.headWorld().distanceTo(model.chestWorld()) > 0.15);
  assert.ok(model.guardian.metrics.afterClearance > -0.015, `${key}: body clearance`);
}

// Use the complete public update with actual generated contact curves. A local
// foot bob that looks planted in an in-place preview fails this moving oracle.
const gait = {};
for (const key of ['walk', 'run', 'creep', 'stalk', 'limp']) {
  model.group.position.set(4, -4, 8); model.group.rotation.y = 0.7; model.group.scale.setScalar(0.7);
  begin(key); model.guardian.resetMotion();
  let contacts = 0, maxHardSlip = 0, minStance = Infinity, minElbows = Infinity;
  const frames = Math.ceil(model.duration(key) * 60 * 2);
  for (let i = 0; i < frames; i++) {
    const step = model.clipSpeed(key) * 0.7 / 60;
    model.group.position.x += Math.sin(0.7) * step; model.group.position.z += Math.cos(0.7) * step;
    const pos = model.group.position.clone(), yaw = model.group.quaternion.clone();
    model.update(1 / 60, -4, i / 60);
    assert.deepEqual(model.group.position.toArray(), pos.toArray(), `${key}: visual IK leaves AI translation intact`);
    assert.deepEqual(model.group.quaternion.toArray(), yaw.toArray(), `${key}: visual IK leaves AI yaw intact`);
    const metrics = model.guardian.motion.metrics;
    minStance = Math.min(minStance, metrics.stance); minElbows = Math.min(minElbows, metrics.elbows);
    for (const side of ['Left', 'Right']) {
      const foot = model.guardian.motion.feet[side];
      if (foot.active && foot.weight > 0.99) { contacts++; maxHardSlip = Math.max(maxHardSlip, foot.slip); }
    }
    assert.ok(Object.values(model.guardian.bones).every(b => b.quaternion.toArray().every(Number.isFinite)), `${key}: finite transforms`);
  }
  assert.ok(contacts > 10, `${key}: meaningful hard contact samples ${contacts}`);
  assert.ok(maxHardSlip < 0.015, `${key}: world foot plant ${maxHardSlip}`);
  assert.ok(minStance > 0.27 && minElbows > 0.53, `${key}: broad stance and arms`);
  gait[key] = {contacts, maxHardSlip: +maxHardSlip.toFixed(5), minStance: +minStance.toFixed(3), minElbows: +minElbows.toFixed(3)};
}
model.group.position.set(0, 0, 0); model.group.scale.setScalar(1); model.group.rotation.y = 0;
begin('idle'); model.setShield(1);
for (let i = 0; i < 35; i++) model.update(1 / 30, 0, i / 30);
for (const side of ['Left', 'Right']) assert.ok(model.guardian.bones[side + 'Hand'].getWorldPosition(new THREE.Vector3()).distanceTo(model.headWorld()) < 0.34, 'hands protect actual face');
model.setShield(0); assert.ok(model.flinch()); assert.equal(model.flinch(), false);
for (let i = 0; i < 30; i++) model.update(1 / 30, 0, i / 30);
assert.equal(model.painT, -1);
model.play('walk', 0); model.update(1 / 30, 0, 2); model.play('walk', 0, {restart: true});
assert.ok(!model.guardian.motion.feet.Left.active && !model.guardian.motion.feet.Right.active, 'explicit clip restarts release old plants');
const net = new NetCreature({grid: {}, world: {vents: []}, player: {pos: new THREE.Vector3()}}, model);
net.onSnap({s: CREATURE_STATES.indexOf('chase'), u: -1, t: 1, en: 0, bn: 0, sp: 4, v: 1, x: 4, y: 0, z: 8, yw: 0.5, cl: CLIPS.indexOf('run'), ps: 1, ts: 1.1, lk: null, lw: 0, bg: 0, es: 0, sh: 0}, performance.now() / 1000);
net.update(1 / 30); model.update(1 / 30, 0, 3);
assert.equal(model.current, 'run'); assert.equal(model.group.visible, true);
net.reset(); assert.equal(model.group.visible, false);
console.log(JSON.stringify({unchangedFiles: Object.keys(baseline.hashes).length, actions: keys.length, movement, gait}));
console.log('GUARDIAN_HEAVY_INTEGRATION_VERIFIED');
