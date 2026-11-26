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
  /** optional pre-generated voice line clip under public/audio/story/ */
  audioUrl?: string;
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
      { speaker: "Mara", text: "Test the suppressors, Voss. Rich clients don't pay for noise — they pay for ghosts.", audioUrl: "/audio/story/mara_m0_intro1.mp3" },
      { speaker: "Mara", text: "When you're ready, Contract 1 puts us inside Senator Sterling's syndicate ledgers.", audioUrl: "/audio/story/mara_m0_intro2.mp3" },
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
      "11 hired enforcers patrol the square. Ghost past them with silent takedowns [F] or suppressed shots, then extract back to the village road.",
    ],
    debrief: [
      "Sterling got his clean slate — and Mara pulled an urgent shipping seal from the barn server: Dock 4 manifests are about to be handed to City Hall by Port Auditor Marcus Bell.",
      "Before we can raid Eastgate Seaport, Voss must tail Bell across Westgate Bay, execute a silent takedown in an isolated window, and sink the body at sea.",
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
      { speaker: "Mara", text: "Dawn in Highland Village. Sterling thinks we're just burying his bribes — check who's on the other end of those ledgers.", audioUrl: "/audio/story/mara_m1_intro.mp3" },
      { speaker: "Voss", text: "I'm in. Keep it brief.", audioUrl: "/audio/story/voss_m1_intro.mp3" },
    ],
    onFirstContact: [{ speaker: "Mara", text: "Enforcers spotted you! Drop them quietly or break line of sight — keep the ghost bonus intact.", audioUrl: "/audio/story/mara_m1_contact.mp3" }],
    onHalfway: [{ speaker: "Mara", text: "Hold on. Those account hashes aren't Sterling's. They belong to Dock Four customs. Clear the barn server and pull the full manifest.", audioUrl: "/audio/story/mara_m1_twist.mp3" }],
    onObjective: [{ speaker: "Voss", text: "Files secured. Server cleared. Moving out.", audioUrl: "/audio/story/voss_m1_obj.mp3" }],
    onExtraction: [{ speaker: "Voss", text: "Sterling's wire cleared. Lock onto that customs auditor, Mara — we silence him before we hit the harbor.", audioUrl: "/audio/story/voss_m1_extract.mp3" }],
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
      "Commander Ren's bridge log proved the Sovereign Ledger's master cipher is laser-etched inside the Blood Star Diamond — locked in a half-built Midtown tower before concrete seals the vault.",
      "Countess Elena Vane will pay to recover her stolen gem while Mara clones its cipher facet. Breach the construction yard, steal the Blood Star Diamond, scrub 2 accounting terminals, and destroy 3 signal jammers.",
      "13 armed contractors patrol the yard and steel decks. Secure the cipher key and leave through the south construction gate.",
    ],
    debrief: [
      "With the Blood Star Diamond under Mara's scanner, Ren's cipher cracked wide open: clinical trial fixer Dr. Victor Kaine is laundering syndicate payouts and dosing Viktor Kroll's black-ops detail.",
      "Next directive: surveil Dr. Kaine from his Venice Canal villa, eliminate him silently in an isolated window, and dump him offshore before moving on Kroll downtown.",
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
      { speaker: "Mara", text: "Ren's bridge log didn't lie — Countess Vane's Blood Star Diamond is locked in the west site office, and its facet holds our cipher.", audioUrl: "/audio/story/mara_m2_intro1.mp3" },
      { speaker: "Mara", text: "Lift the diamond, scrub both accounting terminals, and smash those three relay jammers.", audioUrl: "/audio/story/mara_m2_intro2.mp3" },
    ],
    onFirstContact: [{ speaker: "Mara", text: "Shotgun crew on you! Use the scaffolding and upper decks for cover.", audioUrl: "/audio/story/mara_m2_contact.mp3" }],
    onHalfway: [
      { speaker: "Mara", text: "The site ledger shows a Midtown doctor named Victor Kaine laundering funds for Viktor Kroll. Finish up here so we can pull Kaine's schedule.", audioUrl: "/audio/story/mara_m2_half.mp3" },
      { speaker: "Voss", text: "Got the name. Victor Kaine. Finishing up.", audioUrl: "/audio/story/voss_m2_half.mp3" },
    ],
    onObjective: [{ speaker: "Mara", text: "Diamond bagged, terminals wiped, jammers fried. Exfiltrate through the south gate.", audioUrl: "/audio/story/mara_m2_obj.mp3" }],
    onExtraction: [{ speaker: "Voss", text: "Cipher secured. Put Dr. Kaine under surveillance — once his payout shield drops, we hit Kroll downtown.", audioUrl: "/audio/story/voss_m2_extract.mp3" }],
    enemyHp: 115,
    enemyDamage: [7, 12],
    enemyAccuracy: 0.54,
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
      "With Commander Ren's docks burned and Dr. Kaine's neuro-payout pipeline sunk in the Pacific, spy broker Viktor Kroll is cornered in Downtown Westgate.",
      "Under cover of midnight, steal both Prototype Drive Cases before Kroll auctions them, wipe his Quantum Mainframe, and terminate Viktor Kroll.",
      "15 NVG-equipped guards sweep the avenue with flashlights and rooftop snipers. Drop Kroll and exfiltrate down the south street.",
    ],
    debrief: [
      "Kroll is cold and Mercer's drives are clean. Decrypting Kroll's Quantum Mainframe revealed the security architect behind both Apex Tower and Ironridge: municipal fixer Damon Vale.",
      "Before Brick can breach Apex Tower's perimeter, Voss must surveil Damon Vale across Westgate Bay, isolate him for a clean takedown, and strip his master security overrides.",
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
      { speaker: "Mara", text: "Downtown Westgate, midnight. With Ren's port gone and Kaine silenced, Kroll's NVG detail is sweeping the avenue with rooftop snipers.", audioUrl: "/audio/story/mara_m3_intro1.mp3" },
      { speaker: "Mara", text: "Pull Mercer's two drive cases, scrub Kroll's mainframe in the north-east office, and put Kroll down for good.", audioUrl: "/audio/story/mara_m3_intro2.mp3" },
    ],
    onFirstContact: [{ speaker: "Mara", text: "Flashlights locked on you! Cut through the shop connectors and stay off the open street.", audioUrl: "/audio/story/mara_m3_contact.mp3" }],
    onHalfway: [{ speaker: "Mara", text: "We're inside Kroll's ledger — a fixer named Damon Vale engineered Apex Tower's blast doors and tunnel grid. Finish Kroll!", audioUrl: "/audio/story/mara_m3_half.mp3" }],
    onObjective: [{ speaker: "Voss", text: "Kroll is down. Mainframe cleared.", audioUrl: "/audio/story/voss_m3_boss.mp3" }],
    onExtraction: [{ speaker: "Voss", text: "Contract closed. Put Damon Vale under surveillance — once we lift his override keys, Brick and I hit Apex Tower.", audioUrl: "/audio/story/voss_m3_extract.mp3" }],
    enemyHp: 125,
    enemyDamage: [8, 14],
    enemyAccuracy: 0.6,
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
      "Port Auditor Marcus Bell is silenced at the bottom of the bay, leaving Dock 4 wide open before Commander Ren can ship the Sovereign bullion offshore.",
      "Reclaim Victoria Thorne's Gold Bullion Heirloom from the east dock office, scrub 2 manifest terminals, burn 4 contraband crates, and eliminate Commander Ren.",
      "13 harbor mercenaries patrol the containers and cargo decks. Clear the ship and escape on the pier extraction boat.",
    ],
    debrief: [
      "Ren's smuggling pipeline is burned to the waterline, and his bridge logs trace the Ledger's master cipher to a Midtown construction vault.",
      "Countess Elena Vane wants the Blood Star Diamond pulled from that half-built tower — and Mara needs its laser-etched facet to crack the next tier of the syndicate.",
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
      { speaker: "Mara", text: "Westgate Docks, dark and quiet thanks to Bell's disappearance. Thorne's gold is in the east office, and Ren's holding the ship's bridge.", audioUrl: "/audio/story/mara_m4_intro1.mp3" },
      { speaker: "Mara", text: "Recover the gold, torch the four contraband crates, wipe both manifest terminals, and sink Commander Ren.", audioUrl: "/audio/story/mara_m4_intro2.mp3" },
    ],
    onFirstContact: [{ speaker: "Mara", text: "Mercenaries alerted! Use the container alleys to flank the pier and board the vessel.", audioUrl: "/audio/story/mara_m4_contact.mp3" }],
    onHalfway: [{ speaker: "Mara", text: "Ren's manifests reference a cipher facet called the 'Blood Star' stored in Midtown Construction. Drop Ren and pull the bridge log.", audioUrl: "/audio/story/mara_m4_half.mp3" }],
    onObjective: [{ speaker: "Voss", text: "Ren is down. Moving to the pier.", audioUrl: "/audio/story/voss_m4_pier.mp3" }],
    onExtraction: [{ speaker: "Voss", text: "Boat's clear. Midtown vault is next.", audioUrl: "/audio/story/voss_m4_extract.mp3" }],
    enemyHp: 110,
    enemyDamage: [6, 11],
    enemyAccuracy: 0.5,
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
      "Damon Vale's override codes opened Apex Tower's back gate, an anonymous Apex Board director pulled the interior lockdowns, and ex-black-ops breacher Brick is fighting beside you tonight.",
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
      { speaker: "Brick", text: "Brick here. Lobby breach is open, Voss. Take the upper servers, I've got the perimeter.", audioUrl: "/audio/story/brick_m5_breach.mp3" },
    ],
    onFirstContact: [{ speaker: "Brick", text: "Black-ops squad moving! Suppressing flanks — watch the barracks rooftops!", audioUrl: "/audio/story/brick_m5_contact.mp3" }],
    onHalfway: [{ speaker: "Mara", text: "Voss, Sorin already moved the Sovereign Diamond to General Kovac at Ironridge. Take his vault key and get out.", audioUrl: "/audio/story/mara_m5_twist.mp3" }],
    onObjective: [{ speaker: "Voss", text: "Sorin is handled. Moving to the roof.", audioUrl: "/audio/story/voss_m5_obj.mp3" }],
    onExtraction: [{ speaker: "Voss", text: "Good work, Brick. Mara, plot the flight path to Mount Ironridge — we're ending the Ledger tonight.", audioUrl: "/audio/story/voss_m5_extract.mp3" }],
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
      { speaker: "Voss", text: "Ironridge Citadel. Twenty-six Praetorians, three blackmail servers, and the Sovereign Diamond at the top.", audioUrl: "/audio/story/voss_m6_intro.mp3" },
      { speaker: "Mara", text: "Everything we tracked from Sterling's village ends here. Wipe the bunkers, cut the four relays, rob the East Vault, and drop Kovač.", audioUrl: "/audio/story/mara_m6_intro.mp3" },
    ],
    onFirstContact: [{ speaker: "Kovač", text: "Perimeter breach! Praetorians, seal the vault and hunt that thief down!", audioUrl: "/audio/story/boss_kovac_contact.mp3" }],
    onHalfway: [{ speaker: "Mara", text: "Half the citadel's crippled and Kovač is locking down the inner vault. Keep pushing north, Voss!", audioUrl: "/audio/story/mara_m6_half.mp3" }],
    onObjective: [{ speaker: "Voss", text: "Kovac is down. Diamond is secure. I'm done here.", audioUrl: "/audio/story/voss_m6_end.mp3" }],
    onExtraction: [{ speaker: "Voss", text: "Ledger balanced. Burn the frequency, Mara. We're ghosts.", audioUrl: "/audio/story/voss_m6_extract.mp3" }],
    enemyHp: 150,
    enemyDamage: [11, 19],
    enemyAccuracy: 0.72,
    accent: "#c084fc",
  },
];

