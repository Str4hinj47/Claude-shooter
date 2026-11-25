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
export type WeaponPartFinish = WeaponFinish | "olive" | "cobalt" | "titanium";
export type WeaponOpticId = "holo" | "reddot" | "acog" | "sniper";
export type WeaponMuzzleId = "suppressor" | "osprey" | "wrapped" | "comp";
export type WeaponUnderbarrelId = "none" | "vfg" | "angled" | "laser";
export type WeaponMagId = "standard" | "extended" | "drum";
export type WeaponSlotId = "pistol" | "carbine" | "smg" | "shotgun" | "dmr";

export interface WeaponCustomConfig {
  optic: WeaponOpticId;
  muzzle: WeaponMuzzleId;
  underbarrel: WeaponUnderbarrelId;
  magazine: WeaponMagId;
  bodyFinish: WeaponPartFinish;
  accentFinish: WeaponPartFinish;
  hardwareFinish: WeaponPartFinish;
  reticleColor: string;
}

export const DEFAULT_WEAPON_CONFIGS: Record<WeaponSlotId, WeaponCustomConfig> = {
  pistol: {
    optic: "reddot",
    muzzle: "suppressor",
    underbarrel: "laser",
    magazine: "standard",
    bodyFinish: "obsidian",
    accentFinish: "titanium",
    hardwareFinish: "titanium",
    reticleColor: "#22d3ee",
  },
  carbine: {
    optic: "holo",
    muzzle: "suppressor",
    underbarrel: "vfg",
    magazine: "standard",
    bodyFinish: "obsidian",
    accentFinish: "coyote",
    hardwareFinish: "titanium",
    reticleColor: "#22d3ee",
  },
  smg: {
    optic: "reddot",
    muzzle: "wrapped",
    underbarrel: "vfg",
    magazine: "extended",
    bodyFinish: "obsidian",
    accentFinish: "obsidian",
    hardwareFinish: "titanium",
    reticleColor: "#38bdf8",
  },
  shotgun: {
    optic: "reddot",
    muzzle: "osprey",
    underbarrel: "angled",
    magazine: "standard",
    bodyFinish: "titanium",
    accentFinish: "coyote",
    hardwareFinish: "obsidian",
    reticleColor: "#ff3b30",
  },
  dmr: {
    optic: "sniper",
    muzzle: "suppressor",
    underbarrel: "laser",
    magazine: "standard",
    bodyFinish: "coyote",
    accentFinish: "coyote",
    hardwareFinish: "obsidian",
    reticleColor: "#2dd4bf",
  },
};

export interface WeaponModEffects {
  magMult: number;
  recoilMult: number;
  spreadMult: number;
  adsFovBonus: number;
  suppressed: boolean;
}

export function getWeaponCustomConfig(save: SaveData, id: WeaponSlotId): WeaponCustomConfig {
  const base = DEFAULT_WEAPON_CONFIGS[id];
  const saved = save.weaponConfigs?.[id];
  if (!saved) return { ...base };
  return {
    optic: saved.optic ?? base.optic,
    muzzle: saved.muzzle ?? base.muzzle,
    underbarrel: saved.underbarrel ?? base.underbarrel,
    magazine: saved.magazine ?? base.magazine,
    bodyFinish: saved.bodyFinish ?? base.bodyFinish,
    accentFinish: saved.accentFinish ?? base.accentFinish,
    hardwareFinish: saved.hardwareFinish ?? base.hardwareFinish,
    reticleColor: typeof saved.reticleColor === "string" ? saved.reticleColor : base.reticleColor,
  };
}

