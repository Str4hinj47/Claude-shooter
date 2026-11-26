import * as THREE from "three";
import { SpatialAABBGrid, SpatialColliderGrid } from "./SpatialIndex";
import { westgateEngine } from "../../engine/WestgateCore";

export type ChunkState = "unloaded" | "lod" | "near";

export interface CityChunk {
  readonly cx: number;
  readonly cz: number;
  readonly key: string;
  readonly minX: number;
  readonly maxX: number;
  readonly minZ: number;
  readonly maxZ: number;
  readonly centerX: number;
  readonly centerZ: number;
  readonly nearGroup: THREE.Group;
  readonly lodGroup: THREE.Group;
  readonly colliders: THREE.Object3D[];
  readonly aabbs: THREE.Box3[];
  shadowCasters?: THREE.Mesh[];
  shadowsActive?: boolean;
  aabbIds: number[];
  collidersRegistered: boolean;
  built: boolean;
  state: ChunkState;
}

export type ChunkBuildFn = (chunk: CityChunk) => void;

export interface ChunkStreamerOptions {
  worldMin?: number;
  worldMax?: number;
  chunkSize?: number;
  nearRadius?: number;
  lodRadius?: number;
  hysteresis?: number;
  maxBuildsPerFrame?: number;
  spatialAABBs?: SpatialAABBGrid;
  spatialColliders?: SpatialColliderGrid;
}

export interface ChunkStats {
  total: number;
  built: number;
  near: number;
  lod: number;
  culled: number;
}

function freezeChunkMatricesAndCacheShadows(chunk: CityChunk): void {
  const casters: THREE.Mesh[] = [];
  chunk.nearGroup.traverse((o) => {
    o.updateMatrix();
    o.matrixAutoUpdate = false;
    const m = o as THREE.Mesh;
    if (m.isMesh && m.castShadow) casters.push(m);
  });
  chunk.lodGroup.traverse((o) => {
    o.updateMatrix();
    o.matrixAutoUpdate = false;
  });
  chunk.shadowCasters = casters;
  chunk.shadowsActive = true;
}

function setChunkShadows(chunk: CityChunk, active: boolean): void {
  if (chunk.shadowsActive === active || !chunk.shadowCasters) return;
  chunk.shadowsActive = active;
  for (let i = 0; i < chunk.shadowCasters.length; i++) {
    chunk.shadowCasters[i].castShadow = active;
  }
}

function disposeGroup(group: THREE.Group): void {
  group.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.geometry) m.geometry.dispose();
    const mats = Array.isArray(m.material) ? m.material : m.material ? [m.material] : [];
    for (const mat of mats) {
      const t = mat as THREE.Material & { map?: THREE.Texture; emissiveMap?: THREE.Texture; bumpMap?: THREE.Texture };
      t.map?.dispose();
      t.emissiveMap?.dispose();
      t.bumpMap?.dispose();
      mat.dispose();
    }
  });
}

/**
 * 160m × 160m open-world chunk streamer with distance-based Near / LOD / Culled
 * state transitions, hysteresis, and budgeted per-frame chunk hydration.
 */
export class ChunkStreamer {
  readonly root = new THREE.Group();
  readonly worldMin: number;
  readonly worldMax: number;
  readonly chunkSize: number;
  readonly gridCount: number;
  readonly nearRadius: number;
  readonly lodRadius: number;
  readonly hysteresis: number;
  readonly maxBuildsPerFrame: number;

  private readonly chunks: CityChunk[] = [];
  private readonly chunkMap = new Map<string, CityChunk>();
  private readonly buildFn: ChunkBuildFn;
  private readonly spatialAABBs?: SpatialAABBGrid;
  private readonly spatialColliders?: SpatialColliderGrid;
  private readonly pendingBuildsTmp: { chunk: CityChunk; d2: number }[] = [];
  private lastFocusX = Infinity;
  private lastFocusZ = Infinity;
  private hasPendingBuilds = false;

