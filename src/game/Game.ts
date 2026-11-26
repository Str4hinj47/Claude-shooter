import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import {
  BloomEffect,
  EffectComposer,
  EffectPass,
  RenderPass,
  SMAAEffect,
  SMAAPreset,
  ToneMappingEffect,
  ToneMappingMode,
} from "postprocessing";
import { N8AOPostPass } from "n8ao";
import { SoldierRig, MAG_SIZE, type RigStatus } from "../character/SoldierRig";
import { WEAPONS, type WeaponId } from "../character/rifle";
import { type World, type SurfaceKind } from "./world";
import { buildLevelAsync, type LevelResult } from "./levels";
import { CombatFX, Sfx } from "./fx";
import { NavMeshSystem } from "./ai/NavMeshSystem";
import { JoltPhysicsWorld } from "./physics/JoltPhysicsWorld";
import { buildBvhForObjects, disposeBvhForObjects, installBvhPatches } from "./physics/BvhAccelerator";
import { OrganicMotionNoise } from "../character/AnimationMotion";
import { Spring, clamp, damp, lerp } from "../character/math";
import { Ally, Enemy, Fighter, RescueNPC, resolveCircleAABBs, type CombatHost, type SoundKind, type SquadCommsKind } from "./Enemy";
import {
  BOSS_TAUNTS,
  getNextChapterAfterSurveillance,
  getStoryChapterForSurveillance,
  MISSIONS,
  OPEN_WORLD_MISSION,
  type DialogueLine,
  type MissionDef,
  type ObjectiveDef,
} from "./story";
import { createInteractableProp, type InteractableInstance } from "./interactables";
import {
  APARTMENTS,
  awardDrivingCredits,
  awardMissionReward,
  DIFFICULTY_PROFILES,
  getMissionConsequences,
  getPlayerStats,
  getWeaponCustomConfig,
  getWeaponModEffects,
  loadSave,
  recordDiscoveredDistrict,
  SAVE_KEY,
  writeSave,
  type ApartmentId,
  type DifficultyMode,
  type MissionReward,
  type PlayerStats,
  type SoldierAppearance,
  type WeaponCustomConfig,
} from "./progression";
import { type CarId } from "./vehicles/catalog";
import { WEATHER_MODES, type WeatherMode } from "./vehicles/weather";
import { VehicleAudio, type EngineHud } from "./vehicles/audio/VehicleAudio";
import { NpcVoiceSystem } from "./city/NpcVoices";
import { TIME_OF_DAY_LABELS, TIME_OF_DAY_MODES, type TimeOfDayMode } from "./city/WestgateMeta";
import type { MinimapData } from "./city/MinimapData";
import type { SurveillanceHudState } from "./city/ContractSurveillance";
import {
  SAFEHOUSE_CAR_SPOT,
  SAFEHOUSE_STATIONS,
  SAFEHOUSE_YAW,
  safehouseLocalToWorld,
  updateSafehouseGarageDoor,
} from "./city/SafehouseResidence";
import {
  getOpenWorldMissionSite,
  localToWorldMissionPos,
  localToWorldMissionYaw,
  type OpenWorldMissionSite,
} from "./city/OpenWorldMissions";
import type { HomeStation, StationKind } from "./city/HomeInteriors";
import { characterUrl, loadCharacterId } from "./characters";
import type { SpatialAABBGrid } from "./city/SpatialIndex";
import {
  getMissionCallForMission,
  getMissionCallForSurveillance,
  MISSION_CALLS,
  type MissionCallDef,
} from "./missionCalls";
export { loadSave, SAVE_KEY };

export type CameraPreset = "close" | "chase" | "far" | "hood" | "bumper" | "free";

export interface CameraSettings {
  preset: CameraPreset;
  distance: number;
  height: number;
  fov: number;
  lookAhead: number;
}

export const CAMERA_PRESETS: Record<CameraPreset, Omit<CameraSettings, "preset">> = {
  close: { distance: 5.2, height: 2.0, fov: 62, lookAhead: 7 },
  chase: { distance: 7.0, height: 2.6, fov: 60, lookAhead: 9 },
  far: { distance: 10.0, height: 3.8, fov: 56, lookAhead: 12 },
  hood: { distance: 1.15, height: 1.12, fov: 68, lookAhead: 30 },
  bumper: { distance: 2.25, height: 0.55, fov: 70, lookAhead: 30 },
  free: { distance: 7.0, height: 2.6, fov: 60, lookAhead: 9 },
};

export const CAMERA_ORDER: CameraPreset[] = ["close", "chase", "far", "hood", "bumper", "free"];

export interface ObjectiveState {
  id: string;
  label: string;
  done: boolean;
  progress: number;
  total: number;
}

export interface MissionHud {
  id: number;
  codename: string;
  name: string;
  location: string;
  timeOfDay: string;
  accent: string;
}

export interface BossHud {
  name: string;
  hp: number;
  maxHp: number;
  surged?: boolean;
}

export interface HudState {
  loading: boolean;
  progress: number;
  phase: "idle" | "loading" | "ready" | "dead" | "complete";
  mission: MissionHud | null;
  objectives: ObjectiveState[];
  dialogue: DialogueLine | null;
  boss: BossHud | null;
  paused: boolean;
  kills: number;
  ammo: number;
  reserve: number;
  health: number;
  maxHealth: number;
  armor: number;
  maxArmor: number;
  status: RigStatus;
  speed: number;
  reloading: boolean;
  reloadProgress: number;
  locked: boolean;
  dead: boolean;
  crouch: boolean;
  ads: boolean;
  sprint: boolean;
  showcase: boolean;
  fps: number;
  spread: number;
  hitMarker: number;
  hitCrit: boolean;
  hitKill: boolean;
  damageFlash: number;
  damageDirRad: number;
  timeScale: number;
  weaponIndex: number;
  weaponName: string;
  weaponCategory: string;
  zoomFactor: number;
  suppressed: boolean;
  stealthState: "hidden" | "caution" | "compromised";
  suspicion: number;
  stealthIndicators: {
    id: number;
    angle: number;
    suspicion: number;
    state: "idle" | "patrol" | "alert" | "attack";
    seeing: boolean;
  }[];
  stealthKills: number;
  alerts: number;
  takedownReady: boolean;
  interact: { label: string; kind: string; progress: number; holding: boolean } | null;
  extractReady: boolean;
  extractDist: number | null;
  extractDirAngle: number | null;
  isOpenWorld: boolean;
  district: { id: string; name: string; subtitle: string } | null;
  weatherMode: WeatherMode;
  weatherLabel: string;
  timeOfDay: TimeOfDayMode;
  timeOfDayLabel: string;
  activityToast: { title: string; subtitle: string; accent: string } | null;
  nearbyContract: {
    missionId: number;
    codename: string;
    name: string;
    location: string;
    unlocked: boolean;
    completed: boolean;
    accent: string;
  } | null;
  nextContractMarker: {
    missionId: number;
    codename: string;
    name: string;
    district: string;
    dist: number;
    dirAngle: number;
    screenX: number;
    screenY: number;
    onScreen: boolean;
    accent: string;
  } | null;
  hasOpenWorldReturn: boolean;
  cameraPreset: CameraPreset;
  credits: number;
  muted?: boolean;
  sfxVolume?: number;
  engineVolume?: number;
  aimSensitivity?: number;
  invertY?: boolean;
  holstered: boolean;
  weaponWheelOpen: boolean;
  mapOpen: boolean;
  phoneOpen: boolean;
  phoneInitialTab: "home" | "contracts";
  activeApartment: { id: ApartmentId; name: string; address: string } | null;
  activeGarage: { id: ApartmentId; name: string; address: string } | null;
  homeStation: {
    id: string;
    kind: StationKind;
    label: string;
    sublabel?: string;
    apartmentId?: ApartmentId;
    apartmentName?: string;
    price?: number;
    owned?: boolean;
    carId?: CarId;
  } | null;
  vehicle: {
    active: boolean;
    name: string;
    kind: string;
    speedKmh: number;
    rpm: number;
    gear: number;
    redline: number;
    nearbyName: string | null;
    signal: "left" | "right" | null;
    signalLit: boolean;
    hpPct: number;
    disabled: boolean;
    isPolice: boolean;
    sirenOn: boolean;
  } | null;
  wanted: { stars: number; evading: boolean; evasionPct: number } | null;
  radioStation: { name: string; genre: string } | null;
  activeRace: {
    raceName: string;
    checkpoint: number;
    totalCheckpoints: number;
    place: number;
    totalRacers: number;
    elapsed: number;
  } | null;
  aircraft: {
    active: boolean;
    name: string;
    kind: "helicopter" | "airplane";
    altitude: number;
    speedKmh: number;
    throttlePct: number;
  } | null;
  boat: {
    active: boolean;
    name: string;
    speedKmh: number;
    hasBody: boolean;
  } | null;
  carryingBody: boolean;
  trunkBodiesCount: number;
  parachuting: boolean;
  swimming: boolean;
  binoculars: { open: boolean; zoom: string; rangeM: number };
  stashesFound: number;
  totalStashes: number;
  nearbyPrompt: { key: "F" | "G"; label: string; accent: string } | null;
  surveillance: SurveillanceHudState | null;
  incomingCall: {
    id: string;
    callerName: string;
    callerRole: string;
    codename: string;
    transcript: string;
    accent: string;
    status: "ringing" | "active";
  } | null;
  gtaDirective: {
    verb: string;
    text: string;
    subtext?: string;
    accent: string;
    distM?: number | null;
  } | null;
  cinematic: {
    kind: "intro" | "extract";
    codename: string;
    title: string;
    subtitle: string;
    accent: string;
    progress: number;
  } | null;
  weapons: { slot: number; shortName: string; category: string; mag: number; reserve: number }[];
}

export type Trigger = "reload" | "jump" | "hit" | "dieBack" | "dieFront" | "respawn" | "showcase";
export type Held = "fire" | "ads" | "sprint" | "crouch";

export interface GameCallbacks {
  onHud: (s: HudState) => void;
  onMissionEnd: (mission: MissionDef, success: boolean, reward?: MissionReward) => void;
  onOpenHomeStation?: (kind: "garage_mod" | "weapon_bench" | "closet" | "apt_buy" | "intel_board", apartmentId?: ApartmentId, carId?: CarId) => void;
  /** player character GLB URL (defaults to the saved Rocketbox operator) */
  characterUrl?: string;
}

function disposeObject(obj: THREE.Object3D) {
  obj.traverse((o) => {
    const m = o as THREE.Mesh;
    const sharedAsset = !!o.userData?.sharedGltfAsset;
    if (m.geometry && !sharedAsset) m.geometry.dispose();
    const mats = Array.isArray(m.material) ? m.material : m.material ? [m.material] : [];
    for (const mat of mats) {
      if (!sharedAsset) {
        const t = mat as THREE.Material & { map?: THREE.Texture; emissiveMap?: THREE.Texture; bumpMap?: THREE.Texture };
        t.map?.dispose();
        t.emissiveMap?.dispose();
        t.bumpMap?.dispose();
      }
      mat.dispose();
    }
  });
}

interface VehicleBoxCollider {
  pos: { x: number; y: number; z: number };
  yaw: number;
  width: number;
  length: number;
  height?: number;
  speed: number;
  isNpcTraffic?: boolean;
  crashTimer?: number;
  vx?: number;
  vz?: number;
}

function vehicleRoofHeightAt(
  pos: THREE.Vector3,
  vehicles: readonly VehicleBoxCollider[],
): number {
  let best = -Infinity;
  for (let i = 0; i < vehicles.length; i++) {
    const v = vehicles[i];
    const h = v.height ?? 1.42;
    const top = v.pos.y + h * 0.86;
    if (pos.y < top - 0.34 || pos.y > v.pos.y + h + 1.5) continue;
    const dx = pos.x - v.pos.x;
    const dz = pos.z - v.pos.z;
    const maxR = Math.max(v.width, v.length) * 0.6 + 0.35;
    if (Math.abs(dx) > maxR || Math.abs(dz) > maxR) continue;
    const c = Math.cos(v.yaw);
    const s = Math.sin(v.yaw);
    const lx = dx * c - dz * s;
    const lz = dx * s + dz * c;
    if (Math.abs(lx) <= v.width * 0.5 + 0.14 && Math.abs(lz) <= v.length * 0.5 + 0.14) {
      if (top > best) best = top;
    }
  }
  return best;
}

function resolveCircleVehicles(
  pos: THREE.Vector3,
  r: number,
  vehicles: readonly VehicleBoxCollider[],
  vel?: THREE.Vector3,
  onVehicleHit?: (v: VehicleBoxCollider, nx: number, nz: number, impactSpd: number) => void,
) {
  for (let i = 0; i < vehicles.length; i++) {
    const v = vehicles[i];
    const carH = v.height ?? 1.42;
    const carRoof = v.pos.y + carH * 0.86;
    // Allow standing/jumping cleanly on top of car hoods & roofs without sideways shoving
    if (pos.y >= carRoof - 0.24 || pos.y + 1.75 <= v.pos.y + 0.04) continue;
    const dx = pos.x - v.pos.x;
    const dz = pos.z - v.pos.z;
    const maxReach = Math.max(v.width, v.length) * 0.6 + r + 0.5;
    if (Math.abs(dx) > maxReach || Math.abs(dz) > maxReach) continue;

    const c = Math.cos(v.yaw);
    const s = Math.sin(v.yaw);
    // Vehicle forward = (s, c), vehicle right = (c, -s)
    const lx = dx * c - dz * s;
    const lz = dx * s + dz * c;
    const hw = v.width * 0.5;
    const hl = v.length * 0.5;

    const cx = clamp(lx, -hw, hw);
    const cz = clamp(lz, -hl, hl);
    const ox = lx - cx;
    const oz = lz - cz;
    const d2 = ox * ox + oz * oz;

    if (d2 >= r * r) continue;

    let pushLocalX = 0;
    let pushLocalZ = 0;
    let lnx = 0;
    let lnz = 0;
    if (d2 > 1e-6) {
      const d = Math.sqrt(d2);
      const push = r - d;
      lnx = ox / d;
      lnz = oz / d;
      pushLocalX = lnx * push;
      pushLocalZ = lnz * push;
    } else {
      const penX = hw - Math.abs(lx) + r;
      const penZ = hl - Math.abs(lz) + r;
      if (penX < penZ) {
        lnx = lx >= 0 ? 1 : -1;
        pushLocalX = lnx * penX;
      } else {
        lnz = lz >= 0 ? 1 : -1;
        pushLocalZ = lnz * penZ;
      }
    }

    pos.x += pushLocalX * c + pushLocalZ * s;
    pos.z += -pushLocalX * s + pushLocalZ * c;

    // World normal pointing from car out toward player
    const wnx = lnx * c + lnz * s;
    const wnz = -lnx * s + lnz * c;
    const carVx = v.vx ?? Math.sin(v.yaw) * v.speed;
    const carVz = v.vz ?? Math.cos(v.yaw) * v.speed;
    const approach = carVx * wnx + carVz * wnz;

    if (vel) {
      const relVn = (vel.x - carVx) * wnx + (vel.z - carVz) * wnz;
      if (relVn < 0) {
        vel.x -= wnx * relVn;
        vel.z -= wnz * relVn;
      }
    }
    if (approach > 2.2) {
      onVehicleHit?.(v, wnx, wnz, approach);
    }
  }
}

const _vaultScratch: THREE.Box3[] = [];
function tryVaultObstacle(
  rig: SoldierRig,
  aabbs: THREE.Box3[] | SpatialAABBGrid,
  dt: number,
): void {
  if (rig.grounded || rig.dead || rig.vy < -3.6) return;
  if (rig.input.move.lengthSq() < 0.04) return;
  const pos = rig.root.position;
  const mx = rig.input.move.x;
  const mz = rig.input.move.z;
  const ml = Math.hypot(mx, mz) || 1;
  const fx = mx / ml;
  const fz = mz / ml;
  const probeX = pos.x + fx * 0.56;
  const probeZ = pos.z + fz * 0.56;
  const list = Array.isArray(aabbs) ? aabbs : aabbs.queryPoint(probeX, probeZ, 0.85, _vaultScratch);

  let targetTop = -Infinity;
  for (let i = 0; i < list.length; i++) {
    const b = list[i];
    const rise = b.max.y - pos.y;
    if (rise < 0.35 || rise > 1.52) continue;
    if (pos.y + 1.8 <= b.min.y + 0.02) continue;
    const cx = clamp(probeX, b.min.x, b.max.x);
    const cz = clamp(probeZ, b.min.z, b.max.z);
    const d2 = (probeX - cx) * (probeX - cx) + (probeZ - cz) * (probeZ - cz);
    if (d2 > 0.32) continue;
    if (b.max.y > targetTop) targetTop = b.max.y;
  }
  if (targetTop === -Infinity) return;

  // Verify headroom above the fence/wall top so we never vault into a low ceiling
  for (let i = 0; i < list.length; i++) {
    const b = list[i];
    if (b.max.y <= targetTop + 0.08) continue;
    if (b.min.y >= targetTop + 1.68) continue;
    if (probeX >= b.min.x - 0.3 && probeX <= b.max.x + 0.3 && probeZ >= b.min.z - 0.3 && probeZ <= b.max.z + 0.3) {
      return;
    }
  }

  pos.y = Math.min(targetTop + 0.04, pos.y + Math.max(4.5, rig.vy + 5.0) * dt);
  rig.vy = Math.max(rig.vy, 3.2);
}

export class Game {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(62, 1, 0.05, 400);
  world!: World;
  level: LevelResult | null = null;
  rig!: SoldierRig;
  /** character GLB URL the current rig was loaded from (reload on change) */
  private rigUrl: string | null = null;
  fx = new CombatFX();
  sfx = new Sfx();

  private keys = new Set<string>();
  private uiHeld: Record<Held, boolean> = { fire: false, ads: false, sprint: false, crouch: false };
  private mouseL = false;
  private mouseR = false;
  private locked = false;
  private yaw = 0;
  private pitch = 0.05;
  private camYaw = 0;
  private camPitch = 0.05;
  private showcase = false;
  private crouchToggle = false;
  private adsBlend = 0;
  private sprintFov = 0;
  private raf = 0;
  private last = performance.now();
  private hudT = 0;
  private fpsAcc = 0;
  private fpsN = 0;
  private fps = 60;
  private camKick = new Spring(150, 14);
  private shakeX = new Spring(300, 20);
  private shakeY = new Spring(300, 20);
  private camTrauma = 0;
  private camTraumaNoise = new OrganicMotionNoise(77.3);
  private contextLost = false;
  private hitMarker = 0;
  private hitCrit = false;
  private hitKill = false;
  private outOfCombatT = 0;
  private damageFlash = 0;
  private damageDirRad = 0;
  private spread = 0;
  private health = 100;
  private maxHealth = 100;
  private armor = 0;
  private maxArmor = 100;
  private lastWantedStars = 0;
  private stats: PlayerStats = getPlayerStats();
  private menuHangar = false;
  private menuWeaponFocus = false;
  private menuFocusLerp = 0;
  private menuYaw = 0.25;
  private timeScale = 1;
  private holstered = false;
  private weaponWheelOpen = false;
  private mapOpen = false;
  private phoneOpen = false;
  private phoneInitialTab: "home" | "contracts" = "home";
  private activeApartmentId: ApartmentId | null = null;
  private activeGarageId: ApartmentId | null = null;
  private nearbyHomeStation: (HomeStation & { owned?: boolean }) | null = null;
  private stationAutoCooldown = new Set<string>();
  private vehNoiseCd = 0;
  private lastWheelSwitchMs = 0;
  private weaponConfigs: Partial<Record<WeaponId, WeaponCustomConfig>> = {};
  private pivotY = 1.5;
  private raycaster = new THREE.Raycaster();
  private disposed = false;
  private ro?: ResizeObserver;
  private cleanup: (() => void)[] = [];
  private lastLockAttemptMs = 0;
  private mouseEdgeTurn = 0;
  private lastClientX: number | null = null;
  private lastClientY: number | null = null;
  private zoomDist = 2.7;
  private weaponIdx = 0;
  private weaponAmmo = WEAPONS.map((w) => ({ mag: w.magSize, reserve: w.reserveMax, adsFov: w.adsFovDefault }));
  private adsFovSmooth = WEAPONS[0].adsFovDefault;
  private hangarEnv: THREE.Texture | null = null;
  private guardFlashlights: THREE.SpotLight[] = [];
  private tmpFlashOrigin = new THREE.Vector3();
  private tmpFlashTarget = new THREE.Vector3();
  private rayScratch: THREE.Object3D[] = [];

  /* mission state */
  private cb: GameCallbacks | null = null;
  private mission: MissionDef | null = null;
  private missionRoot = new THREE.Group();
  private enemies: Enemy[] = [];
  private enemyHits: THREE.Object3D[] = [];
  private ally: Ally | null = null;
  private npc: RescueNPC | null = null;
  private safehouseBrickRig: SoldierRig | null = null;
  private bossMortarActive = false;
  private bossMortarCd = 0;
  private bossMortarStrikes: { x: number; y: number; z: number; t: number; maxT: number; ring: THREE.Mesh }[] = [];
  private bossSmokePos: THREE.Vector3 | null = null;
  private bossSmokeT = 0;
  private bossSmokeEmitCd = 0;
  private objectives: ObjectiveState[] = [];
  private dialogueQueue: DialogueLine[] = [];
  private dialogue: DialogueLine | null = null;
  private dialogueT = 0;
  private dialogueAudio: HTMLAudioElement | null = null;
  private activeCall: {
    def: MissionCallDef;
    status: "ringing" | "active";
    timer: number;
    ringT: number;
    audio: HTMLAudioElement | null;
  } | null = null;
  private cinematicState: {
    kind: "intro" | "extract";
    codename: string;
    title: string;
    subtitle: string;
    accent: string;
    elapsed: number;
    duration: number;
    startPos: THREE.Vector3;
    startLook: THREE.Vector3;
    endPos: THREE.Vector3;
    endLook: THREE.Vector3;
    usePlayerEnd?: boolean;
    orbitFocus?: THREE.Vector3;
    onDone?: () => void;
  } | null = null;
  private firstContact = false;
  private killed = 0;
  private stealthKills = 0;
  private alerts = 0;
  private bossKilled = false;
  private destroyed = 0;
  private rescued = false;
  private bossEntity: Enemy | null = null;
  private objectiveDialoguePlayed = false;
  private halfwayPlayed = false;
  private paused = false;
  private pausedRendered = false;
  private progress = 0;
  private phase: HudState["phase"] = "idle";
  private extractRing: THREE.Mesh | null = null;
  private extractBeacon: THREE.Mesh | null = null;
  private rescueBeacon: THREE.Group | null = null;
  private interactables: InteractableInstance[] = [];
  private activeInteract: InteractableInstance | null = null;
  private interactHoldT = 0;
  private interactTickCd = 0;
  private destroyableHp = new Map<THREE.Object3D, number>();
  private practiceRespawnT = 0;
  private nearbyVehicleName: string | null = null;
  private vehCam: CameraSettings = { preset: "close", ...CAMERA_PRESETS.close };
  private freeCamera = { sensitivity: 1, autoCenter: false };
  private freeYaw = 0;
  private freePitch = 0;
  private freeIdle = 0;
  private lastSquadCommsAt = -10_000;
  private commsVoice = new NpcVoiceSystem();
  private driveDistAcc = 0;
  private lastSignalKey = "";
  private activityToast: { title: string; subtitle: string; accent: string } | null = null;
  private activityToastTimer = 0;
  private vehAudio = new VehicleAudio();
  private engineHud: EngineHud | null = null;
  private crashAudioCd = 0;
  private hornCd = 0;
  private driveByCd = 0;
  private parachuting = false;
  private swimming = false;
  private binocularsOpen = false;
  private binocularsZoomIdx = 0; // 0: 2.6x, 1: 4.4x, 2: 6.9x
  private binocularsRangeM = 0;
  private navMesh: NavMeshSystem | null = null;
  private joltPhysics: JoltPhysicsWorld | null = null;
  private parachuteMesh: THREE.Group | null = null;
  private lastShownPedVoiceAt = 0;
  private nearbyContractSpot: { missionId: number; x: number; z: number; yawDeg: number } | null = null;
  private nearbyPrompt: { key: "F" | "G"; label: string; accent: string } | null = null;
  private openWorldReturnSpot: { x: number; z: number; yawDeg: number } | null = null;
  private activeContract: {
    def: MissionDef;
    site: OpenWorldMissionSite;
    stage: "travel" | "infiltrate" | "escape";
    spawned: boolean;
  } | null = null;
  private contractGroup: THREE.Group | null = null;
  private approachRing: THREE.Mesh | null = null;
  private approachBeacon: THREE.Mesh | null = null;
  private composer: EffectComposer | null = null;
  private n8aoPass: N8AOPostPass | null = null;
  private bloomEffect: BloomEffect | null = null;
  private smaaEffect: SMAAEffect | null = null;
  private perfTier: 0 | 1 | 2 = 0;
  private frameMsEma = 16.6;
  private perfEvalT = 0;
  private perfUpgradeT = 0;
  private readonly audioFwdTmp = new THREE.Vector3();
  private readonly audioUpTmp = new THREE.Vector3();
  private lastCamFov = -1;
  private missionSeq = 0;
  private muted = false;
  private sfxVolume = 0.55;
  private engineVolume = 0.72;
  private aimSensitivity = 1.0;
  private invertY = false;
  private shotsFired = 0;
  private shotsHit = 0;
  private headshots = 0;
  private missionElapsedSec = 0;
  private activeDifficulty: DifficultyMode = "operative";
  private readonly camPivotTmp = new THREE.Vector3();
  private readonly camFwdTmp = new THREE.Vector3();
  private readonly camRightTmp = new THREE.Vector3();
  private readonly camDesiredTmp = new THREE.Vector3();
  private readonly camToTmp = new THREE.Vector3();
  private readonly camDirTmp = new THREE.Vector3();
  private readonly aimDirTmp = new THREE.Vector3();
  private readonly aimRootTmp = new THREE.Vector3();

  constructor(
    private container: HTMLElement,
    private onHud: (s: HudState) => void,
    opts?: { initialHangar?: boolean },
  ) {
    installBvhPatches();
    (this.raycaster as THREE.Raycaster & { firstHitOnly?: boolean }).firstHitOnly = true;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance", preserveDrawingBuffer: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2.5));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.domElement.style.display = "block";
    this.renderer.domElement.tabIndex = 0;
    container.appendChild(this.renderer.domElement);

    this.camera.position.set(0.6, 1.8, -3);
    this.scene.add(this.missionRoot);
    this.scene.add(this.fx.group);
    this.initPostProcessing();
    this.loadVehicleCameraSettings();
    this.loadAudioSettings();
    this.loadInputSettings();
    this.bind();
    this.resize();
    this.emitHud();
    (window as unknown as { __game: Game }).__game = this;
    if (opts?.initialHangar !== false) {
      void this.enterMenuHangar();
    }
  }

