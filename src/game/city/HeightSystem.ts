import * as THREE from "three";
import { cellKey, SpatialAABBGrid } from "./SpatialIndex";

export type TerrainHeightFn = (x: number, z: number) => number;

export interface WalkableSurface {
  id: string;
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  minY: number;
  maxY: number;
  /** Returns surface elevation at (x, z), or null if (x, z) lies outside the deck/ramp footprint. */
  heightAt: (x: number, z: number) => number | null;
}

/**
 * Unified terrain + bridge/overpass/ramp + AABB walkable surface resolver.
 * Correctly handles multi-level geometry (underpasses below bridge decks and driving/walking on top).
 */
export class WorldHeightSystem {
  private terrainAt: TerrainHeightFn;
  readonly aabbs: SpatialAABBGrid;
  private readonly invCell = 1 / 32;
  private readonly surfaceCells = new Map<number, number[]>();
  private readonly surfaces: WalkableSurface[] = [];
  private readonly surfaceStamps: number[] = [];
  private surfaceStamp = 1;
  private readonly scratchBoxes: THREE.Box3[] = [];

  constructor(terrainAt: TerrainHeightFn = () => 0, aabbs: SpatialAABBGrid = new SpatialAABBGrid(32)) {
    this.terrainAt = terrainAt;
    this.aabbs = aabbs;
  }

  setTerrainFn(fn: TerrainHeightFn): void {
    this.terrainAt = fn;
  }

  terrainHeightAt(x: number, z: number): number {
    return this.terrainAt(x, z);
  }

  addSurface(surface: WalkableSurface): number {
    const id = this.surfaces.length;
    this.surfaces.push(surface);
    this.surfaceStamps.push(0);

    const minCx = Math.floor(surface.minX * this.invCell);
    const maxCx = Math.floor(surface.maxX * this.invCell);
    const minCz = Math.floor(surface.minZ * this.invCell);
    const maxCz = Math.floor(surface.maxZ * this.invCell);

    for (let cx = minCx; cx <= maxCx; cx++) {
      for (let cz = minCz; cz <= maxCz; cz++) {
        const key = cellKey(cx, cz);
        let bucket = this.surfaceCells.get(key);
        if (!bucket) {
          bucket = [];
          this.surfaceCells.set(key, bucket);
        }
        bucket.push(id);
      }
    }
    return id;
  }

  clearSurfaces(): void {
    this.surfaces.length = 0;
    this.surfaceCells.clear();
    this.surfaceStamps.length = 0;
    this.surfaceStamp = 1;
  }

  /**
   * Highest walkable ground (terrain, bridge deck, ramp, or AABB top) at (x, z)
   * that is at or within step-up range of entity foot elevation `y`.
   */
  groundHeightAt(x: number, z: number, y: number): number {
    let best = this.terrainAt(x, z);

    // 1. Check nearby AABBs (flat platforms, steps, roofs, curbs)
    const boxes = this.aabbs.queryPoint(x, z, 0.55, this.scratchBoxes);
    for (let i = 0; i < boxes.length; i++) {
      const box = boxes[i];
      const top = box.max.y;
      if (top > y + 0.6) continue;
      const pad = top > y + 0.05 && top <= y + 0.58 ? 0.52 : 0.22;
      if (x < box.min.x - pad || x > box.max.x + pad) continue;
      if (z < box.min.z - pad || z > box.max.z + pad) continue;
      if (top > best) best = top;
    }

    // 2. Check nearby sloped/curved walkable surfaces (bridges, overpasses, ramps)
    if (this.surfaces.length > 0) {
      const stamp = ++this.surfaceStamp;
      const minCx = Math.floor((x - 0.5) * this.invCell);
      const maxCx = Math.floor((x + 0.5) * this.invCell);
      const minCz = Math.floor((z - 0.5) * this.invCell);
      const maxCz = Math.floor((z + 0.5) * this.invCell);

      for (let cx = minCx; cx <= maxCx; cx++) {
        for (let cz = minCz; cz <= maxCz; cz++) {
          const bucket = this.surfaceCells.get(cellKey(cx, cz));
          if (!bucket) continue;
          for (let i = 0; i < bucket.length; i++) {
            const sid = bucket[i];
            if (this.surfaceStamps[sid] === stamp) continue;
            this.surfaceStamps[sid] = stamp;

            const s = this.surfaces[sid];
            if (x < s.minX || x > s.maxX || z < s.minZ || z > s.maxZ) continue;
            if (s.minY > y + 0.65) continue;
            const h = s.heightAt(x, z);
            if (h !== null && h <= y + 0.65 && h > best) {
              best = h;
            }
          }
        }
      }
    }

    return best;
  }

  /** Computes an approximate upward surface normal at (x, z, y) for vehicle alignment. */
  surfaceNormalAt(x: number, z: number, y: number, out = new THREE.Vector3()): THREE.Vector3 {
    const eps = 0.6;
    const hx1 = this.groundHeightAt(x + eps, z, y + 0.4);
    const hx0 = this.groundHeightAt(x - eps, z, y + 0.4);
    const hz1 = this.groundHeightAt(x, z + eps, y + 0.4);
    const hz0 = this.groundHeightAt(x, z - eps, y + 0.4);
    return out.set(hx0 - hx1, 2 * eps, hz0 - hz1).normalize();
  }
}
