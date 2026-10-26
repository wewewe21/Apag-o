import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Grid } from '../../src/world/grid.js';
import { DoorCore } from '../../src/world/doorcore.js';
import { Door } from '../../src/world/doors.js';
import { CELL, WALL_H, WALL_T, DOOR_H, BASEMENT_Y } from '../../src/config.js';
import { HeadlessWorld, loadSpec } from '../../server/headless.js';
import { CREATURE_CLEARANCE, sampleCreatureClearance, gridBoxVerticalRange,
  doorLeafBox, pointBoxSignedDistance, pointObstaclePenetration,
  projectPointOutOfBox, projectPointOutOfObstacles, segmentBoxIntersection,
  sweepPointAgainstObstacles, segmentObstaclePenetration, projectBodyOutOfObstacles,
  sweepCircleAgainstBox,
} from '../../src/shared/creature-clearance.js';

let assertions = 0, meshLeafTransforms = 0;
const check = (v, message) => { assertions++; assert.ok(v, message); };
const close = (a, b, message, tolerance = 1e-6) => check(Math.abs(a - b) <= tolerance, `${message}: ${a} != ${b}`);
function makeGrid(axis = 'h', level = 0, kind = 'D') {
  const W = 11, H = 11;
  const rows = Array.from({ length: H }, () => Array(W).fill('.'));
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (x === 0 || y === 0 || x === W - 1 || y === H - 1 || (axis === 'h' ? y === 5 : x === 5)) rows[y][x] = '#';
  }
  rows[5][5] = kind;
  if (kind === 'X') rows[5][6] = 'X';
  const L = { W, H, grid: rows, zone: rows.map(r => r.map(() => 'r')), zones: { r: { level, wall: 'clinic', ceil: 'tiles' } }, objects: [] };
  return new Grid(L);
}
function spawnDoor(axis, level = 0, kind = 'D', mesh = false) {
  const g = makeGrid(axis, level, kind);
  let d;
  if (mesh) {
    const material = new THREE.MeshBasicMaterial();
    d = new Door({ grid: g, scene: new THREE.Group(), M: new Proxy({}, { get: () => material }) }, 5, 5, kind);
  } else d = new DoorCore(g, 5, 5, kind);
  return { g, d };
}
function position(d, signedDistance, lateral = 0) {
  return { x: d.cx + (d.axis === 'h' ? lateral : signedDistance), z: d.cz + (d.axis === 'h' ? signedDistance : lateral) };
}
function heading(axis, side) { return axis === 'h' ? (side < 0 ? 0 : Math.PI) : (side < 0 ? Math.PI / 2 : -Math.PI / 2); }
function sample(g, d, distance, side, speed = 1, out = {}, lateral = 0) {
  const p = position(d, side * distance, lateral);
  return sampleCreatureClearance(g, p.x, p.z, heading(d.axis, side), d.base, speed, 1 / 60, out);
}

