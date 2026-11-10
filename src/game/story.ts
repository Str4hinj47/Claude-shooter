/* ------------------------------------------------------------------ */
/*  VANGUARD: BLACKOUT PROTOCOL — campaign data                        */
/*  Single source of truth for menus, briefings, dialogue and levels.  */
/*  Full story bible: STORY.md                                         */
/* ------------------------------------------------------------------ */

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

export interface ObjectiveDef {
  id: string;
  label: string;
  kind: "eliminate" | "destroy" | "reach" | "rescue" | "boss";
  count?: number;
  /** reach/rescue target position */
  at?: [number, number];
}

export interface MissionDef {
  id: number;
  codename: string;
  name: string;
  location: string;
  timeOfDay: string;
  /** faction tint for enemies (body, visor) */
  tint: [number, number];
  tintName: string;
  briefing: string[];
  debrief: string[];
  objectives: ObjectiveDef[];
  enemies: EnemySpawn[];
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
    name: "Practice Range",
    location: "Vanguard Range — Zlatograd outskirts",
    timeOfDay: "Midday",
    tint: [0xd8cdb4, 0x88ccff],
    tintName: "Vanguard (you)",
    briefing: [
      "Mara: New armour, new rifle, same Vanguard. Before you go into Zlatograd, show me what you've got.",
      "Steel targets, crates, barriers — the full range. Move, aim, reload, crouch, sprint. Tab for showcase orbit.",
      "When you're ready, pick Mission 1: First Light. Gornja Luka is waiting.",
    ],
    debrief: ["Calibration complete. Welcome back, Vanguard. Zlatograd is waiting."],
    objectives: [{ id: "free", label: "Free play — train, then pick Mission 1", kind: "reach", at: [0, 0] }],
    enemies: [],
    spawn: [0, 0, 0],
    extraction: [0, 0, 3],
    intro: [
      { speaker: "Mara", text: "Range is yours, Elias. Warm up that rifle. Targets are live." },
      { speaker: "Mara", text: "When you're done, Gornja Luka. Dawn patrol. Petar's waiting on us." },
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
    codename: "FIRST LIGHT",
    name: "Gornja Luka Village",
    location: "Gornja Luka — small Balkan town",
    timeOfDay: "Dawn",
    tint: [0x6b7a4a, 0xffb84d],
    tintName: "Village Militia (olive)",
    briefing: [
      "Meridian's militia seized Gornja Luka to plant a Lattice relay. Old Petar hid the patrol radio codes in the church.",
      "Mara needs those codes — without them she's flying blind for the whole campaign.",
      "Eliminate the patrol (6), rescue Petar, reach extraction at the village edge.",
    ],
    debrief: [
      "Petar's codes open Meridian's radio net. Mara can hear their chatter now.",
      "Next target: a relay under construction on the Meridian Tower site. Dr. Lena Aris is hiding there.",
    ],
    objectives: [
      { id: "kill", label: "Eliminate the village patrol", kind: "eliminate", count: 6 },
      { id: "rescue", label: "Rescue Old Petar at the church", kind: "rescue", at: [-2, -20] },
      { id: "extract", label: "Reach extraction — village edge", kind: "reach", at: [0, 42] },
    ],
    enemies: [
      { x: -8, z: -6, mode: "patrol", patrol: [[-8, -6], [7, -6], [7, 6], [-8, 6]] },
      { x: 9, z: 2, mode: "patrol", patrol: [[9, 2], [7, 14], [-6, 14]] },
      { x: -10, z: 12, mode: "guard" },
      { x: 6, z: -28, mode: "guard" },
      { x: -2, z: -26, mode: "guard" },
      { x: 10, z: -22, mode: "patrol", patrol: [[10, -22], [2, -22]] },
    ],
    spawn: [0, 44, 180],
    extraction: [0, 44, 4],
    rescue: [-2, -20],
    intro: [
      { speaker: "Mara", text: "Dawn in Gornja Luka. Petar's church, centre of the village. Militia patrol — locals, conscripts." },
      { speaker: "Mara", text: "They won't be crack troops, Elias. Still — shoot first. Petar's counting on us." },
    ],
    onFirstContact: [{ speaker: "Mara", text: "Contact! Patrol's alerted. Clear the village, then get to Petar." }],
    onObjective: [{ speaker: "Petar", text: "You came. After all this time… you came. The codes are in the church book. Take them. And take this town back." }],
    onExtraction: [{ speaker: "Mara", text: "Codes received. I can hear their chatter now. Elias — we just bought ourselves eyes. Let's use them." }],
    enemyHp: 100,
    enemyDamage: [5, 9],
    enemyAccuracy: 0.42,
    accent: "#a8c686",
  },

