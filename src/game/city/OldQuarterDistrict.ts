import * as THREE from "three";
import { materialFor } from "../kit/surface";
import type { CityChunk } from "./ChunkStreamer";
import type { RoadNetwork } from "./RoadNetwork";
import type { WorldHeightSystem } from "./HeightSystem";
import {
  CityChunkDispatcher,
  addDetailedHouse,
  addFacadeRelief,
  addLodBox,
  addPavedPlazaApron,
  addRooftopDetails,
  addSolidBox,
  addStorefrontBay,
  addVisualBox,
  createFacadeMaterial,
  isFootprintClearOfRoads,
  registerNightGlowMaterial,
} from "./CityBuildingKit";
import { buildPlayerSafehouse, SAFEHOUSE_ORIGIN } from "./SafehouseResidence";
import { attachGlbToGroup } from "./PropModels";

interface HouseSpec {
  id: string;
  x: number;
  z: number;
  w: number;
  d: number;
  h: number;
  wallColor: number;
  roofColor: number;
  yaw: number;
}

const SUBURBAN_HOMES: HouseSpec[] = [
  { id: "oq_home_3", x: -395, z: 345, w: 12, d: 11, h: 4.6, wallColor: 0xc9d6cf, roofColor: 0x5c3a2e, yaw: -0.75 },
  { id: "oq_home_4", x: -435, z: 425, w: 13, d: 10, h: 5.2, wallColor: 0xead8c0, roofColor: 0x7c3e2c, yaw: -1.1 },
  { id: "oq_home_5", x: -355, z: 465, w: 12, d: 10, h: 4.8, wallColor: 0xd6cfc2, roofColor: 0x3f4c59, yaw: 1.9 },
  { id: "oq_home_6", x: -438, z: 535, w: 14, d: 11, h: 5.2, wallColor: 0xe5d3b3, roofColor: 0x6d3b2c, yaw: 0.7 },
  { id: "oq_home_7", x: -378, z: 575, w: 13, d: 10, h: 4.9, wallColor: 0xc8d2d9, roofColor: 0x454e57, yaw: 0.3 },
  { id: "oq_home_8", x: -275, z: 598, w: 13, d: 11, h: 5.0, wallColor: 0xecdcc7, roofColor: 0x754130, yaw: -0.4 },
  { id: "oq_home_9", x: -265, z: 510, w: 12, d: 10, h: 4.8, wallColor: 0xdfd3c3, roofColor: 0x52463d, yaw: 2.3 },
  { id: "oq_home_10", x: -195, z: 345, w: 12, d: 10, h: 5.0, wallColor: 0xd7c7b2, roofColor: 0x65382a, yaw: 0.2 },
  { id: "oq_home_11", x: -195, z: 515, w: 13, d: 10, h: 4.8, wallColor: 0xe4d9c6, roofColor: 0x47525e, yaw: -0.2 },
  { id: "oq_home_12", x: -125, z: 545, w: 14, d: 11, h: 5.2, wallColor: 0xd2dad3, roofColor: 0x693b2d, yaw: 0.1 },
];

function addGableRoof(
  parent: THREE.Object3D,
  x: number,
  yBase: number,
  z: number,
  w: number,
  d: number,
  ridgeH: number,
  mat: THREE.Material,
  yaw: number,
): void {
  // Pyramid/hip roof approximated with rotated 4-sided cone stretched to footprint
  const cone = new THREE.Mesh(new THREE.ConeGeometry(Math.SQRT1_2, ridgeH, 4), mat);
  cone.scale.set(w + 1.0, 1, d + 1.0);
  cone.rotation.y = Math.PI * 0.25 + yaw;
  cone.position.set(x, yBase + ridgeH * 0.5, z);
  cone.castShadow = true;
  cone.receiveShadow = true;
  parent.add(cone);
}

