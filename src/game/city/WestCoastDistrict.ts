import * as THREE from "three";
import type { CityChunk } from "./ChunkStreamer";
import type { WalkableSurface, WorldHeightSystem } from "./HeightSystem";
import type { RoadNetwork } from "./RoadNetwork";
import { coastLineX } from "./WestgateTerrain";
import {
  CityChunkDispatcher,
  addLodBox,
  addSolidBox,
  addVisualBox,
  createFacadeMaterial,
  isFootprintClearOfRoads,
} from "./CityBuildingKit";

/** Del Sol Ocean Pier, Arcade Pavilion & Illuminated Ferris Wheel (`z=40, x=-738..-875`) */
function buildDelSolPier(chunk: CityChunk, groundY: number, heightSystem: WorldHeightSystem): void {
  const z = 40;
  const xStart = coastLineX(z) + 4; // ~ -734
  const xEnd = xStart - 138; // ~ -872
  const deckW = xStart - xEnd;
  const xMid = (xStart + xEnd) * 0.5;
  const deckY = 4.2;

  const woodDeck = new THREE.MeshStandardMaterial({ color: 0x8b623f, roughness: 0.86, metalness: 0.04 });
  const pilingMat = new THREE.MeshStandardMaterial({ color: 0x4b382a, roughness: 0.9 });
  const stucco = createFacadeMaterial("stucco_warm", 4, 2);
  const roofTeal = new THREE.MeshStandardMaterial({ color: 0x0f766e, roughness: 0.65 });
  const wheelMat = new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.45, metalness: 0.35 });
  const neonCyan = new THREE.MeshStandardMaterial({
    color: 0x22d3ee,
    emissive: 0x06b6d4,
    emissiveIntensity: 1.7,
    roughness: 0.3,
  });
  const neonPink = new THREE.MeshStandardMaterial({
    color: 0xf43f5e,
    emissive: 0xe11d48,
    emissiveIntensity: 1.6,
    roughness: 0.3,
  });

  // Main wooden pier deck & walkable surface
  addSolidBox(chunk, xMid, deckY - 0.35, z, deckW, 0.45, 16, woodDeck, 0, "wood");
  // Beach approach ramp connecting groundY (~2.8) up to deckY (4.2) (East low -> West high, so rotation.z = -pitch)
  const rampLen = 12;
  const rampPitch = Math.atan2(deckY - groundY, rampLen);
  const ramp = new THREE.Mesh(new THREE.BoxGeometry(rampLen, 0.4, 14), woodDeck);
  ramp.position.set(xStart + rampLen * 0.5 - 0.5, (groundY + deckY) * 0.5 - 0.2, z);
  ramp.rotation.z = -rampPitch;
  ramp.castShadow = true;
  ramp.receiveShadow = true;
  chunk.nearGroup.add(ramp);
  chunk.colliders.push(ramp);

  const pierSurf: WalkableSurface = {
    id: "wc_del_sol_pier",
    minX: xEnd - 1,
    maxX: xStart + rampLen,
    minZ: z - 8.2,
    maxZ: z + 8.2,
    minY: 2.0,
    maxY: deckY + 1.0,
    heightAt: (qx, qz) => {
      if (Math.abs(qz - z) > 8.2) return null;
      if (qx >= xEnd && qx <= xStart) return deckY + 0.1;
      if (qx > xStart && qx <= xStart + rampLen) {
        const t = (qx - xStart) / rampLen;
        return deckY + 0.1 + t * (groundY - deckY);
      }
      return null;
    },
  };
  heightSystem.addSurface(pierSurf);

  // Support pilings down to seabed
  for (let px = xEnd + 6; px <= xStart - 4; px += 14) {
    for (const pz of [z - 6.8, z + 6.8]) {
      addSolidBox(chunk, px, -5.0, pz, 0.65, deckY + 4.8, 0.65, pilingMat, 0, "wood");
    }
  }
  // Low edge safety curbs
  addSolidBox(chunk, xMid, deckY + 0.1, z - 7.7, deckW, 0.9, 0.35, woodDeck, 0, "wood");
  addSolidBox(chunk, xMid, deckY + 0.1, z + 7.7, deckW, 0.9, 0.35, woodDeck, 0, "wood");

  // Pier Arcade Pavilion & Diner
  const ax = xStart - 48;
  addSolidBox(chunk, ax, deckY + 0.1, z - 2.5, 18, 5.2, 8.5, stucco, 0, "concrete");
  addSolidBox(chunk, ax, deckY + 5.3, z - 2.5, 19.5, 0.8, 9.8, roofTeal, 0, "metal");
  addVisualBox(chunk.nearGroup, ax, deckY + 4.2, z + 2.0, 14, 0.7, 0.25, neonCyan, 0);

  const dx = xEnd + 18;
  addSolidBox(chunk, dx, deckY + 0.1, z + 2.2, 14, 4.6, 8.0, stucco, 0, "concrete");
  addSolidBox(chunk, dx, deckY + 4.7, z + 2.2, 15, 0.7, 9.0, neonPink, 0, "metal");

  // Iconic Del Sol Ferris Wheel (`xStart - 92, z`)
  const fx = xStart - 92;
  const hubY = deckY + 19.5;
  // A-frame legs
  for (const dz of [-4.2, 4.2]) {
    for (const s of [-1, 1]) {
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.55, 21.5, 8), wheelMat);
      leg.position.set(fx + s * 4.4, deckY + 9.8, z + dz);
      leg.rotation.z = s * 0.4;
      leg.castShadow = true;
      chunk.nearGroup.add(leg);
    }
  }
  // Wheel ring + 10 spokes + 10 colored gondolas
  const rim = new THREE.Mesh(new THREE.TorusGeometry(14.5, 0.48, 8, 28), neonCyan);
  rim.position.set(fx, hubY, z);
  chunk.nearGroup.add(rim);
  const innerRim = new THREE.Mesh(new THREE.TorusGeometry(9.5, 0.28, 6, 20), wheelMat);
  innerRim.position.set(fx, hubY, z);
  chunk.nearGroup.add(innerRim);

  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    const gx = fx + Math.cos(a) * 14.5;
    const gy = hubY + Math.sin(a) * 14.5;
    const spoke = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 29, 6), wheelMat);
    spoke.position.set(fx, hubY, z);
    spoke.rotation.z = a + Math.PI * 0.5;
    chunk.nearGroup.add(spoke);
    addVisualBox(chunk.nearGroup, gx, gy - 1.0, z, 2.0, 2.0, 2.0, i % 2 === 0 ? neonPink : neonCyan, 0);
  }

  addLodBox(chunk, fx, deckY, z, 18, 32, 10, 0x38bdf8);
  addLodBox(chunk, xMid, deckY - 0.5, z, deckW, 2.5, 16, 0x8b623f);
}

