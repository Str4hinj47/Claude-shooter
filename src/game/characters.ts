/**
 * Playable protagonist & NPC character registry (Microsoft Rocketbox, MIT — see
 * src/assets/NOTICE.md). GLBs live in public/characters/ so they are served
 * as separate files instead of being inlined into the single-file build.
 */
export interface CharacterDef {
  id: string;
  name: string;
  blurb: string;
}

export const CHARACTERS: CharacterDef[] = [
  { id: "vanguard", name: "Vanguard Tactical", blurb: "Modular armored rig — full camo, finish, visor & gear." },
  { id: "military", name: "Military", blurb: "Full camo kit, helmet and vest." },
  { id: "civilian", name: "Civilian", blurb: "Jacket and jeans." },
  { id: "police", name: "Police", blurb: "Uniform and cap." },
  { id: "security", name: "Security", blurb: "Guard uniform." },
  { id: "construction", name: "Construction", blurb: "Hi-vis workwear." },
  { id: "firefighter", name: "Firefighter", blurb: "Turnout gear." },
  { id: "business", name: "Julian Voss", blurb: "Tailored suit & leather assassin gloves." },
  { id: "sports", name: "Sports", blurb: "Athletic kit." },
  { id: "delivery", name: "Delivery", blurb: "Courier uniform." },
];

export type SuitPresetId =
  | "noir"
  | "charcoal"
  | "midnight_navy"
  | "all_black"
  | "burgundy"
  | "ivory"
  | "slate"
  | "emerald"
  | "espresso"
  | "cobalt";

export interface SuitPresetDef {
  id: SuitPresetId;
  name: string;
  subtitle: string;
  suitColor: string;
  shirtColor: string;
  tieColor: string;
  gloveColor: string;
  gloveLabel: string;
  shoeColor: string;
}

export const SUIT_PRESETS: SuitPresetDef[] = [
  {
    id: "noir",
    name: "Signature Noir",
    subtitle: "Jet Black Suit · White Shirt · Crimson Tie",
    suitColor: "#16181e",
    shirtColor: "#f0f2f5",
    tieColor: "#9c1922",
    gloveColor: "#17171b",
    gloveLabel: "Black Calfskin Gloves",
    shoeColor: "#131418",
  },
  {
    id: "charcoal",
    name: "Continental Charcoal",
    subtitle: "Charcoal Wool · Crisp White · Onyx Silk Tie",
    suitColor: "#313640",
    shirtColor: "#edf1f5",
    tieColor: "#1a1d24",
    gloveColor: "#18191e",
    gloveLabel: "Obsidian Leather Gloves",
    shoeColor: "#14151a",
  },
  {
    id: "midnight_navy",
    name: "Savile Midnight",
    subtitle: "Midnight Navy · White Shirt · Silver Silk Tie",
    suitColor: "#1b2b47",
    shirtColor: "#f3f5f8",
    tieColor: "#8c96a6",
    gloveColor: "#281b15",
    gloveLabel: "Espresso Leather Gloves",
    shoeColor: "#1c130f",
  },
  {
    id: "all_black",
    name: "Shadow Tuxedo",
    subtitle: "Triple-Black Wool · Onyx Shirt · Satin Tie",
    suitColor: "#121318",
    shirtColor: "#1e2027",
    tieColor: "#0e0f13",
    gloveColor: "#141519",
    gloveLabel: "Matte Black Gloves",
    shoeColor: "#101114",
  },
  {
    id: "burgundy",
    name: "Imperial Burgundy",
    subtitle: "Oxblood Suit · Warm Ivory Shirt · Black Tie",
    suitColor: "#521924",
    shirtColor: "#f2ede3",
    tieColor: "#15161b",
    gloveColor: "#2c1117",
    gloveLabel: "Oxblood Calfskin Gloves",
    shoeColor: "#181214",
  },
  {
    id: "ivory",
    name: "Riviera Ivory",
    subtitle: "Cream Linen Suit · White Shirt · Espresso Tie",
    suitColor: "#dcd4c4",
    shirtColor: "#f7f6f2",
    tieColor: "#3c261b",
    gloveColor: "#4a2c19",
    gloveLabel: "Cognac Leather Gloves",
    shoeColor: "#2b1b12",
  },
  {
    id: "slate",
    name: "Steel Graphite",
    subtitle: "Steel Grey Suit · Ice Blue Shirt · Navy Tie",
    suitColor: "#5b6472",
    shirtColor: "#dce8f4",
    tieColor: "#18243a",
    gloveColor: "#17181c",
    gloveLabel: "Black Calfskin Gloves",
    shoeColor: "#141518",
  },
  {
    id: "emerald",
    name: "Forest Syndicate",
    subtitle: "Deep Emerald Suit · Cream Shirt · Gold Tie",
    suitColor: "#1c382c",
    shirtColor: "#f0ece1",
    tieColor: "#9a7a3e",
    gloveColor: "#261a14",
    gloveLabel: "Dark Walnut Gloves",
    shoeColor: "#1b130f",
  },
  {
    id: "espresso",
    name: "Espresso Tailored",
    subtitle: "Dark Chocolate Suit · Ivory Shirt · Rust Tie",
    suitColor: "#38271f",
    shirtColor: "#f2ece0",
    tieColor: "#8a3c20",
    gloveColor: "#362014",
    gloveLabel: "Saddle Brown Gloves",
    shoeColor: "#241610",
  },
  {
    id: "cobalt",
    name: "Cobalt Executive",
    subtitle: "Royal Slate-Blue · White Shirt · Crimson Tie",
    suitColor: "#243f66",
    shirtColor: "#f3f5fa",
    tieColor: "#941c24",
    gloveColor: "#17181c",
    gloveLabel: "Obsidian Leather Gloves",
    shoeColor: "#141519",
  },
];

export function getSuitPreset(id?: string): SuitPresetDef {
  return SUIT_PRESETS.find((s) => s.id === id) ?? SUIT_PRESETS[0];
}

export const DEFAULT_CHARACTER = "business";
export const CHARACTER_KEY = "vanguard_character";

const base = (import.meta as { env?: { BASE_URL?: string } }).env?.BASE_URL || "/";

export function characterUrl(id: string): string {
  return `${base}characters/${id}.glb`;
}

export function characterPreview(id: string): string {
  const previewId = id === "vanguard" ? "business" : id;
  return `${base}characters/previews/${previewId}.png`;
}

export function loadCharacterId(): string {
  return DEFAULT_CHARACTER;
}

export function saveCharacterId(_id: string): void {
  try {
    localStorage.setItem(CHARACTER_KEY, DEFAULT_CHARACTER);
  } catch {
    /* storage unavailable */
  }
}
