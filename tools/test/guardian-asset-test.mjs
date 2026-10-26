import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import { once } from 'node:events';
import { createHash } from 'node:crypto';
import * as THREE from 'three';
import { createGuardianInstance, loadGuardianAsset } from '../../src/entities/guardian-asset.js';
import { installImageFixture, parseGuardianForInspection } from '../guardian-asset-inspect.mjs';

const SOURCE_HASH = '4412ad966cebca0cff7cca2675f1538aa228ffea97a08fe050d45513b0f5f1d0';
const { asset, bytes, sha256 } = await parseGuardianForInspection();
assert.equal(sha256, SOURCE_HASH, 'The user-supplied FBX must remain byte-for-byte original');
assert.equal(bytes.subarray(0, 19).toString(), 'Kaydara FBX Binary ');
const vendorFiles = ['loaders/FBXLoader.js', 'utils/SkeletonUtils.js', 'libs/fflate.module.js', 'curves/NURBSCurve.js', 'curves/NURBSUtils.js'];
for (const path of vendorFiles) {
  const [installed, vendored] = await Promise.all([
    fs.readFile(new URL(`../../node_modules/three/examples/jsm/${path}`, import.meta.url)),
    fs.readFile(new URL(`../../vendor/fbx/${path}`, import.meta.url)),
  ]);
  assert.equal(createHash('sha256').update(installed).digest('hex'), createHash('sha256').update(vendored).digest('hex'), `${path} must match installed Three 0.170 exactly`);
}
const meshes = [];
asset.traverse(object => { if (object.isMesh) meshes.push(object); });
assert.equal(meshes.length, 1);
const sourceMesh = meshes[0];
assert.ok(sourceMesh.isSkinnedMesh);
assert.equal(sourceMesh.geometry.getAttribute('position').count, 32568);
assert.equal(sourceMesh.skeleton.bones.length, 69);
assert.equal(sourceMesh.geometry.index, null);
assert.equal(sourceMesh.geometry.groups.length, 29);
assert.deepEqual([...new Set(sourceMesh.geometry.groups.map(group => group.materialIndex))].sort(), [0, 1]);
assert.equal(sourceMesh.material.length, 2);
const boneNames = sourceMesh.skeleton.bones.map(bone => bone.name);
for (const name of ['Hips', 'Spine', 'Spine1', 'Spine2', 'Neck', 'Head', 'LeftEye', 'RightEye', 'JawDowm', 'JawUp', 'LeftArm', 'LeftForeArm', 'LeftHand', 'RightArm', 'RightForeArm', 'RightHand', 'LeftUpLeg', 'LeftLeg', 'LeftFoot', 'RightUpLeg', 'RightLeg', 'RightFoot']) assert.ok(boneNames.includes(`mixamorig${name}`), `Missing ${name}`);
for (const side of ['Left', 'Right']) for (const finger of ['Thumb', 'Index', 'Middle', 'Ring', 'Pinky']) for (let segment = 1; segment <= 4; segment++) assert.ok(boneNames.includes(`mixamorig${side}Hand${finger}${segment}`));
const weights = sourceMesh.geometry.getAttribute('skinWeight');
const indices = sourceMesh.geometry.getAttribute('skinIndex');
assert.equal(weights.count, 32568);
assert.equal(indices.count, weights.count);
const weightedBones = new Set();
for (let i = 0; i < weights.count; i++) {
  let total = 0;
  for (let component = 0; component < 4; component++) {
    const weight = weights.getComponent(i, component), index = indices.getComponent(i, component);
    assert.ok(Number.isFinite(weight) && weight >= 0 && weight <= 1);
    assert.ok(Number.isInteger(index) && index >= 0 && index < 69);
    total += weight;
    if (weight > 0) weightedBones.add(boneNames[index]);
  }
  assert.ok(Math.abs(total - 1) < 0.000001, `Weight sum at vertex ${i}: ${total}`);
}
for (const side of ['Left', 'Right']) for (const finger of ['Thumb', 'Index', 'Middle', 'Ring', 'Pinky']) for (let segment = 1; segment <= 3; segment++) assert.ok(weightedBones.has(`mixamorig${side}Hand${finger}${segment}`), 'Finger articulation must affect real mesh vertices');

