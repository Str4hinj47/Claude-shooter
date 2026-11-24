import * as THREE from "three";
import { MISSIONS } from "../story";
import { loadSave } from "../progression";

export interface SpeedTrapDef {
  id: string;
  name: string;
  x: number;
  z: number;
  yawDeg: number;
  targetKmh: number;
}

export interface ContractSpotDef {
  missionId: number;
  x: number;
  z: number;
  yawDeg: number;
  districtLabel: string;
}

export const WESTGATE_CONTRACT_SPOTS: ContractSpotDef[] = [
  { missionId: 0, x: -238, z: 295, yawDeg: 120, districtLabel: "Old Quarter Safehouse" },
  { missionId: 1, x: -224, z: -815, yawDeg: 170, districtLabel: "Vinewood Crest Estates" },
  { missionId: 2, x: -292, z: -135, yawDeg: 90, districtLabel: "Midtown Construction Tower" },
  { missionId: 3, x: 42, z: -165, yawDeg: -65, districtLabel: "Downtown Financial Plaza" },
  { missionId: 4, x: 635, z: 432, yawDeg: 0, districtLabel: "Eastgate Seaport Docks" },
  { missionId: 5, x: 114, z: -162, yawDeg: 90, districtLabel: "City Hall / Apex Plaza" },
  { missionId: 6, x: -116, z: -974, yawDeg: 180, districtLabel: "Observatory Summit Ridge" },
];

export const WESTGATE_SPEED_TRAPS: SpeedTrapDef[] = [
  { id: "trap_downtown", name: "Civic Boulevard", x: 18, z: -120, yawDeg: 0, targetKmh: 110 },
  { id: "trap_bay_bridge", name: "Westgate Bay Bridge", x: 350, z: 595, yawDeg: 72, targetKmh: 145 },
  { id: "trap_airport", name: "Airport Runway Dash", x: 42, z: 960, yawDeg: 90, targetKmh: 185 },
  { id: "trap_coast", name: "Del Sol Coast Highway", x: -670, z: -180, yawDeg: 0, targetKmh: 135 },
  { id: "trap_midtown", name: "Midtown Skyway", x: -292, z: -140, yawDeg: 90, targetKmh: 120 },
  { id: "trap_observatory", name: "Observatory Climb", x: -120, z: -870, yawDeg: 180, targetKmh: 95 },
  { id: "trap_gorge", name: "North Gorge Bridge", x: 265, z: -635, yawDeg: 86, targetKmh: 130 },
  { id: "trap_harbor", name: "Seaport Freightway", x: 560, z: 360, yawDeg: 0, targetKmh: 125 },
  { id: "trap_arena", name: "Arena Straightaway", x: -415, z: 540, yawDeg: 0, targetKmh: 130 },
  { id: "trap_university", name: "University Avenue", x: -165, z: -280, yawDeg: 180, targetKmh: 115 },
];

export interface SpeedTrapRuntime {
  def: SpeedTrapDef;
  pos: THREE.Vector3;
  bestKmh: number;
  cooldown: number;
  ringMat: THREE.MeshBasicMaterial;
}

export interface SpeedTrapHit {
  trap: SpeedTrapDef;
  kmh: number;
  isRecord: boolean;
  beatTarget: boolean;
  reward: number;
}

export interface ContractBeaconRuntime {
  spot: ContractSpotDef;
  pos: THREE.Vector3;
  crystal: THREE.Mesh;
  ringMat: THREE.MeshBasicMaterial;
  beamMat: THREE.MeshBasicMaterial;
}

export class WestgateActivityManager {
  readonly root = new THREE.Group();
  readonly traps: SpeedTrapRuntime[] = [];
  readonly contracts: ContractBeaconRuntime[] = [];
  readonly discoveredDistricts = new Set<string>();
  private animT = 0;

