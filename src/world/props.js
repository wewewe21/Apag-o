// Fabricas de objetos de cena, montados com primitivas + texturas procedurais.
// Convencao: frente do objeto em +Z local, origem no chao, centro da base.
import * as THREE from 'three';
import { mulberry32 } from '../core/rng.js';
import { textTexture } from './textures.js';

export function makeMaterials(T) {
  const std = (tex, o = {}) => new THREE.MeshStandardMaterial({
    map: tex?.map ?? null, normalMap: tex?.normalMap ?? null, color: o.color ?? 0xffffff,
    roughness: o.rough ?? 0.7, metalness: o.metal ?? 0, side: o.side ?? THREE.FrontSide,
    transparent: !!o.transparent, opacity: o.opacity ?? 1,
  });
  return {
    steel: std(T.mat.steel, { rough: 0.35, metal: 0.75 }),
    steelDark: std(T.mat.steel, { rough: 0.5, metal: 0.6, color: 0x777a7c }),
    chrome: new THREE.MeshStandardMaterial({ color: 0xb8bcc0, roughness: 0.25, metalness: 0.9 }),
    locker: std(T.mat.locker, { rough: 0.6, metal: 0.35 }),
    cabinet: std(T.mat.cabinet, { rough: 0.55, metal: 0.3 }),
    rust: std(T.mat.rust, { rough: 0.9, metal: 0.3 }),
    wood: std(T.mat.wood, { rough: 0.7 }),
    mattress: std(T.mat.mattress, { rough: 0.95 }),
    sheet: std(T.mat.sheet, { rough: 0.95, side: THREE.DoubleSide }),
    curtain: std(T.mat.curtain, { rough: 0.95, side: THREE.DoubleSide }),
    bag: std(T.mat.bag, { rough: 0.35, metal: 0.1 }),
    strap: std(T.mat.strap, { rough: 0.9 }),
    rubber: new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.9 }),
    black: new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.6 }),
    white: new THREE.MeshStandardMaterial({ color: 0xd8d4c8, roughness: 0.6 }),
    ceramic: new THREE.MeshStandardMaterial({ color: 0xe8e2d0, roughness: 0.35 }),
    brass: new THREE.MeshStandardMaterial({ color: 0xb08a4a, roughness: 0.35, metalness: 0.9 }),
    glass: new THREE.MeshStandardMaterial({ color: 0x223028, roughness: 0.05, metalness: 0.2, transparent: true, opacity: 0.45 }),
    specimen: new THREE.MeshStandardMaterial({ color: 0x8a8a52, roughness: 0.1, transparent: true, opacity: 0.75 }),
    flesh: new THREE.MeshStandardMaterial({ color: 0x9a8f86, roughness: 0.5 }),
    paper: new THREE.MeshStandardMaterial({ color: 0xcfc6ae, roughness: 0.95, side: THREE.DoubleSide }),
    cardboard: new THREE.MeshStandardMaterial({ color: 0x8a6f4c, roughness: 0.95 }),
    brick: std(T.wall.brick, { rough: 0.95 }),
    concrete: std(T.wall.concrete, { rough: 0.95 }),
    screen: new THREE.MeshStandardMaterial({ color: 0x0b1410, emissive: 0x1d3a2c, emissiveIntensity: 0.6, roughness: 0.2 }),
    tag: new THREE.MeshStandardMaterial({ color: 0xd9cfa8, roughness: 0.9 }),
    blood: new THREE.MeshStandardMaterial({ color: 0x3a0806, roughness: 0.3 }),
    redPaint: new THREE.MeshStandardMaterial({ color: 0x7a1510, roughness: 0.6 }),
    yellow: new THREE.MeshStandardMaterial({ color: 0xa8902a, roughness: 0.6 }),
  };
}

// ---------- helpers ----------
const _box = new THREE.BoxGeometry(1, 1, 1);
const _cyl = new THREE.CylinderGeometry(1, 1, 1, 12);
const _cyl6 = new THREE.CylinderGeometry(1, 1, 1, 6);
const _sph = new THREE.SphereGeometry(1, 12, 8);

function add(g, geo, mat, x, y, z, sx = 1, sy = 1, sz = 1, rx = 0, ry = 0, rz = 0) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z); m.scale.set(sx, sy, sz); m.rotation.set(rx, ry, rz);
  m.castShadow = true; m.receiveShadow = true;
  g.add(m); return m;
}
export const box = (g, mat, w, h, d, x, y, z, rx = 0, ry = 0, rz = 0) => add(g, _box, mat, x, y, z, w, h, d, rx, ry, rz);
export const cyl = (g, mat, r, h, x, y, z, rx = 0, ry = 0, rz = 0, lo = false) => add(g, lo ? _cyl6 : _cyl, mat, x, y, z, r, h, r, rx, ry, rz);
export const sph = (g, mat, rx_, ry_, rz_, x, y, z) => add(g, _sph, mat, x, y, z, rx_, ry_, rz_);
const tube = (g, mat, r, x0, y0, z0, x1, y1, z1) => {
  const a = new THREE.Vector3(x0, y0, z0), b = new THREE.Vector3(x1, y1, z1);
  const len = a.distanceTo(b);
  const m = add(g, _cyl6, mat, (x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2, r, len, r);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.sub(a).normalize());
  return m;
};