// Actual Door mesh transforms are an independent oracle for the shared leaf
// geometry. Includes both DoorCore opening directions and both group rotations.
for (const axis of ['h', 'v']) for (const side of [-1, 1]) {
  const { g, d } = spawnDoor(axis, 0, 'D', true);
  const p = position(d, side * 1);
  d.setOpen(true, p.x, p.z);
  close(d.width, CELL - 0.18, 'actual one-cell opening');
  for (const open of [0, 0.1, 0.3, 0.49, 0.5, 0.6, 0.71, 0.72, 0.9, 1]) {
    meshLeafTransforms++;
    d.snap(open); d.group.updateMatrixWorld(true);
    const geometry = d.leaves[0].leaf.children[0];
    geometry.geometry.computeBoundingBox();
    const meshBox = geometry.geometry.boundingBox.clone().applyMatrix4(geometry.matrixWorld);
    const leaf = doorLeafBox(d);
    const center = meshBox.getCenter(new THREE.Vector3());
    close(leaf.cx, center.x, `${axis}/${side}/${open}: leaf center x`);
    close(leaf.cz, center.z, `${axis}/${side}/${open}: leaf center z`);
    close(leaf.y0, meshBox.min.y, 'leaf actual lower face', 1e-7);
    close(leaf.y1, meshBox.max.y, 'leaf actual upper face', 1e-7);
    check(leaf.x0 <= meshBox.min.x + 1e-7 && leaf.x1 >= meshBox.max.x - 1e-7 &&
      leaf.z0 <= meshBox.min.z + 1e-7 && leaf.z1 >= meshBox.max.z - 1e-7, 'OBB broad phase encloses visible main leaf');
    d.leaves[0].leaf.traverse(obj => {
      if (!obj.geometry) return;
      obj.geometry.computeBoundingBox();
      const bounds = obj.geometry.boundingBox;
      for (const x of [bounds.min.x, bounds.max.x]) for (const y of [bounds.min.y, bounds.max.y]) for (const z of [bounds.min.z, bounds.max.z]) {
        const vertex = new THREE.Vector3(x, y, z).applyMatrix4(obj.matrixWorld);
        check(pointBoxSignedDistance(vertex, leaf) <= 1e-7, 'leaf collision encloses every actual visible handle/window/kick plate vertex');
      }
    });
    const out = sample(g, d, 0.3, side);
    for (const frameMesh of d.group.children.filter(obj => obj.isMesh)) {
      frameMesh.geometry.computeBoundingBox();
      const bounds = frameMesh.geometry.boundingBox;
      for (const x of [bounds.min.x, bounds.max.x]) for (const y of [bounds.min.y, bounds.max.y]) for (const z of [bounds.min.z, bounds.max.z]) {
        const vertex = new THREE.Vector3(x, y, z).applyMatrix4(frameMesh.matrixWorld);
        check(out.obstacles.some(o => (o.kind === 'jamb' || o.kind === 'doorFrame') && pointBoxSignedDistance(vertex, o) <= 1e-7),
          'every actual visible jamb/linteltrim vertex is coveredby clearance');
      }
    }
    const leaves = out.obstacles.filter(o => o.kind === 'doorLeaf');
    check(leaves.length === 1, 'one rotating leaf remains even when Grid.boxActive drops it');
    check(out.obstacles.some(o => o.kind === 'closedDoor') === d.blocking(), 'DoorCore .72 threshold is authoritative');
    check(pointObstaclePenetration({ x: leaf.cx, y: 1.2, z: leaf.cz }, 0.035, leaves) > 0.03, 'positive visible-leaf collision control');
    if (open === 1) {
      check(!g.boxActive(d.box), 'actual Grid stops colliding the original slab at full opening');
      check(pointObstaclePenetration({ x: leaf.cx, y: 1.2, z: leaf.cz }, 0.035, out.obstacles) > 0.03,
        'clearance still collides the actual fully open rotated leaf');
    }
  }
}

