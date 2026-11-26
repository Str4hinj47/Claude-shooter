import * as THREE from "three";
import { materialFor } from "../kit/surface";
import type { CityChunk } from "./ChunkStreamer";
import type { WalkableSurface, WorldHeightSystem } from "./HeightSystem";
import type { RoadNetwork } from "./RoadNetwork";
import type { TerrainHeightFn } from "./HeightSystem";
import {
  CityChunkDispatcher,
  addHiddenColliderBox,
  addLodBox,
  addSolidBox,
  addVisualBox,
  isFootprintClearOfRoads,
  registerNightGlowMaterial,
} from "./CityBuildingKit";
import { buildGrammarFacadeShell } from "./FacadeGrammar";

interface MansionSpec {
  id: string;
  x: number;
  z: number;
  w: number;
  d: number;
  yaw: number;
}

const FOOTHILL_MANSIONS: MansionSpec[] = [
  { id: "fh_villa_1", x: -458, z: -735, w: 26, d: 18, yaw: 0.25 },
  { id: "fh_villa_2", x: -378, z: -835, w: 28, d: 18, yaw: -0.15 },
  { id: "fh_villa_3", x: -245, z: -868, w: 30, d: 20, yaw: 0.05 },
  { id: "fh_villa_4", x: -110, z: -848, w: 28, d: 18, yaw: -0.08 },
  { id: "fh_villa_5", x: 35, z: -846, w: 30, d: 20, yaw: 0.12 },
  { id: "fh_villa_6", x: 175, z: -822, w: 28, d: 18, yaw: -0.2 },
  { id: "fh_villa_7", x: 295, z: -792, w: 26, d: 18, yaw: -0.35 },
];

