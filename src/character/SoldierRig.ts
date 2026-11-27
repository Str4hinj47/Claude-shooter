import * as THREE from "three";
import { GLTFLoader, type GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/examples/jsm/loaders/DRACOLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import * as SkeletonUtils from "three/examples/jsm/utils/SkeletonUtils.js";
import { applyWeaponCustomization, buildRifle, buildWeapon, RIFLE, tintWeapon, WEAPONS, type Rifle, type WeaponId, type WeaponSpec } from "./rifle";
import { buildEquipment, type EquipmentAlignMap, type SoldierEquipment } from "./equipment";
import { DEFAULT_WEAPON_CONFIGS, type SoldierAppearance, type WeaponCustomConfig } from "../game/progression";
import { getSuitPreset, type SuitPresetDef } from "../game/characters";
import { Spring, clamp, damp, dampAngle, easeInOut, lerp, smoothstep, wrapAngle } from "./math";
import {
  DrawAnimator,
  OrganicMotionNoise,
  TakedownAnimator,
  evaluateArticulatedDeath,
  updateFootPlacement,
  type DrawPose,
  type FootPlacementState,
  type TakedownPose,
} from "./AnimationMotion";
import {
  COMBAT_HIPS_BONE,
  COMBAT_LOWER_BONES,
  COMBAT_UPPER_BONES,
  canonicalizeBoneName,
  getCombatBankForRig,
  preloadCombatAnimations,
  retargetAnimationClipForSkeleton,
  sampleCombatBone,
} from "./CombatAnimations";
import {
  HandToHandController,
  isGrappleMoveId,
  type CombatVisualPose,
  type MeleeMoveDef,
} from "./HandToHandCombat";
import {
  assembleShirtlessFighter,
  isFighterUrl,
  parseFighterUrl,
} from "./ShirtlessFighter";

const BASE_URL = (import.meta as unknown as { env?: { BASE_URL?: string } }).env?.BASE_URL ?? "/";
const soldierUrl = `${BASE_URL}characters/soldier.glb`;

interface CharDetailMaps {
  fabricRoughness: THREE.DataTexture;
  skinRoughness: THREE.DataTexture;
  metalRoughness: THREE.DataTexture;
  hairRoughness: THREE.DataTexture;
  hairBump: THREE.DataTexture;
}

let cachedDetailMaps: CharDetailMaps | null = null;
function getCharDetailMaps(): CharDetailMaps {
  if (cachedDetailMaps) return cachedDetailMaps;

  const makeNoiseTex = (size: number, repeat: number, fn: (x: number, y: number) => number) => {
    const data = new Uint8Array(size * size * 4);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const v = Math.max(0, Math.min(255, Math.round(fn(x, y) * 255)));
        const idx = (y * size + x) * 4;
        data[idx] = v;
        data[idx + 1] = v;
        data[idx + 2] = v;
        data[idx + 3] = 255;
      }
    }
    const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.generateMipmaps = true;
    tex.anisotropy = 16;
    tex.repeat.set(repeat, repeat);
    tex.needsUpdate = true;
    return tex;
  };

  // High-resolution matte woven wool/twill micro-weave for uniforms & jackets (512px)
  const fabricRoughness = makeNoiseTex(512, 12, (x, y) => {
    const u = (x / 512) * Math.PI * 2;
    const v = (y / 512) * Math.PI * 2;
    const weave = Math.sin(u * 28 + Math.cos(v * 28) * 0.6) * 0.025 + Math.sin(v * 28) * 0.02;
    const soft = Math.sin(u * 4 + v * 3) * 0.015 + Math.cos(u * 7 - v * 5) * 0.01;
    return 0.94 + weave + soft;
  });

  // High-resolution smooth organic skin specular micro-variation (512px)
  const skinRoughness = makeNoiseTex(512, 6, (x, y) => {
    const u = (x / 512) * Math.PI * 2;
    const v = (y / 512) * Math.PI * 2;
    const n1 = Math.sin(u * 6 + Math.sin(v * 5)) * 0.032;
    const n2 = Math.cos(v * 9 - Math.cos(u * 7)) * 0.022;
    const n3 = Math.sin((u + v) * 14) * 0.012;
    return 0.50 + n1 + n2 + n3;
  });

  // High-resolution fine brushed directional grain for gunmetal blades, pistols, tools & buckles (512px)
  const metalRoughness = makeNoiseTex(512, 6, (x, y) => {
    const u = (x / 512) * Math.PI * 2;
    const v = (y / 512) * Math.PI * 2;
    const streak = Math.sin(v * 22) * 0.042 + Math.cos(v * 7 + u * 2) * 0.022;
    return 0.25 + streak;
  });

  // Fibrous matte vertical hair-strand roughness & micro-groove bump (512px)
  // High base roughness (0.88–0.97) breaks up specular glare completely so hair never looks like glossy plastic
  const hairRoughness = makeNoiseTex(512, 8, (x, y) => {
    const u = (x / 512) * Math.PI * 2;
    const v = (y / 512) * Math.PI * 2;
    const fine = Math.sin(u * 46 + Math.sin(v * 3) * 0.8) * 0.028;
    const clump = Math.cos(u * 13 + Math.cos(v * 2) * 0.5) * 0.022;
    const micro = Math.sin(u * 92 + v * 5) * 0.015;
    return 0.91 + fine + clump + micro;
  });

  const hairBump = makeNoiseTex(512, 8, (x, y) => {
    const u = (x / 512) * Math.PI * 2;
    const v = (y / 512) * Math.PI * 2;
    const strands = Math.sin(u * 48 + Math.sin(v * 2.5) * 0.9) * 0.26;
    const lock = Math.cos(u * 14 + Math.sin(v * 1.5) * 0.4) * 0.16;
    const fiber = Math.sin(u * 96 + v * 7) * 0.08;
    return 0.5 + strands + lock + fiber;
  });

  cachedDetailMaps = { fabricRoughness, skinRoughness, metalRoughness, hairRoughness, hairBump };
  return cachedDetailMaps;
}

function configureCharacterTex(tex: THREE.Texture | null | undefined, isColor = false) {
  if (!tex) return;
  tex.anisotropy = 16;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  if (isColor) tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
}

export function upgradeCharacterMaterial(orig: THREE.Material): THREE.MeshPhysicalMaterial {
  const s = orig as THREE.MeshStandardMaterial;
  const maps = getCharDetailMaps();
  const name = s.name || "";

  const p = new THREE.MeshPhysicalMaterial({
    name,
    color: s.color ? s.color.clone() : new THREE.Color(0xffffff),
    map: s.map ?? null,
    normalMap: s.normalMap ?? null,
    aoMap: s.aoMap ?? null,
    emissive: s.emissive ? s.emissive.clone() : new THREE.Color(0x000000),
    emissiveMap: s.emissiveMap ?? null,
    emissiveIntensity: s.emissiveIntensity ?? 1,
    alphaMap: s.alphaMap ?? null,
    alphaTest: s.alphaTest ?? 0,
    side: s.side,
    vertexColors: !!s.vertexColors,
  });

  configureCharacterTex(p.map, true);
  configureCharacterTex(p.normalMap, false);
  configureCharacterTex(p.aoMap, false);
  configureCharacterTex(p.emissiveMap, true);
  configureCharacterTex(p.alphaMap, false);

  if (/cornea/i.test(name)) {
    p.transparent = true;
    p.opacity = 0.08;
    p.metalness = 0.0;
    p.roughness = 0.04;
    p.clearcoat = 1.0;
    p.depthWrite = false;
  } else if (/visor/i.test(name)) {
    p.metalness = 0.92;
    p.roughness = 0.06;
    p.clearcoat = 1.0;
    p.clearcoatRoughness = 0.04;
    p.iridescence = 0.45;
    p.iridescenceIOR = 1.35;
    p.envMapIntensity = 1.85;
  } else if (/opacity|hair|eyebrow|eyelash/i.test(name)) {
    p.metalness = 0.0;
    p.roughness = 0.93;
    p.clearcoat = 0.0;
    p.ior = 1.31;
    p.specularIntensity = 0.05;
    p.envMapIntensity = 0.10;
    p.sheen = 0.12;
    p.sheenRoughness = 0.88;
    p.sheenColor = p.color.clone().multiplyScalar(0.32).addScalar(0.03);
    p.alphaTest = Math.max(p.alphaTest || 0, 0.36);
    p.transparent = false;
    p.side = THREE.DoubleSide;

    // Sync hair strand detail maps to any KHR_texture_transform UV tiling on p.map
    if (p.map && (p.map.repeat.x > 2 || p.map.repeat.y > 2)) {
      const rMap = maps.hairRoughness.clone();
      rMap.repeat.set(p.map.repeat.x * 1.4, p.map.repeat.y * 1.4);
      rMap.offset.copy(p.map.offset);
      rMap.userData.sharedPresetTex = true;
      rMap.needsUpdate = true;
      p.roughnessMap = rMap;
      if (!p.normalMap) {
        const bMap = maps.hairBump.clone();
        bMap.repeat.set(p.map.repeat.x * 1.4, p.map.repeat.y * 1.4);
        bMap.offset.copy(p.map.offset);
        bMap.userData.sharedPresetTex = true;
        bMap.needsUpdate = true;
        p.bumpMap = bMap;
        p.bumpScale = 0.0042;
      }
    } else {
      p.roughnessMap = maps.hairRoughness;
      if (!p.normalMap) {
        p.bumpMap = maps.hairBump;
        p.bumpScale = 0.0042;
      }
    }
  } else if (/head|skin|face/i.test(name)) {
    p.metalness = 0.0;
    p.roughness = 0.56;
    p.roughnessMap = maps.skinRoughness;
    p.sheen = 0.14;
    p.sheenRoughness = 0.60;
    p.sheenColor = new THREE.Color(0xd99b7c);
    p.clearcoat = 0.0;
    p.ior = 1.38;
    p.specularIntensity = 0.20;
    p.envMapIntensity = 0.46;
    if (p.normalMap) p.normalScale.set(0.95, 0.95);
    else {
      p.bumpMap = maps.skinRoughness;
      p.bumpScale = 0.0009;
    }
  } else if (/knife|pistol|gun|tools/i.test(name)) {
    p.metalness = 0.86;
    p.roughness = 0.26;
    p.roughnessMap = maps.metalRoughness;
    p.clearcoat = 0.14;
    p.clearcoatRoughness = 0.22;
    p.envMapIntensity = 1.4;
    if (p.normalMap) p.normalScale.set(1.35, 1.35);
  } else if (/helmet/i.test(name)) {
    p.metalness = 0.16;
    p.roughness = 0.38;
    p.clearcoat = 0.36;
    p.clearcoatRoughness = 0.28;
    p.envMapIntensity = 1.1;
    if (p.normalMap) p.normalScale.set(1.25, 1.25);
  } else if (/equipment/i.test(name)) {
    p.metalness = 0.06;
    p.roughness = 0.78;
    p.roughnessMap = maps.fabricRoughness;
    p.sheen = 0.12;
    p.sheenRoughness = 0.72;
    p.sheenColor = new THREE.Color(0x9ca3af);
    p.envMapIntensity = 0.5;
    if (p.normalMap) p.normalScale.set(1.35, 1.35);
  } else if (/vanguard/i.test(name)) {
    p.metalness = 0.22;
    p.roughness = 0.46;
    p.roughnessMap = maps.fabricRoughness;
    p.sheen = 0.18;
    p.sheenRoughness = 0.65;
    p.clearcoat = 0.16;
    p.clearcoatRoughness = 0.42;
    p.envMapIntensity = 0.85;
    if (p.normalMap) p.normalScale.set(1.35, 1.35);
  } else {
    // Clothing / uniforms (_body, which also maps bare hands on Rocketbox characters) — strict matte cloth
    p.metalness = 0.0;
    p.roughness = 0.94;
    p.roughnessMap = maps.fabricRoughness;
    p.sheen = 0.0;
    p.clearcoat = 0.0;
    p.specularIntensity = 0.04;
    p.envMapIntensity = 0.14;
    if (p.normalMap) p.normalScale.set(1.15, 1.15);
    else {
      p.bumpMap = maps.fabricRoughness;
      p.bumpScale = 0.0022;
    }
  }
  return p;
}

const tunedHandSkinGeos = new WeakSet<THREE.BufferGeometry>();

/**
 * Rocketbox character `_body` textures bake bare hand skin ~15–50% brighter
 * than the `_head` face texture (and render under matte fabric shading).
 * Sample the character's own head skin vs bare hand-bone skin pixels once per
 * shared geometry and apply a smooth per-vertex linear multiplier on bare
 * hand skin vertices only — leaving cuffs, watches, and gloves untouched.
 */
export function matchRocketboxHandSkinTone(model: THREE.Group) {
  if (typeof document === "undefined") return;

  const sampleTexPixels = (tex: THREE.Texture | null | undefined) => {
    const img = tex?.image as (CanvasImageSource & { width?: number; height?: number; naturalWidth?: number; naturalHeight?: number }) | undefined;
    if (!tex || !img) return null;
    const w = img.naturalWidth || img.width || 0;
    const h = img.naturalHeight || img.height || 0;
    if (!w || !h) return null;
    const cw = Math.min(256, w);
    const ch = Math.min(256, h);
    const canvas = document.createElement("canvas");
    canvas.width = cw;
    canvas.height = ch;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    try {
      ctx.drawImage(img, 0, 0, cw, ch);
      const data = ctx.getImageData(0, 0, cw, ch).data;
      return { w: cw, h: ch, flipY: tex.flipY, data };
    } catch {
      return null;
    }
  };

  type SampledTex = NonNullable<ReturnType<typeof sampleTexPixels>>;
  const texCache = new Map<THREE.Texture, SampledTex | null>();
  const getPixels = (tex: THREE.Texture | null | undefined) => {
    if (!tex) return null;
    if (!texCache.has(tex)) texCache.set(tex, sampleTexPixels(tex));
    return texCache.get(tex) ?? null;
  };

  const sampleUv = (pix: SampledTex, u: number, v: number) => {
    const uu = ((u % 1) + 1) % 1;
    const vv = ((v % 1) + 1) % 1;
    const px = Math.min(pix.w - 1, Math.max(0, Math.floor(uu * pix.w)));
    const py = Math.min(pix.h - 1, Math.max(0, Math.floor((pix.flipY ? 1 - vv : vv) * pix.h)));
    const idx = (py * pix.w + px) * 4;
    return [pix.data[idx], pix.data[idx + 1], pix.data[idx + 2]] as const;
  };

  const meshes: THREE.SkinnedMesh[] = [];
  model.traverse((o) => {
    const sm = o as THREE.SkinnedMesh;
    if (sm.isSkinnedMesh && sm.skeleton) meshes.push(sm);
  });

  // 1. Measure average face skin sRGB from head meshes
  let headR = 0, headG = 0, headB = 0, headN = 0;
  for (const sm of meshes) {
    const mat = (Array.isArray(sm.material) ? sm.material[0] : sm.material) as THREE.MeshStandardMaterial | undefined;
    if (!mat || !/head|face|skin/i.test(mat.name)) continue;
    const pix = getPixels(mat.map);
    const uv = sm.geometry.getAttribute("uv");
    const j0 = sm.geometry.getAttribute("skinIndex");
    const w0 = sm.geometry.getAttribute("skinWeight");
    if (!pix || !uv || !j0 || !w0) continue;
    const headBones = new Set<number>();
    sm.skeleton.bones.forEach((b, i) => {
      if (/head/i.test(b.name)) headBones.add(i);
    });
    for (let k = 0; k < uv.count; k++) {
      let hw = 0;
      for (let c = 0; c < 4; c++) {
        if (headBones.has(j0.getComponent(k, c))) hw += w0.getComponent(k, c);
      }
      if (hw < 0.5) continue;
      const [r, g, b] = sampleUv(pix, uv.getX(k), uv.getY(k));
      if (r > 80 && r > g + 10 && g > b + 3) {
        headR += r; headG += g; headB += b; headN++;
      }
    }
  }
  if (headN === 0) return;
  headR /= headN; headG /= headN; headB /= headN;

  // 2. Match bare-skin hand vertices on `_body` meshes to the face skin tone
  for (const sm of meshes) {
    const mat = (Array.isArray(sm.material) ? sm.material[0] : sm.material) as THREE.MeshStandardMaterial | undefined;
    if (!mat || /head|face|skin|opacity|hair|helmet|equipment|knife|pistol|tools|visor/i.test(mat.name)) continue;
    if (tunedHandSkinGeos.has(sm.geometry)) {
      mat.vertexColors = true;
      mat.needsUpdate = true;
      continue;
    }
    const pix = getPixels(mat.map);
    const uv = sm.geometry.getAttribute("uv");
    const j0 = sm.geometry.getAttribute("skinIndex");
    const w0 = sm.geometry.getAttribute("skinWeight");
    if (!pix || !uv || !j0 || !w0) continue;

    const handBones = new Set<number>();
    sm.skeleton.bones.forEach((b, i) => {
      if (/hand/i.test(b.name)) handBones.add(i);
    });
    if (handBones.size === 0) continue;

    let handR = 0, handG = 0, handB = 0, handN = 0;
    const handWeights = new Float32Array(uv.count);
    const isBareSkin = new Uint8Array(uv.count);
    for (let k = 0; k < uv.count; k++) {
      let hw = 0;
      for (let c = 0; c < 4; c++) {
        if (handBones.has(j0.getComponent(k, c))) hw += w0.getComponent(k, c);
      }
      handWeights[k] = hw;
      if (hw < 0.5) continue;
      const [r, g, b] = sampleUv(pix, uv.getX(k), uv.getY(k));
      if (r > 125 && r > g + 12 && g > b + 4) {
        isBareSkin[k] = 1;
        if (hw >= 0.75) {
          handR += r; handG += g; handB += b; handN++;
        }
      }
    }
    if (handN < 20) continue;
    handR /= handN; handG /= handN; handB /= handN;

    // Linear-space multiplier matching face skin + subtle compensation for
    // matte fabric body shading vs warm specular head skin shading.
    const mulR = clamp(Math.pow(headR / handR, 2.2) * 0.84, 0.40, 0.86);
    const mulG = clamp(Math.pow(headG / handG, 2.2) * 0.82, 0.36, 0.82);
    const mulB = clamp(Math.pow(headB / handB, 2.2) * 0.80, 0.34, 0.80);

    const existing = sm.geometry.getAttribute("color");
    const colors = new Float32Array(uv.count * 3);
    for (let k = 0; k < uv.count; k++) {
      const br = existing ? existing.getX(k) : 1;
      const bg = existing ? existing.getY(k) : 1;
      const bb = existing ? existing.getZ(k) : 1;
      if (isBareSkin[k]) {
        const t = clamp((handWeights[k] - 0.5) / 0.35, 0, 1);
        colors[k * 3] = br * lerp(1, mulR, t);
        colors[k * 3 + 1] = bg * lerp(1, mulG, t);
        colors[k * 3 + 2] = bb * lerp(1, mulB, t);
      } else {
        colors[k * 3] = br;
        colors[k * 3 + 1] = bg;
        colors[k * 3 + 2] = bb;
      }
    }
    sm.geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    tunedHandSkinGeos.add(sm.geometry);
    mat.vertexColors = true;
    mat.needsUpdate = true;
  }
}

interface CalibrationData {
  walkN: number;
  runN: number;
  walkStride: number;
  runStride: number;
  walkOff: number;
  runOff: number;
}

const cachedGltfMap = new Map<string, Promise<GLTF>>();
const calibratedCache = new Map<string, CalibrationData>();
let sharedSoldierLoader: GLTFLoader | null = null;
function getSoldierLoader(): GLTFLoader {
  if (sharedSoldierLoader) return sharedSoldierLoader;
  const draco = new DRACOLoader();
  draco.setDecoderPath(`${BASE_URL}draco/`);
  draco.setWorkerLimit(1);
  const loader = new GLTFLoader();
  loader.setDRACOLoader(draco);
  loader.setMeshoptDecoder(MeshoptDecoder);
  sharedSoldierLoader = loader;
  return loader;
}
/**
 * Upgrades quantized 8-bit/16-bit GLB character normals to full Float32 smooth
 * crease-aware vertex normals in-place, preserving SkinnedMesh indices & weights.
 */
