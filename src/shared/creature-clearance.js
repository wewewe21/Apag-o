// Pure, shared geometry for the three-metre skinwalker. No scene/THREE dependency.
// Pass the same `out` each frame: candidate objects, sets, descriptors and helper
// results are reused. DoorCore's navigation box and the visible hinged leaf are
// deliberately separate obstacles: opening past .72 does not remove the mesh.
import { WALL_T, WALL_H, DOOR_H, BASEMENT_Y } from '../config.js';
import { DOOR_JAM } from '../world/doorcore.js';

export const CREATURE_CLEARANCE = Object.freeze({
  height: 3, bodyRadius: 0.29, headRadius: 0.18, front: 0.68, rear: 0.68,
  margin: 0.045, reactionTime: 0.72, maxLookAhead: 3.6,
  maxObstacles: 128, maxDoors: 16,
});
const EPS = 1e-8;
const EMPTY = Object.freeze([]);
const wallRanges = new WeakMap();
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const smooth = t => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
const finite = (v, fallback) => Number.isFinite(v) ? v : fallback;
const propHeights = Object.freeze({ locker: 1.92, shelf: 2.37, cabinet: 1.8,
  filingCabinet: 1.35, nightstand: 0.62, sideTable: 0.62, cart: 1.03,
  bed: 1.025, gurney: 1.2, autopsyTable: 1.03, nurseStation: 1.42,
  boiler: 3.3, generator: 3.14, incinerator: 3.45, barrel: 0.915,
  trashBin: 0.565, bench: 0.94, radiator: 0.76, sink: 1.145 });

function surfaceZone(grid, x, z) {
  const gx = grid.cellX(x), gy = grid.cellY(z);
  let cfg = grid.zoneCfg?.(gx, gy);
  if (grid.isWallish?.(gx, gy) && grid.quadCell) {
    const q = grid.quadCell(gx, gy, x >= grid.cx(gx) ? 1 : -1, z >= grid.cz(gy) ? 1 : -1);
    if (q) cfg = grid.zoneCfg(q[0], q[1]) || cfg;
  }
  return cfg;
}

function makeDescriptor() {
  return { jambLeft: {}, jambRight: {}, source: null };
}
function scratch(out) {
  if (!out._pool) {
    out._pool = Array.from({ length: CREATURE_CLEARANCE.maxObstacles }, () => ({}));
    out._doorPool = Array.from({ length: CREATURE_CLEARANCE.maxDoors }, makeDescriptor);
    out._seen = new Set(); out._doorsSeen = new Set();
    out.obstacles = []; out.doors = []; out.sweep = {}; out._hit = {};
  }
  out.obstacles.length = 0; out.doors.length = 0;
  out._seen.clear(); out._doorsSeen.clear(); out.overflow = false;
  return out;
}

// Accept authored explicit vertical metadata; an untyped legacy 2D prop box is
// conservatively full-height. This keeps client and WorldSpec reconstructions
// identical without guessing furniture heights from only its footprint.
export function gridBoxVerticalRange(grid, b, out = {}) {
  const gx = finite(b.gx, grid.cellX((b.x0 + b.x1) * 0.5));
  const gy = finite(b.gy, grid.cellY((b.z0 + b.z1) * 0.5));
  const base = finite(b.base, grid.levelBase?.(gx, gy) ??
    ((grid.zoneCfg?.(gx, gy)?.level ?? 0) < 0 ? BASEMENT_Y : 0));
  const type = b.propType || b.type || b.kind;
  const h = finite(b.height, finite(b.h, finite(b.top, propHeights[type] ?? WALL_H)));
  out.y0 = finite(b.y0, finite(b.minY, base - (b.kind && !b.prop ? 0.05 : 0)));
  out.y1 = finite(b.y1, finite(b.maxY, base + h + (b.kind && !b.prop ? 0.05 : 0)));
  if (b.kind === 'wall' || b.kind === 'jamb' || b.kind === 'drawers') {
    let cache = wallRanges.get(grid);
    if (!cache) { cache = new WeakMap(); wallRanges.set(grid, cache); }
    const cached = cache.get(b);
    if (cached) {
      out.y0 = finite(b.y0, finite(b.minY, cached.y0));
      out.y1 = finite(b.y1, finite(b.maxY, cached.y1));
      return out;
    }
    // Most real wall cells have *no* zone. Builder assigns each visible face
    // the adjacent floor quadrant; using levelBase(wallCell) silently creates
    // ground-floor walls in the basement. Union those actual face ranges.
    let lower = Infinity, upper = -Infinity;
    for (let edge = 0; edge < 4; edge++) for (let quarter = 0; quarter < 2; quarter++) {
      const t = quarter === 0 ? 0.25 : 0.75;
      const sx = edge < 2 ? b.x0 + (b.x1 - b.x0) * t : edge === 2 ? b.x0 - 0.04 : b.x1 + 0.04;
      const sz = edge >= 2 ? b.z0 + (b.z1 - b.z0) * t : edge === 0 ? b.z0 - 0.04 : b.z1 + 0.04;
      const zone = surfaceZone(grid, sx, sz);
      if (!zone) continue;
      const floor = zone.level < 0 ? BASEMENT_Y : 0;
      lower = Math.min(lower, floor - 0.05);
      upper = Math.max(upper, floor + (zone.outside ? 3.4 : WALL_H + 0.05));
    }
    if (grid.zoneCfg?.(gx, gy)?.stairs || grid.stairAt?.(gx, gy)) {
      lower = Math.min(lower, BASEMENT_Y - 0.05); upper = Math.max(upper, WALL_H + 0.05);
    }
    if (lower !== Infinity) out.y0 = finite(b.y0, finite(b.minY, lower));
    if (upper !== -Infinity) out.y1 = finite(b.y1, finite(b.maxY, upper));
    cache.set(b, { y0: lower === Infinity ? out.y0 : lower, y1: upper === -Infinity ? out.y1 : upper });
  }
  return out;
}

