import type { DistrictInfo } from "../city/WestgateTerrain";
import type { TrafficId } from "./catalog";

export type VehicleValueTier = "economy" | "midrange" | "commercial" | "premium" | "exotic";

export interface VehicleValueInfo {
  approxValueUsd: number;
  tier: VehicleValueTier;
  label: string;
}

/**
 * Approximate street value (USD) and market tier for every vehicle model.
 * Drives district-weighted NPC spawning and parked car distribution.
 */
export const VEHICLE_VALUES: Record<TrafficId, VehicleValueInfo> = {
  hatch: { approxValueUsd: 9500, tier: "economy", label: "Subcompact" },
  compact: { approxValueUsd: 12500, tier: "economy", label: "Economy Sedan" },
  sedan: { approxValueUsd: 14000, tier: "economy", label: "90s Saloon" },
  taxi: { approxValueUsd: 16500, tier: "economy", label: "Fleet Cab" },
  van: { approxValueUsd: 26000, tier: "midrange", label: "Utility Van" },
  golf: { approxValueUsd: 24000, tier: "midrange", label: "Hot Hatch" },
  crossover: { approxValueUsd: 29500, tier: "midrange", label: "Family Crossover" },
  offroad: { approxValueUsd: 34000, tier: "midrange", label: "Utility 4x4" },
  delivery: { approxValueUsd: 44000, tier: "commercial", label: "Delivery Box Truck" },
  mustang: { approxValueUsd: 46000, tier: "midrange", label: "Muscle Coupe" },
  challenger: { approxValueUsd: 52000, tier: "midrange", label: "V8 Muscle" },
  police_cruiser: { approxValueUsd: 48000, tier: "midrange", label: "Patrol Cruiser" },
  ambulance: { approxValueUsd: 88000, tier: "commercial", label: "EMS Ambulance" },
  garbage_truck: { approxValueUsd: 92000, tier: "commercial", label: "Sanitation Truck" },
  kraz: { approxValueUsd: 78000, tier: "commercial", label: "Industrial 6x6" },
  semi: { approxValueUsd: 96000, tier: "commercial", label: "Highway Rig" },
  firetruck: { approxValueUsd: 135000, tier: "commercial", label: "Fire Engine" },
  audi: { approxValueUsd: 118000, tier: "premium", label: "Executive Wagon" },
  rangerover: { approxValueUsd: 128000, tier: "premium", label: "Luxury SUV" },
  mercedes: { approxValueUsd: 142000, tier: "premium", label: "Flagship Sedan" },
  r8: { approxValueUsd: 188000, tier: "exotic", label: "Mid-Engine Exotic" },
  ferrari: { approxValueUsd: 265000, tier: "exotic", label: "Italian Supercar" },
};

export function getVehicleApproxValue(id: TrafficId): VehicleValueInfo {
  return VEHICLE_VALUES[id];
}

export type DistrictId = DistrictInfo["id"];

/**
 * Baseline district affluence (0 = working-class/industrial, 1 = ultra-wealthy hills).
 * Modulates value-tier affinity cleanly across Westgate Bay.
 */
const DISTRICT_AFFLUENCE: Record<DistrictId, number> = {
  east_port: 0.12,
  old_quarter: 0.25,
  south_airport: 0.42,
  midtown: 0.48,
  downtown: 0.62,
  west_coast: 0.72,
  foothills: 0.92,
  ocean: 0.5,
};

/**
 * Base probability weights per district before road-tier & value-affluence adjustments.
 * Zero entries explicitly forbid vehicles that do not belong (e.g. exotics at the docks).
 */
const DISTRICT_MODEL_WEIGHTS: Record<DistrictId, Partial<Record<TrafficId, number>>> = {
  east_port: {
    compact: 22,
    hatch: 18,
    sedan: 22,
    offroad: 10,
    crossover: 8,
    van: 9,
    delivery: 10,
    garbage_truck: 3.5,
    golf: 4,
    taxi: 2,
    kraz: 9,
    semi: 8,
    mustang: 1,
    rangerover: 0.4,
  },
  old_quarter: {
    compact: 25,
    hatch: 23,
    sedan: 21,
    crossover: 16,
    van: 6.5,
    delivery: 3.5,
    offroad: 7,
    golf: 9,
    taxi: 4,
    mustang: 1.8,
    challenger: 1.2,
    audi: 0.8,
    rangerover: 0.6,
  },
  midtown: {
    compact: 20,
    hatch: 16,
    sedan: 18,
    crossover: 15,
    van: 6,
    delivery: 4.5,
    taxi: 14,
    golf: 8,
    offroad: 4,
    mustang: 2.5,
    challenger: 1.8,
    audi: 2.8,
    rangerover: 2.4,
    mercedes: 2.2,
    r8: 0.4,
  },
  downtown: {
    taxi: 21,
    compact: 17,
    sedan: 17,
    hatch: 11,
    crossover: 11,
    van: 5.5,
    delivery: 4,
    golf: 6,
    offroad: 2.5,
    mustang: 2.5,
    challenger: 2.0,
    audi: 6.5,
    mercedes: 7.0,
    rangerover: 5.5,
    r8: 1.1,
    ferrari: 0.7,
  },
  south_airport: {
    taxi: 24,
    compact: 17,
    sedan: 17,
    crossover: 16,
    hatch: 10,
    van: 7.5,
    delivery: 6.5,
    golf: 5,
    offroad: 4,
    mercedes: 4.5,
    rangerover: 4.0,
    audi: 3.0,
    mustang: 1.5,
    semi: 5,
    kraz: 2.5,
  },
  west_coast: {
    compact: 14,
    hatch: 13,
    sedan: 13,
    crossover: 14,
    van: 4,
    offroad: 10,
    golf: 9,
    taxi: 7,
    mustang: 7.5,
    challenger: 5.5,
    rangerover: 6.5,
    audi: 4.5,
    mercedes: 4.5,
    r8: 2.2,
    ferrari: 1.8,
  },
  foothills: {
    compact: 7,
    hatch: 5,
    sedan: 8,
    crossover: 10,
    offroad: 12,
    golf: 6,
    taxi: 2,
    mustang: 5.5,
    challenger: 4.5,
    rangerover: 14,
    mercedes: 12,
    audi: 10,
    r8: 6.5,
    ferrari: 5.5,
  },
  ocean: {
    compact: 20,
    sedan: 20,
    crossover: 15,
    offroad: 15,
  },
};