  /** Builds a live 3D studio hangar with the player's soldier for the Main Menu & Armory */
  async enterMenuHangar() {
    this.menuHangar = true;
    this.phase = "idle";
    this.paused = false;
    this.enemies = [];
    this.enemyHits = [];
    this.guardFlashlights = [];
    this.ally = null;
    this.npc = null;

    if (this.rig) this.rig.setVisible(true);
    this.missionSeq++;
    this.nearbyVehicleName = null;
    this.vehAudio.setActive(false);
    this.engineHud = null;
    this.navMesh?.dispose();
    this.navMesh = null;
    this.joltPhysics?.dispose();
    this.joltPhysics = null;
    if (this.level) {
      disposeBvhForObjects(this.level.colliders);
      this.level.disposeExtra?.();
      this.level.vehicles?.dispose();
      this.level.openWorld?.dispose();
      this.level = null;
    }
    this.camera.far = 400;
    this.camera.updateProjectionMatrix();

    if (this.missionRoot.children.length > 0) {
      this.scene.remove(this.missionRoot);
      disposeObject(this.missionRoot);
      this.missionRoot = new THREE.Group();
      this.scene.add(this.missionRoot);
    }

    this.renderer.toneMappingExposure = 1.02;
    this.scene.background = new THREE.Color(0x070a10);
    this.scene.fog = new THREE.FogExp2(0x070a10, 0.045);
    if (!this.hangarEnv) {
      const pmrem = new THREE.PMREMGenerator(this.renderer);
      this.hangarEnv = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
      pmrem.dispose();
    }
    this.scene.environment = this.hangarEnv;
    this.scene.environmentIntensity = 0.48;

    // Tactical studio dais + subtle amber perimeter ring
    const floor = new THREE.Mesh(
      new THREE.CircleGeometry(14, 48),
      new THREE.MeshStandardMaterial({ color: 0x0c1016, roughness: 0.85, metalness: 0.2 }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    this.missionRoot.add(floor);

    const dais = new THREE.Mesh(
      new THREE.CylinderGeometry(1.45, 1.58, 0.1, 48),
      new THREE.MeshStandardMaterial({ color: 0x171c24, roughness: 0.45, metalness: 0.75 }),
    );
    dais.position.y = 0.05;
    dais.receiveShadow = true;
    this.missionRoot.add(dais);

    const ring = new THREE.Mesh(
      new THREE.RingGeometry(1.38, 1.44, 64),
      new THREE.MeshBasicMaterial({ color: 0xf59e0b, transparent: true, opacity: 0.55, side: THREE.DoubleSide }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.103;
    this.missionRoot.add(ring);

    // 3-point tactical studio lighting balanced so dark suits & skin tones retain rich contrast
    const hemi = new THREE.HemisphereLight(0xaac8e8, 0x1e2530, 0.85);
    const key = new THREE.DirectionalLight(0xfff1dc, 1.85);
    key.position.set(2.4, 4.2, 4.0);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.camera.left = -2.2;
    key.shadow.camera.right = 2.2;
    key.shadow.camera.top = 2.6;
    key.shadow.camera.bottom = -1.2;
    key.shadow.camera.near = 0.5;
    key.shadow.camera.far = 14;
    key.shadow.bias = -0.00025;
    key.shadow.normalBias = 0.015;
    key.shadow.radius = 1.6;
    const rim = new THREE.DirectionalLight(0xf59e0b, 1.35);
    rim.position.set(-2.8, 3.0, -2.5);
    const fill = new THREE.DirectionalLight(0x93c5fd, 0.95);
    fill.position.set(-1.6, 1.8, 3.6);
    this.missionRoot.add(hemi, key, rim, fill);

    const wantUrl = characterUrl(loadCharacterId());
    await this.ensurePlayerRig(wantUrl);
    if (!this.menuHangar || this.disposed) return;

    const save = loadSave();
    this.stats = getPlayerStats(save);
    this.poseRigForMenuHangar(save);

    this.emitHud();
    this.startLoop();
  }

  private async ensurePlayerRig(wantUrl: string) {
    if (this.rig && this.rigUrl !== wantUrl) {
      this.rig.dispose();
      this.rig = undefined as unknown as SoldierRig;
    }
    if (!this.rig) {
      this.rigUrl = wantUrl;
      this.rig = await SoldierRig.load(
        this.scene,
        (p) => {
          this.progress = Math.round(p * 100);
          this.emitHud();
        },
        wantUrl,
      );
      if (this.disposed) return;
      this.rig.isPlayer = true;
      this.rig.groundSampler = (x, z, y) => (this.level ? this.level.groundHeightAt(x, z, y) : 0);
      this.rig.initArsenal();
      this.rig.rifle.muzzle.add(this.fx.flash);
      this.attachRigEvents();
    }
  }

  private poseRigForMenuHangar(save = loadSave()) {
    if (!this.rig) return;
    this.rig.respawn(new THREE.Vector3(0, 0.1, 0));
    this.rig.root.position.y = 0.1;
    this.rig.groundY = 0.1;
    this.menuYaw = 0.25;
    this.rig.aimYaw = this.menuYaw;
    this.rig.aimPitch = 0.02;
    this.rig.input.move.set(0, 0, 0);
    this.rig.input.crouch = false;
    this.rig.input.sprint = false;
    this.rig.input.ads = true;
    this.rig.input.lean = 0;

    const idx = clamp(save.selectedWeapon, 0, WEAPONS.length - 1);
    const spec = WEAPONS[idx];
    this.weaponIdx = idx;
    this.weaponConfigs = save.weaponConfigs ?? {};
    this.rig.setWeaponConfigs(this.weaponConfigs);
    this.rig.setHolstered(false);
    this.rig.equipWeapon(spec, spec.magSize, spec.reserveMax, this.fx.flash);
    this.rig.setAppearance(save.appearance);
    this.rig.aimPoint.set(Math.sin(this.menuYaw) * 10, 1.32, Math.cos(this.menuYaw) * 10);
    for (let i = 0; i < 20; i++) this.rig.update(0.05, 0.1);
  }

  /** Hot-swap the player's 3D character model (e.g. from the Operator Customizer). */
  async setPlayerCharacter(url: string) {
    if (this.cb) this.cb.characterUrl = url;
    await this.ensurePlayerRig(url);
    if (this.disposed) return;
    if (this.menuHangar) {
      this.poseRigForMenuHangar(loadSave());
      this.emitHud();
    }
  }

  previewWeapon(idx: number) {
    if (!this.rig || !this.menuHangar) return;
    const nextIdx = ((idx % WEAPONS.length) + WEAPONS.length) % WEAPONS.length;
    this.weaponIdx = nextIdx;
    const spec = WEAPONS[nextIdx];
    this.rig.equipWeapon(spec, spec.magSize, spec.reserveMax, this.fx.flash);
    this.sfx.switchWeapon();
    this.emitHud();
  }

  previewWeaponConfigs(configs: Partial<Record<WeaponId, WeaponCustomConfig>>) {
    this.weaponConfigs = { ...configs };
    this.rig?.setWeaponConfigs(this.weaponConfigs);
    this.emitHud();
  }

  setMenuWeaponFocus(focus: boolean) {
    this.menuWeaponFocus = focus;
  }

  previewAppearance(app: SoldierAppearance) {
    if (!this.rig) return;
    this.rig.setAppearance(app);
  }

  private getActiveWeaponMods(id: WeaponId) {
    const cfg = this.weaponConfigs[id] ?? getWeaponCustomConfig(loadSave(), id);
    return getWeaponModEffects(cfg);
  }

  setHolstered(holstered: boolean) {
    if (!holstered && this.level?.bodyCarry?.isCarrying) {
      this.activityToast = {
        title: "HANDS OCCUPIED",
        subtitle: "Drop or stash the body [G] before drawing a weapon",
        accent: "#fbbf24",
      };
      this.activityToastTimer = 2.2;
      return;
    }
    if (this.holstered === holstered) return;
    this.holstered = holstered;
    if (holstered) {
      this.mouseR = false;
      this.uiHeld.ads = false;
      this.uiHeld.fire = false;
    }
    this.rig?.setHolstered(holstered);
    this.sfx.switchWeapon();
    this.emitHud();
  }

  toggleHolster() {
    if (!this.rig || this.rig.dead || this.phase !== "ready") return;
    this.setHolstered(!this.holstered);
  }

  setWeaponWheelOpen(open: boolean) {
    this.weaponWheelOpen = open;
    this.mouseEdgeTurn = 0;
    this.lastClientX = null;
    this.lastClientY = null;
    if (open) {
      this.mouseL = false;
      this.mouseR = false;
    } else if (this.isActiveGameplay()) {
      this.requestLock();
    }
    this.syncCursorStyle();
    this.emitHud();
  }

  setMapOpen(open: boolean) {
    if (this.mapOpen === open) return;
    this.mapOpen = open;
    this.mouseEdgeTurn = 0;
    this.lastClientX = null;
    this.lastClientY = null;
    if (open) {
      this.mouseL = false;
      this.mouseR = false;
      this.weaponWheelOpen = false;
      this.phoneOpen = false;
      if (document.pointerLockElement) document.exitPointerLock();
    } else if (this.isActiveGameplay()) {
      this.requestLock();
    }
    this.syncCursorStyle();
    this.emitHud();
  }

  setPhoneOpen(open: boolean, tab: "home" | "contracts" = "home") {
    this.phoneInitialTab = open ? tab : "home";
    if (this.phoneOpen === open) {
      this.emitHud();
      return;
    }
    this.phoneOpen = open;
    this.mouseEdgeTurn = 0;
    this.lastClientX = null;
    this.lastClientY = null;
    if (open) {
      this.mouseL = false;
      this.mouseR = false;
      this.weaponWheelOpen = false;
      this.mapOpen = false;
      if (document.pointerLockElement) document.exitPointerLock();
    } else {
      if (typeof document !== "undefined" && document.activeElement instanceof HTMLElement) {
        document.activeElement.blur();
      }
      if (this.isActiveGameplay()) this.requestLock();
    }
    this.syncCursorStyle();
    this.emitHud();
  }

  captureSnapmaticPhoto(): string | null {
    try {
      this.renderer.render(this.scene, this.camera);
      return this.renderer.domElement.toDataURL("image/jpeg", 0.86);
    } catch {
      return null;
    }
  }

  refreshStats() {
    this.stats = getPlayerStats();
  }

  private emitNoise(pos: THREE.Vector3, baseRadius: number, strength: number, kind: SoundKind) {
    if (this.phase !== "ready" || baseRadius <= 0.1) return;
    if (kind === "gunshot" || kind === "vehicle" || kind === "shatter") {
      this.level?.wildlife?.alertNear(pos.x, pos.z, Math.min(48, baseRadius));
    }
    if (this.enemies.length === 0) return;
    for (const e of this.enemies) {
      if (e.isDead) continue;
      e.hearSound(pos, baseRadius, strength, kind);
    }
  }

  private attachRigEvents() {
    this.rig.events = {
      onShot: (m, kick) => this.onShot(m, kick),
      onEject: (p, d) => this.fx.casing(p, d),
      onDry: () => this.sfx.dry(),
      onFootstep: (_s, i) => {
        const p = this.rig?.root.position;
        let surf: "asphalt" | "wood" | "metal" | "dirt" | "water" = "asphalt";
        if (this.swimming) {
          surf = "water";
          if (p) this.fx.waterSplash(new THREE.Vector3(p.x, -0.02, p.z), 0.32);
        } else if (p) {
          if (p.x < -695 && p.z > 465 && p.z < 500) surf = "wood";
          else if (p.x > 550 && p.z > 420) surf = "metal";
          else if (p.x < -650 && p.y < 2.2) surf = "dirt";
        }
        this.sfx.step(i, surf);
        if (this.phase === "ready" && !this.rig?.dead) {
          const crouching = this.crouchToggle;
          if (!crouching) {
            const sprinting = this.rig.status === "Sprinting";
            const baseR = sprinting ? 13.0 : 4.8;
            const radius = baseR * this.stats.footstepNoiseMult;
            this.emitNoise(this.rig.root.position, radius, sprinting ? 0.54 : 0.36, "footstep");
          }
        }
      },
      onReloadEvent: (k) => {
        if (k === "magout") {
          this.sfx.magOut();
          this.emitNoise(this.rig.root.position, 5.2 * this.stats.footstepNoiseMult, 0.36, "reload");
        } else if (k === "magin") {
          this.sfx.magIn();
        } else if (k === "bolt") {
          this.sfx.bolt();
          this.emitNoise(this.rig.root.position, 5.8 * this.stats.footstepNoiseMult, 0.4, "reload");
        } else if (k === "drop") {
          this.sfx.magDrop();
        }
      },
      onLand: (i) => {
        this.sfx.land(i);
        if (this.phase === "ready" && !this.rig?.dead) {
          const radius = (4.2 + Math.min(1.5, i) * 6.5) * this.stats.footstepNoiseMult;
          this.emitNoise(this.rig.root.position, radius, 0.48, "land");
        }
      },
      onHit: () => this.sfx.hit(),
      onDeath: () => this.sfx.fall(),
    };
  }

  /* ------------------------------------------------------------ */
  async startMission(id: number, cb: GameCallbacks, opts?: { fromOpenWorld?: boolean; surveillanceId?: string }) {
    const isCampaignContract = id >= 1 && id <= 6;
    const pendingSurveillanceId = opts?.surveillanceId ?? null;
    if (
      (isCampaignContract || pendingSurveillanceId) &&
      this.mission?.id === -1 &&
      this.level &&
      this.rig &&
      !this.rig.dead &&
      this.phase === "ready"
    ) {
      this.menuHangar = false;
      this.cb = cb;
      this.paused = false;
      this.pausedRendered = false;
      this.weaponWheelOpen = false;
      this.mapOpen = false;
      this.phoneOpen = false;
      if (pendingSurveillanceId) {
        this.startSurveillanceContract(pendingSurveillanceId, 7.1);
        const ch = getStoryChapterForSurveillance(pendingSurveillanceId);
        if (ch?.introDialogue?.length) this.queueDialogue(ch.introDialogue);
      } else {
        this.activateOpenWorldContract(id);
      }
      return;
    }

    const seq = ++this.missionSeq;
    this.menuHangar = false;
    this.cb = cb;
    if (opts?.fromOpenWorld && this.mission?.id === -1 && this.rig) {
      const av = this.level?.vehicles?.activeVehicle;
      const rx = av ? av.pos.x : this.rig.root.position.x;
      const rz = av ? av.pos.z : this.rig.root.position.z;
      const rYaw = THREE.MathUtils.radToDeg(av ? av.yaw : this.camYaw);
      this.openWorldReturnSpot = { x: rx, z: rz, yawDeg: rYaw };
    } else if (!opts?.fromOpenWorld && id !== -1) {
      this.openWorldReturnSpot = null;
    }
    this.clearActiveContractEntities();
    this.activeContract = null;
    this.nearbyContractSpot = null;
    this.activeApartmentId = null;
    this.activeGarageId = null;
    this.nearbyHomeStation = null;
    this.stationAutoCooldown.clear();
    this.vehAudio.setActive(false);
    this.engineHud = null;
    this.phase = "loading";
    this.stats = getPlayerStats();
    this.maxHealth = this.stats.maxHp;
    this.emitHud();
    const pendingContractId = isCampaignContract ? id : null;
    const mission =
      id === -1 || isCampaignContract || pendingSurveillanceId
        ? OPEN_WORLD_MISSION
        : MISSIONS.find((m) => m.id === id) ?? MISSIONS[0];
    this.mission = mission;
    this.camera.rotation.set(0, 0, 0);
    this.camera.fov = 62;
    this.camera.far = mission.id === -1 ? 1800 : 400;
    this.camera.updateProjectionMatrix();

    // reset mission state
    this.firstContact = false;
    this.killed = 0;
    this.stealthKills = 0;
    this.alerts = 0;
    this.shotsFired = 0;
    this.shotsHit = 0;
    this.headshots = 0;
    this.missionElapsedSec = 0;
    this.activeDifficulty = loadSave().difficulty ?? "operative";
    this.bossKilled = false;
    this.destroyed = 0;
    this.rescued = false;
    this.progress = 0;
    this.bossEntity = null;
    this.objectiveDialoguePlayed = false;
    this.halfwayPlayed = false;
    this.paused = false;
    this.enemies = [];
    this.enemyHits = [];
    this.ally = null;
    this.npc = null;
    this.safehouseBrickRig = null;
    this.bossMortarActive = false;
    this.bossMortarCd = 0;
    for (const ms of this.bossMortarStrikes) {
      this.missionRoot.remove(ms.ring);
      ms.ring.geometry.dispose();
      (ms.ring.material as THREE.Material).dispose();
    }
    this.bossMortarStrikes = [];
    this.bossSmokePos = null;
    this.bossSmokeT = 0;
    this.bossSmokeEmitCd = 0;
    this.interactables = [];
    this.activeInteract = null;
    this.interactHoldT = 0;
    this.interactTickCd = 0;
    this.dialogueQueue = [];
    this.dialogue = null;
    this.stopDialogueAudio();
    this.cinematicState = null;
    this.hangUpCall(false);
    this.destroyableHp.clear();
    if (this.extractRing) {
      this.missionRoot.remove(this.extractRing);
      this.extractRing.geometry.dispose();
      (this.extractRing.material as THREE.Material).dispose();
      this.extractRing = null;
    }
    if (this.extractBeacon) {
      this.missionRoot.remove(this.extractBeacon);
      this.extractBeacon.geometry.dispose();
      (this.extractBeacon.material as THREE.Material).dispose();
      this.extractBeacon = null;
    }
    if (this.rescueBeacon) {
      this.missionRoot.remove(this.rescueBeacon);
      disposeObject(this.rescueBeacon);
      this.rescueBeacon = null;
    }

    // dispose previous mission content
    if (this.rig) this.rig.setVisible(true);
    this.navMesh?.dispose();
    this.navMesh = null;
    this.joltPhysics?.dispose();
    this.joltPhysics = null;
    if (this.level) {
      this.level.vehicles?.dispose();
      this.level.openWorld?.dispose();
      this.level.disposeExtra?.();
      this.level = null;
    }
    if (this.missionRoot.children.length > 0) {
      this.scene.remove(this.missionRoot);
      disposeObject(this.missionRoot);
      this.missionRoot = new THREE.Group();
      this.scene.add(this.missionRoot);
    }

    // build the world
    this.level = await buildLevelAsync(mission.id, this.missionRoot, this.scene, this.renderer);
    if (this.disposed || seq !== this.missionSeq) {
      disposeBvhForObjects(this.level.colliders);
      this.level.disposeExtra?.();
      this.level.vehicles?.dispose();
      this.level.openWorld?.dispose();
      this.level = null;
      return;
    }
    buildBvhForObjects(this.level.colliders);
    this.world = this.level;
    this.wireOpenWorldCallbacks();

    // player rig (loaded once, reloaded when the selected character changes)
    const wantUrl = cb.characterUrl ?? characterUrl(loadCharacterId());
    await this.ensurePlayerRig(wantUrl);
    if (this.disposed) return;
    const sp = mission.spawn;
    this.rig.worldBound = mission.id === -1 ? 1185 : 260;
    const spawnY = this.level.groundHeightAt(sp[0], sp[1], 200);
    this.rig.respawn(new THREE.Vector3(sp[0], spawnY, sp[1]));
    this.rig.groundY = spawnY;
    const save = loadSave();
    this.rig.setWeaponConfigs(save.weaponConfigs);
    this.weaponConfigs = save.weaponConfigs ?? {};
    this.rig.setAppearance(save.appearance);
    this.rig.crouchSpeedMult = this.stats.crouchSpeedMult;
    this.rig.aimYaw = THREE.MathUtils.degToRad(sp[2]);
    this.yaw = this.camYaw = this.rig.aimYaw;
    this.pitch = this.camPitch = 0.05;
    this.maxHealth = this.stats.maxHp;
    this.health = this.maxHealth;
    this.outOfCombatT = 0;
    this.hitKill = false;
    this.showcase = false;
    this.crouchToggle = false;
    this.holstered = mission.id === -1;
    this.weaponWheelOpen = false;
    this.mapOpen = false;
    this.phoneOpen = false;
    this.rig.setHolstered(this.holstered);
    this.resetWeapons();
    this.rig.input.move.set(0, 0, 0);
    this.rig.input.ads = false;
    this.rig.input.crouch = false;
    this.rig.input.sprint = false;
    this.rig.update(0.016, spawnY);
    const initialVeh = this.level.vehicles?.findNearestEnterable(this.rig.root.position);
    this.nearbyVehicleName = initialVeh ? initialVeh.spec.name : null;

    // objectives
    this.objectives = mission.objectives.map((o: ObjectiveDef) => ({
      id: o.id,
      label: o.label,
      done: mission.practice === true,
      progress: mission.practice === true ? o.count ?? 1 : 0,
      total: o.count ?? (o.kind === "reach" || o.kind === "rescue" ? 1 : 0),
    }));
    if (mission.practice) this.objectives.forEach((o) => (o.done = true));

    // combat host (applies Ghost-vs-Loud story consequences from earlier chapters)
    const conseq = getMissionConsequences(save, mission.id);
    const host: CombatHost = {
      colliders: this.level.colliders,
      aabbs: this.level.aabbs,
      spatialAABBs: this.level.spatial,
      rayQuery: this.level.spatialColliders
        ? (origin, dir, maxDist) => this.level!.spatialColliders!.queryRay(origin, dir, maxDist, this.rayScratch)
        : undefined,
      findNavPath: (from, to) => (this.navMesh?.ready ? this.navMesh.findPath(from, to) : null),
      groundHeightAt: (x, z, y) => (this.level ? this.level.groundHeightAt(x, z, y) : 0),
      fx: this.fx,
      sfx: this.sfx,
      playerPos: (out: THREE.Vector3) => {
        const r = this.rig?.root.position;
        return r ? out.set(r.x, r.y + this.rig.eyeHeight, r.z) : out.set(0, 1.6, 0);
      },
      playerAlive: () => !this.rig?.dead,
      playerCrouching: () => this.crouchToggle,
      playerSprinting: () => this.rig?.status === "Sprinting",
      playerDetectMult: () => this.stats.enemyDetectSpeedMult * conseq.detectSpeedMult,
      playerVisionRangeMult: () => this.stats.enemyVisionRangeMult * conseq.visionRangeMult,
      difficultyScale: () => DIFFICULTY_PROFILES[this.activeDifficulty],
      onPlayerHit: (dmg) => this.damage(dmg, Math.random() * Math.PI * 2),
      onKilled: (e, stealth) => this.onEnemyKilled(e, stealth),
      onAlert: () => this.onFirstContact(),
      onBossEngage: (boss) => this.handleBossEngage(boss),
      onBossHalfHp: (boss) => this.handleBossHalfHp(boss, host),
      onSquadComms: (kind) => this.handleSquadComms(kind),
      enemies: () => this.enemies,
      mission,
    };

    // Build Recast NavMesh + JoltPhysics rigid-body debris world asynchronously for compound ops
    if (mission.id >= 0 && typeof window !== "undefined") {
      const nav = new NavMeshSystem();
      this.navMesh = nav;
      void nav.buildFromObjects(this.level.colliders).then((ok) => {
        if (!ok && this.navMesh === nav) {
          nav.dispose();
          this.navMesh = null;
        }
      });

      const jolt = new JoltPhysicsWorld(this.missionRoot);
      this.joltPhysics = jolt;
      void jolt.initFromLevel(this.level.aabbs, 0).then((ok) => {
        if (!ok && this.joltPhysics === jolt) {
          jolt.dispose();
          this.joltPhysics = null;
        }
      });
    }

    // spawn enemies (parallel GLB builds after first asset cache warm-up)
    const totalEnemies = mission.enemies.length + (mission.ally ? 1 : 0) + (mission.rescue ? 1 : 0);
    let built = 0;
    const spawnedEnemies = mission.enemies.map((spawn) => new Enemy(host, spawn, mission));
    const batchSize = 4;
    for (let i = 0; i < spawnedEnemies.length; i += batchSize) {
      const slice = spawnedEnemies.slice(i, i + batchSize);
      await Promise.all(slice.map((e) => e.build(this.missionRoot, mission.tint, 0.95 + Math.random() * 0.12)));
      if (this.disposed || seq !== this.missionSeq) return;
      for (const e of slice) {
        this.enemyHits.push(e.hitbox);
        if (e.boss) this.bossEntity = e;
        this.enemies.push(e);
        built++;
      }
      this.progress = Math.round((built / Math.max(1, totalEnemies)) * 100);
      this.emitHud();
    }

    // Pooled SpotLights for closest night guards' tactical flashlights
    this.guardFlashlights = [];
    if (mission.night && this.enemies.length > 0) {
      const count = Math.min(4, this.enemies.length);
      for (let i = 0; i < count; i++) {
        const sl = new THREE.SpotLight(0xd9efff, 24, 28, 0.34, 0.65, 1.5);
        sl.castShadow = false;
        sl.visible = false;
        this.missionRoot.add(sl, sl.target);
        this.guardFlashlights.push(sl);
      }
    }

    // ally (Brick, M5)
    if (mission.ally) {
      this.ally = new Ally(host, mission.ally[0], mission.ally[1]);
      await this.ally.build(this.missionRoot, [0x3f6b3a, 0x88ff88], 1.0);
      built++;
      this.progress = Math.round((built / totalEnemies) * 100);
      this.emitHud();
    }

    // rescue NPC
    if (mission.rescue) {
      this.npc = new RescueNPC(mission.rescue[0], mission.rescue[1]);
      await this.npc.build(this.missionRoot, [0xc9b48a, 0xffe0a0]);
      built++;
      this.progress = 100;
      this.emitHud();
    }

    // destroyables hp
    for (const m of this.level.destroyables) this.destroyableHp.set(m, 100);

    // interactive heist/espionage props (terminals, files, diamonds, bullion)
    for (const idef of mission.interactables ?? []) {
      const inst = createInteractableProp(idef);
      if (conseq.preClearedTerminalId && idef.id === conseq.preClearedTerminalId) {
        inst.done = true;
        inst.group.visible = false;
      }
      this.missionRoot.add(inst.group);
      this.interactables.push(inst);
    }
    if (conseq.preClearedTerminalId) this.updateObjectives();
    if (conseq.enemyHpMult !== 1) {
      for (const e of this.enemies) {
        if (!e.boss) e.hp = Math.round(e.hp * conseq.enemyHpMult);
      }
    }

    // extraction ring + vertical exfil beacon + rescue beacon
    if (!mission.practice) {
      const ex = mission.extraction;
      const ringGeo = new THREE.RingGeometry(ex[2] - 0.35, ex[2], 48);
      const ringMat = new THREE.MeshBasicMaterial({ color: 0x66ff99, transparent: true, opacity: 0.5, side: THREE.DoubleSide, depthWrite: false });
      this.extractRing = new THREE.Mesh(ringGeo, ringMat);
      this.extractRing.rotation.x = -Math.PI / 2;
      this.extractRing.position.set(ex[0], 0.08, ex[1]);
      this.missionRoot.add(this.extractRing);

      const exBeam = new THREE.Mesh(
        new THREE.CylinderGeometry(0.28, 1.15, 16, 16, 1, true),
        new THREE.MeshBasicMaterial({
          color: 0x34d399,
          transparent: true,
          opacity: 0.16,
          side: THREE.DoubleSide,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
        }),
      );
      exBeam.position.set(ex[0], 8.0, ex[1]);
      exBeam.visible = false;
      this.extractBeacon = exBeam;
      this.missionRoot.add(exBeam);
    }
    if (mission.rescue) {
      const grp = new THREE.Group();
      grp.position.set(mission.rescue[0], 0, mission.rescue[1]);
      const ringGeo = new THREE.RingGeometry(0.6, 0.78, 36);
      const ringMat = new THREE.MeshBasicMaterial({ color: 0xffc857, transparent: true, opacity: 0.65, side: THREE.DoubleSide, depthWrite: false });
      const ringMesh = new THREE.Mesh(ringGeo, ringMat);
      ringMesh.rotation.x = -Math.PI / 2;
      ringMesh.position.y = 0.07;
      grp.add(ringMesh);
      const beamMat = new THREE.MeshBasicMaterial({ color: 0xffd060, transparent: true, opacity: 0.16, depthWrite: false, side: THREE.DoubleSide });
      const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.55, 3.4, 20, 1, true), beamMat);
      beam.position.y = 1.75;
      grp.add(beam);
      const diamond = new THREE.Mesh(
        new THREE.OctahedronGeometry(0.24, 0),
        new THREE.MeshStandardMaterial({ color: 0xffd060, emissive: 0xffaa20, emissiveIntensity: 1.5, roughness: 0.2 })
      );
      diamond.position.y = 2.6;
      diamond.scale.set(0.85, 1.35, 0.85);
      grp.add(diamond);
      this.rescueBeacon = grp;
      this.missionRoot.add(this.rescueBeacon);
    }

    // Safehouse partner presence: Sgt. Brick Horvat stands beside the Evidence Wall after Ch 06
    if (mission.id === -1 && loadSave().records?.[3]?.completed) {
      const brickRoot = this.missionRoot;
      const bp = safehouseLocalToWorld(-1.6, -1.25, 0.16);
      void SoldierRig.load(brickRoot, undefined, characterUrl("military")).then((brickRig) => {
        if (this.disposed || this.missionRoot !== brickRoot) {
          brickRoot.remove(brickRig.root);
          disposeObject(brickRig.root);
          return;
        }
        brickRig.setHeightScale(1.0);
        brickRig.root.position.set(bp.x, bp.y, bp.z);
        brickRig.aimYaw = SAFEHOUSE_YAW - Math.PI * 0.45;
        brickRig.root.rotation.y = brickRig.aimYaw;
        this.safehouseBrickRig = brickRig;
      });
    }

    try {
      this.renderer.compile(this.scene, this.camera);
    } catch {}
    this.phase = "ready";
    if (pendingContractId !== null) {
      const def = MISSIONS.find((m) => m.id === pendingContractId);
      if (def) {
        const tod: TimeOfDayMode =
          def.night ? "night" : def.timeOfDay === "Sunset" ? "sunset" : def.timeOfDay === "Dawn" ? "dawn" : "afternoon";
        this.level?.setTimeOfDay?.(tod);
      }
      this.activateOpenWorldContract(pendingContractId);
    } else if (pendingSurveillanceId) {
      this.startSurveillanceContract(pendingSurveillanceId, 7.1);
      const ch = getStoryChapterForSurveillance(pendingSurveillanceId);
      if (ch?.introDialogue?.length) this.queueDialogue(ch.introDialogue);
    } else {
      this.queueDialogue(mission.intro);
      const mc = getMissionCallForMission(mission.id);
      if (mc) this.startMissionCall(mc);
      if (mission.id >= 1 && !mission.practice) {
        this.startIntroCinematic(mission, this.rig.root.position, this.camYaw, 4.6, conseq.bannerTitle);
      }
    }
    this.emitHud();
    (window as unknown as { __game: Game }).__game = this;
    this.startLoop();
  }

  private startLoop() {
    if (this.raf) return;
    this.last = performance.now();
    const loop = (t: number) => {
      if (this.paused && this.pausedRendered) {
        this.raf = 0;
        return;
      }
      this.raf = requestAnimationFrame(loop);
      const dt = Math.min(0.05, Math.max(0.0001, (t - this.last) / 1000));
      this.last = t;
      this.frame(dt);
    };
    this.raf = requestAnimationFrame(loop);
  }

  /* ------------------------------------------------------------ */
  private bind() {
    const el = this.renderer.domElement;
    const on = <K extends keyof WindowEventMap>(t: Window | HTMLElement | Document, ev: string, fn: (e: never) => void, opt?: AddEventListenerOptions) => {
      (t as EventTarget).addEventListener(ev, fn as EventListener, opt);
      this.cleanup.push(() => (t as EventTarget).removeEventListener(ev, fn as EventListener));
      return null as unknown as K;
    };
    on(window, "keydown", (e: KeyboardEvent) => {
      this.sfx.init();
      if (["Space", "Tab", "ArrowUp", "ArrowDown"].includes(e.code)) e.preventDefault();
      if (e.repeat) return;
      this.keys.add(e.code);
      switch (e.code) {
        case "Space":
          if (this.cinematicState) {
            e.preventDefault();
            this.skipCinematic();
          } else {
            this.trigger("jump");
          }
          break;
        case "Enter":
          if (this.cinematicState) {
            e.preventDefault();
            this.skipCinematic();
          }
          break;
        case "KeyR":
          this.trigger("reload");
          break;
        case "ControlLeft":
        case "ControlRight":
          if (
            this.phase === "ready" &&
            !this.paused &&
            !this.mapOpen &&
            !this.phoneOpen &&
            !this.weaponWheelOpen &&
            !this.rig?.dead &&
            !this.level?.vehicles?.activeVehicle &&
            !this.level?.aircraft?.activeAircraft &&
            !this.level?.boats?.activeBoat
          ) {
            e.preventDefault();
            this.crouchToggle = !this.crouchToggle;
            this.emitHud();
          }
          break;
        case "KeyC":
          if (this.level?.vehicles?.activeVehicle) this.cycleCamera();
          else {
            this.crouchToggle = !this.crouchToggle;
            this.emitHud();
          }
          break;
        case "KeyQ":
          if (this.level?.vehicles?.activeVehicle && this.phase === "ready" && !this.paused && !this.mapOpen && !this.phoneOpen) {
            this.toggleVehicleSignal("left");
          }
          break;
        case "KeyE":
          if (this.level?.vehicles?.activeVehicle && this.phase === "ready" && !this.paused && !this.mapOpen && !this.phoneOpen) {
            this.toggleVehicleSignal("right");
          }
          break;
        case "KeyN":
          if (this.mission?.id === -1 && this.phase === "ready") this.cycleWeatherMode();
          break;
        case "KeyT":
          if (this.mission?.id === -1 && this.phase === "ready") this.cycleTimeOfDay();
          break;
        case "KeyZ":
          if (this.mission?.id === -1 && this.phase === "ready" && this.level?.vehicles?.activeVehicle) {
            void this.vehAudio.unlock();
            const st = this.vehAudio.radio.cycleStation();
            this.activityToast = {
              title: st.name,
              subtitle: st.genre === "Off" ? "Car Radio Muted" : `${st.genre} · [Z] Next Station`,
              accent: "#a855f7",
            };
            this.activityToastTimer = 2.6;
            this.emitHud();
          }
          break;
        case "KeyX":
          if (this.mission?.id === -1 && this.phase === "ready") {
            const siren = this.level?.vehicles?.toggleActiveSiren() ?? false;
            this.vehAudio.updateAmbience(
              0.016,
              this.rig?.root.position.x ?? 0,
              this.rig?.root.position.z ?? 0,
              siren ? 1 : 0,
              this.level?.wanted?.stars ?? 0,
            );
            this.emitHud();
          }
          break;
        case "KeyV":
          this.tryTakedown();
          break;
        case "KeyB":
          if (
            this.phase === "ready" &&
            !this.paused &&
            !this.mapOpen &&
            !this.phoneOpen &&
            !this.weaponWheelOpen &&
            !this.rig?.dead &&
            !this.level?.vehicles?.activeVehicle &&
            !this.level?.aircraft?.activeAircraft &&
            !this.level?.boats?.activeBoat
          ) {
            this.binocularsOpen = !this.binocularsOpen;
            if (this.binocularsOpen) {
              this.mouseL = false;
              this.mouseR = false;
              this.uiHeld.ads = false;
            }
            this.sfx.binocPing();
            this.emitHud();
          }
          break;
        case "KeyY":
          if (this.mission?.id === -1 && this.phase === "ready" && !this.paused && this.level?.contracts?.isActive) {
            this.advanceSurveillanceClock(1.0);
          }
          break;
        case "KeyG":
          if (this.mission?.id === -1 && this.phase === "ready" && !this.paused) {
            this.handleKeyG();
          }
          break;
        case "KeyF":
          this.tryToggleVehicle();
          break;
        case "KeyH":
          if (this.phase === "ready" && !this.paused && !this.mapOpen) {
            if (this.level?.vehicles?.activeVehicle) {
              this.honkVehicleHorn();
            } else {
              this.toggleHolster();
            }
          }
          break;
        case "KeyM":
          if (this.mission?.id === -1 && this.phase === "ready" && !this.paused && !this.weaponWheelOpen) {
            this.setMapOpen(!this.mapOpen);
          }
          break;
        case "KeyP":
        case "ArrowUp":
          if (this.phase === "ready" && !this.paused && !this.mapOpen && !this.weaponWheelOpen && !this.rig?.dead) {
            e.preventDefault();
            if (this.activeCall?.status === "ringing") {
              this.answerCall(true);
            } else {
              this.setPhoneOpen(!this.phoneOpen);
            }
          }
          break;
        case "ArrowDown":
          if (this.phoneOpen) {
            e.preventDefault();
            this.setPhoneOpen(false);
          }
          break;
        case "Tab":
          if (
            this.phase === "ready" &&
            !this.paused &&
            !this.mapOpen &&
            !this.rig?.dead &&
            !this.level?.vehicles?.activeVehicle &&
            !this.level?.bodyCarry?.isCarrying
          ) {
            this.phoneOpen = false;
            this.weaponWheelOpen = true;
            this.mouseL = false;
            this.mouseR = false;
            this.emitHud();
          }
          break;
        case "Backquote":
        case "KeyO":
          this.trigger("showcase");
          break;
        case "Digit1":
          this.selectWeapon(0);
          break;
        case "Digit2":
          this.selectWeapon(1);
          break;
        case "Digit3":
          this.selectWeapon(2);
          break;
        case "Digit4":
          this.selectWeapon(3);
          break;
        case "Digit5":
          this.selectWeapon(4);
          break;
        case "Escape":
          if (this.mapOpen) {
            this.setMapOpen(false);
            break;
          }
          if (this.phoneOpen) {
            this.setPhoneOpen(false);
            break;
          }
          if (this.weaponWheelOpen) {
            this.weaponWheelOpen = false;
            this.emitHud();
            break;
          }
          if (this.phase === "ready" || this.phase === "dead") {
            this.setPaused(!this.paused);
          }
          break;
      }
    });
    on(window, "keyup", (e: KeyboardEvent) => {
      this.keys.delete(e.code);
      if (e.code === "Tab" && this.weaponWheelOpen) {
        this.weaponWheelOpen = false;
        this.emitHud();
      }
    });
    on(window, "blur", () => {
      this.keys.clear();
      this.mouseL = false;
      this.mouseR = false;
      this.mouseEdgeTurn = 0;
      this.lastClientX = null;
      this.lastClientY = null;
      if (this.weaponWheelOpen) {
        this.weaponWheelOpen = false;
        this.emitHud();
      }
      this.syncCursorStyle();
    });
    on(document, "mouseleave", () => {
      this.mouseEdgeTurn = 0;
      this.lastClientX = null;
      this.lastClientY = null;
    });
    on(el, "contextmenu", (e: Event) => e.preventDefault());
    on(el, "mousedown", (e: MouseEvent) => {
      this.sfx.init();
      if (this.weaponWheelOpen || this.mapOpen) return;
      if (this.phoneOpen) {
        this.setPhoneOpen(false);
        if (!this.locked) this.requestLock();
        return;
      }
      if (this.cinematicState) {
        this.skipCinematic();
        if (!this.locked && this.isActiveGameplay()) this.requestLock();
        return;
      }
      if (!this.locked && (this.isActiveGameplay() || this.showcase)) {
        this.requestLock();
        return;
      }
      if (e.button === 0) {
        this.mouseL = true;
      }
      if (e.button === 2) {
        this.mouseR = true;
      }
    });
    on(window, "mouseup", (e: MouseEvent) => {
      if (e.button === 0) this.mouseL = false;
      if (e.button === 2) this.mouseR = false;
    });
    on(window, "mousemove", (e: MouseEvent) => {
      const drag = this.mouseL || this.mouseR;
      if (this.menuHangar) {
        if (drag) this.menuYaw += e.movementX * 0.008;
        return;
      }
      if (this.weaponWheelOpen || this.mapOpen || this.phoneOpen) {
        this.mouseEdgeTurn = 0;
        this.lastClientX = null;
        this.lastClientY = null;
        return;
      }
      const activeLook = this.isActiveGameplay() || this.showcase;
      if (!activeLook) return;
      if (!this.locked && this.showcase && !drag) return;

      let dx = e.movementX || 0;
      let dy = e.movementY || 0;
      if (!this.locked) {
        if (dx === 0 && dy === 0 && this.lastClientX !== null && this.lastClientY !== null) {
          dx = clamp(e.clientX - this.lastClientX, -120, 120);
          dy = clamp(e.clientY - this.lastClientY, -120, 120);
        } else {
          dx = clamp(dx, -220, 220);
          dy = clamp(dy, -220, 220);
        }
        this.lastClientX = e.clientX;
        this.lastClientY = e.clientY;
        const w = Math.max(1, window.innerWidth || this.container.clientWidth || 1);
        const edge = 44;
        if (e.clientX <= edge) {
          this.mouseEdgeTurn = clamp((edge - e.clientX) / edge, 0, 1);
        } else if (e.clientX >= w - edge) {
          this.mouseEdgeTurn = -clamp((e.clientX - (w - edge)) / edge, 0, 1);
        } else {
          this.mouseEdgeTurn = 0;
        }
      } else {
        this.mouseEdgeTurn = 0;
      }

      const tanRef = Math.tan(THREE.MathUtils.degToRad(62) * 0.5);
      const fovScale = clamp(Math.tan(THREE.MathUtils.degToRad(this.camera.fov) * 0.5) / tanRef, 0.14, 1.15);
      const s = 0.0022 * fovScale * this.aimSensitivity;
      const activeVeh = this.level?.vehicles?.activeVehicle ?? null;
      const yDir = this.invertY ? 1 : -1;
      if (activeVeh) {
        const vehSens = this.freeCamera.sensitivity;
        if (this.vehCam.preset === "hood" || this.vehCam.preset === "bumper") {
          this.freeYaw = clamp(this.freeYaw - dx * s * 1.15 * vehSens, -1.25, 1.25);
          this.freePitch = clamp(this.freePitch + dy * s * yDir * vehSens, -0.32, 0.45);
        } else {
          // Free 360-degree camera orbit while driving — identical feel to walking
          this.camYaw -= dx * s * vehSens;
          this.camPitch = clamp(this.camPitch + dy * s * yDir * vehSens, -0.35, 1.15);
        }
        this.freeIdle = 0;
      } else {
        this.camYaw -= dx * s;
        this.camPitch = clamp(this.camPitch + dy * s * yDir, -1.2, 1.25);
      }
      if (!this.showcase) {
        this.yaw = this.camYaw;
        this.pitch = this.camPitch;
      }
    });
    on(
      window,
      "wheel",
      (e: WheelEvent) => {
        if (this.showcase) {
          this.zoomDist = clamp(this.zoomDist + e.deltaY * 0.002, 1.0, 6);
          return;
        }
        if (this.phase !== "ready" || this.paused || this.mapOpen || this.weaponWheelOpen || this.phoneOpen) return;
        e.preventDefault();
        if (this.binocularsOpen) {
          const step = e.deltaY < 0 ? 1 : -1;
          this.binocularsZoomIdx = clamp(this.binocularsZoomIdx + step, 0, 2);
          this.sfx.binocPing();
          this.emitHud();
          return;
        }
        if (this.level?.vehicles?.activeVehicle && this.vehCam.preset !== "hood" && this.vehCam.preset !== "bumper") {
          // Scroll wheel zooms exterior chase distance while driving
          this.vehCam.distance = clamp(this.vehCam.distance + Math.sign(e.deltaY) * 0.55, 3.2, 13.5);
          this.saveVehicleCameraSettings();
          return;
        }
        if (this.mouseR || this.uiHeld.ads) {
          const w = WEAPONS[this.weaponIdx];
          const st = this.weaponAmmo[this.weaponIdx];
          const mods = this.getActiveWeaponMods(w.id);
          const minFov = Math.max(8, w.adsFovMin + mods.adsFovBonus);
          const maxFov = Math.max(minFov + 4, w.adsFovMax);
          // scroll up (deltaY < 0) zooms IN (smaller FOV), scroll down zooms OUT
          const delta = Math.sign(e.deltaY) * Math.max(2.5, Math.min(8, Math.abs(e.deltaY) * 0.04));
          st.adsFov = clamp(st.adsFov + delta, minFov, maxFov);
          this.emitHud();
        } else if (!this.level?.vehicles?.activeVehicle && !this.rig?.dead && Math.abs(e.deltaY) >= 4) {
          const now = performance.now();
          if (now - this.lastWheelSwitchMs < 85) return;
          this.lastWheelSwitchMs = now;
          const step = e.deltaY > 0 ? 1 : -1;
          this.selectWeapon(this.weaponIdx + step);
        }
      },
      { passive: false },
    );
    on(document, "pointerlockchange", () => {
      this.locked = document.pointerLockElement === el;
      this.mouseEdgeTurn = 0;
      this.lastClientX = null;
      this.lastClientY = null;
      this.syncCursorStyle();
      this.emitHud();
    });
    on(document, "pointerlockerror", () => {
      this.syncCursorStyle();
      this.emitHud();
    });
    on(el, "webglcontextlost", (e: Event) => {
      e.preventDefault();
      this.contextLost = true;
    });
    on(el, "webglcontextrestored", () => {
      this.contextLost = false;
      this.initPostProcessing();
      this.resize();
      this.pausedRendered = false;
      this.startLoop();
    });
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(this.container);
  }

  private isActiveGameplay() {
    return (
      !this.menuHangar &&
      this.phase === "ready" &&
      !this.paused &&
      !this.rig?.dead &&
      !this.weaponWheelOpen &&
      !this.mapOpen &&
      !this.phoneOpen
    );
  }

  private syncCursorStyle() {
    if (this.disposed) return;
    this.renderer.domElement.style.cursor = this.isActiveGameplay() ? "none" : "";
  }

  requestLock(force = false) {
    if (this.locked) return;
    const now = performance.now();
    if (!force && now - this.lastLockAttemptMs < 500) return;
    this.lastLockAttemptMs = now;
    try {
      const p = this.renderer.domElement.requestPointerLock() as unknown as Promise<void> | undefined;
      p?.catch?.(() => {});
    } catch {
      // Fallback mouselook + CSS cursor hiding remain active if Pointer Lock is disallowed
    }
  }

  private initPostProcessing() {
    try {
      const w = Math.max(2, this.container.clientWidth || window.innerWidth);
      const h = Math.max(2, this.container.clientHeight || window.innerHeight);
      const msaaSamples = this.renderer.capabilities.isWebGL2 ? 4 : 0;
      const composer = new EffectComposer(this.renderer, {
        frameBufferType: THREE.HalfFloatType,
        multisampling: msaaSamples,
      });
      composer.setSize(w, h, false);
      composer.addPass(new RenderPass(this.scene, this.camera));

      // Full-resolution screen-space ambient occlusion (N8AO) — zero half-res stipple pixels
      const n8ao = new N8AOPostPass(this.scene, this.camera, w, h);
      n8ao.configuration.halfRes = false;
      n8ao.configuration.aoSamples = 16;
      n8ao.configuration.denoiseSamples = 8;
      n8ao.configuration.aoRadius = 2.4;
      n8ao.configuration.distanceFalloff = 1.0;
      n8ao.configuration.intensity = 2.2;
      composer.addPass(n8ao);

      const smaa = new SMAAEffect({ preset: SMAAPreset.ULTRA });
      const bloom = new BloomEffect({
        mipmapBlur: true,
        luminanceThreshold: 1.04,
        luminanceSmoothing: 0.2,
        intensity: 0.24,
      });
      const toneMapping = new ToneMappingEffect({ mode: ToneMappingMode.ACES_FILMIC });
      composer.addPass(new EffectPass(this.camera, bloom, smaa, toneMapping));

      // ToneMappingEffect applies ACES Filmic at the end of the pipeline
      this.renderer.toneMapping = THREE.NoToneMapping;
      this.n8aoPass = n8ao;
      this.bloomEffect = bloom;
      this.smaaEffect = smaa;
      this.composer = composer;
    } catch {
      this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
      this.composer = null;
      this.n8aoPass = null;
      this.bloomEffect = null;
      this.smaaEffect = null;
    }
  }

  private syncCamFov(fov: number) {
    if (Math.abs(fov - this.lastCamFov) > 0.015) {
      this.camera.fov = fov;
      this.camera.updateProjectionMatrix();
      this.lastCamFov = fov;
    }
  }

  private applyPerfTier() {
    const nativeDpr = window.devicePixelRatio || 1;
    const cap = this.perfTier === 0 ? 2.5 : this.perfTier === 1 ? 2.0 : 1.5;
    const nextDpr = Math.min(nativeDpr, cap);
    if (Math.abs(this.renderer.getPixelRatio() - nextDpr) > 0.02) {
      this.renderer.setPixelRatio(nextDpr);
      this.resize();
    }
  }

  private resize() {
    const w = this.container.clientWidth || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.renderer.domElement.style.width = "100%";
    this.renderer.domElement.style.height = "100%";
    if (this.composer) {
      this.composer.setSize(w, h, false);
      this.n8aoPass?.setSize(w, h);
    }
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.lastCamFov = this.camera.fov;
    const s = (h * this.renderer.getPixelRatio()) / (2 * Math.tan(THREE.MathUtils.degToRad(this.camera.fov) / 2));
    this.fx.setScale(s);
  }

  /* ------------------------------------------------------------ */
  setHeld(k: Held, v: boolean) {
    this.uiHeld[k] = v;
  }
  toggleHeld(k: Held) {
    if (k === "crouch") this.crouchToggle = !this.crouchToggle;
    else this.uiHeld[k] = !this.uiHeld[k];
    this.emitHud();
  }
  setTimeScale(v: number) {
    this.timeScale = v;
  }
  setPaused(v: boolean) {
    this.paused = v;
    this.pausedRendered = false;
    this.mouseEdgeTurn = 0;
    this.lastClientX = null;
    this.lastClientY = null;
    if (this.level?.vehicles?.activeVehicle) {
      this.vehAudio.setActive(!v);
    }
    if (v) {
      this.mouseL = false;
      this.mouseR = false;
      if (document.pointerLockElement) document.exitPointerLock();
    } else if (this.isActiveGameplay()) {
      this.requestLock();
    }
    this.syncCursorStyle();
    this.startLoop();
    this.emitHud();
  }
  toggleMute() {
    this.muted = !this.muted;
    this.sfx.enabled = !this.muted;
    this.vehAudio.setMuted(this.muted);
    if (this.activeCall?.audio) {
      this.activeCall.audio.muted = this.muted;
    }
    if (this.dialogueAudio) {
      this.dialogueAudio.muted = this.muted;
    }
    this.commsVoice.muted = this.muted;
    if (this.level?.pedestrians?.voices) {
      this.level.pedestrians.voices.muted = this.muted;
      if (this.muted) this.level.pedestrians.voices.stopRadio();
    }
    if (this.muted) this.commsVoice.stopRadio();
    if (this.muted && typeof window !== "undefined" && "speechSynthesis" in window) {
      try {
        window.speechSynthesis.cancel();
      } catch {}
    }
    this.saveAudioSettings();
    this.emitHud();
  }
  setSfxVolume(v: number) {
    this.sfxVolume = clamp(v, 0, 1);
    this.sfx.setVolume(this.sfxVolume);
    this.saveAudioSettings();
    this.emitHud();
  }
  setEngineVolume(v: number) {
    this.engineVolume = clamp(v, 0, 1);
    this.vehAudio.setVolume(this.engineVolume);
    this.saveAudioSettings();
    this.emitHud();
  }
  private loadAudioSettings() {
    try {
      const raw = JSON.parse(localStorage.getItem("voss_audio_prefs") || "{}");
      if (typeof raw.muted === "boolean") {
        this.muted = raw.muted;
        this.sfx.enabled = !this.muted;
        this.vehAudio.setMuted(this.muted);
      }
      if (typeof raw.sfx === "number" && Number.isFinite(raw.sfx)) {
        this.sfxVolume = clamp(raw.sfx, 0, 1);
        this.sfx.setVolume(this.sfxVolume);
      }
      if (typeof raw.engine === "number" && Number.isFinite(raw.engine)) {
        this.engineVolume = clamp(raw.engine, 0, 1);
        this.vehAudio.setVolume(this.engineVolume);
      }
    } catch {}
  }
  private saveAudioSettings() {
    try {
      localStorage.setItem(
        "voss_audio_prefs",
        JSON.stringify({ muted: this.muted, sfx: this.sfxVolume, engine: this.engineVolume }),
      );
    } catch {}
  }
  setAimSensitivity(v: number) {
    this.aimSensitivity = clamp(v, 0.3, 2.5);
    this.saveInputSettings();
    this.emitHud();
  }
  setInvertY(invert: boolean) {
    this.invertY = invert;
    this.saveInputSettings();
    this.emitHud();
  }
  private loadInputSettings() {
    try {
      const raw = JSON.parse(localStorage.getItem("voss_input_prefs") || "{}");
      if (typeof raw.aimSensitivity === "number" && Number.isFinite(raw.aimSensitivity)) {
        this.aimSensitivity = clamp(raw.aimSensitivity, 0.3, 2.5);
      }
      if (typeof raw.invertY === "boolean") {
        this.invertY = raw.invertY;
      }
    } catch {}
  }
  private saveInputSettings() {
    try {
      localStorage.setItem(
        "voss_input_prefs",
        JSON.stringify({ aimSensitivity: this.aimSensitivity, invertY: this.invertY }),
      );
    } catch {}
  }
  getPhase() {
    return this.phase;
  }

  trigger(t: Trigger) {
    if (!this.rig) return;
    this.sfx.init();
    switch (t) {
      case "reload":
        this.rig.reload();
        break;
      case "jump":
        this.rig.jump();
        break;
      case "hit":
        this.damage(12, (Math.random() - 0.5) * Math.PI * 1.6);
        break;
      case "dieBack":
        this.health = 0;
        this.rig.die("back");
        break;
      case "dieFront":
        this.health = 0;
        this.rig.die("front");
        break;
      case "respawn":
        this.respawn();
        break;
      case "showcase":
        this.showcase = !this.showcase;
        if (!this.showcase) {
          this.camYaw = this.yaw;
          this.camPitch = this.pitch;
        } else {
          this.camPitch = 0.12;
        }
        break;
    }
    this.emitHud();
  }

  damage(n: number, angle: number) {
    if (!this.rig || this.rig.dead || this.phase !== "ready") return;
    const scaled = n * this.stats.damageTakenMult;
    const absorbed = this.armor > 0 ? Math.min(this.armor, scaled * 0.7) : 0;
    this.armor = Math.max(0, this.armor - absorbed);
    this.health = Math.max(0, this.health - (scaled - absorbed));
    this.damageFlash = 1.0;
    this.outOfCombatT = 0;
    this.damageDirRad = angle - this.camYaw;
    this.rig.hit(angle);
    this.camTrauma = Math.min(1, this.camTrauma + 0.42);
    this.shakeX.kick((Math.random() - 0.5) * 8);
    this.shakeY.kick(-5);
    if (this.health <= 0) {
      this.rig.die(Math.abs(angle) < Math.PI / 2 ? "back" : "front");
      this.phase = "dead";
      this.dialogueQueue = [];
      this.dialogue = null;
      this.stopDialogueAudio();
      if (document.pointerLockElement) document.exitPointerLock();
      this.emitHud();
      // practice range (or open-world free-roam without an active contract): free respawn
      if (this.mission?.practice && !this.activeContract) {
        this.practiceRespawnT = 1.2;
      } else {
        const endMission = this.activeContract?.def ?? this.mission!;
        const { reward } = awardMissionReward(endMission.id, this.killed, this.stealthKills, this.alerts, false);
        this.cb?.onMissionEnd(endMission, false, reward);
      }
    }
  }

  /** story missions: full rebuild; practice: quick reset */
  respawn() {
    if (!this.mission) return;
    this.stats = getPlayerStats();
    this.maxHealth = this.stats.maxHp;
    if (this.activeContract) {
      const id = this.activeContract.def.id;
      this.activeContract = null;
      this.clearActiveContractEntities();
      void this.startMission(id, this.cb!);
      return;
    }
    if (this.mission.practice) {
      this.health = this.maxHealth;
      const sp = this.mission.spawn;
      this.holstered = false;
      this.weaponWheelOpen = false;
      this.mapOpen = false;
      this.rig.respawn(new THREE.Vector3(sp[0], 0, sp[1]));
      const sv = loadSave();
      this.rig.setWeaponConfigs(sv.weaponConfigs);
      this.weaponConfigs = sv.weaponConfigs ?? {};
      this.rig.setAppearance(sv.appearance);
      this.rig.crouchSpeedMult = this.stats.crouchSpeedMult;
      this.resetWeapons();
      this.rig.aimYaw = THREE.MathUtils.degToRad(sp[2]);
      this.yaw = this.camYaw = this.rig.aimYaw;
      this.phase = "ready";
      this.emitHud();
    } else {
      void this.startMission(this.mission.id, this.cb!);
    }
  }

  exitToMenu() {
    if (document.pointerLockElement) document.exitPointerLock();
    this.paused = false;
    this.pausedRendered = false;
    this.holstered = false;
    this.weaponWheelOpen = false;
    this.mapOpen = false;
    this.startLoop();
    void this.enterMenuHangar();
  }

  /* ------------------------------------------------------------ */
  private handleBossEngage(boss: Fighter) {
    const taunt = BOSS_TAUNTS[boss.name];
    if (!taunt) return;
    this.queueDialogue([
      { speaker: taunt.speaker, text: taunt.engageLine, audioUrl: taunt.engageAudio },
    ]);
  }

  private handleBossHalfHp(boss: Fighter, host: CombatHost) {
    const mDef = this.activeContract?.def ?? this.mission;
    const taunt = BOSS_TAUNTS[boss.name];
    if (taunt) {
      this.activityToast = {
        title: taunt.halfHpTitle,
        subtitle: taunt.halfHpDetail,
        accent: "#ef4444",
      };
      this.activityToastTimer = 4.2;
      this.queueDialogue([
        { speaker: taunt.speaker, text: taunt.hazardLine, audioUrl: taunt.hazardAudio },
      ]);
    }

    const playerPos = this.rig?.root.position;
    if (playerPos) {
      for (const e of this.enemies) {
        if (!e.isDead && e !== boss) {
          e.alertFrom(playerPos, 0.05, 1.0);
        }
      }
    }

    // Spawn 2 flanking tactical guards for mid-to-late campaign bosses (M4, M5, M6)
    const missionId = mDef?.id ?? 0;
    const parentGroup = this.contractGroup ?? this.missionRoot;
    const bp = boss.rig.root.position;

    // Signature Phase 2 Arena Hazard per campaign boss
    if (missionId === 4) {
      // Commander Ren: Tactical deck smoke screen across the freighter
      this.bossSmokePos = playerPos ? playerPos.clone().lerp(bp, 0.45) : bp.clone();
      this.bossSmokeT = 10.5;
      this.bossSmokeEmitCd = 0;
    } else if (missionId === 3) {
      // Viktor Kroll: Stun / flashbang burst in courtyard
      const flashCenter = playerPos ? playerPos.clone() : bp.clone();
      this.damageFlash = Math.max(this.damageFlash, 0.92);
      this.camTrauma = Math.min(1, this.camTrauma + 0.55);
      this.shakeX.kick(10);
      this.shakeY.kick(10);
      for (let i = 0; i < 6; i++) {
        const ang = (i / 6) * Math.PI * 2;
        const fp = new THREE.Vector3(flashCenter.x + Math.cos(ang) * 2.4, flashCenter.y + 1.4, flashCenter.z + Math.sin(ang) * 2.4);
        this.fx.flashes.emit(fp, new THREE.Vector3(0, 0.6, 0), 2.4, 0.25, 0.55, new THREE.Color(1, 0.96, 0.85), 3.6);
      }
      this.sfx.hit();
    } else if (missionId === 5) {
      // Chairman Viktor Sorin: Atrium lockdown electric surge
      this.camTrauma = Math.min(1, this.camTrauma + 0.48);
      this.fx.explosion(new THREE.Vector3(bp.x, bp.y + 1.0, bp.z), 1.4);
      this.vehAudio.crash(0.95);
    } else if (missionId === 6) {
      // General Drago Kovač: Telegraphed Ironridge mortar battery strikes
      this.bossMortarActive = true;
      this.bossMortarCd = 0.75;
    }

    if (mDef && parentGroup && (missionId === 4 || missionId === 5 || missionId === 6)) {
      const offsets: [number, number][] = [
        [7.5, -6.5],
        [-7.5, 6.5],
      ];
      for (const [ox, oz] of offsets) {
        const sx = bp.x + ox;
        const sz = bp.z + oz;
        const sy = this.level ? this.level.groundHeightAt(sx, sz, bp.y + 1.5) : bp.y;
        const guard = new Enemy(
          host,
          {
            x: sx,
            y: sy,
            z: sz,
            role: missionId === 6 ? "heavy" : "guard",
            mode: "advance",
            yawDeg: Math.round(Math.random() * 360),
          },
          mDef,
        );
        void guard.build(parentGroup, mDef.tint, 0.98).then(() => {
          if (this.disposed) return;
          this.enemyHits.push(guard.hitbox);
          this.enemies.push(guard);
          if (playerPos) guard.alertFrom(playerPos, 0.05, 1.0);
        });
      }
    }
  }

  private updateBossHazards(dt: number) {
    // 1. Ren's deck smoke screen
    if (this.bossSmokeT > 0 && this.bossSmokePos) {
      this.bossSmokeT = Math.max(0, this.bossSmokeT - dt);
      this.bossSmokeEmitCd -= dt;
      if (this.bossSmokeEmitCd <= 0) {
        this.bossSmokeEmitCd = 0.22;
        const smokeColor = new THREE.Color(0.72, 0.76, 0.8);
        for (let i = 0; i < 4; i++) {
          const ang = Math.random() * Math.PI * 2;
          const r = 1.2 + Math.random() * 6.5;
          const sp = new THREE.Vector3(
            this.bossSmokePos.x + Math.cos(ang) * r,
            this.bossSmokePos.y + 0.35 + Math.random() * 0.8,
            this.bossSmokePos.z + Math.sin(ang) * r,
          );
          this.fx.smoke.emit(
            sp,
            new THREE.Vector3((Math.random() - 0.5) * 0.6, 0.55 + Math.random() * 0.45, (Math.random() - 0.5) * 0.6),
            2.6,
            0.15,
            2.4,
            smokeColor,
            4.2,
          );
        }
      }
    }

    // 2. Kovač's Ironridge mortar barrage while Kovač is alive in Phase 2
    const kovacAlive = Boolean(this.bossEntity && !this.bossEntity.isDead && (this.activeContract?.def.id ?? this.mission?.id) === 6);
    if (!kovacAlive) {
      this.bossMortarActive = false;
    } else if (this.bossMortarActive && this.rig && !this.rig.dead) {
      this.bossMortarCd -= dt;
      if (this.bossMortarCd <= 0 && this.bossMortarStrikes.length < 2) {
        this.bossMortarCd = 4.4;
        const p = this.rig.root.position;
        const tx = p.x + (Math.random() - 0.5) * 3.2;
        const tz = p.z + (Math.random() - 0.5) * 3.2;
        const ty = this.level ? this.level.groundHeightAt(tx, tz, p.y + 1.5) : p.y;
        const ringGeo = new THREE.RingGeometry(0.4, 3.8, 36);
        const ringMat = new THREE.MeshBasicMaterial({
          color: 0xff3b30,
          transparent: true,
          opacity: 0.72,
          side: THREE.DoubleSide,
          depthWrite: false,
        });
        const ring = new THREE.Mesh(ringGeo, ringMat);
        ring.rotation.x = -Math.PI / 2;
        ring.position.set(tx, ty + 0.12, tz);
        const hostGroup = this.contractGroup ?? this.missionRoot;
        hostGroup.add(ring);
        this.bossMortarStrikes.push({ x: tx, y: ty, z: tz, t: 0, maxT: 1.65, ring });
      }
    }

    for (let i = this.bossMortarStrikes.length - 1; i >= 0; i--) {
      const ms = this.bossMortarStrikes[i];
      ms.t += dt;
      const frac = clamp(ms.t / ms.maxT, 0, 1);
      const pulse = 0.45 + 0.55 * Math.sin(ms.t * 20);
      ms.ring.scale.setScalar(0.35 + 0.65 * frac);
      (ms.ring.material as THREE.MeshBasicMaterial).opacity = 0.4 + 0.45 * pulse;
      if (ms.t >= ms.maxT) {
        ms.ring.parent?.remove(ms.ring);
        ms.ring.geometry.dispose();
        (ms.ring.material as THREE.Material).dispose();
        this.bossMortarStrikes.splice(i, 1);
        const blastPos = new THREE.Vector3(ms.x, ms.y + 0.3, ms.z);
        this.detonateAt(blastPos, 7.5);
        if (this.rig && !this.rig.dead) {
          const d = Math.hypot(this.rig.root.position.x - ms.x, this.rig.root.position.z - ms.z);
          if (d < 4.1) {
            const falloff = 1 - d / 4.4;
            this.damage(Math.round(32 * Math.max(0.35, falloff)), Math.atan2(this.rig.root.position.x - ms.x, this.rig.root.position.z - ms.z));
          }
        }
      }
    }
  }

  private handleSquadComms(kind: SquadCommsKind) {
    const now = typeof performance !== "undefined" ? performance.now() : Date.now();
    const minGap = kind === "body" ? 3200 : 6200;
    if (now - this.lastSquadCommsAt < minGap) return;
    this.lastSquadCommsAt = now;

    const lines: Record<SquadCommsKind, string> = {
      body: "Man down! Body found — all units converge and sweep the area!",
      gunfire: "Shots fired! All squads respond to gunfire!",
      contact: "Contact! Hostile spotted, moving to intercept!",
      under_fire: "Taking fire! Need backup on my position!",
      man_down: "Unit down! Keep your eyes sharp!",
    };
    const voiceSys = this.level?.pedestrians?.voices ?? this.commsVoice;
    voiceSys.muted = this.muted;
    voiceSys.speakRadioAudio("Guard Comms", lines[kind], `/audio/comms/comms_${kind}.mp3`, clamp(this.sfxVolume * 1.15, 0.35, 0.85));
    if (kind === "body") {
      this.activityToast = {
        title: "GUARD RADIO · BODY DISCOVERED",
        subtitle: "Squad alerted — guards are converging to search",
        accent: "#f59e0b",
      };
      this.activityToastTimer = 3.0;
    }
  }

  private onFirstContact() {
    this.alerts++;
    const mDef = this.activeContract?.def ?? this.mission;
    if (this.firstContact || !mDef) return;
    this.firstContact = true;
    if (mDef.onFirstContact) this.queueDialogue(mDef.onFirstContact);
  }

  private onEnemyKilled(e: Fighter, stealth = false) {
    this.killed++;
    if (stealth) this.stealthKills++;
    this.sfx.thud();
      if (e === this.bossEntity) {
        this.bossKilled = true;
        this.bossEntity = null;
      }
    this.updateObjectives();
    const mDef = this.activeContract?.def ?? this.mission!;
    // halfway line
    const eliminateTotal = mDef.enemies.filter((s) => !s.boss).length;
    if (!this.halfwayPlayed && eliminateTotal > 0 && this.killed >= Math.ceil(eliminateTotal / 2)) {
      this.halfwayPlayed = true;
      if (mDef.onHalfway) this.queueDialogue(mDef.onHalfway);
    }
    // objective dialogue once all non-extract objectives are complete
    if (!this.objectiveDialoguePlayed && mDef.onObjective) {
      const allNonExtract = this.objectives.filter((o) => o.id !== "extract" && o.id !== "travel").every((o) => o.done);
      if (allNonExtract) {
        this.objectiveDialoguePlayed = true;
        this.queueDialogue(mDef.onObjective);
      }
    }
    this.emitHud();
  }

  private queueDialogue(lines?: DialogueLine[]) {
    if (!lines || lines.length === 0) return;
    this.dialogueQueue.push(...lines);
    if (!this.dialogue) {
      this.dialogueT = 0;
      this.nextDialogue();
    }
    this.emitHud();
  }

  private stopDialogueAudio() {
    if (this.dialogueAudio) {
      try {
        this.dialogueAudio.pause();
        this.dialogueAudio.src = "";
      } catch {}
      this.dialogueAudio = null;
    }
  }

  private nextDialogue() {
    this.stopDialogueAudio();
    const line = this.dialogueQueue.shift();
    this.dialogue = line ?? null;
    this.dialogueT = line ? line.dur ?? clamp(line.text.length / 38, 2.5, 6.5) : 0;
    if (line?.audioUrl && typeof window !== "undefined") {
      // Do not talk over an actively playing phone call briefing
      const callSpeaking = Boolean(this.activeCall?.audio && !this.activeCall.audio.paused && !this.activeCall.audio.ended);
      if (!callSpeaking) {
        try {
          const audio = new Audio(line.audioUrl);
          audio.volume = clamp(this.sfxVolume * 1.35, 0.35, 1.0);
          audio.muted = this.muted;
          this.dialogueAudio = audio;
          audio.onloadedmetadata = () => {
            if (this.dialogueAudio === audio && Number.isFinite(audio.duration) && audio.duration > 0.5) {
              this.dialogueT = Math.max(this.dialogueT, audio.duration + 0.45);
            }
          };
          audio.onended = () => {
            if (this.dialogueAudio === audio) this.dialogueAudio = null;
          };
          void audio.play().catch(() => {
            if (this.dialogueAudio === audio) this.dialogueAudio = null;
          });
        } catch {}
      }
    }
    this.emitHud();
  }

  private updateObjectives() {
    const mDef = this.activeContract?.def ?? this.mission;
    if (!mDef) return;
    const eliminateTotal = mDef.enemies.filter((e) => !e.boss).length;
    let newlyCompletedMilestone = false;
    for (const o of this.objectives) {
      if (o.done) continue;
      const def = mDef.objectives.find((x) => x.id === o.id);
      const kind = def?.kind;
      if (kind === "eliminate") {
        o.progress = Math.min(eliminateTotal, this.killed - (this.bossKilled ? 1 : 0));
        if (o.total > 0 && o.progress >= o.total) o.done = true;
      } else if (kind === "boss") {
        o.progress = this.bossKilled ? 1 : 0;
        if (o.total > 0 && o.progress >= o.total) {
          o.done = true;
          newlyCompletedMilestone = true;
        }
      } else if (kind === "destroy") {
        o.progress = this.destroyed;
        if (o.total > 0 && o.progress >= o.total) {
          o.done = true;
          newlyCompletedMilestone = true;
        }
      } else if (kind === "rescue") {
        o.progress = this.rescued ? 1 : 0;
        if (o.progress >= o.total) {
          o.done = true;
          newlyCompletedMilestone = true;
        }
      } else if (kind === "interact") {
        o.progress = this.interactables.filter((x) => x.def.objId === o.id && x.done).length;
        if (o.total > 0 && o.progress >= o.total) {
          o.done = true;
          newlyCompletedMilestone = true;
        }
      }
      // kind "reach" handled by proximity checks in frame
    }
    if (newlyCompletedMilestone && (!mDef.practice || !!this.activeContract) && this.health > 0) {
      this.health = Math.min(this.maxHealth, this.health + 25);
    }
    const nonExtract = this.objectives.filter((o) => o.id !== "extract" && o.id !== "travel");
    const doneNonExtract = nonExtract.filter((o) => o.done).length;
    if (!this.halfwayPlayed && nonExtract.length >= 2 && doneNonExtract >= Math.floor(nonExtract.length / 2)) {
      this.halfwayPlayed = true;
      if (mDef.onHalfway) this.queueDialogue(mDef.onHalfway);
    }
  }

  private checkAllNonExtractDone() {
    const mDef = this.activeContract?.def ?? this.mission;
    if (!this.objectiveDialoguePlayed && mDef?.onObjective) {
      const allNonExtract = this.objectives.filter((o) => o.id !== "extract" && o.id !== "travel").every((o) => o.done);
      if (allNonExtract) {
        this.objectiveDialoguePlayed = true;
        this.queueDialogue(mDef.onObjective);
      }
    }
  }

  private updateInteractables(dt: number) {
    if (!this.mission || !this.rig || this.rig.dead) {
      this.activeInteract = null;
      this.interactHoldT = 0;
      return;
    }
    const p = this.rig.root.position;
    let nearest: InteractableInstance | null = null;
    let bestD = 2.65;
    for (const inst of this.interactables) {
      inst.update(dt);
      if (inst.done) continue;
      if (Math.abs(p.y - inst.pos.y) > 2.2) continue;
      const d = Math.hypot(p.x - inst.pos.x, p.z - inst.pos.z);
      if (d < bestD) {
        bestD = d;
        nearest = inst;
      }
    }
    if (nearest !== this.activeInteract) {
      if (this.activeInteract && !this.activeInteract.done) this.activeInteract.setProgress(0);
      this.activeInteract = nearest;
      this.interactHoldT = 0;
      this.interactTickCd = 0;
    }
    if (nearest && this.keys.has("KeyF")) {
      this.interactHoldT += dt;
      nearest.setProgress(this.interactHoldT / Math.max(0.1, nearest.def.duration));
      this.interactTickCd -= dt;
      if (this.interactTickCd <= 0) {
        if (nearest.def.kind === "terminal") this.sfx.interactTick();
        this.interactTickCd = 0.22;
      }
      if (this.interactHoldT >= nearest.def.duration) {
        nearest.setDone();
        this.sfx.interactDone();
        this.interactHoldT = 0;
        this.activeInteract = null;
        this.updateObjectives();
        this.checkAllNonExtractDone();
        this.emitHud();
      }
    } else {
      this.interactHoldT = Math.max(0, this.interactHoldT - dt * 2.5);
      if (nearest && !nearest.done) {
        nearest.setProgress(this.interactHoldT / Math.max(0.1, nearest.def.duration));
      }
    }
  }

  private checkProximityObjectives(dt: number) {
    if (!this.mission || !this.level) return;
    const mDef = this.activeContract?.def ?? this.mission;
    const site = this.activeContract?.site ?? null;
    const p = this.rig.root.position;
    for (const o of this.objectives) {
      if (o.done || o.id === "travel") continue;
      if (this.activeContract && o.id === "extract") continue; // open-world exfil requires physically leaving the area
      const def = mDef.objectives.find((x) => x.id === o.id);
      if (!def || def.kind !== "reach" || !def.at) continue;
      const [tx, , tz] = site ? localToWorldMissionPos(site, def.at[0], 0, def.at[1]) : [def.at[0], 0, def.at[1]];
      const d = Math.hypot(p.x - tx, p.z - tz);
      if (d < 4.5) {
        if (def.id === "extract") {
          // extraction only counts once every other objective is complete
          const allDone = this.objectives.filter((x) => x.id !== "extract").every((x) => x.done);
          if (!allDone) continue;
        }
        o.done = true;
        o.progress = o.total;
        if (def.id === "extract") {
          this.completeMission();
          return;
        }
        if (def.id === "rescue" && !this.objectiveDialoguePlayed) {
          this.objectiveDialoguePlayed = true;
          if (mDef.onObjective) this.queueDialogue(mDef.onObjective);
        }
        this.emitHud();
      }
    }
    // rescue proximity
    if (this.npc && !this.rescued) {
      const d = Math.hypot(p.x - this.npc.x, p.z - this.npc.z);
      if (d < 3.5) {
        this.rescued = true;
        this.updateObjectives();
        if (!this.objectiveDialoguePlayed && mDef.onObjective) {
          const allNonExtract = this.objectives.filter((o) => o.id !== "extract" && o.id !== "travel").every((o) => o.done);
          if (allNonExtract || mDef.id === 1) {
            this.objectiveDialoguePlayed = true;
            this.queueDialogue(mDef.onObjective);
          } else {
            this.queueDialogue([
              { speaker: "Voss", text: "I'm here. Let's move.", audioUrl: "/audio/story/voss_m4_rescue.mp3" },
            ]);
          }
        }
        this.emitHud();
      }
    }
    // extract ring fade in/out + vertical exfil beam
    if (this.extractRing) {
      const ex = mDef.extraction;
      const [exX, , exZ] = site ? localToWorldMissionPos(site, ex[0], 0, ex[1]) : [ex[0], 0, ex[1]];
      const d = Math.hypot(p.x - exX, p.z - exZ);
      const mat = this.extractRing.material as THREE.MeshBasicMaterial;
      const allDone = this.objectives.filter((o) => o.id !== "extract" && o.id !== "travel").every((o) => o.done);
      mat.opacity = 0.35 + Math.max(0, 0.25 - d / 20) + (allDone ? 0.25 : 0);
      mat.color.setHex(allDone ? 0x34d399 : 0xffcc44);
      if (this.extractBeacon) {
        this.extractBeacon.visible = allDone;
        if (allDone) {
          (this.extractBeacon.material as THREE.MeshBasicMaterial).opacity = 0.14 + Math.sin(performance.now() * 0.0035) * 0.05;
        }
      }
    }
    if (this.rescueBeacon) {
      this.rescueBeacon.rotation.y += dt * 1.5;
      this.rescueBeacon.visible = !this.rescued;
    }
  }

  private clearActiveContractEntities() {
    for (const [mesh] of this.destroyableHp) {
      if (!mesh.visible) {
        mesh.visible = true;
        if (this.level?.spatialColliders) {
          mesh.updateWorldMatrix(true, false);
          this.level.spatialColliders.insert(mesh, new THREE.Box3().setFromObject(mesh));
        }
      }
    }
    this.destroyableHp.clear();
    if (this.approachRing) {
      this.missionRoot.remove(this.approachRing);
      this.approachRing.geometry.dispose();
      (this.approachRing.material as THREE.Material).dispose();
      this.approachRing = null;
    }
    if (this.approachBeacon) {
      this.missionRoot.remove(this.approachBeacon);
      this.approachBeacon.geometry.dispose();
      (this.approachBeacon.material as THREE.Material).dispose();
      this.approachBeacon = null;
    }
    if (this.extractRing) {
      this.missionRoot.remove(this.extractRing);
      this.extractRing.geometry.dispose();
      (this.extractRing.material as THREE.Material).dispose();
      this.extractRing = null;
    }
    if (this.extractBeacon) {
      this.missionRoot.remove(this.extractBeacon);
      this.extractBeacon.geometry.dispose();
      (this.extractBeacon.material as THREE.Material).dispose();
      this.extractBeacon = null;
    }
    if (this.rescueBeacon) {
      this.missionRoot.remove(this.rescueBeacon);
      disposeObject(this.rescueBeacon);
      this.rescueBeacon = null;
    }
    if (this.contractGroup) {
      this.missionRoot.remove(this.contractGroup);
      disposeObject(this.contractGroup);
      this.contractGroup = null;
    }
    this.enemies = [];
    this.enemyHits = [];
    this.ally = null;
    this.npc = null;
    this.bossEntity = null;
    this.bossMortarActive = false;
    this.bossMortarCd = 0;
    for (const ms of this.bossMortarStrikes) {
      ms.ring.parent?.remove(ms.ring);
      ms.ring.geometry.dispose();
      (ms.ring.material as THREE.Material).dispose();
    }
    this.bossMortarStrikes = [];
    this.bossSmokePos = null;
    this.bossSmokeT = 0;
    this.bossSmokeEmitCd = 0;
    this.interactables = [];
    this.activeInteract = null;
    this.interactHoldT = 0;
    this.interactTickCd = 0;
    this.guardFlashlights = [];
  }

  private activateOpenWorldContract(missionId: number) {
    const def = MISSIONS.find((m) => m.id === missionId);
    const site = getOpenWorldMissionSite(missionId);
    if (!def || !site || !this.level || !this.rig) return;

    this.clearActiveContractEntities();
    this.firstContact = false;
    this.killed = 0;
    this.stealthKills = 0;
    this.alerts = 0;
    this.shotsFired = 0;
    this.shotsHit = 0;
    this.headshots = 0;
    this.missionElapsedSec = 0;
    this.activeDifficulty = loadSave().difficulty ?? "operative";
    this.bossKilled = false;
    this.destroyed = 0;
    this.rescued = false;
    this.objectiveDialoguePlayed = false;
    this.halfwayPlayed = false;
    this.dialogueQueue = [];
    this.dialogue = null;

    this.activeContract = { def, site, stage: "travel", spawned: false };
    this.objectives = [
      {
        id: "travel",
        label: `Drive to ${def.name} · ${site.districtLabel}`,
        done: false,
        progress: 0,
        total: 1,
      },
      ...def.objectives.map((o: ObjectiveDef) => ({
        id: o.id,
        label: o.id === "extract" ? `Leave the area (${site.escapeRadius}m clear of site)` : o.label,
        done: false,
        progress: 0,
        total: o.count ?? (o.kind === "reach" || o.kind === "rescue" ? 1 : 0),
      })),
    ];

    const p = this.level.vehicles?.activeVehicle?.pos ?? this.rig.root.position;
    const distSite = Math.hypot(p.x - site.x, p.z - site.z);
    const distApp = Math.hypot(p.x - site.approachX, p.z - site.approachZ);
    if (distSite <= site.enterRadius || distApp <= 22) {
      this.objectives[0].done = true;
      this.objectives[0].progress = 1;
      this.activeContract.stage = "infiltrate";
      void this.spawnContractEncounter();
      this.activityToast = {
        title: `${def.codename} · ${def.name}`,
        subtitle: `Infiltrate ${site.districtLabel}`,
        accent: def.accent,
      };
      this.activityToastTimer = 4.0;
    } else {
      const gy = this.level.groundHeightAt(site.approachX, site.approachZ, 20);
      const ringGeo = new THREE.RingGeometry(4.2, 4.85, 40);
      const ringMat = new THREE.MeshBasicMaterial({
        color: 0xfbbf24,
        transparent: true,
        opacity: 0.72,
        side: THREE.DoubleSide,
        depthWrite: false,
      });
      this.approachRing = new THREE.Mesh(ringGeo, ringMat);
      this.approachRing.rotation.x = -Math.PI / 2;
      this.approachRing.position.set(site.approachX, gy + 0.12, site.approachZ);
      this.missionRoot.add(this.approachRing);

      const beam = new THREE.Mesh(
        new THREE.CylinderGeometry(0.35, 1.35, 22, 16, 1, true),
        new THREE.MeshBasicMaterial({
          color: 0xfbbf24,
          transparent: true,
          opacity: 0.22,
          side: THREE.DoubleSide,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
        }),
      );
      beam.position.set(site.approachX, gy + 11, site.approachZ);
      this.approachBeacon = beam;
      this.missionRoot.add(beam);

      this.activityToast = {
        title: `CONTRACT ACTIVE · ${def.codename}`,
        subtitle: `Drive to ${def.name} (${site.districtLabel} · ${Math.round(distApp)}m)`,
        accent: def.accent,
      };
      this.activityToastTimer = 4.6;
    }
    const mc = getMissionCallForMission(missionId);
    if (mc) this.startMissionCall(mc);
    this.emitHud();
  }

  private async spawnContractEncounter() {
    const ac = this.activeContract;
    if (!ac || !this.level || ac.spawned) return;
    ac.spawned = true;
    const { def, site } = ac;
    const seq = this.missionSeq;
    const group = new THREE.Group();
    group.name = `ContractEncounter_M${def.id}`;
    this.contractGroup = group;
    this.missionRoot.add(group);

    const conseq = getMissionConsequences(loadSave(), def.id);
    const host: CombatHost = {
      colliders: this.level.colliders,
      aabbs: this.level.aabbs,
      spatialAABBs: this.level.spatial,
      rayQuery: this.level.spatialColliders
        ? (origin, dir, maxDist) => this.level!.spatialColliders!.queryRay(origin, dir, maxDist, this.rayScratch)
        : undefined,
      findNavPath: (from, to) => (this.navMesh?.ready ? this.navMesh.findPath(from, to) : null),
      groundHeightAt: (x, z, y) => (this.level ? this.level.groundHeightAt(x, z, y) : 0),
      fx: this.fx,
      sfx: this.sfx,
      playerPos: (out: THREE.Vector3) => {
        const r = this.rig?.root.position;
        return r ? out.set(r.x, r.y + this.rig.eyeHeight, r.z) : out.set(0, 1.6, 0);
      },
      playerAlive: () => !this.rig?.dead,
      playerCrouching: () => this.crouchToggle,
      playerSprinting: () => this.rig?.status === "Sprinting",
      playerDetectMult: () => this.stats.enemyDetectSpeedMult * conseq.detectSpeedMult,
      playerVisionRangeMult: () => this.stats.enemyVisionRangeMult * conseq.visionRangeMult,
      difficultyScale: () => DIFFICULTY_PROFILES[this.activeDifficulty],
      onPlayerHit: (dmg) => this.damage(dmg, Math.random() * Math.PI * 2),
      onKilled: (e, stealth) => this.onEnemyKilled(e, stealth),
      onAlert: () => this.onFirstContact(),
      onBossEngage: (boss) => this.handleBossEngage(boss),
      onBossHalfHp: (boss) => this.handleBossHalfHp(boss, host),
      onSquadComms: (kind) => this.handleSquadComms(kind),
      enemies: () => this.enemies,
      mission: def,
    };

    // Build localized Recast NavMesh + JoltPhysics around the active open-world compound
    if (typeof window !== "undefined") {
      this.navMesh?.dispose();
      const nav = new NavMeshSystem();
      this.navMesh = nav;
      const nearbyMeshes = this.level.spatialColliders
        ? this.level.spatialColliders.queryRadius(site.x, site.z, 85, [])
        : [];
      if (nearbyMeshes.length > 0) {
        void nav.buildFromObjects(nearbyMeshes).then((ok) => {
          if (!ok && this.navMesh === nav) {
            nav.dispose();
            this.navMesh = null;
          }
        });
      }

      this.joltPhysics?.dispose();
      const jolt = new JoltPhysicsWorld(this.missionRoot);
      this.joltPhysics = jolt;
      const nearbyAabbs = this.level.spatial
        ? this.level.spatial.queryPoint(site.x, site.z, 85, [])
        : [];
      void jolt.initFromLevel(nearbyAabbs, site.y).then((ok) => {
        if (!ok && this.joltPhysics === jolt) {
          jolt.dispose();
          this.joltPhysics = null;
        }
      });
    }

    const spawnedEnemies = def.enemies.map((sp) => {
      const [wx, , wz] = localToWorldMissionPos(site, sp.x, 0, sp.z);
      const wy = (sp.y ?? 0) + site.y;
      const yawDeg =
        sp.yawDeg !== undefined
          ? sp.yawDeg + THREE.MathUtils.radToDeg(site.yaw)
          : THREE.MathUtils.radToDeg(Math.atan2(-sp.x, -sp.z) + site.yaw);
      const patrol = sp.patrol?.map(([px, pz]) => {
        const [wpx, , wpz] = localToWorldMissionPos(site, px, 0, pz);
        return [wpx, wpz] as [number, number];
      });
      return new Enemy(host, { ...sp, x: wx, y: wy, z: wz, yawDeg, patrol }, def);
    });

    const batchSize = 4;
    for (let i = 0; i < spawnedEnemies.length; i += batchSize) {
      const slice = spawnedEnemies.slice(i, i + batchSize);
      await Promise.all(slice.map((e) => e.build(group, def.tint, 0.95 + Math.random() * 0.12)));
      if (this.disposed || seq !== this.missionSeq || this.activeContract !== ac) return;
      for (const e of slice) {
        this.enemyHits.push(e.hitbox);
        if (e.boss) this.bossEntity = e;
        this.enemies.push(e);
      }
    }

    if (def.ally) {
      const [ax, ay, az] = localToWorldMissionPos(site, def.ally[0], 0, def.ally[1]);
      this.ally = new Ally(host, ax, az, ay);
      await this.ally.build(group, [0x3f6b3a, 0x88ff88], 1.0);
      if (this.disposed || seq !== this.missionSeq || this.activeContract !== ac) return;
    }

    if (def.rescue) {
      const [rx, ry, rz] = localToWorldMissionPos(site, def.rescue[0], 0, def.rescue[1]);
      this.npc = new RescueNPC(rx, rz, ry);
      await this.npc.build(group, [0xc9b48a, 0xffe0a0]);
      if (this.disposed || seq !== this.missionSeq || this.activeContract !== ac) return;

      const rGrp = new THREE.Group();
      rGrp.position.set(rx, ry, rz);
      const ringMesh = new THREE.Mesh(
        new THREE.RingGeometry(0.6, 0.78, 36),
        new THREE.MeshBasicMaterial({ color: 0xffc857, transparent: true, opacity: 0.65, side: THREE.DoubleSide, depthWrite: false }),
      );
      ringMesh.rotation.x = -Math.PI / 2;
      ringMesh.position.y = 0.07;
      rGrp.add(ringMesh);
      const beam = new THREE.Mesh(
        new THREE.CylinderGeometry(0.18, 0.55, 3.4, 20, 1, true),
        new THREE.MeshBasicMaterial({ color: 0xffd060, transparent: true, opacity: 0.16, depthWrite: false, side: THREE.DoubleSide }),
      );
      beam.position.y = 1.75;
      rGrp.add(beam);
      const diamond = new THREE.Mesh(
        new THREE.OctahedronGeometry(0.24, 0),
        new THREE.MeshStandardMaterial({ color: 0xffd060, emissive: 0xffaa20, emissiveIntensity: 1.5, roughness: 0.2 }),
      );
      diamond.position.y = 2.6;
      diamond.scale.set(0.85, 1.35, 0.85);
      rGrp.add(diamond);
      this.rescueBeacon = rGrp;
      this.missionRoot.add(rGrp);
    }

    const compDestroyables = this.level.compoundDestroyables?.get(def.id) ?? [];
    for (const m of compDestroyables) {
      m.visible = true;
      this.destroyableHp.set(m, 100);
      if (this.level.spatialColliders) {
        m.updateWorldMatrix(true, false);
        this.level.spatialColliders.insert(m, new THREE.Box3().setFromObject(m));
      }
    }

    for (const idef of def.interactables ?? []) {
      const [ix, iy, iz] = localToWorldMissionPos(site, idef.x, idef.y ?? 0, idef.z);
      const inst = createInteractableProp({
        ...idef,
        x: ix,
        y: iy,
        z: iz,
        ry: idef.ry !== undefined ? localToWorldMissionYaw(site, idef.ry) : site.yaw,
      });
      if (conseq.preClearedTerminalId && idef.id === conseq.preClearedTerminalId) {
        inst.done = true;
        inst.group.visible = false;
      }
      group.add(inst.group);
      this.interactables.push(inst);
    }
    if (conseq.preClearedTerminalId) this.updateObjectives();
    if (conseq.enemyHpMult !== 1) {
      for (const e of this.enemies) {
        if (!e.boss) e.hp = Math.round(e.hp * conseq.enemyHpMult);
      }
    }

    this.queueDialogue(def.intro);
    this.startIntroCinematic(def, new THREE.Vector3(site.x, this.level.groundHeightAt(site.x, site.z, 2), site.z), site.yaw, 3.6, conseq.bannerTitle);
    this.emitHud();
  }

  private updateOpenWorldContract(_dt: number, playerPos: THREE.Vector3) {
    const ac = this.activeContract;
    if (!ac || this.phase !== "ready") return;
    const { def, site } = ac;
    const dSite = Math.hypot(playerPos.x - site.x, playerPos.z - site.z);
    const dApp = Math.hypot(playerPos.x - site.approachX, playerPos.z - site.approachZ);

    if (ac.stage === "travel") {
      if (this.approachBeacon) {
        (this.approachBeacon.material as THREE.MeshBasicMaterial).opacity =
          0.18 + Math.sin(performance.now() * 0.004) * 0.06;
      }
      const tr = this.objectives.find((o) => o.id === "travel");
      if (tr) {
        tr.label = `Drive to ${def.name} · ${site.districtLabel} (${Math.round(dApp)}m)`;
      }
      if (dSite <= site.enterRadius || dApp <= 22) {
        if (tr) {
          tr.done = true;
          tr.progress = 1;
          tr.label = `Arrived at ${def.name}`;
        }
        if (this.approachRing) {
          this.missionRoot.remove(this.approachRing);
          this.approachRing.geometry.dispose();
          (this.approachRing.material as THREE.Material).dispose();
          this.approachRing = null;
        }
        if (this.approachBeacon) {
          this.missionRoot.remove(this.approachBeacon);
          this.approachBeacon.geometry.dispose();
          (this.approachBeacon.material as THREE.Material).dispose();
          this.approachBeacon = null;
        }
        ac.stage = "infiltrate";
        void this.spawnContractEncounter();
        this.activityToast = {
          title: `${def.codename} · ON SITE`,
          subtitle: `Complete objectives inside ${def.name}`,
          accent: def.accent,
        };
        this.activityToastTimer = 3.8;
        this.emitHud();
      }
      return;
    }

    if (ac.stage === "infiltrate") {
      if (!ac.spawned) return;
      const nonExtractDone = this.objectives
        .filter((o) => o.id !== "extract" && o.id !== "travel")
        .every((o) => o.done);
      if (nonExtractDone) {
        ac.stage = "escape";
        if (!this.objectiveDialoguePlayed && def.onObjective) {
          this.objectiveDialoguePlayed = true;
          this.queueDialogue(def.onObjective);
        }
        this.activityToast = {
          title: "EXFILTRATE THE AREA",
          subtitle: `Leave ${def.name} (${site.escapeRadius}m away)`,
          accent: "#34d399",
        };
        this.activityToastTimer = 4.4;
        this.emitHud();
      }
      return;
    }

    if (ac.stage === "escape") {
      const exObj = this.objectives.find((o) => o.id === "extract");
      const rem = Math.max(0, Math.round(site.escapeRadius - dSite));
      if (exObj) {
        exObj.label = `Leave the area (${rem}m to clear)`;
      }
      if (dSite >= site.escapeRadius) {
        if (exObj) {
          exObj.done = true;
          exObj.progress = 1;
          exObj.label = "Area cleared";
        }
        this.completeOpenWorldContract();
      }
    }
  }

  private completeOpenWorldContract() {
    const ac = this.activeContract;
    if (!ac) return;
    const completedMission = ac.def;
    const seq = this.missionSeq;
    const { reward } = awardMissionReward(
      completedMission.id,
      this.killed,
      this.stealthKills,
      this.alerts,
      true,
      {
        shotsFired: this.shotsFired,
        shotsHit: this.shotsHit,
        headshots: this.headshots,
        durationSec: this.missionElapsedSec,
      },
    );
    this.activeContract = null;
    this.clearActiveContractEntities();
    this.objectives = [];
    this.phase = "complete";
    if (document.pointerLockElement) document.exitPointerLock();
    if (completedMission.onExtraction) this.queueDialogue(completedMission.onExtraction);
    this.activityToast = {
      title: `CONTRACT COMPLETE · ${completedMission.codename}`,
      subtitle: `+$${reward.credits.toLocaleString()} · Continue exploring Westgate Bay`,
      accent: "#34d399",
    };
    this.activityToastTimer = 4.8;
    const focusPos = (this.rig?.root.position ?? new THREE.Vector3()).clone();
    this.startExtractCinematic(completedMission, focusPos, () => {
      if (this.disposed || seq !== this.missionSeq) return;
      this.cb?.onMissionEnd(completedMission, true, reward);
    });
    this.emitHud();
  }

  private completeMission() {
    if (!this.mission || this.phase === "complete") return;
    this.phase = "complete";
    if (document.pointerLockElement) document.exitPointerLock();
    const seq = this.missionSeq;
    const completedMission = this.mission;
    const { reward } = awardMissionReward(this.mission.id, this.killed, this.stealthKills, this.alerts, true, {
      shotsFired: this.shotsFired,
      shotsHit: this.shotsHit,
      headshots: this.headshots,
      durationSec: this.missionElapsedSec,
    });
    if (this.mission.onExtraction) this.queueDialogue(this.mission.onExtraction);
    const focusPos = (this.rig?.root.position ?? new THREE.Vector3()).clone();
    this.startExtractCinematic(completedMission, focusPos, () => {
      if (this.disposed || seq !== this.missionSeq) return;
      this.cb?.onMissionEnd(completedMission, true, reward);
    });
    this.emitHud();
  }

  private resetWeapons() {
    const mm = this.stats.magMult;
    this.weaponAmmo = WEAPONS.map((w) => {
      const mods = this.getActiveWeaponMods(w.id);
      const totalMagMult = mm * mods.magMult;
      return {
        mag: Math.round(w.magSize * totalMagMult),
        reserve: Math.round(w.reserveMax * totalMagMult),
        adsFov: Math.max(10, w.adsFovDefault + mods.adsFovBonus),
      };
    });
    const startIdx = clamp(loadSave().selectedWeapon, 0, WEAPONS.length - 1);
    this.weaponIdx = startIdx;
    this.adsFovSmooth = this.weaponAmmo[startIdx].adsFov;
    if (this.rig) {
      const spec = WEAPONS[startIdx];
      const st = this.weaponAmmo[startIdx];
      const mods = this.getActiveWeaponMods(spec.id);
      this.rig.equipWeapon(spec, st.mag, st.reserve, this.fx.flash, {
        magSize: Math.round(spec.magSize * mm * mods.magMult),
        rpmMult: this.stats.rpmMult,
        recoilMult: this.stats.recoilMult * mods.recoilMult,
      });
    }
  }

  selectWeapon(idx: number) {
    if (!this.rig || this.rig.dead || this.phase !== "ready") return;
    if (this.level?.bodyCarry?.isCarrying) {
      this.activityToast = {
        title: "HANDS OCCUPIED",
        subtitle: "Drop or stash the body [G] before drawing a weapon",
        accent: "#fbbf24",
      };
      this.activityToastTimer = 2.0;
      this.emitHud();
      return;
    }
    const nextIdx = ((idx % WEAPONS.length) + WEAPONS.length) % WEAPONS.length;
    if (this.holstered) {
      this.setHolstered(false);
    }
    if (nextIdx === this.weaponIdx) return;
    // Save current weapon mag & reserve before swapping
    this.weaponAmmo[this.weaponIdx].mag = this.rig.mag;
    this.weaponAmmo[this.weaponIdx].reserve = this.rig.reserve;
    this.weaponIdx = nextIdx;
    const spec = WEAPONS[nextIdx];
    const st = this.weaponAmmo[nextIdx];
    const mods = this.getActiveWeaponMods(spec.id);
    this.rig.equipWeapon(spec, st.mag, st.reserve, this.fx.flash, {
      magSize: Math.round(spec.magSize * this.stats.magMult * mods.magMult),
      rpmMult: this.stats.rpmMult,
      recoilMult: this.stats.recoilMult * mods.recoilMult,
    });
    this.sfx.switchWeapon();
    this.emitHud();
  }

  private findTakedownTarget(): Enemy | null {
    if (!this.rig || this.rig.dead || this.phase !== "ready") return null;
    const p = this.rig.root.position;
    let best: Enemy | null = null;
    let bestD = 2.4;
    for (const e of this.enemies) {
      if (e.isDead || e.state === "attack") continue;
      const ep = e.rig.root.position;
      if (Math.abs(p.y - ep.y) > 1.35) continue;
      const d = p.distanceTo(ep);
      if (d >= bestD) continue;

      // Require unawareness or flanking/rear approach if guard is already alerted
      if (e.state === "alert") {
        const toPlayerX = (p.x - ep.x) / Math.max(0.01, d);
        const toPlayerZ = (p.z - ep.z) / Math.max(0.01, d);
        const eFwdX = Math.sin(e.rig.aimYaw);
        const eFwdZ = Math.cos(e.rig.aimYaw);
        if (eFwdX * toPlayerX + eFwdZ * toPlayerZ > 0.35) continue;
      }

      // Clear line-of-sight between player chest & guard chest (no takedowns through walls)
      if (d > 0.4 && this.level) {
        this.camPivotTmp.set(p.x, p.y + 1.15, p.z);
        this.camDesiredTmp.set(ep.x, ep.y + 1.15, ep.z).sub(this.camPivotTmp);
        const segLen = this.camDesiredTmp.length();
        const dir = this.camDirTmp.copy(this.camDesiredTmp).divideScalar(segLen);
        this.raycaster.set(this.camPivotTmp, dir);
        this.raycaster.far = segLen - 0.2;
        const losTargets = this.level.spatialColliders
          ? this.level.spatialColliders.queryRay(this.camPivotTmp, dir, segLen, this.rayScratch)
          : this.level.colliders;
        const wallHits = this.raycaster.intersectObjects(losTargets, false);
        if (wallHits.some((h) => h.object.visible && !h.object.userData.fighter)) continue;
      }

      bestD = d;
      best = e;
    }
    return best;
  }

  tryTakedown() {
    if (this.mission?.id === -1 && this.rig && !this.rig.dead && this.phase === "ready") {
      if (this.level?.contracts?.tryStealthTakedown(this.rig.root.position)) {
        this.rig.triggerTakedown();
        this.sfx.takedown();
        this.hitMarker = 0.28;
        this.hitKill = true;
        this.camKick.kick(0.9);
        this.emitHud();
        return true;
      }
    }
    const target = this.findTakedownTarget();
    if (!target) return false;
    this.rig?.triggerTakedown();
    this.sfx.takedown();
    this.hitMarker = 0.28;
    this.hitKill = true;
    this.camKick.kick(0.9);
    target.takeDamage(1000, true);
    this.emitHud();
    return true;
  }

  /* ------------------------------------------------------------ */
  private onShot(muzzle: THREE.Vector3, kick: number) {
    const rig = this.rig;
    const w = WEAPONS[this.weaponIdx];
    const mods = this.getActiveWeaponMods(w.id);
    const isSuppressed = w.suppressed && mods.suppressed;
    const baseDir = rig.aimPoint.clone().sub(muzzle).normalize();
    const moving = clamp(rig.speed / 4, 0, 1.2);
    const rawSpread = lerp(w.baseSpread, w.adsSpread, this.adsBlend) + moving * 0.012 + (rig.grounded ? 0 : 0.02) + (this.crouchToggle ? -0.0015 : 0);
    const spread = Math.max(0.0003, rawSpread * this.stats.spreadMult * mods.spreadMult);
    this.spread = spread;
    const r = () => (Math.random() - 0.5) * 2;
    const useSpatialRay = !!this.level?.spatialColliders;
    const fallbackTargets = useSpatialRay ? null : [...this.enemyHits, ...this.level!.colliders];
    let hitEnemy = false;
    let hitHead = false;
    let impactPoint: THREE.Vector3 | null = null;
    const shotDamage = w.damage * this.stats.damageMult;
    const gunPos = rig.root.position;
    if (!isSuppressed && this.level?.pedestrians) {
      this.level.pedestrians.alertPanic(muzzle, 48);
    }
    if (!isSuppressed && this.mission?.id === -1 && this.level?.wanted) {
      this.level.wanted.reportCrime("gunfire", gunPos);
    }
    this.shotsFired++;

    const shotRight = new THREE.Vector3().crossVectors(baseDir, Math.abs(baseDir.y) > 0.98 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0)).normalize();
    const shotUp = new THREE.Vector3().crossVectors(shotRight, baseDir).normalize();

    for (let p = 0; p < w.pellets; p++) {
      // Uniform circular disc spread perpendicular to muzzle aim direction
      const rad = Math.sqrt(Math.random()) * spread;
      const theta = Math.random() * Math.PI * 2;
      const dir = baseDir
        .clone()
        .addScaledVector(shotRight, Math.cos(theta) * rad)
        .addScaledVector(shotUp, Math.sin(theta) * rad)
        .normalize();
      this.raycaster.set(muzzle, dir);
      this.raycaster.far = 300;
      let targets: THREE.Object3D[];
      if (useSpatialRay) {
        const list = this.level!.spatialColliders!.queryRay(muzzle, dir, 300, this.rayScratch);
        for (let ei = 0; ei < this.enemyHits.length; ei++) list.push(this.enemyHits[ei]);
        targets = list;
      } else {
        targets = fallbackTargets!;
      }
      const hits = this.raycaster.intersectObjects(targets, false);
      const h = hits.find((hit) => hit.object.visible || !!hit.object.userData.fighter);
      let end = muzzle.clone().addScaledVector(dir, 150);
      if (h) {
        end = h.point.clone();
        const n = (h.face?.normal.clone() ?? new THREE.Vector3(0, 1, 0)).transformDirection(h.object.matrixWorld);
        const fighter = h.object.userData.fighter as Fighter | undefined;
        if (fighter instanceof Enemy && !fighter.isDead) {
          const ep = fighter.rig.root.position;
          const hdx = h.point.x - ep.x;
          const hdz = h.point.z - ep.z;
          const isHeadshot = h.point.y >= ep.y + 1.44 && hdx * hdx + hdz * hdz <= 0.24 * 0.24;
          const isLimb = !isHeadshot && h.point.y < ep.y + 0.78;
          const zoneMult = isHeadshot ? 2.0 : isLimb ? 0.72 : 1.0;
          fighter.takeDamage(shotDamage * zoneMult, isSuppressed, h.point);
          const killedNow = fighter.isDead;
          this.hitMarker = killedNow ? 0.34 : isHeadshot ? 0.28 : 0.2;
          this.hitCrit = isHeadshot;
          this.hitKill = this.hitKill || killedNow;
          if (isHeadshot) {
            hitHead = true;
            if (p === 0) this.sfx.headshotPing();
          }
          hitEnemy = true;
        } else if (h.object.userData.explosiveBarrel) {
          const eb = h.object.userData.explosiveBarrel as { hp: number; exploded: boolean; vis: THREE.Object3D; col: THREE.Object3D };
          if (!eb.exploded) {
            eb.hp -= shotDamage;
            this.fx.impact(h.point, n, "metal");
            if (p === 0) this.sfx.ping();
            this.hitMarker = 0.2;
            if (eb.hp <= 0) {
              eb.exploded = true;
              eb.vis.visible = false;
              eb.col.visible = false;
              this.level?.spatialColliders?.remove(eb.col);
              const blastPos = new THREE.Vector3();
              eb.col.getWorldPosition(blastPos);
              this.detonateAt(blastPos, 9.5);
            }
          }
          impactPoint = h.point.clone();
        } else if (h.object.userData.destroyable) {
          this.damageDestroyable(h.object, h.point, n, shotDamage);
          impactPoint = h.point.clone();
        } else {
          const kind = (h.object.userData.kind as SurfaceKind) ?? "dirt";
          this.fx.impact(h.point, n, kind);
          if (kind === "metal" && p === 0) this.sfx.ping();
          if (h.object.userData.target) {
            this.world.hitTarget(h.object, 7);
            this.hitMarker = 0.18;
            this.hitCrit = false;
          }
          impactPoint = h.point.clone();
        }
      }
      // Exact ray-cylinder check for open-world red explosive barrels
      if (this.mission?.id === -1 && this.level?.collectibles) {
        const barrelHit = this.level.collectibles.hitExplosiveAlongRay(muzzle, dir, muzzle.distanceTo(end), shotDamage);
        if (barrelHit) {
          if (barrelHit.exploded) {
            this.detonateAt(barrelHit.point, 9.5);
          } else {
            this.fx.impact(barrelHit.point, dir.clone().negate(), "metal");
            if (p === 0) this.sfx.ping();
            this.hitMarker = 0.18;
          }
          end.copy(barrelHit.point);
        }
      }
      // Open-world entity bullet checks (Police Officers, Pedestrians, Vehicles, Random Events)
      if (this.mission?.id === -1) {
        const segLen = muzzle.distanceTo(end);
        const steps = Math.min(28, Math.max(4, Math.ceil(segLen / 1.8)));
        for (let si = 1; si <= steps; si++) {
          const d = (segLen * si) / steps;
          const px = muzzle.x + dir.x * d;
          const py = muzzle.y + dir.y * d;
          const pz = muzzle.z + dir.z * d;
          const groundRef = this.level?.groundHeightAt(px, pz, py) ?? 0;
          const isHead = py >= groundRef + 1.42;
          const effDmg = isHead ? shotDamage * 1.85 : shotDamage;
          if (this.level?.wanted?.hitAtPoint(px, py, pz, effDmg)) {
            this.hitMarker = isHead ? 0.28 : 0.2;
            this.hitCrit = isHead;
            if (isHead && p === 0) this.sfx.headshotPing();
            hitEnemy = true;
            end.set(px, py, pz);
            break;
          }
          if (this.level?.contracts?.hitAtPoint(px, py, pz, effDmg, isSuppressed, rig.root.position)) {
            this.hitMarker = isHead ? 0.28 : 0.22;
            this.hitCrit = isHead;
            if (isHead && p === 0) this.sfx.headshotPing();
            hitEnemy = true;
            this.fx.bloodBurst(new THREE.Vector3(px, py, pz), undefined, 1.0);
            end.set(px, py, pz);
            break;
          }
          if (this.level?.pedestrians?.hitAtPoint(px, py, pz, 0.72, effDmg)) {
            this.hitMarker = isHead ? 0.25 : 0.18;
            this.hitCrit = isHead;
            if (isHead && p === 0) this.sfx.headshotPing();
            this.level.wanted?.reportCrime("assault", { x: px, z: pz });
            end.set(px, py, pz);
            break;
          }
          const evOut = this.level?.randomEvents?.hitAtPoint(px, py, pz, shotDamage);
          if (evOut) {
            awardDrivingCredits(evOut.reward);
            this.activityToast = {
              title: evOut.title,
              subtitle: `${evOut.detail} · +${evOut.reward} Cr`,
              accent: "#38bdf8",
            };
            this.activityToastTimer = 4.0;
            this.hitMarker = 0.22;
            end.set(px, py, pz);
            break;
          }
          const hyd = this.level?.openWorld?.props.hitHydrantAtPoint(px, py, pz, performance.now() * 0.001);
          if (hyd) {
            this.sfx.splash();
            this.fx.hydrantSpray(new THREE.Vector3(hyd.x, hyd.y, hyd.z));
            end.set(px, py, pz);
            break;
          }
        }
        const vehBulletDmg = Math.max(1.2, shotDamage * (w.pellets > 1 ? 0.095 : 0.11));
        const vehHit = this.level?.vehicles?.hitVehicleAlongRay(
          muzzle,
          dir,
          muzzle.distanceTo(end),
          vehBulletDmg,
          null,
        );
        if (vehHit) {
          if (vehHit.hitGlass) {
            this.fx.glassBurst(vehHit.point);
            if (p === 0) this.sfx.glassShatter();
          } else {
            this.fx.impact(vehHit.point, vehHit.normal, "metal");
            if (p === 0) this.sfx.ping();
          }
          end.copy(vehHit.point);
        }
      }
      this.fx.tracer(muzzle, end);

      // Bullet whiz / near-miss crack alerts enemies whose head the shot flies past
      if (p === 0 && !hitEnemy) {
        const segLen = muzzle.distanceTo(end);
        for (const e of this.enemies) {
          if (e.isDead) continue;
          const ep = e.rig.root.position;
          const vx = ep.x - muzzle.x;
          const vy = (ep.y + 1.4) - muzzle.y;
          const vz = ep.z - muzzle.z;
          const proj = vx * dir.x + vy * dir.y + vz * dir.z;
          if (proj > 1.5 && proj < segLen + 0.5) {
            const cx = muzzle.x + dir.x * proj - ep.x;
            const cy = muzzle.y + dir.y * proj - (ep.y + 1.4);
            const cz = muzzle.z + dir.z * proj - ep.z;
            if (cx * cx + cy * cy + cz * cz <= 3.6 * 3.6) {
              e.hearSound(gunPos, 120, 0.88, "impact");
            }
          }
        }
      }
    }
    if (hitEnemy) {
      this.shotsHit++;
      if (hitHead) this.headshots++;
      this.sfx.hit();
    }
    this.fx.muzzleFlash(this.camera, isSuppressed ? 0.24 : 1.0);
    this.sfx.shot(w.soundPitch, isSuppressed);
    // Weapon gunshot sound with wall occlusion & suppressed/unsuppressed attenuation
    const noiseR = (isSuppressed ? w.noiseRadius : w.noiseRadius * 3.4) * this.stats.shotNoiseMult;
    this.emitNoise(gunPos, noiseR, isSuppressed ? 0.62 : 1.22, "gunshot");
    if (impactPoint) {
      this.emitNoise(impactPoint, 6.5, 0.78, "impact");
    }
    // camera recoil
    const k = kick;
    this.camKick.kick(1.3 * k);
    const dp = (0.0032 + Math.random() * 0.0022) * k;
    this.camPitch += dp;
    this.camYaw += (Math.random() - 0.5) * 0.0035 * k;
    if (!this.showcase) {
      this.pitch = this.camPitch;
      this.yaw = this.camYaw;
    }
    this.shakeX.kick(r() * 0.9 * k);
    this.shakeY.kick(r() * 0.9 * k);
    this.camTrauma = Math.min(1, this.camTrauma + 0.11 * k);
  }

  private damageDestroyable(mesh: THREE.Object3D, point: THREE.Vector3, n: THREE.Vector3, dmg = 34) {
    if (this.mission?.id === -1 && !this.destroyableHp.has(mesh)) {
      this.fx.impact(point, n, "metal");
      return;
    }
    let hp = this.destroyableHp.get(mesh) ?? 100;
    if (!mesh.visible || hp <= 0) return;
    hp -= dmg;
    if (hp <= 0) {
      this.destroyableHp.set(mesh, 0);
      (mesh as THREE.Mesh).visible = false;
      this.level?.spatialColliders?.remove(mesh);
      this.destroyed++;
      this.sfx.thud(point);
      this.emitNoise(point, 18, 0.84, "shatter");
      this.fx.explosion(point, 0.72);
      this.joltPhysics?.spawnDebrisBurst(point, 14, 0x6b5c49, 1.0, 1.25);
      this.joltPhysics?.applyExplosionBlast(point, 8, 12);
      this.fx.tracer(point.clone().addScaledVector(n, -1.5), point.clone().add(new THREE.Vector3(0, 2, 0)));
      this.updateObjectives();
      const mDef = this.activeContract?.def ?? this.mission;
      if (!this.objectiveDialoguePlayed && mDef?.onObjective) {
        const allNonExtract = this.objectives.filter((o) => o.id !== "extract" && o.id !== "travel").every((o) => o.done);
        if (allNonExtract) {
          this.objectiveDialoguePlayed = true;
          this.queueDialogue(mDef.onObjective);
        }
      }
      this.emitHud();
    } else {
      this.destroyableHp.set(mesh, hp);
      this.fx.impact(point, n, "metal");
      this.hitMarker = 0.15;
    }
  }

  private renderFrame(_rawDt: number) {
    if (this.contextLost) return;
    if (this.composer && this.perfTier < 2) {
      this.composer.render();
    } else {
      if (this.renderer.toneMapping !== THREE.ACESFilmicToneMapping) {
        this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
      }
      this.renderer.render(this.scene, this.camera);
    }
  }

  private updateGuardFlashlights() {
    if (this.guardFlashlights.length === 0 || !this.rig) return;
    const p = this.rig.root.position;
    const active = this.enemies
      .filter((e) => !e.isDead)
      .map((e) => ({ e, d2: e.rig.root.position.distanceToSquared(p) }))
      .sort((a, b) => a.d2 - b.d2);
    for (let i = 0; i < this.guardFlashlights.length; i++) {
      const sl = this.guardFlashlights[i];
      const pick = active[i];
      if (pick && pick.d2 < 2400 && pick.e.getFlashlightWorld(this.tmpFlashOrigin, this.tmpFlashTarget)) {
        sl.visible = true;
        sl.position.copy(this.tmpFlashOrigin);
        sl.target.position.copy(this.tmpFlashTarget);
        sl.target.updateMatrixWorld();
      } else {
        sl.visible = false;
      }
    }
  }

  /* ------------------------------------------------------------ */
  private frame(rawDt: number) {
    if (this.phase === "loading") return;
    const rig = this.rig;
    const dt = rawDt * this.timeScale;

    // ---- HUD
    this.fpsAcc += rawDt;
    this.fpsN++;
    this.hudT += rawDt;
    if (this.hudT > 0.1) {
      this.fps = this.fpsN / this.fpsAcc;
      this.fpsAcc = 0;
      this.fpsN = 0;
      this.hudT = 0;
      this.emitHud();
    }

    // ---- dialogue timing + nearby pedestrian voice captions
    if (this.hornCd > 0) this.hornCd = Math.max(0, this.hornCd - rawDt);
    if (this.dialogue) {
      this.dialogueT -= rawDt;
      if (this.dialogueT <= 0) this.nextDialogue();
    } else {
      const spoken = this.level?.pedestrians?.voices.lastSpoken;
      if (spoken && spoken.at > this.lastShownPedVoiceAt) {
        this.lastShownPedVoiceAt = spoken.at;
        this.dialogue = { speaker: spoken.speaker, text: spoken.text, dur: 3.2 };
        this.dialogueT = 3.2;
        this.emitHud();
      }
    }

    // ---- practice auto-respawn
    if (this.practiceRespawnT > 0) {
      this.practiceRespawnT -= rawDt;
      if (this.practiceRespawnT <= 0) this.respawn();
    }

    // ---- menu hangar: showcase soldier standing on tactical dais
    if (this.menuHangar && rig) {
      if (!this.mouseL && !this.mouseR) this.menuYaw += rawDt * (this.menuWeaponFocus ? 0.06 : 0.12);
      this.menuFocusLerp = damp(this.menuFocusLerp, this.menuWeaponFocus ? 1 : 0, 8, rawDt);
      rig.input.ads = true;
      rig.aimYaw = this.menuYaw;
      rig.aimPitch = 0.02;
      rig.aimPoint.set(Math.sin(this.menuYaw) * 10, 1.32, Math.cos(this.menuYaw) * 10);
      rig.update(dt, 0.1);
      // Offset lookAt left so the soldier stands crisply in the right half of the viewport
      this.camera.fov = lerp(38, 30, this.menuFocusLerp);
      this.camera.updateProjectionMatrix();
      this.camera.position.set(
        lerp(-0.72, -0.45, this.menuFocusLerp),
        lerp(1.34, 1.38, this.menuFocusLerp),
        lerp(3.15, 1.72, this.menuFocusLerp),
      );
      this.camera.lookAt(
        lerp(-0.54, -0.24, this.menuFocusLerp),
        lerp(1.04, 1.24, this.menuFocusLerp),
        lerp(0, 0.18, this.menuFocusLerp),
      );
      this.fx.update(dt);
      this.renderFrame(rawDt);
      return;
    }

    // ---- showcase: orbit camera only
    if (this.showcase) {
      this.updateCamera(rawDt, dt);
      this.world.update(dt, rig.root.position);
      this.fx.update(dt);
      this.renderFrame(rawDt);
      return;
    }

    // ---- paused / dead / complete: render once per state change so pause menu stays snappy
    if (this.paused) {
      if (!this.pausedRendered) {
        this.pausedRendered = true;
        this.renderFrame(rawDt);
      }
      return;
    }
    this.pausedRendered = false;

    if (!rig) {
      this.renderFrame(rawDt);
      return;
    }
    const dead = rig.dead;

    // Continuous 360-degree edge-turn fallback when pointer lock is unavailable
    if (!this.locked && this.isActiveGameplay() && Math.abs(this.mouseEdgeTurn) > 0.01) {
      if (this.level?.vehicles?.activeVehicle) {
        const vehSens = this.freeCamera.sensitivity;
        if (this.vehCam.preset === "hood" || this.vehCam.preset === "bumper") {
          this.freeYaw = clamp(this.freeYaw + this.mouseEdgeTurn * 1.8 * vehSens * rawDt, -1.25, 1.25);
        } else {
          this.camYaw += this.mouseEdgeTurn * 2.4 * this.aimSensitivity * vehSens * rawDt;
          if (!this.showcase) this.yaw = this.camYaw;
        }
        this.freeIdle = 0;
      } else {
        this.camYaw += this.mouseEdgeTurn * 2.4 * this.aimSensitivity * rawDt;
        if (!this.showcase) this.yaw = this.camYaw;
      }
    }
    const vehicles = this.level?.vehicles;
    const gripScale = this.level?.getWeatherGrip?.() ?? 1.0;
    const weatherDarkness = this.level?.weather
      ? Math.max(this.level.weather.rain * 0.55, this.level.weather.snow * 0.45)
      : 0;
    const todDarkness = this.level?.getTimeOfDayDarkness?.() ?? 0;
    const darkness = Math.min(1, Math.max(weatherDarkness, todDarkness));
    if (this.activityToastTimer > 0) {
      this.activityToastTimer = Math.max(0, this.activityToastTimer - rawDt);
      if (this.activityToastTimer === 0) this.activityToast = null;
    }
    this.updateMissionCall(rawDt);
    this.updateCinematic(rawDt);
    if (this.crashAudioCd > 0) this.crashAudioCd = Math.max(0, this.crashAudioCd - rawDt);
    if (this.driveByCd > 0) this.driveByCd = Math.max(0, this.driveByCd - rawDt);
    if (this.phase === "ready") {
      this.missionElapsedSec += rawDt;
      const k = this.keys;
      const activeVeh = vehicles?.activeVehicle ?? null;
      const activeAir = this.level?.aircraft?.activeAircraft ?? null;
      const activeBoat = this.level?.boats?.activeBoat ?? null;

      if (activeAir && !dead) {
        /* ---- flying helicopter or fixed-wing airplane ---- */
        this.level!.aircraft!.update(dt, {
          throttle: (k.has("KeyW") ? 1 : 0) - (k.has("KeyS") ? 1 : 0),
          roll: (k.has("KeyD") ? 1 : 0) - (k.has("KeyA") ? 1 : 0),
          yaw: (k.has("KeyQ") ? 1 : 0) - (k.has("KeyE") ? 1 : 0),
          climb: (k.has("Space") ? 1 : 0) - (k.has("ShiftLeft") ? 1 : 0),
        });
        this.vehAudio.updateAircraft(true, activeAir.kind, activeAir.rotorPower, activeAir.speed);
        this.vehAudio.updateTireSlip(0, false, false);
        vehicles?.update(dt, { throttle: 0, steer: 0, handbrake: false }, activeAir.pos, gripScale, this.camera, darkness);
        this.level?.boats?.update(dt, { throttle: 0, steer: 0 });
        this.vehAudio.updateBoat(false, 0, 0);
        rig.setVisible(false);
        rig.root.position.copy(activeAir.pos);
        rig.groundY = activeAir.pos.y;
        this.nearbyVehicleName = null;
        this.nearbyHomeStation = null;
        if (this.mission?.id === -1) {
          this.updateOpenWorldInteractions(dt, activeAir.pos, activeAir.speed, true);
        }
        this.updateCamera(rawDt, dt);
        this.level?.updateWeatherFx?.(dt, this.camera.position, this.camera, activeAir.speed);
      } else if (activeBoat && !dead) {
        /* ---- piloting speedboat ---- */
        const throttle = (k.has("KeyW") ? 1 : 0) - (k.has("KeyS") ? 1 : 0);
        const steer = (k.has("KeyA") ? 1 : 0) - (k.has("KeyD") ? 1 : 0);
        this.level!.boats!.update(dt, { throttle, steer });
        this.vehAudio.updateBoat(true, activeBoat.speed, throttle);
        this.vehAudio.updateAircraft(false, "helicopter", 0, 0);
        this.vehAudio.updateTireSlip(0, false, false);
        if (Math.abs(activeBoat.speed) > 2.2) {
          this.fx.boatWake(activeBoat.pos, activeBoat.yaw, activeBoat.speed);
        }
        vehicles?.update(dt, { throttle: 0, steer: 0, handbrake: false }, activeBoat.pos, gripScale, this.camera, darkness);
        this.level?.aircraft?.update(dt, { throttle: 0, roll: 0, yaw: 0, climb: 0 });
        rig.setVisible(false);
        rig.root.position.copy(activeBoat.pos);
        rig.groundY = activeBoat.pos.y;
        this.nearbyVehicleName = null;
        this.nearbyHomeStation = null;
        if (this.mission?.id === -1) {
          this.updateOpenWorldInteractions(dt, activeBoat.pos, activeBoat.speed, true);
        }
        if ((this.mouseL || this.uiHeld.fire) && !this.mapOpen && !this.phoneOpen && !this.weaponWheelOpen) {
          this.fireDriveByShot(activeBoat.pos);
        }
        this.updateCamera(rawDt, dt);
        this.level?.updateWeatherFx?.(dt, this.camera.position, this.camera, activeBoat.speed);
      } else if (activeVeh && !dead) {
        /* ---- driving vehicle ---- */
        const throttle = (k.has("KeyW") ? 1 : 0) - (k.has("KeyS") ? 1 : 0);
        const steer = (k.has("KeyA") ? 1 : 0) - (k.has("KeyD") ? 1 : 0);
        const handbrake = k.has("Space");
        vehicles!.update(dt, { throttle, steer, handbrake }, activeVeh.pos, gripScale, this.camera, darkness);
        const w = this.level?.weather;
        this.vehAudio.updateTireSlip(vehicles!.activeDriftSlip, (w?.snowCover ?? 0) > 0.25, (w?.wet ?? 0) > 0.25);
        this.level?.aircraft?.update(dt, { throttle: 0, roll: 0, yaw: 0, climb: 0 });
        this.vehAudio.updateAircraft(false, "helicopter", 0, 0);
        this.level?.boats?.update(dt, { throttle: 0, steer: 0 });
        this.vehAudio.updateBoat(false, 0, 0);
        const ramExp = this.level?.collectibles?.checkVehicleRamExplosives(activeVeh.pos, activeVeh.speed);
        if (ramExp) this.detonateAt(ramExp, 9.5);
        if ((this.mouseL || this.uiHeld.fire) && !this.mapOpen && !this.phoneOpen && !this.weaponWheelOpen) {
          this.fireDriveByShot(activeVeh.pos);
        }
        if (vehicles!.lastImpact > 0.15) {
          if (this.crashAudioCd <= 0) {
            this.vehAudio.crash(vehicles!.lastImpact);
            this.crashAudioCd = 0.24;
          }
          const shake = vehicles!.lastImpact * 0.55;
          this.shakeX.kick((Math.random() - 0.5) * shake);
          this.shakeY.kick((Math.random() - 0.5) * shake);
          this.fx.impact(vehicles!.lastCrashPos, vehicles!.lastCrashNormal, vehicles!.lastCrashKind);
        }
        if (vehicles!.lastLanding > 0.1) {
          this.sfx.thud();
          if (vehicles!.lastLandingBottomOut) {
            this.vehAudio.crash(vehicles!.lastLanding * 0.52);
            this.fx.impact(
              vehicles!.lastLandingPos.clone().add(new THREE.Vector3(0, 0.12, 0)),
              new THREE.Vector3(0, 1, 0),
              "metal",
            );
          }
          this.shakeY.kick(-vehicles!.lastLanding * 0.45);
        }
        const pst = activeVeh.physState;
        const rTire = pst.spec.tireRadius;
        const drivenSpeed =
          pst.spec.drivetrain === "FWD"
            ? 0.5 * (pst.wheelOmega[0] + pst.wheelOmega[1]) * rTire
            : pst.spec.drivetrain === "RWD"
              ? 0.5 * (pst.wheelOmega[2] + pst.wheelOmega[3]) * rTire
              : 0.25 * (pst.wheelOmega[0] + pst.wheelOmega[1] + pst.wheelOmega[2] + pst.wheelOmega[3]) * rTire;
        const engThrottle = throttle > 0 ? throttle : activeVeh.speed < -0.5 && throttle < 0 ? 0.55 : 0;
        const engBrake = handbrake ? 1 : throttle < 0 && activeVeh.speed > 0.5 ? -throttle : 0;
        this.engineHud = this.vehAudio.engine(
          Math.abs(drivenSpeed) > Math.abs(activeVeh.speed) ? drivenSpeed : activeVeh.speed,
          engThrottle,
          engBrake,
        );
        const signalLit = vehicles!.isSignalLit();
        this.vehAudio.setSignal(vehicles!.signal, signalLit);
        const signalKey = `${vehicles!.signal ?? "none"}:${signalLit ? 1 : 0}`;
        if (signalKey !== this.lastSignalKey) {
          this.lastSignalKey = signalKey;
          this.emitHud();
        }
        rig.setVisible(false);
        rig.root.position.copy(activeVeh.pos);
        rig.groundY = activeVeh.pos.y;
        this.nearbyVehicleName = null;
        this.nearbyHomeStation = null;

        // Earn driving credits every 500 m explored in Westgate Bay
        if (this.mission?.id === -1 && Math.abs(activeVeh.speed) > 2) {
          this.driveDistAcc += Math.abs(activeVeh.speed) * dt;
          if (this.driveDistAcc >= 500) {
            this.driveDistAcc -= 500;
            awardDrivingCredits(35);
          }
        }

        // Westgate Bay Speed Traps, Stunt Jumps, Street Races, Mod Garages, Wanted & Random Events
        if (this.mission?.id === -1 && this.level?.activities) {
          const hit = this.level.activities.update(dt, activeVeh.pos, activeVeh.speed, true);
          if (hit) {
            awardDrivingCredits(hit.reward);
            this.vehAudio.radarChime(hit.beatTarget);
            this.activityToast = {
              title: `${hit.trap.name} · ${hit.kmh} km/h`,
              subtitle: hit.beatTarget
                ? `TARGET ${hit.trap.targetKmh} KM/H CLEARED${hit.isRecord ? " · NEW RECORD" : ""} · +${hit.reward} Cr`
                : `Target ${hit.trap.targetKmh} km/h · +${hit.reward} Cr`,
              accent: hit.beatTarget ? "#fbbf24" : "#22d3ee",
            };
            this.activityToastTimer = 4.0;
          }
          const stunt = this.level.activities.updateStunts(dt, activeVeh.pos, !!activeVeh.airborne, true);
          if (stunt) {
            awardDrivingCredits(stunt.reward);
            this.vehAudio.radarChime(true);
            this.activityToast = {
              title: `STUNT JUMP · ${stunt.def.name}`,
              subtitle: `${stunt.distMeters}m Air Distance · ${stunt.peakHeight}m Peak · +${stunt.reward} Cr`,
              accent: "#38bdf8",
            };
            this.activityToastTimer = 4.2;
          }
          const raceFin = this.level.activities.updateRace(dt, activeVeh.pos);
          if (raceFin) {
            awardDrivingCredits(raceFin.reward);
            this.vehAudio.radarChime(raceFin.place === 1);
            this.activityToast = {
              title: `RACE FINISHED · P${raceFin.place}`,
              subtitle: `${raceFin.raceName} (${raceFin.elapsed}s) · +${raceFin.reward} Cr`,
              accent: raceFin.place === 1 ? "#fbbf24" : "#34d399",
            };
            this.activityToastTimer = 5.0;
          }
          this.checkDistrictDiscovery(activeVeh.pos);
          const nearC = !this.activeContract ? this.level.activities.findNearbyContract(activeVeh.pos, 11.5) : null;
          this.nearbyContractSpot = nearC
            ? { missionId: nearC.missionId, x: nearC.x, z: nearC.z, yawDeg: nearC.yawDeg }
            : null;
          this.updateOpenWorldInteractions(dt, activeVeh.pos, activeVeh.speed, true);
        }

        this.freeIdle += rawDt;
        if (this.freeCamera.autoCenter && this.vehCam.preset !== "free" && this.freeIdle > 2.5 && Math.abs(activeVeh.speed) > 2.5) {
          const ease = 1 - Math.exp(-2.2 * rawDt);
          const yawDiff = Math.atan2(Math.sin(activeVeh.yaw - this.camYaw), Math.cos(activeVeh.yaw - this.camYaw));
          this.camYaw += yawDiff * ease;
          this.camPitch = lerp(this.camPitch, 0.16, ease);
          if (!this.showcase) this.yaw = this.camYaw;
        }

        this.updateCamera(rawDt, dt);
        this.level?.updateWeatherFx?.(
          dt,
          this.camera.position,
          this.camera,
          activeVeh.speed,
          activeVeh.pos,
          activeVeh.yaw,
          activeVeh.width,
          activeVeh.length,
          vehicles?.activeWheelSlip ?? 0,
          vehicles?.activeSurfaceKind ?? "asphalt",
        );
        this.vehNoiseCd -= dt;
        const speedKmh = Math.abs(activeVeh.speed) * 3.6;
        if (speedKmh > 25 && this.vehNoiseCd <= 0) {
          this.vehNoiseCd = 0.45;
          this.emitNoise(activeVeh.pos, 18 + speedKmh * 0.25, 0.66, "vehicle");
        }
      } else {
        /* ---- on-foot input -> rig ---- */
        rig.setVisible(true);
        const inIntroCine = this.cinematicState?.kind === "intro";
        const f = inIntroCine ? 0 : (k.has("KeyW") ? 1 : 0) - (k.has("KeyS") ? 1 : 0);
        const s = inIntroCine ? 0 : (k.has("KeyD") ? 1 : 0) - (k.has("KeyA") ? 1 : 0);
        const ay = this.camYaw;
        const fwd = new THREE.Vector3(Math.sin(ay), 0, Math.cos(ay));
        const rgt = new THREE.Vector3(-Math.cos(ay), 0, Math.sin(ay));
        const mv = fwd.multiplyScalar(f).addScaledVector(rgt, s);
        if (mv.lengthSq() > 1) mv.normalize();
        rig.input.move.copy(mv);
        rig.input.sprint = !inIntroCine && (k.has("ShiftLeft") || k.has("ShiftRight") || this.uiHeld.sprint);
        rig.input.crouch = this.crouchToggle;
        rig.input.ads = !inIntroCine && !this.holstered && !this.weaponWheelOpen && !this.mapOpen && !this.phoneOpen && (this.mouseR || this.uiHeld.ads);
        rig.input.lean = inIntroCine ? 0 : (k.has("KeyQ") ? 1 : 0) - (k.has("KeyE") ? 1 : 0);
        rig.aimYaw = this.yaw;
        rig.aimPitch = this.pitch;

        /* ---- character ---- */
        const garageCols = this.level?.apartments?.getGarageCarColliders(this.activeGarageId) ?? [];
        const allVehCols: VehicleBoxCollider[] = vehicles
          ? [...vehicles.vehicles, ...garageCols]
          : [...garageCols];

        let gy = this.level!.groundHeightAt(rig.root.position.x, rig.root.position.z, rig.root.position.y);
        const roofY = vehicleRoofHeightAt(rig.root.position, allVehCols);
        if (roofY > gy) gy = roofY;

        // Ocean swimming buoyancy when wading past -0.35m water depth
        const wasSwimming = this.swimming;
        if (this.mission?.id === -1 && gy < -0.35) {
          this.swimming = true;
          gy = -0.35;
          if (!wasSwimming) {
            this.fx.waterSplash(new THREE.Vector3(rig.root.position.x, 0.0, rig.root.position.z), 0.72);
            this.sfx.step(0, "water");
          }
          if (this.binocularsOpen) this.binocularsOpen = false;
        } else {
          this.swimming = false;
        }

        const preMoveX = rig.root.position.x;
        const preMoveZ = rig.root.position.z;
        rig.update(dt, gy);
        tryVaultObstacle(rig, this.level!.spatial ?? this.level!.aabbs, dt);

        const onHitByCar = (v: VehicleBoxCollider, nx: number, nz: number, impactSpd: number) => {
          const knock = Math.min(11, impactSpd * 0.72);
          rig.vel.x = nx * knock;
          rig.vel.z = nz * knock;
          rig.vy = Math.max(rig.vy, 2.5);
          rig.grounded = false;
          if ("speed" in v && typeof v.speed === "number") v.speed *= 0.25;
          if ("vx" in v && typeof v.vx === "number") v.vx *= 0.25;
          if ("vz" in v && typeof v.vz === "number") v.vz *= 0.25;
          if (this.crashAudioCd <= 0) {
            this.vehAudio.crash(clamp(impactSpd / 14, 0.2, 0.9));
            this.crashAudioCd = 0.35;
          }
          if (impactSpd > 6.5) {
            this.damage(Math.round(clamp(impactSpd * 1.4, 5, 22)), 0);
          }
        };

        let collided = false;
        for (let pass = 0; pass < 2; pass++) {
          if (allVehCols.length > 0) resolveCircleVehicles(rig.root.position, 0.44, allVehCols, rig.vel, onHitByCar);
          this.level?.pedestrians?.resolvePlayerFootCollision(rig.root.position, 0.42);
          const preX = rig.root.position.x;
          const preZ = rig.root.position.z;
          resolveCircleAABBs(rig.root.position, 0.42, this.level!.spatial ?? this.level!.aabbs, rig.stepHeight);
          const dxA = rig.root.position.x - preX;
          const dzA = rig.root.position.z - preZ;
          const dLen = Math.hypot(dxA, dzA);
          if (dLen > 1e-4) {
            collided = true;
            const nxA = dxA / dLen;
            const nzA = dzA / dLen;
            const vnA = rig.vel.x * nxA + rig.vel.z * nzA;
            if (vnA < 0) {
              rig.vel.x -= nxA * vnA;
              rig.vel.z -= nzA * vnA;
            }
          }
        }
        if (rig.grounded && (collided || Math.hypot(rig.root.position.x - preMoveX, rig.root.position.z - preMoveZ) > 0.001)) {
          let gyAfter = this.level!.groundHeightAt(rig.root.position.x, rig.root.position.z, rig.root.position.y);
          const roofAfter = vehicleRoofHeightAt(rig.root.position, allVehCols);
          if (roofAfter > gyAfter) gyAfter = roofAfter;
          if (this.swimming && gyAfter < -0.35) gyAfter = -0.35;
          if (Math.abs(gyAfter - gy) > 0.002 && Math.abs(gyAfter - rig.root.position.y) <= rig.stepHeight + 0.05) {
            rig.root.position.y = Math.abs(gyAfter - rig.root.position.y) <= 0.14
              ? gyAfter
              : damp(rig.root.position.y, gyAfter, 30, dt);
            rig.groundY = rig.root.position.y;
          }
        }

        if (this.parachuting) {
          if (rig.grounded || rig.root.position.y <= gy + 0.35) {
            this.setParachuteActive(false);
          } else {
            rig.vy = Math.max(rig.vy, -4.4);
            rig.vel.x = mv.x * 11.5;
            rig.vel.z = mv.z * 11.5;
          }
        }

        /* ---- ambient NPC traffic & nearby driveable check ---- */
        if (vehicles) {
          vehicles.update(dt, { throttle: 0, steer: 0, handbrake: false }, rig.root.position, gripScale, this.camera, darkness);
          resolveCircleVehicles(rig.root.position, 0.44, allVehCols, rig.vel, onHitByCar);
          const nearV = vehicles.findNearestEnterable(rig.root.position);
          const nearA = !nearV ? this.level?.aircraft?.findNearestEnterable(rig.root.position) : null;
          const nearB = !nearV && !nearA ? this.level?.boats?.findNearestEnterable(rig.root.position) : null;
          this.nearbyVehicleName = nearV?.spec.name ?? nearA?.name ?? nearB?.name ?? null;
        } else {
          this.nearbyVehicleName = null;
        }
        this.level?.aircraft?.update(dt, { throttle: 0, roll: 0, yaw: 0, climb: 0 });
        this.vehAudio.updateAircraft(false, "helicopter", 0, 0);
        this.level?.boats?.update(dt, { throttle: 0, steer: 0 });
        this.vehAudio.updateBoat(false, 0, 0);
        this.vehAudio.updateTireSlip(0, false, false);

        /* ---- camera + aim (locked to post-collision player position, zero frame lag) ---- */
        this.updateCamera(rawDt, dt);
        this.updateAimPoint();
        if (this.mission?.id === -1 && this.level?.activities) {
          this.level.activities.update(dt, rig.root.position, rig.speed, false);
          this.level.activities.updateStunts(dt, rig.root.position, false, false);
          this.level.activities.updateRace(dt, rig.root.position);
          this.checkDistrictDiscovery(rig.root.position);
          const nearC = !this.activeContract ? this.level.activities.findNearbyContract(rig.root.position, 11.5) : null;
          this.nearbyContractSpot = nearC
            ? { missionId: nearC.missionId, x: nearC.x, z: nearC.z, yawDeg: nearC.yawDeg }
            : null;
          this.updateHomeStations();
          this.updateOpenWorldInteractions(dt, rig.root.position, rig.speed, false);
        } else {
          this.nearbyContractSpot = null;
          this.nearbyHomeStation = null;
          this.nearbyPrompt = null;
        }
        this.level?.updateWeatherFx?.(dt, this.camera.position, this.camera, rig.speed);

        /* ---- firing ---- */
        const wantFire = !this.cinematicState && !this.holstered && !this.binocularsOpen && !this.weaponWheelOpen && !this.mapOpen && !this.phoneOpen && (this.mouseL || this.uiHeld.fire);
        if (wantFire && !dead) {
          if (rig.mag <= 0 && rig.reserve > 0 && !rig.isReloading) {
            rig.fire(); // dry click
            if (rig.mag <= 0) {
              const seq = this.missionSeq;
              setTimeout(() => {
                if (!this.disposed && seq === this.missionSeq && this.phase === "ready") this.rig?.reload();
              }, 250);
            }
          } else rig.fire();
        }
      }
    } else {
      /* dead / complete: keep the character animating */
      rig.setVisible(true);
      const gy = this.level
        ? this.level.groundHeightAt(rig.root.position.x, rig.root.position.z, rig.root.position.y)
        : rig.groundY;
      rig.update(dt, gy);
      this.updateCamera(rawDt, dt);
    }

    /* ---- AI & Objectives ---- */
    if (this.phase === "ready") {
      if (this.activeContract) {
        const cPos =
          this.level?.aircraft?.activeAircraft?.pos ??
          this.level?.boats?.activeBoat?.pos ??
          this.level?.vehicles?.activeVehicle?.pos ??
          rig.root.position;
        this.updateOpenWorldContract(dt, cPos);
      }
      for (const e of this.enemies) e.update(dt);
      this.ally?.update(dt);
      this.npc?.update(dt);
      this.updateGuardFlashlights();
      this.updateInteractables(dt);
      this.checkProximityObjectives(dt);
      this.updateObjectives();
      // Out-of-combat triage regeneration up to 45% max HP after 6.5s clean break
      const inActiveFight = this.enemies.some(
        (e) => !e.isDead && e.state === "attack" && e.rig.root.position.distanceToSquared(rig.root.position) < 24 * 24,
      );
      if (inActiveFight) {
        this.outOfCombatT = 0;
      } else {
        this.outOfCombatT += dt;
        const triageCap = this.maxHealth * 0.45;
        if (this.outOfCombatT >= 6.5 && !rig.dead && this.health > 0 && this.health < triageCap) {
          this.health = Math.min(triageCap, this.health + 5 * dt);
        }
      }
    }

    /* ---- spread marker ---- */
    this.spread = damp(this.spread, (this.adsBlend > 0.5 ? 0.002 : 0.01) + clamp(rig.speed / 4, 0, 1.2) * 0.012 + (rig.grounded ? 0 : 0.02), 8, rawDt);
    this.hitMarker = Math.max(0, this.hitMarker - rawDt);
    if (this.hitMarker <= 0) {
      this.hitCrit = false;
      this.hitKill = false;
    }
    this.damageFlash = Math.max(0, this.damageFlash - rawDt * 2.2);
    if (this.phase === "ready" && !this.paused) {
      const frameMs = clamp(rawDt * 1000, 4, 80);
      this.frameMsEma = lerp(this.frameMsEma, frameMs, 0.08);
      this.perfEvalT += rawDt;
      if (this.perfEvalT >= 1.2) {
        this.perfEvalT = 0;
        if (this.frameMsEma > 21.5 && this.perfTier < 2) {
          this.perfTier = (this.perfTier + 1) as 0 | 1 | 2;
          this.perfUpgradeT = 0;
          this.applyPerfTier();
        } else if (this.frameMsEma < 12.5 && this.perfTier > 0) {
          this.perfUpgradeT += 1.2;
          if (this.perfUpgradeT >= 3.5) {
            this.perfTier = (this.perfTier - 1) as 0 | 1 | 2;
            this.perfUpgradeT = 0;
            this.applyPerfTier();
          }
        } else {
          this.perfUpgradeT = 0;
        }
      }
    }
    if (this.n8aoPass) {
      this.n8aoPass.enabled = this.perfTier === 0 || (this.perfTier === 1 && !this.menuHangar);
      this.n8aoPass.configuration.aoSamples = this.perfTier === 0 ? 16 : 8;
      this.n8aoPass.configuration.denoiseSamples = this.perfTier === 0 ? 8 : 4;
    }
    if (this.bloomEffect) {
      const tod = this.level?.timeOfDay;
      const showBloom =
        this.perfTier === 0 || (this.perfTier === 1 && (tod === "night" || tod === "sunset"));
      this.bloomEffect.blendMode.opacity.value = showBloom ? 1 : 0;
      this.bloomEffect.intensity = tod === "night" ? 0.38 : tod === "sunset" ? 0.3 : tod === "dawn" ? 0.24 : 0.2;
    }
    if (this.composer && this.perfTier < 2 && this.renderer.toneMapping !== THREE.NoToneMapping) {
      this.renderer.toneMapping = THREE.NoToneMapping;
    }

    /* ---- 3D HRTF audio listener synced to camera ---- */
    this.camera.getWorldDirection(this.audioFwdTmp);
    this.audioUpTmp.set(0, 1, 0).applyQuaternion(this.camera.quaternion).normalize();
    this.sfx.setListener(this.camera.position, this.audioFwdTmp, this.audioUpTmp);

    /* ---- world / fx / physics ---- */
    this.updateBossHazards(dt);
    if (this.safehouseBrickRig) {
      this.safehouseBrickRig.update(dt, this.safehouseBrickRig.root.position.y);
    }
    this.world.update(dt, rig.root.position);
    this.joltPhysics?.step(dt);
    this.fx.update(dt);
    this.renderFrame(rawDt);
  }

  private updateCamera(rawDt: number, dt: number) {
    const rig = this.rig;
    const cam = this.camera;
    if (this.cinematicState) {
      const cine = this.cinematicState;
      const u = clamp(cine.elapsed / Math.max(0.1, cine.duration), 0, 1);
      const ease = u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2;
      if (cine.usePlayerEnd && rig) {
        const root = rig.root.position;
        const pivot = new THREE.Vector3(root.x, root.y + rig.eyeHeight, root.z);
        const fwd = new THREE.Vector3(
          Math.sin(this.camYaw) * Math.cos(this.camPitch),
          Math.sin(this.camPitch),
          Math.cos(this.camYaw) * Math.cos(this.camPitch),
        );
        const right = new THREE.Vector3(-Math.cos(this.camYaw), 0, Math.sin(this.camYaw));
        cine.endPos.copy(pivot).addScaledVector(fwd, -this.zoomDist).addScaledVector(right, 0.55);
        cine.endPos.y += 0.12;
        cine.endLook.copy(pivot).addScaledVector(fwd, 10);
      }
      this.syncCamFov(lerp(52, 62, ease));
      if (cine.kind === "extract" && cine.orbitFocus) {
        const angle = this.camYaw + Math.PI + ease * 0.72;
        const radius = lerp(3.4, 8.2, ease);
        const h = lerp(1.5, 4.4, ease);
        cam.position.set(
          cine.orbitFocus.x + Math.sin(angle) * radius,
          cine.orbitFocus.y + h,
          cine.orbitFocus.z + Math.cos(angle) * radius,
        );
        const minY = (this.level ? this.level.groundHeightAt(cam.position.x, cam.position.z, cine.orbitFocus.y + 2) : 0) + 0.5;
        if (cam.position.y < minY) cam.position.y = minY;
        cam.lookAt(cine.orbitFocus.x, cine.orbitFocus.y + 1.25, cine.orbitFocus.z);
      } else {
        cam.position.lerpVectors(cine.startPos, cine.endPos, ease);
        const look = this.camToTmp.lerpVectors(cine.startLook, cine.endLook, ease);
        cam.lookAt(look);
      }
      cam.updateMatrixWorld(false);
      return;
    }
    const activeAir = this.level?.aircraft?.activeAircraft ?? null;
    if (activeAir) {
      const fx = Math.sin(activeAir.yaw);
      const fz = Math.cos(activeAir.yaw);
      const dist = activeAir.kind === "airplane" ? 16.5 : 12.5;
      const height = activeAir.kind === "airplane" ? 4.8 : 4.2;
      const airSpdNorm = clamp(Math.abs(activeAir.speed) / (activeAir.kind === "airplane" ? 65 : 34), 0, 1);
      this.syncCamFov(lerp(65, activeAir.kind === "airplane" ? 76 : 71, airSpdNorm));
      cam.position.set(activeAir.pos.x - fx * dist, activeAir.pos.y + height, activeAir.pos.z - fz * dist);
      const minAirCamY = (this.level ? this.level.groundHeightAt(cam.position.x, cam.position.z, activeAir.pos.y + 4) : 0) + 0.65;
      if (cam.position.y < minAirCamY) cam.position.y = minAirCamY;
      cam.lookAt(activeAir.pos.x + fx * 12, activeAir.pos.y + 0.8, activeAir.pos.z + fz * 12);
      cam.updateMatrixWorld(false);
      return;
    }
    const activeBoat = this.level?.boats?.activeBoat ?? null;
    if (activeBoat) {
      const fx = Math.sin(activeBoat.yaw);
      const fz = Math.cos(activeBoat.yaw);
      const boatSpdNorm = clamp(Math.abs(activeBoat.speed) / 28, 0, 1);
      this.syncCamFov(lerp(64, 71, boatSpdNorm));
      cam.position.set(activeBoat.pos.x - fx * 8.2, activeBoat.pos.y + 3.0, activeBoat.pos.z - fz * 8.2);
      cam.lookAt(activeBoat.pos.x + fx * 10, activeBoat.pos.y + 0.9, activeBoat.pos.z + fz * 10);
      cam.updateMatrixWorld(false);
      return;
    }
    const activeVeh = this.level?.vehicles?.activeVehicle ?? null;
    if (activeVeh) {
      // Free-orbit exterior driving camera (matches on-foot free look) + cabin hood/bumper views
      const { preset, distance, height, lookAhead, fov } = this.vehCam;
      this.syncCamFov(fov);

      const bodyY = activeVeh.pos.y + activeVeh.suspension.heave * 0.65;
      if (preset === "hood" || preset === "bumper") {
        const lookYaw = activeVeh.yaw + this.freeYaw;
        const fx = Math.sin(activeVeh.yaw);
        const fz = Math.cos(activeVeh.yaw);
        const lx = Math.sin(lookYaw);
        const lz = Math.cos(lookYaw);
        const pitchTilt = activeVeh.airborne
          ? activeVeh.suspension.airPitch
          : activeVeh.suspension.groundPitch + activeVeh.suspension.pitch * 0.6;
        cam.position.set(activeVeh.pos.x + fx * distance, bodyY + height, activeVeh.pos.z + fz * distance);
        cam.lookAt(
          activeVeh.pos.x + lx * lookAhead,
          bodyY + (preset === "bumper" ? 0.5 : 0.9) - Math.sin(pitchTilt + this.freePitch) * lookAhead * 0.45,
          activeVeh.pos.z + lz * lookAhead,
        );
        cam.updateMatrixWorld(false);
        return;
      }

      // World-space free-orbit camera around vehicle (identical feel to walking camera)
      const orbitYaw = this.camYaw;
      const basePitch = Math.atan2(Math.max(0.4, height - 0.95), Math.max(2.5, distance));
      const orbitPitch = clamp(basePitch + this.camPitch, -0.18, 1.32);
      const radius = Math.hypot(distance, Math.max(0.4, height - 0.95));
      const horizontal = Math.cos(orbitPitch) * radius;
      cam.position.set(
        activeVeh.pos.x - Math.sin(orbitYaw) * horizontal,
        bodyY + 0.95 + Math.sin(orbitPitch) * radius,
        activeVeh.pos.z - Math.cos(orbitYaw) * horizontal,
      );

      // Raycast vehicle camera against buildings & terrain walls so reversing/orbiting never clips inside geometry
      const vehPivot = this.camPivotTmp.set(activeVeh.pos.x, bodyY + 1.15, activeVeh.pos.z);
      const toCam = this.camToTmp.copy(cam.position).sub(vehPivot);
      const camLen = toCam.length();
      if (camLen > 0.5 && this.level?.spatialColliders) {
        const camDir = this.camDirTmp.copy(toCam).divideScalar(camLen);
        this.raycaster.set(vehPivot, camDir);
        this.raycaster.far = camLen;
        const wallHits = this.raycaster.intersectObjects(
          this.level.spatialColliders.queryRay(vehPivot, camDir, camLen, this.rayScratch),
          false,
        );
        if (wallHits.length && wallHits[0].distance < camLen) {
          cam.position.copy(vehPivot).addScaledVector(camDir, Math.max(1.35, wallHits[0].distance - 0.35));
        }
      }
      const minCamY = (this.level ? this.level.groundHeightAt(cam.position.x, cam.position.z, activeVeh.pos.y + 1.4) : 0) + 0.35;
      if (cam.position.y < minCamY) cam.position.y = minCamY;
      cam.lookAt(activeVeh.pos.x, bodyY + 1.0, activeVeh.pos.z);
      cam.updateMatrixWorld(false);
      return;
    }

    const ads = rig.input.ads && !rig.dead;
    this.adsBlend = damp(this.adsBlend, ads ? 1 : 0, 18, rawDt);
    const sprinting = rig.status === "Sprinting";
    this.sprintFov = damp(this.sprintFov, sprinting ? 7 : 0, 10, rawDt);
    const targetAdsFov = this.weaponAmmo[this.weaponIdx]?.adsFov ?? 44;
    this.adsFovSmooth = damp(this.adsFovSmooth, targetAdsFov, 16, rawDt);
    const binocFov = [24, 14, 9][this.binocularsZoomIdx] ?? 24;
    const targetCamFov = this.binocularsOpen
      ? damp(cam.fov, binocFov, 14, rawDt)
      : lerp(62, this.adsFovSmooth, this.adsBlend) + this.sprintFov;
    this.syncCamFov(targetCamFov);

    const kick = this.camKick.update(0, dt);
    const sx = this.shakeX.update(0, dt);
    const sy = this.shakeY.update(0, dt);
    this.camTrauma = Math.max(0, this.camTrauma - rawDt * 1.45);
    const shakeSq = this.camTrauma * this.camTrauma;
    const tNow = performance.now() * 0.001;
    const traumaYaw = shakeSq * this.camTraumaNoise.fbm(tNow, 11.0, 1) * 0.022;
    const traumaPitch = shakeSq * this.camTraumaNoise.fbm(tNow, 11.0, 2) * 0.018;
    const traumaRoll = shakeSq * this.camTraumaNoise.fbm(tNow, 9.5, 3) * 0.016;

    const targetPivot = rig.dead ? 0.7 : rig.eyeHeight;
    this.pivotY = damp(this.pivotY, targetPivot, 18, rawDt);
    const root = rig.root.position;
    const pivot = this.camPivotTmp.set(root.x, root.y + this.pivotY, root.z);

    let yaw = this.camYaw;
    let pitch = this.camPitch;
    let dist = this.zoomDist;
    let shoulder = 0.55;
    if (this.binocularsOpen) {
      dist = -0.35;
      shoulder = 0;
    } else if (this.showcase) {
      if (!this.mouseL && !this.mouseR) this.camYaw += rawDt * 0.35;
      yaw = this.camYaw;
      pitch = this.camPitch;
      dist = this.zoomDist;
      shoulder = 0;
      pivot.y = root.y + 1.05;
    } else {
      dist = lerp(this.zoomDist, 1.45, this.adsBlend);
      shoulder = lerp(0.55, 0.36, this.adsBlend);
    }
    const p = pitch + kick * 0.01;
    const fwd = this.camFwdTmp.set(Math.sin(yaw) * Math.cos(p), Math.sin(p), Math.cos(yaw) * Math.cos(p));
    const right = this.camRightTmp.set(-Math.cos(yaw), 0, Math.sin(yaw));
    const desired = this.camDesiredTmp.copy(pivot).addScaledVector(fwd, -dist).addScaledVector(right, shoulder);
    desired.y += this.showcase ? 0 : 0.12;

    // camera collision
    const toCam = this.camToTmp.copy(desired).sub(pivot);
    const len = toCam.length();
    const camDir = this.camDirTmp.copy(toCam).normalize();
    this.raycaster.set(pivot, camDir);
    this.raycaster.far = len;
    const camTargets = this.level?.spatialColliders
      ? this.level.spatialColliders.queryRay(pivot, camDir, len, this.rayScratch)
      : this.world.colliders;
    const hits = this.raycaster.intersectObjects(camTargets, false);
    if (hits.length && hits[0].distance < len) desired.copy(pivot).addScaledVector(camDir, Math.max(0.35, hits[0].distance - 0.2));
    const minCamY = (this.level ? this.level.groundHeightAt(desired.x, desired.z, root.y + 1.0) : 0) + 0.18;
    if (desired.y < minCamY) desired.y = minCamY;

    cam.position.copy(desired);
    cam.rotation.order = "YXZ";
    cam.rotation.y = yaw + Math.PI + sx * 0.0008 + traumaYaw;
    cam.rotation.x = p + sy * 0.0008 + traumaPitch;
    cam.rotation.z = rig.input.lean * -0.04 + traumaRoll;
    cam.updateMatrixWorld(false);
  }

  private updateAimPoint() {
    const rig = this.rig;
    if (this.showcase) {
      rig.aimPoint.set(rig.root.position.x + Math.sin(this.yaw) * 40, rig.root.position.y + 1.4 + Math.tan(this.pitch) * 40, rig.root.position.z + Math.cos(this.yaw) * 40);
      return;
    }
    const origin = this.camera.position;
    const dir = this.aimDirTmp.set(0, 0, -1).applyQuaternion(this.camera.quaternion);
    this.raycaster.set(origin, dir);
    this.raycaster.far = 200;
    let aimTargets: THREE.Object3D[];
    if (this.level?.spatialColliders) {
      const list = this.level.spatialColliders.queryRay(origin, dir, 200, this.rayScratch);
      for (let i = 0; i < this.enemyHits.length; i++) list.push(this.enemyHits[i]);
      aimTargets = list;
    } else {
      aimTargets = [...this.enemyHits, ...this.world.colliders];
    }
    const hits = this.raycaster.intersectObjects(aimTargets, false);
    const minD =
      origin.distanceTo(
        this.aimRootTmp.set(rig.root.position.x, rig.root.position.y + 1.2, rig.root.position.z),
      ) + 0.6;
    const h = hits.find((x) => {
      if (x.distance <= minD) return false;
      const f = x.object.userData.fighter as Fighter | undefined;
      if (f) return !f.isDead;
      return x.object.visible;
    });
    if (h) rig.aimPoint.copy(h.point);
    else rig.aimPoint.copy(origin).addScaledVector(dir, 120);
  }

  private loadVehicleCameraSettings() {
    try {
      const raw = localStorage.getItem("overtake-camera");
      if (raw) {
        const s = JSON.parse(raw) as CameraSettings;
        if (s.preset && CAMERA_PRESETS[s.preset]) {
          this.vehCam = { ...CAMERA_PRESETS[s.preset], ...s };
        }
      }
      const free = JSON.parse(localStorage.getItem("overtake-free-camera") || "{}");
      if (typeof free.sensitivity === "number" && Number.isFinite(free.sensitivity)) {
        this.freeCamera.sensitivity = clamp(free.sensitivity, 0.25, 3);
      }
      if (typeof free.autoCenter === "boolean") {
        this.freeCamera.autoCenter = free.autoCenter;
      }
    } catch {}
  }

  private saveVehicleCameraSettings() {
    try {
      localStorage.setItem("overtake-camera", JSON.stringify(this.vehCam));
    } catch {}
  }

  getCameraSettings(): CameraSettings {
    return { ...this.vehCam };
  }

  setCameraPreset(preset: CameraPreset) {
    this.vehCam = { preset, ...CAMERA_PRESETS[preset] };
    const activeVeh = this.level?.vehicles?.activeVehicle;
    if (activeVeh) {
      this.camYaw = activeVeh.yaw;
      this.camPitch = 0.08;
      if (!this.showcase) this.yaw = this.camYaw;
    }
    this.freeYaw = 0;
    this.freePitch = 0;
    this.freeIdle = 0;
    this.vehAudio.setPerspective(this.vehCam.preset === "hood" || this.vehCam.preset === "bumper" ? "cabin" : "exterior");
    this.saveVehicleCameraSettings();
    this.pausedRendered = false;
    this.startLoop();
    this.emitHud();
  }

  setCameraValue(key: "distance" | "height" | "fov" | "lookAhead", value: number) {
    const limits = {
      distance: [1.0, 14],
      height: [0.4, 6],
      fov: [45, 95],
      lookAhead: [3, 40],
    } as const;
    const [lo, hi] = limits[key];
    this.vehCam[key] = clamp(value, lo, hi);
    this.saveVehicleCameraSettings();
    this.pausedRendered = false;
    this.startLoop();
  }

  cycleCamera() {
    const i = CAMERA_ORDER.indexOf(this.vehCam.preset);
    this.setCameraPreset(CAMERA_ORDER[(i + 1) % CAMERA_ORDER.length]);
  }

  toggleVehicleSignal(side: "left" | "right") {
    const vehicles = this.level?.vehicles;
    if (!vehicles?.activeVehicle || this.phase !== "ready" || this.paused) return;
    void this.vehAudio.unlock();
    vehicles.toggleSignal(side);
    const lit = vehicles.isSignalLit();
    this.vehAudio.setSignal(vehicles.signal, lit);
    this.lastSignalKey = `${vehicles.signal ?? "none"}:${lit ? 1 : 0}`;
    this.emitHud();
  }

  getIndicatorSounds(): boolean {
    return this.vehAudio.indicatorSounds;
  }

  setIndicatorSounds(enabled: boolean) {
    this.vehAudio.setIndicatorSounds(enabled);
    this.pausedRendered = false;
    this.emitHud();
  }

  getFreeCameraSettings() {
    return { ...this.freeCamera };
  }

  setFreeCameraSettings(value: Partial<{ sensitivity: number; autoCenter: boolean }>) {
    if (typeof value.sensitivity === "number" && Number.isFinite(value.sensitivity)) {
      this.freeCamera.sensitivity = clamp(value.sensitivity, 0.25, 3);
    }
    if (typeof value.autoCenter === "boolean") {
      this.freeCamera.autoCenter = value.autoCenter;
    }
    try {
      localStorage.setItem("overtake-free-camera", JSON.stringify(this.freeCamera));
    } catch {}
  }

  setWeatherMode(mode: WeatherMode) {
    this.level?.setWeatherMode?.(mode);
    this.pausedRendered = false;
    this.startLoop();
    this.emitHud();
  }

  cycleWeatherMode() {
    const cur = this.level?.weather?.mode ?? "auto";
    const idx = WEATHER_MODES.indexOf(cur);
    this.setWeatherMode(WEATHER_MODES[(idx + 1) % WEATHER_MODES.length]);
  }

  setTimeOfDay(mode: TimeOfDayMode) {
    this.level?.setTimeOfDay?.(mode);
    this.pausedRendered = false;
    this.emitHud();
  }

  cycleTimeOfDay() {
    const cur = this.level?.timeOfDay ?? "afternoon";
    const idx = TIME_OF_DAY_MODES.indexOf(cur);
    this.setTimeOfDay(TIME_OF_DAY_MODES[(idx + 1) % TIME_OF_DAY_MODES.length]);
  }

  summonSelectedCar(carId: CarId, paintHex?: string | null) {
    if (!this.level?.vehicles || !this.rig) return;
    this.level.vehicles.summonPlayerCar(carId, paintHex, this.rig.root.position, this.camYaw);
    this.pausedRendered = false;
    this.startLoop();
    this.emitHud();
  }

  refreshSavedLoadoutAndCar() {
    const save = loadSave();
    this.stats = getPlayerStats(save);
    this.maxHealth = this.stats.maxHp;
    this.health = Math.min(this.health, this.maxHealth);
    if (this.rig) {
      this.rig.setAppearance(save.appearance);
      this.rig.setWeaponConfigs(save.weaponConfigs);
      this.rig.crouchSpeedMult = this.stats.crouchSpeedMult;
    }
    this.weaponConfigs = save.weaponConfigs ?? {};
    this.level?.apartments?.syncOwnership(save.ownedApartments ?? []);
    if (this.level?.vehicles) {
      this.level.vehicles.reapplyPersonalCarCustom(save.selectedCar);
      this.level.apartments?.syncGarageCars(save, this.level.vehicles.getModelLibrary());
    }
    this.pausedRendered = false;
    this.emitHud();
  }

  private getHomeStations(): (HomeStation & { owned?: boolean })[] {
    const save = loadSave();
    const owned = save.ownedApartments ?? [];
    const aptStations =
      this.level?.apartments?.getStations(owned, this.activeApartmentId, this.activeGarageId) ?? [];
    const list: (HomeStation & { owned?: boolean })[] = [];
    if (!this.activeApartmentId && !this.activeGarageId) {
      for (const st of SAFEHOUSE_STATIONS) list.push({ ...st, owned: true });
      if (save.records?.[3]?.completed) {
        list.push({
          id: "safehouse_brick_talk",
          kind: "brick_talk",
          label: "Sgt. Brick Horvat",
          sublabel: "Breacher Partner · Tactical Check-In",
          pos: safehouseLocalToWorld(-1.6, -1.25, 0.16),
          radius: 2.4,
          owned: true,
        });
      }
    }
    for (const st of aptStations) {
      list.push({
        ...st,
        owned: st.apartmentId ? owned.includes(st.apartmentId) : true,
      });
    }
    return list;
  }

  private updateHomeStations() {
    if (!this.rig || this.mission?.id !== -1 || this.paused || this.rig.dead) {
      this.nearbyHomeStation = null;
      return;
    }
    const p = this.rig.root.position;
    const stations = this.getHomeStations();

    // Clear auto-open cooldown once player steps > 3.2m away from a station
    for (const id of Array.from(this.stationAutoCooldown)) {
      const st = stations.find((s) => s.id === id);
      if (!st || Math.hypot(p.x - st.pos.x, p.z - st.pos.z) > 3.2 || Math.abs(p.y - st.pos.y) > 4.0) {
        this.stationAutoCooldown.delete(id);
      }
    }

    let best: (HomeStation & { owned?: boolean }) | null = null;
    let bestD2 = Infinity;
    for (const st of stations) {
      if (Math.abs(p.y - st.pos.y) > 3.2) continue;
      const dx = p.x - st.pos.x;
      const dz = p.z - st.pos.z;
      const d2 = dx * dx + dz * dz;
      if (d2 <= st.radius * st.radius && d2 < bestD2) {
        bestD2 = d2;
        best = st;
      }
    }
    const prevId = this.nearbyHomeStation?.id ?? null;
    this.nearbyHomeStation = best;
    if ((best?.id ?? null) !== prevId) {
      this.emitHud();
    }

    // Auto-open Weapon Workbench and Wardrobe Closet when walking close up to them
    if (best?.autoOpen && !this.stationAutoCooldown.has(best.id) && !this.phoneOpen && !this.mapOpen && !this.weaponWheelOpen) {
      const d = Math.sqrt(bestD2);
      if (d <= 1.85) {
        this.stationAutoCooldown.add(best.id);
        this.triggerHomeStation(best.kind);
      }
    }
  }

  triggerHomeStation(overrideKind?: StationKind) {
    if (this.phase !== "ready" || !this.rig || this.rig.dead) return;
    const st = this.nearbyHomeStation;
    const kind = overrideKind ?? st?.kind;
    if (!kind) return;

    if (kind === "bed") {
      this.sleepInBed();
      return;
    }
    if (kind === "garage_door") {
      this.openHomeModal("garage_mod");
      return;
    }
    if ((kind === "apt_door_ext" || kind === "apt_garage_ext") && st?.apartmentId) {
      const owned = (loadSave().ownedApartments ?? []).includes(st.apartmentId);
      if (!owned) {
        this.openHomeModal("apt_buy", st.apartmentId);
        return;
      }
      if (kind === "apt_garage_ext") {
        this.enterApartmentGarage(st.apartmentId);
      } else {
        this.enterApartment(st.apartmentId);
      }
      return;
    }
    if (kind === "apt_door_int") {
      this.exitApartment();
      return;
    }
    if (kind === "apt_garage_elev" && this.activeApartmentId) {
      this.enterApartmentGarage(this.activeApartmentId);
      return;
    }
    if (kind === "apt_garage_to_apt" && this.activeGarageId) {
      this.enterApartment(this.activeGarageId);
      return;
    }
    if (kind === "apt_garage_to_street") {
      this.exitApartmentGarage();
      return;
    }
    if (kind === "apt_garage_car" && st?.carId) {
      const save = loadSave();
      save.selectedCar = st.carId;
      writeSave(save);
      this.refreshSavedLoadoutAndCar();
      this.openHomeModal("garage_mod", st.apartmentId, st.carId);
      return;
    }
    if (kind === "intel_board") {
      this.openHomeModal("intel_board", st?.apartmentId, st?.carId);
      return;
    }
    if (kind === "brick_talk") {
      const save = loadSave();
      const line = save.records?.[6]?.completed
        ? {
            speaker: "Brick",
            text: "Sovereign Ledger is finished, Julian. Quietest rooftop in Westgate Bay, until the next ghost calls.",
            audioUrl: "/audio/story/brick_safehouse_3.mp3",
          }
        : save.records?.[5]?.completed
          ? {
              speaker: "Brick",
              text: "Apex Tower's blackmail vault is still smoking. Tell Mara to plot the Mount Ironridge approach whenever you are loaded up.",
              audioUrl: "/audio/story/brick_safehouse_2.mp3",
            }
          : {
              speaker: "Brick",
              text: "Still shaking the Highland frost off my boots, Voss. Say the word and I will have breaching charges packed before you clear the driveway.",
              audioUrl: "/audio/story/brick_safehouse_1.mp3",
            };
      this.queueDialogue([line]);
      return;
    }
    if (kind === "weapon_bench" || kind === "closet" || kind === "garage_mod") {
      this.openHomeModal(kind, st?.apartmentId, st?.carId);
    }
  }

  private openHomeModal(
    kind: "garage_mod" | "weapon_bench" | "closet" | "apt_buy" | "intel_board",
    apartmentId?: ApartmentId,
    carId?: CarId,
  ) {
    this.mouseL = false;
    this.mouseR = false;
    this.phoneOpen = false;
    this.mapOpen = false;
    this.weaponWheelOpen = false;
    this.setPaused(true);
    this.cb?.onOpenHomeStation?.(kind, apartmentId, carId);
  }

  enterApartment(id: ApartmentId) {
    if (!this.rig || !this.level?.apartments) return;
    this.level.wanted?.clearWanted(false);
    if (this.level.vehicles?.activeVehicle) {
      this.level.vehicles.exitVehicle();
      this.rig.setVisible(true);
    }
    this.activeGarageId = null;
    this.level.apartments.setActiveGarage(null);
    this.activeApartmentId = id;
    this.level.apartments.setActiveApartment(id);
    const sp = this.level.apartments.getInteriorSpawn(id);
    this.rig.root.position.set(sp.x, sp.y, sp.z);
    this.rig.groundY = sp.y;
    const r = THREE.MathUtils.degToRad(sp.yawDeg);
    this.rig.aimYaw = r;
    this.yaw = this.camYaw = r;
    this.camPitch = 0.08;
    const apt = APARTMENTS.find((a) => a.id === id);
    this.activityToast = {
      title: apt ? apt.name : "Apartment",
      subtitle: apt ? `${apt.address} · ${apt.district}` : "Interior",
      accent: apt?.accentHex ?? "#34d399",
    };
    this.activityToastTimer = 3.2;
    this.sfx.switchWeapon();
    this.updateHomeStations();
    this.emitHud();
  }

  exitApartment() {
    if (!this.rig || !this.level?.apartments || !this.activeApartmentId) return;
    const aptId = this.activeApartmentId;
    const ex = this.level.apartments.getExitPosition(aptId);
    this.activeApartmentId = null;
    this.level.apartments.setActiveApartment(null);
    this.rig.root.position.set(ex.x, ex.y, ex.z);
    this.rig.groundY = ex.y;
    const r = THREE.MathUtils.degToRad(ex.yawDeg);
    this.rig.aimYaw = r;
    this.yaw = this.camYaw = r;
    this.sfx.switchWeapon();
    this.updateHomeStations();
    this.emitHud();
  }

  enterApartmentGarage(id: ApartmentId) {
    if (!this.rig || !this.level?.apartments) return;
    if (this.level.vehicles?.activeVehicle) {
      this.level.vehicles.exitVehicle();
      this.rig.setVisible(true);
    }
    this.activeApartmentId = null;
    this.level.apartments.setActiveApartment(null);
    this.activeGarageId = id;
    if (this.level.vehicles) {
      this.level.apartments.syncGarageCars(loadSave(), this.level.vehicles.getModelLibrary());
    }
    this.level.apartments.setActiveGarage(id);
    const sp = this.level.apartments.getGarageSpawn(id);
    this.rig.root.position.set(sp.x, sp.y, sp.z);
    this.rig.groundY = sp.y;
    const r = THREE.MathUtils.degToRad(sp.yawDeg);
    this.rig.aimYaw = r;
    this.yaw = this.camYaw = r;
    this.camPitch = 0.08;
    const apt = APARTMENTS.find((a) => a.id === id);
    this.activityToast = {
      title: `${apt ? apt.name : "Building"} · Multi-Car Garage`,
      subtitle: "Walk up to any vehicle to Customize [F] or Drive Out [G]",
      accent: "#22d3ee",
    };
    this.activityToastTimer = 3.8;
    this.sfx.switchWeapon();
    this.updateHomeStations();
    this.emitHud();
  }

  exitApartmentGarage() {
    if (!this.rig || !this.level?.apartments || !this.activeGarageId) return;
    const aptId = this.activeGarageId;
    const ex = this.level.apartments.getGarageStreetExit(aptId);
    this.activeGarageId = null;
    this.level.apartments.setActiveGarage(null);
    this.rig.root.position.set(ex.x, ex.y, ex.z);
    this.rig.groundY = ex.y;
    const r = THREE.MathUtils.degToRad(ex.yawDeg);
    this.rig.aimYaw = r;
    this.yaw = this.camYaw = r;
    this.sfx.switchWeapon();
    this.updateHomeStations();
    this.emitHud();
  }

  driveSafehouseCarOut() {
    if (!this.rig || !this.level?.vehicles || this.rig.dead) return;
    const save = loadSave();
    const carId = save.selectedCar;
    const spot = new THREE.Vector3(SAFEHOUSE_CAR_SPOT.x, 5.5, SAFEHOUSE_CAR_SPOT.z);
    const yawRad = THREE.MathUtils.degToRad(SAFEHOUSE_CAR_SPOT.yawDeg);
    const v = this.level.vehicles.spawnAndEnterCarAt(carId, spot, yawRad);
    updateSafehouseGarageDoor(1.0, v.pos, v.pos, true);
    const audioCar: CarId = v.spec.id;
    this.vehAudio.setCar(audioCar);
    this.vehAudio.setPerspective(this.vehCam.preset === "hood" || this.vehCam.preset === "bumper" ? "cabin" : "exterior");
    this.vehAudio.setActive(true);
    this.rig.setVisible(false);
    this.rig.root.position.copy(v.pos);
    this.rig.groundY = v.pos.y;
    this.crouchToggle = false;
    this.camYaw = v.yaw;
    this.camPitch = 0.14;
    this.emitHud();
  }

  driveCarFromBuildingGarage(carId: CarId) {
    if (!this.rig || !this.level?.apartments || !this.level?.vehicles) return;
    const aptId = this.activeGarageId;
    if (!aptId) return;
    const save = loadSave();
    save.selectedCar = carId;
    writeSave(save);

    const ex = this.level.apartments.getGarageStreetExit(aptId);
    this.activeGarageId = null;
    this.level.apartments.setActiveGarage(null);
    this.level.openWorld?.chunks.prewarm(ex.x, ex.z);

    const spawnPos = new THREE.Vector3(ex.x, ex.y, ex.z);
    const yawRad = THREE.MathUtils.degToRad(ex.yawDeg);
    const v = this.level.vehicles.spawnAndEnterCarAt(carId, spawnPos, yawRad);
    const audioCar: CarId = v.spec.id;
    this.vehAudio.setCar(audioCar);
    this.vehAudio.setPerspective(this.vehCam.preset === "hood" || this.vehCam.preset === "bumper" ? "cabin" : "exterior");
    this.vehAudio.setActive(true);
    this.rig.setVisible(false);
    this.rig.root.position.copy(v.pos);
    this.rig.groundY = v.pos.y;
    this.crouchToggle = false;
    this.camYaw = v.yaw;
    this.camPitch = 0.14;
    this.activityToast = {
      title: `Drove Out · ${v.spec.maker} ${v.spec.name}`,
      subtitle: "Westgate Bay Streets",
      accent: "#22d3ee",
    };
    this.activityToastTimer = 3.0;
    this.sfx.switchWeapon();
    this.emitHud();
  }

  sleepInBed() {
    const save = loadSave();
    writeSave(save);
    this.health = this.maxHealth;
    for (let i = 0; i < this.weaponAmmo.length; i++) {
      const spec = WEAPONS[i];
      this.weaponAmmo[i].mag = spec.magSize;
      this.weaponAmmo[i].reserve = spec.reserveMax;
    }
    if (this.rig) {
      const curSpec = WEAPONS[this.weaponIdx];
      this.rig.mag = curSpec.magSize;
      this.rig.reserve = curSpec.reserveMax;
    }
    this.cycleTimeOfDay();
    const nextTod = this.level?.timeOfDay ?? "sunset";
    this.activityToast = {
      title: `Rested & Saved · ${TIME_OF_DAY_LABELS[nextTod]}`,
      subtitle: "Progress saved to localStorage · Health & Ammo restored",
      accent: "#60a5fa",
    };
    this.activityToastTimer = 4.2;
    this.emitHud();
  }

  startSurveillanceContract(contractId: string, startHour = 7.1) {
    if (!this.level?.contracts) return false;
    const def = this.level.contracts.startContract(contractId, startHour);
    if (!def) return false;
    this.sfx.interactDone();
    const mc = getMissionCallForSurveillance(contractId);
    if (mc) this.startMissionCall(mc);
    if (this.rig) {
      const rx = def.residence.x;
      const rz = def.residence.z;
      const ry = this.level.groundHeightAt(rx, rz, 8);
      this.cinematicState = {
        kind: "intro",
        codename: `SURVEILLANCE · ${def.code}`,
        title: def.title,
        subtitle: `Target: ${def.targetName} · ${def.residence.district}`,
        accent: "#f59e0b",
        elapsed: 0,
        duration: 4.0,
        startPos: new THREE.Vector3(rx + 28, ry + 18, rz + 28),
        startLook: new THREE.Vector3(rx, ry + 2.2, rz),
        endPos: this.rig.root.position.clone(),
        endLook: this.rig.root.position.clone(),
        usePlayerEnd: true,
      };
    }
    this.emitHud();
    return true;
  }

  abortSurveillanceContract() {
    this.level?.contracts?.abortContract();
    this.emitHud();
  }

  advanceSurveillanceClock(deltaHours = 1.0) {
    if (!this.level?.contracts?.isActive) return;
    this.level.contracts.advanceDayHour(deltaHours);
    this.sfx.ping();
    this.emitHud();
  }

  summonStarterBoat() {
    if (!this.level?.boats || !this.rig) return null;
    const boat = this.level.boats.summonStarterBoatNear(this.rig.root.position);
    if (boat) {
      this.sfx.interactDone();
      this.activityToast = {
        title: "STARTER BOAT DELIVERED",
        subtitle: `${boat.name} moored at nearest coastal water`,
        accent: "#22d3ee",
      };
      this.activityToastTimer = 3.8;
      this.emitHud();
    }
    return boat;
  }

  private spendCredits(cost: number): boolean {
    const save = loadSave();
    if (save.currencies.credits < cost) return false;
    save.currencies.credits -= cost;
    writeSave(save);
    return true;
  }

  private wireOpenWorldCallbacks() {
    if (!this.level || this.mission?.id !== -1) return;
    const { vehicles, pedestrians, wanted, bodyCarry, aircraft } = this.level;
    if (aircraft) {
      aircraft.onRotorDownwash = (pos, overWater, power) => {
        if (overWater) {
          this.fx.waterSplash(pos, 0.38 * power);
        } else {
          const ang = Math.random() * Math.PI * 2;
          const r = 1.2 + Math.random() * 2.4;
          this.fx.vehicleSmoke(new THREE.Vector3(pos.x + Math.cos(ang) * r, pos.y + 0.15, pos.z + Math.sin(ang) * r), false);
        }
      };
    }
    if (vehicles) {
      vehicles.onCarjack = (v) => {
        pedestrians?.spawnEjectedDriver(v.pos.x, v.pos.y, v.pos.z, v.yaw);
        wanted?.reportCrime("carjack", v.pos);
        this.activityToast = {
          title: `Carjacked ${v.spec.name}`,
          subtitle: "Driver ejected · Police notified",
          accent: "#f87171",
        };
        this.activityToastTimer = 3.2;
      };
      vehicles.onSmoke = (pos, burning) => {
        this.fx.vehicleSmoke(pos, burning);
      };
      vehicles.onWaterSplash = (pos, intensity) => {
        this.fx.waterSplash(pos, intensity);
      };
      vehicles.onShatter = (pos, kind) => {
        this.fx.impact(pos, new THREE.Vector3(0, 1, 0), kind === "glass" ? "metal" : "concrete");
        this.sfx.ping();
      };
      vehicles.onVehicleExplode = (v) => {
        this.fx.explosion(v.pos, 1.45);
        this.vehAudio.crash(1.0);
        this.camTrauma = Math.min(1, this.camTrauma + 0.55);
        this.shakeX.kick(12);
        this.shakeY.kick(12);
        this.emitNoise(v.pos, 75, 1.6, "gunshot");
        if (vehicles.activeVehicle === v) {
          this.damage(45, Math.random() * Math.PI * 2);
          const exitPos = vehicles.exitVehicle();
          this.vehAudio.setActive(false);
          this.engineHud = null;
          this.rig.setVisible(true);
          if (exitPos) {
            this.rig.root.position.copy(exitPos);
            this.rig.groundY = exitPos.y;
          }
        }
        this.activityToast = {
          title: `${v.spec.name} Wrecked!`,
          subtitle: "Vehicle destroyed",
          accent: "#ef4444",
        };
        this.activityToastTimer = 3.5;
      };
    }
    if (pedestrians) {
      pedestrians.onPedestrianHitByPlayer = () => {
        wanted?.reportCrime("vehicular", this.rig?.root.position ?? { x: 0, z: 0 });
      };
      pedestrians.onPedestrianWounded = (ped, hitPt) => {
        this.fx.bloodBurst(hitPt, undefined, 1.05);
        if (ped.model) {
          this.fx.attachWoundToCharacter(ped.model, Math.max(0.55, Math.min(1.55, hitPt.y - ped.y)));
        }
      };
      pedestrians.onPedestrianKilled = (ped, hitPt, detachedModel) => {
        this.fx.bloodBurst(hitPt, undefined, 1.35);
        if (detachedModel && bodyCarry) {
          bodyCarry.registerDeadBody({
            roleId: ped.roleId,
            x: ped.x,
            y: ped.y,
            z: ped.z,
            yaw: ped.yaw,
            model: detachedModel,
          });
        } else {
          this.fx.spawnBloodPool(ped.x, ped.y, ped.z, 0.92);
        }
      };
      pedestrians.onWeaponBrandishedAtCop = (ped) => {
        wanted?.reportCrime("assault", { x: ped.x, z: ped.z });
        this.activityToast = {
          title: "OFFICER SPOTTED WEAPON",
          subtitle: "Holster [H] · Brandishing firearm in public",
          accent: "#f59e0b",
        };
        this.activityToastTimer = 3.0;
      };
      pedestrians.onBodyWitnessed = (ped) => {
        wanted?.reportCrime("assault", { x: ped.x, z: ped.z });
        this.activityToast = {
          title: "WITNESS SPOTTED BODY!",
          subtitle: "Civilian called 911 — Hide body in trunk or ocean",
          accent: "#ef4444",
        };
        this.activityToastTimer = 3.8;
      };
    }
    if (bodyCarry) {
      bodyCarry.onOceanDisposed = (body, deepSea) => {
        if (this.level?.contracts?.handleOceanDisposed(body, deepSea)) {
          return;
        }
        this.activityToast = {
          title: deepSea ? "BODY DISPOSED AT SEA" : "BODY SUNK IN WATER",
          subtitle: deepSea
            ? "Evidence lost to the deep Pacific · Heat reduced"
            : "Evidence submerged offshore",
          accent: "#0ea5e9",
        };
        this.activityToastTimer = 3.6;
        if (deepSea && wanted && wanted.stars === 1 && wanted.evading) {
          wanted.clearWanted(true);
        }
        this.emitHud();
      };
    }
    if (this.level.contracts) {
      this.level.contracts.onContractStarted = (def) => {
        this.activityToast = {
          title: `SURVEILLANCE · ${def.code} ${def.title.toUpperCase()}`,
          subtitle: `Target: ${def.targetName} · Watch his routine & strike unseen`,
          accent: "#f59e0b",
        };
        this.activityToastTimer = 4.8;
      };
      this.level.contracts.onTargetEliminated = (def, unseen, accident) => {
        this.sfx.interactDone();
        const isVale = def.id === "hit_syndicate_architect";
        this.queueDialogue([
          isVale
            ? { speaker: "Voss", text: "Vale is down. Keys are secure. Dumping the body.", audioUrl: "/audio/story/voss_surv_vale.mp3" }
            : { speaker: "Voss", text: "Target is down. Moving the body offshore.", audioUrl: "/audio/story/voss_surv_down.mp3" },
        ]);
        this.activityToast = {
          title: accident
            ? `ACCIDENT KILL · ${def.targetName} DOWN`
            : unseen
              ? `UNSEEN STRIKE · ${def.targetName} DOWN`
              : `TARGET DOWN · ${def.targetName}`,
          subtitle: "Pick up body [G] -> Car Trunk or Starter Boat [F] -> Dump in Ocean [G]",
          accent: unseen || accident ? "#22c55e" : "#f59e0b",
        };
        this.activityToastTimer = 5.5;
        this.emitHud();
      };
      this.level.contracts.onContractCompleted = ({ def, totalReward, unseen, deepSea, accident }) => {
        this.sfx.interactDone();
        const storyCh = getStoryChapterForSurveillance(def.id);
        const nextCh = getNextChapterAfterSurveillance(def.id);
        if (storyCh?.debriefDialogue?.length) {
          this.queueDialogue(storyCh.debriefDialogue);
        }
        this.activityToast = {
          title: storyCh
            ? `CH ${storyCh.code} CLEARED · ${def.targetName}`
            : `CONTRACT CLEARED · ${def.targetName}`,
          subtitle: `+${totalReward} Cr${accident ? " · Accident Bonus" : ""}${unseen ? " · Unseen Bonus" : ""}${deepSea ? " · Deep Sea" : ""}${nextCh ? ` · Next: Ch ${nextCh.code} ${nextCh.codename}` : ""}`,
          accent: "#22c55e",
        };
        this.activityToastTimer = 6.2;
        this.emitHud();
      };
      this.level.contracts.onSabotageTriggered = (title, subtitle) => {
        this.sfx.interactDone();
        this.activityToast = { title, subtitle, accent: "#fbbf24" };
        this.activityToastTimer = 4.2;
        this.emitHud();
      };
      this.level.contracts.onAccidentExplosion = (epos) => {
        this.fx.explosion(epos, 1.35);
        this.vehAudio.crash(1.0);
        this.shakeX.kick(0.45);
        this.shakeY.kick(0.45);
      };
    }
    if (wanted) {
      wanted.events = {
        onOfficerShot: (from, to, hitPlayer, dmg) => {
          this.fx.tracer(from, to);
          this.sfx.shot(1.05, false);
          if (hitPlayer) this.damage(dmg, Math.random() * Math.PI * 2);
        },
        onOfficerHit: (hitPos, model) => {
          this.fx.bloodBurst(hitPos, undefined, 1.0);
          if (model) this.fx.attachWoundToCharacter(model, 1.18);
        },
        onOfficerDown: (pos, reward, model, yaw) => {
          awardDrivingCredits(reward);
          this.fx.bloodBurst(pos.clone().add(new THREE.Vector3(0, 0.95, 0)), undefined, 1.25);
          if (model && bodyCarry) {
            bodyCarry.registerDeadBody({
              roleId: "police",
              x: pos.x,
              y: pos.y,
              z: pos.z,
              yaw,
              model,
            });
          } else {
            this.fx.spawnBloodPool(pos.x, pos.y, pos.z, 0.92);
          }
          this.level?.collectibles?.spawnDrop(
            Math.random() < 0.35 ? "medkit" : "cash",
            pos.x,
            pos.y,
            pos.z,
            Math.random() < 0.35 ? 25 : 75,
          );
        },
        onChopperDown: (pos, reward) => {
          awardDrivingCredits(reward);
          this.fx.explosion(pos, 2.2);
          this.vehAudio.crash(1.1);
          this.activityToast = {
            title: "POLICE CHOPPER DOWN!",
            subtitle: `Pursuit Helicopter Destroyed · +${reward} Cr`,
            accent: "#fbbf24",
          };
          this.activityToastTimer = 4.2;
        },
        onWantedCleared: (starsCleared, bonus) => {
          awardDrivingCredits(bonus);
          this.activityToast = {
            title: "WANTED LEVEL EVADED",
            subtitle: `${starsCleared}★ Cleared · +${bonus} Cr Evasion Bonus`,
            accent: "#38bdf8",
          };
          this.activityToastTimer = 4.2;
        },
        onStarsChanged: (stars) => {
          if (stars > this.lastWantedStars && this.rig && this.level?.getDistrictAt) {
            const dist = this.level.getDistrictAt(this.rig.root.position.x, this.rig.root.position.z);
            this.level.pedestrians?.voices.speakDispatch(stars, dist?.name ?? "Westgate Bay");
          }
          this.lastWantedStars = stars;
          this.emitHud();
        },
      };
    }
  }

  private handleKeyG() {
    if (!this.rig || !this.level) return;
    const pos = this.level.vehicles?.activeVehicle?.pos ?? this.rig.root.position;
    const activeVeh = this.level.vehicles?.activeVehicle ?? null;
    const activeBoat = this.level.boats?.activeBoat ?? null;
    const activeAir = this.level.aircraft?.activeAircraft ?? null;
    const bodyCarry = this.level.bodyCarry ?? null;
    const terrainAt = (x: number, z: number) =>
      this.level?.heightSystem?.terrainHeightAt(x, z) ?? this.level?.groundHeightAt(x, z, 20) ?? 0;

    // 0a. Dump body overboard from piloted boat
    if (activeBoat && bodyCarry && activeBoat.stowedBody) {
      bodyCarry.dumpBodyIntoWater(activeBoat, activeBoat.pos, activeBoat.yaw, this.fx, this.sfx);
      this.emitHud();
      return;
    }

    // 0a2. Sabotage target vehicle or workplace hazard [G]
    if (!activeVeh && !activeBoat && !activeAir && !bodyCarry?.isCarrying && this.level.contracts?.trySabotage(this.rig.root.position)) {
      this.emitHud();
      return;
    }

    // 0b. On-foot body carry / trunk stash / trunk retrieve / shoreline dump
    if (!activeVeh && !activeBoat && !activeAir && bodyCarry && !this.rig.dead) {
      if (bodyCarry.isCarrying) {
        const trunkVeh = this.level.vehicles
          ? bodyCarry.findNearestTrunkVehicle(this.rig.root.position, this.level.vehicles.vehicles)
          : null;
        if (trunkVeh && bodyCarry.stashInTrunk(trunkVeh, this.fx, this.sfx)) {
          this.rig.carryingBody = false;
          this.activityToast = {
            title: "BODY STASHED IN TRUNK",
            subtitle: `${trunkVeh.spec.name} · Hidden from witnesses`,
            accent: "#f59e0b",
          };
          this.activityToastTimer = 2.8;
          this.emitHud();
          return;
        }
        const dropX = this.rig.root.position.x + Math.sin(this.camYaw) * 1.4;
        const dropZ = this.rig.root.position.z + Math.cos(this.camYaw) * 1.4;
        if (terrainAt(dropX, dropZ) < 0.25) {
          bodyCarry.dumpBodyIntoWater(null, this.rig.root.position, this.camYaw, this.fx, this.sfx);
          this.rig.carryingBody = false;
          this.emitHud();
          return;
        }
        bodyCarry.dropCarriedBody(
          this.rig.root.position,
          this.camYaw,
          (x, z, y) => this.level!.groundHeightAt(x, z, y),
        );
        this.rig.carryingBody = false;
        this.sfx.thud();
        this.emitHud();
        return;
      }

      const groundBody = bodyCarry.findNearestGroundBody(this.rig.root.position);
      if (groundBody && bodyCarry.pickUpBody(groundBody)) {
        this.setHolstered(true);
        this.rig.carryingBody = true;
        this.sfx.thud();
        this.activityToast = {
          title: "CARRYING BODY",
          subtitle: "Hide in car trunk [G], load onto boat [F], or dump in ocean [G]",
          accent: "#f59e0b",
        };
        this.activityToastTimer = 3.6;
        this.emitHud();
        return;
      }

      const trunkVeh = this.level.vehicles
        ? bodyCarry.findNearestTrunkVehicle(this.rig.root.position, this.level.vehicles.vehicles)
        : null;
      if (trunkVeh && (trunkVeh.trunkBodies?.length ?? 0) > 0 && bodyCarry.takeFromTrunk(trunkVeh, this.sfx)) {
        this.setHolstered(true);
        this.rig.carryingBody = true;
        this.activityToast = {
          title: "RETRIEVED BODY FROM TRUNK",
          subtitle: `From ${trunkVeh.spec.name}`,
          accent: "#f59e0b",
        };
        this.activityToastTimer = 2.8;
        this.emitHud();
        return;
      }
    }

    if (this.nearbyHomeStation?.kind === "garage_mod") {
      this.triggerHomeStation("garage_mod");
      return;
    }
    if (this.nearbyHomeStation?.kind === "garage_door") {
      this.driveSafehouseCarOut();
      return;
    }
    if (this.nearbyHomeStation?.kind === "apt_garage_car" && this.nearbyHomeStation.carId) {
      this.driveCarFromBuildingGarage(this.nearbyHomeStation.carId);
      return;
    }

    // 1. Westgate Customs Drive-In Mod Garage
    if (activeVeh && this.level.shops) {
      const garage = this.level.shops.findNearbyGarage(activeVeh.pos);
      if (garage) {
        const needsRepair = activeVeh.hp < activeVeh.maxHp;
        const cost = needsRepair ? 150 : 120;
        if (!this.spendCredits(cost)) {
          this.activityToast = {
            title: garage.name,
            subtitle: `Need ${cost} Cr for Repair & Respray`,
            accent: "#f87171",
          };
          this.activityToastTimer = 3.0;
          this.emitHud();
          return;
        }
        const nextPaint = this.level.shops.nextPaintOption();
        this.level.vehicles?.repairVehicle(activeVeh, nextPaint.hex);
        this.sfx.interactDone();
        this.activityToast = {
          title: `${garage.name}`,
          subtitle: `100% Repaired & Painted ${nextPaint.name} · -${cost} Cr`,
          accent: "#a855f7",
        };
        this.activityToastTimer = 3.6;
        this.emitHud();
        return;
      }
    }

    // 2. 24/7 Westgate Mart Holdup
    if (!activeVeh && this.level.shops) {
      const store = this.level.shops.findNearbyStore(pos);
      if (store && store.robbable) {
        const loot = this.level.shops.triggerRobbery(store.def.id);
        if (loot > 0) {
          awardDrivingCredits(loot);
          this.level.pedestrians?.voices.speak("clerk", "robbery", Math.floor(Math.random() * 100), 3, true);
          this.level.wanted?.reportCrime("robbery", pos);
          const dist = this.level.getDistrictAt?.(pos.x, pos.z);
          this.level.pedestrians?.voices.speakDispatch(Math.max(1, this.level.wanted?.stars ?? 1), dist?.name ?? "Westgate Bay", `Armed robbery at ${store.def.name}`);
          this.sfx.interactDone();
          this.activityToast = {
            title: `ROBBERY · ${store.def.name}`,
            subtitle: `Grabbed +${loot} Cr from register — Police Alerted!`,
            accent: "#ef4444",
          };
          this.activityToastTimer = 4.2;
          this.emitHud();
          return;
        }
      }
    }

    // 3. Street Race Start
    if (activeVeh && this.level.activities) {
      const race = this.level.activities.findNearbyRace(activeVeh.pos);
      if (race) {
        this.level.activities.startRace(race);
        this.vehAudio.radarChime(true);
        this.activityToast = {
          title: `RACE STARTED · ${race.name}`,
          subtitle: `Follow the gold checkpoints · 3 Rivals`,
          accent: "#fbbf24",
        };
        this.activityToastTimer = 4.0;
        this.emitHud();
        return;
      }
    }

    if (this.nearbyContractSpot) {
      this.launchNearbyContract();
    }
  }

  private checkDistrictDiscovery(pos: THREE.Vector3) {
    if (!this.level?.activities) return;
    const distInfo = this.level.getDistrictAt?.(pos.x, pos.z);
    if (!distInfo || this.level.activities.discoveredDistricts.has(distInfo.id)) return;
    this.level.activities.discoveredDistricts.add(distInfo.id);
    const isNew = recordDiscoveredDistrict(distInfo.id);
    if (isNew && this.level.activities.discoveredDistricts.size > 1) {
      awardDrivingCredits(75);
      this.activityToast = {
        title: `Discovered ${distInfo.name}`,
        subtitle: `${distInfo.subtitle} · +75 Cr`,
        accent: "#34d399",
      };
      this.activityToastTimer = 4.0;
    }
  }

  private updateOpenWorldInteractions(dt: number, pos: THREE.Vector3, speed: number, driving: boolean) {
    if (!this.level || this.mission?.id !== -1) return;
    this.level.shops?.update(dt);

    const terrainAt = (x: number, z: number) =>
      this.level?.heightSystem?.terrainHeightAt(x, z) ?? this.level?.groundHeightAt(x, z, 20) ?? 0;

    if (this.level.bodyCarry && this.rig) {
      this.rig.carryingBody = this.level.bodyCarry.isCarrying;
      this.level.bodyCarry.update(
        dt,
        this.rig.root.position,
        this.rig.bodyYaw,
        this.crouchToggle,
        driving,
        this.level.vehicles?.vehicles ?? [],
        this.level.boats?.boats ?? [],
        (x, z, y) => this.level!.groundHeightAt(x, z, y),
        terrainAt,
        this.fx,
        this.sfx,
      );
    }

    if (this.level.pedestrians && this.rig) {
      this.level.pedestrians.updatePlayerAwareness(dt, {
        x: pos.x,
        y: pos.y,
        z: pos.z,
        yaw: this.camYaw,
        weaponDrawn: !driving && !this.holstered && !this.rig.dead,
        ads: !driving && (this.mouseR || this.uiHeld.ads),
        carryingBody: !driving && !!this.level.bodyCarry?.isCarrying,
        crouching: !driving && this.crouchToggle,
      });
    }

    if (this.binocularsOpen) {
      const bDir = new THREE.Vector3();
      this.camera.getWorldDirection(bDir);
      this.raycaster.set(this.camera.position, bDir);
      this.raycaster.far = 360;
      const bTargets = this.level?.spatialColliders
        ? this.level.spatialColliders.queryRay(this.camera.position, bDir, 360, this.rayScratch)
        : this.world.colliders;
      const bHits = this.raycaster.intersectObjects(bTargets, false);
      this.binocularsRangeM = bHits.length > 0 ? Math.round(bHits[0].distance) : 360;
      this.level.contracts?.tagTargetFromAim(this.camera.position, bDir);
    }

    if (this.level.contracts) {
      this.level.contracts.update(dt, pos, !driving && (this.mouseR || this.uiHeld.ads), this.binocularsOpen);
    }
    const activeHydrants = this.level.openWorld?.props.getActiveHydrants(performance.now() * 0.001, pos.x, pos.z) ?? [];
    for (let i = 0; i < activeHydrants.length; i++) {
      const h = activeHydrants[i];
      this.fx.hydrantSpray(new THREE.Vector3(h.x, h.y, h.z));
    }

    const weatherDarkness = this.level.weather
      ? Math.max(this.level.weather.rain * 0.55, this.level.weather.snow * 0.45)
      : 0;
    const todDarkness = this.level.getTimeOfDayDarkness?.() ?? 0;
    const darkness = Math.min(1, Math.max(weatherDarkness, todDarkness));
    const wantedSiren = this.level.wanted?.update(dt, pos, speed, driving, this.camera, darkness) ?? 0;
    const playerSiren = this.level.vehicles?.activeVehicle?.sirenOn ? 1 : 0;
    this.vehAudio.updateAmbience(dt, pos.x, pos.z, Math.max(wantedSiren, playerSiren), this.level.wanted?.stars ?? 0, pos.y, speed);

    const pickup = this.level.collectibles?.update(dt, pos);
    if (pickup) {
      if (pickup.kind === "medkit") {
        this.health = Math.min(this.maxHealth, this.health + pickup.value);
        this.activityToast = {
          title: "MEDKIT PICKUP",
          subtitle: `+${pickup.value} Health Restored`,
          accent: "#38bdf8",
        };
      } else if (pickup.kind === "stash") {
        const allDone = pickup.stashesFound >= pickup.totalStashes;
        const reward = pickup.value + (allDone ? 2500 : 0);
        awardDrivingCredits(reward);
        this.activityToast = {
          title: allDone ? "ALL 15 STASHES FOUND!" : `HIDDEN STASH ${pickup.stashesFound}/${pickup.totalStashes}`,
          subtitle: `+${reward} Cr`,
          accent: "#fbbf24",
        };
      } else {
        awardDrivingCredits(pickup.value);
        this.activityToast = {
          title: "CASH PICKUP",
          subtitle: `+${pickup.value} Cr`,
          accent: "#22c55e",
        };
      }
      this.sfx.interactDone();
      this.activityToastTimer = 3.2;
      this.emitHud();
    }

    if (this.level.randomEvents) {
      const ev = this.level.randomEvents.update(dt, pos, driving);
      if (ev.spawned) {
        this.activityToast = {
          title: `RANDOM EVENT · ${ev.spawned.title}`,
          subtitle: "Check the flashing icon on your minimap!",
          accent: "#38bdf8",
        };
        this.activityToastTimer = 4.5;
      } else if (ev.outcome) {
        awardDrivingCredits(ev.outcome.reward);
        if (ev.outcome.crime) {
          this.level.wanted?.reportCrime(ev.outcome.crime, pos);
        }
        this.sfx.interactDone();
        this.activityToast = {
          title: ev.outcome.title,
          subtitle: `${ev.outcome.detail} · +${ev.outcome.reward} Cr`,
          accent: ev.outcome.crime ? "#f59e0b" : "#34d399",
        };
        this.activityToastTimer = 4.5;
      }
    }

    // Update contextual prompt pill
    const bodyCarry = this.level.bodyCarry ?? null;
    const activeBoat = this.level.boats?.activeBoat ?? null;

    let nextPrompt: { key: "F" | "G"; label: string; accent: string } | null = null;
    if (activeBoat && activeBoat.stowedBody) {
      const deepSea = terrainAt(activeBoat.pos.x, activeBoat.pos.z) < -1.2;
      nextPrompt = {
        key: "G",
        label: deepSea
          ? "Dump Body into Deep Ocean"
          : "Dump Body Overboard (Go farther offshore for Deep Sea)",
        accent: "#0ea5e9",
      };
    }
    if (!nextPrompt && !driving && !bodyCarry?.isCarrying && this.level.contracts) {
      const sabLabel = this.level.contracts.getNearbySabotagePrompt(pos);
      if (sabLabel) {
        nextPrompt = { key: "G", label: sabLabel, accent: "#fbbf24" };
      }
    }
    if (!nextPrompt && !driving && bodyCarry) {
      if (bodyCarry.isCarrying) {
        const trunkVeh = this.level.vehicles
          ? bodyCarry.findNearestTrunkVehicle(pos, this.level.vehicles.vehicles)
          : null;
        const nearBoat = this.level.boats?.findNearestEnterable(pos) ?? null;
        const dropX = pos.x + Math.sin(this.camYaw) * 1.4;
        const dropZ = pos.z + Math.cos(this.camYaw) * 1.4;
        if (trunkVeh && (trunkVeh.trunkBodies?.length ?? 0) < 2) {
          nextPrompt = {
            key: "G",
            label: `Stash Body in ${trunkVeh.spec.name} Trunk`,
            accent: "#f59e0b",
          };
        } else if (nearBoat && !nearBoat.stowedBody) {
          nextPrompt = {
            key: "F",
            label: `Board ${nearBoat.name} with Body`,
            accent: "#0ea5e9",
          };
        } else if (terrainAt(dropX, dropZ) < 0.25) {
          nextPrompt = {
            key: "G",
            label: "Dump Body into Water",
            accent: "#0ea5e9",
          };
        } else {
          nextPrompt = {
            key: "G",
            label: "Drop Body",
            accent: "#f59e0b",
          };
        }
      } else {
        const groundBody = bodyCarry.findNearestGroundBody(pos);
        if (groundBody) {
          nextPrompt = {
            key: "G",
            label: "Pick Up Body",
            accent: "#f59e0b",
          };
        } else {
          const trunkVeh = this.level.vehicles
            ? bodyCarry.findNearestTrunkVehicle(pos, this.level.vehicles.vehicles)
            : null;
          if (trunkVeh && (trunkVeh.trunkBodies?.length ?? 0) > 0) {
            nextPrompt = {
              key: "G",
              label: `Take Body from ${trunkVeh.spec.name} Trunk (${trunkVeh.trunkBodies!.length})`,
              accent: "#f59e0b",
            };
          }
        }
      }
    }
    if (!nextPrompt && driving && this.level.shops) {
      const garage = this.level.shops.findNearbyGarage(pos);
      if (garage) {
        nextPrompt = { key: "G", label: `${garage.name} · Repair & Paint ($150)`, accent: "#a855f7" };
      }
    }
    if (!nextPrompt && driving && this.level.activities) {
      const race = this.level.activities.findNearbyRace(pos);
      if (race) {
        nextPrompt = { key: "G", label: `Start ${race.name} ($${race.reward1st} 1st)`, accent: "#fbbf24" };
      }
    }
    if (!nextPrompt && !driving && this.level.shops) {
      const store = this.level.shops.findNearbyStore(pos);
      if (store) {
        const fLabel =
          this.health < this.maxHealth
            ? "[F] Snack +35 HP ($25)"
            : this.armor < this.maxArmor
              ? "[F] Kevlar Vest +50 ($150)"
              : "[F] Store";
        nextPrompt = store.robbable
          ? { key: "G", label: `${store.def.name} · ${fLabel} / [G] Hold Up`, accent: "#22c55e" }
          : { key: "F", label: `${store.def.name} · ${fLabel}`, accent: "#22c55e" };
      }
    }
    if ((nextPrompt?.label ?? null) !== (this.nearbyPrompt?.label ?? null)) {
      this.nearbyPrompt = nextPrompt;
      this.emitHud();
    } else {
      this.nearbyPrompt = nextPrompt;
    }
  }

  private setParachuteActive(active: boolean) {
    this.parachuting = active;
    if (!this.rig) return;
    if (active) {
      if (!this.parachuteMesh) {
        const g = new THREE.Group();
        const canopy = new THREE.Mesh(
          new THREE.SphereGeometry(2.1, 14, 8, 0, Math.PI * 2, 0, Math.PI * 0.48),
          new THREE.MeshStandardMaterial({
            color: 0xf97316,
            roughness: 0.55,
            side: THREE.DoubleSide,
          }),
        );
        canopy.position.y = 3.25;
        const lineMat = new THREE.MeshBasicMaterial({ color: 0xe2e8f0 });
        const lineGeo = new THREE.CylinderGeometry(0.014, 0.014, 2.2, 4);
        for (const [lx, lz] of [[-1.3, 0], [1.3, 0], [0, -1.3], [0, 1.3]]) {
          const line = new THREE.Mesh(lineGeo, lineMat);
          line.position.set(lx * 0.55, 2.25, lz * 0.55);
          line.rotation.z = -lx * 0.35;
          line.rotation.x = lz * 0.35;
          g.add(line);
        }
        g.add(canopy);
        this.parachuteMesh = g;
      }
      this.rig.root.add(this.parachuteMesh);
      this.parachuteMesh.visible = true;
    } else if (this.parachuteMesh) {
      this.parachuteMesh.visible = false;
      this.parachuteMesh.removeFromParent();
    }
  }

  private detonateAt(pos: THREE.Vector3, radius = 9.5, depth = 0) {
    this.fx.explosion(pos, 1.9);
    this.vehAudio.crash(1.3);
    this.camTrauma = Math.min(1, this.camTrauma + 0.65);
    this.shakeX.kick(14);
    this.shakeY.kick(14);
    this.emitNoise(pos, 85, 1.7, "gunshot");
    this.level?.wanted?.reportCrime("gunfire", pos);

    // Chain-reaction nearby vehicles & explosives
    if (this.level?.vehicles) {
      for (const v of this.level.vehicles.vehicles) {
        const d = v.pos.distanceTo(pos);
        if (d < radius) {
          this.level.vehicles.hitVehicleAtPoint(v.pos.x, v.pos.y + 0.6, v.pos.z, Math.round(120 * (1 - d / radius)), true);
        }
      }
    }
    if (depth < 3 && this.level?.collectibles) {
      const chained = this.level.collectibles.detonateExplosivesNear(pos, radius * 0.85);
      for (const cp of chained) {
        this.detonateAt(cp, radius, depth + 1);
      }
    }
    if (depth < 3 && this.world?.colliders) {
      for (const col of this.world.colliders) {
        const eb = col.userData?.explosiveBarrel as { hp: number; exploded: boolean; vis: THREE.Object3D; col: THREE.Object3D } | undefined;
        if (!eb || eb.exploded) continue;
        const wp = new THREE.Vector3();
        col.getWorldPosition(wp);
        if (wp.distanceTo(pos) < radius * 0.85) {
          eb.hp = 0;
          eb.exploded = true;
          eb.vis.visible = false;
          eb.col.visible = false;
          this.level?.spatialColliders?.remove(eb.col);
          this.detonateAt(wp, radius, depth + 1);
        }
      }
    }
    if (this.level?.wanted) {
      for (const o of this.level.wanted.officers) {
        if (!o.dead && Math.hypot(o.x - pos.x, o.z - pos.z) < radius) {
          this.level.wanted.hitAtPoint(o.x, o.y + 1.0, o.z, 120);
        }
      }
    }
    if (this.level?.pedestrians) {
      this.level.pedestrians.alertPanic(pos, 55);
    }
  }

  private fireDriveByShot(originPos: THREE.Vector3) {
    if (this.driveByCd > 0 || !this.rig) return;
    const w = WEAPONS[this.weaponIdx];
    const st = this.weaponAmmo[this.weaponIdx];
    if (!st || st.mag <= 0) return;
    st.mag--;
    this.rig.mag = st.mag;
    this.driveByCd = Math.max(0.11, 60 / Math.max(120, w.rpm));
    const muzzle = new THREE.Vector3(originPos.x, originPos.y + 1.18, originPos.z);
    const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion).normalize();
    const end = muzzle.clone().addScaledVector(dir, 120);
    const steps = 48;
    for (let si = 1; si <= steps; si++) {
      const d = (120 * si) / steps;
      const px = muzzle.x + dir.x * d;
      const py = muzzle.y + dir.y * d;
      const pz = muzzle.z + dir.z * d;
      if (this.level?.wanted?.hitAtPoint(px, py, pz, w.damage)) {
        this.hitMarker = 0.2;
        this.sfx.hit();
        end.set(px, py, pz);
        break;
      }
      if (this.level?.contracts?.hitAtPoint(px, py, pz, w.damage, false, originPos)) {
        this.hitMarker = 0.22;
        this.sfx.hit();
        this.fx.bloodBurst(new THREE.Vector3(px, py, pz), undefined, 1.0);
        end.set(px, py, pz);
        break;
      }
      if (this.level?.pedestrians?.hitAtPoint(px, py, pz, 0.72, w.damage)) {
        this.hitMarker = 0.18;
        this.level.wanted?.reportCrime("assault", { x: px, z: pz });
        end.set(px, py, pz);
        break;
      }
    }
    if (this.level?.collectibles) {
      const driveBarrel = this.level.collectibles.hitExplosiveAlongRay(muzzle, dir, muzzle.distanceTo(end), w.damage);
      if (driveBarrel) {
        if (driveBarrel.exploded) this.detonateAt(driveBarrel.point, 9.5);
        else this.fx.impact(driveBarrel.point, dir.clone().negate(), "metal");
        end.copy(driveBarrel.point);
      }
    }
    const driveByVehDmg = Math.max(1.2, w.damage * (w.pellets > 1 ? 0.095 : 0.11));
    const driveVehHit = this.level?.vehicles?.hitVehicleAlongRay(
      muzzle,
      dir,
      muzzle.distanceTo(end),
      driveByVehDmg,
      this.level?.vehicles?.activeVehicle ?? null,
    );
    if (driveVehHit) {
      if (driveVehHit.hitGlass) {
        this.fx.glassBurst(driveVehHit.point);
        this.sfx.glassShatter();
      } else {
        this.fx.impact(driveVehHit.point, driveVehHit.normal, "metal");
      }
      end.copy(driveVehHit.point);
    }
    this.fx.tracer(muzzle, end);
    this.sfx.shot(w.soundPitch, false);
    this.level?.wanted?.reportCrime("gunfire", originPos);
  }