export const BOSS_HP: Record<string, number> = {
  "Commander Ren": 240,
  "Viktor Kroll": 280,
  "Viktor Sorin": 340,
  "General Drago Kovač": 450,
};

export interface BossTauntDef {
  speaker: string;
  engageLine: string;
  engageAudio: string;
  halfHpTitle: string;
  halfHpDetail: string;
  hazardLine: string;
  hazardAudio: string;
  intelNote: string;
}

export const BOSS_TAUNTS: Record<string, BossTauntDef> = {
  "Commander Ren": {
    speaker: "Commander Ren",
    engageLine: "Lock down the pier! Nobody leaves this ship with Thorne's bullion!",
    engageAudio: "/audio/bosses/boss_ren_engage.mp3",
    halfHpTitle: "COMMANDER REN: DECK SMOKE SCREEN",
    halfHpDetail: "Ren popped tactical deck smoke canisters and called pier reinforcements!",
    hazardLine: "Pop smoke on the upper deck! Seal the bridge and box him in!",
    hazardAudio: "/audio/bosses/boss_ren_smoke.mp3",
    intelNote: "Bridge Log: Shipped the Blood Star Diamond cipher to Midtown Construction before docking.",
  },
  "Viktor Kroll": {
    speaker: "Viktor Kroll",
    engageLine: "Found the little ghost. Snipers, light up the street!",
    engageAudio: "/audio/bosses/boss_kroll_engage.mp3",
    halfHpTitle: "VIKTOR KROLL: STUN & FLOODLIGHT SWEEP",
    halfHpDetail: "Kroll triggered courtyard stun charges and converging NVG squads!",
    hazardLine: "Drop stunners in the courtyard! Floodlights up, sweep every corner!",
    hazardAudio: "/audio/bosses/boss_kroll_flash.mp3",
    intelNote: "Mainframe Dump: Paid Damon Vale $4.2M to design Apex Tower's blast locks and escape tunnels.",
  },
  "Viktor Sorin": {
    speaker: "Viktor Sorin",
    engageLine: "You brought one suit and a traitor into my building, Voss? Security, lock the atrium and stop them!",
    engageAudio: "/audio/bosses/boss_sorin_engage.mp3",
    halfHpTitle: "VIKTOR SORIN: ATRIUM LOCKDOWN SURGE",
    halfHpDetail: "Sorin triggered security overload charges and deployed black-ops strike teams!",
    hazardLine: "Override gamma! Trigger lobby lockdown surge and deploy security strike teams!",
    hazardAudio: "/audio/bosses/boss_sorin_lockdown.mp3",
    intelNote: "Vault Key: Transferred The Sovereign Diamond to General Drago Kovač on Mount Ironridge.",
  },
  "General Drago Kovač": {
    speaker: "General Drago Kovač",
    engageLine: "Praetorians, seal the east vault! Bring me Voss!",
    engageAudio: "/audio/bosses/boss_kovac_engage.mp3",
    halfHpTitle: "GENERAL KOVAČ: IRONRIDGE MORTAR BARRAGE",
    halfHpDetail: "Kovač ordered live mortar shelling on your position — dodge red target zones!",
    hazardLine: "Ironridge Battery, fire for effect on my courtyard coordinates! Shell his cover!",
    hazardAudio: "/audio/bosses/boss_kovac_mortar.mp3",
    intelNote: "Citadel Ledger: Final Consortium archive destroyed — zero surviving command links.",
  },
};

