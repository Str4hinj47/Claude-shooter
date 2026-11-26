import { Easing } from "@tweenjs/tween.js";
import { createNoise2D, type NoiseFunction2D } from "simplex-noise";
import { clamp, damp, lerp } from "./math";

function mulberry32(seed: number): () => number {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

let sharedNoise2D: NoiseFunction2D | null = null;
function getSharedNoise2D(): NoiseFunction2D {
  if (!sharedNoise2D) sharedNoise2D = createNoise2D(mulberry32(0x414e494d));
  return sharedNoise2D;
}

export interface IdleNoiseSample {
  swayYaw: number;
  swayRoll: number;
  breathPitch: number;
  clavLift: number;
  headScanYaw: number;
  headScanPitch: number;
  weaponY: number;
  weaponX: number;
}

/**
 * Per-character seeded Simplex FBM generator replacing periodic Math.sin() loops
 * with non-repeating organic breathing, micro-sway, and patrol head-look motion.
 */
export class OrganicMotionNoise {
  private readonly noise: NoiseFunction2D;
  private readonly seed: number;

  constructor(seed = Math.random() * 1000) {
    this.noise = getSharedNoise2D();
    this.seed = seed;
  }

  /** 2-octave smooth FBM in [-1, 1] */
  fbm(t: number, freq: number, channel: number): number {
    const x = t * freq + this.seed;
    const y = channel * 19.37;
    return 0.68 * this.noise(x, y) + 0.32 * this.noise(x * 2.13 + 7.1, y + 3.7);
  }

  sampleIdle(t: number, idleW: number, aimBlend: number, locoBlend: number): IdleNoiseSample {
    const breathWave = this.fbm(t, 0.34, 1) * 0.72 + Math.sin(t * 1.55 + this.seed) * 0.28;
    const breathAmp = 1 + aimBlend * 0.65;
    return {
      swayYaw: this.fbm(t, 0.22, 2) * 0.045 * idleW,
      swayRoll: this.fbm(t, 0.18, 3) * 0.022 * idleW,
      breathPitch: breathWave * 0.015 * breathAmp,
      clavLift: breathWave * 0.018 + this.fbm(t, 0.28, 4) * 0.008 * (1 - locoBlend),
      headScanYaw: this.fbm(t, 0.19, 5) * 0.12 * idleW,
      headScanPitch: this.fbm(t, 0.16, 6) * 0.055 * idleW,
      weaponY: breathWave * 0.0032 * (1 + aimBlend * 0.45) + this.fbm(t, 0.55, 7) * 0.0018 * (0.4 + 0.6 * aimBlend),
      weaponX: this.fbm(t, 0.42, 8) * 0.0024 * (0.5 + 0.5 * aimBlend),
    };
  }
}

export function samplePedestrianHeadNoise(t: number, seed: number): { yaw: number; pitch: number } {
  const n = getSharedNoise2D();
  const yaw = (0.7 * n(t * 0.24 + seed, 11.3) + 0.3 * n(t * 0.51 + seed, 23.1)) * 0.28;
  const pitch = (0.7 * n(t * 0.19 + seed, 37.7) + 0.3 * n(t * 0.43 + seed, 49.9)) * 0.1;
  return { yaw, pitch };
}

export interface TakedownPose {
  active: boolean;
  torsoYaw: number;
  torsoPitch: number;
  rForward: number;
  rRight: number;
  rUp: number;
  lForward: number;
  lRight: number;
  lUp: number;
  weaponHideBlend: number;
}

/**
 * 0.50s CQC melee takedown strike + recovery curve driven by @tweenjs/tween.js Easing.
 */
export class TakedownAnimator {
  private t = -1;
  readonly duration = 0.5;

  trigger() {
    this.t = 0;
  }

  reset() {
    this.t = -1;
  }

  get active() {
    return this.t >= 0;
  }

  update(dt: number): TakedownPose {
    if (this.t < 0) {
      return {
        active: false,
        torsoYaw: 0,
        torsoPitch: 0,
        rForward: 0,
        rRight: 0,
        rUp: 0,
        lForward: 0,
        lRight: 0,
        lUp: 0,
        weaponHideBlend: 0,
      };
    }
    this.t += dt;
    if (this.t >= this.duration) {
      this.t = -1;
      return {
        active: false,
        torsoYaw: 0,
        torsoPitch: 0,
        rForward: 0,
        rRight: 0,
        rUp: 0,
        lForward: 0,
        lRight: 0,
        lUp: 0,
        weaponHideBlend: 0,
      };
    }

    const u = clamp(this.t / this.duration, 0, 1);
    // 0..0.28 windup -> 0.28..0.54 fast strike -> 0.54..1.0 recover
    let strike: number;
    if (u < 0.28) {
      strike = -0.35 * Easing.Quadratic.Out(u / 0.28);
    } else if (u < 0.54) {
      strike = lerp(-0.35, 1.0, Easing.Back.Out((u - 0.28) / 0.26));
    } else {
      strike = 1.0 - Easing.Cubic.InOut((u - 0.54) / 0.46);
    }

    const grab = u < 0.5 ? Easing.Quadratic.Out(u / 0.5) : 1 - Easing.Cubic.InOut((u - 0.5) / 0.5);
    const hideEnv = u < 0.18 ? u / 0.18 : u > 0.78 ? (1 - u) / 0.22 : 1;

    return {
      active: true,
      torsoYaw: strike * 0.48,
      torsoPitch: Math.max(0, strike) * 0.24,
      rForward: strike * 0.34,
      rRight: -strike * 0.14,
      rUp: strike * 0.08,
      lForward: grab * 0.28,
      lRight: grab * 0.16,
      lUp: grab * 0.06,
      weaponHideBlend: clamp(hideEnv, 0, 1),
    };
  }
}

export interface DrawPose {
  active: boolean;
  pitchOffset: number;
  dropOffset: number;
  rollOffset: number;
}

/**
 * Crisp 0.34s weapon equip / draw-from-holster sweep using @tweenjs/tween.js Back.Out easing.
 */
export class DrawAnimator {
  private t = -1;
  readonly duration = 0.34;

  trigger() {
    this.t = 0;
  }

  reset() {
    this.t = -1;
  }

  update(dt: number): DrawPose {
    if (this.t < 0) return { active: false, pitchOffset: 0, dropOffset: 0, rollOffset: 0 };
    this.t += dt;
    if (this.t >= this.duration) {
      this.t = -1;
      return { active: false, pitchOffset: 0, dropOffset: 0, rollOffset: 0 };
    }
    const u = clamp(this.t / this.duration, 0, 1);
    const k = 1 - Easing.Back.Out(u);
    return {
      active: true,
      pitchOffset: k * 0.48,
      dropOffset: k * 0.14,
      rollOffset: -k * 0.36,
    };
  }
}

export interface DeathJointPose {
  fallAngle: number;
  hipDrop: number;
  slideZ: number;
  kneeBuckle: number;
  spineCurl: number;
  spineTwist: number;
  headWhip: number;
  armFlailL: number;
  armFlailR: number;
  rollTilt: number;
}

/**
 * Articulated multi-joint death collapse using @tweenjs/tween.js easing curves so characters
 * buckle at the knees, slump through the spine, and bounce naturally on impact instead of
 * tipping over like a single rigid board.
 */
export function evaluateArticulatedDeath(
  deathT: number,
  kind: "back" | "front",
  twistSign: number,
): DeathJointPose {
  const buckleIn = Easing.Cubic.Out(clamp(deathT / 0.28, 0, 1));
  const dropPhase = clamp((deathT - 0.12) / 0.62, 0, 1);
  // Gravity-accelerated fall with soft ground settle bounce
  const fallEase = dropPhase < 0.82
    ? Easing.Quadratic.In(dropPhase / 0.82) * 0.94
    : lerp(0.94, 1.0, Easing.Bounce.Out((dropPhase - 0.82) / 0.18));

  const fallAngle = fallEase * (Math.PI / 2);
  const settleFade = 1 - Easing.Cubic.In(clamp((dropPhase - 0.45) / 0.55, 0, 1));
  const kneeBuckle = buckleIn * (0.28 + 0.65 * settleFade);
  const hipDrop = buckleIn * 0.22 * (1 - fallEase * 0.55);

  const sgn = kind === "back" ? -1 : 1;
  const slideZ = sgn * 0.36 * fallEase;
  const spineCurl = (kind === "back" ? -1 : 1) * (0.22 * buckleIn + 0.24 * fallEase);
  const spineTwist = twistSign * 0.26 * Easing.Cubic.Out(clamp(deathT / 0.55, 0, 1));
  const headWhip = (kind === "back" ? -0.32 : 0.28) * Math.sin(clamp(deathT / 0.45, 0, 1) * Math.PI * 0.85);
  const armFlailL = 0.28 + 0.88 * Easing.Back.Out(clamp(deathT / 0.68, 0, 1));
  const armFlailR = 0.28 + 0.88 * Easing.Back.Out(clamp(deathT / 0.72, 0, 1));
  const rollTilt = twistSign * 0.16 * fallEase;

  return {
    fallAngle,
    hipDrop,
    slideZ,
    kneeBuckle,
    spineCurl,
    spineTwist,
    headWhip,
    armFlailL,
    armFlailR,
    rollTilt,
  };
}

export interface FootPlacementState {
  liftL: number;
  liftR: number;
  hipDrop: number;
}

/**
 * Dual-foot terrain slope / stair placement solver: samples surface height beneath left and
 * right boots, drops pelvis smoothly to the lower foot so legs never hyperextend, and lifts
 * the uphill boot via two-bone IK so feet don't float or clip into stairs and hills.
 */
export function updateFootPlacement(
  prev: FootPlacementState,
  rootY: number,
  leftGroundY: number,
  rightGroundY: number,
  locoBlend: number,
  airBlend: number,
  dt: number,
): FootPlacementState {
  // Fade smoothly out at full sprint / airborne so stride mechanics remain clean
  const weight = (1 - clamp(locoBlend * 0.72, 0, 0.72)) * (1 - airBlend);
  const dL = clamp(leftGroundY - rootY, -0.34, 0.34) * weight;
  const dR = clamp(rightGroundY - rootY, -0.34, 0.34) * weight;
  const minD = Math.min(dL, dR, 0);
  const targetHipDrop = -minD;
  const targetLiftL = Math.max(0, dL - minD);
  const targetLiftR = Math.max(0, dR - minD);

  return {
    liftL: damp(prev.liftL, targetLiftL, 18, dt),
    liftR: damp(prev.liftR, targetLiftR, 18, dt),
    hipDrop: damp(prev.hipDrop, targetHipDrop, 18, dt),
  };
}
