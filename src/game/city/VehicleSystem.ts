import * as THREE from "three";
import { type VehicleKitWorldBridge } from "./OpenWorldEngine";
import { type TrafficLane } from "./RoadNetwork";
import {
  TRAFFIC_COLORS,
  getCar,
  getRealVehicleSpec,
  type CarId,
  type CarSpec,
  type NpcCarId,
  type TrafficId,
} from "../vehicles/catalog";
import { ModelLibrary, applyCarCustomization, setDoorsOpen } from "../vehicles/ModelLibrary";
import { VehicleCrashDeformer } from "../vehicles/damage/VehicleDamage";
import { TireSkidmarks } from "../vehicles/effects/TireSkidmarks";
import { applyWheelSuspension, spinWheels } from "../vehicles/wheels";
import {
  createVehicleSuspensionState,
  stepVehicleSuspension,
  type VehicleSuspensionState,
} from "../vehicles/suspension";
import { addVehicleLights, disposeVehicleLights, updateVehicleLights } from "../vehicles/vehicleLights";
import { chooseTrafficPaint } from "../vehicles/traffic-appearance.mjs";
import { chooseLocationTrafficModel } from "../vehicles/trafficSpawn";
import { coastLineX, getDistrictAt } from "./WestgateTerrain";
import type { TireSurfaceKind } from "../vehicles/RoadSpray";
import {
  createOvertakeVehicleState,
  stepFreeRoamVehicle,
  syncVehiclePhysicsFromWorld,
  type OvertakeVehicleState,
} from "../vehicles/physics";
import { APARTMENTS, DEFAULT_CAR_CUSTOM, getCarCustomConfig, loadSave } from "../progression";
import { SAFEHOUSE_CAR_SPOT, SAFEHOUSE_SPAWN } from "./SafehouseResidence";
import { WESTGATE_CONTRACT_SPOTS } from "./WestgateActivities";
import { WESTGATE_TELEPORTS } from "./WestgateMeta";
import { clamp, damp, dampAngle, lerp, smoothstep, wrapAngle } from "../../character/math";
import type { TrafficSignalManager } from "./TrafficSignals";
import type { PedVehicleQuery } from "./PedestrianSystem";
import type { DeadBodyRecord } from "./BodyCarrySystem";

export type VehicleClass = CarId;

export interface VehicleInput {
  throttle: number; // -1..1
  steer: number; // -1..1 (+1 = left, -1 = right)
  handbrake: boolean;
}

export interface DriveableVehicle {
  id: string;
  modelId: TrafficId;
  spec: CarSpec;
  length: number;
  width: number;
  height: number;
  mass: number;
  group: THREE.Group;
  modelRoot: THREE.Group | null;
  wheels: THREE.Mesh[];
  pos: THREE.Vector3;
  yaw: number;
  speed: number; // m/s signed
  steerAngle: number;
  physState: OvertakeVehicleState;
  isNpcTraffic: boolean;
  spawnDistrict?: string;
  lane?: TrafficLane | null;
  laneT: number;
  laneSpeed: number;
  driverActive: boolean;
  paintHex?: number;
  doorAnim: number;
  doorTimer: number;
  vx: number;
  vz: number;
  yawVel: number;
  crashVx: number;
  crashVz: number;
  crashTimer: number;
  npcBraking?: boolean;
  npcSignal?: "left" | "right" | null;
  turnCurve?: THREE.CubicBezierCurve3 | null;
  turnLen?: number;
  turnT?: number;
  turnNextLane?: TrafficLane | null;
  turnNextStartT?: number;
  upcomingNextLane?: TrafficLane | null;
  upcomingTurnDir?: "left" | "right" | null;
  roundaboutExitLane?: TrafficLane | null;
  roundaboutExitT?: number;
  npcSeed?: number;
  hp: number;
  maxHp: number;
  disabled?: boolean;
  exploded?: boolean;
  surfaceKind?: TireSurfaceKind;
  isParked?: boolean;
  isScriptedContract?: boolean;
  isPolice?: boolean;
  sirenOn?: boolean;
  lightbar?: { red: THREE.Mesh; blue: THREE.Mesh; matR: THREE.MeshStandardMaterial; matB: THREE.MeshStandardMaterial } | null;
  vy?: number;
  airborne?: boolean;
  lastGroundY?: number;
  suspension: VehicleSuspensionState;
  deformer: VehicleCrashDeformer;
  trunkBodies?: DeadBodyRecord[];
}

const TRUCK_SPECS: Record<"semi" | "kraz", CarSpec> = {
  semi: {
    id: "rangerover",
    name: "Tractor Trailer",
    maker: "Freightliner",
    tagline: "Heavy highway hauler.",
    klass: "Heavy Truck",
    price: 0,
    maxSpeed: 32,
    accel: 4.5,
    handling: 3.0,
    stats: { speed: 2, handling: 2, grip: 3 },
    color: "#334155",
    physics: {
      grip: 0.88,
      brake: 8.5,
      wheelbase: 5.2,
      maxSteer: 0.38,
      understeer: 0.004,
      yawResponse: 3.8,
      steerResponse: 4.2,
      drag: 0.0012,
    },
  },
  kraz: {
    id: "rangerover",
    name: "KrAZ Heavy Truck",
    maker: "KrAZ",
    tagline: "6x6 industrial utility truck.",
    klass: "Heavy Truck",
    price: 0,
    maxSpeed: 30,
    accel: 4.8,
    handling: 3.2,
    stats: { speed: 2, handling: 2, grip: 4 },
    color: "#4d5d43",
    physics: {
      grip: 0.92,
      brake: 8.8,
      wheelbase: 4.6,
      maxSteer: 0.4,
      understeer: 0.004,
      yawResponse: 4.0,
      steerResponse: 4.5,
      drag: 0.0012,
    },
  },
};

const NPC_SPECS: Record<NpcCarId, CarSpec> = {
  compact: {
    id: "golf",
    name: "Civic Compact",
    maker: "Westgate Motors",
    tagline: "Reliable everyday commuter.",
    klass: "Economy Sedan",
    price: 0,
    maxSpeed: 42,
    accel: 6.8,
    handling: 6.4,
    stats: { speed: 2, handling: 4, grip: 3 },
    color: "#90afd1",
    physics: {
      grip: 0.96,
      brake: 9.8,
      wheelbase: 2.58,
      maxSteer: 0.52,
      understeer: 0.005,
      yawResponse: 6.4,
      steerResponse: 6.8,
      drag: 0.00085,
    },
  },
  hatch: {
    id: "golf",
    name: "City Hatchback",
    maker: "Westgate Motors",
    tagline: "Nimble compact 5-door runabout.",
    klass: "Subcompact",
    price: 0,
    maxSpeed: 40,
    accel: 6.6,
    handling: 6.8,
    stats: { speed: 2, handling: 4, grip: 3 },
    color: "#b4c4d1",
    physics: {
      grip: 0.97,
      brake: 9.8,
      wheelbase: 2.38,
      maxSteer: 0.54,
      understeer: 0.005,
      yawResponse: 6.8,
      steerResponse: 7.2,
      drag: 0.00088,
    },
  },
  sedan: {
    id: "golf",
    name: "Thunderbolt '96",
    maker: "Westgate Motors",
    tagline: "Classic 90s four-door saloon.",
    klass: "Everyday Sedan",
    price: 0,
    maxSpeed: 45,
    accel: 7.2,
    handling: 6.0,
    stats: { speed: 3, handling: 3, grip: 3 },
    color: "#4d78b0",
    physics: {
      grip: 0.96,
      brake: 10.0,
      wheelbase: 2.6,
      maxSteer: 0.5,
      understeer: 0.0045,
      yawResponse: 6.2,
      steerResponse: 6.6,
      drag: 0.00084,
    },
  },
  crossover: {
    id: "rangerover",
    name: "Family Crossover",
    maker: "Westgate Motors",
    tagline: "Practical five-seat daily SUV.",
    klass: "Crossover SUV",
    price: 0,
    maxSpeed: 41,
    accel: 6.4,
    handling: 5.4,
    stats: { speed: 2, handling: 3, grip: 4 },
    color: "#cbd5e1",
    physics: {
      grip: 0.98,
      brake: 9.6,
      wheelbase: 2.65,
      maxSteer: 0.48,
      understeer: 0.004,
      yawResponse: 5.5,
      steerResponse: 6.0,
      drag: 0.00098,
    },
  },
  offroad: {
    id: "rangerover",
    name: "Bokaroo 4x4",
    maker: "Westgate Motors",
    tagline: "Boxy utility wagon built for hills and dirt.",
    klass: "Utility 4x4",
    price: 0,
    maxSpeed: 42,
    accel: 6.8,
    handling: 5.2,
    stats: { speed: 2, handling: 3, grip: 4 },
    color: "#6b7d65",
    physics: {
      grip: 1.0,
      brake: 9.8,
      wheelbase: 2.62,
      maxSteer: 0.46,
      understeer: 0.0035,
      yawResponse: 5.4,
      steerResponse: 5.8,
      drag: 0.001,
    },
  },
  taxi: {
    id: "golf",
    name: "Westgate Taxi",
    maker: "Westgate Cab Co.",
    tagline: "Yellow city fleet cab.",
    klass: "City Taxi",
    price: 0,
    maxSpeed: 43,
    accel: 7.0,
    handling: 6.2,
    stats: { speed: 2, handling: 3, grip: 3 },
    color: "#eab308",
    physics: {
      grip: 0.96,
      brake: 10.0,
      wheelbase: 2.58,
      maxSteer: 0.52,
      understeer: 0.0045,
      yawResponse: 6.3,
      steerResponse: 6.8,
      drag: 0.00086,
    },
  },
  police_cruiser: {
    id: "audi",
    name: "Patrol Cruiser",
    maker: "WBPD Fleet",
    tagline: "Standard black-and-white city patrol car.",
    klass: "Police Cruiser",
    price: 0,
    maxSpeed: 52,
    accel: 8.4,
    handling: 6.4,
    stats: { speed: 4, handling: 4, grip: 4 },
    color: "#1e293b",
    physics: {
      grip: 1.02,
      brake: 10.8,
      wheelbase: 2.68,
      maxSteer: 0.5,
      understeer: 0.0035,
      yawResponse: 6.6,
      steerResponse: 7.0,
      drag: 0.0008,
    },
  },
  van: {
    id: "rangerover",
    name: "City Utility Van",
    maker: "Westgate Fleet",
    tagline: "Panel cargo van serving local shops and contractors.",
    klass: "Utility Van",
    price: 0,
    maxSpeed: 40,
    accel: 6.2,
    handling: 5.2,
    stats: { speed: 2, handling: 3, grip: 3 },
    color: "#e2e8f0",
    physics: {
      grip: 0.96,
      brake: 9.5,
      wheelbase: 2.68,
      maxSteer: 0.46,
      understeer: 0.004,
      yawResponse: 5.2,
      steerResponse: 5.6,
      drag: 0.001,
    },
  },
  delivery: {
    id: "rangerover",
    name: "Westgate Box Truck",
    maker: "Westgate Freight",
    tagline: "Commercial box truck hauling port and retail freight.",
    klass: "Box Truck",
    price: 0,
    maxSpeed: 36,
    accel: 5.2,
    handling: 4.6,
    stats: { speed: 2, handling: 2, grip: 3 },
    color: "#f8fafc",
    physics: {
      grip: 0.94,
      brake: 8.8,
      wheelbase: 3.1,
      maxSteer: 0.44,
      understeer: 0.0045,
      yawResponse: 4.6,
      steerResponse: 5.0,
      drag: 0.0012,
    },
  },
  garbage_truck: {
    id: "rangerover",
    name: "Sanitation Truck",
    maker: "Westgate Sanitation",
    tagline: "Heavy municipal compactor truck.",
    klass: "Municipal Truck",
    price: 0,
    maxSpeed: 33,
    accel: 4.6,
    handling: 4.2,
    stats: { speed: 1, handling: 2, grip: 3 },
    color: "#16a34a",
    physics: {
      grip: 0.93,
      brake: 8.4,
      wheelbase: 3.3,
      maxSteer: 0.42,
      understeer: 0.005,
      yawResponse: 4.2,
      steerResponse: 4.6,
      drag: 0.0013,
    },
  },
  ambulance: {
    id: "rangerover",
    name: "EMS Ambulance",
    maker: "Westgate EMS",
    tagline: "Emergency medical responder stationed at St. Jude's.",
    klass: "Emergency",
    price: 0,
    maxSpeed: 46,
    accel: 7.4,
    handling: 5.6,
    stats: { speed: 3, handling: 3, grip: 4 },
    color: "#ffffff",
    physics: {
      grip: 1.0,
      brake: 10.2,
      wheelbase: 2.95,
      maxSteer: 0.48,
      understeer: 0.0035,
      yawResponse: 5.6,
      steerResponse: 6.0,
      drag: 0.00095,
    },
  },
  firetruck: {
    id: "rangerover",
    name: "Fire Engine",
    maker: "WBFD",
    tagline: "Heavy ladder and pumper truck.",
    klass: "Emergency",
    price: 0,
    maxSpeed: 40,
    accel: 5.8,
    handling: 4.4,
    stats: { speed: 2, handling: 2, grip: 3 },
    color: "#dc2626",
    physics: {
      grip: 0.96,
      brake: 9.0,
      wheelbase: 3.4,
      maxSteer: 0.42,
      understeer: 0.0045,
      yawResponse: 4.5,
      steerResponse: 5.0,
      drag: 0.0012,
    },
  },
};

function specFor(id: TrafficId): CarSpec {
  if (id === "semi" || id === "kraz") return TRUCK_SPECS[id];
  if (id in NPC_SPECS) return NPC_SPECS[id as NpcCarId];
  return getCar(id as CarId);
}

function massFor(id: TrafficId): number {
  if (id === "semi") return 6.5;
  if (id === "kraz" || id === "firetruck" || id === "garbage_truck") return 5.5;
  if (id === "delivery" || id === "ambulance") return 3.2;
  if (id === "rangerover" || id === "offroad" || id === "van") return 2.35;
  if (id === "crossover") return 1.95;
  if (id === "mercedes" || id === "audi" || id === "challenger" || id === "police_cruiser") return 1.78;
  if (id === "hatch" || id === "compact") return 1.28;
  return 1.5;
}

