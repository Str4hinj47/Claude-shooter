import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { materialFor } from "../kit/surface";
import type { CityChunk } from "./ChunkStreamer";
import type { RoadNetwork } from "./RoadNetwork";
import type { TerrainHeightFn } from "./HeightSystem";
import { attachGlbToGroup } from "./PropModels";
import { pickHouseModelForLot } from "./HouseCatalog";

export type FacadeStyle =
  | "glass_teal"
  | "glass_navy"
  | "glass_gold"
  | "glass_slate"
  | "limestone"
  | "granite_dark"
  | "brick_red"
  | "brick_tan"
  | "concrete_mod"
  | "stucco_warm";

interface CachedFacade {
  map: THREE.CanvasTexture;
  emissiveMap: THREE.CanvasTexture;
  roughnessMap: THREE.CanvasTexture;
  bumpMap: THREE.CanvasTexture;
  roughness: number;
  metalness: number;
}

const facadeCache = new Map<FacadeStyle, CachedFacade>();

function makeFacadeTextures(style: FacadeStyle): CachedFacade {
  const existing = facadeCache.get(style);
  if (existing) return existing;

  const size = typeof document !== "undefined" ? 1024 : 128;
  const scale = size / 256;
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const g = c.getContext("2d")!;

  const ec = document.createElement("canvas");
  ec.width = ec.height = size;
  const eg = ec.getContext("2d")!;
  eg.fillStyle = "#000000";
  eg.fillRect(0, 0, size, size);

  const rc = document.createElement("canvas");
  rc.width = rc.height = size;
  const rg = rc.getContext("2d")!;

  const bc = document.createElement("canvas");
  bc.width = bc.height = size;
  const bg = bc.getContext("2d")!;

  const palettes: Record<
    FacadeStyle,
    { wall: string; glass: string; frame: string; glow: string; cols: number; rows: number; rough: number; metal: number; isGlass: boolean }
  > = {
    glass_teal: { wall: "#243540", glass: "#3b768f", frame: "#162129", glow: "#b8ecff", cols: 6, rows: 6, rough: 1.0, metal: 0.68, isGlass: true },
    glass_navy: { wall: "#1a2534", glass: "#2f5780", frame: "#101721", glow: "#cbe3ff", cols: 6, rows: 6, rough: 1.0, metal: 0.72, isGlass: true },
    glass_gold: { wall: "#352c20", glass: "#866b3d", frame: "#1e1710", glow: "#ffe5a8", cols: 5, rows: 6, rough: 1.0, metal: 0.76, isGlass: true },
    glass_slate: { wall: "#292e33", glass: "#526576", frame: "#171a1f", glow: "#d8ebff", cols: 6, rows: 6, rough: 1.0, metal: 0.65, isGlass: true },
    limestone: { wall: "#cfc7b6", glass: "#2b3e4e", frame: "#8d8576", glow: "#ffe8b8", cols: 4, rows: 4, rough: 1.0, metal: 0.14, isGlass: false },
    granite_dark: { wall: "#484c52", glass: "#233240", frame: "#2c3036", glow: "#ffdca0", cols: 4, rows: 4, rough: 1.0, metal: 0.18, isGlass: false },
    brick_red: { wall: "#7c3b2f", glass: "#253744", frame: "#56251d", glow: "#ffcf8a", cols: 4, rows: 4, rough: 1.0, metal: 0.1, isGlass: false },
    brick_tan: { wall: "#9b7e5e", glass: "#2b3c49", frame: "#6a543c", glow: "#ffd99c", cols: 4, rows: 4, rough: 1.0, metal: 0.1, isGlass: false },
    concrete_mod: { wall: "#92979e", glass: "#31495b", frame: "#62666d", glow: "#d8f0ff", cols: 5, rows: 4, rough: 1.0, metal: 0.15, isGlass: false },
    stucco_warm: { wall: "#d4c2a3", glass: "#2f4454", frame: "#8a795f", glow: "#ffe0a3", cols: 3, rows: 3, rough: 1.0, metal: 0.08, isGlass: false },
  };

  const p = palettes[style];
  g.fillStyle = p.wall;
  g.fillRect(0, 0, size, size);

  // Wall base roughness (high matte for masonry, satin anodized for curtainwall spandrels)
  const wallRoughByte = p.isGlass ? 92 : 225;
  rg.fillStyle = `rgb(${wallRoughByte},${wallRoughByte},${wallRoughByte})`;
  rg.fillRect(0, 0, size, size);

  // Wall base bump (raised above recessed windows)
  bg.fillStyle = "rgb(208,208,208)";
  bg.fillRect(0, 0, size, size);

  // Masonry / brick / stone coursing + weathering grain
  if (style.startsWith("brick")) {
    const courseH = Math.max(4, Math.round(8 * scale));
    for (let y = 0; y < size; y += courseH) {
      g.fillStyle = "rgba(0,0,0,0.16)";
      g.fillRect(0, y, size, Math.max(1, Math.round(1.5 * scale)));
      bg.fillStyle = "rgb(138,138,138)";
      bg.fillRect(0, y, size, Math.max(1, Math.round(1.5 * scale)));
      const rowOff = ((y / courseH) % 2) * 14 * scale;
      for (let x = rowOff; x < size; x += 28 * scale) {
        g.fillStyle = "rgba(0,0,0,0.14)";
        g.fillRect(x, y, Math.max(1, Math.round(1.4 * scale)), courseH);
        bg.fillStyle = "rgb(142,142,142)";
        bg.fillRect(x, y, Math.max(1, Math.round(1.4 * scale)), courseH);
      }
    }
  } else if (!p.isGlass) {
    // Subtle architectural stone/concrete panel seams
    const panelStep = size / p.cols;
    for (let i = 0; i < p.cols; i++) {
      g.fillStyle = "rgba(0,0,0,0.09)";
      g.fillRect(i * panelStep, 0, Math.max(1, Math.round(1.5 * scale)), size);
      bg.fillStyle = "rgb(165,165,165)";
      bg.fillRect(i * panelStep, 0, Math.max(1, Math.round(1.5 * scale)), size);
    }
  }

  for (let i = 0; i < 1400; i++) {
    const x = (i * 197) % size;
    const y = (i * 313) % size;
    const sz = Math.max(1, Math.round(2 * scale));
    g.fillStyle = i % 2 === 0 ? "rgba(255,255,255,0.032)" : "rgba(0,0,0,0.04)";
    g.fillRect(x, y, sz * 2, sz);
  }

  const cw = size / p.cols;
  const ch = size / p.rows;
  for (let r = 0; r < p.rows; r++) {
    // Spandrel floor slab band + underside shadow
    const bandH = Math.max(3, ch * 0.15);
    g.fillStyle = "rgba(0,0,0,0.22)";
    g.fillRect(0, r * ch, size, bandH);
    bg.fillStyle = "rgb(238,238,238)";
    bg.fillRect(0, r * ch, size, bandH);

    for (let cIdx = 0; cIdx < p.cols; cIdx++) {
      const wx = cIdx * cw + cw * 0.12;
      const wy = r * ch + ch * 0.21;
      const ww = cw * 0.76;
      const wh = ch * 0.65;

      // Exterior frame recess + upper stone/steel lintel & projecting window sill
      g.fillStyle = p.frame;
      g.fillRect(wx - 2 * scale, wy - 2 * scale, ww + 4 * scale, wh + 4 * scale);
      g.fillStyle = "rgba(0,0,0,0.28)";
      g.fillRect(wx - 2.5 * scale, wy - 3.5 * scale, ww + 5 * scale, 2.2 * scale);
      g.fillStyle = "rgba(255,255,255,0.14)";
      g.fillRect(wx - 2.5 * scale, wy + wh + 2 * scale, ww + 5 * scale, 2.2 * scale);
      bg.fillStyle = "rgb(232,232,232)";
      bg.fillRect(wx - 2 * scale, wy - 2 * scale, ww + 4 * scale, wh + 4 * scale);
      bg.fillStyle = "rgb(248,248,248)";
      bg.fillRect(wx - 2.5 * scale, wy + wh + 2 * scale, ww + 5 * scale, 2.5 * scale);

      // Deep interior gradient behind glass pane (sky tint -> dark room interior -> subtle blinds)
      const grad = g.createLinearGradient(wx, wy, wx, wy + wh);
      grad.addColorStop(0, p.glass);
      grad.addColorStop(0.55, p.frame);
      grad.addColorStop(1, "#0d131a");
      g.fillStyle = grad;
      g.fillRect(wx, wy, ww, wh);

      // Horizontal office blinds / interior ceiling bar inside upper third
      const blindSeed = (r * 19 + cIdx * 37 + style.length * 13) % 7;
      if (blindSeed < 4) {
        const blindH = wh * (0.18 + blindSeed * 0.08);
        g.fillStyle = "rgba(255,255,255,0.11)";
        g.fillRect(wx, wy, ww, blindH);
      }

      // Crisp specular diagonal sky reflection band
      g.fillStyle = "rgba(220,242,255,0.16)";
      g.fillRect(wx + 2 * scale, wy + 2 * scale, ww * 0.34, wh - 4 * scale);

      // Glossy low-roughness glass surface (roughness ~ 0.07) vs matte frame
      rg.fillStyle = "rgb(18,18,18)";
      rg.fillRect(wx, wy, ww, wh);
      bg.fillStyle = "rgb(82,82,82)";
      bg.fillRect(wx, wy, ww, wh);

      // Inner vertical + transom mullion bar
      g.fillStyle = p.frame;
      g.fillRect(wx + ww * 0.5 - 1.2 * scale, wy, 2.4 * scale, wh);
      g.fillRect(wx, wy + wh * 0.32, ww, 1.8 * scale);
      rg.fillStyle = "rgb(118,118,118)";
      rg.fillRect(wx + ww * 0.5 - 1.2 * scale, wy, 2.4 * scale, wh);
      rg.fillRect(wx, wy + wh * 0.32, ww, 1.8 * scale);
      bg.fillStyle = "rgb(185,185,185)";
      bg.fillRect(wx + ww * 0.5 - 1.2 * scale, wy, 2.4 * scale, wh);
      bg.fillRect(wx, wy + wh * 0.32, ww, 1.8 * scale);

      // Deterministic lit interior rooms (~38% softly lit with warm/cool variation)
      const h = (r * 31 + cIdx * 17 + style.length * 7) % 11;
      if (h < 4) {
        eg.fillStyle = p.glow;
        eg.globalAlpha = 0.28 + (h % 3) * 0.14;
        eg.fillRect(wx + 2 * scale, wy + 2 * scale, ww - 4 * scale, wh - 4 * scale);
        eg.globalAlpha = 1;
      }
    }
  }

  const map = new THREE.CanvasTexture(c);
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  map.anisotropy = 4;
  map.colorSpace = THREE.SRGBColorSpace;

  const emissiveMap = new THREE.CanvasTexture(ec);
  emissiveMap.wrapS = emissiveMap.wrapT = THREE.RepeatWrapping;
  emissiveMap.anisotropy = 4;
  emissiveMap.colorSpace = THREE.SRGBColorSpace;

  const roughnessMap = new THREE.CanvasTexture(rc);
  roughnessMap.wrapS = roughnessMap.wrapT = THREE.RepeatWrapping;
  roughnessMap.anisotropy = 4;

  const bumpMap = new THREE.CanvasTexture(bc);
  bumpMap.wrapS = bumpMap.wrapT = THREE.RepeatWrapping;
  bumpMap.anisotropy = 4;

  const out: CachedFacade = { map, emissiveMap, roughnessMap, bumpMap, roughness: p.rough, metalness: p.metal };
  facadeCache.set(style, out);
  return out;
}