/** Lifeguard Tower & Beach Cabanas along the sand */
function buildBeachPost(chunk: CityChunk, z: number, groundY: number): void {
  const x = coastLineX(z) + 18;
  const whiteWood = new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.72 });
  const roofBlue = new THREE.MeshStandardMaterial({ color: 0x0284c7, roughness: 0.65 });
  const umbrellaRed = new THREE.MeshStandardMaterial({ color: 0xef4444, roughness: 0.7 });

  // Stilted lifeguard hut
  for (const dx of [-1.4, 1.4]) {
    for (const dz of [-1.4, 1.4]) {
      addSolidBox(chunk, x + dx, groundY, z + dz, 0.25, 2.6, 0.25, whiteWood, 0, "wood");
    }
  }
  addSolidBox(chunk, x, groundY + 2.6, z, 3.4, 2.4, 3.4, whiteWood, 0, "wood");
  addSolidBox(chunk, x, groundY + 5.0, z, 3.8, 0.4, 3.8, roofBlue, 0, "metal");

  // Beach umbrellas nearby
  for (const uz of [z - 11, z + 11]) {
    addSolidBox(chunk, x - 6, groundY, uz, 0.14, 2.4, 0.14, whiteWood, 0, "wood");
    const cone = new THREE.Mesh(new THREE.ConeGeometry(1.9, 0.8, 8), umbrellaRed);
    cone.position.set(x - 6, groundY + 2.5, uz);
    cone.castShadow = true;
    chunk.nearGroup.add(cone);
  }
}

