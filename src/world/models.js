// Biblioteca de modelos 3D OPCIONAIS (assets/models/*.glb, gerados com o Tripo; ver docs/ASSETS3D.md).
// Sem a pasta (ou sem o manifesto) o jogo roda exatamente como antes, com os props feitos de primitivas: nada aqui e obrigatorio.
// Convencao do jogo para qualquer prop: origem no centro da BASE, frente em +Z, tamanho real em metros.
// Os GLB gerados chegam com escala, origem e frente arbitrarias: prepareModel() normaliza tudo a partir da caixa do modelo
// (spec.size = tamanho alvo, spec.yaw = giro em graus para a frente ficar em +Z) e acerta o material para combinar com o resto do jogo.
import * as THREE from 'three';
import { GLTFLoader } from '../../vendor/gltf/loaders/GLTFLoader.js';

export const MODELS_MANIFEST = 'assets/models/manifest.json';

// gradacao padrao das texturas: o Tripo gera cores "bonitas"; o jogo e dessaturado, frio e sujo
const GRADE = { sat: 0.7, gain: 0.88, contrast: 1.06, tint: [0.95, 1.0, 0.97] };

const _v = new THREE.Vector3(), _c = new THREE.Vector3(), _box = new THREE.Box3();

// Normaliza um modelo carregado (THREE.Object3D) para o padrao do jogo. Puro e testavel em Node (so usa THREE).
// Devolve { pivot, dims } onde pivot e um Group com origem no centro da base, frente +Z e o tamanho de spec.size.
export function prepareModel(root, spec = {}) {
  const pivot = new THREE.Group();
  pivot.name = root.name || 'model3d';
  const model = root;
  pivot.add(model);
  if (spec.yaw) model.rotateY(THREE.MathUtils.degToRad(spec.yaw));
  pivot.updateMatrixWorld(true);
  _box.setFromObject(pivot, true);
  if (_box.isEmpty()) throw new Error('modelo sem geometria');
  const size = _box.getSize(_v);
  const t = spec.size;
  if (t) {
    // 'contain' (padrao): maior escala uniforme que cabe em w x h x d; 'height': so a altura manda; 'exact': cada eixo no seu tamanho
    const fit = spec.fit || 'contain';
    const fx = t.w / size.x, fy = t.h / size.y, fz = t.d / size.z;
    if (fit === 'exact') model.scale.multiply(new THREE.Vector3(fx, fy, fz));
    else model.scale.multiplyScalar(fit === 'height' ? fy : Math.min(fx, fy, fz));
  }
  pivot.updateMatrixWorld(true);
  _box.setFromObject(pivot, true);
  _box.getCenter(_c);
  model.position.x -= _c.x; model.position.z -= _c.z; model.position.y -= _box.min.y;     // origem no centro da base
  pivot.updateMatrixWorld(true);
  _box.setFromObject(pivot, true);
  const dims = _box.getSize(new THREE.Vector3());
  gradeMaterials(pivot, spec.material || {});
  pivot.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  return { pivot, dims: { w: dims.x, h: dims.y, d: dims.z } };
}

function parseTint(t) {
  if (t == null) return new THREE.Color(1, 1, 1);
  return new THREE.Color(typeof t === 'string' ? parseInt(t, 16) : t);
}

// Material do jogo = MeshStandardMaterial sem brilho de plastico: rugosidade/metal por tipo de objeto e cor levemente fria e escura.
function gradeMaterials(object, mat) {
  const done = new Set();
  const tint = parseTint(mat.tint);
  object.traverse(o => {
    if (!o.isMesh) return;
    for (const m of [].concat(o.material)) {
      if (done.has(m)) continue;
      done.add(m);
      if (!m.isMeshStandardMaterial && !m.isMeshPhysicalMaterial) continue;
      m.color.multiply(tint);
      if (!m.roughnessMap) m.roughness = mat.rough ?? 0.8; else m.roughness = Math.min(1, m.roughness * (mat.roughMul ?? 1));
      if (!m.metalnessMap) m.metalness = mat.metal ?? 0.1;
      m.side = mat.doubleSided ? THREE.DoubleSide : THREE.FrontSide;
      m.transparent = false; m.opacity = 1;
      if (m.map) { m.map = gradeTexture(m.map, mat.grade); m.map.anisotropy = 4; }
      m.needsUpdate = true;
    }
  });
}