const facadeMatCache = new Map<string, THREE.MeshStandardMaterial>();

export function createFacadeMaterial(
  style: FacadeStyle,
  repeatX: number,
  repeatY: number,
  tintHex?: number,
): THREE.MeshStandardMaterial {
  const rx = Math.max(1, repeatX);
  const ry = Math.max(1, repeatY);
  const key = `${style}_${rx}_${ry}_${tintHex ?? -1}`;
  const hit = facadeMatCache.get(key);
  if (hit) return hit;

  const f = makeFacadeTextures(style);

  const map = f.map.clone();
  map.repeat.set(rx, ry);
  map.needsUpdate = true;

  const em = f.emissiveMap.clone();
  em.repeat.set(rx, ry);
  em.needsUpdate = true;

  const rm = f.roughnessMap.clone();
  rm.repeat.set(rx, ry);
  rm.needsUpdate = true;

  const bm = f.bumpMap.clone();
  bm.repeat.set(rx, ry);
  bm.needsUpdate = true;

  const mat = new THREE.MeshStandardMaterial({
    map,
    emissiveMap: em,
    roughnessMap: rm,
    bumpMap: bm,
    bumpScale: 0.085,
    emissive: new THREE.Color(0xffffff),
    emissiveIntensity: 0.24,
    color: tintHex ?? 0xffffff,
    roughness: f.roughness,
    metalness: f.metalness,
  });
  facadeMatCache.set(key, mat);
  return mat;
}

const _dayGlassCol = new THREE.Color(0x283848);
const _nightGlassCol = new THREE.Color(0xffcf82);

interface NightGlowEntry {
  mat: THREE.MeshStandardMaterial;
  day: number;
  night: number;
}
const nightGlowRegistry: NightGlowEntry[] = [];
let currentNightDarkness = 0;

/** Registers a landmark emissive material so its glow scales dynamically with time-of-day & storm darkness. */
export function registerNightGlowMaterial<T extends THREE.MeshStandardMaterial>(
  mat: T,
  dayIntensity = 0.22,
  nightIntensity = 3.0,
): T {
  mat.emissiveIntensity = dayIntensity + currentNightDarkness * (nightIntensity - dayIntensity);
  nightGlowRegistry.push({ mat, day: dayIntensity, night: nightIntensity });
  return mat;
}

/** Adjusts building facade window grids, residential panes, porch bollards & rooftop beacons for time-of-day/storm darkness (0..1). */
export function setCityLightingDarkness(darkness: number): void {
  const d = Math.max(0, Math.min(1, darkness));
  currentNightDarkness = d;
  const facadeIntensity = 0.12 + d * 1.33;
  for (const mat of facadeMatCache.values()) {
    mat.emissiveIntensity = facadeIntensity;
  }
  if (kitMats) {
    kitMats.glassPane.emissive.copy(_dayGlassCol).lerp(_nightGlassCol, d);
    kitMats.glassPane.emissiveIntensity = 0.08 + d * 0.84;
    kitMats.warmGlow.emissiveIntensity = 0.25 + d * 2.95;
    kitMats.beaconRed.emissiveIntensity = 0.9 + d * 2.7;
  }
  for (let i = 0; i < nightGlowRegistry.length; i++) {
    const entry = nightGlowRegistry[i];
    entry.mat.emissiveIntensity = entry.day + d * (entry.night - entry.day);
  }
}

export function addSolidBox(
  chunk: CityChunk,
  x: number,
  yBase: number,
  z: number,
  w: number,
  h: number,
  d: number,
  mat: THREE.Material,
  ry = 0,
  kind: "concrete" | "metal" | "wood" | "dirt" = "concrete",
  castShadow = true,
  receiveShadow = true,
): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  mesh.position.set(x, yBase + h * 0.5, z);
  mesh.rotation.y = ry;
  mesh.castShadow = castShadow;
  mesh.receiveShadow = receiveShadow;
  mesh.userData.kind = kind;
  chunk.nearGroup.add(mesh);
  chunk.colliders.push(mesh);

  // Register tight world-space AABB
  const ca = Math.abs(Math.cos(ry));
  const sa = Math.abs(Math.sin(ry));
  const hx = (w * ca + d * sa) * 0.5;
  const hz = (w * sa + d * ca) * 0.5;
  chunk.aabbs.push(new THREE.Box3(new THREE.Vector3(x - hx, yBase, z - hz), new THREE.Vector3(x + hx, yBase + h, z + hz)));
  return mesh;
}

export function addVisualBox(
  group: THREE.Group,
  x: number,
  yBase: number,
  z: number,
  w: number,
  h: number,
  d: number,
  mat: THREE.Material,
  ry = 0,
  castShadow = true,
  receiveShadow = true,
): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  mesh.position.set(x, yBase + h * 0.5, z);
  mesh.rotation.y = ry;
  mesh.castShadow = castShadow;
  mesh.receiveShadow = receiveShadow;
  group.add(mesh);
  return mesh;
}

const lodMatCache = new Map<number, THREE.MeshStandardMaterial>();

export function addLodBox(
  chunk: CityChunk,
  x: number,
  yBase: number,
  z: number,
  w: number,
  h: number,
  d: number,
  colorHex: number,
  ry = 0,
): void {
  let mat = lodMatCache.get(colorHex);
  if (!mat) {
    mat = new THREE.MeshStandardMaterial({ color: colorHex, roughness: 0.72, metalness: 0.15 });
    lodMatCache.set(colorHex, mat);
  }
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, yBase + h * 0.5, z);
  m.rotation.y = ry;
  chunk.lodGroup.add(m);
}

/**
 * Checks whether a circular/rectangular building footprint is safely clear of all roads & bridges.
 */
export function isFootprintClearOfRoads(
  roads: RoadNetwork,
  x: number,
  z: number,
  radius: number,
): boolean {
  const inf = roads.getRoadInfluence(x, z, radius + 24, false);
  if (!inf) return true;
  return inf.edgeDist >= radius;
}

export type ChunkPopulateCallback = (chunk: CityChunk, terrainAt: TerrainHeightFn, roads: RoadNetwork) => void;

/**
 * Registry allowing multiple independent district modules (Phases 2–8) to populate
 * Westgate Bay chunks cleanly without editing core engine code.
 */
export class CityChunkDispatcher {
  private readonly handlers = new Map<string, ChunkPopulateCallback[]>();
  private readonly globalHooks: ChunkPopulateCallback[] = [];

  registerChunkHandler(cx: number, cz: number, fn: ChunkPopulateCallback): void {
    const key = `${cx},${cz}`;
    let list = this.handlers.get(key);
    if (!list) {
      list = [];
      this.handlers.set(key, list);
    }
    list.push(fn);
  }

