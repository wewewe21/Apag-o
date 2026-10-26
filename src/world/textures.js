// Texturas procedurais (canvas): cor + mapa de normais a partir de um mapa de altura.
// Tudo "tileavel" para repetir nas paredes/pisos sem emendas visiveis.
import * as THREE from 'three';
import { mulberry32 } from '../core/rng.js';

// ---------- ruido ----------
function makeNoise(seed) {
  const rng = mulberry32(seed);
  const perm = new Uint8Array(512);
  const p = Array.from({ length: 256 }, (_, i) => i);
  for (let i = 255; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [p[i], p[j]] = [p[j], p[i]]; }
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
  const val = new Float32Array(256);
  for (let i = 0; i < 256; i++) val[i] = rng();
  return (x, y, px, py) => {
    const xi = Math.floor(x), yi = Math.floor(y);
    let xf = x - xi, yf = y - yi;
    const x0 = ((xi % px) + px) % px, y0 = ((yi % py) + py) % py;
    const x1 = (x0 + 1) % px, y1 = (y0 + 1) % py;
    const a = val[perm[(x0 & 255) + perm[y0 & 255]]];
    const b = val[perm[(x1 & 255) + perm[y0 & 255]]];
    const c = val[perm[(x0 & 255) + perm[y1 & 255]]];
    const d = val[perm[(x1 & 255) + perm[y1 & 255]]];
    xf = xf * xf * (3 - 2 * xf); yf = yf * yf * (3 - 2 * yf);
    return a + (b - a) * xf + (c - a) * yf + (a - b - c + d) * xf * yf;
  };
}