export type StoryAct = "PROLOGUE" | "ACT I · THE DOCKSIDE LEAK" | "ACT II · BREAKING THE CIPHER" | "ACT III · DECAPITATING THE CONSORTIUM";

export interface StoryChapterDef {
  chapter: number;
  code: string;
  act: StoryAct;
  kind: "mission" | "surveillance";
  missionId?: number;
  surveillanceId?: string;
  codename: string;
  title: string;
  location: string;
  timeOfDay: string;
  accent: string;
  summary: string;
  tacticalFocus: string;
  introDialogue: DialogueLine[];
  debriefDialogue: DialogueLine[];
}

export const STORYLINE_CHAPTERS: StoryChapterDef[] = [
  {
    chapter: 0,
    code: "00",
    act: "PROLOGUE",
    kind: "mission",
    missionId: 0,
    codename: "CALIBRATION",
    title: "Safehouse Range",
    location: "Private Subterranean Range",
    timeOfDay: "Daylight",
    accent: "#2dd4bf",
    summary: "Zero suppressed rifles, practice rear silent takedowns [F], and verify ballistics before going live.",
    tacticalFocus: "Training · Stealth Takedown & Marksmanship",
    introDialogue: [{ speaker: "Mara", text: "Safehouse range is hot. Zero your rifle and practice silent takedowns before we touch the Ledger.", audioUrl: "/audio/chapters/ch00_intro.mp3" }],
    debriefDialogue: [{ speaker: "Mara", text: "Calibration complete. Your first live file is Highland Estate — Sterling's offshore trail.", audioUrl: "/audio/chapters/ch00_debrief.mp3" }],
  },
  {
    chapter: 1,
    code: "01",
    act: "ACT I · THE DOCKSIDE LEAK",
    kind: "mission",
    missionId: 1,
    codename: "PAPER TRAIL",
    title: "Highland Estate Village",
    location: "Highland Estate — dawn",
    timeOfDay: "Dawn",
    accent: "#a8c686",
    summary: "Raid Senator Sterling's village storefronts, scrub the barn archive, and uncover the Dock 4 smuggling seal.",
    tacticalFocus: "Infiltration · Data Theft · 11 Enforcers",
    introDialogue: [{ speaker: "Mara", text: "Ch 1 — Paper Trail. Pull Sterling's ledgers and see who is moving Sovereign money.", audioUrl: "/audio/chapters/ch01_intro.mp3" }],
    debriefDialogue: [{ speaker: "Mara", text: "Dock 4 manifests point straight to Customs Auditor Marcus Bell. Surveil and silence him next.", audioUrl: "/audio/chapters/ch01_debrief.mp3" }],
  },
  {
    chapter: 2,
    code: "02",
    act: "ACT I · THE DOCKSIDE LEAK",
    kind: "surveillance",
    surveillanceId: "hit_port_auditor",
    codename: "THE PORT AUDITOR",
    title: "Surveillance Hit · Marcus Bell",
    location: "Westgate Bay · Mirror Park → Eastgate Pier",
    timeOfDay: "Live 24h Cycle",
    accent: "#f59e0b",
    summary: "Tail Port Auditor Marcus Bell across his daily route, wait for an isolated window, eliminate him silently [F] or suppressed, and dump his body in deep ocean water.",
    tacticalFocus: "Surveillance · Silent Takedown · Ocean Disposal",
    introDialogue: [
      { speaker: "Mara", text: "Ch 2 — Marcus Bell has Dock 4's physical seals and is ready to blow our port trace to City Hall.", dur: 4.5, audioUrl: "/audio/chapters/ch02_intro1.mp3" },
      { speaker: "Mara", text: "Tail his silver sedan, wait for an isolated window at Eastgate Quay or the Venice Canals, take him down cleanly, and sink the body offshore.", dur: 5.0, audioUrl: "/audio/chapters/ch02_intro2.mp3" },
    ],
    debriefDialogue: [
      { speaker: "Mara", text: "Bell is gone and the Dock 4 seals belong to us. Eastgate Seaport is blind — Commander Ren won't see us coming tonight.", dur: 4.6, audioUrl: "/audio/chapters/ch02_debrief.mp3" },
    ],
  },
  {
    chapter: 3,
    code: "03",
    act: "ACT I · THE DOCKSIDE LEAK",
    kind: "mission",
    missionId: 4,
    codename: "BLACK LEDGER",
    title: "Westgate Harbor Docks",
    location: "Eastgate Seaport — cargo vessel",
    timeOfDay: "Night",
    accent: "#fbbf24",
    summary: "Strike Eastgate Seaport under cover of darkness: recover Thorne's Gold, burn contraband crates, wipe shipboard manifests, and assassinate Commander Ren.",
    tacticalFocus: "Night Raid · Sabotage · Boss: Commander Ren",
    introDialogue: [{ speaker: "Mara", text: "Ch 3 — Black Ledger. With Bell silenced, hit Commander Ren's freighter before the bullion sails.", audioUrl: "/audio/chapters/ch03_intro.mp3" }],
    debriefDialogue: [{ speaker: "Mara", text: "Ren's bridge log points straight to Midtown Construction — the Blood Star Diamond holds our cipher key.", audioUrl: "/audio/chapters/ch03_debrief.mp3" }],
  },
  {
    chapter: 4,
    code: "04",
    act: "ACT II · BREAKING THE CIPHER",
    kind: "mission",
    missionId: 2,
    codename: "GLASS VAULT",
    title: "Syndicate Construction Vault",
    location: "Midtown Tower — construction site",
    timeOfDay: "Overcast day",
    accent: "#38bdf8",
    summary: "Breach the unfinished Midtown skyscraper to steal the Blood Star Diamond cipher key, scrub accounting servers, and destroy relay jammers.",
    tacticalFocus: "Vertical Raid · Vault Heist · 13 Contractors",
    introDialogue: [{ speaker: "Mara", text: "Ch 4 — Glass Vault. Clone the Blood Star cipher and shatter their Midtown relays.", audioUrl: "/audio/chapters/ch04_intro.mp3" }],
    debriefDialogue: [{ speaker: "Mara", text: "The cipher exposed Dr. Victor Kaine — the fixer laundering payouts for Viktor Kroll. Track Kaine next.", audioUrl: "/audio/chapters/ch04_debrief.mp3" }],
  },
  {
    chapter: 5,
    code: "05",
    act: "ACT II · BREAKING THE CIPHER",
    kind: "surveillance",
    surveillanceId: "hit_pharma_fixer",
    codename: "THE PHARMA FIXER",
    title: "Surveillance Hit · Dr. Victor Kaine",
    location: "Westgate Bay · Venice Canals → St. Jude's → Marina",
    timeOfDay: "Live 24h Cycle",
    accent: "#f59e0b",
    summary: "Track Dr. Victor Kaine from his Venice Canal villa to St. Jude's Hospital and Mirror Park, strike during an isolated window or sabotage his SUV, and dispose of him at sea.",
    tacticalFocus: "Surveillance · Sabotage / Takedown · Ocean Disposal",
    introDialogue: [
      { speaker: "Mara", text: "Ch 5 — Dr. Victor Kaine launders Sovereign payouts and supplies neuro-stimulants to Viktor Kroll's guards.", dur: 4.5, audioUrl: "/audio/chapters/ch05_intro1.mp3" },
      { speaker: "Mara", text: "Watch his blue SUV leave Venice Canals, catch him isolated at Mirror Park or Pacific Marina, drop him unseen, and dump him in deep water.", dur: 5.2, audioUrl: "/audio/chapters/ch05_intro2.mp3" },
    ],
    debriefDialogue: [
      { speaker: "Mara", text: "Kaine is off the board and Kroll's payout shield just collapsed. Time to take Viktor Kroll downtown.", dur: 4.6, audioUrl: "/audio/chapters/ch05_debrief.mp3" },
    ],
  },
  {
    chapter: 6,
    code: "06",
    act: "ACT II · BREAKING THE CIPHER",
    kind: "mission",
    missionId: 3,
    codename: "DEAD DROP",
    title: "Downtown Financial District",
    location: "Downtown Westgate — corporate avenues",
    timeOfDay: "Night",
    accent: "#22d3ee",
    summary: "Corner spy broker Viktor Kroll at midnight: secure Mercer's prototype drives, scrub the Quantum Mainframe, evade rooftop snipers, and drop Kroll.",
    tacticalFocus: "Night Ops · Rooftop Snipers · Boss: Viktor Kroll",
    introDialogue: [{ speaker: "Mara", text: "Ch 6 — Dead Drop. Kroll is isolated downtown. Pull his mainframe data and end him.", audioUrl: "/audio/chapters/ch06_intro.mp3" }],
    debriefDialogue: [{ speaker: "Mara", text: "Kroll's mainframe exposed Damon Vale — the architect who built Apex Tower's vault and blast doors.", audioUrl: "/audio/chapters/ch06_debrief.mp3" }],
  },
  {
    chapter: 7,
    code: "07",
    act: "ACT III · DECAPITATING THE CONSORTIUM",
    kind: "surveillance",
    surveillanceId: "hit_syndicate_architect",
    codename: "THE SYNDICATE ARCHITECT",
    title: "Surveillance Hit · Damon Vale",
    location: "Westgate Bay · Vinewood Crest → City Hall → Observatory",
    timeOfDay: "Live 24h Cycle",
    accent: "#f59e0b",
    summary: "Surveil infrastructure fixer Damon Vale from Vinewood Crest through Midtown and City Hall, take him down cleanly at the Observatory or Del Sol Cove, and sink him offshore.",
    tacticalFocus: "Surveillance · Silent Takedown · Override Extraction",
    introDialogue: [
      { speaker: "Mara", text: "Ch 7 — Damon Vale designed Apex Tower's blast locks and is preparing to flip federal witnesses.", dur: 4.5, audioUrl: "/audio/chapters/ch07_intro1.mp3" },
      { speaker: "Mara", text: "Follow his black Lux Sedan from Vinewood Crest, isolate him at the Observatory Terrace or Del Sol Cove, strip his override keys for Brick, and sink the body.", dur: 5.2, audioUrl: "/audio/chapters/ch07_intro2.mp3" },
    ],
    debriefDialogue: [
      { speaker: "Mara", text: "Vale's master overrides are decrypted. Sending Brick the backdoor codes — Apex Tower is wide open.", dur: 4.6, audioUrl: "/audio/chapters/ch07_debrief.mp3" },
    ],
  },
  {
    chapter: 8,
    code: "08",
    act: "ACT III · DECAPITATING THE CONSORTIUM",
    kind: "mission",
    missionId: 5,
    codename: "HOSTILE TAKEOVER",
    title: "Apex Corporate Tower",
    location: "East Downtown — Apex HQ",
    timeOfDay: "Night, storm",
    accent: "#ff4444",
    summary: "Breach storm-swept Apex Tower alongside Sergeant Brick Horvat, wipe Sorin's blackmail servers, seize bearer bonds, and assassinate Chairman Viktor Sorin.",
    tacticalFocus: "Co-Op Assault · Black-Ops · Boss: Viktor Sorin",
    introDialogue: [{ speaker: "Mara", text: "Ch 8 — Hostile Takeover. Brick is at the breach point. Drop Viktor Sorin and take the tower.", audioUrl: "/audio/chapters/ch08_intro.mp3" }],
    debriefDialogue: [{ speaker: "Mara", text: "Sorin is dead — and his cold-storage ledger shows General Drago Kovač waiting atop Mount Ironridge.", audioUrl: "/audio/chapters/ch08_debrief.mp3" }],
  },
  {
    chapter: 9,
    code: "09",
    act: "ACT III · DECAPITATING THE CONSORTIUM",
    kind: "mission",
    missionId: 6,
    codename: "THE SOVEREIGN CONTRACT",
    title: "Ironridge Fortress",
    location: "Mount Ironridge — alpine citadel",
    timeOfDay: "Midnight, alpine storm",
    accent: "#c084fc",
    summary: "Storm the Consortium's alpine fortress, steal The Sovereign Diamond, wipe all archive terminals, destroy backup relays, and eliminate General Drago Kovač.",
    tacticalFocus: "Campaign Finale · Praetorians · Boss: General Kovač",
    introDialogue: [{ speaker: "Mara", text: "Ch 9 — The Sovereign Contract. End General Kovač and burn the Consortium to the ground.", audioUrl: "/audio/chapters/ch09_intro.mp3" }],
    debriefDialogue: [{ speaker: "Voss", text: "Ledger balanced. Burn the frequency, Mara — we're ghosts.", audioUrl: "/audio/story/voss_m6_extract.mp3" }],
  },
];

