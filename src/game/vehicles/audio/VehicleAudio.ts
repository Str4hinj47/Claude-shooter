import { EngineSim, type EngineSimState } from "../vendor/engine-sim/engine-sim.js";
import type { CarId } from "../catalog";
import { ENGINE_PRESETS } from "./enginePresets";
import { signalAudioTransition } from "./signal-audio.mjs";
import { CarRadioEngine } from "./CarRadio";

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
  readonly radio = new CarRadioEngine();
  private sirenOsc: OscillatorNode | null = null;
  private sirenGain: GainNode | null = null;
  private sirenPhase = 0;
  private boatOsc: OscillatorNode | null = null;
  private boatGain: GainNode | null = null;
  private surfGain: GainNode | null = null;
  private windGain: GainNode | null = null;
  private windFilter: BiquadFilterNode | null = null;
  private slipGain: GainNode | null = null;
  private slipFilter: BiquadFilterNode | null = null;
  private airOsc: OscillatorNode | null = null;
  private airFilter: BiquadFilterNode | null = null;
  private airGain: GainNode | null = null;
  private airLfo: OscillatorNode | null = null;
  private airLfoGain: GainNode | null = null;
  private airWashGain: GainNode | null = null;
  private airWashFilter: BiquadFilterNode | null = null;
  private signal: "left" | "right" | null = null;
  private signalLit = false;
  private lastT = 0;
  private active = false;
  private pendingCar: CarId = "golf";
  private volume = 0.72;
  muted = false;
  scoreSounds = true;
  indicatorSounds =
    typeof window !== "undefined" ? window.localStorage?.getItem("overtake-indicator-sounds") !== "false" : true;

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
    this.radio.setAudioContext(ctx);

    // Subtle ocean surf noise bed for West Coast shoreline
    const surfBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const data = surfBuf.getChannelData(0);
    let lastOut = 0;
    for (let i = 0; i < data.length; i++) {
      const white = Math.random() * 2 - 1;
      lastOut = (lastOut + 0.03 * white) / 1.03;
      data[i] = lastOut * 2.5;
    }
    const surfSrc = ctx.createBufferSource();
    surfSrc.buffer = surfBuf;
    surfSrc.loop = true;
    const surfFilter = ctx.createBiquadFilter();
    surfFilter.type = "lowpass";
    surfFilter.frequency.value = 380;
    this.surfGain = ctx.createGain();
    this.surfGain.gain.value = 0.0;
    surfSrc.connect(surfFilter).connect(this.surfGain).connect(ctx.destination);
    surfSrc.start();

    // Wailing police siren oscillator (muted until police cruiser is pursuing or player siren is on)
    this.sirenOsc = ctx.createOscillator();
    this.sirenOsc.type = "triangle";
    this.sirenOsc.frequency.value = 640;
    const sirenFilter = ctx.createBiquadFilter();
    sirenFilter.type = "bandpass";
    sirenFilter.frequency.value = 1100;
    sirenFilter.Q.value = 1.6;
    this.sirenGain = ctx.createGain();
    this.sirenGain.gain.value = 0.0;
    this.sirenOsc.connect(sirenFilter).connect(this.sirenGain).connect(ctx.destination);
    this.sirenOsc.start();

    // Marine twin-stroke outboard motor hum for speedboats & starter skiff
    this.boatOsc = ctx.createOscillator();
    this.boatOsc.type = "sawtooth";
    this.boatOsc.frequency.value = 48;
    const boatFilter = ctx.createBiquadFilter();
    boatFilter.type = "lowpass";
    boatFilter.frequency.value = 240;
    this.boatGain = ctx.createGain();
    this.boatGain.gain.value = 0.0;
    this.boatOsc.connect(boatFilter).connect(this.boatGain).connect(ctx.destination);
    this.boatOsc.start();

    // High-altitude / high-speed aerodynamic wind rush bed
    const windSrc = ctx.createBufferSource();
    windSrc.buffer = surfBuf;
    windSrc.loop = true;
    this.windFilter = ctx.createBiquadFilter();
    this.windFilter.type = "bandpass";
    this.windFilter.frequency.value = 520;
    this.windFilter.Q.value = 0.85;
    this.windGain = ctx.createGain();
    this.windGain.gain.value = 0.0;
    windSrc.connect(this.windFilter).connect(this.windGain).connect(ctx.destination);
    windSrc.start();

    // Tire screech / wet hiss / snow slush slip sound
    const slipSrc = ctx.createBufferSource();
    slipSrc.buffer = surfBuf;
    slipSrc.loop = true;
    this.slipFilter = ctx.createBiquadFilter();
    this.slipFilter.type = "bandpass";
    this.slipFilter.frequency.value = 1350;
    this.slipFilter.Q.value = 3.6;
    this.slipGain = ctx.createGain();
    this.slipGain.gain.value = 0.0;
    slipSrc.connect(this.slipFilter).connect(this.slipGain).connect(ctx.destination);
    slipSrc.start();

    // Helicopter rotor chop + jet/propeller turbine audio
    this.airOsc = ctx.createOscillator();
    this.airOsc.type = "sawtooth";
    this.airOsc.frequency.value = 58;
    this.airFilter = ctx.createBiquadFilter();
    this.airFilter.type = "lowpass";
    this.airFilter.frequency.value = 260;
    this.airGain = ctx.createGain();
    this.airGain.gain.value = 0.0;

    this.airLfo = ctx.createOscillator();
    this.airLfo.type = "sine";
    this.airLfo.frequency.value = 14;
    this.airLfoGain = ctx.createGain();
    this.airLfoGain.gain.value = 0.0;
    this.airLfo.connect(this.airLfoGain).connect(this.airGain.gain);
    this.airOsc.connect(this.airFilter).connect(this.airGain).connect(ctx.destination);
    this.airOsc.start();
    this.airLfo.start();

    const airWashSrc = ctx.createBufferSource();
    airWashSrc.buffer = surfBuf;
    airWashSrc.loop = true;
    this.airWashFilter = ctx.createBiquadFilter();
    this.airWashFilter.type = "bandpass";
    this.airWashFilter.frequency.value = 420;
    this.airWashFilter.Q.value = 0.7;
    this.airWashGain = ctx.createGain();
    this.airWashGain.gain.value = 0.0;
    airWashSrc.connect(this.airWashFilter).connect(this.airWashGain).connect(ctx.destination);
    airWashSrc.start();

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
    this.radio.setActive(active);
    this.applyVolume();
  }

  setPerspective(mode: "cabin" | "exterior") {
    this.sim?.setPerspective(mode);
  }

  setVolume(v: number) {
    this.volume = Math.max(0, Math.min(1, v));
    this.applyVolume();
    this.applyEffectVolume();
  }

  private applyVolume() {
    if (!this.sim) return;
    this.sim.setVolume(this.active && !this.muted ? this.volume : 0);
  }

  setMuted(m: boolean) {
    this.muted = m;
    this.radio.setMuted(m);
    this.applyVolume();
    this.applyEffectVolume();
  }

  setIndicatorSounds(enabled: boolean) {
    this.indicatorSounds = enabled;
    if (typeof window !== "undefined") {
      try {
        window.localStorage?.setItem("overtake-indicator-sounds", String(enabled));
      } catch {
        /* ignore */
      }
    }
    this.applyEffectVolume();
  }

  private applyEffectVolume() {
    if (!this.ctx) return;
    const scale = Math.max(0, Math.min(1.25, this.volume / 0.72));
    const set = (node: GainNode | null, enabled: boolean) => {
      if (!node) return;
      node.gain.cancelScheduledValues(this.ctx!.currentTime);
      node.gain.setValueAtTime(enabled ? scale : 0, this.ctx!.currentTime);
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

  horn(duration = 0.28) {
    if (!this.ctx || this.muted) return;
    const t = this.ctx.currentTime;
    const filter = this.ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 1650;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.16, t + 0.015);
    g.gain.setValueAtTime(0.15, t + Math.max(0.04, duration - 0.04));
    g.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    filter.connect(g).connect(this.effectsGain ?? this.ctx.destination);

    for (const freq of [392.0, 493.88]) {
      const osc = this.ctx.createOscillator();
      osc.type = "sawtooth";
      osc.frequency.value = freq;
      osc.connect(filter);
      osc.start(t);
      osc.stop(t + duration + 0.04);
    }
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

  updateBoat(active: boolean, speed: number, throttle: number) {
    if (!this.ctx || !this.boatOsc || !this.boatGain) return;
    const now = this.ctx.currentTime;
    if (!active || this.muted) {
      this.boatGain.gain.setTargetAtTime(0.0, now, 0.08);
      return;
    }
    const absSpd = Math.abs(speed);
    const freq = 46 + absSpd * 3.6 + Math.abs(throttle) * 18;
    const vol = Math.min(0.16, 0.038 + absSpd * 0.004 + Math.abs(throttle) * 0.03);
    this.boatOsc.frequency.setTargetAtTime(freq, now, 0.06);
    this.boatGain.gain.setTargetAtTime(vol, now, 0.08);
  }

  updateTireSlip(slipLevel: number, isSnow: boolean, isWet: boolean) {
    if (!this.ctx || !this.slipGain || !this.slipFilter) return;
    const now = this.ctx.currentTime;
    const s = this.muted ? 0 : Math.max(0, Math.min(1, slipLevel));
    if (s < 0.05) {
      this.slipGain.gain.setTargetAtTime(0.0, now, 0.06);
      return;
    }
    const freq = isSnow ? 640 : isWet ? 1850 : 1320;
    const q = isSnow ? 1.1 : isWet ? 1.8 : 4.2;
    this.slipFilter.frequency.setTargetAtTime(freq + s * 180, now, 0.05);
    this.slipFilter.Q.setTargetAtTime(q, now, 0.05);
    this.slipGain.gain.setTargetAtTime(s * (isSnow ? 0.1 : 0.14), now, 0.04);
  }

  updateAircraft(active: boolean, kind: "helicopter" | "airplane", rotorPower: number, speed: number) {
    if (!this.ctx || !this.airOsc || !this.airFilter || !this.airGain || !this.airLfo || !this.airLfoGain || !this.airWashGain || !this.airWashFilter) {
      return;
    }
    const now = this.ctx.currentTime;
    if (!active || this.muted) {
      this.airGain.gain.setTargetAtTime(0.0, now, 0.1);
      this.airLfoGain.gain.setTargetAtTime(0.0, now, 0.08);
      this.airWashGain.gain.setTargetAtTime(0.0, now, 0.1);
      return;
    }
    const pwr = Math.max(0, Math.min(1.2, rotorPower));
    const spd = Math.abs(speed);
    if (kind === "helicopter") {
      this.airOsc.frequency.setTargetAtTime(48 + pwr * 26 + spd * 0.35, now, 0.08);
      this.airFilter.frequency.setTargetAtTime(220 + pwr * 180, now, 0.08);
      this.airGain.gain.setTargetAtTime(0.04 + pwr * 0.07, now, 0.08);
      this.airLfo.frequency.setTargetAtTime(10 + pwr * 8.5, now, 0.08);
      this.airLfoGain.gain.setTargetAtTime(0.02 + pwr * 0.042, now, 0.08);
      this.airWashFilter.frequency.setTargetAtTime(280 + pwr * 240, now, 0.1);
      this.airWashGain.gain.setTargetAtTime(0.03 + pwr * 0.055, now, 0.1);
    } else {
      const spdNorm = Math.min(1, spd / 60);
      this.airOsc.frequency.setTargetAtTime(115 + pwr * 165 + spdNorm * 95, now, 0.08);
      this.airFilter.frequency.setTargetAtTime(520 + pwr * 560, now, 0.08);
      this.airGain.gain.setTargetAtTime(0.025 + pwr * 0.055, now, 0.08);
      this.airLfoGain.gain.setTargetAtTime(0.0, now, 0.05);
      this.airWashFilter.frequency.setTargetAtTime(520 + spdNorm * 820, now, 0.1);
      this.airWashGain.gain.setTargetAtTime(0.035 + spdNorm * 0.085, now, 0.1);
    }
  }

  updateAmbience(dt: number, x: number, _z: number, sirenLevel: number, wantedStars: number, altitude = 0, speed = 0) {
    this.radio.update(dt, wantedStars);
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    if (this.surfGain) {
      // Audible along West Coast shoreline (x < -560)
      const coastMix = this.muted ? 0 : Math.max(0, Math.min(1, (-560 - x) / 220));
      const swell = 0.75 + 0.25 * Math.sin(now * 0.45);
      this.surfGain.gain.setTargetAtTime(coastMix * 0.085 * swell, now, 0.25);
    }
    if (this.windGain && this.windFilter) {
      const altMix = Math.max(0, Math.min(1, (altitude - 18) / 48));
      const spdMix = Math.max(0, Math.min(1, (Math.abs(speed) - 24) / 36));
      const windLevel = this.muted ? 0 : Math.max(altMix * 0.85, spdMix * 0.65);
      this.windFilter.frequency.setTargetAtTime(380 + windLevel * 720, now, 0.15);
      this.windGain.gain.setTargetAtTime(windLevel * 0.09, now, 0.2);
    }
    if (this.sirenOsc && this.sirenGain) {
      if (sirenLevel > 0.02 && !this.muted) {
        this.sirenPhase += dt * 3.1;
        const sweep = 0.5 + 0.5 * Math.sin(this.sirenPhase);
        this.sirenOsc.frequency.setTargetAtTime(590 + sweep * 560, now, 0.04);
        this.sirenGain.gain.setTargetAtTime(Math.min(0.11, sirenLevel * 0.095), now, 0.06);
      } else {
        this.sirenGain.gain.setTargetAtTime(0.0, now, 0.08);
      }
    }
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