/** Griffith-style Westgate Observatory on Summit Mesa (`x=-120, z=-1018`) */
function buildObservatory(chunk: CityChunk, groundY: number, heightSystem: WorldHeightSystem): void {
  const x = -120;
  const z = -1018;
  const smoothWhite = materialFor(0xeae6df, { roughness: 0.72, metalness: 0.06, family: "stone", seed: 904 });
  const domeCopper = materialFor(0x3b6e6c, { roughness: 0.42, metalness: 0.48, family: "metal", seed: 905 });
  const terraceMat = materialFor(0xcbc5ba, { roughness: 0.84, family: "stone", seed: 906, repeat: 10 });
  const darkMetal = materialFor(0x2a313a, { roughness: 0.5, metalness: 0.55, family: "metal", seed: 907 });

  // Grand observation plaza apron & South scenic overlook terrace (`WalkableSurface`)
  addSolidBox(chunk, x, groundY - 0.5, z + 18, 66, 0.7, 52, terraceMat, 0, "concrete", false, true);
  // Classical front portico colonnade + overlook perimeter stone balustrade
  for (let i = -2; i <= 2; i++) {
    const col = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.54, 9.2, 12), smoothWhite);
    col.position.set(x + i * 4.2, groundY + 4.6, z + 13.5);
    col.castShadow = true;
    chunk.nearGroup.add(col);
  }
  addVisualBox(chunk.nearGroup, x, groundY + 9.2, z + 13.5, 21, 1.4, 3.6, smoothWhite, 0);
  addVisualBox(chunk.nearGroup, x, groundY + 0.25, z + 43.4, 65, 1.05, 0.45, smoothWhite, 0);
  addVisualBox(chunk.nearGroup, x - 32.5, groundY + 0.25, z + 18, 0.45, 1.05, 51, smoothWhite, 0);
  addVisualBox(chunk.nearGroup, x + 32.5, groundY + 0.25, z + 18, 0.45, 1.05, 51, smoothWhite, 0);

  // Main central rotunda + flanking East/West exhibit wings (classical limestone facade grammar)
  addHiddenColliderBox(chunk, x, groundY, z, 28, 11.5, 24, 0, "concrete");
  buildGrammarFacadeShell(chunk.nearGroup, {
    x,
    yBase: groundY,
    z,
    w: 28,
    h: 11.5,
    d: 24,
    style: "limestone",
    kindOverride: "classical",
    storefront: false,
    maxFloors: 3,
    maxBays: 6,
  });
  for (const dx of [-24, 24]) {
    addHiddenColliderBox(chunk, x + dx, groundY, z + 4, 22, 8.2, 16, 0, "concrete");
    buildGrammarFacadeShell(chunk.nearGroup, {
      x: x + dx,
      yBase: groundY,
      z: z + 4,
      w: 22,
      h: 8.2,
      d: 16,
      style: "limestone",
      kindOverride: "grid",
      storefront: false,
      maxFloors: 2,
      maxBays: 5,
    });
  }

  // Main Copper Planetarium Dome + Twin Side Domes + Observatory Slit Rib & Plaza Sundial
  const mainDome = new THREE.Mesh(new THREE.SphereGeometry(11.5, 22, 14, 0, Math.PI * 2, 0, Math.PI * 0.52), domeCopper);
  mainDome.position.set(x, groundY + 11.2, z);
  mainDome.castShadow = true;
  mainDome.receiveShadow = true;
  chunk.nearGroup.add(mainDome);
  const shutterRib = new THREE.Mesh(new THREE.TorusGeometry(11.6, 0.38, 8, 20, Math.PI), darkMetal);
  shutterRib.rotation.y = Math.PI * 0.5;
  shutterRib.position.set(x, groundY + 11.2, z);
  chunk.nearGroup.add(shutterRib);

  for (const dx of [-24, 24]) {
    const sideDome = new THREE.Mesh(new THREE.SphereGeometry(6.2, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.52), domeCopper);
    sideDome.position.set(x + dx, groundY + 8.0, z + 4);
    sideDome.castShadow = true;
    chunk.nearGroup.add(sideDome);
  }
  // Plaza astronomical brass sundial & stone step pedestal
  const brassMat = new THREE.MeshStandardMaterial({ color: 0xd6ac49, roughness: 0.28, metalness: 0.85 });
  const dialBase = new THREE.Mesh(new THREE.CylinderGeometry(2.4, 2.8, 0.7, 16), smoothWhite);
  dialBase.position.set(x, groundY + 0.55, z + 27);
  chunk.nearGroup.add(dialBase);
  addVisualBox(chunk.nearGroup, x, groundY + 1.85, z + 27, 0.16, 2.2, 1.4, brassMat, 0);

  // Telescope barrel protruding from North-East rim of main dome
  const scope = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.3, 10, 12), darkMetal);
  scope.position.set(x + 4.5, groundY + 18.5, z + 6.5);
  scope.rotation.x = 0.75;
  scope.castShadow = true;
  chunk.nearGroup.add(scope);

  // South Observation Balcony deck overlooking Westgate Bay
  const deckY = groundY + 0.25;
  const obsSurf: WalkableSurface = {
    id: "fh_observatory_terrace",
    minX: x - 33,
    maxX: x + 33,
    minZ: z - 8,
    maxZ: z + 44,
    minY: groundY - 1.0,
    maxY: deckY + 1.0,
    heightAt: () => deckY,
  };
  heightSystem.addSurface(obsSurf);

  addLodBox(chunk, x, groundY, z, 68, 22, 26, 0xd8d3c9);
}

