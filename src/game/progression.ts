import { CARS, isCarId, type CarId } from "./vehicles/catalog";

export type CurrencyKey = "credits" | "intel" | "salvage";

export type Currencies = Record<CurrencyKey, number>;

export type UpgradeCategory = "weapons" | "armour" | "stealth" | "precision";

export interface UpgradeDef {
  id: string;
  category: UpgradeCategory;
  name: string;
  subtitle: string;
  maxLevel: number;
  effectLabels: string[]; // 1-indexed per tier (len = maxLevel)
  costs: Partial<Currencies>[]; // per tier (0 -> 1, 1 -> 2, ...)
}

export interface MissionRecord {
  completed: boolean;
  ghost: boolean;
  bestKills: number;
  bestStealthKills: number;
}

export type ArmorFinish = "matte" | "tactical" | "titanium";
export type WeaponFinish = "obsidian" | "coyote" | "arctic" | "crimson" | "gold";
export type NvgMode = "flipped" | "deployed" | "none";

export interface SoldierAppearance {
  armorColor: string;
  armorFinish: ArmorFinish;
  gearColor: string;
  visorColor: string;
  visorGlow: number; // 0.15 .. 1.4
  weaponFinish: WeaponFinish;
  nvg: NvgMode;
  backpack: boolean;
  chestRig: boolean;
  holster: boolean;
  headset: boolean;
}

export const DEFAULT_APPEARANCE: SoldierAppearance = {
  armorColor: "#e6e8ec",
  armorFinish: "tactical",
  gearColor: "#2e3338",
  visorColor: "#22d3ee",
  visorGlow: 0.55,
  weaponFinish: "coyote",
  nvg: "flipped",
  backpack: true,
  chestRig: true,
  holster: true,
  headset: true,
};

export interface SaveData {
  unlocked: number;
  currencies: Currencies;
  upgrades: Record<string, number>;
  records: Record<number, MissionRecord>;
  selectedWeapon: number;
  appearance: SoldierAppearance;
  ownedCars: CarId[];
  selectedCar: CarId;
  carPaints: Partial<Record<CarId, string>>;
}

export const SAVE_KEY = "vanguard_blackout_save_v1";