function setBox(o, x0, x1, y0, y1, z0, z1, kind, source) {
  o.x0 = x0; o.x1 = x1; o.y0 = y0; o.y1 = y1; o.z0 = z0; o.z1 = z1;
  o.cx = (x0 + x1) * 0.5; o.cz = (z0 + z1) * 0.5;
  o.hx = (x1 - x0) * 0.5; o.hz = (z1 - z0) * 0.5; o.yaw = 0;
  o.kind = kind; o.source = source; o.blocking = true; return o;
}
function candidate(out) {
  if (out.obstacles.length === CREATURE_CLEARANCE.maxObstacles) { out.overflow = true; return null; }
  const o = out._pool[out.obstacles.length]; out.obstacles.push(o); return o;
}
function doorAngle(d) {
  const t = clamp(finite(d.open, 0), 0, 1);
  return (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 * 0.5) * 1.5;
}
// Exact main slab transform from Door._pose/_buildMesh, including the v-axis
// group's -PI/2 rotation, mirrored exit leaf, inset .005 and mesh thickness.
export function doorLeafBox(d, leafIndex = 0, out = {}) {
  const exit = d.exit || d.kind === 'X', width = d.width;
  const lw = exit ? width * 0.5 : width;
  const flip = exit && leafIndex === 1 ? -1 : 1;
  const angle = exit ? (leafIndex === 0 ? -1 : 1) * doorAngle(d) : finite(d.dir, 1) * doorAngle(d);
  const groupYaw = d.axis === 'v' ? -Math.PI / 2 : 0;
  const hinge = exit && leafIndex === 1 ? width * 0.5 : -width * 0.5;
  const lx = hinge + Math.cos(angle) * flip * lw * 0.5;
  const lz = -Math.sin(angle) * flip * lw * 0.5;
  const c = Math.cos(groupYaw), s = Math.sin(groupYaw);
  out.cx = d.cx + c * lx + s * lz; out.cz = d.cz - s * lx + c * lz;
  // Includes handles, kick plate/window trim and, for K/X, lock/push bars.
  // These remain visible even when the thin main slab is entirely open.
  out.hx = Math.max(0, (lw - 0.01) * 0.5);
  out.hz = exit || d.kind === 'K' ? 0.09 : 0.06;
  out.yaw = groupYaw + angle;
  out.y0 = d.base + 0.005; out.y1 = d.base + (exit ? 2.62 : DOOR_H - 0.05) - 0.005;
  const ex = Math.abs(Math.cos(out.yaw)) * out.hx + Math.abs(Math.sin(out.yaw)) * out.hz;
  const ez = Math.abs(Math.sin(out.yaw)) * out.hx + Math.abs(Math.cos(out.yaw)) * out.hz;
  out.x0 = out.cx - ex; out.x1 = out.cx + ex; out.z0 = out.cz - ez; out.z1 = out.cz + ez;
  out.kind = 'doorLeaf'; out.source = d; out.blocking = true; return out;
}

