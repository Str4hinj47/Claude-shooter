import type * as THREE from "three";
import { getLauncherProfile, type GraphicsPresetId, type GraphicsProfileSpec } from "../game/launcherConfig";

export type EngineJobPriority = 0 | 1 | 2 | 3; // 0 = CRITICAL, 1 = HIGH (chunks/compounds), 2 = NORMAL (GLB upgrades), 3 = LOW

export interface EngineJob {
  key?: string;
  priority: EngineJobPriority;
  label: string;
  run: () => void;
}

export type VramPressureState = "nominal" | "elevated" | "critical";

export interface EngineTelemetrySnapshot {
  engineName: string;
  profileId: GraphicsPresetId;
  fps: number;
  frameMs: number;
  cpuMs: number;
  budgetMs: number;
  dpr: number;
  drawCalls: number;
  triangles: number;
  textures: number;
  geometries: number;
  programs: number;
  queuedJobs: number;
  executedJobsTotal: number;
  vramPressure: VramPressureState;
}

/**
 * Priority-lane, millisecond-budgeted job scheduler modeled after open-world streaming engines.
 * Prevents main-thread frame freezes and browser tab crashes during world hydration.
 */
export class EngineJobScheduler {
  private readonly lanes: [EngineJob[], EngineJob[], EngineJob[], EngineJob[]] = [[], [], [], []];
  private readonly pendingKeys = new Set<string>();
  executedTotal = 0;

  enqueue(job: EngineJob): boolean {
    if (job.key) {
      if (this.pendingKeys.has(job.key)) return false;
      this.pendingKeys.add(job.key);
    }
    this.lanes[job.priority].push(job);
    return true;
  }

  get size(): number {
    return this.lanes[0].length + this.lanes[1].length + this.lanes[2].length + this.lanes[3].length;
  }

  clear(): void {
    this.lanes[0].length = 0;
    this.lanes[1].length = 0;
    this.lanes[2].length = 0;
    this.lanes[3].length = 0;
    this.pendingKeys.clear();
  }

  private popNext(): EngineJob | undefined {
    for (let p = 0; p < 4; p++) {
      const lane = this.lanes[p];
      if (lane.length > 0) {
        const job = lane.shift()!;
        if (job.key) this.pendingKeys.delete(job.key);
        return job;
      }
    }
    return undefined;
  }

  /**
   * Executes queued streaming/hydration jobs up to `budgetMs` per frame.
   * Always runs at least 1 job if `allowMinimumOne` is true so progress never stalls.
   */
  drain(budgetMs: number, allowMinimumOne = true): number {
    if (this.size === 0) return 0;
    const t0 = typeof performance !== "undefined" ? performance.now() : Date.now();
    let ran = 0;
    while (this.size > 0) {
      if (ran > 0 || !allowMinimumOne) {
        const now = typeof performance !== "undefined" ? performance.now() : Date.now();
        if (now - t0 >= budgetMs) break;
      }
      const job = this.popNext();
      if (!job) break;
      try {
        job.run();
      } catch {
        // Isolate non-critical streaming failures from crashing the frame loop
      }
      ran++;
      this.executedTotal++;
    }
    return ran;
  }
}

/**
 * Custom Westgate Engine Core (RAGE-inspired frame pacer, VRAM governor, and streaming scheduler).
 * Coordinates CPU/GPU budgets across textures, chunk streaming, GLB upgrades, and adaptive DPR.
 */
export class WestgateEngineCore {
  readonly jobs = new EngineJobScheduler();

  private profile: GraphicsProfileSpec = getLauncherProfile();
  private emaFrameMs = 16.6;
  private emaCpuMs = 4.0;
  private frameStartMs = 0;
  private currentDpr = 1.0;
  private dprCooldown = 0;
  private vramPressure: VramPressureState = "nominal";

  private lastDrawCalls = 0;
  private lastTriangles = 0;
  private lastTextures = 0;
  private lastGeometries = 0;
  private lastPrograms = 0;

  refreshProfile(): GraphicsProfileSpec {
    this.profile = getLauncherProfile();
    this.currentDpr = Math.min(
      typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1,
      this.profile.maxDpr,
    );
    return this.profile;
  }

  get activeProfile(): GraphicsProfileSpec {
    return this.profile;
  }

  /** Facade texture atlas size scaled to active engine profile (cuts facade VRAM by up to 94% in Safe Mode). */
  getFacadeTexSize(): number {
    if (typeof document === "undefined") return 128;
    if (this.profile.id === "safe") return 256;
    if (this.profile.id === "balanced") return 512;
    return 1024;
  }

  /** Procedural surface texture resolution scaled to active engine profile. */
  getSurfaceTexSize(): number {
    if (typeof document === "undefined") return 128;
    if (this.profile.id === "safe") return 256;
    return 512;
  }

  /** Global anisotropy ceiling enforced across procedural & GLB textures. */
  getMaxAnisotropy(): number {
    return this.profile.maxAnisotropy;
  }

