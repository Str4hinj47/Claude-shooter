import * as THREE from "three";
import { cellKey } from "./SpatialIndex";
import type { TerrainHeightFn, WalkableSurface } from "./HeightSystem";

export type RoadTier = "freeway" | "arterial" | "collector" | "local" | "ramp";
export type RoadNodeKind = "roundabout" | "signal" | "yield" | "merge" | "culdesac";

export interface TierSpec {
  lanesPerDir: number;
  laneWidth: number;
  shoulder: number;
  medianWidth: number;
  sidewalkWidth: number;
  speedLimit: number; // m/s
}

export const ROAD_TIER_DEFAULTS: Record<RoadTier, TierSpec> = {
  freeway: { lanesPerDir: 3, laneWidth: 3.6, shoulder: 1.8, medianWidth: 2.0, sidewalkWidth: 0, speedLimit: 31 },
  arterial: { lanesPerDir: 2, laneWidth: 3.4, shoulder: 0.4, medianWidth: 1.4, sidewalkWidth: 3.0, speedLimit: 20 },
  collector: { lanesPerDir: 1, laneWidth: 3.5, shoulder: 0.3, medianWidth: 0, sidewalkWidth: 2.6, speedLimit: 14 },
  local: { lanesPerDir: 1, laneWidth: 3.2, shoulder: 0.2, medianWidth: 0, sidewalkWidth: 2.0, speedLimit: 10 },
  ramp: { lanesPerDir: 1, laneWidth: 3.6, shoulder: 0.8, medianWidth: 0, sidewalkWidth: 0, speedLimit: 16 },
};

export interface RoadNodeSpec {
  id: string;
  x: number;
  y: number;
  z: number;
  kind: RoadNodeKind;
  radius?: number;
}

export interface RoadSegmentSpec {
  id: string;
  name?: string;
  tier: RoadTier;
  points: [number, number, number][];
  lanesPerDir?: number;
  laneWidth?: number;
  shoulder?: number;
  medianWidth?: number;
  sidewalkWidth?: number;
  isOneWay?: boolean;
  isBridge?: boolean;
  hasSidewalk?: boolean;
  hasMedian?: boolean;
  startNodeId?: string;
  endNodeId?: string;
  generateParkedBays?: boolean;
}

export interface RoadSample {
  s: number;
  x: number;
  y: number;
  z: number;
  tx: number;
  ty: number;
  tz: number;
  rx: number;
  rz: number;
}

export interface CompiledRoadSegment {
  spec: RoadSegmentSpec;
  curve: THREE.CatmullRomCurve3;
  length: number;
  lanesPerDir: number;
  laneWidth: number;
  shoulder: number;
  medianWidth: number;
  sidewalkWidth: number;
  hasSidewalk: boolean;
  hasMedian: boolean;
  carriagewayWidth: number;
  totalWidth: number;
  speedLimit: number;
  samples: RoadSample[];
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number; minY: number; maxY: number };
}

export interface RoadInfluence {
  segmentId: string;
  tier: RoadTier;
  centerDist: number;
  edgeDist: number;
  elevation: number;
  carriagewayWidth: number;
  totalWidth: number;
  tangentX: number;
  tangentZ: number;
  s: number;
  isBridge: boolean;
}

export interface TrafficLane {
  id: string;
  segmentId: string;
  tier: RoadTier;
  direction: 1 | -1;
  laneIndex: number;
  speedLimit: number;
  width: number;
  isBridge: boolean;
  isConnector: boolean;
  curve: THREE.CatmullRomCurve3;
  length: number;
  startNodeId?: string;
  endNodeId?: string;
  startPos: THREE.Vector3;
  endPos: THREE.Vector3;
  startDir: THREE.Vector3;
  endDir: THREE.Vector3;
  nextLanes: string[];
  prevLanes: string[];
  samples: { x: number; y: number; z: number; tx: number; tz: number; t: number }[];
}

export interface LaneQueryHit {
  lane: TrafficLane;
  t: number;
  pos: THREE.Vector3;
  tangent: THREE.Vector3;
  distSq: number;
}

export interface TrafficSpawnPoint {
  laneId: string;
  t: number;
  position: THREE.Vector3;
  yaw: number;
  speedLimit: number;
  tier: RoadTier;
}

export interface ParkedBaySlot {
  x: number;
  y: number;
  z: number;
  yaw: number;
  width: number;
  length: number;
  roadId: string;
  tier: RoadTier;
}

interface SampleRef {
  segIdx: number;
  sampleIdx: number;
}

interface LaneSampleRef {
  laneIdx: number;
  sampleIdx: number;
}

/**
 * Spline-based multi-tier city road & directional traffic lane graph.
 * Designed so the player walks/fights across curved streets & bridges today and
 * a full driveable + NPC vehicle kit plugs straight into `TrafficLane` & `ParkedBaySlot` later.
 */
