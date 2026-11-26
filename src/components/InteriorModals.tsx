import { useState } from "react";
import {
  Building2,
  Car,
  Check,
  Coins,
  Crosshair,
  Gauge,
  Paintbrush,
  RotateCcw,
  Shield,
  Shirt,
  Sparkles,
  Wrench,
  X,
} from "lucide-react";
import { CarPreview3D } from "./CarPreview3D";
import {
  APARTMENTS,
  CAR_TUNING_COSTS,
  DEFAULT_APPEARANCE,
  DEFAULT_WEAPON_CONFIGS,
  UPGRADES,
  canAfford,
  getCarCustomConfig,
  getUpgradeLevel,
  getWeaponCustomConfig,
  getWeaponModEffects,
  type ApartmentId,
  type CarCustomConfig,
  type CarPaintFinish,
  type CarTrimFinish,
  type SaveData,
  type SoldierAppearance,
  type WeaponCustomConfig,
  type WeaponPartFinish,
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
import { characterPreview, getSuitPreset, SUIT_PRESETS } from "../game/characters";
import {
  BOSS_TAUNTS,
  STORYLINE_CHAPTERS,
  getNextStoryChapter,
  isStoryChapterCompleted,
  type StoryChapterDef,
} from "../game/story";
import { getMissionConsequences } from "../game/progression";

export type HomeModalKind = "garage_mod" | "weapon_bench" | "closet" | "apt_buy" | "intel_board";

const RIM_COLORS = [
  { name: "Alloy Silver", hex: "#c8cdd6" },
  { name: "Gloss Black", hex: "#171a20" },
  { name: "Champagne Gold", hex: "#d4af37" },
  { name: "Satin Bronze", hex: "#9c7448" },
  { name: "Gunmetal", hex: "#525b68" },
  { name: "Crimson Edge", hex: "#b91c1c" },
];

const PAINT_FINISHES: { id: CarPaintFinish; label: string }[] = [
  { id: "metallic", label: "Metallic" },
  { id: "gloss", label: "Deep Gloss" },
  { id: "matte", label: "Stealth Matte" },
  { id: "chrome", label: "Mirror Chrome" },
];

const TRIM_FINISHES: { id: CarTrimFinish; label: string }[] = [
  { id: "black", label: "Shadow Black" },
  { id: "chrome", label: "Bright Chrome" },
  { id: "carbon", label: "Carbon Weave" },
  { id: "bronze", label: "Satin Bronze" },
];

const WINDOW_TINTS = [
  { label: "Clear (0%)", val: 0.0 },
  { label: "Light Smoke (35%)", val: 0.35 },
  { label: "Dark Privacy (68%)", val: 0.68 },
  { label: "Limo Black (95%)", val: 0.95 },
];

interface InteriorModalsProps {
  modal: HomeModalKind;
  apartmentId?: ApartmentId;
  carId?: CarId;
  save: SaveData;
  characterId: string;
  onClose: () => void;
  onDriveOut?: (carId: CarId) => void;
  onBuyCar: (carId: CarId) => void;
  onSelectCar: (carId: CarId, paintHex?: string | null) => void;
  onUpdateCarCustom: (carId: CarId, patch: Partial<Omit<CarCustomConfig, "engineLevel" | "handlingLevel" | "brakeLevel">>) => void;
  onUpgradeCarTuning: (carId: CarId, stat: "engine" | "handling" | "brake") => void;
  onUpdateWeaponConfig: (slot: WeaponSlotId, patch: Partial<WeaponCustomConfig>) => void;
  onPurchaseUpgrade: (id: string) => void;
  onSelectCharacter: (id: string) => void;
  onUpdateAppearance: (patch: Partial<SoldierAppearance>) => void;
  onBuyAndEnterApartment: (id: ApartmentId) => void;
  onStartStoryChapter?: (ch: StoryChapterDef) => void;
}

export function InteriorModals({
  modal,
  apartmentId,
  carId,
  save,
  characterId: _characterId,
  onClose,
  onDriveOut,
  onBuyCar,
  onSelectCar,
  onUpdateCarCustom,
  onUpgradeCarTuning,
  onUpdateWeaponConfig,
  onPurchaseUpgrade,
  onSelectCharacter: _onSelectCharacter,
  onUpdateAppearance,
  onBuyAndEnterApartment,
  onStartStoryChapter,
}: InteriorModalsProps) {
  const [garageTab, setGarageTab] = useState<"paint" | "tuning" | "fleet">("paint");
  const [weaponSlot, setWeaponSlot] = useState<WeaponSlotId>("pistol");
  const [weaponTab, setWeaponTab] = useState<"parts" | "finish" | "upgrades">("parts");
  const activeSuit = getSuitPreset(save.appearance.suitPreset);
  const nextStoryCh = getNextStoryChapter(save);
  const nextConseq = nextStoryCh.missionId ? getMissionConsequences(save, nextStoryCh.missionId) : undefined;

  const activeCarId = carId ?? save.selectedCar;
  const activeCar = CARS.find((c) => c.id === activeCarId) ?? CARS[0];
  const carCustom = getCarCustomConfig(save, activeCarId);

  const wCfg = getWeaponCustomConfig(save, weaponSlot);
  const wMods = getWeaponModEffects(wCfg);
  const aptDef = apartmentId ? APARTMENTS.find((a) => a.id === apartmentId) : undefined;

  return (
    <div className="pointer-events-auto fixed inset-0 z-50 flex items-center justify-center bg-black/72 p-4 backdrop-blur-md">
      {/* ==================== 1. OVERTAKE GARAGE CAR CUSTOMIZER ==================== */}
      {modal === "garage_mod" && (
        <div className="flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-cyan-400/35 bg-[#0b1019]/96 text-[#f2efe9] shadow-[0_28px_90px_rgba(0,0,0,0.85)]">
          <div className="flex items-center justify-between border-b border-white/10 bg-[#101826] px-6 py-4">
            <div className="flex items-center gap-3">
              <div className="flex size-10 items-center justify-center rounded-xl border border-cyan-400/40 bg-cyan-500/15 text-cyan-300">
                <Car className="size-5" />
              </div>
              <div>
                <div className="font-mono text-[10px] uppercase tracking-[0.26em] text-cyan-300">
                  Overtake Customs · {aptDef ? `${aptDef.name} Multi-Car Garage` : "420 Crescent 1-Car Garage"}
                </div>
                <h2 className="font-display text-2xl font-bold uppercase tracking-wide">
                  {activeCar.maker} {activeCar.name}
                </h2>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-1.5 rounded-lg border border-amber-400/35 bg-amber-500/10 px-3 py-1.5 font-mono text-xs font-bold text-amber-300">
                <Coins className="size-3.5" /> {save.currencies.credits} CR
              </div>
              {onDriveOut && (
                <button
                  onClick={() => onDriveOut(activeCarId)}
                  className="flex cursor-pointer items-center gap-1.5 rounded-lg border border-cyan-400 bg-cyan-500/25 px-3.5 py-1.5 font-mono text-xs font-bold uppercase tracking-wider text-cyan-100 hover:bg-cyan-500/35"
                >
                  <Car className="size-4" /> Drive Car Out
                </button>
              )}
              <button
                onClick={onClose}
                className="flex cursor-pointer items-center gap-1.5 rounded-lg border border-white/15 bg-white/5 px-3 py-1.5 font-mono text-xs uppercase tracking-wider text-white/80 hover:border-white/40 hover:text-white"
              >
                <X className="size-4" /> Close
              </button>
            </div>
          </div>

          <div className="flex gap-2 border-b border-white/10 bg-[#0d1420] px-6 py-2.5">
            {[
              { id: "paint" as const, label: "Paint, Rims & Tint", icon: Paintbrush },
              { id: "tuning" as const, label: "Overtake Performance Tuning", icon: Gauge },
              { id: "fleet" as const, label: `Motorpool (${save.ownedCars.length}/${CARS.length})`, icon: Car },
            ].map((t) => (
              <button
                key={t.id}
                onClick={() => setGarageTab(t.id)}
                className={`flex cursor-pointer items-center gap-2 rounded-lg border px-4 py-2 font-mono text-[11px] font-bold uppercase tracking-[0.18em] transition ${
                  garageTab === t.id
                    ? "border-cyan-400 bg-cyan-500/20 text-cyan-200"
                    : "border-white/10 bg-white/[0.03] text-[#8a909e] hover:border-white/25 hover:text-white"
                }`}
              >
                <t.icon className="size-3.5" /> {t.label}
              </button>
            ))}
          </div>

          <div className="flex-1 overflow-y-auto p-6 space-y-5">
            <CarPreview3D
              carId={activeCarId}
              paintHex={carCustom.paintHex ?? activeCar.color}
              custom={carCustom}
              label={`${activeCar.maker} ${activeCar.name}`}
              className="h-48 w-full rounded-xl"
            />
            {garageTab === "paint" && (
              <div className="grid gap-6 md:grid-cols-2">
                <div className="space-y-5">
                  <div>
                    <div className="mb-2 flex items-center justify-between font-mono text-[10px] uppercase tracking-[0.22em] text-[#9aa5b8]">
                      <span>Body Paint Color</span>
                      <button
                        onClick={() => onUpdateCarCustom(activeCarId, { paintHex: undefined })}
                        className="cursor-pointer text-cyan-300 hover:underline"
                      >
                        Reset Factory
                      </button>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {PAINT_COLORS.map((p) => {
                        const active = (carCustom.paintHex ?? "").toLowerCase() === p.hex.toLowerCase();
                        return (
                          <button
                            key={p.hex}
                            title={p.name}
                            onClick={() => onUpdateCarCustom(activeCarId, { paintHex: p.hex })}
                            className={`size-8 cursor-pointer rounded-lg border-2 transition ${
                              active ? "scale-110 border-cyan-300 shadow-[0_0_12px_rgba(34,211,238,0.6)]" : "border-white/20 hover:border-white/60"
                            }`}
                            style={{ backgroundColor: p.hex }}
                          />
                        );
                      })}
                    </div>
                  </div>

                  <div>
                    <div className="mb-2 font-mono text-[10px] uppercase tracking-[0.22em] text-[#9aa5b8]">
                      Paint Finish Coat
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      {PAINT_FINISHES.map((f) => (
                        <button
                          key={f.id}
                          onClick={() => onUpdateCarCustom(activeCarId, { paintFinish: f.id })}
                          className={`cursor-pointer rounded-lg border px-3 py-2 text-left font-mono text-xs transition ${
                            carCustom.paintFinish === f.id
                              ? "border-cyan-400 bg-cyan-500/20 text-white"
                              : "border-white/10 bg-white/[0.03] text-[#9aa5b8] hover:border-white/30"
                          }`}
                        >
                          {f.label}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="space-y-5">
                  <div>
                    <div className="mb-2 font-mono text-[10px] uppercase tracking-[0.22em] text-[#9aa5b8]">
                      Wheel Rim Finish
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {RIM_COLORS.map((r) => {
                        const active = carCustom.rimColor.toLowerCase() === r.hex.toLowerCase();
                        return (
                          <button
                            key={r.hex}
                            onClick={() => onUpdateCarCustom(activeCarId, { rimColor: r.hex })}
                            className={`flex cursor-pointer items-center gap-2 rounded-lg border px-2.5 py-1.5 font-mono text-[11px] transition ${
                              active ? "border-cyan-400 bg-cyan-500/20 text-white" : "border-white/10 bg-white/[0.03] text-[#9aa5b8]"
                            }`}
                          >
                            <span className="size-3.5 rounded-full border border-white/30" style={{ backgroundColor: r.hex }} />
                            {r.name}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <div>
                    <div className="mb-2 font-mono text-[10px] uppercase tracking-[0.22em] text-[#9aa5b8]">
                      Window Tint
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      {WINDOW_TINTS.map((t) => {
                        const active = Math.abs(carCustom.windowTint - t.val) < 0.08;
                        return (
                          <button
                            key={t.label}
                            onClick={() => onUpdateCarCustom(activeCarId, { windowTint: t.val })}
                            className={`cursor-pointer rounded-lg border px-3 py-2 text-left font-mono text-xs transition ${
                              active ? "border-cyan-400 bg-cyan-500/20 text-white" : "border-white/10 bg-white/[0.03] text-[#9aa5b8]"
                            }`}
                          >
                            {t.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <div>
                    <div className="mb-2 font-mono text-[10px] uppercase tracking-[0.22em] text-[#9aa5b8]">
                      Aero Trim &amp; Carbon Trim
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      {TRIM_FINISHES.map((tr) => (
                        <button
                          key={tr.id}
                          onClick={() => onUpdateCarCustom(activeCarId, { trimFinish: tr.id })}
                          className={`cursor-pointer rounded-lg border px-3 py-2 text-left font-mono text-xs transition ${
                            carCustom.trimFinish === tr.id
                              ? "border-cyan-400 bg-cyan-500/20 text-white"
                              : "border-white/10 bg-white/[0.03] text-[#9aa5b8]"
                          }`}
                        >
                          {tr.label}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {garageTab === "tuning" && (
              <div className="space-y-4">
                <div className="grid gap-3 rounded-xl border border-white/10 bg-black/30 p-4 sm:grid-cols-3">
                  <div>
                    <div className="font-mono text-[10px] uppercase tracking-wider text-[#9aa5b8]">Top Speed</div>
                    <div className="mt-1 font-display text-2xl font-bold text-cyan-300">
                      {Math.round(activeCar.maxSpeed * 3.6 * (1 + carCustom.engineLevel * 0.11))} KM/H
                    </div>
                  </div>
                  <div>
                    <div className="font-mono text-[10px] uppercase tracking-wider text-[#9aa5b8]">Acceleration</div>
                    <div className="mt-1 font-display text-2xl font-bold text-emerald-300">
                      {(activeCar.accel * (1 + carCustom.engineLevel * 0.14)).toFixed(1)} m/s²
                    </div>
                  </div>
                  <div>
                    <div className="font-mono text-[10px] uppercase tracking-wider text-[#9aa5b8]">Lateral Grip</div>
                    <div className="mt-1 font-display text-2xl font-bold text-amber-300">
                      {(activeCar.physics.grip * (1 + carCustom.handlingLevel * 0.10)).toFixed(2)} G
                    </div>
                  </div>
                </div>

                {(
                  [
                    {
                      stat: "engine" as const,
                      title: "Overtake Twin-Turbo & ECU Tune",
                      desc: "+11% Top Speed & +14% Acceleration per stage",
                      level: carCustom.engineLevel,
                    },
                    {
                      stat: "handling" as const,
                      title: "Track Coilovers & Aero Grip",
                      desc: "+10% Cornering Grip & +12% Steering Response per stage",
                      level: carCustom.handlingLevel,
                    },
                    {
                      stat: "brake" as const,
                      title: "Carbon-Ceramic Brake Kit",
                      desc: "+16% Stopping Power per stage",
                      level: carCustom.brakeLevel,
                    },
                  ]
                ).map((item) => {
                  const maxed = item.level >= 3;
                  const cost = maxed ? 0 : CAR_TUNING_COSTS[item.stat][item.level];
                  const affordable = save.currencies.credits >= cost;
                  return (
                    <div
                      key={item.stat}
                      className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-white/10 bg-white/[0.03] p-4"
                    >
                      <div>
                        <div className="font-display text-lg font-bold uppercase">{item.title}</div>
                        <div className="text-xs text-[#9aa5b8]">{item.desc}</div>
                        <div className="mt-2 flex gap-1.5">
                          {[0, 1, 2].map((s) => (
                            <span
                              key={s}
                              className={`h-2 w-8 rounded-full ${
                                s < item.level ? "bg-cyan-400" : "bg-white/15"
                              }`}
                            />
                          ))}
                        </div>
                      </div>
                      <button
                        disabled={maxed || !affordable}
                        onClick={() => onUpgradeCarTuning(activeCarId, item.stat)}
                        className={`cursor-pointer rounded-lg border px-4 py-2 font-mono text-xs font-bold uppercase tracking-wider transition ${
                          maxed
                            ? "border-emerald-400/40 bg-emerald-500/15 text-emerald-300"
                            : affordable
                              ? "border-cyan-400 bg-cyan-500/20 text-cyan-200 hover:bg-cyan-500/30"
                              : "cursor-not-allowed border-white/10 bg-white/5 text-white/35"
                        }`}
                      >
                        {maxed ? "Stage 3 Maxed" : `Upgrade Stage ${item.level + 1} · ${cost} Cr`}
                      </button>
                    </div>
                  );
                })}
              </div>
            )}

            {garageTab === "fleet" && (
              <div className="grid gap-3 sm:grid-cols-2">
                {CARS.map((c) => {
                  const owned = save.ownedCars.includes(c.id);
                  const active = save.selectedCar === c.id;
                  const canBuy = save.currencies.credits >= c.price;
                  return (
                    <div
                      key={c.id}
                      className={`flex flex-col justify-between rounded-xl border p-4 transition ${
                        active
                          ? "border-cyan-400 bg-cyan-500/12"
                          : "border-white/10 bg-white/[0.03]"
                      }`}
                    >
                      <div>
                        <div className="flex items-center justify-between">
                          <span className="font-mono text-[10px] uppercase tracking-wider text-cyan-300">{c.maker} · {c.klass}</span>
                          <span className="font-mono text-xs font-bold text-amber-300">
                            {owned ? (active ? "ACTIVE IN BAY" : "OWNED") : `${c.price} CR`}
                          </span>
                        </div>
                        <div className="mt-1 font-display text-xl font-bold uppercase">{c.name}</div>
                        <p className="mt-1 text-xs text-[#9aa5b8]">{c.tagline}</p>
                      </div>
                      <div className="mt-3">
                        {owned ? (
                          <button
                            onClick={() => onSelectCar(c.id)}
                            className={`w-full cursor-pointer rounded-lg border py-2 font-mono text-xs font-bold uppercase ${
                              active
                                ? "border-cyan-400/50 bg-cyan-500/20 text-cyan-200"
                                : "border-white/20 bg-white/10 text-white hover:border-cyan-300"
                            }`}
                          >
                            {active ? "Parked in Mod Bay" : "Pull Into Mod Bay"}
                          </button>
                        ) : (
                          <button
                            disabled={!canBuy}
                            onClick={() => onBuyCar(c.id)}
                            className={`w-full cursor-pointer rounded-lg border py-2 font-mono text-xs font-bold uppercase ${
                              canBuy
                                ? "border-amber-400 bg-amber-500/20 text-amber-200 hover:bg-amber-500/30"
                                : "cursor-not-allowed border-white/10 bg-white/5 text-white/35"
                            }`}
                          >
                            Buy Vehicle · {c.price} Cr
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ==================== 2. WEAPON WORKBENCH MODAL ==================== */}
      {modal === "weapon_bench" && (
        <div className="flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-amber-400/35 bg-[#0b1019]/96 text-[#f2efe9] shadow-[0_28px_90px_rgba(0,0,0,0.85)]">
          <div className="flex items-center justify-between border-b border-white/10 bg-[#12161f] px-6 py-4">
            <div className="flex items-center gap-3">
              <div className="flex size-10 items-center justify-center rounded-xl border border-amber-400/40 bg-amber-500/15 text-amber-300">
                <Wrench className="size-5" />
              </div>
              <div>
                <div className="font-mono text-[10px] uppercase tracking-[0.26em] text-amber-300">
                  Safehouse Gunsmith Workbench
                </div>
                <h2 className="font-display text-2xl font-bold uppercase tracking-wide">
                  Modular Armory &amp; Ballistics Bench
                </h2>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <div className="rounded-lg border border-amber-400/30 bg-amber-500/10 px-3 py-1.5 font-mono text-xs font-bold text-amber-300">
                {save.currencies.credits} CR · {save.currencies.salvage} SLV · {save.currencies.intel} INT
              </div>
              <button
                onClick={onClose}
                className="flex cursor-pointer items-center gap-1.5 rounded-lg border border-white/15 bg-white/5 px-3 py-1.5 font-mono text-xs uppercase text-white/85 hover:border-white/40"
              >
                <X className="size-4" /> Close
              </button>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/10 bg-[#0d121a] px-6 py-2.5">
            <div className="flex gap-1.5">
              {WEAPONS.map((w) => (
                <button
                  key={w.id}
                  onClick={() => setWeaponSlot(w.id)}
                  className={`cursor-pointer rounded-lg border px-3 py-1.5 font-mono text-xs font-bold uppercase transition ${
                    weaponSlot === w.id
                      ? "border-amber-400 bg-amber-500/20 text-amber-200"
                      : "border-white/10 bg-white/[0.03] text-[#8a909e] hover:text-white"
                  }`}
                >
                  {w.shortName}
                </button>
              ))}
            </div>
            <div className="flex gap-1.5">
              {[
                { id: "parts" as const, label: "Attachments", icon: Crosshair },
                { id: "finish" as const, label: "Cerakote Finish", icon: Paintbrush },
                { id: "upgrades" as const, label: "Upgrades", icon: Shield },
              ].map((t) => (
                <button
                  key={t.id}
                  onClick={() => setWeaponTab(t.id)}
                  className={`flex cursor-pointer items-center gap-1.5 rounded-lg border px-3 py-1.5 font-mono text-[11px] font-bold uppercase ${
                    weaponTab === t.id
                      ? "border-cyan-400 bg-cyan-500/20 text-cyan-200"
                      : "border-white/10 bg-white/[0.03] text-[#8a909e]"
                  }`}
                >
                  <t.icon className="size-3.5" /> {t.label}
                </button>
              ))}
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-6">
            {weaponTab === "parts" && (
              <div className="grid gap-5 md:grid-cols-2">
                <div className="rounded-xl border border-white/10 bg-black/30 p-4 md:col-span-2">
                  <div className="flex flex-wrap items-center justify-between gap-4 font-mono text-xs">
                    <span>Mag Capacity: <b className="text-amber-300">{(wMods.magMult * 100).toFixed(0)}%</b></span>
                    <span>Recoil Mult: <b className="text-cyan-300">{(wMods.recoilMult * 100).toFixed(0)}%</b></span>
                    <span>Spread Mult: <b className="text-emerald-300">{(wMods.spreadMult * 100).toFixed(0)}%</b></span>
                    <span>Zoom Bonus: <b className="text-white">{wMods.adsFovBonus}°</b></span>
                    <span>Suppressed: <b className={wMods.suppressed ? "text-emerald-300" : "text-rose-300"}>{wMods.suppressed ? "YES" : "NO"}</b></span>
                    <button
                      onClick={() => onUpdateWeaponConfig(weaponSlot, DEFAULT_WEAPON_CONFIGS[weaponSlot])}
                      className="flex cursor-pointer items-center gap-1 text-[#9aa5b8] hover:text-white"
                    >
                      <RotateCcw className="size-3.5" /> Reset Weapon
                    </button>
                  </div>
                </div>

                {[
                  { title: "Optic / Sight", key: "optic" as const, opts: WEAPON_OPTIC_OPTS },
                  { title: "Muzzle Device", key: "muzzle" as const, opts: WEAPON_MUZZLE_OPTS },
                  { title: "Underbarrel Grip", key: "underbarrel" as const, opts: WEAPON_UNDERBARREL_OPTS },
                  { title: "Magazine Feed", key: "magazine" as const, opts: WEAPON_MAG_OPTS },
                ].map((grp) => (
                  <div key={grp.key} className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
                    <div className="mb-2.5 font-mono text-[10px] uppercase tracking-[0.22em] text-amber-300">{grp.title}</div>
                    <div className="grid grid-cols-2 gap-2">
                      {grp.opts.map((opt) => {
                        const active = wCfg[grp.key] === opt.id;
                        return (
                          <button
                            key={opt.id}
                            onClick={() => onUpdateWeaponConfig(weaponSlot, { [grp.key]: opt.id })}
                            className={`cursor-pointer rounded-lg border px-3 py-2 text-left transition ${
                              active
                                ? "border-amber-400 bg-amber-500/20 text-white"
                                : "border-white/10 bg-black/30 text-[#9aa5b8] hover:border-white/30"
                            }`}
                          >
                            <div className="font-mono text-xs font-bold">{opt.label}</div>
                            <div className="mt-0.5 text-[10px] opacity-80">{opt.note}</div>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {weaponTab === "finish" && (
              <div className="grid gap-5 md:grid-cols-2">
                {(
                  [
                    { label: "Receiver / Body Cerakote", key: "bodyFinish" as const },
                    { label: "Handguard & Stock Accent", key: "accentFinish" as const },
                    { label: "Hardware & Barrel Finish", key: "hardwareFinish" as const },
                  ]
                ).map((sec) => (
                  <div key={sec.key} className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
                    <div className="mb-2.5 font-mono text-[10px] uppercase tracking-[0.22em] text-cyan-300">{sec.label}</div>
                    <div className="grid grid-cols-2 gap-2">
                      {WEAPON_PART_FINISHES.map((fin) => {
                        const active = wCfg[sec.key] === fin.id;
                        return (
                          <button
                            key={fin.id}
                            onClick={() => onUpdateWeaponConfig(weaponSlot, { [sec.key]: fin.id as WeaponPartFinish })}
                            className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 font-mono text-xs ${
                              active ? "border-cyan-400 bg-cyan-500/20 text-white" : "border-white/10 bg-black/30 text-[#9aa5b8]"
                            }`}
                          >
                            <span className="size-3.5 rounded-full border border-white/30" style={{ backgroundColor: fin.swatch }} />
                            {fin.name}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}

                <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
                  <div className="mb-2.5 font-mono text-[10px] uppercase tracking-[0.22em] text-cyan-300">Optic Reticle Illumination</div>
                  <div className="flex flex-wrap gap-2">
                    {WEAPON_RETICLE_COLORS.map((rc) => {
                      const active = wCfg.reticleColor.toLowerCase() === rc.hex.toLowerCase();
                      return (
                        <button
                          key={rc.hex}
                          onClick={() => onUpdateWeaponConfig(weaponSlot, { reticleColor: rc.hex })}
                          className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 font-mono text-xs ${
                            active ? "border-cyan-400 bg-cyan-500/20 text-white" : "border-white/10 bg-black/30 text-[#9aa5b8]"
                          }`}
                        >
                          <span className="size-3.5 rounded-full" style={{ backgroundColor: rc.hex }} />
                          {rc.name}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}

            {weaponTab === "upgrades" && (
              <div className="grid gap-3 md:grid-cols-2">
                {UPGRADES.map((u) => {
                  const lvl = getUpgradeLevel(save, u.id);
                  const maxed = lvl >= u.maxLevel;
                  const cost = maxed ? {} : u.costs[lvl];
                  const affordable = !maxed && canAfford(save.currencies, cost);
                  return (
                    <div key={u.id} className="flex flex-col justify-between rounded-xl border border-white/10 bg-white/[0.03] p-4">
                      <div>
                        <div className="flex items-center justify-between">
                          <span className="font-mono text-[10px] uppercase tracking-wider text-amber-300">{u.category}</span>
                          <span className="font-mono text-xs text-white/75">Tier {lvl}/{u.maxLevel}</span>
                        </div>
                        <div className="mt-1 font-display text-lg font-bold uppercase">{u.name}</div>
                        <p className="mt-1 text-xs text-[#9aa5b8]">{u.subtitle}</p>
                      </div>
                      <button
                        disabled={maxed || !affordable}
                        onClick={() => onPurchaseUpgrade(u.id)}
                        className={`mt-3 cursor-pointer rounded-lg border py-2 font-mono text-xs font-bold uppercase ${
                          maxed
                            ? "border-emerald-400/40 bg-emerald-500/15 text-emerald-300"
                            : affordable
                              ? "border-amber-400 bg-amber-500/20 text-amber-200 hover:bg-amber-500/30"
                              : "cursor-not-allowed border-white/10 bg-white/5 text-white/35"
                        }`}
                      >
                        {maxed
                          ? "MAXED"
                          : `Upgrade · ${cost.credits ?? 0} Cr ${cost.salvage ? `· ${cost.salvage} Slv` : ""} ${cost.intel ? `· ${cost.intel} Int` : ""}`}
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ==================== 3. WARDROBE CLOSET / CHARACTER CUSTOMIZER ==================== */}
      {modal === "closet" && (
        <div className="flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-emerald-400/35 bg-[#0b1019]/96 text-[#f2efe9] shadow-[0_28px_90px_rgba(0,0,0,0.85)]">
          <div className="flex items-center justify-between border-b border-white/10 bg-[#101824] px-6 py-4">
            <div className="flex items-center gap-3">
              <div className="flex size-10 items-center justify-center rounded-xl border border-emerald-400/40 bg-emerald-500/15 text-emerald-300">
                <Shirt className="size-5" />
              </div>
              <div>
                <div className="font-mono text-[10px] uppercase tracking-[0.26em] text-emerald-300">
                  Walk-In Wardrobe Closet · Julian Voss
                </div>
                <h2 className="font-display text-2xl font-bold uppercase tracking-wide">
                  Tailored Suits &amp; Assassin Gloves
                </h2>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => onUpdateAppearance({ ...DEFAULT_APPEARANCE })}
                className="flex cursor-pointer items-center gap-1.5 rounded-lg border border-white/15 bg-white/5 px-3 py-1.5 font-mono text-xs uppercase text-white/75 hover:text-white"
              >
                <RotateCcw className="size-3.5" /> Reset
              </button>
              <button
                onClick={onClose}
                className="flex cursor-pointer items-center gap-1.5 rounded-lg border border-white/15 bg-white/5 px-3 py-1.5 font-mono text-xs uppercase text-white/85 hover:border-white/40"
              >
                <X className="size-4" /> Close
              </button>
            </div>
          </div>

          <div className="flex items-center justify-between border-b border-white/10 bg-[#0d1420] px-6 py-3">
            <div className="flex items-center gap-3">
              <img
                src={characterPreview("business")}
                alt="Julian Voss"
                className="h-10 w-10 rounded-lg border border-emerald-400/40 object-cover object-top"
              />
              <div className="text-xs text-[#9aa5b8]">
                <span className="font-bold text-white">Active Suit:</span>{" "}
                <span className="text-emerald-300">{activeSuit.name}</span> · {activeSuit.gloveLabel}
              </div>
            </div>
            <span className="font-mono text-[10px] uppercase tracking-wider text-[#64748b]">
              {SUIT_PRESETS.length} Curated Combos
            </span>
          </div>

          <div className="flex-1 overflow-y-auto p-6">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {SUIT_PRESETS.map((preset) => {
                const selected = activeSuit.id === preset.id;
                return (
                  <button
                    key={preset.id}
                    onClick={() => onUpdateAppearance({ suitPreset: preset.id })}
                    className={`flex cursor-pointer items-center gap-3.5 rounded-xl border p-3.5 text-left transition ${
                      selected
                        ? "border-emerald-400 bg-emerald-500/15"
                        : "border-white/10 bg-black/30 hover:border-white/35"
                    }`}
                  >
                    <div className="flex h-12 w-12 shrink-0 overflow-hidden rounded-lg border border-white/20">
                      <div className="h-full w-5" style={{ backgroundColor: preset.suitColor }} />
                      <div className="h-full w-2.5" style={{ backgroundColor: preset.shirtColor }} />
                      <div className="h-full w-2" style={{ backgroundColor: preset.tieColor }} />
                      <div className="h-full flex-1" style={{ backgroundColor: preset.gloveColor }} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate font-display text-base font-bold uppercase text-white">
                          {preset.name}
                        </span>
                        {selected && <Check className="size-4 shrink-0 text-emerald-400" />}
                      </div>
                      <div className="truncate text-[11px] text-[#cbd5e1]">{preset.subtitle}</div>
                      <div className="mt-0.5 truncate font-mono text-[9px] uppercase tracking-wider text-emerald-300/80">
                        {preset.gloveLabel}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* ==================== 4. DYNASTY 8 / WESTGATE REALTY PURCHASE MODAL ==================== */}
      {modal === "apt_buy" && aptDef && (
        <div className="w-full max-w-xl overflow-hidden rounded-2xl border border-amber-400/40 bg-[#0b1019]/96 text-[#f2efe9] shadow-[0_28px_90px_rgba(0,0,0,0.88)]">
          <div className="flex items-center justify-between border-b border-white/10 bg-[#121926] px-6 py-4">
            <div className="flex items-center gap-3">
              <div className="flex size-10 items-center justify-center rounded-xl border border-amber-400/40 bg-amber-500/15 text-amber-300">
                <Building2 className="size-5" />
              </div>
              <div>
                <div className="font-mono text-[10px] uppercase tracking-[0.24em] text-amber-300">
                  Westgate Luxury Realty · For Sale
                </div>
                <h2 className="font-display text-2xl font-bold uppercase tracking-wide">{aptDef.name}</h2>
              </div>
            </div>
            <button
              onClick={onClose}
              className="cursor-pointer rounded-lg border border-white/15 bg-white/5 p-2 text-white/75 hover:text-white"
            >
              <X className="size-4" />
            </button>
          </div>

          <div className="space-y-4 p-6">
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 font-mono text-xs">
              <div>
                <div className="text-[#9aa5b8]">{aptDef.address}</div>
                <div className="font-bold text-cyan-300">{aptDef.district}</div>
              </div>
              <div className="text-right">
                <div className="text-[#9aa5b8]">{aptDef.sqft.toLocaleString()} SQ FT</div>
                <div className="font-bold text-white">{aptDef.style}</div>
              </div>
            </div>

            <p className="text-sm leading-relaxed text-[#cfd6e3]">{aptDef.description}</p>

            <div className="grid grid-cols-2 gap-2 font-mono text-[11px] text-emerald-300">
              <div className="flex items-center gap-1.5 rounded-lg border border-emerald-400/20 bg-emerald-500/10 px-3 py-2">
                <Sparkles className="size-3.5" /> Panoramic Skyline Interior
              </div>
              <div className="flex items-center gap-1.5 rounded-lg border border-emerald-400/20 bg-emerald-500/10 px-3 py-2">
                <Car className="size-3.5" /> Multi-Car Building Garage
              </div>
              <div className="flex items-center gap-1.5 rounded-lg border border-emerald-400/20 bg-emerald-500/10 px-3 py-2">
                <Wrench className="size-3.5" /> Gunsmith Weapon Bench
              </div>
              <div className="flex items-center gap-1.5 rounded-lg border border-emerald-400/20 bg-emerald-500/10 px-3 py-2">
                <Shirt className="size-3.5" /> Walk-In Wardrobe Closet
              </div>
            </div>

            <div className="flex items-center justify-between border-t border-white/10 pt-4">
              <div>
                <div className="font-mono text-[10px] uppercase tracking-wider text-[#9aa5b8]">Purchase Price</div>
                <div className="font-display text-3xl font-bold text-amber-300">{aptDef.price} CR</div>
                <div className="font-mono text-[11px] text-white/70">Your Balance: {save.currencies.credits} CR</div>
              </div>
              <button
                disabled={save.currencies.credits < aptDef.price}
                onClick={() => onBuyAndEnterApartment(aptDef.id)}
                className={`cursor-pointer rounded-xl border px-6 py-3 font-mono text-xs font-bold uppercase tracking-wider transition ${
                  save.currencies.credits >= aptDef.price
                    ? "border-emerald-400 bg-emerald-500/25 text-emerald-100 hover:bg-emerald-500/35"
                    : "cursor-not-allowed border-white/10 bg-white/5 text-white/35"
                }`}
              >
                {save.currencies.credits >= aptDef.price ? "Buy & Move In Now" : "Insufficient Credits"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ==================== 5. SAFEHOUSE SOVEREIGN LEDGER INVESTIGATION BOARD ==================== */}
      {modal === "intel_board" && (
        <div className="flex max-h-[90vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-rose-500/35 bg-[#0b0e14]/97 text-[#f2efe9] shadow-[0_28px_90px_rgba(0,0,0,0.88)]">
          <div className="flex items-center justify-between border-b border-white/10 bg-[#121620] px-6 py-4">
            <div className="flex items-center gap-3">
              <div className="flex size-10 items-center justify-center rounded-xl border border-rose-500/40 bg-rose-500/15 text-rose-300">
                <Crosshair className="size-5" />
              </div>
              <div>
                <div className="font-mono text-[10px] uppercase tracking-[0.26em] text-rose-400">
                  Safehouse Evidence Wall · Case File // Sovereign Ledger
                </div>
                <h2 className="font-display text-2xl font-bold uppercase tracking-wide">
                  Consortium Command Hierarchy
                </h2>
              </div>
            </div>
            <div className="flex items-center gap-2.5">
              {onStartStoryChapter && (
                <button
                  onClick={() => {
                    onClose();
                    onStartStoryChapter(nextStoryCh);
                  }}
                  className="cursor-pointer rounded-lg border border-rose-400/50 bg-rose-500/20 px-4 py-1.5 font-mono text-xs font-bold uppercase tracking-wider text-rose-100 transition hover:bg-rose-500/35"
                >
                  Deploy Ch {nextStoryCh.code}: {nextStoryCh.title}
                </button>
              )}
              <button
                onClick={onClose}
                className="flex cursor-pointer items-center gap-1.5 rounded-lg border border-white/15 bg-white/5 px-3 py-1.5 font-mono text-xs uppercase text-white/85 hover:border-white/40"
              >
                <X className="size-4" /> Close
              </button>
            </div>
          </div>

          {save.records?.[6]?.completed && (
            <div
              className={`border-b px-6 py-2.5 font-mono text-xs ${
                save.ledgerChoice === "claim"
                  ? "border-amber-500/35 bg-amber-500/10 text-amber-200"
                  : "border-violet-500/35 bg-violet-500/10 text-violet-200"
              }`}
            >
              <span className="font-bold uppercase tracking-wider">
                {save.ledgerChoice === "claim"
                  ? "FINAL DIRECTIVE // CONSORTIUM ESCROW CLAIMED:"
                  : save.ledgerChoice === "burn"
                    ? "FINAL DIRECTIVE // SOVEREIGN LEDGER BURNED:"
                    : "FINAL DIRECTIVE // PENDING:"}
              </span>{" "}
              <span className="text-white/85">
                {save.ledgerChoice === "claim"
                  ? "Julian Voss kept Sorin's vault keys and accepted the $25,000 CR Apex buyout. Brick remains on retainer in Westgate."
                  : save.ledgerChoice === "burn"
                    ? "The Sovereign Diamond and every Ironridge blackmail server were reduced to ash. Clean break for Julian, Mara, and Brick."
                    : "Replay or complete Ch 09 Debrief to log your final decision for the Sovereign Diamond."}
              </span>
            </div>
          )}

          {nextConseq?.bannerTitle && (
            <div
              className={`border-b px-6 py-2.5 font-mono text-xs ${
                nextConseq.bannerTone === "advantage"
                  ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-200"
                  : "border-amber-500/35 bg-amber-500/10 text-amber-200"
              }`}
            >
              <span className="font-bold uppercase tracking-wider">{nextConseq.bannerTitle}:</span>{" "}
              <span className="text-white/85">{nextConseq.bannerText}</span>
            </div>
          )}

          <div className="flex-1 overflow-y-auto p-6">
            <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
              {STORYLINE_CHAPTERS.filter((ch) => ch.chapter > 0).map((ch) => {
                const done = isStoryChapterCompleted(ch, save);
                const isNext = nextStoryCh.chapter === ch.chapter;
                const mRecord = ch.missionId ? save.records?.[ch.missionId] : undefined;
                const sRecord = ch.surveillanceId ? save.surveillanceRecords?.[ch.surveillanceId] : undefined;
                const stealthTag = mRecord?.ghost
                  ? "GHOST"
                  : sRecord?.unseen
                    ? "UNSEEN"
                    : done
                      ? "LOUD"
                      : null;
                const bossNote = Object.entries(BOSS_TAUNTS).find(([boss]) => {
                  const lastWord = boss.toLowerCase().split(" ").pop() ?? "";
                  return (
                    ch.tacticalFocus.toLowerCase().includes(lastWord) ||
                    ch.summary.toLowerCase().includes(lastWord)
                  );
                })?.[1]?.intelNote;

                return (
                  <div
                    key={ch.code}
                    className={`relative flex flex-col justify-between rounded-xl border p-4 transition ${
                      done
                        ? "border-emerald-500/30 bg-emerald-950/15"
                        : isNext
                          ? "border-rose-500/55 bg-rose-950/20"
                          : "border-white/10 bg-white/[0.025]"
                    }`}
                  >
                    <div>
                      <div className="flex items-center justify-between gap-2 font-mono text-[10px] uppercase tracking-wider">
                        <span className="truncate text-white/60">
                          Ch {ch.code} · {ch.codename}
                        </span>
                        <span
                          className={`shrink-0 rounded px-1.5 py-0.5 font-bold ${
                            done
                              ? "bg-emerald-500/20 text-emerald-300"
                              : isNext
                                ? "bg-rose-500/25 text-rose-200"
                                : "bg-white/10 text-white/45"
                          }`}
                        >
                          {done ? "ELIMINATED" : isNext ? "ACTIVE LEAD" : "LOCKED"}
                        </span>
                      </div>

                      <div className="mt-2 font-display text-lg font-bold uppercase tracking-wide text-white">
                        {ch.title}
                      </div>
                      <div className="font-mono text-[11px] font-bold text-amber-300/90">
                        {ch.tacticalFocus}
                      </div>
                      <p className="mt-2 text-xs leading-relaxed text-[#aab4c5]">
                        {done && bossNote ? bossNote : ch.summary}
                      </p>
                    </div>

                    <div className="mt-3 flex items-center justify-between border-t border-white/10 pt-2.5 font-mono text-[10px]">
                      {stealthTag ? (
                        <span
                          className={
                            stealthTag === "LOUD" ? "font-bold text-amber-300" : "font-bold text-emerald-300"
                          }
                        >
                          METHOD: {stealthTag}
                        </span>
                      ) : (
                        <span className="text-white/40">{ch.kind === "surveillance" ? "SURVEILLANCE" : "DIRECT OP"}</span>
                      )}
                      {onStartStoryChapter && (done || isNext) && (
                        <button
                          onClick={() => {
                            onClose();
                            onStartStoryChapter(ch);
                          }}
                          className="cursor-pointer font-bold uppercase text-cyan-300 hover:text-cyan-100"
                        >
                          {done ? "Replay" : "Engage →"}
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
