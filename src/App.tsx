import { useEffect, useMemo, useRef, useState } from "react";
import {
  CAMERA_ORDER,
  Game,
  type CameraPreset,
  type HudState,
  type ObjectiveState,
} from "./game/Game";
import { MISSIONS, OPEN_WORLD_MISSION, type MissionDef } from "./game/story";
import { WESTGATE_TELEPORTS } from "./game/city";
import {
  canAfford,
  DEFAULT_APPEARANCE,
  getPlayerStats,
  getUpgradeLevel,
  loadSave,
  previewMissionBaseReward,
  purchaseCar,
  purchaseUpgrade,
  resetSave,
  selectOwnedCar,
  UPGRADES,
  writeSave,
  type ArmorFinish,
  type CurrencyKey,
  type MissionReward,
  type NvgMode,
  type SaveData,
  type SoldierAppearance,
  type UpgradeCategory,
  type WeaponFinish,
} from "./game/progression";
import { CARS, PAINT_COLORS, type CarId } from "./game/vehicles/catalog";
import { WEATHER_MODES, type WeatherMode } from "./game/vehicles/weather";
import { TIME_OF_DAY_LABELS, TIME_OF_DAY_MODES, type TimeOfDayMode } from "./game/city/WestgateWorld";
import { WestgateMinimap } from "./components/WestgateMinimap";
import { WEAPONS } from "./character/rifle";
import soldierUrl from "./assets/soldier.glb?url";
import creditsIcon from "./assets/currencies/credits.png";
import intelIcon from "./assets/currencies/intel.png";
import salvageIcon from "./assets/currencies/salvage.png";

const CURRENCY_META: Record<CurrencyKey, { label: string; icon: string; color: string }> = {
  credits: { label: "Credits", icon: creditsIcon, color: "text-amber-300" },
  intel: { label: "Intel", icon: intelIcon, color: "text-cyan-300" },
  salvage: { label: "Salvage", icon: salvageIcon, color: "text-orange-300" },
};

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
  maxHealth: 100,
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
  weaponIndex: 0,
  weaponName: "Vanguard M4A1-S",
  weaponCategory: "Silenced Carbine",
  zoomFactor: 1.0,
  suppressed: true,
  stealthState: "hidden",
  suspicion: 0,
  stealthKills: 0,
  alerts: 0,
  takedownReady: false,
  interact: null,
  extractReady: false,
  extractDist: null,
  extractDirAngle: null,
  isOpenWorld: false,
  district: null,
  weatherMode: "auto",
  weatherLabel: "Clear",
  timeOfDay: "afternoon",
  timeOfDayLabel: "Afternoon",
  activityToast: null,
  cameraPreset: "close",
  credits: 180,
  vehicle: null,
  weapons: WEAPONS.map((w) => ({
    slot: w.slot,
    shortName: w.shortName,
    category: w.category,
    mag: w.magSize,
    reserve: w.reserveMax,
  })),
};

const KEYS: [string, string][] = [
  ["W A S D", "Move"],
  ["Mouse", "Aim / Look"],
  ["Left Click", "Fire (silenced)"],
  ["Right Click", "Aim Down Sights"],
  ["Scroll Wheel", "Zoom Optic (ADS)"],
  ["1 – 4", "Switch Weapon"],
  ["F (hold / press)", "Interact / Enter & Exit Car"],
  ["C", "Crouch (on foot) / Cycle Camera (driving)"],
  ["B", "Cycle Weather (Auto / Clear / Rain / Snow)"],
  ["V", "Silent Takedown"],
  ["Left Shift", "Sprint (loud)"],
  ["Space", "Jump"],
  ["R", "Reload"],
  ["Q / E", "Lean Left / Right"],
  ["Tab", "Showcase Orbit"],
  ["Esc", "Pause"],
];

const UPGRADE_TABS: { id: UpgradeCategory; label: string }[] = [
  { id: "weapons", label: "Weapons" },
  { id: "armour", label: "Armour" },
  { id: "stealth", label: "Stealth" },
  { id: "precision", label: "Precision" },
];

const ARMOR_PRESETS: { name: string; hex: string }[] = [
  { name: "Vanguard Ivory", hex: "#e6e8ec" },
  { name: "Obsidian Spec-Ops", hex: "#262b33" },
  { name: "Midnight Navy", hex: "#22364d" },
  { name: "Olive Drab", hex: "#4b5842" },
  { name: "Desert Coyote", hex: "#8e795b" },
  { name: "Crimson Ghost", hex: "#6e252a" },
  { name: "Arctic Slate", hex: "#7b8a99" },
  { name: "Cobalt Stealth", hex: "#2b4e78" },
];

const GEAR_PRESETS: { name: string; hex: string }[] = [
  { name: "Charcoal", hex: "#2e3338" },
  { name: "Night Black", hex: "#16191e" },
  { name: "Ranger Green", hex: "#3c4736" },
  { name: "Coyote Tan", hex: "#7a674d" },
  { name: "Slate Steel", hex: "#4a5565" },
  { name: "Crimson", hex: "#5a2125" },
];

const VISOR_PRESETS: { name: string; hex: string }[] = [
  { name: "Tactical Cyan", hex: "#22d3ee" },
  { name: "Amber Hunter", hex: "#f59e0b" },
  { name: "Predator Red", hex: "#ef4444" },
  { name: "NVG Green", hex: "#34d399" },
  { name: "Ghost Violet", hex: "#a855f7" },
  { name: "Blackout", hex: "#1a202c" },
];

const WEAPON_FINISH_OPTIONS: { id: WeaponFinish; label: string; swatch: string }[] = [
  { id: "obsidian", label: "Obsidian", swatch: "#1d2026" },
  { id: "coyote", label: "Coyote", swatch: "#7c6b53" },
  { id: "arctic", label: "Arctic", swatch: "#b8c0ca" },
  { id: "crimson", label: "Crimson", swatch: "#8b232a" },
  { id: "gold", label: "Gold-Trim", swatch: "#c29336" },
];

type Screen = "home" | "missions" | "upgrades" | "customize" | "garage" | "controls" | "playing";

function CurrencyBadge({ kind, amount, compact = false }: { kind: CurrencyKey; amount: number; compact?: boolean }) {
  const m = CURRENCY_META[kind];
  return (
    <div
      className={`inline-flex items-center gap-2 rounded-full border border-white/10 bg-black/65 backdrop-blur-md ${
        compact ? "px-2 py-0.5 text-[11px]" : "px-3 py-1 text-xs"
      }`}
      title={m.label}
    >
      <img src={m.icon} alt={m.label} className={`${compact ? "h-4 w-4" : "h-5 w-5"} shrink-0 object-contain`} />
      <span className={`font-mono font-bold tabular-nums ${m.color}`}>{amount}</span>
      {!compact && <span className="text-[10px] uppercase tracking-wider text-zinc-400">{m.label}</span>}
    </div>
  );
}

