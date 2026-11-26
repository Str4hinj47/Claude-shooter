export interface MissionCallDef {
  id: string;
  chapter: number;
  missionId?: number;
  surveillanceId?: string;
  codename: string;
  callerName: string;
  callerRole: string;
  audioUrl: string;
  gender: "female" | "male";
  accent: string;
  transcript: string;
}

export const MISSION_CALLS: MissionCallDef[] = [
  {
    id: "ch00",
    chapter: 0,
    missionId: 0,
    codename: "CALIBRATION",
    callerName: "Mara Vance",
    callerRole: "Private Handler · Broker",
    audioUrl: "/audio/missions/ch00.mp3",
    gender: "female",
    accent: "#2dd4bf",
    transcript:
      "Voss, it's Mara. Welcome to the subterranean range at Four Twenty Crescent. Before I patch you through to live clients, zero your suppressed rifle on the steel targets and drill a rear silent takedown. Senator Arthur Sterling already has escrow funds waiting for Contract One in Highland Village. Call me back when you're ready to deploy.",
  },
  {
    id: "ch01",
    chapter: 1,
    missionId: 1,
    codename: "PAPER TRAIL",
    callerName: "Sen. Arthur Sterling",
    callerRole: "Client · Escrow Verified",
    audioUrl: "/audio/missions/ch01.mp3",
    gender: "male",
    accent: "#a8c686",
    transcript:
      "Contractor, this is Senator Arthur Sterling. An ex-fixer bolted to Highland Estate Village with two briefcases containing my private offshore ledgers, and backed them up onto a barn archive server. Get inside the village at dawn, grab both ledger briefcases, scrub that barn terminal clean, and get back to the south road. Keep it quiet. My name cannot touch a police report.",
  },
  {
    id: "ch02",
    chapter: 2,
    surveillanceId: "hit_port_auditor",
    codename: "THE PORT AUDITOR",
    callerName: "Mara Vance",
    callerRole: "Private Handler · Broker",
    audioUrl: "/audio/missions/ch02.mp3",
    gender: "female",
    accent: "#f59e0b",
    transcript:
      "Voss, Mara here. Those Highland ledgers just blew open a dockside leak. Customs Auditor Marcus Bell holds the physical Dock Four seals and plans to hand them to City Hall. Tail his silver sedan across Westgate Bay without spooking him. Wait until he stops somewhere isolated, drop him silently, load his body into your trunk or starter boat, and dump him in deep Pacific water.",
  },
  {
    id: "ch03",
    chapter: 3,
    missionId: 4,
    codename: "BLACK LEDGER",
    callerName: "Victoria Thorne",
    callerRole: "Client · Shipping Heiress",
    audioUrl: "/audio/missions/ch03.mp3",
    gender: "female",
    accent: "#fbbf24",
    transcript:
      "Thank you for picking up. I am Victoria Thorne. Commander Ren seized my family's gold bullion aboard his freighter at Eastgate Seaport. Infiltrate the docks tonight, recover my gold from the east office, dismantle his four cargo crates, clear both manifest terminals, and neutralize Commander Ren before that ship sails. Extract on the south pier boat.",
  },
  {
    id: "ch04",
    chapter: 4,
    missionId: 2,
    codename: "GLASS VAULT",
    callerName: "Countess Elena Vane",
    callerRole: "Client · Cipher Contract",
    audioUrl: "/audio/missions/ch04.mp3",
    gender: "female",
    accent: "#38bdf8",
    transcript:
      "Voss, this is Countess Elena Vane. My Blood Star Diamond was stolen and locked inside an unfinished Midtown skyscraper before concrete seals the vault. Mara tells me you need the cipher etched into that gem too. Breach the construction yard, steal the Blood Star Diamond, scrub both accounting terminals, destroy all three signal jammers, and exit through the south gate.",
  },
  {
    id: "ch05",
    chapter: 5,
    surveillanceId: "hit_pharma_fixer",
    codename: "THE PHARMA FIXER",
    callerName: "Mara Vance",
    callerRole: "Private Handler · Broker",
    audioUrl: "/audio/missions/ch05.mp3",
    gender: "female",
    accent: "#f59e0b",
    transcript:
      "Voss, it is Mara. The Blood Star cipher cracked Viktor Kroll's payroll. Doctor Victor Kaine is laundering syndicate payouts across Westgate Bay. Track his blue SUV from Venice Canals to Saint Jude's Hospital and Mirror Park. Wait for an isolated stop, neutralize the target unseen, and clear the area offshore so Kroll stays blind.",
  },
  {
    id: "ch06",
    chapter: 6,
    missionId: 3,
    codename: "DEAD DROP",
    callerName: "Julian Mercer",
    callerRole: "Client · Tech CEO",
    audioUrl: "/audio/missions/ch06.mp3",
    gender: "male",
    accent: "#22d3ee",
    transcript:
      "This is Julian Mercer. Spy broker Viktor Kroll stole two prototype hard-drive cases from my labs and he's auctioning them in Downtown Westgate at midnight. I'm wiring full payout to get my tech buried. Recover both drive cases, scrub Kroll's Quantum Mainframe server, watch the rooftops for his snipers, and terminate Kroll himself before pulling out south.",
  },
  {
    id: "ch07",
    chapter: 7,
    surveillanceId: "hit_syndicate_architect",
    codename: "THE SYNDICATE ARCHITECT",
    callerName: "Mara Vance",
    callerRole: "Private Handler · Broker",
    audioUrl: "/audio/missions/ch07.mp3",
    gender: "female",
    accent: "#f59e0b",
    transcript:
      "Voss, Mara. Kroll's mainframe exposed the architect behind Apex Tower's blast locks, Damon Vale. He's driving his black luxury sedan from Vinewood Crest through City Hall to the Observatory and getting ready to flip. Tail him across Westgate Bay, take him down unseen, strip his master override keys for Brick, and dump the body at sea.",
  },
  {
    id: "ch08",
    chapter: 8,
    missionId: 5,
    codename: "HOSTILE TAKEOVER",
    callerName: "Apex Board Director",
    callerRole: "Anonymous Client · Insider",
    audioUrl: "/audio/missions/ch08.mp3",
    gender: "male",
    accent: "#ff5e5e",
    transcript:
      "Listen carefully, contractor. I sit on the Apex board, and Chairman Viktor Sorin has stolen confidential leverage files on every one of us. I unlocked the back perimeter during tonight's storm and wired your escrow. Meet your partner Brick at Apex Tower, clear all three executive terminals, recover Sorin's bearer bonds case in the lobby, neutralize Viktor Sorin, and extract from the North Helipad.",
  },
  {
    id: "ch09",
    chapter: 9,
    missionId: 6,
    codename: "THE SOVEREIGN CONTRACT",
    callerName: "The Consortium Envoy",
    callerRole: "Consortium Council · Priority",
    audioUrl: "/audio/missions/ch09.mp3",
    gender: "male",
    accent: "#c084fc",
    transcript:
      "Contractor. This comes from the highest table of the Consortium. General Drago Kovac went rogue and fortified Mount Ironridge with the Sovereign Diamond and our entire tri-nation archive. Breach that alpine fortress at midnight, retrieve the Sovereign Diamond from the east vault, clear all three classified servers, disable four backup relays, neutralize General Kovac, and board the North Helipad.",
  },
];

