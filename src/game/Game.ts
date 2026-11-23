import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { SoldierRig, MAG_SIZE, type RigStatus } from "../character/SoldierRig";
import { WEAPONS } from "../character/rifle";
import { type World, type SurfaceKind } from "./world";
import { buildLevel, type LevelResult } from "./levels";
import { CombatFX, Sfx } from "./fx";
import { CinematicPostShader } from "./shaders";
import { Spring, clamp, damp, lerp } from "../character/math";
import { Ally, Enemy, Fighter, RescueNPC, resolveCircleAABBs, type CombatHost } from "./Enemy";
import { MISSIONS, type DialogueLine, type MissionDef, type ObjectiveDef } from "./story";
import { createInteractableProp, type InteractableInstance } from "./interactables";
import {
  awardMissionReward,
  getPlayerStats,
  loadSave,
  SAVE_KEY,
  type MissionReward,
  type PlayerStats,
  type SoldierAppearance,
} from "./progression";
export { loadSave, SAVE_KEY };

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
  timeScale: number;
  weaponIndex: number;
  weaponName: string;
  weaponCategory: string;
  zoomFactor: number;
  suppressed: boolean;
  stealthState: "hidden" | "caution" | "compromised";
  suspicion: number;
  stealthKills: number;
  alerts: number;
  takedownReady: boolean;
  interact: { label: string; kind: string; progress: number; holding: boolean } | null;
  extractReady: boolean;
  extractDist: number | null;
  extractDirAngle: number | null;
  weapons: { slot: number; shortName: string; category: string; mag: number; reserve: number }[];
}

export type Trigger = "reload" | "jump" | "hit" | "dieBack" | "dieFront" | "respawn" | "showcase";
export type Held = "fire" | "ads" | "sprint" | "crouch";

export interface GameCallbacks {
  onHud: (s: HudState) => void;
  onMissionEnd: (mission: MissionDef, success: boolean, reward?: MissionReward) => void;
}

function disposeObject(obj: THREE.Object3D) {
  obj.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.geometry) m.geometry.dispose();
    const mats = Array.isArray(m.material) ? m.material : m.material ? [m.material] : [];
    for (const mat of mats) {
      const t = mat as THREE.Material & { map?: THREE.Texture; emissiveMap?: THREE.Texture; bumpMap?: THREE.Texture };
      t.map?.dispose();
      t.emissiveMap?.dispose();
      t.bumpMap?.dispose();
      mat.dispose();
    }
  });
}

export class Game {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(62, 1, 0.05, 400);
  world!: World;
  level: LevelResult | null = null;
  rig!: SoldierRig;
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
  private hitMarker = 0;
  private spread = 0;
  private health = 100;
  private maxHealth = 100;
  private stats: PlayerStats = getPlayerStats();
  private menuHangar = false;
  private menuYaw = 0.25;
  private timeScale = 1;
  private pivotY = 1.5;
  private raycaster = new THREE.Raycaster();
  private disposed = false;
  private ro?: ResizeObserver;
  private cleanup: (() => void)[] = [];
  private lockFailed = false;
  private zoomDist = 2.7;
  private weaponIdx = 0;
  private weaponAmmo = WEAPONS.map((w) => ({ mag: w.magSize, reserve: w.reserveMax, adsFov: w.adsFovDefault }));
  private adsFovSmooth = WEAPONS[0].adsFovDefault;
  private composer: EffectComposer;
  private bloomPass: UnrealBloomPass;
  private gradePass: ShaderPass;
  private hangarEnv: THREE.Texture | null = null;
  private guardFlashlights: THREE.SpotLight[] = [];
  private tmpFlashOrigin = new THREE.Vector3();
  private tmpFlashTarget = new THREE.Vector3();
  private postTime = 0;

  /* mission state */
  private cb: GameCallbacks | null = null;
  private mission: MissionDef | null = null;
  private missionRoot = new THREE.Group();
  private enemies: Enemy[] = [];
  private enemyHits: THREE.Object3D[] = [];
  private ally: Ally | null = null;
  private npc: RescueNPC | null = null;
  private objectives: ObjectiveState[] = [];
  private dialogueQueue: DialogueLine[] = [];
  private dialogue: DialogueLine | null = null;
  private dialogueT = 0;
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

  constructor(
    private container: HTMLElement,
    private onHud: (s: HudState) => void,
  ) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance", preserveDrawingBuffer: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.domElement.style.display = "block";
    this.renderer.domElement.tabIndex = 0;
    container.appendChild(this.renderer.domElement);

    const w0 = container.clientWidth || window.innerWidth;
    const h0 = container.clientHeight || window.innerHeight;
    const rt = new THREE.WebGLRenderTarget(w0, h0, {
      type: THREE.HalfFloatType,
      samples: this.renderer.capabilities.isWebGL2 ? 2 : 0,
    });
    this.composer = new EffectComposer(this.renderer, rt);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloomPass = new UnrealBloomPass(new THREE.Vector2(w0, h0), 0.34, 0.55, 0.86);
    this.composer.addPass(this.bloomPass);
    this.gradePass = new ShaderPass(CinematicPostShader);
    this.composer.addPass(this.gradePass);
    this.composer.addPass(new OutputPass());

