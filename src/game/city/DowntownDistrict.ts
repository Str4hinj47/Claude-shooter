import * as THREE from "three";
import type { CityChunk } from "./ChunkStreamer";
import type { RoadNetwork } from "./RoadNetwork";
import type { WalkableSurface, WorldHeightSystem } from "./HeightSystem";
import {
  addLodBox,
  addSolidBox,
  addVisualBox,
  CityChunkDispatcher,
  createFacadeMaterial,
  isFootprintClearOfRoads,
  type FacadeStyle,
} from "./CityBuildingKit";

interface SkyscraperSpec {
  id: string;
  x: number;
  z: number;
  w: number;
  d: number;
  h: number;
  ry?: number;
  style: FacadeStyle;
  lodColor: number;
  crown?: "spire" | "stepped" | "helipad" | "flat";
  podiumH?: number;
}

const DOWNTOWN_TOWERS: SkyscraperSpec[] = [
  // NW Financial Plaza & Skyscraper Row
  { id: "sovereign_spire", x: -18, z: -238, w: 30, d: 30, h: 136, style: "glass_teal", lodColor: 0x3b6778, crown: "spire", podiumH: 14 },
  { id: "arcadian_west", x: -68, z: -295, w: 24, d: 24, h: 112, style: "glass_navy", lodColor: 0x2b4a69, crown: "stepped", podiumH: 12 },
  { id: "arcadian_east", x: -18, z: -328, w: 24, d: 24, h: 98, style: "glass_navy", lodColor: 0x2f5173, crown: "helipad", podiumH: 10 },
  { id: "sterling_legal", x: 26, z: -310, w: 22, d: 24, h: 86, style: "granite_dark", lodColor: 0x4f555e, crown: "stepped", podiumH: 10 },
  { id: "gold_exchange", x: -72, z: -198, w: 24, d: 24, h: 94, style: "glass_gold", lodColor: 0x7a6646, crown: "stepped", podiumH: 12 },
  { id: "metro_plaza", x: -118, z: -372, w: 22, d: 22, h: 78, style: "glass_slate", lodColor: 0x4a5966, crown: "spire", podiumH: 10 },

  // NE Civic & Reserve Block
  { id: "civic_north", x: 126, z: -342, w: 22, d: 22, h: 74, style: "limestone", lodColor: 0xb0a998, crown: "stepped", podiumH: 10 },
  { id: "civic_annex", x: 214, z: -214, w: 20, d: 24, h: 48, style: "brick_tan", lodColor: 0x8d745a, crown: "flat", podiumH: 6 },

  // East Riverfront Corporate Row
  { id: "river_tower_1", x: 348, z: -145, w: 24, d: 24, h: 84, style: "glass_teal", lodColor: 0x3b6778, crown: "helipad", podiumH: 10 },
  { id: "river_tower_2", x: 356, z: -225, w: 22, d: 22, h: 68, style: "glass_slate", lodColor: 0x52616e, crown: "stepped", podiumH: 9 },
  { id: "river_tower_3", x: 334, z: -310, w: 22, d: 20, h: 56, style: "granite_dark", lodColor: 0x4a4f57, crown: "flat", podiumH: 8 },
  { id: "river_hotel", x: 358, z: 145, w: 26, d: 22, h: 52, style: "glass_gold", lodColor: 0x806a48, crown: "helipad", podiumH: 8 },

  // SW Downtown / Viaduct Bridgehead
  { id: "corner_heritage", x: 18, z: 12, w: 20, d: 20, h: 42, style: "brick_red", lodColor: 0x7c4036, crown: "flat", podiumH: 6 },
  { id: "viaduct_annex_1", x: -162, z: -8, w: 22, d: 22, h: 62, style: "glass_slate", lodColor: 0x4d5b68, crown: "stepped", podiumH: 9 },
  { id: "viaduct_annex_2", x: -175, z: 68, w: 22, d: 20, h: 52, style: "concrete_mod", lodColor: 0x7b8087, crown: "flat", podiumH: 7 },
];