export function getWeaponModEffects(cfg: WeaponCustomConfig): WeaponModEffects {
  const magMult = cfg.magazine === "drum" ? 1.45 : cfg.magazine === "extended" ? 1.2 : 1.0;
  let recoilMult = 1.0;
  let spreadMult = 1.0;
  let suppressed = true;
  if (cfg.muzzle === "comp") {
    recoilMult *= 0.84;
    suppressed = false;
  } else if (cfg.muzzle === "wrapped") {
    recoilMult *= 0.94;
  }
  if (cfg.underbarrel === "vfg") recoilMult *= 0.9;
  else if (cfg.underbarrel === "angled") spreadMult *= 0.92;
  else if (cfg.underbarrel === "laser") spreadMult *= 0.84;

  const adsFovBonus = cfg.optic === "sniper" ? -10 : cfg.optic === "acog" ? -5 : 0;
  return { magMult, recoilMult, spreadMult, adsFovBonus, suppressed };
}

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

export type CarPaintFinish = "metallic" | "gloss" | "matte" | "chrome";
export type CarTrimFinish = "black" | "chrome" | "carbon" | "bronze";

export interface CarCustomConfig {
  paintHex?: string;
  paintFinish: CarPaintFinish;
  rimColor: string;
  windowTint: number; // 0 = factory clear, 1 = dark limo
  trimFinish: CarTrimFinish;
  engineLevel: number; // 0..3
  handlingLevel: number; // 0..3
  brakeLevel: number; // 0..3
}

export const DEFAULT_CAR_CUSTOM: CarCustomConfig = {
  paintFinish: "metallic",
  rimColor: "#c8cdd6",
  windowTint: 0.35,
  trimFinish: "black",
  engineLevel: 0,
  handlingLevel: 0,
  brakeLevel: 0,
};

export type ApartmentId = "apt_oldquarter" | "apt_midtown" | "apt_westcoast" | "apt_downtown";

export interface ApartmentDef {
  id: ApartmentId;
  name: string;
  district: string;
  address: string;
  style: string;
  description: string;
  price: number;
  sqft: number;
  /** World-space exterior building entrance door where the player sees [F] Enter / Buy. */
  doorPos: { x: number; y: number; z: number };
  /** Facing angle (radians, matching Three.js box/door yaw) of the exterior entrance facade. */
  doorYaw: number;
  /** World-space spot right outside the door where the player spawns when exiting. */
  exitStreetPos: { x: number; y: number; z: number };
  /** Isolated high-altitude interior center directly over the building (y = 260m). */
  interiorOrigin: { x: number; y: number; z: number };
  /** Street-level Building Multi-Car Garage shutter door position. */
  garageDoorPos: { x: number; y: number; z: number };
  garageDoorYaw: number;
  /** Street-level drive-out exit spot in front of the Building Garage shutter. */
  garageExitPos: { x: number; y: number; z: number };
  /** Multi-Car (8-bay) Building Garage interior center directly beneath the apartment (y = 240m). */
  garageOrigin: { x: number; y: number; z: number };
  /** Accent hex color for Realty / Minimap pins. */
  accentHex: string;
}