// ---------- mobiliario ----------
export function bed(M, kind, rng) {
  const g = new THREE.Group();
  const L = 2.0, W = 0.92, top = 0.58;
  if (kind === 'gurney') {
    box(g, M.steel, 0.66, 0.04, 1.95, 0, 0.82, 0);
    box(g, M.steel, 0.04, 0.06, 1.95, -0.33, 0.85, 0); box(g, M.steel, 0.04, 0.06, 1.95, 0.33, 0.85, 0);
    for (const s of [-1, 1]) {
      tube(g, M.steelDark, 0.02, -0.26, 0.1, s * 0.8, 0.26, 0.8, s * 0.8);
      tube(g, M.steelDark, 0.02, 0.26, 0.1, s * 0.8, -0.26, 0.8, s * 0.8);
      for (const sx of [-1, 1]) sph(g, M.rubber, 0.05, 0.05, 0.05, sx * 0.26, 0.05, s * 0.8);
    }
    box(g, M.steelDark, 0.5, 0.03, 1.5, 0, 0.3, 0);   // prateleira de baixo
    const r = rng();
    const body = new THREE.Group(); body.userData.overlay = true; g.add(body);   // o que fica em cima da maca sobrevive a troca do visual da maca por um modelo 3D
    if (r < 0.45) cadaver(body, M, 0.86, rng);
    else if (r < 0.8) bodyBag(body, M, 0.86);
    else box(body, M.sheet, 0.7, 0.02, 1.2, 0, 0.855, 0.3, 0, 0.2, 0);
    return { g, w: 0.7, d: 1.95, top: 0.86, clearance: 0.75 };
  }
  // cama de hospital
  const frame = kind === 'ward' ? M.cabinet : M.rust;
  for (const sx of [-1, 1]) {
    box(g, frame, 0.04, 0.05, L, sx * W / 2, top - 0.08, 0);
    for (const sz of [-1, 1]) { cyl(g, frame, 0.022, top - 0.08, sx * (W / 2 - 0.02), (top - 0.08) / 2, sz * (L / 2 - 0.05), 0, 0, 0, true); sph(g, M.rubber, 0.04, 0.04, 0.04, sx * (W / 2 - 0.02), 0.04, sz * (L / 2 - 0.05)); }
  }
  // cabeceira e pe de grade
  for (const [z, h] of [[-L / 2, 1.0], [L / 2, 0.8]]) {
    box(g, frame, W, 0.04, 0.04, 0, h, z); box(g, frame, W, 0.04, 0.04, 0, top, z);
    for (let i = -3; i <= 3; i++) cyl(g, frame, 0.012, h - top, i * W / 7, (h + top) / 2, z, 0, 0, 0, true);
    for (const sx of [-1, 1]) cyl(g, frame, 0.025, h, sx * W / 2, h / 2, z, 0, 0, 0, true);
  }
  box(g, frame, W, 0.03, L, 0, top - 0.04, 0);
  const matt = box(g, M.mattress, W - 0.06, 0.14, L - 0.12, 0, top + 0.07, 0);
  matt.rotation.z = (rng() - 0.5) * 0.04;
  box(g, M.sheet, 0.55, 0.09, 0.32, 0, top + 0.18, -L / 2 + 0.3, 0.1, 0, 0);
  if (kind === 'bed') {
    // tiras de contencao de couro
    for (const z of [-0.3, 0.45]) {
      box(g, M.strap, W + 0.02, 0.012, 0.09, 0, top + 0.15, z);
      for (const sx of [-1, 1]) { box(g, M.strap, 0.012, 0.35, 0.09, sx * (W / 2 + 0.02), top - 0.02, z, 0, 0, sx * 0.1); box(g, M.brass, 0.04, 0.05, 0.02, sx * (W / 2 + 0.03), top - 0.15, z); }
    }
  } else {
    box(g, M.sheet, W - 0.02, 0.02, L * 0.55, 0, top + 0.15, 0.3, 0.02, 0, 0);
  }
  return { g, w: W, d: L, top: top + 0.14, clearance: top - 0.08 };
}

function cadaver(g, M, y, rng) {
  // corpo coberto por lencol, pes de fora com etiqueta
  const b = new THREE.Group();
  const stain = rng() < 0.5;       // SEMPRE gasta o sorteio, com ou sem modelo 3D: o gerador do mundo e compartilhado e qualquer diferenca desloca toda a mobilia sorteada (e a colisao do servidor)
  const model = M.models?.instance('cadaver', { w: 0.66, d: 1.9 });     // modelo 3D opcional (assets/models); sem ele, o corpo de elipsoides de sempre
  if (model) { model.position.y = y; b.add(model); g.add(b); return; }
  sph(b, M.sheet, 0.13, 0.12, 0.15, 0, y + 0.1, -0.78);          // cabeca
  sph(b, M.sheet, 0.25, 0.13, 0.45, 0, y + 0.1, -0.25);          // torso
  sph(b, M.sheet, 0.22, 0.1, 0.5, 0, y + 0.07, 0.35);            // pernas
  box(b, M.sheet, 0.66, 0.02, 1.8, 0, y + 0.01, 0);
  for (const sx of [-1, 1]) {
    sph(b, M.flesh, 0.045, 0.1, 0.05, sx * 0.08, y + 0.1, 0.9);  // pes
  }
  box(b, M.tag, 0.05, 0.08, 0.004, 0.08, y + 0.03, 0.97, 0.2, 0, 0.3);
  if (stain) box(b, M.blood, 0.2, 0.005, 0.3, 0.05, y + 0.23, -0.2);
  g.add(b);
}

