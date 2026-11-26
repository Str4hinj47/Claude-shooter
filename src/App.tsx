import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { Game, type HudState } from "./game/Game";
import {
  getNextStoryChapter,
  MISSIONS,
  STORYLINE_CHAPTERS,
  type MissionDef,
  type StoryChapterDef,
} from "./game/story";
import { SURVEILLANCE_CONTRACTS } from "./game/city/ContractSurveillance";
import {
  CHARACTERS,
  characterUrl,
  DEFAULT_CHARACTER,
  loadCharacterId,
  saveCharacterId,
  SUIT_PRESETS,
} from "./game/characters";
import {
  canAfford,
  DEFAULT_WEAPON_CONFIGS,
  getUpgradeLevel,
  getWeaponCustomConfig,
  loadSave,
  markPrologueSeen,
  purchaseApartment,
  purchaseCar,
  purchaseUpgrade,
  resetSave,
  selectOwnedCar,
  setDifficultyMode,
  setLedgerChoice,
  UPGRADES,
  updateCarCustomConfig,
  upgradeCarTuning,
  writeSave,
  type ApartmentId,
  type CarCustomConfig,
  type DifficultyMode,
  type MissionReward,
  type SaveData,
  type SoldierAppearance,
  type UpgradeCategory,
  type WeaponCustomConfig,
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
  incomingCall: null,
  gtaDirective: null,
  cinematic: null,
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
  melee: { active: false, combo: 0, blocking: false, moveLabel: null, callout: null },
  vehicle: null,
  weapons: WEAPONS.map((w) => ({
    slot: w.slot,
    shortName: w.shortName,
    category: w.category,
    mag: w.magSize,
    reserve: w.reserveMax,
  })),
};