let smallestAnticipation = Infinity, longestHold = 0;
for (const axis of ['h', 'v']) for (const side of [-1, 1]) for (const level of [0, -1]) {
  const { g, d } = spawnDoor(axis, level); d.open = 1; d.dir = axis === 'h' ? side : -side;
  const out = sample(g, d, 1.55, side, 1.2);
  check(out.duck > 0, `${axis}/${side}/${level}: starts duck before leading head reaches wall`);
  smallestAnticipation = Math.min(smallestAnticipation, out.duck);
  const walk = sample(g, d, 2.1, side, 1.1);
  const run = sample(g, d, 2.1, side, 3.6);
  check(run.duck > walk.duck, 'run predicts farther ahead than walk');
  for (const distance of [0.8, 0.25, 0, -0.25, -0.8]) {
    sample(g, d, distance, side, 1.2, out);
    check(out.door !== null, 'door descriptor persists while front/trailing body intersects doorway');
    close(out.door.ceilingY, d.base + DOOR_H, 'door has true2.2m lintel');
    close(out.door.passageCeilingY, d.base + DOOR_H - 0.05, 'visibleupperframe is actualminimum passageheight');
    close(out.door.base, level < 0 ? BASEMENT_Y : 0, 'door base agrees in basement');
    check(out.door.approachSide === side, 'brace stays on approach face through crossing');
    check(out.duck >= (3 + 0.045 - DOOR_H) / 0.95 - 1e-7, 'full duck held for long upper body on both sides');
    const top = d.base + 3 - out.duck * 0.95;
    check(top <= d.base + DOOR_H - 0.05 - 0.044, 'requested upper envelope stays below visibleframe with safety margin');
    longestHold = Math.max(longestHold, Math.abs(distance));
    const lintel = out.obstacles.find(o => o.kind === 'lintel');
    const head = { x: d.cx, y: d.base + 2.85, z: d.cz };
    check(pointObstaclePenetration(head, 0.15, [lintel]) > 0.1, 'standing3m head positively intersects actual lintel');
    head.y = top - 0.15;
    check(pointObstaclePenetration(head, 0.15, [lintel]) < 1e-7, 'ducked3m head clears actual lintel');
    check(pointObstaclePenetration(head, 0.15, out.obstacles.filter(o => o.kind === 'doorFrame')) < 1e-7, 'ducked3m head clears actual loweruppertrim');
    for (const jamb of [out.door.jambLeft, out.door.jambRight]) {
      check(jamb.accessible, 'approach wall brace lies outside jamb/wall/leaf');
      check(pointObstaclePenetration(jamb, 0.075, out.obstacles) < 1e-6, 'palm safelyoffset including .075m skin thickness');
      const tip = { x: jamb.x + jamb.tx * 0.297, y: jamb.y, z: jamb.z + jamb.tz * 0.297 };
      check(!segmentObstaclePenetration(jamb, tip, 0.03, out.obstacles).hit, 'authored .297m long digits clear wall along support tangent');
    }
  }
  sample(g, d, -1.35, side, 1.2, out);
  for (let i = 0; i < 60; i++) sample(g, d, -2.7, side, 1.2, out);
  check(out.door === null && out.duck === 0, 'releases only after trailing upper body has cleared');
  close(out.ceilingY, d.base + WALL_H, 'returns to real room3.2m ceiling');
  const away = position(d, side * 2);
  const retreat = sampleCreatureClearance(g, away.x, away.z, heading(axis, -side), d.base, 3, 1 / 60, {});
  check(retreat.duck === 0, 'distant retreat from doorway does not pre-duck');
  check(sample(g, d, 0.2, side, 1.2, {}, 1.4).door === null, 'unrelated nearby wall is not an opening');
  const diagonal = position(d, side * 1.5, 1.2);
  const diagonalYaw = Math.atan2((d.axis === 'h' ? -1.2 : -side * 1.5), (d.axis === 'h' ? -side * 1.5 : -1.2));
  check(sampleCreatureClearance(g, diagonal.x, diagonal.z, diagonalYaw, d.base, 2, 1 / 60, {}).duck > 0,
    'predicts diagonal approach whose currentlateral position is outside opening');
}

for (const axis of ['h', 'v']) for (const kind of ['D', 'K', 'J']) for (const side of [-1, 1]) {
  const { g, d } = spawnDoor(axis, 0, kind);
  const p = position(d, side * 0.6);
  const out = sampleCreatureClearance(g, p.x, p.z, heading(axis, side), d.base, 4, 0.25, {});
  check(out.sweep.blocked, 'closed/locked/jammed doorway blocks movement despite duck');
  check(out.sweep.t < 1, 'continuous body sweep stops before closed door');
  check(['closedDoor', 'doorLeaf', 'doorBar'].includes(out.sweep.obstacle?.kind), 'blocked by physical leaf, jam pipe or DoorCore blocker');
}

// Exit is physically a two-leaf2.7m opening, without a fictional middle jamb.
{
  const { g, d } = spawnDoor('h', 0, 'X'); d.open = 1;
  const out = sample(g, d, 0, -1);
  close(out.door.ceilingY, 2.7, 'exit lintel actual builder exception');
  close(out.door.width, 2 * CELL - 0.18, 'exit actual width');
  check(out.obstacles.filter(o => o.kind === 'doorLeaf').length === 2, 'both mirrored exit leaves are sampled');
  check(!out.obstacles.some(o => o.kind === 'jamb' && Math.abs((o.x0 + o.x1) / 2 - d.cx) < 0.2), 'Grid exit has no fake centre jamb');
}