export class RoadNetwork {
  private readonly nodes = new Map<string, RoadNodeSpec>();
  private readonly segments: CompiledRoadSegment[] = [];
  private readonly segmentById = new Map<string, CompiledRoadSegment>();
  private readonly lanes: TrafficLane[] = [];
  private readonly laneById = new Map<string, TrafficLane>();
  private readonly parkedBays: ParkedBaySlot[] = [];

  private readonly invCell = 1 / 32;
  private readonly roadGrid = new Map<number, SampleRef[]>();
  private readonly laneGrid = new Map<number, LaneSampleRef[]>();
  private compiled = false;

  addNode(node: RoadNodeSpec): this {
    this.nodes.set(node.id, node);
    this.compiled = false;
    return this;
  }

  addNodes(nodes: readonly RoadNodeSpec[]): this {
    for (const n of nodes) this.addNode(n);
    return this;
  }

  addSegment(spec: RoadSegmentSpec): this {
    if (spec.points.length < 2) {
      throw new Error(`RoadNetwork: segment "${spec.id}" needs at least 2 points`);
    }
    const tierSpec = ROAD_TIER_DEFAULTS[spec.tier];
    const lanesPerDir = spec.lanesPerDir ?? tierSpec.lanesPerDir;
    const laneWidth = spec.laneWidth ?? tierSpec.laneWidth;
    const shoulder = spec.shoulder ?? tierSpec.shoulder;
    const hasMedian = spec.hasMedian ?? tierSpec.medianWidth > 0;
    const medianWidth = hasMedian ? (spec.medianWidth ?? tierSpec.medianWidth) : 0;
    const hasSidewalk = spec.hasSidewalk ?? (!spec.isBridge && tierSpec.sidewalkWidth > 0);
    const sidewalkWidth = hasSidewalk ? (spec.sidewalkWidth ?? tierSpec.sidewalkWidth) : 0;
    const dirCount = spec.isOneWay ? 1 : 2;
    const carriagewayWidth = lanesPerDir * dirCount * laneWidth + shoulder * 2 + medianWidth;
    const totalWidth = carriagewayWidth + sidewalkWidth * 2;
    const speedLimit = tierSpec.speedLimit;

    const vecs = spec.points.map((p) => new THREE.Vector3(p[0], p[1], p[2]));
    const curve = new THREE.CatmullRomCurve3(vecs, false, "centripetal", 0.5);
    const length = Math.max(1, curve.getLength());
    const count = Math.max(8, Math.ceil(length / 2.5));

    const samples: RoadSample[] = [];
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;

    const pt = new THREE.Vector3();
    const tan = new THREE.Vector3();
    const halfTot = totalWidth * 0.5;

    for (let i = 0; i <= count; i++) {
      const t = i / count;
      curve.getPointAt(t, pt);
      curve.getTangentAt(t, tan);
      const hLen = Math.hypot(tan.x, tan.z) || 1;
      const rx = -tan.z / hLen;
      const rz = tan.x / hLen;

      samples.push({
        s: t * length,
        x: pt.x,
        y: pt.y,
        z: pt.z,
        tx: tan.x,
        ty: tan.y,
        tz: tan.z,
        rx,
        rz,
      });

      if (pt.x - halfTot < minX) minX = pt.x - halfTot;
      if (pt.x + halfTot > maxX) maxX = pt.x + halfTot;
      if (pt.z - halfTot < minZ) minZ = pt.z - halfTot;
      if (pt.z + halfTot > maxZ) maxZ = pt.z + halfTot;
      if (pt.y < minY) minY = pt.y;
      if (pt.y > maxY) maxY = pt.y;
    }

    const compiledSeg: CompiledRoadSegment = {
      spec,
      curve,
      length,
      lanesPerDir,
      laneWidth,
      shoulder,
      medianWidth,
      sidewalkWidth,
      hasSidewalk,
      hasMedian,
      carriagewayWidth,
      totalWidth,
      speedLimit,
      samples,
      bounds: { minX, maxX, minZ, maxZ, minY, maxY },
    };
    this.segments.push(compiledSeg);
    this.segmentById.set(spec.id, compiledSeg);
    this.compiled = false;
    return this;
  }

  addSegments(specs: readonly RoadSegmentSpec[]): this {
    for (const s of specs) this.addSegment(s);
    return this;
  }

  addParkedBay(slot: ParkedBaySlot): void {
    this.parkedBays.push(slot);
  }

