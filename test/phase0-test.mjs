/* Phase 0 Open-World Engine Foundation test suite */

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
const {
  SpatialAABBGrid,
  SpatialColliderGrid,
  WorldHeightSystem,
  ChunkStreamer,
  PropBatcher,
  RoadNetwork,
  OpenWorldEngine,
} = await import("../src/game/city/index.ts");

const failures = [];
const check = (cond, msg) => {
  if (!cond) failures.push(msg);
};
const near = (a, b, eps = 0.05, msg = "") => {
  if (Math.abs(a - b) > eps) failures.push(`${msg}: expected ${b} ± ${eps}, got ${a}`);
};

// 1. SpatialAABBGrid
{
  const grid = new SpatialAABBGrid(32);
  const big = new THREE.Box3(new THREE.Vector3(-40, 0, -40), new THREE.Vector3(40, 5, 40));
  const small = new THREE.Box3(new THREE.Vector3(90, 0, 90), new THREE.Vector3(95, 4, 95));
  const idBig = grid.insert(big);
  grid.insert(small);

  check(grid.count === 2, "SpatialAABBGrid count should be 2");
  const hit = grid.queryRect(-50, -50, 50, 50, []);
  check(hit.length === 1 && hit[0] === big, `SpatialAABBGrid deduplication failed (got ${hit.length})`);
  const hitFar = grid.queryPoint(92, 92, 1, []);
  check(hitFar.length === 1 && hitFar[0] === small, "SpatialAABBGrid queryPoint failed");

  grid.remove(idBig);
  check(grid.count === 1, "SpatialAABBGrid remove failed");
  const afterRemove = grid.queryPoint(0, 0, 5, []);
  check(afterRemove.length === 0, "SpatialAABBGrid removed box still returned");
}

// 2. SpatialColliderGrid DDA raycast broadphase
{
  const cgrid = new SpatialColliderGrid(32);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(500, 500));
  cgrid.addGlobal(ground);

  const wallA = new THREE.Mesh(new THREE.BoxGeometry(4, 6, 4));
  wallA.position.set(80, 3, 80);
  cgrid.insert(wallA);

  const wallOffRay = new THREE.Mesh(new THREE.BoxGeometry(4, 6, 4));
  wallOffRay.position.set(-120, 3, 120);
  cgrid.insert(wallOffRay);

  const rayHits = cgrid.queryRay(new THREE.Vector3(0, 2, 0), new THREE.Vector3(1, 0, 1).normalize(), 160, []);
  check(rayHits.includes(ground), "SpatialColliderGrid missing global ground");
  check(rayHits.includes(wallA), "SpatialColliderGrid missed diagonal target cell");
  check(!rayHits.includes(wallOffRay), "SpatialColliderGrid included unrelated distant cell");

  const vertHits = cgrid.queryRay(new THREE.Vector3(80, 10, 80), new THREE.Vector3(0, -1, 0), 20, []);
  check(vertHits.includes(wallA), "SpatialColliderGrid vertical ray missed wallA");
}

// 3. WorldHeightSystem (terrain + overpass/underpass bridge + ramp normal)
{
  const aabbs = new SpatialAABBGrid(32);
  aabbs.insert(new THREE.Box3(new THREE.Vector3(10, 0, 10), new THREE.Vector3(14, 0.4, 14)));

  const terrain = (x, z) => (x < -10 ? 2.5 : 0);
  const hs = new WorldHeightSystem(terrain, aabbs);
  hs.addSurface({
    id: "overpass_test",
    minX: -5,
    maxX: 25,
    minZ: -4,
    maxZ: 4,
    minY: 8,
    maxY: 8,
    heightAt: (x, z) => (x >= -5 && x <= 25 && Math.abs(z) <= 4 ? 8.0 : null),
  });
  hs.addSurface({
    id: "ramp_test",
    minX: -25,
    maxX: -5,
    minZ: -4,
    maxZ: 4,
    minY: 0,
    maxY: 8,
    heightAt: (x, z) => (x >= -25 && x <= -5 && Math.abs(z) <= 4 ? ((x + 25) / 20) * 8.0 : null),
  });

  near(hs.groundHeightAt(0, 0, 0.2), 0, 0.01, "Underpass at y=0.2 should ignore y=8 bridge");
  near(hs.groundHeightAt(0, 0, 8.0), 8.0, 0.01, "On bridge deck at y=8.0 should return 8.0");
  near(hs.groundHeightAt(-15, 0, 4.1), 4.0, 0.05, "Mid-ramp elevation");
  near(hs.groundHeightAt(12, 12, 0.0), 0.4, 0.01, "Step-up onto 0.4m AABB platform");
  near(hs.groundHeightAt(-20, 30, 0), 2.5, 0.01, "Terrain height query");

  const nrm = hs.surfaceNormalAt(-15, 0, 4.0);
  check(nrm.y > 0.85 && nrm.x < -0.2, `Ramp normal unexpected: ${nrm.toArray().join(",")}`);
}

