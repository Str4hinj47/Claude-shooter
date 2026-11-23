import * as THREE from "three";
import type { VehicleKitWorldBridge } from "./OpenWorldEngine";
import type { TrafficLane } from "./RoadNetwork";
import { clamp, damp } from "../../character/math";

export type VehicleClass = "sports" | "sedan" | "suv" | "police" | "pickup";

export interface VehicleSpec {
  cls: VehicleClass;
  name: string;
  length: number;
  width: number;
  height: number;
  maxSpeed: number; // m/s
  accel: number;
  reverseSpeed: number;
  turnRate: number; // rad/s
  colors: number[];
}

const VEHICLE_SPECS: Record<VehicleClass, VehicleSpec> = {
  sports: {
    cls: "sports",
    name: "Infernus GT",
    length: 4.35,
    width: 1.92,
    height: 1.24,
    maxSpeed: 42,
    accel: 22,
    reverseSpeed: 12,
    turnRate: 2.35,
    colors: [0xdc2626, 0xf59e0b, 0x0284c7, 0xf8fafc, 0x18181b],
  },
  sedan: {
    cls: "sedan",
    name: "Premier Sedan",
    length: 4.3,
    width: 1.84,
    height: 1.42,
    maxSpeed: 32,
    accel: 15,
    reverseSpeed: 10,
    turnRate: 2.1,
    colors: [0x334155, 0x1d4ed8, 0xd1d5db, 0x0f766e, 0x7f1d1d],
  },
  suv: {
    cls: "suv",
    name: "Patriot SUV",
    length: 4.55,
    width: 1.98,
    height: 1.72,
    maxSpeed: 29,
    accel: 13.5,
    reverseSpeed: 9,
    turnRate: 1.9,
    colors: [0x1e293b, 0x3f6212, 0x78716c, 0xf1f5f9, 0x7c2d12],
  },
  police: {
    cls: "police",
    name: "Westgate PD Interceptor",
    length: 4.4,
    width: 1.88,
    height: 1.46,
    maxSpeed: 37,
    accel: 19,
    reverseSpeed: 11,
    turnRate: 2.25,
    colors: [0x111827],
  },
  pickup: {
    cls: "pickup",
    name: "Bison 4x4",
    length: 4.7,
    width: 1.98,
    height: 1.66,
    maxSpeed: 30,
    accel: 14,
    reverseSpeed: 9.5,
    turnRate: 1.95,
    colors: [0x991b1b, 0x1e3a8a, 0xb45309, 0x475569],
  },
};

export interface DriveableVehicle {
  id: string;
  spec: VehicleSpec;
  group: THREE.Group;
  wheels: THREE.Mesh[];
  pos: THREE.Vector3;
  yaw: number;
  speed: number;
  steerAngle: number;
  isNpcTraffic: boolean;
  lane?: TrafficLane;
  laneT: number;
  laneSpeed: number;
  driverActive: boolean;
}

export interface VehicleInput {
  throttle: number; // -1..1
  steer: number; // -1..1 (positive = turn left)
  handbrake: boolean;
}

