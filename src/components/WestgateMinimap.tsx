import { useEffect, useMemo, useRef, useState } from "react";
import { computeWestgateGpsRoute, type MinimapData } from "../game/city/MinimapData";
import { WESTGATE_CONTRACT_SPOTS } from "../game/city/WestgateActivities";
import { WESTGATE_TELEPORTS } from "../game/city/WestgateWorld";
import { resolveGpsTarget, type GpsWaypoint } from "../game/city/GpsWaypoint";

export interface MinimapLiveSample {
  x: number;
  z: number;
  heading: number;
  driving: boolean;
  speedKmh: number;
  vehicles: { x: number; z: number; isNpc: boolean; active: boolean; name?: string }[];
  traps?: { id: string; x: number; z: number; beaten: boolean; bestKmh?: number }[];
  contracts?: { missionId: number; x: number; z: number; unlocked: boolean; completed: boolean }[];
  police?: { x: number; z: number; isSwat: boolean; isChopper?: boolean }[];
  garages?: { id: string; name: string; x: number; z: number }[];
  stores?: { id: string; name: string; x: number; z: number }[];
  races?: { id: string; name: string; x: number; z: number }[];
  stunts?: { id: string; name: string; x: number; z: number; completed: boolean }[];
  aircraft?: { id: string; name: string; kind: "helicopter" | "airplane"; x: number; z: number }[];
  boats?: { id: string; name: string; x: number; z: number; isStarter?: boolean }[];
  stashes?: { x: number; z: number; collected: boolean }[];
  raceCheckpoint?: { x: number; z: number } | null;
  randomEvent?: { x: number; z: number; kind: string; title: string } | null;
  surveillanceTarget?: { x: number; z: number; name: string; isolated: boolean; stage: string } | null;
}

interface WestgateMinimapProps {
  data: MinimapData;
  getSample: () => MinimapLiveSample | null;
  paused?: boolean;
  gpsTargetId?: string | null;
  customWaypoint?: GpsWaypoint | null;
  onChangeGpsTarget?: (id: string | null) => void;
  onOpenFullMap?: () => void;
}

const TAU = Math.PI * 2;
const BUCKETS = 28;
const SIZE_PX = 216;
const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

function buildPath(pts: [number, number][], close = false): Path2D {
  const p = new Path2D();
  if (pts.length === 0) return p;
  p.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) {
    p.lineTo(pts[i][0], pts[i][1]);
  }
  if (close) p.closePath();
  return p;
}

/** Subdivide polyline segments into ~18m chunks so behind-arrow route opacity fade is smooth. */
function subdividePolyline(pts: [number, number][], maxStep = 18): [number, number][] {
  if (pts.length < 2) return pts;
  const out: [number, number][] = [pts[0]];
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    const dist = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const steps = Math.max(1, Math.ceil(dist / maxStep));
    for (let s = 1; s <= steps; s++) {
      const t = s / steps;
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
    }
  }
  return out;
}

const GPS_SPOTS = [
  { id: null as string | null, label: "Scenic Loop" },
  ...WESTGATE_CONTRACT_SPOTS.map((c) => ({
    id: `contract:${c.missionId}` as string | null,
    label: `Contract C${c.missionId} · ${c.districtLabel}`,
  })),
  ...WESTGATE_TELEPORTS.filter((t) =>
    [
      "downtown",
      "del_sol_pier",
      "observatory",
      "bay_bridge",
      "midtown_mall",
      "mirror_park",
      "seaport_docks",
      "south_airport",
      "sports_arena",
    ].includes(t.id),
  ).map((t) => ({ id: t.id as string | null, label: t.label.split("&")[0].trim() })),
];

