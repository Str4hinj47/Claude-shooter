import fs from "node:fs";
import path from "node:path";

// Headless DOM stubs so WestgateWorld & Three.js run cleanly in Node
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

const { buildWestgateWorld, WESTGATE_SPAWN, WESTGATE_TELEPORTS } = await import("../src/game/city/index.ts");
const { FIGHT_PIT_CENTER } = await import("../src/game/city/UndergroundFightPit.ts");
const { WEAPONS } = await import("../src/character/rifle.ts");

const outDir = path.resolve("native/assets/world");
fs.mkdirSync(outDir, { recursive: true });

const group = new THREE.Group();
const scene = new THREE.Scene();
const fakeRenderer = { toneMappingExposure: 1 };
const level = buildWestgateWorld(group, scene, fakeRenderer);
const engine = level.openWorld;

// 1. Export 1024x1024 Float32 binary heightfield [-1200..+1200] + offshore coastal islands
const GRID_N = 1024;
const WORLD_MIN = -1200;
const WORLD_MAX = 1200;

function smoothIslandHeight(x, z, cx, cz, radius, peakH) {
  const dx = x - cx;
  const dz = z - cz;
  const d = Math.hypot(dx, dz);
  if (d >= radius) return -10;
  const u = 1 - d / radius;
  const ridge = Math.sin(x * 0.055) * Math.cos(z * 0.062) * 1.4;
  return peakH * (u * u * (3 - 2 * u)) + ridge * u - 0.6;
}

function nativeTerrainHeightAt(x, z) {
  let h = engine.heightSystem.terrainHeightAt(x, z);
  // Pelican Key Island (west bay, connected by suspension causeway)
  h = Math.max(h, smoothIslandHeight(x, z, -965, 390, 128, 12.5));
  // Smuggler's Atoll (northwest bay, boat-only cove)
  h = Math.max(h, smoothIslandHeight(x, z, -1040, -340, 96, 8.8));
  return h;
}

const hf = new Float32Array(GRID_N * GRID_N);
for (let iz = 0; iz < GRID_N; iz++) {
  const z = WORLD_MIN + (iz / (GRID_N - 1)) * (WORLD_MAX - WORLD_MIN);
  for (let ix = 0; ix < GRID_N; ix++) {
    const x = WORLD_MIN + (ix / (GRID_N - 1)) * (WORLD_MAX - WORLD_MIN);
    hf[iz * GRID_N + ix] = Number(nativeTerrainHeightAt(x, z).toFixed(3));
  }
}
fs.writeFileSync(path.join(outDir, "westgate_heightfield.bin"), Buffer.from(hf.buffer));

// 2. Prewarm all 225 chunks synchronously to extract building boxes + colors per chunk
engine.chunks.prewarm(0, 0, 2200, false);
const chunksOut = [];
const tmpBox = new THREE.Box3();
const tmpCol = new THREE.Color();