export default function App() {
  const host = useRef<HTMLDivElement>(null);
  const game = useRef<Game | null>(null);
  const [hud, setHud] = useState<HudState>(initial);
  const [screen, setScreen] = useState<Screen>("home");
  const [save, setSave] = useState<SaveData>(() => loadSave());
  const [selectedMissionId, setSelectedMissionId] = useState<number>(() => {
    const s = loadSave();
    const nextCh = getNextStoryChapter(s);
    return nextCh.missionId ?? Math.min(MISSIONS.length - 1, Math.max(1, s.unlocked));
  });
  const [selectedChapterNum, setSelectedChapterNum] = useState<number>(() => {
    const s = loadSave();
    return getNextStoryChapter(s).chapter;
  });
  const [upgradeTab, setUpgradeTab] = useState<UpgradeCategory>("weapons");
  const [customTab, setCustomTab] = useState<"operator" | "colors" | "gear">("operator");
  const [characterId, setCharacterId] = useState<string>(loadCharacterId);
  const [, setCamTick] = useState(0);
  const [gpsTargetId, setGpsTargetId] = useState<string | null>(null);
  const [customWaypoint, setCustomWaypoint] = useState<GpsWaypoint | null>(null);
  const [endInfo, setEndInfo] = useState<{ mission: MissionDef; success: boolean; reward?: MissionReward } | null>(null);
  const [homeModal, setHomeModal] = useState<{ kind: HomeModalKind; apartmentId?: ApartmentId; carId?: CarId } | null>(null);

  const selectedCharacter = CHARACTERS.find((c) => c.id === DEFAULT_CHARACTER) ?? CHARACTERS[0];

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
  const nextStoryChapter = getNextStoryChapter(save);
  const nextMission =
    (nextStoryChapter.missionId !== undefined
      ? MISSIONS.find((m) => m.id === nextStoryChapter.missionId)
      : undefined) ??
    MISSIONS.find((m) => m.id === Math.min(MISSIONS.length - 1, unlockThreshold)) ??
    MISSIONS[1];
  const selectedMission = MISSIONS.find((m) => m.id === selectedMissionId) ?? MISSIONS[1];
  const selectedChapter =
    STORYLINE_CHAPTERS.find((c) => c.chapter === selectedChapterNum) ?? nextStoryChapter;
  const ghostCount = Object.values(save.records).filter((r) => r.ghost).length;

  const affordableCount = useMemo(
    () =>
      UPGRADES.filter((u) => {
        const lvl = getUpgradeLevel(save, u.id);
        return lvl < u.maxLevel && canAfford(save.currencies, u.costs[lvl]);
      }).length,
    [save],
  );

  const startMission = (m: MissionDef, opts?: { surveillanceId?: string }) => {
    setEndInfo(null);
    setHomeModal(null);
    setScreen("playing");
    game.current?.requestLock(true);
    if (opts?.surveillanceId) {
      const surv = SURVEILLANCE_CONTRACTS.find((c) => c.id === opts.surveillanceId);
      if (surv) {
        setGpsTargetId(`surv_home_${surv.id}`);
        setCustomWaypoint({
          id: `surv_home_${surv.id}`,
          x: surv.residence.x,
          z: surv.residence.z,
          label: `Target: ${surv.targetName}`,
        });
      }
    } else if (m.id === -1) {
      const s = loadSave();
      const ch = getNextStoryChapter(s);
      const nextGps =
        ch.kind === "surveillance" && ch.surveillanceId
          ? `surveillance:${ch.surveillanceId}`
          : ch.missionId !== undefined
            ? `contract:${ch.missionId}`
            : null;
      if (nextGps && (!gpsTargetId || gpsTargetId.startsWith("contract:") || gpsTargetId.startsWith("surveillance:"))) {
        setCustomWaypoint(null);
        setGpsTargetId(nextGps);
      }
    }
    void game.current?.startMission(
      m.id,
      {
        onHud: setHud,
        onMissionEnd: (mission, success, reward) => {
          setEndInfo({ mission, success, reward });
          const nextSave = loadSave();
          setSave(nextSave);
          if (success) {
            const ch = getNextStoryChapter(nextSave);
            const nextGps =
              ch.kind === "surveillance" && ch.surveillanceId
                ? `surveillance:${ch.surveillanceId}`
                : ch.missionId !== undefined
                  ? `contract:${ch.missionId}`
                  : null;
            if (nextGps) {
              setCustomWaypoint(null);
              setGpsTargetId(nextGps);
            }
          }
        },
        onOpenHomeStation: openHomeStationHandler,
        characterUrl: characterUrl(characterId),
      },
      opts,
    );
  };

  const startStoryChapter = (ch: StoryChapterDef) => {
    if (ch.kind === "surveillance" && ch.surveillanceId) {
      const openMission = MISSIONS[0];
      startMission({ ...openMission, id: -1 }, { surveillanceId: ch.surveillanceId });
      return;
    }
    const m = MISSIONS.find((mi) => mi.id === (ch.missionId ?? 1)) ?? MISSIONS[1];
    startMission(m);
  };

  const handleSelectCharacter = (_id: string) => {
    setCharacterId(DEFAULT_CHARACTER);
    saveCharacterId(DEFAULT_CHARACTER);
    void game.current?.setPlayerCharacter(characterUrl(DEFAULT_CHARACTER));
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
      suitPreset: pick(SUIT_PRESETS).id,
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
    if (screen === "playing") game.current?.setPaused(false);
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
          selectedChapter={selectedChapter}
          setSelectedChapterNum={setSelectedChapterNum}
          nextMission={nextMission}
          nextStoryChapter={nextStoryChapter}
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
          onStartStoryChapter={startStoryChapter}
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
          onMarkPrologueSeen={() => setSave(markPrologueSeen())}
          onOpenEvidenceWall={() => openHomeStationHandler("intel_board")}
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
            onStartStoryChapter={startStoryChapter}
            onBuyCar={handleBuyCar}
            onSelectCar={handleSelectCar}
            onBuyApartment={handleBuyApartment}
          />
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
            onStartStoryChapter={startStoryChapter}
            onClearEndInfo={() => setEndInfo(null)}
            onBuyCar={handleBuyCar}
            onSelectCar={handleSelectCar}
            onSelectLedgerChoice={(choice) => setSave(setLedgerChoice(choice))}
          />
        </>
      )}

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
            onStartStoryChapter={startStoryChapter}
          />
        </Suspense>
      )}
    </div>
  );
}
