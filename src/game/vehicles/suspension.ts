import * as THREE from "three";
import { clamp, damp } from "../../character/math";
import type { TrafficId } from "./catalog";

export const VEHICLE_GRAVITY = 13.8;

export interface SuspensionSpec {
  /** Natural spring frequency (rad/s) */
  omega: number;
  /** Damping ratio (0.25 bouncy .. 0.65 firm) */
  zeta: number;
  /** Max upward compression before bump-stop (m) */
  maxCompression: number;
  /** Max downward wheel droop extension (m) */
  maxDroop: number;
  /** Pitch compliance per m/s^2 longitudinal accel */
  pitchGain: number;
  /** Roll compliance per m/s^2 lateral accel */
  rollGain: number;
  /** Launch threshold factor: lower launches easier on crests */
  crestSensitivity: number;
}

export interface VehicleSuspensionState {
  spec: SuspensionSpec;
  /** Vertical chassis offset relative to nominal ground contact (m, - = compressed, + = lifted) */
  heave: number;
  heaveVel: number;
  /** Dynamic chassis pitch relative to ground/air frame (rad, + = nose down, - = nose up) */
  pitch: number;
  pitchVel: number;
  /** Dynamic chassis roll (rad, + = lean right, - = lean left) */
  roll: number;
  rollVel: number;
  /** Tracked ground slope vertical velocity while driving fast up hills/ramps */
  trackVy: number;
  prevGroundY: number;
  hasGroundSample: boolean;
  /** Airborne ballistic attitude */
  airTime: number;
  airPitch: number;
  airPitchVel: number;
  airRoll: number;
  airRollVel: number;
  /** Ground-plane slope pitch & roll sampled from 4 tire corners */
  groundPitch: number;
  groundRoll: number;
  /** Per-wheel visual vertical offset in vehicle local Y (m) */
  wheelOffsets: [number, number, number, number];
  /** Landing impulse (0..1) triggered on the frame of touchdown */
  landingImpact: number;
  bottomedOut: boolean;
}

export function getSuspensionSpec(modelId: TrafficId): SuspensionSpec {
  if (modelId === "ferrari" || modelId === "r8" || modelId === "audi") {
    return {
      omega: 14.0,
      zeta: 0.44,
      maxCompression: 0.14,
      maxDroop: 0.15,
      pitchGain: 0.0028,
      rollGain: 0.0038,
      crestSensitivity: 0.96,
    };
  }
  if (
    modelId === "rangerover" ||
    modelId === "offroad" ||
    modelId === "crossover" ||
    modelId === "van" ||
    modelId === "ambulance" ||
    modelId === "delivery" ||
    modelId === "garbage_truck" ||
    modelId === "firetruck" ||
    modelId === "semi" ||
    modelId === "kraz"
  ) {
    return {
      omega: 9.8,
      zeta: 0.35,
      maxCompression: 0.24,
      maxDroop: 0.26,
      pitchGain: 0.0052,
      rollGain: 0.0068,
      crestSensitivity: 0.88,
    };
  }
  return {
    omega: 11.8,
    zeta: 0.38,
    maxCompression: 0.18,
    maxDroop: 0.20,
    pitchGain: 0.0040,
    rollGain: 0.0052,
    crestSensitivity: 0.92,
  };
}

export function createVehicleSuspensionState(modelId: TrafficId, initY = 0): VehicleSuspensionState {
  return {
    spec: getSuspensionSpec(modelId),
    heave: 0,
    heaveVel: 0,
    pitch: 0,
    pitchVel: 0,
    roll: 0,
    rollVel: 0,
    trackVy: 0,
    prevGroundY: initY,
    hasGroundSample: false,
    airTime: 0,
    airPitch: 0,
    airPitchVel: 0,
    airRoll: 0,
    airRollVel: 0,
    groundPitch: 0,
    groundRoll: 0,
    wheelOffsets: [0, 0, 0, 0],
    landingImpact: 0,
    bottomedOut: false,
  };
}

export interface StepSuspensionParams {
  pos: THREE.Vector3;
  yaw: number;
  speed: number;
  horizSpeed: number;
  accel: number;
  latAccel: number;
  width: number;
  length: number;
  vy: number;
  airborne: boolean;
  groundAt: (x: number, z: number, y: number) => number;
  offroadBumpiness?: number;
  offroadCapability?: number;
  dt: number;
}

