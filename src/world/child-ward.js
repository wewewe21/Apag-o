// Forgotten belongings in the six patient bedrooms. Visual only: no changes to
// collision, navigation, door state or hiding spots. The wind-up toy stays out
// of the world's static merge so its last pose can survive a haunt sequence.
import * as THREE from 'three';
import { CELL, WALL_T, WALL_H } from '../config.js';

const BOX = new THREE.BoxGeometry(1, 1, 1);
const BALL = new THREE.SphereGeometry(1, 14, 10);
const CYLINDER = new THREE.CylinderGeometry(1, 1, 1, 10);
const UP = new THREE.Vector3(0, 1, 0);
const TOY_DURATION = 10;
const CHILDREN = ['LIA', 'DAVI', 'NINA', 'TOMAS', 'BIA', 'IVO'];
const GLYPHS = {
  A: ['010', '101', '111', '101', '101'], B: ['110', '101', '110', '101', '110'],
  D: ['110', '101', '101', '101', '110'], I: ['111', '010', '010', '010', '111'],
  L: ['100', '100', '100', '100', '111'], M: ['10101', '11111', '10101', '10101', '10101'],
  N: ['1001', '1101', '1011', '1001', '1001'], O: ['010', '101', '101', '101', '010'],
  S: ['011', '100', '010', '001', '110'], T: ['111', '010', '010', '010', '010'],
  V: ['101', '101', '101', '101', '010'],
};

function part(group, name, geometry, material, position, scale, rotation = [0, 0, 0]) {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = name;
  mesh.position.fromArray(position); mesh.scale.fromArray(scale); mesh.rotation.fromArray(rotation);
  mesh.castShadow = true; mesh.receiveShadow = true;
  group.add(mesh);
  return mesh;
}
const box = (g, name, m, p, s, r) => part(g, name, BOX, m, p, s, r);
const ball = (g, name, m, p, s) => part(g, name, BALL, m, p, s);
function thread(g, name, m, a, b, radius = 0.003) {
  const va = new THREE.Vector3(...a), vb = new THREE.Vector3(...b);
  const direction = vb.clone().sub(va);
  const mesh = part(g, name, CYLINDER, m, va.add(vb).multiplyScalar(0.5).toArray(), [radius, direction.length(), radius]);
  mesh.quaternion.setFromUnitVectors(UP, direction.normalize());
  mesh.castShadow = false;
  return mesh;
}

function wornTexture() {
  const size = 64, bytes = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const hash = ((x * 73856093) ^ (y * 19349663)) >>> 0;
    const threadShade = (x % 3 === 0 ? -13 : 0) + (y % 4 === 0 ? -8 : 0);
    const value = 216 + (hash % 30) + threadShade;
    const i = (y * size + x) * 4;
    bytes[i] = bytes[i + 1] = bytes[i + 2] = value; bytes[i + 3] = 255;
  }
  const texture = new THREE.DataTexture(bytes, size, size, THREE.RGBAFormat);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.magFilter = THREE.LinearFilter; texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true; texture.needsUpdate = true;
  return texture;
}

function makeMaterials() {
  const weave = wornTexture();
  const material = (name, color, extra = {}) => {
    const m = new THREE.MeshStandardMaterial({ color, roughness: 0.94, map: weave, ...extra });
    m.name = name;
    return m;
  };
  return {
    fur: material('worn-teddy-fur', 0x8a735c), patch: material('old-linen-patch', 0xa49780),
    cotton: material('exposed-stuffing', 0xcac5ae), dark: material('empty-sockets-and-thread', 0x29241d),
    blue: material('faded-blue-paint', 0x596d72), red: material('faded-red-paint', 0x87615b),
    yellow: material('faded-yellow-paint', 0xa49567), wood: material('splintered-wood', 0x9c8060),
    porcelain: material('chipped-porcelain', 0xc3bba4, { roughness: 0.72 }),
    metal: material('dull-clockwork-metal', 0x7b7865, { roughness: 0.7, metalness: 0.5 }),
    rubber: material('perished-rubber', 0x38352d),
  };
}

