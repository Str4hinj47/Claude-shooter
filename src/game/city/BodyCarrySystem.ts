import * as THREE from "three";
import { clamp, damp, dampAngle } from "../../character/math";
import type { CombatFX, Sfx } from "../fx";
import type { DriveableVehicle } from "./VehicleSystem";
import type { DriveableBoat } from "../vehicles/water/BoatSystem";
import {
  applyBoatDeckPose,
  applyCarriedCorpsePose,
  applyProceduralDeathPose,
  extractCorpseBoneRig,
  type CorpseBoneRig,
  type DeathStyle,
} from "./CorpsePose";

export type CorpseState = "dying" | "ground" | "carried" | "trunk" | "boat" | "sinking" | "disposed";

export interface DeadBodyRecord {
  id: number;
  roleId: string;
  root: THREE.Group;
  posePivot: THREE.Group;
  model: THREE.Group;
  boneRig: CorpseBoneRig;
  pos: THREE.Vector3;
  yaw: number;
  vel: THREE.Vector3;
  state: CorpseState;
  deathT: number;
  deathStyle: DeathStyle;
  bloodPoolSpawned: boolean;
  trunkVehicleId: string | null;
  boatId: string | null;
  floatTimer: number;
  sinkDepth: number;
}

export class BodyCarrySystem {
  readonly group = new THREE.Group();
  readonly bodies: DeadBodyRecord[] = [];
  carriedBody: DeadBodyRecord | null = null;

  private seq = 1;
  private time = 0;
  private prevCarrierPos = new THREE.Vector3();
  private prevCarrierVel = new THREE.Vector3();
  private prevCarrierYaw = 0;
  private hasPrevCarrier = false;

  // Spring-damper physical carry sway & vertical weight bounce
  private swayX = 0;
  private swayZ = 0;
  private swayVx = 0;
  private swayVz = 0;
  private bounceY = 0;
  private bounceVy = 0;
  private bloodDripTimer = 0;

  onOceanDisposed?: (body: DeadBodyRecord, deepSea: boolean) => void;

  constructor() {
    this.group.name = "WestgateDeadBodies";
  }

  get isCarrying(): boolean {
    return this.carriedBody !== null;
  }

  /**
   * Registers a killed pedestrian or officer as a persistent, physical dead body
   * with procedural dying collapse animation & carryable bone rig.
   */
  registerDeadBody(opts: {
    roleId: string;
    x: number;
    y: number;
    z: number;
    yaw: number;
    model: THREE.Group;
    deathStyle?: DeathStyle;
    alreadyCollapsed?: boolean;
  }): DeadBodyRecord {
    // Cap active corpses at 24 so memory stays lean
    if (this.bodies.length >= 24) {
      const idx = this.bodies.findIndex((b) => b.state === "disposed" || b.state === "ground");
      if (idx >= 0) {
        const old = this.bodies[idx];
        this.group.remove(old.root);
        this.bodies.splice(idx, 1);
      }
    }

    const root = new THREE.Group();
    const posePivot = new THREE.Group();
    root.add(posePivot);

    opts.model.position.set(0, 0, 0);
    opts.model.rotation.set(0, 0, 0);
    posePivot.add(opts.model);
    root.position.set(opts.x, opts.y, opts.z);
    root.rotation.set(0, opts.yaw, 0);
    this.group.add(root);

    const boneRig = extractCorpseBoneRig(opts.model);
    const styles: DeathStyle[] = ["back", "front", "side"];
    const deathStyle = opts.deathStyle ?? styles[this.seq % styles.length];

    const rec: DeadBodyRecord = {
      id: this.seq++,
      roleId: opts.roleId,
      root,
      posePivot,
      model: opts.model,
      boneRig,
      pos: new THREE.Vector3(opts.x, opts.y, opts.z),
      yaw: opts.yaw,
      vel: new THREE.Vector3(),
      state: opts.alreadyCollapsed ? "ground" : "dying",
      deathT: opts.alreadyCollapsed ? 1.1 : 0,
      deathStyle,
      bloodPoolSpawned: !!opts.alreadyCollapsed,
      trunkVehicleId: null,
      boatId: null,
      floatTimer: 0,
      sinkDepth: 0,
    };

    if (opts.alreadyCollapsed) {
      const p = applyProceduralDeathPose(boneRig, 1.1, deathStyle);
      posePivot.rotation.set(p.pitch, 0, p.roll);
      posePivot.position.set(0, p.yDrop, p.zSlide);
    }

    this.bodies.push(rec);
    return rec;
  }

