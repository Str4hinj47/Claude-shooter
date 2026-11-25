/* Phase 10 Overtake Car Models, Dealership, Snow/Rain Weather, Camera Settings & NPC Traffic validation */

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
THREE.CubeCamera.prototype.update = function () {};
THREE.PMREMGenerator.prototype.fromCubemap = function () {
  return { texture: new THREE.Texture() };
};
THREE.PMREMGenerator.prototype.fromScene = function () {
  return { texture: new THREE.Texture() };
};
THREE.PMREMGenerator.prototype.dispose = function () {};

const { buildWestgateWorld, computeWestgateGpsRoute, SAFEHOUSE_SPAWN, SAFEHOUSE_CAR_SPOT } = await import("../src/game/city/index.ts");
const { CARS } = await import("../src/game/vehicles/catalog.ts");
const { CarRadioEngine, RADIO_STATIONS } = await import("../src/game/vehicles/audio/CarRadio.ts");
const { VehicleCrashDeformer } = await import("../src/game/vehicles/damage/VehicleDamage.ts");
const { createOvertakeVehicleState, stepFreeRoamVehicle } = await import("../src/game/vehicles/physics.ts");
const { loadSave, purchaseCar, selectOwnedCar, awardDrivingCredits } = await import("../src/game/progression.ts");
const { stepWeather, weatherGrip, weatherLabel } = await import("../src/game/vehicles/weather.ts");

const failures = [];
const check = (cond, msg) => {
  if (!cond) failures.push(msg);
};

// 1. Verify all 8 Overtake cars + Range Rover exist in catalog & dealership progression works
check(CARS.length === 8, `Expected 8 playable cars, got ${CARS.length}`);
check(CARS.some((c) => c.id === "rangerover"), "Range Rover must be in playable catalog");
let save = loadSave();
check(save.ownedCars.includes("golf"), "Golf starter car should be owned");
save = purchaseCar("mustang");
check(!!save && save.ownedCars.includes("mustang") && save.selectedCar === "mustang", "Should be able to buy Mustang GT with starting credits");
awardDrivingCredits(900);
save = purchaseCar("rangerover");
check(!!save && save.ownedCars.includes("rangerover") && save.selectedCar === "rangerover", "Should be able to buy Range Rover");
save = selectOwnedCar("rangerover", "#0d3b2e");
check(!!save && save.carPaints.rangerover === "#0d3b2e", "Paint selection should persist");

// 2. Build Westgate Bay world & verify vehicles + NPC traffic + snow/rain weather
const group = new THREE.Group();
const scene = new THREE.Scene();
const fakeRenderer = { toneMappingExposure: 1 };
const level = buildWestgateWorld(group, scene, fakeRenderer);
const vm = level.vehicles;

check(vm.vehicles.length >= 30, `Expected >=30 vehicles (hero + NPC), got ${vm.vehicles.length}`);

// Personal car should be Range Rover (selected above) parked inside the Safehouse 1-car garage
const near = vm.findNearestEnterable(new THREE.Vector3(SAFEHOUSE_CAR_SPOT.x, 5.5, SAFEHOUSE_CAR_SPOT.z), 4.8);
check(!!near && near.modelId === "rangerover", `Expected Range Rover in Safehouse 1-car garage, got ${near?.modelId}`);

if (near) {
  const startPos = near.pos.clone();
  const startYaw = near.yaw;
  vm.enterVehicle(near);
  check(vm.activeVehicle === near, "activeVehicle should be set after enterVehicle");

  // Drive straight out of the 1-car garage door onto the driveway, then steer
  for (let i = 0; i < 18; i++) {
    vm.update(1 / 30, { throttle: 1, steer: 0, handbrake: false }, near.pos);
  }
  for (let i = 0; i < 20; i++) {
    vm.update(1 / 30, { throttle: 1, steer: 0.85, handbrake: false }, near.pos);
  }
  const movedDist = near.pos.distanceTo(startPos);
  check(near.speed > 8, `Expected Range Rover to accelerate >8 m/s, got ${near.speed}`);
  check(movedDist > 4, `Expected Range Rover to move >4m, got ${movedDist}`);
  check(Math.abs(near.yaw - startYaw) > 0.08, "Expected steering to turn vehicle yaw");
  check(Number.isFinite(near.pos.y) && near.pos.y >= 3.5, `Vehicle ground Y invalid: ${near.pos.y}`);

  const exitPos = vm.exitVehicle();
  check(!!exitPos && Number.isFinite(exitPos.y) && exitPos.y >= 3.5, `Invalid exitPos: ${exitPos?.y}`);
  check(vm.activeVehicle === null, "activeVehicle should be null after exitVehicle");
}