function upgradeQuantizedCharacterNormals(geo: THREE.BufferGeometry, creaseDeg = 56): void {
  const pos = geo.getAttribute("position");
  const norm = geo.getAttribute("normal");
  if (!pos || !norm) return;
  if (!(norm.array instanceof Int8Array || norm.array instanceof Int16Array)) return;

  const vCount = pos.count;
  const idx = geo.index;
  const triCount = idx ? Math.floor(idx.count / 3) : Math.floor(vCount / 3);
  if (triCount <= 0) return;

  // Compute area-weighted face normal per vertex via triangle accumulation
  const vertFaceN = new Float32Array(vCount * 3);
  const pA = new THREE.Vector3();
  const pB = new THREE.Vector3();
  const pC = new THREE.Vector3();
  const ab = new THREE.Vector3();
  const ac = new THREE.Vector3();
  const fn = new THREE.Vector3();

  for (let t = 0; t < triCount; t++) {
    const i0 = idx ? idx.getX(t * 3) : t * 3;
    const i1 = idx ? idx.getX(t * 3 + 1) : t * 3 + 1;
    const i2 = idx ? idx.getX(t * 3 + 2) : t * 3 + 2;
    pA.fromBufferAttribute(pos, i0);
    pB.fromBufferAttribute(pos, i1);
    pC.fromBufferAttribute(pos, i2);
    ab.subVectors(pB, pA);
    ac.subVectors(pC, pA);
    fn.crossVectors(ab, ac);
    for (const vi of [i0, i1, i2]) {
      vertFaceN[vi * 3] += fn.x;
      vertFaceN[vi * 3 + 1] += fn.y;
      vertFaceN[vi * 3 + 2] += fn.z;
    }
  }

  // Group seam vertices by welded spatial coordinate
  const posGroups = new Map<string, number[]>();
  for (let i = 0; i < vCount; i++) {
    const k = `${Math.round(pos.getX(i) * 10000)},${Math.round(pos.getY(i) * 10000)},${Math.round(pos.getZ(i) * 10000)}`;
    let g = posGroups.get(k);
    if (!g) {
      g = [];
      posGroups.set(k, g);
    }
    g.push(i);
  }

  const outNormals = new Float32Array(vCount * 3);
  const cosThresh = Math.cos((creaseDeg * Math.PI) / 180);

  for (const group of posGroups.values()) {
    for (const vi of group) {
      const bx = vertFaceN[vi * 3];
      const by = vertFaceN[vi * 3 + 1];
      const bz = vertFaceN[vi * 3 + 2];
      const bLen = Math.hypot(bx, by, bz) || 1;
      const nbx = bx / bLen;
      const nby = by / bLen;
      const nbz = bz / bLen;

      let sx = 0, sy = 0, sz = 0;
      for (const vj of group) {
        const jx = vertFaceN[vj * 3];
        const jy = vertFaceN[vj * 3 + 1];
        const jz = vertFaceN[vj * 3 + 2];
        const jLen = Math.hypot(jx, jy, jz);
        if (jLen <= 1e-12) continue;
        const dot = (jx / jLen) * nbx + (jy / jLen) * nby + (jz / jLen) * nbz;
        if (dot >= cosThresh) {
          sx += jx;
          sy += jy;
          sz += jz;
        }
      }
      const sLen = Math.hypot(sx, sy, sz);
      if (sLen > 1e-12) {
        outNormals[vi * 3] = sx / sLen;
        outNormals[vi * 3 + 1] = sy / sLen;
        outNormals[vi * 3 + 2] = sz / sLen;
      } else {
        outNormals[vi * 3] = nbx;
        outNormals[vi * 3 + 1] = nby;
        outNormals[vi * 3 + 2] = nbz;
      }
    }
  }

  geo.setAttribute("normal", new THREE.BufferAttribute(outNormals, 3));
}

const smoothedShoulderGeos = new WeakSet<THREE.BufferGeometry>();

/**
 * Smooth harsh 1-bone skin-weight transitions across Spine2 <-> Shoulder <-> UpperArm
 * so tailored suit jacket sleeves & shoulder pads bend naturally without pinching.
 */
function smoothSuitShoulderWeights(model: THREE.Group) {
  model.traverse((o) => {
    const sm = o as THREE.SkinnedMesh;
    if (!sm.isSkinnedMesh || !sm.skeleton) return;
    const mat = (Array.isArray(sm.material) ? sm.material[0] : sm.material) as THREE.MeshStandardMaterial | undefined;
    if (mat && /head|face|skin|opacity|hair|knife|pistol|tools|visor/i.test(mat.name || "")) return;

    const geo = sm.geometry;
    if (smoothedShoulderGeos.has(geo)) return;
    smoothedShoulderGeos.add(geo);

    const pos = geo.getAttribute("position");
    const jAttr = geo.getAttribute("skinIndex");
    const wAttr = geo.getAttribute("skinWeight");
    if (!pos || !jAttr || !wAttr) return;

    const bones = sm.skeleton.bones;
    const targetBones = new Set<number>();
    bones.forEach((b, i) => {
      if (/(Spine1|Spine2|LeftShoulder|RightShoulder|LeftArm|RightArm)$/i.test(b.name.replace(/^mixamorig:?/, ""))) {
        targetBones.add(i);
      }
    });
    if (targetBones.size < 3) return;

    const vCount = pos.count;
    const boneCount = bones.length;

    // Weld vertices sharing identical object-space coordinates so UV seams smooth uniformly
    const weldMap = new Map<string, number>();
    const vertGroup = new Int32Array(vCount);
    let groupCount = 0;
    for (let i = 0; i < vCount; i++) {
      const k = `${Math.round(pos.getX(i) * 2000)},${Math.round(pos.getY(i) * 2000)},${Math.round(pos.getZ(i) * 2000)}`;
      let g = weldMap.get(k);
      if (g === undefined) {
        g = groupCount++;
        weldMap.set(k, g);
      }
      vertGroup[i] = g;
    }

    // Build topological adjacency between welded vertex groups
    const neighbors: Set<number>[] = Array.from({ length: groupCount }, () => new Set<number>());
    const idx = geo.index;
    const triCount = idx ? Math.floor(idx.count / 3) : Math.floor(vCount / 3);
    for (let t = 0; t < triCount; t++) {
      const a = idx ? idx.getX(t * 3) : t * 3;
      const b = idx ? idx.getX(t * 3 + 1) : t * 3 + 1;
      const c = idx ? idx.getX(t * 3 + 2) : t * 3 + 2;
      const ga = vertGroup[a];
      const gb = vertGroup[b];
      const gc = vertGroup[c];
      if (ga !== gb) {
        neighbors[ga].add(gb);
        neighbors[gb].add(ga);
      }
      if (gb !== gc) {
        neighbors[gb].add(gc);
        neighbors[gc].add(gb);
      }
      if (gc !== ga) {
        neighbors[gc].add(ga);
        neighbors[ga].add(gc);
      }
    }

    // Identify vertex groups anchored in the torso-clavicle-upper-arm shoulder region
    const activeGroup = new Uint8Array(groupCount);
    let weights = new Float32Array(groupCount * boneCount);
    const counts = new Float32Array(groupCount);
    for (let i = 0; i < vCount; i++) {
      const g = vertGroup[i];
      counts[g] += 1;
      let targetSum = 0;
      for (let c = 0; c < 4; c++) {
        const bi = jAttr.getComponent(i, c);
        const w = wAttr.getComponent(i, c);
        if (bi >= 0 && bi < boneCount && w > 0) {
          weights[g * boneCount + bi] += w;
          if (targetBones.has(bi)) targetSum += w;
        }
      }
      if (targetSum > 0.72) activeGroup[g] = 1;
    }
    for (let g = 0; g < groupCount; g++) {
      const c = Math.max(1, counts[g]);
      for (let b = 0; b < boneCount; b++) weights[g * boneCount + b] /= c;
    }

    // 3 passes of gentle Laplacian weight diffusion restricted to the shoulder/sleeve band
    const alpha = 0.34;
    let nextWeights = new Float32Array(weights.length);
    for (let pass = 0; pass < 3; pass++) {
      nextWeights.set(weights);
      for (let g = 0; g < groupCount; g++) {
        if (!activeGroup[g]) continue;
        const nb = neighbors[g];
        if (nb.size === 0) continue;
        let nonTarget = 0;
        for (let b = 0; b < boneCount; b++) {
          if (!targetBones.has(b)) nonTarget += weights[g * boneCount + b];
        }
        if (nonTarget > 0.25) continue;

        const base = g * boneCount;
        let nbValid = 0;
        const avg = new Float32Array(boneCount);
        for (const ng of nb) {
          if (!activeGroup[ng]) continue;
          nbValid++;
          const nBase = ng * boneCount;
          for (let b = 0; b < boneCount; b++) avg[b] += weights[nBase + b];
        }
        if (nbValid === 0) continue;
        let sum = 0;
        for (let b = 0; b < boneCount; b++) {
          const blended = weights[base + b] * (1 - alpha) + (avg[b] / nbValid) * alpha;
          nextWeights[base + b] = blended;
          sum += blended;
        }
        if (sum > 1e-5) {
          for (let b = 0; b < boneCount; b++) nextWeights[base + b] /= sum;
        }
      }
      const tmp = weights;
      weights = nextWeights;
      nextWeights = tmp;
    }

    const outJ = new Uint16Array(vCount * 4);
    const outW = new Float32Array(vCount * 4);
    for (let i = 0; i < vCount; i++) {
      const g = vertGroup[i];
      if (!activeGroup[g]) {
        let s = 0;
        for (let c = 0; c < 4; c++) {
          outJ[i * 4 + c] = jAttr.getComponent(i, c);
          outW[i * 4 + c] = wAttr.getComponent(i, c);
          s += outW[i * 4 + c];
        }
        if (s > 1e-5) {
          for (let c = 0; c < 4; c++) outW[i * 4 + c] /= s;
        }
        continue;
      }
      const base = g * boneCount;
      const top: [number, number][] = [];
      for (let b = 0; b < boneCount; b++) {
        const w = weights[base + b];
        if (w > 0.005) top.push([b, w]);
      }
      top.sort((a, b) => b[1] - a[1]);
      const pick = top.slice(0, 4);
      let s = pick.reduce((acc, p) => acc + p[1], 0);
      if (s <= 1e-5) s = 1;
      for (let c = 0; c < 4; c++) {
        outJ[i * 4 + c] = pick[c]?.[0] ?? 0;
        outW[i * 4 + c] = pick[c] ? pick[c][1] / s : 0;
      }
    }
    geo.setAttribute("skinIndex", new THREE.BufferAttribute(outJ, 4));
    geo.setAttribute("skinWeight", new THREE.BufferAttribute(outW, 4));
  });
}

export function loadCachedSoldierGltf(url: string, onProgress?: (p: number) => void): Promise<GLTF> {
  let promise = cachedGltfMap.get(url);
  if (!promise) {
    promise = MeshoptDecoder.ready
      .then(() =>
        getSoldierLoader().loadAsync(url, (e) => {
          if (e.total) onProgress?.(e.loaded / e.total);
        }),
      )
      .then((gltf) => {
        gltf.scene.traverse((o) => {
          const m = o as THREE.Mesh;
          if (m.isMesh && m.geometry) {
            upgradeQuantizedCharacterNormals(m.geometry, 56);
          }
        });
        return gltf;
      });
    cachedGltfMap.set(url, promise);
  } else {
    onProgress?.(1);
  }
  return promise;
}

/* ------------------------------------------------------------------ */
/*  Public types                                                       */
/* ------------------------------------------------------------------ */
export interface RigEvents {
  onShot?: (muzzle: THREE.Vector3, kick: number) => void;
  onDry?: () => void;
  onFootstep?: (side: 0 | 1, intensity: number) => void;
  onReloadEvent?: (kind: "magout" | "magin" | "bolt" | "drop" | "start") => void;
  onLand?: (intensity: number) => void;
  onHit?: () => void;
  onDeath?: () => void;
  onEject?: (pos: THREE.Vector3, dir: THREE.Vector3) => void;
  onMeleeSwing?: (move: MeleeMoveDef) => void;
}

export interface RigInput {
  move: THREE.Vector3; // world-space desired direction (len 0..1)
  sprint: boolean;
  crouch: boolean;
  ads: boolean;
  lean: number; // -1 (right) .. 1 (left)
}

export type RigStatus = "Idle" | "Walking" | "Running" | "Sprinting" | "Crouching" | "Crouch-walk" | "Airborne" | "Reloading" | "Aiming" | "Hit" | "Dead";

type Side = "Left" | "Right";
const FINGERS = ["Thumb", "Index", "Middle", "Ring", "Pinky"] as const;
const SEG: Record<string, number[]> = {
  Thumb: [0.35, 0.55, 0.7],
  Index: [0.95, 1.15, 0.75],
  Middle: [1.0, 1.2, 0.8],
  Ring: [1.05, 1.2, 0.8],
  Pinky: [1.1, 1.2, 0.8],
};

const WS = 0.86; // weapon scale
export const MAG_SIZE = 30;
const FIRE_INTERVAL = 60 / 700;
const RELOAD_TIME = 2.9;

const AXIS_Y = new THREE.Vector3(0, 1, 0);

interface HandBind {
  f0: THREE.Vector3;
  p0: THREE.Vector3;
  bindQ: THREE.Quaternion;
  fingers: Record<string, { bone: THREE.Object3D; bindLocal: THREE.Quaternion; axis: THREE.Vector3 }[]>;
}

interface HandKey {
  t: number;
  space: "w" | "c";
  pos: THREE.Vector3;
  f: THREE.Vector3;
  p: THREE.Vector3;
  curl: number;
}

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

/* Left-hand orientation presets (weapon-local) */
const LF_GRIP = { f: V(-0.5, 0.3, 0.8), p: V(0.15, 1, 0) };
const LF_MAG = { f: V(-0.3, 0.25, 1), p: V(-1, 0, 0.1) };
const LF_CHARGE = { f: V(-0.85, -0.1, 0.45), p: V(0, -1, 0) };

const hk = (t: number, space: "w" | "c", pos: THREE.Vector3, o: { f: THREE.Vector3; p: THREE.Vector3 }, curl: number): HandKey => ({
  t,
  space,
  pos,
  f: o.f,
  p: o.p,
  curl,
});

const RELOAD_KEYS: HandKey[] = [
  hk(0.0, "w", RIFLE.leftPalm, LF_GRIP, 0.9),
  hk(0.3, "w", V(0.13, -0.08, 0.12), LF_MAG, 0.1),
  hk(0.55, "w", V(0.034, -0.085, 0.115), LF_MAG, 0.85),
  hk(0.62, "w", V(0.034, -0.085, 0.115), LF_MAG, 0.95),
  hk(0.85, "w", V(0.034, -0.3, 0.125), LF_MAG, 0.95),
  hk(1.05, "w", V(0.3, -0.4, 0.18), LF_MAG, 0.3),
  hk(1.3, "c", V(0.14, -0.1, 0.17), LF_MAG, 0.15),
  hk(1.42, "c", V(0.14, -0.1, 0.17), LF_MAG, 0.95),
  hk(1.72, "w", V(0.034, -0.3, 0.115), LF_MAG, 0.95),
  hk(1.95, "w", V(0.034, -0.085, 0.115), LF_MAG, 0.95),
  hk(2.1, "w", V(0.034, -0.075, 0.115), LF_MAG, 0.95),
  hk(2.28, "w", V(0.07, 0.19, -0.02), LF_CHARGE, 0.55),
  hk(2.42, "w", V(0.025, 0.2, -0.02), LF_CHARGE, 0.85),
  hk(2.55, "w", V(0.025, 0.2, -0.085), LF_CHARGE, 0.85),
  hk(2.65, "w", V(0.07, 0.19, -0.04), LF_CHARGE, 0.5),
  hk(2.9, "w", RIFLE.leftPalm, LF_GRIP, 0.9),
];

interface DroppedProp {
  obj: THREE.Object3D;
  vel: THREE.Vector3;
  ang: THREE.Vector3;
  life: number;
  rest: boolean;
}

/* ------------------------------------------------------------------ */
export class SoldierRig {
  /** world position + yaw */
  readonly root = new THREE.Group();
  readonly fall = new THREE.Group();
  private model!: THREE.Group;
  private mixer!: THREE.AnimationMixer;
  private actions!: { idle: THREE.AnimationAction; walk: THREE.AnimationAction; run: THREE.AnimationAction };
  private bones: Record<string, THREE.Object3D> = {};
  private handBind = {} as Record<Side, HandBind>;
  private equipAlign: EquipmentAlignMap = {};
  /** bind-pose hips local position (restored each frame when clips don't animate it) */
  private bindHipsLocal = new THREE.Vector3();
  /** pre-leg-IK hips local position saved before applyLegs() so lowering never accumulates */
  private hipsPreLegLocal = new THREE.Vector3();
  /** true when a locomotion clip has a Hips position track (Mixamo mocap does, Rocketbox doesn't) */
  private hipsPosAnimated = true;
  /** true when loaded from a custom Rocketbox character GLB (baked clothing/gear, no procedural vest) */
  readonly isRocketbox: boolean;
  private modelTag = "";
  rifle: Rifle;
  private weapons = new Map<WeaponId, Rifle>();
  private weaponConfigs: Partial<Record<WeaponId, WeaponCustomConfig>> = {};
  holstered = false;
  carryingBody = false;
  carrySpeedMult = 0.62;
  weaponMagSize = MAG_SIZE;
  fireInterval = FIRE_INTERVAL;
  recoilMult = 1.0;
  crouchSpeedMult = 1.0;
  walkSpeedMult = 1.0;
  sprintSpeedMult = 1.0;
  dodgeBurstMult = 1.0;
  reloadSpeedMult = 1.0;
  sprintAllowed = true;
  isPlayer = false;
  /** optional terrain height sampler (x, z, refY) -> groundY for dual-foot slope & stair IK */
  groundSampler?: (x: number, z: number, refY: number) => number;
  private reloadDuration = RELOAD_TIME;
  /** tactical loadout parented to the rig (adds detail on top of the .glb) */
  equipment: SoldierEquipment | null = null;
  events: RigEvents = {};
  readonly combat = new HandToHandController();
  private combatTmpQ = new THREE.Quaternion();
  private combatBlendSnap: Record<string, THREE.Quaternion> = {};
  private combatLastPose: Record<string, THREE.Quaternion> = {};
  private combatLastClipId: string | null = null;
  private combatCrossfadeT = 1;
  private combatCrossfadeDur = 0.11;
  private combatLastActive = false;

  // calibrated locomotion data
  walkN = 1.4;
  runN = 4.2;
  walkStride = 1.4; // metres per cycle
  runStride = 3.0;
  private walkOff = 0;
  private runOff = 0;
  private phase = 0;
  private cum = 0;
  private idleT = 0;
  private lastFootstepAt = -10;
  height = 1.8;

  // input / intent
  input: RigInput = { move: new THREE.Vector3(), sprint: false, crouch: false, ads: false, lean: 0 };
  aimYaw = 0;
  aimPitch = 0;
  aimPoint = new THREE.Vector3(0, 1.5, 50);

  // kinematics
  vel = new THREE.Vector3();
  grounded = true;
  vy = 0;
  groundY = 0;
  stepHeight = 0.58; // max ledge height the player auto-steps up (stairs / roof lips)
  worldBound = 260;
  bodyYaw = 0;
  private turning = false;
  private sprinting = false;
  private sprintSuppressT = 0;
  private moveSign = 1;