  registerWorldBounds(
    minX: number,
    maxX: number,
    minZ: number,
    maxZ: number,
    worldMin: number,
    chunkSize: number,
    fn: ChunkPopulateCallback,
  ): void {
    const cMinX = Math.floor((minX - worldMin) / chunkSize);
    const cMaxX = Math.floor((maxX - worldMin) / chunkSize);
    const cMinZ = Math.floor((minZ - worldMin) / chunkSize);
    const cMaxZ = Math.floor((maxZ - worldMin) / chunkSize);
    for (let cx = cMinX; cx <= cMaxX; cx++) {
      for (let cz = cMinZ; cz <= cMaxZ; cz++) {
        this.registerChunkHandler(cx, cz, fn);
      }
    }
  }

  /** Register a placement callback for the chunk containing (x, z). */
  registerAtPoint(
    x: number,
    z: number,
    worldMin: number,
    chunkSize: number,
    fn: ChunkPopulateCallback,
  ): void {
    const cx = Math.floor((x - worldMin) / chunkSize);
    const cz = Math.floor((z - worldMin) / chunkSize);
    this.registerChunkHandler(cx, cz, fn);
  }

  registerGlobalHook(fn: ChunkPopulateCallback): void {
    this.globalHooks.push(fn);
  }

  buildChunk(chunk: CityChunk, terrainAt: TerrainHeightFn, roads: RoadNetwork): void {
    const list = this.handlers.get(chunk.key);
    if (list) {
      for (let i = 0; i < list.length; i++) list[i](chunk, terrainAt, roads);
    }
    for (let i = 0; i < this.globalHooks.length; i++) {
      this.globalHooks[i](chunk, terrainAt, roads);
    }
    mergeGroupVisuals(chunk.nearGroup, new Set(chunk.colliders));
    mergeGroupVisuals(chunk.lodGroup);
  }
}

function mergeGroupVisuals(root: THREE.Group, skip?: Set<THREE.Object3D>): void {
  root.updateMatrixWorld(true);
  const invRoot = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const relMat = new THREE.Matrix4();

  type Bucket = {
    mat: THREE.Material;
    cast: boolean;
    recv: boolean;
    meshes: THREE.Mesh[];
  };
  const buckets = new Map<string, Bucket>();

  const visit = (obj: THREE.Object3D, blocked: boolean) => {
    const isBlocked = blocked || Boolean(obj.userData?.noMerge);
    if (!isBlocked && obj instanceof THREE.Mesh && !(obj instanceof THREE.InstancedMesh)) {
      if (!skip?.has(obj) && obj.children.length === 0 && !Array.isArray(obj.material)) {
        const g = obj.geometry;
        if (g?.attributes?.position && g.attributes.normal) {
          const hasUv = Boolean(g.attributes.uv) ? 1 : 0;
          const key = `${obj.material.uuid}_${obj.castShadow ? 1 : 0}_${obj.receiveShadow ? 1 : 0}_${hasUv}`;
          let b = buckets.get(key);
          if (!b) {
            b = { mat: obj.material, cast: obj.castShadow, recv: obj.receiveShadow, meshes: [] };
            buckets.set(key, b);
          }
          b.meshes.push(obj);
        }
      }
    }
    for (let i = 0; i < obj.children.length; i++) {
      visit(obj.children[i], isBlocked);
    }
  };
  visit(root, false);

  for (const b of buckets.values()) {
    if (b.meshes.length < 2) continue;
    const parts: THREE.BufferGeometry[] = [];
    const removeList: THREE.Mesh[] = [];
    for (const m of b.meshes) {
      let g = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone();
      for (const attrName of Object.keys(g.attributes)) {
        if (attrName !== "position" && attrName !== "normal" && attrName !== "uv") {
          g.deleteAttribute(attrName);
        }
      }
      relMat.multiplyMatrices(invRoot, m.matrixWorld);
      g.applyMatrix4(relMat);
      parts.push(g);
      removeList.push(m);
    }
    const merged = mergeGeometries(parts, false);
    for (const p of parts) p.dispose();
    if (!merged) continue;
    for (const m of removeList) {
      m.removeFromParent();
      m.geometry.dispose();
    }
    const out = new THREE.Mesh(merged, b.mat);
    out.castShadow = b.cast;
    out.receiveShadow = b.recv;
    root.add(out);
  }
}

// ---------------------------------------------------------------------------
// Shared high-detail architectural assembly kit (cached materials, clean LOD)
// ---------------------------------------------------------------------------

interface KitMaterials {
  trimWhite: THREE.MeshStandardMaterial;
  shutterDark: THREE.MeshStandardMaterial;
  shutterTeal: THREE.MeshStandardMaterial;
  glassPane: THREE.MeshStandardMaterial;
  doorWood: THREE.MeshStandardMaterial;
  garagePanel: THREE.MeshStandardMaterial;
  stoneBase: THREE.MeshStandardMaterial;
  concreteWalk: THREE.MeshStandardMaterial;
  asphaltDrive: THREE.MeshStandardMaterial;
  brickChimney: THREE.MeshStandardMaterial;
  fenceWood: THREE.MeshStandardMaterial;
  hvacMetal: THREE.MeshStandardMaterial;
  darkSteel: THREE.MeshStandardMaterial;
  brass: THREE.MeshStandardMaterial;
  warmGlow: THREE.MeshStandardMaterial;
  shrubMat: THREE.MeshStandardMaterial;
  beaconRed: THREE.MeshStandardMaterial;
}

let kitMats: KitMaterials | null = null;
export function getKitMaterials(): KitMaterials {
  if (kitMats) return kitMats;
  kitMats = {
    trimWhite: materialFor(0xf4f4f6, { roughness: 0.68, family: "wood", seed: 401 }),
    shutterDark: materialFor(0x1f2937, { roughness: 0.62, family: "wood", seed: 402 }),
    shutterTeal: materialFor(0x284b52, { roughness: 0.64, family: "wood", seed: 403 }),
    glassPane: new THREE.MeshStandardMaterial({
      color: 0x1a2e40,
      roughness: 0.08,
      metalness: 0.78,
      emissive: 0x283848,
      emissiveIntensity: 0.14,
    }),
    doorWood: materialFor(0x5c3622, { roughness: 0.58, family: "wood", seed: 404 }),
    garagePanel: materialFor(0xe5e7eb, { roughness: 0.55, metalness: 0.22, family: "metal", seed: 405 }),
    stoneBase: materialFor(0x747678, { roughness: 0.88, family: "stone", seed: 406, repeat: 2 }),
    concreteWalk: materialFor(0xc0beb8, { roughness: 0.86, family: "concrete", seed: 407, repeat: 2 }),
    asphaltDrive: materialFor(0x3a3e44, { roughness: 0.88, family: "asphalt", seed: 408, repeat: 2 }),
    brickChimney: materialFor(0x7c3e32, { roughness: 0.86, family: "brick", seed: 409 }),
    fenceWood: materialFor(0x7e5a3c, { roughness: 0.85, family: "wood", seed: 410, repeat: 2 }),
    hvacMetal: materialFor(0x9aa2ac, { roughness: 0.45, metalness: 0.62, family: "metal", seed: 411 }),
    darkSteel: materialFor(0x252b33, { roughness: 0.42, metalness: 0.76, family: "metal", seed: 412 }),
    brass: materialFor(0xd4a64a, { roughness: 0.26, metalness: 0.88, family: "metal", seed: 413 }),
    warmGlow: new THREE.MeshStandardMaterial({
      color: 0xfff3d4,
      emissive: 0xffc966,
      emissiveIntensity: 1.8,
      roughness: 0.2,
    }),
    shrubMat: materialFor(0x3a6e34, { roughness: 0.9, family: "grass", seed: 414 }),
    beaconRed: new THREE.MeshStandardMaterial({
      color: 0xff3b30,
      emissive: 0xff2a1f,
      emissiveIntensity: 2.6,
      roughness: 0.25,
    }),
  };
  return kitMats;
}

class GeoBatcher {
  private readonly buckets = new Map<THREE.Material, THREE.BufferGeometry[]>();

  add(mat: THREE.Material, geo: THREE.BufferGeometry, lx = 0, ly = 0, lz = 0, rx = 0, ry = 0, rz = 0): void {
    const g = geo.index ? geo.toNonIndexed() : geo;
    if (geo.index) geo.dispose();
    if (rx) g.rotateX(rx);
    if (ry) g.rotateY(ry);
    if (rz) g.rotateZ(rz);
    if (lx || ly || lz) g.translate(lx, ly, lz);
    let list = this.buckets.get(mat);
    if (!list) {
      list = [];
      this.buckets.set(mat, list);
    }
    list.push(g);
  }

  flush(parent: THREE.Object3D, castShadow = true, receiveShadow = true): void {
    for (const [mat, list] of this.buckets) {
      if (list.length === 0) continue;
      const merged = list.length === 1 ? list[0] : mergeGeometries(list, false);
      if (merged) {
        const mesh = new THREE.Mesh(merged, mat);
        mesh.castShadow = castShadow;
        mesh.receiveShadow = receiveShadow;
        parent.add(mesh);
      }
      if (list.length > 1) {
        for (const g of list) g.dispose();
      }
    }
    this.buckets.clear();
  }
}

