/* Phase 8 & Phase 9 Citywide Prop Dressing + VehicleKitWorldBridge & Full-City Verification */

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

// 1. Phase 8 Instanced Prop Dressing stats
const stats = engine.getStats();
console.log("Westgate Bay Full City stats:", JSON.stringify(stats));
check(stats.props.prototypes === 6, `Expected 6 prop prototypes, got ${stats.props.prototypes}`);
check(stats.props.instances > 600, `Expected >600 instanced city props, got ${stats.props.instances}`);
check(stats.props.colliders > 500, `Expected >500 prop AABB colliders, got ${stats.props.colliders}`);

// 2. Verify NO teleport spawn sits inside a prop or building AABB
const queryOut = [];
for (const tp of WESTGATE_TELEPORTS) {
  engine.chunks.prewarm(tp.x, tp.z);
  const gy = level.groundHeightAt(tp.x, tp.z, 200);
  check(Number.isFinite(gy) && gy >= 2.2, `Teleport ${tp.id} invalid ground height ${gy}`);
  const hits = engine.spatialAABBs.queryPoint(tp.x, tp.z, 0.8, queryOut);
  const blocking = hits.filter(
    (b) =>
      b.min.x <= tp.x + 0.6 &&
      b.max.x >= tp.x - 0.6 &&
      b.min.z <= tp.z + 0.6 &&
      b.max.z >= tp.z - 0.6 &&
      b.max.y > gy + 0.6 &&
      b.min.y < gy + 2.0,
  );
  check(blocking.length === 0, `Teleport ${tp.id} (${tp.x},${tp.z}) blocked by ${blocking.length} AABB(s)`);
}

// 3. Phase 9 VehicleKitWorldBridge contract verification
const laneHit = engine.nearestLanePoint(60, -40, 60);
check(!!laneHit && Math.sqrt(laneHit.distSq) < 35, `Expected nearestLanePoint hit near Downtown, got distSq=${laneHit?.distSq}`);
if (laneHit) {
  const connected = engine.getConnectedLanes(laneHit.lane.id);
  check(Array.isArray(connected), "getConnectedLanes should return array");
}
const spawns = engine.sampleTrafficSpawnPoints(24, 30);
check(spawns.length === 24, `Expected 24 traffic spawn points, got ${spawns.length}`);
const bays = engine.getParkedBays();
check(bays.length > 800, `Expected >800 parked bays for vehicle kit, got ${bays.length}`);

// Surface normal check on flat Downtown & sloped Foothills
const nFlat = engine.surfaceNormalAt(24, -82, 5);
check(nFlat.y > 0.98, `Expected upward flat road normal, got y=${nFlat.y}`);
const nHill = engine.surfaceNormalAt(-220, -900, 50);
check(nHill.y > 0.4 && nHill.y <= 1.0, `Expected valid hillside normal, got y=${nHill.y}`);

// 4. All 8 districts reachable
const districtIds = new Set();
const probes = [
  [-950, 0],
  [24, -82],
  [-260, -140],
  [-170, 340],
  [-120, -980],
  [-650, 40],
  [650, 100],
  [-120, 880],
];
for (const [px, pz] of probes) {
  districtIds.add(level.getDistrictAt(px, pz).id);
}
check(districtIds.size === 8, `Expected all 8 districts, got ${districtIds.size}: ${Array.from(districtIds).join(",")}`);

level.openWorld.dispose();

if (failures.length > 0) {
  console.error("Phase 8/9 test failures:");
  failures.forEach((f) => console.error(" ✘", f));
  process.exit(1);
}

console.log("✔ Phase 8 & 9 tests passed: 600+ instanced city props, 0 blocked teleports, 8 districts, and VehicleKitWorldBridge contract");
