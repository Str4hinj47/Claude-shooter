import * as THREE from "three";
import * as SkeletonUtils from "three/examples/jsm/utils/SkeletonUtils.js";
import type { GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import { CHARACTERS, characterUrl } from "../characters";
import { loadCachedSoldierGltf, upgradeCharacterMaterial } from "../../character/SoldierRig";
import { clamp, dampAngle, wrapAngle } from "../../character/math";
import type { TrafficId } from "../vehicles/catalog";
import type { DriveableVehicle, WestgateVehicleManager } from "./VehicleSystem";
import type { BodyCarrySystem, DeadBodyRecord } from "./BodyCarrySystem";
import type { PedestrianSystem } from "./PedestrianSystem";
import type { WantedSystem } from "./WantedSystem";
import type { NpcVoiceSystem } from "./NpcVoices";
import type { TerrainHeightFn } from "./HeightSystem";
export type GroundHeightFn = (x: number, z: number, y: number) => number;
import { recordSurveillanceContract } from "../progression";

export interface ScriptDialogueLine {
  speaker: "target" | "colleague" | "phone";
  speakerName: string;
  actionNote: string;
  line: string;
  audioUrl?: string;
}

export interface ContractColleagueSpec {
  id: string;
  name: string;
  roleTitle: string;
  modelId: string;
  x: number;
  z: number;
  yaw: number;
  patrolRadius?: number;
}

export interface ContractSchedulePhase {
  id: string;
  startHour: number;
  endHour: number;
  label: string;
  locationName: string;
  parkX: number;
  parkZ: number;
  parkYaw: number;
  driveWaypoints: [number, number][];
  spotX: number;
  spotZ: number;
  walkLoop: [number, number][];
  isolatedWindow: boolean;
  windowNote: string;
  colleagueId?: string;
  scriptLines: ScriptDialogueLine[];
}

export interface SurveillanceContractDef {
  id: string;
  code: string;
  title: string;
  targetName: string;
  targetRoleTitle: string;
  targetModelId: string;
  residence: { name: string; address: string; district: string; x: number; z: number };
  vehicle: { modelId: TrafficId; label: string; colorName: string; paintHex: number };
  workplace: { name: string; district: string; x: number; z: number };
  rewardBase: number;
  unseenBonus: number;
  deepSeaBonus: number;
  briefing: string;
  colleagues: ContractColleagueSpec[];
  schedule: ContractSchedulePhase[];
}

export const SURVEILLANCE_CONTRACTS: SurveillanceContractDef[] = [
  {
    id: "hit_port_auditor",
    code: "H1",
    title: "The Port Auditor",
    targetName: "Marcus Bell",
    targetRoleTitle: "Senior Customs Compliance Auditor",
    targetModelId: "business",
    residence: {
      name: "Bell Suburban Home",
      address: "418 Mirror Park Crescent",
      district: "Old Quarter",
      x: -265,
      z: 510,
    },
    vehicle: {
      modelId: "compact",
      label: "Silver Blista Compact",
      colorName: "Silver",
      paintHex: 0xcbd5e1,
    },
    workplace: {
      name: "Downtown Customs Annex & Eastgate Seaport",
      district: "Downtown / East Port",
      x: 34,
      z: -148,
    },
    rewardBase: 3500,
    unseenBonus: 1500,
    deepSeaBonus: 1000,
    briefing:
      "STORY CH 2 · ACT I — Sterling's Highland Village archive flagged Port Auditor Marcus Bell before he hands our Dock 4 smuggling seals to City Hall. Tail him through his daily routine—Old Quarter home, Midtown coffee, Downtown Customs Annex, Eastgate Seaport inspection, and his evening canal walk. Strike silently in an isolated opening, and sink the body in the Pacific before we raid Commander Ren's docks.",
    colleagues: [
      {
        id: "clara_hayes",
        name: "Clara Hayes",
        roleTitle: "Next-Door Neighbor",
        modelId: "civilian",
        x: -282,
        z: 496,
        yaw: 0.7,
        patrolRadius: 2.0,
      },
      {
        id: "devon_park",
        name: "Devon Park",
        roleTitle: "Junior Customs Analyst",
        modelId: "business",
        x: -261,
        z: -106,
        yaw: -1.1,
        patrolRadius: 1.5,
      },
      {
        id: "nadia_chen",
        name: "Nadia Chen",
        roleTitle: "Compliance Branch Lead",
        modelId: "business",
        x: 37,
        z: -151,
        yaw: -2.2,
        patrolRadius: 2.2,
      },
      {
        id: "guard_hale",
        name: "Officer Hale",
        roleTitle: "Customs Plaza Security",
        modelId: "security",
        x: 24,
        z: -140,
        yaw: 0.4,
        patrolRadius: 4.0,
      },
      {
        id: "eddie_cruz",
        name: "Eddie Cruz",
        roleTitle: "Eastgate Dock Foreman",
        modelId: "construction",
        x: 576,
        z: 432,
        yaw: -0.6,
        patrolRadius: 2.5,
      },
    ],
    schedule: [
      {
        id: "marcus_home_morning",
        startHour: 7.0,
        endHour: 8.5,
        label: "Morning Porch & Neighbor Chat",
        locationName: "418 Mirror Park Crescent (Home)",
        parkX: -292,
        parkZ: 488,
        parkYaw: 0.65,
        driveWaypoints: [],
        spotX: -276,
        spotZ: 498,
        walkLoop: [
          [-276, 498],
          [-279, 496],
          [-273, 502],
        ],
        isolatedWindow: false,
        windowNote: "High risk — neighbor Clara Hayes is watching the porch.",
        colleagueId: "clara_hayes",
        scriptLines: [
          {
            speaker: "colleague",
            speakerName: "Clara Hayes",
            actionNote: "waves over the white picket fence with a coffee mug",
            line: "Morning, Marcus! Heading down to the harbor early again?", audioUrl: "/public/audio/surveillance/surv_01.mp3",
          },
          {
            speaker: "target",
            speakerName: "Marcus Bell",
            actionNote: "locks his front door and pats his briefcase",
            line: "Yeah, Clara. Three containers came off the night barge without stamped bills. Somebody's cooking Pier 4's books.", audioUrl: "/public/audio/surveillance/surv_02.mp3",
          },
          {
            speaker: "colleague",
            speakerName: "Clara Hayes",
            actionNote: "glances toward his silver Compact in the driveway",
            line: "Just don't work yourself into an early grave. Pick up dinner on your way home tonight.", audioUrl: "/public/audio/surveillance/surv_03.mp3",
          },
          {
            speaker: "target",
            speakerName: "Marcus Bell",
            actionNote: "checks his watch and walks toward his car",
            line: "Meeting Devon at the Midtown café first, then straight to the plaza. See you at seven, Clara.", audioUrl: "/public/audio/surveillance/surv_04.mp3",
          },
        ],
      },
      {
        id: "marcus_midtown_coffee",
        startHour: 8.5,
        endHour: 10.5,
        label: "Coffee Briefing with Analyst",
        locationName: "Midtown Del Sol Café Curb",
        parkX: -268,
        parkZ: -124,
        parkYaw: 0.0,
        driveWaypoints: [
          [-348, 375],
          [-232, 298],
          [-265, 110],
          [-270, -100],
        ],
        spotX: -263,
        spotZ: -108,
        walkLoop: [
          [-263, -108],
          [-260, -109],
          [-265, -112],
        ],
        isolatedWindow: false,
        windowNote: "Witnessed — colleague Devon Park and Midtown foot traffic nearby.",
        colleagueId: "devon_park",
        scriptLines: [
          {
            speaker: "colleague",
            speakerName: "Devon Park",
            actionNote: "glances around nervously and lowers his voice",
            line: "Marcus, please—tell me you didn't log container forty-seven into the federal portal yet.", audioUrl: "/public/audio/surveillance/surv_05.mp3",
          },
          {
            speaker: "target",
            speakerName: "Marcus Bell",
            actionNote: "sips espresso and taps the manila folder",
            line: "It's already drafted, Devon. Three tons of undeclared crates walked off Pier 4 last Tuesday.", audioUrl: "/public/audio/surveillance/surv_06.mp3",
          },
          {
            speaker: "colleague",
            speakerName: "Devon Park",
            actionNote: "leans against the café railing",
            line: "The people moving those crates don't write memos, man. Drop it before you drive out to Eastgate today.", audioUrl: "/public/audio/surveillance/surv_07.mp3",
          },
          {
            speaker: "target",
            speakerName: "Marcus Bell",
            actionNote: "snaps his briefcase shut",
            line: "I don't take threats over a latte. Meet Nadia at the annex—I'm pulling the physical seals after lunch.", audioUrl: "/public/audio/surveillance/surv_08.mp3",
          },
        ],
      },
      {
        id: "marcus_downtown_office",
        startHour: 10.5,
        endHour: 13.5,
        label: "Downtown Customs Annex Shift",
        locationName: "Legion Square Customs Courtyard",
        parkX: 38,
        parkZ: -118,
        parkYaw: 1.57,
        driveWaypoints: [
          [-238, -138],
          [-150, -118],
          [-55, -98],
          [32, -96],
        ],
        spotX: 35,
        spotZ: -149,
        walkLoop: [
          [35, -149],
          [38, -153],
          [32, -145],
        ],
        isolatedWindow: false,
        windowNote: "Guarded — Nadia Chen and Officer Hale are watching the plaza.",
        colleagueId: "nadia_chen",
        scriptLines: [
          {
            speaker: "colleague",
            speakerName: "Nadia Chen",
            actionNote: "hands Marcus a stamped clipboard beside the marble steps",
            line: "City Hall called twice asking for your Pier 4 audit summary, Marcus. Guard Hale is logging visitors upstairs.", audioUrl: "/public/audio/surveillance/surv_09.mp3",
          },
          {
            speaker: "target",
            speakerName: "Marcus Bell",
            actionNote: "flips through manifests under the awning",
            line: "Tell the deputy mayor I'll have photos of the broken customs seals from the Eastgate quay by three.", audioUrl: "/public/audio/surveillance/surv_10.mp3",
          },
          {
            speaker: "colleague",
            speakerName: "Officer Hale",
            actionNote: "adjusts his radio earpiece while scanning the plaza",
            line: "Watch yourself out at the container yard, Bell. Port security doesn't cover the far east apron.", audioUrl: "/public/audio/surveillance/surv_11.mp3",
          },
          {
            speaker: "target",
            speakerName: "Marcus Bell",
            actionNote: "waves off Hale and checks his phone",
            line: "I'm only checking one row of containers with Eddie, then walking the canals to clear my head.", audioUrl: "/public/audio/surveillance/surv_12.mp3",
          },
        ],
      },
      {
        id: "marcus_seaport_pier",
        startHour: 13.5,
        endHour: 16.5,
        label: "Isolated Eastgate Pier Inspection",
        locationName: "Eastgate Seaport · Outer East Quay",
        parkX: 568,
        parkZ: 422,
        parkYaw: 1.4,
        driveWaypoints: [
          [84, -78],
          [90, 200],
          [290, 260],
          [525, 280],
          [740, 280],
          [745, 420],
        ],
        spotX: 682,
        spotZ: 486,
        walkLoop: [
          [678, 456],
          [692, 488],
          [668, 492],
        ],
        isolatedWindow: true,
        windowNote: "STRIKE WINDOW · Marcus walks past Foreman Cruz to inspect the isolated outer quay alone!",
        colleagueId: "eddie_cruz",
        scriptLines: [
          {
            speaker: "colleague",
            speakerName: "Eddie Cruz",
            actionNote: "points from the warehouse doorway toward the cranes",
            line: "Yard's quiet down on the east apron, Bell. I gotta check the crane winch inside—holler if you need a forklift.", audioUrl: "/public/audio/surveillance/surv_13.mp3",
          },
          {
            speaker: "target",
            speakerName: "Marcus Bell",
            actionNote: "walks out alone to the edge of the harbor quay",
            line: "Copy that, Eddie. Just snapping serial numbers out by the bollard line.", audioUrl: "/public/audio/surveillance/surv_14.mp3",
          },
          {
            speaker: "phone",
            speakerName: "Marcus Bell (Phone)",
            actionNote: "speaks into his phone while staring across the harbor water",
            line: "Yeah, I'm out on the far end of the pier completely alone. Give me twenty minutes and I'm uploading the whole file.", audioUrl: "/public/audio/surveillance/surv_15.mp3",
          },
          {
            speaker: "target",
            speakerName: "Marcus Bell",
            actionNote: "crouches by a yellow mooring bollard taking photos",
            line: "Serial 47-Delta... bingo. Got everything I need.", audioUrl: "/public/audio/surveillance/surv_16.mp3",
          },
        ],
      },
      {
        id: "marcus_canal_walk",
        startHour: 16.5,
        endHour: 19.5,
        label: "Evening Venice Canals Stroll",
        locationName: "Venice Canals North Embankment",
        parkX: -662,
        parkZ: 132,
        parkYaw: 3.1,
        driveWaypoints: [
          [525, 280],
          [290, 260],
          [90, 200],
          [-232, 298],
          [-488, 250],
          [-648, 128],
        ],
        spotX: -632,
        spotZ: 172,
        walkLoop: [
          [-642, 168],
          [-598, 170],
          [-624, 174],
        ],
        isolatedWindow: true,
        windowNote: "STRIKE WINDOW · Quiet canal walkway—close to your Starter Boat at Pacific Marina!",
        scriptLines: [
          {
            speaker: "phone",
            speakerName: "Marcus Bell (Phone)",
            actionNote: "paces slowly along the quiet canal wall at dusk",
            line: "No, Devon, I'm just walking along the Venice canals by myself before heading home. Nobody followed me.", audioUrl: "/public/audio/surveillance/surv_17.mp3",
          },
          {
            speaker: "target",
            speakerName: "Marcus Bell",
            actionNote: "leans against the canal balustrade watching the water",
            line: "Calm down. By Monday morning the port commission will clean house and we can finally sleep.", audioUrl: "/public/audio/surveillance/surv_18.mp3",
          },
        ],
      },
      {
        id: "marcus_home_evening",
        startHour: 19.5,
        endHour: 22.5,
        label: "Drive Home & Night Porch",
        locationName: "418 Mirror Park Crescent (Home)",
        parkX: -292,
        parkZ: 488,
        parkYaw: 0.65,
        driveWaypoints: [
          [-510, 445],
          [-405, 485],
        ],
        spotX: -275,
        spotZ: 500,
        walkLoop: [
          [-275, 500],
          [-278, 496],
          [-272, 504],
        ],
        isolatedWindow: false,
        windowNote: "Neighbor Clara is outside across the yard fence.",
        colleagueId: "clara_hayes",
        scriptLines: [
          {
            speaker: "colleague",
            speakerName: "Clara Hayes",
            actionNote: "calls out from her porch swing",
            line: "You look beat, Marcus. Long day down at the docks?", audioUrl: "/public/audio/surveillance/surv_19.mp3",
          },
          {
            speaker: "target",
            speakerName: "Marcus Bell",
            actionNote: "rubs his shoulders and smiles tiredly",
            line: "Longest week of my life, Clara. Tomorrow morning I turn the whole file in and take the weekend off.", audioUrl: "/public/audio/surveillance/surv_20.mp3",
          },
        ],
      },
    ],
  },

  {
    id: "hit_pharma_fixer",
    code: "H2",
    title: "The Pharma Fixer",
    targetName: "Dr. Victor Kaine",
    targetRoleTitle: "Clinical Trial Director",
    targetModelId: "business",
    residence: {
      name: "Kaine Canalfront Villa",
      address: "12 Venice Canal West",
      district: "West Coast",
      x: -648,
      z: 245,
    },
    vehicle: {
      modelId: "crossover",
      label: "Midnight Blue Overtake SUV",
      colorName: "Midnight Blue",
      paintHex: 0x1e3a8a,
    },
    workplace: {
      name: "St. Jude's Medical Center",
      district: "Midtown",
      x: -146,
      z: -206,
    },
    rewardBase: 4500,
    unseenBonus: 2000,
    deepSeaBonus: 1200,
    briefing:
      "STORY CH 5 · ACT II — The Blood Star cipher exposed Dr. Victor Kaine as the clinic fixer laundering payouts and supplying neuro-stimulants to Viktor Kroll's detail. Tail his blue SUV from Venice Canals to St. Jude's Medical Center, Mirror Central Park, and the Pacific Marina breakwater—execute an unseen takedown or sabotage strike, and dispose of him offshore before moving on Kroll.",
    colleagues: [
      {
        id: "leo_navarro",
        name: "Leo Navarro",
        roleTitle: "Canal Jogger Neighbor",
        modelId: "sports",
        x: -662,
        z: 234,
        yaw: -0.5,
        patrolRadius: 2.2,
      },
      {
        id: "elena_morales",
        name: "Nurse Elena Morales",
        roleTitle: "Clinical Trial Coordinator",
        modelId: "civilian",
        x: -140,
        z: -218,
        yaw: 0.9,
        patrolRadius: 1.8,
      },
      {
        id: "mercer_guard",
        name: "Mercer",
        roleTitle: "Private Executive Escort",
        modelId: "security",
        x: -156,
        z: -204,
        yaw: 2.6,
        patrolRadius: 3.5,
      },
      {
        id: "julian_cross",
        name: "Julian Cross",
        roleTitle: "Pharma Lobbyist",
        modelId: "business",
        x: -134,
        z: 382,
        yaw: -1.8,
        patrolRadius: 1.5,
      },
    ],
    schedule: [
      {
        id: "kaine_villa_morning",
        startHour: 7.0,
        endHour: 8.75,
        label: "Canal Villa Espresso & Neighbor",
        locationName: "12 Venice Canal West (Home)",
        parkX: -678,
        parkZ: 242,
        parkYaw: 0.0,
        driveWaypoints: [],
        spotX: -658,
        spotZ: 240,
        walkLoop: [
          [-658, 240],
          [-660, 236],
          [-655, 244],
        ],
        isolatedWindow: false,
        windowNote: "Witnessed — neighbor Leo Navarro is stretching by the villa gate.",
        colleagueId: "leo_navarro",
        scriptLines: [
          {
            speaker: "colleague",
            speakerName: "Leo Navarro",
            actionNote: "jogs in place in neon running gear outside Kaine's courtyard",
            line: "Morning, Doc! Taking the SUV up to St. Jude's or flying out tonight?", audioUrl: "/public/audio/surveillance/surv_21.mp3",
          },
          {
            speaker: "target",
            speakerName: "Dr. Victor Kaine",
            actionNote: "adjusts silk cuffs and glances at his watch",
            line: "Hospital till noon, Leo, then one last board settlement before my flight. Keep an eye on the place.", audioUrl: "/public/audio/surveillance/surv_22.mp3",
          },
        ],
      },
      {
        id: "kaine_hospital_shift",
        startHour: 8.75,
        endHour: 12.5,
        label: "St. Jude's Medical Courtyard",
        locationName: "St. Jude's Medical Center (Midtown)",
        parkX: -146,
        parkZ: -190,
        parkYaw: 1.57,
        driveWaypoints: [
          [-684, -96],
          [-540, -135],
          [-282, -140],
          [-150, -165],
        ],
        spotX: -144,
        spotZ: -214,
        walkLoop: [
          [-144, -214],
          [-141, -217],
          [-148, -211],
        ],
        isolatedWindow: false,
        windowNote: "High Risk — Bodyguard Mercer & Nurse Elena flank the courtyard.",
        colleagueId: "elena_morales",
        scriptLines: [
          {
            speaker: "colleague",
            speakerName: "Nurse Elena Morales",
            actionNote: "holds a tablet tightly and confronts Kaine by the planters",
            line: "Victor, the toxicology flags on batch nine weren't noise. You can't sign the clearance without a recall!", audioUrl: "/public/audio/surveillance/surv_23.mp3",
          },
          {
            speaker: "target",
            speakerName: "Dr. Victor Kaine",
            actionNote: "speaks coldly while glancing back at Mercer",
            line: "I already signed it, Elena. Archive the raw charts and keep Mercer stationed at the ambulance bay—I'm meeting Julian alone at lunch.", audioUrl: "/public/audio/surveillance/surv_24.mp3",
          },
          {
            speaker: "colleague",
            speakerName: "Mercer",
            actionNote: "crosses arms beside the hospital steps",
            line: "Are you sure you don't want an escort over to Mirror Park, Doc?", audioUrl: "/public/audio/surveillance/surv_25.mp3",
          },
          {
            speaker: "target",
            speakerName: "Dr. Victor Kaine",
            actionNote: "steps toward his parked blue SUV",
            line: "No, Mercer. Julian gets spooked by hired muscle. Stay on the hospital clock.", audioUrl: "/public/audio/surveillance/surv_26.mp3",
          },
        ],
      },
      {
        id: "kaine_park_meetup",
        startHour: 12.5,
        endHour: 14.25,
        label: "Gazebo Payoff with Lobbyist",
        locationName: "Mirror Central Park Gazebo",
        parkX: -176,
        parkZ: 356,
        parkYaw: 0.4,
        driveWaypoints: [
          [-150, -118],
          [-165, 120],
          [-205, 315],
        ],
        spotX: -136,
        spotZ: 382,
        walkLoop: [
          [-136, 382],
          [-132, 385],
          [-138, 378],
        ],
        isolatedWindow: false,
        windowNote: "Wait — Julian Cross is still standing with Kaine. Stay hidden and listen!",
        colleagueId: "julian_cross",
        scriptLines: [
          {
            speaker: "colleague",
            speakerName: "Julian Cross",
            actionNote: "slides an encrypted hard drive across the park railing",
            line: "Two million wired to Cayman once you hand over the original lab backups, Victor.", audioUrl: "/public/audio/surveillance/surv_27.mp3",
          },
          {
            speaker: "target",
            speakerName: "Dr. Victor Kaine",
            actionNote: "pockets the drive inside his coat",
            line: "Half now, half after I verify the wire at sunset. Walk back to the street—I'm taking ten minutes by the pond alone.", audioUrl: "/public/audio/surveillance/surv_28.mp3",
          },
        ],
      },
      {
        id: "kaine_park_pond_alone",
        startHour: 14.25,
        endHour: 16.5,
        label: "Isolated Pond Reflection",
        locationName: "Mirror Park South Pond Edge",
        parkX: -176,
        parkZ: 356,
        parkYaw: 0.4,
        driveWaypoints: [],
        spotX: -112,
        spotZ: 416,
        walkLoop: [
          [-112, 416],
          [-104, 410],
          [-118, 420],
        ],
        isolatedWindow: true,
        windowNote: "STRIKE WINDOW · Kaine walks away from the gazebo to the quiet south pond edge alone!",
        scriptLines: [
          {
            speaker: "phone",
            speakerName: "Dr. Victor Kaine (Phone)",
            actionNote: "stands at the secluded south pond edge checking Cayman banking",
            line: "Yeah, I shook Mercer at the hospital and Julian left. Nobody around the south pond at all—confirm the transfer.", audioUrl: "/public/audio/surveillance/surv_29.mp3",
          },
          {
            speaker: "target",
            speakerName: "Dr. Victor Kaine",
            actionNote: "chuckles quietly while feeding ducks",
            line: "Cleanest payday in Westgate.", audioUrl: "/public/audio/surveillance/surv_30.mp3",
          },
        ],
      },
      {
        id: "kaine_marina_sunset",
        startHour: 16.5,
        endHour: 19.5,
        label: "Pacific Marina Breakwater Call",
        locationName: "Pacific Marina Pier Promenade",
        parkX: -668,
        parkZ: 456,
        parkYaw: -1.57,
        driveWaypoints: [
          [-232, 298],
          [-488, 250],
          [-510, 445],
        ],
        spotX: -692,
        spotZ: 478,
        walkLoop: [
          [-686, 476],
          [-706, 480],
          [-694, 482],
        ],
        isolatedWindow: true,
        windowNote: "STRIKE WINDOW · Alone on Pacific Marina pier—literally steps from your Starter Boat!",
        scriptLines: [
          {
            speaker: "phone",
            speakerName: "Dr. Victor Kaine (Phone)",
            actionNote: "walks out along the wooden Pacific Marina slips",
            line: "Charter boat isn't docking until ten. I'm standing out by the empty yacht slips watching the Pacific.", audioUrl: "/public/audio/surveillance/surv_31.mp3",
          },
          {
            speaker: "target",
            speakerName: "Dr. Victor Kaine",
            actionNote: "gazes toward the open bay",
            line: "Everything's quiet out here. Tell the pilot to spin up at midnight.", audioUrl: "/public/audio/surveillance/surv_32.mp3",
          },
        ],
      },
      {
        id: "kaine_villa_evening",
        startHour: 19.5,
        endHour: 22.5,
        label: "Return to Canal Villa",
        locationName: "12 Venice Canal West (Home)",
        parkX: -678,
        parkZ: 242,
        parkYaw: 0.0,
        driveWaypoints: [
          [-682, 360],
        ],
        spotX: -658,
        spotZ: 240,
        walkLoop: [
          [-658, 240],
          [-654, 244],
        ],
        isolatedWindow: false,
        windowNote: "Neighbor Leo is outside along the canal terrace.",
        colleagueId: "leo_navarro",
        scriptLines: [
          {
            speaker: "colleague",
            speakerName: "Leo Navarro",
            actionNote: "waves from across the footbridge",
            line: "Welcome back, Victor. All packed for your trip?", audioUrl: "/public/audio/surveillance/surv_33.mp3",
          },
          {
            speaker: "target",
            speakerName: "Dr. Victor Kaine",
            actionNote: "nods curtly from his gate",
            line: "Almost, Leo. Just waiting for dark.", audioUrl: "/public/audio/surveillance/surv_34.mp3",
          },
        ],
      },
    ],
  },

  {
    id: "hit_syndicate_architect",
    code: "H3",
    title: "The Syndicate Architect",
    targetName: "Damon Vale",
    targetRoleTitle: "Municipal Infrastructure Fixer",
    targetModelId: "business",
    residence: {
      name: "Vale Canyon Crest Estate",
      address: "204 Vinewood Crest Drive",
      district: "Northern Foothills",
      x: -378,
      z: -835,
    },
    vehicle: {
      modelId: "sedan",
      label: "Obsidian Lux Sedan",
      colorName: "Obsidian Black",
      paintHex: 0x0f172a,
    },
    workplace: {
      name: "Midtown Construction & City Hall",
      district: "Midtown / Downtown",
      x: 134,
      z: -156,
    },
    rewardBase: 5500,
    unseenBonus: 2500,
    deepSeaBonus: 1500,
    briefing:
      "STORY CH 7 · ACT III — Viktor Kroll's Quantum Mainframe exposed Damon Vale, the municipal fixer who engineered Apex Tower's blast locks and is preparing to flip federal state's evidence. Tail his black Lux Sedan from Vinewood Crest to Midtown Construction, City Hall, and the Observatory West Terrace or Del Sol North Cove—take him down cleanly to strip his Apex overrides for Brick, then sink him in deep water.",
    colleagues: [
      {
        id: "rosa_delgado",
        name: "Rosa Delgado",
        roleTitle: "Estate Housekeeper",
        modelId: "civilian",
        x: -380,
        z: -818,
        yaw: 2.2,
        patrolRadius: 1.8,
      },
      {
        id: "marco_silva",
        name: "Foreman Marco Silva",
        roleTitle: "Site Superintendent",
        modelId: "construction",
        x: -308,
        z: -104,
        yaw: -0.9,
        patrolRadius: 2.4,
      },
      {
        id: "evelyn_shaw",
        name: "Evelyn Shaw",
        roleTitle: "Deputy City Clerk",
        modelId: "business",
        x: 136,
        z: -158,
        yaw: -1.6,
        patrolRadius: 1.5,
      },
      {
        id: "briggs_guard",
        name: "Sergeant Briggs",
        roleTitle: "City Hall Security Detail",
        modelId: "security",
        x: 126,
        z: -148,
        yaw: 0.7,
        patrolRadius: 3.5,
      },
    ],
    schedule: [
      {
        id: "vale_estate_morning",
        startHour: 7.0,
        endHour: 8.75,
        label: "Vinewood Estate Briefing",
        locationName: "204 Vinewood Crest Drive (Home)",
        parkX: -404,
        parkZ: -792,
        parkYaw: 0.3,
        driveWaypoints: [],
        spotX: -386,
        spotZ: -812,
        walkLoop: [
          [-386, -812],
          [-382, -815],
          [-390, -808],
        ],
        isolatedWindow: false,
        windowNote: "Witnessed — housekeeper Rosa Delgado is sweeping the motor court.",
        colleagueId: "rosa_delgado",
        scriptLines: [
          {
            speaker: "colleague",
            speakerName: "Rosa Delgado",
            actionNote: "hands Vale his leather folio beside the stone balustrade",
            line: "Your suit is pressed for City Hall, Señor Vale. Will you be back before dark?", audioUrl: "/public/audio/surveillance/surv_35.mp3",
          },
          {
            speaker: "target",
            speakerName: "Damon Vale",
            actionNote: "puts on aviator sunglasses overlooking the city smog",
            line: "Inspection at Midtown first, then Evelyn on the City Hall steps, then up to the Observatory to clear my head. Lock the gate behind me.", audioUrl: "/public/audio/surveillance/surv_36.mp3",
          },
        ],
      },
      {
        id: "vale_midtown_site",
        startHour: 8.75,
        endHour: 12.0,
        label: "Midtown Site Shakedown",
        locationName: "Midtown Tower Construction",
        parkX: -292,
        parkZ: -122,
        parkYaw: 1.57,
        driveWaypoints: [
          [-460, -640],
          [-340, -420],
          [-282, -140],
        ],
        spotX: -304,
        spotZ: -106,
        walkLoop: [
          [-304, -106],
          [-306, -102],
          [-300, -110],
        ],
        isolatedWindow: false,
        windowNote: "Witnessed — Foreman Marco Silva and construction crews nearby.",
        colleagueId: "marco_silva",
        scriptLines: [
          {
            speaker: "target",
            speakerName: "Damon Vale",
            actionNote: "jabbing a finger at Marco's blueprint roll",
            line: "I didn't skim four hundred grand off the steel invoice so your crew could fall two weeks behind schedule, Marco!", audioUrl: "/public/audio/surveillance/surv_37.mp3",
          },
          {
            speaker: "colleague",
            speakerName: "Foreman Marco Silva",
            actionNote: "pulls off his yellow hard hat wiping sweat",
            line: "The concrete inspector's sniffing around, Mr. Vale. If he tests those pillars, both of us go upstate!", audioUrl: "/public/audio/surveillance/surv_38.mp3",
          },
          {
            speaker: "target",
            speakerName: "Damon Vale",
            actionNote: "lowers his voice into a cold whisper",
            line: "Then keep him off the site until I meet the feds tomorrow. I'm heading to City Hall.", audioUrl: "/public/audio/surveillance/surv_39.mp3",
          },
        ],
      },
      {
        id: "vale_city_hall",
        startHour: 12.0,
        endHour: 15.5,
        label: "City Hall Backroom Deal",
        locationName: "City Hall & Courthouse Steps",
        parkX: 114,
        parkZ: -140,
        parkYaw: 1.57,
        driveWaypoints: [
          [-150, -118],
          [36, -82],
          [98, -118],
        ],
        spotX: 132,
        spotZ: -156,
        walkLoop: [
          [132, -156],
          [135, -160],
          [128, -152],
        ],
        isolatedWindow: false,
        windowNote: "High Risk — Sergeant Briggs & Clerk Evelyn Shaw are on the steps.",
        colleagueId: "evelyn_shaw",
        scriptLines: [
          {
            speaker: "colleague",
            speakerName: "Evelyn Shaw",
            actionNote: "slips a sealed envelope inside Vale's coat pocket",
            line: "Here are the immunity drafts the DA's office asked for, Damon. Sergeant Briggs is watching the street.", audioUrl: "/public/audio/surveillance/surv_40.mp3",
          },
          {
            speaker: "target",
            speakerName: "Damon Vale",
            actionNote: "pats the pocket and looks up at the City Hall pillars",
            line: "Smart girl, Evelyn. By morning everyone on the Westgate board takes the fall except us. I'm driving up to the Observatory alone to read these over.", audioUrl: "/public/audio/surveillance/surv_41.mp3",
          },
        ],
      },
      {
        id: "vale_observatory_terrace",
        startHour: 15.5,
        endHour: 18.5,
        label: "Observatory West Terrace Overlook",
        locationName: "Westgate Observatory West Overlook",
        parkX: -120,
        parkZ: -966,
        parkYaw: 3.1,
        driveWaypoints: [
          [70, -420],
          [-120, -660],
          [-310, -750],
          [-40, -835],
          [-255, -915],
        ],
        spotX: -148,
        spotZ: -988,
        walkLoop: [
          [-145, -982],
          [-156, -1002],
          [-138, -996],
        ],
        isolatedWindow: true,
        windowNote: "STRIKE WINDOW · Alone on the Observatory west canyon rail—zero witnesses!",
        scriptLines: [
          {
            speaker: "phone",
            speakerName: "Damon Vale (Phone)",
            actionNote: "leans over the stone parapet overlooking the entire bay",
            line: "I'm up at the Observatory west terrace completely alone. Tell the Marshal I'll sign the proffer at 9 AM.", audioUrl: "/public/audio/surveillance/surv_42.mp3",
          },
          {
            speaker: "target",
            speakerName: "Damon Vale",
            actionNote: "lights a cigar looking down over Downtown",
            line: "Look at them all down there. None of them see it coming.", audioUrl: "/public/audio/surveillance/surv_43.mp3",
          },
        ],
      },
      {
        id: "vale_beach_cove",
        startHour: 18.5,
        endHour: 20.5,
        label: "Del Sol North Beach Cove",
        locationName: "Del Sol North Sand Cove",
        parkX: -706,
        parkZ: -172,
        parkYaw: 3.0,
        driveWaypoints: [
          [-255, -915],
          [-460, -640],
          [-715, -360],
        ],
        spotX: -744,
        spotZ: -190,
        walkLoop: [
          [-740, -184],
          [-752, -206],
          [-738, -200],
        ],
        isolatedWindow: true,
        windowNote: "STRIKE WINDOW · Isolated on the northern sand cove right next to the surf!",
        scriptLines: [
          {
            speaker: "phone",
            speakerName: "Damon Vale (Phone)",
            actionNote: "walks barefoot along the deserted sunset waterline",
            line: "Just catching ocean air north of the pier before heading back up the canyon. Not a soul out here.", audioUrl: "/public/audio/surveillance/surv_44.mp3",
          },
        ],
      },
      {
        id: "vale_estate_evening",
        startHour: 20.5,
        endHour: 22.5,
        label: "Return to Vinewood Estate",
        locationName: "204 Vinewood Crest Drive (Home)",
        parkX: -404,
        parkZ: -792,
        parkYaw: 0.3,
        driveWaypoints: [
          [-715, -360],
          [-460, -640],
        ],
        spotX: -386,
        spotZ: -812,
        walkLoop: [
          [-386, -812],
          [-382, -816],
        ],
        isolatedWindow: false,
        windowNote: "Rosa Delgado is waiting by the estate doorway.",
        colleagueId: "rosa_delgado",
        scriptLines: [
          {
            speaker: "colleague",
            speakerName: "Rosa Delgado",
            actionNote: "opens the foyer door as Vale walks up the drive",
            line: "Dinner is warm inside, Señor Vale. Big day tomorrow?", audioUrl: "/public/audio/surveillance/surv_45.mp3",
          },
          {
            speaker: "target",
            speakerName: "Damon Vale",
            actionNote: "nods grimly",
            line: "The biggest, Rosa. Make sure nobody enters the gate tonight.", audioUrl: "/public/audio/surveillance/surv_46.mp3",
          },
        ],
      },
    ],
  },
];

export interface SurveillanceHudState {
  active: boolean;
  contractId: string;
  code: string;
  title: string;
  targetName: string;
  targetRoleTitle: string;
  stage: "surveil" | "dispose" | "completed";
  dayClock: string;
  phaseLabel: string;
  locationName: string;
  targetTransit: "on_foot" | "driving" | "dead";
  isolatedWindow: boolean;
  windowNote: string;
  witnessCount: number;
  strikeStatus: "ISOLATED" | "CAUTION" | "PUBLIC" | "DEAD";
  unseenStrike: boolean;
  distanceMeters: number;
  targetX: number;
  targetZ: number;
  vehicleLabel: string;
  vehicleX: number;
  vehicleZ: number;
  overheard: ScriptDialogueLine | null;
  rewardBase: number;
  unseenBonus: number;
  deepSeaBonus: number;
  accidentBonus: number;
  taggedTarget: boolean;
  carSabotaged: boolean;
  specialSabotageArmed: boolean;
  accidentKill: boolean;
  nearCctvWarning: boolean;
  nearbySabotagePrompt: string | null;
}

interface CctvCameraNode {
  id: string;
  label: string;
  x: number;
  y: number;
  z: number;
  destroyed: boolean;
  mesh: THREE.Group;
  ledMat: THREE.MeshBasicMaterial;
}

interface SabotageSpotSpec {
  id: string;
  contractId: string;
  label: string;
  x: number;
  z: number;
  killTriggerRadius: number;
  targetSpotX: number;
  targetSpotZ: number;
}

const CONTRACT_CCTV_SPOTS: Array<{ id: string; label: string; x: number; z: number; yaw: number }> = [
  { id: "cctv_customs", label: "Customs Plaza Cam", x: 22, z: -136, yaw: 0.6 },
  { id: "cctv_medical", label: "St. Jude's Courtyard Cam", x: -158, z: -206, yaw: 0.8 },
  { id: "cctv_cityhall", label: "City Hall Steps Cam", x: 122, z: -146, yaw: 0.5 },
  { id: "cctv_seaport", label: "Eastgate Seaport Gate Cam", x: 564, z: 428, yaw: 1.2 },
];

const SIGNATURE_SABOTAGE_SPOTS: SabotageSpotSpec[] = [
  {
    id: "sab_crane_drop",
    contractId: "hit_port_auditor",
    label: "Rig Crane Winch Release (Accident Kill)",
    x: 672,
    z: 478,
    killTriggerRadius: 18,
    targetSpotX: 682,
    targetSpotZ: 486,
  },
  {
    id: "sab_kaine_espresso",
    contractId: "hit_pharma_fixer",
    label: "Spike Kaine's Pondside Thermos (Silent Poison)",
    x: -115,
    z: 408,
    killTriggerRadius: 16,
    targetSpotX: -112,
    targetSpotZ: 416,
  },
  {
    id: "sab_vale_parapet",
    contractId: "hit_syndicate_architect",
    label: "Loosen Observatory Terrace Rail (Accident Fall)",
    x: -146,
    z: -986,
    killTriggerRadius: 15,
    targetSpotX: -148,
    targetSpotZ: -988,
  },
];

interface SpawnedActor {
  id: string;
  name: string;
  modelId: string;
  x: number;
  y: number;
  z: number;
  yaw: number;
  hp: number;
  dead: boolean;
  homeX: number;
  homeZ: number;
  homeYaw: number;
  patrolRadius: number;
  root: THREE.Group;
  model: THREE.Group | null;
  mixer: THREE.AnimationMixer | null;
  actions: { idle: THREE.AnimationAction; walk: THREE.AnimationAction; run: THREE.AnimationAction } | null;
  weights: { idle: number; walk: number; run: number };
  modelRequested: boolean;
  panicked: boolean;
  fleeTimer: number;
}

const upgradedActorMatCache = new Map<string, Map<THREE.Material, THREE.MeshPhysicalMaterial>>();

function buildFallbackCorpseGroup(): THREE.Group {
  const g = new THREE.Group();
  const suitMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.7 });
  const skinMat = new THREE.MeshStandardMaterial({ color: 0xd8a888, roughness: 0.75 });
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.62, 0.24), suitMat);
  torso.position.y = 1.05;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.14, 8, 8), skinMat);
  head.position.y = 1.54;
  const legs = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.74, 0.22), suitMat);
  legs.position.y = 0.37;
  g.add(torso, head, legs);
  return g;
}