function describeDoor(d, x, z, out, previousSource, previousSide) {
  out.source = d; out.cx = d.cx; out.cz = d.cz; out.axis = d.axis;
  out.width = d.width; out.base = d.base; out.ceilingY = d.base + (d.exit || d.kind === 'X' ? 2.7 : DOOR_H);
  out.passageCeilingY = d.base + (d.exit || d.kind === 'X' ? 2.62 : DOOR_H - 0.05);
  out.signedDistance = d.axis === 'h' ? z - d.cz : x - d.cx;
  out.approachSide = previousSource === d && Math.abs(out.signedDistance) < 1.35
    ? previousSide : (out.signedDistance < 0 ? -1 : 1);
  out.blocking = typeof d.blocking === 'function' ? d.blocking() : finite(d.open, 0) < 0.72;
  out.locked = !!d.locked; out.jammed = !!d.jammed; out.exit = !!d.exit;
  out.open = finite(d.open, 0); out.angle = doorAngle(d);
  const side = out.approachSide, n = WALL_T * 0.5 + 0.035 + 0.085;
  for (let i = 0; i < 2; i++) {
    const j = i === 0 ? out.jambLeft : out.jambRight;
    const along = (i === 0 ? -1 : 1) * (d.width * 0.5 + DOOR_JAM * 0.5);
    j.x = d.cx + (d.axis === 'h' ? along : side * n);
    j.z = d.cz + (d.axis === 'h' ? side * n : along);
    j.y = d.base + 1.55;
    j.nx = d.axis === 'v' ? side : 0; j.ny = 0; j.nz = d.axis === 'h' ? side : 0;
    // Long digits point along the wall away from the opening, not into a leaf.
    j.tx = d.axis === 'h' ? (i === 0 ? -1 : 1) : 0;
    j.tz = d.axis === 'v' ? (i === 0 ? -1 : 1) : 0;
    j.accessible = true;
  }
  return out;
}

function roomCeiling(grid, x, z, fallback) {
  const cfg = surfaceZone(grid, x, z);
  if (cfg?.ceil === 'sky') return Infinity;
  const floor = finite(grid.floorY?.(x, z), fallback);
  return floor + finite(cfg?.height, WALL_H);
}

/** Sample bounded nearby geometry and predictive doorway pose demand.
 * +z is forward at yaw0. Options may be supplied as out.height/bodyRadius/front/
 * rear/headRadius; body dimensions never scale the authored asset itself.
 * `ceilingY` is the conservative predicted head limit; obstacles contain the
 * actual local lintels, jambs, leaves, closed-door blocker and prop volumes.
 */
