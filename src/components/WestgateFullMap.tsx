import { useEffect, useMemo, useRef, useState } from "react";
import { Compass, Crosshair, Layers, MapPin, Navigation, RotateCcw, X, Zap } from "lucide-react";
import { computeWestgateGpsRoute, type MinimapData } from "../game/city/MinimapData";
import { WESTGATE_CONTRACT_SPOTS, WESTGATE_SPEED_TRAPS } from "../game/city/WestgateActivities";
import { WESTGATE_TELEPORTS } from "../game/city/WestgateMeta";
import { getDistrictAt, rawWestgateTerrainHeight } from "../game/city/WestgateTerrain";
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
  { name: "VINEWOOD FOOTHILLS", sub: "OBSERVATORY RIDGE", x: -155, z: -840 },
  { name: "NORTH GORGE", sub: "CANYON HIGHWAY", x: 325, z: -615 },
  { name: "DOWNTOWN", sub: "FINANCIAL CORE", x: 95, z: -135 },
  { name: "MIDTOWN", sub: "COMMERCIAL & MEDICAL", x: -295, z: -165 },
  { name: "WEST COAST", sub: "DEL SOL & CANALS", x: -655, z: 45 },
  { name: "OLD QUARTER", sub: "RESIDENTIAL & PARK", x: -190, z: 345 },
  { name: "EAST INDUSTRIAL", sub: "SEAPORT & DOCKS", x: 565, z: 335 },
  { name: "SOUTH AIRPORT", sub: "WIA INT'L & ARENA", x: -145, z: 815 },
];

const HIGHWAY_SHIELDS: { code: string; x: number; z: number; tone: string }[] = [
  { code: "I-5", x: 255, z: -435, tone: "#38bdf8" },
  { code: "I-5", x: 255, z: 420, tone: "#38bdf8" },
  { code: "US-1", x: -705, z: -360, tone: "#e5a93c" },
  { code: "SR-101", x: -45, z: 590, tone: "#2dd4bf" },
];

const WORLD_MIN = -1300;
const WORLD_MAX = 1300;
const WORLD_SPAN = WORLD_MAX - WORLD_MIN; // 2600m
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

/**
 * Generates a high-resolution offscreen topographic + bathymetric + hillshaded
 * satellite atlas for Westgate Bay (-1300m..+1300m) using the real terrain heightfield.
 */
