import * as THREE from "three";
import {
  APARTMENTS,
  getCarCustomConfig,
  type ApartmentId,
  type CarCustomConfig,
  type SaveData,
} from "../progression";
import { getCar } from "../vehicles/catalog";
import type { ModelLibrary } from "../vehicles/ModelLibrary";
import type { OpenWorldEngine } from "./OpenWorldEngine";
import type { WalkableSurface } from "./HeightSystem";
import {
  buildDetailedCloset,
  buildDetailedDiningSet,
  buildDetailedKingBed,
  buildDetailedKitchen,
  buildDetailedLivingLounge,
  buildDetailedWeaponWorkbench,
  buildGarageModBay,
  createInteriorPalette,
  type HomeStation,
  type InteriorBuilderCtx,
} from "./HomeInteriors";

interface ApartmentTheme {
  floorHex: number;
  wallHex: number;
  accentWallHex: number;
  mullionHex: number;
  ceilingHex: number;
  sofaHex: number;
  throwHex: number;
  accentHex: number;
  rugHex: number;
  woodDarkHex: number;
  woodLightHex: number;
  counterHex: number;
  lightHex: number;
}

const THEMES: Record<ApartmentId, ApartmentTheme> = {
  apt_oldquarter: {
    floorHex: 0x7b5438,
    wallHex: 0xeae2d4,
    accentWallHex: 0x8f4335, // warm exposed brick
    mullionHex: 0x26211e,
    ceilingHex: 0xf4efe6,
    sofaHex: 0x3b332d,
    throwHex: 0x6b3a2e,
    accentHex: 0xd99b52,
    rugHex: 0x8a7d6d,
    woodDarkHex: 0x4b3120,
    woodLightHex: 0x9c6f46,
    counterHex: 0xebe6dc,
    lightHex: 0xffd79c,
  },
  apt_midtown: {
    floorHex: 0x4e3c2f,
    wallHex: 0x2a313c,
    accentWallHex: 0x1e2530, // fluted slate
    mullionHex: 0xb08b4f, // brushed brass mullions
    ceilingHex: 0xd9dee6,
    sofaHex: 0x1e2b3c,
    throwHex: 0x1d4ed8,
    accentHex: 0xc9a050,
    rugHex: 0x606670,
    woodDarkHex: 0x2f231b,
    woodLightHex: 0x7c5a3d,
    counterHex: 0xe6e4df,
    lightHex: 0xffe2b0,
  },
  apt_westcoast: {
    floorHex: 0xcab08a, // bleached coastal oak
    wallHex: 0xf5f2eb,
    accentWallHex: 0xdbe6ea, // coastal seafoam plaster
    mullionHex: 0x374151,
    ceilingHex: 0xfaf9f5,
    sofaHex: 0xdad5cb,
    throwHex: 0x0e7490,
    accentHex: 0x38bdf8,
    rugHex: 0xb7b1a5,
    woodDarkHex: 0x7d6146,
    woodLightHex: 0xc8a97e,
    counterHex: 0xf0ece1, // travertine
    lightHex: 0xfff0d4,
  },
  apt_downtown: {
    floorHex: 0x1e222a, // honed obsidian marble
    wallHex: 0x242933,
    accentWallHex: 0x13161d,
    mullionHex: 0x475569,
    ceilingHex: 0x2d3340,
    sofaHex: 0x202731,
    throwHex: 0x0f766e,
    accentHex: 0xa855f7,
    rugHex: 0x444954,
    woodDarkHex: 0x26201c,
    woodLightHex: 0x5c4635,
    counterHex: 0x171a20, // black veined marble
    lightHex: 0xffe8c2,
  },
};

const GARAGE_BAYS: ReadonlyArray<{ lx: number; lz: number; yaw: number }> = [
  { lx: -9.0, lz: -6.2, yaw: 0 },
  { lx: -3.0, lz: -6.2, yaw: 0 },
  { lx: 3.0, lz: -6.2, yaw: 0 },
  { lx: 9.0, lz: -6.2, yaw: 0 },
  { lx: -9.0, lz: 6.2, yaw: Math.PI },
  { lx: -3.0, lz: 6.2, yaw: Math.PI },
  { lx: 3.0, lz: 6.2, yaw: Math.PI },
  { lx: 9.0, lz: 6.2, yaw: Math.PI },
];

export interface GarageCarCollider {
  pos: { x: number; y: number; z: number };
  yaw: number;
  width: number;
  length: number;
  height: number;
  speed: number;
}

export interface ApartmentSystem {
  readonly group: THREE.Group;
  getInteriorSpawn: (id: ApartmentId) => { x: number; y: number; z: number; yawDeg: number };
  getExitPosition: (id: ApartmentId) => { x: number; y: number; z: number; yawDeg: number };
  getGarageSpawn: (id: ApartmentId) => { x: number; y: number; z: number; yawDeg: number };
  getGarageStreetExit: (id: ApartmentId) => { x: number; y: number; z: number; yawDeg: number };
  getStations: (
    ownedApartments: readonly ApartmentId[],
    activeApartmentId: ApartmentId | null,
    activeGarageId: ApartmentId | null,
  ) => HomeStation[];
  getGarageCarColliders: (activeGarageId: ApartmentId | null) => readonly GarageCarCollider[];
  syncOwnership: (ownedApartments: readonly ApartmentId[]) => void;
  syncGarageCars: (save: SaveData, modelLib: ModelLibrary) => void;
  setActiveApartment: (id: ApartmentId | null) => void;
  setActiveGarage: (id: ApartmentId | null) => void;
}