  /** Whether external 1K CC0 ambientCG architectural texture upgrades should stream in. */
  allowExternalArchPbr(): boolean {
    return this.profile.id !== "safe" && this.vramPressure !== "critical";
  }

  /** Maximum distance (meters) from player where chunk static meshes cast shadows. */
  getShadowCasterRadius(): number {
    if (!this.profile.shadowsEnabled) return 0;
    if (this.vramPressure === "critical") return 120;
    if (this.profile.id === "safe") return 140;
    if (this.profile.id === "balanced") return 190;
    return 240;
  }

  /** Frame-time millisecond budget allocated to background streaming jobs. */
  getJobBudgetMs(): number {
    if (this.vramPressure === "critical") return 2.5;
    if (this.profile.id === "safe") return 4.5;
    if (this.profile.id === "balanced") return 7.0;
    return 10.0;
  }

  getRecommendedDpr(): number {
    return this.currentDpr;
  }

  getPressure(): VramPressureState {
    return this.vramPressure;
  }

  beginFrame(rawDtSec: number, renderer?: THREE.WebGLRenderer): void {
    this.frameStartMs = typeof performance !== "undefined" ? performance.now() : Date.now();
    const frameMs = Math.max(4, Math.min(100, rawDtSec * 1000));
    this.emaFrameMs = this.emaFrameMs * 0.9 + frameMs * 0.1;

    // Drain budgeted streaming jobs (chunks, compounds, GLB upgrades) cleanly inside frame budget
    this.jobs.drain(this.getJobBudgetMs(), true);

    if (renderer) {
      this.dprCooldown = Math.max(0, this.dprCooldown - rawDtSec);
      const nativeDpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
      const maxDpr = Math.min(nativeDpr, this.profile.maxDpr);
      const minDpr = this.profile.id === "safe" ? 0.72 : 0.85;

      // Adaptive DPR scaler to keep frame times responsive without oscillation
      if (this.dprCooldown <= 0) {
        if (this.emaFrameMs > 26 && this.currentDpr > minDpr) {
          this.currentDpr = Math.max(minDpr, +(this.currentDpr - 0.1).toFixed(2));
          renderer.setPixelRatio(this.currentDpr);
          this.dprCooldown = 1.5;
        } else if (this.emaFrameMs < 15.5 && this.currentDpr < maxDpr && this.vramPressure === "nominal") {
          this.currentDpr = Math.min(maxDpr, +(this.currentDpr + 0.05).toFixed(2));
          renderer.setPixelRatio(this.currentDpr);
          this.dprCooldown = 3.0;
        }
      }
    }
  }

  endFrame(renderer?: THREE.WebGLRenderer): void {
    const now = typeof performance !== "undefined" ? performance.now() : Date.now();
    const cpuMs = Math.max(0.1, now - this.frameStartMs);
    this.emaCpuMs = this.emaCpuMs * 0.88 + cpuMs * 0.12;

    if (renderer) {
      this.lastDrawCalls = renderer.info.render.calls;
      this.lastTriangles = renderer.info.render.triangles;
      this.lastTextures = renderer.info.memory.textures;
      this.lastGeometries = renderer.info.memory.geometries;
      this.lastPrograms = renderer.info.programs?.length ?? 0;

      const texLimit = this.profile.id === "safe" ? 180 : this.profile.id === "balanced" ? 320 : 520;
      if (this.lastTextures > texLimit * 1.25 || this.emaFrameMs > 36) {
        this.vramPressure = "critical";
      } else if (this.lastTextures > texLimit * 0.9 || this.emaFrameMs > 24) {
        this.vramPressure = "elevated";
      } else {
        this.vramPressure = "nominal";
      }
    }
  }

  resetSession(): void {
    this.jobs.clear();
    this.refreshProfile();
    this.vramPressure = "nominal";
    this.emaFrameMs = 16.6;
    this.emaCpuMs = 4.0;
  }

  getTelemetry(): EngineTelemetrySnapshot {
    const fps = this.emaFrameMs > 0.1 ? Math.round(1000 / this.emaFrameMs) : 60;
    return {
      engineName: "Westgate Core Engine",
      profileId: this.profile.id,
      fps,
      frameMs: +this.emaFrameMs.toFixed(1),
      cpuMs: +this.emaCpuMs.toFixed(1),
      budgetMs: +this.getJobBudgetMs().toFixed(1),
      dpr: +this.currentDpr.toFixed(2),
      drawCalls: this.lastDrawCalls,
      triangles: this.lastTriangles,
      textures: this.lastTextures,
      geometries: this.lastGeometries,
      programs: this.lastPrograms,
      queuedJobs: this.jobs.size,
      executedJobsTotal: this.jobs.executedTotal,
      vramPressure: this.vramPressure,
    };
  }
}

export const westgateEngine = new WestgateEngineCore();