function buildSkyscraper(chunk: CityChunk, spec: SkyscraperSpec, groundY: number): void {
  const { x, z, w, d, h, style, lodColor } = spec;
  const ry = spec.ry ?? 0;
  const podiumH = spec.podiumH ?? 10;
  const darkMetal = new THREE.MeshStandardMaterial({ color: 0x1e242b, roughness: 0.42, metalness: 0.72 });
  const lobbyMat = new THREE.MeshStandardMaterial({ color: 0x223240, roughness: 0.25, metalness: 0.6 });
  const padMat = new THREE.MeshStandardMaterial({ color: 0x3b4046, roughness: 0.85, metalness: 0.1 });
  const helipadYellow = new THREE.MeshStandardMaterial({
    color: 0xf5c542,
    emissive: 0xd9a11e,
    emissiveIntensity: 0.35,
    roughness: 0.5,
  });
  const beaconMat = new THREE.MeshStandardMaterial({
    color: 0xff3b30,
    emissive: 0xff2a1f,
    emissiveIntensity: 2.5,
    roughness: 0.25,
  });

  // Podium base
  const podMat = createFacadeMaterial("granite_dark", Math.round(w / 5), Math.max(1, Math.round(podiumH / 4)));
  addSolidBox(chunk, x, groundY, z, w, podiumH, d, podMat, ry, "concrete");

  // Main tower shaft
  const shaftW = w * 0.84;
  const shaftD = d * 0.84;
  const shaftH = Math.max(12, h - podiumH - (spec.crown === "stepped" ? 16 : 0));
  const shaftMat = createFacadeMaterial(style, Math.round(shaftW / 4.5), Math.max(2, Math.round(shaftH / 4.5)));
  addSolidBox(chunk, x, groundY + podiumH, z, shaftW, shaftH, shaftD, shaftMat, ry, "concrete");

  // Ground-floor recessed dark glass lobby band & canopy
  addVisualBox(chunk.nearGroup, x, groundY + 0.1, z, w + 0.4, 3.6, d + 0.4, lobbyMat, ry, false, true);
  addVisualBox(chunk.nearGroup, x, groundY + 3.8, z, w + 1.8, 0.45, d + 1.8, darkMetal, ry, true, true);

  let topY = groundY + podiumH + shaftH;

  if (spec.crown === "stepped") {
    const tierH = 16;
    const tierMat = createFacadeMaterial(style, Math.round((shaftW * 0.68) / 4.5), 3);
    addSolidBox(chunk, x, topY, z, shaftW * 0.68, tierH, shaftD * 0.68, tierMat, ry, "concrete");
    topY += tierH;
  }

  // Parapet trim + rooftop mechanical penthouse
  addVisualBox(chunk.nearGroup, x, topY, z, shaftW * 0.7 + 0.6, 1.1, shaftD * 0.7 + 0.6, darkMetal, ry);
  addVisualBox(chunk.nearGroup, x, topY, z, shaftW * 0.34, 3.2, shaftD * 0.34, padMat, ry);

  if (spec.crown === "spire") {
    const spireBase = addVisualBox(chunk.nearGroup, x, topY + 3.2, z, 3.2, 10, 3.2, darkMetal, ry);
    void spireBase;
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.55, 22, 8), darkMetal);
    mast.position.set(x, topY + 13.2 + 11, z);
    mast.castShadow = true;
    chunk.nearGroup.add(mast);

    const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.45, 8, 6), beaconMat);
    beacon.position.set(x, topY + 35.5, z);
    chunk.nearGroup.add(beacon);
  } else if (spec.crown === "helipad") {
    const pad = new THREE.Mesh(new THREE.CylinderGeometry(7.2, 7.6, 0.35, 20), padMat);
    pad.position.set(x, topY + 0.2, z);
    pad.receiveShadow = true;
    chunk.nearGroup.add(pad);

    const ring = new THREE.Mesh(new THREE.RingGeometry(5.6, 6.2, 24), helipadYellow);
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(x, topY + 0.4, z);
    chunk.nearGroup.add(ring);

    // H marking
    addVisualBox(chunk.nearGroup, x - 1.6, topY + 0.38, z, 0.65, 0.05, 4.4, helipadYellow, ry, false, false);
    addVisualBox(chunk.nearGroup, x + 1.6, topY + 0.38, z, 0.65, 0.05, 4.4, helipadYellow, ry, false, false);
    addVisualBox(chunk.nearGroup, x, topY + 0.38, z, 3.2, 0.05, 0.65, helipadYellow, ry, false, false);
  }

  // Distant LOD skyline silhouette
  addLodBox(chunk, x, groundY, z, w, h, d, lodColor, ry);
}

