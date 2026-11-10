import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import soldierUrl from "../assets/soldier.glb?url";
import { buildRifle, RIFLE, type Rifle } from "./rifle";
import { Spring, clamp, damp, dampAngle, easeInOut, lerp, smoothstep, wrapAngle } from "./math";

/* ------------------------------------------------------------------ */
/*  Public types                                                       */
/* ------------------------------------------------------------------ */
export interface RigEvents {
  onShot?: (muzzle: THREE.Vector3, kick: number) => void;
  onDry?: () => void;
  onFootstep?: (side: 0 | 1, intensity: number) => void;
  onReloadEvent?: (kind: "magout" | "magin" | "bolt" | "drop" | "start") => void;
  onLand?: (intensity: number) => void;
  onHit?: () => void;
  onDeath?: () => void;
  onEject?: (pos: THREE.Vector3, dir: THREE.Vector3) => void;
}

export interface RigInput {
  move: THREE.Vector3; // world-space desired direction (len 0..1)
  sprint: boolean;
  crouch: boolean;
  ads: boolean;
  lean: number; // -1 (right) .. 1 (left)
}

export type RigStatus = "Idle" | "Walking" | "Running" | "Sprinting" | "Crouching" | "Crouch-walk" | "Airborne" | "Reloading" | "Aiming" | "Hit" | "Dead";

type Side = "Left" | "Right";
const FINGERS = ["Thumb", "Index", "Middle", "Ring", "Pinky"] as const;
const SEG: Record<string, number[]> = {
  Thumb: [0.35, 0.55, 0.7],
  Index: [0.95, 1.15, 0.75],
  Middle: [1.0, 1.2, 0.8],
  Ring: [1.05, 1.2, 0.8],
  Pinky: [1.1, 1.2, 0.8],
};

const WS = 0.86; // weapon scale
export const MAG_SIZE = 30;
const FIRE_INTERVAL = 60 / 700;
const RELOAD_TIME = 2.9;

const AXIS_Y = new THREE.Vector3(0, 1, 0);

interface HandBind {
  f0: THREE.Vector3;
  p0: THREE.Vector3;
  bindQ: THREE.Quaternion;
  fingers: Record<string, { bone: THREE.Object3D; bindLocal: THREE.Quaternion; axis: THREE.Vector3 }[]>;
}

interface HandKey {
  t: number;
  space: "w" | "c";
  pos: THREE.Vector3;
  f: THREE.Vector3;
  p: THREE.Vector3;
  curl: number;
}

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

/* Left-hand orientation presets (weapon-local) */
const LF_GRIP = { f: V(-0.5, 0.3, 0.8), p: V(0.15, 1, 0) };
const LF_MAG = { f: V(-0.3, 0.25, 1), p: V(-1, 0, 0.1) };
const LF_CHARGE = { f: V(-0.85, -0.1, 0.45), p: V(0, -1, 0) };

const hk = (t: number, space: "w" | "c", pos: THREE.Vector3, o: { f: THREE.Vector3; p: THREE.Vector3 }, curl: number): HandKey => ({
  t,
  space,
  pos,
  f: o.f,
  p: o.p,
  curl,
});

const RELOAD_KEYS: HandKey[] = [
  hk(0.0, "w", RIFLE.leftPalm, LF_GRIP, 0.9),
  hk(0.3, "w", V(0.13, -0.08, 0.12), LF_MAG, 0.1),
  hk(0.55, "w", V(0.034, -0.085, 0.115), LF_MAG, 0.85),
  hk(0.62, "w", V(0.034, -0.085, 0.115), LF_MAG, 0.95),
  hk(0.85, "w", V(0.034, -0.3, 0.125), LF_MAG, 0.95),
  hk(1.05, "w", V(0.3, -0.4, 0.18), LF_MAG, 0.3),
  hk(1.3, "c", V(0.14, -0.1, 0.17), LF_MAG, 0.15),
  hk(1.42, "c", V(0.14, -0.1, 0.17), LF_MAG, 0.95),
  hk(1.72, "w", V(0.034, -0.3, 0.115), LF_MAG, 0.95),
  hk(1.95, "w", V(0.034, -0.085, 0.115), LF_MAG, 0.95),
  hk(2.1, "w", V(0.034, -0.075, 0.115), LF_MAG, 0.95),
  hk(2.28, "w", V(0.07, 0.19, -0.02), LF_CHARGE, 0.55),
  hk(2.42, "w", V(0.025, 0.2, -0.02), LF_CHARGE, 0.85),
  hk(2.55, "w", V(0.025, 0.2, -0.085), LF_CHARGE, 0.85),
  hk(2.65, "w", V(0.07, 0.19, -0.04), LF_CHARGE, 0.5),
  hk(2.9, "w", RIFLE.leftPalm, LF_GRIP, 0.9),
];

interface DroppedProp {
  obj: THREE.Object3D;
  vel: THREE.Vector3;
  ang: THREE.Vector3;
  life: number;
  rest: boolean;
}

/* ------------------------------------------------------------------ */
export class SoldierRig {
  /** world position + yaw */
  readonly root = new THREE.Group();
  private fall = new THREE.Group();
  private model!: THREE.Group;
  private mixer!: THREE.AnimationMixer;
  private actions!: { idle: THREE.AnimationAction; walk: THREE.AnimationAction; run: THREE.AnimationAction };
  private bones: Record<string, THREE.Object3D> = {};
  private handBind = {} as Record<Side, HandBind>;
  readonly rifle: Rifle;
  events: RigEvents = {};

  // calibrated locomotion data
  walkN = 1.4;
  runN = 4.2;
  walkStride = 1.4; // metres per cycle
  runStride = 3.0;
  private walkOff = 0;
  private runOff = 0;
  private phase = 0;
  private cum = 0;
  private idleT = 0;
  height = 1.8;

  // input / intent
  input: RigInput = { move: new THREE.Vector3(), sprint: false, crouch: false, ads: false, lean: 0 };
  aimYaw = 0;
  aimPitch = 0;
  aimPoint = new THREE.Vector3(0, 1.5, 50);

  // kinematics
  vel = new THREE.Vector3();
  grounded = true;
  vy = 0;
  bodyYaw = 0;
  private turning = false;
  private sprinting = false;
  private moveSign = 1;

  // smooth state
  private crouchAmt = 0;
  private aimBlend = 0;
  private sprintBlend = 0;
  private airBlend = 0;
  private leanS = 0;
  private aimTimer = 0;
  private ikW = 1;
  private wYaw = 0;
  private wPitch = 0;
  private reloadT = -1;
  private reloadFlags = { out: false, drop: false, in: false, bolt: false, ammo: false };
  private fireCd = 0;
  private hitT = 0;

  // springs
  private sRecoilRot = new Spring(260, 18);
  private sRecoilPos = new Spring(300, 20);
  private sRecoilYaw = new Spring(200, 16);
  private sTorsoKick = new Spring(180, 16);
  private sLand = new Spring(190, 16);
  private sHitP = new Spring(130, 9);
  private sHitR = new Spring(130, 9);
  private sHitT = new Spring(130, 9);
  private sArmL = new Spring(40, 4);
  private sArmR = new Spring(40, 4);
  private sHead = new Spring(40, 5);