function buildSuburbanHouse(chunk: CityChunk, spec: HouseSpec, groundY: number): void {
  const wallMat = materialFor(spec.wallColor, { roughness: 0.86, metalness: 0.02, family: "plaster", seed: 511, repeat: 2 });
  const roofMat = materialFor(spec.roofColor, { roughness: 0.76, metalness: 0.06, family: "roof-tile", seed: 512, repeat: 3 });
  const lawnMat = materialFor(0x4a783d, { roughness: 0.94, family: "grass", seed: 513, repeat: 4 });

  addDetailedHouse(chunk, {
    x: spec.x,
    yBase: groundY,
    z: spec.z,
    w: spec.w,
    d: spec.d,
    h: spec.h,
    wallMat,
    roofMat,
    lawnMat,
    yaw: spec.yaw,
    seed: Math.round(Math.abs(spec.x)),
    district: "old_quarter",
  });

  addLodBox(chunk, spec.x, groundY, spec.z, spec.w, spec.h + 2.2, spec.d, spec.wallColor, spec.yaw);
}

/** Mirror Central Park: Reflection Pond, Pedestrian Bridge, Gazebo & Tennis Courts (`x=-115, z=395`) */
function buildMirrorCentralPark(chunk: CityChunk, groundY: number): void {
  const x = -115;
  const z = 395;
  const turfMat = materialFor(0x3d7038, { roughness: 0.95, family: "grass", seed: 521, repeat: 18 });
  const pathMat = materialFor(0xc2b8a3, { roughness: 0.88, family: "stone", seed: 522, repeat: 12 });
  const pondMat = new THREE.MeshStandardMaterial({
    color: 0x1e6b8a,
    roughness: 0.09,
    metalness: 0.72,
    emissive: 0x0b2c3d,
    emissiveIntensity: 0.28,
  });
  const woodMat = materialFor(0x7c5338, { roughness: 0.82, family: "wood", seed: 523, repeat: 3 });
  const stoneMat = materialFor(0xd6d3cd, { roughness: 0.8, family: "stone", seed: 524, repeat: 4 });
  const courtMat = materialFor(0x25634b, { roughness: 0.86, family: "concrete", seed: 525, repeat: 6 });
  const lineMat = new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.65 });
  const darkMetal = materialFor(0x262c34, { roughness: 0.45, metalness: 0.75, family: "metal", seed: 526 });

  // Park green base
  addSolidBox(chunk, x, groundY - 0.12, z, 118, 0.24, 112, turfMat, 0, "dirt", false, true);

  // Reflection Pond + Stone Rim + Wooden Footbridge
  addSolidBox(chunk, x - 14, groundY - 0.04, z, 46, 0.18, 28, stoneMat, 0, "concrete", false, true);
  addVisualBox(chunk.nearGroup, x - 14, groundY + 0.12, z, 42, 0.08, 24, pondMat, 0, false, true);
  // Central fountain stone pedestal + 2-tier basin & brass finial
  addSolidBox(chunk, x - 14, groundY + 0.12, z, 3.2, 1.4, 3.2, stoneMat, 0, "concrete");
  const fTier = new THREE.Mesh(new THREE.CylinderGeometry(2.4, 2.0, 0.35, 14), stoneMat);
  fTier.position.set(x - 14, groundY + 1.65, z);
  chunk.nearGroup.add(fTier);
  addVisualBox(chunk.nearGroup, x - 14, groundY + 2.3, z, 0.65, 1.1, 0.65, stoneMat, 0);
  // Wooden footbridge spanning pond center-east with side handrails
  addSolidBox(chunk, x + 1, groundY + 0.25, z, 4.5, 0.45, 26, woodMat, 0, "wood");
  addVisualBox(chunk.nearGroup, x - 1.1, groundY + 1.15, z, 0.14, 0.14, 26, woodMat, 0);
  addVisualBox(chunk.nearGroup, x + 3.1, groundY + 1.15, z, 0.14, 0.14, 26, woodMat, 0);

  // Park Promenade Paths + Lakeside Benches & Bollard Lanterns
  addVisualBox(chunk.nearGroup, x, groundY + 0.09, z - 28, 96, 0.06, 4.5, pathMat, 0, false, true);
  addVisualBox(chunk.nearGroup, x, groundY + 0.09, z + 28, 96, 0.06, 4.5, pathMat, 0, false, true);
  const parkLampGlow = registerNightGlowMaterial(
    new THREE.MeshStandardMaterial({
      color: 0xffedd5,
      emissive: 0xfbbf24,
      emissiveIntensity: 0.25,
      roughness: 0.25,
    }),
    0.25,
    3.2,
  );
  for (const lx of [x - 36, x - 18, x, x + 18, x + 36]) {
    for (const lz of [z - 25.4, z + 25.4]) {
      addVisualBox(chunk.nearGroup, lx, groundY + 0.55, lz, 0.28, 0.85, 0.28, darkMetal, 0);
      addVisualBox(chunk.nearGroup, lx, groundY + 1.04, lz, 0.26, 0.22, 0.26, parkLampGlow, 0);
    }
  }
  for (const bx of [x - 28, x - 14, x, x + 16]) {
    addVisualBox(chunk.nearGroup, bx, groundY + 0.45, z - 17, 2.0, 0.1, 0.55, woodMat, 0);
    addVisualBox(chunk.nearGroup, bx, groundY + 0.72, z - 17.24, 2.0, 0.4, 0.08, woodMat, 0);
    addVisualBox(chunk.nearGroup, bx - 0.8, groundY + 0.12, z - 17, 0.1, 0.34, 0.48, darkMetal, 0);
    addVisualBox(chunk.nearGroup, bx + 0.8, groundY + 0.12, z - 17, 0.1, 0.34, 0.48, darkMetal, 0);
  }

  // Classical Park Gazebo Pavilion (`x - 42, z - 28`)
  const gx = x - 40;
  const gz = z - 28;
  addSolidBox(chunk, gx, groundY, gz, 9, 0.5, 9, stoneMat, 0, "concrete");
  for (const px of [-3.6, 3.6]) {
    for (const pz of [-3.6, 3.6]) {
      addSolidBox(chunk, gx + px, groundY + 0.5, gz + pz, 0.5, 3.6, 0.5, stoneMat, 0, "concrete");
    }
  }
  addGableRoof(chunk.nearGroup, gx, groundY + 4.1, gz, 9.5, 9.5, 2.8, woodMat, 0);
  addVisualBox(chunk.nearGroup, gx, groundY + 7.2, gz, 0.55, 0.85, 0.55, darkMetal, 0);

  // Twin Tennis Courts (`x + 32, z + 8`) + Umpire Chair & Perimeter Fence Posts
  const tx = x + 32;
  const tz = z + 8;
  addSolidBox(chunk, tx, groundY - 0.02, tz, 28, 0.2, 34, courtMat, 0, "concrete", false, true);
  addVisualBox(chunk.nearGroup, tx, groundY + 0.16, tz, 22, 0.04, 0.22, lineMat, 0, false, false);
  addVisualBox(chunk.nearGroup, tx, groundY + 0.16, tz - 12, 22, 0.04, 0.22, lineMat, 0, false, false);
  addVisualBox(chunk.nearGroup, tx, groundY + 0.16, tz + 12, 22, 0.04, 0.22, lineMat, 0, false, false);
  // Center net + elevated umpire chair + perimeter fence posts
  addSolidBox(chunk, tx, groundY + 0.16, tz, 22, 0.9, 0.14, trimMatHelper(), 0, "metal");
  addVisualBox(chunk.nearGroup, tx - 12.2, groundY + 1.1, tz, 0.9, 2.0, 0.9, darkMetal, 0);
  for (const fx of [tx - 13.6, tx + 13.6]) {
    for (let fz = tz - 16; fz <= tz + 16; fz += 8) {
      addVisualBox(chunk.nearGroup, fx, groundY + 1.5, fz, 0.16, 3.0, 0.16, darkMetal, 0);
    }
  }

  addLodBox(chunk, gx, groundY, gz, 9, 6.5, 9, 0x8b7355);
}

