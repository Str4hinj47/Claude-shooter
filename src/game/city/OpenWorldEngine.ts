import * as THREE from "three";
import { SpatialAABBGrid, SpatialColliderGrid } from "./SpatialIndex";
import { getLauncherProfile } from "../launcherConfig";
import { WorldHeightSystem, type TerrainHeightFn } from "./HeightSystem";
import { ChunkStreamer, type ChunkBuildFn, type ChunkStats, type ChunkStreamerOptions } from "./ChunkStreamer";
import { PropBatcher, type PropBatchStats } from "./PropBatcher";
import {
  RoadNetwork,
  type LaneQueryHit,
  type ParkedBaySlot,
  type TrafficLane,
  type TrafficSpawnPoint,
} from "./RoadNetwork";

/**
 * Clean contract exposed for external driveable & NPC vehicle kits
 * to integrate with Westgate Bay without touching world-building internals.
 */
export interface VehicleKitWorldBridge {
  readonly roads: RoadNetwork;
  readonly heightSystem: WorldHeightSystem;
  readonly spatialAABBs: SpatialAABBGrid;
  readonly spatialColliders: SpatialColliderGrid;
  groundHeightAt: (x: number, z: number, y: number) => number;
  surfaceNormalAt: (x: number, z: number, y: number, out?: THREE.Vector3) => THREE.Vector3;
  nearestLanePoint: (x: number, z: number, maxDist?: number) => LaneQueryHit | null;
  getConnectedLanes: (laneId: string) => TrafficLane[];
  sampleTrafficSpawnPoints: (count: number, minSpacing?: number, rng?: () => number) => TrafficSpawnPoint[];
  getParkedBays: () => readonly ParkedBaySlot[];
}

export interface OpenWorldEngineOptions {
  terrainAt?: TerrainHeightFn;
  chunkBuilder?: ChunkBuildFn;
  chunkOptions?: Omit<ChunkStreamerOptions, "spatialAABBs" | "spatialColliders">;
  propBucketSize?: number;
}

/**
 * Phase 0 Open-World Engine Foundation for Westgate Bay (2.4 km × 2.4 km).
 * Coordinates spatial indexing, unified terrain+bridge heights, chunk streaming,
 * instanced prop batching, and the spline road & traffic lane graph.
 */
export class OpenWorldEngine implements VehicleKitWorldBridge {
  readonly root = new THREE.Group();
  readonly spatialAABBs = new SpatialAABBGrid(32);
  readonly spatialColliders = new SpatialColliderGrid(32);
  readonly heightSystem: WorldHeightSystem;
  readonly roads = new RoadNetwork();
  readonly props: PropBatcher;
  readonly chunks: ChunkStreamer;

  private readonly staticRoadRoot = new THREE.Group();
  private readonly staticPropsRoot = new THREE.Group();
  private readonly rayScratch: THREE.Object3D[] = [];
  private lastShadowCullX = Infinity;
  private lastShadowCullZ = Infinity;

  constructor(opts: OpenWorldEngineOptions = {}) {
    this.root.name = "WestgateBayOpenWorld";
    this.heightSystem = new WorldHeightSystem(opts.terrainAt ?? (() => 0), this.spatialAABBs);
    // Smaller buckets -> tighter culling granularity for instanced props.
    this.props = new PropBatcher(opts.propBucketSize ?? 220);

    const builder: ChunkBuildFn = opts.chunkBuilder ?? (() => {});
    // Streaming radii follow the active launcher profile instead of being
    // pinned at 280/780. On a software rasteriser the hardcoded values kept
    // ~25 chunks of city geometry resident, which is unusable; SAFE asks for
    // 180/460 and that is what it should get.
    const gfxProfile = getLauncherProfile();
    this.chunks = new ChunkStreamer(builder, {
      worldMin: -1200,
      worldMax: 1200,
      chunkSize: 160,
      nearRadius: gfxProfile.nearRadius,
      lodRadius: gfxProfile.lodRadius,
      hysteresis: 24,
      maxBuildsPerFrame: 2,
      ...opts.chunkOptions,
      spatialAABBs: this.spatialAABBs,
      spatialColliders: this.spatialColliders,
    });

    this.root.add(this.staticRoadRoot, this.staticPropsRoot, this.chunks.root);
  }

