// 1:1 Real-World 4-Wheel Vehicle Dynamics Solver
// Synthesized from arygupt/slide (Tire, Suspension, Drivetrain, Engine, DriverAids, Vehicle)
// and Avensky/avenlab-physics (combined friction ellipse, ARB load transfer):
// - 4-corner Pacejka-like similarity combined-slip tire model with load sensitivity & transient relaxation
// - Dynamic longitudinal & lateral weight transfer (CG height, roll-stiffness share, aero downforce)
// - Ackermann steering geometry + speed-sensitive rack + caster pneumatic-trail self-alignment
// - Volumetric-efficiency engine torque curve, 6/7/8-speed automatic gearbox with rev-matched downshifts
// - Velocity-constraint clutch solver + FWD / RWD / AWD torque split + clutch-pack LSD
// - Per-wheel ABS brake modulation, TCS wheelspin control, and yaw-rate ESC (handbrake/drift aware)
// - Sub-stepped at >= 480 Hz for unconditional stability from 0 to 330+ km/h.

import { getRealVehicleSpec, type RealVehicleSpec } from "./catalog";

const G = 9.81;
const AIR_DENSITY = 1.225;
const DEG_TO_RAD = Math.PI / 180;
const RAD_TO_RPM = 60 / (2 * Math.PI);
const RPM_TO_RAD = (2 * Math.PI) / 60;

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const smoothstep = (e0: number, e1: number, x: number) => {
  const t = clamp((x - e0) / Math.max(1e-6, e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
};
const approach = (cur: number, target: number, maxDelta: number) => {
  const d = target - cur;
  return Math.abs(d) <= maxDelta ? target : cur + Math.sign(d) * maxDelta;
};
const wrapAngle = (a: number) => {
  let x = a;
  while (x > Math.PI) x -= Math.PI * 2;
  while (x < -Math.PI) x += Math.PI * 2;
  return x;
};

/** Corner order: 0 = FL, 1 = FR, 2 = RL, 3 = RR */
export type WheelCorner = 0 | 1 | 2 | 3;

export interface OvertakeVehicleState {
  // Primary planar state (kept backward-compatible with VehicleSystem & HUD)
  speed: number; // body-frame forward velocity vxLocal [m/s]
  yaw: number; // world heading [rad] (0 = +Z, +yaw turns left toward +X)
  yawRate: number; // [rad/s] (+ = turning left)
  steer: number; // -1..1 steering rack position
  steerAngle: number; // center front road-wheel steer angle [rad] (+ = left)
  accel: number; // longitudinal body acceleration [m/s^2]
  latAccel: number; // lateral body acceleration [m/s^2] (+ = left)
  slip: number; // 0..1 combined tire slip intensity (for skidmarks/audio)

  // Full 2D body & world velocity
  vxLocal: number; // forward [m/s]
  vyLocal: number; // left [m/s]
  worldVx: number; // world X velocity [m/s]
  worldVz: number; // world Z velocity [m/s]
  sideslip: number; // chassis sideslip angle [rad]

  // Filtered chassis load-transfer accelerations
  filteredAx: number;
  filteredAy: number;

  // Powertrain state
  rpm: number;
  redline: number;
  gear: number; // -1 = R, 0 = N, 1..N = forward gears
  pendingGear: number;
  shiftTimer: number;
  sinceShift: number;
  upshifting: boolean;
  clutchEngagement: number;
  autoClutchClosed: boolean;
  clutchTorque: number;
  throttleLag: number;

  // 4-wheel state [FL, FR, RL, RR]
  wheelOmega: [number, number, number, number];
  deflectionX: [number, number, number, number];
  deflectionY: [number, number, number, number];
  brakeTorque: [number, number, number, number];
  wheelLoad: [number, number, number, number];
  wheelSlipRatio: [number, number, number, number];
  wheelSlipAngle: [number, number, number, number];
  wheelUtil: [number, number, number, number];
  steerAngles: [number, number]; // [FL, FR] Ackermann angles [rad]

  // Driver aid telemetry
  absPressure: [number, number, number, number];
  absModulation: [number, number, number, number];
  tcsIntegral: number;
  absActive: boolean;
  tcsActive: boolean;
  escActive: boolean;

  // Per-axle slip metrics (for front vs rear smoke/skidmarks)
  frontSlip: number;
  rearSlip: number;

  // Spec reference cached on state
  spec: RealVehicleSpec;
}

export interface FreeRoamVehicleInput {
  throttle: number; // 0..1 forward pedal
  brake: number; // 0..1 brake / reverse pedal
  steer: number; // -1..1 (+1 = left, -1 = right)
  handbrake: boolean;
}

export interface OvertakePhysicsParams {
  maxSpeed?: number;
  accel?: number;
  brake?: number;
  grip?: number;
  surfaceGrip?: number;
  rollingRes?: number;
  offroadDrag?: number;
  slopePitch?: number;
  slopeRoll?: number;
  wheelbase?: number;
  maxSteer?: number;
  understeer?: number;
  yawResponse?: number;
  steerResponse?: number;
  drag?: number;
  powerMult?: number;
  brakeMult?: number;
  realSpec?: RealVehicleSpec;
}

export function createOvertakeVehicleState(
  yaw = 0,
  spec: RealVehicleSpec = getRealVehicleSpec("golf"),
): OvertakeVehicleState {
  const fzTotal = spec.mass * G;
  const fzF = 0.5 * fzTotal * spec.frontWeightFraction;
  const fzR = 0.5 * fzTotal * (1 - spec.frontWeightFraction);

  return {
    speed: 0,
    yaw,
    yawRate: 0,
    steer: 0,
    steerAngle: 0,
    accel: 0,
    latAccel: 0,
    slip: 0,
    vxLocal: 0,
    vyLocal: 0,
    worldVx: 0,
    worldVz: 0,
    sideslip: 0,
    filteredAx: 0,
    filteredAy: 0,
    rpm: spec.idleRpm,
    redline: spec.redlineRpm,
    gear: 1,
    pendingGear: 1,
    shiftTimer: 0,
    sinceShift: 1,
    upshifting: false,
    clutchEngagement: 0,
    autoClutchClosed: false,
    clutchTorque: 0,
    throttleLag: 0,
    wheelOmega: [0, 0, 0, 0],
    deflectionX: [0, 0, 0, 0],
    deflectionY: [0, 0, 0, 0],
    brakeTorque: [0, 0, 0, 0],
    wheelLoad: [fzF, fzF, fzR, fzR],
    wheelSlipRatio: [0, 0, 0, 0],
    wheelSlipAngle: [0, 0, 0, 0],
    wheelUtil: [0, 0, 0, 0],
    steerAngles: [0, 0],
    absPressure: [1, 1, 1, 1],
    absModulation: [1, 1, 1, 1],
    tcsIntegral: 0,
    absActive: false,
    tcsActive: false,
    escActive: false,
    frontSlip: 0,
    rearSlip: 0,
    spec,
  };
}

/** Synchronize external world-space velocity & yawRate (e.g. after wall/car impact) into solver state. */
export function syncVehiclePhysicsFromWorld(
  st: OvertakeVehicleState,
  worldVx: number,
  worldVz: number,
  yaw: number,
  yawRate?: number,
): void {
  st.yaw = yaw;
  const fx = Math.sin(yaw);
  const fz = Math.cos(yaw);
  const lx = Math.cos(yaw);
  const lz = -Math.sin(yaw);
  st.vxLocal = worldVx * fx + worldVz * fz;
  st.vyLocal = worldVx * lx + worldVz * lz;
  st.worldVx = worldVx;
  st.worldVz = worldVz;
  st.speed = st.vxLocal;
  if (yawRate !== undefined) st.yawRate = yawRate;
  // Reconcile wheel angular velocity roughly on sudden external velocity changes
  const targetOmega = st.vxLocal / Math.max(0.2, st.spec.tireRadius);
  for (let i = 0; i < 4; i++) {
    if (Math.abs(st.wheelOmega[i] - targetOmega) > 25) {
      st.wheelOmega[i] = lerp(st.wheelOmega[i], targetOmega, 0.35);
    }
  }
}

/** Quarter-sine peak + quarter-sine drop to sliding grip (arygupt/slide Tire.cpp). */
function sineGripCurve(x: number, peak: number, slide: number, slideGrip: number): number {
  const s = Math.abs(x) / Math.max(1e-6, peak);
  const shape =
    s <= 1.0
      ? Math.sin(0.5 * Math.PI * s)
      : 1.0 -
        (1.0 - slideGrip) *
          Math.sin(0.5 * Math.PI * Math.min(1.0, (s - 1.0) / Math.max(0.05, slide / peak - 1.0)));
  return Math.sign(x) * shape;
}

/**
 * Evaluate combined-slip tire force via the similarity method + load sensitivity
 * + smooth low-speed contact damping so parked cars settle with zero jitter.
 */
function evaluateTire(
  spec: RealVehicleSpec,
  isFront: boolean,
  defX: number,
  defY: number,
  vxGround: number,
  vyGround: number,
  wheelSpeed: number,
  normalLoad: number,
  muScale: number,
): { fx: number; fy: number; slipRatio: number; slipAngle: number; utilization: number } {
  if (normalLoad <= 1) {
    return { fx: 0, fy: 0, slipRatio: 0, slipAngle: 0, utilization: 0 };
  }

  const relX = 0.12;
  const relY = 0.30;
  const slipRatio = defX / relX;
  const slipAngle = Math.atan(defY / relY);

  const fzNominal = 0.25 * spec.mass * G;
  const loadRatio = normalLoad / Math.max(400, fzNominal) - 1.0;
  const muBase = isFront ? spec.tireMuFront : spec.tireMuRear;
  const mu = muBase * muScale * Math.max(0.52, 1.0 - spec.loadSensitivity * loadRatio);
  const gripLimit = mu * normalLoad;

  const peakAlpha = (isFront ? spec.peakSlipAngleFrontDeg : spec.peakSlipAngleRearDeg) * DEG_TO_RAD;
  const slideAlpha = 40.0 * DEG_TO_RAD;

  const sx = slipRatio / spec.peakSlipRatio;
  const sy = slipAngle / peakAlpha;
  const s = Math.max(Math.hypot(sx, sy), 1e-9);

  let fx = gripLimit * (sx / s) * sineGripCurve(s * spec.peakSlipRatio, spec.peakSlipRatio, 1.0, spec.slideGripFactor);
  let fy = gripLimit * (sy / s) * sineGripCurve(s * peakAlpha, peakAlpha, slideAlpha, spec.slideGripFactor);

  // Smooth fading contact damping below 3.0 m/s prevents standstill ringing
  const slipVx = vxGround - wheelSpeed;
  const lowSpeed = 1.0 - smoothstep(0.0, 3.0, Math.abs(vxGround));
  if (lowSpeed > 0) {
    const dampScale = spec.mass / 1350;
    fx -= 1200 * dampScale * lowSpeed * slipVx;
    fy -= 4500 * dampScale * lowSpeed * vyGround;
    const mag = Math.hypot(fx, fy);
    if (mag > gripLimit) {
      const k = gripLimit / mag;
      fx *= k;
      fy *= k;
    }
  }

  return {
    fx,
    fy,
    slipRatio,
    slipAngle,
    utilization: Math.hypot(fx, fy) / Math.max(1, gripLimit),
  };
}

/** Realistic volumetric-efficiency SI/turbo engine torque curve + pumping/friction drag. */
function evaluateEngineTorque(
  spec: RealVehicleSpec,
  rpm: number,
  throttle: number,
  torqueCut: number,
  powerMult: number,
): number {
  const peakRpm = spec.peakTorqueRpm;
  const redline = spec.redlineRpm;
  let ve: number;
  if (rpm < peakRpm) {
    const t = (peakRpm - rpm) / Math.max(500, peakRpm);
    // Broad midrange plateau (especially turbo/V8) with smooth spool from idle
    ve = 1.0 - 0.34 * t * t;
  } else {
    const t = (rpm - peakRpm) / Math.max(500, redline - peakRpm);
    ve = Math.max(0.55, 1.0 - 0.24 * t * t);
  }

  // Soft rev limiter near limiterRpm
  let limiterMult = 1.0;
  if (rpm > spec.redlineRpm) {
    limiterMult = clamp(1.0 - (rpm - spec.redlineRpm) / Math.max(120, spec.limiterRpm - spec.redlineRpm), 0, 1);
  }

  const indicated =
    spec.peakTorqueNm *
    powerMult *
    ve *
    throttle *
    (1 - clamp(torqueCut, 0, 1)) *
    limiterMult;

  // Idle governor torque so the engine never stalls at rest
  const idleError = spec.idleRpm - rpm;
  const idleSupport = idleError > 0 ? clamp(idleError * 0.28, 0, spec.peakTorqueNm * 0.45) : 0;

  // Engine friction + pumping losses (stronger when throttle is closed = engine braking)
  const spinFactor = Math.tanh((rpm * RPM_TO_RAD) / 6.0);
  const rpmFrac = clamp(rpm / redline, 0, 1.2);
  const pumpingLoss = spec.engineBrakeNm * (0.35 + 0.65 * rpmFrac) * (1.0 - 0.72 * throttle) * spinFactor;

  return indicated + idleSupport - pumpingLoss;
}

function gearRatioFor(spec: RealVehicleSpec, gear: number): number {
  if (gear === 0) return 0;
  if (gear < 0) return -spec.reverseRatio * spec.finalDrive;
  const idx = clamp(gear - 1, 0, spec.gearRatios.length - 1);
  return spec.gearRatios[idx] * spec.finalDrive;
}

function stepSingleSubstep(
  st: OvertakeVehicleState,
  input: FreeRoamVehicleInput,
  p: OvertakePhysicsParams,
  dt: number,
): void {
  const spec = st.spec;
  const powerMult =
    p.powerMult ??
    (p.accel !== undefined ? clamp(p.accel / (p.realSpec ? 9.2 : 6.2), 0.55, 2.1) : 1.0);
  const brakeMult = p.brakeMult ?? (p.brake !== undefined ? clamp(p.brake / 10.8, 0.65, 1.65) : 1.0);
  const gripParam = p.grip ?? 1.0;
  const surfaceGrip = clamp(p.surfaceGrip ?? 1.0, 0.25, 1.15);
  const muScale = surfaceGrip * clamp(gripParam / 1.05, 0.72, 1.35);

  const throttlePedal = clamp(input.throttle, 0, 1);
  const brakePedal = clamp(input.brake, 0, 1);
  const handbrake = !!input.handbrake;

  // ---------------------------------------------------------------------------
  // 1. Intuitive Automatic Drive / Reverse Pedal Arbitration (W = Gas, S = Brake/Reverse)
  // ---------------------------------------------------------------------------
  let driveThrottle = 0;
  let footBrake = 0;
  const fwdSpd = st.vxLocal;

  if (st.gear < 0) {
    // Currently in Reverse gear: S = reverse throttle, W = brake back to rest
    if (throttlePedal > 0.05 || handbrake) {
      footBrake = throttlePedal;
      driveThrottle = 0;
      if (fwdSpd > -0.45 && throttlePedal > 0.05 && !handbrake) {
        st.gear = 1;
        st.pendingGear = 1;
        st.shiftTimer = 0;
        driveThrottle = throttlePedal;
        footBrake = 0;
      }
    } else {
      driveThrottle = brakePedal;
      footBrake = 0;
    }
  } else {
    // Forward gears (1..N): W = throttle, S = foot brake (or engage Reverse at standstill)
    if (fwdSpd <= 0.65 && brakePedal > 0.05 && throttlePedal <= 0.05 && !handbrake) {
      st.gear = -1;
      st.pendingGear = -1;
      st.shiftTimer = 0;
      st.autoClutchClosed = false;
      driveThrottle = brakePedal;
      footBrake = 0;
    } else {
      driveThrottle = throttlePedal;
      footBrake = brakePedal;
    }
  }

  // Electronic speed governor near CarSpec.maxSpeed (keeps city gameplay speeds faithful)
  const speedCap = p.maxSpeed ?? 64;
  if (st.gear > 0 && st.vxLocal > speedCap * 0.96) {
    const govCut = clamp((st.vxLocal - speedCap * 0.96) / Math.max(1.5, speedCap * 0.06), 0, 1);
    driveThrottle *= 1 - govCut;
  } else if (st.gear < 0 && -st.vxLocal > speedCap * 0.34) {
    const revCap = speedCap * 0.34;
    const govCut = clamp((-st.vxLocal - revCap * 0.92) / Math.max(1.0, revCap * 0.1), 0, 1);
    driveThrottle *= 1 - govCut;
  }

  // ---------------------------------------------------------------------------
  // 2. Steering Rack, Speed-Sensitive Lock, Caster Self-Align & Ackermann
  // ---------------------------------------------------------------------------
  const rawSteer = clamp(input.steer, -1, 1);
  const shapedSteer = Math.sign(rawSteer) * Math.pow(Math.abs(rawSteer), 1.65);
  const steerRate = p.steerResponse ? clamp(p.steerResponse * 0.72, 3.6, 6.2) : clamp(spec.steerRate * 1.35, 3.8, 6.0);
  st.steer = approach(st.steer, shapedSteer, steerRate * dt);

  const speedAbs = Math.hypot(st.vxLocal, st.vyLocal);
  const baseMaxSteer = p.maxSteer ?? spec.maxSteerDeg * DEG_TO_RAD;
  const maxSteer =
    baseMaxSteer *
    Math.max(spec.minSteerFactor, 1.0 / (1.0 + Math.pow(speedAbs / spec.steerSpeedRef, 2)));

  // Pneumatic-trail / caster countersteer: when rear steps out and driver releases/feathers A/D,
  // front wheels naturally align toward the ground track vector.
  const slipVelocityAngle =
    speedAbs > 3.5 ? Math.atan2(st.vyLocal, Math.max(2.5, Math.abs(st.vxLocal))) : 0;
  const selfAlignBlend = (1.0 - smoothstep(0.08, 0.48, Math.abs(rawSteer))) * spec.casterSelfAlign;
  const counterSteerAngle = clamp(slipVelocityAngle * selfAlignBlend, -maxSteer * 0.85, maxSteer * 0.85);

  st.steerAngle = clamp(st.steer * maxSteer + counterSteerAngle, -baseMaxSteer, baseMaxSteer);

  // Ackermann geometry (inside wheel turns tighter around rear-axle instant center)
  const wb = p.wheelbase ?? spec.wheelbase;
  const halfTrackF = 0.5 * spec.frontTrack;
  const absAngle = Math.abs(st.steerAngle);
  let innerSteer = absAngle;
  let outerSteer = absAngle;
  if (absAngle > 1e-5) {
    const turnRadius = wb / Math.tan(absAngle);
    innerSteer = lerp(absAngle, Math.atan(wb / Math.max(0.4, turnRadius - halfTrackF)), spec.ackermann);
    outerSteer = lerp(absAngle, Math.atan(wb / (turnRadius + halfTrackF)), spec.ackermann);
  }
  const sSign = Math.sign(st.steerAngle);
  const turningLeft = st.steerAngle > 0;
  st.steerAngles[0] = sSign * (turningLeft ? innerSteer : outerSteer); // FL (+y)
  st.steerAngles[1] = sSign * (turningLeft ? outerSteer : innerSteer); // FR (-y)

  // ---------------------------------------------------------------------------
  // 3. Corner Coordinates & Contact-Patch Velocities
  // ---------------------------------------------------------------------------
  const cgToFront = wb * (1 - spec.frontWeightFraction);
  const cgToRear = wb * spec.frontWeightFraction;
  const halfTrackR = 0.5 * spec.rearTrack;

  const cornerX = [cgToFront, cgToFront, -cgToRear, -cgToRear];
  const cornerY = [halfTrackF, -halfTrackF, halfTrackR, -halfTrackR];
  const cornerSteer = [st.steerAngles[0], st.steerAngles[1], 0, 0];

  const groundVx: [number, number, number, number] = [0, 0, 0, 0];
  const groundVy: [number, number, number, number] = [0, 0, 0, 0];
  for (let i = 0; i < 4; i++) {
    // v_contact = v_body + omega_z x r_i  => vx_c = vx - yawRate*y, vy_c = vy + yawRate*x
    const cx = st.vxLocal - st.yawRate * cornerY[i];
    const cy = st.vyLocal + st.yawRate * cornerX[i];
    const sa = cornerSteer[i];
    const c = Math.cos(sa);
    const s = Math.sin(sa);
    // Rotate body contact velocity into wheel frame (forward along wheel, left perpendicular)
    groundVx[i] = cx * c + cy * s;
    groundVy[i] = -cx * s + cy * c;
  }

  // ---------------------------------------------------------------------------
  // 4. 4-Corner Normal Loads (Static + Dynamic Longitudinal/Lateral Transfer + Aero)
  // ---------------------------------------------------------------------------
  const aeroSpeedSq = st.vxLocal * st.vxLocal + st.vyLocal * st.vyLocal;
  const downforce = 0.5 * AIR_DENSITY * spec.downforceArea * aeroSpeedSq;
  const downF = 0.5 * downforce * spec.aeroFrontBalance;
  const downR = 0.5 * downforce * (1 - spec.aeroFrontBalance);

  const slopePitch = clamp(p.slopePitch ?? 0, -0.65, 0.65);
  const slopeRoll = clamp(p.slopeRoll ?? 0, -0.55, 0.55);
  const slopeCos = Math.max(0.45, Math.cos(slopePitch) * Math.cos(slopeRoll));
  const staticTotal = spec.mass * G * slopeCos;
  const staticF = 0.5 * staticTotal * spec.frontWeightFraction;
  const staticR = 0.5 * staticTotal * (1 - spec.frontWeightFraction);

  // Pitch/roll suspension lag (~65 ms) makes load transfer progressive on turn-in & braking
  const transferAlpha = 1 - Math.exp(-dt / 0.065);
  st.filteredAx += (st.accel - st.filteredAx) * transferAlpha;
  st.filteredAy += (st.latAccel - st.filteredAy) * transferAlpha;

  const longTransfer = (spec.mass * st.filteredAx * spec.cgHeight) / (2 * wb);
  const latTotal = (spec.mass * st.filteredAy * spec.cgHeight) / Math.max(1.0, 0.5 * (spec.frontTrack + spec.rearTrack));
  const latTransferF = latTotal * spec.frontRollShare;
  const latTransferR = latTotal * (1 - spec.frontRollShare);

  // +filteredAy (left turn centripetal accel -> outward roll loads RIGHT side [-y])
  st.wheelLoad[0] = Math.max(0, staticF + downF - longTransfer - latTransferF); // FL
  st.wheelLoad[1] = Math.max(0, staticF + downF - longTransfer + latTransferF); // FR
  st.wheelLoad[2] = Math.max(0, staticR + downR + longTransfer - latTransferR); // RL
  st.wheelLoad[3] = Math.max(0, staticR + downR + longTransfer + latTransferR); // RR

  // ---------------------------------------------------------------------------
  // 5. Evaluate Tire Forces from Relaxed Contact-Patch State
  // ---------------------------------------------------------------------------
  const tireR = spec.tireRadius;
  const tireFx: [number, number, number, number] = [0, 0, 0, 0];
  const tireFy: [number, number, number, number] = [0, 0, 0, 0];

  for (let i = 0; i < 4; i++) {
    const out = evaluateTire(
      spec,
      i < 2,
      st.deflectionX[i],
      st.deflectionY[i],
      groundVx[i],
      groundVy[i],
      st.wheelOmega[i] * tireR,
      st.wheelLoad[i],
      muScale,
    );
    tireFx[i] = out.fx;
    tireFy[i] = out.fy;
    st.wheelSlipRatio[i] = out.slipRatio;
    st.wheelSlipAngle[i] = out.slipAngle;
    st.wheelUtil[i] = out.utilization;
  }

  // ---------------------------------------------------------------------------
  // 6. Driver Aids: ABS, TCS, ESC
  // ---------------------------------------------------------------------------
  // 6a. ABS (per-wheel PI brake pressure modulator targeting 10% braking slip)
  st.absActive = false;
  const absArmed = spec.absEnabled && footBrake > 0.02;
  for (let i = 0; i < 4; i++) {
    // Handbrake locks rear wheels directly without ABS interference
    if (i >= 2 && handbrake) {
      st.absPressure[i] = 1;
      st.absModulation[i] = 1;
      continue;
    }
    const gSpd = groundVx[i];
    if (!absArmed || Math.abs(gSpd) < 2.0) {
      st.absPressure[i] = 1;
      st.absModulation[i] = 1;
      continue;
    }
    const sr = ((st.wheelOmega[i] * tireR - gSpd) / Math.max(Math.abs(gSpd), 0.5)) * Math.sign(gSpd);
    const excess = -sr - 0.10;
    const rate = clamp(-38.0 * excess, -14.0, 5.5);
    st.absPressure[i] = clamp(st.absPressure[i] + rate * dt, 0, 1);
    st.absModulation[i] = clamp(st.absPressure[i] - 5.5 * excess, 0, 1);
    if (st.absModulation[i] < 0.995) st.absActive = true;
  }

  // 6b. TCS (monitors driven-wheel slip; holds near peak tire grip without bogging launch)
  let tcsCut = 0;
  st.tcsActive = false;
  if (spec.tcsEnabled && driveThrottle > 0.05 && !handbrake) {
    let worstExcess = -1;
    const drivenStart = spec.drivetrain === "RWD" ? 2 : 0;
    const drivenEnd = spec.drivetrain === "FWD" ? 2 : 4;
    const driftingNow = Math.abs(slipVelocityAngle) > 0.18;
    const tcsTarget = driftingNow ? 0.22 : 0.14;
    for (let i = drivenStart; i < drivenEnd; i++) {
      const wSpd = st.wheelOmega[i] * tireR;
      const gSpd = groundVx[i];
      const slipSpd = (wSpd - gSpd) * Math.sign(wSpd || 1);
      const err =
        Math.abs(gSpd) > 3.0
          ? ((wSpd - gSpd) / Math.max(Math.abs(gSpd), 0.5)) * Math.sign(gSpd) - tcsTarget
          : (slipSpd - 1.6) / 2.5;
      worstExcess = Math.max(worstExcess, err);
    }
    // Anti-bog: don't choke engine below launch powerband
    const antiBogFloor = Math.max(spec.idleRpm + 950, spec.peakTorqueRpm * 0.42);
    const bogGuard = smoothstep(antiBogFloor - 350, antiBogFloor + 350, st.rpm);
    const tcsLimit = (driftingNow ? spec.tcsMaxCut * 0.35 : Math.max(spec.tcsMaxCut, 0.90)) * bogGuard;
    st.tcsIntegral = clamp(st.tcsIntegral + 10.0 * worstExcess * dt, 0, tcsLimit);
    tcsCut = clamp(3.5 * worstExcess + st.tcsIntegral, 0, tcsLimit);
    st.tcsActive = tcsCut > 0.05;
  } else {
    st.tcsIntegral = 0;
  }

  // 6c. ESC (bicycle yaw-rate reference; suspends during handbrake/active drift)
  const escBrake: [number, number, number, number] = [0, 0, 0, 0];
  let escCut = 0;
  st.escActive = false;
  if (spec.escEnabled && !handbrake && st.vxLocal > 6.0 && Math.abs(slipVelocityAngle) < 0.28) {
    const yawRefRaw =
      (st.vxLocal * st.steerAngle) / (wb + spec.escUndersteerGrad * st.vxLocal * st.vxLocal);
    const yawLimit = (0.88 * G * muScale) / Math.max(2, st.vxLocal);
    const yawRef = clamp(yawRefRaw, -yawLimit, yawLimit);
    const dir = Math.abs(yawRef) > 0.025 ? Math.sign(yawRef) : Math.sign(st.yawRate);
    if (dir !== 0) {
      const err = (st.yawRate - yawRef) * dir;
      const deadband = 0.08 + 0.12 * Math.abs(yawRef);
      if (Math.abs(err) > deadband) {
        const torque = Math.min(1700, spec.escGain * (Math.abs(err) - deadband));
        const leftTurn = dir > 0;
        if (err > 0) {
          // Oversteer: brake outside front wheel
          escBrake[leftTurn ? 1 : 0] = torque;
          escCut = Math.min(0.45, 1.6 * (err - deadband));
        } else {
          // Understeer: brake inside rear wheel to tuck nose in
          escBrake[leftTurn ? 2 : 3] = torque;
        }
        st.escActive = true;
      }
    }
  }

  // ---------------------------------------------------------------------------
  // 7. Automatic Gearbox, Velocity-Constraint Clutch, Engine & Differential
  // ---------------------------------------------------------------------------
  const drivenOmega =
    spec.drivetrain === "FWD"
      ? 0.5 * (st.wheelOmega[0] + st.wheelOmega[1])
      : spec.drivetrain === "RWD"
        ? 0.5 * (st.wheelOmega[2] + st.wheelOmega[3])
        : 0.25 * (st.wheelOmega[0] + st.wheelOmega[1] + st.wheelOmega[2] + st.wheelOmega[3]);

  st.sinceShift += dt;
  let shiftCut = 0;
  let shiftBlip = 0;
  let targetClutch = 1.0;
  let engageRate = 7.0;

  if (st.shiftTimer > 0) {
    const progress = 1.0 - st.shiftTimer / Math.max(0.02, spec.shiftTime);
    if (progress >= 0.4) st.gear = st.pendingGear;
    if (!st.upshifting && st.pendingGear > 0) {
      const matchRpm = Math.abs(gearRatioFor(spec, st.pendingGear) * drivenOmega) * RAD_TO_RPM;
      if (st.rpm < matchRpm) shiftBlip = 0.7;
    }
    if (progress < 0.4) targetClutch = 0.0;
    engageRate = 1.0 / Math.max(0.02, 0.6 * spec.shiftTime);
    st.shiftTimer = Math.max(0, st.shiftTimer - dt);
    if (st.shiftTimer === 0) st.sinceShift = 0;
  }

  const G_ratio = gearRatioFor(spec, st.gear);
  const clutchSlip = st.rpm * RPM_TO_RAD - G_ratio * drivenOmega;

  if (st.upshifting) {
    if (st.shiftTimer > 0 || Math.abs(clutchSlip) > 25) shiftCut = 0.85;
    if (st.shiftTimer === 0 && (Math.abs(clutchSlip) <= 25 || st.sinceShift > 0.12)) {
      st.upshifting = false;
    }
  }

  if (st.gear === 0 || st.rpm < spec.idleRpm + 80) st.autoClutchClosed = false;
  if (!st.autoClutchClosed && st.gear !== 0 && st.shiftTimer === 0 && st.clutchEngagement > 0.25 && Math.abs(clutchSlip) < 18 && st.rpm > spec.idleRpm + 200) {
    st.autoClutchClosed = true;
  }
  if (targetClutch > 0 && !st.autoClutchClosed) {
    const launchStart = spec.idleRpm + 50;
    const launchFull = lerp(spec.idleRpm + 550, Math.min(spec.peakTorqueRpm * 0.85, spec.idleRpm + 1350), driveThrottle);
    targetClutch = Math.max(0.22, smoothstep(launchStart, Math.max(launchStart + 250, launchFull), st.rpm));
  }
  if (handbrake && st.gear > 0) {
    // Disengage clutch when yanking handbrake so rear wheel lockup doesn't stall the engine
    targetClutch = 0;
  }
  const rate = targetClutch > st.clutchEngagement ? engageRate : 20.0;
  st.clutchEngagement = approach(st.clutchEngagement, targetClutch, rate * dt);

  // Automatic shift schedule (forward gears 1..N)
  if (st.gear > 0 && st.shiftTimer === 0) {
    if (!st.autoClutchClosed && st.gear > 1 && !handbrake) {
      st.pendingGear = 1;
      st.upshifting = false;
      st.shiftTimer = spec.shiftTime;
    } else if (st.autoClutchClosed) {
      const drivelineRpm = Math.abs(G_ratio * drivenOmega) * RAD_TO_RPM;
      const upRpm = lerp(spec.upshiftLightRpm, spec.upshiftFullRpm, driveThrottle);
      const downRpm = lerp(spec.downshiftLightRpm, spec.downshiftFullRpm, Math.max(driveThrottle, 0.85 * footBrake));
      const maxGears = spec.gearRatios.length;

      if (drivelineRpm > upRpm && st.gear < maxGears && st.sinceShift > 0.45) {
        st.upshifting = true;
        st.pendingGear = st.gear + 1;
        st.shiftTimer = spec.shiftTime;
      } else if (st.gear > 1 && drivelineRpm < downRpm && st.sinceShift > 0.22) {
        let lower = st.gear - 1;
        while (lower > 1 && Math.abs(gearRatioFor(spec, lower) * drivenOmega) * RAD_TO_RPM < downRpm) {
          lower--;
        }
        const newRpm = Math.abs(gearRatioFor(spec, lower) * drivenOmega) * RAD_TO_RPM;
        if (newRpm < spec.limiterRpm - 250 && newRpm < 0.92 * upRpm) {
          st.upshifting = false;
          st.pendingGear = lower;
          st.shiftTimer = spec.shiftTime;
        }
      }
    }
  }

  // Throttle actuator & engine torque
  const effThrottle = Math.max(driveThrottle, shiftBlip);
  st.throttleLag += (effThrottle - st.throttleLag) * (1 - Math.exp(-dt / 0.038));
  const totalCut = Math.max(tcsCut, escCut, shiftCut);
  const engineTorque = evaluateEngineTorque(spec, st.rpm, st.throttleLag, totalCut, powerMult);

  // Rolling resistance + tire reaction torque on each wheel
  const rollingCoeff = clamp(p.rollingRes ?? 0.013, 0.008, 0.16);
  const extWheelTorque: [number, number, number, number] = [0, 0, 0, 0];
  for (let i = 0; i < 4; i++) {
    const rolling = rollingCoeff * st.wheelLoad[i] * tireR * Math.tanh((st.wheelOmega[i] * tireR) / 0.3);
    extWheelTorque[i] = -tireFx[i] * tireR - rolling;
  }

  // Velocity-constraint clutch solver
  const clutchMax = Math.max(spec.peakTorqueNm * 1.45 * powerMult, 420);
  const capacity = clutchMax * st.clutchEngagement * st.clutchEngagement;
  let totalDriveTorque = 0;

  if (G_ratio === 0 || capacity <= 1e-3) {
    st.clutchTorque = 0;
  } else {
    const eta = st.clutchTorque * st.rpm >= 0 ? spec.drivetrainEfficiency : 1 / spec.drivetrainEfficiency;
    const Ie = spec.engineInertia;
    const Iw = spec.wheelInertia;
    let avgExt = 0;
    let drivenCount = 2;
    if (spec.drivetrain === "FWD") avgExt = 0.5 * (extWheelTorque[0] + extWheelTorque[1]);
    else if (spec.drivetrain === "RWD") avgExt = 0.5 * (extWheelTorque[2] + extWheelTorque[3]);
    else {
      avgExt = 0.25 * (extWheelTorque[0] + extWheelTorque[1] + extWheelTorque[2] + extWheelTorque[3]);
      drivenCount = 4;
    }
    const num = clutchSlip / dt + engineTorque / Ie - (G_ratio * avgExt) / Iw;
    const denom = 1 / Ie + (eta * G_ratio * G_ratio) / (drivenCount * Iw);
    const lockT = num / denom;
    st.clutchTorque = clamp(lockT, -capacity, capacity);
    totalDriveTorque = eta * G_ratio * st.clutchTorque;
  }

  // Integrate engine RPM
  const omegaEngine = Math.max(
    spec.idleRpm * 0.65 * RPM_TO_RAD,
    st.rpm * RPM_TO_RAD + ((engineTorque - st.clutchTorque) / spec.engineInertia) * dt,
  );
  st.rpm = clamp(omegaEngine * RAD_TO_RPM, spec.idleRpm * 0.65, spec.limiterRpm + 200);

  // Split drive torque across axles (FWD / RWD / AWD) and left/right via LSD
  const driveTorque: [number, number, number, number] = [0, 0, 0, 0];
  let frontDrive = 0;
  let rearDrive = 0;
  if (spec.drivetrain === "FWD") frontDrive = totalDriveTorque;
  else if (spec.drivetrain === "RWD") rearDrive = totalDriveTorque;
  else {
    frontDrive = totalDriveTorque * spec.awdFrontTorqueShare;
    rearDrive = totalDriveTorque * (1 - spec.awdFrontTorqueShare);
  }

  if (Math.abs(frontDrive) > 1e-4 || spec.drivetrain !== "RWD") {
    const fLimit = spec.lsdPreload * 0.5 + spec.lsdPowerLock * 0.5 * Math.abs(frontDrive);
    const fLsd = clamp(spec.lsdViscous * 0.5 * (st.wheelOmega[0] - st.wheelOmega[1]), -fLimit, fLimit);
    driveTorque[0] = 0.5 * (frontDrive - fLsd);
    driveTorque[1] = 0.5 * (frontDrive + fLsd);
  }
  if (Math.abs(rearDrive) > 1e-4 || spec.drivetrain !== "FWD") {
    const rLimit = spec.lsdPreload + spec.lsdPowerLock * Math.abs(rearDrive);
    const rLsd = clamp(spec.lsdViscous * (st.wheelOmega[2] - st.wheelOmega[3]), -rLimit, rLimit);
    driveTorque[2] = 0.5 * (rearDrive - rLsd);
    driveTorque[3] = 0.5 * (rearDrive + rLsd);
  }

  // ---------------------------------------------------------------------------
  // 8. Wheel Spin + Coulomb Brakes + Semi-Implicit Tire Relaxation
  // ---------------------------------------------------------------------------
  const hydraulic = 1 - Math.exp(-dt / 0.032);
  // Subtle standstill park-hold when driver isn't touching gas or reverse (releases naturally on steep slopes)
  const gentleSlope = Math.abs(slopePitch) < 0.22 && Math.abs(slopeRoll) < 0.22;
  const idleHold = gentleSlope && speedAbs < 0.35 && throttlePedal < 0.02 && brakePedal < 0.02 && !handbrake ? 450 : 0;

  for (let i = 0; i < 4; i++) {
    const maxBrk = (i < 2 ? spec.maxBrakeTorqueFront : spec.maxBrakeTorqueRear) * brakeMult;
    let brkCmd = footBrake * maxBrk * st.absModulation[i] + escBrake[i] + idleHold;
    if (i >= 2 && handbrake) brkCmd += spec.handbrakeTorque;

    st.brakeTorque[i] += (brkCmd - st.brakeTorque[i]) * hydraulic;

    st.wheelOmega[i] += ((extWheelTorque[i] + driveTorque[i]) / spec.wheelInertia) * dt;
    const brakeDelta = (st.brakeTorque[i] / spec.wheelInertia) * dt;
    st.wheelOmega[i] =
      Math.abs(st.wheelOmega[i]) <= brakeDelta
        ? 0
        : st.wheelOmega[i] - Math.sign(st.wheelOmega[i]) * brakeDelta;

    // Implicit contact-patch deflection decay (unconditionally stable at 0 m/s)
    const relaxSpeed = Math.max(Math.abs(groundVx[i]), Math.abs(st.wheelOmega[i] * tireR), 1.0);
    const sx = 0.12;
    const sy = 0.30;
    const ux = (st.deflectionX[i] + (st.wheelOmega[i] * tireR - groundVx[i]) * dt) / (1 + (relaxSpeed * dt) / sx);
    const uy = (st.deflectionY[i] - groundVy[i] * dt) / (1 + (Math.abs(groundVx[i]) * dt) / sy);
    st.deflectionX[i] = clamp(ux, -sx * 1.5, sx * 1.5);
    st.deflectionY[i] = clamp(uy, -sy * 1.732, sy * 1.732);
  }

  // ---------------------------------------------------------------------------
  // 9. Sum Tire Forces in Body Frame + Aerodynamic Drag -> Planar Integration
  // ---------------------------------------------------------------------------
  let sumFx = 0;
  let sumFy = 0;
  let yawMoment = 0;
  for (let i = 0; i < 4; i++) {
    const sa = cornerSteer[i];
    const c = Math.cos(sa);
    const s = Math.sin(sa);
    const bFx = tireFx[i] * c - tireFy[i] * s;
    const bFy = tireFx[i] * s + tireFy[i] * c;
    sumFx += bFx;
    sumFy += bFy;
    // Yaw moment: +x (front) * +Fy (left) = +yaw (left); +y (left) * -Fx (braking) = +yaw (left)
    yawMoment += cornerX[i] * bFy - cornerY[i] * bFx;
  }

  // Aerodynamic drag + off-road soil/sand viscous drag + real terrain slope gravity
  const airSpd = Math.hypot(st.vxLocal, st.vyLocal);
  const dragArea = spec.dragArea;
  const dragScale = p.drag ? clamp(p.drag / 0.0008, 0.7, 1.5) : 1.0;
  const aeroDrag = -0.5 * AIR_DENSITY * dragArea * dragScale * airSpd;
  const soilDrag = -clamp(p.offroadDrag ?? 0, 0, 0.28) * spec.mass;
  sumFx += st.vxLocal * (aeroDrag + soilDrag);
  sumFy += st.vyLocal * (aeroDrag + soilDrag * 0.7);
  if (Math.abs(slopePitch) > 0.005 || Math.abs(slopeRoll) > 0.005) {
    sumFx += spec.mass * G * Math.sin(slopePitch);
    sumFy -= spec.mass * G * Math.sin(slopeRoll);
  }

  const ax = sumFx / spec.mass;
  const ay = sumFy / spec.mass;
  st.accel = ax;
  st.latAccel = ay;

  // Integrate body-frame velocity (accounting for rotating reference frame Coriolis term!)
  // dv_body/dt = a_body - omega x v_body => dvx/dt = ax + yawRate*vy, dvy/dt = ay - yawRate*vx
  st.vxLocal += (ax + st.yawRate * st.vyLocal) * dt;
  st.vyLocal += (ay - st.yawRate * st.vxLocal) * dt;
  st.yawRate += (yawMoment / spec.yawInertia) * dt;

  // Clean standstill snap when idle-hold brings velocity near zero
  if (idleHold > 0 && Math.hypot(st.vxLocal, st.vyLocal) < 0.06 && Math.abs(st.yawRate) < 0.03) {
    st.vxLocal = 0;
    st.vyLocal = 0;
    st.yawRate = 0;
  }

  st.yaw = wrapAngle(st.yaw + st.yawRate * dt);
  st.speed = st.vxLocal;
  st.sideslip = speedAbs > 0.6 ? Math.atan2(st.vyLocal, Math.abs(st.vxLocal)) : 0;

  // Reconstruct world-space velocity (yaw=0 -> +Z, +yaw -> +X left)
  const fxW = Math.sin(st.yaw);
  const fzW = Math.cos(st.yaw);
  const lxW = Math.cos(st.yaw);
  const lzW = -Math.sin(st.yaw);
  st.worldVx = st.vxLocal * fxW + st.vyLocal * lxW;
  st.worldVz = st.vxLocal * fzW + st.vyLocal * lzW;

  // Compute front, rear, and overall slip metrics for skidmarks, smoke & audio
  const fSlip = Math.max(
    Math.max(0, st.wheelUtil[0] - 0.85) / 0.15,
    Math.max(0, st.wheelUtil[1] - 0.85) / 0.15,
    Math.abs(st.wheelSlipRatio[0]) > 0.2 ? 0.7 : 0,
    Math.abs(st.wheelSlipRatio[1]) > 0.2 ? 0.7 : 0,
  );
  const rSlip = Math.max(
    Math.max(0, st.wheelUtil[2] - 0.85) / 0.15,
    Math.max(0, st.wheelUtil[3] - 0.85) / 0.15,
    Math.abs(st.wheelSlipRatio[2]) > 0.2 ? 0.8 : 0,
    Math.abs(st.wheelSlipRatio[3]) > 0.2 ? 0.8 : 0,
    handbrake && speedAbs > 3.5 ? 0.95 : 0,
  );
  st.frontSlip = clamp(fSlip, 0, 1);
  st.rearSlip = clamp(rSlip, 0, 1);
  st.slip = clamp(
    Math.max(
      st.frontSlip * 0.75,
      st.rearSlip,
      smoothstep(0.10, 0.45, Math.abs(st.sideslip)),
    ),
    0,
    1,
  );
}

/**
 * Steps the 1:1 4-wheel real-world vehicle physics solver using internal >= 960 Hz sub-steps.
 */
export function stepFreeRoamVehicle(
  st: OvertakeVehicleState,
  input: FreeRoamVehicleInput,
  p: OvertakePhysicsParams,
  dt: number,
): OvertakeVehicleState {
  const clampedDt = clamp(dt, 0.0001, 0.05);
  if (p.realSpec && st.spec !== p.realSpec) {
    st.spec = p.realSpec;
    st.redline = p.realSpec.redlineRpm;
  }

  const substeps = Math.max(1, Math.ceil(clampedDt * 960));
  const h = clampedDt / substeps;
  for (let i = 0; i < substeps; i++) {
    stepSingleSubstep(st, input, p, h);
  }
  return st;
}
