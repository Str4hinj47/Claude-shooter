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
import type { EnemySpawn, MissionDef } from "./story";
import { BOSS_HP } from "./story";

export interface CombatHost {
  colliders: THREE.Object3D[];
  aabbs: THREE.Box3[];
  groundHeightAt: (x: number, z: number, y: number) => number;
  fx: CombatFX;
  sfx: Sfx;
  playerPos: (out: THREE.Vector3) => THREE.Vector3;
  playerAlive: () => boolean;
  playerCrouching: () => boolean;
  playerSprinting: () => boolean;
  playerDetectMult?: () => number;
  playerVisionRangeMult?: () => number;
  onPlayerHit: (dmg: number) => void;
  onKilled: (e: Fighter, stealth?: boolean) => void;
  onAlert: (e: Fighter) => void;
  enemies: () => Enemy[];
  mission: MissionDef;
}

/** circle-vs-AABB push-out used for player & enemy movement.
 *  When a body bumps a surface whose top is within `step` metres above the feet,
 *  the body is lifted onto it (stairs / low ledges) instead of being shoved back. */
export function resolveCircleAABBs(pos: THREE.Vector3, radius: number, aabbs: THREE.Box3[], step = 0) {
  const bodyTop = pos.y + 1.8;
  for (const b of aabbs) {
    if (bodyTop <= b.min.y + 0.02 || pos.y >= b.max.y - 0.03) continue; // no vertical overlap (standing on/above top)
    const cx = clamp(pos.x, b.min.x, b.max.x);
    const cz = clamp(pos.z, b.min.z, b.max.z);
    const dx = pos.x - cx;
    const dz = pos.z - cz;
    const d2 = dx * dx + dz * dz;
    if (d2 >= radius * radius || d2 < 1e-6) continue;
    const d = Math.sqrt(d2);
    // step-up: a low ledge in front — lift the body onto its top rather than blocking
    if (step > 0) {
      const top = b.max.y;
      const rise = top - pos.y;
      if (rise > 0.02 && rise <= step + 0.1) {
        pos.y = top;
        continue; // consumed this AABB (standing on it); no horizontal push
      }
    }
    const push = (radius - d) / d;
    pos.x += dx * push;
    pos.z += dz * push;
  }
}

type AIState = "idle" | "patrol" | "alert" | "attack" | "dead";

export class Fighter {
  rig!: SoldierRig;
  readonly hitbox: THREE.Mesh;
  state: AIState = "idle";
  hp = 100;
  readonly maxHp: number;
  readonly boss: boolean;
  name: string;
  protected readonly spawn: EnemySpawn;
  protected readonly mission: MissionDef;
  protected readonly host: CombatHost;
  protected dead = false;
  alerted = false;
  suspicion = 0;
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
  private strafeSign = Math.random() < 0.5 ? 1 : -1;
  private strafeTimer = 1.4 + Math.random() * 1.4;
  private flankSign = Math.random() < 0.5 ? 1 : -1;
  private coverTimer = 0;
  private alertDelay = 0;
  private wasSeeing = false;
  private baseYaw = Math.random() * Math.PI * 2;
  private yawSweep = Math.random() * Math.PI * 2;
  private prevPos = new THREE.Vector3();
  private stuckTimer = 0;
  private steerBias = 1;

  constructor(host: CombatHost, spawn: EnemySpawn, mission: MissionDef, hp: number, boss: boolean) {
    this.host = host;
    this.spawn = spawn;
    this.mission = mission;
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
  }

  async build(scene: THREE.Object3D, tint: [number, number], heightScale = 1) {
    this.rig = await SoldierRig.load(scene);
    this.rig.setTint(tint[0], tint[1]);
    this.rig.setHeightScale(heightScale);
    this.rig.root.position.set(this.spawn.x, this.spawn.y ?? 0, this.spawn.z);
    // Point idle guards toward the center/player approach initially, with natural sentinel sweep
    this.baseYaw = Math.atan2(-this.spawn.x, -this.spawn.z) + (Math.random() - 0.5) * 0.8;
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
  }

  get isDead() {
    return this.dead;
  }

  get isUnaware() {
    return this.state === "idle" || this.state === "patrol";
  }

