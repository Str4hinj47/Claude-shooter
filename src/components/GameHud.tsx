import { Check, Eye, EyeOff, Map as MapIcon, Pause, Play, Radio, ShieldAlert, Smartphone, Volume2, VolumeX } from "lucide-react";
import type { Game, HudState, ObjectiveState } from "../game/Game";
import type { GpsWaypoint } from "../game/city/GpsWaypoint";
import type { MissionDef } from "../game/story";
import type { CarId } from "../game/vehicles/catalog";
import type { ApartmentId, SaveData } from "../game/progression";
import { WestgateMinimap } from "./WestgateMinimap";
import { WestgateFullMap } from "./WestgateFullMap";
import { WeaponWheel } from "./WeaponWheel";
import { TacticalPhone } from "./TacticalPhone";

interface GameHudProps {
  hud: HudState;
  save: SaveData;
  gameRef: React.MutableRefObject<Game | null>;
  spreadPx: number;
  gpsTargetId: string | null;
  setGpsTargetId: (id: string | null) => void;
  customWaypoint: GpsWaypoint | null;
  setCustomWaypoint: (wp: GpsWaypoint | null) => void;
  onStartMission: (m: MissionDef) => void;
  onBuyCar: (carId: CarId) => void;
  onSelectCar: (carId: CarId, paintHex?: string | null) => void;
  onBuyApartment?: (id: ApartmentId) => void;
}

