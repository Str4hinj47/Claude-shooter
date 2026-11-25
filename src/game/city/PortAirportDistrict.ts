import * as THREE from "three";
import { materialFor } from "../kit/surface";
import type { CityChunk } from "./ChunkStreamer";
import type { RoadNetwork } from "./RoadNetwork";
import {
  CityChunkDispatcher,
  addLodBox,
  addSolidBox,
  addVisualBox,
  createCorrugatedContainerMaterial,
  createFacadeMaterial,
  isFootprintClearOfRoads,
  registerNightGlowMaterial,
} from "./CityBuildingKit";
import { attachGlbToGroup } from "./PropModels";

/** Eastgate Seaport Container Terminal, Gantry Cranes & Cargo Ship (`x=635, z=485`) */
function buildSeaportTerminal(chunk: CityChunk, groundY: number): void {
  const x = 635;
  const z = 472;
  const deckMat = materialFor(0x565c64, { roughness: 0.86, family: "concrete", seed: 850, repeat: 14 });
  const craneRed = materialFor(0xc83a2b, { roughness: 0.48, metalness: 0.4, family: "metal", seed: 851 });
  const steelMat = materialFor(0x383e46, { roughness: 0.5, metalness: 0.55, family: "metal", seed: 852 });
  const hullMat = materialFor(0x1e293b, { roughness: 0.64, metalness: 0.3, family: "metal", seed: 853 });
  const deckShip = materialFor(0x7c2d12, { roughness: 0.72, family: "metal", seed: 854 });
  const whiteMat = materialFor(0xf1f5f9, { roughness: 0.65, family: "metal", seed: 855 });

  const containerColors = [0xb91c1c, 0x1d4ed8, 0x15803d, 0xb45309, 0x0f766e];
  const containerMats = containerColors.map((c) => createCorrugatedContainerMaterial(c));

  // Concrete port quay apron extending cleanly above shoreline slope under stacked containers & harbor-edge cranes
  const quayTop = Math.max(groundY + 0.65, 3.65);
  addSolidBox(chunk, x, quayTop - 1.4, z - 6, 150, 1.4, 68, deckMat, 0, "concrete", false, true);
  groundY = quayTop;
  // Harbor edge yellow mooring bollards along quay apron
  const bollardMat = new THREE.MeshStandardMaterial({ color: 0xeab308, roughness: 0.45, metalness: 0.25 });
  for (let bx = x - 62; bx <= x + 62; bx += 15.5) {
    addVisualBox(chunk.nearGroup, bx, groundY + 0.35, z + 26.8, 0.45, 0.7, 0.45, bollardMat, 0);
  }

  // Two Ship-to-Shore Gantry Cranes along harbor edge (`z = 486`)
  for (const cx of [x - 36, x + 28]) {
    for (const dx of [-4.5, 4.5]) {
      for (const dz of [-4.5, 4.5]) {
        addSolidBox(chunk, cx + dx, groundY, z + 10 + dz, 0.9, 26, 0.9, craneRed, 0, "metal");
      }
    }
    // Cross-beams, diagonal tie struts, operator cabin, trolley, steel cables & spreader beam
    addVisualBox(chunk.nearGroup, cx, groundY + 12.5, z + 5.5, 9.2, 0.7, 0.7, steelMat, 0);
    addVisualBox(chunk.nearGroup, cx, groundY + 12.5, z + 14.5, 9.2, 0.7, 0.7, steelMat, 0);
    addSolidBox(chunk, cx, groundY + 22, z + 22, 7.5, 1.8, 42, craneRed, 0, "metal");
    addSolidBox(chunk, cx, groundY + 26, z + 10, 8.5, 1.4, 9.5, craneRed, 0, "metal");
    addVisualBox(chunk.nearGroup, cx + 2.6, groundY + 20.2, z + 18, 2.2, 1.8, 2.8, whiteMat, 0);
    addVisualBox(chunk.nearGroup, cx, groundY + 21.4, z + 26, 4.2, 0.9, 4.2, steelMat, 0);
    // Hanging hoist cables + container spreader frame
    for (const sx of [-1.4, 1.4]) {
      addVisualBox(chunk.nearGroup, cx + sx, groundY + 14.5, z + 26, 0.12, 6.8, 0.12, steelMat, 0);
    }
    addVisualBox(chunk.nearGroup, cx, groundY + 14.2, z + 26, 4.4, 0.45, 2.4, craneRed, 0);
    addLodBox(chunk, cx, groundY, z + 10, 10, 28, 12, 0xc83a2b);
  }

  // Stacked shipping containers with corner posts & top stiffening ribs
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 5; col++) {
      const mat = containerMats[(row * 5 + col) % containerMats.length];
      const cx = x - 52 + col * 14;
      const cz = z - 20 + row * 7.5;
      addSolidBox(chunk, cx, groundY, cz, 12, 2.7, 2.8, mat, 0, "metal");
      addVisualBox(chunk.nearGroup, cx, groundY + 2.7, cz, 11.8, 0.12, 2.88, steelMat, 0);
      if ((row + col) % 2 === 0) {
        addSolidBox(chunk, cx, groundY + 2.7, cz, 12, 2.7, 2.8, containerMats[(row + col + 2) % containerMats.length], 0, "metal");
      }
    }
  }

  // Moored Container Ship in Harbor Basin (`z = 526`) with tapered bow prow, bridge wings & lifeboats
  addSolidBox(chunk, x - 4, 0.0, 526, 86, 6.2, 18, hullMat, 0, "metal");
  // Tapered ship bow prow (+X)
  const prow = new THREE.Mesh(new THREE.ConeGeometry(9.0, 16, 4), hullMat);
  prow.rotation.y = Math.PI * 0.25;
  prow.rotation.z = -Math.PI * 0.5;
  prow.scale.set(0.68, 1, 1.0);
  prow.position.set(x + 47, 3.1, 526);
  prow.castShadow = true;
  chunk.nearGroup.add(prow);
  addSolidBox(chunk, x - 4, 6.2, 526, 84, 0.4, 16, deckShip, 0, "metal");
  // Superstructure bridge block + wide bridge wings + windows + radar mast + orange lifeboats
  addSolidBox(chunk, x - 38, 6.6, 526, 12, 11.5, 14, whiteMat, 0, "metal");
  addVisualBox(chunk.nearGroup, x - 36, 15.8, 526, 13.6, 1.6, 19.6, whiteMat, 0);
  addVisualBox(chunk.nearGroup, x - 36, 16.0, 526, 13.8, 0.95, 19.8, hullMat, 0);
  addVisualBox(chunk.nearGroup, x - 41, 18.2, 526, 3.2, 4.2, 3.2, craneRed, 0);
  addVisualBox(chunk.nearGroup, x - 37, 19.6, 526, 0.35, 5.4, 0.35, steelMat, 0);
  addVisualBox(chunk.nearGroup, x - 37, 23.2, 526, 0.4, 0.5, 3.4, whiteMat, 0);
  for (const lz of [518.4, 533.6]) {
    addVisualBox(chunk.nearGroup, x - 38, 9.2, lz, 3.8, 1.3, 1.4, craneRed, 0);
  }
  for (let c = 0; c < 4; c++) {
    addSolidBox(chunk, x - 12 + c * 14, 6.6, 526, 11.5, 5.2, 10, containerMats[c % containerMats.length], 0, "metal");
    addSolidBox(chunk, x - 12 + c * 14, 11.8, 526, 11.5, 2.6, 7.2, containerMats[(c + 2) % containerMats.length], 0, "metal");
  }
  addLodBox(chunk, x - 4, 0, 526, 92, 16, 18, 0x334155);
  attachGlbToGroup(chunk.nearGroup, "cruise_ship.glb", x - 4, 0, 566, {
    axis: "z",
    targetMeters: 62,
    baseY: -0.6,
    yaw: Math.PI * 0.5,
  });
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
  // Electrical Substation Transformers, Cooling Radiators & High-Voltage Steel Gantry
  const insulMat = new THREE.MeshStandardMaterial({ color: 0xe2e8f0, roughness: 0.35 });
  for (const tz of [z - 16, z + 16]) {
    addSolidBox(chunk, x - 28, groundY, tz, 7.5, 4.2, 5.2, steel, 0, "metal");
    for (const bx of [-2.2, 0, 2.2]) {
      addVisualBox(chunk.nearGroup, x - 28 + bx, groundY + 4.9, tz, 0.32, 1.5, 0.32, insulMat, 0);
    }
  }
  addVisualBox(chunk.nearGroup, x - 34, groundY + 6.5, z - 16, 0.45, 13.0, 0.45, steel, 0);
  addVisualBox(chunk.nearGroup, x - 34, groundY + 6.5, z + 16, 0.45, 13.0, 0.45, steel, 0);
  addVisualBox(chunk.nearGroup, x - 34, groundY + 12.2, z, 0.4, 0.55, 34, steel, 0);

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
  // Warehouse roll-up freight doors facing East toward loading apron
  for (const wz of [z - 16, z + 20]) {
    for (const dz of [-7.5, 0, 7.5]) {
      addVisualBox(chunk.nearGroup, x + 6.1, groundY + 2.4, wz + dz, 0.25, 4.8, 4.4, trimMat, 0);
    }
  }

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
  // Overhead steel catwalk & pipeline manifold linking storage tanks
  addVisualBox(chunk.nearGroup, x + 30, groundY + 11.8, z - 12, 16, 0.25, 1.4, trimMat, 0);
  addVisualBox(chunk.nearGroup, x + 30, groundY + 11.8, z + 12, 16, 0.25, 1.4, trimMat, 0);
  addVisualBox(chunk.nearGroup, x + 22, groundY + 11.8, z, 1.4, 0.25, 24, trimMat, 0);
  addVisualBox(chunk.nearGroup, x + 38, groundY + 11.8, z, 1.4, 0.25, 24, trimMat, 0);
  addLodBox(chunk, x - 16, groundY, z + 2, 44, 11.5, 60, 0x858b94);
}

