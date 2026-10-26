import * as THREE from 'three';
import { FBXLoader } from '../../vendor/fbx/loaders/FBXLoader.js';
import { clone as cloneSkeleton } from '../../vendor/fbx/utils/SkeletonUtils.js';

export const GUARDIAN_HEIGHT = 1.75;

/** Load the original FBX and finish every embedded image before exposing it. */
export async function loadGuardianAsset(url) {
  const manager = new THREE.LoadingManager();
  const failed = new Set();
  const blobURLs = new Set();
  let settleTextures;
  const texturesReady = new Promise(resolve => { settleTextures = resolve; });
  manager.onLoad = settleTextures;
  manager.onError = resource => failed.add(resource);
  manager.setURLModifier(resource => {
    if (resource.startsWith('blob:')) blobURLs.add(resource);
    return resource;
  });
  try {
    const asset = await new FBXLoader(manager).loadAsync(url);
    await texturesReady;
    if (failed.size) throw new Error(`Guardiao: ${failed.size} embedded texture resource(s) failed to load`);
    asset.updateMatrixWorld(true);
    asset.userData.guardianSource = String(url);
    return asset;
  } finally {
    // Decoded images retain their pixels. The FBX's temporary URLs do not need
    // to remain alive for independently cloned characters to share the images.
    for (const resource of blobURLs) URL.revokeObjectURL(resource);
  }
}

/**
 * Independent pose/material state, original immutable geometry and textures.
 * Normalize through a parent, preserving all authored offsets, bind matrices,
 * skin weights and skeleton index ordering. The FBX is already Y-up/+Z front.
 */
export function createGuardianInstance(asset, options = {}) {
  if (!asset?.isObject3D) throw new TypeError('Guardiao requires a loaded THREE.Object3D');
  const skin = cloneSkeleton(asset);
  const materialClones = new Map();
  let skinCount = 0;
  const cloneMaterial = original => {
    if (!materialClones.has(original)) materialClones.set(original, original.clone());
    return materialClones.get(original);
  };
  skin.traverse(object => {
    if (!object.isMesh) return;
    object.material = Array.isArray(object.material) ? object.material.map(cloneMaterial) : cloneMaterial(object.material);
    object.castShadow = true;
    object.receiveShadow = true;
    if (!object.isSkinnedMesh) return;
    skinCount++;
    // Three Skeleton.clone shares inverses. Keep the immutable source bind
    // untouched even if an individual character recalculates its own binding.
    object.skeleton.boneInverses = object.skeleton.boneInverses.map(matrix => matrix.clone());
    object.frustumCulled = false;
  });
  if (!skinCount) throw new Error('Guardiao FBX contains no skinned mesh');
  skin.animations = skin.animations.map(clip => clip.clone());
  skin.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(skin, true);
  const size = bounds.getSize(new THREE.Vector3());
  if (!(size.y > 0) || !Number.isFinite(size.y)) throw new Error('Guardiao has invalid bind-pose bounds');
  const height = options.height ?? GUARDIAN_HEIGHT;
  if (!(height > 0) || !Number.isFinite(height)) throw new TypeError('Guardian instance height must be finite and positive');
  const profile = options.profile ?? 'guardian';
  const scale = height / size.y;
  const center = bounds.getCenter(new THREE.Vector3());
  const normalization = new THREE.Group();
  normalization.name = 'GuardiaoNormalization';
  normalization.scale.setScalar(scale);
  normalization.position.set(-center.x * scale, -bounds.min.y * scale, -center.z * scale);
  normalization.add(skin);
  const root = new THREE.Group();
  root.name = profile === 'skinwalker' ? 'Skinwalker' : 'Guardiao';
  root.add(normalization);
  root.userData.guardianAsset = {
    height, profile, scale, axis: 'Y-up/+Z-forward',
    originalBounds: { min: bounds.min.toArray(), max: bounds.max.toArray() },
  };
  root.updateMatrixWorld(true);
  return root;
}
