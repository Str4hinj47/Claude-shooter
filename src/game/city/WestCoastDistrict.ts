import * as THREE from "three";
import { materialFor } from "../kit/surface";
import type { CityChunk } from "./ChunkStreamer";
import type { WalkableSurface, WorldHeightSystem } from "./HeightSystem";
import type { RoadNetwork } from "./RoadNetwork";
import { coastLineX } from "./WestgateTerrain";
import {
  CityChunkDispatcher,
  addDetailedHouse,
  addFacadeRelief,
  addHiddenColliderBox,
  addLodBox,
  addSolidBox,
  addStorefrontBay,
  addVisualBox,
  isFootprintClearOfRoads,
  registerNightGlowMaterial,
} from "./CityBuildingKit";
import { buildGrammarFacadeShell } from "./FacadeGrammar";

/** Del Sol Ocean Pier, Arcade Pavilion & Illuminated Ferris Wheel (`z=40, x=-738..-875`) */
function buildDelSolPier(chunk: CityChunk, groundY: number, heightSystem: WorldHeightSystem): void {
  const z = 40;
  const xStart = coastLineX(z) + 4; // ~ -734
  const xEnd = xStart - 138; // ~ -872
  const deckW = xStart - xEnd;
  const xMid = (xStart + xEnd) * 0.5;
  const deckY = 4.2;

  const woodDeck = materialFor(0x8b623f, { roughness: 0.84, metalness: 0.04, family: "wood", seed: 801, repeat: 10 });
  const pilingMat = materialFor(0x4b382a, { roughness: 0.9, family: "wood", seed: 802 });
  const roofTeal = materialFor(0x0f766e, { roughness: 0.62, family: "metal", seed: 803 });
  const wheelMat = materialFor(0xf8fafc, { roughness: 0.4, metalness: 0.45, family: "metal", seed: 804 });
  const pierLampGlow = registerNightGlowMaterial(
    new THREE.MeshStandardMaterial({
      color: 0xfff1c9,
      emissive: 0xffc866,
      emissiveIntensity: 0.25,
      roughness: 0.2,
    }),
    0.25,
    3.6,
  );
  const neonCyan = registerNightGlowMaterial(
    new THREE.MeshStandardMaterial({
      color: 0x22d3ee,
      emissive: 0x06b6d4,
      emissiveIntensity: 0.35,
      roughness: 0.3,
    }),
    0.35,
    3.4,
  );
  const neonPink = registerNightGlowMaterial(
    new THREE.MeshStandardMaterial({
      color: 0xf43f5e,
      emissive: 0xe11d48,
      emissiveIntensity: 0.35,
      roughness: 0.3,
    }),
    0.35,
    3.2,
  );

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

  // Support pilings down to seabed + top wooden guardrails, pier bollard lamps & overhead festoon string lights
  for (let px = xEnd + 6; px <= xStart - 4; px += 12) {
    for (const pz of [z - 6.8, z + 6.8]) {
      addSolidBox(chunk, px, -5.0, pz, 0.65, deckY + 4.8, 0.65, pilingMat, 0, "wood");
    }
    for (const pz of [z - 7.7, z + 7.7]) {
      addVisualBox(chunk.nearGroup, px, deckY + 0.1, pz, 0.25, 1.15, 0.25, pilingMat, 0);
      addVisualBox(chunk.nearGroup, px, deckY + 1.25, pz, 0.22, 0.18, 0.22, pierLampGlow, 0, false, false);
    }
    // Elevated festoon string-light posts & warm glowing bulbs spanning boardwalk
    if (px < xStart - 14) {
      for (const pz of [z - 7.4, z + 7.4]) {
        addVisualBox(chunk.nearGroup, px, deckY + 1.9, pz, 0.12, 3.6, 0.12, pilingMat, 0);
      }
      addVisualBox(chunk.nearGroup, px, deckY + 3.65, z, 0.05, 0.05, 14.8, pilingMat, 0);
      for (let bz = -5.5; bz <= 5.5; bz += 2.2) {
        addVisualBox(chunk.nearGroup, px, deckY + 3.5, z + bz, 0.16, 0.18, 0.16, pierLampGlow, 0, false, false);
      }
    }
  }
  // Upper safety rails along both edges of pier
  addVisualBox(chunk.nearGroup, xMid, deckY + 1.05, z - 7.7, deckW, 0.12, 0.16, woodDeck, 0);
  addVisualBox(chunk.nearGroup, xMid, deckY + 1.05, z + 7.7, deckW, 0.12, 0.16, woodDeck, 0);
  // Low edge safety curbs
  addSolidBox(chunk, xMid, deckY + 0.1, z - 7.7, deckW, 0.55, 0.35, woodDeck, 0, "wood");
  addSolidBox(chunk, xMid, deckY + 0.1, z + 7.7, deckW, 0.55, 0.35, woodDeck, 0, "wood");

  // Pier Arcade Pavilion & Diner + Pier Entrance Welcome Booth & Ocean-View Benches
  const ax = xStart - 48;
  addHiddenColliderBox(chunk, ax, deckY + 0.1, z - 2.5, 18, 5.2, 8.5, 0, "concrete");
  buildGrammarFacadeShell(chunk.nearGroup, {
    x: ax,
    yBase: deckY + 0.1,
    z: z - 2.5,
    w: 18,
    h: 5.2,
    d: 8.5,
    style: "stucco_warm",
    kindOverride: "grid",
    storefront: true,
    maxFloors: 1,
    maxBays: 5,
  });
  addSolidBox(chunk, ax, deckY + 5.3, z - 2.5, 19.5, 0.8, 9.8, roofTeal, 0, "metal");
  addVisualBox(chunk.nearGroup, ax, deckY + 4.2, z + 2.0, 14, 0.7, 0.25, neonCyan, 0);
  addVisualBox(chunk.nearGroup, ax, deckY + 3.0, z + 2.5, 14, 0.25, 1.5, neonPink, 0);

  // Pier entrance ticket kiosk & boardwalk wooden benches
  addHiddenColliderBox(chunk, xStart - 10, deckY + 0.1, z - 4.8, 4.2, 3.2, 3.4, 0, "concrete");
  buildGrammarFacadeShell(chunk.nearGroup, {
    x: xStart - 10,
    yBase: deckY + 0.1,
    z: z - 4.8,
    w: 4.2,
    h: 3.2,
    d: 3.4,
    style: "stucco_warm",
    kindOverride: "grid",
    storefront: true,
    maxFloors: 1,
    maxBays: 1,
  });
  addSolidBox(chunk, xStart - 10, deckY + 3.3, z - 4.8, 4.8, 0.45, 4.0, roofTeal, 0, "metal");
  for (const bx of [xStart - 24, xStart - 34, xStart - 66]) {
    addVisualBox(chunk.nearGroup, bx, deckY + 0.52, z + 6.2, 2.4, 0.1, 0.55, woodDeck, 0);
    addVisualBox(chunk.nearGroup, bx, deckY + 0.82, z + 6.45, 2.4, 0.42, 0.1, woodDeck, 0);
  }

  const dx = xEnd + 18;
  addHiddenColliderBox(chunk, dx, deckY + 0.1, z + 2.2, 14, 4.6, 8.0, 0, "concrete");
  buildGrammarFacadeShell(chunk.nearGroup, {
    x: dx,
    yBase: deckY + 0.1,
    z: z + 2.2,
    w: 14,
    h: 4.6,
    d: 8.0,
    style: "stucco_warm",
    kindOverride: "grid",
    storefront: true,
    maxFloors: 1,
    maxBays: 4,
  });
  addSolidBox(chunk, dx, deckY + 4.7, z + 2.2, 15, 0.7, 9.0, neonPink, 0, "metal");
  // Pier-end coastal navigation beacon
  addVisualBox(chunk.nearGroup, xEnd + 2.5, deckY + 0.1, z, 0.28, 7.5, 0.28, wheelMat, 0);
  addVisualBox(chunk.nearGroup, xEnd + 2.5, deckY + 7.7, z, 0.55, 0.65, 0.55, pierLampGlow, 0);

  // Iconic Del Sol Ferris Wheel (`xStart - 92, z`), facing East-West so full circle silhouette reads from the beach
  const fx = xStart - 92;
  const wheelGroup = new THREE.Group();
  wheelGroup.position.set(fx, deckY, z);
  wheelGroup.rotation.y = Math.PI * 0.5;
  chunk.nearGroup.add(wheelGroup);

  const hubLocalY = 19.5;
  // A-frame legs
  for (const dz of [-3.6, 3.6]) {
    for (const s of [-1, 1]) {
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.55, 21.5, 8), wheelMat);
      leg.position.set(s * 4.4, 9.8, dz);
      leg.rotation.z = s * 0.4;
      leg.castShadow = true;
      wheelGroup.add(leg);
    }
  }
  // Wheel rotor group centered at axle so LivingWorld can rotate the wheel smoothly
  const rotorGroup = new THREE.Group();
  rotorGroup.name = "DelSolFerrisRotor";
  rotorGroup.position.set(0, hubLocalY, 0);
  rotorGroup.userData.ferrisRotor = true;
  wheelGroup.add(rotorGroup);

  // Wheel ring + glowing central hub emblem + 10 spokes + 10 colored upright gondolas
  const hubCap = new THREE.Mesh(new THREE.CylinderGeometry(1.75, 1.75, 1.4, 16), neonPink);
  hubCap.rotation.x = Math.PI * 0.5;
  rotorGroup.add(hubCap);
  const rim = new THREE.Mesh(new THREE.TorusGeometry(14.5, 0.48, 8, 28), neonCyan);
  rotorGroup.add(rim);
  const innerRim = new THREE.Mesh(new THREE.TorusGeometry(9.5, 0.28, 6, 20), wheelMat);
  rotorGroup.add(innerRim);

  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    const gx = Math.cos(a) * 14.5;
    const gy = Math.sin(a) * 14.5;
    const spoke = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 29, 6), wheelMat);
    spoke.rotation.z = a + Math.PI * 0.5;
    rotorGroup.add(spoke);

    // Enclosed passenger gondola cabin pivoted at spoke attachment to remain upright
    const gondola = new THREE.Group();
    gondola.position.set(gx, gy, 0);
    gondola.userData.ferrisGondola = true;
    rotorGroup.add(gondola);
    const cabColor = i % 2 === 0 ? neonPink : neonCyan;
    addVisualBox(gondola, 0, -0.5, 0, 0.1, 0.7, 0.1, wheelMat, 0);
    addVisualBox(gondola, 0, -1.55, 0, 1.9, 0.72, 1.6, cabColor, 0);
    addVisualBox(gondola, 0, -0.9, 0, 1.75, 0.72, 1.45, wheelMat, 0);
    addVisualBox(gondola, 0, -0.25, 0, 2.05, 0.22, 1.75, cabColor, 0);
  }

  addLodBox(chunk, fx, deckY, z, 10, 32, 26, 0x38bdf8);
  addLodBox(chunk, xMid, deckY - 0.5, z, deckW, 2.5, 16, 0x8b623f);
}