/** Hollywood-style 14m white WESTGATE hillside sign (`x=30..184, z=-892`) */
function buildWestgateHillSign(chunk: CityChunk, terrainAt: TerrainHeightFn): void {
  const letters = ["W", "E", "S", "T", "G", "A", "T", "E"];
  const startX = 36;
  const stepX = 20;
  const z = -892;

  const whiteSign = registerNightGlowMaterial(
    new THREE.MeshStandardMaterial({
      color: 0xf8fafc,
      roughness: 0.48,
      metalness: 0.08,
      emissive: 0xe2e8f0,
      emissiveIntensity: 0.12,
    }),
    0.12,
    1.35,
  );
  const trussMat = new THREE.MeshStandardMaterial({ color: 0x475569, roughness: 0.7, metalness: 0.45 });

  const addBar = (cx: number, cy: number, cz: number, w: number, h: number, rotZ = 0) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, 1.2), whiteSign);
    m.position.set(cx, cy, cz);
    m.rotation.z = rotZ;
    m.castShadow = true;
    m.receiveShadow = true;
    chunk.nearGroup.add(m);
  };

  for (let i = 0; i < letters.length; i++) {
    const lx = startX + i * stepX;
    const gy = terrainAt(lx, z);
    const base = gy + 3.2;
    const H = 13.5;
    const midY = base + H * 0.5;

    // Steel support stilts & diagonal rear bracing truss anchored into hillside slope
    addSolidBox(chunk, lx - 3.5, gy - 4.0, z - 0.8, 0.7, 9.0, 0.7, trussMat, 0, "metal");
    addSolidBox(chunk, lx + 3.5, gy - 4.0, z - 0.8, 0.7, 9.0, 0.7, trussMat, 0, "metal");
    addVisualBox(chunk.nearGroup, lx - 3.5, midY, z - 1.4, 0.35, H * 0.9, 0.35, trussMat, 0);
    addVisualBox(chunk.nearGroup, lx + 3.5, midY, z - 1.4, 0.35, H * 0.9, 0.35, trussMat, 0);
    addVisualBox(chunk.nearGroup, lx, midY, z - 1.4, 7.2, 0.32, 0.32, trussMat, 0.65);
    addVisualBox(chunk.nearGroup, lx, midY, z - 1.4, 7.2, 0.32, 0.32, trussMat, -0.65);
    addVisualBox(chunk.nearGroup, lx, base - 0.3, z + 1.8, 4.2, 0.3, 0.45, trussMat, 0);

    const ch = letters[i];
    if (ch === "W") {
      addBar(lx - 4.5, midY, z, 2.0, H, 0.12);
      addBar(lx - 1.5, midY - 1.0, z, 1.8, H * 0.82, -0.2);
      addBar(lx + 1.5, midY - 1.0, z, 1.8, H * 0.82, 0.2);
      addBar(lx + 4.5, midY, z, 2.0, H, -0.12);
    } else if (ch === "E") {
      addBar(lx - 3.5, midY, z, 2.2, H);
      addBar(lx + 0.5, base + H - 1.1, z, 8.5, 2.2);
      addBar(lx, midY, z, 7.2, 2.0);
      addBar(lx + 0.5, base + 1.1, z, 8.5, 2.2);
    } else if (ch === "S") {
      addBar(lx, base + H - 1.1, z, 8.5, 2.2);
      addBar(lx - 3.2, base + H * 0.74, z, 2.2, H * 0.45);
      addBar(lx, midY, z, 8.2, 2.1);
      addBar(lx + 3.2, base + H * 0.26, z, 2.2, H * 0.45);
      addBar(lx, base + 1.1, z, 8.5, 2.2);
    } else if (ch === "T") {
      addBar(lx, base + H - 1.1, z, 10.0, 2.2);
      addBar(lx, midY, z, 2.4, H);
    } else if (ch === "G") {
      addBar(lx - 3.5, midY, z, 2.2, H);
      addBar(lx + 0.2, base + H - 1.1, z, 8.6, 2.2);
      addBar(lx + 0.2, base + 1.1, z, 8.6, 2.2);
      addBar(lx + 3.5, base + H * 0.28, z, 2.2, H * 0.48);
      addBar(lx + 1.8, midY, z, 5.0, 2.0);
    } else if (ch === "A") {
      addBar(lx - 2.6, midY, z, 2.2, H, -0.18);
      addBar(lx + 2.6, midY, z, 2.2, H, 0.18);
      addBar(lx, midY - 0.8, z, 6.2, 2.0);
    }

    addLodBox(chunk, lx, gy + 2.0, z, 11, 14.5, 2.5, 0xf1f5f9);
  }
}

