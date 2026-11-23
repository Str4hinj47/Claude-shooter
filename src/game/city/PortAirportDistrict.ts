import * as THREE from "three";
import type { CityChunk } from "./ChunkStreamer";
import type { RoadNetwork } from "./RoadNetwork";
import {
  CityChunkDispatcher,
  addLodBox,
  addSolidBox,
  addVisualBox,
  createFacadeMaterial,
  isFootprintClearOfRoads,
} from "./CityBuildingKit";

/** Eastgate Seaport Container Terminal, Gantry Cranes & Cargo Ship (`x=635, z=485`) */
function buildSeaportTerminal(chunk: CityChunk, groundY: number): void {
  const x = 635;
  const z = 472;
  const deckMat = new THREE.MeshStandardMaterial({ color: 0x565c64, roughness: 0.88 });
  const craneRed = new THREE.MeshStandardMaterial({ color: 0xc83a2b, roughness: 0.52, metalness: 0.35 });
  const steelMat = new THREE.MeshStandardMaterial({ color: 0x383e46, roughness: 0.55, metalness: 0.45 });
  const hullMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.68, metalness: 0.25 });
  const deckShip = new THREE.MeshStandardMaterial({ color: 0x7c2d12, roughness: 0.72 });
  const whiteMat = new THREE.MeshStandardMaterial({ color: 0xf1f5f9, roughness: 0.65 });

  const containerColors = [0xb91c1c, 0x1d4ed8, 0x15803d, 0xb45309, 0x0f766e];
  const containerMats = containerColors.map((c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.7, metalness: 0.25 }));

  // Concrete port quay apron
  addSolidBox(chunk, x, groundY - 0.1, z - 16, 150, 0.25, 44, deckMat, 0, "concrete", false, true);

  // Two Ship-to-Shore Gantry Cranes along harbor edge (`z = 486`)
  for (const cx of [x - 36, x + 28]) {
    for (const dx of [-4.5, 4.5]) {
      for (const dz of [-4.5, 4.5]) {
        addSolidBox(chunk, cx + dx, groundY, z + 10 + dz, 0.9, 26, 0.9, craneRed, 0, "metal");
      }
    }
    // Boom cantilever reaching South over cargo vessel
    addSolidBox(chunk, cx, groundY + 22, z + 22, 7.5, 1.8, 42, craneRed, 0, "metal");
    addSolidBox(chunk, cx, groundY + 26, z + 10, 8.5, 1.4, 9.5, craneRed, 0, "metal");
    addLodBox(chunk, cx, groundY, z + 10, 10, 28, 12, 0xc83a2b);
  }

  // Stacked shipping containers
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 5; col++) {
      const mat = containerMats[(row * 5 + col) % containerMats.length];
      const cx = x - 52 + col * 14;
      const cz = z - 20 + row * 7.5;
      addSolidBox(chunk, cx, groundY, cz, 12, 2.7, 2.8, mat, 0, "metal");
      if ((row + col) % 2 === 0) {
        addSolidBox(chunk, cx, groundY + 2.7, cz, 12, 2.7, 2.8, containerMats[(row + col + 2) % containerMats.length], 0, "metal");
      }
    }
  }

  // Moored Container Ship in Harbor Basin (`z = 528`)
  addSolidBox(chunk, x - 4, 0.0, 526, 92, 6.2, 18, hullMat, 0, "metal");
  addSolidBox(chunk, x - 4, 6.2, 526, 86, 0.4, 16, deckShip, 0, "metal");
  addSolidBox(chunk, x - 38, 6.6, 526, 12, 11.5, 14, whiteMat, 0, "metal");
  for (let c = 0; c < 4; c++) {
    addSolidBox(chunk, x - 12 + c * 14, 6.6, 526, 11.5, 5.2, 10, containerMats[c % containerMats.length], 0, "metal");
  }
  addLodBox(chunk, x - 4, 0, 526, 92, 16, 18, 0x334155);
  void steelMat;
}

