import * as THREE from "three";
import { materialFor } from "../kit/surface";
import type { CityChunk } from "./ChunkStreamer";
import type { WalkableSurface, WorldHeightSystem } from "./HeightSystem";
import type { RoadNetwork } from "./RoadNetwork";
import {
  CityChunkDispatcher,
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
  type FacadeStyle,
} from "./CityBuildingKit";

interface MidtownOfficeSpec {
  id: string;
  x: number;
  z: number;
  w: number;
  d: number;
  h: number;
  style: FacadeStyle;
  lodColor: number;
  yaw?: number;
}

const MIDTOWN_MIDRISES: MidtownOfficeSpec[] = [
  { id: "mt_corp_nw1", x: -458, z: -225, w: 30, d: 24, h: 28, style: "brick_tan", lodColor: 0x9b8669 },
  { id: "mt_corp_nw2", x: -468, z: -310, w: 28, d: 26, h: 34, style: "glass_teal", lodColor: 0x3b6778 },
  { id: "mt_corp_w1", x: -462, z: -65, w: 26, d: 28, h: 24, style: "concrete_mod", lodColor: 0x8a8f96 },
  { id: "mt_corp_n1", x: -248, z: -292, w: 24, d: 22, h: 32, style: "brick_red", lodColor: 0x824438 },
  { id: "mt_corp_e1", x: -95, z: -188, w: 28, d: 24, h: 42, style: "glass_gold", lodColor: 0x6b5a3e },
  { id: "mt_corp_e2", x: -122, z: -28, w: 26, d: 24, h: 36, style: "limestone", lodColor: 0x9e9585 },
  { id: "mt_corp_s1", x: -165, z: 42, w: 28, d: 22, h: 26, style: "brick_tan", lodColor: 0x948066 },
  { id: "mt_corp_w2", x: -345, z: -288, w: 24, d: 22, h: 30, style: "glass_slate", lodColor: 0x45596e },
];

function buildMidrise(chunk: CityChunk, spec: MidtownOfficeSpec, groundY: number): void {
  const mat = createFacadeMaterial(spec.style, Math.max(3, Math.round(spec.w / 4)), Math.max(4, Math.round(spec.h / 4)));
  const trimMat = materialFor(0x393f48, { roughness: 0.65, metalness: 0.35, family: "metal", seed: 701 });
  const yaw = spec.yaw ?? 0;

  // Base podium + main shaft + stepped penthouse + storefront & rooftop chillers
  const podiumH = Math.min(6, spec.h * 0.22);
  addPavedPlazaApron(chunk.nearGroup, spec.x, groundY, spec.z, spec.w + 2, spec.d + 2, yaw);
  addSolidBox(chunk, spec.x, groundY, spec.z, spec.w + 2, podiumH, spec.d + 2, trimMat, yaw, "concrete");
  addSolidBox(chunk, spec.x, groundY + podiumH, spec.z, spec.w, spec.h - podiumH, spec.d, mat, yaw, "concrete");
  addSolidBox(chunk, spec.x, groundY + spec.h, spec.z, spec.w * 0.56, 3.2, spec.d * 0.56, trimMat, yaw, "concrete");
  addFacadeRelief(chunk.nearGroup, spec.x, groundY + podiumH, spec.z, spec.w, spec.h - podiumH, spec.d, yaw, {
    balconies: spec.style.startsWith("brick"),
    pilasterMat: trimMat,
  });
  addStorefrontBay(chunk.nearGroup, spec.x, groundY, spec.z, spec.w + 2, spec.d + 2, yaw, trimMat);
  addRooftopDetails(chunk.nearGroup, spec.x, groundY + spec.h, spec.z, spec.w, spec.d, yaw, { waterTower: spec.style.startsWith("brick") });
  addLodBox(chunk, spec.x, groundY, spec.z, spec.w, spec.h + 2.5, spec.d, spec.lodColor, yaw);
}