/** Eastside Freight Rail Yard (`x=845, z=-195`) */
function buildRailYard(chunk: CityChunk, groundY: number): void {
  const x = 845;
  const z = -195;
  const railMat = new THREE.MeshStandardMaterial({ color: 0x52525b, roughness: 0.5, metalness: 0.65 });
  const tieMat = new THREE.MeshStandardMaterial({ color: 0x4b382a, roughness: 0.9 });
  const headlightMat = new THREE.MeshStandardMaterial({ color: 0xfef08a, emissive: 0xfacc15, emissiveIntensity: 1.8 });
  const depotMat = createFacadeMaterial("brick_tan", 5, 2);
  const carColors = [0x991b1b, 0x1e40af, 0xb45309, 0x166534];

  addSolidBox(chunk, x - 20, groundY, z, 18, 8.5, 32, depotMat, 0, "concrete");
  // Overhead rail yard signal gantry
  addVisualBox(chunk.nearGroup, x - 3, groundY + 4.5, z - 36, 0.45, 9.0, 0.45, railMat, 0);
  addVisualBox(chunk.nearGroup, x + 21, groundY + 4.5, z - 36, 0.45, 9.0, 0.45, railMat, 0);
  addVisualBox(chunk.nearGroup, x + 9, groundY + 8.6, z - 36, 25, 0.5, 0.45, railMat, 0);
  for (let t = 0; t < 3; t++) {
    const rx = x + t * 8;
    addVisualBox(chunk.nearGroup, rx, groundY + 0.08, z, 1.4, 0.14, 96, railMat, 0, false, true);
    for (let tz = -42; tz <= 42; tz += 3.5) {
      addVisualBox(chunk.nearGroup, rx, groundY + 0.04, z + tz, 2.2, 0.06, 0.35, tieMat, 0, false, false);
    }
    for (let c = -1; c <= 1; c++) {
      const carMat = new THREE.MeshStandardMaterial({ color: carColors[(t + c + 4) % carColors.length], roughness: 0.68 });
      if (c === -1) {
        // Lead diesel-electric locomotive with cab, hood, exhaust stack & nose headlight
        addSolidBox(chunk, rx, groundY + 0.35, z + c * 22, 3.1, 2.4, 15, carMat, 0, "metal");
        addSolidBox(chunk, rx, groundY + 2.75, z + c * 22 - 4.5, 3.0, 1.55, 4.2, carMat, 0, "metal");
        addVisualBox(chunk.nearGroup, rx, groundY + 3.4, z + c * 22 - 6.65, 2.2, 0.75, 0.12, headlightMat, 0);
        addVisualBox(chunk.nearGroup, rx, groundY + 2.0, z + c * 22 - 7.55, 0.55, 0.55, 0.14, headlightMat, 0);
      } else {
        addSolidBox(chunk, rx, groundY + 0.16, z + c * 22, 3.0, 3.6, 16, carMat, 0, "metal");
      }
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
  const beaconMat = registerNightGlowMaterial(
    new THREE.MeshStandardMaterial({
      color: 0x22d3ee,
      emissive: 0x06b6d4,
      emissiveIntensity: 0.4,
      roughness: 0.3,
    }),
    0.4,
    3.6,
  );

  // Main Passenger Terminal concourse + vaulted roof + 3 Articulated Boarding Jetways
  addSolidBox(chunk, x, groundY, z, 74, 12.5, 22, glass, 0, "concrete");
  addSolidBox(chunk, x, groundY + 12.5, z, 78, 1.4, 26, alum, 0, "metal");
  // Departure canopy facing North toward terminal loop + 3 Articulated Boarding Jetways on South concourse apron
  addSolidBox(chunk, x, groundY + 4.8, z - 14.5, 58, 0.6, 7.5, alum, 0, "metal");
  for (const jx of [x - 22, x, x + 22]) {
    addVisualBox(chunk.nearGroup, jx, groundY + 4.4, z + 17.8, 2.8, 2.6, 13.5, alum, 0);
    addVisualBox(chunk.nearGroup, jx, groundY + 4.4, z + 24.4, 3.2, 2.9, 1.2, darkMetal, 0);
    addVisualBox(chunk.nearGroup, jx, groundY + 2.2, z + 23.2, 0.45, 4.4, 0.45, darkMetal, 0);
  }

  // 46m Air Traffic Control Tower (`x + 68, z`) + spherical radome & rotating radar bar
  const tx = x + 68;
  addSolidBox(chunk, tx, groundY, z, 7.5, 36.0, 7.5, alum, 0, "concrete");
  addVisualBox(chunk.nearGroup, tx, groundY + 34.8, z, 10.6, 1.2, 10.6, darkMetal, 0);
  addSolidBox(chunk, tx, groundY + 36.0, z, 12.5, 4.8, 12.5, glass, 0, "metal");
  addSolidBox(chunk, tx, groundY + 40.8, z, 13.5, 1.2, 13.5, darkMetal, 0, "metal");
  const radome = new THREE.Mesh(new THREE.SphereGeometry(2.1, 14, 10), alum);
  radome.position.set(tx - 3.6, groundY + 43.2, z);
  chunk.nearGroup.add(radome);
  addVisualBox(chunk.nearGroup, tx + 2.4, groundY + 42.0, z, 1.0, 4.0, 1.0, beaconMat, 0);
  addVisualBox(chunk.nearGroup, tx + 2.4, groundY + 45.6, z, 6.2, 0.85, 0.65, alum, 0.4);
  attachGlbToGroup(chunk.nearGroup, "antenna.glb", tx - 2.6, groundY + 41.4, z + 3.2, {
    axis: "y",
    targetMeters: 4.5,
  });

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
  // Centerline stripes + threshold bars + runway edge beacon lights
  const edgeLightMat = registerNightGlowMaterial(
    new THREE.MeshStandardMaterial({
      color: 0xfef3c7,
      emissive: 0xfbbf24,
      emissiveIntensity: 0.35,
      roughness: 0.25,
    }),
    0.35,
    3.8,
  );
  for (let dx = -125; dx <= 125; dx += 18) {
    addVisualBox(chunk.nearGroup, x + dx, groundY + 0.14, z, 10, 0.04, 0.7, paint, 0, false, false);
  }
  for (let lx = -140; lx <= 140; lx += 28) {
    addVisualBox(chunk.nearGroup, x + lx, groundY + 0.26, z - 13.4, 0.35, 0.24, 0.35, edgeLightMat, 0, false, false);
    addVisualBox(chunk.nearGroup, x + lx, groundY + 0.26, z + 13.4, 0.35, 0.24, 0.35, edgeLightMat, 0, false, false);
  }
  for (const ex of [-146, 146]) {
    for (let kz = -9; kz <= 9; kz += 3.6) {
      addVisualBox(chunk.nearGroup, x + ex, groundY + 0.14, z + kz, 12, 0.04, 1.4, paint, 0, false, false);
    }
  }
  // Runway threshold PAPI precision approach light bars + windsock mast
  const papiRed = registerNightGlowMaterial(
    new THREE.MeshStandardMaterial({ color: 0xef4444, emissive: 0xdc2626, emissiveIntensity: 0.6 }),
    0.6,
    3.8,
  );
  const papiWhite = registerNightGlowMaterial(
    new THREE.MeshStandardMaterial({ color: 0xf8fafc, emissive: 0xe2e8f0, emissiveIntensity: 0.5 }),
    0.5,
    3.4,
  );
  for (const px of [x - 157, x + 157]) {
    for (let k = 0; k < 4; k++) {
      addVisualBox(chunk.nearGroup, px, groundY + 0.35, z - 18 - k * 2.2, 0.55, 0.45, 0.55, k < 2 ? papiRed : papiWhite, 0);
    }
  }
  addVisualBox(chunk.nearGroup, x - 115, groundY + 3.2, z - 20, 0.14, 6.4, 0.14, hangarMat, 0);
  addVisualBox(chunk.nearGroup, x - 113.8, groundY + 6.1, z - 20, 2.2, 0.55, 0.55, papiRed, 0);

  // Twin Aircraft Hangars north of runway (`z = 788`) with barrel-vault arched roof & sliding bay doors
  const doorMat = new THREE.MeshStandardMaterial({ color: 0x334155, roughness: 0.6, metalness: 0.4 });
  for (const hx of [x - 55, x + 20]) {
    addSolidBox(chunk, hx, groundY, z - 56, 36, 11.5, 28, hangarMat, 0, "metal");
    const arch = new THREE.Mesh(
      new THREE.CylinderGeometry(14, 14, 36, 16, 1, false, 0, Math.PI),
      hangarMat,
    );
    arch.rotation.z = Math.PI * 0.5;
    arch.position.set(hx, groundY + 11.5, z - 56);
    arch.castShadow = true;
    chunk.nearGroup.add(arch);
    addVisualBox(chunk.nearGroup, hx, groundY + 0.1, z - 41.8, 28, 9.8, 0.35, doorMat, 0);
    addLodBox(chunk, hx, groundY, z - 56, 36, 16, 28, 0x94a3b8);
  }

  // Parked Commercial Jetliner on apron (`x + 85, z - 44`) — upgraded in browser to `airliner_737.glb` + `delivery.glb` ground truck
  const jx = x + 85;
  const jz = z - 44;
  const parkedJetFallback = new THREE.Group();
  const fuse = new THREE.Mesh(new THREE.CylinderGeometry(2.35, 2.35, 34, 16), jetWhite);
  fuse.rotation.z = Math.PI * 0.5;
  fuse.position.set(jx, groundY + 3.4, jz);
  fuse.castShadow = true;
  parkedJetFallback.add(fuse);
  const nose = new THREE.Mesh(new THREE.ConeGeometry(2.35, 6.5, 16), jetWhite);
  nose.rotation.z = -Math.PI * 0.5;
  nose.position.set(jx + 20.2, groundY + 3.4, jz);
  parkedJetFallback.add(nose);
  addVisualBox(parkedJetFallback, jx + 17.5, groundY + 4.3, jz, 2.4, 0.7, 2.2, doorMat, 0);
  addVisualBox(parkedJetFallback, jx + 2, groundY + 3.0, jz, 7.2, 0.42, 32, jetWhite, 0);
  for (const ez of [-7.5, 7.5]) {
    const eng = new THREE.Mesh(new THREE.CylinderGeometry(1.05, 0.95, 4.6, 12), doorMat);
    eng.rotation.z = Math.PI * 0.5;
    eng.position.set(jx + 3.8, groundY + 2.1, jz + ez);
    parkedJetFallback.add(eng);
  }
  addVisualBox(parkedJetFallback, jx - 14.5, groundY + 6.8, jz, 4.8, 6.8, 0.55, jetBlue, 0);
  addVisualBox(parkedJetFallback, jx - 15.0, groundY + 4.2, jz, 3.2, 0.35, 11.5, jetWhite, 0);
  chunk.nearGroup.add(parkedJetFallback);

  attachGlbToGroup(chunk.nearGroup, "airliner_737.glb", jx, groundY + 0.08, jz, {
    axis: "z",
    targetMeters: 38,
    yaw: Math.PI * 0.5,
    onAttached: () => {
      parkedJetFallback.visible = false;
    },
  });

  // Mobile boarding airstairs & ground service truck beside jet nose door
  addVisualBox(chunk.nearGroup, jx + 11.5, groundY + 1.65, jz - 4.5, 1.4, 3.3, 4.2, doorMat, 0);
  addVisualBox(chunk.nearGroup, jx + 11.5, groundY + 3.35, jz - 3.2, 1.4, 0.9, 1.6, jetWhite, 0);
  const fuelTruckFallback = addVisualBox(chunk.nearGroup, jx + 19.5, groundY + 1.15, jz + 9.2, 5.2, 2.1, 2.2, edgeLightMat, 0);
  attachGlbToGroup(chunk.nearGroup, "delivery.glb", jx + 19.5, groundY + 0.05, jz + 9.2, {
    axis: "z",
    targetMeters: 5.5,
    yaw: Math.PI * 0.5,
    onAttached: () => {
      fuelTruckFallback.visible = false;
    },
  });
}

/** Westgate Bay Sports & Concert Arena (`x=-415, z=668`) */
function buildSportsArena(chunk: CityChunk, groundY: number): void {
  const x = -415;
  const z = 668;
  const concMat = createFacadeMaterial("concrete_mod", 10, 3);
  const roofMat = new THREE.MeshStandardMaterial({ color: 0xe2e8f0, roughness: 0.48, metalness: 0.25 });
  const pitchMat = new THREE.MeshStandardMaterial({ color: 0x2e7d32, roughness: 0.92 });
  const neonLed = registerNightGlowMaterial(
    new THREE.MeshStandardMaterial({
      color: 0x38bdf8,
      emissive: 0x0ea5e9,
      emissiveIntensity: 0.35,
      roughness: 0.3,
    }),
    0.35,
    3.2,
  );

  // Outer stadium bowl walls & upper illuminated fascia ring
  addSolidBox(chunk, x, groundY, z - 24, 68, 17, 14, concMat, 0, "concrete");
  addSolidBox(chunk, x, groundY, z + 24, 68, 17, 14, concMat, 0, "concrete");
  addSolidBox(chunk, x - 31, groundY, z, 14, 17, 46, concMat, 0, "concrete");
  addSolidBox(chunk, x + 31, groundY, z, 14, 17, 46, concMat, 0, "concrete");

  // Stadium roof canopy ring, cyan LED stripe & overhead steel roof truss arches + floodlights
  addSolidBox(chunk, x, groundY + 17, z - 24, 72, 2.2, 16, roofMat, 0, "metal");
  addSolidBox(chunk, x, groundY + 17, z + 24, 72, 2.2, 16, roofMat, 0, "metal");
  addVisualBox(chunk.nearGroup, x, groundY + 15.5, z - 31.3, 68, 1.1, 0.4, neonLed, 0);
  addVisualBox(chunk.nearGroup, x, groundY + 15.5, z + 31.3, 68, 1.1, 0.4, neonLed, 0);
  for (let ax = -22; ax <= 22; ax += 11) {
    const truss = new THREE.Mesh(new THREE.TorusGeometry(24, 0.45, 6, 20, Math.PI), roofMat);
    truss.rotation.y = Math.PI * 0.5;
    truss.position.set(x + ax, groundY + 17.5, z);
    chunk.nearGroup.add(truss);
  }
  for (const [fx, fz] of [[x - 32, z - 28], [x + 32, z - 28], [x - 32, z + 28], [x + 32, z + 28]]) {
    addVisualBox(chunk.nearGroup, fx, groundY + 19.2, fz, 1.0, 5.5, 1.0, roofMat, 0);
    addVisualBox(chunk.nearGroup, fx, groundY + 24.5, fz, 4.2, 1.4, 1.2, neonLed, 0);
  }

  // Interior green pitch with white center line, center ring & goal boxes
  addSolidBox(chunk, x, groundY - 0.1, z, 48, 0.25, 34, pitchMat, 0, "dirt", false, true);
  const lineMat = new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.6 });
  addVisualBox(chunk.nearGroup, x, groundY + 0.16, z, 0.28, 0.04, 30, lineMat, 0, false, false);
  const centerRing = new THREE.Mesh(new THREE.RingGeometry(4.4, 4.75, 24), lineMat);
  centerRing.rotation.x = -Math.PI * 0.5;
  centerRing.position.set(x, groundY + 0.18, z);
  chunk.nearGroup.add(centerRing);
  // Exterior Illuminated Arena Scoreboard Pylon
  addSolidBox(chunk, x - 40, groundY, z - 24, 1.6, 12.5, 1.6, roofMat, 0, "metal");
  addVisualBox(chunk.nearGroup, x - 40, groundY + 10.5, z - 24, 2.2, 4.2, 8.8, neonLed, 0);

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
