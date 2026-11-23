/* ------------------------------------------------------------------ */
/*  BLACK CONTRACT — Freelance Thief / Spy / Assassin Campaign         */
/*  Single source of truth for contracts, briefings, guards & props.   */
/* ------------------------------------------------------------------ */
import type { WeaponId } from "../character/rifle";
import type { SoldierAppearance } from "./progression";

export interface DialogueLine {
  speaker: string;
  text: string;
  /** seconds to show (auto-computed from length if omitted) */
  dur?: number;
}

export interface EnemySpawn {
  x: number;
  z: number;
  /** spawn height (rooftop snipers, ship deck guards) */
  y?: number;
  /** patrol waypoints (walk between them when undisturbed) */
  patrol?: [number, number][];
  /** "guard" holds position, "patrol" walks, "advance" pushes the player */
  mode?: "guard" | "patrol" | "advance";
  /** boss flag (more HP, shown in HUD) */
  boss?: boolean;
  name?: string;
}

export type InteractKind = "terminal" | "files" | "diamond" | "relic";

export interface InteractDef {
  id: string;
  objId: string;
  kind: InteractKind;
  label: string;
  duration: number;
  x: number;
  y?: number;
  z: number;
  ry?: number;
}

export interface ObjectiveDef {
  id: string;
  label: string;
  kind: "eliminate" | "destroy" | "reach" | "rescue" | "boss" | "interact";
  count?: number;
  /** reach/rescue target position */
  at?: [number, number];
}

export interface MissionDef {
  id: number;
  codename: string;
  name: string;
  client: string;
  location: string;
  timeOfDay: string;
  /** faction tint for enemies (body, visor) */
  tint: [number, number];
  tintName: string;
  /** distinct per-mission guard uniform & weapon */
  enemyAppearance?: SoldierAppearance;
  enemyWeapon?: WeaponId;
  bossAppearance?: SoldierAppearance;
  bossWeapon?: WeaponId;
  briefing: string[];
  debrief: string[];
  objectives: ObjectiveDef[];
  enemies: EnemySpawn[];
  interactables?: InteractDef[];
  /** player spawn [x,z,yawDeg] */
  spawn: [number, number, number];
  /** extraction zone [x,z,radius] */
  extraction: [number, number, number];
  /** destroyable props [x,z] */
  destroyables?: [number, number][];
  /** rescue NPC spawn [x,z] */
  rescue?: [number, number];
  /** ally NPC spawn [x,z] (fights beside you) */
  ally?: [number, number];
  /** dialogue triggers */
  intro: DialogueLine[];
  onFirstContact?: DialogueLine[];
  onHalfway?: DialogueLine[];
  onObjective?: DialogueLine[];
  onExtraction?: DialogueLine[];
  /** practice range: no enemies, free play */
  practice?: boolean;
  /** night mission: guard flashlights + illuminated streetlamps */
  night?: boolean;
  /** difficulty tuning */
  enemyHp: number;
  enemyDamage: [number, number];
  enemyAccuracy: number; // 0..1
  /** accent colour for UI */
  accent: string;
}