export const UPGRADES: UpgradeDef[] = [
  // ---- WEAPONS ----
  {
    id: "barrel_damage",
    category: "weapons",
    name: "Subsonic Hollow-Point",
    subtitle: "Heavy-jacketed subsonic rounds increase per-shot ballistic damage",
    maxLevel: 4,
    effectLabels: ["+12% Damage", "+24% Damage", "+38% Damage", "+55% Damage"],
    costs: [
      { credits: 100, salvage: 15 },
      { credits: 180, salvage: 30 },
      { credits: 290, salvage: 50 },
      { credits: 440, salvage: 80 },
    ],
  },
  {
    id: "silencer_baffle",
    category: "weapons",
    name: "Titanium Baffle Core",
    subtitle: "Multi-stage suppressor baffles shrink gunshot noise radius",
    maxLevel: 4,
    effectLabels: ["-16% Shot Noise", "-30% Shot Noise", "-42% Shot Noise", "-54% Shot Noise"],
    costs: [
      { credits: 90, intel: 10 },
      { credits: 160, intel: 22 },
      { credits: 260, intel: 38 },
      { credits: 390, intel: 60 },
    ],
  },
  {
    id: "extended_mags",
    category: "weapons",
    name: "High-Cap Magazines",
    subtitle: "Expanded magazine wells & reserve pouches across all 4 weapons",
    maxLevel: 4,
    effectLabels: ["+15% Capacity", "+30% Capacity", "+45% Capacity", "+60% Capacity"],
    costs: [
      { credits: 85, salvage: 12 },
      { credits: 155, salvage: 25 },
      { credits: 250, salvage: 45 },
      { credits: 380, salvage: 70 },
    ],
  },
  {
    id: "bolt_cycling",
    category: "weapons",
    name: "Match-Grade Bolt",
    subtitle: "Polished carrier group increases cyclic fire rate (RPM)",
    maxLevel: 4,
    effectLabels: ["+8% Fire Rate", "+16% Fire Rate", "+25% Fire Rate", "+35% Fire Rate"],
    costs: [
      { credits: 95, salvage: 12 },
      { credits: 170, salvage: 28 },
      { credits: 275, salvage: 48 },
      { credits: 420, salvage: 75 },
    ],
  },

  // ---- ARMOUR ----
  {
    id: "ballistic_plates",
    category: "armour",
    name: "Ceramic Ballistic Plates",
    subtitle: "Reinforced chest & back inserts raise maximum operator HP",
    maxLevel: 4,
    effectLabels: ["120 Max HP", "145 Max HP", "175 Max HP", "210 Max HP"],
    costs: [
      { credits: 110, salvage: 18 },
      { credits: 200, salvage: 35 },
      { credits: 320, salvage: 55 },
      { credits: 480, salvage: 85 },
    ],
  },
  {
    id: "kevlar_weave",
    category: "armour",
    name: "Reactive Kevlar Weave",
    subtitle: "Layered aramid trauma liner reduces incoming enemy damage",
    maxLevel: 4,
    effectLabels: ["-10% Dmg Taken", "-20% Dmg Taken", "-30% Dmg Taken", "-40% Dmg Taken"],
    costs: [
      { credits: 100, salvage: 15 },
      { credits: 185, salvage: 30 },
      { credits: 300, salvage: 50 },
      { credits: 450, salvage: 80 },
    ],
  },

  // ---- STEALTH ----
  {
    id: "stealth_boots",
    category: "stealth",
    name: "Soft-Sole Tact-Boots",
    subtitle: "Acoustic dampening soles cut footstep noise & boost crouch speed",
    maxLevel: 4,
    effectLabels: ["-22% Noise · +10% Crouch", "-42% Noise · +20% Crouch", "-62% Noise · +30% Crouch", "-82% Noise · +40% Crouch"],
    costs: [
      { credits: 95, intel: 16 },
      { credits: 175, intel: 30 },
      { credits: 280, intel: 48 },
      { credits: 420, intel: 75 },
    ],
  },
  {
    id: "shadow_cloak",
    category: "stealth",
    name: "Adaptive Thermal Camo",
    subtitle: "Matte light-absorbing rig slows enemy detection & cuts sight range",
    maxLevel: 4,
    effectLabels: ["-12% Detect · -10% Range", "-22% Detect · -18% Range", "-32% Detect · -26% Range", "-42% Detect · -34% Range"],
    costs: [
      { credits: 115, intel: 20 },
      { credits: 210, intel: 38 },
      { credits: 340, intel: 60 },
      { credits: 500, intel: 90 },
    ],
  },

  // ---- PRECISION ----
  {
    id: "recoil_comp",
    category: "precision",
    name: "Gyroscopic Foregrip",
    subtitle: "Counter-balanced weapon stabilization reduces recoil kick",
    maxLevel: 4,
    effectLabels: ["-15% Recoil", "-28% Recoil", "-40% Recoil", "-52% Recoil"],
    costs: [
      { credits: 90, intel: 12, salvage: 10 },
      { credits: 165, intel: 22, salvage: 22 },
      { credits: 265, intel: 36, salvage: 36 },
      { credits: 400, intel: 55, salvage: 55 },
    ],
  },
  {
    id: "optic_calib",
    category: "precision",
    name: "Zero-Shift Optic Rig",
    subtitle: "Precision-aligned glass tightens bullet spread & steadies aim",
    maxLevel: 4,
    effectLabels: ["-18% Spread", "-34% Spread", "-48% Spread", "-60% Spread"],
    costs: [
      { credits: 95, intel: 14, salvage: 10 },
      { credits: 175, intel: 26, salvage: 20 },
      { credits: 280, intel: 42, salvage: 32 },
      { credits: 420, intel: 65, salvage: 50 },
    ],
  },
];

export interface PlayerStats {
  damageMult: number;
  shotNoiseMult: number;
  magMult: number;
  rpmMult: number;
  maxHp: number;
  damageTakenMult: number;
  footstepNoiseMult: number;
  crouchSpeedMult: number;
  enemyDetectSpeedMult: number;
  enemyVisionRangeMult: number;
  recoilMult: number;
  spreadMult: number;
}