function trimMatHelper(): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color: 0xe5e7eb, roughness: 0.6 });
}

/** Old Quarter Historic Brick Townhouses & Corner Bistro (`x=-170, z=180`) */
function buildOldQuarterTownhouses(chunk: CityChunk, groundY: number): void {
  const x = -170;
  const z = 180;
  const brickRed = createFacadeMaterial("brick_red", 4, 3);
  const brickTan = createFacadeMaterial("brick_tan", 4, 3);
  const stucco = createFacadeMaterial("stucco_warm", 4, 3);
  const roofDark = materialFor(0x3b4048, { roughness: 0.76, family: "roof-tile", seed: 530 });
  const awningGreen = materialFor(0x166534, { roughness: 0.78, family: "fabric", seed: 531 });
  const awningRed = materialFor(0x991b1b, { roughness: 0.78, family: "fabric", seed: 532 });

  const specs = [
    { dx: -26, w: 12, h: 10.5, d: 14, mat: brickRed, lod: 0x824438, awning: awningGreen, tower: true },
    { dx: -13, w: 12, h: 12.0, d: 14, mat: brickTan, lod: 0x968166, awning: awningRed, tower: false },
    { dx: 0, w: 12, h: 10.5, d: 14, mat: stucco, lod: 0xc2aa8a, awning: awningRed, tower: false },
    { dx: 13, w: 12, h: 11.5, d: 14, mat: brickRed, lod: 0x824438, awning: awningGreen, tower: true },
    { dx: 26, w: 12, h: 9.8, d: 14, mat: brickTan, lod: 0x968166, awning: awningGreen, tower: false },
  ];

  for (const s of specs) {
    addPavedPlazaApron(chunk.nearGroup, x + s.dx, groundY, z, s.w, s.d, 0);
    addSolidBox(chunk, x + s.dx, groundY, z, s.w, s.h, s.d, s.mat, 0, "concrete");
    addSolidBox(chunk, x + s.dx, groundY + s.h, z, s.w + 0.6, 0.7, s.d + 0.6, roofDark, 0, "concrete");
    addFacadeRelief(chunk.nearGroup, x + s.dx, groundY, z, s.w, s.h, s.d, 0, { balconies: true });
    addStorefrontBay(chunk.nearGroup, x + s.dx, groundY, z, s.w, s.d, 0, s.awning);
    addRooftopDetails(chunk.nearGroup, x + s.dx, groundY + s.h + 0.7, z, s.w, s.d, 0, { waterTower: s.tower });
    addLodBox(chunk, x + s.dx, groundY, z, s.w, s.h + 0.8, s.d, s.lod);
  }
}