function tornTeddy(M, index) {
  const g = new THREE.Group(); g.name = 'torn-teddy'; g.userData.kind = 'teddy';
  ball(g, 'slumped-body', M.fur, [0, 0.29, 0], [0.16, 0.2, 0.135]);
  const head = new THREE.Group(); head.position.set(-0.02, 0.49, 0.015); head.rotation.z = 0.13 + index * 0.015; g.add(head);
  ball(head, 'round-head', M.fur, [0, 0, 0], [0.145, 0.135, 0.115]);
  ball(head, 'intact-ear', M.fur, [-0.11, 0.1, 0], [0.061, 0.064, 0.04]);
  ball(head, 'torn-ear-stub', M.fur, [0.113, 0.09, 0], [0.047, 0.033, 0.031]);
  ball(head, 'ear-stuffing', M.cotton, [0.125, 0.112, 0.008], [0.027, 0.014, 0.022]);
  ball(head, 'muzzle', M.patch, [0, -0.037, 0.098], [0.077, 0.044, 0.033]);
  ball(head, 'nose', M.dark, [0, -0.024, 0.13], [0.022, 0.014, 0.01]);
  ball(head, 'remaining-button-eye', M.dark, [-0.055, 0.032, 0.104], [0.019, 0.019, 0.011]);
  ball(head, 'missing-eye-socket', M.fur, [0.056, 0.029, 0.108], [0.025, 0.022, 0.006]);
  for (const sign of [-1, 1]) thread(head, 'loose-eye-stitch', M.dark,
    [0.041, 0.019 + sign * 0.01, 0.115], [0.068, 0.019 - sign * 0.01, 0.115], 0.002);
  thread(head, 'mouth-stitch', M.dark, [0, -0.034, 0.131], [0, -0.058, 0.126], 0.002);
  ball(g, 'left-foot', M.fur, [-0.1, 0.085, 0.073], [0.086, 0.074, 0.116]);
  ball(g, 'right-foot', M.fur, [0.1, 0.079, 0.09], [0.085, 0.068, 0.11]);
  ball(g, 'hanging-left-arm', M.fur, [-0.187, 0.3, 0.008], [0.071, 0.12, 0.07]);
  ball(g, 'torn-right-shoulder', M.patch, [0.14, 0.36, 0.005], [0.029, 0.038, 0.063]);
  ball(g, 'detached-arm', M.fur, [0.27, 0.068, 0.075], [0.09, 0.061, 0.072]);
  ball(g, 'open-belly-seam', M.dark, [0.025, 0.273, 0.128], [0.058, 0.076, 0.016]);
  for (let i = 0; i < 5; i++) ball(g, 'belly-stuffing', M.cotton,
    [0.005 + (i % 2) * 0.025, 0.225 + i * 0.024, 0.146 + (i % 2) * 0.008], [0.027, 0.022, 0.022]);
  for (let i = 0; i < 5; i++) thread(g, 'belly-seam-stitch', M.patch,
    [-0.039, 0.22 + i * 0.024, 0.134], [-0.024, 0.231 + i * 0.024, 0.143]);
  thread(g, 'dangling-seam-thread', M.dark, [0.063, 0.235, 0.144], [0.073, 0.13, 0.155], 0.002);
  box(g, 'ribbon-knot', index % 2 ? M.red : M.blue, [0, 0.397, 0.118], [0.022, 0.028, 0.02]);
  for (const s of [-1, 1]) ball(g, 'frayed-ribbon-loop', index % 2 ? M.red : M.blue,
    [s * 0.043, 0.4, 0.113], [0.035, 0.017, 0.012]);
  return g;
}

function brokenDoll(M, index) {
  const g = new THREE.Group(); g.name = 'broken-doll'; g.userData.kind = 'doll';
  ball(g, 'faded-cloth-dress', index ? M.blue : M.red, [0, 0.073, 0], [0.095, 0.069, 0.17]);
  ball(g, 'porcelain-head', M.porcelain, [0, 0.091, -0.195], [0.083, 0.073, 0.073]);
  ball(g, 'worn-hair-cap', M.fur, [0, 0.062, -0.219], [0.086, 0.044, 0.071]);
  for (const s of [-1, 1]) ball(g, 'painted-doll-eye', M.dark, [s * 0.027, 0.154, -0.206], [0.008, 0.006, 0.008]);
  thread(g, 'porcelain-crack', M.dark, [-0.014, 0.158, -0.244], [0.009, 0.161, -0.196], 0.0018);
  thread(g, 'porcelain-crack-branch', M.dark, [0.001, 0.161, -0.213], [0.025, 0.15, -0.217], 0.0014);
  ball(g, 'attached-arm', M.porcelain, [-0.11, 0.06, -0.062], [0.027, 0.028, 0.094]);
  ball(g, 'empty-arm-joint', M.dark, [0.086, 0.076, -0.062], [0.009, 0.017, 0.021]);
  ball(g, 'separated-doll-arm', M.porcelain, [0.157, 0.031, 0.011], [0.026, 0.026, 0.086]);
  for (const s of [-1, 1]) ball(g, 'doll-leg', M.porcelain, [s * 0.041, 0.039, 0.191], [0.026, 0.032, 0.074]);
  for (let i = 0; i < 3; i++) box(g, 'dress-torn-hem', M.patch, [-0.047 + i * 0.04, 0.028, 0.135], [0.018, 0.013, 0.03], [0, i * 0.25, 0]);
  return g;
}