// Embedded PNG headers prove the original image data exists. Decoding and
// appearance remain a browser gate; this Node fixture has no pixel decoder.
const images = new Map();
for (const material of sourceMesh.material) {
  assert.equal(material.type, 'MeshPhongMaterial');
  assert.equal(material.color.getHex(), 0xffffff);
  for (const key of ['map', 'normalMap', 'specularMap']) {
    assert.ok(material[key]?.isTexture);
    assert.ok(material[key].image.src.startsWith('blob:'));
    images.set(material[key].image.src, material[key]);
  }
  assert.equal(material.map.colorSpace, THREE.SRGBColorSpace);
}
assert.equal(images.size, 4);
let embeddedBytes = 0;
for (const [url, texture] of images) {
  const data = Buffer.from(await (await fetch(url)).arrayBuffer());
  assert.equal(data.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  assert.equal(data.readUInt32BE(16), 2048);
  assert.equal(data.readUInt32BE(20), 2048);
  assert.equal(texture.image.width, 0, 'Texture QA must not claim decoded pixels in a Node fixture');
  embeddedBytes += data.length;
}
assert.equal(embeddedBytes, 14999352);

const sourceTransforms = sourceMesh.skeleton.bones.map(bone => ({ p: bone.position.clone(), q: bone.quaternion.clone(), s: bone.scale.clone() }));
const instances = [createGuardianInstance(asset), createGuardianInstance(asset)];
const cloneMeshes = instances.map(root => { let mesh; root.traverse(object => { if (object.isSkinnedMesh) mesh = object; }); return mesh; });
for (let which = 0; which < instances.length; which++) {
  const root = instances[which], mesh = cloneMeshes[which];
  const bounds = new THREE.Box3().setFromObject(root, true), size = bounds.getSize(new THREE.Vector3()), center = bounds.getCenter(new THREE.Vector3());
  assert.ok(Math.abs(size.y - 1.75) < 1e-7);
  assert.ok(Math.abs(bounds.min.y) < 1e-7);
  assert.ok(Math.abs(center.x) < 1e-7 && Math.abs(center.z) < 1e-7);
  assert.equal(root.scale.x, 1);
  assert.ok(root.position.length() === 0);
  assert.notEqual(mesh.skeleton, sourceMesh.skeleton);
  assert.equal(mesh.geometry, sourceMesh.geometry);
  assert.deepEqual(mesh.skeleton.bones.map(bone => bone.name), boneNames);
  assert.deepEqual(mesh.bindMatrix.elements, sourceMesh.bindMatrix.elements);
  assert.equal(mesh.frustumCulled, false);
  assert.equal(mesh.castShadow, true);
  assert.equal(mesh.receiveShadow, true);
  const sourceVertex = new THREE.Vector3(), instanceVertex = new THREE.Vector3();
  const transform = root.children[0].matrixWorld;
  for (let i = 0; i < 32568; i++) {
    sourceMesh.getVertexPosition(i, sourceVertex).applyMatrix4(sourceMesh.matrixWorld).applyMatrix4(transform);
    mesh.getVertexPosition(i, instanceVertex).applyMatrix4(mesh.matrixWorld);
    assert.ok(sourceVertex.distanceTo(instanceVertex) < 0.000001, `Vertex ${i} changed its bind skin shape during normalization`);
  }
  for (let i = 0; i < 69; i++) {
    assert.notEqual(mesh.skeleton.bones[i], sourceMesh.skeleton.bones[i]);
    assert.notEqual(mesh.skeleton.boneInverses[i], sourceMesh.skeleton.boneInverses[i]);
    assert.deepEqual(mesh.skeleton.boneInverses[i].elements, sourceMesh.skeleton.boneInverses[i].elements);
    assert.deepEqual(mesh.skeleton.bones[i].position.toArray(), sourceTransforms[i].p.toArray());
    assert.deepEqual(mesh.skeleton.bones[i].quaternion.toArray(), sourceTransforms[i].q.toArray());
    assert.deepEqual(mesh.skeleton.bones[i].scale.toArray(), sourceTransforms[i].s.toArray());
  }
  for (let i = 0; i < 2; i++) {
    assert.notEqual(mesh.material[i], sourceMesh.material[i]);
    assert.notEqual(mesh.material[i], cloneMeshes[1 - which].material[i]);
    assert.equal(mesh.material[i].map, sourceMesh.material[i].map);
    assert.equal(mesh.material[i].normalMap, sourceMesh.material[i].normalMap);
  }
  const head = root.getObjectByName('mixamorigHead'), eye = root.getObjectByName('mixamorigLeftEye');
  assert.ok(eye.getWorldPosition(new THREE.Vector3()).z > head.getWorldPosition(new THREE.Vector3()).z, '+Z is the authored front');
}
const headA = instances[0].getObjectByName('mixamorigHead');
headA.rotation.y += .7;
cloneMeshes[0].skeleton.boneInverses[0].elements[0] += .1;
cloneMeshes[0].material[0].opacity = .3;
assert.deepEqual(instances[1].getObjectByName('mixamorigHead').quaternion.toArray(), sourceTransforms[boneNames.indexOf('mixamorigHead')].q.toArray());
assert.notEqual(cloneMeshes[0].skeleton.boneInverses[0].elements[0], cloneMeshes[1].skeleton.boneInverses[0].elements[0]);
assert.equal(sourceMesh.material[0].opacity, 1);
assert.equal(cloneMeshes[1].material[0].opacity, 1);
// Articulated finger bones must deform actual skin, without changing the other
// instance or the immutable source pose/weights.
const fingerName = 'mixamorigLeftHandIndex2', fingerIndex = boneNames.indexOf(fingerName);
let probe = -1;
for (let i = 0; i < weights.count && probe < 0; i++) for (let component = 0; component < 4; component++) {
  if (indices.getComponent(i, component) === fingerIndex && weights.getComponent(i, component) > .75) probe = i;
}
assert.ok(probe >= 0);
const before = cloneMeshes[1].getVertexPosition(probe, new THREE.Vector3()).applyMatrix4(cloneMeshes[1].matrixWorld);
instances[1].getObjectByName(fingerName).rotateX(.65);
instances[1].updateMatrixWorld(true);
const after = cloneMeshes[1].getVertexPosition(probe, new THREE.Vector3()).applyMatrix4(cloneMeshes[1].matrixWorld);
assert.ok(before.distanceTo(after) > .001, 'Finger rotation must move skinned surface, not only a skeleton helper');
assert.deepEqual(sourceMesh.skeleton.bones[fingerIndex].quaternion.toArray(), sourceTransforms[fingerIndex].q.toArray());
assert.throws(() => createGuardianInstance(null), /loaded/);
assert.throws(() => createGuardianInstance(new THREE.Group()), /no skinned mesh/);

// LoadingManager must wait for all four asynchronous image requests; texture
// failure and invalid FBX must reject honestly instead of exposing placeholders.
const server = http.createServer((request, response) => {
  if (request.url === '/bad.fbx') { response.writeHead(200, { 'Content-Type': 'application/octet-stream' }); response.end('invalid FBX'); return; }
  response.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': bytes.length }); response.end(bytes);
});
server.listen(0, '127.0.0.1');
await once(server, 'listening');
try {
  const url = `http://127.0.0.1:${server.address().port}/Guardiao.fbx`;
  installImageFixture({ delayMs: 45 });
  const start = performance.now(), loaded = await loadGuardianAsset(url);
  assert.ok(performance.now() - start >= 40);
  assert.equal(loaded.userData.guardianSource, url);
  assert.ok(loaded.getObjectByName('parasiteZombie').isSkinnedMesh);
  installImageFixture({ delayMs: 5, fail: true });
  await assert.rejects(loadGuardianAsset(url), /embedded texture resource/);
  installImageFixture();
  await assert.rejects(loadGuardianAsset(url.replace('Guardiao.fbx', 'bad.fbx')), /FBX/);
} finally {
  server.close();
  await once(server, 'close');
}
assert.equal(createHash('sha256').update(await fs.readFile(new URL('../../assets/Character/Guardiao.fbx', import.meta.url))).digest('hex'), SOURCE_HASH);
console.log(`GUARDIAN_ASSET_VERIFIED: 32568 actual skinned vertices; 69 bones; 30 weighted finger joints; 4 original embedded 2048 PNGs; independent normalized clones; full asynchronous loading/error checks. Texture pixels require browser verification.`);
