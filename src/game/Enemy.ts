/* ------------------------------------------------------------------ */
/*  COMBAT CHARACTERS — enemies, ally, NPCs                            */
/*  All reuse SoldierRig (soldier.glb) with per-faction tints.        */
/*  AI: idle/guard → patrol → alert → attack, burst fire, LOS via    */
/*  raycast, circle-vs-AABB movement collision.                      */
/* ------------------------------------------------------------------ */
import * as THREE from "three";
import { SoldierRig } from "../character/SoldierRig";
import { CombatFX, Sfx } from "./fx";
import { clamp } from "../character/math";
import { characterUrl } from "./characters";
import type { EnemySpawn, MissionDef } from "./story";
import { BOSS_HP } from "./story";
import { SpatialAABBGrid } from "./city/SpatialIndex";

export type SquadCommsKind = "gunfire" | "body" | "contact" | "under_fire" | "man_down";

export interface CombatHost {
  colliders: THREE.Object3D[];
  aabbs: THREE.Box3[];
  spatialAABBs?: SpatialAABBGrid;
  rayQuery?: (origin: THREE.Vector3, dir: THREE.Vector3, maxDist: number) => THREE.Object3D[];
  findNavPath?: (from: THREE.Vector3, to: THREE.Vector3) => THREE.Vector3[] | null;
  groundHeightAt: (x: number, z: number, y: number) => number;
  fx: CombatFX;
  sfx: Sfx;
  playerPos: (out: THREE.Vector3) => THREE.Vector3;
  playerAlive: () => boolean;
  playerCrouching: () => boolean;
  playerSprinting: () => boolean;
  playerDetectMult?: () => number;
  playerVisionRangeMult?: () => number;
  difficultyScale?: () => { hp: number; damage: number; accuracy: number; vision: number };
  onPlayerHit: (dmg: number) => void;
  onKilled: (e: Fighter, stealth?: boolean) => void;
  onAlert: (e: Fighter) => void;
  onBossEngage?: (e: Fighter) => void;
  onBossHalfHp?: (e: Fighter) => void;
  onSquadComms?: (kind: SquadCommsKind, reporter: Fighter, pos: THREE.Vector3) => void;
  enemies: () => Enemy[];
  mission: MissionDef;
}

const _resolveScratch: THREE.Box3[] = [];

/** circle-vs-AABB push-out used for player & enemy movement.
 *  When a body bumps a surface whose top is within `step` metres above the feet,
 *  the body is lifted onto it (stairs / low ledges) instead of being shoved back. */
export function resolveCircleAABBs(
  pos: THREE.Vector3,
  radius: number,
  aabbs: THREE.Box3[] | SpatialAABBGrid,
  step = 0,
) {
  const list = Array.isArray(aabbs) ? aabbs : aabbs.queryPoint(pos.x, pos.z, radius + 0.15, _resolveScratch);
  const bodyTop = pos.y + 1.8;

  // Pass 1: push horizontally out of tall walls / obstacles that cannot be stepped onto
  for (const b of list) {
    if (bodyTop <= b.min.y + 0.02 || pos.y >= b.max.y - 0.03) continue;
    const rise = b.max.y - pos.y;
    if (step > 0 && rise > 0.02 && rise <= step + 0.06) continue;
    const cx = clamp(pos.x, b.min.x, b.max.x);
    const cz = clamp(pos.z, b.min.z, b.max.z);
    const dx = pos.x - cx;
    const dz = pos.z - cz;
    const d2 = dx * dx + dz * dz;
    if (d2 >= radius * radius || d2 < 1e-6) continue;
    const d = Math.sqrt(d2);
    const push = (radius - d) / d;
    pos.x += dx * push;
    pos.z += dz * push;
  }

  // Pass 2: cleanly step onto low ledges / curbs within `step` height
  if (step > 0) {
    let bestTop = Infinity;
    for (const b of list) {
      if (bodyTop <= b.min.y + 0.02 || pos.y >= b.max.y - 0.03) continue;
      const rise = b.max.y - pos.y;
      if (rise <= 0.02 || rise > step + 0.06) continue;
      const cx = clamp(pos.x, b.min.x, b.max.x);
      const cz = clamp(pos.z, b.min.z, b.max.z);
      const dx = pos.x - cx;
      const dz = pos.z - cz;
      if (dx * dx + dz * dz < radius * radius && b.max.y < bestTop) {
        bestTop = b.max.y;
      }
    }
    if (bestTop < Infinity) {
      pos.y = bestTop;
    }
  }
}

type AIState = "idle" | "patrol" | "alert" | "attack" | "dead";
export type SoundKind = "footstep" | "land" | "reload" | "gunshot" | "impact" | "vehicle" | "shatter" | "callout";