function bodyBag(g, M, y) {
  sph(g, M.bag, 0.3, 0.14, 0.95, 0, y + 0.09, 0);
  box(g, M.steelDark, 0.01, 0.01, 1.6, 0, y + 0.23, 0);   // ziper
}

// Armario de metal. A porta tem frestas REAIS (venezianas): o jogador escondido enxerga o ambiente
// por elas. eyeY e a altura dos olhos de quem esta dentro, alinhada com a fresta central.
export const LOCKER = { w: 0.56, h: 1.92, d: 0.5, eyeY: 1.68, eyeBack: 0.07, slotH: 0.04, slat: 0.022 };
export function locker(M) {
  const g = new THREE.Group();
  const { w, h, d, eyeY, slotH, slat } = LOCKER, t = 0.02;
  box(g, M.locker, w, h, t, 0, h / 2, -d / 2 + t / 2);          // fundo
  box(g, M.locker, t, h, d, -w / 2 + t / 2, h / 2, 0);
  box(g, M.locker, t, h, d, w / 2 - t / 2, h / 2, 0);
  box(g, M.locker, w, t, d, 0, h - t / 2, 0);
  box(g, M.locker, w, t, d, 0, 0.06, 0);
  box(g, M.black, w - 0.04, 0.05, d - 0.02, 0, 0.025, 0);
  box(g, M.locker, w - 0.04, t, d - 0.04, 0, h - 0.07, 0);      // prateleira do topo (acima dos olhos de quem esta dentro)
  // porta (pivo na borda esquerda)
  const pivot = new THREE.Group(); pivot.position.set(-w / 2, 0, d / 2); g.add(pivot);
  const door = new THREE.Group(); pivot.add(door);
  const pw = w - 0.01, zoneLo = eyeY - 0.18, zoneHi = eyeY + 0.18, stile = 0.09;
  box(door, M.locker, pw, zoneLo - 0.02, 0.02, w / 2, (zoneLo + 0.02) / 2, 0);                       // parte de baixo, cheia
  box(door, M.locker, pw, h - 0.02 - zoneHi, 0.02, w / 2, (zoneHi + h - 0.02) / 2, 0);              // travessa do topo
  box(door, M.locker, stile, zoneHi - zoneLo, 0.02, 0.005 + stile / 2, (zoneLo + zoneHi) / 2, 0);    // batentes laterais da veneziana
  box(door, M.locker, stile, zoneHi - zoneLo, 0.02, 0.005 + pw - stile / 2, (zoneLo + zoneHi) / 2, 0);
  // venezianas: 5 frestas de slotH entre 6 lâminas (as das pontas sao mais grossas); a fresta do meio fica na altura dos olhos
  const pitch = slotH + slat, vx0 = 0.005 + stile, vw = pw - 2 * stile;
  const edges = [zoneLo];
  for (let k = -2; k <= 2; k++) { edges.push(eyeY + k * pitch - slotH / 2, eyeY + k * pitch + slotH / 2); }
  edges.push(zoneHi);
  for (let i = 0; i < edges.length; i += 2) {           // lamina = intervalo entre o fim de uma fresta e o inicio da proxima
    const y0 = edges[i], y1 = edges[i + 1];
    if (y1 - y0 > 0.002) box(door, M.locker, vw, y1 - y0, 0.02, vx0 + vw / 2, (y0 + y1) / 2, 0);
  }
  for (let i = 0; i < 4; i++) box(door, M.black, w * 0.5, 0.012, 0.022, w / 2, 0.2 + i * 0.035, 0.001);   // grade de baixo (so decoracao)
  box(door, M.chrome, 0.03, 0.14, 0.03, w - 0.07, h * 0.52, 0.02);
  box(door, M.tag, 0.12, 0.05, 0.004, w / 2, 0.55, 0.012);
  return { g, pivot, w, d, h, eyeY };
}