// Geometry controls: clear endpoints can enclose a colliding neck/finger and a
// fast sphere can cross a leaf entirely within a single frame.
{
  const box = { x0: -0.1, x1: 0.1, y0: 0, y1: 3.2, z0: -0.8, z1: 0.8 };
  const a = { x: -1, y: 2.5, z: 0 }, b = { x: 1, y: 2.5, z: 0 };
  check(pointObstaclePenetration(a, 0.08, [box]) === 0 && pointObstaclePenetration(b, 0.08, [box]) === 0, 'both neck endpoints are clear positivecontrol');
  check(segmentObstaclePenetration(a, b, 0.08, [box]).hit, 'whole long neck capsule detects middle penetration');
  const hit = sweepPointAgainstObstacles(a, b, 0.18, [box]);
  check(hit.hit && hit.t > 0 && hit.t < 0.5, 'fast head sphere sweep cannot tunnel');
  check(pointBoxSignedDistance(hit, box) >= 0.18, 'sweep stops sphere before surface');
  check(!segmentBoxIntersection({ x: -1, y: 4, z: 0 }, { x: 1, y: 4, z: 0 }, box, 0.1).hit, 'segment above prop is actually clear');
  check(!segmentBoxIntersection({ x: -1, y: 1, z: 1.1 }, { x: 1, y: 1, z: 1.1 }, box, 0.1).hit, 'side clearance negativecontrol');
  for (const point of [{ x: 0, y: 2, z: 0 }, { x: 0.12, y: 2, z: 0 }, { x: 0.13, y: 2, z: 0.83 }]) {
    const projected = projectPointOutOfBox(point, 0.15, box);
    check(projected.collided, 'point projection positively corrects intersecting head/hand');
    check(pointBoxSignedDistance(projected, box) >= 0.15 - 1e-7, 'exact sphere projection resolves side/corner/interior');
  }
  const projected = projectPointOutOfObstacles({ x: 0, y: 2, z: 0 }, 0.2, [box]);
  check(projected.resolved && projected.penetration >= 0.2 && projected.remainingPenetration < 1e-7, 'multiple-obstacle projection reports originalandremaining collision');
  const rotated = { cx: 0, cz: 0, hx: 0.8, hz: 0.03, yaw: 0.7, y0: 0, y1: 2.15 };
  check(pointBoxSignedDistance({ x: 0, y: 1, z: 0 }, rotated) < 0, 'point detects oriented leaf interior');
  check(projectPointOutOfObstacles({ x: 0, y: 1, z: 0 }, 0.05, [rotated]).resolved, 'oriented leaf projection resolves');
  const body = projectBodyOutOfObstacles({ x: 0, y: 0, z: 0 }, 0.29, 0.1, 2.15, [rotated]);
  check(body.collided && body.resolved && body.y === 0, 'body exits a swinging leaf horizontallywithoutchanginggroundheight');
  const lintel = { ...box, y0: 2.2, y1: 3.2 };
  const ducked = projectBodyOutOfObstacles({ x: 0, y: 0, z: 0 }, 0.29, 0.1, 2.15, [lintel]);
  check(!ducked.collided, 'ducked fullbody passes below actual lintel');
}

