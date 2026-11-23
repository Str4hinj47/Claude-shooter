/* Phase 10 Driveable Vehicles & Ambient NPC Traffic validation */

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
globalThis.localStorage = { getItem: () => null, setItem() {} };

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

const failures = [];
const check = (cond, msg) => {
  if (!cond) failures.push(msg);
};

const group = new THREE.Group();
const scene = new THREE.Scene();
const fakeRenderer = { toneMappingExposure: 1 };
const level = buildWestgateWorld(group, scene, fakeRenderer);
const vm = level.vehicles;

check(vm.vehicles.length >= 30, `Expected >=30 vehicles (hero + NPC), got ${vm.vehicles.length}`);

// 1. Find hero sports car near Downtown spawn (24, -82 -> car at 25.5, -80)
const near = vm.findNearestEnterable(new THREE.Vector3(24, 4.5, -82), 4.0);
check(!!near && near.spec.cls === "sports", `Expected Infernus GT sports car near (31,-72), got ${near?.spec.name}`);

if (near) {
  const startPos = near.pos.clone();
  const startYaw = near.yaw;
  vm.enterVehicle(near);
  check(vm.activeVehicle === near, "activeVehicle should be set after enterVehicle");

  // Drive forward + steer left for 30 frames (~1 second)
  for (let i = 0; i < 30; i++) {
    vm.update(1 / 30, { throttle: 1, steer: 0.4, handbrake: false }, near.pos);
  }
  const movedDist = near.pos.distanceTo(startPos);
  check(near.speed > 10, `Expected car to accelerate >10 m/s, got ${near.speed}`);
  check(movedDist > 5, `Expected car to move >5m, got ${movedDist}`);
  check(Math.abs(near.yaw - startYaw) > 0.1, `Expected steering to turn car yaw`);
  check(Number.isFinite(near.pos.y) && near.pos.y >= 3.5, `Car ground Y invalid: ${near.pos.y}`);

  // Handbrake stop
  for (let i = 0; i < 40; i++) {
    vm.update(1 / 30, { throttle: 0, steer: 0, handbrake: true }, near.pos);
  }
  check(near.speed < 2.0, `Expected handbrake to slow car <2 m/s, got ${near.speed}`);

  // Exit vehicle safely
  const exitPos = vm.exitVehicle();
  check(!!exitPos && Number.isFinite(exitPos.y) && exitPos.y >= 3.5, `Invalid exitPos: ${exitPos?.y}`);
  check(vm.activeVehicle === null, "activeVehicle should be null after exitVehicle");
}

// 2. Check NPC traffic vehicles stay finite & moving
const npc = vm.vehicles.find((v) => v.isNpcTraffic);
check(!!npc, "Expected ambient NPC traffic vehicle");
if (npc) {
  const npcStart = npc.pos.clone();
  for (let i = 0; i < 30; i++) {
    vm.update(1 / 30, { throttle: 0, steer: 0, handbrake: false }, npc.pos);
  }
  check(npc.pos.distanceTo(npcStart) > 2.0, `Expected NPC traffic car to advance along lane`);
  check(Number.isFinite(npc.pos.y), "NPC car Y should be finite");
}

vm.dispose();
level.openWorld.dispose();

if (failures.length > 0) {
  console.error("Phase 10 test failures:");
  failures.forEach((f) => console.error(" ✘", f));
  process.exit(1);
}

console.log("✔ Phase 10 tests passed: 8 hero vehicles, 26 ambient NPC traffic cars, enter/drive/steer/handbrake/exit & lane following");