class Tex {
  constructor(size, seed, aspect = 1) {
    this.w = size; this.h = Math.round(size * aspect);
    this.c = document.createElement('canvas'); this.c.width = this.w; this.c.height = this.h;
    this.g = this.c.getContext('2d', { willReadFrequently: true });
    this.hgt = new Float32Array(this.w * this.h).fill(0.5);
    this.noise = makeNoise(seed);
    this.rng = mulberry32(seed * 7 + 3);
  }
  fbm(u, v, base, oct = 4, pers = 0.5) {
    let s = 0, a = 1, n = 0, p = base;
    for (let o = 0; o < oct; o++) { s += this.noise(u * p, v * p, p, p) * a; n += a; a *= pers; p *= 2; }
    return s / n;
  }
  fill(col) { this.g.fillStyle = col; this.g.fillRect(0, 0, this.w, this.h); }
  // altura: retangulo (x,y,w,h em px)
  hRect(x, y, w, h, val) {
    const x0 = Math.max(0, Math.floor(x)), y0 = Math.max(0, Math.floor(y));
    const x1 = Math.min(this.w, Math.ceil(x + w)), y1 = Math.min(this.h, Math.ceil(y + h));
    for (let j = y0; j < y1; j++) for (let i = x0; i < x1; i++) this.hgt[j * this.w + i] = val;
  }
  // percorre pixels: fn(u, v, i, j, rgba, idx) altera cor e altura
  pixels(fn) {
    const img = this.g.getImageData(0, 0, this.w, this.h);
    const d = img.data;
    const px = [0, 0, 0];
    for (let j = 0; j < this.h; j++) for (let i = 0; i < this.w; i++) {
      const k = (j * this.w + i);
      px[0] = d[k * 4]; px[1] = d[k * 4 + 1]; px[2] = d[k * 4 + 2];
      const r = fn(i / this.w, j / this.h, i, j, px, k);
      if (r !== false) { d[k * 4] = px[0]; d[k * 4 + 1] = px[1]; d[k * 4 + 2] = px[2]; d[k * 4 + 3] = 255; }
    }
    this.g.putImageData(img, 0, 0);
  }
  normal(strength = 2) {
    const w = this.w, h = this.h, H = this.hgt;
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const g = c.getContext('2d');
    const img = g.createImageData(w, h);
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
      const l = H[j * w + (i - 1 + w) % w], r = H[j * w + (i + 1) % w];
      const u = H[((j - 1 + h) % h) * w + i], dn = H[((j + 1) % h) * w + i];
      let nx = (l - r) * strength, ny = (dn - u) * strength, nz = 1;
      const len = Math.hypot(nx, ny, nz); nx /= len; ny /= len; nz /= len;
      const k = (j * w + i) * 4;
      img.data[k] = (nx * 0.5 + 0.5) * 255; img.data[k + 1] = (ny * 0.5 + 0.5) * 255;
      img.data[k + 2] = (nz * 0.5 + 0.5) * 255; img.data[k + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    return c;
  }
  // rugosidade opcional derivada de uma funcao
  finish(normalStrength = 2, opts = {}) {
    const map = new THREE.CanvasTexture(this.c);
    map.colorSpace = THREE.SRGBColorSpace;
    map.wrapS = map.wrapT = THREE.RepeatWrapping;
    const nm = new THREE.CanvasTexture(this.normal(normalStrength));
    nm.wrapS = nm.wrapT = THREE.RepeatWrapping;
    map.anisotropy = nm.anisotropy = opts.aniso ?? 4;
    return { map, normalMap: nm, canvas: this.c };
  }
}

// ---------- utilidades de cor ----------
const lerp = (a, b, t) => a + (b - a) * t;
const clamp01 = (x) => x < 0 ? 0 : x > 1 ? 1 : x;
function mix(px, col, t) { px[0] = lerp(px[0], col[0], t); px[1] = lerp(px[1], col[1], t); px[2] = lerp(px[2], col[2], t); }
function mul(px, f) { px[0] *= f; px[1] *= f; px[2] *= f; }
const hex = (h) => [(h >> 16) & 255, (h >> 8) & 255, h & 255];

// grade de azulejos: desenha cor/altura e retorna info
function tileGrid(t, x0, y0, x1, y1, tw, th, base, grout, jitter, rng) {
  const g = t.g;
  g.fillStyle = grout; g.fillRect(x0, y0, x1 - x0, y1 - y0);
  t.hRect(x0, y0, x1 - x0, y1 - y0, 0.2);
  const gw = Math.max(1, Math.round(tw * 0.07));
  for (let y = y0; y < y1; y += th) for (let x = x0; x < x1; x += tw) {
    const v = (rng() - 0.5) * jitter;
    const c = base.map(ch => Math.max(0, Math.min(255, ch + v * 255)));
    g.fillStyle = `rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})`;
    const w = Math.min(tw - gw, x1 - x - gw), h = Math.min(th - gw, y1 - y - gw);
    if (w <= 0 || h <= 0) continue;
    g.fillRect(x + gw / 2, y + gw / 2, w, h);
    t.hRect(x + gw / 2, y + gw / 2, w, h, 0.62 + rng() * 0.04);
    // azulejo quebrado/faltando
    if (rng() < 0.012) {
      g.fillStyle = 'rgb(70,66,58)'; g.fillRect(x + gw / 2, y + gw / 2, w, h);
      t.hRect(x + gw / 2, y + gw / 2, w, h, 0.05);
    } else if (rng() < 0.03) {
      g.strokeStyle = 'rgba(40,40,35,0.7)'; g.lineWidth = 1;
      g.beginPath(); g.moveTo(x + rng() * tw, y); g.lineTo(x + rng() * tw, y + th); g.stroke();
    }
  }
}

function crack(t, x, y, len, width, col, rng) {
  const g = t.g;
  g.strokeStyle = col; g.lineWidth = width;
  g.beginPath(); g.moveTo(x, y);
  let a = rng() * Math.PI * 2;
  for (let i = 0; i < len; i++) {
    a += (rng() - 0.5) * 0.9;
    x += Math.cos(a) * 4; y += Math.sin(a) * 4;
    g.lineTo(x, y);
    const k = (((y | 0) + t.h) % t.h) * t.w + (((x | 0) + t.w) % t.w);
    t.hgt[k] = 0.1;
    if (rng() < 0.05) crack(t, x, y, len * 0.4 | 0, width * 0.7, col, rng);
  }
  g.stroke();
}

// sujeira: escorrido vertical (agua da infiltracao), mofo, manchas
function grime(t, opts) {
  const { stainTop = 0.5, stainBottom = 0.6, mold = 0.3, drip = 0.5, warm = [95, 80, 50], moldCol = [40, 48, 30] } = opts;
  const dripCols = [];
  for (let i = 0; i < 18; i++) dripCols.push([t.rng(), 0.1 + t.rng() * 0.6 * drip, 0.004 + t.rng() * 0.02]);
  t.pixels((u, v, i, j, px, k) => {
    const n = t.fbm(u, v, 4, 5);
    const n2 = t.fbm(u + 0.37, v + 0.11, 12, 3);
    // escurece perto do chao e do teto
    const bot = Math.pow(clamp01((v - (1 - stainBottom * 0.35)) / (stainBottom * 0.35)), 1.5);
    const top = Math.pow(clamp01(1 - v / (stainTop * 0.3 + 1e-3)), 2);
    let d = 0;
    for (const [x, len, w] of dripCols) {
      const dx = Math.abs(((u - x + 1.5) % 1) - 0.5);
      const wob = w * (1 + 0.8 * t.noise(v * 20, x * 50, 20, 64));
      if (dx < wob && v < len) d = Math.max(d, (1 - dx / wob) * (1 - v / len));
    }
    const stain = clamp01(bot * (0.6 + n * 0.8) + top * (0.5 + n2) + d * 0.7);
    mix(px, warm, stain * 0.55);
    const m = clamp01((n2 - (1 - mold * 0.5)) * 5) * clamp01(bot + top + d);
    mix(px, moldCol, m * 0.8);
    mul(px, 0.82 + n * 0.3);
    t.hgt[k] += (n - 0.5) * 0.06;
  });
}

// tinta descascando (revela reboco)
function peel(t, amount, plaster = [150, 140, 122], vMin = 0, vMax = 1) {
  t.pixels((u, v, i, j, px, k) => {
    if (v < vMin || v > vMax) return false;
    const n = t.fbm(u + 3.1, v + 1.7, 6, 5, 0.55);
    const th = 1 - amount;
    if (n > th) {
      const edge = clamp01((n - th) * 30);
      mix(px, plaster.map(c => c * (0.8 + t.fbm(u, v, 30, 2) * 0.4)), edge);
      t.hgt[k] = 0.35;
      if (edge < 0.6) { mul(px, 0.7); t.hgt[k] = 0.75; }  // borda levantada da tinta
    }
  });
}

// ---------- paredes (u = 2.5 m, v = 3.2 m; v=0 no TOPO da imagem = teto) ----------
function wallWard(size, seed, tileCol = [168, 190, 170], paintCol = [196, 199, 184], band = 0.44, stripe = [52, 88, 70]) {
  const t = new Tex(size, seed);
  const bandY = t.h * (1 - band);
  t.fill(`rgb(${paintCol})`);
  const tw = t.w / (2.5 / 0.15), th = t.h / (3.2 / 0.15);
  tileGrid(t, 0, Math.round(bandY / th) * th, t.w, t.h, tw, th, tileCol, 'rgb(120,120,108)', 0.06, t.rng);
  // friso escuro
  const sy = Math.round(bandY / th) * th - th * 0.35;
  t.g.fillStyle = `rgb(${stripe})`; t.g.fillRect(0, sy, t.w, th * 0.35);
  t.hRect(0, sy, t.w, th * 0.35, 0.7);
  peel(t, 0.33, [150, 140, 122], 0, sy / t.h - 0.01);
  for (let i = 0; i < 5; i++) crack(t, t.rng() * t.w, t.rng() * sy, 20 + t.rng() * 40, 1, 'rgba(50,45,38,0.8)', t.rng);
  grime(t, { stainTop: 0.8, stainBottom: 0.9, mold: 0.5, drip: 0.8 });
  return t.finish(3);
}

function wallCell(size, seed) {
  const t = new Tex(size, seed);
  t.fill('rgb(186,178,150)');
  const bandY = t.h * 0.66;
  t.g.fillStyle = 'rgb(92,104,88)'; t.g.fillRect(0, bandY, t.w, t.h - bandY);
  t.hRect(0, bandY, t.w, t.h - bandY, 0.55);
  peel(t, 0.3, [140, 128, 108]);
  // arranhoes e marcas de contagem
  const g = t.g;
  g.strokeStyle = 'rgba(60,50,40,0.55)'; g.lineWidth = 1;
  for (let i = 0; i < 40; i++) {
    const x = t.rng() * t.w, y = t.h * (0.35 + t.rng() * 0.55);
    g.beginPath(); g.moveTo(x, y); g.lineTo(x + (t.rng() - 0.5) * 8, y + 10 + t.rng() * 30); g.stroke();
  }
  for (let grp = 0; grp < 3; grp++) {
    const x0 = t.rng() * t.w * 0.8, y0 = t.h * (0.45 + t.rng() * 0.2);
    for (let i = 0; i < 5; i++) {
      g.beginPath(); g.moveTo(x0 + i * 6, y0); g.lineTo(x0 + i * 6 + 1, y0 + 22); g.stroke();
    }
    g.beginPath(); g.moveTo(x0 - 3, y0 + 16); g.lineTo(x0 + 30, y0 + 5); g.stroke();
  }
  // maos sujas
  for (let i = 0; i < 3; i++) handprint(t, t.rng() * t.w, t.h * (0.4 + t.rng() * 0.3), 'rgba(55,35,28,0.35)');
  grime(t, { stainTop: 0.7, stainBottom: 1, mold: 0.4, drip: 0.9 });
  return t.finish(3);
}

function handprint(t, x, y, col) {
  const g = t.g; g.fillStyle = col;
  const s = t.w / 2.5 * 0.09;
  g.beginPath(); g.ellipse(x, y, s * 0.5, s * 0.6, 0, 0, Math.PI * 2); g.fill();
  for (let f = 0; f < 5; f++) {
    const a = -Math.PI / 2 + (f - 2) * 0.35;
    g.beginPath(); g.ellipse(x + Math.cos(a) * s * 0.9, y + Math.sin(a) * s * 0.9 - 2, s * 0.12, s * 0.4, a + Math.PI / 2, 0, Math.PI * 2); g.fill();
    // escorre
    g.fillRect(x + (f - 2) * s * 0.25, y, 1.5, s * (0.6 + t.rng() * 1.5));
  }
}

function wallMorgue(size, seed) {
  const t = new Tex(size, seed);
  const tw = t.w / (2.5 / 0.2), th = t.h / (3.2 / 0.2);
  tileGrid(t, 0, 0, t.w, t.h, tw, th, [206, 210, 204], 'rgb(128,130,124)', 0.05, t.rng);
  grime(t, { stainTop: 0.6, stainBottom: 1, mold: 0.2, drip: 1, warm: [110, 90, 55] });
  // ferrugem escorrendo de parafusos
  for (let i = 0; i < 6; i++) {
    const x = t.rng() * t.w, y = t.rng() * t.h * 0.5;
    const grd = t.g.createLinearGradient(x, y, x, y + 120);
    grd.addColorStop(0, 'rgba(110,55,25,0.6)'); grd.addColorStop(1, 'rgba(110,55,25,0)');
    t.g.fillStyle = grd; t.g.fillRect(x - 2, y, 4 + t.rng() * 3, 120);
  }
  return t.finish(2.5);
}

function wallOffice(size, seed) {
  const t = new Tex(size, seed);
  // papel de parede listrado desbotado
  t.pixels((u, v, i, j, px) => {
    const s = Math.sin(u * Math.PI * 2 * 14) > 0.6 ? 1 : 0;
    const base = s ? [150, 132, 104] : [168, 152, 120];
    px[0] = base[0]; px[1] = base[1]; px[2] = base[2];
    const d = Math.sin(u * Math.PI * 2 * 7) * Math.sin(v * Math.PI * 2 * 9);
    if (d > 0.7) mul(px, 0.9);
  });
  // lambri de madeira
  const bandY = t.h * 0.7;
  const pw = t.w / 5;
  for (let i = 0; i < 5; i++) {
    t.pixels((u, v, ii, j, px, k) => {
      if (j < bandY || ii < i * pw || ii >= (i + 1) * pw) return false;
      const grain = t.fbm(u * 0.3 + i, v * 6, 8, 4);
      px[0] = 92 + grain * 50; px[1] = 60 + grain * 30; px[2] = 36 + grain * 18;
      const e = Math.min(ii - i * pw, (i + 1) * pw - ii, j - bandY, t.h - j);
      t.hgt[k] = e < 4 ? 0.35 : e < 8 ? 0.7 : 0.6;
    });
  }
  t.g.fillStyle = 'rgb(58,38,24)'; t.g.fillRect(0, bandY - 6, t.w, 6); t.hRect(0, bandY - 6, t.w, 6, 0.85);
  peel(t, 0.25, [170, 160, 140], 0, 0.68);
  grime(t, { stainTop: 0.8, stainBottom: 0.5, mold: 0.3, drip: 0.6 });
  return t.finish(2.5);
}

function wallConcrete(size, seed, tint = [128, 126, 118]) {
  const t = new Tex(size, seed);
  t.pixels((u, v, i, j, px, k) => {
    const n = t.fbm(u, v, 6, 6, 0.55);
    const board = Math.floor(v * 8);
    const bj = (v * 8) % 1;
    const bv = 0.94 + (((board * 73) % 7) / 7) * 0.08;
    const pores = t.noise(u * 180, v * 180, 180, 180) > 0.9 ? 0.6 : 1;
    const c = tint.map(ch => ch * (0.72 + n * 0.5) * bv * pores);
    px[0] = c[0]; px[1] = c[1]; px[2] = c[2];
    t.hgt[k] = 0.5 + (n - 0.5) * 0.3 + (bj < 0.02 ? -0.2 : 0) + (pores < 1 ? -0.3 : 0);
  });
  for (let i = 0; i < 4; i++) crack(t, t.rng() * t.w, t.rng() * t.h, 30 + t.rng() * 50, 1.2, 'rgba(40,38,34,0.9)', t.rng);
  grime(t, { stainTop: 0.9, stainBottom: 1, mold: 0.6, drip: 1, warm: [70, 64, 50], moldCol: [30, 40, 26] });
  return t.finish(2.5);
}

function wallBrick(size, seed, col = [128, 64, 44]) {
  const t = new Tex(size, seed);
  const bw = t.w / (2.5 / 0.24), bh = t.h / (3.2 / 0.075);
  t.fill('rgb(70,64,56)');
  t.hgt.fill(0.25);
  for (let r = 0, y = 0; y < t.h; r++, y += bh) {
    const off = (r % 2) * bw / 2;
    for (let x = -off; x < t.w; x += bw) {
      const v = 0.75 + t.rng() * 0.4;
      t.g.fillStyle = `rgb(${col[0] * v | 0},${col[1] * v | 0},${col[2] * v | 0})`;
      t.g.fillRect(x + 1.5, y + 1.5, bw - 3, bh - 3);
      t.hRect(x + 1.5, y + 1.5, bw - 3, bh - 3, 0.62);
    }
  }
  t.pixels((u, v, i, j, px, k) => { const n = t.fbm(u, v, 10, 4); mul(px, 0.75 + n * 0.45); t.hgt[k] += (n - 0.5) * 0.1; });
  grime(t, { stainTop: 1, stainBottom: 1, mold: 0.5, drip: 0.8, warm: [30, 26, 22] });
  return t.finish(3);
}

// ---------- pisos (2.5 x 2.5 m por repeticao) ----------
function floorChecker(size, seed) {
  const t = new Tex(size, seed);
  const n = 8, s = t.w / n;
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const dark = (x + y) % 2 === 0;
    const v = 0.9 + t.rng() * 0.15;
    t.g.fillStyle = dark ? `rgb(${34 * v | 0},${36 * v | 0},${34 * v | 0})` : `rgb(${196 * v | 0},${188 * v | 0},${162 * v | 0})`;
    t.g.fillRect(x * s, y * s, s, s);
    t.hRect(x * s + 1, y * s + 1, s - 2, s - 2, 0.6);
  }
  wear(t, 0.5);
  return t.finish(1.5);
}

