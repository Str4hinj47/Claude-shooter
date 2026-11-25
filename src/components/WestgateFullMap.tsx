import { useEffect, useMemo, useRef, useState } from "react";
import { Compass, Crosshair, Layers, MapPin, Navigation, RotateCcw, X, Zap } from "lucide-react";
import { computeWestgateGpsRoute, type MinimapData } from "../game/city/MinimapData";
import { WESTGATE_CONTRACT_SPOTS, WESTGATE_SPEED_TRAPS } from "../game/city/WestgateActivities";
import { WESTGATE_TELEPORTS } from "../game/city/WestgateMeta";
import { getDistrictAt } from "../game/city/WestgateTerrain";
import { MISSIONS } from "../game/story";
import { resolveGpsTarget, type GpsWaypoint } from "../game/city/GpsWaypoint";
import { APARTMENTS, loadSave } from "../game/progression";
import type { MinimapLiveSample } from "./WestgateMinimap";
import { TacticalButton } from "./ui/VectorFrame";

interface WestgateFullMapProps {
  data: MinimapData;
  getSample: (maxRadius?: number) => MinimapLiveSample | null;
  gpsTargetId: string | null;
  customWaypoint: GpsWaypoint | null;
  onSetGpsTarget: (id: string | null, custom?: GpsWaypoint | null) => void;
  onFastTravel: (x: number, z: number, yawDeg?: number) => void;
  onClose: () => void;
}

type MarkerHit =
  | { kind: "contract"; missionId: number; x: number; z: number; label: string; sub: string; accent: string; yawDeg: number }
  | { kind: "trap"; id: string; x: number; z: number; label: string; sub: string; targetKmh: number }
  | { kind: "sector"; id: string; x: number; z: number; label: string; sub: string; yawDeg: number };

const DISTRICT_LABELS: { name: string; sub: string; x: number; z: number }[] = [
  { name: "VINEWOOD FOOTHILLS", sub: "NORTH RIDGE", x: -160, z: -860 },
  { name: "NORTH GORGE", sub: "CANYON HIGHWAY", x: 320, z: -610 },
  { name: "DOWNTOWN", sub: "CIVIC & FINANCIAL", x: 75, z: -130 },
  { name: "MIDTOWN", sub: "COMMERCIAL CORE", x: -315, z: -165 },
  { name: "WEST COAST", sub: "DEL SOL & CANALS", x: -665, z: 50 },
  { name: "OLD QUARTER", sub: "SUBURBS & PARK", x: -195, z: 335 },
  { name: "EAST INDUSTRIAL", sub: "SEAPORT & DOCKS", x: 540, z: 340 },
  { name: "SOUTH AIRPORT", sub: "RUNWAYS & ARENA", x: -160, z: 810 },
];

const TAU = Math.PI * 2;
const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

function buildPath(pts: [number, number][], close = false): Path2D {
  const p = new Path2D();
  if (pts.length === 0) return p;
  p.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) p.lineTo(pts[i][0], pts[i][1]);
  if (close) p.closePath();
  return p;
}