  /* ------------------------------------------------ MISSION 2 ------ */
  {
    id: 2,
    codename: "CONCRETE HEART",
    name: "Meridian Tower Site",
    location: "Meridian Tower — construction site",
    timeOfDay: "Overcast day",
    tint: [0x4a4d52, 0xff4444],
    tintName: "Meridian Contractors (charcoal)",
    briefing: [
      "Dr. Lena Aris built the Lattice relays — and stole their master codes. She's hiding in the site office.",
      "Three signal jammers are killing her distress beacon. Destroy them (shoot the red crates), then get her out.",
      "Site security: 8 contractors. They will hunt you once the first jammer dies.",
    ],
    debrief: [
      "Lena's codes reveal the kill-switch is on the downtown relay — Tomas's relay.",
      "Mara goes quiet. \"That's my brother's relay, Elias. We go downtown next.\"",
    ],
    objectives: [
      { id: "destroy", label: "Destroy the signal jammers", kind: "destroy", count: 3 },
      { id: "rescue", label: "Rescue Dr. Lena Aris at the site office", kind: "rescue", at: [-18, -20] },
      { id: "kill", label: "Eliminate site security", kind: "eliminate", count: 8 },
      { id: "extract", label: "Reach extraction — site gate", kind: "reach", at: [0, 46] },
    ],
    enemies: [
      { x: 10, z: -10, mode: "patrol", patrol: [[10, -10], [10, 10], [-10, 10]] },
      { x: -12, z: 8, mode: "guard" },
      { x: 14, z: 16, mode: "guard" },
      { x: -8, z: -28, mode: "patrol", patrol: [[-8, -28], [8, -28]] },
      { x: 16, z: -24, mode: "guard" },
      { x: -16, z: -30, mode: "guard" },
      { x: 4, z: 24, mode: "advance" },
      { x: -14, z: 24, mode: "advance" },
    ],
    spawn: [0, 46, 180],
    extraction: [0, 46, 4],
    destroyables: [
      [16, -6],
      [-16, -8],
      [0, -34],
    ],
    rescue: [-18, -13.5],
    intro: [
      { speaker: "Lena", text: "—anyone— the jammers are killing my beacon— please—" },
      { speaker: "Mara", text: "That's Lena. Those jammers are why she's still alive — Meridian can't track her while they're up. Take them down." },
    ],
    onFirstContact: [{ speaker: "Mara", text: "Security's moving. They know someone's on site. Keep pushing — jammers first." }],
    onObjective: [{ speaker: "Lena", text: "The codes. I copied everything. Sorin doesn't know. He thinks I'm still his engineer. Let me show you what he built." }],
    onExtraction: [{ speaker: "Mara", text: "Lena's codes are ours. The kill-switch is on the downtown relay. Elias… that's Tomas's relay." }],
    enemyHp: 100,
    enemyDamage: [6, 11],
    enemyAccuracy: 0.5,
    accent: "#8ecae6",
  },