export const MISSIONS: MissionDef[] = [
  /* ------------------------------------------------ MISSION 0 ------ */
  {
    id: 0,
    codename: "CALIBRATION",
    name: "Safehouse Range",
    client: "Mara Vance (Broker)",
    location: "Private Safehouse — Westgate Outskirts",
    timeOfDay: "Midday",
    tint: [0xd8cdb4, 0x88ccff],
    tintName: "Voss (you)",
    briefing: [
      "Broker: Wealthy clients pay six figures for problems that vanish quietly — scrubbed servers, stolen heirlooms, silenced rivals.",
      "Zero your suppressed weapons on the safehouse steel targets before taking your first live contract.",
      "When you're ready, open Contract 1: Paper Trail. Senator Sterling's money is already in escrow.",
    ],
    debrief: ["Range zeroed. Contracts are live on the board."],
    objectives: [{ id: "free", label: "Free play — test suppressed weapons, then take Contract 1", kind: "reach", at: [0, 0] }],
    enemies: [],
    spawn: [0, 0, 0],
    extraction: [0, 0, 3],
    intro: [
      { speaker: "Broker", text: "Test the suppressors, Voss. Rich clients don't pay for noise — they pay for clean work." },
      { speaker: "Broker", text: "Whenever you're sharp, Contract 1 is waiting. Senator Sterling needs some ledgers erased." },
    ],
    practice: true,
    enemyHp: 100,
    enemyDamage: [0, 0],
    enemyAccuracy: 0,
    accent: "#f5c542",
  },

  /* ------------------------------------------------ MISSION 1 ------ */
  {
    id: 1,
    codename: "PAPER TRAIL",
    name: "Highland Estate Village",
    client: "Arthur Sterling (Senator)",
    location: "Highland Village — private syndicate safehouse",
    timeOfDay: "Dawn",
    tint: [0x5c6b47, 0xf59e0b],
    tintName: "Estate Enforcers (Olive Khaki)",
    enemyWeapon: "smg",
    enemyAppearance: {
      armorColor: "#5d6b47",
      armorFinish: "matte",
      gearColor: "#6f6148",
      visorColor: "#f59e0b",
      visorGlow: 0.45,
      weaponFinish: "coyote",
      nvg: "none",
      backpack: false,
      chestRig: true,
      holster: false,
      headset: false,
    },
    briefing: [
      "Client: Senator Arthur Sterling. His former fixer hid Sterling's offshore bank ledgers and blackmail dossiers across Highland Village.",
      "Infiltrate the shops to steal the 2 Stolen Ledger Briefcases, scrub the Archive Terminal in the north-east barn, then leave the area.",
      "11 hired enforcers patrol the square. Ghost past them or silence them quietly — then exfiltrate back to the village road.",
    ],
    debrief: [
      "Sterling's paper trail is ash and his ledgers are back in your bag. Wire transfer cleared.",
      "Next client: Countess Elena Vane. Someone stole her Blood Star Diamond — and she wants it back tonight.",
    ],
    objectives: [
      { id: "files", label: "Steal offshore ledger briefcases", kind: "interact", count: 2 },
      { id: "scrub", label: "Scrub the archive terminal", kind: "interact", count: 1 },
      { id: "extract", label: "Leave the area — village road", kind: "reach", at: [0, 44] },
    ],
    interactables: [
      { id: "m1_f1", objId: "files", kind: "files", label: "Offshore Ledger Briefcase", duration: 0.55, x: -12.5, y: 0.12, z: 8.0 },
      { id: "m1_f2", objId: "files", kind: "files", label: "Blackmail Dossier Case", duration: 0.55, x: 14.5, y: 0.12, z: 6.0 },
      { id: "m1_t1", objId: "scrub", kind: "terminal", label: "Village Archive Terminal", duration: 1.5, x: 13.0, y: 0.12, z: -28.0 },
    ],
    enemies: [
      { x: -8, z: -6, mode: "patrol", patrol: [[-8, -6], [7, -6], [7, 6], [-8, 6]] },
      { x: 9, z: 2, mode: "patrol", patrol: [[9, 2], [7, 14], [-6, 14]] },
      { x: -8.5, z: 12, mode: "guard" },
      { x: 6, z: -28, mode: "guard" },
      { x: -2, z: -26, mode: "guard" },
      { x: 10, z: -22, mode: "patrol", patrol: [[10, -22], [2, -22]] },
      { x: -8, z: -16, y: 0.12, mode: "guard" },
      { x: -16.2, z: 10, y: 0.12, mode: "guard" },
      { x: 16.5, z: 19, y: 0.12, mode: "advance" },
      { x: 14, z: 29, y: 3.36, mode: "guard" },
      { x: -1.4, z: -10.2, y: 2.4, mode: "guard" },
    ],
    spawn: [0, 44, 180],
    extraction: [0, 44, 4],
    intro: [
      { speaker: "Broker", text: "Dawn in Highland Village. Senator Sterling's ledgers are split between the east and west storefronts." },
      { speaker: "Broker", text: "Grab both cases, wipe the archive computer in the north-east barn, and get back out to the road unseen." },
    ],
    onFirstContact: [{ speaker: "Broker", text: "Enforcers spotted you! Drop them quietly or break line of sight — don't blow the ghost bonus." }],
    onObjective: [{ speaker: "Broker", text: "Files secured and archive wiped clean. Sterling's happy — now leave the area via the south road." }],
    onExtraction: [{ speaker: "Broker", text: "Clean extraction. Sterling's wire just landed. Ready for a bigger job?" }],
    enemyHp: 100,
    enemyDamage: [5, 9],
    enemyAccuracy: 0.42,
    accent: "#a8c686",
  },

  /* ------------------------------------------------ MISSION 2 ------ */
  {
    id: 2,
    codename: "GLASS VAULT",
    name: "Syndicate Construction Vault",
    client: "Countess Elena Vane",
    location: "Westgate Tower — construction site",
    timeOfDay: "Overcast day",
    tint: [0x3b424c, 0xef4444],
    tintName: "Syndicate Contractors (Charcoal & Orange)",
    enemyWeapon: "shotgun",
    enemyAppearance: {
      armorColor: "#3b424c",
      armorFinish: "tactical",
      gearColor: "#9e5222",
      visorColor: "#ef4444",
      visorGlow: 0.9,
      weaponFinish: "obsidian",
      nvg: "flipped",
      backpack: false,
      chestRig: true,
      holster: true,
      headset: true,
    },
    briefing: [
      "Client: Countess Elena Vane. A rival auction syndicate stole her priceless Blood Star Diamond and locked it inside their site office.",
      "Steal the Blood Star Diamond from its glass display, scrub 2 accounting terminals holding her family records, and destroy 3 signal jammers.",
      "13 armed contractors guard the yard and unfinished tower. Finish the heist and leave the area through the south gate.",
    ],
    debrief: [
      "The Blood Star Diamond is back in Countess Vane's private vault — along with your fee.",
      "Word travels fast in high society. Tech billionaire Julian Mercer just put a rush contract on your desk.",
    ],
    objectives: [
      { id: "diamond", label: "Steal the Blood Star Diamond", kind: "interact", count: 1 },
      { id: "scrub", label: "Scrub auction accounting terminals", kind: "interact", count: 2 },
      { id: "destroy", label: "Destroy signal jammers", kind: "destroy", count: 3 },
      { id: "extract", label: "Leave the area — construction gate", kind: "reach", at: [0, 46] },
    ],
    interactables: [
      { id: "m2_d1", objId: "diamond", kind: "diamond", label: "Blood Star Diamond", duration: 0.85, x: -15.8, y: 0.12, z: -20.0 },
      { id: "m2_t1", objId: "scrub", kind: "terminal", label: "Warehouse Ledger Terminal", duration: 1.5, x: 18.5, y: 0.12, z: 8.2 },
      { id: "m2_t2", objId: "scrub", kind: "terminal", label: "Tower Core Terminal", duration: 1.5, x: 4.0, y: 0.12, z: -15.0 },
    ],
    enemies: [
      { x: 10, z: -10, mode: "patrol", patrol: [[10, -10], [10, 10], [-10, 10]] },
      { x: -12, z: 8, mode: "guard" },
      { x: 13, z: 16, mode: "guard" },
      { x: -8, z: -28, mode: "patrol", patrol: [[-8, -28], [-14, -28]] },
      { x: 16, z: -24, mode: "guard" },
      { x: -16, z: -30, mode: "guard" },
      { x: 4, z: 24, mode: "advance" },
      { x: -14, z: 24, mode: "advance" },
      { x: -3.5, z: -18, y: 0.12, mode: "guard" },
      { x: 5.5, z: -14, y: 0.12, mode: "advance" },
      { x: 4, z: -19, y: 3.36, mode: "guard" },
      { x: -4, z: -19, y: 3.36, mode: "guard" },
      { x: 18.5, z: 4, y: 0.12, mode: "guard" },
    ],
    spawn: [0, 46, 180],
    extraction: [0, 46, 4],
    destroyables: [
      [16, -6],
      [-16, -8],
      [0, -34],
    ],
    intro: [
      { speaker: "Broker", text: "Countess Vane's Blood Star Diamond is in the west site office. Watch for the glass case." },
      { speaker: "Broker", text: "Wipe both accounting terminals, smash the three jammers, and slip back out the gate." },
    ],
    onFirstContact: [{ speaker: "Broker", text: "Shotgun security spotted you! Use the scaffolding and upper decks for cover." }],
    onObjective: [{ speaker: "Broker", text: "Diamond bagged, terminals wiped, jammers fried. Get out of the construction gate now." }],
    onExtraction: [{ speaker: "Broker", text: "Countess Vane sends her regards — plus a heavy bonus. Check the wire." }],
    enemyHp: 105,
    enemyDamage: [6, 11],
    enemyAccuracy: 0.5,
    accent: "#38bdf8",
  },

  /* ------------------------------------------------ MISSION 3 ------ */
  {
    id: 3,
    codename: "DEAD DROP",
    name: "Downtown Financial District",
    client: "Julian Mercer (Tech CEO)",
    location: "Downtown Westgate — corporate offices & avenue",
    timeOfDay: "Night",
    night: true,
    tint: [0x1a2639, 0x22d3ee],
    tintName: "Cyber-Spy Detail (Midnight Navy & Cyan NVG)",
    enemyWeapon: "smg",
    enemyAppearance: {
      armorColor: "#1a2639",
      armorFinish: "matte",
      gearColor: "#141820",
      visorColor: "#22d3ee",
      visorGlow: 1.25,
      weaponFinish: "arctic",
      nvg: "deployed",
      backpack: false,
      chestRig: true,
      holster: true,
      headset: true,
    },
    bossWeapon: "dmr",
    bossAppearance: {
      armorColor: "#14171f",
      armorFinish: "titanium",
      gearColor: "#0e7490",
      visorColor: "#38bdf8",
      visorGlow: 1.6,
      weaponFinish: "arctic",
      nvg: "deployed",
      backpack: false,
      chestRig: true,
      holster: true,
      headset: true,
    },
    briefing: [
      "Client: Tech billionaire Julian Mercer. Corporate spy broker Viktor Kroll stole Mercer's prototype drives and copied them onto an avenue mainframe.",
      "Under cover of night, steal both Prototype Briefcases from the avenue offices, scrub the Mainframe Terminal, and assassinate Viktor Kroll.",
      "15 NVG-equipped cyber-guards sweep the streets with flashlights. Complete the hit and leave the district via the south street.",
    ],
    debrief: [
      "Kroll is cold, the prototype drives are back, and the mainframe is zeroed. Mercer doubled the escrow.",
      "Next up: shipping heiress Victoria Thorne needs a rogue captain eliminated at Westgate Port.",
    ],
    objectives: [
      { id: "files", label: "Steal prototype hard-drive cases", kind: "interact", count: 2 },
      { id: "scrub", label: "Scrub the corporate mainframe", kind: "interact", count: 1 },
      { id: "boss", label: "Assassinate Broker Viktor Kroll", kind: "boss", count: 1 },
      { id: "extract", label: "Leave the area — south street", kind: "reach", at: [0, 46] },
    ],
    interactables: [
      { id: "m3_f1", objId: "files", kind: "files", label: "Prototype Drive Case Alpha", duration: 0.55, x: -6.5, y: 0.12, z: 22.2 },
      { id: "m3_f2", objId: "files", kind: "files", label: "Prototype Drive Case Beta", duration: 0.55, x: 6.5, y: 0.12, z: 20.2 },
      { id: "m3_t1", objId: "scrub", kind: "terminal", label: "Quantum Mainframe Server", duration: 1.6, x: 6.5, y: 0.12, z: -13.8 },
    ],
    enemies: [
      { x: -2, z: -4, mode: "patrol", patrol: [[-2, -4], [2, -4], [2, 12], [-2, 12]] },
      { x: 12, z: 10, mode: "guard" },
      { x: -14, z: 12, mode: "guard" },
      { x: 6.5, z: -18.2, y: 0.12, mode: "advance" },
      { x: -6.5, z: -18.2, y: 0.12, mode: "advance" },
      { x: 16, z: -22, mode: "guard" },
      { x: -16, z: -24, mode: "guard" },
      { x: 13, z: -4, y: 30, mode: "guard" },
      { x: 17, z: -4, y: 30, mode: "guard" },
      { x: -10, z: -28, y: 24, mode: "guard" },
      { x: 0, z: 26, mode: "patrol", patrol: [[0, 26], [12, 26], [12, 6]] },
      { x: -6.5, z: 22, y: 0.12, mode: "guard" },
      { x: 6.5, z: 20, y: 0.12, mode: "advance" },
      { x: -2.5, z: 2, y: 3.6, mode: "guard" },
      { x: 3.0, z: 2, y: 3.6, mode: "guard" },
      { x: 0, z: -24, mode: "guard", boss: true, name: "Viktor Kroll" },
    ],
    spawn: [0, 46, 180],
    extraction: [0, 46, 4],
    intro: [
      { speaker: "Broker", text: "Downtown Westgate, midnight. Watch the flashlight cones — Kroll's cyber-detail sweeps the avenue." },
      { speaker: "Broker", text: "Grab Mercer's two prototype cases, scrub the mainframe in the north-east office, and put Viktor Kroll down." },
    ],
    onFirstContact: [{ speaker: "Broker", text: "Flashlights locked on you! Move through the shop connectors and skybridge." }],
    onObjective: [{ speaker: "Broker", text: "Kroll is dead and Mercer's tech is safe. Exfiltrate back down the south avenue." }],
    onExtraction: [{ speaker: "Voss", text: "Contract closed. Tell Mercer the mainframe never existed." }],
    enemyHp: 115,
    enemyDamage: [7, 13],
    enemyAccuracy: 0.58,
    accent: "#22d3ee",
  },

  /* ------------------------------------------------ MISSION 4 ------ */
  {
    id: 4,
    codename: "BLACK LEDGER",
    name: "Westgate Harbor Docks",
    client: "Victoria Thorne (Shipping Heiress)",
    location: "Westgate Port — docks & cargo ship",
    timeOfDay: "Night",
    night: true,
    tint: [0x2e4052, 0xfbbf24],
    tintName: "Harbor Mercenaries (Sea-Steel & Coyote)",
    enemyWeapon: "carbine",
    enemyAppearance: {
      armorColor: "#2e4052",
      armorFinish: "tactical",
      gearColor: "#6d5c43",
      visorColor: "#fbbf24",
      visorGlow: 1.0,
      weaponFinish: "coyote",
      nvg: "flipped",
      backpack: true,
      chestRig: true,
      holster: true,
      headset: true,
    },
    bossWeapon: "shotgun",
    bossAppearance: {
      armorColor: "#1f2b38",
      armorFinish: "titanium",
      gearColor: "#854d0e",
      visorColor: "#f59e0b",
      visorGlow: 1.5,
      weaponFinish: "gold",
      nvg: "none",
      backpack: false,
      chestRig: true,
      holster: true,
      headset: true,
    },
    briefing: [
      "Client: Victoria Thorne. Rogue captain Commander Ren hijacked her private cargo yacht and plans to sell her family's gold bullion.",
      "Recover Thorne's Gold Bullion Heirloom from the dock office, scrub 2 shipping manifest terminals, burn 4 contraband crates, and assassinate Commander Ren aboard ship.",
      "13 armored harbor mercenaries patrol under the dock lights. Finish the job and escape to the extraction boat at the pier.",
    ],
    debrief: [
      "Thorne's gold is safe and Ren's body is on the cargo deck. Your reputation now reaches the highest boardrooms.",
      "An anonymous Apex Board director just wired a seven-figure retainer for a corporate takeover.",
    ],
    objectives: [
      { id: "relic", label: "Recover Thorne Gold Bullion", kind: "interact", count: 1 },
      { id: "scrub", label: "Scrub shipping manifest terminals", kind: "interact", count: 2 },
      { id: "destroy", label: "Destroy contraband cargo crates", kind: "destroy", count: 4 },
      { id: "boss", label: "Assassinate Commander Ren", kind: "boss", count: 1 },
      { id: "extract", label: "Leave the area — harbor pier boat", kind: "reach", at: [0, 48] },
    ],
    interactables: [
      { id: "m4_r1", objId: "relic", kind: "relic", label: "Thorne Gold Bullion", duration: 0.75, x: 16.0, y: 0.12, z: 24.0 },
      { id: "m4_t1", objId: "scrub", kind: "terminal", label: "Dock Manifest Terminal", duration: 1.5, x: -14.0, y: 0.12, z: 26.2 },
      { id: "m4_t2", objId: "scrub", kind: "terminal", label: "Cargo Ship Bridge Terminal", duration: 1.5, x: 0.0, y: 3.5, z: -23.0 },
    ],
    enemies: [
      { x: -12, z: -6, mode: "patrol", patrol: [[-12, -6], [12, -6], [12, 2]] },
      { x: 14, z: 13, mode: "guard" },
      { x: -16, z: 14, mode: "guard" },
      { x: 3, z: -23, y: 3.5, mode: "advance" },
      { x: -3, z: -23, y: 3.5, mode: "advance" },
      { x: 18, z: -10, mode: "guard" },
      { x: -18, z: -10, mode: "guard" },
      { x: 6, z: 24, mode: "patrol", patrol: [[6, 24], [6, 32], [-6, 32]] },
      { x: -6, z: 30, mode: "guard" },
      { x: -16.2, z: 21.8, y: 0.12, mode: "guard" },
      { x: -16.2, z: 26.2, y: 0.12, mode: "advance" },
      { x: 16.0, z: 22, y: 0.12, mode: "guard" },
      { x: 0, z: 8, y: 3.32, mode: "guard" },
      { x: 0, z: -34, y: 3.5, mode: "guard", boss: true, name: "Commander Ren" },
    ],
    spawn: [0, -10, 180],
    extraction: [0, 48, 4],
    destroyables: [
      [14, -4],
      [-14, -6],
      [10, -10],
      [-10, -8],
    ],
    intro: [
      { speaker: "Broker", text: "Westgate Docks. Victoria Thorne's gold is locked in the east office, and Ren's hiding on the cargo deck." },
      { speaker: "Broker", text: "Steal the gold back, wipe both manifest terminals, torch the four crates, and drop Ren." },
    ],
    onFirstContact: [{ speaker: "Broker", text: "Harbor mercenaries alerted! Watch the container alleys and warehouse roofs." }],
    onObjective: [{ speaker: "Broker", text: "Ren is down and the manifests are wiped. Get to the pier boat at the south end." }],
    onExtraction: [{ speaker: "Broker", text: "Boat's clear of the harbor. Thorne couldn't be happier." }],
    enemyHp: 120,
    enemyDamage: [8, 14],
    enemyAccuracy: 0.62,
    accent: "#fbbf24",
  },

  /* ------------------------------------------------ MISSION 5 ------ */
  {
    id: 5,
    codename: "HOSTILE TAKEOVER",
    name: "Apex Corporate Tower",
    client: "Anonymous Board Director",
    location: "Apex HQ — fortified compound & tower",
    timeOfDay: "Night, storm",
    night: true,
    tint: [0x1a1d24, 0xff2e3b],
    tintName: "Executive Black-Ops (Obsidian Titanium)",
    enemyWeapon: "carbine",
    enemyAppearance: {
      armorColor: "#1a1d24",
      armorFinish: "titanium",
      gearColor: "#6b1f26",
      visorColor: "#ff2e3b",
      visorGlow: 1.45,
      weaponFinish: "crimson",
      nvg: "deployed",
      backpack: false,
      chestRig: true,
      holster: true,
      headset: true,
    },
    bossWeapon: "dmr",
    bossAppearance: {
      armorColor: "#111318",
      armorFinish: "titanium",
      gearColor: "#991b1b",
      visorColor: "#ff4444",
      visorGlow: 1.8,
      weaponFinish: "gold",
      nvg: "none",
      backpack: false,
      chestRig: true,
      holster: true,
      headset: true,
    },
    briefing: [
      "Client: Anonymous Apex Board Director. Chairman Viktor Sorin recorded blackmail tapes on every board member and hoarded bearer bonds in his lobby vault.",
      "Scrub 3 Executive Terminals across the barracks and tower lobby, steal the Bearer Bonds Case, and assassinate Viktor Sorin.",
      "12 Obsidian Titanium black-ops guards sweep the storm-lit compound. Complete the takeover and escape to the North Helipad.",
    ],
    debrief: [
      "Sorin's boardroom tapes are erased and his bearer bonds are yours. Tomorrow morning the board calls it a quiet retirement.",
      "One final whisper from the Consortium remains — a billionaire cabal wants the Ironridge Black-Site scrubbed off the map.",
    ],
    objectives: [
      { id: "scrub", label: "Scrub executive blackmail terminals", kind: "interact", count: 3 },
      { id: "files", label: "Steal Sorin's bearer bonds case", kind: "interact", count: 1 },
      { id: "boss", label: "Assassinate Viktor Sorin", kind: "boss", count: 1 },
      { id: "extract", label: "Leave the area — North Tower Helipad", kind: "reach", at: [0, -43] },
    ],
    interactables: [
      { id: "m5_t1", objId: "scrub", kind: "terminal", label: "West Security Terminal", duration: 1.6, x: -20.0, y: 0.12, z: 12.2 },
      { id: "m5_t2", objId: "scrub", kind: "terminal", label: "East Security Terminal", duration: 1.6, x: 20.0, y: 0.12, z: 12.2 },
      { id: "m5_t3", objId: "scrub", kind: "terminal", label: "Executive Lobby Server", duration: 1.6, x: 3.2, y: 0.14, z: -31.0 },
      { id: "m5_f1", objId: "files", kind: "files", label: "Bearer Bonds Briefcase", duration: 0.65, x: -3.2, y: 0.14, z: -28.0 },
    ],
    enemies: [
      { x: -12, z: 10, mode: "guard" },
      { x: 12, z: 10, mode: "guard" },
      { x: -14, z: -6, mode: "advance" },
      { x: 14, z: -6, mode: "advance" },
      { x: -8, z: -24, mode: "guard" },
      { x: 8, z: -24, mode: "guard" },
      { x: -20, z: 12, y: 0.12, mode: "guard" },
      { x: 20, z: 12, y: 0.12, mode: "advance" },
      { x: -19, z: 10, y: 4.56, mode: "guard" },
      { x: 19, z: 10, y: 4.56, mode: "guard" },
      { x: -2.5, z: -31, y: 0.14, mode: "guard" },
      { x: 2.5, z: -31, y: 0.14, mode: "guard" },
      { x: 0, z: -26, mode: "guard", boss: true, name: "Viktor Sorin" },
    ],
    spawn: [0, 44, 180],
    extraction: [0, -43, 4],
    intro: [
      { speaker: "Broker", text: "Apex Tower in a thunderstorm. Sorin's black-ops unit has thermal NVGs and flashlights." },
      { speaker: "Broker", text: "Wipe all three terminals, grab the bearer bonds in the lobby, terminate Sorin, and reach the north helipad." },
    ],
    onFirstContact: [{ speaker: "Broker", text: "Black-ops squad moving! Watch the barracks rooftops and courtyard flanks." }],
    onObjective: [{ speaker: "Broker", text: "Sorin's dead and the board's dirt is gone. Get onto the north helipad — chopper's inbound." }],
    onExtraction: [{ speaker: "Broker", text: "Extraction complete. The board wired double. One final apex contract just opened." }],
    enemyHp: 130,
    enemyDamage: [9, 16],
    enemyAccuracy: 0.66,
    accent: "#ff5e5e",
  },

  /* ------------------------------------------------ MISSION 6 ------ */
  {
    id: 6,
    codename: "THE SOVEREIGN CONTRACT",
    name: "Ironridge Fortress",
    client: "The Consortium",
    location: "Mount Ironridge — Private Black-Site Vault (260m)",
    timeOfDay: "Midnight, alpine storm",
    night: true,
    tint: [0x272936, 0xa855f7],
    tintName: "Citadel Praetorians (Gunmetal Titanium & Violet)",
    enemyWeapon: "dmr",
    enemyAppearance: {
      armorColor: "#272936",
      armorFinish: "titanium",
      gearColor: "#14151a",
      visorColor: "#a855f7",
      visorGlow: 1.55,
      weaponFinish: "obsidian",
      nvg: "deployed",
      backpack: true,
      chestRig: true,
      holster: true,
      headset: true,
    },
    bossWeapon: "dmr",
    bossAppearance: {
      armorColor: "#4a1820",
      armorFinish: "titanium",
      gearColor: "#b45309",
      visorColor: "#f59e0b",
      visorGlow: 1.9,
      weaponFinish: "gold",
      nvg: "deployed",
      backpack: true,
      chestRig: true,
      holster: true,
      headset: true,
    },
    briefing: [
      "Client: The Consortium. Rogue warlord General Drago Kovač stole The Sovereign Diamond and locked three nations' blackmail archives inside Ironridge Fortress.",
      "The biggest, deadliest heist of your career: steal The Sovereign Diamond from the East Vault, scrub 3 Classified Servers, sabotage 4 Backup Relays, and assassinate General Drago Kovač (450 HP).",
      "25 elite Praetorian guards patrol the 260m alpine citadel with DMRs and flashlights. Complete the contract and fight your way off the North Helipad.",
    ],
    debrief: [
      "The Sovereign Diamond sits in your coat, every Consortium server reads zero bytes, and General Kovač will never threaten another client.",
      "Mara closes the encrypted ledger for good. Elias Voss vanishes off every satellite feed — rich, untraceable, legendary.",
    ],
    objectives: [
      { id: "diamond", label: "Steal The Sovereign Diamond (East Vault)", kind: "interact", count: 1 },
      { id: "scrub", label: "Scrub classified blackmail servers", kind: "interact", count: 3 },
      { id: "destroy", label: "Sabotage backup relay nodes", kind: "destroy", count: 4 },
      { id: "boss", label: "Assassinate General Drago Kovač", kind: "boss", count: 1 },
      { id: "extract", label: "Leave the area — North Citadel Helipad", kind: "reach", at: [0, -84] },
    ],
    interactables: [
      { id: "m6_d1", objId: "diamond", kind: "diamond", label: "The Sovereign Diamond", duration: 0.9, x: 24.0, y: 0.12, z: -46.0 },
      { id: "m6_t1", objId: "scrub", kind: "terminal", label: "West Armory Blackmail Server", duration: 1.65, x: -34.0, y: 0.12, z: 26.5 },
      { id: "m6_t2", objId: "scrub", kind: "terminal", label: "East Comms Archive Server", duration: 1.65, x: 34.0, y: 0.12, z: 26.5 },
      { id: "m6_t3", objId: "scrub", kind: "terminal", label: "Inner Vault Mainframe", duration: 1.65, x: -24.0, y: 0.12, z: -46.0 },
    ],
    enemies: [
      // Zone 1: South Perimeter & Watchtowers
      { x: -12, z: 60, mode: "patrol", patrol: [[-12, 60], [-22, 60], [-22, 48]] },
      { x: 12, z: 60, mode: "patrol", patrol: [[12, 60], [22, 60], [22, 48]] },
      { x: 0, z: 50, mode: "guard" },
      { x: -14, z: 54, y: 4.5, mode: "guard" },
      { x: 14, z: 54, y: 4.5, mode: "guard" },

      // Zone 2: West Armory & East Comms Compounds (interiors, roofs & courtyard lanes)
      { x: -34, z: 26, y: 0.12, mode: "guard" },
      { x: -34, z: 21, y: 0.12, mode: "advance" },
      { x: -34, z: 24, y: 4.76, mode: "guard" },
      { x: 34, z: 26, y: 0.12, mode: "guard" },
      { x: 34, z: 21, y: 0.12, mode: "advance" },
      { x: 34, z: 24, y: 4.76, mode: "guard" },
      { x: -16, z: 32, mode: "patrol", patrol: [[-16, 32], [-16, 12], [-6, 12]] },
      { x: 16, z: 32, mode: "patrol", patrol: [[16, 32], [16, 12], [6, 12]] },

      // Zone 3: Central Skyway & Courtyard Relays
      { x: -10, z: -4, y: 3.76, mode: "guard" },
      { x: 10, z: -4, y: 3.76, mode: "guard" },
      { x: -18, z: -12, mode: "advance" },
      { x: 18, z: -12, mode: "advance" },
      { x: 0, z: -16, mode: "patrol", patrol: [[-8, -16], [8, -16], [8, -24], [-8, -24]] },

      // Zone 4: Inner Citadel, East Vault, West Barracks & North Helipad
      { x: -24, z: -44, y: 0.12, mode: "guard" },
      { x: -24, z: -46, y: 4.56, mode: "guard" },
      { x: 24, z: -42, y: 0.12, mode: "guard" },
      { x: -4, z: -46, y: 0.14, mode: "advance" },
      { x: 4, z: -46, y: 0.14, mode: "advance" },
      { x: -12, z: -66, mode: "patrol", patrol: [[-12, -66], [12, -66]] },
      { x: 12, z: -74, mode: "guard" },
      { x: 0, z: -72, mode: "guard", boss: true, name: "General Drago Kovač" },
    ],
    spawn: [0, 84, 180],
    extraction: [0, -84, 4],
    destroyables: [
      [-34, 14],
      [34, 14],
      [-14, -14],
      [14, -14],
    ],
    intro: [
      { speaker: "Voss", text: "Ironridge Citadel. Twenty-six Praetorians, three blackmail servers, and The Sovereign Diamond." },
      { speaker: "Broker", text: "Wipe the servers in the bunkers, cut the four relays, rob the East Vault, and drop Kovač before hitting the helipad." },
    ],
    onFirstContact: [{ speaker: "Kovač", text: "Perimeter breach! Praetorians, seal the vault and hunt that thief down!" }],
    onObjective: [{ speaker: "Broker", text: "Diamond secured, servers wiped, Kovač eliminated! Leave the fortress — reach the North Helipad!" }],
    onExtraction: [{ speaker: "Voss", text: "Contract fulfilled. Tell the Consortium the ledger is balanced." }],
    enemyHp: 150,
    enemyDamage: [11, 19],
    enemyAccuracy: 0.72,
    accent: "#c084fc",
  },
];

export const BOSS_HP: Record<string, number> = {
  "Viktor Kroll": 220,
  "Commander Ren": 260,
  "Viktor Sorin": 340,
  "General Drago Kovač": 450,
};
