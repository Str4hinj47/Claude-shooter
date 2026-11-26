import { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowUpRight,
  BookOpen,
  Car,
  Check,
  Coins,
  Compass,
  Cpu,
  Crosshair,
  Download,
  Lock,
  RotateCcw,
  Shield,
  Shuffle,
  User,
  Volume2,
  Wrench,
} from "lucide-react";
import {
  getStoryClearedCount,
  isStoryChapterCompleted,
  isStoryChapterUnlocked,
  MISSIONS,
  OPEN_WORLD_MISSION,
  STORYLINE_CHAPTERS,
  type MissionDef,
  type StoryChapterDef,
} from "../game/story";
import { SURVEILLANCE_CONTRACTS } from "../game/city/ContractSurveillance";
import { characterPreview, getSuitPreset, SUIT_PRESETS, type CharacterDef } from "../game/characters";
import { CarPreview3D } from "./CarPreview3D";
import {
  canAfford,
  DEFAULT_APPEARANCE,
  DEFAULT_WEAPON_CONFIGS,
  DIFFICULTY_PROFILES,
  getCarCustomConfig,
  getMissionConsequences,
  getPlayerStats,
  getUpgradeLevel,
  getWeaponCustomConfig,
  getWeaponModEffects,
  previewMissionBaseReward,
  UPGRADES,
  type CurrencyKey,
  type DifficultyMode,
  type SaveData,
  type SoldierAppearance,
  type UpgradeCategory,
  type WeaponCustomConfig,
  type WeaponSlotId,
} from "../game/progression";
import { CARS, PAINT_COLORS, type CarId } from "../game/vehicles/catalog";
import {
  WEAPONS,
  WEAPON_MAG_OPTS,
  WEAPON_MUZZLE_OPTS,
  WEAPON_OPTIC_OPTS,
  WEAPON_PART_FINISHES,
  WEAPON_RETICLE_COLORS,
  WEAPON_UNDERBARREL_OPTS,
} from "../character/rifle";
import { DossierShell, TacticalButton } from "./ui/VectorFrame";

export type Screen = "home" | "missions" | "upgrades" | "customize" | "garage" | "controls" | "playing";

const KEYS: [string, string][] = [
  ["W A S D", "Move"],
  ["MOUSE", "Aim / Look"],
  ["LMB", "Fire (Reveals Holstered)"],
  ["RMB", "Aim Down Sights (Reveals Holstered)"],
  ["SCROLL", "Switch Weapon / Zoom Optic (ADS)"],
  ["TAB (HOLD)", "Weapon Wheel (Move Mouse to Pick)"],
  ["H", "Holster / Draw Weapon"],
  ["1 – 5", "Direct Weapon Slot (1 Pistol · 2–5 Long Guns)"],
  ["F", "Interact / Enter & Exit Vehicle or Boat"],
  ["G", "Carry Body / Stash in Trunk / Dump at Sea / Start Activity"],
  ["M", "Full Tactical Map (Westgate Bay)"],
  ["↑ / P", "Pull Up / Answer SkyPhone"],
  ["CTRL / C", "Toggle Stealth Crouch / Cycle Vehicle Camera"],
  ["B", "Binoculars / Cycle Weather"],
  ["T", "Cycle Time of Day"],
  ["V", "Silent Takedown"],
  ["SHIFT", "Sprint (Loud)"],
  ["SPACE", "Jump"],
  ["R", "Reload"],
  ["Q / E", "Lean Left / Right (On Foot) · Left / Right Blinkers (Driving)"],
  ["O / ~", "Showcase Orbit Camera"],
  ["ESC", "Pause / Sector Dispatch"],
];

const UPGRADE_TABS: { id: UpgradeCategory; label: string }[] = [
  { id: "weapons", label: "Weapons" },
  { id: "armour", label: "Armour" },
  { id: "stealth", label: "Stealth" },
  { id: "precision", label: "Precision" },
];

export function CurrencyInline({
  kind,
  amount,
  compact = false,
}: {
  kind: CurrencyKey;
  amount: number;
  compact?: boolean;
}) {
  const Icon = kind === "credits" ? Coins : kind === "intel" ? Cpu : Wrench;
  const color =
    kind === "credits" ? "text-[#e5a93c]" : kind === "intel" ? "text-[#38bdf8]" : "text-[#fb923c]";
  const label = kind === "credits" ? "CR" : kind === "intel" ? "INT" : "SLV";
  return (
    <span
      className={`inline-flex items-center gap-1.5 font-mono tabular-nums ${
        compact ? "text-[11px]" : "text-xs"
      }`}
    >
      <Icon className={`${compact ? "size-3.5" : "size-4"} ${color}`} />
      <span className="font-bold text-[#f2efe9]">{amount}</span>
      <span className="text-[10px] tracking-widest text-[#8a909e]">{label}</span>
    </span>
  );
}

interface MenuShellProps {
  screen: Exclude<Screen, "playing">;
  setScreen: (s: Exclude<Screen, "playing">) => void;
  save: SaveData;
  selectedMission: MissionDef;
  setSelectedMissionId: (id: number) => void;
  selectedChapter: StoryChapterDef;
  setSelectedChapterNum: (num: number) => void;
  nextMission: MissionDef;
  nextStoryChapter: StoryChapterDef;
  unlockThreshold: number;
  ghostCount: number;
  affordableCount: number;
  characterId: string;
  selectedCharacter: CharacterDef;
  upgradeTab: UpgradeCategory;
  setUpgradeTab: (t: UpgradeCategory) => void;
  customTab: "operator" | "colors" | "gear";
  setCustomTab: (t: "operator" | "colors" | "gear") => void;
  onStartMission: (m: MissionDef) => void;
  onStartStoryChapter: (ch: StoryChapterDef) => void;
  onSelectCharacter: (id: string) => void;
  onBuyUpgrade: (id: string) => void;
  onSelectWeapon: (idx: number) => void;
  onUpdateWeaponConfig: (weaponId: WeaponSlotId, patch: Partial<WeaponCustomConfig>) => void;
  onResetWeaponConfig: (weaponId: WeaponSlotId) => void;
  onFocusWeaponBench: (focus: boolean) => void;
  onUpdateAppearance: (patch: Partial<SoldierAppearance>) => void;
  onRandomizeAppearance: () => void;
  onSetDifficulty: (mode: DifficultyMode) => void;
  onBuyCar: (carId: CarId) => void;
  onSelectCar: (carId: CarId, paintHex?: string | null) => void;
  onDownloadGlb: () => void;
  onResetSave: () => void;
  onMarkPrologueSeen: () => void;
  onOpenEvidenceWall: () => void;
}