function woodenHorse(M) {
  const g = new THREE.Group(); g.name = 'broken-rocking-horse'; g.userData.kind = 'horse';
  box(g, 'wooden-horse-body', M.wood, [0, 0.225, 0], [0.3, 0.11, 0.13]);
  box(g, 'wooden-neck', M.wood, [0.135, 0.325, 0], [0.066, 0.19, 0.08], [0, 0, -0.35]);
  box(g, 'horse-head', M.wood, [0.185, 0.41, 0], [0.125, 0.071, 0.095], [0, 0, -0.15]);
  box(g, 'small-ear', M.wood, [0.165, 0.465, 0], [0.032, 0.051, 0.025]);
  ball(g, 'painted-horse-eye', M.dark, [0.19, 0.425, 0.051], [0.007, 0.007, 0.003]);
  box(g, 'chipped-saddle', M.blue, [-0.015, 0.289, 0], [0.12, 0.026, 0.15]);
  for (const x of [-0.1, 0.1]) for (const z of [-0.045, 0.045]) {
    const broken = x > 0 && z > 0;
    box(g, broken ? 'snapped-leg-stub' : 'horse-leg', M.wood, [x, broken ? 0.178 : 0.137, z], [0.035, broken ? 0.055 : 0.135, 0.03]);
  }
  box(g, 'separated-wooden-leg', M.wood, [0.225, 0.027, 0.105], [0.1, 0.026, 0.031], [0, 0.35, 0]);
  for (const z of [-0.08, 0.08]) for (let i = 0; i < 6; i++) {
    const x0 = -0.24 + i * 0.08, x1 = x0 + 0.08;
    thread(g, 'curved-wood-rocker', M.wood, [x0, 0.018 + x0 * x0 * 0.95, z], [x1, 0.018 + x1 * x1 * 0.95, z], 0.013);
  }
  thread(g, 'frayed-rope-tail', M.dark, [-0.16, 0.235, 0], [-0.2, 0.12, 0.015], 0.008);
  return g;
}

function brokenTruck(M) {
  const g = new THREE.Group(); g.name = 'chipped-toy-truck'; g.userData.kind = 'truck';
  box(g, 'truck-chassis', M.wood, [0, 0.09, 0], [0.28, 0.065, 0.39]);
  box(g, 'truck-cab', M.red, [0, 0.188, 0.113], [0.245, 0.16, 0.14]);
  box(g, 'faded-windshield', M.dark, [0, 0.217, 0.188], [0.15, 0.055, 0.005]);
  box(g, 'truck-bed', M.blue, [0, 0.14, -0.097], [0.26, 0.055, 0.21]);
  for (const s of [-1, 1]) box(g, 'bed-side', M.blue, [s * 0.13, 0.19, -0.099], [0.018, 0.08, 0.21]);
  for (const x of [-0.15, 0.15]) for (const z of [-0.12, 0.12]) {
    if (x > 0 && z > 0) continue;
    part(g, 'attached-truck-wheel', CYLINDER, M.rubber, [x, 0.061, z], [0.061, 0.029, 0.061], [0, 0, Math.PI / 2]);
  }
  part(g, 'fallen-truck-wheel', CYLINDER, M.rubber, [0.243, 0.015, 0.12], [0.06, 0.028, 0.06]);
  box(g, 'raw-paint-chip', M.wood, [0.072, 0.263, 0.132], [0.029, 0.003, 0.06], [0, 0.18, 0]);
  return g;
}