// 2a. Verify car-vs-car crash impulse & car-vs-wall front-bumper collision
{
  const hero = vm.vehicles[0];
  const npcTarget = vm.vehicles.find((v) => v.isNpcTraffic && v.mass < 3500) ?? vm.vehicles.find((v) => v.isNpcTraffic);
  check(!!hero && !!npcTarget, "Expected hero and NPC target for crash physics test");
  if (hero && npcTarget) {
    const savedNpcLane = npcTarget.lane;
    const savedNpcLaneSpeed = npcTarget.laneSpeed;
    const savedNpcPos = npcTarget.pos.clone();
    const savedNpcYaw = npcTarget.yaw;
    vm.enterVehicle(hero);
    // Place both vehicles on open, flat Downtown Civic Plaza (24, -82) for deterministic collision
    level.openWorld.chunks.prewarm(24, -82);
    const flatY = level.groundHeightAt(24, -82, 20);
    npcTarget.lane = null;
    npcTarget.speed = 0;
    npcTarget.laneSpeed = 0;
    npcTarget.crashTimer = 0;
    npcTarget.yaw = 0;
    npcTarget.pos.set(24, flatY, -82);
    hero.pos.set(19.2, flatY, -80.6);
    hero.yaw = Math.PI * 0.5;
    hero.speed = 24;
    hero.physState.speed = 24;
    hero.physState.yaw = hero.yaw;
    let maxImp = 0;
    let spun = false;
    for (let i = 0; i < 30; i++) {
      vm.update(1 / 60, { throttle: 1, steer: 0, handbrake: false }, hero.pos);
      if (vm.lastImpact > maxImp) maxImp = vm.lastImpact;
      if (npcTarget.crashTimer > 0 && Math.abs(npcTarget.yawVel) > 0.05) spun = true;
    }
    check(maxImp > 0.25 && spun, `Car-vs-car crash should trigger impact & NPC spin (imp=${maxImp.toFixed(2)}, spun=${spun})`);

    // Restore npcTarget so later NPC traffic & red-light tests have clean traffic state
    npcTarget.lane = savedNpcLane;
    npcTarget.laneSpeed = savedNpcLaneSpeed;
    npcTarget.pos.copy(savedNpcPos);
    npcTarget.yaw = savedNpcYaw;
    npcTarget.crashTimer = 0;
    npcTarget.yawVel = 0;
    npcTarget.speed = savedNpcLaneSpeed;

    // Car-vs-wall collision at Downtown building
    level.openWorld.chunks.prewarm(24, -82);
    const walls = level.openWorld.spatialAABBs
      .queryRect(0, -140, 120, -20)
      .filter((b) => b.max.y > 10 && b.max.x - b.min.x > 6);
    if (walls.length > 0) {
      const w = walls[0];
      const cz = (w.min.z + w.max.z) * 0.5;
      const gy = level.groundHeightAt(w.min.x - 6, cz, 20);
      hero.pos.set(w.min.x - 6, gy, cz);
      hero.yaw = Math.PI * 0.5;
      hero.physState.yaw = hero.yaw;
      hero.speed = 24;
      hero.physState.speed = 24;
      let wImp = 0;
      for (let i = 0; i < 40; i++) {
        vm.update(1 / 60, { throttle: 1, steer: 0, handbrake: false }, hero.pos);
        if (vm.lastImpact > wImp) wImp = vm.lastImpact;
      }
      check(wImp > 0.3 && hero.pos.x < w.min.x - 1.2, `Car-vs-wall should stop outside wall (imp=${wImp.toFixed(2)}, x=${hero.pos.x.toFixed(2)}, wallMinX=${w.min.x.toFixed(2)})`);
    }
    vm.exitVehicle();
    hero.pos.set(SAFEHOUSE_CAR_SPOT.x, 5.5, SAFEHOUSE_CAR_SPOT.z);
    hero.speed = 0;
    hero.vx = 0;
    hero.vz = 0;
  }
}

// 2b. Verify all 4 Apartment Building Multi-Car Garages spawn all owned cars + stations
const garageStations = level.apartments.getStations(["apt_oldquarter"], null, "apt_oldquarter");
const ownedCarStations = garageStations.filter((s) => s.kind === "apt_garage_car");
check(ownedCarStations.length === 3, `Expected 3 owned car stations in multi-car garage, got ${ownedCarStations.length}`);
check(garageStations.some((s) => s.kind === "apt_garage_to_apt"), "Expected elevator back to apartment");
check(garageStations.some((s) => s.kind === "apt_garage_to_street"), "Expected exit gate to street");

// 3. Summon Ferrari & verify swapping works cleanly
const summoned = vm.summonPlayerCar("ferrari", "#d40f1e", new THREE.Vector3(24, 4.5, -82), 0);
check(summoned.modelId === "ferrari", "summonPlayerCar should spawn Ferrari 458 Italia");

// 4. Verify NPC traffic cars & trucks advance smoothly along RoadNetwork lanes & turns (no yaw/pos snaps)
const npcs = vm.vehicles.filter((v) => v.isNpcTraffic);
check(npcs.length >= 20, `Expected >=20 ambient NPC traffic vehicles, got ${npcs.length}`);
const npc = npcs[1] ?? npcs[0];
if (npc) {
  npc.crashTimer = 0;
  const npcStart = npc.pos.clone();
  for (let i = 0; i < 30; i++) {
    vm.update(1 / 30, { throttle: 0, steer: 0, handbrake: false }, npc.pos);
  }
  check(npc.pos.distanceTo(npcStart) > 2.0, "Expected NPC traffic car to advance along lane");
  check(Number.isFinite(npc.pos.y), "NPC car Y should be finite");
}