export function sampleCreatureClearance(grid, x, z, yaw, baseY, speed, dt, out = {}) {
  const previousSource = out.door?.source, previousSide = out.door?.approachSide;
  scratch(out);
  const height = Math.max(0.2, finite(out.height, CREATURE_CLEARANCE.height));
  const radius = Math.max(0.05, finite(out.bodyRadius, CREATURE_CLEARANCE.bodyRadius));
  const head = Math.max(0.05, finite(out.headRadius, CREATURE_CLEARANCE.headRadius));
  const front = clamp(finite(out.front, CREATURE_CLEARANCE.front), radius, 1.8);
  const rear = clamp(finite(out.rear, CREATURE_CLEARANCE.rear), radius, 1.8);
  speed = Math.abs(finite(speed, 0)); dt = clamp(finite(dt, 0), 0, 0.25);
  const fx = Math.sin(finite(yaw, 0)), fz = Math.cos(finite(yaw, 0));
  const look = Math.min(CREATURE_CLEARANCE.maxLookAhead, front + 0.35 + speed * CREATURE_CLEARANCE.reactionTime);
  const endX = x + fx * look, endZ = z + fz * look;
  // Includes the complete long arm/digit reach and trailing upper body.
  const reach = Math.min(2.5, Math.max(1.65, finite(out.extremityReach, 0), rear + head + WALL_T));
  const minX = Math.min(x, endX) - reach, maxX = Math.max(x, endX) + reach;
  const minZ = Math.min(z, endZ) - reach, maxZ = Math.max(z, endZ) + reach;
  const gx0 = Math.max(0, grid.cellX(minX)), gx1 = Math.min(grid.W - 1, grid.cellX(maxX));
  const gy0 = Math.max(0, grid.cellY(minZ)), gy1 = Math.min(grid.H - 1, grid.cellY(maxZ));
  out.x = x; out.z = z; out.baseY = baseY; out.radius = radius; out.height = height;
  out.lookAhead = look; out.forwardX = fx; out.forwardZ = fz;
  out.ceilingY = roomCeiling(grid, x, z, baseY); out.door = null;
  out.duckTarget = 0; out.cellsVisited = 0;
  for (let gy = gy0; gy <= gy1; gy++) for (let gx = gx0; gx <= gx1; gx++) {
    out.cellsVisited++;
    const list = grid.boxes?.[grid.idx(gx, gy)] || EMPTY;
    for (const b of list) {
      if (out.overflow) break;
      if (out._seen.has(b) || b.disabled || b.door) continue;
      out._seen.add(b);
      if (b.x1 < minX || b.x0 > maxX || b.z1 < minZ || b.z0 > maxZ) continue;
      const o = candidate(out); if (!o) break;
      gridBoxVerticalRange(grid, b, o);
      setBox(o, b.x0, b.x1, o.y0, o.y1, b.z0, b.z1, b.kind || 'prop', b);
      // Visible jamb trim protrudes .035m past Grid's architectural slab.
      if (b.kind === 'jamb') {
        const axis = grid.doorAxis(b.gx, b.gy);
        if (axis === 'h') { o.z0 -= 0.035; o.z1 += 0.035; o.hz += 0.035; }
        else { o.x0 -= 0.035; o.x1 += 0.035; o.hx += 0.035; }
      }
    }
    const d = grid.doors?.get(grid.idx(gx, gy));
    if (!d || out._doorsSeen.has(d)) continue;
    out._doorsSeen.add(d);
    if (out.doors.length === CREATURE_CLEARANCE.maxDoors) { out.overflow = true; continue; }
    const desc = describeDoor(d, x, z, out._doorPool[out.doors.length], previousSource, previousSide);
    out.doors.push(desc);
    // Lintel occupies the actual wall thickness over the whole door cell(s).
    const w = d.width + 2 * DOOR_JAM, t = WALL_T * 0.5;
    const lintel = candidate(out);
    if (lintel) setBox(lintel, d.cx - (d.axis === 'h' ? w * 0.5 : t), d.cx + (d.axis === 'h' ? w * 0.5 : t),
      desc.ceilingY, d.base + WALL_H + 0.05, d.cz - (d.axis === 'v' ? w * 0.5 : t), d.cz + (d.axis === 'v' ? w * 0.5 : t), 'lintel', d);
    const frame = candidate(out), fw = d.width + 0.14, ft = t + 0.035;
    if (frame) setBox(frame, d.cx - (d.axis === 'h' ? fw * 0.5 : ft), d.cx + (d.axis === 'h' ? fw * 0.5 : ft),
      desc.passageCeilingY, desc.passageCeilingY + 0.07, d.cz - (d.axis === 'v' ? fw * 0.5 : ft), d.cz + (d.axis === 'v' ? fw * 0.5 : ft), 'doorFrame', d);
    for (let i = 0; i < (desc.exit ? 2 : 1); i++) { const leaf = candidate(out); if (leaf) doorLeafBox(d, i, leaf); }
    // Door's fixed pipe across a jammed handle is attached to the door group,
    // not its rotating leaf. Its y/x extent follows the authored 1.5m cylinder.
    if (d.kind === 'J' && d.jammed) {
      const bar = candidate(out);
      if (bar) {
        const localX = d.width * 0.35, localZ = -0.28;
        const cx = d.cx + (d.axis === 'h' ? localX : -localZ);
        const cz = d.cz + (d.axis === 'h' ? localZ : localX);
        const half = Math.sin(1.1) * 0.75 + 0.03;
        const hy = Math.cos(1.1) * 0.75 + 0.03;
        setBox(bar, cx - (d.axis === 'h' ? half : 0.03), cx + (d.axis === 'h' ? half : 0.03),
          d.base + 0.8 - hy, d.base + 0.8 + hy, cz - (d.axis === 'h' ? 0.03 : half), cz + (d.axis === 'h' ? 0.03 : half), 'doorBar', d);
      }
    }
    // DoorCore collision stays authoritative below its open threshold.
    if (desc.blocking) {
      const b = d.box, o = candidate(out);
      if (o) setBox(o, b.x0, b.x1, d.base, desc.ceilingY, b.z0, b.z1, 'closedDoor', d);
    }
    const lateral = Math.abs(d.axis === 'h' ? x - d.cx : z - d.cz);
    const normalForward = d.axis === 'h' ? fz : fx;
    const lateralForward = d.axis === 'h' ? fx : fz;
    const lateralSigned = d.axis === 'h' ? x - d.cx : z - d.cz;
    const dist = Math.abs(desc.signedDistance);
    const hold = Math.max(front, rear) + head + ft + CREATURE_CLEARANCE.margin;
    const approaching = normalForward * desc.signedDistance < -0.01;
    const crossingTravel = approaching ? -desc.signedDistance / normalForward : Infinity;
    const crossingLateral = Math.abs(lateralSigned + lateralForward * crossingTravel);
    const near = dist <= hold;
    const outer = hold + Math.min(2.5, speed * CREATURE_CLEARANCE.reactionTime + 0.35);
    const weight = near ? 1 : approaching ? smooth((outer - dist) / Math.max(0.01, outer - hold)) : 0;
    const headsIntoOpening = approaching && crossingTravel <= look + hold && crossingLateral <= d.width * 0.5 + radius;
    if ((lateral <= d.width * 0.5 + radius || headsIntoOpening) && weight > 0) {
      const required = clamp((baseY + height + CREATURE_CLEARANCE.margin - desc.passageCeilingY) / 0.95, 0, 1);
      const target = required * weight;
      if (!out.door || target > out.duckTarget || (target === out.duckTarget && dist < Math.abs(out.door.signedDistance))) {
        out.door = desc; out.duckTarget = target;
      }
      out.ceilingY = Math.min(out.ceilingY, baseY + height - required * 0.95 * weight);
    }
  }
  const currentLimit = roomCeiling(grid, x, z, baseY);
  out.duckTarget = Math.max(out.duckTarget, clamp((baseY + height + CREATURE_CLEARANCE.margin - currentLimit) / 0.95, 0, 1));
  // Enter immediately to prevent a fast frame crossing from lagging the lintel;
  // release is deliberately slower after the entire rear envelope is clear.
  out.duck = Math.max(out.duckTarget, finite(out.duck, 0) - dt * 2.4);
  const sweep = out.sweep;
  sweep.fromX = x; sweep.fromZ = z; sweep.toX = x + fx * speed * dt; sweep.toZ = z + fz * speed * dt;
  sweep.radius = radius; sweep.lookAhead = look; sweep.y0 = baseY + 0.08;
  sweep.y1 = Math.min(baseY + height - out.duck * 0.95, currentLimit - CREATURE_CLEARANCE.margin);
  sweep.t = out.overflow ? 0 : 1; sweep.obstacle = null; sweep.blocked = out.overflow;
  sweep.nx = sweep.ny = sweep.nz = 0;
  // The root sweep excludes lintels once ducked but never excludes closed doors,
  // rotating leaves, lower furniture, jambs or walls.
  const a = out._a || (out._a = {}), b = out._b || (out._b = {});
  a.x = x; a.y = (sweep.y0 + sweep.y1) * 0.5; a.z = z;
  b.x = sweep.toX; b.y = a.y; b.z = sweep.toZ;
  for (const o of out.obstacles) {
    if (sweep.y1 <= o.y0 + EPS || sweep.y0 >= o.y1 - EPS) continue;
    // Exact rounded footprint: radius-expanded slabs alone falsely trap a
    // clear circle at a jamb corner, even while it is moving away from the wall.
    const hit = sweepCircleAgainstBox(a, b, o, radius, out._hit);
    if (hit.hit && hit.t < sweep.t) {
      sweep.t = hit.t; sweep.obstacle = o; sweep.blocked = true;
      sweep.nx = hit.nx; sweep.nz = hit.nz;
    }
  }
  for (const desc of out.doors) {
    desc.jambLeft.accessible = pointObstaclePenetration(desc.jambLeft, 0.075, out.obstacles) < 0.001;
    desc.jambRight.accessible = pointObstaclePenetration(desc.jambRight, 0.075, out.obstacles) < 0.001;
  }
  return out;
}

