import { ArrowUpRight, Car, Compass, MapPin, Navigation, Play, RotateCcw, Shield } from "lucide-react";
import { CAMERA_ORDER, type CameraPreset, type Game, type HudState } from "../game/Game";
import { MISSIONS, type MissionDef } from "../game/story";
import { WESTGATE_CONTRACT_SPOTS, WESTGATE_TELEPORTS } from "../game/city";
import { TIME_OF_DAY_LABELS, TIME_OF_DAY_MODES, type TimeOfDayMode } from "../game/city/WestgateWorld";
import { WEATHER_MODES, type WeatherMode } from "../game/vehicles/weather";
import { CARS, type CarId } from "../game/vehicles/catalog";
import type { MissionReward, SaveData } from "../game/progression";
import { CurrencyInline, type Screen } from "./MenuShell";
import { DossierShell, TacticalButton } from "./ui/VectorFrame";

interface PauseAndEndProps {
  hud: HudState;
  save: SaveData;
  endInfo: { mission: MissionDef; success: boolean; reward?: MissionReward } | null;
  gameRef: React.MutableRefObject<Game | null>;
  gpsTargetId: string | null;
  setGpsTargetId: (id: string | null) => void;
  setCamTick: React.Dispatch<React.SetStateAction<number>>;
  onExitToScreen: (target: Exclude<Screen, "playing">) => void;
  onStartMission: (m: MissionDef) => void;
  onBuyCar: (carId: CarId) => void;
  onSelectCar: (carId: CarId, paintHex?: string | null) => void;
}