export interface SpawnContext {
  districtId: DistrictId;
  roadTier?: string;
  isParked?: boolean;
}

/**
 * Computes normalized or raw spawn weights for each candidate vehicle model
 * given the geographic district, road tier, and parked/moving state.
 */
export function computeLocationSpawnWeights(ctx: SpawnContext): Map<TrafficId, number> {
  const base = DISTRICT_MODEL_WEIGHTS[ctx.districtId] ?? DISTRICT_MODEL_WEIGHTS.old_quarter;
  const affluence = DISTRICT_AFFLUENCE[ctx.districtId] ?? 0.4;
  const isFreeway = ctx.roadTier === "freeway";
  const isParked = !!ctx.isParked;

  const weights = new Map<TrafficId, number>();

  for (const [rawId, rawW] of Object.entries(base) as Array<[TrafficId, number]>) {
    if (!rawW || rawW <= 0) continue;
    let w = rawW;
    const val = VEHICLE_VALUES[rawId];

    // Value-affinity multiplier: smooth bell-like bias matching car value to district affluence
    // Normalized car price in [0..1] across $9.5k .. $265k (log scale so $10k vs $30k vs $200k feels natural)
    const logNorm = Math.max(
      0,
      Math.min(1, (Math.log10(val.approxValueUsd) - 3.95) / (5.43 - 3.95)),
    );
    if (val.tier === "commercial") {
      // Commercial trucks depend on road tier rather than affluence
      if (isParked) continue;
      w *= isFreeway ? 1.85 : ctx.districtId === "east_port" ? 1.15 : 0.18;
    } else {
      const distMatch = 1 - Math.abs(affluence - logNorm);
      // Keep economy cars present everywhere (even Beverly Hills has staff/commuters),
      // while strongly suppressing expensive/exotic spawns in low-affluence areas.
      const valueBias = val.tier === "economy" ? 0.72 + 0.55 * distMatch : 0.35 + 1.3 * distMatch;
      w *= valueBias;
    }

    if (isFreeway) {
      if (rawId === "taxi") w *= 0.45;
      else if (rawId === "hatch") w *= 0.75;
      else if (rawId === "sedan" || rawId === "crossover") w *= 1.25;
    }

    if (isParked) {
      if (rawId === "taxi") w *= 0.35;
      if (val.tier === "exotic" && ctx.districtId !== "foothills" && ctx.districtId !== "west_coast") {
        w *= 0.45;
      }
    }

    if (w > 0.01) weights.set(rawId, w);
  }

  return weights;
}

/**
 * Samples a vehicle model using location + value probabilities combined with
 * spatial anti-clustering (so adjacent cars remain visually varied).
 */
export function chooseLocationTrafficModel(
  ctx: SpawnContext,
  nearbySpawned: ReadonlyArray<{ x: number; z: number; id: TrafficId }>,
  x: number,
  z: number,
  random: () => number = Math.random,
): TrafficId {
  const weights = computeLocationSpawnWeights(ctx);
  if (weights.size === 0) return "compact";

  // Penalize duplicates within 160m so streets never look cloned
  const counts = new Map<TrafficId, number>();
  let nearestId: TrafficId | null = null;
  let nearestD2 = 160 * 160;
  for (let i = 0; i < nearbySpawned.length; i++) {
    const s = nearbySpawned[i];
    const dx = s.x - x;
    const dz = s.z - z;
    const d2 = dx * dx + dz * dz;
    if (d2 <= 160 * 160) {
      counts.set(s.id, (counts.get(s.id) ?? 0) + 1);
      if (d2 < nearestD2) {
        nearestD2 = d2;
        nearestId = s.id;
      }
    }
  }

  const adjusted: Array<{ id: TrafficId; w: number }> = [];
  let total = 0;
  for (const [id, baseW] of weights.entries()) {
    const repeatCount = counts.get(id) ?? 0;
    let factor = Math.pow(0.62, repeatCount);
    if (id === nearestId && weights.size > 1) factor *= 0.35;
    const w = baseW * factor;
    if (w > 0) {
      adjusted.push({ id, w });
      total += w;
    }
  }

  if (total <= 0) return "compact";
  let r = random() * total;
  for (let i = 0; i < adjusted.length; i++) {
    r -= adjusted[i].w;
    if (r <= 0) return adjusted[i].id;
  }
  return adjusted[adjusted.length - 1].id;
}
