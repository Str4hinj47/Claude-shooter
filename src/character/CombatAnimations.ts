import * as THREE from "three";
import { GLTFLoader, type GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";

const BASE_URL = (import.meta as unknown as { env?: { BASE_URL?: string } }).env?.BASE_URL ?? "/";

export type CombatClipId =
  | "fight_idle"
  | "jab"
  | "cross"
  | "hook"
  | "uppercut"
  | "kick"
  | "block"
  | "dodge"
  | "hit"
  | "knockdown";

export interface CombatClipWindow {
  file: string;
  tStart: number;
  tEnd: number;
  loop: boolean;
  pingPong?: boolean;
}

export const COMBAT_CLIP_DEFS: Record<CombatClipId, CombatClipWindow> = {
  fight_idle: { file: "fight_idle.glb", tStart: 0.0, tEnd: 2.33, loop: true },
  jab: { file: "jab.glb", tStart: 0.22, tEnd: 1.05, loop: false },
  cross: { file: "cross.glb", tStart: 0.65, tEnd: 1.55, loop: false },
  hook: { file: "hook.glb", tStart: 0.72, tEnd: 1.72, loop: false },
  uppercut: { file: "uppercut.glb", tStart: 0.16, tEnd: 0.96, loop: false },
  kick: { file: "kick.glb", tStart: 0.22, tEnd: 1.28, loop: false },
  block: { file: "block.glb", tStart: 0.44, tEnd: 0.86, loop: true, pingPong: true },
  dodge: { file: "dodge.glb", tStart: 0.04, tEnd: 0.78, loop: false },
  hit: { file: "hit.glb", tStart: 0.05, tEnd: 0.78, loop: false },
  knockdown: { file: "knockdown.glb", tStart: 0.05, tEnd: 2.15, loop: false },
};

export const COMBAT_HIPS_BONE = "Hips" as const;
export const COMBAT_UPPER_BONES = [
  "Spine",
  "Spine1",
  "Spine2",
  "Neck",
  "Head",
  "LeftShoulder",
  "LeftArm",
  "LeftForeArm",
  "LeftHand",
  "RightShoulder",
  "RightArm",
  "RightForeArm",
  "RightHand",
] as const;

export const COMBAT_LOWER_BONES = [
  "LeftUpLeg",
  "LeftLeg",
  "LeftFoot",
  "LeftToeBase",
  "RightUpLeg",
  "RightLeg",
  "RightFoot",
  "RightToeBase",
] as const;

export const ALL_COMBAT_BONES = [
  COMBAT_HIPS_BONE,
  ...COMBAT_UPPER_BONES,
  ...COMBAT_LOWER_BONES,
] as const;

const UE_TO_MIXAMO_BONE: Record<string, string> = {
  pelvis: "Hips",
  spine_01: "Spine",
  spine_02: "Spine1",
  spine_03: "Spine2",
  neck_01: "Neck",
  head: "Head",
  clavicle_l: "LeftShoulder",
  upperarm_l: "LeftArm",
  lowerarm_l: "LeftForeArm",
  hand_l: "LeftHand",
  thumb_01_l: "LeftHandThumb1",
  thumb_02_l: "LeftHandThumb2",
  thumb_03_l: "LeftHandThumb3",
  index_01_l: "LeftHandIndex1",
  index_02_l: "LeftHandIndex2",
  index_03_l: "LeftHandIndex3",
  middle_01_l: "LeftHandMiddle1",
  middle_02_l: "LeftHandMiddle2",
  middle_03_l: "LeftHandMiddle3",
  ring_01_l: "LeftHandRing1",
  ring_02_l: "LeftHandRing2",
  ring_03_l: "LeftHandRing3",
  pinky_01_l: "LeftHandPinky1",
  pinky_02_l: "LeftHandPinky2",
  pinky_03_l: "LeftHandPinky3",
  clavicle_r: "RightShoulder",
  upperarm_r: "RightArm",
  lowerarm_r: "RightForeArm",
  hand_r: "RightHand",
  thumb_01_r: "RightHandThumb1",
  thumb_02_r: "RightHandThumb2",
  thumb_03_r: "RightHandThumb3",
  index_01_r: "RightHandIndex1",
  index_02_r: "RightHandIndex2",
  index_03_r: "RightHandIndex3",
  middle_01_r: "RightHandMiddle1",
  middle_02_r: "RightHandMiddle2",
  middle_03_r: "RightHandMiddle3",
  ring_01_r: "RightHandRing1",
  ring_02_r: "RightHandRing2",
  ring_03_r: "RightHandRing3",
  pinky_01_r: "RightHandPinky1",
  pinky_02_r: "RightHandPinky2",
  pinky_03_r: "RightHandPinky3",
  thigh_l: "LeftUpLeg",
  calf_l: "LeftLeg",
  foot_l: "LeftFoot",
  ball_l: "LeftToeBase",
  thigh_r: "RightUpLeg",
  calf_r: "RightLeg",
  foot_r: "RightFoot",
  ball_r: "RightToeBase",
};

/** Normalize Mixamo (`mixamorig:Hips` / `mixamorigHips`) or MakeHuman/UE (`pelvis`, `upperarm_l`) bone names. */
export function canonicalizeBoneName(rawName: string): string | null {
  if (/^mixamorig/.test(rawName)) {
    return rawName.replace(/^mixamorig:?/, "");
  }
  return UE_TO_MIXAMO_BONE[rawName] ?? null;
}

export type CombatBoneName = (typeof ALL_COMBAT_BONES)[number];

export interface BakedCombatClip {
  frames: number;
  duration: number;
  loop: boolean;
  pingPong: boolean;
  /** Packed local quaternions: `bones[name]` has length `frames * 4` (x,y,z,w). */
  bones: Partial<Record<CombatBoneName, Float32Array>>;
}

export type CombatClipBank = Partial<Record<CombatClipId, BakedCombatClip>>;

interface SourceAnimAsset {
  scene: THREE.Group;
  clip: THREE.AnimationClip;
  bones: Record<string, THREE.Object3D>;
  bindWorldQuats: Record<string, THREE.Quaternion>;
}

let sharedLoader: GLTFLoader | null = null;
function getLoader(): GLTFLoader {
  if (sharedLoader) return sharedLoader;
  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);
  sharedLoader = loader;
  return loader;
}

