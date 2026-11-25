/**
 * Open-source 3D house & residential building GLB catalog (`public/models/houses/`).
 *
 * Includes 5 CC0 / MIT open-source packs:
 *  1. Kenney City Kit (Suburban) 2.0 — 21 houses + 19 yard/fence/driveway props (CC0 1.0)
 *  2. Kenney Modular Buildings 2.1 — 3 sample houses, 4 sample towers + 101 modular pieces (CC0 1.0)
 *  3. Quaternius Buildings Pack 2 — House1, House2 + 7 multi-unit buildings (CC0 1.0 / MIT)
 *  4. Quaternius Buildings Pack 3 — 1–6 story houses, townhouses & apartments (CC0 1.0 / MIT)
 *  5. Quaternius Medieval Village Pack — 4 cottages + Inn, Mill, Sawmill, Stable, Blacksmith, Bell Tower (CC0 1.0 / MIT)
 */

export type HousePackId =
  | "kenney-suburban"
  | "kenney-modular"
  | "quaternius-buildings-2"
  | "quaternius-buildings-3"
  | "quaternius-medieval";

export interface HouseModelSpec {
  /** Path relative to `public/models/` (passed directly to `loadCityGlb` / `attachGlbToGroup`). */
  file: string;
  pack: HousePackId;
  category: "suburban" | "townhouse" | "apartment" | "cottage";
  /** Local Y rotation offset so the main facade faces `+Z`. */
  yawOffset?: number;
}

const KENNEY_SUBURBAN_LETTERS = [
  "a", "b", "c", "d", "e", "f", "g", "h", "i", "j", "k",
  "l", "m", "n", "o", "p", "q", "r", "s", "t", "u",
] as const;

export const KENNEY_SUBURBAN_HOUSES: HouseModelSpec[] = KENNEY_SUBURBAN_LETTERS.map((letter) => ({
  file: `houses/kenney-suburban/building-type-${letter}.glb`,
  pack: "kenney-suburban",
  category: "suburban",
  yawOffset: Math.PI,
}));

export const KENNEY_SUBURBAN_YARD_PROPS = [
  "houses/kenney-suburban/driveway-long.glb",
  "houses/kenney-suburban/driveway-short.glb",
  "houses/kenney-suburban/fence-1x2.glb",
  "houses/kenney-suburban/fence-1x3.glb",
  "houses/kenney-suburban/fence-1x4.glb",
  "houses/kenney-suburban/fence-2x2.glb",
  "houses/kenney-suburban/fence-2x3.glb",
  "houses/kenney-suburban/fence-3x2.glb",
  "houses/kenney-suburban/fence-3x3.glb",
  "houses/kenney-suburban/fence-low.glb",
  "houses/kenney-suburban/fence.glb",
  "houses/kenney-suburban/path-long.glb",
  "houses/kenney-suburban/path-short.glb",
  "houses/kenney-suburban/path-stones-long.glb",
  "houses/kenney-suburban/path-stones-messy.glb",
  "houses/kenney-suburban/path-stones-short.glb",
  "houses/kenney-suburban/planter.glb",
  "houses/kenney-suburban/tree-large.glb",
  "houses/kenney-suburban/tree-small.glb",
] as const;

export const KENNEY_MODULAR_SAMPLE_BUILDINGS: HouseModelSpec[] = [
  { file: "houses/kenney-modular/building-sample-house-a.glb", pack: "kenney-modular", category: "suburban", yawOffset: 0 },
  { file: "houses/kenney-modular/building-sample-house-b.glb", pack: "kenney-modular", category: "townhouse", yawOffset: 0 },
  { file: "houses/kenney-modular/building-sample-house-c.glb", pack: "kenney-modular", category: "townhouse", yawOffset: 0 },
  { file: "houses/kenney-modular/building-sample-tower-a.glb", pack: "kenney-modular", category: "apartment", yawOffset: 0 },
  { file: "houses/kenney-modular/building-sample-tower-b.glb", pack: "kenney-modular", category: "apartment", yawOffset: 0 },
  { file: "houses/kenney-modular/building-sample-tower-c.glb", pack: "kenney-modular", category: "apartment", yawOffset: 0 },
  { file: "houses/kenney-modular/building-sample-tower-d.glb", pack: "kenney-modular", category: "apartment", yawOffset: 0 },
];

export const QUATERNIUS_PACK2_BUILDINGS: HouseModelSpec[] = [
  { file: "houses/quaternius-buildings-2/House1.glb", pack: "quaternius-buildings-2", category: "suburban", yawOffset: 0 },
  { file: "houses/quaternius-buildings-2/House2.glb", pack: "quaternius-buildings-2", category: "suburban", yawOffset: Math.PI },
  { file: "houses/quaternius-buildings-2/Building1_Small.glb", pack: "quaternius-buildings-2", category: "townhouse", yawOffset: 0 },
  { file: "houses/quaternius-buildings-2/Building1_Large.glb", pack: "quaternius-buildings-2", category: "apartment", yawOffset: 0 },
  { file: "houses/quaternius-buildings-2/Building2_Small.glb", pack: "quaternius-buildings-2", category: "townhouse", yawOffset: 0 },
  { file: "houses/quaternius-buildings-2/Building2_Large.glb", pack: "quaternius-buildings-2", category: "apartment", yawOffset: 0 },
  { file: "houses/quaternius-buildings-2/Building3_Small.glb", pack: "quaternius-buildings-2", category: "townhouse", yawOffset: 0 },
  { file: "houses/quaternius-buildings-2/Building3_Big.glb", pack: "quaternius-buildings-2", category: "apartment", yawOffset: 0 },
  { file: "houses/quaternius-buildings-2/Building4.glb", pack: "quaternius-buildings-2", category: "apartment", yawOffset: 0 },
];