  /**
   * Compiles spatial lookup grids, directional traffic lanes, node connections,
   * roundabout rings, and curb parked-vehicle bay slots.
   */
  compile(): void {
    this.roadGrid.clear();
    this.laneGrid.clear();
    this.lanes.length = 0;
    this.laneById.clear();
    this.parkedBays.length = 0;

    // 1. Index road samples into 32m spatial grid
    for (let sIdx = 0; sIdx < this.segments.length; sIdx++) {
      const seg = this.segments[sIdx];
      const pad = seg.totalWidth * 0.5 + 4;
      for (let i = 0; i < seg.samples.length - 1; i++) {
        const a = seg.samples[i];
        const b = seg.samples[i + 1];
        const minCx = Math.floor((Math.min(a.x, b.x) - pad) * this.invCell);
        const maxCx = Math.floor((Math.max(a.x, b.x) + pad) * this.invCell);
        const minCz = Math.floor((Math.min(a.z, b.z) - pad) * this.invCell);
        const maxCz = Math.floor((Math.max(a.z, b.z) + pad) * this.invCell);
        const ref: SampleRef = { segIdx: sIdx, sampleIdx: i };
        for (let cx = minCx; cx <= maxCx; cx++) {
          for (let cz = minCz; cz <= maxCz; cz++) {
            const key = cellKey(cx, cz);
            let bucket = this.roadGrid.get(key);
            if (!bucket) {
              bucket = [];
              this.roadGrid.set(key, bucket);
            }
            bucket.push(ref);
          }
        }
      }

      // 2. Build forward & reverse directional TrafficLanes
      const dirs: (1 | -1)[] = seg.spec.isOneWay ? [1] : [1, -1];
      for (const dir of dirs) {
        for (let l = 0; l < seg.lanesPerDir; l++) {
          const offset = seg.spec.isOneWay
            ? (l - (seg.lanesPerDir - 1) * 0.5) * seg.laneWidth
            : dir * (seg.medianWidth * 0.5 + (l + 0.5) * seg.laneWidth);

          const pts: THREE.Vector3[] = [];
          const step = Math.max(1, Math.floor(seg.samples.length / 24));
          for (let i = 0; i < seg.samples.length; i += step) {
            const sp = seg.samples[i];
            pts.push(new THREE.Vector3(sp.x + sp.rx * offset, sp.y + 0.05, sp.z + sp.rz * offset));
          }
          const lastSp = seg.samples[seg.samples.length - 1];
          const endPt = new THREE.Vector3(lastSp.x + lastSp.rx * offset, lastSp.y + 0.05, lastSp.z + lastSp.rz * offset);
          if (pts[pts.length - 1].distanceToSquared(endPt) > 0.25) pts.push(endPt);

          if (dir === -1) pts.reverse();

          const laneCurve = new THREE.CatmullRomCurve3(pts, false, "centripetal", 0.5);
          const laneLen = Math.max(0.5, laneCurve.getLength());
          const laneSamplesCount = Math.max(6, Math.ceil(laneLen / 4));
          const laneSamples: TrafficLane["samples"] = [];
          const pTmp = new THREE.Vector3();
          const tTmp = new THREE.Vector3();
          for (let k = 0; k <= laneSamplesCount; k++) {
            const t = k / laneSamplesCount;
            laneCurve.getPointAt(t, pTmp);
            laneCurve.getTangentAt(t, tTmp);
            const hl = Math.hypot(tTmp.x, tTmp.z) || 1;
            laneSamples.push({ x: pTmp.x, y: pTmp.y, z: pTmp.z, tx: tTmp.x / hl, tz: tTmp.z / hl, t });
          }

          const laneId = `${seg.spec.id}:${dir > 0 ? "f" : "r"}${l}`;
          const lane: TrafficLane = {
            id: laneId,
            segmentId: seg.spec.id,
            tier: seg.spec.tier,
            direction: dir,
            laneIndex: l,
            speedLimit: seg.speedLimit,
            width: seg.laneWidth,
            isBridge: !!seg.spec.isBridge,
            isConnector: false,
            curve: laneCurve,
            length: laneLen,
            startNodeId: dir === 1 ? seg.spec.startNodeId : seg.spec.endNodeId,
            endNodeId: dir === 1 ? seg.spec.endNodeId : seg.spec.startNodeId,
            startPos: laneCurve.getPointAt(0),
            endPos: laneCurve.getPointAt(1),
            startDir: laneCurve.getTangentAt(0).normalize(),
            endDir: laneCurve.getTangentAt(1).normalize(),
            nextLanes: [],
            prevLanes: [],
            samples: laneSamples,
          };
          this.lanes.push(lane);
          this.laneById.set(laneId, lane);
        }
      }

      // 3. Auto-generate curb parked-vehicle bay slots along collectors & locals
      const wantBays =
        seg.spec.generateParkedBays ??
        (!seg.spec.isBridge && (seg.spec.tier === "collector" || seg.spec.tier === "local"));
      if (wantBays && seg.length >= 24) {
        const bayOffset = seg.carriagewayWidth * 0.5 - 1.25;
        const stepS = 11.0;
        const margin = 10.0;
        for (let s = margin; s <= seg.length - margin; s += stepS) {
          const t = s / seg.length;
          const idx = Math.min(seg.samples.length - 1, Math.round(t * (seg.samples.length - 1)));
          const sp = seg.samples[idx];
          const yaw = Math.atan2(sp.tx, sp.tz);
          this.parkedBays.push({
            x: sp.x + sp.rx * bayOffset,
            y: sp.y,
            z: sp.z + sp.rz * bayOffset,
            yaw,
            width: 2.2,
            length: 4.8,
            roadId: seg.spec.id,
            tier: seg.spec.tier,
          });
          if (!seg.spec.isOneWay) {
            this.parkedBays.push({
              x: sp.x - sp.rx * bayOffset,
              y: sp.y,
              z: sp.z - sp.rz * bayOffset,
              yaw: yaw + Math.PI,
              width: 2.2,
              length: 4.8,
              roadId: seg.spec.id,
              tier: seg.spec.tier,
            });
          }
        }
      }
    }

    // 4. Add circular lanes for roundabout nodes
    for (const node of this.nodes.values()) {
      if (node.kind !== "roundabout") continue;
      const r = node.radius ?? 14;
      const pts: THREE.Vector3[] = [];
      const steps = 12;
      for (let i = 0; i < steps; i++) {
        // Counter-clockwise circulation for right-hand traffic
        const a = (i / steps) * Math.PI * 2;
        pts.push(new THREE.Vector3(node.x + Math.cos(a) * r, node.y + 0.05, node.z - Math.sin(a) * r));
      }
      const ringCurve = new THREE.CatmullRomCurve3(pts, true, "centripetal", 0.5);
      const ringLen = ringCurve.getLength();
      const ringSamples: TrafficLane["samples"] = [];
      const pTmp = new THREE.Vector3();
      const tTmp = new THREE.Vector3();
      for (let k = 0; k <= 32; k++) {
        const t = k / 32;
        ringCurve.getPointAt(t, pTmp);
        ringCurve.getTangentAt(t, tTmp);
        const hl = Math.hypot(tTmp.x, tTmp.z) || 1;
        ringSamples.push({ x: pTmp.x, y: pTmp.y, z: pTmp.z, tx: tTmp.x / hl, tz: tTmp.z / hl, t });
      }
      const ringLane: TrafficLane = {
        id: `roundabout:${node.id}`,
        segmentId: `roundabout:${node.id}`,
        tier: "arterial",
        direction: 1,
        laneIndex: 0,
        speedLimit: 11,
        width: 4.0,
        isBridge: false,
        isConnector: true,
        curve: ringCurve,
        length: ringLen,
        startNodeId: node.id,
        endNodeId: node.id,
        startPos: ringCurve.getPointAt(0),
        endPos: ringCurve.getPointAt(1),
        startDir: ringCurve.getTangentAt(0).normalize(),
        endDir: ringCurve.getTangentAt(1).normalize(),
        nextLanes: [`roundabout:${node.id}`],
        prevLanes: [`roundabout:${node.id}`],
        samples: ringSamples,
      };
      this.lanes.push(ringLane);
      this.laneById.set(ringLane.id, ringLane);
    }

    // 5. Connect directional lanes across shared RoadNodes
    for (let i = 0; i < this.lanes.length; i++) {
      const a = this.lanes[i];
      if (!a.endNodeId) continue;
      const node = this.nodes.get(a.endNodeId);

      // If node is a roundabout, hook incoming lane -> roundabout ring -> outgoing lanes
      if (node && node.kind === "roundabout") {
        const ring = this.laneById.get(`roundabout:${node.id}`);
        if (ring && a.id !== ring.id) {
          a.nextLanes.push(ring.id);
          ring.prevLanes.push(a.id);
        }
        continue;
      }

      for (let j = 0; j < this.lanes.length; j++) {
        if (i === j) continue;
        const b = this.lanes[j];
        if (b.startNodeId !== a.endNodeId) continue;
        // Avoid instant U-turn onto opposing direction of the same road unless culdesac
        if (a.segmentId === b.segmentId && node?.kind !== "culdesac") continue;
        const dot = a.endDir.x * b.startDir.x + a.endDir.z * b.startDir.z;
        if (dot < -0.75 && node?.kind !== "culdesac") continue;
        a.nextLanes.push(b.id);
        b.prevLanes.push(a.id);
      }
    }

    // Connect roundabout rings out to all lanes starting at that roundabout node
    for (const node of this.nodes.values()) {
      if (node.kind !== "roundabout") continue;
      const ring = this.laneById.get(`roundabout:${node.id}`);
      if (!ring) continue;
      for (const b of this.lanes) {
        if (b.id !== ring.id && b.startNodeId === node.id) {
          ring.nextLanes.push(b.id);
          b.prevLanes.push(ring.id);
        }
      }
    }

    // 6. Index lane samples in 32m grid for O(1) nearestLanePoint queries
    for (let lIdx = 0; lIdx < this.lanes.length; lIdx++) {
      const lane = this.lanes[lIdx];
      for (let sIdx = 0; sIdx < lane.samples.length; sIdx++) {
        const sp = lane.samples[sIdx];
        const key = cellKey(Math.floor(sp.x * this.invCell), Math.floor(sp.z * this.invCell));
        let bucket = this.laneGrid.get(key);
        if (!bucket) {
          bucket = [];
          this.laneGrid.set(key, bucket);
        }
        bucket.push({ laneIdx: lIdx, sampleIdx: sIdx });
      }
    }

    this.compiled = true;
  }