export function wheelchair(M, rng) {
  const g = new THREE.Group();
  for (const sx of [-1, 1]) {
    const wheel = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.02, 6, 20), M.rubber);
    wheel.position.set(sx * 0.3, 0.31, -0.05); wheel.rotation.y = Math.PI / 2; wheel.castShadow = true; g.add(wheel);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.26, 0.008, 4, 20), M.chrome);
    rim.position.set(sx * 0.33, 0.31, -0.05); rim.rotation.y = Math.PI / 2; g.add(rim);
    sph(g, M.rubber, 0.05, 0.05, 0.05, sx * 0.22, 0.05, 0.35);
    tube(g, M.chrome, 0.012, sx * 0.24, 0.5, -0.25, sx * 0.24, 0.95, -0.3);
    tube(g, M.chrome, 0.012, sx * 0.24, 0.48, -0.25, sx * 0.24, 0.48, 0.3);
    tube(g, M.chrome, 0.012, sx * 0.22, 0.48, 0.3, sx * 0.2, 0.1, 0.4);
    tube(g, M.chrome, 0.012, sx * 0.24, 0.66, -0.2, sx * 0.24, 0.66, 0.2);
  }
  box(g, M.strap, 0.46, 0.03, 0.45, 0, 0.5, 0.02);
  box(g, M.strap, 0.46, 0.4, 0.02, 0, 0.75, -0.27, -0.1, 0, 0);
  box(g, M.steelDark, 0.4, 0.02, 0.12, 0, 0.12, 0.42);
  g.rotation.y = (rng() - 0.5) * 0.6;
  return { g, w: 0.7, d: 0.8 };
}

export function ivStand(M) {
  const g = new THREE.Group();
  cyl(g, M.chrome, 0.012, 1.9, 0, 0.95, 0, 0, 0, 0, true);
  for (let i = 0; i < 5; i++) { const a = i / 5 * Math.PI * 2; tube(g, M.chrome, 0.01, 0, 0.08, 0, Math.cos(a) * 0.28, 0.05, Math.sin(a) * 0.28); sph(g, M.rubber, 0.025, 0.025, 0.025, Math.cos(a) * 0.28, 0.025, Math.sin(a) * 0.28); }
  tube(g, M.chrome, 0.008, -0.15, 1.85, 0, 0.15, 1.85, 0);
  sph(g, M.specimen, 0.06, 0.1, 0.03, 0.12, 1.7, 0);
  tube(g, M.glass, 0.004, 0.12, 1.6, 0, 0.05, 0.8, 0.05);
  return { g, w: 0.5, d: 0.5 };
}

export function desk(M, len, kind, rng) {
  const g = new THREE.Group();
  if (kind === 'reception') {
    box(g, M.wood, len, 1.08, 0.08, 0, 0.54, 0.35);
    box(g, M.wood, len + 0.1, 0.05, 0.4, 0, 1.1, 0.3);
    box(g, M.wood, len, 0.04, 0.7, 0, 0.76, 0);
    box(g, M.wood, 0.06, 0.76, 0.7, -len / 2 + 0.03, 0.38, 0); box(g, M.wood, 0.06, 0.76, 0.7, len / 2 - 0.03, 0.38, 0);
    crt(g, M, -len * 0.25, 0.78, -0.05);
    papers(g, M, rng, len * 0.8, 0.8, 0.79, 0);
    box(g, M.black, 0.2, 0.08, 0.15, len * 0.3, 0.82, 0); // telefone
    return { g, w: len, d: 0.8, top: 0.79 };
  }
  if (kind === 'lab' || kind === 'bench') {
    const topMat = kind === 'lab' ? M.ceramic : M.wood;
    box(g, topMat, len, 0.05, 0.75, 0, 0.9, 0);
    box(g, kind === 'lab' ? M.cabinet : M.rust, len - 0.05, 0.85, 0.7, 0, 0.44, -0.02);
    for (let x = -len / 2 + 0.3; x < len / 2; x += 0.6) box(g, M.chrome, 0.12, 0.015, 0.015, x, 0.75, 0.34);
    if (kind === 'lab') {
      for (let i = 0; i < 6; i++) jar(g, M, (rng() - 0.5) * (len - 0.4), 0.925, (rng() - 0.5) * 0.4, rng);
      microscope(g, M, len * 0.3, 0.925, 0);
    } else {
      for (let i = 0; i < 5; i++) box(g, M.rust, 0.08 + rng() * 0.2, 0.05, 0.05 + rng() * 0.2, (rng() - 0.5) * len * 0.8, 0.95, (rng() - 0.5) * 0.4, 0, rng() * 3, 0);
      box(g, M.redPaint, 0.35, 0.18, 0.2, -len * 0.3, 1.01, 0.1);  // caixa de ferramentas
    }
    return { g, w: len, d: 0.75, top: 0.925 };
  }
  // escritorio
  box(g, M.wood, len, 0.04, 0.8, 0, 0.76, 0);
  box(g, M.cabinet, 0.45, 0.72, 0.72, len / 2 - 0.25, 0.37, 0);
  for (let i = 0; i < 3; i++) box(g, M.chrome, 0.1, 0.015, 0.015, len / 2 - 0.25, 0.2 + i * 0.22, 0.37);
  box(g, M.steelDark, 0.04, 0.74, 0.7, -len / 2 + 0.05, 0.37, 0);
  papers(g, M, rng, len * 0.7, 0.6, 0.78, 0);
  if (rng() < 0.7) crt(g, M, -len * 0.2, 0.78, -0.1);
  chair(g, M, -len * 0.1, 0, 0.7, Math.PI + (rng() - 0.5) * 0.8);
  return { g, w: len, d: 0.8, top: 0.78 };
}

