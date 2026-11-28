import * as THREE from "three";
import type { TerrainHeightFn } from "./HeightSystem";
import type { RoadNetwork } from "./RoadNetwork";
import { OPEN_WORLD_MISSION_SITES } from "./OpenWorldMissions";

export interface DistrictInfo {
  id:
    | "downtown"
    | "midtown"
    | "old_quarter"
    | "foothills"
    | "west_coast"
    | "east_port"
    | "south_airport"
    | "ocean";
  name: string;
  subtitle: string;
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function hash2(ix: number, iz: number): number {
  const n = Math.sin(ix * 127.1 + iz * 311.7) * 43758.5453123;
  return n - Math.floor(n);
}

function valueNoise(x: number, z: number): number {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const fx = x - ix;
  const fz = z - iz;
  const ux = fx * fx * (3 - 2 * fx);
  const uz = fz * fz * (3 - 2 * fz);
  const a = hash2(ix, iz);
  const b = hash2(ix + 1, iz);
  const c = hash2(ix, iz + 1);
  const d = hash2(ix + 1, iz + 1);
  return lerp(lerp(a, b, ux), lerp(c, d, ux), uz);
}

function fbm(x: number, z: number, octaves = 4): number {
  let sum = 0;
  let amp = 0.5;
  let freq = 1;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += amp * valueNoise(x * freq, z * freq);
    norm += amp;
    amp *= 0.5;
    freq *= 2.03;
  }
  return sum / norm;
}

/** Organic North-South Pacific shoreline X coordinate at a given Z. */
export function coastLineX(z: number): number {
  return -760 + z * 0.06 + Math.sin(z * 0.0042) * 34 + Math.cos(z * 0.0095) * 14;
}

/** Sinuous Westgate River centerline X coordinate at a given Z (north of harbor). */
export function riverCenterX(z: number): number {
  return 490 + Math.sin(z * 0.0032 + 0.4) * 52 + Math.cos(z * 0.0072) * 18;
}

/** Classifies which of the 8 Westgate Bay districts owns (x, z). */
export function getDistrictAt(x: number, z: number): DistrictInfo {
  if (x < coastLineX(z) - 18) {
    return { id: "ocean", name: "Pacific Coastline", subtitle: "Westgate Bay Waters" };
  }
  if (z < -470) {
    return { id: "foothills", name: "Northern Foothills", subtitle: "Canyon Estates & Observatory" };
  }
  if (z > 670) {
    return { id: "south_airport", name: "South Airport & Arena", subtitle: "Westgate Int'l & Stadium" };
  }
  if (x < -465) {
    return { id: "west_coast", name: "West Coast & Canals", subtitle: "Del Sol Pier & Canals" };
  }
  if (x > 380) {
    return { id: "east_port", name: "East Industrial & Port", subtitle: "River Channel & Container Docks" };
  }
  if (x < -60 && z < 110) {
    return { id: "midtown", name: "Midtown Commerce", subtitle: "Grand Mall, Medical & Campus" };
  }
  if (x >= -60 && z < 180) {
    return { id: "downtown", name: "Downtown Financial Core", subtitle: "Civic Plaza & Skyscraper Row" };
  }
  return { id: "old_quarter", name: "Old Quarter & Suburbs", subtitle: "Crescents, Schools & Central Park" };
}

/**
 * Raw procedural terrain heightfield before road corridor grading.
 * City land sits at y >= 2.2m; water level is uniformly y = 0.0m.
 */
