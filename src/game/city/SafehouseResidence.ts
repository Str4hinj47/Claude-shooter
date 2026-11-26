import * as THREE from "three";
import { materialFor } from "../kit/surface";
import type { CityChunk } from "./ChunkStreamer";
import type { WalkableSurface, WorldHeightSystem } from "./HeightSystem";
import { addLodBox, addVisualBox, registerNightGlowMaterial } from "./CityBuildingKit";
import { attachGlbToGroup } from "./PropModels";
import type { SpatialAABBGrid } from "./SpatialIndex";
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

// Player spawns on the front driveway walk facing the Safehouse, Garage Door & Front Porch
const _spawnW = safehouseLocalToWorld(1.8, 10.6, 0.14);
export const SAFEHOUSE_SPAWN: [number, number, number] = [
  Number(_spawnW.x.toFixed(2)),
  Number(_spawnW.z.toFixed(2)),
  Number(THREE.MathUtils.radToDeg(SAFEHOUSE_YAW + Math.PI + 0.18).toFixed(1)),
];

// Personal car parked INSIDE the 1-car garage bay facing straight out down the driveway
const _carW = safehouseLocalToWorld(2.4, 0.7, 0.13);
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
    pos: safehouseLocalToWorld(-16.2, -3.2, 0.16),
    radius: 3.0,
  },
  {
    id: "safehouse_closet",
    kind: "closet",
    label: "Walk-In Wardrobe Closet",
    sublabel: "Customize operator uniform, armor & tactical gear",
    pos: safehouseLocalToWorld(-15.6, 2.0, 0.16),
    radius: 2.0,
    autoOpen: true,
  },
  {
    id: "safehouse_garage_door",
    kind: "garage_door",
    label: "Garage Door · Customize Car",
    sublabel: "[F] Overtake Car Customizer · [G] Drive Car Out",
    pos: safehouseLocalToWorld(-0.75, 1.2, 0.16),
    radius: 2.2,
  },
  {
    id: "safehouse_weapon_bench",
    kind: "weapon_bench",
    label: "Gunsmith Weapon Workbench",
    sublabel: "Customize optics, muzzles, finishes & weapon upgrades",
    pos: safehouseLocalToWorld(2.4, -3.1, 0.13),
    radius: 1.9,
    autoOpen: true,
  },
  {
    id: "safehouse_garage_mod",
    kind: "garage_mod",
    label: "Overtake Garage Mod Bay",
    sublabel: "Customize paint, rims, window tint & engine tuning",
    pos: safehouseLocalToWorld(2.4, 0.7, 0.13),
    radius: 3.0,
  },
  {
    id: "safehouse_intel_board",
    kind: "intel_board",
    label: "Intel & Surveillance Board",
    sublabel: "Inspect Target Dossiers & Start Contracts (H1–H3)",
    pos: safehouseLocalToWorld(-0.95, -1.35, 0.16),
    radius: 2.2,
  },
];

// ---- Animated Exterior Sectional Garage Door State ----
interface GarageDoorPanel {
  pivot: THREE.Group;
  closedY: number;
  closedZ: number;
  openY: number;
  openZ: number;
  openRotX: number;
}

interface GarageDoorRuntime {
  panels: GarageDoorPanel[];
  doorWorldPos: THREE.Vector3;
  closedBoxes: THREE.Box3[];
  spatialAABBs: SpatialAABBGrid | null;
  aabbIds: number[];
  colliderActive: boolean;
  openT: number;
}

let activeGarageDoor: GarageDoorRuntime | null = null;

export function resetSafehouseGarageDoorState(): void {
  activeGarageDoor = null;
}

export function registerSafehouseGarageSpatial(spatial: SpatialAABBGrid): void {
  if (!activeGarageDoor) return;
  activeGarageDoor.spatialAABBs = spatial;
  if (activeGarageDoor.colliderActive && activeGarageDoor.aabbIds.length === 0) {
    activeGarageDoor.aabbIds = spatial.insertMany(activeGarageDoor.closedBoxes);
  }
}

/**
 * Smoothly opens/closes the exterior sectional garage door when the player or their car
 * approaches the garage doorway (from either driveway or interior), and toggles its collider.
 */
export function updateSafehouseGarageDoor(
  dt: number,
  playerPos: { x: number; y: number; z: number } | null,
  vehiclePos: { x: number; y: number; z: number } | null,
  forceOpen = false,
): void {
  const gd = activeGarageDoor;
  if (!gd) return;

  let wantOpen = forceOpen;
  if (!wantOpen && playerPos) {
    const dp = Math.hypot(playerPos.x - gd.doorWorldPos.x, playerPos.z - gd.doorWorldPos.z);
    if (dp < 6.4) wantOpen = true;
  }
  if (!wantOpen && vehiclePos) {
    const dv = Math.hypot(vehiclePos.x - gd.doorWorldPos.x, vehiclePos.z - gd.doorWorldPos.z);
    if (dv < 7.8) wantOpen = true;
  }

  const target = wantOpen ? 1 : 0;
  const speed = wantOpen ? 1.85 : 1.35;
  if (gd.openT < target) gd.openT = Math.min(target, gd.openT + dt * speed);
  else if (gd.openT > target) gd.openT = Math.max(target, gd.openT - dt * speed);

  const ease = gd.openT * gd.openT * (3 - 2 * gd.openT);
  for (let i = 0; i < gd.panels.length; i++) {
    const p = gd.panels[i];
    const phase = Math.max(0, Math.min(1, ease * 1.18 - i * 0.05));
    p.pivot.position.y = THREE.MathUtils.lerp(p.closedY, p.openY, phase);
    p.pivot.position.z = THREE.MathUtils.lerp(p.closedZ, p.openZ, phase);
    p.pivot.rotation.x = THREE.MathUtils.lerp(0, p.openRotX, phase);
  }

  const shouldCollide = gd.openT < 0.42;
  if (shouldCollide !== gd.colliderActive) {
    gd.colliderActive = shouldCollide;
    if (gd.spatialAABBs) {
      if (shouldCollide && gd.aabbIds.length === 0) {
        gd.aabbIds = gd.spatialAABBs.insertMany(gd.closedBoxes);
      } else if (!shouldCollide && gd.aabbIds.length > 0) {
        for (let i = 0; i < gd.aabbIds.length; i++) {
          gd.spatialAABBs.remove(gd.aabbIds[i]);
        }
        gd.aabbIds = [];
      }
    }
  }
}