// 4b. Verify NPC cars traversing intersections & roundabouts never teleport or snap yaw instantaneously
{
  const dtFocus = new THREE.Vector3(0, 5, -60);
  const tracked = npcs.filter((c) => Math.hypot(c.pos.x - dtFocus.x, c.pos.z - dtFocus.z) < 500).slice(0, 18);
  let maxJump = 0;
  let maxYawStep = 0;
  let sawTurn = false;
  for (let step = 0; step < 360; step++) {
    const prev = tracked.map((c) => ({ x: c.pos.x, z: c.pos.z, yaw: c.yaw }));
    vm.update(1 / 30, { throttle: 0, steer: 0, handbrake: false }, dtFocus);
    for (let i = 0; i < tracked.length; i++) {
      const c = tracked[i];
      if (Math.hypot(c.pos.x - dtFocus.x, c.pos.z - dtFocus.z) > 650) continue;
      const jump = Math.hypot(c.pos.x - prev[i].x, c.pos.z - prev[i].z);
      let dYaw = c.yaw - prev[i].yaw;
      while (dYaw > Math.PI) dYaw -= Math.PI * 2;
      while (dYaw < -Math.PI) dYaw += Math.PI * 2;
      if (jump > maxJump) maxJump = jump;
      if (Math.abs(dYaw) > maxYawStep) maxYawStep = Math.abs(dYaw);
      if (c.turnCurve || Math.abs(c.steerAngle) > 0.04) sawTurn = true;
    }
  }
  check(sawTurn, "Expected at least one NPC car to steer / traverse an intersection turn curve");
  check(maxJump < 2.5, `NPC traffic car jumped ${maxJump.toFixed(2)}m in 1 frame`);
  check(maxYawStep < 0.25, `NPC traffic car snapped yaw by ${maxYawStep.toFixed(3)} rad in 1 frame`);
}

// 5. Verify Snow & Rain weather state machine & grip reduction
level.setWeatherMode("rain");
for (let i = 0; i < 60; i++) stepWeather(level.weather, 0.1, 0.5);
check(level.weather.rain > 0.8 && level.weather.wet > 0.3, "Rain mode should build rain & wet asphalt");
check(weatherLabel(level.weather) === "Rain", `Expected Rain label, got ${weatherLabel(level.weather)}`);
check(weatherGrip(level.weather) < 0.96, "Rain should reduce tire grip");

level.setWeatherMode("snow");
for (let i = 0; i < 90; i++) stepWeather(level.weather, 0.1, 0.1);
check(level.weather.snow > 0.8 && level.weather.snowCover > 0.3, "Snow mode should build snow & snow cover");
check(weatherLabel(level.weather) === "Snow", `Expected Snow label, got ${weatherLabel(level.weather)}`);
check(weatherGrip(level.weather) < 0.9, "Snow should reduce tire grip");

// 6. Verify Overtake free-roam physics module (progressive rack, slip, handbrake, reverse)
const pst = createOvertakeVehicleState(0);
for (let i = 0; i < 60; i++) {
  stepFreeRoamVehicle(pst, { throttle: 1, brake: 0, steer: 0.8, handbrake: false }, { maxSpeed: 54, accel: 10, grip: 1.0 }, 1 / 60);
}
check(pst.speed > 7 && Math.abs(pst.yaw) > 0.1 && Math.abs(pst.latAccel) > 0.5, "Overtake physics should accelerate & corner via bicycle model");
stepFreeRoamVehicle(pst, { throttle: 0, brake: 0, steer: 1, handbrake: true }, { maxSpeed: 54, accel: 10, grip: 1.0 }, 1 / 60);
check(pst.accel < 0, "Handbrake should decelerate vehicle");

// 8. Verify MinimapData & Westgate Bay road-graph GPS routing
check(level.minimapData.roads.length >= 25, `Expected >=25 road polylines in minimapData, got ${level.minimapData.roads.length}`);
check(level.minimapData.roundabouts.length === 5, `Expected 5 roundabouts in minimapData, got ${level.minimapData.roundabouts.length}`);
check(level.minimapData.defaultLoop.length > 40, "Default Westgate scenic GPS loop should have >40 spline points");
const gpsRoute = computeWestgateGpsRoute(level.minimapData, SAFEHOUSE_SPAWN[0], SAFEHOUSE_SPAWN[1], -706, 40);
check(gpsRoute.length > 20, `Expected road-guided GPS route >20 points from Safehouse to Del Sol Pier, got ${gpsRoute.length}`);

// 9. Verify Time-of-Day presets & Westgate Bay Speed Traps
check(level.timeOfDay === "afternoon" && level.getTimeOfDayDarkness() === 0, "Initial timeOfDay should be afternoon");
level.setTimeOfDay("night");
check(level.timeOfDay === "night" && level.getTimeOfDayDarkness() > 0.9, "Night mode should report >0.9 darkness");
level.setTimeOfDay("sunset");
check(level.timeOfDay === "sunset" && level.getTimeOfDayDarkness() > 0.4, "Sunset mode should report >0.4 darkness");

check(level.activities.traps.length === 10, `Expected 10 Speed Traps, got ${level.activities.traps.length}`);
const trapPos = level.activities.traps[0].pos.clone();
const trapHit = level.activities.update(1 / 60, trapPos, 40, true);
check(!!trapHit && trapHit.kmh >= 140 && trapHit.beatTarget && trapHit.reward > 0, "Driving fast through Speed Trap should award target bonus");

