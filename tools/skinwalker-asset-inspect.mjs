import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import * as THREE from 'three';
import { FBXLoader } from '../vendor/fbx/loaders/FBXLoader.js';
import { installImageFixture, describeGuardian } from './guardian-asset-inspect.mjs';

// Geometry, weights and rig are real. Node's image fixture never claims pixels.
export async function parseSkinwalkerForInspection() {
  installImageFixture();
  const file = new URL('../assets/Character/monstrorigado.fbx', import.meta.url);
  const bytes = await fs.readFile(file);
  const asset = new FBXLoader(new THREE.LoadingManager()).parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), fileURLToPath(new URL('../assets/Character/', import.meta.url)));
  await new Promise(resolve => setTimeout(resolve, 0));
  asset.updateMatrixWorld(true);
  return { asset, bytes, sha256: createHash('sha256').update(bytes).digest('hex') };
}

export function measureSkinwalker(asset, height = 3) {
  const description = describeGuardian(asset), bones = new Map();
  for (const b of description.bones) bones.set(b.name.replace(/^.*mixamorig[:_]?/i, '').replace(/[:_]/g, ''), new THREE.Vector3().fromArray(b.world));
  const scale = height / description.bounds.size[1];
  const length = (a, b) => bones.has(a) && bones.has(b) ? bones.get(a).distanceTo(bones.get(b)) * scale : null;
  return { height, sourceHeight: description.bounds.size[1], scale, bones: bones.size,
    meshes: description.meshes.map(m => ({ name: m.name, vertices: m.vertices, skinned: m.skinned, skeletonBones: m.skeletonBones?.length })),
    textures: description.materials.flatMap(m => m.maps.map(t => ({ material: m.name, slot: t.key, name: t.name }))),
    neck: length('Neck', 'Head'), legs: ['Left','Right'].map(s => ({ side: s, upper: length(s+'UpLeg',s+'Leg'), lower: length(s+'Leg',s+'Foot') })),
    arms: ['Left','Right'].map(s => ({ side: s, upper: length(s+'Arm',s+'ForeArm'), lower: length(s+'ForeArm',s+'Hand'), digits: ['Thumb','Index','Middle','Ring','Pinky'].map(d => ({ digit: d, length: length(s+'Hand'+d+'1',s+'Hand'+d+'4') })) })),
    axes: 'Y-up; Mixamo local +Y limbs; bind shoulders extend +/-X; +Z face', texturePixelsInspected: false };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const { asset, bytes, sha256 } = await parseSkinwalkerForInspection();
  console.log(JSON.stringify({ bytes: bytes.length, sha256, ...measureSkinwalker(asset) }, null, 2));
}