/**
 * Builds the player's redesigned Modern West Coast Safehouse Residence on Mirror Park Crescent:
 * - Strictly disjoint, non-overlapping floor/patio/driveway/pool-deck slabs (zero Z-fighting)
 * - Solid masonry walls, recessed front porch with double doors, framed tinted windows (zero floating transparency)
 * - Animated exterior cedar-and-aluminum sectional garage door
 * - Segmented tight wall collision AABBs so rotated doorways & hallways never snag
 * - Real CC0 Poly Haven & KayKit PBR furniture inside warm-lit Living Room, Kitchen, Master Suite & Walk-In Closet
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
    return addVisualBox(chunk.nearGroup, p.x, p.y, p.z, w, h, d, mat, yaw + localYaw, castShadow, true);
  };

  /**
   * Registers a seamless visual mesh PLUS tightly segmented (`<= 0.65m`) rotated collider AABBs
   * so rotated walls at `SAFEHOUSE_YAW` never leak fat diagonal AABBs into doorways or rooms.
   */
  const boxWallSolid = (
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
    const vis = addVisualBox(chunk.nearGroup, p.x, p.y, p.z, w, h, d, mat, yaw + localYaw, castShadow, true);
    vis.userData.kind = kind;
    chunk.colliders.push(vis);

    const totalYaw = yaw + localYaw;
    const ca = Math.abs(Math.cos(totalYaw));
    const sa = Math.abs(Math.sin(totalYaw));
    const maxSpan = 0.65;

    if (w >= d && w > maxSpan) {
      const segs = Math.ceil(w / maxSpan);
      const segW = w / segs;
      const hx = (segW * ca + d * sa) * 0.5;
      const hz = (segW * sa + d * ca) * 0.5;
      const lc = Math.cos(localYaw);
      const ls = Math.sin(localYaw);
      for (let i = 0; i < segs; i++) {
        const dx = -w * 0.5 + segW * (i + 0.5);
        const sp = wPos(lx + dx * lc, lz - dx * ls, ly);
        chunk.aabbs.push(new THREE.Box3(new THREE.Vector3(sp.x - hx, sp.y, sp.z - hz), new THREE.Vector3(sp.x + hx, sp.y + h, sp.z + hz)));
      }
    } else if (d > maxSpan) {
      const segs = Math.ceil(d / maxSpan);
      const segD = d / segs;
      const hx = (w * ca + segD * sa) * 0.5;
      const hz = (w * sa + segD * ca) * 0.5;
      const lc = Math.cos(localYaw);
      const ls = Math.sin(localYaw);
      for (let i = 0; i < segs; i++) {
        const dz = -d * 0.5 + segD * (i + 0.5);
        const sp = wPos(lx + dz * ls, lz + dz * lc, ly);
        chunk.aabbs.push(new THREE.Box3(new THREE.Vector3(sp.x - hx, sp.y, sp.z - hz), new THREE.Vector3(sp.x + hx, sp.y + h, sp.z + hz)));
      }
    } else {
      const hx = (w * ca + d * sa) * 0.5;
      const hz = (w * sa + d * ca) * 0.5;
      chunk.aabbs.push(new THREE.Box3(new THREE.Vector3(p.x - hx, p.y, p.z - hz), new THREE.Vector3(p.x + hx, p.y + h, p.z + hz)));
    }
  };

  /** Helper for non-overlapping floor/deck slabs (visual + collider raycast, walking handled by floorSurf). */
  const floorSlab = (
    lx: number,
    topY: number,
    lz: number,
    w: number,
    thickness: number,
    d: number,
    mat: THREE.Material,
    kind: "concrete" | "wood" | "dirt" = "concrete",
  ) => {
    const p = wPos(lx, lz, topY - thickness);
    const mesh = addVisualBox(chunk.nearGroup, p.x, p.y, p.z, w, thickness, d, mat, yaw, false, true);
    mesh.userData.kind = kind;
    chunk.colliders.push(mesh);
  };

  // ---- Palette & Architectural Materials ----
  const lawnMat = materialFor(0x467038, { roughness: 0.94, family: "grass", seed: 101, repeat: 8 });
  const limestoneMat = materialFor(0xe8dfd0, { roughness: 0.82, metalness: 0.03, family: "plaster", seed: 104, repeat: 4 });
  const warmPlasterMat = materialFor(0xf4efe6, { roughness: 0.84, metalness: 0.02, family: "plaster", seed: 114, repeat: 3 });
  const slateMat = materialFor(0x282e37, { roughness: 0.64, metalness: 0.22, family: "concrete", seed: 105, repeat: 3 });
  const cedarMat = materialFor(0x935d36, { roughness: 0.72, metalness: 0.05, family: "wood", seed: 106, repeat: 3 });
  const oakFloorMat = materialFor(0x9e7449, { roughness: 0.58, metalness: 0.06, family: "wood", seed: 107, repeat: 5 });
  const drivewayMat = materialFor(0x7c828b, { roughness: 0.84, metalness: 0.05, family: "concrete", seed: 103, repeat: 6 });
  const porchStoneMat = materialFor(0xcac4b8, { roughness: 0.8, metalness: 0.04, family: "concrete", seed: 102, repeat: 4 });
  const garageFloorMat = materialFor(0x525861, { roughness: 0.72, metalness: 0.14, family: "concrete", seed: 108, repeat: 4 });
  const darkMetalMat = materialFor(0x1b2028, { roughness: 0.34, metalness: 0.82, family: "metal", seed: 109 });
  const cushionMat = new THREE.MeshStandardMaterial({ color: 0xd4a359, roughness: 0.82 });
  const redToolMat = new THREE.MeshStandardMaterial({ color: 0xc92a2a, roughness: 0.42, metalness: 0.55 });
  const foliageMat = materialFor(0x2f5a29, { roughness: 0.9, family: "grass", seed: 121, repeat: 2 });

  // Deeply tinted, semi-reflective architectural window glazing (NEVER ghost-clear!)
  const archWindowMat = new THREE.MeshStandardMaterial({
    color: 0x162533,
    roughness: 0.09,
    metalness: 0.78,
    transparent: true,
    opacity: 0.86,
  });
  const frostedLiteMat = new THREE.MeshStandardMaterial({
    color: 0xd8e4ef,
    emissive: 0x3b4d63,
    emissiveIntensity: 0.35,
    roughness: 0.28,
    metalness: 0.2,
  });
  const poolTileMat = materialFor(0x164e63, { roughness: 0.5, metalness: 0.15, family: "concrete", seed: 118, repeat: 3 });
  const poolWaterMat = registerNightGlowMaterial(
    new THREE.MeshStandardMaterial({
      color: 0x0ea5e9,
      emissive: 0x0284c7,
      emissiveIntensity: 0.28,
      roughness: 0.1,
      metalness: 0.48,
    }),
    0.28,
    1.5,
  );
  const warmGlowMat = registerNightGlowMaterial(
    new THREE.MeshStandardMaterial({
      color: 0xfff1d0,
      emissive: 0xffcf78,
      emissiveIntensity: 0.55,
      roughness: 0.28,
    }),
    0.55,
    2.8,
  );
  const tvScreenMat = new THREE.MeshStandardMaterial({
    color: 0x0f172a,
    emissive: 0x1d4ed8,
    emissiveIntensity: 0.85,
    roughness: 0.14,
  });

  // Helper: Framed Architectural Window on a knee-wall (no floating transparent sheets!)
  const addFramedWindow = (
    lx: number,
    lz: number,
    span: number,
    alongX: boolean,
    sillH = 0.95,
    winH = 2.15,
    totalH = 4.4,
    panes = 2,
  ) => {
    const t = 0.36;
    if (alongX) {
      boxWallSolid(lx, 0.16, lz, span, sillH, t, limestoneMat, "concrete");
      boxWallSolid(lx, 0.16 + sillH + winH, lz, span, totalH - sillH - winH, t, limestoneMat, "concrete");
      // Sill & Header + dark metal frame
      boxVisual(lx, 0.16 + sillH - 0.04, lz, span + 0.08, 0.08, t + 0.08, slateMat);
      boxVisual(lx, 0.16 + sillH + winH, lz, span + 0.06, 0.07, t + 0.06, darkMetalMat);
      boxVisual(lx, 0.16 + sillH, lz, span - 0.12, winH, 0.08, archWindowMat);
      for (let i = 0; i <= panes; i++) {
        const mx = lx - span * 0.5 + (span * i) / panes;
        boxVisual(mx, 0.16 + sillH, lz, 0.08, winH, 0.14, darkMetalMat);
      }
    } else {
      boxWallSolid(lx, 0.16, lz, t, sillH, span, limestoneMat, "concrete");
      boxWallSolid(lx, 0.16 + sillH + winH, lz, t, totalH - sillH - winH, span, limestoneMat, "concrete");
      boxVisual(lx, 0.16 + sillH - 0.04, lz, t + 0.08, 0.08, span + 0.08, slateMat);
      boxVisual(lx, 0.16 + sillH + winH, lz, t + 0.06, 0.07, span + 0.06, darkMetalMat);
      boxVisual(lx, 0.16 + sillH, lz, 0.08, winH, span - 0.12, archWindowMat);
      for (let i = 0; i <= panes; i++) {
        const mz = lz - span * 0.5 + (span * i) / panes;
        boxVisual(lx, 0.16 + sillH, mz, 0.14, winH, 0.08, darkMetalMat);
      }
    }
  };

  // ---- 1. Disjoint Non-Overlapping Grounds, Driveway, Porch, Garage & Pool Deck ----
  // Base lawn estate pad split around the pool basin so green turf never cuts across the pool water
  floorSlab(-17.9, 0.06, 2.0, 9.7, 0.3, 38.0, lawnMat, "dirt"); // west lawn (-22.75..-13.05)
  floorSlab(-4.0, 0.06, 12.8, 18.1, 0.3, 16.4, lawnMat, "dirt"); // south front lawn (-13.05..+5.05, +4.6..+21.0)
  floorSlab(8.15, 0.06, 2.0, 6.2, 0.3, 38.0, lawnMat, "dirt"); // east lawn (+5.05..+11.25)
  floorSlab(-4.0, 0.06, -15.9, 18.1, 0.3, 2.2, lawnMat, "dirt"); // north rear lawn (-13.05..+5.05, -17.0..-14.8)

  // 1-car Driveway (lx = 0.2..4.8, lz = 4.6..33.2) -> top = y0 + 0.11
  floorSlab(2.5, 0.11, 18.9, 4.6, 0.14, 28.6, drivewayMat, "concrete");
  // Disjoint flanking stone driveway curbs (west curb starts at lz = 7.8 clear of front porch; top = y0 + 0.13)
  floorSlab(0.02, 0.13, 20.5, 0.34, 0.16, 25.4, porchStoneMat, "concrete");
  floorSlab(4.98, 0.13, 18.9, 0.34, 0.16, 28.6, porchStoneMat, "concrete");

  // Garage threshold apron (lx = 0.2..4.8, lz = 4.2..4.6) -> top = y0 + 0.12
  floorSlab(2.5, 0.12, 4.4, 4.6, 0.15, 0.4, slateMat, "concrete");

  // Garage floor slab (lx = -0.1..5.1, lz = -4.2..4.2) -> top = y0 + 0.13
  floorSlab(2.5, 0.13, 0.0, 5.2, 0.16, 8.4, garageFloorMat, "concrete");

  // Front Porch & Entry Courtyard (lx = -11.4..-0.1, lz = 3.5..7.8) -> top = y0 + 0.14
  floorSlab(-5.75, 0.14, 5.65, 11.3, 0.16, 4.3, porchStoneMat, "concrete");

  // Continuous Front Entry Walkway connecting porch to driveway/curb (lx = -5.8..-3.4, lz = 7.8..16.5) -> top = y0 + 0.11
  floorSlab(-4.6, 0.11, 12.15, 2.4, 0.14, 8.7, porchStoneMat, "concrete");
  // Disjoint stone walkway curbs
  floorSlab(-5.92, 0.13, 12.15, 0.24, 0.16, 8.7, slateMat, "concrete");
  floorSlab(-3.28, 0.13, 12.15, 0.24, 0.16, 8.7, slateMat, "concrete");

  // Interior hardwood floor strictly inside house footprint (lx = -20.0..-0.15, lz = -6.5..3.5) -> top = y0 + 0.16
  floorSlab(-10.075, 0.16, -1.5, 19.85, 0.18, 10.0, oakFloorMat, "wood");

  // Backyard Pool Patio — 4 strictly disjoint deck slabs surrounding the recessed pool basin (top = y0 + 0.14)
  floorSlab(-10.6, 0.14, -10.7, 4.8, 0.16, 8.2, porchStoneMat, "concrete"); // west deck (-13.0..-8.2)
  floorSlab(2.45, 0.14, -10.7, 5.3, 0.16, 8.2, porchStoneMat, "concrete"); // east deck (-0.2..5.1)
  floorSlab(-4.2, 0.14, -13.8, 8.0, 0.16, 2.0, porchStoneMat, "concrete"); // north coping (-8.2..-0.2, -14.8..-12.8)
  floorSlab(-4.2, 0.14, -7.5, 8.0, 0.16, 1.8, porchStoneMat, "concrete"); // south apron (-8.2..-0.2, -8.4..-6.6)
  // Pool basin (lx = -8.2..-0.2, lz = -12.8..-8.4)
  floorSlab(-4.2, 0.02, -10.6, 8.0, 0.08, 4.4, poolTileMat, "concrete");
  boxVisual(-4.2, 0.02, -10.6, 7.8, 0.1, 4.2, poolWaterMat);

  // ---- 2. Main Architectural Residence + Master Suite Wing (lx = -20.0 .. -0.15) ----
  // Master Suite outer west wall (lx = -19.85, lz = -6.5..3.5) with framed north-west window
  boxWallSolid(-19.85, 0.16, 0.4, 0.38, 4.4, 6.2, limestoneMat, "concrete");
  addFramedWindow(-19.85, -4.6, 3.8, false, 0.95, 2.15, 4.4, 2);

  // Master Suite north pool-facing wall (lz = -6.5) with wide framed picture window
  boxWallSolid(-18.6, 0.16, -6.5, 2.5, 4.4, 0.36, limestoneMat, "concrete");
  addFramedWindow(-15.5, -6.5, 3.7, true, 0.9, 2.25, 4.4, 3);
  boxWallSolid(-12.45, 0.16, -6.5, 2.4, 4.4, 0.36, limestoneMat, "concrete");

  // Master Suite south street-facing wall (lz = 3.5) with cedar accent cladding + clerestory window
  boxWallSolid(-18.6, 0.16, 3.5, 2.5, 4.4, 0.36, slateMat, "concrete");
  addFramedWindow(-15.5, 3.5, 3.7, true, 1.45, 1.45, 4.4, 3);
  boxWallSolid(-12.45, 0.16, 3.5, 2.4, 4.4, 0.36, slateMat, "concrete");
  boxVisual(-15.5, 0.16, 3.72, 3.7, 1.38, 0.08, cedarMat);

  // Interior divider wall between Living Room & Master Suite (lx = -11.3, 2.2m open arched doorway at lz = -3.3..-1.1)
  boxWallSolid(-11.3, 0.16, 1.2, 0.34, 4.4, 4.6, warmPlasterMat, "concrete");
  boxWallSolid(-11.3, 0.16, -4.9, 0.34, 4.4, 3.2, warmPlasterMat, "concrete");
  boxWallSolid(-11.3, 2.75, -2.2, 0.34, 1.81, 2.2, warmPlasterMat, "concrete");
  // Trim doorframe around bedroom entrance
  boxVisual(-11.3, 0.16, -1.08, 0.4, 2.6, 0.08, darkMetalMat);
  boxVisual(-11.3, 0.16, -3.32, 0.4, 2.6, 0.08, darkMetalMat);
  boxVisual(-11.3, 2.68, -2.2, 0.4, 0.08, 2.32, darkMetalMat);

  // Living/Kitchen North Wall (lz = -6.5) with wide framed backyard terrace window + open 1.9m patio doorway
  boxWallSolid(-9.4, 0.16, -6.5, 3.8, 4.4, 0.36, limestoneMat, "concrete");
  addFramedWindow(-5.5, -6.5, 4.0, true, 0.9, 2.25, 4.4, 3);
  boxWallSolid(-2.9, 0.16, -6.5, 1.2, 4.4, 0.36, limestoneMat, "concrete");
  // Open patio doorway at lx = -2.3..-0.4 (1.9m clear walkout to pool deck!)
  boxWallSolid(-1.35, 2.76, -6.5, 1.9, 1.8, 0.36, limestoneMat, "concrete");
  boxVisual(-1.35, 2.68, -6.5, 2.0, 0.08, 0.42, darkMetalMat);

  // Front South Facade (lz = 3.5): framed windows + solid piers + real Front Double-Door Porch Entryway (lx = -5.8..-3.4)!
  boxWallSolid(-10.1, 0.16, 3.5, 2.4, 4.4, 0.36, slateMat, "concrete");
  addFramedWindow(-7.45, 3.5, 2.9, true, 0.92, 2.2, 4.4, 2);
  boxWallSolid(-5.9, 0.16, 3.5, 0.22, 4.4, 0.36, slateMat, "concrete");
  // 2.4m Front Double Doorway at lx = -4.6 (-5.8 .. -3.4) with walnut double-door frame & open door leaf
  boxWallSolid(-4.6, 2.86, 3.5, 2.4, 1.7, 0.36, slateMat, "concrete");
  boxVisual(-5.76, 0.16, 3.5, 0.1, 2.7, 0.42, darkMetalMat);
  boxVisual(-3.44, 0.16, 3.5, 0.1, 2.7, 0.42, darkMetalMat);
  boxVisual(-4.6, 2.78, 3.5, 2.44, 0.1, 0.42, darkMetalMat);
  // Left stationary walnut door panel with frosted accent lite + right door swung 82 deg inward cleanly
  boxWallSolid(-5.32, 0.16, 3.5, 0.84, 2.62, 0.08, cedarMat, "wood");
  boxVisual(-5.32, 0.85, 3.5, 0.24, 1.5, 0.1, frostedLiteMat);
  boxVisual(-3.62, 0.16, 2.85, 0.08, 2.62, 1.18, cedarMat, 0.18);
  // Warm exterior sconce lights + illuminated house number "420"
  boxVisual(-6.2, 1.9, 3.72, 0.14, 0.36, 0.1, warmGlowMat);
  boxVisual(-3.0, 1.9, 3.72, 0.14, 0.36, 0.1, warmGlowMat);
  boxVisual(-6.2, 1.4, 3.72, 0.46, 0.22, 0.04, darkMetalMat);

  addFramedWindow(-1.9, 3.5, 2.8, true, 0.92, 2.2, 4.4, 2);
  boxWallSolid(-0.35, 0.16, 3.5, 0.45, 4.4, 0.36, slateMat, "concrete");

  // Front Architectural Timber-Soffit Canopy + Twin Steel Columns (at porch corners, zero visual float!)
  boxWallSolid(-4.6, 3.52, 5.45, 9.4, 0.28, 3.9, slateMat, "concrete");
  boxVisual(-4.6, 3.46, 5.45, 9.0, 0.08, 3.6, cedarMat);
  boxVisual(-4.6, 3.43, 6.8, 8.2, 0.05, 0.14, warmGlowMat);
  boxWallSolid(-8.95, 0.14, 7.05, 0.32, 3.42, 0.32, darkMetalMat, "metal");
  boxWallSolid(-0.35, 0.14, 7.05, 0.32, 3.42, 0.32, darkMetalMat, "metal");

  // East dividing wall between Living Room & 1-Car Garage (lx = -0.3, open doorway at lz = 0.2..2.2)
  boxWallSolid(-0.3, 0.16, -3.15, 0.34, 4.4, 6.7, warmPlasterMat, "concrete");
  boxWallSolid(-0.3, 0.16, 2.85, 0.34, 4.4, 1.3, warmPlasterMat, "concrete");
  boxWallSolid(-0.3, 2.75, 1.2, 0.34, 1.81, 2.0, warmPlasterMat, "concrete");

  // Ground Floor Roof Slabs + Cantilevered 2nd Floor Architectural Volume
  boxWallSolid(-15.65, 4.56, -1.5, 9.0, 0.34, 10.6, slateMat, "concrete");
  boxWallSolid(-5.8, 4.56, -1.5, 11.4, 0.34, 10.6, slateMat, "concrete");

  // 2nd Floor Architectural Suite (-11.0 .. -2.0, lz = -5.6 .. +2.6) — solid walls & framed dark-tinted gallery windows
  boxWallSolid(-6.5, 4.9, -1.5, 9.0, 3.1, 8.2, limestoneMat, "concrete");
  boxVisual(-6.5, 5.3, 2.62, 6.8, 2.15, 0.12, archWindowMat);
  for (const mx of [-9.9, -8.2, -6.5, -4.8, -3.1]) {
    boxVisual(mx, 5.28, 2.64, 0.1, 2.2, 0.14, darkMetalMat);
  }
  boxVisual(-6.5, 5.26, 2.66, 7.0, 0.1, 0.16, darkMetalMat);
  boxVisual(-6.5, 7.46, 2.66, 7.0, 0.1, 0.16, darkMetalMat);
  // Cedar upper fascia & overhanging flat roof
  boxVisual(-6.5, 8.0, -1.5, 10.2, 0.34, 9.4, slateMat);
  boxVisual(-6.5, 7.94, 2.9, 9.8, 0.08, 0.7, cedarMat);
  boxVisual(-6.5, 7.9, 2.9, 8.4, 0.04, 0.12, warmGlowMat);

  // 2nd-floor terrace parapet & brushed-steel rail posts (solid masonry curb + steel bars, no transparent sheet!)
  boxVisual(-1.2, 4.9, -1.5, 0.24, 0.38, 8.2, slateMat);
  boxVisual(-1.2, 5.88, -1.5, 0.1, 0.07, 8.2, darkMetalMat);
  for (const rz of [-5.5, -3.5, -1.5, 0.5, 2.5]) {
    boxVisual(-1.2, 5.28, rz, 0.08, 0.62, 0.08, darkMetalMat);
  }
  boxVisual(1.85, 4.9, 2.5, 6.1, 0.38, 0.24, slateMat);
  boxVisual(1.85, 5.88, 2.5, 6.1, 0.07, 0.1, darkMetalMat);
  for (const rx of [-1.2, 0.6, 2.4, 4.2, 4.9]) {
    boxVisual(rx, 5.28, 2.5, 0.08, 0.62, 0.08, darkMetalMat);
  }

  // ---- 3. Warm Interior Lighting, Real CC0 Furniture & Living/Bedroom Suites ----
  const interiorCtx: InteriorBuilderCtx = {
    solid: (lx, ly, lz, w, h, d, mat, kind = "concrete", localYaw = 0, cs = true) =>
      boxWallSolid(lx, ly - y0, lz, w, h, d, mat, kind, localYaw, cs),
    visual: (lx, ly, lz, w, h, d, mat, localYaw = 0, cs = false) =>
      boxVisual(lx, ly - y0, lz, w, h, d, mat, localYaw, cs),
    addMesh: (mesh, lx, ly, lz, localYaw = 0) => {
      const p = wPos(lx, lz, ly - y0);
      mesh.position.set(p.x, p.y, p.z);
      mesh.rotation.y = yaw + localYaw;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      chunk.nearGroup.add(mesh);
    },
  };
  const pal = createInteriorPalette();

  const addSafehouseGlb = (file: string, lx: number, ly: number, lz: number, axis: "x" | "y" | "z", meters: number, localYaw = 0) => {
    const g = new THREE.Group();
    interiorCtx.addMesh(g, lx, y0 + ly, lz, localYaw);
    attachGlbToGroup(g, file, 0, 0, 0, { axis, targetMeters: meters });
  };

  // Master Bedroom Suite (west wing): Modern CC0 Double Bed + Walk-In Closet + Reading Corner
  buildDetailedKingBed(interiorCtx, pal, -16.2, y0 + 0.16, -4.45, 0);
  buildDetailedCloset(interiorCtx, pal, -15.6, y0 + 0.16, 2.75, Math.PI);
  addSafehouseGlb("ph_lounge_chair.glb", -18.3, 0.16, 1.8, "y", 1.05, Math.PI * 0.72);
  addSafehouseGlb("kk_art_frame.glb", -16.2, 2.05, -6.28, "y", 1.15, 0);
  addSafehouseGlb("ph_ceiling_lamp.glb", -15.8, 3.62, -1.5, "y", 0.92);
  addSafehouseGlb("int_plant.glb", -12.4, 0.16, -5.6, "y", 1.3);

  // Warm interior PointLights (subtle warm residential glow so interiors never feel dark & gloomy)
  for (const [plx, ply, plz, intensity] of [
    [-15.6, 3.7, -1.5, 4.5],
    [-6.2, 3.8, -1.0, 5.5],
    [-2.4, 3.8, -3.5, 4.0],
    [2.4, 3.2, 0.0, 4.5],
  ] as const) {
    const lp = wPos(plx, plz, ply);
    const pt = new THREE.PointLight(0xffe5bd, intensity, 13.5, 1.6);
    pt.position.set(lp.x, lp.y, lp.z);
    chunk.nearGroup.add(pt);
  }

  // Living Room Lounge: Poly Haven CC0 Sofa + Coffee Table + Armchair + Media Console + 75" TV + Rug + Floor Lamp
  addSafehouseGlb("kk_rug.glb", -7.2, 0.165, 0.25, "x", 4.1, Math.PI * 0.5);
  addSafehouseGlb("ph_sofa.glb", -6.2, 0.16, 0.35, "x", 2.35, -Math.PI * 0.5);
  addSafehouseGlb("ph_armchair.glb", -7.9, 0.16, -1.45, "y", 0.98, 0.25);
  addSafehouseGlb("ph_coffee_table.glb", -8.0, 0.16, 0.35, "z", 1.25, 0);
  addSafehouseGlb("kk_lamp_stand.glb", -6.2, 0.16, -1.4, "y", 1.75);
  addSafehouseGlb("ph_media_console.glb", -10.55, 0.16, 0.6, "x", 2.45, Math.PI * 0.5);
  boxVisual(-11.04, 1.15, 0.6, 0.08, 1.18, 2.04, darkMetalMat);
  boxVisual(-10.98, 1.18, 0.6, 0.04, 1.06, 1.9, tvScreenMat);
  addSafehouseGlb("kk_art_frame.glb", -7.2, 2.15, -6.28, "y", 1.2, 0);
  addSafehouseGlb("ph_ceiling_lamp.glb", -7.4, 3.62, 0.2, "y", 0.95);

  // Dining & Kitchen Suite (north-east living wing)
  addSafehouseGlb("ph_dining_table.glb", -3.0, 0.16, -0.6, "x", 1.95, Math.PI * 0.5);
  addSafehouseGlb("ph_dining_chair.glb", -3.95, 0.16, -0.6, "y", 0.96, Math.PI * 0.5);
  addSafehouseGlb("ph_dining_chair.glb", -2.05, 0.16, -0.6, "y", 0.96, -Math.PI * 0.5);
  // Modern kitchen counter & appliances along north-east wall
  boxWallSolid(-3.55, 0.16, -5.85, 3.6, 0.92, 0.78, slateMat, "concrete");
  boxVisual(-3.55, 1.08, -5.85, 3.68, 0.07, 0.84, porchStoneMat);
  addSafehouseGlb("int_fridge.glb", -1.1, 0.16, -5.8, "y", 2.05);
  addSafehouseGlb("int_oven.glb", -3.2, 0.16, -5.82, "y", 0.94);
  addSafehouseGlb("int_sink.glb", -4.4, 0.16, -5.82, "y", 0.94);
  addSafehouseGlb("int_plant.glb", -10.5, 0.16, -5.6, "y", 1.25);
  addSafehouseGlb("ph_ceiling_lamp.glb", -3.2, 3.62, -3.4, "y", 0.92);

  // Warm recessed ceiling cove light strips
  boxVisual(-7.2, 4.48, -1.5, 6.0, 0.06, 0.18, warmGlowMat);
  boxVisual(-15.6, 4.48, -1.5, 5.4, 0.06, 0.18, warmGlowMat);
  boxVisual(-3.2, 4.48, -3.5, 3.2, 0.06, 0.18, warmGlowMat);

  // ---- 4. Attached 1-Car Garage + Interior Fire Door + Animated Exterior Sectional Garage Door ----
  // Interior Garage Door Frame & Ajar Steel Fire Door (lx = -0.3, lz = 1.2)
  boxVisual(-0.3, 0.16, 0.22, 0.4, 2.55, 0.08, darkMetalMat);
  boxVisual(-0.3, 0.16, 2.18, 0.4, 2.55, 0.08, darkMetalMat);
  boxVisual(0.28, 0.16, 0.35, 0.07, 2.42, 1.05, slateMat, 1.38);
  boxVisual(-0.5, 1.28, 2.28, 0.05, 0.24, 0.16, pal.coolGlow);

  // Surveillance Intel Corkboard mounted on interior dividing wall (lx = -0.34, lz = -1.35)
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

  // East & North Garage Walls (tightly segmented via boxWallSolid)
  boxWallSolid(5.1, 0.13, 0.0, 0.36, 3.6, 8.4, limestoneMat, "concrete");
  boxWallSolid(2.5, 0.13, -4.15, 5.2, 3.6, 0.36, limestoneMat, "concrete");
  // Garage Roof Slab (forms 2nd-floor terrace)
  boxWallSolid(2.5, 3.73, 0.0, 5.6, 0.34, 8.8, slateMat, "concrete");

  // Front 1-Car Garage Portal Frame (4.16m clear width centered at lx = 2.5, lz = 4.1)
  boxWallSolid(0.08, 0.13, 4.1, 0.56, 3.6, 0.42, slateMat, "concrete");
  boxWallSolid(4.92, 0.13, 4.1, 0.56, 3.6, 0.42, slateMat, "concrete");
  boxWallSolid(2.5, 3.05, 4.1, 5.2, 0.68, 0.42, slateMat, "concrete");
  // Exterior cedar accent header + twin exterior garage coach sconces + smart keypad
  boxVisual(2.5, 3.12, 4.33, 4.3, 0.42, 0.06, cedarMat);
  boxVisual(0.08, 2.05, 4.34, 0.14, 0.34, 0.1, warmGlowMat);
  boxVisual(4.92, 2.05, 4.34, 0.14, 0.34, 0.1, warmGlowMat);
  boxVisual(0.08, 1.32, 4.34, 0.14, 0.22, 0.05, pal.coolGlow);

  // ---- REAL ANIMATED EXTERIOR SECTIONAL GARAGE DOOR (lx = 2.5, lz = 4.08, 4.2m wide x 2.9m tall) ----
  const doorRoot = new THREE.Group();
  const drOrigin = wPos(2.5, 4.08, 0.13);
  doorRoot.position.set(drOrigin.x, drOrigin.y, drOrigin.z);
  doorRoot.rotation.y = yaw;
  chunk.nearGroup.add(doorRoot);

  // Side vertical guide tracks inside garage portal
  for (const tx of [-2.12, 2.12]) {
    const track = new THREE.Mesh(new THREE.BoxGeometry(0.08, 2.92, 0.12), darkMetalMat);
    track.position.set(tx, 1.46, -0.06);
    doorRoot.add(track);
  }

  const panels: GarageDoorPanel[] = [];
  const panelH = 0.71;
  for (let i = 0; i < 4; i++) {
    const pivot = new THREE.Group();
    const closedY = panelH * (i + 0.5);
    const closedZ = 0;
    pivot.position.set(0, closedY, closedZ);

    // Cedar timber panel body + dark aluminum frame stiles
    const body = new THREE.Mesh(new THREE.BoxGeometry(4.2, panelH - 0.03, 0.09), cedarMat);
    body.castShadow = true;
    body.receiveShadow = true;
    pivot.add(body);

    const rail = new THREE.Mesh(new THREE.BoxGeometry(4.24, 0.04, 0.11), darkMetalMat);
    rail.position.y = -panelH * 0.5 + 0.02;
    pivot.add(rail);

    // Top panel features 4 sleek frosted clerestory garage window lites!
    if (i === 3) {
      for (const wx of [-1.45, -0.48, 0.48, 1.45]) {
        const frm = new THREE.Mesh(new THREE.BoxGeometry(0.76, 0.34, 0.11), darkMetalMat);
        frm.position.x = wx;
        pivot.add(frm);
        const lite = new THREE.Mesh(new THREE.BoxGeometry(0.68, 0.26, 0.12), frostedLiteMat);
        lite.position.x = wx;
        pivot.add(lite);
      }
    }

    doorRoot.add(pivot);
    panels.push({
      pivot,
      closedY,
      closedZ,
      openY: 2.86 - i * 0.03,
      openZ: -0.65 - i * 0.72,
      openRotX: -Math.PI * 0.5,
    });
  }

  // Segmented tight world-space collision AABBs for the closed exterior garage door (disabled smoothly when open)
  const closedBoxes: THREE.Box3[] = [];
  const doorSegs = 6;
  const doorW = 4.2 / doorSegs;
  const dhx = (doorW * Math.abs(c) + 0.18 * Math.abs(s)) * 0.5;
  const dhz = (doorW * Math.abs(s) + 0.18 * Math.abs(c)) * 0.5;
  for (let i = 0; i < doorSegs; i++) {
    const lx = 2.5 - 2.1 + doorW * (i + 0.5);
    const sp = wPos(lx, 4.08, 0.13);
    closedBoxes.push(new THREE.Box3(new THREE.Vector3(sp.x - dhx, sp.y, sp.z - dhz), new THREE.Vector3(sp.x + dhx, sp.y + 2.9, sp.z + dhz)));
  }

  activeGarageDoor = {
    panels,
    doorWorldPos: new THREE.Vector3(drOrigin.x, drOrigin.y + 1.2, drOrigin.z),
    closedBoxes,
    spatialAABBs: null,
    aabbIds: [],
    colliderActive: true,
    openT: 0,
  };

  // Overhead shop LED strips inside garage
  boxVisual(2.5, 3.64, 0.6, 3.2, 0.06, 0.18, warmGlowMat);
  boxVisual(2.5, 3.64, -2.0, 3.2, 0.06, 0.18, warmGlowMat);

  // 1-Car Garage Gunsmith Weapon Workbench + Overtake Mod Bay + Tool Chest + Steel Shelving
  buildDetailedWeaponWorkbench(interiorCtx, pal, 2.4, y0 + 0.13, -3.45, 0);
  buildGarageModBay(interiorCtx, pal, 2.4, y0 + 0.13, 0.7, 0);
  boxWallSolid(0.45, 0.13, -3.45, 0.9, 1.1, 0.68, redToolMat, "metal");
  addSafehouseGlb("ph_steel_shelves.glb", 4.55, 0.13, -1.2, "y", 2.0, -Math.PI * 0.5);
  addSafehouseGlb("gas_can.glb", 4.4, 0.13, -3.4, "y", 0.65, 0.4);
  for (let i = 0; i < 3; i++) {
    const tp = wPos(4.5, -3.3, 0.26 + i * 0.25);
    const tire = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.32, 0.22, 14), darkMetalMat);
    tire.position.set(tp.x, tp.y, tp.z);
    tire.castShadow = true;
    chunk.nearGroup.add(tire);
  }

  // ---- 5. Backyard Pergola, Loungers & Landscaping Planters ----
  for (const px of [0.8, 3.4]) {
    boxVisual(px, 0.14, -8.8, 0.18, 2.75, 0.18, cedarMat);
    boxVisual(px, 0.14, -12.6, 0.18, 2.75, 0.18, cedarMat);
  }
  boxVisual(2.1, 2.9, -10.7, 3.0, 0.14, 4.2, cedarMat);
  for (const lx of [1.3, 2.9]) {
    boxWallSolid(lx, 0.14, -10.5, 0.85, 0.34, 2.0, cedarMat, "wood");
    boxVisual(lx, 0.48, -10.1, 0.78, 0.12, 1.2, cushionMat);
  }

  // Front Landscaped Stone Planter Boxes with Boxwood Shrubs flanking porch & driveway
  for (const [plx, plz, pw, pd] of [
    [-9.8, 6.2, 2.4, 1.2],
    [-1.2, 6.2, 1.6, 1.2],
    [-7.8, 9.6, 1.2, 3.4],
  ] as const) {
    boxWallSolid(plx, 0.06, plz, pw, 0.42, pd, slateMat, "concrete");
    boxVisual(plx, 0.48, plz, pw - 0.24, 0.48, pd - 0.24, foliageMat);
  }
  // Walkway LED bollards
  for (const bz of [9.5, 12.5, 15.2]) {
    boxVisual(-6.05, 0.13, bz, 0.14, 0.65, 0.14, darkMetalMat);
    boxVisual(-6.05, 0.78, bz, 0.12, 0.12, 0.12, warmGlowMat);
  }

  // ---- 6. Perimeter Stone Wall & Illuminated Driveway Gate Pillars (tightly segmented!) ----
  for (const wx of [-19.4, -15.4, -11.4, -7.8]) {
    boxWallSolid(wx, 0.06, 16.5, 3.4, 1.1, 0.42, slateMat, "concrete");
  }
  boxWallSolid(8.0, 0.06, 16.5, 4.2, 1.1, 0.42, slateMat, "concrete");
  for (const px of [-0.5, 5.4]) {
    boxWallSolid(px, 0.06, 16.5, 0.82, 1.65, 0.82, slateMat, "concrete");
    boxVisual(px, 1.71, 16.5, 0.6, 0.18, 0.6, warmGlowMat);
  }
  for (const wz of [-10, -2, 6, 12.5]) {
    boxWallSolid(-21.6, 0.06, wz, 0.42, 1.45, 7.6, slateMat, "concrete");
    boxWallSolid(10.2, 0.06, wz, 0.42, 1.45, 7.6, slateMat, "concrete");
  }

  // ---- 7. Register WalkableSurface matching exact non-overlapping floor heights ----
  const surfMinX = Math.min(wPos(-22, -17).x, wPos(11, -17).x, wPos(-22, 34).x, wPos(11, 34).x) - 1;
  const surfMaxX = Math.max(wPos(-22, -17).x, wPos(11, -17).x, wPos(-22, 34).x, wPos(11, 34).x) + 1;
  const surfMinZ = Math.min(wPos(-22, -17).z, wPos(11, -17).z, wPos(-22, 34).z, wPos(11, 34).z) - 1;
  const surfMaxZ = Math.max(wPos(-22, -17).z, wPos(11, -17).z, wPos(-22, 34).z, wPos(11, 34).z) + 1;
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
      // Interior living + master bedroom
      if (lx >= -20.0 && lx <= -0.15 && lz >= -6.5 && lz <= 3.5) return y0 + 0.16;
      // Front porch
      if (lx >= -11.4 && lx <= -0.1 && lz > 3.5 && lz <= 7.8) return y0 + 0.14;
      // Garage pad & threshold
      if (lx >= -0.15 && lx <= 5.1 && lz >= -4.2 && lz <= 4.6) return y0 + 0.13;
      // Backyard pool deck (around water)
      if (lx >= -13.0 && lx <= 5.1 && lz >= -14.8 && lz <= -6.5) return y0 + 0.14;
      // Entry walkway & driveway
      if (lx >= -5.8 && lx <= -3.4 && lz > 7.8 && lz <= 16.5) return y0 + 0.11;
      if (lx >= 0.2 && lx <= 4.8 && lz > 4.6 && lz <= 33.2) return y0 + 0.11;
      // Estate lawn
      if (lx >= -22.5 && lx <= 11.0 && lz >= -17.0 && lz <= 21.0) return y0 + 0.06;
      return null;
    },
  };
  heightSystem.addSurface(floorSurf);

  // Far LOD silhouette for skyline/aerial distance
  addLodBox(chunk, SAFEHOUSE_ORIGIN.x - 4.0, y0, SAFEHOUSE_ORIGIN.z, 24, 7.6, 15, 0xeae4d8, yaw);
}