// 10. Verify Live Traffic Signals & Speed Limit Signs
check(!!level.signals && level.signals.group.children.length >= 10, "TrafficSignalManager should build signal pods and speed limit signs");
const sigNode = level.openWorld.roads.getNodes().find((n) => n.kind === "signal");
check(!!sigNode, "Expected at least one signalized intersection node");
if (sigNode) {
  const ns0 = level.signals.getSignalForHeading(sigNode.id, 0, 1);
  const ew0 = level.signals.getSignalForHeading(sigNode.id, 1, 0);
  check(ns0 !== ew0 || ns0 === "red", `Perpendicular signal axes should differ or be in all-red clearance (ns=${ns0}, ew=${ew0})`);
  let sawRed = ns0 === "red";
  let sawGreen = ns0 === "green";
  for (let k = 0; k < 240; k++) {
    level.signals.update(0.1);
    const cur = level.signals.getSignalForHeading(sigNode.id, 0, 1);
    if (cur === "red") sawRed = true;
    if (cur === "green") sawGreen = true;
  }
  check(sawRed && sawGreen, "Traffic light should cycle cleanly through green and red phases");
}

// 11. Verify Denser NPC Traffic, Red-Light Compliance & Advance Turn Signals
const lVeh = level.vehicles;
const npcCount = lVeh.vehicles.filter((v) => v.isNpcTraffic).length;
check(npcCount >= 60, `Expected denser NPC traffic (>=60 vehicles), got ${npcCount}`);
const sigLane = level.openWorld.roads.getLanes().find((l) => {
  if (!l.endNodeId || l.id.startsWith("roundabout:") || l.length < 40) return false;
  const n = level.openWorld.roads.getNode(l.endNodeId);
  return n?.kind === "signal";
});
if (sigLane && level.signals) {
  const testNpc = lVeh.vehicles.find((v) => v.isNpcTraffic);
  const endN = level.openWorld.roads.getNode(sigLane.endNodeId);
  const tanEnd = sigLane.curve.getTangentAt(0.95).setY(0).normalize();
  for (let s = 0; s < 240; s++) {
    if (level.signals.getSignalForHeading(endN.id, tanEnd.x, tanEnd.z) === "red") break;
    level.signals.update(0.1);
  }
  if (testNpc) {
    testNpc.lane = sigLane;
    testNpc.turnCurve = null;
    testNpc.turnNextLane = null;
    testNpc.upcomingNextLane = null;
    testNpc.crashTimer = 0;
    testNpc.laneT = Math.max(0.5, 1 - 19 / sigLane.length);
    testNpc.speed = 12;
    const pStart = sigLane.curve.getPointAt(testNpc.laneT);
    testNpc.pos.copy(pStart);
    testNpc.yaw = Math.atan2(tanEnd.x, tanEnd.z);
    for (let k = 0; k < 25; k++) {
      lVeh.update(0.05, { throttle: 0, steer: 0, handbrake: false }, pStart.clone().add(new THREE.Vector3(20, 0, 0)), 1);
    }
    check(testNpc.speed < 5 && !!testNpc.npcBraking, `NPC should brake & stop at red signal (speed=${testNpc.speed.toFixed(2)}, braking=${testNpc.npcBraking})`);
  }
}
// Verify advance turn blinkers engage before turning
{
  let sawPreTurnBlinker = false;
  for (let step = 0; step < 260; step++) {
    const focus = lVeh.vehicles[20]?.pos ?? new THREE.Vector3(0, 5, 0);
    lVeh.update(0.05, { throttle: 0, steer: 0, handbrake: false }, focus, 1);
    for (const v of lVeh.vehicles) {
      if (v.isNpcTraffic && !v.turnCurve && (v.npcSignal === "left" || v.npcSignal === "right")) {
        sawPreTurnBlinker = true;
        break;
      }
    }
    if (sawPreTurnBlinker) break;
  }
  check(sawPreTurnBlinker, "Expected NPC traffic to activate left/right blinkers BEFORE turning");
}

// 12. Verify Pedestrian Crowd, Crosswalk Logic, Voicelines & Reactions
check(!!level.pedestrians && level.pedestrians.agents.length === 72, `Expected 72 pedestrians, got ${level.pedestrians?.agents.length}`);
if (level.pedestrians) {
  const ped0 = level.pedestrians.agents[0];
  const p0x = ped0.x;
  const p0z = ped0.z;
  ped0.state = "walk";
  ped0.stateTimer = 10;
  ped0.speechCd = 0;
  for (let s = 0; s < 8; s++) {
    level.pedestrians.update(0.05, { x: p0x, y: ped0.y, z: p0z });
  }
  check(Math.hypot(ped0.x - p0x, ped0.z - p0z) > 0.2, "Walking pedestrian should advance along sidewalk");

  const greetLine = level.pedestrians.interactNearest(ped0.x + 0.8, ped0.z + 0.8);
  check(!!greetLine && greetLine.text.length > 5, "Interacting with nearby pedestrian should trigger spoken voiceline");

  ped0.speechCd = 0;
  const hornLine = level.pedestrians.onVehicleHorn(ped0.x + 2, ped0.z + 2);
  check(!!hornLine && ped0.state === "flee", "Car horn near pedestrian should trigger startle flee & honk voiceline");

  ped0.state = "walk";
  ped0.speechCd = 0;
  const panicLine = level.pedestrians.alertPanic({ x: ped0.x + 3, z: ped0.z + 3 }, 45);
  check(!!panicLine && ped0.state === "flee", "Gunfire alert should scatter pedestrians & trigger panic voiceline");
}

