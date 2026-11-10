/* Headless level validation: runs all six world builders with stubbed
   WebGL/DOM bits and verifies geometry, colliders, AABBs and spawn spots. */

// ---- DOM stubs (canvas textures are generated via 2D context) ----
const ctxStub = new Proxy(
  {},
  {
    get: (_t, k) => {
      if (k === "createRadialGradient" || k === "createLinearGradient") return () => ({ addColorStop() {} });
      if (k === "measureText") return () => ({ width: 10 });
      if (k === "canvas") return { width: 1024, height: 1024 };
      return () => {};
    },
    set: () => true,
  },
);
globalThis.document = {
  createElement: (tag) => {
    if (tag === "canvas") return { width: 1024, height: 1024, getContext: () => ctxStub, style: {} };
    return { style: {} };
  },
};
globalThis.window = { devicePixelRatio: 1, addEventListener() {}, removeEventListener() {} };
globalThis.performance = globalThis.performance ?? { now: () => Date.now() };
globalThis.localStorage = { getItem: () => null, setItem() {} };

// ---- patch WebGL-dependent three bits (prototype patch — module namespace is frozen) ----
const THREE = await import("three");
THREE.CubeCamera.prototype.update = function () {};
THREE.PMREMGenerator.prototype.fromCubemap = function () {
  return { texture: new THREE.Texture() };
};
THREE.PMREMGenerator.prototype.fromScene = function () {
  return { texture: new THREE.Texture() };
};
THREE.PMREMGenerator.prototype.dispose = function () {};

const { buildLevel } = await import("../src/game/levels.ts");
const { MISSIONS } = await import("../src/game/story.ts");

const fakeRenderer = { toneMappingExposure: 1 };
const main = new THREE.Scene();

const problems = [];
const ok = (cond, msg) => {
  if (!cond) problems.push(msg);
};

function validateMission(m) {
  const group = new THREE.Group();
  const level = buildLevel(m.id, group, main, fakeRenderer);

  // 1. colliders finite
  let colliderCount = 0;
  for (const c of level.colliders) {
    colliderCount++;
    const p = c.position;
    ok(Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z), `${m.id} collider at non-finite pos`);
  }
  ok(colliderCount > 10, `${m.id} suspiciously few colliders: ${colliderCount}`);

  // 2. AABBs valid
  for (const b of level.aabbs) {
    ok(b.min.x <= b.max.x && b.min.y <= b.max.y && b.min.z <= b.max.z, `${m.id} invalid AABB`);
    ok(Number.isFinite(b.min.x), `${m.id} AABB non-finite`);
  }

  // 3. enemy spawns not buried in solids (unless intentionally elevated)
  const pointInAABBs = (x, y, z, pad = 0.5) => {
    for (const b of level.aabbs) {
      if (b.max.y - b.min.y < 0.35) continue; // floor-level thin planes are walkable
      if (y >= b.max.y - 0.02) continue; // standing on top of a surface is fine
      if (y > b.max.y || y + 1.8 < b.min.y) continue; // no vertical overlap
      const cx = Math.max(b.min.x, Math.min(x, b.max.x));
      const cz = Math.max(b.min.z, Math.min(z, b.max.z));
      const d = Math.hypot(x - cx, z - cz);
      if (d < pad) return b;
    }
    return null;
  };
  for (const e of m.enemies) {
    const y = e.y ?? 0;
    const pad = y > 0.5 ? 0.15 : 0.6;
    const hit = pointInAABBs(e.x, y, e.z, pad);
    ok(!hit, `${m.id} enemy spawn (${e.x},${y},${e.z}) inside AABB ${JSON.stringify(hit && [hit.min, hit.max])}`);
    // patrol waypoints must also be walkable
    if (e.patrol) {
      for (const wp of e.patrol) {
        const hit2 = pointInAABBs(wp[0], y, wp[1], pad);
        ok(!hit2, `${m.id} enemy patrol (${wp[0]},${wp[1]}) inside AABB ${JSON.stringify(hit2 && [hit2.min, hit2.max])}`);
      }
    }
  }
  // 4. player spawn / extraction / rescue walkable
  const sp = m.spawn;
  ok(!pointInAABBs(sp[0], 0, sp[1], 0.6), `${m.id} player spawn inside AABB`);
  if (!m.practice) ok(!pointInAABBs(m.extraction[0], 0, m.extraction[1], 0.6), `${m.id} extraction inside AABB`);
  if (m.rescue) ok(!pointInAABBs(m.rescue[0], 0, m.rescue[1], 0.6), `${m.id} rescue spot inside AABB`);
  if (m.ally) ok(!pointInAABBs(m.ally[0], 0, m.ally[1], 0.6), `${m.id} ally spawn inside AABB`);
  for (const d of m.destroyables ?? []) ok(!pointInAABBs(d[0], 0, d[1], 0.6), `${m.id} destroyable (${d}) inside AABB`);

  // 5. destroyable meshes present
  if (m.destroyables) ok(level.destroyables.length === m.destroyables.length, `${m.id} destroyables ${level.destroyables.length} vs ${m.destroyables.length}`);

  // 6. world update runs
  let threw = false;
  try {
    level.update(0.016, new THREE.Vector3(0, 0, 0));
  } catch {
    threw = true;
  }
  ok(!threw, `${m.id} world.update threw`);

  // 7. all mission spawn points on reasonable ground height (y≈0)
  for (const e of m.enemies) {
    if (e.y === undefined) ok(Math.abs(e.y ?? 0) < 0.1, `${m.id} enemy y drift`);
  }

  return { colliders: colliderCount, aabbs: level.aabbs.length, destroyables: level.destroyables.length };
}

console.log("validating", MISSIONS.length, "missions…\n");
for (const m of MISSIONS) {
  let stats;
  try {
    stats = validateMission(m);
    console.log(`✔ M${m.id} ${m.codename} — colliders: ${stats.colliders}, AABBs: ${stats.aabbs}, destroyables: ${stats.destroyables}`);
  } catch (e) {
    console.log(`✘ M${m.id} ${m.codename} — BUILD THREW: ${e.message}`);
    problems.push(`M${m.id} build threw: ${e.message}`);
  }
}

// cross-check story data
for (const m of MISSIONS) {
  ok(m.enemies.length > 0 || m.practice, `M${m.id} no enemies and not practice`);
  ok(m.spawn.length === 3, `M${m.id} bad spawn`);
  ok(m.extraction.length === 3, `M${m.id} bad extraction`);
  const eliminateCount = m.objectives.find((o) => o.kind === "eliminate")?.count ?? 0;
  ok(eliminateCount === m.enemies.filter((e) => !e.boss).length, `M${m.id} eliminate count ${eliminateCount} vs actual ${m.enemies.filter((e) => !e.boss).length}`);
}

console.log("\n===== PROBLEMS =====");
if (problems.length === 0) console.log("none ✔");
else {
  problems.forEach((p) => console.log("✘", p));
  process.exit(1);
}
