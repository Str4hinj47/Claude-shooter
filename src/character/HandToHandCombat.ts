import type { CombatClipId } from "./CombatAnimations";

export type MeleeMoveId = "jab" | "cross" | "hook" | "uppercut" | "kick";

export type HandToHandState = "idle" | "attack" | "block" | "dodge" | "hitstun" | "knockdown";

export interface MeleeMoveDef {
  id: MeleeMoveId;
  label: string;
  clip: CombatClipId;
  /** Seconds before hitbox turns active */
  startup: number;
  /** Active hitbox window duration */
  active: number;
  /** Recovery seconds after active window */
  recovery: number;
  /** Earliest elapsed time when next combo strike can cancel recovery */
  cancelAt: number;
  damage: number;
  chipDamage: number;
  hitstun: number;
  blockstun: number;
  knockback: number;
  lungeSpeed: number;
  range: number;
  /** Minimum forward dot product (`cos(halfCone)`) */
  arcDot: number;
  /** Brief impact freeze duration in seconds */
  hitstopSec: number;
  guardBreak: boolean;
  fullBody: boolean;
  heavy: boolean;
  nextCombo?: MeleeMoveId;
}

export const MELEE_MOVES: Record<MeleeMoveId, MeleeMoveDef> = {
  jab: {
    id: "jab",
    label: "LEFT JAB",
    clip: "jab",
    startup: 0.08,
    active: 0.12,
    recovery: 0.16,
    cancelAt: 0.17,
    damage: 22,
    chipDamage: 4,
    hitstun: 0.34,
    blockstun: 0.16,
    knockback: 2.2,
    lungeSpeed: 3.4,
    range: 1.95,
    arcDot: 0.42,
    hitstopSec: 0.025,
    guardBreak: false,
    fullBody: false,
    heavy: false,
    nextCombo: "cross",
  },
  cross: {
    id: "cross",
    label: "RIGHT CROSS",
    clip: "cross",
    startup: 0.12,
    active: 0.13,
    recovery: 0.20,
    cancelAt: 0.22,
    damage: 30,
    chipDamage: 6,
    hitstun: 0.42,
    blockstun: 0.20,
    knockback: 3.4,
    lungeSpeed: 4.1,
    range: 2.1,
    arcDot: 0.42,
    hitstopSec: 0.036,
    guardBreak: false,
    fullBody: false,
    heavy: false,
    nextCombo: "hook",
  },
  hook: {
    id: "hook",
    label: "HEAVY HOOK",
    clip: "hook",
    startup: 0.16,
    active: 0.14,
    recovery: 0.24,
    cancelAt: 0.28,
    damage: 38,
    chipDamage: 8,
    hitstun: 0.52,
    blockstun: 0.25,
    knockback: 4.6,
    lungeSpeed: 4.4,
    range: 2.15,
    arcDot: 0.30,
    hitstopSec: 0.048,
    guardBreak: false,
    fullBody: false,
    heavy: true,
    nextCombo: "uppercut",
  },
  uppercut: {
    id: "uppercut",
    label: "UPPERCUT",
    clip: "uppercut",
    startup: 0.19,
    active: 0.15,
    recovery: 0.34,
    cancelAt: 0.65,
    damage: 54,
    chipDamage: 14,
    hitstun: 0.72,
    blockstun: 0.34,
    knockback: 7.2,
    lungeSpeed: 4.9,
    range: 2.05,
    arcDot: 0.38,
    hitstopSec: 0.068,
    guardBreak: true,
    fullBody: true,
    heavy: true,
  },
  kick: {
    id: "kick",
    label: "MMA KICK",
    clip: "kick",
    startup: 0.17,
    active: 0.15,
    recovery: 0.28,
    cancelAt: 0.55,
    damage: 44,
    chipDamage: 11,
    hitstun: 0.62,
    blockstun: 0.30,
    knockback: 7.8,
    lungeSpeed: 5.0,
    range: 2.35,
    arcDot: 0.45,
    hitstopSec: 0.056,
    guardBreak: true,
    fullBody: true,
    heavy: true,
  },
};

export interface IncomingMeleeResult {
  damageTaken: number;
  blocked: boolean;
  parried: boolean;
  guardBroken: boolean;
  hitstunTriggered: boolean;
}

export interface CombatVisualPose {
  clipId: CombatClipId | null;
  clipTimeNorm: number;
  upperWeight: number;
  lowerWeight: number;
  fistWeight: number;
  activeMove: MeleeMoveDef | null;
  attackProgress: number;
}

