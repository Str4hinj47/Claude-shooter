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

const { setNativeGlbExportHook } = await import("../src/game/city/PropModels.ts");
const { setNativeGrammarExportHook } = await import("../src/game/city/FacadeGrammar.ts");
const { setNativeKitExportHook } = await import("../src/game/city/CityBuildingKit.ts");

const glbMarkers = [];
const grammarMarkers = [];
const kitMarkers = [];

setNativeGlbExportHook((parent, filename, x, y, z, opts) => {
  const fullPath = path.resolve("public/models", filename);
  if (!fs.existsSync(fullPath)) return;
  const marker = new THREE.Group();
  marker.position.set(x, y, z);
  marker.rotation.y = opts.yaw ?? 0;
  marker.userData.nativeGlb = {
    file: filename,
    axis: opts.axis ?? "y",
    targetMeters: +(opts.targetMeters ?? 1).toFixed(3),
    fitFootprint: opts.fitFootprint
      ? [
          +opts.fitFootprint.maxW.toFixed(2),
          +opts.fitFootprint.maxD.toFixed(2),
          +opts.fitFootprint.maxH.toFixed(2),
        ]
      : null,
    baseY: +(opts.baseY ?? 0).toFixed(3),
    yawOffset: +(opts.yawOffset ?? 0).toFixed(4),
  };
  parent.add(marker);
  glbMarkers.push(marker);
  opts.onAttached?.(marker);
});

setNativeGrammarExportHook((parent, opts) => {
  const marker = new THREE.Group();
  marker.position.set(opts.x, opts.yBase, opts.z);
  marker.rotation.y = opts.yaw ?? 0;
  marker.userData.nativeGrammar = {
    w: +opts.w.toFixed(2),
    h: +opts.h.toFixed(2),
    d: +opts.d.toFixed(2),
    style: opts.style,
    kind: opts.kindOverride ?? "",
    storefront: opts.storefront === undefined ? -1 : opts.storefront ? 1 : 0,
    rhythm: opts.rhythmOverride ?? "",
    skipGround: opts.skipGroundFloor ? 1 : 0,
    roofCap: opts.addRoofCap === false ? 0 : 1,
    maxFloors: opts.maxFloors ?? 14,
    maxBays: opts.maxBays ?? 9,
    seed: opts.seed ?? Math.round(Math.abs(opts.x * 13 + opts.z * 7)),
  };
  parent.add(marker);
  grammarMarkers.push(marker);
});

setNativeKitExportHook((parent, rec) => {
  const marker = new THREE.Group();
  marker.position.set(rec.x, rec.y, rec.z);
  marker.rotation.y = rec.yaw ?? 0;
  marker.userData.nativeKit = rec;
  parent.add(marker);
  kitMarkers.push(marker);
});

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
const CHUNK_SIZE = 160;
const CHUNK_GRID = 15;

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
  h = Math.max(h, smoothIslandHeight(x, z, -965, 390, 128, 12.5));
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

// 2. Prewarm all 225 chunks synchronously & force both nearGroup + lodGroup visible so all 225 chunks export!
engine.chunks.prewarm(0, 0, 2200, false);
for (const c of engine.chunks.getChunks()) {
  c.nearGroup.visible = true;
  c.lodGroup.visible = true;
}
group.updateMatrixWorld(true);

function chunkIndexForXZ(x, z) {
  const cx = Math.max(0, Math.min(CHUNK_GRID - 1, Math.floor((x - WORLD_MIN) / CHUNK_SIZE)));
  const cz = Math.max(0, Math.min(CHUNK_GRID - 1, Math.floor((z - WORLD_MIN) / CHUNK_SIZE)));
  return cx * CHUNK_GRID + cz;
}