function buildFallbackMesh(
  id: TrafficId,
  colorHex: number,
): { placeholder: THREE.Group; wheels: THREE.Mesh[]; length: number; width: number } {
  const isTruck = id === "semi" || id === "kraz" || id === "firetruck" || id === "garbage_truck" || id === "delivery";
  const isSuv = id === "rangerover" || id === "audi" || id === "offroad" || id === "crossover" || id === "van" || id === "ambulance";
  const isCompact = id === "compact" || id === "hatch";
  const w = isTruck ? 2.45 : isSuv ? 2.05 : isCompact ? 1.78 : 1.9;
  const h = isTruck ? 2.85 : isSuv ? 1.58 : 1.32;
  const l =
    id === "semi"
      ? 10.5
      : id === "kraz"
        ? 7.2
        : id === "firetruck" || id === "garbage_truck"
          ? 6.3
          : id === "delivery" || id === "ambulance"
            ? 5.4
            : id === "hatch"
              ? 3.65
              : isCompact
                ? 4.2
                : 4.5;

  const group = new THREE.Group();
  const bodyMat = new THREE.MeshStandardMaterial({ color: colorHex, roughness: 0.35, metalness: 0.55 });
  const trimMat = new THREE.MeshStandardMaterial({ color: 0x181c22, roughness: 0.78, metalness: 0.15 });
  const glassMat = new THREE.MeshStandardMaterial({ color: 0x101822, roughness: 0.14, metalness: 0.6 });
  const wheelMat = new THREE.MeshStandardMaterial({ color: 0x141619, roughness: 0.85, metalness: 0.15 });

  const chassis = new THREE.Mesh(new THREE.BoxGeometry(w, h * 0.42, l), bodyMat);
  chassis.position.y = h * 0.36;
  chassis.castShadow = true;
  chassis.receiveShadow = true;
  group.add(chassis);

  const cabin = new THREE.Mesh(new THREE.BoxGeometry(w * 0.84, h * 0.38, l * (isTruck ? 0.34 : 0.48)), glassMat);
  cabin.position.set(0, h * 0.72, isTruck ? l * 0.28 : -l * 0.04);
  cabin.castShadow = true;
  group.add(cabin);

  const roof = new THREE.Mesh(new THREE.BoxGeometry(w * 0.82, 0.06, l * (isTruck ? 0.32 : 0.44)), bodyMat);
  roof.position.set(0, h * 0.92, isTruck ? l * 0.28 : -l * 0.04);
  group.add(roof);

  const bumper = new THREE.Mesh(new THREE.BoxGeometry(w * 0.96, 0.18, l + 0.08), trimMat);
  bumper.position.y = 0.24;
  group.add(bumper);

  const wheelGeo = new THREE.CylinderGeometry(0.36, 0.36, 0.26, 12);
  wheelGeo.rotateZ(Math.PI * 0.5);
  const wheels: THREE.Mesh[] = [];
  const wz = l * 0.32;
  const wx = w * 0.47;
  for (const [sx, sz] of [
    [-wx, wz],
    [wx, wz],
    [-wx, -wz],
    [wx, -wz],
  ]) {
    const wm = new THREE.Mesh(wheelGeo, wheelMat);
    wm.position.set(sx, 0.36, sz);
    group.add(wm);
    wheels.push(wm);
  }
  return { placeholder: group, wheels, length: l, width: w };
}

export class WestgateVehicleManager {
  readonly root = new THREE.Group();
  readonly vehicles: DriveableVehicle[] = [];
  activeVehicle: DriveableVehicle | null = null;

  private readonly library = new ModelLibrary();
  private readonly up = new THREE.Vector3(0, 1, 0);
  private readonly normalTmp = new THREE.Vector3();
  private readonly pitchQuat = new THREE.Quaternion();
  private readonly yawQuat = new THREE.Quaternion();
  private readonly streamingIds = new Set<TrafficId>();
  private readonly camLocalTmp = new THREE.Vector3();
  private readonly nearbyTmp: DriveableVehicle[] = [];
  readonly skidmarks = new TireSkidmarks();
  private disposed = false;
  signal: "left" | "right" | null = null;
  signalElapsed = 0;
  npcSignalClock = 0;
  lastImpact = 0;
  readonly lastCrashPos = new THREE.Vector3();
  readonly lastCrashNormal = new THREE.Vector3(0, 1, 0);
  lastCrashKind: "metal" | "concrete" = "metal";
  lastLanding = 0;
  readonly lastLandingPos = new THREE.Vector3();
  lastLandingBottomOut = false;
  activeDriftSlip = 0;
  activeSurfaceKind: TireSurfaceKind = "asphalt";
  activeWheelSlip = 0;
  onModelLoaded?: (id: TrafficId) => void;
  onCarjack?: (v: DriveableVehicle) => void;
  onVehicleExplode?: (v: DriveableVehicle) => void;
  onSmoke?: (pos: THREE.Vector3, burning: boolean) => void;
  onShatter?: (pos: THREE.Vector3, kind: "glass" | "detach") => void;
  onWaterSplash?: (pos: THREE.Vector3, intensity: number) => void;
  private smokeAcc = 0;
  private trafficSignals: TrafficSignalManager | null = null;
  private pedestrianAheadFn: ((x: number, z: number, fx: number, fz: number) => boolean) | null = null;

  setWorldActors(
    signals: TrafficSignalManager | null,
    pedAhead: ((x: number, z: number, fx: number, fz: number) => boolean) | null,
  ): void {
    this.trafficSignals = signals;
    this.pedestrianAheadFn = pedAhead;
  }

  getPedVehicleQueries(focusPos: { x: number; z: number }, maxRange = 135): PedVehicleQuery[] {
    const out: PedVehicleQuery[] = [];
    const r2 = maxRange * maxRange;
    for (let i = 0; i < this.vehicles.length; i++) {
      const v = this.vehicles[i];
      const dx = v.pos.x - focusPos.x;
      const dz = v.pos.z - focusPos.z;
      if (dx * dx + dz * dz > r2) continue;
      out.push({
        x: v.pos.x,
        y: v.pos.y,
        z: v.pos.z,
        vx: v.vx,
        vz: v.vz,
        speed: Math.abs(v.speed),
        halfW: v.width * 0.5,
        halfL: v.length * 0.5,
        isPlayer: v === this.activeVehicle,
      });
    }
    return out;
  }

  constructor(private readonly bridge: VehicleKitWorldBridge) {
    this.root.name = "WestgateVehicles";
    this.root.add(this.skidmarks.mesh);
    this.spawnAll();
    if (typeof window !== "undefined" && typeof fetch === "function") {
      const save = loadSave();
      // Stream ONLY the player's selected car first, followed sequentially (2-at-a-time)
      // by the lightweight NPC road fleet. Heavy dealership/exotic cars (Audi, Challenger,
      // Ferrari, R8, Mustang, Mercedes, Range Rover) stream lazily when near the player or summoned.
      void (async () => {
        await this.streamModel(save.selectedCar);
        if (this.disposed) return;
        const npcFleet: TrafficId[] = [
          "compact",
          "hatch",
          "sedan",
          "crossover",
          "taxi",
          "offroad",
          "police_cruiser",
          "semi",
          "kraz",
        ];
        const queue = npcFleet.filter((id) => id !== save.selectedCar);
        for (let i = 0; i < queue.length; i += 2) {
          if (this.disposed) return;
          await Promise.all([
            this.streamModel(queue[i]),
            queue[i + 1] ? this.streamModel(queue[i + 1]) : Promise.resolve(),
          ]);
        }
      })();
    }
  }

  private pendingAttachIds = new Set<TrafficId>();

  private async streamModel(id: TrafficId): Promise<void> {
    if (this.disposed || this.streamingIds.has(id) || this.library.has(id)) return;
    this.streamingIds.add(id);
    try {
      const loaded = await this.library.loadModel(id);
      if (this.disposed || !loaded) return;
      for (const v of this.vehicles) {
        if (v.modelId === id && !v.modelRoot && !v.isNpcTraffic) {
          this.attachLoadedModel(v);
        }
      }
      this.pendingAttachIds.add(id);
      this.onModelLoaded?.(id);
    } finally {
      this.streamingIds.delete(id);
    }
  }

  getModelLibrary(): ModelLibrary {
    return this.library;
  }

  private isPersonalCar(v: DriveableVehicle): boolean {
    return !v.isNpcTraffic && (v.id.endsWith("_0") || v.id.endsWith("_personal"));
  }

  private attachLoadedModel(v: DriveableVehicle): void {
    const isPersonal = this.isPersonalCar(v);
    const custom = isPersonal ? getCarCustomConfig(loadSave(), v.modelId as CarId) : undefined;
    const model = this.library.create(v.modelId, {
      paint: v.paintHex,
      player: isPersonal,
      custom,
    });
    if (!model) return;
    // Clear placeholder meshes
    while (v.group.children.length > 0) {
      const ch = v.group.children[0];
      v.group.remove(ch);
    }
    v.wheels.length = 0;

    // Overtake GLB models face -Z; rotate Math.PI so car nose aligns with +Z road yaw
    model.rotation.y = Math.PI;
    addVehicleLights(model, v.modelId, v.isNpcTraffic);
    v.modelRoot = model;
    v.group.add(model);

    const meta = this.library.get(v.modelId);
    if (meta) {
      v.length = meta.length;
      v.width = meta.width;
      v.height = meta.height;
    }
    v.deformer.attachModel(model, this.root);
    v.deformer.onShatter = (pos, kind) => this.onShatter?.(pos, kind);
    if (v.isPolice && !v.lightbar) {
      this.attachPoliceLightbar(v);
    }
  }