  // smooth state
  private crouchAmt = 0;
  private aimBlend = 0;
  private sprintBlend = 0;
  private airBlend = 0;
  private locoBlend = 0;
  private runBlend = 0;
  private turnBlend = 0;
  private legOffsetS = 0;
  private moveSignSmooth = 1;
  private prevBodyYaw = 0;
  private turnLeanS = 0;
  private legDepthS = 0;
  private legLiftS = 0;
  private leanS = 0;
  private aimTimer = 0;
  private ikW = 1;
  private wYaw = 0;
  private wPitch = 0;
  private reloadT = -1;
  private reloadFlags = { out: false, drop: false, in: false, bolt: false, ammo: false };
  private fireCd = 0;
  private hitT = 0;

  // springs
  private sRecoilRot = new Spring(260, 18);
  private sRecoilPos = new Spring(300, 20);
  private sRecoilYaw = new Spring(200, 16);
  private sTorsoKick = new Spring(180, 16);
  private sLand = new Spring(190, 16);
  private sHitP = new Spring(130, 9);
  private sHitR = new Spring(130, 9);
  private sHitT = new Spring(130, 9);
  private sArmL = new Spring(40, 4);
  private sArmR = new Spring(40, 4);
  private sHead = new Spring(40, 5);

  // ammo
  mag = MAG_SIZE;
  reserve = 120;

  // death
  dead = false;
  private deathKind: "back" | "front" = "back";
  private deathT = 0;
  private deathTwistSign = 1;
  private fallAng = 0;
  private weaponAttached = true;
  private weaponProp: DroppedProp | null = null;
  private props: DroppedProp[] = [];
  private scene: THREE.Object3D;

  // enhanced procedural & easing motion
  private motionNoise = new OrganicMotionNoise(Math.random() * 1000);
  private takedownAnim = new TakedownAnimator();
  private drawAnim = new DrawAnimator();
  private footIk: FootPlacementState = { liftL: 0, liftR: 0, hipDrop: 0 };
  private footLiftLS = 0;
  private footLiftRS = 0;
  private footPosTmpL = new THREE.Vector3();
  private footPosTmpR = new THREE.Vector3();
  private curTakedownPose: TakedownPose = {
    active: false,
    torsoYaw: 0,
    torsoPitch: 0,
    rForward: 0,
    rRight: 0,
    rUp: 0,
    lForward: 0,
    lRight: 0,
    lUp: 0,
    weaponHideBlend: 0,
  };
  private curDrawPose: DrawPose = { active: false, pitchOffset: 0, dropOffset: 0, rollOffset: 0 };

  status: RigStatus = "Idle";
  private tmpQ = new THREE.Quaternion();
  private tmpQ2 = new THREE.Quaternion();
  private tmpV = new THREE.Vector3();
  private time = 0;

  private constructor(scene: THREE.Object3D, isRocketbox = false) {
    this.scene = scene;
    this.isRocketbox = isRocketbox;
    this.rifle = buildRifle();
    this.rifle.group.scale.setScalar(WS);
    scene.add(this.rifle.group);
    this.weapons.set("carbine", this.rifle);
    this.root.add(this.fall);
    scene.add(this.root);
  }

  /** Remove character root and all weapon/equipment meshes and dispose GPU resources cleanly. */
  dispose() {
    const disposeTree = (obj: THREE.Object3D) => {
      obj.traverse((child) => {
        const mesh = child as THREE.Mesh;
        if (mesh.geometry) mesh.geometry.dispose();
        const mats = Array.isArray(mesh.material) ? mesh.material : mesh.material ? [mesh.material] : [];
        for (const mat of mats) {
          const m = mat as THREE.MeshStandardMaterial;
          if (m.map && !m.map.userData?.sharedPresetTex) m.map.dispose();
          if (m.emissiveMap && !m.emissiveMap.userData?.sharedPresetTex) m.emissiveMap.dispose();
          if (
            m.roughnessMap &&
            !m.roughnessMap.userData?.sharedPresetTex &&
            m.roughnessMap !== cachedDetailMaps?.fabricRoughness &&
            m.roughnessMap !== cachedDetailMaps?.skinRoughness &&
            m.roughnessMap !== cachedDetailMaps?.metalRoughness &&
            m.roughnessMap !== cachedDetailMaps?.hairRoughness
          ) {
            m.roughnessMap.dispose();
          }
          if (
            m.bumpMap &&
            !m.bumpMap.userData?.sharedPresetTex &&
            m.bumpMap !== cachedDetailMaps?.fabricRoughness &&
            m.bumpMap !== cachedDetailMaps?.skinRoughness &&
            m.bumpMap !== cachedDetailMaps?.hairBump
          ) {
            m.bumpMap.dispose();
          }
          if (m.normalMap && !m.normalMap.userData?.sharedPresetTex) m.normalMap.dispose();
          m.dispose();
        }
      });
    };
    this.scene.remove(this.root);
    disposeTree(this.root);
    for (const w of this.weapons.values()) {
      this.scene.remove(w.group);
      disposeTree(w.group);
    }
    this.weapons.clear();
    for (const p of this.props) {
      this.scene.remove(p.obj);
      disposeTree(p.obj);
    }
    this.props.length = 0;
    if (this.weaponProp) {
      this.scene.remove(this.weaponProp.obj);
      disposeTree(this.weaponProp.obj);
      this.weaponProp = null;
    }
    this.equipment = null;
  }

  /** Swap to a single weapon model (used by mission-specific enemy factions). */
  setWeaponModel(id: WeaponId) {
    if (id === "carbine") return;
    if (!this.weapons.has(id)) {
      const model = buildWeapon(id);
      model.group.scale.setScalar(WS);
      this.scene.add(model.group);
      this.weapons.set(id, model);
    }
    this.rifle.group.visible = false;
    this.rifle = this.weapons.get(id)!;
    this.rifle.group.visible = true;
  }

  /** Show/hide both character body and active weapon model together (e.g. while driving a vehicle). */
  setVisible(visible: boolean) {
    this.root.visible = visible;
    this.rifle.group.visible = visible && !this.holstered;
  }

  /** Holster or draw the active weapon cleanly. */
  setHolstered(holstered: boolean) {
    const wasHolstered = this.holstered;
    this.holstered = holstered;
    if (holstered) {
      this.reloadT = -1;
      this.rifle.mag.position.copy(this.rifle.magRest);
      this.rifle.mag.visible = true;
      this.rifle.group.visible = false;
      this.combat.combatStanceTimer = Math.max(this.combat.combatStanceTimer, 1.4);
    } else {
      this.combat.setBlocking(false);
      this.rifle.group.visible = this.root.visible && !this.dead;
      this.aimTimer = Math.max(this.aimTimer, 1.5);
      if (wasHolstered) this.drawAnim.trigger();
    }
  }

  /** Trigger a hand-to-hand punch combo strike (`heavy=false`) or heavy kick (`heavy=true`). */
  triggerMelee(heavy = false): MeleeMoveDef | null {
    if (this.dead || this.carryingBody) return null;
    this.reloadT = -1;
    this.aimTimer = Math.max(this.aimTimer, 1.8);
    const started = this.combat.requestAttack(heavy);
    if (started) {
      this.events.onMeleeSwing?.(started);
      this.applyMeleeLunge(started);
    }
    return started;
  }

  /** Trigger a wrestling / grappling maneuver (clinch grab, double-leg, clinch knee, slam, choke). */
  triggerGrappleMove(
    moveId: "grapple_grab" | "takedown_double_leg" | "clinch_knee" | "suplex_slam" | "submission_choke",
  ): MeleeMoveDef | null {
    if (this.dead || this.carryingBody) return null;
    this.reloadT = -1;
    this.aimTimer = Math.max(this.aimTimer, 2.0);
    const started = this.combat.requestGrappleMove(moveId);
    if (started) {
      this.events.onMeleeSwing?.(started);
      this.applyMeleeLunge(started);
    }
    return started;
  }

  /** Hold or release unarmed hand-to-hand boxing guard / timed parry. */
  setCombatBlock(held: boolean) {
    const active = held && this.holstered && !this.dead && !this.carryingBody;
    this.combat.setBlocking(active);
  }

  /** Trigger an evasive combat slip/dodge with brief i-frames. */
  triggerDodge(dirX: number, dirZ: number): boolean {
    if (this.dead || this.carryingBody) return false;
    const ok = this.combat.triggerDodge(dirX, dirZ);
    if (ok) {
      this.vel.x = this.combat.dodgeDirX * 7.2 * this.dodgeBurstMult;
      this.vel.z = this.combat.dodgeDirZ * 7.2 * this.dodgeBurstMult;
    }
    return ok;
  }

  /** Apply physical knockback impulse from a melee impact. */
  applyKnockback(vx: number, vz: number) {
    if (this.dead) return;
    this.vel.x += vx;
    this.vel.z += vz;
  }

  private applyMeleeLunge(move: MeleeMoveDef) {
    const spd = move.lungeSpeed * 0.55;
    this.vel.x = Math.sin(this.aimYaw) * spd;
    this.vel.z = Math.cos(this.aimYaw) * spd;
  }

  /** Apply per-weapon modular customization across all built weapon meshes. */
  setWeaponConfigs(configs?: Partial<Record<WeaponId, WeaponCustomConfig>>) {
    if (configs) this.weaponConfigs = { ...configs };
    for (const [id, w] of this.weapons.entries()) {
      const cfg = this.weaponConfigs[id] ?? DEFAULT_WEAPON_CONFIGS[id];
      applyWeaponCustomization(w, cfg);
    }
  }

  /** Pre-build all 4 player weapon models for instant 0ms switching. */
  initArsenal() {
    for (const w of WEAPONS) {
      if (this.weapons.has(w.id)) continue;
      const model = buildWeapon(w.id);
      model.group.scale.setScalar(WS);
      model.group.visible = false;
      applyWeaponCustomization(model, this.weaponConfigs[w.id] ?? DEFAULT_WEAPON_CONFIGS[w.id]);
      this.scene.add(model.group);
      this.weapons.set(w.id, model);
    }
  }

  equipWeapon(
    spec: WeaponSpec,
    magVal: number,
    reserveVal: number,
    flashObj?: THREE.Object3D,
    opts?: { magSize?: number; rpmMult?: number; recoilMult?: number },
  ) {
    const next = this.weapons.get(spec.id);
    if (!next) return;
    this.reloadT = -1;
    this.rifle.mag.position.copy(this.rifle.magRest);
    this.rifle.mag.visible = true;
    this.rifle.group.visible = false;
    this.rifle = next;
    applyWeaponCustomization(this.rifle, this.weaponConfigs[spec.id] ?? DEFAULT_WEAPON_CONFIGS[spec.id]);
    this.rifle.group.visible = this.root.visible && !this.holstered;
    this.rifle.mag.visible = true;
    if (flashObj) this.rifle.muzzle.add(flashObj);
    this.weaponMagSize = opts?.magSize ?? spec.magSize;
    this.fireInterval = 60 / (spec.rpm * (opts?.rpmMult ?? 1));
    this.recoilMult = spec.recoil * (opts?.recoilMult ?? 1);
    this.mag = magVal;
    this.reserve = reserveVal;
    this.reloadDuration = spec.reloadTime;
    this.fireCd = 0.16;
    this.aimTimer = Math.max(this.aimTimer, 2.2);
    this.sRecoilRot.kick(0.9);
    this.drawAnim.trigger();
  }

  /** Trigger a close-quarters melee / takedown lunge animation. */
  triggerTakedown() {
    if (this.dead) return;
    this.reloadT = -1;
    this.aimTimer = Math.max(this.aimTimer, 1.4);
    this.takedownAnim.trigger();
  }

  /* ---------------------------------------------------------------- */
  /*  Loading + calibration                                            */
  /* ---------------------------------------------------------------- */
  static async load(
    scene: THREE.Object3D,
    onProgress?: (p: number) => void,
    modelUrl?: string,
  ): Promise<SoldierRig> {
    void preloadCombatAnimations();
    let url = modelUrl ?? soldierUrl;
    if (url === "vanguard" || /\/vanguard\.glb$/i.test(url)) {
      url = soldierUrl;
    }
    if (isFighterUrl(url)) {
      const [fighterBuilt, donorGltf] = await Promise.all([
        assembleShirtlessFighter(parseFighterUrl(url), onProgress),
        loadCachedSoldierGltf(soldierUrl),
      ]);
      const rig = new SoldierRig(scene, false);
      rig.modelTag = url;
      rig.isCC0Fighter = true;
      rig.setup(fighterBuilt, url, donorGltf);
      return rig;
    }
    let isRocketbox = !!url && url !== soldierUrl;
    let gltf: GLTF;
    try {
      gltf = await loadCachedSoldierGltf(url, onProgress);
    } catch {
      url = soldierUrl;
      isRocketbox = false;
      gltf = await loadCachedSoldierGltf(url, onProgress);
    }
    const rig = new SoldierRig(scene, isRocketbox);
    rig.modelTag = url;
    const clonedScene = SkeletonUtils.clone(gltf.scene) as THREE.Group;
    rig.setup({ scene: clonedScene, animations: gltf.animations }, url);
    return rig;
  }

  private isCC0Fighter = false;

