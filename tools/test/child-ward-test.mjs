// Geometry and lifecycle verification without a renderer or a fake browser.
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { CELL, WALL_T, PLAYER } from '../../src/config.js';
import { buildLayout } from '../../src/world/layout.js';
import { Grid } from '../../src/world/grid.js';
import { World } from '../../src/world/world.js';
import { makeMaterials } from '../../src/world/props.js';
import { ChildWard } from '../../src/world/child-ward.js';

const makeWorld = () => {
  const scene = new THREE.Scene(), world = new World(scene, {}), layout = buildLayout();
  // Use the real explicit and seeded procedural furniture routines, including
  // collectible bedside tables. Only map-poster rendering and item glint
  // textures (unrelated to placement/collision) need a renderer and are omitted.
  world.L = { ...layout, objects: layout.objects.filter(o => o.type !== 'mapPoster') };
  world.grid = new Grid(world.L);
  world.M = makeMaterials({ mat: {}, wall: {} });
  world._gt = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
  world._placeExplicit();
  world._scatter();
  return world;
};
const world = makeWorld(), grid = world.grid;
const originalBoxes = grid.boxes.map(boxes => boxes.slice()), originalNav = grid.navBlock.slice();
const originalHideSpots = world.hideSpots.map(spot => ({ spot, exit: spot.exitPos.clone(), inspect: spot.inspectPos.clone() }));
const ward = new ChildWard(world);
assert.equal(ward.startToy(), false, 'cannot animate a toy before it exists');
ward.reset(); ward.update(1);
assert.equal(ward.build(), ward);
assert.equal(ward.rooms.length, 6);
assert.equal(ward.hauntedRoomId, ward.rooms.find(r => r.x0 === 1 && r.y0 === 13).id);
assert.equal(ward.root.parent, world.scene, 'ward must survive the world static merge');
assert.equal(ward.toy.parent, ward.root);
assert.ok(ward.toy.position.isVector3);
const originalRootCount = world.scene.children.length, originalChildCount = ward.root.children.length;
ward.build();
assert.equal(world.scene.children.length, originalRootCount, 'build must be idempotent');
assert.equal(ward.root.children.length, originalChildCount);

// Every authored floor point belongs to exactly the expected room. Corridors,
// doors, partition cells, other floors and bad inputs never start a room visit.
for (const room of ward.rooms) {
  for (let y = room.y0; y <= room.y1; y++) for (let x = room.x0; x <= room.x1; x++) {
    for (const offset of [0.01, 0.5, 0.99]) assert.equal(ward.roomAt({ x: (x + offset) * CELL, y: 1.62, z: (y + offset) * CELL }), room.id);
  }
  const epsilon = 1e-4, z = (room.y0 + 0.5) * CELL;
  assert.equal(ward.roomAt({ x: room.x0 * CELL - epsilon, z }), null);
  assert.equal(ward.roomAt({ x: (room.x1 + 1) * CELL + epsilon, z }), null);
  assert.equal(ward.roomAt({ x: (room.x0 + 0.5) * CELL, z: room.y0 * CELL - epsilon }), null);
  assert.equal(ward.roomAt({ x: (room.x0 + 0.5) * CELL, z: (room.y1 + 1) * CELL + epsilon }), null);
}
for (const [x, y] of [[5, 13], [5, 26], [4, 14], [6, 14], [4, 18], [6, 18], [4, 22], [6, 22], [2, 16], [8, 20], [15, 17], [25, 23], [48, 16]]) {
  assert.equal(ward.roomAt({ x: grid.cx(x), y: 1.62, z: grid.cz(y) }), null, `exclude non-bedroom cell ${x},${y}`);
}
for (const position of [null, {}, { x: NaN, z: 18 }, { x: 3, z: Infinity }, { x: 3, y: NaN, z: 18 }, { x: 3, y: -4, z: 18 }, { x: 3, y: 8, z: 18 }]) assert.equal(ward.roomAt(position), null);

const overlapsXZ = (bounds, box, clearance = 0) =>
  bounds.max.x > box.x0 - clearance && bounds.min.x < box.x1 + clearance &&
  bounds.max.z > box.z0 - clearance && bounds.min.z < box.z1 + clearance;
