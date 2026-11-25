import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
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
  DEFAULT_WEAPON_CONFIGS,
  getUpgradeLevel,
  getWeaponCustomConfig,
  loadSave,
  purchaseApartment,
  purchaseCar,
  purchaseUpgrade,
  resetSave,
  selectOwnedCar,
  setDifficultyMode,
  UPGRADES,
  updateCarCustomConfig,
  upgradeCarTuning,
  writeSave,
  type ApartmentId,
  type ArmorFinish,
  type CarCustomConfig,
  type DifficultyMode,
  type MissionReward,
  type NvgMode,
  type SaveData,
  type SoldierAppearance,
  type UpgradeCategory,
  type WeaponCustomConfig,
  type WeaponFinish,
  type WeaponSlotId,
} from "./game/progression";
import type { CarId } from "./game/vehicles/catalog";
import type { GpsWaypoint } from "./game/city/GpsWaypoint";
import { WEAPONS } from "./character/rifle";
import { MenuShell, type Screen } from "./components/MenuShell";
import { GameHud } from "./components/GameHud";
import { PauseAndEndOverlays } from "./components/PauseAndEndOverlays";
import type { HomeModalKind } from "./components/InteriorModals";

const InteriorModals = lazy(() =>
  import("./components/InteriorModals").then((m) => ({ default: m.InteriorModals })),
);

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
  armor: 0,
  maxArmor: 100,
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
  hitCrit: false,
  hitKill: false,
  damageFlash: 0,
  damageDirRad: 0,
  timeScale: 1,
  paused: false,
  kills: 0,
  weaponIndex: 0,
  weaponName: WEAPONS[0].name,
  weaponCategory: WEAPONS[0].category,
  zoomFactor: 1.0,
  suppressed: true,
  holstered: true,
  weaponWheelOpen: false,
  mapOpen: false,
  phoneOpen: false,
  phoneInitialTab: "home",
  activeApartment: null,
  activeGarage: null,
  homeStation: null,
  wanted: null,
  radioStation: null,
  activeRace: null,
  aircraft: null,
  boat: null,
  carryingBody: false,
  trunkBodiesCount: 0,
  parachuting: false,
  swimming: false,
  binoculars: { open: false, zoom: "2.6x", rangeM: 0 },
  stashesFound: 0,
  totalStashes: 15,
  nearbyPrompt: null,
  surveillance: null,
  stealthState: "hidden",
  suspicion: 0,
  stealthIndicators: [],
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
  nextContractMarker: null,
  hasOpenWorldReturn: false,
  cameraPreset: "close",
  credits: 180,
  muted: false,
  sfxVolume: 0.55,
  engineVolume: 0.72,
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
  const [customWaypoint, setCustomWaypoint] = useState<GpsWaypoint | null>(null);
  const [endInfo, setEndInfo] = useState<{ mission: MissionDef; success: boolean; reward?: MissionReward } | null>(null);
  const [homeModal, setHomeModal] = useState<{ kind: HomeModalKind; apartmentId?: ApartmentId; carId?: CarId } | null>(null);

  const selectedCharacter = CHARACTERS.find((c) => c.id === characterId) ?? CHARACTERS[0];

  const openHomeStationHandler = (kind: HomeModalKind, apartmentId?: ApartmentId, carId?: CarId) => {
    setSave(loadSave());
    setHomeModal({ kind, apartmentId, carId });
  };

  useEffect(() => {
    if (!host.current) return;
    const g = new Game(host.current, setHud, { initialHangar: true });
    game.current = g;
    return () => {
      g.dispose();
      game.current = null;
    };
  }, []);

  useEffect(() => {
    game.current?.setMenuWeaponFocus(screen === "upgrades");
  }, [screen]);

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
    setHomeModal(null);
    setScreen("playing");
    game.current?.requestLock(true);
    if (m.id === -1 && gpsTargetId === null) {
      const s = loadSave();
      const maxU = Math.max(1, s.unlocked);
      const nextId =
        MISSIONS.find((mi) => mi.id >= 1 && mi.id <= maxU && !s.records[mi.id]?.completed)?.id ??
        Math.min(MISSIONS.length - 1, maxU);
      setGpsTargetId(`contract:${nextId}`);
    }
    void game.current?.startMission(m.id, {
      onHud: setHud,
      onMissionEnd: (mission, success, reward) => {
        setEndInfo({ mission, success, reward });
        setSave(loadSave());
      },
      onOpenHomeStation: openHomeStationHandler,
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
    game.current?.refreshSavedLoadoutAndCar();
  };

  const handleSelectMenuWeapon = (idx: number) => {
    setSave((prev) => {
      const updated: SaveData = { ...prev, selectedWeapon: idx };
      writeSave(updated);
      return updated;
    });
    game.current?.previewWeapon(idx);
  };

  const handleUpdateWeaponConfig = (weaponId: WeaponSlotId, patch: Partial<WeaponCustomConfig>) => {
    setSave((prev) => {
      const current = getWeaponCustomConfig(prev, weaponId);
      const nextMap: Record<WeaponSlotId, WeaponCustomConfig> = {
        pistol: getWeaponCustomConfig(prev, "pistol"),
        carbine: getWeaponCustomConfig(prev, "carbine"),
        smg: getWeaponCustomConfig(prev, "smg"),
        shotgun: getWeaponCustomConfig(prev, "shotgun"),
        dmr: getWeaponCustomConfig(prev, "dmr"),
        [weaponId]: { ...current, ...patch },
      };
      const updated: SaveData = { ...prev, weaponConfigs: nextMap };
      writeSave(updated);
      game.current?.previewWeaponConfigs(nextMap);
      game.current?.refreshSavedLoadoutAndCar();
      return updated;
    });
  };

  const handleResetWeaponConfig = (weaponId: WeaponSlotId) => {
    setSave((prev) => {
      const nextMap: Record<WeaponSlotId, WeaponCustomConfig> = {
        pistol: getWeaponCustomConfig(prev, "pistol"),
        carbine: getWeaponCustomConfig(prev, "carbine"),
        smg: getWeaponCustomConfig(prev, "smg"),
        shotgun: getWeaponCustomConfig(prev, "shotgun"),
        dmr: getWeaponCustomConfig(prev, "dmr"),
        [weaponId]: { ...DEFAULT_WEAPON_CONFIGS[weaponId] },
      };
      const updated: SaveData = { ...prev, weaponConfigs: nextMap };
      writeSave(updated);
      game.current?.previewWeaponConfigs(nextMap);
      return updated;
    });
  };

  const updateAppearance = (patch: Partial<SoldierAppearance>) => {
    setSave((prev) => {
      const nextApp: SoldierAppearance = { ...prev.appearance, ...patch };
      const updated: SaveData = { ...prev, appearance: nextApp };
      writeSave(updated);
      game.current?.previewAppearance(nextApp);
      game.current?.refreshSavedLoadoutAndCar();
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
      setHomeModal((m) => (m ? { ...m, carId } : m));
      if (!homeModal && !hud.activeApartment && !hud.activeGarage) {
        game.current?.summonSelectedCar(carId, updated.carPaints[carId]);
      }
      game.current?.refreshSavedLoadoutAndCar();
    }
  };

  const handleSelectCar = (carId: CarId, paintHex?: string | null) => {
    const updated = selectOwnedCar(carId, paintHex);
    if (updated) {
      setSave(updated);
      setHomeModal((m) => (m ? { ...m, carId } : m));
      if (!homeModal && !hud.activeApartment && !hud.activeGarage) {
        game.current?.summonSelectedCar(carId, updated.carPaints[carId]);
      }
      game.current?.refreshSavedLoadoutAndCar();
    }
  };

  const handleUpdateCarCustom = (
    carId: CarId,
    patch: Partial<Omit<CarCustomConfig, "engineLevel" | "handlingLevel" | "brakeLevel">>,
  ) => {
    const updated = updateCarCustomConfig(carId, patch);
    if (updated) {
      setSave(updated);
      game.current?.refreshSavedLoadoutAndCar();
    }
  };

  const handleUpgradeCarTuning = (carId: CarId, stat: "engine" | "handling" | "brake") => {
    const updated = upgradeCarTuning(carId, stat);
    if (updated) {
      setSave(updated);
      game.current?.refreshSavedLoadoutAndCar();
    }
  };

  const handleBuyApartment = (id: ApartmentId) => {
    const updated = purchaseApartment(id);
    if (updated) {
      setSave(updated);
      game.current?.refreshSavedLoadoutAndCar();
    }
  };

  const handleSetDifficulty = (mode: DifficultyMode) => {
    setSave(setDifficultyMode(mode));
  };

  const handleBuyAndEnterApartment = (id: ApartmentId) => {
    const updated = purchaseApartment(id);
    if (updated) {
      setSave(updated);
      game.current?.refreshSavedLoadoutAndCar();
      setHomeModal(null);
      game.current?.setPaused(false);
      game.current?.enterApartment(id);
    }
  };

  const closeHomeModal = () => {
    setHomeModal(null);
    game.current?.refreshSavedLoadoutAndCar();
    game.current?.setPaused(false);
  };

  const handleDriveOutFromModal = (carId: CarId) => {
    setHomeModal(null);
    game.current?.refreshSavedLoadoutAndCar();
    game.current?.setPaused(false);
    if (hud.activeGarage) {
      game.current?.driveCarFromBuildingGarage(carId);
    } else {
      game.current?.driveSafehouseCarOut();
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
  const hideGameCursor =
    playing &&
    hud.phase === "ready" &&
    !hud.paused &&
    !hud.dead &&
    !hud.weaponWheelOpen &&
    !hud.mapOpen &&
    !hud.phoneOpen &&
    !homeModal &&
    !endInfo;

  return (
    <div
      className={`relative h-screen w-screen select-none overflow-hidden bg-[#07080b] font-sans text-[#f2efe9] ${
        hideGameCursor ? "cursor-none [&_*]:!cursor-none" : ""
      }`}
    >
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
          onUpdateWeaponConfig={handleUpdateWeaponConfig}
          onResetWeaponConfig={handleResetWeaponConfig}
          onFocusWeaponBench={(focus) => game.current?.setMenuWeaponFocus(focus)}
          onUpdateAppearance={updateAppearance}
          onRandomizeAppearance={randomizeAppearance}
          onSetDifficulty={handleSetDifficulty}
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
            save={save}
            gameRef={game}
            spreadPx={spreadPx}
            gpsTargetId={gpsTargetId}
            setGpsTargetId={setGpsTargetId}
            customWaypoint={customWaypoint}
            setCustomWaypoint={setCustomWaypoint}
            onStartMission={startMission}
            onBuyCar={handleBuyCar}
            onSelectCar={handleSelectCar}
            onBuyApartment={handleBuyApartment}
          />
          {homeModal && (
            <Suspense fallback={null}>
              <InteriorModals
                modal={homeModal.kind}
                apartmentId={homeModal.apartmentId}
                carId={homeModal.carId}
                save={save}
                characterId={characterId}
                onClose={closeHomeModal}
                onDriveOut={handleDriveOutFromModal}
                onBuyCar={handleBuyCar}
                onSelectCar={handleSelectCar}
                onUpdateCarCustom={handleUpdateCarCustom}
                onUpgradeCarTuning={handleUpgradeCarTuning}
                onUpdateWeaponConfig={handleUpdateWeaponConfig}
                onPurchaseUpgrade={handleBuyUpgrade}
                onSelectCharacter={handleSelectCharacter}
                onUpdateAppearance={updateAppearance}
                onBuyAndEnterApartment={handleBuyAndEnterApartment}
              />
            </Suspense>
          )}
          <PauseAndEndOverlays
            hud={homeModal ? { ...hud, paused: false } : hud}
            save={save}
            endInfo={endInfo}
            gameRef={game}
            gpsTargetId={gpsTargetId}
            setGpsTargetId={setGpsTargetId}
            onClearCustomWaypoint={() => setCustomWaypoint(null)}
            setCamTick={setCamTick}
            onExitToScreen={exitToScreen}
            onStartMission={startMission}
            onClearEndInfo={() => setEndInfo(null)}
            onBuyCar={handleBuyCar}
            onSelectCar={handleSelectCar}
          />
        </>
      )}
    </div>
  );
}
