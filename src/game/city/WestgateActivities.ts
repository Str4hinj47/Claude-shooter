import * as THREE from "three";
import {
  getNextStoryChapter,
  getStoryChapterForMission,
  isStoryChapterUnlocked,
  MISSIONS,
  STORYLINE_CHAPTERS,
} from "../story";
import { loadSave, recordSpeedTrapBest } from "../progression";
import type { WorldHeightSystem } from "./HeightSystem";
import { clamp, damp, dampAngle } from "../../character/math";
import type { ModelLibrary } from "../vehicles/ModelLibrary";
import type { CarId } from "../vehicles/catalog";
import { spinWheels } from "../vehicles/wheels";
import { addVehicleLights } from "../vehicles/vehicleLights";
import { attachGlbToGroup } from "./PropModels";

export interface StuntJumpDef {
  id: string;
  name: string;
  x: number;
  z: number;
  yawDeg: number;
  length: number;
  width: number;
  height: number;
}

export interface StuntJumpHit {
  def: StuntJumpDef;
  distMeters: number;
  peakHeight: number;
  reward: number;
}

export interface StreetRaceDef {
  id: string;
  name: string;
  accent: string;
  startX: number;
  startZ: number;
  startYawDeg: number;
  checkpoints: ReadonlyArray<readonly [number, number]>;
  reward1st: number;
}

export interface ActiveRaceState {
  race: StreetRaceDef;
  checkpointIdx: number;
  place: number;
  totalRacers: number;
  elapsed: number;
  nextCheckpoint: { x: number; z: number };
}

export interface RaceFinishResult {
  raceName: string;
  place: number;
  elapsed: number;
  reward: number;
}

export const WESTGATE_STUNT_JUMPS: StuntJumpDef[] = [
  { id: "stunt_pier", name: "Del Sol Boardwalk Leap", x: -735, z: -24, yawDeg: 270, length: 9.5, width: 4.8, height: 2.5 },
  { id: "stunt_downtown", name: "Civic Boulevard Overpass", x: 14, z: -135, yawDeg: 0, length: 10.0, width: 5.0, height: 2.6 },
  { id: "stunt_airport", name: "Runway Booster Ramp", x: 10, z: 960, yawDeg: 90, length: 11.0, width: 5.4, height: 2.9 },
  { id: "stunt_port", name: "Eastgate Cargo Launch", x: 585, z: 385, yawDeg: 180, length: 9.5, width: 4.8, height: 2.5 },
  { id: "stunt_canals", name: "Venice Canal Gap", x: -505, z: -315, yawDeg: 180, length: 9.0, width: 4.6, height: 2.4 },
  { id: "stunt_midtown", name: "Midtown Skyway Jump", x: -335, z: -140, yawDeg: 90, length: 9.5, width: 4.8, height: 2.5 },
];

export const WESTGATE_RACES: StreetRaceDef[] = [
  {
    id: "race_bayshore",
    name: "Bayshore Sprint",
    accent: "#38bdf8",
    startX: 16,
    startZ: -38,
    startYawDeg: 180,
    checkpoints: [
      [14, -180],
      [-210, -180],
      [-450, -130],
      [-670, -40],
      [-695, 110],
    ],
    reward1st: 1500,
  },
  {
    id: "race_downtown",
    name: "Downtown Apex Loop",
    accent: "#f59e0b",
    startX: 88,
    startZ: -115,
    startYawDeg: 0,
    checkpoints: [
      [88, 40],
      [-120, 40],
      [-140, -170],
      [75, -175],
      [88, -115],
    ],
    reward1st: 1650,
  },
  {
    id: "race_coast",
    name: "West Coast Grand Prix",
    accent: "#2dd4bf",
    startX: -670,
    startZ: 45,
    startYawDeg: 180,
    checkpoints: [
      [-670, -240],
      [-510, -430],
      [-290, -160],
      [-320, 210],
      [-670, 180],
    ],
    reward1st: 1800,
  },
];

export interface SpeedTrapDef {
  id: string;
  name: string;
  x: number;
  z: number;
  yawDeg: number;
  targetKmh: number;
}

import { OPEN_WORLD_MISSION_SITES } from "./OpenWorldMissions";

export interface ContractSpotDef {
  missionId: number;
  x: number;
  z: number;
  yawDeg: number;
  districtLabel: string;
}

export const WESTGATE_CONTRACT_SPOTS: ContractSpotDef[] = [
  { missionId: 0, x: -238, z: 295, yawDeg: 120, districtLabel: "Old Quarter Safehouse" },
  ...[1, 2, 3, 4, 5, 6].map((id) => {
    const s = OPEN_WORLD_MISSION_SITES[id];
    return {
      missionId: id,
      x: s.approachX,
      z: s.approachZ,
      yawDeg: id === 4 ? 0 : 180,
      districtLabel: s.districtLabel,
    };
  }),
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
  outerRing: THREE.Mesh;
  outerRingMat: THREE.MeshBasicMaterial;
  beamMat: THREE.MeshBasicMaterial;
  isNextActive: boolean;
}