function abandonedBlocks(M) {
  const g = new THREE.Group(); g.name = 'scattered-building-blocks'; g.userData.kind = 'blocks';
  const paints = [M.blue, M.red, M.yellow];
  for (let i = 0; i < 4; i++) {
    const x = (i % 2) * 0.17 - 0.13, z = Math.floor(i / 2) * 0.15 - 0.09;
    box(g, 'chipped-wood-block', M.wood, [x, 0.057, z], [0.112, 0.112, 0.112], [0, i * 0.47, 0]);
    box(g, 'faded-block-face', paints[i % 3], [x, 0.114, z], [0.086, 0.003, 0.086], [0, i * 0.47, 0]);
    box(g, 'bare-block-corner', M.wood, [x + 0.024, 0.116, z + 0.023], [0.025, 0.003, 0.032], [0, i * 0.47, 0]);
  }
  return g;
}

function brokenXylophone(M) {
  const g = new THREE.Group(); g.name = 'silent-xylophone'; g.userData.kind = 'xylophone';
  for (const x of [-0.06, 0.06]) box(g, 'wooden-xylophone-rail', M.wood, [x, 0.03, 0], [0.025, 0.05, 0.36]);
  const colors = [M.red, M.yellow, M.blue, M.yellow, M.red];
  for (let i = 0; i < 5; i++) {
    if (i === 2) continue;
    const z = -0.15 + i * 0.075;
    box(g, 'dull-musical-bar', colors[i], [0, 0.065, z], [0.24 - i * 0.016, 0.022, 0.055]);
    for (const x of [-0.06, 0.06]) ball(g, 'rusted-bar-pin', M.metal, [x, 0.079, z], [0.006, 0.006, 0.006]);
  }
  box(g, 'detached-musical-bar', M.blue, [0.205, 0.012, 0.08], [0.21, 0.021, 0.055], [0, -0.6, 0]);
  thread(g, 'abandoned-mallet', M.wood, [-0.2, 0.025, -0.12], [-0.13, 0.025, 0.12], 0.008);
  ball(g, 'mallet-head', M.red, [-0.13, 0.025, 0.12], [0.027, 0.025, 0.027]);
  return g;
}

// CPU rasterization keeps the artwork deterministic and testable without a DOM.
function drawingTexture(index) {
  const size = 192, bytes = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const i = (y * size + x) * 4, grain = ((x * 17 + y * 31) % 13) - 6;
    const stain = Math.max(0, 1 - Math.hypot(x - 19, y - 155) / 31) * 18;
    bytes[i] = 180 + grain - stain; bytes[i + 1] = 174 + grain - stain; bytes[i + 2] = 151 + grain - stain; bytes[i + 3] = 255;
  }
  const stroke = (x0, y0, x1, y1, color, width = 1) => {
    const count = Math.ceil(Math.hypot(x1 - x0, y1 - y0) * 1.5);
    for (let k = 0; k <= count; k++) {
      const t = count ? k / count : 0, x = Math.round(x0 + (x1 - x0) * t), y = Math.round(y0 + (y1 - y0) * t);
      for (let dy = -width; dy <= width; dy++) for (let dx = -width; dx <= width; dx++) {
        const px = x + dx, py = y + dy;
        if (px < 0 || py < 0 || px >= size || py >= size || (px * 7 + py * 13) % 11 === 0) continue;
        const i = (py * size + px) * 4;
        for (let c = 0; c < 3; c++) bytes[i + c] = bytes[i + c] * 0.35 + color[c] * 0.65;
      }
    }
  };
  const loop = (cx, cy, radius, color) => {
    for (let i = 0; i < 18; i++) {
      const a = i / 18 * Math.PI * 2, b = (i + 1) / 18 * Math.PI * 2;
      stroke(cx + Math.cos(a) * radius, cy + Math.sin(a) * radius, cx + Math.cos(b) * radius, cy + Math.sin(b) * radius, color);
    }
  };
  const blue = [77, 91, 110], green = [90, 108, 87], red = [136, 91, 83], yellow = [155, 135, 82];
  stroke(19, 149, 172, 146, green);
  stroke(30, 114, 30, 72, blue); stroke(30, 72, 78, 70, blue); stroke(78, 70, 78, 116, blue); stroke(78, 116, 30, 114, blue);
  stroke(24, 71, 53, 43, red); stroke(53, 43, 84, 72, red);
  stroke(47, 113, 48, 90, blue); stroke(48, 90, 62, 89, blue); stroke(62, 89, 63, 115, blue);
  loop(143, 37, 12, yellow);
  for (let i = 0; i < 8; i++) {
    const a = i * Math.PI / 4;
    stroke(143 + Math.cos(a) * 17, 37 + Math.sin(a) * 17, 143 + Math.cos(a) * 24, 37 + Math.sin(a) * 24, yellow);
  }
  for (let n = 0; n < 3; n++) {
    const cx = 99 + n * 25, cy = 100 + (n === 1 ? 5 : 0), ink = n === 1 ? red : blue;
    loop(cx, cy, 7, ink); stroke(cx, cy + 7, cx - 1, cy + 26, ink);
    stroke(cx - 10, cy + 15, cx + 9, cy + 12, ink);
    stroke(cx - 1, cy + 26, cx - 8, cy + 37, ink); stroke(cx - 1, cy + 26, cx + 7, cy + 36, ink);
  }
  let tx = 14;
  for (const char of CHILDREN[index]) {
    const rows = GLYPHS[char];
    for (let y = 0; y < rows.length; y++) for (let x = 0; x < rows[y].length; x++) if (rows[y][x] === '1') stroke(tx + x * 2, 165 + y * 2, tx + x * 2 + 1, 165 + y * 2, blue, 0);
    tx += rows[0].length * 2 + 3;
  }
  const texture = new THREE.DataTexture(bytes, size, size, THREE.RGBAFormat);
  texture.colorSpace = THREE.SRGBColorSpace; texture.flipY = true;
  texture.magFilter = THREE.LinearFilter; texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true; texture.needsUpdate = true;
  return texture;
}