export interface StepSuspensionResult {
  vy: number;
  airborne: boolean;
  speed: number;
  landingImpact: number;
  bottomedOut: boolean;
  launched: boolean;
}

/**
 * Steps 4-corner terrain sampling, damped spring chassis heave/pitch/roll,
 * natural high-speed crest/hill launching (no jump button), and ballistic flight.
 */
export function stepVehicleSuspension(
  sus: VehicleSuspensionState,
  p: StepSuspensionParams,
): StepSuspensionResult {
  const dt = Math.min(Math.max(p.dt, 1e-4), 0.05);
  const sp = sus.spec;
  sus.landingImpact = 0;
  sus.bottomedOut = false;

  const fx = Math.sin(p.yaw);
  const fz = Math.cos(p.yaw);
  const lx = Math.cos(p.yaw);
  const lz = -Math.sin(p.yaw);
  const hw = p.width * 0.40;
  const hl = p.length * 0.34;
  const probeRefY = p.pos.y + 1.8;

  // Sample 4 tire contact patches + vehicle center
  const hCenterRaw = p.groundAt(p.pos.x, p.pos.z, probeRefY);
  const hCenter = hCenterRaw < -0.6 ? p.pos.y : hCenterRaw;

  const sampleCorner = (sideSign: number, endSign: number) => {
    const cx = p.pos.x + fx * (hl * endSign) + lx * (hw * sideSign);
    const cz = p.pos.z + fz * (hl * endSign) + lz * (hw * sideSign);
    const h = p.groundAt(cx, cz, probeRefY);
    if (h < -0.6) return hCenter;
    const bumpiness = p.offroadBumpiness ?? 0;
    if (bumpiness > 0.01) {
      const cap = p.offroadCapability ?? 0.35;
      const bumpAmp = bumpiness * (0.042 - cap * 0.016);
      const micro =
        Math.sin(cx * 2.3 + cz * 1.7) * Math.cos(cz * 2.9 - cx * 1.1) +
        0.45 * Math.sin(cx * 5.7 - cz * 4.9);
      return h + micro * bumpAmp;
    }
    return h;
  };

  // Corners: 0=FL, 1=FR, 2=RL, 3=RR
  const hFL = sampleCorner(1, 1);
  const hFR = sampleCorner(-1, 1);
  const hRL = sampleCorner(1, -1);
  const hRR = sampleCorner(-1, -1);

  const frontAvg = (hFL + hFR) * 0.5;
  const rearAvg = (hRL + hRR) * 0.5;
  const leftAvg = (hFL + hRL) * 0.5;
  const rightAvg = (hFR + hRR) * 0.5;

  // Ground plane average & slope angles (nose up => groundPitch < 0)
  const groundY = (hCenter * 2 + frontAvg + rearAvg) * 0.25;
  const groundPitch = Math.atan2(rearAvg - frontAvg, Math.max(0.8, hl * 2));
  const groundRoll = Math.atan2(leftAvg - rightAvg, Math.max(0.6, hw * 2));
  sus.groundPitch = groundPitch;
  sus.groundRoll = groundRoll;

  let vy = p.vy;
  let airborne = p.airborne;
  let speed = p.speed;
  let launched = false;

  if (!sus.hasGroundSample) {
    sus.hasGroundSample = true;
    sus.prevGroundY = groundY;
    sus.trackVy = 0;
  }

  const prevY = p.pos.y;
  const surfaceRate = (groundY - sus.prevGroundY) / dt;
  // Geometric slope velocity from horizontal speed & front-to-rear pitch
  const geomSlopeVy = p.speed * Math.sin(-groundPitch);

  if (airborne) {
    sus.airTime += dt;
    vy -= VEHICLE_GRAVITY * dt;
    const nextY = prevY + vy * dt;

    // Gentle aerodynamic attitude & nose-drop during flight
    sus.airPitchVel += 0.28 * dt;
    sus.airPitchVel *= Math.exp(-1.15 * dt);
    sus.airRollVel = (sus.airRollVel - sus.airRoll * 2.4 * dt) * Math.exp(-2.2 * dt);
    sus.airPitch = clamp(sus.airPitch + sus.airPitchVel * dt, -0.78, 0.78);
    sus.airRoll = clamp(sus.airRoll + sus.airRollVel * dt, -0.55, 0.55);

    // Gentle air drag
    speed *= Math.exp(-0.08 * dt);

    if (nextY <= groundY && vy <= 0.6) {
      // Touchdown! Compress suspension & trigger impact feedback
      const impactVy = Math.max(0, -vy);
      p.pos.y = groundY;
      airborne = false;
      vy = 0;

      const relPitch = sus.airPitch - groundPitch;
      const relRoll = sus.airRoll - groundRoll;
      sus.heaveVel -= impactVy * 0.72;
      sus.pitchVel += relPitch * 5.2 + (impactVy > 3 ? impactVy * 0.14 : 0);
      sus.rollVel += relRoll * 4.5;

      // Absorb energy on very hard or off-angle landings
      const badAngle = Math.abs(relPitch) * 0.35 + Math.abs(relRoll) * 0.35;
      if (impactVy > 6.5) {
        const scrub = clamp((impactVy - 6.0) * 0.022 + badAngle * 0.12, 0, 0.38);
        speed *= 1 - scrub;
      }

      sus.landingImpact = clamp((impactVy - 2.2) / 10.5, 0, 1);
      sus.bottomedOut = impactVy > 6.8;
      sus.airTime = 0;
      sus.trackVy = surfaceRate;
    } else {
      p.pos.y = nextY;
      // Relax chassis heave & extend wheels down to full droop in mid-air
      sus.heave = damp(sus.heave, 0.04, 6.5, dt);
      sus.heaveVel *= Math.exp(-4 * dt);
      sus.pitch = damp(sus.pitch, 0, 6.0, dt);
      sus.roll = damp(sus.roll, 0, 6.0, dt);
    }
  } else {
    // Grounded: blend tracked vertical velocity from terrain slope
    const effectiveSlopeVy = Math.max(surfaceRate, geomSlopeVy * 0.9);
    if (effectiveSlopeVy > sus.trackVy) {
      sus.trackVy = damp(sus.trackVy, effectiveSlopeVy, 26, dt);
    } else {
      // Only relax trackVy downward at most ~gravity (cannot pull car down faster than gravity!)
      sus.trackVy = Math.max(effectiveSlopeVy, sus.trackVy - VEHICLE_GRAVITY * sp.crestSensitivity * dt);
    }

    // Check if the car's vertical momentum carries it over a hill crest, ramp lip, or abrupt drop
    const ballisticY = prevY + sus.trackVy * dt - 0.5 * VEHICLE_GRAVITY * dt * dt;
    const gapBelowTires = ballisticY - groundY;
    const speedThreshold = 8.5; // ~30 km/h minimum for natural airtime on crests/drops
    const crestLaunch =
      p.horizSpeed > speedThreshold &&
      sus.trackVy > 0.75 &&
      gapBelowTires > sp.maxDroop * 0.42 &&
      surfaceRate < sus.trackVy - 1.2;
    const dropOffLaunch =
      p.horizSpeed > speedThreshold &&
      groundY < prevY - Math.max(0.11, sp.maxDroop * 0.65);

    if (crestLaunch || dropOffLaunch) {
      airborne = true;
      launched = true;
      vy = clamp(
        crestLaunch ? sus.trackVy * 1.05 : Math.max(0.4, sus.trackVy),
        0.5,
        Math.max(12, p.horizSpeed * 0.55),
      );
      sus.airTime = dt;
      sus.airPitch = clamp(groundPitch + sus.pitch, -0.58, 0.58);
      sus.airRoll = clamp(groundRoll + sus.roll, -0.45, 0.45);
      // Slight upward nose kick when launching off a steep convex crest
      const crestRate = clamp((sus.trackVy - surfaceRate) * 0.035, -0.55, 0.55);
      sus.airPitchVel = clamp(-crestRate + sus.pitchVel * 0.25, -0.85, 0.85);
      sus.airRollVel = clamp(sus.rollVel * 0.25, -0.65, 0.65);
      p.pos.y = prevY + vy * dt - 0.5 * VEHICLE_GRAVITY * dt * dt;
    } else {
      // Road / off-road bump excitation -> compresses springs when hitting steps, curbs, or ruts
      const stepDelta = groundY - sus.prevGroundY;
      if (Math.abs(stepDelta) > 0.004 && p.horizSpeed > 1.5) {
        const bumpGain = 7.5 + (p.offroadBumpiness ?? 0) * (1 - (p.offroadCapability ?? 0.35) * 0.55) * 6.5;
        sus.heaveVel -= clamp(stepDelta * bumpGain, -3.2, 3.2);
      }
      if ((p.offroadBumpiness ?? 0) > 0.02 && p.horizSpeed > 2.0) {
        const spdNorm = clamp(p.horizSpeed / 16, 0, 1);
        const cap = p.offroadCapability ?? 0.35;
        const rumble = (p.offroadBumpiness ?? 0) * spdNorm * (1.25 - cap * 0.65);
        const chatter = Math.sin(p.pos.x * 3.1 + p.pos.z * 2.7) * Math.cos(p.pos.z * 4.3 - p.pos.x * 2.1);
        sus.rollVel += chatter * rumble * 0.85 * dt;
      }

      p.pos.y = groundY;
      vy = 0;

      // Damped harmonic spring-damper for vertical chassis heave
      const k = sp.omega * sp.omega;
      const c = 2 * sp.zeta * sp.omega;
      const heaveAcc = -k * sus.heave - c * sus.heaveVel;
      sus.heaveVel += heaveAcc * dt;
      sus.heave += sus.heaveVel * dt;
      if (sus.heave < -sp.maxCompression) {
        sus.heave = -sp.maxCompression;
        if (sus.heaveVel < 0) sus.heaveVel *= -0.25;
      } else if (sus.heave > sp.maxDroop * 0.65) {
        sus.heave = sp.maxDroop * 0.65;
        if (sus.heaveVel > 0) sus.heaveVel *= -0.2;
      }

      // Dynamic pitch (weight transfer: nose lifts on accel, dives on braking) + body roll (leans outward in turns)
      const targetPitch = clamp(-p.accel * sp.pitchGain, -0.075, 0.085);
      const targetRoll = clamp(p.latAccel * sp.rollGain, -0.095, 0.095);
      const pitchK = k * 0.92;
      const pitchC = c * 1.08;
      sus.pitchVel += (-pitchK * (sus.pitch - targetPitch) - pitchC * sus.pitchVel) * dt;
      sus.pitch = clamp(sus.pitch + sus.pitchVel * dt, -0.14, 0.14);

      const rollK = k * 0.95;
      const rollC = c * 1.05;
      sus.rollVel += (-rollK * (sus.roll - targetRoll) - rollC * sus.rollVel) * dt;
      sus.roll = clamp(sus.roll + sus.rollVel * dt, -0.15, 0.15);
    }
  }

  sus.prevGroundY = groundY;

  // Compute per-wheel vertical offsets relative to chassis rest height
  // Corners: 0=FL (+x,+z), 1=FR (-x,+z), 2=RL (+x,-z), 3=RR (-x,-z)
  if (airborne) {
    const droop = -sp.maxDroop;
    for (let i = 0; i < 4; i++) {
      sus.wheelOffsets[i] = damp(sus.wheelOffsets[i], droop, 12, dt);
    }
  } else {
    const corners: [number, number, number][] = [
      [hw, hl, hFL],
      [-hw, hl, hFR],
      [hw, -hl, hRL],
      [-hw, -hl, hRR],
    ];
    for (let i = 0; i < 4; i++) {
      const [wx, wz, cornerH] = corners[i];
      // Expected local Y of chassis at this wheel relative to groundY
      const chassisAtCorner =
        sus.heave - wz * Math.sin(sus.pitch) + wx * Math.sin(sus.roll);
      // Terrain unevenness relative to smoothed ground plane at this corner
      const planeCornerH =
        groundY - wz * Math.sin(groundPitch) + wx * Math.sin(groundRoll);
      const terrainDelta = cornerH - planeCornerH;
      const targetOffset = clamp(terrainDelta - chassisAtCorner, -sp.maxDroop, sp.maxCompression);
      sus.wheelOffsets[i] = damp(sus.wheelOffsets[i], targetOffset, 28, dt);
    }
  }

  return {
    vy,
    airborne,
    speed,
    landingImpact: sus.landingImpact,
    bottomedOut: sus.bottomedOut,
    launched,
  };
}