// 4. ChunkStreamer (160m chunks over 2.4km x 2.4km)
{
  const aabbs = new SpatialAABBGrid(32);
  const cgrid = new SpatialColliderGrid(32);
  const streamer = new ChunkStreamer(
    (chunk) => {
      const box = new THREE.Mesh(new THREE.BoxGeometry(10, 10, 10));
      box.position.set(chunk.centerX, 5, chunk.centerZ);
      chunk.nearGroup.add(box);
      chunk.colliders.push(box);
      chunk.aabbs.push(new THREE.Box3().setFromCenterAndSize(new THREE.Vector3(chunk.centerX, 5, chunk.centerZ), new THREE.Vector3(10, 10, 10)));

      const lod = new THREE.Mesh(new THREE.BoxGeometry(10, 10, 10));
      lod.position.set(chunk.centerX, 5, chunk.centerZ);
      chunk.lodGroup.add(lod);
    },
    { nearRadius: 200, lodRadius: 420, hysteresis: 20, maxBuildsPerFrame: 4, spatialAABBs: aabbs, spatialColliders: cgrid },
  );

  check(streamer.gridCount === 15, `Expected 15x15 chunks for 2400m/160m, got ${streamer.gridCount}`);
  streamer.prewarm(0, 0);
  const s1 = streamer.getStats();
  check(s1.total === 225, `Total chunks should be 225, got ${s1.total}`);
  check(s1.near > 0 && s1.lod > 0 && s1.culled > 0, `Invalid prewarm chunk states: ${JSON.stringify(s1)}`);
  check(aabbs.count > 0, "Near chunks should register AABBs into SpatialAABBGrid");

  // Move focus far away across the city
  for (let i = 0; i < 10; i++) streamer.update(new THREE.Vector3(900, 0, 900));
  const originChunk = streamer.getChunkAt(0, 0);
  const farChunk = streamer.getChunkAt(900, 900);
  check(originChunk?.state === "unloaded", `Origin chunk should cull when focus at 900,900 (got ${originChunk?.state})`);
  check(farChunk?.state === "near", `Far chunk at 900,900 should be near (got ${farChunk?.state})`);
  streamer.dispose();
}

// 5. PropBatcher (InstancedMesh quadrant batching + AABBs)
{
  const batcher = new PropBatcher(480);
  batcher.registerPrototype({
    id: "streetlight",
    colliderSize: [0.4, 6.0, 0.4],
    parts: [
      {
        geometry: new THREE.CylinderGeometry(0.1, 0.14, 6, 8),
        material: new THREE.MeshStandardMaterial({ color: 0x3a4048 }),
        localOffset: [0, 3, 0],
      },
      {
        geometry: new THREE.BoxGeometry(0.6, 0.18, 0.3),
        material: new THREE.MeshStandardMaterial({ color: 0xffe4aa, emissive: 0xffc864 }),
        localOffset: [0.5, 6, 0],
        preserveBaseColor: true,
      },
    ],
  });

  for (let i = 0; i < 25; i++) {
    batcher.addInstance("streetlight", { x: -600 + i * 50, y: 0, z: 10, ry: 0.2, hueShift: (i % 3) * 0.02 });
  }
  const aabbs = new SpatialAABBGrid(32);
  const root = new THREE.Group();
  batcher.build(root, aabbs);
  const stats = batcher.getStats();
  check(stats.instances === 25, `PropBatcher instances expected 25, got ${stats.instances}`);
  check(stats.colliders === 25, `PropBatcher colliders expected 25, got ${stats.colliders}`);
  check(stats.meshes >= 4 && stats.meshes <= 10, `PropBatcher quadrant meshes unexpected: ${stats.meshes}`);
  check(aabbs.count === 25, "PropBatcher should register 25 pole AABBs");
}