function boxLocal(point, box, out) {
  const yaw = finite(box.yaw, 0), c = Math.cos(yaw), s = Math.sin(yaw);
  const cx = finite(box.cx, (box.x0 + box.x1) * 0.5), cz = finite(box.cz, (box.z0 + box.z1) * 0.5);
  const dx = point.x - cx, dz = point.z - cz;
  out.x = c * dx - s * dz; out.z = s * dx + c * dz; out.y = point.y - (box.y0 + box.y1) * 0.5;
  out.hx = finite(box.hx, (box.x1 - box.x0) * 0.5); out.hz = finite(box.hz, (box.z1 - box.z0) * 0.5);
  out.hy = (box.y1 - box.y0) * 0.5; out.c = c; out.s = s; out.cx = cx; out.cz = cz;
  return out;
}
const localScratch = {};

/** Exact continuous XZ circle sweep against a vertical OBB. The Minkowski
 * footprint consists of four offset faces and four quadratic corner arcs.
 * Unlike radius-expanded slabs, this permits clear movement out of a jamb's
 * square broad-phase corner. Caller checks the body's vertical interval.
 * An initially penetrating circle returns t0; a touching circle moving away
 * or tangent remains free. Normals point from the obstacle toward the circle.
 */
export function sweepCircleAgainstBox(a, b, box, radius = 0, out = {}) {
  const p = boxLocal(a, box, localScratch);
  const ax = p.x, az = p.z, hx = p.hx, hz = p.hz, c = p.c, s = p.s;
  const dxw = b.x - a.x, dzw = b.z - a.z;
  const dx = c * dxw - s * dzw, dz = s * dxw + c * dzw;
  radius = Math.max(0, finite(radius, 0));
  out.hit = false; out.t = 1; out.nx = out.ny = out.nz = 0;
  let best = Infinity, nx = 0, nz = 0;
  const qx = clamp(ax, -hx, hx), qz = clamp(az, -hz, hz);
  let sx = ax - qx, sz = az - qz;
  const distance = Math.hypot(sx, sz);
  const inside = Math.abs(ax) < hx - EPS && Math.abs(az) < hz - EPS;
  if (distance < radius - EPS || inside) {
    best = 0;
    if (distance > EPS) { nx = sx / distance; nz = sz / distance; }
    else if (hx - Math.abs(ax) <= hz - Math.abs(az)) nx = ax < 0 ? -1 : 1;
    else nz = az < 0 ? -1 : 1;
  } else {
    // Straight parts of the rounded rectangle. Reject outward/tangent motion;
    // being on the surface while walking away is not an obstructed movement.
    for (let face = 0; face < 4; face++) {
      const xAxis = face < 2, sign = face % 2 === 0 ? -1 : 1;
      const velocity = xAxis ? dx : dz;
      if (velocity * sign >= -EPS) continue;
      const t = (sign * ((xAxis ? hx : hz) + radius) - (xAxis ? ax : az)) / velocity;
      if (t < -EPS || t > 1 + EPS || t >= best) continue;
      const lateral = xAxis ? az + dz * t : ax + dx * t;
      if (Math.abs(lateral) > (xAxis ? hz : hx) + EPS) continue;
      best = Math.max(0, t); nx = xAxis ? sign : 0; nz = xAxis ? 0 : sign;
    }
    const length2 = dx * dx + dz * dz;
    if (radius > EPS && length2 > EPS * EPS) for (let corner = 0; corner < 4; corner++) {
      const xSign = corner < 2 ? -1 : 1, zSign = corner % 2 === 0 ? -1 : 1;
      const cx = xSign * hx, cz = zSign * hz, rx = ax - cx, rz = az - cz;
      const linear = 2 * (rx * dx + rz * dz), constant = rx * rx + rz * rz - radius * radius;
      const discriminant = linear * linear - 4 * length2 * constant;
      if (discriminant < 0) continue;
      const t = (-linear - Math.sqrt(discriminant)) / (2 * length2);
      if (t < -EPS || t > 1 + EPS || t >= best) continue;
      const normalX = ax + dx * t - cx, normalZ = az + dz * t - cz;
      // Only the outward quarter arc belongs to the rounded rectangle.
      if (normalX * xSign < -EPS || normalZ * zSign < -EPS) continue;
      if (normalX * dx + normalZ * dz >= -EPS) continue;
      best = Math.max(0, t); nx = normalX / radius; nz = normalZ / radius;
    }
  }
  if (best !== Infinity) {
    out.hit = true; out.t = clamp(best, 0, 1);
    out.nx = c * nx + s * nz; out.nz = -s * nx + c * nz;
  }
  return out;
}

