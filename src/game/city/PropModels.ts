import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/examples/jsm/loaders/DRACOLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import { mergeGeometries, toCreasedNormals } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { getLauncherProfile } from "../launcherConfig";

export interface CityGltfAsset {
  scene: THREE.Group;
  animations: THREE.AnimationClip[];
}

let sharedLoader: GLTFLoader | null = null;
const modelCache = new Map<string, Promise<CityGltfAsset | null>>();
const MAX_CONCURRENT_CITY_GLBS = 2;
let activeCityGlbLoads = 0;
const cityGlbQueue: Array<() => void> = [];

async function withCityGlbSlot<T>(fn: () => Promise<T>): Promise<T> {
  if (activeCityGlbLoads >= MAX_CONCURRENT_CITY_GLBS) {
    await new Promise<void>((resolve) => cityGlbQueue.push(resolve));
  }
  activeCityGlbLoads++;
  try {
    return await fn();
  } finally {
    activeCityGlbLoads--;
    const next = cityGlbQueue.shift();
    if (next) next();
  }
}

function getLoader(): GLTFLoader | null {
  if (typeof window === "undefined" || typeof fetch !== "function") return null;
  if (sharedLoader) return sharedLoader;
  const base = (import.meta as unknown as { env?: { BASE_URL?: string } }).env?.BASE_URL ?? "/";
  const draco = new DRACOLoader();
  draco.setDecoderPath(`${base}draco/`);
  draco.setWorkerLimit(1);
  const loader = new GLTFLoader();
  loader.setDRACOLoader(draco);
  loader.setMeshoptDecoder(MeshoptDecoder);
  sharedLoader = loader;
  return loader;
}

/**
 * Loads and caches a GLB asset (scene + animation clips) from `/models/<filename>`.
 * Safely returns `null` in headless Node SSR tests so procedural fallbacks remain instant.
 */
export function loadCityGltf(filename: string): Promise<CityGltfAsset | null> {
  const loader = getLoader();
  if (!loader) return Promise.resolve(null);

  let pending = modelCache.get(filename);
  if (!pending) {
    const base = (import.meta as unknown as { env?: { BASE_URL?: string } }).env?.BASE_URL ?? "/";
    pending = withCityGlbSlot(async () => {
      try {
        await MeshoptDecoder.ready;
        const gltf = await loader.loadAsync(`${base}models/${filename}`);
        const maxAniso = getLauncherProfile().maxAnisotropy;
        gltf.scene.traverse((o) => {
          const m = o as THREE.Mesh;
          if (!m.isMesh) return;
          m.castShadow = true;
          m.receiveShadow = true;
          m.userData.sharedGltfAsset = true;
          const norm = m.geometry?.getAttribute?.("normal");
          const posCount = m.geometry?.getAttribute?.("position")?.count ?? 0;
          if (norm && (norm.array instanceof Int8Array || norm.array instanceof Int16Array)) {
            if (posCount <= 4000) {
              try {
                m.geometry = toCreasedNormals(m.geometry, (44 * Math.PI) / 180);
              } catch {
                m.geometry.computeVertexNormals();
              }
            } else {
              m.geometry.computeVertexNormals();
            }
          }
          const mats = Array.isArray(m.material) ? m.material : [m.material];
          for (const mat of mats) {
            const std = mat as THREE.MeshStandardMaterial | null;
            if (!std) continue;
            for (const tex of [std.map, std.normalMap, std.roughnessMap, std.metalnessMap, std.aoMap, std.emissiveMap]) {
              if (tex) {
                tex.magFilter = THREE.LinearFilter;
                tex.minFilter = THREE.LinearMipmapLinearFilter;
                tex.generateMipmaps = true;
                tex.anisotropy = maxAniso;
                // Quantized/meshopt GLBs can surface material textures whose
                // bitmap is still decoding when the traverse runs. Flagging an
                // upload there produces "Texture marked for update but no image
                // data found" spam, so only force the upload when we have pixels.
                if (tex.image) tex.needsUpdate = true;
              }
            }
          }
        });
        return { scene: gltf.scene, animations: gltf.animations ?? [] };
      } catch {
        return null;
      }
    });
    modelCache.set(filename, pending);
  }
  return pending.then((src) => (src ? { scene: src.scene.clone(true), animations: src.animations } : null));
}

