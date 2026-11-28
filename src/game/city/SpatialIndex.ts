import * as THREE from "three";
import { seedSkinnedBounds } from "./PropModels";

const CELL_OFFSET = 32768;
const CELL_STRIDE = 65536;

export function cellKey(cx: number, cz: number): number {
  return (cx + CELL_OFFSET) * CELL_STRIDE + (cz + CELL_OFFSET);
}

/**
 * 2D (XZ) spatial hash grid for axis-aligned bounding boxes (Box3).
 * Zero-allocation query path via monotonic stamp deduplication.
 */
export class SpatialAABBGrid {
  readonly cellSize: number;
  private readonly invCell: number;
  private readonly cells = new Map<number, number[]>();
  private readonly boxes: (THREE.Box3 | null)[] = [];
  private readonly stamps: number[] = [];
  private queryStamp = 1;
  private activeCount = 0;

  constructor(cellSize = 32) {
    this.cellSize = cellSize;
    this.invCell = 1 / cellSize;
  }

  get count(): number {
    return this.activeCount;
  }

  insert(box: THREE.Box3): number {
    const id = this.boxes.length;
    this.boxes.push(box);
    this.stamps.push(0);
    this.activeCount++;

    const minCx = Math.floor(box.min.x * this.invCell);
    const maxCx = Math.floor(box.max.x * this.invCell);
    const minCz = Math.floor(box.min.z * this.invCell);
    const maxCz = Math.floor(box.max.z * this.invCell);

    for (let cx = minCx; cx <= maxCx; cx++) {
      for (let cz = minCz; cz <= maxCz; cz++) {
        const key = cellKey(cx, cz);
        let bucket = this.cells.get(key);
        if (!bucket) {
          bucket = [];
          this.cells.set(key, bucket);
        }
        bucket.push(id);
      }
    }
    return id;
  }

  insertMany(boxes: readonly THREE.Box3[]): number[] {
    const ids: number[] = new Array(boxes.length);
    for (let i = 0; i < boxes.length; i++) {
      ids[i] = this.insert(boxes[i]);
    }
    return ids;
  }

  remove(id: number): void {
    const box = this.boxes[id];
    if (!box) return;
    this.boxes[id] = null;
    this.activeCount = Math.max(0, this.activeCount - 1);

    const minCx = Math.floor(box.min.x * this.invCell);
    const maxCx = Math.floor(box.max.x * this.invCell);
    const minCz = Math.floor(box.min.z * this.invCell);
    const maxCz = Math.floor(box.max.z * this.invCell);

    for (let cx = minCx; cx <= maxCx; cx++) {
      for (let cz = minCz; cz <= maxCz; cz++) {
        const bucket = this.cells.get(cellKey(cx, cz));
        if (!bucket) continue;
        const idx = bucket.indexOf(id);
        if (idx !== -1) {
          bucket[idx] = bucket[bucket.length - 1];
          bucket.pop();
          if (bucket.length === 0) this.cells.delete(cellKey(cx, cz));
        }
      }
    }
  }

  clear(): void {
    this.cells.clear();
    this.boxes.length = 0;
    this.stamps.length = 0;
    this.queryStamp = 1;
    this.activeCount = 0;
  }

  queryRect(minX: number, minZ: number, maxX: number, maxZ: number, out: THREE.Box3[] = []): THREE.Box3[] {
    out.length = 0;
    if (this.activeCount === 0) return out;

    const stamp = ++this.queryStamp;
    if (stamp >= 0x7fffffff) {
      this.stamps.fill(0);
      this.queryStamp = 1;
    }

    const minCx = Math.floor(minX * this.invCell);
    const maxCx = Math.floor(maxX * this.invCell);
    const minCz = Math.floor(minZ * this.invCell);
    const maxCz = Math.floor(maxZ * this.invCell);

    for (let cx = minCx; cx <= maxCx; cx++) {
      for (let cz = minCz; cz <= maxCz; cz++) {
        const bucket = this.cells.get(cellKey(cx, cz));
        if (!bucket) continue;
        for (let i = 0; i < bucket.length; i++) {
          const id = bucket[i];
          if (this.stamps[id] === stamp) continue;
          this.stamps[id] = stamp;
          const b = this.boxes[id];
          if (b) out.push(b);
        }
      }
    }
    return out;
  }

  queryPoint(x: number, z: number, pad = 0.55, out: THREE.Box3[] = []): THREE.Box3[] {
    return this.queryRect(x - pad, z - pad, x + pad, z + pad, out);
  }
}

interface ColliderEntry {
  obj: THREE.Object3D;
  minCx: number;
  maxCx: number;
  minCz: number;
  maxCz: number;
}

/**
 * Spatial broad-phase grid for raycastable Object3D colliders + 2D DDA ray traversal.
 * Keeps per-shot and AI line-of-sight raycasts O(cells_crossed) in huge open worlds.
 */
export class SpatialColliderGrid {
  readonly cellSize: number;
  private readonly invCell: number;
  private readonly cells = new Map<number, number[]>();
  private readonly entries: (ColliderEntry | null)[] = [];
  private readonly stamps: number[] = [];
  private readonly objToId = new Map<THREE.Object3D, number>();
  private readonly globals = new Set<THREE.Object3D>();
  private queryStamp = 1;
  private readonly tmpBox = new THREE.Box3();

  constructor(cellSize = 32) {
    this.cellSize = cellSize;
    this.invCell = 1 / cellSize;
  }

  addGlobal(obj: THREE.Object3D): void {
    this.globals.add(obj);
  }

  removeGlobal(obj: THREE.Object3D): void {
    this.globals.delete(obj);
  }