for (const c of engine.chunks.getChunks()) {
  c.nearGroup.updateMatrixWorld(true);
  const boxes = [];
  for (const b of c.aabbs) {
    const w = +(b.max.x - b.min.x).toFixed(2);
    const h = +(b.max.y - b.min.y).toFixed(2);
    const d = +(b.max.z - b.min.z).toFixed(2);
    if (w < 0.2 || h < 0.2 || d < 0.2) continue;
    const cx = +((b.min.x + b.max.x) * 0.5).toFixed(2);
    const cy = +((b.min.y + b.max.y) * 0.5).toFixed(2);
    const cz = +((b.min.z + b.max.z) * 0.5).toFixed(2);
    // Assign deterministic district architectural palette based on height & coordinates
    let color = [0.58, 0.62, 0.68];
    if (h > 42) color = [0.22, 0.36, 0.48];
    else if (h > 22) color = [0.34, 0.42, 0.5];
    else if (cx < -150 && cz > 50) color = [0.64, 0.42, 0.34];
    else if (cx < -350) color = [0.82, 0.75, 0.64];
    else if (cx > 420) color = [0.46, 0.48, 0.52];
    boxes.push({ cx, cy, cz, w, h, d, color });
  }

  // Fallback for decorative-only chunks without collider AABBs: inspect nearGroup meshes
  if (boxes.length === 0) {
    c.nearGroup.traverse((o) => {
      if (!o.isMesh || !o.geometry) return;
      tmpBox.setFromObject(o);
      if (tmpBox.isEmpty()) return;
      const w = +(tmpBox.max.x - tmpBox.min.x).toFixed(2);
      const h = +(tmpBox.max.y - tmpBox.min.y).toFixed(2);
      const d = +(tmpBox.max.z - tmpBox.min.z).toFixed(2);
      if (w < 1.5 || h < 1.5 || d < 1.5 || w > 120 || d > 120) return;
      const mat = Array.isArray(o.material) ? o.material[0] : o.material;
      if (mat && mat.color) tmpCol.copy(mat.color);
      else tmpCol.setHex(0x8899aa);
      boxes.push({
        cx: +((tmpBox.min.x + tmpBox.max.x) * 0.5).toFixed(2),
        cy: +((tmpBox.min.y + tmpBox.max.y) * 0.5).toFixed(2),
        cz: +((tmpBox.min.z + tmpBox.max.z) * 0.5).toFixed(2),
        w,
        h,
        d,
        color: [+tmpCol.r.toFixed(2), +tmpCol.g.toFixed(2), +tmpCol.b.toFixed(2)],
      });
    });
  }

  chunksOut.push({
    key: c.key,
    cx: c.cx,
    cz: c.cz,
    minX: c.minX,
    maxX: c.maxX,
    minZ: c.minZ,
    maxZ: c.maxZ,
    boxes,
  });
}

// 3. Roads (+ Pelican Key Suspension Causeway & North Canyon Switchbacks)
const roadsOut = engine.roads.getSegments().map((seg) => ({
  id: seg.spec.id,
  name: seg.spec.name,
  tier: seg.spec.tier,
  width: +seg.totalWidth.toFixed(2),
  isBridge: !!seg.spec.isBridge,
  samples: seg.samples
    .filter((_, idx) => idx % 2 === 0 || idx === seg.samples.length - 1)
    .map((sp) => [
      +sp.x.toFixed(2),
      +(nativeTerrainHeightAt(sp.x, sp.z) + 0.08).toFixed(2),
      +sp.z.toFixed(2),
      +sp.rx.toFixed(3),
      +sp.rz.toFixed(3),
    ]),
}));

function buildSplineRoad(id, name, tier, width, isBridge, pts, bridgeDeckFn = null) {
  const samples = [];
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const prev = pts[Math.max(0, i - 1)];
    const next = pts[Math.min(pts.length - 1, i + 1)];
    const dx = next[0] - prev[0];
    const dz = next[1] - prev[1];
    const len = Math.max(1e-4, Math.hypot(dx, dz));
    const rx = -dz / len;
    const rz = dx / len;
    const t = i / Math.max(1, pts.length - 1);
    const y = bridgeDeckFn ? bridgeDeckFn(p[0], p[1], t) : nativeTerrainHeightAt(p[0], p[1]) + 0.08;
    samples.push([+p[0].toFixed(2), +y.toFixed(2), +p[1].toFixed(2), +rx.toFixed(3), +rz.toFixed(3)]);
  }
  roadsOut.push({ id, name, tier, width, isBridge, samples });
}

// Pelican Key Suspension Bay Causeway: Del Sol Pier (-706, 65) -> Pelican Key (-920, 345)
{
  const pts = [];
  const N = 20;
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    pts.push([-706 + (-920 - -706) * t, 65 + (345 - 65) * t]);
  }
  buildSplineRoad("pelican_bridge", "Pelican Key Bay Bridge", "arterial", 11.0, true, pts, (x, z, t) => {
    const ground = nativeTerrainHeightAt(x, z) + 0.12;
    const arch = Math.sin(t * Math.PI) * 14.5;
    return Math.max(ground, 2.2 + arch);
  });
}

// North Ridge Mountain Canyon Switchback Road
{
  const canyonPts = [
    [-210, -780], [-140, -830], [-65, -860], [15, -835], [90, -885],
    [165, -935], [250, -900], [335, -850], [415, -880], [490, -820],
  ];
  buildSplineRoad("canyon_switchback", "North Ridge Canyon Drive", "secondary", 9.0, false, canyonPts);
}