// 13. Verify Living World (Del Sol Ferris Wheel rotation, boats, birds, aircraft)
level.openWorld.chunks.prewarm(-755, 0);
for (let f = 0; f < 6; f++) {
  level.update(0.1, new THREE.Vector3(-755, 5, 0));
}
let ferrisRotor = null;
level.livingWorld.group.parent?.traverse((o) => {
  if (o.userData?.ferrisRotor) ferrisRotor = o;
});
check(!!ferrisRotor && ferrisRotor.rotation.z > 0.05, "Del Sol Ferris Wheel rotor should spin during world update");
const firstGondola = ferrisRotor?.children.find((c) => c.userData?.ferrisGondola);
check(
  !!firstGondola && Math.abs(firstGondola.rotation.z + ferrisRotor.rotation.z) < 1e-4,
  "Ferris wheel gondolas should counter-rotate to remain upright",
);

// 14. Stage 1: 1-5 Star Police Wanted System, Cruisers, Officers & Evasion
check(!!level.wanted, "WantedSystem should be attached to WestgateLevelResult");
if (level.wanted) {
  level.wanted.reportCrime("gunfire", { x: 20, z: -80 });
  check(level.wanted.stars >= 1, `Gunfire should trigger >=1 wanted star, got ${level.wanted.stars}`);
  level.wanted.reportCrime("robbery", { x: 20, z: -80 });
  check(level.wanted.stars >= 2, `Robbery should escalate wanted stars to >=2, got ${level.wanted.stars}`);
  for (let i = 0; i < 90; i++) {
    level.wanted.update(0.05, { x: 20, y: 5, z: -80 }, 0, false);
  }
  check(level.wanted.cruisers.length >= 1, "Police cruiser should spawn during active pursuit");
  const farPos = { x: 950, y: 5, z: 950 };
  for (let i = 0; i < 420 && level.wanted.stars > 0; i++) {
    level.wanted.update(0.05, farPos, 20, true);
  }
  check(level.wanted.stars === 0, "Escaping far from police line-of-sight should clear Wanted stars");
}

// 15. Stage 2: Stunt Jump Ramps, Street Races with AI Rivals & Parked Street Cars
const parkedCount = level.vehicles.vehicles.filter((v) => v.isParked).length;
const policeCount = level.vehicles.vehicles.filter((v) => v.isPolice).length;
check(parkedCount >= 18, `Expected >=18 parked street cars across bays, got ${parkedCount}`);
check(policeCount >= 2, `Expected >=2 playable Police Cruisers, got ${policeCount}`);
check(level.activities.stuntJumps.length === 6, `Expected 6 stunt jump ramps, got ${level.activities.stuntJumps.length}`);
const sj0 = level.activities.stuntJumps[0].def;
const rampTopY = level.heightSystem.groundHeightAt(sj0.x, sj0.z, 50);
check(rampTopY > level.heightSystem.terrainHeightAt(sj0.x, sj0.z) + 0.6, "Stunt ramp surface should elevate groundHeightAt");

const race0 = level.activities.races[0];
const startedRace = level.activities.startRace(race0);
check(startedRace.race.id === race0.id && startedRace.totalRacers === 4, "Street race should start with 3 AI rivals");
let raceFinished = null;
for (const cp of race0.checkpoints) {
  raceFinished = level.activities.updateRace(0.5, new THREE.Vector3(cp[0], 5, cp[1]));
}
check(!!raceFinished && raceFinished.reward > 0, "Crossing all street race checkpoints should finish race & pay reward");

// 16. Stage 3: Car Radio 5-Station Cycling & Police Cruiser Siren Lightbars
const radio = new CarRadioEngine();
const initialSt = radio.currentStation.id;
const nextSt = radio.cycleStation();
check(nextSt.id !== initialSt && RADIO_STATIONS.length === 5, "CarRadioEngine should have 5 stations & cycle cleanly");
const copCar = level.vehicles.vehicles.find((v) => v.isPolice);
check(!!copCar && !!copCar.lightbar, "Police cruiser should carry animated Red/Blue lightbar");
if (copCar) {
  level.vehicles.enterVehicle(copCar);
  const sirenOn = level.vehicles.toggleActiveSiren();
  check(sirenOn === true && copCar.sirenOn === true, "KeyX toggleActiveSiren should activate police siren");
  level.vehicles.update(0.05, { throttle: 0, steer: 0, handbrake: false }, copCar.pos, 1, undefined, 0);
  check(copCar.lightbar.matR.emissiveIntensity > 3 || copCar.lightbar.matB.emissiveIntensity > 3, "Active siren should flash lightbar LEDs");
  level.vehicles.exitVehicle();
}

