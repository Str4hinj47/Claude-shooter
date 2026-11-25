import * as THREE from "three";
import type { TerrainHeightFn } from "./HeightSystem";
import type { RoadNetwork } from "./RoadNetwork";

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
  if (z < 520) {
    const rx = riverCenterX(z);
    const rDist = Math.abs(x - rx);
    // Wider gorge in foothills, crisp urban river channel mid-city
    const halfChan = z < -480 ? 34 : 26;
    if (rDist < halfChan + 28) {
      const t = 1 - smoothstep(halfChan - 6, halfChan + 26, rDist);
      h = lerp(h, -2.4, t);
    }
  } else {
    // East Seaport Harbor shipping basin (x in [455, 865], z in [495, 960])
    const inHarborX = smoothstep(430, 475, x) * (1 - smoothstep(845, 895, x));
    const inHarborZ = smoothstep(480, 525, z) * (1 - smoothstep(940, 1020, z));
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
  const roundabouts = nodes.filter((n) => n.kind === "roundabout");

  return (x: number, z: number): number => {
    let h = rawWestgateTerrainHeight(x, z);

    // Grade Player Safehouse Estate terrace at (-322, 310) flush with Mirror Park Crescent (5.35m)
    const shDx = x - -322;
    const shDz = z - 310;
    const shDist = Math.hypot(shDx, shDz);
    if (shDist < 36) {
      const w = 1 - smoothstep(19, 36, shDist);
      h = lerp(h, 5.35, w);
    }

    // Grade roundabout central aprons smoothly
    for (let i = 0; i < roundabouts.length; i++) {
      const rb = roundabouts[i];
      const r = (rb.radius ?? 18) + 12;
      const d = Math.hypot(x - rb.x, z - rb.z);
      if (d < r + 14) {
        const w = 1 - smoothstep(r - 2, r + 14, d);
        h = lerp(h, rb.y, w);
      }
    }

    // Grade non-bridge road corridors & embankments
    const inf = roads.getRoadInfluence(x, z, 28, true);
    if (inf) {
      const pad = inf.totalWidth * 0.5 + 1.2;
      if (inf.centerDist <= pad) {
        return inf.elevation;
      }
      const bankW = 11.5;
      if (inf.centerDist < pad + bankW) {
        const t = 1 - smoothstep(pad, pad + bankW, inf.centerDist);
        h = lerp(h, inf.elevation, t);
      }
    }

    return h;
  };
}

/**
 * Builds the 2.4km × 2.4km vertex-colored terrain mesh (`160×160` grid, 1 draw call)
 * shaded by elevation, slope, coastline sand, river concrete walls, and urban turf.
 */
export function buildWestgateTerrainMesh(
  terrainAt: TerrainHeightFn,
  worldSize = 2400,
  segments = 160,
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
        }`,
      )
      .replace(
        "#include <color_fragment>",
        `#include <color_fragment>
        float td = wtDetail(vTerrainWorldPos.xz);
        float tdFine = wtNoise(vTerrainWorldPos.xz * 7.5);
        float dMod = mix(0.84, 1.15, td) * mix(0.95, 1.05, tdFine);
        diffuseColor.rgb *= dMod;
        float wetT = clamp(uWet, 0.0, 1.0);
        if (wetT > 0.005) {
          float puddleMask = smoothstep(0.45, 0.78, wtNoise(vTerrainWorldPos.xz * 0.07));
          diffuseColor.rgb *= mix(1.0, 0.62, wetT * (0.45 + 0.55 * puddleMask));
        }
        float snowT = clamp(uSnowCover, 0.0, 1.0);
        float aboveSurf = smoothstep(-0.2, 1.1, vTerrainWorldPos.y);
        float gentleSlope = smoothstep(0.45, 0.88, vTerrainWorldNorm.y);
        float snowMask = snowT * aboveSurf * gentleSlope * smoothstep(0.14, 0.78, snowT * 1.25 - td * 0.32);
        if (snowMask > 0.005) {
          vec3 snowAlbedo = vec3(0.88, 0.93, 0.98) * mix(0.93, 1.04, tdFine);
          diffuseColor.rgb = mix(diffuseColor.rgb, snowAlbedo, clamp(snowMask, 0.0, 0.96));
        }`,
      )
      .replace(
        "#include <roughnessmap_fragment>",
        `#include <roughnessmap_fragment>
        roughnessFactor = clamp(roughnessFactor + (td - 0.5) * 0.14, 0.72, 0.98);
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
        vec3 detailGrad = vec3((hC - hX) * 0.35, 0.0, (hC - hZ) * 0.35);
        normal = normalize(normal + (viewMatrix * vec4(detailGrad, 0.0)).xyz);`,
      );
  };
  mat.customProgramCacheKey = () => "westgate-terrain-detail-v2";

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