/** Westgate Power Plant & Twin Smokestacks (`x=645, z=-185`) */
function buildPowerPlant(chunk: CityChunk, groundY: number): void {
  const x = 645;
  const z = -185;
  const concMat = createFacadeMaterial("concrete_mod", 6, 4);
  const stackWhite = new THREE.MeshStandardMaterial({ color: 0xe2e8f0, roughness: 0.72 });
  const stackRed = new THREE.MeshStandardMaterial({ color: 0xdc2626, roughness: 0.65 });
  const steel = new THREE.MeshStandardMaterial({ color: 0x475569, roughness: 0.6, metalness: 0.4 });

  addSolidBox(chunk, x, groundY, z, 38, 16, 28, concMat, 0, "concrete");
  addSolidBox(chunk, x - 26, groundY, z, 12, 9, 22, steel, 0, "metal");

  // Twin tall smokestacks with red aviation bands
  for (const sz of [z - 10, z + 10]) {
    const stack = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 3.2, 40, 14), stackWhite);
    stack.position.set(x + 25, groundY + 20, sz);
    stack.castShadow = true;
    chunk.nearGroup.add(stack);

    const band = new THREE.Mesh(new THREE.CylinderGeometry(2.32, 2.48, 5, 14), stackRed);
    band.position.set(x + 25, groundY + 36, sz);
    chunk.nearGroup.add(band);

    addLodBox(chunk, x + 25, groundY, sz, 6, 40, 6, 0xdbe2ea);
  }
  addLodBox(chunk, x, groundY, z, 38, 16, 28, 0x7c828a);
}

/** Refinery Storage Tank Farm & Freight Warehouses (`x=645, z=115`) */
function buildIndustrialWarehousesAndTanks(chunk: CityChunk, groundY: number): void {
  const x = 645;
  const z = 115;
  const whMat = createFacadeMaterial("concrete_mod", 7, 3);
  const tankMat = new THREE.MeshStandardMaterial({ color: 0xcbd5e1, roughness: 0.42, metalness: 0.55 });
  const trimMat = new THREE.MeshStandardMaterial({ color: 0x334155, roughness: 0.7 });

  addSolidBox(chunk, x - 16, groundY, z - 16, 44, 11, 24, whMat, 0, "concrete");
  addSolidBox(chunk, x - 16, groundY, z + 20, 44, 11, 24, whMat, 0, "concrete");
  addSolidBox(chunk, x - 16, groundY + 11, z - 16, 45, 0.7, 25, trimMat, 0, "metal");
  addSolidBox(chunk, x - 16, groundY + 11, z + 20, 45, 0.7, 25, trimMat, 0, "metal");

  for (const tx of [x + 22, x + 38]) {
    for (const tz of [z - 12, z + 12]) {
      const tank = new THREE.Mesh(new THREE.CylinderGeometry(6.5, 6.5, 11.5, 16), tankMat);
      tank.position.set(tx, groundY + 5.75, tz);
      tank.castShadow = true;
      tank.receiveShadow = true;
      chunk.nearGroup.add(tank);
      chunk.colliders.push(tank);
    }
  }
  addLodBox(chunk, x - 16, groundY, z + 2, 44, 11.5, 60, 0x858b94);
}

/** Eastside Freight Rail Yard (`x=845, z=-195`) */
function buildRailYard(chunk: CityChunk, groundY: number): void {
  const x = 845;
  const z = -195;
  const railMat = new THREE.MeshStandardMaterial({ color: 0x52525b, roughness: 0.5, metalness: 0.65 });
  const depotMat = createFacadeMaterial("brick_tan", 5, 2);
  const carColors = [0x991b1b, 0x1e40af, 0xb45309, 0x166534];

  addSolidBox(chunk, x - 20, groundY, z, 18, 8.5, 32, depotMat, 0, "concrete");
  for (let t = 0; t < 3; t++) {
    const rx = x + t * 8;
    addVisualBox(chunk.nearGroup, rx, groundY + 0.08, z, 1.4, 0.14, 96, railMat, 0, false, true);
    for (let c = -1; c <= 1; c++) {
      const carMat = new THREE.MeshStandardMaterial({ color: carColors[(t + c + 4) % carColors.length], roughness: 0.68 });
      addSolidBox(chunk, rx, groundY + 0.16, z + c * 22, 3.0, 3.6, 16, carMat, 0, "metal");
    }
  }
  addLodBox(chunk, x - 20, groundY, z, 18, 9, 32, 0x998468);
}