function wear(t, amount, dirt = [72, 62, 44]) {
  t.pixels((u, v, i, j, px, k) => {
    const n = t.fbm(u, v, 3, 5);
    const sc = t.fbm(u * 4 + 1, v * 0.5, 16, 3);
    const d = clamp01((n - 0.45) * 2.2) * amount;
    mix(px, dirt, d * 0.6);
    if (sc > 0.72) mul(px, 0.85);                 // riscos de maca arrastada
    mul(px, 0.85 + t.fbm(u, v, 32, 2) * 0.25);
    t.hgt[k] += (n - 0.5) * 0.05;
  });
}

function floorLino(size, seed, base = [118, 128, 112]) {
  const t = new Tex(size, seed);
  t.pixels((u, v, i, j, px, k) => {
    const n = t.fbm(u, v, 8, 3);
    const speck = t.noise(u * 256, v * 256, 256, 256);
    const c = speck > 0.82 ? [200, 196, 180] : speck < 0.12 ? [40, 44, 40] : base;
    px[0] = c[0] * (0.85 + n * 0.3); px[1] = c[1] * (0.85 + n * 0.3); px[2] = c[2] * (0.85 + n * 0.3);
    // emendas das mantas
    if (i % (t.w / 2) < 2) { mul(px, 0.6); t.hgt[k] = 0.3; }
  });
  wear(t, 0.8);
  return t.finish(1.2);
}