function buildVehicleMesh(spec: VehicleSpec, colorHex: number): { group: THREE.Group; wheels: THREE.Mesh[] } {
  const g = new THREE.Group();
  const bodyMat = new THREE.MeshStandardMaterial({ color: colorHex, roughness: 0.34, metalness: 0.48 });
  const whiteDoorMat = new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.42, metalness: 0.25 });
  const glassMat = new THREE.MeshStandardMaterial({ color: 0x111827, roughness: 0.16, metalness: 0.75 });
  const trimMat = new THREE.MeshStandardMaterial({ color: 0x1f2937, roughness: 0.72, metalness: 0.25 });
  const tireMat = new THREE.MeshStandardMaterial({ color: 0x111215, roughness: 0.92 });
  const rimMat = new THREE.MeshStandardMaterial({ color: 0xd1d5db, roughness: 0.35, metalness: 0.75 });
  const headMat = new THREE.MeshStandardMaterial({
    color: 0xfef9c3,
    emissive: 0xfef08a,
    emissiveIntensity: 1.6,
    roughness: 0.25,
  });
  const tailMat = new THREE.MeshStandardMaterial({
    color: 0xef4444,
    emissive: 0xdc2626,
    emissiveIntensity: 1.4,
    roughness: 0.3,
  });

  const w = spec.width;
  const l = spec.length;
  const chassisH = spec.cls === "sports" ? 0.56 : spec.cls === "suv" || spec.cls === "pickup" ? 0.78 : 0.66;
  const chassisY = 0.34 + chassisH * 0.5;

  // Lower chassis (+Z is forward!)
  const chassis = new THREE.Mesh(new THREE.BoxGeometry(w, chassisH, l), bodyMat);
  chassis.position.y = chassisY;
  chassis.castShadow = true;
  chassis.receiveShadow = true;
  g.add(chassis);

  // Police white side doors
  if (spec.cls === "police") {
    const door = new THREE.Mesh(new THREE.BoxGeometry(w + 0.03, chassisH * 0.85, l * 0.38), whiteDoorMat);
    door.position.set(0, chassisY, 0.05);
    g.add(door);
  }

  // Cabin greenhouse
  const cabH = spec.cls === "sports" ? 0.46 : spec.cls === "suv" ? 0.68 : 0.56;
  const cabL = spec.cls === "pickup" ? l * 0.38 : spec.cls === "suv" ? l * 0.66 : l * 0.52;
  const cabZ = spec.cls === "pickup" ? 0.38 : -0.18;
  const cab = new THREE.Mesh(new THREE.BoxGeometry(w * 0.84, cabH, cabL), glassMat);
  cab.position.set(0, chassisY + chassisH * 0.5 + cabH * 0.45, cabZ);
  cab.castShadow = true;
  g.add(cab);

  const roof = new THREE.Mesh(
    new THREE.BoxGeometry(w * 0.82, 0.08, cabL * 0.92),
    spec.cls === "police" ? whiteDoorMat : bodyMat,
  );
  roof.position.set(0, chassisY + chassisH * 0.5 + cabH * 0.9 + 0.02, cabZ);
  g.add(roof);

  // Police lightbar or Sports rear spoiler
  if (spec.cls === "police") {
    const barY = roof.position.y + 0.12;
    const redL = new THREE.Mesh(
      new THREE.BoxGeometry(0.45, 0.14, 0.24),
      new THREE.MeshStandardMaterial({ color: 0xef4444, emissive: 0xef4444, emissiveIntensity: 2.0 }),
    );
    redL.position.set(-0.26, barY, cabZ);
    const blueL = new THREE.Mesh(
      new THREE.BoxGeometry(0.45, 0.14, 0.24),
      new THREE.MeshStandardMaterial({ color: 0x3b82f6, emissive: 0x2563eb, emissiveIntensity: 2.0 }),
    );
    blueL.position.set(0.26, barY, cabZ);
    g.add(redL, blueL);
  } else if (spec.cls === "sports") {
    const wing = new THREE.Mesh(new THREE.BoxGeometry(w * 0.92, 0.08, 0.36), trimMat);
    wing.position.set(0, chassisY + chassisH * 0.5 + 0.26, -l * 0.44);
    g.add(wing);
  }

  // Front & rear bumpers + headlights (+Z) + taillights (-Z)
  const frontBumper = new THREE.Mesh(new THREE.BoxGeometry(w * 0.96, 0.22, 0.14), trimMat);
  frontBumper.position.set(0, 0.42, l * 0.5);
  const rearBumper = new THREE.Mesh(new THREE.BoxGeometry(w * 0.96, 0.22, 0.14), trimMat);
  rearBumper.position.set(0, 0.42, -l * 0.5);
  g.add(frontBumper, rearBumper);

  for (const sx of [-1, 1]) {
    const hl = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.14, 0.08), headMat);
    hl.position.set(sx * (w * 0.34), chassisY + 0.06, l * 0.5 + 0.02);
    const tl = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.14, 0.08), tailMat);
    tl.position.set(sx * (w * 0.34), chassisY + 0.08, -l * 0.5 - 0.02);
    g.add(hl, tl);
  }

  // 4 Wheels
  const wheelR = spec.cls === "suv" || spec.cls === "pickup" ? 0.39 : 0.34;
  const wheelGeo = new THREE.CylinderGeometry(wheelR, wheelR, 0.24, 14);
  wheelGeo.rotateZ(Math.PI * 0.5);
  const hubGeo = new THREE.CylinderGeometry(wheelR * 0.55, wheelR * 0.55, 0.26, 10);
  hubGeo.rotateZ(Math.PI * 0.5);
  const wheels: THREE.Mesh[] = [];
  const wz = l * 0.32;
  const wx = w * 0.47;
  for (const [x, z] of [
    [-wx, wz],
    [wx, wz],
    [-wx, -wz],
    [wx, -wz],
  ]) {
    const wm = new THREE.Mesh(wheelGeo, tireMat);
    const hub = new THREE.Mesh(hubGeo, rimMat);
    wm.add(hub);
    wm.position.set(x, wheelR, z);
    wm.castShadow = true;
    g.add(wm);
    wheels.push(wm);
  }

  return { group: g, wheels };
}