// 6. RoadNetwork & OpenWorldEngine
{
  const engine = new OpenWorldEngine({
    terrainAt: () => 0,
    chunkBuilder: (c) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(8, 12, 8));
      m.position.set(c.centerX, 6, c.centerZ);
      c.nearGroup.add(m);
    },
  });

  engine.roads.addNodes([
    { id: "rb_center", x: 0, y: 0, z: 0, kind: "roundabout", radius: 18 },
    { id: "sig_east", x: 220, y: 0, z: 20, kind: "signal" },
    { id: "cul_north", x: 230, y: 0, z: -180, kind: "culdesac" },
  ]);

  engine.roads.addSegments([
    {
      id: "arterial_ew",
      tier: "arterial",
      startNodeId: "rb_center",
      endNodeId: "sig_east",
      points: [
        [20, 0, 0],
        [95, 0, 26],
        [165, 0, -10],
        [220, 0, 20],
      ],
    },
    {
      id: "collector_north",
      tier: "collector",
      startNodeId: "sig_east",
      endNodeId: "cul_north",
      points: [
        [220, 0, 20],
        [248, 0, -65],
        [230, 0, -180],
      ],
    },
    {
      id: "freeway_bridge",
      tier: "freeway",
      isBridge: true,
      points: [
        [-250, 0, -80],
        [-100, 9, -60],
        [100, 9, -55],
        [260, 0, -80],
      ],
    },
  ]);

  engine.finalizeStaticWorld(0, 0);
  const stats = engine.getStats();
  check(stats.lanes >= 8, `Expected >= 8 traffic lanes (incl roundabout), got ${stats.lanes}`);
  check(stats.parkedBays > 0, `Expected collector road to generate parked bays, got ${stats.parkedBays}`);

  // Road influence along curved arterial
  const inf = engine.roads.getRoadInfluence(95, 26, 20);
  check(inf !== null && inf.segmentId === "arterial_ew" && inf.centerDist < 2.0, `RoadInfluence failed: ${JSON.stringify(inf)}`);

  // Bridge underpass vs overpass
  const bridgeInf = engine.roads.getRoadInfluence(0, -57, 25);
  check(bridgeInf !== null && bridgeInf.isBridge, "Expected freeway_bridge influence at (0, -57)");
  near(engine.groundHeightAt(0, -57, 0.2), 0, 0.1, "Below curved freeway bridge should be terrain y=0");
  near(
    engine.groundHeightAt(0, -57, bridgeInf.elevation),
    bridgeInf.elevation,
    0.1,
    "On curved freeway bridge should match bridge deck elevation",
  );

  // Car-kit query API: nearest lane & connected lanes
  const hit = engine.nearestLanePoint(100, 26, 25);
  check(hit !== null && hit.lane.segmentId === "arterial_ew", "nearestLanePoint failed on arterial_ew");
  const spawns = engine.sampleTrafficSpawnPoints(5, 15, () => 0.42);
  check(spawns.length > 0, "sampleTrafficSpawnPoints returned 0 points");

  // Roundabout connectivity check
  const rb = engine.roads.getLane("roundabout:rb_center");
  check(rb !== undefined && rb.nextLanes.length >= 2, "Roundabout lane connectivity missing");

  // Verify road ribbon normals point upward (+Y)
  let checkedRoadGeo = false;
  engine.root.traverse((o) => {
    if (o.userData?.roadId === "arterial_ew") {
      const nrm = o.geometry.getAttribute("normal");
      check(nrm && nrm.getY(0) > 0.9, `Road surface normal should face +Y, got ${nrm?.getY(0)}`);
      checkedRoadGeo = true;
    }
  });
  check(checkedRoadGeo, "Road mesh for arterial_ew not built");

  engine.dispose();
}

if (failures.length > 0) {
  console.error("Phase 0 test failures:");
  failures.forEach((f) => console.error(" ✘", f));
  process.exit(1);
}

console.log("✔ Phase 0 tests passed: SpatialAABBGrid, SpatialColliderGrid, WorldHeightSystem, ChunkStreamer, PropBatcher, RoadNetwork, OpenWorldEngine");