export interface StorySaveLike {
  unlocked: number;
  storyStep?: number;
  records?: Record<number, { completed?: boolean }>;
  surveillanceRecords?: Record<string, { completed?: boolean }>;
}

export function getStoryChapterForMission(missionId: number): StoryChapterDef | undefined {
  return STORYLINE_CHAPTERS.find((c) => c.kind === "mission" && c.missionId === missionId);
}

export function getStoryChapterForSurveillance(surveillanceId: string): StoryChapterDef | undefined {
  return STORYLINE_CHAPTERS.find((c) => c.kind === "surveillance" && c.surveillanceId === surveillanceId);
}

export function isStoryChapterCompleted(chapter: StoryChapterDef, save: StorySaveLike): boolean {
  if (chapter.kind === "mission" && chapter.missionId !== undefined) {
    return Boolean(save.records?.[chapter.missionId]?.completed);
  }
  if (chapter.kind === "surveillance" && chapter.surveillanceId) {
    return Boolean(save.surveillanceRecords?.[chapter.surveillanceId]?.completed);
  }
  return false;
}

export function isStoryChapterUnlocked(chapter: StoryChapterDef, save: StorySaveLike): boolean {
  if (chapter.chapter <= 1) return true;
  if (isStoryChapterCompleted(chapter, save)) return true;
  const step = save.storyStep ?? 1;
  if (step >= chapter.chapter) return true;
  const prev = STORYLINE_CHAPTERS[chapter.chapter - 1];
  if (prev && isStoryChapterCompleted(prev, save)) return true;
  return false;
}

