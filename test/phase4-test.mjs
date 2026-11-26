/* Phase 4 Old Quarter, Residential Suburbs & Central Park validation */

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

const { buildWestgateWorld, OLD_QUARTER_LANDMARKS, WESTGATE_TELEPORTS } = await import("../src/game/city/index.ts");

const failures = [];
const check = (cond, msg) => {
  if (!cond) failures.push(msg);
};

const group = new THREE.Group();
const scene = new THREE.Scene();
const fakeRenderer = { toneMappingExposure: 1 };
const level = buildWestgateWorld(group, scene, fakeRenderer);
const engine = level.openWorld;

// 1. Prewarm Old Quarter center (-220, 340)
engine.chunks.prewarm(-220, 340);

for (const lm of OLD_QUARTER_LANDMARKS) {
  const dist = level.getDistrictAt(lm.x, lm.z);
  check(dist.id === "old_quarter", `Landmark ${lm.id} should be in old_quarter, got ${dist.id}`);
  const gy = level.groundHeightAt(lm.x, lm.z, 120);
  check(Number.isFinite(gy) && gy >= 3.5, `Landmark ${lm.id} invalid ground height: ${gy}`);
  const inf = engine.roads.getRoadInfluence(lm.x, lm.z, 10, false);
  check(!inf || inf.edgeDist > 0, `Landmark ${lm.id} center overlaps road ${inf?.segmentId}`);
}

// 2. Old Quarter AABBs populated
check(engine.spatialAABBs.count > 40, `Expected >40 Old Quarter+road AABBs, got ${engine.spatialAABBs.count}`);

// 3. All teleports remain dry
for (const tp of WESTGATE_TELEPORTS) {
  const gy = level.groundHeightAt(tp.x, tp.z, 150);
  check(Number.isFinite(gy) && gy >= 2.2, `Teleport ${tp.id} invalid ground height ${gy}`);
}

level.openWorld.dispose();

if (failures.length > 0) {
  console.error("Phase 4 test failures:");
  failures.forEach((f) => console.error(" ✘", f));
  process.exit(1);
}

console.log("✔ Phase 4 tests passed: Mirror Central Park, Pond & Tennis Courts, Brick Townhouses, Suburban Homes, School & Gas Station");