// 17. Stage 4: Occupied NPC Carjacking & Vehicle Damage/Explosion
const npcTarget = level.vehicles.vehicles.find((v) => v.isNpcTraffic);
check(!!npcTarget, "Should have occupied NPC traffic vehicle for carjacking test");
if (npcTarget && level.pedestrians) {
  let jacked = false;
  level.vehicles.onCarjack = (v) => {
    jacked = true;
    level.pedestrians.spawnEjectedDriver(v.pos.x, v.pos.y, v.pos.z, v.yaw);
  };
  level.vehicles.enterVehicle(npcTarget);
  const hasFleeingDriver = level.pedestrians.agents.some(
    (a) => a.state === "flee" && Math.hypot(a.x - npcTarget.pos.x, a.z - npcTarget.pos.z) < 4.5,
  );
  check(jacked && hasFleeingDriver, "Carjacking NPC car should eject a fleeing driver");
  let exploded = false;
  level.vehicles.onVehicleExplode = () => {
    exploded = true;
  };
  level.vehicles.damageVehicle(npcTarget, 200);
  check(exploded && npcTarget.disabled === true, "Heavy damage should disable and explode vehicle");
  level.vehicles.exitVehicle();
}

// 18. Stage 5: Drive-In Mod Garages, Walkable/Robbable 24/7 Stores & Random Street Events
check(!!level.shops && level.shops.garages.length === 4 && level.shops.stores.length === 4, "Should build 4 Mod Garages & 4 24/7 Stores");
if (level.shops) {
  const store0 = level.shops.stores[0];
  const nearSt = level.shops.findNearbyStore(store0.pos, 5.4);
  check(!!nearSt && nearSt.robbable === true, "Standing inside 24/7 store should enable robbery & snack purchase");
  const loot = level.shops.triggerRobbery(store0.def.id);
  check(loot >= 350 && level.shops.triggerRobbery(store0.def.id) === 0, "Robbing store should pay cash once and enter cooldown");
}
check(!!level.randomEvents, "RandomEventsManager should be attached to WestgateLevelResult");
if (level.randomEvents) {
  let spawnedEv = null;
  for (let i = 0; i < 60 && !spawnedEv; i++) {
    const r = level.randomEvents.update(1.0, { x: 20, y: 5, z: -80 }, false);
    if (r.spawned) spawnedEv = r.spawned;
  }
  check(!!spawnedEv && !!level.randomEvents.getActiveBlip(), "RandomEventsManager should spawn an emergent street event with radar blip");
}

// 19. Vehicle Mesh Deformation, Hinged Door Detachment, Shattered Glass, Alignment Drift & Garage Repair
{
  const mockRoot = new THREE.Group();
  const bodyGeo = new THREE.BoxGeometry(1.85, 0.8, 4.3, 4, 2, 8);
  const bodyMat = new THREE.MeshStandardMaterial({ name: "paint__test", color: 0xff0000 });
  const bodyMesh = new THREE.Mesh(bodyGeo, bodyMat);
  bodyMesh.position.set(0, 0.55, 0);

  const glassGeo = new THREE.BoxGeometry(1.5, 0.35, 0.08);
  const glassMat = new THREE.MeshStandardMaterial({ name: "glass__windshield", color: 0x111111 });
  const glassMesh = new THREE.Mesh(glassGeo, glassMat);
  glassMesh.position.set(0, 1.05, 1.15);

  const doorNode = new THREE.Group();
  doorNode.name = "door_fl";
  doorNode.position.set(-0.92, 0.55, 0.55);
  const doorMesh = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.65, 1.1), bodyMat);
  doorMesh.position.set(0, 0, -0.5);
  doorNode.add(doorMesh);

  mockRoot.add(bodyMesh, glassMesh, doorNode);
  const worldGrp = new THREE.Group();
  worldGrp.add(mockRoot);

  const def = new VehicleCrashDeformer(1.9, 4.5, 1.4);
  def.attachModel(mockRoot, worldGrp);
  const origPos = new Float32Array(bodyGeo.getAttribute("position").array);

  // Moderate front-right corner impact -> dents body, reduces power, adds steering alignment pull
  def.applyWorldImpact(new THREE.Vector3(0.75, 0.6, 2.05), new THREE.Vector3(-0.3, 0, -0.95), new THREE.Vector3(0, 0, 0), 0, 14);
  const deformedArr = bodyMesh.geometry.getAttribute("position").array;
  let movedVerts = 0;
  for (let i = 0; i < origPos.length; i++) {
    if (Math.abs(deformedArr[i] - origPos[i]) > 0.01) movedVerts++;
  }
  check(movedVerts >= 6, `Expected front crash to dent >=6 body vertices, got ${movedVerts}`);
  check(def.zones.front > 0.15 && def.powerMult < 0.96, "Front zone crumple should reduce engine powerMult");
  check(Math.abs(def.steerBias) > 0.01, "Asymmetric front-corner impact should create alignment steerBias");

  // Heavy side/windshield impact -> shatters glass & tears off door_fl into tumbling debris
  def.applyWorldImpact(new THREE.Vector3(-0.85, 0.8, 0.65), new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 0, 0), 0, 22, 1.4);
  check(def.brokenGlassCount >= 1 && glassMesh.visible === false, "Heavy impact near windshield should shatter glass");
  check(def.detachedCount === 1 && doorNode.visible === false, "Heavy side impact should detach door_fl into world debris");

  // Westgate Customs Mod Garage repairAll() -> restores 100% original vertices, doors, glass & alignment
  def.repairAll();
  const repairedArr = bodyMesh.geometry.getAttribute("position").array;
  let residualDiff = 0;
  for (let i = 0; i < origPos.length; i++) {
    residualDiff = Math.max(residualDiff, Math.abs(repairedArr[i] - origPos[i]));
  }
  check(residualDiff < 1e-5, `repairAll() should restore all vertices to rest position (diff=${residualDiff})`);
  check(def.powerMult === 1 && def.steerBias === 0 && doorNode.visible && glassMesh.visible, "repairAll() should restore handling, doors, and glass");
}