export function getNextStoryChapter(save: StorySaveLike): StoryChapterDef {
  for (const ch of STORYLINE_CHAPTERS) {
    if (ch.chapter === 0) continue;
    if (isStoryChapterUnlocked(ch, save) && !isStoryChapterCompleted(ch, save)) {
      return ch;
    }
  }
  return STORYLINE_CHAPTERS[STORYLINE_CHAPTERS.length - 1];
}

export function getStoryClearedCount(save: StorySaveLike): number {
  return STORYLINE_CHAPTERS.filter((c) => c.chapter > 0 && isStoryChapterCompleted(c, save)).length;
}

export function getNextChapterAfterMission(missionId: number): StoryChapterDef | undefined {
  const current = getStoryChapterForMission(missionId);
  if (!current) return undefined;
  return STORYLINE_CHAPTERS.find((c) => c.chapter === current.chapter + 1);
}

export function getNextChapterAfterSurveillance(surveillanceId: string): StoryChapterDef | undefined {
  const current = getStoryChapterForSurveillance(surveillanceId);
  if (!current) return undefined;
  return STORYLINE_CHAPTERS.find((c) => c.chapter === current.chapter + 1);
}

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
    { speaker: "Mara", text: "Welcome home to 420 Crescent. Your car's in the garage, and your SkyPhone is online [P / ↑].", dur: 3.6, audioUrl: "/audio/story/mara_openworld_intro.mp3" },
  ],
  practice: true,
  enemyHp: 100,
  enemyDamage: [5, 10],
  enemyAccuracy: 0.5,
  accent: "#38bdf8",
};