/** Signed exact point distance to an AABB/vertical OBB; negative inside. */
export function pointBoxSignedDistance(point, box) {
  const p = boxLocal(point, box, localScratch);
  const dx = Math.abs(p.x) - p.hx, dy = Math.abs(p.y) - p.hy, dz = Math.abs(p.z) - p.hz;
  return Math.hypot(Math.max(dx, 0), Math.max(dy, 0), Math.max(dz, 0)) + Math.min(Math.max(dx, dy, dz), 0);
}
export function pointObstaclePenetration(point, radius, obstacles) {
  let penetration = 0;
  for (const o of obstacles || EMPTY) if (o.blocking !== false) penetration = Math.max(penetration, radius - pointBoxSignedDistance(point, o));
  return penetration;
}

/** Project a sphere outside one box, preserving dimensions. */
export function projectPointOutOfBox(point, radius, box, out = {}) {
  const p = boxLocal(point, box, localScratch);
  let qx = clamp(p.x, -p.hx, p.hx), qy = clamp(p.y, -p.hy, p.hy), qz = clamp(p.z, -p.hz, p.hz);
  let dx = p.x - qx, dy = p.y - qy, dz = p.z - qz;
  const len = Math.hypot(dx, dy, dz);
  let shift = radius - len;
  if (len <= EPS) {
    const ex = p.hx - Math.abs(p.x), ey = p.hy - Math.abs(p.y), ez = p.hz - Math.abs(p.z);
    const nearest = Math.min(ex, ey, ez); shift = radius + nearest;
    dx = dy = dz = 0;
    if (nearest === ex) dx = p.x < 0 ? -1 : 1;
    else if (nearest === ey) dy = p.y < 0 ? -1 : 1;
    else dz = p.z < 0 ? -1 : 1;
  } else { dx /= len; dy /= len; dz /= len; }
  out.penetration = Math.max(0, shift); out.collided = shift > EPS;
  shift = shift > EPS ? shift + 1e-5 : 0;
  out.x = point.x + (p.c * dx + p.s * dz) * shift;
  out.y = point.y + dy * shift;
  out.z = point.z + (-p.s * dx + p.c * dz) * shift;
  return out;
}