export function WestgateMinimap({
  data,
  getSample,
  paused = false,
  gpsTargetId = null,
  customWaypoint = null,
  onChangeGpsTarget,
  onOpenFullMap,
}: WestgateMinimapProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [zoomBase, setZoomBase] = useState(0.95);
  const [localTargetId, setLocalTargetId] = useState<string | null>(gpsTargetId);
  const [distLabel, setDistLabel] = useState<string | null>(null);

  const activeTargetId = onChangeGpsTarget ? gpsTargetId : localTargetId;
  const setTargetId = (id: string | null) => {
    if (onChangeGpsTarget) onChangeGpsTarget(id);
    else setLocalTargetId(id);
  };

  const targetSpot = useMemo(
    () => resolveGpsTarget(activeTargetId ?? null, customWaypoint),
    [activeTargetId, customWaypoint],
  );

  // Precompile static Path2D objects once for Westgate Bay's roads & geography
  const compiled = useMemo(() => {
    const roadPaths = data.roads.map((r) => ({
      path: buildPath(r.pts),
      width: Math.max(5.5, r.width),
      isBridge: r.isBridge,
      tier: r.tier,
    }));
    const coastPath = buildPath(data.coastPolygon, true);
    const riverPath = buildPath(data.riverPolyline);
    const coralPath = buildPath(data.scenicCoral);
    const defaultRoutePts = subdividePolyline(data.defaultLoop, 18);

    // Subtle organic terrain patches matching the reference minimap aesthetic
    const terrainPatches: { x: number; y: number; r: number; dark: boolean }[] = [];
    for (let i = 0; i < 24; i++) {
      const a = ((i * 7919) % 1000) / 1000;
      const b = ((i * 6271) % 1000) / 1000;
      terrainPatches.push({
        x: -950 + a * 1950,
        y: -1050 + b * 2050,
        r: 180 + ((i * 313) % 240),
        dark: i % 2 === 0,
      });
    }

    return { roadPaths, coastPath, riverPath, coralPath, defaultRoutePts, terrainPatches };
  }, [data]);

  const routeCacheRef = useRef<{
    targetId: string | null;
    fromX: number;
    fromZ: number;
    pts: [number, number][];
  }>({ targetId: null, fromX: 0, fromZ: 0, pts: compiled.defaultRoutePts });

  useEffect(() => {
    routeCacheRef.current = {
      targetId: null,
      fromX: 0,
      fromZ: 0,
      pts: compiled.defaultRoutePts,
    };
  }, [compiled]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const S = SIZE_PX;
    const R = S / 2 - 2.5;
    const anchorX = S / 2;
    const anchorY = S / 2 + R * 0.42;
    const mapDpr = Math.min(4, Math.max(3, window.devicePixelRatio || 1));
    canvas.width = Math.round(S * mapDpr);
    canvas.height = Math.round(S * mapDpr);

    let raf = 0;
    let lastDistTick = 0;
    let smoothZoom = zoomBase;

    const render = (now: number) => {
      raf = requestAnimationFrame(render);
      if (paused) return;

      const sample = getSample();
      if (!sample) return;

      // Subtle speed-based dynamic zoom out when driving fast on Westgate Bay freeways
      const speedTargetZoom = sample.driving
        ? zoomBase * clamp(1.0 - (sample.speedKmh / 240) * 0.28, 0.72, 1.0)
        : zoomBase * 1.12;
      smoothZoom += (speedTargetZoom - smoothZoom) * 0.08;
      const zoom = smoothZoom;

      // Update dynamic shortest-path road route when a GPS target is selected
      let activeRoutePts = compiled.defaultRoutePts;
      if (targetSpot) {
        const rc = routeCacheRef.current;
        const moved = Math.hypot(sample.x - rc.fromX, sample.z - rc.fromZ);
        if (rc.targetId !== targetSpot.id || moved > 45) {
          const raw = computeWestgateGpsRoute(data, sample.x, sample.z, targetSpot.x, targetSpot.z);
          routeCacheRef.current = {
            targetId: targetSpot.id,
            fromX: sample.x,
            fromZ: sample.z,
            pts: subdividePolyline(raw, 18),
          };
        }
        activeRoutePts = routeCacheRef.current.pts;
        if (now - lastDistTick > 180) {
          lastDistTick = now;
          const d = Math.hypot(targetSpot.x - sample.x, targetSpot.z - sample.z);
          setDistLabel(d >= 1000 ? `${(d / 1000).toFixed(1)} km` : `${Math.round(d)} m`);
        }
      } else if (now - lastDistTick > 250) {
        lastDistTick = now;
        setDistLabel(null);
      }

      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.setTransform(mapDpr, 0, 0, mapDpr, 0, 0);

      // Circular radar clip
      ctx.save();
      ctx.beginPath();
      ctx.arc(S / 2, S / 2, R, 0, TAU);
      ctx.clip();

      // Base olive-charcoal vector terrain
      ctx.fillStyle = "#252a20";
      ctx.fillRect(0, 0, S, S);

      // CORE TRANSFORM: fixed arrow stays at (anchorX, anchorY); Westgate Bay world rotates + slides beneath it
      ctx.translate(anchorX, anchorY);
      ctx.rotate(-sample.heading);
      ctx.scale(zoom, zoom);
      ctx.translate(-sample.x, -sample.z);

      // Organic terrain patches
      for (const p of compiled.terrainPatches) {
        const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.r);
        g.addColorStop(0, p.dark ? "rgba(16,22,11,0.24)" : "rgba(112,120,79,0.14)");
        g.addColorStop(1, "rgba(0,0,0,0)");
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, TAU);
        ctx.fill();
      }

      // Coastal Pacific Ocean, South Bay, East Harbor & Westgate River
      ctx.fillStyle = "#172733";
      ctx.fill(compiled.coastPath);
      ctx.fillRect(-1300, 1060, 2700, 400); // South Bay
      ctx.fillRect(455, 505, 425, 560); // East Seaport Harbor Basin
      // Venice Canals
      ctx.fillRect(-680, 172, 150, 26);
      ctx.fillRect(-680, 292, 150, 26);
      ctx.fillRect(-617, 155, 24, 180);

      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.strokeStyle = "#172733";
      ctx.lineWidth = 54;
      ctx.stroke(compiled.riverPath);

      // Mirror Central Park & South Airport Tarmac
      ctx.fillStyle = "#2d3923";
      ctx.beginPath();
      ctx.roundRect(-205, 292, 225, 160, 18);
      ctx.fill();

      ctx.fillStyle = "#2b2f34";
      ctx.fillRect(-360, 760, 460, 220);
      ctx.strokeStyle = "rgba(255,255,255,0.12)";
      ctx.lineWidth = 2;
      ctx.strokeRect(-320, 810, 380, 22);
      ctx.strokeRect(-320, 910, 380, 22);

      // Subtle vector grid lines
      ctx.strokeStyle = "rgba(240,245,225,0.035)";
      ctx.lineWidth = 1.6 / zoom;
      ctx.beginPath();
      for (let gx = -1000; gx <= 1000; gx += 250) {
        ctx.moveTo(gx, -1100);
        ctx.lineTo(gx, 1100);
      }
      for (let gz = -1000; gz <= 1000; gz += 250) {
        ctx.moveTo(-1100, gz);
        ctx.lineTo(1100, gz);
      }
      ctx.stroke();

      // Roads: dark casing first, then light vector asphalt surface
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      const casingExtra = 5.2 / zoom;
      ctx.strokeStyle = "rgba(10,13,8,0.88)";
      for (const r of compiled.roadPaths) {
        ctx.lineWidth = r.width + casingExtra;
        ctx.stroke(r.path);
      }
      for (const rb of data.roundabouts) {
        const midR = (rb.innerR + rb.outerR) * 0.5;
        ctx.lineWidth = rb.outerR - rb.innerR + casingExtra;
        ctx.beginPath();
        ctx.arc(rb.x, rb.z, midR, 0, TAU);
        ctx.stroke();
      }

      ctx.strokeStyle = "#d9dad2";
      for (const r of compiled.roadPaths) {
        ctx.lineWidth = r.width;
        ctx.stroke(r.path);
      }
      for (const rb of data.roundabouts) {
        const midR = (rb.innerR + rb.outerR) * 0.5;
        ctx.lineWidth = rb.outerR - rb.innerR;
        ctx.beginPath();
        ctx.arc(rb.x, rb.z, midR, 0, TAU);
        ctx.stroke();
      }

      // Coral dashed secondary scenic trail
      ctx.setLineDash([28, 22]);
      ctx.strokeStyle = "rgba(255,127,105,0.90)";
      ctx.lineWidth = Math.max(4.5, 5.5 / zoom);
      ctx.stroke(compiled.coralPath);
      ctx.setLineDash([]);

      // Cyan navigation line drawn in opacity buckets measured from the fixed arrow:
      // bright ahead, dissolving smoothly behind the pointer.
      const sin = Math.sin(sample.heading);
      const cos = Math.cos(sample.heading);
      const fadePx = R * 0.58;
      const buckets: (Path2D | undefined)[] = new Array(BUCKETS + 1);
      for (let k = 0; k < activeRoutePts.length - 1; k++) {
        const a = activeRoutePts[k];
        const b = activeRoutePts[k + 1];
        const mx = (a[0] + b[0]) * 0.5 - sample.x;
        const my = (a[1] + b[1]) * 0.5 - sample.z;
        const behindPx = zoom * (-sin * mx + cos * my);
        const alpha = behindPx <= 0 ? 1 : Math.pow(clamp(1 - behindPx / fadePx, 0, 1), 1.6);
        const bi = Math.round(alpha * BUCKETS);
        let pth = buckets[bi];
        if (!pth) {
          pth = new Path2D();
          buckets[bi] = pth;
        }
        pth.moveTo(a[0], a[1]);
        pth.lineTo(b[0], b[1]);
      }

      ctx.strokeStyle = "#42d6f0";
      ctx.lineWidth = Math.max(8, 9.5 / zoom);
      for (let b = 0; b <= BUCKETS; b++) {
        const pth = buckets[b];
        if (!pth) continue;
        const a = b / BUCKETS;
        if (a <= 0.02) continue;
        ctx.globalAlpha = a;
        ctx.shadowColor = `rgba(56,216,246,${(0.55 * a).toFixed(2)})`;
        ctx.shadowBlur = a > 0.04 ? 11 * a : 0;
        ctx.stroke(pth);
      }
      ctx.globalAlpha = 1;
      ctx.shadowBlur = 0;
      ctx.shadowColor = "rgba(0,0,0,0)";

      // Speed Trap camera diamonds (cyan -> gold once target speed is beaten)
      if (sample.traps) {
        const s = 4.6 / zoom;
        for (const tr of sample.traps) {
          ctx.beginPath();
          ctx.moveTo(tr.x, tr.z - s);
          ctx.lineTo(tr.x + s, tr.z);
          ctx.lineTo(tr.x, tr.z + s);
          ctx.lineTo(tr.x - s, tr.z);
          ctx.closePath();
          ctx.fillStyle = tr.beaten ? "#fbbf24" : "#22d3ee";
          ctx.fill();
          ctx.lineWidth = 1.4 / zoom;
          ctx.strokeStyle = "#0a0d08";
          ctx.stroke();
        }
      }

      // Campaign Contract Beacons (M0–M6) linking Westgate Bay to Campaign Missions
      if (sample.contracts) {
        const rC = 7.4 / zoom;
        for (const c of sample.contracts) {
          ctx.beginPath();
          ctx.arc(c.x, c.z, rC, 0, TAU);
          ctx.fillStyle = c.completed ? "#fbbf24" : c.unlocked ? "#f97316" : "#64748b";
          ctx.fill();
          ctx.lineWidth = 1.8 / zoom;
          ctx.strokeStyle = "#0a0d08";
          ctx.stroke();

          ctx.save();
          ctx.translate(c.x, c.z);
          ctx.rotate(sample.heading);
          ctx.font = `900 ${Math.max(8, Math.round(9.5 / zoom))}px ui-monospace, SFMono-Regular, monospace`;
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillStyle = "#090b08";
          ctx.fillText(`C${c.missionId}`, 0, 0.5 / zoom);
          ctx.restore();
        }
      }

      // Nearby hero cars (amber) & NPC traffic (soft slate-white)
      for (const v of sample.vehicles) {
        ctx.beginPath();
        ctx.arc(v.x, v.z, (v.isNpc ? 3.2 : 4.2) / zoom, 0, TAU);
        ctx.fillStyle = v.isNpc ? "rgba(232,238,242,0.72)" : "#fbbf24";
        ctx.fill();
        ctx.lineWidth = 1.2 / zoom;
        ctx.strokeStyle = "rgba(10,13,8,0.9)";
        ctx.stroke();
      }

      // Westgate Customs Mod Garages (purple squares)
      if (sample.garages) {
        const gs = 6.2 / zoom;
        for (const g of sample.garages) {
          ctx.fillStyle = "#a855f7";
          ctx.fillRect(g.x - gs * 0.5, g.z - gs * 0.5, gs, gs);
          ctx.lineWidth = 1.3 / zoom;
          ctx.strokeStyle = "#0a0d08";
          ctx.strokeRect(g.x - gs * 0.5, g.z - gs * 0.5, gs, gs);
        }
      }

      // 24/7 Westgate Mart Stores (emerald dots)
      if (sample.stores) {
        for (const st of sample.stores) {
          ctx.beginPath();
          ctx.arc(st.x, st.z, 4.4 / zoom, 0, TAU);
          ctx.fillStyle = "#22c55e";
          ctx.fill();
          ctx.lineWidth = 1.3 / zoom;
          ctx.strokeStyle = "#0a0d08";
          ctx.stroke();
        }
      }

      // Street Races (gold flags)
      if (sample.races) {
        for (const r of sample.races) {
          ctx.beginPath();
          ctx.arc(r.x, r.z, 5.4 / zoom, 0, TAU);
          ctx.fillStyle = "#f59e0b";
          ctx.fill();
          ctx.lineWidth = 1.4 / zoom;
          ctx.strokeStyle = "#0a0d08";
          ctx.stroke();
        }
      }

      // Active Race Checkpoint
      if (sample.raceCheckpoint) {
        const pulse = 0.75 + 0.25 * Math.sin(now * 0.008);
        ctx.beginPath();
        ctx.arc(sample.raceCheckpoint.x, sample.raceCheckpoint.z, (11 * pulse) / zoom, 0, TAU);
        ctx.fillStyle = "rgba(251,191,36,0.35)";
        ctx.fill();
        ctx.beginPath();
        ctx.arc(sample.raceCheckpoint.x, sample.raceCheckpoint.z, 5.5 / zoom, 0, TAU);
        ctx.fillStyle = "#fbbf24";
        ctx.fill();
      }

      // Active Random Street Event (pulsing cyan/gold radar)
      if (sample.randomEvent) {
        const pulse = 0.7 + 0.35 * Math.sin(now * 0.009);
        ctx.beginPath();
        ctx.arc(sample.randomEvent.x, sample.randomEvent.z, (10 * pulse) / zoom, 0, TAU);
        ctx.strokeStyle = "#38bdf8";
        ctx.lineWidth = 2 / zoom;
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(sample.randomEvent.x, sample.randomEvent.z, 4.5 / zoom, 0, TAU);
        ctx.fillStyle = "#38bdf8";
        ctx.fill();
      }

      // Hidden Stashes (small gold dots)
      if (sample.stashes) {
        for (const st of sample.stashes) {
          if (st.collected) continue;
          ctx.beginPath();
          ctx.arc(st.x, st.z, 2.8 / zoom, 0, TAU);
          ctx.fillStyle = "#fde047";
          ctx.fill();
        }
      }

      // Docked Boats (cyan diamonds, starter boat outlined)
      if (sample.boats) {
        for (const bt of sample.boats) {
          const sz = (bt.isStarter ? 5.6 : 4.5) / zoom;
          ctx.beginPath();
          ctx.moveTo(bt.x, bt.z - sz);
          ctx.lineTo(bt.x + sz, bt.z);
          ctx.lineTo(bt.x, bt.z + sz);
          ctx.lineTo(bt.x - sz, bt.z);
          ctx.closePath();
          ctx.fillStyle = bt.isStarter ? "#22d3ee" : "#0ea5e9";
          ctx.fill();
          if (bt.isStarter) {
            ctx.lineWidth = 1.4 / zoom;
            ctx.strokeStyle = "#ffffff";
            ctx.stroke();
          }
        }
      }

      // Active Surveillance Target / Deep-Sea Disposal Zone
      if (sample.surveillanceTarget) {
        const st = sample.surveillanceTarget;
        const pulse = 7.5 + Math.sin(now * 0.008) * 2.2;
        ctx.beginPath();
        ctx.arc(st.x, st.z, pulse / zoom, 0, TAU);
        ctx.lineWidth = 1.8 / zoom;
        ctx.strokeStyle = st.stage === "dispose" ? "#0ea5e9" : st.isolated ? "#22c55e" : "#f59e0b";
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(st.x, st.z, 3.8 / zoom, 0, TAU);
        ctx.fillStyle = st.stage === "dispose" ? "#38bdf8" : st.isolated ? "#22c55e" : "#ef4444";
        ctx.fill();
      }

      // Parked Helicopters & Airplanes (sky triangles)
      if (sample.aircraft) {
        for (const ac of sample.aircraft) {
          const sz = 5.4 / zoom;
          ctx.beginPath();
          ctx.moveTo(ac.x, ac.z - sz);
          ctx.lineTo(ac.x + sz, ac.z + sz * 0.8);
          ctx.lineTo(ac.x - sz, ac.z + sz * 0.8);
          ctx.closePath();
          ctx.fillStyle = ac.kind === "helicopter" ? "#38bdf8" : "#f8fafc";
          ctx.fill();
          ctx.lineWidth = 1.3 / zoom;
          ctx.strokeStyle = "#0a0d08";
          ctx.stroke();
        }
      }

      // Pursuing Police Cruisers & Helicopter (flashing red/blue sirens)
      if (sample.police && sample.police.length > 0) {
        const redFlash = Math.floor(now / 180) % 2 === 0;
        for (const p of sample.police) {
          ctx.beginPath();
          ctx.arc(p.x, p.z, (p.isChopper ? 7.2 : p.isSwat ? 5.6 : 4.8) / zoom, 0, TAU);
          ctx.fillStyle = redFlash ? "#ef4444" : "#3b82f6";
          ctx.fill();
          ctx.lineWidth = 1.5 / zoom;
          ctx.strokeStyle = "#ffffff";
          ctx.stroke();
        }
      }

      // Active GPS destination waypoint pin
      if (targetSpot) {
        const pulse = 0.7 + 0.3 * Math.sin(now * 0.006);
        ctx.beginPath();
        ctx.arc(targetSpot.x, targetSpot.z, (9 * pulse) / zoom, 0, TAU);
        ctx.fillStyle = "rgba(66,214,240,0.30)";
        ctx.fill();
        ctx.beginPath();
        ctx.arc(targetSpot.x, targetSpot.z, 5.0 / zoom, 0, TAU);
        ctx.fillStyle = "#42d6f0";
        ctx.fill();
        ctx.lineWidth = 1.6 / zoom;
        ctx.strokeStyle = "#0b0e08";
        ctx.stroke();
      }

      ctx.restore();

      // Inner radial vignette + compass N marker (matching uploaded vector minimap)
      ctx.save();
      ctx.beginPath();
      ctx.arc(S / 2, S / 2, R, 0, TAU);
      ctx.clip();

      const vg = ctx.createRadialGradient(S / 2, S / 2, R * 0.46, S / 2, S / 2, R);
      vg.addColorStop(0, "rgba(0,0,0,0)");
      vg.addColorStop(1, "rgba(0,0,0,0.36)");
      ctx.fillStyle = vg;
      ctx.fillRect(0, 0, S, S);

      const nx = -Math.sin(sample.heading);
      const ny = -Math.cos(sample.heading);
      const nd = R * 0.5;
      ctx.font = '800 12px ui-sans-serif, system-ui, -apple-system, sans-serif';
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillStyle = "rgba(255,255,255,0.92)";
      ctx.shadowColor = "rgba(0,0,0,0.72)";
      ctx.shadowBlur = 4;
      ctx.fillText("N", anchorX + nx * nd, anchorY + ny * nd);
      ctx.restore();

      // Crisp outer ring
      ctx.beginPath();
      ctx.arc(S / 2, S / 2, R, 0, TAU);
      ctx.strokeStyle = "rgba(255,255,255,0.34)";
      ctx.lineWidth = 1.5;
      ctx.stroke();
    };

    raf = requestAnimationFrame(render);
    return () => cancelAnimationFrame(raf);
  }, [compiled, data, getSample, paused, targetSpot, zoomBase]);

  const curIdx = GPS_SPOTS.findIndex((s) => s.id === activeTargetId);
  const curSpot = GPS_SPOTS[curIdx >= 0 ? curIdx : 0];
  const cycleGps = () => {
    const next = GPS_SPOTS[(curIdx + 1) % GPS_SPOTS.length];
    setTargetId(next.id);
  };

  return (
    <div className="pointer-events-none absolute bottom-5 left-5 z-20 flex flex-col items-start gap-2">
      <div
        className="relative"
        style={{ width: SIZE_PX, height: SIZE_PX }}
      >
        <canvas
          ref={canvasRef}
          className="block h-full w-full rounded-full shadow-[0_18px_48px_rgba(0,0,0,0.72)]"
        />
        {/* Architectural tactical corner ticks around radar */}
        <svg
          viewBox="0 0 184 184"
          aria-hidden="true"
          className="pointer-events-none absolute -inset-1 size-[calc(100%+8px)]"
        >
          <path d="M18 4 H4 V18" fill="none" stroke="#ff3b30" strokeWidth="1.5" opacity="0.85" />
          <path d="M166 4 H180 V18" fill="none" stroke="rgba(242,239,233,0.45)" strokeWidth="1.2" />
          <path d="M4 166 V180 H18" fill="none" stroke="rgba(242,239,233,0.45)" strokeWidth="1.2" />
          <path d="M180 166 V180 H166" fill="none" stroke="#ff3b30" strokeWidth="1.5" opacity="0.85" />
          <circle cx="92" cy="92" r="88" fill="none" stroke="rgba(242,239,233,0.18)" strokeWidth="1" strokeDasharray="3 7" />
        </svg>
        {/* Fixed white navigation pointer: never rotates or moves; the world moves beneath it */}
        <svg
          viewBox="0 0 52 60"
          aria-hidden="true"
          className="pointer-events-none absolute left-1/2 -translate-x-1/2 -translate-y-1/2 drop-shadow-[0_2px_4px_rgba(0,0,0,0.75)]"
          style={{
            width: 22,
            height: 26,
            top: `calc(50% + ${(SIZE_PX / 2 - 2.5) * 0.42}px)`,
          }}
        >
          <path
            d="M26 3 L47 52 L26 40 L5 52 Z"
            fill="#f7f9f5"
            stroke="#171b15"
            strokeWidth="3.5"
            strokeLinejoin="round"
          />
        </svg>
      </div>

      {/* Sharp chamfered GPS & zoom telemetry strip */}
      <div className="pointer-events-auto flex items-center gap-1">
        <button
          type="button"
          onClick={cycleGps}
          title="Click to cycle GPS destination"
          data-augmented-ui="tl-clip br-clip border inlay"
          className="voss-panel-sharp flex cursor-pointer items-center gap-2 px-3 py-1 font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-[#f2efe9] transition hover:text-[#38bdf8]"
        >
          <span
            className="h-1.5 w-1.5"
            style={{
              background: targetSpot?.isCustom ? "#ff3b30" : "#38bdf8",
              boxShadow: targetSpot?.isCustom ? "0 0 8px #ff3b30" : "0 0 8px #38bdf8",
            }}
          />
          <span className={targetSpot?.isCustom ? "text-[#ff3b30]" : "text-[#38bdf8]"}>
            {targetSpot?.isCustom ? "PIN" : "GPS"}
          </span>
          <span className="max-w-[125px] truncate">
            {targetSpot?.isCustom ? targetSpot.label : curSpot.label}
          </span>
          {distLabel && <span className="text-[#8a909e] tabular-nums">{distLabel}</span>}
        </button>
        {onOpenFullMap && (
          <button
            type="button"
            onClick={onOpenFullMap}
            title="Open Full Tactical Map [M]"
            className="cursor-pointer border border-[#38bdf8]/45 bg-[#0a0c10]/90 px-2 py-1 font-mono text-[10px] font-bold uppercase tracking-wider text-[#38bdf8] transition hover:bg-[#38bdf8] hover:text-[#07080b]"
          >
            [M]
          </button>
        )}
        <button
          type="button"
          onClick={() => setZoomBase((z) => clamp(Number((z - 0.18).toFixed(2)), 0.45, 1.85))}
          title="Zoom out minimap"
          className="cursor-pointer border border-white/15 bg-[#0a0c10]/90 px-2 py-1 font-mono text-[11px] font-bold text-[#f2efe9] transition hover:border-[#ff3b30] hover:text-[#ff3b30]"
        >
          −
        </button>
        <button
          type="button"
          onClick={() => setZoomBase((z) => clamp(Number((z + 0.18).toFixed(2)), 0.45, 1.85))}
          title="Zoom in minimap"
          className="cursor-pointer border border-white/15 bg-[#0a0c10]/90 px-2 py-1 font-mono text-[11px] font-bold text-[#f2efe9] transition hover:border-[#ff3b30] hover:text-[#ff3b30]"
        >
          +
        </button>
      </div>
    </div>
  );
}