  // ammo
  mag = MAG_SIZE;
  reserve = 120;

  // death
  dead = false;
  private deathKind: "back" | "front" = "back";
  private deathT = 0;
  private fallAng = 0;
  private fallVel = 0;
  private fallBounced = false;
  private weaponAttached = true;
  private weaponProp: DroppedProp | null = null;
  private props: DroppedProp[] = [];
  private scene: THREE.Object3D;

  status: RigStatus = "Idle";
  private tmpQ = new THREE.Quaternion();
  private tmpQ2 = new THREE.Quaternion();
  private tmpV = new THREE.Vector3();
  private time = 0;

  private constructor(scene: THREE.Object3D) {
    this.scene = scene;
    this.rifle = buildRifle();
    this.rifle.group.scale.setScalar(WS);
    scene.add(this.rifle.group);
    this.root.add(this.fall);
    scene.add(this.root);
  }

  /* ---------------------------------------------------------------- */
  /*  Loading + calibration                                            */
  /* ---------------------------------------------------------------- */
  static async load(scene: THREE.Object3D, onProgress?: (p: number) => void): Promise<SoldierRig> {
    const rig = new SoldierRig(scene);
    const gltf = await new GLTFLoader().loadAsync(soldierUrl, (e) => {
      if (e.total) onProgress?.(e.loaded / e.total);
    });
    rig.setup(gltf);
    return rig;
  }

