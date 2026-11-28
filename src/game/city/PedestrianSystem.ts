import * as THREE from "three";
import * as SkeletonUtils from "three/examples/jsm/utils/SkeletonUtils.js";
import type { GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import { CHARACTERS, characterUrl } from "../characters";
import { loadCachedSoldierGltf, scheduleRocketboxHandSkinTone, upgradeCharacterMaterial } from "../../character/SoldierRig";
import { samplePedestrianHeadNoise } from "../../character/AnimationMotion";
import { clamp, damp, dampAngle } from "../../character/math";
import type { RoadNetwork } from "./RoadNetwork";
import type { TerrainHeightFn } from "./HeightSystem";
import type { TrafficSignalManager } from "./TrafficSignals";
import { NpcVoiceSystem, type SpokenLine } from "./NpcVoices";
import { getDistrictAt } from "./WestgateTerrain";

export interface PedVehicleQuery {
  x: number;
  y: number;
  z: number;
  vx: number;
  vz: number;
  speed: number;
  halfW: number;
  halfL: number;
  isPlayer: boolean;
}

export interface PedPlayerContext {
  x: number;
  y: number;
  z: number;
  yaw: number;
  weaponDrawn: boolean;
  ads: boolean;
  carryingBody: boolean;
  crouching: boolean;
}

export interface PedWitnessIndicator {
  id: number;
  angle: number;
  suspicion: number;
  state: "idle" | "patrol" | "alert" | "attack";
  seeing: boolean;
}

interface SidewalkSegment {
  ax: number;
  az: number;
  bx: number;
  bz: number;
  ay: number;
  by: number;
  len: number;
  dirX: number;
  dirZ: number;
  signalNodeId?: string;
  isCrosswalk?: boolean;
}

export interface PedestrianAgent {
  id: number;
  roleId: string;
  voiceSeed: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
  targetYaw: number;
  vx: number;
  vy: number;
  vz: number;
  baseSpeed: number;
  speed: number;
  targetSpeed: number;
  routeIdx: number;
  routeT: number;
  routeDir: 1 | -1;
  state: "walk" | "idle" | "wait_signal" | "flee" | "knocked";
  stateTimer: number;
  speechCd: number;
  root: THREE.Group;
  model: THREE.Group | null;
  headBone?: THREE.Object3D;
  headBindQ?: THREE.Quaternion;
  mixer: THREE.AnimationMixer | null;
  actions: {
    idle: THREE.AnimationAction;
    walk: THREE.AnimationAction;
    run: THREE.AnimationAction;
  } | null;
  clipWeights: { idle: number; walk: number; run: number };
  activeClip: "idle" | "walk" | "run";
  modelRequested: boolean;
  shadowMeshes?: THREE.Mesh[];
  lastShadowCast?: boolean;
  heightScale: number;
  tumblePhase: number;
  isCrossingRoad: boolean;
  hp: number;
  dead: boolean;
  respawnTimer: number;
  weaponPanicCd: number;
  copWarnTimer: number;
  witnessSuspicion: number;
  witnessReported: boolean;
}

const upgradedMatCache = new Map<string, Map<THREE.Material, THREE.MeshPhysicalMaterial>>();

function stripRootMotion(clip: THREE.AnimationClip): THREE.AnimationClip {
  const cloned = clip.clone();
  cloned.tracks = cloned.tracks.filter((t) => !/Hips\.position/i.test(t.name));
  return cloned;
}

export class PedestrianSystem {
  readonly group = new THREE.Group();
  readonly voices = new NpcVoiceSystem();
  readonly agents: PedestrianAgent[] = [];
  private readonly routes: SidewalkSegment[] = [];
  private readonly terrainAt: TerrainHeightFn;
  private readonly signals: TrafficSignalManager | null;
  private readonly roads: RoadNetwork;
  private readonly gltfPromises = new Map<string, Promise<GLTF>>();
  private readonly isBrowser = typeof window !== "undefined" && typeof fetch === "function";
  private ambientVoiceTimer = 3.5;
  private frameTick = 0;
  readonly bodyWitnessIndicators: PedWitnessIndicator[] = [];
  onPedestrianHitByPlayer?: (ped: PedestrianAgent) => void;
  onPedestrianWounded?: (ped: PedestrianAgent, hitPoint: THREE.Vector3) => void;
  onPedestrianKilled?: (
    ped: PedestrianAgent,
    hitPoint: THREE.Vector3,
    model: THREE.Group | null,
    silent?: boolean,
  ) => void;
  onWeaponBrandishedAtCop?: (ped: PedestrianAgent) => void;
  onBodyWitnessed?: (ped: PedestrianAgent) => void;

  constructor(roads: RoadNetwork, terrainAt: TerrainHeightFn, signals: TrafficSignalManager | null) {
    this.group.name = "WestgatePedestrians";
    this.roads = roads;
    this.terrainAt = terrainAt;
    this.signals = signals;

    this.buildSidewalkAndPlazaRoutes();
    this.spawnCrowd(180);
  }

  private buildSidewalkAndPlazaRoutes(): void {
    const nodeById = new Map(this.roads.getNodes().map((n) => [n.id, n]));

    // 1. Sidewalk strips along urban streets
    for (const seg of this.roads.getSegments()) {
      if (seg.spec.isBridge || seg.spec.tier === "freeway" || seg.spec.tier === "ramp") continue;
      if (seg.samples.length < 4) continue;
      const offset = seg.carriagewayWidth * 0.5 + 1.55;
      const step = Math.max(2, Math.floor(seg.samples.length / 7));

      for (const side of [-1, 1] as const) {
        for (let i = 0; i < seg.samples.length - 1; i += step) {
          const j = Math.min(seg.samples.length - 1, i + step);
          const a = seg.samples[i];
          const b = seg.samples[j];
          const ax = a.x + a.rx * offset * side;
          const az = a.z + a.rz * offset * side;
          const bx = b.x + b.rx * offset * side;
          const bz = b.z + b.rz * offset * side;
          const ay = this.terrainAt(ax, az);
          const by = this.terrainAt(bx, bz);
          if (ay < 2.1 || by < 2.1) continue;
          const dx = bx - ax;
          const dz = bz - az;
          const len = Math.hypot(dx, dz);
          if (len < 4) continue;
          this.routes.push({
            ax,
            az,
            bx,
            bz,
            ay,
            by,
            len,
            dirX: dx / len,
            dirZ: dz / len,
          });
        }
      }

      // Crosswalk crossing segments at signalized ends
      const addCrosswalk = (t: number, nodeId: string) => {
        const sp = seg.curve.getPointAt(t);
        const tan = seg.curve.getTangentAt(t);
        const hl = Math.hypot(tan.x, tan.z) || 1;
        const rx = -tan.z / hl;
        const rz = tan.x / hl;
        const ax = sp.x - rx * offset;
        const az = sp.z - rz * offset;
        const bx = sp.x + rx * offset;
        const bz = sp.z + rz * offset;
        const ay = this.terrainAt(ax, az);
        const by = this.terrainAt(bx, bz);
        if (ay < 2.1 || by < 2.1) return;
        const dx = bx - ax;
        const dz = bz - az;
        const len = Math.hypot(dx, dz);
        this.routes.push({
          ax,
          az,
          bx,
          bz,
          ay,
          by,
          len,
          dirX: dx / len,
          dirZ: dz / len,
          signalNodeId: nodeId,
          isCrosswalk: true,
        });
      };

      const startN = seg.spec.startNodeId ? nodeById.get(seg.spec.startNodeId) : undefined;
      const endN = seg.spec.endNodeId ? nodeById.get(seg.spec.endNodeId) : undefined;
      if (startN?.kind === "signal") addCrosswalk(Math.min(0.18, 12.5 / Math.max(20, seg.length)), startN.id);
      if (endN?.kind === "signal") addCrosswalk(Math.max(0.82, 1 - 12.5 / Math.max(20, seg.length)), endN.id);
    }

    // 2. Landmark plazas & park promenades (Del Sol Pier, Mirror Park, Downtown Legion Square, University Quad)
    const addLoop = (pts: ReadonlyArray<readonly [number, number]>) => {
      for (let i = 0; i < pts.length; i++) {
        const [ax, az] = pts[i];
        const [bx, bz] = pts[(i + 1) % pts.length];
        const ay = this.terrainAt(ax, az);
        const by = this.terrainAt(bx, bz);
        const dx = bx - ax;
        const dz = bz - az;
        const len = Math.hypot(dx, dz);
        if (len < 3) continue;
        this.routes.push({ ax, az, bx, bz, ay, by, len, dirX: dx / len, dirZ: dz / len });
      }
    };

    // Del Sol Pier boardwalk promenade
    addLoop([
      [-715, -14],
      [-785, -14],
      [-785, 14],
      [-715, 14],
    ]);
    // Mirror Central Park promenade
    addLoop([
      [-146, 370],
      [-84, 370],
      [-84, 422],
      [-146, 422],
    ]);
    // Downtown Legion Square perimeter
    addLoop([
      [-132, -88],
      [-72, -88],
      [-72, -36],
      [-132, -36],
    ]);
    // University Quad loop
    addLoop([
      [188, 252],
      [252, 252],
      [252, 316],
      [188, 316],
    ]);
  }

  private pickRoleForPos(x: number, z: number, seed: number): string {
    const dist = getDistrictAt(x, z).id;
    const r = seed % 1;
    if (dist === "downtown") {
      if (r < 0.38) return "business";
      if (r < 0.64) return "civilian";
      if (r < 0.76) return "delivery";
      if (r < 0.88) return "police";
      return "security";
    }
    if (dist === "west_coast") {
      if (r < 0.36) return "sports";
      if (r < 0.72) return "civilian";
      if (r < 0.84) return "business";
      if (r < 0.93) return "delivery";
      return "police";
    }
    if (dist === "south_airport" || dist === "east_port") {
      if (r < 0.28) return "construction";
      if (r < 0.56) return "delivery";
      if (r < 0.78) return "civilian";
      if (r < 0.9) return "security";
      return "firefighter";
    }
    if (r < 0.34) return "civilian";
    if (r < 0.56) return "business";
    if (r < 0.74) return "sports";
    if (r < 0.86) return "delivery";
    if (r < 0.93) return "construction";
    return "police";
  }

  private spawnCrowd(count: number): void {
    if (this.routes.length === 0) return;
    // Deterministic seeded spawn so world starts populated in predictable balanced spots
    let s = 1337;
    const rand = () => {
      s = (s * 1664525 + 1013904223) >>> 0;
      return s / 0xffffffff;
    };

    // Prioritize urban core & landmark routes first, then spread across full city
    const stride = Math.max(1, Math.floor(this.routes.length / count));
    for (let i = 0; i < count; i++) {
      const routeIdx = (i * stride + Math.floor(rand() * stride)) % this.routes.length;
      const seg = this.routes[routeIdx];
      const t = 0.1 + rand() * 0.8;
      const x = seg.ax + (seg.bx - seg.ax) * t;
      const z = seg.az + (seg.bz - seg.az) * t;
      const y = this.terrainAt(x, z);
      const voiceSeed = rand();
      const roleId = this.pickRoleForPos(x, z, rand());
      const baseSpeed = roleId === "sports" ? 2.45 + rand() * 0.45 : 1.32 + rand() * 0.36;
      const routeDir: 1 | -1 = rand() > 0.5 ? 1 : -1;
      const yaw = Math.atan2(seg.dirX * routeDir, seg.dirZ * routeDir);

      const root = new THREE.Group();
      root.position.set(x, y, z);
      root.rotation.y = yaw;
      this.group.add(root);

      this.agents.push({
        id: i,
        roleId,
        voiceSeed,
        x,
        y,
        z,
        yaw,
        targetYaw: yaw,
        vx: 0,
        vy: 0,
        vz: 0,
        baseSpeed,
        speed: baseSpeed,
        targetSpeed: baseSpeed,
        routeIdx,
        routeT: t,
        routeDir,
        state: "walk",
        stateTimer: 4 + rand() * 14,
        speechCd: rand() * 6,
        root,
        model: null,
        mixer: null,
        actions: null,
        clipWeights: { idle: 0, walk: 1, run: 0 },
        activeClip: "walk",
        modelRequested: false,
        heightScale: 0.94 + rand() * 0.08,
        tumblePhase: 0,
        isCrossingRoad: !!seg.isCrosswalk,
        hp: 75,
        dead: false,
        respawnTimer: 0,
        weaponPanicCd: 0,
        copWarnTimer: 0,
        witnessSuspicion: 0,
        witnessReported: false,
      });
    }
  }

  private ensureAgentModel(agent: PedestrianAgent): void {
    if (!this.isBrowser || agent.modelRequested) return;
    agent.modelRequested = true;
    const valid = CHARACTERS.some((c) => c.id === agent.roleId) ? agent.roleId : "civilian";
    const url = characterUrl(valid);
    let prom = this.gltfPromises.get(url);
    if (!prom) {
      prom = loadCachedSoldierGltf(url);
      this.gltfPromises.set(url, prom);
    }

    prom
      .then((gltf) => {
        const cloned = SkeletonUtils.clone(gltf.scene) as THREE.Group;
        cloned.rotation.y = Math.PI;
        let matMap = upgradedMatCache.get(url);
        if (!matMap) {
          matMap = new Map();
          upgradedMatCache.set(url, matMap);
        }
        const sMeshes: THREE.Mesh[] = [];
        let headBone: THREE.Object3D | undefined;
        cloned.traverse((o) => {
          if (!headBone && /Head$/i.test(o.name)) headBone = o;
          const m = o as THREE.Mesh;
          if (!m.isMesh) return;
          m.castShadow = true;
          m.receiveShadow = true;
          m.userData.sharedGltfAsset = true;
          sMeshes.push(m);
          const orig = Array.isArray(m.material) ? m.material : [m.material];
          const next = orig.map((mat) => {
            let up = matMap!.get(mat);
            if (!up) {
              up = upgradeCharacterMaterial(mat);
              matMap!.set(mat, up);
            }
            return up;
          });
          m.material = Array.isArray(m.material) ? next : next[0];
        });

        scheduleRocketboxHandSkinTone(cloned);
        cloned.updateMatrixWorld(true);
        const box = new THREE.Box3().setFromObject(cloned);
        const h = box.max.y - box.min.y;
        if (h > 0.2) cloned.scale.multiplyScalar((1.78 * agent.heightScale) / h);

        const mixer = new THREE.AnimationMixer(cloned);
        agent.shadowMeshes = sMeshes;
        agent.lastShadowCast = true;
        const find = (name: string) => {
          const exact = gltf.animations.find((a) => a.name === name);
          if (exact) return stripRootMotion(exact);
          const fuzzy = gltf.animations.find((a) => a.name.toLowerCase().includes(name.toLowerCase()));
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
        idle.time = (agent.id * 0.71) % Math.max(0.5, idle.getClip().duration);
        walk.time = (agent.id * 0.37) % Math.max(0.5, walk.getClip().duration);
        run.time = (agent.id * 0.29) % Math.max(0.5, run.getClip().duration);
        walk.setEffectiveWeight(agent.clipWeights.walk);
        idle.setEffectiveWeight(agent.clipWeights.idle);
        run.setEffectiveWeight(agent.clipWeights.run);
        mixer.update(0);

        agent.model = cloned;
        if (headBone) {
          agent.headBone = headBone;
          agent.headBindQ = headBone.quaternion.clone();
        }
        agent.mixer = mixer;
        agent.actions = { idle, walk, run };
        agent.root.add(cloned);
      })
      .catch(() => {
        // Ignore individual character load failures gracefully
      });
  }

  private setAgentClip(agent: PedestrianAgent, next: "idle" | "walk" | "run", dt: number): void {
    if (!agent.actions) return;
    agent.activeClip = next;
    const rate = next === "run" ? 9.5 : 7.5;
    const cw = agent.clipWeights;
    cw.idle = damp(cw.idle, next === "idle" ? 1 : 0, rate, dt);
    cw.walk = damp(cw.walk, next === "walk" ? 1 : 0, rate, dt);
    cw.run = damp(cw.run, next === "run" ? 1 : 0, rate, dt);
    const sum = Math.max(1e-4, cw.idle + cw.walk + cw.run);
    agent.actions.idle.setEffectiveWeight(cw.idle / sum);
    agent.actions.walk.setEffectiveWeight(cw.walk / sum);
    agent.actions.run.setEffectiveWeight(cw.run / sum);
    agent.actions.walk.timeScale = clamp(agent.speed / 1.42, 0.55, 1.55);
    agent.actions.run.timeScale = clamp(agent.speed / 3.7, 0.75, 1.45);
  }

  private pickNextRoute(agent: PedestrianAgent): void {
    const seg = this.routes[agent.routeIdx];
    const ex = agent.routeDir === 1 ? seg.bx : seg.ax;
    const ez = agent.routeDir === 1 ? seg.bz : seg.az;
    let bestIdx = -1;
    let bestDir: 1 | -1 = 1;
    let bestD2 = 16 * 16;

    // Look for a connected sidewalk or crosswalk near this endpoint
    for (let k = 0; k < 24; k++) {
      const candIdx = (agent.routeIdx + 1 + k * 7) % this.routes.length;
      if (candIdx === agent.routeIdx) continue;
      const c = this.routes[candIdx];
      const dA = (c.ax - ex) * (c.ax - ex) + (c.az - ez) * (c.az - ez);
      const dB = (c.bx - ex) * (c.bx - ex) + (c.bz - ez) * (c.bz - ez);
      if (dA < bestD2) {
        bestD2 = dA;
        bestIdx = candIdx;
        bestDir = 1;
      }
      if (dB < bestD2) {
        bestD2 = dB;
        bestIdx = candIdx;
        bestDir = -1;
      }
    }

    if (bestIdx >= 0) {
      agent.routeIdx = bestIdx;
      agent.routeDir = bestDir;
      agent.routeT = bestDir === 1 ? 0 : 1;
      agent.isCrossingRoad = !!this.routes[bestIdx].isCrosswalk;
    } else {
      agent.routeDir = agent.routeDir === 1 ? -1 : 1;
      agent.routeT = agent.routeDir === 1 ? 0 : 1;
    }
  }

  /** Trigger panic scatter & shouting when gunfire occurs nearby */
  alertPanic(origin: { x: number; z: number }, radius = 45): SpokenLine | null {
    let spoken: SpokenLine | null = null;
    const r2 = radius * radius;
    for (const a of this.agents) {
      if (a.dead || a.state === "knocked") continue;
      const dx = a.x - origin.x;
      const dz = a.z - origin.z;
      const d2 = dx * dx + dz * dz;
      if (d2 > r2) continue;
      const d = Math.sqrt(d2) || 1;
      a.state = "flee";
      a.stateTimer = 6.5;
      a.vx = (dx / d) * 4.4;
      a.vz = (dz / d) * 4.4;
      a.targetSpeed = 4.4;
      a.targetYaw = Math.atan2(a.vx, a.vz);
      if (!spoken && d < 28 && a.speechCd <= 0) {
        a.speechCd = 8;
        spoken = this.voices.speak(a.roleId, "panic", a.voiceSeed, d, true);
      }
    }
    return spoken;
  }

  /** Trigger startled horn reaction from nearby pedestrians */
  onVehicleHorn(x: number, z: number): SpokenLine | null {
    let spoken: SpokenLine | null = null;
    for (const a of this.agents) {
      if (a.dead || a.state === "knocked") continue;
      const dx = a.x - x;
      const dz = a.z - z;
      const d2 = dx * dx + dz * dz;
      if (d2 > 22 * 22) continue;
      const d = Math.sqrt(d2) || 1;
      if (d < 14) {
        a.state = "flee";
        a.stateTimer = 2.4;
        a.vx = (dx / d) * 3.4;
        a.vz = (dz / d) * 3.4;
        a.targetSpeed = 3.4;
        a.targetYaw = Math.atan2(a.vx, a.vz);
      }
      if (!spoken && d < 18 && a.speechCd <= 0) {
        a.speechCd = 7;
        spoken = this.voices.speak(a.roleId, "honk", a.voiceSeed, d, true);
      }
    }
    return spoken;
  }

  /** Player greets/talks to nearest calm pedestrian */
  interactNearest(px: number, pz: number): SpokenLine | null {
    let best: PedestrianAgent | null = null;
    let bestD = 3.6;
    for (const a of this.agents) {
      if (a.dead || a.state === "knocked" || a.state === "flee") continue;
      const d = Math.hypot(a.x - px, a.z - pz);
      if (d < bestD) {
        bestD = d;
        best = a;
      }
    }
    if (!best) return null;
    best.state = "idle";
    best.stateTimer = 3.2;
    best.targetSpeed = 0;
    best.targetYaw = Math.atan2(px - best.x, pz - best.z);
    best.speechCd = 6;
    const cat = best.roleId === "police" || best.roleId === "security" ? "cop" : "greeting";
    return this.voices.speak(best.roleId, cat, best.voiceSeed, bestD, true);
  }

  /** Ejects a startled driver beside a carjacked NPC vehicle shouting at the player */
  spawnEjectedDriver(x: number, y: number, z: number, yaw: number): SpokenLine | null {
    // Reuse the farthest calm pedestrian so total crowd stays constant and fast
    let candidate = this.agents[0];
    let bestD2 = -1;
    for (const a of this.agents) {
      if (a.dead || a.state === "knocked") continue;
      const d2 = (a.x - x) * (a.x - x) + (a.z - z) * (a.z - z);
      if (d2 > bestD2) {
        bestD2 = d2;
        candidate = a;
      }
    }
    if (!candidate) return null;
    const leftX = -Math.cos(yaw);
    const leftZ = Math.sin(yaw);
    candidate.x = x + leftX * 2.1;
    candidate.z = z + leftZ * 2.1;
    candidate.y = Math.max(y, this.terrainAt(candidate.x, candidate.z));
    candidate.state = "flee";
    candidate.stateTimer = 4.5;
    candidate.vx = leftX * 3.2;
    candidate.vz = leftZ * 3.2;
    candidate.speed = 2.6;
    candidate.targetSpeed = 3.4;
    candidate.targetYaw = Math.atan2(-leftX, -leftZ);
    candidate.yaw = candidate.targetYaw;
    candidate.speechCd = 6;
    candidate.root.position.set(candidate.x, candidate.y, candidate.z);
    if (!candidate.modelRequested) this.ensureAgentModel(candidate);
    return this.voices.speak(candidate.roleId, "carjack", candidate.voiceSeed, 2.5, true);
  }

  /** Detaches the loaded visual model so BodyCarrySystem owns the persistent corpse while this crowd slot later respawns */
  private killPedestrianAgent(a: PedestrianAgent, hitPt: THREE.Vector3): void {
    if (a.dead) return;
    a.dead = true;
    a.hp = 0;
    a.respawnTimer = 18.0;
    const model = a.model;
    if (model) {
      a.root.remove(model);
    }
    a.model = null;
    a.mixer = null;
    a.actions = null;
    a.shadowMeshes = undefined;
    a.root.visible = false;
    this.voices.speak(a.roleId, "hit", a.voiceSeed, 6, true);
    this.onPedestrianKilled?.(a, hitPt, model);
  }

  /** Finds an isolated or rear-approached pedestrian eligible for a silent takedown. */
  getStealthTakedownCandidate(
    playerPos: THREE.Vector3,
    crouching = false,
  ): { agent: PedestrianAgent; x: number; y: number; z: number } | null {
    const maxAngleDot = crouching ? 0.45 : 0.25;
    let best: PedestrianAgent | null = null;
    let bestD = 2.2;
    for (const a of this.agents) {
      if (a.dead || a.state === "knocked" || a.state === "flee") continue;
      if (Math.abs(a.y - playerPos.y) > 1.35) continue;
      const d = Math.hypot(playerPos.x - a.x, playerPos.z - a.z);
      if (d >= bestD) continue;
      const toPX = (playerPos.x - a.x) / Math.max(0.01, d);
      const toPZ = (playerPos.z - a.z) / Math.max(0.01, d);
      const fX = Math.sin(a.yaw);
      const fZ = Math.cos(a.yaw);
      if (fX * toPX + fZ * toPZ > maxAngleDot) continue;
      bestD = d;
      best = a;
    }
    return best ? { agent: best, x: best.x, y: best.y, z: best.z } : null;
  }

  /**
   * Executes a silent sleeper takedown on an unaware pedestrian (no gunshot panic radius).
   * Returns whether another nearby pedestrian visually witnessed the takedown.
   */
  tryStealthTakedown(
    playerPos: THREE.Vector3,
    crouching = false,
  ): { agent: PedestrianAgent; witnessed: boolean; pos: THREE.Vector3 } | null {
    const cand = this.getStealthTakedownCandidate(playerPos, crouching);
    if (!cand) return null;
    const a = cand.agent;
    const hitPt = new THREE.Vector3(a.x, a.y + 1.1, a.z);

    // Check if another pedestrian within 16m is facing the takedown
    let witnessed = false;
    for (const other of this.agents) {
      if (other === a || other.dead || other.state === "knocked") continue;
      if (Math.abs(other.y - a.y) > 2.2) continue;
      const od = Math.hypot(a.x - other.x, a.z - other.z);
      if (od > 16) continue;
      const toAX = (a.x - other.x) / Math.max(0.01, od);
      const toAZ = (a.z - other.z) / Math.max(0.01, od);
      if (Math.sin(other.yaw) * toAX + Math.cos(other.yaw) * toAZ > 0.25) {
        witnessed = true;
        break;
      }
    }

    a.dead = true;
    a.hp = 0;
    a.respawnTimer = 18.0;
    const model = a.model;
    if (model) a.root.remove(model);
    a.model = null;
    a.mixer = null;
    a.actions = null;
    a.shadowMeshes = undefined;
    a.root.visible = false;
    this.onPedestrianKilled?.(a, hitPt, model, true);
    if (witnessed) {
      this.alertPanic({ x: a.x, z: a.z }, 16);
    }
    return { agent: a, witnessed, pos: hitPt };
  }

  /** Checks if a gunshot hit a pedestrian near (x, y, z); wounds or kills them with blood & dying collapse */
  hitAtPoint(x: number, y: number, z: number, radius = 0.72, damage = 40): PedestrianAgent | null {
    for (const a of this.agents) {
      if (a.dead) continue;
      if (y < a.y - 0.1 || y > a.y + 1.95) continue;
      const dx = a.x - x;
      const dz = a.z - z;
      if (dx * dx + dz * dz <= radius * radius) {
        const hitPt = new THREE.Vector3(x, y, z);
        a.hp -= damage;
        this.onPedestrianWounded?.(a, hitPt);
        if (a.hp <= 0) {
          this.killPedestrianAgent(a, hitPt);
          this.alertPanic({ x, z }, 26);
        } else {
          a.state = "flee";
          a.stateTimer = 7.0;
          const d = Math.hypot(dx, dz) || 1;
          a.vx = (dx / d) * 4.5;
          a.vz = (dz / d) * 4.5;
          a.targetSpeed = 4.5;
          a.targetYaw = Math.atan2(a.vx, a.vz);
          this.voices.speak(a.roleId, "hit", a.voiceSeed, 6, true);
        }
        return a;
      }
    }
    return null;
  }

  /** Soft-push collision for player on foot + bump voicelines */
  resolvePlayerFootCollision(pos: { x: number; y: number; z: number }, radius = 0.4): SpokenLine | null {
    let spoken: SpokenLine | null = null;
    for (const a of this.agents) {
      if (a.dead || a.state === "knocked") continue;
      if (Math.abs(a.y - pos.y) > 1.8) continue;
      const dx = pos.x - a.x;
      const dz = pos.z - a.z;
      const minD = radius + 0.36;
      const d2 = dx * dx + dz * dz;
      if (d2 >= minD * minD) continue;
      const d = Math.sqrt(d2) || 0.01;
      const nx = dx / d;
      const nz = dz / d;
      const pen = minD - d;
      pos.x += nx * pen * 0.65;
      pos.z += nz * pen * 0.65;
      a.x -= nx * pen * 0.35;
      a.z -= nz * pen * 0.35;
      if (a.speechCd <= 0 && !spoken) {
        a.speechCd = 7.5;
        a.state = "idle";
        a.stateTimer = 1.6;
        a.targetSpeed = 0;
        a.targetYaw = Math.atan2(nx, nz);
        spoken = this.voices.speak(a.roleId, "bump", a.voiceSeed, d, false);
      }
    }
    return spoken;
  }

  /** Used by NPC drivers to yield smoothly when a pedestrian is on/near a roadway ahead */
  isPedestrianAhead(x: number, z: number, fx: number, fz: number, lookDist = 13.5): boolean {
    for (let i = 0; i < this.agents.length; i++) {
      const a = this.agents[i];
      if (a.dead || a.state === "knocked") continue;
      const dx = a.x - x;
      const dz = a.z - z;
      const fwd = dx * fx + dz * fz;
      if (fwd < 0.8 || fwd > lookDist) continue;
      const lat = Math.abs(dx * -fz + dz * fx);
      if (lat < 2.6) {
        if (a.isCrossingRoad) return true;
        const inf = this.roads.getRoadInfluence(a.x, a.z, 12, true);
        if (inf && inf.edgeDist < 0.2) return true;
      }
    }
    return false;
  }

  update(
    dt: number,
    focusPos: { x: number; y: number; z: number },
    vehicles: readonly PedVehicleQuery[] = [],
  ): SpokenLine | null {
    const cdt = Math.min(Math.max(dt, 0), 0.05);
    this.frameTick++;
    let latestLine: SpokenLine | null = null;
    this.ambientVoiceTimer -= cdt;
    let modelRequestsThisFrame = 0;

    for (let i = 0; i < this.agents.length; i++) {
      const a = this.agents[i];
      if (a.speechCd > 0) a.speechCd = Math.max(0, a.speechCd - cdt);
      if (a.weaponPanicCd > 0) a.weaponPanicCd = Math.max(0, a.weaponPanicCd - cdt);

      if (a.dead) {
        a.respawnTimer -= cdt;
        if (a.respawnTimer <= 0 && this.routes.length > 0) {
          // Respawn crowd agent far from focusPos so street population stays lively
          const candIdx = (a.routeIdx + 17 + this.frameTick) % this.routes.length;
          const seg = this.routes[candIdx];
          const rx = (seg.ax + seg.bx) * 0.5;
          const rz = (seg.az + seg.bz) * 0.5;
          if ((rx - focusPos.x) ** 2 + (rz - focusPos.z) ** 2 > 75 * 75) {
            a.dead = false;
            a.hp = 75;
            a.routeIdx = candIdx;
            a.routeT = 0.5;
            a.x = rx;
            a.y = this.terrainAt(rx, rz);
            a.z = rz;
            a.state = "walk";
            a.stateTimer = 8;
            a.witnessSuspicion = 0;
            a.witnessReported = false;
            a.copWarnTimer = 0;
            a.modelRequested = false;
            a.root.position.set(a.x, a.y, a.z);
            a.root.rotation.set(0, a.yaw, 0);
          }
        }
        continue;
      }

      const dFocus2 = (a.x - focusPos.x) * (a.x - focusPos.x) + (a.z - focusPos.z) * (a.z - focusPos.z);
      // Stream far-away calm pedestrians onto sidewalk routes 46-138m around focusPos so neighborhoods stay lively
      if (
        dFocus2 > 165 * 165 &&
        a.state === "walk" &&
        !a.witnessReported &&
        a.witnessSuspicion < 0.05 &&
        this.routes.length > 0 &&
        ((i + this.frameTick) & 7) === 0
      ) {
        for (let tries = 0; tries < 6; tries++) {
          const candIdx = (a.id * 31 + this.frameTick * 7 + tries * 53) % this.routes.length;
          const seg = this.routes[candIdx];
          const mx = (seg.ax + seg.bx) * 0.5;
          const mz = (seg.az + seg.bz) * 0.5;
          const dm2 = (mx - focusPos.x) * (mx - focusPos.x) + (mz - focusPos.z) * (mz - focusPos.z);
          if (dm2 >= 46 * 46 && dm2 <= 138 * 138) {
            a.routeIdx = candIdx;
            a.routeT = 0.2 + ((a.id % 7) * 0.1);
            a.x = seg.ax + (seg.bx - seg.ax) * a.routeT;
            a.z = seg.az + (seg.bz - seg.az) * a.routeT;
            a.y = this.terrainAt(a.x, a.z);
            a.targetYaw = Math.atan2(seg.dirX * a.routeDir, seg.dirZ * a.routeDir);
            a.yaw = a.targetYaw;
            a.isCrossingRoad = !!seg.isCrosswalk;
            a.root.position.set(a.x, a.y, a.z);
            a.root.rotation.set(0, a.yaw, 0);
            break;
          }
        }
      }

      const nearVisual = dFocus2 < 125 * 125;
      if (nearVisual && !a.modelRequested && dFocus2 < 105 * 105 && modelRequestsThisFrame < 2) {
        modelRequestsThisFrame++;
        this.ensureAgentModel(a);
      }
      a.root.visible = nearVisual;
      if (nearVisual && a.shadowMeshes) {
        const wantShadow = dFocus2 < 52 * 52;
        if (a.lastShadowCast !== wantShadow) {
          a.lastShadowCast = wantShadow;
          for (let sm = 0; sm < a.shadowMeshes.length; sm++) {
            a.shadowMeshes[sm].castShadow = wantShadow;
          }
        }
      }

      // Off-screen (>115m) pedestrians step cleanly at 1/4 rate to save CPU & terrain queries
      if (!nearVisual && a.state !== "knocked" && ((i + this.frameTick) & 3) !== 0) {
        continue;
      }
      const stepDt = nearVisual ? cdt : cdt * 4;

      // Handle knocked-down / ragdoll tumble state
      if (a.state === "knocked") {
        a.stateTimer -= cdt;
        a.vy -= 18 * cdt;
        a.x += a.vx * cdt;
        a.y += a.vy * cdt;
        a.z += a.vz * cdt;
        const gy = this.terrainAt(a.x, a.z);
        if (a.y <= gy) {
          a.y = gy;
          a.vy = 0;
          a.vx *= Math.max(0, 1 - cdt * 7);
          a.vz *= Math.max(0, 1 - cdt * 7);
        }
        a.tumblePhase = Math.min(1, a.tumblePhase + cdt * 4.5);
        a.root.position.set(a.x, a.y, a.z);
        a.root.rotation.set(-a.tumblePhase * Math.PI * 0.48, a.yaw, 0);
        if (a.stateTimer <= 0) {
          // Recover back onto nearest sidewalk route
          const seg = this.routes[a.routeIdx];
          a.x = seg.ax + (seg.bx - seg.ax) * 0.5;
          a.z = seg.az + (seg.bz - seg.az) * 0.5;
          a.y = this.terrainAt(a.x, a.z);
          a.vx = a.vy = a.vz = 0;
          a.tumblePhase = 0;
          a.state = "walk";
          a.stateTimer = 8;
          a.root.rotation.set(0, a.yaw, 0);
        }
        continue;
      }

      // Check nearby vehicles for dodges, impacts, and car admiration
      for (let vIdx = 0; vIdx < vehicles.length; vIdx++) {
        const v = vehicles[vIdx];
        const dx = a.x - v.x;
        const dz = a.z - v.z;
        const d2 = dx * dx + dz * dz;
        if (d2 > 144) continue;
        const d = Math.sqrt(d2) || 0.01;
        const hitR = Math.max(v.halfW, 0.9) + 0.45;
        if (d < hitR + 0.35 && Math.abs(a.y - v.y) < 2.2) {
          if (v.speed > 9.5) {
            // High-speed fatal vehicle strike -> blood burst + dying collapse + carryable body
            if (v.isPlayer) this.onPedestrianHitByPlayer?.(a);
            const hitPt = new THREE.Vector3(a.x, a.y + 0.9, a.z);
            this.onPedestrianWounded?.(a, hitPt);
            this.killPedestrianAgent(a, hitPt);
            break;
          } else if (v.speed > 4.2) {
            // Vehicle hits pedestrian -> dramatic knockback + scream
            a.state = "knocked";
            a.stateTimer = 5.0;
            a.tumblePhase = 0;
            const pushX = dx / d;
            const pushZ = dz / d;
            a.vx = v.vx * 0.65 + pushX * 4.5;
            a.vz = v.vz * 0.65 + pushZ * 4.5;
            a.vy = Math.min(6.2, 2.5 + v.speed * 0.25);
            if (v.isPlayer) this.onPedestrianHitByPlayer?.(a);
            if (!latestLine && dFocus2 < 36 * 36) {
              latestLine = this.voices.speak(a.roleId, "hit", a.voiceSeed, Math.sqrt(dFocus2), true);
            }
            break;
          } else {
            // Low speed nudge
            a.x += (dx / d) * (hitR + 0.4 - d);
            a.z += (dz / d) * (hitR + 0.4 - d);
          }
        } else if (v.speed > 7.5 && d < 8.5) {
          // Check if vehicle velocity vector is aimed toward pedestrian
          const approach = (dx * v.vx + dz * v.vz) / (d * v.speed);
          if (approach > 0.65 && a.state !== "flee") {
            a.state = "flee";
            a.stateTimer = 2.6;
            // Dodge perpendicular to car velocity
            const perpX = -v.vz / v.speed;
            const perpZ = v.vx / v.speed;
            const sideSign = dx * perpX + dz * perpZ >= 0 ? 1 : -1;
            a.vx = perpX * sideSign * 3.8;
            a.vz = perpZ * sideSign * 3.8;
            a.targetSpeed = 3.8;
            a.targetYaw = Math.atan2(a.vx, a.vz);
            if (!latestLine && a.speechCd <= 0 && dFocus2 < 30 * 30) {
              a.speechCd = 7;
              latestLine = this.voices.speak(a.roleId, "near_miss", a.voiceSeed, Math.sqrt(dFocus2), true);
            }
          }
        } else if (v.isPlayer && v.speed > 0.5 && v.speed < 7.0 && d < 7.5 && a.speechCd <= 0 && dFocus2 < 16 * 16) {
          if (Math.random() < 0.012) {
            a.speechCd = 14;
            latestLine = this.voices.speak(a.roleId, "car_admire", a.voiceSeed, Math.sqrt(dFocus2), false);
          }
        }
      }
      if (a.state === "knocked") continue;

      // Ambient street chatter near the player
      if (!latestLine && this.ambientVoiceTimer <= 0 && dFocus2 < 14 * 14 && a.speechCd <= 0 && a.state !== "flee") {
        this.ambientVoiceTimer = 8.5;
        a.speechCd = 16;
        const cat = a.roleId === "police" ? "cop" : "ambient";
        latestLine = this.voices.speak(a.roleId, cat, a.voiceSeed, Math.sqrt(dFocus2), false);
      }

      // Locomotion state machine with damped velocity & yaw transitions
      if (a.state === "flee") {
        a.stateTimer -= stepDt;
        a.targetSpeed = Math.hypot(a.vx, a.vz) || 3.8;
        a.speed = damp(a.speed, a.targetSpeed, 10, stepDt);
        a.targetYaw = Math.atan2(a.vx, a.vz);
        a.yaw = dampAngle(a.yaw, a.targetYaw, 11, stepDt);
        const dirLen = Math.hypot(a.vx, a.vz) || 1;
        a.x += (a.vx / dirLen) * a.speed * stepDt;
        a.z += (a.vz / dirLen) * a.speed * stepDt;
        a.y = this.terrainAt(a.x, a.z);
        if (a.stateTimer <= 0) {
          a.state = "walk";
          a.stateTimer = 8;
          a.targetSpeed = a.baseSpeed;
        }
      } else if (a.state === "idle") {
        a.stateTimer -= stepDt;
        a.targetSpeed = 0;
        a.speed = damp(a.speed, 0, 7.5, stepDt);
        a.yaw = dampAngle(a.yaw, a.targetYaw, 8.2, stepDt);
        if (a.stateTimer <= 0) {
          a.state = "walk";
          a.stateTimer = 8 + (a.voiceSeed * 12) % 10;
          a.targetSpeed = a.baseSpeed;
        }
      } else {
        const seg = this.routes[a.routeIdx];
        // Crosswalk signal compliance: wait at curb before entering crosswalk on Don't Walk
        if (seg.isCrosswalk && seg.signalNodeId && this.signals) {
          const nearCurb = a.routeDir === 1 ? a.routeT < 0.14 : a.routeT > 0.86;
          if (nearCurb && !this.signals.canPedestrianCross(seg.signalNodeId, seg.dirX, seg.dirZ)) {
            a.state = "wait_signal";
            a.targetSpeed = 0;
          } else {
            a.state = "walk";
          }
        }

        if (a.state === "wait_signal") {
          a.targetSpeed = 0;
          a.speed = damp(a.speed, 0, 8.0, stepDt);
          a.yaw = dampAngle(a.yaw, a.targetYaw, 8.2, stepDt);
        } else if (a.state === "walk") {
          a.stateTimer -= stepDt;
          if (!seg.isCrosswalk && a.stateTimer <= 0) {
            a.state = "idle";
            a.stateTimer = 2.0 + (a.voiceSeed * 3.5) % 3.0;
            a.targetSpeed = 0;
          } else {
            a.targetSpeed = seg.isCrosswalk ? Math.max(a.baseSpeed, 1.85) : a.baseSpeed;
            a.speed = damp(a.speed, a.targetSpeed, 6.8, stepDt);
            a.routeT += (a.routeDir * a.speed * stepDt) / Math.max(1, seg.len);
            if (a.routeT >= 1 || a.routeT <= 0) {
              a.routeT = Math.max(0, Math.min(1, a.routeT));
              this.pickNextRoute(a);
            }
            const curSeg = this.routes[a.routeIdx];
            a.x = curSeg.ax + (curSeg.bx - curSeg.ax) * a.routeT;
            a.z = curSeg.az + (curSeg.bz - curSeg.az) * a.routeT;
            a.y = nearVisual ? this.terrainAt(a.x, a.z) : curSeg.ay + (curSeg.by - curSeg.ay) * a.routeT;
            a.targetYaw = Math.atan2(curSeg.dirX * a.routeDir, curSeg.dirZ * a.routeDir);
            a.yaw = dampAngle(a.yaw, a.targetYaw, 8.2, stepDt);
          }
        }
      }

      if (!nearVisual) continue;

      const desiredClip: "idle" | "walk" | "run" =
        a.speed < 0.28 ? "idle" : a.speed >= 2.25 ? "run" : "walk";

      // Subtle natural corner lean + forward stride posture
      const yawErr = Math.atan2(Math.sin(a.targetYaw - a.yaw), Math.cos(a.targetYaw - a.yaw));
      const bankRoll = clamp(-yawErr * 0.09, -0.055, 0.055) * Math.min(1, a.speed / 2.0);
      const strideLean = a.speed > 2.2 ? 0.045 : a.speed > 0.35 ? 0.015 : 0;
      a.root.position.set(a.x, a.y, a.z);
      a.root.rotation.set(strideLean, a.yaw, bankRoll);

      if (a.mixer) {
        const dFocus2Anim = (a.x - focusPos.x) * (a.x - focusPos.x) + (a.z - focusPos.z) * (a.z - focusPos.z);
        if (dFocus2Anim < 45 * 45) {
          this.setAgentClip(a, desiredClip, cdt);
          a.mixer.update(cdt);
          if (a.headBone && a.speed < 0.45) {
            const hn = samplePedestrianHeadNoise(this.frameTick * 0.016, a.voiceSeed * 37.1 + a.id * 3.7);
            a.headBone.rotateY(hn.yaw);
            a.headBone.rotateX(hn.pitch);
          }
        } else if (((i + this.frameTick) & 1) === 0) {
          this.setAgentClip(a, desiredClip, cdt * 2);
          a.mixer.update(cdt * 2);
        }
      }
    }

    return latestLine;
  }

  /**
   * Evaluates NPC panic when walking around with an unhidden/drawn weapon,
   * and witness detection + oncoming-NPC stealth directional indicators when carrying a dead body.
   */
  updatePlayerAwareness(dt: number, ctx: PedPlayerContext): void {
    const cdt = Math.min(Math.max(dt, 0), 0.05);
    this.bodyWitnessIndicators.length = 0;

    const camFwdX = Math.sin(ctx.yaw);
    const camFwdZ = Math.cos(ctx.yaw);
    const camRgtX = -Math.cos(ctx.yaw);
    const camRgtZ = Math.sin(ctx.yaw);

    for (let i = 0; i < this.agents.length; i++) {
      const a = this.agents[i];
      if (a.dead || a.state === "knocked") continue;

      const dx = a.x - ctx.x;
      const dz = a.z - ctx.z;
      const dy = Math.abs(a.y - ctx.y);
      if (dy > 3.2) {
        a.witnessSuspicion = Math.max(0, a.witnessSuspicion - cdt * 0.6);
        continue;
      }
      const dist = Math.hypot(dx, dz);

      // 1. Unhidden weapon panic & scream
      if (ctx.weaponDrawn && !ctx.carryingBody && dist < (ctx.ads ? 22 : 16)) {
        const toPlayerX = -dx / (dist || 1);
        const toPlayerZ = -dz / (dist || 1);
        const npcFwdX = Math.sin(a.yaw);
        const npcFwdZ = Math.cos(a.yaw);
        const facingDot = npcFwdX * toPlayerX + npcFwdZ * toPlayerZ;
        const canNotice = dist < 9.5 || facingDot > 0.1 || ctx.ads;

        if (canNotice) {
          const isAuthority = a.roleId === "police" || a.roleId === "security";
          if (isAuthority) {
            a.state = "idle";
            a.stateTimer = 2.0;
            a.targetYaw = Math.atan2(toPlayerX, toPlayerZ);
            a.copWarnTimer += cdt * (ctx.ads ? 1.8 : 1.0);
            if (a.speechCd <= 0) {
              a.speechCd = 4.5;
              this.voices.speak(a.roleId, "cop", a.voiceSeed, dist, true);
            }
            if (a.copWarnTimer >= 1.9) {
              a.copWarnTimer = 0;
              this.onWeaponBrandishedAtCop?.(a);
            }
          } else {
            const awayX = dx / (dist || 1);
            const awayZ = dz / (dist || 1);
            a.state = "flee";
            a.stateTimer = 5.5;
            a.vx = awayX * 4.7;
            a.vz = awayZ * 4.7;
            a.targetSpeed = 4.7;
            a.targetYaw = Math.atan2(awayX, awayZ);
            if (a.weaponPanicCd <= 0) {
              a.weaponPanicCd = 7.5;
              a.speechCd = 5.5;
              this.voices.speak(a.roleId, "weapon_panic", a.voiceSeed, dist, true);
            }
          }
        }
      } else {
        a.copWarnTimer = Math.max(0, a.copWarnTimer - cdt * 0.8);
      }

      // 2. Dead-body carry detection & oncoming-NPC stealth indicator
      if (ctx.carryingBody && dist < 34) {
        const toPlayerX = -dx / (dist || 1);
        const toPlayerZ = -dz / (dist || 1);
        const npcFwdX = Math.sin(a.yaw);
        const npcFwdZ = Math.cos(a.yaw);
        const facingDot = npcFwdX * toPlayerX + npcFwdZ * toPlayerZ;

        // NPC is oncoming/looking toward the player, or close enough to hear/spot
        const oncoming = facingDot > 0.05;
        const seeing = (facingDot > 0.25 && dist < 26) || dist < 6.5;

        if (seeing && !a.witnessReported) {
          const distFactor = clamp(1 - dist / 28, 0.15, 1.45);
          const angleFactor = facingDot > 0.6 ? 1.25 : facingDot > 0.2 ? 0.85 : 0.65;
          const crouchMult = ctx.crouching ? 0.62 : 1.0;
          const roleMult = a.roleId === "police" || a.roleId === "security" ? 1.55 : 1.0;
          a.witnessSuspicion = clamp(
            a.witnessSuspicion + cdt * 0.55 * distFactor * angleFactor * crouchMult * roleMult,
            0,
            1,
          );
          if (a.witnessSuspicion >= 1.0) {
            a.witnessReported = true;
            const awayX = dx / (dist || 1);
            const awayZ = dz / (dist || 1);
            a.state = "flee";
            a.stateTimer = 7.5;
            a.vx = awayX * 4.8;
            a.vz = awayZ * 4.8;
            a.targetSpeed = 4.8;
            a.targetYaw = Math.atan2(awayX, awayZ);
            this.voices.speak(a.roleId, "body_witness", a.voiceSeed, dist, true);
            this.onBodyWitnessed?.(a);
          }
        } else if (!seeing) {
          a.witnessSuspicion = Math.max(0, a.witnessSuspicion - cdt * 0.22);
        }

        // Feed stealth-style radial indicator for oncoming/watching/noticing NPCs
        if (oncoming || seeing || a.witnessSuspicion > 0.06 || dist < 14) {
          const dotFwd = dx * camFwdX + dz * camFwdZ;
          const dotRgt = dx * camRgtX + dz * camRgtZ;
          const proximityFloor = oncoming ? clamp((1 - dist / 34) * 0.42, 0.12, 0.42) : 0.08;
          const susp = a.witnessReported ? 1 : Math.max(proximityFloor, a.witnessSuspicion);
          this.bodyWitnessIndicators.push({
            id: 1000 + a.id,
            angle: Math.atan2(dotRgt, dotFwd),
            suspicion: susp,
            state: a.witnessReported ? "attack" : a.witnessSuspicion >= 0.35 ? "alert" : "patrol",
            seeing,
          });
        }
      } else {
        a.witnessSuspicion = Math.max(0, a.witnessSuspicion - cdt * 0.45);
        if (!ctx.carryingBody) a.witnessReported = false;
      }
    }

    if (this.bodyWitnessIndicators.length > 5) {
      this.bodyWitnessIndicators.sort((x, y) => y.suspicion - x.suspicion);
      this.bodyWitnessIndicators.length = 5;
    }
  }
}
