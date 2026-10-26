import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import * as THREE from 'three';
import { parseGuardianForInspection } from '../guardian-asset-inspect.mjs';
import { createGuardianInstance } from '../../src/entities/guardian-asset.js';
import { GuardianRig } from '../../src/entities/guardian-rig.js';
import { CreatureModel } from '../../src/entities/creature.js';

const json = fs.readFileSync(new URL('../../assets/anim/creature.json', import.meta.url), 'utf8');
const data = JSON.parse(json), { asset, sha256 } = await parseGuardianForInspection();
assert.equal(sha256, '4412ad966cebca0cff7cca2675f1538aa228ffea97a08fe050d45513b0f5f1d0', 'original FBX is immutable');
const target = createGuardianInstance(asset), source = new THREE.Group(), root = new THREE.Group(); root.add(source); source.add(target);
source.scale.setScalar(1.3);
const bones = {}, list = data.skeleton.names.map((name, i) => {
  const bone = new THREE.Object3D(); bone.name = name; bone.position.fromArray(data.skeleton.offsets[i]); bones[name] = bone; return bone;
});
list.forEach((bone, i) => (data.skeleton.parents[i] < 0 ? source : list[data.skeleton.parents[i]]).add(bone));
const preParentSkinInverse = [];
target.traverse(mesh => { if (mesh.isSkinnedMesh) preParentSkinInverse.push({ mesh, inverse: mesh.bindMatrixInverse.clone() }); });
const rig = new GuardianRig(source, bones, target, data.skeleton);
// Reproduce the actual pre-render regression: attached mesh retains its bind
// inverse from before sourceRig's1.3 scale. The vertex-derived marker escapes
// the body. The constructor must flush the SkinnedMesh-specific override.
const initialBounds = new THREE.Box3().setFromObject(target, true).expandByScalar(0.03);
assert.ok(initialBounds.containsPoint(rig.headWorld())); assert.ok(initialBounds.containsPoint(rig.chestWorld()));
for (const record of preParentSkinInverse) record.mesh.bindMatrixInverse.copy(record.inverse);
const brokenAnchor = rig._skinAnchor('Head');
assert.throws(() => assert.ok(initialBounds.containsPoint(brokenAnchor.bone.localToWorld(brokenAnchor.position.clone()))));
target.updateMatrixWorld(true);
const canonical = name => name.replace(/^.*mixamorig[:_]?/i, '').replace(/[:_]/g, '');
const point = bone => source.worldToLocal(bone.getWorldPosition(new THREE.Vector3()));
const direction = (a, b) => point(rig.bones[b]).sub(point(rig.bones[a])).normalize();
const assertVector = (a, b, epsilon = 1e-5) => assert.ok(a.distanceTo(b) < epsilon, `vector ${a.toArray()} expected ${b.toArray()}`);
const axisSamples = [
  ['LeftArm', 'LeftForeArm', new THREE.Vector3().fromArray(data.skeleton.offsets[data.skeleton.names.indexOf('LeftForeArm')]).normalize()],
  ['RightArm', 'RightForeArm', new THREE.Vector3().fromArray(data.skeleton.offsets[data.skeleton.names.indexOf('RightForeArm')]).normalize()],
  ['LeftUpLeg', 'LeftLeg', new THREE.Vector3().fromArray(data.skeleton.offsets[data.skeleton.names.indexOf('LeftShin')]).normalize()],
  ['RightUpLeg', 'RightLeg', new THREE.Vector3().fromArray(data.skeleton.offsets[data.skeleton.names.indexOf('RightShin')]).normalize()],
];
const geometryHashes = [];
target.traverse(mesh => { if (mesh.isSkinnedMesh) geometryHashes.push({ mesh,
  hash: hashGeometry(mesh.geometry), inverse: mesh.skeleton.boneInverses.map(m => m.toArray()),
  order: mesh.skeleton.bones.map(b => b.uuid), bind: mesh.bindMatrix.toArray() }); });
function hashGeometry(geometry) {
  const hash = createHash('sha256');
  for (const [name, attr] of Object.entries(geometry.attributes)) { hash.update(name); hash.update(Buffer.from(attr.array.buffer, attr.array.byteOffset, attr.array.byteLength)); }
  if (geometry.index) hash.update(Buffer.from(geometry.index.array.buffer));
  return hash.digest('hex');
}