  /* ------------------------------------------------ MISSION 3 ------ */
  {
    id: 3,
    codename: "ROOFTOPS",
    name: "Downtown Zlatograd",
    location: "Downtown — city block & rooftop relay",
    timeOfDay: "Dusk",
    tint: [0x2a2c30, 0xff3333],
    tintName: "Meridian Elite (black)",
    briefing: [
      "Tomas Kovač hid his data cache on the downtown relay antenna. It holds the Lattice kill-switch — and the proof of who ordered his death.",
      "Meridian Elite hold the block: snipers on the rooftops, patrols in the streets. 10 hostiles.",
      "Clear the block, reach the rooftop relay cache, extract.",
    ],
    debrief: [
      "The kill-switch is real. So is Ren's guilt. Mara wants the docks tonight.",
      "Nadia, a dock smuggler, agrees to guide Voss in after dark.",
    ],
    objectives: [
      { id: "kill", label: "Eliminate the downtown force", kind: "eliminate", count: 11 },
      { id: "cache", label: "Reach the rooftop relay cache", kind: "reach", at: [18, -26] },
      { id: "extract", label: "Reach extraction — south street", kind: "reach", at: [0, 46] },
    ],
    enemies: [
      { x: -6, z: -4, mode: "patrol", patrol: [[-6, -4], [6, -4], [6, 12]] },
      { x: 12, z: 10, mode: "guard" },
      { x: -14, z: 12, mode: "guard" },
      { x: 6, z: -16, mode: "advance" },
      { x: -6, z: -20, mode: "advance" },
      { x: 16, z: -22, mode: "guard" },
      { x: -16, z: -24, mode: "guard" },
      { x: 13, z: -4, y: 30, mode: "guard" },
      { x: 17, z: -4, y: 30, mode: "guard" },
      { x: -10, z: -28, y: 24, mode: "guard" },
      { x: 0, z: 26, mode: "patrol", patrol: [[0, 26], [14, 26], [14, 6]] },
    ],
    spawn: [0, 46, 180],
    extraction: [0, 46, 4],
    intro: [
      { speaker: "Mara", text: "Tomas used to climb that relay at night. Said the city looked like a circuit board from up there." },
      { speaker: "Mara", text: "Find his cache, Elias. Bring him home. Elite are on the rooftops — watch the skyline." },
    ],
    onFirstContact: [{ speaker: "Mara", text: "Elite contact! Rooftops and streets. Clear them, then climb to the relay." }],
    onHalfway: [{ speaker: "Mara", text: "Half the block is clear. The relay's at the north end — follow the street, watch the roofs." }],
    onObjective: [{ speaker: "Mara", text: "It's him. His handwriting. The kill-switch is real — and there's a name on the kill order. Commander Ren. The docks. He did it, Elias. He did it." }],
    onExtraction: [{ speaker: "Voss", text: "Then we go to the docks." }],
    enemyHp: 110,
    enemyDamage: [7, 13],
    enemyAccuracy: 0.58,
    accent: "#ff9e5e",
  },

  /* ------------------------------------------------ MISSION 4 ------ */
  {
    id: 4,
    codename: "IRON TIDE",
    name: "Zlatograd Port",
    location: "Zlatograd Port — docks & cargo ship",
    timeOfDay: "Night",
    tint: [0x2e3d55, 0x66d9ff],
    tintName: "Dock Security (navy)",
    briefing: [
      "The Meridian ship Iron Tide is unloading autonomous weapons — the live-test arsenal. Commander Ren is aboard.",
      "Destroy 4 weapons crates (marked), kill Ren (boss), steal the manifests. 9 dock security.",
      "Nadia guides you by radio. Stay out of the floodlights.",
    ],
    debrief: [
      "With the manifests, Mara can prove everything — if she can broadcast them. The Lattice must die first.",
      "Brick arrives with a plan: a stolen APC, a breached wall, one last assault on Meridian HQ.",
    ],
    objectives: [
      { id: "destroy", label: "Destroy the weapons crates", kind: "destroy", count: 4 },
      { id: "boss", label: "Eliminate Commander Ren", kind: "boss", count: 1 },
      { id: "kill", label: "Eliminate dock security", kind: "eliminate", count: 9 },
      { id: "extract", label: "Reach extraction — the pier", kind: "reach", at: [0, 48] },
    ],
    enemies: [
      { x: -12, z: -6, mode: "patrol", patrol: [[-12, -6], [12, -6], [12, 8]] },
      { x: 14, z: 13, mode: "guard" },
      { x: -16, z: 14, mode: "guard" },
      { x: 3, z: -23, y: 3.5, mode: "advance" },
      { x: -3, z: -23, y: 3.5, mode: "advance" },
      { x: 18, z: -10, mode: "guard" },
      { x: -18, z: -10, mode: "guard" },
      { x: 6, z: 24, mode: "patrol", patrol: [[6, 24], [-14, 24]] },
      { x: -6, z: 30, mode: "guard" },
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
      { speaker: "Nadia", text: "Crane three is mine. I'll swing the light your way. Stay out of the floodlights, hero — Ren's boys love a lit target." },
      { speaker: "Mara", text: "Weapons crates are marked. Four of them. And Elias… Tomas's last message named Ren. Make it count." },
    ],
    onFirstContact: [{ speaker: "Nadia", text: "They've seen you! Dock security's moving — crates first, then Ren." }],
    onHalfway: [{ speaker: "Mara", text: "Ren's on the ship's deck at the north end. Heavy guard. Bring him down." }],
    onObjective: [{ speaker: "Mara", text: "Manifests secured. The test is in 72 hours. And now we know where Sorin will be watching it from. His tower. We end this at the tower." }],
    onExtraction: [{ speaker: "Nadia", text: "Pier's clear. Get to the boat, hero. Zlatograd owes you one." }],
    enemyHp: 120,
    enemyDamage: [8, 14],
    enemyAccuracy: 0.62,
    accent: "#66d9ff",
  },