export function rawWestgateTerrainHeight(x: number, z: number): number {
  // 1. Base urban elevation & gentle suburban rolling hills
  let h = 4.4;
  const subHill = (fbm(x * 0.0028 + 3.1, z * 0.0028 - 1.7, 3) - 0.5) * 6.0;

  // Grade Old Quarter with soft neighborhood undulations
  const oldQMask = smoothstep(-480, -340, x) * (1 - smoothstep(260, 380, x)) * smoothstep(60, 200, z) * (1 - smoothstep(520, 660, z));
  h += subHill * oldQMask;

  // Flatten Downtown + Midtown plateau cleanly around y = 4.5m
  const coreMask = smoothstep(-450, -280, x) * (1 - smoothstep(240, 360, x)) * smoothstep(-470, -350, z) * (1 - smoothstep(140, 260, z));
  h = lerp(h, 4.5, coreMask * 0.9);

  // Flatten South Airport & Stadium apron at y = 2.6m
  const airportMask = smoothstep(560, 680, z);
  h = lerp(h, 2.6, airportMask);

  // Flatten East Industrial & Seaport flats at y = 2.8m
  const eastFlatMask = smoothstep(580, 700, x) * smoothstep(-450, -320, z) * (1 - smoothstep(880, 1020, z));
  h = lerp(h, 2.8, eastFlatMask);

  // 2. Northern Foothills & Observatory Mesa (z < -480)
  if (z < -460) {
    const northT = smoothstep(-460, -1120, z);
    const ridge = fbm(x * 0.0024 + 11.2, z * 0.0024 + 5.4, 4);
    const foothillGain = northT * (14 + ridge * 68);
    // Boost dramatic Observatory hill around (-120, -980)
    const obsDist = Math.hypot(x + 120, z + 980);
    const obsMesa = Math.max(0, 1 - smoothstep(45, 220, obsDist)) * 34;
    // Keep foothills gently depressed right near the western beach & eastern river gorge
    const coastTaper = smoothstep(-820, -560, x);
    h += (foothillGain + obsMesa) * coastTaper;
  }

  // 3. West Coast Beach Slope & Pacific Ocean Seabed (x < coastLineX(z))
  const cx = coastLineX(z);
  const inlandDist = x - cx;
  if (inlandDist < 120) {
    const coastalHeight = lerp(-8.5, 2.8, smoothstep(-140, 65, inlandDist));
    const blend = 1 - smoothstep(55, 120, inlandDist);
    h = lerp(h, coastalHeight, blend);
  }

  // 4. South Open Bay beyond z > 1060
  if (z > 980) {
    const southCoast = smoothstep(980, 1140, z);
    h = lerp(h, -7.5, southCoast);
  }

  // 5. Westgate Canals (Venice-style carved waterways at y = -2.1m)
  if (x > -715 && x < -505 && z > 105 && z < 385) {
    const canalA = Math.abs(z - 185) < 13 && x > -680 && x < -530;
    const canalB = Math.abs(z - 305) < 13 && x > -680 && x < -530;
    const crossCanal = Math.abs(x + 605) < 12 && z > 155 && z < 335;
    if (canalA || canalB || crossCanal) {
      h = -2.1;
    } else {
      h = Math.min(h, 2.9);
    }
  }

  // 6. Westgate River Channel (North->South along East side) -> East Seaport Harbor Basin
  if (z < 482) {
    const rx = riverCenterX(z);
    const rDist = Math.abs(x - rx);
    // Wider gorge in foothills, crisp urban river channel mid-city
    const halfChan = z < -480 ? 34 : 26;
    if (rDist < halfChan + 28) {
      const t = 1 - smoothstep(halfChan - 6, halfChan + 26, rDist);
      h = lerp(h, -2.4, t);
    }
  } else {
    // East Seaport Harbor shipping basin (x in [455, 865], z in [482, 960])
    const inHarborX = smoothstep(430, 475, x) * (1 - smoothstep(845, 895, x));
    const inHarborZ = smoothstep(480, 502, z) * (1 - smoothstep(940, 1020, z));
    const harborMask = inHarborX * inHarborZ;
    if (harborMask > 0.001) {
      h = lerp(h, -4.6, harborMask);
    }
  }

  return h;
}

/**
 * Wraps rawWestgateTerrainHeight with smooth roadbed grading along all non-bridge roads
 * and roundabout plazas so curved splines and mountain switchbacks sit cleanly on terrain.
 */