  private tryToggleVehicle() {
    if (this.phase !== "ready" || this.paused || !this.rig || this.rig.dead) return;
    const vehicles = this.level?.vehicles;
    if (!vehicles) return;
    // Don't hijack [F] when holding/standing over a mission interactable
    if (this.activeInteract && !this.activeInteract.done) return;

    const airMgr = this.level?.aircraft;
    if (airMgr?.activeAircraft) {
      const res = airMgr.exitAircraft();
      this.rig.setVisible(true);
      if (res) {
        this.rig.root.position.copy(res.pos);
        this.rig.groundY = res.pos.y;
        if (res.altitudeAboveGround > 12) {
          this.setParachuteActive(true);
          this.activityToast = {
            title: "PARACHUTE DEPLOYED",
            subtitle: "Steer with WASD while gliding down",
            accent: "#f97316",
          };
          this.activityToastTimer = 3.5;
        }
      }
      this.emitHud();
      return;
    }

    const boatMgr = this.level?.boats;
    const bodyCarry = this.level?.bodyCarry ?? null;
    if (boatMgr?.activeBoat) {
      const boatRef = boatMgr.activeBoat;
      const tookBody = bodyCarry?.disembarkBoatWithBody(boatRef) ?? false;
      const exitPos = boatMgr.exitBoat();
      this.rig.setVisible(true);
      if (tookBody) {
        this.setHolstered(true);
        this.rig.carryingBody = true;
      }
      if (exitPos) {
        this.rig.root.position.copy(exitPos);
        this.rig.groundY = exitPos.y;
      }
      this.emitHud();
      return;
    }

    if (vehicles.activeVehicle) {
      const exitPos = vehicles.exitVehicle();
      this.vehAudio.setActive(false);
      this.engineHud = null;
      this.rig.setVisible(true);
      if (exitPos) {
        this.rig.root.position.copy(exitPos);
        this.rig.groundY = exitPos.y;
      }
      this.emitHud();
      return;
    }

    // Check 24/7 Westgate Mart snack or Kevlar armor vest purchase on [F]
    if (this.mission?.id === -1 && this.level?.shops) {
      const store = this.level.shops.findNearbyStore(this.rig.root.position);
      if (store) {
        if (this.health < this.maxHealth) {
          if (this.spendCredits(25)) {
            this.health = Math.min(this.maxHealth, this.health + 35);
            this.sfx.interactDone();
            this.activityToast = {
              title: store.def.name,
              subtitle: "Bought Sprunk & Snack · +35 HP (-25 Cr)",
              accent: "#22c55e",
            };
            this.activityToastTimer = 2.8;
            this.emitHud();
            return;
          }
        } else if (this.armor < this.maxArmor) {
          if (this.spendCredits(150)) {
            this.armor = Math.min(this.maxArmor, this.armor + 50);
            this.sfx.interactDone();
            this.activityToast = {
              title: store.def.name,
              subtitle: "Equipped Kevlar Body Armor · +50 Armor (-150 Cr)",
              accent: "#38bdf8",
            };
            this.activityToastTimer = 2.8;
            this.emitHud();
            return;
          }
        } else {
          this.activityToast = {
            title: store.def.name,
            subtitle: "Vitals & Armor full · Press [G] to hold up register",
            accent: "#22c55e",
          };
          this.activityToastTimer = 2.6;
          this.emitHud();
          return;
        }
      }
    }

    // Prioritize building doors, beds, closets, and workbenches on [F]
    const nearStation = this.nearbyHomeStation;
    const nearV = vehicles.findNearestEnterable(this.rig.root.position);
    if (nearStation && (nearStation.kind !== "garage_mod" || !nearV)) {
      this.triggerHomeStation();
      return;
    }

    if (nearV) {
      if (bodyCarry?.isCarrying) {
        if (bodyCarry.stashInTrunk(nearV, this.fx, this.sfx)) {
          this.rig.carryingBody = false;
          this.activityToast = {
            title: "STASHED BODY IN TRUNK",
            subtitle: `${nearV.spec.name} · Press [G] near trunk later to retrieve`,
            accent: "#f59e0b",
          };
          this.activityToastTimer = 3.2;
        } else {
          this.activityToast = {
            title: "TRUNK FULL",
            subtitle: "Drop body [G] before driving this vehicle",
            accent: "#ef4444",
          };
          this.activityToastTimer = 2.6;
          this.emitHud();
          return;
        }
      }
      vehicles.enterVehicle(nearV);
      const audioCar: CarId = nearV.spec.id;
      this.vehAudio.setCar(audioCar);
      this.vehAudio.setPerspective(this.vehCam.preset === "hood" || this.vehCam.preset === "bumper" ? "cabin" : "exterior");
      this.vehAudio.setActive(true);
      this.rig.setVisible(false);
      this.crouchToggle = false;
      this.camYaw = nearV.yaw;
      this.yaw = nearV.yaw;
      this.camPitch = 0.08;
      this.freeYaw = 0;
      this.freePitch = 0;
      this.freeIdle = 0;
      this.emitHud();
      return;
    }

    const nearAir = airMgr?.findNearestEnterable(this.rig.root.position) ?? null;
    if (nearAir && airMgr) {
      airMgr.enterAircraft(nearAir);
      this.rig.setVisible(false);
      this.crouchToggle = false;
      this.camYaw = nearAir.yaw;
      this.activityToast = {
        title: `Piloting ${nearAir.name}`,
        subtitle: nearAir.kind === "helicopter"
          ? "Space/Shift: Lift · W/S/A/D: Pitch/Roll · Q/E: Yaw · F: Bail Out"
          : "Space: Throttle · W/S/A/D: Pitch/Roll · Q/E: Rudder · F: Bail Out",
        accent: "#38bdf8",
      };
      this.activityToastTimer = 4.5;
      this.emitHud();
      return;
    }

    const nearBoat = boatMgr?.findNearestEnterable(this.rig.root.position) ?? null;
    if (nearBoat && boatMgr) {
      let loadedBody = false;
      if (bodyCarry?.isCarrying) {
        loadedBody = bodyCarry.boardBoatWithCarriedBody(nearBoat);
        if (loadedBody) this.rig.carryingBody = false;
      }
      boatMgr.enterBoat(nearBoat);
      this.rig.setVisible(false);
      this.crouchToggle = false;
      this.camYaw = nearBoat.yaw;
      this.activityToast = {
        title: loadedBody ? `Loaded Body · ${nearBoat.name}` : `Piloting ${nearBoat.name}`,
        subtitle: loadedBody || nearBoat.stowedBody
          ? "Sail out to deep water & press [G] to dump body overboard"
          : "W/S: Throttle · A/D: Steer · F: Disembark",
        accent: "#0ea5e9",
      };
      this.activityToastTimer = 4.2;
      this.emitHud();
      return;
    }

    if (this.mission?.id === -1 && this.nearbyContractSpot) {
      this.launchNearbyContract();
      return;
    }

    // Talk to nearby pedestrian with [F] when on foot
    this.level?.pedestrians?.interactNearest(this.rig.root.position.x, this.rig.root.position.z);
  }