  private ensureCompiled(): void {
    if (!this.compiled) this.compile();
  }

  getSegments(): readonly CompiledRoadSegment[] {
    return this.segments;
  }

  getSegment(id: string): CompiledRoadSegment | undefined {
    return this.segmentById.get(id);
  }

  getLanes(): readonly TrafficLane[] {
    this.ensureCompiled();
    return this.lanes;
  }

  getLane(id: string): TrafficLane | undefined {
    this.ensureCompiled();
    return this.laneById.get(id);
  }

  getConnectedLanes(laneId: string): TrafficLane[] {
    this.ensureCompiled();
    const lane = this.laneById.get(laneId);
    if (!lane) return [];
    const out: TrafficLane[] = [];
    for (const nid of lane.nextLanes) {
      const next = this.laneById.get(nid);
      if (next) out.push(next);
    }
    return out;
  }

  getParkedBays(): readonly ParkedBaySlot[] {
    this.ensureCompiled();
    return this.parkedBays;
  }

  getNodes(): RoadNodeSpec[] {
    return Array.from(this.nodes.values());
  }

  /**
   * Fast O(1) spatial query returning road distance, elevation, and tangent at (x, z).
   * Used by terrain carving (Phase 1), building exclusion (Phases 2-8), and minimap overlays.
   */
  getRoadInfluence(x: number, z: number, maxSearchDist = 28, ignoreBridges = false): RoadInfluence | null {
    this.ensureCompiled();
    const cellSpan = Math.ceil(maxSearchDist * this.invCell);
    const cx0 = Math.floor(x * this.invCell);
    const cz0 = Math.floor(z * this.invCell);

    let bestDistSq = maxSearchDist * maxSearchDist;
    let bestSeg: CompiledRoadSegment | null = null;
    let bestProjX = 0;
    let bestProjY = 0;
    let bestProjZ = 0;
    let bestTx = 0;
    let bestTz = 1;
    let bestS = 0;

    for (let cx = cx0 - cellSpan; cx <= cx0 + cellSpan; cx++) {
      for (let cz = cz0 - cellSpan; cz <= cz0 + cellSpan; cz++) {
        const bucket = this.roadGrid.get(cellKey(cx, cz));
        if (!bucket) continue;
        for (let i = 0; i < bucket.length; i++) {
          const ref = bucket[i];
          const seg = this.segments[ref.segIdx];
          if (ignoreBridges && seg.spec.isBridge) continue;
          const a = seg.samples[ref.sampleIdx];
          const b = seg.samples[ref.sampleIdx + 1];

          const abx = b.x - a.x;
          const abz = b.z - a.z;
          const lenSq = abx * abx + abz * abz;
          let u = 0;
          if (lenSq > 1e-6) {
            u = ((x - a.x) * abx + (z - a.z) * abz) / lenSq;
            if (u < 0) u = 0;
            else if (u > 1) u = 1;
          }
          const px = a.x + abx * u;
          const pz = a.z + abz * u;
          const dx = x - px;
          const dz = z - pz;
          const d2 = dx * dx + dz * dz;
          if (d2 < bestDistSq) {
            bestDistSq = d2;
            bestSeg = seg;
            bestProjX = px;
            bestProjZ = pz;
            bestProjY = a.y + (b.y - a.y) * u;
            bestTx = a.tx + (b.tx - a.tx) * u;
            bestTz = a.tz + (b.tz - a.tz) * u;
            bestS = a.s + (b.s - a.s) * u;
          }
        }
      }
    }

    if (!bestSeg) return null;
    void bestProjX;
    void bestProjZ;
    const centerDist = Math.sqrt(bestDistSq);
    const tl = Math.hypot(bestTx, bestTz) || 1;
    return {
      segmentId: bestSeg.spec.id,
      tier: bestSeg.spec.tier,
      centerDist,
      edgeDist: centerDist - bestSeg.totalWidth * 0.5,
      elevation: bestProjY,
      carriagewayWidth: bestSeg.carriagewayWidth,
      totalWidth: bestSeg.totalWidth,
      tangentX: bestTx / tl,
      tangentZ: bestTz / tl,
      s: bestS,
      isBridge: !!bestSeg.spec.isBridge,
    };
  }