/** Westgate International Airport Terminal & 46m ATC Tower (`x=-125, z=935`) */
function buildAirportTerminalAndTower(chunk: CityChunk, groundY: number): void {
  const x = -125;
  const z = 935;
  const glass = createFacadeMaterial("glass_teal", 10, 3);
  const alum = new THREE.MeshStandardMaterial({ color: 0xdbe2ea, roughness: 0.42, metalness: 0.52 });
  const darkMetal = new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.55, metalness: 0.45 });
  const beaconMat = new THREE.MeshStandardMaterial({
    color: 0x22d3ee,
    emissive: 0x06b6d4,
    emissiveIntensity: 1.9,
    roughness: 0.3,
  });

  // Main Passenger Terminal concourse + vaulted roof
  addSolidBox(chunk, x, groundY, z, 74, 12.5, 22, glass, 0, "concrete");
  addSolidBox(chunk, x, groundY + 12.5, z, 78, 1.4, 26, alum, 0, "metal");
  // Departure canopy facing North toward terminal loop
  addSolidBox(chunk, x, groundY + 4.8, z - 14.5, 58, 0.6, 7.5, alum, 0, "metal");

  // 46m Air Traffic Control Tower (`x + 68, z`)
  const tx = x + 68;
  addSolidBox(chunk, tx, groundY, z, 7.5, 36.0, 7.5, alum, 0, "concrete");
  addSolidBox(chunk, tx, groundY + 36.0, z, 12.5, 4.8, 12.5, glass, 0, "metal");
  addSolidBox(chunk, tx, groundY + 40.8, z, 13.5, 1.2, 13.5, darkMetal, 0, "metal");
  addVisualBox(chunk.nearGroup, tx, groundY + 42.0, z, 1.0, 4.0, 1.0, beaconMat, 0);

  addLodBox(chunk, x, groundY, z, 76, 14, 24, 0x94a3b8);
  addLodBox(chunk, tx, groundY, z, 11, 43, 11, 0xdbe2ea);
}

/** Airport Runway 09/27, Twin Hangars & Parked Jet (`x=240, z=845`) */
function buildAirportRunwayAndHangars(chunk: CityChunk, groundY: number): void {
  const x = 240;
  const z = 845;
  const tarmac = new THREE.MeshStandardMaterial({ color: 0x272a30, roughness: 0.9 });
  const paint = new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.65 });
  const hangarMat = new THREE.MeshStandardMaterial({ color: 0x94a3b8, roughness: 0.55, metalness: 0.4 });
  const jetWhite = new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.38, metalness: 0.2 });
  const jetBlue = new THREE.MeshStandardMaterial({ color: 0x1d4ed8, roughness: 0.45 });

  // 310m East-West Runway deck
  addSolidBox(chunk, x, groundY - 0.08, z, 310, 0.22, 28, tarmac, 0, "concrete", false, true);
  // Centerline stripes + threshold bars
  for (let dx = -125; dx <= 125; dx += 18) {
    addVisualBox(chunk.nearGroup, x + dx, groundY + 0.14, z, 10, 0.04, 0.7, paint, 0, false, false);
  }
  for (const ex of [-146, 146]) {
    for (let kz = -9; kz <= 9; kz += 3.6) {
      addVisualBox(chunk.nearGroup, x + ex, groundY + 0.14, z + kz, 12, 0.04, 1.4, paint, 0, false, false);
    }
  }

  // Twin Aircraft Hangars north of runway (`z = 788`)
  for (const hx of [x - 55, x + 20]) {
    addSolidBox(chunk, hx, groundY, z - 56, 36, 13.5, 28, hangarMat, 0, "metal");
    addLodBox(chunk, hx, groundY, z - 56, 36, 14, 28, 0x94a3b8);
  }

  // Parked Commercial Jetliner on apron (`x + 85, z - 44`)
  const jx = x + 85;
  const jz = z - 44;
  const fuse = new THREE.Mesh(new THREE.CylinderGeometry(2.4, 2.4, 34, 14), jetWhite);
  fuse.rotation.z = Math.PI * 0.5;
  fuse.position.set(jx, groundY + 3.4, jz);
  fuse.castShadow = true;
  chunk.nearGroup.add(fuse);
  addVisualBox(chunk.nearGroup, jx, groundY + 3.0, jz, 7.5, 0.45, 32, jetWhite, 0);
  addVisualBox(chunk.nearGroup, jx - 14, groundY + 6.5, jz, 4.5, 6.2, 0.6, jetBlue, 0);
}

