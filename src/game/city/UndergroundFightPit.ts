import * as THREE from "three";
import { SoldierRig } from "../../character/SoldierRig";
import { buildFighterUrl, type FighterBuildOptions } from "../../character/ShirtlessFighter";
import { Enemy, type CombatHost } from "../Enemy";
import { characterUrl } from "../characters";
import { OPEN_WORLD_MISSION, type MissionDef } from "../story";
import type { BodyStatId } from "../bodyStats";
import {
  loadSave,
  recordFightPitBetResult,
  recordFightPitWin,
  resetFightPitStreak,
  spendPitCredits,
} from "../progression";
import type { TerrainHeightFn } from "./HeightSystem";
import { fitGlbToDimension, loadCityGlb } from "./PropModels";

export interface FightPitTierDef {
  id: string;
  tier: number;
  name: string;
  alias: string;
  style: string;
  record: string;
  purse: number;
  hp: number;
  damageScale: number;
  aggroScale: number;
  fighter: FighterBuildOptions;
  xpRewards: Partial<Record<BodyStatId, number>>;
}

export interface PitRosterFighter {
  id: string;
  name: string;
  alias: string;
  style: string;
  record: string;
  hp: number;
  power: number; // 1..10
  speed: number; // 1..10
  toughness: number; // 1..10
  accentColor: string;
  fighter: FighterBuildOptions;
}

export interface PitFightCardMatch {
  id: string;
  label: string;
  red: PitRosterFighter;
  blue: PitRosterFighter;
  redOdds: number; // e.g. 1.65
  blueOdds: number; // e.g. 2.35
  koPropBonus: number; // extra multiplier if KO happens < 25s
}

export interface ActivePitBet {
  kind: "spectator" | "self";
  pickCorner: "red" | "blue";
  pickName: string;
  wager: number;
  odds: number;
  quickKoProp: boolean;
  koCutoffSec: number;
  potentialPayout: number;
}

export interface PitHudBookieInfo {
  credits: number;
  pitRank: number;
  pitWins: number;
  pitWinStreak: number;
  pitBetWins: number;
  pitBetProfit: number;
  streakBonusPct: number;
  nextTierIndex: number;
  tiers: FightPitTierDef[];
  fightCard: PitFightCardMatch[];
  lastSettlement: {
    won: boolean;
    title: string;
    detail: string;
    payout: number;
  } | null;
}

export const FIGHT_PIT_CENTER = {
  x: 722,
  z: 115,
  radius: 7.4,
  gateX: 714.6,
  gateZ: 115,
  promoterX: 710.6,
  promoterZ: 118.4,
  exitX: 711.2,
  exitZ: 115,
} as const;

export const FIGHT_PIT_TIERS: FightPitTierDef[] = [
  {
    id: "pit_1",
    tier: 1,
    name: "Rico Vance",
    alias: '"Scrapyard" Rico',
    style: "Dockyard Brawler",
    record: "6-3 (4 KO)",
    purse: 600,
    hp: 135,
    damageScale: 0.9,
    aggroScale: 0.78,
    fighter: {
      outfit: "shorts",
      boots: false,
      hair: "short02",
      skinHex: "#c98c68",
      hairHex: "#1e1612",
      shortsHex: "#991b1b",
      muscle: 0.65,
      weight: -0.06,
      height: 0.08,
    },
    xpRewards: { strength: 22, toughness: 16, stamina: 14, agility: 12 },
  },
  {
    id: "pit_2",
    tier: 2,
    name: "Tomasz Nowak",
    alias: '"Docker" Tomasz',
    style: "Heavy Slugger",
    record: "9-2 (7 KO)",
    purse: 1100,
    hp: 180,
    damageScale: 1.08,
    aggroScale: 0.88,
    fighter: {
      outfit: "shorts",
      boots: false,
      hair: "none",
      skinHex: "#dfb49a",
      hairHex: "#3a2d22",
      shortsHex: "#1e3a8a",
      muscle: 0.8,
      weight: 0.14,
      height: 0.15,
    },
    xpRewards: { strength: 30, toughness: 24, stamina: 20, agility: 16, speed: 12 },
  },
  {
    id: "pit_3",
    tier: 3,
    name: "Malik Thorne",
    alias: '"Viper" Malik',
    style: "Counter-Striker",
    record: "13-2 (8 KO)",
    purse: 1800,
    hp: 225,
    damageScale: 1.22,
    aggroScale: 0.98,
    fighter: {
      outfit: "shorts",
      boots: true,
      hair: "short04",
      skinHex: "#6f442c",
      hairHex: "#121010",
      shortsHex: "#d97706",
      muscle: 0.76,
      weight: -0.08,
      height: 0.24,
    },
    xpRewards: { strength: 38, toughness: 30, stamina: 28, agility: 26, speed: 18 },
  },
  {
    id: "pit_4",
    tier: 4,
    name: "Boris Volkov",
    alias: '"Anvil" Boris',
    style: "Iron Bruiser",
    record: "17-1 (14 KO)",
    purse: 2750,
    hp: 285,
    damageScale: 1.38,
    aggroScale: 0.95,
    fighter: {
      outfit: "jeans",
      boots: true,
      hair: "short02",
      skinHex: "#d6ab92",
      hairHex: "#2d231c",
      shortsHex: "#1f2937",
      muscle: 0.96,
      weight: 0.34,
      height: 0.28,
    },
    xpRewards: { strength: 48, toughness: 42, stamina: 34, agility: 28, speed: 20 },
  },
  {
    id: "pit_5",
    tier: 5,
    name: "Mateo Cruz",
    alias: '"El Diablo" Cruz',
    style: "Undisputed Pit King",
    record: "24-0 (19 KO)",
    purse: 4500,
    hp: 350,
    damageScale: 1.55,
    aggroScale: 1.08,
    fighter: {
      outfit: "shorts",
      boots: true,
      hair: "short04",
      skinHex: "#b67954",
      hairHex: "#100e0e",
      shortsHex: "#b91c1c",
      muscle: 1.0,
      weight: 0.14,
      height: 0.22,
    },
    xpRewards: { strength: 65, toughness: 55, stamina: 45, agility: 40, speed: 28 },
  },
];

export const PIT_ROSTER: PitRosterFighter[] = [
  {
    id: "rico",
    name: "Rico Vance",
    alias: '"Scrapyard" Rico',
    style: "Pressure Boxer",
    record: "6-3 (4 KO)",
    hp: 150,
    power: 6,
    speed: 7,
    toughness: 6,
    accentColor: "#ef4444",
    fighter: FIGHT_PIT_TIERS[0].fighter,
  },
  {
    id: "tomasz",
    name: "Tomasz Nowak",
    alias: '"Docker" Tomasz',
    style: "Heavy Slugger",
    record: "9-2 (7 KO)",
    hp: 175,
    power: 8,
    speed: 5,
    toughness: 8,
    accentColor: "#3b82f6",
    fighter: FIGHT_PIT_TIERS[1].fighter,
  },
  {
    id: "malik",
    name: "Malik Thorne",
    alias: '"Viper" Malik',
    style: "Counter-Striker",
    record: "13-2 (8 KO)",
    hp: 165,
    power: 7,
    speed: 9,
    toughness: 6,
    accentColor: "#f59e0b",
    fighter: FIGHT_PIT_TIERS[2].fighter,
  },
  {
    id: "boris",
    name: "Boris Volkov",
    alias: '"Anvil" Boris',
    style: "Iron Bruiser",
    record: "17-1 (14 KO)",
    hp: 205,
    power: 9,
    speed: 5,
    toughness: 9,
    accentColor: "#64748b",
    fighter: FIGHT_PIT_TIERS[3].fighter,
  },
  {
    id: "cruz",
    name: "Mateo Cruz",
    alias: '"El Diablo" Cruz',
    style: "Pit Champion",
    record: "24-0 (19 KO)",
    hp: 215,
    power: 9,
    speed: 8,
    toughness: 9,
    accentColor: "#dc2626",
    fighter: FIGHT_PIT_TIERS[4].fighter,
  },
  {
    id: "dante",
    name: "Dante Reyes",
    alias: '"Razor" Dante',
    style: "Street Kickboxer",
    record: "11-4 (6 KO)",
    hp: 155,
    power: 7,
    speed: 8,
    toughness: 6,
    accentColor: "#ec4899",
    fighter: {
      outfit: "shorts",
      boots: false,
      hair: "short04",
      skinHex: "#a86c49",
      hairHex: "#171210",
      shortsHex: "#9d174d",
      muscle: 0.72,
      weight: -0.1,
      height: 0.14,
    },
  },
  {
    id: "ivan",
    name: "Ivan Koval",
    alias: '"Sledge" Ivan',
    style: "Body-Shot Grinder",
    record: "10-5 (7 KO)",
    hp: 185,
    power: 8,
    speed: 6,
    toughness: 8,
    accentColor: "#14b8a6",
    fighter: {
      outfit: "jeans",
      boots: true,
      hair: "short02",
      skinHex: "#d7b199",
      hairHex: "#33261d",
      shortsHex: "#0f766e",
      muscle: 0.88,
      weight: 0.22,
      height: 0.2,
    },
  },
  {
    id: "kane",
    name: "Marcus Kane",
    alias: '"Ghost" Kane',
    style: "Slip & Rip",
    record: "14-3 (9 KO)",
    hp: 162,
    power: 7,
    speed: 9,
    toughness: 7,
    accentColor: "#8b5cf6",
    fighter: {
      outfit: "shorts",
      boots: true,
      hair: "none",
      skinHex: "#5d3924",
      hairHex: "#100e0e",
      shortsHex: "#5b21b6",
      muscle: 0.78,
      weight: -0.04,
      height: 0.18,
    },
  },
];

