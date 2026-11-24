/**
 * Selectable player characters (Microsoft Rocketbox, MIT — see
 * src/assets/NOTICE.md). GLBs live in public/characters/ so they are served
 * as separate files instead of being inlined into the single-file build.
 * Build them with scripts/build-characters.sh.
 */
export interface CharacterDef {
  id: string;
  name: string;
  blurb: string;
}

export const CHARACTERS: CharacterDef[] = [
  { id: "military", name: "Military", blurb: "Full camo kit, helmet and vest." },
  { id: "civilian", name: "Civilian", blurb: "Jacket and jeans." },
  { id: "police", name: "Police", blurb: "Uniform and cap." },
  { id: "security", name: "Security", blurb: "Guard uniform." },
  { id: "construction", name: "Construction", blurb: "Hi-vis workwear." },
  { id: "firefighter", name: "Firefighter", blurb: "Turnout gear." },
  { id: "business", name: "Business", blurb: "Suit and tie." },
  { id: "sports", name: "Sports", blurb: "Athletic kit." },
  { id: "delivery", name: "Delivery", blurb: "Courier uniform." },
  { id: "woman", name: "Woman", blurb: "Casual outfit." },
  { id: "police-woman", name: "Policewoman", blurb: "Uniform and cap." },
  { id: "sportswoman", name: "Sportswoman", blurb: "Athletic kit." },
];

export const DEFAULT_CHARACTER = "military";
export const CHARACTER_KEY = "vanguard_character";

const base = (import.meta as { env?: { BASE_URL?: string } }).env?.BASE_URL || "/";

export function characterUrl(id: string): string {
  return `${base}characters/${id}.glb`;
}

export function characterPreview(id: string): string {
  return `${base}characters/previews/${id}.png`;
}

export function loadCharacterId(): string {
  try {
    const saved = localStorage.getItem(CHARACTER_KEY);
    if (saved && CHARACTERS.some((c) => c.id === saved)) return saved;
  } catch {
    /* storage unavailable */
  }
  return DEFAULT_CHARACTER;
}

export function saveCharacterId(id: string): void {
  try {
    localStorage.setItem(CHARACTER_KEY, id);
  } catch {
    /* storage unavailable */
  }
}