function floorTerrazzo(size, seed) {
  const t = new Tex(size, seed);
  t.fill('rgb(170,166,156)');
  for (let i = 0; i < 2200; i++) {
    const r = 1 + t.rng() * 3.5, v = t.rng();
    t.g.fillStyle = v < 0.3 ? 'rgb(60,62,60)' : v < 0.6 ? 'rgb(214,208,196)' : v < 0.8 ? 'rgb(120,96,78)' : 'rgb(140,150,140)';
    t.g.beginPath(); t.g.arc(t.rng() * t.w, t.rng() * t.h, r, 0, Math.PI * 2); t.g.fill();
  }
  // juntas de dilatacao em metal
  t.g.fillStyle = 'rgb(110,100,80)';
  t.g.fillRect(0, 0, t.w, 2); t.g.fillRect(0, 0, 2, t.h);
  t.hRect(0, 0, t.w, 2, 0.8); t.hRect(0, 0, 2, t.h, 0.8);
  wear(t, 0.6);
  return t.finish(1.2);
}

function floorMorgue(size, seed) {
  const t = new Tex(size, seed);
  const s = t.w / (2.5 / 0.2);
  tileGrid(t, 0, 0, t.w, t.h, s, s, [178, 180, 176], 'rgb(90,92,88)', 0.08, t.rng);
  wear(t, 0.7, [80, 70, 55]);
  // manchas escuras (fluido antigo) perto de ralos
  t.pixels((u, v, i, j, px) => {
    const n = t.fbm(u + 5, v + 2, 3, 5);
    if (n > 0.62) mix(px, [60, 34, 26], clamp01((n - 0.62) * 6) * 0.6);
  });
  return t.finish(2);
}

