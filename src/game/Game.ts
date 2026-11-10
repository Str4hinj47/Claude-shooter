import * as THREE from "three";
import { SoldierRig, MAG_SIZE, type RigStatus } from "../character/SoldierRig";
import { type World, type SurfaceKind } from "./world";
import { buildLevel, type LevelResult } from "./levels";
import { CombatFX, Sfx } from "./fx";
import { Spring, clamp, damp, lerp } from "../character/math";
import { Ally, Enemy, Fighter, RescueNPC, resolveCircleAABBs, type CombatHost } from "./Enemy";
import { MISSIONS, type DialogueLine, type MissionDef, type ObjectiveDef } from "./story";

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
}

export type Trigger = "reload" | "jump" | "hit" | "dieBack" | "dieFront" | "respawn" | "showcase";
export type Held = "fire" | "ads" | "sprint" | "crouch";

export interface GameCallbacks {
  onHud: (s: HudState) => void;
  onMissionEnd: (mission: MissionDef, success: boolean) => void;
}

export const SAVE_KEY = "vanguard_blackout_save_v1";
export function loadSave(): { unlocked: number } {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as { unlocked?: unknown };
      const u = Number(parsed?.unlocked);
      if (Number.isFinite(u) && u >= 0) return { unlocked: Math.floor(u) };
    }
  } catch {
    /* ignore */
  }
  return { unlocked: 0 };
}
export function saveProgress(unlocked: number) {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify({ unlocked }));
  } catch {
    /* ignore */
  }
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
  private health = 100;
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
  private timeScale = 1;
  private pivotY = 1.5;
  private raycaster = new THREE.Raycaster();
  private disposed = false;
  private ro?: ResizeObserver;
  private cleanup: (() => void)[] = [];
  private lockFailed = false;
  private zoomDist = 2.7;

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
  private rescueBeacon: THREE.Mesh | null = null;
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
    this.renderer.toneMappingExposure = 0.78;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.domElement.style.display = "block";
    this.renderer.domElement.tabIndex = 0;
    container.appendChild(this.renderer.domElement);
    this.camera.position.set(0.6, 1.8, -3);
    this.scene.add(this.missionRoot);
    this.scene.add(this.fx.group);
    this.bind();
    this.resize();
    this.emitHud();
  }

  /* ------------------------------------------------------------ */
  async startMission(id: number, cb: GameCallbacks) {
    this.cb = cb;
    this.phase = "loading";
    this.emitHud();
    const mission = MISSIONS.find((m) => m.id === id) ?? MISSIONS[0];
    this.mission = mission;

    // reset mission state
    this.firstContact = false;
    this.killed = 0;
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
    this.dialogueQueue = [];
    this.dialogue = null;
    this.destroyableHp.clear();
    if (this.extractRing) {
      this.missionRoot.remove(this.extractRing);
      this.extractRing.geometry.dispose();
      (this.extractRing.material as THREE.Material).dispose();
      this.extractRing = null;
    }
    if (this.rescueBeacon) {
      this.missionRoot.remove(this.rescueBeacon);
      this.rescueBeacon.geometry.dispose();
      (this.rescueBeacon.material as THREE.Material).dispose();
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
      this.rig.rifle.muzzle.add(this.fx.flash);
      this.rig.events = {
        onShot: (m, kick) => this.onShot(m, kick),
        onEject: (p, d) => this.fx.casing(p, d),
        onDry: () => this.sfx.dry(),
        onFootstep: (_s, i) => this.sfx.step(i),
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
    const sp = mission.spawn;
    this.rig.respawn(new THREE.Vector3(sp[0], 0, sp[1]));
    this.rig.aimYaw = THREE.MathUtils.degToRad(sp[2]);
    this.yaw = this.camYaw = this.rig.aimYaw;
    this.pitch = this.camPitch = 0.05;
    this.health = 100;
    this.showcase = false;
    this.crouchToggle = false;

    // objectives
    this.objectives = mission.objectives.map((o: ObjectiveDef) => ({
      id: o.id,
      label: o.label,
      done: mission.practice === true,
      progress: mission.practice === true ? o.count ?? 1 : 0,
      total: o.count ?? (o.kind === "reach" ? 1 : 0),
    }));
    if (mission.practice) this.objectives.forEach((o) => (o.done = true));

    // combat host
    const host: CombatHost = {
      colliders: this.level.colliders,
      aabbs: this.level.aabbs,
      fx: this.fx,
      sfx: this.sfx,
      playerPos: (out: THREE.Vector3) => {
        const r = this.rig.root.position;
        return out.set(r.x, r.y + this.rig.eyeHeight, r.z);
      },
      playerAlive: () => !this.rig.dead,
      onPlayerHit: (dmg) => this.damage(dmg, Math.random() * Math.PI * 2),
      onKilled: (e) => this.onEnemyKilled(e),
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

    // extraction ring + rescue beacon
    if (!mission.practice) {
      const ex = mission.extraction;
      const ringGeo = new THREE.RingGeometry(ex[2] - 0.35, ex[2], 48);
      const ringMat = new THREE.MeshBasicMaterial({ color: 0x66ff99, transparent: true, opacity: 0.5, side: THREE.DoubleSide, depthWrite: false });
      this.extractRing = new THREE.Mesh(ringGeo, ringMat);
      this.extractRing.rotation.x = -Math.PI / 2;
      this.extractRing.position.set(ex[0], 0.08, ex[1]);
      this.missionRoot.add(this.extractRing);
    }
    if (mission.rescue) {
      const beaconGeo = new THREE.ConeGeometry(0.5, 1.6, 8);
      const beaconMat = new THREE.MeshStandardMaterial({ color: 0xffd060, emissive: 0xffaa20, emissiveIntensity: 1.6 });
      this.rescueBeacon = new THREE.Mesh(beaconGeo, beaconMat);
      this.rescueBeacon.position.set(mission.rescue[0], 2.2, mission.rescue[1]);
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
      if (["Space", "ArrowUp", "ArrowDown", "Tab"].includes(e.code)) e.preventDefault();
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
        case "KeyH":
          this.trigger("hit");
          break;
        case "KeyK":
          this.trigger("dieBack");
          break;
        case "KeyL":
          this.trigger("dieFront");
          break;
        case "KeyT":
          this.trigger("respawn");
          break;
        case "Tab":
          this.trigger("showcase");
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
      if (!this.locked && !drag) return;
      const s = 0.0022 * (this.adsBlend > 0.5 ? 0.6 : 1);
      this.camYaw -= e.movementX * s;
      this.camPitch = clamp(this.camPitch - e.movementY * s, -1.2, 1.25);
      if (!this.showcase) {
        this.yaw = this.camYaw;
        this.pitch = this.camPitch;
      }
    });
    on(el, "wheel", (e: WheelEvent) => {
      this.zoomDist = clamp(this.zoomDist + e.deltaY * 0.002, 1.0, 6);
    });
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
    this.health = Math.max(0, this.health - n);
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
        this.cb?.onMissionEnd(this.mission!, false);
      }
    }
  }

  /** story missions: full rebuild; practice: quick reset */
  respawn() {
    if (!this.mission) return;
    if (this.mission.practice) {
      this.health = 100;
      const sp = this.mission.spawn;
      this.rig.respawn(new THREE.Vector3(sp[0], 0, sp[1]));
      this.rig.aimYaw = THREE.MathUtils.degToRad(sp[2]);
      this.yaw = this.camYaw = this.rig.aimYaw;
      this.phase = "ready";
      this.emitHud();
    } else {
      void this.startMission(this.mission.id, this.cb!);
    }
  }

  exitToMenu() {
    this.phase = "idle";
    this.paused = false;
    if (document.pointerLockElement) document.exitPointerLock();
  }

  /* ------------------------------------------------------------ */
  private onFirstContact() {
    if (this.firstContact || !this.mission) return;
    this.firstContact = true;
    if (this.mission.onFirstContact) this.queueDialogue(this.mission.onFirstContact);
  }

  private onEnemyKilled(e: Fighter) {
    this.killed++;
    this.sfx.thud();
      if (e === this.bossEntity) {
        this.bossKilled = true;
        this.bossEntity = null;
      }
    // halfway line
    const eliminateTotal = this.mission!.enemies.filter((s) => !s.boss).length;
    if (!this.halfwayPlayed && eliminateTotal > 0 && this.killed >= Math.ceil(eliminateTotal / 2)) {
      this.halfwayPlayed = true;
      if (this.mission!.onHalfway) this.queueDialogue(this.mission!.onHalfway);
    }
    // objective dialogue once
    if (!this.objectiveDialoguePlayed && this.mission!.onObjective) {
      const prog = this.objectives.find((o) => !o.done);
      if (!prog) {
        this.objectiveDialoguePlayed = true;
        this.queueDialogue(this.mission!.onObjective);
      }
    }
    this.updateObjectives();
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
      }
      // kind "reach" handled by proximity checks in frame
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
        if (!this.objectiveDialoguePlayed) {
          this.objectiveDialoguePlayed = true;
          if (this.mission.onObjective) this.queueDialogue(this.mission.onObjective);
        }
        this.emitHud();
      }
    }
    // extract ring fade in/out
    if (this.extractRing) {
      const ex = this.mission.extraction;
      const d = Math.hypot(p.x - ex[0], p.z - ex[1]);
      const mat = this.extractRing.material as THREE.MeshBasicMaterial;
      const allDone = this.objectives.filter((o) => o.id !== "extract").every((o) => o.done);
      mat.opacity = 0.35 + Math.max(0, 0.25 - d / 20) + (allDone ? 0.25 : 0);
      mat.color.setHex(allDone ? 0x66ff99 : 0xffcc44);
    }
    if (this.rescueBeacon) {
      this.rescueBeacon.rotation.y += dt * 1.5;
      this.rescueBeacon.visible = !this.rescued;
    }
  }

  private completeMission() {
    if (!this.mission || this.phase === "complete") return;
    this.phase = "complete";
    const next = Math.max(this.mission.id + 1, loadSave().unlocked);
    saveProgress(next);
    if (this.mission.onExtraction) this.queueDialogue(this.mission.onExtraction);
    this.emitHud();
    setTimeout(() => {
      this.cb?.onMissionEnd(this.mission!, true);
    }, 1800);
  }

  /* ------------------------------------------------------------ */
  private onShot(muzzle: THREE.Vector3, kick: number) {
    const rig = this.rig;
    const dir = rig.aimPoint.clone().sub(muzzle).normalize();
    const moving = clamp(rig.speed / 4, 0, 1.2);
    const spread = (this.adsBlend > 0.5 ? 0.0018 : 0.009) + moving * 0.012 + (rig.grounded ? 0 : 0.02) + (this.crouchToggle ? -0.002 : 0);
    this.spread = spread;
    const r = () => (Math.random() - 0.5) * 2;
    dir.x += r() * spread;
    dir.y += r() * spread;
    dir.z += r() * spread;
    dir.normalize();
    this.raycaster.set(muzzle, dir);
    this.raycaster.far = 300;
    const targets = [...this.enemyHits, ...this.level!.colliders];
    const hits = this.raycaster.intersectObjects(targets, false);
    let end = muzzle.clone().addScaledVector(dir, 150);
    if (hits.length) {
      const h = hits[0];
      end = h.point.clone();
      const n = (h.face?.normal.clone() ?? new THREE.Vector3(0, 1, 0)).transformDirection(h.object.matrixWorld);
      const fighter = h.object.userData.fighter as Fighter | undefined;
      if (fighter instanceof Enemy && !fighter.isDead) {
        fighter.takeDamage(34);
        this.hitMarker = 0.2;
        this.sfx.hit();
      } else if (h.object.userData.destroyable) {
        this.damageDestroyable(h.object, h.point, n);
      } else {
        const kind = (h.object.userData.kind as SurfaceKind) ?? "dirt";
        this.fx.impact(h.point, n, kind);
        if (kind === "metal") this.sfx.ping();
        if (h.object.userData.target) {
          this.world.hitTarget(h.object, 7);
          this.hitMarker = 0.18;
        }
      }
    }
    this.fx.tracer(muzzle, end);
    this.fx.muzzleFlash(this.camera);
    this.sfx.shot();
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

  private damageDestroyable(mesh: THREE.Object3D, point: THREE.Vector3, n: THREE.Vector3) {
    let hp = this.destroyableHp.get(mesh) ?? 100;
    hp -= 34;
    if (hp <= 0) {
      this.destroyableHp.set(mesh, 0);
      (mesh as THREE.Mesh).visible = false;
      this.destroyed++;
      this.sfx.thud();
      this.fx.impact(point, n, "metal");
      this.fx.tracer(point.clone().addScaledVector(n, -1.5), point.clone().add(new THREE.Vector3(0, 2, 0)));
      this.updateObjectives();
      if (!this.objectiveDialoguePlayed) {
        this.objectiveDialoguePlayed = true;
        if (this.mission?.onObjective) this.queueDialogue(this.mission.onObjective);
      }
      this.emitHud();
    } else {
      this.destroyableHp.set(mesh, hp);
      this.fx.impact(point, n, "metal");
      this.hitMarker = 0.15;
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

    // ---- showcase: orbit camera only
    if (this.showcase) {
      this.updateCamera(rawDt, dt);
      this.world.update(dt, rig.root.position);
      this.fx.update(dt);
      this.renderer.render(this.scene, this.camera);
      return;
    }

    // ---- paused / dead / complete: render only (+ death anim)
    if (this.paused) {
      this.renderer.render(this.scene, this.camera);
      return;
    }

    const dead = rig.dead;
    if (this.phase === "ready") {
      /* ---- input -> rig ---- */
      const k = this.keys;
      const f = (k.has("KeyW") || k.has("ArrowUp") ? 1 : 0) - (k.has("KeyS") || k.has("ArrowDown") ? 1 : 0);
      const s = (k.has("KeyD") || k.has("ArrowRight") ? 1 : 0) - (k.has("KeyA") || k.has("ArrowLeft") ? 1 : 0);
      const ay = this.camYaw;
      const fwd = new THREE.Vector3(Math.sin(ay), 0, Math.cos(ay));
      const rgt = new THREE.Vector3(-Math.cos(ay), 0, Math.sin(ay));
      const mv = fwd.multiplyScalar(f).addScaledVector(rgt, s);
      if (mv.lengthSq() > 1) mv.normalize();
      rig.input.move.copy(mv);
      rig.input.sprint = k.has("ShiftLeft") || k.has("ShiftRight") || this.uiHeld.sprint;
      rig.input.crouch = this.crouchToggle || k.has("ControlLeft") || k.has("ControlRight");
      rig.input.ads = this.mouseR || this.uiHeld.ads || k.has("KeyZ");
      rig.input.lean = (k.has("KeyQ") ? 1 : 0) - (k.has("KeyE") ? 1 : 0);
      rig.aimYaw = this.yaw;
      rig.aimPitch = this.pitch;

      /* ---- camera + aim ---- */
      this.updateCamera(rawDt, dt);
      this.updateAimPoint();

      /* ---- character ---- */
      rig.update(dt);
      resolveCircleAABBs(rig.root.position, 0.55, this.level!.aabbs);

      /* ---- firing ---- */
      const wantFire = (this.mouseL && (this.locked || this.lockFailed)) || k.has("KeyF") || this.uiHeld.fire;
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

    /* ---- AI ---- */
    if (this.phase === "ready") {
      for (const e of this.enemies) e.update(dt);
      this.ally?.update(dt);
      this.npc?.update(dt);
      this.checkProximityObjectives(dt);
      this.updateObjectives();
    }

    /* ---- spread marker ---- */
    this.spread = damp(this.spread, (this.adsBlend > 0.5 ? 0.002 : 0.01) + clamp(rig.speed / 4, 0, 1.2) * 0.012 + (rig.grounded ? 0 : 0.02), 8, rawDt);
    this.hitMarker = Math.max(0, this.hitMarker - rawDt);

    /* ---- world / fx ---- */
    this.world.update(dt, rig.root.position);
    this.fx.update(dt);
    this.renderer.render(this.scene, this.camera);
  }

  private updateCamera(rawDt: number, dt: number) {
    const rig = this.rig;
    const cam = this.camera;
    const ads = rig.input.ads && !rig.dead;
    this.adsBlend = damp(this.adsBlend, ads ? 1 : 0, 12, rawDt);
    const sprinting = rig.status === "Sprinting";
    this.sprintFov = damp(this.sprintFov, sprinting ? 7 : 0, 5, rawDt);
    cam.fov = lerp(62, 46, this.adsBlend) + this.sprintFov;
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
      status: r?.status ?? "Idle",
      speed: r?.speed ?? 0,
      reloading: r?.isReloading ?? false,
      reloadProgress: r?.reloadProgress ?? 0,
      locked: this.locked,
      dead: r?.dead ?? false,
      crouch: this.crouchToggle,
      ads: this.uiHeld.ads,
      sprint: this.uiHeld.sprint,
      showcase: this.showcase,
      fps: this.fps,
      spread: this.spread,
      hitMarker: this.hitMarker,
      timeScale: this.timeScale,
    });
  }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.cleanup.forEach((c) => c());
    this.ro?.disconnect();
    if (document.pointerLockElement) document.exitPointerLock();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