export const APARTMENTS: ApartmentDef[] = [
  {
    id: "apt_oldquarter",
    name: "Crescent Brick Flat",
    district: "Old Quarter & Suburbs",
    address: "114 Crescent Row",
    style: "Industrial Warm Brick Loft",
    description:
      "Exposed red brick walls, herringbone walnut floors, brass pendant lighting, custom gunsmith bench, walk-in wardrobe, and panoramic terrace windows overlooking Old Quarter.",
    price: 120,
    sqft: 1450,
    doorPos: { x: -157, y: 4.5, z: 187.4 },
    doorYaw: 0,
    exitStreetPos: { x: -157, y: 4.5, z: 189.8 },
    interiorOrigin: { x: -170, y: 260, z: 180 },
    garageDoorPos: { x: -183, y: 4.5, z: 187.4 },
    garageDoorYaw: 0,
    garageExitPos: { x: -183, y: 4.5, z: 192.0 },
    garageOrigin: { x: -170, y: 240, z: 180 },
    accentHex: "#f59e0b",
  },
  {
    id: "apt_midtown",
    name: "Midtown Horizon Loft",
    district: "Midtown & Del Sol",
    address: "88 Del Sol Avenue (Regal Tower)",
    style: "Art-Deco Slate & Brass Residence",
    description:
      "High-rise Art-Deco suite above Regal Cinema with fluted marble island, sunken lounge, fireplace hearth, tactical armory bench, and skyline view down Del Sol Avenue.",
    price: 320,
    sqft: 2150,
    doorPos: { x: -342, y: 4.5, z: -91.4 },
    doorYaw: Math.PI,
    exitStreetPos: { x: -342, y: 4.5, z: -93.8 },
    interiorOrigin: { x: -342, y: 260, z: -78 },
    garageDoorPos: { x: -331, y: 4.5, z: -91.4 },
    garageDoorYaw: Math.PI,
    garageExitPos: { x: -331, y: 4.5, z: -96.0 },
    garageOrigin: { x: -342, y: 240, z: -78 },
    accentHex: "#38bdf8",
  },
  {
    id: "apt_westcoast",
    name: "Del Sol Oceanfront Condo",
    district: "West Coast & Oceanfront",
    address: "1 Boardwalk Pier Tower",
    style: "Coastal Modern Glass Villa",
    description:
      "Sunlit coastal residence inside the Del Sol Beachfront Resort with bleached oak decking, travertine stone kitchen, ocean-view king suite, walk-in closet, and gunsmith bay.",
    price: 550,
    sqft: 2700,
    doorPos: { x: -628.4, y: 4.5, z: -19 },
    doorYaw: -Math.PI / 2,
    exitStreetPos: { x: -630.8, y: 4.5, z: -19 },
    interiorOrigin: { x: -620, y: 260, z: -25 },
    garageDoorPos: { x: -628.4, y: 4.5, z: -9 },
    garageDoorYaw: -Math.PI / 2,
    garageExitPos: { x: -633.0, y: 4.5, z: -9 },
    garageOrigin: { x: -620, y: 240, z: -25 },
    accentHex: "#22d3ee",
  },
  {
    id: "apt_downtown",
    name: "Sovereign Sky Penthouse",
    district: "Downtown Financial Core",
    address: "1 Sovereign Spire Plaza",
    style: "Ultra-Luxury Obsidian & Marble Sky Suite",
    description:
      "Flagship penthouse atop Sovereign Spire featuring black vein marble waterfall counters, panoramic 270-degree Downtown glass walls, illuminated armory vault, and private master suite.",
    price: 950,
    sqft: 3600,
    doorPos: { x: -18, y: 4.5, z: -222.6 },
    doorYaw: 0,
    exitStreetPos: { x: -18, y: 4.5, z: -220.2 },
    interiorOrigin: { x: -18, y: 260, z: -238 },
    garageDoorPos: { x: -7, y: 4.5, z: -222.6 },
    garageDoorYaw: 0,
    garageExitPos: { x: -7, y: 4.5, z: -218.0 },
    garageOrigin: { x: -18, y: 240, z: -238 },
    accentHex: "#a855f7",
  },
];

export const CAR_TUNING_COSTS: Record<"engine" | "handling" | "brake", number[]> = {
  engine: [75, 145, 240],
  handling: [65, 125, 210],
  brake: [55, 105, 180],
};

export type BoatId = "skiff" | "sunseeker" | "cruiser";

export type DifficultyMode = "operative" | "veteran" | "shadow";

export const DIFFICULTY_PROFILES: Record<
  DifficultyMode,
  { label: string; subtitle: string; hp: number; damage: number; accuracy: number; vision: number; rewardMult: number }