/** Lifeguard Tower & Beach Cabanas along the sand */
function buildBeachPost(chunk: CityChunk, z: number, groundY: number): void {
  const x = coastLineX(z) + 18;
  const whiteWood = new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.72 });
  const roofBlue = new THREE.MeshStandardMaterial({ color: 0x0284c7, roughness: 0.65 });
  const umbrellaRed = new THREE.MeshStandardMaterial({ color: 0xef4444, roughness: 0.7 });

  // Stilted lifeguard hut + observation deck veranda, access stairs & red rescue buoy
  for (const dx of [-1.4, 1.4]) {
    for (const dz of [-1.4, 1.4]) {
      addSolidBox(chunk, x + dx, groundY, z + dz, 0.25, 2.6, 0.25, whiteWood, 0, "wood");
    }
  }
  addSolidBox(chunk, x - 0.3, groundY + 2.5, z, 4.2, 0.22, 3.8, whiteWood, 0, "wood");
  addSolidBox(chunk, x, groundY + 2.6, z, 3.4, 2.4, 3.4, whiteWood, 0, "wood");
  addSolidBox(chunk, x, groundY + 5.0, z, 3.8, 0.4, 3.8, roofBlue, 0, "metal");
  addVisualBox(chunk.nearGroup, x - 2.2, groundY + 3.45, z, 0.14, 0.14, 3.6, whiteWood, 0);
  addVisualBox(chunk.nearGroup, x - 1.8, groundY + 3.5, z + 1.5, 0.22, 0.85, 0.28, umbrellaRed, 0);
  // Sloped wooden access ladder/steps on East side
  for (let st = 0; st < 5; st++) {
    addVisualBox(chunk.nearGroup, x + 2.5 - st * 0.22, groundY + 0.45 + st * 0.48, z, 0.35, 0.1, 1.1, whiteWood, 0);
  }

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
  const woodBridge = materialFor(0x7c5338, { roughness: 0.82, family: "wood", seed: 810 });
  const stucco = materialFor(0xeadac2, { roughness: 0.84, family: "plaster", seed: 811, repeat: 2 });
  const pastelBlue = materialFor(0xbfdbfe, { roughness: 0.82, family: "plaster", seed: 812, repeat: 2 });
  const pastelPeach = materialFor(0xfed7aa, { roughness: 0.82, family: "plaster", seed: 813, repeat: 2 });
  const terra = materialFor(0xb45309, { roughness: 0.76, family: "roof-tile", seed: 814, repeat: 3 });

  const addCanalBridge = (id: string, bx: number, bz: number, axis: "ns" | "ew", span: number) => {
    const deckY = 3.9;
    const w = axis === "ew" ? span : 4.4;
    const d = axis === "ns" ? span : 4.4;
    addSolidBox(chunk, bx, deckY - 0.3, bz, w, 0.4, d, woodBridge, 0, "wood");
    // Side timber safety balustrades & handrail posts
    if (axis === "ns") {
      for (const sx of [bx - w * 0.5 + 0.18, bx + w * 0.5 - 0.18]) {
        addVisualBox(chunk.nearGroup, sx, deckY + 0.85, bz, 0.14, 0.14, d, woodBridge, 0);
        for (let pz = bz - d * 0.45; pz <= bz + d * 0.45; pz += 3.0) {
          addVisualBox(chunk.nearGroup, sx, deckY + 0.1, pz, 0.16, 0.9, 0.16, woodBridge, 0);
        }
      }
      addSolidBox(chunk, bx, 3.25, bz - span * 0.5 - 1.5, 4.4, 0.45, 3.2, woodBridge, 0, "wood");
      addSolidBox(chunk, bx, 3.25, bz + span * 0.5 + 1.5, 4.4, 0.45, 3.2, woodBridge, 0, "wood");
    } else {
      for (const sz of [bz - d * 0.5 + 0.18, bz + d * 0.5 - 0.18]) {
        addVisualBox(chunk.nearGroup, bx, deckY + 0.85, sz, w, 0.14, 0.14, woodBridge, 0);
        for (let px = bx - w * 0.45; px <= bx + w * 0.45; px += 3.0) {
          addVisualBox(chunk.nearGroup, px, deckY + 0.1, sz, 0.16, 0.9, 0.16, woodBridge, 0);
        }
      }
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

  const stoneWall = materialFor(0xc8c0b4, { roughness: 0.85, family: "stone", seed: 804, repeat: 6 });
  const boatHull = materialFor(0x5c3622, { roughness: 0.72, family: "wood", seed: 806 });
  const warmLamp = registerNightGlowMaterial(
    new THREE.MeshStandardMaterial({ color: 0xfff3d4, emissive: 0xffc966, emissiveIntensity: 0.25 }),
    0.25,
    3.4,
  );

  const villas: Array<{ x: number; z: number; mat: THREE.Material }> = [];
  if (band === "north") {
    addCanalBridge("wc_canal_bridge_n", -648, 185, "ns", 28);
    // North canal stone promenade embankment curbs & moored skiff
    addVisualBox(chunk.nearGroup, -605, 1.4, 171, 120, 1.8, 1.2, stoneWall, 0, false, true);
    addVisualBox(chunk.nearGroup, -605, 1.4, 199, 120, 1.8, 1.2, stoneWall, 0, false, true);
    addVisualBox(chunk.nearGroup, -630, 0.25, 182, 5.2, 0.7, 1.5, boatHull, 0.12);
    addVisualBox(chunk.nearGroup, -632.5, 0.9, 180.5, 0.26, 2.2, 0.26, woodBridge, 0);
    addVisualBox(chunk.nearGroup, -627.5, 0.9, 180.5, 0.26, 2.2, 0.26, woodBridge, 0);
    villas.push({ x: -648, z: 150, mat: stucco }, { x: -562, z: 150, mat: pastelPeach });
  } else {
    addCanalBridge("wc_canal_bridge_s", -562, 305, "ns", 28);
    addCanalBridge("wc_canal_bridge_c", -605, 245, "ew", 26);
    // South & center canal stone embankments, promenade lamps & moored skiffs
    addVisualBox(chunk.nearGroup, -605, 1.4, 291, 120, 1.8, 1.2, stoneWall, 0, false, true);
    addVisualBox(chunk.nearGroup, -605, 1.4, 319, 120, 1.8, 1.2, stoneWall, 0, false, true);
    addVisualBox(chunk.nearGroup, -617, 1.4, 245, 1.2, 1.8, 88, stoneWall, 0, false, true);
    addVisualBox(chunk.nearGroup, -593, 1.4, 245, 1.2, 1.8, 88, stoneWall, 0, false, true);
    addVisualBox(chunk.nearGroup, -608, 0.25, 260, 1.5, 0.7, 5.2, boatHull, 0.08);
    addVisualBox(chunk.nearGroup, -582, 0.25, 302, 5.2, 0.7, 1.5, boatHull, -0.1);
    for (const lx of [-630, -585]) {
      addVisualBox(chunk.nearGroup, lx, 3.2, 291, 0.22, 1.1, 0.22, stoneWall, 0);
      addVisualBox(chunk.nearGroup, lx, 4.3, 291, 0.34, 0.36, 0.34, warmLamp, 0);
    }
    villas.push(
      { x: -648, z: 245, mat: pastelBlue },
      { x: -562, z: 245, mat: stucco },
      { x: -648, z: 342, mat: pastelPeach },
      { x: -562, z: 342, mat: pastelBlue },
    );
  }

  const lawnMat = materialFor(0x4a783d, { roughness: 0.94, family: "grass", seed: 805, repeat: 4 });
  for (const v of villas) {
    addDetailedHouse(chunk, {
      x: v.x,
      yBase: 2.9,
      z: v.z,
      w: 14,
      d: 12,
      h: 7.4,
      wallMat: v.mat,
      roofMat: terra,
      lawnMat,
      yaw: 0,
      seed: Math.abs(v.x + v.z),
      district: "west_coast",
    });
    addLodBox(chunk, v.x, 2.9, v.z, 18, 9.5, 15, 0xd6b793);
  }
}

/** Del Sol Beachfront Resort Hotel & Pool (`x=-608, z=-25`) */
function buildBeachfrontResort(chunk: CityChunk, groundY: number): void {
  const x = -608;
  const z = -25;
  const glassTrim = materialFor(0x284757, { roughness: 0.35, metalness: 0.65, family: "metal", seed: 815 });
  const poolMat = new THREE.MeshStandardMaterial({ color: 0x06b6d4, roughness: 0.14, metalness: 0.55 });
  const deckMat = materialFor(0xe7dfd1, { roughness: 0.86, family: "stone", seed: 816, repeat: 8 });

  addSolidBox(chunk, x, groundY - 0.1, z, 56, 0.24, 48, deckMat, 0, "concrete", false, true);
  addHiddenColliderBox(chunk, x + 8, groundY, z - 8, 34, 22.0, 22, 0, "concrete");
  buildGrammarFacadeShell(chunk.nearGroup, {
    x: x + 8,
    yBase: groundY,
    z: z - 8,
    w: 34,
    h: 22.0,
    d: 22,
    style: "stucco_warm",
    kindOverride: "grid",
    storefront: true,
    maxFloors: 6,
    maxBays: 8,
  });
  addFacadeRelief(chunk.nearGroup, x + 8, groundY, z - 8, 34, 22.0, 22, 0, { balconies: true });
  addStorefrontBay(chunk.nearGroup, x + 8, groundY, z - 8, 34, 22, 0, glassTrim);
  addHiddenColliderBox(chunk, x - 12, groundY, z + 6, 16, 14.0, 24, 0, "concrete");
  buildGrammarFacadeShell(chunk.nearGroup, {
    x: x - 12,
    yBase: groundY,
    z: z + 6,
    w: 16,
    h: 14.0,
    d: 24,
    style: "glass_teal",
    kindOverride: "curtainwall",
    storefront: true,
    maxFloors: 4,
    maxBays: 6,
  });
  addVisualBox(chunk.nearGroup, x + 10, groundY + 0.15, z + 14, 20, 0.06, 12, poolMat, 0, false, true);
  // Pool coping rim + poolside sun loungers & shade umbrellas
  const whiteLounger = new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.7 });
  const coralCabana = new THREE.MeshStandardMaterial({ color: 0xf43f5e, roughness: 0.7 });
  for (const lx of [x + 2, x + 7, x + 12, x + 17]) {
    addVisualBox(chunk.nearGroup, lx, groundY + 0.28, z + 21.8, 0.9, 0.24, 2.1, whiteLounger, 0);
  }
  for (const ux of [x + 4.5, x + 14.5]) {
    addVisualBox(chunk.nearGroup, ux, groundY + 1.3, z + 22.0, 0.1, 2.3, 0.1, whiteLounger, 0);
    const umb = new THREE.Mesh(new THREE.ConeGeometry(1.8, 0.65, 8), coralCabana);
    umb.position.set(ux, groundY + 2.45, z + 22.0);
    chunk.nearGroup.add(umb);
  }

  addLodBox(chunk, x + 4, groundY, z - 2, 42, 21, 34, 0xd8c3a5);
}