  insert(obj: THREE.Object3D, bounds?: THREE.Box3): number {
    const existing = this.objToId.get(obj);
    if (existing !== undefined) return existing;

    let box = bounds;
    if (!box) {
      obj.updateWorldMatrix(true, false);
      seedSkinnedBounds(obj);
      this.tmpBox.setFromObject(obj);
      box = this.tmpBox;
    }
    if (!Number.isFinite(box.min.x) || !Number.isFinite(box.max.x)) return -1;

    const minCx = Math.floor(box.min.x * this.invCell);
    const maxCx = Math.floor(box.max.x * this.invCell);
    const minCz = Math.floor(box.min.z * this.invCell);
    const maxCz = Math.floor(box.max.z * this.invCell);

    const id = this.entries.length;
    this.entries.push({ obj, minCx, maxCx, minCz, maxCz });
    this.stamps.push(0);
    this.objToId.set(obj, id);

    for (let cx = minCx; cx <= maxCx; cx++) {
      for (let cz = minCz; cz <= maxCz; cz++) {
        const key = cellKey(cx, cz);
        let bucket = this.cells.get(key);
        if (!bucket) {
          bucket = [];
          this.cells.set(key, bucket);
        }
        bucket.push(id);
      }
    }
    return id;
  }

  remove(obj: THREE.Object3D): void {
    this.globals.delete(obj);
    const id = this.objToId.get(obj);
    if (id === undefined) return;
    this.objToId.delete(obj);

    const entry = this.entries[id];
    if (!entry) return;
    this.entries[id] = null;

    for (let cx = entry.minCx; cx <= entry.maxCx; cx++) {
      for (let cz = entry.minCz; cz <= entry.maxCz; cz++) {
        const bucket = this.cells.get(cellKey(cx, cz));
        if (!bucket) continue;
        const idx = bucket.indexOf(id);
        if (idx !== -1) {
          bucket[idx] = bucket[bucket.length - 1];
          bucket.pop();
          if (bucket.length === 0) this.cells.delete(cellKey(cx, cz));
        }
      }
    }
  }

  clear(): void {
    this.cells.clear();
    this.entries.length = 0;
    this.stamps.length = 0;
    this.objToId.clear();
    this.globals.clear();
    this.queryStamp = 1;
  }

  queryRadius(x: number, z: number, radius: number, out: THREE.Object3D[] = []): THREE.Object3D[] {
    out.length = 0;
    for (const g of this.globals) out.push(g);

    const stamp = this.nextStamp();
    const minCx = Math.floor((x - radius) * this.invCell);
    const maxCx = Math.floor((x + radius) * this.invCell);
    const minCz = Math.floor((z - radius) * this.invCell);
    const maxCz = Math.floor((z + radius) * this.invCell);

    for (let cx = minCx; cx <= maxCx; cx++) {
      for (let cz = minCz; cz <= maxCz; cz++) {
        this.collectCell(cx, cz, stamp, out);
      }
    }
    return out;
  }

  queryRay(
    origin: THREE.Vector3,
    dir: THREE.Vector3,
    maxDist: number,
    out: THREE.Object3D[] = [],
  ): THREE.Object3D[] {
    out.length = 0;
    for (const g of this.globals) out.push(g);

    const stamp = this.nextStamp();
    const ox = origin.x;
    const oz = origin.z;
    const dx = dir.x;
    const dz = dir.z;

    let cx = Math.floor(ox * this.invCell);
    let cz = Math.floor(oz * this.invCell);

    const horizLen = Math.hypot(dx, dz);
    if (horizLen < 1e-6) {
      this.collectCell(cx, cz, stamp, out);
      return out;
    }

    // Parameter along full 3D ray: x(t) = ox + dx * t, z(t) = oz + dz * t
    const stepX = dx > 0 ? 1 : dx < 0 ? -1 : 0;
    const stepZ = dz > 0 ? 1 : dz < 0 ? -1 : 0;

    const tDeltaX = stepX !== 0 ? Math.abs(this.cellSize / dx) : Infinity;
    const tDeltaZ = stepZ !== 0 ? Math.abs(this.cellSize / dz) : Infinity;

    let tMaxX = Infinity;
    if (stepX > 0) tMaxX = ((cx + 1) * this.cellSize - ox) / dx;
    else if (stepX < 0) tMaxX = (cx * this.cellSize - ox) / dx;

    let tMaxZ = Infinity;
    if (stepZ > 0) tMaxZ = ((cz + 1) * this.cellSize - oz) / dz;
    else if (stepZ < 0) tMaxZ = (cz * this.cellSize - oz) / dz;

    const maxSteps = Math.ceil((maxDist * horizLen) * this.invCell) * 2 + 4;
    let t = 0;

    for (let i = 0; i < maxSteps; i++) {
      this.collectCell(cx, cz, stamp, out);
      if (tMaxX < tMaxZ) {
        t = tMaxX;
        if (t > maxDist) break;
        tMaxX += tDeltaX;
        cx += stepX;
      } else {
        t = tMaxZ;
        if (t > maxDist) break;
        tMaxZ += tDeltaZ;
        cz += stepZ;
      }
    }
    return out;
  }

  private nextStamp(): number {
    const stamp = ++this.queryStamp;
    if (stamp >= 0x7fffffff) {
      this.stamps.fill(0);
      this.queryStamp = 1;
      return 1;
    }
    return stamp;
  }

  private collectCell(cx: number, cz: number, stamp: number, out: THREE.Object3D[]): void {
    const bucket = this.cells.get(cellKey(cx, cz));
    if (!bucket) return;
    for (let i = 0; i < bucket.length; i++) {
      const id = bucket[i];
      if (this.stamps[id] === stamp) continue;
      this.stamps[id] = stamp;
      const entry = this.entries[id];
      if (entry) out.push(entry.obj);
    }
  }
}