function addFramedWindowBatched(
  batch: GeoBatcher,
  lx: number,
  lyMid: number,
  lz: number,
  w: number,
  h: number,
  facing: "front" | "back" | "left" | "right",
  shutterMat: THREE.Material,
  withShutters = true,
): void {
  const km = getKitMaterials();
  const ry = facing === "back" ? Math.PI : facing === "right" ? Math.PI * 0.5 : facing === "left" ? -Math.PI * 0.5 : 0;
  const place = (ox: number, oy: number, oz: number): [number, number, number] => {
    const c = Math.cos(ry);
    const s = Math.sin(ry);
    return [lx + ox * c + oz * s, lyMid + oy, lz - ox * s + oz * c];
  };

  const [fx, fy, fz] = place(0, 0, 0.05);
  batch.add(km.trimWhite, new THREE.BoxGeometry(w + 0.22, h + 0.22, 0.12), fx, fy, fz, 0, ry, 0);

  const [px, py, pz] = place(0, 0, 0.09);
  batch.add(km.glassPane, new THREE.BoxGeometry(w, h, 0.06), px, py, pz, 0, ry, 0);

  const [mx, my, mz] = place(0, 0, 0.10);
  batch.add(km.trimWhite, new THREE.BoxGeometry(0.055, h, 0.08), mx, my, mz, 0, ry, 0);
  batch.add(km.trimWhite, new THREE.BoxGeometry(w, 0.055, 0.08), mx, my, mz, 0, ry, 0);

  const [sx, sy, sz] = place(0, -h * 0.5 - 0.07, 0.06);
  batch.add(km.stoneBase, new THREE.BoxGeometry(w + 0.32, 0.09, 0.22), sx, sy, sz, 0, ry, 0);

  if (withShutters) {
    for (const side of [-1, 1]) {
      const [shx, shy, shz] = place(side * (w * 0.5 + 0.14 + w * 0.17), 0, 0.02);
      batch.add(shutterMat, new THREE.BoxGeometry(w * 0.34, h + 0.04, 0.07), shx, shy, shz, 0, ry, 0);
    }
  }
}

export interface DetailedHouseOpts {
  x: number;
  yBase: number;
  z: number;
  w: number;
  d: number;
  h: number;
  wallMat: THREE.Material;
  roofMat: THREE.Material;
  lawnMat: THREE.Material;
  yaw: number;
  seed?: number;
  district?: string;
  useGlb?: boolean;
  glbFile?: string;
}

/**
 * Builds a multi-part detailed suburban residence merged per material for high FPS,
 * and asynchronously upgrades the visual mesh in-browser to an open-source house GLB
 * while keeping solid AABB/collider bounds intact.
 */