/** Venice Canals Arched Pedestrian Footbridges & Waterfront Villas (`x=-680..-530, z=145..345`) */
function buildVeniceCanalsBand(chunk: CityChunk, heightSystem: WorldHeightSystem, band: "north" | "south"): void {
  const woodBridge = new THREE.MeshStandardMaterial({ color: 0x7c5338, roughness: 0.82 });
  const stucco = createFacadeMaterial("stucco_warm", 4, 3);
  const pastelBlue = new THREE.MeshStandardMaterial({ color: 0xbfdbfe, roughness: 0.82 });
  const pastelPeach = new THREE.MeshStandardMaterial({ color: 0xfed7aa, roughness: 0.82 });
  const terra = new THREE.MeshStandardMaterial({ color: 0xb45309, roughness: 0.76 });

  const addCanalBridge = (id: string, bx: number, bz: number, axis: "ns" | "ew", span: number) => {
    const deckY = 3.9;
    const w = axis === "ew" ? span : 4.4;
    const d = axis === "ns" ? span : 4.4;
    addSolidBox(chunk, bx, deckY - 0.3, bz, w, 0.4, d, woodBridge, 0, "wood");
    if (axis === "ns") {
      addSolidBox(chunk, bx, 3.25, bz - span * 0.5 - 1.5, 4.4, 0.45, 3.2, woodBridge, 0, "wood");
      addSolidBox(chunk, bx, 3.25, bz + span * 0.5 + 1.5, 4.4, 0.45, 3.2, woodBridge, 0, "wood");
    } else {
      addSolidBox(chunk, bx - span * 0.5 - 1.5, 3.25, bz, 3.2, 0.45, 4.4, woodBridge, 0, "wood");
      addSolidBox(chunk, bx + span * 0.5 + 1.5, 3.25, bz, 3.2, 0.45, 4.4, woodBridge, 0, "wood");
    }

    const surf: WalkableSurface = {
      id,
      minX: bx - w * 0.5 - (axis === "ew" ? 3.2 : 0.2),
      maxX: bx + w * 0.5 + (axis === "ew" ? 3.2 : 0.2),
      minZ: bz - d * 0.5 - (axis === "ns" ? 3.2 : 0.2),
      maxZ: bz + d * 0.5 + (axis === "ns" ? 3.2 : 0.2),
      minY: 2.5,
      maxY: 4.6,
      heightAt: (qx, qz) => {
        if (Math.abs(qx - bx) <= w * 0.5 && Math.abs(qz - bz) <= d * 0.5) return deckY + 0.1;
        return 3.45;
      },
    };
    heightSystem.addSurface(surf);
  };

  const villas: Array<{ x: number; z: number; mat: THREE.Material }> = [];
  if (band === "north") {
    addCanalBridge("wc_canal_bridge_n", -648, 185, "ns", 28);
    villas.push({ x: -648, z: 150, mat: stucco }, { x: -562, z: 150, mat: pastelPeach });
  } else {
    addCanalBridge("wc_canal_bridge_s", -562, 305, "ns", 28);
    addCanalBridge("wc_canal_bridge_c", -605, 245, "ew", 26);
    villas.push(
      { x: -648, z: 245, mat: pastelBlue },
      { x: -562, z: 245, mat: stucco },
      { x: -648, z: 342, mat: pastelPeach },
      { x: -562, z: 342, mat: pastelBlue },
    );
  }

  for (const v of villas) {
    addSolidBox(chunk, v.x, 2.9, v.z, 18, 7.6, 15, v.mat, 0, "concrete");
    const roof = new THREE.Mesh(new THREE.ConeGeometry(Math.SQRT1_2, 2.6, 4), terra);
    roof.scale.set(19, 1, 16);
    roof.rotation.y = Math.PI * 0.25;
    roof.position.set(v.x, 2.9 + 7.6 + 1.3, v.z);
    roof.castShadow = true;
    chunk.nearGroup.add(roof);
    addLodBox(chunk, v.x, 2.9, v.z, 18, 9.5, 15, 0xd6b793);
  }
}

/** Del Sol Beachfront Resort Hotel & Pool (`x=-608, z=-25`) */
function buildBeachfrontResort(chunk: CityChunk, groundY: number): void {
  const x = -608;
  const z = -25;
  const stucco = createFacadeMaterial("stucco_warm", 6, 5);
  const glass = createFacadeMaterial("glass_teal", 5, 5);
  const poolMat = new THREE.MeshStandardMaterial({ color: 0x06b6d4, roughness: 0.14, metalness: 0.55 });
  const deckMat = new THREE.MeshStandardMaterial({ color: 0xe7dfd1, roughness: 0.86 });

  addSolidBox(chunk, x, groundY - 0.1, z, 56, 0.24, 48, deckMat, 0, "concrete", false, true);
  addSolidBox(chunk, x + 8, groundY, z - 8, 34, 22.0, 22, stucco, 0, "concrete");
  addSolidBox(chunk, x - 12, groundY, z + 6, 16, 14.0, 24, glass, 0, "concrete");
  addVisualBox(chunk.nearGroup, x + 10, groundY + 0.15, z + 14, 20, 0.06, 12, poolMat, 0, false, true);

  addLodBox(chunk, x + 4, groundY, z - 2, 42, 21, 34, 0xd8c3a5);
}

