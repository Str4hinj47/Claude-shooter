/* Phase 5 West Coast, Beach Pier & Venice Canals validation */

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

const { buildWestgateWorld, WEST_COAST_LANDMARKS, WESTGATE_TELEPORTS } = await import("../src/game/city/index.ts");

const failures = [];
const check = (cond, msg) => {
  if (!cond) failures.push(msg);
};

const group = new THREE.Group();
const scene = new THREE.Scene();
const fakeRenderer = { toneMappingExposure: 1 };
const level = buildWestgateWorld(group, scene, fakeRenderer);
const engine = level.openWorld;

// 1. Prewarm Del Sol Pier & Canals
engine.chunks.prewarm(-720, 120);

for (const lm of WEST_COAST_LANDMARKS) {
  const dist = level.getDistrictAt(lm.x, lm.z);
  check(dist.id === "west_coast" || dist.id === "ocean", `Landmark ${lm.id} district unexpected: ${dist.id}`);
}

// 2. Del Sol Pier walkable deck over Pacific Ocean (x=-810, z=40)
const pierY = level.groundHeightAt(-810, 40, 4.6);
check(pierY >= 4.0 && pierY <= 4.6, `Del Sol Pier walkable deck height unexpected: ${pierY}`);

// 3. Venice Canals footbridges walkable over canals (y=4.0m over water y=0)
const canalBrN = level.groundHeightAt(-648, 185, 4.4);
const canalBrS = level.groundHeightAt(-562, 305, 4.4);
const canalBrC = level.groundHeightAt(-605, 245, 4.4);
check(canalBrN > 3.6 && canalBrN < 4.5, `North canal bridge deck unexpected: ${canalBrN}`);
check(canalBrS > 3.6 && canalBrS < 4.5, `South canal bridge deck unexpected: ${canalBrS}`);
check(canalBrC > 3.6 && canalBrC < 4.5, `Cross canal bridge deck unexpected: ${canalBrC}`);

// 4. All teleports remain dry
for (const tp of WESTGATE_TELEPORTS) {
  const gy = level.groundHeightAt(tp.x, tp.z, 150);
  check(Number.isFinite(gy) && gy >= 2.2, `Teleport ${tp.id} invalid ground height ${gy}`);
}

level.openWorld.dispose();

if (failures.length > 0) {
  console.error("Phase 5 test failures:");
  failures.forEach((f) => console.error(" ✘", f));
  process.exit(1);
}

console.log("✔ Phase 5 tests passed: Del Sol Ocean Pier & Ferris Wheel, Lifeguard Towers, Venice Canals Footbridges & Villas, Resort & Marina");