/** Westgate Grand Shopping Mall & Glass Skylight Atrium (`x=-402, z=-35`) */
function buildGrandMall(chunk: CityChunk, groundY: number): void {
  const x = -402;
  const z = -35;
  const stoneMat = createFacadeMaterial("limestone", 8, 3);
  const darkMetal = materialFor(0x2a313a, { roughness: 0.5, metalness: 0.52, family: "metal", seed: 702 });
  const plazaMat = materialFor(0x9ca2aa, { roughness: 0.84, metalness: 0.04, family: "stone", seed: 703, repeat: 12 });
  const glassRoofMat = new THREE.MeshStandardMaterial({
    color: 0x89c4e8,
    roughness: 0.14,
    metalness: 0.65,
    transparent: true,
    opacity: 0.78,
  });
  const signMat = registerNightGlowMaterial(
    new THREE.MeshStandardMaterial({
      color: 0xf59e0b,
      emissive: 0xd97706,
      emissiveIntensity: 0.35,
      roughness: 0.35,
    }),
    0.35,
    2.8,
  );

  // Grand entrance plaza apron
  addSolidBox(chunk, x, groundY - 0.1, z, 72, 0.28, 56, plazaMat, 0, "concrete", false, true);

  // West & East main retail wings + central atrium hall
  addSolidBox(chunk, x - 20, groundY, z, 22, 13.5, 44, stoneMat, 0, "concrete");
  addSolidBox(chunk, x + 20, groundY, z, 22, 13.5, 44, stoneMat, 0, "concrete");
  addSolidBox(chunk, x, groundY, z + 10, 22, 11.5, 24, stoneMat, 0, "concrete");

  // Entry awning & glowing marquee sign facing North toward Del Sol Ave + grand glazed portal columns
  addSolidBox(chunk, x, groundY + 4.8, z - 19.5, 24, 0.5, 6, darkMetal, 0, "metal");
  addVisualBox(chunk.nearGroup, x, groundY + 5.7, z - 22.3, 18, 1.3, 0.4, signMat, 0);
  for (const cx of [-8.5, -2.8, 2.8, 8.5]) {
    addSolidBox(chunk, x + cx, groundY, z - 22.1, 0.65, 4.8, 0.65, darkMetal, 0, "metal");
  }
  // Outdoor plaza café umbrellas & tables
  for (const cx of [-18, -11, 11, 18]) {
    addVisualBox(chunk.nearGroup, x + cx, groundY + 0.72, z - 24.5, 1.5, 0.08, 1.5, darkMetal, 0);
    addVisualBox(chunk.nearGroup, x + cx, groundY + 1.35, z - 24.5, 0.1, 2.5, 0.1, darkMetal, 0);
    const umb = new THREE.Mesh(new THREE.ConeGeometry(1.75, 0.65, 6), signMat);
    umb.position.set(x + cx, groundY + 2.65, z - 24.5);
    chunk.nearGroup.add(umb);
  }

  // Barrel-vault glass skylight roof spanning central concourse + structural steel arch trusses
  const vault = new THREE.Mesh(
    new THREE.CylinderGeometry(9.5, 9.5, 36, 18, 1, false, 0, Math.PI),
    glassRoofMat,
  );
  vault.rotation.z = Math.PI * 0.5;
  vault.rotation.y = Math.PI * 0.5;
  vault.position.set(x, groundY + 13.5, z);
  vault.castShadow = true;
  vault.receiveShadow = true;
  chunk.nearGroup.add(vault);
  for (let rz = -16; rz <= 16; rz += 4.0) {
    const rib = new THREE.Mesh(new THREE.TorusGeometry(9.6, 0.16, 6, 18, Math.PI), darkMetal);
    rib.position.set(x, groundY + 13.5, z + rz);
    chunk.nearGroup.add(rib);
  }
  addStorefrontBay(chunk.nearGroup, x, groundY, z - 2, 22, 36, Math.PI, darkMetal);

  // Pylon directory tower near plaza corner + twin decorative entrance flagpole masts
  addSolidBox(chunk, x + 31, groundY, z - 23, 2.6, 11.5, 1.4, darkMetal, 0, "metal");
  addVisualBox(chunk.nearGroup, x + 31, groundY + 8.5, z - 23, 2.8, 3.2, 1.6, signMat, 0);
  for (const fx of [-24, 24]) {
    addVisualBox(chunk.nearGroup, x + fx, groundY + 5.2, z - 25.5, 0.14, 10.4, 0.14, darkMetal, 0);
    addVisualBox(chunk.nearGroup, x + fx + 1.1, groundY + 9.4, z - 25.5, 2.1, 1.25, 0.08, signMat, 0);
  }

  addLodBox(chunk, x, groundY, z, 64, 17, 46, 0x9b9487);
}