// Surface family IDs packed into PackedWorldVertex.nw & PackedArchBox.family:
// 0=generic, 1=asphalt, 2=concrete/sidewalk, 3=roadStripe, 4=stone/brick, 5=wood, 6=metal, 7=grass/foliage, 8=glass
function classifyMaterial(mat, contextTag = "") {
  const std = Array.isArray(mat) ? mat[0] : mat;
  let r = 0.72, g = 0.74, b = 0.76;
  if (std?.color) {
    // Convert linear Three.js Color back to sRGB bytes so native shader srgbToLinear matches 1:1
    const sr = Math.pow(Math.max(0, Math.min(1, std.color.r)), 1 / 2.2);
    const sg = Math.pow(Math.max(0, Math.min(1, std.color.g)), 1 / 2.2);
    const sb = Math.pow(Math.max(0, Math.min(1, std.color.b)), 1 / 2.2);
    r = sr; g = sg; b = sb;
  }
  const opacity = std?.transparent ? Math.max(0.15, Math.min(1.0, std.opacity ?? 1.0)) : 1.0;
  let rough = Math.max(0.05, Math.min(0.99, std?.roughness ?? 0.78));
  const metal = Math.max(0.0, Math.min(1.0, std?.metalness ?? 0.05));

  let emLum = 0.0;
  let nightGlow = false;
  if (std?.emissive) {
    const ei = std.emissiveIntensity ?? 1.0;
    const er = std.emissive.r * ei;
    const eg = std.emissive.g * ei;
    const eb = std.emissive.b * ei;
    emLum = Math.max(er, eg, eb);
    if (emLum > 0.04) {
      // Blend emissive hue into base color if base color is dark
      const erS = Math.pow(Math.min(1, std.emissive.r), 1 / 2.2);
      const egS = Math.pow(Math.min(1, std.emissive.g), 1 / 2.2);
      const ebS = Math.pow(Math.min(1, std.emissive.b), 1 / 2.2);
      const mixT = Math.min(0.85, emLum * 0.5);
      r = r * (1 - mixT) + erS * mixT;
      g = g * (1 - mixT) + egS * mixT;
      b = b * (1 - mixT) + ebS * mixT;
      nightGlow = emLum < 1.2;
    }
  }

  let family = 0;
  let extraFlags = 0;
  let liftMm = 0;
  const polyOff = Boolean(std?.polygonOffset);
  const polyFactor = polyOff ? (std?.polygonOffsetFactor ?? -1) : 0;
  if (contextTag === "road") {
    if (polyFactor <= -4 || (r > 0.80 && g > 0.62 && b < 0.35)) {
      family = 3; // crosswalk zebra bar / yellow stripe
      rough = 0.48;
      liftMm = 56;
    } else if (polyFactor <= -2) {
      // Junction / Roundabout asphalt hub (charcoal #25282e, sits above ribbons so lane lines stop cleanly at intersections)
      family = 1;
      r = 0.225; g = 0.238; b = 0.265;
      liftMm = 40;
    } else if (polyFactor <= -1 || (rough >= 0.92 && r > 0.90) || (r < 0.34 && g < 0.35 && b < 0.38)) {
      // Roadway ribbon asphalt (charcoal #22252b + flag bit 4 for shader lane markings; +25mm clears bridge deckMat cleanly)
      family = 1;
      if (r > 0.85) { r = 0.215; g = 0.228; b = 0.255; }
      extraFlags = 4;
      liftMm = 25;
    } else {
      // Sidewalks (map=makeSidewalkPaverTex + color=0xffffff), curbs, medians & bridge decks
      family = 2;
      if (r > 0.92 && g > 0.92 && b > 0.92) {
        r = 0.69; g = 0.68; b = 0.65;
      }
    }
  } else if (opacity < 0.92 || (rough < 0.16 && metal > 0.62 && b > r)) {
    family = 8; // glass
  } else if (metal > 0.45) {
    family = 6; // metal
  } else if (g > r * 1.18 && g > b * 1.18 && rough > 0.72) {
    family = 7; // grass / foliage
  } else if (r > b * 1.32 && rough > 0.55 && metal < 0.15) {
    family = r > g * 1.25 ? 4 : 5; // brick/terracotta vs wood
  } else if (rough > 0.78) {
    family = 2; // concrete / stone / plaster
  }

  return {
    r: Math.round(Math.max(0, Math.min(255, r * 255))),
    g: Math.round(Math.max(0, Math.min(255, g * 255))),
    b: Math.round(Math.max(0, Math.min(255, b * 255))),
    a: Math.round(Math.max(0, Math.min(255, opacity * 255))),
    rough: Math.round(Math.max(0, Math.min(255, rough * 255))),
    metal: Math.round(Math.max(0, Math.min(255, metal * 255))),
    emissive: Math.round(Math.max(0, Math.min(255, Math.min(4.0, emLum) * 63.75))),
    family,
    flags: (nightGlow ? 1 : 0) | (liftMm > 0 ? 2 : 0) | extraFlags,
    liftMeters: liftMm * 0.001,
  };
}

// Per-chunk geometry buckets
const chunkBuckets = Array.from({ length: CHUNK_GRID * CHUNK_GRID }, () => ({
  vertMap: new Map(),
  verts: [], // 28-byte Buffer slices or flat numbers
  indices: [],
  nearBoxes: [],
  lodBoxes: [],
  minY: 1e9,
  maxY: -1e9,
}));

function updateChunkY(ci, y0, y1) {
  const b = chunkBuckets[ci];
  if (y0 < b.minY) b.minY = y0;
  if (y1 > b.maxY) b.maxY = y1;
}

const tmpV = new THREE.Vector3();
const tmpN = new THREE.Vector3();
const tmpPos = new THREE.Vector3();
const tmpQuat = new THREE.Quaternion();
const tmpScale = new THREE.Vector3();
const normalMat = new THREE.Matrix3();

function isAncestorHidden(obj, stopAt) {
  let p = obj;
  while (p && p !== stopAt) {
    if (p.visible === false) return true;
    p = p.parent;
  }
  return false;
}

function addArchBox(list, ci, cx, cy, cz, hx, hy, hz, quat, matInfo) {
  if (hx < 0.005 || hy < 0.005 || hz < 0.005) return;
  const maxExt = Math.hypot(hx, hy, hz);
  updateChunkY(ci, cy - maxExt, cy + maxExt);
  list.push({
    cx, cy, cz, hx, hy, hz,
    qx: quat.x, qy: quat.y, qz: quat.z, qw: quat.w,
    ...matInfo,
  });
}