// 20. Drift Tire Skidmarks (InstancedMesh ring buffer)
check(!!vm.skidmarks && vm.skidmarks.mesh.isInstancedMesh, "VehicleSystem should attach TireSkidmarks InstancedMesh");
{
  const preSkids = vm.skidmarks.activeQuads;
  summoned.disabled = false;
  summoned.hp = summoned.maxHp;
  summoned.pos.set(24, level.groundHeightAt(24, -82, 20), -82);
  summoned.yaw = 0;
  summoned.speed = 18;
  vm.enterVehicle(summoned);
  summoned.physState.speed = 18;
  for (let i = 0; i < 12; i++) {
    vm.update(0.03, { throttle: 1, steer: 1, handbrake: true }, summoned.pos, 1.0);
  }
  check(vm.skidmarks.activeQuads > preSkids, `Drifting with handbrake should emit rear-axle skidmarks (got ${vm.skidmarks.activeQuads})`);
  vm.exitVehicle();
}

// 21. Flyable Helicopters & Airplanes + Mid-Air Parachute Bailout Altitude
check(!!level.aircraft && level.aircraft.aircraft.length === 4, `Expected 4 flyable aircraft (2 helicopters + 2 airplanes), got ${level.aircraft?.aircraft.length}`);
if (level.aircraft) {
  const heli = level.aircraft.aircraft.find((a) => a.kind === "helicopter");
  check(!!heli, "Should spawn Maverick Rescue / Observatory Helicopters");
  if (heli) {
    const startY = heli.pos.y;
    level.aircraft.enterAircraft(heli);
    for (let i = 0; i < 80; i++) {
      level.aircraft.update(0.05, { throttle: 1, roll: 0, yaw: 0, climb: 1 });
    }
    check(heli.pos.y > startY + 14, `Helicopter collective climb should lift above +14m (delta=${(heli.pos.y - startY).toFixed(1)}m)`);
    const bail = level.aircraft.exitAircraft();
    check(!!bail && bail.altitudeAboveGround > 12, `Mid-air bailout altitude (${bail?.altitudeAboveGround.toFixed(1)}m) should trigger parachute deployment (>12m)`);
  }
  const plane = level.aircraft.aircraft.find((a) => a.kind === "airplane");
  check(!!plane, "Should spawn Airport / Seaport fixed-wing airplanes");
  if (plane) {
    const startPos = plane.pos.clone();
    level.aircraft.enterAircraft(plane);
    for (let i = 0; i < 70; i++) {
      level.aircraft.update(0.05, { throttle: 1, roll: 0, yaw: 0, climb: 1 });
    }
    check(plane.speed > 25 && plane.pos.distanceTo(startPos) > 40, `Airplane takeoff should accelerate & climb (speed=${plane.speed.toFixed(1)} m/s)`);
    level.aircraft.exitAircraft();
  }
}

// 22. Drivable Speedboats with Buoyancy & Water-Boundary Containment
check(!!level.boats && level.boats.boats.length === 3, `Expected 3 docked speedboats (including starter skiff), got ${level.boats?.boats.length}`);
if (level.boats) {
  const b = level.boats.boats[0];
  const bx0 = b.pos.x;
  const bz0 = b.pos.z;
  level.boats.enterBoat(b);
  for (let i = 0; i < 40; i++) {
    level.boats.update(0.05, { throttle: 1, steer: 0 });
  }
  check(Math.hypot(b.pos.x - bx0, b.pos.z - bz0) > 10 && Math.abs(b.pos.y) < 1.2, "Speedboat should plane across ocean water near y=0");
  level.boats.exitBoat();
}

// 23. Hidden Cash Stashes, Explosive Fuel Barrels & Officer Cash/Medkit Drops
check(!!level.collectibles && level.collectibles.totalStashes === 15, "CollectiblesSystem should place 15 hidden cash stashes");
if (level.collectibles) {
  const stash0 = level.collectibles.pickups.find((p) => p.kind === "stash");
  check(!!stash0, "Should have first hidden stash pickup");
  if (stash0) {
    const picked = level.collectibles.update(0.05, { x: stash0.x, y: stash0.y, z: stash0.z });
    check(!!picked && picked.kind === "stash" && picked.stashesFound === 1, "Stepping on hidden stash should collect it");
  }
  const exp0 = level.collectibles.explosives[0];
  check(!!exp0, "Should place explosive fuel tanks/barrels across city");
  if (exp0) {
    const boom = level.collectibles.hitExplosiveAtPoint(exp0.x, exp0.y + 0.5, exp0.z, 60);
    check(!!boom && exp0.exploded, "Shooting explosive fuel barrel should detonate it");
  }
}