function roomArtwork(room, index, M) {
  const g = new THREE.Group(); g.name = 'child-wall-drawings'; g.userData.kind = 'drawings';
  const material = new THREE.MeshStandardMaterial({ map: drawingTexture(index), color: 0xd7d1bb, roughness: 1, side: THREE.DoubleSide });
  material.name = 'drawing-' + CHILDREN[index].toLowerCase();
  const paperGeometry = new THREE.PlaneGeometry(0.57, 0.62);
  // A missing lower corner and uneven edge, rather than a pristine square decal.
  const positions = paperGeometry.attributes.position;
  positions.setXY(2, -0.245, -0.265); positions.setXY(3, 0.285, -0.299);
  paperGeometry.computeVertexNormals();
  const paper = part(g, 'faded-signed-child-drawing', paperGeometry, material, [0, 1.02, 0], [1, 1, 1], [0, 0, index % 2 ? -0.05 : 0.045]);
  paper.castShadow = false;
  for (const x of [-0.19, 0.19]) box(g, 'yellowed-paper-tape', M.patch, [x, 1.32, 0.005], [0.069, 0.035, 0.004], [0, 0, x]);
  for (let i = 0; i < 4; i++) thread(g, 'child-height-pencil-mark', M.dark, [0.53, 0.74 + i * 0.09, 0], [0.6 - (i % 2) * 0.018, 0.74 + i * 0.09, 0], 0.002);
  // South wall, far from the entry and existing north-wall gameplay graffiti.
  g.position.set((room.x0 + room.x1 + 1) * CELL / 2, 0, (room.y1 + 1.5) * CELL - WALL_T / 2 - 0.008);
  g.rotation.y = Math.PI;
  return g;
}