/** Neighborhood Elementary School & Playground (`x=-268, z=415`) */
function buildNeighborhoodSchool(chunk: CityChunk, groundY: number): void {
  const x = -268;
  const z = 415;
  const brickMat = createFacadeMaterial("brick_tan", 5, 2);
  const roofMat = new THREE.MeshStandardMaterial({ color: 0x9e3b24, roughness: 0.76 });
  const barkMat = new THREE.MeshStandardMaterial({ color: 0x855e3c, roughness: 0.94 });
  const playRed = new THREE.MeshStandardMaterial({ color: 0xef4444, roughness: 0.45 });
  const playBlue = new THREE.MeshStandardMaterial({ color: 0x3b82f6, roughness: 0.45 });
  const playYellow = new THREE.MeshStandardMaterial({ color: 0xfacc15, roughness: 0.45 });

  // Single-story school + peaked roof + front awning
  addSolidBox(chunk, x, groundY, z - 8, 28, 6.2, 16, brickMat, 0, "concrete");
  addGableRoof(chunk.nearGroup, x, groundY + 6.2, z - 8, 28, 16, 3.2, roofMat, 0);
  addStorefrontBay(chunk.nearGroup, x, groundY, z - 8, 28, 16, 0, roofMat);

  // Playground mulch pad + jungle gym structures + Swing Set & Basketball Half-Court
  addSolidBox(chunk, x, groundY - 0.1, z + 14, 24, 0.22, 18, barkMat, 0, "dirt", false, true);
  addSolidBox(chunk, x - 5, groundY, z + 14, 3.5, 2.8, 3.5, playRed, 0, "metal");
  addSolidBox(chunk, x + 2, groundY, z + 14, 3.5, 2.8, 3.5, playBlue, 0, "metal");
  addSolidBox(chunk, x - 1.5, groundY + 1.8, z + 14, 7.5, 0.4, 1.4, playYellow, 0, "metal");
  // Basketball hoop & backboard on east playground edge
  addSolidBox(chunk, x + 9.5, groundY, z + 14, 0.26, 3.6, 0.26, playBlue, 0, "metal");
  addVisualBox(chunk.nearGroup, x + 9.2, groundY + 3.4, z + 14, 0.14, 1.2, 1.8, new THREE.MeshStandardMaterial({ color: 0xf8fafc }), 0);

  addLodBox(chunk, x, groundY, z - 8, 28, 9, 16, 0x998468);
}

