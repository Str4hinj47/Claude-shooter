import { useEffect, useRef, useState } from "react";
import { Game, loadSave, type HudState, type ObjectiveState } from "./game/Game";
import { MISSIONS, type MissionDef } from "./game/story";
import soldierUrl from "./assets/soldier.glb?url";

const initial: HudState = {
  loading: true,
  progress: 0,
  phase: "idle",
  mission: null,
  objectives: [],
  dialogue: null,
  boss: null,
  ammo: 30,
  reserve: 120,
  health: 100,
  status: "Idle",
  speed: 0,
  reloading: false,
  reloadProgress: 0,
  locked: false,
  dead: false,
  crouch: false,
  ads: false,
  sprint: false,
  showcase: false,
  fps: 60,
  spread: 0.01,
  hitMarker: 0,
  timeScale: 1,
  paused: false,
  kills: 0,
};

const KEYS: [string, string][] = [
  ["W A S D", "Move"],
  ["Mouse", "Aim / look"],
  ["LMB / F", "Fire (hold)"],
  ["RMB / Z", "Aim down sights"],
  ["Shift", "Sprint"],
  ["C / Ctrl", "Crouch"],
  ["Space", "Jump"],
  ["R", "Reload"],
  ["Q / E", "Lean"],
  ["Esc", "Pause"],
  ["Tab", "Showcase orbit"],
];

type Screen = "menu" | "briefing" | "playing";