/** Pacific Yacht Club & Harbor Marina Slips (`x=-715, z=480`) */
function buildMarina(chunk: CityChunk, groundY: number): void {
  const x = -715;
  const z = 480;
  const wood = new THREE.MeshStandardMaterial({ color: 0x8b623f, roughness: 0.85 });
  const club = createFacadeMaterial("limestone", 4, 2);
  const hull = new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.45 });
  const trim = new THREE.MeshStandardMaterial({ color: 0x1e3a8a, roughness: 0.5 });

  addSolidBox(chunk, x + 36, groundY, z, 22, 6.8, 16, club, 0, "concrete");
  // Main marina dock extending out into water
  addSolidBox(chunk, x - 12, 1.4, z, 52, 0.35, 4.5, wood, 0, "wood");
  for (const fz of [z - 16, z + 16]) {
    addSolidBox(chunk, x - 16, 1.4, fz, 34, 0.35, 3.0, wood, 0, "wood");
    // Moored pleasure yachts
    addSolidBox(chunk, x - 18, 0.2, fz + (fz < z ? 5 : -5), 14, 2.2, 4.4, hull, 0, "wood");
    addSolidBox(chunk, x - 17, 2.4, fz + (fz < z ? 5 : -5), 6.5, 1.8, 3.0, trim, 0, "metal");
  }

  addLodBox(chunk, x + 36, groundY, z, 22, 7.2, 16, 0xc9c2b2);
}

/**
 * Registers Phase 5 West Coast, Beach Pier & Venice Canals onto the chunk dispatcher.
 */
export function registerWestCoastDistrict(
  dispatcher: CityChunkDispatcher,
  roads: RoadNetwork,
  heightSystem: WorldHeightSystem,
  worldMin = -1200,
  chunkSize = 160,
): void {
  // 1. Del Sol Ocean Pier & Ferris Wheel
  dispatcher.registerAtPoint(-785, 40, worldMin, chunkSize, (chunk, terrainAt) => {
    buildDelSolPier(chunk, terrainAt(coastLineX(40) + 6, 40), heightSystem);
  });

  // 2. Lifeguard Towers & Beach Umbrellas
  for (const z of [-210, 130, 345]) {
    dispatcher.registerAtPoint(coastLineX(z) + 18, z, worldMin, chunkSize, (chunk, terrainAt) => {
      const bx = coastLineX(z) + 18;
      buildBeachPost(chunk, z, terrainAt(bx, z));
    });
  }

  // 3. Venice Canals Footbridges & Waterfront Villas (split across north/south canal chunks)
  dispatcher.registerAtPoint(-605, 185, worldMin, chunkSize, (chunk) => {
    buildVeniceCanalsBand(chunk, heightSystem, "north");
  });
  dispatcher.registerAtPoint(-605, 285, worldMin, chunkSize, (chunk) => {
    buildVeniceCanalsBand(chunk, heightSystem, "south");
  });

  // 4. Del Sol Beachfront Resort Hotel
  if (isFootprintClearOfRoads(roads, -608, -25, 30)) {
    dispatcher.registerAtPoint(-608, -25, worldMin, chunkSize, (chunk, terrainAt) => {
      buildBeachfrontResort(chunk, terrainAt(-608, -25));
    });
  }

  // 5. Pacific Marina & Yacht Club
  dispatcher.registerAtPoint(-715, 480, worldMin, chunkSize, (chunk, terrainAt) => {
    buildMarina(chunk, terrainAt(-679, 480));
  });
}

export const WEST_COAST_LANDMARKS = [
  { id: "del_sol_pier", name: "Del Sol Pier & Ferris Wheel", x: -755, z: 40 },
  { id: "venice_canals", name: "Venice Canals & Footbridges", x: -605, z: 245 },
  { id: "beach_resort", name: "Del Sol Beachfront Resort", x: -608, z: -25 },
  { id: "pacific_marina", name: "Pacific Marina & Yacht Club", x: -679, z: 480 },
];