  honkVehicleHorn() {
    const av = this.level?.vehicles?.activeVehicle;
    if (!av || this.hornCd > 0) return;
    this.hornCd = 0.35;
    this.vehAudio.horn(0.28);
    this.level?.pedestrians?.onVehicleHorn(av.pos.x, av.pos.z);
  }

  launchNearbyContract() {
    if (!this.nearbyContractSpot) return;
    const threshold = Math.max(1, loadSave().unlocked);
    if (this.nearbyContractSpot.missionId > threshold) {
      this.activityToast = {
        title: `Contract C${this.nearbyContractSpot.missionId} Locked`,
        subtitle: `Complete Contract C${this.nearbyContractSpot.missionId - 1} first`,
        accent: "#f87171",
      };
      this.activityToastTimer = 3.0;
      this.emitHud();
      return;
    }
    this.launchContractFromOpenWorld(this.nearbyContractSpot.missionId);
  }

  launchContractFromOpenWorld(missionId: number) {
    if (!this.cb) return;
    if (document.pointerLockElement) document.exitPointerLock();
    this.paused = false;
    this.pausedRendered = false;
    void this.startMission(missionId, this.cb, { fromOpenWorld: true });
  }

  continueInOpenWorld() {
    if (this.mission?.id !== -1) return;
    this.phase = "ready";
    this.paused = false;
    this.pausedRendered = false;
    this.emitHud();
    this.requestLock(true);
  }