export class HandToHandController {
  state: HandToHandState = "idle";
  currentMove: MeleeMoveDef | null = null;
  stateTime = 0;
  stateDuration = 0;
  bufferedHeavy: boolean | null = null;
  hitDidConnect = false;

  /** Tracks combo chain step & display count */
  comboCount = 0;
  comboResetTimer = 0;

  /** Guard & parry timing */
  blocking = false;
  parryWindowTimer = 0;
  parryFlashTimer = 0;
  blockstunTimer = 0;

  /** Evasive slip / dodge */
  invulnTimer = 0;
  dodgeCooldown = 0;
  dodgeDirX = 0;
  dodgeDirZ = 0;

  /** Stance active timer (keeps fighter in boxing guard briefly after strikes/blocks) */
  combatStanceTimer = 0;
  private idleClock = 0;
  private blendWeight = 0;

  get isBusy(): boolean {
    return (
      this.state === "attack" ||
      this.state === "dodge" ||
      this.state === "hitstun" ||
      this.state === "knockdown"
    );
  }

  get canMoveFreely(): boolean {
    return this.state !== "hitstun" && this.state !== "knockdown";
  }

  get isInvulnerable(): boolean {
    return this.invulnTimer > 0;
  }

  get activeHitWindow(): MeleeMoveDef | null {
    if (this.state !== "attack" || !this.currentMove || this.hitDidConnect) return null;
    if (
      this.stateTime >= this.currentMove.startup &&
      this.stateTime <= this.currentMove.startup + this.currentMove.active
    ) {
      return this.currentMove;
    }
    return null;
  }

  reset() {
    this.state = "idle";
    this.currentMove = null;
    this.stateTime = 0;
    this.stateDuration = 0;
    this.bufferedHeavy = null;
    this.hitDidConnect = false;
    this.comboCount = 0;
    this.comboResetTimer = 0;
    this.blocking = false;
    this.parryWindowTimer = 0;
    this.parryFlashTimer = 0;
    this.blockstunTimer = 0;
    this.invulnTimer = 0;
    this.dodgeCooldown = 0;
    this.combatStanceTimer = 0;
    this.blendWeight = 0;
  }

  setBlocking(held: boolean) {
    if (held && !this.blocking) {
      this.parryWindowTimer = 0.24;
      this.combatStanceTimer = Math.max(this.combatStanceTimer, 2.2);
    }
    this.blocking = held;
    if (held && this.state === "idle") {
      this.state = "block";
      this.stateTime = 0;
    } else if (!held && this.state === "block" && this.blockstunTimer <= 0) {
      this.state = "idle";
      this.stateTime = 0;
    }
  }

  /**
   * Queue a light punch combo (`heavy = false`) or heavy kick (`heavy = true`).
   * Returns the triggered `MeleeMoveDef` immediately if an attack started now, or `null` if buffered.
   */
  requestAttack(heavy = false): MeleeMoveDef | null {
    if (this.state === "hitstun" || this.state === "knockdown" || this.state === "dodge") {
      return null;
    }
    if (this.state === "attack" && this.currentMove) {
      this.bufferedHeavy = heavy;
      return null;
    }
    const moveId: MeleeMoveId = heavy ? "kick" : "jab";
    return this.startMove(moveId);
  }

  triggerDodge(dirX: number, dirZ: number): boolean {
    if (
      this.dodgeCooldown > 0 ||
      this.state === "hitstun" ||
      this.state === "knockdown" ||
      this.state === "dodge"
    ) {
      return false;
    }
    const len = Math.hypot(dirX, dirZ);
    this.dodgeDirX = len > 0.05 ? dirX / len : 0;
    this.dodgeDirZ = len > 0.05 ? dirZ / len : -1;
    this.state = "dodge";
    this.currentMove = null;
    this.bufferedHeavy = null;
    this.stateTime = 0;
    this.stateDuration = 0.42;
    this.invulnTimer = 0.28;
    this.dodgeCooldown = 0.62;
    this.combatStanceTimer = Math.max(this.combatStanceTimer, 2.4);
    return true;
  }