/** Legion Square Central Civic Plaza + Fountain + Sculptural Spire + Metro Canopy */
function buildLegionSquareAndMetro(chunk: CityChunk, groundY: number): void {
  const x = 12;
  const z = -172;
  const graniteMat = new THREE.MeshStandardMaterial({ color: 0xb9b4aa, roughness: 0.85, metalness: 0.05 });
  const darkStoneMat = new THREE.MeshStandardMaterial({ color: 0x565a61, roughness: 0.8, metalness: 0.1 });
  const turfMat = new THREE.MeshStandardMaterial({ color: 0x436d3a, roughness: 0.94, metalness: 0.0 });
  const waterMat = new THREE.MeshStandardMaterial({
    color: 0x2a8aa6,
    emissive: 0x104456,
    emissiveIntensity: 0.25,
    roughness: 0.18,
    metalness: 0.25,
  });
  const bronzeMat = new THREE.MeshStandardMaterial({ color: 0xb08a48, roughness: 0.35, metalness: 0.82 });

  // Tiered plaza deck (walkable)
  addSolidBox(chunk, x, groundY - 0.1, z, 52, 0.3, 52, graniteMat, 0, "concrete", false, true);

  // Corner landscaped planter beds
  for (const [ox, oz] of [[-18, -18], [18, -18], [-18, 18], [18, 18]]) {
    addSolidBox(chunk, x + ox, groundY + 0.2, z + oz, 10, 0.5, 10, darkStoneMat, 0, "concrete");
    addVisualBox(chunk.nearGroup, x + ox, groundY + 0.65, z + oz, 8.8, 0.12, 8.8, turfMat, 0, false, true);
  }

  // Central reflecting pool & bronze civic monument
  const rim = new THREE.Mesh(new THREE.CylinderGeometry(9.6, 10.2, 0.55, 28), darkStoneMat);
  rim.position.set(x, groundY + 0.45, z);
  rim.receiveShadow = true;
  chunk.nearGroup.add(rim);

  const basin = new THREE.Mesh(new THREE.CylinderGeometry(8.6, 8.6, 0.45, 28), waterMat);
  basin.position.set(x, groundY + 0.54, z);
  chunk.nearGroup.add(basin);

  addSolidBox(chunk, x, groundY + 0.2, z, 3.2, 2.2, 3.2, darkStoneMat, 0, "concrete");
  const sculpture = new THREE.Mesh(new THREE.OctahedronGeometry(2.1, 0), bronzeMat);
  sculpture.position.set(x, groundY + 4.4, z);
  sculpture.scale.set(0.75, 1.85, 0.75);
  sculpture.castShadow = true;
  chunk.nearGroup.add(sculpture);

  // Downtown Metro Station entrance canopy at (24, -134)
  const mx = 24;
  const mz = -134;
  const steelMat = new THREE.MeshStandardMaterial({ color: 0x26323d, roughness: 0.4, metalness: 0.8 });
  const glassCanopyMat = new THREE.MeshStandardMaterial({
    color: 0x76b8d4,
    transparent: true,
    opacity: 0.55,
    roughness: 0.15,
    metalness: 0.35,
  });
  const metroBlueMat = new THREE.MeshStandardMaterial({
    color: 0x2563eb,
    emissive: 0x1d4ed8,
    emissiveIntensity: 1.4,
    roughness: 0.3,
  });

  addSolidBox(chunk, mx - 4.2, groundY, mz, 0.5, 3.6, 11, steelMat, 0, "metal");
  addSolidBox(chunk, mx + 4.2, groundY, mz, 0.5, 3.6, 11, steelMat, 0, "metal");
  const arch = new THREE.Mesh(
    new THREE.CylinderGeometry(4.5, 4.5, 11.4, 14, 1, false, 0, Math.PI),
    glassCanopyMat,
  );
  arch.rotation.z = Math.PI / 2;
  arch.rotation.y = Math.PI / 2;
  arch.position.set(mx, groundY + 3.5, mz);
  chunk.nearGroup.add(arch);

  // Glowing Metro sign totem
  addSolidBox(chunk, mx + 5.6, groundY, mz + 5.2, 0.7, 5.2, 0.7, steelMat, 0, "metal");
  addVisualBox(chunk.nearGroup, mx + 5.6, groundY + 4.4, mz + 5.2, 1.4, 1.4, 0.85, metroBlueMat, 0);
}