/**
 * Manages player-driveable vehicles and ambient NPC lane-following traffic
 * integrated via OpenWorldEngine's VehicleKitWorldBridge.
 */
export class WestgateVehicleManager {
  readonly root = new THREE.Group();
  readonly vehicles: DriveableVehicle[] = [];
  activeVehicle: DriveableVehicle | null = null;

  private readonly bridge: VehicleKitWorldBridge;
  private readonly aabbScratch: THREE.Box3[] = [];
  private readonly normalScratch = new THREE.Vector3(0, 1, 0);
  private readonly upScratch = new THREE.Vector3(0, 1, 0);
  private readonly quatYaw = new THREE.Quaternion();
  private readonly quatSlope = new THREE.Quaternion();
  private readonly yAxis = new THREE.Vector3(0, 1, 0);

  constructor(bridge: VehicleKitWorldBridge, parent: THREE.Object3D) {
    this.bridge = bridge;
    this.root.name = "WestgateVehicles";
    parent.add(this.root);
    this.spawnInitialFleet();
  }

  private spawnInitialFleet(): void {
    // 1. Hand-placed Hero Vehicles at key Westgate Bay landmarks
    const heroSpawns: Array<{ cls: VehicleClass; x: number; z: number; yawDeg: number; colorIdx?: number }> = [
      { cls: "sports", x: 25.5, z: -80, yawDeg: -15, colorIdx: 0 }, // Curbside getaway right beside Downtown spawn
      { cls: "police", x: 122, z: 32, yawDeg: 0, colorIdx: 0 }, // Police HQ curb
      { cls: "suv", x: -395, z: -95, yawDeg: 90, colorIdx: 3 }, // Midtown Grand Mall
      { cls: "sedan", x: -135, z: 332, yawDeg: -90, colorIdx: 1 }, // Mirror Central Park
      { cls: "sports", x: -698, z: 30, yawDeg: 180, colorIdx: 2 }, // Del Sol Pier entrance
      { cls: "pickup", x: -108, z: -968, yawDeg: 110, colorIdx: 2 }, // Observatory Summit
      { cls: "pickup", x: 648, z: 432, yawDeg: 90, colorIdx: 0 }, // East Seaport Terminal
      { cls: "sedan", x: -108, z: 855, yawDeg: 90, colorIdx: 0 }, // South Airport Terminal
    ];

    heroSpawns.forEach((hs, idx) => {
      const spec = VEHICLE_SPECS[hs.cls];
      const color = spec.colors[(hs.colorIdx ?? 0) % spec.colors.length];
      const { group, wheels } = buildVehicleMesh(spec, color);
      const gy = this.bridge.groundHeightAt(hs.x, hs.z, 200);
      const pos = new THREE.Vector3(hs.x, gy, hs.z);
      const yaw = THREE.MathUtils.degToRad(hs.yawDeg);
      const v: DriveableVehicle = {
        id: `hero_${hs.cls}_${idx}`,
        spec,
        group,
        wheels,
        pos,
        yaw,
        speed: 0,
        steerAngle: 0,
        isNpcTraffic: false,
        laneT: 0,
        laneSpeed: 0,
        driverActive: false,
      };
      this.syncTransform(v, 0);
      this.root.add(group);
      this.vehicles.push(v);
    });

    // 2. Ambient NPC Traffic Vehicles along RoadNetwork's 149 connected lanes
    const trafficClasses: VehicleClass[] = ["sedan", "suv", "pickup", "sports", "police"];
    const spawns = this.bridge.sampleTrafficSpawnPoints(26, 38);
    spawns.forEach((sp, idx) => {
      const lane = this.bridge.roads.getLane(sp.laneId) ?? null;
      if (!lane) return;
      const cls = trafficClasses[idx % trafficClasses.length];
      const spec = VEHICLE_SPECS[cls];
      const color = spec.colors[idx % spec.colors.length];
      const { group, wheels } = buildVehicleMesh(spec, color);
      const pos = sp.position.clone();
      pos.y = this.bridge.groundHeightAt(pos.x, pos.z, pos.y + 1.0);
      const v: DriveableVehicle = {
        id: `npc_${idx}`,
        spec,
        group,
        wheels,
        pos,
        yaw: sp.yaw,
        speed: 10 + (idx % 4) * 2.2,
        steerAngle: 0,
        isNpcTraffic: true,
        lane,
        laneT: sp.t,
        laneSpeed: Math.min(sp.speedLimit * 0.72, spec.maxSpeed * 0.62),
        driverActive: false,
      };
      this.syncTransform(v, 0);
      this.root.add(group);
      this.vehicles.push(v);
    });
  }