export interface FightPitHudState {
  active: boolean;
  mode: "player" | "spectator";
  phase: "idle" | "countdown" | "fighting" | "victory" | "defeat";
  tierIndex: number;
  tierTotal: number;
  redName: string;
  redHp: number;
  redMaxHp: number;
  opponentName: string;
  opponentHp: number;
  opponentMaxHp: number;
  purse: number;
  countdownSec: number;
  boutElapsedSec: number;
  bannerText: string;
  activeBet: ActivePitBet | null;
  pitRank: number;
  pitWins: number;
  pitWinStreak: number;
}

interface SpectatorActor {
  def: PitRosterFighter;
  corner: "red" | "blue";
  rig: SoldierRig;
  hp: number;
  maxHp: number;
  attackCooldown: number;
  blockTimer: number;
  dodgeCooldown: number;
  hitProcessed: boolean;
  strafeSign: number;
  strafeTimer: number;
}

const PIT_MISSION_STUB: MissionDef = {
  ...OPEN_WORLD_MISSION,
  id: 99,
  codename: "IRON PIT",
  name: "Eastgate Underground Pit",
  location: "East Industrial Dockyard",
  briefing: ["Bare-knuckle underground pit bout. No guns, no rules, winner takes the purse."],
  accent: "#f59e0b",
  night: true,
  tint: [0x1c1917, 0x7f1d1d],
  enemyHp: 150,
  enemyDamage: [10, 16],
  enemyAccuracy: 0.65,
};