export function PauseAndEndOverlays({
  hud,
  save,
  endInfo,
  gameRef,
  gpsTargetId,
  setGpsTargetId,
  setCamTick,
  onExitToScreen,
  onStartMission,
  onBuyCar,
  onSelectCar,
}: PauseAndEndProps) {
  const camCfg = gameRef.current?.getCameraSettings();
  const freeCfg = gameRef.current?.getFreeCameraSettings();

  return (
    <>
      {/* ================= K.I.A. CASUALTY REPORT ================= */}
      {hud.phase === "dead" && (
        <div className="voss-grid-bg absolute inset-0 z-40 flex items-center justify-center bg-[#090608]/88 p-6 backdrop-blur-md">
          <DossierShell tone="signal" className="w-full max-w-2xl">
            <div className="border-b border-white/10 pb-5">
              <div className="font-mono text-[10px] font-bold uppercase tracking-[0.34em] text-[#ff3b30]">
                SIGNAL LOST // OPERATIVE NEUTRALIZED
              </div>
              <div className="mt-1 font-display text-7xl font-extrabold uppercase leading-none tracking-[0.12em] text-[#ff3b30]">
                K.I.A.
              </div>
              <div className="mt-2 font-mono text-xs uppercase tracking-[0.2em] text-[#8a909e]">
                {hud.mission?.codename} · {hud.mission?.name}
              </div>
            </div>

            {endInfo?.reward &&
              (endInfo.reward.credits > 0 || endInfo.reward.intel > 0 || endInfo.reward.salvage > 0) && (
                <div className="my-5 flex flex-wrap items-center gap-5 border border-white/10 bg-black/40 px-4 py-3">
                  <span className="font-mono text-[10px] font-bold uppercase tracking-[0.24em] text-[#8a909e]">
                    SALVAGED PAYOUT
                  </span>
                  <CurrencyInline kind="credits" amount={endInfo.reward.credits} compact />
                  <CurrencyInline kind="intel" amount={endInfo.reward.intel} compact />
                  <CurrencyInline kind="salvage" amount={endInfo.reward.salvage} compact />
                </div>
              )}

            <div className="mt-6 flex flex-wrap items-center gap-3">
              <TacticalButton tone="signal" onClick={() => gameRef.current?.respawn()}>
                <RotateCcw className="size-3.5" />
                Retry mission
              </TacticalButton>
              {hud.hasOpenWorldReturn && (
                <TacticalButton tone="ice" onClick={() => void gameRef.current?.returnToOpenWorld()}>
                  <Compass className="size-3.5" />
                  Return to Westgate Bay
                </TacticalButton>
              )}
              <TacticalButton tone="gold" onClick={() => onExitToScreen("upgrades")}>
                Armory
              </TacticalButton>
              <TacticalButton tone="ghost" onClick={() => onExitToScreen("home")}>
                Main Menu
              </TacticalButton>
            </div>
          </DossierShell>
        </div>
      )}

      {/* ================= MISSION COMPLETE DEBRIEF ================= */}
      {hud.phase === "complete" && endInfo?.success && (
        <div className="voss-grid-bg absolute inset-0 z-40 flex items-center justify-center bg-[#06090b]/88 p-6 backdrop-blur-md">
          <DossierShell tone="emerald" className="w-full max-w-2xl">
            <div className="flex flex-wrap items-start justify-between gap-4 border-b border-white/10 pb-5">
              <div>
                <div className="font-mono text-[10px] font-bold uppercase tracking-[0.34em] text-[#2dd4bf]">
                  OPERATION DEBRIEF // CONTRACT FULFILLED
                </div>
                <div className="mt-1 font-display text-5xl font-extrabold uppercase leading-none tracking-wide text-[#f2efe9]">
                  {endInfo.mission.codename}
                </div>
                <div className="mt-1 font-mono text-xs uppercase tracking-wider text-[#8a909e]">
                  {endInfo.mission.name}
                </div>
              </div>
              {endInfo.reward?.ghostBonus && (
                <div className="border border-[#38bdf8]/60 bg-[#38bdf8]/15 px-3 py-1.5 font-mono text-[10px] font-bold uppercase tracking-[0.22em] text-[#38bdf8]">
                  GHOST RATING · 0 ALERTS
                </div>
              )}
            </div>

            {endInfo.reward && (
              <div className="my-5 flex flex-wrap items-center justify-between gap-4 border border-white/10 bg-black/45 px-4 py-3">
                <span className="font-mono text-[10px] font-bold uppercase tracking-[0.26em] text-[#8a909e]">
                  WIRE TRANSFER SETTLED
                </span>
                <div className="flex flex-wrap gap-5">
                  <CurrencyInline kind="credits" amount={endInfo.reward.credits} />
                  <CurrencyInline kind="intel" amount={endInfo.reward.intel} />
                  <CurrencyInline kind="salvage" amount={endInfo.reward.salvage} />
                </div>
              </div>
            )}

            <div className="max-h-[28vh] space-y-2.5 overflow-y-auto pr-1">
              {endInfo.mission.debrief.map((line, i) => (
                <p
                  key={i}
                  className="border-l-2 border-[#2dd4bf]/70 pl-3.5 text-sm leading-relaxed text-[#cfd4de]"
                >
                  {line}
                </p>
              ))}
            </div>

            <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-white/10 pt-5">
              <TacticalButton tone="gold" onClick={() => onExitToScreen("upgrades")}>
                Armory
              </TacticalButton>
              <div className="flex flex-wrap gap-3">
                {hud.hasOpenWorldReturn && (
                  <TacticalButton tone="ice" onClick={() => void gameRef.current?.returnToOpenWorld()}>
                    Return to Westgate Bay
                  </TacticalButton>
                )}
                <TacticalButton tone="ghost" onClick={() => onExitToScreen("home")}>
                  Menu
                </TacticalButton>
                {endInfo.mission.id < MISSIONS.length - 1 && (
                  <TacticalButton
                    tone="emerald"
                    onClick={() => {
                      const next = MISSIONS[endInfo.mission.id + 1];
                      onStartMission(next);
                    }}
                  >
                    Next mission
                    <ArrowUpRight className="size-4" />
                  </TacticalButton>
                )}
              </div>
            </div>
          </DossierShell>
        </div>
      )}

      {/* ================= PAUSED: FULL-HEIGHT COMMAND DRAWER + DISPATCH GRID ================= */}
      {hud.paused && hud.phase === "ready" && (
        <div className="voss-grid-bg absolute inset-0 z-40 flex flex-col bg-[#07080b]/86 backdrop-blur-md lg:flex-row">
          {/* Left Command Rail */}
          <aside className="flex w-full shrink-0 flex-col justify-between border-b border-white/10 bg-[#0b0d13]/95 p-6 lg:w-88 lg:border-b-0 lg:border-r lg:p-8">
            <div>
              <div className="font-mono text-[10px] font-bold uppercase tracking-[0.34em] text-[#ff3b30]">
                SYSTEM SUSPENDED // FIELD OPS
              </div>
              <h2 className="mt-1 font-display text-5xl font-extrabold uppercase leading-none tracking-[0.08em] text-[#f2efe9]">
                PAUSED
              </h2>
              <div className="mt-2 border-b border-white/10 pb-4 font-mono text-[11px] uppercase tracking-wider text-[#8a909e]">
                {hud.isOpenWorld
                  ? `${hud.district?.name ?? "Westgate Bay"} · ${hud.credits} CR`
                  : `${hud.mission?.codename} · ${hud.kills} ELIMINATED · ${hud.stealthKills} STEALTH`}
              </div>

              <div className="mt-5 flex flex-col gap-2">
                <TacticalButton
                  tone="signal"
                  onClick={() => gameRef.current?.setPaused(false)}
                  className="w-full justify-start"
                >
                  <Play className="size-3.5" />
                  <span>01 · Resume</span>
                </TacticalButton>

                <button
                  onClick={() => {
                    gameRef.current?.setPaused(false);
                    gameRef.current?.respawn();
                  }}
                  className="flex cursor-pointer items-center gap-3 border border-white/12 bg-white/[0.03] px-4 py-2.5 text-left font-mono text-xs font-bold uppercase tracking-[0.18em] text-[#f2efe9] transition hover:border-white/40 hover:bg-white/[0.08]"
                >
                  <RotateCcw className="size-3.5 text-[#8a909e]" />
                  <span>02 · Restart mission</span>
                </button>

                {hud.hasOpenWorldReturn && (
                  <button
                    onClick={() => void gameRef.current?.returnToOpenWorld()}
                    className="flex cursor-pointer items-center gap-3 border border-[#38bdf8]/45 bg-[#38bdf8]/12 px-4 py-2.5 text-left font-mono text-xs font-bold uppercase tracking-[0.18em] text-[#e0f2fe] transition hover:bg-[#38bdf8]/25"
                  >
                    <Compass className="size-3.5 text-[#38bdf8]" />
                    <span>03 · Return to Westgate Bay</span>
                  </button>
                )}

                <button
                  onClick={() => onExitToScreen("garage")}
                  className="flex cursor-pointer items-center gap-3 border border-white/12 bg-white/[0.03] px-4 py-2.5 text-left font-mono text-xs font-bold uppercase tracking-[0.18em] text-[#2dd4bf] transition hover:border-[#2dd4bf]/50 hover:bg-[#2dd4bf]/10"
                >
                  <Car className="size-3.5" />
                  <span>Car Dealership &amp; Garage</span>
                </button>

                <button
                  onClick={() => onExitToScreen("upgrades")}
                  className="flex cursor-pointer items-center gap-3 border border-white/12 bg-white/[0.03] px-4 py-2.5 text-left font-mono text-xs font-bold uppercase tracking-[0.18em] text-[#e5a93c] transition hover:border-[#e5a93c]/50 hover:bg-[#e5a93c]/10"
                >
                  <Shield className="size-3.5" />
                  <span>Armory &amp; Upgrades</span>
                </button>

                <button
                  onClick={() => onExitToScreen("home")}
                  className="flex cursor-pointer items-center gap-3 border border-white/10 bg-transparent px-4 py-2.5 text-left font-mono text-xs font-bold uppercase tracking-[0.18em] text-[#8a909e] transition hover:border-white/30 hover:text-[#f2efe9]"
                >
                  <span>Quit to menu</span>
                </button>
              </div>
            </div>

            <div className="mt-6 hidden border-t border-white/10 pt-3 font-mono text-[10px] uppercase tracking-[0.2em] text-[#8a909e] lg:block">
              PRESS [ESC] TO RESUME FIELD FEED
            </div>
          </aside>

          {/* Right Open-World Tactical Dispatch Matrix */}
          <main className="flex-1 overflow-y-auto p-6 lg:p-8">
            {hud.isOpenWorld ? (
              <div className="mx-auto grid max-w-4xl grid-cols-1 gap-4 md:grid-cols-2">
                {/* Environment Controls */}
                <div data-augmented-ui="tr-clip border inlay" className="voss-panel-sharp p-4 space-y-3">
                  <div className="flex items-center justify-between font-mono text-[10px] font-bold uppercase tracking-[0.24em] text-[#e5a93c]">
                    <span>TIME OF DAY [T]</span>
                    <span className="text-[#f2efe9]">{hud.timeOfDayLabel}</span>
                  </div>
                  <div className="grid grid-cols-4 gap-1.5">
                    {(TIME_OF_DAY_MODES as TimeOfDayMode[]).map((tod) => (
                      <button
                        key={tod}
                        onClick={() => gameRef.current?.setTimeOfDay(tod)}
                        className={`cursor-pointer border py-1.5 font-mono text-[10px] font-bold uppercase transition ${
                          hud.timeOfDay === tod
                            ? "border-[#e5a93c] bg-[#e5a93c]/20 text-[#e5a93c]"
                            : "border-white/10 bg-white/[0.03] text-[#8a909e] hover:text-[#f2efe9]"
                        }`}
                      >
                        {TIME_OF_DAY_LABELS[tod]}
                      </button>
                    ))}
                  </div>

                  <div className="flex items-center justify-between pt-2 font-mono text-[10px] font-bold uppercase tracking-[0.24em] text-[#38bdf8]">
                    <span>WEATHER [B]</span>
                    <span className="text-[#f2efe9]">{hud.weatherLabel}</span>
                  </div>
                  <div className="grid grid-cols-4 gap-1.5">
                    {(WEATHER_MODES as WeatherMode[]).map((m) => (
                      <button
                        key={m}
                        onClick={() => gameRef.current?.setWeatherMode(m)}
                        className={`cursor-pointer border py-1.5 font-mono text-[10px] font-bold uppercase transition ${
                          hud.weatherMode === m
                            ? "border-[#38bdf8] bg-[#38bdf8]/20 text-[#38bdf8]"
                            : "border-white/10 bg-white/[0.03] text-[#8a909e] hover:text-[#f2efe9]"
                        }`}
                      >
                        {m}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Vehicle Camera Tuning */}
                {camCfg && freeCfg && (
                  <div data-augmented-ui="tr-clip border inlay" className="voss-panel-sharp p-4 space-y-2.5">
                    <div className="font-mono text-[10px] font-bold uppercase tracking-[0.24em] text-[#e5a93c]">
                      VEHICLE CAMERA TUNING
                    </div>
                    <div className="grid grid-cols-6 gap-1">
                      {(CAMERA_ORDER as CameraPreset[]).map((p) => (
                        <button
                          key={p}
                          onClick={() => {
                            gameRef.current?.setCameraPreset(p);
                            setCamTick((t) => t + 1);
                          }}
                          className={`cursor-pointer border py-1 font-mono text-[9px] font-bold uppercase transition ${
                            camCfg.preset === p
                              ? "border-[#e5a93c] bg-[#e5a93c]/20 text-[#e5a93c]"
                              : "border-white/10 bg-white/[0.03] text-[#8a909e] hover:text-[#f2efe9]"
                          }`}
                        >
                          {p}
                        </button>
                      ))}
                    </div>
                    <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-[10px] text-[#cfd4de]">
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
                            <span className="text-[#e5a93c]">
                              {val.toFixed(key === "fov" || key === "lookAhead" ? 0 : 1)}
                            </span>
                          </div>
                          <input
                            type="range"
                            min={min}
                            max={max}
                            step={step}
                            value={val}
                            onChange={(e) => {
                              gameRef.current?.setCameraValue(key, Number(e.target.value));
                              setCamTick((t) => t + 1);
                            }}
                            className="w-full accent-[#e5a93c]"
                          />
                        </label>
                      ))}
                    </div>
                    <div className="flex items-center justify-between gap-3 pt-1 font-mono text-[10px]">
                      <label className="flex flex-1 items-center gap-2">
                        <span>Free Sens</span>
                        <input
                          type="range"
                          min={0.25}
                          max={3}
                          step={0.1}
                          value={freeCfg.sensitivity}
                          onChange={(e) => {
                            gameRef.current?.setFreeCameraSettings({ sensitivity: Number(e.target.value) });
                            setCamTick((t) => t + 1);
                          }}
                          className="w-full accent-[#e5a93c]"
                        />
                        <span className="text-[#e5a93c]">{freeCfg.sensitivity.toFixed(1)}×</span>
                      </label>
                      <label className="flex items-center gap-1.5">
                        <input
                          type="checkbox"
                          checked={freeCfg.autoCenter}
                          onChange={(e) => {
                            gameRef.current?.setFreeCameraSettings({ autoCenter: e.target.checked });
                            setCamTick((t) => t + 1);
                          }}
                          className="accent-[#e5a93c]"
                        />
                        <span>Auto-Center</span>
                      </label>
                    </div>
                  </div>
                )}

                {/* Campaign Contracts C0-C6 */}
                <div data-augmented-ui="br-clip border inlay" className="voss-panel p-4 space-y-2.5">
                  <div className="flex items-center justify-between font-mono text-[10px] font-bold uppercase tracking-[0.24em] text-[#ff3b30]">
                    <span>CAMPAIGN CONTRACTS (C0–C6)</span>
                    <span className="text-[#8a909e]">BEACON [G]</span>
                  </div>
                  <div className="max-h-52 space-y-1.5 overflow-y-auto pr-1">
                    {WESTGATE_CONTRACT_SPOTS.map((spot) => {
                      const cm = MISSIONS.find((mi) => mi.id === spot.missionId);
                      if (!cm) return null;
                      const unlocked = cm.id <= Math.max(1, save.unlocked);
                      const cleared = !!save.records[cm.id]?.completed;
                      const gpsId = `contract:${cm.id}`;
                      const isGps = gpsTargetId === gpsId;
                      return (
                        <div
                          key={cm.id}
                          className="flex items-center justify-between gap-1.5 border border-white/10 bg-black/35 px-2.5 py-1.5"
                        >
                          <div className="min-w-0 flex-1">
                            <div className="truncate font-mono text-[11px] font-bold text-[#f2efe9]">
                              <span className="text-[#ff3b30]">C{cm.id}</span> · {cm.codename}
                              {cleared && <span className="ml-1.5 text-[9px] text-[#2dd4bf]">✓</span>}
                            </div>
                            <div className="truncate text-[10px] text-[#8a909e]">{spot.districtLabel}</div>
                          </div>
                          <button
                            type="button"
                            onClick={() => {
                              setGpsTargetId(isGps ? null : gpsId);
                              gameRef.current?.setPaused(false);
                            }}
                            className={`cursor-pointer border px-1.5 py-1 font-mono text-[9px] font-bold uppercase ${
                              isGps
                                ? "border-[#38bdf8] bg-[#38bdf8]/20 text-[#38bdf8]"
                                : "border-white/10 text-[#8a909e] hover:border-[#38bdf8] hover:text-[#38bdf8]"
                            }`}
                          >
                            GPS
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              gameRef.current?.teleportTo(spot.x, spot.z + 6, spot.yawDeg);
                              gameRef.current?.setPaused(false);
                            }}
                            className="cursor-pointer border border-white/10 px-1.5 py-1 font-mono text-[9px] font-bold uppercase text-[#cfd4de] hover:border-white/40"
                          >
                            Warp
                          </button>
                          <button
                            type="button"
                            disabled={!unlocked}
                            onClick={() => gameRef.current?.launchContractFromOpenWorld(cm.id)}
                            className={`cursor-pointer px-2 py-1 font-mono text-[9px] font-black uppercase ${
                              unlocked
                                ? "bg-[#ff3b30] text-[#07080b] hover:brightness-110"
                                : "cursor-not-allowed bg-white/5 text-[#5e6472]"
                            }`}
                          >
                            {unlocked ? "Play" : "Lock"}
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Quick Summon Cars + Sector Fast Travel */}
                <div className="space-y-4">
                  <div data-augmented-ui="br-clip border inlay" className="voss-panel p-4 space-y-2.5">
                    <div className="flex items-center justify-between font-mono text-[10px] font-bold uppercase tracking-[0.24em] text-[#2dd4bf]">
                      <span>SUMMON VEHICLE</span>
                      <span className="text-[#e5a93c]">{hud.credits} CR</span>
                    </div>
                    <div className="grid max-h-28 grid-cols-2 gap-1.5 overflow-y-auto pr-1">
                      {CARS.map((car) => {
                        const owned = save.ownedCars.includes(car.id);
                        const canBuy = hud.credits >= car.price;
                        return (
                          <button
                            key={car.id}
                            disabled={!owned && !canBuy}
                            onClick={() => {
                              if (owned) {
                                onSelectCar(car.id);
                              } else {
                                onBuyCar(car.id);
                              }
                              gameRef.current?.setPaused(false);
                            }}
                            className={`flex cursor-pointer items-center justify-between border px-2 py-1.5 text-left font-mono text-[10px] transition ${
                              owned
                                ? save.selectedCar === car.id
                                  ? "border-[#2dd4bf] bg-[#2dd4bf]/15 text-[#2dd4bf]"
                                  : "border-white/12 bg-white/[0.04] text-[#f2efe9] hover:border-[#2dd4bf]/60"
                                : canBuy
                                  ? "border-[#e5a93c]/45 bg-[#e5a93c]/10 text-[#e5a93c] hover:bg-[#e5a93c]/20"
                                  : "cursor-not-allowed border-white/5 text-[#5e6472]"
                            }`}
                          >
                            <span className="truncate">{car.name}</span>
                            <span className="ml-1 shrink-0 text-[9px] uppercase">
                              {owned ? "Call" : `${car.price}`}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <div data-augmented-ui="br-clip border inlay" className="voss-panel p-4 space-y-2.5">
                    <div className="flex items-center justify-between font-mono text-[10px] font-bold uppercase tracking-[0.24em] text-[#38bdf8]">
                      <span className="inline-flex items-center gap-1.5">
                        <MapPin className="size-3" /> SECTOR FAST-TRAVEL &amp; GPS
                      </span>
                      {gpsTargetId && (
                        <button
                          type="button"
                          onClick={() => setGpsTargetId(null)}
                          className="cursor-pointer text-[9px] text-[#38bdf8] underline"
                        >
                          CLEAR GPS
                        </button>
                      )}
                    </div>
                    <div className="grid max-h-28 grid-cols-2 gap-1.5 overflow-y-auto pr-1">
                      {WESTGATE_TELEPORTS.map((spot) => {
                        const isGps = gpsTargetId === spot.id;
                        return (
                          <div key={spot.id} className="flex items-stretch gap-1">
                            <button
                              onClick={() => {
                                gameRef.current?.teleportTo(spot.x, spot.z, spot.yawDeg);
                                gameRef.current?.setPaused(false);
                              }}
                              className="min-w-0 flex-1 cursor-pointer truncate border border-white/10 bg-white/[0.04] px-2 py-1 text-left font-mono text-[10px] text-[#f2efe9] hover:border-[#38bdf8]"
                              title={`Teleport to ${spot.label}`}
                            >
                              {spot.label}
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setGpsTargetId(isGps ? null : spot.id);
                                gameRef.current?.setPaused(false);
                              }}
                              className={`cursor-pointer border px-1.5 font-mono text-[9px] font-bold uppercase ${
                                isGps
                                  ? "border-[#38bdf8] bg-[#38bdf8]/20 text-[#38bdf8]"
                                  : "border-white/10 text-[#8a909e] hover:border-[#38bdf8]"
                              }`}
                            >
                              <Navigation className="size-2.5" />
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex h-full items-center justify-center">
                <DossierShell tone="ghost" className="max-w-md space-y-3">
                  <div className="font-mono text-[10px] font-bold uppercase tracking-[0.28em] text-[#ff3b30]">
                    ACTIVE CONTRACT TELEMETRY
                  </div>
                  <div className="font-display text-3xl font-extrabold uppercase text-[#f2efe9]">
                    {hud.mission?.codename} · {hud.mission?.name}
                  </div>
                  <p className="text-xs leading-relaxed text-[#8a909e]">
                    {hud.mission?.location} · {hud.mission?.timeOfDay}. Remain undetected for Ghost extraction bonus.
                  </p>
                  <div className="grid grid-cols-3 gap-3 border-t border-white/10 pt-3 font-mono text-xs">
                    <div>
                      <div className="text-[9px] text-[#8a909e]">ELIMINATED</div>
                      <div className="font-bold text-[#f2efe9]">{hud.kills}</div>
                    </div>
                    <div>
                      <div className="text-[9px] text-[#8a909e]">STEALTH</div>
                      <div className="font-bold text-[#2dd4bf]">{hud.stealthKills}</div>
                    </div>
                    <div>
                      <div className="text-[9px] text-[#8a909e]">ALERTS</div>
                      <div className="font-bold text-[#ff3b30]">{hud.alerts}</div>
                    </div>
                  </div>
                </DossierShell>
              </div>
            )}
          </main>
        </div>
      )}
    </>
  );
}