// Root circles need exact rounded-corner continuous collision. A conservative
// capsule slab at t0 can trap the root outside the real circle footprint.
let roundedSweepControls = 0;
{
  const box = { x0: -1, x1: 1, y0: 0, y1: 3.2, z0: -1, z1: 1 };
  for (const xSign of [-1, 1]) for (const zSign of [-1, 1]) {
    const a = { x: xSign * 2, y: 1, z: zSign * 2 }, b = { x: 0, y: 1, z: 0 };
    const hit = sweepCircleAgainstBox(a, b, box, 0.5);
    const expected = (1 - 0.5 / Math.SQRT2) * 0.5;
    check(hit.hit, 'all four quadratic corner arcs positively block fast circle');
    close(hit.t, expected, 'corner time is exact quadratic root');
    close(hit.nx, xSign / Math.SQRT2, 'exact roundedcorner normal x');
    close(hit.nz, zSign / Math.SQRT2, 'exact roundedcorner normal z');
    const q = { x: a.x + (b.x - a.x) * hit.t, y: 1, z: a.z + (b.z - a.z) * hit.t };
    close(pointBoxSignedDistance(q, box), 0.5, 'reportedcorner contact has actual circle clearance');
    const falseCorner = { x: xSign * 1.4, y: 1, z: zSign * 1.4 };
    const away = { x: xSign * 1.6, y: 1, z: zSign * 1.6 };
    check(segmentBoxIntersection(falseCorner, away, box, 0.5).hit, 'originalslab positivecontrol detects its false t0 corner');
    check(!sweepCircleAgainstBox(falseCorner, away, box, 0.5).hit, 'clear circle leaves squarebroadphase corner freely');
    const toward = sweepCircleAgainstBox(falseCorner, b, box, 0.5);
    check(toward.hit && toward.t > 0, 'sameinitiallyclearcorner stops on actual arc when movinginward');
    close(toward.t, (0.4 - 0.5 / Math.SQRT2) / 1.4, 'clearcorner inwardtime matches true arc contact');
    roundedSweepControls += 3;
  }
  for (let axis = 0; axis < 2; axis++) for (const sign of [-1, 1]) {
    const a = { x: axis === 0 ? sign * 3 : 0, y: 1, z: axis === 1 ? sign * 3 : 0 };
    const b = { x: -a.x, y: 1, z: -a.z };
    const hit = sweepCircleAgainstBox(a, b, box, 0.5);
    close(hit.t, 0.25, 'four exact offsetface times');
    close(hit.nx, axis === 0 ? sign : 0, 'face outwardnormal x');
    close(hit.nz, axis === 1 ? sign : 0, 'face outwardnormal z');
    const touch = { x: axis === 0 ? sign * 1.5 : 0, y: 1, z: axis === 1 ? sign * 1.5 : 0 };
    check(!sweepCircleAgainstBox(touch, a, box, 0.5).hit, 'circle touching face may move outward');
    check(sweepCircleAgainstBox(touch, b, box, 0.5).t === 0, 'touching face moving inward stops immediately');
    roundedSweepControls += 3;
  }
  check(!sweepCircleAgainstBox({ x: -1.5, y: 1, z: -2 }, { x: -1.5, y: 1, z: 2 }, box, 0.5).hit, 'tangent face/corner skim is free without skininteriorpenetration');
  check(sweepCircleAgainstBox({ x: 0, y: 1, z: 0 }, { x: 4, y: 1, z: 0 }, box, 0.5).t === 0, 'actualinitialpenetration remains explicitfailclosed');
  const rotated = { cx: 3, cz: 4, hx: 1, hz: 1, yaw: 0.73, y0: 0, y1: 3.2 };
  const transform = p => ({ x: rotated.cx + Math.cos(rotated.yaw) * p.x + Math.sin(rotated.yaw) * p.z,
    y: 1, z: rotated.cz - Math.sin(rotated.yaw) * p.x + Math.cos(rotated.yaw) * p.z });
  const hit = sweepCircleAgainstBox(transform({ x: -2, z: -2 }), transform({ x: 0, z: 0 }), rotated, 0.5);
  close(hit.t, (1 - 0.5 / Math.SQRT2) * 0.5, 'OBB rotation preserves exact quadraticcorner time');
  close(Math.hypot(hit.nx, hit.nz), 1, 'OBB cornerworld normal remains normalized');
  const thin = { x0: -0.025, x1: 0.025, y0: 0, y1: 2.15, z0: -0.5, z1: 0.5 };
  check(sweepCircleAgainstBox({ x: -2, y: 1, z: 0 }, { x: 2, y: 1, z: 0 }, thin, 0.38).hit, 'positive thin leaf control cannot tunnel at4m perframe');
  const jamb = { x0: 26.16, x1: 26.25, y0: 0, y1: 3.2, z0: 11.74, z1: 12.01 };
  const a = { x: 25.78, y: 0.95, z: 12.1 }, b = { x: 25.7690103081316, y: 0.95, z: 12.172673768807167 };
  check(pointBoxSignedDistance(a, jamb) > 0.38 && pointBoxSignedDistance(b, jamb) > 0.38, 'originalseed42 jambstuck fixture is physically clear');
  check(segmentBoxIntersection(a, b, jamb, 0.38).t === 0, 'originalseed42 squarecorner reproduces false blockedt0');
  check(!sweepCircleAgainstBox(a, b, jamb, 0.38).hit, 'exactcircle fixes originalseed42 jambstuck fixture');
  roundedSweepControls += 8;
}