  /** Car-kit query: find nearest traffic lane point within `maxDist` meters. */
  nearestLanePoint(x: number, z: number, maxDist = 24): LaneQueryHit | null {
    this.ensureCompiled();
    const cellSpan = Math.ceil(maxDist * this.invCell);
    const cx0 = Math.floor(x * this.invCell);
    const cz0 = Math.floor(z * this.invCell);

    let bestDistSq = maxDist * maxDist;
    let bestLane: TrafficLane | null = null;
    let bestSample: TrafficLane["samples"][0] | null = null;

    for (let cx = cx0 - cellSpan; cx <= cx0 + cellSpan; cx++) {
      for (let cz = cz0 - cellSpan; cz <= cz0 + cellSpan; cz++) {
        const bucket = this.laneGrid.get(cellKey(cx, cz));
        if (!bucket) continue;
        for (let i = 0; i < bucket.length; i++) {
          const ref = bucket[i];
          const lane = this.lanes[ref.laneIdx];
          const sp = lane.samples[ref.sampleIdx];
          const dx = x - sp.x;
          const dz = z - sp.z;
          const d2 = dx * dx + dz * dz;
          if (d2 < bestDistSq) {
            bestDistSq = d2;
            bestLane = lane;
            bestSample = sp;
          }
        }
      }
    }

    if (!bestLane || !bestSample) return null;
    return {
      lane: bestLane,
      t: bestSample.t,
      pos: new THREE.Vector3(bestSample.x, bestSample.y, bestSample.z),
      tangent: new THREE.Vector3(bestSample.tx, 0, bestSample.tz),
      distSq: bestDistSq,
    };
  }