export function GameHud({
  hud,
  save,
  gameRef,
  spreadPx,
  gpsTargetId,
  setGpsTargetId,
  customWaypoint,
  setCustomWaypoint,
  onStartMission,
  onBuyCar,
  onSelectCar,
  onBuyApartment,
}: GameHudProps) {
  const healthPct = Math.max(0, Math.min(100, (hud.health / hud.maxHealth) * 100));

  return (
    <>
      {/* Subtle cinematic edge vignette & damage pulse */}
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_58%,rgba(0,0,0,0.52)_100%)]" />
      {hud.health < hud.maxHealth && !hud.dead && (
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            boxShadow: `inset 0 0 ${110 + (hud.maxHealth - hud.health)}px rgba(190,18,24,${Math.max(
              0,
              (hud.maxHealth - hud.health) / (hud.maxHealth * 1.45)
            )})`,
          }}
        />
      )}

      {/* Razor-sharp pixel-aligned tactical crosshair (zero CSS filter rasterization) */}
      {hud.phase !== "loading" &&
        !hud.dead &&
        !hud.showcase &&
        !hud.vehicle?.active &&
        !hud.holstered &&
        !hud.weaponWheelOpen &&
        !hud.mapOpen &&
        (() => {
          const gap = Math.round(Math.max(4, Math.min(26, spreadPx * 0.55)));
          const len = hud.ads ? 9 : 7;
          const accent = hud.takedownReady ? "#2dd4bf" : hud.ads ? "#38bdf8" : "#f8fafc";
          const circ = 2 * Math.PI * 16;
          return (
            <div className="pointer-events-none fixed inset-0 flex items-center justify-center">
              <svg
                width="101"
                height="101"
                viewBox="-50.5 -50.5 101 101"
                className="overflow-visible"
              >
                {hud.ads && (
                  <g>
                    <g transform="rotate(-11.7)">
                      <circle
                        cx="0"
                        cy="0"
                        r="22"
                        fill="none"
                        stroke="rgba(0,0,0,0.72)"
                        strokeWidth="2.4"
                        strokeDasharray="11.28 6"
                        shapeRendering="geometricPrecision"
                      />
                      <circle
                        cx="0"
                        cy="0"
                        r="22"
                        fill="none"
                        stroke="#38bdf8"
                        strokeWidth="1"
                        strokeDasharray="11.28 6"
                        opacity="0.9"
                        shapeRendering="geometricPrecision"
                      />
                    </g>
                    <g shapeRendering="crispEdges">
                      {/* Outer cardinal range ticks */}
                      <line x1="-31" y1="0" x2="-26" y2="0" stroke="rgba(0,0,0,0.85)" strokeWidth="3" />
                      <line x1="26" y1="0" x2="31" y2="0" stroke="rgba(0,0,0,0.85)" strokeWidth="3" />
                      <line x1="0" y1="26" x2="0" y2="31" stroke="rgba(0,0,0,0.85)" strokeWidth="3" />
                      <line x1="0" y1="-31" x2="0" y2="-26" stroke="rgba(0,0,0,0.85)" strokeWidth="3" />
                      <line x1="-30" y1="0" x2="-27" y2="0" stroke="#e2e8f0" strokeWidth="1" />
                      <line x1="27" y1="0" x2="30" y2="0" stroke="#e2e8f0" strokeWidth="1" />
                      <line x1="0" y1="27" y2="30" stroke="#e2e8f0" strokeWidth="1" />
                      <line x1="0" y1="-30" x2="0" y2="-27" stroke="#e2e8f0" strokeWidth="1" />
                      {/* Inner ADS crosshairs */}
                      <line x1="-16" y1="0" x2="-5" y2="0" stroke="rgba(0,0,0,0.88)" strokeWidth="3" />
                      <line x1="5" y1="0" x2="16" y2="0" stroke="rgba(0,0,0,0.88)" strokeWidth="3" />
                      <line x1="0" y1="5" x2="0" y2="16" stroke="rgba(0,0,0,0.88)" strokeWidth="3" />
                      <line x1="0" y1="-16" x2="0" y2="-5" stroke="rgba(0,0,0,0.88)" strokeWidth="3" />
                      <line x1="-15" y1="0" x2="-6" y2="0" stroke="#38bdf8" strokeWidth="1" />
                      <line x1="6" y1="0" x2="15" y2="0" stroke="#38bdf8" strokeWidth="1" />
                      <line x1="0" y1="6" x2="0" y2="15" stroke="#38bdf8" strokeWidth="1" />
                      <line x1="0" y1="-15" x2="0" y2="-6" stroke="#38bdf8" strokeWidth="1" />
                    </g>
                  </g>
                )}

                {!hud.ads && (
                  <g shapeRendering="crispEdges">
                    {/* Crisp 1px vector dark outline behind 1px bright core */}
                    <line x1={-gap - len - 1} y1="0" x2={-gap + 1} y2="0" stroke="rgba(0,0,0,0.9)" strokeWidth="3" />
                    <line x1={gap - 1} y1="0" x2={gap + len + 1} y2="0" stroke="rgba(0,0,0,0.9)" strokeWidth="3" />
                    <line x1="0" y1={-gap - len - 1} x2="0" y2={-gap + 1} stroke="rgba(0,0,0,0.9)" strokeWidth="3" />
                    <line x1="0" y1={gap - 1} x2="0" y2={gap + len + 1} stroke="rgba(0,0,0,0.9)" strokeWidth="3" />

                    <line x1={-gap - len} y1="0" x2={-gap} y2="0" stroke={accent} strokeWidth="1" />
                    <line x1={gap} y1="0" x2={gap + len} y2="0" stroke={accent} strokeWidth="1" />
                    <line x1="0" y1={-gap - len} x2="0" y2={-gap} stroke={accent} strokeWidth="1" />
                    <line x1="0" y1={gap} x2="0" y2={gap + len} stroke={accent} strokeWidth="1" />
                  </g>
                )}

                {hud.reloading && (
                  <g transform="rotate(-90)" shapeRendering="geometricPrecision">
                    <circle cx="0" cy="0" r="16" fill="none" stroke="rgba(0,0,0,0.6)" strokeWidth="3.2" />
                    <circle cx="0" cy="0" r="16" fill="none" stroke="rgba(255,255,255,0.18)" strokeWidth="1.8" />
                    <circle
                      cx="0"
                      cy="0"
                      r="16"
                      fill="none"
                      stroke="#f59e0b"
                      strokeWidth="2"
                      strokeDasharray={circ}
                      strokeDashoffset={circ * (1 - hud.reloadProgress)}
                    />
                  </g>
                )}

                {/* Pixel-locked surgical center dot (1px core + 1px dark border) */}
                <g shapeRendering="crispEdges">
                  <rect x="-1.5" y="-1.5" width="3" height="3" fill="rgba(0,0,0,0.92)" />
                  <rect x="-0.5" y="-0.5" width="1" height="1" fill={accent} />
                </g>

                {hud.hitMarker > 0 && (
                  <g shapeRendering="geometricPrecision" opacity={Math.min(1, hud.hitMarker * 6)}>
                    <g stroke="rgba(0,0,0,0.88)" strokeWidth="3.2" strokeLinecap="square">
                      <line x1="-11" y1="-11" x2="-5" y2="-5" />
                      <line x1="11" y1="-11" x2="5" y2="-5" />
                      <line x1="-11" y1="11" x2="-5" y2="5" />
                      <line x1="11" y1="11" x2="5" y2="5" />
                    </g>
                    <g stroke={hud.hitCrit ? "#fbbf24" : "#ff3b30"} strokeWidth={hud.hitCrit ? "2.1" : "1.6"} strokeLinecap="square">
                      <line x1="-11" y1="-11" x2="-5" y2="-5" />
                      <line x1="11" y1="-11" x2="5" y2="-5" />
                      <line x1="-11" y1="11" x2="-5" y2="5" />
                      <line x1="11" y1="11" x2="5" y2="5" />
                    </g>
                  </g>
                )}
              </svg>
            </div>
          );
        })()}

      {/* WEATHER SCREEN POLISH: Rain lens droplets & Snow frost corners */}
      {hud.isOpenWorld && hud.phase === "ready" && !hud.dead && (hud.weatherLabel === "Rain" || hud.weatherLabel === "Drizzle") && (
        <div
          className="pointer-events-none fixed inset-0 z-0"
          style={{
            background:
              "radial-gradient(circle at 14% 18%, rgba(186,230,253,0.14) 0 3px, transparent 5px), radial-gradient(circle at 83% 24%, rgba(186,230,253,0.16) 0 4px, transparent 6px), radial-gradient(circle at 22% 76%, rgba(186,230,253,0.12) 0 3px, transparent 5px), radial-gradient(circle at 76% 82%, rgba(186,230,253,0.15) 0 3.5px, transparent 5.5px), radial-gradient(circle at 52% 11%, rgba(186,230,253,0.12) 0 2.5px, transparent 4px)",
            boxShadow: "inset 0 0 85px rgba(14, 116, 144, 0.14)",
          }}
        />
      )}
      {hud.isOpenWorld && hud.phase === "ready" && !hud.dead && (hud.weatherLabel === "Snow" || hud.weatherLabel === "Flurries") && (
        <div
          className="pointer-events-none fixed inset-0 z-0"
          style={{
            boxShadow: "inset 0 0 110px rgba(224, 242, 254, 0.2)",
          }}
        />
      )}

      {/* Directional damage flash & low-HP vignette */}
      {hud.phase === "ready" && !hud.dead && (hud.damageFlash > 0.02 || hud.health < 30) && (
        <div
          className="pointer-events-none fixed inset-0 z-10"
          style={{
            boxShadow: `inset 0 0 ${Math.round(90 + hud.damageFlash * 70)}px rgba(220, 38, 38, ${Math.min(
              0.55,
              hud.damageFlash * 0.42 + (hud.health < 30 ? ((30 - hud.health) / 30) * 0.24 : 0),
            ).toFixed(3)})`,
          }}
        >
          {hud.damageFlash > 0.03 && (
            <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
              <svg width="240" height="240" viewBox="-120 -120 240 240" className="overflow-visible">
                <g transform={`rotate(${Math.round((hud.damageDirRad * 180) / Math.PI)})`} opacity={Math.min(1, hud.damageFlash)}>
                  <path
                    d="M -38 -88 A 96 96 0 0 1 38 -88 L 28 -74 A 78 78 0 0 0 -28 -74 Z"
                    fill="#ef4444"
                    stroke="#7f1d1d"
                    strokeWidth="1.5"
                  />
                </g>
              </svg>
            </div>
          )}
        </div>
      )}

      {/* Stealth awareness directional radial arcs (Far Cry / MGSV / Dishonored style) */}
      {hud.phase === "ready" &&
        !hud.dead &&
        !hud.showcase &&
        !hud.weaponWheelOpen &&
        !hud.mapOpen &&
        hud.stealthIndicators.length > 0 && (
          <div className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
            <svg width="200" height="200" viewBox="-100 -100 200 200" className="overflow-visible">
              {hud.stealthIndicators.map((ind) => {
                const deg = (ind.angle * 180) / Math.PI;
                const R = 72;
                const halfSpan = 22; // degrees each side of apex
                const totalArcLen = (2 * halfSpan * Math.PI * R) / 180;
                const fillLen = totalArcLen * Math.max(0.08, Math.min(1, ind.suspicion));
                const color =
                  ind.state === "attack" || ind.suspicion >= 0.78
                    ? "#ff3b30"
                    : ind.suspicion >= 0.36
                      ? "#f59e0b"
                      : "#f2efe9";
                const a0 = ((-90 - halfSpan) * Math.PI) / 180;
                const a1 = ((-90 + halfSpan) * Math.PI) / 180;
                const x0 = Math.cos(a0) * R;
                const y0 = Math.sin(a0) * R;
                const x1 = Math.cos(a1) * R;
                const y1 = Math.sin(a1) * R;
                const trackPath = `M ${x0.toFixed(2)} ${y0.toFixed(2)} A ${R} ${R} 0 0 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
                const fillOffset = (totalArcLen - fillLen) * 0.5;
                return (
                  <g key={ind.id} transform={`rotate(${deg.toFixed(1)})`}>
                    <path
                      d={trackPath}
                      fill="none"
                      stroke="rgba(10,12,16,0.65)"
                      strokeWidth="6"
                      strokeLinecap="round"
                    />
                    <path
                      d={trackPath}
                      fill="none"
                      stroke="rgba(255,255,255,0.22)"
                      strokeWidth="3"
                      strokeLinecap="round"
                    />
                    <path
                      d={trackPath}
                      fill="none"
                      stroke={color}
                      strokeWidth="4"
                      strokeLinecap="round"
                      strokeDasharray={`${fillLen.toFixed(2)} ${totalArcLen.toFixed(2)}`}
                      strokeDashoffset={(-fillOffset).toFixed(2)}
                      opacity={ind.seeing || ind.state === "attack" ? 0.98 : 0.65}
                    />
                    {/* Directional apex chevron */}
                    <polygon
                      points={`0,${-R - 11} -4.5,${-R - 4} 4.5,${-R - 4}`}
                      fill={color}
                      opacity={ind.seeing || ind.state === "attack" ? 0.95 : 0.6}
                    />
                  </g>
                );
              })}
            </svg>
          </div>
        )}

      {/* TOP-LEFT: Minimal hairline-anchored mission/district & objectives */}
      {hud.mission && (() => {
        const m = hud.mission;
        return (
          <div className="pointer-events-none absolute left-5 top-5 max-w-sm space-y-2.5">
            <div className="border-l-2 pl-3" style={{ borderColor: m.accent }}>
              <div className="font-mono text-[10px] font-bold uppercase tracking-[0.28em]" style={{ color: m.accent }}>
                {m.id === -1
                  ? `OPEN WORLD // ${hud.district?.name ?? "WESTGATE BAY"}`
                  : m.id === 0
                    ? "CALIBRATION RANGE"
                    : `C${m.id} // ${m.codename}`}
              </div>
              <div className="font-display text-2xl font-extrabold uppercase leading-none tracking-wide text-[#f2efe9] drop-shadow-[0_2px_6px_rgba(0,0,0,0.8)]">
                {m.id === -1 ? hud.district?.name ?? m.name : m.name}
              </div>
              <div className="mt-0.5 font-mono text-[10px] uppercase tracking-wider text-[#b3b8c4] drop-shadow">
                {m.id === -1 ? `${hud.district?.subtitle ?? "Free Roam"} · ${m.timeOfDay}` : `${m.timeOfDay} · ${m.location}`}
              </div>
            </div>

            <div className="space-y-1 pl-3">
              {hud.objectives.map((o) => (
                <ObjectiveRow key={o.id} o={o} accent={m.accent} />
              ))}
            </div>

            {hud.isOpenWorld && hud.surveillance && (
              <div className="pointer-events-auto mt-2 border border-amber-400/45 bg-[#080b12]/92 p-2.5">
                <div className="flex items-center justify-between gap-2 font-mono text-[9px] font-bold uppercase tracking-wider">
                  <span className="text-amber-400">
                    {hud.surveillance.code} · {hud.surveillance.title}
                  </span>
                  <span className="rounded bg-white/10 px-1.5 py-0.5 text-white">
                    {hud.surveillance.dayClock}
                  </span>
                </div>
                <div className="mt-1 flex items-center justify-between">
                  <span className="text-xs font-extrabold text-white">{hud.surveillance.targetName}</span>
                  <span
                    className={`rounded px-1.5 py-0.5 font-mono text-[8px] font-bold uppercase ${
                      hud.surveillance.strikeStatus === "ISOLATED"
                        ? "bg-emerald-500/25 text-emerald-300"
                        : hud.surveillance.strikeStatus === "CAUTION"
                          ? "bg-amber-500/25 text-amber-300"
                          : hud.surveillance.strikeStatus === "DEAD"
                            ? "bg-cyan-500/25 text-cyan-200"
                            : "bg-rose-500/25 text-rose-300"
                    }`}
                  >
                    {hud.surveillance.strikeStatus === "ISOLATED"
                      ? "ISOLATED · CLEAR"
                      : hud.surveillance.strikeStatus === "DEAD"
                        ? "DUMP AT SEA"
                        : `${hud.surveillance.strikeStatus} (${hud.surveillance.witnessCount})`}
                  </span>
                </div>
                <div className="mt-0.5 font-mono text-[9px] text-sky-300">
                  {hud.surveillance.phaseLabel} · {hud.surveillance.distanceMeters}m
                </div>
                <div className="mt-1 text-[10px] leading-snug text-white/75">
                  {hud.surveillance.windowNote}
                </div>
                {(hud.surveillance.nearCctvWarning ||
                  hud.surveillance.carSabotaged ||
                  hud.surveillance.specialSabotageArmed ||
                  hud.surveillance.taggedTarget) && (
                  <div className="mt-1.5 flex flex-wrap gap-1 font-mono text-[8px] font-bold uppercase">
                    {hud.surveillance.nearCctvWarning && (
                      <span className="rounded bg-rose-500/25 px-1.5 py-0.5 text-rose-300">
                        CCTV WATCH · SHOOT CAM
                      </span>
                    )}
                    {hud.surveillance.taggedTarget && (
                      <span className="rounded bg-cyan-500/25 px-1.5 py-0.5 text-cyan-200">
                        TAGGED
                      </span>
                    )}
                    {(hud.surveillance.carSabotaged || hud.surveillance.specialSabotageArmed) && (
                      <span className="rounded bg-amber-500/25 px-1.5 py-0.5 text-amber-300">
                        SABOTAGE ARMED
                      </span>
                    )}
                  </div>
                )}
                {hud.surveillance.stage === "surveil" && (
                  <div className="mt-1.5 flex items-center justify-between gap-2 border-t border-white/10 pt-1.5 font-mono text-[9px] text-white/60">
                    <span>Car: {hud.surveillance.vehicleLabel}</span>
                    <button
                      onClick={() => gameRef.current?.advanceSurveillanceClock(1.0)}
                      className="cursor-pointer rounded border border-sky-400/40 bg-sky-500/15 px-1.5 py-0.5 font-bold text-sky-200 hover:bg-sky-500/30"
                      title="Wait +1 game hour [Y]"
                    >
                      [Y] +1h
                    </button>
                  </div>
                )}
              </div>
            )}

            {hud.isOpenWorld && hud.surveillance?.overheard && (
              <div className="border-l-2 border-emerald-400 bg-[#061511]/94 px-3 py-2">
                <div className="font-mono text-[9px] font-bold uppercase tracking-wider text-emerald-300">
                  OVERHEARD · {hud.surveillance.overheard.speakerName}
                </div>
                <div className="text-[9px] italic text-white/55">
                  *{hud.surveillance.overheard.actionNote}*
                </div>
                <div className="mt-0.5 text-[11px] leading-snug text-white">
                  “{hud.surveillance.overheard.line}”
                </div>
              </div>
            )}
          </div>
        );
      })()}

      {/* TOP-CENTER: Sleek geometric Threat/Stealth readout (zero rounded pills) */}
      {hud.phase === "ready" && !hud.dead && (
        <div className="pointer-events-none absolute left-1/2 top-5 flex -translate-x-1/2 flex-col items-center gap-1">
          <div
            data-augmented-ui="tl-clip tr-clip br-clip bl-clip border inlay"
            className={`flex items-center gap-2.5 px-5 py-1 font-mono text-[10px] font-bold uppercase tracking-[0.24em] ${
              hud.stealthState === "compromised"
                ? "[--aug-border-bg:#ff3b30] [--aug-inlay-bg:rgba(40,8,10,0.88)] text-[#ff6b63]"
                : hud.stealthState === "caution"
                  ? "[--aug-border-bg:#e5a93c] [--aug-inlay-bg:rgba(34,24,6,0.86)] text-[#e5a93c]"
                  : "[--aug-border-bg:rgba(45,212,191,0.55)] [--aug-inlay-bg:rgba(7,12,14,0.78)] text-[#2dd4bf]"
            }`}
            style={{ "--aug-border-all": "1px", "--aug-tl": "6px", "--aug-tr": "6px", "--aug-br": "6px", "--aug-bl": "6px" } as React.CSSProperties}
          >
            {hud.stealthState === "compromised" ? (
              <ShieldAlert className="size-3.5 text-[#ff3b30]" />
            ) : hud.stealthState === "caution" ? (
              <Eye className="size-3.5 text-[#e5a93c]" />
            ) : (
              <EyeOff className="size-3.5 text-[#2dd4bf]" />
            )}
            <span>
              {hud.stealthState === "compromised"
                ? "DETECTED · COMBAT"
                : hud.stealthState === "caution"
                  ? `SUSPICIOUS · ${hud.suspicion}%`
                  : hud.suspicion > 0
                    ? `NOTICED · ${hud.suspicion}%`
                    : hud.crouch
                      ? "HIDDEN · SILENT"
                      : "HIDDEN"}
            </span>
          </div>

          {(hud.suspicion > 0 || hud.stealthState !== "hidden") && (
            <div className="h-1.5 w-36 overflow-hidden border border-white/15 bg-black/80">
              <div
                className={`h-full transition-all duration-75 ${
                  hud.stealthState === "compromised" || hud.suspicion >= 78
                    ? "bg-[#ff3b30]"
                    : hud.suspicion >= 36
                      ? "bg-[#e5a93c]"
                      : "bg-[#f2efe9]"
                }`}
                style={{ width: `${hud.stealthState === "compromised" ? 100 : hud.suspicion}%` }}
              />
            </div>
          )}

          <div className="flex items-center gap-3 font-mono text-[9px] uppercase tracking-[0.22em] text-[#cfd4de] drop-shadow">
            <span>STEALTH <b className="text-[#2dd4bf]">{hud.stealthKills}</b></span>
            <span className="text-white/25">/</span>
            <span>ALERTS <b className={hud.alerts > 0 ? "text-[#ff3b30]" : "text-[#2dd4bf]"}>{hud.alerts}</b></span>
          </div>

          {hud.carryingBody && (
            <div className="mt-0.5 border border-[#f59e0b]/70 bg-[#1a1004]/90 px-3 py-0.5 font-mono text-[9px] font-bold uppercase tracking-[0.18em] text-[#fbbf24]">
              CARRYING BODY · STASH IN TRUNK [G] OR OCEAN
            </div>
          )}
        </div>
      )}

      {/* TOP-RIGHT: Unified hairline environment & pause bar */}
      <div className="absolute right-5 top-5 flex items-center divide-x divide-white/15 border border-white/15 bg-[#080a0f]/90">
        {hud.phase === "ready" && !hud.dead && (
          <button
            onClick={() => gameRef.current?.setPhoneOpen(!hud.phoneOpen)}
            className={`inline-flex cursor-pointer items-center gap-1 px-2.5 py-1.5 font-mono text-[10px] font-bold uppercase tracking-[0.16em] transition ${
              hud.phoneOpen
                ? "bg-[#34d399]/20 text-[#34d399]"
                : "text-[#cfd4de] hover:bg-white/10 hover:text-[#34d399]"
            }`}
            title="Open SkyPhone [P or ↑]"
          >
            <Smartphone className="size-3 text-[#34d399]" />
            <span className="text-[#34d399]">[P]</span>
            PHONE
          </button>
        )}
        {hud.isOpenWorld && (
          <>
            <button
              onClick={() => gameRef.current?.setMapOpen(!hud.mapOpen)}
              className={`inline-flex cursor-pointer items-center gap-1 px-2.5 py-1.5 font-mono text-[10px] font-bold uppercase tracking-[0.16em] transition ${
                hud.mapOpen
                  ? "bg-[#38bdf8]/20 text-[#38bdf8]"
                  : "text-[#cfd4de] hover:bg-white/10 hover:text-[#38bdf8]"
              }`}
              title="Open full tactical map [M]"
            >
              <MapIcon className="size-3 text-[#38bdf8]" />
              <span className="text-[#38bdf8]">[M]</span>
              MAP
            </button>
            <button
              onClick={() => gameRef.current?.cycleTimeOfDay()}
              className="cursor-pointer px-2.5 py-1.5 font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-[#cfd4de] transition hover:bg-white/10 hover:text-[#f2efe9]"
              title="Cycle time of day [T]"
            >
              <span className="mr-1 text-[#e5a93c]">[T]</span>
              {hud.timeOfDayLabel}
            </button>
            <button
              onClick={() => gameRef.current?.cycleWeatherMode()}
              className="cursor-pointer px-2.5 py-1.5 font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-[#cfd4de] transition hover:bg-white/10 hover:text-[#38bdf8]"
              title="Cycle weather [N]"
            >
              <span className="mr-1 text-[#38bdf8]">[N]</span>
              {hud.weatherLabel}
            </button>
            {hud.vehicle?.active && (
              <button
                onClick={() => gameRef.current?.cycleCamera()}
                className="cursor-pointer px-2.5 py-1.5 font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-[#cfd4de] transition hover:bg-white/10 hover:text-[#e5a93c]"
                title="Cycle camera [C]"
              >
                <span className="mr-1 text-[#e5a93c]">[C]</span>
                {hud.cameraPreset}
              </button>
            )}
          </>
        )}
        <span className="pointer-events-none px-2.5 py-1.5 font-mono text-[10px] tabular-nums text-[#8a909e]">
          {Math.round(hud.fps)} FPS
        </span>
        <button
          onClick={() => gameRef.current?.toggleMute()}
          className={`inline-flex cursor-pointer items-center gap-1 px-2 py-1.5 font-mono text-[10px] font-bold uppercase transition ${
            hud.muted
              ? "bg-[#ff3b30]/20 text-[#ff3b30]"
              : "text-[#cfd4de] hover:bg-white/10 hover:text-[#f2efe9]"
          }`}
          title={hud.muted ? "Unmute Audio" : "Mute Audio"}
        >
          {hud.muted ? <VolumeX className="size-3.5" /> : <Volume2 className="size-3.5" />}
        </button>
        <button
          onClick={() => gameRef.current?.setPaused(!hud.paused)}
          className="inline-flex cursor-pointer items-center gap-1.5 px-3 py-1.5 font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-[#f2efe9] transition hover:bg-[#ff3b30] hover:text-[#07080b]"
        >
          {hud.paused ? <Play className="size-3" /> : <Pause className="size-3" />}
          {hud.paused ? "Resume" : "Pause"}
        </button>
      </div>

      {/* EXTRACTION BANNER (Top-Center below Threat bar) */}
      {hud.extractReady && !hud.dead && hud.extractDist !== null && (
        <div className="pointer-events-none absolute left-1/2 top-24 -translate-x-1/2">
          <div className="flex items-center gap-3 border border-[#2dd4bf]/70 bg-[#071513]/94 px-5 py-1.5">
            <span
              className="inline-block text-sm font-black text-[#2dd4bf]"
              style={{ transform: `rotate(${Math.round(((hud.extractDirAngle ?? 0) * 180) / Math.PI)}deg)` }}
            >
              ▲
            </span>
            <span className="font-mono text-[11px] font-bold uppercase tracking-[0.22em] text-[#ccfbf1]">
              CONTRACT COMPLETE · EXFIL {hud.extractDist}M
            </span>
          </div>
        </div>
      )}

      {/* BOSS BAR */}
      {hud.boss && (
        <div className="pointer-events-none absolute left-1/2 top-24 w-80 -translate-x-1/2 text-center">
          <div className="mb-1 font-mono text-[10px] font-bold uppercase tracking-[0.28em] text-[#ff3b30]">
            {hud.boss.name}
          </div>
          <div className="h-2 border border-[#ff3b30]/60 bg-black/80">
            <div
              className="h-full bg-[#ff3b30] transition-all duration-200"
              style={{ width: `${Math.max(0, (hud.boss.hp / hud.boss.maxHp) * 100)}%` }}
            />
          </div>
        </div>
      )}

      {/* WANTED STARS (GTA 1-5★ Pursuit / Evasion) + ACTIVE STREET RACE */}
      {hud.isOpenWorld && hud.wanted && hud.wanted.stars > 0 && (
        <div className="pointer-events-none absolute right-5 top-16 flex flex-col items-end gap-1.5">
          <div
            className={`flex items-center gap-1.5 border px-3 py-1.5 ${
              hud.wanted.evading
                ? "border-[#38bdf8]/65 bg-[#07131e]/92"
                : "animate-pulse border-[#ef4444]/85 bg-[#1a070b]/94"
            }`}
          >
            <span className="mr-1 font-mono text-[9px] font-bold uppercase tracking-[0.22em] text-[#cbd5e1]">
              {hud.wanted.evading ? "EVADING" : "WANTED"}
            </span>
            {[1, 2, 3, 4, 5].map((s) => (
              <span
                key={s}
                className={`text-base leading-none ${
                  s <= hud.wanted!.stars
                    ? hud.wanted!.evading
                      ? "text-[#38bdf8] drop-shadow-[0_0_6px_rgba(56,189,248,0.8)]"
                      : "text-[#f8fafc] drop-shadow-[0_0_8px_rgba(239,68,68,0.9)]"
                    : "text-white/20"
                }`}
              >
                ★
              </span>
            ))}
          </div>
          {hud.wanted.evading && (
            <div className="h-1 w-36 bg-black/75">
              <div
                className="h-full bg-[#38bdf8] transition-all duration-150"
                style={{ width: `${Math.min(100, Math.max(0, hud.wanted.evasionPct))}%` }}
              />
            </div>
          )}
        </div>
      )}

      {hud.isOpenWorld && hud.activeRace && (
        <div className="pointer-events-none absolute left-1/2 top-24 -translate-x-1/2">
          <div className="flex items-center gap-4 border border-[#fbbf24]/70 bg-[#0d0a04]/94 px-5 py-1.5 font-mono text-xs uppercase tracking-[0.2em] text-[#fef3c7]">
            <span className="font-bold text-[#fbbf24]">{hud.activeRace.raceName}</span>
            <span>P{hud.activeRace.place}/{hud.activeRace.totalRacers}</span>
            <span>CP {hud.activeRace.checkpoint}/{hud.activeRace.totalCheckpoints}</span>
            <span className="tabular-nums">{hud.activeRace.elapsed.toFixed(1)}s</span>
          </div>
        </div>
      )}

      {/* WESTGATE ACTIVITY TOAST (Upper-Right under telemetry strip / Wanted Stars) */}
      {hud.isOpenWorld && hud.activityToast && (
        <div
          key={hud.activityToast.title}
          className={`pointer-events-none absolute right-5 animate-[fadeIn_0.25s_ease] ${
            hud.wanted && hud.wanted.stars > 0 ? "top-28" : "top-16"
          }`}
        >
          <div
            className="border-r-2 bg-[#080a0f]/94 px-4 py-2 text-right"
            style={{ borderColor: hud.activityToast.accent }}
          >
            <div className="font-display text-lg font-extrabold uppercase tracking-wider" style={{ color: hud.activityToast.accent }}>
              {hud.activityToast.title}
            </div>
            <div className="font-mono text-[10px] uppercase tracking-wider text-[#cfd4de]">
              {hud.activityToast.subtitle}
            </div>
          </div>
        </div>
      )}

      {/* RADIO COMMS / BROKER DIALOGUE (Left-anchored below objectives, NEVER overlapping bottom [G]/[F] prompts!) */}
      {hud.dialogue && (
        <div
          key={hud.dialogue.text}
          className="pointer-events-none absolute left-5 top-36 max-w-sm animate-[fadeIn_0.25s_ease]"
        >
          <div
            data-augmented-ui="tr-clip br-clip border inlay"
            className="voss-panel-sharp px-4 py-3"
          >
            <div className="flex items-center gap-2 font-mono text-[10px] font-bold uppercase tracking-[0.26em] text-[#e5a93c]">
              <Radio className="size-3.5" />
              <span>{hud.dialogue.speaker}</span>
              <span className="ml-auto flex h-2.5 items-end gap-0.5">
                {[0, 1, 2, 3].map((i) => (
                  <span
                    key={i}
                    className="w-0.5 origin-bottom bg-[#e5a93c]"
                    style={{
                      height: "100%",
                      animation: `eqPulse 0.7s ease-in-out ${i * 0.14}s infinite`,
                    }}
                  />
                ))}
              </span>
            </div>
            <div className="mt-1.5 text-xs leading-relaxed text-[#f2efe9]">{hud.dialogue.text}</div>
          </div>
        </div>
      )}

      {/* TAKEDOWN / INTERACT / VEHICLE / CONTRACT PROMPTS (Bottom-center, cleanly spaced) */}
      {hud.takedownReady && !hud.dead && (
        <div className="pointer-events-none absolute bottom-44 left-1/2 -translate-x-1/2">
          <div className="flex items-center gap-2 border border-[#2dd4bf] bg-[#071513]/90 px-4 py-1.5 font-mono text-xs font-bold uppercase tracking-[0.2em] text-[#2dd4bf]">
            <kbd className="bg-[#2dd4bf] px-1.5 py-0.5 text-[#07080b]">V</kbd>
            <span>Silent Takedown</span>
          </div>
        </div>
      )}

      {hud.interact && !hud.dead && (
        <div className="pointer-events-none absolute bottom-24 left-1/2 -translate-x-1/2">
          <div
            data-augmented-ui="tl-clip br-clip border inlay"
            className="voss-panel-sharp flex min-w-[260px] flex-col items-center gap-1.5 px-5 py-2.5 text-center"
          >
            <div className="font-mono text-[10px] font-bold uppercase tracking-[0.24em] text-[#38bdf8]">
              {hud.interact.holding
                ? hud.interact.kind === "terminal"
                  ? "SCRUBBING SERVER…"
                  : hud.interact.kind === "diamond"
                    ? "EXTRACTING DIAMOND…"
                    : hud.interact.kind === "relic"
                      ? "RECOVERING GOLD…"
                      : "ACQUIRING FILES…"
                : `HOLD [F] · ${
                    hud.interact.kind === "terminal"
                      ? "SCRUB TERMINAL"
                      : hud.interact.kind === "diamond"
                        ? "STEAL DIAMOND"
                        : hud.interact.kind === "relic"
                          ? "RECOVER GOLD"
                          : "TAKE FILES"
                  }`}
            </div>
            <div className="font-display text-base font-extrabold uppercase tracking-wider text-[#f2efe9]">
              {hud.interact.label}
            </div>
            <div className="h-1.5 w-full bg-white/12">
              <div
                className="h-full bg-[#38bdf8] transition-all duration-75"
                style={{ width: `${Math.round(hud.interact.progress * 100)}%` }}
              />
            </div>
          </div>
        </div>
      )}

      {hud.vehicle && !hud.vehicle.active && hud.vehicle.nearbyName && hud.homeStation?.kind !== "garage_door" && !hud.interact && !hud.dead && (
        <div className="pointer-events-none absolute bottom-20 left-1/2 -translate-x-1/2">
          <div
            data-augmented-ui="tl-clip br-clip border inlay"
            className="voss-panel-sharp flex items-center gap-2.5 px-5 py-2 font-mono text-xs font-bold uppercase tracking-[0.18em] text-[#e0f2fe]"
          >
            <kbd className="bg-[#38bdf8] px-2 py-0.5 text-[#07080b]">[F]</kbd>
            <span>Drive {hud.vehicle.nearbyName}</span>
          </div>
        </div>
      )}

      {hud.isOpenWorld && hud.nearbyPrompt && !hud.interact && !hud.dead && (
        <div
          className={`pointer-events-none absolute left-1/2 -translate-x-1/2 ${
            hud.vehicle?.nearbyName || hud.homeStation ? "bottom-32" : "bottom-20"
          }`}
        >
          <div
            data-augmented-ui="tl-clip br-clip border inlay"
            className="voss-panel-sharp flex items-center gap-2.5 px-5 py-2 font-mono text-xs font-bold uppercase tracking-[0.16em] text-[#f2efe9]"
            style={{ "--aug-border-bg": hud.nearbyPrompt.accent } as React.CSSProperties}
          >
            <kbd
              className="px-2 py-0.5 text-[#07080b]"
              style={{ background: hud.nearbyPrompt.accent }}
            >
              [{hud.nearbyPrompt.key}]
            </kbd>
            <span>{hud.nearbyPrompt.label}</span>
          </div>
        </div>
      )}

      {hud.isOpenWorld && hud.homeStation && !hud.interact && !hud.dead && !hud.vehicle?.active && (
        <div
          className={`pointer-events-auto absolute left-1/2 flex -translate-x-1/2 items-center gap-2 ${
            hud.vehicle?.nearbyName && hud.homeStation.kind !== "garage_door" ? "bottom-32" : "bottom-20"
          }`}
        >
          <button
            onClick={() => gameRef.current?.triggerHomeStation()}
            data-augmented-ui="tl-clip br-clip border inlay"
            className="voss-panel-sharp flex cursor-pointer items-center gap-3 px-5 py-2.5 text-left transition hover:brightness-110"
            style={{
              "--aug-border-bg":
                (hud.homeStation.kind === "apt_door_ext" || hud.homeStation.kind === "apt_garage_ext") && !hud.homeStation.owned
                  ? "#fbbf24"
                  : hud.homeStation.kind === "closet"
                    ? "#34d399"
                    : hud.homeStation.kind === "weapon_bench"
                      ? "#f59e0b"
                      : "#38bdf8",
            } as React.CSSProperties}
          >
            <kbd
              className="px-2 py-0.5 font-mono text-[11px] font-black uppercase text-[#07080b]"
              style={{
                background:
                  hud.homeStation.kind === "garage_mod" && hud.vehicle?.nearbyName
                    ? "#22d3ee"
                    : (hud.homeStation.kind === "apt_door_ext" || hud.homeStation.kind === "apt_garage_ext") && !hud.homeStation.owned
                      ? "#fbbf24"
                      : "#34d399",
              }}
            >
              {hud.homeStation.kind === "garage_mod" && hud.vehicle?.nearbyName ? "[G]" : "[F]"}
            </kbd>
            <div>
              <div className="font-display text-base font-extrabold uppercase leading-tight tracking-wide text-[#f2efe9]">
                {hud.homeStation.label}
              </div>
              {hud.homeStation.sublabel && (
                <div className="font-mono text-[10px] uppercase tracking-wider text-[#9aa5b8]">
                  {hud.homeStation.sublabel}
                </div>
              )}
            </div>
          </button>

          {(hud.homeStation.kind === "garage_door" || (hud.homeStation.kind === "apt_garage_car" && hud.homeStation.carId)) && (
            <button
              onClick={() => {
                if (hud.homeStation?.kind === "garage_door") {
                  gameRef.current?.driveSafehouseCarOut();
                } else if (hud.homeStation?.carId) {
                  gameRef.current?.driveCarFromBuildingGarage(hud.homeStation.carId);
                }
              }}
              data-augmented-ui="tl-clip br-clip border inlay"
              className="voss-panel-sharp flex cursor-pointer items-center gap-2.5 px-4 py-2.5 text-left transition hover:brightness-110"
              style={{ "--aug-border-bg": "#22d3ee" } as React.CSSProperties}
            >
              <kbd className="bg-[#22d3ee] px-2 py-0.5 font-mono text-[11px] font-black uppercase text-[#07080b]">
                [G]
              </kbd>
              <div>
                <div className="font-display text-base font-extrabold uppercase leading-tight tracking-wide text-[#e0f2fe]">
                  Drive Car Out
                </div>
                <div className="font-mono text-[10px] uppercase tracking-wider text-[#9aa5b8]">
                  Start engine & exit
                </div>
              </div>
            </button>
          )}
        </div>
      )}

      {hud.activeApartment && !hud.dead && (
        <div className="pointer-events-auto absolute left-1/2 top-4 -translate-x-1/2">
          <div className="flex items-center gap-2.5 rounded-full border border-emerald-400/40 bg-[#070d16]/92 px-4 py-1.5">
            <span className="size-2 rounded-full bg-emerald-400" />
            <span className="font-mono text-[11px] font-bold uppercase tracking-wider text-emerald-200">
              {hud.activeApartment.name} · {hud.activeApartment.address}
            </span>
            <button
              onClick={() => gameRef.current?.enterApartmentGarage(hud.activeApartment!.id)}
              className="cursor-pointer rounded-full border border-sky-400/40 bg-sky-500/20 px-2.5 py-0.5 font-mono text-[10px] font-bold uppercase text-sky-200 hover:bg-sky-500/30"
            >
              Garage Elevator
            </button>
            <button
              onClick={() => gameRef.current?.exitApartment()}
              className="cursor-pointer rounded-full border border-white/20 bg-white/10 px-2.5 py-0.5 font-mono text-[10px] font-bold uppercase text-white hover:bg-white/20"
            >
              Exit to Street
            </button>
          </div>
        </div>
      )}

      {hud.activeGarage && !hud.dead && (
        <div className="pointer-events-auto absolute left-1/2 top-4 -translate-x-1/2">
          <div className="flex items-center gap-2.5 rounded-full border border-sky-400/45 bg-[#070d16]/94 px-4 py-1.5">
            <span className="size-2 rounded-full bg-sky-400" />
            <span className="font-mono text-[11px] font-bold uppercase tracking-wider text-sky-200">
              {hud.activeGarage.name} · Multi-Car Garage
            </span>
            <button
              onClick={() => gameRef.current?.enterApartment(hud.activeGarage!.id)}
              className="cursor-pointer rounded-full border border-emerald-400/40 bg-emerald-500/20 px-2.5 py-0.5 font-mono text-[10px] font-bold uppercase text-emerald-200 hover:bg-emerald-500/30"
            >
              Up to Apartment
            </button>
            <button
              onClick={() => gameRef.current?.exitApartmentGarage()}
              className="cursor-pointer rounded-full border border-white/20 bg-white/10 px-2.5 py-0.5 font-mono text-[10px] font-bold uppercase text-white hover:bg-white/20"
            >
              Exit to Street
            </button>
          </div>
        </div>
      )}

      {hud.parachuting && !hud.dead && (
        <div className="pointer-events-none absolute left-1/2 top-24 -translate-x-1/2">
          <div className="border border-[#f97316]/75 bg-[#1c0d04]/94 px-4 py-1.5 font-mono text-[11px] font-bold uppercase tracking-[0.2em] text-[#fdba74]">
            PARACHUTE OPEN · STEER WITH WASD TO LAND
          </div>
        </div>
      )}

      {hud.isOpenWorld && hud.nearbyContract && !hud.interact && !hud.dead && (
        <div
          className={`pointer-events-none absolute left-1/2 -translate-x-1/2 ${
            hud.vehicle && !hud.vehicle.active && hud.vehicle.nearbyName ? "bottom-32" : "bottom-20"
          }`}
        >
          <div
            data-augmented-ui="tl-clip br-clip border inlay"
            className="voss-panel-sharp flex items-center gap-3 px-5 py-2.5"
            style={{ "--aug-border-bg": hud.nearbyContract.unlocked ? hud.nearbyContract.accent : "#64748b" } as React.CSSProperties}
          >
            <span
              className="px-2 py-0.5 font-mono text-[11px] font-black uppercase text-[#07080b]"
              style={{ background: hud.nearbyContract.unlocked ? hud.nearbyContract.accent : "#64748b" }}
            >
              {hud.nearbyContract.unlocked ? "[G]" : "LOCKED"}
            </span>
            <div className="text-left">
              <div className="font-mono text-[10px] font-bold uppercase tracking-[0.22em]" style={{ color: hud.nearbyContract.accent }}>
                Contract C{hud.nearbyContract.missionId} · {hud.nearbyContract.codename}
                {hud.nearbyContract.completed ? " · Cleared" : ""}
              </div>
              <div className="font-display text-lg font-extrabold uppercase leading-none tracking-wide text-[#f2efe9]">
                {hud.nearbyContract.unlocked
                  ? `Start ${hud.nearbyContract.name}`
                  : `Clear Contract C${hud.nearbyContract.missionId - 1} First`}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* MINIMAP (Bottom-Left) */}
      {hud.isOpenWorld && hud.phase === "ready" && !hud.dead && !hud.mapOpen && (() => {
        const minimapData = gameRef.current?.getMinimapData();
        return minimapData ? (
          <WestgateMinimap
            data={minimapData}
            getSample={() => gameRef.current?.getMinimapSample() ?? null}
            paused={hud.paused}
            gpsTargetId={gpsTargetId}
            customWaypoint={customWaypoint}
            onChangeGpsTarget={(id) => {
              setGpsTargetId(id);
              setCustomWaypoint(null);
            }}
            onOpenFullMap={() => gameRef.current?.setMapOpen(true)}
          />
        ) : null;
      })()}

      {/* BOTTOM-RIGHT: Ballistic / Vehicle / Flight Telemetry Cluster (yields cleanly to SkyPhone when raised) */}
      {hud.phase !== "loading" && !hud.phoneOpen && (
        <div className="pointer-events-none absolute bottom-5 right-5 w-76 space-y-2.5 text-right">
          {hud.aircraft?.active ? (
            <div data-augmented-ui="tl-clip br-clip border inlay" className="voss-panel-sharp p-4">
              <div className="flex items-center justify-between font-mono text-[10px] uppercase tracking-[0.2em]">
                <span className="text-[#38bdf8]">{hud.aircraft.name}</span>
                <span className="border border-[#38bdf8]/45 bg-[#38bdf8]/15 px-1.5 py-0.5 font-bold text-[#38bdf8]">
                  {hud.aircraft.kind === "helicopter" ? "HELI" : "AIRCRAFT"}
                </span>
              </div>
              <div className="mt-2 flex items-end justify-between font-mono">
                <div className="text-left">
                  <div className="text-[9px] uppercase tracking-wider text-[#8a909e]">ALTITUDE</div>
                  <div className="text-xl font-bold text-[#f2efe9]">{hud.aircraft.altitude} m</div>
                </div>
                <div className="leading-none">
                  <span className="font-display text-5xl font-extrabold tabular-nums text-[#f2efe9]">
                    {String(hud.aircraft.speedKmh).padStart(2, "0")}
                  </span>
                  <span className="ml-1.5 text-xs font-bold uppercase text-[#38bdf8]">KM/H</span>
                </div>
              </div>
              <div className="mt-2 flex items-center justify-between border-t border-white/10 pt-2 font-mono text-[9px] uppercase tracking-wider text-[#9ca3af]">
                <span>THR {hud.aircraft.throttlePct}% · SPACE/SHIFT ALT</span>
                <span>A/D BANK · Q/E YAW · F EXIT</span>
              </div>
            </div>
          ) : hud.boat?.active ? (
            <div data-augmented-ui="tl-clip br-clip border inlay" className="voss-panel-sharp p-4">
              <div className="flex items-center justify-between font-mono text-[10px] uppercase tracking-[0.2em]">
                <span className="text-[#0ea5e9]">{hud.boat.name}</span>
                <div className="flex items-center gap-1.5">
                  {hud.boat.hasBody && (
                    <span className="border border-[#f59e0b]/60 bg-[#f59e0b]/20 px-1.5 py-0.5 font-bold text-[#fbbf24]">
                      BODY ABOARD
                    </span>
                  )}
                  <span className="border border-[#0ea5e9]/45 bg-[#0ea5e9]/15 px-1.5 py-0.5 font-bold text-[#0ea5e9]">MARINE</span>
                </div>
              </div>
              <div className="mt-2 leading-none">
                <span className="font-display text-5xl font-extrabold tabular-nums text-[#f2efe9]">
                  {String(hud.boat.speedKmh).padStart(2, "0")}
                </span>
                <span className="ml-1.5 font-mono text-xs font-bold uppercase text-[#0ea5e9]">KM/H</span>
              </div>
              <div className="mt-2 border-t border-white/10 pt-2 font-mono text-[9px] uppercase tracking-wider text-[#9ca3af]">
                {hud.boat.hasBody ? "[G] DUMP BODY AT SEA · " : ""}W/S THR · A/D STEER · LMB FIRE · F EXIT
              </div>
            </div>
          ) : hud.vehicle?.active ? (
            <div data-augmented-ui="tl-clip br-clip border inlay" className="voss-panel-sharp p-4">
              <div className="flex items-center justify-between font-mono text-[10px] uppercase tracking-[0.2em]">
                <span className="text-[#38bdf8]">{hud.vehicle.name}</span>
                <div className="pointer-events-auto flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => gameRef.current?.toggleVehicleSignal("left")}
                    aria-label="Toggle left indicator (Q)"
                    aria-pressed={hud.vehicle.signal === "left"}
                    className={`cursor-pointer border px-1.5 py-0.5 text-[10px] font-bold transition ${
                      hud.vehicle.signal === "left" && hud.vehicle.signalLit
                        ? "border-[#f59e0b] bg-[#f59e0b]/25 text-[#fbbf24] shadow-[0_0_8px_rgba(245,158,11,0.6)]"
                        : hud.vehicle.signal === "left"
                          ? "border-[#f59e0b]/45 bg-[#f59e0b]/10 text-[#f59e0b]/60"
                          : "border-white/15 bg-black/35 text-[#8a909e] hover:border-white/35 hover:text-[#f2efe9]"
                    }`}
                  >
                    ◀ Q
                  </button>
                  <button
                    type="button"
                    onClick={() => gameRef.current?.toggleVehicleSignal("right")}
                    aria-label="Toggle right indicator (E)"
                    aria-pressed={hud.vehicle.signal === "right"}
                    className={`cursor-pointer border px-1.5 py-0.5 text-[10px] font-bold transition ${
                      hud.vehicle.signal === "right" && hud.vehicle.signalLit
                        ? "border-[#f59e0b] bg-[#f59e0b]/25 text-[#fbbf24] shadow-[0_0_8px_rgba(245,158,11,0.6)]"
                        : hud.vehicle.signal === "right"
                          ? "border-[#f59e0b]/45 bg-[#f59e0b]/10 text-[#f59e0b]/60"
                          : "border-white/15 bg-black/35 text-[#8a909e] hover:border-white/35 hover:text-[#f2efe9]"
                    }`}
                  >
                    E ▶
                  </button>
                  <span className="border border-[#38bdf8]/45 bg-[#38bdf8]/15 px-1.5 py-0.5 font-bold text-[#38bdf8]">
                    G{Math.max(1, hud.vehicle.gear)}
                  </span>
                  {hud.trunkBodiesCount > 0 && (
                    <span className="border border-[#f59e0b]/60 bg-[#f59e0b]/20 px-1.5 py-0.5 font-bold text-[#fbbf24]">
                      TRUNK {hud.trunkBodiesCount}
                    </span>
                  )}
                </div>
              </div>

              <div className="mt-2 flex items-center justify-between gap-3">
                {/* Compact SVG RPM Tachometer Arc */}
                <svg viewBox="0 0 80 48" className="h-12 w-20 shrink-0">
                  <path
                    d="M 8 42 A 32 32 0 0 1 72 42"
                    fill="none"
                    stroke="rgba(255,255,255,0.12)"
                    strokeWidth="6"
                  />
                  <path
                    d="M 8 42 A 32 32 0 0 1 72 42"
                    fill="none"
                    stroke={hud.vehicle.rpm > hud.vehicle.redline * 0.85 ? "#ff3b30" : "#38bdf8"}
                    strokeWidth="6"
                    strokeDasharray="100.5"
                    strokeDashoffset={
                      100.5 *
                      (1 - Math.min(1, hud.vehicle.rpm / Math.max(1000, hud.vehicle.redline)))
                    }
                  />
                  <text
                    x="40"
                    y="41"
                    textAnchor="middle"
                    fill="#8a909e"
                    fontSize="8"
                    fontFamily="JetBrains Mono, monospace"
                  >
                    {hud.vehicle.rpm}
                  </text>
                </svg>

                <div className="leading-none">
                  <span className="font-display text-6xl font-extrabold tabular-nums text-[#f2efe9]">
                    {String(hud.vehicle.speedKmh).padStart(2, "0")}
                  </span>
                  <span className="ml-1.5 font-mono text-xs font-bold uppercase text-[#38bdf8]">
                    KM/H
                  </span>
                </div>
              </div>

              {/* Vehicle Health, Car Radio & Police Siren Controls */}
              <div className="mt-2 flex items-center justify-between gap-2 border-t border-white/10 pt-1.5 font-mono text-[9px] uppercase tracking-wider">
                <div className="flex items-center gap-1.5">
                  <span className="text-[#8a909e]">HP</span>
                  <div className="h-1.5 w-16 bg-white/15">
                    <div
                      className={`h-full ${
                        hud.vehicle.hpPct < 30 ? "bg-[#ef4444]" : hud.vehicle.hpPct < 60 ? "bg-[#f59e0b]" : "bg-[#22c55e]"
                      }`}
                      style={{ width: `${hud.vehicle.hpPct}%` }}
                    />
                  </div>
                </div>
                {hud.radioStation && (
                  <span className="text-[#c084fc]">
                    [Z] {hud.radioStation.name}
                  </span>
                )}
                {hud.vehicle.isPolice && (
                  <span className={hud.vehicle.sirenOn ? "animate-pulse font-bold text-[#ef4444]" : "text-[#94a3b8]"}>
                    [X] SIREN {hud.vehicle.sirenOn ? "ON" : "OFF"}
                  </span>
                )}
              </div>

              <div className="mt-1 border-t border-white/10 pt-1 font-mono text-[9px] uppercase tracking-wider text-[#8a909e]">
                W/S DRIVE · A/D STEER · [Q/E] SIGNAL · [Z] RADIO · [H] HORN · [C] CAM · [F] EXIT
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              {hud.ads && (
                <div className="ml-auto inline-flex items-center gap-2 border border-[#38bdf8]/45 bg-[#080a0f]/85 px-2.5 py-0.5 font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-[#38bdf8]">
                  <span>{hud.zoomFactor.toFixed(1)}× OPTIC</span>
                  <span className="text-[#8a909e]">SCROLL</span>
                </div>
              )}

              {/* Minimal inline weapon rail */}
              <div className="flex justify-end gap-1">
                {hud.weapons.map((w, idx) => {
                  const active = idx === hud.weaponIndex && !hud.holstered;
                  return (
                    <div
                      key={w.slot}
                      className={`border-b-2 px-2 py-1 font-mono text-[9px] font-bold uppercase tracking-wider transition ${
                        active
                          ? "border-[#ff3b30] bg-[#0b0d13]/90 text-[#f2efe9]"
                          : "border-white/10 bg-[#080a0f]/60 text-[#8a909e]"
                      }`}
                    >
                      <span className={active ? "mr-1 text-[#ff3b30]" : "mr-1 text-[#5e6472]"}>{w.slot}</span>
                      {w.shortName}
                    </div>
                  );
                })}
              </div>

              <div className="flex items-center justify-end gap-2 font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-[#cfd4de]">
                {hud.holstered ? (
                  <span className="border border-[#38bdf8]/50 bg-[#38bdf8]/15 px-1.5 py-0.5 text-[9px] text-[#38bdf8]">
                    HOLSTERED · [LMB/RMB/H] DRAW
                  </span>
                ) : hud.suppressed ? (
                  <span className="border border-[#2dd4bf]/50 bg-[#2dd4bf]/10 px-1.5 py-0.5 text-[9px] text-[#2dd4bf]">
                    SUPPRESSED
                  </span>
                ) : (
                  <span className="border border-[#e5a93c]/50 bg-[#e5a93c]/10 px-1.5 py-0.5 text-[9px] text-[#e5a93c]">
                    UNSUPPRESSED
                  </span>
                )}
                <span>
                  <span className="text-[#e5a93c]">{hud.weaponCategory}</span> · {hud.weaponName}
                </span>
              </div>

              {hud.reloading && (
                <div className="ml-auto h-1 w-48 bg-white/15">
                  <div className="h-full bg-[#e5a93c]" style={{ width: `${hud.reloadProgress * 100}%` }} />
                </div>
              )}

              <div className="font-display leading-none drop-shadow-[0_3px_10px_rgba(0,0,0,0.85)]">
                <span
                  className={`text-6xl font-extrabold tabular-nums ${
                    hud.ammo <= (hud.weaponIndex === 0 ? 4 : hud.weaponIndex === 3 ? 2 : hud.weaponIndex === 4 ? 3 : 8)
                      ? "text-[#ff3b30]"
                      : "text-[#f2efe9]"
                  }`}
                >
                  {String(hud.ammo).padStart(2, "0")}
                </span>
                <span className="ml-1.5 font-mono text-xl font-bold text-[#8a909e]">/ {hud.reserve}</span>
              </div>
            </div>
          )}

          {/* Sleek segmented Armor & Health Bars */}
          {hud.armor > 0 && (
            <div className="flex items-center justify-end gap-2.5">
              <span className="font-mono text-[10px] font-bold uppercase tracking-[0.24em] text-[#38bdf8] drop-shadow-[0_1px_4px_rgba(0,0,0,0.9)]">
                ARMOR
              </span>
              <div className="h-1.5 w-48 border border-[#38bdf8]/40 bg-[#080a0f]/90">
                <div
                  className="h-full bg-[#38bdf8] transition-all duration-200"
                  style={{ width: `${Math.min(100, Math.round((hud.armor / Math.max(1, hud.maxArmor)) * 100))}%` }}
                />
              </div>
              <span className="w-8 font-mono text-xs font-bold tabular-nums text-[#bae6fd] drop-shadow-[0_1px_4px_rgba(0,0,0,0.9)]">
                {Math.round(hud.armor)}
              </span>
            </div>
          )}
          <div className="flex items-center justify-end gap-2.5">
            <span className="font-mono text-[10px] font-bold uppercase tracking-[0.24em] text-[#cfd4de] drop-shadow-[0_1px_4px_rgba(0,0,0,0.9)]">
              VITALS
            </span>
            <div className="h-2 w-48 border border-white/25 bg-[#080a0f]/90">
              <div
                className={`h-full transition-all duration-200 ${
                  healthPct > 50 ? "bg-[#2dd4bf]" : healthPct > 25 ? "bg-[#e5a93c]" : "bg-[#ff3b30]"
                }`}
                style={{ width: `${healthPct}%` }}
              />
            </div>
            <span className="w-8 font-mono text-xs font-bold tabular-nums text-[#f2efe9] drop-shadow-[0_1px_4px_rgba(0,0,0,0.9)]">
              {Math.round(hud.health)}
            </span>
          </div>
        </div>
      )}

      {/* SWIMMING INDICATOR */}
      {hud.isOpenWorld && hud.swimming && !hud.dead && (
        <div className="pointer-events-none fixed bottom-28 left-1/2 -translate-x-1/2 rounded border border-cyan-400/55 bg-[#061822]/92 px-3.5 py-1 font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-cyan-200">
          SWIMMING · SWIM TO STARTER BOAT [F] OR SHORE
        </div>
      )}

      {/* TACTICAL RANGEFINDER BINOCULARS + PARABOLIC MIC ([B]) */}
      {hud.phase === "ready" && hud.binoculars?.open && !hud.dead && (
        <div className="pointer-events-none fixed inset-0 z-10 flex items-center justify-center">
          <div
            className="absolute inset-0"
            style={{
              background:
                "radial-gradient(circle at 50% 50%, transparent 28%, rgba(4, 10, 14, 0.72) 52%, rgba(2, 5, 8, 0.96) 76%)",
            }}
          />
          <div className="relative flex h-[62vh] w-[62vh] max-h-[540px] max-w-[540px] items-center justify-center rounded-full border border-cyan-400/45 shadow-[0_0_60px_rgba(34,211,238,0.16)_inset]">
            <div className="absolute inset-x-10 top-1/2 h-px -translate-y-1/2 bg-cyan-400/35" />
            <div className="absolute inset-y-10 left-1/2 w-px -translate-x-1/2 bg-cyan-400/35" />
            <div className="h-5 w-5 rounded-full border border-cyan-300/85" />

            <div className="absolute top-6 flex items-center gap-3 rounded bg-black/75 px-3 py-1 font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-cyan-300">
              <span>OPTIC {hud.binoculars.zoom} · SCROLL</span>
              <span className="text-white/40">|</span>
              <span className="text-emerald-300">PARABOLIC MIC 225M</span>
            </div>

            <div className="absolute bottom-6 flex items-center gap-4 rounded bg-black/75 px-3.5 py-1 font-mono text-[11px] font-bold uppercase tracking-[0.2em]">
              <span className="text-cyan-200 tabular-nums">RANGE {hud.binoculars.rangeM}M</span>
              {hud.surveillance && (
                <span className={hud.surveillance.taggedTarget ? "text-emerald-300" : "text-amber-300"}>
                  {hud.surveillance.taggedTarget ? "TARGET LOCKED" : "SCANNING TARGET"}
                </span>
              )}
              <span className="text-white/60">[B] EXIT</span>
            </div>
          </div>
        </div>
      )}

      {/* Pointer-lock hint (compact bottom-center hairline strip) */}
      {hud.phase === "ready" && !hud.locked && !hud.dead && !hud.paused && !hud.mapOpen && !hud.weaponWheelOpen && !hud.phoneOpen && (
        <div className="pointer-events-none absolute bottom-5 left-1/2 -translate-x-1/2 border border-white/15 bg-[#080a0f]/92 px-4 py-1.5 font-mono text-[10px] uppercase tracking-[0.2em] text-[#cfd4de]">
          <span className="font-bold text-[#e5a93c]">CLICK VIEWPORT</span> TO LOCK AIM ·{" "}
          <span className="font-bold text-[#34d399]">P / ↑</span> PHONE ·{" "}
          <span className="font-bold text-[#38bdf8]">TAB</span> WHEEL ·{" "}
          <span className="font-bold text-[#22d3ee]">B</span> BINOCS ·{" "}
          <span className="font-bold text-[#38bdf8]">H</span> HOLSTER ·{" "}
          {hud.isOpenWorld && (
            <>
              <span className="font-bold text-[#38bdf8]">M</span> MAP ·{" "}
            </>
          )}
          <span className="font-bold text-[#ff3b30]">ESC</span> PAUSE
        </div>
      )}

      {/* GTA V-STYLE MODERN SKYPHONE ([P] or [↑]) */}
      {hud.phase === "ready" && (
        <TacticalPhone
          open={hud.phoneOpen && !hud.dead && !hud.paused && !hud.mapOpen && !hud.weaponWheelOpen}
          hud={hud}
          save={save}
          gameRef={gameRef}
          gpsTargetId={gpsTargetId}
          onSetGpsTarget={(id, wp) => {
            setGpsTargetId(id);
            setCustomWaypoint(wp ?? null);
          }}
          onStartMission={onStartMission}
          onBuyCar={onBuyCar}
          onSelectCar={onSelectCar}
          onBuyApartment={onBuyApartment}
          onClose={() => gameRef.current?.setPhoneOpen(false)}
        />
      )}

      {/* RADIAL WEAPON WHEEL (Hold Tab — kept mounted during play so release commits selection) */}
      {hud.phase === "ready" && (
        <WeaponWheel
          open={hud.weaponWheelOpen && !hud.dead && !hud.paused && !hud.mapOpen}
          weapons={hud.weapons}
          weaponIndex={hud.weaponIndex}
          holstered={hud.holstered}
          onCommitWeapon={(idx: number) => {
            gameRef.current?.selectWeapon(idx);
            gameRef.current?.setWeaponWheelOpen(false);
          }}
          onCommitHolster={() => {
            gameRef.current?.setHolstered(true);
            gameRef.current?.setWeaponWheelOpen(false);
          }}
          onClose={() => gameRef.current?.setWeaponWheelOpen(false)}
        />
      )}

      {/* FULL-SCREEN TACTICAL MAP ([M] in Westgate Bay) */}
      {hud.isOpenWorld && hud.mapOpen && !hud.dead && (() => {
        const minimapData = gameRef.current?.getMinimapData();
        return minimapData ? (
          <WestgateFullMap
            data={minimapData}
            getSample={(maxRadius?: number) => gameRef.current?.getMinimapSample(maxRadius) ?? null}
            gpsTargetId={gpsTargetId}
            customWaypoint={customWaypoint}
            onSetGpsTarget={(id: string | null, wp?: GpsWaypoint | null) => {
              setGpsTargetId(id);
              setCustomWaypoint(wp ?? null);
            }}
            onFastTravel={(x: number, z: number, yawDeg?: number) => {
              gameRef.current?.teleportTo(x, z, yawDeg);
              gameRef.current?.setMapOpen(false);
            }}
            onClose={() => gameRef.current?.setMapOpen(false)}
          />
        ) : null;
      })()}

      {/* LOADING SCREEN */}
      {hud.phase === "loading" && (
        <div className="voss-grid-bg absolute inset-0 z-30 flex flex-col items-center justify-center gap-6 bg-[#07080b]/95 backdrop-blur-md">
          <div className="w-80 space-y-2 text-left">
            <div className="font-mono text-[10px] font-bold uppercase tracking-[0.34em] text-[#ff3b30]">
              DEPLOYING ASSET // SECTOR LINK
            </div>
            <div className="font-display text-5xl font-extrabold uppercase leading-none tracking-wide text-[#f2efe9]">
              {hud.mission?.codename ?? "DEPLOYING"}
            </div>
            <div className="font-mono text-xs uppercase tracking-wider text-[#8a909e]">
              {hud.mission?.name}
            </div>
            <div className="pt-2">
              <div className="h-1.5 w-full bg-white/10">
                <div
                  className="h-full bg-[#ff3b30] transition-all duration-150"
                  style={{ width: `${Math.max(8, Math.min(100, Math.round(hud.progress)))}%` }}
                />
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function ObjectiveRow({ o, accent }: { o: ObjectiveState; accent: string }) {
  return (
    <div className="flex items-center gap-2 text-xs">
      <span
        className="flex h-3.5 w-3.5 items-center justify-center border text-[9px] font-bold"
        style={{
          borderColor: o.done ? "#2dd4bf" : accent,
          background: o.done ? "rgba(45,212,191,0.28)" : "rgba(7,8,11,0.8)",
          color: o.done ? "#2dd4bf" : "#f2efe9",
        }}
      >
        {o.done ? <Check className="size-2.5" /> : null}
      </span>
      <span
        className={
          o.done
            ? "text-[#cfd4de]/80 line-through drop-shadow-[0_1px_3px_rgba(0,0,0,0.95)]"
            : "text-[#f2efe9] drop-shadow-[0_1px_4px_rgba(0,0,0,0.95)]"
        }
      >
        {o.label}
      </span>
      {o.total > 1 && (
        <span className="font-mono text-[10px] text-[#cfd4de] drop-shadow-[0_1px_3px_rgba(0,0,0,0.95)]">
          {o.progress}/{o.total}
        </span>
      )}
    </div>
  );
}
