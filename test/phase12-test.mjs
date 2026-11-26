/* Phase 12 Vehicle Suspension & Organic Crest-Jump / Flight Physics Validation */

const ctxStub = new Proxy(
  {},
  {
    get: (_t, k) => {
      if (k === "createRadialGradient" || k === "createLinearGradient") return () => ({ addColorStop() {} });
      if (k === "createImageData") return (w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) });
      if (k === "getImageData") return (_x, _y, w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) });
      if (k === "measureText") return () => ({ width: 10 });
      if (k === "canvas") return { width: 256, height: 256 };
      return () => {};
    },
    set: () => true,
  },
);
globalThis.document = {
  createElement: (tag) => {
    if (tag === "canvas") return { width: 256, height: 256, getContext: () => ctxStub, style: {} };
    return { style: {} };
  },
};
globalThis.window = { devicePixelRatio: 1, addEventListener() {}, removeEventListener() {} };
globalThis.performance = globalThis.performance ?? { now: () => Date.now() };
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
};

const THREE = await import("three");
const { createVehicleSuspensionState, stepVehicleSuspension } = await import("../src/game/vehicles/suspension.ts");
const { applyWheelSuspension } = await import("../src/game/vehicles/wheels.ts");
const { buildWestgateWorld } = await import("../src/game/city/index.ts");

const failures = [];
const check = (cond, msg) => {
  if (!cond) failures.push(msg);
};

// 1. Flat road high-speed driving must NEVER falsely jump
{
  const sus = createVehicleSuspensionState("ferrari", 4.5);
  const pos = new THREE.Vector3(0, 4.5, 0);
  let vy = 0;
  let airborne = false;
  for (let i = 0; i < 60; i++) {
    pos.z += 48 * (1 / 60);
    const res = stepVehicleSuspension(sus, {
      pos,
      yaw: 0,
      speed: 48,
      horizSpeed: 48,
      accel: 0,
      latAccel: 0,
      width: 1.95,
      length: 4.5,
      vy,
      airborne,
      groundAt: () => 4.5,
      dt: 1 / 60,
    });
    vy = res.vy;
    airborne = res.airborne;
    check(!airborne, "Flat road high-speed driving must stay grounded");
  }
}

// 2. Weight transfer pitch (accel nose lift / brake nose dive) & cornering body roll
{
  const sus = createVehicleSuspensionState("mustang", 0);
  const pos = new THREE.Vector3(0, 0, 0);
  for (let i = 0; i < 20; i++) {
    stepVehicleSuspension(sus, {
      pos,
      yaw: 0,
      speed: 20,
      horizSpeed: 20,
      accel: 9.5,
      latAccel: 0,
      width: 1.9,
      length: 4.6,
      vy: 0,
      airborne: false,
      groundAt: () => 0,
      dt: 1 / 60,
    });
  }
  check(sus.pitch < -0.01, `Accelerating should squat rear / lift nose (pitch=${sus.pitch})`);

  for (let i = 0; i < 25; i++) {
    stepVehicleSuspension(sus, {
      pos,
      yaw: 0,
      speed: 15,
      horizSpeed: 15,
      accel: -11.0,
      latAccel: 8.5,
      width: 1.9,
      length: 4.6,
      vy: 0,
      airborne: false,
      groundAt: () => 0,
      dt: 1 / 60,
    });
  }
  check(sus.pitch > 0.01, `Braking should dive nose forward (pitch=${sus.pitch})`);
  check(sus.roll > 0.01, `Left cornering (+latAccel) should lean body outward right (roll=${sus.roll})`);
}

// 3. Smooth Hill Crest: slow speed stays planted vs high speed launches organically!
const hillGround = (_x, z) => 4.5 + 4.0 * Math.exp(-((z - 40) * (z - 40)) / (2 * 11 * 11));

{
  // Slow speed (5.5 m/s ~ 20 km/h): stays planted
  const susSlow = createVehicleSuspensionState("golf", hillGround(0, 0));
  const posSlow = new THREE.Vector3(0, hillGround(0, 0), 0);
  let vySlow = 0;
  let airSlow = false;
  let everAirSlow = false;
  for (let i = 0; i < 900; i++) {
    const dt = 1 / 60;
    posSlow.z += 5.5 * dt;
    const res = stepVehicleSuspension(susSlow, {
      pos: posSlow,
      yaw: 0,
      speed: 5.5,
      horizSpeed: 5.5,
      accel: 0,
      latAccel: 0,
      width: 1.8,
      length: 4.2,
      vy: vySlow,
      airborne: airSlow,
      groundAt: hillGround,
      dt,
    });
    vySlow = res.vy;
    airSlow = res.airborne;
    if (airSlow) everAirSlow = true;
  }
  check(!everAirSlow, "Slow car (20 km/h) over smooth hill crest should stay planted on suspension");
}