  private setup(gltf: { scene: THREE.Group; animations: THREE.AnimationClip[] }) {
    const model = gltf.scene;
    this.model = model;
    // the source asset faces -Z; the rig's convention is +Z forward
    model.rotation.y = Math.PI;
    this.fall.add(model);

    model.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) {
        m.castShadow = true;
        m.receiveShadow = true;
        m.frustumCulled = false;
        const mats = Array.isArray(m.material) ? m.material : [m.material];
        mats.forEach((mat) => {
          const s = mat as THREE.MeshStandardMaterial;
          if (s.map) {
            s.map.anisotropy = 16;
            s.map.colorSpace = THREE.SRGBColorSpace;
          }
          if (/visor/i.test(s.name)) {
            s.metalness = 0.95;
            s.roughness = 0.08;
            s.envMapIntensity = 1.6;
          } else {
            s.metalness = 0.12;
            s.roughness = 0.62;
            s.envMapIntensity = 0.9;
          }
        });
      }
      if (/^mixamorig/.test(o.name)) {
        const key = o.name.replace(/^mixamorig:?/, "");
        this.bones[key] = o;
      }
    });

    // normalise height to ~1.82m
    model.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(model);
    const h = box.max.y - box.min.y;
    if (h > 0.2) {
      const s = 1.82 / h;
      model.scale.multiplyScalar(s);
    }
    model.updateMatrixWorld(true);
    this.height = 1.82;

    this.captureBind();

    this.mixer = new THREE.AnimationMixer(model);
    const find = (n: string) => {
      const exact = gltf.animations.find((a) => a.name === n);
      if (exact) return exact;
      const fuzzy = gltf.animations.find((a) => a.name.toLowerCase().includes(n.toLowerCase()));
      if (fuzzy) return fuzzy;
      // last resort: reuse the first clip so a swapped model never crashes the game
      return gltf.animations[0];
    };
    this.actions = {
      idle: this.mixer.clipAction(find("Idle")),
      walk: this.mixer.clipAction(find("Walk")),
      run: this.mixer.clipAction(find("Run")),
    };
    Object.values(this.actions).forEach((a) => {
      a.setLoop(THREE.LoopRepeat, Infinity);
      a.play();
      a.setEffectiveWeight(0);
    });
    this.actions.idle.setEffectiveWeight(1);
    this.calibrate();
    this.mixer.update(0);
    model.updateMatrixWorld(true);
  }

  private captureBind() {
    const modelQInv = this.model.getWorldQuaternion(new THREE.Quaternion()).invert();
    (["Left", "Right"] as Side[]).forEach((side) => {
      const hand = this.bones[`${side}Hand`];
      const mid = this.bones[`${side}HandMiddle1`];
      const hp = hand.getWorldPosition(new THREE.Vector3());
      const mp = mid.getWorldPosition(new THREE.Vector3());
      const f0 = mp.sub(hp).normalize();
      const p0 = new THREE.Vector3(0, -1, 0);
      p0.sub(f0.clone().multiplyScalar(p0.dot(f0))).normalize();
      const bindQ = modelQInv.clone().multiply(hand.getWorldQuaternion(new THREE.Quaternion()));
      const fingers: HandBind["fingers"] = {};
      FINGERS.forEach((fn) => {
        fingers[fn] = [1, 2, 3].map((i) => {
          const b = this.bones[`${side}Hand${fn}${i}`];
          const child = this.bones[`${side}Hand${fn}${i + 1}`];
          const bp = b.getWorldPosition(new THREE.Vector3());
          const cp = child.getWorldPosition(new THREE.Vector3());
          const dir = cp.sub(bp).normalize();
          const axis = new THREE.Vector3().crossVectors(dir, p0).normalize(); // curls toward palm
          const bq = modelQInv.clone().multiply(b.getWorldQuaternion(new THREE.Quaternion()));
          return { bone: b, bindLocal: b.quaternion.clone(), axis: axis.applyQuaternion(bq.invert()) };
        });
      });
      this.handBind[side] = { f0, p0, bindQ, fingers };
    });
  }

  /** Measure ground speed + phase of the walk/run clips so feet don't skate. */
  private calibrate() {
    const foot = this.bones["LeftFoot"];
    const N = 96;
    const out: Record<string, { speed: number; off: number; dur: number }> = {};
    const acts: [string, THREE.AnimationAction][] = [
      ["walk", this.actions.walk],
      ["run", this.actions.run],
    ];
    for (const [name, act] of acts) {
      Object.values(this.actions).forEach((a) => a.setEffectiveWeight(0));
      act.setEffectiveWeight(1);
      const dur = act.getClip().duration;
      const ys: number[] = [];
      const zs: number[] = [];
      for (let i = 0; i < N; i++) {
        act.time = (i / N) * dur;
        this.mixer.update(0);
        this.model.updateMatrixWorld(true);
        const p = foot.getWorldPosition(this.tmpV);
        ys.push(p.y);
        zs.push(p.z);
      }
      const minY = Math.min(...ys);
      const maxY = Math.max(...ys);
      const thr = minY + 0.14 * (maxY - minY);
      let sum = 0;
      let n = 0;
      const dt = dur / N;
      for (let i = 0; i < N; i++) {
        const j = (i + 1) % N;
        if (ys[i] < thr && ys[j] < thr) {
          let dz = zs[j] - zs[i];
          sum += -dz / dt;
          n++;
        }
      }
      let speed = n > 3 ? sum / n : name === "walk" ? 1.4 : 4;
      const zmax = Math.max(...zs);
      const off = zs.indexOf(zmax) / N;
      out[name] = { speed, off, dur };
    }
    this.walkN = clamp(out.walk.speed, 0.9, 2.4);
    this.runN = clamp(out.run.speed, 2.8, 7);
    this.walkStride = this.walkN * out.walk.dur;
    this.runStride = this.runN * out.run.dur;
    this.walkOff = out.walk.off;
    this.runOff = out.run.off;
    // eslint-disable-next-line no-console
    console.info("[SoldierRig] calibrated", { raw: [out.walk.speed, out.run.speed, out.walk.dur, out.run.dur], scale: this.model.scale.x, walkN: this.walkN, runN: this.runN, walkOff: this.walkOff, runOff: this.runOff });
  }

  /* ---------------------------------------------------------------- */
  /*  Commands                                                         */
  /* ---------------------------------------------------------------- */
  jump() {
    if (this.dead || !this.grounded || this.reloadT >= 0) return;
    this.grounded = false;
    this.vy = 4.6;
    this.sLand.reset();
  }

  /** Returns true when a round left the barrel. */
  fire(): boolean {
    if (this.dead || this.reloadT >= 0) return false;
    if (this.fireCd > 0) return false;
    if (this.sprintBlend > 0.4 || this.aimBlend < 0.55) {
      this.aimTimer = 3;
      return false;
    }
    if (this.mag <= 0) {
      this.fireCd = 0.25;
      this.events.onDry?.();
      return false;
    }
    this.mag--;
    this.fireCd = FIRE_INTERVAL;
    this.aimTimer = 3;
    const r = () => Math.random() - 0.5;
    const ads = this.input.ads ? 0.6 : 1;
    this.sRecoilRot.kick((3.4 + r() * 1.2) * ads);
    this.sRecoilPos.kick(0.8 * ads);
    this.sRecoilYaw.kick(r() * 1.8 * ads);
    this.sTorsoKick.kick(1.0 * ads);
    this.sHead.kick(-0.5);
    this.rifle.group.updateMatrixWorld(true);
    const m = this.rifle.muzzle.getWorldPosition(new THREE.Vector3());
    this.events.onShot?.(m, ads);
    // eject a casing
    const q = this.rifle.group.getWorldQuaternion(new THREE.Quaternion());
    const ep = this.rifle.eject.getWorldPosition(new THREE.Vector3());
    const dir = new THREE.Vector3(1, 0.7, -0.2 + r() * 0.3).normalize().applyQuaternion(q);
    this.events.onEject?.(ep, dir);
    return true;
  }

  reload() {
    if (this.dead || this.reloadT >= 0 || this.mag >= MAG_SIZE || this.reserve <= 0) return false;
    this.reloadT = 0;
    this.reloadFlags = { out: false, drop: false, in: false, bolt: false, ammo: false };
    this.aimTimer = Math.max(this.aimTimer, RELOAD_TIME + 1);
    this.events.onReloadEvent?.("start");
    return true;
  }

  get isReloading() {
    return this.reloadT >= 0;
  }
  get reloadProgress() {
    return this.reloadT < 0 ? 0 : this.reloadT / RELOAD_TIME;
  }
  get speed() {
    return Math.hypot(this.vel.x, this.vel.z);
  }
  get eyeHeight() {
    return 1.62 - this.crouchAmt * 0.42 - this.sLand.x;
  }

  /** direction: angle (rad) relative to the character's facing the hit came from (0 = from the front) */
  hit(angle = 0) {
    if (this.dead) return;
    this.hitT = 0.55;
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    this.sHitP.kick(-c * 5.5);
    this.sHitR.kick(s * 4.5);
    this.sHitT.kick((Math.random() - 0.5) * 7);
    this.sRecoilRot.kick(3);
    this.sArmL.kick(-6 * Math.random());
    this.sArmR.kick(6 * Math.random());
    this.sHead.kick(-c * 3);
    this.events.onHit?.();
  }

  die(kind: "back" | "front" = "back") {
    if (this.dead) return;
    this.dead = true;
    this.deathKind = kind;
    this.deathT = 0;
    this.fallAng = 0;
    this.fallVel = kind === "back" ? 0.6 : 0.9;
    this.fallBounced = false;
    this.reloadT = -1;
    this.vel.multiplyScalar(0.6);
    this.sArmL.kick(-14);
    this.sArmR.kick(14);
    this.sHead.kick(kind === "back" ? -5 : 4);
    // drop weapon
    this.weaponAttached = false;
    const wp = this.rifle.group;
    const fwd = new THREE.Vector3(Math.sin(this.bodyYaw), 0, Math.cos(this.bodyYaw));
    this.weaponProp = {
      obj: wp,
      vel: fwd.clone().multiplyScalar(kind === "back" ? -0.4 : 1.3).add(new THREE.Vector3(0.6 * (Math.random() - 0.5), 1.6, 0)),
      ang: new THREE.Vector3(Math.random() * 4 - 2, Math.random() * 3 - 1.5, Math.random() * 5 - 2.5),
      life: 1e9,
      rest: false,
    };
    this.events.onDeath?.();
  }

  respawn(pos?: THREE.Vector3) {
    this.dead = false;
    this.deathT = 0;
    this.fallAng = 0;
    this.fall.rotation.set(0, 0, 0);
    this.fall.position.set(0, 0, 0);
    if (pos) this.root.position.copy(pos);
    this.root.position.y = 0;
    this.vel.set(0, 0, 0);
    this.vy = 0;
    this.grounded = true;
    this.mag = MAG_SIZE;
    this.reserve = 120;
    this.weaponAttached = true;
    this.weaponProp = null;
    this.rifle.group.scale.setScalar(WS);
    this.rifle.mag.position.copy(RIFLE.magRest);
    this.rifle.mag.rotation.set(0, 0, 0);
    this.rifle.mag.visible = true;
    this.rifle.group.add(this.rifle.mag);
    this.reloadT = -1;
    [this.sRecoilRot, this.sRecoilPos, this.sRecoilYaw, this.sTorsoKick, this.sLand, this.sHitP, this.sHitR, this.sHitT, this.sArmL, this.sArmR, this.sHead].forEach((s) => s.reset());
    this.ikW = 0;
    this.aimTimer = 0;
    this.crouchAmt = 0;
  }

  /* ---------------------------------------------------------------- */
  /*  Frame update                                                     */
  /* ---------------------------------------------------------------- */
  update(dtRaw: number) {
    if (!this.model) return;
    const dt = Math.min(dtRaw, 1 / 20);
    this.time += dt;
    this.fireCd = Math.max(0, this.fireCd - dt);
    this.hitT = Math.max(0, this.hitT - dt);

    this.updateLocomotion(dt);
    this.updateAnimBase(dt);
    this.model.updateMatrixWorld(true);
    this.updateProcedural(dt);
    this.updateProps(dt);
    this.tickReload(dt);
    this.updateStatus();
  }

  private updateLocomotion(dt: number) {
    const inp = this.input;
    const wantMove = !this.dead && inp.move.lengthSq() > 0.0004;
    let target = 0;
    let rel = 0;
    const dir = new THREE.Vector3();
    if (wantMove) {
      dir.copy(inp.move).setY(0).normalize();
      const psi = Math.atan2(dir.x, dir.z);
      rel = wrapAngle(psi - this.aimYaw);
      const sprintOK = inp.sprint && !inp.crouch && !inp.ads && Math.abs(rel) < 1.1 && this.reloadT < 0;
      this.sprinting = sprintOK;
      target = sprintOK ? this.runN : inp.crouch ? this.walkN * 0.6 : inp.ads ? this.walkN * 0.55 : this.walkN;
    } else {
      this.sprinting = false;
    }
    // facing + direction of the legs relative to aim
    let legOffset = 0;
    if (wantMove) {
      if (Math.abs(rel) <= 1.95) {
        this.moveSign = 1;
        legOffset = clamp(rel, -1.35, 1.35);
      } else {
        this.moveSign = -1;
        legOffset = clamp(wrapAngle(rel - Math.PI), -1.35, 1.35);
      }
    }

    const desired = dir.multiplyScalar(target);
    const rate = this.grounded ? (wantMove ? 8 : 11) : 0.8;
    this.vel.x = damp(this.vel.x, desired.x, rate, dt);
    this.vel.z = damp(this.vel.z, desired.z, rate, dt);
    if (this.dead) {
      this.vel.x = damp(this.vel.x, 0, 3, dt);
      this.vel.z = damp(this.vel.z, 0, 3, dt);
    }
    this.root.position.x = clamp(this.root.position.x + this.vel.x * dt, -260, 260);
    this.root.position.z = clamp(this.root.position.z + this.vel.z * dt, -260, 260);

    // vertical
    if (!this.grounded) {
      this.vy -= 15 * dt;
      this.root.position.y += this.vy * dt;
      if (this.root.position.y <= 0) {
        this.root.position.y = 0;
        const impact = -this.vy;
        this.grounded = true;
        this.vy = 0;
        this.sLand.kick(impact * 0.5);
        this.events.onLand?.(clamp(impact / 6, 0.2, 1));
      }
    }

    // body yaw
    if (!this.dead) {
      const diff = wrapAngle(this.aimYaw - this.bodyYaw);
      if (wantMove) {
        this.bodyYaw = dampAngle(this.bodyYaw, this.aimYaw + legOffset, 11, dt);
        this.turning = false;
      } else {
        const aiming = this.aimBlend > 0.5;
        const thr = aiming ? 0.8 : 1.15;
        if (Math.abs(diff) > thr) this.turning = true;
        if (this.turning) {
          this.bodyYaw = dampAngle(this.bodyYaw, this.aimYaw, 7, dt);
          if (Math.abs(diff) < 0.12) this.turning = false;
        }
      }
    }
    this.root.rotation.y = this.bodyYaw;
  }

  private updateAnimBase(dt: number) {
    const a = this.actions;
    this.airBlend = damp(this.airBlend, this.grounded ? 0 : 1, this.grounded ? 14 : 18, dt);
    const spd = this.speed;
    const animSpd = this.dead ? 0 : Math.max(spd, this.turning ? 0.95 : 0);
    const locoW = smoothstep(0.04, 0.7, animSpd);
    const runW = clamp((animSpd - this.walkN) / (this.runN - this.walkN), 0, 1);
    const runE = easeInOut(runW);

    const stride = lerp(this.walkStride, this.runStride, runE);
    if (this.grounded && !this.dead) {
      const prevCum = this.cum;
      this.cum += this.moveSign * (animSpd / Math.max(stride, 0.1)) * dt;
      this.phase = ((this.cum % 1) + 1) % 1;
      if (locoW > 0.3) {
        const inten = clamp(animSpd / this.runN + 0.25, 0.25, 1);
        const s1 = this.walkOff;
        const s2 = this.walkOff + 0.5;
        if (Math.floor(this.cum - s1) !== Math.floor(prevCum - s1)) this.events.onFootstep?.(0, inten);
        if (Math.floor(this.cum - s2) !== Math.floor(prevCum - s2)) this.events.onFootstep?.(1, inten);
      }
    }
    this.idleT += dt;

    const dur = (x: THREE.AnimationAction) => x.getClip().duration;
    a.idle.time = this.idleT % dur(a.idle);
    a.walk.time = (((this.phase) % 1 + 1) % 1) * dur(a.walk);
    a.run.time = ((((this.phase - this.walkOff + this.runOff) % 1) + 1) % 1) * dur(a.run);

    const airFreeze = this.airBlend;
    // when airborne ease toward a neutral jog pose so legs read as "mid-stride" then tuck via IK
    const iw = (1 - locoW) * (1 - airFreeze * 0.0);
    a.idle.setEffectiveWeight(iw);
    a.walk.setEffectiveWeight(locoW * (1 - runE));
    a.run.setEffectiveWeight(locoW * runE);
    this.mixer.update(0);
  }

  /* ---------------------------------------------------------------- */
  private updateProcedural(dt: number) {
    const inp = this.input;
    const B = this.bones;
    const dead = this.dead;
    if (dead) this.deathT += dt;

    // ----- state smoothing
    this.aimTimer = Math.max(0, this.aimTimer - dt);
    const wantAim = !dead && (inp.ads || this.aimTimer > 0 || this.reloadT >= 0) && !this.sprinting;
    this.aimBlend = damp(this.aimBlend, wantAim ? 1 : 0, wantAim ? 13 : 4.5, dt);
    this.sprintBlend = damp(this.sprintBlend, this.sprinting ? 1 : 0, 7, dt);
    let crouchT = inp.crouch && !dead ? 1 : 0;
    this.crouchAmt = damp(this.crouchAmt, crouchT, 9, dt);
    this.leanS = damp(this.leanS, dead ? 0 : inp.lean, 10, dt);
    this.ikW = damp(this.ikW, dead ? 0 : 1, dead ? 14 : 12, dt);

    const sLand = this.sLand.update(0, dt);
    const rRot = this.sRecoilRot.update(0, dt);
    const rPos = this.sRecoilPos.update(0, dt);
    const rYaw = this.sRecoilYaw.update(0, dt);
    const tKick = this.sTorsoKick.update(0, dt);
    const hP = this.sHitP.update(0, dt);
    const hR = this.sHitR.update(0, dt);
    const hT = this.sHitT.update(0, dt);
    const headS = this.sHead.update(0, dt);
    const armL = this.sArmL.update(0, dt);
    const armR = this.sArmR.update(0, dt);

    // ----- death: fall simulation
    let deathBuckle = 0;
    if (dead) {
      const t = this.deathT;
      if (t > 0.18) {
        const acc = 24 * Math.sin(Math.min(this.fallAng, Math.PI / 2) + 0.35);
        this.fallVel += acc * dt;
        this.fallAng += this.fallVel * dt;
        if (this.fallAng >= Math.PI / 2) {
          this.fallAng = Math.PI / 2;
          if (!this.fallBounced && this.fallVel > 1.2) {
            this.fallVel = -this.fallVel * 0.16;
            this.fallBounced = true;
          } else this.fallVel = 0;
        } else if (this.fallAng < 0.2 && this.fallVel < 0) {
          this.fallAng = 0.2;
          this.fallVel = 0;
        }
      }
      const k = this.fallAng / (Math.PI / 2);
      const sign = this.deathKind === "back" ? -1 : 1;
      this.fall.rotation.x = sign * this.fallAng;
      this.fall.position.y = 0.11 * Math.sin(this.fallAng);
      this.fall.position.z = sign * 0.42 * k; // body slides in the direction of the fall
      // buckle knees first, straighten as body lies flat
      deathBuckle = (smoothstep(0, 0.35, t) * 0.8) * (1 - smoothstep(0.45, 1.0, k));
    } else if (this.fall.rotation.x !== 0) {
      this.fall.rotation.x = damp(this.fall.rotation.x, 0, 12, dt);
      this.fall.position.y = damp(this.fall.position.y, 0, 12, dt);
      this.fall.position.z = damp(this.fall.position.z, 0, 12, dt);
      if (Math.abs(this.fall.rotation.x) < 0.001) {
        this.fall.rotation.set(0, 0, 0);
        this.fall.position.set(0, 0, 0);
      }
    }

    this.model.updateMatrixWorld(true);

    // ----- LEGS : crouch / landing / airborne via two-bone IK
    const depth = this.crouchAmt * 0.38 + sLand + deathBuckle * 0.5;
    const lift = this.airBlend * 0.3;
    if (depth > 0.002 || lift > 0.002) this.applyLegs(depth, lift, dead);

    // ----- TORSO : aim twist/pitch/lean + reactions
    this.model.updateMatrixWorld(true);
    const bodyYawNow = this.root.rotation.y;
    const hipPos = B.Hips.getWorldPosition(this.tmpV);
    void hipPos;

    const twist = clamp(wrapAngle(this.aimYaw - bodyYawNow), -1.7, 1.7);
    const blade = -0.28 * this.aimBlend * (1 - this.sprintBlend);
    const sprintTwist = this.sprintBlend * 0.1;
    const yawTot = dead ? 0 : twist + blade + sprintTwist + hT * 0.5;
    const pitchK = lerp(0.55, 1, this.aimBlend);
    const crouchLean = this.crouchAmt * 0.22 + sLand * 0.5;
    const breath = Math.sin(this.time * 1.7) * 0.012 * (1 + this.aimBlend);
    const pitchTot = dead
      ? 0
      : -this.aimPitch * pitchK + crouchLean + hP * 0.5 + breath + rRot * 0.05 + tKick * 0.04 + this.sprintBlend * 0.08;
    const rollTot = dead ? 0 : -this.leanS * 0.3 + hR * 0.4;

    const yawFrame = bodyYawNow + yawTot;
    const rightAxis = new THREE.Vector3(Math.cos(yawFrame), 0, -Math.sin(yawFrame));
    const fwdAxis = new THREE.Vector3(Math.sin(yawFrame), 0, Math.cos(yawFrame));
    const qYaw = new THREE.Quaternion().setFromAxisAngle(AXIS_Y, yawTot);
    const qPitch = new THREE.Quaternion().setFromAxisAngle(rightAxis, pitchTot);
    const qRoll = new THREE.Quaternion().setFromAxisAngle(fwdAxis, rollTot);
    const qTot = qRoll.multiply(qPitch).multiply(qYaw);
    if (!dead) {
      this.rotateChain(["Spine", "Spine1", "Spine2"], qTot, [0.3, 0.32, 0.32]);
      // head: look at the aim point, a little less than the chest
      const headQ = new THREE.Quaternion().setFromAxisAngle(rightAxis, -this.aimPitch * 0.4 + headS * 0.1 + hP * 0.3).multiply(new THREE.Quaternion().setFromAxisAngle(AXIS_Y, yawTot * 0.18));
      this.rotateChain(["Neck", "Head"], headQ, [0.45, 0.55]);
    } else {
      // limp spine + head lolling
      const sgn = this.deathKind === "back" ? 1 : -1;
      const curl = new THREE.Quaternion().setFromAxisAngle(rightAxis, sgn * 0.35 * smoothstep(0.1, 0.8, this.deathT));
      this.rotateChain(["Spine", "Spine1", "Spine2"], curl, [0.35, 0.35, 0.3]);
      const loll = new THREE.Quaternion().setFromAxisAngle(rightAxis, headS * 0.12 - sgn * 0.25);
      this.rotateChain(["Neck", "Head"], loll, [0.5, 0.5]);
    }

    this.model.updateMatrixWorld(true);

    // ----- WEAPON + ARMS
    if (this.weaponAttached) {
      this.updateWeaponAndArms(dt, { rRot, rPos, rYaw, armL, armR });
    } else {
      this.updateDeadArms(armL, armR);
    }

    this.model.updateMatrixWorld(true);
  }

  /* ---- bone helpers -------------------------------------------------- */
  private rotateWorld(bone: THREE.Object3D, dq: THREE.Quaternion) {
    const wq = bone.getWorldQuaternion(this.tmpQ);
    const pq = bone.parent!.getWorldQuaternion(this.tmpQ2).invert();
    wq.premultiply(dq);
    bone.quaternion.copy(pq.multiply(wq));
    bone.updateMatrixWorld(true);
  }

  private rotateChain(names: string[], q: THREE.Quaternion, weights: number[]) {
    const id = new THREE.Quaternion();
    names.forEach((n, i) => {
      const part = id.clone().slerp(q, weights[i]);
      this.rotateWorld(this.bones[n], part);
    });
  }

  private twoBoneIK(a: THREE.Object3D, b: THREE.Object3D, c: THREE.Object3D, target: THREE.Vector3, pole: THREE.Vector3, stretch = 0.999) {
    const A = a.getWorldPosition(new THREE.Vector3());
    const Bp = b.getWorldPosition(new THREE.Vector3());
    const C = c.getWorldPosition(new THREE.Vector3());
    const l1 = A.distanceTo(Bp);
    const l2 = Bp.distanceTo(C);
    const AT = target.clone().sub(A);
    let d = AT.length();
    d = clamp(d, Math.abs(l1 - l2) + 1e-3, (l1 + l2) * stretch);
    const axis = AT.normalize();
    const pp = pole.clone().sub(axis.clone().multiplyScalar(pole.dot(axis)));
    if (pp.lengthSq() < 1e-6) pp.set(0, -1, 0);
    pp.normalize();
    const x = (l1 * l1 - l2 * l2 + d * d) / (2 * d);
    const h = Math.sqrt(Math.max(0, l1 * l1 - x * x));
    const E = A.clone().add(axis.clone().multiplyScalar(x)).add(pp.multiplyScalar(h));
    const T = A.clone().add(axis.clone().multiplyScalar(d));
    const q1 = new THREE.Quaternion().setFromUnitVectors(Bp.clone().sub(A).normalize(), E.clone().sub(A).normalize());
    this.rotateWorld(a, q1);
    b.getWorldPosition(Bp);
    c.getWorldPosition(C);
    const q2 = new THREE.Quaternion().setFromUnitVectors(C.clone().sub(Bp).normalize(), T.clone().sub(Bp).normalize());
    this.rotateWorld(b, q2);
  }

  /* ---- legs ---------------------------------------------------------- */
  private applyLegs(depth: number, lift: number, dead: boolean) {
    const B = this.bones;
    const sides: Side[] = ["Left", "Right"];
    const footP: Record<string, THREE.Vector3> = {};
    const footQ: Record<string, THREE.Quaternion> = {};
    sides.forEach((s) => {
      footP[s] = B[`${s}Foot`].getWorldPosition(new THREE.Vector3());
      footQ[s] = B[`${s}Foot`].getWorldQuaternion(new THREE.Quaternion());
    });
    const yaw = this.root.rotation.y;
    const fwd = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
    const right = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
    // lower hips (and push them back a little for balance)
    const hips = B.Hips;
    const hp = hips.getWorldPosition(new THREE.Vector3());
    hp.y -= depth;
    hp.addScaledVector(fwd, -depth * 0.35);
    // convert to the parent's local space
    hips.parent!.updateWorldMatrix(true, false);
    hips.position.copy(hips.parent!.worldToLocal(hp));
    hips.updateMatrixWorld(true);

    sides.forEach((s, i) => {
      const out = s === "Left" ? 1 : -1; // "right" vector below is the character's left (+X)
      const target = footP[s].clone();
      // jump tuck: lift feet and slightly pull the rear foot back
      target.y += lift * (i === 0 ? 1 : 0.8);
      target.addScaledVector(fwd, -lift * (i === 0 ? 0.25 : -0.15));
      if (dead) target.addScaledVector(right, out * 0.08 * smoothstep(0.3, 1, this.fallAng));
      const pole = fwd.clone().addScaledVector(right, out * 0.18);
      this.twoBoneIK(B[`${s}UpLeg`], B[`${s}Leg`], B[`${s}Foot`], target, pole, 0.9995);
      // keep foot orientation (ground-flat) – only tilt for tucked jump
      const cur = B[`${s}Foot`].getWorldQuaternion(new THREE.Quaternion());
      const delta = footQ[s].clone().multiply(cur.invert());
      this.rotateWorld(B[`${s}Foot`], delta);
    });
  }

  /* ---- weapon + arms --------------------------------------------------- */
  private updateWeaponAndArms(dt: number, s: { rRot: number; rPos: number; rYaw: number; armL: number; armR: number }) {
    const B = this.bones;
    const rShoulder = B.RightArm.getWorldPosition(new THREE.Vector3());
    const lShoulder = B.LeftArm.getWorldPosition(new THREE.Vector3());

    // desired weapon aim: from shoulder to aim point (parallax-correct), no closer than 4m
    const toAim = this.aimPoint.clone().sub(rShoulder);
    if (toAim.length() < 4) toAim.normalize().multiplyScalar(4);
    const dYaw = Math.atan2(toAim.x, toAim.z);
    const dPitch = Math.atan2(toAim.y, Math.hypot(toAim.x, toAim.z));
    this.wYaw = dampAngle(this.wYaw, dYaw, 26, dt);
    this.wPitch = damp(this.wPitch, dPitch, 26, dt);

    const a = this.aimBlend;
    const sp = this.sprintBlend;
    // reload envelope
    let rb = 0;
    if (this.reloadT >= 0) {
      const t = this.reloadT;
      rb = smoothstep(0, 0.35, t) * (1 - smoothstep(2.55, 2.9, t));
    }
    const lowReady = 1 - a;

    // pose parameters (angles in rad; positive down = nose down)
    const dx = lowReady * 0.5 + sp * 0.55 + rb * 0.22;
    const dy = sp * 0.75 + lowReady * 0.15;
    const roll = sp * 0.35 - rb * 0.55;

    const aimQ = new THREE.Quaternion().setFromEuler(new THREE.Euler(-this.wPitch + (this.input.ads ? 0 : 0), this.wYaw + s.rYaw * 0.02, 0, "YXZ"));
    // weapon-local pose offset
    const poseQ = new THREE.Quaternion().setFromEuler(new THREE.Euler(dx - s.rRot * 0.045, dy, roll, "YXZ"));
    const wq = aimQ.clone().multiply(poseQ);

    // position relative to the right shoulder, expressed in aim frame
    const pAim = V(0.075, -0.095, 0.36);
    const pLow = V(0.1, -0.2, 0.3);
    const pSprint = V(0.16, -0.27, 0.22);
    const pReload = V(0.1, -0.17, 0.33);
    const off = pAim.clone().lerp(pLow, lowReady).lerp(pSprint, sp).lerp(pReload, rb);
    off.z -= s.rPos * 0.035;
    off.y += s.rPos * 0.008;
    const wpos = rShoulder.clone().add(off.applyQuaternion(aimQ));
    // breathing sway
    wpos.y += Math.sin(this.time * 1.7) * 0.003 * (1 + a);
    wpos.x += Math.sin(this.time * 0.9) * 0.0015;

    const g = this.rifle.group;
    g.position.copy(wpos);
    g.quaternion.copy(wq);
    g.updateMatrixWorld(true);

    const toW = (v: THREE.Vector3) => v.clone().multiplyScalar(WS).applyQuaternion(wq).add(wpos);
    const dirW = (v: THREE.Vector3) => v.clone().normalize().applyQuaternion(wq);

    // save pose before IK so we can blend out on death
    const armBones = [B.LeftArm, B.LeftForeArm, B.LeftHand, B.RightArm, B.RightForeArm, B.RightHand];
    FINGERS.forEach((f) => {
      [1, 2, 3].forEach((i) => {
        armBones.push(B[`Left${"Hand"}${f}${i}`], B[`Right${"Hand"}${f}${i}`]);
      });
    });
    const saved = this.ikW < 0.999 ? armBones.map((b) => b.quaternion.clone()) : null;

    // ---- right hand (grip)
    const RF = V(0.35, -0.42, 0.84);
    const RP = V(1, 0.25, 0);
    const rf = dirW(RF);
    const rp = dirW(RP);
    const rfN = rf.clone();
    const rpalm = toW(RIFLE.rightPalm);
    const rWrist = rpalm.clone().addScaledVector(rfN, -0.075);

    // ---- left hand (grip or reload animation)
    let lPalm: THREE.Vector3;
    let lf: THREE.Vector3;
    let lp: THREE.Vector3;
    let lCurl = 0.9;
    if (this.reloadT >= 0) {
      const r = this.sampleReload(toW, dirW);
      lPalm = r.pos;
      lf = r.f;
      lp = r.p;
      lCurl = r.curl;
      this.updateReloadProps(dt, lPalm, wq, toW);
    } else {
      lPalm = toW(RIFLE.leftPalm);
      lf = dirW(LF_GRIP.f);
      lp = dirW(LF_GRIP.p);
    }
    const lfN = lf.clone().normalize();
    const lWrist = lPalm.clone().addScaledVector(lfN, -0.075);

    // wobble from hits
    const wob = new THREE.Vector3(0, s.armL * 0.002, 0);
    lWrist.add(wob);
    rWrist.add(new THREE.Vector3(0, s.armR * 0.002, 0));

    // elbows hang down and slightly out
    const yawQ = new THREE.Quaternion().setFromAxisAngle(AXIS_Y, this.wYaw);
    const poleR = V(-0.55, -1, -0.25).applyQuaternion(yawQ);
    const poleL = V(0.6, -1, -0.3).applyQuaternion(yawQ);
    void lShoulder;

    this.solveArm("Right", rWrist, rf, rp, poleR);
    this.solveArm("Left", lWrist, lf, lp, poleL);

    // fingers
    const fire = this.fireCd > FIRE_INTERVAL * 0.4 ? 1 : 0;
    this.curlHand("Right", { Thumb: 0.55, Index: 0.45 + fire * 0.35, Middle: 1, Ring: 1, Pinky: 1 });
    this.curlHand("Left", { Thumb: 0.45, Index: lCurl, Middle: lCurl, Ring: lCurl, Pinky: lCurl });

    if (saved) {
      armBones.forEach((b, i) => {
        const cur = b.quaternion.clone();
        b.quaternion.copy(saved[i]).slerp(cur, this.ikW);
      });
    }
  }

  private solveArm(side: Side, wrist: THREE.Vector3, f: THREE.Vector3, p: THREE.Vector3, pole: THREE.Vector3) {
    const B = this.bones;
    const up = B[`${side}Arm`];
    const fore = B[`${side}ForeArm`];
    const hand = B[`${side}Hand`];
    this.twoBoneIK(up, fore, hand, wrist, pole, 0.995);
    // distribute wrist twist onto the forearm to avoid candy-wrapper skinning
    const target = this.handTargetQuat(side, f, p);
    const cur = hand.getWorldQuaternion(new THREE.Quaternion());
    const delta = target.clone().multiply(cur.invert());
    const ax = hand.getWorldPosition(new THREE.Vector3()).sub(fore.getWorldPosition(new THREE.Vector3())).normalize();
    const proj = delta.x * ax.x + delta.y * ax.y + delta.z * ax.z;
    const twist = 2 * Math.atan2(proj, delta.w);
    const tw = wrapAngle(twist) * 0.55;
    this.rotateWorld(fore, new THREE.Quaternion().setFromAxisAngle(ax, tw));
    // final hand orientation
    const pq = hand.parent!.getWorldQuaternion(new THREE.Quaternion()).invert();
    hand.quaternion.copy(pq.multiply(target));
    hand.updateMatrixWorld(true);
  }

  private handTargetQuat(side: Side, f: THREE.Vector3, p: THREE.Vector3) {
    const hb = this.handBind[side];
    const modelQ = this.model.getWorldQuaternion(new THREE.Quaternion());
    const modelQi = modelQ.clone().invert();
    const F = f.clone().normalize().applyQuaternion(modelQi);
    const P = p.clone().applyQuaternion(modelQi);
    P.sub(F.clone().multiplyScalar(P.dot(F))).normalize();
    const S = new THREE.Vector3().crossVectors(F, P);
    const m1 = new THREE.Matrix4().makeBasis(F, P, S);
    const S0 = new THREE.Vector3().crossVectors(hb.f0, hb.p0);
    const m0 = new THREE.Matrix4().makeBasis(hb.f0, hb.p0, S0).transpose();
    const R = m1.multiply(m0);
    const qR = new THREE.Quaternion().setFromRotationMatrix(R);
    return modelQ.multiply(qR).multiply(hb.bindQ);
  }

  private curlHand(side: Side, amt: Record<string, number>) {
    const hb = this.handBind[side];
    const q = new THREE.Quaternion();
    FINGERS.forEach((fn) => {
      hb.fingers[fn].forEach((seg, i) => {
        const ang = (amt[fn] ?? 0) * SEG[fn][i];
        seg.bone.quaternion.copy(seg.bindLocal).multiply(q.setFromAxisAngle(seg.axis, ang));
      });
    });
  }

  private updateDeadArms(armL: number, armR: number) {
    const B = this.bones;
    const t = smoothstep(0.05, 0.7, this.deathT);
    const yaw = this.root.rotation.y;
    const fwd = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
    // spread arms out (left = +Z rotation, right = -Z rotation in body frame) with overshoot springs
    const l = 0.25 + t * 0.9 + armL * 0.05;
    const r = 0.25 + t * 0.9 - armR * 0.05;
    this.rotateWorld(B.LeftArm, new THREE.Quaternion().setFromAxisAngle(fwd, l));
    this.rotateWorld(B.RightArm, new THREE.Quaternion().setFromAxisAngle(fwd, -r));
    const bend = new THREE.Quaternion().setFromAxisAngle(AXIS_Y, 0.0);
    void bend;
    // relaxed fingers
    this.curlHand("Left", { Thumb: 0.3, Index: 0.35, Middle: 0.45, Ring: 0.5, Pinky: 0.55 });
    this.curlHand("Right", { Thumb: 0.3, Index: 0.35, Middle: 0.45, Ring: 0.5, Pinky: 0.55 });
  }

  /* ---- reload ---------------------------------------------------------- */
  private sampleReload(toW: (v: THREE.Vector3) => THREE.Vector3, dirW: (v: THREE.Vector3) => THREE.Vector3) {
    const t = clamp(this.reloadT, 0, RELOAD_TIME);
    let i = 0;
    while (i < RELOAD_KEYS.length - 2 && t > RELOAD_KEYS[i + 1].t) i++;
    const k0 = RELOAD_KEYS[i];
    const k1 = RELOAD_KEYS[i + 1];
    const u = easeInOut((t - k0.t) / Math.max(1e-4, k1.t - k0.t));
    const chestQ = new THREE.Quaternion().setFromAxisAngle(AXIS_Y, this.root.rotation.y + clamp(wrapAngle(this.aimYaw - this.root.rotation.y), -1.2, 1.2) - 0.3);
    const chestP = this.bones.Spine2.getWorldPosition(new THREE.Vector3());
    const conv = (k: HandKey) => {
      if (k.space === "w") return { pos: toW(k.pos), f: dirW(k.f), p: dirW(k.p) };
      return {
        pos: k.pos.clone().applyQuaternion(chestQ).add(chestP),
        f: k.f.clone().normalize().applyQuaternion(chestQ),
        p: k.p.clone().normalize().applyQuaternion(chestQ),
      };
    };
    const a = conv(k0);
    const b = conv(k1);
    return {
      pos: a.pos.lerp(b.pos, u),
      f: a.f.lerp(b.f, u).normalize(),
      p: a.p.lerp(b.p, u).normalize(),
      curl: lerp(k0.curl, k1.curl, u),
    };
  }

  private updateReloadProps(_dt: number, palm: THREE.Vector3, wq: THREE.Quaternion, toW: (v: THREE.Vector3) => THREE.Vector3) {
    const t = this.reloadT;
    const fl = this.reloadFlags;
    const R = this.rifle;
    const magOffLocal = RIFLE.magRest.clone().sub(V(0.034, -0.085, 0.115)); // palm -> mag centre
    const attachToHand = () => {
      if (R.mag.parent !== R.group) R.group.add(R.mag);
      // place in weapon-local space from the palm world pos
      const inv = new THREE.Matrix4().copy(R.group.matrixWorld).invert();
      const pl = palm.clone().applyMatrix4(inv);
      R.mag.position.copy(pl).add(magOffLocal);
      R.mag.rotation.set(0, 0, 0);
    };
    if (t > 0.58 && t < 1.02 && !fl.drop) {
      attachToHand();
      if (!fl.out) {
        fl.out = true;
        this.events.onReloadEvent?.("magout");
      }
    }
    if (t >= 1.02 && !fl.drop) {
      fl.drop = true;
      // spawn physical old magazine
      const clone = R.makeMagClone();
      R.group.updateMatrixWorld(true);
      const wp = R.mag.getWorldPosition(new THREE.Vector3());
      const wquat = R.mag.getWorldQuaternion(new THREE.Quaternion());
      clone.position.copy(wp);
      clone.quaternion.copy(wquat);
      clone.scale.setScalar(WS);
      this.scene.add(clone);
      clone.traverse((o) => ((o as THREE.Mesh).castShadow = true));
      const out = V(0.8 + Math.random() * 0.3, 0.2, 0.2).applyQuaternion(wq);
      this.props.push({ obj: clone, vel: out, ang: V(Math.random() * 4, Math.random() * 4, Math.random() * 4), life: 12, rest: false });
      R.mag.visible = false;
      this.events.onReloadEvent?.("drop");
    }
    if (t >= 1.42 && t < 1.93) {
      R.mag.visible = true;
      attachToHand();
    }
    if (t >= 1.93 && t < 2.0 && !fl.in) {
      fl.in = true;
      R.mag.position.copy(RIFLE.magRest);
      R.mag.rotation.set(0, 0, 0);
      this.events.onReloadEvent?.("magin");
    }
    if (t >= 1.93 && fl.in) {
      R.mag.position.copy(RIFLE.magRest);
      R.mag.rotation.set(0, 0, 0);
      R.mag.visible = true;
    }
    if (t >= 1.95 && !fl.ammo) {
      fl.ammo = true;
      const take = Math.min(MAG_SIZE - this.mag, this.reserve);
      this.mag += take;
      this.reserve -= take;
    }
    // charging handle
    const cz = -0.056;
    let pull = 0;
    if (t > 2.4 && t < 2.55) pull = easeInOut((t - 2.4) / 0.15);
    else if (t >= 2.55 && t < 2.68) pull = 1 - (t - 2.55) / 0.13;
    R.charge.position.z = cz - pull * 0.05;
    if (t > 2.55 && !fl.bolt) {
      fl.bolt = true;
      this.events.onReloadEvent?.("bolt");
    }
    void toW;
  }

  /* ---- misc ------------------------------------------------------------ */
  private updateProps(dt: number) {
    const all = [...this.props];
    if (this.weaponProp) all.push(this.weaponProp);
    for (const p of all) {
      if (p.rest) continue;
      p.vel.y -= 14 * dt;
      p.obj.position.addScaledVector(p.vel, dt);
      p.obj.rotation.x += p.ang.x * dt;
      p.obj.rotation.y += p.ang.y * dt;
      p.obj.rotation.z += p.ang.z * dt;
      const floor = p === this.weaponProp ? 0.07 : 0.04;
      if (p.obj.position.y < floor) {
        p.obj.position.y = floor;
        if (p.vel.y < -1.2) {
          p.vel.y *= -0.3;
          p.vel.x *= 0.6;
          p.vel.z *= 0.6;
          p.ang.multiplyScalar(0.5);
        } else {
          p.vel.set(0, 0, 0);
          p.ang.set(0, 0, 0);
          p.rest = true;
          // lie flat-ish
          if (p === this.weaponProp) {
            p.obj.rotation.x = 0;
            p.obj.rotation.z = Math.PI / 2 * (Math.random() > 0.5 ? 1 : -1);
          }
        }
      }
    }
    this.props = this.props.filter((p) => {
      p.life -= dt;
      if (p.life <= 0) {
        this.scene.remove(p.obj);
        return false;
      }
      return true;
    });
  }

  private updateStatus() {
    let s: RigStatus = "Idle";
    const spd = this.speed;
    if (this.dead) s = "Dead";
    else if (!this.grounded) s = "Airborne";
    else if (this.reloadT >= 0) s = "Reloading";
    else if (this.hitT > 0) s = "Hit";
    else if (this.input.crouch) s = spd > 0.3 ? "Crouch-walk" : "Crouching";
    else if (this.sprinting && spd > 1) s = "Sprinting";
    else if (spd > this.walkN * 1.4) s = "Running";
    else if (spd > 0.3) s = "Walking";
    else if (this.aimBlend > 0.6) s = "Aiming";
    this.status = s;

  }

  /* ---- faction tint + scale (enemies reuse this rig) ------------------ */
  /** Re-tint the body armour + visor so one model reads as many factions. */
  setTint(bodyHex: number, visorHex?: number) {
    if (!this.model) return;
    const body = new THREE.Color(bodyHex);
    this.model.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      const mats = Array.isArray(m.material) ? m.material : [m.material];
      mats.forEach((mat) => {
        const s = mat as THREE.MeshStandardMaterial;
        if (!s || !("color" in s)) return;
        if (/visor/i.test(s.name)) {
          if (visorHex !== undefined) {
            s.color.setHex(visorHex);
            s.emissive = new THREE.Color(visorHex).multiplyScalar(0.35);
          }
        } else {
          // multiply the authored colour so texture detail survives the tint
          s.color.copy(body);
        }
      });
    });
  }

  /** Slight height variation so no two soldiers are identical. */
  setHeightScale(f: number) {
    if (!this.model) return;
    this.model.scale.multiplyScalar(f);
    this.height = 1.82 * f;
  }

  /** World-space eye position (for enemy line-of-sight + aiming). */
  getEyePos(out = new THREE.Vector3()) {
    return out.set(this.root.position.x, this.root.position.y + this.eyeHeight, this.root.position.z);
  }

  /** advance reload clock with real dt (called from update via wrapper) */
  tickReload(dt: number) {
    if (this.reloadT >= 0) {
      this.reloadT += dt;
      if (this.reloadT >= RELOAD_TIME) {
        this.reloadT = -1;
        this.rifle.mag.position.copy(RIFLE.magRest);
        this.rifle.mag.visible = true;
        this.rifle.charge.position.z = -0.056;
      }
    }
  }
}