function addMeshTrianglesToChunks(mesh, contextTag = "", fixedChunkIdx = -1) {
  const geo = mesh.geometry;
  const posAttr = geo?.attributes?.position;
  if (!posAttr || posAttr.count < 3) return;
  const normAttr = geo.attributes.normal;
  const uvAttr = geo.attributes.uv;
  const idxAttr = geo.index;
  const matInfo = classifyMaterial(mesh.material, contextTag);
  const mw = mesh.matrixWorld;
  normalMat.getNormalMatrix(mw);

  // Lift road decals (stripes, crosswalks, junction hubs) so they layer cleanly without pipeline clones
  const decalLift = matInfo.liftMeters ?? 0.0;

  const triCount = idxAttr ? Math.floor(idxAttr.count / 3) : Math.floor(posAttr.count / 3);
  const vWorld = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  const nWorld = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  const uvs = [[0, 0], [0, 0], [0, 0]];

  for (let t = 0; t < triCount; t++) {
    const i0 = idxAttr ? idxAttr.getX(t * 3) : t * 3;
    const i1 = idxAttr ? idxAttr.getX(t * 3 + 1) : t * 3 + 1;
    const i2 = idxAttr ? idxAttr.getX(t * 3 + 2) : t * 3 + 2;
    const ids = [i0, i1, i2];

    for (let k = 0; k < 3; k++) {
      const vi = ids[k];
      vWorld[k].set(posAttr.getX(vi), posAttr.getY(vi), posAttr.getZ(vi)).applyMatrix4(mw);
      if (normAttr) {
        nWorld[k].set(normAttr.getX(vi), normAttr.getY(vi), normAttr.getZ(vi)).applyMatrix3(normalMat).normalize();
      } else {
        nWorld[k].set(0, 1, 0);
      }
      if (decalLift > 0) {
        vWorld[k].x += nWorld[k].x * decalLift;
        vWorld[k].y += nWorld[k].y * decalLift;
        vWorld[k].z += nWorld[k].z * decalLift;
      }
      if (uvAttr) {
        uvs[k][0] = uvAttr.getX(vi);
        uvs[k][1] = uvAttr.getY(vi);
      } else {
        uvs[k][0] = vWorld[k].x * 0.25;
        uvs[k][1] = vWorld[k].z * 0.25;
      }
    }

    // Fallback geometric face normal if missing/degenerate
    if (!normAttr) {
      tmpV.subVectors(vWorld[1], vWorld[0]);
      tmpN.subVectors(vWorld[2], vWorld[0]).cross(tmpV).normalize();
      // Wait: (v1 - v0) x (v2 - v0) for CCW
      const e1x = vWorld[1].x - vWorld[0].x, e1y = vWorld[1].y - vWorld[0].y, e1z = vWorld[1].z - vWorld[0].z;
      const e2x = vWorld[2].x - vWorld[0].x, e2y = vWorld[2].y - vWorld[0].y, e2z = vWorld[2].z - vWorld[0].z;
      let nx = e1y * e2z - e1z * e2y;
      let ny = e1z * e2x - e1x * e2z;
      let nz = e1x * e2y - e1y * e2x;
      const nl = Math.hypot(nx, ny, nz) || 1;
      nx /= nl; ny /= nl; nz /= nl;
      for (let k = 0; k < 3; k++) nWorld[k].set(nx, ny, nz);
    }

    const cx = (vWorld[0].x + vWorld[1].x + vWorld[2].x) / 3;
    const cz = (vWorld[0].z + vWorld[1].z + vWorld[2].z) / 3;
    const ci = fixedChunkIdx >= 0 ? fixedChunkIdx : chunkIndexForXZ(cx, cz);
    const bucket = chunkBuckets[ci];

    // Wrap metric UVs per-triangle (not per-vertex!) into [-64..+64] so triangles crossing a 32-unit boundary never seam
    const baseU = Math.trunc(uvs[0][0] / 32) * 32;
    const baseV = Math.trunc(uvs[0][1] / 32) * 32;

    const outTri = [0, 0, 0];
    for (let k = 0; k < 3; k++) {
      const p = vWorld[k];
      const n = nWorld[k];
      updateChunkY(ci, p.y, p.y);
      const qx = Math.round(p.x * 200);
      const qy = Math.round(p.y * 200);
      const qz = Math.round(p.z * 200);
      const qnx = Math.max(-127, Math.min(127, Math.round(n.x * 127)));
      const qny = Math.max(-127, Math.min(127, Math.round(n.y * 127)));
      const qnz = Math.max(-127, Math.min(127, Math.round(n.z * 127)));
      const wu = uvs[k][0] - baseU;
      const wv = uvs[k][1] - baseV;
      const qu = Math.max(-32767, Math.min(32767, Math.round(wu * 256)));
      const qv = Math.max(-32767, Math.min(32767, Math.round(wv * 256)));
      const key = `${qx},${qy},${qz},${qnx},${qny},${qnz},${qu},${qv},${matInfo.r},${matInfo.g},${matInfo.b},${matInfo.family},${matInfo.emissive},${matInfo.flags}`;
      let vIdx = bucket.vertMap.get(key);
      if (vIdx === undefined) {
        vIdx = bucket.verts.length;
        bucket.vertMap.set(key, vIdx);
        bucket.verts.push({
          px: p.x, py: p.y, pz: p.z,
          nx: qnx, ny: qny, nz: qnz, nw: matInfo.family,
          u: qu, v: qv,
          r: matInfo.r, g: matInfo.g, b: matInfo.b, a: matInfo.a,
          rough: matInfo.rough, metal: matInfo.metal, emissive: matInfo.emissive, flags: matInfo.flags,
        });
      }
      outTri[k] = vIdx;
    }
    if (outTri[0] !== outTri[1] && outTri[1] !== outTri[2] && outTri[0] !== outTri[2]) {
      bucket.indices.push(outTri[0], outTri[1], outTri[2]);
    }
  }
}