  findNearestGroundBody(pos: THREE.Vector3, maxDist = 2.4): DeadBodyRecord | null {
    if (this.carriedBody) return null;
    let best: DeadBodyRecord | null = null;
    let bestD2 = maxDist * maxDist;
    for (const b of this.bodies) {
      if (b.state !== "ground" && (b.state !== "dying" || b.deathT < 0.7)) continue;
      if (Math.abs(b.pos.y - pos.y) > 2.0) continue;
      const d2 = (b.pos.x - pos.x) ** 2 + (b.pos.z - pos.z) ** 2;
      if (d2 < bestD2) {
        bestD2 = d2;
        best = b;
      }
    }
    return best;
  }

  pickUpBody(body: DeadBodyRecord): boolean {
    if (this.carriedBody) return false;
    if (body.state !== "ground" && body.state !== "dying" && body.state !== "trunk" && body.state !== "boat") {
      return false;
    }
    body.state = "carried";
    body.trunkVehicleId = null;
    body.boatId = null;
    body.root.visible = true;
    this.carriedBody = body;
    this.swayX = 0;
    this.swayZ = 0;
    this.swayVx = 0;
    this.swayVz = 0;
    this.bounceY = -0.06;
    this.bounceVy = 0.45;
    this.bloodDripTimer = 0.8;
    return true;
  }

  dropCarriedBody(playerPos: THREE.Vector3, playerYaw: number, groundAt: (x: number, z: number, y: number) => number): DeadBodyRecord | null {
    const b = this.carriedBody;
    if (!b) return null;
    this.carriedBody = null;
    const fx = Math.sin(playerYaw);
    const fz = Math.cos(playerYaw);
    const dx = playerPos.x + fx * 0.85;
    const dz = playerPos.z + fz * 0.85;
    const gy = groundAt(dx, dz, playerPos.y + 1.2);
    b.pos.set(dx, gy, dz);
    b.yaw = playerYaw + Math.PI * 0.5;
    b.vel.set(fx * 1.1, 0, fz * 1.1);
    b.deathT = 0.68; // Settle bounce onto ground
    b.state = "dying";
    b.root.visible = true;
    b.root.position.copy(b.pos);
    b.root.rotation.set(0, b.yaw, 0);
    return b;
  }

  /** Put the carried dead body into a nearby car's trunk */
  stashInTrunk(vehicle: DriveableVehicle, fx?: CombatFX, sfx?: Sfx): boolean {
    const b = this.carriedBody;
    if (!b) return false;
    if (!vehicle.trunkBodies) vehicle.trunkBodies = [];
    const maxCap = vehicle.length > 5.0 || /van|delivery|offroad|crossover|rangerover|garbage|ambulance/i.test(vehicle.modelId) ? 3 : 2;
    if (vehicle.trunkBodies.length >= maxCap) return false;

    this.carriedBody = null;
    b.state = "trunk";
    b.trunkVehicleId = vehicle.id;
    b.root.visible = false;
    vehicle.trunkBodies.push(b);
    // Suspension weight dip & latch sound
    vehicle.vy = (vehicle.vy ?? 0) - 0.55;
    vehicle.doorTimer = Math.max(vehicle.doorTimer, 0.45);
    sfx?.trunkThud();
    if (fx) {
      const fxPos = this.getTrunkWorldPos(vehicle);
      fx.bloodDrip(fxPos.x, fxPos.y - 0.3, fxPos.z);
    }
    return true;
  }

