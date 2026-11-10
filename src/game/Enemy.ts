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
  fx: CombatFX;
  sfx: Sfx;
  playerPos: (out: THREE.Vector3) => THREE.Vector3;
  playerAlive: () => boolean;
  onPlayerHit: (dmg: number) => void;
  onKilled: (e: Fighter) => void;
  onAlert: (e: Fighter) => void;
  enemies: () => Enemy[];
  mission: MissionDef;
}

/** circle-vs-AABB push-out used for player & enemy movement */
export function resolveCircleAABBs(pos: THREE.Vector3, radius: number, aabbs: THREE.Box3[]) {
  const bodyTop = pos.y + 1.8;
  for (const b of aabbs) {
    if (bodyTop < b.min.y || pos.y > b.max.y) continue; // no vertical overlap
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
  patrolIdx = 0;
  readonly lastSeen = new THREE.Vector3();
  sightLost = 0;
  burstTimer = 1.2;
  burstShots = 0;
  reloadDelay = 0;
  readonly aimPoint = new THREE.Vector3();
  private raycaster = new THREE.Raycaster();
  protected tmp = new THREE.Vector3();
  protected tmp2 = new THREE.Vector3();
  private strafeSign = 1;
  private strafeTimer = 2;
  private yawSweep = Math.random() * Math.PI * 2;

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
    this.rig.aimYaw = Math.random() * Math.PI * 2;
    scene.add(this.rig.root);
    this.rig.root.add(this.hitbox);
    this.rig.events.onShot = (muzzle) => this.onShoot(muzzle);
    this.rig.events.onDry = () => {
      if (this.reloadDelay <= 0) {
        this.reloadDelay = 0.4;
        this.rig.reload();
      }
    };
    this.rig.events.onReloadEvent = (kind) => {
      if (kind === "start") this.host.sfx.magOut();
      else this.host.sfx.magIn();
    };
  }

  get isDead() {
    return this.dead;
  }

  takeDamage(dmg: number) {
    if (this.dead) return;
    this.hp -= dmg;
    this.rig.hit(0);
    if (this.hp <= 0) {
      this.dead = true;
      this.state = "dead";
      this.rig.die(Math.random() < 0.5 ? "back" : "front");
      this.hitbox.visible = false;
      this.hitbox.position.y = -50; // belt-and-braces off the raycast path
      this.host.onKilled(this);
    }
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

    // ---- detection
    const sees = dist < 34 && this.hasLineOfSight(this.eyePos(this.tmp2), p);
    if (sees && host.playerAlive()) {
      this.lastSeen.copy(p);
      if (this.state !== "attack") {
        this.state = "attack";
        this.burstTimer = 0.9;
        if (!this.alerted) {
          this.alerted = true;
          host.onAlert(this);
        }
      }
      this.sightLost = 0;
    } else if (this.state === "attack") {
      this.sightLost += dt;
      if (this.sightLost > 4) this.state = this.spawn.mode === "patrol" ? "patrol" : "idle";
    }

    // ---- movement
    let mvx = 0;
    let mvz = 0;
    if (this.state === "patrol" && this.spawn.patrol) {
      const wp = this.spawn.patrol[this.patrolIdx % this.spawn.patrol.length];
      const wdx = wp[0] - my.x;
      const wdz = wp[1] - my.z;
      const wd = Math.hypot(wdx, wdz);
      if (wd < 1.4) {
        this.patrolIdx++;
      } else {
        mvx = wdx / wd;
        mvz = wdz / wd;
      }
    } else if (this.state === "alert") {
      const ldx = this.lastSeen.x - my.x;
      const ldz = this.lastSeen.z - my.z;
      const ld = Math.hypot(ldx, ldz);
      if (ld < 1.2) {
        this.state = this.spawn.mode === "patrol" ? "patrol" : "idle";
      } else {
        mvx = ldx / ld;
        mvz = ldz / ld;
      }
    } else if (this.state === "attack") {
      const pref = opts.prefDist;
      if (dist > pref + 4) {
        mvx = dx / dist;
        mvz = dz / dist;
      } else if (dist < pref - 3) {
        mvx = -dx / dist;
        mvz = -dz / dist;
      } else {
        // strafe
        this.strafeTimer -= dt;
        if (this.strafeTimer <= 0) {
          this.strafeSign *= -1;
          this.strafeTimer = 2 + Math.random() * 3;
        }
        mvx = -dz / dist * this.strafeSign;
        mvz = dx / dist * this.strafeSign;
      }
      // burst fire
      if (opts.canFire && sees && dist < 32) {
        this.burstTimer -= dt;
        if (this.burstTimer <= 0 && !rig.dead) {
          rig.fire();
          this.burstShots++;
          if (this.burstShots >= opts.burstSize) {
            this.burstTimer = 1.3 + Math.random() * 1.4;
            this.burstShots = 0;
          } else {
            this.burstTimer = 0.26;
          }
        }
      }
    }

    // ---- aim at the player
    if (dist > 0.001) {
      rig.aimYaw = Math.atan2(dx / dist, dz / dist);
      const dy = p.y - (my.y + 1.5);
      rig.aimPitch = Math.atan2(dy, dist);
      rig.aimPoint.set(p.x, p.y, p.z);
      this.aimPoint.set(p.x, p.y, p.z);
    } else {
      this.yawSweep += dt * 0.5;
      rig.aimYaw = this.yawSweep;
      rig.aimPitch = 0;
    }

    const mv = rig.input.move;
    mv.set(mvx, 0, mvz);
    if (mv.lengthSq() > 0.0004) mv.normalize();
    rig.input.sprint = this.state === "attack" && dist > 16;
    rig.input.crouch = this.state === "attack" && dist < 22;
    rig.input.ads = this.state === "attack";
    rig.update(dt);
    resolveCircleAABBs(my, 0.55, host.aabbs);
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

    rig.update(dt);
    resolveCircleAABBs(my, 0.55, host.aabbs);
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
    this.rig.setHeightScale(0.97);
    this.rig.root.position.set(this.x, this.y, this.z);
    scene.add(this.rig.root);
  }

  update(dt: number) {
    this.rig.update(dt);
  }
}