// Calibrated directions transfer SOMA's zero rotation to Mixamo local +Y limbs.
// A naive local-quaternion copy is the negative control: legs point upward and
// the arms collapse, even though it contains finite, valid quaternions.
rig.update(1, 0, { clip: 'idle' });
for (const [a, b, expected] of axisSamples) assertVector(direction(a, b), expected);
const bindArmQ = rig.bones.LeftArm.quaternion.clone();
rig.bones.LeftArm.quaternion.identity(); target.updateMatrixWorld(true);
assert.throws(() => assertVector(direction('LeftArm', 'LeftForeArm'), axisSamples[0][2]));
rig.bones.LeftArm.quaternion.copy(bindArmQ);
root.position.set(6, 2, -8); root.rotation.y = 1.1;
rig.update(0, 0, { clip: 'idle' });
for (const [a, b, expected] of axisSamples) assertVector(direction(a, b), expected);
root.rotation.y = -2.3; rig.update(0, 0, { clip: 'idle' });
for (const [a, b, expected] of axisSamples) assertVector(direction(a, b), expected);
// Constructor anchors are measured after the mesh is placed beneath scale1.3.
// A stale attached bind inverse (the old updateWorldMatrix-only path) applies
// that scale twice, inflating an anchor far beyond the actual animated body.
const headAnchor = rig._headAnchor.position.clone();
assert.ok(headAnchor.y < 30, `head anchor uses actual skull, got localY${headAnchor.y}`);

// Actual three joints per digit, including thumb opposition. The tip moves
// toward the underside of the palm, measured in the normalized bind space.
assert.equal(rig.fingers.length, 30); assert.ok(rig.supportSamples.length >= 100 && rig.supportSamples.length < 1200);
const tip = point(rig.bones.LeftHandMiddle4);
for (const f of rig.fingers) f.bone.quaternion.copy(f.bind);
target.updateMatrixWorld(true);
const straightTip = point(rig.bones.LeftHandMiddle4);
assert.ok(tip.y < straightTip.y - 0.025, 'finger curl bends down toward palm, not backward');
rig.update(0, 0, { clip: 'idle' });
const fingerBefore = rig.fingers.map(f => f.bone.quaternion.clone());
rig.update(1 / 60, 0.6, { clip: 'idle' });
assert.ok(rig.fingers.every((f, i) => f.bone.quaternion.angleTo(fingerBefore[i]) > 0.001));
rig.update(1, 0.6, { clip: 'crawl' });
const crawlCurl = rig._curl; rig.update(1, 0.6, { clip: 'attack' });
assert.ok(rig._curl > crawlCurl + 0.3, 'attack grips, crawl keeps fingers extended');
rig.update(1, 0.6, { clip: 'attack', shield: 1 }); assert.ok(rig._curl < 0.11, 'shield opens palms');
rig.update(0, 0.6, { clip: 'attack', shield: 1 });
const stable = Object.fromEntries(Object.entries(rig.bones).map(([name, b]) => [name, b.quaternion.clone()]));
for (let i = 0; i < 25; i++) rig.update(0, 0.6, { clip: 'attack', shield: 1 });
for (const [name, q] of Object.entries(stable)) assert.ok(q.angleTo(rig.bones[name].quaternion) < 1e-6, `no accumulating ${name}`);
rig.update(0, 0.6, { eyeshine: 0.8, burnGlow: 0.3 });
assert.equal(rig.eyeGlows.length, 2); assert.ok(rig.eyeGlows.every(eye => eye.visible && eye.material.opacity === 1));
assert.ok(rig.eyeGlows.every(eye => /Eye$/.test(eye.parent.name)), 'glow confined to real eyes');
rig.update(0, 0.6, {}); assert.ok(rig.eyeGlows.every(eye => !eye.visible));
assert.ok(rig.headWorld().y > rig.chestWorld().y);

// A second geometry-free bind deliberately changes the arm rest angle and
// twist. The adapter must reconstruct the same authored segment directions,
// rather than being hardcoded to this file's T pose.
const alternate = target.clone(true), toRemove = [];
alternate.traverse(o => { if (o.isMesh) toRemove.push(o); }); for (const o of toRemove) o.removeFromParent();
const alternateBones = {}; alternate.traverse(o => { if (o.isBone) alternateBones[canonical(o.name)] = o; });
for (const [name, b] of rig.bind) { alternateBones[name].position.copy(b.position); alternateBones[name].quaternion.copy(b.quaternion); }
alternateBones.LeftArm.rotateZ(0.6); alternateBones.RightArm.rotateZ(-0.6); alternateBones.LeftForeArm.rotateY(0.35);
source.add(alternate); const alternateRig = new GuardianRig(source, bones, alternate, data.skeleton);
bones.LeftArm.rotation.set(0.3, 0.2, -1.1); bones.LeftForeArm.rotation.set(0.2, 0.2, -0.3);
bones.Neck1.rotation.x = 0.32; bones.Neck2.rotation.y = 0.19;
alternateRig.update(0, 0, { clip: 'crawl' });
for (const [name, child, sourceName, sourceChild] of [['LeftArm', 'LeftForeArm', 'LeftArm', 'LeftForeArm'], ['LeftForeArm', 'LeftHand', 'LeftForeArm', 'LeftHand'], ['Neck', 'Head', 'Neck2', 'Head']]) {
  const actualDir = point(alternateRig.bones[child]).sub(point(alternateRig.bones[name])).normalize();
  const sourceQ = bones[sourceName].getWorldQuaternion(new THREE.Quaternion()).premultiply(source.getWorldQuaternion(new THREE.Quaternion()).invert());
  const expected = new THREE.Vector3().fromArray(data.skeleton.offsets[data.skeleton.names.indexOf(sourceChild)]).normalize().applyQuaternion(sourceQ);
  assertVector(actualDir, expected);
}
for (const bone of list) bone.quaternion.identity(); alternate.removeFromParent();