  async returnToOpenWorld() {
    if (!this.cb) return;
    if (this.mission?.id === -1) {
      this.continueInOpenWorld();
      return;
    }
    if (document.pointerLockElement) document.exitPointerLock();
    const ret = this.openWorldReturnSpot;
    this.openWorldReturnSpot = null;
    this.paused = false;
    this.pausedRendered = false;
    await this.startMission(-1, this.cb);
    if (ret && !this.disposed) {
      this.teleportTo(ret.x, ret.z, ret.yawDeg);
    }
  }

  teleportTo(x: number, z: number, yawDeg?: number, maxY = 250) {
    if (!this.rig || !this.level) return;
    if (this.activeApartmentId) {
      this.activeApartmentId = null;
      this.level.apartments?.setActiveApartment(null);
    }
    if (this.activeGarageId) {
      this.activeGarageId = null;
      this.level.apartments?.setActiveGarage(null);
    }
    if (this.level.vehicles?.activeVehicle) {
      this.level.vehicles.exitVehicle();
      this.rig.setVisible(true);
    }
    if (this.level.openWorld) this.level.openWorld.chunks.prewarm(x, z);
    const gy = this.level.groundHeightAt(x, z, maxY);
    this.rig.root.position.set(x, gy, z);
    this.rig.groundY = gy;
    if (yawDeg !== undefined) {
      const r = THREE.MathUtils.degToRad(yawDeg);
      this.rig.aimYaw = r;
      this.yaw = this.camYaw = r;
    }
    this.level.update(0.016, this.rig.root.position);
    if (this.mission?.id === -1 && this.level.activities) {
      const nearC = this.level.activities.findNearbyContract(this.rig.root.position, 11.5);
      this.nearbyContractSpot = nearC
        ? { missionId: nearC.missionId, x: nearC.x, z: nearC.z, yawDeg: nearC.yawDeg }
        : null;
    } else {
      this.nearbyContractSpot = null;
    }
    this.updateHomeStations();
    this.emitHud();
  }

