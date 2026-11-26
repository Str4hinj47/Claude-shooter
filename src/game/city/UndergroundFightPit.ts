import * as THREE from "three";
import { SoldierRig } from "../../character/SoldierRig";
import { buildFighterUrl, type FighterBuildOptions } from "../../character/ShirtlessFighter";
import { Enemy, type CombatHost } from "../Enemy";
import { characterUrl } from "../characters";
import { OPEN_WORLD_MISSION, type MissionDef } from "../story";
import type { BodyStatId } from "../bodyStats";
import { recordFightPitWin } from "../progression";
import type { TerrainHeightFn } from "./HeightSystem";

export interface FightPitTierDef {
  id: string;
  tier: number;
  name: string;
  alias: string;
  purse: number;
  hp: number;
  damageScale: number;
  aggroScale: number;
  fighter: FighterBuildOptions;
  xpRewards: Partial<Record<BodyStatId, number>>;
}

export const FIGHT_PIT_CENTER = {
  x: 722,
  z: 115,
  radius: 7.4,
  gateX: 714.6,
  gateZ: 115,
  promoterX: 711.0,
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

export interface FightPitHudState {
  active: boolean;
  phase: "idle" | "countdown" | "fighting" | "victory" | "defeat";
  tierIndex: number;
  tierTotal: number;
  opponentName: string;
  opponentHp: number;
  opponentMaxHp: number;
  purse: number;
  countdownSec: number;
  bannerText: string;
  pitRank: number;
  pitWins: number;
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

function makePitMatTexture(): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 512;
  c.height = 512;
  const g = c.getContext("2d")!;
  g.fillStyle = "#1c1917";
  g.fillRect(0, 0, 512, 512);
  g.strokeStyle = "#991b1b";
  g.lineWidth = 18;
  g.beginPath();
  g.arc(256, 256, 224, 0, Math.PI * 2);
  g.stroke();
  g.strokeStyle = "#f59e0b";
  g.lineWidth = 5;
  g.beginPath();
  g.arc(256, 256, 94, 0, Math.PI * 2);
  g.stroke();
  g.fillStyle = "rgba(185, 28, 28, 0.18)";
  g.beginPath();
  g.arc(256, 256, 90, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = "#e7e5e4";
  g.font = "900 40px system-ui, sans-serif";
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText("IRON PIT", 256, 244);
  g.fillStyle = "#f59e0b";
  g.font = "700 18px system-ui, sans-serif";
  g.fillText("WESTGATE UNDERGROUND", 256, 280);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function makePitSignTexture(): THREE.CanvasTexture {
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
  g.font = "700 22px system-ui, sans-serif";
  g.fillText("CASH PURSES · NO FIREARMS", 256, 98);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export class UndergroundFightPit {
  readonly group = new THREE.Group();
  readonly colliders: THREE.Object3D[] = [];
  readonly groundY: number;

  private gateBar!: THREE.Mesh;
  private promptRing!: THREE.Mesh;
  private promoterRig: SoldierRig | null = null;
  private spectators: { rig: SoldierRig; baseYaw: number; phase: number }[] = [];

  private phase: FightPitHudState["phase"] = "idle";
  private activeTierIdx = 0;
  private opponent: Enemy | null = null;
  private spawnPending = false;
  private countdownTimer = 0;
  private finishTimer = 0;
  private cheerPulse = 0;
  private bannerText = "";
  private pitRank = 0;
  private pitWins = 0;
  private prevOpponentHp = 0;

  constructor(terrainAt: TerrainHeightFn, initialRank = 0, initialWins = 0) {
    this.pitRank = initialRank;
    this.pitWins = initialWins;
    this.groundY = terrainAt(FIGHT_PIT_CENTER.x, FIGHT_PIT_CENTER.z);
    this.buildArenaGeometry();
    this.loadNpcActors();
  }

  private buildArenaGeometry() {
    const { x, z, radius, promoterX, promoterZ } = FIGHT_PIT_CENTER;
    const gy = this.groundY;

    const concreteMat = new THREE.MeshStandardMaterial({ color: 0x3f434a, roughness: 0.92, metalness: 0.05 });
    const steelMat = new THREE.MeshStandardMaterial({ color: 0x334155, roughness: 0.45, metalness: 0.78 });
    const cableMat = new THREE.MeshStandardMaterial({ color: 0xb91c1c, roughness: 0.4, metalness: 0.35 });
    const emberMat = new THREE.MeshStandardMaterial({
      color: 0xf97316,
      emissive: 0xea580c,
      emissiveIntensity: 2.0,
      roughness: 0.6,
    });

    // Concrete apron slab
    const slab = new THREE.Mesh(new THREE.BoxGeometry(19, 0.24, 19), concreteMat);
    slab.position.set(x, gy - 0.08, z);
    slab.receiveShadow = true;
    this.group.add(slab);

    // Octagon combat mat
    const mat = new THREE.Mesh(
      new THREE.CylinderGeometry(radius, radius + 0.18, 0.14, 8),
      new THREE.MeshStandardMaterial({ map: makePitMatTexture(), roughness: 0.82, metalness: 0.04 }),
    );
    mat.position.set(x, gy + 0.07, z);
    mat.receiveShadow = true;
    this.group.add(mat);

    // 8 Cage posts + rails (skip West entrance side at angle PI so player can walk in freely before bout)
    const sides = 8;
    const cornerPts: THREE.Vector3[] = [];
    for (let i = 0; i < sides; i++) {
      const a = (i / sides) * Math.PI * 2 + Math.PI / 8;
      const px = x + Math.cos(a) * radius;
      const pz = z + Math.sin(a) * radius;
      cornerPts.push(new THREE.Vector3(px, gy, pz));

      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.13, 2.35, 10), steelMat);
      post.position.set(px, gy + 1.18, pz);
      post.castShadow = true;
      this.group.add(post);
      this.colliders.push(post);
    }

    for (let i = 0; i < sides; i++) {
      const p1 = cornerPts[i];
      const p2 = cornerPts[(i + 1) % sides];
      const midX = (p1.x + p2.x) * 0.5;
      const midZ = (p1.z + p2.z) * 0.5;
      const segLen = p1.distanceTo(p2);
      const yaw = Math.atan2(p2.x - p1.x, p2.z - p1.z);
      // West-facing gate segment has midX < x - radius * 0.8
      const isGate = midX < x - radius * 0.8;

      if (isGate) {
        // Movable cage gate bar (hidden until bout starts)
        const gate = new THREE.Mesh(new THREE.BoxGeometry(0.14, 1.45, segLen), cableMat);
        gate.position.set(midX, gy + 1.15, midZ);
        gate.rotation.y = yaw;
        gate.visible = false;
        this.group.add(gate);
        this.gateBar = gate;
        continue;
      }

      for (const h of [0.65, 1.25, 1.85]) {
        const rail = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, segLen, 8), h === 1.85 ? steelMat : cableMat);
        rail.position.set(midX, gy + h, midZ);
        rail.rotation.order = "YXZ";
        rail.rotation.y = yaw;
        rail.rotation.x = Math.PI / 2;
        rail.castShadow = true;
        this.group.add(rail);
      }
      const wallCol = new THREE.Mesh(
        new THREE.BoxGeometry(0.35, 2.2, segLen),
        new THREE.MeshBasicMaterial({ visible: false }),
      );
      wallCol.position.set(midX, gy + 1.1, midZ);
      wallCol.rotation.y = yaw;
      this.group.add(wallCol);
      this.colliders.push(wallCol);
    }

    // 4 Corner halogen floodlight towers + East overhead sign
    for (const [dx, dz] of [[-8.4, -8.4], [8.4, -8.4], [-8.4, 8.4], [8.4, 8.4]]) {
      const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.12, 5.2, 8), steelMat);
      mast.position.set(x + dx, gy + 2.6, z + dz);
      mast.castShadow = true;
      this.group.add(mast);

      const lamp = new THREE.Mesh(
        new THREE.BoxGeometry(0.9, 0.42, 0.35),
        new THREE.MeshStandardMaterial({ color: 0xfef3c7, emissive: 0xfde047, emissiveIntensity: 2.2 }),
      );
      lamp.position.set(x + dx, gy + 5.15, z + dz);
      lamp.lookAt(x, gy + 1.2, z);
      this.group.add(lamp);
    }

    // Cage center light & East "IRON PIT" marquee sign
    const centerLight = new THREE.PointLight(0xffb454, 18, 24, 1.6);
    centerLight.position.set(x, gy + 5.2, z);
    this.group.add(centerLight);

    const signBack = new THREE.Mesh(new THREE.BoxGeometry(0.24, 1.35, 5.4), steelMat);
    signBack.position.set(x + 8.6, gy + 3.7, z);
    this.group.add(signBack);
    const signFace = new THREE.Mesh(
      new THREE.PlaneGeometry(5.2, 1.2),
      new THREE.MeshStandardMaterial({ map: makePitSignTexture(), emissive: 0x7c2d12, emissiveIntensity: 0.55 }),
    );
    signFace.position.set(x + 8.47, gy + 3.7, z);
    signFace.rotation.y = -Math.PI / 2;
    this.group.add(signFace);

    // Oil-drum fire barrels near the entrance
    for (const [bx, bz] of [[x - 9.2, z - 4.2], [x - 9.2, z + 5.4]]) {
      const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.38, 0.4, 1.02, 12), steelMat);
      barrel.position.set(bx, gy + 0.51, bz);
      barrel.castShadow = true;
      this.group.add(barrel);
      this.colliders.push(barrel);

      const fireTop = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.28, 0.14, 10), emberMat);
      fireTop.position.set(bx, gy + 1.0, bz);
      this.group.add(fireTop);
    }

    // Pulsing promoter interaction ring
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0xf59e0b,
      transparent: true,
      opacity: 0.72,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    this.promptRing = new THREE.Mesh(new THREE.RingGeometry(0.82, 1.08, 32), ringMat);
    this.promptRing.rotation.x = -Math.PI / 2;
    this.promptRing.position.set(promoterX, gy + 0.05, promoterZ - 0.6);
    this.group.add(this.promptRing);
  }

  private loadNpcActors() {
    if (typeof window === "undefined" || typeof fetch !== "function") return;
    const { x, z, promoterX, promoterZ } = FIGHT_PIT_CENTER;
    const gy = this.groundY;

    // Pit Promoter ("Viktor")
    void SoldierRig.load(this.group, undefined, characterUrl("business"))
      .then((rig) => {
        rig.setHolstered(true);
        rig.root.position.set(promoterX, gy, promoterZ);
        rig.aimYaw = -Math.PI * 0.35;
        this.group.add(rig.root);
        this.promoterRig = rig;
      })
      .catch(() => {});

    // 4 Spectator fighters around the octagon
    const specSpots: Array<[number, number, string]> = [
      [x + 1.8, z - 8.6, "civilian"],
      [x - 2.2, z + 8.6, "construction"],
      [x + 6.4, z + 6.2, buildFighterUrl({ outfit: "jeans", boots: true, hair: "short02", skinHex: "#b87a56", muscle: 0.65, weight: 0.05 })],
      [x + 6.4, z - 6.2, "sports"],
    ];
    specSpots.forEach(([sx, sz, tag], i) => {
      const url = tag.startsWith("fighter://") ? tag : characterUrl(tag);
      void SoldierRig.load(this.group, undefined, url)
        .then((rig) => {
          rig.setHolstered(true);
          rig.root.position.set(sx, gy, sz);
          const yaw = Math.atan2(x - sx, z - sz);
          rig.aimYaw = yaw;
          this.group.add(rig.root);
          this.spectators.push({ rig, baseYaw: yaw, phase: i * 1.7 });
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

  getPromptInfo(playerPos: THREE.Vector3): { near: boolean; text: string; tier: FightPitTierDef } {
    const tier = FIGHT_PIT_TIERS[this.getNextTierIndex()];
    const dPromoter = Math.hypot(
      playerPos.x - FIGHT_PIT_CENTER.promoterX,
      playerPos.z - (FIGHT_PIT_CENTER.promoterZ - 0.6),
    );
    const dGate = Math.hypot(playerPos.x - FIGHT_PIT_CENTER.gateX, playerPos.z - FIGHT_PIT_CENTER.gateZ);
    const near = Math.min(dPromoter, dGate) < 3.4;
    if (this.phase === "fighting" || this.phase === "countdown") {
      return {
        near: true,
        text: `[F] Forfeit Bout vs ${tier.alias}`,
        tier,
      };
    }
    const label =
      this.pitRank >= FIGHT_PIT_TIERS.length
        ? `[E] Championship Rematch — ${tier.alias} ($${tier.purse.toLocaleString()})`
        : `[E] Enter Pit Bout ${tier.tier}/${FIGHT_PIT_TIERS.length} — ${tier.alias} ($${tier.purse.toLocaleString()})`;
    return { near, text: label, tier };
  }

  async startBout(
    host: CombatHost,
    playerRig: SoldierRig,
    tierOverride?: number,
  ): Promise<boolean> {
    if (this.phase !== "idle" || this.spawnPending) return false;
    this.spawnPending = true;
    const tierIdx =
      tierOverride !== undefined
        ? Math.max(0, Math.min(FIGHT_PIT_TIERS.length - 1, tierOverride))
        : this.getNextTierIndex();
    const def = FIGHT_PIT_TIERS[tierIdx];
    this.activeTierIdx = tierIdx;

    // Clean any leftover previous opponent
    this.cleanupOpponent();

    const { x, z } = FIGHT_PIT_CENTER;
    const gy = this.groundY;

    // Place player inside West corner facing East
    playerRig.root.position.set(x - 4.0, gy, z);
    playerRig.aimYaw = Math.PI / 2;
    playerRig.setHolstered(true);

    // Close the steel gate
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
      this.prevOpponentHp = def.hp;
      this.bannerText = `BOUT ${def.tier}: ${def.alias.toUpperCase()}`;
      host.sfx.pitBell(false);
      return true;
    } catch {
      if (this.gateBar) this.gateBar.visible = false;
      return false;
    } finally {
      this.spawnPending = false;
    }
  }

  getActiveEnemy(): Enemy | null {
    return this.opponent && !this.opponent.isDead ? this.opponent : null;
  }

  forfeit(playerRig: SoldierRig): void {
    if (this.phase !== "countdown" && this.phase !== "fighting") return;
    this.cleanupOpponent();
    if (this.gateBar) this.gateBar.visible = false;
    this.phase = "idle";
    this.bannerText = "";
    playerRig.root.position.set(FIGHT_PIT_CENTER.exitX, this.groundY, FIGHT_PIT_CENTER.exitZ);
  }

  private cleanupOpponent() {
    if (this.opponent) {
      this.opponent.rig.root.removeFromParent();
      this.opponent = null;
    }
  }

  update(
    dt: number,
    elapsed: number,
    playerRig: SoldierRig,
    playerHp: number,
    host: CombatHost,
    callbacks: {
      onPurseWon: (def: FightPitTierDef) => void;
      onPlayerTko: () => void;
    },
  ): FightPitHudState {
    const gy = this.groundY;
    const { x, z, radius } = FIGHT_PIT_CENTER;

    // Animate promoter & idle ring pulse
    if (this.promptRing) {
      const s = 1 + Math.sin(elapsed * 3.4) * 0.08;
      this.promptRing.scale.set(s, s, 1);
      this.promptRing.visible = this.phase === "idle";
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

    // Clamp player & opponent inside octagon while bout is live
    if (this.phase === "countdown" || this.phase === "fighting") {
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
      clampInside(playerRig.root.position);
      if (this.opponent) clampInside(this.opponent.rig.root.position);
    }

    const tierDef = FIGHT_PIT_TIERS[this.activeTierIdx];

    if (this.phase === "countdown") {
      this.countdownTimer -= dt;
      if (this.opponent) {
        this.opponent.rig.aimYaw = Math.atan2(
          playerRig.root.position.x - this.opponent.rig.root.position.x,
          playerRig.root.position.z - this.opponent.rig.root.position.z,
        );
        this.opponent.rig.update(dt, gy);
      }
      const sec = Math.max(1, Math.ceil(this.countdownTimer));
      this.bannerText = this.countdownTimer <= 0.35 ? "FIGHT!" : `${tierDef.alias.toUpperCase()} — ${sec}`;
      if (this.countdownTimer <= 0) {
        this.phase = "fighting";
        this.bannerText = "BARE-KNUCKLE · NO WEAPONS";
        if (this.opponent) {
          this.opponent.alerted = true;
          this.opponent.state = "attack";
          this.opponent.lastSeen.copy(playerRig.root.position);
        }
        host.sfx.pitBell(true);
        host.sfx.crowdCheer();
      }
    } else if (this.phase === "fighting") {
      // Keep weapons holstered during the bout
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
          this.finishTimer = 2.6;
          this.bannerText = `KNOCKOUT! +$${tierDef.purse.toLocaleString()}`;
          const updated = recordFightPitWin(this.activeTierIdx, tierDef.purse);
          this.pitRank = updated.pitRank ?? this.pitRank;
          this.pitWins = updated.pitWins ?? this.pitWins;
          host.sfx.pitBell(true);
          host.sfx.crowdCheer();
          callbacks.onPurseWon(tierDef);
        } else if (playerHp <= 1) {
          this.phase = "defeat";
          this.finishTimer = 2.0;
          this.bannerText = "TKO — REFEREE STOPPED BOUT";
          host.sfx.pitBell(true);
          callbacks.onPlayerTko();
        }
      }
    } else if (this.phase === "victory" || this.phase === "defeat") {
      this.finishTimer -= dt;
      if (this.opponent) this.opponent.update(dt);
      if (this.finishTimer <= 0) {
        if (this.gateBar) this.gateBar.visible = false;
        this.cleanupOpponent();
        this.phase = "idle";
        this.bannerText = "";
      }
    }

    return {
      active: this.phase !== "idle",
      phase: this.phase,
      tierIndex: this.activeTierIdx,
      tierTotal: FIGHT_PIT_TIERS.length,
      opponentName: tierDef.alias,
      opponentHp: this.opponent ? Math.max(0, Math.round(this.opponent.hp)) : 0,
      opponentMaxHp: tierDef.hp,
      purse: tierDef.purse,
      countdownSec: Math.max(0, Math.ceil(this.countdownTimer)),
      bannerText: this.bannerText,
      pitRank: this.pitRank,
      pitWins: this.pitWins,
    };
  }
}