// Use the game's actual mixer, original 13 clips, additive flinch, hunch, head
// and shield. Geometry builders are omitted so this is a motion-driver fixture
// without the old procedural body or canvas, matching the new runtime contract.
const buildMaterials = CreatureModel.prototype._buildMaterials, buildBody = CreatureModel.prototype._buildBody;
CreatureModel.prototype._buildMaterials = function () { this.eyeMat = new THREE.MeshStandardMaterial(); };
CreatureModel.prototype._buildBody = function () { this.eyeHalos = []; };
const driver = new CreatureModel(JSON.parse(json), {}, {});
CreatureModel.prototype._buildMaterials = buildMaterials; CreatureModel.prototype._buildBody = buildBody;
const actualTarget = createGuardianInstance(asset); driver.rig.add(actualTarget);
const actual = new GuardianRig(driver.rig, driver.bones, actualTarget, driver.data.skeleton);
const clipsBefore = createHash('sha256').update(JSON.stringify(driver.data)).digest('hex');
const tracksBefore = Object.fromEntries(Object.entries(driver.clips).map(([name, c]) => [name, c.tracks.map(t => Array.from(t.values))]));
const sampled = [];
let correctionFrames = 0, minBefore = Infinity, minAfter = Infinity, maxImprovement = 0, maxRegression = 0, maxSupportError = 0;
for (const name of Object.keys(data.clips)) {
  driver.cancelFlinch(); driver.setShield(0); driver.play(name, 0, { restart: true });
  driver.lookTarget = new THREE.Vector3(1, 1.7, 3); driver.lookWeight = name === 'look' ? 0.7 : 0;
  driver.twitchTimer = Infinity; driver._twitchAmt = 0;
  let headTravel = 0, fingerTravel = 0, previousHead, previousFinger;
  const count = data.clips[name].frames;
  for (let i = 0; i < count; i += 2) {
    driver.actions[name].time = i / data.fps;
    driver.update(0, 0, i / data.fps);
    driver.rig.position.y = 0;
    actual.update(1 / 15, i / data.fps, { clip: name, jawOpen: driver.jawOpen });
    const head = actual.headWorld(); const finger = actual.bones.LeftHandMiddle3.quaternion.clone();
    if (previousHead) headTravel += head.distanceTo(previousHead);
    if (previousFinger) fingerTravel += finger.angleTo(previousFinger);
    previousHead = head; previousFinger = finger;
    assert.ok(Number.isFinite(actual.supportY()), `finite support ${name}`);
    assert.ok(actual.metrics.maxCorrection <= 0.461, 'bounded anatomical corrections');
    assert.ok(Object.values(actual.bones).every(b => b.quaternion.toArray().every(Number.isFinite)), `finite skeleton ${name}`);
    minBefore = Math.min(minBefore, actual.metrics.beforeClearance); minAfter = Math.min(minAfter, actual.metrics.afterClearance);
    maxImprovement = Math.max(maxImprovement, actual.metrics.afterClearance - actual.metrics.beforeClearance);
    maxRegression = Math.max(maxRegression, actual.metrics.beforeClearance - actual.metrics.afterClearance);
    if (actual.metrics.corrections) correctionFrames++;
    maxSupportError = Math.max(maxSupportError, compareSupport(actual, actualTarget, name));
  }
  assert.ok(headTravel > 0.01, `${name} actual motion, not a named static clip`);
  assert.ok(fingerTravel > 0.005, `${name} actual finger joints move`);
  sampled.push({ name, samples: Math.ceil(count / 2), headTravel: +headTravel.toFixed(4), fingerTravel: +fingerTravel.toFixed(4) });
}
// Shield plus additive pain remain observable, on the same mixer/retarget path.
driver.play('walk', 0, { restart: true }); driver.setShield(1); driver.flinch(1);
for (let i = 0; i < 12; i++) {
  driver.update(1 / 30, 0, i / 30); driver.rig.position.y = 0;
  actual.update(1 / 30, i / 30, { clip: 'walk', shield: driver.shield });
  assert.ok(actual.metrics.maxCorrection <= 0.461); assert.ok(Number.isFinite(actual.supportY()));
}
assert.equal(createHash('sha256').update(JSON.stringify(driver.data)).digest('hex'), clipsBefore);
for (const [name, tracks] of Object.entries(tracksBefore)) assert.deepEqual(driver.clips[name].tracks.map(t => Array.from(t.values)), tracks, `original ${name} tracks unchanged`);
assert.ok(correctionFrames > 0 && maxImprovement > 0.01, 'actual authored poses trigger and benefit from separation');
assert.ok(minAfter >= -0.006 && maxRegression < 0.001, 'sampled forearms clear torso and both legs without worsening other samples');
// Deliberately place one forearm inside a thigh and prove the oracle sees it.
actual.bones.LeftArm.quaternion.identity(); actual.bones.LeftForeArm.quaternion.identity(); actualTarget.updateMatrixWorld(true);
// Positive control uses collocated anatomical segments: the clearance oracle
// must report penetration, not just finite positions or an empty collision set.
const savedCapsules = actual._capsules;
actual._capsules = [{ a: 'LeftForeArm', b: 'LeftHand', radius: 0.1, p: new THREE.Vector3(), q: new THREE.Vector3() }];
assert.throws(() => assert.ok(actual.measureClearance() >= 0)); actual._capsules = savedCapsules;
for (const record of geometryHashes) {
  assert.equal(hashGeometry(record.mesh.geometry), record.hash, 'original geometry and all skin buffers untouched');
  assert.deepEqual(record.mesh.skeleton.boneInverses.map(m => m.toArray()), record.inverse, 'inverse binds unchanged');
  assert.deepEqual(record.mesh.skeleton.bones.map(b => b.uuid), record.order, 'authoritative skin joint ordering unchanged');
  assert.deepEqual(record.mesh.bindMatrix.toArray(), record.bind);
}
for (const [name, b] of rig.bind) if (name !== 'Hips') assertVector(rig.bones[name].position, b.position);
console.log(JSON.stringify({ clips: sampled, correctionFrames, minBefore, minAfter, maxImprovement, maxRegression, supportSamples: actual.supportSamples.length, maxSupportError }));
console.log('GUARDIAN_RIG_VERIFIED');

