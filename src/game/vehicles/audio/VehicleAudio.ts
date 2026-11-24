import { EngineSim, type EngineSimState } from "../vendor/engine-sim/engine-sim.js";
import type { CarId } from "../catalog";
import { ENGINE_PRESETS } from "./enginePresets";
import { signalAudioTransition } from "./signal-audio.mjs";

export interface EngineHud {
  rpm: number;
  gear: number;
  redline: number;
  boost: number;
}

export class VehicleAudio {
  private ctx: AudioContext | null = null;
  private sim: EngineSim | null = null;
  private effectsGain: GainNode | null = null;
  private scoreGain: GainNode | null = null;
  private indicatorGain: GainNode | null = null;
  private signal: "left" | "right" | null = null;
  private signalLit = false;
  private lastT = 0;
  private active = false;
  private pendingCar: CarId = "golf";
  private volume = 0.72;
  muted = false;
  scoreSounds = true;
  indicatorSounds = true;

  private ensure() {
    if (this.ctx || typeof window === "undefined") return;
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    this.ctx = new Ctx();
    const ctx = this.ctx;
    this.effectsGain = ctx.createGain();
    this.scoreGain = ctx.createGain();
    this.indicatorGain = ctx.createGain();
    this.effectsGain.connect(ctx.destination);
    this.scoreGain.connect(this.effectsGain);
    this.indicatorGain.connect(this.effectsGain);
    this.applyEffectVolume();

    const setup = ENGINE_PRESETS[this.pendingCar] ?? ENGINE_PRESETS.golf;
    this.sim = new EngineSim(ctx, {
      engine: setup.engine,
      vehicle: "sports",
      turbo: setup.turbo,
      volume: 0,
      perspective: "exterior",
      gearing: "stock",
    });
    this.applyPreset(this.pendingCar);
    this.sim.setAutoShift(true);
    this.applyVolume();
  }

  private applyPreset(id: CarId) {
    if (!this.sim) return;
    const setup = ENGINE_PRESETS[id] ?? ENGINE_PRESETS.golf;
    const presets = EngineSim.presets() as Record<string, Record<string, unknown>>;
    const base = presets[setup.engine];
    if (!base) return;
    const preset = {
      ...base,
      label: setup.label,
      engine: { ...(base.engine as Record<string, unknown>), ...setup.engineOverrides },
      turbo: { ...(base.turbo as Record<string, unknown>), enabled: setup.turbo ? 1 : 0, ...(setup.turboOverrides ?? {}) },
      mix: { ...(base.mix as Record<string, number>), ...(setup.mix ?? {}) },
      tone: { ...(base.tone as Record<string, number>), ...(setup.tone ?? {}) },
      position: 0,
      volume: 0,
    };
    this.sim.loadPreset(preset);
    this.sim.setVehicleProfile(setup.vehicle);
  }

  async unlock() {
    this.ensure();
    if (!this.ctx || !this.sim) return;
    if (this.ctx.state === "suspended") {
      try {
        await this.ctx.resume();
      } catch {
        return;
      }
    }
    if (!this.sim.running) {
      try {
        await this.sim.start();
      } catch (e) {
        console.warn("[VehicleAudio] engine sim start failed", e);
      }
    }
    this.lastT = performance.now() / 1000;
    this.applyVolume();
  }

  setCar(id: CarId) {
    this.pendingCar = id;
    if (!this.sim) return;
    this.applyPreset(id);
    this.applyVolume();
  }

  setActive(active: boolean) {
    this.active = active;
    if (!active) {
      this.signal = null;
      this.signalLit = false;
    }
    if (active) void this.unlock();
    this.applyVolume();
  }

  setPerspective(mode: "cabin" | "exterior") {
    this.sim?.setPerspective(mode);
  }

  private applyVolume() {
    if (!this.sim) return;
    this.sim.setVolume(this.active && !this.muted ? this.volume : 0);
  }

  setMuted(m: boolean) {
    this.muted = m;
    this.applyVolume();
    this.applyEffectVolume();
  }