export function buildWestgateApartments(engine: OpenWorldEngine): ApartmentSystem {
  const root = new THREE.Group();
  root.name = "WestgateApartments";

  const doorGlowMats = new Map<ApartmentId, THREE.MeshStandardMaterial>();
  const garageDoorGlowMats = new Map<ApartmentId, THREE.MeshStandardMaterial>();
  const exteriorDoorPos = new Map<ApartmentId, { x: number; y: number; z: number }>();
  const exteriorGarageDoorPos = new Map<ApartmentId, { x: number; y: number; z: number }>();
  const interiorStations = new Map<ApartmentId, HomeStation[]>();
  const garageStaticStations = new Map<ApartmentId, HomeStation[]>();
  const garageCarStations = new Map<ApartmentId, HomeStation[]>();
  const interiorLights = new Map<ApartmentId, THREE.PointLight[]>();
  const garageLights = new Map<ApartmentId, THREE.PointLight[]>();
  const interiorGroups = new Map<ApartmentId, THREE.Group>();
  const garageGroups = new Map<ApartmentId, THREE.Group>();
  const garageCarContainers = new Map<ApartmentId, THREE.Group>();
  const garageCarColliders = new Map<ApartmentId, GarageCarCollider[]>();

  const registerSolid = (
    parent: THREE.Group,
    x: number,
    yBase: number,
    z: number,
    w: number,
    h: number,
    d: number,
    mat: THREE.Material,
    kind: "concrete" | "wood" | "metal" | "dirt" = "concrete",
    ry = 0,
    castShadow = true,
  ) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    mesh.position.set(x, yBase + h * 0.5, z);
    mesh.rotation.y = ry;
    mesh.castShadow = castShadow;
    mesh.receiveShadow = true;
    mesh.userData.kind = kind;
    parent.add(mesh);

    const ca = Math.abs(Math.cos(ry));
    const sa = Math.abs(Math.sin(ry));
    const hx = (w * ca + d * sa) * 0.5;
    const hz = (w * sa + d * ca) * 0.5;
    const box = new THREE.Box3(
      new THREE.Vector3(x - hx, yBase, z - hz),
      new THREE.Vector3(x + hx, yBase + h, z + hz),
    );
    engine.spatialAABBs.insert(box);
    engine.spatialColliders.insert(mesh, box);
    return mesh;
  };

  const registerVisual = (
    parent: THREE.Group,
    x: number,
    yBase: number,
    z: number,
    w: number,
    h: number,
    d: number,
    mat: THREE.Material,
    ry = 0,
    castShadow = false,
  ) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    mesh.position.set(x, yBase + h * 0.5, z);
    mesh.rotation.y = ry;
    mesh.castShadow = castShadow;
    mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  };

  // ---- 1. Build Exterior Building Entrance Portals & High-Altitude Detailed Interiors ----
  for (const apt of APARTMENTS) {
    const tY = engine.heightSystem.terrainHeightAt(apt.doorPos.x, apt.doorPos.z);
    const doorY = engine.heightSystem.groundHeightAt(apt.doorPos.x, apt.doorPos.z, tY + 1.2);
    exteriorDoorPos.set(apt.id, { x: apt.doorPos.x, y: doorY, z: apt.doorPos.z });

    // Exterior architectural doorway portal attached flush to the real building facade
    const doorGrp = new THREE.Group();
    doorGrp.position.set(apt.doorPos.x, doorY, apt.doorPos.z);
    doorGrp.rotation.y = apt.doorYaw;

    const frameMat = new THREE.MeshStandardMaterial({ color: 0x1d232b, roughness: 0.36, metalness: 0.78 });
    const brassMat = new THREE.MeshStandardMaterial({ color: 0xd4aa5a, roughness: 0.25, metalness: 0.88 });
    const doorGlassMat = new THREE.MeshStandardMaterial({
      color: 0x4a7b99,
      roughness: 0.14,
      metalness: 0.55,
      transparent: true,
      opacity: 0.62,
    });
    const statusMat = new THREE.MeshStandardMaterial({
      color: 0xf59e0b,
      emissive: 0xf59e0b,
      emissiveIntensity: 1.45,
      roughness: 0.3,
    });
    doorGlowMats.set(apt.id, statusMat);

    // Outer bronze/steel vestibule frame + transom canopy + sconces
    const addDoorBox = (lx: number, ly: number, lz: number, w: number, h: number, d: number, mat: THREE.Material) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
      m.position.set(lx, ly + h * 0.5, lz);
      m.castShadow = true;
      m.receiveShadow = true;
      doorGrp.add(m);
    };
    addDoorBox(-1.32, 0, 0, 0.22, 3.1, 0.55, frameMat);
    addDoorBox(1.32, 0, 0, 0.22, 3.1, 0.55, frameMat);
    addDoorBox(0, 2.85, 0.15, 3.1, 0.32, 1.35, frameMat); // entry canopy overhang
    addDoorBox(0, 2.78, 0.45, 2.5, 0.06, 0.14, statusMat); // glowing canopy light bar
    // Double glazed lobby doors + brass vertical pull handles
    addDoorBox(-0.56, 0.04, -0.05, 1.06, 2.75, 0.12, doorGlassMat);
    addDoorBox(0.56, 0.04, -0.05, 1.06, 2.75, 0.12, doorGlassMat);
    addDoorBox(-0.14, 0.95, 0.04, 0.05, 0.72, 0.06, brassMat);
    addDoorBox(0.14, 0.95, 0.04, 0.05, 0.72, 0.06, brassMat);
    // Glowing threshold welcome mat pad on the sidewalk right in front of the door
    addDoorBox(0, 0.01, 0.72, 2.2, 0.04, 0.95, statusMat);
    root.add(doorGrp);

    // Exterior Building Multi-Car Garage Roll-Up Gate attached to the building's street facade
    const gtY = engine.heightSystem.terrainHeightAt(apt.garageDoorPos.x, apt.garageDoorPos.z);
    const gDoorY = engine.heightSystem.groundHeightAt(apt.garageDoorPos.x, apt.garageDoorPos.z, gtY + 1.2);
    exteriorGarageDoorPos.set(apt.id, { x: apt.garageDoorPos.x, y: gDoorY, z: apt.garageDoorPos.z });

    const gDoorGrp = new THREE.Group();
    gDoorGrp.position.set(apt.garageDoorPos.x, gDoorY, apt.garageDoorPos.z);
    gDoorGrp.rotation.y = apt.garageDoorYaw;
    const gShutterMat = new THREE.MeshStandardMaterial({ color: 0x333c48, roughness: 0.55, metalness: 0.45 });
    const gStatusMat = new THREE.MeshStandardMaterial({
      color: 0xf59e0b,
      emissive: 0xf59e0b,
      emissiveIntensity: 1.45,
      roughness: 0.3,
    });
    garageDoorGlowMats.set(apt.id, gStatusMat);
    const addGDoorBox = (lx: number, ly: number, lz: number, w: number, h: number, d: number, mat: THREE.Material) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
      m.position.set(lx, ly + h * 0.5, lz);
      m.castShadow = true;
      m.receiveShadow = true;
      gDoorGrp.add(m);
    };
    addGDoorBox(-2.25, 0, 0, 0.3, 3.2, 0.55, frameMat);
    addGDoorBox(2.25, 0, 0, 0.3, 3.2, 0.55, frameMat);
    addGDoorBox(0, 2.95, 0.05, 4.8, 0.38, 0.65, frameMat);
    addGDoorBox(0, 2.84, 0.36, 4.1, 0.08, 0.14, gStatusMat);
    addGDoorBox(0, 0.02, -0.05, 4.1, 2.86, 0.14, gShutterMat); // ribbed garage shutter
    for (const sy of [0.55, 1.15, 1.75, 2.35]) {
      addGDoorBox(0, sy, 0.03, 4.04, 0.05, 0.04, frameMat);
    }
    addGDoorBox(0, 0.01, 0.72, 3.6, 0.04, 1.0, gStatusMat);
    root.add(gDoorGrp);

    // ---- 2. Detailed Walkable Apartment Interior (isolated at y = 260m directly above building!) ----
    const theme = THEMES[apt.id];
    const intGroup = new THREE.Group();
    intGroup.name = `ApartmentInterior_${apt.id}`;
    const ox = apt.interiorOrigin.x;
    const oy = apt.interiorOrigin.y;
    const oz = apt.interiorOrigin.z;
    const wPos = (lx: number, lz: number) => ({ x: ox + lx, z: oz + lz });

    const floorMat = new THREE.MeshStandardMaterial({ color: theme.floorHex, roughness: 0.52, metalness: 0.08 });
    const wallMat = new THREE.MeshStandardMaterial({ color: theme.wallHex, roughness: 0.84, metalness: 0.03 });
    const accentWallMat = new THREE.MeshStandardMaterial({ color: theme.accentWallHex, roughness: 0.78, metalness: 0.08 });
    const mullionMat = new THREE.MeshStandardMaterial({ color: theme.mullionHex, roughness: 0.34, metalness: 0.78 });
    const ceilingMat = new THREE.MeshStandardMaterial({ color: theme.ceilingHex, roughness: 0.85, metalness: 0.03 });
    const panGlassMat = new THREE.MeshStandardMaterial({
      color: 0x99d2f2,
      roughness: 0.08,
      metalness: 0.3,
      transparent: true,
      opacity: 0.24,
    });

    const pal = createInteriorPalette({
      sofaHex: theme.sofaHex,
      throwHex: theme.throwHex,
      accentHex: theme.accentHex,
      rugHex: theme.rugHex,
      woodDarkHex: theme.woodDarkHex,
      woodLightHex: theme.woodLightHex,
      counterHex: theme.counterHex,
    });

    const ctx: InteriorBuilderCtx = {
      solid: (lx, ly, lz, w, h, d, mat, kind = "concrete", localYaw = 0, cs = true) => {
        const p = wPos(lx, lz);
        registerSolid(intGroup, p.x, ly, p.z, w, h, d, mat, kind, localYaw, cs);
      },
      visual: (lx, ly, lz, w, h, d, mat, localYaw = 0, cs = false) => {
        const p = wPos(lx, lz);
        registerVisual(intGroup, p.x, ly, p.z, w, h, d, mat, localYaw, cs);
      },
      addMesh: (mesh, lx, ly, lz, localYaw = 0) => {
        const p = wPos(lx, lz);
        mesh.position.set(p.x, ly, p.z);
        mesh.rotation.y = localYaw;
        mesh.castShadow = true;
        intGroup.add(mesh);
      },
    };

    // Footprint: lx in [-9.2, +9.2] (18.4m wide), lz in [-7.5, +7.5] (15.0m deep), ceiling at +3.7m
    // Floor & Ceiling slabs
    ctx.solid(0, oy - 0.35, 0, 19.0, 0.35, 15.6, floorMat, "wood", 0, false);
    ctx.solid(0, oy + 3.65, 0, 19.0, 0.32, 15.6, ceilingMat, "concrete", 0, true);
    // Warm recessed architectural ceiling coves
    ctx.visual(-3.6, oy + 3.61, 0.5, 6.2, 0.05, 0.18, pal.warmGlow);
    ctx.visual(4.2, oy + 3.61, -2.5, 5.2, 0.05, 0.18, pal.warmGlow);
    ctx.visual(4.8, oy + 3.61, 3.8, 4.4, 0.05, 0.18, pal.warmGlow);

    // Outer Walls:
    // South Entry Wall (lz = +7.5) with Foyer Front Door at lx = 0
    ctx.solid(0, oy, 7.5, 18.8, 3.65, 0.34, wallMat, "concrete");
    // Entry Door Frame + Brass Handle + Keypad (lx = -1.2, lz = +7.3)
    ctx.visual(-1.2, oy, 7.26, 1.35, 2.45, 0.08, pal.woodDark);
    ctx.visual(-1.2, oy + 2.52, 7.26, 1.48, 0.1, 0.12, pal.brass);
    ctx.visual(-0.7, oy + 1.05, 7.2, 0.06, 0.24, 0.06, pal.brass);
    ctx.visual(-0.3, oy + 1.35, 7.28, 0.14, 0.22, 0.04, pal.coolGlow); // smart door keypad

    // Building Multi-Car Garage Elevator Door in foyer (lx = -3.1, lz = +7.26)
    ctx.visual(-3.1, oy, 7.26, 1.35, 2.45, 0.08, mullionMat);
    ctx.visual(-3.1, oy + 0.04, 7.22, 0.04, 2.38, 0.08, pal.brass); // center elevator seam
    ctx.visual(-3.1, oy + 2.52, 7.26, 1.48, 0.12, 0.12, mullionMat);
    ctx.visual(-2.28, oy + 1.28, 7.28, 0.12, 0.22, 0.04, pal.coolGlow); // elevator call button

    // East Wall (lx = +9.2) — accent feature wall behind bedroom & armory
    ctx.solid(9.2, oy, 0, 0.34, 3.65, 15.3, accentWallMat, "concrete");

    // North Panoramic Glass Skyline Wall (lz = -7.5) with structural window mullions & low knee wall
    ctx.solid(0, oy, -7.5, 18.8, 0.42, 0.34, mullionMat, "metal");
    ctx.solid(0, oy + 3.25, -7.5, 18.8, 0.4, 0.34, mullionMat, "metal");
    ctx.visual(0, oy + 0.42, -7.5, 18.2, 2.83, 0.08, panGlassMat);
    for (const mx of [-9.1, -6.0, -3.0, 0, 3.0, 6.0, 9.1]) {
      ctx.solid(mx, oy, -7.5, 0.24, 3.65, 0.34, mullionMat, "metal");
    }

    // West Panoramic Glass Skyline Wall (lx = -9.2) looking straight over the sunset/ocean/avenues
    ctx.solid(-9.2, oy, 0, 0.34, 0.42, 15.3, mullionMat, "metal");
    ctx.solid(-9.2, oy + 3.25, 0, 0.34, 0.4, 15.3, mullionMat, "metal");
    ctx.visual(-9.2, oy + 0.42, 0, 0.08, 2.83, 14.8, panGlassMat);
    for (const mz of [-7.4, -3.7, 0, 3.7, 7.4]) {
      ctx.solid(-9.2, oy, mz, 0.34, 3.65, 0.24, mullionMat, "metal");
    }

    // Interior Partition Wall separating Open Living/Kitchen (west, lx < 1.2) from Master Bedroom & Closet (east, lx > 1.2)
    // Open 2.2m doorway at lz = -0.8 .. +1.4 so player walks smoothly between Living & Bedroom!
    ctx.solid(1.2, oy, -4.15, 0.28, 3.65, 6.7, accentWallMat, "concrete");
    ctx.solid(1.2, oy, 4.45, 0.28, 3.65, 6.1, accentWallMat, "concrete");
    ctx.solid(1.2, oy + 2.5, 0.3, 0.28, 1.15, 2.2, accentWallMat, "concrete");

    // ---- Furnishing the 4 Distinct Rooms ----
    // A. West-North Panoramic Living Lounge (lx = -5.6, lz = -3.6)
    buildDetailedLivingLounge(ctx, pal, -5.4, oy, -3.8, Math.PI * 0.5);

    // B. South-West Gourmet Kitchen & Waterfall Island (lx = -5.8, lz = +4.8)
    buildDetailedKitchen(ctx, pal, -5.8, oy, 5.2, 0);

    // C. Center-North Dining Area overlooking panoramic glass (lx = -1.1, lz = -4.9)
    buildDetailedDiningSet(ctx, pal, -1.2, oy, -4.9, 0);

    // D. South-Center Tactical Gunsmith Armory Alcove (lx = -1.2, lz = +2.4)
    buildDetailedWeaponWorkbench(ctx, pal, -0.35, oy, 2.35, -Math.PI * 0.5);

    // E. East-North Master Bedroom Suite (lx = +5.8, lz = -3.8, headboard against east wall)
    buildDetailedKingBed(ctx, pal, 6.5, oy, -3.8, -Math.PI * 0.5);

    // F. East-South Walk-In Wardrobe Closet (lx = +5.5, lz = +5.8, facing north)
    buildDetailedCloset(ctx, pal, 5.4, oy, 6.45, Math.PI);

    // Framed modern wall artwork above dining / foyer wall
    ctx.visual(0.98, oy + 1.5, -3.5, 0.06, 1.1, 1.7, pal.brass);
    ctx.visual(0.94, oy + 1.56, -3.5, 0.04, 0.96, 1.54, pal.accentPillow);

    // Interior warm PointLights (toggled on only when player is inside this apartment!)
    const lights: THREE.PointLight[] = [];
    for (const [lx, lz, inten] of [
      [-4.6, -2.2, 2.4],
      [-5.2, 4.4, 2.1],
      [5.6, -3.2, 2.2],
      [5.4, 4.5, 2.0],
    ]) {
      const p = wPos(lx, lz);
      const pl = new THREE.PointLight(theme.lightHex, inten, 16, 1.5);
      pl.position.set(p.x, oy + 3.1, p.z);
      pl.visible = false;
      intGroup.add(pl);
      lights.push(pl);
    }
    interiorLights.set(apt.id, lights);
    interiorGroups.set(apt.id, intGroup);
    root.add(intGroup);

    // Register WalkableSurface at y = oy (260.0m)
    const surf: WalkableSurface = {
      id: `apt_floor_${apt.id}`,
      minX: ox - 9.4,
      maxX: ox + 9.4,
      minZ: oz - 7.7,
      maxZ: oz + 7.7,
      minY: oy - 0.6,
      maxY: oy + 0.8,
      heightAt: (qx, qz) => {
        if (qx >= ox - 9.1 && qx <= ox + 9.1 && qz >= oz - 7.4 && qz <= oz + 7.4) return oy;
        return null;
      },
    };
    engine.heightSystem.addSurface(surf);

    // Register interactive stations inside this apartment
    interiorStations.set(apt.id, [
      {
        id: `${apt.id}_exit`,
        kind: "apt_door_int",
        label: `Exit ${apt.name} to Street`,
        sublabel: apt.address,
        pos: { x: ox - 1.2, y: oy, z: oz + 6.5 },
        radius: 2.3,
        apartmentId: apt.id,
        apartmentName: apt.name,
      },
      {
        id: `${apt.id}_bed`,
        kind: "bed",
        label: "King Bed · Sleep & Save",
        sublabel: "Saves progress & advances day/night cycle",
        pos: { x: ox + 5.2, y: oy, z: oz - 3.8 },
        radius: 2.9,
        apartmentId: apt.id,
      },
      {
        id: `${apt.id}_weapon_bench`,
        kind: "weapon_bench",
        label: "Gunsmith Weapon Workbench",
        sublabel: "Customize optics, muzzles, finishes & weapon upgrades",
        pos: { x: ox - 1.1, y: oy, z: oz + 2.35 },
        radius: 1.9,
        autoOpen: true,
        apartmentId: apt.id,
      },
      {
        id: `${apt.id}_closet`,
        kind: "closet",
        label: "Walk-In Wardrobe Closet",
        sublabel: "Customize operator uniform, armor & tactical gear",
        pos: { x: ox + 5.4, y: oy, z: oz + 5.4 },
        radius: 1.9,
        autoOpen: true,
        apartmentId: apt.id,
      },
      {
        id: `${apt.id}_garage_elev`,
        kind: "apt_garage_elev",
        label: `Building Garage Elevator`,
        sublabel: `Multi-Car Underground Garage · ${apt.name}`,
        pos: { x: ox - 3.1, y: oy, z: oz + 6.4 },
        radius: 2.0,
        apartmentId: apt.id,
        apartmentName: apt.name,
      },
    ]);

    // ---- 3. Building-Wide Multi-Car Underground Garage (isolated at y = 240m) ----
    const gGroup = new THREE.Group();
    gGroup.name = `ApartmentGarage_${apt.id}`;
    const gx = apt.garageOrigin.x;
    const gy = apt.garageOrigin.y;
    const gz = apt.garageOrigin.z;
    const gPos = (lx: number, lz: number) => ({ x: gx + lx, z: gz + lz });

    const gFloorMat = new THREE.MeshStandardMaterial({ color: 0x262b34, roughness: 0.78, metalness: 0.1 });
    const gWallMat = new THREE.MeshStandardMaterial({ color: 0x3b424f, roughness: 0.85, metalness: 0.05 });
    const gStripeMat = new THREE.MeshStandardMaterial({ color: 0xfacc15, roughness: 0.55 });
    const gPillarMat = new THREE.MeshStandardMaterial({ color: 0x4b5563, roughness: 0.72, metalness: 0.14 });
    const gCeilingMat = new THREE.MeshStandardMaterial({ color: 0x1e222a, roughness: 0.88 });

    const gCtx: InteriorBuilderCtx = {
      solid: (lx, ly, lz, w, h, d, mat, kind = "concrete", localYaw = 0, cs = true) => {
        const p = gPos(lx, lz);
        registerSolid(gGroup, p.x, ly, p.z, w, h, d, mat, kind, localYaw, cs);
      },
      visual: (lx, ly, lz, w, h, d, mat, localYaw = 0, cs = false) => {
        const p = gPos(lx, lz);
        registerVisual(gGroup, p.x, ly, p.z, w, h, d, mat, localYaw, cs);
      },
      addMesh: (mesh, lx, ly, lz, localYaw = 0) => {
        const p = gPos(lx, lz);
        mesh.position.set(p.x, ly, p.z);
        mesh.rotation.y = localYaw;
        mesh.castShadow = true;
        gGroup.add(mesh);
      },
    };

    // 30m x 22m Multi-Car Garage Deck (lx in [-15, +15], lz in [-11, +11], ceiling at +4.1m)
    gCtx.solid(0, gy - 0.35, 0, 30.8, 0.35, 22.8, gFloorMat, "concrete", 0, false);
    gCtx.solid(0, gy + 4.05, 0, 30.8, 0.32, 22.8, gCeilingMat, "concrete", 0, true);
    // Perimeter walls
    gCtx.solid(0, gy, -11.2, 30.8, 4.05, 0.38, gWallMat, "concrete");
    gCtx.solid(0, gy, 11.2, 30.8, 4.05, 0.38, gWallMat, "concrete");
    gCtx.solid(-15.2, gy, 0, 0.38, 4.05, 22.8, gWallMat, "concrete");
    gCtx.solid(15.2, gy, 0, 0.38, 4.05, 22.8, gWallMat, "concrete");

    // Structural concrete columns between parking aisles (clear of bays & drive aisle)
    for (const px of [-6.0, 0.0, 6.0]) {
      for (const pz of [-3.1, 3.1]) {
        gCtx.solid(px, gy, pz, 0.45, 4.05, 0.45, gPillarMat, "concrete");
        gCtx.visual(px, gy + 0.9, pz, 0.48, 0.35, 0.48, gStripeMat);
      }
    }

    // Overhead shop LED strips along the central driving aisle and bay rows
    for (const lx of [-9.0, -3.0, 3.0, 9.0]) {
      gCtx.visual(lx, gy + 4.01, -6.2, 2.2, 0.05, 0.22, pal.coolGlow);
      gCtx.visual(lx, gy + 4.01, 0, 3.4, 0.05, 0.24, pal.warmGlow);
      gCtx.visual(lx, gy + 4.01, 6.2, 2.2, 0.05, 0.22, pal.coolGlow);
    }

    // Center drive-aisle yellow lane markings
    gCtx.visual(0, gy + 0.012, -0.35, 24.0, 0.015, 0.09, gStripeMat);
    gCtx.visual(0, gy + 0.012, 0.35, 24.0, 0.015, 0.09, gStripeMat);

    // 8 Marked Multi-Car Parking Bays (2 rows of 4)
    for (const bay of GARAGE_BAYS) {
      gCtx.visual(bay.lx - 1.8, gy + 0.012, bay.lz, 0.09, 0.015, 5.4, gStripeMat);
      gCtx.visual(bay.lx + 1.8, gy + 0.012, bay.lz, 0.09, 0.015, 5.4, gStripeMat);
      const stopZ = bay.lz < 0 ? bay.lz - 2.3 : bay.lz + 2.3;
      gCtx.solid(bay.lx, gy, stopZ, 2.2, 0.14, 0.22, gPillarMat, "concrete"); // wheel stop
    }

    // Elevator Vestibule to Apartment on West Wall (lx = -14.8, lz = 0)
    gCtx.visual(-14.9, gy, 0, 0.14, 2.55, 1.55, mullionMat);
    gCtx.visual(-14.82, gy + 0.04, 0, 0.12, 2.45, 0.04, pal.brass);
    gCtx.visual(-14.85, gy + 1.32, 1.05, 0.06, 0.22, 0.14, pal.coolGlow);

    // Street Exit Roll-Up Gate on East Wall (lx = +14.8, lz = 0)
    gCtx.visual(14.9, gy, 0, 0.14, 3.1, 4.4, gPillarMat);
    for (const sy of [0.6, 1.2, 1.8, 2.4]) {
      gCtx.visual(14.82, gy + sy, 0, 0.06, 0.06, 4.35, mullionMat);
    }
    gCtx.visual(14.85, gy + 2.95, 0, 0.12, 0.1, 4.2, pal.coolGlow);

    // Overtake Tuning Kiosk tucked in NW corner (clear of bays)
    buildGarageModBay(gCtx, pal, -12.6, gy, -7.2, Math.PI * 0.5);

    const gLights: THREE.PointLight[] = [];
    for (const [lx, lz] of [
      [-8, -2],
      [0, 0],
      [8, 2],
      [-8, 4],
      [8, -4],
    ]) {
      const p = gPos(lx, lz);
      const pl = new THREE.PointLight(0xeef6ff, 2.1, 20, 1.4);
      pl.position.set(p.x, gy + 3.55, p.z);
      pl.visible = false;
      gGroup.add(pl);
      gLights.push(pl);
    }
    const carsContainer = new THREE.Group();
    carsContainer.name = `GarageCars_${apt.id}`;
    gGroup.add(carsContainer);

    garageLights.set(apt.id, gLights);
    garageGroups.set(apt.id, gGroup);
    garageCarContainers.set(apt.id, carsContainer);
    root.add(gGroup);

    const gSurf: WalkableSurface = {
      id: `apt_garage_floor_${apt.id}`,
      minX: gx - 15.4,
      maxX: gx + 15.4,
      minZ: gz - 11.4,
      maxZ: gz + 11.4,
      minY: gy - 0.6,
      maxY: gy + 0.8,
      heightAt: (qx, qz) => {
        if (qx >= gx - 15.0 && qx <= gx + 15.0 && qz >= gz - 11.0 && qz <= gz + 11.0) return gy;
        return null;
      },
    };
    engine.heightSystem.addSurface(gSurf);

    garageStaticStations.set(apt.id, [
      {
        id: `${apt.id}_garage_to_apt`,
        kind: "apt_garage_to_apt",
        label: `Take Elevator to ${apt.name}`,
        sublabel: "Return upstairs to your apartment",
        pos: { x: gx - 13.6, y: gy, z: gz },
        radius: 2.3,
        apartmentId: apt.id,
        apartmentName: apt.name,
      },
      {
        id: `${apt.id}_garage_to_street`,
        kind: "apt_garage_to_street",
        label: `Exit Garage to Street`,
        sublabel: apt.address,
        pos: { x: gx + 13.4, y: gy, z: gz },
        radius: 2.6,
        apartmentId: apt.id,
        apartmentName: apt.name,
      },
      {
        id: `${apt.id}_garage_mod`,
        kind: "garage_mod",
        label: "Overtake Garage Mod Bay",
        sublabel: "Customize paint, rims, window tint & engine tuning",
        pos: { x: gx - 12.2, y: gy, z: gz - 7.2 },
        radius: 2.5,
        apartmentId: apt.id,
      },
    ]);
    garageCarStations.set(apt.id, []);
  }

  const syncOwnership = (ownedApartments: readonly ApartmentId[]) => {
    const ownedSet = new Set(ownedApartments);
    for (const apt of APARTMENTS) {
      const owned = ownedSet.has(apt.id);
      const hex = owned ? 0x10b981 : 0xf59e0b;
      const mat = doorGlowMats.get(apt.id);
      if (mat) {
        mat.color.setHex(hex);
        mat.emissive.setHex(hex);
      }
      const gMat = garageDoorGlowMats.get(apt.id);
      if (gMat) {
        gMat.color.setHex(hex);
        gMat.emissive.setHex(hex);
      }
    }
  };

  const buildFallbackGarageCar = (custom: CarCustomConfig, colorHex: string) => {
    const grp = new THREE.Group();
    const bodyMat = new THREE.MeshStandardMaterial({
      color: custom.paintHex ?? colorHex,
      roughness: custom.paintFinish === "matte" ? 0.78 : 0.24,
      metalness: custom.paintFinish === "chrome" ? 0.92 : 0.45,
    });
    const glassMat = new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.15, metalness: 0.6 });
    const body = new THREE.Mesh(new THREE.BoxGeometry(1.86, 0.68, 4.35), bodyMat);
    body.position.y = 0.56;
    body.castShadow = true;
    grp.add(body);
    const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.56, 0.52, 2.2), glassMat);
    cabin.position.set(0, 1.12, -0.15);
    cabin.castShadow = true;
    grp.add(cabin);
    return grp;
  };

  const syncGarageCars = (save: SaveData, modelLib: ModelLibrary) => {
    const ownedCars = (save.ownedCars.length > 0 ? save.ownedCars : [save.selectedCar]).slice(0, GARAGE_BAYS.length);
    for (const apt of APARTMENTS) {
      const container = garageCarContainers.get(apt.id);
      if (!container) continue;
      while (container.children.length > 0) {
        container.remove(container.children[0]);
      }
      const stations: HomeStation[] = [];
      const colliders: GarageCarCollider[] = [];
      const gx = apt.garageOrigin.x;
      const gy = apt.garageOrigin.y;
      const gz = apt.garageOrigin.z;

      ownedCars.forEach((carId, idx) => {
        const bay = GARAGE_BAYS[idx];
        const spec = getCar(carId);
        const custom = getCarCustomConfig(save, carId);
        const wx = gx + bay.lx;
        const wz = gz + bay.lz;

        const mesh = modelLib.has(carId)
          ? modelLib.create(carId, { player: true, custom })
          : buildFallbackGarageCar(custom, spec.color);
        if (mesh) {
          // Overtake GLB faces -Z; rotate Math.PI + bay.yaw so front points into central aisle
          mesh.rotation.y = (modelLib.has(carId) ? Math.PI : 0) + bay.yaw;
          mesh.position.set(wx, gy, wz);
          container.add(mesh);
        }
        const meta = modelLib.get(carId);
        colliders.push({
          pos: { x: wx, y: gy, z: wz },
          yaw: bay.yaw,
          width: meta?.width ?? 1.96,
          length: meta?.length ?? 4.45,
          height: meta?.height ?? 1.42,
          speed: 0,
        });

        // Put interaction point just toward the center aisle / driver door so player walks right up
        const aisleOffset = bay.lz < 0 ? 1.85 : -1.85;
        stations.push({
          id: `${apt.id}_car_${carId}_${idx}`,
          kind: "apt_garage_car",
          label: `${spec.maker} ${spec.name}`,
          sublabel: "[F] Customize Car · [G] Drive Out to Street",
          pos: { x: wx, y: gy, z: wz + aisleOffset },
          radius: 2.8,
          apartmentId: apt.id,
          apartmentName: apt.name,
          carId,
        });
      });
      garageCarStations.set(apt.id, stations);
      garageCarColliders.set(apt.id, colliders);
    }
  };

  const setActiveApartment = (id: ApartmentId | null) => {
    for (const [aptId, lights] of interiorLights) {
      const on = aptId === id;
      for (const l of lights) l.visible = on;
    }
    for (const [aptId, grp] of interiorGroups) {
      grp.visible = aptId === id;
    }
  };
  setActiveApartment(null);

  const setActiveGarage = (id: ApartmentId | null) => {
    for (const [aptId, lights] of garageLights) {
      const on = aptId === id;
      for (const l of lights) l.visible = on;
    }
    for (const [aptId, grp] of garageGroups) {
      grp.visible = aptId === id;
    }
  };
  setActiveGarage(null);

  const getInteriorSpawn = (id: ApartmentId) => {
    const apt = APARTMENTS.find((a) => a.id === id) ?? APARTMENTS[0];
    return {
      x: apt.interiorOrigin.x - 1.2,
      y: apt.interiorOrigin.y + 0.05,
      z: apt.interiorOrigin.z + 5.4,
      yawDeg: 180,
    };
  };

  const getExitPosition = (id: ApartmentId) => {
    const apt = APARTMENTS.find((a) => a.id === id) ?? APARTMENTS[0];
    const tY = engine.heightSystem.terrainHeightAt(apt.exitStreetPos.x, apt.exitStreetPos.z);
    const ey = engine.heightSystem.groundHeightAt(apt.exitStreetPos.x, apt.exitStreetPos.z, tY + 1.2);
    return {
      x: apt.exitStreetPos.x,
      y: ey + 0.04,
      z: apt.exitStreetPos.z,
      yawDeg: THREE.MathUtils.radToDeg(apt.doorYaw),
    };
  };

  const getGarageSpawn = (id: ApartmentId) => {
    const apt = APARTMENTS.find((a) => a.id === id) ?? APARTMENTS[0];
    return {
      x: apt.garageOrigin.x - 11.8,
      y: apt.garageOrigin.y + 0.05,
      z: apt.garageOrigin.z,
      yawDeg: -90, // facing east down the multi-car garage aisle
    };
  };

  const getGarageStreetExit = (id: ApartmentId) => {
    const apt = APARTMENTS.find((a) => a.id === id) ?? APARTMENTS[0];
    const tY = engine.heightSystem.terrainHeightAt(apt.garageExitPos.x, apt.garageExitPos.z);
    const ey = engine.heightSystem.groundHeightAt(apt.garageExitPos.x, apt.garageExitPos.z, tY + 1.2);
    return {
      x: apt.garageExitPos.x,
      y: ey + 0.04,
      z: apt.garageExitPos.z,
      yawDeg: THREE.MathUtils.radToDeg(apt.garageDoorYaw),
    };
  };

  const getStations = (
    ownedApartments: readonly ApartmentId[],
    activeApartmentId: ApartmentId | null,
    activeGarageId: ApartmentId | null,
  ): HomeStation[] => {
    const out: HomeStation[] = [];
    const ownedSet = new Set(ownedApartments);
    for (const apt of APARTMENTS) {
      const ep = exteriorDoorPos.get(apt.id) ?? apt.doorPos;
      const gp = exteriorGarageDoorPos.get(apt.id) ?? apt.garageDoorPos;
      const owned = ownedSet.has(apt.id);
      out.push({
        id: `ext_${apt.id}`,
        kind: "apt_door_ext",
        label: owned ? `Enter ${apt.name}` : `Buy ${apt.name} (${apt.price} Cr)`,
        sublabel: `${apt.address} · ${apt.style}`,
        pos: ep,
        radius: 3.1,
        apartmentId: apt.id,
        apartmentName: apt.name,
        price: apt.price,
      });
      out.push({
        id: `ext_garage_${apt.id}`,
        kind: "apt_garage_ext",
        label: owned ? `Enter ${apt.name} Garage` : `Buy ${apt.name} (${apt.price} Cr)`,
        sublabel: owned ? "Building Multi-Car Garage" : `${apt.address} · Includes Multi-Car Garage`,
        pos: gp,
        radius: 3.4,
        apartmentId: apt.id,
        apartmentName: apt.name,
        price: apt.price,
      });
    }
    if (activeApartmentId) {
      const list = interiorStations.get(activeApartmentId);
      if (list) out.push(...list);
    }
    if (activeGarageId) {
      const gList = garageStaticStations.get(activeGarageId);
      if (gList) out.push(...gList);
      const cList = garageCarStations.get(activeGarageId);
      if (cList) out.push(...cList);
    }
    return out;
  };

  const getGarageCarColliders = (activeGarageId: ApartmentId | null): readonly GarageCarCollider[] =>
    activeGarageId ? (garageCarColliders.get(activeGarageId) ?? []) : [];

  return {
    group: root,
    getInteriorSpawn,
    getExitPosition,
    getGarageSpawn,
    getGarageStreetExit,
    getStations,
    getGarageCarColliders,
    syncOwnership,
    syncGarageCars,
    setActiveApartment,
    setActiveGarage,
  };
}