function compareSupport(adapter, model, clip) {
  // Refresh through the same SkinnedMesh override that the renderer uses.
  // The bound here is independent of cached construction/retarget positions.
  model.updateMatrixWorld(true);
  let exact = Infinity; const bounds = new THREE.Box3();
  model.traverse(mesh => {
    if (!mesh.isSkinnedMesh) return;
    const weights = mesh.geometry.getAttribute('skinWeight'), indices = mesh.geometry.getAttribute('skinIndex'), p = new THREE.Vector3();
    for (let i = 0; i < weights.count; i++) {
      let sum = 0;
      for (let k = 0; k < 4; k++) if (/^(Left|Right)(Hand|Foot|Toe)/.test(canonical(mesh.skeleton.bones[indices.getComponent(i, k)]?.name ?? ''))) sum += weights.getComponent(i, k);
      mesh.getVertexPosition(i, p); mesh.localToWorld(p); bounds.expandByPoint(p);
      if (sum >= 0.7) exact = Math.min(exact, p.y);
    }
  });
  const error = Math.abs(adapter.supportY() - exact);
  assert.ok(error < 0.025, `${clip} support samples follow actual skin within 2.5cm: ${adapter.supportY()} vs ${exact}`);
  bounds.expandByScalar(0.03);
  assert.ok(bounds.containsPoint(adapter.headWorld()), `${clip} head FX marker inside actual animated skin bounds`);
  assert.ok(bounds.containsPoint(adapter.chestWorld()), `${clip} chest FX marker inside actual animated skin bounds`);
  // Positive control catches the measured root-scale defect, rather than
  // passing just because points are finite or generally above the floor.
  const safeAnchor = adapter._headAnchor.position.clone();
  adapter._headAnchor.position.y += 100;
  assert.throws(() => assert.ok(bounds.containsPoint(adapter.headWorld())));
  adapter._headAnchor.position.copy(safeAnchor);
  return error;
}