function stripRootMotion(clip: THREE.AnimationClip): THREE.AnimationClip {
  const c = clip.clone();
  c.tracks = c.tracks.filter((t) => !/Hips\.position/i.test(t.name));
  return c;
}

function formatDayHour(hour: number): string {
  const h = Math.floor(hour) % 24;
  const m = Math.floor((hour - Math.floor(hour)) * 60);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export class ContractSurveillanceSystem {
  readonly group = new THREE.Group();
  private readonly gltfPromises = new Map<string, Promise<GLTF>>();
  private readonly isBrowser = typeof window !== "undefined" && typeof fetch === "function";

  private activeDef: SurveillanceContractDef | null = null;
  private stage: "surveil" | "dispose" | "completed" = "surveil";
  private dayHour = 7.1;
  private elapsedSec = 0;
  private phaseIdx = 0;
  private driveStepIdx = 0;
  private walkLoopIdx = 0;
  private inVehicle = false;
  private vehicleRouteDone = true;
  private driveQueue: [number, number][] = [];
  private stuckDriveTimer = 0;

  private targetActor: SpawnedActor | null = null;
  private colleagues: SpawnedActor[] = [];
  private targetVehicle: DriveableVehicle | null = null;

  private scriptLineIdx = 0;
  private scriptTimer = 2.0;
  private overheardLine: ScriptDialogueLine | null = null;
  private overheardTimer = 0;

  private witnessCount = 0;
  private unseenStrike = true;
  private accidentKill = false;
  private taggedTarget = false;
  private carSabotaged = false;
  private carSabotageDriveDist = 0;
  private specialSabotageArmed = false;
  private nearCctvWarning = false;
  private cctvNodes: CctvCameraNode[] = [];
  private sabotageRigMesh: THREE.Group | null = null;
  private strikeStatus: "ISOLATED" | "CAUTION" | "PUBLIC" | "DEAD" = "PUBLIC";

  private targetBeacon: THREE.Mesh;
  private disposalRing: THREE.Mesh;

  onContractStarted?: (def: SurveillanceContractDef) => void;
  onTargetEliminated?: (def: SurveillanceContractDef, unseen: boolean, accident?: boolean) => void;
  onContractCompleted?: (info: {
    def: SurveillanceContractDef;
    totalReward: number;
    unseen: boolean;
    deepSea: boolean;
    accident: boolean;
    elapsedSec: number;
  }) => void;
  onOverheardLine?: (line: ScriptDialogueLine) => void;
  onSabotageTriggered?: (title: string, subtitle: string) => void;
  onAccidentExplosion?: (pos: THREE.Vector3) => void;

  constructor(
    private readonly terrainAt: TerrainHeightFn,
    private readonly groundAt: GroundHeightFn,
    private readonly vehicles: WestgateVehicleManager,
    private readonly pedestrians: PedestrianSystem,
    private readonly bodyCarry: BodyCarrySystem,
    private readonly wanted: WantedSystem,
    private readonly voices: NpcVoiceSystem,
  ) {
    this.group.name = "WestgateSurveillanceContracts";

    // Subtle holographic overhead diamond above the active surveillance target
    this.targetBeacon = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.24, 0),
      new THREE.MeshBasicMaterial({ color: 0xf59e0b, wireframe: false, transparent: true, opacity: 0.85 }),
    );
    this.targetBeacon.visible = false;
    this.group.add(this.targetBeacon);

    // Subtle deep-sea drop beacon ring when carrying dead target body on boat
    this.disposalRing = new THREE.Mesh(
      new THREE.RingGeometry(4.2, 5.1, 28),
      new THREE.MeshBasicMaterial({ color: 0x0ea5e9, side: THREE.DoubleSide, transparent: true, opacity: 0.55 }),
    );
    this.disposalRing.rotation.x = -Math.PI * 0.5;
    this.disposalRing.visible = false;
    this.group.add(this.disposalRing);
  }

  get activeContract(): SurveillanceContractDef | null {
    return this.activeDef;
  }

  get currentStage(): "surveil" | "dispose" | "completed" {
    return this.stage;
  }

  get isActive(): boolean {
    return this.activeDef !== null && this.stage !== "completed";
  }

  get targetRoleId(): string | null {
    return this.activeDef ? `contract_target_${this.activeDef.id}` : null;
  }

  startContract(contractId: string, startHour = 7.1): SurveillanceContractDef | null {
    const def = SURVEILLANCE_CONTRACTS.find((c) => c.id === contractId);
    if (!def) return null;
    this.clearActive();

    this.activeDef = def;
    this.stage = "surveil";
    this.dayHour = clamp(startHour, 7.0, 22.0);
    this.elapsedSec = 0;
    this.unseenStrike = true;
    this.accidentKill = false;
    this.taggedTarget = false;
    this.carSabotaged = false;
    this.carSabotageDriveDist = 0;
    this.specialSabotageArmed = false;
    this.nearCctvWarning = false;
    this.scriptLineIdx = 0;
    this.scriptTimer = 1.6;
    this.overheardLine = null;
    this.overheardTimer = 0;

    this.spawnCctvCameras();
    this.spawnSignatureSabotageConsole(def.id);

    this.phaseIdx = this.findPhaseIndexForHour(this.dayHour);
    const phase = def.schedule[this.phaseIdx];

    // Spawn target's personal car at the current phase parking spot
    const carY = this.groundAt(phase.parkX, phase.parkZ, this.terrainAt(phase.parkX, phase.parkZ) + 4);
    this.targetVehicle = this.vehicles.spawnScriptedVehicle(
      `contract_car_${def.id}`,
      def.vehicle.modelId,
      new THREE.Vector3(phase.parkX, carY, phase.parkZ),
      phase.parkYaw,
      def.vehicle.paintHex,
    );

    // Spawn target actor on foot at current phase spot
    this.targetActor = this.createActor(
      `target_${def.id}`,
      def.targetName,
      def.targetModelId,
      phase.spotX,
      phase.spotZ,
      0,
      0,
      110,
    );
    this.inVehicle = false;
    this.vehicleRouteDone = true;
    this.walkLoopIdx = 0;

    // Spawn all named colleagues at their stations
    for (const c of def.colleagues) {
      this.colleagues.push(
        this.createActor(c.id, c.name, c.modelId, c.x, c.z, c.yaw, c.patrolRadius ?? 1.8, 75),
      );
    }

    this.onContractStarted?.(def);
    return def;
  }

  abortContract(): void {
    this.clearActive();
  }

  /** Fast-forward stakeout clock by +1h (or custom delta) so player can jump to next routine phase if desired. */
  advanceDayHour(deltaHours = 1.0): void {
    if (!this.activeDef || this.stage !== "surveil") return;
    this.dayHour += deltaHours;
    if (this.dayHour >= 22.5) this.dayHour = 7.0 + (this.dayHour - 22.5);
    const nextIdx = this.findPhaseIndexForHour(this.dayHour);
    if (nextIdx !== this.phaseIdx) {
      this.beginPhaseTransition(nextIdx);
    }
  }

  clearActive(): void {
    if (this.targetActor) {
      this.group.remove(this.targetActor.root);
      this.targetActor = null;
    }
    for (const c of this.colleagues) {
      this.group.remove(c.root);
    }
    this.colleagues = [];
    if (this.targetVehicle) {
      this.vehicles.removeScriptedVehicle(this.targetVehicle.id);
      this.targetVehicle = null;
    }
    this.activeDef = null;
    this.targetBeacon.visible = false;
    this.disposalRing.visible = false;
    this.overheardLine = null;
    this.overheardTimer = 0;
    for (const cam of this.cctvNodes) {
      this.group.remove(cam.mesh);
    }
    this.cctvNodes = [];
    if (this.sabotageRigMesh) {
      this.group.remove(this.sabotageRigMesh);
      this.sabotageRigMesh = null;
    }
  }

  private spawnCctvCameras(): void {
    for (const cam of this.cctvNodes) this.group.remove(cam.mesh);
    this.cctvNodes = [];
    const poleMat = new THREE.MeshStandardMaterial({ color: 0x334155, roughness: 0.5, metalness: 0.6 });
    const housingMat = new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.35, metalness: 0.25 });
    for (const spec of CONTRACT_CCTV_SPOTS) {
      const y = this.groundAt(spec.x, spec.z, this.terrainAt(spec.x, spec.z) + 4);
      const g = new THREE.Group();
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, 4.1, 8), poleMat);
      pole.position.y = 2.05;
      const head = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.22, 0.44), housingMat);
      head.position.set(0, 4.05, 0.18);
      head.rotation.x = 0.35;
      const ledMat = new THREE.MeshBasicMaterial({ color: 0xef4444 });
      const led = new THREE.Mesh(new THREE.SphereGeometry(0.055, 6, 6), ledMat);
      led.position.set(0, 4.08, 0.41);
      g.add(pole, head, led);
      g.position.set(spec.x, y, spec.z);
      g.rotation.y = spec.yaw;
      this.group.add(g);
      this.cctvNodes.push({
        id: spec.id,
        label: spec.label,
        x: spec.x,
        y: y + 4.05,
        z: spec.z,
        destroyed: false,
        mesh: g,
        ledMat,
      });
    }
  }

  private spawnSignatureSabotageConsole(contractId: string): void {
    if (this.sabotageRigMesh) {
      this.group.remove(this.sabotageRigMesh);
      this.sabotageRigMesh = null;
    }
    const spec = SIGNATURE_SABOTAGE_SPOTS.find((s) => s.contractId === contractId);
    if (!spec) return;
    const y = this.groundAt(spec.x, spec.z, this.terrainAt(spec.x, spec.z) + 4);
    const g = new THREE.Group();
    const box = new THREE.Mesh(
      new THREE.BoxGeometry(0.65, 1.05, 0.45),
      new THREE.MeshStandardMaterial({ color: 0xca8a04, roughness: 0.45, metalness: 0.35 }),
    );
    box.position.y = 0.52;
    const lamp = new THREE.Mesh(
      new THREE.SphereGeometry(0.09, 8, 8),
      new THREE.MeshBasicMaterial({ color: 0xfacc15 }),
    );
    lamp.position.set(0, 1.12, 0);
    g.add(box, lamp);
    g.position.set(spec.x, y, spec.z);
    this.group.add(g);
    this.sabotageRigMesh = g;
  }

  private findPhaseIndexForHour(hour: number): number {
    if (!this.activeDef) return 0;
    const idx = this.activeDef.schedule.findIndex((p) => hour >= p.startHour && hour < p.endHour);
    return idx >= 0 ? idx : 0;
  }

  private createActor(
    id: string,
    name: string,
    modelId: string,
    x: number,
    z: number,
    yaw: number,
    patrolRadius: number,
    hp: number,
  ): SpawnedActor {
    const y = this.groundAt(x, z, this.terrainAt(x, z) + 4);
    const root = new THREE.Group();
    root.position.set(x, y, z);
    root.rotation.y = yaw;
    this.group.add(root);

    const actor: SpawnedActor = {
      id,
      name,
      modelId,
      x,
      y,
      z,
      yaw,
      hp,
      dead: false,
      homeX: x,
      homeZ: z,
      homeYaw: yaw,
      patrolRadius,
      root,
      model: null,
      mixer: null,
      actions: null,
      weights: { idle: 1, walk: 0, run: 0 },
      modelRequested: false,
      panicked: false,
      fleeTimer: 0,
    };
    return actor;
  }

  private ensureActorModel(actor: SpawnedActor): void {
    if (!this.isBrowser || actor.modelRequested) return;
    actor.modelRequested = true;
    const valid = CHARACTERS.some((c) => c.id === actor.modelId) ? actor.modelId : "business";
    const url = characterUrl(valid);
    let prom = this.gltfPromises.get(url);
    if (!prom) {
      prom = loadCachedSoldierGltf(url);
      this.gltfPromises.set(url, prom);
    }

    prom
      .then((gltf) => {
        if (actor.dead) return;
        const cloned = SkeletonUtils.clone(gltf.scene) as THREE.Group;
        cloned.rotation.y = Math.PI;
        let matMap = upgradedActorMatCache.get(url);
        if (!matMap) {
          matMap = new Map();
          upgradedActorMatCache.set(url, matMap);
        }
        cloned.traverse((o) => {
          const m = o as THREE.Mesh;
          if (!m.isMesh) return;
          m.castShadow = true;
          m.receiveShadow = true;
          m.userData.sharedGltfAsset = true;
          const orig = Array.isArray(m.material) ? m.material : [m.material];
          const next = orig.map((mat) => {
            let up = matMap!.get(mat);
            if (!up) {
              up = upgradeCharacterMaterial(mat);
              matMap!.set(mat, up);
            }
            return up;
          });
          m.material = Array.isArray(m.material) ? next : next[0];
        });

        cloned.updateMatrixWorld(true);
        const box = new THREE.Box3().setFromObject(cloned);
        const h = box.max.y - box.min.y;
        if (h > 0.2) cloned.scale.multiplyScalar(1.78 / h);

        const mixer = new THREE.AnimationMixer(cloned);
        const find = (n: string) => {
          const exact = gltf.animations.find((a) => a.name === n);
          if (exact) return stripRootMotion(exact);
          const fuzzy = gltf.animations.find((a) => a.name.toLowerCase().includes(n.toLowerCase()));
          return stripRootMotion(fuzzy ?? gltf.animations[0]);
        };
        const idle = mixer.clipAction(find("Idle"));
        const walk = mixer.clipAction(find("Walk"));
        const run = mixer.clipAction(find("Run"));
        for (const a of [idle, walk, run]) {
          a.setLoop(THREE.LoopRepeat, Infinity);
          a.play();
          a.setEffectiveWeight(0);
        }
        idle.setEffectiveWeight(1);
        mixer.update(0);

        actor.model = cloned;
        actor.mixer = mixer;
        actor.actions = { idle, walk, run };
        actor.root.add(cloned);
      })
      .catch(() => {});
  }

  private setActorMotion(actor: SpawnedActor, clip: "idle" | "walk" | "run", dt: number): void {
    if (!actor.actions) return;
    const rate = Math.min(1, dt * 8);
    actor.weights.idle += ((clip === "idle" ? 1 : 0) - actor.weights.idle) * rate;
    actor.weights.walk += ((clip === "walk" ? 1 : 0) - actor.weights.walk) * rate;
    actor.weights.run += ((clip === "run" ? 1 : 0) - actor.weights.run) * rate;
    actor.actions.idle.setEffectiveWeight(actor.weights.idle);
    actor.actions.walk.setEffectiveWeight(actor.weights.walk);
    actor.actions.run.setEffectiveWeight(actor.weights.run);
  }

  private beginPhaseTransition(nextIdx: number): void {
    if (!this.activeDef || !this.targetActor || this.targetActor.dead) return;
    this.phaseIdx = nextIdx;
    const phase = this.activeDef.schedule[nextIdx];
    this.scriptLineIdx = 0;
    this.scriptTimer = 1.8;
    this.walkLoopIdx = 0;

    // If parking spot changed, drive target's car through waypoints to the new parking spot
    if (this.targetVehicle) {
      const distToPark = Math.hypot(
        this.targetVehicle.pos.x - phase.parkX,
        this.targetVehicle.pos.z - phase.parkZ,
      );
      if (distToPark > 12) {
        this.driveQueue = [...phase.driveWaypoints, [phase.parkX, phase.parkZ]];
        this.driveStepIdx = 0;
        this.vehicleRouteDone = false;
        this.stuckDriveTimer = 0;
        return;
      }
    }
    this.vehicleRouteDone = true;
  }

  private killTarget(hitPt: THREE.Vector3, isSuppressed: boolean, isAccident = false): void {
    if (!this.activeDef || !this.targetActor || this.targetActor.dead) return;
    this.targetActor.dead = true;
    this.targetActor.hp = 0;
    this.targetActor.root.visible = false;
    this.inVehicle = false;
    this.accidentKill = isAccident;

    const detached = this.targetActor.model;
    if (detached) {
      this.targetActor.root.remove(detached);
      this.targetActor.model = null;
    }

    this.bodyCarry.registerDeadBody({
      roleId: `contract_target_${this.activeDef.id}`,
      x: this.targetActor.x,
      y: this.targetActor.y,
      z: this.targetActor.z,
      yaw: this.targetActor.yaw,
      model: detached ?? buildFallbackCorpseGroup(),
    });

    // Determine whether strike was unseen! Active CCTV cameras within 38m expose non-accident hits.
    const cctvCaught =
      !isAccident &&
      this.cctvNodes.some(
        (cam) => !cam.destroyed && Math.hypot(cam.x - this.targetActor!.x, cam.z - this.targetActor!.z) < 38,
      );
    const loudNearbyWitness = !isAccident && !isSuppressed && this.witnessCount > 0;
    const seen = !isAccident && (this.witnessCount > 0 || loudNearbyWitness || cctvCaught);
    this.unseenStrike = !seen;

    if (!this.unseenStrike) {
      this.wanted.reportCrime("assault", hitPt);
      for (const c of this.colleagues) {
        if (!c.dead && Math.hypot(c.x - this.targetActor.x, c.z - this.targetActor.z) < 42) {
          c.panicked = true;
          c.fleeTimer = 25;
        }
      }
      this.pedestrians.alertPanic(hitPt, 45);
    }

    this.stage = "dispose";
    this.strikeStatus = "DEAD";
    this.targetBeacon.visible = false;
    this.onTargetEliminated?.(this.activeDef, this.unseenStrike, isAccident);
  }

  hitAtPoint(
    px: number,
    py: number,
    pz: number,
    damage: number,
    isSuppressed: boolean,
    _shooterPos: THREE.Vector3,
  ): boolean {
    if (!this.activeDef || this.stage !== "surveil" || !this.targetActor) return false;

    // Check shootable CCTV cameras
    for (const cam of this.cctvNodes) {
      if (cam.destroyed) continue;
      if (Math.hypot(px - cam.x, pz - cam.z) < 0.65 && Math.abs(py - cam.y) < 0.75) {
        cam.destroyed = true;
        cam.ledMat.color.setHex(0x1f2937);
        cam.mesh.rotation.x = 0.45;
        this.onSabotageTriggered?.("CCTV DISABLED", `${cam.label} knocked offline`);
        return true;
      }
    }

    // Check target (including while seated inside their moving car)
    if (!this.targetActor.dead) {
      const tx = this.inVehicle && this.targetVehicle ? this.targetVehicle.pos.x : this.targetActor.x;
      const ty = this.inVehicle && this.targetVehicle ? this.targetVehicle.pos.y : this.targetActor.y;
      const tz = this.inVehicle && this.targetVehicle ? this.targetVehicle.pos.z : this.targetActor.z;
      const dx = px - tx;
      const dz = pz - tz;
      const dy = py - (ty + 1.0);
      if (dx * dx + dz * dz < 0.88 * 0.88 && Math.abs(dy) < 1.15) {
        this.targetActor.hp -= damage;
        if (this.inVehicle && this.targetVehicle) {
          this.targetActor.x = tx + Math.cos(this.targetVehicle.yaw) * 1.6;
          this.targetActor.z = tz - Math.sin(this.targetVehicle.yaw) * 1.6;
          this.targetActor.y = this.groundAt(this.targetActor.x, this.targetActor.z, ty + 2);
          this.targetVehicle.speed = 0;
        }
        if (this.targetActor.hp <= 0) {
          this.killTarget(new THREE.Vector3(px, py, pz), isSuppressed);
        } else {
          this.targetActor.panicked = true;
          this.targetActor.fleeTimer = 14;
          if (!isSuppressed) this.wanted.reportCrime("assault", { x: tx, z: tz });
        }
        return true;
      }
    }

    // Check colleagues
    for (const c of this.colleagues) {
      if (c.dead) continue;
      const dx = px - c.x;
      const dz = pz - c.z;
      const dy = py - (c.y + 1.0);
      if (dx * dx + dz * dz < 0.78 * 0.78 && Math.abs(dy) < 1.05) {
        c.hp -= damage;
        if (c.hp <= 0) {
          c.dead = true;
          c.root.visible = false;
          const m = c.model;
          if (m) {
            c.root.remove(m);
            c.model = null;
          }
          this.bodyCarry.registerDeadBody({
            roleId: c.id,
            x: c.x,
            y: c.y,
            z: c.z,
            yaw: c.yaw,
            model: m ?? buildFallbackCorpseGroup(),
          });
          if (!isSuppressed) this.wanted.reportCrime("assault", { x: c.x, z: c.z });
        } else {
          c.panicked = true;
          c.fleeTimer = 18;
          this.wanted.reportCrime("assault", { x: c.x, z: c.z });
        }
        return true;
      }
    }

    return false;
  }

  getNearbySabotagePrompt(playerPos: THREE.Vector3): string | null {
    if (!this.activeDef || this.stage !== "surveil") return null;
    if (
      !this.carSabotaged &&
      this.targetVehicle &&
      !this.inVehicle &&
      !this.targetVehicle.disabled &&
      Math.hypot(playerPos.x - this.targetVehicle.pos.x, playerPos.z - this.targetVehicle.pos.z) < 3.6
    ) {
      return `Sabotage ${this.activeDef.vehicle.label} Brakes/Ignition (Accident Kill)`;
    }
    const spec = SIGNATURE_SABOTAGE_SPOTS.find((s) => s.contractId === this.activeDef!.id);
    if (spec && !this.specialSabotageArmed && Math.hypot(playerPos.x - spec.x, playerPos.z - spec.z) < 3.4) {
      return spec.label;
    }
    return null;
  }

  trySabotage(playerPos: THREE.Vector3): boolean {
    if (!this.activeDef || this.stage !== "surveil") return false;
    // 1. Target vehicle brake/ignition sabotage
    if (
      !this.carSabotaged &&
      this.targetVehicle &&
      !this.inVehicle &&
      !this.targetVehicle.disabled &&
      Math.hypot(playerPos.x - this.targetVehicle.pos.x, playerPos.z - this.targetVehicle.pos.z) < 3.6
    ) {
      this.carSabotaged = true;
      this.carSabotageDriveDist = 0;
      this.onSabotageTriggered?.(
        "VEHICLE SABOTAGED",
        `${this.activeDef.vehicle.label} rigged — will fail when ${this.activeDef.targetName} drives off`,
      );
      return true;
    }
    // 2. Signature location sabotage
    const spec = SIGNATURE_SABOTAGE_SPOTS.find((s) => s.contractId === this.activeDef!.id);
    if (spec && !this.specialSabotageArmed && Math.hypot(playerPos.x - spec.x, playerPos.z - spec.z) < 3.4) {
      this.specialSabotageArmed = true;
      if (
        this.targetActor &&
        !this.targetActor.dead &&
        !this.inVehicle &&
        Math.hypot(this.targetActor.x - spec.targetSpotX, this.targetActor.z - spec.targetSpotZ) < spec.killTriggerRadius
      ) {
        this.killTarget(new THREE.Vector3(this.targetActor.x, this.targetActor.y + 1, this.targetActor.z), true, true);
        this.onSabotageTriggered?.("ACCIDENT STAGED", `${this.activeDef.targetName} eliminated via rigged hazard`);
      } else {
        this.onSabotageTriggered?.("TRAP ARMED", `${spec.label} armed — triggers when target arrives`);
      }
      return true;
    }
    return false;
  }

  /** Called while player aims Tactical Binoculars [B] to tag the target from range. */
  tagTargetFromAim(rayOrigin: THREE.Vector3, rayDir: THREE.Vector3): boolean {
    if (!this.activeDef || this.stage !== "surveil" || !this.targetActor || this.targetActor.dead) return false;
    const tx = this.inVehicle && this.targetVehicle ? this.targetVehicle.pos.x : this.targetActor.x;
    const ty = (this.inVehicle && this.targetVehicle ? this.targetVehicle.pos.y : this.targetActor.y) + 1.1;
    const tz = this.inVehicle && this.targetVehicle ? this.targetVehicle.pos.z : this.targetActor.z;
    const vx = tx - rayOrigin.x;
    const vy = ty - rayOrigin.y;
    const vz = tz - rayOrigin.z;
    const proj = vx * rayDir.x + vy * rayDir.y + vz * rayDir.z;
    if (proj <= 0 || proj > 260) return false;
    const perpSq = vx * vx + vy * vy + vz * vz - proj * proj;
    if (perpSq < 4.5 * 4.5 && !this.taggedTarget) {
      this.taggedTarget = true;
      this.onSabotageTriggered?.("TARGET TAGGED", `${this.activeDef.targetName} locked on Tactical HUD`);
      return true;
    }
    return false;
  }

  tryStealthTakedown(playerPos: THREE.Vector3): boolean {
    if (!this.activeDef || this.stage !== "surveil" || !this.targetActor || this.targetActor.dead || this.inVehicle) {
      return false;
    }
    const dist = Math.hypot(playerPos.x - this.targetActor.x, playerPos.z - this.targetActor.z);
    if (dist > 2.5 || Math.abs(playerPos.y - this.targetActor.y) > 2.0) return false;
    this.killTarget(new THREE.Vector3(this.targetActor.x, this.targetActor.y + 1.0, this.targetActor.z), true);
    return true;
  }

  handleOceanDisposed(body: DeadBodyRecord, deepSea: boolean): boolean {
    if (!this.activeDef || this.stage !== "dispose") return false;
    if (body.roleId !== `contract_target_${this.activeDef.id}`) return false;

    const def = this.activeDef;
    const accidentBonus = this.accidentKill ? 1000 : 0;
    const totalReward =
      def.rewardBase +
      (this.unseenStrike ? def.unseenBonus : 0) +
      (deepSea ? def.deepSeaBonus : Math.round(def.deepSeaBonus * 0.45)) +
      accidentBonus;

    recordSurveillanceContract(def.id, totalReward, this.unseenStrike, deepSea, this.elapsedSec);
    this.stage = "completed";
    this.disposalRing.visible = false;
    this.onContractCompleted?.({
      def,
      totalReward,
      unseen: this.unseenStrike,
      deepSea,
      accident: this.accidentKill,
      elapsedSec: this.elapsedSec,
    });
    this.clearActive();
    return true;
  }

  update(dt: number, playerPos: THREE.Vector3, playerAds: boolean, parabolicActive = false): void {
    if (!this.activeDef || this.stage === "completed") return;
    const cdt = Math.min(Math.max(dt, 0), 0.05);
    this.elapsedSec += cdt;

    if (this.overheardTimer > 0) {
      this.overheardTimer -= cdt;
      if (this.overheardTimer <= 0) this.overheardLine = null;
    }

    // Advance compressed daily routine clock (1 game hour = 18 real seconds -> 4.5 min full day)
    if (this.stage === "surveil") {
      this.dayHour += cdt / 18;
      if (this.dayHour >= 22.5) this.dayHour = 7.0;
      const nextPhaseIdx = this.findPhaseIndexForHour(this.dayHour);
      if (nextPhaseIdx !== this.phaseIdx && this.vehicleRouteDone) {
        this.beginPhaseTransition(nextPhaseIdx);
      }
    }

    const phase = this.activeDef.schedule[this.phaseIdx];

    // Stream & animate colleagues
    for (const c of this.colleagues) {
      if (c.dead) continue;
      const d2 = (c.x - playerPos.x) ** 2 + (c.z - playerPos.z) ** 2;
      if (d2 < 145 * 145) this.ensureActorModel(c);

      if (c.panicked && c.fleeTimer > 0) {
        c.fleeTimer -= cdt;
        const fx = c.x - playerPos.x;
        const fz = c.z - playerPos.z;
        const fl = Math.hypot(fx, fz) || 1;
        c.yaw = Math.atan2(fx / fl, fz / fl);
        c.x += Math.sin(c.yaw) * 4.8 * cdt;
        c.z += Math.cos(c.yaw) * 4.8 * cdt;
        c.y = this.groundAt(c.x, c.z, c.y + 2.5);
        this.setActorMotion(c, "run", cdt);
      } else {
        // Gentle standing / facing target if in same phase
        if (phase.colleagueId === c.id && this.targetActor && !this.targetActor.dead && !this.inVehicle) {
          const toTargetYaw = Math.atan2(this.targetActor.x - c.x, this.targetActor.z - c.z);
          c.yaw = dampAngle(c.yaw, toTargetYaw, 4, cdt);
        } else {
          c.yaw = dampAngle(c.yaw, c.homeYaw, 3, cdt);
        }
        c.y = this.groundAt(c.x, c.z, c.y + 2.5);
        this.setActorMotion(c, "idle", cdt);
      }
      c.root.position.set(c.x, c.y, c.z);
      c.root.rotation.y = c.yaw;
      c.mixer?.update(cdt);
    }

    // Update target AI (driving between stops OR walking/talking at stop)
    if (this.targetActor && !this.targetActor.dead) {
      const t = this.targetActor;
      const d2 = (t.x - playerPos.x) ** 2 + (t.z - playerPos.z) ** 2;
      if (d2 < 165 * 165) this.ensureActorModel(t);

      const carUsable =
        this.targetVehicle &&
        !this.targetVehicle.disabled &&
        this.vehicles.activeVehicle !== this.targetVehicle;

      if (!this.vehicleRouteDone && carUsable && this.targetVehicle) {
        const car = this.targetVehicle;
        if (!this.inVehicle) {
          // Walk to car driver door
          const doorX = car.pos.x - Math.cos(car.yaw) * 1.4;
          const doorZ = car.pos.z + Math.sin(car.yaw) * 1.4;
          const dx = doorX - t.x;
          const dz = doorZ - t.z;
          const dist = Math.hypot(dx, dz);
          if (dist < 1.35) {
            this.inVehicle = true;
            t.root.visible = false;
          } else {
            const wantYaw = Math.atan2(dx, dz);
            t.yaw = dampAngle(t.yaw, wantYaw, 6, cdt);
            t.x += (dx / dist) * 2.1 * cdt;
            t.z += (dz / dist) * 2.1 * cdt;
            t.y = this.groundAt(t.x, t.z, t.y + 3);
            this.setActorMotion(t, "walk", cdt);
          }
        } else {
          // Drive car smoothly through driveQueue
          const wp = this.driveQueue[this.driveStepIdx] ?? [phase.parkX, phase.parkZ];
          const dx = wp[0] - car.pos.x;
          const dz = wp[1] - car.pos.z;
          const dist = Math.hypot(dx, dz);
          const isFinal = this.driveStepIdx >= this.driveQueue.length - 1;

          if (dist < (isFinal ? 2.4 : 8.5)) {
            if (isFinal) {
              car.pos.x = phase.parkX;
              car.pos.z = phase.parkZ;
              car.yaw = phase.parkYaw;
              car.speed = 0;
              this.vehicles.syncScriptedVehicle(car, cdt, 0);
              this.inVehicle = false;
              this.vehicleRouteDone = true;
              t.x = car.pos.x - Math.cos(car.yaw) * 1.65;
              t.z = car.pos.z + Math.sin(car.yaw) * 1.65;
              t.y = this.groundAt(t.x, t.z, car.pos.y + 2);
              t.root.visible = true;
            } else {
              this.driveStepIdx++;
            }
          } else {
            const wantYaw = Math.atan2(dx, dz);
            const yawErr = wrapAngle(wantYaw - car.yaw);
            car.yaw = wrapAngle(car.yaw + clamp(yawErr * 2.8, -2.1, 2.1) * cdt);
            const targetSpd = isFinal && dist < 18 ? clamp(dist * 0.7, 3.5, 11) : Math.abs(yawErr) > 0.75 ? 7.5 : 14.5;
            car.speed += (targetSpd - car.speed) * Math.min(1, cdt * 3.5);
            const stepD = car.speed * cdt;
            car.pos.x += Math.sin(car.yaw) * stepD;
            car.pos.z += Math.cos(car.yaw) * stepD;
            this.vehicles.syncScriptedVehicle(car, cdt, clamp(yawErr * 0.8, -0.5, 0.5));
            t.x = car.pos.x;
            t.y = car.pos.y;
            t.z = car.pos.z;

            if (this.carSabotaged) {
              this.carSabotageDriveDist += Math.abs(stepD);
              if (this.carSabotageDriveDist > 16) {
                car.disabled = true;
                car.speed = 0;
                this.inVehicle = false;
                this.vehicleRouteDone = true;
                t.x = car.pos.x - Math.cos(car.yaw) * 1.65;
                t.z = car.pos.z + Math.sin(car.yaw) * 1.65;
                t.y = this.groundAt(t.x, t.z, car.pos.y + 2);
                this.onAccidentExplosion?.(car.pos.clone());
                this.killTarget(car.pos.clone(), true, true);
              }
            }

            this.stuckDriveTimer += cdt;
            if (this.stuckDriveTimer > 55) {
              // Failsafe warp to park spot if jammed
              car.pos.set(phase.parkX, this.groundAt(phase.parkX, phase.parkZ, 20), phase.parkZ);
              car.yaw = phase.parkYaw;
              car.speed = 0;
              this.vehicles.syncScriptedVehicle(car, cdt, 0);
              this.inVehicle = false;
              this.vehicleRouteDone = true;
              t.x = car.pos.x - Math.cos(car.yaw) * 1.65;
              t.z = car.pos.z + Math.sin(car.yaw) * 1.65;
              t.y = this.groundAt(t.x, t.z, car.pos.y + 2);
              t.root.visible = true;
            }
          }
        }
      } else {
        // Walking / performing routine at current stop
        this.inVehicle = false;
        t.root.visible = true;
        if (this.targetVehicle) this.vehicles.syncScriptedVehicle(this.targetVehicle, cdt, 0);

        const loopPts = phase.walkLoop.length > 0 ? phase.walkLoop : [[phase.spotX, phase.spotZ]];
        const goal = loopPts[this.walkLoopIdx % loopPts.length];
        const dx = goal[0] - t.x;
        const dz = goal[1] - t.z;
        const dist = Math.hypot(dx, dz);
        if (dist < 1.2) {
          this.walkLoopIdx = (this.walkLoopIdx + 1) % loopPts.length;
          this.setActorMotion(t, "idle", cdt);
        } else {
          const wantYaw = Math.atan2(dx, dz);
          t.yaw = dampAngle(t.yaw, wantYaw, 5, cdt);
          const spd = dist > 20 ? 2.8 : 1.45;
          t.x += (dx / dist) * spd * cdt;
          t.z += (dz / dist) * spd * cdt;
          t.y = this.groundAt(t.x, t.z, t.y + 3.0);
          this.setActorMotion(t, "walk", cdt);
        }

        // Scripted overheard dialogue when at stop
        this.scriptTimer -= cdt;
        if (this.scriptTimer <= 0 && phase.scriptLines.length > 0) {
          const line = phase.scriptLines[this.scriptLineIdx % phase.scriptLines.length];
          this.scriptLineIdx++;
          this.scriptTimer = 7.2;

          const distToTarget = Math.hypot(t.x - playerPos.x, t.z - playerPos.z);
          const hearDist = parabolicActive ? 225 : playerAds ? 135 : 70;
          if (distToTarget <= hearDist) {
            this.overheardLine = line;
            this.overheardTimer = 6.2;
            this.onOverheardLine?.(line);
            const vol = parabolicActive ? 0.78 : Math.max(0.28, Math.min(0.75, 1 - distToTarget / hearDist));
            if (line.audioUrl && this.voices.speakVoiceAudio) {
              this.voices.speakVoiceAudio(line.speakerName, line.line, line.audioUrl, vol, line.speaker === "phone");
            } else {
              const roleKey = line.speaker === "target" ? "business" : "civilian";
              this.voices.speakCustom?.(roleKey, line.speakerName, line.line);
            }
          }
        }

        // Trigger armed signature workplace sabotage when target reaches trap radius
        if (this.specialSabotageArmed) {
          const spec = SIGNATURE_SABOTAGE_SPOTS.find((s) => s.contractId === this.activeDef!.id);
          if (spec && Math.hypot(t.x - spec.targetSpotX, t.z - spec.targetSpotZ) < spec.killTriggerRadius) {
            this.killTarget(new THREE.Vector3(t.x, t.y + 1, t.z), true, true);
            this.onSabotageTriggered?.("ACCIDENT STAGED", `${this.activeDef!.targetName} eliminated via rigged hazard`);
          }
        }
      }

      t.root.position.set(t.x, t.y, t.z);
      t.root.rotation.y = t.yaw;
      t.mixer?.update(cdt);

      // Count nearby witnesses & active CCTV cameras around target
      let witnesses = 0;
      for (const c of this.colleagues) {
        if (c.dead) continue;
        if (Math.hypot(c.x - t.x, c.z - t.z) < 28) witnesses++;
      }
      for (const p of this.pedestrians.agents) {
        if (p.dead || p.state === "flee") continue;
        if (Math.hypot(p.x - t.x, p.z - t.z) < 24) witnesses++;
      }
      this.nearCctvWarning = this.cctvNodes.some(
        (cam) => !cam.destroyed && Math.hypot(cam.x - t.x, cam.z - t.z) < 38,
      );
      this.witnessCount = witnesses;
      if (this.inVehicle) {
        this.strikeStatus = witnesses === 0 ? "CAUTION" : "PUBLIC";
      } else if (witnesses === 0) {
        this.strikeStatus = "ISOLATED";
      } else if (witnesses === 1) {
        this.strikeStatus = "CAUTION";
      } else {
        this.strikeStatus = "PUBLIC";
      }

      // Update floating marker above target
      this.targetBeacon.visible = true;
      this.targetBeacon.position.set(t.x, t.y + (this.inVehicle ? 2.65 : 2.35) + Math.sin(this.elapsedSec * 3.5) * 0.1, t.z);
      this.targetBeacon.rotation.y += cdt * 1.8;
      (this.targetBeacon.material as THREE.MeshBasicMaterial).color.setHex(
        this.strikeStatus === "ISOLATED" ? 0x22c55e : this.strikeStatus === "CAUTION" ? 0xf59e0b : 0xef4444,
      );
    } else if (this.stage === "dispose") {
      // Guide player offshore to deep sea when disposing
      this.disposalRing.visible = true;
      this.disposalRing.position.set(-860, 0.18, 280);
      this.disposalRing.rotation.z += cdt * 0.4;
    }
  }

  getHudState(playerPos: THREE.Vector3): SurveillanceHudState | null {
    if (!this.activeDef || this.stage === "completed") return null;
    const phase = this.activeDef.schedule[this.phaseIdx];
    const tx = this.targetActor ? (this.inVehicle && this.targetVehicle ? this.targetVehicle.pos.x : this.targetActor.x) : phase.spotX;
    const tz = this.targetActor ? (this.inVehicle && this.targetVehicle ? this.targetVehicle.pos.z : this.targetActor.z) : phase.spotZ;

    return {
      active: true,
      contractId: this.activeDef.id,
      code: this.activeDef.code,
      title: this.activeDef.title,
      targetName: this.activeDef.targetName,
      targetRoleTitle: this.activeDef.targetRoleTitle,
      stage: this.stage,
      dayClock: formatDayHour(this.dayHour),
      phaseLabel: phase.label,
      locationName: phase.locationName,
      targetTransit:
        this.stage === "dispose" ? "dead" : this.inVehicle ? "driving" : "on_foot",
      isolatedWindow: phase.isolatedWindow && this.witnessCount === 0 && !this.inVehicle,
      windowNote:
        this.stage === "dispose"
          ? "Pick up body [G], load in car trunk or carry to your Starter Boat [F], sail offshore & dump at sea [G]!"
          : this.inVehicle
            ? `In transit (${this.activeDef.vehicle.label}) -> ${phase.locationName}`
            : phase.windowNote,
      witnessCount: this.witnessCount,
      strikeStatus: this.stage === "dispose" ? "DEAD" : this.strikeStatus,
      unseenStrike: this.unseenStrike,
      distanceMeters: Math.round(Math.hypot(tx - playerPos.x, tz - playerPos.z)),
      targetX: tx,
      targetZ: tz,
      vehicleLabel: this.activeDef.vehicle.label,
      vehicleX: this.targetVehicle?.pos.x ?? phase.parkX,
      vehicleZ: this.targetVehicle?.pos.z ?? phase.parkZ,
      overheard: this.overheardLine,
      rewardBase: this.activeDef.rewardBase,
      unseenBonus: this.activeDef.unseenBonus,
      deepSeaBonus: this.activeDef.deepSeaBonus,
      accidentBonus: 1000,
      taggedTarget: this.taggedTarget,
      carSabotaged: this.carSabotaged,
      specialSabotageArmed: this.specialSabotageArmed,
      accidentKill: this.accidentKill,
      nearCctvWarning: this.nearCctvWarning,
      nearbySabotagePrompt: this.getNearbySabotagePrompt(playerPos),
    };
  }
}