/** Westgate City Hall & Federal Courthouse (NE Civic Block) */
function buildCityHall(chunk: CityChunk, groundY: number): void {
  const x = 158;
  const z = -162;
  const stoneMat = createFacadeMaterial("limestone", 4, 2);
  const trimMat = new THREE.MeshStandardMaterial({ color: 0xd9d2c3, roughness: 0.78, metalness: 0.05 });
  const copperDomeMat = new THREE.MeshStandardMaterial({ color: 0x4d8a78, roughness: 0.52, metalness: 0.45 });
  const goldMat = new THREE.MeshStandardMaterial({ color: 0xd6ac49, roughness: 0.3, metalness: 0.85 });

  // Walkable tiered front granite stairs facing West (-X toward art_downtown_n)
  for (let s = 0; s < 5; s++) {
    addSolidBox(chunk, x - 20.5 + s * 1.1, groundY, z, 2.2, (s + 1) * 0.34, 22, trimMat, 0, "concrete");
  }

  // Main courthouse body & portico deck
  addSolidBox(chunk, x, groundY, z, 38, 17, 30, stoneMat, 0, "concrete");
  addSolidBox(chunk, x, groundY, z - 20, 26, 14, 12, stoneMat, 0, "concrete");
  addSolidBox(chunk, x, groundY, z + 20, 26, 14, 12, stoneMat, 0, "concrete");

  // 6 Front Colonnade Pillars
  for (let i = -2.5; i <= 2.5; i += 1) {
    const col = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.72, 13.5, 12), trimMat);
    col.position.set(x - 19.6, groundY + 1.7 + 6.75, z + i * 3.6);
    col.castShadow = true;
    col.receiveShadow = true;
    chunk.nearGroup.add(col);
    chunk.colliders.push(col);
  }
  addSolidBox(chunk, x - 19.4, groundY + 15.2, z, 4.2, 2.2, 22, trimMat, 0, "concrete");

  // Central drum & copper dome
  const drum = new THREE.Mesh(new THREE.CylinderGeometry(9.5, 10.2, 8.5, 20), trimMat);
  drum.position.set(x, groundY + 17 + 4.25, z);
  drum.castShadow = true;
  chunk.nearGroup.add(drum);

  const dome = new THREE.Mesh(new THREE.SphereGeometry(9.4, 20, 12, 0, Math.PI * 2, 0, Math.PI * 0.5), copperDomeMat);
  dome.position.set(x, groundY + 25.5, z);
  dome.castShadow = true;
  chunk.nearGroup.add(dome);

  const lantern = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.4, 4.2, 10), goldMat);
  lantern.position.set(x, groundY + 35.8, z);
  chunk.nearGroup.add(lantern);

  addLodBox(chunk, x, groundY, z, 38, 22, 54, 0xc7c0b0);
  addLodBox(chunk, x, groundY + 22, z, 18, 16, 18, 0x578c7c);
}