/** Rig-friendly plain xyz output, including exact initial penetration and
 * explicit `resolved` failure when several obstacles have no local solution.
 * Callers can bound IK motion and keep the previous safe pose on failure.
 */
export function projectPointOutOfObstacles(point, radius, obstacles, out = {}) {
  out.x = point.x; out.y = point.y; out.z = point.z;
  out.penetration = pointObstaclePenetration(point, radius, obstacles);
  out.collided = out.penetration > EPS;
  const tmp = out._projection || (out._projection = {});
  for (let iteration = 0; iteration < 8; iteration++) {
    let moved = false;
    for (const o of obstacles || EMPTY) {
      if (o.blocking === false) continue;
      projectPointOutOfBox(out, radius, o, tmp);
      if (tmp.collided) { out.x = tmp.x; out.y = tmp.y; out.z = tmp.z; moved = true; }
    }
    if (!moved) break;
  }
  out.remainingPenetration = pointObstaclePenetration(out, radius, obstacles);
  out.resolved = out.remainingPenetration < 1e-4;
  return out;
}

/** Root-body projection is horizontal: a full-height body must not escape a
 * table, wall or door by being pushed vertically to the top of that obstacle.
 * Use after a leaf rotates into the body, before sweeping the next movement.
 */
export function projectBodyOutOfObstacles(point, radius, y0, y1, obstacles, out = {}) {
  out.x = point.x; out.y = point.y; out.z = point.z; out.collided = false; out.penetration = 0;
  const probe = out._bodyProbe || (out._bodyProbe = {});
  for (let iteration = 0; iteration < 8; iteration++) {
    let moved = false;
    for (const box of obstacles || EMPTY) {
      if (box.blocking === false || y1 <= box.y0 + EPS || y0 >= box.y1 - EPS) continue;
      probe.x = out.x; probe.y = (box.y0 + box.y1) * 0.5; probe.z = out.z;
      const p = boxLocal(probe, box, localScratch);
      const qx = clamp(p.x, -p.hx, p.hx), qz = clamp(p.z, -p.hz, p.hz);
      let dx = p.x - qx, dz = p.z - qz, shift;
      const distance = Math.hypot(dx, dz);
      if (distance >= radius) continue;
      if (distance < EPS) {
        const ex = p.hx - Math.abs(p.x), ez = p.hz - Math.abs(p.z);
        shift = radius + Math.min(ex, ez);
        dx = ex <= ez ? (p.x < 0 ? -1 : 1) : 0;
        dz = ex <= ez ? 0 : (p.z < 0 ? -1 : 1);
      } else { dx /= distance; dz /= distance; shift = radius - distance; }
      out.penetration = Math.max(out.penetration, shift); out.collided = true;
      shift += 1e-5;
      out.x += (p.c * dx + p.s * dz) * shift;
      out.z += (-p.s * dx + p.c * dz) * shift; moved = true;
    }
    if (!moved) break;
  }
  out.resolved = true;
  for (const box of obstacles || EMPTY) {
    if (box.blocking === false || y1 <= box.y0 + EPS || y0 >= box.y1 - EPS) continue;
    probe.x = out.x; probe.y = (box.y0 + box.y1) * 0.5; probe.z = out.z;
    if (pointBoxSignedDistance(probe, box) < radius - 1e-4) { out.resolved = false; break; }
  }
  return out;
}