export class WestgateActivityManager {
  readonly root = new THREE.Group();
  readonly traps: SpeedTrapRuntime[] = [];
  readonly contracts: ContractBeaconRuntime[] = [];
  readonly stuntJumps: Array<{ def: StuntJumpDef; pos: THREE.Vector3; completed: boolean }> = [];
  readonly races = WESTGATE_RACES;
  readonly colliders: THREE.Object3D[] = [];
  readonly discoveredDistricts = new Set<string>();
  private readonly terrainAt: (x: number, z: number) => number;
  private readonly modelLibrary: ModelLibrary | null;
  private animT = 0;

  // Stunt tracking
  private airTime = 0;
  private wasAirborne = false;
  private launchPos = new THREE.Vector3();
  private peakY = 0;
  private stuntCooldown = 0;

  // Active Street Race runtime
  private activeRace: ActiveRaceState | null = null;
  private checkpointRing: THREE.Mesh;
  private checkpointBeam: THREE.Mesh;
  private rivals: Array<{
    group: THREE.Group;
    modelRoot: THREE.Group | null;
    x: number;
    y: number;
    z: number;
    yaw: number;
    speed: number;
    cpIdx: number;
    baseSpeed: number;
  }> = [];

  constructor(
    terrainAt: (x: number, z: number) => number,
    heightSystem?: WorldHeightSystem,
    modelLibrary: ModelLibrary | null = null,
  ) {
    this.root.name = "westgate-activities";
    this.terrainAt = terrainAt;
    this.modelLibrary = modelLibrary;
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
    const ringGeo = new THREE.RingGeometry(2.15, 2.75, 32);
    ringGeo.rotateX(-Math.PI / 2);
    const outerRingGeo = new THREE.RingGeometry(3.2, 3.65, 32);
    outerRingGeo.rotateX(-Math.PI / 2);
    const tallBeamGeo = new THREE.CylinderGeometry(0.32, 1.35, 54, 14, 1, true);
    const stdBeamGeo = new THREE.CylinderGeometry(0.22, 0.9, 26, 12, 1, true);
    const crystalGeo = new THREE.OctahedronGeometry(0.7, 0);
    const save = loadSave();
    for (const d of save.discoveredDistricts ?? []) {
      this.discoveredDistricts.add(d);
    }
    this.traps.forEach((t) => {
      const savedBest = save.speedTrapBests?.[t.def.id] ?? 0;
      if (savedBest > 0) {
        t.bestKmh = savedBest;
        if (savedBest >= t.def.targetKmh) t.ringMat.color.setHex(0xfbbf24);
      }
    });

    const nextCh = getNextStoryChapter(save);
    const nextActiveId = nextCh.kind === "mission" ? nextCh.missionId ?? -1 : -1;

    for (const spot of WESTGATE_CONTRACT_SPOTS) {
      const m = MISSIONS.find((mi) => mi.id === spot.missionId);
      if (!m) continue;
      const ch = getStoryChapterForMission(spot.missionId);
      const y = terrainAt(spot.x, spot.z);
      const unlocked = ch ? isStoryChapterUnlocked(ch, save) : spot.missionId === 0;
      const completed = !!save.records[spot.missionId]?.completed;
      const isNextActive = spot.missionId === nextActiveId;
      const col = unlocked ? (completed ? 0xfbbf24 : new THREE.Color(m.accent).getHex()) : 0x64748b;

      const g = new THREE.Group();
      g.position.set(spot.x, y, spot.z);

      const ringMat = new THREE.MeshBasicMaterial({
        color: col,
        transparent: true,
        opacity: isNextActive ? 0.96 : unlocked ? 0.85 : 0.32,
        side: THREE.DoubleSide,
        polygonOffset: true,
        polygonOffsetFactor: -4,
        polygonOffsetUnits: -4,
      });
      const ring = new THREE.Mesh(ringGeo, ringMat);
      ring.position.y = 0.21;

      const outerRingMat = new THREE.MeshBasicMaterial({
        color: col,
        transparent: true,
        opacity: isNextActive ? 0.68 : unlocked ? 0.35 : 0.12,
        side: THREE.DoubleSide,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -5,
        polygonOffsetUnits: -5,
      });
      const outerRing = new THREE.Mesh(outerRingGeo, outerRingMat);
      outerRing.position.y = 0.23;

      const beamMat = new THREE.MeshBasicMaterial({
        color: col,
        transparent: true,
        opacity: isNextActive ? 0.34 : unlocked ? 0.2 : 0.06,
        side: THREE.DoubleSide,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });
      const beamH = isNextActive ? 54 : 26;
      const beam = new THREE.Mesh(isNextActive ? tallBeamGeo : stdBeamGeo, beamMat);
      beam.position.y = beamH * 0.5;

      const crystal = new THREE.Mesh(
        crystalGeo,
        new THREE.MeshBasicMaterial({ color: col, wireframe: !unlocked }),
      );
      crystal.position.y = 2.25;

      // Floating high-contrast overhead MISSION START billboard sprite
      const sign = this.buildContractBillboardSprite(
        spot.missionId,
        m.codename,
        m.name,
        unlocked,
        completed,
        isNextActive,
        m.accent,
      );
      if (sign) {
        sign.position.set(0, isNextActive ? 5.2 : 4.5, 0);
        g.add(sign);
      }

      g.add(ring, outerRing, beam, crystal);
      this.buildContractStagingSite(g, spot.missionId, col);
      this.root.add(g);
      this.contracts.push({
        spot,
        pos: new THREE.Vector3(spot.x, y, spot.z),
        crystal,
        ringMat,
        outerRing,
        outerRingMat,
        beamMat,
        isNextActive,
      });
    }

    // 3. Stunt Jump Ramps registered into WorldHeightSystem
    const rampSteelMat = new THREE.MeshStandardMaterial({ color: 0x334155, roughness: 0.48, metalness: 0.65 });
    const rampDeckMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.62, metalness: 0.35 });
    const chevronMat = new THREE.MeshStandardMaterial({
      color: 0x38bdf8,
      emissive: 0x0ea5e9,
      emissiveIntensity: 1.6,
      roughness: 0.25,
    });
    const hazardYellowMat = new THREE.MeshStandardMaterial({ color: 0xf59e0b, roughness: 0.45 });

    for (const sj of WESTGATE_STUNT_JUMPS) {
      const gy = terrainAt(sj.x, sj.z);
      const yaw = THREE.MathUtils.degToRad(sj.yawDeg);
      const rg = new THREE.Group();
      rg.position.set(sj.x, gy, sj.z);
      rg.rotation.y = yaw;

      // Stepped ramp slope deck + glowing launch chevrons + side hazard rails
      const slopeAng = Math.atan2(sj.height, sj.length);
      const deckLen = Math.hypot(sj.length, sj.height);
      const deck = new THREE.Mesh(new THREE.BoxGeometry(sj.width, 0.22, deckLen), rampDeckMat);
      deck.position.set(0, sj.height * 0.5, 0);
      deck.rotation.x = -slopeAng;
      deck.castShadow = true;
      deck.receiveShadow = true;
      rg.add(deck);

      for (const sx of [-sj.width * 0.48, sj.width * 0.48]) {
        const rail = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.26, deckLen), hazardYellowMat);
        rail.position.set(sx, sj.height * 0.5 + 0.14, 0);
        rail.rotation.x = -slopeAng;
        rg.add(rail);
      }

      const lipSupport = new THREE.Mesh(new THREE.BoxGeometry(sj.width, sj.height, 0.45), rampSteelMat);
      lipSupport.position.set(0, sj.height * 0.5, sj.length * 0.46);
      lipSupport.castShadow = true;
      rg.add(lipSupport);

      const chevron = new THREE.Mesh(new THREE.BoxGeometry(sj.width * 0.72, 0.06, 0.75), chevronMat);
      chevron.position.set(0, sj.height + 0.08, sj.length * 0.44);
      chevron.rotation.x = -slopeAng;
      rg.add(chevron);

      attachGlbToGroup(rg, "traffic_cone.glb", -sj.width * 0.56, 0, -sj.length * 0.5, { axis: "y", targetMeters: 0.68 });
      attachGlbToGroup(rg, "traffic_cone.glb", sj.width * 0.56, 0, -sj.length * 0.5, { axis: "y", targetMeters: 0.68 });

      this.root.add(rg);
      this.stuntJumps.push({ def: sj, pos: new THREE.Vector3(sj.x, gy, sj.z), completed: false });

      if (heightSystem) {
        const cosY = Math.cos(yaw);
        const sinY = Math.sin(yaw);
        const halfW = sj.width * 0.52;
        const halfL = sj.length * 0.52;
        const pad = Math.hypot(halfW, halfL) + 0.5;
        heightSystem.addSurface({
          id: `stunt_${sj.id}`,
          minX: sj.x - pad,
          maxX: sj.x + pad,
          minZ: sj.z - pad,
          maxZ: sj.z + pad,
          minY: gy - 0.5,
          maxY: gy + sj.height + 0.5,
          heightAt: (wx, wz) => {
            const dx = wx - sj.x;
            const dz = wz - sj.z;
            const lx = dx * cosY - dz * sinY;
            const lz = dx * sinY + dz * cosY;
            if (Math.abs(lx) > halfW || Math.abs(lz) > halfL) return null;
            const t = clamp((lz + halfL) / (halfL * 2), 0, 1);
            return gy + t * sj.height;
          },
        });
      }
    }

    // 4. Street Race Start Arches + Shared Active Checkpoint Beacon
    const raceArchMat = new THREE.MeshStandardMaterial({
      color: 0xf59e0b,
      emissive: 0xd97706,
      emissiveIntensity: 0.9,
      roughness: 0.35,
    });
    for (const r of WESTGATE_RACES) {
      const y = terrainAt(r.startX, r.startZ);
      const sg = new THREE.Group();
      sg.position.set(r.startX, y, r.startZ);
      sg.rotation.y = THREE.MathUtils.degToRad(r.startYawDeg);
      const lp = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.2, 4.8, 8), postMat);
      lp.position.set(-4.6, 2.4, 0);
      const rp = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.2, 4.8, 8), postMat);
      rp.position.set(4.6, 2.4, 0);
      const top = new THREE.Mesh(new THREE.BoxGeometry(9.6, 0.55, 0.4), raceArchMat);
      top.position.set(0, 4.9, 0);
      const padRing = new THREE.Mesh(
        new THREE.RingGeometry(2.8, 3.35, 28),
        new THREE.MeshBasicMaterial({
          color: new THREE.Color(r.accent).getHex(),
          transparent: true,
          opacity: 0.72,
          side: THREE.DoubleSide,
          polygonOffset: true,
          polygonOffsetFactor: -4,
          polygonOffsetUnits: -4,
        }),
      );
      padRing.rotation.x = -Math.PI * 0.5;
      padRing.position.y = 0.21;
      sg.add(lp, rp, top, padRing);
      this.root.add(sg);
    }

    this.checkpointRing = new THREE.Mesh(
      new THREE.RingGeometry(4.2, 5.2, 32),
      new THREE.MeshBasicMaterial({ color: 0xfbbf24, transparent: true, opacity: 0.88, side: THREE.DoubleSide }),
    );
    this.checkpointRing.rotation.x = -Math.PI * 0.5;
    this.checkpointRing.visible = false;
    this.checkpointBeam = new THREE.Mesh(
      new THREE.CylinderGeometry(3.8, 4.8, 22, 20, 1, true),
      new THREE.MeshBasicMaterial({ color: 0xfbbf24, transparent: true, opacity: 0.22, side: THREE.DoubleSide, depthWrite: false }),
    );
    this.checkpointBeam.visible = false;
    this.root.add(this.checkpointRing, this.checkpointBeam);
  }

  /**
   * Builds physical mission-themed staging landmarks around each contract beacon
   * so campaign sites feel tangibly integrated into Westgate Bay's world.
   */
  private buildContractStagingSite(parent: THREE.Group, missionId: number, accentHex: number) {
    const steelMat = new THREE.MeshStandardMaterial({ color: 0x334155, roughness: 0.48, metalness: 0.72 });
    const darkMat = new THREE.MeshStandardMaterial({ color: 0x17191f, roughness: 0.6, metalness: 0.5 });
    const concreteMat = new THREE.MeshStandardMaterial({ color: 0x6b6f75, roughness: 0.92 });
    const woodMat = new THREE.MeshStandardMaterial({ color: 0x6f5335, roughness: 0.85 });
    const sandbagMat = new THREE.MeshStandardMaterial({ color: 0x8d8163, roughness: 0.94 });
    const hazardMat = new THREE.MeshStandardMaterial({ color: 0xd8b01c, roughness: 0.62 });
    const accentGlow = new THREE.MeshStandardMaterial({
      color: accentHex,
      emissive: accentHex,
      emissiveIntensity: 1.4,
      roughness: 0.35,
    });

    const addBox = (
      w: number,
      h: number,
      d: number,
      mat: THREE.Material,
      x: number,
      y: number,
      z: number,
      ry = 0,
      solid = true,
    ) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
      m.position.set(x, y, z);
      m.rotation.y = ry;
      m.castShadow = true;
      m.receiveShadow = true;
      parent.add(m);
      if (solid) this.colliders.push(m);
      return m;
    };

    // Base staging tactical pad under the beacon (top = 0.12, grounded -0.22, below beacon rings 0.16/0.18)
    const pad = new THREE.Mesh(new THREE.CylinderGeometry(2.7, 2.9, 0.34, 24), darkMat);
    pad.position.y = -0.05;
    pad.receiveShadow = true;
    parent.add(pad);

    // Corner bollards framing the contract terminal
    for (const [bx, bz] of [[-2.5, -2.5], [2.5, -2.5], [-2.5, 2.5], [2.5, 2.5]] as const) {
      addBox(0.2, 0.85, 0.2, steelMat, bx, 0.425, bz, 0, false);
      addBox(0.22, 0.1, 0.22, accentGlow, bx, 0.88, bz, 0, false);
    }

    switch (missionId) {
      case 0: {
        // C0 Safehouse Range: shooting bay sandbag wall, ammo crates & steel bullseye targets
        addBox(3.6, 0.85, 0.75, sandbagMat, 0, 0.425, -3.9, 0, true);
        addBox(1.0, 0.75, 0.9, woodMat, -3.4, 0.375, -2.4, 0.2, true);
        addBox(0.85, 0.65, 0.85, woodMat, 3.4, 0.325, -2.2, -0.3, true);
        for (const tx of [-2.4, 0, 2.4]) {
          addBox(0.12, 1.35, 0.12, steelMat, tx, 0.675, -5.6, 0, false);
          const disc = new THREE.Mesh(
            new THREE.CylinderGeometry(0.36, 0.36, 0.05, 20),
            new THREE.MeshStandardMaterial({ color: 0xdc2626, roughness: 0.45, metalness: 0.4 }),
          );
          disc.rotation.x = Math.PI / 2;
          disc.position.set(tx, 1.15, -5.52);
          parent.add(disc);
        }
        break;
      }
      case 1: {
        // C1 Highland Village Outpost: stone gate pillars, timber header, courier crates & warm lanterns
        const stoneMat = new THREE.MeshStandardMaterial({ color: 0x8a8276, roughness: 0.92 });
        for (const sx of [-3.8, 3.8]) {
          addBox(0.95, 3.4, 0.95, stoneMat, sx, 1.7, -3.6, 0, true);
          addBox(1.15, 0.22, 1.15, stoneMat, sx, 3.5, -3.6, 0, false);
          addBox(0.28, 0.32, 0.28, accentGlow, sx, 3.8, -3.6, 0, false);
        }
        addBox(8.6, 0.32, 0.38, woodMat, 0, 3.92, -3.6, 0, false);
        addBox(1.1, 0.8, 0.8, woodMat, -3.2, 0.4, 2.8, 0.3, true);
        addBox(0.9, 0.65, 0.9, woodMat, 3.1, 0.325, 2.6, -0.2, true);
        break;
      }
      case 2: {
        // C2 Meridian Construction Staging: yellow Jersey barriers, stacked steel I-beams, loader & cones
        addBox(2.8, 0.85, 0.5, hazardMat, -3.5, 0.425, -3.4, 0.35, true);
        addBox(2.8, 0.85, 0.5, hazardMat, 3.5, 0.425, -3.4, -0.35, true);
        addBox(4.4, 0.35, 0.45, steelMat, 0, 0.175, -4.6, 0, true);
        addBox(4.4, 0.35, 0.45, steelMat, 0, 0.525, -4.6, 0.08, true);
        attachGlbToGroup(parent, "loader_tractor.glb", 0, 0, -6.8, { axis: "z", targetMeters: 4.4, yaw: 0.35 });
        for (const [cx, cz] of [[-4.2, 2.5], [4.2, 2.5], [-4.4, 0], [4.4, 0]] as const) {
          const cone = new THREE.Mesh(new THREE.ConeGeometry(0.2, 0.72, 12), new THREE.MeshStandardMaterial({ color: 0xea580c, roughness: 0.7 }));
          cone.position.set(cx, 0.36, cz);
          parent.add(cone);
          attachGlbToGroup(parent, "traffic_cone.glb", cx, 0, cz, {
            axis: "y",
            targetMeters: 0.72,
            onAttached: () => {
              cone.visible = false;
            },
          });
        }
        break;
      }
      case 3: {
        // C3 Broker's Cut Financial Plaza: encrypted server racks & surveillance console
        addBox(1.1, 2.1, 0.8, darkMat, -3.4, 1.05, -3.2, 0.4, true);
        addBox(1.1, 2.1, 0.8, darkMat, 3.4, 1.05, -3.2, -0.4, true);
        addBox(0.9, 1.4, 0.06, accentGlow, -3.28, 1.15, -2.9, 0.4, false);
        addBox(0.9, 1.4, 0.06, accentGlow, 3.28, 1.15, -2.9, -0.4, false);
        addBox(2.2, 1.0, 0.9, concreteMat, 0, 0.5, -4.1, 0, true);
        break;
      }
      case 4: {
        // C4 Seaport Docks: 20ft corrugated steel container, ribbed fuel drums & cargo pallets
        const contMat = new THREE.MeshStandardMaterial({ color: 0x1d4ed8, roughness: 0.65, metalness: 0.35 });
        addBox(2.4, 2.6, 6.0, contMat, -4.8, 1.3, -1.5, 0.12, true);
        const drumMat = new THREE.MeshStandardMaterial({ color: 0xb91c1c, roughness: 0.5, metalness: 0.6 });
        for (const [dx, dz] of [[3.6, -2.8], [4.4, -2.3], [3.9, -1.6]] as const) {
          const drum = new THREE.Mesh(new THREE.CylinderGeometry(0.38, 0.38, 1.05, 14), drumMat);
          drum.position.set(dx, 0.525, dz);
          drum.castShadow = true;
          drum.userData.kind = "metal";
          drum.userData.explosiveBarrel = { hp: 35, exploded: false, vis: drum, col: drum };
          parent.add(drum);
          this.colliders.push(drum);
        }
        addBox(1.4, 0.45, 1.4, woodMat, 3.8, 0.225, 2.2, 0.15, true);
        attachGlbToGroup(parent, "gas_can.glb", 3.1, 0, -1.9, { axis: "y", targetMeters: 0.75, yaw: 0.5 });
        break;
      }
      case 5: {
        // C5 Apex Glass House: obsidian security portal arch & twin biometric kiosks
        const glassMat = new THREE.MeshStandardMaterial({
          color: 0x1e293b,
          roughness: 0.15,
          metalness: 0.75,
          transparent: true,
          opacity: 0.78,
        });
        addBox(0.55, 3.6, 0.7, darkMat, -3.3, 1.8, -3.5, 0, true);
        addBox(0.55, 3.6, 0.7, darkMat, 3.3, 1.8, -3.5, 0, true);
        addBox(7.2, 0.45, 0.8, darkMat, 0, 3.8, -3.5, 0, false);
        addBox(6.8, 0.1, 0.12, accentGlow, 0, 3.55, -3.12, 0, false);
        addBox(1.8, 2.2, 0.14, glassMat, -4.5, 1.1, 0, 0.35, true);
        addBox(1.8, 2.2, 0.14, glassMat, 4.5, 1.1, 0, -0.35, true);
        break;
      }
      case 6: {
        // C6 Iron Citadel Summit: tactical helipad circle + sandbag perimeter & radar dish mast
        const heliPad = new THREE.Mesh(new THREE.CylinderGeometry(5.2, 5.5, 0.1, 24), concreteMat);
        heliPad.position.set(0, 0.03, -6.2);
        heliPad.receiveShadow = true;
        parent.add(heliPad);
        addBox(0.35, 0.04, 2.4, hazardMat, -0.9, 0.09, -6.2, 0, false);
        addBox(0.35, 0.04, 2.4, hazardMat, 0.9, 0.09, -6.2, 0, false);
        addBox(1.8, 0.04, 0.35, hazardMat, 0, 0.09, -6.2, 0, false);
        addBox(3.4, 0.85, 0.7, sandbagMat, -3.6, 0.425, 2.8, -0.45, true);
        addBox(3.4, 0.85, 0.7, sandbagMat, 3.6, 0.425, 2.8, 0.45, true);
        addBox(0.24, 4.6, 0.24, steelMat, -4.8, 2.3, -4.2, 0, true);
        addBox(1.6, 0.18, 0.32, accentGlow, -4.8, 4.7, -4.2, 0.5, false);
        break;
      }
    }
  }

  private buildContractBillboardSprite(
    missionId: number,
    codename: string,
    name: string,
    unlocked: boolean,
    completed: boolean,
    isNextActive: boolean,
    accent: string,
  ): THREE.Sprite | null {
    if (typeof document === "undefined") return null;
    const canvas = document.createElement("canvas");
    canvas.width = 512;
    canvas.height = 176;
    const ctx = canvas.getContext("2d");
    if (!ctx || typeof ctx.fillText !== "function") return null;

    const borderCol = unlocked ? (completed ? "#fbbf24" : accent) : "#64748b";
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Dark tactical plate
    ctx.fillStyle = "rgba(7, 9, 14, 0.92)";
    ctx.fillRect(10, 10, 492, 136);
    ctx.strokeStyle = borderCol;
    ctx.lineWidth = isNextActive ? 6 : 4;
    ctx.strokeRect(10, 10, 492, 136);

    // Header strip
    ctx.fillStyle = borderCol;
    ctx.fillRect(10, 10, 492, 42);
    ctx.fillStyle = "#07090e";
    ctx.font = "900 24px ui-monospace, monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const ch = getStoryChapterForMission(missionId);
    const prevCh = ch && ch.chapter > 1 ? STORYLINE_CHAPTERS[ch.chapter - 1] : undefined;
    const chLabel = ch ? `CH ${ch.code}` : `C${missionId}`;
    const tag = !unlocked
      ? `LOCKED · ${chLabel}`
      : isNextActive
        ? `★ START STORY · ${chLabel}`
        : completed
          ? `REPLAY · ${chLabel}`
          : `DEPLOY · ${chLabel}`;
    ctx.fillText(tag, 256, 31);

    // Codename + location
    ctx.fillStyle = "#f2efe9";
    ctx.font = "800 34px sans-serif";
    ctx.fillText(codename, 256, 82);

    ctx.fillStyle = unlocked ? "#cbd5e1" : "#94a3b8";
    ctx.font = "600 20px ui-monospace, monospace";
    ctx.fillText(
      unlocked
        ? `${name} · PRESS [G]`
        : prevCh
          ? `CLEAR CH ${prevCh.code} (${prevCh.codename})`
          : `CLEAR PREVIOUS CHAPTER`,
      256,
      120,
    );

    // Downward pointer arrow beneath plate
    ctx.fillStyle = borderCol;
    ctx.beginPath();
    ctx.moveTo(234, 146);
    ctx.lineTo(278, 146);
    ctx.lineTo(256, 172);
    ctx.closePath();
    ctx.fill();

    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: true });
    const sp = new THREE.Sprite(mat);
    sp.scale.set(isNextActive ? 6.2 : 5.0, isNextActive ? 2.15 : 1.75, 1);
    return sp;
  }

  update(dt: number, pos: THREE.Vector3, speedMs: number, driving: boolean): SpeedTrapHit | null {
    this.animT += dt;
    for (const c of this.contracts) {
      c.crystal.rotation.y += dt * (c.isNextActive ? 2.4 : 1.6);
      c.crystal.position.y = 2.25 + Math.sin(this.animT * 2.6 + c.spot.missionId) * 0.28;
      const pulse = 0.5 + 0.5 * Math.sin(this.animT * (c.isNextActive ? 4.2 : 2.2) + c.spot.missionId);
      const s = 1 + pulse * (c.isNextActive ? 0.28 : 0.14);
      c.outerRing.scale.set(s, s, 1);
      c.outerRingMat.opacity = c.isNextActive ? 0.35 + (1 - pulse) * 0.55 : 0.18 + (1 - pulse) * 0.25;
      if (c.isNextActive) {
        c.beamMat.opacity = 0.26 + pulse * 0.18;
      }
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
        if (isRecord) {
          tr.bestKmh = kmh;
          recordSpeedTrapBest(tr.def.id, kmh);
        }
        if (beatTarget) tr.ringMat.color.setHex(0xfbbf24);
        const reward = beatTarget ? (isRecord ? 120 : 60) : isRecord ? 45 : 20;
        hit = { trap: tr.def, kmh, isRecord, beatTarget, reward };
      }
    }
    return hit;
  }

  findNearbyContract(pos: THREE.Vector3, maxDist = 11.5): ContractSpotDef | null {
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
    return this.contracts.map((c) => {
      const ch = getStoryChapterForMission(c.spot.missionId);
      return {
        missionId: c.spot.missionId,
        x: c.spot.x,
        z: c.spot.z,
        unlocked: ch ? isStoryChapterUnlocked(ch, save) : c.spot.missionId === 0,
        completed: !!save.records[c.spot.missionId]?.completed,
      };
    });
  }

  getStuntSummaries(): { id: string; name: string; x: number; z: number; completed: boolean }[] {
    return this.stuntJumps.map((s) => ({
      id: s.def.id,
      name: s.def.name,
      x: s.def.x,
      z: s.def.z,
      completed: s.completed,
    }));
  }

  getRaceSummaries(): { id: string; name: string; x: number; z: number }[] {
    return this.races.map((r) => ({ id: r.id, name: r.name, x: r.startX, z: r.startZ }));
  }

  /** Tracks ballistic stunt ramp launches and clean landings. */
  updateStunts(dt: number, pos: THREE.Vector3, airborne: boolean, driving: boolean): StuntJumpHit | null {
    if (this.stuntCooldown > 0) this.stuntCooldown = Math.max(0, this.stuntCooldown - dt);
    if (!driving) {
      this.wasAirborne = false;
      this.airTime = 0;
      return null;
    }

    if (airborne) {
      if (!this.wasAirborne) {
        this.wasAirborne = true;
        this.airTime = 0;
        this.launchPos.copy(pos);
        this.peakY = pos.y;
      }
      this.airTime += dt;
      if (pos.y > this.peakY) this.peakY = pos.y;
      return null;
    }

    if (this.wasAirborne) {
      this.wasAirborne = false;
      const airT = this.airTime;
      const dist = Math.hypot(pos.x - this.launchPos.x, pos.z - this.launchPos.z);
      const peakH = Math.max(0, this.peakY - this.launchPos.y);
      this.airTime = 0;

      if (this.stuntCooldown <= 0 && airT >= 0.55 && dist >= 14) {
        let nearest = this.stuntJumps[0];
        let bestD2 = Infinity;
        for (const s of this.stuntJumps) {
          const d2 = (s.pos.x - this.launchPos.x) ** 2 + (s.pos.z - this.launchPos.z) ** 2;
          if (d2 < bestD2) {
            bestD2 = d2;
            nearest = s;
          }
        }
        if (nearest && bestD2 < 42 * 42) {
          this.stuntCooldown = 4.0;
          const firstTime = !nearest.completed;
          nearest.completed = true;
          const reward = Math.round((firstTime ? 220 : 90) + dist * 3.5);
          return {
            def: nearest.def,
            distMeters: Math.round(dist),
            peakHeight: Number(peakH.toFixed(1)),
            reward,
          };
        }
      }
    }
    return null;
  }

  findNearbyRace(pos: THREE.Vector3, maxDist = 11): StreetRaceDef | null {
    if (this.activeRace) return null;
    let best: StreetRaceDef | null = null;
    let bestD2 = maxDist * maxDist;
    for (const r of this.races) {
      const d2 = (r.startX - pos.x) ** 2 + (r.startZ - pos.z) ** 2;
      if (d2 < bestD2) {
        bestD2 = d2;
        best = r;
      }
    }
    return best;
  }

  private buildRivalCarMesh(hex: number): THREE.Group {
    const g = new THREE.Group();
    const bodyMat = new THREE.MeshStandardMaterial({ color: hex, roughness: 0.25, metalness: 0.72 });
    const glassMat = new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.1, metalness: 0.85 });
    const body = new THREE.Mesh(new THREE.BoxGeometry(1.94, 0.62, 4.45), bodyMat);
    body.position.y = 0.54;
    body.castShadow = true;
    const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.66, 0.52, 2.05), glassMat);
    cabin.position.set(0, 1.05, -0.2);
    const wing = new THREE.Mesh(new THREE.BoxGeometry(1.85, 0.08, 0.35), bodyMat);
    wing.position.set(0, 0.96, -2.05);
    g.add(body, cabin, wing);
    return g;
  }

  startRace(race: StreetRaceDef): ActiveRaceState {
    this.cancelRace();
    const firstCp = race.checkpoints[0];
    this.activeRace = {
      race,
      checkpointIdx: 0,
      place: 1,
      totalRacers: 4,
      elapsed: 0,
      nextCheckpoint: { x: firstCp[0], z: firstCp[1] },
    };
    const cpY = this.terrainAt(firstCp[0], firstCp[1]);
    this.checkpointRing.position.set(firstCp[0], cpY + 0.15, firstCp[1]);
    this.checkpointBeam.position.set(firstCp[0], cpY + 11, firstCp[1]);
    this.checkpointRing.visible = true;
    this.checkpointBeam.visible = true;

    const startYaw = THREE.MathUtils.degToRad(race.startYawDeg);
    const rivalColors = [0xef4444, 0x3b82f6, 0x10b981];
    const rivalModels: CarId[] = ["ferrari", "audi", "r8"];
    const rivalSpeeds = [33, 30, 27.5];
    for (let i = 0; i < 3; i++) {
      const rx = race.startX + (i - 1) * 3.1;
      const rz = race.startZ - 5.2 - i * 1.5;
      const ry = this.terrainAt(rx, rz);
      const rg = this.buildRivalCarMesh(rivalColors[i]);
      rg.position.set(rx, ry, rz);
      rg.rotation.y = startYaw;
      this.root.add(rg);
      const rival = {
        group: rg,
        modelRoot: null as THREE.Group | null,
        x: rx,
        y: ry,
        z: rz,
        yaw: startYaw,
        speed: 14,
        cpIdx: 0,
        baseSpeed: rivalSpeeds[i],
      };
      this.rivals.push(rival);

      if (this.modelLibrary && typeof window !== "undefined" && typeof fetch === "function") {
        const carId = rivalModels[i % rivalModels.length];
        const paint = rivalColors[i];
        const lib = this.modelLibrary;
        void lib.loadModel(carId).then((loaded) => {
          if (!loaded || !this.root.children.includes(rival.group)) return;
          const model = lib.create(carId, { paint });
          if (!model) return;
          model.rotation.y = Math.PI;
          addVehicleLights(model, carId, true);
          rival.group.clear();
          rival.group.add(model);
          rival.modelRoot = model;
        });
      }
    }
    return this.activeRace;
  }

  cancelRace(): void {
    this.activeRace = null;
    this.checkpointRing.visible = false;
    this.checkpointBeam.visible = false;
    for (const r of this.rivals) this.root.remove(r.group);
    this.rivals.length = 0;
  }

  getActiveRaceState(): ActiveRaceState | null {
    return this.activeRace;
  }

  updateRace(dt: number, playerPos: THREE.Vector3): RaceFinishResult | null {
    const ar = this.activeRace;
    if (!ar) return null;
    ar.elapsed += dt;

    // Pulse checkpoint beacon
    const pulse = 1 + Math.sin(this.animT * 5.2) * 0.08;
    this.checkpointRing.scale.set(pulse, pulse, 1);

    // Advance AI rival sports cars along checkpoints
    let rivalsAhead = 0;
    const cps = ar.race.checkpoints;
    for (const r of this.rivals) {
      const target = cps[Math.min(r.cpIdx, cps.length - 1)];
      const dx = target[0] - r.x;
      const dz = target[1] - r.z;
      const dist = Math.hypot(dx, dz);
      if (dist < 14 && r.cpIdx < cps.length - 1) {
        r.cpIdx++;
      }
      const tyaw = Math.atan2(dx, dz);
      r.yaw = dampAngle(r.yaw, tyaw, 3.8, dt);
      r.speed = damp(r.speed, r.baseSpeed, 2.5, dt);
      r.x += Math.sin(r.yaw) * r.speed * dt;
      r.z += Math.cos(r.yaw) * r.speed * dt;
      r.y = this.terrainAt(r.x, r.z);
      r.group.position.set(r.x, r.y, r.z);
      r.group.rotation.y = r.yaw;
      if (r.modelRoot) {
        spinWheels(r.modelRoot, r.speed * dt, 0);
      }

      if (r.cpIdx > ar.checkpointIdx) rivalsAhead++;
      else if (r.cpIdx === ar.checkpointIdx) {
        const cp = cps[ar.checkpointIdx];
        const pDist = Math.hypot(cp[0] - playerPos.x, cp[1] - playerPos.z);
        if (dist < pDist) rivalsAhead++;
      }
    }
    ar.place = 1 + rivalsAhead;

    // Check player hitting current checkpoint
    const cur = cps[ar.checkpointIdx];
    const pDx = playerPos.x - cur[0];
    const pDz = playerPos.z - cur[1];
    if (pDx * pDx + pDz * pDz < 16 * 16) {
      ar.checkpointIdx++;
      if (ar.checkpointIdx >= cps.length) {
        const result: RaceFinishResult = {
          raceName: ar.race.name,
          place: ar.place,
          elapsed: Number(ar.elapsed.toFixed(1)),
          reward: Math.round(ar.race.reward1st / ar.place),
        };
        this.cancelRace();
        return result;
      }
      const next = cps[ar.checkpointIdx];
      ar.nextCheckpoint = { x: next[0], z: next[1] };
      const ny = this.terrainAt(next[0], next[1]);
      this.checkpointRing.position.set(next[0], ny + 0.15, next[1]);
      this.checkpointBeam.position.set(next[0], ny + 11, next[1]);
    }
    return null;
  }
}
