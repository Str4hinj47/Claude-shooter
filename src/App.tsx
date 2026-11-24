import { useEffect, useMemo, useRef, useState } from "react";
import { Game, type HudState } from "./game/Game";
import { MISSIONS, type MissionDef } from "./game/story";
import {
  CHARACTERS,
  characterUrl,
  loadCharacterId,
  saveCharacterId,
} from "./game/characters";
import {
  canAfford,
  getUpgradeLevel,
  loadSave,
  purchaseCar,
  purchaseUpgrade,
  resetSave,
  selectOwnedCar,
  UPGRADES,
  writeSave,
  type ArmorFinish,
  type MissionReward,
  type NvgMode,
  type SaveData,
  type SoldierAppearance,
  type UpgradeCategory,
  type WeaponFinish,
} from "./game/progression";
import type { CarId } from "./game/vehicles/catalog";
import { WEAPONS } from "./character/rifle";
import { MenuShell, type Screen } from "./components/MenuShell";
import { GameHud } from "./components/GameHud";
import { PauseAndEndOverlays } from "./components/PauseAndEndOverlays";

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
  nearbyContract: null,
  hasOpenWorldReturn: false,
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

const ARMOR_HEXES = ["#e6e8ec", "#262b33", "#22364d", "#4b5842", "#8e795b", "#6e252a", "#7b8a99", "#2b4e78"];
const GEAR_HEXES = ["#2e3338", "#16191e", "#3c4736", "#7a674d", "#4a5565", "#5a2125"];
const VISOR_HEXES = ["#22d3ee", "#f59e0b", "#ef4444", "#34d399", "#a855f7", "#1a202c"];
const WEAPON_FINISHES: WeaponFinish[] = ["obsidian", "coyote", "arctic", "crimson", "gold"];

export default function App() {
  const host = useRef<HTMLDivElement>(null);
  const game = useRef<Game | null>(null);
  const [hud, setHud] = useState<HudState>(initial);
  const [screen, setScreen] = useState<Screen>("home");
  const [save, setSave] = useState<SaveData>(() => loadSave());
  const [selectedMissionId, setSelectedMissionId] = useState<number>(() => {
    const s = loadSave();
    return Math.min(MISSIONS.length - 1, Math.max(1, s.unlocked));
  });
  const [upgradeTab, setUpgradeTab] = useState<UpgradeCategory>("weapons");
  const [customTab, setCustomTab] = useState<"operator" | "colors" | "gear">("operator");
  const [characterId, setCharacterId] = useState<string>(loadCharacterId);
  const [, setCamTick] = useState(0);
  const [gpsTargetId, setGpsTargetId] = useState<string | null>(null);
  const [endInfo, setEndInfo] = useState<{ mission: MissionDef; success: boolean; reward?: MissionReward } | null>(null);

  const selectedCharacter = CHARACTERS.find((c) => c.id === characterId) ?? CHARACTERS[0];

  useEffect(() => {
    if (!host.current) return;
    const g = new Game(host.current, setHud);
    game.current = g;
    return () => {
      g.dispose();
      game.current = null;
    };
  }, []);

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
      characterUrl: characterUrl(characterId),
    });
  };

  const handleSelectCharacter = (id: string) => {
    setCharacterId(id);
    saveCharacterId(id);
    void game.current?.setPlayerCharacter(characterUrl(id));
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
      armorColor: pick(ARMOR_HEXES),
      armorFinish: pick<ArmorFinish>(["matte", "tactical", "titanium"]),
      gearColor: pick(GEAR_HEXES),
      visorColor: pick(VISOR_HEXES),
      visorGlow: Number((0.35 + Math.random() * 0.75).toFixed(2)),
      weaponFinish: pick(WEAPON_FINISHES),
      nvg: pick<NvgMode>(["flipped", "deployed", "none"]),
      backpack: Math.random() > 0.25,
      chestRig: Math.random() > 0.2,
      holster: Math.random() > 0.2,
      headset: Math.random() > 0.2,
    });
  };

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

  const download = () => {
    const a = document.createElement("a");
    a.href = characterUrl(characterId);
    a.download = `${characterId}_rigged.glb`;
    a.click();
  };

  const spreadPx = 6 + hud.spread * 1800;
  const playing = screen === "playing";

  return (
    <div className="relative h-screen w-screen select-none overflow-hidden bg-[#07080b] font-sans text-[#f2efe9]">
      {/* Live 3D viewport (Menu Spotlight OR Active Mission / Westgate Bay) */}
      <div ref={host} className="absolute inset-0" />

      {!playing && (
        <MenuShell
          screen={screen}
          setScreen={setScreen}
          save={save}
          selectedMission={selectedMission}
          setSelectedMissionId={setSelectedMissionId}
          nextMission={nextMission}
          unlockThreshold={unlockThreshold}
          ghostCount={ghostCount}
          affordableCount={affordableCount}
          characterId={characterId}
          selectedCharacter={selectedCharacter}
          upgradeTab={upgradeTab}
          setUpgradeTab={setUpgradeTab}
          customTab={customTab}
          setCustomTab={setCustomTab}
          onStartMission={startMission}
          onSelectCharacter={handleSelectCharacter}
          onBuyUpgrade={handleBuyUpgrade}
          onSelectWeapon={handleSelectMenuWeapon}
          onUpdateAppearance={updateAppearance}
          onRandomizeAppearance={randomizeAppearance}
          onBuyCar={handleBuyCar}
          onSelectCar={handleSelectCar}
          onDownloadGlb={download}
          onResetSave={() => setSave(resetSave())}
        />
      )}

      {playing && (
        <>
          <GameHud
            hud={hud}
            gameRef={game}
            spreadPx={spreadPx}
            gpsTargetId={gpsTargetId}
            setGpsTargetId={setGpsTargetId}
          />
          <PauseAndEndOverlays
            hud={hud}
            save={save}
            endInfo={endInfo}
            gameRef={game}
            gpsTargetId={gpsTargetId}
            setGpsTargetId={setGpsTargetId}
            setCamTick={setCamTick}
            onExitToScreen={exitToScreen}
            onStartMission={startMission}
            onBuyCar={handleBuyCar}
            onSelectCar={handleSelectCar}
          />
        </>
      )}
    </div>
  );
}