  /* ------------------------------------------------ MISSION 5 ------ */
  {
    id: 5,
    codename: "BLACKOUT",
    name: "Meridian HQ",
    location: "Meridian HQ — compound & tower",
    timeOfDay: "Night, storm",
    tint: [0x1e2024, 0xff3333],
    tintName: "HQ Guard (black)",
    briefing: [
      "Voss and Brick assault Meridian HQ. Brick fights beside you — follow him, cover him.",
      "Sorin is in the tower, watching his live test begin. Kill his guard (6), kill Sorin (boss), reach the helipad.",
      "Trigger the kill-switch. Broadcast the truth. End the Lattice.",
    ],
    debrief: [
      "Sorin is arrested live on every screen in Zlatograd. Meridian's contract is torn up in public.",
      "Petar rings the church bell. Lena testifies. Nadia gets her boats back. Brick keeps the APC. Mara finally sleeps.",
      "And Voss — Vanguard — walks out of Zlatograd at dawn, rifle on his back, owing nobody anything.",
    ],
    objectives: [
      { id: "kill", label: "Breach the courtyard — eliminate HQ guard", kind: "eliminate", count: 6 },
      { id: "boss", label: "Eliminate Viktor Sorin", kind: "boss", count: 1 },
      { id: "extract", label: "Reach extraction — helipad", kind: "reach", at: [0, -43] },
    ],
    enemies: [
      { x: -12, z: 10, mode: "guard" },
      { x: 12, z: 10, mode: "guard" },
      { x: -14, z: -6, mode: "advance" },
      { x: 14, z: -6, mode: "advance" },
      { x: -8, z: -24, mode: "guard" },
      { x: 8, z: -24, mode: "guard" },
      { x: 0, z: -26, mode: "guard", boss: true, name: "Viktor Sorin" },
    ],
    spawn: [0, 44, 180],
    extraction: [0, -43, 4],
    ally: [3, 42],
    intro: [
      { speaker: "Brick", text: "APC's mine, kid. I'll park it through the gate. You just make sure the courtyard's empty when I get there. …Try to keep up." },
      { speaker: "Sorin", text: "Captain Voss. I offered you a fortune. I offer you a future. Join Meridian, and Zlatograd is yours to rule." },
      { speaker: "Voss", text: "I already ruled this city once, Viktor. I gave it back." },
    ],
    onFirstContact: [{ speaker: "Brick", text: "Contact! HQ guard's on us. Brick's got your six — push to the tower!" }],
    onHalfway: [{ speaker: "Brick", text: "Courtyard's ours, kid. Sorin's in the tower. Let's go introduce ourselves." }],
    onObjective: [{ speaker: "Mara", text: "Broadcasting now. Every screen in Zlatograd. The manifests, the kill order, Ren's confession. …Elias. Look at the skyline." }],
    onExtraction: [{ speaker: "Mara", text: "City lights are coming back. The Lattice is dead. Elias — you did it. You gave it back." }],
    enemyHp: 130,
    enemyDamage: [9, 16],
    enemyAccuracy: 0.66,
    accent: "#ff5e5e",
  },
];

export const BOSS_HP: Record<string, number> = {
  "Commander Ren": 200,
  "Viktor Sorin": 300,
};