export function buildWestgateTerrainFn(roads: RoadNetwork): TerrainHeightFn {
  const nodes = roads.getNodes();
  const nodePads = nodes.map((n) => {
    let r = n.kind === "roundabout" ? (n.radius ?? 18) + 12 : 14;
    if (n.kind !== "roundabout") {
      for (const seg of roads.getSegments()) {
        if (seg.spec.startNodeId === n.id || seg.spec.endNodeId === n.id) {
          r = Math.max(r, seg.totalWidth * 0.5 + 4);
        }
      }
    }
    return { x: n.x, y: n.y, z: n.z, r, outer: r + 15 };
  });

  // Exact rectangular compound terraces matching embedded OPEN_WORLD_MISSION_SITES footprints
  const compoundBoxes: Array<{
    missionId: number;
    cx: number;
    cz: number;
    halfW: number;
    halfD: number;
    y: number;
    maxZ?: number;
  }> = [
    { missionId: 1, cx: OPEN_WORLD_MISSION_SITES[1].x, cz: OPEN_WORLD_MISSION_SITES[1].z + 18, halfW: 32, halfD: 54, y: OPEN_WORLD_MISSION_SITES[1].y },
    { missionId: 2, cx: OPEN_WORLD_MISSION_SITES[2].x, cz: OPEN_WORLD_MISSION_SITES[2].z, halfW: 36, halfD: 46, y: OPEN_WORLD_MISSION_SITES[2].y },
    { missionId: 3, cx: OPEN_WORLD_MISSION_SITES[3].x, cz: OPEN_WORLD_MISSION_SITES[3].z - 4, halfW: 32, halfD: 48, y: OPEN_WORLD_MISSION_SITES[3].y },
    { missionId: 4, cx: OPEN_WORLD_MISSION_SITES[4].x, cz: OPEN_WORLD_MISSION_SITES[4].z - 12, halfW: 34, halfD: 34, y: OPEN_WORLD_MISSION_SITES[4].y, maxZ: 478 },
    { missionId: 5, cx: OPEN_WORLD_MISSION_SITES[5].x, cz: OPEN_WORLD_MISSION_SITES[5].z - 8, halfW: 34, halfD: 56, y: OPEN_WORLD_MISSION_SITES[5].y },
    { missionId: 6, cx: OPEN_WORLD_MISSION_SITES[6].x, cz: OPEN_WORLD_MISSION_SITES[6].z, halfW: 64, halfD: 94, y: OPEN_WORLD_MISSION_SITES[6].y },
  ];

  return (x: number, z: number): number => {
    let h = rawWestgateTerrainHeight(x, z);

    // Grade Player Safehouse Estate terrace at (-322, 310) flush with Mirror Park Crescent (5.35m)
    const shDx = x - -322;
    const shDz = z - 310;
    const shDist = Math.hypot(shDx, shDz);
    if (shDist < 46) {
      const w = 1 - smoothstep(28, 46, shDist);
      h = lerp(h, 5.35, w);
    }

    // Grade live open-world campaign compound blocks smoothly flush with surrounding city streets
    for (let i = 0; i < compoundBoxes.length; i++) {
      const cb = compoundBoxes[i];
      if (cb.maxZ !== undefined && z > cb.maxZ) continue; // preserve Seaport harbor water basin beyond pier edge
      const dx = Math.max(0, Math.abs(x - cb.cx) - cb.halfW);
      const dz = Math.max(0, Math.abs(z - cb.cz) - cb.halfD);
      const bd = Math.hypot(dx, dz);
      if (bd < 18) {
        const w = 1 - smoothstep(4, 18, bd);
        h = lerp(h, cb.y, w);
      }
    }

    // Grade all road nodes (roundabouts, freeway merges, signal junctions, cul-de-sacs)
    for (let i = 0; i < nodePads.length; i++) {
      const np = nodePads[i];
      const d = Math.hypot(x - np.x, z - np.z);
      if (d < np.outer) {
        const w = 1 - smoothstep(np.r, np.outer, d);
        h = lerp(h, np.y, w);
      }
    }

    // Grade non-bridge road corridors & embankments
    const inf = roads.getRoadInfluence(x, z, 32, true);
    if (inf) {
      const pad = inf.totalWidth * 0.5 + 2.8;
      if (inf.centerDist <= pad) {
        return inf.elevation;
      }
      const bankW = 14.0;
      if (inf.centerDist < pad + bankW) {
        const t = 1 - smoothstep(pad, pad + bankW, inf.centerDist);
        h = lerp(h, inf.elevation, t);
      }
    }

    return h;
  };
}