  /** Car-kit query: sample evenly spaced non-overlapping traffic spawn points across the city. */
  sampleTrafficSpawnPoints(count: number, minSpacing = 22, rng: () => number = Math.random): TrafficSpawnPoint[] {
    this.ensureCompiled();
    const eligible = this.lanes.filter((l) => !l.isConnector && l.length > 20);
    if (eligible.length === 0) return [];

    const out: TrafficSpawnPoint[] = [];
    const minSpacing2 = minSpacing * minSpacing;
    let attempts = 0;
    const maxAttempts = count * 16;

    while (out.length < count && attempts < maxAttempts) {
      attempts++;
      const lane = eligible[Math.floor(rng() * eligible.length)];
      const t = 0.08 + rng() * 0.84;
      const pos = lane.curve.getPointAt(t);
      let tooClose = false;
      for (let i = 0; i < out.length; i++) {
        const dx = out[i].position.x - pos.x;
        const dz = out[i].position.z - pos.z;
        if (dx * dx + dz * dz < minSpacing2) {
          tooClose = true;
          break;
        }
      }
      if (tooClose) continue;
      const tan = lane.curve.getTangentAt(t);
      out.push({
        laneId: lane.id,
        t,
        position: pos,
        yaw: Math.atan2(tan.x, tan.z),
        speedLimit: lane.speedLimit,
        tier: lane.tier,
      });
    }
    return out;
  }

  /** Exports bridge & elevated ramp decks as WalkableSurfaces for WorldHeightSystem. */
  getBridgeDecks(): WalkableSurface[] {
    this.ensureCompiled();
    const surfaces: WalkableSurface[] = [];

    for (const seg of this.segments) {
      if (!seg.spec.isBridge) continue;
      const halfW = seg.carriagewayWidth * 0.5 + (seg.hasSidewalk ? seg.sidewalkWidth : 0.4);
      const halfW2 = halfW * halfW;

      surfaces.push({
        id: `bridge:${seg.spec.id}`,
        minX: seg.bounds.minX - 1,
        maxX: seg.bounds.maxX + 1,
        minZ: seg.bounds.minZ - 1,
        maxZ: seg.bounds.maxZ + 1,
        minY: seg.bounds.minY - 0.5,
        maxY: seg.bounds.maxY + 0.5,
        heightAt: (x: number, z: number) => {
          let bestD2 = halfW2;
          let bestY: number | null = null;
          for (let i = 0; i < seg.samples.length - 1; i++) {
            const a = seg.samples[i];
            const b = seg.samples[i + 1];
            const abx = b.x - a.x;
            const abz = b.z - a.z;
            const len2 = abx * abx + abz * abz;
            let u = 0;
            if (len2 > 1e-6) {
              u = ((x - a.x) * abx + (z - a.z) * abz) / len2;
              if (u < 0) u = 0;
              else if (u > 1) u = 1;
            }
            const px = a.x + abx * u;
            const pz = a.z + abz * u;
            const d2 = (x - px) * (x - px) + (z - pz) * (z - pz);
            if (d2 <= bestD2) {
              bestD2 = d2;
              bestY = a.y + (b.y - a.y) * u;
            }
          }
          return bestY;
        },
      });
    }
    return surfaces;
  }