function crt(g, M, x, y, z) {
  box(g, M.cabinet, 0.4, 0.36, 0.4, x, y + 0.18, z);
  box(g, M.screen, 0.32, 0.26, 0.01, x, y + 0.2, z + 0.201);
  box(g, M.cabinet, 0.4, 0.04, 0.3, x, y + 0.02, z + 0.25);
}

function papers(g, M, rng, w, d, y, z) {
  for (let i = 0; i < 6; i++) {
    const p = box(g, M.paper, 0.21, 0.002, 0.297, (rng() - 0.5) * w, y + i * 0.002, z + (rng() - 0.5) * d * 0.6, 0, rng() * 3, 0);
    p.castShadow = false;
  }
}

function jar(g, M, x, y, z, rng) {
  const h = 0.15 + rng() * 0.2, r = 0.05 + rng() * 0.05;
  cyl(g, M.glass, r, h, x, y + h / 2, z);
  cyl(g, M.specimen, r * 0.92, h * 0.8, x, y + h * 0.4, z);
  if (rng() < 0.6) sph(g, M.flesh, r * 0.6, h * 0.25, r * 0.5, x, y + h * 0.4, z);
  cyl(g, M.black, r * 1.02, 0.02, x, y + h, z);
}

function microscope(g, M, x, y, z) {
  box(g, M.black, 0.16, 0.03, 0.2, x, y + 0.015, z);
  tube(g, M.black, 0.02, x, y, z - 0.07, x, y + 0.28, z - 0.02);
  tube(g, M.steelDark, 0.025, x, y + 0.2, z, x, y + 0.35, z + 0.05);
}

export function chair(g, M, x, y, z, ry) {
  const c = new THREE.Group();
  box(c, M.strap, 0.44, 0.05, 0.42, 0, 0.46, 0);
  box(c, M.strap, 0.44, 0.4, 0.04, 0, 0.72, -0.2);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) cyl(c, M.chrome, 0.012, 0.46, sx * 0.19, 0.23, sz * 0.18, 0, 0, 0, true);
  c.position.set(x, y, z); c.rotation.y = ry;
  g.add(c);
  return c;
}

export function shelf(M, rng, fill = 'boxes') {
  const g = new THREE.Group();
  const w = 1.1, h = 2.05, d = 0.45;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) box(g, M.cabinet, 0.035, h, 0.035, sx * (w / 2 - 0.02), h / 2, sz * (d / 2 - 0.02));
  for (let i = 0; i < 5; i++) {
    const y = 0.1 + i * 0.47;
    box(g, M.cabinet, w, 0.02, d, 0, y, 0);
    let x = -w / 2 + 0.05;
    while (x < w / 2 - 0.1) {
      const r = rng();
      if (fill === 'boxes' || (fill === 'mixed' && r < 0.5)) {
        const bw = 0.2 + rng() * 0.25, bh = 0.18 + rng() * 0.2;
        if (rng() < 0.85) box(g, M.cardboard, bw, bh, d * 0.85, x + bw / 2, y + bh / 2 + 0.01, 0, 0, (rng() - 0.5) * 0.1, 0);
        x += bw + 0.02;
      } else {
        const bw = 0.05 + rng() * 0.04;
        if (rng() < 0.8) {
          if (fill === 'bottles') { cyl(g, rng() < 0.5 ? M.glass : M.white, bw / 2, 0.12 + rng() * 0.1, x + bw / 2, y + 0.08, (rng() - 0.5) * 0.2); }
          else box(g, rng() < 0.5 ? M.strap : M.cardboard, bw, 0.3, 0.26, x + bw / 2, y + 0.16, 0, 0, 0, (rng() - 0.5) * 0.25);
        }
        x += bw + 0.01;
      }
    }
  }
  return { g, w, d, h };
}

export function cabinet(M, rng) {
  const g = new THREE.Group();
  const w = 0.9, h = 1.8, d = 0.4;
  box(g, M.cabinet, w, h, d, 0, h / 2, 0);
  box(g, M.glass, w - 0.08, h * 0.5, 0.01, 0, h * 0.7, d / 2 + 0.005);
  for (let i = 0; i < 3; i++) for (let j = 0; j < 5; j++) if (rng() < 0.7) cyl(g, rng() < 0.5 ? M.glass : M.specimen, 0.035, 0.12, -w / 2 + 0.12 + j * 0.16, h * 0.5 + i * 0.28 + 0.07, 0.05);
  box(g, M.chrome, 0.1, 0.015, 0.02, 0, h * 0.35, d / 2 + 0.01);
  return { g, w, d, h };
}

export function filingCabinet(M) {
  const g = new THREE.Group();
  box(g, M.cabinet, 0.5, 1.35, 0.6, 0, 0.675, 0);
  for (let i = 0; i < 4; i++) { box(g, M.cabinet, 0.46, 0.3, 0.02, 0, 0.18 + i * 0.32, 0.305); box(g, M.chrome, 0.12, 0.02, 0.02, 0, 0.26 + i * 0.32, 0.32); }
  return { g, w: 0.5, d: 0.6, h: 1.35 };
}

