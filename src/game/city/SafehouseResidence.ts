import * as THREE from "three";
import { materialFor } from "../kit/surface";
import type { CityChunk } from "./ChunkStreamer";
import type { WalkableSurface, WorldHeightSystem } from "./HeightSystem";
import { addLodBox, addSolidBox, addVisualBox, registerNightGlowMaterial } from "./CityBuildingKit";
import { attachGlbToGroup } from "./PropModels";
import {
  buildDetailedCloset,
  buildDetailedKingBed,
  buildDetailedWeaponWorkbench,
  buildGarageModBay,
  createInteriorPalette,
  type HomeStation,
  type InteriorBuilderCtx,
} from "./HomeInteriors";

/**
 * Player's personal Modern California Safehouse Estate on Mirror Park Crescent (Old Quarter).
 * Lot center sits at (-322, 310), oriented toward Mirror Park Crescent at (-298, 342).
 */
export const SAFEHOUSE_ORIGIN = { x: -322, z: 310, y: 5.35 } as const;
export const SAFEHOUSE_YAW = Math.atan2(-298 - SAFEHOUSE_ORIGIN.x, 342 - SAFEHOUSE_ORIGIN.z); // ~0.6435 rad (36.87 deg)

export function safehouseLocalToWorld(lx: number, lz: number, ly = 0): { x: number; y: number; z: number } {
  const c = Math.cos(SAFEHOUSE_YAW);
  const s = Math.sin(SAFEHOUSE_YAW);
  return {
    x: SAFEHOUSE_ORIGIN.x + lx * c + lz * s,
    y: SAFEHOUSE_ORIGIN.y + ly,
    z: SAFEHOUSE_ORIGIN.z - lx * s + lz * c,
  };
}

// Player spawns on the front driveway walk facing the Safehouse, Open Garage & Personal Car
const _spawnW = safehouseLocalToWorld(1.8, 10.4, 0.14);
export const SAFEHOUSE_SPAWN: [number, number, number] = [
  Number(_spawnW.x.toFixed(2)),
  Number(_spawnW.z.toFixed(2)),
  Number(THREE.MathUtils.radToDeg(SAFEHOUSE_YAW + Math.PI + 0.18).toFixed(1)),
];

// Personal car parked INSIDE the 1-car garage bay facing straight out down the driveway
const _carW = safehouseLocalToWorld(2.4, 0.7, 0.14);
export const SAFEHOUSE_CAR_SPOT = {
  x: Number(_carW.x.toFixed(2)),
  z: Number(_carW.z.toFixed(2)),
  yawDeg: Number(THREE.MathUtils.radToDeg(SAFEHOUSE_YAW).toFixed(1)),
};

export const SAFEHOUSE_STATIONS: HomeStation[] = [
  {
    id: "safehouse_bed",
    kind: "bed",
    label: "Master Bed · Sleep & Save",
    sublabel: "Saves progress & advances day/night cycle",
    pos: safehouseLocalToWorld(-16.2, -3.2, 0.14),
    radius: 3.0,
  },
  {
    id: "safehouse_closet",
    kind: "closet",
    label: "Walk-In Wardrobe Closet",
    sublabel: "Customize operator uniform, armor & tactical gear",
    pos: safehouseLocalToWorld(-15.5, 2.2, 0.14),
    radius: 1.9,
    autoOpen: true,
  },
  {
    id: "safehouse_garage_door",
    kind: "garage_door",
    label: "Garage Door · Customize Car",
    sublabel: "[F] Overtake Car Customizer · [G] Drive Car Out",
    pos: safehouseLocalToWorld(-0.75, 1.2, 0.14),
    radius: 2.2,
  },
  {
    id: "safehouse_weapon_bench",
    kind: "weapon_bench",
    label: "Gunsmith Weapon Workbench",
    sublabel: "Customize optics, muzzles, finishes & weapon upgrades",
    pos: safehouseLocalToWorld(2.4, -3.1, 0.14),
    radius: 1.9,
    autoOpen: true,
  },
  {
    id: "safehouse_garage_mod",
    kind: "garage_mod",
    label: "Overtake Garage Mod Bay",
    sublabel: "Customize paint, rims, window tint & engine tuning",
    pos: safehouseLocalToWorld(2.4, 0.7, 0.14),
    radius: 3.0,
  },
  {
    id: "safehouse_intel_board",
    kind: "intel_board",
    label: "Intel & Surveillance Board",
    sublabel: "Inspect Target Dossiers & Start Contracts (H1–H3)",
    pos: safehouseLocalToWorld(-0.95, -1.35, 0.14),
    radius: 2.2,
  },
];