  /**
   * Builds 3D spline ribbon meshes for asphalt carriageways, raised concrete sidewalks,
   * bridge deck slabs, parapets, and support piers.
   */
  buildMeshes(
    parent: THREE.Object3D,
    terrainAt: TerrainHeightFn = () => 0,
    collidersOut?: THREE.Object3D[],
  ): THREE.Group {
    this.ensureCompiled();
    const group = new THREE.Group();
    group.name = "CityRoadNetwork";

    const roadMatCache = new Map<string, THREE.MeshStandardMaterial>();
    const sidewalkMat = new THREE.MeshStandardMaterial({ color: 0x9aa0a6, roughness: 0.9, metalness: 0.03 });
    const deckMat = new THREE.MeshStandardMaterial({ color: 0x6f747b, roughness: 0.86, metalness: 0.08 });
    const parapetMat = new THREE.MeshStandardMaterial({ color: 0x8a8f96, roughness: 0.82, metalness: 0.1 });
    const pierMat = new THREE.MeshStandardMaterial({ color: 0x5d6268, roughness: 0.9, metalness: 0.06 });

    const getRoadMat = (seg: CompiledRoadSegment) => {
      const key = `${seg.lanesPerDir}|${seg.hasMedian}|${!!seg.spec.isOneWay}`;
      let mat = roadMatCache.get(key);
      if (!mat) {
        mat = new THREE.MeshStandardMaterial({
          color: 0x2b2e33,
          roughness: 0.9,
          metalness: 0.04,
          polygonOffset: true,
          polygonOffsetFactor: -1,
          polygonOffsetUnits: -1,
        });
        roadMatCache.set(key, mat);
      }
      return mat;
    };

    for (const seg of this.segments) {
      const n = seg.samples.length;
      const halfC = seg.carriagewayWidth * 0.5;
      const positions = new Float32Array(n * 2 * 3);
      const uvs = new Float32Array(n * 2 * 2);
      const indices: number[] = [];

      for (let i = 0; i < n; i++) {
        const sp = seg.samples[i];
        const yOff = seg.spec.isBridge ? 0.0 : 0.04;
        const lx = sp.x - sp.rx * halfC;
        const lz = sp.z - sp.rz * halfC;
        const rx = sp.x + sp.rx * halfC;
        const rz = sp.z + sp.rz * halfC;

        const vi = i * 6;
        positions[vi] = lx;
        positions[vi + 1] = sp.y + yOff;
        positions[vi + 2] = lz;
        positions[vi + 3] = rx;
        positions[vi + 4] = sp.y + yOff;
        positions[vi + 5] = rz;

        const ui = i * 4;
        const vCoord = sp.s;
        uvs[ui] = 0;
        uvs[ui + 1] = vCoord;
        uvs[ui + 2] = 1;
        uvs[ui + 3] = vCoord;

        if (i < n - 1) {
          const a = i * 2;
          const b = a + 1;
          const c = a + 2;
          const d = a + 3;
          indices.push(a, b, c, b, d, c);
        }
      }

      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
      geo.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
      geo.setIndex(indices);
      geo.computeVertexNormals();

      const roadMesh = new THREE.Mesh(geo, getRoadMat(seg));
      roadMesh.receiveShadow = true;
      roadMesh.userData.kind = "concrete";
      roadMesh.userData.roadId = seg.spec.id;
      group.add(roadMesh);
      collidersOut?.push(roadMesh);

      // Raised concrete sidewalks on each edge
      if (seg.hasSidewalk && seg.sidewalkWidth > 0) {
        for (const side of [-1, 1] as const) {
          const inner = halfC;
          const outer = halfC + seg.sidewalkWidth;
          const swMesh = this.buildSideRibbonBox(seg.samples, side * inner, side * outer, 0.18, 0.04, sidewalkMat);
          swMesh.receiveShadow = true;
          swMesh.userData.kind = "concrete";
          group.add(swMesh);
          collidersOut?.push(swMesh);
        }
      }

      // Bridge slab, parapets & support piers
      if (seg.spec.isBridge) {
        const deckW = seg.carriagewayWidth * 0.5 + 0.6;
        const slab = this.buildSideRibbonBox(seg.samples, -deckW, deckW, 0.9, -0.9, deckMat);
        slab.castShadow = true;
        slab.receiveShadow = true;
        slab.userData.kind = "concrete";
        group.add(slab);
        collidersOut?.push(slab);

        for (const side of [-1, 1] as const) {
          const wall = this.buildSideRibbonBox(
            seg.samples,
            side * (deckW - 0.45),
            side * deckW,
            0.95,
            0.0,
            parapetMat,
          );
          wall.castShadow = true;
          wall.receiveShadow = true;
          wall.userData.kind = "concrete";
          group.add(wall);
          collidersOut?.push(wall);
        }

        // Support piers every ~28m along elevated span (straddle bents over underpass roads)
        let nextPierS = 18;
        for (let i = 0; i < n; i++) {
          const sp = seg.samples[i];
          if (sp.s < nextPierS || sp.s > seg.length - 16) continue;
          const groundY = terrainAt(sp.x, sp.z);
          const clearance = sp.y - groundY;
          if (clearance > 2.2) {
            const underRoad = this.getRoadInfluence(sp.x, sp.z, 18, true);
            if (underRoad && underRoad.edgeDist < 2.0) {
              // Straddle portal bent spanning outside the underpass carriageway
              const spanHalf = seg.carriagewayWidth * 0.5 + 1.2;
              const pierH = clearance - 0.7;
              for (const side of [-1, 1] as const) {
                const colX = sp.x + sp.rx * side * spanHalf;
                const colZ = sp.z + sp.rz * side * spanHalf;
                const colG = terrainAt(colX, colZ);
                const colH = Math.max(1.5, sp.y - 0.7 - colG);
                const col = new THREE.Mesh(new THREE.CylinderGeometry(0.65, 0.75, colH, 10), pierMat);
                col.position.set(colX, colG + colH * 0.5, colZ);
                col.castShadow = true;
                col.receiveShadow = true;
                col.userData.kind = "concrete";
                group.add(col);
                collidersOut?.push(col);
              }
              const cap = new THREE.Mesh(new THREE.BoxGeometry(spanHalf * 2 + 1.6, 0.9, 1.4), pierMat);
              cap.position.set(sp.x, sp.y - 1.05, sp.z);
              cap.rotation.y = Math.atan2(sp.tx, sp.tz);
              cap.castShadow = true;
              cap.receiveShadow = true;
              cap.userData.kind = "concrete";
              group.add(cap);
              collidersOut?.push(cap);
              void pierH;
            } else {
              const pierH = clearance - 0.6;
              const pier = new THREE.Mesh(new THREE.CylinderGeometry(0.95, 1.15, pierH, 10), pierMat);
              pier.position.set(sp.x, groundY + pierH * 0.5, sp.z);
              pier.castShadow = true;
              pier.receiveShadow = true;
              pier.userData.kind = "concrete";
              group.add(pier);
              collidersOut?.push(pier);
            }
          }
          nextPierS = sp.s + 28;
        }
      }
    }

    parent.add(group);
    return group;
  }