export const QUATERNIUS_PACK3_BUILDINGS: HouseModelSpec[] = [
  { file: "houses/quaternius-buildings-3/1Story_GableRoof_Mat.glb", pack: "quaternius-buildings-3", category: "suburban", yawOffset: 0 },
  { file: "houses/quaternius-buildings-3/1Story_Mat.glb", pack: "quaternius-buildings-3", category: "suburban", yawOffset: 0 },
  { file: "houses/quaternius-buildings-3/1Story_RoundRoof_Mat.glb", pack: "quaternius-buildings-3", category: "suburban", yawOffset: 0 },
  { file: "houses/quaternius-buildings-3/1Story_Sign_Mat.glb", pack: "quaternius-buildings-3", category: "townhouse", yawOffset: 0 },
  { file: "houses/quaternius-buildings-3/2Story_2_Mat.glb", pack: "quaternius-buildings-3", category: "townhouse", yawOffset: 0 },
  { file: "houses/quaternius-buildings-3/2Story_Balcony_Mat.glb", pack: "quaternius-buildings-3", category: "townhouse", yawOffset: Math.PI },
  { file: "houses/quaternius-buildings-3/2Story_Center_Mat.glb", pack: "quaternius-buildings-3", category: "townhouse", yawOffset: 0 },
  { file: "houses/quaternius-buildings-3/2Story_Columns_Mat.glb", pack: "quaternius-buildings-3", category: "townhouse", yawOffset: 0 },
  { file: "houses/quaternius-buildings-3/2Story_Double_Mat.glb", pack: "quaternius-buildings-3", category: "townhouse", yawOffset: 0 },
  { file: "houses/quaternius-buildings-3/2Story_GableRoof_Mat.glb", pack: "quaternius-buildings-3", category: "suburban", yawOffset: 0 },
  { file: "houses/quaternius-buildings-3/2Story_Mat.glb", pack: "quaternius-buildings-3", category: "townhouse", yawOffset: 0 },
  { file: "houses/quaternius-buildings-3/2Story_RoundRoof_Mat.glb", pack: "quaternius-buildings-3", category: "townhouse", yawOffset: 0 },
  { file: "houses/quaternius-buildings-3/2Story_Sidehouse_Mat.glb", pack: "quaternius-buildings-3", category: "suburban", yawOffset: 0 },
  { file: "houses/quaternius-buildings-3/2Story_Sign_Mat.glb", pack: "quaternius-buildings-3", category: "townhouse", yawOffset: 0 },
  { file: "houses/quaternius-buildings-3/2Story_Slim_Mat.glb", pack: "quaternius-buildings-3", category: "townhouse", yawOffset: 0 },
  { file: "houses/quaternius-buildings-3/2Story_Stairs_Mat.glb", pack: "quaternius-buildings-3", category: "townhouse", yawOffset: 0 },
  { file: "houses/quaternius-buildings-3/2Story_Wide_2Doors_Mat.glb", pack: "quaternius-buildings-3", category: "townhouse", yawOffset: 0 },
  { file: "houses/quaternius-buildings-3/2Story_Wide_Mat.glb", pack: "quaternius-buildings-3", category: "townhouse", yawOffset: 0 },
  { file: "houses/quaternius-buildings-3/3Story_Balcony_Mat.glb", pack: "quaternius-buildings-3", category: "apartment", yawOffset: Math.PI },
  { file: "houses/quaternius-buildings-3/3Story_Slim_Mat.glb", pack: "quaternius-buildings-3", category: "apartment", yawOffset: 0 },
  { file: "houses/quaternius-buildings-3/3Story_Small_Mat.glb", pack: "quaternius-buildings-3", category: "apartment", yawOffset: 0 },
  { file: "houses/quaternius-buildings-3/4Story_Center_Mat.glb", pack: "quaternius-buildings-3", category: "apartment", yawOffset: 0 },
  { file: "houses/quaternius-buildings-3/4Story_Mat.glb", pack: "quaternius-buildings-3", category: "apartment", yawOffset: 0 },
  { file: "houses/quaternius-buildings-3/4Story_Wide_2Doors_Mat.glb", pack: "quaternius-buildings-3", category: "apartment", yawOffset: 0 },
  { file: "houses/quaternius-buildings-3/4Story_Wide_2Doors_Roof_Mat.glb", pack: "quaternius-buildings-3", category: "apartment", yawOffset: 0 },
  { file: "houses/quaternius-buildings-3/6Story_Stack_Mat.glb", pack: "quaternius-buildings-3", category: "apartment", yawOffset: 0 },
];