function floorConcrete(size, seed) {
  const t = new Tex(size, seed);
  t.pixels((u, v, i, j, px, k) => {
    const n = t.fbm(u, v, 5, 6, 0.55);
    const c = 95 + n * 60;
    px[0] = c; px[1] = c * 0.98; px[2] = c * 0.93;
    t.hgt[k] = 0.5 + (n - 0.5) * 0.25;
    // poca (mais escuro)
    const p = t.fbm(u + 9, v + 4, 2, 3);
    if (p > 0.6) mul(px, 0.7);
  });
  for (let i = 0; i < 6; i++) crack(t, t.rng() * t.w, t.rng() * t.h, 40 + t.rng() * 60, 1.4, 'rgba(30,28,26,0.9)', t.rng);
  wear(t, 0.5, [50, 45, 35]);
  return t.finish(2.5);
}

function floorWood(size, seed) {
  const t = new Tex(size, seed);
  const pw = t.w / 12;
  t.pixels((u, v, i, j, px, k) => {
    const plank = Math.floor(i / pw);
    const off = ((plank * 37) % 11) / 11;
    const len = ((v + off) * 3) % 1;
    const grain = t.fbm(u * 0.2 + plank * 0.13, v * 3 + off, 10, 4);
    const tone = 0.75 + ((plank * 53) % 9) / 9 * 0.3;
    px[0] = (86 + grain * 60) * tone; px[1] = (56 + grain * 36) * tone; px[2] = (34 + grain * 20) * tone;
    const edge = (i % pw < 1.5) || len < 0.006;
    t.hgt[k] = edge ? 0.2 : 0.55 + grain * 0.1;
    if (edge) mul(px, 0.45);
  });
  wear(t, 0.7);
  return t.finish(2);
}