  private startMove(moveId: MeleeMoveId): MeleeMoveDef {
    const move = MELEE_MOVES[moveId];
    this.state = "attack";
    this.currentMove = move;
    this.stateTime = 0;
    this.stateDuration = move.startup + move.active + move.recovery;
    this.bufferedHeavy = null;
    this.hitDidConnect = false;
    this.blocking = false;
    this.combatStanceTimer = Math.max(this.combatStanceTimer, 3.0);
    return move;
  }

  markHitConnected() {
    this.hitDidConnect = true;
    this.comboCount = Math.min(99, this.comboCount + 1);
    this.comboResetTimer = 2.4;
  }

  applyIncomingHit(
    rawDamage: number,
    hitstunSec: number,
    guardBreak = false,
    knockdown = false,
  ): IncomingMeleeResult {
    if (this.invulnTimer > 0) {
      return {
        damageTaken: 0,
        blocked: false,
        parried: false,
        guardBroken: false,
        hitstunTriggered: false,
      };
    }

    // Perfect Parry on fresh block press (unless unblockable? Parries beat even heavy kicks!)
    if (this.blocking && this.parryWindowTimer > 0) {
      this.parryFlashTimer = 0.65;
      this.parryWindowTimer = 0;
      this.combatStanceTimer = Math.max(this.combatStanceTimer, 3.0);
      return {
        damageTaken: 0,
        blocked: true,
        parried: true,
        guardBroken: false,
        hitstunTriggered: false,
      };
    }

    // Standard Block
    if (this.blocking && !guardBreak) {
      const chip = Math.max(2, Math.round(rawDamage * 0.25));
      this.blockstunTimer = 0.22;
      this.state = "block";
      this.combatStanceTimer = Math.max(this.combatStanceTimer, 2.5);
      return {
        damageTaken: chip,
        blocked: true,
        parried: false,
        guardBroken: false,
        hitstunTriggered: false,
      };
    }

    const guardBroken = this.blocking && guardBreak;
    this.blocking = false;
    this.currentMove = null;
    this.bufferedHeavy = null;
    this.stateTime = 0;
    if (knockdown) {
      this.state = "knockdown";
      this.stateDuration = 1.35;
    } else {
      this.state = "hitstun";
      this.stateDuration = Math.max(0.28, hitstunSec);
    }
    this.combatStanceTimer = Math.max(this.combatStanceTimer, 2.5);

    return {
      damageTaken: Math.round(rawDamage),
      blocked: false,
      parried: false,
      guardBroken,
      hitstunTriggered: true,
    };
  }

  /** Trigger pure stagger/knockdown externally (e.g. when an enemy gets parried or hit) */
  inflictStagger(duration = 0.85, knockdown = false) {
    this.blocking = false;
    this.currentMove = null;
    this.bufferedHeavy = null;
    this.stateTime = 0;
    this.state = knockdown ? "knockdown" : "hitstun";
    this.stateDuration = duration;
    this.combatStanceTimer = Math.max(this.combatStanceTimer, 2.5);
  }

  /**
   * Advance timers and return any combo-cancelled follow-up move that just started.
   */
  update(dt: number, unarmedActive: boolean): MeleeMoveDef | null {
    this.idleClock += dt;
    this.stateTime += dt;
    if (this.parryWindowTimer > 0) this.parryWindowTimer = Math.max(0, this.parryWindowTimer - dt);
    if (this.parryFlashTimer > 0) this.parryFlashTimer = Math.max(0, this.parryFlashTimer - dt);
    if (this.blockstunTimer > 0) this.blockstunTimer = Math.max(0, this.blockstunTimer - dt);
    if (this.invulnTimer > 0) this.invulnTimer = Math.max(0, this.invulnTimer - dt);
    if (this.dodgeCooldown > 0) this.dodgeCooldown = Math.max(0, this.dodgeCooldown - dt);
    if (this.combatStanceTimer > 0) this.combatStanceTimer = Math.max(0, this.combatStanceTimer - dt);

    if (this.comboResetTimer > 0) {
      this.comboResetTimer = Math.max(0, this.comboResetTimer - dt);
      if (this.comboResetTimer <= 0) this.comboCount = 0;
    }

    let startedComboMove: MeleeMoveDef | null = null;

    if (this.state === "attack" && this.currentMove) {
      if (this.bufferedHeavy !== null && this.stateTime >= this.currentMove.cancelAt) {
        const nextId: MeleeMoveId = this.bufferedHeavy
          ? "kick"
          : (this.currentMove.nextCombo ?? "jab");
        startedComboMove = this.startMove(nextId);
      } else if (this.stateTime >= this.stateDuration) {
        this.currentMove = null;
        this.stateTime = 0;
        this.state = this.blocking ? "block" : "idle";
      }
    } else if (this.state === "dodge" || this.state === "hitstun" || this.state === "knockdown") {
      if (this.stateTime >= this.stateDuration) {
        this.stateTime = 0;
        this.state = this.blocking ? "block" : "idle";
      }
    } else if (this.blocking) {
      this.state = "block";
    } else {
      this.state = "idle";
    }

    const wantOverlay =
      this.state !== "idle" || (unarmedActive && this.combatStanceTimer > 0);
    const rate = wantOverlay ? 18 : 7;
    const targetW = wantOverlay ? 1 : 0;
    this.blendWeight += (targetW - this.blendWeight) * (1 - Math.exp(-rate * dt));
    if (Math.abs(targetW - this.blendWeight) < 0.002) this.blendWeight = targetW;

    return startedComboMove;
  }