  attachPoliceLightbar(v: DriveableVehicle): void {
    const matR = new THREE.MeshStandardMaterial({ color: 0xef4444, emissive: 0xff1a1a, emissiveIntensity: 0.4, roughness: 0.2 });
    const matB = new THREE.MeshStandardMaterial({ color: 0x3b82f6, emissive: 0x1d7bff, emissiveIntensity: 0.4, roughness: 0.2 });
    const housingMat = new THREE.MeshStandardMaterial({ color: 0x111827, roughness: 0.4, metalness: 0.7 });
    const bar = new THREE.Group();
    bar.userData.isLightbar = true;
    const roofY = v.height + 0.04;
    bar.position.set(0, roofY, -0.08);
    const mid = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.1, 0.22), housingMat);
    const red = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.12, 0.24), matR);
    red.position.x = -0.26;
    const blue = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.12, 0.24), matB);
    blue.position.x = 0.26;
    bar.add(mid, red, blue);
    v.group.add(bar);
    v.lightbar = { red, blue, matR, matB };
  }

  private raycaster = new THREE.Raycaster();
  private bulletHitExtraDmg = new WeakMap<DriveableVehicle, number>();

  damageVehicle(v: DriveableVehicle, amount: number, allowExplode = false): void {
    if (amount <= 0) return;
    if (v.disabled) {
      if (allowExplode) {
        const extra = (this.bulletHitExtraDmg.get(v) ?? 0) + amount;
        this.bulletHitExtraDmg.set(v, extra);
        if (extra >= 45 && !v.exploded) {
          v.exploded = true;
          this.onVehicleExplode?.(v);
        }
      }
      return;
    }
    v.hp = Math.max(0, v.hp - amount);
    if (v.hp <= 0 && !v.disabled) {
      v.disabled = true;
      v.sirenOn = false;
      v.isNpcTraffic = false;
      v.crashTimer = 0.9;
      v.yawVel += (Math.random() - 0.5) * 1.6;
      if (allowExplode) {
        v.exploded = true;
        v.group.traverse((o) => {
          const m = o as THREE.Mesh;
          if (m.isMesh && m.material && !Array.isArray(m.material)) {
            const std = m.material as THREE.MeshStandardMaterial;
            if (std.color && !m.userData.scorchedMat) {
              m.material = std.clone();
              (m.material as THREE.MeshStandardMaterial).color.multiplyScalar(0.22);
              (m.material as THREE.MeshStandardMaterial).roughness = 0.92;
              m.userData.scorchedMat = true;
            }
          }
        });
        this.onVehicleExplode?.(v);
      }
    }
  }

  repairVehicle(v: DriveableVehicle, newPaintHex?: number): void {
    v.hp = v.maxHp;
    v.disabled = false;
    v.exploded = false;
    this.bulletHitExtraDmg.delete(v);
    v.deformer.repairAll();
    if (newPaintHex !== undefined) {
      v.paintHex = newPaintHex;
      if (v.modelRoot) {
        applyCarCustomization(v.modelRoot, { ...DEFAULT_CAR_CUSTOM, paintHex: `#${newPaintHex.toString(16).padStart(6, "0")}` });
      }
    }
  }

  /**
   * Exact 3D mesh raycast against vehicles along a bullet ray.
   * Places a localized bullet hole decal on the struck panel without denting/warping the mesh or hiding headlights.
   */
  hitVehicleAlongRay(
    origin: THREE.Vector3,
    dir: THREE.Vector3,
    maxDist: number,
    bulletDamage: number,
    ignoreVehicle?: DriveableVehicle | null,
  ): { vehicle: DriveableVehicle; point: THREE.Vector3; normal: THREE.Vector3; distance: number; hitGlass: boolean } | null {
    let bestHit: {
      vehicle: DriveableVehicle;
      point: THREE.Vector3;
      normal: THREE.Vector3;
      distance: number;
      object: THREE.Object3D;
    } | null = null;

    this.raycaster.set(origin, dir);
    this.raycaster.near = 0.05;
    this.raycaster.far = maxDist;

    for (const v of this.vehicles) {
      if (v === ignoreVehicle || v.exploded || !v.group.visible) continue;
      // Broadphase sphere check against ray segment
      const dx = v.pos.x - origin.x;
      const dy = v.pos.y + v.height * 0.5 - origin.y;
      const dz = v.pos.z - origin.z;
      const proj = dx * dir.x + dy * dir.y + dz * dir.z;
      const rBroad = Math.max(v.width, v.length) * 0.68 + 0.6;
      if (proj < -rBroad || proj > maxDist + rBroad) continue;
      const perpSq = dx * dx + dy * dy + dz * dz - proj * proj;
      if (perpSq > rBroad * rBroad) continue;

      const targetRoot = v.modelRoot ?? v.group;
      targetRoot.updateMatrixWorld(true);
      const hits = this.raycaster.intersectObject(targetRoot, true);
      for (const h of hits) {
        const obj = h.object;
        if (!obj.visible) continue;
        if ((obj as THREE.Sprite).isSprite) continue;
        if (
          obj.name === "underbody_contact_shadow" ||
          obj.name === "contact-shadow" ||
          obj.name === "npc-headlight-beams" ||
          obj.name === "headlight-volumetric-mist" ||
          obj.name === "bullet_hole_decal"
        ) {
          continue;
        }
        if (bestHit && h.distance >= bestHit.distance) break;
        const n = h.face?.normal
          ? h.face.normal.clone().transformDirection(obj.matrixWorld).normalize()
          : dir.clone().negate();
        if (n.dot(dir) > 0) n.negate();
        bestHit = {
          vehicle: v,
          point: h.point.clone(),
          normal: n,
          distance: h.distance,
          object: obj,
        };
        break;
      }
    }

    if (!bestHit) return null;

    const { hitGlass, hitEngine } = bestHit.vehicle.deformer.applyBulletHit(
      bestHit.point,
      bestHit.normal,
      bestHit.object,
      bestHit.vehicle.pos,
      bestHit.vehicle.yaw,
    );
    const dmgScale = hitEngine ? 1.35 : hitGlass ? 0.45 : 0.85;
    // Allow explosion only if shot repeatedly after already disabled (fuel tank / engine fire cookoff)
    this.damageVehicle(bestHit.vehicle, bulletDamage * dmgScale, bestHit.vehicle.disabled);

    return {
      vehicle: bestHit.vehicle,
      point: bestHit.point,
      normal: bestHit.normal,
      distance: bestHit.distance,
      hitGlass,
    };
  }

  hitVehicleAtPoint(x: number, y: number, z: number, damage = 14, isExplosive = false): DriveableVehicle | null {
    for (const v of this.vehicles) {
      if (v.exploded) continue;
      if (y < v.pos.y - 0.2 || y > v.pos.y + v.height + 0.35) continue;
      const dx = x - v.pos.x;
      const dz = z - v.pos.z;
      const r = Math.max(v.width, v.length) * 0.52;
      if (dx * dx + dz * dz <= r * r) {
        if (isExplosive || damage >= 35) {
          const hitPt = new THREE.Vector3(x, y, z);
          const outNorm = new THREE.Vector3(dx, 0.1, dz).normalize();
          v.deformer.applyWorldImpact(hitPt, outNorm, v.pos, v.yaw, isExplosive ? 22 : 12);
        }
        this.damageVehicle(v, damage, isExplosive);
        return v;
      }
    }
    return null;
  }

  toggleActiveSiren(): boolean {
    const v = this.activeVehicle;
    if (!v || !v.isPolice) return false;
    v.sirenOn = !v.sirenOn;
    return !!v.sirenOn;
  }

  private createVehicle(
    id: string,
    modelId: TrafficId,
    pos: THREE.Vector3,
    yaw: number,
    opts: {
      paintHex?: number;
      isNpcTraffic: boolean;
      lane?: TrafficLane | null;
      laneT?: number;
      laneSpeed?: number;
      speed?: number;
    },
  ): DriveableVehicle {
    const spec = specFor(modelId);
    const paintHex = opts.paintHex ?? new THREE.Color(spec.color).getHex();
    const group = new THREE.Group();
    const fb = buildFallbackMesh(modelId, paintHex);
    fb.placeholder.visible = false;
    group.add(fb.placeholder);
    const initSpeed = opts.speed ?? 0;
    const isTruck =
      modelId === "semi" ||
      modelId === "kraz" ||
      modelId === "delivery" ||
      modelId === "firetruck" ||
      modelId === "garbage_truck";
    const isSuv = modelId === "rangerover" || modelId === "audi" || modelId === "van" || modelId === "ambulance";

    const realSpec = getRealVehicleSpec(modelId);
    const v: DriveableVehicle = {
      id,
      modelId,
      spec,
      length: fb.length,
      width: fb.width,
      height: isTruck ? 2.85 : isSuv ? 1.62 : 1.38,
      mass: realSpec.mass || massFor(modelId),
      group,
      modelRoot: null,
      wheels: fb.wheels,
      pos,
      yaw,
      speed: initSpeed,
      steerAngle: 0,
      physState: createOvertakeVehicleState(yaw, realSpec),
      isNpcTraffic: opts.isNpcTraffic,
      lane: opts.lane ?? null,
      laneT: opts.laneT ?? 0,
      laneSpeed: opts.laneSpeed ?? 0,
      driverActive: false,
      paintHex,
      doorAnim: 0,
      doorTimer: 0,
      vx: Math.sin(yaw) * initSpeed,
      vz: Math.cos(yaw) * initSpeed,
      yawVel: 0,
      crashVx: 0,
      crashVz: 0,
      crashTimer: 0,
      hp: isTruck ? 180 : isSuv ? 130 : 100,
      maxHp: isTruck ? 180 : isSuv ? 130 : 100,
      disabled: false,
      isParked: false,
      isPolice: false,
      sirenOn: false,
      lightbar: null,
      suspension: createVehicleSuspensionState(modelId, pos.y),
      deformer: new VehicleCrashDeformer(fb.width, fb.length, isTruck ? 2.85 : isSuv ? 1.62 : 1.38),
    };
    v.physState.speed = v.speed;

    if (this.library.has(modelId)) {
      this.attachLoadedModel(v);
    }

    this.syncTransform(v, 0);
    this.root.add(group);
    this.vehicles.push(v);
    return v;
  }

  private spawnAll(): void {
    const save = loadSave();
    const selectedId: CarId = save.selectedCar ?? "golf";
    const selectedPaintHex = save.carPaints[selectedId]
      ? new THREE.Color(save.carPaints[selectedId]!).getHex()
      : undefined;

    // 1. Hero playable spawns across Westgate Bay (player's personal car inside Safehouse garage + all 8 Overtake models)
    const heroSpawns: Array<{ modelId: TrafficId; x: number; z: number; yawDeg: number; paintHex?: number }> = [
      { modelId: selectedId, x: SAFEHOUSE_CAR_SPOT.x, z: SAFEHOUSE_CAR_SPOT.z, yawDeg: SAFEHOUSE_CAR_SPOT.yawDeg, paintHex: selectedPaintHex }, // Personal car parked in Safehouse garage bay
      { modelId: "rangerover", x: 146, z: 66, yawDeg: -90 }, // Police HQ Impound Lot
      { modelId: "audi", x: -395, z: -95, yawDeg: 90 }, // Midtown Grand Mall
      { modelId: "mercedes", x: -135, z: 332, yawDeg: -90 }, // Mirror Central Park
      { modelId: "ferrari", x: -718, z: 22, yawDeg: 180 }, // Del Sol Pier beachside plaza
      { modelId: "challenger", x: -108, z: -968, yawDeg: 110 }, // Observatory Summit
      { modelId: "mustang", x: 648, z: 432, yawDeg: 90 }, // East Seaport Terminal
      { modelId: "r8", x: -108, z: 855, yawDeg: 90 }, // South Airport Terminal
      { modelId: "golf", x: 36, z: -64, yawDeg: 25 }, // Downtown Legion Square
    ];

    heroSpawns.forEach((hs, idx) => {
      const tY = this.bridge.heightSystem.terrainHeightAt(hs.x, hs.z);
      const gy = this.bridge.groundHeightAt(hs.x, hs.z, tY + 1.8);
      const pos = new THREE.Vector3(hs.x, gy, hs.z);
      const yaw = THREE.MathUtils.degToRad(hs.yawDeg);
      const hv = this.createVehicle(`hero_${hs.modelId}_${idx}`, hs.modelId, pos, yaw, {
        paintHex: hs.paintHex,
        isNpcTraffic: false,
      });
      if (idx === 1) {
        // Police HQ Impound / Interceptor SUV
        hv.isPolice = true;
        hv.paintHex = 0x111827;
        this.attachPoliceLightbar(hv);
      }
    });

    // Extra service & emergency fleet parked at landmarks across Westgate Bay
    const serviceSpawns: Array<{ key: string; modelId: TrafficId; x: number; z: number; yawDeg: number; police?: boolean }> = [
      { key: "police_hq_cruiser", modelId: "police_cruiser", x: 182, z: 34, yawDeg: 90, police: true },
      { key: "st_judes_ambulance", modelId: "ambulance", x: -164, z: -188, yawDeg: 0 },
      { key: "downtown_firetruck", modelId: "firetruck", x: 148, z: -22, yawDeg: -90 },
      { key: "east_sanitation_truck", modelId: "garbage_truck", x: 585, z: 112, yawDeg: 90 },
      { key: "seaport_delivery_truck", modelId: "delivery", x: 632, z: 446, yawDeg: 0 },
    ];
    for (const sv of serviceSpawns) {
      const gy = this.bridge.groundHeightAt(sv.x, sv.z, this.bridge.heightSystem.terrainHeightAt(sv.x, sv.z) + 1.8);
      const veh = this.createVehicle(sv.key, sv.modelId, new THREE.Vector3(sv.x, gy, sv.z), THREE.MathUtils.degToRad(sv.yawDeg), {
        isNpcTraffic: false,
      });
      veh.isParked = true;
      if (sv.police) {
        veh.isPolice = true;
        this.attachPoliceLightbar(veh);
      }
    }

    // 2. Ambient NPC road traffic along Westgate Bay's 149 connected lanes (location & vehicle-value weighted)
    const spawns = this.bridge.sampleTrafficSpawnPoints(150, 18);
    const exclusionZones: Array<{ x: number; z: number }> = [
      { x: SAFEHOUSE_SPAWN[0], z: SAFEHOUSE_SPAWN[1] },
      ...WESTGATE_TELEPORTS.map((t) => ({ x: t.x, z: t.z })),
      ...WESTGATE_CONTRACT_SPOTS.map((c) => ({ x: c.x, z: c.z })),
      ...APARTMENTS.flatMap((a) => [
        { x: a.exitStreetPos.x, z: a.exitStreetPos.z },
        { x: a.garageExitPos.x, z: a.garageExitPos.z },
      ]),
    ];
    const isClearOfSpawns = (x: number, z: number, minDist = 16) => {
      const r2 = minDist * minDist;
      for (let i = 0; i < exclusionZones.length; i++) {
        const ez = exclusionZones[i];
        const dx = x - ez.x;
        const dz = z - ez.z;
        if (dx * dx + dz * dz < r2) return false;
      }
      return true;
    };
    const spawnedForAppearance: { s: number; id: string; paint: number }[] = [];
    const spawnedNearby: { x: number; z: number; id: TrafficId }[] = [];
    spawns.forEach((sp, idx) => {
      if (!isClearOfSpawns(sp.position.x, sp.position.z, 16)) return;
      const lane = this.bridge.roads.getLane(sp.laneId) ?? null;
      if (!lane) return;
      const district = getDistrictAt(sp.position.x, sp.position.z);
      const distMetric = sp.position.x + sp.position.z * 0.7;
      const modelId = chooseLocationTrafficModel(
        { districtId: district.id, roadTier: sp.tier, isParked: false },
        spawnedNearby,
        sp.position.x,
        sp.position.z,
      );
      const paintHex =
        modelId === "semi" ||
        modelId === "kraz" ||
        modelId === "taxi" ||
        modelId === "police_cruiser" ||
        modelId === "van" ||
        modelId === "delivery" ||
        modelId === "garbage_truck" ||
        modelId === "ambulance" ||
        modelId === "firetruck"
          ? undefined
          : chooseTrafficPaint(TRAFFIC_COLORS, spawnedForAppearance, distMetric);
      spawnedForAppearance.push({ s: distMetric, id: modelId, paint: paintHex ?? 0x475569 });
      spawnedNearby.push({ x: sp.position.x, z: sp.position.z, id: modelId });

      const pos = sp.position.clone();
      pos.y = this.bridge.groundHeightAt(pos.x, pos.z, pos.y + 1.0);
      const spec = specFor(modelId);
      const npcVeh = this.createVehicle(`npc_${idx}`, modelId, pos, sp.yaw, {
        paintHex,
        isNpcTraffic: true,
        lane,
        laneT: sp.t,
        laneSpeed: Math.min(sp.speedLimit * 0.85, spec.maxSpeed * 0.65),
        speed: Math.min(sp.speedLimit * 0.72, 10 + (idx % 4) * 2.2),
      });
      npcVeh.spawnDistrict = district.id;
    });

    // 3. Real Parked Street Cars across Westgate Bay's ParkedBaySlots (also location & value weighted)
    const bays = this.bridge.roads.getParkedBays();
    const parkedPlaced: Array<{ x: number; z: number; id: TrafficId }> = [];
    const bayStride = Math.max(1, Math.floor(bays.length / 80));
    for (let bi = 0; bi < bays.length && parkedPlaced.length < 60; bi += bayStride) {
      const bay = bays[bi];
      if (!isClearOfSpawns(bay.x, bay.z, 16)) continue;
      if (parkedPlaced.some((p) => (p.x - bay.x) * (p.x - bay.x) + (p.z - bay.z) * (p.z - bay.z) < 22 * 22)) continue;
      if (this.vehicles.some((v) => Math.hypot(v.pos.x - bay.x, v.pos.z - bay.z) < 10)) continue;
      const gy = this.bridge.groundHeightAt(bay.x, bay.z, bay.y + 1.5);
      if (gy < 2.0) continue;
      const district = getDistrictAt(bay.x, bay.z);
      const modelId = chooseLocationTrafficModel(
        { districtId: district.id, roadTier: "street", isParked: true },
        parkedPlaced,
        bay.x,
        bay.z,
      );
      const paintHex =
        modelId === "taxi" || modelId === "police_cruiser"
          ? undefined
          : TRAFFIC_COLORS[(bi * 3 + parkedPlaced.length) % TRAFFIC_COLORS.length];
      const pv = this.createVehicle(`parked_${parkedPlaced.length}`, modelId, new THREE.Vector3(bay.x, gy, bay.z), bay.yaw, {
        paintHex,
        isNpcTraffic: false,
      });
      pv.isParked = true;
      parkedPlaced.push({ x: bay.x, z: bay.z, id: modelId });
    }
  }

  /**
   * Reapplies live Overtake car customization (paint, finish, rims, window tint, trim)
   * onto the player's personal vehicle, or swaps its model if `selectedCar` changed.
   */
  reapplyPersonalCarCustom(carId?: CarId, spawnOverride?: { pos: THREE.Vector3; yaw: number }): DriveableVehicle | undefined {
    const save = loadSave();
    const targetId = carId ?? save.selectedCar;
    const custom = getCarCustomConfig(save, targetId);
    const hero = this.vehicles[0];
    if (!hero || hero.modelId !== targetId) {
      return this.summonPlayerCar(
        targetId,
        custom.paintHex ?? null,
        spawnOverride?.pos,
        spawnOverride?.yaw,
      );
    }
    hero.paintHex = custom.paintHex ? new THREE.Color(custom.paintHex).getHex() : undefined;
    if (hero.modelRoot) {
      applyCarCustomization(hero.modelRoot, custom);
    }
    return hero;
  }

  /**
   * Summons or swaps the player's curbside personal vehicle in Westgate Bay
   * when they buy or select a car from the Dealership/Garage.
   */
  summonPlayerCar(carId: CarId, paintHexStr?: string | null, nearPos?: THREE.Vector3, yawRad?: number): DriveableVehicle {
    const custom = getCarCustomConfig(loadSave(), carId);
    const effPaint = paintHexStr === null ? undefined : paintHexStr ?? custom.paintHex;
    const paintHex = effPaint ? new THREE.Color(effPaint).getHex() : undefined;
    const oldHero = this.vehicles[0];
    if (oldHero && this.activeVehicle === oldHero) {
      this.exitVehicle();
    }
    const spawnPos = nearPos
      ? new THREE.Vector3(
          nearPos.x + Math.sin((yawRad ?? 0) + Math.PI * 0.5) * 3.4,
          nearPos.y,
          nearPos.z + Math.cos((yawRad ?? 0) + Math.PI * 0.5) * 3.4,
        )
      : oldHero
        ? oldHero.pos.clone()
        : new THREE.Vector3(SAFEHOUSE_CAR_SPOT.x, 5.5, SAFEHOUSE_CAR_SPOT.z);
    const tY = this.bridge.heightSystem.terrainHeightAt(spawnPos.x, spawnPos.z);
    spawnPos.y = this.bridge.groundHeightAt(spawnPos.x, spawnPos.z, Math.max(spawnPos.y, tY) + 1.8);
    const yaw = yawRad ?? oldHero?.yaw ?? THREE.MathUtils.degToRad(SAFEHOUSE_CAR_SPOT.yawDeg);

    if (oldHero) {
      if (oldHero.modelRoot) disposeVehicleLights(oldHero.modelRoot);
      this.root.remove(oldHero.group);
      this.vehicles.splice(0, 1);
    }

    const v = this.createVehicle(`hero_${carId}_personal`, carId, spawnPos, yaw, {
      paintHex,
      isNpcTraffic: false,
    });
    // Move to index 0
    this.vehicles.pop();
    this.vehicles.unshift(v);
    if (!this.library.has(carId) && typeof window !== "undefined" && typeof fetch === "function") {
      void this.library.loadModel(carId).then((loaded) => {
        if (!this.disposed && loaded && !v.modelRoot) this.attachLoadedModel(v);
      });
    }
    return v;
  }

  /**
   * Places the player's personal vehicle at an exact spot (e.g. Safehouse 1-car garage bay
   * or apartment building street garage exit) and immediately puts the player in the driver seat.
   */
  spawnAndEnterCarAt(carId: CarId, pos: THREE.Vector3, yawRad: number): DriveableVehicle {
    const custom = getCarCustomConfig(loadSave(), carId);
    const paintHex = custom.paintHex ? new THREE.Color(custom.paintHex).getHex() : undefined;
    const oldHero = this.vehicles[0];
    if (oldHero && this.activeVehicle === oldHero) {
      this.exitVehicle();
    }
    const spawnPos = pos.clone();
    const tY = this.bridge.heightSystem.terrainHeightAt(spawnPos.x, spawnPos.z);
    spawnPos.y = this.bridge.groundHeightAt(spawnPos.x, spawnPos.z, Math.max(spawnPos.y, tY) + 1.8);

    if (oldHero) {
      if (oldHero.modelRoot) disposeVehicleLights(oldHero.modelRoot);
      this.root.remove(oldHero.group);
      this.vehicles.splice(0, 1);
    }

    const v = this.createVehicle(`hero_${carId}_personal`, carId, spawnPos, yawRad, {
      paintHex,
      isNpcTraffic: false,
    });
    this.vehicles.pop();
    this.vehicles.unshift(v);
    if (!this.library.has(carId) && typeof window !== "undefined" && typeof fetch === "function") {
      void this.library.loadModel(carId).then((loaded) => {
        if (!this.disposed && loaded && !v.modelRoot) this.attachLoadedModel(v);
      });
    }
    this.enterVehicle(v);
    return v;
  }

  findNearestEnterable(pos: THREE.Vector3, maxDist = 4.8): DriveableVehicle | null {
    let best: DriveableVehicle | null = null;
    let bestD2 = maxDist * maxDist;
    for (const v of this.vehicles) {
      if (v === this.activeVehicle || v.disabled) continue;
      if (Math.abs(v.pos.y - pos.y) > 2.8) continue;
      const dx = v.pos.x - pos.x;
      const dz = v.pos.z - pos.z;
      const d2 = dx * dx + dz * dz;
      if (d2 < bestD2) {
        bestD2 = d2;
        best = v;
      }
    }
    return best;
  }

  enterVehicle(v: DriveableVehicle): void {
    if (this.activeVehicle === v || v.disabled) return;
    const wasOccupiedNpc = v.isNpcTraffic;
    this.activeVehicle = v;
    v.driverActive = true;
    v.isNpcTraffic = false;
    v.lane = null;
    if (wasOccupiedNpc) {
      this.onCarjack?.(v);
    }
    v.doorTimer = 0.28;
    syncVehiclePhysicsFromWorld(v.physState, v.vx, v.vz, v.yaw, 0);
    v.physState.steer = 0;
    v.physState.steerAngle = v.steerAngle;
    v.physState.accel = 0;
    v.physState.latAccel = 0;
    v.physState.slip = 0;
    v.crashTimer = 0;
    v.crashVx = 0;
    v.crashVz = 0;
    v.yawVel = 0;
    v.turnCurve = null;
    v.npcSignal = null;
    v.npcBraking = false;
    // Upgrade NPC shading castShadow when player enters
    if (v.modelRoot) {
      v.modelRoot.traverse((o) => {
        if ((o as THREE.Mesh).isMesh) o.castShadow = true;
      });
    }
  }

  exitVehicle(): THREE.Vector3 | null {
    const v = this.activeVehicle;
    if (!v) return null;
    this.skidmarks.lift();
    v.driverActive = false;
    v.doorTimer = 0.28;
    this.activeVehicle = null;
    this.signal = null;
    this.signalElapsed = 0;
    if (v.modelRoot) {
      const ind = v.modelRoot.userData.indicatorState as
        | { left?: { value: number }; right?: { value: number } }
        | undefined;
      if (ind?.left) ind.left.value = 0;
      if (ind?.right) ind.right.value = 0;
    }
    const leftX = Math.cos(v.yaw);
    const leftZ = -Math.sin(v.yaw);
    const exit = new THREE.Vector3(v.pos.x + leftX * (v.width * 0.5 + 1.15), v.pos.y, v.pos.z + leftZ * (v.width * 0.5 + 1.15));
    exit.y = this.bridge.groundHeightAt(exit.x, exit.z, v.pos.y + 1.6);
    return exit;
  }

  toggleSignal(side: "left" | "right"): void {
    if (!this.activeVehicle) return;
    this.signal = this.signal === side ? null : side;
    this.signalElapsed = 0;
  }

  isSignalLit(): boolean {
    // Overtake automotive flasher cadence (~83 BPM: 0.36s lit / 0.36s dark)
    return !!this.signal && (this.signalElapsed % 0.72) < 0.36;
  }

  spawnScriptedVehicle(
    id: string,
    modelId: TrafficId,
    pos: THREE.Vector3,
    yaw: number,
    paintHex?: number,
  ): DriveableVehicle {
    this.removeScriptedVehicle(id);
    const v = this.createVehicle(id, modelId, pos.clone(), yaw, {
      paintHex,
      isNpcTraffic: false,
    });
    v.isScriptedContract = true;
    v.isParked = true;
    if (typeof window !== "undefined" && typeof fetch === "function") {
      void this.streamModel(modelId);
    }
    return v;
  }

  removeScriptedVehicle(id: string): void {
    const idx = this.vehicles.findIndex((v) => v.id === id);
    if (idx < 0) return;
    const v = this.vehicles[idx];
    if (this.activeVehicle === v) this.exitVehicle();
    disposeVehicleLights(v.group);
    this.root.remove(v.group);
    this.vehicles.splice(idx, 1);
  }

  syncScriptedVehicle(v: DriveableVehicle, dt: number, steerAngle: number): void {
    if (v === this.activeVehicle) return;
    v.steerAngle = steerAngle;
    v.pos.y = this.bridge.groundHeightAt(v.pos.x, v.pos.z, v.pos.y + 3.0);
    v.vx = Math.sin(v.yaw) * v.speed;
    v.vz = Math.cos(v.yaw) * v.speed;
    v.driverActive = Math.abs(v.speed) > 0.25;
    v.isParked = !v.driverActive;
    this.syncTransform(v, dt);
  }

  private lastWeatherWet = -1;
  private lastWeatherSnow = -1;

  /** Dynamically updates car-body clearcoat/gloss for rain wetness and snow dusting. */
  setWeatherSurface(wet: number, snowCover: number): void {
    const w = clamp(wet, 0, 1);
    const s = clamp(snowCover, 0, 1);
    if (Math.abs(w - this.lastWeatherWet) < 0.025 && Math.abs(s - this.lastWeatherSnow) < 0.025) return;
    this.lastWeatherWet = w;
    this.lastWeatherSnow = s;
    const clearcoat = clamp(1.0 + w * 0.0 - s * 0.28, 0.72, 1.0);
    const clearcoatRoughness = clamp(0.06 * (1 - w * 0.75) + s * 0.24, 0.015, 0.32);
    for (let i = 0; i < this.vehicles.length; i++) {
      const mats = this.vehicles[i].group.userData?.paintMaterials as THREE.MeshPhysicalMaterial[] | undefined;
      if (!mats) continue;
      for (let m = 0; m < mats.length; m++) {
        mats[m].clearcoat = clearcoat;
        mats[m].clearcoatRoughness = clearcoatRoughness;
      }
    }
  }

  update(
    dt: number,
    input: VehicleInput,
    playerPos: THREE.Vector3,
    gripScale = 1.0,
    camera?: THREE.Camera,
    darkness = 0,
  ): void {
    this.lastImpact = 0;
    this.lastLanding = 0;
    this.lastLandingBottomOut = false;
    this.activeDriftSlip = 0;
    this.activeSurfaceKind = "asphalt";
    this.activeWheelSlip = 0;
    const safeDt = Math.min(Math.max(dt, 0), 0.05);
    this.npcSignalClock += safeDt;
    if (this.pendingAttachIds.size > 0) {
      let budget = 3;
      for (let i = 0; i < this.vehicles.length && budget > 0; i++) {
        const v = this.vehicles[i];
        if (!v.modelRoot && this.pendingAttachIds.has(v.modelId) && this.library.has(v.modelId)) {
          this.attachLoadedModel(v);
          budget--;
        }
      }
      if (budget > 0) {
        this.pendingAttachIds.clear();
      }
    }
    if (this.activeVehicle && this.signal) {
      this.signalElapsed += safeDt;
    } else {
      this.signalElapsed = 0;
    }
    const signalLit = this.isSignalLit();
    const npcSignalLit = (this.npcSignalClock % 0.72) < 0.36;
    for (const v of this.vehicles) {
      if (v === this.activeVehicle) {
        const effIn = v.disabled ? { throttle: 0, steer: 0, handbrake: true } : input;
        this.updatePlayerVehicle(v, safeDt, effIn, gripScale);
        if (!v.airborne && v.pos.y < -0.06) {
          v.speed *= Math.exp(-1.9 * safeDt);
          v.physState.speed = v.speed;
          if (Math.abs(v.speed) > 2.2 && this.smokeAcc < safeDt * 1.1 && this.onWaterSplash) {
            const intensity = Math.min(1.0, Math.abs(v.speed) / 14);
            this.onWaterSplash(new THREE.Vector3(v.pos.x, 0.04, v.pos.z), intensity * 0.42);
          }
        }
        const drifting =
          !v.disabled &&
          !v.airborne &&
          (Math.abs(v.physState.slip) > 0.22 ||
            v.physState.rearSlip > 0.25 ||
            v.physState.frontSlip > 0.45 ||
            (effIn.handbrake && Math.abs(v.speed) > 4.2));
        this.activeSurfaceKind = v.airborne ? "asphalt" : (v.surfaceKind ?? "asphalt");
        this.activeWheelSlip = v.airborne
          ? 0
          : clamp(
              Math.max(
                Math.abs(v.physState.slip),
                v.physState.frontSlip,
                v.physState.rearSlip,
                effIn.handbrake && Math.abs(v.speed) > 1.8 ? 0.92 : 0,
              ),
              0,
              1,
            );
        if (drifting) {
          this.activeDriftSlip = Math.min(
            1,
            Math.max(0.32, Math.max(Math.abs(v.physState.slip), v.physState.rearSlip, v.physState.frontSlip * 0.7) * 1.35),
          );
          const slideRear = v.physState.rearSlip >= v.physState.frontSlip * 0.85 || effIn.handbrake;
          const surf = v.surfaceKind ?? "asphalt";
          const trackKind =
            gripScale < 0.76
              ? "snow"
              : surf === "mud"
                ? "mud"
                : surf === "sand"
                  ? "sand"
                  : surf === "dirt" || surf === "grass" || surf === "rock"
                    ? "dirt"
                    : "rubber";
          this.skidmarks.recordRearAxle(v.pos, v.yaw, v.width, v.length, 0.24, trackKind);
          if (this.smokeAcc < safeDt * 1.1 && this.onSmoke && surf === "asphalt" && gripScale >= 0.76) {
            const fx = Math.sin(v.yaw);
            const fz = Math.cos(v.yaw);
            const rx = Math.cos(v.yaw);
            const rz = -Math.sin(v.yaw);
            const axleOff = slideRear ? -v.length * 0.31 : v.length * 0.30;
            const halfW = v.width * 0.41;
            this.onSmoke(new THREE.Vector3(v.pos.x + fx * axleOff - rx * halfW, v.pos.y + 0.16, v.pos.z + fz * axleOff - rz * halfW), false);
            this.onSmoke(new THREE.Vector3(v.pos.x + fx * axleOff + rx * halfW, v.pos.y + 0.16, v.pos.z + fz * axleOff + rz * halfW), false);
          }
        } else {
          this.skidmarks.lift();
        }
      } else if (v.crashTimer > 0) {
        this.updateCrashedVehicle(v, safeDt);
      } else if (v.isNpcTraffic && v.lane && !v.disabled) {
        this.updateNpcTrafficVehicle(v, safeDt, playerPos);
      } else {
        // Coast parked/bumped hero vehicles smoothly to rest
        if (Math.abs(v.speed) > 0.05 || Math.hypot(v.crashVx, v.crashVz) > 0.05 || Math.abs(v.yawVel) > 0.02) {
          v.speed *= Math.max(0, 1 - 3.6 * safeDt);
          this.advanceVehicleKinematics(v, safeDt);
        } else {
          v.speed = 0;
          v.vx = 0;
          v.vz = 0;
          v.yawVel = 0;
        }
      }
    }

    // Resolve pairwise oriented vehicle-vs-vehicle crashes & physical separation
    this.resolveAllVehicleCollisions(playerPos, safeDt);

    this.smokeAcc += safeDt;
    const emitSmokeTick = this.smokeAcc >= 0.09;
    if (emitSmokeTick) this.smokeAcc = 0;
    const flashPhase = (this.npcSignalClock % 0.34) < 0.17;

    for (const v of this.vehicles) {
      if (v.deformer.detachedCount > 0) {
        v.deformer.updateDebris(safeDt, (x, z, y) => this.bridge.groundHeightAt(x, z, y));
      }
      if (v.lightbar) {
        const activeSiren = !!v.isPolice && !!v.sirenOn && !v.disabled;
        v.lightbar.matR.emissiveIntensity = activeSiren ? (flashPhase ? 4.2 : 0.15) : 0.2;
        v.lightbar.matB.emissiveIntensity = activeSiren ? (flashPhase ? 0.15 : 4.2) : 0.2;
      }
      if (emitSmokeTick && v.group.visible && !v.exploded && (v.disabled || v.hp < 55) && this.onSmoke) {
        const fx = Math.sin(v.yaw);
        const fz = Math.cos(v.yaw);
        this.onSmoke(
          new THREE.Vector3(v.pos.x + fx * v.length * 0.36, v.pos.y + v.height * 0.58, v.pos.z + fz * v.length * 0.36),
          !!v.disabled || v.hp < 25,
        );
      }
      const braking =
        v === this.activeVehicle
          ? input.handbrake || (input.throttle < -0.1 && v.speed > 0.5)
          : v.crashTimer > 0 || !!v.npcBraking;

      // Door open/close pulse animation on enter/exit (for models with hinged doors like Range Rover)
      if (v.doorTimer > 0) {
        v.doorTimer = Math.max(0, v.doorTimer - safeDt);
        v.doorAnim = Math.min(1, v.doorAnim + safeDt * 6.5);
      } else if (v.doorAnim > 0) {
        v.doorAnim = Math.max(0, v.doorAnim - safeDt * 7.5);
      }
      if (v.modelRoot && v.doorAnim > 0.001) {
        setDoorsOpen(v.modelRoot, v.doorAnim);
      } else if (v.modelRoot && v.doorAnim === 0 && v.doorTimer === 0) {
        setDoorsOpen(v.modelRoot, 0);
      }

      // Distance-cull distant vehicles (>240m) and lazily stream GLB models as cars enter range
      const dx = v.pos.x - playerPos.x;
      const dz = v.pos.z - playerPos.z;
      const d2 = dx * dx + dz * dz;
      v.group.visible = v === this.activeVehicle || d2 < 240 * 240;
      if (!v.modelRoot && v.group.visible && typeof window !== "undefined" && typeof fetch === "function") {
        void this.streamModel(v.modelId);
      }

      // Enable real-time dynamic shadows for nearby visible cars within the player's shadow frustum
      if (v.modelRoot && v.group.visible) {
        const wantCast = v === this.activeVehicle || d2 < 65 * 65;
        if (v.modelRoot.userData.lastCastShadow !== wantCast) {
          v.modelRoot.userData.lastCastShadow = wantCast;
          v.modelRoot.traverse((o) => {
            const m = o as THREE.Mesh;
            if (m.isMesh && m.name !== "underbody_contact_shadow") {
              m.castShadow = wantCast;
            }
          });
        }
      }

      // Update per-vehicle headlights, taillights, brake glow & turn signals (Overtake cadence)
      if (camera && v.modelRoot && v.group.visible && (d2 < 160 * 160 || v === this.activeVehicle)) {
        const vehSignal = v === this.activeVehicle ? this.signal : (v.npcSignal ?? null);
        const vehLit = v === this.activeVehicle ? signalLit : (!!v.npcSignal && npcSignalLit);
        updateVehicleLights(v.modelRoot, camera, darkness, braking, vehSignal, vehLit);
        const ind = v.modelRoot.userData.indicatorState as
          | { left: { value: number }; right: { value: number }; viewZ: { value: number } }
          | undefined;
        if (ind) {
          if (v === this.activeVehicle) {
            ind.left.value = this.signal === "left" ? (signalLit ? 1 : -1) : 0;
            ind.right.value = this.signal === "right" ? (signalLit ? 1 : -1) : 0;
          } else {
            ind.left.value = vehSignal === "left" ? (npcSignalLit ? 1 : -1) : 0;
            ind.right.value = vehSignal === "right" ? (npcSignalLit ? 1 : -1) : 0;
          }
          v.modelRoot.updateWorldMatrix(true, false);
          this.camLocalTmp.copy(camera.position);
          v.modelRoot.worldToLocal(this.camLocalTmp);
          ind.viewZ.value = this.camLocalTmp.z;
        }
      }
    }
  }

  private classifyVehicleSurface(v: DriveableVehicle): {
    kind: TireSurfaceKind;
    surfaceGrip: number;
    rollingRes: number;
    offroadDrag: number;
    bumpiness: number;
  } {
    const x = v.pos.x;
    const z = v.pos.z;
    const y = v.pos.y;
    const realSpec = getRealVehicleSpec(v.modelId);
    const cap = clamp(realSpec.offroadCapability ?? 0.36, 0, 1);

    // 1. Elevated bridges, ramps, parking decks & rooftops are paved concrete/asphalt
    const terrainY = this.bridge.heightSystem.terrainHeightAt(x, z);
    if (y > terrainY + 0.55) {
      return { kind: "asphalt", surfaceGrip: 1.0, rollingRes: 0.013, offroadDrag: 0, bumpiness: 0 };
    }

    // 2. Compiled road network carriageways & junction pads
    const roadInf = this.bridge.roads.getRoadInfluence(x, z, 28);
    if (roadInf && roadInf.edgeDist <= 0.45) {
      return { kind: "asphalt", surfaceGrip: 1.0, rollingRes: 0.013, offroadDrag: 0, bumpiness: 0 };
    }

    // 3. Paved airport tarmac, seaport apron, and flat Downtown/Midtown plazas
    if ((z > 680 && x < 420) || (x > 640 && z > -350 && z < 920)) {
      return { kind: "asphalt", surfaceGrip: 1.0, rollingRes: 0.013, offroadDrag: 0, bumpiness: 0 };
    }
    const dist = getDistrictAt(x, z);
    const slopeMag = Math.max(Math.abs(v.suspension.groundPitch), Math.abs(v.suspension.groundRoll));
    if ((dist.id === "downtown" || dist.id === "midtown") && slopeMag < 0.06) {
      return { kind: "asphalt", surfaceGrip: 0.98, rollingRes: 0.014, offroadDrag: 0, bumpiness: 0.05 };
    }

    // 4. Off-road surfaces
    if (y < 0.18) {
      return {
        kind: "mud",
        surfaceGrip: 0.40 + cap * 0.32,
        rollingRes: 0.095 - cap * 0.040,
        offroadDrag: 0.110 * (1.20 - cap * 0.82),
        bumpiness: 0.48,
      };
    }
    if (x < coastLineX(z) + 52 && z < 980) {
      return {
        kind: "sand",
        surfaceGrip: 0.48 + cap * 0.30,
        rollingRes: 0.072 - cap * 0.032,
        offroadDrag: 0.070 * (1.20 - cap * 0.85),
        bumpiness: 0.38,
      };
    }
    if (slopeMag > 0.24 || y > 34) {
      return {
        kind: "rock",
        surfaceGrip: 0.64 + cap * 0.26,
        rollingRes: 0.044 - cap * 0.018,
        offroadDrag: 0.036 * (1.15 - cap * 0.85),
        bumpiness: 0.85,
      };
    }
    if (dist.id === "foothills") {
      return {
        kind: "dirt",
        surfaceGrip: 0.66 + cap * 0.24,
        rollingRes: 0.040 - cap * 0.017,
        offroadDrag: 0.026 * (1.15 - cap * 0.85),
        bumpiness: 0.58,
      };
    }
    return {
      kind: "grass",
      surfaceGrip: 0.58 + cap * 0.26,
      rollingRes: 0.048 - cap * 0.020,
      offroadDrag: 0.030 * (1.15 - cap * 0.85),
      bumpiness: 0.44,
    };
  }

  private updatePlayerVehicle(v: DriveableVehicle, dt: number, input: VehicleInput, gripScale: number): void {
    const phys = v.spec.physics;
    const st = v.physState;
    const realSpec = getRealVehicleSpec(v.modelId);
    // Feed current world velocity & any collision yaw impulse back into the 4-wheel tire solver
    syncVehiclePhysicsFromWorld(st, v.vx, v.vz, v.yaw, st.yawRate + v.yawVel);
    v.crashVx = 0;
    v.crashVz = 0;
    v.yawVel = 0;

    const surf = this.classifyVehicleSurface(v);
    v.surfaceKind = surf.kind;
    const effectiveSurfaceGrip = clamp(gripScale * surf.surfaceGrip, 0.28, 1.15);

    const custom = this.isPersonalCar(v) ? getCarCustomConfig(loadSave(), v.modelId as CarId) : null;
    const engMult = custom ? 1 + custom.engineLevel * 0.11 : 1;
    const accMult = custom ? 1 + custom.engineLevel * 0.14 : 1;
    const gripMult = custom ? 1 + custom.handlingLevel * 0.10 : 1;
    const yawMult = custom ? 1 + custom.handlingLevel * 0.12 : 1;
    const brkMult = custom ? 1 + custom.brakeLevel * 0.16 : 1;

    const params = {
      maxSpeed: v.spec.maxSpeed * engMult * v.deformer.powerMult,
      accel: v.spec.accel * accMult * v.deformer.powerMult,
      brake: phys.brake * brkMult,
      grip: phys.grip * effectiveSurfaceGrip * gripMult * v.deformer.gripMult,
      surfaceGrip: effectiveSurfaceGrip,
      rollingRes: surf.rollingRes,
      offroadDrag: surf.offroadDrag,
      slopePitch: v.suspension.groundPitch,
      slopeRoll: v.suspension.groundRoll,
      wheelbase: phys.wheelbase,
      maxSteer: phys.maxSteer,
      understeer: phys.understeer / gripMult,
      yawResponse: phys.yawResponse * yawMult,
      steerResponse: phys.steerResponse * yawMult,
      drag: phys.drag,
      powerMult: accMult * v.deformer.powerMult,
      brakeMult: brkMult,
      realSpec,
    };

    const freeInput = {
      throttle: Math.max(0, input.throttle),
      brake: Math.max(0, -input.throttle),
      steer: clamp(input.steer + v.deformer.steerBias, -1, 1),
      handbrake: input.handbrake,
    };

    if (v.airborne) {
      // Airborne: tires have no pavement traction; hold momentum and allow visual front-wheel turn only
      st.accel = 0;
      st.latAccel = 0;
      st.slip = 0;
      st.frontSlip = 0;
      st.rearSlip = 0;
      st.yawRate *= Math.exp(-1.6 * dt);
      st.yaw = wrapAngle(st.yaw + st.yawRate * dt);
      st.steerAngle = damp(st.steerAngle, freeInput.steer * 0.38, 8.5, dt);
      st.steerAngles[0] = st.steerAngle;
      st.steerAngles[1] = st.steerAngle;
      // Air drag gently bleeds speed
      const airDamp = Math.exp(-0.08 * dt);
      v.vx *= airDamp;
      v.vz *= airDamp;
      syncVehiclePhysicsFromWorld(st, v.vx, v.vz, st.yaw, st.yawRate);
      for (let i = 0; i < 4; i++) {
        st.wheelOmega[i] *= Math.exp(-0.6 * dt);
      }
    } else {
      stepFreeRoamVehicle(st, freeInput, params, dt);
      v.vx = st.worldVx;
      v.vz = st.worldVz;
    }

    v.speed = st.speed;
    v.yaw = st.yaw;
    v.steerAngle = st.steerAngle;

    this.advanceVehicleKinematics(v, dt);
  }

  private resolveHullVsAABBs(
    v: DriveableVehicle,
    gy: number,
    vx: number,
    vz: number,
    dt: number,
  ): { vx: number; vz: number; hitImpact: number; hitPosX: number; hitPosZ: number; hitNx: number; hitNz: number } {
    const fx = Math.sin(v.yaw);
    const fz = Math.cos(v.yaw);
    const hw = v.width * 0.48;
    const hl = v.length * 0.48;
    const probeR = hw * 0.94;
    const span = Math.max(0.1, hl - probeR * 0.72);
    const probes = [-span, 0, span];
    const queryPad = Math.max(hw, hl) + 1.2;
    const hits = this.bridge.spatialAABBs.queryRect(
      v.pos.x - queryPad,
      v.pos.z - queryPad,
      v.pos.x + queryPad,
      v.pos.z + queryPad,
    );

    let outVx = vx;
    let outVz = vz;
    let bestImpact = 0;
    let hitPosX = v.pos.x;
    let hitPosZ = v.pos.z;
    let hitNx = 0;
    let hitNz = 1;

    for (let pass = 0; pass < 2; pass++) {
      for (const offset of probes) {
        const px = v.pos.x + fx * offset;
        const pz = v.pos.z + fz * offset;
        for (const h of hits) {
          if (h.max.y <= gy + 0.36 || h.min.y >= gy + v.height + 0.1) continue;
          if (h.max.y - h.min.y < 0.38 && h.max.y <= gy + 0.42) continue;

          const cx = clamp(px, h.min.x, h.max.x);
          const cz = clamp(pz, h.min.z, h.max.z);
          const dx = px - cx;
          const dz = pz - cz;
          const d2 = dx * dx + dz * dz;
          if (d2 >= probeR * probeR) continue;

          let nx = 0;
          let nz = 0;
          let pen = 0;
          if (d2 > 1e-6) {
            const d = Math.sqrt(d2);
            nx = dx / d;
            nz = dz / d;
            pen = probeR - d;
          } else {
            const left = Math.abs(px - h.min.x);
            const right = Math.abs(h.max.x - px);
            const back = Math.abs(pz - h.min.z);
            const front = Math.abs(h.max.z - pz);
            const m = Math.min(left, right, back, front);
            if (m === left) nx = -1;
            else if (m === right) nx = 1;
            else if (m === back) nz = -1;
            else nz = 1;
            pen = probeR + m;
          }

          v.pos.x += nx * pen;
          v.pos.z += nz * pen;

          const vn = outVx * nx + outVz * nz;
          if (vn < 0) {
            const impactSpd = -vn;
            const restitution = impactSpd > 6 ? 0.28 : 0.12;
            const tx = -nz;
            const tz = nx;
            const vt = outVx * tx + outVz * tz;
            const tangDamp = impactSpd > 8 ? 0.72 : 0.90;
            const newVn = -vn * restitution;
            const newVt = vt * tangDamp;
            outVx = nx * newVn + tx * newVt;
            outVz = nz * newVn + tz * newVt;

            // Corner deflection torque when front/rear bumper clips a wall or pole obliquely
            const rx = fx * offset;
            const rz = fz * offset;
            const torque = (rx * nz - rz * nx) * impactSpd;
            v.yawVel = clamp(v.yawVel + torque * 0.032, -4.5, 4.5);

            if (impactSpd > bestImpact) {
              bestImpact = impactSpd;
              hitPosX = cx;
              hitPosZ = cz;
              hitNx = nx;
              hitNz = nz;
            }
          }
        }
      }
    }
    if (bestImpact > 4.5) {
      v.deformer.applyWorldImpact(
        new THREE.Vector3(hitPosX, gy + 0.65, hitPosZ),
        new THREE.Vector3(hitNx, 0.1, hitNz),
        v.pos,
        v.yaw,
        bestImpact,
      );
    }
    if (bestImpact > 9) {
      this.damageVehicle(v, (bestImpact - 8) * 2.2);
    }
    void dt;
    return { vx: outVx, vz: outVz, hitImpact: bestImpact, hitPosX, hitPosZ, hitNx, hitNz };
  }

  private advanceVehicleKinematics(v: DriveableVehicle, dt: number): void {
    const prevX = v.pos.x;
    const prevZ = v.pos.z;
    const prevYaw = v.yaw;
    const isActive = v === this.activeVehicle;
    const fx = Math.sin(v.yaw);
    const fz = Math.cos(v.yaw);

    // Player vehicle preserves full 2D planar velocity (including drift sideslip);
    // parked/bumped non-active vehicles combine longitudinal speed + decaying crash velocity.
    let vx: number;
    let vz: number;
    if (isActive) {
      vx = v.vx + v.crashVx;
      vz = v.vz + v.crashVz;
      v.crashVx = 0;
      v.crashVz = 0;
    } else {
      vx = fx * v.speed + v.crashVx;
      vz = fz * v.speed + v.crashVz;
      const tireDecay = Math.exp(-5.5 * dt);
      v.crashVx *= tireDecay;
      v.crashVz *= tireDecay;
    }
    v.yawVel *= Math.exp(-6.5 * dt);

    v.yaw = wrapAngle(v.yaw + v.yawVel * dt);
    const targetX = clamp(prevX + vx * dt, -1180, 1180);
    const targetZ = clamp(prevZ + vz * dt, -1180, 1180);

    const gy = this.bridge.groundHeightAt(targetX, targetZ, v.pos.y + 1.8);
    if (gy < -0.6 && (!v.airborne || v.pos.y <= 0.15)) {
      v.speed *= -0.25;
      v.vx *= -0.25;
      v.vz *= -0.25;
      v.crashVx *= -0.25;
      v.crashVz *= -0.25;
      v.yaw = prevYaw;
      if (isActive) syncVehiclePhysicsFromWorld(v.physState, v.vx, v.vz, v.yaw, 0);
      else v.physState.speed = v.speed;
      this.syncTransform(v, 0, dt);
      return;
    }

    v.pos.x = targetX;
    v.pos.z = targetZ;

    const wallRes = this.resolveHullVsAABBs(v, v.airborne ? v.pos.y : gy, vx, vz, dt);
    vx = wallRes.vx;
    vz = wallRes.vz;

    if (wallRes.hitImpact > 2.8 && isActive) {
      const imp = clamp(wallRes.hitImpact / 18, 0, 1);
      if (imp > this.lastImpact) {
        this.lastImpact = imp;
        this.lastCrashPos.set(wallRes.hitPosX, (v.airborne ? v.pos.y : gy) + 0.65, wallRes.hitPosZ);
        this.lastCrashNormal.set(wallRes.hitNx, 0.25, wallRes.hitNz).normalize();
        this.lastCrashKind = "concrete";
      }
    }

    const nfx = Math.sin(v.yaw);
    const nfz = Math.cos(v.yaw);
    const fwdSpd = vx * nfx + vz * nfz;
    v.speed = fwdSpd;
    v.vx = vx;
    v.vz = vz;
    if (isActive) {
      syncVehiclePhysicsFromWorld(v.physState, vx, vz, v.yaw, v.physState.yawRate + v.yawVel);
      v.yawVel = 0;
    } else {
      v.physState.speed = fwdSpd;
      v.physState.yaw = v.yaw;
      v.crashVx = vx - nfx * fwdSpd;
      v.crashVz = vz - nfz * fwdSpd;
    }

    const surfKind = v.surfaceKind ?? "asphalt";
    const offroadBump =
      surfKind === "rock"
        ? 0.85
        : surfKind === "dirt"
          ? 0.58
          : surfKind === "mud"
            ? 0.48
            : surfKind === "grass"
              ? 0.44
              : surfKind === "sand"
                ? 0.38
                : 0;
    const offroadCap = getRealVehicleSpec(v.modelId).offroadCapability ?? 0.36;
    const susRes = stepVehicleSuspension(v.suspension, {
      pos: v.pos,
      yaw: v.yaw,
      speed: v.speed,
      horizSpeed: Math.hypot(vx, vz),
      accel: v.physState.accel,
      latAccel: v.physState.latAccel,
      width: v.width,
      length: v.length,
      vy: v.vy ?? 0,
      airborne: !!v.airborne,
      groundAt: (x, z, y) => this.bridge.groundHeightAt(x, z, y),
      offroadBumpiness: offroadBump,
      offroadCapability: offroadCap,
      dt,
    });
    v.vy = susRes.vy;
    v.airborne = susRes.airborne;
    if (susRes.speed !== v.speed) {
      const ratio = Math.abs(v.speed) > 1e-4 ? susRes.speed / v.speed : 1;
      v.speed = susRes.speed;
      v.vx *= ratio;
      v.vz *= ratio;
      if (isActive) {
        syncVehiclePhysicsFromWorld(v.physState, v.vx, v.vz, v.yaw, v.physState.yawRate);
      } else {
        v.physState.speed = susRes.speed;
        v.crashVx *= ratio;
        v.crashVz *= ratio;
      }
    }
    if (susRes.landingImpact > 0.08 && isActive && susRes.landingImpact > this.lastLanding) {
      this.lastLanding = susRes.landingImpact;
      this.lastLandingPos.copy(v.pos);
      this.lastLandingBottomOut = susRes.bottomedOut;
    }
    const moved = ((v.pos.x - prevX) * nfx + (v.pos.z - prevZ) * nfz);
    this.syncTransform(v, moved, dt);
  }

  private updateCrashedVehicle(v: DriveableVehicle, dt: number): void {
    v.crashTimer = Math.max(0, v.crashTimer - dt);
    const prevX = v.pos.x;
    const prevZ = v.pos.z;

    const friction = Math.exp(-2.6 * dt);
    v.vx *= friction;
    v.vz *= friction;
    v.yawVel *= Math.exp(-3.4 * dt);
    v.yaw = wrapAngle(v.yaw + v.yawVel * dt);

    const targetX = clamp(prevX + v.vx * dt, -1180, 1180);
    const targetZ = clamp(prevZ + v.vz * dt, -1180, 1180);
    const gy = this.bridge.groundHeightAt(targetX, targetZ, v.pos.y + 1.8);
    if (gy >= -0.6 || (v.airborne && v.pos.y > 0.15)) {
      v.pos.x = targetX;
      v.pos.z = targetZ;
      const wallRes = this.resolveHullVsAABBs(v, v.airborne ? v.pos.y : gy, v.vx, v.vz, dt);
      v.vx = wallRes.vx;
      v.vz = wallRes.vz;
    } else {
      v.vx *= -0.3;
      v.vz *= -0.3;
    }

    const fx = Math.sin(v.yaw);
    const fz = Math.cos(v.yaw);
    v.speed = v.vx * fx + v.vz * fz;
    v.physState.speed = v.speed;
    v.physState.yaw = v.yaw;
    v.npcBraking = true;
    v.npcSignal = null;

    const susRes = stepVehicleSuspension(v.suspension, {
      pos: v.pos,
      yaw: v.yaw,
      speed: v.speed,
      horizSpeed: Math.hypot(v.vx, v.vz),
      accel: 0,
      latAccel: 0,
      width: v.width,
      length: v.length,
      vy: v.vy ?? 0,
      airborne: !!v.airborne,
      groundAt: (x, z, y) => this.bridge.groundHeightAt(x, z, y),
      dt,
    });
    v.vy = susRes.vy;
    v.airborne = susRes.airborne;
    this.syncTransform(v, v.speed * dt);

    if (v.crashTimer <= 0 && v.isNpcTraffic) {
      // Smoothly rejoin nearest road lane once spin/skid finishes
      const nearest = this.bridge.nearestLanePoint(v.pos.x, v.pos.z, 40);
      if (nearest) {
        v.lane = nearest.lane;
        v.laneT = nearest.t;
        v.laneSpeed = Math.min(nearest.lane.speedLimit * 0.85, v.spec.maxSpeed * 0.65);
        v.turnCurve = null;
        v.turnNextLane = null;
        v.upcomingNextLane = null;
        v.upcomingTurnDir = null;
      }
      v.yawVel = 0;
      v.crashVx = 0;
      v.crashVz = 0;
    }
  }

  private testProbesVsOBB(
    a: DriveableVehicle,
    b: DriveableVehicle,
  ): { depth: number; nx: number; nz: number; cx: number; cz: number } | null {
    const afx = Math.sin(a.yaw);
    const afz = Math.cos(a.yaw);
    const ar = a.width * 0.46;
    const aSpan = Math.max(0.1, a.length * 0.46 - ar * 0.7);

    const bc = Math.cos(b.yaw);
    const bs = Math.sin(b.yaw);
    const bhw = b.width * 0.48;
    const bhl = b.length * 0.48;

    let deepest: { depth: number; nx: number; nz: number; cx: number; cz: number } | null = null;
    for (const off of [-aSpan, 0, aSpan]) {
      const px = a.pos.x + afx * off;
      const pz = a.pos.z + afz * off;
      const dx = px - b.pos.x;
      const dz = pz - b.pos.z;
      const lx = dx * bc - dz * bs;
      const lz = dx * bs + dz * bc;
      const cx = clamp(lx, -bhw, bhw);
      const cz = clamp(lz, -bhl, bhl);
      const ox = lx - cx;
      const oz = lz - cz;
      const d2 = ox * ox + oz * oz;
      if (d2 >= ar * ar) continue;

      let lnx = 0;
      let lnz = 0;
      let depth = 0;
      if (d2 > 1e-6) {
        const d = Math.sqrt(d2);
        lnx = ox / d;
        lnz = oz / d;
        depth = ar - d;
      } else {
        const penX = bhw - Math.abs(lx) + ar;
        const penZ = bhl - Math.abs(lz) + ar;
        if (penX < penZ) lnx = lx >= 0 ? 1 : -1;
        else lnz = lz >= 0 ? 1 : -1;
        depth = Math.min(penX, penZ);
      }

      if (!deepest || depth > deepest.depth) {
        // Transform normal & contact from B local space back to world space
        const wnx = lnx * bc + lnz * bs;
        const wnz = -lnx * bs + lnz * bc;
        const wcx = b.pos.x + cx * bc + cz * bs;
        const wcz = b.pos.z - cx * bs + cz * bc;
        deepest = { depth, nx: wnx, nz: wnz, cx: wcx, cz: wcz };
      }
    }
    return deepest;
  }

  private resolveAllVehicleCollisions(playerPos: THREE.Vector3, _dt: number): void {
    const nearby = this.nearbyTmp;
    nearby.length = 0;
    const maxD2 = 250 * 250;
    for (const v of this.vehicles) {
      const dx = v.pos.x - playerPos.x;
      const dz = v.pos.z - playerPos.z;
      if (v === this.activeVehicle || dx * dx + dz * dz < maxD2) {
        nearby.push(v);
      }
    }

    for (let i = 0; i < nearby.length; i++) {
      const a = nearby[i];
      for (let j = i + 1; j < nearby.length; j++) {
        const b = nearby[j];
        if (Math.abs(a.pos.y - b.pos.y) > 2.3) continue;
        const maxR = (a.length + b.length) * 0.56 + 1.0;
        const dx0 = a.pos.x - b.pos.x;
        const dz0 = a.pos.z - b.pos.z;
        if (Math.abs(dx0) > maxR || Math.abs(dz0) > maxR || dx0 * dx0 + dz0 * dz0 > maxR * maxR) continue;

        const hitAB = this.testProbesVsOBB(a, b);
        const hitBA = this.testProbesVsOBB(b, a);
        let nx = 0;
        let nz = 0;
        let depth = 0;
        let cx = 0;
        let cz = 0;
        if (hitAB && (!hitBA || hitAB.depth >= hitBA.depth)) {
          nx = hitAB.nx;
          nz = hitAB.nz;
          depth = hitAB.depth;
          cx = hitAB.cx;
          cz = hitAB.cz;
        } else if (hitBA) {
          // hitBA normal pushes B away from A; flip so (nx, nz) pushes A away from B
          nx = -hitBA.nx;
          nz = -hitBA.nz;
          depth = hitBA.depth;
          cx = hitBA.cx;
          cz = hitBA.cz;
        } else {
          continue;
        }

        const invMA = 1 / a.mass;
        const invMB = 1 / b.mass;
        const invSum = invMA + invMB;
        a.pos.x += nx * depth * (invMA / invSum);
        a.pos.z += nz * depth * (invMA / invSum);
        b.pos.x -= nx * depth * (invMB / invSum);
        b.pos.z -= nz * depth * (invMB / invSum);

        const rAx = cx - a.pos.x;
        const rAz = cz - a.pos.z;
        const rBx = cx - b.pos.x;
        const rBz = cz - b.pos.z;
        const vAx = a.vx + a.yawVel * rAz;
        const vAz = a.vz - a.yawVel * rAx;
        const vBx = b.vx + b.yawVel * rBz;
        const vBz = b.vz - b.yawVel * rBx;

        const relVn = (vAx - vBx) * nx + (vAz - vBz) * nz;
        if (relVn < 0) {
          const closing = -relVn;
          const restitution = closing > 4 ? 0.38 : 0.15;
          const jMag = ((1 + restitution) * closing) / invSum;
          const jx = nx * jMag;
          const jz = nz * jMag;

          a.vx += jx * invMA;
          a.vz += jz * invMA;
          b.vx -= jx * invMB;
          b.vz -= jz * invMB;

          // Angular spin impulse (r x J) scaled inversely by rotational inertia
          const inertiaA = a.mass * (a.length * a.length + a.width * a.width) * 0.08;
          const inertiaB = b.mass * (b.length * b.length + b.width * b.width) * 0.08;
          a.yawVel = clamp(a.yawVel + (rAx * jz - rAz * jx) / Math.max(1, inertiaA), -5.5, 5.5);
          b.yawVel = clamp(b.yawVel - (rBx * jz - rBz * jx) / Math.max(1, inertiaB), -5.5, 5.5);

          // Sync forward speeds + trigger crash spin state on impacted NPC/parked vehicles
          const afx = Math.sin(a.yaw);
          const afz = Math.cos(a.yaw);
          a.speed = a.vx * afx + a.vz * afz;
          a.physState.speed = a.speed;
          a.crashVx = a.vx - afx * a.speed;
          a.crashVz = a.vz - afz * a.speed;

          const bfx = Math.sin(b.yaw);
          const bfz = Math.cos(b.yaw);
          b.speed = b.vx * bfx + b.vz * bfz;
          b.physState.speed = b.speed;
          b.crashVx = b.vx - bfx * b.speed;
          b.crashVz = b.vz - bfz * b.speed;

          if (a.isNpcTraffic && a !== this.activeVehicle && closing > 2.2) {
            a.crashTimer = clamp(0.85 + closing * 0.08, 0.85, 2.4);
          }
          if (b.isNpcTraffic && b !== this.activeVehicle && closing > 2.2) {
            b.crashTimer = clamp(0.85 + closing * 0.08, 0.85, 2.4);
          }

          if (closing > 4.5) {
            const impactY = (a.pos.y + b.pos.y) * 0.5 + 0.6;
            const hitPt = new THREE.Vector3(cx, impactY, cz);
            a.deformer.applyWorldImpact(hitPt, new THREE.Vector3(nx, 0.08, nz), a.pos, a.yaw, closing);
            b.deformer.applyWorldImpact(hitPt, new THREE.Vector3(-nx, 0.08, -nz), b.pos, b.yaw, closing);
          }
          if (closing > 8) {
            this.damageVehicle(a, (closing - 7) * 1.8);
            this.damageVehicle(b, (closing - 7) * 1.8);
          }
          if (a === this.activeVehicle || b === this.activeVehicle) {
            const imp = clamp(closing / 16, 0, 1);
            if (imp > this.lastImpact) {
              this.lastImpact = imp;
              this.lastCrashPos.set(cx, (a.pos.y + b.pos.y) * 0.5 + 0.65, cz);
              this.lastCrashNormal.set(nx, 0.25, nz).normalize();
              this.lastCrashKind = "metal";
            }
          }
          // Prevent secondary wall penetration if a crash pushed a car into a curb/building
          const resA = this.resolveHullVsAABBs(a, a.pos.y, a.vx, a.vz, _dt);
          a.vx = resA.vx;
          a.vz = resA.vz;
          const resB = this.resolveHullVsAABBs(b, b.pos.y, b.vx, b.vz, _dt);
          b.vx = resB.vx;
          b.vz = resB.vz;
        }
        this.syncTransform(a, 0);
        this.syncTransform(b, 0);
      }
    }
  }

  private findClosestLaneT(lane: TrafficLane, pos: THREE.Vector3): number {
    let bestT = 0;
    let bestD2 = Infinity;
    const samples = lane.samples;
    if (samples && samples.length > 0) {
      const denom = Math.max(1, samples.length - 1);
      for (let i = 0; i < samples.length; i++) {
        const p = samples[i];
        const dx = p.x - pos.x;
        const dz = p.z - pos.z;
        const d2 = dx * dx + dz * dz;
        if (d2 < bestD2) {
          bestD2 = d2;
          bestT = i / denom;
        }
      }
      // Refine around bestT
      const span = 1 / denom;
      for (let k = -4; k <= 4; k++) {
        const t = ((bestT + (k / 4) * span) % 1 + 1) % 1;
        const p = lane.curve.getPointAt(t);
        const dx = p.x - pos.x;
        const dz = p.z - pos.z;
        const d2 = dx * dx + dz * dz;
        if (d2 < bestD2) {
          bestD2 = d2;
          bestT = t;
        }
      }
      return bestT;
    }
    for (let i = 0; i < 32; i++) {
      const t = i / 32;
      const p = lane.curve.getPointAt(t);
      const dx = p.x - pos.x;
      const dz = p.z - pos.z;
      const d2 = dx * dx + dz * dz;
      if (d2 < bestD2) {
        bestD2 = d2;
        bestT = t;
      }
    }
    return bestT;
  }

  private buildTurnArc(
    fromPos: THREE.Vector3,
    fromDir: THREE.Vector3,
    toPos: THREE.Vector3,
    toDir: THREE.Vector3,
  ): { curve: THREE.CubicBezierCurve3; length: number; turnDir: "left" | "right" | null } {
    const dist = Math.max(2.0, fromPos.distanceTo(toPos));
    const handle = clamp(dist * 0.36, 1.0, 9.5);
    const p1 = fromPos.clone().addScaledVector(fromDir, handle);
    const p2 = toPos.clone().addScaledVector(toDir, -handle);
    const curve = new THREE.CubicBezierCurve3(fromPos.clone(), p1, p2, toPos.clone());
    const crossY = fromDir.z * toDir.x - fromDir.x * toDir.z;
    const dot = fromDir.x * toDir.x + fromDir.z * toDir.z;
    let turnDir: "left" | "right" | null = null;
    if (dot < 0.94) {
      turnDir = crossY > 0 ? "left" : "right";
    }
    return { curve, length: Math.max(2.0, curve.getLength()), turnDir };
  }

  private pickNextLane(v: DriveableVehicle, current: TrafficLane, incomingDir: THREE.Vector3): TrafficLane | null {
    const nextLanes = this.bridge.getConnectedLanes(current.id);
    if (nextLanes.length === 0) return null;
    v.npcSeed = ((v.npcSeed ?? Math.round(Math.abs(v.pos.x * 13 + v.pos.z * 7))) + 7) & 0x7fffffff;
    const isCurrentRb = current.id.startsWith("roundabout:");
    // When exiting a roundabout, exclude the ring itself; otherwise exclude self-loops and 180-degree reversals
    const candidates = nextLanes.filter((cand) => {
      if (isCurrentRb && cand.id.startsWith("roundabout:")) return false;
      if (cand.id === current.id) return false;
      const tan = cand.curve.getTangentAt(0.05);
      return incomingDir.x * tan.x + incomingDir.z * tan.z > -0.72;
    });
    const fallback = isCurrentRb
      ? nextLanes.filter((c) => !c.id.startsWith("roundabout:"))
      : nextLanes.filter((c) => c.id !== current.id);
    const pool = candidates.length > 0 ? candidates : fallback.length > 0 ? fallback : nextLanes;
    return pool[v.npcSeed % pool.length] ?? pool[0];
  }

  private updateNpcTrafficVehicle(v: DriveableVehicle, dt: number, playerPos: THREE.Vector3): void {
    const lane = v.lane!;
    const dxToP = v.pos.x - playerPos.x;
    const dzToP = v.pos.z - playerPos.z;
    const dToP2 = dxToP * dxToP + dzToP * dzToP;
    if (dToP2 > 310 * 310 && !v.disabled && v.hp >= v.maxHp * 0.9) {
      // Stream far-off NPC traffic smoothly onto active lanes 105m-245m around the player
      const allLanes = this.bridge.roads.getLanes();
      if (allLanes.length > 0) {
        v.npcSeed = ((v.npcSeed ?? Math.round(Math.abs(v.pos.x * 13 + v.pos.z * 7))) + 37) & 0x7fffffff;
        for (let tries = 0; tries < 8; tries++) {
          const cand = allLanes[(v.npcSeed + tries * 19) % allLanes.length];
          if (cand.length < 36) continue;
          const ct = 0.2 + ((v.npcSeed + tries * 7) % 60) * 0.01;
          const pt = cand.curve.getPointAt(ct);
          const dm2 = (pt.x - playerPos.x) * (pt.x - playerPos.x) + (pt.z - playerPos.z) * (pt.z - playerPos.z);
          if (dm2 < 105 * 105 || dm2 > 245 * 245) continue;
          const blocked = this.vehicles.some((o) => {
            if (o === v) return false;
            const ox = o.pos.x - pt.x;
            const oz = o.pos.z - pt.z;
            return ox * ox + oz * oz < 15 * 15;
          });
          if (blocked) continue;
          const tan = cand.curve.getTangentAt(ct);
          v.lane = cand;
          v.laneT = ct;
          v.laneSpeed = Math.min(cand.speedLimit * 0.85, v.spec.maxSpeed * 0.65);
          v.speed = v.laneSpeed * 0.85;
          v.turnCurve = null;
          v.turnNextLane = null;
          v.upcomingNextLane = null;
          v.upcomingTurnDir = null;
          v.npcSignal = null;
          v.npcBraking = false;
          const gy = this.bridge.groundHeightAt(pt.x, pt.z, pt.y + 1.0);
          v.pos.set(pt.x, gy, pt.z);
          v.yaw = Math.atan2(tan.x, tan.z);
          this.syncTransform(v, 0);
          return;
        }
      }
    }
    if (dToP2 > 680 * 680) {
      v.turnCurve = null;
      v.npcSignal = null;
      v.npcBraking = false;
      v.laneT += (v.laneSpeed * dt) / Math.max(1, lane.length);
      if (v.laneT >= 1) {
        if (lane.id.startsWith("roundabout:")) {
          v.laneT %= 1;
        } else {
          const tanEnd = lane.curve.getTangentAt(0.99).setY(0).normalize();
          const next = this.pickNextLane(v, lane, tanEnd);
          if (next) {
            v.lane = next;
            v.laneT = 0;
            v.laneSpeed = Math.min(next.speedLimit * 0.72, v.spec.maxSpeed * 0.62);
          } else {
            v.laneT %= 1;
          }
        }
      }
      const ptFar = v.lane!.curve.getPointAt(clamp(v.laneT, 0, 0.999));
      const tanFar = v.lane!.curve.getTangentAt(clamp(v.laneT, 0, 0.999));
      v.pos.set(ptFar.x, ptFar.y, ptFar.z);
      v.yaw = Math.atan2(tanFar.x, tanFar.z);
      return;
    }

    const fx = Math.sin(v.yaw);
    const fz = Math.cos(v.yaw);
    const dxP = playerPos.x - v.pos.x;
    const dzP = playerPos.z - v.pos.z;
    const fwdDist = dxP * fx + dzP * fz;
    const latDist = Math.abs(-dxP * fz + dzP * fx);
    let yieldAhead = fwdDist > 0 && fwdDist < 12 && latDist < 2.8;
    let stopSpeedCap = Infinity;

    // Also maintain safe following distance behind ahead vehicles moving in a compatible direction
    if (!yieldAhead) {
      for (const other of this.vehicles) {
        if (other === v) continue;
        const odx = other.pos.x - v.pos.x;
        const odz = other.pos.z - v.pos.z;
        if (Math.abs(odx) > 16 || Math.abs(odz) > 16) continue;
        const align = fx * Math.sin(other.yaw) + fz * Math.cos(other.yaw);
        if (align < 0.55) continue;
        const oFwd = odx * fx + odz * fz;
        const oLat = Math.abs(-odx * fz + odz * fx);
        if (oFwd > 0.5 && oFwd < 11.5 && oLat < 2.4) {
          yieldAhead = true;
          break;
        }
      }
    }

    // Yield for pedestrians crossing crosswalks or stepping onto roadways
    if (!yieldAhead && this.pedestrianAheadFn && this.pedestrianAheadFn(v.pos.x, v.pos.z, fx, fz)) {
      yieldAhead = true;
    }

    const isRoundabout = lane.id.startsWith("roundabout:");
    const sRemaining = (1 - v.laneT) * lane.length;

    // Pre-plan upcoming intersection turn 24m ahead & turn on blinkers ~20m BEFORE turning
    if (!v.turnCurve && !isRoundabout) {
      if (sRemaining < 24 && !v.upcomingNextLane) {
        const tanEnd = lane.curve.getTangentAt(0.96).setY(0).normalize();
        const pick = this.pickNextLane(v, lane, tanEnd);
        v.upcomingNextLane = pick;
        if (pick) {
          const nextTan = pick.curve.getTangentAt(0.08).setY(0).normalize();
          const crossY = tanEnd.z * nextTan.x - tanEnd.x * nextTan.z;
          const dot = tanEnd.x * nextTan.x + tanEnd.z * nextTan.z;
          v.upcomingTurnDir = dot < 0.94 ? (crossY > 0 ? "left" : "right") : null;
        } else {
          v.upcomingTurnDir = null;
        }
      }
      if (sRemaining < 22 && v.upcomingTurnDir) {
        v.npcSignal = v.upcomingTurnDir;
      }
    }

    // Traffic law compliance: red/amber traffic lights + roundabout entry yield
    if (!v.turnCurve && !isRoundabout && lane.endNodeId) {
      const endNode = this.bridge.roads.getNode(lane.endNodeId);
      const stopDist = sRemaining - 11.5;
      if (endNode?.kind === "signal" && this.trafficSignals && stopDist > -0.5 && stopDist < 34) {
        const tanEnd = lane.curve.getTangentAt(0.95).setY(0).normalize();
        const aspect = this.trafficSignals.getSignalForHeading(endNode.id, tanEnd.x, tanEnd.z);
        if (aspect === "red" || (aspect === "amber" && stopDist > 5.0)) {
          if (stopDist <= 1.4) {
            yieldAhead = true;
            stopSpeedCap = 0;
          } else {
            stopSpeedCap = Math.min(stopSpeedCap, Math.max(0, (stopDist - 0.8) * 1.1));
          }
        }
      } else if (endNode?.kind === "roundabout" && stopDist > -0.5 && stopDist < 16) {
        const rbLaneId = `roundabout:${endNode.id}`;
        const pEnd = lane.curve.getPointAt(0.96);
        for (const other of this.vehicles) {
          if (other === v || other.lane?.id !== rbLaneId) continue;
          const dRb = Math.hypot(other.pos.x - pEnd.x, other.pos.z - pEnd.z);
          if (dRb < 21) {
            yieldAhead = true;
            stopSpeedCap = 0;
            break;
          }
        }
      }
    }

    // Look ahead curvature slowdown so NPC cars brake smoothly before corners and accelerate out
    let curveSeverity = 0;
    if (v.turnCurve && v.turnLen) {
      const tCur = clamp(v.turnT ?? 0, 0, 0.99);
      const tLook = clamp(tCur + 7.5 / Math.max(4, v.turnLen), 0, 0.999);
      const a0 = v.turnCurve.getTangentAt(tCur);
      const a1 = v.turnCurve.getTangentAt(tLook);
      curveSeverity = Math.max(0, 1 - (a0.x * a1.x + a0.z * a1.z));
    } else {
      const tCur = clamp(v.laneT, 0, 0.99);
      const stepT = 10 / Math.max(12, lane.length);
      const tLook = isRoundabout ? (tCur + stepT) % 1 : clamp(tCur + stepT, 0, 0.999);
      const a0 = lane.curve.getTangentAt(tCur);
      const a1 = lane.curve.getTangentAt(tLook);
      curveSeverity = Math.max(0, 1 - (a0.x * a1.x + a0.z * a1.z));
    }

    const cornerCap = lerp(v.laneSpeed, Math.min(v.laneSpeed, 6.8), smoothstep(0.04, 0.48, curveSeverity));
    const targetSpd = yieldAhead ? 0 : Math.min(cornerCap, stopSpeedCap);
    const prevSpeed = v.speed;
    v.speed += (targetSpd - v.speed) * Math.min(1, dt * (yieldAhead || stopSpeedCap < 4 ? 5.2 : 3.2));
    v.npcBraking = yieldAhead || stopSpeedCap < v.laneSpeed * 0.7 || (v.speed < prevSpeed - 0.04 && targetSpd < v.speed - 0.6);

    const ds = Math.max(0, v.speed) * dt;

    // 1. Advance along active smooth intersection/roundabout turn spline when transitioning
    if (v.turnCurve && v.turnLen) {
      v.turnT = (v.turnT ?? 0) + ds / Math.max(2, v.turnLen);
      if (v.turnT >= 1 && v.turnNextLane) {
        const entered = v.turnNextLane;
        v.lane = entered;
        v.laneT = v.turnNextStartT ?? 0;
        v.laneSpeed = Math.min(entered.speedLimit * 0.85, v.spec.maxSpeed * 0.65);
        v.turnCurve = null;
        v.turnNextLane = null;
        v.upcomingNextLane = null;
        v.upcomingTurnDir = null;
        if (!entered.id.startsWith("roundabout:")) {
          v.npcSignal = null;
        }
      }
    }

    // 2. Advance along current lane and trigger smooth Bezier entry/exit arcs BEFORE endpoints
    if (!v.turnCurve) {
      const curLane = v.lane!;
      const curIsRoundabout = curLane.id.startsWith("roundabout:");

      if (curIsRoundabout) {
        v.laneT = (v.laneT + ds / Math.max(1, curLane.length)) % 1;
        if (v.roundaboutExitLane && typeof v.roundaboutExitT === "number") {
          const arcAheadT = (v.roundaboutExitT - v.laneT + 1) % 1;
          const arcAheadDist = arcAheadT * curLane.length;
          // Signal right 20m before exit, then smoothly peel off onto the exit street
          v.npcSignal = arcAheadDist < 20 ? "right" : null;
          if (arcAheadDist <= 6.2) {
            const exitLane = v.roundaboutExitLane;
            const enterT = Math.min(0.22, 4.5 / Math.max(12, exitLane.length));
            const p0 = curLane.curve.getPointAt(clamp(v.laneT, 0, 0.999));
            const t0 = curLane.curve.getTangentAt(clamp(v.laneT, 0, 0.999)).setY(0).normalize();
            const p3 = exitLane.curve.getPointAt(enterT);
            const t3 = exitLane.curve.getTangentAt(enterT).setY(0).normalize();
            const arc = this.buildTurnArc(p0, t0, p3, t3);
            v.turnCurve = arc.curve;
            v.turnLen = arc.length;
            v.turnT = 0;
            v.turnNextLane = exitLane;
            v.turnNextStartT = enterT;
            v.roundaboutExitLane = null;
            v.roundaboutExitT = undefined;
            v.npcSignal = "right";
          }
        }
      } else {
        v.laneT += ds / Math.max(1, curLane.length);
        const leadT = Math.min(0.22, 4.2 / Math.max(14, curLane.length));
        const triggerT = 1 - leadT;
        if (v.laneT >= triggerT) {
          const clampT = clamp(v.laneT, 0, 0.999);
          const p0 = curLane.curve.getPointAt(clampT);
          const t0 = curLane.curve.getTangentAt(clampT).setY(0).normalize();
          const pick = v.upcomingNextLane ?? this.pickNextLane(v, curLane, t0);
          v.upcomingNextLane = null;
          v.upcomingTurnDir = null;
          if (pick) {
            if (pick.id.startsWith("roundabout:")) {
              const closestT = this.findClosestLaneT(pick, p0);
              const entryT = (closestT + Math.min(0.10, 4.0 / Math.max(16, pick.length))) % 1;
              const p3 = pick.curve.getPointAt(entryT);
              const t3 = pick.curve.getTangentAt(entryT).setY(0).normalize();
              const arc = this.buildTurnArc(p0, t0, p3, t3);
              const exitPick = this.pickNextLane(v, pick, t0);
              v.roundaboutExitLane = exitPick;
              v.roundaboutExitT = exitPick ? this.findClosestLaneT(pick, exitPick.startPos) : undefined;
              v.turnCurve = arc.curve;
              v.turnLen = arc.length;
              v.turnT = 0;
              v.turnNextLane = pick;
              v.turnNextStartT = entryT;
              v.npcSignal = arc.turnDir ?? v.npcSignal ?? null;
            } else {
              const enterT = Math.min(0.22, 4.5 / Math.max(14, pick.length));
              const p3 = pick.curve.getPointAt(enterT);
              const t3 = pick.curve.getTangentAt(enterT).setY(0).normalize();
              const arc = this.buildTurnArc(p0, t0, p3, t3);
              v.turnCurve = arc.curve;
              v.turnLen = arc.length;
              v.turnT = 0;
              v.turnNextLane = pick;
              v.turnNextStartT = enterT;
              v.npcSignal = arc.turnDir ?? v.npcSignal ?? null;
            }
          } else {
            // Dead-end lane: make a smooth U-turn onto the opposite-direction lane instead of teleporting
            const oppId = curLane.id.endsWith(":fwd")
              ? curLane.id.replace(":fwd", ":rev")
              : curLane.id.endsWith(":rev")
                ? curLane.id.replace(":rev", ":fwd")
                : "";
            const opp = oppId ? this.bridge.roads.getLane(oppId) : undefined;
            if (opp) {
              const enterT = Math.min(0.22, 4.5 / Math.max(14, opp.length));
              const p3 = opp.curve.getPointAt(enterT);
              const t3 = opp.curve.getTangentAt(enterT).setY(0).normalize();
              const arc = this.buildTurnArc(p0, t0, p3, t3);
              v.turnCurve = arc.curve;
              v.turnLen = arc.length;
              v.turnT = 0;
              v.turnNextLane = opp;
              v.turnNextStartT = enterT;
              v.npcSignal = "left";
            } else {
              v.laneT = 0.99;
              v.speed = 0;
              v.npcSignal = null;
            }
          }
        }
      }
    }

    // 3. Evaluate position + pure-pursuit lookahead steering along whichever curve is active
    let pt: THREE.Vector3;
    let tan: THREE.Vector3;
    let ptAhead: THREE.Vector3;
    if (v.turnCurve && v.turnLen) {
      const t = clamp(v.turnT ?? 0, 0, 0.999);
      const tLook = clamp(t + 3.0 / Math.max(3, v.turnLen), 0, 0.999);
      pt = v.turnCurve.getPointAt(t);
      tan = v.turnCurve.getTangentAt(t);
      ptAhead = v.turnCurve.getPointAt(tLook);
    } else {
      const activeLane = v.lane!;
      const t = clamp(v.laneT, 0, 0.999);
      const stepLook = 3.0 / Math.max(10, activeLane.length);
      const tLook = activeLane.id.startsWith("roundabout:") ? (t + stepLook) % 1 : clamp(t + stepLook, 0, 0.999);
      pt = activeLane.curve.getPointAt(t);
      tan = activeLane.curve.getTangentAt(t);
      ptAhead = activeLane.curve.getPointAt(tLook);
    }

    const gy = this.bridge.groundHeightAt(pt.x, pt.z, pt.y + 2.0);
    v.pos.set(pt.x, gy, pt.z);

    const targetYaw = Math.atan2(tan.x, tan.z);
    const lookDx = ptAhead.x - v.pos.x;
    const lookDz = ptAhead.z - v.pos.z;
    const lookYaw = lookDx * lookDx + lookDz * lookDz > 0.15 ? Math.atan2(lookDx, lookDz) : targetYaw;

    // Smooth steering angle on front wheels & rate-capped yaw damping (never snap instantaneously)
    const desiredSteer = clamp(wrapAngle(lookYaw - v.yaw) * 1.45, -0.52, 0.52);
    v.steerAngle = damp(v.steerAngle, desiredSteer, 8.5, dt);
    const nextYaw = dampAngle(v.yaw, targetYaw, 10.5, dt);
    const maxYawStep = Math.min(4.8, Math.max(1.0, Math.abs(v.speed) / 3.2)) * dt;
    const stepYaw = clamp(wrapAngle(nextYaw - v.yaw), -maxYawStep, maxYawStep);
    v.yaw = wrapAngle(v.yaw + stepYaw);
    v.vx = Math.sin(v.yaw) * v.speed;
    v.vz = Math.cos(v.yaw) * v.speed;

    this.syncTransform(v, ds);
  }

  private syncTransform(v: DriveableVehicle, signedDist: number, dt = 0): void {
    const useSuspension = v === this.activeVehicle || !v.isNpcTraffic || !!v.airborne || v.crashTimer > 0;
    v.group.position.set(v.pos.x, v.pos.y + (useSuspension ? v.suspension.heave : 0), v.pos.z);
    if (!v.group.visible && v !== this.activeVehicle) return;

    if (useSuspension) {
      const pitch = v.airborne ? v.suspension.airPitch : v.suspension.groundPitch + v.suspension.pitch;
      const roll = v.airborne ? v.suspension.airRoll : v.suspension.groundRoll + v.suspension.roll;
      v.group.rotation.order = "YXZ";
      v.group.rotation.set(pitch, v.yaw, roll);
    } else {
      this.bridge.surfaceNormalAt(v.pos.x, v.pos.z, v.pos.y, this.normalTmp);
      this.yawQuat.setFromAxisAngle(this.up, v.yaw);
      this.pitchQuat.setFromUnitVectors(this.up, this.normalTmp);
      v.group.quaternion.copy(this.pitchQuat).multiply(this.yawQuat);
    }

    if (v.modelRoot) {
      if (v === this.activeVehicle && dt > 0) {
        const st = v.physState;
        const spinDeltas: [number, number, number, number] = [
          st.wheelOmega[0] * dt,
          st.wheelOmega[1] * dt,
          st.wheelOmega[2] * dt,
          st.wheelOmega[3] * dt,
        ];
        spinWheels(v.modelRoot, signedDist, v.steerAngle, st.steerAngles, spinDeltas);
      } else {
        spinWheels(v.modelRoot, signedDist, v.steerAngle * 0.65);
      }
      if (useSuspension) {
        applyWheelSuspension(v.modelRoot, v.suspension.wheelOffsets);
      }
    } else if (signedDist !== 0 || useSuspension) {
      const dRot = signedDist / 0.36;
      for (let i = 0; i < v.wheels.length; i++) {
        if (signedDist !== 0) v.wheels[i].rotation.x += dRot;
        if (i < 2) v.wheels[i].rotation.y = v.steerAngle * 0.7;
        if (useSuspension && i < 4) {
          v.wheels[i].position.y = 0.36 + v.suspension.wheelOffsets[i];
        }
      }
    }
  }

  dispose(): void {
    this.disposed = true;
    this.skidmarks.dispose();
    for (const v of this.vehicles) {
      if (v.modelRoot) disposeVehicleLights(v.modelRoot);
    }
    this.root.removeFromParent();
  }
}