/** St. Jude's Central Medical Center & Helipad (`x=-138, z=-252`) */
function buildMedicalCenter(chunk: CityChunk, groundY: number, heightSystem: WorldHeightSystem): void {
  const x = -138;
  const z = -252;
  const clinicalMat = createFacadeMaterial("concrete_mod", 8, 5);
  const glassMat = createFacadeMaterial("glass_teal", 5, 6);
  const trimMat = new THREE.MeshStandardMaterial({ color: 0xdbe3ea, roughness: 0.72, metalness: 0.1 });
  const padMat = new THREE.MeshStandardMaterial({ color: 0x3b424c, roughness: 0.82, metalness: 0.12 });
  const redCrossMat = registerNightGlowMaterial(
    new THREE.MeshStandardMaterial({
      color: 0xef4444,
      emissive: 0xdc2626,
      emissiveIntensity: 0.55,
      roughness: 0.35,
    }),
    0.55,
    3.4,
  );
  const yellowPaint = new THREE.MeshStandardMaterial({ color: 0xfacc15, roughness: 0.65 });

  // Ground ambulance courtyard
  addSolidBox(chunk, x, groundY - 0.1, z, 54, 0.25, 44, padMat, 0, "concrete", false, true);

  // Main Hospital Clinical Block + East Ward Tower
  addSolidBox(chunk, x - 6, groundY, z, 34, 18.0, 28, clinicalMat, 0, "concrete");
  addSolidBox(chunk, x + 15, groundY, z - 2, 16, 28.5, 22, glassMat, 0, "concrete");
  addSolidBox(chunk, x - 6, groundY + 18.0, z, 35, 1.1, 29, trimMat, 0, "concrete");

  // Emergency ER Ambulance Canopy on South face
  addSolidBox(chunk, x - 8, groundY + 4.4, z + 17.5, 18, 0.5, 7, trimMat, 0, "metal");
  addSolidBox(chunk, x - 16, groundY, z + 20.5, 0.7, 4.4, 0.7, trimMat, 0, "metal");
  addSolidBox(chunk, x, groundY, z + 20.5, 0.7, 4.4, 0.7, trimMat, 0, "metal");
  addVisualBox(chunk.nearGroup, x - 8, groundY + 5.1, z + 21.1, 7.2, 0.9, 0.3, redCrossMat, 0);

  // Glowing Red Cross on South clinical facade (centered at y = groundY + 15.7)
  addVisualBox(chunk.nearGroup, x - 6, groundY + 15.1, z + 14.2, 4.4, 1.2, 0.3, redCrossMat, 0);
  addVisualBox(chunk.nearGroup, x - 6, groundY + 13.5, z + 14.2, 1.2, 4.4, 0.3, redCrossMat, 0);

  // Elevated Rooftop Helipad on main clinical roof (`groundY + 19.1`)
  const heliY = groundY + 19.1;
  addSolidBox(chunk, x - 8, heliY, z, 14, 0.4, 14, padMat, 0, "metal");
  // Yellow "H" marking + perimeter amber helipad beacons
  addVisualBox(chunk.nearGroup, x - 10.2, heliY + 0.42, z, 0.7, 0.05, 6.0, yellowPaint, 0, false, false);
  addVisualBox(chunk.nearGroup, x - 5.8, heliY + 0.42, z, 0.7, 0.05, 6.0, yellowPaint, 0, false, false);
  addVisualBox(chunk.nearGroup, x - 8, heliY + 0.42, z, 4.4, 0.05, 0.7, yellowPaint, 0, false, false);
  for (const [bx, bz] of [[-6.2, -6.2], [6.2, -6.2], [-6.2, 6.2], [6.2, 6.2]]) {
    addVisualBox(chunk.nearGroup, x - 8 + bx, heliY + 0.55, z + bz, 0.32, 0.25, 0.32, yellowPaint, 0);
  }

  const surf: WalkableSurface = {
    id: "mt_hospital_helipad",
    minX: x - 15,
    maxX: x - 1,
    minZ: z - 7,
    maxZ: z + 7,
    minY: heliY,
    maxY: heliY + 0.6,
    heightAt: (qx, qz) => (qx >= x - 15 && qx <= x - 1 && qz >= z - 7 && qz <= z + 7 ? heliY + 0.4 : null),
  };
  heightSystem.addSurface(surf);

  addLodBox(chunk, x + 2, groundY, z, 50, 26, 32, 0xc3ccd4);
}