function bakeTopographicAtlas(size = 1024): HTMLCanvasElement {
  const off = document.createElement("canvas");
  off.width = size;
  off.height = size;
  const ctx = off.getContext("2d")!;
  const img = ctx.createImageData(size, size);
  const px = img.data;

  const step = WORLD_SPAN / size;
  // Precompute height grid for crisp NW-sun hillshading and elevation contours
  const hGrid = new Float32Array((size + 1) * (size + 1));
  for (let py = 0; py <= size; py++) {
    const wz = WORLD_MIN + py * step;
    const row = py * (size + 1);
    for (let pxI = 0; pxI <= size; pxI++) {
      const wx = WORLD_MIN + pxI * step;
      hGrid[row + pxI] = rawWestgateTerrainHeight(wx, wz);
    }
  }

  for (let py = 0; py < size; py++) {
    const wz = WORLD_MIN + (py + 0.5) * step;
    const row = py * (size + 1);
    const nextRow = (py + 1) * (size + 1);
    for (let pxI = 0; pxI < size; pxI++) {
      const wx = WORLD_MIN + (pxI + 0.5) * step;
      const h = hGrid[row + pxI];
      const hx = hGrid[row + pxI + 1];
      const hz = hGrid[nextRow + pxI];

      let r = 28;
      let g = 34;
      let b = 29;

      if (h <= 0.04) {
        // Bathymetric ocean / river / harbor / canal depth shading
        const depth = clamp(-h / 8.5, 0, 1);
        const shelf = Math.exp(-Math.max(0, -h) * 0.55);
        r = Math.round(11 + shelf * 14 - depth * 4);
        g = Math.round(28 + shelf * 28 - depth * 12);
        b = Math.round(44 + shelf * 30 - depth * 12);
        // Subtle shallow coastal surf glow
        if (h > -0.45) {
          r += 14;
          g += 24;
          b += 26;
        }
      } else {
        // Landcover zoning + NW directional hillshade
        const dhdx = (hx - h) / step;
        const dhdz = (hz - h) / step;
        const shade = clamp((-dhdx * 0.65 - dhdz * 0.65) * 1.45, -0.32, 0.36);

        // Coastal sandy beach band (elev 0.04..1.9m near coastline/bay)
        if (h < 1.85 && (wx < -610 || wz > 960)) {
          r = 96;
          g = 90;
          b = 72;
        } else if (wz > 650 && wx > -440 && wx < 220) {
          // South Airport apron & tarmac zone
          r = 38;
          g = 42;
          b = 48;
        } else if (wx > 380 && wz > -360 && wz < 960) {
          // East Industrial & Seaport concrete yards
          r = 43;
          g = 46;
          b = 50;
        } else if (wx > -450 && wx < 310 && wz > -440 && wz < 170) {
          // Downtown & Midtown urban core
          r = 40;
          g = 44;
          b = 49;
          // Central park / civic plazas tint
          if (wx > -220 && wx < 10 && wz > 280 && wz < 460) {
            r = 33;
            g = 52;
            b = 34;
          }
        } else if (wx > -220 && wx < 20 && wz > 280 && wz < 460) {
          // Old Quarter Central Park
          r = 34;
          g = 56;
          b = 36;
        } else {
          // Foothills / Suburbs / Natural greenery by altitude
          const elevT = clamp((h - 2.5) / 56, 0, 1);
          r = Math.round(33 + elevT * 26);
          g = Math.round(47 + elevT * 14 - elevT * elevT * 8);
          b = Math.round(33 + elevT * 14);
        }

        // Subtle urban parcel micro-grid in city districts
        if (wx > -560 && wx < 520 && wz > -420 && wz < 580 && h > 1.8 && h < 10.5) {
          const gx = Math.abs(((wx + 2000) % 52) - 26);
          const gz = Math.abs(((wz + 2000) % 52) - 26);
          if (gx < 1.6 || gz < 1.6) {
            r -= 4;
            g -= 4;
            b -= 4;
          }
        }

        // Topographic elevation contour lines every 7.5m on hills
        if (h > 6.5) {
          const c0 = Math.floor(h / 7.5);
          const cx = Math.floor(hx / 7.5);
          const cz = Math.floor(hz / 7.5);
          if (c0 !== cx || c0 !== cz) {
            r += 16;
            g += 18;
            b += 14;
          }
        }

        const light = 1 + shade;
        r = clamp(Math.round(r * light), 0, 255);
        g = clamp(Math.round(g * light), 0, 255);
        b = clamp(Math.round(b * light), 0, 255);
      }

      const idx = (py * size + pxI) * 4;
      px[idx] = r;
      px[idx + 1] = g;
      px[idx + 2] = b;
      px[idx + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);

  // Subtle shoreline crisp coastline highlight pass
  return off;
}

function drawOutlinedText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  fill: string,
  stroke = "rgba(7, 10, 15, 0.88)",
  strokeWidth = 3,
) {
  ctx.lineJoin = "round";
  ctx.lineWidth = strokeWidth;
  ctx.strokeStyle = stroke;
  ctx.strokeText(text, x, y);
  ctx.fillStyle = fill;
  ctx.fillText(text, x, y);
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
  const viewRef = useRef({ cx: 0, cz: -40, zoom: 0.36 });
  const dragRef = useRef<{ active: boolean; moved: boolean; startX: number; startY: number; cx: number; cz: number }>({
    active: false,
    moved: false,
    startX: 0,
    startY: 0,
    cx: 0,
    cz: -40,
  });

  const [zoomPct, setZoomPct] = useState(36);
  const [cursorWorld, setCursorWorld] = useState<{ x: number; z: number; district: string; elev: number }>({
    x: 0,
    z: 0,
    district: "Downtown Westgate",
    elev: 4,
  });
  const [layers, setLayers] = useState({
    districts: true,
    contracts: true,
    traps: true,
    vehicles: true,
    sectors: true,
  });
  const [selectedMarker, setSelectedMarker] = useState<MarkerHit | null>(null);
  const [hoveredMarker, setHoveredMarker] = useState<{ marker: MarkerHit; sx: number; sy: number } | null>(null);
  const [routeDist, setRouteDist] = useState<string | null>(null);

  const activeTarget = useMemo(
    () => resolveGpsTarget(gpsTargetId, customWaypoint),
    [gpsTargetId, customWaypoint],
  );

  // Bake high-res hillshaded terrain atlas once
  const terrainAtlas = useMemo(() => {
    if (typeof document === "undefined") return null;
    return bakeTopographicAtlas(1024);
  }, []);

  const compiled = useMemo(() => {
    const roadPaths = data.roads.map((r) => ({
      path: buildPath(r.pts),
      width: Math.max(5.5, r.width),
      isBridge: r.isBridge,
      tier: r.tier,
      pts: r.pts,
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
      viewRef.current = { cx: s.x, cz: s.z, zoom: 0.45 };
      setZoomPct(45);
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
      const dpr = Math.min(3.0, window.devicePixelRatio || 1);
      const w = Math.round(rect.width * dpr);
      const h = Math.round(rect.height * dpr);
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }

      const sample = getSample(2600);
      const { cx, cz, zoom } = viewRef.current;

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = "#08141f";
      ctx.fillRect(0, 0, rect.width, rect.height);

      ctx.save();
      ctx.translate(rect.width / 2, rect.height / 2);
      ctx.scale(zoom, zoom);
      ctx.translate(-cx, -cz);

      // 1. Baked High-Res Topographic Satellite + Bathymetry Atlas
      if (terrainAtlas) {
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = "high";
        ctx.drawImage(terrainAtlas, WORLD_MIN, WORLD_MIN, WORLD_SPAN, WORLD_SPAN);
      }

      // 2. Cartographic Lat/Lon Sector Grid + Coordinate Labels
      ctx.strokeStyle = "rgba(186, 212, 224, 0.085)";
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

      // 3. Detailed Landmarks: Airport Runways, Taxiways, Port Piers, Park Pond & City Blocks
      // Old Quarter Central Park trails & pond
      ctx.fillStyle = "rgba(21, 56, 72, 0.92)";
      ctx.beginPath();
      ctx.ellipse(-95, 372, 34, 21, -0.25, 0, TAU);
      ctx.fill();
      ctx.strokeStyle = "rgba(212, 210, 194, 0.28)";
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      ctx.ellipse(-95, 372, 42, 28, -0.25, 0, TAU);
      ctx.stroke();

      // East Seaport Shipping Berths & Piers
      ctx.fillStyle = "#31363d";
      for (const pz of [540, 650, 760, 870]) {
        ctx.fillRect(452, pz, 88, 22);
        ctx.strokeStyle = "rgba(229, 169, 60, 0.32)";
        ctx.lineWidth = 1.4;
        ctx.strokeRect(452, pz, 88, 22);
      }

      // Westgate International Airport (South Airport): Apron, Terminal, Dual Runways & Taxiways
      ctx.fillStyle = "#262c34";
      ctx.fillRect(-380, 765, 480, 200);
      ctx.fillStyle = "#353c46";
      ctx.fillRect(-260, 772, 160, 32); // Terminal concourse footprint
      // Taxiways
      ctx.strokeStyle = "#303640";
      ctx.lineWidth = 11;
      ctx.beginPath();
      ctx.moveTo(-340, 804);
      ctx.lineTo(75, 804);
      for (const tx of [-320, -195, -70, 55]) {
        ctx.moveTo(tx, 804);
        ctx.lineTo(tx, 932);
      }
      ctx.stroke();
      // Parallel Runways 09L/27R and 09R/27L
      for (const ry of [832, 916]) {
        ctx.fillStyle = "#161a20";
        ctx.fillRect(-355, ry - 14, 435, 28);
        ctx.strokeStyle = "rgba(248, 250, 252, 0.52)";
        ctx.lineWidth = 1.6;
        ctx.strokeRect(-355, ry - 14, 435, 28);
        // Centerline dashes
        ctx.strokeStyle = "rgba(248, 250, 252, 0.72)";
        ctx.lineWidth = 1.8;
        ctx.setLineDash([12, 10]);
        ctx.beginPath();
        ctx.moveTo(-328, ry);
        ctx.lineTo(54, ry);
        ctx.stroke();
        ctx.setLineDash([]);
        // Threshold piano keys
        ctx.fillStyle = "rgba(248, 250, 252, 0.65)";
        for (let k = -9; k <= 9; k += 4) {
          ctx.fillRect(-350, ry + k - 1, 10, 2);
          ctx.fillRect(65, ry + k - 1, 10, 2);
        }
      }

      // Scenic coastline trail
      ctx.strokeStyle = "rgba(244, 155, 118, 0.42)";
      ctx.lineWidth = 3.2 / zoom;
      ctx.setLineDash([10 / zoom, 7 / zoom]);
      ctx.stroke(compiled.coralPath);
      ctx.setLineDash([]);

      // 4. Multi-Pass Crisp Vector Road Cartography
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      // Pass A: Soft outer casing / bridge shadow
      for (const r of compiled.roadPaths) {
        ctx.strokeStyle = r.isBridge ? "rgba(4, 7, 12, 0.85)" : "#0b0e13";
        ctx.lineWidth = r.width + (r.tier === "freeway" ? 5.6 : 3.6) / zoom;
        ctx.stroke(r.path);
      }
      // Pass B: Carriageway asphalt fill
      for (const r of compiled.roadPaths) {
        ctx.strokeStyle = r.tier === "freeway" ? "#4b5563" : r.isBridge ? "#64748b" : r.tier === "arterial" ? "#374151" : "#272e38";
        ctx.lineWidth = r.width;
        ctx.stroke(r.path);
      }
      // Pass C: Highway golden median / bridge truss rails / arterial centerline
      for (const r of compiled.roadPaths) {
        if (r.tier === "freeway") {
          ctx.strokeStyle = "rgba(245, 185, 66, 0.72)";
          ctx.lineWidth = Math.max(1.2, 1.8 / zoom);
          ctx.stroke(r.path);
        } else if (r.isBridge) {
          ctx.strokeStyle = "rgba(186, 230, 253, 0.48)";
          ctx.lineWidth = Math.max(1.0, 1.4 / zoom);
          ctx.stroke(r.path);
        } else if (r.tier === "arterial" && zoom >= 0.48) {
          ctx.strokeStyle = "rgba(226, 232, 240, 0.25)";
          ctx.lineWidth = 1.0 / zoom;
          ctx.setLineDash([8 / zoom, 8 / zoom]);
          ctx.stroke(r.path);
          ctx.setLineDash([]);
        }
      }

      // Roundabouts with landscaped central island
      for (const rb of data.roundabouts) {
        ctx.beginPath();
        ctx.arc(rb.x, rb.z, (rb.innerR + rb.outerR) * 0.5, 0, TAU);
        ctx.strokeStyle = "#0b0e13";
        ctx.lineWidth = rb.outerR - rb.innerR + 3 / zoom;
        ctx.stroke();

        ctx.beginPath();
        ctx.arc(rb.x, rb.z, (rb.innerR + rb.outerR) * 0.5, 0, TAU);
        ctx.strokeStyle = "#475569";
        ctx.lineWidth = rb.outerR - rb.innerR;
        ctx.stroke();

        ctx.beginPath();
        ctx.arc(rb.x, rb.z, Math.max(2, rb.innerR - 1), 0, TAU);
        ctx.fillStyle = "#2b452f";
        ctx.fill();
      }

      // 5. Active GPS Road Route with Halo & Animated Flow Chevrons
      if (sample && activeTarget) {
        const route = computeWestgateGpsRoute(data, sample.x, sample.z, activeTarget.x, activeTarget.z);
        if (route.length >= 2) {
          ctx.beginPath();
          ctx.moveTo(route[0][0], route[0][1]);
          for (let i = 1; i < route.length; i++) ctx.lineTo(route[i][0], route[i][1]);
          ctx.strokeStyle = activeTarget.isCustom ? "rgba(255, 59, 48, 0.34)" : "rgba(56, 189, 248, 0.36)";
          ctx.lineWidth = 11 / zoom;
          ctx.stroke();

          ctx.strokeStyle = activeTarget.isCustom ? "#ff453a" : "#38bdf8";
          ctx.lineWidth = 4.2 / zoom;
          ctx.stroke();

          ctx.strokeStyle = "#f8fafc";
          ctx.lineWidth = 1.6 / zoom;
          ctx.setLineDash([7 / zoom, 11 / zoom]);
          ctx.lineDashOffset = -(now * 0.03) / zoom;
          ctx.stroke();
          ctx.setLineDash([]);
          ctx.lineDashOffset = 0;
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

      // 6. Highway Shields & Cartographic District Typography
      if (layers.districts) {
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        for (const sh of HIGHWAY_SHIELDS) {
          const bw = 30 / zoom;
          const bh = 16 / zoom;
          ctx.fillStyle = "rgba(11, 15, 22, 0.92)";
          ctx.strokeStyle = sh.tone;
          ctx.lineWidth = 1.4 / zoom;
          ctx.beginPath();
          ctx.roundRect(sh.x - bw * 0.5, sh.z - bh * 0.5, bw, bh, 3 / zoom);
          ctx.fill();
          ctx.stroke();
          ctx.font = `700 ${Math.max(8, 9.5 / zoom)}px ui-monospace, monospace`;
          ctx.fillStyle = sh.tone;
          ctx.fillText(sh.code, sh.x, sh.z + 0.5 / zoom);
        }

        for (const d of DISTRICT_LABELS) {
          const fs = clamp(12.5 / zoom, 10.5, 42);
          ctx.font = `800 ${fs}px "Space Grotesk", ui-sans-serif, system-ui, sans-serif`;
          drawOutlinedText(ctx, d.name, d.x, d.z, "rgba(241, 245, 249, 0.78)", "rgba(7, 10, 15, 0.85)", Math.max(2, 3.2 / zoom));
          if (zoom >= 0.34) {
            const subFs = clamp(8.5 / zoom, 7.5, 22);
            ctx.font = `600 ${subFs}px "JetBrains Mono", ui-monospace, monospace`;
            drawOutlinedText(ctx, d.sub, d.x, d.z + fs * 0.92, "rgba(148, 163, 184, 0.75)", "rgba(7, 10, 15, 0.85)", Math.max(1.5, 2.2 / zoom));
          }
        }
      }

      // 7. Sector Fast-Travel Nodes & Residences (crisp house & node badges)
      if (layers.sectors) {
        const ownedApts = new Set(loadSave().ownedApartments ?? []);
        for (const apt of APARTMENTS) {
          const isSel = selectedMarker?.kind === "sector" && selectedMarker.id === apt.id;
          const owned = ownedApts.has(apt.id);
          const s = (isSel ? 9 : 6.8) / zoom;
          const x = apt.exitStreetPos.x;
          const z = apt.exitStreetPos.z;
          // House silhouette
          ctx.beginPath();
          ctx.moveTo(x, z - s * 0.85);
          ctx.lineTo(x + s * 0.8, z - s * 0.1);
          ctx.lineTo(x + s * 0.6, z - s * 0.1);
          ctx.lineTo(x + s * 0.6, z + s * 0.75);
          ctx.lineTo(x - s * 0.6, z + s * 0.75);
          ctx.lineTo(x - s * 0.6, z - s * 0.1);
          ctx.lineTo(x - s * 0.8, z - s * 0.1);
          ctx.closePath();
          ctx.fillStyle = owned ? "#10b981" : "#f59e0b";
          ctx.fill();
          ctx.lineWidth = 1.5 / zoom;
          ctx.strokeStyle = "#070a0f";
          ctx.stroke();
        }
        for (const tp of WESTGATE_TELEPORTS) {
          const isSel = selectedMarker?.kind === "sector" && selectedMarker.id === tp.id;
          const isHome = tp.id === "safehouse";
          const r = (isHome ? (isSel ? 8.5 : 6.2) : isSel ? 6.8 : 4.2) / zoom;
          ctx.beginPath();
          ctx.arc(tp.x, tp.z, r, 0, TAU);
          ctx.fillStyle = isHome ? "#fbbf24" : isSel ? "#f2efe9" : "rgba(148, 163, 184, 0.82)";
          ctx.fill();
          ctx.lineWidth = 1.4 / zoom;
          ctx.strokeStyle = "#080a0f";
          ctx.stroke();
        }
      }

      // 8. Live Traffic, Police, Mod Garages, Stores, Races, Boats & Aircraft
      if (layers.vehicles && sample) {
        for (const v of sample.vehicles) {
          const sz = (v.isNpc ? 2.8 : 5.0) / zoom;
          ctx.fillStyle = v.isNpc ? "rgba(226, 232, 240, 0.58)" : "#fbbf24";
          ctx.fillRect(v.x - sz * 0.5, v.z - sz * 0.5, sz, sz);
        }
        if (sample.police) {
          const redFlash = Math.floor(now / 180) % 2 === 0;
          for (const p of sample.police) {
            ctx.beginPath();
            ctx.arc(p.x, p.z, 5.8 / zoom, 0, TAU);
            ctx.fillStyle = redFlash ? "#ef4444" : "#3b82f6";
            ctx.fill();
            ctx.lineWidth = 1.5 / zoom;
            ctx.strokeStyle = "#ffffff";
            ctx.stroke();
          }
        }
      }
      if (sample?.garages) {
        const gs = 7.2 / zoom;
        for (const g of sample.garages) {
          ctx.beginPath();
          ctx.arc(g.x, g.z, gs * 0.72, 0, TAU);
          ctx.fillStyle = "#9333ea";
          ctx.fill();
          ctx.lineWidth = 1.5 / zoom;
          ctx.strokeStyle = "#f8fafc";
          ctx.stroke();
        }
      }
      if (sample?.stores) {
        for (const st of sample.stores) {
          ctx.beginPath();
          ctx.arc(st.x, st.z, 4.6 / zoom, 0, TAU);
          ctx.fillStyle = "#22c55e";
          ctx.fill();
          ctx.lineWidth = 1.3 / zoom;
          ctx.strokeStyle = "#07080b";
          ctx.stroke();
        }
      }
      if (sample?.races) {
        for (const r of sample.races) {
          ctx.beginPath();
          ctx.arc(r.x, r.z, 5.8 / zoom, 0, TAU);
          ctx.fillStyle = "#f59e0b";
          ctx.fill();
          ctx.lineWidth = 1.5 / zoom;
          ctx.strokeStyle = "#07080b";
          ctx.stroke();
        }
      }
      if (sample?.stunts) {
        for (const sj of sample.stunts) {
          const sz = 4.4 / zoom;
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
          ctx.arc(st.x, st.z, 3.4 / zoom, 0, TAU);
          ctx.fillStyle = "#fde047";
          ctx.fill();
        }
      }
      if (sample?.boats) {
        for (const bt of sample.boats) {
          const sz = (bt.isStarter ? 6.4 : 5.0) / zoom;
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
          const sz = 6.0 / zoom;
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

      // 9. Speed Traps
      if (layers.traps) {
        const trapStatus = new Map((sample?.traps ?? []).map((t) => [t.id, t.beaten]));
        for (const tr of WESTGATE_SPEED_TRAPS) {
          const beaten = trapStatus.get(tr.id) ?? false;
          const isSel = selectedMarker?.kind === "trap" && selectedMarker.id === tr.id;
          const s = (isSel ? 8.5 : 6.0) / zoom;
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

      // 10. Contract Beacons (C0–C6)
      if (layers.contracts) {
        const cMap = new Map((sample?.contracts ?? []).map((c) => [c.missionId, c]));
        for (const c of WESTGATE_CONTRACT_SPOTS) {
          const st = cMap.get(c.missionId);
          const m = MISSIONS.find((mi) => mi.id === c.missionId);
          const isSel = selectedMarker?.kind === "contract" && selectedMarker.missionId === c.missionId;
          const col = st?.completed ? "#2dd4bf" : st?.unlocked === false ? "#64748b" : m?.accent ?? "#ff3b30";
          const sz = (isSel ? 10.5 : 7.8) / zoom;
          // Outer soft halo
          ctx.beginPath();
          ctx.arc(c.x, c.z, sz * 1.45, 0, TAU);
          ctx.fillStyle = "rgba(0, 0, 0, 0.45)";
          ctx.fill();

          ctx.beginPath();
          ctx.moveTo(c.x, c.z - sz);
          ctx.lineTo(c.x + sz, c.z);
          ctx.lineTo(c.x, c.z + sz);
          ctx.lineTo(c.x - sz, c.z);
          ctx.closePath();
          ctx.fillStyle = col;
          ctx.fill();
          ctx.lineWidth = 1.8 / zoom;
          ctx.strokeStyle = "#f8fafc";
          ctx.stroke();

          ctx.font = `700 ${Math.max(10, 10.5 / zoom)}px ui-monospace, monospace`;
          ctx.textAlign = "left";
          ctx.textBaseline = "middle";
          drawOutlinedText(ctx, `C${c.missionId}`, c.x + sz * 1.3, c.z, "#f8fafc", "rgba(7, 10, 15, 0.92)", Math.max(2, 2.5 / zoom));
        }
      }

      // 11. Active Waypoint Crosshair
      if (activeTarget) {
        const pulse = 0.75 + 0.25 * Math.sin(now * 0.007);
        const col = activeTarget.isCustom ? "#ff3b30" : "#38bdf8";
        ctx.beginPath();
        ctx.arc(activeTarget.x, activeTarget.z, (16 * pulse) / zoom, 0, TAU);
        ctx.strokeStyle = col;
        ctx.lineWidth = 2 / zoom;
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(activeTarget.x, activeTarget.z, 5.2 / zoom, 0, TAU);
        ctx.fillStyle = col;
        ctx.fill();
      }

      // 12. Player Chevron
      if (sample) {
        ctx.save();
        ctx.translate(sample.x, sample.z);
        ctx.rotate(sample.heading);
        const ps = 9.5 / zoom;
        ctx.beginPath();
        ctx.arc(0, 0, ps * 1.65, 0, TAU);
        ctx.fillStyle = "rgba(255, 59, 48, 0.16)";
        ctx.fill();

        ctx.beginPath();
        ctx.moveTo(0, -ps * 1.25);
        ctx.lineTo(ps * 0.9, ps);
        ctx.lineTo(0, ps * 0.45);
        ctx.lineTo(-ps * 0.9, ps);
        ctx.closePath();
        ctx.fillStyle = "#f8fafc";
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
  }, [activeTarget, compiled, data, getSample, layers, selectedMarker, terrainAtlas]);

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

  const findMarkerNear = (wx: number, wz: number) => {
    const hitRadius = 18 / viewRef.current.zoom;
    let best: MarkerHit | null = null;
    let bestDist = hitRadius;
    for (const mk of allMarkers) {
      if (mk.kind === "contract" && !layers.contracts) continue;
      if (mk.kind === "trap" && !layers.traps) continue;
      if (mk.kind === "sector" && !layers.sectors) continue;
      const dist = Math.hypot(mk.x - wx, mk.z - wz);
      if (dist < bestDist) {
        bestDist = dist;
        best = mk;
      }
    }
    return best;
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
    const elev = Math.round(rawWestgateTerrainHeight(w.x, w.z));
    setCursorWorld({ x: Math.round(w.x), z: Math.round(w.z), district: dist.name, elev });

    const d = dragRef.current;
    if (!d.active) {
      const hit = findMarkerNear(w.x, w.z);
      if (hit && canvasRef.current) {
        const rect = canvasRef.current.getBoundingClientRect();
        setHoveredMarker({ marker: hit, sx: e.clientX - rect.left, sy: e.clientY - rect.top });
      } else {
        setHoveredMarker(null);
      }
      return;
    }
    setHoveredMarker(null);
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
    const best = findMarkerNear(w.x, w.z);

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
    viewRef.current = { cx: 0, cz: -40, zoom: 0.32 };
    setZoomPct(32);
  };

  // Dynamic metric scale bar length
  const zoomVal = Math.max(0.22, zoomPct / 100);
  const targetMeters = 110 / zoomVal;
  const scaleMeters = targetMeters >= 600 ? 500 : targetMeters >= 300 ? 250 : targetMeters >= 120 ? 100 : 50;
  const scalePx = Math.round(scaleMeters * zoomVal);

  return (
    <div className="absolute inset-0 z-50 flex flex-col bg-[#07080b]/96 backdrop-blur-md">
      {/* Top Cartographic Command Bar */}
      <header className="flex flex-wrap items-center justify-between gap-4 border-b border-white/12 bg-[#0b0d13] px-5 py-3">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2 font-mono text-[10px] font-bold uppercase tracking-[0.28em] text-[#38bdf8]">
            <Compass className="size-4" />
            <span>WESTGATE BAY // TOPOGRAPHIC SAT-ATLAS</span>
          </div>
          <span className="hidden border-l border-white/15 pl-4 font-mono text-[11px] uppercase tracking-wider text-[#8a909e] md:inline">
            X {cursorWorld.x}M · Z {cursorWorld.z}M · ELEV {cursorWorld.elev}M ·{" "}
            <b className="text-[#f2efe9]">{cursorWorld.district}</b>
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
          onMouseLeave={() => {
            dragRef.current.active = false;
            setHoveredMarker(null);
          }}
          onWheel={handleWheel}
          onContextMenu={(e) => e.preventDefault()}
          className="h-full w-full flex-1 cursor-crosshair"
        />

        {/* Hover Marker Tooltip */}
        {hoveredMarker && (
          <div
            className="pointer-events-none absolute z-20 max-w-xs border border-cyan-400/45 bg-[#090d14]/95 px-3 py-2 shadow-xl backdrop-blur-sm"
            style={{
              left: hoveredMarker.sx + 14,
              top: Math.max(12, hoveredMarker.sy - 14),
            }}
          >
            <div className="font-display text-sm font-bold uppercase tracking-wide text-[#f2efe9]">
              {hoveredMarker.marker.label}
            </div>
            <div className="font-mono text-[10px] text-[#94a3b8]">{hoveredMarker.marker.sub}</div>
          </div>
        )}

        {/* Bottom-Right Metric Scale Bar & Legend */}
        <div className="pointer-events-none absolute bottom-5 right-5 flex flex-col items-end gap-2">
          <div className="border border-white/15 bg-[#0a0d14]/88 px-3 py-2 backdrop-blur-sm">
            <div className="mb-1 flex items-center justify-between gap-4 font-mono text-[9px] uppercase tracking-widest text-[#94a3b8]">
              <span>SCALE</span>
              <span className="text-[#f2efe9]">{scaleMeters} M</span>
            </div>
            <div className="flex items-center">
              <div className="h-1.5 border-x border-b border-[#38bdf8]" style={{ width: `${scalePx}px` }} />
            </div>
          </div>
        </div>

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
                  ["sectors", "Residences & Nodes", "#10b981"],
                  ["districts", "Districts & Shields", "#f2efe9"],
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