function windupDuck(M) {
  const toy = new THREE.Group(); toy.name = 'wind-up-tin-duck'; toy.userData.kind = 'animated-toy';
  ball(toy, 'dented-tin-body', M.yellow, [0, 0.19, 0], [0.13, 0.115, 0.19]);
  box(toy, 'clockwork-base', M.metal, [0, 0.078, 0], [0.25, 0.055, 0.34]);
  const head = new THREE.Group(); head.name = 'bobbing-duck-head'; head.position.set(0, 0.258, 0.115); toy.add(head);
  ball(head, 'duck-head', M.yellow, [0, 0.06, 0.025], [0.083, 0.086, 0.075]);
  box(head, 'chipped-duck-beak', M.red, [0, 0.034, 0.112], [0.092, 0.031, 0.073], [0.12, 0, 0]);
  for (const s of [-1, 1]) ball(head, 'duck-eye', M.dark, [s * 0.071, 0.075, 0.052], [0.008, 0.011, 0.012]);
  ball(toy, 'painted-intact-wing', M.blue, [-0.115, 0.193, -0.013], [0.029, 0.058, 0.094]);
  ball(toy, 'missing-wing-rivet', M.metal, [0.128, 0.199, -0.007], [0.008, 0.008, 0.009]);
  const wheels = [];
  for (const x of [-0.154, 0.154]) for (const z of [-0.125, 0.125]) {
    const wheel = new THREE.Group(); wheel.position.set(x, 0.062, z); toy.add(wheel);
    part(wheel, 'duck-wheel', CYLINDER, M.rubber, [0, 0, 0], [0.062, 0.025, 0.062], [0, 0, Math.PI / 2]);
    box(wheel, 'visible-wheel-spoke', M.metal, [Math.sign(x) * 0.014, 0, 0], [0.003, 0.082, 0.008]); wheels.push(wheel);
  }
  const key = new THREE.Group(); key.name = 'turning-wind-up-key'; key.position.set(0.163, 0.173, -0.041); toy.add(key);
  thread(key, 'key-shaft', M.metal, [-0.035, 0, 0], [0.044, 0, 0], 0.009);
  box(key, 'butterfly-winding-key', M.metal, [0.049, 0, 0], [0.019, 0.087, 0.041]);
  ball(toy, 'bare-metal-paint-chip', M.metal, [0.074, 0.274, -0.052], [0.031, 0.005, 0.042]);
  return { toy, head, wheels, key };
}

// Batch each room by material, retaining measured placement data for QA. Unlike
// world.staticRoot, this group remains owned by the ward and is safe to rebuild.
function mergeRoom(group) {
  group.updateMatrixWorld(true);
  const buckets = new Map();
  group.traverse(mesh => {
    if (!mesh.isMesh) return;
    let b = buckets.get(mesh.material);
    if (!b) { b = { positions: [], normals: [], uvs: [], parts: [], shadow: false }; buckets.set(mesh.material, b); }
    const geometry = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry.clone();
    geometry.applyMatrix4(mesh.matrixWorld);
    const p = geometry.attributes.position, n = geometry.attributes.normal, uv = geometry.attributes.uv;
    for (let i = 0; i < p.count; i++) {
      b.positions.push(p.getX(i), p.getY(i), p.getZ(i)); b.normals.push(n.getX(i), n.getY(i), n.getZ(i));
      b.uvs.push(uv ? uv.getX(i) : 0, uv ? uv.getY(i) : 0);
    }
    b.parts.push(mesh.name); b.shadow ||= mesh.castShadow; geometry.dispose();
  });
  group.clear();
  for (const [material, b] of buckets) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(b.positions, 3));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(b.normals, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(b.uvs, 2));
    geometry.computeBoundingBox(); geometry.computeBoundingSphere();
    const mesh = new THREE.Mesh(geometry, material); mesh.name = material.name; mesh.userData.parts = b.parts;
    mesh.castShadow = b.shadow; mesh.receiveShadow = true;
    group.add(mesh);
  }
}