  takeDamage(dmg: number, suppressed = false) {
    if (this.dead) return;
    const unaware = this.isUnaware || (this.state === "alert" && this.suspicion < 0.85);
    const effectiveDmg = unaware ? dmg * 2.5 : dmg;
    this.hp -= effectiveDmg;
    this.rig.hit(0);
    if (this.hp <= 0) {
      this.dead = true;
      this.state = "dead";
      this.suspicion = 0;
      this.rig.die(Math.random() < 0.5 ? "back" : "front");
      this.hitbox.visible = false;
      this.hitbox.position.y = -50; // belt-and-braces off the raycast path
      // Silent kill if enemy was unaware & killed with a suppressed weapon or takedown
      if (!unaware || !suppressed) {
        const p = this.host.playerPos(this.tmp);
        this.broadcastAlert(p, suppressed ? 6 : 16);
      }
      this.host.onKilled(this, unaware && suppressed);
      return;
    }
    // Survived the hit: seek cover, investigate/engage shooter, alert nearby squadmates
    this.coverTimer = Math.max(this.coverTimer, 1.1 + Math.random() * 0.8);
    this.strafeSign = Math.random() < 0.5 ? 1 : -1;
    const p = this.host.playerPos(this.tmp);
    this.suspicion = Math.max(this.suspicion, suppressed ? 0.88 : 1.0);
    this.alertFrom(p, 0.08);
    this.broadcastAlert(p, suppressed ? 7 : 18);
  }

  /** Receive a sound/callout alert from footsteps, gunfire, or a nearby teammate */
  alertFrom(pos: THREE.Vector3, delay = 0.25, boost = 0.5) {
    if (this.dead) return;
    this.lastSeen.copy(pos);
    this.suspicion = Math.max(this.suspicion, boost);
    if (this.state === "idle" || this.state === "patrol") {
      this.state = "alert";
      this.alertDelay = delay;
      this.sightLost = 0;
    }
  }

  /** Radio/shout callout to nearby teammates */
  protected broadcastAlert(pos: THREE.Vector3, radius: number) {
    const my = this.rig.root.position;
    for (const e of this.host.enemies()) {
      if ((e as Fighter) === this || e.isDead) continue;
      const d = Math.hypot(e.rig.root.position.x - my.x, e.rig.root.position.z - my.z);
      if (d <= radius) {
        e.alertFrom(pos, 0.25 + (d / radius) * 0.45);
      }
    }
  }