export function addDetailedHouse(chunk: CityChunk, opts: DetailedHouseOpts): void {
  const { x, yBase, z, w, d, h, wallMat, roofMat, lawnMat, yaw, seed = 0, district, useGlb = true, glbFile } = opts;
  const km = getKitMaterials();
  const shutterMat = seed % 2 === 0 ? km.shutterDark : km.shutterTeal;

  // 1. Yard pad & main solid building collider
  addSolidBox(chunk, x, yBase - 0.14, z, w + 6.4, 0.24, d + 6.4, lawnMat, yaw, "dirt", false, true);
  const wallBox = addSolidBox(chunk, x, yBase + 0.45, z, w, h - 0.45, d, wallMat, yaw, "concrete");

  // Local architectural group aligned to lot yaw
  const grp = new THREE.Group();
  grp.position.set(x, yBase, z);
  grp.rotation.y = yaw;
  chunk.nearGroup.add(grp);

  const b = new GeoBatcher();
  const fenceBatch = new GeoBatcher();

  // Stone foundation plinth + corner trim boards
  b.add(km.stoneBase, new THREE.BoxGeometry(w + 0.14, 0.5, d + 0.14), 0, 0.25, 0);
  for (const cx of [-w * 0.5, w * 0.5]) {
    for (const cz of [-d * 0.5, d * 0.5]) {
      b.add(km.trimWhite, new THREE.BoxGeometry(0.18, h, 0.18), cx, h * 0.5, cz);
    }
  }

  // Front Porch (`+Z` face)
  const hasGarage = w >= 9.5;
  const doorX = hasGarage ? -w * 0.2 : 0;
  const porchW = hasGarage ? w * 0.46 : w * 0.52;
  const porchD = 2.0;
  const porchZ = d * 0.5 + porchD * 0.5;

  b.add(km.concreteWalk, new THREE.BoxGeometry(porchW, 0.36, porchD), doorX, 0.18, porchZ);
  b.add(km.concreteWalk, new THREE.BoxGeometry(1.8, 0.18, 0.45), doorX, 0.09, d * 0.5 + porchD + 0.22);
  b.add(km.concreteWalk, new THREE.BoxGeometry(1.5, 0.06, 2.2), doorX, 0.04, d * 0.5 + porchD + 1.4);

  for (const px of [doorX - porchW * 0.42, doorX + porchW * 0.42]) {
    b.add(km.trimWhite, new THREE.BoxGeometry(0.18, 2.75, 0.18), px, 0.36 + 1.375, d * 0.5 + porchD - 0.18);
    b.add(km.stoneBase, new THREE.BoxGeometry(0.28, 0.14, 0.28), px, 0.43, d * 0.5 + porchD - 0.18);
  }
  // Porch balustrade railings & side pickets
  for (const side of [-1, 1]) {
    const rx = doorX + side * porchW * 0.42;
    b.add(km.trimWhite, new THREE.BoxGeometry(0.1, 0.08, porchD - 0.36), rx, 1.15, d * 0.5 + porchD * 0.5 - 0.1);
    b.add(km.trimWhite, new THREE.BoxGeometry(0.1, 0.08, porchD - 0.36), rx, 0.5, d * 0.5 + porchD * 0.5 - 0.1);
  }
  b.add(km.trimWhite, new THREE.BoxGeometry(porchW + 0.35, 0.18, porchD + 0.25), doorX, 3.18, porchZ);
  b.add(roofMat, new THREE.BoxGeometry(porchW + 0.45, 0.22, porchD + 0.35), doorX, 3.36, porchZ);

  // Front entry door frame, door leaf, handle & porch sconce
  b.add(km.trimWhite, new THREE.BoxGeometry(1.26, 2.34, 0.12), doorX, 0.36 + 1.17, d * 0.5 + 0.02);
  b.add(km.doorWood, new THREE.BoxGeometry(1.04, 2.16, 0.12), doorX, 0.36 + 1.08, d * 0.5 + 0.05);
  b.add(km.brass, new THREE.BoxGeometry(0.12, 0.08, 0.08), doorX + 0.36, 1.42, d * 0.5 + 0.13);
  b.add(km.warmGlow, new THREE.BoxGeometry(0.16, 0.24, 0.14), doorX - 0.78, 2.25, d * 0.5 + 0.08);

  // Attached Garage Door + Driveway Apron on right front wing
  if (hasGarage) {
    const garX = w * 0.24;
    const garW = Math.min(3.5, w * 0.36);
    b.add(km.trimWhite, new THREE.BoxGeometry(garW + 0.26, 2.38, 0.14), garX, 1.2, d * 0.5 + 0.03);
    b.add(km.garagePanel, new THREE.BoxGeometry(garW, 2.22, 0.14), garX, 1.12, d * 0.5 + 0.06);
    for (let rib = 0; rib < 4; rib++) {
      b.add(km.darkSteel, new THREE.BoxGeometry(garW - 0.16, 0.05, 0.05), garX, 0.45 + rib * 0.52, d * 0.5 + 0.13);
    }
    for (const cx of [garX - garW * 0.5 - 0.24, garX + garW * 0.5 + 0.24]) {
      b.add(km.warmGlow, new THREE.BoxGeometry(0.14, 0.22, 0.12), cx, 2.05, d * 0.5 + 0.08);
    }
    b.add(km.asphaltDrive, new THREE.BoxGeometry(garW + 0.4, 0.05, 3.2), garX, 0.03, d * 0.5 + 1.65);
  } else {
    addFramedWindowBatched(b, w * 0.28, 1.95, d * 0.5, 1.15, 1.3, "front", shutterMat, true);
    addFramedWindowBatched(b, -w * 0.28, 1.95, d * 0.5, 1.15, 1.3, "front", shutterMat, true);
    // Window flower boxes with greenery
    for (const fx of [-w * 0.28, w * 0.28]) {
      b.add(km.fenceWood, new THREE.BoxGeometry(1.25, 0.22, 0.28), fx, 1.18, d * 0.5 + 0.16);
      b.add(km.shrubMat, new THREE.BoxGeometry(1.12, 0.18, 0.22), fx, 1.36, d * 0.5 + 0.16);
    }
  }

  if (h >= 5.2) {
    addFramedWindowBatched(b, -w * 0.24, 3.85, d * 0.5, 1.15, 1.2, "front", shutterMat, true);
    addFramedWindowBatched(b, w * 0.24, 3.85, d * 0.5, 1.15, 1.2, "front", shutterMat, true);
    addFramedWindowBatched(b, -w * 0.24, 3.85, -d * 0.5, 1.15, 1.2, "back", shutterMat, true);
    addFramedWindowBatched(b, w * 0.24, 3.85, -d * 0.5, 1.15, 1.2, "back", shutterMat, true);
    for (const sz of [-d * 0.22, d * 0.22]) {
      addFramedWindowBatched(b, -w * 0.5, 3.85, sz, 1.15, 1.2, "left", shutterMat, true);
      addFramedWindowBatched(b, w * 0.5, 3.85, sz, 1.15, 1.2, "right", shutterMat, true);
    }
  }

  for (const sz of [-d * 0.22, d * 0.22]) {
    addFramedWindowBatched(b, -w * 0.5, 1.95, sz, 1.15, 1.25, "left", shutterMat, true);
    addFramedWindowBatched(b, w * 0.5, 1.95, sz, 1.15, 1.25, "right", shutterMat, true);
  }
  addFramedWindowBatched(b, -w * 0.24, 1.95, -d * 0.5, 1.25, 1.25, "back", shutterMat, true);
  addFramedWindowBatched(b, w * 0.24, 1.95, -d * 0.5, 1.25, 1.25, "back", shutterMat, true);

  for (const sx of [doorX - porchW * 0.5 - 0.55, hasGarage ? -w * 0.42 : w * 0.42]) {
    const shrub = new THREE.IcosahedronGeometry(0.42, 1);
    shrub.scale(1.1, 0.72, 0.95);
    b.add(km.shrubMat, shrub, sx, 0.34, d * 0.5 + 0.55);
  }

  // Eave fascia trim + overhanging pitched gable roof
  b.add(km.trimWhite, new THREE.BoxGeometry(w + 0.72, 0.24, d + 0.72), 0, h - 0.08, 0);
  const ridgeH = Math.min(3.1, d * 0.34);
  const roofShape = new THREE.Shape();
  roofShape.moveTo(-(d * 0.5 + 0.55), 0);
  roofShape.lineTo(d * 0.5 + 0.55, 0);
  roofShape.lineTo(0, ridgeH);
  roofShape.closePath();
  const roofGeo = new THREE.ExtrudeGeometry(roofShape, { depth: w + 0.9, bevelEnabled: false });
  b.add(roofMat, roofGeo, -(w + 0.9) * 0.5, h + 0.02, 0, 0, Math.PI * 0.5, 0);

  // Brick chimney + cap
  const chimX = -w * 0.28;
  const chimZ = -d * 0.16;
  b.add(km.brickChimney, new THREE.BoxGeometry(0.85, ridgeH + 0.95, 0.85), chimX, h + (ridgeH + 0.95) * 0.5 - 0.1, chimZ);
  b.add(km.stoneBase, new THREE.BoxGeometry(1.02, 0.16, 1.02), chimX, h + ridgeH + 0.9, chimZ);

  // Front roof gable dormer window on larger homes + curbside mailbox post
  if (w >= 11 && ridgeH >= 1.9) {
    const dZ = d * 0.24;
    b.add(wallMat, new THREE.BoxGeometry(1.9, 1.35, 1.6), 0, h + ridgeH * 0.42, dZ);
    b.add(km.trimWhite, new THREE.BoxGeometry(2.1, 0.16, 1.85), 0, h + ridgeH * 0.42 + 0.68, dZ + 0.08);
    b.add(roofMat, new THREE.BoxGeometry(2.2, 0.22, 1.9), 0, h + ridgeH * 0.42 + 0.84, dZ + 0.08);
    b.add(km.glassPane, new THREE.BoxGeometry(0.95, 0.85, 0.08), 0, h + ridgeH * 0.42 + 0.05, dZ + 0.82);
  }
  b.add(km.darkSteel, new THREE.CylinderGeometry(0.05, 0.05, 1.05, 6), doorX + 1.25, 0.52, d * 0.5 + porchD + 1.85);
  b.add(km.darkSteel, new THREE.BoxGeometry(0.24, 0.24, 0.48), doorX + 1.25, 1.08, d * 0.5 + porchD + 1.85);
  // Warm front porch coach lantern + walkway stepping pad + rear backyard patio deck & table
  b.add(km.warmGlow, new THREE.BoxGeometry(0.18, 0.28, 0.14), doorX + 0.72, 2.05, d * 0.5 + 0.06);
  b.add(km.stoneBase, new THREE.BoxGeometry(1.4, 0.06, 1.9), doorX, 0.03, d * 0.5 + porchD + 0.95);
  if (w >= 10) {
    b.add(km.fenceWood, new THREE.BoxGeometry(w * 0.44, 0.12, 2.2), 0, 0.08, -d * 0.5 - 1.15);
    b.add(km.darkSteel, new THREE.CylinderGeometry(0.45, 0.45, 0.05, 10), 0, 0.78, -d * 0.5 - 1.2);
    b.add(km.darkSteel, new THREE.CylinderGeometry(0.04, 0.04, 0.72, 6), 0, 0.42, -d * 0.5 - 1.2);
    b.add(km.shutterTeal, new THREE.ConeGeometry(0.98, 0.35, 8), 0, 2.15, -d * 0.5 - 1.2);
  }
  // Front decorative low picket fence wings on non-garage facades (solid + jumpable)
  const cosY = Math.cos(yaw);
  const sinY = Math.sin(yaw);
  const fenceWorld = (lx: number, lz: number) => ({
    wx: x + lx * cosY + lz * sinY,
    wz: z - lx * sinY + lz * cosY,
  });
  if (!hasGarage && w >= 9) {
    b.add(km.trimWhite, new THREE.BoxGeometry(w * 0.28, 0.62, 0.08), -w * 0.34, 0.31, d * 0.5 + 2.1);
    b.add(km.trimWhite, new THREE.BoxGeometry(w * 0.28, 0.62, 0.08), w * 0.34, 0.31, d * 0.5 + 2.1);
  }

  // Backyard wood privacy fence (visual + segmented AABB colliders so fences block walking but can be jumped over)
  const fw = w + 4.4;
  const fz = -d * 0.5 - 2.6;
  fenceBatch.add(km.fenceWood, new THREE.BoxGeometry(fw, 1.22, 0.12), 0, 0.61, fz);
  fenceBatch.add(km.fenceWood, new THREE.BoxGeometry(0.12, 1.22, 4.4), -fw * 0.5, 0.61, fz + 2.2);
  fenceBatch.add(km.fenceWood, new THREE.BoxGeometry(0.12, 1.22, 4.4), fw * 0.5, 0.61, fz + 2.2);

  const registerFenceBox = (lx: number, lz: number, bw: number, bd: number) => {
    const { wx, wz } = fenceWorld(lx, lz);
    const box = new THREE.Box3();
    const hw = (Math.abs(bw * cosY) + Math.abs(bd * sinY)) * 0.5;
    const hd = (Math.abs(bw * sinY) + Math.abs(bd * cosY)) * 0.5;
    box.min.set(wx - hw, yBase, wz - hd);
    box.max.set(wx + hw, yBase + 1.22, wz + hd);
    chunk.aabbs.push(box);
  };
  const segCount = Math.max(2, Math.ceil(fw / 3.5));
  const segW = fw / segCount;
  for (let i = 0; i < segCount; i++) {
    registerFenceBox(-fw * 0.5 + segW * (i + 0.5), fz, segW, 0.22);
  }
  registerFenceBox(-fw * 0.5, fz + 2.2, 0.22, 4.4);
  registerFenceBox(fw * 0.5, fz + 2.2, 0.22, 4.4);

  const fenceGrp = new THREE.Group();
  fenceGrp.position.set(x, yBase, z);
  fenceGrp.rotation.y = yaw;
  chunk.nearGroup.add(fenceGrp);
  fenceBatch.flush(fenceGrp, true, true);

  b.flush(grp, true, true);

  if (useGlb) {
    const spec = glbFile
      ? { file: glbFile, yawOffset: 0 }
      : pickHouseModelForLot(seed + Math.round(Math.abs(x * 3 + z * 7)), district);
    attachGlbToGroup(chunk.nearGroup, spec.file, x, yBase, z, {
      fitFootprint: { maxW: w + 0.8, maxD: d + 0.8, maxH: h + 4.5 },
      yaw,
      yawOffset: spec.yawOffset ?? 0,
      onAttached: () => {
        grp.visible = false;
        wallBox.visible = false;
        wallBox.castShadow = false;
      },
    });
  }
}

/**
 * Adds architectural rooftop equipment merged per material on midrise/highrise buildings.
 */