    this.camera.position.set(0.6, 1.8, -3);
    this.scene.add(this.missionRoot);
    this.scene.add(this.fx.group);
    this.bind();
    this.resize();
    this.emitHud();
    (window as unknown as { __game: Game }).__game = this;
    void this.enterMenuHangar();
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
    this.scene.environmentIntensity = 0.72;

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

    // 3-point tactical studio lighting (with bright front-key fill so dark/metallic armors read crisply)
    const hemi = new THREE.HemisphereLight(0xaac8e8, 0x1e2530, 1.35);
    const key = new THREE.DirectionalLight(0xfff1dc, 2.5);
    key.position.set(2.4, 4.2, 4.0);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    const rim = new THREE.DirectionalLight(0xf59e0b, 1.9);
    rim.position.set(-2.8, 3.0, -2.5);
    const fill = new THREE.DirectionalLight(0x93c5fd, 1.45);
    fill.position.set(-1.6, 1.8, 3.6);
    this.missionRoot.add(hemi, key, rim, fill);

    if (!this.rig) {
      this.rig = await SoldierRig.load(this.scene, (p) => {
        this.progress = Math.round(p * 100);
        this.emitHud();
      });
      if (this.disposed) return;
      this.rig.initArsenal();
      this.rig.rifle.muzzle.add(this.fx.flash);
      this.attachRigEvents();
    }
    if (!this.menuHangar || this.disposed) return;

    const save = loadSave();
    this.stats = getPlayerStats(save);
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
    this.rig.equipWeapon(spec, spec.magSize, spec.reserveMax, this.fx.flash);
    this.rig.setAppearance(save.appearance);
    this.rig.aimPoint.set(Math.sin(this.menuYaw) * 10, 1.32, Math.cos(this.menuYaw) * 10);
    for (let i = 0; i < 20; i++) this.rig.update(0.05, 0.1);

    this.emitHud();
    this.startLoop();
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

  previewAppearance(app: SoldierAppearance) {
    if (!this.rig) return;
    this.rig.setAppearance(app);
  }

  refreshStats() {
    this.stats = getPlayerStats();
  }

  private attachRigEvents() {
    this.rig.events = {
      onShot: (m, kick) => this.onShot(m, kick),
      onEject: (p, d) => this.fx.casing(p, d),
      onDry: () => this.sfx.dry(),
      onFootstep: (_s, i) => {
        this.sfx.step(i);
        if (this.phase === "ready" && !this.rig.dead) {
          const crouching = this.crouchToggle;
          if (!crouching) {
            const baseR = this.rig.status === "Sprinting" ? 11.5 : 4.2;
            const radius = baseR * this.stats.footstepNoiseMult;
            if (radius > 0.4) {
              const p = this.rig.root.position;
              for (const e of this.enemies) {
                if (e.isDead) continue;
                const d = Math.hypot(e.rig.root.position.x - p.x, e.rig.root.position.z - p.z);
                if (d <= radius) e.alertFrom(p, 0.25 + (d / radius) * 0.35, this.rig.status === "Sprinting" ? 0.55 : 0.44);
              }
            }
          }
        }
      },
      onReloadEvent: (k) => {
        if (k === "magout") this.sfx.magOut();
        else if (k === "magin") this.sfx.magIn();
        else if (k === "bolt") this.sfx.bolt();
        else if (k === "drop") this.sfx.magDrop();
      },
      onLand: (i) => this.sfx.land(i),
      onHit: () => this.sfx.hit(),
      onDeath: () => this.sfx.fall(),
    };
  }