/** Westgate University Campus: Library Clocktower, Science Hall & Quad (`x=-165, z=-380`) */
function buildUniversityCampus(chunk: CityChunk, groundY: number): void {
  const x = -165;
  const z = -380;
  const brickMat = createFacadeMaterial("brick_red", 7, 4);
  const limestoneMat = createFacadeMaterial("limestone", 5, 4);
  const quadLawn = new THREE.MeshStandardMaterial({ color: 0x3f6b36, roughness: 0.94 });
  const roofSlate = new THREE.MeshStandardMaterial({ color: 0x2f3b46, roughness: 0.72, metalness: 0.2 });
  const copperMat = new THREE.MeshStandardMaterial({ color: 0x2f856b, roughness: 0.48, metalness: 0.42 });
  const clockFace = registerNightGlowMaterial(
    new THREE.MeshStandardMaterial({
      color: 0xfef3c7,
      emissive: 0xfde68a,
      emissiveIntensity: 0.25,
      roughness: 0.4,
    }),
    0.25,
    2.5,
  );

  // Campus green quad
  addSolidBox(chunk, x, groundY - 0.1, z + 18, 86, 0.22, 66, quadLawn, 0, "dirt", false, true);

  // Founders Memorial Library (North side of quad)
  addSolidBox(chunk, x + 16, groundY, z - 8, 36, 13.5, 20, brickMat, 0, "concrete");
  addSolidBox(chunk, x + 16, groundY + 13.5, z - 8, 38, 1.4, 22, roofSlate, 0, "concrete");

  // Classical Clocktower rising from Library center (4-sided illuminated clock faces + spire finial)
  addSolidBox(chunk, x + 16, groundY + 14.9, z - 8, 7.2, 16.5, 7.2, limestoneMat, 0, "concrete");
  addVisualBox(chunk.nearGroup, x + 16, groundY + 27.5, z - 4.35, 3.0, 3.0, 0.25, clockFace, 0);
  addVisualBox(chunk.nearGroup, x + 16, groundY + 27.5, z - 11.65, 3.0, 3.0, 0.25, clockFace, 0);
  addVisualBox(chunk.nearGroup, x + 12.35, groundY + 27.5, z - 8, 0.25, 3.0, 3.0, clockFace, 0);
  addVisualBox(chunk.nearGroup, x + 19.65, groundY + 27.5, z - 8, 0.25, 3.0, 3.0, clockFace, 0);
  addVisualBox(chunk.nearGroup, x + 16, groundY + 31.4, z - 8, 8.0, 0.65, 8.0, limestoneMat, 0);
  const spire = new THREE.Mesh(new THREE.ConeGeometry(4.6, 8.5, 4), copperMat);
  spire.position.set(x + 16, groundY + 35.6, z - 8);
  spire.rotation.y = Math.PI * 0.25;
  spire.castShadow = true;
  chunk.nearGroup.add(spire);
  addStorefrontBay(chunk.nearGroup, x + 16, groundY, z - 8, 36, 20, 0, roofSlate);

  // Science & Engineering Hall (West side of quad) + Classical East Colonnade + Quad Sundial Monument
  addSolidBox(chunk, x - 24, groundY, z + 10, 22, 15.0, 34, limestoneMat, 0, "concrete");
  addSolidBox(chunk, x - 24, groundY + 15.0, z + 10, 20, 2.2, 32, roofSlate, 0, "concrete");
  for (const cz of [z + 4, z + 8, z + 12, z + 16]) {
    addSolidBox(chunk, x - 11.4, groundY, cz, 0.7, 8.2, 0.7, limestoneMat, 0, "concrete");
  }
  addSolidBox(chunk, x - 12.2, groundY + 8.2, z + 10, 2.6, 1.1, 14.5, limestoneMat, 0, "concrete");
  const quadMonument = new THREE.Mesh(new THREE.CylinderGeometry(4.2, 4.6, 0.5, 18), limestoneMat);
  quadMonument.position.set(x + 8, groundY + 0.35, z + 18);
  chunk.nearGroup.add(quadMonument);
  addVisualBox(chunk.nearGroup, x + 8, groundY + 1.8, z + 18, 1.1, 2.6, 1.1, copperMat, 0);

  addLodBox(chunk, x + 16, groundY, z - 8, 36, 22, 20, 0x874337);
  addLodBox(chunk, x - 24, groundY, z + 10, 22, 16, 34, 0xb5ab98);
}