const DEFAULT_SAVE = (): SaveData => ({
  unlocked: 1,
  currencies: { credits: 180, intel: 25, salvage: 25 },
  upgrades: {},
  records: {},
  selectedWeapon: 0,
  appearance: { ...DEFAULT_APPEARANCE },
  ownedCars: ["golf"],
  selectedCar: "golf",
  carPaints: {},
});

export function loadSave(): SaveData {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return DEFAULT_SAVE();
    const p = JSON.parse(raw) as Partial<SaveData>;
    const rawOwned = Array.isArray(p.ownedCars) ? p.ownedCars.filter((c): c is CarId => typeof c === "string" && isCarId(c)) : [];
    const ownedCars: CarId[] = ["golf", ...rawOwned.filter((c) => c !== "golf")];
    const selectedCar: CarId =
      typeof p.selectedCar === "string" && isCarId(p.selectedCar) && ownedCars.includes(p.selectedCar)
        ? p.selectedCar
        : "golf";
    const carPaints: Partial<Record<CarId, string>> = {};
    if (p.carPaints && typeof p.carPaints === "object") {
      for (const [k, v] of Object.entries(p.carPaints)) {
        if (isCarId(k) && typeof v === "string" && /^#[0-9a-fA-F]{6}$/.test(v)) {
          carPaints[k] = v;
        }
      }
    }
    return {
      unlocked: Math.max(1, Number(p.unlocked ?? 1)),
      currencies: {
        credits: Number(p.currencies?.credits ?? 180),
        intel: Number(p.currencies?.intel ?? 25),
        salvage: Number(p.currencies?.salvage ?? 25),
      },
      upgrades: p.upgrades && typeof p.upgrades === "object" ? { ...p.upgrades } : {},
      records: p.records && typeof p.records === "object" ? { ...p.records } : {},
      selectedWeapon: Number(p.selectedWeapon ?? 0),
      appearance: {
        ...DEFAULT_APPEARANCE,
        ...(p.appearance && typeof p.appearance === "object" ? p.appearance : {}),
      },
      ownedCars,
      selectedCar,
      carPaints,
    };
  } catch {
    return DEFAULT_SAVE();
  }
}

export function writeSave(data: SaveData) {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(data));
  } catch {}
}

export function resetSave(): SaveData {
  const fresh = DEFAULT_SAVE();
  writeSave(fresh);
  return fresh;
}

export function getUpgradeLevel(save: SaveData, id: string): number {
  return Math.max(0, Math.min(4, save.upgrades[id] ?? 0));
}

export function canAfford(currencies: Currencies, cost: Partial<Currencies>): boolean {
  return (
    currencies.credits >= (cost.credits ?? 0) &&
    currencies.intel >= (cost.intel ?? 0) &&
    currencies.salvage >= (cost.salvage ?? 0)
  );
}

export function purchaseUpgrade(id: string): SaveData | null {
  const def = UPGRADES.find((u) => u.id === id);
  if (!def) return null;
  const save = loadSave();
  const lvl = getUpgradeLevel(save, id);
  if (lvl >= def.maxLevel) return null;
  const cost = def.costs[lvl];
  if (!canAfford(save.currencies, cost)) return null;
  save.currencies.credits -= cost.credits ?? 0;
  save.currencies.intel -= cost.intel ?? 0;
  save.currencies.salvage -= cost.salvage ?? 0;
  save.upgrades[id] = lvl + 1;
  writeSave(save);
  return save;
}

export function purchaseCar(carId: CarId): SaveData | null {
  const spec = CARS.find((c) => c.id === carId);
  if (!spec) return null;
  const save = loadSave();
  if (save.ownedCars.includes(carId)) return null;
  if (save.currencies.credits < spec.price) return null;
  save.currencies.credits -= spec.price;
  save.ownedCars.push(carId);
  save.selectedCar = carId;
  writeSave(save);
  return save;
}

