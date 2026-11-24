import * as THREE from "three";
import type { CityChunk } from "./ChunkStreamer";
import type { RoadNetwork } from "./RoadNetwork";
import type { TerrainHeightFn } from "./HeightSystem";
import {
  CityChunkDispatcher,
  addLodBox,
  addSolidBox,
  addVisualBox,
  createFacadeMaterial,
  isFootprintClearOfRoads,
  type FacadeStyle,
} from "./CityBuildingKit";
import { coastLineX, getDistrictAt, riverCenterX } from "./WestgateTerrain";

interface ExclusionCircle {
  x: number;
  z: number;
  r: number;
}

// Keep plazas, parks, airport runways, stadium, river/canals, and spawn teleports clear
const PROTECTED_ZONES: ExclusionCircle[] = [
  { x: 24, z: -82, r: 22 }, // Downtown Spawn
  { x: 60, z: -80, r: 36 }, // Legion Roundabout
  { x: 58, z: -162, r: 32 }, // Legion Square
  { x: -260, z: -140, r: 34 }, // Midtown Roundabout
  { x: -220, z: 280, r: 34 }, // Old Quarter Roundabout
  { x: -700, z: -110, r: 32 }, // West Coast Roundabout
  { x: 740, z: -40, r: 34 }, // East Industrial Roundabout
  { x: -115, z: 395, r: 74 }, // Mirror Central Park
  { x: -402, z: -86, r: 68 }, // Grand Mall
  { x: -146, z: -206, r: 48 }, // Medical Center
  { x: -165, z: -332, r: 62 }, // University Campus
  { x: -415, z: 615, r: 78 }, // Sports Arena
  { x: -80, z: 920, r: 260 }, // South Airport & Runways
  { x: -706, z: 40, r: 58 }, // Del Sol Pier
  { x: -620, z: 220, r: 125 }, // Venice Canals
  { x: -120, z: -974, r: 64 }, // Observatory Summit
  { x: 635, z: 432, r: 120 }, // Seaport Cranes & Yard
  { x: 196, z: 48, r: 36 }, // Police HQ / Parking Deck
  { x: 112, z: -162, r: 32 }, // City Hall
];

function hashLot(ix: number, iz: number): number {
  const n = Math.sin(ix * 127.1 + iz * 311.7) * 43758.5453123;
  return n - Math.floor(n);
}

const HOUSE_WALL_COLORS = [0xe8dfd0, 0xd8cbb8, 0xcad6cf, 0xead8c0, 0xd9d2c5, 0xded3c1, 0xe2c7ab, 0xcfd6dc];
const HOUSE_ROOF_COLORS = [0x6b3a2e, 0x4b5563, 0x5c3a2e, 0x7c3e2c, 0x3f4c59, 0x693b2d];

