import * as THREE from "three";
import type { CityChunk } from "./ChunkStreamer";
import type { RoadNetwork } from "./RoadNetwork";
import type { TerrainHeightFn } from "./HeightSystem";

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
  roughness: number;
  metalness: number;
}

const facadeCache = new Map<FacadeStyle, CachedFacade>();

function makeFacadeTextures(style: FacadeStyle): CachedFacade {
  const existing = facadeCache.get(style);
  if (existing) return existing;

  const size = 256;
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const g = c.getContext("2d")!;

  const ec = document.createElement("canvas");
  ec.width = ec.height = size;
  const eg = ec.getContext("2d")!;
  eg.fillStyle = "#000000";
  eg.fillRect(0, 0, size, size);

  const palettes: Record<
    FacadeStyle,
    { wall: string; glass: string; frame: string; glow: string; cols: number; rows: number; rough: number; metal: number }
  > = {
    glass_teal: { wall: "#293842", glass: "#4e8ca3", frame: "#1b262e", glow: "#b8ecff", cols: 6, rows: 6, rough: 0.24, metal: 0.65 },
    glass_navy: { wall: "#1f2b3a", glass: "#3d658f", frame: "#141c26", glow: "#cbe3ff", cols: 6, rows: 6, rough: 0.22, metal: 0.68 },
    glass_gold: { wall: "#3d3326", glass: "#8f7448", frame: "#241d15", glow: "#ffe5a8", cols: 5, rows: 6, rough: 0.25, metal: 0.72 },
    glass_slate: { wall: "#2e3338", glass: "#627382", frame: "#1c2024", glow: "#d8ebff", cols: 6, rows: 6, rough: 0.26, metal: 0.62 },
    limestone: { wall: "#cfc8b8", glass: "#354959", frame: "#8d8678", glow: "#ffe8b8", cols: 4, rows: 4, rough: 0.85, metal: 0.05 },
    granite_dark: { wall: "#4f5258", glass: "#2d3c4a", frame: "#33363b", glow: "#ffdca0", cols: 4, rows: 4, rough: 0.82, metal: 0.08 },
    brick_red: { wall: "#824034", glass: "#2f414d", frame: "#5e2b22", glow: "#ffcf8a", cols: 4, rows: 4, rough: 0.88, metal: 0.03 },
    brick_tan: { wall: "#9e8162", glass: "#364652", frame: "#6e5840", glow: "#ffd99c", cols: 4, rows: 4, rough: 0.86, metal: 0.03 },
    concrete_mod: { wall: "#969aa0", glass: "#3d5566", frame: "#6a6e75", glow: "#d8f0ff", cols: 5, rows: 4, rough: 0.84, metal: 0.06 },
    stucco_warm: { wall: "#d4c2a3", glass: "#3a4f5e", frame: "#8f7e65", glow: "#ffe0a3", cols: 3, rows: 3, rough: 0.9, metal: 0.02 },
  };

  const p = palettes[style];
  g.fillStyle = p.wall;
  g.fillRect(0, 0, size, size);

  // Subtle vertical / masonry texture grain
  for (let i = 0; i < 400; i++) {
    const x = (i * 73) % size;
    const y = (i * 137) % size;
    g.fillStyle = i % 2 === 0 ? "rgba(255,255,255,0.035)" : "rgba(0,0,0,0.045)";
    g.fillRect(x, y, 4, 2);
  }

  const cw = size / p.cols;
  const ch = size / p.rows;
  for (let r = 0; r < p.rows; r++) {
    // Subtle spandrel floor band
    g.fillStyle = "rgba(0,0,0,0.16)";
    g.fillRect(0, r * ch, size, Math.max(2, ch * 0.14));

    for (let cIdx = 0; cIdx < p.cols; cIdx++) {
      const wx = cIdx * cw + cw * 0.14;
      const wy = r * ch + ch * 0.2;
      const ww = cw * 0.72;
      const wh = ch * 0.64;

      g.fillStyle = p.glass;
      g.fillRect(wx, wy, ww, wh);

      // Subtle diagonal reflection glint
      g.fillStyle = "rgba(255,255,255,0.14)";
      g.fillRect(wx + 2, wy + 2, ww * 0.28, wh - 4);

      g.strokeStyle = p.frame;
      g.lineWidth = 2;
      g.strokeRect(wx, wy, ww, wh);

      // Deterministic lit interior rooms (~35% softly lit)
      const h = ((r * 31 + cIdx * 17 + style.length * 7) % 11);
      if (h < 4) {
        eg.fillStyle = p.glow;
        eg.globalAlpha = 0.22 + (h % 3) * 0.12;
        eg.fillRect(wx + 2, wy + 2, ww - 4, wh - 4);
        eg.globalAlpha = 1;
      }
    }
  }

  const map = new THREE.CanvasTexture(c);
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  map.colorSpace = THREE.SRGBColorSpace;

  const emissiveMap = new THREE.CanvasTexture(ec);
  emissiveMap.wrapS = emissiveMap.wrapT = THREE.RepeatWrapping;
  emissiveMap.colorSpace = THREE.SRGBColorSpace;

  const out: CachedFacade = { map, emissiveMap, roughness: p.rough, metalness: p.metal };
  facadeCache.set(style, out);
  return out;
}

export function createFacadeMaterial(
  style: FacadeStyle,
  repeatX: number,
  repeatY: number,
  tintHex?: number,
): THREE.MeshStandardMaterial {
  const f = makeFacadeTextures(style);
  const map = f.map.clone();
  map.repeat.set(Math.max(1, repeatX), Math.max(1, repeatY));
  map.needsUpdate = true;

  const em = f.emissiveMap.clone();
  em.repeat.set(Math.max(1, repeatX), Math.max(1, repeatY));
  em.needsUpdate = true;

  return new THREE.MeshStandardMaterial({
    map,
    emissiveMap: em,
    emissive: new THREE.Color(0xffffff),
    emissiveIntensity: 0.22,
    color: tintHex ?? 0xffffff,
    roughness: f.roughness,
    metalness: f.metalness,
  });
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
  const mat = new THREE.MeshStandardMaterial({ color: colorHex, roughness: 0.72, metalness: 0.15 });
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
  }
}