const nearPoint = (bounds, point, radius) => {
  const x = Math.max(bounds.min.x, Math.min(bounds.max.x, point.x));
  const z = Math.max(bounds.min.z, Math.min(bounds.max.z, point.z));
  return Math.hypot(x - point.x, z - point.z) < radius;
};
// Positive controls ensure that the spatial absence assertions really fail on
// overlapping furniture or a prop put directly into a bed exit.
assert.equal(overlapsXZ(new THREE.Box3(new THREE.Vector3(0, 0, 0), new THREE.Vector3(1, 1, 1)), { x0: 0.2, x1: 0.8, z0: 0.2, z1: 0.8 }), true);
assert.equal(nearPoint(new THREE.Box3(new THREE.Vector3(0, 0, 0), new THREE.Vector3(1, 1, 1)), new THREE.Vector3(0.5, 0, 0.5), PLAYER.radius), true);

let vertexCount = 0, meshCount = 0;
const fingerprints = [];
for (const room of ward.rooms) {
  const group = ward.root.getObjectByName(room.id);
  assert.ok(group);
  const placements = group.userData.placements;
  assert.equal(placements.filter(p => p.kind === 'teddy').length, 1, 'each bedroom has a teddy');
  assert.equal(placements.filter(p => p.kind === 'drawings').length, 1, 'each bedroom has child-height artwork');
  assert.equal(placements.length, 3);
  const parts = group.children.flatMap(mesh => mesh.userData.parts);
  for (const required of ['round-head', 'intact-ear', 'torn-ear-stub', 'remaining-button-eye', 'missing-eye-socket', 'detached-arm', 'open-belly-seam', 'belly-stuffing', 'belly-seam-stitch', 'faded-signed-child-drawing']) assert.ok(parts.includes(required), `${room.id}: ${required}`);
  assert.equal(parts.filter(name => name === 'remaining-button-eye').length, 1, 'only one intact button eye');
  const extents = { x0: (room.x0 - 0.5) * CELL + WALL_T / 2, x1: (room.x1 + 1.5) * CELL - WALL_T / 2,
    z0: (room.y0 - 0.5) * CELL + WALL_T / 2, z1: (room.y1 + 1.5) * CELL - WALL_T / 2 };
  for (const mesh of group.children) {
    assert.ok(mesh.isMesh && mesh.geometry.isBufferGeometry);
    assert.ok(mesh.material.isMeshStandardMaterial && !mesh.material.emissive.getHex(), 'props do not add unearned light');
    const positions = mesh.geometry.attributes.position, normals = mesh.geometry.attributes.normal;
    vertexCount += positions.count; meshCount++;
    assert.equal(positions.count, normals.count);
    for (let n = 0; n < positions.count; n++) {
      const x = positions.getX(n), y = positions.getY(n), z = positions.getZ(n);
      assert.ok([x, y, z, normals.getX(n), normals.getY(n), normals.getZ(n)].every(Number.isFinite), 'finite geometry and normals');
      assert.ok(x >= extents.x0 - 1e-5 && x <= extents.x1 + 1e-5 && z >= extents.z0 - 1e-5 && z <= extents.z1 + 1e-5, `${room.id}: no wall penetration`);
      assert.ok(y >= -1e-5 && y <= 1.5, 'floor props and artwork stay at believable child scale');
    }
    fingerprints.push([mesh.name, Array.from(positions.array), mesh.material.map ? Array.from(mesh.material.map.image.data) : null]);
  }
  for (const placement of placements.filter(p => p.kind !== 'drawings')) {
    assert.ok(placement.bounds.max.y < 0.75, 'small toys are floor scale');
    for (const furniture of world.propBoxes) assert.equal(overlapsXZ(placement.bounds, furniture, 0.05), false, `${room.id}: toys do not intersect existing furniture`);
    for (const { exit, inspect } of originalHideSpots) {
      assert.equal(nearPoint(placement.bounds, exit, PLAYER.radius + 0.15), false, 'bed exits remain open');
      assert.equal(nearPoint(placement.bounds, inspect, PLAYER.radius + 0.15), false, 'bed interaction remains open');
    }
    const doorX = (room.x0 === 1 ? 4.5 : 6.5) * CELL, doorZ = (room.y0 + 1.5) * CELL;
    assert.equal(nearPoint(placement.bounds, new THREE.Vector3(doorX, 0, doorZ), CELL + 0.12), false, 'leave the entire door swing clear');
  }
}
assert.ok(vertexCount > 15000 && vertexCount < 180000, `bounded recognizable scenery, measured ${vertexCount} vertices`);
assert.ok(meshCount <= 78, `room batching bounds static draw calls, measured ${meshCount}`);
assert.equal(new Set(ward.root.children.filter(g => g.userData.roomId).map(g => g.userData.placements[1].kind)).size, 5, 'distinct toy types across bedrooms');