/** Community Library & Gas Station (`x=-385, z=255` & `x=-18, z=305`) */
function buildSuburbServices(chunk: CityChunk, groundY: number, mode: "library" | "gas"): void {
  if (mode === "library") {
    const x = -18;
    const z = 305;
    const stone = createFacadeMaterial("limestone", 5, 3);
    const roof = new THREE.MeshStandardMaterial({ color: 0x334155, roughness: 0.72 });
    const colMat = new THREE.MeshStandardMaterial({ color: 0xe7e1d4, roughness: 0.76 });
    addPavedPlazaApron(chunk.nearGroup, x, groundY, z, 32, 24, 0);
    addSolidBox(chunk, x, groundY, z, 26, 8.5, 18, stone, 0, "concrete");
    addGableRoof(chunk.nearGroup, x, groundY + 8.5, z, 26, 18, 3.4, roof, 0);
    // Classical 4-column front portico + entry stairs
    for (const cx of [-6, -2, 2, 6]) {
      const col = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.44, 7.4, 12), colMat);
      col.position.set(x + cx, groundY + 3.7, z + 10.6);
      col.castShadow = true;
      chunk.nearGroup.add(col);
    }
    addVisualBox(chunk.nearGroup, x, groundY + 7.6, z + 10.2, 15, 0.9, 2.8, colMat, 0);
    addVisualBox(chunk.nearGroup, x, groundY + 0.2, z + 10.8, 12, 0.38, 2.2, colMat, 0);
    addLodBox(chunk, x, groundY, z, 26, 11, 18, 0xb5ab98);
  } else {
    const x = -385;
    const z = 255;
    const padMat = new THREE.MeshStandardMaterial({ color: 0x3b4046, roughness: 0.88 });
    const storeMat = createFacadeMaterial("concrete_mod", 4, 2);
    const canopyMat = new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.5, metalness: 0.15 });
    const stripeMat = registerNightGlowMaterial(
      new THREE.MeshStandardMaterial({
        color: 0x0ea5e9,
        emissive: 0x0284c7,
        emissiveIntensity: 0.35,
        roughness: 0.35,
      }),
      0.35,
      2.8,
    );
    const pumpMat = new THREE.MeshStandardMaterial({ color: 0xdc2626, roughness: 0.45 });

    addSolidBox(chunk, x, groundY - 0.1, z, 32, 0.24, 24, padMat, 0, "concrete", false, true);
    addSolidBox(chunk, x - 8, groundY, z - 6, 14, 4.8, 9, storeMat, 0, "concrete");
    addStorefrontBay(chunk.nearGroup, x - 8, groundY, z - 6, 14, 9, 0, stripeMat);
    // Fuel canopy, lit price totem sign & protective yellow bollards
    addSolidBox(chunk, x + 6, groundY + 4.4, z + 3, 14, 0.6, 10, canopyMat, 0, "metal");
    addVisualBox(chunk.nearGroup, x + 6, groundY + 4.5, z + 8.1, 14.2, 0.4, 0.2, stripeMat, 0);
    addVisualBox(chunk.nearGroup, x + 6, groundY + 4.32, z + 3, 10.5, 0.1, 0.6, canopyMat, 0);
    addSolidBox(chunk, x - 14, groundY, z + 9, 1.4, 6.2, 0.6, canopyMat, 0, "metal");
    addVisualBox(chunk.nearGroup, x - 14, groundY + 4.2, z + 9, 1.5, 2.2, 0.72, stripeMat, 0);
    const guardBollard = new THREE.MeshStandardMaterial({ color: 0xfacc15, roughness: 0.45 });
    for (const px of [x + 2, x + 10]) {
      addSolidBox(chunk, px, groundY, z + 3, 0.6, 4.4, 0.6, canopyMat, 0, "metal");
      addSolidBox(chunk, px + 2, groundY, z + 3, 0.9, 1.5, 0.8, pumpMat, 0, "metal");
      addVisualBox(chunk.nearGroup, px + 2, groundY + 0.1, z + 4.1, 0.18, 0.9, 0.18, guardBollard, 0);
      addVisualBox(chunk.nearGroup, px + 2, groundY + 0.1, z + 1.9, 0.18, 0.9, 0.18, guardBollard, 0);
    }
    attachGlbToGroup(chunk.nearGroup, "gas_can.glb", x + 1, groundY + 0.14, z + 3.8, { axis: "y", targetMeters: 0.72, yaw: 0.4 });
    attachGlbToGroup(chunk.nearGroup, "trash_bin.glb", x - 1.5, groundY + 0.14, z - 1.2, { axis: "y", targetMeters: 0.95 });
    attachGlbToGroup(chunk.nearGroup, "traffic_cone.glb", x + 13.4, groundY + 0.14, z + 7.2, { axis: "y", targetMeters: 0.65 });
    addLodBox(chunk, x, groundY, z, 28, 5.5, 20, 0xd1d5db);
  }
}