/**
 * Builds the 2.4km × 2.4km vertex-colored terrain mesh (`224×224` grid, 1 draw call)
 * shaded by elevation, slope, coastline sand, river concrete walls, and urban turf.
 */
export function buildWestgateTerrainMesh(
  terrainAt: TerrainHeightFn,
  worldSize = 2400,
  segments = 224,
): THREE.Mesh {
  const geo = new THREE.PlaneGeometry(worldSize, worldSize, segments, segments);
  geo.rotateX(-Math.PI / 2);

  const pos = geo.attributes.position as THREE.BufferAttribute;
  const count = pos.count;
  const heights = new Float32Array(count);
  const colors = new Float32Array(count * 3);
  const cols = segments + 1;
  const step = worldSize / segments;

  for (let i = 0; i < count; i++) {
    const y = terrainAt(pos.getX(i), pos.getZ(i));
    heights[i] = y;
    pos.setY(i, y);
  }

  const cSand = new THREE.Color(0xd7c196);
  const cSeabed = new THREE.Color(0x52656e);
  const cUrbanTurf = new THREE.Color(0x4b6a42);
  const cFoothillGrass = new THREE.Color(0x5d7244);
  const cRock = new THREE.Color(0x6e6961);
  const cConcreteChannel = new THREE.Color(0x7c8085);
  const cPortPad = new THREE.Color(0x565a60);
  const tmp = new THREE.Color();

  for (let row = 0; row <= segments; row++) {
    for (let col = 0; col <= segments; col++) {
      const i = row * cols + col;
      const x = pos.getX(i);
      const z = pos.getZ(i);
      const y = heights[i];

      const hx = heights[row * cols + Math.min(segments, col + 1)];
      const hz = heights[Math.min(segments, row + 1) * cols + col];
      const slope = Math.hypot(hx - y, hz - y) / step;

      const cx = coastLineX(z);
      const rx = riverCenterX(z);
      const nearRiver = z < 520 && Math.abs(x - rx) < 42;
      const nearCanals = x > -720 && x < -500 && z > 100 && z < 390;

      if (y < -0.6) {
        tmp.copy(cSeabed).lerp(cSand, smoothstep(-5, -0.6, y) * 0.55);
      } else if (x < cx + 52 && z < 980) {
        tmp.copy(cSand);
      } else if (nearRiver && y < 3.6 && z > -480) {
        tmp.copy(cConcreteChannel);
      } else if (nearCanals && y < 2.2) {
        tmp.copy(cConcreteChannel);
      } else if ((z > 680 && x < 420) || (x > 640 && z > -350 && z < 920)) {
        tmp.copy(cPortPad);
      } else {
        const foothillT = smoothstep(-440, -780, z);
        tmp.copy(cUrbanTurf).lerp(cFoothillGrass, foothillT);
        if (slope > 0.36 || y > 38) {
          const rockT = Math.max(smoothstep(0.35, 0.78, slope), smoothstep(38, 68, y) * 0.65);
          tmp.lerp(cRock, rockT);
        }
      }

      // Subtle spatial grain so large lawns/hills never look flat
      const grain = (fbm(x * 0.03, z * 0.03, 2) - 0.5) * 0.09;
      colors[i * 3] = Math.max(0, Math.min(1, tmp.r + grain));
      colors[i * 3 + 1] = Math.max(0, Math.min(1, tmp.g + grain));
      colors[i * 3 + 2] = Math.max(0, Math.min(1, tmp.b + grain));
    }
  }

  geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();

  const mat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.92,
    metalness: 0.02,
  });

  const weatherUniforms = {
    uWet: { value: 0 },
    uSnowCover: { value: 0 },
  };

  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uWet = weatherUniforms.uWet;
    shader.uniforms.uSnowCover = weatherUniforms.uSnowCover;
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        `#include <common>
        varying vec3 vTerrainWorldPos;
        varying vec3 vTerrainWorldNorm;`,
      )
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
        vTerrainWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
        vTerrainWorldNorm = normalize(mat3(modelMatrix) * objectNormal);`,
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
        uniform float uWet;
        uniform float uSnowCover;
        varying vec3 vTerrainWorldPos;
        varying vec3 vTerrainWorldNorm;
        float wtHash(vec2 p) {
          return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
        }
        float wtNoise(vec2 p) {
          vec2 i = floor(p);
          vec2 f = fract(p);
          vec2 u = f * f * (3.0 - 2.0 * f);
          return mix(
            mix(wtHash(i), wtHash(i + vec2(1.0, 0.0)), u.x),
            mix(wtHash(i + vec2(0.0, 1.0)), wtHash(i + vec2(1.0, 1.0)), u.x),
            u.y
          );
        }
        float wtDetail(vec2 xz) {
          float n1 = wtNoise(xz * 0.24);
          float n2 = wtNoise(xz * 0.95);
          float n3 = wtNoise(xz * 3.8);
          return n1 * 0.50 + n2 * 0.32 + n3 * 0.18;
        }
        float wtCliffStrata(vec3 wp) {
          float s1 = wtNoise(vec2(wp.x * 0.18 + wp.z * 0.18, wp.y * 1.15));
          float s2 = wtNoise(vec2(wp.z * 0.42 - wp.x * 0.31, wp.y * 3.4));
          return s1 * 0.62 + s2 * 0.38;
        }`,
      )
      .replace(
        "#include <color_fragment>",
        `#include <color_fragment>
        float td = wtDetail(vTerrainWorldPos.xz);
        float tdFine = wtNoise(vTerrainWorldPos.xz * 7.5);
        float steepness = smoothstep(0.90, 0.54, vTerrainWorldNorm.y);
        float strata = wtCliffStrata(vTerrainWorldPos);
        float dMod = mix(0.84, 1.15, td) * mix(0.95, 1.05, tdFine);
        diffuseColor.rgb *= dMod;

        // Triplanar stratified cliff rock bands on steep Foothill/canyon slopes
        if (steepness > 0.01) {
          vec3 cliffCol = mix(vec3(0.32, 0.30, 0.28), vec3(0.54, 0.50, 0.45), strata);
          diffuseColor.rgb = mix(diffuseColor.rgb, cliffCol, steepness * 0.78);
        }

        // Wet wave-washed beach surf sand near y = 0..1.15m
        float surfWetSand = (1.0 - smoothstep(0.0, 1.25, vTerrainWorldPos.y)) * smoothstep(-0.4, 0.05, vTerrainWorldPos.y) * (1.0 - steepness);
        if (surfWetSand > 0.01) {
          diffuseColor.rgb *= mix(1.0, 0.64, surfWetSand);
        }

        float wetT = clamp(uWet, 0.0, 1.0);
        if (wetT > 0.005) {
          float puddleMask = smoothstep(0.45, 0.78, wtNoise(vTerrainWorldPos.xz * 0.07));
          diffuseColor.rgb *= mix(1.0, 0.62, wetT * (0.45 + 0.55 * puddleMask));
        }
        float snowT = clamp(uSnowCover, 0.0, 1.0);
        float aboveSurf = smoothstep(-0.2, 1.1, vTerrainWorldPos.y);
        float gentleSlope = smoothstep(0.45, 0.88, vTerrainWorldNorm.y);
        float drift = wtNoise(vec2(vTerrainWorldPos.x * 0.35 + vTerrainWorldPos.z * 0.14, vTerrainWorldPos.z * 1.35));
        float snowMask = snowT * aboveSurf * gentleSlope * smoothstep(0.14, 0.78, snowT * 1.25 - td * 0.28 - drift * 0.14);
        if (snowMask > 0.005) {
          float sparkle = smoothstep(0.87, 0.99, wtHash(floor(vTerrainWorldPos.xz * 22.0)));
          vec3 snowDeep = vec3(0.72, 0.79, 0.87);
          vec3 snowTop = vec3(0.93, 0.96, 0.99);
          vec3 snowAlbedo = mix(snowDeep, snowTop, smoothstep(0.20, 0.80, td * 0.65 + drift * 0.35)) * mix(0.95, 1.03, tdFine);
          snowAlbedo += vec3(0.08, 0.10, 0.12) * sparkle;
          diffuseColor.rgb = mix(diffuseColor.rgb, snowAlbedo, clamp(snowMask, 0.0, 0.95));
        }`,
      )
      .replace(
        "#include <roughnessmap_fragment>",
        `#include <roughnessmap_fragment>
        roughnessFactor = clamp(roughnessFactor + (td - 0.5) * 0.14, 0.72, 0.98);
        float shoreGloss = (1.0 - smoothstep(0.0, 1.2, vTerrainWorldPos.y)) * smoothstep(-0.35, 0.05, vTerrainWorldPos.y);
        roughnessFactor = mix(roughnessFactor, 0.26, shoreGloss * 0.85);
        if (uWet > 0.005) {
          float tPuddle = smoothstep(0.45, 0.78, wtNoise(vTerrainWorldPos.xz * 0.07));
          roughnessFactor = mix(roughnessFactor, mix(0.42, 0.12, tPuddle), clamp(uWet, 0.0, 1.0));
        }
        if (uSnowCover > 0.005) {
          roughnessFactor = mix(roughnessFactor, 0.84, clamp(uSnowCover * 0.85, 0.0, 1.0));
        }`,
      )
      .replace(
        "#include <normal_fragment_maps>",
        `#include <normal_fragment_maps>
        float eps = 0.12;
        float hC = wtDetail(vTerrainWorldPos.xz);
        float hX = wtDetail(vTerrainWorldPos.xz + vec2(eps, 0.0));
        float hZ = wtDetail(vTerrainWorldPos.xz + vec2(0.0, eps));
        float cStr = wtCliffStrata(vTerrainWorldPos);
        float cStrY = wtCliffStrata(vTerrainWorldPos + vec3(0.0, eps, 0.0));
        float cliffScale = smoothstep(0.90, 0.54, vTerrainWorldNorm.y) * 1.4;
        vec3 detailGrad = vec3((hC - hX) * (0.42 + cliffScale), (cStr - cStrY) * cliffScale * 0.75, (hC - hZ) * (0.42 + cliffScale));
        normal = normalize(normal + (viewMatrix * vec4(detailGrad, 0.0)).xyz);`,
      );
  };
  mat.customProgramCacheKey = () => "westgate-terrain-detail-v3";

  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = "WestgateTerrain";
  mesh.receiveShadow = true;
  mesh.userData.kind = "dirt";
  mesh.userData.weatherUniforms = weatherUniforms;
  return mesh;
}

