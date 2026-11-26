import { useEffect, useMemo, useState } from "react";
import { Cpu, HardDrive, Play, ShieldAlert, ShieldCheck, Sparkles, Zap } from "lucide-react";
import {
  GRAPHICS_PROFILES,
  loadLauncherPreset,
  prewarmCoreAssets,
  probeClientHardware,
  saveLauncherPreset,
  type GraphicsPresetId,
} from "../game/launcherConfig";

interface GameLauncherProps {
  onLaunch: (opts: { preset: GraphicsPresetId; autoStartOpenWorld: boolean }) => void;
}

export function GameLauncher({ onLaunch }: GameLauncherProps) {
  const probe = useMemo(() => probeClientHardware(), []);
  const [preset, setPreset] = useState<GraphicsPresetId>(() => {
    const saved = loadLauncherPreset();
    return probe.previousBootInterrupted ? "safe" : saved;
  });
  const [caching, setCaching] = useState(false);
  const [cacheDone, setCacheDone] = useState(0);
  const [cacheTotal, setCacheTotal] = useState(12);
  const [cacheFile, setCacheFile] = useState<string | null>(null);
  const [verified, setVerified] = useState(false);

  useEffect(() => {
    saveLauncherPreset(preset);
  }, [preset]);

  const handleVerifyAssets = async () => {
    if (caching) return;
    setCaching(true);
    setCacheDone(0);
    await prewarmCoreAssets((done, total, file) => {
      setCacheDone(done);
      setCacheTotal(total);
      setCacheFile(file);
    });
    setCaching(false);
    setVerified(true);
    setCacheFile(null);
  };

  const handleStart = async (selectedPreset: GraphicsPresetId, autoStartOpenWorld: boolean) => {
    saveLauncherPreset(selectedPreset);
    if (!verified && !caching) {
      setCaching(true);
      await prewarmCoreAssets((done, total, file) => {
        setCacheDone(done);
        setCacheTotal(total);
        setCacheFile(file);
      });
      setCaching(false);
      setVerified(true);
    }
    onLaunch({ preset: selectedPreset, autoStartOpenWorld });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-[#07090d] text-[#eef2f6]">
      <div
        className="pointer-events-none fixed inset-0 opacity-40"
        style={{
          background:
            "radial-gradient(circle at 20% 20%, rgba(245, 158, 11, 0.16), transparent 45%), radial-gradient(circle at 80% 75%, rgba(56, 189, 248, 0.14), transparent 50%)",
        }}
      />

      <div className="relative z-10 mx-4 my-6 w-full max-w-4xl border border-white/10 bg-[#0d1118]/95 p-6 shadow-2xl backdrop-blur-xl sm:p-8">
        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-white/10 pb-5">
          <div>
            <div className="flex items-center gap-2 font-mono text-[11px] font-bold uppercase tracking-[0.26em] text-[#f59e0b]">
              <span>WESTGATE GAMES LAUNCHER</span>
              <span className="rounded bg-[#f59e0b]/15 px-2 py-0.5 text-[10px]">PRE-BOOT ENGINE GATE</span>
            </div>
            <h1 className="mt-1.5 font-display text-3xl font-black uppercase tracking-wide text-white sm:text-4xl">
              BLACKOUT · WESTGATE BAY
            </h1>
          </div>

          <div className="flex items-center gap-2 rounded border border-white/10 bg-black/40 px-3 py-2 font-mono text-[11px] text-[#94a3b8]">
            <Cpu className="h-4 w-4 text-[#38bdf8]" />
            <div className="max-w-[260px] truncate" title={probe.gpuRenderer}>
              {probe.gpuRenderer}
            </div>
          </div>
        </div>

        {/* Crash / Safe Mode Recovery Alert */}
        {probe.previousBootInterrupted && (
          <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border border-[#ef4444]/50 bg-[#7f1d1d]/25 px-4 py-3">
            <div className="flex items-center gap-3">
              <ShieldAlert className="h-5 w-5 shrink-0 text-[#f87171]" />
              <div>
                <div className="font-mono text-xs font-bold uppercase tracking-wider text-[#fecaca]">
                  Previous Spawn Interrupted — Safe Mode Pre-Selected
                </div>
                <div className="text-xs text-[#fca5a5]/90">
                  The last 3D session did not finish booting. Safe Mode disables heavy post-FX &amp; extra GLB streaming to prevent VRAM crashes.
                </div>
              </div>
            </div>
            <button
              onClick={() => void handleStart("safe", true)}
              disabled={caching}
              className="cursor-pointer bg-[#ef4444] px-3.5 py-2 font-mono text-xs font-black uppercase tracking-wider text-white transition hover:bg-[#dc2626] disabled:opacity-50"
            >
              Launch Safe Mode
            </button>
          </div>
        )}

        {/* Hardware Preflight Bar */}
        <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="border border-white/10 bg-black/35 px-3 py-2.5">
            <div className="font-mono text-[10px] uppercase tracking-wider text-[#64748b]">Graphics API</div>
            <div className="mt-0.5 font-mono text-xs font-bold text-[#34d399]">
              {probe.webgl2 ? "WebGL 2.0 Ready" : "WebGL 1.0 Fallback"}
            </div>
          </div>
          <div className="border border-white/10 bg-black/35 px-3 py-2.5">
            <div className="font-mono text-[10px] uppercase tracking-wider text-[#64748b]">System Memory</div>
            <div className="mt-0.5 font-mono text-xs font-bold text-white">
              {probe.deviceMemoryGb ? `${probe.deviceMemoryGb} GB RAM` : "Standard"} · {probe.cores} Threads
            </div>
          </div>
          <div className="border border-white/10 bg-black/35 px-3 py-2.5">
            <div className="font-mono text-[10px] uppercase tracking-wider text-[#64748b]">Max Texture</div>
            <div className="mt-0.5 font-mono text-xs font-bold text-white">
              {probe.maxTextureSize}×{probe.maxTextureSize}
            </div>
          </div>
          <div className="border border-white/10 bg-black/35 px-3 py-2.5">
            <div className="font-mono text-[10px] uppercase tracking-wider text-[#64748b]">Auto Recommendation</div>
            <div className="mt-0.5 font-mono text-xs font-bold uppercase text-[#f59e0b]">
              {probe.recommended}
            </div>
          </div>
        </div>

        {/* Graphics & Streaming Profiles */}
        <div className="mt-6">
          <div className="mb-2.5 font-mono text-[11px] font-bold uppercase tracking-[0.2em] text-[#94a3b8]">
            Select Engine &amp; Memory Profile
          </div>
          <div className="grid gap-3 md:grid-cols-3">
            {(["safe", "balanced", "ultra"] as GraphicsPresetId[]).map((id) => {
              const prof = GRAPHICS_PROFILES[id];
              const active = preset === id;
              const isRec = probe.recommended === id;
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => setPreset(id)}
                  className={`cursor-pointer border p-4 text-left transition ${
                    active
                      ? "border-[#f59e0b] bg-[#f59e0b]/12 shadow-[0_0_24px_rgba(245,158,11,0.12)]"
                      : "border-white/10 bg-black/30 hover:border-white/25"
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-xs font-black uppercase tracking-wider text-white">
                      {id === "safe" ? "Safe Mode" : id === "balanced" ? "Balanced" : "Ultra"}
                    </span>
                    {isRec && (
                      <span className="bg-[#38bdf8]/20 px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase text-[#38bdf8]">
                        Recommended
                      </span>
                    )}
                  </div>
                  <p className="mt-2 text-xs leading-relaxed text-[#94a3b8]">{prof.tagline}</p>
                  <div className="mt-3 flex flex-wrap gap-1.5 font-mono text-[10px] text-[#cbd5e1]">
                    <span className="bg-white/5 px-1.5 py-0.5">DPR ≤ {prof.maxDpr}</span>
                    <span className="bg-white/5 px-1.5 py-0.5">
                      {prof.shadowsEnabled ? `Shadows ${prof.nearShadowSize}` : "Shadows Off"}
                    </span>
                    <span className="bg-white/5 px-1.5 py-0.5">
                      {prof.useN8ao ? "N8AO On" : prof.useComposer ? "SMAA + Bloom" : "Direct WebGL"}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Asset Cache Warmup Bar */}
        <div className="mt-6 border border-white/10 bg-black/40 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              {verified ? (
                <ShieldCheck className="h-4 w-4 text-[#22c55e]" />
              ) : (
                <HardDrive className="h-4 w-4 text-[#38bdf8]" />
              )}
              <div className="font-mono text-xs text-[#cbd5e1]">
                {caching
                  ? `Pre-caching core binaries (${cacheDone}/${cacheTotal}): ${cacheFile ?? "..."}`
                  : verified
                    ? `Core assets verified & cached (${cacheTotal}/${cacheTotal}) — ready for staggered boot`
                    : "Pre-cache core models & animations sequentially before starting 3D engine"}
              </div>
            </div>
            <button
              type="button"
              onClick={() => void handleVerifyAssets()}
              disabled={caching}
              className="cursor-pointer border border-white/15 bg-white/5 px-3 py-1.5 font-mono text-[11px] font-bold uppercase tracking-wider text-[#e2e8f0] transition hover:bg-white/10 disabled:opacity-50"
            >
              {caching ? "Verifying..." : verified ? "Re-Verify Cache" : "Verify & Pre-Cache"}
            </button>
          </div>
          {(caching || verified) && (
            <div className="mt-2.5 h-1.5 w-full overflow-hidden bg-white/10">
              <div
                className="h-full transition-all duration-150"
                style={{
                  width: `${Math.round(((verified ? cacheTotal : cacheDone) / Math.max(1, cacheTotal)) * 100)}%`,
                  background: verified ? "#22c55e" : "#38bdf8",
                }}
              />
            </div>
          )}
        </div>

        {/* Launch Buttons */}
        <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
          <button
            type="button"
            onClick={() => void handleStart("safe", true)}
            disabled={caching}
            className="flex cursor-pointer items-center gap-2 border border-[#22c55e]/40 bg-[#22c55e]/12 px-4 py-3 font-mono text-xs font-bold uppercase tracking-wider text-[#86efac] transition hover:bg-[#22c55e]/20 disabled:opacity-50"
          >
            <Zap className="h-4 w-4" />
            <span>1-Click Safe Spawn (Low VRAM)</span>
          </button>

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => void handleStart(preset, false)}
              disabled={caching}
              className="flex cursor-pointer items-center gap-2 border border-white/15 bg-white/5 px-4 py-3 font-mono text-xs font-bold uppercase tracking-wider text-white transition hover:bg-white/10 disabled:opacity-50"
            >
              <Sparkles className="h-4 w-4 text-[#38bdf8]" />
              <span>Main Menu &amp; Armory</span>
            </button>
            <button
              type="button"
              onClick={() => void handleStart(preset, true)}
              disabled={caching}
              className="flex cursor-pointer items-center gap-2.5 bg-[#f59e0b] px-6 py-3 font-mono text-xs font-black uppercase tracking-[0.18em] text-[#07080b] shadow-lg transition hover:bg-[#fbbf24] disabled:opacity-50"
            >
              <Play className="h-4 w-4 fill-current" />
              <span>Launch Westgate Bay</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
