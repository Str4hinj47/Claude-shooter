import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { RoadNetwork, RoadNodeSpec } from "./RoadNetwork";
import type { TerrainHeightFn } from "./HeightSystem";
import type { SpatialAABBGrid } from "./SpatialIndex";
import type { WestgateTeleportSpot } from "./WestgateWorld";

export type SignalAspect = "green" | "amber" | "red";

const CYCLE_SEC = 24.0;
const GREEN_SEC = 9.2;
const AMBER_SEC = 2.4;
const CLEAR_SEC = 0.4; // All-red clearance before cross-street turns green
const HALF_CYCLE = GREEN_SEC + AMBER_SEC + CLEAR_SEC; // 12.0s

function createSpeedLimitTexture(limitMph: number): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 128;
  c.height = 160;
  const g = c.getContext("2d")!;
  g.fillStyle = "#f4f6f8";
  g.fillRect(0, 0, 128, 160);
  g.strokeStyle = "#111827";
  g.lineWidth = 6;
  g.strokeRect(6, 6, 116, 148);
  g.fillStyle = "#111827";
  g.font = "bold 20px sans-serif";
  g.textAlign = "center";
  g.fillText("SPEED", 64, 38);
  g.fillText("LIMIT", 64, 60);
  g.font = "bold 58px sans-serif";
  g.fillText(String(limitMph), 64, 126);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 16;
  return tex;
}

function createDiamondSignTexture(kind: "ped" | "yield"): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 128;
  c.height = 128;
  const g = c.getContext("2d")!;
  if (kind === "ped") {
    g.fillStyle = "#f59e0b";
    g.fillRect(0, 0, 128, 128);
    g.strokeStyle = "#111827";
    g.lineWidth = 6;
    g.strokeRect(8, 8, 112, 112);
    g.fillStyle = "#111827";
    g.font = "bold 22px sans-serif";
    g.textAlign = "center";
    g.fillText("PED", 64, 54);
    g.fillText("XING", 64, 84);
  } else {
    g.fillStyle = "#f8fafc";
    g.fillRect(0, 0, 128, 128);
    g.strokeStyle = "#dc2626";
    g.lineWidth = 10;
    g.strokeRect(10, 10, 108, 108);
    g.fillStyle = "#dc2626";
    g.font = "bold 24px sans-serif";
    g.textAlign = "center";
    g.fillText("YIELD", 64, 72);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 16;
  return tex;
}

interface PhaseMaterialSet {
  nsRed: THREE.MeshStandardMaterial;
  nsAmber: THREE.MeshStandardMaterial;
  nsGreen: THREE.MeshStandardMaterial;
  ewRed: THREE.MeshStandardMaterial;
  ewAmber: THREE.MeshStandardMaterial;
  ewGreen: THREE.MeshStandardMaterial;
}

/**
 * Coordinates live intersection traffic-light phases, dynamic 3D signal bulbs,
 * and regulatory Speed Limit / Yield / Ped-Xing street signage across Westgate Bay.
 */
export class TrafficSignalManager {
  readonly group = new THREE.Group();
  private readonly nodePhase = new Map<string, number>();
  private readonly signalNodes: RoadNodeSpec[] = [];
  private readonly phaseSets: PhaseMaterialSet[] = [];
  private elapsed = 0;

  constructor(
    roads: RoadNetwork,
    terrainAt: TerrainHeightFn,
    teleports: readonly WestgateTeleportSpot[],
    spatialAABBs?: SpatialAABBGrid,
  ) {
    this.group.name = "WestgateTrafficSignalsAndSigns";

    // Collect all signalized intersections & assign 4 staggered phase offsets
    const nodes = roads.getNodes().filter((n) => n.kind === "signal");
    nodes.forEach((n, idx) => {
      this.signalNodes.push(n);
      this.nodePhase.set(n.id, idx % 4);
    });

    // Build 4 phase-offset material sets (only 24 materials for all intersections citywide)
    for (let p = 0; p < 4; p++) {
      const makeBulbMat = (color: number) =>
        new THREE.MeshStandardMaterial({
          color: 0x151920,
          emissive: color,
          emissiveIntensity: 0.05,
          roughness: 0.25,
          metalness: 0.15,
        });
      this.phaseSets.push({
        nsRed: makeBulbMat(0xff2424),
        nsAmber: makeBulbMat(0xffaa00),
        nsGreen: makeBulbMat(0x22ef68),
        ewRed: makeBulbMat(0xff2424),
        ewAmber: makeBulbMat(0xffaa00),
        ewGreen: makeBulbMat(0x22ef68),
      });
    }

    this.buildSignalBulbs(terrainAt);
    this.buildRegulatorySigns(roads, terrainAt, teleports, spatialAABBs);
    this.syncMaterials();
  }

