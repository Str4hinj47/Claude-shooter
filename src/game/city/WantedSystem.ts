import * as THREE from "three";
import * as SkeletonUtils from "three/examples/jsm/utils/SkeletonUtils.js";
import type { GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import { characterUrl } from "../characters";
import { loadCachedSoldierGltf, upgradeCharacterMaterial } from "../../character/SoldierRig";
import { clamp, damp, dampAngle } from "../../character/math";
import type { RoadNetwork } from "./RoadNetwork";
import type { TerrainHeightFn } from "./HeightSystem";
import type { SpatialAABBGrid } from "./SpatialIndex";
import { fitGlbToDimension, loadCityGlb } from "./PropModels";
import type { ModelLibrary } from "../vehicles/ModelLibrary";
import { spinWheels } from "../vehicles/wheels";
import { addVehicleLights, updateVehicleLights } from "../vehicles/vehicleLights";

export type CrimeKind = "gunfire" | "carjack" | "assault" | "vehicular" | "robbery" | "cop_hit";

export interface PoliceCruiser {
  id: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
  speed: number;
  isSwat: boolean;
  hp: number;
  group: THREE.Group;
  modelRoot: THREE.Group | null;
  matR: THREE.MeshStandardMaterial;
  matB: THREE.MeshStandardMaterial;
  wheels: THREE.Object3D[];
  dismounted: boolean;
  stuckT: number;
}

export interface PoliceOfficer {
  id: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
  speed: number;
  hp: number;
  fireCd: number;
  dead: boolean;
  deadTimer: number;
  root: THREE.Group;
  model: THREE.Group | null;
  mixer: THREE.AnimationMixer | null;
  actions: { idle: THREE.AnimationAction; walk: THREE.AnimationAction; run: THREE.AnimationAction } | null;
  weights: { idle: number; walk: number; run: number };
  modelRequested: boolean;
}

export interface WantedEvents {
  onOfficerShot?: (from: THREE.Vector3, to: THREE.Vector3, hitPlayer: boolean, damage: number) => void;
  onOfficerHit?: (pos: THREE.Vector3, model: THREE.Group | null) => void;
  onOfficerDown?: (pos: THREE.Vector3, reward: number, model: THREE.Group | null, yaw: number, silent?: boolean) => void;
  onChopperDown?: (pos: THREE.Vector3, reward: number) => void;
  onWantedCleared?: (starsCleared: number, bonus: number) => void;
  onStarsChanged?: (stars: number) => void;
}

export interface PoliceChopper {
  x: number;
  y: number;
  z: number;
  yaw: number;
  orbitAngle: number;
  hp: number;
  fireCd: number;
  downTimer: number;
  group: THREE.Group;
  rotor: THREE.Object3D;
  beamPivot: THREE.Group;
  beam: THREE.Mesh;
  beamMat: THREE.MeshBasicMaterial;
  searchPool: THREE.Mesh;
  searchPoolMat: THREE.MeshBasicMaterial;
}

function stripRootMotion(clip: THREE.AnimationClip): THREE.AnimationClip {
  const cloned = clip.clone();
  cloned.tracks = cloned.tracks.filter((t) => !/Hips\.position/i.test(t.name));
  return cloned;
}

/**
 * Coordinates 1-5 Star GTA-style Police Wanted Levels, pursuing Police Cruisers,
 * tactical SWAT SUVs, armed Police Officers, and line-of-sight evasion cooldowns.
 */
export class WantedSystem {
  readonly group = new THREE.Group();
  readonly cruisers: PoliceCruiser[] = [];
  readonly officers: PoliceOfficer[] = [];
  chopper: PoliceChopper | null = null;
  stars = 0;
  heat = 0;
  evading = false;
  evasionTimer = 0;
  evasionMax = 15;
  events: WantedEvents = {};

  private readonly roads: RoadNetwork;
  private readonly groundAt: (x: number, z: number, maxY: number) => number;
  private readonly terrainAt: TerrainHeightFn;
  private readonly modelLibrary: ModelLibrary | null;
  private readonly spatialAABBs: SpatialAABBGrid | null;
  private readonly isBrowser = typeof window !== "undefined" && typeof fetch === "function";
  private copGltfPromise: Promise<GLTF> | null = null;
  private crimeCd = new Map<CrimeKind, number>();
  private spawnCd = 0;
  private footSpawnCd = 0;
  private searchHoldTimer = 0;
  private lastKnownX = 0;
  private lastKnownZ = 0;
  private prevPlayerX = 0;
  private prevPlayerZ = 0;
  private hasPrevPlayer = false;
  private aabbScratch: THREE.Box3[] = [];
  private unitSeq = 1;
  private flashClock = 0;
  private cruiserDisabled = new Set<number>();

  constructor(
    roads: RoadNetwork,
    terrainAt: TerrainHeightFn,
    groundAt: (x: number, z: number, maxY: number) => number,
    modelLibrary: ModelLibrary | null = null,
    spatialAABBs: SpatialAABBGrid | null = null,
  ) {
    this.group.name = "WestgateWantedUnits";
    this.roads = roads;
    this.terrainAt = terrainAt;
    this.groundAt = groundAt;
    this.modelLibrary = modelLibrary;
    this.spatialAABBs = spatialAABBs;
  }

  private isBlockedByBuilding(x: number, y: number, z: number, pad: number): boolean {
    if (!this.spatialAABBs) return false;
    const boxes = this.spatialAABBs.queryPoint(x, z, pad, this.aabbScratch);
    for (let i = 0; i < boxes.length; i++) {
      const b = boxes[i];
      if (y + 1.6 < b.min.y || y + 0.3 > b.max.y) continue;
      if (x + pad > b.min.x && x - pad < b.max.x && z + pad > b.min.z && z - pad < b.max.z) {
        return true;
      }
    }
    return false;
  }

  reportCrime(kind: CrimeKind, pos: { x: number; z: number }): void {
    const cd = this.crimeCd.get(kind) ?? 0;
    this.lastKnownX = pos.x;
    this.lastKnownZ = pos.z;
    if (this.stars > 0) {
      // Refresh pursuit search lock on ongoing crimes so cops don't give up mid-gunfight
      this.searchHoldTimer = Math.max(this.searchHoldTimer, 8 + this.stars * 2.5);
      this.evading = false;
      this.evasionTimer = this.evasionMax;
    }
    if (cd > 0) return;

    const cdDur =
      kind === "gunfire" ? 3.5 : kind === "carjack" ? 3.0 : kind === "assault" ? 2.0 : kind === "cop_hit" ? 1.5 : 2.0;
    this.crimeCd.set(kind, cdDur);

    const prevStars = this.stars;
    if (kind === "gunfire") {
      this.heat = Math.max(this.heat + 24, 30);
    } else if (kind === "carjack") {
      this.heat = Math.max(this.heat + 36, 40);
    } else if (kind === "assault" || kind === "vehicular") {
      this.heat = Math.max(this.heat + 48, 74);
    } else if (kind === "robbery") {
      this.heat = Math.max(this.heat + 65, 86);
    } else if (kind === "cop_hit") {
      this.heat = Math.max(this.heat + 80, 135);
    }
    this.heat = Math.min(360, this.heat);

    const nextStars =
      this.heat >= 280
        ? 5
        : this.heat >= 200
          ? 4
          : this.heat >= 125
            ? 3
            : this.heat >= 70
              ? 2
              : this.heat >= 25
                ? 1
                : 0;

    this.stars = Math.max(this.stars, nextStars);
    if (this.stars > 0) {
      this.evading = false;
      this.evasionMax = 16 + this.stars * 5.0;
      this.evasionTimer = this.evasionMax;
      this.searchHoldTimer = Math.max(this.searchHoldTimer, 10 + this.stars * 3.5);
      if (this.cruisers.length === 0) this.spawnCd = 0;
    }
    if (this.stars !== prevStars) {
      this.events.onStarsChanged?.(this.stars);
    }
  }

  clearWanted(awardBonus = false): void {
    const prev = this.stars;
    this.stars = 0;
    this.heat = 0;
    this.evading = false;
    this.evasionTimer = 0;
    this.searchHoldTimer = 0;
    this.despawnAll();
    if (prev > 0) {
      this.events.onStarsChanged?.(0);
      if (awardBonus) {
        this.events.onWantedCleared?.(prev, prev * 150);
      }
    }
  }

  private despawnAll(): void {
    for (const c of this.cruisers) this.group.remove(c.group);
    for (const o of this.officers) this.group.remove(o.root);
    if (this.chopper) {
      this.group.remove(this.chopper.group);
      this.group.remove(this.chopper.searchPool);
      this.chopper = null;
    }
    this.cruisers.length = 0;
    this.officers.length = 0;
    this.cruiserDisabled.clear();
  }

  private spawnChopper(px: number, py: number, pz: number): void {
    const g = new THREE.Group();
    const darkMat = new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.35, metalness: 0.65 });
    const whiteMat = new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.4 });
    const glassMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.1, metalness: 0.85, transparent: true, opacity: 0.72 });
    const bladeMat = new THREE.MeshStandardMaterial({ color: 0x27272a, roughness: 0.4 });

    const body = new THREE.Mesh(new THREE.BoxGeometry(1.75, 1.45, 4.3), darkMat);
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.34, 2.4), whiteMat);
    const cockpit = new THREE.Mesh(new THREE.BoxGeometry(1.55, 1.15, 1.35), glassMat);
    cockpit.position.set(0, 0.1, 2.2);
    const tail = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.42, 4.2), darkMat);
    tail.position.set(0, 0.2, -3.5);

    const rotor = new THREE.Group();
    rotor.position.set(0, 1.0, 0);
    for (let i = 0; i < 4; i++) {
      const b = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.04, 4.8), bladeMat);
      b.rotation.y = (i * Math.PI) / 2;
      b.position.set(Math.sin(b.rotation.y) * 2.4, 0, Math.cos(b.rotation.y) * 2.4);
      rotor.add(b);
    }

    // Sweeping Volumetric Searchlight Beam Cone (unit length along +Z from apex at pivot)
    const beamPivot = new THREE.Group();
    beamPivot.position.set(0, -0.82, 1.25);
    const beamGeo = new THREE.ConeGeometry(6.8, 1.0, 18, 1, true);
    beamGeo.translate(0, -0.5, 0);
    beamGeo.rotateX(-Math.PI * 0.5);
    const beamMat = new THREE.MeshBasicMaterial({
      color: 0xe0f2fe,
      transparent: true,
      opacity: 0.14,
      side: THREE.DoubleSide,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const beam = new THREE.Mesh(beamGeo, beamMat);
    beam.scale.set(1, 1, 44);
    beamPivot.add(beam);

    // Ground searchlight halo pool
    const searchPoolMat = new THREE.MeshBasicMaterial({
      color: 0xe0f2fe,
      transparent: true,
      opacity: 0.22,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const searchPool = new THREE.Mesh(new THREE.CircleGeometry(6.4, 24), searchPoolMat);
    searchPool.rotation.x = -Math.PI * 0.5;
    searchPool.position.set(px, py + 0.12, pz);
    this.group.add(searchPool);

    g.add(body, stripe, cockpit, tail, rotor, beamPivot);
    const x = px + 65;
    const y = py + 38;
    const z = pz + 65;
    g.position.set(x, y, z);
    this.group.add(g);

    const chopperObj: PoliceChopper = {
      x,
      y,
      z,
      yaw: Math.atan2(px - x, pz - z),
      orbitAngle: 0,
      hp: 180,
      fireCd: 2.0,
      downTimer: 0,
      group: g,
      rotor,
      beamPivot,
      beam,
      beamMat,
      searchPool,
      searchPoolMat,
    };
    this.chopper = chopperObj;

    void loadCityGlb("heli.glb").then((scene) => {
      if (!scene || this.chopper !== chopperObj) return;
      const fitted = fitGlbToDimension(scene, "z", 6.2, -0.8);
      let glbRotor: THREE.Object3D | null = null;
      fitted.traverse((o) => {
        const n = o.name.toLowerCase();
        if (n === "empty001" || n === "cube004") glbRotor = o;
      });
      g.clear();
      g.add(fitted, beamPivot);
      if (glbRotor) chopperObj.rotor = glbRotor;
    });
  }

  private buildCruiserMesh(isSwat: boolean): {
    group: THREE.Group;
    matR: THREE.MeshStandardMaterial;
    matB: THREE.MeshStandardMaterial;
    wheels: THREE.Mesh[];
  } {
    const g = new THREE.Group();
    const darkMat = new THREE.MeshStandardMaterial({ color: isSwat ? 0x0b0f17 : 0x111827, roughness: 0.3, metalness: 0.6 });
    const whiteMat = new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.35, metalness: 0.25 });
    const glassMat = new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.12, metalness: 0.85 });
    const wheelMat = new THREE.MeshStandardMaterial({ color: 0x18181b, roughness: 0.85, metalness: 0.2 });

    const body = new THREE.Mesh(new THREE.BoxGeometry(1.98, 0.72, 4.65), darkMat);
    body.position.y = 0.62;
    body.castShadow = true;
    g.add(body);

    if (!isSwat) {
      const doors = new THREE.Mesh(new THREE.BoxGeometry(2.01, 0.56, 1.85), whiteMat);
      doors.position.set(0, 0.64, 0.05);
      g.add(doors);
    }

    const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.74, 0.62, isSwat ? 2.85 : 2.15), glassMat);
    cabin.position.set(0, 1.24, -0.18);
    cabin.castShadow = true;
    g.add(cabin);

    const roof = new THREE.Mesh(new THREE.BoxGeometry(1.68, 0.08, isSwat ? 2.75 : 1.9), isSwat ? darkMat : whiteMat);
    roof.position.set(0, 1.56, -0.18);
    g.add(roof);

    // Push bar
    const pushBar = new THREE.Mesh(new THREE.BoxGeometry(1.55, 0.34, 0.14), darkMat);
    pushBar.position.set(0, 0.58, 2.38);
    g.add(pushBar);

    // Lightbar
    const matR = new THREE.MeshStandardMaterial({ color: 0xef4444, emissive: 0xff1a1a, emissiveIntensity: 3.5 });
    const matB = new THREE.MeshStandardMaterial({ color: 0x3b82f6, emissive: 0x1d7bff, emissiveIntensity: 0.3 });
    const red = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.14, 0.24), matR);
    red.position.set(-0.28, 1.66, -0.1);
    const blue = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.14, 0.24), matB);
    blue.position.set(0.28, 1.66, -0.1);
    g.add(red, blue);

    const wGeo = new THREE.CylinderGeometry(0.36, 0.36, 0.26, 12);
    wGeo.rotateZ(Math.PI * 0.5);
    const wheels: THREE.Mesh[] = [];
    for (const [wx, wz] of [
      [-0.96, 1.48],
      [0.96, 1.48],
      [-0.96, -1.48],
      [0.96, -1.48],
    ]) {
      const wm = new THREE.Mesh(wGeo, wheelMat);
      wm.position.set(wx, 0.36, wz);
      g.add(wm);
      wheels.push(wm);
    }
    return { group: g, matR, matB, wheels };
  }

  private spawnCruiserNear(px: number, pz: number, isSwat: boolean, biasDirX = 0, biasDirZ = 0): boolean {
    const hasBias = biasDirX * biasDirX + biasDirZ * biasDirZ > 0.04;
    const baseAngle = hasBias ? Math.atan2(biasDirX, biasDirZ) : Math.random() * Math.PI * 2;
    let sx = px + 65;
    let sz = pz + 65;
    let gy = -1;

    for (let attempt = 0; attempt < 6; attempt++) {
      const ang = baseAngle + (attempt - 2.5) * 0.65 + (Math.random() - 0.5) * 0.35;
      const rad = (hasBias && attempt < 2 ? 78 : 54) + Math.random() * 28;
      const candX = px + Math.sin(ang) * rad;
      const candZ = pz + Math.cos(ang) * rad;
      const lanePt = this.roads.nearestLanePoint(candX, candZ, 95);
      const tx = lanePt ? lanePt.pos.x : candX;
      const tz = lanePt ? lanePt.pos.z : candZ;
      const groundY = this.groundAt(tx, tz, this.terrainAt(tx, tz) + 2);
      if (groundY >= 2.0 && !this.isBlockedByBuilding(tx, groundY, tz, 1.8) && Math.hypot(tx - px, tz - pz) >= 34) {
        sx = tx;
        sz = tz;
        gy = groundY;
        break;
      }
    }
    if (gy < 2.0) return false;

    const mesh = this.buildCruiserMesh(isSwat);
    const yaw = Math.atan2(px - sx, pz - sz);
    mesh.group.position.set(sx, gy, sz);
    mesh.group.rotation.y = yaw;
    this.group.add(mesh.group);

    const cruiser: PoliceCruiser = {
      id: this.unitSeq++,
      x: sx,
      y: gy,
      z: sz,
      yaw,
      speed: 18,
      isSwat,
      hp: isSwat ? 160 : 110,
      group: mesh.group,
      modelRoot: null,
      matR: mesh.matR,
      matB: mesh.matB,
      wheels: mesh.wheels,
      dismounted: false,
      stuckT: 0,
    };
    this.cruisers.push(cruiser);

    if (this.isBrowser && this.modelLibrary) {
      const glbId = isSwat ? "offroad" : "police_cruiser";
      const lib = this.modelLibrary;
      void lib.loadModel(glbId).then((loaded) => {
        if (!loaded || !this.group.children.includes(cruiser.group)) return;
        const model = lib.create(glbId, isSwat ? { paint: 0x0b0f17 } : {});
        if (!model) return;
        model.rotation.y = Math.PI;
        addVehicleLights(model, glbId, true);

        const roofY = loaded.height + 0.03;
        const bar = new THREE.Group();
        bar.position.set(0, roofY, isSwat ? -0.18 : -0.1);
        const housingMat = new THREE.MeshStandardMaterial({ color: 0x111827, roughness: 0.4, metalness: 0.7 });
        const mid = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.1, 0.22), housingMat);
        const red = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.12, 0.24), cruiser.matR);
        red.position.x = -0.26;
        const blue = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.12, 0.24), cruiser.matB);
        blue.position.x = 0.26;
        bar.add(mid, red, blue);

        cruiser.group.clear();
        cruiser.group.add(model, bar);
        cruiser.modelRoot = model;
        cruiser.wheels = [];
      });
    }
    return true;
  }

  private spawnOfficerAt(x: number, y: number, z: number, yaw: number): void {
    const root = new THREE.Group();
    root.position.set(x, y, z);
    root.rotation.y = yaw;
    this.group.add(root);

    const officer: PoliceOfficer = {
      id: this.unitSeq++,
      x,
      y,
      z,
      yaw,
      speed: 0,
      hp: 85,
      fireCd: 0.75 + Math.random() * 0.6,
      dead: false,
      deadTimer: 0,
      root,
      model: null,
      mixer: null,
      actions: null,
      weights: { idle: 0, walk: 1, run: 0 },
      modelRequested: false,
    };
    this.officers.push(officer);
    this.ensureOfficerModel(officer);
  }

  private ensureOfficerModel(officer: PoliceOfficer): void {
    if (!this.isBrowser || officer.modelRequested) return;
    officer.modelRequested = true;
    if (!this.copGltfPromise) {
      this.copGltfPromise = loadCachedSoldierGltf(characterUrl("police"));
    }
    this.copGltfPromise
      .then((gltf) => {
        if (!this.group.children.includes(officer.root)) return;
        const cloned = SkeletonUtils.clone(gltf.scene) as THREE.Group;
        cloned.rotation.y = Math.PI;
        cloned.traverse((o) => {
          const m = o as THREE.Mesh;
          if (!m.isMesh) return;
          m.castShadow = true;
          m.receiveShadow = true;
          m.userData.sharedGltfAsset = true;
          const orig = Array.isArray(m.material) ? m.material : [m.material];
          const up = orig.map((mat) => upgradeCharacterMaterial(mat));
          m.material = Array.isArray(m.material) ? up : up[0];
        });
        cloned.updateMatrixWorld(true);
        const box = new THREE.Box3().setFromObject(cloned);
        const h = box.max.y - box.min.y;
        if (h > 0.2) cloned.scale.multiplyScalar(1.82 / h);

        const mixer = new THREE.AnimationMixer(cloned);
        const find = (n: string) => {
          const exact = gltf.animations.find((a) => a.name === n);
          if (exact) return stripRootMotion(exact);
          const fuzzy = gltf.animations.find((a) => a.name.toLowerCase().includes(n.toLowerCase()));
          return stripRootMotion(fuzzy ?? gltf.animations[0]);
        };
        const idle = mixer.clipAction(find("Idle"));
        const walk = mixer.clipAction(find("Walk"));
        const run = mixer.clipAction(find("Run"));
        for (const a of [idle, walk, run]) {
          a.setLoop(THREE.LoopRepeat, Infinity);
          a.play();
          a.setEffectiveWeight(0);
        }
        walk.setEffectiveWeight(1);
        mixer.update(0);

        officer.model = cloned;
        officer.mixer = mixer;
        officer.actions = { idle, walk, run };
        officer.root.add(cloned);
      })
      .catch(() => {});
  }

  /** Finds a flanked or unaware police officer eligible for a silent takedown. */
  getStealthTakedownCandidate(playerPos: THREE.Vector3): { x: number; y: number; z: number } | null {
    let bestD = 2.3;
    let best: { x: number; y: number; z: number } | null = null;
    const maxDot = this.stars > 0 ? 0.12 : 0.38;
    for (const o of this.officers) {
      if (o.dead) continue;
      if (Math.abs(o.y - playerPos.y) > 1.35) continue;
      const d = Math.hypot(playerPos.x - o.x, playerPos.z - o.z);
      if (d >= bestD) continue;
      const toPX = (playerPos.x - o.x) / Math.max(0.01, d);
      const toPZ = (playerPos.z - o.z) / Math.max(0.01, d);
      if (Math.sin(o.yaw) * toPX + Math.cos(o.yaw) * toPZ > maxDot) continue;
      bestD = d;
      best = { x: o.x, y: o.y, z: o.z };
    }
    return best;
  }

  /** Executes a silent takedown on an isolated/flanked police officer. */
  tryStealthTakedown(playerPos: THREE.Vector3): { killed: boolean; witnessed: boolean; pos: THREE.Vector3 } | null {
    const maxDot = this.stars > 0 ? 0.12 : 0.38;
    let target = null as (typeof this.officers)[number] | null;
    let bestD = 2.3;
    for (const o of this.officers) {
      if (o.dead) continue;
      if (Math.abs(o.y - playerPos.y) > 1.35) continue;
      const d = Math.hypot(playerPos.x - o.x, playerPos.z - o.z);
      if (d >= bestD) continue;
      const toPX = (playerPos.x - o.x) / Math.max(0.01, d);
      const toPZ = (playerPos.z - o.z) / Math.max(0.01, d);
      if (Math.sin(o.yaw) * toPX + Math.cos(o.yaw) * toPZ > maxDot) continue;
      bestD = d;
      target = o;
    }
    if (!target) return null;

    let witnessed = false;
    for (const other of this.officers) {
      if (other === target || other.dead) continue;
      const od = Math.hypot(target.x - other.x, target.z - other.z);
      if (od > 20) continue;
      const toTX = (target.x - other.x) / Math.max(0.01, od);
      const toTZ = (target.z - other.z) / Math.max(0.01, od);
      if (Math.sin(other.yaw) * toTX + Math.cos(other.yaw) * toTZ > 0.25) {
        witnessed = true;
        break;
      }
    }

    const pos = new THREE.Vector3(target.x, target.y, target.z);
    target.dead = true;
    target.hp = 0;
    const detached = target.model;
    if (detached) target.root.remove(detached);
    target.model = null;
    target.mixer = null;
    target.actions = null;
    target.deadTimer = detached ? 0.1 : 4.5;
    target.root.visible = !detached;
    this.events.onOfficerDown?.(pos, 65, detached, target.yaw, true);
    if (witnessed) {
      this.reportCrime("cop_hit", { x: target.x, z: target.z });
    }
    return { killed: true, witnessed, pos };
  }

  /** Hit-check player gunfire against pursuing police officers or cruisers */
  hitAtPoint(x: number, y: number, z: number, damage = 34): boolean {
    for (const o of this.officers) {
      if (o.dead) continue;
      if (y < o.y - 0.1 || y > o.y + 1.95) continue;
      const dx = o.x - x;
      const dz = o.z - z;
      if (dx * dx + dz * dz <= 0.65 * 0.65) {
        o.hp -= damage;
        this.reportCrime("cop_hit", { x, z });
        const hitPos = new THREE.Vector3(x, y, z);
        this.events.onOfficerHit?.(hitPos, o.model);
        if (o.hp <= 0) {
          o.dead = true;
          const detached = o.model;
          if (detached) o.root.remove(detached);
          o.model = null;
          o.mixer = null;
          o.actions = null;
          o.deadTimer = detached ? 0.1 : 4.5;
          o.root.visible = !detached;
          this.events.onOfficerDown?.(new THREE.Vector3(o.x, o.y, o.z), 65, detached, o.yaw);
        }
        return true;
      }
    }
    for (const c of this.cruisers) {
      if (this.cruiserDisabled.has(c.id)) continue;
      if (y < c.y - 0.1 || y > c.y + 1.8) continue;
      const dx = c.x - x;
      const dz = c.z - z;
      if (dx * dx + dz * dz <= 2.3 * 2.3) {
        c.hp -= damage;
        this.reportCrime("cop_hit", { x, z });
        if (c.hp <= 0) {
          this.cruiserDisabled.add(c.id);
          c.speed = 0;
        }
        return true;
      }
    }
    if (this.chopper && this.chopper.hp > 0) {
      const ch = this.chopper;
      if (Math.hypot(ch.x - x, ch.y - y, ch.z - z) <= 3.6) {
        ch.hp -= damage;
        this.reportCrime("cop_hit", { x, z });
        if (ch.hp <= 0) {
          ch.downTimer = 3.2;
          ch.beamPivot.visible = false;
          ch.searchPool.visible = false;
          this.events.onChopperDown?.(new THREE.Vector3(ch.x, ch.y, ch.z), 400);
        }
        return true;
      }
    }
    return false;
  }

  /** Returns siren intensity (0..1) from nearest active police cruiser */
  update(
    dt: number,
    playerPos: { x: number; y: number; z: number },
    playerSpeed: number,
    playerDriving: boolean,
    camera?: THREE.Camera,
    darkness = 0,
  ): number {
    const cdt = Math.min(Math.max(dt, 0), 0.05);
    this.flashClock += cdt;
    for (const [k, v] of this.crimeCd) {
      if (v <= cdt) this.crimeCd.delete(k);
      else this.crimeCd.set(k, v - cdt);
    }

    if (this.stars <= 0) {
      this.hasPrevPlayer = false;
      if (this.cruisers.length > 0 || this.officers.length > 0) this.despawnAll();
      return 0;
    }

    let velX = 0;
    let velZ = 0;
    if (this.hasPrevPlayer && cdt > 1e-4) {
      velX = (playerPos.x - this.prevPlayerX) / cdt;
      velZ = (playerPos.z - this.prevPlayerZ) / cdt;
    }
    this.prevPlayerX = playerPos.x;
    this.prevPlayerZ = playerPos.z;
    this.hasPrevPlayer = true;

    this.searchHoldTimer = Math.max(0, this.searchHoldTimer - cdt);
    this.spawnCd -= cdt;
    this.footSpawnCd -= cdt;
    const maxCruisers = this.stars <= 1 ? 2 : this.stars <= 3 ? 3 : 4;
    const maxOfficers = this.stars <= 1 ? 3 : this.stars <= 3 ? 5 : 7;

    if (this.spawnCd <= 0 && this.cruisers.length < maxCruisers) {
      const spawned = this.spawnCruiserNear(
        playerPos.x,
        playerPos.z,
        this.stars >= 3 && this.cruisers.length > 0,
        velX,
        velZ,
      );
      this.spawnCd = spawned ? 2.4 : 0.45;
    }

    let nearestDist = Infinity;
    let hasActiveSight = false;
    const flash = (this.flashClock % 0.34) < 0.17;

    // 1. Update Police Cruisers
    for (let i = this.cruisers.length - 1; i >= 0; i--) {
      const c = this.cruisers[i];
      const dx = playerPos.x - c.x;
      const dz = playerPos.z - c.z;
      const dist = Math.hypot(dx, dz);
      if (dist < nearestDist) nearestDist = dist;
      if (dist <= 95) {
        hasActiveSight = true;
        this.lastKnownX = playerPos.x;
        this.lastKnownZ = playerPos.z;
      }

      // Recycle far-behind units quickly into an ahead intercept spawn
      if (dist > 220) {
        this.group.remove(c.group);
        this.cruisers.splice(i, 1);
        this.spawnCd = Math.min(this.spawnCd, 0.25);
        continue;
      }

      const active = !this.cruiserDisabled.has(c.id);
      c.matR.emissiveIntensity = active ? (flash ? 4.2 : 0.15) : 0.1;
      c.matB.emissiveIntensity = active ? (flash ? 0.15 : 4.2) : 0.1;

      if (active) {
        const aimX = hasActiveSight ? playerPos.x : this.lastKnownX;
        const aimZ = hasActiveSight ? playerPos.z : this.lastKnownZ;
        const adx = aimX - c.x;
        const adz = aimZ - c.z;
        const aimDist = Math.hypot(adx, adz);

        const wantStopDist = playerDriving ? 9 : 14;
        const interceptCap = playerDriving ? Math.min(48, Math.max(playerSpeed + 7, 24 + this.stars * 4.5)) : Math.min(28, 17 + this.stars * 2.2);
        const targetSpd = aimDist > wantStopDist ? interceptCap : 0;
        c.speed = damp(c.speed, targetSpd, 4.5, cdt);

        // Steer toward target while avoiding buildings via multi-ray lookahead
        let desiredYaw = Math.atan2(adx, adz);
        const probeDist = 5.5 + c.speed * 0.22;
        const pxStraight = c.x + Math.sin(desiredYaw) * probeDist;
        const pzStraight = c.z + Math.cos(desiredYaw) * probeDist;
        if (this.isBlockedByBuilding(pxStraight, c.y, pzStraight, 1.65)) {
          for (const offset of [0.65, -0.65, 1.25, -1.25, 1.9, -1.9]) {
            const candYaw = desiredYaw + offset;
            const cxp = c.x + Math.sin(candYaw) * probeDist;
            const czp = c.z + Math.cos(candYaw) * probeDist;
            if (!this.isBlockedByBuilding(cxp, c.y, czp, 1.55) && this.groundAt(cxp, czp, c.y + 2.5) >= 1.6) {
              desiredYaw = candYaw;
              break;
            }
          }
        }
        c.yaw = dampAngle(c.yaw, desiredYaw, 4.2, cdt);

        const nx = c.x + Math.sin(c.yaw) * c.speed * cdt;
        const nz = c.z + Math.cos(c.yaw) * c.speed * cdt;
        const gy = this.groundAt(nx, nz, c.y + 2.2);
        const moved = gy >= 1.6 && !this.isBlockedByBuilding(nx, gy, nz, 1.35);
        if (moved) {
          c.x = nx;
          c.y = gy;
          c.z = nz;
          c.stuckT = Math.max(0, c.stuckT - cdt * 2);
        } else {
          c.stuckT += cdt;
          c.yaw += 1.8 * cdt;
          if (c.stuckT > 2.4) {
            // Re-deploy cruiser onto nearest clear road lane instead of stalling forever
            this.group.remove(c.group);
            this.cruisers.splice(i, 1);
            this.spawnCd = Math.min(this.spawnCd, 0.2);
            continue;
          }
        }
        if (c.modelRoot) {
          spinWheels(c.modelRoot, c.speed * cdt, 0);
          if (camera) {
            updateVehicleLights(c.modelRoot, camera, darkness, targetSpd === 0 || c.speed < 1.2, null, false);
          }
        } else {
          const dWheel = (c.speed * cdt) / 0.36;
          for (const w of c.wheels) w.rotation.x += dWheel;
        }

        // Deploy officers when cruiser closes in
        if (dist < 30 && !c.dismounted && this.officers.length < maxOfficers) {
          c.dismounted = true;
          this.spawnOfficerAt(c.x + 2.2, c.y, c.z + 1.4, desiredYaw);
          if (this.stars >= 2 && this.officers.length < maxOfficers) {
            this.spawnOfficerAt(c.x - 2.2, c.y, c.z - 1.4, desiredYaw);
          }
        }
      }
      c.group.position.set(c.x, c.y, c.z);
      c.group.rotation.y = c.yaw;
    }

    // Also deploy foot patrols if player stays on foot & officers < max
    if (!playerDriving && this.officers.length < maxOfficers && this.footSpawnCd <= 0) {
      this.footSpawnCd = 3.2;
      const ang = Math.random() * Math.PI * 2;
      const ox = playerPos.x + Math.cos(ang) * 38;
      const oz = playerPos.z + Math.sin(ang) * 38;
      const oy = this.groundAt(ox, oz, this.terrainAt(ox, oz) + 2);
      if (oy >= 2.0 && !this.isBlockedByBuilding(ox, oy, oz, 0.8)) {
        this.spawnOfficerAt(ox, oy, oz, ang + Math.PI);
      }
    }

    // 2. Update Armed Police Officers
    for (let i = this.officers.length - 1; i >= 0; i--) {
      const o = this.officers[i];
      if (o.dead) {
        o.deadTimer -= cdt;
        o.root.rotation.x = damp(o.root.rotation.x, -Math.PI * 0.48, 8, cdt);
        if (o.deadTimer <= 0) {
          this.group.remove(o.root);
          this.officers.splice(i, 1);
        }
        continue;
      }

      const dx = playerPos.x - o.x;
      const dz = playerPos.z - o.z;
      const dist = Math.hypot(dx, dz);
      if (dist < nearestDist) nearestDist = dist;
      if (dist <= 95) {
        hasActiveSight = true;
        this.lastKnownX = playerPos.x;
        this.lastKnownZ = playerPos.z;
      }

      // Vehicle ramming police officer
      if (playerDriving && playerSpeed > 6 && dist < 2.1 && Math.abs(playerPos.y - o.y) < 2.2) {
        o.hp = 0;
        o.dead = true;
        const detached = o.model;
        if (detached) o.root.remove(detached);
        o.model = null;
        o.mixer = null;
        o.actions = null;
        o.deadTimer = detached ? 0.1 : 4.5;
        o.root.visible = !detached;
        this.reportCrime("cop_hit", { x: o.x, z: o.z });
        this.events.onOfficerHit?.(new THREE.Vector3(o.x, o.y + 0.9, o.z), null);
        this.events.onOfficerDown?.(new THREE.Vector3(o.x, o.y, o.z), 65, detached, o.yaw);
        continue;
      }

      if (dist > 165) {
        this.group.remove(o.root);
        this.officers.splice(i, 1);
        continue;
      }

      let targetYaw = Math.atan2(dx, dz);
      const stepProbe = 2.4;
      if (this.isBlockedByBuilding(o.x + Math.sin(targetYaw) * stepProbe, o.y, o.z + Math.cos(targetYaw) * stepProbe, 0.55)) {
        for (const off of [0.75, -0.75, 1.4, -1.4]) {
          const cy = targetYaw + off;
          if (!this.isBlockedByBuilding(o.x + Math.sin(cy) * stepProbe, o.y, o.z + Math.cos(cy) * stepProbe, 0.55)) {
            targetYaw = cy;
            break;
          }
        }
      }
      o.yaw = dampAngle(o.yaw, targetYaw, 8.5, cdt);
      const targetSpd = dist > 16 ? 5.6 : dist > 10 ? 2.4 : 0;
      o.speed = damp(o.speed, targetSpd, 7.0, cdt);
      const nx = o.x + Math.sin(o.yaw) * o.speed * cdt;
      const nz = o.z + Math.cos(o.yaw) * o.speed * cdt;
      const gy = this.groundAt(nx, nz, o.y + 1.8);
      if (gy >= 1.8 && !this.isBlockedByBuilding(nx, gy, nz, 0.45)) {
        o.x = nx;
        o.y = gy;
        o.z = nz;
      }
      o.root.position.set(o.x, o.y, o.z);
      o.root.rotation.set(0, o.yaw, 0);

      // Fire shots when within combat range
      o.fireCd -= cdt;
      if (dist < 52 && o.fireCd <= 0) {
        o.fireCd = Math.max(0.45, 1.25 - this.stars * 0.14) + Math.random() * 0.35;
        const from = new THREE.Vector3(o.x, o.y + 1.45, o.z);
        const hitAcc = playerDriving ? 0.24 : 0.44;
        const hitPlayer = Math.random() < hitAcc;
        const to = new THREE.Vector3(
          playerPos.x + (hitPlayer ? 0 : (Math.random() - 0.5) * 3.5),
          playerPos.y + 1.15 + (hitPlayer ? 0 : (Math.random() - 0.5) * 1.4),
          playerPos.z + (hitPlayer ? 0 : (Math.random() - 0.5) * 3.5),
        );
        this.events.onOfficerShot?.(from, to, hitPlayer, playerDriving ? 4 : 7);
      }

      if (o.mixer && o.actions) {
        const clip: "idle" | "walk" | "run" = o.speed < 0.3 ? "idle" : o.speed >= 2.5 ? "run" : "walk";
        o.weights.idle = damp(o.weights.idle, clip === "idle" ? 1 : 0, 8, cdt);
        o.weights.walk = damp(o.weights.walk, clip === "walk" ? 1 : 0, 8, cdt);
        o.weights.run = damp(o.weights.run, clip === "run" ? 1 : 0, 8, cdt);
        const sum = Math.max(1e-4, o.weights.idle + o.weights.walk + o.weights.run);
        o.actions.idle.setEffectiveWeight(o.weights.idle / sum);
        o.actions.walk.setEffectiveWeight(o.weights.walk / sum);
        o.actions.run.setEffectiveWeight(o.weights.run / sum);
        o.actions.walk.timeScale = clamp(o.speed / 1.45, 0.6, 1.5);
        o.actions.run.timeScale = clamp(o.speed / 3.8, 0.75, 1.4);
        o.mixer.update(cdt);
      }
    }

    // 3. 3★–5★ Police Pursuit Chopper with Sweeping Searchlight
    if (this.stars >= 3 && !this.chopper) {
      this.spawnChopper(playerPos.x, playerPos.y, playerPos.z);
    }
    if (this.chopper) {
      const ch = this.chopper;
      if (ch.hp <= 0) {
        ch.downTimer -= cdt;
        ch.y -= 14 * cdt;
        ch.yaw += 5.5 * cdt;
        ch.group.position.set(ch.x, ch.y, ch.z);
        ch.group.rotation.set(0.35, ch.yaw, 0.45);
        if (ch.downTimer <= 0) {
          this.group.remove(ch.group);
          this.group.remove(ch.searchPool);
          this.chopper = null;
        }
      } else {
        ch.orbitAngle += 0.48 * cdt;
        const tx = playerPos.x + Math.cos(ch.orbitAngle) * 32;
        const tz = playerPos.z + Math.sin(ch.orbitAngle) * 32;
        const ty = Math.max(playerPos.y + 34, this.terrainAt(tx, tz) + 32);
        ch.x = damp(ch.x, tx, 1.8, cdt);
        ch.y = damp(ch.y, ty, 2.0, cdt);
        ch.z = damp(ch.z, tz, 1.8, cdt);
        ch.yaw = dampAngle(ch.yaw, Math.atan2(playerPos.x - ch.x, playerPos.z - ch.z), 3.2, cdt);
        ch.rotor.rotation.y += 28 * cdt;
        ch.group.position.set(ch.x, ch.y, ch.z);
        ch.group.rotation.set(0.14, ch.yaw, 0);
        ch.group.updateMatrixWorld(true);

        // Aim sweeping searchlight cone & ground halo pool toward player
        const sweepX = playerPos.x + Math.sin(this.flashClock * 0.95) * 4.2;
        const sweepZ = playerPos.z + Math.cos(this.flashClock * 0.72) * 4.2;
        const sweepY = Math.max(playerPos.y, this.groundAt(sweepX, sweepZ, playerPos.y + 5.0));
        const pivotWorld = ch.beamPivot.getWorldPosition(new THREE.Vector3());
        const beamLen = Math.max(8, pivotWorld.distanceTo(new THREE.Vector3(sweepX, sweepY, sweepZ)));
        ch.beamPivot.lookAt(sweepX, sweepY, sweepZ);
        ch.beam.scale.set(1, 1, beamLen);
        const nightFactor = clamp(darkness, 0, 1);
        ch.beamMat.opacity = 0.05 + nightFactor * 0.21;
        ch.searchPool.position.set(sweepX, sweepY + 0.12, sweepZ);
        ch.searchPoolMat.opacity = 0.07 + nightFactor * 0.26;
        const poolPulse = 0.92 + Math.sin(this.flashClock * 3.0) * 0.08;
        ch.searchPool.scale.set(poolPulse, poolPulse, 1);

        const cDist = Math.hypot(playerPos.x - ch.x, playerPos.z - ch.z);
        if (cDist < nearestDist) nearestDist = cDist;
        if (cDist <= 120) {
          hasActiveSight = true;
          this.lastKnownX = playerPos.x;
          this.lastKnownZ = playerPos.z;
        }

        ch.fireCd -= cdt;
        if (this.stars >= 4 && cDist < 65 && ch.fireCd <= 0) {
          ch.fireCd = 1.15;
          const from = new THREE.Vector3(ch.x, ch.y - 1.0, ch.z);
          const hit = Math.random() < 0.18;
          const to = new THREE.Vector3(
            playerPos.x + (hit ? 0 : (Math.random() - 0.5) * 4),
            playerPos.y + 1.0,
            playerPos.z + (hit ? 0 : (Math.random() - 0.5) * 4),
          );
          this.events.onOfficerShot?.(from, to, hit, 5);
        }
      }
    }

    // 4. Evasion countdown only begins after initial dispatch/search hold AND once player breaks pursuit sight
    if (!hasActiveSight && this.searchHoldTimer <= 0 && nearestDist > 95) {
      this.evading = true;
      this.evasionTimer = Math.max(0, this.evasionTimer - cdt);
      if (this.evasionTimer <= 0) {
        this.clearWanted(true);
        return 0;
      }
    } else {
      this.evading = false;
      this.evasionTimer = this.evasionMax;
    }

    return clamp(1 - nearestDist / 135, 0.12, 1);
  }

  getCruiserBlips(): Array<{ x: number; z: number; isSwat: boolean; isChopper?: boolean }> {
    const out: Array<{ x: number; z: number; isSwat: boolean; isChopper?: boolean }> =
      this.cruisers.map((c) => ({ x: c.x, z: c.z, isSwat: c.isSwat }));
    if (this.chopper && this.chopper.hp > 0) {
      out.push({ x: this.chopper.x, z: this.chopper.z, isSwat: true, isChopper: true });
    }
    return out;
  }
}