> = {
  operative: {
    label: "OPERATIVE",
    subtitle: "Standard contract threat · 1.0× payout",
    hp: 1.0,
    damage: 1.0,
    accuracy: 1.0,
    vision: 1.0,
    rewardMult: 1.0,
  },
  veteran: {
    label: "VETERAN",
    subtitle: "Hardened patrols · +25% payout",
    hp: 1.2,
    damage: 1.25,
    accuracy: 1.12,
    vision: 1.1,
    rewardMult: 1.25,
  },
  shadow: {
    label: "SHADOW",
    subtitle: "Lethal alerts & optics · +60% payout",
    hp: 1.38,
    damage: 1.55,
    accuracy: 1.25,
    vision: 1.22,
    rewardMult: 1.6,
  },
};

export interface SurveillanceRecord {
  completed: boolean;
  unseen: boolean;
  deepSea: boolean;
  bestTimeSec?: number;
}

export interface SaveData {
  unlocked: number;
  currencies: Currencies;
  upgrades: Record<string, number>;
  records: Record<number, MissionRecord>;
  surveillanceRecords?: Record<string, SurveillanceRecord>;
  selectedWeapon: number;
  difficulty?: DifficultyMode;
  appearance: SoldierAppearance;
  weaponConfigs?: Partial<Record<WeaponSlotId, WeaponCustomConfig>>;
  ownedCars: CarId[];
  selectedCar: CarId;
  carPaints: Partial<Record<CarId, string>>;
  carCustoms?: Partial<Record<CarId, CarCustomConfig>>;
  ownedBoats?: BoatId[];
  selectedBoat?: BoatId;
  ownedApartments?: ApartmentId[];
  discoveredDistricts?: string[];
  speedTrapBests?: Record<string, number>;
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
  difficulty: "operative",
  appearance: { ...DEFAULT_APPEARANCE },
  weaponConfigs: {
    pistol: { ...DEFAULT_WEAPON_CONFIGS.pistol },
    carbine: { ...DEFAULT_WEAPON_CONFIGS.carbine },
    smg: { ...DEFAULT_WEAPON_CONFIGS.smg },
    shotgun: { ...DEFAULT_WEAPON_CONFIGS.shotgun },
    dmr: { ...DEFAULT_WEAPON_CONFIGS.dmr },
  },
  ownedCars: ["golf"],
  selectedCar: "golf",
  carPaints: {},
  carCustoms: {},
  ownedBoats: ["skiff"],
  selectedBoat: "skiff",
  surveillanceRecords: {},
  ownedApartments: [],
  discoveredDistricts: [],
  speedTrapBests: {},
});

function isApartmentId(id: string): id is ApartmentId {
  return APARTMENTS.some((a) => a.id === id);
}

function sanitizeCarCustoms(
  raw: unknown,
  legacyPaints: Partial<Record<CarId, string>>,
): Partial<Record<CarId, CarCustomConfig>> {
  const out: Partial<Record<CarId, CarCustomConfig>> = {};
  const src = raw && typeof raw === "object" ? (raw as Record<string, Partial<CarCustomConfig>>) : {};
  for (const spec of CARS) {
    const p = src[spec.id];
    const paint =
      p && typeof p.paintHex === "string" && /^#[0-9a-fA-F]{6}$/.test(p.paintHex)
        ? p.paintHex
        : legacyPaints[spec.id];
    if (!p && !paint) continue;
    out[spec.id] = {
      paintHex: paint,
      paintFinish:
        p?.paintFinish === "gloss" || p?.paintFinish === "matte" || p?.paintFinish === "chrome"
          ? p.paintFinish
          : "metallic",
      rimColor: typeof p?.rimColor === "string" && /^#[0-9a-fA-F]{6}$/.test(p.rimColor) ? p.rimColor : DEFAULT_CAR_CUSTOM.rimColor,
      windowTint: Math.max(0, Math.min(1, Number(p?.windowTint ?? DEFAULT_CAR_CUSTOM.windowTint))),
      trimFinish:
        p?.trimFinish === "chrome" || p?.trimFinish === "carbon" || p?.trimFinish === "bronze"
          ? p.trimFinish
          : "black",
      engineLevel: Math.max(0, Math.min(3, Math.floor(Number(p?.engineLevel ?? 0)))),
      handlingLevel: Math.max(0, Math.min(3, Math.floor(Number(p?.handlingLevel ?? 0)))),
      brakeLevel: Math.max(0, Math.min(3, Math.floor(Number(p?.brakeLevel ?? 0)))),
    };
  }
  return out;
}