export function addRooftopDetails(
  parent: THREE.Object3D,
  x: number,
  yTop: number,
  z: number,
  w: number,
  d: number,
  yaw: number,
  opts: { tall?: boolean; waterTower?: boolean; billboard?: boolean; seed?: number } = {},
): void {
  const km = getKitMaterials();
  const grp = new THREE.Group();
  grp.position.set(x, yTop, z);
  grp.rotation.y = yaw;
  parent.add(grp);

  const b = new GeoBatcher();

  const pt = 0.35;
  const ph = 0.68;
  b.add(km.stoneBase, new THREE.BoxGeometry(w + 0.3, ph, pt), 0, ph * 0.5, d * 0.5);
  b.add(km.stoneBase, new THREE.BoxGeometry(w + 0.3, ph, pt), 0, ph * 0.5, -d * 0.5);
  b.add(km.stoneBase, new THREE.BoxGeometry(pt, ph, d + 0.3), -w * 0.5, ph * 0.5, 0);
  b.add(km.stoneBase, new THREE.BoxGeometry(pt, ph, d + 0.3), w * 0.5, ph * 0.5, 0);
  // Metal rooftop safety rail above parapet
  b.add(km.darkSteel, new THREE.BoxGeometry(w + 0.15, 0.06, 0.06), 0, ph + 0.36, d * 0.5);
  b.add(km.darkSteel, new THREE.BoxGeometry(w + 0.15, 0.06, 0.06), 0, ph + 0.36, -d * 0.5);
  b.add(km.darkSteel, new THREE.BoxGeometry(0.06, 0.06, d + 0.15), -w * 0.5, ph + 0.36, 0);
  b.add(km.darkSteel, new THREE.BoxGeometry(0.06, 0.06, d + 0.15), w * 0.5, ph + 0.36, 0);

  const pw = Math.min(6.2, w * 0.36);
  const pd = Math.min(5.2, d * 0.32);
  const ph2 = opts.tall ? 3.2 : 2.1;
  b.add(km.hvacMetal, new THREE.BoxGeometry(pw, ph2, pd), -w * 0.14, ph2 * 0.5, -d * 0.12);
  b.add(km.darkSteel, new THREE.BoxGeometry(pw + 0.3, 0.22, pd + 0.3), -w * 0.14, ph2 + 0.1, -d * 0.12);
  // Rooftop stair bulkhead & steel access door
  b.add(km.stoneBase, new THREE.BoxGeometry(2.1, 2.35, 2.2), -w * 0.14 + pw * 0.5 + 1.15, 1.175, -d * 0.12);
  b.add(km.darkSteel, new THREE.BoxGeometry(0.1, 1.95, 0.95), -w * 0.14 + pw * 0.5 + 2.21, 0.98, -d * 0.12);
  // Glass rooftop skylight strip on broad roofs
  if (w >= 12 && d >= 12) {
    b.add(km.darkSteel, new THREE.BoxGeometry(3.4, 0.28, 2.2), 0, 0.14, d * 0.18);
    b.add(km.glassPane, new THREE.BoxGeometry(3.1, 0.36, 1.9), 0, 0.22, d * 0.18);
  }

  for (const [hx, hz] of [
    [w * 0.22, d * 0.16],
    [w * 0.22, -d * 0.14],
  ]) {
    if (w < 8 || d < 8) continue;
    b.add(km.hvacMetal, new THREE.BoxGeometry(2.1, 1.05, 1.45), hx, 0.525, hz);
    b.add(km.darkSteel, new THREE.CylinderGeometry(0.45, 0.45, 0.22, 10), hx - 0.4, 1.14, hz);
    b.add(km.darkSteel, new THREE.CylinderGeometry(0.45, 0.45, 0.22, 10), hx + 0.4, 1.14, hz);
  }

  if (opts.waterTower && w >= 9) {
    const wx = -w * 0.26;
    const wz = d * 0.2;
    for (const lx of [-0.65, 0.65]) {
      for (const lz of [-0.65, 0.65]) {
        b.add(km.darkSteel, new THREE.BoxGeometry(0.14, 1.9, 0.14), wx + lx, 0.95, wz + lz);
      }
    }
    b.add(km.fenceWood, new THREE.CylinderGeometry(0.95, 0.95, 2.2, 12), wx, 2.9, wz);
    b.add(km.darkSteel, new THREE.ConeGeometry(1.12, 0.85, 12), wx, 4.4, wz);
  }

  if (opts.tall) {
    b.add(km.darkSteel, new THREE.CylinderGeometry(0.08, 0.24, 9.5, 8), -w * 0.14, ph2 + 4.8, -d * 0.12);
    b.add(km.beaconRed, new THREE.SphereGeometry(0.3, 8, 6), -w * 0.14, ph2 + 9.65, -d * 0.12);
    attachGlbToGroup(grp, "antenna.glb", w * 0.22, ph2, -d * 0.22, { axis: "y", targetMeters: 3.6 });
  } else if (w >= 11 && d >= 10) {
    // Tilted rooftop solar panel array + parabolic communications dish
    for (const sx of [-w * 0.22, 0, w * 0.22]) {
      b.add(km.glassPane, new THREE.BoxGeometry(2.2, 0.08, 1.4), sx, 0.52, -d * 0.22, 0.36, 0, 0);
      b.add(km.darkSteel, new THREE.BoxGeometry(0.12, 0.45, 0.12), sx, 0.24, -d * 0.22);
    }
    b.add(km.hvacMetal, new THREE.ConeGeometry(0.65, 0.42, 12, 1, true), w * 0.28, 1.1, d * 0.24, -0.8, 0, 0);
    b.add(km.darkSteel, new THREE.CylinderGeometry(0.06, 0.08, 0.9, 8), w * 0.28, 0.45, d * 0.24);
    attachGlbToGroup(grp, "rooftop_ac.glb", -w * 0.26, 0, d * 0.22, { axis: "y", targetMeters: 1.45, yaw: 0.2 });
  }

  if (opts.billboard && w >= 12) {
    const bw = Math.min(8.5, w * 0.62);
    const bz = d * 0.34;
    for (const bx of [-bw * 0.34, bw * 0.34]) {
      b.add(km.darkSteel, new THREE.BoxGeometry(0.18, 2.8, 0.18), bx, 1.4, bz);
    }
    b.add(km.darkSteel, new THREE.BoxGeometry(bw + 0.3, 3.1, 0.22), 0, 3.35, bz);
    b.add(km.warmGlow, new THREE.BoxGeometry(bw - 0.1, 2.7, 0.26), 0, 3.35, bz);
  }

  b.flush(grp, true, true);
}

/**
 * Adds ground-floor commercial storefront mullions, bracketed awning, and sidewalk bench/planter merged per material.
 */
export function addStorefrontBay(
  parent: THREE.Object3D,
  x: number,
  yBase: number,
  z: number,
  w: number,
  d: number,
  yaw: number,
  awningMat: THREE.Material,
): void {
  const km = getKitMaterials();
  const grp = new THREE.Group();
  grp.position.set(x, yBase, z);
  grp.rotation.y = yaw;
  parent.add(grp);

  const b = new GeoBatcher();

  b.add(km.darkSteel, new THREE.BoxGeometry(w + 0.36, 0.34, 0.42), 0, 3.25, d * 0.5 + 0.08);
  // Granite shopfront kickplate plinth & recessed double glass entry doors with brass push bars
  b.add(km.stoneBase, new THREE.BoxGeometry(w + 0.22, 0.44, 0.18), 0, 0.22, d * 0.5 + 0.06);
  b.add(km.darkSteel, new THREE.BoxGeometry(2.15, 2.45, 0.16), 0, 1.24, d * 0.5 + 0.12);
  b.add(km.glassPane, new THREE.BoxGeometry(1.9, 2.25, 0.18), 0, 1.24, d * 0.5 + 0.13);
  b.add(km.brass, new THREE.BoxGeometry(0.68, 0.06, 0.24), -0.45, 1.05, d * 0.5 + 0.16);
  b.add(km.brass, new THREE.BoxGeometry(0.68, 0.06, 0.24), 0.45, 1.05, d * 0.5 + 0.16);
  const bayCount = Math.max(2, Math.floor(w / 3.4));
  for (let i = 0; i <= bayCount; i++) {
    const mx = -w * 0.46 + (i / bayCount) * (w * 0.92);
    b.add(km.darkSteel, new THREE.BoxGeometry(0.16, 3.15, 0.26), mx, 1.58, d * 0.5 + 0.12);
  }

  b.add(awningMat, new THREE.BoxGeometry(w * 0.78, 0.22, 1.55), 0, 3.05, d * 0.5 + 0.82, 0.28, 0, 0);
  for (const tx of [-w * 0.34, w * 0.34]) {
    b.add(km.darkSteel, new THREE.CylinderGeometry(0.03, 0.03, 1.35, 6), tx, 3.55, d * 0.5 + 0.65, 0.85, 0, 0);
  }

  if (w >= 9) {
    // Dual flanking sidewalk stone planters with clipped shrubs
    for (const px of [-w * 0.38, -1.65]) {
      b.add(km.stoneBase, new THREE.BoxGeometry(0.75, 0.48, 0.75), px, 0.24, d * 0.5 + 0.85);
      b.add(km.shrubMat, new THREE.IcosahedronGeometry(0.4, 1), px, 0.68, d * 0.5 + 0.85);
    }

    b.add(km.fenceWood, new THREE.BoxGeometry(1.75, 0.08, 0.52), w * 0.28, 0.44, d * 0.5 + 0.95);
    b.add(km.fenceWood, new THREE.BoxGeometry(1.75, 0.38, 0.08), w * 0.28, 0.66, d * 0.5 + 0.72);
    b.add(km.darkSteel, new THREE.BoxGeometry(0.1, 0.44, 0.46), w * 0.28 - 0.72, 0.22, d * 0.5 + 0.95);
    b.add(km.darkSteel, new THREE.BoxGeometry(0.1, 0.44, 0.46), w * 0.28 + 0.72, 0.22, d * 0.5 + 0.95);
    // Sidewalk bistro café table + chairs on wider urban storefronts
    if (w >= 13.5) {
      const cx = w * 0.14;
      const cz = d * 0.5 + 1.85;
      b.add(km.darkSteel, new THREE.CylinderGeometry(0.42, 0.42, 0.05, 10), cx, 0.74, cz);
      b.add(km.darkSteel, new THREE.CylinderGeometry(0.04, 0.04, 0.74, 8), cx, 0.37, cz);
      b.add(km.darkSteel, new THREE.CylinderGeometry(0.03, 0.03, 2.2, 6), cx, 1.35, cz);
      b.add(awningMat, new THREE.ConeGeometry(1.05, 0.38, 8), cx, 2.45, cz);
      for (const side of [-0.62, 0.62]) {
        b.add(km.fenceWood, new THREE.BoxGeometry(0.36, 0.06, 0.36), cx + side, 0.44, cz);
        b.add(km.darkSteel, new THREE.BoxGeometry(0.06, 0.44, 0.34), cx + side, 0.22, cz);
      }
    }
    // Illuminated shopfront header & hanging sidewalk blade sign
    b.add(km.warmGlow, new THREE.BoxGeometry(w * 0.84, 0.32, 0.06), 0, 2.85, d * 0.5 + 0.05);
    b.add(km.darkSteel, new THREE.BoxGeometry(0.08, 0.08, 1.05), -w * 0.42, 3.55, d * 0.5 + 0.52);
    b.add(km.warmGlow, new THREE.BoxGeometry(0.12, 0.68, 0.82), -w * 0.42, 3.25, d * 0.5 + 0.74);
  }

  b.flush(grp, true, true);
}