  constructor(buildFn: ChunkBuildFn, opts: ChunkStreamerOptions = {}) {
    this.buildFn = buildFn;
    this.worldMin = opts.worldMin ?? -1200;
    this.worldMax = opts.worldMax ?? 1200;
    this.chunkSize = opts.chunkSize ?? 160;
    this.nearRadius = opts.nearRadius ?? 280;
    this.lodRadius = opts.lodRadius ?? 780;
    this.hysteresis = opts.hysteresis ?? 24;
    this.maxBuildsPerFrame = opts.maxBuildsPerFrame ?? 2;
    this.spatialAABBs = opts.spatialAABBs;
    this.spatialColliders = opts.spatialColliders;
    this.root.name = "CityChunkStreamerRoot";

    this.gridCount = Math.ceil((this.worldMax - this.worldMin) / this.chunkSize);

    for (let cx = 0; cx < this.gridCount; cx++) {
      for (let cz = 0; cz < this.gridCount; cz++) {
        const minX = this.worldMin + cx * this.chunkSize;
        const maxX = Math.min(this.worldMax, minX + this.chunkSize);
        const minZ = this.worldMin + cz * this.chunkSize;
        const maxZ = Math.min(this.worldMax, minZ + this.chunkSize);
        const key = `${cx},${cz}`;

        const nearGroup = new THREE.Group();
        nearGroup.name = `chunk_${key}_near`;
        nearGroup.visible = false;

        const lodGroup = new THREE.Group();
        lodGroup.name = `chunk_${key}_lod`;
        lodGroup.visible = false;

        this.root.add(nearGroup, lodGroup);

        const chunk: CityChunk = {
          cx,
          cz,
          key,
          minX,
          maxX,
          minZ,
          maxZ,
          centerX: (minX + maxX) * 0.5,
          centerZ: (minZ + maxZ) * 0.5,
          nearGroup,
          lodGroup,
          colliders: [],
          aabbs: [],
          aabbIds: [],
          collidersRegistered: false,
          built: false,
          state: "unloaded",
        };
        this.chunks.push(chunk);
        this.chunkMap.set(key, chunk);
      }
    }
  }

  getChunkAt(x: number, z: number): CityChunk | null {
    const cx = Math.floor((x - this.worldMin) / this.chunkSize);
    const cz = Math.floor((z - this.worldMin) / this.chunkSize);
    if (cx < 0 || cz < 0 || cx >= this.gridCount || cz >= this.gridCount) return null;
    return this.chunkMap.get(`${cx},${cz}`) ?? null;
  }

  /**
   * Pre-builds chunks within `radius` around `(x, z)`.
   * In browser runtime, only the immediate 140m spawn ring builds synchronously while outer chunks
   * stream smoothly through WestgateEngineCore's frame-budgeted job scheduler.
   */
  prewarm(x: number, z: number, radius = this.lodRadius, staged = false): void {
    const r2 = radius * radius;
    const near2 = this.nearRadius * this.nearRadius;
    const immR2 = staged ? 140 * 140 : r2;
    const deferred: { chunk: CityChunk; d2: number }[] = [];

    for (let i = 0; i < this.chunks.length; i++) {
      const c = this.chunks[i];
      const d2 = this.distSqToChunk(x, z, c);
      if (d2 > r2) continue;
      if (d2 <= immR2) {
        if (!c.built) {
          this.buildFn(c);
          freezeChunkMatricesAndCacheShadows(c);
          c.built = true;
        }
        this.setChunkState(c, d2 <= near2 ? "near" : "lod");
        const shadowR = westgateEngine.getShadowCasterRadius();
        if (c.state === "near") setChunkShadows(c, d2 <= shadowR * shadowR);
      } else if (!c.built) {
        deferred.push({ chunk: c, d2 });
      } else {
        this.setChunkState(c, d2 <= near2 ? "near" : "lod");
        const shadowR = westgateEngine.getShadowCasterRadius();
        if (c.state === "near") setChunkShadows(c, d2 <= shadowR * shadowR);
      }
    }

    if (deferred.length > 0) {
      deferred.sort((a, b) => a.d2 - b.d2);
      for (let i = 0; i < deferred.length; i++) {
        const { chunk, d2 } = deferred[i];
        westgateEngine.jobs.enqueue({
          key: `chunk:${chunk.key}`,
          priority: 1,
          label: `chunk_${chunk.key}`,
          run: () => {
            if (!chunk.built) {
              this.buildFn(chunk);
              freezeChunkMatricesAndCacheShadows(chunk);
              chunk.built = true;
            }
            this.setChunkState(chunk, d2 <= near2 ? "near" : "lod");
            const sr = westgateEngine.getShadowCasterRadius();
            if (chunk.state === "near") setChunkShadows(chunk, d2 <= sr * sr);
          },
        });
      }
    }
  }