/** Grand Regal Cinema & Retail Strip (`x=-342, z=-78`) */
function buildRegalCinemaAndStrip(chunk: CityChunk, groundY: number): void {
  const x = -342;
  const z = -78;
  const decoMat = createFacadeMaterial("brick_tan", 6, 5);
  const stripMat = createFacadeMaterial("brick_red", 6, 3);
  const darkTrim = new THREE.MeshStandardMaterial({ color: 0x262930, roughness: 0.65, metalness: 0.3 });
  const neonPink = new THREE.MeshStandardMaterial({
    color: 0xf43f5e,
    emissive: 0xe11d48,
    emissiveIntensity: 1.85,
    roughness: 0.3,
  });
  const neonGold = new THREE.MeshStandardMaterial({
    color: 0xfbbf24,
    emissive: 0xf59e0b,
    emissiveIntensity: 1.6,
    roughness: 0.3,
  });

  // Regal Theater & Art-Deco Hotel Tower
  addSolidBox(chunk, x, groundY, z, 28, 11.5, 26, decoMat, 0, "concrete");
  addSolidBox(chunk, x, groundY + 11.5, z + 2, 18, 18.0, 18, decoMat, 0, "concrete");
  // Marquee canopy + ticket booth + poster lightboxes + glowing blade sign facing North toward Del Sol Ave
  addSolidBox(chunk, x, groundY + 4.4, z - 14.5, 16, 1.3, 4.2, darkTrim, 0, "metal");
  addVisualBox(chunk.nearGroup, x, groundY + 4.6, z - 16.7, 14.5, 0.9, 0.3, neonGold, 0);
  addSolidBox(chunk, x, groundY, z - 14.2, 2.6, 2.8, 2.2, darkTrim, 0, "metal");
  addVisualBox(chunk.nearGroup, x, groundY + 1.8, z - 15.35, 1.8, 1.1, 0.12, neonGold, 0);
  for (const px of [-5.5, 5.5]) {
    addVisualBox(chunk.nearGroup, x + px, groundY + 2.0, z - 13.08, 1.5, 2.2, 0.14, neonPink, 0);
  }
  addSolidBox(chunk, x + 9, groundY + 6.5, z - 13.8, 1.2, 11.0, 2.2, darkTrim, 0, "metal");
  addVisualBox(chunk.nearGroup, x + 9, groundY + 12.0, z - 14.9, 0.6, 9.5, 0.35, neonPink, 0);

  // Adjacent Retail Strip & Corner Cafe
  addSolidBox(chunk, x + 28, groundY, z + 2, 24, 7.5, 16, stripMat, 0, "concrete");
  addSolidBox(chunk, x + 28, groundY + 3.4, z - 7.2, 23, 0.4, 2.6, neonPink, 0, "metal");
  addStorefrontBay(chunk.nearGroup, x + 28, groundY, z + 2, 24, 16, Math.PI, darkTrim);

  addLodBox(chunk, x, groundY, z, 28, 28, 26, 0x998468);
  addLodBox(chunk, x + 28, groundY, z + 2, 24, 8, 16, 0x7e4237);
}

/** Midtown Prep High School & Turf Athletic Field (`x=-390, z=52`) */
function buildMidtownSchoolAndField(chunk: CityChunk, groundY: number): void {
  const x = -390;
  const z = 52;
  const brickMat = createFacadeMaterial("brick_red", 7, 3);
  const trimMat = new THREE.MeshStandardMaterial({ color: 0xcbd2d9, roughness: 0.8 });
  const fieldMat = new THREE.MeshStandardMaterial({ color: 0x2e7d32, roughness: 0.94 });
  const lineMat = new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.7 });
  const bleacherMat = new THREE.MeshStandardMaterial({ color: 0x64748b, roughness: 0.72, metalness: 0.3 });

  // 2-story U-shaped brick school building
  addSolidBox(chunk, x - 18, groundY, z - 4, 20, 9.2, 34, brickMat, 0, "concrete");
  addSolidBox(chunk, x - 4, groundY, z - 16, 16, 9.2, 10, brickMat, 0, "concrete");
  addSolidBox(chunk, x - 18, groundY + 9.2, z - 4, 21, 0.8, 35, trimMat, 0, "concrete");

  // Athletic Turf Field east of school building
  const fx = x + 20;
  const fz = z + 4;
  addSolidBox(chunk, fx, groundY - 0.1, fz, 34, 0.22, 48, fieldMat, 0, "dirt", false, true);
  // White yard stripes + goalposts + corner stadium floodlights
  for (let i = -3; i <= 3; i++) {
    addVisualBox(chunk.nearGroup, fx, groundY + 0.13, fz + i * 6, 28, 0.04, 0.25, lineMat, 0, false, false);
  }
  for (const gz of [fz - 22, fz + 22]) {
    addVisualBox(chunk.nearGroup, fx, groundY + 0.15, gz, 0.22, 2.5, 0.22, lineMat, 0);
    addVisualBox(chunk.nearGroup, fx, groundY + 2.6, gz, 5.8, 0.2, 0.2, lineMat, 0);
    addVisualBox(chunk.nearGroup, fx - 2.8, groundY + 2.6, gz, 0.2, 3.2, 0.2, lineMat, 0);
    addVisualBox(chunk.nearGroup, fx + 2.8, groundY + 2.6, gz, 0.2, 3.2, 0.2, lineMat, 0);
  }
  for (const [lx, lz] of [[fx - 18, fz - 22], [fx + 18, fz - 22], [fx - 18, fz + 22], [fx + 18, fz + 22]]) {
    addSolidBox(chunk, lx, groundY, lz, 0.45, 13.5, 0.45, bleacherMat, 0, "metal");
    addVisualBox(chunk.nearGroup, lx, groundY + 13.2, lz, 2.4, 0.9, 0.6, lineMat, 0);
  }
  // Bleachers along West edge of field + North Scoreboard Tower & School Entrance Awning
  for (let step = 0; step < 3; step++) {
    addSolidBox(chunk, fx - 18 + step * 0.9, groundY + step * 0.65, fz, 1.0, 0.65, 26, bleacherMat, 0, "metal");
  }
  addSolidBox(chunk, fx, groundY, fz - 25.5, 8.5, 6.2, 0.8, bleacherMat, 0, "metal");
  addVisualBox(chunk.nearGroup, fx, groundY + 4.4, fz - 25.0, 7.2, 2.4, 0.25, new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.4 }), 0);
  addStorefrontBay(chunk.nearGroup, x - 18, groundY, z - 4, 20, 34, Math.PI * 0.5, bleacherMat);

  addLodBox(chunk, x - 18, groundY, z - 4, 20, 10, 34, 0x824438);
}