/** Union Depository / Reserve Bank Fortress */
function buildUnionDepository(chunk: CityChunk, groundY: number): void {
  const x = 132;
  const z = -252;
  const graniteMat = createFacadeMaterial("granite_dark", 5, 4);
  const pierMat = new THREE.MeshStandardMaterial({ color: 0x5c6066, roughness: 0.78, metalness: 0.12 });
  const bronzeMat = new THREE.MeshStandardMaterial({ color: 0x9c7b43, roughness: 0.35, metalness: 0.85 });

  // Heavy vault core
  addSolidBox(chunk, x, groundY, z, 36, 46, 32, graniteMat, 0, "concrete");

  // Deeply recessed colonnade piers along West & South facades
  for (let i = -3; i <= 3; i++) {
    addSolidBox(chunk, x - 18.6, groundY, z + i * 4.4, 1.6, 44, 1.4, pierMat, 0, "concrete");
  }
  addVisualBox(chunk.nearGroup, x, groundY + 45.2, z, 38.4, 2.2, 34.4, bronzeMat, 0);

  // Armored truck loading bay canopy + security bollards along West plaza
  addSolidBox(chunk, x - 21, groundY + 5.5, z + 6, 4.5, 0.8, 10, pierMat, 0, "concrete");
  for (let i = -3; i <= 3; i++) {
    addSolidBox(chunk, x - 22.5, groundY, z + i * 4.2, 0.45, 1.1, 0.45, bronzeMat, 0, "metal");
  }

  addLodBox(chunk, x, groundY, z, 38, 48, 34, 0x545860);
}

/** Westgate Police HQ + Impound Yard */
function buildPoliceHQ(chunk: CityChunk, groundY: number): void {
  const px = 146;
  const pz = 36;
  const pdBody = createFacadeMaterial("concrete_mod", 4, 2);
  const pdTrim = new THREE.MeshStandardMaterial({ color: 0x263240, roughness: 0.55, metalness: 0.4 });
  const pdBlue = new THREE.MeshStandardMaterial({
    color: 0x3b82f6,
    emissive: 0x2563eb,
    emissiveIntensity: 1.6,
    roughness: 0.25,
  });
  const fenceMat = new THREE.MeshStandardMaterial({ color: 0x3d444d, roughness: 0.6, metalness: 0.7 });

  addSolidBox(chunk, px, groundY, pz, 32, 16, 22, pdBody, 0, "concrete");
  addVisualBox(chunk.nearGroup, px, groundY + 13.8, pz, 32.4, 0.85, 22.4, pdBlue, 0);
  addSolidBox(chunk, px - 17.5, groundY + 4.2, pz, 3.6, 0.6, 10, pdTrim, 0, "metal");
  addVisualBox(chunk.nearGroup, px + 4, groundY + 16, pz, 8, 2.5, 6, pdTrim, 0);
  addLodBox(chunk, px, groundY, pz, 32, 17, 22, 0x738294);

  // Impound Lot adjacent at (146, 66)
  const ix = 146;
  const iz = 66;
  const asphalt = new THREE.MeshStandardMaterial({ color: 0x32363c, roughness: 0.9 });
  addSolidBox(chunk, ix, groundY - 0.1, iz, 30, 0.2, 20, asphalt, 0, "concrete", false, true);
  addSolidBox(chunk, ix, groundY, iz + 10, 30, 2.4, 0.4, fenceMat, 0, "metal");
  addSolidBox(chunk, ix + 15, groundY, iz, 0.4, 2.4, 20, fenceMat, 0, "metal");
  addSolidBox(chunk, ix - 15, groundY, iz + 5.5, 0.4, 2.4, 9, fenceMat, 0, "metal");
  addSolidBox(chunk, ix - 15, groundY, iz - 6.5, 0.4, 2.4, 7, fenceMat, 0, "metal");
  addSolidBox(chunk, ix - 13.5, groundY, iz - 2, 2.6, 2.8, 2.6, pdTrim, 0, "metal");
}