function floorBrick(size, seed) {
  const t = new Tex(size, seed), bw = t.w / 10, bh = t.h / 20;
  t.fill('rgb(64,59,51)'); t.hgt.fill(0.28);
  for (let r = 0, y = 0; y < t.h; r++, y += bh) {
    for (let x = -(r % 2) * bw / 2; x < t.w; x += bw) {
      const v = 0.8 + t.rng() * 0.3;
      t.g.fillStyle = `rgb(${104 * v | 0},${66 * v | 0},${48 * v | 0})`;
      t.g.fillRect(x + 1, y + 1, bw - 2, bh - 2);
      t.hRect(x + 1, y + 1, bw - 2, bh - 2, 0.54);
    }
  }
  wear(t, 0.65, [48, 42, 33]);
  return t.finish(2);
}

function floorAsphalt(size, seed) {
  const t = new Tex(size, seed);
  t.pixels((u, v, i, j, px, k) => {
    const n = t.fbm(u, v, 8, 5);
    const g = t.noise(u * 300, v * 300, 300, 300);
    const c = 30 + n * 30 + (g > 0.8 ? 30 : 0);
    px[0] = c; px[1] = c; px[2] = c * 1.05;
    t.hgt[k] = 0.5 + (g - 0.5) * 0.3;
  });
  return t.finish(2);
}

// ---------- tetos ----------
function ceilTiles(size, seed) {
  const t = new Tex(size, seed);
  const s = t.w / (2.5 / 0.625);
  t.fill('rgb(90,88,80)');
  for (let y = 0; y < t.h; y += s) for (let x = 0; x < t.w; x += s) {
    const missing = t.rng() < 0.07;
    t.g.fillStyle = missing ? 'rgb(12,12,12)' : `rgb(${176 + t.rng() * 14 | 0},${172 + t.rng() * 12 | 0},${156 | 0})`;
    t.g.fillRect(x + 2, y + 2, s - 4, s - 4);
    t.hRect(x + 2, y + 2, s - 4, s - 4, missing ? 0 : 0.6);
  }
  t.pixels((u, v, i, j, px, k) => {
    const pin = t.noise(u * 200, v * 200, 200, 200) > 0.75 ? 0.85 : 1;
    mul(px, pin);
    const n = t.fbm(u, v, 3, 5);
    if (n > 0.55) mix(px, [120, 92, 50], clamp01((n - 0.55) * 4) * 0.7);   // infiltracao
  });
  return t.finish(1.5);
}

function ceilPlaster(size, seed) {
  const t = new Tex(size, seed);
  t.fill('rgb(170,166,150)');
  peel(t, 0.35, [120, 110, 95]);
  for (let i = 0; i < 6; i++) crack(t, t.rng() * t.w, t.rng() * t.h, 30 + t.rng() * 40, 1, 'rgba(50,45,38,0.8)', t.rng);
  grime(t, { stainTop: 0.2, stainBottom: 0.2, mold: 0.6, drip: 0 });
  return t.finish(2);
}

// ---------- materiais de objetos ----------
function metalPainted(size, seed, paint = [70, 96, 78], chip = 0.3) {
  const t = new Tex(size, seed);
  t.fill(`rgb(${paint})`);
  t.pixels((u, v, i, j, px, k) => {
    const n = t.fbm(u, v, 6, 5);
    const c = t.fbm(u + 2, v + 7, 10, 4);
    mul(px, 0.85 + n * 0.25);
    if (c > 1 - chip * 0.6) {
      const rust = [96 + n * 40, 52 + n * 20, 30];
      mix(px, rust, clamp01((c - (1 - chip * 0.6)) * 10));
      t.hgt[k] = 0.35;
    }
    // escorrido
    const drip = t.noise(u * 40, v * 3, 40, 3);
    if (drip > 0.8) mix(px, [60, 40, 25], (drip - 0.8) * 2);
  });
  return t.finish(2);
}