const sourcePromises = new Map<CombatClipId, Promise<SourceAnimAsset | null>>();
const sourceResolved = new Map<CombatClipId, SourceAnimAsset>();
const rigBankCache = new Map<string, CombatClipBank>();
const listeners = new Set<() => void>();
let preloadStarted = false;

export function onCombatClipsLoaded(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

function loadSourceClip(id: CombatClipId): Promise<SourceAnimAsset | null> {
  const existing = sourcePromises.get(id);
  if (existing) return existing;
  if (typeof window === "undefined" || typeof fetch !== "function") {
    const p = Promise.resolve(null);
    sourcePromises.set(id, p);
    return p;
  }
  const url = `${BASE_URL}animations/combat/${COMBAT_CLIP_DEFS[id].file}`;
  const p = new Promise<SourceAnimAsset | null>((resolve) => {
    getLoader().load(
      url,
      (gltf: GLTF) => {
        const clip = gltf.animations?.[0];
        if (!clip) {
          resolve(null);
          return;
        }
        gltf.scene.updateMatrixWorld(true);
        const bones: Record<string, THREE.Object3D> = {};
        const bindWorldQuats: Record<string, THREE.Quaternion> = {};
        gltf.scene.traverse((o) => {
          if (/^mixamorig/.test(o.name)) {
            const k = o.name.replace(/^mixamorig:?/, "");
            bones[k] = o;
            bindWorldQuats[k] = o.getWorldQuaternion(new THREE.Quaternion());
          }
        });
        const asset: SourceAnimAsset = { scene: gltf.scene, clip, bones, bindWorldQuats };
        sourceResolved.set(id, asset);
        resolve(asset);
      },
      undefined,
      () => resolve(null),
    );
  });
  sourcePromises.set(id, p);
  return p;
}

export function preloadCombatAnimations(): Promise<void> {
  if (preloadStarted) {
    return Promise.all(Array.from(sourcePromises.values())).then(() => undefined);
  }
  preloadStarted = true;
  const ids = Object.keys(COMBAT_CLIP_DEFS) as CombatClipId[];
  return Promise.all(ids.map((id) => loadSourceClip(id))).then(() => {
    listeners.forEach((cb) => cb());
  });
}

const ALIGN_PAIRS: [CombatBoneName, CombatBoneName][] = [
  ["LeftShoulder", "LeftArm"],
  ["LeftArm", "LeftForeArm"],
  ["LeftForeArm", "LeftHand"],
  ["RightShoulder", "RightArm"],
  ["RightArm", "RightForeArm"],
  ["RightForeArm", "RightHand"],
  ["LeftUpLeg", "LeftLeg"],
  ["LeftLeg", "LeftFoot"],
  ["RightUpLeg", "RightLeg"],
  ["RightLeg", "RightFoot"],
];

/**
 * Retarget a single loaded Mixamo source clip onto a target `SoldierRig` skeleton.
 * Temporarily aligns target A-pose limbs into the source's T-pose bind frame,
 * bakes local quaternions at 30 Hz, and restores the target skeleton's exact prior state.
 */
export function bakeClipForTargetSkeleton(
  src: SourceAnimAsset,
  def: CombatClipWindow,
  targetModel: THREE.Group,
  targetBones: Record<string, THREE.Object3D>,
): BakedCombatClip | null {
  const hips = targetBones.Hips;
  if (!hips || !src.bones.Hips) return null;

  // Save target's current local quaternions so baking is completely side-effect free
  const savedLocal = new Map<string, THREE.Quaternion>();
  for (const [k, b] of Object.entries(targetBones)) {
    savedLocal.set(k, b.quaternion.clone());
  }

  targetModel.updateMatrixWorld(true);
  src.scene.updateMatrixWorld(true);

  // Align target arm/leg segments to source Mixamo T-pose world directions
  const qA = new THREE.Quaternion();
  const qB = new THREE.Quaternion();
  const vA = new THREE.Vector3();
  const vB = new THREE.Vector3();
  const vC = new THREE.Vector3();

  for (const [bName, cName] of ALIGN_PAIRS) {
    const tb = targetBones[bName];
    const tc = targetBones[cName];
    const sb = src.bones[bName];
    const sc = src.bones[cName];
    if (!tb || !tc || !sb || !sc || !tb.parent) continue;
    const tDir = tc.getWorldPosition(vA).sub(tb.getWorldPosition(vB)).normalize();
    const sDir = sc.getWorldPosition(vC).sub(sb.getWorldPosition(new THREE.Vector3())).normalize();
    if (tDir.lengthSq() < 1e-6 || sDir.lengthSq() < 1e-6) continue;
    const fix = qA.setFromUnitVectors(tDir, sDir);
    const pW = tb.parent.getWorldQuaternion(qB).invert();
    const curW = tb.getWorldQuaternion(new THREE.Quaternion());
    tb.quaternion.copy(pW.multiply(fix.multiply(curW)));
    tb.updateMatrixWorld(true);
  }

  const tgtBindW: Partial<Record<CombatBoneName, THREE.Quaternion>> = {};
  for (const bName of ALL_COMBAT_BONES) {
    const tb = targetBones[bName];
    if (tb) tgtBindW[bName] = tb.getWorldQuaternion(new THREE.Quaternion());
  }

  const tStart = Math.max(0, Math.min(def.tStart, src.clip.duration));
  const tEnd = Math.max(tStart + 0.05, Math.min(def.tEnd, src.clip.duration));
  const span = tEnd - tStart;
  const sampleHz = 30;
  const frames = Math.max(4, Math.ceil(span * sampleHz) + 1);

  const bonesOut: Partial<Record<CombatBoneName, Float32Array>> = {};
  for (const bName of ALL_COMBAT_BONES) {
    if (targetBones[bName] && src.bones[bName] && tgtBindW[bName] && src.bindWorldQuats[bName]) {
      bonesOut[bName] = new Float32Array(frames * 4);
    }
  }

  const mixer = new THREE.AnimationMixer(src.scene);
  const action = mixer.clipAction(src.clip);
  action.play();

  const wSrcAnim = new THREE.Quaternion();
  const srcBindInv = new THREE.Quaternion();
  const deltaW = new THREE.Quaternion();
  const wTgtAnim = new THREE.Quaternion();
  const pWorldInv = new THREE.Quaternion();
  const localQ = new THREE.Quaternion();

  const boneSet = new Set<string>(ALL_COMBAT_BONES);
  const applyRecursive = (node: THREE.Object3D, fIdx: number) => {
    const canon = canonicalizeBoneName(node.name);
    if (canon) {
      const k = canon as CombatBoneName;
      if (boneSet.has(k) && bonesOut[k] && node.parent) {
        const sb = src.bones[k];
        const sbW = src.bindWorldQuats[k];
        const tbW = tgtBindW[k]!;
        sb.getWorldQuaternion(wSrcAnim);
        srcBindInv.copy(sbW).invert();
        deltaW.copy(wSrcAnim).multiply(srcBindInv);
        wTgtAnim.copy(deltaW).multiply(tbW);
        node.parent.getWorldQuaternion(pWorldInv).invert();
        localQ.copy(pWorldInv).multiply(wTgtAnim).normalize();
        node.quaternion.copy(localQ);
        node.updateMatrixWorld(true);
        const arr = bonesOut[k]!;
        const off = fIdx * 4;
        arr[off] = localQ.x;
        arr[off + 1] = localQ.y;
        arr[off + 2] = localQ.z;
        arr[off + 3] = localQ.w;
      }
    }
    for (const ch of node.children) applyRecursive(ch, fIdx);
  };

  for (let f = 0; f < frames; f++) {
    const u = frames > 1 ? f / (frames - 1) : 0;
    const t = tStart + u * span;
    mixer.setTime(t);
    src.scene.updateMatrixWorld(true);
    applyRecursive(hips, f);
  }

  mixer.stopAllAction();

  // Restore target skeleton exactly as it was before baking
  for (const [k, q] of savedLocal.entries()) {
    targetBones[k]?.quaternion.copy(q);
  }
  targetModel.updateMatrixWorld(true);

  return {
    frames,
    duration: span,
    loop: def.loop,
    pingPong: !!def.pingPong,
    bones: bonesOut,
  };
}

/**
 * Retarget a locomotion AnimationClip (e.g. Idle/Walk/Run from soldier.glb) onto any
 * canonicalized target skeleton, returning a ready-to-play THREE.AnimationClip.
 */
export function retargetAnimationClipForSkeleton(
  srcScene: THREE.Group,
  srcClip: THREE.AnimationClip,
  targetModel: THREE.Group,
  targetBones: Record<string, THREE.Object3D>,
): THREE.AnimationClip | null {
  srcScene.updateMatrixWorld(true);
  const srcBones: Record<string, THREE.Object3D> = {};
  const srcBindW: Record<string, THREE.Quaternion> = {};
  srcScene.traverse((o) => {
    const k = canonicalizeBoneName(o.name);
    if (k && !srcBones[k]) {
      srcBones[k] = o;
      srcBindW[k] = o.getWorldQuaternion(new THREE.Quaternion());
    }
  });
  const baked = bakeClipForTargetSkeleton(
    { scene: srcScene, clip: srcClip, bones: srcBones, bindWorldQuats: srcBindW },
    { file: "", tStart: 0, tEnd: srcClip.duration, loop: true },
    targetModel,
    targetBones,
  );
  if (!baked) return null;

  const times = new Float32Array(baked.frames);
  for (let i = 0; i < baked.frames; i++) {
    times[i] = baked.frames > 1 ? (i / (baked.frames - 1)) * baked.duration : 0;
  }
  const tracks: THREE.KeyframeTrack[] = [];
  for (const [canon, arr] of Object.entries(baked.bones)) {
    const tb = targetBones[canon];
    if (!tb || !arr) continue;
    tracks.push(new THREE.QuaternionKeyframeTrack(`${tb.name}.quaternion`, times, arr));
  }
  return new THREE.AnimationClip(srcClip.name, baked.duration, tracks);
}

/**
 * Retrieve (and lazily bake+cache) all loaded combat clips for a given character model key.
 * If clips are still streaming in, returns whatever is already baked and fills the rest once ready.
 */
export function getCombatBankForRig(
  cacheKey: string,
  targetModel: THREE.Group,
  targetBones: Record<string, THREE.Object3D>,
): CombatClipBank {
  let bank = rigBankCache.get(cacheKey);
  if (!bank) {
    bank = {};
    rigBankCache.set(cacheKey, bank);
  }
  for (const id of Object.keys(COMBAT_CLIP_DEFS) as CombatClipId[]) {
    if (bank[id]) continue;
    const src = sourceResolved.get(id);
    if (!src) continue;
    const baked = bakeClipForTargetSkeleton(src, COMBAT_CLIP_DEFS[id], targetModel, targetBones);
    if (baked) bank[id] = baked;
  }
  return bank;
}

const _q0 = new THREE.Quaternion();
const _q1 = new THREE.Quaternion();

/** Sample a single bone's local quaternion from a baked combat clip at normalized time `u` (0..1). */
export function sampleCombatBone(
  clip: BakedCombatClip,
  bone: CombatBoneName,
  normT: number,
  out: THREE.Quaternion,
): boolean {
  const arr = clip.bones[bone];
  if (!arr || clip.frames <= 0) return false;
  let u = normT;
  if (clip.loop) {
    u = ((u % 1) + 1) % 1;
    if (clip.pingPong) {
      u = u < 0.5 ? u * 2 : (1 - u) * 2;
    }
  } else {
    u = Math.max(0, Math.min(1, u));
  }
  const pos = u * (clip.frames - 1);
  const i0 = Math.floor(pos);
  const i1 = Math.min(clip.frames - 1, i0 + 1);
  const frac = pos - i0;
  const o0 = i0 * 4;
  const o1 = i1 * 4;
  _q0.set(arr[o0], arr[o0 + 1], arr[o0 + 2], arr[o0 + 3]);
  _q1.set(arr[o1], arr[o1 + 1], arr[o1 + 2], arr[o1 + 3]);
  out.copy(_q0).slerp(_q1, frac);
  return true;
}