/** Downtown Fire Station #1 */
function buildFireStation(chunk: CityChunk, groundY: number): void {
  const fx = 132;
  const fz = 128;
  const brickMat = createFacadeMaterial("brick_red", 4, 2);
  const doorRedMat = new THREE.MeshStandardMaterial({ color: 0xb91c1c, roughness: 0.45, metalness: 0.35 });
  const roofMat = new THREE.MeshStandardMaterial({ color: 0x45494f, roughness: 0.85 });

  addSolidBox(chunk, fx, groundY, fz, 24, 11, 20, brickMat, 0, "concrete");
  addVisualBox(chunk.nearGroup, fx, groundY + 11, fz, 24.6, 0.6, 20.6, roofMat, 0);
  for (let b = -1; b <= 1; b++) {
    addVisualBox(chunk.nearGroup, fx - 12.05, groundY + 0.1, fz + b * 5.8, 0.3, 5.2, 4.4, doorRedMat, 0);
  }
  addSolidBox(chunk, fx + 8, groundY + 11, fz - 6, 5.2, 10.5, 5.2, brickMat, 0, "concrete");
  addLodBox(chunk, fx, groundY, fz, 24, 13, 20, 0x8a3d33);
}

/** 3-Level Walkable Concrete Parking Deck with sloped ramps */
function buildParkingDeck(chunk: CityChunk, groundY: number, heightSystem: WorldHeightSystem): void {
  const x = 224;
  const z = 52;
  const w = 32;
  const d = 42;
  const concMat = new THREE.MeshStandardMaterial({ color: 0x81868d, roughness: 0.88, metalness: 0.06 });
  const trimMat = new THREE.MeshStandardMaterial({ color: 0x5a5f66, roughness: 0.82, metalness: 0.1 });
  const stripeMat = new THREE.MeshStandardMaterial({ color: 0xeab308, roughness: 0.65 });

  const h1 = 3.8;
  const h2 = 7.6;

  // Ground pad
  addSolidBox(chunk, x, groundY - 0.1, z, w, 0.25, d, concMat, 0, "concrete", false, true);

  // East parking bay slabs (x + 8, width 16, full depth 42)
  addSolidBox(chunk, x + 8, groundY + h1 - 0.45, z, 16, 0.5, d, concMat, 0, "concrete");
  addSolidBox(chunk, x + 8, groundY + h2 - 0.45, z, 16, 0.5, d, concMat, 0, "concrete");

  // L2 North turning apron (connects Ramp 1 top at x-11.5,z-2 to East L2 & Ramp 2 start at x-3.5,z-2)
  addSolidBox(chunk, x - 7.5, groundY + h1 - 0.45, z - 11.5, 15, 0.5, 19, concMat, 0, "concrete");

  // Roof South turning apron (connects Ramp 2 top at x-3.5,z+14 to East Roof)
  addSolidBox(chunk, x - 3.5, groundY + h2 - 0.45, z + 17.5, 7, 0.5, 7, concMat, 0, "concrete");

  // Perimeter safety parapets on L2 & Roof (kept clear of ramp openings)
  for (const levelY of [groundY + h1, groundY + h2]) {
    addSolidBox(chunk, x + 15.7, levelY, z, 0.6, 1.0, d, trimMat, 0, "concrete");
  }
  addSolidBox(chunk, x, groundY + h1, z - 20.7, w, 1.0, 0.6, trimMat, 0, "concrete");
  addSolidBox(chunk, x + 8, groundY + h1, z + 20.7, 16, 1.0, 0.6, trimMat, 0, "concrete");
  addSolidBox(chunk, x - 15.2, groundY + h1, z - 11.5, 0.6, 1.0, 19, trimMat, 0, "concrete");

  addSolidBox(chunk, x + 8, groundY + h2, z - 20.7, 16, 1.0, 0.6, trimMat, 0, "concrete");
  addSolidBox(chunk, x + 4.5, groundY + h2, z + 20.7, 23, 1.0, 0.6, trimMat, 0, "concrete");
  addSolidBox(chunk, x + 0.3, groundY + h2, z - 3.5, 0.6, 1.0, 35, trimMat, 0, "concrete");

  // Structural columns placed strictly on bay grid lines (never inside ramps)
  for (const cz of [z - 20, z - 2, z + 20]) {
    addSolidBox(chunk, x - 15.4, groundY, cz, 1.0, h1, 1.0, trimMat, 0, "concrete");
    addSolidBox(chunk, x - 7.5, groundY, cz, 1.0, cz === z + 20 ? h2 : h1, 1.0, trimMat, 0, "concrete");
    addSolidBox(chunk, x + 0.5, groundY, cz, 1.0, h2, 1.0, trimMat, 0, "concrete");
    addSolidBox(chunk, x + 15.4, groundY, cz, 1.0, h2, 1.0, trimMat, 0, "concrete");
  }
  addSolidBox(chunk, x + 12.5, groundY, z - 17, 5.2, h2 + 3.0, 5.2, trimMat, 0, "concrete");

  // Side-by-side non-overlapping walkable ramps:
  // Ramp 1 (West lane x-11.5): z in [z+18 .. z-2] rising Ground -> L2
  // Ramp 2 (Center-West lane x-3.5): z in [z-2 .. z+14] rising L2 -> Roof
  const addRamp = (id: string, rx: number, zStart: number, zEnd: number, yStart: number, yEnd: number) => {
    const len = Math.abs(zEnd - zStart);
    const dy = yEnd - yStart;
    const hyp = Math.hypot(len, dy);
    const pitch = Math.atan2(dy, len) * (zEnd > zStart ? -1 : 1);
    const rampMesh = new THREE.Mesh(new THREE.BoxGeometry(7.0, 0.4, hyp), concMat);
    rampMesh.position.set(rx, (yStart + yEnd) * 0.5 - 0.2, (zStart + zEnd) * 0.5);
    rampMesh.rotation.x = pitch;
    rampMesh.castShadow = true;
    rampMesh.receiveShadow = true;
    rampMesh.userData.kind = "concrete";
    chunk.nearGroup.add(rampMesh);
    chunk.colliders.push(rampMesh);

    const minZ = Math.min(zStart, zEnd);
    const maxZ = Math.max(zStart, zEnd);
    const surf: WalkableSurface = {
      id,
      minX: rx - 3.6,
      maxX: rx + 3.6,
      minZ,
      maxZ,
      minY: Math.min(yStart, yEnd) - 0.4,
      maxY: Math.max(yStart, yEnd) + 0.4,
      heightAt: (qx, qz) => {
        if (Math.abs(qx - rx) > 3.6 || qz < minZ || qz > maxZ) return null;
        const t = (qz - zStart) / (zEnd - zStart);
        return yStart + t * (yEnd - yStart);
      },
    };
    heightSystem.addSurface(surf);
  };

  addRamp("dt_park_ramp1", x - 11.5, z + 18, z - 2, groundY, groundY + h1);
  addRamp("dt_park_ramp2", x - 3.5, z - 2, z + 14, groundY + h1, groundY + h2);

  // Rooftop yellow parking stall stripes
  for (let i = -3; i <= 3; i++) {
    addVisualBox(chunk.nearGroup, x + 9.5, groundY + h2 + 0.06, z + i * 4.5, 4.6, 0.04, 0.16, stripeMat, 0, false, false);
  }

  addLodBox(chunk, x, groundY, z, w, h2 + 1.5, d, 0x797e85);
}