  private phaseAspects(phaseIdx: number): { ns: SignalAspect; ew: SignalAspect } {
    const t = (this.elapsed + phaseIdx * 6.0) % CYCLE_SEC;
    if (t < GREEN_SEC) return { ns: "green", ew: "red" };
    if (t < GREEN_SEC + AMBER_SEC) return { ns: "amber", ew: "red" };
    if (t < HALF_CYCLE) return { ns: "red", ew: "red" };
    if (t < HALF_CYCLE + GREEN_SEC) return { ns: "red", ew: "green" };
    if (t < HALF_CYCLE + GREEN_SEC + AMBER_SEC) return { ns: "red", ew: "amber" };
    return { ns: "red", ew: "red" };
  }

  /**
   * Returns current signal color seen by a vehicle heading along (headingX, headingZ)
   * into signal node `nodeId`.
   */
  getSignalForHeading(nodeId: string, headingX: number, headingZ: number): SignalAspect {
    const phaseIdx = this.nodePhase.get(nodeId);
    if (phaseIdx === undefined) return "green";
    const { ns, ew } = this.phaseAspects(phaseIdx);
    return Math.abs(headingZ) >= Math.abs(headingX) ? ns : ew;
  }

  /**
   * Returns true when pedestrians crossing along axis (crossX, crossZ) have a safe Walk phase.
   */
  canPedestrianCross(nodeId: string, crossX: number, crossZ: number): boolean {
    const phaseIdx = this.nodePhase.get(nodeId);
    if (phaseIdx === undefined) return true;
    const { ns, ew } = this.phaseAspects(phaseIdx);
    // Pedestrians crossing parallel to N-S streets walk when N-S is green
    return Math.abs(crossZ) >= Math.abs(crossX) ? ns === "green" : ew === "green";
  }

  getNearestSignalNode(x: number, z: number, maxDist = 24): RoadNodeSpec | null {
    let best: RoadNodeSpec | null = null;
    let bestD2 = maxDist * maxDist;
    for (let i = 0; i < this.signalNodes.length; i++) {
      const n = this.signalNodes[i];
      const dx = n.x - x;
      const dz = n.z - z;
      const d2 = dx * dx + dz * dz;
      if (d2 < bestD2) {
        bestD2 = d2;
        best = n;
      }
    }
    return best;
  }

  update(dt: number): void {
    this.elapsed += Math.min(Math.max(dt, 0), 0.1);
    this.syncMaterials();
  }

  private syncMaterials(): void {
    for (let p = 0; p < 4; p++) {
      const { ns, ew } = this.phaseAspects(p);
      const set = this.phaseSets[p];
      set.nsRed.emissiveIntensity = ns === "red" ? 2.6 : 0.04;
      set.nsAmber.emissiveIntensity = ns === "amber" ? 2.6 : 0.04;
      set.nsGreen.emissiveIntensity = ns === "green" ? 2.6 : 0.04;
      set.ewRed.emissiveIntensity = ew === "red" ? 2.6 : 0.04;
      set.ewAmber.emissiveIntensity = ew === "amber" ? 2.6 : 0.04;
      set.ewGreen.emissiveIntensity = ew === "green" ? 2.6 : 0.04;
    }
  }