  /* ------------------------------------------------------------ */
  async startMission(id: number, cb: GameCallbacks) {
    this.menuHangar = false;
    this.camera.rotation.set(0, 0, 0);
    this.camera.fov = 62;
    this.camera.updateProjectionMatrix();
    this.cb = cb;
    this.phase = "loading";
    this.stats = getPlayerStats();
    this.maxHealth = this.stats.maxHp;
    this.emitHud();
    const mission = MISSIONS.find((m) => m.id === id) ?? MISSIONS[0];
    this.mission = mission;

    // reset mission state
    this.firstContact = false;
    this.killed = 0;
    this.stealthKills = 0;
    this.alerts = 0;
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
    this.interactables = [];
    this.activeInteract = null;
    this.interactHoldT = 0;
    this.interactTickCd = 0;
    this.dialogueQueue = [];
    this.dialogue = null;
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
    if (this.missionRoot.children.length > 0) {
      this.scene.remove(this.missionRoot);
      disposeObject(this.missionRoot);
      this.missionRoot = new THREE.Group();
      this.scene.add(this.missionRoot);
    }

    // build the world
    this.level = buildLevel(mission.id, this.missionRoot, this.scene, this.renderer);
    this.world = this.level;

    // player rig (loaded once, reused across missions)
    if (!this.rig) {
      this.rig = await SoldierRig.load(this.scene, (p) => {
        this.progress = Math.round(p * 100);
        this.emitHud();
      });
      if (this.disposed) return;
      this.rig.initArsenal();
      this.rig.rifle.muzzle.add(this.fx.flash);
      this.attachRigEvents();
    }
    const sp = mission.spawn;
    this.rig.respawn(new THREE.Vector3(sp[0], 0, sp[1]));
    this.rig.setAppearance(loadSave().appearance);
    this.rig.crouchSpeedMult = this.stats.crouchSpeedMult;
    this.rig.aimYaw = THREE.MathUtils.degToRad(sp[2]);
    this.yaw = this.camYaw = this.rig.aimYaw;
    this.pitch = this.camPitch = 0.05;
    this.maxHealth = this.stats.maxHp;
    this.health = this.maxHealth;
    this.showcase = false;
    this.crouchToggle = false;
    this.resetWeapons();

    // objectives
    this.objectives = mission.objectives.map((o: ObjectiveDef) => ({
      id: o.id,
      label: o.label,
      done: mission.practice === true,
      progress: mission.practice === true ? o.count ?? 1 : 0,
      total: o.count ?? (o.kind === "reach" || o.kind === "rescue" ? 1 : 0),
    }));
    if (mission.practice) this.objectives.forEach((o) => (o.done = true));

    // combat host
    const host: CombatHost = {
      colliders: this.level.colliders,
      aabbs: this.level.aabbs,
      groundHeightAt: (x, z, y) => (this.level ? this.level.groundHeightAt(x, z, y) : 0),
      fx: this.fx,
      sfx: this.sfx,
      playerPos: (out: THREE.Vector3) => {
        const r = this.rig.root.position;
        return out.set(r.x, r.y + this.rig.eyeHeight, r.z);
      },
      playerAlive: () => !this.rig.dead,
      playerCrouching: () => this.crouchToggle,
      playerSprinting: () => this.rig?.status === "Sprinting",
      playerDetectMult: () => this.stats.enemyDetectSpeedMult,
      playerVisionRangeMult: () => this.stats.enemyVisionRangeMult,
      onPlayerHit: (dmg) => this.damage(dmg, Math.random() * Math.PI * 2),
      onKilled: (e, stealth) => this.onEnemyKilled(e, stealth),
      onAlert: () => this.onFirstContact(),
      enemies: () => this.enemies,
      mission,
    };

    // spawn enemies (sequential loads; progress shown via loading phase)
    const totalEnemies = mission.enemies.length + (mission.ally ? 1 : 0) + (mission.rescue ? 1 : 0);
    let built = 0;
    for (const spawn of mission.enemies) {
      const e = new Enemy(host, spawn, mission);
      await e.build(this.missionRoot, mission.tint, 0.95 + Math.random() * 0.12);
      this.enemyHits.push(e.hitbox);
      if (e.boss) this.bossEntity = e;
      this.enemies.push(e);
      built++;
      this.progress = Math.round((built / totalEnemies) * 100);
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
      this.missionRoot.add(inst.group);
      this.interactables.push(inst);
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

    this.phase = "ready";
    this.queueDialogue(mission.intro);
    this.emitHud();
    (window as unknown as { __game: Game }).__game = this;
    this.startLoop();
  }

  private startLoop() {
    if (this.raf) return;
    this.last = performance.now();
    const loop = (t: number) => {
      this.raf = requestAnimationFrame(loop);
      const dt = Math.min(0.05, (t - this.last) / 1000);
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
      if (["Space", "Tab"].includes(e.code)) e.preventDefault();
      if (e.repeat) return;
      this.keys.add(e.code);
      switch (e.code) {
        case "Space":
          this.trigger("jump");
          break;
        case "KeyR":
          this.trigger("reload");
          break;
        case "KeyC":
          this.crouchToggle = !this.crouchToggle;
          break;
        case "KeyV":
          this.tryTakedown();
          break;
        case "Tab":
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
        case "Escape":
          if (this.phase === "ready" || this.phase === "dead") this.paused = !this.paused;
          break;
      }
    });
    on(window, "keyup", (e: KeyboardEvent) => this.keys.delete(e.code));
    on(window, "blur", () => this.keys.clear());
    on(el, "contextmenu", (e: Event) => e.preventDefault());
    on(el, "mousedown", (e: MouseEvent) => {
      this.sfx.init();
      if (e.button === 0) {
        this.mouseL = true;
        if (!this.locked && !this.lockFailed) this.requestLock();
      }
      if (e.button === 2) this.mouseR = true;
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
      if (!this.locked && !drag) return;
      const fovScale = clamp(this.camera.fov / 62, 0.2, 1.0);
      const s = 0.0022 * fovScale;
      this.camYaw -= e.movementX * s;
      this.camPitch = clamp(this.camPitch - e.movementY * s, -1.2, 1.25);
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
        if (this.phase !== "ready" || this.paused) return;
        e.preventDefault();
        if (this.mouseR || this.uiHeld.ads) {
          const w = WEAPONS[this.weaponIdx];
          const st = this.weaponAmmo[this.weaponIdx];
          // scroll up (deltaY < 0) zooms IN (smaller FOV), scroll down zooms OUT
          const delta = Math.sign(e.deltaY) * Math.max(2.5, Math.min(8, Math.abs(e.deltaY) * 0.04));
          st.adsFov = clamp(st.adsFov + delta, w.adsFovMin, w.adsFovMax);
          this.emitHud();
        }
      },
      { passive: false },
    );
    on(document, "pointerlockchange", () => {
      this.locked = document.pointerLockElement === el;
      this.emitHud();
    });
    on(document, "pointerlockerror", () => {
      this.lockFailed = true;
      this.emitHud();
    });
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(this.container);
  }