  getMinimapData(): MinimapData | null {
    return this.level?.minimapData ?? null;
  }

  getMinimapSample(maxRadius = 420): {
    x: number;
    z: number;
    heading: number;
    driving: boolean;
    speedKmh: number;
    vehicles: { x: number; z: number; isNpc: boolean; active: boolean; name?: string }[];
    traps: { id: string; x: number; z: number; beaten: boolean; bestKmh?: number }[];
    contracts: { missionId: number; x: number; z: number; unlocked: boolean; completed: boolean }[];
    police: { x: number; z: number; isSwat: boolean }[];
    garages: { id: string; name: string; x: number; z: number }[];
    stores: { id: string; name: string; x: number; z: number }[];
    races: { id: string; name: string; x: number; z: number }[];
    stunts: { id: string; name: string; x: number; z: number; completed: boolean }[];
    aircraft: { id: string; name: string; kind: "helicopter" | "airplane"; x: number; z: number }[];
    boats: { id: string; name: string; x: number; z: number; isStarter?: boolean }[];
    stashes: { x: number; z: number; collected: boolean }[];
    raceCheckpoint: { x: number; z: number } | null;
    randomEvent: { x: number; z: number; kind: string; title: string } | null;
    surveillanceTarget: { x: number; z: number; name: string; isolated: boolean; stage: string } | null;
  } | null {
    if (!this.rig || this.mission?.id !== -1) return null;
    const vehiclesMgr = this.level?.vehicles;
    const activeVeh = vehiclesMgr?.activeVehicle ?? null;
    const activeAir = this.level?.aircraft?.activeAircraft ?? null;
    const activeBoat = this.level?.boats?.activeBoat ?? null;
    const x = activeAir ? activeAir.pos.x : activeBoat ? activeBoat.pos.x : activeVeh ? activeVeh.pos.x : this.rig.root.position.x;
    const z = activeAir ? activeAir.pos.z : activeBoat ? activeBoat.pos.z : activeVeh ? activeVeh.pos.z : this.rig.root.position.z;
    const rawYaw = activeAir ? activeAir.yaw : activeBoat ? activeBoat.yaw : activeVeh ? activeVeh.yaw : this.camYaw;
    const heading = Math.atan2(Math.sin(rawYaw), -Math.cos(rawYaw));

    const nearbyVehicles: { x: number; z: number; isNpc: boolean; active: boolean; name?: string }[] = [];
    if (vehiclesMgr) {
      const r2 = maxRadius * maxRadius;
      for (const v of vehiclesMgr.vehicles) {
        if (v === activeVeh) continue;
        const dx = v.pos.x - x;
        const dz = v.pos.z - z;
        if (dx * dx + dz * dz < r2) {
          nearbyVehicles.push({
            x: v.pos.x,
            z: v.pos.z,
            isNpc: v.isNpcTraffic,
            active: false,
            name: v.spec.name,
          });
        }
      }
    }
    const traps = this.level?.activities ? this.level.activities.getTrapSummaries() : [];
    const contracts = this.level?.activities ? this.level.activities.getContractSummaries() : [];
    const police = this.level?.wanted ? this.level.wanted.getCruiserBlips() : [];
    const garages = this.level?.shops ? this.level.shops.getGarageSummaries() : [];
    const stores = this.level?.shops ? this.level.shops.getStoreSummaries() : [];
    const races = this.level?.activities ? this.level.activities.getRaceSummaries() : [];
    const stunts = this.level?.activities ? this.level.activities.getStuntSummaries() : [];
    const aircraft = this.level?.aircraft ? this.level.aircraft.getBlips() : [];
    const boats = this.level?.boats ? this.level.boats.getBlips() : [];
    const stashes = this.level?.collectibles ? this.level.collectibles.getStashBlips() : [];
    const ar = this.level?.activities?.getActiveRaceState() ?? null;
    const raceCheckpoint = ar
      ? ar.nextCheckpoint
      : this.activeContract?.stage === "travel"
        ? { x: this.activeContract.site.approachX, z: this.activeContract.site.approachZ }
        : null;
    const randomEvent = this.level?.randomEvents ? this.level.randomEvents.getActiveBlip() : null;
    const surv = this.rig ? this.level?.contracts?.getHudState(this.rig.root.position) ?? null : null;
    const surveillanceTarget = surv
      ? {
          x: surv.stage === "dispose" ? -860 : surv.targetX,
          z: surv.stage === "dispose" ? 280 : surv.targetZ,
          name: surv.stage === "dispose" ? "Deep Sea Disposal" : surv.targetName,
          isolated: surv.isolatedWindow,
          stage: surv.stage,
        }
      : null;
    return {
      x,
      z,
      heading,
      driving: !!(activeVeh || activeAir || activeBoat),
      speedKmh: activeAir
        ? Math.round(activeAir.speed * 3.6)
        : activeBoat
          ? Math.round(Math.abs(activeBoat.speed) * 3.6)
          : activeVeh
            ? Math.round(Math.abs(activeVeh.speed) * 3.6)
            : 0,
      vehicles: nearbyVehicles,
      traps,
      contracts,
      police,
      garages,
      stores,
      races,
      stunts,
      aircraft,
      boats,
      stashes,
      raceCheckpoint,
      randomEvent,
      surveillanceTarget,
    };
  }