export function WestgateFullMap({
  data,
  getSample,
  gpsTargetId,
  customWaypoint,
  onSetGpsTarget,
  onFastTravel,
  onClose,
}: WestgateFullMapProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const viewRef = useRef({ cx: 0, cz: -40, zoom: 0.34 });
  const dragRef = useRef<{ active: boolean; moved: boolean; startX: number; startY: number; cx: number; cz: number }>({
    active: false,
    moved: false,
    startX: 0,
    startY: 0,
    cx: 0,
    cz: -40,
  });

  const [zoomPct, setZoomPct] = useState(34);
  const [cursorWorld, setCursorWorld] = useState<{ x: number; z: number; district: string }>({
    x: 0,
    z: 0,
    district: "Downtown Westgate",
  });
  const [layers, setLayers] = useState({
    districts: true,
    contracts: true,
    traps: true,
    vehicles: true,
    sectors: true,
  });
  const [selectedMarker, setSelectedMarker] = useState<MarkerHit | null>(null);
  const [routeDist, setRouteDist] = useState<string | null>(null);

  const activeTarget = useMemo(
    () => resolveGpsTarget(gpsTargetId, customWaypoint),
    [gpsTargetId, customWaypoint],
  );

  const compiled = useMemo(() => {
    const roadPaths = data.roads.map((r) => ({
      path: buildPath(r.pts),
      width: Math.max(6, r.width),
      isBridge: r.isBridge,
      tier: r.tier,
    }));
    const coastPath = buildPath(data.coastPolygon, true);
    const riverPath = buildPath(data.riverPolyline);
    const coralPath = buildPath(data.scenicCoral);
    return { roadPaths, coastPath, riverPath, coralPath };
  }, [data]);

  const allMarkers = useMemo<MarkerHit[]>(() => {
    const out: MarkerHit[] = [];
    for (const c of WESTGATE_CONTRACT_SPOTS) {
      const m = MISSIONS.find((mi) => mi.id === c.missionId);
      out.push({
        kind: "contract",
        missionId: c.missionId,
        x: c.x,
        z: c.z,
        label: `C${c.missionId} · ${m?.codename ?? "CONTRACT"}`,
        sub: `${m?.name ?? ""} · ${c.districtLabel}`,
        accent: m?.accent ?? "#ff3b30",
        yawDeg: c.yawDeg,
      });
    }
    for (const tr of WESTGATE_SPEED_TRAPS) {
      out.push({
        kind: "trap",
        id: tr.id,
        x: tr.x,
        z: tr.z,
        label: tr.name,
        sub: `Speed Trap · Target ${tr.targetKmh} km/h`,
        targetKmh: tr.targetKmh,
      });
    }
    for (const apt of APARTMENTS) {
      const owned = (loadSave().ownedApartments ?? []).includes(apt.id);
      out.push({
        kind: "sector",
        id: apt.id,
        x: apt.exitStreetPos.x,
        z: apt.exitStreetPos.z,
        label: apt.name,
        sub: `${owned ? "Owned Residence" : `For Sale (${apt.price} Cr)`} · ${apt.address}`,
        yawDeg: Math.round((apt.doorYaw * 180) / Math.PI),
      });
    }
    for (const tp of WESTGATE_TELEPORTS) {
      out.push({
        kind: "sector",
        id: tp.id,
        x: tp.x,
        z: tp.z,
        label: tp.label,
        sub: "Sector Fast-Travel Node",
        yawDeg: tp.yawDeg,
      });
    }
    return out;
  }, []);

  // Center once on player when map opens
  useEffect(() => {
    const s = getSample(2600);
    if (s) {
      viewRef.current = { cx: s.x, cz: s.z, zoom: 0.42 };
      setZoomPct(42);
    }
  }, [getSample]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let raf = 0;
    let lastTick = 0;

    const render = (now: number) => {
      raf = requestAnimationFrame(render);
      const rect = canvas.getBoundingClientRect();
      if (rect.width < 10 || rect.height < 10) return;
      const dpr = Math.min(2.5, window.devicePixelRatio || 1);
      const w = Math.round(rect.width * dpr);
      const h = Math.round(rect.height * dpr);
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }

      const sample = getSample(2600);
      const { cx, cz, zoom } = viewRef.current;

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = "#161b17";
      ctx.fillRect(0, 0, rect.width, rect.height);

      ctx.save();
      ctx.translate(rect.width / 2, rect.height / 2);
      ctx.scale(zoom, zoom);
      ctx.translate(-cx, -cz);

      // Island grid
      ctx.strokeStyle = "rgba(220, 232, 210, 0.045)";
      ctx.lineWidth = 1 / zoom;
      ctx.beginPath();
      for (let gx = -1250; gx <= 1250; gx += 250) {
        ctx.moveTo(gx, -1250);
        ctx.lineTo(gx, 1250);
      }
      for (let gz = -1250; gz <= 1250; gz += 250) {
        ctx.moveTo(-1250, gz);
        ctx.lineTo(1250, gz);
      }
      ctx.stroke();

      // Water features: Pacific Ocean, South Bay, East Harbor, Canals & River
      ctx.fillStyle = "#10202b";
      ctx.fill(compiled.coastPath);
      ctx.fillRect(-1400, 1060, 2900, 480);
      ctx.fillRect(455, 505, 425, 560);
      ctx.fillRect(-680, 172, 150, 26);
      ctx.fillRect(-680, 292, 150, 26);
      ctx.fillRect(-617, 155, 24, 180);

      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.strokeStyle = "#10202b";
      ctx.lineWidth = 54;
      ctx.stroke(compiled.riverPath);

      // Parks & Airport Tarmac
      ctx.fillStyle = "#22301d";
      ctx.beginPath();
      ctx.roundRect(-205, 292, 225, 160, 18);
      ctx.fill();

      ctx.fillStyle = "#23272e";
      ctx.fillRect(-360, 760, 460, 220);
      ctx.strokeStyle = "rgba(255,255,255,0.16)";
      ctx.lineWidth = 2;
      ctx.strokeRect(-320, 810, 380, 22);
      ctx.strokeRect(-320, 910, 380, 22);

      // Scenic coastline highlight
      ctx.strokeStyle = "rgba(232,140,122,0.32)";
      ctx.lineWidth = 4 / zoom;
      ctx.setLineDash([12 / zoom, 8 / zoom]);
      ctx.stroke(compiled.coralPath);
      ctx.setLineDash([]);

      // Road casings + fills
      for (const r of compiled.roadPaths) {
        ctx.strokeStyle = "#0a0c0e";
        ctx.lineWidth = r.width + 4.5 / zoom;
        ctx.stroke(r.path);
      }
      for (const r of compiled.roadPaths) {
        ctx.strokeStyle = r.tier === "freeway" ? "#56606b" : r.isBridge ? "#68737f" : "#3a4046";
        ctx.lineWidth = r.width;
        ctx.stroke(r.path);
      }
      for (const rb of data.roundabouts) {
        ctx.beginPath();
        ctx.arc(rb.x, rb.z, (rb.innerR + rb.outerR) * 0.5, 0, TAU);
        ctx.strokeStyle = "#485058";
        ctx.lineWidth = rb.outerR - rb.innerR;
        ctx.stroke();
      }

      // Active GPS Road Route
      if (sample && activeTarget) {
        const route = computeWestgateGpsRoute(data, sample.x, sample.z, activeTarget.x, activeTarget.z);
        if (route.length >= 2) {
          ctx.beginPath();
          ctx.moveTo(route[0][0], route[0][1]);
          for (let i = 1; i < route.length; i++) ctx.lineTo(route[i][0], route[i][1]);
          ctx.strokeStyle = activeTarget.isCustom ? "rgba(255, 59, 48, 0.35)" : "rgba(56, 189, 248, 0.35)";
          ctx.lineWidth = 10 / zoom;
          ctx.stroke();

          ctx.strokeStyle = activeTarget.isCustom ? "#ff3b30" : "#38bdf8";
          ctx.lineWidth = 4 / zoom;
          ctx.stroke();
        }
        if (now - lastTick > 180) {
          lastTick = now;
          const d = Math.hypot(activeTarget.x - sample.x, activeTarget.z - sample.z);
          setRouteDist(d >= 1000 ? `${(d / 1000).toFixed(2)} km` : `${Math.round(d)} m`);
        }
      } else if (now - lastTick > 220) {
        lastTick = now;
        setRouteDist(null);
      }

      // District Labels
      if (layers.districts) {
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        for (const d of DISTRICT_LABELS) {
          const fs = clamp(12 / zoom, 10, 44);
          ctx.font = `700 ${fs}px ui-monospace, SFMono-Regular, Menlo, monospace`;
          ctx.fillStyle = "rgba(242, 239, 233, 0.28)";
          ctx.fillText(d.name, d.x, d.z);
        }
      }

      // Sector Fast-Travel Nodes & Purchasable Apartments
      if (layers.sectors) {
        const ownedApts = new Set(loadSave().ownedApartments ?? []);
        for (const apt of APARTMENTS) {
          const isSel = selectedMarker?.kind === "sector" && selectedMarker.id === apt.id;
          const owned = ownedApts.has(apt.id);
          const s = (isSel ? 9.5 : 7.0) / zoom;
          ctx.fillStyle = owned ? "#10b981" : "#f59e0b";
          ctx.fillRect(apt.exitStreetPos.x - s * 0.5, apt.exitStreetPos.z - s * 0.5, s, s);
          ctx.lineWidth = 1.5 / zoom;
          ctx.strokeStyle = "#080a0f";
          ctx.strokeRect(apt.exitStreetPos.x - s * 0.5, apt.exitStreetPos.z - s * 0.5, s, s);
        }
        for (const tp of WESTGATE_TELEPORTS) {
          const isSel = selectedMarker?.kind === "sector" && selectedMarker.id === tp.id;
          const isHome = tp.id === "safehouse";
          const r = (isHome ? (isSel ? 8.5 : 6.5) : isSel ? 7 : 4.5) / zoom;
          ctx.beginPath();
          ctx.arc(tp.x, tp.z, r, 0, TAU);
          ctx.fillStyle = isHome ? "#fbbf24" : isSel ? "#f2efe9" : "rgba(148, 163, 184, 0.72)";
          ctx.fill();
          ctx.lineWidth = 1.4 / zoom;
          ctx.strokeStyle = "#080a0f";
          ctx.stroke();
        }
      }

      // Live Vehicles + Police Cruisers + Shops/Races/Random Events
      if (layers.vehicles && sample) {
        for (const v of sample.vehicles) {
          const sz = (v.isNpc ? 3.2 : 5.2) / zoom;
          ctx.fillStyle = v.isNpc ? "rgba(226, 232, 240, 0.65)" : "#e5a93c";
          ctx.fillRect(v.x - sz * 0.5, v.z - sz * 0.5, sz, sz);
        }
        if (sample.police) {
          const redFlash = Math.floor(now / 180) % 2 === 0;
          for (const p of sample.police) {
            ctx.beginPath();
            ctx.arc(p.x, p.z, 6.2 / zoom, 0, TAU);
            ctx.fillStyle = redFlash ? "#ef4444" : "#3b82f6";
            ctx.fill();
            ctx.lineWidth = 1.6 / zoom;
            ctx.strokeStyle = "#ffffff";
            ctx.stroke();
          }
        }
      }
      if (sample?.garages) {
        const gs = 7.5 / zoom;
        for (const g of sample.garages) {
          ctx.fillStyle = "#a855f7";
          ctx.fillRect(g.x - gs * 0.5, g.z - gs * 0.5, gs, gs);
          ctx.lineWidth = 1.4 / zoom;
          ctx.strokeStyle = "#07080b";
          ctx.strokeRect(g.x - gs * 0.5, g.z - gs * 0.5, gs, gs);
        }
      }
      if (sample?.stores) {
        for (const st of sample.stores) {
          ctx.beginPath();
          ctx.arc(st.x, st.z, 5.0 / zoom, 0, TAU);
          ctx.fillStyle = "#22c55e";
          ctx.fill();
          ctx.lineWidth = 1.4 / zoom;
          ctx.strokeStyle = "#07080b";
          ctx.stroke();
        }
      }
      if (sample?.races) {
        for (const r of sample.races) {
          ctx.beginPath();
          ctx.arc(r.x, r.z, 6.2 / zoom, 0, TAU);
          ctx.fillStyle = "#f59e0b";
          ctx.fill();
          ctx.lineWidth = 1.5 / zoom;
          ctx.strokeStyle = "#07080b";
          ctx.stroke();
        }
      }
      if (sample?.stunts) {
        for (const sj of sample.stunts) {
          const sz = 4.6 / zoom;
          ctx.beginPath();
          ctx.moveTo(sj.x, sj.z - sz);
          ctx.lineTo(sj.x + sz, sj.z + sz);
          ctx.lineTo(sj.x - sz, sj.z + sz);
          ctx.closePath();
          ctx.fillStyle = sj.completed ? "#fbbf24" : "#38bdf8";
          ctx.fill();
        }
      }
      if (sample?.stashes) {
        for (const st of sample.stashes) {
          if (st.collected) continue;
          ctx.beginPath();
          ctx.arc(st.x, st.z, 3.6 / zoom, 0, TAU);
          ctx.fillStyle = "#fde047";
          ctx.fill();
        }
      }
      if (sample?.boats) {
        for (const bt of sample.boats) {
          const sz = (bt.isStarter ? 6.8 : 5.4) / zoom;
          ctx.beginPath();
          ctx.moveTo(bt.x, bt.z - sz);
          ctx.lineTo(bt.x + sz, bt.z);
          ctx.lineTo(bt.x, bt.z + sz);
          ctx.lineTo(bt.x - sz, bt.z);
          ctx.closePath();
          ctx.fillStyle = bt.isStarter ? "#22d3ee" : "#0ea5e9";
          ctx.fill();
          if (bt.isStarter) {
            ctx.lineWidth = 1.5 / zoom;
            ctx.strokeStyle = "#ffffff";
            ctx.stroke();
          }
        }
      }
      if (sample?.surveillanceTarget) {
        const st = sample.surveillanceTarget;
        ctx.beginPath();
        ctx.arc(st.x, st.z, 10 / zoom, 0, TAU);
        ctx.lineWidth = 2.2 / zoom;
        ctx.strokeStyle = st.stage === "dispose" ? "#0ea5e9" : st.isolated ? "#22c55e" : "#f59e0b";
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(st.x, st.z, 4.5 / zoom, 0, TAU);
        ctx.fillStyle = st.stage === "dispose" ? "#38bdf8" : st.isolated ? "#22c55e" : "#ef4444";
        ctx.fill();
      }
      if (sample?.aircraft) {
        for (const ac of sample.aircraft) {
          const sz = 6.2 / zoom;
          ctx.beginPath();
          ctx.moveTo(ac.x, ac.z - sz);
          ctx.lineTo(ac.x + sz, ac.z + sz * 0.8);
          ctx.lineTo(ac.x - sz, ac.z + sz * 0.8);
          ctx.closePath();
          ctx.fillStyle = ac.kind === "helicopter" ? "#38bdf8" : "#f8fafc";
          ctx.fill();
          ctx.lineWidth = 1.4 / zoom;
          ctx.strokeStyle = "#07080b";
          ctx.stroke();
        }
      }
      if (sample?.randomEvent) {
        ctx.beginPath();
        ctx.arc(sample.randomEvent.x, sample.randomEvent.z, 9 / zoom, 0, TAU);
        ctx.strokeStyle = "#38bdf8";
        ctx.lineWidth = 2.2 / zoom;
        ctx.stroke();
      }

      // Speed Traps
      if (layers.traps) {
        const trapStatus = new Map((sample?.traps ?? []).map((t) => [t.id, t.beaten]));
        for (const tr of WESTGATE_SPEED_TRAPS) {
          const beaten = trapStatus.get(tr.id) ?? false;
          const isSel = selectedMarker?.kind === "trap" && selectedMarker.id === tr.id;
          const s = (isSel ? 9 : 6.5) / zoom;
          ctx.save();
          ctx.translate(tr.x, tr.z);
          ctx.rotate(Math.PI / 4);
          ctx.fillStyle = beaten ? "#e5a93c" : "#38bdf8";
          ctx.fillRect(-s * 0.5, -s * 0.5, s, s);
          ctx.lineWidth = 1.5 / zoom;
          ctx.strokeStyle = "#07080b";
          ctx.strokeRect(-s * 0.5, -s * 0.5, s, s);
          ctx.restore();
        }
      }

      // Contract Beacons (C0–C6)
      if (layers.contracts) {
        const cMap = new Map((sample?.contracts ?? []).map((c) => [c.missionId, c]));
        for (const c of WESTGATE_CONTRACT_SPOTS) {
          const st = cMap.get(c.missionId);
          const m = MISSIONS.find((mi) => mi.id === c.missionId);
          const isSel = selectedMarker?.kind === "contract" && selectedMarker.missionId === c.missionId;
          const col = st?.completed ? "#2dd4bf" : st?.unlocked === false ? "#64748b" : m?.accent ?? "#ff3b30";
          const sz = (isSel ? 11 : 8) / zoom;
          ctx.beginPath();
          ctx.moveTo(c.x, c.z - sz);
          ctx.lineTo(c.x + sz, c.z);
          ctx.lineTo(c.x, c.z + sz);
          ctx.lineTo(c.x - sz, c.z);
          ctx.closePath();
          ctx.fillStyle = col;
          ctx.fill();
          ctx.lineWidth = 1.8 / zoom;
          ctx.strokeStyle = "#07080b";
          ctx.stroke();

          ctx.font = `700 ${Math.max(10, 11 / zoom)}px ui-monospace, monospace`;
          ctx.fillStyle = "#f2efe9";
          ctx.textAlign = "left";
          ctx.textBaseline = "middle";
          ctx.fillText(`C${c.missionId}`, c.x + sz * 1.25, c.z);
        }
      }

      // Active Waypoint Crosshair
      if (activeTarget) {
        const pulse = 0.75 + 0.25 * Math.sin(now * 0.007);
        const col = activeTarget.isCustom ? "#ff3b30" : "#38bdf8";
        ctx.beginPath();
        ctx.arc(activeTarget.x, activeTarget.z, (16 * pulse) / zoom, 0, TAU);
        ctx.strokeStyle = col;
        ctx.lineWidth = 2 / zoom;
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(activeTarget.x, activeTarget.z, 5.5 / zoom, 0, TAU);
        ctx.fillStyle = col;
        ctx.fill();
      }

      // Player Chevron
      if (sample) {
        ctx.save();
        ctx.translate(sample.x, sample.z);
        ctx.rotate(sample.heading);
        const ps = 10 / zoom;
        ctx.beginPath();
        ctx.moveTo(0, -ps * 1.25);
        ctx.lineTo(ps * 0.9, ps);
        ctx.lineTo(0, ps * 0.45);
        ctx.lineTo(-ps * 0.9, ps);
        ctx.closePath();
        ctx.fillStyle = "#f2efe9";
        ctx.fill();
        ctx.lineWidth = 2 / zoom;
        ctx.strokeStyle = "#ff3b30";
        ctx.stroke();
        ctx.restore();
      }

      ctx.restore();
    };

    raf = requestAnimationFrame(render);
    return () => cancelAnimationFrame(raf);
  }, [activeTarget, compiled, data, getSample, layers, selectedMarker]);

  const screenToWorld = (clientX: number, clientY: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, z: 0 };
    const rect = canvas.getBoundingClientRect();
    const { cx, cz, zoom } = viewRef.current;
    return {
      x: cx + (clientX - rect.left - rect.width / 2) / zoom,
      z: cz + (clientY - rect.top - rect.height / 2) / zoom,
    };
  };

  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (e.button === 2) {
      e.preventDefault();
      onSetGpsTarget(null, null);
      setSelectedMarker(null);
      return;
    }
    if (e.button !== 0) return;
    dragRef.current = {
      active: true,
      moved: false,
      startX: e.clientX,
      startY: e.clientY,
      cx: viewRef.current.cx,
      cz: viewRef.current.cz,
    };
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const w = screenToWorld(e.clientX, e.clientY);
    const dist = getDistrictAt(w.x, w.z);
    setCursorWorld({ x: Math.round(w.x), z: Math.round(w.z), district: dist.name });

    const d = dragRef.current;
    if (!d.active) return;
    const dx = e.clientX - d.startX;
    const dy = e.clientY - d.startY;
    if (Math.hypot(dx, dy) > 5) d.moved = true;
    if (d.moved) {
      viewRef.current.cx = clamp(d.cx - dx / viewRef.current.zoom, -1300, 1300);
      viewRef.current.cz = clamp(d.cz - dy / viewRef.current.zoom, -1300, 1300);
    }
  };

  const handleMouseUp = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const d = dragRef.current;
    d.active = false;
    if (e.button !== 0 || d.moved) return;

    const w = screenToWorld(e.clientX, e.clientY);
    const hitRadius = 18 / viewRef.current.zoom;
    let best: MarkerHit | null = null;
    let bestDist = hitRadius;
    for (const mk of allMarkers) {
      if (mk.kind === "contract" && !layers.contracts) continue;
      if (mk.kind === "trap" && !layers.traps) continue;
      if (mk.kind === "sector" && !layers.sectors) continue;
      const dist = Math.hypot(mk.x - w.x, mk.z - w.z);
      if (dist < bestDist) {
        bestDist = dist;
        best = mk;
      }
    }

    if (best) {
      setSelectedMarker(best);
      if (best.kind === "contract") {
        onSetGpsTarget(`contract:${best.missionId}`, null);
      } else if (best.kind === "sector") {
        onSetGpsTarget(best.id, null);
      } else {
        onSetGpsTarget("custom", { id: "custom", label: best.label, x: best.x, z: best.z, isCustom: true });
      }
    } else {
      const distInfo = getDistrictAt(w.x, w.z);
      setSelectedMarker(null);
      onSetGpsTarget("custom", {
        id: "custom",
        label: `Custom Pin · ${distInfo.name}`,
        x: Math.round(w.x),
        z: Math.round(w.z),
        isCustom: true,
      });
    }
  };

  const handleWheel = (e: React.WheelEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const before = screenToWorld(e.clientX, e.clientY);
    const factor = e.deltaY < 0 ? 1.16 : 0.86;
    const nextZoom = clamp(viewRef.current.zoom * factor, 0.22, 3.2);
    viewRef.current.zoom = nextZoom;
    viewRef.current.cx = clamp(before.x - (e.clientX - rect.left - rect.width / 2) / nextZoom, -1300, 1300);
    viewRef.current.cz = clamp(before.z - (e.clientY - rect.top - rect.height / 2) / nextZoom, -1300, 1300);
    setZoomPct(Math.round(nextZoom * 100));
  };

  const centerOnPlayer = () => {
    const s = getSample(2600);
    if (!s) return;
    viewRef.current.cx = s.x;
    viewRef.current.cz = s.z;
    viewRef.current.zoom = 0.65;
    setZoomPct(65);
  };

  const fitIsland = () => {
    viewRef.current = { cx: 0, cz: -40, zoom: 0.3 };
    setZoomPct(30);
  };

  return (
    <div className="absolute inset-0 z-50 flex flex-col bg-[#07080b]/96 backdrop-blur-md">
      {/* Top Cartographic Command Bar */}
      <header className="flex flex-wrap items-center justify-between gap-4 border-b border-white/12 bg-[#0b0d13] px-5 py-3">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2 font-mono text-[10px] font-bold uppercase tracking-[0.28em] text-[#38bdf8]">
            <Compass className="size-4" />
            <span>WESTGATE BAY // TACTICAL SAT-MAP</span>
          </div>
          <span className="hidden border-l border-white/15 pl-4 font-mono text-[11px] uppercase tracking-wider text-[#8a909e] md:inline">
            X {cursorWorld.x}M · Z {cursorWorld.z}M · <b className="text-[#f2efe9]">{cursorWorld.district}</b>
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={centerOnPlayer}
            className="inline-flex cursor-pointer items-center gap-1.5 border border-white/15 bg-white/[0.04] px-3 py-1.5 font-mono text-[10px] font-bold uppercase tracking-wider text-[#f2efe9] transition hover:border-[#38bdf8]"
          >
            <Crosshair className="size-3.5 text-[#38bdf8]" />
            Center
          </button>
          <button
            onClick={fitIsland}
            className="inline-flex cursor-pointer items-center gap-1.5 border border-white/15 bg-white/[0.04] px-3 py-1.5 font-mono text-[10px] font-bold uppercase tracking-wider text-[#f2efe9] transition hover:border-white/40"
          >
            Fit Island
          </button>
          <span className="border border-white/12 px-2.5 py-1.5 font-mono text-[10px] text-[#8a909e] tabular-nums">
            {zoomPct}%
          </span>
          {activeTarget && (
            <button
              onClick={() => {
                onSetGpsTarget(null, null);
                setSelectedMarker(null);
              }}
              className="inline-flex cursor-pointer items-center gap-1.5 border border-[#ff3b30]/50 bg-[#ff3b30]/15 px-3 py-1.5 font-mono text-[10px] font-bold uppercase tracking-wider text-[#ff3b30] transition hover:bg-[#ff3b30] hover:text-[#07080b]"
            >
              <RotateCcw className="size-3" />
              Clear GPS
            </button>
          )}
          <button
            onClick={onClose}
            className="inline-flex cursor-pointer items-center gap-1.5 border border-white/20 bg-white/[0.06] px-3 py-1.5 font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-[#f2efe9] transition hover:bg-[#ff3b30] hover:text-[#07080b]"
          >
            <X className="size-3.5" />
            Close [M]
          </button>
        </div>
      </header>

      {/* Main Map Body + Inspector Rail */}
      <div className="relative flex flex-1 overflow-hidden">
        <canvas
          ref={canvasRef}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onWheel={handleWheel}
          onContextMenu={(e) => e.preventDefault()}
          className="h-full w-full flex-1 cursor-crosshair"
        />

        {/* Floating Left Layer & Legend Panel */}
        <aside className="pointer-events-auto absolute left-5 top-5 w-64 space-y-3">
          <div data-augmented-ui="tr-clip bl-clip border inlay" className="voss-panel-sharp p-3.5 space-y-2.5">
            <div className="flex items-center gap-2 font-mono text-[10px] font-bold uppercase tracking-[0.22em] text-[#8a909e]">
              <Layers className="size-3.5 text-[#38bdf8]" />
              <span>MAP LAYERS</span>
            </div>
            <div className="grid grid-cols-1 gap-1.5">
              {(
                [
                  ["contracts", "Contracts (C0–C6)", "#ff3b30"],
                  ["traps", "Speed Traps (10)", "#38bdf8"],
                  ["vehicles", "Live Vehicles", "#e5a93c"],
                  ["sectors", "Sector Nodes (22)", "#94a3b8"],
                  ["districts", "District Labels", "#f2efe9"],
                ] as const
              ).map(([key, label, dot]) => (
                <button
                  key={key}
                  onClick={() => setLayers((prev) => ({ ...prev, [key]: !prev[key] }))}
                  className={`flex cursor-pointer items-center justify-between border px-2.5 py-1.5 font-mono text-[10px] uppercase tracking-wider transition ${
                    layers[key]
                      ? "border-white/25 bg-white/[0.06] text-[#f2efe9]"
                      : "border-white/10 bg-black/40 text-[#64748b]"
                  }`}
                >
                  <span className="flex items-center gap-2">
                    <span className="h-2 w-2" style={{ background: layers[key] ? dot : "#334155" }} />
                    {label}
                  </span>
                  <span>{layers[key] ? "ON" : "OFF"}</span>
                </button>
              ))}
            </div>
            <div className="border-t border-white/10 pt-2 font-mono text-[9px] uppercase tracking-wider text-[#8a909e]">
              DRAG TO PAN · SCROLL TO ZOOM · LEFT-CLICK DROPS GPS PIN · RIGHT-CLICK CLEARS
            </div>
          </div>

          {/* Active Waypoint / Selected Marker Card */}
          {(activeTarget || selectedMarker) && (
            <div data-augmented-ui="tl-clip br-clip border inlay" className="voss-panel-sharp p-3.5 space-y-2.5">
              <div className="flex items-center justify-between font-mono text-[10px] font-bold uppercase tracking-[0.22em] text-[#38bdf8]">
                <span className="inline-flex items-center gap-1.5">
                  <Navigation className="size-3" />
                  ACTIVE WAYPOINT
                </span>
                {routeDist && <span className="text-[#f2efe9] tabular-nums">{routeDist}</span>}
              </div>
              <div>
                <div className="font-display text-lg font-extrabold uppercase leading-tight text-[#f2efe9]">
                  {selectedMarker?.label ?? activeTarget?.label}
                </div>
                <div className="mt-0.5 font-mono text-[10px] text-[#8a909e]">
                  {selectedMarker?.sub ?? `X ${Math.round(activeTarget!.x)} · Z ${Math.round(activeTarget!.z)} · Synced to Minimap`}
                </div>
              </div>
              {selectedMarker && (selectedMarker.kind === "sector" || selectedMarker.kind === "contract") && (
                <TacticalButton
                  tone="ice"
                  onClick={() => {
                    onFastTravel(selectedMarker.x, selectedMarker.z, selectedMarker.yawDeg);
                    onClose();
                  }}
                  className="w-full py-1.5 pb-2.5 text-[10px]"
                >
                  <Zap className="size-3.5" />
                  Fast Travel Here
                </TacticalButton>
              )}
              {!selectedMarker && activeTarget && (
                <TacticalButton
                  tone="ghost"
                  onClick={() => {
                    onFastTravel(activeTarget.x, activeTarget.z);
                    onClose();
                  }}
                  className="w-full py-1.5 pb-2.5 text-[10px]"
                >
                  <MapPin className="size-3.5" />
                  Deploy To Pin
                </TacticalButton>
              )}
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