function metalSteel(size, seed) {
  const t = new Tex(size, seed);
  t.pixels((u, v, i, j, px, k) => {
    const brushed = t.noise(u * 4, v * 400, 4, 400);
    const n = t.fbm(u, v, 4, 4);
    const c = 130 + brushed * 40 + n * 30;
    px[0] = c; px[1] = c * 1.01; px[2] = c * 1.03;
    const stain = t.fbm(u + 3, v, 3, 5);
    if (stain > 0.6) mix(px, [90, 70, 50], clamp01((stain - 0.6) * 3) * 0.6);
    t.hgt[k] = 0.5 + brushed * 0.04;
  });
  return t.finish(0.6);
}

function woodDesk(size, seed) {
  const t = new Tex(size, seed);
  t.pixels((u, v, i, j, px, k) => {
    const grain = t.fbm(u * 0.25, v * 4, 12, 5);
    const ring = Math.sin((u + grain * 0.3) * 60) * 0.5 + 0.5;
    px[0] = 84 + grain * 50 + ring * 12; px[1] = 52 + grain * 30 + ring * 6; px[2] = 30 + grain * 14;
    t.hgt[k] = 0.5 + ring * 0.05;
  });
  wear(t, 0.4);
  return t.finish(1);
}

function fabric(size, seed, base = [196, 190, 168], stains = 0.5) {
  const t = new Tex(size, seed);
  t.pixels((u, v, i, j, px, k) => {
    const weave = ((i % 4 < 2) ^ (j % 4 < 2)) ? 1.03 : 0.97;
    const n = t.fbm(u, v, 5, 5);
    px[0] = base[0] * weave * (0.85 + n * 0.25); px[1] = base[1] * weave * (0.85 + n * 0.25); px[2] = base[2] * weave * (0.85 + n * 0.25);
    const s = t.fbm(u + 11, v + 5, 3, 5);
    if (s > 1 - stains * 0.5) mix(px, [120, 92, 50], clamp01((s - (1 - stains * 0.5)) * 5) * 0.8);
    const b = t.fbm(u + 1, v + 19, 4, 4);
    if (b > 0.74 && stains > 0.4) mix(px, [70, 20, 16], clamp01((b - 0.74) * 8) * 0.8);  // sangue velho
    t.hgt[k] = 0.5 + (weave - 1) * 2 + n * 0.1;
  });
  return t.finish(1);
}

function plasticBag(size, seed) {
  const t = new Tex(size, seed);
  t.pixels((u, v, i, j, px, k) => {
    const n = t.fbm(u, v, 3, 5);
    const c = 18 + n * 26;
    px[0] = c; px[1] = c; px[2] = c * 1.1;
    t.hgt[k] = n;
  });
  return t.finish(4);
}

// Pele da criatura: cinza-azulada de cadaver, livor roxo, veias escuras, cicatriz em Y
function skin(size, seed) {
  const t = new Tex(size, seed);
  t.pixels((u, v, i, j, px, k) => {
    const n = t.fbm(u, v, 4, 5);
    const n2 = t.fbm(u + 3, v + 1, 9, 4);
    let c = [196, 198, 186];
    mix(px, c, 1);
    mul(px, 0.8 + n * 0.3);
    // tom esverdeado de decomposicao
    const gr = clamp01((t.fbm(u + 1, v + 9, 2, 4) - 0.45) * 3);
    mix(px, [150, 160, 128], gr * 0.45);
    // livor (manchas roxas)
    const liv = clamp01((t.fbm(u + 7, v + 2, 3, 4) - 0.5) * 4);
    mix(px, [110, 72, 104], liv * 0.6);
    // veias
    const vein = Math.abs(t.fbm(u * 1.0 + 5, v * 1.0, 7, 4) - 0.5);
    if (vein < 0.022) { mix(px, [58, 62, 96], (1 - vein / 0.022) * 0.75); t.hgt[k] = 0.62; }
    else t.hgt[k] = 0.5 + (n2 - 0.5) * 0.25;
    // sujeira escura / necrose
    if (n2 > 0.7) mix(px, [40, 36, 30], clamp01((n2 - 0.7) * 4) * 0.6);
  });
  return t.finish(3);
}