export function MenuShell({
  screen,
  setScreen,
  save,
  selectedMission,
  setSelectedMissionId,
  selectedChapter,
  setSelectedChapterNum,
  nextMission: _nextMission,
  nextStoryChapter,
  unlockThreshold: _unlockThreshold,
  ghostCount,
  affordableCount,
  characterId: _characterId,
  selectedCharacter,
  upgradeTab,
  setUpgradeTab,
  customTab: _customTab,
  setCustomTab: _setCustomTab,
  onStartMission,
  onStartStoryChapter,
  onSelectCharacter: _onSelectCharacter,
  onBuyUpgrade,
  onSelectWeapon,
  onUpdateWeaponConfig,
  onResetWeaponConfig,
  onFocusWeaponBench,
  onUpdateAppearance,
  onRandomizeAppearance,
  onSetDifficulty,
  onBuyCar,
  onSelectCar,
  onDownloadGlb,
  onResetSave,
  onMarkPrologueSeen,
  onOpenEvidenceWall,
}: MenuShellProps) {
  const prologueAudioRef = useRef<HTMLAudioElement | null>(null);
  const [prologuePlaying, setProloguePlaying] = useState(false);
  const [replayingPrologue, setReplayingPrologue] = useState(false);
  const showPrologue = !save.prologueSeen || replayingPrologue;

  useEffect(() => {
    if (!showPrologue) {
      if (prologueAudioRef.current) {
        prologueAudioRef.current.pause();
        prologueAudioRef.current = null;
      }
      return;
    }
    const audio = new Audio("/audio/story/voss_prologue.mp3");
    audio.volume = 0.88;
    audio.onplay = () => setProloguePlaying(true);
    audio.onended = () => setProloguePlaying(false);
    audio.onpause = () => setProloguePlaying(false);
    prologueAudioRef.current = audio;
    void audio.play().catch(() => {
      // Browser autoplay may require a click — handled by the "Play Briefing" button
    });
    return () => {
      audio.pause();
      if (prologueAudioRef.current === audio) prologueAudioRef.current = null;
    };
  }, [showPrologue]);

  const dismissPrologue = () => {
    if (prologueAudioRef.current) {
      prologueAudioRef.current.pause();
      prologueAudioRef.current = null;
    }
    setReplayingPrologue(false);
    if (!save.prologueSeen) onMarkPrologueSeen();
  };

  const replayPrologueAudio = () => {
    const audio = prologueAudioRef.current ?? new Audio("/audio/story/voss_prologue.mp3");
    audio.volume = 0.88;
    audio.currentTime = 0;
    audio.onplay = () => setProloguePlaying(true);
    audio.onended = () => setProloguePlaying(false);
    audio.onpause = () => setProloguePlaying(false);
    prologueAudioRef.current = audio;
    void audio.play().catch(() => {});
  };

  const storyClearedCount = getStoryClearedCount(save);
  const totalStoryChapters = STORYLINE_CHAPTERS.filter((c) => c.chapter > 0).length;
  const activeSurvContract =
    selectedChapter.kind === "surveillance" && selectedChapter.surveillanceId
      ? SURVEILLANCE_CONTRACTS.find((c) => c.id === selectedChapter.surveillanceId)
      : undefined;
  const activeMissionDef =
    selectedChapter.kind === "mission" && selectedChapter.missionId !== undefined
      ? MISSIONS.find((m) => m.id === selectedChapter.missionId) ?? selectedMission
      : selectedMission;
  const stats = getPlayerStats(save);
  const [garageCarId, setGarageCarId] = useState<CarId>(save.selectedCar);
  const [armoryMode, setArmoryMode] = useState<"bench" | "upgrades">("bench");
  const featuredCar = CARS.find((c) => c.id === garageCarId) ?? CARS[0];
  const featuredOwned = save.ownedCars.includes(featuredCar.id);
  const featuredActive = save.selectedCar === featuredCar.id;
  const featuredPaint = save.carPaints[featuredCar.id] ?? featuredCar.color;
  const featuredCustom = getCarCustomConfig(save, featuredCar.id);
  const activeWeaponSpec = WEAPONS[save.selectedWeapon] ?? WEAPONS[0];
  const activeWeaponCfg = getWeaponCustomConfig(save, activeWeaponSpec.id);
  const activeSuit = getSuitPreset(save.appearance.suitPreset);
  const activeWeaponMods = getWeaponModEffects(activeWeaponCfg);

  const navItems: {
    id: Exclude<Screen, "playing">;
    num: string;
    label: string;
    badge?: string;
    icon: React.ComponentType<{ className?: string }>;
  }[] = [
    { id: "home", num: "00", label: "Overview", icon: Compass },
    { id: "missions", num: "01", label: "Contracts", icon: Crosshair },
    {
      id: "upgrades",
      num: "02",
      label: "Armory",
      badge: affordableCount > 0 ? `${affordableCount}` : undefined,
      icon: Shield,
    },
    { id: "customize", num: "03", label: "Wardrobe", badge: `${SUIT_PRESETS.length}`, icon: User },
    { id: "garage", num: "04", label: "Motorpool", badge: `${save.ownedCars.length}`, icon: Car },
    { id: "controls", num: "05", label: "Manual", icon: BookOpen },
  ];

  const isHeavyBackdrop = screen === "missions" || screen === "controls" || screen === "garage";

  return (
    <div className="pointer-events-none absolute inset-0 flex flex-col">
      {/* Architectural backdrop vignette & blueprint grid */}
      <div
        className={`absolute inset-0 -z-0 transition-all duration-300 ${
          isHeavyBackdrop
            ? "voss-grid-bg bg-[#07080b]/90 backdrop-blur-sm"
            : "bg-[linear-gradient(100deg,rgba(7,8,11,0.94)_0%,rgba(7,8,11,0.72)_42%,rgba(7,8,11,0.12)_76%,rgba(7,8,11,0.35)_100%)]"
        }`}
      />
      {/* Subtle right-side spotlight stage framing */}
      {!isHeavyBackdrop && (
        <div className="pointer-events-none absolute inset-y-8 right-8 hidden w-[42%] border-r border-t border-white/[0.06] lg:block">
          <div className="absolute right-0 top-0 h-3 w-3 border-r-2 border-t-2 border-[#ff3b30]/70" />
          <div className="absolute bottom-0 right-0 h-3 w-3 border-b-2 border-r-2 border-white/25" />
        </div>
      )}

      {/* ================= PERSISTENT TOP COMMAND STRIP ================= */}
      <header className="pointer-events-auto relative z-20 flex items-center justify-between gap-2 border-b border-white/10 bg-[#07080b]/88 px-4 py-2.5 backdrop-blur-md lg:px-6">
        <div className="flex shrink-0 items-center gap-2.5">
          {screen !== "home" && (
            <button
              onClick={() => setScreen("home")}
              className="inline-flex cursor-pointer items-center gap-1 border border-white/15 bg-white/[0.04] px-2 py-1 font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-[#f2efe9] transition hover:border-[#ff3b30] hover:text-[#ff3b30]"
            >
              <ArrowLeft className="size-3" />
              Back
            </button>
          )}
          <button
            onClick={() => setScreen("home")}
            className="flex cursor-pointer items-center gap-2 text-left"
          >
            <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center bg-[#ff3b30] font-display text-base font-extrabold tracking-tight text-[#07080b]">
              V
            </span>
            <div>
              <div className="font-display text-base font-extrabold uppercase leading-none tracking-[0.1em] text-[#f2efe9] xl:text-lg">
                VOSS <span className="text-[#ff3b30]">//</span> BLACK CONTRACT
              </div>
              <div className="hidden font-mono text-[8px] uppercase tracking-[0.22em] text-[#8a909e] xl:block">
                Sector 04 · Westgate Cell
              </div>
            </div>
          </button>
        </div>

        {/* Horizontal AAA Top Tab Navigation */}
        <nav className="hidden min-w-0 flex-1 items-center justify-center gap-0.5 overflow-x-auto lg:flex">
          {navItems.map((item) => {
            const active = screen === item.id;
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                onClick={() => setScreen(item.id)}
                className={`relative flex shrink-0 cursor-pointer items-center gap-1.5 px-2 py-1.5 font-mono text-[10px] font-bold uppercase tracking-[0.11em] transition xl:px-2.5 ${
                  active
                    ? "text-[#f2efe9]"
                    : "text-[#8a909e] hover:text-[#f2efe9]"
                }`}
              >
                <span className="hidden text-[9px] text-[#ff3b30] 2xl:inline">{item.num}</span>
                <Icon className="size-3" />
                <span>{item.label}</span>
                {item.badge && (
                  <span className="bg-white/10 px-1 py-0.5 text-[8px] text-[#e5a93c]">
                    {item.badge}
                  </span>
                )}
                {active && (
                  <span className="absolute inset-x-1.5 -bottom-[11px] h-[2px] bg-[#ff3b30]" />
                )}
              </button>
            );
          })}
        </nav>

        {/* Inline Ledger */}
        <div className="flex shrink-0 items-center divide-x divide-white/10 border border-white/10 bg-[#0d0f15] px-2 py-1">
          <div className="pr-2">
            <CurrencyInline kind="credits" amount={save.currencies.credits} compact />
          </div>
          <div className="px-2">
            <CurrencyInline kind="intel" amount={save.currencies.intel} compact />
          </div>
          <div className="pl-2">
            <CurrencyInline kind="salvage" amount={save.currencies.salvage} compact />
          </div>
        </div>
      </header>

      {/* Secondary compact nav bar for <lg viewports */}
      <nav className="pointer-events-auto relative z-20 flex items-center gap-1 overflow-x-auto border-b border-white/10 bg-[#090a0f]/90 px-5 py-1.5 lg:hidden">
        {navItems.map((item) => {
          const active = screen === item.id;
          return (
            <button
              key={item.id}
              onClick={() => setScreen(item.id)}
              className={`shrink-0 cursor-pointer px-3 py-1 font-mono text-[10px] font-bold uppercase tracking-[0.18em] transition ${
                active
                  ? "border-b-2 border-[#ff3b30] text-[#f2efe9]"
                  : "text-[#8a909e] hover:text-[#f2efe9]"
              }`}
            >
              <span className="mr-1 text-[#ff3b30]">{item.num}</span>
              {item.label}
            </button>
          );
        })}
      </nav>

      {/* ================= SCREEN: HOME (ASYMMETRIC EDITORIAL TERMINAL) ================= */}
      {screen === "home" && (
        <div className="relative z-10 flex flex-1 flex-col justify-between px-6 py-6 lg:px-12 lg:py-8">
          <div className="flex flex-1 items-center justify-between gap-8">
            <div className="pointer-events-auto flex w-full max-w-[540px] flex-col gap-6">
              {/* Editorial Masthead */}
              <div>
                <div className="flex items-center gap-3 font-mono text-[10px] font-bold uppercase tracking-[0.32em] text-[#ff3b30]">
                  <span className="h-[1px] w-7 bg-[#ff3b30]" />
                  <span>COVERT DIRECTIVE · {storyClearedCount}/{totalStoryChapters} CHAPTERS CLEARED · {ghostCount} GHOST</span>
                </div>
                <h1 className="mt-2 font-display text-6xl font-extrabold uppercase leading-[0.88] tracking-[0.04em] text-[#f2efe9] sm:text-7xl">
                  BLACK<br />
                  <span className="text-[#ff3b30]">CONTRACT</span>
                </h1>
                <p className="mt-3 max-w-md text-xs leading-relaxed text-[#a0a6b3]">
                  Infiltrate secured compounds, scrub black-site servers, recover stolen ledgers, or roam the 2.4 km Westgate Bay grid undetected.
                </p>
              </div>

              {/* Primary Asymmetric 2-Card Action Grid */}
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-12">
                <button
                  onClick={() => {
                    setSelectedChapterNum(nextStoryChapter.chapter);
                    if (nextStoryChapter.missionId !== undefined) {
                      setSelectedMissionId(nextStoryChapter.missionId);
                    }
                    setScreen("missions");
                  }}
                  data-augmented-ui="tl-clip br-clip border inlay"
                  className="voss-panel-signal group flex cursor-pointer flex-col justify-between p-4 text-left transition hover:brightness-125 sm:col-span-7"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-[10px] font-bold uppercase tracking-[0.22em] text-[#ff3b30]">
                      NEXT · CH {nextStoryChapter.code}
                      {nextStoryChapter.kind === "surveillance" ? " // SURV & TAKEDOWN" : ""}
                    </span>
                    <span className="inline-flex items-center gap-1 bg-[#ff3b30] px-1.5 py-0.5 font-mono text-[9px] font-black uppercase tracking-wider text-[#07080b]">
                      BRIEFING
                      <ArrowUpRight className="size-3 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
                    </span>
                  </div>
                  <div className="mt-3">
                    <div className="font-display text-3xl font-extrabold uppercase leading-none tracking-wide text-[#f2efe9]">
                      {nextStoryChapter.codename}
                    </div>
                    <div className="mt-1 font-mono text-[10px] uppercase tracking-wider text-[#9ea4b0]">
                      {nextStoryChapter.title} · {nextStoryChapter.location}
                    </div>
                  </div>
                </button>

                <button
                  onClick={() => onStartMission(OPEN_WORLD_MISSION)}
                  data-augmented-ui="tr-clip bl-clip border inlay"
                  className="voss-panel-sharp group flex cursor-pointer flex-col justify-between p-4 text-left transition hover:border-[#38bdf8] sm:col-span-5"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-[10px] font-bold uppercase tracking-[0.22em] text-[#38bdf8]">
                      OPEN WORLD
                    </span>
                    <Compass className="size-4 text-[#38bdf8]" />
                  </div>
                  <div className="mt-3">
                    <div className="font-display text-2xl font-extrabold uppercase leading-none tracking-wide text-[#f2efe9]">
                      WESTGATE BAY
                    </div>
                    <div className="mt-1 font-mono text-[10px] uppercase tracking-wider text-[#8a909e]">
                      Free Roam · 9 Cars
                    </div>
                  </div>
                </button>
              </div>

              {/* Crisp Quick-Access Architectural Rail */}
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <button
                  onClick={() => setScreen("customize")}
                  className="flex cursor-pointer items-center gap-2.5 border border-white/12 bg-[#0d1016]/85 p-2.5 text-left transition hover:border-[#ff3b30]/70"
                >
                  <img
                    src={characterPreview("business")}
                    alt="Julian Voss"
                    className="h-9 w-9 shrink-0 border border-white/15 object-cover object-top"
                  />
                  <div className="min-w-0">
                    <div className="font-mono text-[9px] uppercase tracking-[0.18em] text-[#8a909e]">WARDROBE</div>
                    <div className="truncate font-display text-sm font-bold uppercase tracking-wide text-[#f2efe9]">
                      {activeSuit.name}
                    </div>
                  </div>
                </button>

                <button
                  onClick={() => setScreen("upgrades")}
                  className="flex cursor-pointer flex-col justify-center border border-white/12 bg-[#0d1016]/85 p-2.5 text-left transition hover:border-[#e5a93c]/70"
                >
                  <div className="flex items-center justify-between font-mono text-[9px] uppercase tracking-[0.18em] text-[#8a909e]">
                    <span>ARMORY</span>
                    {affordableCount > 0 && (
                      <span className="text-[#2dd4bf]">{affordableCount} RDY</span>
                    )}
                  </div>
                  <div className="truncate font-display text-sm font-bold uppercase tracking-wide text-[#e5a93c]">
                    {WEAPONS[save.selectedWeapon]?.shortName ?? "M4A1-S"}
                  </div>
                </button>

                <button
                  onClick={() => setScreen("garage")}
                  className="flex cursor-pointer flex-col justify-center border border-white/12 bg-[#0d1016]/85 p-2.5 text-left transition hover:border-[#38bdf8]/70"
                >
                  <div className="font-mono text-[9px] uppercase tracking-[0.18em] text-[#8a909e]">MOTORPOOL</div>
                  <div className="truncate font-display text-sm font-bold uppercase tracking-wide text-[#38bdf8]">
                    {CARS.find((c) => c.id === save.selectedCar)?.name ?? "Golf"}
                  </div>
                </button>

                <button
                  onClick={() => onStartMission(MISSIONS[0])}
                  className="flex cursor-pointer flex-col justify-center border border-white/12 bg-[#0d1016]/85 p-2.5 text-left transition hover:border-white/45"
                >
                  <div className="font-mono text-[9px] uppercase tracking-[0.18em] text-[#8a909e]">RANGE</div>
                  <div className="truncate font-display text-sm font-bold uppercase tracking-wide text-[#f2efe9]">
                    Calibration
                  </div>
                </button>
              </div>

              {/* Operative Readiness Telemetry Strip */}
              <div className="flex flex-wrap items-center gap-x-6 gap-y-2 border-t border-white/10 pt-3 font-mono text-[11px]">
                <div>
                  <span className="text-[#8a909e]">ARMOUR </span>
                  <span className="font-bold text-[#2dd4bf]">{stats.maxHp} HP</span>
                </div>
                <div>
                  <span className="text-[#8a909e]">STEP NOISE </span>
                  <span className="font-bold text-[#38bdf8]">{Math.round(stats.footstepNoiseMult * 100)}%</span>
                </div>
                <div>
                  <span className="text-[#8a909e]">SUPPRESSED </span>
                  <span className="font-bold text-[#e5a93c]">2.5× AMBUSH</span>
                </div>
                <button
                  onClick={() => setScreen("controls")}
                  className="ml-auto cursor-pointer text-[10px] uppercase tracking-[0.2em] text-[#8a909e] underline underline-offset-4 hover:text-[#f2efe9]"
                >
                  Field Manual
                </button>
              </div>
            </div>

            {/* Right-side 3D Operator Stage Telemetry */}
            <div className="pointer-events-none hidden self-end pb-2 text-right lg:block">
              <div className="font-mono text-[9px] uppercase tracking-[0.32em] text-[#ff3b30]">
                LIVE OPERATIVE FEED // DRAG TO ORBIT
              </div>
              <div className="mt-1 font-display text-2xl font-extrabold uppercase tracking-wider text-[#f2efe9]/90">
                Julian Voss · {activeSuit.name}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ================= SCREEN: MISSIONS / STORYLINE CAMPAIGN ================= */}
      {screen === "missions" && (
        <div className="pointer-events-auto relative z-10 mx-auto grid w-full max-w-6xl flex-1 grid-cols-1 gap-5 overflow-y-auto px-6 py-4 lg:grid-cols-12 lg:px-10">
          {/* Left: Chronological Storyline Roster (00–09) */}
          <div className="space-y-1.5 lg:col-span-5">
            <div className="mb-2 flex items-center justify-between font-mono text-[10px] font-bold uppercase tracking-[0.26em] text-[#8a909e]">
              <span>SOVEREIGN LEDGER</span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={onOpenEvidenceWall}
                  className="inline-flex cursor-pointer items-center gap-1 border border-rose-500/35 bg-rose-500/10 px-2 py-0.5 text-[9px] text-rose-200 transition hover:border-rose-400 hover:bg-rose-500/20"
                >
                  <Crosshair className="size-3 text-rose-400" /> Evidence Wall
                </button>
                <button
                  type="button"
                  onClick={() => setReplayingPrologue(true)}
                  className="inline-flex cursor-pointer items-center gap-1 border border-white/15 bg-white/[0.04] px-2 py-0.5 text-[9px] text-[#cbd5e1] transition hover:border-[#ff3b30]/60 hover:text-white"
                >
                  <Volume2 className="size-3 text-[#ff3b30]" /> Cold Open
                </button>
                <span>{storyClearedCount}/{totalStoryChapters}</span>
              </div>
            </div>
            {STORYLINE_CHAPTERS.map((ch, idx) => {
              const prevAct = idx > 0 ? STORYLINE_CHAPTERS[idx - 1].act : null;
              const showActHeader = ch.act !== prevAct;
              const locked = !isStoryChapterUnlocked(ch, save);
              const active = selectedChapter.chapter === ch.chapter;
              const isSurv = ch.kind === "surveillance" && ch.surveillanceId;
              const missionRec = ch.missionId !== undefined ? save.records[ch.missionId] : undefined;
              const survRec = isSurv && ch.surveillanceId ? save.surveillanceRecords?.[ch.surveillanceId] : undefined;
              const completed = isStoryChapterCompleted(ch, save);
              const ghost = Boolean(missionRec?.ghost || survRec?.unseen);
              return (
                <div key={ch.chapter} className="space-y-1">
                  {showActHeader && (
                    <div className="pt-1.5 font-mono text-[9px] font-bold uppercase tracking-[0.28em] text-[#ff3b30]/85">
                      {ch.act}
                    </div>
                  )}
                  <button
                    disabled={locked}
                    onClick={() => {
                      setSelectedChapterNum(ch.chapter);
                      if (ch.missionId !== undefined) setSelectedMissionId(ch.missionId);
                    }}
                    className={`relative flex w-full cursor-pointer items-center justify-between border px-4 py-2 text-left transition disabled:cursor-not-allowed disabled:opacity-35 ${
                      active
                        ? "border-white/30 bg-white/[0.08]"
                        : "border-white/10 bg-[#0c0e14]/80 hover:border-white/25 hover:bg-white/[0.04]"
                    }`}
                  >
                    <div
                      className="absolute inset-y-0 left-0 w-1"
                      style={{ background: locked ? "#333" : active ? ch.accent : "transparent" }}
                    />
                    <div className="flex items-center gap-3 pl-1">
                      <span className="font-mono text-xs font-bold text-[#8a909e]">{ch.code}</span>
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-display text-base font-extrabold uppercase leading-none tracking-wide text-[#f2efe9]">
                            {ch.codename}
                          </span>
                          {isSurv && (
                            <span className="border border-[#f59e0b]/45 bg-[#f59e0b]/15 px-1 py-0.5 font-mono text-[8px] font-bold uppercase tracking-wider text-[#f59e0b]">
                              SURV · TAKEDOWN
                            </span>
                          )}
                        </div>
                        <div className="mt-1 font-mono text-[10px] uppercase tracking-wider text-[#8a909e]">
                          {ch.title}
                        </div>
                      </div>
                    </div>
                    <div className="flex flex-col items-end gap-1 font-mono text-[9px] uppercase tracking-widest">
                      <span className="text-[#8a909e]">{ch.timeOfDay}</span>
                      {locked ? (
                        <span className="inline-flex items-center gap-1 text-[#8a909e]">
                          <Lock className="size-3" /> LOCKED
                        </span>
                      ) : ghost ? (
                        <span className="border border-[#38bdf8]/50 bg-[#38bdf8]/15 px-1.5 py-0.5 text-[#38bdf8]">
                          GHOST
                        </span>
                      ) : completed ? (
                        <span className="border border-[#2dd4bf]/50 bg-[#2dd4bf]/15 px-1.5 py-0.5 text-[#2dd4bf]">
                          CLEARED
                        </span>
                      ) : null}
                    </div>
                  </button>
                </div>
              );
            })}
          </div>

          {/* Right: Chamfered Dossier Sheet */}
          <div className="lg:col-span-7">
            {activeSurvContract ? (
              <DossierShell tone="signal" className="flex h-full flex-col justify-between">
                <div className="space-y-3.5">
                  <div className="flex flex-wrap items-start justify-between gap-4 border-b border-white/10 pb-3">
                    <div>
                      <div
                        className="font-mono text-[10px] font-bold uppercase tracking-[0.3em]"
                        style={{ color: selectedChapter.accent }}
                      >
                        {selectedChapter.act} · CH {selectedChapter.code} // SURVEILLANCE &amp; TAKEDOWN ({activeSurvContract.code})
                      </div>
                      <h2 className="mt-1 font-display text-4xl font-extrabold uppercase leading-none tracking-wide text-[#f2efe9]">
                        {activeSurvContract.targetName}
                      </h2>
                    </div>
                    <div className="text-right font-mono text-[10px] uppercase tracking-wider text-[#8a909e]">
                      <div>ROLE: <span className="text-[#e5a93c]">{activeSurvContract.targetRoleTitle}</span></div>
                      <div>VEHICLE: <span className="text-[#f2efe9]">{activeSurvContract.vehicle.label}</span></div>
                    </div>
                  </div>

                  <div className="grid grid-cols-3 gap-2 border-b border-white/10 pb-4 font-mono text-[10px] uppercase">
                    <div>
                      <div className="text-[#8a909e]">RESIDENCE</div>
                      <div className="mt-0.5 font-bold text-[#f2efe9]">{activeSurvContract.residence.address}</div>
                    </div>
                    <div>
                      <div className="text-[#8a909e]">WORKPLACE</div>
                      <div className="mt-0.5 font-bold text-[#f2efe9]">{activeSurvContract.workplace.name}</div>
                    </div>
                    <div>
                      <div className="text-[#8a909e]">OPERATIVE</div>
                      <div className="mt-0.5 font-bold text-[#38bdf8]">{selectedCharacter.name}</div>
                    </div>
                  </div>

                  <div className="space-y-2.5">
                    <p
                      className="border-l-2 pl-3.5 text-sm leading-relaxed text-[#cfd4de]"
                      style={{ borderColor: selectedChapter.accent }}
                    >
                      {activeSurvContract.briefing}
                    </p>
                    <p className="border-l-2 border-white/20 pl-3.5 text-xs leading-relaxed text-[#9ea4b0]">
                      {selectedChapter.tacticalFocus}
                    </p>
                  </div>

                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <div className="border border-white/10 bg-black/35 p-4">
                      <div className="mb-2.5 font-mono text-[10px] font-bold uppercase tracking-[0.26em] text-[#8a909e]">
                        EXECUTION PROTOCOL
                      </div>
                      <ul className="space-y-2 text-xs text-[#f2efe9]">
                        <li className="flex items-center gap-2">
                          <span className="h-1.5 w-1.5 bg-[#f59e0b]" />
                          <span>Tail {activeSurvContract.targetName} across {activeSurvContract.schedule.length} daily schedule phases</span>
                        </li>
                        <li className="flex items-center gap-2">
                          <span className="h-1.5 w-1.5 bg-[#f59e0b]" />
                          <span>Strike unseen in an isolated window ([F] Takedown, suppressed shot, or sabotage)</span>
                        </li>
                        <li className="flex items-center gap-2">
                          <span className="h-1.5 w-1.5 bg-[#38bdf8]" />
                          <span>Carry body [G], load trunk or boat [F], and dump in deep Pacific Ocean</span>
                        </li>
                      </ul>
                    </div>

                    <div className="border border-white/10 bg-black/35 p-4 space-y-2.5">
                      <div className="font-mono text-[10px] font-bold uppercase tracking-[0.26em] text-[#8a909e]">
                        CONTRACT PAYOUT &amp; BONUSES
                      </div>
                      <div className="space-y-1.5 font-mono text-xs">
                        <div className="flex justify-between text-[#f2efe9]">
                          <span>BASE CONTRACT</span>
                          <span className="font-bold text-[#e5a93c]">+{activeSurvContract.rewardBase} CR</span>
                        </div>
                        <div className="flex justify-between text-[#38bdf8]">
                          <span>UNSEEN / ACCIDENT BONUS</span>
                          <span className="font-bold">+{activeSurvContract.unseenBonus} CR</span>
                        </div>
                        <div className="flex justify-between text-[#2dd4bf]">
                          <span>DEEP OCEAN DISPOSAL</span>
                          <span className="font-bold">+{activeSurvContract.deepSeaBonus} CR</span>
                        </div>
                      </div>
                      <div className="border-t border-white/10 pt-2 font-mono text-[10px] text-[#8a909e]">
                        ISOLATED STRIKE WINDOWS: {activeSurvContract.schedule.filter((s) => s.isolatedWindow).length} PER CYCLE
                      </div>
                    </div>
                  </div>
                </div>

                <div className="mt-4 flex items-center justify-end gap-4 border-t border-white/10 pt-3.5">
                  <TacticalButton tone="signal" onClick={() => onStartStoryChapter(selectedChapter)}>
                    Deploy Surveillance Hit
                    <ArrowUpRight className="size-4" />
                  </TacticalButton>
                </div>
              </DossierShell>
            ) : (
              <DossierShell tone="signal" className="flex h-full flex-col justify-between">
                <div className="space-y-3.5">
                  <div className="flex flex-wrap items-start justify-between gap-4 border-b border-white/10 pb-3">
                    <div>
                      <div
                        className="font-mono text-[10px] font-bold uppercase tracking-[0.3em]"
                        style={{ color: activeMissionDef.accent }}
                      >
                        {activeMissionDef.id === 0
                          ? "PROLOGUE · SAFEHOUSE RANGE"
                          : `${selectedChapter.act} · CH ${selectedChapter.code} // ${activeMissionDef.codename}`}
                      </div>
                      <h2 className="mt-1 font-display text-4xl font-extrabold uppercase leading-none tracking-wide text-[#f2efe9]">
                        {activeMissionDef.name}
                      </h2>
                    </div>
                    <div className="text-right font-mono text-[10px] uppercase tracking-wider text-[#8a909e]">
                      <div>CLIENT: <span className="text-[#e5a93c]">{activeMissionDef.client}</span></div>
                      <div>HOSTILES: <span className="text-[#f2efe9]">{activeMissionDef.enemies.length} · {activeMissionDef.tintName}</span></div>
                    </div>
                  </div>

                  <div className="grid grid-cols-3 gap-2 border-b border-white/10 pb-4 font-mono text-[10px] uppercase">
                    <div>
                      <div className="text-[#8a909e]">SECTOR</div>
                      <div className="mt-0.5 font-bold text-[#f2efe9]">{activeMissionDef.location}</div>
                    </div>
                    <div>
                      <div className="text-[#8a909e]">WINDOW</div>
                      <div className="mt-0.5 font-bold text-[#f2efe9]">{activeMissionDef.timeOfDay}</div>
                    </div>
                    <div>
                      <div className="text-[#8a909e]">OPERATIVE</div>
                      <div className="mt-0.5 font-bold text-[#38bdf8]">{selectedCharacter.name}</div>
                    </div>
                  </div>

                  <div className="space-y-2.5">
                    {activeMissionDef.briefing.map((line, i) => (
                      <p
                        key={i}
                        className="border-l-2 pl-3.5 text-sm leading-relaxed text-[#cfd4de]"
                        style={{ borderColor: activeMissionDef.accent }}
                      >
                        {line}
                      </p>
                    ))}
                  </div>

                  {(() => {
                    const c = getMissionConsequences(save, activeMissionDef.id);
                    if (!c.bannerTitle) return null;
                    return (
                      <div
                        className={`border px-3.5 py-2.5 font-mono text-[11px] ${
                          c.bannerTone === "advantage"
                            ? "border-[#2dd4bf]/40 bg-[#2dd4bf]/10 text-[#2dd4bf]"
                            : "border-[#f59e0b]/45 bg-[#f59e0b]/10 text-[#fbbf24]"
                        }`}
                      >
                        <div className="font-bold uppercase tracking-wider">{c.bannerTitle}</div>
                        <div className="mt-0.5 text-[#cfd4de]">{c.bannerText}</div>
                      </div>
                    );
                  })()}

                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <div className="border border-white/10 bg-black/35 p-4">
                      <div className="mb-2.5 font-mono text-[10px] font-bold uppercase tracking-[0.26em] text-[#8a909e]">
                        PRIMARY OBJECTIVES
                      </div>
                      <ul className="space-y-2">
                        {activeMissionDef.objectives.map((o) => (
                          <li key={o.id} className="flex items-center gap-2 text-xs text-[#f2efe9]">
                            <span className="h-1.5 w-1.5 bg-[#ff3b30]" />
                            <span>{o.label}</span>
                            {o.count !== undefined && (
                              <span className="ml-auto font-mono text-[10px] text-[#8a909e]">×{o.count}</span>
                            )}
                          </li>
                        ))}
                      </ul>
                    </div>

                    <div className="border border-white/10 bg-black/35 p-4 space-y-3">
                      <div className="font-mono text-[10px] font-bold uppercase tracking-[0.26em] text-[#8a909e]">
                        THREAT TIER &amp; CONTRACT PAYOUT
                      </div>
                      <div className="grid grid-cols-3 gap-1.5">
                        {(["operative", "veteran", "shadow"] as DifficultyMode[]).map((mode) => {
                          const prof = DIFFICULTY_PROFILES[mode];
                          const active = (save.difficulty ?? "operative") === mode;
                          return (
                            <button
                              key={mode}
                              type="button"
                              onClick={() => onSetDifficulty(mode)}
                              title={prof.subtitle}
                              className={`cursor-pointer border px-2 py-1.5 text-left transition ${
                                active
                                  ? mode === "shadow"
                                    ? "border-[#ff3b30] bg-[#ff3b30]/18 text-[#f2efe9]"
                                    : mode === "veteran"
                                      ? "border-[#e5a93c] bg-[#e5a93c]/18 text-[#f2efe9]"
                                      : "border-[#2dd4bf] bg-[#2dd4bf]/15 text-[#f2efe9]"
                                  : "border-white/10 bg-black/40 text-[#8a909e] hover:text-[#f2efe9]"
                              }`}
                            >
                              <div className="font-mono text-[10px] font-bold uppercase tracking-wider">
                                {prof.label}
                              </div>
                              <div className="font-mono text-[9px] opacity-80">{prof.rewardMult.toFixed(2).replace(/\.00$/, ".0")}× Cr</div>
                            </button>
                          );
                        })}
                      </div>
                      {(() => {
                        const diffMode: DifficultyMode = save.difficulty ?? "operative";
                        const r = previewMissionBaseReward(activeMissionDef.id, diffMode);
                        return (
                          <div className="space-y-2.5">
                            <div className="flex flex-wrap gap-4">
                              <CurrencyInline kind="credits" amount={r.credits} compact />
                              <CurrencyInline kind="intel" amount={r.intel} compact />
                              <CurrencyInline kind="salvage" amount={r.salvage} compact />
                            </div>
                            {activeMissionDef.id > 0 && (
                              <div className="border-t border-white/10 pt-2 font-mono text-[10px] text-[#38bdf8]">
                                GHOST BONUS (0 ALERTS): +120 CR · +35 INT · +20 SLV
                              </div>
                            )}
                          </div>
                        );
                      })()}
                    </div>
                  </div>
                </div>

                <div className="mt-4 flex items-center justify-end gap-4 border-t border-white/10 pt-3.5">
                  <TacticalButton tone="signal" onClick={() => onStartMission(activeMissionDef)}>
                    Deploy Operation
                    <ArrowUpRight className="size-4" />
                  </TacticalButton>
                </div>
              </DossierShell>
            )}
          </div>
        </div>
      )}

      {/* ================= SCREEN: UPGRADES / ARMORY ================= */}
      {screen === "upgrades" && (
        <div className="pointer-events-auto relative z-10 flex flex-1 overflow-hidden px-6 py-6 lg:px-10">
          <div className="flex w-full max-w-2xl flex-col gap-4 overflow-y-auto pr-2">
            {/* Silenced Weapon Selector */}
            <div data-augmented-ui="tr-clip bl-clip border inlay" className="voss-panel-sharp p-4">
              <div className="mb-2.5 flex items-center justify-between font-mono text-[10px] uppercase tracking-[0.24em]">
                <span className="text-[#8a909e]">ACTIVE PRIMARY // LIVE 3D PREVIEW</span>
                <span className="font-bold text-[#e5a93c]">{activeWeaponSpec.name}</span>
              </div>
              <div className="grid grid-cols-4 gap-2">
                {WEAPONS.map((w, idx) => {
                  const active = save.selectedWeapon === idx;
                  return (
                    <button
                      key={w.id}
                      onClick={() => onSelectWeapon(idx)}
                      className={`cursor-pointer border px-3 py-2 text-left transition ${
                        active
                          ? "border-[#ff3b30] bg-[#ff3b30]/15 text-[#f2efe9]"
                          : "border-white/10 bg-white/[0.03] text-[#8a909e] hover:border-white/30 hover:text-[#f2efe9]"
                      }`}
                    >
                      <div className="font-mono text-[9px] font-bold text-[#ff3b30]">0{w.slot}</div>
                      <div className="truncate font-display text-base font-bold uppercase tracking-wide">
                        {w.shortName}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Armory Mode Toggle: Modular Gunsmith Bench vs Field Upgrades */}
            <div className="grid grid-cols-2 gap-2">
              <TacticalButton
                shape="tab"
                tone={armoryMode === "bench" ? "signal" : "ghost"}
                onClick={() => {
                  setArmoryMode("bench");
                  onFocusWeaponBench(true);
                }}
                className="text-[11px]"
              >
                Modular Gunsmith Bench
              </TacticalButton>
              <TacticalButton
                shape="tab"
                tone={armoryMode === "upgrades" ? "gold" : "ghost"}
                onClick={() => {
                  setArmoryMode("upgrades");
                  onFocusWeaponBench(false);
                }}
                className="text-[11px]"
              >
                Ballistic &amp; Rig Upgrades
              </TacticalButton>
            </div>

            {armoryMode === "bench" && (
              <div className="space-y-3">
                {/* Live Tuning Telemetry Bar */}
                <div className="flex flex-wrap items-center justify-between gap-2 border border-white/12 bg-[#0c0e14]/90 px-4 py-2.5 font-mono text-[10px] uppercase">
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="text-[#8a909e]">
                      MAG <b className="text-[#f2efe9]">{Math.round(activeWeaponSpec.magSize * stats.magMult * activeWeaponMods.magMult)}</b>
                    </span>
                    <span className="text-[#8a909e]">
                      RECOIL <b className="text-[#2dd4bf]">{Math.round(activeWeaponMods.recoilMult * 100)}%</b>
                    </span>
                    <span className="text-[#8a909e]">
                      SPREAD <b className="text-[#38bdf8]">{Math.round(activeWeaponMods.spreadMult * 100)}%</b>
                    </span>
                    <span className={activeWeaponMods.suppressed ? "text-[#2dd4bf]" : "text-[#e5a93c]"}>
                      {activeWeaponMods.suppressed ? "SUPPRESSED" : "LOUD BRAKE"}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => onFocusWeaponBench(true)}
                      className="cursor-pointer border border-[#38bdf8]/40 px-2 py-0.5 text-[9px] text-[#38bdf8] hover:bg-[#38bdf8]/15"
                    >
                      Zoom Gun
                    </button>
                    <button
                      onClick={() => onResetWeaponConfig(activeWeaponSpec.id)}
                      className="inline-flex cursor-pointer items-center gap-1 border border-white/15 px-2 py-0.5 text-[9px] text-[#8a909e] hover:text-[#f2efe9]"
                    >
                      <RotateCcw className="size-2.5" />
                      Default
                    </button>
                  </div>
                </div>

                {/* 4 Attachment Slots */}
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {/* Optic */}
                  <div data-augmented-ui="br-clip border inlay" className="voss-panel p-3.5 space-y-2">
                    <div className="font-mono text-[10px] font-bold uppercase tracking-[0.22em] text-[#38bdf8]">
                      01 · OPTIC RAIL
                    </div>
                    <div className="grid grid-cols-2 gap-1.5">
                      {WEAPON_OPTIC_OPTS.map((o) => {
                        const on = activeWeaponCfg.optic === o.id;
                        return (
                          <button
                            key={o.id}
                            onClick={() => onUpdateWeaponConfig(activeWeaponSpec.id, { optic: o.id })}
                            title={o.note}
                            className={`cursor-pointer border px-2.5 py-1.5 text-left transition ${
                              on
                                ? "border-[#38bdf8] bg-[#38bdf8]/15 text-[#f2efe9]"
                                : "border-white/10 bg-white/[0.03] text-[#8a909e] hover:text-[#f2efe9]"
                            }`}
                          >
                            <div className="font-display text-xs font-bold uppercase">{o.label}</div>
                            <div className="truncate font-mono text-[9px] opacity-75">{o.note}</div>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Muzzle */}
                  <div data-augmented-ui="br-clip border inlay" className="voss-panel p-3.5 space-y-2">
                    <div className="font-mono text-[10px] font-bold uppercase tracking-[0.22em] text-[#e5a93c]">
                      02 · MUZZLE DEVICE
                    </div>
                    <div className="grid grid-cols-2 gap-1.5">
                      {WEAPON_MUZZLE_OPTS.map((m) => {
                        const on = activeWeaponCfg.muzzle === m.id;
                        return (
                          <button
                            key={m.id}
                            onClick={() => onUpdateWeaponConfig(activeWeaponSpec.id, { muzzle: m.id })}
                            title={m.note}
                            className={`cursor-pointer border px-2.5 py-1.5 text-left transition ${
                              on
                                ? "border-[#e5a93c] bg-[#e5a93c]/15 text-[#f2efe9]"
                                : "border-white/10 bg-white/[0.03] text-[#8a909e] hover:text-[#f2efe9]"
                            }`}
                          >
                            <div className="font-display text-xs font-bold uppercase">{m.label}</div>
                            <div className="truncate font-mono text-[9px] opacity-75">{m.note}</div>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Underbarrel */}
                  <div data-augmented-ui="br-clip border inlay" className="voss-panel p-3.5 space-y-2">
                    <div className="font-mono text-[10px] font-bold uppercase tracking-[0.22em] text-[#2dd4bf]">
                      03 · UNDERBARREL &amp; LASER
                    </div>
                    <div className="grid grid-cols-2 gap-1.5">
                      {WEAPON_UNDERBARREL_OPTS.map((u) => {
                        const on = activeWeaponCfg.underbarrel === u.id;
                        return (
                          <button
                            key={u.id}
                            onClick={() => onUpdateWeaponConfig(activeWeaponSpec.id, { underbarrel: u.id })}
                            title={u.note}
                            className={`cursor-pointer border px-2.5 py-1.5 text-left transition ${
                              on
                                ? "border-[#2dd4bf] bg-[#2dd4bf]/15 text-[#f2efe9]"
                                : "border-white/10 bg-white/[0.03] text-[#8a909e] hover:text-[#f2efe9]"
                            }`}
                          >
                            <div className="font-display text-xs font-bold uppercase">{u.label}</div>
                            <div className="truncate font-mono text-[9px] opacity-75">{u.note}</div>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Magazine */}
                  <div data-augmented-ui="br-clip border inlay" className="voss-panel p-3.5 space-y-2">
                    <div className="font-mono text-[10px] font-bold uppercase tracking-[0.22em] text-[#ff3b30]">
                      04 · MAGAZINE WELL
                    </div>
                    <div className="grid grid-cols-3 gap-1.5">
                      {WEAPON_MAG_OPTS.map((mg) => {
                        const on = activeWeaponCfg.magazine === mg.id;
                        return (
                          <button
                            key={mg.id}
                            onClick={() => onUpdateWeaponConfig(activeWeaponSpec.id, { magazine: mg.id })}
                            title={mg.note}
                            className={`cursor-pointer border px-2 py-1.5 text-left transition ${
                              on
                                ? "border-[#ff3b30] bg-[#ff3b30]/15 text-[#f2efe9]"
                                : "border-white/10 bg-white/[0.03] text-[#8a909e] hover:text-[#f2efe9]"
                            }`}
                          >
                            <div className="font-display text-xs font-bold uppercase">{mg.label}</div>
                            <div className="truncate font-mono text-[8px] opacity-75">{mg.note}</div>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>

                {/* Per-Part Coatings & Reticle Tint */}
                <div data-augmented-ui="tl-clip br-clip border inlay" className="voss-panel-sharp p-4 space-y-3">
                  <div className="font-mono text-[10px] font-bold uppercase tracking-[0.24em] text-[#8a909e]">
                    PER-PART CERAKOTE &amp; RETICLE FINISH ({DEFAULT_WEAPON_CONFIGS[activeWeaponSpec.id] ? activeWeaponSpec.shortName : ""})
                  </div>
                  {(
                    [
                      ["bodyFinish", "Receiver & Frame"],
                      ["accentFinish", "Stock & Handguard"],
                      ["hardwareFinish", "Rail & Hardware"],
                    ] as const
                  ).map(([field, label]) => (
                    <div key={field} className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-mono text-[10px] uppercase tracking-wider text-[#cfd4de]">{label}</span>
                      <div className="flex flex-wrap gap-1.5">
                        {WEAPON_PART_FINISHES.map((f) => {
                          const on = activeWeaponCfg[field] === f.id;
                          return (
                            <button
                              key={f.id}
                              onClick={() => onUpdateWeaponConfig(activeWeaponSpec.id, { [field]: f.id })}
                              title={f.name}
                              className={`flex cursor-pointer items-center gap-1.5 border px-2 py-1 text-[10px] transition ${
                                on
                                  ? "border-white bg-white/15 text-[#f2efe9]"
                                  : "border-white/12 bg-black/40 text-[#8a909e] hover:text-[#f2efe9]"
                              }`}
                            >
                              <span className="h-2.5 w-2.5 border border-white/30" style={{ background: f.swatch }} />
                              <span className="hidden sm:inline">{f.name}</span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                  <div className="flex items-center justify-between border-t border-white/10 pt-2.5">
                    <span className="font-mono text-[10px] uppercase tracking-wider text-[#cfd4de]">Optic / Laser Reticle</span>
                    <div className="flex gap-1.5">
                      {WEAPON_RETICLE_COLORS.map((rc) => {
                        const on = activeWeaponCfg.reticleColor.toLowerCase() === rc.hex.toLowerCase();
                        return (
                          <button
                            key={rc.hex}
                            onClick={() => onUpdateWeaponConfig(activeWeaponSpec.id, { reticleColor: rc.hex })}
                            title={rc.name}
                            className={`h-6 w-6 cursor-pointer border transition ${
                              on ? "scale-110 border-white" : "border-white/25 hover:scale-105"
                            }`}
                            style={{ background: rc.hex }}
                          />
                        );
                      })}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {armoryMode === "upgrades" && (
              <>
                {/* Category Angled Vector Tabs */}
                <div className="flex flex-wrap gap-2">
                  {UPGRADE_TABS.map((t) => (
                    <TacticalButton
                      key={t.id}
                      shape="tab"
                      tone={upgradeTab === t.id ? "gold" : "ghost"}
                      onClick={() => setUpgradeTab(t.id)}
                      className="flex-1 text-[11px]"
                    >
                      {t.label}
                    </TacticalButton>
                  ))}
                </div>

                {/* Upgrade Rows */}
                <div className="space-y-2.5">
                  {UPGRADES.filter((u) => u.category === upgradeTab).map((u) => {
                    const lvl = getUpgradeLevel(save, u.id);
                    const maxed = lvl >= u.maxLevel;
                    const cost = maxed ? null : u.costs[lvl];
                    const affordable = cost ? canAfford(save.currencies, cost) : false;
                    return (
                      <div
                        key={u.id}
                        data-augmented-ui="br-clip border inlay"
                        className="voss-panel p-4"
                      >
                        <div className="flex items-start justify-between gap-4">
                          <div>
                            <div className="flex items-center gap-3">
                              <h3 className="font-display text-xl font-extrabold uppercase tracking-wide text-[#f2efe9]">
                                {u.name}
                              </h3>
                              <span className="font-mono text-[10px] font-bold text-[#e5a93c]">
                                TIER {lvl}/{u.maxLevel}
                              </span>
                            </div>
                            <p className="mt-0.5 text-xs text-[#8a909e]">{u.subtitle}</p>
                          </div>
                          <div className="flex gap-1 pt-1">
                            {Array.from({ length: u.maxLevel }).map((_, i) => (
                              <span
                                key={i}
                                className={`h-2 w-5 ${i < lvl ? "bg-[#ff3b30]" : "bg-white/12"}`}
                              />
                            ))}
                          </div>
                        </div>

                        <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-white/10 pt-3">
                          <div className="flex items-center gap-2 font-mono text-[11px]">
                            <span className="text-[#8a909e]">
                              {lvl > 0 ? u.effectLabels[lvl - 1] : "BASE"}
                            </span>
                            {!maxed && (
                              <>
                                <span className="text-white/30">→</span>
                                <span className="font-bold text-[#2dd4bf]">{u.effectLabels[lvl]}</span>
                              </>
                            )}
                          </div>

                          {maxed ? (
                            <span className="border border-[#2dd4bf]/45 bg-[#2dd4bf]/10 px-3 py-1 font-mono text-[10px] font-bold uppercase tracking-widest text-[#2dd4bf]">
                              MAXED
                            </span>
                          ) : (
                            <div className="flex items-center gap-3">
                              <div className="flex items-center gap-3">
                                {(Object.entries(cost!) as [CurrencyKey, number][]).map(([k, v]) => (
                                  <CurrencyInline key={k} kind={k} amount={v} compact />
                                ))}
                              </div>
                              <TacticalButton
                                tone={affordable ? "gold" : "ghost"}
                                disabled={!affordable}
                                onClick={() => onBuyUpgrade(u.id)}
                                className="px-4 py-1.5 pb-2.5 text-[10px]"
                              >
                                Upgrade
                              </TacticalButton>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* ================= SCREEN: TAILORED SUIT WARDROBE ================= */}
      {screen === "customize" && (
        <div className="pointer-events-auto relative z-10 flex flex-1 overflow-hidden px-6 py-6 lg:px-10">
          <div className="flex w-full max-w-2xl flex-col gap-4 overflow-y-auto pr-2">
            {/* Operative Identity Banner + Utility Actions */}
            <div className="flex flex-wrap items-center justify-between gap-3 border border-white/12 bg-[#0c0e14]/92 px-4 py-3">
              <div className="flex items-center gap-3">
                <img
                  src={characterPreview("business")}
                  alt="Julian Voss"
                  className="h-12 w-12 shrink-0 border border-[#ff3b30]/50 object-cover object-top"
                />
                <div>
                  <div className="font-mono text-[9px] uppercase tracking-[0.24em] text-[#ff3b30]">
                    JULIAN VOSS · SIGNATURE OPERATIVE
                  </div>
                  <div className="font-display text-lg font-extrabold uppercase tracking-wide text-[#f2efe9]">
                    Tailored Suits &amp; Calfskin Gloves
                  </div>
                  <div className="text-[11px] text-[#8a909e]">
                    Curated suit &amp; tie palettes with fitted leather assassin gloves · More outfits coming later
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={onRandomizeAppearance}
                  title="Randomize suit palette"
                  className="cursor-pointer border border-white/15 bg-white/[0.04] p-2 text-[#f2efe9] transition hover:border-[#ff3b30]"
                >
                  <Shuffle className="size-4" />
                </button>
                <button
                  onClick={() => onUpdateAppearance({ ...DEFAULT_APPEARANCE })}
                  title="Reset to Signature Noir"
                  className="cursor-pointer border border-white/15 bg-white/[0.04] p-2 text-[#8a909e] transition hover:text-[#f2efe9]"
                >
                  <RotateCcw className="size-4" />
                </button>
              </div>
            </div>

            {/* Active Selection Summary */}
            <div data-augmented-ui="tl-clip br-clip border inlay" className="voss-panel p-4">
              <div className="mb-3 flex items-center justify-between font-mono text-[10px] uppercase tracking-[0.24em]">
                <span className="text-[#8a909e]">READY-TO-WEAR SUIT PALETTES</span>
                <span className="text-[#f2efe9]">
                  EQUIPPED: <b className="text-[#ff3b30]">{activeSuit.name}</b>
                </span>
              </div>

              <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                {SUIT_PRESETS.map((preset) => {
                  const selected = activeSuit.id === preset.id;
                  return (
                    <button
                      key={preset.id}
                      onClick={() => onUpdateAppearance({ suitPreset: preset.id })}
                      className={`group relative flex cursor-pointer items-center gap-3 border p-3 text-left transition ${
                        selected
                          ? "border-[#ff3b30] bg-[#ff3b30]/12"
                          : "border-white/10 bg-[#0d1016] hover:border-white/35"
                      }`}
                    >
                      {/* 4-Part Tailored Swatch Stack: Suit · Shirt · Tie · Leather Gloves */}
                      <div className="flex h-12 w-12 shrink-0 overflow-hidden border border-white/20 shadow-inner">
                        <div className="h-full w-5" style={{ backgroundColor: preset.suitColor }} title="Suit" />
                        <div className="h-full w-2.5" style={{ backgroundColor: preset.shirtColor }} title="Shirt" />
                        <div className="h-full w-2" style={{ backgroundColor: preset.tieColor }} title="Tie" />
                        <div className="h-full flex-1" style={{ backgroundColor: preset.gloveColor }} title="Gloves" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-2">
                          <span
                            className={`truncate font-display text-sm font-bold uppercase tracking-wide ${
                              selected ? "text-[#ff3b30]" : "text-[#f2efe9]"
                            }`}
                          >
                            {preset.name}
                          </span>
                          {selected && <Check className="size-3.5 shrink-0 text-[#ff3b30]" />}
                        </div>
                        <div className="mt-0.5 truncate text-[10px] text-[#cbd5e1]">{preset.subtitle}</div>
                        <div className="mt-0.5 truncate font-mono text-[9px] uppercase tracking-wider text-[#8a909e]">
                          {preset.gloveLabel}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ================= SCREEN: MOTORPOOL / DEALERSHIP (2-PANE SHOWROOM) ================= */}
      {screen === "garage" && (
        <div className="pointer-events-auto relative z-10 mx-auto grid w-full max-w-6xl flex-1 grid-cols-1 gap-6 overflow-y-auto px-6 py-6 lg:grid-cols-12 lg:px-10">
          {/* Left Roster */}
          <div className="space-y-1.5 lg:col-span-5">
            <div className="mb-3 flex items-center justify-between font-mono text-[10px] font-bold uppercase tracking-[0.28em] text-[#8a909e]">
              <span>WESTGATE MOTORPOOL</span>
              <span>{save.ownedCars.length}/{CARS.length} OWNED</span>
            </div>
            {CARS.map((car, idx) => {
              const owned = save.ownedCars.includes(car.id);
              const selected = garageCarId === car.id;
              const curbside = save.selectedCar === car.id;
              const paint = save.carPaints[car.id] ?? car.color;
              return (
                <button
                  key={car.id}
                  onClick={() => setGarageCarId(car.id)}
                  className={`relative flex w-full cursor-pointer items-center justify-between border px-4 py-2.5 text-left transition ${
                    selected
                      ? "border-[#38bdf8] bg-[#38bdf8]/10"
                      : "border-white/10 bg-[#0c0e14]/85 hover:border-white/30"
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <span className="font-mono text-xs font-bold text-[#8a909e]">
                      0{idx + 1}
                    </span>
                    <span className="h-3.5 w-3.5 border border-white/30" style={{ background: paint }} />
                    <div>
                      <div className="font-display text-lg font-extrabold uppercase leading-none tracking-wide text-[#f2efe9]">
                        {car.name}
                      </div>
                      <div className="mt-0.5 font-mono text-[10px] uppercase tracking-wider text-[#8a909e]">
                        {car.maker} · {car.klass}
                      </div>
                    </div>
                  </div>
                  <div className="font-mono text-[10px] font-bold uppercase">
                    {curbside ? (
                      <span className="text-[#2dd4bf]">CURBSIDE</span>
                    ) : owned ? (
                      <span className="text-[#f2efe9]">OWNED</span>
                    ) : (
                      <span className="text-[#e5a93c]">{car.price} CR</span>
                    )}
                  </div>
                </button>
              );
            })}
          </div>

          {/* Right Spec Dossier */}
          <div className="lg:col-span-7">
            <DossierShell tone="ice" className="flex h-full flex-col justify-between">
              <div className="space-y-6">
                <div className="flex items-start justify-between gap-4 border-b border-white/10 pb-3">
                  <div>
                    <div className="font-mono text-[10px] font-bold uppercase tracking-[0.3em] text-[#38bdf8]">
                      {featuredCar.maker} // {featuredCar.klass}
                    </div>
                    <h2 className="mt-1 font-display text-4xl font-extrabold uppercase leading-none tracking-wide text-[#f2efe9]">
                      {featuredCar.name}
                    </h2>
                  </div>
                  <span
                    className="h-8 w-8 border border-white/30"
                    style={{ background: featuredPaint }}
                  />
                </div>

                {/* Live Interactive 3D Car Showroom Preview */}
                <CarPreview3D
                  carId={featuredCar.id}
                  paintHex={featuredPaint}
                  custom={featuredCustom}
                  label={`${featuredCar.maker} ${featuredCar.name}`}
                  className="h-56 w-full"
                />

                <p className="border-l-2 border-[#38bdf8] pl-3.5 text-sm leading-relaxed text-[#cfd4de]">
                  {featuredCar.tagline}
                </p>

                {/* Performance Gauges */}
                <div className="space-y-3 border border-white/10 bg-black/40 p-4 font-mono text-[11px] uppercase tracking-wider">
                  {(
                    [
                      ["TOP SPEED", featuredCar.stats.speed, "#38bdf8"],
                      ["HANDLING", featuredCar.stats.handling, "#e5a93c"],
                      ["ALL-WEATHER GRIP", featuredCar.stats.grip, "#2dd4bf"],
                    ] as [string, number, string][]
                  ).map(([label, val, col]) => (
                    <div key={label} className="flex items-center justify-between gap-4">
                      <span className="text-[#8a909e]">{label}</span>
                      <div className="flex gap-1.5">
                        {[1, 2, 3, 4, 5].map((n) => (
                          <span
                            key={n}
                            className="h-2.5 w-8"
                            style={{ background: n <= val ? col : "rgba(255,255,255,0.08)" }}
                          />
                        ))}
                      </div>
                    </div>
                  ))}
                </div>

                {/* Factory Paint Swatches */}
                {featuredOwned && (
                  <div>
                    <div className="mb-2 font-mono text-[10px] font-bold uppercase tracking-[0.24em] text-[#8a909e]">
                      FACTORY FINISH
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {PAINT_COLORS.slice(0, 8).map((p) => {
                        const active = featuredPaint.toLowerCase() === p.hex.toLowerCase();
                        return (
                          <button
                            key={p.hex}
                            onClick={() => onSelectCar(featuredCar.id, p.hex)}
                            title={p.name}
                            className={`h-7 w-7 cursor-pointer border transition ${
                              active ? "scale-110 border-white" : "border-white/25 hover:scale-105"
                            }`}
                            style={{ background: p.hex }}
                          />
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>

              <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-white/10 pt-5">
                {featuredOwned ? (
                  <TacticalButton
                    tone={featuredActive ? "emerald" : "gold"}
                    onClick={() => onSelectCar(featuredCar.id)}
                  >
                    {featuredActive ? (
                      <>
                        <Check className="size-4" />
                        Selected Curbside
                      </>
                    ) : (
                      "Select Car"
                    )}
                  </TacticalButton>
                ) : (
                  <TacticalButton
                    tone={save.currencies.credits >= featuredCar.price ? "gold" : "ghost"}
                    disabled={save.currencies.credits < featuredCar.price}
                    onClick={() => onBuyCar(featuredCar.id)}
                  >
                    Buy · {featuredCar.price} Credits
                  </TacticalButton>
                )}

                <TacticalButton tone="ice" onClick={() => onStartMission(OPEN_WORLD_MISSION)}>
                  Drive in Westgate Bay
                  <ArrowUpRight className="size-4" />
                </TacticalButton>
              </div>
            </DossierShell>
          </div>
        </div>
      )}

      {/* ================= SCREEN: FIELD MANUAL & CONTROLS ================= */}
      {screen === "controls" && (
        <div className="pointer-events-auto relative z-10 mx-auto grid w-full max-w-5xl flex-1 grid-cols-1 gap-6 overflow-y-auto px-6 py-6 md:grid-cols-2 lg:px-10">
          <DossierShell tone="ghost">
            <div className="mb-4 font-mono text-[10px] font-bold uppercase tracking-[0.3em] text-[#ff3b30]">
              KEYBINDINGS MATRIX
            </div>
            <div className="space-y-2 text-xs">
              {KEYS.map(([k, v]) => (
                <div key={k} className="flex items-center justify-between border-b border-white/[0.06] pb-1.5">
                  <kbd className="border border-white/15 bg-white/[0.06] px-2 py-0.5 font-mono text-[10px] font-bold text-[#e5a93c]">
                    {k}
                  </kbd>
                  <span className="text-[#cfd4de]">{v}</span>
                </div>
              ))}
            </div>
          </DossierShell>

          <div className="flex flex-col justify-between gap-5">
            <DossierShell tone="ice">
              <div className="mb-4 font-mono text-[10px] font-bold uppercase tracking-[0.3em] text-[#38bdf8]">
                STEALTH DOCTRINE
              </div>
              <ul className="space-y-3 text-xs leading-relaxed text-[#cfd4de]">
                <li>
                  <b className="text-[#f2efe9]">Silenced Arsenal:</b> Every weapon is suppressed. Unaware guards take{" "}
                  <span className="text-[#2dd4bf]">2.5× ambush damage</span> and drop silently.
                </li>
                <li>
                  <b className="text-[#f2efe9]">Vision Cones &amp; Suspicion:</b> Stay outside forward sightlines. Crouching reduces visual range and eliminates footstep noise.
                </li>
                <li>
                  <b className="text-[#f2efe9]">Silent Takedowns:</b> Approach behind an unaware guard and press{" "}
                  <kbd className="border border-white/15 bg-white/10 px-1.5 py-0.5 font-mono text-[10px] text-[#e5a93c]">V</kbd> for an instant quiet neutralization.
                </li>
                <li>
                  <b className="text-[#f2efe9]">Ghost Protocol:</b> Complete any contract with{" "}
                  <span className="text-[#38bdf8]">0 Alerts</span> for bonus Credits, Intel, and Salvage.
                </li>
              </ul>
            </DossierShell>

            <div className="flex flex-wrap items-center justify-between gap-3 border border-white/12 bg-[#0c0e14]/90 p-4">
              <TacticalButton tone="ice" onClick={onDownloadGlb} className="px-4 py-2 pb-2.5 text-[10px]">
                <Download className="size-3.5" />
                Download {selectedCharacter.name} Rig (GLB)
              </TacticalButton>
              <TacticalButton tone="signal" onClick={onResetSave} className="px-4 py-2 pb-2.5 text-[10px]">
                Reset Progress
              </TacticalButton>
            </div>
          </div>
        </div>
      )}

      {/* ================= NOIR COLD OPEN PROLOGUE (FIRST LAUNCH) ================= */}
      {showPrologue && (
        <div className="pointer-events-auto fixed inset-0 z-50 flex items-center justify-center bg-[#04060a]/95 p-6 backdrop-blur-md">
          <div className="w-full max-w-2xl border border-white/15 bg-[#090c12]/95 p-8 shadow-[0_32px_100px_rgba(0,0,0,0.92)]">
            <div className="flex items-center justify-between border-b border-white/10 pb-3 font-mono text-[10px] uppercase tracking-[0.28em] text-[#ff3b30]">
              <span>CASE FILE 00 // COLD OPEN</span>
              <span>WESTGATE BAY · 02:14 HRS</span>
            </div>

            <div className="mt-6 flex items-center gap-5">
              <img
                src={characterPreview("business")}
                alt="Julian Voss"
                className="h-20 w-20 shrink-0 border border-white/20 object-cover object-top"
              />
              <div>
                <div className="font-mono text-[10px] uppercase tracking-[0.24em] text-[#8a909e]">
                  JULIAN VOSS · VOICE LOG
                </div>
                <h2 className="mt-1 font-display text-3xl font-extrabold uppercase tracking-wide text-[#f2efe9]">
                  The Sovereign Ledger
                </h2>
              </div>
            </div>

            <blockquote className="mt-6 border-l-2 border-[#ff3b30] pl-4 font-sans text-base leading-relaxed text-[#dde2ec]">
              &ldquo;A crooked banker took my money. Three weeks later, Westgate called it a suicide.
              It wasn&apos;t. Someone wiped the ledger — and every name on it still breathes.&rdquo;
            </blockquote>

            <div className="mt-7 flex flex-wrap items-center justify-between gap-3 border-t border-white/10 pt-5">
              <button
                type="button"
                onClick={replayPrologueAudio}
                className="inline-flex cursor-pointer items-center gap-2 border border-white/20 bg-white/[0.04] px-4 py-2 font-mono text-xs font-bold uppercase tracking-wider text-[#cfd4de] transition hover:border-white/45 hover:text-white"
              >
                <Volume2 className={`size-4 ${prologuePlaying ? "text-[#38bdf8]" : ""}`} />
                {prologuePlaying ? "Playing Voss Log..." : "Play Voice Log"}
              </button>

              <div className="flex items-center gap-2.5">
                <button
                  type="button"
                  onClick={dismissPrologue}
                  className="cursor-pointer border border-white/15 bg-transparent px-4 py-2 font-mono text-xs uppercase tracking-wider text-[#8a909e] hover:text-white"
                >
                  Skip
                </button>
                <TacticalButton tone="signal" onClick={dismissPrologue}>
                  Enter Westgate
                  <ArrowUpRight className="size-4" />
                </TacticalButton>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
