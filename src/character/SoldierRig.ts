import * as THREE from "three";
import { GLTFLoader, type GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import * as SkeletonUtils from "three/examples/jsm/utils/SkeletonUtils.js";
import soldierUrl from "../assets/soldier.glb?url";
import { applyWeaponCustomization, buildRifle, buildWeapon, RIFLE, tintWeapon, WEAPONS, type Rifle, type WeaponId, type WeaponSpec } from "./rifle";
import { buildEquipment, type EquipmentAlignMap, type SoldierEquipment } from "./equipment";
import { DEFAULT_WEAPON_CONFIGS, type SoldierAppearance, type WeaponCustomConfig } from "../game/progression";
import { Spring, clamp, damp, dampAngle, easeInOut, lerp, smoothstep, wrapAngle } from "./math";

interface CharDetailMaps {
  fabricRoughness: THREE.DataTexture;
  skinRoughness: THREE.DataTexture;
  metalRoughness: THREE.DataTexture;
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
    tex.repeat.set(repeat, repeat);
    tex.needsUpdate = true;
    return tex;
  };

  // Woven ripstop/twill fabric micro-weave for uniforms, jackets, pants & Cordura nylon
  const fabricRoughness = makeNoiseTex(128, 16, (x, y) => {
    const warp = ((x + y) & 3) === 0 ? 0.08 : 0;
    const weft = ((x - y) & 3) === 0 ? 0.06 : 0;
    const rib = ((x & 7) === 0 || (y & 7) === 0) ? 0.07 : 0;
    const hash = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
    const grain = (hash - Math.floor(hash) - 0.5) * 0.08;
    return 0.82 + warp - weft + rib + grain;
  });

  // Fine organic pore variation for realistic human skin specular break-up
  const skinRoughness = makeNoiseTex(128, 12, (x, y) => {
    const h1 = Math.sin(x * 23.17 + y * 41.73) * 19283.41;
    const h2 = Math.sin(x * 7.31 - y * 13.89) * 8192.13;
    const n1 = h1 - Math.floor(h1);
    const n2 = h2 - Math.floor(h2);
    return 0.48 + (n1 - 0.5) * 0.14 + (n2 - 0.5) * 0.08;
  });

  // Fine brushed directional grain for gunmetal blades, pistols, tools & buckles
  const metalRoughness = makeNoiseTex(128, 8, (x, y) => {
    const streak = Math.sin(y * 1.45) * 0.08;
    const h = Math.sin(x * 3.1 + y * 57.3) * 14211.7;
    return 0.24 + streak + (h - Math.floor(h) - 0.5) * 0.08;
  });

  cachedDetailMaps = { fabricRoughness, skinRoughness, metalRoughness };
  return cachedDetailMaps;
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
  });

  if (p.map) {
    p.map.anisotropy = 4;
    p.map.colorSpace = THREE.SRGBColorSpace;
  }

  if (/visor/i.test(name)) {
    p.metalness = 0.92;
    p.roughness = 0.06;
    p.clearcoat = 1.0;
    p.clearcoatRoughness = 0.04;
    p.iridescence = 0.45;
    p.iridescenceIOR = 1.35;
    p.envMapIntensity = 1.85;
  } else if (/opacity|hair/i.test(name)) {
    p.metalness = 0.0;
    p.roughness = 0.60;
    p.sheen = 0.52;
    p.sheenRoughness = 0.42;
    p.sheenColor = new THREE.Color(0xd8dee9);
    p.alphaTest = Math.max(p.alphaTest || 0, 0.44);
    p.transparent = false;
    p.side = THREE.DoubleSide;
    p.envMapIntensity = 0.85;
  } else if (/head|skin|face/i.test(name)) {
    p.metalness = 0.0;
    p.roughness = 0.52;
    p.roughnessMap = maps.skinRoughness;
    p.sheen = 0.44;
    p.sheenRoughness = 0.54;
    p.sheenColor = new THREE.Color(0xffb899);
    p.clearcoat = 0.06;
    p.clearcoatRoughness = 0.52;
    p.ior = 1.42;
    p.specularIntensity = 0.45;
    p.envMapIntensity = 0.88;
    if (p.normalMap) p.normalScale.set(0.95, 0.95);
    else {
      p.bumpMap = maps.skinRoughness;
      p.bumpScale = 0.002;
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
    p.roughness = 0.40;
    p.clearcoat = 0.34;
    p.clearcoatRoughness = 0.30;
    p.envMapIntensity = 1.1;
    if (p.normalMap) p.normalScale.set(1.35, 1.35);
  } else if (/equipment/i.test(name)) {
    p.metalness = 0.06;
    p.roughness = 0.76;
    p.roughnessMap = maps.fabricRoughness;
    p.sheen = 0.34;
    p.sheenRoughness = 0.74;
    p.sheenColor = new THREE.Color(0xcfd6df);
    p.envMapIntensity = 0.86;
    if (p.normalMap) p.normalScale.set(1.5, 1.5);
  } else if (/vanguard/i.test(name)) {
    p.metalness = 0.22;
    p.roughness = 0.48;
    p.roughnessMap = maps.fabricRoughness;
    p.sheen = 0.28;
    p.sheenRoughness = 0.65;
    p.clearcoat = 0.16;
    p.clearcoatRoughness = 0.42;
    p.envMapIntensity = 1.05;
    if (p.normalMap) p.normalScale.set(1.55, 1.55);
  } else {
    // Clothing / uniforms (_body)
    p.metalness = 0.01;
    p.roughness = 0.88;
    p.roughnessMap = maps.fabricRoughness;
    p.sheen = 0.65;
    p.sheenRoughness = 0.82;
    p.sheenColor = new THREE.Color(0xdce4ef);
    p.specularIntensity = 0.24;
    p.envMapIntensity = 0.74;
    if (p.normalMap) p.normalScale.set(1.45, 1.45);
    else {
      p.bumpMap = maps.fabricRoughness;
      p.bumpScale = 0.004;
    }
  }
  return p;
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
export function loadCachedSoldierGltf(url: string, onProgress?: (p: number) => void): Promise<GLTF> {
  let promise = cachedGltfMap.get(url);
  if (!promise) {
    promise = new GLTFLoader().loadAsync(url, (e) => {
      if (e.total) onProgress?.(e.loaded / e.total);
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
  private reloadDuration = RELOAD_TIME;
  /** tactical loadout parented to the rig (adds detail on top of the .glb) */
  equipment: SoldierEquipment | null = null;
  events: RigEvents = {};

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
  private fallAng = 0;
  private fallVel = 0;
  private fallBounced = false;
  private weaponAttached = true;
  private weaponProp: DroppedProp | null = null;
  private props: DroppedProp[] = [];
  private scene: THREE.Object3D;

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
          m.map?.dispose();
          m.emissiveMap?.dispose();
          m.roughnessMap?.dispose();
          m.bumpMap?.dispose();
          m.normalMap?.dispose();
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
    this.holstered = holstered;
    if (holstered) {
      this.reloadT = -1;
      this.rifle.mag.position.copy(this.rifle.magRest);
      this.rifle.mag.visible = true;
      this.rifle.group.visible = false;
    } else {
      this.rifle.group.visible = this.root.visible && !this.dead;
      this.aimTimer = Math.max(this.aimTimer, 1.5);
    }
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
  }

  /* ---------------------------------------------------------------- */
  /*  Loading + calibration                                            */
  /* ---------------------------------------------------------------- */
  static async load(
    scene: THREE.Object3D,
    onProgress?: (p: number) => void,
    modelUrl?: string,
  ): Promise<SoldierRig> {
    let url = modelUrl ?? soldierUrl;
    if (url === "vanguard" || /\/vanguard\.glb$/i.test(url)) {
      url = soldierUrl;
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

  private setup(gltf: { scene: THREE.Group; animations: THREE.AnimationClip[] }, cacheKey?: string) {
    const model = gltf.scene;
    this.model = model;
    // the source asset faces -Z; the rig's convention is +Z forward
    model.rotation.y = Math.PI;
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
      if (/^mixamorig/.test(o.name)) {
        const key = o.name.replace(/^mixamorig:?/, "");
        this.bones[key] = o;
      }
    });

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
    // built in model-local units and scaled to match the normalised rig
    this.buildEquipment();

    this.mixer = new THREE.AnimationMixer(model);
    const find = (n: string) => {
      const exact = gltf.animations.find((a) => a.name === n);
      if (exact) return exact;
      const fuzzy = gltf.animations.find((a) => a.name.toLowerCase().includes(n.toLowerCase()));
      if (fuzzy) return fuzzy;
      // last resort: reuse the first clip so a swapped model never crashes the game
      return gltf.animations[0];
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
    this.hipsPosAnimated = gltf.animations.some((c) =>
      c.tracks.some((t) => t.name.includes("Hips.position")),
    );
    this.calibrate(cacheKey);
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
    const modelQInv = this.model.getWorldQuaternion(new THREE.Quaternion()).invert();
    (["Left", "Right"] as Side[]).forEach((side) => {
      const hand = this.bones[`${side}Hand`];
      const mid = this.bones[`${side}HandMiddle1`] ?? this.bones[`${side}HandMiddle`];
      const hp = hand.getWorldPosition(new THREE.Vector3());
      const mp = mid.getWorldPosition(new THREE.Vector3());
      const f0 = mp.sub(hp).normalize();
      const p0 = new THREE.Vector3(0, -1, 0);
      p0.sub(f0.clone().multiplyScalar(p0.dot(f0))).normalize();
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
          const axis = new THREE.Vector3().crossVectors(dir, p0).normalize(); // curls toward palm
          const bq = modelQInv.clone().multiply(b.getWorldQuaternion(new THREE.Quaternion()));
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
    if (this.sprintBlend > 0.4 || this.aimBlend < 0.55) {
      this.aimTimer = 3;
      return false;
    }
    if (this.mag <= 0) {
      this.fireCd = 0.25;
      this.events.onDry?.();
      return false;
    }
    this.mag--;
    this.fireCd = this.fireInterval;
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
    this.fallAng = 0;
    this.fallVel = kind === "back" ? 0.6 : 0.9;
    this.fallBounced = false;
    this.reloadT = -1;
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
    this.fallVel = 0;
    this.fallBounced = false;
    this.fall.rotation.set(0, 0, 0);
    this.fall.position.set(0, 0, 0);
    this.root.visible = true;
    this.fall.visible = true;
    if (this.model) this.model.visible = true;
    if (this.bones.Hips) this.bones.Hips.position.copy(this.bindHipsLocal);
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
    this.fireCd = Math.max(0, this.fireCd - dt);
    this.hitT = Math.max(0, this.hitT - dt);

    this.groundY = groundY;
    this.updateLocomotion(dt);
    this.updateAnimBase(dt);
    this.model.updateMatrixWorld(true);
    this.updateProcedural(dt);
    this.updateProps(dt);
    this.tickReload(dt);
    this.updateStatus();
  }

  private updateLocomotion(dt: number) {
    const inp = this.input;
    const wantMove = !this.dead && inp.move.lengthSq() > 0.0004;
    let target = 0;
    let rel = 0;
    const dir = new THREE.Vector3();
    if (wantMove) {
      dir.copy(inp.move).setY(0).normalize();
      const psi = Math.atan2(dir.x, dir.z);
      rel = wrapAngle(psi - this.aimYaw);
      const sprintOK = inp.sprint && !inp.crouch && !inp.ads && !this.carryingBody && Math.abs(rel) < 1.1 && this.reloadT < 0;
      this.sprinting = sprintOK;
      const baseSpd = sprintOK
        ? this.runN
        : inp.crouch
          ? this.walkN * 0.6 * this.crouchSpeedMult
          : inp.ads
            ? this.walkN * 0.55
            : this.walkN;
      target = this.carryingBody ? baseSpd * this.carrySpeedMult : baseSpd;
    } else {
      this.sprinting = false;
    }
    // facing + direction of the legs relative to aim (with hysteresis to prevent 1-frame stride flips)
    let legOffset = 0;
    if (wantMove) {
      if (this.moveSign > 0) {
        if (Math.abs(rel) > 2.15) this.moveSign = -1;
      } else if (Math.abs(rel) < 1.8) {
        this.moveSign = 1;
      }
      if (this.moveSign > 0) {
        legOffset = clamp(rel, -1.35, 1.35);
      } else {
        legOffset = clamp(wrapAngle(rel - Math.PI), -1.35, 1.35);
      }
    }
    this.legOffsetS = damp(this.legOffsetS, legOffset, 10, dt);
    this.moveSignSmooth = damp(this.moveSignSmooth, this.moveSign, 13, dt);

    const desired = dir.multiplyScalar(target);
    const rate = this.grounded ? (wantMove ? 8 : 11) : 2.6;
    this.vel.x = damp(this.vel.x, desired.x, rate, dt);
    this.vel.z = damp(this.vel.z, desired.z, rate, dt);
    if (this.dead) {
      this.vel.x = damp(this.vel.x, 0, 3, dt);
      this.vel.z = damp(this.vel.z, 0, 3, dt);
    }
    this.root.position.x = clamp(this.root.position.x + this.vel.x * dt, -this.worldBound, this.worldBound);
    this.root.position.z = clamp(this.root.position.z + this.vel.z * dt, -this.worldBound, this.worldBound);

    // vertical
    const groundLevel = this.groundY;
    if (!this.grounded) {
      this.vy -= 15 * dt;
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
        this.bodyYaw = dampAngle(this.bodyYaw, this.aimYaw + this.legOffsetS, 11, dt);
        this.turning = false;
      } else {
        const aiming = this.aimBlend > 0.5;
        const thr = aiming ? 0.8 : 1.15;
        if (Math.abs(diff) > thr) this.turning = true;
        if (this.turning) {
          this.bodyYaw = dampAngle(this.bodyYaw, this.aimYaw, 7, dt);
          if (Math.abs(diff) < 0.12) this.turning = false;
        }
      }
    }
    this.turnBlend = damp(this.turnBlend, this.turning ? 1 : 0, 9, dt);
    const angVel = wrapAngle(this.bodyYaw - this.prevBodyYaw) / Math.max(dt, 1e-4);
    const targetBank = clamp(-angVel * 0.032, -0.09, 0.09) * smoothstep(0.4, 2.2, this.speed);
    this.turnLeanS = damp(this.turnLeanS, this.dead ? 0 : targetBank, 9, dt);
    this.root.rotation.y = this.bodyYaw;
  }

  private updateAnimBase(dt: number) {
    const a = this.actions;
    this.airBlend = damp(this.airBlend, this.grounded ? 0 : 1, this.grounded ? 14 : 18, dt);
    const spd = this.speed;
    const animSpd = this.dead ? 0 : Math.max(spd, this.turnBlend * 0.95);
    const targetLoco = smoothstep(0.03, 0.72, animSpd);
    this.locoBlend = damp(this.locoBlend, targetLoco, targetLoco > this.locoBlend ? 11.5 : 8.5, dt);
    const runW = clamp((animSpd - this.walkN * 0.92) / Math.max(0.2, this.runN - this.walkN * 0.92), 0, 1);
    const runE = easeInOut(runW);
    this.runBlend = damp(this.runBlend, runE, 8.5, dt);

    const stride = lerp(this.walkStride, this.runStride, this.runBlend);
    if (!this.dead) {
      const airRate = lerp(1.0, 0.2, this.airBlend);
      const prevCum = this.cum;
      if (this.locoBlend > 0.02) {
        this.cum += this.moveSignSmooth * (animSpd / Math.max(stride, 0.1)) * airRate * dt;
      }
      // Gently settle stride phase toward neutral plant when stopping
      if (targetLoco < 0.05 && this.locoBlend > 0.01 && this.grounded) {
        const nearestPlant = Math.round(this.cum * 2) * 0.5;
        this.cum = damp(this.cum, nearestPlant, 7, dt);
      }
      this.phase = ((this.cum % 1) + 1) % 1;
      if (this.grounded && this.locoBlend > 0.3) {
        const inten = clamp(animSpd / this.runN + 0.25, 0.25, 1);
        const s1 = this.walkOff;
        const s2 = this.walkOff + 0.5;
        if (Math.floor(this.cum - s1) !== Math.floor(prevCum - s1)) this.events.onFootstep?.(0, inten);
        if (Math.floor(this.cum - s2) !== Math.floor(prevCum - s2)) this.events.onFootstep?.(1, inten);
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
    a.idle.setEffectiveWeight(rawIdle / wSum);
    a.walk.setEffectiveWeight(rawWalk / wSum);
    a.run.setEffectiveWeight(rawRun / wSum);
    this.mixer.update(0);
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
    this.aimBlend = damp(this.aimBlend, wantAim ? 1 : 0, wantAim ? 13 : 4.5, dt);
    this.sprintBlend = damp(this.sprintBlend, this.sprinting ? 1 : 0, 7, dt);
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

    // ----- death: fall simulation
    let deathBuckle = 0;
    if (dead) {
      const t = this.deathT;
      if (t > 0.18) {
        const acc = 24 * Math.sin(Math.min(this.fallAng, Math.PI / 2) + 0.35);
        this.fallVel += acc * dt;
        this.fallAng += this.fallVel * dt;
        if (this.fallAng >= Math.PI / 2) {
          this.fallAng = Math.PI / 2;
          if (!this.fallBounced && this.fallVel > 1.2) {
            this.fallVel = -this.fallVel * 0.16;
            this.fallBounced = true;
          } else this.fallVel = 0;
        } else if (this.fallAng < 0.2 && this.fallVel < 0) {
          this.fallAng = 0.2;
          this.fallVel = 0;
        }
      }
      const k = this.fallAng / (Math.PI / 2);
      const sign = this.deathKind === "back" ? -1 : 1;
      this.fall.rotation.x = sign * this.fallAng;
      this.fall.position.y = 0.11 * Math.sin(this.fallAng);
      this.fall.position.z = sign * 0.42 * k; // body slides in the direction of the fall
      // buckle knees first, straighten as body lies flat
      deathBuckle = (smoothstep(0, 0.35, t) * 0.8) * (1 - smoothstep(0.45, 1.0, k));
    } else if (this.fall.rotation.x !== 0) {
      this.fall.rotation.x = damp(this.fall.rotation.x, 0, 12, dt);
      this.fall.position.y = damp(this.fall.position.y, 0, 12, dt);
      this.fall.position.z = damp(this.fall.position.z, 0, 12, dt);
      if (Math.abs(this.fall.rotation.x) < 0.001) {
        this.fall.rotation.set(0, 0, 0);
        this.fall.position.set(0, 0, 0);
      }
    }

    // Always restore bind Hips offset on Rocketbox rigs before leg IK so hips never pop or sink
    if (!this.hipsPosAnimated && B.Hips) B.Hips.position.copy(this.bindHipsLocal);
    this.model.updateMatrixWorld(true);

    // ----- LEGS : smooth crouch / landing / airborne via two-bone IK
    const rawDepth = Math.max(0, this.crouchAmt * 0.38 + sLand + deathBuckle * 0.5);
    const rawLift = this.airBlend * 0.3;
    this.legDepthS = damp(this.legDepthS, rawDepth, 18, dt);
    this.legLiftS = damp(this.legLiftS, rawLift, 16, dt);
    if (this.legDepthS > 0.0005 || this.legLiftS > 0.0005) this.applyLegs(this.legDepthS, this.legLiftS, dead);

    // ----- TORSO : aim twist/pitch/lean + turn banking + reactions
    this.model.updateMatrixWorld(true);
    const bodyYawNow = this.root.rotation.y;
    const hipPos = B.Hips.getWorldPosition(this.tmpV);
    void hipPos;

    const twist = clamp(wrapAngle(this.aimYaw - bodyYawNow), -1.7, 1.7);
    const blade = -0.28 * this.aimBlend * (1 - this.sprintBlend);
    const sprintTwist = this.sprintBlend * 0.1;
    const idleSwayYaw = Math.sin(this.time * 0.85) * 0.024 * (1 - this.locoBlend) * (1 - this.aimBlend);
    const yawTot = dead ? 0 : twist + blade + sprintTwist + idleSwayYaw + hT * 0.5;
    const pitchK = lerp(0.55, 1, this.aimBlend);
    const crouchLean = this.crouchAmt * 0.22 + sLand * 0.5;
    const breath = Math.sin(this.time * 1.7) * 0.012 * (1 + this.aimBlend);
    const pitchTot = dead
      ? 0
      : -this.aimPitch * pitchK + crouchLean + hP * 0.5 + breath + rRot * 0.05 + tKick * 0.04 + this.sprintBlend * 0.08;
    const rollTot = dead ? 0 : -this.leanS * 0.3 + this.turnLeanS + hR * 0.4;

    const yawFrame = bodyYawNow + yawTot;
    const rightAxis = new THREE.Vector3(Math.cos(yawFrame), 0, -Math.sin(yawFrame));
    const fwdAxis = new THREE.Vector3(Math.sin(yawFrame), 0, Math.cos(yawFrame));
    const qYaw = new THREE.Quaternion().setFromAxisAngle(AXIS_Y, yawTot);
    const qPitch = new THREE.Quaternion().setFromAxisAngle(rightAxis, pitchTot);
    const qRoll = new THREE.Quaternion().setFromAxisAngle(fwdAxis, rollTot);
    const qTot = qRoll.multiply(qPitch).multiply(qYaw);
    if (!dead) {
      this.rotateChain(["Spine", "Spine1", "Spine2"], qTot, [0.3, 0.32, 0.32]);
      // Subtle clavicle breathing lift so idle operators feel alive
      const clavLift = Math.sin(this.time * 1.7) * 0.015;
      if (B.LeftShoulder) this.rotateWorld(B.LeftShoulder, new THREE.Quaternion().setFromAxisAngle(fwdAxis, clavLift));
      if (B.RightShoulder) this.rotateWorld(B.RightShoulder, new THREE.Quaternion().setFromAxisAngle(fwdAxis, -clavLift));
      // head: look at the aim point, a little less than the chest
      const headQ = new THREE.Quaternion().setFromAxisAngle(rightAxis, -this.aimPitch * 0.4 + headS * 0.1 + hP * 0.3).multiply(new THREE.Quaternion().setFromAxisAngle(AXIS_Y, yawTot * 0.18));
      this.rotateChain(["Neck", "Head"], headQ, [0.45, 0.55]);
    } else {
      // limp spine + head lolling
      const sgn = this.deathKind === "back" ? 1 : -1;
      const curl = new THREE.Quaternion().setFromAxisAngle(rightAxis, sgn * 0.35 * smoothstep(0.1, 0.8, this.deathT));
      this.rotateChain(["Spine", "Spine1", "Spine2"], curl, [0.35, 0.35, 0.3]);
      const loll = new THREE.Quaternion().setFromAxisAngle(rightAxis, headS * 0.12 - sgn * 0.25);
      this.rotateChain(["Neck", "Head"], loll, [0.5, 0.5]);
    }

    this.model.updateMatrixWorld(true);

    // ----- WEAPON + ARMS
    if (this.carryingBody && !this.dead) {
      this.updateCarryArms();
    } else if (this.weaponAttached && !this.holstered) {
      this.updateWeaponAndArms(dt, { rRot, rPos, rYaw, armL, armR });
    } else if (!this.weaponAttached) {
      this.updateDeadArms(armL, armR);
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
  private applyLegs(depth: number, lift: number, dead: boolean) {
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
    // restore bind offset first when clips don't animate hips position,
    // otherwise last frame's lowering persists and accumulates (sink bug)
    if (!this.hipsPosAnimated) hips.position.copy(this.bindHipsLocal);
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
      // jump tuck: lift feet and slightly pull the rear foot back
      target.y += lift * (i === 0 ? 1 : 0.8);
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
  private updateWeaponAndArms(dt: number, s: { rRot: number; rPos: number; rYaw: number; armL: number; armR: number }) {
    const B = this.bones;
    const rShoulder = B.RightArm.getWorldPosition(new THREE.Vector3());
    const lShoulder = B.LeftArm.getWorldPosition(new THREE.Vector3());

    // desired weapon aim: from shoulder to aim point (parallax-correct), no closer than 4m
    const toAim = this.aimPoint.clone().sub(rShoulder);
    if (toAim.length() < 4) toAim.normalize().multiplyScalar(4);
    const dYaw = Math.atan2(toAim.x, toAim.z);
    const dPitch = Math.atan2(toAim.y, Math.hypot(toAim.x, toAim.z));
    this.wYaw = dampAngle(this.wYaw, dYaw, 26, dt);
    this.wPitch = damp(this.wPitch, dPitch, 26, dt);

    const a = this.aimBlend;
    const sp = this.sprintBlend;
    // reload envelope
    let rb = 0;
    if (this.reloadT >= 0) {
      const t = this.reloadT;
      rb = smoothstep(0, 0.35, t) * (1 - smoothstep(2.55, 2.9, t));
    }
    const lowReady = 1 - a;

    // pose parameters (angles in rad; positive down = nose down)
    const dx = lowReady * 0.5 + sp * 0.55 + rb * 0.22;
    const dy = sp * 0.75 + lowReady * 0.15;
    const roll = sp * 0.35 - rb * 0.55;

    const aimQ = new THREE.Quaternion().setFromEuler(new THREE.Euler(-this.wPitch + (this.input.ads ? 0 : 0), this.wYaw + s.rYaw * 0.02, 0, "YXZ"));
    // weapon-local pose offset
    const poseQ = new THREE.Quaternion().setFromEuler(new THREE.Euler(dx - s.rRot * 0.045, dy, roll, "YXZ"));
    const wq = aimQ.clone().multiply(poseQ);

    // position relative to the right shoulder, expressed in aim frame
    const isPistol = this.rifle.weaponId === "pistol";
    const pAim = isPistol ? V(0.052, -0.052, 0.45) : V(0.075, -0.095, 0.36);
    const pLow = isPistol ? V(0.085, -0.2, 0.32) : V(0.1, -0.2, 0.3);
    const pSprint = isPistol ? V(0.13, -0.25, 0.23) : V(0.16, -0.27, 0.22);
    const pReload = isPistol ? V(0.07, -0.14, 0.36) : V(0.1, -0.17, 0.33);
    const off = pAim.clone().lerp(pLow, lowReady).lerp(pSprint, sp).lerp(pReload, rb);
    off.z -= s.rPos * 0.035;
    off.y += s.rPos * 0.008;
    const wpos = rShoulder.clone().add(off.applyQuaternion(aimQ));
    // breathing sway
    wpos.y += Math.sin(this.time * 1.7) * 0.003 * (1 + a);
    wpos.x += Math.sin(this.time * 0.9) * 0.0015;

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

    // ---- right hand (grip)
    const RF = V(0.35, -0.42, 0.84);
    const RP = V(1, 0.25, 0);
    const rf = dirW(RF);
    const rp = dirW(RP);
    const rfN = rf.clone();
    const rpalm = toW(RIFLE.rightPalm);
    const rWrist = rpalm.clone().addScaledVector(rfN, -0.075);

    // ---- left hand (grip or reload animation)
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

    // wobble from hits
    const wob = new THREE.Vector3(0, s.armL * 0.002, 0);
    lWrist.add(wob);
    rWrist.add(new THREE.Vector3(0, s.armR * 0.002, 0));

    // elbows hang down and slightly out
    const yawQ = new THREE.Quaternion().setFromAxisAngle(AXIS_Y, this.wYaw);
    const poleR = V(-0.55, -1, -0.25).applyQuaternion(yawQ);
    const poleL = V(0.6, -1, -0.3).applyQuaternion(yawQ);
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

  private solveArm(side: Side, wrist: THREE.Vector3, f: THREE.Vector3, p: THREE.Vector3, pole: THREE.Vector3) {
    const B = this.bones;
    const up = B[`${side}Arm`];
    const fore = B[`${side}ForeArm`];
    const hand = B[`${side}Hand`];
    this.twoBoneIK(up, fore, hand, wrist, pole, 0.995);
    // distribute wrist twist onto the forearm to avoid candy-wrapper skinning
    const target = this.handTargetQuat(side, f, p);
    const cur = hand.getWorldQuaternion(new THREE.Quaternion());
    const delta = target.clone().multiply(cur.invert());
    const ax = hand.getWorldPosition(new THREE.Vector3()).sub(fore.getWorldPosition(new THREE.Vector3())).normalize();
    const proj = delta.x * ax.x + delta.y * ax.y + delta.z * ax.z;
    const twist = 2 * Math.atan2(proj, delta.w);
    const tw = wrapAngle(twist) * 0.55;
    this.rotateWorld(fore, new THREE.Quaternion().setFromAxisAngle(ax, tw));
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
      const floor = p === this.weaponProp ? 0.07 : 0.04;
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
    else if (spd > this.walkN * 1.4) s = "Running";
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
          // Subtle fabric/gear tint so Rocketbox textures keep natural depth & camo pattern
          s.color.setHex(0xffffff).lerp(body, 0.42);
        } else {
          // multiply the authored colour so texture detail survives the tint
          s.color.copy(body);
        }
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
    const gear = new THREE.Color(app.gearColor);
    const visor = new THREE.Color(app.visorColor);
    const armor = new THREE.Color(app.armorColor);
    if (this.isRocketbox) {
      this.model.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        const mats = Array.isArray(m.material) ? m.material : [m.material];
        mats.forEach((mat) => {
          const s = mat as THREE.MeshStandardMaterial;
          if (!s || !("color" in s)) return;
          const nm = s.name || "";
          if (/head|skin|face|opacity|hair|knife|pistol|tools|visor/i.test(nm)) return;
          s.color.setHex(0xffffff).lerp(armor, 0.36);
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
      this.reloadT += dt * (RELOAD_TIME / Math.max(0.4, this.reloadDuration));
      if (this.reloadT >= RELOAD_TIME) {
        this.reloadT = -1;
        this.rifle.mag.position.copy(RIFLE.magRest);
        this.rifle.mag.visible = true;
        this.rifle.charge.position.z = -0.056;
      }
    }
  }
}