export default function App() {
  const host = useRef<HTMLDivElement>(null);
  const game = useRef<Game | null>(null);
  const [hud, setHud] = useState<HudState>(initial);
  const [screen, setScreen] = useState<Screen>("menu");
  const [briefing, setBriefing] = useState<MissionDef | null>(null);
  const [saved, setSaved] = useState(loadSave().unlocked);
  const [endInfo, setEndInfo] = useState<{ mission: MissionDef; success: boolean } | null>(null);

  useEffect(() => {
    if (!host.current) return;
    const g = new Game(host.current, setHud);
    game.current = g;
    return () => {
      g.dispose();
      game.current = null;
    };
  }, []);

  const startMission = (m: MissionDef) => {
    setEndInfo(null);
    setScreen("playing");
    void game.current?.startMission(m.id, {
      onHud: setHud,
      onMissionEnd: (mission, success) => {
        setEndInfo({ mission, success });
        if (success) setSaved(loadSave().unlocked);
      },
    });
  };

  const download = () => {
    const a = document.createElement("a");
    a.href = soldierUrl;
    a.download = "soldier_rigged.glb";
    a.click();
  };

  const healthPct = Math.max(0, hud.health);
  const spreadPx = 6 + hud.spread * 1800;
  const playing = screen === "playing";

  return (
    <div className="relative h-screen w-screen select-none overflow-hidden bg-black font-sans text-zinc-100">
      <div ref={host} className="absolute inset-0" />

      {/* ================= MENU ================= */}
      {screen === "menu" && (
        <div className="absolute inset-0 overflow-y-auto bg-gradient-to-b from-[#0a0c10] via-[#0d0f14] to-black">
          <div className="mx-auto max-w-5xl px-8 py-12">
            {/* title */}
            <div className="pt-8 text-center">
              <div className="text-xs font-semibold uppercase tracking-[0.5em] text-amber-400/80">
                Zlatograd · 2029 · a Str4hinj47 world
              </div>
              <h1 className="mt-3 text-5xl font-black uppercase tracking-[0.15em] text-white drop-shadow-[0_0_30px_rgba(245,197,66,0.25)]">
                VANGUARD
              </h1>
              <h2 className="text-2xl font-black uppercase tracking-[0.4em] text-amber-400">Blackout Protocol</h2>
              <p className="mx-auto mt-5 max-w-2xl text-sm leading-relaxed text-zinc-400">
                Capt. Elias “Vanguard” Voss — once the city’s enforcer, now its ghost. Meridian Global Security
                bought Zlatograd and wired it into the Lattice, a surveillance grid that can erase anyone.
                Six missions. Five armies in the same uniform. One kill-switch.
              </p>
            </div>

            {/* mission select */}
            <div className="mt-10">
              <div className="mb-4 flex items-center justify-between">
                <h3 className="text-xs font-bold uppercase tracking-[0.4em] text-zinc-300">Campaign</h3>
                <span className="font-mono text-xs text-zinc-500">
                  Progress: {saved} / {MISSIONS.length - 1} missions unlocked
                </span>
              </div>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                {MISSIONS.map((m) => {
                  const locked = m.id > saved;
                  return (
                    <button
                      key={m.id}
                      disabled={locked}
                      onClick={() => (locked ? null : setBriefing(m))}
                      className="group relative overflow-hidden rounded-xl border bg-white/[0.03] p-5 text-left transition hover:bg-white/[0.07] disabled:cursor-not-allowed disabled:opacity-40"
                      style={{ borderColor: locked ? "rgba(255,255,255,0.08)" : m.accent + "55" }}
                    >
                      <div
                        className="absolute inset-y-0 left-0 w-1"
                        style={{ background: locked ? "#444" : m.accent }}
                      />
                      <div className="flex items-start justify-between">
                        <div>
                          <div className="font-mono text-[10px] font-bold uppercase tracking-[0.3em]" style={{ color: locked ? "#777" : m.accent }}>
                            {m.id === 0 ? "FREE PLAY" : `MISSION ${m.id}`}
                          </div>
                          <div className="mt-1 text-lg font-black uppercase tracking-wide text-white">{m.codename}</div>
                          <div className="mt-0.5 text-xs text-zinc-400">{m.name}</div>
                        </div>
                        <div className="text-right">
                          <div className="text-[10px] uppercase tracking-wider text-zinc-500">{m.timeOfDay}</div>
                          {locked ? (
                            <div className="mt-1 text-lg">🔒</div>
                          ) : (
                            <div className="mt-1 text-xs font-bold text-emerald-400/80 group-hover:text-emerald-300">START →</div>
                          )}
                        </div>
                      </div>
                      <div className="mt-3 truncate text-[11px] text-zinc-500">{m.location}</div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* controls */}
            <div className="mt-10">
              <h3 className="mb-3 text-xs font-bold uppercase tracking-[0.4em] text-zinc-300">Controls</h3>
              <div className="grid grid-cols-2 gap-x-8 gap-y-1.5 rounded-xl border border-white/10 bg-white/[0.03] p-4 text-xs sm:grid-cols-3">
                {KEYS.map(([k, v]) => (
                  <div key={k} className="flex items-center justify-between gap-4">
                    <span className="font-mono font-semibold text-amber-300/90">{k}</span>
                    <span className="text-right text-zinc-400">{v}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* lore + download */}
            <div className="mt-10 flex flex-wrap items-center justify-between gap-6">
              <p className="max-w-md text-xs leading-relaxed text-zinc-500">
                Every soldier in Zlatograd wears the same Vanguard rig — only the paint differs. Master the range,
                then take back the city, one mission at a time.
              </p>
              <button
                onClick={download}
                className="flex items-center gap-2 rounded-md border border-sky-400/40 bg-sky-500/15 px-4 py-2 text-xs font-bold uppercase tracking-widest text-sky-200 transition hover:bg-sky-500/30"
              >
                <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 3v12m0 0l-4-4m4 4l4-4M4 21h16" />
                </svg>
                Download Vanguard rig (GLB)
              </button>
            </div>
            <div className="h-12" />
          </div>
        </div>
      )}

      {/* ================= BRIEFING ================= */}
      {screen === "briefing" && briefing && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/85 p-6 backdrop-blur-sm">
          <div className="w-full max-w-2xl overflow-hidden rounded-2xl border bg-[#0e1015] shadow-2xl" style={{ borderColor: briefing.accent + "44" }}>
            <div className="p-6" style={{ background: `linear-gradient(135deg, ${briefing.accent}18, transparent)` }}>
              <div className="font-mono text-[10px] font-bold uppercase tracking-[0.4em]" style={{ color: briefing.accent }}>
                {briefing.id === 0 ? "Free play · practice" : `Mission ${briefing.id} · ${briefing.codename}`}
              </div>
              <h2 className="mt-2 text-3xl font-black uppercase tracking-wide text-white">{briefing.name}</h2>
              <div className="mt-1 flex gap-4 text-xs text-zinc-400">
                <span>📍 {briefing.location}</span>
                <span>🕐 {briefing.timeOfDay}</span>
                <span>👥 {briefing.enemies.length} hostiles</span>
              </div>
            </div>
            <div className="max-h-[40vh] space-y-3 overflow-y-auto p-6">
              {briefing.briefing.map((line, i) => (
                <p key={i} className="border-l-2 pl-3 text-sm leading-relaxed text-zinc-300" style={{ borderColor: briefing.accent + "66" }}>
                  {line}
                </p>
              ))}
              <div className="pt-2">
                <div className="mb-2 text-[10px] font-bold uppercase tracking-[0.3em] text-zinc-500">Objectives</div>
                <ul className="space-y-1.5">
                  {briefing.objectives.map((o) => (
                    <li key={o.id} className="flex items-center gap-2 text-sm text-zinc-300">
                      <span className="text-emerald-400">◆</span>
                      {o.label}
                      {o.count !== undefined && <span className="font-mono text-xs text-zinc-500">×{o.count}</span>}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
            <div className="flex items-center justify-between gap-4 border-t border-white/10 p-5">
              <button
                onClick={() => setScreen("menu")}
                className="rounded-md border border-white/15 px-5 py-2.5 text-sm font-bold uppercase tracking-widest text-zinc-300 transition hover:bg-white/10"
              >
                Back
              </button>
              <button
                onClick={() => startMission(briefing)}
                className="rounded-md px-8 py-2.5 text-sm font-black uppercase tracking-widest text-black transition hover:opacity-90"
                style={{ background: briefing.accent }}
              >
                Deploy
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ================= PLAYING ================= */}
      {playing && (
        <>
          {/* vignette + damage */}
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_55%,rgba(0,0,0,0.55)_100%)]" />
          {hud.health < 100 && !hud.dead && (
            <div
              className="pointer-events-none absolute inset-0"
              style={{ boxShadow: `inset 0 0 ${120 + (100 - hud.health)}px rgba(160,0,0,${(100 - hud.health) / 160})` }}
            />
          )}

          {/* crosshair */}
          {hud.phase !== "loading" && !hud.dead && !hud.showcase && (
            <div className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
              <div className="relative" style={{ width: spreadPx * 2, height: spreadPx * 2 }}>
                {[0, 90, 180, 270].map((r) => (
                  <div key={r} className="absolute left-1/2 top-1/2" style={{ transform: `rotate(${r}deg) translateY(-${spreadPx}px)` }}>
                    <div className="-ml-px h-2.5 w-0.5 bg-white/90 shadow-[0_0_2px_rgba(0,0,0,0.9)]" />
                  </div>
                ))}
                <div className="absolute left-1/2 top-1/2 h-[3px] w-[3px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-white shadow-[0_0_3px_rgba(0,0,0,1)]" />
                {hud.hitMarker > 0 && (
                  <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-xl font-black text-red-500 drop-shadow">✕</div>
                )}
              </div>
            </div>
          )}

          {/* mission header + objectives (top-left) */}
          {hud.mission && (() => {
            const m = hud.mission;
            return (
              <div className="pointer-events-none absolute left-5 top-5 max-w-sm space-y-3">
                <div>
                  <div className="font-mono text-[10px] font-bold uppercase tracking-[0.35em]" style={{ color: m.accent }}>
                    {m.id === 0 ? "Practice Range" : `Mission ${m.id} · ${m.codename}`}
                  </div>
                  <div className="text-lg font-black uppercase tracking-wide text-white drop-shadow">{m.name}</div>
                  <div className="text-[11px] text-zinc-500">{m.timeOfDay} · {m.location}</div>
                </div>
                <div className="space-y-1.5">
                  {hud.objectives.map((o) => (
                    <ObjectiveRow key={o.id} o={o} accent={m.accent} />
                  ))}
                </div>
              </div>
            );
          })()}

          {/* boss bar */}
          {hud.boss && (
            <div className="pointer-events-none absolute left-1/2 top-20 -translate-x-1/2 w-80 text-center">
              <div className="mb-1 text-xs font-bold uppercase tracking-[0.3em] text-red-400 drop-shadow">{hud.boss.name}</div>
              <div className="h-2.5 overflow-hidden rounded-sm border border-red-500/50 bg-black/70">
                <div className="h-full bg-gradient-to-r from-red-600 to-red-400 transition-all duration-200" style={{ width: `${Math.max(0, (hud.boss.hp / hud.boss.maxHp) * 100)}%` }} />
              </div>
            </div>
          )}

          {/* dialogue */}
          {hud.dialogue && (
            <div
              key={hud.dialogue.text}
              className="pointer-events-none absolute bottom-28 left-1/2 w-[min(640px,80vw)] -translate-x-1/2 animate-[fadeIn_0.3s_ease] text-center"
            >
              <div className="rounded-lg border border-white/15 bg-black/70 px-5 py-3 backdrop-blur-md">
                <div className="text-[10px] font-bold uppercase tracking-[0.3em] text-amber-400">{hud.dialogue.speaker}</div>
                <div className="mt-1 text-sm leading-relaxed text-zinc-100 drop-shadow">{hud.dialogue.text}</div>
              </div>
            </div>
          )}

          {/* extraction prompt */}
          {hud.objectives.some((o) => !o.done && o.id === "extract") === false && hud.objectives.some((o) => o.id === "extract") && !hud.dead && (
            <div className="pointer-events-none absolute bottom-56 left-1/2 -translate-x-1/2 animate-pulse text-center">
              <div className="rounded-full border border-emerald-400/50 bg-emerald-400/10 px-5 py-1.5 text-xs font-bold uppercase tracking-[0.25em] text-emerald-300 backdrop-blur">
                ▶ Reach extraction
              </div>
            </div>
          )}

          {/* right: ammo + health */}
          {hud.phase !== "loading" && (
            <div className="pointer-events-none absolute bottom-5 right-5 w-64 space-y-2 text-right">
              {hud.reloading && (
                <div className="ml-auto h-1.5 w-48 overflow-hidden rounded bg-white/15">
                  <div className="h-full bg-amber-400" style={{ width: `${hud.reloadProgress * 100}%` }} />
                </div>
              )}
              <div className="font-mono leading-none">
                <span className={`text-6xl font-black tabular-nums drop-shadow-lg ${hud.ammo <= 8 ? "text-red-400" : "text-white"}`}>
                  {String(hud.ammo).padStart(2, "0")}
                </span>
                <span className="ml-1 text-2xl font-bold text-zinc-400">/ {hud.reserve}</span>
              </div>
              <div className="flex items-center justify-end gap-2">
                <span className="text-[10px] font-semibold uppercase tracking-[0.3em] text-zinc-400">HP</span>
                <div className="h-2.5 w-44 overflow-hidden rounded-sm border border-white/15 bg-black/60">
                  <div
                    className={`h-full transition-all duration-200 ${healthPct > 50 ? "bg-emerald-400" : healthPct > 25 ? "bg-amber-400" : "bg-red-500"}`}
                    style={{ width: `${healthPct}%` }}
                  />
                </div>
                <span className="w-8 font-mono text-sm text-zinc-200">{Math.round(healthPct)}</span>
              </div>
            </div>
          )}

          {/* capture hint */}
          {hud.phase === "ready" && !hud.locked && !hud.dead && !hud.paused && (
            <div className="pointer-events-none absolute bottom-6 left-1/2 -translate-x-1/2 rounded-full border border-white/15 bg-black/60 px-4 py-2 text-xs text-zinc-200 backdrop-blur">
              <b className="text-amber-300">Click the scene</b> to capture the mouse · <b className="text-amber-300">Esc</b> to pause · drag to look if capture is blocked
            </div>
          )}

          {/* loading */}
          {hud.phase === "loading" && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-5 bg-zinc-950/90 backdrop-blur">
              <div>
                <div className="text-xs font-semibold uppercase tracking-[0.4em] text-amber-400">Deploying</div>
                <div className="mt-1 text-2xl font-black uppercase tracking-wide text-white">{hud.mission?.codename ?? ""}</div>
                <div className="mt-0.5 text-xs text-zinc-500">{hud.mission?.name}</div>
              </div>
              <div className="h-1 w-72 overflow-hidden rounded bg-white/10">
                <div className="h-full bg-amber-400 transition-all" style={{ width: `${Math.max(8, hud.progress * 100)}%` }} />
              </div>
            </div>
          )}

          {/* death */}
          {hud.phase === "dead" && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-6 bg-black/70 backdrop-blur-sm">
              <div className="text-7xl font-black uppercase tracking-[0.3em] text-red-500 drop-shadow-[0_0_25px_rgba(255,0,0,0.5)]">K.I.A.</div>
              <div className="text-sm uppercase tracking-widest text-zinc-400">{hud.mission?.codename} · {hud.mission?.name}</div>
              <div className="flex gap-4">
                <button
                  onClick={() => game.current?.respawn()}
                  className="rounded-md border border-white/30 bg-white/10 px-7 py-2.5 text-sm font-bold uppercase tracking-widest backdrop-blur transition hover:bg-white/25"
                >
                  Retry mission
                </button>
                <button
                  onClick={() => {
                    game.current?.exitToMenu();
                    setScreen("menu");
                  }}
                  className="rounded-md border border-white/15 bg-black/50 px-7 py-2.5 text-sm font-bold uppercase tracking-widest text-zinc-300 backdrop-blur transition hover:bg-black/70"
                >
                  Quit to menu
                </button>
              </div>
            </div>
          )}

          {/* complete */}
          {hud.phase === "complete" && endInfo?.success && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/80 p-6 backdrop-blur-sm">
              <div className="w-full max-w-xl overflow-hidden rounded-2xl border border-emerald-400/30 bg-[#0c100d] shadow-2xl">
                <div className="bg-emerald-500/10 p-6 text-center">
                  <div className="text-xs font-bold uppercase tracking-[0.4em] text-emerald-400">Mission complete</div>
                  <div className="mt-2 text-2xl font-black uppercase tracking-wide text-white">{endInfo.mission.codename}</div>
                  <div className="text-xs text-zinc-400">{endInfo.mission.name}</div>
                </div>
                <div className="max-h-[36vh] space-y-3 overflow-y-auto p-6">
                  {endInfo.mission.debrief.map((line, i) => (
                    <p key={i} className="border-l-2 border-emerald-400/50 pl-3 text-sm leading-relaxed text-zinc-300">{line}</p>
                  ))}
                </div>
                <div className="flex items-center justify-between gap-4 border-t border-white/10 p-5">
                  <button
                    onClick={() => {
                      game.current?.exitToMenu();
                      setScreen("menu");
                    }}
                    className="rounded-md border border-white/15 px-5 py-2.5 text-sm font-bold uppercase tracking-widest text-zinc-300 transition hover:bg-white/10"
                  >
                    Menu
                  </button>
                  <div className="flex gap-3">
                    <button
                      onClick={() => startMission(endInfo.mission)}
                      className="rounded-md border border-white/20 px-5 py-2.5 text-sm font-bold uppercase tracking-widest text-zinc-200 transition hover:bg-white/10"
                    >
                      Replay
                    </button>
                    {endInfo.mission.id < MISSIONS.length - 1 && (
                      <button
                        onClick={() => {
                          const next = MISSIONS.find((m) => m.id === endInfo.mission.id + 1);
                          if (next) {
                            setBriefing(next);
                            setScreen("briefing");
                          }
                        }}
                        className="rounded-md px-7 py-2.5 text-sm font-black uppercase tracking-widest text-black transition hover:opacity-90"
                        style={{ background: endInfo.mission.accent }}
                      >
                        Next mission →
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* pause */}
          {hud.paused && hud.phase === "ready" && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-5 bg-black/75 backdrop-blur">
              <div className="text-4xl font-black uppercase tracking-[0.3em] text-amber-400">Paused</div>
              <div className="flex flex-col gap-3">
                <button
                  onClick={() => game.current?.setPaused(false)}
                  className="w-64 rounded-md border border-white/25 bg-white/10 px-6 py-2.5 text-sm font-bold uppercase tracking-widest backdrop-blur transition hover:bg-white/20"
                >
                  Resume (Esc)
                </button>
                <button
                  onClick={() => game.current?.respawn()}
                  className="w-64 rounded-md border border-white/15 bg-black/50 px-6 py-2.5 text-sm font-bold uppercase tracking-widest text-zinc-300 backdrop-blur transition hover:bg-black/70"
                >
                  Restart mission
                </button>
                <button
                  onClick={() => {
                    game.current?.exitToMenu();
                    setScreen("menu");
                  }}
                  className="w-64 rounded-md border border-white/15 bg-black/50 px-6 py-2.5 text-sm font-bold uppercase tracking-widest text-zinc-300 backdrop-blur transition hover:bg-black/70"
                >
                  Quit to menu
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function ObjectiveRow({ o, accent }: { o: ObjectiveState; accent: string }) {
  const done = o.done;
  const progressText = o.total > 1 ? ` ${o.progress}/${o.total}` : "";
  return (
    <div
      className={`flex items-center gap-2 rounded border px-2.5 py-1.5 text-xs backdrop-blur transition ${
        done ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-300" : "border-white/10 bg-black/50 text-zinc-300"
      }`}
    >
      <span className={done ? "text-emerald-400" : "text-zinc-500"}>{done ? "✓" : "◇"}</span>
      <span className={done ? "line-through decoration-emerald-400/50" : ""}>{o.label}</span>
      {!done && progressText && <span className="ml-auto font-mono text-zinc-500">{progressText}</span>}
      {!done && o.total <= 1 && <span className="ml-auto h-1.5 w-1.5 animate-pulse rounded-full" style={{ background: accent }} />}
    </div>
  );
}