  update(focus: THREE.Vector3): void {
    const fx = focus.x;
    const fz = focus.z;
    const dfx = fx - this.lastFocusX;
    const dfz = fz - this.lastFocusZ;
    if (!this.hasPendingBuilds && dfx * dfx + dfz * dfz < 12.25) {
      return;
    }
    this.lastFocusX = fx;
    this.lastFocusZ = fz;

    const nearEnter2 = this.nearRadius * this.nearRadius;
    const nearExit2 = (this.nearRadius + this.hysteresis) * (this.nearRadius + this.hysteresis);
    const lodEnter2 = this.lodRadius * this.lodRadius;
    const lodExit2 = (this.lodRadius + this.hysteresis) * (this.lodRadius + this.hysteresis);

    // Collect unbuilt chunks inside lodRadius sorted closest-first
    const pendingBuilds = this.pendingBuildsTmp;
    pendingBuilds.length = 0;

    for (let i = 0; i < this.chunks.length; i++) {
      const c = this.chunks[i];
      const d2 = this.distSqToChunk(fx, fz, c);

      let nextState: ChunkState = c.state;
      if (c.state === "near") {
        if (d2 > lodExit2) nextState = "unloaded";
        else if (d2 > nearExit2) nextState = "lod";
      } else if (c.state === "lod") {
        if (d2 <= nearEnter2) nextState = "near";
        else if (d2 > lodExit2) nextState = "unloaded";
      } else {
        if (d2 <= nearEnter2) nextState = "near";
        else if (d2 <= lodEnter2) nextState = "lod";
      }

      if (nextState !== "unloaded" && !c.built) {
        pendingBuilds.push({ chunk: c, d2 });
      } else if (c.built) {
        this.setChunkState(c, nextState);
        const shadowR = westgateEngine.getShadowCasterRadius();
        if (c.state === "near") setChunkShadows(c, d2 <= shadowR * shadowR);
      }
    }

    if (pendingBuilds.length > 0) {
      pendingBuilds.sort((a, b) => a.d2 - b.d2);
      const budget = Math.min(this.maxBuildsPerFrame, pendingBuilds.length);
      const shadowR = westgateEngine.getShadowCasterRadius();
      for (let i = 0; i < budget; i++) {
        const { chunk, d2 } = pendingBuilds[i];
        this.buildFn(chunk);
        freezeChunkMatricesAndCacheShadows(chunk);
        chunk.built = true;
        this.setChunkState(chunk, d2 <= nearEnter2 ? "near" : "lod");
        if (chunk.state === "near") setChunkShadows(chunk, d2 <= shadowR * shadowR);
      }
      this.hasPendingBuilds = pendingBuilds.length > budget;
      pendingBuilds.length = 0;
    } else {
      this.hasPendingBuilds = false;
    }
  }

  private distSqToChunk(x: number, z: number, c: CityChunk): number {
    const cx = x < c.minX ? c.minX : x > c.maxX ? c.maxX : x;
    const cz = z < c.minZ ? c.minZ : z > c.maxZ ? c.maxZ : z;
    const dx = x - cx;
    const dz = z - cz;
    return dx * dx + dz * dz;
  }

  private setChunkState(c: CityChunk, next: ChunkState): void {
    if (c.state === next) return;
    c.state = next;

    c.nearGroup.visible = next === "near";
    c.lodGroup.visible = next === "lod";

    if (next === "near" && !c.collidersRegistered) {
      c.collidersRegistered = true;
      if (this.spatialAABBs && c.aabbs.length > 0) {
        c.aabbIds = this.spatialAABBs.insertMany(c.aabbs);
      }
      if (this.spatialColliders && c.colliders.length > 0) {
        for (let i = 0; i < c.colliders.length; i++) {
          this.spatialColliders.insert(c.colliders[i]);
        }
      }
    } else if (next !== "near" && c.collidersRegistered) {
      c.collidersRegistered = false;
      if (this.spatialAABBs && c.aabbIds.length > 0) {
        for (let i = 0; i < c.aabbIds.length; i++) {
          this.spatialAABBs.remove(c.aabbIds[i]);
        }
        c.aabbIds.length = 0;
      }
      if (this.spatialColliders && c.colliders.length > 0) {
        for (let i = 0; i < c.colliders.length; i++) {
          this.spatialColliders.remove(c.colliders[i]);
        }
      }
    }
  }

  getStats(): ChunkStats {
    let built = 0;
    let near = 0;
    let lod = 0;
    let culled = 0;
    for (let i = 0; i < this.chunks.length; i++) {
      const c = this.chunks[i];
      if (c.built) built++;
      if (c.state === "near") near++;
      else if (c.state === "lod") lod++;
      else culled++;
    }
    return { total: this.chunks.length, built, near, lod, culled };
  }

  dispose(): void {
    for (let i = 0; i < this.chunks.length; i++) {
      const c = this.chunks[i];
      this.setChunkState(c, "unloaded");
      disposeGroup(c.nearGroup);
      disposeGroup(c.lodGroup);
    }
  }
}