  findNearestEnterable(pos: THREE.Vector3, maxDist = 4.8): DriveableVehicle | null {
    let best: DriveableVehicle | null = null;
    let bestD2 = maxDist * maxDist;
    for (const v of this.vehicles) {
      if (v === this.activeVehicle) continue;
      if (Math.abs(v.pos.y - pos.y) > 2.6) continue;
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
    if (this.activeVehicle) this.activeVehicle.driverActive = false;
    v.driverActive = true;
    v.isNpcTraffic = false;
    v.lane = undefined;
    this.activeVehicle = v;
  }

  exitVehicle(): THREE.Vector3 | null {
    const v = this.activeVehicle;
    if (!v) return null;
    v.driverActive = false;
    v.speed *= 0.25;
    this.activeVehicle = null;

    // Try driver-side (-X local) exit, fall back to passenger-side (+X) or rear
    const leftX = -Math.cos(v.yaw);
    const leftZ = Math.sin(v.yaw);
    for (const offset of [2.1, -2.1, 0]) {
      const ex = clamp(v.pos.x + leftX * offset, -1180, 1180);
      const ez = clamp(v.pos.z + leftZ * offset, -1180, 1180);
      const ey = this.bridge.groundHeightAt(ex, ez, v.pos.y + 1.5);
      if (Math.abs(ey - v.pos.y) < 1.8) {
        return new THREE.Vector3(ex, ey, ez);
      }
    }
    return v.pos.clone();
  }

  update(dt: number, playerInput: VehicleInput, playerPos: THREE.Vector3): void {
    const safeDt = Math.min(0.05, dt);

    for (const v of this.vehicles) {
      if (v.driverActive) {
        this.stepPlayerVehicle(v, playerInput, safeDt);
      } else if (v.isNpcTraffic && v.lane) {
        this.stepNpcVehicle(v, safeDt, playerPos);
      } else if (Math.abs(v.speed) > 0.05) {
        // Coast parked/exited car to stop
        v.speed = damp(v.speed, 0, 3.2, safeDt);
        this.integrateVehicle(v, safeDt);
      }
    }
  }

  private stepPlayerVehicle(v: DriveableVehicle, input: VehicleInput, dt: number): void {
    const spec = v.spec;
    if (input.handbrake) {
      v.speed = damp(v.speed, 0, 5.5, dt);
    } else if (input.throttle > 0.05) {
      v.speed = Math.min(spec.maxSpeed, v.speed + spec.accel * input.throttle * dt);
    } else if (input.throttle < -0.05) {
      if (v.speed > 1.0) {
        v.speed = Math.max(0, v.speed + spec.accel * 1.65 * input.throttle * dt);
      } else {
        v.speed = Math.max(-spec.reverseSpeed, v.speed + spec.accel * 0.85 * input.throttle * dt);
      }
    } else {
      v.speed = damp(v.speed, 0, 1.35, dt);
    }

    const speedRatio = clamp(Math.abs(v.speed) / 7.5, 0, 1);
    const turnDir = v.speed >= -0.2 ? 1 : -1;
    const highSpeedScale = 1 - 0.36 * clamp(Math.abs(v.speed) / spec.maxSpeed, 0, 1);
    const targetSteer = input.steer * 0.45;
    v.steerAngle = damp(v.steerAngle, targetSteer, 12, dt);
    v.yaw += input.steer * spec.turnRate * speedRatio * highSpeedScale * turnDir * dt;

    this.integrateVehicle(v, dt);
  }

  private integrateVehicle(v: DriveableVehicle, dt: number): void {
    const fx = Math.sin(v.yaw);
    const fz = Math.cos(v.yaw);
    const nx = clamp(v.pos.x + fx * v.speed * dt, -1185, 1185);
    const nz = clamp(v.pos.z + fz * v.speed * dt, -1185, 1185);
    const gy = this.bridge.groundHeightAt(nx, nz, v.pos.y + 1.4);

    // Prevent driving off cliff drops into deep water (y < 0.6)
    if (gy < 0.6 && v.pos.y >= 1.2) {
      v.speed *= -0.25;
      return;
    }

    v.pos.set(nx, gy, nz);

    // Resolve against buildings / trees / poles in SpatialAABBGrid
    const r = v.spec.width * 0.55;
    const hits = this.bridge.spatialAABBs.queryRect(nx - r - 1, nz - r - 1, nx + r + 1, nz + r + 1, this.aabbScratch);
    let collided = false;
    for (let i = 0; i < hits.length; i++) {
      const b = hits[i];
      if (b.max.y <= v.pos.y + 0.45 || b.min.y >= v.pos.y + v.spec.height) continue;
      const cx = clamp(v.pos.x, b.min.x, b.max.x);
      const cz = clamp(v.pos.z, b.min.z, b.max.z);
      const dx = v.pos.x - cx;
      const dz = v.pos.z - cz;
      const d2 = dx * dx + dz * dz;
      if (d2 < r * r) {
        const d = Math.sqrt(d2);
        if (d > 1e-4) {
          const push = r - d;
          v.pos.x += (dx / d) * push;
          v.pos.z += (dz / d) * push;
        } else {
          v.pos.x -= fx * 0.5;
          v.pos.z -= fz * 0.5;
        }
        collided = true;
      }
    }
    if (collided) {
      v.speed *= -0.32;
    }

    v.pos.y = this.bridge.groundHeightAt(v.pos.x, v.pos.z, v.pos.y + 1.2);
    this.syncTransform(v, dt);
  }

  private stepNpcVehicle(v: DriveableVehicle, dt: number, playerPos: THREE.Vector3): void {
    const lane = v.lane!;
    // Only simulate NPCs within ~750m of player for crisp CPU budget
    const dp2 = (v.pos.x - playerPos.x) ** 2 + (v.pos.z - playerPos.z) ** 2;
    if (dp2 > 750 * 750) return;

    // Headway yield if player or another vehicle is directly ahead
    let blocked = false;
    const fx = Math.sin(v.yaw);
    const fz = Math.cos(v.yaw);
    const checkList: THREE.Vector3[] = [playerPos];
    for (const other of this.vehicles) {
      if (other !== v) checkList.push(other.pos);
    }
    for (let i = 0; i < checkList.length; i++) {
      const op = checkList[i];
      if (Math.abs(op.y - v.pos.y) > 2.2) continue;
      const dx = op.x - v.pos.x;
      const dz = op.z - v.pos.z;
      const dist2 = dx * dx + dz * dz;
      if (dist2 < 100 && dx * fx + dz * fz > 2.0) {
        blocked = true;
        break;
      }
    }

    const targetSpd = blocked ? 0 : v.laneSpeed;
    v.speed = damp(v.speed, targetSpd, blocked ? 6.0 : 2.5, dt);

    const len = Math.max(1, lane.length);
    v.laneT += (v.speed * dt) / len;
    if (v.laneT >= 1) {
      const nexts = this.bridge.getConnectedLanes(lane.id);
      if (nexts.length > 0) {
        const pick = nexts[(Math.floor(v.pos.x + v.pos.z) >>> 0) % nexts.length];
        v.lane = pick;
        v.laneT = 0;
        v.laneSpeed = Math.min(pick.speedLimit * 0.72, v.spec.maxSpeed * 0.62);
      } else {
        v.laneT = 0;
      }
    }

    const activeLane = v.lane!;
    const pt = activeLane.curve.getPointAt(clamp(v.laneT, 0, 1));
    const tan = activeLane.curve.getTangentAt(clamp(v.laneT, 0, 1));
    v.pos.copy(pt);
    v.yaw = Math.atan2(tan.x, tan.z);
    this.syncTransform(v, dt);
  }

  private syncTransform(v: DriveableVehicle, dt: number): void {
    v.group.position.copy(v.pos);
    const n = this.bridge.surfaceNormalAt(v.pos.x, v.pos.z, v.pos.y + 0.5, this.normalScratch);
    this.quatYaw.setFromAxisAngle(this.yAxis, v.yaw);
    this.quatSlope.setFromUnitVectors(this.upScratch, n);
    v.group.quaternion.multiplyQuaternions(this.quatSlope, this.quatYaw);

    const wheelSpin = v.speed * dt * 2.6;
    for (let i = 0; i < v.wheels.length; i++) {
      v.wheels[i].rotation.x += wheelSpin;
    }
  }

  dispose(): void {
    this.activeVehicle = null;
    this.vehicles.length = 0;
  }
}
