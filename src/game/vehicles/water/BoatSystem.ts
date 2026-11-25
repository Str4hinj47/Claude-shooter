import * as THREE from "three";
import { clamp, damp, wrapAngle } from "../../../character/math";
import { fitGlbToDimension, loadCityGlb } from "../../city/PropModels";
import type { DeadBodyRecord } from "../../city/BodyCarrySystem";

export interface BoatInput {
  throttle: number; // W/S
  steer: number;    // A/D
}

export interface DriveableBoat {
  id: string;
  name: string;
  isStarter?: boolean;
  pos: THREE.Vector3;
  yaw: number;
  speed: number;
  pitch: number;
  roll: number;
  group: THREE.Group;
  stowedBody?: DeadBodyRecord | null;
}

export const STARTER_BOAT_DOCK = { x: -726, z: 486, yawDeg: 270 } as const;

/**
 * Multi-point wave-buoyancy & hydrofoil planing Speedboat system for Westgate Bay's
 * ocean, harbor, river, and Venice canals.
 */
export class BoatSystem {
  readonly group = new THREE.Group();
  readonly boats: DriveableBoat[] = [];
  activeBoat: DriveableBoat | null = null;
  private animT = 0;
  private readonly terrainAt: (x: number, z: number) => number;

  constructor(terrainAt: (x: number, z: number) => number) {
    this.group.name = "westgate-boats";
    this.terrainAt = terrainAt;
    this.spawnBoats();
  }