// 24. 3-Star Police Pursuit Helicopter + Spotlight + Shootdown
if (level.wanted) {
  let chopperDowned = false;
  level.wanted.events.onChopperDown = () => {
    chopperDowned = true;
  };
  level.wanted.reportCrime("cop_hit", { x: 20, z: -80 });
  level.wanted.reportCrime("cop_hit", { x: 20, z: -80 });
  level.wanted.heat = 160;
  level.wanted.stars = 3;
  for (let i = 0; i < 20; i++) {
    level.wanted.update(0.05, { x: 20, y: 5, z: -80 }, 10, true);
  }
  check(!!level.wanted.chopper && !!level.wanted.chopper.beam, "3-Star Wanted Level should deploy Police Pursuit Helicopter with searchlight beam");
  if (level.wanted.chopper) {
    const ch = level.wanted.chopper;
    level.wanted.hitAtPoint(ch.x, ch.y, ch.z, 250);
    check(chopperDowned && ch.hp <= 0, "Shooting Police Helicopter should down it and trigger onChopperDown reward");
  }
  level.wanted.clearWanted(false);
}

// 25. Location & Vehicle-Value Spawn Probability Engine
{
  const { computeLocationSpawnWeights, chooseLocationTrafficModel, getVehicleApproxValue } = await import(
    "../src/game/vehicles/trafficSpawn.ts"
  );
  const { getDistrictAt } = await import("../src/game/city/WestgateTerrain.ts");

  const expectedAvgValue = (districtId) => {
    const weights = computeLocationSpawnWeights({ districtId, roadTier: "arterial", isParked: false });
    let sumW = 0;
    let sumVW = 0;
    for (const [id, w] of weights.entries()) {
      sumW += w;
      sumVW += w * getVehicleApproxValue(id).approxValueUsd;
    }
    return sumVW / sumW;
  };

  const avgFoothills = expectedAvgValue("foothills");
  const avgWestCoast = expectedAvgValue("west_coast");
  const avgDowntown = expectedAvgValue("downtown");
  const avgOldQuarter = expectedAvgValue("old_quarter");
  const avgEastPort = expectedAvgValue("east_port");
  check(
    avgFoothills > avgDowntown && avgDowntown > avgOldQuarter && avgWestCoast > avgOldQuarter,
    `Expected average car value hierarchy (foothills=${Math.round(avgFoothills)}, west_coast=${Math.round(avgWestCoast)}, downtown=${Math.round(avgDowntown)}, old_quarter=${Math.round(avgOldQuarter)})`,
  );

  const portWeights = computeLocationSpawnWeights({ districtId: "east_port", roadTier: "street", isParked: false });
  const subWeights = computeLocationSpawnWeights({ districtId: "old_quarter", roadTier: "street", isParked: false });
  check(!portWeights.has("ferrari") && !portWeights.has("r8"), "East Industrial Port should not spawn exotic supercars");
  check(!subWeights.has("ferrari") && !subWeights.has("r8"), "Old Quarter suburbs should not spawn exotic supercars");
  check(avgEastPort < avgFoothills, "East Port expected passenger/industrial mix should be lower value than Foothills estates");

  // Deterministic Monte Carlo check with chooseLocationTrafficModel
  let seed = 42;
  const rng = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  let hillsLuxuryCount = 0;
  let portExoticCount = 0;
  for (let i = 0; i < 200; i++) {
    const hId = chooseLocationTrafficModel({ districtId: "foothills", roadTier: "street" }, [], -200, -800, rng);
    const tier = getVehicleApproxValue(hId).tier;
    if (tier === "premium" || tier === "exotic") hillsLuxuryCount++;
    const pId = chooseLocationTrafficModel({ districtId: "east_port", roadTier: "street" }, [], 600, 400, rng);
    if (getVehicleApproxValue(pId).tier === "exotic") portExoticCount++;
  }
  check(hillsLuxuryCount > 30 && portExoticCount === 0, `Foothills luxury/exotic rate (${hillsLuxuryCount}/200) and zero Port exotics (${portExoticCount})`);

  const npcVehicles = vm.vehicles.filter((v) => v.isNpcTraffic);
  const npcIds = new Set(npcVehicles.map((v) => v.modelId));
  const everydaySet = ["compact", "hatch", "sedan", "crossover", "offroad", "taxi", "golf"];
  check(everydaySet.some((id) => npcIds.has(id)), "NPC traffic should include everyday sedans, compacts, hatchbacks, crossovers & taxis");
  for (const v of npcVehicles) {
    const d = v.spawnDistrict ?? getDistrictAt(v.pos.x, v.pos.z).id;
    if (d === "east_port" || d === "old_quarter") {
      check(v.modelId !== "ferrari" && v.modelId !== "r8", `No exotics should spawn in ${d} (got ${v.modelId})`);
    }
  }
  const copHQ = vm.vehicles.find((v) => v.id === "police_hq_cruiser");
  check(!!copHQ && copHQ.modelId === "police_cruiser", "Police HQ parked cruiser should use police_cruiser model");
}

level.disposeExtra?.();
vm.dispose();
level.openWorld.dispose();

if (failures.length > 0) {
  console.error("Phase 10 test failures:");
  failures.forEach((f) => console.error(" ✘", f));
  process.exit(1);
}

console.log("✔ Phase 10 tests passed: 8 Overtake cars + Range Rover dealership, enter/drive/exit, NPC traffic, and snow/rain weather");