export function selectOwnedCar(carId: CarId, paintHex?: string | null): SaveData | null {
  const save = loadSave();
  if (!save.ownedCars.includes(carId)) return null;
  save.selectedCar = carId;
  if (paintHex === null) delete save.carPaints[carId];
  else if (typeof paintHex === "string" && /^#[0-9a-fA-F]{6}$/.test(paintHex)) save.carPaints[carId] = paintHex;
  writeSave(save);
  return save;
}

export function awardDrivingCredits(credits: number): SaveData {
  const save = loadSave();
  const gain = Math.max(0, Math.floor(credits));
  if (gain > 0) {
    save.currencies.credits += gain;
    writeSave(save);
  }
  return save;
}

export function getPlayerStats(save = loadSave()): PlayerStats {
  const lv = (id: string) => getUpgradeLevel(save, id);
  const dmgT = [1, 1.12, 1.24, 1.38, 1.55];
  const shotNT = [1, 0.84, 0.7, 0.58, 0.46];
  const magT = [1, 1.15, 1.3, 1.45, 1.6];
  const rpmT = [1, 1.08, 1.16, 1.25, 1.35];
  const hpT = [100, 120, 145, 175, 210];
  const defT = [1, 0.9, 0.8, 0.7, 0.6];
  const footT = [1, 0.78, 0.58, 0.38, 0.18];
  const crSpdT = [1, 1.1, 1.2, 1.3, 1.4];
  const detSpdT = [1, 0.88, 0.78, 0.68, 0.58];
  const visRngT = [1, 0.9, 0.82, 0.74, 0.66];
  const recT = [1, 0.85, 0.72, 0.6, 0.48];
  const sprT = [1, 0.82, 0.66, 0.52, 0.4];
  return {
    damageMult: dmgT[lv("barrel_damage")],
    shotNoiseMult: shotNT[lv("silencer_baffle")],
    magMult: magT[lv("extended_mags")],
    rpmMult: rpmT[lv("bolt_cycling")],
    maxHp: hpT[lv("ballistic_plates")],
    damageTakenMult: defT[lv("kevlar_weave")],
    footstepNoiseMult: footT[lv("stealth_boots")],
    crouchSpeedMult: crSpdT[lv("stealth_boots")],
    enemyDetectSpeedMult: detSpdT[lv("shadow_cloak")],
    enemyVisionRangeMult: visRngT[lv("shadow_cloak")],
    recoilMult: recT[lv("recoil_comp")],
    spreadMult: sprT[lv("optic_calib")],
  };
}

export interface MissionReward {
  credits: number;
  intel: number;
  salvage: number;
  ghostBonus: boolean;
}

export function previewMissionBaseReward(missionId: number): Currencies {
  if (missionId === 0) return { credits: 40, intel: 8, salvage: 8 };
  return {
    credits: 120 + missionId * 55,
    intel: 15 + missionId * 8,
    salvage: 18 + missionId * 9,
  };
}

export function awardMissionReward(
  missionId: number,
  kills: number,
  stealthKills: number,
  alerts: number,
  success: boolean,
): { save: SaveData; reward: MissionReward } {
  const save = loadSave();
  if (!success) {
    // Partial salvage/intel on abort or KIA so runs still progress slightly
    const reward: MissionReward = {
      credits: kills * 8 + stealthKills * 6,
      intel: stealthKills * 3,
      salvage: kills * 3,
      ghostBonus: false,
    };
    save.currencies.credits += reward.credits;
    save.currencies.intel += reward.intel;
    save.currencies.salvage += reward.salvage;
    writeSave(save);
    return { save, reward };
  }

  const base = previewMissionBaseReward(missionId);
  const ghostBonus = missionId > 0 && alerts === 0;
  const reward: MissionReward = {
    credits: base.credits + kills * 10 + stealthKills * 14 + (ghostBonus ? 120 : 0),
    intel: base.intel + stealthKills * 5 + (ghostBonus ? 35 : 0),
    salvage: base.salvage + kills * 4 + (ghostBonus ? 20 : 0),
    ghostBonus,
  };

  save.currencies.credits += reward.credits;
  save.currencies.intel += reward.intel;
  save.currencies.salvage += reward.salvage;

  if (missionId > 0) {
    save.unlocked = Math.max(save.unlocked, missionId + 1);
    const prev = save.records[missionId];
    save.records[missionId] = {
      completed: true,
      ghost: Boolean(prev?.ghost || ghostBonus),
      bestKills: Math.max(prev?.bestKills ?? 0, kills),
      bestStealthKills: Math.max(prev?.bestStealthKills ?? 0, stealthKills),
    };
  }
  writeSave(save);
  return { save, reward };
}