  private applyEffectVolume() {
    if (!this.ctx) return;
    const set = (node: GainNode | null, enabled: boolean) => {
      if (!node) return;
      node.gain.cancelScheduledValues(this.ctx!.currentTime);
      node.gain.setValueAtTime(enabled ? 1 : 0, this.ctx!.currentTime);
    };
    set(this.effectsGain, !this.muted);
    set(this.scoreGain, this.scoreSounds);
    set(this.indicatorGain, this.indicatorSounds);
  }

  setSignal(side: "left" | "right" | null, lit: boolean) {
    const next = signalAudioTransition(this.signal, this.signalLit, side, lit, this.active);
    if (next.click) this.indicatorClick(next.click === "on");
    this.signal = next.side;
    this.signalLit = next.lit;
  }

  private indicatorClick(on: boolean) {
    if (!this.ctx || this.ctx.state !== "running" || this.muted || !this.indicatorSounds || !this.indicatorGain) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const duration = 0.036;
    const buffer = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * duration), ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / data.length, 3);
    const src = ctx.createBufferSource();
    const filter = ctx.createBiquadFilter();
    const gain = ctx.createGain();
    src.buffer = buffer;
    filter.type = "bandpass";
    filter.frequency.value = on ? 1500 : 1150;
    filter.Q.value = 0.9;
    gain.gain.setValueAtTime(0.16, t);
    src.connect(filter).connect(gain).connect(this.indicatorGain);
    src.start(t);
    this.blip(on ? 690 : 510, 0.035, "sine", 0.045, 0, this.indicatorGain);
  }

  engine(speed: number, throttle: number, brake: number): EngineHud | null {
    if (!this.sim || !this.ctx) return null;
    const now = performance.now() / 1000;
    const dt = Math.max(0.001, Math.min(0.05, now - this.lastT));
    this.lastT = now;

    if (this.active) {
      const phys = this.sim.physics as { r?: number; ww?: number } | undefined;
      if (phys && typeof phys.r === "number" && phys.r > 0.05 && "ww" in phys) {
        phys.ww = Math.abs(speed) / phys.r;
      }
      this.sim.setThrottle(throttle);
      this.sim.setBrake(brake);
    } else {
      this.sim.setThrottle(0);
      this.sim.setBrake(0.15);
    }
    this.sim.update(dt);
    const s: EngineSimState = this.sim.getState();
    return {
      rpm: s.rpm || 0,
      gear: s.gear || 0,
      redline: s.redline || 7000,
      boost: typeof s.boost === "number" ? s.boost : 0,
    };
  }

  private blip(freq: number, dur: number, type: OscillatorType, gain = 0.12, when = 0, output?: AudioNode) {
    if (!this.ctx || this.muted) return;
    const t = this.ctx.currentTime + when;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g).connect(output ?? this.effectsGain ?? this.ctx.destination);
    osc.start(t);
    osc.stop(t + dur + 0.05);
  }

  radarChime(beatTarget: boolean) {
    if (!this.scoreSounds || !this.scoreGain) return;
    this.blip(660, 0.12, "triangle", 0.1, 0, this.scoreGain);
    this.blip(beatTarget ? 990 : 880, 0.16, "triangle", 0.1, 0.07, this.scoreGain);
  }

  crash(intensity = 1) {
    if (!this.ctx || this.muted) return;
    const t = this.ctx.currentTime;
    const dur = 0.35;
    const buffer = this.ctx.createBuffer(1, Math.ceil(this.ctx.sampleRate * dur), this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / data.length, 2);
    }
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    const filter = this.ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 800;
    const g = this.ctx.createGain();
    g.gain.value = Math.min(0.35, 0.12 + intensity * 0.2);
    src.connect(filter).connect(g).connect(this.effectsGain ?? this.ctx.destination);
    src.start(t);
    this.blip(95, 0.25, "sawtooth", Math.min(0.16, 0.06 + intensity * 0.08));
  }

  dispose() {
    this.active = false;
    try {
      this.sim?.stop?.();
    } catch {
      /* ignore */
    }
    if (this.ctx && this.ctx.state !== "closed") {
      void this.ctx.close().catch(() => {});
    }
    this.ctx = null;
    this.sim = null;
  }
}