  private setup(
    gltf: { scene: THREE.Group; animations: THREE.AnimationClip[] },
    cacheKey?: string,
    donorLocoGltf?: GLTF,
  ) {
    const model = gltf.scene;
    this.model = model;
    // Standard Mixamo/Rocketbox assets face -Z; CC0 MakeHuman fighters already face +Z
    model.rotation.y = this.isCC0Fighter ? 0 : Math.PI;
    this.fall.add(model);

    model.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) {
        m.castShadow = true;
        m.receiveShadow = true;
        m.frustumCulled = false;
        m.userData.sharedGltfAsset = true;
        const origMats = Array.isArray(m.material) ? m.material : [m.material];
        const clonedMats = origMats.map((mat) => upgradeCharacterMaterial(mat));
        m.material = Array.isArray(m.material) ? clonedMats : clonedMats[0];
      }
      const canon = canonicalizeBoneName(o.name);
      if (canon && !this.bones[canon]) {
        this.bones[canon] = o;
      }
    });

    if (this.isRocketbox) matchRocketboxHandSkinTone(model);
    if (!this.isCC0Fighter) smoothSuitShoulderWeights(model);

    // normalise height to ~1.82m
    model.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(model);
    const h = box.max.y - box.min.y;
    if (h > 0.2) {
      const s = 1.82 / h;
      model.scale.multiplyScalar(s);
    }
    model.updateMatrixWorld(true);
    this.height = 1.82;

    this.captureBind();

    // attach the tactical loadout to the spine so it follows the animations;
    // shirtless pit fighters skip military packs/chest rigs
    if (!this.isCC0Fighter) {
      this.buildEquipment();
    }

    let clips = gltf.animations;
    if (clips.length === 0 && donorLocoGltf) {
      const srcClone = SkeletonUtils.clone(donorLocoGltf.scene) as THREE.Group;
      srcClone.rotation.y = Math.PI; // align donor -Z asset to +Z forward
      srcClone.updateMatrixWorld(true);
      const retargeted: THREE.AnimationClip[] = [];
      for (const name of ["Idle", "Walk", "Run"]) {
        const srcClip = donorLocoGltf.animations.find((a) => a.name === name);
        if (!srcClip) continue;
        const c = retargetAnimationClipForSkeleton(srcClone, srcClip, model, this.bones);
        if (c) retargeted.push(c);
      }
      clips = retargeted;
    }

    this.mixer = new THREE.AnimationMixer(model);
    const find = (n: string) => {
      const exact = clips.find((a) => a.name === n);
      if (exact) return exact;
      const fuzzy = clips.find((a) => a.name.toLowerCase().includes(n.toLowerCase()));
      if (fuzzy) return fuzzy;
      // last resort: reuse the first clip so a swapped model never crashes the game
      return clips[0];
    };
    this.actions = {
      idle: this.mixer.clipAction(find("Idle")),
      walk: this.mixer.clipAction(find("Walk")),
      run: this.mixer.clipAction(find("Run")),
    };
    Object.values(this.actions).forEach((a) => {
      a.setLoop(THREE.LoopRepeat, Infinity);
      a.play();
      a.setEffectiveWeight(0);
    });
    this.actions.idle.setEffectiveWeight(1);
    // does any clip animate the hips position? (decides whether applyLegs
    // must restore the bind offset before lowering — see captureBind)
    this.hipsPosAnimated = clips.some((c) =>
      c.tracks.some((t) => t.name.includes("Hips.position")),
    );
    this.calibrate(this.isCC0Fighter ? "fighter://cc0" : cacheKey);
    this.mixer.update(0);
    model.updateMatrixWorld(true);
  }

  private captureBind() {
    // remember the bind hips offset: applyLegs() lowers hips every frame, and
    // if no clip animates hips position the mixer never resets it — without
    // restoring the bind offset the lowering would accumulate and sink the
    // character through the ground (Rocketbox clips have no pelvis position
    // tracks; Mixamo clips do).
    this.bindHipsLocal.copy(this.bones.Hips.position);
    this.hipsPreLegLocal.copy(this.bindHipsLocal);
    const modelQInv = this.model.getWorldQuaternion(new THREE.Quaternion()).invert();
    (["Left", "Right"] as Side[]).forEach((side) => {
      const hand = this.bones[`${side}Hand`];
      const mid = this.bones[`${side}HandMiddle1`] ?? this.bones[`${side}HandMiddle`];
      const hp = hand.getWorldPosition(new THREE.Vector3());
      const mp = mid.getWorldPosition(new THREE.Vector3());
      const f0World = mp.sub(hp).normalize();
      const idxBone = this.bones[`${side}HandIndex1`] ?? this.bones[`${side}HandIndex`];
      const pnkBone = this.bones[`${side}HandPinky1`] ?? this.bones[`${side}HandPinky`];
      const p0World = new THREE.Vector3(0, -1, 0);
      if (idxBone && pnkBone) {
        const across = idxBone
          .getWorldPosition(new THREE.Vector3())
          .sub(pnkBone.getWorldPosition(new THREE.Vector3()));
        p0World.crossVectors(f0World, across);
        if (side === "Right") p0World.negate();
        if (p0World.lengthSq() < 1e-6) p0World.set(0, -1, 0);
      }
      p0World.sub(f0World.clone().multiplyScalar(p0World.dot(f0World))).normalize();
      const f0 = f0World.clone().applyQuaternion(modelQInv);
      const p0 = p0World.clone().applyQuaternion(modelQInv);
      const bindQ = modelQInv.clone().multiply(hand.getWorldQuaternion(new THREE.Quaternion()));
      const fingers: HandBind["fingers"] = {};
      FINGERS.forEach((fn) => {
        // Finger chains differ per rig: Mixamo has 4 numbered segments (1-4),
        // Rocketbox/Bip01 has an unnumbered base + 2 numbered segments.
        const numbered = [1, 2, 3, 4]
          .map((i) => this.bones[`${side}Hand${fn}${i}`])
          .filter((b): b is THREE.Object3D => !!b);
        const base = this.bones[`${side}Hand${fn}`];
        const chain = base ? [base, ...numbered] : numbered;
        fingers[fn] = chain.slice(0, 3).map((b, idx) => {
          const bp = b.getWorldPosition(new THREE.Vector3());
          const next = chain[idx + 1];
          let dir: THREE.Vector3;
          if (next) {
            dir = next.getWorldPosition(new THREE.Vector3()).sub(bp).normalize();
          } else {
            const prev = chain[idx - 1];
            dir = prev
              ? bp.clone().sub(prev.getWorldPosition(new THREE.Vector3())).normalize()
              : new THREE.Vector3(0, 0, 1);
          }
          const axis = new THREE.Vector3().crossVectors(dir, p0World).normalize(); // curls toward palm
          const bq = b.getWorldQuaternion(new THREE.Quaternion());
          return { bone: b, bindLocal: b.quaternion.clone(), axis: axis.applyQuaternion(bq.invert()) };
        });
      });
      this.handBind[side] = { f0, p0, bindQ, fingers };
    });

    // Compute per-bone orientation/scale mounts so tactical gear attaches cleanly
    // onto both Mixamo native and Rocketbox (Bip01) skeletons.
    const legFlipQ = new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI, 0, 0));
    const computeAlign = (bone: THREE.Object3D | undefined, targetWorldQ?: THREE.Quaternion) => {
      if (!bone) return undefined;
      const bq = bone.getWorldQuaternion(new THREE.Quaternion());
      const ws = bone.getWorldScale(new THREE.Vector3());
      const quat = bq.invert();
      if (targetWorldQ) quat.multiply(targetWorldQ);
      return { quat, scale: ws.x > 1e-4 ? 1 / ws.x : 100 };
    };
    this.equipAlign = {
      torso: computeAlign(this.bones["Spine2"] ?? this.bones["Spine"] ?? this.bones["Hips"]),
      head: computeAlign(this.bones["Head"]),
      rLeg: computeAlign(this.bones["RightUpLeg"], legFlipQ),
      lLeg: computeAlign(this.bones["LeftUpLeg"], legFlipQ),
    };
  }

  /** Attach the procedural tactical loadout directly to the skeleton bones. */
  private buildEquipment() {
    if (!this.model || this.equipment) return;
    if (this.isRocketbox) {
      const isMil = /military/i.test(this.modelTag);
      const isTac = isMil || /police|security/i.test(this.modelTag);
      if (!isTac) return;
      const eq = buildEquipment();
      eq.attach(this.bones, this.equipAlign);
      eq.configure({
        nvg: isMil ? "flipped" : "none",
        backpack: isMil,
        chestRig: false, // Rocketbox military/police already have baked torso rigs
        holster: true,
        headset: true,
      });
      this.equipment = eq;
      return;
    }
    const eq = buildEquipment();
    eq.attach(this.bones, this.equipAlign);
    this.equipment = eq;
  }

  /** Measure ground speed + phase of the walk/run clips so feet don't skate. */
  private calibrate(cacheKey?: string) {
    if (cacheKey) {
      const cached = calibratedCache.get(cacheKey);
      if (cached) {
        this.walkN = cached.walkN;
        this.runN = cached.runN;
        this.walkStride = cached.walkStride;
        this.runStride = cached.runStride;
        this.walkOff = cached.walkOff;
        this.runOff = cached.runOff;
        return;
      }
    }
    const foot = this.bones["LeftFoot"];
    const N = 96;
    const out: Record<string, { speed: number; off: number; dur: number }> = {};
    const acts: [string, THREE.AnimationAction][] = [
      ["walk", this.actions.walk],
      ["run", this.actions.run],
    ];
    for (const [name, act] of acts) {
      Object.values(this.actions).forEach((a) => a.setEffectiveWeight(0));
      act.setEffectiveWeight(1);
      const dur = act.getClip().duration;
      const ys: number[] = [];
      const zs: number[] = [];
      for (let i = 0; i < N; i++) {
        act.time = (i / N) * dur;
        this.mixer.update(0);
        this.model.updateMatrixWorld(true);
        const p = foot.getWorldPosition(this.tmpV);
        ys.push(p.y);
        zs.push(p.z);
      }
      const minY = Math.min(...ys);
      const maxY = Math.max(...ys);
      const thr = minY + 0.14 * (maxY - minY);
      let sum = 0;
      let n = 0;
      const dt = dur / N;
      for (let i = 0; i < N; i++) {
        const j = (i + 1) % N;
        if (ys[i] < thr && ys[j] < thr) {
          let dz = zs[j] - zs[i];
          sum += -dz / dt;
          n++;
        }
      }
      let speed = n > 3 ? sum / n : name === "walk" ? 1.4 : 4;
      const zmax = Math.max(...zs);
      const off = zs.indexOf(zmax) / N;
      out[name] = { speed, off, dur };
    }
    this.walkN = clamp(out.walk.speed, 0.9, 2.4);
    this.runN = clamp(out.run.speed, 2.8, 7);
    this.walkStride = this.walkN * out.walk.dur;
    this.runStride = this.runN * out.run.dur;
    this.walkOff = out.walk.off;
    this.runOff = out.run.off;
    if (cacheKey) {
      calibratedCache.set(cacheKey, {
        walkN: this.walkN,
        runN: this.runN,
        walkStride: this.walkStride,
        runStride: this.runStride,
        walkOff: this.walkOff,
        runOff: this.runOff,
      });
    }
    // eslint-disable-next-line no-console
    console.info("[SoldierRig] calibrated", { raw: [out.walk.speed, out.run.speed, out.walk.dur, out.run.dur], scale: this.model.scale.x, walkN: this.walkN, runN: this.runN, walkOff: this.walkOff, runOff: this.runOff });
  }

  /* ---------------------------------------------------------------- */
  /*  Commands                                                         */
  /* ---------------------------------------------------------------- */
  jump() {
    if (this.dead || !this.grounded || this.reloadT >= 0) return;
    this.grounded = false;
    this.vy = this.carryingBody ? 3.8 : 5.95;
    this.sLand.reset();
  }

  /** Returns true when a round left the barrel. */
  fire(): boolean {
    if (this.dead || this.holstered || this.carryingBody || this.reloadT >= 0) return false;
    if (this.fireCd > 0) return false;
    // Break sprint immediately when firing so sprint-to-fire responds without dropping inputs
    this.sprintSuppressT = 0.35;
    this.sprinting = false;
    if (this.sprintBlend > 0.55 || this.aimBlend < 0.38) {
      this.aimTimer = 3;
      return false;
    }
    if (this.mag <= 0) {
      this.fireCd = 0.25;
      this.events.onDry?.();
      return false;
    }
    this.mag--;
    // Scheduled fire clock: carry sub-frame remainder so RPM stays exact across 30/60/144 FPS
    this.fireCd = (this.fireCd > -this.fireInterval ? this.fireCd : 0) + this.fireInterval;
    this.aimTimer = 3;
    const r = () => Math.random() - 0.5;
    const ads = (this.input.ads ? 0.6 : 1) * this.recoilMult;
    this.sRecoilRot.kick((3.4 + r() * 1.2) * ads);
    this.sRecoilPos.kick(0.8 * ads);
    this.sRecoilYaw.kick(r() * 1.8 * ads);
    this.sTorsoKick.kick(1.0 * ads);
    this.sHead.kick(-0.5);
    this.rifle.group.updateMatrixWorld(true);
    const m = this.rifle.muzzle.getWorldPosition(new THREE.Vector3());
    this.events.onShot?.(m, ads);
    // eject a casing
    const q = this.rifle.group.getWorldQuaternion(new THREE.Quaternion());
    const ep = this.rifle.eject.getWorldPosition(new THREE.Vector3());
    const dir = new THREE.Vector3(1, 0.7, -0.2 + r() * 0.3).normalize().applyQuaternion(q);
    this.events.onEject?.(ep, dir);
    return true;
  }

  reload() {
    if (this.dead || this.holstered || this.carryingBody || this.reloadT >= 0 || this.mag >= this.weaponMagSize || this.reserve <= 0) return false;
    this.reloadT = 0;
    this.reloadFlags = { out: false, drop: false, in: false, bolt: false, ammo: false };
    this.aimTimer = Math.max(this.aimTimer, this.reloadDuration + 1);
    this.events.onReloadEvent?.("start");
    return true;
  }

  get isReloading() {
    return this.reloadT >= 0;
  }
  get isSprinting() {
    return this.sprinting;
  }
  get reloadProgress() {
    return this.reloadT < 0 ? 0 : this.reloadT / RELOAD_TIME;
  }
  get speed() {
    return Math.hypot(this.vel.x, this.vel.z);
  }
  get eyeHeight() {
    return 1.62 - this.crouchAmt * 0.42 - this.sLand.x;
  }

  /** direction: angle (rad) relative to the character's facing the hit came from (0 = from the front) */
  hit(angle = 0) {
    if (this.dead) return;
    this.hitT = 0.55;
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    this.sHitP.kick(-c * 5.5);
    this.sHitR.kick(s * 4.5);
    this.sHitT.kick((Math.random() - 0.5) * 7);
    this.sRecoilRot.kick(3);
    this.sArmL.kick(-6 * Math.random());
    this.sArmR.kick(6 * Math.random());
    this.sHead.kick(-c * 3);
    this.events.onHit?.();
  }

  die(kind: "back" | "front" = "back") {
    if (this.dead) return;
    this.dead = true;
    this.deathKind = kind;
    this.deathT = 0;
    this.deathTwistSign = Math.random() > 0.5 ? 1 : -1;
    this.fallAng = 0;
    this.reloadT = -1;
    this.takedownAnim.reset();
    this.drawAnim.reset();
    this.vel.multiplyScalar(0.6);
    this.sArmL.kick(-14);
    this.sArmR.kick(14);
    this.sHead.kick(kind === "back" ? -5 : 4);
    // drop weapon
    this.weaponAttached = false;
    const wp = this.rifle.group;
    const fwd = new THREE.Vector3(Math.sin(this.bodyYaw), 0, Math.cos(this.bodyYaw));
    this.weaponProp = {
      obj: wp,
      vel: fwd.clone().multiplyScalar(kind === "back" ? -0.4 : 1.3).add(new THREE.Vector3(0.6 * (Math.random() - 0.5), 1.6, 0)),
      ang: new THREE.Vector3(Math.random() * 4 - 2, Math.random() * 3 - 1.5, Math.random() * 5 - 2.5),
      life: 1e9,
      rest: false,
    };
    this.events.onDeath?.();
  }

  respawn(pos?: THREE.Vector3) {
    this.dead = false;
    this.deathT = 0;
    this.fallAng = 0;
    this.fall.rotation.set(0, 0, 0);
    this.fall.position.set(0, 0, 0);
    this.root.visible = true;
    this.fall.visible = true;
    if (this.model) this.model.visible = true;
    if (this.bones.Hips) {
      this.bones.Hips.position.copy(this.bindHipsLocal);
      this.hipsPreLegLocal.copy(this.bindHipsLocal);
    }
    if (pos) this.root.position.copy(pos);
    else this.root.position.y = 0;
    this.vel.set(0, 0, 0);
    this.vy = 0;
    this.grounded = true;
    this.groundY = pos ? pos.y : 0;
    this.hitT = 0;
    this.mag = MAG_SIZE;
    this.reserve = 120;
    this.weaponAttached = true;
    this.weaponProp = null;
    this.holstered = false;
    this.carryingBody = false;
    this.rifle.group.position.set(0, 0, 0);
    this.rifle.group.rotation.set(0, 0, 0);
    this.rifle.group.scale.setScalar(WS);
    this.rifle.group.visible = this.root.visible;
    this.rifle.mag.position.copy(this.rifle.magRest);
    this.rifle.mag.rotation.set(0, 0, 0);
    this.rifle.mag.visible = true;
    this.rifle.group.add(this.rifle.mag);
    this.reloadT = -1;
    this.takedownAnim.reset();
    this.drawAnim.reset();
    this.footIk = { liftL: 0, liftR: 0, hipDrop: 0 };
    this.footLiftLS = 0;
    this.footLiftRS = 0;
    [this.sRecoilRot, this.sRecoilPos, this.sRecoilYaw, this.sTorsoKick, this.sLand, this.sHitP, this.sHitR, this.sHitT, this.sArmL, this.sArmR, this.sHead].forEach((s) => s.reset());
    this.ikW = 0;
    this.aimTimer = 0;
    this.crouchAmt = 0;
    this.locoBlend = 0;
    this.runBlend = 0;
    this.turnBlend = 0;
    this.legOffsetS = 0;
    this.moveSignSmooth = 1;
    this.turnLeanS = 0;
    this.legDepthS = 0;
    this.legLiftS = 0;
    this.prevBodyYaw = this.bodyYaw;
    if (this.actions) {
      this.actions.idle.setEffectiveWeight(1);
      this.actions.walk.setEffectiveWeight(0);
      this.actions.run.setEffectiveWeight(0);
      this.mixer.update(0);
    }
    this.model?.updateMatrixWorld(true);
  }

  /* ---------------------------------------------------------------- */
  /*  Frame update                                                     */
  /* ---------------------------------------------------------------- */
  update(dtRaw: number, groundY = 0) {
    if (!this.model) return;
    const dt = Math.min(dtRaw, 1 / 20);
    this.time += dt;
    this.fireCd = Math.max(-this.fireInterval, this.fireCd - dt);
    this.hitT = Math.max(0, this.hitT - dt);
    this.sprintSuppressT = Math.max(0, this.sprintSuppressT - dt);

    const comboStarted = this.combat.update(dt, this.holstered && !this.carryingBody && !this.dead);
    if (comboStarted) {
      this.events.onMeleeSwing?.(comboStarted);
      this.applyMeleeLunge(comboStarted);
    }

    this.groundY = groundY;
    this.updateLocomotion(dt);
    this.updateAnimBase(dt);
    this.model.updateMatrixWorld(true);
    this.updateProcedural(dt);
    this.updateProps(dt);
    this.tickReload(dt);
    this.updateStatus();
  }

  private getEffectiveWalkSpeed(): number {
    return (this.isPlayer ? Math.max(this.walkN * 2.1, 3.2) : this.walkN) * this.walkSpeedMult;
  }

  private getEffectiveRunSpeed(): number {
    return (this.isPlayer ? Math.max(this.runN * 1.65, 7.6) : this.runN) * this.sprintSpeedMult;
  }

  private updateLocomotion(dt: number) {
    const inp = this.input;
    const combatCanMove = this.combat.canMoveFreely;
    const wantMove = !this.dead && combatCanMove && inp.move.lengthSq() > 0.0004;
    const walkSpd = this.getEffectiveWalkSpeed();
    const runSpd = this.getEffectiveRunSpeed();
    const adsWalkSpd = walkSpd * 0.72;
    // Tactical combat advance when holding Sprint while Aiming: faster than walking, slower than full sprint
    const adsSprintSpd = lerp(walkSpd, runSpd, 0.36);

    let target = 0;
    let rel = 0;
    let psi = this.aimYaw;
    const dir = new THREE.Vector3();
    if (wantMove) {
      dir.copy(inp.move).setY(0).normalize();
      psi = Math.atan2(dir.x, dir.z);
      rel = wrapAngle(psi - this.aimYaw);
      const sprintOK =
        inp.sprint &&
        this.sprintAllowed &&
        this.sprintSuppressT <= 0 &&
        !inp.crouch &&
        !inp.ads &&
        !this.carryingBody &&
        !this.combat.isBusy &&
        !this.combat.blocking &&
        Math.abs(rel) < (this.isPlayer ? 1.55 : 1.15) &&
        this.reloadT < 0;
      this.sprinting = sprintOK;
      const adsSprintOK = inp.ads && inp.sprint && !inp.crouch && !this.carryingBody;
      const baseSpd = sprintOK
        ? runSpd
        : inp.crouch
          ? walkSpd * 0.62 * this.crouchSpeedMult
          : this.combat.blocking
            ? walkSpd * 0.58
            : this.combat.state === "attack"
              ? walkSpd * 0.48
              : adsSprintOK
                ? adsSprintSpd
                : inp.ads
                  ? adsWalkSpd
                  : walkSpd;
      target = this.carryingBody ? baseSpd * this.carrySpeedMult : baseSpd;
    } else {
      this.sprinting = false;
    }

    const freeRun = this.isPlayer && !inp.ads && this.aimBlend < 0.35 && !this.carryingBody && !this.combat.isBusy && !this.combat.blocking;
    // facing + direction of the legs relative to aim (with hysteresis to prevent 1-frame stride flips)
    let legOffset = 0;
    if (wantMove) {
      if (freeRun) {
        this.moveSign = 1;
        legOffset = 0;
      } else {
        if (this.moveSign > 0) {
          if (Math.abs(rel) > 1.85) this.moveSign = -1;
        } else if (Math.abs(rel) < 1.55) {
          this.moveSign = 1;
        }
        const maxLeg = inp.ads ? 0.95 : 1.25;
        if (this.moveSign > 0) {
          legOffset = clamp(rel, -maxLeg, maxLeg);
        } else {
          legOffset = clamp(wrapAngle(rel - Math.PI), -maxLeg, maxLeg);
        }
      }
    }
    this.legOffsetS = damp(this.legOffsetS, legOffset, this.isPlayer ? 18 : 10, dt);
    this.moveSignSmooth = damp(this.moveSignSmooth, this.moveSign, this.isPlayer ? 24 : 13, dt);

    const desired = dir.multiplyScalar(target);
    if (this.combat.state === "dodge") {
      const dodgeSpd = 6.8 * this.dodgeBurstMult * (1 - clamp(this.combat.stateTime / Math.max(0.1, this.combat.stateDuration), 0, 1) * 0.55);
      desired.set(this.combat.dodgeDirX * dodgeSpd, 0, this.combat.dodgeDirZ * dodgeSpd);
    } else if (this.combat.state === "attack" && this.combat.currentMove) {
      const m = this.combat.currentMove;
      if (this.combat.stateTime < m.startup + m.active * 0.6) {
        const lunge = m.lungeSpeed * 0.45;
        desired.x += Math.sin(this.aimYaw) * lunge;
        desired.z += Math.cos(this.aimYaw) * lunge;
      }
    }
    const rate =
      this.combat.state === "dodge"
        ? 22
        : !combatCanMove
          ? 7
          : this.grounded
            ? wantMove
              ? this.isPlayer
                ? 24
                : 15
              : this.isPlayer
                ? 28
                : 18
            : this.isPlayer
              ? 6.5
              : 3.2;
    this.vel.x = damp(this.vel.x, desired.x, rate, dt);
    this.vel.z = damp(this.vel.z, desired.z, rate, dt);
    if (!wantMove && !this.dead && this.combat.state !== "dodge" && this.combat.state !== "attack" && this.grounded && Math.hypot(this.vel.x, this.vel.z) < 0.04) {
      this.vel.x = 0;
      this.vel.z = 0;
    }
    if (this.dead) {
      this.vel.x = damp(this.vel.x, 0, 3, dt);
      this.vel.z = damp(this.vel.z, 0, 3, dt);
    }
    this.root.position.x = clamp(this.root.position.x + this.vel.x * dt, -this.worldBound, this.worldBound);
    this.root.position.z = clamp(this.root.position.z + this.vel.z * dt, -this.worldBound, this.worldBound);

    // vertical
    const groundLevel = this.groundY;
    if (!this.grounded) {
      this.vy -= 16 * dt;
      this.root.position.y += this.vy * dt;
      if (this.root.position.y <= groundLevel) {
        this.root.position.y = groundLevel;
        const impact = -this.vy;
        this.grounded = true;
        this.vy = 0;
        this.sLand.kick(impact * 0.5);
        this.events.onLand?.(clamp(impact / 6, 0.2, 1));
      }
    } else {
      const dy = groundLevel - this.root.position.y;
      if (dy >= -0.005 && dy <= this.stepHeight + 0.1) {
        // walking flat, up a smooth stair ramp, or stepping onto a low ledge
        if (dy <= 0.14) {
          this.root.position.y = groundLevel;
        } else {
          this.root.position.y = damp(this.root.position.y, groundLevel, 28, dt);
          if (groundLevel - this.root.position.y < 0.015) this.root.position.y = groundLevel;
        }
        this.vy = 0;
      } else if (wantMove && dy < -0.005 && dy >= -0.58) {
        // walking down stairs / ramps: stay grounded and follow tread smoothly
        this.root.position.y = damp(this.root.position.y, groundLevel, 26, dt);
        if (this.root.position.y - groundLevel < 0.015) this.root.position.y = groundLevel;
        this.vy = 0;
      } else if (dy < -0.58) {
        // grounded state but surface dropped below (fell off a ledge)
        this.grounded = false;
      } else {
        this.root.position.y = groundLevel;
        this.vy = 0;
      }
    }

    // body yaw + smooth turn banking
    this.prevBodyYaw = this.bodyYaw;
    if (!this.dead) {
      const diff = wrapAngle(this.aimYaw - this.bodyYaw);
      if (wantMove) {
        const targetBodyYaw = freeRun ? psi : this.aimYaw + this.legOffsetS;
        this.bodyYaw = dampAngle(this.bodyYaw, targetBodyYaw, this.isPlayer ? 17 : 11, dt);
        this.turning = false;
      } else {
        const aiming = this.aimBlend > 0.5;
        const thr = aiming ? 0.65 : 1.15;
        if (Math.abs(diff) > thr) this.turning = true;
        if (this.turning) {
          this.bodyYaw = dampAngle(this.bodyYaw, this.aimYaw, this.isPlayer ? 11 : 7, dt);
          if (Math.abs(diff) < 0.1) this.turning = false;
        }
      }
    }
    this.turnBlend = damp(this.turnBlend, this.turning ? 1 : 0, 12, dt);
    const angVel = wrapAngle(this.bodyYaw - this.prevBodyYaw) / Math.max(dt, 1e-4);
    const targetBank = clamp(-angVel * 0.028, -0.085, 0.085) * smoothstep(0.5, 3.0, this.speed);
    this.turnLeanS = damp(this.turnLeanS, this.dead ? 0 : targetBank, 11, dt);
    this.root.rotation.y = this.bodyYaw;
  }

  private updateAnimBase(dt: number) {
    const a = this.actions;
    this.airBlend = damp(this.airBlend, this.grounded ? 0 : 1, this.grounded ? 16 : 20, dt);
    const spd = this.speed;
    const walkRef = this.getEffectiveWalkSpeed();
    const runRef = this.getEffectiveRunSpeed();
    const animSpd = this.dead ? 0 : Math.max(spd, this.turnBlend * 0.65);
    const targetLoco = this.isPlayer ? smoothstep(0.12, 0.95, animSpd) : smoothstep(0.03, 0.72, animSpd);
    this.locoBlend = damp(
      this.locoBlend,
      targetLoco,
      this.isPlayer ? (targetLoco > this.locoBlend ? 20 : 15) : targetLoco > this.locoBlend ? 11.5 : 8.5,
      dt,
    );
    const runW = clamp((animSpd - walkRef * 0.85) / Math.max(0.2, runRef - walkRef * 0.85), 0, 1);
    const runE = easeInOut(runW);
    this.runBlend = damp(this.runBlend, runE, this.isPlayer ? 14 : 8.5, dt);

    const walkStrideEff = this.isPlayer ? Math.max(this.walkStride, 1.85) : this.walkStride;
    const runStrideEff = this.isPlayer ? Math.max(this.runStride, 3.15) : this.runStride;
    const stride = lerp(walkStrideEff, runStrideEff, this.runBlend);
    if (!this.dead) {
      const airRate = lerp(1.0, 0.2, this.airBlend);
      const prevCum = this.cum;
      if (this.locoBlend > 0.02) {
        this.cum += this.moveSignSmooth * (animSpd / Math.max(stride, 0.1)) * airRate * dt;
      }
      // Gently settle stride phase toward neutral plant when stopping
      if (targetLoco < 0.05 && this.locoBlend > 0.01 && this.grounded) {
        const nearestPlant = Math.round(this.cum * 2) * 0.5;
        this.cum = damp(this.cum, nearestPlant, 11, dt);
      }
      this.phase = ((this.cum % 1) + 1) % 1;
      if (this.grounded && this.locoBlend > 0.3 && targetLoco >= 0.05) {
        const inten = clamp(animSpd / runRef + 0.25, 0.25, 1);
        const s1 = this.walkOff;
        const s2 = this.walkOff + 0.5;
        const stepReady = this.idleT - this.lastFootstepAt >= 0.16;
        if (stepReady && (Math.floor(this.cum - s1) !== Math.floor(prevCum - s1))) {
          this.lastFootstepAt = this.idleT;
          this.events.onFootstep?.(0, inten);
        } else if (stepReady && (Math.floor(this.cum - s2) !== Math.floor(prevCum - s2))) {
          this.lastFootstepAt = this.idleT;
          this.events.onFootstep?.(1, inten);
        }
      }
    }
    this.idleT += dt;

    const dur = (x: THREE.AnimationAction) => Math.max(0.01, x.getClip().duration);
    a.idle.time = this.idleT % dur(a.idle);
    a.walk.time = (((this.phase % 1) + 1) % 1) * dur(a.walk);
    a.run.time = ((((this.phase - this.walkOff + this.runOff) % 1) + 1) % 1) * dur(a.run);

    // Normalized Idle / Walk / Run weights so skeleton energy stays 1.0 during every transition
    const rawIdle = (1 - this.locoBlend) * lerp(1, 0.65, this.airBlend);
    const rawWalk = this.locoBlend * (1 - this.runBlend) + this.airBlend * 0.15 * (1 - this.locoBlend);
    const rawRun = this.locoBlend * this.runBlend + this.airBlend * 0.2 * (1 - this.locoBlend);
    const wSum = Math.max(1e-4, rawIdle + rawWalk + rawRun);
    // Restore pre-leg-IK Hips position before evaluating the mixer so constant-value
    // position tracks (e.g. Rocketbox GLBs skipped by PropertyMixer caching) never
    // accumulate crouch/landing lowering across frames.
    if (this.bones.Hips) this.bones.Hips.position.copy(this.hipsPreLegLocal);
    a.idle.setEffectiveWeight(rawIdle / wSum);
    a.walk.setEffectiveWeight(rawWalk / wSum);
    a.run.setEffectiveWeight(rawRun / wSum);
    this.mixer.update(0);
    if (this.bones.Hips) this.hipsPreLegLocal.copy(this.bones.Hips.position);
  }

  /* ---------------------------------------------------------------- */
  private updateProcedural(dt: number) {
    const inp = this.input;
    const B = this.bones;
    const dead = this.dead;
    if (dead) this.deathT += dt;

    // ----- state smoothing
    this.aimTimer = Math.max(0, this.aimTimer - dt);
    const wantAim = !dead && (inp.ads || this.aimTimer > 0 || this.reloadT >= 0) && !this.sprinting;
    this.aimBlend = damp(this.aimBlend, wantAim ? 1 : 0, wantAim ? 18 : 5, dt);
    this.sprintBlend = damp(this.sprintBlend, this.sprinting ? 1 : 0, this.sprinting ? 8 : 14, dt);
    let crouchT = inp.crouch && !dead ? 1 : 0;
    this.crouchAmt = damp(this.crouchAmt, crouchT, 9, dt);
    this.leanS = damp(this.leanS, dead ? 0 : inp.lean, 10, dt);
    this.ikW = damp(this.ikW, dead ? 0 : 1, dead ? 14 : 12, dt);

    const sLand = this.sLand.update(0, dt);
    const rRot = this.sRecoilRot.update(0, dt);
    const rPos = this.sRecoilPos.update(0, dt);
    const rYaw = this.sRecoilYaw.update(0, dt);
    const tKick = this.sTorsoKick.update(0, dt);
    const hP = this.sHitP.update(0, dt);
    const hR = this.sHitR.update(0, dt);
    const hT = this.sHitT.update(0, dt);
    const headS = this.sHead.update(0, dt);
    const armL = this.sArmL.update(0, dt);
    const armR = this.sArmR.update(0, dt);

    this.curTakedownPose = this.takedownAnim.update(dt);
    this.curDrawPose = this.drawAnim.update(dt);
    this.rifle.group.visible =
      this.root.visible && !this.holstered && !dead && this.curTakedownPose.weaponHideBlend <= 0.35;

    // ----- death: articulated multi-joint collapse simulation
    let deathBuckle = 0;
    let deathHipDrop = 0;
    let deathSpineCurl = 0;
    let deathSpineTwist = 0;
    let deathHeadWhip = 0;
    if (dead) {
      const dp = evaluateArticulatedDeath(this.deathT, this.deathKind, this.deathTwistSign);
      this.fallAng = dp.fallAngle;
      const sign = this.deathKind === "back" ? -1 : 1;
      this.fall.rotation.x = sign * dp.fallAngle;
      this.fall.rotation.z = dp.rollTilt;
      this.fall.position.y = 0.08 * Math.sin(dp.fallAngle);
      this.fall.position.z = dp.slideZ;
      deathBuckle = dp.kneeBuckle;
      deathHipDrop = dp.hipDrop;
      deathSpineCurl = dp.spineCurl;
      deathSpineTwist = dp.spineTwist;
      deathHeadWhip = dp.headWhip;
    } else if (this.fall.rotation.x !== 0 || this.fall.rotation.z !== 0) {
      this.fall.rotation.x = damp(this.fall.rotation.x, 0, 12, dt);
      this.fall.rotation.z = damp(this.fall.rotation.z, 0, 12, dt);
      this.fall.position.y = damp(this.fall.position.y, 0, 12, dt);
      this.fall.position.z = damp(this.fall.position.z, 0, 12, dt);
      if (Math.abs(this.fall.rotation.x) < 0.001 && Math.abs(this.fall.rotation.z) < 0.001) {
        this.fall.rotation.set(0, 0, 0);
        this.fall.position.set(0, 0, 0);
      }
    }

    // Always restore pre-leg-IK Hips offset before leg IK so hips never pop or sink
    if (B.Hips) {
      if (!this.hipsPosAnimated) B.Hips.position.copy(this.bindHipsLocal);
      this.hipsPreLegLocal.copy(B.Hips.position);
    }
    this.model.updateMatrixWorld(true);

    // ----- DUAL-FOOT TERRAIN SLOPE & STAIR IK -----
    if (!dead && this.groundSampler && B.LeftFoot && B.RightFoot && this.grounded) {
      B.LeftFoot.getWorldPosition(this.footPosTmpL);
      B.RightFoot.getWorldPosition(this.footPosTmpR);
      const refY = this.root.position.y + 0.5;
      const gL = this.groundSampler(this.footPosTmpL.x, this.footPosTmpL.z, refY);
      const gR = this.groundSampler(this.footPosTmpR.x, this.footPosTmpR.z, refY);
      this.footIk = updateFootPlacement(this.footIk, this.root.position.y, gL, gR, this.locoBlend, this.airBlend, dt);
    } else {
      this.footIk.hipDrop = damp(this.footIk.hipDrop, 0, 16, dt);
      this.footIk.liftL = damp(this.footIk.liftL, 0, 16, dt);
      this.footIk.liftR = damp(this.footIk.liftR, 0, 16, dt);
    }

    // ----- LEGS : smooth crouch / landing / airborne / slope placement via two-bone IK
    const rawDepth = Math.max(0, this.crouchAmt * 0.38 + sLand + deathHipDrop + deathBuckle * 0.42 + this.footIk.hipDrop);
    const rawLift = this.airBlend * 0.3;
    this.legDepthS = damp(this.legDepthS, rawDepth, 18, dt);
    this.legLiftS = damp(this.legLiftS, rawLift, 16, dt);
    this.footLiftLS = damp(this.footLiftLS, this.footIk.liftL, 18, dt);
    this.footLiftRS = damp(this.footLiftRS, this.footIk.liftR, 18, dt);
    if (
      this.legDepthS > 0.0005 ||
      this.legLiftS > 0.0005 ||
      this.footLiftLS > 0.002 ||
      this.footLiftRS > 0.002
    ) {
      this.applyLegs(this.legDepthS, this.legLiftS, this.footLiftLS, this.footLiftRS, dead);
    }

    // ----- TORSO : aim twist/pitch/lean + turn banking + simplex organic motion + takedown lunge
    this.model.updateMatrixWorld(true);
    const bodyYawNow = this.root.rotation.y;
    const hipPos = B.Hips.getWorldPosition(this.tmpV);
    void hipPos;

    const rawTwist = wrapAngle(this.aimYaw - bodyYawNow);
    const twistScale = this.isPlayer && !this.input.ads && this.aimBlend < 0.35 && Math.abs(rawTwist) > 1.2
      ? this.aimBlend / 0.35
      : 1;
    const twist = clamp(rawTwist * twistScale, -1.7, 1.7);
    const blade = -0.28 * this.aimBlend * (1 - this.sprintBlend);
    const sprintTwist = this.sprintBlend * 0.1;
    const idleW = (1 - this.locoBlend) * (1 - this.aimBlend);
    const idleNoise = this.motionNoise.sampleIdle(this.time, idleW, this.aimBlend, this.locoBlend);
    const strideTwist = Math.sin(this.phase * Math.PI * 2) * 0.038 * this.locoBlend * (1 - this.aimBlend * 0.75);
    const td = this.curTakedownPose;
    const yawTot = dead
      ? 0
      : twist + blade + sprintTwist + idleNoise.swayYaw + strideTwist + td.torsoYaw + hT * 0.5;
    const pitchK = lerp(0.55, 1, this.aimBlend);
    const crouchLean = this.crouchAmt * 0.22 + sLand * 0.5;
    const strideForward = Math.sin(this.phase * Math.PI * 4) * 0.012 * this.locoBlend * (1 - this.aimBlend * 0.5);
    const pitchTot = dead
      ? 0
      : -this.aimPitch * pitchK +
        crouchLean +
        hP * 0.5 +
        idleNoise.breathPitch +
        strideForward +
        rRot * 0.05 +
        tKick * 0.04 +
        this.sprintBlend * 0.08 +
        td.torsoPitch;
    const strideRoll = Math.cos(this.phase * Math.PI * 2) * 0.022 * this.locoBlend * (1 - this.aimBlend * 0.7);
    const rollTot = dead ? 0 : -this.leanS * 0.3 + this.turnLeanS + idleNoise.swayRoll + strideRoll + hR * 0.4;

    const yawFrame = bodyYawNow + yawTot;
    const rightAxis = new THREE.Vector3(Math.cos(yawFrame), 0, -Math.sin(yawFrame));
    const fwdAxis = new THREE.Vector3(Math.sin(yawFrame), 0, Math.cos(yawFrame));
    const qYaw = new THREE.Quaternion().setFromAxisAngle(AXIS_Y, yawTot);
    const qPitch = new THREE.Quaternion().setFromAxisAngle(rightAxis, pitchTot);
    const qRoll = new THREE.Quaternion().setFromAxisAngle(fwdAxis, rollTot);
    const qTot = qRoll.multiply(qPitch).multiply(qYaw);
    if (!dead) {
      this.rotateChain(["Spine", "Spine1", "Spine2"], qTot, [0.3, 0.32, 0.32]);
      // Subtle simplex-driven clavicle breathing lift + stride shoulder sway
      const clavLift =
        idleNoise.clavLift +
        Math.sin(this.phase * Math.PI * 2) * (this.holstered ? 0.036 : 0.02) * this.locoBlend;
      if (B.LeftShoulder) this.rotateWorld(B.LeftShoulder, new THREE.Quaternion().setFromAxisAngle(fwdAxis, clavLift));
      if (B.RightShoulder) this.rotateWorld(B.RightShoulder, new THREE.Quaternion().setFromAxisAngle(fwdAxis, -clavLift));
      if (this.holstered) {
        // Subtle scapular counter-protraction & relaxed arm hang during open-world suit locomotion
        const shrugYaw = Math.sin(this.phase * Math.PI * 2) * 0.045 * this.locoBlend;
        if (B.LeftShoulder) this.rotateWorld(B.LeftShoulder, new THREE.Quaternion().setFromAxisAngle(AXIS_Y, shrugYaw));
        if (B.RightShoulder) this.rotateWorld(B.RightShoulder, new THREE.Quaternion().setFromAxisAngle(AXIS_Y, shrugYaw));
        const swingDrop = 0.045 * (1 - this.locoBlend * 0.5);
        if (B.LeftArm) this.rotateWorld(B.LeftArm, new THREE.Quaternion().setFromAxisAngle(fwdAxis, -swingDrop));
        if (B.RightArm) this.rotateWorld(B.RightArm, new THREE.Quaternion().setFromAxisAngle(fwdAxis, swingDrop));
      }
      // head: look toward aim point with organic simplex patrol look-around + natural ADS cheek-weld tilt
      const cheekWeld = -0.068 * this.aimBlend * (1 - this.sprintBlend) * (this.holstered ? 0 : 1);
      const headQ = new THREE.Quaternion()
        .setFromAxisAngle(fwdAxis, cheekWeld)
        .multiply(
          new THREE.Quaternion().setFromAxisAngle(
            rightAxis,
            -this.aimPitch * 0.42 + idleNoise.headScanPitch + headS * 0.1 + hP * 0.3,
          ),
        )
        .multiply(new THREE.Quaternion().setFromAxisAngle(AXIS_Y, yawTot * 0.2 + idleNoise.headScanYaw));
      this.rotateChain(["Neck", "Head"], headQ, [0.45, 0.55]);
    } else {
      // articulated limp spine curl + twist + head whip
      const curl = new THREE.Quaternion()
        .setFromAxisAngle(rightAxis, deathSpineCurl)
        .multiply(new THREE.Quaternion().setFromAxisAngle(AXIS_Y, deathSpineTwist));
      this.rotateChain(["Spine", "Spine1", "Spine2"], curl, [0.35, 0.35, 0.3]);
      const loll = new THREE.Quaternion().setFromAxisAngle(rightAxis, headS * 0.12 + deathHeadWhip);
      this.rotateChain(["Neck", "Head"], loll, [0.5, 0.5]);
    }

    this.model.updateMatrixWorld(true);

    const combatPose = !dead && !this.carryingBody
      ? this.combat.getVisualPose(this.locoBlend, this.sprinting)
      : null;
    const quickMeleeArmed = !!(combatPose?.activeMove && !this.holstered);

    // ----- WEAPON + ARMS
    if (this.carryingBody && !this.dead) {
      this.updateCarryArms();
    } else if (this.weaponAttached && !this.holstered && !quickMeleeArmed) {
      if (this.root.visible && !this.rifle.group.visible) this.rifle.group.visible = true;
      this.updateWeaponAndArms(dt, { rRot, rPos, rYaw, armL, armR, idleNoise });
    } else if (!this.weaponAttached) {
      this.updateDeadArms(armL, armR);
    }

    if (combatPose && combatPose.upperWeight > 0.01) {
      if (quickMeleeArmed) this.rifle.group.visible = false;
      this.applyCombatOverlay(combatPose, dt);
    } else {
      this.combatLastClipId = null;
      this.combatLastActive = false;
      this.combatCrossfadeT = 1;
      if (!dead && this.holstered && !this.carryingBody) {
        // Relaxed natural hand curl while unarmed outside boxing stance
        const relaxed = { Thumb: 0.24, Index: 0.28, Middle: 0.34, Ring: 0.42, Pinky: 0.50 };
        this.curlHand("Left", relaxed);
        this.curlHand("Right", relaxed);
      }
    }

    this.model.updateMatrixWorld(true);
  }

  private captureCombatPoseSnapshot(fromLastPose = false) {
    const B = this.bones;
    const copyBone = (bName: string) => {
      const prev = fromLastPose ? this.combatLastPose[bName] : undefined;
      const srcQ = prev ?? B[bName]?.quaternion;
      if (srcQ) (this.combatBlendSnap[bName] ??= new THREE.Quaternion()).copy(srcQ);
    };
    copyBone(COMBAT_HIPS_BONE);
    for (const bName of COMBAT_UPPER_BONES) copyBone(bName);
    for (const bName of COMBAT_LOWER_BONES) copyBone(bName);
  }

  private applyCombatOverlay(pose: CombatVisualPose, dt: number) {
    const B = this.bones;
    const bank = getCombatBankForRig(
      this.isCC0Fighter ? "fighter://cc0" : this.modelTag || "default",
      this.model,
      B,
      pose.clipId ?? "fight_idle",
    );
    const clip = pose.clipId ? bank[pose.clipId] : undefined;

    // Cross-clip pose snapshot smoothing so combo transitions (jab->cross->hook->idle) have zero frame pops
    const curClipId = pose.clipId ?? null;
    if (this.combatLastActive && curClipId !== this.combatLastClipId) {
      this.captureCombatPoseSnapshot(true);
      this.combatCrossfadeT = 0;
      this.combatCrossfadeDur = pose.activeMove ? 0.085 : 0.14;
    } else if (!this.combatLastActive) {
      this.captureCombatPoseSnapshot(false);
      this.combatCrossfadeT = 0;
      this.combatCrossfadeDur = 0.12;
    }
    this.combatLastClipId = curClipId;
    this.combatLastActive = true;
    this.combatCrossfadeT = Math.min(1, this.combatCrossfadeT + dt / Math.max(0.03, this.combatCrossfadeDur));
    const cf = this.combatCrossfadeT * this.combatCrossfadeT * (3 - 2 * this.combatCrossfadeT);

    if (clip) {
      const q = this.combatTmpQ;
      const applyBone = (bName: string, w: number) => {
        const b = B[bName];
        if (!b || !sampleCombatBone(clip, bName as never, pose.clipTimeNorm, q)) return;
        b.quaternion.slerp(q, w);
        const snap = this.combatBlendSnap[bName];
        if (cf < 0.999 && snap) {
          q.copy(snap).slerp(b.quaternion, cf);
          b.quaternion.copy(q);
        }
        (this.combatLastPose[bName] ??= new THREE.Quaternion()).copy(b.quaternion);
      };

      const hipsW = Math.max(pose.lowerWeight, pose.upperWeight * 0.42);
      if (hipsW > 0.01) applyBone(COMBAT_HIPS_BONE, hipsW);
      if (pose.upperWeight > 0.01) {
        for (const bName of COMBAT_UPPER_BONES) applyBone(bName, pose.upperWeight);
      }
      if (pose.lowerWeight > 0.01) {
        for (const bName of COMBAT_LOWER_BONES) applyBone(bName, pose.lowerWeight);
      }
      // Keep subtle head/neck aim-tracking during guard/stance so fighters track their target
      if (!pose.activeMove && pose.clipId !== "hit" && pose.clipId !== "knockdown" && pose.clipId !== "dodge") {
        const lookYaw = clamp(wrapAngle(this.aimYaw - this.bodyYaw), -0.65, 0.65);
        const lookPitch = clamp(this.aimPitch, -0.45, 0.45);
        const headTrackW = pose.upperWeight * 0.65;
        if (Math.abs(lookYaw) > 0.01 || Math.abs(lookPitch) > 0.01) {
          const headQ = new THREE.Quaternion().setFromEuler(
            new THREE.Euler(-lookPitch * 0.45 * headTrackW, lookYaw * 0.55 * headTrackW, 0, "YXZ"),
          );
          if (B.Head) this.rotateWorld(B.Head, headQ);
        }
      }
    } else {
      // Crisp procedural combat fallback while Mixamo GLBs finish streaming
      const yawNow = this.root.rotation.y;
      const fwd = new THREE.Vector3(Math.sin(yawNow), 0, Math.cos(yawNow));
      const rgt = new THREE.Vector3(-Math.cos(yawNow), 0, Math.sin(yawNow));
      const lShoulder = B.LeftArm.getWorldPosition(new THREE.Vector3());
      const rShoulder = B.RightArm.getWorldPosition(new THREE.Vector3());
      const ext = pose.activeMove ? Math.sin(Math.min(1, pose.attackProgress * 2.1) * Math.PI) : 0;
      const isLeft = pose.activeMove?.id === "jab" || pose.activeMove?.id === "uppercut";
      const guardL = lShoulder.clone().addScaledVector(fwd, 0.34).addScaledVector(rgt, -0.06).add(new THREE.Vector3(0, -0.05, 0));
      const guardR = rShoulder.clone().addScaledVector(fwd, 0.28).addScaledVector(rgt, 0.06).add(new THREE.Vector3(0, -0.03, 0));
      if (pose.activeMove && ext > 0.05) {
        if (isLeft) guardL.addScaledVector(fwd, ext * 0.45);
        else guardR.addScaledVector(fwd, ext * 0.45);
      }
      const yawQ = new THREE.Quaternion().setFromAxisAngle(AXIS_Y, yawNow);
      this.solveArm("Left", guardL, fwd, rgt, V(0.55, -0.9, -0.25).applyQuaternion(yawQ));
      this.solveArm("Right", guardR, fwd, rgt.clone().negate(), V(-0.55, -0.9, -0.25).applyQuaternion(yawQ));
    }

    if (pose.fistWeight > 0.05) {
      const f = pose.fistWeight;
      const fist = { Thumb: 0.85 * f, Index: f, Middle: f, Ring: f, Pinky: f };
      this.curlHand("Left", fist);
      this.curlHand("Right", fist);
    }

    // Procedural wrestling & grappling silhouettes layered cleanly over combat animations
    const mId = pose.activeMove?.id;
    if (this.combat.state === "clinch" || this.combat.state === "grappled" || isGrappleMoveId(mId)) {
      const yawNow = this.root.rotation.y;
      const fwd = new THREE.Vector3(Math.sin(yawNow), 0, Math.cos(yawNow));
      const rgt = new THREE.Vector3(-Math.cos(yawNow), 0, Math.sin(yawNow));
      const yawQ = new THREE.Quaternion().setFromAxisAngle(AXIS_Y, yawNow);
      const lShoulder = B.LeftArm.getWorldPosition(new THREE.Vector3());
      const rShoulder = B.RightArm.getWorldPosition(new THREE.Vector3());

      if (this.combat.state === "clinch" || mId === "grapple_grab" || mId === "clinch_knee") {
        const pulse = Math.sin(this.combat.stateTime * 7.5) * 0.04;
        const reach = mId === "grapple_grab" ? 0.56 : 0.44;
        const tL = lShoulder
          .clone()
          .addScaledVector(fwd, reach + pulse)
          .addScaledVector(rgt, 0.1)
          .add(new THREE.Vector3(0, 0.08, 0));
        const tR = rShoulder
          .clone()
          .addScaledVector(fwd, reach - pulse)
          .addScaledVector(rgt, -0.1)
          .add(new THREE.Vector3(0, 0.1, 0));
        this.solveArm("Left", tL, fwd, rgt, V(0.6, -0.7, -0.2).applyQuaternion(yawQ));
        this.solveArm("Right", tR, fwd, rgt.clone().negate(), V(-0.6, -0.7, -0.2).applyQuaternion(yawQ));
        const leanQ = new THREE.Quaternion().setFromAxisAngle(rgt, 0.16);
        this.rotateChain(["Spine", "Spine1", "Spine2"], leanQ, [0.35, 0.35, 0.3]);
      } else if (mId === "takedown_double_leg") {
        const u = pose.attackProgress;
        const shoot = Math.sin(Math.min(1, u * 1.35) * Math.PI);
        const tL = lShoulder
          .clone()
          .addScaledVector(fwd, 0.48 + shoot * 0.18)
          .addScaledVector(rgt, 0.08)
          .add(new THREE.Vector3(0, -0.34 * shoot, 0));
        const tR = rShoulder
          .clone()
          .addScaledVector(fwd, 0.48 + shoot * 0.18)
          .addScaledVector(rgt, -0.08)
          .add(new THREE.Vector3(0, -0.34 * shoot, 0));
        this.solveArm("Left", tL, fwd, rgt, V(0.75, -0.6, 0).applyQuaternion(yawQ));
        this.solveArm("Right", tR, fwd, rgt.clone().negate(), V(-0.75, -0.6, 0).applyQuaternion(yawQ));
        const diveQ = new THREE.Quaternion().setFromAxisAngle(rgt, 0.42 * shoot);
        this.rotateChain(["Spine", "Spine1", "Spine2"], diveQ, [0.35, 0.35, 0.3]);
      } else if (mId === "suplex_slam") {
        const u = pose.attackProgress;
        const lift = u < 0.5 ? u * 2 : 2 - u * 2;
        const slamPitch = u < 0.45 ? -0.36 * (u / 0.45) : 0.48 * Math.min(1, (u - 0.45) / 0.35);
        const tL = lShoulder
          .clone()
          .addScaledVector(fwd, 0.38)
          .addScaledVector(rgt, 0.06)
          .add(new THREE.Vector3(0, 0.28 * lift - (u > 0.55 ? 0.25 : 0), 0));
        const tR = rShoulder
          .clone()
          .addScaledVector(fwd, 0.38)
          .addScaledVector(rgt, -0.06)
          .add(new THREE.Vector3(0, 0.28 * lift - (u > 0.55 ? 0.25 : 0), 0));
        this.solveArm("Left", tL, fwd, rgt, V(0.5, -0.4, -0.4).applyQuaternion(yawQ));
        this.solveArm("Right", tR, fwd, rgt.clone().negate(), V(-0.5, -0.4, -0.4).applyQuaternion(yawQ));
        const archQ = new THREE.Quaternion().setFromAxisAngle(rgt, slamPitch);
        this.rotateChain(["Spine", "Spine1", "Spine2"], archQ, [0.3, 0.35, 0.35]);
      } else if (mId === "submission_choke") {
        const squeeze = 0.5 + 0.5 * Math.sin(this.combat.stateTime * 14);
        const tL = lShoulder
          .clone()
          .addScaledVector(fwd, 0.36)
          .addScaledVector(rgt, -0.14)
          .add(new THREE.Vector3(0, 0.04 + squeeze * 0.04, 0));
        const tR = rShoulder
          .clone()
          .addScaledVector(fwd, 0.38)
          .addScaledVector(rgt, 0.14)
          .add(new THREE.Vector3(0, 0.06 + squeeze * 0.04, 0));
        this.solveArm("Left", tL, fwd, rgt, V(0.85, -0.35, 0.15).applyQuaternion(yawQ));
        this.solveArm("Right", tR, fwd, rgt.clone().negate(), V(-0.85, -0.35, 0.15).applyQuaternion(yawQ));
        const crunchQ = new THREE.Quaternion().setFromAxisAngle(rgt, 0.26);
        this.rotateChain(["Spine", "Spine1", "Spine2"], crunchQ, [0.35, 0.35, 0.3]);
      }
    }
    this.model.updateMatrixWorld(true);
  }

  /* ---- bone helpers -------------------------------------------------- */
  private rotateWorld(bone: THREE.Object3D, dq: THREE.Quaternion) {
    const wq = bone.getWorldQuaternion(this.tmpQ);
    const pq = bone.parent!.getWorldQuaternion(this.tmpQ2).invert();
    wq.premultiply(dq);
    bone.quaternion.copy(pq.multiply(wq));
    bone.updateMatrixWorld(true);
  }

  private rotateChain(names: string[], q: THREE.Quaternion, weights: number[]) {
    const id = new THREE.Quaternion();
    names.forEach((n, i) => {
      const part = id.clone().slerp(q, weights[i]);
      this.rotateWorld(this.bones[n], part);
    });
  }

  private twoBoneIK(a: THREE.Object3D, b: THREE.Object3D, c: THREE.Object3D, target: THREE.Vector3, pole: THREE.Vector3, stretch = 0.999) {
    const A = a.getWorldPosition(new THREE.Vector3());
    const Bp = b.getWorldPosition(new THREE.Vector3());
    const C = c.getWorldPosition(new THREE.Vector3());
    const l1 = A.distanceTo(Bp);
    const l2 = Bp.distanceTo(C);
    const AT = target.clone().sub(A);
    let d = AT.length();
    d = clamp(d, Math.abs(l1 - l2) + 1e-3, (l1 + l2) * stretch);
    const axis = AT.normalize();
    const pp = pole.clone().sub(axis.clone().multiplyScalar(pole.dot(axis)));
    if (pp.lengthSq() < 1e-6) pp.set(0, -1, 0);
    pp.normalize();
    const x = (l1 * l1 - l2 * l2 + d * d) / (2 * d);
    const h = Math.sqrt(Math.max(0, l1 * l1 - x * x));
    const E = A.clone().add(axis.clone().multiplyScalar(x)).add(pp.multiplyScalar(h));
    const T = A.clone().add(axis.clone().multiplyScalar(d));
    const q1 = new THREE.Quaternion().setFromUnitVectors(Bp.clone().sub(A).normalize(), E.clone().sub(A).normalize());
    this.rotateWorld(a, q1);
    b.getWorldPosition(Bp);
    c.getWorldPosition(C);
    const q2 = new THREE.Quaternion().setFromUnitVectors(C.clone().sub(Bp).normalize(), T.clone().sub(Bp).normalize());
    this.rotateWorld(b, q2);
  }

  /* ---- legs ---------------------------------------------------------- */
  private applyLegs(depth: number, lift: number, liftL: number, liftR: number, dead: boolean) {
    const B = this.bones;
    const sides: Side[] = ["Left", "Right"];
    const footP: Record<string, THREE.Vector3> = {};
    const footQ: Record<string, THREE.Quaternion> = {};
    sides.forEach((s) => {
      footP[s] = B[`${s}Foot`].getWorldPosition(new THREE.Vector3());
      footQ[s] = B[`${s}Foot`].getWorldQuaternion(new THREE.Quaternion());
    });
    const yaw = this.root.rotation.y;
    const fwd = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
    const right = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
    // lower hips (and push them back a little for balance)
    const hips = B.Hips;
    // Always start from the un-lowered frame base so lowering never accumulates across frames
    hips.position.copy(this.hipsPreLegLocal);
    const hp = hips.getWorldPosition(new THREE.Vector3());
    hp.y -= depth;
    hp.addScaledVector(fwd, -depth * 0.35);
    // convert to the parent's local space
    hips.parent!.updateWorldMatrix(true, false);
    hips.position.copy(hips.parent!.worldToLocal(hp));
    hips.updateMatrixWorld(true);

    sides.forEach((s, i) => {
      const out = s === "Left" ? 1 : -1; // "right" vector below is the character's left (+X)
      const target = footP[s].clone();
      // jump tuck + terrain slope/stair foot-plant IK offset
      target.y += lift * (i === 0 ? 1 : 0.8) + (s === "Left" ? liftL : liftR);
      target.addScaledVector(fwd, -lift * (i === 0 ? 0.25 : -0.15));
      if (dead) target.addScaledVector(right, out * 0.08 * smoothstep(0.3, 1, this.fallAng));
      const pole = fwd.clone().addScaledVector(right, out * 0.18);
      this.twoBoneIK(B[`${s}UpLeg`], B[`${s}Leg`], B[`${s}Foot`], target, pole, 0.9995);
      // keep foot orientation (ground-flat) – only tilt for tucked jump
      const cur = B[`${s}Foot`].getWorldQuaternion(new THREE.Quaternion());
      const delta = footQ[s].clone().multiply(cur.invert());
      this.rotateWorld(B[`${s}Foot`], delta);
    });
  }

  /* ---- weapon + arms --------------------------------------------------- */
  private updateWeaponAndArms(
    dt: number,
    s: {
      rRot: number;
      rPos: number;
      rYaw: number;
      armL: number;
      armR: number;
      idleNoise: { weaponY: number; weaponX: number };
    },
  ) {
    const B = this.bones;
    const rShoulder = B.RightArm.getWorldPosition(new THREE.Vector3());
    const lShoulder = B.LeftArm.getWorldPosition(new THREE.Vector3());

    const a = this.aimBlend;
    const sp = this.sprintBlend;
    const draw = this.curDrawPose;
    const td = this.curTakedownPose;

    // desired weapon aim: from shoulder to aim point, blending smoothly into torso heading while sprinting
    const toAim = this.aimPoint.clone().sub(rShoulder);
    if (toAim.length() < 4) toAim.normalize().multiplyScalar(4);
    const rawAimYaw = Math.atan2(toAim.x, toAim.z);
    const rawAimPitch = Math.atan2(toAim.y, Math.hypot(toAim.x, toAim.z));
    const sprintYawDiff = wrapAngle(this.bodyYaw - rawAimYaw);
    const dYaw = wrapAngle(rawAimYaw + sprintYawDiff * sp);
    const dPitch = lerp(rawAimPitch, 0.04, sp);
    this.wYaw = dampAngle(this.wYaw, dYaw, 26, dt);
    this.wPitch = damp(this.wPitch, dPitch, 26, dt);

    // reload envelope
    let rb = 0;
    if (this.reloadT >= 0) {
      const t = this.reloadT;
      rb = smoothstep(0, 0.35, t) * (1 - smoothstep(2.55, 2.9, t));
    }
    const lowReady = 1 - a;

    // pose parameters: keep two-handed port-arms carry in front of chest while sprinting + draw curve
    const dx = lowReady * 0.44 + sp * 0.22 + rb * 0.22 + draw.pitchOffset + td.weaponHideBlend * 0.55;
    const dy = lowReady * 0.14 + sp * 0.44 - td.weaponHideBlend * 0.35;
    const roll = sp * 0.24 - rb * 0.55 + draw.rollOffset;

    const aimQ = new THREE.Quaternion().setFromEuler(new THREE.Euler(-this.wPitch, this.wYaw + s.rYaw * 0.02, 0, "YXZ"));
    // weapon-local pose offset
    const poseQ = new THREE.Quaternion().setFromEuler(new THREE.Euler(dx - s.rRot * 0.045, dy, roll, "YXZ"));
    const wq = aimQ.clone().multiply(poseQ);

    // position relative to the right shoulder, expressed in aim frame
    const isPistol = this.rifle.weaponId === "pistol";
    const pAim = isPistol ? V(0.052, -0.052, 0.45) : V(0.075, -0.095, 0.36);
    const pLow = isPistol ? V(0.085, -0.18, 0.32) : V(0.095, -0.18, 0.31);
    const pSprint = isPistol ? V(0.055, -0.14, 0.30) : V(0.065, -0.15, 0.28);
    const pReload = isPistol ? V(0.07, -0.14, 0.36) : V(0.1, -0.17, 0.33);
    const off = pAim.clone().lerp(pLow, lowReady * (1 - sp)).lerp(pSprint, sp).lerp(pReload, rb);
    off.z -= s.rPos * 0.035 + td.weaponHideBlend * 0.1;
    off.y += s.rPos * 0.008 - draw.dropOffset - td.weaponHideBlend * 0.14;
    const wpos = rShoulder.clone().add(off.applyQuaternion(aimQ));
    // organic simplex breathing + stride-synced weapon carry cadence (dampened while ADS)
    const carryBobAmt = this.locoBlend * (1 - a * 0.72) * (1 + sp * 0.55);
    wpos.y += s.idleNoise.weaponY + Math.sin(this.phase * Math.PI * 4) * 0.011 * carryBobAmt;
    wpos.x += s.idleNoise.weaponX + Math.cos(this.phase * Math.PI * 2) * 0.007 * carryBobAmt;

    const g = this.rifle.group;
    g.position.copy(wpos);
    g.quaternion.copy(wq);
    g.updateMatrixWorld(true);

    const toW = (v: THREE.Vector3) => v.clone().multiplyScalar(WS).applyQuaternion(wq).add(wpos);
    const dirW = (v: THREE.Vector3) => v.clone().normalize().applyQuaternion(wq);

    // save pose before IK so we can blend out on death
    const armBones = [B.LeftArm, B.LeftForeArm, B.LeftHand, B.RightArm, B.RightForeArm, B.RightHand];
    FINGERS.forEach((f) => {
      const names = [
        `LeftHand${f}`,
        `RightHand${f}`,
        ...[1, 2, 3].flatMap((i) => [`LeftHand${f}${i}`, `RightHand${f}${i}`]),
      ];
      names.forEach((n) => {
        if (B[n]) armBones.push(B[n]);
      });
    });
    const saved = this.ikW < 0.999 ? armBones.map((b) => b.quaternion.clone()) : null;

    // ---- right hand (grip or CQC takedown strike)
    const RF = V(0.35, -0.42, 0.84);
    const RP = V(1, 0.25, 0);
    const rf = dirW(RF);
    const rp = dirW(RP);
    const rfN = rf.clone();
    const rpalm = toW(RIFLE.rightPalm);
    const rWrist = rpalm.clone().addScaledVector(rfN, -0.075);

    // ---- left hand (grip, reload animation, or takedown shoulder grab)
    let lPalm: THREE.Vector3;
    let lf: THREE.Vector3;
    let lp: THREE.Vector3;
    let lCurl = 0.9;
    if (this.reloadT >= 0) {
      const r = this.sampleReload(toW, dirW);
      lPalm = r.pos;
      lf = r.f;
      lp = r.p;
      lCurl = r.curl;
      this.updateReloadProps(dt, lPalm, wq, toW);
    } else {
      lPalm = toW(this.rifle.leftPalm ?? RIFLE.leftPalm);
      lf = dirW(LF_GRIP.f);
      lp = dirW(LF_GRIP.p);
    }
    const lfN = lf.clone().normalize();
    const lWrist = lPalm.clone().addScaledVector(lfN, -0.075);

    if (td.active) {
      const yawNow = this.root.rotation.y;
      const fwdNow = new THREE.Vector3(Math.sin(yawNow), 0, Math.cos(yawNow));
      const rgtNow = new THREE.Vector3(-Math.cos(yawNow), 0, Math.sin(yawNow));
      rWrist.addScaledVector(fwdNow, td.rForward).addScaledVector(rgtNow, td.rRight).y += td.rUp;
      lWrist.addScaledVector(fwdNow, td.lForward).addScaledVector(rgtNow, td.lRight).y += td.lUp;
    }

    // wobble from hits
    const wob = new THREE.Vector3(0, s.armL * 0.002, 0);
    lWrist.add(wob);
    rWrist.add(new THREE.Vector3(0, s.armR * 0.002, 0));

    // Anatomical scapulohumeral rhythm: clavicles protract & elevate with wrist targets so suit shoulders bend naturally
    this.applyClavicleRhythm("Right", rWrist, s.rPos * 0.055);
    this.applyClavicleRhythm("Left", lWrist, 0);

    // Dynamic anatomical elbow poles (relaxed low-ready -> tucked tactical ADS)
    const yawQ = new THREE.Quaternion().setFromAxisAngle(AXIS_Y, this.wYaw);
    const poleR = V(lerp(-0.62, -0.44, a), lerp(-1.0, -0.84, a), lerp(-0.18, -0.38, a)).applyQuaternion(yawQ);
    const poleL = V(lerp(0.62, 0.46, a), -1.0, lerp(-0.2, -0.26, a)).applyQuaternion(yawQ);
    void lShoulder;

    this.solveArm("Right", rWrist, rf, rp, poleR);
    this.solveArm("Left", lWrist, lf, lp, poleL);

    // fingers
    const fire = this.fireCd > this.fireInterval * 0.4 ? 1 : 0;
    this.curlHand("Right", { Thumb: 0.55, Index: 0.45 + fire * 0.35, Middle: 1, Ring: 1, Pinky: 1 });
    this.curlHand("Left", { Thumb: 0.45, Index: lCurl, Middle: lCurl, Ring: lCurl, Pinky: lCurl });

    if (saved) {
      armBones.forEach((b, i) => {
        const cur = b.quaternion.clone();
        b.quaternion.copy(saved[i]).slerp(cur, this.ikW);
      });
    }
  }

  /**
   * Scapulohumeral rhythm: rotates LeftShoulder/RightShoulder (clavicle) ~25–32% toward arm elevation
   * and forward/cross-chest reach before upper-arm IK so suit jacket shoulders follow smoothly.
   */
  private applyClavicleRhythm(side: Side, wristTarget: THREE.Vector3, recoilLift = 0) {
    const B = this.bones;
    const clav = B[`${side}Shoulder`];
    const arm = B[`${side}Arm`];
    const chest = B.Spine2 ?? B.Spine1 ?? B.Hips;
    if (!clav || !arm || !chest) return;

    const armP = arm.getWorldPosition(new THREE.Vector3());
    const delta = wristTarget.clone().sub(armP);
    const dist = delta.length();
    if (dist < 1e-4) return;
    const dir = delta.multiplyScalar(1 / dist);

    const chestQ = chest.getWorldQuaternion(new THREE.Quaternion());
    const chestFwd = new THREE.Vector3(0, 0, 1).applyQuaternion(chestQ);
    chestFwd.y = 0;
    if (chestFwd.lengthSq() < 1e-5) chestFwd.set(Math.sin(this.root.rotation.y), 0, Math.cos(this.root.rotation.y));
    chestFwd.normalize();
    const chestLeft = new THREE.Vector3(chestFwd.z, 0, -chestFwd.x); // +X in character frame

    const fwdAmt = clamp(dir.dot(chestFwd), -0.35, 1.0);
    const upAmt = clamp(dir.y + 0.45, -0.25, 1.0); // neutral arm hangs down (dir.y ~ -0.75), raising forward increases upAmt
    const acrossAmt = side === "Left" ? clamp(-dir.dot(chestLeft), 0, 0.9) : clamp(dir.dot(chestLeft), 0, 0.9);

    const protract = clamp(fwdAmt * 0.24 + acrossAmt * 0.18, -0.08, 0.34);
    const elevate = clamp(upAmt * 0.22 + recoilLift, -0.08, 0.26);

    const sgn = side === "Left" ? 1 : -1;
    // Protraction: Left uses -Y, Right uses +Y; Elevation: Left uses +fwd, Right uses -fwd
    const qProt = new THREE.Quaternion().setFromAxisAngle(AXIS_Y, -sgn * protract);
    const qElev = new THREE.Quaternion().setFromAxisAngle(chestFwd, sgn * elevate);
    this.rotateWorld(clav, qProt.multiply(qElev));
  }

  private solveArm(side: Side, wrist: THREE.Vector3, f: THREE.Vector3, p: THREE.Vector3, pole: THREE.Vector3) {
    const B = this.bones;
    const up = B[`${side}Arm`];
    const fore = B[`${side}ForeArm`];
    const hand = B[`${side}Hand`];
    this.twoBoneIK(up, fore, hand, wrist, pole, 0.995);
    // Distribute wrist twist gently across UpperArm (20%) + ForeArm (52%) to avoid sleeve/wrist candy-wrapper pinching
    const target = this.handTargetQuat(side, f, p);
    const cur = hand.getWorldQuaternion(new THREE.Quaternion());
    const delta = target.clone().multiply(cur.invert());
    const upAx = fore.getWorldPosition(new THREE.Vector3()).sub(up.getWorldPosition(new THREE.Vector3())).normalize();
    const foreAx = hand.getWorldPosition(new THREE.Vector3()).sub(fore.getWorldPosition(new THREE.Vector3())).normalize();
    const proj = delta.x * foreAx.x + delta.y * foreAx.y + delta.z * foreAx.z;
    const twist = wrapAngle(2 * Math.atan2(proj, delta.w));
    this.rotateWorld(up, new THREE.Quaternion().setFromAxisAngle(upAx, clamp(twist * 0.20, -0.35, 0.35)));
    this.rotateWorld(fore, new THREE.Quaternion().setFromAxisAngle(foreAx, twist * 0.52));
    // final hand orientation
    const pq = hand.parent!.getWorldQuaternion(new THREE.Quaternion()).invert();
    hand.quaternion.copy(pq.multiply(target));
    hand.updateMatrixWorld(true);
  }

  private handTargetQuat(side: Side, f: THREE.Vector3, p: THREE.Vector3) {
    const hb = this.handBind[side];
    const modelQ = this.model.getWorldQuaternion(new THREE.Quaternion());
    const modelQi = modelQ.clone().invert();
    const F = f.clone().normalize().applyQuaternion(modelQi);
    const P = p.clone().applyQuaternion(modelQi);
    P.sub(F.clone().multiplyScalar(P.dot(F))).normalize();
    const S = new THREE.Vector3().crossVectors(F, P);
    const m1 = new THREE.Matrix4().makeBasis(F, P, S);
    const S0 = new THREE.Vector3().crossVectors(hb.f0, hb.p0);
    const m0 = new THREE.Matrix4().makeBasis(hb.f0, hb.p0, S0).transpose();
    const R = m1.multiply(m0);
    const qR = new THREE.Quaternion().setFromRotationMatrix(R);
    return modelQ.multiply(qR).multiply(hb.bindQ);
  }

  private curlHand(side: Side, amt: Record<string, number>) {
    const hb = this.handBind[side];
    const q = new THREE.Quaternion();
    FINGERS.forEach((fn) => {
      hb.fingers[fn].forEach((seg, i) => {
        const ang = (amt[fn] ?? 0) * SEG[fn][i];
        seg.bone.quaternion.copy(seg.bindLocal).multiply(q.setFromAxisAngle(seg.axis, ang));
      });
    });
  }

  private updateCarryArms() {
    const B = this.bones;
    const yaw = this.root.rotation.y;
    const fwd = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
    const right = new THREE.Vector3(-Math.cos(yaw), 0, Math.sin(yaw));
    const rSh = B.RightArm.getWorldPosition(new THREE.Vector3());
    const lSh = B.LeftArm.getWorldPosition(new THREE.Vector3());
    // Right arm reaches up and slightly forward/out to cradle the body over the right shoulder
    const rTarget = rSh.clone().addScaledVector(fwd, 0.16).addScaledVector(right, 0.08).add(new THREE.Vector3(0, 0.22, 0));
    // Left arm crosses up toward the right shoulder/chest to brace the carried torso
    const lTarget = lSh.clone().addScaledVector(fwd, 0.22).addScaledVector(right, 0.24).add(new THREE.Vector3(0, 0.12, 0));
    const poleR = fwd.clone().multiplyScalar(-0.4).addScaledVector(right, 0.6).add(new THREE.Vector3(0, -0.6, 0));
    const poleL = fwd.clone().multiplyScalar(0.3).addScaledVector(right, -0.6).add(new THREE.Vector3(0, -0.7, 0));
    this.applyClavicleRhythm("Right", rTarget, 0.05);
    this.applyClavicleRhythm("Left", lTarget, 0.03);
    this.twoBoneIK(B.RightArm, B.RightForeArm, B.RightHand, rTarget, poleR, 0.96);
    this.twoBoneIK(B.LeftArm, B.LeftForeArm, B.LeftHand, lTarget, poleL, 0.96);
    this.curlHand("Right", { Thumb: 0.7, Index: 0.85, Middle: 0.9, Ring: 0.9, Pinky: 0.9 });
    this.curlHand("Left", { Thumb: 0.7, Index: 0.85, Middle: 0.9, Ring: 0.9, Pinky: 0.9 });
  }

  private updateDeadArms(armL: number, armR: number) {
    const B = this.bones;
    const t = smoothstep(0.05, 0.7, this.deathT);
    const yaw = this.root.rotation.y;
    const fwd = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
    // spread arms out (left = +Z rotation, right = -Z rotation in body frame) with overshoot springs
    const l = 0.25 + t * 0.9 + armL * 0.05;
    const r = 0.25 + t * 0.9 - armR * 0.05;
    this.rotateWorld(B.LeftArm, new THREE.Quaternion().setFromAxisAngle(fwd, l));
    this.rotateWorld(B.RightArm, new THREE.Quaternion().setFromAxisAngle(fwd, -r));
    const bend = new THREE.Quaternion().setFromAxisAngle(AXIS_Y, 0.0);
    void bend;
    // relaxed fingers
    this.curlHand("Left", { Thumb: 0.3, Index: 0.35, Middle: 0.45, Ring: 0.5, Pinky: 0.55 });
    this.curlHand("Right", { Thumb: 0.3, Index: 0.35, Middle: 0.45, Ring: 0.5, Pinky: 0.55 });
  }

  /* ---- reload ---------------------------------------------------------- */
  private sampleReload(toW: (v: THREE.Vector3) => THREE.Vector3, dirW: (v: THREE.Vector3) => THREE.Vector3) {
    const t = clamp(this.reloadT, 0, RELOAD_TIME);
    let i = 0;
    while (i < RELOAD_KEYS.length - 2 && t > RELOAD_KEYS[i + 1].t) i++;
    const k0 = RELOAD_KEYS[i];
    const k1 = RELOAD_KEYS[i + 1];
    const u = easeInOut((t - k0.t) / Math.max(1e-4, k1.t - k0.t));
    const chestQ = new THREE.Quaternion().setFromAxisAngle(AXIS_Y, this.root.rotation.y + clamp(wrapAngle(this.aimYaw - this.root.rotation.y), -1.2, 1.2) - 0.3);
    const chestP = this.bones.Spine2.getWorldPosition(new THREE.Vector3());
    const conv = (k: HandKey) => {
      if (k.space === "w") return { pos: toW(k.pos), f: dirW(k.f), p: dirW(k.p) };
      return {
        pos: k.pos.clone().applyQuaternion(chestQ).add(chestP),
        f: k.f.clone().normalize().applyQuaternion(chestQ),
        p: k.p.clone().normalize().applyQuaternion(chestQ),
      };
    };
    const a = conv(k0);
    const b = conv(k1);
    return {
      pos: a.pos.lerp(b.pos, u),
      f: a.f.lerp(b.f, u).normalize(),
      p: a.p.lerp(b.p, u).normalize(),
      curl: lerp(k0.curl, k1.curl, u),
    };
  }

  private updateReloadProps(_dt: number, palm: THREE.Vector3, wq: THREE.Quaternion, toW: (v: THREE.Vector3) => THREE.Vector3) {
    const t = this.reloadT;
    const fl = this.reloadFlags;
    const R = this.rifle;
    const magOffLocal = R.magRest.clone().sub(V(0.034, -0.085, 0.115)); // palm -> mag centre
    const attachToHand = () => {
      if (R.mag.parent !== R.group) R.group.add(R.mag);
      // place in weapon-local space from the palm world pos
      const inv = new THREE.Matrix4().copy(R.group.matrixWorld).invert();
      const pl = palm.clone().applyMatrix4(inv);
      R.mag.position.copy(pl).add(magOffLocal);
      R.mag.rotation.set(0, 0, 0);
    };
    if (t > 0.58 && t < 1.02 && !fl.drop) {
      attachToHand();
      if (!fl.out) {
        fl.out = true;
        this.events.onReloadEvent?.("magout");
      }
    }
    if (t >= 1.02 && !fl.drop) {
      fl.drop = true;
      // spawn physical old magazine
      const clone = R.makeMagClone();
      R.group.updateMatrixWorld(true);
      const wp = R.mag.getWorldPosition(new THREE.Vector3());
      const wquat = R.mag.getWorldQuaternion(new THREE.Quaternion());
      clone.position.copy(wp);
      clone.quaternion.copy(wquat);
      clone.scale.setScalar(WS);
      this.scene.add(clone);
      clone.traverse((o) => ((o as THREE.Mesh).castShadow = true));
      const out = V(0.8 + Math.random() * 0.3, 0.2, 0.2).applyQuaternion(wq);
      this.props.push({ obj: clone, vel: out, ang: V(Math.random() * 4, Math.random() * 4, Math.random() * 4), life: 12, rest: false });
      R.mag.visible = false;
      this.events.onReloadEvent?.("drop");
    }
    if (t >= 1.42 && t < 1.93) {
      R.mag.visible = true;
      attachToHand();
    }
    if (t >= 1.93 && t < 2.0 && !fl.in) {
      fl.in = true;
      R.mag.position.copy(R.magRest);
      R.mag.rotation.set(0, 0, 0);
      this.events.onReloadEvent?.("magin");
    }
    if (t >= 1.93 && fl.in) {
      R.mag.position.copy(R.magRest);
      R.mag.rotation.set(0, 0, 0);
      R.mag.visible = true;
    }
    if (t >= 1.95 && !fl.ammo) {
      fl.ammo = true;
      const take = Math.min(this.weaponMagSize - this.mag, this.reserve);
      this.mag += take;
      this.reserve -= take;
    }
    // charging handle
    const cz = -0.056;
    let pull = 0;
    if (t > 2.4 && t < 2.55) pull = easeInOut((t - 2.4) / 0.15);
    else if (t >= 2.55 && t < 2.68) pull = 1 - (t - 2.55) / 0.13;
    R.charge.position.z = cz - pull * 0.05;
    if (t > 2.55 && !fl.bolt) {
      fl.bolt = true;
      this.events.onReloadEvent?.("bolt");
    }
    void toW;
  }

  /* ---- misc ------------------------------------------------------------ */
  private updateProps(dt: number) {
    const all = [...this.props];
    if (this.weaponProp) all.push(this.weaponProp);
    for (const p of all) {
      if (p.rest) continue;
      p.vel.y -= 14 * dt;
      p.obj.position.addScaledVector(p.vel, dt);
      p.obj.rotation.x += p.ang.x * dt;
      p.obj.rotation.y += p.ang.y * dt;
      p.obj.rotation.z += p.ang.z * dt;
      const floor = this.groundY + (p === this.weaponProp ? 0.07 : 0.04);
      if (p.obj.position.y < floor) {
        p.obj.position.y = floor;
        if (p.vel.y < -1.2) {
          p.vel.y *= -0.3;
          p.vel.x *= 0.6;
          p.vel.z *= 0.6;
          p.ang.multiplyScalar(0.5);
        } else {
          p.vel.set(0, 0, 0);
          p.ang.set(0, 0, 0);
          p.rest = true;
          // lie flat-ish
          if (p === this.weaponProp) {
            p.obj.rotation.x = 0;
            p.obj.rotation.z = Math.PI / 2 * (Math.random() > 0.5 ? 1 : -1);
          }
        }
      }
    }
    this.props = this.props.filter((p) => {
      p.life -= dt;
      if (p.life <= 0) {
        this.scene.remove(p.obj);
        return false;
      }
      return true;
    });
  }

  private updateStatus() {
    let s: RigStatus = "Idle";
    const spd = this.speed;
    if (this.dead) s = "Dead";
    else if (!this.grounded) s = "Airborne";
    else if (this.reloadT >= 0) s = "Reloading";
    else if (this.hitT > 0) s = "Hit";
    else if (this.input.crouch) s = spd > 0.3 ? "Crouch-walk" : "Crouching";
    else if (this.sprinting && spd > 1) s = "Sprinting";
    else if (spd > this.getEffectiveWalkSpeed() * 1.25) s = "Running";
    else if (spd > 0.3) s = "Walking";
    else if (this.aimBlend > 0.6) s = "Aiming";
    this.status = s;

  }

  /* ---- faction tint + scale (enemies reuse this rig) ------------------ */
  /** Re-tint uniform/armor + visor while keeping human skin and hair natural. */
  setTint(bodyHex: number, visorHex?: number) {
    if (!this.model) return;
    const body = new THREE.Color(bodyHex);
    // tint the equipment loadout to match the faction
    this.equipment?.tint(bodyHex, bodyHex);
    this.model.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      const mats = Array.isArray(m.material) ? m.material : [m.material];
      mats.forEach((mat) => {
        const s = mat as THREE.MeshStandardMaterial;
        if (!s || !("color" in s)) return;
        const nm = s.name || "";
        // Never paint skin or hair green/blue/red
        if (/head|skin|face|opacity|hair|knife|pistol|tools/i.test(nm)) return;
        if (/visor/i.test(nm)) {
          if (visorHex !== undefined) {
            s.color.setHex(visorHex);
            s.emissive = new THREE.Color(visorHex).multiplyScalar(0.35);
          }
        } else if (this.isRocketbox) {
          // Gentle fabric/gear tint so Rocketbox textures keep natural depth, dark suits, & skin hands
          s.color.setHex(0xffffff).lerp(body, 0.24);
        } else {
          // multiply the authored colour so texture detail survives the tint
          s.color.copy(body);
        }
      });
    });
  }

  private static businessSuitCache = new Map<
    string,
    { map: THREE.CanvasTexture; roughnessMap: THREE.CanvasTexture; normalMap: THREE.CanvasTexture; fromPack: boolean }
  >();

  private static clothesPackBuffers = new Map<
    "suit_wool" | "suit_twill" | "suit_linen" | "shirt_cotton",
    {
      size: number;
      color: Uint8ClampedArray;
      rough: Uint8ClampedArray;
      normal: Uint8ClampedArray;
    }
  >();
  private static clothesPackPromises = new Map<string, Promise<void>>();
  private static clothesPackWaiters = new Set<() => void>();

  private static preloadClothesPacks(needed: ("suit_wool" | "suit_twill" | "suit_linen" | "shirt_cotton")[] = ["suit_wool", "shirt_cotton"]) {
    if (typeof document === "undefined") return;
    const SIZE = 256;
    const loadImgBytes = (url: string): Promise<Uint8ClampedArray | null> =>
      new Promise((resolve) => {
        const img = new Image();
        img.crossOrigin = "anonymous";
        img.onload = () => {
          const c = document.createElement("canvas");
          c.width = SIZE;
          c.height = SIZE;
          const ctx = c.getContext("2d");
          if (!ctx) return resolve(null);
          ctx.drawImage(img, 0, 0, SIZE, SIZE);
          resolve(ctx.getImageData(0, 0, SIZE, SIZE).data);
        };
        img.onerror = () => resolve(null);
        img.src = url;
      });

    const missing = needed.filter((id) => !SoldierRig.clothesPackPromises.has(id));
    if (missing.length === 0) return;

    const batch = Promise.all(
      missing.map((id) => {
        const p = Promise.all([
          loadImgBytes(`/textures/clothes/${id}/color.jpg`),
          loadImgBytes(`/textures/clothes/${id}/rough.jpg`),
          loadImgBytes(`/textures/clothes/${id}/normal.jpg`),
        ]).then(([color, rough, normal]) => {
          if (color && rough && normal) {
            SoldierRig.clothesPackBuffers.set(id, { size: SIZE, color, rough, normal });
          }
        });
        SoldierRig.clothesPackPromises.set(id, p);
        return p;
      }),
    );

    void batch.then(() => {
      if (SoldierRig.clothesPackBuffers.size > 0) {
        for (const [k, v] of SoldierRig.businessSuitCache.entries()) {
          if (!v.fromPack) {
            v.map.dispose();
            v.roughnessMap.dispose();
            v.normalMap.dispose();
            SoldierRig.businessSuitCache.delete(k);
          }
        }
        const waiters = Array.from(SoldierRig.clothesPackWaiters);
        SoldierRig.clothesPackWaiters.clear();
        waiters.forEach((cb) => cb());
      }
    });
  }

  private lastSuitPreset: SuitPresetDef | null = null;

  /** Recolor the m005 businessman suit, shirt, tie, shoes & convert bare hands into matte kidskin gloves using real CC0 cloth PBR maps. */
  private applyBusinessSuitPreset(preset: SuitPresetDef) {
    if (!this.model || typeof document === "undefined") return;
    this.lastSuitPreset = preset;

    const suitPackId: "suit_wool" | "suit_twill" | "suit_linen" =
      preset.id === "ivory"
        ? "suit_linen"
        : preset.id === "charcoal" ||
            preset.id === "midnight_navy" ||
            preset.id === "burgundy" ||
            preset.id === "emerald"
          ? "suit_twill"
          : "suit_wool";

    SoldierRig.preloadClothesPacks([suitPackId, "shirt_cotton"]);

    const suitPack = SoldierRig.clothesPackBuffers.get(suitPackId);
    const shirtPack = SoldierRig.clothesPackBuffers.get("shirt_cotton");
    const hasPack = Boolean(suitPack && shirtPack);
    if (!hasPack) {
      SoldierRig.clothesPackWaiters.add(() => {
        if (this.model && this.lastSuitPreset) {
          this.applyBusinessSuitPreset(this.lastSuitPreset);
        }
      });
    }

    const hexToSrgbBytes = (hex: string) => {
      const clean = hex.replace("#", "").trim();
      const n = parseInt(clean.length === 3 ? clean.replace(/(.)/g, "$1$1") : clean, 16);
      if (Number.isNaN(n)) return { r: 24, g: 24, b: 28 };
      return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
    };

    this.model.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      const mats = Array.isArray(m.material) ? m.material : [m.material];
      mats.forEach((mat) => {
        const s = mat as THREE.MeshStandardMaterial;
        if (!s || !("color" in s)) return;
        const nm = s.name || "";
        if (/head|skin|face|opacity|hair|knife|pistol|tools|visor/i.test(nm)) return;

        const origTex: THREE.Texture | undefined =
          (s.userData.origBodyMap as THREE.Texture | undefined) ?? s.map ?? undefined;
        if (!origTex || !origTex.image) return;
        if (!s.userData.origBodyMap) s.userData.origBodyMap = origTex;
        if (!s.userData.origNormalMap && s.normalMap) s.userData.origNormalMap = s.normalMap;

        let pair = SoldierRig.businessSuitCache.get(preset.id);
        if (!pair || (!pair.fromPack && hasPack)) {
          const img = origTex.image as CanvasImageSource & {
            width?: number;
            height?: number;
            naturalWidth?: number;
            naturalHeight?: number;
          };
          const iw = img.naturalWidth || img.width || 0;
          const ih = img.naturalHeight || img.height || 0;
          if (!iw || !ih) return;

          const w = Math.min(512, iw);
          const h = Math.min(512, ih);
          const diffCanvas = document.createElement("canvas");
          diffCanvas.width = w;
          diffCanvas.height = h;
          const dCtx = diffCanvas.getContext("2d");
          if (!dCtx) return;
          dCtx.drawImage(img, 0, 0, w, h);
          const imgData = dCtx.getImageData(0, 0, w, h);
          const d = imgData.data;

          const roughCanvas = document.createElement("canvas");
          roughCanvas.width = w;
          roughCanvas.height = h;
          const rCtx = roughCanvas.getContext("2d");
          const roughData = rCtx ? rCtx.createImageData(w, h) : null;
          const rd = roughData?.data;

          const normCanvas = document.createElement("canvas");
          normCanvas.width = w;
          normCanvas.height = h;
          const nCtx = normCanvas.getContext("2d");
          let origNormData: Uint8ClampedArray | null = null;
          const origNorm = s.userData.origNormalMap as THREE.Texture | undefined;
          if (nCtx && origNorm && origNorm.image) {
            nCtx.drawImage(origNorm.image as CanvasImageSource, 0, 0, w, h);
            origNormData = nCtx.getImageData(0, 0, w, h).data;
          }
          const normOutData = nCtx ? nCtx.createImageData(w, h) : null;
          const nd = normOutData?.data;

          const suitRgb = hexToSrgbBytes(preset.suitColor);
          const shirtRgb = hexToSrgbBytes(preset.shirtColor);
          const tieRgb = hexToSrgbBytes(preset.tieColor);
          const gloveRgb = hexToSrgbBytes(preset.gloveColor);
          const shoeRgb = hexToSrgbBytes(preset.shoeColor);

          const CLOTH_TILE = 7; // High-frequency woven cloth threads across jacket & pants

          for (let y = 0; y < h; y++) {
            const v = y / h;
            for (let x = 0; x < w; x++) {
              const u = x / w;
              const i = (y * w + x) * 4;
              const r = d[i];
              const g = d[i + 1];
              const b = d[i + 2];
              const luma = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
              const chroma = Math.max(r, g, b) - Math.min(r, g, b);

              let outR = r;
              let outG = g;
              let outB = b;
              let roughByte = 242; // ~0.95 ultra-matte tailored wool
              let nR = origNormData ? origNormData[i] : 128;
              let nG = origNormData ? origNormData[i + 1] : 128;
              let nB = origNormData ? origNormData[i + 2] : 255;

              const inHandBox = v >= 0.808 && (u <= 0.242 || u >= 0.758);
              const isHandSkin = inHandBox && r > 62 && r - g >= 4 && r - b >= 8;
              const isTie = v >= 0.825 && u >= 0.34 && u <= 0.66 && r > g + 14 && r > b + 12;
              const isShoe =
                !isHandSkin &&
                !isTie &&
                v >= 0.685 &&
                ((u >= 0.205 && u <= 0.42) || (u >= 0.58 && u <= 0.795));
              const inShirtIsland =
                (u >= 0.25 && u <= 0.38 && v >= 0.11 && v <= 0.63) ||
                (u >= 0.62 && u <= 0.75 && v >= 0.11 && v <= 0.63) ||
                (u >= 0.43 && u <= 0.57 && v >= 0.42 && v <= 0.60);
              const isShirt = inShirtIsland && luma >= 0.33 && chroma <= 30;
              const isButton =
                !isShirt &&
                !isHandSkin &&
                luma > 0.22 &&
                ((u >= 0.49 && u <= 0.525 && v >= 0.59 && v <= 0.75) ||
                  ((u <= 0.14 || u >= 0.86) && v >= 0.72 && v <= 0.80));

              if (isHandSkin) {
                // Matte kidskin leather assassin gloves preserving knuckle creases + wrist seam
                const shade = clamp((luma - 0.24) / 0.54, 0.30, 1.20);
                const grain =
                  (Math.abs(Math.sin(x * 12.9898 + y * 78.233) * 43758.5453) % 1 - 0.5) * 0.08;
                const wristSeam = v >= 0.820 && v <= 0.831 ? 0.78 : 1.0;
                const mul = Math.pow(shade, 1.12) * (1 + grain) * wristSeam;
                outR = clamp(Math.round(gloveRgb.r * mul), 0, 255);
                outG = clamp(Math.round(gloveRgb.g * mul), 0, 255);
                outB = clamp(Math.round(gloveRgb.b * mul), 0, 255);
                roughByte = 178; // ~0.70 matte kidskin leather
              } else if (isTie) {
                const tieShade = clamp(r / 152, 0.24, 1.22);
                outR = clamp(Math.round(tieRgb.r * tieShade), 0, 255);
                outG = clamp(Math.round(tieRgb.g * tieShade), 0, 255);
                outB = clamp(Math.round(tieRgb.b * tieShade), 0, 255);
                roughByte = 185; // ~0.72 matte woven tie
              } else if (isShoe) {
                const shoeShade = clamp(luma / 0.15, 0.22, 1.32);
                outR = clamp(Math.round(shoeRgb.r * shoeShade), 0, 255);
                outG = clamp(Math.round(shoeRgb.g * shoeShade), 0, 255);
                outB = clamp(Math.round(shoeRgb.b * shoeShade), 0, 255);
                roughByte = 132; // ~0.52 satin dress leather
              } else if (isShirt) {
                const shirtShade = clamp(luma / 0.76, 0.38, 1.12);
                let weaveMul = 1.0;
                let clothRough = 242;
                if (shirtPack) {
                  const sz = shirtPack.size;
                  const tx = Math.floor(u * CLOTH_TILE * sz) % sz;
                  const ty = Math.floor(v * CLOTH_TILE * sz) % sz;
                  const ti = (ty * sz + tx) * 4;
                  const cl = (shirtPack.color[ti] + shirtPack.color[ti + 1] + shirtPack.color[ti + 2]) / (3 * 255);
                  weaveMul = clamp(0.86 + cl * 0.28, 0.84, 1.12);
                  clothRough = clamp(Math.round(234 + (shirtPack.rough[ti] / 255) * 20), 234, 254);
                  nR = clamp(Math.round(nR + (shirtPack.normal[ti] - 128) * 0.45), 0, 255);
                  nG = clamp(Math.round(nG + (shirtPack.normal[ti + 1] - 128) * 0.45), 0, 255);
                }
                const mul = shirtShade * weaveMul;
                outR = clamp(Math.round(shirtRgb.r * mul), 0, 255);
                outG = clamp(Math.round(shirtRgb.g * mul), 0, 255);
                outB = clamp(Math.round(shirtRgb.b * mul), 0, 255);
                roughByte = clothRough;
              } else if (isButton) {
                outR = 26;
                outG = 28;
                outB = 34;
                roughByte = 140;
              } else if (luma > 0.012) {
                // Tailored matte wool suit jacket & slacks using CC0 ambientCG fabric Color + Roughness + NormalGL
                const suitShade = clamp(Math.pow(luma / 0.115, 0.76), 0.26, 1.28);
                let weaveMul = ((x + y) & 1) === 0 ? 1.02 : 0.98;
                let clothRough = 244; // ~0.96 matte wool
                if (suitPack) {
                  const sz = suitPack.size;
                  const tx = Math.floor(u * CLOTH_TILE * sz) % sz;
                  const ty = Math.floor(v * CLOTH_TILE * sz) % sz;
                  const ti = (ty * sz + tx) * 4;
                  const cl = (suitPack.color[ti] + suitPack.color[ti + 1] + suitPack.color[ti + 2]) / (3 * 255);
                  weaveMul = clamp(0.82 + cl * 0.36, 0.80, 1.18);
                  clothRough = clamp(Math.round(238 + (suitPack.rough[ti] / 255) * 16), 238, 254); // 0.93–0.996 strictly matte
                  nR = clamp(Math.round(nR + (suitPack.normal[ti] - 128) * 0.55), 0, 255);
                  nG = clamp(Math.round(nG + (suitPack.normal[ti + 1] - 128) * 0.55), 0, 255);
                }
                const mul = suitShade * weaveMul;
                outR = clamp(Math.round(suitRgb.r * mul), 0, 255);
                outG = clamp(Math.round(suitRgb.g * mul), 0, 255);
                outB = clamp(Math.round(suitRgb.b * mul), 0, 255);
                roughByte = clothRough;
              }

              d[i] = outR;
              d[i + 1] = outG;
              d[i + 2] = outB;

              if (rd) {
                rd[i] = roughByte;
                rd[i + 1] = roughByte;
                rd[i + 2] = roughByte;
                rd[i + 3] = 255;
              }
              if (nd) {
                nd[i] = nR;
                nd[i + 1] = nG;
                nd[i + 2] = nB;
                nd[i + 3] = 255;
              }
            }
          }

          dCtx.putImageData(imgData, 0, 0);
          const mapTex = new THREE.CanvasTexture(diffCanvas);
          mapTex.flipY = origTex.flipY;
          mapTex.colorSpace = THREE.SRGBColorSpace;
          mapTex.wrapS = origTex.wrapS;
          mapTex.wrapT = origTex.wrapT;
          mapTex.anisotropy = origTex.anisotropy || 8;
          mapTex.userData = { sharedPresetTex: true };
          mapTex.needsUpdate = true;

          let roughTex: THREE.CanvasTexture;
          if (rCtx && roughData) {
            rCtx.putImageData(roughData, 0, 0);
            roughTex = new THREE.CanvasTexture(roughCanvas);
          } else {
            roughTex = new THREE.CanvasTexture(diffCanvas);
          }
          roughTex.flipY = origTex.flipY;
          roughTex.colorSpace = THREE.NoColorSpace;
          roughTex.wrapS = origTex.wrapS;
          roughTex.wrapT = origTex.wrapT;
          roughTex.userData = { sharedPresetTex: true };
          roughTex.needsUpdate = true;

          let normTex: THREE.CanvasTexture;
          if (nCtx && normOutData) {
            nCtx.putImageData(normOutData, 0, 0);
            normTex = new THREE.CanvasTexture(normCanvas);
          } else {
            normTex = new THREE.CanvasTexture(diffCanvas);
          }
          normTex.flipY = origTex.flipY;
          normTex.colorSpace = THREE.NoColorSpace;
          normTex.wrapS = origTex.wrapS;
          normTex.wrapT = origTex.wrapT;
          normTex.anisotropy = 8;
          normTex.userData = { sharedPresetTex: true };
          normTex.needsUpdate = true;

          pair = { map: mapTex, roughnessMap: roughTex, normalMap: normTex, fromPack: hasPack };
          SoldierRig.businessSuitCache.set(preset.id, pair);
        }

        s.vertexColors = false;
        s.color.setHex(0xffffff);
        s.map = pair.map;
        s.roughnessMap = pair.roughnessMap;
        s.normalMap = pair.normalMap;
        s.normalScale.set(0.95, 0.95);
        s.roughness = 1.0;
        s.metalness = 0.0;
        if ("sheen" in s) {
          const phys = s as THREE.MeshPhysicalMaterial;
          phys.sheen = 0.0;
          phys.clearcoat = 0.0;
          phys.specularIntensity = 0.04;
        }
        s.envMapIntensity = 0.14;
        s.needsUpdate = true;
      });
    });
  }

  /** Apply full player customization (armor color/finish, tactical gear color/modules, visor glow, weapon mods). */
  setAppearance(app: SoldierAppearance) {
    if (!this.model) return;
    for (const [id, w] of this.weapons.entries()) {
      const cfg = this.weaponConfigs[id];
      if (cfg) applyWeaponCustomization(w, cfg);
      else tintWeapon(w, app.weaponFinish);
    }
    if (this.isCC0Fighter) return;
    const gear = new THREE.Color(app.gearColor);
    const visor = new THREE.Color(app.visorColor);
    const armor = new THREE.Color(app.armorColor);
    if (this.isRocketbox) {
      if (/business\.glb$/i.test(this.modelTag)) {
        const preset = getSuitPreset(app.suitPreset);
        this.applyBusinessSuitPreset(preset);
        this.equipment?.configure({
          nvg: "none",
          backpack: false,
          chestRig: false,
          holster: false,
          headset: false,
        });
        return;
      }
      const isDefaultArmor = /^#?e6e8ec$/i.test((app.armorColor || "").trim());
      this.model.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        const mats = Array.isArray(m.material) ? m.material : [m.material];
        mats.forEach((mat) => {
          const s = mat as THREE.MeshStandardMaterial;
          if (!s || !("color" in s)) return;
          const nm = s.name || "";
          if (/head|skin|face|opacity|hair|knife|pistol|tools|visor/i.test(nm)) return;
          if (isDefaultArmor) {
            s.color.setHex(0xffffff);
          } else {
            s.color.setHex(0xffffff).lerp(armor, 0.24);
          }
        });
      });
      if (this.equipment) {
        this.equipment.tint(gear.getHex(), visor.getHex(), app.visorGlow);
        this.equipment.configure({
          nvg: app.nvg,
          backpack: /military/i.test(this.modelTag) ? app.backpack : false,
          chestRig: false,
          holster: app.holster,
          headset: app.headset,
        });
      }
      return;
    }
    const finish =
      app.armorFinish === "matte"
        ? { r: 0.78, m: 0.08 }
        : app.armorFinish === "titanium"
          ? { r: 0.28, m: 0.78 }
          : { r: 0.54, m: 0.18 };

    this.equipment?.tint(gear.getHex(), visor.getHex(), app.visorGlow);
    this.equipment?.configure({
      nvg: app.nvg,
      backpack: app.backpack,
      chestRig: app.chestRig,
      holster: app.holster,
      headset: app.headset,
    });

    this.model.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      const mats = Array.isArray(m.material) ? m.material : [m.material];
      mats.forEach((mat) => {
        const s = mat as THREE.MeshStandardMaterial;
        if (!s || !("color" in s)) return;
        if (/visor/i.test(s.name)) {
          s.color.copy(visor);
          s.emissive.copy(visor);
          s.emissiveIntensity = app.visorGlow;
        } else {
          s.color.copy(armor);
          s.roughness = finish.r;
          s.metalness = finish.m;
        }
      });
    });
  }

  /** Slight height variation so no two soldiers are identical. */
  setHeightScale(f: number) {
    if (!this.model) return;
    this.model.scale.multiplyScalar(f);
    this.height = 1.82 * f;
  }

  /** World-space eye position (for enemy line-of-sight + aiming). */
  getEyePos(out = new THREE.Vector3()) {
    return out.set(this.root.position.x, this.root.position.y + this.eyeHeight, this.root.position.z);
  }

  /** advance reload clock with real dt (called from update via wrapper) */
  tickReload(dt: number) {
    if (this.reloadT >= 0) {
      this.reloadT += dt * this.reloadSpeedMult * (RELOAD_TIME / Math.max(0.4, this.reloadDuration));
      if (this.reloadT >= RELOAD_TIME) {
        this.reloadT = -1;
        this.rifle.mag.position.copy(RIFLE.magRest);
        this.rifle.mag.visible = true;
        this.rifle.charge.position.z = -0.056;
      }
    }
  }
}
