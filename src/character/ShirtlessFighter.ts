import * as THREE from "three";
import { GLTFLoader, type GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import * as SkeletonUtils from "three/examples/jsm/utils/SkeletonUtils.js";

const BASE_URL = (import.meta as unknown as { env?: { BASE_URL?: string } }).env?.BASE_URL ?? "/";

export interface FighterBuildOptions {
  outfit: "shorts" | "jeans";
  boots: boolean;
  hair: "short02" | "short04" | "none";
  skinHex: string;
  hairHex?: string;
  shortsHex?: string;
  muscle: number;
  weight: number;
  height?: number;
}

export const DEFAULT_FIGHTER_OPTS: FighterBuildOptions = {
  outfit: "shorts",
  boots: false,
  hair: "short02",
  skinHex: "#c98c68",
  hairHex: "#1c1510",
  shortsHex: "#991b1b",
  muscle: 0.78,
  weight: 0.1,
  height: 0.16,
};

export function buildFighterUrl(opts: Partial<FighterBuildOptions> = {}): string {
  const o = { ...DEFAULT_FIGHTER_OPTS, ...opts };
  const params = new URLSearchParams({
    outfit: o.outfit,
    boots: o.boots ? "1" : "0",
    hair: o.hair,
    skin: o.skinHex.replace(/^#/, ""),
    hairHex: (o.hairHex ?? "#1c1510").replace(/^#/, ""),
    shorts: (o.shortsHex ?? "#991b1b").replace(/^#/, ""),
    muscle: o.muscle.toFixed(2),
    weight: o.weight.toFixed(2),
    height: (o.height ?? 0.16).toFixed(2),
  });
  return `fighter://cc0?${params.toString()}`;
}

export function isFighterUrl(url: string | undefined | null): boolean {
  return typeof url === "string" && url.startsWith("fighter://");
}

export function parseFighterUrl(url: string): FighterBuildOptions {
  const qIdx = url.indexOf("?");
  const params = new URLSearchParams(qIdx >= 0 ? url.slice(qIdx + 1) : "");
  const outfit = params.get("outfit") === "jeans" ? "jeans" : "shorts";
  const boots = params.get("boots") === "1";
  const h = params.get("hair");
  const hair: FighterBuildOptions["hair"] =
    h === "short04" || h === "none" ? h : "short02";
  const hex = (v: string | null, fallback: string) =>
    v && /^[0-9a-fA-F]{6}$/.test(v) ? `#${v}` : fallback;
  return {
    outfit,
    boots,
    hair,
    skinHex: hex(params.get("skin"), DEFAULT_FIGHTER_OPTS.skinHex),
    hairHex: hex(params.get("hairHex"), DEFAULT_FIGHTER_OPTS.hairHex!),
    shortsHex: hex(params.get("shorts"), DEFAULT_FIGHTER_OPTS.shortsHex!),
    muscle: Math.max(0, Math.min(1, Number(params.get("muscle") ?? DEFAULT_FIGHTER_OPTS.muscle))),
    weight: Math.max(-0.5, Math.min(0.9, Number(params.get("weight") ?? DEFAULT_FIGHTER_OPTS.weight))),
    height: Math.max(-0.2, Math.min(0.35, Number(params.get("height") ?? DEFAULT_FIGHTER_OPTS.height))),
  };
}

let sharedLoader: GLTFLoader | null = null;
function getLoader(): GLTFLoader {
  if (sharedLoader) return sharedLoader;
  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);
  sharedLoader = loader;
  return loader;
}

const gltfCache = new Map<string, Promise<GLTF>>();
function loadPartGltf(file: string, onProgress?: (p: number) => void): Promise<GLTF> {
  const url = `${BASE_URL}characters/fighter/${file}`;
  const cached = gltfCache.get(url);
  if (cached) return cached;
  const p = new Promise<GLTF>((resolve, reject) => {
    getLoader().load(
      url,
      (gltf) => resolve(gltf),
      (ev) => {
        if (onProgress && ev.total > 0) onProgress(Math.min(1, ev.loaded / ev.total));
      },
      reject,
    );
  });
  gltfCache.set(url, p);
  return p;
}

function applyFighterMorphs(mesh: THREE.SkinnedMesh, opts: FighterBuildOptions) {
  const dict = mesh.morphTargetDictionary;
  const inf = mesh.morphTargetInfluences;
  if (!dict || !inf) return;
  const set = (name: string, w: number) => {
    const idx = dict[name];
    if (idx !== undefined) inf[idx] = w;
  };
  set("gender_male", 1.0);
  set("gender_female", 0.0);
  set("muscle_max", Math.max(0, opts.muscle));
  set("muscle_min", Math.max(0, -opts.muscle));
  set("weight_max", Math.max(0, opts.weight));
  set("weight_min", Math.max(0, -opts.weight));
  const h = opts.height ?? 0.16;
  set("height_tall", Math.max(0, h));
  set("height_short", Math.max(0, -h));
  set("proportions_ideal", 0.55);
  // Apply bilinear MakeHuman corrective morphs where present
  set("corr_gender_male__muscle_max", Math.max(0, opts.muscle));
  set("corr_gender_male__weight_max", Math.max(0, opts.weight));
  set("corr_gender_male__weight_min", Math.max(0, -opts.weight));
  set("corr_weight_max__muscle_max", Math.max(0, opts.weight) * Math.max(0, opts.muscle));
}

function bindPartToBodySkeleton(partMesh: THREE.SkinnedMesh, bodySkeleton: THREE.Skeleton, bindMatrix: THREE.Matrix4) {
  const own = partMesh.skeleton;
  if (!own || own === bodySkeleton) return;
  const byName = new Map<string, number>();
  bodySkeleton.bones.forEach((b, i) => byName.set(b.name, i));
  const remap = own.bones.map((b) => byName.get(b.name) ?? 0);
  const skinAttr = partMesh.geometry.attributes.skinIndex;
  if (skinAttr) {
    const clonedAttr = skinAttr.clone();
    for (let i = 0; i < clonedAttr.array.length; i++) {
      clonedAttr.array[i] = remap[clonedAttr.array[i]] ?? 0;
    }
    clonedAttr.needsUpdate = true;
    partMesh.geometry = partMesh.geometry.clone();
    partMesh.geometry.setAttribute("skinIndex", clonedAttr);
  }
  partMesh.bind(bodySkeleton, bindMatrix);
}

function applyMaterialTint(mat: THREE.Material, hex: string, defaultGain = 1) {
  const m = mat as THREE.MeshStandardMaterial;
  if (!m?.color) return;
  m.color.set(hex);
  const g = Number(m.userData?.tint?.gain) || defaultGain;
  if (g > 0 && g !== 1) m.color.multiplyScalar(g);
}

/**
 * Assemble a CC0 shirtless muscular street fighter (MakeHuman base body + fight shorts/jeans
 * + optional boots/hair) bound onto one unified skeleton ready for SoldierRig.
 */
export async function assembleShirtlessFighter(
  opts: FighterBuildOptions,
  onProgress?: (p: number) => void,
): Promise<{ scene: THREE.Group; animations: THREE.AnimationClip[] }> {
  const files = [
    "base_body.glb",
    opts.outfit === "jeans" ? "clothing_jeans.glb" : "clothing_shorts.glb",
  ];
  if (opts.boots) files.push("clothing_boots.glb");
  if (opts.hair !== "none") files.push(`${opts.hair}.glb`);

  const gltfs = await Promise.all(
    files.map((f, i) => loadPartGltf(f, i === 0 ? onProgress : undefined)),
  );
  const bodyRoot = SkeletonUtils.clone(gltfs[0].scene) as THREE.Group;

  let bodyMesh: THREE.SkinnedMesh | null = null;
  const bodyMorphMeshes: THREE.SkinnedMesh[] = [];
  bodyRoot.traverse((o) => {
    const sm = o as THREE.SkinnedMesh;
    if (sm.isSkinnedMesh) {
      bodyMorphMeshes.push(sm);
      const vCount = sm.geometry?.attributes?.position?.count ?? 0;
      const prevCount = bodyMesh?.geometry?.attributes?.position?.count ?? -1;
      if (!bodyMesh || sm.name === "base" || vCount > prevCount) bodyMesh = sm;
    }
  });

  if (!bodyMesh) {
    return { scene: bodyRoot, animations: [] };
  }
  const primaryBody = bodyMesh as THREE.SkinnedMesh;

  for (const sm of bodyMorphMeshes) {
    applyFighterMorphs(sm, opts);
    const mats = Array.isArray(sm.material) ? sm.material : [sm.material];
    const cloned = mats.map((orig) => {
      const m = orig.clone();
      if (m.name === "Skin") applyMaterialTint(m, opts.skinHex, 1.6129);
      if (m.name === "Eyebrow" || m.name === "Eyelash") {
        applyMaterialTint(m, opts.hairHex ?? "#1c1510", 1.8182);
      }
      return m;
    });
    sm.material = Array.isArray(sm.material) ? cloned : cloned[0];
  }

  // Attach lower-body clothing, optional boots, and optional hair onto the same skeleton
  for (let i = 1; i < gltfs.length; i++) {
    const srcFile = files[i];
    const isShorts = srcFile.includes("shorts");
    const isHair = srcFile.includes("hair");
    const partClone = SkeletonUtils.clone(gltfs[i].scene) as THREE.Group;
    const partMeshes: THREE.SkinnedMesh[] = [];
    partClone.traverse((o) => {
      const sm = o as THREE.SkinnedMesh;
      if (sm.isSkinnedMesh) partMeshes.push(sm);
    });
    for (const pm of partMeshes) {
      pm.removeFromParent();
      applyFighterMorphs(pm, opts);
      bindPartToBodySkeleton(pm, primaryBody.skeleton, primaryBody.bindMatrix);
      const mats = Array.isArray(pm.material) ? pm.material : [pm.material];
      const cloned = mats.map((orig) => {
        const m = orig.clone() as THREE.MeshStandardMaterial;
        if (isShorts && opts.shortsHex) {
          m.color.set(opts.shortsHex);
        } else if (isHair || /hair/i.test(m.name)) {
          applyMaterialTint(m, opts.hairHex ?? "#1c1510", 1.8);
        }
        return m;
      });
      pm.material = Array.isArray(pm.material) ? cloned : cloned[0];
      primaryBody.parent?.add(pm);
    }
  }

  bodyRoot.updateMatrixWorld(true);
  return { scene: bodyRoot, animations: [] };
}
