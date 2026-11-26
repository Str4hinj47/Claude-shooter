/* Phase 7 East Industrial, Seaport Docks & South Airport/Arena validation */

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

const { buildWestgateWorld, PORT_AIRPORT_LANDMARKS, WESTGATE_TELEPORTS } = await import("../src/game/city/index.ts");

const failures = [];
const check = (cond, msg) => {
  if (!cond) failures.push(msg);
};

const group = new THREE.Group();
const scene = new THREE.Scene();
const fakeRenderer = { toneMappingExposure: 1 };
const level = buildWestgateWorld(group, scene, fakeRenderer);
const engine = level.openWorld;

// 1. Prewarm East Seaport & South Airport
engine.chunks.prewarm(645, 200);
engine.chunks.prewarm(50, 880);

for (const lm of PORT_AIRPORT_LANDMARKS) {
  const gy = level.groundHeightAt(lm.x, lm.z, 120);
  check(Number.isFinite(gy) && gy >= 2.3, `Landmark ${lm.id} invalid ground height: ${gy}`);
  const inf = engine.roads.getRoadInfluence(lm.x, lm.z, 12, false);
  check(!inf || inf.edgeDist > 0, `Landmark ${lm.id} center overlaps road ${inf?.segmentId}`);
}

// 2. All teleports remain dry
for (const tp of WESTGATE_TELEPORTS) {
  const gy = level.groundHeightAt(tp.x, tp.z, 200);
  check(Number.isFinite(gy) && gy >= 2.2, `Teleport ${tp.id} invalid ground height ${gy}`);
}

level.openWorld.dispose();

if (failures.length > 0) {
  console.error("Phase 7 test failures:");
  failures.forEach((f) => console.error(" ✘", f));
  process.exit(1);
}

console.log("✔ Phase 7 tests passed: Eastgate Seaport & Cranes, Power Plant, Tank Farm, Rail Yard, Int'l Airport & Runway, Sports Arena");