export function sideTable(M) {
  const g = new THREE.Group();
  box(g, M.cabinet, 0.45, 0.6, 0.4, 0, 0.3, 0);
  box(g, M.chrome, 0.1, 0.015, 0.02, 0, 0.45, 0.205);
  return { g, w: 0.45, d: 0.4, top: 0.6 };
}

export function cart(M, rng) {
  const g = new THREE.Group();
  box(g, M.cabinet, 0.6, 0.7, 0.45, 0, 0.47, 0);
  for (let i = 0; i < 4; i++) box(g, M.redPaint, 0.56, 0.14, 0.01, 0, 0.2 + i * 0.16, 0.23);
  box(g, M.steel, 0.66, 0.03, 0.5, 0, 0.84, 0);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) sph(g, M.rubber, 0.04, 0.04, 0.04, sx * 0.26, 0.05, sz * 0.18);
  for (let i = 0; i < 4; i++) cyl(g, M.glass, 0.03, 0.1, (rng() - 0.5) * 0.4, 0.9, (rng() - 0.5) * 0.3);
  return { g, w: 0.66, d: 0.5, top: 0.855 };
}

export function autopsyTable(M, rng) {
  const g = new THREE.Group();
  cyl(g, M.steel, 0.12, 0.8, 0, 0.4, 0);
  box(g, M.steel, 0.5, 0.05, 0.5, 0, 0.03, 0);
  box(g, M.steel, 0.8, 0.04, 2.1, 0, 0.84, 0);
  for (const sx of [-1, 1]) box(g, M.steel, 0.03, 0.06, 2.1, sx * 0.39, 0.88, 0);
  box(g, M.steel, 0.8, 0.06, 0.03, 0, 0.88, -1.04); box(g, M.steel, 0.8, 0.06, 0.03, 0, 0.88, 1.04);
  cyl(g, M.black, 0.04, 0.01, 0, 0.865, 0.95);
  box(g, M.blood, 0.4, 0.004, 0.7, (rng() - 0.5) * 0.2, 0.863, 0.3);
  // bandeja de instrumentos
  const tray = new THREE.Group(); tray.position.set(0.7, 0, -0.5); tray.userData.overlay = true; g.add(tray);
  cyl(tray, M.chrome, 0.015, 1.0, 0, 0.5, 0, 0, 0, 0, true);
  box(tray, M.steel, 0.45, 0.02, 0.3, 0, 1.0, 0);
  for (let i = 0; i < 6; i++) box(tray, M.chrome, 0.012, 0.008, 0.16 + rng() * 0.06, -0.18 + i * 0.07, 1.015, (rng() - 0.5) * 0.05, 0, (rng() - 0.5) * 0.2, 0);
  return { g, w: 0.8, d: 2.1 };
}

export function nurseStation(M, rng) {
  const g = new THREE.Group();
  box(g, M.cabinet, 1.2, 1.05, 0.6, 0, 0.525, 0);
  box(g, M.wood, 1.3, 0.04, 0.7, 0, 1.07, 0);
  papers(g, M, rng, 1, 0.5, 1.09, 0);
  box(g, M.black, 0.3, 0.3, 0.05, 0.3, 1.25, -0.2);   // prancheta
  return { g, w: 1.3, d: 0.7 };
}

export function boiler(M) {
  const g = new THREE.Group();
  cyl(g, M.rust, 0.75, 2.4, 0, 1.0, 0, 0, 0, Math.PI / 2);
  for (const sx of [-1, 1]) { box(g, M.brick, 0.4, 0.3, 1.2, sx * 0.8, 0.15, 0); }
  cyl(g, M.rust, 0.14, 1.8, -0.6, 2.4, 0);
  cyl(g, M.rust, 0.1, 1.5, 0.7, 2.3, 0.2);
  cyl(g, M.white, 0.12, 0.05, 1.21, 1.3, 0.2, 0, 0, Math.PI / 2);
  cyl(g, M.black, 0.1, 0.06, 1.22, 1.3, 0.2, 0, 0, Math.PI / 2);
  box(g, M.black, 0.02, 0.5, 0.5, 1.21, 0.8, -0.2);   // portinhola
  return { g, w: 2.6, d: 1.6 };
}

export function generator(M) {
  const g = new THREE.Group();
  box(g, M.locker, 2.2, 1.3, 1.1, 0, 0.75, 0);
  box(g, M.black, 2.3, 0.1, 1.2, 0, 0.05, 0);
  for (let i = 0; i < 10; i++) box(g, M.black, 0.03, 0.8, 1.12, -0.9 + i * 0.1, 0.8, 0);
  cyl(g, M.rust, 0.35, 1.0, 0.2, 1.75, 0, 0, 0, Math.PI / 2);
  box(g, M.cabinet, 0.5, 0.6, 0.1, 0.8, 1.2, 0.56);
  for (let i = 0; i < 3; i++) cyl(g, M.white, 0.05, 0.02, 0.65 + i * 0.15, 1.35, 0.62, Math.PI / 2, 0, 0);
  tube(g, M.black, 0.04, -1.1, 1.2, 0, -1.1, 3.1, 0);
  return { g, w: 2.3, d: 1.2 };
}