{
  // Fast speed (42 m/s ~ 151 km/h): launches cleanly off crest, droops wheels, lands & compresses!
  const susFast = createVehicleSuspensionState("ferrari", hillGround(0, 0));
  const posFast = new THREE.Vector3(0, hillGround(0, 0), 0);
  let vyFast = 0;
  let airFast = false;
  let launched = false;
  let maxClearance = 0;
  let maxAirTime = 0;
  let minDroopInAir = 0;
  let landingImpact = 0;
  let minHeaveAfterLand = 0;
  let hasLanded = false;

  for (let i = 0; i < 240; i++) {
    const dt = 1 / 60;
    posFast.z += 42 * dt;
    const res = stepVehicleSuspension(susFast, {
      pos: posFast,
      yaw: 0,
      speed: 42,
      horizSpeed: 42,
      accel: 0,
      latAccel: 0,
      width: 1.95,
      length: 4.5,
      vy: vyFast,
      airborne: airFast,
      groundAt: hillGround,
      dt,
    });
    vyFast = res.vy;
    airFast = res.airborne;
    if (res.launched) launched = true;
    if (airFast) {
      const clearance = posFast.y - hillGround(posFast.x, posFast.z);
      if (clearance > maxClearance) maxClearance = clearance;
      if (susFast.airTime > maxAirTime) maxAirTime = susFast.airTime;
      if (susFast.wheelOffsets[0] < minDroopInAir) minDroopInAir = susFast.wheelOffsets[0];
    }
    if (res.landingImpact > 0) {
      hasLanded = true;
      landingImpact = Math.max(landingImpact, res.landingImpact);
    }
    if (hasLanded && susFast.heave < minHeaveAfterLand) {
      minHeaveAfterLand = susFast.heave;
    }
  }

  check(launched, "Fast car (151 km/h) cresting steep hill must launch naturally");
  check(maxClearance > 1.2, `Expected >1.2m airborne ground clearance, got ${maxClearance.toFixed(2)}m`);
  check(maxAirTime > 0.45, `Expected >0.45s airtime, got ${maxAirTime.toFixed(2)}s`);
  check(minDroopInAir < -0.10, `Wheels should droop downward in flight (got ${minDroopInAir.toFixed(3)}m)`);
  check(hasLanded && landingImpact > 0.2, `Touchdown should report landingImpact (got ${landingImpact.toFixed(2)})`);
  check(minHeaveAfterLand < -0.05, `Landing should compress suspension downward (min heave=${minHeaveAfterLand.toFixed(3)}m)`);
}

// 4. Uneven curb wheel articulation & applyWheelSuspension
{
  const sus = createVehicleSuspensionState("rangerover", 0);
  const pos = new THREE.Vector3(0, 0, 0);
  const curbGround = (x) => (x > 0.3 ? 0.16 : 0);
  for (let i = 0; i < 15; i++) {
    stepVehicleSuspension(sus, {
      pos,
      yaw: 0,
      speed: 4,
      horizSpeed: 4,
      accel: 0,
      latAccel: 0,
      width: 2.0,
      length: 4.8,
      vy: 0,
      airborne: false,
      groundAt: curbGround,
      dt: 1 / 60,
    });
  }
  check(sus.groundRoll > 0.05, `Left curb should tilt groundRoll positive (got ${sus.groundRoll})`);

  // Verify wheel pivot helper updates local Y cleanly
  const carGroup = new THREE.Group();
  const makePivot = (x, z, isFront) => {
    const p = new THREE.Group();
    p.position.set(x, 0.36, z);
    p.userData.isFront = isFront;
    carGroup.add(p);
    return p;
  };
  const pivots = [
    makePivot(-0.8, -1.4, true),  // FL in modelRoot space
    makePivot(0.8, -1.4, true),   // FR
    makePivot(-0.8, 1.4, false),  // RL
    makePivot(0.8, 1.4, false),   // RR
  ];
  carGroup.userData.wheels = pivots;
  applyWheelSuspension(carGroup, [-0.14, -0.14, 0.09, 0.09]);
  check(Math.abs(pivots[0].position.y - 0.22) < 1e-5, "Front wheel pivot should drop by -0.14m");
  check(Math.abs(pivots[2].position.y - 0.45) < 1e-5, "Rear wheel pivot should compress +0.09m");
}

// 5. Integration inside WestgateVehicleManager (enter car, drive fast, airborne mid-air steering stays locked)
{
  const group = new THREE.Group();
  const scene = new THREE.Scene();
  const fakeRenderer = { toneMappingExposure: 1 };
  const level = buildWestgateWorld(group, scene, fakeRenderer);
  const vm = level.vehicles;
  const hero = vm.vehicles.find((v) => v.modelId === "ferrari") ?? vm.vehicles[0];
  vm.enterVehicle(hero);
  hero.speed = 42;
  hero.physState.speed = 42;
  hero.airborne = true;
  hero.vy = 4.0;
  const yawAtLaunch = hero.yaw;
  for (let i = 0; i < 12; i++) {
    vm.update(1 / 60, { throttle: 1, steer: 1, handbrake: false }, hero.pos);
  }
  check(Math.abs(hero.yaw - yawAtLaunch) < 0.05, "Airborne steering input must not carve full turns in mid-air");
  check(hero.group.rotation.order === "YXZ", "Active suspension vehicle should use YXZ Euler rotation order");
}

if (failures.length > 0) {
  console.error("Phase 12 failures:\n" + failures.map((f) => " - " + f).join("\n"));
  process.exit(1);
}
console.log("✔ Phase 12 tests passed: 4-corner suspension, weight-transfer pitch/roll, slow-speed planted vs high-speed crest launches, airborne flight, landing compression, and WestgateVehicleManager integration");