export default function App() {
  const host = useRef<HTMLDivElement>(null);
  const game = useRef<Game | null>(null);
  const [hud, setHud] = useState<HudState>(initial);
  const [screen, setScreen] = useState<Screen>("home");
  const [save, setSave] = useState<SaveData>(() => loadSave());
  const [selectedMissionId, setSelectedMissionId] = useState<number>(() => {
    const s = loadSave();
    const next = Math.min(MISSIONS.length - 1, Math.max(1, s.unlocked));
    return next;
  });
  const [upgradeTab, setUpgradeTab] = useState<UpgradeCategory>("weapons");
  const [customTab, setCustomTab] = useState<"colors" | "gear">("colors");
  const [, setCamTick] = useState(0);
  const [gpsTargetId, setGpsTargetId] = useState<string | null>(null);
  const [endInfo, setEndInfo] = useState<{ mission: MissionDef; success: boolean; reward?: MissionReward } | null>(null);

  const handleBuyCar = (carId: CarId) => {
    const updated = purchaseCar(carId);
    if (updated) {
      setSave(updated);
      game.current?.summonSelectedCar(carId, updated.carPaints[carId]);
    }
  };

  const handleSelectCar = (carId: CarId, paintHex?: string | null) => {
    const updated = selectOwnedCar(carId, paintHex);
    if (updated) {
      setSave(updated);
      game.current?.summonSelectedCar(carId, updated.carPaints[carId]);
    }
  };

  useEffect(() => {
    if (!host.current) return;
    const g = new Game(host.current, setHud);
    game.current = g;
    return () => {
      g.dispose();
      game.current = null;
    };
  }, []);

  const stats = useMemo(() => getPlayerStats(save), [save]);
  const unlockThreshold = Math.max(save.unlocked, 1);
  const nextMission = MISSIONS.find((m) => m.id === Math.min(MISSIONS.length - 1, unlockThreshold)) ?? MISSIONS[1];
  const selectedMission = MISSIONS.find((m) => m.id === selectedMissionId) ?? MISSIONS[1];
  const ghostCount = Object.values(save.records).filter((r) => r.ghost).length;

  const affordableCount = useMemo(
    () =>
      UPGRADES.filter((u) => {
        const lvl = getUpgradeLevel(save, u.id);
        return lvl < u.maxLevel && canAfford(save.currencies, u.costs[lvl]);
      }).length,
    [save],
  );

  const startMission = (m: MissionDef) => {
    setEndInfo(null);
    setScreen("playing");
    void game.current?.startMission(m.id, {
      onHud: setHud,
      onMissionEnd: (mission, success, reward) => {
        setEndInfo({ mission, success, reward });
        setSave(loadSave());
      },
    });
  };

  const exitToScreen = (target: Exclude<Screen, "playing">) => {
    game.current?.exitToMenu();
    setSave(loadSave());
    setEndInfo(null);
    setScreen(target);
  };

  const handleBuyUpgrade = (id: string) => {
    const updated = purchaseUpgrade(id);
    if (!updated) return;
    setSave(updated);
    game.current?.refreshStats();
  };

  const handleSelectMenuWeapon = (idx: number) => {
    setSave((prev) => {
      const updated: SaveData = { ...prev, selectedWeapon: idx };
      writeSave(updated);
      return updated;
    });
    game.current?.previewWeapon(idx);
  };

  const updateAppearance = (patch: Partial<SoldierAppearance>) => {
    setSave((prev) => {
      const nextApp: SoldierAppearance = { ...prev.appearance, ...patch };
      const updated: SaveData = { ...prev, appearance: nextApp };
      writeSave(updated);
      game.current?.previewAppearance(nextApp);
      return updated;
    });
  };

  const randomizeAppearance = () => {
    const pick = <T,>(arr: T[]) => arr[Math.floor(Math.random() * arr.length)];
    updateAppearance({
      armorColor: pick(ARMOR_PRESETS).hex,
      armorFinish: pick<ArmorFinish>(["matte", "tactical", "titanium"]),
      gearColor: pick(GEAR_PRESETS).hex,
      visorColor: pick(VISOR_PRESETS).hex,
      visorGlow: Number((0.35 + Math.random() * 0.75).toFixed(2)),
      weaponFinish: pick(WEAPON_FINISH_OPTIONS).id,
      nvg: pick<NvgMode>(["flipped", "deployed", "none"]),
      backpack: Math.random() > 0.25,
      chestRig: Math.random() > 0.2,
      holster: Math.random() > 0.2,
      headset: Math.random() > 0.2,
    });
  };

  const download = () => {
    const a = document.createElement("a");
    a.href = soldierUrl;
    a.download = "soldier_rigged.glb";
    a.click();
  };

  const healthPct = Math.max(0, Math.min(100, (hud.health / Math.max(1, hud.maxHealth)) * 100));
  const spreadPx = 6 + hud.spread * 1800;
  const playing = screen === "playing";

  return (
    <div className="relative h-screen w-screen select-none overflow-hidden bg-[#07090e] font-sans text-zinc-100">
      {/* Live 3D canvas (Menu Hangar OR Active Mission) */}
      <div ref={host} className="absolute inset-0" />

      {/* ================= MENU SHELL (Top Bar + Active Subscreen) ================= */}
      {!playing && (
        <div className="pointer-events-none absolute inset-0 flex flex-col">
          {/* Backdrop gradient: clear on right for 3D soldier on Home/Upgrades, deeper on Missions/Controls */}
          <div
            className={`absolute inset-0 -z-0 transition-colors duration-300 ${
              screen === "missions" || screen === "controls" || screen === "garage"
                ? "bg-[#07090e]/88 backdrop-blur-sm"
                : "bg-gradient-to-r from-[#07090e]/95 via-[#07090e]/55 to-transparent"
            }`}
          />

          {/* Top Navigation & Currencies Header */}
          <header className="pointer-events-auto relative z-10 flex items-center justify-between border-b border-white/10 bg-black/35 px-8 py-4 backdrop-blur-md">
            <div className="flex items-center gap-5">
              {screen !== "home" && (
                <button
                  onClick={() => setScreen("home")}
                  className="rounded-md border border-white/15 bg-white/[0.04] px-3 py-1.5 text-[11px] font-bold uppercase tracking-[0.2em] text-zinc-200 transition hover:bg-white/15"
                >
                  ← Back
                </button>
              )}
              <div className="flex items-baseline gap-3">
                <span className="text-lg font-black uppercase tracking-[0.22em] text-white">VOSS</span>
                <span className="hidden text-[11px] font-bold uppercase tracking-[0.35em] text-amber-400/90 sm:inline">
                  {screen === "home"
                    ? "Black Contract"
                    : screen === "missions"
                      ? "Client Contracts"
                      : screen === "upgrades"
                        ? "Armory & Upgrades"
                        : screen === "customize"
                          ? "Operative Customizer"
                          : screen === "garage"
                            ? "Dealership & Garage"
                            : "Field Manual"}
                </span>
              </div>
            </div>

            <div className="flex items-center gap-2.5">
              <CurrencyBadge kind="credits" amount={save.currencies.credits} />
              <CurrencyBadge kind="intel" amount={save.currencies.intel} />
              <CurrencyBadge kind="salvage" amount={save.currencies.salvage} />
            </div>
          </header>

          {/* ================= HOME (Main Hub with 3D Soldier on Right) ================= */}
          {screen === "home" && (
            <div className="relative z-10 flex flex-1 items-center justify-between px-10 py-8">
              <div className="pointer-events-auto flex w-full max-w-md flex-col gap-7">
                <div>
                  <div className="font-mono text-[10px] font-bold uppercase tracking-[0.4em] text-amber-400">
                    Thief · Spy · Assassin · Westgate
                  </div>
                  <h1 className="mt-2 text-4xl font-black uppercase tracking-[0.12em] text-white">
                    Black Contract
                  </h1>
                  <p className="mt-2 text-xs leading-relaxed text-zinc-400">
                    High-paying clients hire you to scrub servers, steal diamonds and ledgers, silence rivals, and leave the area before anyone catches on.
                  </p>
                </div>

                {/* Focused navigation buttons */}
                <nav className="flex flex-col gap-2.5">
                  <button
                    onClick={() => {
                      setSelectedMissionId(nextMission.id);
                      setScreen("missions");
                    }}
                    className="group flex items-center justify-between rounded-lg border border-amber-400/50 bg-amber-400 px-5 py-3.5 text-left text-black transition hover:bg-amber-300"
                  >
                      <div>
                        <div className="text-[10px] font-black uppercase tracking-[0.28em] text-black/70">
                          Next Contract · C{nextMission.id}
                        </div>
                        <div className="text-sm font-black uppercase tracking-[0.16em]">{nextMission.codename}</div>
                      </div>
                      <span className="text-base font-black transition-transform group-hover:translate-x-1">→</span>
                    </button>

                    <button
                      onClick={() => setScreen("missions")}
                      className="flex items-center justify-between rounded-lg border border-white/12 bg-white/[0.04] px-5 py-3 text-left transition hover:border-white/30 hover:bg-white/[0.09]"
                    >
                      <div>
                        <div className="text-xs font-bold uppercase tracking-[0.2em] text-white">Contracts</div>
                      <div className="text-[11px] text-zinc-400">
                        {Math.min(MISSIONS.length - 1, unlockThreshold)} / {MISSIONS.length - 1} unlocked · {ghostCount} Ghost
                      </div>
                    </div>
                    <span className="text-xs text-zinc-400">▶</span>
                  </button>

                  <button
                    onClick={() => setScreen("upgrades")}
                    className="flex items-center justify-between rounded-lg border border-white/12 bg-white/[0.04] px-5 py-3 text-left transition hover:border-amber-400/45 hover:bg-white/[0.09]"
                  >
                    <div>
                      <div className="text-xs font-bold uppercase tracking-[0.2em] text-white">Armory &amp; Upgrades</div>
                      <div className="text-[11px] text-zinc-400">Weapons, armour, stealth boots &amp; precision</div>
                    </div>
                    {affordableCount > 0 ? (
                      <span className="rounded-full bg-emerald-400/20 px-2.5 py-0.5 font-mono text-[10px] font-bold text-emerald-300">
                        {affordableCount} Ready
                      </span>
                    ) : (
                      <span className="text-xs text-zinc-400">▶</span>
                    )}
                  </button>

                  <button
                    onClick={() => setScreen("customize")}
                    className="flex items-center justify-between rounded-lg border border-white/12 bg-white/[0.04] px-5 py-3 text-left transition hover:border-cyan-400/45 hover:bg-white/[0.09]"
                  >
                    <div>
                      <div className="text-xs font-bold uppercase tracking-[0.2em] text-white">Customize Operative</div>
                      <div className="text-[11px] text-zinc-400">Armor paint, visor optics, weapon skin &amp; tactical gear</div>
                    </div>
                    <span
                      className="h-3.5 w-3.5 rounded-full border border-white/30"
                      style={{ background: save.appearance.armorColor }}
                    />
                  </button>

                  <button
                    onClick={() => startMission(OPEN_WORLD_MISSION)}
                    className="flex items-center justify-between rounded-lg border border-sky-400/40 bg-sky-500/12 px-5 py-3 text-left transition hover:border-sky-300/70 hover:bg-sky-500/20"
                  >
                    <div>
                      <div className="text-xs font-bold uppercase tracking-[0.2em] text-sky-200">Westgate Bay · Free Roam</div>
                      <div className="text-[11px] text-sky-300/75">2.4 km open world · 8 cars + Range Rover, rain &amp; snow</div>
                    </div>
                    <span className="rounded-full bg-sky-400/20 px-2.5 py-0.5 font-mono text-[10px] font-bold uppercase text-sky-200">
                      Open World
                    </span>
                  </button>

                  <button
                    onClick={() => setScreen("garage")}
                    className="flex items-center justify-between rounded-lg border border-emerald-400/35 bg-emerald-500/10 px-5 py-2.5 text-left transition hover:border-emerald-300/70 hover:bg-emerald-500/18"
                  >
                    <div>
                      <div className="text-xs font-bold uppercase tracking-[0.2em] text-emerald-200">Car Dealership &amp; Garage</div>
                      <div className="text-[11px] text-emerald-300/75">
                        Buy &amp; customize Overtake cars &amp; Range Rover ({save.ownedCars.length}/{CARS.length} owned)
                      </div>
                    </div>
                    <span className="font-mono text-[10px] font-bold uppercase tracking-wider text-emerald-300">
                      {CARS.find((c) => c.id === save.selectedCar)?.name ?? "Golf"}
                    </span>
                  </button>

                  <button
                    onClick={() => startMission(MISSIONS[0])}
                    className="flex items-center justify-between rounded-lg border border-white/12 bg-white/[0.04] px-5 py-2.5 text-left transition hover:border-white/30 hover:bg-white/[0.09]"
                  >
                    <span className="text-xs font-bold uppercase tracking-[0.2em] text-zinc-200">Calibration Range</span>
                    <span className="font-mono text-[10px] uppercase tracking-wider text-zinc-400">Free Play</span>
                  </button>

                  <button
                    onClick={() => setScreen("controls")}
                    className="flex items-center justify-between rounded-lg border border-white/10 bg-white/[0.02] px-5 py-2.5 text-left transition hover:border-white/25 hover:bg-white/[0.07]"
                  >
                    <span className="text-xs font-bold uppercase tracking-[0.2em] text-zinc-300">Field Manual &amp; Controls</span>
                    <span className="text-xs text-zinc-500">?</span>
                  </button>
                </nav>

                {/* Operative readiness strip */}
                <div className="grid grid-cols-3 gap-2 rounded-lg border border-white/10 bg-black/50 p-3 text-center backdrop-blur">
                  <div>
                    <div className="text-[9px] uppercase tracking-[0.2em] text-zinc-500">Armour</div>
                    <div className="mt-0.5 font-mono text-sm font-bold text-emerald-300">{stats.maxHp} HP</div>
                  </div>
                  <div>
                    <div className="text-[9px] uppercase tracking-[0.2em] text-zinc-500">Step Noise</div>
                    <div className="mt-0.5 font-mono text-sm font-bold text-cyan-300">
                      {Math.round(stats.footstepNoiseMult * 100)}%
                    </div>
                  </div>
                  <div>
                    <div className="text-[9px] uppercase tracking-[0.2em] text-zinc-500">Primary</div>
                    <div className="mt-0.5 font-mono text-sm font-bold text-amber-300">
                      {WEAPONS[save.selectedWeapon]?.shortName ?? "M4A1-S"}
                    </div>
                  </div>
                </div>
              </div>

              {/* Right-side hint over the 3D soldier */}
              <div className="pointer-events-none hidden self-end pb-2 text-right lg:block">
                <div className="font-mono text-[10px] uppercase tracking-[0.3em] text-zinc-500">
                  Drag to rotate operative · {WEAPONS[save.selectedWeapon]?.name}
                </div>
              </div>
            </div>
          )}

          {/* ================= MISSIONS SCREEN ================= */}
          {screen === "missions" && (
            <div className="pointer-events-auto relative z-10 mx-auto grid w-full max-w-6xl flex-1 grid-cols-1 gap-6 overflow-y-auto px-8 py-7 lg:grid-cols-12">
              {/* Left: Mission list */}
              <div className="space-y-2.5 lg:col-span-5">
                <div className="mb-2 text-[10px] font-bold uppercase tracking-[0.35em] text-zinc-400">
                  Select Sector
                </div>
                {MISSIONS.map((m) => {
                  const locked = !m.practice && m.id > unlockThreshold;
                  const active = selectedMission.id === m.id;
                  const rec = save.records[m.id];
                  return (
                    <button
                      key={m.id}
                      disabled={locked}
                      onClick={() => setSelectedMissionId(m.id)}
                      className={`relative flex w-full items-center justify-between overflow-hidden rounded-lg border px-4 py-3 text-left transition disabled:cursor-not-allowed disabled:opacity-40 ${
                        active ? "bg-white/[0.1]" : "bg-white/[0.03] hover:bg-white/[0.07]"
                      }`}
                      style={{ borderColor: active ? m.accent : "rgba(255,255,255,0.1)" }}
                    >
                      <div className="absolute inset-y-0 left-0 w-1" style={{ background: locked ? "#444" : m.accent }} />
                      <div className="pl-2">
                        <div className="font-mono text-[10px] font-bold uppercase tracking-[0.25em]" style={{ color: locked ? "#777" : m.accent }}>
                          {m.id === 0 ? "Free Play" : `Mission ${m.id}`}
                        </div>
                        <div className="text-sm font-black uppercase tracking-wide text-white">{m.codename}</div>
                        <div className="text-[11px] text-zinc-400">{m.name}</div>
                      </div>
                      <div className="flex flex-col items-end gap-1 text-right">
                        <span className="text-[10px] uppercase tracking-wider text-zinc-500">{m.timeOfDay}</span>
                        {locked ? (
                          <span className="text-xs text-zinc-500">Locked</span>
                        ) : rec?.ghost ? (
                          <span className="rounded bg-cyan-400/15 px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase text-cyan-300">
                            Ghost
                          </span>
                        ) : rec?.completed ? (
                          <span className="rounded bg-emerald-400/15 px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase text-emerald-300">
                            Cleared
                          </span>
                        ) : null}
                      </div>
                    </button>
                  );
                })}
              </div>

              {/* Right: Mission Dossier + Rewards + Deploy */}
              <div className="flex flex-col justify-between rounded-xl border border-white/10 bg-black/55 p-6 backdrop-blur-md lg:col-span-7">
                <div className="space-y-5">
                  <div className="border-b border-white/10 pb-4">
                    <div className="font-mono text-[10px] font-bold uppercase tracking-[0.35em]" style={{ color: selectedMission.accent }}>
                      {selectedMission.id === 0 ? "Safehouse Range" : `Contract ${selectedMission.id} · ${selectedMission.codename}`}
                    </div>
                    <h2 className="mt-1 text-3xl font-black uppercase tracking-wide text-white">{selectedMission.name}</h2>
                    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-zinc-400">
                      <span>Client: <b className="text-amber-300">{selectedMission.client}</b></span>
                      <span>Sector: <b className="text-zinc-200">{selectedMission.location}</b></span>
                      <span>Time: <b className="text-zinc-200">{selectedMission.timeOfDay}</b></span>
                      <span>Guards: <b className="text-zinc-200">{selectedMission.enemies.length} · {selectedMission.tintName}</b></span>
                    </div>
                  </div>

                  <div className="space-y-2.5">
                    {selectedMission.briefing.map((line, i) => (
                      <p key={i} className="border-l-2 pl-3 text-sm leading-relaxed text-zinc-300" style={{ borderColor: selectedMission.accent + "77" }}>
                        {line}
                      </p>
                    ))}
                  </div>

                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <div className="rounded-lg border border-white/10 bg-white/[0.02] p-3.5">
                      <div className="mb-2 text-[10px] font-bold uppercase tracking-[0.28em] text-zinc-400">Objectives</div>
                      <ul className="space-y-1.5">
                        {selectedMission.objectives.map((o) => (
                          <li key={o.id} className="flex items-center gap-2 text-xs text-zinc-200">
                            <span className="text-emerald-400">◆</span>
                            <span>{o.label}</span>
                            {o.count !== undefined && <span className="font-mono text-zinc-500">×{o.count}</span>}
                          </li>
                        ))}
                      </ul>
                    </div>

                    <div className="rounded-lg border border-white/10 bg-white/[0.02] p-3.5">
                      <div className="mb-2 text-[10px] font-bold uppercase tracking-[0.28em] text-zinc-400">
                        Completion Payout
                      </div>
                      {(() => {
                        const r = previewMissionBaseReward(selectedMission.id);
                        return (
                          <div className="space-y-2">
                            <div className="flex flex-wrap gap-1.5">
                              <CurrencyBadge kind="credits" amount={r.credits} compact />
                              <CurrencyBadge kind="intel" amount={r.intel} compact />
                              <CurrencyBadge kind="salvage" amount={r.salvage} compact />
                            </div>
                            {selectedMission.id > 0 && (
                              <div className="text-[11px] text-cyan-300/90">
                                + Ghost Bonus (0 alerts): +120 Cr · +35 Intel · +20 Salvage
                              </div>
                            )}
                          </div>
                        );
                      })()}
                    </div>
                  </div>
                </div>

                <div className="mt-6 flex items-center justify-end gap-3 border-t border-white/10 pt-5">
                  <button
                    onClick={() => startMission(selectedMission)}
                    className="rounded-lg px-8 py-3 text-sm font-black uppercase tracking-[0.2em] text-black transition hover:opacity-90"
                    style={{ background: selectedMission.accent }}
                  >
                    Deploy
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* ================= UPGRADES / ARMORY SCREEN ================= */}
          {screen === "upgrades" && (
            <div className="pointer-events-auto relative z-10 flex flex-1 overflow-hidden px-8 py-6">
              <div className="flex w-full max-w-2xl flex-col gap-4 overflow-y-auto pr-2">
                {/* Starting Weapon Preview Selector (updates 3D soldier!) */}
                <div className="rounded-xl border border-white/10 bg-black/60 p-3.5 backdrop-blur-md">
                  <div className="mb-2 flex items-center justify-between">
                    <span className="text-[10px] font-bold uppercase tracking-[0.3em] text-zinc-400">
                      Equip &amp; Inspect Silenced Weapon
                    </span>
                    <span className="font-mono text-[10px] text-amber-300">
                      {WEAPONS[save.selectedWeapon]?.name}
                    </span>
                  </div>
                  <div className="grid grid-cols-4 gap-2">
                    {WEAPONS.map((w, idx) => {
                      const active = save.selectedWeapon === idx;
                      return (
                        <button
                          key={w.id}
                          onClick={() => handleSelectMenuWeapon(idx)}
                          className={`rounded-md border px-2.5 py-2 text-left transition ${
                            active
                              ? "border-amber-400 bg-amber-400/15 text-white"
                              : "border-white/10 bg-white/[0.03] text-zinc-400 hover:bg-white/[0.08]"
                          }`}
                        >
                          <div className="font-mono text-[9px] font-bold text-amber-400">[{w.slot}]</div>
                          <div className="truncate text-xs font-bold">{w.shortName}</div>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Category Tabs */}
                <div className="grid grid-cols-4 gap-2">
                  {UPGRADE_TABS.map((t) => (
                    <button
                      key={t.id}
                      onClick={() => setUpgradeTab(t.id)}
                      className={`rounded-lg border py-2 text-xs font-bold uppercase tracking-[0.18em] transition ${
                        upgradeTab === t.id
                          ? "border-amber-400/70 bg-amber-400/15 text-amber-300"
                          : "border-white/10 bg-black/50 text-zinc-400 hover:text-zinc-200"
                      }`}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>

                {/* Upgrade List for selected tab */}
                <div className="space-y-3">
                  {UPGRADES.filter((u) => u.category === upgradeTab).map((u) => {
                    const lvl = getUpgradeLevel(save, u.id);
                    const maxed = lvl >= u.maxLevel;
                    const cost = maxed ? null : u.costs[lvl];
                    const affordable = cost ? canAfford(save.currencies, cost) : false;
                    return (
                      <div
                        key={u.id}
                        className="rounded-xl border border-white/10 bg-black/65 p-4 backdrop-blur-md"
                      >
                        <div className="flex items-start justify-between gap-4">
                          <div>
                            <div className="flex items-center gap-2.5">
                              <h3 className="text-sm font-black uppercase tracking-wide text-white">{u.name}</h3>
                              <span className="font-mono text-[10px] font-bold text-amber-400">
                                TIER {lvl}/{u.maxLevel}
                              </span>
                            </div>
                            <p className="mt-1 text-xs text-zinc-400">{u.subtitle}</p>
                          </div>

                          {/* Tier pips */}
                          <div className="flex gap-1 pt-1">
                            {Array.from({ length: u.maxLevel }).map((_, i) => (
                              <div
                                key={i}
                                className={`h-2 w-5 rounded-sm ${
                                  i < lvl ? "bg-amber-400" : "bg-white/15"
                                }`}
                              />
                            ))}
                          </div>
                        </div>

                        <div className="mt-3.5 flex flex-wrap items-center justify-between gap-3 border-t border-white/10 pt-3">
                          <div className="flex items-center gap-2 font-mono text-[11px]">
                            <span className="text-zinc-400">
                              {lvl > 0 ? u.effectLabels[lvl - 1] : "Base"}
                            </span>
                            {!maxed && (
                              <>
                                <span className="text-zinc-600">→</span>
                                <span className="font-bold text-emerald-300">{u.effectLabels[lvl]}</span>
                              </>
                            )}
                          </div>

                          {maxed ? (
                            <span className="rounded border border-emerald-400/40 bg-emerald-400/10 px-3 py-1 font-mono text-[10px] font-bold uppercase tracking-widest text-emerald-300">
                              Maxed
                            </span>
                          ) : (
                            <div className="flex items-center gap-2">
                              <div className="flex items-center gap-1">
                                {(Object.entries(cost!) as [CurrencyKey, number][]).map(([k, v]) => (
                                  <CurrencyBadge key={k} kind={k} amount={v} compact />
                                ))}
                              </div>
                              <button
                                disabled={!affordable}
                                onClick={() => handleBuyUpgrade(u.id)}
                                className={`rounded-md px-3.5 py-1.5 text-[11px] font-black uppercase tracking-widest transition ${
                                  affordable
                                    ? "bg-amber-400 text-black hover:bg-amber-300"
                                    : "cursor-not-allowed border border-white/10 bg-white/[0.04] text-zinc-500"
                                }`}
                              >
                                Upgrade
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {/* ================= CUSTOMIZE OPERATIVE SCREEN ================= */}
          {screen === "customize" && (
            <div className="pointer-events-auto relative z-10 flex flex-1 overflow-hidden px-8 py-6">
              <div className="flex w-full max-w-xl flex-col gap-4 overflow-y-auto pr-2">
                {/* Tabs + Quick Randomize/Reset */}
                <div className="flex items-center justify-between gap-3">
                  <div className="grid flex-1 grid-cols-2 gap-2">
                    <button
                      onClick={() => setCustomTab("colors")}
                      className={`rounded-lg border py-2 text-xs font-bold uppercase tracking-[0.18em] transition ${
                        customTab === "colors"
                          ? "border-cyan-400/70 bg-cyan-400/15 text-cyan-200"
                          : "border-white/10 bg-black/55 text-zinc-400 hover:text-zinc-200"
                      }`}
                    >
                      Colors &amp; Finish
                    </button>
                    <button
                      onClick={() => setCustomTab("gear")}
                      className={`rounded-lg border py-2 text-xs font-bold uppercase tracking-[0.18em] transition ${
                        customTab === "gear"
                          ? "border-cyan-400/70 bg-cyan-400/15 text-cyan-200"
                          : "border-white/10 bg-black/55 text-zinc-400 hover:text-zinc-200"
                      }`}
                    >
                      Tactical Gear
                    </button>
                  </div>
                  <button
                    onClick={randomizeAppearance}
                    className="rounded-lg border border-white/15 bg-black/55 px-3 py-2 text-[10px] font-bold uppercase tracking-widest text-zinc-200 transition hover:bg-white/15"
                  >
                    Random
                  </button>
                  <button
                    onClick={() => updateAppearance({ ...DEFAULT_APPEARANCE })}
                    className="rounded-lg border border-white/10 bg-black/55 px-3 py-2 text-[10px] font-bold uppercase tracking-widest text-zinc-400 transition hover:text-white"
                  >
                    Reset
                  </button>
                </div>

                {customTab === "colors" && (
                  <div className="space-y-4">
                    {/* Armor Color + Finish */}
                    <div className="rounded-xl border border-white/10 bg-black/65 p-4 backdrop-blur-md space-y-3">
                      <div className="flex items-center justify-between">
                        <span className="text-[11px] font-bold uppercase tracking-[0.25em] text-zinc-300">Armor Suit Paint</span>
                        <label className="flex cursor-pointer items-center gap-2 text-[10px] font-mono uppercase text-zinc-400">
                          <span>Custom</span>
                          <input
                            type="color"
                            value={save.appearance.armorColor}
                            onChange={(e) => updateAppearance({ armorColor: e.target.value })}
                            className="h-6 w-8 cursor-pointer rounded border border-white/20 bg-transparent"
                          />
                        </label>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {ARMOR_PRESETS.map((p) => {
                          const active = save.appearance.armorColor.toLowerCase() === p.hex.toLowerCase();
                          return (
                            <button
                              key={p.hex}
                              onClick={() => updateAppearance({ armorColor: p.hex })}
                              title={p.name}
                              className={`flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-[11px] transition ${
                                active ? "border-cyan-400 bg-cyan-400/15 text-white" : "border-white/10 bg-white/[0.03] text-zinc-400 hover:text-white"
                              }`}
                            >
                              <span className="h-3.5 w-3.5 rounded-sm border border-white/25" style={{ background: p.hex }} />
                              <span>{p.name}</span>
                            </button>
                          );
                        })}
                      </div>

                      <div className="pt-1">
                        <div className="mb-1.5 text-[10px] font-bold uppercase tracking-[0.25em] text-zinc-400">Surface Material</div>
                        <div className="grid grid-cols-3 gap-2">
                          {(
                            [
                              ["matte", "Matte Stealth"],
                              ["tactical", "Tactical Ceramic"],
                              ["titanium", "Brushed Titanium"],
                            ] as [ArmorFinish, string][]
                          ).map(([id, label]) => (
                            <button
                              key={id}
                              onClick={() => updateAppearance({ armorFinish: id })}
                              className={`rounded-md border py-1.5 text-[11px] font-bold transition ${
                                save.appearance.armorFinish === id
                                  ? "border-cyan-400 bg-cyan-400/15 text-cyan-200"
                                  : "border-white/10 bg-white/[0.03] text-zinc-400 hover:text-white"
                              }`}
                            >
                              {label}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>

                    {/* Tactical Gear Color */}
                    <div className="rounded-xl border border-white/10 bg-black/65 p-4 backdrop-blur-md space-y-3">
                      <div className="flex items-center justify-between">
                        <span className="text-[11px] font-bold uppercase tracking-[0.25em] text-zinc-300">Tactical Rig &amp; Pouches</span>
                        <label className="flex cursor-pointer items-center gap-2 text-[10px] font-mono uppercase text-zinc-400">
                          <span>Custom</span>
                          <input
                            type="color"
                            value={save.appearance.gearColor}
                            onChange={(e) => updateAppearance({ gearColor: e.target.value })}
                            className="h-6 w-8 cursor-pointer rounded border border-white/20 bg-transparent"
                          />
                        </label>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {GEAR_PRESETS.map((p) => {
                          const active = save.appearance.gearColor.toLowerCase() === p.hex.toLowerCase();
                          return (
                            <button
                              key={p.hex}
                              onClick={() => updateAppearance({ gearColor: p.hex })}
                              className={`flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-[11px] transition ${
                                active ? "border-cyan-400 bg-cyan-400/15 text-white" : "border-white/10 bg-white/[0.03] text-zinc-400 hover:text-white"
                              }`}
                            >
                              <span className="h-3.5 w-3.5 rounded-sm border border-white/25" style={{ background: p.hex }} />
                              <span>{p.name}</span>
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    {/* Visor & NVG Optics */}
                    <div className="rounded-xl border border-white/10 bg-black/65 p-4 backdrop-blur-md space-y-3">
                      <div className="flex items-center justify-between">
                        <span className="text-[11px] font-bold uppercase tracking-[0.25em] text-zinc-300">Visor &amp; NVG Optics</span>
                        <label className="flex cursor-pointer items-center gap-2 text-[10px] font-mono uppercase text-zinc-400">
                          <span>Custom</span>
                          <input
                            type="color"
                            value={save.appearance.visorColor}
                            onChange={(e) => updateAppearance({ visorColor: e.target.value })}
                            className="h-6 w-8 cursor-pointer rounded border border-white/20 bg-transparent"
                          />
                        </label>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {VISOR_PRESETS.map((p) => {
                          const active = save.appearance.visorColor.toLowerCase() === p.hex.toLowerCase();
                          return (
                            <button
                              key={p.hex}
                              onClick={() => updateAppearance({ visorColor: p.hex })}
                              className={`flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-[11px] transition ${
                                active ? "border-cyan-400 bg-cyan-400/15 text-white" : "border-white/10 bg-white/[0.03] text-zinc-400 hover:text-white"
                              }`}
                            >
                              <span className="h-3.5 w-3.5 rounded-full border border-white/25" style={{ background: p.hex }} />
                              <span>{p.name}</span>
                            </button>
                          );
                        })}
                      </div>
                      <div className="flex items-center gap-3 pt-1">
                        <span className="text-[10px] font-bold uppercase tracking-[0.22em] text-zinc-400">Optic Glow</span>
                        <input
                          type="range"
                          min={0.1}
                          max={1.4}
                          step={0.05}
                          value={save.appearance.visorGlow}
                          onChange={(e) => updateAppearance({ visorGlow: Number(e.target.value) })}
                          className="flex-1 accent-cyan-400"
                        />
                        <span className="w-10 text-right font-mono text-[11px] text-cyan-300">
                          {Math.round(save.appearance.visorGlow * 100)}%
                        </span>
                      </div>
                    </div>

                    {/* Weapon Finish */}
                    <div className="rounded-xl border border-white/10 bg-black/65 p-4 backdrop-blur-md space-y-2.5">
                      <div className="flex items-center justify-between">
                        <span className="text-[11px] font-bold uppercase tracking-[0.25em] text-zinc-300">Weapon Camo Finish</span>
                        <div className="flex gap-1">
                          {WEAPONS.map((w, idx) => (
                            <button
                              key={w.id}
                              onClick={() => handleSelectMenuWeapon(idx)}
                              className={`rounded px-2 py-0.5 font-mono text-[10px] font-bold transition ${
                                save.selectedWeapon === idx ? "bg-amber-400 text-black" : "bg-white/10 text-zinc-400 hover:text-white"
                              }`}
                            >
                              {w.shortName}
                            </button>
                          ))}
                        </div>
                      </div>
                      <div className="grid grid-cols-5 gap-2">
                        {WEAPON_FINISH_OPTIONS.map((wf) => (
                          <button
                            key={wf.id}
                            onClick={() => updateAppearance({ weaponFinish: wf.id })}
                            className={`flex flex-col items-center gap-1 rounded-md border py-2 text-[10px] font-bold transition ${
                              save.appearance.weaponFinish === wf.id
                                ? "border-amber-400 bg-amber-400/15 text-amber-200"
                                : "border-white/10 bg-white/[0.03] text-zinc-400 hover:text-white"
                            }`}
                          >
                            <span className="h-3.5 w-6 rounded-sm border border-white/25" style={{ background: wf.swatch }} />
                            <span>{wf.label}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                )}

                {customTab === "gear" && (
                  <div className="space-y-4">
                    {/* NVG Goggles State */}
                    <div className="rounded-xl border border-white/10 bg-black/65 p-4 backdrop-blur-md space-y-3">
                      <div className="text-[11px] font-bold uppercase tracking-[0.25em] text-zinc-300">
                        Night-Vision Goggles (NVG)
                      </div>
                      <div className="grid grid-cols-3 gap-2">
                        {(
                          [
                            ["flipped", "Flipped Up"],
                            ["deployed", "Deployed"],
                            ["none", "Removed"],
                          ] as [NvgMode, string][]
                        ).map(([mode, label]) => (
                          <button
                            key={mode}
                            onClick={() => updateAppearance({ nvg: mode })}
                            className={`rounded-md border py-2 text-xs font-bold transition ${
                              save.appearance.nvg === mode
                                ? "border-cyan-400 bg-cyan-400/15 text-cyan-200"
                                : "border-white/10 bg-white/[0.03] text-zinc-400 hover:text-white"
                            }`}
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Modular Rig Toggles */}
                    <div className="rounded-xl border border-white/10 bg-black/65 p-4 backdrop-blur-md space-y-2.5">
                      <div className="mb-1 text-[11px] font-bold uppercase tracking-[0.25em] text-zinc-300">
                        Modular Loadout Attachments
                      </div>
                      {(
                        [
                          ["backpack", "Assault Radio Pack", "Rear tactical pack, utility pouches & whip antenna"],
                          ["chestRig", "Chest Mag Placard", "Front 3-mag tactical rig & PTT radio"],
                          ["holster", "Drop-Leg Holster & Pouch", "Thigh sidearm holster & leg utility pouch"],
                          ["headset", "Comms Headset & Light", "Helmet rails, ear-pro cups, flashlight & boom mic"],
                        ] as ["backpack" | "chestRig" | "holster" | "headset", string, string][]
                      ).map(([key, title, desc]) => {
                        const on = save.appearance[key];
                        return (
                          <button
                            key={key}
                            onClick={() => updateAppearance({ [key]: !on })}
                            className="flex w-full items-center justify-between rounded-lg border border-white/10 bg-white/[0.03] px-4 py-3 text-left transition hover:bg-white/[0.07]"
                          >
                            <div>
                              <div className="text-xs font-bold uppercase tracking-wide text-white">{title}</div>
                              <div className="text-[11px] text-zinc-400">{desc}</div>
                            </div>
                            <span
                              className={`rounded-full px-3 py-1 font-mono text-[10px] font-bold uppercase tracking-widest ${
                                on ? "bg-emerald-400/20 text-emerald-300" : "bg-white/10 text-zinc-500"
                              }`}
                            >
                              {on ? "Equipped" : "Off"}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ================= GARAGE / CAR DEALERSHIP SCREEN ================= */}
          {screen === "garage" && (
            <div className="pointer-events-auto relative z-10 mx-auto flex w-full max-w-6xl flex-1 flex-col gap-5 overflow-y-auto px-8 py-6">
              <div className="flex flex-wrap items-center justify-between gap-4 border-b border-white/10 pb-4">
                <div>
                  <h2 className="text-xl font-black uppercase tracking-[0.16em] text-white">
                    Westgate Motor Dealership
                  </h2>
                  <p className="text-xs text-zinc-400">
                    Buy &amp; select any Overtake car or Range Rover. Your active car spawns curbside in Westgate Bay — press [F] to drive.
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <CurrencyBadge kind="credits" amount={save.currencies.credits} />
                  <button
                    onClick={() => startMission(OPEN_WORLD_MISSION)}
                    className="rounded-md bg-sky-400 px-4 py-2 text-xs font-black uppercase tracking-widest text-black transition hover:bg-sky-300"
                  >
                    Drive in Westgate Bay →
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
                {CARS.map((car) => {
                  const owned = save.ownedCars.includes(car.id);
                  const active = save.selectedCar === car.id;
                  const affordable = save.currencies.credits >= car.price;
                  const currentPaint = save.carPaints[car.id] ?? car.color;
                  return (
                    <div
                      key={car.id}
                      className={`flex flex-col justify-between rounded-xl border p-4 backdrop-blur-md transition ${
                        active
                          ? "border-emerald-400/70 bg-emerald-950/25 shadow-[0_0_24px_rgba(52,211,153,0.14)]"
                          : owned
                            ? "border-white/15 bg-black/60"
                            : "border-white/10 bg-black/50"
                      }`}
                    >
                      <div className="space-y-2.5">
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <div className="font-mono text-[10px] font-bold uppercase tracking-[0.22em] text-zinc-400">
                              {car.maker} · {car.klass}
                            </div>
                            <div className="mt-0.5 text-base font-black uppercase tracking-wide text-white">
                              {car.name}
                            </div>
                          </div>
                          <span
                            className="mt-1 h-4 w-4 shrink-0 rounded-full border border-white/35"
                            style={{ background: currentPaint }}
                            title="Paint color"
                          />
                        </div>
                        <p className="text-[11px] leading-relaxed text-zinc-400">{car.tagline}</p>

                        <div className="space-y-1.5 pt-1 font-mono text-[10px] uppercase tracking-wider text-zinc-400">
                          {(
                            [
                              ["Top Speed", car.stats.speed, "bg-sky-400"],
                              ["Handling", car.stats.handling, "bg-amber-400"],
                              ["All-Weather Grip", car.stats.grip, "bg-emerald-400"],
                            ] as [string, number, string][]
                          ).map(([label, val, col]) => (
                            <div key={label} className="flex items-center justify-between gap-2">
                              <span>{label}</span>
                              <div className="flex gap-1">
                                {[1, 2, 3, 4, 5].map((n) => (
                                  <span
                                    key={n}
                                    className={`h-1.5 w-3.5 rounded-sm ${n <= val ? col : "bg-white/10"}`}
                                  />
                                ))}
                              </div>
                            </div>
                          ))}
                        </div>

                        {owned && (
                          <div className="pt-1">
                            <div className="mb-1 text-[9px] font-bold uppercase tracking-widest text-zinc-500">
                              Paint Finish
                            </div>
                            <div className="flex flex-wrap gap-1.5">
                              {PAINT_COLORS.slice(0, 8).map((p) => (
                                <button
                                  key={p.hex}
                                  onClick={() => handleSelectCar(car.id, p.hex)}
                                  title={p.name}
                                  className={`h-4 w-4 rounded-full border transition ${
                                    currentPaint.toLowerCase() === p.hex.toLowerCase()
                                      ? "scale-125 border-white"
                                      : "border-white/25 hover:scale-110"
                                  }`}
                                  style={{ background: p.hex }}
                                />
                              ))}
                            </div>
                          </div>
                        )}
                      </div>

                      <div className="mt-4 pt-3 border-t border-white/10">
                        {owned ? (
                          <button
                            onClick={() => handleSelectCar(car.id)}
                            className={`w-full rounded-md py-2 text-xs font-black uppercase tracking-widest transition ${
                              active
                                ? "bg-emerald-400 text-black"
                                : "border border-emerald-400/50 bg-emerald-400/15 text-emerald-200 hover:bg-emerald-400/25"
                            }`}
                          >
                            {active ? "✓ Selected Curbside" : "Select Car"}
                          </button>
                        ) : (
                          <button
                            disabled={!affordable}
                            onClick={() => handleBuyCar(car.id)}
                            className={`w-full rounded-md py-2 text-xs font-black uppercase tracking-widest transition ${
                              affordable
                                ? "bg-amber-400 text-black hover:bg-amber-300"
                                : "cursor-not-allowed border border-white/10 bg-white/[0.03] text-zinc-500"
                            }`}
                          >
                            Buy · {car.price} Credits
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* ================= CONTROLS / FIELD MANUAL SCREEN ================= */}
          {screen === "controls" && (
            <div className="pointer-events-auto relative z-10 mx-auto grid w-full max-w-5xl flex-1 grid-cols-1 gap-6 overflow-y-auto px-8 py-8 md:grid-cols-2">
              <div className="rounded-xl border border-white/10 bg-black/55 p-6 backdrop-blur-md">
                <h3 className="text-xs font-bold uppercase tracking-[0.35em] text-amber-400">Controls</h3>
                <div className="mt-4 space-y-2 text-xs">
                  {KEYS.map(([k, v]) => (
                    <div key={k} className="flex items-center justify-between border-b border-white/5 pb-1.5">
                      <span className="font-mono font-semibold text-amber-300">{k}</span>
                      <span className="text-zinc-300">{v}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="flex flex-col justify-between gap-6">
                <div className="rounded-xl border border-white/10 bg-black/55 p-6 backdrop-blur-md space-y-4">
                  <h3 className="text-xs font-bold uppercase tracking-[0.35em] text-cyan-300">Stealth Doctrine</h3>
                  <ul className="space-y-3 text-xs leading-relaxed text-zinc-300">
                    <li>
                      <b className="text-white">Silenced Arsenal:</b> Every weapon is suppressed. Unaware guards take{" "}
                      <span className="text-emerald-300">2.5× ambush damage</span> and drop without alerting the sector.
                    </li>
                    <li>
                      <b className="text-white">Vision Cones &amp; Suspicion:</b> Stay out of forward sightlines. Crouching cuts visual range and eliminates footstep noise.
                    </li>
                    <li>
                      <b className="text-white">Silent Takedowns:</b> Approach behind or beside an unaware guard and press{" "}
                      <span className="font-mono text-amber-300">[V]</span> for an instant quiet takedown.
                    </li>
                    <li>
                      <b className="text-white">Ghost Bonus:</b> Finish any mission with <span className="text-cyan-300">0 Alerts</span> for massive Credits, Intel &amp; Salvage payouts.
                    </li>
                  </ul>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/10 bg-black/55 p-4 backdrop-blur-md">
                  <button
                    onClick={download}
                    className="rounded-md border border-sky-400/40 bg-sky-500/15 px-4 py-2 text-[11px] font-bold uppercase tracking-widest text-sky-200 transition hover:bg-sky-500/30"
                  >
                    Download Vanguard Rig (GLB)
                  </button>
                  <button
                    onClick={() => setSave(resetSave())}
                    className="rounded-md border border-red-400/30 bg-red-500/10 px-4 py-2 text-[11px] font-bold uppercase tracking-widest text-red-300 transition hover:bg-red-500/25"
                  >
                    Reset Progress
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ================= PLAYING HUD ================= */}
      {playing && (
        <>
          {/* vignette + damage */}
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_55%,rgba(0,0,0,0.55)_100%)]" />
          {hud.health < hud.maxHealth && !hud.dead && (
            <div
              className="pointer-events-none absolute inset-0"
              style={{
                boxShadow: `inset 0 0 ${120 + (hud.maxHealth - hud.health)}px rgba(160,0,0,${Math.max(0, (hud.maxHealth - hud.health) / (hud.maxHealth * 1.5))})`,
              }}
            />
          )}

          {/* modern tactical crosshair */}
          {hud.phase !== "loading" && !hud.dead && !hud.showcase && !hud.vehicle?.active && (() => {
            const gap = Math.max(5, Math.min(26, spreadPx * 0.55));
            const len = hud.ads ? 10 : 7;
            const accent = hud.takedownReady ? "#34d399" : hud.ads ? "#22d3ee" : "#f8fafc";
            const circ = 2 * Math.PI * 16;
            return (
              <div className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
                <svg
                  width="96"
                  height="96"
                  viewBox="-48 -48 96 96"
                  className="overflow-visible drop-shadow-[0_0_3px_rgba(0,0,0,0.95)]"
                >
                  {/* ADS precision ring + mil ticks */}
                  {hud.ads && (
                    <g opacity="0.88">
                      <circle cx="0" cy="0" r="22" fill="none" stroke="#22d3ee" strokeWidth="0.9" strokeDasharray="10 6" opacity="0.55" />
                      <circle cx="0" cy="0" r="32" fill="none" stroke="#ffffff" strokeWidth="0.7" strokeDasharray="4 46.3" opacity="0.35" />
                      <line x1="-16" y1="0" x2="-6" y2="0" stroke="#22d3ee" strokeWidth="1.2" strokeLinecap="round" />
                      <line x1="6" y1="0" x2="16" y2="0" stroke="#22d3ee" strokeWidth="1.2" strokeLinecap="round" />
                      <line x1="0" y1="6" x2="0" y2="16" stroke="#22d3ee" strokeWidth="1.2" strokeLinecap="round" />
                      <line x1="0" y1="-16" x2="0" y2="-6" stroke="#22d3ee" strokeWidth="1.2" strokeLinecap="round" />
                      <circle cx="-11" cy="0" r="0.9" fill="#22d3ee" opacity="0.7" />
                      <circle cx="11" cy="0" r="0.9" fill="#22d3ee" opacity="0.7" />
                      <circle cx="0" cy="11" r="0.9" fill="#22d3ee" opacity="0.7" />
                    </g>
                  )}

                  {/* Dynamic hip-fire tapered tactical bars */}
                  {!hud.ads && (
                    <g>
                      <line x1={-gap - len} y1="0" x2={-gap} y2="0" stroke={accent} strokeWidth="1.7" strokeLinecap="round" opacity="0.92" />
                      <line x1={gap} y1="0" x2={gap + len} y2="0" stroke={accent} strokeWidth="1.7" strokeLinecap="round" opacity="0.92" />
                      <line x1="0" y1={-gap - len} x2="0" y2={-gap} stroke={accent} strokeWidth="1.7" strokeLinecap="round" opacity="0.92" />
                      <line x1="0" y1={gap} x2="0" y2={gap + len} stroke={accent} strokeWidth="1.7" strokeLinecap="round" opacity="0.92" />
                      {/* Subtle outer tactical corner ticks */}
                      <path
                        d={`M ${-gap - 6} ${-gap - 2} L ${-gap - 6} ${-gap - 6} L ${-gap - 2} ${-gap - 6}`}
                        fill="none"
                        stroke={accent}
                        strokeWidth="1"
                        opacity="0.38"
                      />
                      <path
                        d={`M ${gap + 6} ${-gap - 2} L ${gap + 6} ${-gap - 6} L ${gap + 2} ${-gap - 6}`}
                        fill="none"
                        stroke={accent}
                        strokeWidth="1"
                        opacity="0.38"
                      />
                      <path
                        d={`M ${-gap - 6} ${gap + 2} L ${-gap - 6} ${gap + 6} L ${-gap - 2} ${gap + 6}`}
                        fill="none"
                        stroke={accent}
                        strokeWidth="1"
                        opacity="0.38"
                      />
                      <path
                        d={`M ${gap + 6} ${gap + 2} L ${gap + 6} ${gap + 6} L ${gap + 2} ${gap + 6}`}
                        fill="none"
                        stroke={accent}
                        strokeWidth="1"
                        opacity="0.38"
                      />
                    </g>
                  )}

                  {/* Radial reload arc */}
                  {hud.reloading && (
                    <g transform="rotate(-90)">
                      <circle cx="0" cy="0" r="16" fill="none" stroke="rgba(255,255,255,0.16)" strokeWidth="2" />
                      <circle
                        cx="0"
                        cy="0"
                        r="16"
                        fill="none"
                        stroke="#fbbf24"
                        strokeWidth="2.2"
                        strokeLinecap="round"
                        strokeDasharray={circ}
                        strokeDashoffset={circ * (1 - hud.reloadProgress)}
                      />
                    </g>
                  )}

                  {/* Precision center dot */}
                  <circle cx="0" cy="0" r={hud.ads ? "1.6" : "1.8"} fill={accent} />

                  {/* Crisp hit-confirm diagonal burst */}
                  {hud.hitMarker > 0 && (
                    <g stroke="#ef4444" strokeWidth="2" strokeLinecap="round" opacity={Math.min(1, hud.hitMarker * 6)}>
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

          {/* mission header + objectives (top-left) */}
          {hud.mission && (() => {
            const m = hud.mission;
            return (
              <div className="pointer-events-none absolute left-5 top-5 max-w-sm space-y-3">
                <div>
                  <div className="font-mono text-[10px] font-bold uppercase tracking-[0.35em]" style={{ color: m.accent }}>
                    {m.id === -1
                      ? `Open World · ${hud.district?.name ?? "Westgate Bay"}`
                      : m.id === 0
                        ? "Practice Range"
                        : `Mission ${m.id} · ${m.codename}`}
                  </div>
                  <div className="text-lg font-black uppercase tracking-wide text-white drop-shadow">
                    {m.id === -1 ? hud.district?.name ?? m.name : m.name}
                  </div>
                  <div className="text-[11px] text-zinc-400">
                    {m.id === -1 ? `${hud.district?.subtitle ?? "Free Exploration"} · ${m.timeOfDay}` : `${m.timeOfDay} · ${m.location}`}
                  </div>
                </div>
                <div className="space-y-1.5">
                  {hud.objectives.map((o) => (
                    <ObjectiveRow key={o.id} o={o} accent={m.accent} />
                  ))}
                </div>
              </div>
            );
          })()}

          {/* stealth status pill (top-center) */}
          {hud.phase === "ready" && !hud.dead && (
            <div className="pointer-events-none absolute left-1/2 top-5 flex -translate-x-1/2 flex-col items-center gap-1.5">
              <div
                className={`flex items-center gap-2.5 rounded-full border px-4 py-1 text-[11px] font-black uppercase tracking-[0.25em] backdrop-blur-md ${
                  hud.stealthState === "compromised"
                    ? "border-red-500/60 bg-red-950/75 text-red-300 shadow-[0_0_20px_rgba(239,68,68,0.3)]"
                    : hud.stealthState === "caution"
                      ? "border-amber-400/60 bg-amber-950/70 text-amber-300"
                      : "border-emerald-400/45 bg-black/65 text-emerald-300"
                }`}
              >
                <span
                  className={`h-2 w-2 rounded-full ${
                    hud.stealthState === "compromised"
                      ? "animate-ping bg-red-400"
                      : hud.stealthState === "caution"
                        ? "animate-pulse bg-amber-400"
                        : "bg-emerald-400"
                  }`}
                />
                <span>
                  {hud.stealthState === "compromised"
                    ? "Compromised"
                    : hud.stealthState === "caution"
                      ? `Caution · ${hud.suspicion}%`
                      : hud.crouch
                        ? "Hidden · Silent"
                        : "Hidden"}
                </span>
              </div>
              {hud.stealthState === "caution" && (
                <div className="h-1 w-32 overflow-hidden rounded-full bg-black/70">
                  <div className="h-full bg-amber-400 transition-all duration-100" style={{ width: `${hud.suspicion}%` }} />
                </div>
              )}
              <div className="flex items-center gap-3 font-mono text-[10px] uppercase tracking-widest text-zinc-400">
                <span>Stealth Kills: <b className="text-emerald-300">{hud.stealthKills}</b></span>
                <span>·</span>
                <span>Alerts: <b className={hud.alerts > 0 ? "text-red-400" : "text-emerald-300"}>{hud.alerts}</b></span>
              </div>
            </div>
          )}

          {/* stealth takedown prompt */}
          {hud.takedownReady && !hud.dead && (
            <div className="pointer-events-none absolute bottom-44 left-1/2 -translate-x-1/2">
              <div className="rounded-full border border-emerald-400/60 bg-emerald-950/80 px-4 py-1.5 text-xs font-black uppercase tracking-[0.22em] text-emerald-200 backdrop-blur">
                [V] Silent Takedown
              </div>
            </div>
          )}

          {/* [F] interactive prop prompt (scrub terminal / steal diamond / take files) */}
          {hud.interact && !hud.dead && (
            <div className="pointer-events-none absolute bottom-24 left-1/2 -translate-x-1/2">
              <div className="flex min-w-[250px] flex-col items-center gap-1.5 rounded-xl border border-cyan-400/60 bg-black/80 px-5 py-2.5 text-center shadow-[0_0_24px_rgba(34,211,238,0.22)] backdrop-blur-md">
                <div className="font-mono text-[10px] font-bold uppercase tracking-[0.28em] text-cyan-300">
                  {hud.interact.holding
                    ? hud.interact.kind === "terminal"
                      ? "Scrubbing Computer…"
                      : hud.interact.kind === "diamond"
                        ? "Stealing Diamond…"
                        : hud.interact.kind === "relic"
                          ? "Recovering Gold…"
                          : "Taking Files…"
                    : `Hold [F] · ${
                        hud.interact.kind === "terminal"
                          ? "Scrub Computer"
                          : hud.interact.kind === "diamond"
                            ? "Steal Diamond"
                            : hud.interact.kind === "relic"
                              ? "Recover Gold"
                              : "Take Files"
                      }`}
                </div>
                <div className="text-xs font-black uppercase tracking-wider text-white">{hud.interact.label}</div>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/15">
                  <div
                    className="h-full rounded-full bg-cyan-400 transition-all duration-75"
                    style={{ width: `${Math.round(hud.interact.progress * 100)}%` }}
                  />
                </div>
              </div>
            </div>
          )}

          {/* Mandatory exfiltration compass banner once contract goals are finished */}
          {hud.extractReady && !hud.dead && hud.extractDist !== null && (
            <div className="pointer-events-none absolute left-1/2 top-24 -translate-x-1/2">
              <div className="flex items-center gap-3 rounded-full border border-emerald-400/70 bg-emerald-950/80 px-5 py-1.5 shadow-[0_0_25px_rgba(16,185,129,0.28)] backdrop-blur-md">
                <span
                  className="inline-block text-sm font-black text-emerald-300"
                  style={{ transform: `rotate(${Math.round(((hud.extractDirAngle ?? 0) * 180) / Math.PI)}deg)` }}
                >
                  ▲
                </span>
                <span className="font-mono text-[11px] font-black uppercase tracking-[0.24em] text-emerald-200">
                  Contract Done · Leave Area · {hud.extractDist}m
                </span>
              </div>
            </div>
          )}

          {/* boss bar */}
          {hud.boss && (
            <div className="pointer-events-none absolute left-1/2 top-24 w-80 -translate-x-1/2 text-center">
              <div className="mb-1 text-xs font-bold uppercase tracking-[0.3em] text-red-400 drop-shadow">{hud.boss.name}</div>
              <div className="h-2.5 overflow-hidden rounded-sm border border-red-500/50 bg-black/70">
                <div className="h-full bg-gradient-to-r from-red-600 to-red-400 transition-all duration-200" style={{ width: `${Math.max(0, (hud.boss.hp / hud.boss.maxHp) * 100)}%` }} />
              </div>
            </div>
          )}

          {/* top-right pause button + weather/time/camera + FPS */}
          <div className="absolute right-5 top-5 flex items-center gap-2">
            {hud.isOpenWorld && (
              <>
                <button
                  onClick={() => game.current?.cycleTimeOfDay()}
                  className="rounded-md border border-indigo-400/30 bg-black/55 px-2.5 py-1.5 font-mono text-[10px] font-bold uppercase tracking-widest text-indigo-200 backdrop-blur transition hover:bg-black/80"
                  title="Cycle time of day [T]"
                >
                  [T] {hud.timeOfDayLabel}
                </button>
                <button
                  onClick={() => game.current?.cycleWeatherMode()}
                  className="rounded-md border border-sky-400/30 bg-black/55 px-2.5 py-1.5 font-mono text-[10px] font-bold uppercase tracking-widest text-sky-200 backdrop-blur transition hover:bg-black/80"
                  title="Cycle weather [B]"
                >
                  [B] {hud.weatherLabel}
                </button>
                {hud.vehicle?.active && (
                  <button
                    onClick={() => game.current?.cycleCamera()}
                    className="rounded-md border border-amber-400/30 bg-black/55 px-2.5 py-1.5 font-mono text-[10px] font-bold uppercase tracking-widest text-amber-200 backdrop-blur transition hover:bg-black/80"
                    title="Cycle camera [C]"
                  >
                    [C] {hud.cameraPreset}
                  </button>
                )}
              </>
            )}
            <span className="pointer-events-none font-mono text-[11px] text-zinc-500">{Math.round(hud.fps)} FPS</span>
            <button
              onClick={() => game.current?.setPaused(!hud.paused)}
              className="rounded-md border border-white/15 bg-black/50 px-3 py-1.5 text-[11px] font-bold uppercase tracking-widest text-zinc-300 backdrop-blur transition hover:bg-black/80"
            >
              {hud.paused ? "Resume" : "Pause"}
            </button>
          </div>

          {/* Westgate Speed Trap / District Discovery Toast */}
          {hud.isOpenWorld && hud.activityToast && (
            <div
              key={hud.activityToast.title}
              className="pointer-events-none absolute top-20 left-1/2 -translate-x-1/2 animate-[fadeIn_0.25s_ease] text-center"
            >
              <div
                className="rounded-xl border bg-black/80 px-5 py-2.5 shadow-xl backdrop-blur-md"
                style={{ borderColor: `${hud.activityToast.accent}66` }}
              >
                <div className="text-xs font-black uppercase tracking-[0.2em]" style={{ color: hud.activityToast.accent }}>
                  {hud.activityToast.title}
                </div>
                <div className="mt-0.5 font-mono text-[10px] font-semibold uppercase tracking-wider text-zinc-200">
                  {hud.activityToast.subtitle}
                </div>
              </div>
            </div>
          )}

          {/* dialogue */}
          {hud.dialogue && (
            <div
              key={hud.dialogue.text}
              className="pointer-events-none absolute bottom-32 left-1/2 w-[min(520px,68vw)] -translate-x-1/2 animate-[fadeIn_0.3s_ease] text-center"
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

          {/* [F] enter nearby vehicle prompt */}
          {hud.vehicle && !hud.vehicle.active && hud.vehicle.nearbyName && !hud.interact && !hud.dead && (
            <div className="pointer-events-none absolute bottom-24 left-1/2 -translate-x-1/2">
              <div className="flex items-center gap-2.5 rounded-full border border-sky-400/60 bg-black/80 px-5 py-2 text-xs font-black uppercase tracking-[0.2em] text-sky-200 shadow-[0_0_24px_rgba(56,189,248,0.22)] backdrop-blur-md">
                <span className="rounded bg-sky-400/20 px-2 py-0.5 font-mono text-sky-300">[F]</span>
                <span>Drive {hud.vehicle.nearbyName}</span>
              </div>
            </div>
          )}

          {/* Westgate Bay Vector Minimap (bottom-left) */}
          {hud.isOpenWorld && hud.phase === "ready" && !hud.dead && (() => {
            const minimapData = game.current?.getMinimapData();
            return minimapData ? (
              <WestgateMinimap
                data={minimapData}
                getSample={() => game.current?.getMinimapSample() ?? null}
                paused={hud.paused}
                gpsTargetId={gpsTargetId}
                onChangeGpsTarget={setGpsTargetId}
              />
            ) : null;
          })()}

          {/* right: weapons + ammo + health (or speedometer when driving) */}
          {hud.phase !== "loading" && (
            <div className="pointer-events-none absolute bottom-5 right-5 w-72 space-y-2 text-right">
              {hud.vehicle?.active ? (
                <>
                  <div className="text-[11px] font-bold uppercase tracking-[0.22em] text-sky-300">
                    {hud.vehicle.name}
                  </div>
                  <div className="flex items-baseline justify-end gap-3 font-mono leading-none">
                    <span className="rounded border border-sky-400/40 bg-sky-400/15 px-2 py-0.5 text-sm font-black text-sky-200">
                      G{Math.max(1, hud.vehicle.gear)}
                    </span>
                    <div>
                      <span className="text-6xl font-black tabular-nums text-white drop-shadow-lg">
                        {String(hud.vehicle.speedKmh).padStart(2, "0")}
                      </span>
                      <span className="ml-1.5 text-lg font-bold uppercase text-sky-300">km/h</span>
                    </div>
                  </div>
                  <div className="ml-auto h-1.5 w-48 overflow-hidden rounded-full bg-white/15">
                    <div
                      className="h-full transition-[width] duration-75"
                      style={{
                        width: `${Math.min(100, Math.round((hud.vehicle.rpm / Math.max(1000, hud.vehicle.redline)) * 100))}%`,
                        backgroundColor: hud.vehicle.rpm > hud.vehicle.redline * 0.86 ? "#f43f5e" : "#38bdf8",
                      }}
                    />
                  </div>
                  <div className="font-mono text-[10px] uppercase tracking-wider text-zinc-400">
                    {hud.vehicle.rpm} RPM · W/S Drive · A/D Steer · [C] Cam ({hud.cameraPreset}) · [B] {hud.weatherLabel} · [T] {hud.timeOfDayLabel} · [F] Exit
                  </div>
                </>
              ) : (
                <>
                  {hud.ads && (
                    <div className="ml-auto inline-flex items-center gap-2 rounded border border-amber-400/35 bg-black/70 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.2em] text-amber-300 backdrop-blur">
                      <span>{hud.zoomFactor.toFixed(1)}× ZOOM</span>
                      <span className="text-zinc-400">· Scroll</span>
                    </div>
                  )}
                  <div className="flex justify-end gap-1.5">
                    {hud.weapons.map((w, idx) => {
                      const active = idx === hud.weaponIndex;
                      return (
                        <div
                          key={w.slot}
                          className={`rounded border px-2 py-1 text-left transition ${
                            active
                              ? "border-amber-400/70 bg-amber-400/15 text-white shadow-[0_0_12px_rgba(251,191,36,0.2)]"
                              : "border-white/10 bg-black/55 text-zinc-400"
                          }`}
                        >
                          <div className="flex items-center gap-1 text-[9px] font-bold uppercase tracking-wider">
                            <span className={active ? "text-amber-300" : "text-zinc-500"}>{w.slot}</span>
                            <span>{w.shortName}</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  <div className="flex items-center justify-end gap-2 text-[11px] font-bold uppercase tracking-[0.2em] text-zinc-300">
                    {hud.suppressed && (
                      <span className="rounded border border-emerald-400/40 bg-emerald-400/10 px-1.5 py-0.5 text-[9px] font-bold tracking-widest text-emerald-300">
                        SILENCED
                      </span>
                    )}
                    <span>
                      <span className="text-amber-400">{hud.weaponCategory}</span> · {hud.weaponName}
                    </span>
                  </div>
                  {hud.reloading && (
                    <div className="ml-auto h-1.5 w-48 overflow-hidden rounded bg-white/15">
                      <div className="h-full bg-amber-400" style={{ width: `${hud.reloadProgress * 100}%` }} />
                    </div>
                  )}
                  <div className="font-mono leading-none">
                    <span className={`text-6xl font-black tabular-nums drop-shadow-lg ${hud.ammo <= (hud.weaponIndex === 2 ? 2 : hud.weaponIndex === 3 ? 3 : 8) ? "text-red-400" : "text-white"}`}>
                      {String(hud.ammo).padStart(2, "0")}
                    </span>
                    <span className="ml-1 text-2xl font-bold text-zinc-400">/ {hud.reserve}</span>
                  </div>
                </>
              )}
              <div className="flex items-center justify-end gap-2">
                <span className="text-[10px] font-semibold uppercase tracking-[0.3em] text-zinc-400">HP</span>
                <div className="h-2.5 w-44 overflow-hidden rounded-sm border border-white/15 bg-black/60">
                  <div
                    className={`h-full transition-all duration-200 ${healthPct > 50 ? "bg-emerald-400" : healthPct > 25 ? "bg-amber-400" : "bg-red-500"}`}
                    style={{ width: `${healthPct}%` }}
                  />
                </div>
                <span className="w-9 font-mono text-sm text-zinc-200">{Math.round(hud.health)}</span>
              </div>
            </div>
          )}

          {/* capture hint */}
          {hud.phase === "ready" && !hud.locked && !hud.dead && !hud.paused && (
            <div className="pointer-events-none absolute bottom-6 left-1/2 -translate-x-1/2 rounded-full border border-white/15 bg-black/60 px-4 py-2 text-xs text-zinc-200 backdrop-blur">
              <b className="text-amber-300">Click scene</b> to lock mouse · <b className="text-amber-300">Esc</b> to pause
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
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-6 bg-black/75 backdrop-blur-sm">
              <div className="text-7xl font-black uppercase tracking-[0.3em] text-red-500 drop-shadow-[0_0_25px_rgba(255,0,0,0.5)]">K.I.A.</div>
              <div className="text-sm uppercase tracking-widest text-zinc-400">{hud.mission?.codename} · {hud.mission?.name}</div>
              {endInfo?.reward && (endInfo.reward.credits > 0 || endInfo.reward.intel > 0 || endInfo.reward.salvage > 0) && (
                <div className="flex items-center gap-2 rounded-lg border border-white/10 bg-black/60 px-4 py-2">
                  <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-400">Recovered:</span>
                  <CurrencyBadge kind="credits" amount={endInfo.reward.credits} compact />
                  <CurrencyBadge kind="intel" amount={endInfo.reward.intel} compact />
                  <CurrencyBadge kind="salvage" amount={endInfo.reward.salvage} compact />
                </div>
              )}
              <div className="flex gap-4">
                <button
                  onClick={() => game.current?.respawn()}
                  className="rounded-md border border-white/30 bg-white/10 px-7 py-2.5 text-sm font-bold uppercase tracking-widest backdrop-blur transition hover:bg-white/25"
                >
                  Retry mission
                </button>
                <button
                  onClick={() => exitToScreen("upgrades")}
                  className="rounded-md border border-amber-400/40 bg-amber-400/15 px-7 py-2.5 text-sm font-bold uppercase tracking-widest text-amber-300 backdrop-blur transition hover:bg-amber-400/30"
                >
                  Armory
                </button>
                <button
                  onClick={() => exitToScreen("home")}
                  className="rounded-md border border-white/15 bg-black/50 px-7 py-2.5 text-sm font-bold uppercase tracking-widest text-zinc-300 backdrop-blur transition hover:bg-black/70"
                >
                  Main Menu
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
                {endInfo.reward && (
                  <div className="flex flex-col items-center gap-2 border-b border-white/10 bg-black/40 px-6 py-4">
                    <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.3em] text-zinc-400">
                      <span>Mission Rewards</span>
                      {endInfo.reward.ghostBonus && (
                        <span className="rounded bg-cyan-400/20 px-2 py-0.5 text-cyan-300">Ghost Bonus (0 Alerts)</span>
                      )}
                    </div>
                    <div className="flex flex-wrap justify-center gap-2">
                      <CurrencyBadge kind="credits" amount={endInfo.reward.credits} />
                      <CurrencyBadge kind="intel" amount={endInfo.reward.intel} />
                      <CurrencyBadge kind="salvage" amount={endInfo.reward.salvage} />
                    </div>
                  </div>
                )}
                <div className="max-h-[30vh] space-y-3 overflow-y-auto p-6">
                  {endInfo.mission.debrief.map((line, i) => (
                    <p key={i} className="border-l-2 border-emerald-400/50 pl-3 text-sm leading-relaxed text-zinc-300">{line}</p>
                  ))}
                </div>
                <div className="flex items-center justify-between gap-4 border-t border-white/10 p-5">
                  <button
                    onClick={() => exitToScreen("upgrades")}
                    className="rounded-md border border-amber-400/40 bg-amber-400/15 px-5 py-2.5 text-sm font-bold uppercase tracking-widest text-amber-300 transition hover:bg-amber-400/25"
                  >
                    Armory
                  </button>
                  <div className="flex gap-3">
                    <button
                      onClick={() => exitToScreen("home")}
                      className="rounded-md border border-white/15 px-4 py-2.5 text-sm font-bold uppercase tracking-widest text-zinc-300 transition hover:bg-white/10"
                    >
                      Menu
                    </button>
                    {endInfo.mission.id < MISSIONS.length - 1 && (
                      <button
                        onClick={() => {
                          const next = MISSIONS[endInfo.mission.id + 1];
                          startMission(next);
                        }}
                        className="rounded-md bg-emerald-400 px-6 py-2.5 text-sm font-black uppercase tracking-widest text-black transition hover:bg-emerald-300"
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
          {hud.paused && hud.phase === "ready" && (() => {
            const camCfg = game.current?.getCameraSettings();
            const freeCfg = game.current?.getFreeCameraSettings();
            return (
              <div className="absolute inset-0 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm">
                <div className="max-h-[90vh] w-[32rem] max-w-[95vw] space-y-3 overflow-y-auto rounded-2xl border border-white/15 bg-[#0e1015] p-6 text-center shadow-2xl">
                  <div className="text-xl font-black uppercase tracking-[0.25em] text-white">Paused</div>
                  <div className="text-xs text-zinc-500">
                    {hud.isOpenWorld
                      ? `${hud.district?.name ?? "Westgate Bay"} · Credits: ${hud.credits}`
                      : `${hud.mission?.codename} · ${hud.kills} eliminated · ${hud.stealthKills} stealth`}
                  </div>
                  {hud.isOpenWorld && (
                    <div className="space-y-3 text-left">
                      {/* Time of Day (Afternoon / Sunset / Night / Dawn) */}
                      <div className="rounded-xl border border-indigo-400/20 bg-indigo-950/15 p-3">
                        <div className="mb-2 flex items-center justify-between text-[10px] font-bold uppercase tracking-[0.25em] text-indigo-300">
                          <span>Time of Day [T]</span>
                          <span className="font-mono text-zinc-300">{hud.timeOfDayLabel}</span>
                        </div>
                        <div className="grid grid-cols-4 gap-1.5">
                          {(TIME_OF_DAY_MODES as TimeOfDayMode[]).map((tod) => (
                            <button
                              key={tod}
                              onClick={() => game.current?.setTimeOfDay(tod)}
                              className={`rounded border py-1.5 text-[11px] font-bold uppercase transition ${
                                hud.timeOfDay === tod
                                  ? "border-indigo-400 bg-indigo-400/20 text-indigo-200"
                                  : "border-white/10 bg-white/[0.04] text-zinc-300 hover:bg-white/10"
                              }`}
                            >
                              {TIME_OF_DAY_LABELS[tod]}
                            </button>
                          ))}
                        </div>
                      </div>

                      {/* Weather (Auto / Clear / Rain / Snow) */}
                      <div className="rounded-xl border border-cyan-400/20 bg-cyan-950/15 p-3">
                        <div className="mb-2 flex items-center justify-between text-[10px] font-bold uppercase tracking-[0.25em] text-cyan-300">
                          <span>Weather (Snow &amp; Rain)</span>
                          <span className="font-mono text-zinc-300">{hud.weatherLabel}</span>
                        </div>
                        <div className="grid grid-cols-4 gap-1.5">
                          {(WEATHER_MODES as WeatherMode[]).map((m) => (
                            <button
                              key={m}
                              onClick={() => game.current?.setWeatherMode(m)}
                              className={`rounded border py-1.5 text-[11px] font-bold uppercase transition ${
                                hud.weatherMode === m
                                  ? "border-cyan-400 bg-cyan-400/20 text-cyan-200"
                                  : "border-white/10 bg-white/[0.04] text-zinc-300 hover:bg-white/10"
                              }`}
                            >
                              {m}
                            </button>
                          ))}
                        </div>
                      </div>

                      {/* Overtake Camera Settings */}
                      {camCfg && freeCfg && (
                        <div className="rounded-xl border border-amber-400/20 bg-amber-950/10 p-3 space-y-2.5">
                          <div className="text-[10px] font-bold uppercase tracking-[0.25em] text-amber-300">
                            Vehicle Camera Settings
                          </div>
                          <div className="grid grid-cols-6 gap-1">
                            {(CAMERA_ORDER as CameraPreset[]).map((p) => (
                              <button
                                key={p}
                                onClick={() => {
                                  game.current?.setCameraPreset(p);
                                  setCamTick((t) => t + 1);
                                }}
                                className={`rounded border py-1 text-[10px] font-bold uppercase transition ${
                                  camCfg.preset === p
                                    ? "border-amber-400 bg-amber-400/20 text-amber-200"
                                    : "border-white/10 bg-white/[0.04] text-zinc-400 hover:text-white"
                                }`}
                              >
                                {p}
                              </button>
                            ))}
                          </div>
                          <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-[10px] text-zinc-300">
                            {(
                              [
                                ["Distance", "distance", 1, 14, 0.2, camCfg.distance],
                                ["Height", "height", 0.4, 6, 0.1, camCfg.height],
                                ["FOV", "fov", 45, 95, 1, camCfg.fov],
                                ["Look Ahead", "lookAhead", 3, 40, 1, camCfg.lookAhead],
                              ] as [string, "distance" | "height" | "fov" | "lookAhead", number, number, number, number][]
                            ).map(([label, key, min, max, step, val]) => (
                              <label key={key} className="space-y-0.5">
                                <div className="flex justify-between font-mono">
                                  <span>{label}</span>
                                  <span className="text-amber-300">{val.toFixed(key === "fov" || key === "lookAhead" ? 0 : 1)}</span>
                                </div>
                                <input
                                  type="range"
                                  min={min}
                                  max={max}
                                  step={step}
                                  value={val}
                                  onChange={(e) => {
                                    game.current?.setCameraValue(key, Number(e.target.value));
                                    setCamTick((t) => t + 1);
                                  }}
                                  className="w-full accent-amber-400"
                                />
                              </label>
                            ))}
                          </div>
                          <div className="flex items-center justify-between gap-3 pt-1 text-[10px] text-zinc-300">
                            <label className="flex flex-1 items-center gap-2 font-mono">
                              <span>Free Sens</span>
                              <input
                                type="range"
                                min={0.25}
                                max={3}
                                step={0.1}
                                value={freeCfg.sensitivity}
                                onChange={(e) => {
                                  game.current?.setFreeCameraSettings({ sensitivity: Number(e.target.value) });
                                  setCamTick((t) => t + 1);
                                }}
                                className="w-full accent-amber-400"
                              />
                              <span className="text-amber-300">{freeCfg.sensitivity.toFixed(1)}×</span>
                            </label>
                            <label className="flex items-center gap-1.5 font-mono">
                              <input
                                type="checkbox"
                                checked={freeCfg.autoCenter}
                                onChange={(e) => {
                                  game.current?.setFreeCameraSettings({ autoCenter: e.target.checked });
                                  setCamTick((t) => t + 1);
                                }}
                                className="accent-amber-400"
                              />
                              <span>Auto-Center</span>
                            </label>
                          </div>
                        </div>
                      )}

                      {/* Buy & Summon Cars (Overtake + Range Rover) */}
                      <div className="rounded-xl border border-emerald-400/20 bg-emerald-950/15 p-3">
                        <div className="mb-2 flex items-center justify-between text-[10px] font-bold uppercase tracking-[0.25em] text-emerald-300">
                          <span>Dealership &amp; Summon Car</span>
                          <span className="font-mono text-amber-300">{hud.credits} CR</span>
                        </div>
                        <div className="grid max-h-36 grid-cols-2 gap-1.5 overflow-y-auto pr-1">
                          {CARS.map((car) => {
                            const owned = save.ownedCars.includes(car.id);
                            const canBuy = hud.credits >= car.price;
                            return (
                              <button
                                key={car.id}
                                disabled={!owned && !canBuy}
                                onClick={() => {
                                  if (owned) {
                                    handleSelectCar(car.id);
                                    game.current?.setPaused(false);
                                  } else {
                                    handleBuyCar(car.id);
                                    game.current?.setPaused(false);
                                  }
                                }}
                                className={`flex items-center justify-between rounded border px-2.5 py-1.5 text-left text-[11px] font-semibold transition ${
                                  owned
                                    ? save.selectedCar === car.id
                                      ? "border-emerald-400 bg-emerald-400/20 text-emerald-100"
                                      : "border-white/15 bg-white/[0.05] text-zinc-100 hover:border-emerald-400/50"
                                    : canBuy
                                      ? "border-amber-400/45 bg-amber-400/12 text-amber-200 hover:bg-amber-400/25"
                                      : "cursor-not-allowed border-white/5 bg-white/[0.02] text-zinc-500"
                                }`}
                              >
                                <span className="truncate">{car.name}</span>
                                <span className="ml-1 shrink-0 font-mono text-[9px] uppercase">
                                  {owned ? "Summon" : `${car.price}CR`}
                                </span>
                              </button>
                            );
                          })}
                        </div>
                      </div>

                      {/* Sector Fast-Travel & GPS */}
                      <div className="rounded-xl border border-sky-400/20 bg-sky-950/20 p-3">
                        <div className="mb-2 flex items-center justify-between text-[10px] font-bold uppercase tracking-[0.25em] text-sky-300">
                          <span>Sector Fast-Travel &amp; GPS</span>
                          {gpsTargetId && (
                            <button
                              type="button"
                              onClick={() => setGpsTargetId(null)}
                              className="font-mono text-[9px] text-cyan-300 underline hover:text-white"
                            >
                              Clear GPS
                            </button>
                          )}
                        </div>
                        <div className="grid max-h-32 grid-cols-2 gap-1.5 overflow-y-auto pr-1">
                          {WESTGATE_TELEPORTS.map((spot) => {
                            const isGps = gpsTargetId === spot.id;
                            return (
                              <div key={spot.id} className="flex items-stretch gap-1">
                                <button
                                  onClick={() => {
                                    game.current?.teleportTo(spot.x, spot.z, spot.yawDeg);
                                    game.current?.setPaused(false);
                                  }}
                                  className="min-w-0 flex-1 truncate rounded border border-white/10 bg-white/[0.04] px-2.5 py-1.5 text-left text-[11px] font-semibold text-zinc-200 transition hover:border-sky-400/50 hover:bg-sky-500/15"
                                  title={`Teleport to ${spot.label}`}
                                >
                                  {spot.label}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setGpsTargetId(isGps ? null : spot.id);
                                    game.current?.setPaused(false);
                                  }}
                                  title="Set GPS Route"
                                  className={`shrink-0 rounded border px-1.5 font-mono text-[9px] font-bold uppercase transition ${
                                    isGps
                                      ? "border-cyan-400 bg-cyan-400/25 text-cyan-200"
                                      : "border-white/10 bg-white/[0.04] text-zinc-400 hover:border-cyan-400/50 hover:text-cyan-200"
                                  }`}
                                >
                                  GPS
                                </button>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  )}
                  <button
                    onClick={() => game.current?.setPaused(false)}
                    className="w-full rounded-md bg-amber-400 py-2.5 text-xs font-black uppercase tracking-widest text-black transition hover:bg-amber-300"
                  >
                    Resume
                  </button>
                  <button
                    onClick={() => {
                      game.current?.setPaused(false);
                      game.current?.respawn();
                    }}
                    className="w-full rounded-md border border-white/15 py-2.5 text-xs font-bold uppercase tracking-widest text-zinc-200 transition hover:bg-white/10"
                  >
                    Restart mission
                  </button>
                  <button
                    onClick={() => exitToScreen("garage")}
                    className="w-full rounded-md border border-emerald-400/35 py-2.5 text-xs font-bold uppercase tracking-widest text-emerald-300 transition hover:bg-emerald-400/10"
                  >
                    Car Dealership &amp; Garage
                  </button>
                  <button
                    onClick={() => exitToScreen("upgrades")}
                    className="w-full rounded-md border border-amber-400/30 py-2.5 text-xs font-bold uppercase tracking-widest text-amber-300 transition hover:bg-amber-400/10"
                  >
                    Armory &amp; Upgrades
                  </button>
                  <button
                    onClick={() => exitToScreen("home")}
                    className="w-full rounded-md border border-white/10 py-2.5 text-xs font-bold uppercase tracking-widest text-zinc-400 transition hover:bg-white/10"
                  >
                    Quit to menu
                  </button>
                </div>
              </div>
            );
          })()}
        </>
      )}
    </div>
  );
}

function ObjectiveRow({ o, accent }: { o: ObjectiveState; accent: string }) {
  return (
    <div className="flex items-center gap-2 text-xs">
      <span
        className="flex h-4 w-4 items-center justify-center rounded-sm border text-[10px] font-bold"
        style={{
          borderColor: o.done ? "#34d399" : accent + "88",
          background: o.done ? "rgba(52,211,153,0.2)" : "rgba(0,0,0,0.4)",
          color: o.done ? "#34d399" : "#ccc",
        }}
      >
        {o.done ? "✓" : "·"}
      </span>
      <span className={o.done ? "text-zinc-500 line-through" : "text-zinc-200 drop-shadow"}>{o.label}</span>
      {o.total > 1 && (
        <span className="font-mono text-[10px] text-zinc-400">
          {o.progress}/{o.total}
        </span>
      )}
    </div>
  );
}
