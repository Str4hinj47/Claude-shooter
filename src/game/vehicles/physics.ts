// Ported & adapted from Overtake (src/physics.mjs): grip-limited bicycle steering,
// friction-circle longitudinal/lateral coupling, weight transfer, speed-sensitive rack,
// and self-centering stability for free-roam 3D city driving.

const G = 9.81;
const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

export interface OvertakeVehicleState {
  speed: number; // m/s signed (+ forward, - reverse)
  yaw: number; // world yaw rad (0 = +Z, +yaw turns left toward +X)
  yawRate: number; // rad/s
  steer: number; // -1..1 progressive rack state
  steerAngle: number; // front wheel angle rad
  accel: number; // m/s^2
  latAccel: number; // m/s^2
  slip: number; // 0..1 cornering slip intensity
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
  wheelbase?: number;
  maxSteer?: number;
  understeer?: number;
  yawResponse?: number;
  steerResponse?: number;
  drag?: number;
}

export function createOvertakeVehicleState(yaw = 0): OvertakeVehicleState {
  return {
    speed: 0,
    yaw,
    yawRate: 0,
    steer: 0,
    steerAngle: 0,
    accel: 0,
    latAccel: 0,
    slip: 0,
  };
}

/**
 * Steps Overtake's bicycle + friction-circle handling model in free-roam world coordinates.
 * Preserves Overtake's exact steering rack shaping, lateral load transfer, slip, and
 * cornering/braking grip coupling while supporting reverse gear for city maneuvering.
 */
export function stepFreeRoamVehicle(
  st: OvertakeVehicleState,
  input: FreeRoamVehicleInput,
  p: OvertakePhysicsParams,
  dt: number,
): OvertakeVehicleState {
  dt = clamp(dt, 0.0001, 0.05);

  const raw = clamp(input.steer, -1, 1);
  // Overtake progressive rack: fine precision near center, full lock smooth.
  const shaped = Math.sign(raw) * Math.pow(Math.abs(raw), 2.1);
  st.steer += (shaped - st.steer) * Math.min(1, dt * (p.steerResponse ?? 7.5));

  const speedAbs = Math.abs(st.speed);
  const maxSteer = (p.maxSteer ?? 0.5) / (1 + Math.pow(speedAbs / 20, 2));
  const steerAngle = st.steer * maxSteer;
  st.steerAngle = steerAngle;

  const understeer = 1 + (p.understeer ?? 0.003) * speedAbs * speedAbs;
  // Ramp low-speed yaw so stationary steering turns wheels without spinning in place
  const lowSpeedRamp = Math.min(1, speedAbs / 1.4);
  const desiredYaw =
    ((st.speed * Math.tan(steerAngle)) / (p.wheelbase ?? 2.7) / understeer) * lowSpeedRamp;

  // Lateral load transfer costs total grip; handbrake unlocks the rear for drifts
  const latUse = Math.min(1, Math.abs(st.latAccel) / G);
  const transfer = 1 - 0.1 * latUse;
  const handbrakeMul = input.handbrake ? 0.55 : 1;
  const maxLat = (p.grip ?? 1.0) * G * 0.85 * transfer * handbrakeMul;
  const maxYaw = maxLat / Math.max(speedAbs, 2);
  const targetYaw = clamp(desiredYaw, -maxYaw, maxYaw);
  st.slip = clamp(Math.abs(desiredYaw) / Math.max(maxYaw, 1e-3) - 1, 0, 1);
  st.yawRate += (targetYaw - st.yawRate) * Math.min(1, dt * (p.yawResponse ?? 6.5));
  st.latAccel = st.speed * st.yawRate;

  // Friction circle: cornering hard leaves less grip for throttle/brakes
  const circle = Math.sqrt(
    Math.max(0.18, 1 - 0.7 * Math.pow(st.latAccel / Math.max(maxLat, 1e-3), 2)),
  );
  const baseMax = p.maxSpeed ?? 56;
  const surfaceGrip = clamp(p.surfaceGrip ?? 1, 0.35, 1);
  const accelRate = p.accel ?? 9;
  const brakeRate = p.brake ?? 11;
  const dragCoeff = p.drag ?? 0.0008;

  const throttleIn = clamp(input.throttle, 0, 1);
  const brakeIn = clamp(input.brake, 0, 1);

  if (st.speed < -0.25) {
    // Currently reversing
    if (throttleIn > 0.05 || input.handbrake) {
      const decel =
        (throttleIn > 0.05 ? brakeRate * 1.25 : 0) + (input.handbrake ? brakeRate * 0.85 : 0);
      st.accel = decel * circle * surfaceGrip + 1.4;
      st.speed = Math.min(0, st.speed + st.accel * dt);
    } else {
      const maxRev = baseMax * 0.34;
      const revPower =
        brakeIn > 0.05
          ? accelRate * 0.58 * brakeIn * circle * surfaceGrip * (1 - 0.45 * Math.pow(speedAbs / maxRev, 2))
          : 0;
      const revDrag = dragCoeff * speedAbs * speedAbs + 0.45 + (brakeIn > 0.05 ? 0 : 1.3);
      st.accel = -(revPower - revDrag);
      st.speed = clamp(st.speed + st.accel * dt, -maxRev, 0);
    }
  } else if (st.speed <= 0.25 && brakeIn > 0.05 && throttleIn <= 0.05 && !input.handbrake) {
    // Engage reverse from rest
    const revPower = accelRate * 0.58 * brakeIn * circle * surfaceGrip;
    st.accel = -revPower;
    st.speed = Math.max(-baseMax * 0.34, st.speed + st.accel * dt);
  } else {
    // Forward Overtake longitudinal model
    const cap = Math.max(baseMax, st.speed);
    const power =
      throttleIn > 0.05
        ? accelRate * throttleIn * circle * surfaceGrip * (1 - 0.45 * Math.pow(st.speed / cap, 2))
        : 0;
    const brake =
      (brakeIn > 0.05 ? brakeRate * brakeIn : 0) + (input.handbrake ? brakeRate * 0.75 : 0);
    const drag = dragCoeff * st.speed * st.speed + 0.35 + (throttleIn > 0.05 ? 0 : 1.1);
    st.accel = power - brake * circle * surfaceGrip - drag;
    if (st.speed <= 0 && st.accel < 0) st.accel = 0;
    st.speed = clamp(st.speed + st.accel * dt, 0, cap);
    if (st.speed > baseMax) st.speed = Math.max(baseMax, st.speed - 7 * dt);
  }

  // Self-centering straight-line stability when steering is released
  if (Math.abs(raw) < 0.05) {
    st.yawRate *= Math.exp(-dt * 4.5);
  }
  st.yaw += st.yawRate * dt;
  return st;
}
