import type { RoadNetwork, RoadTier } from "./RoadNetwork";
import { coastLineX, riverCenterX } from "./WestgateTerrain";

export interface MinimapRoadPolyline {
  id: string;
  tier: RoadTier;
  width: number;
  isBridge: boolean;
  pts: [number, number][]; // [x, z] in world metres
}

export interface MinimapRoundabout {
  id: string;
  x: number;
  z: number;
  innerR: number;
  outerR: number;
}

export interface MinimapData {
  roads: MinimapRoadPolyline[];
  roundabouts: MinimapRoundabout[];
  coastPolygon: [number, number][];
  riverPolyline: [number, number][];
  defaultLoop: [number, number][];
  scenicCoral: [number, number][];
  nodes: { id: string; x: number; z: number }[];
  adj: Map<string, { to: string; segId: string; reverse: boolean; len: number }[]>;
  segPts: Map<string, [number, number][]>;
}

function sampleSegment2D(pts: { x: number; z: number }[], step = 3): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i < pts.length; i += step) {
    out.push([pts[i].x, pts[i].z]);
  }
  const last = pts[pts.length - 1];
  if (last && (out.length === 0 || out[out.length - 1][0] !== last.x || out[out.length - 1][1] !== last.z)) {
    out.push([last.x, last.z]);
  }
  return out;
}

/** Builds vector minimap road geometry, water features, and shortest-path GPS graph from RoadNetwork. */
export function buildMinimapData(roads: RoadNetwork): MinimapData {
  const compiled = roads.getSegments();
  const roadNodes = roads.getNodes();

  const roadLines: MinimapRoadPolyline[] = [];
  const segPts = new Map<string, [number, number][]>();
  const adj = new Map<string, { to: string; segId: string; reverse: boolean; len: number }[]>();

  for (const n of roadNodes) {
    adj.set(n.id, []);
  }

  for (const seg of compiled) {
    const pts = sampleSegment2D(seg.samples, 3);
    roadLines.push({
      id: seg.spec.id,
      tier: seg.spec.tier,
      width: seg.carriagewayWidth,
      isBridge: !!seg.spec.isBridge,
      pts,
    });
    segPts.set(seg.spec.id, pts);

    const a = seg.spec.startNodeId;
    const b = seg.spec.endNodeId;
    if (a && b && adj.has(a) && adj.has(b)) {
      adj.get(a)!.push({ to: b, segId: seg.spec.id, reverse: false, len: seg.length });
      if (!seg.spec.isOneWay) {
        adj.get(b)!.push({ to: a, segId: seg.spec.id, reverse: true, len: seg.length });
      }
    }
  }

  const roundabouts: MinimapRoundabout[] = roadNodes
    .filter((n) => n.kind === "roundabout")
    .map((n) => {
      const r = n.radius ?? 18;
      return {
        id: n.id,
        x: n.x,
        z: n.z,
        innerR: Math.max(4, r - 5.5),
        outerR: r + 7.0,
      };
    });

  // Pacific Ocean western shoreline polygon
  const coastPolygon: [number, number][] = [[-1400, -1300]];
  for (let z = -1260; z <= 1260; z += 40) {
    coastPolygon.push([coastLineX(z), z]);
  }
  coastPolygon.push([-1400, 1300]);

  // Westgate River sinuous centerline
  const riverPolyline: [number, number][] = [];
  for (let z = -1220; z <= 520; z += 40) {
    riverPolyline.push([riverCenterX(z), z]);
  }

  // Default scenic GPS loop passing through Downtown spawn (24, -82) -> Midtown -> Old Quarter -> Airport -> Bay Bridge -> Downtown
  const defaultLoop = stitchNodeLoop(
    ["rb_legion", "rb_midtown", "rb_oldquarter", "n_dt_airport_link", "n_fw_south_jct", "n_fw_east_port", "rb_industrial", "rb_legion"],
    adj,
    segPts,
  );

  // Coral dashed scenic coastal & canyon trail
  const scenicCoral = stitchNodeLoop(
    ["n_fw_nw", "rb_coast", "n_coast_south", "n_fw_airport"],
    adj,
    segPts,
    false,
  );

  return {
    roads: roadLines,
    roundabouts,
    coastPolygon,
    riverPolyline,
    defaultLoop,
    scenicCoral,
    nodes: roadNodes.map((n) => ({ id: n.id, x: n.x, z: n.z })),
    adj,
    segPts,
  };
}

