export type BodyStatId =
  | "speed"
  | "stamina"
  | "strength"
  | "toughness"
  | "agility"
  | "stealth"
  | "marksmanship"
  | "lung";

export type BodyStatsValues = Record<BodyStatId, number>;
export type BodyStatsXp = Record<BodyStatId, number>;

export interface BodyStatsProgress {
  values: BodyStatsValues;
  xp: BodyStatsXp;
}

export interface BodyStatDef {
  id: BodyStatId;
  name: string;
  short: string;
  accent: string;
  trainHint: string;
  bonusLabel: (val: number) => string;
}

export const BODY_STAT_DEFS: BodyStatDef[] = [
  {
    id: "speed",
    name: "Speed",
    short: "SPD",
    accent: "#38bdf8",
    trainHint: "Sprint on foot across the city or compounds",
    bonusLabel: (v) => `+${Math.round((v / 100) * 28)}% Sprint · +${Math.round((v / 100) * 14)}% Strafe`,
  },
  {
    id: "stamina",
    name: "Stamina",
    short: "STM",
    accent: "#22c55e",
    trainHint: "Sprint, swim, throw punches, and chain dodges",
    bonusLabel: (v) => `${Math.round(100 + (v / 100) * 85)} Max Pool · +${Math.round((v / 100) * 45)}% Regen`,
  },
  {
    id: "strength",
    name: "Strength",
    short: "STR",
    accent: "#ef4444",
    trainHint: "Land punches, kicks, uppercuts & CQC knockouts",
    bonusLabel: (v) => `+${Math.round((v / 100) * 60)}% Melee Damage · +${Math.round((v / 100) * 35)}% Knockback`,
  },
  {
    id: "toughness",
    name: "Toughness",
    short: "TGH",
    accent: "#f59e0b",
    trainHint: "Block incoming strikes and survive firefights",
    bonusLabel: (v) => `+${Math.round((v / 100) * 50)} Max HP · -${Math.round((v / 100) * 18)}% Damage Taken`,
  },
  {
    id: "agility",
    name: "Agility",
    short: "AGL",
    accent: "#a855f7",
    trainHint: "Slip/dodge attacks, vault cover & land Perfect Parries",
    bonusLabel: (v) => `+${Math.round((v / 100) * 25)}% Dodge Burst · -${Math.round((v / 100) * 30)}% Dodge Cost`,
  },
  {
    id: "stealth",
    name: "Stealth",
    short: "STL",
    accent: "#2dd4bf",
    trainHint: "Crouch-sneak near patrols and execute stealth takedowns",
    bonusLabel: (v) => `-${Math.round((v / 100) * 28)}% Step Noise · +${Math.round((v / 100) * 22)}% Crouch Pace`,
  },
  {
    id: "marksmanship",
    name: "Marksmanship",
    short: "MRK",
    accent: "#eab308",
    trainHint: "Land gunfire hits, precision headshots & tactical reloads",
    bonusLabel: (v) => `-${Math.round((v / 100) * 24)}% Spread & Recoil · +${Math.round((v / 100) * 20)}% Reload`,
  },
  {
    id: "lung",
    name: "Lung Capacity",
    short: "LNG",
    accent: "#06b6d4",
    trainHint: "Swim in Westgate Bay and coastal waters",
    bonusLabel: (v) => `+${Math.round((v / 100) * 35)}% Swim Speed · -${Math.round((v / 100) * 40)}% Swim Drain`,
  },
];

export const DEFAULT_BODY_STATS = (): BodyStatsProgress => ({
  values: {
    speed: 12,
    stamina: 15,
    strength: 12,
    toughness: 10,
    agility: 12,
    stealth: 10,
    marksmanship: 14,
    lung: 10,
  },
  xp: {
    speed: 0,
    stamina: 0,
    strength: 0,
    toughness: 0,
    agility: 0,
    stealth: 0,
    marksmanship: 0,
    lung: 0,
  },
});