export const QUATERNIUS_MEDIEVAL_BUILDINGS: HouseModelSpec[] = [
  { file: "houses/quaternius-medieval/House_1.glb", pack: "quaternius-medieval", category: "cottage", yawOffset: 0 },
  { file: "houses/quaternius-medieval/House_2.glb", pack: "quaternius-medieval", category: "cottage", yawOffset: 0 },
  { file: "houses/quaternius-medieval/House_3.glb", pack: "quaternius-medieval", category: "cottage", yawOffset: 0 },
  { file: "houses/quaternius-medieval/House_4.glb", pack: "quaternius-medieval", category: "cottage", yawOffset: 0 },
  { file: "houses/quaternius-medieval/Inn.glb", pack: "quaternius-medieval", category: "cottage", yawOffset: 0 },
  { file: "houses/quaternius-medieval/Mill.glb", pack: "quaternius-medieval", category: "cottage", yawOffset: 0 },
  { file: "houses/quaternius-medieval/Sawmill.glb", pack: "quaternius-medieval", category: "cottage", yawOffset: 0 },
  { file: "houses/quaternius-medieval/Stable.glb", pack: "quaternius-medieval", category: "cottage", yawOffset: 0 },
  { file: "houses/quaternius-medieval/Blacksmith.glb", pack: "quaternius-medieval", category: "cottage", yawOffset: 0 },
  { file: "houses/quaternius-medieval/Bell_Tower.glb", pack: "quaternius-medieval", category: "cottage", yawOffset: 0 },
];

export const ALL_STANDALONE_HOUSE_MODELS: HouseModelSpec[] = [
  ...KENNEY_SUBURBAN_HOUSES,
  ...KENNEY_MODULAR_SAMPLE_BUILDINGS,
  ...QUATERNIUS_PACK2_BUILDINGS,
  ...QUATERNIUS_PACK3_BUILDINGS,
  ...QUATERNIUS_MEDIEVAL_BUILDINGS,
];

const SUBURBAN_POOL: HouseModelSpec[] = [
  ...KENNEY_SUBURBAN_HOUSES,
  KENNEY_MODULAR_SAMPLE_BUILDINGS[0],
  KENNEY_MODULAR_SAMPLE_BUILDINGS[1],
  KENNEY_MODULAR_SAMPLE_BUILDINGS[2],
  QUATERNIUS_PACK2_BUILDINGS[0], // House1
  QUATERNIUS_PACK2_BUILDINGS[1], // House2
  ...QUATERNIUS_PACK3_BUILDINGS.filter((b) => b.category === "suburban"),
];

const COASTAL_VILLA_POOL: HouseModelSpec[] = [
  QUATERNIUS_PACK2_BUILDINGS[1], // House2
  QUATERNIUS_PACK2_BUILDINGS[0], // House1
  ...QUATERNIUS_PACK3_BUILDINGS.filter((b) => b.file.includes("2Story_Balcony") || b.file.includes("2Story_Double") || b.file.includes("2Story_Columns")),
  ...KENNEY_SUBURBAN_HOUSES.filter((_, i) => i % 2 === 0),
];

const FOOTHILLS_POOL: HouseModelSpec[] = [
  ...KENNEY_SUBURBAN_HOUSES,
  QUATERNIUS_PACK2_BUILDINGS[0],
  QUATERNIUS_PACK2_BUILDINGS[1],
  QUATERNIUS_MEDIEVAL_BUILDINGS[0],
  QUATERNIUS_MEDIEVAL_BUILDINGS[1],
  QUATERNIUS_MEDIEVAL_BUILDINGS[2],
  QUATERNIUS_MEDIEVAL_BUILDINGS[4], // Inn
];

const TOWNHOUSE_POOL: HouseModelSpec[] = [
  ...QUATERNIUS_PACK3_BUILDINGS.filter((b) => b.category === "townhouse" || b.category === "apartment"),
  ...QUATERNIUS_PACK2_BUILDINGS.filter((b) => b.category === "townhouse" || b.category === "apartment"),
  ...KENNEY_MODULAR_SAMPLE_BUILDINGS.slice(1),
];

/**
 * Deterministically selects an open-source house GLB suited to the given district & seed.
 */
export function pickHouseModelForLot(seed: number, districtId?: string): HouseModelSpec {
  const s = Math.abs(Math.floor(seed));
  if (districtId === "west_coast") {
    return COASTAL_VILLA_POOL[s % COASTAL_VILLA_POOL.length];
  }
  if (districtId === "foothills") {
    return FOOTHILLS_POOL[s % FOOTHILLS_POOL.length];
  }
  return SUBURBAN_POOL[s % SUBURBAN_POOL.length];
}

/**
 * Deterministically selects a multi-story residential townhouse/apartment GLB.
 */
export function pickTownhouseModel(seed: number): HouseModelSpec {
  const s = Math.abs(Math.floor(seed));
  return TOWNHOUSE_POOL[s % TOWNHOUSE_POOL.length];
}