function stitchNodeLoop(
  waypoints: string[],
  adj: MinimapData["adj"],
  segPts: MinimapData["segPts"],
  close = true,
): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i < waypoints.length - 1; i++) {
    const seg = dijkstraNodes(waypoints[i], waypoints[i + 1], adj, segPts);
    for (let k = 0; k < seg.length; k++) {
      if (out.length > 0 && k === 0) continue;
      out.push(seg[k]);
    }
  }
  if (close && out.length > 2) {
    const first = out[0];
    const last = out[out.length - 1];
    if (Math.hypot(first[0] - last[0], first[1] - last[1]) > 4) {
      out.push([first[0], first[1]]);
    }
  }
  return out;
}

function dijkstraNodes(
  startId: string,
  goalId: string,
  adj: MinimapData["adj"],
  segPts: MinimapData["segPts"],
): [number, number][] {
  if (startId === goalId) return [];
  const dist = new Map<string, number>();
  const prev = new Map<string, { from: string; segId: string; reverse: boolean }>();
  const visited = new Set<string>();
  const queue: string[] = [startId];
  dist.set(startId, 0);

  while (queue.length > 0) {
    queue.sort((a, b) => (dist.get(a) ?? Infinity) - (dist.get(b) ?? Infinity));
    const u = queue.shift()!;
    if (u === goalId) break;
    if (visited.has(u)) continue;
    visited.add(u);

    const edges = adj.get(u) ?? [];
    for (const e of edges) {
      if (visited.has(e.to)) continue;
      const alt = (dist.get(u) ?? Infinity) + e.len;
      if (alt < (dist.get(e.to) ?? Infinity)) {
        dist.set(e.to, alt);
        prev.set(e.to, { from: u, segId: e.segId, reverse: e.reverse });
        queue.push(e.to);
      }
    }
  }

  const chain: { segId: string; reverse: boolean }[] = [];
  let cur = goalId;
  while (cur !== startId) {
    const p = prev.get(cur);
    if (!p) return [];
    chain.push({ segId: p.segId, reverse: p.reverse });
    cur = p.from;
  }
  chain.reverse();

  const pts: [number, number][] = [];
  for (const step of chain) {
    const raw = segPts.get(step.segId);
    if (!raw || raw.length === 0) continue;
    const ordered = step.reverse ? [...raw].reverse() : raw;
    for (let i = 0; i < ordered.length; i++) {
      if (pts.length > 0 && i === 0) continue;
      pts.push(ordered[i]);
    }
  }
  return pts;
}

/** Computes a shortest road-network polyline from player `(x, z)` to destination `(tx, tz)`. */
export function computeWestgateGpsRoute(
  data: MinimapData,
  fromX: number,
  fromZ: number,
  toX: number,
  toZ: number,
): [number, number][] {
  if (data.nodes.length === 0) return [[fromX, fromZ], [toX, toZ]];

  let startNode = data.nodes[0];
  let endNode = data.nodes[0];
  let bestS = Infinity;
  let bestE = Infinity;

  for (const n of data.nodes) {
    const ds = (n.x - fromX) * (n.x - fromX) + (n.z - fromZ) * (n.z - fromZ);
    if (ds < bestS) {
      bestS = ds;
      startNode = n;
    }
    const de = (n.x - toX) * (n.x - toX) + (n.z - toZ) * (n.z - toZ);
    if (de < bestE) {
      bestE = de;
      endNode = n;
    }
  }

  const roadRoute = dijkstraNodes(startNode.id, endNode.id, data.adj, data.segPts);
  if (roadRoute.length === 0) {
    return [
      [fromX, fromZ],
      [toX, toZ],
    ];
  }
  return [[fromX, fromZ], ...roadRoute, [toX, toZ]];
}