export function setTerrainWeather(mesh: THREE.Mesh, wet: number, snowCover: number): void {
  const u = mesh.userData.weatherUniforms as { uWet: { value: number }; uSnowCover: { value: number } } | undefined;
  if (!u) return;
  u.uWet.value = Math.max(0, Math.min(1, wet));
  u.uSnowCover.value = Math.max(0, Math.min(1, snowCover));
}

export interface WestgateGrassHandle {
  group: THREE.Group;
  update: (dt: number, snowCover: number) => void;
  dispose: () => void;
}

/**
 * Builds wind-swaying GPU-instanced grass blade tufts across Westgate Bay parks,
 * Old Quarter lawns, and Foothill meadows (bucketed into 4×4 spatial cells for culling).
 */
export function buildWestgateGrass(terrainAt: TerrainHeightFn, roads: RoadNetwork): WestgateGrassHandle {
  const group = new THREE.Group();
  group.name = "WestgateGrass";

  // 3 crossed tapered grass blades per tuft (18 triangles? No, 6 triangles total!)
  const positions: number[] = [];
  const colors: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];
  const blades = 3;
  for (let b = 0; b < blades; b++) {
    const a = (b / blades) * Math.PI;
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    const w = 0.095;
    const h = 0.42 + (b % 2) * 0.08;
    const lean = 0.08;
    const base = b * 4;
    // Bottom left, bottom right, mid left, tip
    positions.push(-ca * w, 0, -sa * w, ca * w, 0, sa * w, -ca * w * 0.45, h * 0.55, -sa * w * 0.45, lean * sa, h, -lean * ca);
    colors.push(0.24, 0.36, 0.16, 0.24, 0.36, 0.16, 0.44, 0.62, 0.28, 0.62, 0.78, 0.36);
    for (let k = 0; k < 4; k++) normals.push(0, 1, 0);
    indices.push(base, base + 1, base + 2, base + 1, base + 3, base + 2);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  geo.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
  geo.setIndex(indices);

  const grassUniforms = {
    uTime: { value: 0 },
    uSnowCover: { value: 0 },
  };
  const mat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.86,
    metalness: 0.02,
    side: THREE.DoubleSide,
  });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = grassUniforms.uTime;
    shader.uniforms.uSnowCover = grassUniforms.uSnowCover;
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        `#include <common>
        uniform float uTime;
        varying float vGrassH;`,
      )
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
        vGrassH = clamp(position.y * 2.2, 0.0, 1.0);
        vec3 instWorld = (instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
        float gust = sin(uTime * 2.1 + instWorld.x * 0.18 + instWorld.z * 0.14) * 0.12
                   + cos(uTime * 3.7 + instWorld.z * 0.32) * 0.05;
        transformed.x += gust * vGrassH * vGrassH;
        transformed.z += gust * 0.55 * vGrassH * vGrassH;`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
        uniform float uSnowCover;
        varying float vGrassH;`,
      )
      .replace(
        "#include <color_fragment>",
        `#include <color_fragment>
        float frost = clamp(uSnowCover, 0.0, 1.0) * smoothstep(0.15, 0.9, vGrassH) * 0.82;
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.86, 0.91, 0.96), frost);`,
      );
  };
  mat.customProgramCacheKey = () => "westgate-grass-wind-v1";

  // Bucket tufts into 4x4 grid (600m cells over [-1200, 1200]) so frustum culling skips distant cells
  const gridN = 4;
  const buckets: THREE.Matrix4[][] = Array.from({ length: gridN * gridN }, () => []);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const p = new THREE.Vector3();
  const s = new THREE.Vector3();

  let seed = 918273;
  const rnd = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };

  for (let i = 0; i < 16000; i++) {
    const x = -1020 + rnd() * 2040;
    const z = -1060 + rnd() * 2040;
    if (x < coastLineX(z) + 56) continue;
    if ((z > 670 && x < 430) || (x > 620 && z > -360 && z < 930)) continue;
    const dist = getDistrictAt(x, z).id;
    if (dist === "downtown" || dist === "midtown" || dist === "east_port" || dist === "south_airport" || dist === "ocean") continue;

    const y = terrainAt(x, z);
    if (y < 1.8 || y > 58) continue;
    const hx = terrainAt(x + 1.0, z);
    const hz = terrainAt(x, z + 1.0);
    if (Math.hypot(hx - y, hz - y) > 0.34) continue;

    const inf = roads.getRoadInfluence(x, z, 16);
    if (inf && inf.edgeDist < 2.2) continue;

    const scale = 0.85 + rnd() * 0.65;
    p.set(x, y - 0.04, z);
    e.set(0, rnd() * Math.PI * 2, 0);
    q.setFromEuler(e);
    s.set(scale, scale * (0.85 + rnd() * 0.45), scale);
    m.compose(p, q, s);

    const gx = Math.min(gridN - 1, Math.max(0, Math.floor(((x + 1200) / 2400) * gridN)));
    const gz = Math.min(gridN - 1, Math.max(0, Math.floor(((z + 1200) / 2400) * gridN)));
    buckets[gz * gridN + gx].push(m.clone());
  }

  const meshes: THREE.InstancedMesh[] = [];
  for (let bi = 0; bi < buckets.length; bi++) {
    const list = buckets[bi];
    if (list.length === 0) continue;
    const im = new THREE.InstancedMesh(geo, mat, list.length);
    im.name = `WestgateGrassCell_${bi}`;
    im.receiveShadow = true;
    for (let k = 0; k < list.length; k++) {
      im.setMatrixAt(k, list[k]);
    }
    im.instanceMatrix.needsUpdate = true;
    im.computeBoundingSphere();
    group.add(im);
    meshes.push(im);
  }

  return {
    group,
    update: (dt: number, snowCover: number) => {
      grassUniforms.uTime.value += dt;
      grassUniforms.uSnowCover.value = snowCover;
    },
    dispose: () => {
      geo.dispose();
      mat.dispose();
      meshes.length = 0;
    },
  };
}