/**
 * Adds exterior 3D facade relief (structural corner/mid pilasters, horizontal spandrel cornice ledges,
 * and optional projecting residential/hotel balconies with steel railings) merged per material.
 */
export function addFacadeRelief(
  parent: THREE.Object3D,
  x: number,
  yBase: number,
  z: number,
  w: number,
  h: number,
  d: number,
  yaw: number,
  opts: { balconies?: boolean; pilasterMat?: THREE.Material } = {},
): void {
  if (h < 8) return;
  const km = getKitMaterials();
  const pilMat = opts.pilasterMat ?? km.darkSteel;
  const grp = new THREE.Group();
  grp.position.set(x, yBase, z);
  grp.rotation.y = yaw;
  parent.add(grp);

  const b = new GeoBatcher();

  // Corner & intermediate vertical structural pilasters across all 4 elevations
  const colsW = w >= 18 ? 4 : w >= 12 ? 3 : 2;
  for (let i = 0; i <= colsW; i++) {
    const px = -w * 0.5 + (i / colsW) * w;
    for (const pz of [-d * 0.5 - 0.08, d * 0.5 + 0.08]) {
      b.add(pilMat, new THREE.BoxGeometry(0.32, h, 0.22), px, h * 0.5, pz);
    }
  }
  const colsD = d >= 18 ? 3 : d >= 12 ? 2 : 1;
  for (let i = 0; i <= colsD; i++) {
    const pz = -d * 0.5 + (i / colsD) * d;
    for (const px of [-w * 0.5 - 0.08, w * 0.5 + 0.08]) {
      b.add(pilMat, new THREE.BoxGeometry(0.22, h, 0.32), px, h * 0.5, pz);
    }
  }

  // Horizontal cornice belt ledges (capped to <= 5 architectural belts)
  const bandStep = Math.max(7.2, h / 5);
  for (let by = bandStep; by < h - 1.5; by += bandStep) {
    b.add(km.stoneBase, new THREE.BoxGeometry(w + 0.45, 0.36, d + 0.45), 0, by, 0);
  }

  // Projecting balconies with steel & glass railings + exterior fire-escape landings on mid-rises
  if (opts.balconies && w >= 9 && h >= 10 && h <= 30) {
    const floorStep = Math.max(5.2, h / 4);
    const bxOffsets = w >= 14 ? [-w * 0.25, w * 0.25] : [0];
    for (let fy = 4.6; fy < h - 2.2; fy += floorStep) {
      for (const bx of bxOffsets) {
        const bw = Math.min(3.4, w * 0.32);
        const bd = 1.15;
        const bz = d * 0.5 + bd * 0.5;
        b.add(km.concreteWalk, new THREE.BoxGeometry(bw, 0.16, bd), bx, fy, bz);
        b.add(km.darkSteel, new THREE.BoxGeometry(bw, 0.07, 0.08), bx, fy + 0.92, d * 0.5 + bd - 0.04);
        b.add(km.glassPane, new THREE.BoxGeometry(bw - 0.1, 0.78, 0.05), bx, fy + 0.48, d * 0.5 + bd - 0.04);
        // Balcony French sliding door + exterior AC condenser unit + flower box
        b.add(km.darkSteel, new THREE.BoxGeometry(1.45, 2.05, 0.08), bx, fy + 1.02, d * 0.5 + 0.04);
        b.add(km.glassPane, new THREE.BoxGeometry(1.25, 1.88, 0.1), bx, fy + 1.02, d * 0.5 + 0.05);
        b.add(km.hvacMetal, new THREE.BoxGeometry(0.55, 0.45, 0.35), bx + bw * 0.32, fy + 0.3, d * 0.5 + 0.24);
        b.add(km.shrubMat, new THREE.BoxGeometry(0.95, 0.24, 0.24), bx - bw * 0.22, fy + 1.02, d * 0.5 + bd - 0.06);
      }
      // Side wrought-iron fire escape landing + diagonal ladder stringer
      if (d >= 10) {
        b.add(km.darkSteel, new THREE.BoxGeometry(1.1, 0.12, 2.6), w * 0.5 + 0.55, fy, 0);
        b.add(km.darkSteel, new THREE.BoxGeometry(0.06, 0.85, 2.6), w * 0.5 + 1.08, fy + 0.45, 0);
        b.add(km.darkSteel, new THREE.BoxGeometry(0.12, 3.6, 0.12), w * 0.5 + 0.82, fy + 1.8, 0, 0.52, 0, 0);
      }
    }
  }

  b.flush(grp, false, true);
}

/**
 * Adds a detailed glass-and-steel transit bus shelter with bench, route totem & glowing map board.
 */
export function addBusShelter(
  parent: THREE.Object3D,
  x: number,
  yBase: number,
  z: number,
  yaw: number,
): void {
  const km = getKitMaterials();
  const grp = new THREE.Group();
  grp.position.set(x, yBase, z);
  grp.rotation.y = yaw;
  parent.add(grp);

  const b = new GeoBatcher();
  // Base concrete pad
  b.add(km.concreteWalk, new THREE.BoxGeometry(4.4, 0.12, 1.9), 0, 0.06, 0);
  // 4 steel uprights
  for (const px of [-1.85, 0, 1.85]) {
    b.add(km.darkSteel, new THREE.CylinderGeometry(0.055, 0.065, 2.55, 8), px, 1.32, -0.72);
  }
  // Curved/sloped roof frame + glass skylight
  b.add(km.darkSteel, new THREE.BoxGeometry(4.2, 0.1, 1.65), 0, 2.58, 0.05, 0.08, 0, 0);
  b.add(km.glassPane, new THREE.BoxGeometry(3.9, 0.04, 1.4), 0, 2.62, 0.05, 0.08, 0, 0);
  // Rear windscreen + route map illuminated panel
  b.add(km.glassPane, new THREE.BoxGeometry(3.6, 1.95, 0.05), 0, 1.45, -0.72);
  b.add(km.darkSteel, new THREE.BoxGeometry(0.95, 1.85, 0.16), 1.92, 1.28, -0.35);
  b.add(km.warmGlow, new THREE.BoxGeometry(0.76, 1.35, 0.18), 1.92, 1.35, -0.35);
  // Wooden transit bench inside
  b.add(km.fenceWood, new THREE.BoxGeometry(2.3, 0.08, 0.48), -0.45, 0.5, -0.25);
  b.add(km.darkSteel, new THREE.BoxGeometry(0.08, 0.48, 0.42), -1.4, 0.25, -0.25);
  b.add(km.darkSteel, new THREE.BoxGeometry(0.08, 0.48, 0.42), 0.5, 0.25, -0.25);
  // Bus stop totem sign
  b.add(km.darkSteel, new THREE.CylinderGeometry(0.04, 0.04, 2.9, 8), -2.3, 1.45, 0.45);
  b.add(km.shutterTeal, new THREE.BoxGeometry(0.45, 0.58, 0.07), -2.3, 2.75, 0.45);

  b.flush(grp, true, true);
}

/**
 * Adds a compact sidewalk furniture cluster (trash + recycling bin pair & corner mailbox/newsstand).
 */