  /** Retrieve the most recent dead body from a car's trunk back onto the player's shoulder */
  takeFromTrunk(vehicle: DriveableVehicle, sfx?: Sfx): DeadBodyRecord | null {
    if (this.carriedBody) return null;
    if (!vehicle.trunkBodies || vehicle.trunkBodies.length === 0) return null;
    const b = vehicle.trunkBodies.pop()!;
    b.trunkVehicleId = null;
    sfx?.trunkThud();
    this.pickUpBody(b);
    return b;
  }

  getTrunkWorldPos(v: DriveableVehicle, out = new THREE.Vector3()): THREE.Vector3 {
    const fx = Math.sin(v.yaw);
    const fz = Math.cos(v.yaw);
    return out.set(
      v.pos.x - fx * (v.length * 0.5 + 0.35),
      v.pos.y + 0.65,
      v.pos.z - fz * (v.length * 0.5 + 0.35),
    );
  }

  findNearestTrunkVehicle(
    pos: THREE.Vector3,
    vehicles: readonly DriveableVehicle[],
    maxDist = 3.1,
  ): DriveableVehicle | null {
    let best: DriveableVehicle | null = null;
    let bestD2 = maxDist * maxDist;
    const tmp = new THREE.Vector3();
    for (const v of vehicles) {
      if (Math.abs(v.pos.y - pos.y) > 2.4) continue;
      this.getTrunkWorldPos(v, tmp);
      const d2 = (tmp.x - pos.x) ** 2 + (tmp.z - pos.z) ** 2;
      if (d2 < bestD2) {
        bestD2 = d2;
        best = v;
      }
    }
    return best;
  }

  /** Board a boat while carrying a dead body: stows the corpse visibly on deck */
  boardBoatWithCarriedBody(boat: DriveableBoat): boolean {
    const b = this.carriedBody;
    if (!b || boat.stowedBody) return false;
    this.carriedBody = null;
    b.state = "boat";
    b.boatId = boat.id;
    b.root.visible = true;
    boat.stowedBody = b;
    return true;
  }

  /** Disembark boat while a body is still on deck: lifts the body back onto player's shoulder */
  disembarkBoatWithBody(boat: DriveableBoat): boolean {
    const b = boat.stowedBody;
    if (!b || this.carriedBody) return false;
    boat.stowedBody = null;
    b.boatId = null;
    this.pickUpBody(b);
    return true;
  }

  /** Dump the body from the boat deck (or carried shoulder) overboard into the ocean! */
  dumpBodyIntoWater(
    boat: DriveableBoat | null,
    playerPos: THREE.Vector3,
    playerYaw: number,
    fx?: CombatFX,
    sfx?: Sfx,
  ): DeadBodyRecord | null {
    let b: DeadBodyRecord | null = null;
    let launchYaw = playerYaw;
    let origin = playerPos;

    if (boat && boat.stowedBody) {
      b = boat.stowedBody;
      boat.stowedBody = null;
      b.boatId = null;
      // Throw off starboard side of boat
      launchYaw = boat.yaw + Math.PI * 0.5;
      origin = boat.pos;
    } else if (this.carriedBody) {
      b = this.carriedBody;
      this.carriedBody = null;
      launchYaw = playerYaw;
    }
    if (!b) return null;

    const lx = Math.sin(launchYaw);
    const lz = Math.cos(launchYaw);
    b.state = "sinking";
    b.floatTimer = 0;
    b.sinkDepth = 0;
    b.root.visible = true;
    b.pos.set(origin.x + lx * 1.4, Math.max(0.55, origin.y + 0.65), origin.z + lz * 1.4);
    b.vel.set(lx * 3.8, 2.3, lz * 3.8);
    b.yaw = launchYaw;
    sfx?.trunkThud();
    void fx;
    return b;
  }

