/* ------------------------------------------------------------------ */
/*  BLACK CONTRACT — Freelance Thief / Spy / Assassin Campaign         */
/*  Single source of truth for contracts, briefings, guards & props.   */
/* ------------------------------------------------------------------ */
import type { WeaponId } from "../character/rifle";
import type { SoldierAppearance } from "./progression";
import { SAFEHOUSE_SPAWN } from "./city/SafehouseResidence";

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
  /** optional initial sentinel facing angle in degrees (+Z = 0, +X = 90) */
  yawDeg?: number;
  /** patrol waypoints (walk between them when undisturbed) */
  patrol?: [number, number][];
  /** "guard" holds position, "patrol" walks, "advance" pushes the player */
  mode?: "guard" | "patrol" | "advance";
  /** tactical enemy archetype: "sniper" (perched DMR + laser), "heavy" (armored breacher), or standard "guard" */
  role?: "guard" | "sniper" | "heavy";
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
      "Handler Mara Vance: A shadowy syndicate called the Sovereign Ledger just surfaced inside Westgate's upper tier — corrupt senators, black-market brokers, and private militias.",
      "Zero your suppressed weapons on the safehouse steel targets before deploying on Contract 1.",
      "Our way in starts with Senator Arthur Sterling: he's panicking over two stolen ledger briefcases in Highland Village — and his wire is already in escrow.",
    ],
    debrief: ["Range zeroed. Contract 1 — Paper Trail — is live on the board."],
    objectives: [{ id: "free", label: "Test suppressed weapons, then deploy on Contract 1", kind: "reach", at: [0, 0] }],
    enemies: [],
    spawn: [0, 0, 0],
    extraction: [0, 0, 3],
    intro: [
      { speaker: "Mara", text: "Test the suppressors, Voss. Rich clients don't pay for noise — they pay for ghosts." },
      { speaker: "Mara", text: "When you're ready, Contract 1 puts us inside Senator Sterling's syndicate ledgers." },
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
      "Senator Arthur Sterling claims a former fixer hid his offshore ledgers across Highland Village. Mara suspects those accounts bankroll a far bigger ring.",
      "Infiltrate the storefronts for 2 Ledger Briefcases, wipe the Archive Terminal in the north-east barn, and trace who Sterling was really paying.",
      "11 hired enforcers patrol the square. Ghost past them or drop them quietly, then extract back to the village road.",
    ],
    debrief: [
      "Sterling got his clean slate — and Mara pulled an encrypted routing key from the archive: every payout funnels through a 'Blood Star' auction vault.",
      "Next lead: Countess Elena Vane wants that Blood Star Diamond lifted from a rival syndicate construction site tonight.",
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
      { x: -8.5, z: 12, mode: "guard", yawDeg: 170 },
      { x: 6, z: -28, mode: "guard" },
      { x: -2, z: -26, mode: "guard" },
      { x: 10, z: -22, mode: "patrol", patrol: [[10, -22], [2, -22]] },
      { x: -8, z: -16, y: 0.12, mode: "guard" },
      { x: -16.2, z: 10, y: 0.12, mode: "guard" },
      { x: 16.5, z: 19, y: 0.12, mode: "advance" },
      { x: 14, z: 29, y: 3.36, mode: "guard", yawDeg: 210 },
      { x: -1.4, z: -10.2, y: 2.4, mode: "guard" },
    ],
    spawn: [-6.2, 41.0, 198],
    extraction: [0, 44, 4],
    intro: [
      { speaker: "Mara", text: "Dawn in Highland Village. Sterling thinks we're just burying his bribes — check who's on the other end of those ledgers." },
      { speaker: "Mara", text: "Pull both cases from the shops, scrub the barn terminal in the north-east, and slip out clean." },
    ],
    onFirstContact: [{ speaker: "Mara", text: "Enforcers spotted you! Drop them quietly or break line of sight — keep the ghost bonus intact." }],
    onHalfway: [{ speaker: "Mara", text: "Hold on — those account hashes aren't Sterling's. They're tagged 'BLOOD STAR'. Wipe the barn server and pull the full key." }],
    onObjective: [{ speaker: "Mara", text: "Ledgers bagged and archive wiped. We've got a live trail — exfiltrate to the south road." }],
    onExtraction: [{ speaker: "Voss", text: "Sterling's wire cleared. Tell me that Blood Star tag gave us a name." }],
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
      "Countess Elena Vane wants her stolen Blood Star Diamond recovered — and Mara confirmed its laser-etched facet is the physical cipher key for Sterling's accounts.",
      "Breach the unfinished Westgate Tower vault, steal the Blood Star Diamond, scrub 2 accounting terminals, and destroy 3 signal jammers.",
      "13 armed contractors patrol the yard and steel decks. Secure the cipher key and leave through the south construction gate.",
    ],
    debrief: [
      "With the Blood Star Diamond under Mara's scanner, Sterling's routing table cracked wide open: Downtown broker Viktor Kroll is hosting the syndicate's master drives.",
      "Tech billionaire Julian Mercer just put a contract on Kroll's head — giving Voss cover to hit Downtown at midnight.",
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
      { speaker: "Mara", text: "Countess Vane's Blood Star Diamond is locked in the west site office — and its facet holds the Ledger's cipher." },
      { speaker: "Mara", text: "Lift the diamond, scrub both accounting terminals, and smash those three relay jammers." },
    ],
    onFirstContact: [{ speaker: "Mara", text: "Shotgun crew on you! Use the scaffolding and upper decks for cover." }],
    onHalfway: [{ speaker: "Mara", text: "First reads from the site servers point downtown — someone named Viktor Kroll is fencing Sovereign data. Finish up here." }],
    onObjective: [{ speaker: "Mara", text: "Diamond bagged, terminals wiped, jammers fried. Exfiltrate through the south gate." }],
    onExtraction: [{ speaker: "Voss", text: "Give Vane a replica if she asks — we need that cipher downtown tonight." }],
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
      "Tech billionaire Julian Mercer hired us to eliminate spy broker Viktor Kroll — the exact man decoding Sterling and Vane's Sovereign Ledger downtown.",
      "Under cover of midnight, steal both Prototype Drive Cases before Kroll auctions them, wipe his Quantum Mainframe, and terminate Viktor Kroll.",
      "15 NVG-equipped guards sweep the avenue with flashlights and rooftop snipers. Drop Kroll and exfiltrate down the south street.",
    ],
    debrief: [
      "Kroll is cold and Mercer's drives are clean, but the mainframe's last log revealed weapons bullion moving through Westgate Harbor under Commander Ren.",
      "Shipping heiress Victoria Thorne wants her hijacked cargo ship reclaimed — putting Voss directly in Ren's path.",
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
      { x: 13, z: -4, y: 30, mode: "guard", role: "sniper" },
      { x: 17, z: -4, y: 30, mode: "guard", role: "sniper" },
      { x: -10, z: -28, y: 24, mode: "guard", role: "sniper" },
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
      { speaker: "Mara", text: "Downtown Westgate, midnight. Kroll's NVG detail is sweeping the avenue with snipers on the upper roofs." },
      { speaker: "Mara", text: "Pull Mercer's two drive cases, scrub Kroll's mainframe in the north-east office, and put Kroll down for good." },
    ],
    onFirstContact: [{ speaker: "Mara", text: "Flashlights locked on you! Cut through the shop connectors and stay off the open street." }],
    onHalfway: [{ speaker: "Mara", text: "We're half into Kroll's ledger — he was wiring cargo codes to Westgate Port before we cut the feed. Finish Kroll!" }],
    onObjective: [{ speaker: "Mara", text: "Kroll is down and the mainframe is ash. Pull back down the south avenue." }],
    onExtraction: [{ speaker: "Voss", text: "Contract closed. Pull the port manifests — whoever Kroll was shipping to is next." }],
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
      "Shipping heiress Victoria Thorne lost her private freighter to Commander Ren — the smuggler moving Kroll's black-budget crates out of Westgate Port.",
      "Reclaim Thorne's Gold Bullion Heirloom from the east dock office, scrub 2 manifest terminals, burn 4 contraband crates, and eliminate Commander Ren.",
      "13 harbor mercenaries patrol the containers and cargo decks. Clear the ship and escape on the pier extraction boat.",
    ],
    debrief: [
      "Ren's smuggling pipeline is burned to the waterline, and his bridge logs trace the Ledger straight to Apex Chairman Viktor Sorin.",
      "Even better: an ex-Apex breacher known as Brick turned whistleblower — and he's waiting at the perimeter to help Voss storm Apex Tower.",
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
      { speaker: "Mara", text: "Westgate Docks. Kroll's cargo ends here — Thorne's gold is in the east office, and Ren's holding the ship's bridge." },
      { speaker: "Mara", text: "Recover the gold, torch the four contraband crates, wipe both manifest terminals, and sink Commander Ren." },
    ],
    onFirstContact: [{ speaker: "Mara", text: "Mercenaries alerted! Use the container alleys to flank the pier and board the vessel." }],
    onHalfway: [{ speaker: "Mara", text: "The dock manifest didn't stop at Ren — every crate is consigned to Apex Tower's chairman, Viktor Sorin. Drop Ren and get the bridge log." }],
    onObjective: [{ speaker: "Mara", text: "Ren is cold and the manifests are wiped. Get to the pier boat at the south dock!" }],
    onExtraction: [{ speaker: "Voss", text: "Boat's clear. Tell that Apex contact we're hitting Sorin's tower next." }],
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
      "With Ren's manifests exposed, an anonymous Apex Board director opened the back gate — and ex-black-ops breacher Brick is fighting beside you tonight.",
      "Scrub 3 Executive Terminals holding Sorin's boardroom blackmail, seize his Bearer Bonds Case in the lobby vault, and eliminate Chairman Viktor Sorin.",
      "12 Obsidian black-ops guards and rooftop snipers defend the storm-lit compound. Break through to the North Helipad once Sorin falls.",
    ],
    debrief: [
      "Viktor Sorin's reign is over, his blackmail vault is erased, and Brick covered your six all the way to the chopper.",
      "One final piece remained in Sorin's cold-storage log: rogue warlord General Drago Kovač fled to Mount Ironridge with The Sovereign Diamond.",
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
      { x: -19, z: 10, y: 4.56, mode: "guard", role: "sniper" },
      { x: 19, z: 10, y: 4.56, mode: "guard", role: "sniper" },
      { x: -2.5, z: -31, y: 0.14, mode: "guard", role: "heavy" },
      { x: 2.5, z: -31, y: 0.14, mode: "guard", role: "heavy" },
      { x: 0, z: -26, mode: "guard", boss: true, name: "Viktor Sorin" },
    ],
    spawn: [0, 44, 180],
    ally: [-4, 42],
    extraction: [0, -43, 4],
    intro: [
      { speaker: "Brick", text: "Apex Tower, storm perimeter. Stay low and I'll hold my fire until you open up — or till we hit Sorin's lobby." },
      { speaker: "Mara", text: "Wipe all three blackmail terminals, grab Sorin's bearer bonds, drop Sorin, and make the North Helipad." },
    ],
    onFirstContact: [{ speaker: "Brick", text: "Black-ops squad moving! Suppressing flanks — watch the barracks rooftops!" }],
    onHalfway: [{ speaker: "Mara", text: "Wait — Sorin already wired the master Sovereign Diamond to General Drago Kovač at Ironridge! Finish Sorin and pull his vault key." }],
    onObjective: [{ speaker: "Brick", text: "Sorin's down and the servers are cooked! Move to the North Helipad — bird's inbound!" }],
    onExtraction: [{ speaker: "Voss", text: "Good work, Brick. Mara, plot the flight path to Mount Ironridge — we're ending the Ledger tonight." }],
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
      "Everything from Sterling's ledgers to Sorin's tower converges here: General Drago Kovač holds The Sovereign Diamond — and the tri-nation blackmail archive — inside Mount Ironridge.",
      "Steal The Sovereign Diamond from the East Vault, wipe all 3 Classified Servers, destroy 4 Backup Relays, and assassinate General Drago Kovač (450 HP).",
      "25 elite Praetorian guards patrol the 260m alpine citadel with DMRs and flashlights. End the Sovereign Ledger and fight your way onto the North Helipad.",
    ],
    debrief: [
      "The Sovereign Diamond sits in your coat, every Consortium archive reads zero bytes, and General Kovač's fortress is silent.",
      "Back in Westgate Bay, Mara closes the ledger for good. Elias Voss vanishes off every satellite feed — untraceable, unbroken, legendary.",
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
      { x: -14, z: 54, y: 4.5, mode: "guard", role: "sniper" },
      { x: 14, z: 54, y: 4.5, mode: "guard", role: "sniper" },

      // Zone 2: West Armory & East Comms Compounds (interiors, roofs & courtyard lanes)
      { x: -34, z: 26, y: 0.12, mode: "guard", role: "heavy" },
      { x: -34, z: 21, y: 0.12, mode: "advance" },
      { x: -34, z: 24, y: 4.76, mode: "guard", role: "sniper" },
      { x: 34, z: 26, y: 0.12, mode: "guard", role: "heavy" },
      { x: 34, z: 21, y: 0.12, mode: "advance" },
      { x: 34, z: 24, y: 4.76, mode: "guard", role: "sniper" },
      { x: -16, z: 32, mode: "patrol", patrol: [[-16, 32], [-16, 12], [-6, 12]] },
      { x: 16, z: 32, mode: "patrol", patrol: [[16, 32], [16, 12], [6, 12]] },

      // Zone 3: Central Skyway & Courtyard Relays
      { x: -10, z: -4, y: 3.76, mode: "guard", role: "sniper" },
      { x: 10, z: -4, y: 3.76, mode: "guard", role: "sniper" },
      { x: -18, z: -12, mode: "advance" },
      { x: 18, z: -12, mode: "advance" },
      { x: 0, z: -16, mode: "patrol", patrol: [[-8, -16], [8, -16], [8, -24], [-8, -24]] },

      // Zone 4: Inner Citadel, East Vault, West Barracks & North Helipad
      { x: -24, z: -44, y: 0.12, mode: "guard", role: "heavy" },
      { x: -24, z: -46, y: 4.56, mode: "guard", role: "sniper" },
      { x: 24, z: -42, y: 0.12, mode: "guard", role: "heavy" },
      { x: -4, z: -46, y: 0.14, mode: "advance", role: "heavy" },
      { x: 4, z: -46, y: 0.14, mode: "advance", role: "heavy" },
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
      { speaker: "Voss", text: "Ironridge Citadel. Twenty-six Praetorians, three blackmail servers, and the Sovereign Diamond at the top." },
      { speaker: "Mara", text: "Everything we tracked from Sterling's village ends here. Wipe the bunkers, cut the four relays, rob the East Vault, and drop Kovač." },
    ],
    onFirstContact: [{ speaker: "Kovač", text: "Perimeter breach! Praetorians, seal the vault and hunt that thief down!" }],
    onHalfway: [{ speaker: "Mara", text: "Half the citadel's crippled and Kovač is locking down the inner vault. Keep pushing north, Voss!" }],
    onObjective: [{ speaker: "Mara", text: "The Sovereign Diamond is yours and Kovač is dead! Leave the fortress — reach the North Helipad!" }],
    onExtraction: [{ speaker: "Voss", text: "Ledger balanced. Burn the frequency, Mara — we're ghosts." }],
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