const extraCompoundProps = [];

function extractVisualSubtree(root, contextTag = "", fixedChunkIdx = -1, intoLod = false) {
  root.traverse((o) => {
    if (!o.isMesh || o.isInstancedMesh || !o.geometry) return;
    if (isAncestorHidden(o, root.parent)) return;
    const std = Array.isArray(o.material) ? o.material[0] : o.material;
    if (std && std.visible === false) return;
    if (std?.transparent && (std.opacity ?? 1) < 0.45) return; // skip translucent spotlight cones & mission beacon beams

    const gType = o.geometry.type;
    const params = o.geometry.parameters;
    o.matrixWorld.decompose(tmpPos, tmpQuat, tmpScale);

    // Emit BoxGeometry, RoundedBoxGeometry & bevelledBox as fast GPU-instanced ArchBoxes!
    const boxDims = o.geometry.userData?.boxDims;
    const isBoxGeo =
      Array.isArray(boxDims) ||
      ((gType === "BoxGeometry" || gType === "RoundedBoxGeometry" || o.geometry.constructor?.name === "RoundedBoxGeometry") &&
        params &&
        typeof params.width === "number");
    if (isBoxGeo) {
      const bw = Array.isArray(boxDims) ? boxDims[0] : params.width;
      const bh = Array.isArray(boxDims) ? boxDims[1] : params.height;
      const bd = Array.isArray(boxDims) ? boxDims[2] : params.depth;
      const hx = Math.abs(bw * tmpScale.x) * 0.5;
      const hy = Math.abs(bh * tmpScale.y) * 0.5;
      const hz = Math.abs(bd * tmpScale.z) * 0.5;
      const ci = fixedChunkIdx >= 0 ? fixedChunkIdx : chunkIndexForXZ(tmpPos.x, tmpPos.z);
      const matInfo = classifyMaterial(o.material, contextTag);
      addArchBox(intoLod ? chunkBuckets[ci].lodBoxes : chunkBuckets[ci].nearBoxes, ci, tmpPos.x, tmpPos.y, tmpPos.z, hx, hy, hz, tmpQuat, matInfo);
      return;
    }
    if (contextTag === "compound") {
      // Upgrade procedural compound foliage blobs to real GLB bushes/oaks & cylinders to compact ArchBoxes
      const matInfo = classifyMaterial(o.material, contextTag);
      if (gType === "SphereGeometry" || gType === "IcosahedronGeometry" || gType === "DodecahedronGeometry") {
        const rad = (params?.radius ?? 0.5) * Math.max(Math.abs(tmpScale.x), Math.abs(tmpScale.y), Math.abs(tmpScale.z));
        if (matInfo.family === 7 && rad > 0.45) {
          if (rad > 1.35) {
            extraCompoundProps.push({ proto: "bush", x: +tmpPos.x.toFixed(2), y: +(tmpPos.y - rad * 0.75).toFixed(2), z: +tmpPos.z.toFixed(2), ry: 0, s: +(rad * 0.85).toFixed(2) });
          }
          return;
        }
        const ci = fixedChunkIdx >= 0 ? fixedChunkIdx : chunkIndexForXZ(tmpPos.x, tmpPos.z);
        addArchBox(chunkBuckets[ci].nearBoxes, ci, tmpPos.x, tmpPos.y, tmpPos.z, rad * 0.82, rad * 0.82, rad * 0.82, tmpQuat, matInfo);
        return;
      }
      if (gType === "CylinderGeometry" && params && typeof params.radiusTop === "number") {
        const rad = Math.max(params.radiusTop, params.radiusBottom);
        const hx = Math.max(0.015, Math.abs(rad * tmpScale.x));
        const hy = Math.max(0.015, Math.abs((params.height ?? 1) * tmpScale.y) * 0.5);
        const hz = Math.max(0.015, Math.abs(rad * tmpScale.z));
        if (Math.max(hx, hz) < 0.65) {
          const ci = fixedChunkIdx >= 0 ? fixedChunkIdx : chunkIndexForXZ(tmpPos.x, tmpPos.z);
          addArchBox(chunkBuckets[ci].nearBoxes, ci, tmpPos.x, tmpPos.y, tmpPos.z, hx, hy, hz, tmpQuat, matInfo);
          return;
        }
      }
    }
    if (
      gType === "CylinderGeometry" &&
      params &&
      typeof params.radiusTop === "number" &&
      Math.max(params.radiusTop, params.radiusBottom) * Math.max(Math.abs(tmpScale.x), Math.abs(tmpScale.z)) < 0.095
    ) {
      const rad = Math.max(params.radiusTop, params.radiusBottom);
      const hx = Math.max(0.015, Math.abs(rad * tmpScale.x));
      const hy = Math.max(0.015, Math.abs((params.height ?? 1) * tmpScale.y) * 0.5);
      const hz = Math.max(0.015, Math.abs(rad * tmpScale.z));
      const ci = fixedChunkIdx >= 0 ? fixedChunkIdx : chunkIndexForXZ(tmpPos.x, tmpPos.z);
      const matInfo = classifyMaterial(o.material, contextTag);
      addArchBox(intoLod ? chunkBuckets[ci].lodBoxes : chunkBuckets[ci].nearBoxes, ci, tmpPos.x, tmpPos.y, tmpPos.z, hx, hy, hz, tmpQuat, matInfo);
      return;
    }

    if (!intoLod) {
      addMeshTrianglesToChunks(o, contextTag, fixedChunkIdx);
    }
  });
}