  setTerrainFn(fn: TerrainHeightFn): void {
    this.heightSystem.setTerrainFn(fn);
  }

  /**
   * Finalizes compiled roads, registers bridge decks into WorldHeightSystem,
   * builds road & bridge ribbons, flushes PropBatcher, and prewarms initial chunks.
   */
  finalizeStaticWorld(spawnX = 0, spawnZ = 0): void {
    this.roads.compile();

    // Register bridge & overpass decks into unified height system
    this.heightSystem.clearSurfaces();
    for (const deck of this.roads.getBridgeDecks()) {
      this.heightSystem.addSurface(deck);
    }

    // Build road & bridge meshes and index them into the spatial raycast grid
    const roadColliders: THREE.Object3D[] = [];
    this.roads.buildMeshes(this.staticRoadRoot, (x, z) => this.heightSystem.terrainHeightAt(x, z), roadColliders);
    for (const c of roadColliders) {
      this.spatialColliders.insert(c);
    }

    // Build instanced prop batches & register pole/tree AABBs
    this.props.build(this.staticPropsRoot, this.spatialAABBs);

    // Freeze static road & prop world matrices to skip per-frame CPU traversal
    this.staticRoadRoot.traverse((o) => {
      o.updateMatrix();
      o.matrixAutoUpdate = false;
    });
    this.staticPropsRoot.updateMatrix();
    this.staticPropsRoot.matrixAutoUpdate = false;

    // Prewarm immediate spawn bubble synchronously; stream outer ring via WestgateEngineCore jobs
    const prewarmR = getLauncherProfile().prewarmRadius;
    const isBrowser = typeof requestAnimationFrame === "function";
    this.chunks.prewarm(spawnX, spawnZ, prewarmR, isBrowser);
  }

  update(focus: THREE.Vector3): void {
    this.chunks.update(focus);
    const dx = focus.x - this.lastShadowCullX;
    const dz = focus.z - this.lastShadowCullZ;
    if (dx * dx + dz * dz >= 16) {
      this.lastShadowCullX = focus.x;
      this.lastShadowCullZ = focus.z;
      // Shadow frustum stays local (185m); visibility follows the active
      // profile's LOD radius so out-of-range instanced prop buckets leave the
      // draw list entirely instead of just dropping shadows.
      this.props.updateShadowCulling(focus.x, focus.z, 185, getLauncherProfile().lodRadius);
    }
  }

  groundHeightAt(x: number, z: number, y: number): number {
    return this.heightSystem.groundHeightAt(x, z, y);
  }

  surfaceNormalAt(x: number, z: number, y: number, out?: THREE.Vector3): THREE.Vector3 {
    return this.heightSystem.surfaceNormalAt(x, z, y, out);
  }

  nearestLanePoint(x: number, z: number, maxDist = 24): LaneQueryHit | null {
    return this.roads.nearestLanePoint(x, z, maxDist);
  }

  getConnectedLanes(laneId: string): TrafficLane[] {
    return this.roads.getConnectedLanes(laneId);
  }

  sampleTrafficSpawnPoints(count: number, minSpacing = 22, rng?: () => number): TrafficSpawnPoint[] {
    return this.roads.sampleTrafficSpawnPoints(count, minSpacing, rng);
  }

  getParkedBays(): readonly ParkedBaySlot[] {
    return this.roads.getParkedBays();
  }

  queryCollidersForRay(origin: THREE.Vector3, dir: THREE.Vector3, maxDist: number): THREE.Object3D[] {
    return this.spatialColliders.queryRay(origin, dir, maxDist, this.rayScratch);
  }

  getStats(): { chunks: ChunkStats; props: PropBatchStats; aabbs: number; lanes: number; parkedBays: number } {
    return {
      chunks: this.chunks.getStats(),
      props: this.props.getStats(),
      aabbs: this.spatialAABBs.count,
      lanes: this.roads.getLanes().length,
      parkedBays: this.roads.getParkedBays().length,
    };
  }

  dispose(): void {
    this.chunks.dispose();
    this.spatialAABBs.clear();
    this.spatialColliders.clear();
    this.heightSystem.clearSurfaces();
    this.props.clearPlacements();
  }
}