function wrapAngleDiff(from: number, to: number): number {
  let d = (to - from) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

function stepYaw(current: number, target: number, maxStep: number): number {
  const diff = wrapAngleDiff(current, target);
  if (Math.abs(diff) <= maxStep) return target;
  return current + Math.sign(diff) * maxStep;
}

export class Fighter {
  rig!: SoldierRig;
  readonly hitbox: THREE.Mesh;
  state: AIState = "idle";
  hp = 100;
  readonly maxHp: number;
  readonly boss: boolean;
  readonly role: "guard" | "sniper" | "heavy";
  name: string;
  protected readonly spawn: EnemySpawn;
  protected readonly mission: MissionDef;
  protected readonly host: CombatHost;
  protected dead = false;
  alerted = false;
  suspicion = 0;
  private bossEngaged = false;
  private bossHalfTriggered = false;
  bodyDiscovered = false;
  patrolIdx = 0;
  readonly lastSeen = new THREE.Vector3();
  sightLost = 0;
  burstTimer = 1.0;
  burstShots = 0;
  reloadDelay = 0;
  readonly aimPoint = new THREE.Vector3();
  private raycaster = new THREE.Raycaster();
  protected tmp = new THREE.Vector3();
  protected tmp2 = new THREE.Vector3();
  protected tmp3 = new THREE.Vector3();
  protected tmp4 = new THREE.Vector3();
  private losDir = new THREE.Vector3();
  private strafeSign = Math.random() < 0.5 ? 1 : -1;
  private strafeTimer = 1.4 + Math.random() * 1.4;
  private flankSign = Math.random() < 0.5 ? 1 : -1;
  private coverTimer = 0;
  private alertDelay = 0;
  private searchTimer = 0;
  private searchYaw = 0;
  private bodyScanTimer = Math.random() * 0.4;
  private hearingCooldown = 0;
  private commsCooldown = 0;
  private shotCommsCooldown = 0;
  private wasSeeing = false;
  get isSeeingPlayer() {
    return this.wasSeeing;
  }
  private baseYaw = Math.random() * Math.PI * 2;
  private yawSweep = Math.random() * Math.PI * 2;
  private prevPos = new THREE.Vector3();
  private stuckTimer = 0;
  private steerBias = 1;
  private navPath: THREE.Vector3[] | null = null;
  private navIdx = 1;
  private navTimer = 0;
  private navGoal = new THREE.Vector3(Infinity, Infinity, Infinity);
  private flashlightMount: THREE.Object3D | null = null;
  private flashlightLens: THREE.Mesh | null = null;
  private flashlightBeam: THREE.Mesh | null = null;
  private sniperLaser: THREE.Mesh | null = null;

  constructor(host: CombatHost, spawn: EnemySpawn, mission: MissionDef, hp: number, boss: boolean) {
    this.host = host;
    this.spawn = spawn;
    this.mission = mission;
    this.role = spawn.role ?? "guard";
    this.maxHp = hp;
    this.hp = hp;
    this.boss = boss;
    this.name = spawn.name ?? "";
    // invisible hitbox (Raycaster does not check visible — confirmed in three source)
    this.hitbox = new THREE.Mesh(
      new THREE.BoxGeometry(0.75, 1.75, 0.5),
      new THREE.MeshBasicMaterial({ visible: false }),
    );
    this.hitbox.position.set(0, 1.0, 0);
    this.hitbox.userData.fighter = this;
    (this.raycaster as THREE.Raycaster & { firstHitOnly?: boolean }).firstHitOnly = true;
  }

  async build(scene: THREE.Object3D, tint: [number, number], heightScale = 1) {
    const canFetchChars = typeof window !== "undefined" && typeof fetch === "function";
    let modelUrl: string | undefined;
    if (canFetchChars) {
      if (this instanceof Ally) {
        modelUrl = characterUrl("military");
      } else if (this.boss) {
        modelUrl = characterUrl(this.mission.id >= 5 || this.mission.id === 3 ? "military" : "business");
      } else {
        const pool: Record<number, string[]> = {
          1: ["security", "civilian"],
          2: ["security", "business"],
          3: ["construction", "security"],
          4: ["business", "security"],
          5: ["military", "police"],
          6: ["military", "security"],
        };
        const list = pool[this.mission.id] ?? ["military", "security"];
        const idx = Math.abs(Math.round(this.spawn.x + this.spawn.z)) % list.length;
        modelUrl = characterUrl(list[idx]);
      }
    }
    this.rig = await SoldierRig.load(scene, undefined, modelUrl);
    this.rig.groundSampler = (x, z, y) => this.host.groundHeightAt(x, z, y);
    if (!(this instanceof Ally)) {
      const wId = this.boss
        ? this.mission.bossWeapon
        : this.role === "sniper"
          ? "dmr"
          : this.role === "heavy"
            ? (this.mission.id >= 6 ? "carbine" : "shotgun")
            : this.mission.enemyWeapon;
      if (wId) this.rig.setWeaponModel(wId);
      const app = this.boss ? this.mission.bossAppearance : this.mission.enemyAppearance;
      if (app) {
        this.rig.setAppearance(app);
        if (this.rig.isRocketbox) {
          this.rig.setTint(this.role === "heavy" ? 0x3b4454 : tint[0], tint[1]);
        }
      } else {
        this.rig.setTint(this.role === "heavy" ? 0x3b4454 : tint[0], tint[1]);
      }
      if (this.role === "sniper") {
        this.attachSniperLaser();
      }
    } else {
      this.rig.setTint(tint[0], tint[1]);
    }
    this.rig.setHeightScale(heightScale);
    this.rig.root.position.set(this.spawn.x, this.spawn.y ?? 0, this.spawn.z);
    // Point idle guards toward explicit facing yaw or center/player approach initially
    this.baseYaw =
      this.spawn.yawDeg !== undefined
        ? THREE.MathUtils.degToRad(this.spawn.yawDeg)
        : Math.atan2(-this.spawn.x, -this.spawn.z) + (Math.random() - 0.5) * 0.8;
    this.rig.aimYaw = this.baseYaw;
    scene.add(this.rig.root);
    this.rig.root.add(this.hitbox);
    this.rig.events.onShot = (muzzle) => this.onShoot(muzzle);
    this.rig.events.onDry = () => {
      if (this.reloadDelay <= 0) {
        this.reloadDelay = 0.4;
        this.rig.reload();
      }
    };
    if (this.mission.night && !(this instanceof Ally)) {
      this.attachFlashlight();
    }
  }

  private attachFlashlight() {
    const mount = new THREE.Group();
    mount.position.set(-0.032, 0.112, 0.54);
    const body = new THREE.Mesh(
      new THREE.CylinderGeometry(0.014, 0.015, 0.11, 10),
      new THREE.MeshStandardMaterial({ color: 0x16191e, roughness: 0.45, metalness: 0.8 }),
    );
    body.rotation.x = Math.PI / 2;
    mount.add(body);

    const lens = new THREE.Mesh(
      new THREE.CircleGeometry(0.013, 12),
      new THREE.MeshStandardMaterial({ color: 0xe6f4ff, emissive: 0xd8f0ff, emissiveIntensity: 4.5, roughness: 0.15 }),
    );
    lens.position.set(0, 0, 0.056);
    mount.add(lens);

    const beamMat = new THREE.MeshBasicMaterial({
      color: 0xcfe8ff,
      transparent: true,
      opacity: 0.075,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 2.0, 1, 16, 1, true), beamMat);
    beam.scale.set(1, 14.5, 1);
    beam.rotation.x = -Math.PI / 2;
    beam.position.set(0, 0, 7.3);
    beam.renderOrder = 2;
    mount.add(beam);

    this.rig.rifle.group.add(mount);
    this.flashlightMount = mount;
    this.flashlightLens = lens;
    this.flashlightBeam = beam;
  }

  private attachSniperLaser() {
    const laserMat = new THREE.MeshBasicMaterial({
      color: 0xff2a36,
      transparent: true,
      opacity: 0.48,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const laser = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, 1, 6), laserMat);
    laser.scale.set(1, 38, 1);
    laser.rotation.x = Math.PI / 2;
    laser.position.set(0, 0.082, 19.48);
    laser.visible = false;
    this.rig.rifle.group.add(laser);
    this.sniperLaser = laser;
  }

  getFlashlightWorld(originOut: THREE.Vector3, targetOut: THREE.Vector3): boolean {
    if (this.dead || !this.flashlightMount) return false;
    this.flashlightMount.getWorldPosition(originOut);
    const dir = this.tmp2.set(0, 0, 1).applyQuaternion(this.flashlightMount.getWorldQuaternion(new THREE.Quaternion()));
    targetOut.copy(originOut).addScaledVector(dir, 14);
    return true;
  }

  get isDead() {
    return this.dead;
  }

  get isUnaware() {
    return this.state === "idle" || this.state === "patrol";
  }

  takeDamage(dmg: number, suppressed = false, hitPoint?: THREE.Vector3) {
    if (this.dead) return;
    const unaware = this.isUnaware || (this.state === "alert" && this.suspicion < 0.85);
    const effectiveDmg = unaware ? dmg * 2.5 : dmg;
    this.hp -= effectiveDmg;
    if (this.boss && !this.bossHalfTriggered && this.hp > 0 && this.hp <= this.maxHp * 0.5) {
      this.bossHalfTriggered = true;
      this.burstTimer = Math.min(this.burstTimer, 0.12);
      this.host.onBossHalfHp?.(this);
    }
    this.rig.hit(0);
    const bp = hitPoint ?? this.rig.root.position.clone().add(new THREE.Vector3(0, 1.18, 0));
    this.host.fx.bloodBurst(bp, undefined, 1.0);
    this.host.fx.attachWoundToCharacter(this.rig.fall, Math.max(0.55, Math.min(1.55, bp.y - this.rig.root.position.y)));
    if (this.hp <= 0) {
      this.dead = true;
      this.state = "dead";
      this.suspicion = 0;
      if (this.flashlightBeam) this.flashlightBeam.visible = false;
      if (this.sniperLaser) this.sniperLaser.visible = false;
      if (this.flashlightLens) {
        (this.flashlightLens.material as THREE.MeshStandardMaterial).emissiveIntensity = 0;
      }
      this.rig.die(Math.random() < 0.5 ? "back" : "front");
      this.host.fx.spawnBloodPool(this.rig.root.position.x, this.rig.root.position.y, this.rig.root.position.z, 0.92);
      this.hitbox.visible = false;
      this.hitbox.position.y = -50; // belt-and-braces off the raycast path
      // Silent kill if enemy was unaware & killed with a suppressed weapon or takedown
      if (!unaware || !suppressed) {
        const p = this.host.playerPos(this.tmp);
        this.broadcastComms("man_down", p, suppressed ? 12 : 48, 0.72);
      }
      this.host.onKilled(this, unaware && suppressed);
      return;
    }
    // Survived the hit: seek cover, investigate/engage shooter, radio squadmates
    this.coverTimer = Math.max(this.coverTimer, 1.1 + Math.random() * 0.8);
    this.strafeSign = Math.random() < 0.5 ? 1 : -1;
    const p = this.host.playerPos(this.tmp);
    this.suspicion = Math.max(this.suspicion, suppressed ? 0.88 : 1.0);
    this.alertFrom(p, 0.08);
    this.broadcastComms("under_fire", p, suppressed ? 26 : 58, 0.78);
  }

  /** Receive a sound/callout alert from footsteps, gunfire, or a nearby teammate */
  alertFrom(pos: THREE.Vector3, delay = 0.25, boost = 0.5) {
    if (this.dead) return;
    this.lastSeen.copy(pos);
    this.suspicion = Math.max(this.suspicion, boost);
    this.searchTimer = 0;
    if (this.state === "idle" || this.state === "patrol") {
      this.state = "alert";
      this.alertDelay = delay;
      this.sightLost = 0;
    } else if (this.state === "alert") {
      this.alertDelay = Math.min(this.alertDelay, delay);
      this.sightLost = 0;
    }
    if (this.suspicion >= 1.0 && this.state !== "attack") {
      this.state = "attack";
      if (!this.alerted) {
        this.alerted = true;
        this.host.onAlert(this);
      }
      this.burstTimer = Math.max(this.burstTimer, 0.38 + (1 - this.mission.enemyAccuracy) * 0.30);
    }
  }

  /**
   * Acoustic perception with wall occlusion, distance falloff, and cumulative suspicion.
   * Returns true if the enemy heard the sound.
   */
  hearSound(pos: THREE.Vector3, baseRadius: number, strength: number, kind: SoundKind): boolean {
    if (this.dead || baseRadius <= 0.1) return false;
    const ear = this.eyePos(this.tmp2);
    const dx = pos.x - ear.x;
    const dy = (pos.y + 0.8) - ear.y;
    const dz = pos.z - ear.z;
    const dist = Math.hypot(dx, dy, dz);
    if (dist > baseRadius) return false;

    // Occlusion check: walls & thick cover dampen both reach and loudness
    const soundOrigin = this.tmp3.set(pos.x, pos.y + 0.8, pos.z);
    const clearAir = dist < 1.2 || this.hasLineOfSight(ear, soundOrigin);
    const effectiveRadius = clearAir ? baseRadius : baseRadius * 0.56;
    if (dist > effectiveRadius) return false;

    const atten = clamp(1 - (dist / effectiveRadius) * 0.55, 0.28, 1.0);
    const occMult = clearAir ? 1.0 : 0.62;
    const delta = strength * atten * occMult;

    // Update suspicion cumulatively so repeated footsteps/reloads/shots escalate naturally
    const cap = kind === "footstep" || kind === "reload" || kind === "land" ? 0.82 : 1.0;
    const nextSusp = Math.min(cap, Math.max(this.suspicion + delta * 0.65, delta));

    // Near-miss / loud impact reaction: duck/strafe into cover briefly
    if ((kind === "impact" || kind === "shatter") && dist < 8.5) {
      this.coverTimer = Math.max(this.coverTimer, 0.85 + Math.random() * 0.5);
    }

    // Immediate sharp turn when hearing a loud nearby sound
    const reactionDelay =
      kind === "gunshot" || kind === "impact" || kind === "shatter"
        ? 0.05 + (dist / effectiveRadius) * 0.14
        : 0.18 + (dist / effectiveRadius) * 0.28;

    // Only update investigation target if not currently staring directly at the player
    if (this.state !== "attack" || this.sightLost > 0.6 || kind === "gunshot" || kind === "impact") {
      this.lastSeen.copy(pos);
    }
    this.suspicion = Math.min(1, nextSusp);
    this.searchTimer = 0;

    if (this.suspicion >= 1.0 && this.state !== "attack") {
      this.state = "attack";
      this.sightLost = 0.2;
      if (!this.alerted) {
        this.alerted = true;
        this.host.onAlert(this);
      }
      this.burstTimer = Math.max(this.burstTimer, 0.38 + (1 - this.mission.enemyAccuracy) * 0.30);
      if (this.hearingCooldown <= 0) {
        this.hearingCooldown = 1.2;
        this.broadcastAlert(pos, 14);
      }
    } else if (this.suspicion >= 0.26 && (this.state === "idle" || this.state === "patrol")) {
      this.state = "alert";
      this.alertDelay = reactionDelay;
      this.sightLost = 0;
    } else if (this.state === "alert") {
      this.alertDelay = Math.min(this.alertDelay, reactionDelay);
      this.sightLost = 0;
    }
    return true;
  }

  /** Radio/shout callout to nearby teammates on the same or adjacent floor */
  protected broadcastAlert(pos: THREE.Vector3, radius: number) {
    this.broadcastComms("contact", pos, radius, 0.65);
  }

  /**
   * Squad communication channel (radio + voice shout):
   * - "gunfire": heard by all guards within earshot across floors (72m)
   * - "body": guard radios dead body discovery to entire compound/squad (95m)
   * - "contact" / "under_fire" / "man_down": tactical target coordinates shared over comms
   */
  protected broadcastComms(kind: SquadCommsKind, pos: THREE.Vector3, radius: number, baseBoost = 0.68) {
    if (this instanceof Ally) return;
    const my = this.rig.root.position;
    const isRadio = kind === "body" || kind === "contact" || kind === "under_fire" || kind === "man_down";
    const verticalLimit = isRadio ? 45 : 22;
    let notified = 0;
    for (const e of this.host.enemies()) {
      if ((e as Fighter) === this || e.isDead) continue;
      const dy = Math.abs(e.rig.root.position.y - my.y);
      if (dy > verticalLimit) continue;
      const d = Math.hypot(e.rig.root.position.x - my.x, e.rig.root.position.z - my.z);
      if (d > radius) continue;

      // Spread guards slightly around the reported point so they flank instead of stacking on one pixel
      const angleOff = ((notified % 5) - 2) * 0.55;
      const spreadR = kind === "body" ? 2.4 + (notified % 3) * 1.4 : 1.6 + (notified % 3) * 1.1;
      const targetPos = this.tmp4.set(
        pos.x + Math.sin(angleOff) * spreadR,
        pos.y,
        pos.z + Math.cos(angleOff) * spreadR,
      );
      const distRatio = d / Math.max(1, radius);
      const delay = isRadio ? 0.14 + distRatio * 0.35 : 0.08 + distRatio * 0.25;
      const boost = Math.max(baseBoost, 1.0 - distRatio * 0.34);
      e.alertFrom(targetPos, delay, boost);
      notified++;
    }
    if (this.commsCooldown <= 0 || kind === "body") {
      this.commsCooldown = kind === "body" ? 3.2 : 4.5;
      this.host.onSquadComms?.(kind, this, pos);
    }
  }

  /** Propagate a guard's own gunfire acoustically so every guard in the sector hears the firefight */
  protected broadcastGuardGunfire(muzzle: THREE.Vector3) {
    if (this instanceof Ally) return;
    const hearRange = 72;
    const targetRef = this.lastSeen.lengthSq() > 0.01 ? this.lastSeen : muzzle;
    for (const e of this.host.enemies()) {
      if ((e as Fighter) === this || e.isDead) continue;
      const ear = e.rig.root.position;
      const d = Math.hypot(ear.x - muzzle.x, ear.z - muzzle.z);
      if (d > hearRange) continue;
      const dy = Math.abs(ear.y - muzzle.y);
      if (dy > 26) continue;
      // Acoustic gunshot wakes idle/patrol guards immediately and directs them to the combat zone
      const heard = e.hearSound(muzzle, hearRange, 1.35, "gunshot");
      if (heard || d <= 52) {
        const delay = 0.08 + (d / hearRange) * 0.28;
        const boost = d <= 30 ? 1.0 : Math.max(0.76, 1.0 - (d - 30) / 65);
        e.alertFrom(targetRef, delay, boost);
      }
    }
    if (this.shotCommsCooldown <= 0) {
      this.shotCommsCooldown = 5.5;
      this.host.onSquadComms?.("gunfire", this, muzzle);
    }
  }

  /** Short forward/angled ray probe against world colliders so bots steer around walls & doorways */
  private isClearDir(origin: THREE.Vector3, dirX: number, dirZ: number, range = 2.3): boolean {
    const dir = this.tmp2.set(dirX, 0, dirZ).normalize();
    this.raycaster.set(origin, dir);
    this.raycaster.far = range;
    const list = this.host.rayQuery ? this.host.rayQuery(origin, dir, range) : this.host.colliders;
    return this.raycaster.intersectObjects(list, false).length === 0;
  }

  protected steerViaNav(
    my: THREE.Vector3,
    goalX: number,
    goalY: number,
    goalZ: number,
    fallbackDirX: number,
    fallbackDirZ: number,
    dt: number,
  ): [number, number] {
    this.navTimer -= dt;
    if (this.host.findNavPath) {
      const goalMoved =
        Math.hypot(goalX - this.navGoal.x, goalZ - this.navGoal.z) > 1.5 ||
        Math.abs(goalY - this.navGoal.y) > 1.2;
      if (this.navTimer <= 0 || goalMoved || !this.navPath) {
        this.navTimer = 0.45 + Math.random() * 0.2;
        this.navGoal.set(goalX, goalY, goalZ);
        const path = this.host.findNavPath(my, this.navGoal);
        if (path && path.length >= 2) {
          this.navPath = path;
          this.navIdx = 1;
        } else {
          this.navPath = null;
        }
      }
      if (this.navPath && this.navIdx < this.navPath.length) {
        while (this.navIdx < this.navPath.length - 1) {
          const wp = this.navPath[this.navIdx];
          if (Math.hypot(wp.x - my.x, wp.z - my.z) < 1.15 && Math.abs(wp.y - my.y) < 1.5) {
            this.navIdx++;
          } else {
            break;
          }
        }
        const target = this.navPath[Math.min(this.navIdx, this.navPath.length - 1)];
        const ndx = target.x - my.x;
        const ndz = target.z - my.z;
        const nd = Math.hypot(ndx, ndz);
        if (nd > 0.15) {
          return this.steerAroundWalls(my, ndx / nd, ndz / nd);
        }
      }
    }
    return this.steerAroundWalls(my, fallbackDirX, fallbackDirZ);
  }

  private steerAroundWalls(my: THREE.Vector3, vx: number, vz: number): [number, number] {
    const len = Math.hypot(vx, vz);
    if (len < 0.001) return [0, 0];
    const nx = vx / len;
    const nz = vz / len;
    const probe = this.tmp.set(my.x, my.y + 1.0, my.z);
    if (this.isClearDir(probe, nx, nz, 2.2)) return [nx, nz];
    const angles = [0.65, -0.65, 1.25, -1.25, 1.9, -1.9];
    if (this.steerBias < 0) {
      for (let i = 0; i < angles.length; i += 2) {
        const t = angles[i];
        angles[i] = angles[i + 1];
        angles[i + 1] = t;
      }
    }
    for (const a of angles) {
      const ca = Math.cos(a);
      const sa = Math.sin(a);
      const rx = nx * ca - nz * sa;
      const rz = nx * sa + nz * ca;
      if (this.isClearDir(probe, rx, rz, 2.4)) return [rx, rz];
    }
    return [nx, nz];
  }

  /** does a clear line exist to the target (no world collider or living unit body in between)? */
  hasLineOfSight(from: THREE.Vector3, to: THREE.Vector3): boolean {
    const dir = this.losDir.copy(to).sub(from);
    const dist = dir.length();
    if (dist < 0.001) return true;
    dir.divideScalar(dist);
    this.raycaster.set(from, dir);
    this.raycaster.far = Math.max(0.05, dist - 0.05);
    const list = this.host.rayQuery ? this.host.rayQuery(from, dir, dist) : this.host.colliders;
    const hits = this.raycaster.intersectObjects(list, false);
    for (let i = 0; i < hits.length; i++) {
      if (hits[i].object.visible) return false;
    }
    // Unit-to-unit occlusion: prevent guards from seeing or shooting straight through teammates
    const units = this.host.enemies();
    for (let i = 0; i < units.length; i++) {
      const u = units[i] as Fighter;
      if (u === this || u.isDead || !u.rig) continue;
      const up = u.rig.root.position;
      const dx = up.x - from.x;
      const dy = up.y + 1.0 - from.y;
      const dz = up.z - from.z;
      const proj = dx * dir.x + dy * dir.y + dz * dir.z;
      if (proj <= 0.45 || proj >= dist - 0.45) continue;
      const cx = from.x + dir.x * proj - up.x;
      const cz = from.z + dir.z * proj - up.z;
      const cy = from.y + dir.y * proj - (up.y + 1.0);
      if (cx * cx + cz * cz <= 0.34 * 0.34 && Math.abs(cy) <= 0.85) {
        return false;
      }
    }
    return true;
  }

  protected eyePos(out: THREE.Vector3) {
    const r = this.rig.root.position;
    return out.set(r.x, r.y + 1.5, r.z);
  }

  protected onShoot(muzzle: THREE.Vector3) {
    this.host.sfx.shot(1.0, false, muzzle);
    this.broadcastGuardGunfire(muzzle);
    const diff = this.host.difficultyScale?.();
    const accBase = this.mission.enemyAccuracy * (diff?.accuracy ?? 1) * (this.role === "sniper" ? 1.15 : 1);
    const acc = Math.max(0.1, Math.min(0.95, accBase));
    const spreadRad = (this.role === "sniper" ? 0.006 : 0.012) + (1 - acc) * 0.085;
    const dir = this.tmp.copy(this.aimPoint).sub(muzzle);
    const baseDist = Math.max(0.5, dir.length());
    dir.divideScalar(baseDist);
    dir.x += (Math.random() - 0.5) * spreadRad;
    dir.y += (Math.random() - 0.5) * spreadRad * 0.7;
    dir.z += (Math.random() - 0.5) * spreadRad;
    dir.normalize();

    const maxRange = 120;
    this.raycaster.set(muzzle, dir);
    this.raycaster.far = maxRange;
    const list = this.host.rayQuery ? this.host.rayQuery(muzzle, dir, maxRange) : this.host.colliders;
    const hits = this.raycaster.intersectObjects(list, false);
    const coverHit = hits.find((h) => h.object.visible);
    const coverDist = coverHit ? coverHit.distance : maxRange;

    // Ballistic cylinder intersection against the player's actual body & stance height
    let playerHitDist = Infinity;
    if (this.host.playerAlive()) {
      const pEye = this.host.playerPos(this.tmp2);
      const toPlayer = this.tmp3.copy(pEye).sub(muzzle);
      const proj = toPlayer.dot(dir);
      if (proj > 0.3 && proj < coverDist) {
        const closest = this.tmp4.copy(muzzle).addScaledVector(dir, proj);
        const dx = closest.x - pEye.x;
        const dz = closest.z - pEye.z;
        const radialDist2 = dx * dx + dz * dz;
        const bodyMinY = pEye.y - (this.host.playerCrouching() ? 1.15 : 1.52);
        const bodyMaxY = pEye.y + 0.16;
        if (radialDist2 <= 0.42 * 0.42 && closest.y >= bodyMinY && closest.y <= bodyMaxY) {
          playerHitDist = proj;
        }
      }
    }

    if (playerHitDist < coverDist) {
      const end = this.tmp4.copy(muzzle).addScaledVector(dir, playerHitDist);
      this.host.fx.tracer(muzzle, end);
      const [dmin, dmax] = this.mission.enemyDamage;
      const diffDmg = this.host.difficultyScale?.().damage ?? 1;
      const roleDmg = this.role === "sniper" ? 1.28 : this.role === "heavy" ? 1.12 : 1;
      this.host.onPlayerHit((dmin + Math.random() * (dmax - dmin)) * diffDmg * roleDmg);
    } else if (coverHit) {
      this.host.fx.tracer(muzzle, coverHit.point);
      const n = coverHit.face
        ? this.tmp4.copy(coverHit.face.normal).transformDirection(coverHit.object.matrixWorld)
        : this.tmp4.set(0, 1, 0);
      this.host.fx.impact(coverHit.point, n, (coverHit.object.userData.kind as "concrete" | "metal" | "dirt") ?? "concrete");
    } else {
      const end = this.tmp4.copy(muzzle).addScaledVector(dir, Math.min(maxRange, baseDist + 14));
      this.host.fx.tracer(muzzle, end);
    }
  }

  /** Multi-point head/chest visibility test against world cover so low obstacles don't make crouched/standing players invisible. */
  private checkPlayerVisibility(
    eye: THREE.Vector3,
    playerEye: THREE.Vector3,
    crouch: boolean,
    outAimTarget: THREE.Vector3,
  ): number {
    // host.playerPos() already returns world-space eye height (r.y + 1.62 standing, r.y + 1.20 crouching)
    const headY = playerEye.y - 0.04;
    const chestY = playerEye.y - (crouch ? 0.34 : 0.42);

    const chestPt = this.tmp3.set(playerEye.x, chestY, playerEye.z);
    const seeChest = this.hasLineOfSight(eye, chestPt);
    const headPt = this.tmp4.set(playerEye.x, headY, playerEye.z);
    const seeHead = this.hasLineOfSight(eye, headPt);

    if (seeChest && seeHead) {
      outAimTarget.set(playerEye.x, chestY + 0.08, playerEye.z);
      return 1.0;
    }
    if (seeHead) {
      outAimTarget.set(playerEye.x, headY - 0.06, playerEye.z);
      return 0.65;
    }
    if (seeChest) {
      outAimTarget.set(playerEye.x, chestY, playerEye.z);
      return 0.68;
    }
    return 0;
  }

  /** Scan forward vision cone & immediate vicinity for downed squadmates; radios compound if found. */
  private scanForDownedBodies(eye: THREE.Vector3) {
    const fwdX = Math.sin(this.rig.aimYaw);
    const fwdZ = Math.cos(this.rig.aimYaw);
    for (const e of this.host.enemies()) {
      if ((e as Fighter) === this || !e.isDead || e.bodyDiscovered) continue;
      const bp = e.rig.root.position;
      const dx = bp.x - eye.x;
      const dz = bp.z - eye.z;
      const d = Math.hypot(dx, dz);
      if (d > 24) continue;
      const dot = d > 0.01 ? (dx / d) * fwdX + (dz / d) * fwdZ : 1;
      if (dot < 0.08 && d > 6.5) continue;
      const bodyPt = this.tmp3.set(bp.x, bp.y + 0.45, bp.z);
      if (d < 4.5 || this.hasLineOfSight(eye, bodyPt)) {
        e.bodyDiscovered = true;
        this.lastSeen.copy(bp);
        this.searchTimer = Math.max(this.searchTimer, 6.5);
        this.alertFrom(bp, 0.14, 0.85);
        this.broadcastComms("body", bp, 95, 0.78);
        break;
      }
    }
  }

  /** shared AI brain for enemies (ally overrides targeting/fire) */
  protected aiUpdate(dt: number, opts: { prefDist: number; burstSize: number; canFire: boolean }) {
    const rig = this.rig;
    const host = this.host;
    const my = rig.root.position;
    const p = host.playerPos(this.tmp);
    const dx = p.x - my.x;
    const dz = p.z - my.z;
    const dist = Math.hypot(dx, dz);
    const perched = (this.spawn.y ?? 0) > 1.2;

    if (this.reloadDelay > 0) this.reloadDelay = Math.max(0, this.reloadDelay - dt);
    if (this.coverTimer > 0) this.coverTimer = Math.max(0, this.coverTimer - dt);
    if (this.alertDelay > 0) this.alertDelay = Math.max(0, this.alertDelay - dt);
    if (this.hearingCooldown > 0) this.hearingCooldown = Math.max(0, this.hearingCooldown - dt);
    if (this.commsCooldown > 0) this.commsCooldown = Math.max(0, this.commsCooldown - dt);
    if (this.shotCommsCooldown > 0) this.shotCommsCooldown = Math.max(0, this.shotCommsCooldown - dt);

    // ---- enhanced stealth vision: foveal + peripheral cones, multi-point head/chest LOS, flashlight & perch range
    const crouch = host.playerCrouching();
    const sprint = host.playerSprinting();
    const rangeMult = host.playerVisionRangeMult?.() ?? 1;
    const detectMult = host.playerDetectMult?.() ?? 1;

    const fwdX = Math.sin(rig.aimYaw);
    const fwdZ = Math.cos(rig.aimYaw);
    const dot = dist > 0.001 ? (dx / dist) * fwdX + (dz / dist) * fwdZ : 1;

    // Night flashlight beam extends forward reach in narrow cone, while darkness trims unlit ambient sight
    const inFlashBeam = !!this.flashlightMount && dot >= 0.86;
    const nightMult = this.mission.night ? (inFlashBeam ? 1.32 : 0.82) : 1.0;
    const perchMult = perched ? 1.28 : 1.0;
    const roleMult = this.role === "sniper" ? 1.45 : this.role === "heavy" ? 0.92 : 1.0;
    const diffVision = host.difficultyScale?.().vision ?? 1.0;

    const baseFoveal = this.state === "attack" ? 46 : crouch ? 20 : sprint ? 40 : 31;
    const fovealRange = baseFoveal * (this.state === "attack" ? 1 : rangeMult) * nightMult * perchMult * roleMult * diffVision;
    const periphRange = fovealRange * 0.64;

    const inFoveal = dot >= (this.state === "attack" ? -0.3 : this.state === "alert" ? 0.34 : 0.58) && dist < fovealRange;
    const inPeriph = !inFoveal && dot >= (this.state === "alert" ? -0.05 : 0.14) && dist < periphRange;
    const tooClose = dist < (crouch ? 1.35 : 2.65);

    const verticalDelta = Math.abs(p.y - (my.y + 1.5));
    const verticalOk = dist < 4 || verticalDelta / dist < (perched ? 2.4 : 1.35);

    const eye = this.eyePos(this.tmp2);
    let exposure = 0;
    const visibleAim = this.tmp4.set(p.x, p.y - (crouch ? 0.34 : 0.4), p.z);
    if ((inFoveal || inPeriph || tooClose) && verticalOk && host.playerAlive()) {
      exposure = this.checkPlayerVisibility(eye, p, crouch, visibleAim);
    }
    const sees = exposure > 0;

    // Staggered corpse discovery scan while unaware or investigating
    if (!sees && this.state !== "attack") {
      this.bodyScanTimer -= dt;
      if (this.bodyScanTimer <= 0) {
        this.bodyScanTimer = 0.42;
        this.scanForDownedBodies(eye);
      }
    }

    if (sees) {
      this.lastSeen.copy(visibleAim);
      this.searchTimer = 0;
      const stanceMult = crouch ? 0.68 : sprint ? 1.75 : 1.12;
      const distMult = clamp(1.55 - dist / fovealRange, 0.42, 1.55);
      const coneMult = inFoveal || tooClose ? clamp(0.75 + Math.max(0, dot) * 0.55, 0.7, 1.3) : 0.48;
      const closeBoost = tooClose ? 3.2 : 1.0;
      const rate = (this.state === "attack" ? 2.6 : 1.3 * detectMult) * stanceMult * distMult * coneMult * exposure * closeBoost;
      this.suspicion = Math.min(1, this.suspicion + rate * dt);

      if (this.suspicion >= 0.36 && (this.state === "idle" || this.state === "patrol")) {
        this.state = "alert";
        this.alertDelay = 0.14;
      }
      if (this.suspicion >= 1.0 && this.state !== "attack") {
        this.state = "attack";
        if (!this.alerted) {
          this.alerted = true;
          host.onAlert(this);
        }
        this.burstTimer = Math.max(this.burstTimer, 0.36 + (1 - this.mission.enemyAccuracy) * 0.30);
        this.broadcastComms("contact", this.lastSeen, 54, 0.84);
      } else if (this.state === "attack" && this.commsCooldown <= 0) {
        // Keep squadmates updated with target coordinates over radio during active firefights
        this.broadcastComms("contact", this.lastSeen, 44, 0.76);
      }
      this.sightLost = 0;
    } else {
      const decayRate = this.state === "attack" ? 0.11 : this.searchTimer > 0 ? 0.08 : 0.22;
      this.suspicion = Math.max(0, this.suspicion - decayRate * dt);
      if (this.state === "attack") {
        this.sightLost += dt;
        // lose pursuit if player breaks line-of-sight and vanishes
        if (this.sightLost > 7.2) {
          this.state = "alert";
          this.suspicion = 0.6;
          this.searchTimer = 3.6;
        }
      }
    }
    this.wasSeeing = sees;
    void this.wasSeeing;

    // ---- movement
    let mvx = 0;
    let mvz = 0;
    const holdPerch = perched && (this.spawn.mode === "guard" || this.boss);

    if (this.state === "idle" && this.spawn.mode === "patrol" && this.spawn.patrol) {
      this.state = "patrol";
    }

    if (this.state === "patrol" && this.spawn.patrol) {
      const wp = this.spawn.patrol[this.patrolIdx % this.spawn.patrol.length];
      const wdx = wp[0] - my.x;
      const wdz = wp[1] - my.z;
      const wd = Math.hypot(wdx, wdz);
      if (wd < 1.3) {
        this.patrolIdx++;
      } else {
        [mvx, mvz] = this.steerViaNav(my, wp[0], my.y, wp[1], wdx / wd, wdz / wd, dt);
      }
    } else if (this.state === "alert" && this.alertDelay <= 0) {
      if (holdPerch) {
        // Elevated guards sweep toward lastSeen without stepping off perch
        if (this.searchTimer <= 0) {
          this.searchTimer = 2.6;
          this.searchYaw = Math.atan2(this.lastSeen.x - my.x, this.lastSeen.z - my.z);
        }
        this.searchTimer -= dt;
        if (this.searchTimer <= 0 && this.suspicion < 0.2) {
          this.state = "idle";
        }
      } else if (this.searchTimer > 0) {
        // Reached investigation point: hold and scan left/right before standing down
        this.searchTimer -= dt;
        if (this.searchTimer <= 0) {
          this.state = this.spawn.mode === "patrol" ? "patrol" : "idle";
        }
      } else {
        const ldx = this.lastSeen.x - my.x;
        const ldz = this.lastSeen.z - my.z;
        const ld = Math.hypot(ldx, ldz);
        if (ld < 2.0) {
          this.searchTimer = 3.4;
          this.searchYaw = ld > 0.2 ? Math.atan2(ldx, ldz) : rig.aimYaw;
        } else {
          // advance/roam units flank slightly around corners instead of marching single-file
          const flankAng = this.spawn.mode === "advance" ? this.flankSign * 0.45 : 0;
          const ca = Math.cos(flankAng);
          const sa = Math.sin(flankAng);
          const fx = (ldx / ld) * ca - (ldz / ld) * sa;
          const fz = (ldx / ld) * sa + (ldz / ld) * ca;
          [mvx, mvz] = this.steerViaNav(my, this.lastSeen.x, this.lastSeen.y, this.lastSeen.z, fx, fz, dt);
        }
      }
    } else if (this.state === "attack") {
      const pref = opts.prefDist;
      const dirX = dist > 0.001 ? dx / dist : 0;
      const dirZ = dist > 0.001 ? dz / dist : 1;
      const perpX = -dirZ * this.strafeSign;
      const perpZ = dirX * this.strafeSign;

      if (holdPerch) {
        // sniper / elevated guard: small lateral peek jiggle without walking off rooftop
        this.strafeTimer -= dt;
        if (this.strafeTimer <= 0) {
          this.strafeSign *= -1;
          this.strafeTimer = 1.4 + Math.random() * 1.4;
        }
        const ox = my.x - this.spawn.x;
        const oz = my.z - this.spawn.z;
        if (Math.hypot(ox, oz) > 2.2) {
          mvx = -ox;
          mvz = -oz;
        } else {
          mvx = perpX * 0.45;
          mvz = perpZ * 0.45;
        }
      } else if (this.coverTimer > 0 || rig.isReloading) {
        // duck/strafe into lateral cover while taking fire or reloading
        [mvx, mvz] = this.steerAroundWalls(my, perpX * 0.9 - dirX * 0.35, perpZ * 0.9 - dirZ * 0.35);
      } else if (!sees) {
        // lost sight: guards hold angle briefly (1.8s), advance/patrol units push & flank!
        if (this.spawn.mode !== "guard" || this.sightLost > 1.8) {
          const ldx = this.lastSeen.x - my.x;
          const ldz = this.lastSeen.z - my.z;
          const ld = Math.hypot(ldx, ldz);
          if (ld > 1.5) {
            const flankAng = this.spawn.mode === "advance" ? this.flankSign * 0.55 : this.flankSign * 0.25;
            const ca = Math.cos(flankAng);
            const sa = Math.sin(flankAng);
            const fx = (ldx / ld) * ca - (ldz / ld) * sa;
            const fz = (ldx / ld) * sa + (ldz / ld) * ca;
            [mvx, mvz] = this.steerViaNav(my, this.lastSeen.x, this.lastSeen.y, this.lastSeen.z, fx, fz, dt);
          }
        }
      } else if (dist > pref + 3.5) {
        const flankPush = this.spawn.mode === "advance" ? 0.5 : 0.25;
        [mvx, mvz] = this.steerViaNav(my, p.x, p.y, p.z, dirX + perpX * flankPush, dirZ + perpZ * flankPush, dt);
      } else if (dist < pref - 3.5) {
        [mvx, mvz] = this.steerAroundWalls(my, -dirX * 0.8 + perpX * 0.55, -dirZ * 0.8 + perpZ * 0.55);
      } else {
        // active CS2 counter-strafe peek
        this.strafeTimer -= dt;
        if (this.strafeTimer <= 0) {
          this.strafeSign *= -1;
          this.strafeTimer = 1.0 + Math.random() * 1.4;
        }
        [mvx, mvz] = this.steerAroundWalls(my, perpX, perpZ);
      }

      // burst fire (with controlled pacing & reload awareness)
      const fireRange = this.role === "sniper" ? 64 : 42;
      if (opts.canFire && sees && dist < fireRange && !rig.isReloading) {
        this.burstTimer -= dt;
        if (this.burstTimer <= 0 && !rig.dead) {
          rig.fire();
          this.burstShots++;
          if (this.burstShots >= opts.burstSize) {
            this.burstTimer = 0.85 + (1 - this.mission.enemyAccuracy) * 1.1 + Math.random() * 0.6;
            this.burstShots = 0;
          } else {
            this.burstTimer = 0.18;
          }
        }
      }
    }

    // ---- anti-stuck steering recovery
    if (Math.hypot(mvx, mvz) > 0.2) {
      if (my.distanceToSquared(this.prevPos) < 0.0004) {
        this.stuckTimer += dt;
        if (this.stuckTimer > 0.55) {
          this.steerBias *= -1;
          this.flankSign *= -1;
          this.stuckTimer = 0;
        }
      } else {
        this.stuckTimer = 0;
      }
    }
    this.prevPos.copy(my);

    // ---- aim at player (or investigation / search sweep / sentinel sweep)
    const aimTarget = sees ? visibleAim : this.state === "alert" || this.state === "attack" ? this.lastSeen : null;
    if (aimTarget) {
      const adx = aimTarget.x - my.x;
      const adz = aimTarget.z - my.z;
      const ad = Math.hypot(adx, adz) || 1;
      let targetYaw = Math.atan2(adx / ad, adz / ad);
      if (!sees && this.state === "alert" && this.searchTimer > 0) {
        this.yawSweep += dt * 1.9;
        targetYaw = this.searchYaw + Math.sin(this.yawSweep) * 1.1;
      }
      const turnRate = this.state === "attack" ? 11.5 : 6.8;
      rig.aimYaw = stepYaw(rig.aimYaw, targetYaw, turnRate * dt);
      const targetY = Math.max(aimTarget.y, my.y + 0.65);
      const dy = targetY - (my.y + 1.5);
      rig.aimPitch = !sees && this.state === "alert" && this.searchTimer > 0 ? -0.05 : Math.atan2(dy, ad);
      if (!sees && this.state === "alert" && this.searchTimer > 0) {
        rig.aimPoint.set(my.x + Math.sin(rig.aimYaw) * 14, my.y + 1.25, my.z + Math.cos(rig.aimYaw) * 14);
        this.aimPoint.copy(rig.aimPoint);
      } else {
        rig.aimPoint.set(aimTarget.x, targetY, aimTarget.z);
        this.aimPoint.copy(rig.aimPoint);
      }
    } else if (this.state === "patrol" && (mvx !== 0 || mvz !== 0)) {
      this.yawSweep += dt * 1.1;
      const targetYaw = Math.atan2(mvx, mvz) + Math.sin(this.yawSweep) * 0.24;
      rig.aimYaw = stepYaw(rig.aimYaw, targetYaw, 4.2 * dt);
      rig.aimPitch = -0.05;
      rig.aimPoint.set(my.x + Math.sin(rig.aimYaw) * 18, my.y + 1.25, my.z + Math.cos(rig.aimYaw) * 18);
    } else {
      this.yawSweep += dt * 0.65;
      const targetYaw = this.baseYaw + Math.sin(this.yawSweep) * 0.65;
      rig.aimYaw = stepYaw(rig.aimYaw, targetYaw, 3.2 * dt);
      rig.aimPitch = -0.05;
      rig.aimPoint.set(my.x + Math.sin(rig.aimYaw) * 18, my.y + 1.25, my.z + Math.cos(rig.aimYaw) * 18);
    }

    if (this.boss && !this.bossEngaged && this.state === "attack") {
      this.bossEngaged = true;
      this.host.onBossEngage?.(this);
    }
    if (this.sniperLaser) {
      this.sniperLaser.visible = !this.dead && (this.state === "alert" || this.state === "attack");
    }

    const mv = rig.input.move;
    mv.set(mvx, 0, mvz);
    if (mv.lengthSq() > 0.0004) mv.normalize();
    if (this.role === "heavy") mv.multiplyScalar(0.76);
    rig.input.sprint = this.role !== "heavy" && (this.state === "attack" || this.state === "alert") && !sees && dist > 14 && !holdPerch;
    rig.input.crouch =
      this.coverTimer > 0 ||
      rig.isReloading ||
      (this.state === "attack" && sees && dist < 24 && Math.hypot(mvx, mvz) < 0.35);
    rig.input.ads = this.state === "attack" || this.state === "alert";
    const gy = host.groundHeightAt(my.x, my.z, my.y);
    rig.update(dt, gy);
    resolveCircleAABBs(my, 0.55, host.spatialAABBs ?? host.aabbs, rig.stepHeight);
  }
}

/* ------------------------------------------------------------------ */
export class Enemy extends Fighter {
  constructor(host: CombatHost, spawn: EnemySpawn, mission: MissionDef) {
    const boss = !!spawn.boss;
    const diffHp = host.difficultyScale?.().hp ?? 1;
    const roleHp = spawn.role === "heavy" ? 1.65 : spawn.role === "sniper" ? 0.85 : 1;
    const baseHp = boss ? (spawn.name && BOSS_HP[spawn.name] ? BOSS_HP[spawn.name] : mission.enemyHp * 2) : mission.enemyHp;
    super(host, spawn, mission, Math.round(baseHp * roleHp * diffHp), boss);
  }

  update(dt: number) {
    if (this.dead) {
      const my = this.rig.root.position;
      const gy = this.host.groundHeightAt(my.x, my.z, my.y);
      this.rig.update(dt, gy);
      return;
    }
    this.aiUpdate(dt, {
      prefDist: this.boss ? 13 : this.role === "sniper" ? 22 : this.role === "heavy" ? 6.5 : 9,
      burstSize: this.boss ? 4 : this.role === "sniper" ? 1 : this.role === "heavy" ? 5 : 3,
      canFire: true,
    });
  }
}

/* ------------------------------------------------------------------ */
export class Ally extends Fighter {
  private fireTimer = 0;

  constructor(host: CombatHost, x: number, z: number, y = 0) {
    super(
      host,
      { x, z, y, mode: "guard" },
      { ...host.mission, enemyAccuracy: 0.62, enemyDamage: [5, 9] },
      100000, // invulnerable
      false,
    );
    this.name = "Brick";
  }

  update(dt: number) {
    if (this.dead) {
      const my = this.rig.root.position;
      const gy = this.host.groundHeightAt(my.x, my.z, my.y);
      this.rig.update(dt, gy);
      return;
    }
    const rig = this.rig;
    const host = this.host;
    const my = rig.root.position;
    const p = host.playerPos(this.tmp);

    // ---- follow the player at a support distance
    const dx = p.x - my.x;
    const dz = p.z - my.z;
    const dist = Math.hypot(dx, dz);
    let mvx = 0;
    let mvz = 0;
    if (dist > 14) {
      [mvx, mvz] = this.steerViaNav(my, p.x, p.y, p.z, dx / dist, dz / dist, dt);
    } else if (dist < 8.5) {
      mvx = -dx / dist * 0.7;
      mvz = -dz / dist * 0.7;
    } else {
      // hold position, drift to the opposite side of the player from enemies
      mvx = -dz / dist * 0.5;
      mvz = dx / dist * 0.5;
    }
    const mv = rig.input.move;
    mv.set(mvx, 0, mvz);
    if (mv.lengthSq() > 0.0004) mv.normalize();
    rig.input.sprint = dist > 16;
    const combatActive = host.enemies().some((e) => !e.isDead && e.state === "attack");
    rig.input.crouch = !combatActive && host.playerCrouching();
    rig.input.ads = combatActive;

    // ---- engage alerted enemies only so stealth approaches aren't blown
    let target: Enemy | null = null;
    let bestD = 40;
    if (combatActive) {
      for (const e of host.enemies()) {
        if (e.isDead) continue;
        const d = Math.hypot(e.rig.root.position.x - my.x, e.rig.root.position.z - my.z);
        const effD = e.state === "attack" ? d : d + 12;
        if (effD < bestD && this.hasLineOfSight(this.eyePos(this.tmp2), e.rig.root.position.clone().setY(e.rig.root.position.y + 1.2))) {
          bestD = effD;
          target = e;
        }
      }
    }
    if (target) {
      const ex = target.rig.root.position.x;
      const ez = target.rig.root.position.z;
      const tdx = ex - my.x;
      const tdz = ez - my.z;
      const td = Math.hypot(tdx, tdz);
      if (td > 0.001) {
        rig.aimYaw = Math.atan2(tdx / td, tdz / td);
        rig.aimPitch = Math.atan2(target.rig.root.position.y + 1.2 - (my.y + 1.5), td);
        rig.aimPoint.set(ex, target.rig.root.position.y + 1.2, ez);
        this.aimPoint.set(ex, target.rig.root.position.y + 1.2, ez);
      }
      this.fireTimer -= dt;
      if (this.fireTimer <= 0 && !rig.dead) {
        rig.fire();
        this.fireTimer = 0.3;
      }
    } else {
      // aim along the player's facing
      rig.aimYaw = Math.atan2(dx / (dist || 1), dz / (dist || 1));
      rig.aimPitch = 0;
      rig.aimPoint.set(p.x, 1.4, p.z);
    }

    const gy = host.groundHeightAt(my.x, my.z, my.y);
    rig.update(dt, gy);
    resolveCircleAABBs(my, 0.55, host.spatialAABBs ?? host.aabbs, rig.stepHeight);
  }

  protected onShoot(muzzle: THREE.Vector3) {
    this.host.sfx.shot(1.0, false, muzzle);
    const target = this.aimPoint.clone();
    const spread = 0.05;
    target.x += (Math.random() - 0.5) * spread * 9;
    target.y += (Math.random() - 0.5) * spread * 5;
    target.z += (Math.random() - 0.5) * spread * 9;
    this.host.fx.tracer(muzzle, target);
    // find the enemy nearest to the aim point and damage it
    let best: Enemy | null = null;
    let bestD = 2.2;
    for (const e of this.host.enemies()) {
      if (e.isDead) continue;
      const d = Math.hypot(e.rig.root.position.x - target.x, e.rig.root.position.z - target.z);
      if (d < bestD) {
        bestD = d;
        best = e;
      }
    }
    if (best && Math.random() < 0.75) {
      best.takeDamage(5 + Math.random() * 5);
    } else {
      this.host.fx.impact(target, new THREE.Vector3(0, 1, 0), "concrete");
    }
  }
}

/* ------------------------------------------------------------------ */
export class RescueNPC {
  rig!: SoldierRig;
  rescued = false;

  constructor(readonly x: number, readonly z: number, readonly y = 0) {}

  async build(scene: THREE.Object3D, tint: [number, number]) {
    const modelUrl = typeof window !== "undefined" ? characterUrl("civilian") : undefined;
    this.rig = await SoldierRig.load(scene, undefined, modelUrl);
    if (!this.rig.isRocketbox) {
      this.rig.setTint(tint[0], tint[1]);
      this.rig.equipment?.setVisible(false);
    }
    this.rig.setHeightScale(0.97);
    this.rig.root.position.set(this.x, this.y, this.z);
    scene.add(this.rig.root);
  }

  update(dt: number) {
    this.rig.update(dt, this.y);
  }
}