  /** Short forward/angled ray probe against world colliders so bots steer around walls & doorways */
  private isClearDir(origin: THREE.Vector3, dirX: number, dirZ: number, range = 2.3): boolean {
    const dir = this.tmp2.set(dirX, 0, dirZ).normalize();
    this.raycaster.set(origin, dir);
    this.raycaster.far = range;
    return this.raycaster.intersectObjects(this.host.colliders, false).length === 0;
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

  /** does a clear line exist to the target (no world collider in between)? */
  hasLineOfSight(from: THREE.Vector3, to: THREE.Vector3): boolean {
    const dir = this.tmp2.copy(to).sub(from);
    const dist = dir.length();
    if (dist < 0.001) return true;
    dir.divideScalar(dist);
    this.raycaster.set(from, dir);
    this.raycaster.far = dist + 0.5;
    const hits = this.raycaster.intersectObjects(this.host.colliders, false);
    return hits.length === 0;
  }

  protected eyePos(out: THREE.Vector3) {
    const r = this.rig.root.position;
    return out.set(r.x, r.y + 1.5, r.z);
  }

  protected onShoot(muzzle: THREE.Vector3) {
    this.host.sfx.shot();
    // tracer to the aim point with accuracy-driven spread
    const spread = 0.05 + (1 - this.mission.enemyAccuracy) * 0.4;
    const target = this.aimPoint.clone();
    target.x += (Math.random() - 0.5) * spread * 9;
    target.y += (Math.random() - 0.5) * spread * 5;
    target.z += (Math.random() - 0.5) * spread * 9;
    this.host.fx.tracer(muzzle, target);
    if (Math.random() < this.mission.enemyAccuracy) {
      const [dmin, dmax] = this.mission.enemyDamage;
      this.host.onPlayerHit(dmin + Math.random() * (dmax - dmin));
    } else {
      this.host.fx.impact(target, new THREE.Vector3(0, 1, 0), "concrete");
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

    // ---- stealth detection: directional vision cone + stance range + suspicion meter
    const crouch = host.playerCrouching();
    const sprint = host.playerSprinting();
    const rangeMult = host.playerVisionRangeMult?.() ?? 1;
    const detectMult = host.playerDetectMult?.() ?? 1;
    const maxRange = (this.state === "attack" ? 36 : crouch ? 16.5 : sprint ? 32 : 25) * (this.state === "attack" ? 1 : rangeMult);
    const fwdX = Math.sin(rig.aimYaw);
    const fwdZ = Math.cos(rig.aimYaw);
    const dot = dist > 0.001 ? (dx / dist) * fwdX + (dz / dist) * fwdZ : 1;
    const minDot = this.state === "attack" ? -0.25 : this.state === "alert" ? 0.2 : 0.52;
    const tooClose = dist < (crouch ? 1.25 : 2.3);
    const inCone = (dot >= minDot || tooClose) && dist < maxRange;
    const sees = inCone && host.playerAlive() && this.hasLineOfSight(this.eyePos(this.tmp2), p);

    if (sees) {
      this.lastSeen.copy(p);
      const stanceMult = crouch ? 0.65 : sprint ? 1.65 : 1.05;
      const distMult = clamp(1.5 - dist / maxRange, 0.4, 1.5);
      const angleMult = clamp(0.65 + Math.max(0, dot) * 0.6, 0.6, 1.25);
      const rate = (this.state === "attack" ? 2.4 : 1.15 * detectMult) * stanceMult * distMult * angleMult;
      this.suspicion = Math.min(1, this.suspicion + rate * dt);

      if (this.suspicion >= 0.42 && (this.state === "idle" || this.state === "patrol")) {
        this.state = "alert";
        this.alertDelay = 0.2;
      }
      if (this.suspicion >= 1.0 && this.state !== "attack") {
        this.state = "attack";
        if (!this.alerted) {
          this.alerted = true;
          host.onAlert(this);
        }
        this.burstTimer = Math.max(this.burstTimer, 0.25 + (1 - this.mission.enemyAccuracy) * 0.3);
        this.broadcastAlert(p, 16);
      }
      this.sightLost = 0;
    } else {
      this.suspicion = Math.max(0, this.suspicion - (this.state === "attack" ? 0.13 : 0.26) * dt);
      if (this.state === "attack") {
        this.sightLost += dt;
        // lose pursuit if player breaks line-of-sight and vanishes
        if (this.sightLost > 6.5) {
          this.state = "alert";
          this.suspicion = 0.55;
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
        [mvx, mvz] = this.steerAroundWalls(my, wdx / wd, wdz / wd);
      }
    } else if (this.state === "alert" && this.alertDelay <= 0 && !holdPerch) {
      const ldx = this.lastSeen.x - my.x;
      const ldz = this.lastSeen.z - my.z;
      const ld = Math.hypot(ldx, ldz);
      if (ld < 1.8) {
        this.state = this.spawn.mode === "patrol" ? "patrol" : "idle";
      } else {
        // advance/roam units flank slightly around corners instead of marching single-file
        const flankAng = this.spawn.mode === "advance" ? this.flankSign * 0.45 : 0;
        const ca = Math.cos(flankAng);
        const sa = Math.sin(flankAng);
        const fx = (ldx / ld) * ca - (ldz / ld) * sa;
        const fz = (ldx / ld) * sa + (ldz / ld) * ca;
        [mvx, mvz] = this.steerAroundWalls(my, fx, fz);
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
            [mvx, mvz] = this.steerAroundWalls(my, fx, fz);
          }
        }
      } else if (dist > pref + 3.5) {
        const flankPush = this.spawn.mode === "advance" ? 0.5 : 0.25;
        [mvx, mvz] = this.steerAroundWalls(my, dirX + perpX * flankPush, dirZ + perpZ * flankPush);
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
      if (opts.canFire && sees && dist < 42 && !rig.isReloading) {
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

    // ---- aim at player (or patrol heading / sentinel sweep when unaware!)
    const aimTarget = sees ? p : this.state === "alert" || this.state === "attack" ? this.lastSeen : null;
    if (aimTarget && dist > 0.001) {
      const adx = aimTarget.x - my.x;
      const adz = aimTarget.z - my.z;
      const ad = Math.hypot(adx, adz) || 1;
      rig.aimYaw = Math.atan2(adx / ad, adz / ad);
      const dy = aimTarget.y - (my.y + 1.5);
      rig.aimPitch = Math.atan2(dy, ad);
      rig.aimPoint.set(aimTarget.x, aimTarget.y, aimTarget.z);
      this.aimPoint.set(aimTarget.x, aimTarget.y, aimTarget.z);
    } else if (this.state === "patrol" && (mvx !== 0 || mvz !== 0)) {
      rig.aimYaw = Math.atan2(mvx, mvz);
      rig.aimPitch = 0;
    } else {
      this.yawSweep += dt * 0.65;
      rig.aimYaw = this.baseYaw + Math.sin(this.yawSweep) * 0.65;
      rig.aimPitch = 0;
    }

    const mv = rig.input.move;
    mv.set(mvx, 0, mvz);
    if (mv.lengthSq() > 0.0004) mv.normalize();
    rig.input.sprint = (this.state === "attack" || this.state === "alert") && !sees && dist > 14 && !holdPerch;
    rig.input.crouch =
      this.coverTimer > 0 ||
      rig.isReloading ||
      (this.state === "attack" && sees && dist < 24 && Math.hypot(mvx, mvz) < 0.35);
    rig.input.ads = this.state === "attack" || this.state === "alert";
    const gy = host.groundHeightAt(my.x, my.z, my.y);
    rig.update(dt, gy);
    resolveCircleAABBs(my, 0.55, host.aabbs, rig.stepHeight);
  }
}

/* ------------------------------------------------------------------ */
export class Enemy extends Fighter {
  constructor(host: CombatHost, spawn: EnemySpawn, mission: MissionDef) {
    const boss = !!spawn.boss;
    const hp = boss ? (spawn.name && BOSS_HP[spawn.name] ? BOSS_HP[spawn.name] : mission.enemyHp * 2) : mission.enemyHp;
    super(host, spawn, mission, hp, boss);
  }

  update(dt: number) {
    if (this.dead) {
      this.rig.update(dt);
      return;
    }
    this.aiUpdate(dt, {
      prefDist: this.boss ? 13 : 9,
      burstSize: this.boss ? 4 : 3,
      canFire: true,
    });
  }
}

/* ------------------------------------------------------------------ */
export class Ally extends Fighter {
  private fireTimer = 0;

  constructor(host: CombatHost, x: number, z: number) {
    super(
      host,
      { x, z, mode: "guard" },
      { ...host.mission, enemyAccuracy: 0.62, enemyDamage: [5, 9] },
      100000, // invulnerable
      false,
    );
    this.name = "Brick";
  }

  update(dt: number) {
    if (this.dead) {
      this.rig.update(dt);
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
      mvx = dx / dist;
      mvz = dz / dist;
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
    rig.input.crouch = false;
    rig.input.ads = true;

    // ---- engage the nearest enemy
    let target: Enemy | null = null;
    let bestD = 40;
    for (const e of host.enemies()) {
      if (e.isDead) continue;
      const d = Math.hypot(e.rig.root.position.x - my.x, e.rig.root.position.z - my.z);
      if (d < bestD && this.hasLineOfSight(this.eyePos(this.tmp2), e.rig.root.position.clone().setY(e.rig.root.position.y + 1.2))) {
        bestD = d;
        target = e;
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
    resolveCircleAABBs(my, 0.55, host.aabbs, rig.stepHeight);
  }

  protected onShoot(muzzle: THREE.Vector3) {
    this.host.sfx.shot();
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
    this.rig = await SoldierRig.load(scene);
    this.rig.setTint(tint[0], tint[1]);
    this.rig.equipment?.setVisible(false);
    this.rig.setHeightScale(0.97);
    this.rig.root.position.set(this.x, this.y, this.z);
    scene.add(this.rig.root);
  }

  update(dt: number) {
    this.rig.update(dt);
  }
}