// 2a. Extract all 225 CityChunks (nearGroup + lodGroup + Jolt collision boxes)
const chunksOut = [];
for (const c of engine.chunks.getChunks()) {
  const ci = c.cx * CHUNK_GRID + c.cz;
  extractVisualSubtree(c.nearGroup, "chunk", ci, false);
  extractVisualSubtree(c.lodGroup, "lod", ci, true);

  const boxes = [];
  for (const b of c.aabbs) {
    const w = +(b.max.x - b.min.x).toFixed(2);
    const h = +(b.max.y - b.min.y).toFixed(2);
    const d = +(b.max.z - b.min.z).toFixed(2);
    if (w < 0.18 || h < 0.18 || d < 0.18) continue;
    const cx = +((b.min.x + b.max.x) * 0.5).toFixed(2);
    const cy = +((b.min.y + b.max.y) * 0.5).toFixed(2);
    const cz = +((b.min.z + b.max.z) * 0.5).toFixed(2);
    boxes.push({ cx, cy, cz, w, h, d, color: [0.58, 0.62, 0.68] });
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

// 2b. Extract RoadNetwork curved asphalt, intersections, roundabouts, curbs, sidewalks & lane markings
extractVisualSubtree(engine.staticRoadRoot, "road", -1, false);

// 2c. Extract 5 Architectural Bridges + Roundabouts + Apartments + Mission Compounds + Fight Pit + Shops + Signals + Activities
const skipTopGroups = new Set([
  "WestgateTerrain",
  "WestgateGrass",
  "WestgateWater",
  "WestgateVehicles",
  "westgate-air-vehicles",
  "westgate-boats",
  "westgate-collectibles",
  "WestgateLivingWorld",
  "westgate-wildlife",
  "WestgatePedestrians",
  "WestgateWantedUnits",
  "westgate-random-events",
  "WestgateDeadBodies",
  "WestgateSurveillanceContracts",
]);
for (let i = 0; i < group.children.length; i++) {
  const ch = group.children[i];
  if (i === 0) continue; // Sky dome
  if (ch === engine.root || ch.isLight || skipTopGroups.has(ch.name)) continue;
  const tag = ch.name === "WestgateRoadLandmarks"
    ? "bridge"
    : ch.name?.startsWith("MissionCompound_")
      ? "compound"
      : "landmark";
  extractVisualSubtree(ch, tag, -1, false);
}

// 2d. Add offshore Pelican Key Lighthouse on the southwest island (-965, 415)
{
  const crimson = { r: 199, g: 56, b: 46, a: 255, rough: 110, metal: 165, emissive: 0, family: 6, flags: 0 };
  const lx = -965, lz = 415;
  const ly = nativeTerrainHeightAt(lx, lz);
  const ci = chunkIndexForXZ(lx, lz);
  const idQ = new THREE.Quaternion();
  addArchBox(chunkBuckets[ci].nearBoxes, ci, lx, ly + 8.0, lz, 2.1, 8.0, 2.1, idQ, {
    r: 238, g: 234, b: 224, a: 255, rough: 195, metal: 10, emissive: 0, family: 4, flags: 0,
  });
  addArchBox(chunkBuckets[ci].nearBoxes, ci, lx, ly + 17.2, lz, 1.5, 1.3, 1.5, idQ, {
    r: 255, g: 224, b: 118, a: 255, rough: 45, metal: 20, emissive: 190, family: 8, flags: 1,
  });
  addArchBox(chunkBuckets[ci].nearBoxes, ci, lx, ly + 19.2, lz, 1.9, 0.7, 1.9, idQ, crimson);
  addArchBox(chunkBuckets[ci].lodBoxes, ci, lx, ly + 9.5, lz, 2.1, 9.5, 2.1, idQ, {
    r: 238, g: 234, b: 224, a: 255, rough: 195, metal: 10, emissive: 0, family: 4, flags: 0,
  });
}

// 2e. Extract Procedural Prop Prototypes (streetlight, traffic_light, hydrant)
const protoIds = ["streetlight", "traffic_light", "hydrant"];
const exportedProtos = [];
for (const pid of protoIds) {
  const proto = engine.props.getPrototype(pid);
  if (!proto) continue;
  const pVerts = [];
  const pIndices = [];
  const pMap = new Map();
  for (const part of proto.parts) {
    const geo = part.geometry;
    const posAttr = geo?.attributes?.position;
    if (!posAttr) continue;
    const normAttr = geo.attributes.normal;
    const uvAttr = geo.attributes.uv;
    const idxAttr = geo.index;
    const matInfo = classifyMaterial(part.material, "prop");
    const lMat = new THREE.Matrix4();
    const lPos = new THREE.Vector3(...(part.localOffset ?? [0, 0, 0]));
    const lEuler = new THREE.Euler(...(part.localRotation ?? [0, 0, 0]));
    const lQuat = new THREE.Quaternion().setFromEuler(lEuler);
    const lScale = new THREE.Vector3(...(part.localScale ?? [1, 1, 1]));
    lMat.compose(lPos, lQuat, lScale);
    const nMat = new THREE.Matrix3().getNormalMatrix(lMat);

    const triCount = idxAttr ? Math.floor(idxAttr.count / 3) : Math.floor(posAttr.count / 3);
    for (let t = 0; t < triCount; t++) {
      const ids = [
        idxAttr ? idxAttr.getX(t * 3) : t * 3,
        idxAttr ? idxAttr.getX(t * 3 + 1) : t * 3 + 1,
        idxAttr ? idxAttr.getX(t * 3 + 2) : t * 3 + 2,
      ];
      for (let k = 0; k < 3; k++) {
        const vi = ids[k];
        tmpV.set(posAttr.getX(vi), posAttr.getY(vi), posAttr.getZ(vi)).applyMatrix4(lMat);
        if (normAttr) tmpN.set(normAttr.getX(vi), normAttr.getY(vi), normAttr.getZ(vi)).applyMatrix3(nMat).normalize();
        else tmpN.set(0, 1, 0);
        const u = uvAttr ? uvAttr.getX(vi) : 0;
        const v = uvAttr ? uvAttr.getY(vi) : 0;
        const qu = Math.max(-32767, Math.min(32767, Math.round(u * 256)));
        const qv = Math.max(-32767, Math.min(32767, Math.round(v * 256)));
        const qnx = Math.max(-127, Math.min(127, Math.round(tmpN.x * 127)));
        const qny = Math.max(-127, Math.min(127, Math.round(tmpN.y * 127)));
        const qnz = Math.max(-127, Math.min(127, Math.round(tmpN.z * 127)));
        const key = `${tmpV.x.toFixed(3)},${tmpV.y.toFixed(3)},${tmpV.z.toFixed(3)},${qnx},${qny},${qnz},${matInfo.r},${matInfo.g},${matInfo.b},${matInfo.emissive}`;
        let outI = pMap.get(key);
        if (outI === undefined) {
          outI = pVerts.length;
          pMap.set(key, outI);
          pVerts.push({
            px: tmpV.x, py: tmpV.y, pz: tmpV.z,
            nx: qnx, ny: qny, nz: qnz, nw: matInfo.family,
            u: qu, v: qv,
            r: matInfo.r, g: matInfo.g, b: matInfo.b, a: matInfo.a,
            rough: matInfo.rough, metal: matInfo.metal, emissive: matInfo.emissive, flags: matInfo.flags,
          });
        }
        pIndices.push(outI);
      }
    }
  }
  exportedProtos.push({ id: pid, verts: pVerts, indices: pIndices });
}

// 3. Serialize binary `westgate_meshes.bin` ("WGMB" v1)
let totalVerts = 0;
let totalIndices = 0;
let totalNearBoxes = 0;
let totalLodBoxes = 0;
for (const b of chunkBuckets) {
  totalVerts += b.verts.length;
  totalIndices += b.indices.length;
  totalNearBoxes += b.nearBoxes.length;
  totalLodBoxes += b.lodBoxes.length;
}
const totalArchBoxes = totalNearBoxes + totalLodBoxes;

let protoBytes = 0;
for (const ep of exportedProtos) {
  protoBytes += 40 + ep.verts.length * 28 + ep.indices.length * 4;
}

const headerBytes = 32;
const dirBytes = chunkBuckets.length * 32;
const vertBytes = totalVerts * 28;
const idxBytes = totalIndices * 4;
const boxBytes = totalArchBoxes * 40;
const totalBytes = headerBytes + dirBytes + vertBytes + idxBytes + boxBytes + protoBytes;

const binBuf = Buffer.alloc(totalBytes);
let off = 0;
binBuf.writeUInt32LE(0x424d4757, off); off += 4; // "WGMB"
binBuf.writeUInt32LE(1, off); off += 4;          // version 1
binBuf.writeUInt32LE(chunkBuckets.length, off); off += 4;
binBuf.writeUInt32LE(totalVerts, off); off += 4;
binBuf.writeUInt32LE(totalIndices, off); off += 4;
binBuf.writeUInt32LE(totalArchBoxes, off); off += 4;
binBuf.writeUInt32LE(exportedProtos.length, off); off += 4;
binBuf.writeUInt32LE(0, off); off += 4;

// Write chunk directory (firstIndex, indexCount, firstNearBox, nearBoxCount, firstLodBox, lodBoxCount, minY, maxY)
let curVertBase = 0;
let curIdxBase = 0;
let curBoxBase = 0;
const chunkVertBases = [];
for (let ci = 0; ci < chunkBuckets.length; ci++) {
  const b = chunkBuckets[ci];
  chunkVertBases.push(curVertBase);
  const firstIdx = curIdxBase;
  const idxCnt = b.indices.length;
  const firstNear = curBoxBase;
  const nearCnt = b.nearBoxes.length;
  const firstLod = curBoxBase + nearCnt;
  const lodCnt = b.lodBoxes.length;
  const minY = b.minY <= b.maxY ? b.minY : 0.0;
  const maxY = b.minY <= b.maxY ? b.maxY : 12.0;

  binBuf.writeUInt32LE(firstIdx, off); off += 4;
  binBuf.writeUInt32LE(idxCnt, off); off += 4;
  binBuf.writeUInt32LE(firstNear, off); off += 4;
  binBuf.writeUInt32LE(nearCnt, off); off += 4;
  binBuf.writeUInt32LE(firstLod, off); off += 4;
  binBuf.writeUInt32LE(lodCnt, off); off += 4;
  binBuf.writeFloatLE(minY, off); off += 4;
  binBuf.writeFloatLE(maxY, off); off += 4;

  curVertBase += b.verts.length;
  curIdxBase += idxCnt;
  curBoxBase += nearCnt + lodCnt;
}

function writePackedVertex(buf, o, v) {
  buf.writeFloatLE(v.px, o);
  buf.writeFloatLE(v.py, o + 4);
  buf.writeFloatLE(v.pz, o + 8);
  buf.writeInt8(v.nx, o + 12);
  buf.writeInt8(v.ny, o + 13);
  buf.writeInt8(v.nz, o + 14);
  buf.writeInt8(v.nw, o + 15);
  buf.writeInt16LE(v.u, o + 16);
  buf.writeInt16LE(v.v, o + 18);
  buf.writeUInt8(v.r, o + 20);
  buf.writeUInt8(v.g, o + 21);
  buf.writeUInt8(v.b, o + 22);
  buf.writeUInt8(v.a, o + 23);
  buf.writeUInt8(v.rough, o + 24);
  buf.writeUInt8(v.metal, o + 25);
  buf.writeUInt8(v.emissive, o + 26);
  buf.writeUInt8(v.flags, o + 27);
}

for (const b of chunkBuckets) {
  for (const v of b.verts) {
    writePackedVertex(binBuf, off, v);
    off += 28;
  }
}

for (let ci = 0; ci < chunkBuckets.length; ci++) {
  const b = chunkBuckets[ci];
  const vBase = chunkVertBases[ci];
  for (let i = 0; i < b.indices.length; i++) {
    binBuf.writeUInt32LE(vBase + b.indices[i], off);
    off += 4;
  }
}

function writePackedBox(buf, o, bx) {
  buf.writeFloatLE(bx.cx, o);
  buf.writeFloatLE(bx.cy, o + 4);
  buf.writeFloatLE(bx.cz, o + 8);
  buf.writeFloatLE(bx.hx, o + 12);
  buf.writeFloatLE(bx.hy, o + 16);
  buf.writeFloatLE(bx.hz, o + 20);
  const qLen = Math.hypot(bx.qx, bx.qy, bx.qz, bx.qw) || 1;
  const toS16 = (val) => Math.max(-32767, Math.min(32767, Math.round((val / qLen) * 32767)));
  buf.writeInt16LE(toS16(bx.qx), o + 24);
  buf.writeInt16LE(toS16(bx.qy), o + 26);
  buf.writeInt16LE(toS16(bx.qz), o + 28);
  buf.writeInt16LE(toS16(bx.qw), o + 30);
  buf.writeUInt8(bx.r, o + 32);
  buf.writeUInt8(bx.g, o + 33);
  buf.writeUInt8(bx.b, o + 34);
  buf.writeUInt8(bx.a, o + 35);
  buf.writeUInt8(bx.rough, o + 36);
  buf.writeUInt8(bx.metal, o + 37);
  buf.writeUInt8(bx.emissive, o + 38);
  buf.writeUInt8(bx.family, o + 39);
}

for (const b of chunkBuckets) {
  for (const bx of b.nearBoxes) {
    writePackedBox(binBuf, off, bx);
    off += 40;
  }
  for (const bx of b.lodBoxes) {
    writePackedBox(binBuf, off, bx);
    off += 40;
  }
}

for (const ep of exportedProtos) {
  const nameBuf = Buffer.alloc(32, 0);
  nameBuf.write(ep.id, 0, Math.min(31, ep.id.length), "utf8");
  nameBuf.copy(binBuf, off); off += 32;
  binBuf.writeUInt32LE(ep.verts.length, off); off += 4;
  binBuf.writeUInt32LE(ep.indices.length, off); off += 4;
  for (const v of ep.verts) {
    writePackedVertex(binBuf, off, v);
    off += 28;
  }
  for (const idx of ep.indices) {
    binBuf.writeUInt32LE(idx, off);
    off += 4;
  }
}

fs.writeFileSync(path.join(outDir, "westgate_meshes.bin"), binBuf);

// 4. Extract world-space GLB placements, Grammar building shells & Kit architectural details
const tmpEuler = new THREE.Euler();
function worldPoseOf(marker) {
  marker.updateWorldMatrix(true, false);
  marker.matrixWorld.decompose(tmpPos, tmpQuat, tmpScale);
  tmpEuler.setFromQuaternion(tmpQuat, "YXZ");
  return {
    x: +tmpPos.x.toFixed(2),
    y: +tmpPos.y.toFixed(2),
    z: +tmpPos.z.toFixed(2),
    yaw: +tmpEuler.y.toFixed(4),
  };
}

const glbPlacementsOut = [];
for (const m of glbMarkers) {
  if (isAncestorHidden(m, null)) continue;
  const pose = worldPoseOf(m);
  const g = m.userData.nativeGlb;
  glbPlacementsOut.push({
    file: g.file,
    x: pose.x,
    y: pose.y,
    z: pose.z,
    yaw: pose.yaw,
    yawOffset: g.yawOffset,
    axis: g.axis,
    targetMeters: g.targetMeters,
    fit: g.fitFootprint,
    baseY: g.baseY,
  });
}

const grammarBuildingsOut = [];
for (const m of grammarMarkers) {
  if (isAncestorHidden(m, null)) continue;
  const pose = worldPoseOf(m);
  grammarBuildingsOut.push({
    ...pose,
    ...m.userData.nativeGrammar,
  });
}

const kitDetailsOut = [];
for (const m of kitMarkers) {
  if (isAncestorHidden(m, null)) continue;
  const pose = worldPoseOf(m);
  const k = m.userData.nativeKit;
  kitDetailsOut.push({
    kind: k.kind,
    x: pose.x,
    y: pose.y,
    z: pose.z,
    yaw: pose.yaw,
    w: +k.w.toFixed(2),
    h: +k.h.toFixed(2),
    d: +k.d.toFixed(2),
    balconies: k.balconies ? 1 : 0,
    tall: k.tall ? 1 : 0,
    waterTower: k.waterTower ? 1 : 0,
    billboard: k.billboard ? 1 : 0,
    awningColor: k.awningColor ?? 0,
  });
}

// 5. Roads (preserving true sp.y bridge deck elevations!)
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
      +(typeof sp.y === "number" ? sp.y : nativeTerrainHeightAt(sp.x, sp.z) + 0.08).toFixed(2),
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

{
  const pts = [];
  const N = 24;
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

{
  const canyonPts = [
    [-210, -780], [-140, -830], [-65, -860], [15, -835], [90, -885],
    [165, -935], [250, -900], [335, -850], [415, -880], [490, -820],
  ];
  buildSplineRoad("canyon_switchback", "North Ridge Canyon Drive", "secondary", 9.0, false, canyonPts);
}

// 6. Props (+ Pelican Key & Smuggler's Atoll island palms & rocks)
const propsOut = engine.props.getPlacements().map((p) => ({
  proto: p.protoId,
  x: +p.x.toFixed(2),
  y: +p.y.toFixed(2),
  z: +p.z.toFixed(2),
  ry: +p.ry.toFixed(3),
  s: +p.sy.toFixed(2),
}));
for (const ep of extraCompoundProps) propsOut.push(ep);

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

// 7. Teleports & Weapons
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
  version: 2,
  worldMin: WORLD_MIN,
  worldMax: WORLD_MAX,
  heightfieldGrid: GRID_N,
  chunkSize: CHUNK_SIZE,
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
  glbPlacements: glbPlacementsOut,
  grammarBuildings: grammarBuildingsOut,
  kitDetails: kitDetailsOut,
};

fs.writeFileSync(path.join(outDir, "westgate_world.json"), JSON.stringify(manifest));
const totalColliderBoxes = chunksOut.reduce((acc, c) => acc + c.boxes.length, 0);
console.log(
  `Exported Westgate Bay v2 -> ${outDir}:\n` +
    `  heightfield: ${GRID_N}x${GRID_N}\n` +
    `  westgate_meshes.bin: ${(totalBytes / (1024 * 1024)).toFixed(2)} MB (${totalVerts} verts, ${totalIndices / 3} tris, ${totalNearBoxes} nearBoxes, ${totalLodBoxes} lodBoxes, ${exportedProtos.length} propProtos)\n` +
    `  westgate_world.json: ${totalColliderBoxes} Jolt colliders, ${glbPlacementsOut.length} GLBs, ${grammarBuildingsOut.length} grammar buildings, ${kitDetailsOut.length} kit details, ${roadsOut.length} roads, ${propsOut.length} props.`,
);