  private buildSideRibbonBox(
    samples: RoadSample[],
    offsetA: number,
    offsetB: number,
    height: number,
    yBaseOffset: number,
    material: THREE.Material,
  ): THREE.Mesh {
    const n = samples.length;
    const minO = Math.min(offsetA, offsetB);
    const maxO = Math.max(offsetA, offsetB);
    // 4 verts per cross-section: outer-bottom, outer-top, inner-top, inner-bottom
    const positions = new Float32Array(n * 4 * 3);
    const indices: number[] = [];

    for (let i = 0; i < n; i++) {
      const sp = samples[i];
      const y0 = sp.y + yBaseOffset;
      const y1 = y0 + height;
      const ax = sp.x + sp.rx * minO;
      const az = sp.z + sp.rz * minO;
      const bx = sp.x + sp.rx * maxO;
      const bz = sp.z + sp.rz * maxO;

      const v = i * 12;
      // 0: minO bottom
      positions[v] = ax;
      positions[v + 1] = y0;
      positions[v + 2] = az;
      // 1: minO top
      positions[v + 3] = ax;
      positions[v + 4] = y1;
      positions[v + 5] = az;
      // 2: maxO top
      positions[v + 6] = bx;
      positions[v + 7] = y1;
      positions[v + 8] = bz;
      // 3: maxO bottom
      positions[v + 9] = bx;
      positions[v + 10] = y0;
      positions[v + 11] = bz;

      if (i < n - 1) {
        const a = i * 4;
        const b = (i + 1) * 4;
        // Top face (1 -> 2, outward +Y)
        indices.push(a + 1, a + 2, b + 1, a + 2, b + 2, b + 1);
        // Min-offset side face (0 -> 1, outward +R_neg)
        indices.push(a + 0, a + 1, b + 0, a + 1, b + 1, b + 0);
        // Max-offset side face (2 -> 3, outward +R_pos)
        indices.push(a + 2, a + 3, b + 2, a + 3, b + 3, b + 2);
        // Bottom face (3 -> 0, outward -Y)
        indices.push(a + 0, b + 0, a + 3, a + 3, b + 0, b + 3);
      }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geo.setIndex(indices);
    geo.computeVertexNormals();
    return new THREE.Mesh(geo, material);
  }
}