  private requestLock() {
    try {
      const p = this.renderer.domElement.requestPointerLock() as unknown as Promise<void> | undefined;
      p?.catch?.(() => (this.lockFailed = true));
    } catch {
      this.lockFailed = true;
    }
  }

  private resize() {
    const w = this.container.clientWidth || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.renderer.domElement.style.width = "100%";
    this.renderer.domElement.style.height = "100%";
    this.composer?.setSize(w, h);
    this.bloomPass?.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
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
    if (v && document.pointerLockElement) document.exitPointerLock();
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
    if (this.rig.dead || this.phase !== "ready") return;
    const scaled = n * this.stats.damageTakenMult;
    this.health = Math.max(0, this.health - scaled);
    this.rig.hit(angle);
    this.shakeX.kick((Math.random() - 0.5) * 8);
    this.shakeY.kick(-5);
    if (this.health <= 0) {
      this.rig.die(Math.abs(angle) < Math.PI / 2 ? "back" : "front");
      this.phase = "dead";
      this.dialogueQueue = [];
      this.dialogue = null;
      if (document.pointerLockElement) document.exitPointerLock();
      this.emitHud();
      // practice range: free respawn
      if (this.mission?.practice) {
        this.practiceRespawnT = 1.2;
      } else {
        const { reward } = awardMissionReward(this.mission!.id, this.killed, this.stealthKills, this.alerts, false);
        this.cb?.onMissionEnd(this.mission!, false, reward);
      }
    }
  }

