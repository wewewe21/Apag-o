import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import * as THREE from 'three';
import { CreatureModel } from '../../src/entities/creature.js';
import { NetCreature } from '../../src/net/netcreature.js';
import { CREATURE_STATES, CLIPS } from '../../src/net/protocol.js';
import { parseGuardianForInspection } from '../guardian-asset-inspect.mjs';

const hash = data => createHash('sha256').update(data).digest('hex');
const baseline = JSON.parse(await fs.readFile('.unlazy/guardiao/baseline.json', 'utf8'));
for (const [file, expected] of Object.entries(baseline.hashes)) {
  assert.equal(hash(await fs.readFile(file)), expected, `${file}: gameplay/source asset unchanged`);
}
assert.notEqual(hash(Buffer.from('altered fixture')), hash(Buffer.from('original fixture')), 'fingerprint positive control');
const data = JSON.parse(await fs.readFile('assets/anim/creature.json', 'utf8'));
const originalKeys = Object.keys(data.clips);
const { asset } = await parseGuardianForInspection();
// Same animation driver, without the legacy procedural body, as a reference.
class Driver extends CreatureModel {
  _buildMaterials() { this.eyeMat = new THREE.MeshStandardMaterial(); }
  _buildBody() { this.eyeHalos = []; }
}
const reference = new Driver(structuredClone(data), null, null);
const model = new CreatureModel(structuredClone(data), null, null, asset);
assert.deepEqual(Object.keys(model.actions).sort(), [...originalKeys, 'shield'].sort());
assert.equal(model.boneList.length, data.skeleton.names.length);
assert.ok(model.guardian && model.guardianRoot);
const skins = [];
model.group.traverse(o => { if (o.isSkinnedMesh) skins.push(o); });
assert.equal(skins.length, 1, 'only the imported skinned body');
assert.equal(skins[0].name, 'parasiteZombie');
for (const key of originalKeys) {
  assert.equal(model.duration(key), reference.duration(key), `${key}: original duration`);
  assert.equal(model.clipSpeed(key), reference.clipSpeed(key), `${key}: gameplay stride unchanged`);
  assert.deepEqual(model.rootAt(key, 0.4), reference.rootAt(key, 0.4), `${key}: root motion unchanged`);
  assert.deepEqual(model.clips[key].tracks.map(t => ({ name: t.name, times: Array.from(t.times), values: Array.from(t.values) })), reference.clips[key].tracks.map(t => ({ name: t.name, times: Array.from(t.times), values: Array.from(t.values) })), `${key}: source animation unchanged`);
}
const skin = skins[0];
const vertices = Array.from({ length: 30 }, (_, i) => Math.floor(i * (skin.geometry.attributes.position.count - 1) / 29));
const sample = () => {
  model.group.updateMatrixWorld(true);
  return vertices.map(i => skin.getVertexPosition(i, new THREE.Vector3()).applyMatrix4(skin.matrixWorld));
};
const movement = {};
for (const key of originalKeys.filter(k => k !== 'pain')) {
  model.mixer.stopAllAction(); model.current = null; model.painT = -1;
  model.play(key, 0, { restart: true });
  model.twitchTimer = 10000; model._twitchAmt = 0;
  model.update(1 / 30, 0, 0);
  const before = sample();
  for (let i = 0; i < Math.max(2, Math.floor(Math.min(model.duration(key) * 0.55, 1.2) * 30)); i++) model.update(1 / 30, 0, i / 30);
  const after = sample();
  const delta = Math.max(...after.map((p, i) => p.distanceTo(before[i])));
  assert.ok(delta > 0.004, `${key}: real imported vertices move (${delta})`);
  movement[key] = +delta.toFixed(3);
  assert.ok(Number.isFinite(model.guardian.supportY()));
  const head = model.headWorld(), chest = model.chestWorld(), bounds = new THREE.Box3();
  for (let i = 0; i < skin.geometry.attributes.position.count; i++) {
    bounds.expandByPoint(skin.getVertexPosition(i, new THREE.Vector3()).applyMatrix4(skin.matrixWorld));
  }
  bounds.expandByScalar(0.03);
  // The original walk/run/recoil can bow the head below the chest. Validate
  // markers against the real animated skin instead of assuming an upright pose.
  assert.ok(bounds.containsPoint(head) && bounds.containsPoint(chest), `${key}: FX markers stay inside the imported body`);
  assert.ok(head.distanceTo(chest) > 0.15 && head.distanceTo(chest) < 0.9, `${key}: anatomical FX marker spacing`);
}
model.play('idle', 0); model.setShield(0.8); model.update(1 / 30, 0, 5);
assert.ok(model.actions.shield.isRunning());
model.setShield(0); assert.ok(!model.actions.shield.isRunning());
assert.equal(model.flinch(), true); assert.equal(model.flinch(), false);
for (let i = 0; i < 30; i++) model.update(1 / 30, 0, 6 + i / 30);
assert.equal(model.painT, -1);
model.group.position.set(4, -4, 8); model.group.rotation.y = 0.7; model.group.scale.setScalar(0.7);
model.play('walk', 0);
for (let i = 0; i < 90; i++) model.update(1 / 30, -4, 7 + i / 30);
assert.ok(Math.abs(model.guardian.supportY() + 4) < 0.12, 'basement/vent scale floor placement');
assert.ok(model.headWorld().distanceTo(model.group.position) < 3);
const game = { grid: {}, world: { vents: [] }, player: { pos: new THREE.Vector3() } };
const net = new NetCreature(game, model);
const now = performance.now() / 1000;
net.onSnap({ s: CREATURE_STATES.indexOf('chase'), u: -1, t: 1, en: 0, bn: 0, sp: 4, v: 1, x: 4, y: 0, z: 8, yw: 0.5, cl: CLIPS.indexOf('run'), ps: 1, ts: 1.1, lk: null, lw: 0, bg: 0, es: 0, sh: 0 }, now);
net.update(1 / 30); model.update(1 / 30, 0, 12);
assert.equal(model.current, 'run'); assert.equal(model.group.visible, true);
net.reset(); assert.equal(model.group.visible, false);
console.log(`GUARDIAN_INTEGRATION_VERIFIED: ${baseline.hashes ? Object.keys(baseline.hashes).length : 0} unchanged original files, ${Object.keys(model.actions).length} actions, imported skin motion ${JSON.stringify(movement)}, additive pain/shield, root/stride and cooperative interface.`);
