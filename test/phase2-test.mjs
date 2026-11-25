/* Phase 2 Downtown Financial & Civic Core validation */

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

const { buildWestgateWorld, DOWNTOWN_LANDMARKS } = await import("../src/game/city/index.ts");

const failures = [];
const check = (cond, msg) => {
  if (!cond) failures.push(msg);
};

const group = new THREE.Group();
const scene = new THREE.Scene();
const fakeRenderer = { toneMappingExposure: 1 };
const level = buildWestgateWorld(group, scene, fakeRenderer);
const engine = level.openWorld;
engine.chunks.prewarm(112, -162);

// 1. All Downtown landmarks built & clear of roads/viaducts
for (const lm of DOWNTOWN_LANDMARKS) {
  const gy = level.groundHeightAt(lm.x, lm.z, 200);
  check(Number.isFinite(gy) && gy >= 4.0, `Landmark ${lm.id} invalid ground height: ${gy}`);
  const inf = engine.roads.getRoadInfluence(lm.x, lm.z, 12, false);
  check(!inf || inf.edgeDist > 0, `Landmark ${lm.id} center overlaps road ${inf?.segmentId}`);
}

// 2. City Hall grand staircase step-up test
const chBase = level.groundHeightAt(136, -162, 4.5);
const chStep = level.groundHeightAt(139.8, -162, 5.4);
check(chStep > chBase + 0.5, `City Hall stairs should rise above ground (${chBase} -> ${chStep})`);

// 3. 3-Level Parking Deck walkable ramps & decks (x=224, z=52; Ramp 1 at x=212.5, Ramp 2 at x=220.5)
const deckG = level.groundHeightAt(212.5, 69, 4.7);
const deckRamp1Mid = level.groundHeightAt(212.5, 60, 6.6);
const deckL2 = level.groundHeightAt(228, 52, 8.6);
const deckRamp2Mid = level.groundHeightAt(220.5, 58, 10.4);
const deckRoof = level.groundHeightAt(228, 52, 12.6);
check(deckG < 5.2, `Parking ground should be ~4.5m, got ${deckG}`);
check(deckRamp1Mid > 5.8 && deckRamp1Mid < 7.2, `Parking ramp 1 midpoint unexpected: ${deckRamp1Mid}`);
check(deckL2 > 7.8 && deckL2 < 8.8, `Parking L2 height unexpected: ${deckL2}`);
check(deckRamp2Mid > 9.5 && deckRamp2Mid < 11.0, `Parking ramp 2 midpoint unexpected: ${deckRamp2Mid}`);
check(deckRoof > 11.6 && deckRoof < 12.8, `Parking roof height unexpected: ${deckRoof}`);

// 4. Downtown AABBs populated when standing in Downtown
check(engine.spatialAABBs.count > 80, `Expected >80 Downtown+road AABBs when near Downtown, got ${engine.spatialAABBs.count}`);

// 5. Distant skyline LOD check when standing far away at Bay Bridge (360, 595)
engine.chunks.prewarm(360, 595);
const spireChunk = engine.chunks.getChunkAt(-18, -238);
check(spireChunk && spireChunk.built && spireChunk.state === "lod" && spireChunk.lodGroup.visible,
  `Sovereign Spire chunk should be visible as LOD from Bay Bridge (state=${spireChunk?.state})`);

level.openWorld.dispose();

if (failures.length > 0) {
  console.error("Phase 2 test failures:");
  failures.forEach((f) => console.error(" ✘", f));
  process.exit(1);
}

console.log("✔ Phase 2 tests passed: Downtown skyscrapers, Legion Square, City Hall stairs, Police/Fire, 3-level Parking Deck ramps, and skyline LOD");