/**
 * Builds the player's walkable 2-story Modern Residence, furnished open-plan interior,
 * 1-car garage with interior garage access door, workbench & gun rack, driveway, courtyard, and illuminated pool patio.
 */
export function buildPlayerSafehouse(
  chunk: CityChunk,
  groundY: number,
  heightSystem: WorldHeightSystem,
): void {
  const y0 = groundY;
  const yaw = SAFEHOUSE_YAW;
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);

  const wPos = (lx: number, lz: number, ly = 0) => ({
    x: SAFEHOUSE_ORIGIN.x + lx * c + lz * s,
    y: y0 + ly,
    z: SAFEHOUSE_ORIGIN.z - lx * s + lz * c,
  });

  const boxSolid = (
    lx: number,
    ly: number,
    lz: number,
    w: number,
    h: number,
    d: number,
    mat: THREE.Material,
    kind: "concrete" | "wood" | "metal" | "dirt" = "concrete",
    localYaw = 0,
    castShadow = true,
  ) => {
    const p = wPos(lx, lz, ly);
    addSolidBox(chunk, p.x, p.y, p.z, w, h, d, mat, yaw + localYaw, kind, castShadow, true);
  };

  const boxVisual = (
    lx: number,
    ly: number,
    lz: number,
    w: number,
    h: number,
    d: number,
    mat: THREE.Material,
    localYaw = 0,
    castShadow = false,
  ) => {
    const p = wPos(lx, lz, ly);
    addVisualBox(chunk.nearGroup, p.x, p.y, p.z, w, h, d, mat, yaw + localYaw, castShadow, true);
  };

  // ---- Palette & Architectural Materials ----
  const lawnMat = materialFor(0x45733a, { roughness: 0.94, family: "grass", seed: 101, repeat: 8 });
  const concreteMat = materialFor(0xc2c6cc, { roughness: 0.84, metalness: 0.04, family: "concrete", seed: 102, repeat: 4 });
  const drivewayMat = materialFor(0x888e97, { roughness: 0.85, metalness: 0.05, family: "concrete", seed: 103, repeat: 6 });
  const stuccoMat = materialFor(0xf1ede4, { roughness: 0.84, metalness: 0.02, family: "plaster", seed: 104, repeat: 3 });
  const slateMat = materialFor(0x2c323b, { roughness: 0.68, metalness: 0.18, family: "concrete", seed: 105, repeat: 3 });
  const cedarMat = materialFor(0x8b5a36, { roughness: 0.76, metalness: 0.04, family: "wood", seed: 106, repeat: 3 });
  const oakFloorMat = materialFor(0x9c7248, { roughness: 0.64, metalness: 0.06, family: "wood", seed: 107, repeat: 5 });
  const garageFloorMat = materialFor(0x565c64, { roughness: 0.74, metalness: 0.12, family: "concrete", seed: 108, repeat: 4 });
  const glassMat = new THREE.MeshStandardMaterial({
    color: 0x6ea8c9,
    roughness: 0.08,
    metalness: 0.45,
    transparent: true,
    opacity: 0.42,
  });
  const darkMetalMat = materialFor(0x1b2028, { roughness: 0.38, metalness: 0.78, family: "metal", seed: 109 });
  const sofaMat = new THREE.MeshStandardMaterial({ color: 0x353d47, roughness: 0.88 });
  const cushionMat = new THREE.MeshStandardMaterial({ color: 0xd4a359, roughness: 0.82 });
  const redToolMat = new THREE.MeshStandardMaterial({ color: 0xc92a2a, roughness: 0.42, metalness: 0.55 });
  const poolWaterMat = registerNightGlowMaterial(
    new THREE.MeshStandardMaterial({
      color: 0x0ea5e9,
      emissive: 0x0284c7,
      emissiveIntensity: 0.25,
      roughness: 0.12,
      metalness: 0.45,
    }),
    0.25,
    1.5,
  );
  const warmGlowMat = registerNightGlowMaterial(
    new THREE.MeshStandardMaterial({
      color: 0xfff1d0,
      emissive: 0xffcf78,
      emissiveIntensity: 0.5,
      roughness: 0.3,
    }),
    0.5,
    2.8,
  );
  const tvScreenMat = new THREE.MeshStandardMaterial({
    color: 0x111827,
    emissive: 0x1e40af,
    emissiveIntensity: 0.9,
    roughness: 0.18,
  });

  // ---- 1. Estate Lot Pad, Manicured Lawn, 1-Car Driveway & Entry Walk ----
  // Base grass estate pad (40m x 36m)
  boxSolid(-5.5, -0.18, 0, 38, 0.28, 34, lawnMat, "dirt", 0, false);

  // 1-car Driveway extending from 1-car garage (+lx=2.4, +lz=4..33.2) right out to Mirror Park Crescent curb
  boxSolid(2.4, -0.04, 18.6, 4.8, 0.18, 29.2, drivewayMat, "concrete", 0, false);
  // Subtle concrete apron border strips
  boxVisual(-0.15, 0.11, 18.6, 0.28, 0.06, 29.2, concreteMat);
  boxVisual(4.95, 0.11, 18.6, 0.28, 0.06, 29.2, concreteMat);

  // Front entry courtyard patio + stepping pavers
  boxSolid(-4.2, -0.02, 5.2, 11.2, 0.16, 4.8, concreteMat, "concrete", 0, false);
  for (let i = 0; i < 5; i++) {
    boxSolid(-2.8, -0.02, 9.2 + i * 2.2, 2.4, 0.16, 1.3, concreteMat, "concrete", 0, false);
  }

  // ---- 2. Main 2-Story Residence + Walkable Master Bedroom Wing (-lx = -19.8 .. -0.3) ----
  // Interior hardwood floor slab covering living room + master bedroom suite
  boxSolid(-10.0, -0.02, -1.5, 19.6, 0.16, 10.4, oakFloorMat, "wood", 0, false);

  // Interior divider wall between Living Room & Master Bedroom (open 2.4m doorway at lz = -2.2..-4.6)
  boxSolid(-11.3, 0.14, 0.9, 0.38, 4.4, 5.2, stuccoMat, "concrete");
  boxSolid(-11.3, 0.14, -5.6, 0.38, 4.4, 1.8, stuccoMat, "concrete");
  boxSolid(-11.3, 2.8, -3.4, 0.38, 1.74, 2.6, stuccoMat, "concrete");

  // Master Bedroom Wing outer walls (lx = -19.8, lz = -6.5..+3.5)
  boxSolid(-19.8, 0.14, -1.5, 0.42, 4.4, 10.2, stuccoMat, "concrete");
  // Master Bedroom north pool-facing wall with panoramic glass
  boxSolid(-18.3, 0.14, -6.5, 3.0, 4.4, 0.35, stuccoMat, "concrete");
  boxSolid(-12.7, 0.14, -6.5, 2.8, 4.4, 0.35, stuccoMat, "concrete");
  boxVisual(-15.5, 0.14, -6.5, 2.8, 3.2, 0.1, glassMat);
  boxSolid(-15.5, 3.34, -6.5, 2.8, 1.2, 0.35, stuccoMat, "concrete");
  // Master Bedroom south facade wall
  boxSolid(-15.6, 0.14, 3.5, 8.6, 4.4, 0.35, slateMat, "concrete");
  // Master Bedroom Wing roof slab & recessed warm lighting
  boxSolid(-15.6, 4.45, -1.5, 9.0, 0.36, 11.2, slateMat, "concrete");
  boxVisual(-15.6, 4.38, -1.5, 5.4, 0.06, 0.22, warmGlowMat);

  // East wall between house & garage (segmented for tight world-AABB clearance, with open doorway at lz = 0.2..2.2)
  for (const wz of [-5.85, -4.6, -3.35, -2.1, -0.85]) {
    boxSolid(-0.3, 0.14, wz, 0.36, 4.4, 1.25, slateMat, "concrete");
  }
  boxSolid(-0.3, 0.14, 2.9, 0.36, 4.4, 1.4, slateMat, "concrete");
  boxSolid(-0.3, 2.8, 0.9, 0.36, 1.74, 2.6, slateMat, "concrete"); // lintel above connecting door

  // Back north/patio wall (-lz = -6.5): wide open panoramic glass wall & slider opening onto pool deck
  boxSolid(-9.6, 0.14, -6.5, 3.6, 4.4, 0.35, stuccoMat, "concrete");
  boxSolid(-2.0, 0.14, -6.5, 3.6, 4.4, 0.35, stuccoMat, "concrete");
  boxVisual(-5.8, 0.14, -6.5, 4.0, 3.2, 0.1, glassMat); // panoramic window behind dining area
  boxSolid(-5.8, 3.34, -6.5, 4.0, 1.2, 0.35, stuccoMat, "concrete");

  // Front south facade (+lz = +3.5): wide 3.8m open entryway right into living room + floor-to-ceiling glass wings
  boxSolid(-10.0, 0.14, 3.5, 2.8, 4.4, 0.35, slateMat, "concrete");
  boxVisual(-7.6, 0.14, 3.5, 2.0, 3.2, 0.1, glassMat);
  boxSolid(-7.6, 3.34, 3.5, 2.0, 1.2, 0.35, darkMetalMat, "metal");
  // Open 3.8m glass portico threshold (-6.6 .. -2.8) — player walks straight in!
  boxSolid(-4.7, 3.4, 3.5, 3.8, 1.14, 0.35, slateMat, "concrete");
  boxSolid(-1.5, 0.14, 3.5, 2.6, 4.4, 0.35, slateMat, "concrete");

  // Front timber-slat overhang canopy above entry
  boxSolid(-4.5, 3.35, 5.1, 8.6, 0.24, 3.2, cedarMat, "wood");
  boxVisual(-4.5, 3.3, 5.1, 7.6, 0.06, 0.3, warmGlowMat);
  // Canopy steel support column
  boxSolid(-8.5, 0.14, 6.2, 0.26, 3.25, 0.26, darkMetalMat, "metal");

  // Main Living Room Roof + Cantilevered 2nd Floor Architectural Volume!
  boxSolid(-5.8, 4.45, -1.5, 12.2, 0.36, 11.2, slateMat, "concrete");
  // 2nd Floor architectural volume (-11.0..-2.0, lz = -5.5..+2.5, height 3.2m)
  boxSolid(-6.6, 4.81, -1.6, 9.2, 3.1, 8.2, stuccoMat, "concrete");
  boxVisual(-6.6, 5.25, 2.52, 7.2, 2.1, 0.12, glassMat); // 2nd-floor panoramic glass
  boxSolid(-6.6, 7.91, -1.6, 10.2, 0.32, 9.2, slateMat, "concrete"); // upper flat roof overhang
  // 2nd-floor roof terrace glass balustrade with brushed-steel shoes, stanchions & top handrails
  boxVisual(-1.2, 4.66, -1.6, 0.12, 0.08, 8.2, darkMetalMat);
  boxVisual(-1.2, 4.74, -1.6, 0.06, 1.0, 8.1, glassMat);
  boxVisual(-1.2, 5.74, -1.6, 0.12, 0.06, 8.2, darkMetalMat);
  for (const rz of [-5.6, -2.9, -0.2, 2.4]) {
    boxVisual(-1.2, 4.7, rz, 0.1, 1.06, 0.1, darkMetalMat);
  }
  boxVisual(1.5, 4.66, 2.4, 5.4, 0.08, 0.12, darkMetalMat);
  boxVisual(1.5, 4.74, 2.4, 5.3, 1.0, 0.06, glassMat);
  boxVisual(1.5, 5.74, 2.4, 5.4, 0.06, 0.12, darkMetalMat);
  for (const rx of [-1.2, 0.6, 2.4, 4.15]) {
    boxVisual(rx, 4.7, 2.4, 0.1, 1.06, 0.1, darkMetalMat);
  }

  // ---- 3. Furnished Living Room, Kitchen, Master Bedroom & Walk-In Closet ----
  const interiorCtx: InteriorBuilderCtx = {
    solid: (lx, ly, lz, w, h, d, mat, kind = "concrete", localYaw = 0, cs = true) =>
      boxSolid(lx, ly - y0, lz, w, h, d, mat, kind, localYaw, cs),
    visual: (lx, ly, lz, w, h, d, mat, localYaw = 0, cs = false) =>
      boxVisual(lx, ly - y0, lz, w, h, d, mat, localYaw, cs),
    addMesh: (mesh, lx, ly, lz, localYaw = 0) => {
      const p = wPos(lx, lz, ly - y0);
      mesh.position.set(p.x, p.y, p.z);
      mesh.rotation.y = yaw + localYaw;
      mesh.castShadow = true;
      chunk.nearGroup.add(mesh);
    },
  };
  const pal = createInteriorPalette();

  // Master Bedroom: King Platform Bed facing north pool window + Walk-in Wardrobe Closet on south wall
  buildDetailedKingBed(interiorCtx, pal, -16.4, y0 + 0.14, -4.4, 0);
  buildDetailedCloset(interiorCtx, pal, -15.6, y0 + 0.14, 2.85, Math.PI);

  // L-shaped sectional sofa + throw pillows + glass coffee table
  boxSolid(-8.4, 0.14, -0.6, 3.0, 0.48, 1.05, sofaMat, "wood");
  boxSolid(-8.4, 0.62, -0.98, 3.0, 0.42, 0.28, sofaMat, "wood");
  boxSolid(-9.45, 0.14, 0.5, 1.0, 0.48, 2.2, sofaMat, "wood");
  boxVisual(-8.0, 0.64, -0.7, 0.48, 0.34, 0.24, cushionMat);
  boxVisual(-7.1, 0.64, -0.7, 0.48, 0.34, 0.24, cushionMat);
  boxSolid(-7.6, 0.14, 0.8, 1.5, 0.38, 0.9, darkMetalMat, "metal");
  boxVisual(-7.6, 0.52, 0.8, 1.54, 0.05, 0.94, glassMat);

  // Media console + wide 75" glowing OLED TV on west wall (south of bedroom doorway)
  boxSolid(-10.75, 0.14, 1.2, 0.65, 0.55, 2.6, cedarMat, "wood");
  boxVisual(-11.0, 1.15, 1.2, 0.12, 1.25, 2.1, darkMetalMat);
  boxVisual(-10.92, 1.18, 1.2, 0.06, 1.12, 1.94, tvScreenMat);

  // Kitchen island & counter along north-east interior
  boxSolid(-2.8, 0.14, -4.6, 3.6, 0.95, 0.85, slateMat, "concrete");
  boxVisual(-2.8, 1.09, -4.6, 3.7, 0.08, 0.95, concreteMat); // marble countertop
  boxSolid(-2.8, 0.14, -2.8, 2.8, 0.92, 1.05, cedarMat, "wood");
  boxVisual(-2.8, 1.06, -2.8, 2.9, 0.08, 1.15, concreteMat);
  // Real GLB Safehouse furniture accents (sofa, TV, kitchen appliances, plant, garage gas can)
  const addSafehouseGlb = (file: string, lx: number, ly: number, lz: number, axis: "x" | "y" | "z", meters: number, localYaw = 0) => {
    const g = new THREE.Group();
    interiorCtx.addMesh(g, lx, y0 + ly, lz, localYaw);
    attachGlbToGroup(g, file, 0, 0, 0, { axis, targetMeters: meters });
  };
  addSafehouseGlb("int_couch_l.glb", -8.6, 0.14, -0.3, "x", 2.9, Math.PI * 0.5);
  addSafehouseGlb("int_tv.glb", -10.8, 0.72, 1.2, "x", 1.85, Math.PI * 0.5);
  addSafehouseGlb("int_plant.glb", -10.4, 0.14, -3.6, "y", 1.25);
  addSafehouseGlb("int_fridge.glb", -0.9, 0.14, -4.6, "y", 2.05);
  addSafehouseGlb("int_oven.glb", -2.8, 0.14, -4.6, "y", 0.94);
  addSafehouseGlb("gas_can.glb", 4.4, 0.14, -3.4, "y", 0.65, 0.4);
  // Warm interior recessed ceiling light strips
  boxVisual(-6.0, 4.38, -1.5, 6.0, 0.06, 0.22, warmGlowMat);
  boxVisual(-3.0, 4.38, -3.5, 3.2, 0.06, 0.2, warmGlowMat);

  // ---- 4. Attached 1-Car Garage (lx = -0.1 .. +5.1, lz = -4.2 .. +4.2) + Interior Garage Access Door ----
  // Interior Garage Door Frame & Ajar Steel Fire Door inside the house (lx = -0.3, lz = 1.2)
  boxVisual(-0.3, 0.14, 0.22, 0.44, 2.55, 0.08, darkMetalMat); // hinge jamb
  boxVisual(-0.3, 0.14, 2.18, 0.44, 2.55, 0.08, darkMetalMat); // latch jamb
  // Ajar steel door leaf swung 82 deg into the garage so player walks right through
  boxVisual(0.28, 0.14, 0.35, 0.07, 2.42, 1.05, slateMat, 1.38);
  boxVisual(0.28, 1.45, 0.35, 0.09, 0.55, 0.24, glassMat, 1.38);
  // Glowing cyan smart-garage keypad on the house side of the garage door
  boxVisual(-0.52, 1.28, 2.28, 0.05, 0.24, 0.16, pal.coolGlow);

  // Surveillance Intel Corkboard mounted on interior dividing wall (lx = -0.35, lz = -1.35)
  const corkMat = materialFor(0xb88652, { roughness: 0.9, family: "wood", seed: 917 });
  const cardMat = new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.65 });
  const redPinMat = new THREE.MeshStandardMaterial({ color: 0xef4444, emissive: 0xdc2626, emissiveIntensity: 1.4 });
  boxVisual(-0.34, 1.38, -1.35, 0.08, 1.18, 1.95, darkMetalMat);
  boxVisual(-0.38, 1.4, -1.35, 0.04, 1.06, 1.82, corkMat);
  for (const dz of [-1.85, -1.35, -0.85]) {
    boxVisual(-0.4, 1.56, dz, 0.02, 0.36, 0.28, cardMat);
    boxVisual(-0.41, 1.7, dz, 0.03, 0.06, 0.06, redPinMat);
  }
  boxVisual(-0.4, 1.05, -1.35, 0.03, 0.07, 1.4, warmGlowMat);

  // Ribbed concrete 1-car garage pad (5.2m wide — fits strictly 1 car!)
  boxSolid(2.4, -0.02, 0.0, 5.2, 0.16, 8.6, garageFloorMat, "concrete", 0, false);
  // East garage wall + back north garage wall (segmented for tight world-AABB clearance!)
  for (const wz of [-3.4, -2.15, -0.9, 0.35, 1.6, 2.85, 3.7]) {
    boxSolid(5.1, 0.14, wz, 0.36, 3.55, 1.25, stuccoMat, "concrete");
  }
  for (const wx of [0.2, 1.4, 2.6, 3.8, 4.8]) {
    boxSolid(wx, 0.14, -4.1, 1.2, 3.55, 0.36, stuccoMat, "concrete");
  }
  // Garage roof slab (forms 2nd floor sun deck above 1-car garage)
  boxSolid(2.4, 3.69, 0.0, 5.6, 0.34, 9.0, slateMat, "concrete");

  // Front 1-car garage portal frame (4.1m clear width centered at lx = 2.4) + raised sectional door
  boxSolid(0.05, 0.14, 4.1, 0.52, 3.55, 0.42, slateMat, "concrete");
  boxSolid(4.75, 0.14, 4.1, 0.52, 3.55, 0.42, slateMat, "concrete");
  boxSolid(2.4, 3.05, 4.1, 5.2, 0.65, 0.42, slateMat, "concrete");
  // Raised sectional 1-car garage door panels overhead
  boxVisual(2.4, 2.88, 3.6, 4.0, 0.18, 0.9, cedarMat);
  // Overhead bright shop LED strips
  boxVisual(2.4, 3.62, 0.5, 3.0, 0.06, 0.18, warmGlowMat);
  boxVisual(2.4, 3.62, -2.0, 3.0, 0.06, 0.18, warmGlowMat);

  // 1-Car Garage Gunsmith Weapon Workbench + Overtake Mod Bay + Tool Chest & Spare Tires
  buildDetailedWeaponWorkbench(interiorCtx, pal, 2.4, y0 + 0.14, -3.45, 0);
  buildGarageModBay(interiorCtx, pal, 2.4, y0 + 0.14, 0.7, 0);
  boxSolid(0.55, 0.14, -3.45, 0.9, 1.1, 0.68, redToolMat, "metal"); // snap-on style tool chest
  // Spare wheel stack in NE corner
  for (let i = 0; i < 3; i++) {
    const tp = wPos(4.45, -3.3, 0.28 + i * 0.26);
    const tire = new THREE.Mesh(
      new THREE.CylinderGeometry(0.32, 0.32, 0.22, 14),
      darkMetalMat,
    );
    tire.position.set(tp.x, tp.y, tp.z);
    tire.castShadow = true;
    chunk.nearGroup.add(tire);
  }

  // ---- 5. Backyard Swimming Pool Patio, Timber Pergola & Privacy Fence (lz = -7 .. -14) ----
  boxSolid(-3.5, -0.02, -10.5, 14.5, 0.16, 7.6, concreteMat, "concrete", 0, false);
  // Illuminated swimming pool basin & stone coping
  boxVisual(-4.0, 0.09, -10.6, 7.8, 0.08, 4.4, poolWaterMat);
  boxVisual(-4.0, 0.07, -10.6, 8.2, 0.06, 4.8, slateMat);
  // Cedar pergola beams over poolside terrace
  for (const px of [0.8, 3.2]) {
    boxVisual(px, 0.14, -8.8, 0.18, 2.75, 0.18, cedarMat);
    boxVisual(px, 0.14, -12.4, 0.18, 2.75, 0.18, cedarMat);
  }
  boxVisual(2.0, 2.9, -10.6, 2.8, 0.16, 4.0, cedarMat);
  // Poolside timber loungers
  for (const lx of [1.2, 2.8]) {
    boxSolid(lx, 0.14, -10.4, 0.85, 0.34, 2.0, cedarMat, "wood");
    boxVisual(lx, 0.48, -10.0, 0.78, 0.12, 1.2, cushionMat);
  }

  // ---- 6. Perimeter Stone Wall & 1-Car Driveway Gate Pillars (segmented for tight AABBs) ----
  for (const wx of [-19.4, -15.4, -11.4, -7.4, -3.6]) {
    boxSolid(wx, 0.14, 15.5, 3.6, 1.05, 0.45, slateMat, "concrete");
  }
  boxSolid(8.2, 0.14, 15.5, 3.6, 1.05, 0.45, slateMat, "concrete");
  // Left & Right illuminated driveway stone pillars framing the 1-car driveway
  for (const px of [-0.8, 5.6]) {
    boxSolid(px, 0.14, 15.5, 0.85, 1.65, 0.85, slateMat, "concrete");
    boxVisual(px, 1.79, 15.5, 0.62, 0.18, 0.62, warmGlowMat);
  }
  // Low side privacy walls
  for (const wz of [-10, -2, 6, 12]) {
    boxSolid(-21.4, 0.14, wz, 0.45, 1.45, 7.6, slateMat, "concrete");
    boxSolid(10.0, 0.14, wz, 0.45, 1.45, 7.6, slateMat, "concrete");
  }

  // ---- 7. Register WalkableSurface covering the entire residence, bedroom wing, 1-car garage & driveway ----
  const surfMinX = Math.min(wPos(-21, -16).x, wPos(10, -16).x, wPos(-21, 28).x, wPos(10, 28).x) - 1;
  const surfMaxX = Math.max(wPos(-21, -16).x, wPos(10, -16).x, wPos(-21, 28).x, wPos(10, 28).x) + 1;
  const surfMinZ = Math.min(wPos(-21, -16).z, wPos(10, -16).z, wPos(-21, 28).z, wPos(10, 28).z) - 1;
  const surfMaxZ = Math.max(wPos(-21, -16).z, wPos(10, -16).z, wPos(-21, 28).z, wPos(10, 28).z) + 1;
  const floorSurf: WalkableSurface = {
    id: "oq_player_safehouse_pad",
    minX: surfMinX,
    maxX: surfMaxX,
    minZ: surfMinZ,
    maxZ: surfMaxZ,
    minY: y0 - 0.5,
    maxY: y0 + 0.6,
    heightAt: (qx, qz) => {
      const dx = qx - SAFEHOUSE_ORIGIN.x;
      const dz = qz - SAFEHOUSE_ORIGIN.z;
      const lx = dx * c - dz * s;
      const lz = dx * s + dz * c;
      if (lx >= -20.0 && lx <= 5.2 && lz >= -14.2 && lz <= 13.2) return y0 + 0.14;
      if (lx >= -0.3 && lx <= 5.2 && lz > 13.2 && lz <= 33.2) return y0 + 0.14;
      return null;
    },
  };
  heightSystem.addSurface(floorSurf);

  // Far LOD silhouette for skyline/aerial distance
  addLodBox(chunk, SAFEHOUSE_ORIGIN.x - 4.0, y0, SAFEHOUSE_ORIGIN.z, 24, 7.6, 15, 0xeae4d8, yaw);
}