/** Luxury cantilevered hillside villa with infinity pool & slope foundation */
function buildFoothillMansion(chunk: CityChunk, spec: MansionSpec, groundY: number): void {
  const deckMat = materialFor(0xd6cfc4, { roughness: 0.82, family: "stone", seed: 901, repeat: 6 });
  const timber = materialFor(0x6b4b32, { roughness: 0.78, family: "wood", seed: 902, repeat: 3 });
  const darkMetal = materialFor(0x252b33, { roughness: 0.38, metalness: 0.82, family: "metal", seed: 903 });
  const poolMat = new THREE.MeshStandardMaterial({ color: 0x06b6d4, roughness: 0.1, metalness: 0.58 });
  const railGlass = new THREE.MeshStandardMaterial({
    color: 0x93c5fd,
    roughness: 0.08,
    metalness: 0.25,
    transparent: true,
    opacity: 0.42,
  });

  // Deep concrete plinth anchored into hillside slope so corners never float
  addSolidBox(chunk, spec.x, groundY - 5.5, spec.z, spec.w + 4, 6.0, spec.d + 4, deckMat, spec.yaw, "concrete", false, true);
  // Lower modern living wing (stucco + louvers) + cantilevered upper master suite (curtainwall glass)
  addHiddenColliderBox(chunk, spec.x, groundY + 0.4, spec.z, spec.w, 4.6, spec.d, spec.yaw, "concrete");
  buildGrammarFacadeShell(chunk.nearGroup, {
    x: spec.x,
    yBase: groundY + 0.4,
    z: spec.z,
    w: spec.w,
    h: 4.6,
    d: spec.d,
    yaw: spec.yaw,
    style: "stucco_warm",
    kindOverride: "louver",
    storefront: false,
    maxFloors: 1,
    maxBays: 6,
  });
  addVisualBox(chunk.nearGroup, spec.x, groundY + 4.9, spec.z, spec.w + 0.6, 0.35, spec.d + 0.6, darkMetal, spec.yaw);
  addHiddenColliderBox(chunk, spec.x - 2, groundY + 5.0, spec.z - 1, spec.w * 0.68, 4.0, spec.d * 0.72, spec.yaw, "concrete");
  buildGrammarFacadeShell(chunk.nearGroup, {
    x: spec.x - 2,
    yBase: groundY + 5.0,
    z: spec.z - 1,
    w: spec.w * 0.68,
    h: 4.0,
    d: spec.d * 0.72,
    yaw: spec.yaw,
    style: "glass_slate",
    kindOverride: "curtainwall",
    storefront: false,
    maxFloors: 1,
    maxBays: 5,
  });
  addSolidBox(chunk, spec.x - 2, groundY + 9.0, spec.z - 1, spec.w * 0.74, 0.5, spec.d * 0.78, timber, spec.yaw, "wood");
  // Upper balcony glass balustrade + steel handrail along front terrace
  const cos = Math.cos(spec.yaw);
  const sin = Math.sin(spec.yaw);
  addVisualBox(
    chunk.nearGroup,
    spec.x + sin * (spec.d * 0.48),
    groundY + 5.0,
    spec.z + cos * (spec.d * 0.48),
    spec.w * 0.92,
    0.95,
    0.08,
    railGlass,
    spec.yaw,
  );
  addVisualBox(
    chunk.nearGroup,
    spec.x + sin * (spec.d * 0.48),
    groundY + 5.95,
    spec.z + cos * (spec.d * 0.48),
    spec.w * 0.94,
    0.08,
    0.12,
    darkMetal,
    spec.yaw,
  );
  // Infinity pool along front terrace + cantilevered timber pergola rafters
  addVisualBox(
    chunk.nearGroup,
    spec.x + sin * (spec.d * 0.45),
    groundY + 0.55,
    spec.z + cos * (spec.d * 0.45),
    spec.w * 0.55,
    0.08,
    5.5,
    poolMat,
    spec.yaw,
    false,
    true,
  );
  addVisualBox(
    chunk.nearGroup,
    spec.x - sin * (spec.d * 0.3),
    groundY + 4.4,
    spec.z - cos * (spec.d * 0.3),
    spec.w * 0.42,
    0.25,
    3.6,
    timber,
    spec.yaw,
  );

  addLodBox(chunk, spec.x, groundY, spec.z, spec.w, 9.5, spec.d, 0xd8cdb8, spec.yaw);
}