  private buildSpeedboatMesh(accentHex: number): THREE.Group {
    const g = new THREE.Group();
    const hullMat = new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.22, metalness: 0.35 });
    const stripeMat = new THREE.MeshStandardMaterial({ color: accentHex, roughness: 0.25, metalness: 0.55 });
    const deckMat = new THREE.MeshStandardMaterial({ color: 0x334155, roughness: 0.72 });
    const glassMat = new THREE.MeshStandardMaterial({
      color: 0x0f172a,
      roughness: 0.08,
      metalness: 0.85,
      transparent: true,
      opacity: 0.75,
    });
    const darkMat = new THREE.MeshStandardMaterial({ color: 0x18181b, roughness: 0.65, metalness: 0.45 });

    const hull = new THREE.Mesh(new THREE.BoxGeometry(2.1, 0.78, 5.4), hullMat);
    hull.position.set(0, 0.25, 0);
    hull.castShadow = true;
    const bow = new THREE.Mesh(new THREE.ConeGeometry(1.08, 1.85, 4), hullMat);
    bow.rotation.y = Math.PI * 0.25;
    bow.rotation.x = Math.PI * 0.5;
    bow.scale.set(1.38, 1.0, 0.52);
    bow.position.set(0, 0.28, 3.55);
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(2.16, 0.22, 5.1), stripeMat);
    stripe.position.set(0, 0.44, 0);
    const cockpit = new THREE.Mesh(new THREE.BoxGeometry(1.65, 0.2, 2.8), deckMat);
    cockpit.position.set(0, 0.6, -0.45);
    const windshield = new THREE.Mesh(new THREE.BoxGeometry(1.68, 0.46, 0.14), glassMat);
    windshield.position.set(0, 0.88, 1.05);
    windshield.rotation.x = -0.55;
    const outboard = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.72, 0.44), darkMat);
    outboard.position.set(0, 0.42, -2.85);

    g.add(hull, bow, stripe, cockpit, windshield, outboard);
    return g;
  }

  private spawnBoats(): void {
    const spots = [
      {
        id: "boat_starter",
        name: "Bayliner Starter Skiff (Personal)",
        isStarter: true,
        glb: "speedboat.glb",
        len: 5.8,
        draft: -0.24,
        x: STARTER_BOAT_DOCK.x,
        z: STARTER_BOAT_DOCK.z,
        yawDeg: STARTER_BOAT_DOCK.yawDeg,
        hex: 0x22d3ee,
      },
      { id: "boat_delsol", name: "Sunseeker Speedboat", isStarter: false, glb: "speedboat.glb", len: 6.5, draft: -0.26, x: -772, z: 22, yawDeg: 270, hex: 0x0ea5e9 },
      { id: "boat_harbor", name: "Westgate Offshore Cruiser", isStarter: false, glb: "cruiser_boat.glb", len: 9.5, draft: -0.35, x: 430, z: 245, yawDeg: 180, hex: 0xef4444 },
    ];
    for (const s of spots) {
      const yaw = THREE.MathUtils.degToRad(s.yawDeg);
      const mesh = this.buildSpeedboatMesh(s.hex);
      mesh.position.set(s.x, 0, s.z);
      mesh.rotation.y = yaw;
      this.group.add(mesh);
      const boat: DriveableBoat = {
        id: s.id,
        name: s.name,
        isStarter: s.isStarter,
        pos: new THREE.Vector3(s.x, 0, s.z),
        yaw,
        speed: 0,
        pitch: 0,
        roll: 0,
        group: mesh,
      };
      this.boats.push(boat);

      void loadCityGlb(s.glb).then((scene) => {
        if (!scene) return;
        const fitted = fitGlbToDimension(scene, "z", s.len, s.draft);
        boat.group.clear();
        boat.group.add(fitted);
      });
    }
  }

  getStarterBoat(): DriveableBoat | null {
    return this.boats.find((b) => b.isStarter) ?? this.boats[0] ?? null;
  }

  /**
   * Moves the player's default starter boat to the nearest navigable water spot near `pos`
   * (or falls back to Pacific Marina dock if no shoreline is nearby).
   */
  summonStarterBoatNear(pos: THREE.Vector3): DriveableBoat | null {
    const starter = this.getStarterBoat();
    if (!starter || this.activeBoat === starter) return null;

    let bestX: number = STARTER_BOAT_DOCK.x;
    let bestZ: number = STARTER_BOAT_DOCK.z;
    let bestD2 = Infinity;

    // Sample rings around player for water (< -0.45m) just off walkable shoreline
    for (let r = 8; r <= 240; r += 10) {
      for (let k = 0; k < 24; k++) {
        const a = (k / 24) * Math.PI * 2;
        const wx = pos.x + Math.cos(a) * r;
        const wz = pos.z + Math.sin(a) * r;
        if (Math.abs(wx) > 1120 || Math.abs(wz) > 1120) continue;
        if (this.terrainAt(wx, wz) < -0.45) {
          const d2 = (wx - pos.x) ** 2 + (wz - pos.z) ** 2;
          if (d2 < bestD2) {
            bestD2 = d2;
            bestX = wx;
            bestZ = wz;
          }
        }
      }
      if (bestD2 < Infinity) break;
    }

    starter.pos.set(bestX, 0, bestZ);
    starter.speed = 0;
    starter.yaw = Math.atan2(bestX - pos.x, bestZ - pos.z);
    starter.group.position.copy(starter.pos);
    starter.group.rotation.set(0, starter.yaw, 0);
    return starter;
  }

  private waveHeightAt(x: number, z: number): number {
    return (
      Math.sin(x * 0.08 + this.animT * 1.9) * 0.12 +
      Math.cos(z * 0.07 - this.animT * 1.4) * 0.1
    );
  }

  findNearestEnterable(pos: THREE.Vector3, maxDist = 7.5): DriveableBoat | null {
    if (this.activeBoat) return null;
    let best: DriveableBoat | null = null;
    let bestD2 = maxDist * maxDist;
    for (const b of this.boats) {
      const d2 = (b.pos.x - pos.x) ** 2 + (b.pos.z - pos.z) ** 2;
      if (d2 < bestD2) {
        bestD2 = d2;
        best = b;
      }
    }
    return best;
  }

  enterBoat(b: DriveableBoat): void {
    this.activeBoat = b;
  }

  exitBoat(): THREE.Vector3 | null {
    const b = this.activeBoat;
    if (!b) return null;
    this.activeBoat = null;
    // Place player safely toward nearest dry ground or dock beside boat
    const lx = Math.cos(b.yaw);
    const lz = -Math.sin(b.yaw);
    const candA = new THREE.Vector3(b.pos.x + lx * 2.5, 0.2, b.pos.z + lz * 2.5);
    const candB = new THREE.Vector3(b.pos.x - lx * 2.5, 0.2, b.pos.z - lz * 2.5);
    const yA = this.terrainAt(candA.x, candA.z);
    const yB = this.terrainAt(candB.x, candB.z);
    const best = yA > yB ? candA : candB;
    best.y = Math.max(0.25, Math.max(yA, yB));
    return best;
  }

  update(dt: number, input: BoatInput): void {
    const cdt = Math.min(Math.max(dt, 0), 0.05);
    this.animT += cdt;

    for (const b of this.boats) {
      const active = b === this.activeBoat;
      const throttle = active ? input.throttle : 0;
      const steer = active ? input.steer : 0;

      const accel = throttle > 0 ? throttle * 16.5 : throttle * 9.5;
      b.speed = clamp(b.speed + accel * cdt, -10, 32);
      if (Math.abs(throttle) < 0.05) {
        b.speed *= Math.exp(-1.15 * cdt);
      }

      const steerAuth = clamp(Math.abs(b.speed) / 4.5, 0.22, 1.0) * (b.speed >= -0.2 ? 1 : -1);
      b.yaw = wrapAngle(b.yaw + steer * 1.45 * steerAuth * cdt);

      const fx = Math.sin(b.yaw);
      const fz = Math.cos(b.yaw);
      const nx = clamp(b.pos.x + fx * b.speed * cdt, -1180, 1180);
      const nz = clamp(b.pos.z + fz * b.speed * cdt, -1180, 1180);

      // Keep hull in water (ground terrain < 0.15m)
      if (this.terrainAt(nx, nz) < 0.15) {
        b.pos.x = nx;
        b.pos.z = nz;
      } else {
        b.speed *= -0.2;
      }

      const wCenter = this.waveHeightAt(b.pos.x, b.pos.z);
      const planingLift = clamp(Math.abs(b.speed) / 22, 0, 1) * 0.22;
      b.pos.y = damp(b.pos.y, wCenter + planingLift, 8, cdt);

      const targetPitch = -clamp(b.speed / 28, -0.1, 0.16);
      const targetRoll = -steer * clamp(Math.abs(b.speed) / 22, 0, 1) * 0.24;
      b.pitch = damp(b.pitch, targetPitch, 6, cdt);
      b.roll = damp(b.roll, targetRoll, 6, cdt);

      b.group.position.copy(b.pos);
      b.group.rotation.order = "YXZ";
      b.group.rotation.set(b.pitch, b.yaw, b.roll);
    }
  }

  getBlips(): Array<{ id: string; name: string; x: number; z: number; isStarter?: boolean }> {
    return this.boats.map((b) => ({ id: b.id, name: b.name, x: b.pos.x, z: b.pos.z, isStarter: !!b.isStarter }));
  }
}