  /* ------------------------------------------------------------ */
  private emitHud() {
    this.syncCursorStyle();
    const r = this.rig;
    const mission = this.mission;
    if (r && this.weaponAmmo[this.weaponIdx]) {
      this.weaponAmmo[this.weaponIdx].mag = r.mag;
      this.weaponAmmo[this.weaponIdx].reserve = r.reserve;
    }
    const w = WEAPONS[this.weaponIdx];
    const zoomFactor = 62 / Math.max(10, this.camera.fov);
    let maxSusp = 0;
    let compromised = false;
    let caution = false;
    const stealthIndicators: HudState["stealthIndicators"] = [];
    for (let ei = 0; ei < this.enemies.length; ei++) {
      const e = this.enemies[ei];
      if (e.isDead) continue;
      if (e.state === "attack") compromised = true;
      else if (e.state === "alert") caution = true;
      if (e.suspicion > maxSusp) maxSusp = e.suspicion;
      if (r && (e.suspicion > 0.03 || e.state === "alert" || e.state === "attack")) {
        const dx = e.rig.root.position.x - r.root.position.x;
        const dz = e.rig.root.position.z - r.root.position.z;
        const dotFwd = dx * Math.sin(this.camYaw) + dz * Math.cos(this.camYaw);
        const dotRgt = dx * -Math.cos(this.camYaw) + dz * Math.sin(this.camYaw);
        stealthIndicators.push({
          id: ei,
          angle: Math.atan2(dotRgt, dotFwd),
          suspicion: e.state === "attack" ? 1 : clamp(e.suspicion, 0, 1),
          state: e.state === "dead" ? "idle" : e.state,
          seeing: e.isSeeingPlayer,
        });
      }
    }
    if (mission?.id === -1 && this.level?.pedestrians) {
      for (const bw of this.level.pedestrians.bodyWitnessIndicators) {
        if (bw.state === "attack") compromised = true;
        else if (bw.state === "alert" || bw.suspicion >= 0.12) caution = true;
        if (bw.suspicion > maxSusp) maxSusp = bw.suspicion;
        stealthIndicators.push(bw);
      }
    }
    stealthIndicators.sort((a, b) => b.suspicion - a.suspicion);
    if (stealthIndicators.length > 5) stealthIndicators.length = 5;
    const stealthState: HudState["stealthState"] = compromised ? "compromised" : caution || maxSusp >= 0.12 ? "caution" : "hidden";
    const takedownReady = this.findTakedownTarget() !== null;
    const interact = this.activeInteract && !this.activeInteract.done
      ? {
          label: this.activeInteract.def.label,
          kind: this.activeInteract.def.kind,
          progress: clamp(this.interactHoldT / Math.max(0.1, this.activeInteract.def.duration), 0, 1),
          holding: this.keys.has("KeyF") && this.interactHoldT > 0.01,
        }
      : null;
    const extractReady = this.activeContract
      ? this.activeContract.stage === "escape"
      : !!mission &&
        !mission.practice &&
        this.objectives.some((o) => o.id === "extract") &&
        this.objectives.filter((o) => o.id !== "extract").every((o) => o.done) &&
        !this.objectives.find((o) => o.id === "extract")?.done;
    let extractDist: number | null = null;
    let extractDirAngle: number | null = null;
    if (extractReady && mission && r) {
      if (this.activeContract) {
        const site = this.activeContract.site;
        const dxAway = r.root.position.x - site.x;
        const dzAway = r.root.position.z - site.z;
        const dSite = Math.hypot(dxAway, dzAway);
        extractDist = Math.max(0, Math.round(site.escapeRadius - dSite));
        const dotFwd = dxAway * Math.sin(this.camYaw) + dzAway * Math.cos(this.camYaw);
        const dotRgt = dxAway * -Math.cos(this.camYaw) + dzAway * Math.sin(this.camYaw);
        extractDirAngle = Math.atan2(dotRgt, dotFwd);
      } else {
        const dx = mission.extraction[0] - r.root.position.x;
        const dz = mission.extraction[1] - r.root.position.z;
        extractDist = Math.round(Math.hypot(dx, dz));
        const dotFwd = dx * Math.sin(this.camYaw) + dz * Math.cos(this.camYaw);
        const dotRgt = dx * -Math.cos(this.camYaw) + dz * Math.sin(this.camYaw);
        extractDirAngle = Math.atan2(dotRgt, dotFwd);
      }
    }
    const boss = this.bossEntity && !this.bossEntity.isDead && this.bossEntity.alerted
      ? {
          name: this.bossEntity.name || "Boss",
          hp: Math.max(1, this.bossEntity.hp),
          maxHp: this.bossEntity.maxHp,
          surged: this.bossEntity.hp <= this.bossEntity.maxHp * 0.5,
        }
      : null;
    const isOpenWorld = mission?.id === -1;
    const district = isOpenWorld && r && this.level?.getDistrictAt
      ? this.level.getDistrictAt(r.root.position.x, r.root.position.z)
      : null;
    const av = this.level?.vehicles?.activeVehicle ?? null;
    const vehMgr = this.level?.vehicles;
    const vehicle: HudState["vehicle"] = av
      ? {
          active: true,
          name: av.spec.name,
          kind: av.spec.klass,
          speedKmh: Math.round(Math.abs(av.speed) * 3.6),
          rpm: Math.round(av.physState?.rpm ?? this.engineHud?.rpm ?? 850),
          gear: av.physState?.gear ?? this.engineHud?.gear ?? 1,
          redline: av.physState?.redline ?? this.engineHud?.redline ?? 7000,
          nearbyName: null,
          signal: vehMgr?.signal ?? null,
          signalLit: vehMgr?.isSignalLit() ?? false,
          hpPct: Math.max(0, Math.round((av.hp / Math.max(1, av.maxHp)) * 100)),
          disabled: !!av.disabled,
          isPolice: !!av.isPolice,
          sirenOn: !!av.sirenOn,
        }
      : this.nearbyVehicleName
        ? {
            active: false,
            name: this.nearbyVehicleName,
            kind: "",
            speedKmh: 0,
            rpm: 0,
            gear: 0,
            redline: 7000,
            nearbyName: this.nearbyVehicleName,
            signal: null,
            signalLit: false,
            hpPct: 100,
            disabled: false,
            isPolice: false,
            sirenOn: false,
          }
        : null;
    const wSys = this.level?.wanted;
    const wanted: HudState["wanted"] = wSys && wSys.stars > 0
      ? {
          stars: wSys.stars,
          evading: wSys.evading,
          evasionPct: Math.round((1 - wSys.evasionTimer / Math.max(1, wSys.evasionMax)) * 100),
        }
      : null;
    const rSt = this.vehAudio.radio.currentStation;
    const radioStation = av ? { name: rSt.name, genre: rSt.genre } : null;
    const ar = this.level?.activities?.getActiveRaceState() ?? null;
    const activeRace: HudState["activeRace"] = ar
      ? {
          raceName: ar.race.name,
          checkpoint: ar.checkpointIdx + 1,
          totalCheckpoints: ar.race.checkpoints.length,
          place: ar.place,
          totalRacers: ar.totalRacers,
          elapsed: ar.elapsed,
        }
      : null;
    const weatherMode = this.level?.weather?.mode ?? "auto";
    const weatherLabel = this.level?.getWeatherLabel?.() ?? "Clear";
    const timeOfDay = this.level?.timeOfDay ?? "afternoon";
    const timeOfDayLabel = TIME_OF_DAY_LABELS[timeOfDay];
    const save = loadSave();
    const credits = save.currencies.credits;
    let nearbyContract: HudState["nearbyContract"] = null;
    if (isOpenWorld && this.nearbyContractSpot) {
      const cm = MISSIONS.find((mi) => mi.id === this.nearbyContractSpot!.missionId);
      if (cm) {
        nearbyContract = {
          missionId: cm.id,
          codename: cm.codename,
          name: cm.name,
          location: cm.location,
          unlocked: cm.id <= Math.max(1, save.unlocked),
          completed: !!save.records[cm.id]?.completed,
          accent: cm.accent,
        };
      }
    }
    let nextContractMarker: HudState["nextContractMarker"] = null;
    if (this.activeContract && r && this.level) {
      if (this.activeContract.stage === "travel") {
        const { def, site } = this.activeContract;
        const dx = site.approachX - r.root.position.x;
        const dz = site.approachZ - r.root.position.z;
        const dist = Math.round(Math.hypot(dx, dz));
        const dotFwd = dx * Math.sin(this.camYaw) + dz * Math.cos(this.camYaw);
        const dotRgt = dx * -Math.cos(this.camYaw) + dz * Math.sin(this.camYaw);
        const dirAngle = Math.atan2(dotRgt, dotFwd);
        const groundY = this.level.groundHeightAt(site.approachX, site.approachZ, 20);
        const proj = new THREE.Vector3(site.approachX, groundY + 4.8, site.approachZ).project(this.camera);
        const onScreen = proj.z >= -1 && proj.z <= 1 && Math.abs(proj.x) <= 0.94 && Math.abs(proj.y) <= 0.9;
        nextContractMarker = {
          missionId: def.id,
          codename: def.codename,
          name: def.name,
          district: site.districtLabel,
          dist,
          dirAngle,
          screenX: proj.x * 0.5 + 0.5,
          screenY: -proj.y * 0.5 + 0.5,
          onScreen,
          accent: def.accent,
        };
      }
    } else if (isOpenWorld && r && this.level?.activities) {
      const contracts = this.level.activities.getContractSummaries();
      const targetC =
        contracts.find((c) => c.missionId >= 1 && c.unlocked && !c.completed) ??
        contracts.find((c) => c.missionId === Math.min(MISSIONS.length - 1, Math.max(1, save.unlocked)));
      if (targetC) {
        const cm = MISSIONS.find((mi) => mi.id === targetC.missionId);
        if (cm) {
          const dx = targetC.x - r.root.position.x;
          const dz = targetC.z - r.root.position.z;
          const dist = Math.round(Math.hypot(dx, dz));
          const dotFwd = dx * Math.sin(this.camYaw) + dz * Math.cos(this.camYaw);
          const dotRgt = dx * -Math.cos(this.camYaw) + dz * Math.sin(this.camYaw);
          const dirAngle = Math.atan2(dotRgt, dotFwd);
          const groundY = this.level.groundHeightAt(targetC.x, targetC.z, 20);
          const proj = new THREE.Vector3(targetC.x, groundY + 4.8, targetC.z).project(this.camera);
          const onScreen = proj.z >= -1 && proj.z <= 1 && Math.abs(proj.x) <= 0.94 && Math.abs(proj.y) <= 0.9;
          nextContractMarker = {
            missionId: cm.id,
            codename: cm.codename,
            name: cm.name,
            district: cm.location,
            dist,
            dirAngle,
            screenX: (proj.x * 0.5 + 0.5),
            screenY: (-proj.y * 0.5 + 0.5),
            onScreen,
            accent: cm.accent,
          };
        }
      }
    }
    const hasOpenWorldReturn = (!isOpenWorld && this.openWorldReturnSpot !== null) || (isOpenWorld && this.phase === "complete");
    const hudMission = this.activeContract
      ? {
          id: this.activeContract.def.id,
          codename: this.activeContract.def.codename,
          name: this.activeContract.def.name,
          location: this.activeContract.site.districtLabel,
          timeOfDay: timeOfDayLabel,
          accent: this.activeContract.def.accent,
        }
      : mission
        ? { id: mission.id, codename: mission.codename, name: mission.name, location: mission.location, timeOfDay: mission.timeOfDay, accent: mission.accent }
        : null;
    this.onHud({
      loading: this.phase === "loading",
      progress: this.progress,
      phase: this.phase,
      mission: hudMission,
      objectives: this.objectives,
      dialogue: this.dialogue,
      boss,
      paused: this.paused,
      kills: this.killed,
      ammo: r?.mag ?? MAG_SIZE,
      reserve: r?.reserve ?? 120,
      health: this.health,
      maxHealth: this.maxHealth,
      armor: this.armor,
      maxArmor: this.maxArmor,
      status: r?.status ?? "Idle",
      speed: r?.speed ?? 0,
      reloading: r?.isReloading ?? false,
      reloadProgress: r?.reloadProgress ?? 0,
      locked: this.locked,
      dead: r?.dead ?? false,
      crouch: this.crouchToggle,
      ads: this.uiHeld.ads || this.mouseR,
      sprint: this.uiHeld.sprint,
      showcase: this.showcase,
      fps: this.fps,
      spread: this.spread,
      hitMarker: this.hitMarker,
      hitCrit: this.hitCrit,
      hitKill: this.hitKill,
      damageFlash: this.damageFlash,
      damageDirRad: this.damageDirRad,
      timeScale: this.timeScale,
      weaponIndex: this.weaponIdx,
      weaponName: w.name,
      weaponCategory: w.category,
      zoomFactor,
      suppressed: w.suppressed && this.getActiveWeaponMods(w.id).suppressed,
      stealthState,
      suspicion: Math.round(maxSusp * 100),
      stealthIndicators,
      stealthKills: this.stealthKills,
      alerts: this.alerts,
      takedownReady,
      interact,
      extractReady,
      extractDist,
      extractDirAngle,
      isOpenWorld,
      district,
      weatherMode,
      weatherLabel,
      timeOfDay,
      timeOfDayLabel,
      activityToast: this.activityToast,
      nearbyContract,
      nextContractMarker,
      hasOpenWorldReturn,
      cameraPreset: this.vehCam.preset,
      credits,
      muted: this.muted,
      sfxVolume: this.sfxVolume,
      engineVolume: this.engineVolume,
      aimSensitivity: this.aimSensitivity,
      invertY: this.invertY,
      holstered: this.holstered,
      weaponWheelOpen: this.weaponWheelOpen,
      mapOpen: this.mapOpen,
      phoneOpen: this.phoneOpen,
      phoneInitialTab: this.phoneInitialTab,
      activeApartment: this.activeApartmentId
        ? (() => {
            const a = APARTMENTS.find((ap) => ap.id === this.activeApartmentId);
            return a ? { id: a.id, name: a.name, address: a.address } : null;
          })()
        : null,
      activeGarage: this.activeGarageId
        ? (() => {
            const a = APARTMENTS.find((ap) => ap.id === this.activeGarageId);
            return a ? { id: a.id, name: a.name, address: a.address } : null;
          })()
        : null,
      homeStation: this.nearbyHomeStation
        ? {
            id: this.nearbyHomeStation.id,
            kind: this.nearbyHomeStation.kind,
            label: this.nearbyHomeStation.label,
            sublabel: this.nearbyHomeStation.sublabel,
            apartmentId: this.nearbyHomeStation.apartmentId,
            apartmentName: this.nearbyHomeStation.apartmentName,
            price: this.nearbyHomeStation.price,
            owned: this.nearbyHomeStation.owned,
            carId: this.nearbyHomeStation.carId,
          }
        : null,
      vehicle,
      wanted,
      radioStation,
      activeRace,
      aircraft: this.level?.aircraft?.activeAircraft
        ? {
            active: true,
            name: this.level.aircraft.activeAircraft.name,
            kind: this.level.aircraft.activeAircraft.kind,
            altitude: Math.max(0, Math.round(this.level.aircraft.activeAircraft.pos.y)),
            speedKmh: Math.round(this.level.aircraft.activeAircraft.speed * 3.6),
            throttlePct: Math.round(this.level.aircraft.activeAircraft.throttle * 100),
          }
        : null,
      boat: this.level?.boats?.activeBoat
        ? {
            active: true,
            name: this.level.boats.activeBoat.name,
            speedKmh: Math.round(Math.abs(this.level.boats.activeBoat.speed) * 3.6),
            hasBody: !!this.level.boats.activeBoat.stowedBody,
          }
        : null,
      carryingBody: !!this.level?.bodyCarry?.isCarrying,
      trunkBodiesCount: this.level?.vehicles?.activeVehicle?.trunkBodies?.length ?? 0,
      parachuting: this.parachuting,
      swimming: this.swimming,
      binoculars: {
        open: this.binocularsOpen,
        zoom: (["2.6x", "4.4x", "6.9x"][this.binocularsZoomIdx] ?? "2.6x"),
        rangeM: this.binocularsRangeM,
      },
      stashesFound: this.level?.collectibles?.stashesFound ?? 0,
      totalStashes: this.level?.collectibles?.totalStashes ?? 15,
      nearbyPrompt: this.nearbyPrompt,
      surveillance: this.rig ? this.level?.contracts?.getHudState(this.rig.root.position) ?? null : null,
      incomingCall: this.activeCall
        ? {
            id: this.activeCall.def.id,
            callerName: this.activeCall.def.callerName,
            callerRole: this.activeCall.def.callerRole,
            codename: this.activeCall.def.codename,
            transcript: this.activeCall.def.transcript,
            accent: this.activeCall.def.accent,
            status: this.activeCall.status,
          }
        : null,
      gtaDirective: this.computeGtaDirective(extractReady, extractDist, nextContractMarker),
      cinematic: this.cinematicState
        ? {
            kind: this.cinematicState.kind,
            codename: this.cinematicState.codename,
            title: this.cinematicState.title,
            subtitle: this.cinematicState.subtitle,
            accent: this.cinematicState.accent,
            progress: clamp(this.cinematicState.elapsed / Math.max(0.1, this.cinematicState.duration), 0, 1),
          }
        : null,
      weapons: WEAPONS.map((spec, i) => ({
        slot: spec.slot,
        shortName: spec.shortName,
        category: spec.category,
        mag: this.weaponAmmo[i]?.mag ?? spec.magSize,
        reserve: this.weaponAmmo[i]?.reserve ?? spec.reserveMax,
      })),
    });
  }

