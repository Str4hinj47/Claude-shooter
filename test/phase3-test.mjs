/* Phase 3 Midtown & Commercial Districts validation */

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

const { buildWestgateWorld, MIDTOWN_LANDMARKS, WESTGATE_TELEPORTS } = await import("../src/game/city/index.ts");

const failures = [];
const check = (cond, msg) => {
  if (!cond) failures.push(msg);
};

const group = new THREE.Group();
const scene = new THREE.Scene();
const fakeRenderer = { toneMappingExposure: 1 };
const level = buildWestgateWorld(group, scene, fakeRenderer);
const engine = level.openWorld;

// 1. Prewarm Midtown center (-260, -140)
engine.chunks.prewarm(-260, -140);

for (const lm of MIDTOWN_LANDMARKS) {
  const dist = level.getDistrictAt(lm.x, lm.z);
  check(dist.id === "midtown", `Landmark ${lm.id} should be in midtown, got ${dist.id}`);
  const gy = level.groundHeightAt(lm.x, lm.z, 200);
  check(Number.isFinite(gy) && gy >= 4.0, `Landmark ${lm.id} invalid ground height: ${gy}`);
  const inf = engine.roads.getRoadInfluence(lm.x, lm.z, 12, false);
  check(!inf || inf.edgeDist > 0, `Landmark ${lm.id} center overlaps road ${inf?.segmentId}`);
}

// 2. St. Jude's Medical Center Rooftop Helipad walkable surface check (x=-138, z=-252 -> helipad center at x=-146, z=-252)
const hospGround = level.groundHeightAt(-146, -210, 6);
const heliY = level.groundHeightAt(-146, -252, hospGround + 20.5);
check(heliY > hospGround + 18.5 && heliY < hospGround + 20.5,
  `Hospital helipad height unexpected: ground=${hospGround}, heli=${heliY}`);

// 3. Midtown AABB & chunk registration populated
check(engine.spatialAABBs.count > 45, `Expected >45 Midtown+road AABBs when in Midtown, got ${engine.spatialAABBs.count}`);

// 4. All teleports remain dry
for (const tp of WESTGATE_TELEPORTS) {
  const gy = level.groundHeightAt(tp.x, tp.z, 150);
  check(Number.isFinite(gy) && gy >= 2.2, `Teleport ${tp.id} invalid ground height ${gy}`);
}

level.openWorld.dispose();

if (failures.length > 0) {
  console.error("Phase 3 test failures:");
  failures.forEach((f) => console.error(" ✘", f));
  process.exit(1);
}

console.log("✔ Phase 3 tests passed: Grand Mall, Medical Center + Helipad, University Clocktower, Regal Cinema, Prep School & Athletic Field");
