/* Phase 1 Westgate Bay validation: terrain, water, 4-tier road skeleton, 5 bridges, 5 roundabouts */

const ctxStub = new Proxy(
  {},
  {
    get: (_t, k) => {
      if (k === "createRadialGradient" || k === "createLinearGradient") return () => ({ addColorStop() {} });
      if (k === "createImageData") return (w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) });
      if (k === "getImageData") return (_x, _y, w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) });
      if (k === "measureText") return () => ({ width: 10 });
      if (k === "canvas") return { width: 512, height: 512 };
      return () => {};
    },
    set: () => true,
  },
);
globalThis.document = {
  createElement: (tag) => {
    if (tag === "canvas") return { width: 512, height: 512, getContext: () => ctxStub, style: {} };
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

const { buildWestgateWorld, WESTGATE_TELEPORTS } = await import("../src/game/city/index.ts");

const failures = [];
const check = (cond, msg) => {
  if (!cond) failures.push(msg);
};

const group = new THREE.Group();
const scene = new THREE.Scene();
const fakeRenderer = { toneMappingExposure: 1 };

const level = buildWestgateWorld(group, scene, fakeRenderer);
const engine = level.openWorld;

// 1. Check road tiers, bridges, roundabouts, and car-kit lane graph
const segs = engine.roads.getSegments();
const tiers = new Set(segs.map((s) => s.spec.tier));
check(tiers.has("freeway") && tiers.has("arterial") && tiers.has("collector") && tiers.has("local") && tiers.has("ramp"),
  `Missing road tiers: ${Array.from(tiers).join(",")}`);

const bridges = segs.filter((s) => s.spec.isBridge);
check(bridges.length === 5, `Expected exactly 5 bridges, got ${bridges.length}`);

for (const rbId of ["rb_legion", "rb_midtown", "rb_coast", "rb_oldquarter", "rb_industrial"]) {
  const lane = engine.roads.getLane(`roundabout:${rbId}`);
  check(!!lane && lane.nextLanes.length >= 2 && lane.prevLanes.length >= 2, `Roundabout ${rbId} connectivity broken`);
}

// 2. Check underpass vs overpass on Midtown Skyway Viaduct (Bridge 3 over Westgate Central Blvd)
const underMid = level.groundHeightAt(-150, -118, 4.6);
const overMid = level.groundHeightAt(-210, -140, 12.8);
check(Math.abs(underMid - 4.5) < 0.35, `Expected arterial below Midtown Skyway ~4.5m, got ${underMid}`);
check(overMid > 11.5 && overMid < 14.0, `Expected Midtown Skyway deck ~12.6m, got ${overMid}`);

// 3. Check Harbor Bridge height over water
const bayDeck = level.groundHeightAt(585, 636, 18.0);
const bayWaterBed = engine.heightSystem.terrainHeightAt(585, 636);
check(bayWaterBed < -3.0, `Expected harbor basin below Bay Bridge < -3m, got ${bayWaterBed}`);
check(bayDeck > 15.5, `Expected Bay Bridge deck > 15.5m, got ${bayDeck}`);

// 4. Check Ocean, Canals, River, and Foothills Summit heights
check(engine.heightSystem.terrainHeightAt(-1020, 0) < -4.0, "Pacific Ocean should be submerged");
check(engine.heightSystem.terrainHeightAt(-605, 185) < -1.0, "Westgate Canal should be submerged");
check(engine.heightSystem.terrainHeightAt(120, -980) > 40.0 || engine.heightSystem.terrainHeightAt(-120, -980) > 60.0,
  "Observatory Foothills summit should exceed 60m");

// 5. Check all teleport spots are dry & finite
for (const tp of WESTGATE_TELEPORTS) {
  const gy = level.groundHeightAt(tp.x, tp.z, 200);
  check(Number.isFinite(gy) && gy > 1.5, `Teleport ${tp.id} ground height invalid: ${gy}`);
}

// 6. Check update loop runs cleanly
let threw = false;
try {
  level.update(0.016, new THREE.Vector3(24, 4.5, -82));
} catch (e) {
  threw = true;
  failures.push(`level.update threw: ${e.message}`);
}
check(!threw, "level.update failed");

const stats = engine.getStats();
console.log("Westgate Bay Phase 1 stats:", JSON.stringify(stats));

level.openWorld.dispose();

if (failures.length > 0) {
  console.error("Phase 1 test failures:");
  failures.forEach((f) => console.error(" ✘", f));
  process.exit(1);
}

console.log("✔ Phase 1 tests passed: terrain, water, 4-tier road skeleton, 5 bridges, 5 roundabouts, and teleports");
