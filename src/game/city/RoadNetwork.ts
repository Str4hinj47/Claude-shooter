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
  private readonly asphaltMaterials: THREE.MeshStandardMaterial[] = [];
  private readonly weatherUniforms = {
    uWet: { value: 0 },
    uSnowCover: { value: 0 },
    uWeatherTime: { value: 0 },
  };
  private lastWetness = -1;
  private compiled = false;

  private attachWeatherShader(
    mat: THREE.MeshStandardMaterial,
    opts: { isSidewalk?: boolean; isRibbon?: boolean } = {},
  ): THREE.MeshStandardMaterial {
    const isSidewalk = !!opts.isSidewalk;
    const isRibbon = !!opts.isRibbon;
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uWet = this.weatherUniforms.uWet;
      shader.uniforms.uSnowCover = this.weatherUniforms.uSnowCover;
      shader.uniforms.uWeatherTime = this.weatherUniforms.uWeatherTime;
      shader.vertexShader = shader.vertexShader
        .replace(
          "#include <common>",
          `#include <common>
          varying vec3 vRoadWorldPos;
          varying vec2 vRoadRawUv;`,
        )
        .replace(
          "#include <begin_vertex>",
          `#include <begin_vertex>
          vRoadWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
          #ifdef USE_UV
            vRoadRawUv = uv;
          #else
            vRoadRawUv = vec2(0.5);
          #endif`,
        );

      shader.fragmentShader = shader.fragmentShader
        .replace(
          "#include <common>",
          `#include <common>
          uniform float uWet;
          uniform float uSnowCover;
          uniform float uWeatherTime;
          varying vec3 vRoadWorldPos;
          varying vec2 vRoadRawUv;
          float rnHash(vec2 p) {
            return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
          }
          float rnNoise(vec2 p) {
            vec2 i = floor(p);
            vec2 f = fract(p);
            vec2 u = f * f * (3.0 - 2.0 * f);
            return mix(
              mix(rnHash(i), rnHash(i + vec2(1.0, 0.0)), u.x),
              mix(rnHash(i + vec2(0.0, 1.0)), rnHash(i + vec2(1.0, 1.0)), u.x),
              u.y
            );
          }`,
        )
        .replace(
          "#include <color_fragment>",
          `#include <color_fragment>
          float rwN1 = rnNoise(vRoadWorldPos.xz * 0.095);
          float rwN2 = rnNoise(vRoadWorldPos.xz * 0.48);
          float rwPuddle = smoothstep(0.42, 0.72, rwN1 * 0.7 + rwN2 * 0.3);
          float rwWet = clamp(uWet, 0.0, 1.0);
          if (rwWet > 0.005) {
            float wetDark = ${isSidewalk ? "0.72" : "0.48"};
            diffuseColor.rgb *= mix(1.0, wetDark, rwWet * (0.42 + 0.58 * rwPuddle));
          }
          float rwSnow = clamp(uSnowCover, 0.0, 1.0);
          if (rwSnow > 0.005) {
            ${
              isSidewalk
                ? `float snowCov = smoothstep(0.12, 0.85, rwSnow * 1.2 - rwN2 * 0.25);`
                : isRibbon
                  ? `
                    float edgeSnow = smoothstep(0.30, 0.49, abs(vRoadRawUv.x - 0.5));
                    float centerMed = 1.0 - smoothstep(0.0, 0.08, abs(vRoadRawUv.x - 0.5));
                    float rutL = smoothstep(0.035, 0.095, abs(abs(vRoadRawUv.x - 0.5) - 0.16));
                    float rutR = smoothstep(0.035, 0.095, abs(abs(vRoadRawUv.x - 0.5) - 0.28));
                    float rutClear = mix(0.28, 1.0, rutL * rutR);
                    float drift = smoothstep(0.22, 0.86, rwSnow * 1.12 - rwN1 * 0.35);
                    float snowCov = clamp(max(max(edgeSnow, centerMed * 0.85) * rwSnow, drift * rutClear * 0.82), 0.0, 0.94);`
                  : `float snowCov = smoothstep(0.24, 0.88, rwSnow * 1.05 - rwN1 * 0.34) * 0.76;`
            }
            vec3 snowCol = vec3(0.87, 0.92, 0.98) * mix(0.94, 1.03, rwN2);
            diffuseColor.rgb = mix(diffuseColor.rgb, snowCol, snowCov);
          }`,
        )
        .replace(
          "#include <roughnessmap_fragment>",
          `#include <roughnessmap_fragment>
          if (uWet > 0.005) {
            float pMask = smoothstep(0.42, 0.72, rnNoise(vRoadWorldPos.xz * 0.095) * 0.7 + rnNoise(vRoadWorldPos.xz * 0.48) * 0.3);
            float dryR = roughnessFactor;
            float wetR = ${isSidewalk ? "mix(0.48, 0.16, pMask)" : "mix(0.32, 0.06, pMask)"};
            roughnessFactor = mix(dryR, wetR, clamp(uWet, 0.0, 1.0));
          }
          if (uSnowCover > 0.005) {
            roughnessFactor = mix(roughnessFactor, 0.86, clamp(uSnowCover * 0.78, 0.0, 1.0));
          }`,
        )
        .replace(
          "#include <normal_fragment_maps>",
          `#include <normal_fragment_maps>
          if (uWet > 0.04) {
            vec2 cell = floor(vRoadWorldPos.xz * 0.95);
            vec2 fUv = fract(vRoadWorldPos.xz * 0.95) - vec2(0.5);
            float h = rnHash(cell);
            float phase = fract(uWeatherTime * 1.85 + h * 7.0);
            float d = length(fUv);
            float ring = sin((d - phase * 0.48) * 42.0) * exp(-abs(d - phase * 0.48) * 16.0) * (1.0 - phase);
            float pMaskN = smoothstep(0.44, 0.74, rnNoise(vRoadWorldPos.xz * 0.095));
            vec2 rip = normalize(fUv + vec2(0.0001)) * ring * 0.14 * uWet * pMaskN;
            normal = normalize(normal + (viewMatrix * vec4(rip.x, 0.0, rip.y, 0.0)).xyz);
          }`,
        );
    };
    mat.customProgramCacheKey = () => `road-weather-${isSidewalk ? "sw" : isRibbon ? "rib" : "pad"}-v1`;
    return mat;
  }

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

  getNode(id: string): RoadNodeSpec | undefined {
    return this.nodes.get(id);
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
   * Builds 3D spline ribbon meshes for asphalt carriageways with road markings,
   * unified intersection aprons & crosswalks (eliminating Z-fighting & overlap seams),
   * clipped paver sidewalks with granite curbs, bridge decks, parapets, and support piers.
   */
  buildMeshes(
    parent: THREE.Object3D,
    terrainAt: TerrainHeightFn = () => 0,
    collidersOut?: THREE.Object3D[],
  ): THREE.Group {
    this.ensureCompiled();
    const group = new THREE.Group();
    group.name = "CityRoadNetwork";

    const hasBrowserTexLoader = typeof document !== "undefined" && typeof Image !== "undefined";
    const roadTexLoader = hasBrowserTexLoader ? new THREE.TextureLoader() : null;
    const roadAlbedoListeners: Array<(img: HTMLImageElement) => void> = [];
    let loadedRoadAlbedoImg: HTMLImageElement | null = null;
    let roadNormalBaseTex: THREE.Texture | null = null;

    if (roadTexLoader) {
      roadTexLoader.load("/textures/road/asphalt-albedo.jpg", (tex) => {
        const img = tex.image as HTMLImageElement | undefined;
        if (!img) return;
        loadedRoadAlbedoImg = img;
        for (const fn of roadAlbedoListeners) fn(img);
        roadAlbedoListeners.length = 0;
      });
      roadNormalBaseTex = roadTexLoader.load("/textures/road/asphalt-normal.jpg");
      roadNormalBaseTex.wrapS = roadNormalBaseTex.wrapT = THREE.RepeatWrapping;
      roadNormalBaseTex.anisotropy = 4;
    }

    const getAsphaltNormalMap = (acrossMetres: number, alongMetres = 16.0): THREE.Texture | null => {
      if (!roadNormalBaseTex) return null;
      const t = roadNormalBaseTex.clone();
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.repeat.set(Math.max(1, acrossMetres / 3.2), alongMetres / 3.2);
      t.anisotropy = 4;
      t.needsUpdate = true;
      return t;
    };

    const makeAsphaltTex = (
      lanesPerDir: number,
      laneWidth: number,
      shoulder: number,
      medianWidth: number,
      carriagewayWidth: number,
      hasMedian: boolean,
      isOneWay: boolean,
      withLines: boolean,
    ) => {
      const w = 1024;
      const h = 1024;
      const c = document.createElement("canvas");
      c.width = w;
      c.height = h;
      const g = c.getContext("2d")!;

      const paintAsphalt = (baseImg?: HTMLImageElement) => {
        if (baseImg) {
          const tilesX = Math.max(1, Math.round(carriagewayWidth / 3.2));
          const tilesY = 5; // 16m V repeat / 3.2m Overtake tile size
          const tw = w / tilesX;
          const th = h / tilesY;
          for (let ix = 0; ix < tilesX; ix++) {
            for (let iy = 0; iy < tilesY; iy++) {
              g.drawImage(baseImg, ix * tw, iy * th, tw + 0.5, th + 0.5);
            }
          }
          // Subtle Overtake 0xb2b5ba multiplier feel while keeping lane paint crisp
          g.fillStyle = "rgba(18, 22, 28, 0.24)";
          g.fillRect(0, 0, w, h);
        } else {
          g.fillStyle = "#262a30";
          g.fillRect(0, 0, w, h);
          for (let i = 0; i < 6500; i++) {
            const px = (i * 197 + (i >> 3) * 53) % w;
            const py = (i * 313 + (i >> 4) * 89) % h;
            g.fillStyle = i % 3 === 0 ? "rgba(255,255,255,0.038)" : "rgba(0,0,0,0.095)";
            g.fillRect(px, py, 2, 2);
          }
        }

        if (withLines && carriagewayWidth > 0.1) {
          const ppm = w / carriagewayWidth;
          const dirCount = isOneWay ? 1 : 2;

          if (isOneWay) {
            for (let l = 0; l < lanesPerDir; l++) {
              const lx = (shoulder + (l + 0.5) * laneWidth) * ppm;
              g.fillStyle = "rgba(10,12,16,0.16)";
              g.fillRect(lx - laneWidth * 0.24 * ppm, 0, laneWidth * 0.16 * ppm, h);
              g.fillRect(lx + laneWidth * 0.08 * ppm, 0, laneWidth * 0.16 * ppm, h);
            }
          } else {
            for (let l = 0; l < lanesPerDir; l++) {
              const off = medianWidth * 0.5 + (l + 0.5) * laneWidth;
              for (const s of [-1, 1]) {
                const lx = (carriagewayWidth * 0.5 + s * off) * ppm;
                g.fillStyle = "rgba(10,12,16,0.16)";
                g.fillRect(lx - laneWidth * 0.22 * ppm, 0, laneWidth * 0.14 * ppm, h);
                g.fillRect(lx + laneWidth * 0.08 * ppm, 0, laneWidth * 0.14 * ppm, h);
              }
            }
          }

          const lineW = Math.max(4, Math.round(0.14 * ppm));
          const edgeInset = Math.max(0.15, shoulder) * ppm;
          g.fillStyle = "#e6eaef";
          g.fillRect(edgeInset - lineW * 0.5, 0, lineW, h);
          g.fillRect(w - edgeInset - lineW * 0.5, 0, lineW, h);

          if (!isOneWay && dirCount === 2) {
            const midX = w * 0.5;
            if (hasMedian && medianWidth > 0.2) {
              const medHalfPx = medianWidth * 0.5 * ppm;
              g.fillStyle = "#1d2026";
              g.fillRect(midX - medHalfPx, 0, medHalfPx * 2, h);
              g.fillStyle = "#eab308";
              g.fillRect(midX - medHalfPx - lineW, 0, lineW, h);
              g.fillRect(midX + medHalfPx, 0, lineW, h);
            } else {
              const yW = Math.max(4, Math.round(0.12 * ppm));
              const gap = Math.max(4, Math.round(0.14 * ppm));
              g.fillStyle = "#eab308";
              g.fillRect(midX - gap * 0.5 - yW, 0, yW, h);
              g.fillRect(midX + gap * 0.5, 0, yW, h);
            }

            if (lanesPerDir >= 2) {
              const dashW = Math.max(3, Math.round(0.12 * ppm));
              g.fillStyle = "#e2e8f0";
              for (let li = 1; li < lanesPerDir; li++) {
                const off = (medianWidth * 0.5 + li * laneWidth) * ppm;
                for (let y = 64; y < h; y += 512) {
                  g.fillRect(midX - off - dashW * 0.5, y, dashW, 192);
                  g.fillRect(midX + off - dashW * 0.5, y, dashW, 192);
                }
              }
            }
          } else if (lanesPerDir >= 2) {
            const dashW = Math.max(3, Math.round(0.12 * ppm));
            g.fillStyle = "#e2e8f0";
            for (let li = 1; li < lanesPerDir; li++) {
              const lx = (shoulder + li * laneWidth) * ppm;
              for (let y = 64; y < h; y += 512) {
                g.fillRect(lx - dashW * 0.5, y, dashW, 192);
              }
            }
          }
        }
      };

      paintAsphalt(loadedRoadAlbedoImg ?? undefined);
      const tex = new THREE.CanvasTexture(c);
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.minFilter = THREE.LinearMipmapLinearFilter;
      tex.magFilter = THREE.LinearFilter;
      tex.anisotropy = 4;

      if (!loadedRoadAlbedoImg && roadTexLoader) {
        roadAlbedoListeners.push((img) => {
          paintAsphalt(img);
          tex.needsUpdate = true;
        });
      }
      return tex;
    };

    const makeRoundaboutTex = () => {
      const s = 1024;
      const c = document.createElement("canvas");
      c.width = c.height = s;
      const g = c.getContext("2d")!;

      const paintRoundabout = (baseImg?: HTMLImageElement) => {
        if (baseImg) {
          const tiles = 10;
          const tw = s / tiles;
          for (let ix = 0; ix < tiles; ix++) {
            for (let iy = 0; iy < tiles; iy++) {
              g.drawImage(baseImg, ix * tw, iy * tw, tw + 0.5, tw + 0.5);
            }
          }
          g.fillStyle = "rgba(18, 22, 28, 0.24)";
          g.fillRect(0, 0, s, s);
        } else {
          g.fillStyle = "#262a30";
          g.fillRect(0, 0, s, s);
          for (let i = 0; i < 6000; i++) {
            const px = (i * 197 + (i >> 3) * 53) % s;
            const py = (i * 313 + (i >> 4) * 89) % s;
            g.fillStyle = i % 3 === 0 ? "rgba(255,255,255,0.036)" : "rgba(0,0,0,0.09)";
            g.fillRect(px, py, 2, 2);
          }
        }
        const cx = s * 0.5;
        const cy = s * 0.5;
        g.strokeStyle = "#e2e8f0";
        g.lineWidth = 7;
        g.beginPath();
        g.arc(cx, cy, s * 0.472, 0, Math.PI * 2);
        g.stroke();

        g.strokeStyle = "#eab308";
        g.lineWidth = 6;
        g.beginPath();
        g.arc(cx, cy, s * 0.258, 0, Math.PI * 2);
        g.stroke();

        g.strokeStyle = "#e2e8f0";
        g.lineWidth = 5;
        for (let k = 0; k < 18; k++) {
          const a0 = (k / 18) * Math.PI * 2;
          const a1 = a0 + (Math.PI * 2) / 36;
          g.beginPath();
          g.arc(cx, cy, s * 0.365, a0, a1);
          g.stroke();
        }
      };

      paintRoundabout(loadedRoadAlbedoImg ?? undefined);
      const tex = new THREE.CanvasTexture(c);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.minFilter = THREE.LinearMipmapLinearFilter;
      tex.magFilter = THREE.LinearFilter;
      tex.anisotropy = 4;

      if (!loadedRoadAlbedoImg && roadTexLoader) {
        roadAlbedoListeners.push((img) => {
          paintRoundabout(img);
          tex.needsUpdate = true;
        });
      }
      return tex;
    };

    const makeSidewalkPaverTex = () => {
      const s = 512;
      const c = document.createElement("canvas");
      c.width = c.height = s;
      const g = c.getContext("2d")!;
      g.fillStyle = "#a5abb2";
      g.fillRect(0, 0, s, s);
      const cols = 4;
      const rows = 4;
      const cw = s / cols;
      const ch = s / rows;
      for (let r = 0; r < rows; r++) {
        for (let col = 0; col < cols; col++) {
          const shade = ((r * 7 + col * 13) % 5) - 2;
          const v = 166 + shade * 4;
          g.fillStyle = `rgb(${v}, ${v + 3}, ${v + 7})`;
          g.fillRect(col * cw + 2, r * ch + 2, cw - 4, ch - 4);
        }
      }
      g.strokeStyle = "rgba(45, 50, 58, 0.36)";
      g.lineWidth = 2;
      for (let i = 0; i <= cols; i++) {
        g.beginPath();
        g.moveTo(i * cw, 0);
        g.lineTo(i * cw, s);
        g.stroke();
      }
      for (let i = 0; i <= rows; i++) {
        g.beginPath();
        g.moveTo(0, i * ch);
        g.lineTo(s, i * ch);
        g.stroke();
      }
      const tex = new THREE.CanvasTexture(c);
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
      tex.colorSpace = THREE.SRGBColorSpace;
      return tex;
    };

    const roadMatCache = new Map<string, THREE.MeshStandardMaterial>();
    const junctionAsphaltMat = this.attachWeatherShader(
      new THREE.MeshStandardMaterial({
        map: makeAsphaltTex(1, 3.5, 0.3, 0, 7.6, false, false, false),
        normalMap: getAsphaltNormalMap(14, 14),
        normalScale: new THREE.Vector2(0.58, 0.58),
        color: 0xffffff,
        roughness: 0.94,
        metalness: 0.02,
        polygonOffset: true,
        polygonOffsetFactor: -3,
        polygonOffsetUnits: -3,
      }),
    );
    const roundaboutAsphaltMat = this.attachWeatherShader(
      new THREE.MeshStandardMaterial({
        map: makeRoundaboutTex(),
        normalMap: getAsphaltNormalMap(32, 32),
        normalScale: new THREE.Vector2(0.58, 0.58),
        color: 0xffffff,
        roughness: 0.94,
        metalness: 0.02,
        polygonOffset: true,
        polygonOffsetFactor: -3,
        polygonOffsetUnits: -3,
      }),
    );
    this.asphaltMaterials.push(junctionAsphaltMat, roundaboutAsphaltMat);
    const sidewalkMat = this.attachWeatherShader(
      new THREE.MeshStandardMaterial({
        map: makeSidewalkPaverTex(),
        color: 0xffffff,
        roughness: 0.88,
        metalness: 0.03,
      }),
      { isSidewalk: true },
    );
    const curbMat = new THREE.MeshStandardMaterial({ color: 0x767c84, roughness: 0.82, metalness: 0.06 });
    const medianMat = new THREE.MeshStandardMaterial({ color: 0x828890, roughness: 0.84, metalness: 0.04 });
    const crosswalkMat = new THREE.MeshStandardMaterial({
      color: 0xe6eaef,
      roughness: 0.78,
      metalness: 0.02,
      polygonOffset: true,
      polygonOffsetFactor: -4,
      polygonOffsetUnits: -4,
    });
    const deckMat = new THREE.MeshStandardMaterial({ color: 0x6f747b, roughness: 0.86, metalness: 0.08 });
    const parapetMat = new THREE.MeshStandardMaterial({ color: 0x8a8f96, roughness: 0.82, metalness: 0.1 });
    const pierMat = new THREE.MeshStandardMaterial({ color: 0x5d6268, roughness: 0.9, metalness: 0.06 });

    const getRoadMat = (seg: CompiledRoadSegment) => {
      const key = `${seg.lanesPerDir}|${seg.laneWidth}|${seg.shoulder}|${seg.medianWidth}|${seg.hasMedian}|${!!seg.spec.isOneWay}`;
      let mat = roadMatCache.get(key);
      if (!mat) {
        mat = this.attachWeatherShader(
          new THREE.MeshStandardMaterial({
            map: makeAsphaltTex(
              seg.lanesPerDir,
              seg.laneWidth,
              seg.shoulder,
              seg.medianWidth,
              seg.carriagewayWidth,
              seg.hasMedian,
              !!seg.spec.isOneWay,
              true,
            ),
            normalMap: getAsphaltNormalMap(seg.carriagewayWidth, 16.0),
            normalScale: new THREE.Vector2(0.58, 0.58),
            color: 0xffffff,
            roughness: 0.94,
            metalness: 0.02,
            polygonOffset: true,
            polygonOffsetFactor: -1,
            polygonOffsetUnits: -1,
          }),
          { isRibbon: true },
        );
        roadMatCache.set(key, mat);
        this.asphaltMaterials.push(mat);
      }
      return mat;
    };

    // --- 1. Detect all unified at-grade intersections (nodes + 2D road crossings) ---
    interface JunctionHub {
      x: number;
      y: number;
      z: number;
      r: number;
      isRoundabout: boolean;
    }
    const hubs: JunctionHub[] = [];
    const roundabouts = Array.from(this.nodes.values()).filter((n) => n.kind === "roundabout");

    for (const node of this.nodes.values()) {
      if (node.kind === "roundabout") {
        const rbR = node.radius ?? 18;
        hubs.push({ x: node.x, y: node.y, z: node.z, r: rbR + 7.2, isRoundabout: true });
      } else if (node.kind === "signal" || node.kind === "yield" || node.kind === "merge") {
        let maxHalf = 5.5;
        for (const seg of this.segments) {
          if (seg.spec.startNodeId === node.id || seg.spec.endNodeId === node.id) {
            maxHalf = Math.max(maxHalf, seg.carriagewayWidth * 0.5);
          }
        }
        hubs.push({ x: node.x, y: node.y, z: node.z, r: maxHalf + 2.4, isRoundabout: false });
      }
    }

    // Also find mid-segment 2D crossings between distinct non-bridge segments
    const groundSegs = this.segments.filter((s) => !s.spec.isBridge);
    const addOrMergeHub = (hx: number, hy: number, hz: number, hr: number) => {
      for (const h of hubs) {
        if ((h.x - hx) * (h.x - hx) + (h.z - hz) * (h.z - hz) < 16 * 16) {
          if (!h.isRoundabout) h.r = Math.max(h.r, hr);
          return;
        }
      }
      hubs.push({ x: hx, y: hy, z: hz, r: hr, isRoundabout: false });
    };

    for (let i = 0; i < groundSegs.length; i++) {
      const a = groundSegs[i];
      for (let j = i + 1; j < groundSegs.length; j++) {
        const b = groundSegs[j];
        if (
          a.bounds.maxX < b.bounds.minX ||
          a.bounds.minX > b.bounds.maxX ||
          a.bounds.maxZ < b.bounds.minZ ||
          a.bounds.minZ > b.bounds.maxZ
        ) {
          continue;
        }
        for (let ia = 0; ia < a.samples.length - 1; ia++) {
          const p1 = a.samples[ia];
          const p2 = a.samples[ia + 1];
          for (let ib = 0; ib < b.samples.length - 1; ib++) {
            const p3 = b.samples[ib];
            const p4 = b.samples[ib + 1];
            const den = (p1.x - p2.x) * (p3.z - p4.z) - (p1.z - p2.z) * (p3.x - p4.x);
            if (Math.abs(den) < 1e-4) continue;
            const t = ((p1.x - p3.x) * (p3.z - p4.z) - (p1.z - p3.z) * (p3.x - p4.x)) / den;
            const u = -((p1.x - p2.x) * (p1.z - p3.z) - (p1.z - p2.z) * (p1.x - p3.x)) / den;
            if (t >= 0 && t <= 1 && u >= 0 && u <= 1) {
              const ix = p1.x + t * (p2.x - p1.x);
              const iz = p1.z + t * (p2.z - p1.z);
              const iy = (p1.y + t * (p2.y - p1.y) + p3.y + u * (p4.y - p3.y)) * 0.5;
              const hr = Math.max(a.carriagewayWidth, b.carriagewayWidth) * 0.5 + 2.2;
              addOrMergeHub(ix, iy, iz, hr);
            }
          }
        }
      }
    }

    // Helper: check if a sidewalk/curb sample lies inside a crossing non-bridge road or junction hub
    const pointInsideOtherRoad = (x: number, z: number, ownerSeg: CompiledRoadSegment): boolean => {
      for (const h of hubs) {
        const dx = x - h.x;
        const dz = z - h.z;
        if (dx * dx + dz * dz < (h.r - 0.35) * (h.r - 0.35)) return true;
      }
      if (!ownerSeg.spec.isBridge) {
        for (const other of groundSegs) {
          if (other === ownerSeg) continue;
          if (
            x < other.bounds.minX - other.carriagewayWidth ||
            x > other.bounds.maxX + other.carriagewayWidth ||
            z < other.bounds.minZ - other.carriagewayWidth ||
            z > other.bounds.maxZ + other.carriagewayWidth
          ) {
            continue;
          }
          const padHalf = other.carriagewayWidth * 0.5 + 0.45;
          const pad2 = padHalf * padHalf;
          for (let k = 0; k < other.samples.length - 1; k++) {
            const sa = other.samples[k];
            const sb = other.samples[k + 1];
            const abx = sb.x - sa.x;
            const abz = sb.z - sa.z;
            const len2 = abx * abx + abz * abz;
            let u = 0;
            if (len2 > 1e-6) {
              u = ((x - sa.x) * abx + (z - sa.z) * abz) / len2;
              if (u < 0) u = 0;
              else if (u > 1) u = 1;
            }
            const dx = x - (sa.x + abx * u);
            const dz = z - (sa.z + abz * u);
            if (dx * dx + dz * dz < pad2) return true;
          }
        }
      }
      return false;
    };

    // --- 2. Build road carriageways, clipped paver sidewalks + granite curbs, and bridges ---
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
        const vCoord = sp.s / 16.0;
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

      // Raised 3D concrete median island along divided non-bridge arterials & freeways
      if (seg.hasMedian && seg.medianWidth > 0.4 && !seg.spec.isBridge) {
        const medHalf = Math.max(0.22, seg.medianWidth * 0.5 - 0.14);
        let medRun: RoadSample[] = [];
        const flushMed = () => {
          if (medRun.length < 2) {
            medRun = [];
            return;
          }
          const medMesh = this.buildSideRibbonBox(medRun, -medHalf, medHalf, 0.26, -0.1, medianMat, true, true);
          medMesh.receiveShadow = true;
          medMesh.userData.kind = "concrete";
          group.add(medMesh);
          collidersOut?.push(medMesh);
          medRun = [];
        };
        for (let i = 0; i < n; i++) {
          const sp = seg.samples[i];
          if (pointInsideOtherRoad(sp.x, sp.z, seg)) flushMed();
          else medRun.push(sp);
        }
        flushMed();
      }

      // Raised brushed-concrete sidewalks + granite curb borders, cleanly clipped & ramped at intersections!
      if (seg.hasSidewalk && seg.sidewalkWidth > 0) {
        const curbW = 0.26;
        for (const side of [-1, 1] as const) {
          const inner = halfC;
          const curbEdge = halfC + curbW;
          const outer = halfC + seg.sidewalkWidth;
          const checkOff = side * (halfC + Math.min(1.0, seg.sidewalkWidth * 0.4));

          let run: RoadSample[] = [];
          const flushRun = () => {
            if (run.length < 2) {
              run = [];
              return;
            }
            const curbMesh = this.buildSideRibbonBox(run, side * inner, side * curbEdge, 0.39, -0.22, curbMat, true, true);
            curbMesh.receiveShadow = true;
            curbMesh.userData.kind = "concrete";
            group.add(curbMesh);
            collidersOut?.push(curbMesh);

            const swMesh = this.buildSideRibbonBox(run, side * curbEdge, side * outer, 0.39, -0.22, sidewalkMat, true, true);
            swMesh.receiveShadow = true;
            swMesh.userData.kind = "concrete";
            group.add(swMesh);
            collidersOut?.push(swMesh);
            run = [];
          };

          for (let i = 0; i < n; i++) {
            const sp = seg.samples[i];
            const px = sp.x + sp.rx * checkOff;
            const pz = sp.z + sp.rz * checkOff;
            if (pointInsideOtherRoad(px, pz, seg)) {
              flushRun();
            } else {
              run.push(sp);
            }
          }
          flushRun();
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

    // --- 3. Build Unified Intersection Asphalt Pads, Crosswalks & Roundabout Rings ---
    const stripeGeo = new THREE.PlaneGeometry(0.42, 2.2);
    stripeGeo.rotateX(-Math.PI / 2);
    const stopBarGeo = new THREE.PlaneGeometry(1, 0.36);
    stopBarGeo.rotateX(-Math.PI / 2);

    for (const h of hubs) {
      if (h.isRoundabout) continue;
      // Unified asphalt junction disc sitting cleanly over overlapping road ribbons (zero Z-fighting)
      const padGeo = new THREE.CircleGeometry(h.r, 24);
      padGeo.rotateX(-Math.PI / 2);
      const pad = new THREE.Mesh(padGeo, junctionAsphaltMat);
      pad.position.set(h.x, h.y + 0.052, h.z);
      pad.receiveShadow = true;
      pad.userData.kind = "concrete";
      group.add(pad);
      collidersOut?.push(pad);

      // Paint crisp crosswalk zebra bars & stop lines on every entering ground road arm
      const seenAngles: number[] = [];
      for (const seg of groundSegs) {
        if (
          h.x < seg.bounds.minX - h.r - 6 ||
          h.x > seg.bounds.maxX + h.r + 6 ||
          h.z < seg.bounds.minZ - h.r - 6 ||
          h.z > seg.bounds.maxZ + h.r + 6
        ) {
          continue;
        }
        // Check samples just outside junction radius h.r + 0.8..h.r + 3.2
        for (let i = 0; i < seg.samples.length; i++) {
          const sp = seg.samples[i];
          const dx = sp.x - h.x;
          const dz = sp.z - h.z;
          const dist = Math.hypot(dx, dz);
          if (dist < h.r + 0.4 || dist > h.r + 3.4) continue;
          const ang = Math.atan2(dz, dx);
          if (seenAngles.some((a) => Math.abs(Math.atan2(Math.sin(a - ang), Math.cos(a - ang))) < 0.35)) continue;
          seenAngles.push(ang);

          const yaw = Math.atan2(sp.tx, sp.tz);
          const halfC = seg.carriagewayWidth * 0.5 - 0.6;
          for (let off = -halfC + 0.6; off <= halfC - 0.6; off += 1.15) {
            const zebra = new THREE.Mesh(stripeGeo, crosswalkMat);
            zebra.position.set(sp.x + sp.rx * off, sp.y + 0.058, sp.z + sp.rz * off);
            zebra.rotation.y = yaw;
            group.add(zebra);
          }
          // Stop bar slightly outward from crosswalk
          const outSign = dx * sp.tx + dz * sp.tz >= 0 ? 1 : -1;
          const stopBar = new THREE.Mesh(stopBarGeo, crosswalkMat);
          stopBar.scale.x = seg.carriagewayWidth - 0.8;
          stopBar.position.set(sp.x + outSign * sp.tx * 1.65, sp.y + 0.058, sp.z + outSign * sp.tz * 1.65);
          stopBar.rotation.y = yaw;
          group.add(stopBar);
        }
      }
    }

    for (const rb of roundabouts) {
      const rbR = rb.radius ?? 18;
      const innerR = Math.max(4, rbR - 5.5);
      const outerR = rbR + 7.2;

      // Custom UV-mapped roundabout asphalt ring so circular dashed lane markings render cleanly
      const segs = 48;
      const ringPos = new Float32Array((segs + 1) * 2 * 3);
      const ringUv = new Float32Array((segs + 1) * 2 * 2);
      const ringIdx: number[] = [];
      for (let i = 0; i <= segs; i++) {
        const a = (i / segs) * Math.PI * 2;
        const ca = Math.cos(a);
        const sa = Math.sin(a);
        const vi = i * 6;
        ringPos[vi] = rb.x + ca * innerR;
        ringPos[vi + 1] = rb.y + 0.056;
        ringPos[vi + 2] = rb.z + sa * innerR;
        ringPos[vi + 3] = rb.x + ca * outerR;
        ringPos[vi + 4] = rb.y + 0.056;
        ringPos[vi + 5] = rb.z + sa * outerR;

        // Map circle in UV space [0..1] around center (0.5, 0.5)
        const ui = i * 4;
        const rInNorm = (innerR / outerR) * 0.5;
        ringUv[ui] = 0.5 + ca * rInNorm;
        ringUv[ui + 1] = 0.5 + sa * rInNorm;
        ringUv[ui + 2] = 0.5 + ca * 0.5;
        ringUv[ui + 3] = 0.5 + sa * 0.5;

        if (i < segs) {
          const k = i * 2;
          ringIdx.push(k, k + 2, k + 1, k + 1, k + 2, k + 3);
        }
      }
      const ringGeo = new THREE.BufferGeometry();
      ringGeo.setAttribute("position", new THREE.BufferAttribute(ringPos, 3));
      ringGeo.setAttribute("uv", new THREE.BufferAttribute(ringUv, 2));
      ringGeo.setIndex(ringIdx);
      ringGeo.computeVertexNormals();
      const ringMesh = new THREE.Mesh(ringGeo, roundaboutAsphaltMat);
      ringMesh.receiveShadow = true;
      ringMesh.userData.kind = "concrete";
      group.add(ringMesh);
      collidersOut?.push(ringMesh);

      // Solid 3D roundabout granite curb + outer brushed concrete sidewalk collar (clipped at road entrances)
      const collarSamples: RoadSample[] = [];
      const collarSteps = 64;
      const collarMidR = outerR + 1.3;
      for (let i = 0; i <= collarSteps; i++) {
        const a = (i / collarSteps) * Math.PI * 2;
        const ca = Math.cos(a);
        const sa = Math.sin(a);
        collarSamples.push({
          s: i * ((Math.PI * 2 * collarMidR) / collarSteps),
          x: rb.x + ca * collarMidR,
          y: rb.y,
          z: rb.z + sa * collarMidR,
          tx: -sa,
          ty: 0,
          tz: ca,
          rx: ca,
          rz: sa,
        });
      }
      let cRun: RoadSample[] = [];
      const flushCollar = () => {
        if (cRun.length < 2) {
          cRun = [];
          return;
        }
        const rbCurb = this.buildSideRibbonBox(cRun, -1.3, -1.04, 0.39, -0.22, curbMat, true, true);
        rbCurb.receiveShadow = true;
        rbCurb.userData.kind = "concrete";
        group.add(rbCurb);
        collidersOut?.push(rbCurb);

        const rbSw = this.buildSideRibbonBox(cRun, -1.04, 1.35, 0.39, -0.22, sidewalkMat, true, true);
        rbSw.receiveShadow = true;
        rbSw.userData.kind = "concrete";
        group.add(rbSw);
        collidersOut?.push(rbSw);
        cRun = [];
      };
      for (let i = 0; i < collarSamples.length; i++) {
        const sp = collarSamples[i];
        let blocked = false;
        for (const seg of groundSegs) {
          const pad = seg.carriagewayWidth * 0.5 + 0.6;
          const pad2 = pad * pad;
          for (let k = 0; k < seg.samples.length - 1; k++) {
            const sa = seg.samples[k];
            const sb = seg.samples[k + 1];
            const abx = sb.x - sa.x;
            const abz = sb.z - sa.z;
            const len2 = abx * abx + abz * abz;
            let u = 0;
            if (len2 > 1e-6) {
              u = ((sp.x - sa.x) * abx + (sp.z - sa.z) * abz) / len2;
              if (u < 0) u = 0;
              else if (u > 1) u = 1;
            }
            const dx = sp.x - (sa.x + abx * u);
            const dz = sp.z - (sa.z + abz * u);
            if (dx * dx + dz * dz < pad2) {
              blocked = true;
              break;
            }
          }
          if (blocked) break;
        }
        if (blocked) flushCollar();
        else cRun.push(sp);
      }
      flushCollar();
    }

    parent.add(group);
    return group;
  }

  /** Updates road rain puddles, ripple animation, and snow accumulation/tire tracks. */
  setWeatherSurface(wet: number, snowCover: number, timeSec: number): void {
    const w = Math.max(0, Math.min(1, wet));
    const s = Math.max(0, Math.min(1, snowCover));
    this.weatherUniforms.uWet.value = w;
    this.weatherUniforms.uSnowCover.value = s;
    this.weatherUniforms.uWeatherTime.value = timeSec;
    this.setWetness(w);
  }

  /** Shifts asphalt roughness & environment reflectivity smoothly during rain/storms. */
  setWetness(wet: number): void {
    const w = Math.max(0, Math.min(1, wet));
    if (Math.abs(w - this.lastWetness) < 0.015) return;
    this.lastWetness = w;
    const rough = 0.94 - w * 0.68;
    const envMult = 0.75 + w * 0.85;
    for (let i = 0; i < this.asphaltMaterials.length; i++) {
      const m = this.asphaltMaterials[i];
      m.roughness = rough;
      m.envMapIntensity = envMult;
    }
  }

  private buildSideRibbonBox(
    samples: RoadSample[],
    offsetA: number,
    offsetB: number,
    height: number,
    yBaseOffset: number,
    material: THREE.Material,
    withUVs = false,
    taperEnds = false,
  ): THREE.Mesh {
    const n = samples.length;
    const minO = Math.min(offsetA, offsetB);
    const maxO = Math.max(offsetA, offsetB);
    const width = Math.max(0.05, maxO - minO);
    const tileScale = 1.6;

    // Split vertices per face (top, left side, right side, start cap, end cap) so normals are crisp 90° edges!
    const pos: number[] = [];
    const norm: number[] = [];
    const uv: number[] = [];
    const indices: number[] = [];

    const yTopAt = (i: number, sp: RoadSample): number => {
      let h = height;
      if (taperEnds && n >= 3) {
        if (i === 0 || i === n - 1) h = Math.max(0.06, height - 0.115);
      }
      return sp.y + yBaseOffset + h;
    };

    // 1. Top face (2 verts per sample, pure +Y normal, square metric UVs)
    const topBase = 0;
    for (let i = 0; i < n; i++) {
      const sp = samples[i];
      const y1 = yTopAt(i, sp);
      pos.push(
        sp.x + sp.rx * minO, y1, sp.z + sp.rz * minO,
        sp.x + sp.rx * maxO, y1, sp.z + sp.rz * maxO,
      );
      norm.push(0, 1, 0, 0, 1, 0);
      if (withUVs) {
        const v = sp.s / tileScale;
        uv.push(0, v, width / tileScale, v);
      }
      if (i < n - 1) {
        const a = topBase + i * 2;
        const b = a + 2;
        indices.push(a, a + 1, b, a + 1, b + 1, b);
      }
    }

    // 2. Left (minO) vertical side face
    const leftBase = pos.length / 3;
    for (let i = 0; i < n; i++) {
      const sp = samples[i];
      const y0 = sp.y + yBaseOffset;
      const y1 = yTopAt(i, sp);
      const ax = sp.x + sp.rx * minO;
      const az = sp.z + sp.rz * minO;
      pos.push(ax, y0, az, ax, y1, az);
      norm.push(-sp.rx, 0, -sp.rz, -sp.rx, 0, -sp.rz);
      if (withUVs) {
        const v = sp.s / tileScale;
        uv.push(0, v, 0.25, v);
      }
      if (i < n - 1) {
        const a = leftBase + i * 2;
        const b = a + 2;
        indices.push(a, a + 1, b, a + 1, b + 1, b);
      }
    }

    // 3. Right (maxO) vertical side face
    const rightBase = pos.length / 3;
    for (let i = 0; i < n; i++) {
      const sp = samples[i];
      const y0 = sp.y + yBaseOffset;
      const y1 = yTopAt(i, sp);
      const bx = sp.x + sp.rx * maxO;
      const bz = sp.z + sp.rz * maxO;
      pos.push(bx, y1, bz, bx, y0, bz);
      norm.push(sp.rx, 0, sp.rz, sp.rx, 0, sp.rz);
      if (withUVs) {
        const v = sp.s / tileScale;
        uv.push(0.25, v, 0, v);
      }
      if (i < n - 1) {
        const a = rightBase + i * 2;
        const b = a + 2;
        indices.push(a, a + 1, b, a + 1, b + 1, b);
      }
    }

    // 4. Start & end solid vertical caps
    const addCap = (sp: RoadSample, idx: number, flip: boolean) => {
      const y0 = sp.y + yBaseOffset;
      const y1 = yTopAt(idx, sp);
      const ax = sp.x + sp.rx * minO;
      const az = sp.z + sp.rz * minO;
      const bx = sp.x + sp.rx * maxO;
      const bz = sp.z + sp.rz * maxO;
      const base = pos.length / 3;
      const nx = flip ? sp.tx : -sp.tx;
      const nz = flip ? sp.tz : -sp.tz;
      pos.push(ax, y0, az, bx, y0, bz, bx, y1, bz, ax, y1, az);
      norm.push(nx, 0, nz, nx, 0, nz, nx, 0, nz, nx, 0, nz);
      if (withUVs) uv.push(0, 0, 1, 0, 1, 1, 0, 1);
      if (flip) indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
      else indices.push(base, base + 2, base + 1, base, base + 3, base + 2);
    };
    if (n >= 2) {
      addCap(samples[0], 0, false);
      addCap(samples[n - 1], n - 1, true);
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute("normal", new THREE.Float32BufferAttribute(norm, 3));
    if (withUVs) geo.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
    geo.setIndex(indices);
    return new THREE.Mesh(geo, material);
  }
}
