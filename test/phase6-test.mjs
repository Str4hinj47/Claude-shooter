/* Phase 6 Northern Foothills, Observatory & Vinewood Crest Estates validation */

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

const { buildWestgateWorld, FOOTHILLS_LANDMARKS, WESTGATE_TELEPORTS } = await import("../src/game/city/index.ts");

const failures = [];
const check = (cond, msg) => {
  if (!cond) failures.push(msg);
};

const group = new THREE.Group();
const scene = new THREE.Scene();
const fakeRenderer = { toneMappingExposure: 1 };
const level = buildWestgateWorld(group, scene, fakeRenderer);
const engine = level.openWorld;

// 1. Prewarm Foothills Summit & Estates
engine.chunks.prewarm(-120, -900);

for (const lm of FOOTHILLS_LANDMARKS) {
  const dist = level.getDistrictAt(lm.x, lm.z);
  check(dist.id === "foothills", `Landmark ${lm.id} should be in foothills, got ${dist.id}`);
  const gy = level.groundHeightAt(lm.x, lm.z, 200);
  check(Number.isFinite(gy) && gy >= 10, `Landmark ${lm.id} should sit elevated in foothills, got ${gy}`);
}

// 2. Observatory summit elevation & walkable terrace (~68m+)
const obsY = level.groundHeightAt(-120, -985, 80);
check(obsY >= 64, `Observatory terrace should sit >=64m above sea level, got ${obsY}`);

// 3. All teleports remain dry
for (const tp of WESTGATE_TELEPORTS) {
  const gy = level.groundHeightAt(tp.x, tp.z, 200);
  check(Number.isFinite(gy) && gy >= 2.2, `Teleport ${tp.id} invalid ground height ${gy}`);
}

level.openWorld.dispose();

if (failures.length > 0) {
  console.error("Phase 6 test failures:");
  failures.forEach((f) => console.error(" ✘", f));
  process.exit(1);
}

console.log("✔ Phase 6 tests passed: Westgate Observatory Summit, WESTGATE Hillside Sign, Vinewood Crest Mansions & Ranger Outpost");