/**
 * Loads and caches a GLB asset scene from `/models/<filename>` in the browser.
 * Safely returns `null` in headless Node SSR tests so procedural fallbacks remain instant.
 */
export function loadCityGlb(filename: string): Promise<THREE.Group | null> {
  return loadCityGltf(filename).then((asset) => (asset ? asset.scene : null));
}

/**
 * `Box3.setFromObject` calls `SkinnedMesh.computeBoundingBox()` when a skinned
 * object has no cached `boundingBox`. That path needs a resolved skeleton with
 * real bone matrices, and skinned props are routinely traversed here before
 * their skeleton is bound, which throws
 * "Cannot read properties of undefined (reading 'matrixWorld')" out of
 * `applyBoneTransform` and aborts the whole world build.
 *
 * Giving each skinned mesh the rest-pose bounds of its bind geometry lets
 * `expandByObject` skip the skeleton entirely. Bounds are conservative (they
 * cover the undeformed mesh) which is exactly what fitting/scaling wants.
 */
export function seedSkinnedBounds(root: THREE.Object3D): void {
  root.traverse((o) => {
    const m = o as THREE.SkinnedMesh;
    if (!m.isSkinnedMesh) return;
    if (!m.boundingBox) {
      const geo = m.geometry as THREE.BufferGeometry | undefined;
      if (geo) {
        if (!geo.boundingBox) geo.computeBoundingBox();
        if (geo.boundingBox) m.boundingBox = geo.boundingBox.clone();
      }
    }
    if (!m.boundingSphere) {
      const geo = m.geometry as THREE.BufferGeometry | undefined;
      if (geo) {
        if (!geo.boundingSphere) geo.computeBoundingSphere();
        if (geo.boundingSphere) m.boundingSphere = geo.boundingSphere.clone();
      }
    }
  });
}

/**
 * Scales `root` uniformly to match a target length (Z), width (X), or height (Y),
 * centers X/Z around 0, and places `minY` at `baseY` (e.g. `0` on ground or `-0.28` waterline).
 */
export function fitGlbToDimension(
  root: THREE.Group,
  axis: "x" | "y" | "z" | "max",
  targetMeters: number,
  baseY = 0,
  yawOffset = 0,
): THREE.Group {
  const wrapper = new THREE.Group();
  if (yawOffset !== 0) root.rotation.y = yawOffset;
  root.updateMatrixWorld(true);
  seedSkinnedBounds(root);
  const box = new THREE.Box3().setFromObject(root);
  const size = new THREE.Vector3();
  const center = new THREE.Vector3();
  box.getSize(size);
  box.getCenter(center);

  const refDim =
    axis === "x"
      ? size.x
      : axis === "y"
        ? size.y
        : axis === "z"
          ? size.z
          : Math.max(size.x, size.y, size.z);
  const scale = refDim > 1e-4 ? targetMeters / refDim : 1;

  root.scale.multiplyScalar(scale);
  root.position.set(-center.x * scale, -box.min.y * scale + baseY, -center.z * scale);
  wrapper.add(root);
  return wrapper;
}

/**
 * Scales `root` uniformly so it fits cleanly inside `(maxW, maxH, maxD)` without
 * overflowing lot bounds, centers X/Z around 0, and places `minY` at `baseY`.
 */
export function fitGlbToFootprint(
  root: THREE.Group,
  maxW: number,
  maxD: number,
  maxH: number,
  baseY = 0,
  yawOffset = 0,
): THREE.Group {
  const wrapper = new THREE.Group();
  if (yawOffset !== 0) root.rotation.y = yawOffset;
  root.updateMatrixWorld(true);
  seedSkinnedBounds(root);
  const box = new THREE.Box3().setFromObject(root);
  const size = new THREE.Vector3();
  const center = new THREE.Vector3();
  box.getSize(size);
  box.getCenter(center);

  const sx = size.x > 1e-4 ? maxW / size.x : 1;
  const sz = size.z > 1e-4 ? maxD / size.z : 1;
  const sy = size.y > 1e-4 ? maxH / size.y : 1;
  const scale = Math.min(sx, sz, sy);

  root.scale.multiplyScalar(scale);
  root.position.set(-center.x * scale, -box.min.y * scale + baseY, -center.z * scale);
  wrapper.add(root);
  return wrapper;
}