/** Pacific Yacht Club & Harbor Marina Slips (`x=-715, z=480`) */
function buildMarina(chunk: CityChunk, groundY: number): void {
  const x = -715;
  const z = 480;
  const wood = materialFor(0x8b623f, { roughness: 0.85, family: "wood", seed: 817 });
  const hull = materialFor(0xf8fafc, { roughness: 0.45, family: "metal", seed: 818 });
  const trim = materialFor(0x1e3a8a, { roughness: 0.5, family: "metal", seed: 819 });

  addHiddenColliderBox(chunk, x + 36, groundY, z, 22, 6.8, 16, 0, "concrete");
  buildGrammarFacadeShell(chunk.nearGroup, {
    x: x + 36,
    yBase: groundY,
    z,
    w: 22,
    h: 6.8,
    d: 16,
    style: "limestone",
    kindOverride: "grid",
    storefront: true,
    maxFloors: 2,
    maxBays: 6,
  });
  addStorefrontBay(chunk.nearGroup, x + 36, groundY, z, 22, 16, -Math.PI * 0.5, trim);
  // Main marina dock extending out into water + timber mooring pilings & warm dock lanterns
  const dockGlow = registerNightGlowMaterial(
    new THREE.MeshStandardMaterial({ color: 0xfff3d4, emissive: 0xffc866, emissiveIntensity: 0.25 }),
    0.25,
    3.4,
  );
  addSolidBox(chunk, x - 12, 1.4, z, 52, 0.35, 4.5, wood, 0, "wood");
  for (const px of [x - 32, x - 18, x - 4]) {
    for (const pz of [z - 2.3, z + 2.3]) {
      addVisualBox(chunk.nearGroup, px, 0.2, pz, 0.42, 2.6, 0.42, wood, 0);
      addVisualBox(chunk.nearGroup, px, 1.6, pz, 0.26, 0.24, 0.26, dockGlow, 0);
    }
  }
  for (const fz of [z - 16, z + 16]) {
    addSolidBox(chunk, x - 16, 1.4, fz, 34, 0.35, 3.0, wood, 0, "wood");
    // Moored pleasure yachts with tapered bow prow, flybridge upper deck, mast & furled/triangular sail
    const yz = fz + (fz < z ? 5 : -5);
    addSolidBox(chunk, x - 18, 0.2, yz, 14, 2.2, 4.4, hull, 0, "wood");
    const bow = new THREE.Mesh(new THREE.ConeGeometry(2.3, 4.2, 4), hull);
    bow.rotation.set(0, Math.PI * 0.25, Math.PI * 0.5);
    bow.position.set(x - 27.1, 1.3, yz);
    chunk.nearGroup.add(bow);
    addSolidBox(chunk, x - 17, 2.4, yz, 6.5, 1.8, 3.0, trim, 0, "metal");
    addVisualBox(chunk.nearGroup, x - 16, 4.2, yz, 4.2, 0.9, 2.2, hull, 0);
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.14, 9.5, 8), hull);
    mast.position.set(x - 16, 8.2, yz);
    mast.castShadow = true;
    chunk.nearGroup.add(mast);
    addVisualBox(chunk.nearGroup, x - 13.8, 4.6, yz, 4.4, 0.14, 0.14, hull, 0);
    const sailShape = new THREE.Shape();
    sailShape.moveTo(0, 0);
    sailShape.lineTo(4.0, 0);
    sailShape.lineTo(0, 7.6);
    sailShape.closePath();
    const sailGeo = new THREE.ExtrudeGeometry(sailShape, { depth: 0.08, bevelEnabled: false });
    const sail = new THREE.Mesh(sailGeo, hull);
    sail.position.set(x - 16, 4.8, yz - 0.04);
    chunk.nearGroup.add(sail);
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