  /** story missions: full rebuild; practice: quick reset */
  respawn() {
    if (!this.mission) return;
    this.stats = getPlayerStats();
    this.maxHealth = this.stats.maxHp;
    if (this.mission.practice) {
      this.health = this.maxHealth;
      const sp = this.mission.spawn;
      this.rig.respawn(new THREE.Vector3(sp[0], 0, sp[1]));
      this.rig.setAppearance(loadSave().appearance);
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
    void this.enterMenuHangar();
  }

  /* ------------------------------------------------------------ */
  private onFirstContact() {
    this.alerts++;
    if (this.firstContact || !this.mission) return;
    this.firstContact = true;
    if (this.mission.onFirstContact) this.queueDialogue(this.mission.onFirstContact);
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
    // halfway line
    const eliminateTotal = this.mission!.enemies.filter((s) => !s.boss).length;
    if (!this.halfwayPlayed && eliminateTotal > 0 && this.killed >= Math.ceil(eliminateTotal / 2)) {
      this.halfwayPlayed = true;
      if (this.mission!.onHalfway) this.queueDialogue(this.mission!.onHalfway);
    }
    // objective dialogue once all non-extract objectives are complete
    if (!this.objectiveDialoguePlayed && this.mission!.onObjective) {
      const allNonExtract = this.objectives.filter((o) => o.id !== "extract").every((o) => o.done);
      if (allNonExtract) {
        this.objectiveDialoguePlayed = true;
        this.queueDialogue(this.mission!.onObjective);
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

  private nextDialogue() {
    const line = this.dialogueQueue.shift();
    this.dialogue = line ?? null;
    this.dialogueT = line ? line.dur ?? clamp(line.text.length / 38, 2.5, 6.5) : 0;
    this.emitHud();
  }

  private updateObjectives() {
    if (!this.mission) return;
    const eliminateTotal = this.mission.enemies.filter((e) => !e.boss).length;
    for (const o of this.objectives) {
      if (o.done) continue;
      const def = this.mission.objectives.find((x) => x.id === o.id);
      const kind = def?.kind;
      if (kind === "eliminate") {
        o.progress = Math.min(eliminateTotal, this.killed - (this.bossKilled ? 1 : 0));
        if (o.total > 0 && o.progress >= o.total) o.done = true;
      } else if (kind === "boss") {
        o.progress = this.bossKilled ? 1 : 0;
        if (o.total > 0 && o.progress >= o.total) o.done = true;
      } else if (kind === "destroy") {
        o.progress = this.destroyed;
        if (o.total > 0 && o.progress >= o.total) o.done = true;
      } else if (kind === "rescue") {
        o.progress = this.rescued ? 1 : 0;
        if (o.progress >= o.total) o.done = true;
      } else if (kind === "interact") {
        o.progress = this.interactables.filter((x) => x.def.objId === o.id && x.done).length;
        if (o.total > 0 && o.progress >= o.total) o.done = true;
      }
      // kind "reach" handled by proximity checks in frame
    }
  }

  private checkAllNonExtractDone() {
    if (!this.objectiveDialoguePlayed && this.mission?.onObjective) {
      const allNonExtract = this.objectives.filter((o) => o.id !== "extract").every((o) => o.done);
      if (allNonExtract) {
        this.objectiveDialoguePlayed = true;
        this.queueDialogue(this.mission.onObjective);
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
    const p = this.rig.root.position;
    for (const o of this.objectives) {
      if (o.done) continue;
      const def = this.mission.objectives.find((x) => x.id === o.id);
      if (!def || def.kind !== "reach" || !def.at) continue;
      const d = Math.hypot(p.x - def.at[0], p.z - def.at[1]);
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
          if (this.mission.onObjective) this.queueDialogue(this.mission.onObjective);
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
        if (!this.objectiveDialoguePlayed && this.mission.onObjective) {
          const allNonExtract = this.objectives.filter((o) => o.id !== "extract").every((o) => o.done);
          if (allNonExtract || this.mission.id === 1) {
            this.objectiveDialoguePlayed = true;
            this.queueDialogue(this.mission.onObjective);
          }
        }
        this.emitHud();
      }
    }
    // extract ring fade in/out + vertical exfil beam
    if (this.extractRing) {
      const ex = this.mission.extraction;
      const d = Math.hypot(p.x - ex[0], p.z - ex[1]);
      const mat = this.extractRing.material as THREE.MeshBasicMaterial;
      const allDone = this.objectives.filter((o) => o.id !== "extract").every((o) => o.done);
      mat.opacity = 0.35 + Math.max(0, 0.25 - d / 20) + (allDone ? 0.25 : 0);
      mat.color.setHex(allDone ? 0x34d399 : 0xffcc44);
      if (this.extractBeacon) {
        this.extractBeacon.visible = allDone;
        if (allDone) {
          (this.extractBeacon.material as THREE.MeshBasicMaterial).opacity = 0.14 + Math.sin(this.postTime * 3.5) * 0.05;
        }
      }
    }
    if (this.rescueBeacon) {
      this.rescueBeacon.rotation.y += dt * 1.5;
      this.rescueBeacon.visible = !this.rescued;
    }
  }

  private completeMission() {
    if (!this.mission || this.phase === "complete") return;
    this.phase = "complete";
    const { reward } = awardMissionReward(this.mission.id, this.killed, this.stealthKills, this.alerts, true);
    if (this.mission.onExtraction) this.queueDialogue(this.mission.onExtraction);
    this.emitHud();
    setTimeout(() => {
      this.cb?.onMissionEnd(this.mission!, true, reward);
    }, 1800);
  }

  private resetWeapons() {
    const mm = this.stats.magMult;
    this.weaponAmmo = WEAPONS.map((w) => ({
      mag: Math.round(w.magSize * mm),
      reserve: Math.round(w.reserveMax * mm),
      adsFov: w.adsFovDefault,
    }));
    const startIdx = clamp(loadSave().selectedWeapon, 0, WEAPONS.length - 1);
    this.weaponIdx = startIdx;
    this.adsFovSmooth = WEAPONS[startIdx].adsFovDefault;
    if (this.rig) {
      const spec = WEAPONS[startIdx];
      const st = this.weaponAmmo[startIdx];
      this.rig.equipWeapon(spec, st.mag, st.reserve, this.fx.flash, {
        magSize: Math.round(spec.magSize * mm),
        rpmMult: this.stats.rpmMult,
        recoilMult: this.stats.recoilMult,
      });
    }
  }

  selectWeapon(idx: number) {
    if (!this.rig || this.rig.dead || this.phase !== "ready") return;
    const nextIdx = ((idx % WEAPONS.length) + WEAPONS.length) % WEAPONS.length;
    if (nextIdx === this.weaponIdx) return;
    // Save current weapon mag & reserve before swapping
    this.weaponAmmo[this.weaponIdx].mag = this.rig.mag;
    this.weaponAmmo[this.weaponIdx].reserve = this.rig.reserve;
    this.weaponIdx = nextIdx;
    const spec = WEAPONS[nextIdx];
    const st = this.weaponAmmo[nextIdx];
    this.rig.equipWeapon(spec, st.mag, st.reserve, this.fx.flash, {
      magSize: Math.round(spec.magSize * this.stats.magMult),
      rpmMult: this.stats.rpmMult,
      recoilMult: this.stats.recoilMult,
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
      const d = p.distanceTo(e.rig.root.position);
      if (d < bestD) {
        bestD = d;
        best = e;
      }
    }
    return best;
  }

  tryTakedown() {
    const target = this.findTakedownTarget();
    if (!target) return false;
    this.sfx.takedown();
    this.hitMarker = 0.25;
    this.camKick.kick(0.9);
    target.takeDamage(1000, true);
    this.emitHud();
    return true;
  }

  /* ------------------------------------------------------------ */
  private onShot(muzzle: THREE.Vector3, kick: number) {
    const rig = this.rig;
    const w = WEAPONS[this.weaponIdx];
    const baseDir = rig.aimPoint.clone().sub(muzzle).normalize();
    const moving = clamp(rig.speed / 4, 0, 1.2);
    const rawSpread = lerp(w.baseSpread, w.adsSpread, this.adsBlend) + moving * 0.012 + (rig.grounded ? 0 : 0.02) + (this.crouchToggle ? -0.0015 : 0);
    const spread = Math.max(0.0003, rawSpread * this.stats.spreadMult);
    this.spread = spread;
    const r = () => (Math.random() - 0.5) * 2;
    const targets = [...this.enemyHits, ...this.level!.colliders];
    let hitEnemy = false;
    const shotDamage = w.damage * this.stats.damageMult;

    for (let p = 0; p < w.pellets; p++) {
      const dir = baseDir.clone();
      dir.x += r() * spread;
      dir.y += r() * spread;
      dir.z += r() * spread;
      dir.normalize();
      this.raycaster.set(muzzle, dir);
      this.raycaster.far = 300;
      const hits = this.raycaster.intersectObjects(targets, false);
      let end = muzzle.clone().addScaledVector(dir, 150);
      if (hits.length) {
        const h = hits[0];
        end = h.point.clone();
        const n = (h.face?.normal.clone() ?? new THREE.Vector3(0, 1, 0)).transformDirection(h.object.matrixWorld);
        const fighter = h.object.userData.fighter as Fighter | undefined;
        if (fighter instanceof Enemy && !fighter.isDead) {
          fighter.takeDamage(shotDamage, w.suppressed);
          this.hitMarker = 0.2;
          hitEnemy = true;
        } else if (h.object.userData.destroyable) {
          this.damageDestroyable(h.object, h.point, n, shotDamage);
        } else {
          const kind = (h.object.userData.kind as SurfaceKind) ?? "dirt";
          this.fx.impact(h.point, n, kind);
          if (kind === "metal" && p === 0) this.sfx.ping();
          if (h.object.userData.target) {
            this.world.hitTarget(h.object, 7);
            this.hitMarker = 0.18;
          }
        }
      }
      this.fx.tracer(muzzle, end);
    }
    if (hitEnemy) this.sfx.hit();
    this.fx.muzzleFlash(this.camera, w.suppressed ? 0.24 : 1.0);
    this.sfx.shot(w.soundPitch, w.suppressed);
    // Silenced shots only alert enemies within the weapon's tight noise radius
    const gunPos = rig.root.position;
    const noiseR = w.noiseRadius * this.stats.shotNoiseMult;
    for (const e of this.enemies) {
      if (e.isDead) continue;
      const d = Math.hypot(e.rig.root.position.x - gunPos.x, e.rig.root.position.z - gunPos.z);
      if (d <= noiseR) e.alertFrom(gunPos, 0.2 + (d / noiseR) * 0.45, 0.55);
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
  }

  private damageDestroyable(mesh: THREE.Object3D, point: THREE.Vector3, n: THREE.Vector3, dmg = 34) {
    let hp = this.destroyableHp.get(mesh) ?? 100;
    hp -= dmg;
    if (hp <= 0) {
      this.destroyableHp.set(mesh, 0);
      (mesh as THREE.Mesh).visible = false;
      this.destroyed++;
      this.sfx.thud();
      this.fx.impact(point, n, "metal");
      this.fx.tracer(point.clone().addScaledVector(n, -1.5), point.clone().add(new THREE.Vector3(0, 2, 0)));
      this.updateObjectives();
      if (!this.objectiveDialoguePlayed && this.mission?.onObjective) {
        const destroyDone = this.objectives.find((o) => o.id === "destroy")?.done ?? false;
        const allNonExtract = this.objectives.filter((o) => o.id !== "extract").every((o) => o.done);
        if (allNonExtract || (this.mission.id === 2 && destroyDone)) {
          this.objectiveDialoguePlayed = true;
          this.queueDialogue(this.mission.onObjective);
        }
      }
      this.emitHud();
    } else {
      this.destroyableHp.set(mesh, hp);
      this.fx.impact(point, n, "metal");
      this.hitMarker = 0.15;
    }
  }

  private renderFrame(rawDt: number) {
    this.postTime += rawDt;
    const u = this.gradePass.uniforms;
    u.uTime.value = this.postTime;
    u.uNight.value = this.menuHangar ? 0.55 : this.mission?.night ? 1.0 : 0.0;
    u.uAds.value = this.menuHangar ? 0.0 : this.adsBlend;
    const hpRatio = this.maxHealth > 0 ? clamp(1 - this.health / this.maxHealth, 0, 1) : 0;
    u.uDamage.value = this.menuHangar || !this.rig || this.rig.dead ? 0.0 : clamp((hpRatio - 0.35) * 1.5, 0, 1);
    this.composer.render();
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

    // ---- dialogue timing
    if (this.dialogue) {
      this.dialogueT -= rawDt;
      if (this.dialogueT <= 0) this.nextDialogue();
    }

    // ---- practice auto-respawn
    if (this.practiceRespawnT > 0) {
      this.practiceRespawnT -= rawDt;
      if (this.practiceRespawnT <= 0) this.respawn();
    }

    // ---- menu hangar: showcase soldier standing on tactical dais
    if (this.menuHangar && rig) {
      if (!this.mouseL && !this.mouseR) this.menuYaw += rawDt * 0.12;
      rig.input.ads = true;
      rig.aimYaw = this.menuYaw;
      rig.aimPitch = 0.02;
      rig.aimPoint.set(Math.sin(this.menuYaw) * 10, 1.32, Math.cos(this.menuYaw) * 10);
      rig.update(dt, 0.1);
      // Offset lookAt left so the soldier stands crisply in the right half of the viewport
      this.camera.fov = 38;
      this.camera.updateProjectionMatrix();
      this.camera.position.set(-0.72, 1.34, 3.15);
      this.camera.lookAt(-0.54, 1.04, 0);
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

    // ---- paused / dead / complete: render only (+ death anim)
    if (this.paused) {
      this.renderFrame(rawDt);
      return;
    }

    const dead = rig.dead;
    if (this.phase === "ready") {
      /* ---- input -> rig (one control per action) ---- */
      const k = this.keys;
      const f = (k.has("KeyW") ? 1 : 0) - (k.has("KeyS") ? 1 : 0);
      const s = (k.has("KeyD") ? 1 : 0) - (k.has("KeyA") ? 1 : 0);
      const ay = this.camYaw;
      const fwd = new THREE.Vector3(Math.sin(ay), 0, Math.cos(ay));
      const rgt = new THREE.Vector3(-Math.cos(ay), 0, Math.sin(ay));
      const mv = fwd.multiplyScalar(f).addScaledVector(rgt, s);
      if (mv.lengthSq() > 1) mv.normalize();
      rig.input.move.copy(mv);
      rig.input.sprint = k.has("ShiftLeft") || this.uiHeld.sprint;
      rig.input.crouch = this.crouchToggle;
      rig.input.ads = this.mouseR || this.uiHeld.ads;
      rig.input.lean = (k.has("KeyQ") ? 1 : 0) - (k.has("KeyE") ? 1 : 0);
      rig.aimYaw = this.yaw;
      rig.aimPitch = this.pitch;

      /* ---- camera + aim ---- */
      this.updateCamera(rawDt, dt);
      this.updateAimPoint();

      /* ---- character ---- */
      const gy = this.level!.groundHeightAt(rig.root.position.x, rig.root.position.z, rig.root.position.y);
      rig.update(dt, gy);
      resolveCircleAABBs(rig.root.position, 0.55, this.level!.aabbs, rig.stepHeight);

      /* ---- firing ---- */
      const wantFire = this.mouseL || this.uiHeld.fire;
      if (wantFire && !dead) {
        if (rig.mag <= 0 && rig.reserve > 0 && !rig.isReloading) {
          rig.fire(); // dry click
          if (rig.mag <= 0) setTimeout(() => this.rig?.reload(), 250);
        } else rig.fire();
      }
    } else {
      /* dead / complete: keep the character animating */
      rig.update(dt);
      this.updateCamera(rawDt, dt);
    }

    /* ---- AI & Objectives ---- */
    if (this.phase === "ready") {
      for (const e of this.enemies) e.update(dt);
      this.ally?.update(dt);
      this.npc?.update(dt);
      this.updateGuardFlashlights();
      this.updateInteractables(dt);
      this.checkProximityObjectives(dt);
      this.updateObjectives();
    }

    /* ---- spread marker ---- */
    this.spread = damp(this.spread, (this.adsBlend > 0.5 ? 0.002 : 0.01) + clamp(rig.speed / 4, 0, 1.2) * 0.012 + (rig.grounded ? 0 : 0.02), 8, rawDt);
    this.hitMarker = Math.max(0, this.hitMarker - rawDt);

    /* ---- world / fx ---- */
    this.world.update(dt, rig.root.position);
    this.fx.update(dt);
    this.renderFrame(rawDt);
  }

  private updateCamera(rawDt: number, dt: number) {
    const rig = this.rig;
    const cam = this.camera;
    const ads = rig.input.ads && !rig.dead;
    this.adsBlend = damp(this.adsBlend, ads ? 1 : 0, 12, rawDt);
    const sprinting = rig.status === "Sprinting";
    this.sprintFov = damp(this.sprintFov, sprinting ? 7 : 0, 5, rawDt);
    const targetAdsFov = this.weaponAmmo[this.weaponIdx]?.adsFov ?? 44;
    this.adsFovSmooth = damp(this.adsFovSmooth, targetAdsFov, 14, rawDt);
    cam.fov = lerp(62, this.adsFovSmooth, this.adsBlend) + this.sprintFov;
    cam.updateProjectionMatrix();

    const kick = this.camKick.update(0, dt);
    const sx = this.shakeX.update(0, dt);
    const sy = this.shakeY.update(0, dt);

    const targetPivot = rig.dead ? 0.7 : rig.eyeHeight;
    this.pivotY = damp(this.pivotY, targetPivot, 10, rawDt);
    const root = rig.root.position;
    const pivot = new THREE.Vector3(root.x, root.y + this.pivotY, root.z);

    let yaw = this.camYaw;
    let pitch = this.camPitch;
    let dist = this.zoomDist;
    let shoulder = 0.55;
    if (this.showcase) {
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
    const fwd = new THREE.Vector3(Math.sin(yaw) * Math.cos(p), Math.sin(p), Math.cos(yaw) * Math.cos(p));
    const right = new THREE.Vector3(-Math.cos(yaw), 0, Math.sin(yaw));
    const desired = pivot.clone().addScaledVector(fwd, -dist).addScaledVector(right, shoulder);
    desired.y += this.showcase ? 0 : 0.12;

    // camera collision
    const toCam = desired.clone().sub(pivot);
    const len = toCam.length();
    this.raycaster.set(pivot, toCam.clone().normalize());
    this.raycaster.far = len;
    const hits = this.raycaster.intersectObjects(this.world.colliders, false);
    if (hits.length && hits[0].distance < len) desired.copy(pivot).addScaledVector(toCam.normalize(), Math.max(0.35, hits[0].distance - 0.2));
    if (desired.y < 0.15) desired.y = 0.15;

    cam.position.copy(desired);
    cam.rotation.order = "YXZ";
    cam.rotation.y = yaw + Math.PI + sx * 0.0008;
    cam.rotation.x = p + sy * 0.0008;
    cam.rotation.z = rig.input.lean * -0.04;
    cam.updateMatrixWorld(true);
  }

  private updateAimPoint() {
    const rig = this.rig;
    if (this.showcase) {
      rig.aimPoint.set(rig.root.position.x + Math.sin(this.yaw) * 40, 1.4 + Math.tan(this.pitch) * 40, rig.root.position.z + Math.cos(this.yaw) * 40);
      return;
    }
    const origin = this.camera.position;
    const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion);
    this.raycaster.set(origin, dir);
    this.raycaster.far = 200;
    const hits = this.raycaster.intersectObjects(this.world.colliders, false);
    const minD = origin.distanceTo(rig.root.position.clone().setY(1.2)) + 0.6;
    const h = hits.find((x) => x.distance > minD);
    if (h) rig.aimPoint.copy(h.point);
    else rig.aimPoint.copy(origin).addScaledVector(dir, 120);
  }

  /* ------------------------------------------------------------ */
  private emitHud() {
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
    for (const e of this.enemies) {
      if (e.isDead) continue;
      if (e.state === "attack") compromised = true;
      else if (e.state === "alert") caution = true;
      if (e.suspicion > maxSusp) maxSusp = e.suspicion;
    }
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
    const extractReady =
      !!mission &&
      !mission.practice &&
      this.objectives.some((o) => o.id === "extract") &&
      this.objectives.filter((o) => o.id !== "extract").every((o) => o.done) &&
      !this.objectives.find((o) => o.id === "extract")?.done;
    let extractDist: number | null = null;
    let extractDirAngle: number | null = null;
    if (extractReady && mission && r) {
      const dx = mission.extraction[0] - r.root.position.x;
      const dz = mission.extraction[1] - r.root.position.z;
      extractDist = Math.round(Math.hypot(dx, dz));
      const dotFwd = dx * Math.sin(this.camYaw) + dz * Math.cos(this.camYaw);
      const dotRgt = dx * -Math.cos(this.camYaw) + dz * Math.sin(this.camYaw);
      extractDirAngle = Math.atan2(dotRgt, dotFwd);
    }
    const boss = this.bossEntity && !this.bossEntity.isDead && this.bossEntity.alerted
      ? { name: this.bossEntity.name || "Boss", hp: Math.max(1, this.bossEntity.hp), maxHp: this.bossEntity.maxHp }
      : null;
    this.onHud({
      loading: this.phase === "loading",
      progress: this.progress,
      phase: this.phase,
      mission: mission
        ? { id: mission.id, codename: mission.codename, name: mission.name, location: mission.location, timeOfDay: mission.timeOfDay, accent: mission.accent }
        : null,
      objectives: this.objectives,
      dialogue: this.dialogue,
      boss,
      paused: this.paused,
      kills: this.killed,
      ammo: r?.mag ?? MAG_SIZE,
      reserve: r?.reserve ?? 120,
      health: this.health,
      maxHealth: this.maxHealth,
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
      timeScale: this.timeScale,
      weaponIndex: this.weaponIdx,
      weaponName: w.name,
      weaponCategory: w.category,
      zoomFactor,
      suppressed: w.suppressed,
      stealthState,
      suspicion: Math.round(maxSusp * 100),
      stealthKills: this.stealthKills,
      alerts: this.alerts,
      takedownReady,
      interact,
      extractReady,
      extractDist,
      extractDirAngle,
      weapons: WEAPONS.map((spec, i) => ({
        slot: spec.slot,
        shortName: spec.shortName,
        category: spec.category,
        mag: this.weaponAmmo[i]?.mag ?? spec.magSize,
        reserve: this.weaponAmmo[i]?.reserve ?? spec.reserveMax,
      })),
    });
  }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.cleanup.forEach((c) => c());
    this.ro?.disconnect();
    if (document.pointerLockElement) document.exitPointerLock();
    this.composer.dispose();
    this.hangarEnv?.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