export function addSidewalkMicroCluster(
  parent: THREE.Object3D,
  x: number,
  yBase: number,
  z: number,
  yaw: number,
): void {
  const km = getKitMaterials();
  const grp = new THREE.Group();
  grp.position.set(x, yBase, z);
  grp.rotation.y = yaw;
  parent.add(grp);

  const b = new GeoBatcher();
  // Trash bin + Recycling bin
  b.add(km.darkSteel, new THREE.CylinderGeometry(0.24, 0.22, 0.88, 10), -0.35, 0.44, 0);
  b.add(km.hvacMetal, new THREE.CylinderGeometry(0.26, 0.26, 0.1, 10), -0.35, 0.92, 0);
  b.add(km.shutterTeal, new THREE.CylinderGeometry(0.24, 0.22, 0.88, 10), 0.25, 0.44, 0);
  b.add(km.hvacMetal, new THREE.CylinderGeometry(0.26, 0.26, 0.1, 10), 0.25, 0.92, 0);
  // Corner newspaper/mail box + dual newsstand boxes + wooden street bench + safety bollard
  b.add(km.brickChimney, new THREE.BoxGeometry(0.48, 1.05, 0.44), 0.92, 0.525, 0);
  b.add(km.trimWhite, new THREE.BoxGeometry(0.36, 0.34, 0.05), 0.92, 0.72, 0.23);
  b.add(km.shutterTeal, new THREE.BoxGeometry(0.46, 0.95, 0.42), 1.52, 0.475, 0);
  b.add(km.trimWhite, new THREE.BoxGeometry(0.32, 0.3, 0.05), 1.52, 0.68, 0.22);
  b.add(km.fenceWood, new THREE.BoxGeometry(1.65, 0.08, 0.46), -1.65, 0.45, 0);
  b.add(km.fenceWood, new THREE.BoxGeometry(1.65, 0.36, 0.08), -1.65, 0.68, -0.2);
  b.add(km.darkSteel, new THREE.BoxGeometry(0.08, 0.44, 0.42), -2.3, 0.22, 0);
  b.add(km.darkSteel, new THREE.BoxGeometry(0.08, 0.44, 0.42), -1.0, 0.22, 0);
  b.add(km.darkSteel, new THREE.CylinderGeometry(0.09, 0.11, 0.82, 8), -2.85, 0.41, 0.15);

  b.flush(grp, true, true);
}

/**
 * Adds a sidewalk municipal utility & mobility cluster (power transformer box, digital parking kiosk,
 * U-shaped bike rack, and protective steel bollards).
 */
export function addSidewalkUtilityCluster(
  parent: THREE.Object3D,
  x: number,
  yBase: number,
  z: number,
  yaw: number,
): void {
  const km = getKitMaterials();
  const grp = new THREE.Group();
  grp.position.set(x, yBase, z);
  grp.rotation.y = yaw;
  parent.add(grp);

  const b = new GeoBatcher();
  // Concrete pad + municipal electrical utility cabinet
  b.add(km.concreteWalk, new THREE.BoxGeometry(1.55, 0.08, 1.05), -0.8, 0.04, 0);
  b.add(km.shutterTeal, new THREE.BoxGeometry(1.15, 1.25, 0.72), -0.8, 0.68, 0);
  b.add(km.hvacMetal, new THREE.BoxGeometry(1.2, 0.08, 0.78), -0.8, 1.32, 0);
  // Digital pay-to-park kiosk with illuminated screen
  b.add(km.darkSteel, new THREE.BoxGeometry(0.42, 1.55, 0.34), 0.45, 0.775, 0);
  b.add(km.warmGlow, new THREE.BoxGeometry(0.28, 0.24, 0.05), 0.45, 1.18, 0.18);
  // Twin U-shaped steel bike racks + parked commuter bicycle silhouette + bollard
  for (const bx of [1.25, 1.85]) {
    b.add(km.hvacMetal, new THREE.BoxGeometry(0.06, 0.76, 0.56), bx, 0.38, 0);
  }
  b.add(km.darkSteel, new THREE.TorusGeometry(0.26, 0.035, 6, 12), 1.55, 0.28, -0.32, 0, Math.PI * 0.5, 0);
  b.add(km.darkSteel, new THREE.TorusGeometry(0.26, 0.035, 6, 12), 1.55, 0.28, 0.32, 0, Math.PI * 0.5, 0);
  b.add(km.shutterTeal, new THREE.BoxGeometry(0.06, 0.08, 0.68), 1.55, 0.56, 0);
  b.add(km.darkSteel, new THREE.CylinderGeometry(0.08, 0.1, 0.8, 8), -1.85, 0.4, 0.2);

  b.flush(grp, true, true);
}

/**
 * Adds a paved urban concrete/granite block plaza apron + corner planter curbs around Downtown/Midtown buildings
 * so skyscrapers and midrises sit on authentic paved city blocks rather than bare grass.
 */
export function addPavedPlazaApron(
  parent: THREE.Object3D,
  x: number,
  yBase: number,
  z: number,
  w: number,
  d: number,
  yaw: number,
): void {
  const km = getKitMaterials();
  const grp = new THREE.Group();
  grp.position.set(x, yBase, z);
  grp.rotation.y = yaw;
  parent.add(grp);

  const b = new GeoBatcher();
  const pw = w + 10.5;
  const pd = d + 10.5;
  // Main paved concrete plaza slab + slightly darker stone border curb
  b.add(km.concreteWalk, new THREE.BoxGeometry(pw, 0.26, pd), 0, 0.02, 0);
  b.add(km.stoneBase, new THREE.BoxGeometry(pw + 0.4, 0.14, 0.32), 0, 0.14, pd * 0.5);
  b.add(km.stoneBase, new THREE.BoxGeometry(pw + 0.4, 0.14, 0.32), 0, 0.14, -pd * 0.5);
  b.add(km.stoneBase, new THREE.BoxGeometry(0.32, 0.14, pd), pw * 0.5, 0.14, 0);
  b.add(km.stoneBase, new THREE.BoxGeometry(0.32, 0.14, pd), -pw * 0.5, 0.14, 0);

  // Corner stone planters with sculpted greenery & warm plaza bollard lamps along street-facing corners
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const px = sx * (w * 0.48 + 1.9);
      const pz = sz * (d * 0.48 + 2.3);
      b.add(km.stoneBase, new THREE.BoxGeometry(1.35, 0.48, 1.35), px, 0.28, pz);
      b.add(km.shrubMat, new THREE.IcosahedronGeometry(0.54, 1), px, 0.72, pz);
    }
    const bx = sx * (w * 0.26);
    const bz = d * 0.5 + 3.2;
    b.add(km.darkSteel, new THREE.CylinderGeometry(0.1, 0.12, 0.85, 8), bx, 0.52, bz);
    b.add(km.warmGlow, new THREE.CylinderGeometry(0.09, 0.09, 0.14, 8), bx, 0.98, bz);
  }

  b.flush(grp, false, true);
}

const containerMatCache = new Map<number, THREE.MeshStandardMaterial>();

/**
 * Generates a corrugated steel shipping container material with vertical ribs, corner castings, and stencil markings.
 */
export function createCorrugatedContainerMaterial(colorHex: number): THREE.MeshStandardMaterial {
  const cached = containerMatCache.get(colorHex);
  if (cached) return cached;

  const w = 256;
  const h = 128;
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d")!;

  const bc = document.createElement("canvas");
  bc.width = w;
  bc.height = h;
  const bctx = bc.getContext("2d")!;

  const col = new THREE.Color(colorHex);
  const r = Math.round(col.r * 255);
  const g = Math.round(col.g * 255);
  const b = Math.round(col.b * 255);

  ctx.fillStyle = `rgb(${r},${g},${b})`;
  ctx.fillRect(0, 0, w, h);
  bctx.fillStyle = "rgb(128,128,128)";
  bctx.fillRect(0, 0, w, h);

  // Vertical corrugated steel ribs
  for (let x = 10; x < w - 10; x += 8) {
    ctx.fillStyle = "rgba(0,0,0,0.22)";
    ctx.fillRect(x, 8, 3, h - 16);
    ctx.fillStyle = "rgba(255,255,255,0.14)";
    ctx.fillRect(x + 3, 8, 2, h - 16);

    bctx.fillStyle = "rgb(45,45,45)";
    bctx.fillRect(x, 6, 4, h - 12);
    bctx.fillStyle = "rgb(215,215,215)";
    bctx.fillRect(x + 4, 6, 4, h - 12);
  }

  // Top & bottom steel frame rails + corner castings
  ctx.fillStyle = "rgba(0,0,0,0.34)";
  ctx.fillRect(0, 0, w, 7);
  ctx.fillRect(0, h - 7, w, 7);
  ctx.fillRect(0, 0, 7, h);
  ctx.fillRect(w - 7, 0, 7, h);

  // Crisp white cargo stencil number plate
  ctx.fillStyle = "rgba(245,248,252,0.82)";
  ctx.fillRect(22, 22, 46, 12);
  ctx.fillRect(22, 38, 28, 6);

  const map = new THREE.CanvasTexture(c);
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  map.colorSpace = THREE.SRGBColorSpace;
  const bumpMap = new THREE.CanvasTexture(bc);
  bumpMap.wrapS = bumpMap.wrapT = THREE.RepeatWrapping;

  const mat = new THREE.MeshStandardMaterial({
    map,
    bumpMap,
    bumpScale: 0.08,
    roughness: 0.56,
    metalness: 0.36,
  });
  containerMatCache.set(colorHex, mat);
  return mat;
}