/** Walkable Service Alley between twin riverfront commercial blocks */
function buildRiverfrontAlleyBlock(chunk: CityChunk, groundY: number): void {
  const matA = createFacadeMaterial("brick_red", 4, 4);
  const matB = createFacadeMaterial("concrete_mod", 4, 4);
  const dumpsterMat = new THREE.MeshStandardMaterial({ color: 0x265c3a, roughness: 0.72, metalness: 0.35 });
  const hvacMat = new THREE.MeshStandardMaterial({ color: 0x7b828a, roughness: 0.55, metalness: 0.6 });
  const neonMat = new THREE.MeshStandardMaterial({
    color: 0xff4d88,
    emissive: 0xff2e74,
    emissiveIntensity: 1.9,
    roughness: 0.3,
  });

  // Two buildings flanking a 10m walkable alley at x = 362
  addSolidBox(chunk, 342, groundY, 44, 22, 42, 32, matA, 0, "concrete");
  addSolidBox(chunk, 384, groundY, 44, 22, 34, 32, matB, 0, "concrete");
  addLodBox(chunk, 342, groundY, 44, 22, 42, 32, 0x7e4237);
  addLodBox(chunk, 384, groundY, 44, 22, 34, 32, 0x858a91);

  // Alley props: dumpsters, AC units, glowing neon sign
  addSolidBox(chunk, 355.5, groundY, 34, 2.2, 1.4, 3.2, dumpsterMat, 0, "metal");
  addSolidBox(chunk, 369.5, groundY, 52, 2.2, 1.4, 3.2, dumpsterMat, 0, "metal");
  addSolidBox(chunk, 354.5, groundY + 3.2, 46, 1.1, 1.0, 1.4, hvacMat, 0, "metal");
  addVisualBox(chunk.nearGroup, 353.3, groundY + 4.4, 31, 0.3, 1.2, 4.2, neonMat, 0);
}

