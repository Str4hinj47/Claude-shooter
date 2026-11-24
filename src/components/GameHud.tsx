import { Check, Eye, EyeOff, Pause, Play, Radio, ShieldAlert } from "lucide-react";
import type { Game, HudState, ObjectiveState } from "../game/Game";
import { WestgateMinimap } from "./WestgateMinimap";

interface GameHudProps {
  hud: HudState;
  gameRef: React.MutableRefObject<Game | null>;
  spreadPx: number;
  gpsTargetId: string | null;
  setGpsTargetId: (id: string | null) => void;
}

export function GameHud({
  hud,
  gameRef,
  spreadPx,
  gpsTargetId,
  setGpsTargetId,
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

      {/* Precision tactical reticle */}
      {hud.phase !== "loading" && !hud.dead && !hud.showcase && !hud.vehicle?.active && (() => {
        const gap = Math.max(5, Math.min(26, spreadPx * 0.55));
        const len = hud.ads ? 10 : 7;
        const accent = hud.takedownReady ? "#2dd4bf" : hud.ads ? "#38bdf8" : "#f2efe9";
        const circ = 2 * Math.PI * 16;
        return (
          <div className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
            <svg
              width="96"
              height="96"
              viewBox="-48 -48 96 96"
              className="overflow-visible drop-shadow-[0_0_3px_rgba(0,0,0,0.95)]"
            >
              {hud.ads && (
                <g opacity="0.9">
                  <circle cx="0" cy="0" r="22" fill="none" stroke="#38bdf8" strokeWidth="0.9" strokeDasharray="10 6" opacity="0.55" />
                  <circle cx="0" cy="0" r="32" fill="none" stroke="#f2efe9" strokeWidth="0.7" strokeDasharray="4 46.3" opacity="0.35" />
                  <line x1="-16" y1="0" x2="-6" y2="0" stroke="#38bdf8" strokeWidth="1.2" />
                  <line x1="6" y1="0" x2="16" y2="0" stroke="#38bdf8" strokeWidth="1.2" />
                  <line x1="0" y1="6" x2="0" y2="16" stroke="#38bdf8" strokeWidth="1.2" />
                  <line x1="0" y1="-16" x2="0" y2="-6" stroke="#38bdf8" strokeWidth="1.2" />
                </g>
              )}

              {!hud.ads && (
                <g>
                  <line x1={-gap - len} y1="0" x2={-gap} y2="0" stroke={accent} strokeWidth="1.7" opacity="0.92" />
                  <line x1={gap} y1="0" x2={gap + len} y2="0" stroke={accent} strokeWidth="1.7" opacity="0.92" />
                  <line x1="0" y1={-gap - len} x2="0" y2={-gap} stroke={accent} strokeWidth="1.7" opacity="0.92" />
                  <line x1="0" y1={gap} x2="0" y2={gap + len} stroke={accent} strokeWidth="1.7" opacity="0.92" />
                </g>
              )}

              {hud.reloading && (
                <g transform="rotate(-90)">
                  <circle cx="0" cy="0" r="16" fill="none" stroke="rgba(255,255,255,0.16)" strokeWidth="2" />
                  <circle
                    cx="0"
                    cy="0"
                    r="16"
                    fill="none"
                    stroke="#e5a93c"
                    strokeWidth="2.2"
                    strokeDasharray={circ}
                    strokeDashoffset={circ * (1 - hud.reloadProgress)}
                  />
                </g>
              )}

              <circle cx="0" cy="0" r="1.7" fill={accent} />

              {hud.hitMarker > 0 && (
                <g stroke="#ff3b30" strokeWidth="2" opacity={Math.min(1, hud.hitMarker * 6)}>
                  <line x1="-11" y1="-11" x2="-5" y2="-5" />
                  <line x1="11" y1="-11" x2="5" y2="-5" />
                  <line x1="-11" y1="11" x2="-5" y2="5" />
                  <line x1="11" y1="11" x2="5" y2="5" />
                </g>
              )}
            </svg>
          </div>
        );
      })()}

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
                ? "COMPROMISED"
                : hud.stealthState === "caution"
                  ? `CAUTION · ${hud.suspicion}%`
                  : hud.crouch
                    ? "HIDDEN · SILENT"
                    : "HIDDEN"}
            </span>
          </div>

          {hud.stealthState === "caution" && (
            <div className="h-1 w-32 bg-black/75">
              <div className="h-full bg-[#e5a93c] transition-all duration-100" style={{ width: `${hud.suspicion}%` }} />
            </div>
          )}

          <div className="flex items-center gap-3 font-mono text-[9px] uppercase tracking-[0.22em] text-[#cfd4de] drop-shadow">
            <span>STEALTH <b className="text-[#2dd4bf]">{hud.stealthKills}</b></span>
            <span className="text-white/25">/</span>
            <span>ALERTS <b className={hud.alerts > 0 ? "text-[#ff3b30]" : "text-[#2dd4bf]"}>{hud.alerts}</b></span>
          </div>
        </div>
      )}

      {/* TOP-RIGHT: Unified hairline environment & pause bar */}
      <div className="absolute right-5 top-5 flex items-center divide-x divide-white/15 border border-white/15 bg-[#080a0f]/80 backdrop-blur-md">
        {hud.isOpenWorld && (
          <>
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
              title="Cycle weather [B]"
            >
              <span className="mr-1 text-[#38bdf8]">[B]</span>
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
          <div className="flex items-center gap-3 border border-[#2dd4bf]/70 bg-[#071513]/90 px-5 py-1.5 backdrop-blur">
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

      {/* WESTGATE ACTIVITY TOAST (Upper-Right under telemetry strip) */}
      {hud.isOpenWorld && hud.activityToast && (
        <div
          key={hud.activityToast.title}
          className="pointer-events-none absolute right-5 top-16 animate-[fadeIn_0.25s_ease]"
        >
          <div
            className="border-r-2 bg-[#080a0f]/90 px-4 py-2 text-right backdrop-blur-md"
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

      {hud.vehicle && !hud.vehicle.active && hud.vehicle.nearbyName && !hud.interact && !hud.dead && (
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
      {hud.isOpenWorld && hud.phase === "ready" && !hud.dead && (() => {
        const minimapData = gameRef.current?.getMinimapData();
        return minimapData ? (
          <WestgateMinimap
            data={minimapData}
            getSample={() => gameRef.current?.getMinimapSample() ?? null}
            paused={hud.paused}
            gpsTargetId={gpsTargetId}
            onChangeGpsTarget={setGpsTargetId}
          />
        ) : null;
      })()}

      {/* BOTTOM-RIGHT: Ballistic / Vehicle Telemetry Cluster */}
      {hud.phase !== "loading" && (
        <div className="pointer-events-none absolute bottom-5 right-5 w-76 space-y-2.5 text-right">
          {hud.vehicle?.active ? (
            <div data-augmented-ui="tl-clip br-clip border inlay" className="voss-panel-sharp p-4">
              <div className="flex items-center justify-between font-mono text-[10px] uppercase tracking-[0.2em]">
                <span className="text-[#38bdf8]">{hud.vehicle.name}</span>
                <span className="border border-[#38bdf8]/45 bg-[#38bdf8]/15 px-1.5 py-0.5 font-bold text-[#38bdf8]">
                  GEAR {Math.max(1, hud.vehicle.gear)}
                </span>
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

              <div className="mt-2 border-t border-white/10 pt-1.5 font-mono text-[9px] uppercase tracking-wider text-[#8a909e]">
                W/S DRIVE · A/D STEER · [C] CAM · [F] EXIT
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
                  const active = idx === hud.weaponIndex;
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
                {hud.suppressed && (
                  <span className="border border-[#2dd4bf]/50 bg-[#2dd4bf]/10 px-1.5 py-0.5 text-[9px] text-[#2dd4bf]">
                    SUPPRESSED
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
                    hud.ammo <= (hud.weaponIndex === 2 ? 2 : hud.weaponIndex === 3 ? 3 : 8)
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

          {/* Sleek segmented Health Bar */}
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

      {/* Pointer-lock hint (compact bottom-center hairline strip) */}
      {hud.phase === "ready" && !hud.locked && !hud.dead && !hud.paused && (
        <div className="pointer-events-none absolute bottom-5 left-1/2 -translate-x-1/2 border border-white/15 bg-[#080a0f]/85 px-4 py-1.5 font-mono text-[10px] uppercase tracking-[0.2em] text-[#cfd4de] backdrop-blur">
          <span className="font-bold text-[#e5a93c]">CLICK VIEWPORT</span> TO LOCK AIM ·{" "}
          <span className="font-bold text-[#ff3b30]">ESC</span> PAUSE
        </div>
      )}

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
                  style={{ width: `${Math.max(8, hud.progress * 100)}%` }}
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
