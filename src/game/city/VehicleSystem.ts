import * as THREE from "three";
import { type VehicleKitWorldBridge } from "./OpenWorldEngine";
import { type TrafficLane } from "./RoadNetwork";
import {
  TRAFFIC_COLORS,
  getCar,
  type CarId,
  type CarSpec,
  type TrafficId,
} from "../vehicles/catalog";
import { ModelLibrary, setDoorsOpen } from "../vehicles/ModelLibrary";
import { spinWheels } from "../vehicles/wheels";
import { addVehicleLights, disposeVehicleLights, updateVehicleLights } from "../vehicles/vehicleLights";
import { loadSave } from "../progression";

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
  group: THREE.Group;
  modelRoot: THREE.Group | null;
  wheels: THREE.Mesh[];
  pos: THREE.Vector3;
  yaw: number;
  speed: number; // m/s signed
  steerAngle: number;
  isNpcTraffic: boolean;
  lane?: TrafficLane | null;
  laneT: number;
  laneSpeed: number;
  driverActive: boolean;
  paintHex?: number;
  doorAnim: number;
  doorTimer: number;
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

function specFor(id: TrafficId): CarSpec {
  if (id === "semi" || id === "kraz") return TRUCK_SPECS[id];
  return getCar(id);
}

function buildFallbackMesh(
  id: TrafficId,
  colorHex: number,
): { placeholder: THREE.Group; wheels: THREE.Mesh[]; length: number; width: number } {
  const isTruck = id === "semi" || id === "kraz";
  const isSuv = id === "rangerover" || id === "audi";
  const w = isTruck ? 2.45 : isSuv ? 2.05 : 1.9;
  const h = isTruck ? 2.85 : isSuv ? 1.62 : 1.32;
  const l = id === "semi" ? 10.5 : id === "kraz" ? 7.2 : 4.55;

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
  private readonly aabbHit = new THREE.Box3();
  private readonly playerBox = new THREE.Box3();
  private disposed = false;
  private streamBusy = false;

  constructor(private readonly bridge: VehicleKitWorldBridge) {
    this.root.name = "WestgateVehicles";
    this.spawnAll();
    if (typeof window !== "undefined" && typeof fetch === "function") {
      const save = loadSave();
      void this.streamModel(save.selectedCar);
    }
  }

  private async streamModel(id: TrafficId): Promise<void> {
    if (this.disposed || this.streamBusy || this.library.has(id)) return;
    this.streamBusy = true;
    try {
      const loaded = await this.library.loadModel(id);
      if (this.disposed || !loaded) return;
      for (const v of this.vehicles) {
        if (v.modelId === id && !v.modelRoot) {
          this.attachLoadedModel(v);
        }
      }
    } finally {
      this.streamBusy = false;
    }
  }

  private attachLoadedModel(v: DriveableVehicle): void {
    const model = this.library.create(v.modelId, {
      paint: v.paintHex,
      player: !v.isNpcTraffic && v.id.endsWith("_0"),
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
    }
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
    group.add(fb.placeholder);

    const v: DriveableVehicle = {
      id,
      modelId,
      spec,
      length: fb.length,
      width: fb.width,
      group,
      modelRoot: null,
      wheels: fb.wheels,
      pos,
      yaw,
      speed: opts.speed ?? 0,
      steerAngle: 0,
      isNpcTraffic: opts.isNpcTraffic,
      lane: opts.lane ?? null,
      laneT: opts.laneT ?? 0,
      laneSpeed: opts.laneSpeed ?? 0,
      driverActive: false,
      paintHex,
      doorAnim: 0,
      doorTimer: 0,
    };

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

    // 1. Hero playable spawns across Westgate Bay (player's selected owned car curbside at spawn + all 8 Overtake models)
    const heroSpawns: Array<{ modelId: TrafficId; x: number; z: number; yawDeg: number; paintHex?: number }> = [
      { modelId: selectedId, x: 25.5, z: -80, yawDeg: -15, paintHex: selectedPaintHex }, // Curbside getaway beside Downtown spawn
      { modelId: "rangerover", x: 122, z: 32, yawDeg: 0 }, // Police HQ / Civic plaza
      { modelId: "audi", x: -395, z: -95, yawDeg: 90 }, // Midtown Grand Mall
      { modelId: "mercedes", x: -135, z: 332, yawDeg: -90 }, // Mirror Central Park
      { modelId: "ferrari", x: -698, z: 30, yawDeg: 180 }, // Del Sol Pier entrance
      { modelId: "challenger", x: -108, z: -968, yawDeg: 110 }, // Observatory Summit
      { modelId: "mustang", x: 648, z: 432, yawDeg: 90 }, // East Seaport Terminal
      { modelId: "r8", x: -108, z: 855, yawDeg: 90 }, // South Airport Terminal
      { modelId: "golf", x: 36, z: -64, yawDeg: 25 }, // Downtown Legion Square
    ];

    heroSpawns.forEach((hs, idx) => {
      const gy = this.bridge.groundHeightAt(hs.x, hs.z, 200);
      const pos = new THREE.Vector3(hs.x, gy, hs.z);
      const yaw = THREE.MathUtils.degToRad(hs.yawDeg);
      this.createVehicle(`hero_${hs.modelId}_${idx}`, hs.modelId, pos, yaw, {
        paintHex: hs.paintHex,
        isNpcTraffic: false,
      });
    });

    // 2. Ambient NPC road traffic along Westgate Bay's 149 connected lanes (Overtake cars + trucks)
    const npcPool: TrafficId[] = [
      "golf",
      "mustang",
      "challenger",
      "mercedes",
      "audi",
      "rangerover",
      "r8",
      "ferrari",
      "semi",
      "kraz",
    ];
    const spawns = this.bridge.sampleTrafficSpawnPoints(26, 38);
    spawns.forEach((sp, idx) => {
      const lane = this.bridge.roads.getLane(sp.laneId) ?? null;
      if (!lane) return;
      const modelId = npcPool[idx % npcPool.length];
      const paintHex = modelId === "semi" || modelId === "kraz" ? undefined : TRAFFIC_COLORS[idx % TRAFFIC_COLORS.length];
      const pos = sp.position.clone();
      pos.y = this.bridge.groundHeightAt(pos.x, pos.z, pos.y + 1.0);
      const spec = specFor(modelId);
      this.createVehicle(`npc_${idx}`, modelId, pos, sp.yaw, {
        paintHex,
        isNpcTraffic: true,
        lane,
        laneT: sp.t,
        laneSpeed: Math.min(sp.speedLimit * 0.72, spec.maxSpeed * 0.62),
        speed: 10 + (idx % 4) * 2.2,
      });
    });
  }

  /**
   * Summons or swaps the player's curbside personal vehicle in Westgate Bay
   * when they buy or select a car from the Dealership/Garage.
   */
  summonPlayerCar(carId: CarId, paintHexStr?: string | null, nearPos?: THREE.Vector3, yawRad?: number): DriveableVehicle {
    const paintHex = paintHexStr ? new THREE.Color(paintHexStr).getHex() : undefined;
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
        : new THREE.Vector3(25.5, 4.5, -80);
    spawnPos.y = this.bridge.groundHeightAt(spawnPos.x, spawnPos.z, spawnPos.y + 2.0);
    const yaw = yawRad ?? oldHero?.yaw ?? -0.26;

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

  findNearestEnterable(pos: THREE.Vector3, maxDist = 4.8): DriveableVehicle | null {
    let best: DriveableVehicle | null = null;
    let bestD2 = maxDist * maxDist;
    for (const v of this.vehicles) {
      if (v === this.activeVehicle) continue;
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
    if (this.activeVehicle === v) return;
    this.activeVehicle = v;
    v.driverActive = true;
    v.isNpcTraffic = false;
    v.lane = null;
    v.doorTimer = 0.28;
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
    v.driverActive = false;
    v.doorTimer = 0.28;
    this.activeVehicle = null;
    const leftX = -Math.cos(v.yaw);
    const leftZ = Math.sin(v.yaw);
    const exit = new THREE.Vector3(v.pos.x + leftX * (v.width * 0.5 + 1.15), v.pos.y, v.pos.z + leftZ * (v.width * 0.5 + 1.15));
    exit.y = this.bridge.groundHeightAt(exit.x, exit.z, v.pos.y + 1.6);
    return exit;
  }

  update(
    dt: number,
    input: VehicleInput,
    playerPos: THREE.Vector3,
    gripScale = 1.0,
    camera?: THREE.Camera,
    darkness = 0,
  ): void {
    const safeDt = Math.min(Math.max(dt, 0), 0.05);
    for (const v of this.vehicles) {
      const braking = v === this.activeVehicle ? input.handbrake || (input.throttle < -0.1 && v.speed > 0.5) : false;

      if (v === this.activeVehicle) {
        this.updatePlayerVehicle(v, safeDt, input, gripScale);
      } else if (v.isNpcTraffic && v.lane) {
        this.updateNpcTrafficVehicle(v, safeDt, playerPos);
      } else {
        // Coast parked/abandoned vehicles smoothly to rest
        if (Math.abs(v.speed) > 0.05) {
          v.speed *= Math.max(0, 1 - 3.0 * safeDt);
          this.advanceVehicleKinematics(v, safeDt);
        } else {
          v.speed = 0;
        }
      }

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
      if (!v.modelRoot && v.group.visible && !this.streamBusy && typeof window !== "undefined" && typeof fetch === "function") {
        void this.streamModel(v.modelId);
      }

      // Update per-vehicle headlights, taillights, and brake glow
      if (camera && v.modelRoot && v.group.visible && (d2 < 160 * 160 || v === this.activeVehicle)) {
        updateVehicleLights(v.modelRoot, camera, darkness, braking);
      }
    }
  }

  private updatePlayerVehicle(v: DriveableVehicle, dt: number, input: VehicleInput, gripScale: number): void {
    const phys = v.spec.physics;
    const maxRev = -v.spec.maxSpeed * 0.34;

    if (input.handbrake) {
      const decel = phys.brake * 1.35 * gripScale * dt;
      if (Math.abs(v.speed) <= decel) v.speed = 0;
      else v.speed -= Math.sign(v.speed) * decel;
    } else if (input.throttle > 0.05) {
      if (v.speed < -0.5) {
        v.speed += phys.brake * 1.4 * gripScale * dt;
      } else {
        const speedRatio = Math.max(0, v.speed / v.spec.maxSpeed);
        const pull = v.spec.accel * (1 - 0.58 * speedRatio * speedRatio);
        v.speed = Math.min(v.spec.maxSpeed, v.speed + pull * input.throttle * dt);
      }
    } else if (input.throttle < -0.05) {
      if (v.speed > 0.5) {
        v.speed = Math.max(0, v.speed - phys.brake * 1.3 * gripScale * dt);
      } else {
        v.speed = Math.max(maxRev, v.speed + v.spec.accel * 0.6 * input.throttle * dt);
      }
    } else {
      const drag = (1.6 + phys.drag * v.speed * v.speed * 18) * dt;
      if (Math.abs(v.speed) <= drag) v.speed = 0;
      else v.speed -= Math.sign(v.speed) * drag;
    }

    const speedFactor = Math.min(1, Math.abs(v.speed) / 4.2);
    const highSpeedTighten = 1 / (1 + phys.understeer * v.speed * v.speed);
    const targetSteer = input.steer * phys.maxSteer * highSpeedTighten * (0.45 + 0.55 * gripScale);
    v.steerAngle += (targetSteer - v.steerAngle) * Math.min(1, phys.steerResponse * dt);

    if (speedFactor > 0.02) {
      const dirSign = v.speed >= 0 ? 1 : -1;
      const yawRate = (v.speed / phys.wheelbase) * Math.tan(v.steerAngle * 0.85) * speedFactor * gripScale;
      v.yaw += yawRate * dirSign * dt;
    }

    this.advanceVehicleKinematics(v, dt);
  }

  private advanceVehicleKinematics(v: DriveableVehicle, dt: number): void {
    const prevX = v.pos.x;
    const prevZ = v.pos.z;
    const fx = Math.sin(v.yaw);
    const fz = Math.cos(v.yaw);
    const nextX = THREE.MathUtils.clamp(prevX + fx * v.speed * dt, -1180, 1180);
    const nextZ = THREE.MathUtils.clamp(prevZ + fz * v.speed * dt, -1180, 1180);

    const gy = this.bridge.groundHeightAt(nextX, nextZ, v.pos.y + 1.8);
    if (gy < -0.6) {
      v.speed *= -0.25;
      return;
    }

    const r = v.width * 0.52;
    this.playerBox.set(
      new THREE.Vector3(nextX - r, gy + 0.3, nextZ - r),
      new THREE.Vector3(nextX + r, gy + 1.7, nextZ + r),
    );
    const hits = this.bridge.spatialAABBs.queryRect(nextX - r, nextZ - r, nextX + r, nextZ + r);
    let blocked = false;
    for (const h of hits) {
      if (h.max.y <= gy + 0.45 || h.min.y >= gy + 1.75) continue;
      this.aabbHit.copy(h);
      if (this.aabbHit.intersectsBox(this.playerBox)) {
        blocked = true;
        break;
      }
    }

    if (blocked) {
      v.speed *= -0.2;
    } else {
      v.pos.set(nextX, gy, nextZ);
    }

    this.syncTransform(v, v.speed * dt);
  }

  private updateNpcTrafficVehicle(v: DriveableVehicle, dt: number, playerPos: THREE.Vector3): void {
    const lane = v.lane!;
    const distToPlayer = Math.hypot(v.pos.x - playerPos.x, v.pos.z - playerPos.z);
    if (distToPlayer > 680) {
      v.laneT = (v.laneT + (v.laneSpeed * dt) / Math.max(1, lane.length)) % 1;
      return;
    }

    const fx = Math.sin(v.yaw);
    const fz = Math.cos(v.yaw);
    const dxP = playerPos.x - v.pos.x;
    const dzP = playerPos.z - v.pos.z;
    const fwdDist = dxP * fx + dzP * fz;
    const latDist = Math.abs(-dxP * fz + dzP * fx);
    const yieldToPlayer = fwdDist > 0 && fwdDist < 12 && latDist < 2.8;

    const targetSpd = yieldToPlayer ? 0 : v.laneSpeed;
    v.speed += (targetSpd - v.speed) * Math.min(1, dt * 3.5);

    let activeLane = v.lane!;
    const ds = v.speed * dt;
    v.laneT += ds / Math.max(1, activeLane.length);
    if (v.laneT >= 1) {
      const nextLanes = this.bridge.getConnectedLanes(activeLane.id);
      if (nextLanes.length > 0) {
        const pick = nextLanes[Math.floor((v.pos.x * 13 + v.pos.z * 7) % nextLanes.length) & 0x7fffffff] ?? nextLanes[0];
        v.lane = pick;
        activeLane = pick;
        v.laneT = 0;
        v.laneSpeed = Math.min(pick.speedLimit * 0.72, v.spec.maxSpeed * 0.62);
      } else {
        v.laneT = 0;
      }
    }

    const pt = activeLane.curve.getPointAt(THREE.MathUtils.clamp(v.laneT, 0, 0.999));
    const tan = activeLane.curve.getTangentAt(THREE.MathUtils.clamp(v.laneT, 0, 0.999));
    const gy = this.bridge.groundHeightAt(pt.x, pt.z, pt.y + 2.0);
    v.pos.set(pt.x, gy, pt.z);
    v.yaw = Math.atan2(tan.x, tan.z);

    this.syncTransform(v, ds);
  }

  private syncTransform(v: DriveableVehicle, signedDist: number): void {
    v.group.position.copy(v.pos);
    this.bridge.surfaceNormalAt(v.pos.x, v.pos.z, v.pos.y, this.normalTmp);
    this.yawQuat.setFromAxisAngle(this.up, v.yaw);
    this.pitchQuat.setFromUnitVectors(this.up, this.normalTmp);
    v.group.quaternion.copy(this.pitchQuat).multiply(this.yawQuat);

    if (v.modelRoot) {
      spinWheels(v.modelRoot, signedDist, v.steerAngle * 0.65);
    } else if (signedDist !== 0) {
      const dRot = signedDist / 0.36;
      for (let i = 0; i < v.wheels.length; i++) {
        v.wheels[i].rotation.x += dRot;
        if (i < 2) v.wheels[i].rotation.y = v.steerAngle * 0.7;
      }
    }
  }

  dispose(): void {
    this.disposed = true;
    for (const v of this.vehicles) {
      if (v.modelRoot) disposeVehicleLights(v.modelRoot);
    }
    this.root.removeFromParent();
  }
}