export function incinerator(M) {
  const g = new THREE.Group();
  box(g, M.brick, 2.0, 2.2, 1.4, 0, 1.1, 0);
  box(g, M.rust, 0.8, 0.6, 0.06, 0, 0.9, 0.72);
  box(g, M.black, 0.6, 0.4, 0.02, 0, 0.9, 0.76);
  tube(g, M.rust, 0.25, 0, 2.2, -0.3, 0, 3.2, -0.3);
  return { g, w: 2.0, d: 1.4 };
}

export function barrel(M, rng) {
  const g = new THREE.Group();
  cyl(g, rng() < 0.5 ? M.rust : M.locker, 0.3, 0.9, 0, 0.45, 0);
  cyl(g, M.black, 0.305, 0.03, 0, 0.3, 0); cyl(g, M.black, 0.305, 0.03, 0, 0.62, 0);
  return { g, w: 0.6, d: 0.6 };
}

export function crate(M, rng) {
  const g = new THREE.Group();
  const s = 0.5 + rng() * 0.3;
  box(g, M.wood, s, s * 0.8, s, 0, s * 0.4, 0, 0, rng() * 0.5, 0);
  if (rng() < 0.5) box(g, M.cardboard, s * 0.7, s * 0.5, s * 0.7, 0, s * 0.8 + s * 0.25, 0, 0, rng(), 0);
  return { g, w: s, d: s };
}

export function trashBin(M) {
  const g = new THREE.Group();
  cyl(g, M.cabinet, 0.2, 0.55, 0, 0.275, 0);
  cyl(g, M.black, 0.19, 0.02, 0, 0.55, 0);
  return { g, w: 0.4, d: 0.4 };
}

export function bench(M) {
  const g = new THREE.Group();
  box(g, M.wood, 1.6, 0.05, 0.4, 0, 0.45, 0);
  box(g, M.wood, 1.6, 0.35, 0.04, 0, 0.72, -0.18, -0.15, 0, 0);
  for (const sx of [-1, 1]) box(g, M.steelDark, 0.05, 0.45, 0.38, sx * 0.7, 0.225, 0);
  return { g, w: 1.6, d: 0.45 };
}

export function radiator(M) {
  const g = new THREE.Group();
  for (let i = 0; i < 12; i++) box(g, M.cabinet, 0.05, 0.6, 0.12, -0.33 + i * 0.06, 0.45, 0);
  box(g, M.cabinet, 0.75, 0.04, 0.1, 0, 0.13, 0);
  return { g, w: 0.8, d: 0.15 };
}

export function extinguisher(M) {
  const g = new THREE.Group();
  cyl(g, M.redPaint, 0.08, 0.5, 0, 1.0, 0);
  box(g, M.black, 0.06, 0.08, 0.06, 0, 1.28, 0);
  return { g, w: 0.2, d: 0.2 };
}

export function sink(M) {
  const g = new THREE.Group();
  box(g, M.ceramic, 0.6, 0.18, 0.45, 0, 0.85, 0);
  box(g, M.black, 0.5, 0.02, 0.35, 0, 0.94, 0);
  cyl(g, M.chrome, 0.015, 0.25, 0, 1.02, -0.18);
  tube(g, M.chrome, 0.015, 0, 1.12, -0.18, 0, 1.12, -0.05);
  cyl(g, M.steelDark, 0.03, 0.75, 0, 0.38, -0.1);
  return { g, w: 0.6, d: 0.45 };
}

export function restraintChair(M) {
  const g = new THREE.Group();
  box(g, M.wood, 0.55, 0.06, 0.5, 0, 0.5, 0);
  box(g, M.wood, 0.55, 0.9, 0.06, 0, 0.95, -0.25);
  for (const sx of [-1, 1]) {
    box(g, M.wood, 0.06, 0.5, 0.06, sx * 0.25, 0.25, 0.2); box(g, M.wood, 0.06, 0.5, 0.06, sx * 0.25, 0.25, -0.2);
    box(g, M.wood, 0.08, 0.05, 0.5, sx * 0.3, 0.72, 0);
    box(g, M.strap, 0.1, 0.03, 0.08, sx * 0.3, 0.76, 0.1);
    box(g, M.strap, 0.08, 0.1, 0.08, sx * 0.12, 0.1, 0.22);
  }
  box(g, M.strap, 0.4, 0.06, 0.02, 0, 1.25, -0.2);
  box(g, M.steelDark, 0.25, 0.25, 0.25, 0, 1.55, -0.2);   // capacete de eletrochoque
  return { g, w: 0.6, d: 0.6 };
}