/**
 * Registers Phase 4 Old Quarter, Residential Suburbs & Central Park onto the chunk dispatcher.
 */
export function registerOldQuarterDistrict(
  dispatcher: CityChunkDispatcher,
  roads: RoadNetwork,
  heightSystem?: WorldHeightSystem,
  worldMin = -1200,
  chunkSize = 160,
): void {
  // 0. Player's Personal Safehouse Residence + 2-Car Garage + Pool Patio
  dispatcher.registerAtPoint(SAFEHOUSE_ORIGIN.x, SAFEHOUSE_ORIGIN.z, worldMin, chunkSize, (chunk, terrainAt) => {
    if (heightSystem) {
      buildPlayerSafehouse(chunk, terrainAt(SAFEHOUSE_ORIGIN.x, SAFEHOUSE_ORIGIN.z), heightSystem);
    }
  });

  // 1. Suburban single-family homes hugging Mirror Park Crescent
  for (const home of SUBURBAN_HOMES) {
    const clearR = Math.hypot(home.w, home.d) * 0.5 + 3.0;
    if (!isFootprintClearOfRoads(roads, home.x, home.z, clearR)) continue;
    dispatcher.registerAtPoint(home.x, home.z, worldMin, chunkSize, (chunk, terrainAt) => {
      buildSuburbanHouse(chunk, home, terrainAt(home.x, home.z));
    });
  }

  // 2. Mirror Central Park, Pond, Gazebo & Tennis Courts
  dispatcher.registerAtPoint(-115, 395, worldMin, chunkSize, (chunk, terrainAt) => {
    buildMirrorCentralPark(chunk, terrainAt(-115, 395));
  });

  // 3. Old Quarter Brick Townhouses & Shops
  dispatcher.registerAtPoint(-170, 180, worldMin, chunkSize, (chunk, terrainAt) => {
    buildOldQuarterTownhouses(chunk, terrainAt(-170, 180));
  });

  // 4. Neighborhood Elementary School & Playground
  dispatcher.registerAtPoint(-268, 415, worldMin, chunkSize, (chunk, terrainAt) => {
    buildNeighborhoodSchool(chunk, terrainAt(-268, 415));
  });

  // 5. Community Library & Neighborhood Gas Station
  dispatcher.registerAtPoint(-18, 305, worldMin, chunkSize, (chunk, terrainAt) => {
    buildSuburbServices(chunk, terrainAt(-18, 305), "library");
  });
  dispatcher.registerAtPoint(-385, 255, worldMin, chunkSize, (chunk, terrainAt) => {
    buildSuburbServices(chunk, terrainAt(-385, 255), "gas");
  });
}

export const OLD_QUARTER_LANDMARKS = [
  { id: "player_safehouse", name: "Player Safehouse (420 Crescent)", x: SAFEHOUSE_ORIGIN.x, z: SAFEHOUSE_ORIGIN.z },
  { id: "mirror_park", name: "Mirror Central Park & Pond", x: -115, z: 395 },
  { id: "old_townhouses", name: "Old Quarter Brick Townhouses", x: -170, z: 180 },
  { id: "elem_school", name: "Mirror Park Elementary & Playground", x: -268, z: 415 },
  { id: "community_lib", name: "Old Quarter Community Library", x: -18, z: 305 },
  { id: "suburb_gas", name: "Crescent Service Station", x: -385, z: 255 },
];