export const OPEN_WORLD_MISSION: MissionDef = {
  id: -1,
  codename: "WESTGATE BAY",
  name: "Open World Free Roam",
  client: "Free Exploration",
  location: "Westgate Bay · 420 Crescent Safehouse",
  timeOfDay: "Golden Afternoon",
  tint: [0xd8cdb4, 0x88ccff],
  tintName: "Voss",
  briefing: [
    "Start at your Old Quarter Safehouse & Garage, step into your personal car, and explore Westgate Bay across curved coastal highways, five architectural bridges, canyon switchbacks, and eight districts.",
  ],
  debrief: ["Session ended."],
  objectives: [{ id: "free", label: "Explore Westgate Bay — press [P / ↑] for SkyPhone · [M] for Map", kind: "reach", at: [SAFEHOUSE_SPAWN[0], SAFEHOUSE_SPAWN[1]] }],
  enemies: [],
  spawn: SAFEHOUSE_SPAWN,
  extraction: [SAFEHOUSE_SPAWN[0], SAFEHOUSE_SPAWN[1], 4],
  intro: [
    { speaker: "Mara", text: "Welcome home to 420 Crescent. Your car's in the garage, and your SkyPhone is online [P / ↑].", dur: 3.6 },
  ],
  practice: true,
  enemyHp: 100,
  enemyDamage: [5, 10],
  enemyAccuracy: 0.5,
  accent: "#38bdf8",
};