/**
 * Registers Phase 3 Midtown & Commercial Districts onto the chunk dispatcher.
 */
export function registerMidtownDistrict(
  dispatcher: CityChunkDispatcher,
  roads: RoadNetwork,
  heightSystem: WorldHeightSystem,
  worldMin = -1200,
  chunkSize = 160,
): void {
  // 1. Mid-rise office & retail infill blocks
  for (const spec of MIDTOWN_MIDRISES) {
    const clearR = Math.hypot(spec.w, spec.d) * 0.5 + 2.0;
    if (!isFootprintClearOfRoads(roads, spec.x, spec.z, clearR)) continue;
    dispatcher.registerAtPoint(spec.x, spec.z, worldMin, chunkSize, (chunk, terrainAt) => {
      buildMidrise(chunk, spec, terrainAt(spec.x, spec.z));
    });
  }

  // 2. Westgate Grand Shopping Mall & Glass Atrium
  dispatcher.registerAtPoint(-402, -35, worldMin, chunkSize, (chunk, terrainAt) => {
    buildGrandMall(chunk, terrainAt(-402, -35));
  });

  // 3. St. Jude's Central Medical Center & Helipad
  dispatcher.registerAtPoint(-138, -252, worldMin, chunkSize, (chunk, terrainAt) => {
    buildMedicalCenter(chunk, terrainAt(-138, -252), heightSystem);
  });

  // 4. Westgate University Campus & Clocktower
  dispatcher.registerAtPoint(-165, -380, worldMin, chunkSize, (chunk, terrainAt) => {
    buildUniversityCampus(chunk, terrainAt(-165, -380));
  });

  // 5. Grand Regal Cinema & Retail Strip
  dispatcher.registerAtPoint(-342, -78, worldMin, chunkSize, (chunk, terrainAt) => {
    buildRegalCinemaAndStrip(chunk, terrainAt(-342, -78));
  });

  // 6. Midtown Prep School & Athletic Field
  dispatcher.registerAtPoint(-390, 52, worldMin, chunkSize, (chunk, terrainAt) => {
    buildMidtownSchoolAndField(chunk, terrainAt(-390, 52));
  });
}

export const MIDTOWN_LANDMARKS = [
  { id: "grand_mall", name: "Westgate Grand Mall & Atrium", x: -402, z: -35 },
  { id: "medical_center", name: "St. Jude's Medical Center", x: -138, z: -252 },
  { id: "university_campus", name: "Westgate University & Clocktower", x: -165, z: -380 },
  { id: "regal_cinema", name: "Grand Regal Cinema & Strip", x: -342, z: -78 },
  { id: "midtown_school", name: "Midtown Prep & Athletic Field", x: -390, z: 52 },
];