export class ChildWard {
  constructor(world) {
    this.world = world;
    this.rooms = (world.L ?? world.grid?.L)?.rooms.filter(r => r.z === 'p' && [1, 7].includes(r.x0) && r.x1 - r.x0 === 2 && r.y0 >= 13 && r.y1 <= 24)
      .sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0).map((room, i) => ({ ...room, id: 'child-room-' + (i + 1) })) ?? [];
    this.hauntedRoomId = this.rooms[0]?.id ?? null;
    this.root = new THREE.Group(); this.root.name = 'forgotten-childrens-ward';
    this.toy = null; this.toyActive = false; this.toyElapsed = 0; this.toyDuration = TOY_DURATION;
    this._built = false;
  }

  build() {
    if (this._built) return this;
    if (this.rooms.length !== 6) throw new Error('ChildWard needs the six patient bedrooms from the hospital layout');
    const M = makeMaterials(); this.materials = M;
    const factories = [abandonedBlocks, brokenDoll, woodenHorse, brokenTruck, brokenDoll, brokenXylophone];
    for (let i = 0; i < this.rooms.length; i++) {
      const room = this.rooms[i], group = new THREE.Group(); group.name = room.id; group.userData.roomId = room.id;
      const right = room.x0 > 5, farX = (right ? room.x1 + 0.5 : room.x0 + 0.5) * CELL;
      const southZ = (room.y1 + 0.55) * CELL;
      const teddy = tornTeddy(M, i);
      teddy.position.set(farX + (right ? -0.12 : 0.12), 0, southZ);
      // The damaged face looks toward the entrance, so the missing eye and
      // open seams read immediately in the player's flashlight beam.
      teddy.rotation.y = right ? -1.92 : 1.92; group.add(teddy);
      const other = factories[i](M, i);
      other.position.set((room.x0 + room.x1 + 1) * CELL / 2 + (right ? -0.12 : 0.12), 0, southZ + 0.12);
      other.rotation.y = 0.2 - i * 0.12; group.add(other);
      group.add(roomArtwork(room, i, M));
      group.updateMatrixWorld(true);
      group.userData.placements = group.children.map(prop => ({ kind: prop.userData.kind, bounds: new THREE.Box3().setFromObject(prop) }));
      mergeRoom(group); this.root.add(group);
    }
    const { toy, head, wheels, key } = windupDuck(M);
    const room = this.rooms[0];
    toy.position.set((room.x0 + 1.9) * CELL, 0, (room.y1 - 0.03) * CELL);
    toy.rotation.y = Math.PI - 0.2;
    this.toy = toy; this._head = head; this._wheels = wheels; this._key = key;
    this._initialPosition = toy.position.clone(); this._initialYaw = toy.rotation.y;
    this.root.add(toy); this.world.scene.add(this.root); this._built = true;
    return this;
  }

  roomAt(pos) {
    if (!pos || !Number.isFinite(pos.x) || !Number.isFinite(pos.z) || (pos.y !== undefined && (!Number.isFinite(pos.y) || pos.y < -0.3 || pos.y > WALL_H + 0.3))) return null;
    // Authored floor cells only: door cells, partition walls and the narrow
    // corridor must never count as a bedroom, even beside an open door.
    const x = Math.floor(pos.x / CELL), y = Math.floor(pos.z / CELL);
    return this.rooms.find(r => x >= r.x0 && x <= r.x1 && y >= r.y0 && y <= r.y1)?.id ?? null;
  }

  startToy() {
    if (!this.toy || this.toyActive || this.toyElapsed > 0) return false;
    this.toyActive = true; this.toyElapsed = 0;
    return true;
  }

  update(dt) {
    if (!this.toyActive || !Number.isFinite(dt) || dt <= 0) return;
    const elapsed = this.toyElapsed + dt;
    this.toyElapsed = TOY_DURATION - elapsed < 1e-9 ? TOY_DURATION : elapsed;
    const t = this.toyElapsed, phase = t / TOY_DURATION;
    // Smooth acceleration and a gradual mechanical wind-down. Absolute time
    // avoids frame-rate dependent drift or animation continuing after a hitch.
    const travel = phase * phase * (3 - 2 * phase);
    const motor = Math.sin(Math.PI * phase);
    this.toy.position.copy(this._initialPosition);
    this.toy.position.x += travel * 0.24;
    this.toy.position.z -= travel * 0.58;
    this.toy.rotation.y = this._initialYaw + travel * 0.18 + Math.sin(t * 8) * 0.012 * motor;
    this.toy.rotation.z = Math.sin(t * 12) * 0.014 * motor;
    this._head.rotation.x = Math.sin(t * 9) * 0.1 * motor;
    for (const wheel of this._wheels) wheel.rotation.x = -travel * 0.63 / 0.062;
    this._key.rotation.x = -travel * Math.PI * 5;
    if (this.toyElapsed >= TOY_DURATION) {
      this.toy.rotation.z = 0; this._head.rotation.x = 0; this.toyActive = false;
    }
  }

  reset() {
    this.toyActive = false; this.toyElapsed = 0;
    if (!this.toy) return;
    this.toy.position.copy(this._initialPosition); this.toy.rotation.set(0, this._initialYaw, 0);
    this._head.rotation.set(0, 0, 0); this._key.rotation.set(0, 0, 0);
    for (const wheel of this._wheels) wheel.rotation.set(0, 0, 0);
  }
}