export interface AttachGlbOptions {
  axis?: "x" | "y" | "z" | "max";
  targetMeters?: number;
  fitFootprint?: { maxW: number; maxD: number; maxH: number };
  baseY?: number;
  yaw?: number;
  yawOffset?: number;
  castShadow?: boolean;
  receiveShadow?: boolean;
  /** Optional callback once loaded (e.g. hide procedural placeholder group). */
  onAttached?: (wrapper: THREE.Group) => void;
}

/**
 * Asynchronously attaches a cached, scaled GLB into `parent` (e.g. `chunk.nearGroup`).
 * Marks the subtree `userData.noMerge = true` and freezes static transform matrices.
 * No-op in headless Node SSR tests.
 */
export function attachGlbToGroup(
  parent: THREE.Object3D,
  filename: string,
  x: number,
  y: number,
  z: number,
  opts: AttachGlbOptions,
): void {
  if (typeof window === "undefined") return;
  if (opts.fitFootprint && !getLauncherProfile().maxHouseGlbs) return;
  void loadCityGlb(filename).then((raw) => {
    if (!raw) return;
    const fitted = opts.fitFootprint
      ? fitGlbToFootprint(
          raw,
          opts.fitFootprint.maxW,
          opts.fitFootprint.maxD,
          opts.fitFootprint.maxH,
          opts.baseY ?? 0,
          opts.yawOffset ?? 0,
        )
      : fitGlbToDimension(
          raw,
          opts.axis ?? "y",
          opts.targetMeters ?? 1,
          opts.baseY ?? 0,
          opts.yawOffset ?? 0,
        );
    fitted.position.set(x, y, z);
    if (opts.yaw) fitted.rotation.y = opts.yaw;
    fitted.userData.noMerge = true;
    const cast = opts.castShadow ?? true;
    const recv = opts.receiveShadow ?? true;
    fitted.traverse((o) => {
      o.userData.noMerge = true;
      if ((o as THREE.Mesh).isMesh) {
        o.castShadow = cast;
        o.receiveShadow = recv;
      }
      o.updateMatrix();
      o.matrixAutoUpdate = false;
    });
    parent.add(fitted);
    opts.onAttached?.(fitted);
  });
}

export interface InstancedGlbPart {
  geometry: THREE.BufferGeometry;
  material: THREE.MeshStandardMaterial;
}

const instancedPartsCache = new Map<string, Promise<InstancedGlbPart[] | null>>();

/**
 * Loads a GLB once, fits it to `targetMeters`, bakes node transforms, and merges
 * meshes sharing the same material into clean GPU-instancing parts.
 */
export function loadInstancedPartsFromGlb(
  filename: string,
  axis: "x" | "y" | "z" | "max",
  targetMeters: number,
  baseY = 0,
): Promise<InstancedGlbPart[] | null> {
  const key = `${filename}|${axis}|${targetMeters}|${baseY}`;
  let pending = instancedPartsCache.get(key);
  if (pending) return pending;

  pending = loadCityGlb(filename).then((raw) => {
    if (!raw) return null;
    const fitted = fitGlbToDimension(raw, axis, targetMeters, baseY, 0);
    fitted.updateMatrixWorld(true);

    const byMat = new Map<THREE.Material, THREE.BufferGeometry[]>();
    fitted.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh || Array.isArray(m.material)) return;
      const g = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone();
      for (const attr of Object.keys(g.attributes)) {
        if (attr !== "position" && attr !== "normal" && attr !== "uv") {
          g.deleteAttribute(attr);
        }
      }
      g.applyMatrix4(m.matrixWorld);
      if (!g.attributes.normal) g.computeVertexNormals();
      let arr = byMat.get(m.material);
      if (!arr) {
        arr = [];
        byMat.set(m.material, arr);
      }
      arr.push(g);
    });

    const parts: InstancedGlbPart[] = [];
    for (const [mat, geos] of byMat.entries()) {
      const merged = geos.length === 1 ? geos[0] : mergeGeometries(geos, false);
      if (geos.length > 1) geos.forEach((g) => g.dispose());
      if (!merged) continue;
      const std = (mat as THREE.MeshStandardMaterial).clone();
      std.roughness = Math.max(0.6, std.roughness ?? 0.8);
      parts.push({ geometry: merged, material: std });
    }
    return parts.length > 0 ? parts : null;
  });

  instancedPartsCache.set(key, pending);
  return pending;
}