/**
 * Registers all Phase 2 Downtown Financial & Civic Core blocks onto the chunk dispatcher.
 */
export function registerDowntownDistrict(
  dispatcher: CityChunkDispatcher,
  roads: RoadNetwork,
  heightSystem: WorldHeightSystem,
  worldMin = -1200,
  chunkSize = 160,
): void {
  // 1. Register Downtown Skyscrapers (road/viaduct-cleared)
  for (const tower of DOWNTOWN_TOWERS) {
    const clearR = Math.hypot(tower.w, tower.d) * 0.5 + 2.0;
    if (!isFootprintClearOfRoads(roads, tower.x, tower.z, clearR)) continue;
    dispatcher.registerAtPoint(tower.x, tower.z, worldMin, chunkSize, (chunk, terrainAt) => {
      const gy = terrainAt(tower.x, tower.z);
      buildSkyscraper(chunk, tower, gy);
    });
  }

  // 2. Legion Square Plaza & Metro Station
  dispatcher.registerAtPoint(12, -172, worldMin, chunkSize, (chunk, terrainAt) => {
    buildLegionSquareAndMetro(chunk, terrainAt(12, -172));
  });

  // 3. City Hall & Courthouse
  dispatcher.registerAtPoint(158, -162, worldMin, chunkSize, (chunk, terrainAt) => {
    buildCityHall(chunk, terrainAt(158, -162));
  });

  // 4. Union Depository / Reserve Bank
  dispatcher.registerAtPoint(132, -252, worldMin, chunkSize, (chunk, terrainAt) => {
    buildUnionDepository(chunk, terrainAt(132, -252));
  });

  // 5. Police HQ & Impound Yard
  dispatcher.registerAtPoint(146, 45, worldMin, chunkSize, (chunk, terrainAt) => {
    buildPoliceHQ(chunk, terrainAt(146, 45));
  });

  // 6. Downtown Fire Station #1
  dispatcher.registerAtPoint(132, 128, worldMin, chunkSize, (chunk, terrainAt) => {
    buildFireStation(chunk, terrainAt(132, 128));
  });

  // 6. Walkable 3-Level Parking Deck
  dispatcher.registerAtPoint(224, 52, worldMin, chunkSize, (chunk, terrainAt) => {
    buildParkingDeck(chunk, terrainAt(224, 52), heightSystem);
  });

  // 7. Riverside Corporate & Walkable Alley
  dispatcher.registerAtPoint(362, 44, worldMin, chunkSize, (chunk, terrainAt) => {
    buildRiverfrontAlleyBlock(chunk, terrainAt(362, 44));
  });
}

export const DOWNTOWN_LANDMARKS = [
  { id: "legion_square", name: "Legion Square & Metro", x: 12, z: -172 },
  { id: "sovereign_spire", name: "Westgate Sovereign Spire", x: -18, z: -238 },
  { id: "city_hall", name: "City Hall & Courthouse", x: 158, z: -162 },
  { id: "union_depository", name: "Union Depository Bank", x: 132, z: -252 },
  { id: "police_hq", name: "Westgate Police HQ", x: 146, z: 36 },
  { id: "fire_station", name: "Downtown Fire Station #1", x: 132, z: 128 },
  { id: "parking_deck", name: "Downtown 3-Level Parking Deck", x: 224, z: 52 },
  { id: "river_alley", name: "Riverfront Corporate & Alley", x: 362, z: 44 },
];