export function breakerBoard(M) {
  const g = new THREE.Group();
  box(g, M.cabinet, 1.2, 1.4, 0.2, 0, 1.4, 0);
  for (let i = 0; i < 4; i++) for (let j = 0; j < 6; j++) box(g, M.black, 0.1, 0.16, 0.04, -0.45 + j * 0.18, 1.05 + i * 0.25, 0.1);
  box(g, M.yellow, 0.6, 0.1, 0.01, 0, 2.02, 0.101);
  return { g, w: 1.2, d: 0.2 };
}

export function vent(M) {
  const g = new THREE.Group();
  box(g, M.black, 0.62, 0.42, 0.04, 0, 0.3, 0);
  for (let i = 0; i < 6; i++) box(g, M.rust, 0.6, 0.02, 0.05, 0, 0.13 + i * 0.065, 0.02, -0.5, 0, 0);
  box(g, M.rust, 0.66, 0.03, 0.05, 0, 0.53, 0.01); box(g, M.rust, 0.66, 0.03, 0.05, 0, 0.08, 0.01);
  return { g, w: 0.66, d: 0.06 };
}

export function pipes(M, len, rng) {
  const g = new THREE.Group();
  const n = 1 + Math.floor(rng() * 3);
  for (let i = 0; i < n; i++) {
    const r = 0.04 + rng() * 0.08;
    cyl(g, rng() < 0.5 ? M.rust : M.steelDark, r, len, 0, 0, i * 0.22, 0, 0, Math.PI / 2, true);
  }
  return { g };
}

export function sign(text, opts = {}) {
  const w = opts.w ?? 0.9, h = opts.h ?? 0.22;
  const tex = textTexture([text], { w: 512, h: Math.round(512 * h / w), bg: opts.bg ?? '#d7d2c2', color: opts.color ?? '#1d2a24', font: opts.font ?? '600 60px "Saira Stencil One", Impact, sans-serif', rough: opts.rough ?? 0.35 });
  return new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.8 }));
}

export function graffiti(text, opts = {}) {
  const w = opts.w ?? 1.6, h = opts.h ?? 0.5;
  const tex = textTexture([text], { w: 1024, h: Math.round(1024 * h / w), color: opts.color ?? 'rgba(60,8,6,0.85)', font: opts.font ?? '700 110px "Special Elite", "Courier New", monospace', rough: 0.5, rot: opts.rot ?? -0.04 });
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ map: tex, transparent: true, depthWrite: false, roughness: 0.6, polygonOffset: true, polygonOffsetFactor: -2 }));
  m.renderOrder = 2;
  return m;
}

// ---------- itens coletaveis ----------
export function fuseMesh(M) {
  const g = new THREE.Group();
  const body = new THREE.MeshStandardMaterial({ color: 0xe9e4d4, roughness: 0.3 });
  cyl(g, body, 0.028, 0.11, 0, 0.055, 0, 0, 0, Math.PI / 2);
  for (const s of [-1, 1]) { cyl(g, M.brass, 0.031, 0.025, s * 0.065, 0.055, 0, 0, 0, Math.PI / 2); box(g, M.brass, 0.012, 0.05, 0.03, s * 0.085, 0.055, 0); }
  const lbl = new THREE.MeshStandardMaterial({ color: 0x8a2a1c, roughness: 0.6 });
  cyl(g, lbl, 0.0285, 0.03, 0, 0.055, 0, 0, 0, Math.PI / 2);
  g.rotation.y = 0.4;
  return g;
}

export function batteryMesh(M) {
  const g = new THREE.Group();
  const m = new THREE.MeshStandardMaterial({ color: 0x2b3a2a, roughness: 0.4, metalness: 0.3 });
  cyl(g, m, 0.017, 0.06, 0, 0.017, 0, 0, 0, Math.PI / 2);
  cyl(g, M.brass, 0.018, 0.02, 0.035, 0.017, 0, 0, 0, Math.PI / 2);
  cyl(g, m, 0.017, 0.06, 0.01, 0.017, 0.045, 0, 0.3, Math.PI / 2);
  return g;
}

export function keyMesh(M) {
  const g = new THREE.Group();
  cyl(g, M.brass, 0.018, 0.004, 0, 0.003, 0);
  box(g, M.brass, 0.07, 0.004, 0.01, 0.045, 0.003, 0);
  box(g, M.brass, 0.012, 0.004, 0.02, 0.07, 0.003, 0.012);
  const tag = box(g, new THREE.MeshStandardMaterial({ color: 0x9a2a1a, roughness: 0.8 }), 0.05, 0.003, 0.08, -0.05, 0.003, 0.02, 0, 0.3, 0);
  tag.castShadow = false;
  return g;
}

export function noteMesh(M) {
  const g = new THREE.Group();
  const s = new THREE.Group(); s.rotation.y = 0.3; g.add(s);
  const p = box(s, M.paper, 0.21, 0.003, 0.297, 0, 0.002, 0);
  const lines = new THREE.MeshStandardMaterial({ color: 0x3a3a38, roughness: 1 });
  for (let i = 0; i < 7; i++) box(s, lines, 0.15, 0.001, 0.006, 0, 0.004, -0.1 + i * 0.03);
  p.castShadow = false;
  return g;
}

export function seeded(seed) { return mulberry32(seed); }
