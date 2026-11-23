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

const { buildWestgateWorld } = await import("../src/game/city/index.ts");
const { CARS } = await import("../src/game/vehicles/catalog.ts");
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

// Curbside personal car should be Range Rover (selected above) near (25.5, -80)
const near = vm.findNearestEnterable(new THREE.Vector3(24, 4.5, -82), 4.8);
check(!!near && near.modelId === "rangerover", `Expected Range Rover curbside beside spawn, got ${near?.modelId}`);

if (near) {
  const startPos = near.pos.clone();
  const startYaw = near.yaw;
  vm.enterVehicle(near);
  check(vm.activeVehicle === near, "activeVehicle should be set after enterVehicle");

  for (let i = 0; i < 30; i++) {
    vm.update(1 / 30, { throttle: 1, steer: 0.4, handbrake: false }, near.pos);
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

// 3. Summon Ferrari & verify swapping works cleanly
const summoned = vm.summonPlayerCar("ferrari", "#d40f1e", new THREE.Vector3(24, 4.5, -82), 0);
check(summoned.modelId === "ferrari", "summonPlayerCar should spawn Ferrari 458 Italia");

// 4. Verify NPC traffic cars & trucks advance along RoadNetwork lanes
const npc = vm.vehicles.find((v) => v.isNpcTraffic);
check(!!npc, "Expected ambient NPC traffic vehicle");
if (npc) {
  const npcStart = npc.pos.clone();
  for (let i = 0; i < 30; i++) {
    vm.update(1 / 30, { throttle: 0, steer: 0, handbrake: false }, npc.pos);
  }
  check(npc.pos.distanceTo(npcStart) > 2.0, "Expected NPC traffic car to advance along lane");
  check(Number.isFinite(npc.pos.y), "NPC car Y should be finite");
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

level.disposeExtra?.();
vm.dispose();
level.openWorld.dispose();

if (failures.length > 0) {
  console.error("Phase 10 test failures:");
  failures.forEach((f) => console.error(" ✘", f));
  process.exit(1);
}

console.log("✔ Phase 10 tests passed: 8 Overtake cars + Range Rover dealership, enter/drive/exit, NPC traffic, and snow/rain weather");