/** Westgate Bay Sports & Concert Arena (`x=-415, z=668`) */
function buildSportsArena(chunk: CityChunk, groundY: number): void {
  const x = -415;
  const z = 668;
  const concMat = createFacadeMaterial("concrete_mod", 10, 3);
  const roofMat = new THREE.MeshStandardMaterial({ color: 0xe2e8f0, roughness: 0.48, metalness: 0.25 });
  const pitchMat = new THREE.MeshStandardMaterial({ color: 0x2e7d32, roughness: 0.92 });
  const neonLed = new THREE.MeshStandardMaterial({
    color: 0x38bdf8,
    emissive: 0x0ea5e9,
    emissiveIntensity: 1.5,
    roughness: 0.3,
  });

  // Outer stadium bowl walls & upper illuminated fascia ring
  addSolidBox(chunk, x, groundY, z - 24, 68, 17, 14, concMat, 0, "concrete");
  addSolidBox(chunk, x, groundY, z + 24, 68, 17, 14, concMat, 0, "concrete");
  addSolidBox(chunk, x - 31, groundY, z, 14, 17, 46, concMat, 0, "concrete");
  addSolidBox(chunk, x + 31, groundY, z, 14, 17, 46, concMat, 0, "concrete");

  // Stadium roof canopy ring & cyan LED stripe
  addSolidBox(chunk, x, groundY + 17, z - 24, 72, 2.2, 16, roofMat, 0, "metal");
  addSolidBox(chunk, x, groundY + 17, z + 24, 72, 2.2, 16, roofMat, 0, "metal");
  addVisualBox(chunk.nearGroup, x, groundY + 15.5, z - 31.3, 68, 1.1, 0.4, neonLed, 0);
  addVisualBox(chunk.nearGroup, x, groundY + 15.5, z + 31.3, 68, 1.1, 0.4, neonLed, 0);

  // Interior green pitch
  addSolidBox(chunk, x, groundY - 0.1, z, 48, 0.25, 34, pitchMat, 0, "dirt", false, true);

  addLodBox(chunk, x, groundY, z, 72, 19, 60, 0x94a3b8);
}

/**
 * Registers Phase 7 East Industrial, Seaport Docks & South Airport/Arena onto the chunk dispatcher.
 */
export function registerPortAirportDistrict(
  dispatcher: CityChunkDispatcher,
  roads: RoadNetwork,
  worldMin = -1200,
  chunkSize = 160,
): void {
  // 1. Eastgate Seaport Container Terminal & Gantry Cranes
  dispatcher.registerAtPoint(635, 472, worldMin, chunkSize, (chunk, terrainAt) => {
    buildSeaportTerminal(chunk, terrainAt(635, 460));
  });

  // 2. Westgate Power Plant & Smokestacks
  if (isFootprintClearOfRoads(roads, 645, -185, 32)) {
    dispatcher.registerAtPoint(645, -185, worldMin, chunkSize, (chunk, terrainAt) => {
      buildPowerPlant(chunk, terrainAt(645, -185));
    });
  }

  // 3. Industrial Warehouses & Tank Farm
  if (isFootprintClearOfRoads(roads, 645, 115, 32)) {
    dispatcher.registerAtPoint(645, 115, worldMin, chunkSize, (chunk, terrainAt) => {
      buildIndustrialWarehousesAndTanks(chunk, terrainAt(645, 115));
    });
  }

  // 4. Eastside Freight Rail Yard
  if (isFootprintClearOfRoads(roads, 845, -195, 28)) {
    dispatcher.registerAtPoint(845, -195, worldMin, chunkSize, (chunk, terrainAt) => {
      buildRailYard(chunk, terrainAt(845, -195));
    });
  }

  // 5. Westgate International Airport Terminal & ATC Tower
  dispatcher.registerAtPoint(-125, 935, worldMin, chunkSize, (chunk, terrainAt) => {
    buildAirportTerminalAndTower(chunk, terrainAt(-125, 935));
  });

  // 6. Airport Runway 09/27 & Twin Hangars (split over chunks x=160..320)
  dispatcher.registerAtPoint(240, 845, worldMin, chunkSize, (chunk, terrainAt) => {
    buildAirportRunwayAndHangars(chunk, terrainAt(240, 845));
  });

  // 7. Westgate Bay Sports & Concert Arena
  if (isFootprintClearOfRoads(roads, -415, 668, 38)) {
    dispatcher.registerAtPoint(-415, 668, worldMin, chunkSize, (chunk, terrainAt) => {
      buildSportsArena(chunk, terrainAt(-415, 668));
    });
  }
}

export const PORT_AIRPORT_LANDMARKS = [
  { id: "seaport_terminal", name: "Eastgate Seaport & Gantry Cranes", x: 635, z: 472 },
  { id: "power_plant", name: "Westgate Power Plant & Stacks", x: 645, z: -185 },
  { id: "tank_farm", name: "Industrial Warehouses & Tank Farm", x: 645, z: 115 },
  { id: "rail_yard", name: "Eastside Freight Rail Yard", x: 845, z: -195 },
  { id: "airport_terminal", name: "Westgate Int'l Terminal & ATC", x: -125, z: 935 },
  { id: "airport_runway", name: "Runway 09/27 & Hangars", x: 240, z: 845 },
  { id: "sports_arena", name: "Westgate Sports & Concert Arena", x: -415, z: 668 },
];