// Dessatura, escurece e esfria a textura de cor (so no navegador; em Node devolve a mesma textura).
export function gradeTexture(tex, grade = {}) {
  const g = { ...GRADE, ...grade };
  const img = tex.image;
  if (typeof document === 'undefined' || !img || !(img.width > 0)) return tex;
  try {
    const cv = document.createElement('canvas');
    cv.width = img.width; cv.height = img.height;
    const ctx = cv.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0);
    const data = ctx.getImageData(0, 0, cv.width, cv.height), d = data.data;
    for (let i = 0; i < d.length; i += 4) {
      const l = d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114;
      for (let k = 0; k < 3; k++) {
        let v = l + (d[i + k] - l) * g.sat;            // dessatura
        v = (v - 128) * g.contrast + 128;                // contraste leve
        d[i + k] = Math.max(0, Math.min(255, v * g.gain * g.tint[k]));
      }
    }
    ctx.putImageData(data, 0, 0);
    const out = new THREE.CanvasTexture(cv);
    out.flipY = tex.flipY; out.colorSpace = tex.colorSpace; out.wrapS = tex.wrapS; out.wrapT = tex.wrapT; out.channel = tex.channel;
    out.generateMipmaps = true; out.minFilter = THREE.LinearMipmapLinearFilter; out.magFilter = THREE.LinearFilter;
    tex.dispose?.();
    return out;
  } catch { return tex; }
}

export class ModelLibrary {
  constructor() { this.byKind = new Map(); this.templates = new Map(); }
  get size() { return this.templates.size; }
  add(id, prepared, spec = {}) {
    this.templates.set(id, { ...prepared, spec });
    for (const k of spec.replaces || []) if (!this.byKind.has(k)) this.byKind.set(k, id);
  }
  has(kind) { return this.byKind.has(kind); }
  // Copia nova (geometria e materiais compartilhados: varias camas custam so os draw calls). fit {w,d} = pegada maxima: o modelo
  // nunca passa da caixa de colisao do prop (reduz se precisar, nunca amplia). spec.grow (>1, opcional) deixa passar um pouco da pegada:
  // so para um modelo cuja altura precisa casar com a superficie do prop (itens ficam em cima dele) e que nao cabe na pegada sem ficar baixo.
  instance(kind, fit = null) {
    const id = this.byKind.get(kind);
    const t = id && this.templates.get(id);
    if (!t) return null;
    const g = t.pivot.clone(true);
    if (fit) {
      const grow = Math.max(1, t.spec?.grow || 1);
      const s = Math.min(1, fit.w ? fit.w * grow / t.dims.w : 1, fit.d ? fit.d * grow / t.dims.d : 1);
      if (s < 1) g.scale.multiplyScalar(s);
    }
    g.userData.model3d = id;
    return g;
  }
}

// Carrega o manifesto e os GLB. Devolve null (e o jogo segue com os props procedurais) se nao houver manifesto ou nenhum modelo.
export async function loadModelLibrary(manifestUrl = MODELS_MANIFEST) {
  let manifest;
  try {
    const res = await fetch(manifestUrl, { cache: 'no-cache' });
    if (!res.ok) return null;
    manifest = await res.json();
  } catch { return null; }
  const entries = Object.entries(manifest?.models || {});
  if (!entries.length) return null;
  const base = new URL(manifestUrl, globalThis.location?.href || 'http://localhost/');
  const loader = new GLTFLoader();
  const lib = new ModelLibrary();
  await Promise.all(entries.map(async ([id, m]) => {
    try {
      const gltf = await loader.loadAsync(new URL(m.file, base).href);
      lib.add(id, prepareModel(gltf.scene, m.spec || {}), m.spec || {});
    } catch (e) { console.warn(`modelo 3D "${id}" ignorado (${e.message}): o jogo usa o prop procedural`); }
  }));
  return lib.size ? lib : null;
}