function sanitizeWeaponConfigs(raw: unknown): Partial<Record<WeaponSlotId, WeaponCustomConfig>> {
  const out: Partial<Record<WeaponSlotId, WeaponCustomConfig>> = {};
  const src = raw && typeof raw === "object" ? (raw as Record<string, Partial<WeaponCustomConfig>>) : {};
  (["pistol", "carbine", "smg", "shotgun", "dmr"] as WeaponSlotId[]).forEach((id) => {
    const base = DEFAULT_WEAPON_CONFIGS[id];
    const p = src[id];
    out[id] = p && typeof p === "object"
      ? {
          optic: p.optic ?? base.optic,
          muzzle: p.muzzle ?? base.muzzle,
          underbarrel: p.underbarrel ?? base.underbarrel,
          magazine: p.magazine ?? base.magazine,
          bodyFinish: p.bodyFinish ?? base.bodyFinish,
          accentFinish: p.accentFinish ?? base.accentFinish,
          hardwareFinish: p.hardwareFinish ?? base.hardwareFinish,
          reticleColor: typeof p.reticleColor === "string" ? p.reticleColor : base.reticleColor,
        }
      : { ...base };
  });
  return out;
}

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
    const rawApts = Array.isArray(p.ownedApartments)
      ? p.ownedApartments.filter((id): id is ApartmentId => typeof id === "string" && isApartmentId(id))
      : [];
    const ownedApartments = Array.from(new Set(rawApts));
    const rawBoats = Array.isArray(p.ownedBoats)
      ? p.ownedBoats.filter((b): b is BoatId => b === "skiff" || b === "sunseeker" || b === "cruiser")
      : [];
    const ownedBoats: BoatId[] = ["skiff", ...rawBoats.filter((b) => b !== "skiff")];
    const selectedBoat: BoatId =
      p.selectedBoat === "sunseeker" || p.selectedBoat === "cruiser"
        ? ownedBoats.includes(p.selectedBoat)
          ? p.selectedBoat
          : "skiff"
        : "skiff";
    const surveillanceRecords: Record<string, SurveillanceRecord> =
      p.surveillanceRecords && typeof p.surveillanceRecords === "object"
        ? { ...p.surveillanceRecords }
        : {};
    const discoveredDistricts = Array.isArray(p.discoveredDistricts)
      ? Array.from(new Set(p.discoveredDistricts.filter((d): d is string => typeof d === "string")))
      : [];
    const speedTrapBests: Record<string, number> = {};
    if (p.speedTrapBests && typeof p.speedTrapBests === "object") {
      for (const [k, v] of Object.entries(p.speedTrapBests)) {
        if (typeof v === "number" && Number.isFinite(v) && v > 0) speedTrapBests[k] = v;
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
      surveillanceRecords,
      selectedWeapon: Number(p.selectedWeapon ?? 0),
      difficulty:
        p.difficulty === "veteran" || p.difficulty === "shadow" || p.difficulty === "operative"
          ? p.difficulty
          : "operative",
      appearance: {
        ...DEFAULT_APPEARANCE,
        ...(p.appearance && typeof p.appearance === "object" ? p.appearance : {}),
      },
      weaponConfigs: sanitizeWeaponConfigs(p.weaponConfigs),
      ownedCars,
      selectedCar,
      carPaints,
      carCustoms: sanitizeCarCustoms(p.carCustoms, carPaints),
      ownedBoats,
      selectedBoat,
      ownedApartments,
      discoveredDistricts,
      speedTrapBests,
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
  if (!save.carCustoms) save.carCustoms = {};
  const prev = getCarCustomConfig(save, carId);
  if (paintHex === null) {
    delete save.carPaints[carId];
    save.carCustoms[carId] = { ...prev, paintHex: undefined };
  } else if (typeof paintHex === "string" && /^#[0-9a-fA-F]{6}$/.test(paintHex)) {
    save.carPaints[carId] = paintHex;
    save.carCustoms[carId] = { ...prev, paintHex };
  }
  writeSave(save);
  return save;
}

export function getCarCustomConfig(save: SaveData, carId: CarId): CarCustomConfig {
  const existing = save.carCustoms?.[carId];
  const legacyPaint = save.carPaints?.[carId];
  return {
    ...DEFAULT_CAR_CUSTOM,
    ...(existing ?? {}),
    paintHex: existing?.paintHex ?? legacyPaint,
  };
}

export function updateCarCustomConfig(
  carId: CarId,
  patch: Partial<Omit<CarCustomConfig, "engineLevel" | "handlingLevel" | "brakeLevel">>,
): SaveData | null {
  const save = loadSave();
  if (!save.ownedCars.includes(carId)) return null;
  if (!save.carCustoms) save.carCustoms = {};
  const next = { ...getCarCustomConfig(save, carId), ...patch };
  if (patch.paintHex === undefined && "paintHex" in patch) {
    delete save.carPaints[carId];
  } else if (next.paintHex && /^#[0-9a-fA-F]{6}$/.test(next.paintHex)) {
    save.carPaints[carId] = next.paintHex;
  }
  save.carCustoms[carId] = next;
  writeSave(save);
  return save;
}

export function upgradeCarTuning(carId: CarId, stat: "engine" | "handling" | "brake"): SaveData | null {
  const save = loadSave();
  if (!save.ownedCars.includes(carId)) return null;
  const cur = getCarCustomConfig(save, carId);
  const key = stat === "engine" ? "engineLevel" : stat === "handling" ? "handlingLevel" : "brakeLevel";
  const lvl = cur[key];
  if (lvl >= 3) return null;
  const cost = CAR_TUNING_COSTS[stat][lvl];
  if (save.currencies.credits < cost) return null;
  save.currencies.credits -= cost;
  if (!save.carCustoms) save.carCustoms = {};
  save.carCustoms[carId] = { ...cur, [key]: lvl + 1 };
  writeSave(save);
  return save;
}

export function purchaseApartment(id: ApartmentId): SaveData | null {
  const def = APARTMENTS.find((a) => a.id === id);
  if (!def) return null;
  const save = loadSave();
  const owned = save.ownedApartments ?? [];
  if (owned.includes(id)) return null;
  if (save.currencies.credits < def.price) return null;
  save.currencies.credits -= def.price;
  save.ownedApartments = [...owned, id];
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

export function recordDiscoveredDistrict(districtId: string): boolean {
  const save = loadSave();
  const list = save.discoveredDistricts ?? [];
  if (list.includes(districtId)) return false;
  save.discoveredDistricts = [...list, districtId];
  writeSave(save);
  return true;
}

export function recordSpeedTrapBest(trapId: string, kmh: number): void {
  const save = loadSave();
  const map = save.speedTrapBests ?? {};
  if (kmh > (map[trapId] ?? 0)) {
    save.speedTrapBests = { ...map, [trapId]: kmh };
    writeSave(save);
  }
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
  rank?: "S" | "A" | "B" | "C";
  accuracyPct?: number;
  headshots?: number;
  durationSec?: number;
  difficulty?: DifficultyMode;
}

export function setDifficultyMode(mode: DifficultyMode): SaveData {
  const save = loadSave();
  save.difficulty = mode;
  writeSave(save);
  return save;
}

export function previewMissionBaseReward(missionId: number, difficulty: DifficultyMode = "operative"): Currencies {
  const mult = DIFFICULTY_PROFILES[difficulty]?.rewardMult ?? 1;
  if (missionId === 0) return { credits: Math.round(40 * mult), intel: 8, salvage: 8 };
  return {
    credits: Math.round((120 + missionId * 55) * mult),
    intel: Math.round((15 + missionId * 8) * mult),
    salvage: Math.round((18 + missionId * 9) * mult),
  };
}

export function awardMissionReward(
  missionId: number,
  kills: number,
  stealthKills: number,
  alerts: number,
  success: boolean,
  stats?: { shotsFired?: number; shotsHit?: number; headshots?: number; durationSec?: number },
): { save: SaveData; reward: MissionReward } {
  const save = loadSave();
  const difficulty: DifficultyMode = save.difficulty ?? "operative";
  const mult = DIFFICULTY_PROFILES[difficulty]?.rewardMult ?? 1;
  const fired = stats?.shotsFired ?? 0;
  const hit = stats?.shotsHit ?? 0;
  const accuracyPct = fired > 0 ? Math.min(100, Math.round((hit / fired) * 100)) : 100;
  const headshots = stats?.headshots ?? 0;
  const durationSec = Math.max(0, Math.round(stats?.durationSec ?? 0));

  if (!success) {
    // Partial salvage/intel on abort or KIA so runs still progress slightly
    const reward: MissionReward = {
      credits: kills * 8 + stealthKills * 6,
      intel: stealthKills * 3,
      salvage: kills * 3,
      ghostBonus: false,
      accuracyPct,
      headshots,
      durationSec,
      difficulty,
    };
    save.currencies.credits += reward.credits;
    save.currencies.intel += reward.intel;
    save.currencies.salvage += reward.salvage;
    writeSave(save);
    return { save, reward };
  }

  const base = previewMissionBaseReward(missionId, difficulty);
  const ghostBonus = missionId > 0 && alerts === 0;
  let score = 0;
  if (alerts === 0) score += 45;
  else if (alerts === 1) score += 22;
  if (accuracyPct >= 55) score += 20;
  else if (accuracyPct >= 35) score += 10;
  if (stealthKills >= 2 || headshots >= 2) score += 15;
  if (durationSec > 0 && durationSec <= 300) score += 20;
  else if (durationSec <= 480) score += 10;
  const rank: "S" | "A" | "B" | "C" = score >= 80 ? "S" : score >= 55 ? "A" : score >= 30 ? "B" : "C";

  const reward: MissionReward = {
    credits: base.credits + Math.round((kills * 10 + stealthKills * 14 + (ghostBonus ? 120 : 0)) * mult),
    intel: base.intel + stealthKills * 5 + (ghostBonus ? 35 : 0),
    salvage: base.salvage + kills * 4 + (ghostBonus ? 20 : 0),
    ghostBonus,
    rank,
    accuracyPct,
    headshots,
    durationSec,
    difficulty,
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

export function recordSurveillanceContract(
  contractId: string,
  rewardCredits: number,
  unseen: boolean,
  deepSea: boolean,
  elapsedSec: number,
): SaveData {
  const save = loadSave();
  save.currencies.credits += Math.max(0, Math.floor(rewardCredits));
  save.currencies.intel += unseen ? 40 : 20;
  if (!save.surveillanceRecords) save.surveillanceRecords = {};
  const prev = save.surveillanceRecords[contractId];
  save.surveillanceRecords[contractId] = {
    completed: true,
    unseen: Boolean(prev?.unseen || unseen),
    deepSea: Boolean(prev?.deepSea || deepSea),
    bestTimeSec:
      prev?.bestTimeSec != null
        ? Math.min(prev.bestTimeSec, Math.round(elapsedSec))
        : Math.round(elapsedSec),
  };
  writeSave(save);
  return save;
}