/** Slab intersection against a radius-expanded vertical OBB. Conservative at
 * corners: a reported hit may stop slightly early, never tunnel through skin.
 * `horizontalOnly` supports full-height body sweeps after vertical overlap.
 */
export function segmentBoxIntersection(a, b, box, radius = 0, out = {}, horizontalOnly = false) {
  const p = boxLocal(a, box, localScratch);
  const ax = p.x, ay = p.y, az = p.z, c = p.c, s = p.s;
  const dxw = b.x - a.x, dzw = b.z - a.z;
  const dx = c * dxw - s * dzw, dz = s * dxw + c * dzw, dy = b.y - a.y;
  const hx = p.hx + radius, hy = p.hy + radius, hz = p.hz + radius;
  let t0 = 0, t1 = 1, nx = 0, ny = 0, nz = 0;
  // Unrolled-axis access avoids constructing arrays in the animation loop.
  for (let axis = 0; axis < 3; axis++) {
    if (axis === 1 && horizontalOnly) continue;
    const v = axis === 0 ? ax : axis === 1 ? ay : az;
    const d = axis === 0 ? dx : axis === 1 ? dy : dz;
    const h = axis === 0 ? hx : axis === 1 ? hy : hz;
    if (Math.abs(d) < EPS) { if (v < -h || v > h) { out.hit = false; out.t = 1; return out; } continue; }
    let ta = (-h - v) / d, tb = (h - v) / d, sign = -1;
    if (ta > tb) { const swap = ta; ta = tb; tb = swap; sign = 1; }
    if (ta > t0) { t0 = ta; nx = axis === 0 ? sign : 0; ny = axis === 1 ? sign : 0; nz = axis === 2 ? sign : 0; }
    t1 = Math.min(t1, tb);
    if (t0 > t1 || t1 < 0 || t0 > 1) { out.hit = false; out.t = 1; return out; }
  }
  out.hit = true; out.t = Math.max(0, t0); out.exitT = Math.min(1, t1);
  out.nx = c * nx + s * nz; out.ny = ny; out.nz = -s * nx + c * nz;
  return out;
}

/** Continuous head/hand sphere motion, not just endpoint projection. */
export function sweepPointAgainstObstacles(a, b, radius, obstacles, out = {}) {
  const tmp = out._intersection || (out._intersection = {});
  out.t = 1; out.hit = false; out.obstacle = null;
  for (const o of obstacles || EMPTY) {
    if (o.blocking === false) continue;
    segmentBoxIntersection(a, b, o, radius, tmp);
    if (tmp.hit && (!out.hit || tmp.t < out.t)) {
      out.t = tmp.t; out.hit = true; out.obstacle = o; out.nx = tmp.nx; out.ny = tmp.ny; out.nz = tmp.nz;
    }
  }
  const len = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
  const t = out.hit ? Math.max(0, out.t - 0.002 / Math.max(EPS, len)) : 1;
  out.x = a.x + (b.x - a.x) * t; out.y = a.y + (b.y - a.y) * t; out.z = a.z + (b.z - a.z) * t;
  return out;
}

/** Test a long neck/forearm/finger capsule (whole segment, not sampled joints). */
export function segmentObstaclePenetration(a, b, radius, obstacles, out = {}) {
  out.hit = false; out.obstacle = null; out.t = 1;
  const hit = out._intersection || (out._intersection = {});
  for (const o of obstacles || EMPTY) if (o.blocking !== false) {
    segmentBoxIntersection(a, b, o, radius, hit);
    if (hit.hit && (!out.hit || hit.t < out.t)) {
      out.hit = true; out.obstacle = o; out.t = hit.t; out.exitT = hit.exitT;
      out.nx = hit.nx; out.ny = hit.ny; out.nz = hit.nz;
    }
  }
  return out;
}