  getVisualPose(locoBlend: number, sprinting: boolean): CombatVisualPose {
    if (this.blendWeight <= 0.01) {
      return {
        clipId: null,
        clipTimeNorm: 0,
        upperWeight: 0,
        lowerWeight: 0,
        fistWeight: 0,
        activeMove: null,
        attackProgress: 0,
      };
    }

    if (this.state === "attack" && this.currentMove) {
      const m = this.currentMove;
      const u = Math.max(0, Math.min(1, this.stateTime / Math.max(0.05, this.stateDuration)));
      const attackWin =
        u < 0.12 ? u / 0.12 : u > 0.84 ? Math.max(0, (1 - u) / 0.16) : 1;
      const w = Math.max(this.blendWeight, attackWin);
      const standLower = m.fullBody ? w : w * (1 - Math.min(1, locoBlend * 1.4));
      return {
        clipId: m.clip,
        clipTimeNorm: u,
        upperWeight: w,
        lowerWeight: standLower,
        fistWeight: 1,
        activeMove: m,
        attackProgress: u,
      };
    }

    if (this.state === "dodge") {
      const u = Math.max(0, Math.min(1, this.stateTime / Math.max(0.05, this.stateDuration)));
      return {
        clipId: "dodge",
        clipTimeNorm: u,
        upperWeight: 1,
        lowerWeight: 1,
        fistWeight: 1,
        activeMove: null,
        attackProgress: 0,
      };
    }

    if (this.state === "hitstun") {
      const u = Math.max(0, Math.min(1, this.stateTime / Math.max(0.05, this.stateDuration)));
      const fade = u > 0.72 ? (1 - u) / 0.28 : 1;
      return {
        clipId: "hit",
        clipTimeNorm: u,
        upperWeight: fade,
        lowerWeight: fade * (1 - Math.min(1, locoBlend)),
        fistWeight: 0.6,
        activeMove: null,
        attackProgress: 0,
      };
    }

    if (this.state === "knockdown") {
      const u = Math.max(0, Math.min(1, this.stateTime / Math.max(0.05, this.stateDuration)));
      const fade = u > 0.8 ? (1 - u) / 0.2 : 1;
      return {
        clipId: "knockdown",
        clipTimeNorm: u,
        upperWeight: fade,
        lowerWeight: fade,
        fistWeight: 0.4,
        activeMove: null,
        attackProgress: 0,
      };
    }

    if (this.state === "block") {
      const u = (this.stateTime / 0.65) % 1;
      const lower = this.blendWeight * (1 - Math.min(1, locoBlend * 1.3));
      return {
        clipId: "block",
        clipTimeNorm: u,
        upperWeight: this.blendWeight * 0.96,
        lowerWeight: lower,
        fistWeight: 1,
        activeMove: null,
        attackProgress: 0,
      };
    }

    // Combat stance idle (boxing guard while standing or moving lightly after recent brawl)
    const stanceFade = sprinting ? 0.15 : 1;
    const upper = this.blendWeight * 0.88 * stanceFade;
    const lower = this.blendWeight * (1 - Math.min(1, locoBlend * 1.5)) * stanceFade;
    return {
      clipId: "fight_idle",
      clipTimeNorm: (this.idleClock / 2.33) % 1,
      upperWeight: upper,
      lowerWeight: lower,
      fistWeight: 0.95 * stanceFade,
      activeMove: null,
      attackProgress: 0,
    };
  }
}