export function getMissionCallForMission(missionId: number): MissionCallDef | undefined {
  return MISSION_CALLS.find((c) => c.missionId === missionId);
}

export function getMissionCallForSurveillance(surveillanceId: string): MissionCallDef | undefined {
  return MISSION_CALLS.find((c) => c.surveillanceId === surveillanceId);
}

export interface StorySmsMessage {
  id: string;
  chapter: number;
  sender: "Mara Vance" | "Brick Horvat" | "Julian Voss" | "Client Wire";
  role: string;
  accent: string;
  tag?: "GHOST" | "LOUD" | "INTEL" | "CLOSED";
  text: string;
  reply?: string;
}

export function getStorySmsFeed(save: {
  records?: Record<number, { completed?: boolean; ghost?: boolean }>;
  surveillanceRecords?: Record<string, { completed?: boolean; unseen?: boolean }>;
  ledgerChoice?: "burn" | "claim" | null;
}): StorySmsMessage[] {
  const feed: StorySmsMessage[] = [
    {
      id: "sms_ch00_init",
      chapter: 0,
      sender: "Mara Vance",
      role: "Handler · Encrypted",
      accent: "#2dd4bf",
      tag: "INTEL",
      text: "Frequency active. Sen. Sterling wired your advance for Highland Village. Keep your suit clean and your suppressor cold.",
      reply: "Understood. Send the file.",
    },
  ];

  const r1 = save.records?.[1];
  if (r1?.completed) {
    feed.push({
      id: "sms_ch01",
      chapter: 1,
      sender: "Mara Vance",
      role: "Handler · Ch 01",
      accent: "#a8c686",
      tag: r1.ghost ? "GHOST" : "LOUD",
      text: r1.ghost
        ? "Clean work in Highland. Sterling's lawyers didn't even notice the barn server went dark. Decrypted the hashes — Dock 4 Customs Auditor Marcus Bell."
        : "Half the county heard the barn go up, Voss. Keep it quieter at the port. Those hashes point straight to Customs Auditor Marcus Bell.",
      reply: r1.ghost ? "Send Bell's route." : "They won't talk. Send Bell's route.",
    });
  }

  const h1 = save.surveillanceRecords?.["hit_port_auditor"];
  if (h1?.completed) {
    feed.push({
      id: "sms_ch02",
      chapter: 2,
      sender: "Mara Vance",
      role: "Handler · Ch 02",
      accent: "#f59e0b",
      tag: h1.unseen ? "GHOST" : "LOUD",
      text: h1.unseen
        ? "Coast Guard logged nothing. Bell is off the board cleanly. Victoria Thorne just opened Eastgate Seaport."
        : "Harbor patrol reported shots near Bell's route, so Thorne's pier mercs will be jumpy. Seaport contract is live.",
      reply: "On my way.",
    });
  }

  const r4 = save.records?.[4];
  if (r4?.completed) {
    feed.push({
      id: "sms_ch03",
      chapter: 3,
      sender: "Client Wire",
      role: "Victoria Thorne · Ch 03",
      accent: "#fbbf24",
      tag: r4.ghost ? "GHOST" : "LOUD",
      text: r4.ghost
        ? "Bullion is back in my vault before dawn without a single headline. Mara already forwarded Ren's cipher lead in Midtown."
        : "My gold is back and Ren is gone, though the port sirens woke half of Eastgate. Mara pulled Ren's Midtown cipher lead.",
      reply: "Escrow cleared.",
    });
  }

  const r2 = save.records?.[2];
  if (r2?.completed) {
    feed.push({
      id: "sms_ch04",
      chapter: 4,
      sender: "Mara Vance",
      role: "Handler · Ch 04",
      accent: "#38bdf8",
      tag: r2.ghost ? "GHOST" : "LOUD",
      text: r2.ghost
        ? "Blood Star Diamond scanned without tripping a single sensor. Cipher points to Dr. Victor Kaine laundering payrolls for Viktor Kroll."
        : "Construction crew reported heavy gunfire, so Kaine's security is already twitchy. Still got the cipher — Dr. Victor Kaine is next.",
      reply: "Track his car.",
    });
  }

  const h2 = save.surveillanceRecords?.["hit_pharma_fixer"];
  if (h2?.completed) {
    feed.push({
      id: "sms_ch05",
      chapter: 5,
      sender: "Mara Vance",
      role: "Handler · Ch 05",
      accent: "#f59e0b",
      tag: h2.unseen ? "GHOST" : "LOUD",
      text: h2.unseen
        ? "Kaine vanished without a trace. Kroll has no idea his payout pipeline just died. Julian Mercer wired your Downtown contract."
        : "Someone spotted the takedown near Kaine's route — Kroll's NVG detail is sweeping Downtown rooftops tonight.",
      reply: "Copy.",
    });
  }

  const r3 = save.records?.[3];
  if (r3?.completed) {
    feed.push({
      id: "sms_ch06",
      chapter: 6,
      sender: "Mara Vance",
      role: "Handler · Ch 06",
      accent: "#22d3ee",
      tag: r3.ghost ? "GHOST" : "LOUD",
      text: r3.ghost
        ? "Kroll never even saw who pulled the mainframe. Found Damon Vale's name — he built Apex Tower's blast locks and plans to flip."
        : "Downtown was a warzone, Voss, but Kroll is gone. His mainframe gave up Damon Vale — the architect behind Apex Tower's locks.",
      reply: "Put Brick on standby.",
    });
  }

  const h3 = save.surveillanceRecords?.["hit_syndicate_architect"];
  if (h3?.completed) {
    feed.push({
      id: "sms_ch07",
      chapter: 7,
      sender: "Brick Horvat",
      role: "Breacher · Ch 07",
      accent: "#38bdf8",
      tag: h3.unseen ? "GHOST" : "LOUD",
      text: h3.unseen
        ? "Vale's override keys came through clean. Zero alerts at City Hall. I'm staged outside Apex Tower's storm gate."
        : "Got Vale's keys, though Sorin's patrols saw the commotion. Doesn't matter — I'm staged outside Apex Tower with thermite.",
      reply: "See you at the gate.",
    });
  }

  const r5 = save.records?.[5];
  if (r5?.completed) {
    feed.push({
      id: "sms_ch08",
      chapter: 8,
      sender: "Brick Horvat",
      role: "Breacher · Ch 08",
      accent: "#ff5e5e",
      tag: r5.ghost ? "GHOST" : "LOUD",
      text: r5.ghost
        ? "Never seen anyone move through Apex black-ops like that in a suit, Voss. Mara locked Kovač's fortress—and the Apex Director just pinged a $25k escrow offer if you hand over the Diamond."
        : "Hell of a firefight in that lobby, Voss. Sorin's key points straight to Kovač at Ironridge—and the Apex Director wants to buy the Diamond for $25k once Kovač drops.",
      reply: "I decide at Ironridge.",
    });
  }

  const r6 = save.records?.[6];
  if (r6?.completed) {
    const choice = save.ledgerChoice;
    feed.push({
      id: "sms_ch09",
      chapter: 9,
      sender: choice === "claim" ? "Client Wire" : "Mara Vance",
      role: choice === "claim" ? "Offshore Trust · Finale" : "Handler · Finale",
      accent: choice === "claim" ? "#fbbf24" : "#c084fc",
      tag: "CLOSED",
      text:
        choice === "claim"
          ? "Consortium escrow ($25,000 CR) settled into your offshore trust. Half the Apex Board now answers to you—keep your relays cold, Voss."
          : choice === "burn"
            ? "Kovač is dead and you burned the Sovereign Diamond to ash. Zero Consortium leverage, zero blood money. Burn this line, Julian."
            : "Kovač is dead and the Sovereign Diamond is in your hand. Open your Ironridge Debrief to burn the Ledger or claim the Consortium escrow.",
      reply: choice === "claim" ? "Stay off my grid." : "Already done.",
    });
  }

  return feed.reverse();
}