  private playPhoneRingTone() {
    if (this.muted) return;
    try {
      const ctx = this.sfx.ctx;
      if (!ctx) return;
      const now = ctx.currentTime;
      for (const offset of [0, 0.24]) {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "sine";
        osc.frequency.setValueAtTime(offset === 0 ? 784 : 988, now + offset);
        gain.gain.setValueAtTime(0.0001, now + offset);
        gain.gain.exponentialRampToValueAtTime(0.09, now + offset + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + offset + 0.19);
        osc.connect(gain).connect(ctx.destination);
        osc.start(now + offset);
        osc.stop(now + offset + 0.2);
      }
    } catch {}
  }

  startMissionCall(def: MissionCallDef, autoAnswerImmediately = false) {
    this.hangUpCall(false);
    this.activeCall = {
      def,
      status: autoAnswerImmediately ? "active" : "ringing",
      timer: autoAnswerImmediately ? Math.max(10, def.transcript.length * 0.068) : 1.15,
      ringT: 0,
      audio: null,
    };
    if (autoAnswerImmediately) {
      this.playCallAudio(this.activeCall);
    } else {
      this.playPhoneRingTone();
    }
    this.emitHud();
  }

  private playCallAudio(call: NonNullable<Game["activeCall"]>) {
    if (typeof window === "undefined") return;
    const speakFallback = () => {
      if (this.muted || typeof window === "undefined" || !("speechSynthesis" in window)) return;
      try {
        window.speechSynthesis.cancel();
        const utter = new SpeechSynthesisUtterance(call.def.transcript);
        utter.rate = 0.98;
        utter.pitch = call.def.gender === "female" ? 1.08 : 0.92;
        const voices = window.speechSynthesis.getVoices();
        const en = voices.filter((v) => v.lang.toLowerCase().startsWith("en"));
        const picked =
          en.find((v) =>
            call.def.gender === "female"
              ? /female|samantha|victoria|karen|zira|aria|jenny/i.test(v.name)
              : /male|daniel|alex|david|guy|ryan|mark/i.test(v.name),
          ) ?? en[0];
        if (picked) utter.voice = picked;
        utter.onend = () => {
          if (this.activeCall === call) this.hangUpCall(true);
        };
        window.speechSynthesis.speak(utter);
      } catch {}
    };

    try {
      const audio = new Audio(call.def.audioUrl);
      audio.volume = clamp(this.sfxVolume * 1.35, 0.35, 1.0);
      audio.muted = this.muted;
      call.audio = audio;
      audio.onloadedmetadata = () => {
        if (this.activeCall === call && Number.isFinite(audio.duration) && audio.duration > 1) {
          call.timer = audio.duration + 0.8;
        }
      };
      audio.onended = () => {
        if (this.activeCall === call) {
          this.hangUpCall(true);
        }
      };
      audio.onerror = () => {
        if (this.activeCall === call) {
          call.audio = null;
          speakFallback();
        }
      };
      void audio.play().catch(() => {
        if (this.activeCall === call) {
          call.audio = null;
          speakFallback();
        }
      });
    } catch {
      speakFallback();
    }
  }

  answerCall(openPhone = false) {
    if (!this.activeCall) return;
    if (this.activeCall.status === "ringing") {
      this.activeCall.status = "active";
      this.activeCall.timer = Math.max(12, this.activeCall.def.transcript.length * 0.068);
      this.playCallAudio(this.activeCall);
    }
    if (openPhone) {
      this.setPhoneOpen(true);
    } else {
      this.emitHud();
    }
  }

  hangUpCall(emit = true) {
    if (this.activeCall?.audio) {
      try {
        this.activeCall.audio.pause();
        this.activeCall.audio.src = "";
      } catch {}
    }
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      try {
        window.speechSynthesis.cancel();
      } catch {}
    }
    this.activeCall = null;
    if (emit) this.emitHud();
  }

  replayMissionCall(callId?: string) {
    const def =
      (callId ? MISSION_CALLS.find((c) => c.id === callId) : undefined) ??
      (this.activeContract ? getMissionCallForSurveillance(String(this.activeContract.def.id)) : undefined) ??
      (this.mission && this.mission.id >= 0 ? getMissionCallForMission(this.mission.id) : undefined) ??
      MISSION_CALLS[0];
    if (def) this.startMissionCall(def, true);
  }

  private updateMissionCall(dt: number) {
    const call = this.activeCall;
    if (!call) return;
    if (call.status === "ringing") {
      call.timer -= dt;
      call.ringT += dt;
      if (call.timer <= 0) {
        this.answerCall(false);
      }
    } else {
      call.timer -= dt;
      if (call.timer <= 0 && (!call.audio || call.audio.paused || call.audio.ended)) {
        this.hangUpCall(true);
      }
    }
  }

  private startIntroCinematic(def: MissionDef, focusPos: THREE.Vector3, yawRad: number, duration = 4.6, conseqTag?: string) {
    const fwdX = Math.sin(yawRad);
    const fwdZ = Math.cos(yawRad);
    const rightX = -fwdZ;
    const rightZ = fwdX;
    const startPos = new THREE.Vector3(
      focusPos.x + fwdX * 26 + rightX * 16,
      focusPos.y + 13.5,
      focusPos.z + fwdZ * 26 + rightZ * 16,
    );
    const startLook = new THREE.Vector3(
      focusPos.x + fwdX * 14,
      focusPos.y + 2.4,
      focusPos.z + fwdZ * 14,
    );
    this.cinematicState = {
      kind: "intro",
      codename: def.codename,
      title: def.name,
      subtitle: conseqTag ? `${def.location} · ${conseqTag}` : `${def.location} · ${def.timeOfDay}`,
      accent: def.accent,
      elapsed: 0,
      duration,
      startPos,
      startLook,
      endPos: focusPos.clone(),
      endLook: focusPos.clone(),
      usePlayerEnd: true,
    };
    this.emitHud();
  }

  private startExtractCinematic(def: MissionDef, focusPos: THREE.Vector3, onDone: () => void) {
    this.cinematicState = {
      kind: "extract",
      codename: def.codename,
      title: def.id === 6 ? "THE SOVEREIGN LEDGER CLOSED" : "EXTRACTION CONFIRMED",
      subtitle: `${def.name} · Wire Settled`,
      accent: def.accent,
      elapsed: 0,
      duration: 3.0,
      startPos: focusPos.clone(),
      startLook: focusPos.clone(),
      endPos: focusPos.clone(),
      endLook: focusPos.clone(),
      orbitFocus: focusPos.clone(),
      onDone,
    };
    this.emitHud();
  }

  skipCinematic() {
    if (!this.cinematicState) return;
    const cb = this.cinematicState.onDone;
    this.cinematicState = null;
    this.emitHud();
    cb?.();
  }

  private updateCinematic(dt: number) {
    const cine = this.cinematicState;
    if (!cine) return;
    cine.elapsed += dt;
    if (cine.elapsed >= cine.duration) {
      const cb = cine.onDone;
      this.cinematicState = null;
      this.emitHud();
      cb?.();
    }
  }

  private computeGtaDirective(
    extractReady: boolean,
    extractDist: number | null,
    nextContractMarker: HudState["nextContractMarker"],
  ): HudState["gtaDirective"] {
    if (this.phase !== "ready" || !this.rig || this.rig.dead) return null;
    const p = this.rig.root.position;
    const m = this.activeContract?.def ?? this.mission;
    if (!m) return null;

    if (m.id === 0) {
      return {
        verb: "CALIBRATE",
        text: "Shoot the steel range targets · Press [CTRL] to toggle stealth or [V] behind a target · Press [↑] for SkyPhone",
        accent: m.accent,
      };
    }

    // Open-world surveillance contract directive
    const surv = this.level?.contracts?.getHudState(p) ?? null;
    if (m.id === -1 && surv) {
      if (this.level?.bodyCarry?.isCarrying) {
        return {
          verb: "DISPOSE",
          text: "Carry the body to your Car Trunk [G] or Starter Boat [F], then dump it in deep ocean water [G]",
          subtext: `${surv.code} · Keep out of civilian sight`,
          accent: "#22d3ee",
        };
      }
      if (surv.strikeStatus === "DEAD") {
        return {
          verb: "HIDE BODY",
          text: `Pick up ${surv.targetName}'s body [G] and sink it in deep ocean water`,
          subtext: "Or press [↑] -> Harbor Master to summon your Starter Boat",
          accent: "#f59e0b",
          distM: surv.distanceMeters,
        };
      }
      if (surv.strikeStatus === "ISOLATED") {
        return {
          verb: "STRIKE NOW",
          text: `${surv.targetName} is ISOLATED — Sneak behind [CTRL] + [V] Takedown or use a suppressed shot`,
          subtext: `${surv.phaseLabel} · Zero witnesses nearby`,
          accent: "#34d399",
          distM: surv.distanceMeters,
        };
      }
      return {
        verb: "TAIL",
        text: `Follow ${surv.targetName} (${surv.phaseLabel}) and wait for an ISOLATED window`,
        subtext: `${surv.windowNote} · Press [Y] to advance clock 1 hour`,
        accent: "#fbbf24",
        distM: surv.distanceMeters,
      };
    }

    // Open-world travel phase before entering mission compound
    if (this.activeContract?.stage === "travel") {
      const site = this.activeContract.site;
      const distM = Math.round(Math.hypot(p.x - site.approachX, p.z - site.approachZ));
      return {
        verb: "GO TO",
        text: `Drive to ${m.name} in ${site.districtLabel}`,
        subtext: "Follow the gold beacon or check [M] Map",
        accent: m.accent,
        distM,
      };
    }

    // Extraction stage (Mission or Open-World Compound)
    if (extractReady) {
      return {
        verb: "ESCAPE",
        text: this.activeContract
          ? `Leave ${m.name} — move ${this.activeContract.site.escapeRadius}m clear of the compound`
          : `Go to the Extraction Point to complete ${m.codename}`,
        subtext: "Follow the green ▲ extraction marker",
        accent: "#2dd4bf",
        distM: extractDist,
      };
    }

    // Active step inside mission / compound
    const nextObj = this.objectives.find((o) => !o.done && o.id !== "extract" && o.id !== "travel");
    if (nextObj) {
      if (nextObj.id === "boss" && this.bossEntity && !this.bossEntity.isDead) {
        const distM = Math.round(p.distanceTo(this.bossEntity.rig.root.position));
        return {
          verb: "ELIMINATE",
          text: `Neutralize ${this.bossEntity.name || "the Target"}`,
          subtext: "Watch heavy armor & flanking guards",
          accent: "#ff3b30",
          distM,
        };
      }
      if (nextObj.id === "destroy") {
        return {
          verb: "DESTROY",
          text: `${nextObj.label} (${nextObj.progress}/${nextObj.total})`,
          subtext: "Shoot the marked red equipment crates / signal relays",
          accent: "#fb923c",
        };
      }
      if (nextObj.id === "rescue" && m.rescue) {
        const distM = Math.round(Math.hypot(p.x - m.rescue[0], p.z - m.rescue[1]));
        return {
          verb: "RESCUE",
          text: nextObj.label,
          subtext: "Follow the gold beacon to secure the VIP",
          accent: "#facc15",
          distM,
        };
      }
      // Nearest incomplete interactable matching this objective
      let nearestProp: InteractableInstance | null = null;
      let bestD = Infinity;
      const wp = new THREE.Vector3();
      for (const inst of this.interactables) {
        if (inst.done || inst.def.objId !== nextObj.id) continue;
        inst.group.getWorldPosition(wp);
        const d = p.distanceTo(wp);
        if (d < bestD) {
          bestD = d;
          nearestProp = inst;
        }
      }
      if (nearestProp) {
        const actionWord =
          nearestProp.def.kind === "terminal"
            ? "SCRUB"
            : nearestProp.def.kind === "diamond" || nearestProp.def.kind === "relic"
              ? "RECOVER"
              : "STEAL";
        const countTxt = nextObj.total > 1 ? ` (${nextObj.progress}/${nextObj.total})` : "";
        return {
          verb: actionWord,
          text: `${nearestProp.def.label}${countTxt} — Approach & hold [F]`,
          subtext: "Press [CTRL] to toggle stealth · [V] behind unaware guards",
          accent: m.accent,
          distM: Math.round(bestD),
        };
      }
      return {
        verb: "OBJECTIVE",
        text: nextObj.total > 1 ? `${nextObj.label} (${nextObj.progress}/${nextObj.total})` : nextObj.label,
        accent: m.accent,
      };
    }

    // Open-world free roam next mission prompt
    if (m.id === -1 && nextContractMarker) {
      return {
        verb: "NEXT CONTRACT",
        text: `Go to ${nextContractMarker.codename} (${nextContractMarker.name}) or press [↑] to open SkyPhone`,
        subtext: `${nextContractMarker.district} · Press [M] for full map`,
        accent: nextContractMarker.accent,
        distM: nextContractMarker.dist,
      };
    }
    return null;
  }

  dispose() {
    this.disposed = true;
    this.hangUpCall(false);
    this.stopDialogueAudio();
    this.navMesh?.dispose();
    this.navMesh = null;
    this.joltPhysics?.dispose();
    this.joltPhysics = null;
    cancelAnimationFrame(this.raf);
    this.cleanup.forEach((c) => c());
    this.ro?.disconnect();
    if (this.level) {
      disposeBvhForObjects(this.level.colliders);
      this.level.disposeExtra?.();
      this.level.vehicles?.dispose();
      this.level.openWorld?.dispose();
    }
    this.vehAudio.dispose();
    if (document.pointerLockElement) document.exitPointerLock();
    this.n8aoPass?.dispose();
    this.bloomEffect?.dispose();
    this.smaaEffect?.dispose();
    this.composer?.dispose();
    this.hangarEnv?.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