  update(
    dt: number,
    carrierPos: THREE.Vector3,
    carrierYaw: number,
    carrierCrouching: boolean,
    carrierDriving: boolean,
    vehicles: readonly DriveableVehicle[],
    boats: readonly DriveableBoat[],
    groundAt: (x: number, z: number, y: number) => number,
    terrainAt: (x: number, z: number) => number,
    fx?: CombatFX,
    sfx?: Sfx,
  ): void {
    const cdt = Math.min(Math.max(dt, 0), 0.05);
    this.time += cdt;

    // 1. Update carrier physical acceleration & yaw turn rate for spring-damper limb sway
    if (this.hasPrevCarrier && cdt > 1e-4) {
      const vx = (carrierPos.x - this.prevCarrierPos.x) / cdt;
      const vz = (carrierPos.z - this.prevCarrierPos.z) / cdt;
      const vy = (carrierPos.y - this.prevCarrierPos.y) / cdt;
      const ax = clamp((vx - this.prevCarrierVel.x) / cdt, -18, 18);
      const az = clamp((vz - this.prevCarrierVel.z) / cdt, -18, 18);
      const yawDelta = Math.atan2(Math.sin(carrierYaw - this.prevCarrierYaw), Math.cos(carrierYaw - this.prevCarrierYaw));
      const yawRate = clamp(yawDelta / cdt, -8, 8);

      const fwdX = Math.sin(carrierYaw);
      const fwdZ = Math.cos(carrierYaw);
      const rgtX = -Math.cos(carrierYaw);
      const rgtZ = Math.sin(carrierYaw);

      const localFwdAcc = ax * fwdX + az * fwdZ;
      const localLatAcc = ax * rgtX + az * rgtZ + yawRate * 1.8;
      const walkBob = Math.hypot(vx, vz) > 0.35 ? Math.sin(this.time * 9.5) * 0.14 : 0;

      // Spring-damper integration (pendulum inertia for dangling limbs/head)
      const k = 34;
      const d = 6.2;
      this.swayVx += (-k * this.swayX - d * this.swayVx - localLatAcc * 0.16) * cdt;
      this.swayVz += (-k * this.swayZ - d * this.swayVz - localFwdAcc * 0.14) * cdt;
      this.bounceVy += (-48 * this.bounceY - 7.5 * this.bounceVy - vy * 0.45 + walkBob * 6.5) * cdt;

      this.swayX = clamp(this.swayX + this.swayVx * cdt, -0.75, 0.75);
      this.swayZ = clamp(this.swayZ + this.swayVz * cdt, -0.75, 0.75);
      this.bounceY = clamp(this.bounceY + this.bounceVy * cdt, -0.22, 0.22);

      this.prevCarrierVel.set(vx, vy, vz);
    } else {
      this.hasPrevCarrier = true;
    }
    this.prevCarrierPos.copy(carrierPos);
    this.prevCarrierYaw = carrierYaw;

    // 2. Update all corpses
    for (const b of this.bodies) {
      if (b.state === "disposed") continue;

      if (b.state === "carried") {
        b.root.visible = !carrierDriving;
        if (!carrierDriving) {
          const fwdX = Math.sin(carrierYaw);
          const fwdZ = Math.cos(carrierYaw);
          const rgtX = -Math.cos(carrierYaw);
          const rgtZ = Math.sin(carrierYaw);
          const shoulderY = carrierCrouching ? 0.98 : 1.38;

          b.pos.set(
            carrierPos.x + rgtX * 0.24 + fwdX * 0.04,
            carrierPos.y + shoulderY + this.bounceY * 0.16,
            carrierPos.z + rgtZ * 0.24 + fwdZ * 0.04,
          );
          b.yaw = dampAngle(b.yaw, carrierYaw + Math.PI, 16, cdt);
          b.root.position.copy(b.pos);
          b.root.rotation.order = "YXZ";
          b.root.rotation.set(0, b.yaw, 0);

          // Tilt torso horizontally across the carrier's right shoulder
          b.posePivot.rotation.set(1.42 + this.swayZ * 0.18, 0, -0.28 + this.swayX * 0.22);
          b.posePivot.position.set(0, 0.05, -0.45);
          applyCarriedCorpsePose(b.boneRig, this.swayX, this.swayZ, this.bounceY, this.time);

          if (fx) {
            this.bloodDripTimer -= cdt;
            if (this.bloodDripTimer <= 0) {
              this.bloodDripTimer = 1.6 + Math.random() * 1.4;
              const gy = groundAt(b.pos.x, b.pos.z, carrierPos.y + 0.5);
              if (gy > 0.2) fx.bloodDrip(b.pos.x, gy, b.pos.z);
            }
          }
        }
        continue;
      }

      if (b.state === "trunk") {
        const veh = vehicles.find((v) => v.id === b.trunkVehicleId);
        if (veh) {
          this.getTrunkWorldPos(veh, b.pos);
          b.root.position.copy(b.pos);
          b.root.visible = false;
        }
        continue;
      }

      if (b.state === "boat") {
        const boat = boats.find((bt) => bt.id === b.boatId);
        if (boat) {
          const fxB = Math.sin(boat.yaw);
          const fzB = Math.cos(boat.yaw);
          b.pos.set(boat.pos.x - fxB * 1.25, boat.pos.y + 0.68, boat.pos.z - fzB * 1.25);
          b.yaw = boat.yaw + Math.PI * 0.5;
          b.root.position.copy(b.pos);
          b.root.rotation.order = "YXZ";
          b.root.rotation.set(boat.pitch, b.yaw, boat.roll);
          b.posePivot.rotation.set(-Math.PI * 0.48, 0, 0);
          b.posePivot.position.set(0, 0.11, -0.35);
          applyBoatDeckPose(b.boneRig, this.time);
        }
        continue;
      }

      if (b.state === "dying" || b.state === "ground") {
        if (b.state === "dying") {
          b.deathT += cdt;
          const p = applyProceduralDeathPose(b.boneRig, b.deathT, b.deathStyle);
          b.posePivot.rotation.set(p.pitch, 0, p.roll);
          b.posePivot.position.set(0, p.yDrop, p.zSlide);

          const gy = groundAt(b.pos.x, b.pos.z, b.pos.y + 1.2);
          b.pos.y = damp(b.pos.y, gy, 14, cdt);
          b.root.position.copy(b.pos);
          b.root.rotation.set(0, b.yaw, 0);

          if (b.deathT >= 0.42 && !b.bloodPoolSpawned && fx && gy > 0.15) {
            b.bloodPoolSpawned = true;
            fx.spawnBloodPool(b.pos.x, gy, b.pos.z, 0.92);
          }
          if (b.deathT >= 1.15) {
            b.state = "ground";
          }
        }
        continue;
      }

      if (b.state === "sinking") {
        const waterSurfaceY = 0.0;
        const floorY = terrainAt(b.pos.x, b.pos.z);

        if (b.pos.y > waterSurfaceY + 0.05 && b.floatTimer === 0) {
          // Ballistic arc through air until splashing into water
          b.vel.y -= 15.5 * cdt;
          b.pos.addScaledVector(b.vel, cdt);
          if (b.pos.y <= waterSurfaceY + 0.05) {
            b.pos.y = waterSurfaceY + 0.05;
            b.vel.set(0, 0, 0);
            b.floatTimer = 0.01;
            fx?.waterSplash(new THREE.Vector3(b.pos.x, waterSurfaceY + 0.1, b.pos.z), 1.35);
            sfx?.splash();
          }
        } else {
          // Bob briefly on surface, then sink into the ocean depths
          b.floatTimer += cdt;
          if (b.floatTimer > 0.75) {
            b.sinkDepth += 1.35 * cdt;
          }
          const waveBob = Math.sin(b.pos.x * 0.08 + this.time * 2.0) * 0.09;
          const targetY = waterSurfaceY + waveBob - b.sinkDepth;
          b.pos.y = Math.max(floorY - 0.15, targetY);
          b.posePivot.rotation.set(-Math.PI * 0.48, 0, Math.sin(this.time * 1.4) * 0.08);
          b.posePivot.position.set(0, 0.1, -0.3);

          if (b.sinkDepth > 2.6 || b.pos.y <= floorY - 0.05) {
            b.state = "disposed";
            b.root.visible = false;
            b.root.removeFromParent();
            const deepSea = floorY < -1.2;
            this.onOceanDisposed?.(b, deepSea);
          }
        }
        b.root.position.copy(b.pos);
        b.root.rotation.set(0, b.yaw, 0);
      }
    }
  }
}