  constructor(terrainAt: (x: number, z: number) => number) {
    this.root.name = "westgate-activities";
    const postGeo = new THREE.CylinderGeometry(0.11, 0.14, 4.4, 8);
    const boxGeo = new THREE.BoxGeometry(0.45, 0.55, 0.45);
    const barGeo = new THREE.BoxGeometry(10.8, 0.14, 0.18);
    const postMat = new THREE.MeshStandardMaterial({ color: 0x334155, metalness: 0.65, roughness: 0.35 });
    const camMat = new THREE.MeshStandardMaterial({ color: 0x0f172a, metalness: 0.5, roughness: 0.4 });

    for (const def of WESTGATE_SPEED_TRAPS) {
      const y = terrainAt(def.x, def.z);
      const g = new THREE.Group();
      g.position.set(def.x, y, def.z);
      g.rotation.y = THREE.MathUtils.degToRad(def.yawDeg);

      const leftPost = new THREE.Mesh(postGeo, postMat);
      leftPost.position.set(-5.4, 2.2, 0);
      const rightPost = new THREE.Mesh(postGeo, postMat);
      rightPost.position.set(5.4, 2.2, 0);

      const camBoxL = new THREE.Mesh(boxGeo, camMat);
      camBoxL.position.set(-5.4, 4.15, 0);
      const camBoxR = new THREE.Mesh(boxGeo, camMat);
      camBoxR.position.set(5.4, 4.15, 0);

      const ringMat = new THREE.MeshBasicMaterial({
        color: 0x22d3ee,
        transparent: true,
        opacity: 0.72,
      });
      const bar = new THREE.Mesh(barGeo, ringMat);
      bar.position.set(0, 4.35, 0);

      g.add(leftPost, rightPost, camBoxL, camBoxR, bar);
      this.root.add(g);
      this.traps.push({
        def,
        pos: new THREE.Vector3(def.x, y, def.z),
        bestKmh: 0,
        cooldown: 0,
        ringMat,
      });
    }

    // Mission Contract Launch Beacons linking Campaign Missions M0–M6 into Westgate Bay
    const ringGeo = new THREE.RingGeometry(1.9, 2.35, 28);
    ringGeo.rotateX(-Math.PI / 2);
    const beamGeo = new THREE.CylinderGeometry(0.14, 0.45, 7.5, 12, 1, true);
    const crystalGeo = new THREE.OctahedronGeometry(0.55, 0);
    const save = loadSave();

    for (const spot of WESTGATE_CONTRACT_SPOTS) {
      const m = MISSIONS.find((mi) => mi.id === spot.missionId);
      if (!m) continue;
      const y = terrainAt(spot.x, spot.z);
      const unlocked = spot.missionId <= Math.max(1, save.unlocked);
      const completed = !!save.records[spot.missionId]?.completed;
      const col = unlocked ? (completed ? 0xfbbf24 : new THREE.Color(m.accent).getHex()) : 0x64748b;

      const g = new THREE.Group();
      g.position.set(spot.x, y, spot.z);

      const ringMat = new THREE.MeshBasicMaterial({
        color: col,
        transparent: true,
        opacity: unlocked ? 0.85 : 0.35,
        side: THREE.DoubleSide,
      });
      const ring = new THREE.Mesh(ringGeo, ringMat);
      ring.position.y = 0.08;

      const beamMat = new THREE.MeshBasicMaterial({
        color: col,
        transparent: true,
        opacity: unlocked ? 0.22 : 0.08,
        side: THREE.DoubleSide,
        depthWrite: false,
      });
      const beam = new THREE.Mesh(beamGeo, beamMat);
      beam.position.y = 3.8;

      const crystal = new THREE.Mesh(
        crystalGeo,
        new THREE.MeshBasicMaterial({ color: col, wireframe: !unlocked }),
      );
      crystal.position.y = 2.0;

      g.add(ring, beam, crystal);
      this.root.add(g);
      this.contracts.push({
        spot,
        pos: new THREE.Vector3(spot.x, y, spot.z),
        crystal,
        ringMat,
        beamMat,
      });
    }
  }

  update(dt: number, pos: THREE.Vector3, speedMs: number, driving: boolean): SpeedTrapHit | null {
    this.animT += dt;
    for (const c of this.contracts) {
      c.crystal.rotation.y += dt * 1.6;
      c.crystal.position.y = 2.0 + Math.sin(this.animT * 2.4 + c.spot.missionId) * 0.22;
    }

    let hit: SpeedTrapHit | null = null;
    const kmh = Math.round(Math.abs(speedMs) * 3.6);
    for (const tr of this.traps) {
      if (tr.cooldown > 0) tr.cooldown = Math.max(0, tr.cooldown - dt);
      if (!driving || tr.cooldown > 0 || kmh < 35) continue;
      const dx = pos.x - tr.pos.x;
      const dz = pos.z - tr.pos.z;
      if (dx * dx + dz * dz < 11.5 * 11.5 && Math.abs(pos.y - tr.pos.y) < 6) {
        tr.cooldown = 8.0;
        const isRecord = kmh > tr.bestKmh;
        const beatTarget = kmh >= tr.def.targetKmh;
        if (isRecord) tr.bestKmh = kmh;
        if (beatTarget) tr.ringMat.color.setHex(0xfbbf24);
        const reward = beatTarget ? (isRecord ? 120 : 60) : isRecord ? 45 : 20;
        hit = { trap: tr.def, kmh, isRecord, beatTarget, reward };
      }
    }
    return hit;
  }

  findNearbyContract(pos: THREE.Vector3, maxDist = 8.5): ContractSpotDef | null {
    let best: ContractSpotDef | null = null;
    let bestD2 = maxDist * maxDist;
    for (const c of this.contracts) {
      if (Math.abs(pos.y - c.pos.y) > 6) continue;
      const dx = pos.x - c.pos.x;
      const dz = pos.z - c.pos.z;
      const d2 = dx * dx + dz * dz;
      if (d2 < bestD2) {
        bestD2 = d2;
        best = c.spot;
      }
    }
    return best;
  }

  getTrapSummaries(): { id: string; x: number; z: number; beaten: boolean; bestKmh: number }[] {
    return this.traps.map((t) => ({
      id: t.def.id,
      x: t.def.x,
      z: t.def.z,
      beaten: t.bestKmh >= t.def.targetKmh,
      bestKmh: t.bestKmh,
    }));
  }

  getContractSummaries(): { missionId: number; x: number; z: number; unlocked: boolean; completed: boolean }[] {
    const save = loadSave();
    const threshold = Math.max(1, save.unlocked);
    return this.contracts.map((c) => ({
      missionId: c.spot.missionId,
      x: c.spot.x,
      z: c.spot.z,
      unlocked: c.spot.missionId <= threshold,
      completed: !!save.records[c.spot.missionId]?.completed,
    }));
  }
}
