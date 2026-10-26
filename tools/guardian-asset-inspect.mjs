import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import * as THREE from 'three';
import { FBXLoader } from '../vendor/fbx/loaders/FBXLoader.js';

// This fixture loads the real geometry and skin data. It deliberately does not
// pretend to decode texture pixels: the browser remains the texture QA gate.
export function installImageFixture({ delayMs = 0, fail = false } = {}) {
  globalThis.window ??= { URL: globalThis.URL };
  globalThis.ProgressEvent ??= class ProgressEvent {
    constructor(type, properties) { this.type = type; Object.assign(this, properties); }
  };
  globalThis.document = { createElementNS(_ns, name) {
    if (name !== 'img') throw new Error(`Unexpected fixture element: ${name}`);
    const listeners = new Map();
    return {
      width: 0, height: 0,
      addEventListener(type, fn) { listeners.set(type, fn); },
      removeEventListener(type) { listeners.delete(type); },
      set src(value) {
        this.url = value;
        const finish = () => listeners.get(fail ? 'error' : 'load')?.call(this, fail ? new Error('Deliberate texture fixture failure') : undefined);
        if (delayMs > 0) setTimeout(finish, delayMs);
        else queueMicrotask(finish);
      },
      get src() { return this.url; },
    };
  } };
}

export async function parseGuardianForInspection() {
  installImageFixture();
  const file = new URL('../assets/Character/Guardiao.fbx', import.meta.url);
  const bytes = await fs.readFile(file);
  const manager = new THREE.LoadingManager();
  const asset = new FBXLoader(manager).parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), fileURLToPath(new URL('../assets/Character/', import.meta.url)));
  await new Promise(resolve => setTimeout(resolve, 0));
  asset.updateMatrixWorld(true);
  return { asset, bytes, sha256: createHash('sha256').update(bytes).digest('hex') };
}

export function describeGuardian(asset) {
  const bounds = new THREE.Box3().setFromObject(asset, true);
  const meshes = [], bones = [], materials = [];
  asset.traverse(obj => {
    if (obj.isBone) bones.push({ name: obj.name, parent: obj.parent?.name, position: obj.position.toArray(), world: obj.getWorldPosition(new THREE.Vector3()).toArray(), quaternion: obj.quaternion.toArray() });
    if (!obj.isMesh) return;
    const g = obj.geometry;
    meshes.push({ name: obj.name, skinned: !!obj.isSkinnedMesh, position: obj.position.toArray(), rotation: obj.rotation.toArray(), scale: obj.scale.toArray(), vertices: g.getAttribute('position')?.count, triangles: (g.index?.count ?? g.getAttribute('position')?.count ?? 0) / 3, skeletonBones: obj.skeleton?.bones.map(b => b.name), skinIndex: g.getAttribute('skinIndex')?.count, skinWeight: g.getAttribute('skinWeight')?.count, bindMatrix: obj.bindMatrix?.toArray() });
    for (const mat of [].concat(obj.material)) materials.push({ name: mat.name, type: mat.type, color: mat.color?.getHexString(), opacity: mat.opacity, transparent: mat.transparent, side: mat.side, maps: Object.entries(mat).filter(([key, value]) => value?.isTexture).map(([key, tex]) => ({ key, name: tex.name, colorSpace: tex.colorSpace, imageURL: tex.image?.src ?? null })) });
  });
  return { bounds: { min: bounds.min.toArray(), max: bounds.max.toArray(), size: bounds.getSize(new THREE.Vector3()).toArray() }, root: { name: asset.name, position: asset.position.toArray(), rotation: asset.rotation.toArray(), scale: asset.scale.toArray() }, animations: asset.animations.map(c => ({ name: c.name, duration: c.duration, tracks: c.tracks.length })), meshes, materials, bones };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const { asset, bytes, sha256 } = await parseGuardianForInspection();
  console.log(JSON.stringify({ bytes: bytes.length, sha256, texturePixelsInspected: false, ...describeGuardian(asset) }, null, 2));
}