// ---------- texturas com texto ----------
export function textTexture(lines, opts = {}) {
  const { w = 512, h = 256, bg = null, color = '#222', font = '600 64px "Saira Stencil One", Impact, sans-serif', align = 'center', rot = 0, rough = 0 } = opts;
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d');
  if (bg) { g.fillStyle = bg; g.fillRect(0, 0, w, h); }
  g.fillStyle = color; g.font = font; g.textAlign = align; g.textBaseline = 'middle';
  g.translate(w / 2, h / 2); g.rotate(rot);
  const lh = h / (lines.length + 0.5);
  lines.forEach((l, i) => g.fillText(l, align === 'center' ? 0 : -w / 2 + 20, (i - (lines.length - 1) / 2) * lh));
  g.setTransform(1, 0, 0, 1, 0, 0);
  if (rough) {
    // tinta falhada
    const img = g.getImageData(0, 0, w, h);
    const nz = makeNoise(7);
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
      const k = (j * w + i) * 4 + 3;
      const n = nz(i / 9, j / 9, 4096, 4096);
      img.data[k] = img.data[k] * clamp01((n - rough * 0.5) * 3);
    }
    g.putImageData(img, 0, 0);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// manchas (sangue/sujeira) com alpha
export function splatTexture(seed, col = [70, 12, 10], kind = 'blood') {
  const size = 256;
  const t = new Tex(size, seed);
  const img = t.g.createImageData(size, size);
  for (let j = 0; j < size; j++) for (let i = 0; i < size; i++) {
    const u = i / size - 0.5, v = j / size - 0.5;
    const r = Math.hypot(u, v);
    const n = t.fbm(i / size, j / size, 5, 5);
    let a = clamp01((0.36 - r + (n - 0.5) * 0.3) * 8);
    if (kind === 'drag') a = clamp01((0.12 - Math.abs(u + (n - 0.5) * 0.15)) * 10) * clamp01((0.5 - Math.abs(v)) * 4) * (0.5 + n * 0.8);
    const k = (j * size + i) * 4;
    img.data[k] = col[0] * (0.7 + n * 0.5); img.data[k + 1] = col[1] * (0.7 + n * 0.5); img.data[k + 2] = col[2] * (0.7 + n * 0.5);
    img.data[k + 3] = a * 235;
  }
  t.g.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(t.c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// "cookie" da lanterna: aneis, centro quente, borda suja
export function flashlightCookie() {
  const s = 256;
  const c = document.createElement('canvas'); c.width = c.height = s;
  const g = c.getContext('2d');
  const img = g.createImageData(s, s);
  const nz = makeNoise(99);
  for (let j = 0; j < s; j++) for (let i = 0; i < s; i++) {
    const u = (i / s - 0.5) * 2, v = (j / s - 0.5) * 2;
    const r = Math.hypot(u, v);
    let b = clamp01(1 - r) ** 0.7;
    b *= 0.95 + 0.05 * Math.cos(r * 31);        // aneis sutis do refletor
    b += clamp01(1 - r * 2.6) * 0.35;           // hotspot
    b *= 0.93 + nz(i / 12, j / 12, 64, 64) * 0.14; // sujeira na lente
    const k = (j * s + i) * 4;
    const v8 = clamp01(b) * 255;
    img.data[k] = v8; img.data[k + 1] = v8 * 0.97; img.data[k + 2] = v8 * 0.9; img.data[k + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// ---------- catalogo ----------
export function buildTextures(size = 512) {
  const T = {};
  const s = size, h = Math.max(128, size / 2);
  T.wall = {
    ward: wallWard(s, 11),
    clinic: wallWard(s, 23, [210, 214, 208], [178, 190, 196], 0.38, [70, 90, 110]),
    cell: wallCell(s, 31),
    morgue: wallMorgue(s, 41),
    office: wallOffice(s, 53),
    concrete: wallConcrete(s, 61),
    brick: wallBrick(s, 71),
    facade: wallBrick(s, 79, [96, 84, 72]),
  };
  T.floor = {
    checker: floorChecker(s, 101),
    lino: floorLino(s, 111),
    terrazzo: floorTerrazzo(s, 121),
    morgue: floorMorgue(s, 131),
    concrete: floorConcrete(s, 141),
    wood: floorWood(s, 151),
    asphalt: floorAsphalt(h, 161),
    brick: floorBrick(s, 171),
  };
  T.ceil = {
    tiles: ceilTiles(s, 201),
    plaster: ceilPlaster(h, 211),
    concrete: wallConcrete(h, 221, [104, 102, 96]),
  };
  T.mat = {
    locker: metalPainted(h, 301, [72, 98, 84], 0.35),
    cabinet: metalPainted(h, 307, [168, 170, 160], 0.25),
    rust: metalPainted(h, 311, [96, 62, 40], 0.9),
    steel: metalSteel(h, 321),
    wood: woodDesk(h, 331),
    mattress: fabric(h, 341, [186, 178, 150], 0.7),
    sheet: fabric(h, 347, [206, 204, 194], 0.35),
    curtain: fabric(h, 351, [150, 176, 168], 0.4),
    bag: plasticBag(h, 361),
    skin: skin(s, 371),
    strap: fabric(h, 381, [70, 66, 58], 0.2),
  };
  return T;
}

export { hex };