  private buildSignalBulbs(terrainAt: TerrainHeightFn): void {
    const housingMat = new THREE.MeshStandardMaterial({ color: 0x1a1f26, roughness: 0.55, metalness: 0.72 });
    const housingGeos: THREE.BufferGeometry[] = [];
    const buckets: Array<{
      nsR: THREE.BufferGeometry[];
      nsA: THREE.BufferGeometry[];
      nsG: THREE.BufferGeometry[];
      ewR: THREE.BufferGeometry[];
      ewA: THREE.BufferGeometry[];
      ewG: THREE.BufferGeometry[];
    }> = Array.from({ length: 4 }, () => ({
      nsR: [],
      nsA: [],
      nsG: [],
      ewR: [],
      ewA: [],
      ewG: [],
    }));

    // Mount dual-sided signal pods on the 4 mast arms around every signalized intersection
    for (const node of this.signalNodes) {
      const pIdx = this.nodePhase.get(node.id) ?? 0;
      const b = buckets[pIdx];
      // N/S facing approach pods at x = ±4.5, z = ±11.2; E/W facing pods at x = ±11.2, z = ±4.5
      const pods: Array<{ x: number; z: number; axis: "ns" | "ew" }> = [
        { x: -4.2, z: 11.4, axis: "ns" },
        { x: 4.2, z: -11.4, axis: "ns" },
        { x: 11.4, z: 4.2, axis: "ew" },
        { x: -11.4, z: -4.2, axis: "ew" },
      ];
      for (const pod of pods) {
        const px = node.x + pod.x;
        const pz = node.z + pod.z;
        const gy = Math.max(node.y, terrainAt(px, pz));
        const ry = pod.axis === "ns" ? 0 : Math.PI * 0.5;
        const box = new THREE.BoxGeometry(0.46, 1.24, 0.36);
        box.rotateY(ry);
        box.translate(px, gy + 5.25, pz);
        housingGeos.push(box);

        // Two-sided lenses (front & back of pod) so incoming & cross-view both read clearly
        for (const faceZ of [-0.19, 0.19]) {
          const addLens = (arr: THREE.BufferGeometry[], dy: number) => {
            const g = new THREE.SphereGeometry(0.115, 8, 6);
            g.scale(1, 1, 0.45);
            g.translate(0, dy, faceZ);
            g.rotateY(ry);
            g.translate(px, gy + 5.25, pz);
            arr.push(g);
          };
          if (pod.axis === "ns") {
            addLens(b.nsR, 0.34);
            addLens(b.nsA, 0.0);
            addLens(b.nsG, -0.34);
          } else {
            addLens(b.ewR, 0.34);
            addLens(b.ewA, 0.0);
            addLens(b.ewG, -0.34);
          }
        }
      }
    }

    if (housingGeos.length > 0) {
      const merged = mergeGeometries(housingGeos, false);
      if (merged) {
        const m = new THREE.Mesh(merged, housingMat);
        m.castShadow = true;
        this.group.add(m);
      }
    }
    for (let p = 0; p < 4; p++) {
      const b = buckets[p];
      const s = this.phaseSets[p];
      const addPart = (arr: THREE.BufferGeometry[], mat: THREE.Material) => {
        if (arr.length === 0) return;
        const merged = mergeGeometries(arr, false);
        if (merged) this.group.add(new THREE.Mesh(merged, mat));
      };
      addPart(b.nsR, s.nsRed);
      addPart(b.nsA, s.nsAmber);
      addPart(b.nsG, s.nsGreen);
      addPart(b.ewR, s.ewRed);
      addPart(b.ewA, s.ewAmber);
      addPart(b.ewG, s.ewGreen);
    }
  }