/** Canyon Ranger Station & Scenic Overlook (`x=195, z=-685`) */
function buildCanyonRangerOutpost(chunk: CityChunk, groundY: number): void {
  const x = 195;
  const z = -685;
  const logMat = new THREE.MeshStandardMaterial({ color: 0x7a5033, roughness: 0.88 });
  const roofMat = new THREE.MeshStandardMaterial({ color: 0x2f4f3e, roughness: 0.78 });
  const stone = new THREE.MeshStandardMaterial({ color: 0x858078, roughness: 0.9 });

  addSolidBox(chunk, x, groundY - 2.0, z, 22, 2.3, 18, stone, 0, "concrete", false, true);
  addSolidBox(chunk, x, groundY + 0.2, z, 15, 4.5, 11, logMat, 0, "wood");
  // Stone fireplace chimney + front porch timber columns + elevated ranger lookout platform
  addSolidBox(chunk, x - 6.8, groundY + 0.2, z - 2.5, 1.8, 8.2, 1.8, stone, 0, "concrete");
  for (const px of [-5.5, -1.8, 1.8, 5.5]) {
    addVisualBox(chunk.nearGroup, x + px, groundY + 2.3, z + 6.8, 0.32, 4.2, 0.32, logMat, 0);
  }
  addVisualBox(chunk.nearGroup, x, groundY + 4.5, z + 6.4, 15.6, 0.25, 2.6, roofMat, 0);
  addSolidBox(chunk, x + 13.5, groundY, z - 4.5, 4.2, 10.5, 4.2, logMat, 0, "wood");
  addVisualBox(chunk.nearGroup, x + 13.5, groundY + 10.6, z - 4.5, 5.4, 0.4, 5.4, roofMat, 0);
  const roof = new THREE.Mesh(new THREE.ConeGeometry(Math.SQRT1_2, 2.8, 4), roofMat);
  roof.scale.set(17, 1, 13);
  roof.rotation.y = Math.PI * 0.25;
  roof.position.set(x, groundY + 4.7 + 1.4, z);
  roof.castShadow = true;
  chunk.nearGroup.add(roof);
  addLodBox(chunk, x, groundY, z, 15, 6.5, 11, 0x7a5033);
}

/**
 * Registers Phase 6 Northern Foothills, Observatory, Mansions & WESTGATE Sign onto the chunk dispatcher.
 */
export function registerFoothillsDistrict(
  dispatcher: CityChunkDispatcher,
  roads: RoadNetwork,
  heightSystem: WorldHeightSystem,
  worldMin = -1200,
  chunkSize = 160,
): void {
  // 1. Westgate Observatory & Scenic Overlook Terrace
  dispatcher.registerAtPoint(-120, -1018, worldMin, chunkSize, (chunk, terrainAt) => {
    buildObservatory(chunk, terrainAt(-120, -1018), heightSystem);
  });

  // 2. Hollywood-style WESTGATE hillside sign (split across 2 neighboring chunks x=36..96 and x=116..176)
  dispatcher.registerAtPoint(96, -892, worldMin, chunkSize, (chunk, terrainAt) => {
    buildWestgateHillSign(chunk, terrainAt);
  });

  // 3. Vinewood Crest Hillside Mansions
  for (const m of FOOTHILL_MANSIONS) {
    const clearR = Math.hypot(m.w, m.d) * 0.5 + 3.0;
    if (!isFootprintClearOfRoads(roads, m.x, m.z, clearR)) continue;
    dispatcher.registerAtPoint(m.x, m.z, worldMin, chunkSize, (chunk, terrainAt) => {
      buildFoothillMansion(chunk, m, terrainAt(m.x, m.z));
    });
  }

  // 4. Canyon Ranger Outpost near North Gorge Bridge approach
  if (isFootprintClearOfRoads(roads, 195, -685, 15)) {
    dispatcher.registerAtPoint(195, -685, worldMin, chunkSize, (chunk, terrainAt) => {
      buildCanyonRangerOutpost(chunk, terrainAt(195, -685));
    });
  }
}

export const FOOTHILLS_LANDMARKS = [
  { id: "westgate_observatory", name: "Westgate Observatory", x: -120, z: -1018 },
  { id: "westgate_sign", name: "WESTGATE Hillside Sign", x: 96, z: -892 },
  { id: "canyon_ranger", name: "Canyon Ranger Outpost", x: 195, z: -685 },
];