export function sanitizeBodyStats(raw: unknown): BodyStatsProgress {
  const base = DEFAULT_BODY_STATS();
  if (!raw || typeof raw !== "object") return base;
  const r = raw as Partial<BodyStatsProgress>;
  for (const def of BODY_STAT_DEFS) {
    const id = def.id;
    const v = r.values?.[id];
    const x = r.xp?.[id];
    if (typeof v === "number" && Number.isFinite(v)) {
      base.values[id] = Math.max(0, Math.min(100, Math.floor(v)));
    }
    if (typeof x === "number" && Number.isFinite(x)) {
      base.xp[id] = Math.max(0, x);
    }
  }
  return base;
}

/** XP required to advance from level `level` -> `level + 1` (smooth early gains, rewarding mastery). */
export function xpForNextBodyLevel(level: number): number {
  return Math.round(18 + level * 1.15);
}

export interface BodyStatGainResult {
  leveledUp: boolean;
  newValue: number;
  def: BodyStatDef;
}

/**
 * Award organic XP to a body stat in-place. Returns level-up info whenever a whole point is gained.
 */
export function grantBodyStatXp(
  progress: BodyStatsProgress,
  id: BodyStatId,
  amount: number,
): BodyStatGainResult | null {
  if (amount <= 0) return null;
  const curVal = progress.values[id] ?? 0;
  if (curVal >= 100) {
    progress.xp[id] = 0;
    return null;
  }
  progress.xp[id] = (progress.xp[id] ?? 0) + amount;
  let leveledUp = false;
  while (progress.values[id] < 100) {
    const req = xpForNextBodyLevel(progress.values[id]);
    if (progress.xp[id] < req) break;
    progress.xp[id] -= req;
    progress.values[id] += 1;
    leveledUp = true;
  }
  if (progress.values[id] >= 100) progress.xp[id] = 0;
  if (!leveledUp) return null;
  const def = BODY_STAT_DEFS.find((d) => d.id === id)!;
  return { leveledUp: true, newValue: progress.values[id], def };
}

export interface BodyStatEffects {
  sprintSpeedMult: number;
  walkSpeedMult: number;
  maxStamina: number;
  staminaRegenMult: number;
  staminaDrainMult: number;
  meleeDamageMult: number;
  meleeKnockbackMult: number;
  bonusMaxHp: number;
  damageTakenMult: number;
  dodgeBurstMult: number;
  dodgeCostMult: number;
  footstepNoiseMult: number;
  crouchSpeedMult: number;
  detectSpeedMult: number;
  spreadMult: number;
  recoilMult: number;
  reloadSpeedMult: number;
  swimSpeedMult: number;
  swimDrainMult: number;
}

export function getBodyStatEffects(values: BodyStatsValues): BodyStatEffects {
  const n = (id: BodyStatId) => Math.max(0, Math.min(1, (values[id] ?? 0) / 100));
  const spd = n("speed");
  const stm = n("stamina");
  const str = n("strength");
  const tgh = n("toughness");
  const agl = n("agility");
  const stl = n("stealth");
  const mrk = n("marksmanship");
  const lng = n("lung");

  return {
    sprintSpeedMult: 1 + spd * 0.28,
    walkSpeedMult: 1 + spd * 0.14,
    maxStamina: Math.round(100 + stm * 85),
    staminaRegenMult: 1 + stm * 0.45,
    staminaDrainMult: 1 - stm * 0.35,
    meleeDamageMult: 1 + str * 0.60,
    meleeKnockbackMult: 1 + str * 0.35,
    bonusMaxHp: Math.round(tgh * 50),
    damageTakenMult: 1 - tgh * 0.18,
    dodgeBurstMult: 1 + agl * 0.25,
    dodgeCostMult: 1 - agl * 0.30,
    footstepNoiseMult: 1 - stl * 0.28,
    crouchSpeedMult: 1 + stl * 0.22,
    detectSpeedMult: 1 - stl * 0.22,
    spreadMult: 1 - mrk * 0.24,
    recoilMult: 1 - mrk * 0.25,
    reloadSpeedMult: 1 + mrk * 0.20,
    swimSpeedMult: 1 + lng * 0.35,
    swimDrainMult: 1 - lng * 0.40,
  };
}