  private buildRegulatorySigns(
    roads: RoadNetwork,
    terrainAt: TerrainHeightFn,
    teleports: readonly WestgateTeleportSpot[],
    spatialAABBs?: SpatialAABBGrid,
  ): void {
    const postMat = new THREE.MeshStandardMaterial({ color: 0x94a3b8, roughness: 0.38, metalness: 0.82 });
    const backMat = new THREE.MeshStandardMaterial({ color: 0x64748b, roughness: 0.5, metalness: 0.65 });
    const signMats = new Map<string, THREE.MeshStandardMaterial>([
      ["25", new THREE.MeshStandardMaterial({ map: createSpeedLimitTexture(25), roughness: 0.42, metalness: 0.08 })],
      ["35", new THREE.MeshStandardMaterial({ map: createSpeedLimitTexture(35), roughness: 0.42, metalness: 0.08 })],
      ["45", new THREE.MeshStandardMaterial({ map: createSpeedLimitTexture(45), roughness: 0.42, metalness: 0.08 })],
      ["65", new THREE.MeshStandardMaterial({ map: createSpeedLimitTexture(65), roughness: 0.42, metalness: 0.08 })],
      ["ped", new THREE.MeshStandardMaterial({ map: createDiamondSignTexture("ped"), roughness: 0.45, metalness: 0.05 })],
      ["yield", new THREE.MeshStandardMaterial({ map: createDiamondSignTexture("yield"), roughness: 0.45, metalness: 0.05 })],
    ]);

    const postGeos: THREE.BufferGeometry[] = [];
    const backGeos: THREE.BufferGeometry[] = [];
    const faceBuckets = new Map<string, THREE.BufferGeometry[]>([
      ["25", []],
      ["35", []],
      ["45", []],
      ["65", []],
      ["ped", []],
      ["yield", []],
    ]);

    const isNearTeleport = (x: number, z: number) =>
      teleports.some((tp) => (tp.x - x) * (tp.x - x) + (tp.z - z) * (tp.z - z) < 7.5 * 7.5);
    const placed = new Set<string>();

    const placeSign = (
      x: number,
      z: number,
      y: number,
      ry: number,
      kind: string,
      w = 0.68,
      h = 0.86,
      diamond = false,
    ) => {
      const k = `${Math.round(x / 6)},${Math.round(z / 6)}`;
      if (placed.has(k) || isNearTeleport(x, z)) return;
      placed.add(k);

      const post = new THREE.CylinderGeometry(0.045, 0.055, 2.7, 6);
      post.translate(x, y + 1.35, z);
      postGeos.push(post);

      const back = new THREE.BoxGeometry(w, h, 0.04);
      if (diamond) back.rotateZ(Math.PI * 0.25);
      back.rotateY(ry);
      back.translate(x, y + 2.55, z);
      backGeos.push(back);

      const face = new THREE.PlaneGeometry(w * 0.96, h * 0.96);
      if (diamond) face.rotateZ(Math.PI * 0.25);
      face.translate(0, 0, 0.025);
      face.rotateY(ry);
      face.translate(x, y + 2.55, z);
      faceBuckets.get(kind)?.push(face);

      if (spatialAABBs) {
        spatialAABBs.insert(
          new THREE.Box3(new THREE.Vector3(x - 0.14, y, z - 0.14), new THREE.Vector3(x + 0.14, y + 2.7, z + 0.14)),
        );
      }
    };

    // Place Speed Limit signs along right curbs of Freeway (65), Arterial (45), Collector (35), Local (25)
    for (const seg of roads.getSegments()) {
      if (seg.spec.isBridge || seg.spec.tier === "ramp" || seg.samples.length < 6) continue;
      const limitKey =
        seg.spec.tier === "freeway"
          ? "65"
          : seg.spec.tier === "arterial"
            ? "45"
            : seg.spec.tier === "collector"
              ? "35"
              : "25";
      const halfW = seg.totalWidth * 0.5;
      const intervals = seg.length > 180 ? [0.22, 0.72] : [0.35];
      for (const frac of intervals) {
        const idx = Math.min(seg.samples.length - 2, Math.max(1, Math.floor(frac * seg.samples.length)));
        const sp = seg.samples[idx];
        for (const side of [1, -1] as const) {
          const sx = sp.x + sp.rx * (halfW + 0.75) * side;
          const sz = sp.z + sp.rz * (halfW + 0.75) * side;
          const gy = terrainAt(sx, sz);
          if (gy < 2.0) continue;
          const inf = roads.getRoadInfluence(sx, sz, 14, true);
          if (inf && inf.edgeDist < 0.35) continue;
          // Face oncoming traffic on that side of the road
          const faceYaw = Math.atan2(-sp.tx * side, -sp.tz * side);
          placeSign(sx, sz, gy, faceYaw, limitKey);
        }
      }
    }

    // Place Ped-Xing & Yield signs near signalized crosswalks & roundabout approaches
    const nodeById = new Map(roads.getNodes().map((n) => [n.id, n]));
    for (const seg of roads.getSegments()) {
      if (seg.spec.isBridge || seg.spec.tier === "freeway" || seg.samples.length < 4) continue;
      const endN = seg.spec.endNodeId ? nodeById.get(seg.spec.endNodeId) : undefined;
      if (endN && (endN.kind === "signal" || endN.kind === "roundabout")) {
        const sp = seg.samples[Math.max(1, seg.samples.length - 3)];
        const sx = sp.x + sp.rx * (seg.totalWidth * 0.5 + 0.75);
        const sz = sp.z + sp.rz * (seg.totalWidth * 0.5 + 0.75);
        const gy = terrainAt(sx, sz);
        if (gy >= 2.0) {
          const inf = roads.getRoadInfluence(sx, sz, 14, true);
          if (!inf || inf.edgeDist >= 0.35) {
            placeSign(
              sx,
              sz,
              gy,
              Math.atan2(-sp.tx, -sp.tz),
              endN.kind === "roundabout" ? "yield" : "ped",
              0.66,
              0.66,
              endN.kind === "signal",
            );
          }
        }
      }
    }

    if (postGeos.length > 0) {
      const m = new THREE.Mesh(mergeGeometries(postGeos, false), postMat);
      m.castShadow = true;
      this.group.add(m);
    }
    if (backGeos.length > 0) {
      const m = new THREE.Mesh(mergeGeometries(backGeos, false), backMat);
      m.castShadow = true;
      this.group.add(m);
    }
    for (const [kind, list] of faceBuckets) {
      if (list.length === 0) continue;
      const merged = mergeGeometries(list, false);
      if (merged) this.group.add(new THREE.Mesh(merged, signMats.get(kind)!));
    }
  }
}