// Independent complete-segment minimum distance oracle: intersection with the
// original rectangle, endpoint-to-box distance and four corner-to-segment
// distances. It does not reuse the quadratic sweep's face/corner entry solver.
const exactOracleCases = 256;
{
  let seed = 305419896;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  for (let i = 0; i < exactOracleCases; i++) {
    const box = { cx: 3, cz: 5, hx: 0.1 + random(), hz: 0.1 + random(), yaw: random() * Math.PI * 2, y0: 0, y1: 3.2 };
    const transform = new THREE.Matrix4().makeRotationY(box.yaw); transform.setPosition(box.cx, 0, box.cz);
    const a = new THREE.Vector3(random() * 6 - 3, 1, random() * 6 - 3).applyMatrix4(transform);
    const b = new THREE.Vector3(random() * 6 - 3, 1, random() * 6 - 3).applyMatrix4(transform);
    const radius = 0.05 + random() * 0.45;
    let distance = segmentBoxIntersection(a, b, box, 0, {}, true).hit ? 0
      : Math.min(pointBoxSignedDistance(a, box), pointBoxSignedDistance(b, box));
    const dx = b.x - a.x, dz = b.z - a.z, length2 = dx * dx + dz * dz;
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      const corner = new THREE.Vector3(sx * box.hx, 1, sz * box.hz).applyMatrix4(transform);
      const t = Math.max(0, Math.min(1, ((corner.x - a.x) * dx + (corner.z - a.z) * dz) / Math.max(1e-12, length2)));
      distance = Math.min(distance, Math.hypot(corner.x - a.x - dx * t, corner.z - a.z - dz * t));
    }
    const hit = sweepCircleAgainstBox(a, b, box, radius);
    check(hit.hit === (distance < radius), 'exact OBB sweep matches independent full-segmentdistance oracle');
    if (hit.hit && hit.t > 1e-7) {
      const contact = { x: a.x + dx * hit.t, y: 1, z: a.z + dz * hit.t };
      close(pointBoxSignedDistance(contact, box), radius, 'random exactfirst contact retains full radius', 1e-6);
      close(Math.hypot(hit.nx, hit.nz), 1, 'random cornerandface normal is unit length', 1e-6);
    }
  }
}

// Vertical metadata is used when available; old WorldSpec2D boxes cannot safely
// invent a shelf/table height and remain conservative on both hosts.
{
  const g = makeGrid('h', -1);
  const footprint = { x0: 2, x1: 2.5, z0: 2, z1: 2.5, prop: true };
  close(gridBoxVerticalRange(g, footprint).y1, BASEMENT_Y + WALL_H, 'untyped legacyprop conservative fullheight');
  close(gridBoxVerticalRange(g, { ...footprint, propType: 'locker' }).y1, BASEMENT_Y + 1.92, 'typed locker uses actual authored height');
  close(gridBoxVerticalRange(g, { ...footprint, propType: 'shelf' }).y1, BASEMENT_Y + 2.37, 'shelf includes top contents above2.05frame');
  close(gridBoxVerticalRange(g, { ...footprint, y0: -3.9, y1: -2.75 }).y1, -2.75, 'explicit mesh bounds override inferred type');
  const low = g.addBox({ ...footprint, y0: BASEMENT_Y, y1: BASEMENT_Y + 0.7 });
  const out = sampleCreatureClearance(g, 2.1, 2.1, 0, BASEMENT_Y, 1, 1 / 60, {});
  const obstacle = out.obstacles.find(o => o.source === low);
  check(!!obstacle, 'actualGrid explicit lowprop candidate');
  check(pointObstaclePenetration({ x: 2.2, y: BASEMENT_Y + 2, z: 2.2 }, 0.15, [obstacle]) === 0, 'head over actual lowprop is clear');
  check(pointObstaclePenetration({ x: 2.2, y: BASEMENT_Y + 0.4, z: 2.2 }, 0.15, [obstacle]) > 0.1, 'sameprop blocks lower limbs');
  low.disabled = true;
  sampleCreatureClearance(g, 2.1, 2.1, 0, BASEMENT_Y, 1, 1 / 60, out);
  check(!out.obstacles.some(o => o.source === low), 'disabledprop disappears immediately');
  g.L.zones.r.ceil = 'sky';
  close(sampleCreatureClearance(g, 2.1, 2.1, 0, BASEMENT_Y, 0, 0, {}).duck, 0, 'outside sky has no invented ceilingduck');
}