// 4. Props (+ Pelican Key & Smuggler's Atoll island trees, lighthouse rocks & docks)
const propsOut = engine.props.getPlacements().map((p) => ({
  proto: p.protoId,
  x: +p.x.toFixed(2),
  y: +p.y.toFixed(2),
  z: +p.z.toFixed(2),
  ry: +p.ry.toFixed(3),
  s: +p.sy.toFixed(2),
}));

for (let i = 0; i < 18; i++) {
  const a = (i / 18) * Math.PI * 2;
  const r = 42 + (i % 3) * 22;
  const px = -965 + Math.cos(a) * r;
  const pz = 390 + Math.sin(a) * r;
  propsOut.push({ proto: i % 3 === 0 ? "rock" : "palm_tree", x: +px.toFixed(2), y: +nativeTerrainHeightAt(px, pz).toFixed(2), z: +pz.toFixed(2), ry: +(a + 0.5).toFixed(2), s: 1.1 });
}
for (let i = 0; i < 14; i++) {
  const a = (i / 14) * Math.PI * 2;
  const r = 28 + (i % 3) * 18;
  const px = -1040 + Math.cos(a) * r;
  const pz = -340 + Math.sin(a) * r;
  propsOut.push({ proto: i % 4 === 0 ? "rock" : "palm_tree", x: +px.toFixed(2), y: +nativeTerrainHeightAt(px, pz).toFixed(2), z: +pz.toFixed(2), ry: +a.toFixed(2), s: 1.05 });
}

// 5. Teleports & Weapons
const teleportsOut = WESTGATE_TELEPORTS.map((t) => ({
  id: t.id,
  label: t.label,
  x: t.x,
  y: +Math.max(nativeTerrainHeightAt(t.x, t.z), engine.groundHeightAt(t.x, t.z, 200)).toFixed(2),
  z: t.z,
  yawDeg: t.yawDeg ?? 0,
}));
teleportsOut.push(
  { id: "pelican_key", label: "Pelican Key Island", x: -965, y: +(nativeTerrainHeightAt(-965, 390) + 1.0).toFixed(2), z: 390, yawDeg: 45 },
  { id: "smugglers_atoll", label: "Smuggler's Atoll", x: -1040, y: +(nativeTerrainHeightAt(-1040, -340) + 1.0).toFixed(2), z: -340, yawDeg: 135 },
  { id: "canyon_ridge", label: "North Ridge Canyon", x: 165, y: +(nativeTerrainHeightAt(165, -935) + 1.0).toFixed(2), z: -935, yawDeg: 180 },
);

const weaponsOut = WEAPONS.map((w) => ({
  id: w.id,
  name: w.name,
  category: w.category,
  damage: w.damage,
  rpm: w.rpm,
  magSize: w.magSize,
}));

const manifest = {
  version: 1,
  worldMin: WORLD_MIN,
  worldMax: WORLD_MAX,
  heightfieldGrid: GRID_N,
  chunkSize: 160,
  spawn: {
    x: WESTGATE_SPAWN[0],
    y: +engine.groundHeightAt(WESTGATE_SPAWN[0], WESTGATE_SPAWN[1], 200).toFixed(2),
    z: WESTGATE_SPAWN[1],
    yawDeg: WESTGATE_SPAWN[2] ?? 0,
  },
  fightPit: {
    x: FIGHT_PIT_CENTER.x,
    y: +engine.groundHeightAt(FIGHT_PIT_CENTER.x, FIGHT_PIT_CENTER.z, 200).toFixed(2),
    z: FIGHT_PIT_CENTER.z,
  },
  teleports: teleportsOut,
  weapons: weaponsOut,
  roads: roadsOut,
  chunks: chunksOut,
  props: propsOut,
};

fs.writeFileSync(path.join(outDir, "westgate_world.json"), JSON.stringify(manifest));
const totalBoxes = chunksOut.reduce((acc, c) => acc + c.boxes.length, 0);
console.log(
  `Exported Westgate Bay native world -> ${outDir}: ${GRID_N}x${GRID_N} heightfield, ${chunksOut.length} chunks (${totalBoxes} buildings), ${roadsOut.length} roads, ${propsOut.length} props.`,
);