for (let i = 0; i < grid.boxes.length; i++) assert.deepEqual(grid.boxes[i], originalBoxes[i], 'visual props never change shared collision');
assert.deepEqual(grid.navBlock, originalNav, 'AI navigation is unchanged');
for (const { spot, exit, inspect } of originalHideSpots) {
  assert.ok(spot.exitPos.equals(exit) && spot.inspectPos.equals(inspect), 'hiding exit positions are unchanged');
}

const toySnapshot = () => {
  ward.toy.updateMatrixWorld(true);
  const matrices = [];
  ward.toy.traverse(obj => matrices.push(...obj.matrix.elements));
  return matrices;
};
const initial = toySnapshot(), initialPosition = ward.toy.position.clone();
assert.ok(ward.toy.getObjectByName('butterfly-winding-key'));
assert.equal(ward.toy.children.filter(g => g.children.some(m => m.name === 'duck-wheel')).length, 4);
ward.update(2); assert.deepEqual(toySnapshot(), initial, 'idle toy stays still');
assert.equal(ward.startToy(), true);
assert.equal(ward.startToy(), false, 'entry cannot restart an active haunt');
for (const invalid of [-1, NaN, Infinity, 0]) ward.update(invalid);
assert.deepEqual(toySnapshot(), initial, 'bad deltas never corrupt a toy');
ward.update(2.5);
assert.equal(ward.toyActive, true);
assert.ok(ward.toy.position.distanceTo(initialPosition) > 0.05, 'the toy travels rather than merely spinning');
assert.notDeepEqual(toySnapshot(), initial, 'clockwork and wheels animate');
const assertToyClear = () => {
  const bounds = new THREE.Box3().setFromObject(ward.toy);
  assert.equal(ward.roomAt(ward.toy.position), ward.hauntedRoomId);
  for (const furniture of world.propBoxes) assert.equal(overlapsXZ(bounds, furniture, 0.05), false, 'moving toy avoids furniture');
  for (const { exit } of originalHideSpots) assert.equal(nearPoint(bounds, exit, PLAYER.radius + 0.15), false, 'moving toy leaves bed exits clear');
  const r = ward.rooms[0], door = new THREE.Vector3(4.5 * CELL, 0, (r.y0 + 1.5) * CELL);
  assert.equal(nearPoint(bounds, door, CELL + 0.12), false, 'moving toy leaves the door swing clear');
};
assertToyClear();
for (let n = 0; n < 74; n++) { ward.update(0.1); assertToyClear(); }
assert.equal(ward.toyActive, true, 'still moving before 10 seconds');
ward.update(0.1);
assert.equal(ward.toyActive, false, 'the mechanical sequence stops at 10 seconds');
assert.equal(ward.toyElapsed, 10);
assert.ok(ward.toy.position.distanceTo(initialPosition) > 0.6, 'finish leaves a visibly moved toy');
const finalPose = toySnapshot();
ward.update(100); assert.deepEqual(toySnapshot(), finalPose, 'finished toy retains its last pose');
assert.equal(ward.startToy(), false, 'a finished toy cannot repeat until a run reset');
ward.reset(); assert.deepEqual(toySnapshot(), initial, 'reset restores every moving part');
assert.equal(ward.toyActive, false); assert.equal(ward.toyElapsed, 0);
ward.reset(); assert.deepEqual(toySnapshot(), initial, 'reset is idempotent');
ward.startToy(); ward.update(100);
assert.deepEqual(toySnapshot(), finalPose, 'a long frame reaches exactly the same final pose');
ward.reset(); ward.startToy(); ward.update(4.7); ward.reset();
assert.deepEqual(toySnapshot(), initial, 'reset also cancels a running toy');

const second = new ChildWard(makeWorld()).build();
const secondFingerprint = second.root.children.filter(g => g.userData.roomId).flatMap(g => g.children.map(mesh =>
  [mesh.name, Array.from(mesh.geometry.attributes.position.array), mesh.material.map ? Array.from(mesh.material.map.image.data) : null]));
assert.deepEqual(secondFingerprint, fingerprints, 'geometry and textures are deterministic');
assert.throws(() => new ChildWard({ scene: new THREE.Scene(), L: { rooms: [] } }).build(), /six patient bedrooms/, 'missing layout fails clearly');

console.log(`CHILD WARD VERIFIED: 6 bedrooms; ${meshCount} static meshes; ${vertexCount} static vertices; clear exits; deterministic 10s toy`);