// Real deployed WorldSpec creates the same Grid/DoorCore state as multiplayer.
// Exercise every real door, both sides; compare all geometry to its actual base.
const world = new HeadlessWorld(loadSpec());
{
  const wall = world.grid.wallBoxes.find(b => b.kind === 'wall' && b.gx === 47 && b.gy === 1);
  check(!!wall && world.grid.zoneCfg(wall.gx, wall.gy) === null, 'actualbasementwall positivecontrol hasunassignedwallcellzone');
  const range = gridBoxVerticalRange(world.grid, wall);
  close(range.y0, BASEMENT_Y - 0.05, 'wallrange uses actual adjacentbasementfloor quadrant');
  close(range.y1, BASEMENT_Y + WALL_H + 0.05, 'actualbasementwall top matchesbuilder');
  const obstacle = { ...wall, ...range };
  const skull = { x: (wall.x0 + wall.x1) * 0.5, y: BASEMENT_Y + 2.5, z: (wall.z0 + wall.z1) * 0.5 };
  check(pointObstaclePenetration(skull, 0.18, [obstacle]) > 0.18, 'realbasementwall collides3m skinwalkerhead');
  check(projectPointOutOfObstacles(skull, 0.18, [obstacle]).resolved, 'realbasementwall headprojection resolves');
}
let worldChecks = 0, maxWorldCandidates = 0, maxWorldCells = 0;
for (const d of world.doors) {
  for (const side of [-1, 1]) {
    const out = sample(world.grid, d, 0, side, 3.6);
    check(out.doors.some(desc => desc.source === d), 'WorldSpecactual door enterslocal candidate set');
    const desc = out.doors.find(desc => desc.source === d);
    close(desc.ceilingY, d.base + (d.exit ? 2.7 : DOOR_H), 'WorldSpectrue lintelheight');
    check(out.obstacles.some(o => o.kind === 'closedDoor' && o.source === d), 'WorldSpecclosedleaf retains physicalblocker');
    check(out.obstacles.length <= CREATURE_CLEARANCE.maxObstacles && out.cellsVisited <= 81, 'realworld queries remain boundedlocal');
    maxWorldCandidates = Math.max(maxWorldCandidates, out.obstacles.length);
    maxWorldCells = Math.max(maxWorldCells, out.cellsVisited);
    worldChecks++;
  }
}
check(world.doors.some(d => d.axis === 'v') && world.doors.some(d => d.axis === 'h') && world.doors.some(d => d.base === BASEMENT_Y), 'realmap both axesandbasement exercised');
{
  const { g, d } = spawnDoor('h');
  const out = sample(g, d, 0, -1, 3);
  const array = out.obstacles, pool = out._pool, descriptorPool = out._doorPool, first = out.obstacles[0], sweep = out.sweep;
  for (let i = 0; i < 1000; i++) sample(g, d, 0.5 + (i % 10) * 0.01, -1, 3, out);
  check(out.obstacles === array && out._pool === pool && out._doorPool === descriptorPool && out.obstacles[0] === first && out.sweep === sweep, '1000frames reuse boundedobjects and arrays');
  for (let i = 0; i < 200; i++) g.addBox({ x0: d.cx - 0.2, x1: d.cx + 0.2, z0: d.cz - 0.2, z1: d.cz + 0.2, prop: true });
  sample(g, d, 0, -1, 3, out);
  check(out.obstacles.length === CREATURE_CLEARANCE.maxObstacles && out.overflow && out.sweep.blocked && out.sweep.t === 0, 'candidate overflow boundedandexplicitly failsclosed');
  check(out._seen.size <= CREATURE_CLEARANCE.maxObstacles + 1, 'overflow doesnot growframe deduplicationset beyondboundedcandidates');
}

console.log(JSON.stringify({ assertions, realWorldDoorSides: worldChecks, maxWorldCandidates, maxWorldCells, minimumAnticipatoryDuck: smallestAnticipation,
  verifiedTrailingDistance: longestHold, height: CREATURE_CLEARANCE.height, doorHeight: DOOR_H,
  wallHeight: WALL_H, wallThickness: WALL_T, candidateLimit: CREATURE_CLEARANCE.maxObstacles,
  meshLeafTransforms, reusedFrames: 1000, roundedSweepControls, exactOracleCases }));
console.log('SKINWALKER_CLEARANCE_VERIFIED');