export function registerWestgateInfill(dispatcher: CityChunkDispatcher): void {
  // Shared materials to avoid per-building material allocation
  const lobbyMat = new THREE.MeshStandardMaterial({ color: 0x223240, roughness: 0.28, metalness: 0.58 });
  const trimMat = new THREE.MeshStandardMaterial({ color: 0x20262e, roughness: 0.48, metalness: 0.65 });
  const houseTrimMat = new THREE.MeshStandardMaterial({ color: 0xf4f4f5, roughness: 0.78 });
  const houseWinMat = new THREE.MeshStandardMaterial({ color: 0x36526d, roughness: 0.24, metalness: 0.45 });
  const lawnMat = new THREE.MeshStandardMaterial({ color: 0x4b773e, roughness: 0.94 });
  const warehouseRoofMat = new THREE.MeshStandardMaterial({ color: 0x5c646d, roughness: 0.68, metalness: 0.35 });
  const awningColors = [0x166534, 0x991b1b, 0x1e40af, 0x92400e].map(
    (c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.72 }),
  );
  const houseWallMats = HOUSE_WALL_COLORS.map(
    (c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.86, metalness: 0.02 }),
  );
  const houseRoofMats = HOUSE_ROOF_COLORS.map(
    (c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.78, metalness: 0.08 }),
  );

  const facadeCache = new Map<string, THREE.MeshStandardMaterial>();
  const getFacade = (style: FacadeStyle, rx: number, ry: number) => {
    const key = `${style}:${rx}:${ry}`;
    let m = facadeCache.get(key);
    if (!m) {
      m = createFacadeMaterial(style, rx, ry);
      facadeCache.set(key, m);
    }
    return m;
  };

  dispatcher.registerGlobalHook((chunk: CityChunk, terrainAt: TerrainHeightFn, roads: RoadNetwork) => {
    if (chunk.maxX < -940 || chunk.minX > 960 || chunk.maxZ < -980 || chunk.minZ > 940) return;

    const step = 22;
    const x0 = Math.ceil(Math.max(-920, chunk.minX + 6) / step) * step;
    const z0 = Math.ceil(Math.max(-940, chunk.minZ + 6) / step) * step;
    const x1 = Math.min(920, chunk.maxX - 6);
    const z1 = Math.min(900, chunk.maxZ - 6);

    const existingCount = chunk.aabbs.length;

    for (let gx = x0; gx <= x1; gx += step) {
      for (let gz = z0; gz <= z1; gz += step) {
        const r0 = hashLot(gx, gz);
        const r1 = hashLot(gx + 19, gz + 37);
        const r2 = hashLot(gx + 71, gz + 13);
        const r3 = hashLot(gx + 103, gz + 59);

        const x = gx + (r0 - 0.5) * 7.5;
        const z = gz + (r1 - 0.5) * 7.5;

        // Keep strictly clear of Pacific shoreline & Westgate River channel
        if (x < coastLineX(z) + 28) continue;
        if (z < 540 && Math.abs(x - riverCenterX(z)) < 46) continue;

        const district = getDistrictAt(x, z);
        if (district.id === "ocean" || district.id === "south_airport") continue;

        // Density filter per district
        const keepProb =
          district.id === "downtown"
            ? 0.84
            : district.id === "midtown"
              ? 0.82
              : district.id === "old_quarter"
                ? 0.86
                : district.id === "west_coast"
                  ? 0.74
                  : district.id === "east_port"
                    ? 0.65
                    : 0.45;
        if (r2 > keepProb) continue;

        // Check protected hero zones
        let protectedHit = false;
        for (let i = 0; i < PROTECTED_ZONES.length; i++) {
          const pz = PROTECTED_ZONES[i];
          const dx = x - pz.x;
          const dz = z - pz.z;
          if (dx * dx + dz * dz < pz.r * pz.r) {
            protectedHit = true;
            break;
          }
        }
        if (protectedHit) continue;

        const gy = terrainAt(x, z);
        if (gy < 1.8 || gy > 52) continue;

        // Determine lot size & architectural archetype from district
        const isHouse =
          district.id === "old_quarter"
            ? r3 > 0.22
            : district.id === "foothills"
              ? true
              : district.id === "west_coast"
                ? r3 > 0.38
                : false;

        const w = isHouse
          ? 9 + Math.floor(r0 * 4)
          : district.id === "downtown"
            ? 14 + Math.floor(r0 * 8)
            : district.id === "east_port"
              ? 16 + Math.floor(r0 * 9)
              : 13 + Math.floor(r0 * 6);
        const d = isHouse
          ? 8 + Math.floor(r1 * 4)
          : district.id === "downtown"
            ? 14 + Math.floor(r1 * 8)
            : 12 + Math.floor(r1 * 6);

        const footprintR = Math.max(w, d) * 0.5 + 1.8;

        // Fill city blocks and suburban streets (up to 92m from road centerline) without overlapping roads
        const inf = roads.getRoadInfluence(x, z, 94, false);
        if (!inf || inf.centerDist > 92 || inf.edgeDist < footprintR) continue;
        if (!isFootprintClearOfRoads(roads, x, z, footprintR)) continue;

        // Slope check across footprint corners
        const yMin = Math.min(
          terrainAt(x - w * 0.45, z - d * 0.45),
          terrainAt(x + w * 0.45, z + d * 0.45),
          terrainAt(x - w * 0.45, z + d * 0.45),
          terrainAt(x + w * 0.45, z - d * 0.45),
        );
        const yMax = Math.max(
          terrainAt(x - w * 0.45, z - d * 0.45),
          terrainAt(x + w * 0.45, z + d * 0.45),
          terrainAt(x - w * 0.45, z + d * 0.45),
          terrainAt(x + w * 0.45, z - d * 0.45),
        );
        if (yMax - yMin > 2.4) continue;

        // Check overlap against existing hero landmarks & previously placed infill in this chunk
        const pad = 2.6;
        const ax0 = x - w * 0.5 - pad;
        const ax1 = x + w * 0.5 + pad;
        const az0 = z - d * 0.5 - pad;
        const az1 = z + d * 0.5 + pad;
        let overlaps = false;
        for (let ai = 0; ai < chunk.aabbs.length; ai++) {
          const eb = chunk.aabbs[ai];
          if (ax0 < eb.max.x && ax1 > eb.min.x && az0 < eb.max.z && az1 > eb.min.z) {
            overlaps = true;
            break;
          }
        }
        if (overlaps) continue;
        void existingCount;

        // Align building cleanly to the nearest road's tangent
        const yaw = Math.atan2(inf.tangentX, inf.tangentZ);

        if (isHouse) {
          const h = 4.4 + r2 * 2.2;
          const wallIdx = Math.floor(r0 * HOUSE_WALL_COLORS.length) % HOUSE_WALL_COLORS.length;
          const roofIdx = Math.floor(r1 * HOUSE_ROOF_COLORS.length) % HOUSE_ROOF_COLORS.length;

          // Yard pad
          addSolidBox(chunk, x, yMin - 0.15, z, w + 5.5, 0.25, d + 5.5, lawnMat, yaw, "dirt", false, true);
          // Main residence
          addSolidBox(chunk, x, yMin, z, w, h, d, houseWallMats[wallIdx], yaw, "concrete");
          // Front porch windows & eaves trim
          const ca = Math.cos(yaw);
          const sa = Math.sin(yaw);
          addVisualBox(
            chunk.nearGroup,
            x + sa * (d * 0.5 + 0.06),
            yMin + 1.45,
            z + ca * (d * 0.5 + 0.06),
            w * 0.62,
            1.4,
            0.14,
            houseWinMat,
            yaw,
          );
          addVisualBox(chunk.nearGroup, x, yMin + h - 0.2, z, w + 0.6, 0.28, d + 0.6, houseTrimMat, yaw);

          const cone = new THREE.Mesh(new THREE.ConeGeometry(Math.SQRT1_2, 2.7, 4), houseRoofMats[roofIdx]);
          cone.scale.set(w + 0.9, 1, d + 0.9);
          cone.rotation.y = Math.PI * 0.25 + yaw;
          cone.position.set(x, yMin + h + 1.35, z);
          cone.castShadow = true;
          cone.receiveShadow = true;
          chunk.nearGroup.add(cone);

          addLodBox(chunk, x, yMin, z, w, h + 1.8, d, HOUSE_WALL_COLORS[wallIdx], yaw);
        } else if (district.id === "east_port") {
          const h = 7.5 + r2 * 7.5;
          const mat = getFacade("concrete_mod", Math.max(2, Math.round(w / 5)), Math.max(1, Math.round(h / 4)));
          addSolidBox(chunk, x, yMin, z, w, h, d, mat, yaw, "concrete");
          addVisualBox(chunk.nearGroup, x, yMin + h, z, w + 0.5, 0.6, d + 0.5, warehouseRoofMat, yaw);
          addLodBox(chunk, x, yMin, z, w, h, d, 0x7b8087, yaw);
        } else {
          // Urban tower / mid-rise apartment / storefront block
          const styles: FacadeStyle[] =
            district.id === "downtown"
              ? ["glass_teal", "glass_navy", "glass_slate", "granite_dark", "limestone", "glass_gold"]
              : district.id === "west_coast"
                ? ["stucco_warm", "limestone", "glass_teal", "brick_tan"]
                : ["brick_red", "brick_tan", "stucco_warm", "limestone", "concrete_mod"];
          const style = styles[Math.floor((r0 + r1) * 10) % styles.length];
          const lodColors: Record<FacadeStyle, number> = {
            glass_teal: 0x3b6778,
            glass_navy: 0x2b4a69,
            glass_gold: 0x7a6646,
            glass_slate: 0x4d5b68,
            limestone: 0xb0a998,
            granite_dark: 0x4f555e,
            brick_red: 0x824034,
            brick_tan: 0x9e8162,
            concrete_mod: 0x7b8087,
            stucco_warm: 0xc2aa8a,
          };
          const h =
            district.id === "downtown"
              ? 18 + Math.floor(r2 * 44)
              : district.id === "midtown"
                ? 11 + Math.floor(r2 * 16)
                : 9 + Math.floor(r2 * 11);

          const rx = Math.max(2, Math.round(w / 4.5));
          const ry = Math.max(2, Math.round(h / 4.2));
          const mat = getFacade(style, rx, ry);
          addSolidBox(chunk, x, yMin, z, w, h, d, mat, yaw, "concrete");
          addVisualBox(chunk.nearGroup, x, yMin + 0.1, z, w + 0.25, 3.2, d + 0.25, lobbyMat, yaw, false, true);
          addVisualBox(chunk.nearGroup, x, yMin + h, z, w + 0.4, 0.75, d + 0.4, trimMat, yaw);

          if (district.id === "midtown" || district.id === "old_quarter") {
            const awn = awningColors[Math.floor(r3 * awningColors.length) % awningColors.length];
            const ca = Math.cos(yaw);
            const sa = Math.sin(yaw);
            addVisualBox(
              chunk.nearGroup,
              x + sa * (d * 0.5 + 0.9),
              yMin + 3.0,
              z + ca * (d * 0.5 + 0.9),
              w * 0.75,
              0.35,
              1.6,
              awn,
              yaw,
            );
          } else if (district.id === "downtown" && h > 34) {
            addVisualBox(chunk.nearGroup, x, yMin + h + 0.75, z, w * 0.42, 2.8, d * 0.42, trimMat, yaw);
          }

          addLodBox(chunk, x, yMin, z, w, h, d, lodColors[style], yaw);
        }
      }
    }
  });
}