function makePitMatTexture(): THREE.CanvasTexture | null {
  if (typeof document === "undefined") return null;
  const c = document.createElement("canvas");
  c.width = 512;
  c.height = 512;
  const g = c.getContext("2d")!;
  g.fillStyle = "#191716";
  g.fillRect(0, 0, 512, 512);
  // Subtle canvas scuff & sweat rings
  g.fillStyle = "rgba(255,255,255,0.025)";
  for (let i = 0; i < 160; i++) {
    g.fillRect((i * 73) % 512, (i * 137) % 512, 18, 2);
  }
  g.strokeStyle = "#991b1b";
  g.lineWidth = 18;
  g.beginPath();
  g.arc(256, 256, 224, 0, Math.PI * 2);
  g.stroke();
  g.strokeStyle = "#f59e0b";
  g.lineWidth = 5;
  g.beginPath();
  g.arc(256, 256, 98, 0, Math.PI * 2);
  g.stroke();
  g.fillStyle = "rgba(185, 28, 28, 0.20)";
  g.beginPath();
  g.arc(256, 256, 94, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = "#e7e5e4";
  g.font = "900 40px system-ui, sans-serif";
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText("IRON PIT", 256, 244);
  g.fillStyle = "#f59e0b";
  g.font = "700 17px system-ui, sans-serif";
  g.fillText("WESTGATE UNDERGROUND", 256, 280);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function makeChainLinkTexture(): THREE.CanvasTexture | null {
  if (typeof document === "undefined") return null;
  const c = document.createElement("canvas");
  c.width = 128;
  c.height = 128;
  const g = c.getContext("2d")!;
  g.clearRect(0, 0, 128, 128);
  g.strokeStyle = "#94a3b8";
  g.lineWidth = 4;
  for (let i = -128; i <= 256; i += 24) {
    g.beginPath();
    g.moveTo(i, 0);
    g.lineTo(i + 128, 128);
    g.stroke();
    g.beginPath();
    g.moveTo(i + 128, 0);
    g.lineTo(i, 128);
    g.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(5.5, 2.2);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function makePitSignTexture(): THREE.CanvasTexture | null {
  if (typeof document === "undefined") return null;
  const c = document.createElement("canvas");
  c.width = 512;
  c.height = 128;
  const g = c.getContext("2d")!;
  g.fillStyle = "#0f172a";
  g.fillRect(0, 0, 512, 128);
  g.strokeStyle = "#f59e0b";
  g.lineWidth = 6;
  g.strokeRect(6, 6, 500, 116);
  g.fillStyle = "#ef4444";
  g.font = "900 44px system-ui, sans-serif";
  g.textAlign = "center";
  g.fillText("IRON PIT · BARE-KNUCKLE", 256, 58);
  g.fillStyle = "#fde68a";
  g.font = "700 21px system-ui, sans-serif";
  g.fillText("CASH PURSES · LIVE ODDS · NO FIREARMS", 256, 98);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function makeBookieBannerTexture(): THREE.CanvasTexture | null {
  if (typeof document === "undefined") return null;
  const c = document.createElement("canvas");
  c.width = 512;
  c.height = 128;
  const g = c.getContext("2d")!;
  g.fillStyle = "#111827";
  g.fillRect(0, 0, 512, 128);
  g.strokeStyle = "#22c55e";
  g.lineWidth = 5;
  g.strokeRect(6, 6, 500, 116);
  g.fillStyle = "#22c55e";
  g.font = "900 36px system-ui, sans-serif";
  g.textAlign = "center";
  g.fillText("VIKTOR'S BOOK", 256, 54);
  g.fillStyle = "#f59e0b";
  g.font = "700 22px system-ui, sans-serif";
  g.fillText("[G] FIGHT CARD & LIVE BETTING", 256, 96);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function drawOddsBoardCanvas(
  canvas: HTMLCanvasElement,
  card: PitFightCardMatch[],
  streak: number,
) {
  const g = canvas.getContext("2d");
  if (!g) return;
  g.fillStyle = "#0b1116";
  g.fillRect(0, 0, canvas.width, canvas.height);
  g.strokeStyle = "#f59e0b";
  g.lineWidth = 6;
  g.strokeRect(8, 8, canvas.width - 16, canvas.height - 16);

  g.fillStyle = "#f59e0b";
  g.font = "900 28px system-ui, sans-serif";
  g.textAlign = "center";
  g.fillText("TONIGHT'S UNDERGROUND CARD", canvas.width / 2, 46);

  g.fillStyle = "#94a3b8";
  g.font = "700 15px monospace";
  g.fillText(`WIN STREAK: ${streak}  ·  PRESS [G] TO WAGER`, canvas.width / 2, 74);

  let y = 114;
  for (let i = 0; i < Math.min(3, card.length); i++) {
    const m = card[i];
    g.fillStyle = "rgba(30, 41, 59, 0.72)";
    g.fillRect(22, y - 22, canvas.width - 44, 58);
    g.textAlign = "left";
    g.fillStyle = "#fca5a5";
    g.font = "800 18px system-ui, sans-serif";
    g.fillText(`${m.red.alias}`, 34, y + 2);
    g.fillStyle = "#93c5fd";
    g.fillText(`vs ${m.blue.alias}`, 34, y + 24);

    g.textAlign = "right";
    g.fillStyle = "#22c55e";
    g.font = "900 19px monospace";
    g.fillText(`${m.redOdds.toFixed(2)}x  /  ${m.blueOdds.toFixed(2)}x`, canvas.width - 34, y + 13);
    y += 72;
  }
}

function computeMatchupOdds(red: PitRosterFighter, blue: PitRosterFighter): {
  redOdds: number;
  blueOdds: number;
  koPropBonus: number;
} {
  const score = (f: PitRosterFighter) =>
    f.hp * 0.42 + f.power * 11.5 + f.speed * 9.5 + f.toughness * 8.5;
  const sr = score(red);
  const sb = score(blue);
  const diff = (sr - sb) / 36;
  const pRed = Math.max(0.24, Math.min(0.76, 1 / (1 + Math.exp(-diff))));
  const pBlue = 1 - pRed;
  const vig = 0.94;
  const clampOdds = (v: number) => Math.round(Math.max(1.28, Math.min(3.85, v)) * 100) / 100;
  const avgPow = (red.power + blue.power) * 0.5;
  const koPropBonus = Math.round(Math.max(0.55, 1.15 - avgPow * 0.04) * 100) / 100;
  return {
    redOdds: clampOdds(vig / pRed),
    blueOdds: clampOdds(vig / pBlue),
    koPropBonus,
  };
}

export class UndergroundFightPit {
  readonly group = new THREE.Group();
  readonly colliders: THREE.Object3D[] = [];
  readonly groundY: number;

  private gateBar!: THREE.Mesh;
  private promptRing!: THREE.Mesh;
  private heavyBagPivot: THREE.Group | null = null;
  private emberLights: THREE.PointLight[] = [];
  private oddsCanvas: HTMLCanvasElement | null = null;
  private oddsTexture: THREE.CanvasTexture | null = null;

  private promoterRig: SoldierRig | null = null;
  private spectators: { rig: SoldierRig; baseYaw: number; phase: number }[] = [];

  private mode: "player" | "spectator" = "player";
  private phase: FightPitHudState["phase"] = "idle";
  private activeTierIdx = 0;
  private opponent: Enemy | null = null;
  private specRed: SpectatorActor | null = null;
  private specBlue: SpectatorActor | null = null;
  private activeBet: ActivePitBet | null = null;
  private lastSettlement: PitHudBookieInfo["lastSettlement"] = null;

  private spawnPending = false;
  private countdownTimer = 0;
  private boutElapsed = 0;
  private finishTimer = 0;
  private cheerPulse = 0;
  private bannerText = "";
  private pitRank = 0;
  private pitWins = 0;
  private pitWinStreak = 0;
  private pitBetWins = 0;
  private pitBetProfit = 0;
  private prevOpponentHp = 0;
  private actorsLoaded = false;
  private propsLoaded = false;
  private fightCard: PitFightCardMatch[] = [];
  private cardNonce = 1;

  constructor(terrainAt: TerrainHeightFn, initialRank = 0, initialWins = 0) {
    this.pitRank = initialRank;
    this.pitWins = initialWins;
    const save = loadSave();
    this.pitWinStreak = save.pitWinStreak ?? 0;
    this.pitBetWins = save.pitBetWins ?? 0;
    this.pitBetProfit = save.pitBetProfit ?? 0;
    this.groundY = terrainAt(FIGHT_PIT_CENTER.x, FIGHT_PIT_CENTER.z);
    this.generateFightCard();
    this.buildArenaGeometry();
  }

  private generateFightCard() {
    const pool = [...PIT_ROSTER];
    // Deterministic-yet-fresh shuffle based on cardNonce
    for (let i = pool.length - 1; i > 0; i--) {
      const seed = Math.sin((this.cardNonce * 97 + i * 31) * 12.9898) * 43758.5453;
      const j = Math.floor((seed - Math.floor(seed)) * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    this.cardNonce++;

    const labels = ["PRELIM BOUT", "CO-MAIN EVENT", "MAIN EVENT"];
    const card: PitFightCardMatch[] = [];
    for (let i = 0; i < 3; i++) {
      const red = pool[(i * 2) % pool.length];
      const blue = pool[(i * 2 + 1) % pool.length];
      const { redOdds, blueOdds, koPropBonus } = computeMatchupOdds(red, blue);
      card.push({
        id: `card_${this.cardNonce}_${i}`,
        label: labels[i],
        red,
        blue,
        redOdds,
        blueOdds,
        koPropBonus,
      });
    }
    this.fightCard = card;
    this.redrawOddsBoard();
  }

  refreshFightCard() {
    if (this.isBoutInProgress) return;
    this.generateFightCard();
  }

  private redrawOddsBoard() {
    if (!this.oddsCanvas || !this.oddsTexture) return;
    drawOddsBoardCanvas(this.oddsCanvas, this.fightCard, this.pitWinStreak);
    this.oddsTexture.needsUpdate = true;
  }

  private buildArenaGeometry() {
    const { x, z, radius, promoterX, promoterZ } = FIGHT_PIT_CENTER;
    const gy = this.groundY;

    const concreteMat = new THREE.MeshStandardMaterial({ color: 0x373b42, roughness: 0.94, metalness: 0.04 });
    const darkIronMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.48, metalness: 0.82 });
    const steelMat = new THREE.MeshStandardMaterial({ color: 0x475569, roughness: 0.42, metalness: 0.78 });
    const woodMat = new THREE.MeshStandardMaterial({ color: 0x5c3d26, roughness: 0.86, metalness: 0.02 });
    const leatherMat = new THREE.MeshStandardMaterial({ color: 0x5f1914, roughness: 0.76, metalness: 0.04 });
    const redPadMat = new THREE.MeshStandardMaterial({ color: 0xb91c1c, roughness: 0.65, metalness: 0.05 });
    const bluePadMat = new THREE.MeshStandardMaterial({ color: 0x1d4ed8, roughness: 0.65, metalness: 0.05 });
    const amberPadMat = new THREE.MeshStandardMaterial({ color: 0xd97706, roughness: 0.65, metalness: 0.05 });
    const emberMat = new THREE.MeshStandardMaterial({
      color: 0xf97316,
      emissive: 0xea580c,
      emissiveIntensity: 2.2,
      roughness: 0.6,
    });

    // Concrete apron slab expanded for bleachers, bookie station & gym warm-up zone
    const slab = new THREE.Mesh(new THREE.BoxGeometry(25, 0.24, 24), concreteMat);
    slab.position.set(x, gy - 0.08, z);
    slab.receiveShadow = true;
    this.group.add(slab);

    // Octagon combat mat
    const matTex = makePitMatTexture();
    const mat = new THREE.Mesh(
      new THREE.CylinderGeometry(radius, radius + 0.22, 0.16, 8),
      new THREE.MeshStandardMaterial({
        map: matTex,
        color: matTex ? 0xffffff : 0x1c1917,
        roughness: 0.85,
        metalness: 0.03,
      }),
    );
    mat.position.set(x, gy + 0.08, z);
    mat.receiveShadow = true;
    this.group.add(mat);

    // 8 Cage posts with padded Red/Blue corner turnbuckles + chain-link fencing
    const sides = 8;
    const cornerPts: THREE.Vector3[] = [];
    for (let i = 0; i < sides; i++) {
      const a = (i / sides) * Math.PI * 2 + Math.PI / 8;
      const px = x + Math.cos(a) * radius;
      const pz = z + Math.sin(a) * radius;
      cornerPts.push(new THREE.Vector3(px, gy, pz));

      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.13, 2.45, 10), steelMat);
      post.position.set(px, gy + 1.22, pz);
      post.castShadow = true;
      this.group.add(post);
      this.colliders.push(post);

      // Corner turnbuckle pad
      const padMat = px < x - 2 ? redPadMat : px > x + 2 ? bluePadMat : amberPadMat;
      const pad = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 1.55, 8), padMat);
      pad.position.set(px, gy + 1.15, pz);
      pad.castShadow = true;
      this.group.add(pad);
    }

    const chainTex = makeChainLinkTexture();
    const chainMat = new THREE.MeshStandardMaterial({
      map: chainTex,
      alphaTest: 0.35,
      transparent: false,
      side: THREE.DoubleSide,
      roughness: 0.45,
      metalness: 0.8,
      color: 0xcbd5e1,
    });

    for (let i = 0; i < sides; i++) {
      const p1 = cornerPts[i];
      const p2 = cornerPts[(i + 1) % sides];
      const midX = (p1.x + p2.x) * 0.5;
      const midZ = (p1.z + p2.z) * 0.5;
      const segLen = p1.distanceTo(p2);
      const yaw = Math.atan2(p2.x - p1.x, p2.z - p1.z);
      const isGate = midX < x - radius * 0.8;

      if (isGate) {
        const gate = new THREE.Mesh(new THREE.BoxGeometry(0.14, 1.65, segLen), redPadMat);
        gate.position.set(midX, gy + 1.1, midZ);
        gate.rotation.y = yaw;
        gate.visible = false;
        this.group.add(gate);
        this.gateBar = gate;
        continue;
      }

      // Chain-link mesh panel
      if (chainTex) {
        const meshPanel = new THREE.Mesh(new THREE.PlaneGeometry(segLen, 1.85), chainMat);
        meshPanel.position.set(midX, gy + 1.15, midZ);
        meshPanel.rotation.y = yaw + Math.PI / 2;
        this.group.add(meshPanel);
      }

      for (const h of [0.3, 1.15, 2.08]) {
        const rail = new THREE.Mesh(
          new THREE.CylinderGeometry(0.045, 0.045, segLen, 8),
          h === 2.08 ? steelMat : redPadMat,
        );
        rail.position.set(midX, gy + h, midZ);
        rail.rotation.order = "YXZ";
        rail.rotation.y = yaw;
        rail.rotation.x = Math.PI / 2;
        rail.castShadow = true;
        this.group.add(rail);
      }
      const wallCol = new THREE.Mesh(
        new THREE.BoxGeometry(0.38, 2.2, segLen),
        new THREE.MeshBasicMaterial({ visible: false }),
      );
      wallCol.position.set(midX, gy + 1.1, midZ);
      wallCol.rotation.y = yaw;
      this.group.add(wallCol);
      this.colliders.push(wallCol);
    }

    // 4 Corner Floodlight Towers + Overhead Cross-Truss & String Lights
    for (const [dx, dz] of [[-8.5, -8.5], [8.5, -8.5], [-8.5, 8.5], [8.5, 8.5]]) {
      const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.12, 5.4, 8), darkIronMat);
      mast.position.set(x + dx, gy + 2.7, z + dz);
      mast.castShadow = true;
      this.group.add(mast);

      const lamp = new THREE.Mesh(
        new THREE.BoxGeometry(0.95, 0.44, 0.36),
        new THREE.MeshStandardMaterial({ color: 0xfef3c7, emissive: 0xfde047, emissiveIntensity: 2.3 }),
      );
      lamp.position.set(x + dx, gy + 5.3, z + dz);
      lamp.lookAt(x, gy + 1.0, z);
      this.group.add(lamp);
    }

    // Overhead rigging truss & warm bulbs
    for (const rotY of [Math.PI / 4, -Math.PI / 4]) {
      const truss = new THREE.Mesh(new THREE.BoxGeometry(23.8, 0.16, 0.18), darkIronMat);
      truss.position.set(x, gy + 5.28, z);
      truss.rotation.y = rotY;
      this.group.add(truss);
    }
    const bulbMat = new THREE.MeshStandardMaterial({
      color: 0xfef08a,
      emissive: 0xfbbf24,
      emissiveIntensity: 2.6,
    });
    for (let b = -4; b <= 4; b++) {
      if (b === 0) continue;
      for (const sign of [-1, 1]) {
        const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.08, 8, 6), bulbMat);
        bulb.position.set(x + b * 2.1, gy + 5.14, z + sign * b * 2.1);
        this.group.add(bulb);
      }
    }

    // Cage center light & East "IRON PIT" marquee sign
    const centerLight = new THREE.PointLight(0xffb454, 22, 26, 1.5);
    centerLight.position.set(x, gy + 5.15, z);
    this.group.add(centerLight);

    const signBack = new THREE.Mesh(new THREE.BoxGeometry(0.24, 1.38, 5.5), darkIronMat);
    signBack.position.set(x + 8.65, gy + 3.8, z);
    this.group.add(signBack);
    const signTex = makePitSignTexture();
    const signFace = new THREE.Mesh(
      new THREE.PlaneGeometry(5.3, 1.22),
      new THREE.MeshStandardMaterial({
        map: signTex,
        emissive: 0x7c2d12,
        emissiveIntensity: 0.55,
      }),
    );
    signFace.position.set(x + 8.52, gy + 3.8, z);
    signFace.rotation.y = -Math.PI / 2;
    this.group.add(signFace);

    // 2-Tier Spectator Bleachers (North & South sidelines)
    for (const side of [-1, 1]) {
      const bz = z + side * 10.2;
      const bleacher = new THREE.Group();
      for (let tier = 0; tier < 2; tier++) {
        const plank = new THREE.Mesh(new THREE.BoxGeometry(9.6, 0.12, 0.72), woodMat);
        plank.position.set(0, 0.45 + tier * 0.48, side * (tier * 0.68));
        plank.castShadow = true;
        plank.receiveShadow = true;
        bleacher.add(plank);
      }
      for (const sx of [-4.2, -1.4, 1.4, 4.2]) {
        const leg = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.96, 1.45), darkIronMat);
        leg.position.set(sx, 0.48, side * 0.34);
        bleacher.add(leg);
      }
      bleacher.position.set(x + 0.5, gy, bz);
      this.group.add(bleacher);
      const col = new THREE.Mesh(
        new THREE.BoxGeometry(9.6, 1.1, 1.65),
        new THREE.MeshBasicMaterial({ visible: false }),
      );
      col.position.set(x + 0.5, gy + 0.55, bz + side * 0.34);
      this.group.add(col);
      this.colliders.push(col);
    }

    // Viktor's Bookmaker Booth & Live Odds Chalkboard (West-North apron)
    const booth = new THREE.Group();
    booth.position.set(promoterX - 0.55, gy, promoterZ + 0.4);
    for (const [px, pz] of [[-1.35, -0.7], [1.35, -0.7], [-1.35, 0.7], [1.35, 0.7]]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 2.65, 8), darkIronMat);
      post.position.set(px, 1.32, pz);
      booth.add(post);
    }
    const canopy = new THREE.Mesh(new THREE.BoxGeometry(3.1, 0.14, 1.75), darkIronMat);
    canopy.position.set(0, 2.65, 0);
    booth.add(canopy);
    const bookieBannerTex = makeBookieBannerTexture();
    const bookieBanner = new THREE.Mesh(
      new THREE.PlaneGeometry(2.85, 0.68),
      new THREE.MeshStandardMaterial({
        map: bookieBannerTex,
        emissive: 0x14532d,
        emissiveIntensity: 0.45,
      }),
    );
    bookieBanner.position.set(0, 2.42, -0.89);
    bookieBanner.rotation.y = Math.PI;
    booth.add(bookieBanner);
    const deskLight = new THREE.PointLight(0x4ade80, 6, 7, 1.8);
    deskLight.position.set(0, 2.35, -0.35);
    booth.add(deskLight);
    this.group.add(booth);

    // Live Odds Chalkboard beside Viktor's booth
    if (typeof document !== "undefined") {
      this.oddsCanvas = document.createElement("canvas");
      this.oddsCanvas.width = 512;
      this.oddsCanvas.height = 360;
      this.oddsTexture = new THREE.CanvasTexture(this.oddsCanvas);
      this.oddsTexture.colorSpace = THREE.SRGBColorSpace;
      this.redrawOddsBoard();

      const boardStand = new THREE.Mesh(new THREE.BoxGeometry(2.7, 1.95, 0.14), darkIronMat);
      boardStand.position.set(promoterX - 3.0, gy + 1.35, promoterZ - 0.15);
      boardStand.rotation.y = Math.PI * 0.22;
      boardStand.castShadow = true;
      this.group.add(boardStand);
      this.colliders.push(boardStand);

      const boardFace = new THREE.Mesh(
        new THREE.PlaneGeometry(2.54, 1.78),
        new THREE.MeshStandardMaterial({
          map: this.oddsTexture,
          emissive: 0x1e293b,
          emissiveIntensity: 0.35,
          roughness: 0.72,
        }),
      );
      boardFace.position.set(promoterX - 2.94, gy + 1.35, promoterZ - 0.08);
      boardFace.rotation.y = Math.PI * 0.22;
      this.group.add(boardFace);
    }

    // Heavy Punching Bag Gallows Stand (South-West Warm-Up Zone)
    const bagBaseX = x - 10.6;
    const bagBaseZ = z - 6.8;
    const bagStand = new THREE.Group();
    bagStand.position.set(bagBaseX, gy, bagBaseZ);
    const upright = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.075, 2.65, 8), darkIronMat);
    upright.position.set(-0.55, 1.32, 0);
    upright.castShadow = true;
    bagStand.add(upright);
    const arm = new THREE.Mesh(new THREE.BoxGeometry(1.15, 0.09, 0.09), darkIronMat);
    arm.position.set(-0.02, 2.62, 0);
    bagStand.add(arm);
    const footBase = new THREE.Mesh(new THREE.BoxGeometry(1.35, 0.08, 1.15), darkIronMat);
    footBase.position.set(-0.25, 0.04, 0);
    bagStand.add(footBase);

    const bagPivot = new THREE.Group();
    bagPivot.position.set(0.42, 2.58, 0);
    const chain = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.45, 6), steelMat);
    chain.position.y = -0.22;
    bagPivot.add(chain);
    const bagBody = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.23, 1.22, 14), leatherMat);
    bagBody.position.y = -1.04;
    bagBody.castShadow = true;
    bagPivot.add(bagBody);
    const bagTape = new THREE.Mesh(new THREE.CylinderGeometry(0.228, 0.228, 0.14, 14), redPadMat);
    bagTape.position.y = -0.78;
    bagPivot.add(bagTape);
    bagStand.add(bagPivot);
    this.heavyBagPivot = bagPivot;
    this.group.add(bagStand);
    this.colliders.push(upright);

    // Barbell & Cast-Iron Weight Rack (South-West Warm-Up Zone)
    const rackX = x - 10.4;
    const rackZ = z - 9.4;
    const rack = new THREE.Group();
    rack.position.set(rackX, gy, rackZ);
    for (const rx of [-0.72, 0.72]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.08, 1.55, 0.08), darkIronMat);
      post.position.set(rx, 0.78, 0);
      post.castShadow = true;
      rack.add(post);
      const base = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.06, 0.85), darkIronMat);
      base.position.set(rx, 0.03, 0);
      rack.add(base);
    }
    const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 2.15, 10), steelMat);
    bar.rotation.z = Math.PI / 2;
    bar.position.set(0, 1.18, 0);
    rack.add(bar);
    for (const px of [-0.88, -0.80, 0.80, 0.88]) {
      const plate = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.05, 14), darkIronMat);
      plate.rotation.z = Math.PI / 2;
      plate.position.set(px, 1.18, 0);
      plate.castShadow = true;
      rack.add(plate);
    }
    this.group.add(rack);
    const rackCol = new THREE.Mesh(new THREE.BoxGeometry(1.9, 1.6, 0.9), new THREE.MeshBasicMaterial({ visible: false }));
    rackCol.position.set(rackX, gy + 0.8, rackZ);
    this.group.add(rackCol);
    this.colliders.push(rackCol);

    // Fire-Drum Glow Embers at the two pit entrance brazier spots
    for (const [bx, bz] of [[x - 9.3, z - 4.2], [x - 9.3, z + 4.4]]) {
      const fireTop = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.22, 0.12, 10), emberMat);
      fireTop.position.set(bx, gy + 0.94, bz);
      this.group.add(fireTop);

      const eLight = new THREE.PointLight(0xf97316, 4.5, 9, 1.7);
      eLight.position.set(bx, gy + 1.35, bz);
      this.group.add(eLight);
      this.emberLights.push(eLight);
    }

    // Pulsing promoter interaction ring
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0xf59e0b,
      transparent: true,
      opacity: 0.72,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    this.promptRing = new THREE.Mesh(new THREE.RingGeometry(0.85, 1.14, 32), ringMat);
    this.promptRing.rotation.x = -Math.PI / 2;
    this.promptRing.position.set(promoterX, gy + 0.05, promoterZ - 1.15);
    this.group.add(this.promptRing);
  }

  private loadPitGltfProps() {
    if (this.propsLoaded || typeof window === "undefined" || typeof fetch !== "function") return;
    this.propsLoaded = true;
    const { x, z, promoterX, promoterZ } = FIGHT_PIT_CENTER;
    const gy = this.groundY;

    const place = (
      filename: string,
      axis: "x" | "y" | "z" | "max",
      targetMeters: number,
      px: number,
      pz: number,
      yaw = 0,
      addCollider = false,
      baseYOffset = 0,
    ) => {
      void loadCityGlb(filename).then((scene) => {
        if (!scene) return;
        const wrapped = fitGlbToDimension(scene, axis, targetMeters, gy + baseYOffset, yaw);
        wrapped.position.set(px, 0, pz);
        this.group.add(wrapped);
        if (addCollider) {
          wrapped.updateMatrixWorld(true);
          const box = new THREE.Box3().setFromObject(wrapped);
          const sz = box.getSize(new THREE.Vector3());
          const ctr = box.getCenter(new THREE.Vector3());
          const col = new THREE.Mesh(
            new THREE.BoxGeometry(Math.max(0.35, sz.x), Math.max(0.5, sz.y), Math.max(0.35, sz.z)),
            new THREE.MeshBasicMaterial({ visible: false }),
          );
          col.position.copy(ctr);
          this.group.add(col);
          this.colliders.push(col);
        }
      });
    };

    // Viktor's Betting Desk: table, cash register, POS terminal, cash stash bags, championship cup
    place("int_table.glb", "x", 1.9, promoterX - 0.55, promoterZ - 0.15, 0, true);
    place("pit_cash_register.glb", "y", 0.36, promoterX - 0.1, promoterZ - 0.15, Math.PI, false, 0.76);
    place("pos_terminal.glb", "y", 0.28, promoterX - 0.95, promoterZ - 0.15, Math.PI * 0.9, false, 0.76);
    place("pit_trophy.glb", "y", 0.48, promoterX + 0.45, promoterZ - 0.15, Math.PI, false, 0.76);
    place("pit_pallet.glb", "x", 1.25, promoterX + 1.4, promoterZ + 0.5, 0.15, false);
    place("stash_bag.glb", "x", 0.65, promoterX + 1.35, promoterZ + 0.5, 0.4, false, 0.12);
    place("stash_bag.glb", "x", 0.58, promoterX + 1.55, promoterZ + 0.3, -0.3, false, 0.12);

    // Oil-drum fire braziers at entrance + spare barrels around dockyard pit
    place("pit_barrel_open.glb", "y", 0.96, x - 9.3, z - 4.2, 0.4, true);
    place("pit_barrel_open.glb", "y", 0.96, x - 9.3, z + 4.4, 1.2, true);
    place("pit_barrel.glb", "y", 0.94, x + 9.4, z - 6.6, 0.2, true);
    place("pit_barrel.glb", "y", 0.94, x + 9.9, z - 5.9, 1.8, true);

    // PA Speaker Stacks flanking East & West sides
    place("pit_speaker.glb", "y", 1.35, x + 8.6, z - 4.6, -Math.PI * 0.68, true);
    place("pit_speaker.glb", "y", 1.35, x + 8.6, z + 4.6, -Math.PI * 0.32, true);
    place("pit_speaker.glb", "y", 1.2, x - 8.4, z - 7.8, Math.PI * 0.25, true);

    // Cornerman stools & ringside medkit inside/near corners
    place("pit_stool.glb", "y", 0.58, x - 5.8, z - 2.6, 0.5, false);
    place("pit_stool.glb", "y", 0.58, x + 5.8, z + 2.6, -2.5, false);
    place("medkit.glb", "x", 0.46, x - 6.1, z - 2.2, 0.2, false);

    // Work floodlights along entrance & gym corner
    place("pit_floodlight.glb", "y", 1.55, x - 10.2, z - 2.6, Math.PI * 0.42, true);
    place("pit_floodlight.glb", "y", 1.55, x - 10.2, z + 2.8, Math.PI * 0.58, true);

    // Concrete crowd-control barriers framing the entry lane & East backstop
    place("pit_barrier.glb", "x", 2.0, x - 10.4, z - 5.9, 0.1, true);
    place("pit_barrier.glb", "x", 2.0, x - 10.4, z + 6.1, -0.1, true);
    place("pit_barrier.glb", "x", 2.1, x + 10.4, z - 1.5, Math.PI / 2, true);
    place("pit_barrier.glb", "x", 2.1, x + 10.4, z + 1.5, Math.PI / 2, true);

    // VIP Ringside chairs & industrial crate stacks
    place("pit_chair.glb", "y", 0.86, x - 2.6, z - 8.6, 0.1, false);
    place("pit_chair.glb", "y", 0.86, x + 0.4, z - 8.6, -0.1, false);
    place("pit_chair.glb", "y", 0.86, x + 3.2, z - 8.6, -0.25, false);
    place("pit_crate_stack.glb", "y", 1.55, x + 9.8, z + 6.8, -0.4, true);
    place("pit_crate_stack.glb", "y", 1.45, x - 10.8, z + 8.8, 0.35, true);
    place("pit_pallet.glb", "x", 1.5, x + 9.6, z + 4.4, 0.2, false);
  }

  private loadNpcActors() {
    if (this.actorsLoaded || typeof window === "undefined" || typeof fetch !== "function") return;
    this.actorsLoaded = true;
    const { x, z, promoterX, promoterZ } = FIGHT_PIT_CENTER;
    const gy = this.groundY;

    // Pit Promoter ("Viktor") behind his bookie booth
    void SoldierRig.load(this.group, undefined, characterUrl("business"))
      .then((rig) => {
        rig.setHolstered(true);
        rig.root.position.set(promoterX - 0.55, gy, promoterZ + 0.55);
        rig.aimYaw = Math.PI;
        this.group.add(rig.root);
        this.promoterRig = rig;
      })
      .catch(() => {});

    // 6 Spectators around the octagon & bleachers
    const specSpots: Array<[number, number, string]> = [
      [x + 1.8, z - 8.9, "civilian"],
      [x - 2.2, z + 8.9, "construction"],
      [x + 6.5, z + 6.4, "security"],
      [x + 6.5, z - 6.4, "sports"],
      [x - 1.2, z - 9.0, "sports"],
      [x + 2.6, z + 8.9, "civilian"],
    ];
    specSpots.forEach(([sx, sz, tag], i) => {
      const url = characterUrl(tag);
      void SoldierRig.load(this.group, undefined, url)
        .then((rig) => {
          rig.setHolstered(true);
          rig.root.position.set(sx, gy, sz);
          const yaw = Math.atan2(x - sx, z - sz);
          rig.aimYaw = yaw;
          this.group.add(rig.root);
          this.spectators.push({ rig, baseYaw: yaw, phase: i * 1.45 });
        })
        .catch(() => {});
    });
  }

  get isActive(): boolean {
    return this.phase !== "idle";
  }

  get isBoutInProgress(): boolean {
    return this.phase === "countdown" || this.phase === "fighting";
  }

  getNextTierIndex(): number {
    return Math.min(FIGHT_PIT_TIERS.length - 1, Math.max(0, this.pitRank));
  }

  getBookieInfo(): PitHudBookieInfo {
    const save = loadSave();
    const streakBonusPct = Math.min(60, this.pitWinStreak * 15);
    return {
      credits: save.currencies.credits,
      pitRank: this.pitRank,
      pitWins: this.pitWins,
      pitWinStreak: this.pitWinStreak,
      pitBetWins: this.pitBetWins,
      pitBetProfit: this.pitBetProfit,
      streakBonusPct,
      nextTierIndex: this.getNextTierIndex(),
      tiers: FIGHT_PIT_TIERS,
      fightCard: this.fightCard,
      lastSettlement: this.lastSettlement,
    };
  }

  getPromptInfo(playerPos: THREE.Vector3): { near: boolean; text: string; tier: FightPitTierDef } {
    const tier = FIGHT_PIT_TIERS[this.getNextTierIndex()];
    const dPromoter = Math.hypot(
      playerPos.x - FIGHT_PIT_CENTER.promoterX,
      playerPos.z - (FIGHT_PIT_CENTER.promoterZ - 0.8),
    );
    const dGate = Math.hypot(playerPos.x - FIGHT_PIT_CENTER.gateX, playerPos.z - FIGHT_PIT_CENTER.gateZ);
    const near = Math.min(dPromoter, dGate) < 4.2;
    if (this.phase === "fighting" || this.phase === "countdown") {
      return {
        near: true,
        text:
          this.mode === "spectator"
            ? `[F] Leave Ringside`
            : `[F] Forfeit Bout vs ${tier.alias}`,
        tier,
      };
    }
    const label =
      this.pitRank >= FIGHT_PIT_TIERS.length
        ? `[F] Fight ${tier.alias} ($${tier.purse.toLocaleString()}) · [G] Bookie & Odds`
        : `[F] Enter Bout ${tier.tier}/${FIGHT_PIT_TIERS.length} (${tier.alias}) · [G] Bookie & Odds`;
    return { near, text: label, tier };
  }

  async startBout(
    host: CombatHost,
    playerRig: SoldierRig,
    tierOverride?: number,
    selfBet?: { wager: number; quickKoProp: boolean },
  ): Promise<{ ok: boolean; error?: string }> {
    if (this.phase !== "idle" || this.spawnPending) return { ok: false, error: "Bout already active" };
    const tierIdx =
      tierOverride !== undefined
        ? Math.max(0, Math.min(FIGHT_PIT_TIERS.length - 1, tierOverride))
        : this.getNextTierIndex();
    const def = FIGHT_PIT_TIERS[tierIdx];

    let builtBet: ActivePitBet | null = null;
    if (selfBet && selfBet.wager > 0) {
      const res = spendPitCredits(selfBet.wager);
      if (!res.ok) return { ok: false, error: "Insufficient credits for self-bet" };
      const baseOdds = Math.round((1.45 + tierIdx * 0.28) * 100) / 100;
      const totalOdds = Math.round((baseOdds + (selfBet.quickKoProp ? 0.9 : 0)) * 100) / 100;
      builtBet = {
        kind: "self",
        pickCorner: "red",
        pickName: "You (Challenger)",
        wager: Math.floor(selfBet.wager),
        odds: totalOdds,
        quickKoProp: selfBet.quickKoProp,
        koCutoffSec: 35,
        potentialPayout: Math.round(Math.floor(selfBet.wager) * totalOdds),
      };
    }

    this.spawnPending = true;
    this.mode = "player";
    this.activeTierIdx = tierIdx;
    this.activeBet = builtBet;
    this.lastSettlement = null;

    this.cleanupBoutActors();

    const { x, z } = FIGHT_PIT_CENTER;
    const gy = this.groundY;

    playerRig.root.position.set(x - 4.0, gy, z);
    playerRig.aimYaw = Math.PI / 2;
    playerRig.setHolstered(true);
    if (this.gateBar) this.gateBar.visible = true;

    const opponentUrl = buildFighterUrl(def.fighter);
    const spawn = {
      x: x + 4.0,
      y: gy,
      z,
      yawDeg: -90,
      mode: "advance" as const,
      name: def.alias,
      boss: tierIdx >= FIGHT_PIT_TIERS.length - 1,
    };
    const challenger = new Enemy(host, spawn, PIT_MISSION_STUB, {
      hpOverride: def.hp,
      customModelUrl: opponentUrl,
      unarmedOnly: true,
      meleeDamageScale: def.damageScale,
      meleeAggroScale: def.aggroScale,
    });

    try {
      await challenger.build(this.group, [0x991b1b, 0xf59e0b], 1);
      challenger.rig.root.position.set(x + 4.0, gy, z);
      challenger.rig.aimYaw = -Math.PI / 2;
      challenger.alerted = false;
      challenger.state = "idle";
      this.opponent = challenger;
      this.phase = "countdown";
      this.countdownTimer = 2.6;
      this.boutElapsed = 0;
      this.prevOpponentHp = def.hp;
      this.bannerText = `BOUT ${def.tier}: ${def.alias.toUpperCase()}`;
      host.sfx.pitBell(false);
      return { ok: true };
    } catch {
      if (builtBet) recordFightPitBetResult(0, builtBet.wager);
      this.activeBet = null;
      if (this.gateBar) this.gateBar.visible = false;
      return { ok: false, error: "Failed to load opponent" };
    } finally {
      this.spawnPending = false;
    }
  }

  async startSpectatorBout(
    matchId: string,
    pickCorner: "red" | "blue",
    wager: number,
    quickKoProp: boolean,
    host: CombatHost,
    playerRig: SoldierRig,
  ): Promise<{ ok: boolean; error?: string }> {
    if (this.phase !== "idle" || this.spawnPending) return { ok: false, error: "Pit is currently busy" };
    const match = this.fightCard.find((m) => m.id === matchId) ?? this.fightCard[0];
    if (!match) return { ok: false, error: "No fight card available" };
    const cleanWager = Math.max(0, Math.floor(wager));
    if (cleanWager < 25) return { ok: false, error: "Minimum wager is $25" };

    const spend = spendPitCredits(cleanWager);
    if (!spend.ok) return { ok: false, error: "Insufficient credits" };

    const chosen = pickCorner === "red" ? match.red : match.blue;
    const baseOdds = pickCorner === "red" ? match.redOdds : match.blueOdds;
    const totalOdds = Math.round((baseOdds + (quickKoProp ? match.koPropBonus : 0)) * 100) / 100;
    const builtBet: ActivePitBet = {
      kind: "spectator",
      pickCorner,
      pickName: chosen.alias,
      wager: cleanWager,
      odds: totalOdds,
      quickKoProp,
      koCutoffSec: 25,
      potentialPayout: Math.round(cleanWager * totalOdds),
    };

    this.spawnPending = true;
    this.mode = "spectator";
    this.activeBet = builtBet;
    this.lastSettlement = null;
    this.cleanupBoutActors();

    const { x, z, radius } = FIGHT_PIT_CENTER;
    const gy = this.groundY;

    // Ensure player stands safely ringside if they were inside the cage
    const dPlayer = Math.hypot(playerRig.root.position.x - x, playerRig.root.position.z - z);
    if (dPlayer < radius + 0.5) {
      playerRig.root.position.set(FIGHT_PIT_CENTER.exitX, gy, FIGHT_PIT_CENTER.exitZ);
    }
    if (this.gateBar) this.gateBar.visible = true;

    try {
      const [redRig, blueRig] = await Promise.all([
        SoldierRig.load(this.group, undefined, buildFighterUrl(match.red.fighter)),
        SoldierRig.load(this.group, undefined, buildFighterUrl(match.blue.fighter)),
      ]);
      redRig.setHolstered(true);
      blueRig.setHolstered(true);
      redRig.root.position.set(x - 3.6, gy, z);
      blueRig.root.position.set(x + 3.6, gy, z);
      redRig.aimYaw = Math.PI / 2;
      blueRig.aimYaw = -Math.PI / 2;
      this.group.add(redRig.root);
      this.group.add(blueRig.root);

      this.specRed = {
        def: match.red,
        corner: "red",
        rig: redRig,
        hp: match.red.hp,
        maxHp: match.red.hp,
        attackCooldown: 0.4,
        blockTimer: 0,
        dodgeCooldown: 0.8,
        hitProcessed: false,
        strafeSign: 1,
        strafeTimer: 1.5,
      };
      this.specBlue = {
        def: match.blue,
        corner: "blue",
        rig: blueRig,
        hp: match.blue.hp,
        maxHp: match.blue.hp,
        attackCooldown: 0.45,
        blockTimer: 0,
        dodgeCooldown: 0.8,
        hitProcessed: false,
        strafeSign: -1,
        strafeTimer: 1.5,
      };

      this.phase = "countdown";
      this.countdownTimer = 2.4;
      this.boutElapsed = 0;
      this.bannerText = `${match.red.alias} VS ${match.blue.alias}`.toUpperCase();
      host.sfx.pitBell(false);
      return { ok: true };
    } catch {
      recordFightPitBetResult(0, cleanWager);
      this.activeBet = null;
      if (this.gateBar) this.gateBar.visible = false;
      return { ok: false, error: "Failed to load pit fighters" };
    } finally {
      this.spawnPending = false;
    }
  }

  getActiveEnemy(): Enemy | null {
    return this.mode === "player" && this.opponent && !this.opponent.isDead ? this.opponent : null;
  }

  forfeit(playerRig: SoldierRig): void {
    if (this.phase !== "countdown" && this.phase !== "fighting") return;
    if (this.mode === "spectator") {
      // Leaving ringside cancels/refunds only during countdown; during active bout it stays abandoned (forfeited bet)
      if (this.phase === "countdown" && this.activeBet) {
        recordFightPitBetResult(0, this.activeBet.wager);
      } else if (this.activeBet) {
        recordFightPitBetResult(this.activeBet.wager, 0);
      }
      this.activeBet = null;
      this.cleanupBoutActors();
      if (this.gateBar) this.gateBar.visible = false;
      this.phase = "idle";
      this.bannerText = "";
      return;
    }
    if (this.activeBet) {
      recordFightPitBetResult(this.activeBet.wager, 0);
      this.activeBet = null;
    }
    const s = resetFightPitStreak();
    this.pitWinStreak = s.pitWinStreak ?? 0;
    this.cleanupBoutActors();
    if (this.gateBar) this.gateBar.visible = false;
    this.phase = "idle";
    this.bannerText = "";
    playerRig.root.position.set(FIGHT_PIT_CENTER.exitX, this.groundY, FIGHT_PIT_CENTER.exitZ);
  }

  private cleanupBoutActors() {
    if (this.opponent) {
      this.opponent.rig.root.removeFromParent();
      this.opponent = null;
    }
    if (this.specRed) {
      this.specRed.rig.dispose();
      this.specRed = null;
    }
    if (this.specBlue) {
      this.specBlue.rig.dispose();
      this.specBlue = null;
    }
  }

  private updateSpectatorFighterAI(
    dt: number,
    self: SpectatorActor,
    other: SpectatorActor,
    host: CombatHost,
  ) {
    const gy = this.groundY;
    const sPos = self.rig.root.position;
    const oPos = other.rig.root.position;
    const dx = oPos.x - sPos.x;
    const dz = oPos.z - sPos.z;
    const dist = Math.max(0.01, Math.hypot(dx, dz));
    const nx = dx / dist;
    const nz = dz / dist;

    self.rig.aimYaw = Math.atan2(nx, nz);
    self.attackCooldown = Math.max(0, self.attackCooldown - dt);
    self.blockTimer = Math.max(0, self.blockTimer - dt);
    self.dodgeCooldown = Math.max(0, self.dodgeCooldown - dt);
    self.strafeTimer -= dt;
    if (self.strafeTimer <= 0) {
      self.strafeSign = Math.random() < 0.5 ? -1 : 1;
      self.strafeTimer = 1.1 + Math.random() * 1.4;
    }

    // Footwork: close distance, circle, or step back slightly during cooldown
    const rx = -nz;
    const rz = nx;
    const move = self.rig.input.move;
    move.set(0, 0, 0);
    if (dist > 2.25) {
      move.set(nx + rx * self.strafeSign * 0.25, 0, nz + rz * self.strafeSign * 0.25).normalize();
      self.rig.input.sprint = dist > 4.2;
    } else if (dist < 1.18) {
      move.set(-nx * 0.65 + rx * self.strafeSign * 0.55, 0, -nz * 0.65 + rz * self.strafeSign * 0.55).normalize();
      self.rig.input.sprint = false;
    } else {
      move.set(rx * self.strafeSign * 0.72, 0, rz * self.strafeSign * 0.72).normalize();
      self.rig.input.sprint = false;
    }

    // Defensive reactions if opponent is swinging
    if (other.rig.combat.state === "attack" && dist < 2.5 && !self.rig.combat.isBusy) {
      if (self.dodgeCooldown <= 0 && Math.random() < (self.def.speed / 10) * 0.35) {
        self.rig.triggerDodge(rx * self.strafeSign - nx * 0.3, rz * self.strafeSign - nz * 0.3);
        self.dodgeCooldown = 1.65;
      } else if (self.blockTimer <= 0 && Math.random() < 0.55) {
        self.blockTimer = 0.48 + Math.random() * 0.28;
      }
    }
    self.rig.setCombatBlock(self.blockTimer > 0);

    // Offensive swings
    if (dist < 2.25 && self.attackCooldown <= 0 && !self.rig.combat.isBusy && self.blockTimer <= 0) {
      const heavy = Math.random() < 0.32;
      const m = self.rig.triggerMelee(heavy);
      if (m) {
        self.hitProcessed = false;
        host.sfx.meleeWhoosh(m.heavy);
        const speedFactor = 0.75 + (self.def.speed / 10) * 0.45;
        self.attackCooldown = (0.62 + Math.random() * 0.46) / speedFactor;
      }
    }

    // Check active melee hit frame against opponent
    const activeMove = self.rig.combat.activeHitWindow;
    if (activeMove && !self.hitProcessed && dist <= activeMove.range + 0.42) {
      self.hitProcessed = true;
      self.rig.combat.markHitConnected();
      const rawDmg =
        activeMove.damage * (0.78 + self.def.power * 0.045) * (0.94 + Math.random() * 0.14) /
        (0.82 + other.def.toughness * 0.028);
      const res = other.rig.combat.applyIncomingHit(
        rawDmg,
        activeMove.hitstun,
        activeMove.guardBreak,
        activeMove.heavy && activeMove.guardBreak && other.hp - rawDmg <= 18,
      );
      const hitPt = oPos.clone().add(new THREE.Vector3(0, 1.35, 0));
      if (res.parried) {
        self.rig.combat.inflictStagger(0.85, false);
        host.fx.meleeImpact(hitPt, true, true);
        host.sfx.meleeParry();
        this.cheerPulse = 0.9;
      } else if (res.blocked && !res.guardBroken) {
        other.hp = Math.max(0, other.hp - res.damageTaken);
        host.fx.meleeImpact(hitPt, true, false);
        host.sfx.meleeHit(activeMove.heavy, true);
      } else if (res.damageTaken > 0) {
        other.hp = Math.max(0, other.hp - res.damageTaken);
        other.rig.applyKnockback(nx * (activeMove.heavy ? 5.4 : 2.8), nz * (activeMove.heavy ? 5.4 : 2.8));
        host.fx.meleeImpact(hitPt, false, activeMove.heavy);
        host.sfx.meleeHit(activeMove.heavy, false);
        this.cheerPulse = Math.max(this.cheerPulse, activeMove.heavy ? 1.0 : 0.65);
      }
    }

    self.rig.update(dt, gy);
  }

  update(
    dt: number,
    elapsed: number,
    playerRig: SoldierRig,
    playerHp: number,
    host: CombatHost,
    callbacks: {
      onPurseWon: (def: FightPitTierDef, totalCreditsWon: number, streakPct: number) => void;
      onPlayerTko: () => void;
      onBetSettled?: (won: boolean, title: string, detail: string, payout: number) => void;
    },
  ): FightPitHudState {
    const gy = this.groundY;
    const { x, z, radius } = FIGHT_PIT_CENTER;
    const distSqToPlayer =
      (playerRig.root.position.x - x) ** 2 + (playerRig.root.position.z - z) ** 2;

    if (!this.actorsLoaded && distSqToPlayer < 85 * 85) {
      this.loadNpcActors();
    }
    if (!this.propsLoaded && distSqToPlayer < 120 * 120) {
      this.loadPitGltfProps();
    }

    if (distSqToPlayer < 105 * 105) {
      if (this.promptRing) {
        const s = 1 + Math.sin(elapsed * 3.4) * 0.08;
        this.promptRing.scale.set(s, s, 1);
        this.promptRing.visible = this.phase === "idle";
      }
      if (this.heavyBagPivot) {
        // Gentle swaying heavy bag + extra kick when player stands right next to it
        const dBag = Math.hypot(playerRig.root.position.x - (x - 10.2), playerRig.root.position.z - (z - 6.8));
        const amp = dBag < 1.8 ? 0.14 : 0.035;
        this.heavyBagPivot.rotation.z = Math.sin(elapsed * 2.1) * amp;
        this.heavyBagPivot.rotation.x = Math.cos(elapsed * 1.55) * amp * 0.7;
      }
      for (let i = 0; i < this.emberLights.length; i++) {
        this.emberLights[i].intensity = 4.2 + Math.sin(elapsed * 11 + i * 2.3) * 1.1;
      }
      if (this.promoterRig) {
        const dx = playerRig.root.position.x - this.promoterRig.root.position.x;
        const dz = playerRig.root.position.z - this.promoterRig.root.position.z;
        if (dx * dx + dz * dz < 144) {
          this.promoterRig.aimYaw = Math.atan2(dx, dz);
        }
        this.promoterRig.update(dt, gy);
      }

      this.cheerPulse = Math.max(0, this.cheerPulse - dt * 1.4);
      for (const sp of this.spectators) {
        const excited = this.phase === "fighting" || this.phase === "victory";
        if (excited && (this.cheerPulse > 0.25 || this.phase === "victory")) {
          sp.rig.aimYaw = sp.baseYaw + Math.sin(elapsed * 7 + sp.phase) * 0.22;
          if (!sp.rig.combat.isBusy && Math.sin(elapsed * 4.5 + sp.phase) > 0.92) {
            sp.rig.triggerMelee(false);
          }
        } else {
          sp.rig.aimYaw = sp.baseYaw + Math.sin(elapsed * 1.2 + sp.phase) * 0.09;
        }
        sp.rig.update(dt, gy);
      }
    }

    const clampInside = (pos: THREE.Vector3) => {
      const dx = pos.x - x;
      const dz = pos.z - z;
      const d = Math.hypot(dx, dz);
      const maxR = radius - 0.72;
      if (d > maxR && d > 0.001) {
        pos.x = x + (dx / d) * maxR;
        pos.z = z + (dz / d) * maxR;
      }
      if (pos.y < gy) pos.y = gy;
    };

    if (this.phase === "countdown" || this.phase === "fighting") {
      if (this.mode === "player") {
        clampInside(playerRig.root.position);
        if (this.opponent) clampInside(this.opponent.rig.root.position);
      } else {
        if (this.specRed) clampInside(this.specRed.rig.root.position);
        if (this.specBlue) clampInside(this.specBlue.rig.root.position);
      }
    }

    const tierDef = FIGHT_PIT_TIERS[this.activeTierIdx];

    if (this.phase === "countdown") {
      this.countdownTimer -= dt;
      if (this.mode === "player" && this.opponent) {
        this.opponent.rig.aimYaw = Math.atan2(
          playerRig.root.position.x - this.opponent.rig.root.position.x,
          playerRig.root.position.z - this.opponent.rig.root.position.z,
        );
        this.opponent.rig.update(dt, gy);
        const sec = Math.max(1, Math.ceil(this.countdownTimer));
        this.bannerText = this.countdownTimer <= 0.35 ? "FIGHT!" : `${tierDef.alias.toUpperCase()} — ${sec}`;
      } else if (this.mode === "spectator" && this.specRed && this.specBlue) {
        this.specRed.rig.aimYaw = Math.atan2(
          this.specBlue.rig.root.position.x - this.specRed.rig.root.position.x,
          this.specBlue.rig.root.position.z - this.specRed.rig.root.position.z,
        );
        this.specBlue.rig.aimYaw = Math.atan2(
          this.specRed.rig.root.position.x - this.specBlue.rig.root.position.x,
          this.specRed.rig.root.position.z - this.specBlue.rig.root.position.z,
        );
        this.specRed.rig.update(dt, gy);
        this.specBlue.rig.update(dt, gy);
        const sec = Math.max(1, Math.ceil(this.countdownTimer));
        this.bannerText = this.countdownTimer <= 0.35 ? "BELL RINGS — FIGHT!" : `CAGE MATCH IN ${sec}`;
      }

      if (this.countdownTimer <= 0) {
        this.phase = "fighting";
        this.boutElapsed = 0;
        this.bannerText = this.mode === "spectator" ? "LIVE BETTING BOUT" : "BARE-KNUCKLE · NO WEAPONS";
        if (this.mode === "player" && this.opponent) {
          this.opponent.alerted = true;
          this.opponent.state = "attack";
          this.opponent.lastSeen.copy(playerRig.root.position);
        }
        host.sfx.pitBell(true);
        host.sfx.crowdCheer();
      }
    } else if (this.phase === "fighting") {
      this.boutElapsed += dt;

      if (this.mode === "player") {
        if (!playerRig.holstered) playerRig.setHolstered(true);

        if (this.opponent) {
          this.opponent.lastSeen.copy(playerRig.root.position);
          this.opponent.sightLost = 0;
          this.opponent.update(dt);

          if (this.opponent.hp < this.prevOpponentHp) {
            this.prevOpponentHp = this.opponent.hp;
            this.cheerPulse = 1.0;
          }

          if (this.opponent.isDead) {
            this.phase = "victory";
            this.finishTimer = 2.8;
            const streakBonusPct = Math.min(60, this.pitWinStreak * 15);
            const purseTotal = Math.round(tierDef.purse * (1 + streakBonusPct / 100));
            const updated = recordFightPitWin(this.activeTierIdx, purseTotal);
            this.pitRank = updated.pitRank ?? this.pitRank;
            this.pitWins = updated.pitWins ?? this.pitWins;
            this.pitWinStreak = updated.pitWinStreak ?? this.pitWinStreak;

            let betPayout = 0;
            if (this.activeBet) {
              const koOk = !this.activeBet.quickKoProp || this.boutElapsed <= this.activeBet.koCutoffSec;
              if (koOk) {
                betPayout = this.activeBet.potentialPayout;
                const bSave = recordFightPitBetResult(this.activeBet.wager, betPayout);
                this.pitBetWins = bSave.pitBetWins ?? this.pitBetWins;
                this.pitBetProfit = bSave.pitBetProfit ?? this.pitBetProfit;
                this.lastSettlement = {
                  won: true,
                  title: "SELF-BET CASHED!",
                  detail: `Won $${betPayout.toLocaleString()} at ${this.activeBet.odds.toFixed(2)}x`,
                  payout: betPayout,
                };
              } else {
                const bSave = recordFightPitBetResult(this.activeBet.wager, 0);
                this.pitBetProfit = bSave.pitBetProfit ?? this.pitBetProfit;
                this.lastSettlement = {
                  won: false,
                  title: "KO PROP MISSED",
                  detail: `Won bout in ${this.boutElapsed.toFixed(1)}s (needed ≤${this.activeBet.koCutoffSec}s)`,
                  payout: 0,
                };
              }
            }

            this.bannerText =
              betPayout > 0
                ? `KNOCKOUT! +$${(purseTotal + betPayout).toLocaleString()}`
                : `KNOCKOUT! +$${purseTotal.toLocaleString()}`;
            host.sfx.pitBell(true);
            host.sfx.crowdCheer();
            this.redrawOddsBoard();
            callbacks.onPurseWon(tierDef, purseTotal + betPayout, streakBonusPct);
          } else if (playerHp <= 1) {
            this.phase = "defeat";
            this.finishTimer = 2.0;
            this.bannerText = "TKO — REFEREE STOPPED BOUT";
            const s = resetFightPitStreak();
            this.pitWinStreak = s.pitWinStreak ?? 0;
            if (this.activeBet) {
              const bSave = recordFightPitBetResult(this.activeBet.wager, 0);
              this.pitBetProfit = bSave.pitBetProfit ?? this.pitBetProfit;
              this.lastSettlement = {
                won: false,
                title: "SELF-BET LOST",
                detail: `Lost $${this.activeBet.wager.toLocaleString()} wager on TKO`,
                payout: 0,
              };
            }
            host.sfx.pitBell(true);
            this.redrawOddsBoard();
            callbacks.onPlayerTko();
          }
        }
      } else if (this.mode === "spectator" && this.specRed && this.specBlue) {
        this.updateSpectatorFighterAI(dt, this.specRed, this.specBlue, host);
        this.updateSpectatorFighterAI(dt, this.specBlue, this.specRed, host);

        // Separate overlapping fighters gently
        const sepDx = this.specBlue.rig.root.position.x - this.specRed.rig.root.position.x;
        const sepDz = this.specBlue.rig.root.position.z - this.specRed.rig.root.position.z;
        const sepD = Math.hypot(sepDx, sepDz);
        if (sepD > 0.001 && sepD < 0.92) {
          const push = (0.92 - sepD) * 0.5;
          this.specRed.rig.root.position.x -= (sepDx / sepD) * push;
          this.specRed.rig.root.position.z -= (sepDz / sepD) * push;
          this.specBlue.rig.root.position.x += (sepDx / sepD) * push;
          this.specBlue.rig.root.position.z += (sepDz / sepD) * push;
        }

        if (this.specRed.hp <= 0 || this.specBlue.hp <= 0) {
          const winner: SpectatorActor = this.specRed.hp > 0 ? this.specRed : this.specBlue;
          const loser: SpectatorActor = this.specRed.hp > 0 ? this.specBlue : this.specRed;
          loser.rig.die("back");
          this.phase = "victory";
          this.finishTimer = 3.0;

          if (this.activeBet) {
            const cornerOk = this.activeBet.pickCorner === winner.corner;
            const koOk = !this.activeBet.quickKoProp || this.boutElapsed <= this.activeBet.koCutoffSec;
            const won = cornerOk && koOk;
            const payout = won ? this.activeBet.potentialPayout : 0;
            const bSave = recordFightPitBetResult(this.activeBet.wager, payout);
            this.pitBetWins = bSave.pitBetWins ?? this.pitBetWins;
            this.pitBetProfit = bSave.pitBetProfit ?? this.pitBetProfit;
            const title = won
              ? `BET WON! +$${payout.toLocaleString()}`
              : cornerOk
                ? "KO PROP MISSED"
                : `${winner.def.alias.toUpperCase()} WINS`;
            const detail = won
              ? `${winner.def.alias} KO'd ${loser.def.alias} in ${this.boutElapsed.toFixed(1)}s`
              : cornerOk
                ? `${winner.def.alias} won in ${this.boutElapsed.toFixed(1)}s (needed ≤${this.activeBet.koCutoffSec}s)`
                : `Lost $${this.activeBet.wager.toLocaleString()} wager`;
            this.lastSettlement = { won, title, detail, payout };
            this.bannerText = won
              ? `${winner.def.alias.toUpperCase()} KO! +$${payout.toLocaleString()}`
              : `${winner.def.alias.toUpperCase()} WINS BY KO`;
            callbacks.onBetSettled?.(won, title, detail, payout);
          } else {
            this.bannerText = `${winner.def.alias.toUpperCase()} WINS BY KO!`;
          }

          host.sfx.pitBell(true);
          host.sfx.crowdCheer();
          this.generateFightCard();
        }
      }
    } else if (this.phase === "victory" || this.phase === "defeat") {
      this.finishTimer -= dt;
      if (this.mode === "player" && this.opponent) this.opponent.update(dt);
      if (this.mode === "spectator") {
        this.specRed?.rig.update(dt, gy);
        this.specBlue?.rig.update(dt, gy);
      }
      if (this.finishTimer <= 0) {
        if (this.gateBar) this.gateBar.visible = false;
        this.cleanupBoutActors();
        this.activeBet = null;
        this.phase = "idle";
        this.bannerText = "";
      }
    }

    const redName = this.mode === "spectator" && this.specRed ? this.specRed.def.alias : "YOU";
    const redHp = this.mode === "spectator" && this.specRed ? Math.max(0, Math.round(this.specRed.hp)) : Math.max(0, Math.round(playerHp));
    const redMaxHp = this.mode === "spectator" && this.specRed ? this.specRed.maxHp : 100;
    const oppName =
      this.mode === "spectator" && this.specBlue
        ? this.specBlue.def.alias
        : tierDef.alias;
    const oppHp =
      this.mode === "spectator" && this.specBlue
        ? Math.max(0, Math.round(this.specBlue.hp))
        : this.opponent
          ? Math.max(0, Math.round(this.opponent.hp))
          : 0;
    const oppMaxHp =
      this.mode === "spectator" && this.specBlue ? this.specBlue.maxHp : tierDef.hp;

    return {
      active: this.phase !== "idle",
      mode: this.mode,
      phase: this.phase,
      tierIndex: this.activeTierIdx,
      tierTotal: FIGHT_PIT_TIERS.length,
      redName,
      redHp,
      redMaxHp,
      opponentName: oppName,
      opponentHp: oppHp,
      opponentMaxHp: oppMaxHp,
      purse: tierDef.purse,
      countdownSec: Math.max(0, Math.ceil(this.countdownTimer)),
      boutElapsedSec: this.boutElapsed,
      bannerText: this.bannerText,
      activeBet: this.activeBet,
      pitRank: this.pitRank,
      pitWins: this.pitWins,
      pitWinStreak: this.pitWinStreak,
    };
  }
}
