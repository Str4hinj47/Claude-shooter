export interface RadioStationDef {
  id: string;
  name: string;
  genre: string;
  bpm: number;
  accent: string;
}

export const RADIO_STATIONS: readonly RadioStationDef[] = [
  { id: "westgate_fm", name: "WESTGATE FM", genre: "Sunset Synthwave", bpm: 112, accent: "#f472b6" },
  { id: "bayshore_rock", name: "BAYSHORE 96.1", genre: "West Coast Rock", bpm: 126, accent: "#fb923c" },
  { id: "pulse_104", name: "PULSE 104.5", genre: "Midnight Club", bpm: 124, accent: "#38bdf8" },
  { id: "cruiser_talk", name: "CRUISER TALK 98.4", genre: "City News & Chill", bpm: 92, accent: "#a3e635" },
  { id: "off", name: "RADIO OFF", genre: "Muted", bpm: 0, accent: "#64748b" },
];

const TALK_BULLETINS = [
  "Westgate Traffic: Heavy commuters along Civic Boulevard. Keep an eye on those signal phases.",
  "Bayshore Weather: Clear skies over Del Sol Pier, with light sea breezes moving inland.",
  "Police Scanner Alert: Westgate PD reminds drivers that speed traps are live on the Bay Bridge.",
  "You're listening to Cruiser Talk ninety-eight point four, the voice of Westgate Bay.",
  "Del Sol Ferris Wheel is running till midnight tonight down on the Ocean Pier.",
  "If your ride took a beating downtown, swing by Westgate Customs for an instant tune-up.",
];

/**
 * Procedural multi-station WebAudio car radio (zero external audio dependencies).
 */
export class CarRadioEngine {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private stationIdx = 0;
  private active = false;
  private muted = false;
  private step = 0;
  private nextStepTime = 0;
  private talkCooldown = 5.0;
  private talkIdx = 0;
  private noiseBuf: AudioBuffer | null = null;

  get currentStation(): RadioStationDef {
    return RADIO_STATIONS[this.stationIdx];
  }

  get stationIndex(): number {
    return this.stationIdx;
  }

  setAudioContext(ctx: AudioContext | null): void {
    if (!ctx || this.ctx === ctx) return;
    this.ctx = ctx;
    this.masterGain = ctx.createGain();
    this.masterGain.gain.value = 0.0;
    this.masterGain.connect(ctx.destination);

    const len = Math.floor(ctx.sampleRate * 0.12);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const ch = buf.getChannelData(0);
    for (let i = 0; i < len; i++) ch[i] = Math.random() * 2 - 1;
    this.noiseBuf = buf;
    this.nextStepTime = ctx.currentTime + 0.05;
  }

  setActive(active: boolean): void {
    this.active = active;
    if (this.ctx && this.masterGain) {
      const target = active && !this.muted && this.currentStation.id !== "off" ? 0.22 : 0.0001;
      this.masterGain.gain.setTargetAtTime(target, this.ctx.currentTime, 0.08);
      if (active) {
        this.nextStepTime = Math.max(this.nextStepTime, this.ctx.currentTime + 0.03);
      }
    }
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    this.setActive(this.active);
  }

  cycleStation(): RadioStationDef {
    this.stationIdx = (this.stationIdx + 1) % RADIO_STATIONS.length;
    this.step = 0;
    this.talkCooldown = 1.5;
    if (this.ctx && this.masterGain) {
      // Static burst on dial switch
      this.playStaticClick();
      const target = this.active && !this.muted && this.currentStation.id !== "off" ? 0.22 : 0.0001;
      this.masterGain.gain.setTargetAtTime(target, this.ctx.currentTime, 0.06);
      this.nextStepTime = this.ctx.currentTime + 0.08;
    }
    return this.currentStation;
  }

  private playStaticClick(): void {
    if (!this.ctx || !this.noiseBuf || !this.active || this.muted) return;
    const t = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const bp = this.ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = 2400;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.08, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.08);
    src.connect(bp).connect(g).connect(this.ctx.destination);
    src.start(t);
    src.stop(t + 0.09);
  }

  update(dt: number, wantedStars = 0): void {
    if (!this.active || this.muted || !this.ctx || !this.masterGain) return;
    const st = this.currentStation;
    if (st.id === "off" || st.bpm <= 0) return;

    const stepDur = 60 / st.bpm / 4; // 16th note
    const now = this.ctx.currentTime;
    if (this.nextStepTime < now - 0.25) this.nextStepTime = now + 0.02;

    while (this.nextStepTime < now + 0.14) {
      this.triggerStep(st.id, this.step, this.nextStepTime, stepDur);
      this.step = (this.step + 1) % 32;
      this.nextStepTime += stepDur;
    }

    if (st.id === "cruiser_talk") {
      this.talkCooldown -= dt;
      if (this.talkCooldown <= 0) {
        this.talkCooldown = 14;
        this.speakBulletin(wantedStars);
      }
    }
  }

  private speakBulletin(wantedStars: number): void {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
    try {
      const synth = window.speechSynthesis;
      if (synth.speaking) return;
      const line =
        wantedStars >= 2 && this.talkIdx % 2 === 0
          ? `Breaking news: Westgate PD units are in pursuit of a ${wantedStars}-star suspect across the bay.`
          : TALK_BULLETINS[this.talkIdx++ % TALK_BULLETINS.length];
      const utt = new SpeechSynthesisUtterance(line);
      utt.pitch = 0.92;
      utt.rate = 1.04;
      utt.volume = 0.65;
      synth.speak(utt);
    } catch {
      /* ignore */
    }
  }

  private triggerStep(stationId: string, step: number, t: number, stepDur: number): void {
    if (!this.ctx || !this.masterGain) return;
    const ctx = this.ctx;
    const out = this.masterGain;

    // Kick on 0, 4, 8, 12...
    const isKick =
      stationId === "bayshore_rock"
        ? step % 8 === 0 || step % 16 === 6 || step % 16 === 10
        : step % 4 === 0;
    if (isKick) {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(125, t);
      osc.frequency.exponentialRampToValueAtTime(42, t + 0.11);
      g.gain.setValueAtTime(0.45, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.14);
      osc.connect(g).connect(out);
      osc.start(t);
      osc.stop(t + 0.15);
    }

    // Snare on 4, 12
    if ((step % 8 === 4) && this.noiseBuf) {
      const src = ctx.createBufferSource();
      src.buffer = this.noiseBuf;
      const hp = ctx.createBiquadFilter();
      hp.type = "highpass";
      hp.frequency.value = 1100;
      const g = ctx.createGain();
      g.gain.setValueAtTime(stationId === "cruiser_talk" ? 0.08 : 0.22, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.11);
      src.connect(hp).connect(g).connect(out);
      src.start(t);
      src.stop(t + 0.12);
    }

    // Hat on offbeats
    if (step % 2 === 1 && this.noiseBuf && stationId !== "cruiser_talk") {
      const src = ctx.createBufferSource();
      src.buffer = this.noiseBuf;
      const hp = ctx.createBiquadFilter();
      hp.type = "highpass";
      hp.frequency.value = 6500;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.07, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.045);
      src.connect(hp).connect(g).connect(out);
      src.start(t);
      src.stop(t + 0.05);
    }

    // Melodic voice per station
    if (stationId === "westgate_fm") {
      const arp = [220, 261.6, 329.6, 392, 329.6, 261.6, 196, 261.6];
      const freq = arp[step % arp.length] * (step >= 16 ? 0.8909 : 1);
      const osc = ctx.createOscillator();
      const lp = ctx.createBiquadFilter();
      const g = ctx.createGain();
      osc.type = "sawtooth";
      osc.frequency.value = freq;
      lp.type = "lowpass";
      lp.frequency.setValueAtTime(1600, t);
      lp.frequency.exponentialRampToValueAtTime(420, t + stepDur * 0.9);
      g.gain.setValueAtTime(0.14, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + stepDur * 0.95);
      osc.connect(lp).connect(g).connect(out);
      osc.start(t);
      osc.stop(t + stepDur);
    } else if (stationId === "bayshore_rock" && step % 2 === 0) {
      const riffs = [110, 110, 130.8, 146.8, 110, 110, 164.8, 146.8];
      const freq = riffs[(step >> 1) % riffs.length];
      for (const mult of [1, 1.5]) {
        const osc = ctx.createOscillator();
        const lp = ctx.createBiquadFilter();
        const g = ctx.createGain();
        osc.type = "sawtooth";
        osc.frequency.value = freq * mult;
        lp.type = "lowpass";
        lp.frequency.value = 1850;
        g.gain.setValueAtTime(0.12, t);
        g.gain.exponentialRampToValueAtTime(0.001, t + stepDur * 1.7);
        osc.connect(lp).connect(g).connect(out);
        osc.start(t);
        osc.stop(t + stepDur * 1.8);
      }
    } else if (stationId === "pulse_104") {
      const bass = [65.4, 65.4, 77.8, 98.0];
      if (step % 2 === 1) {
        const osc = ctx.createOscillator();
        const g = ctx.createGain();
        osc.type = "triangle";
        osc.frequency.value = bass[(step >> 3) % bass.length];
        g.gain.setValueAtTime(0.24, t);
        g.gain.exponentialRampToValueAtTime(0.001, t + stepDur * 1.5);
        osc.connect(g).connect(out);
        osc.start(t);
        osc.stop(t + stepDur * 1.6);
      }
    } else if (stationId === "cruiser_talk" && step % 8 === 0) {
      const chords = [
        [261.6, 329.6, 392.0],
        [220.0, 261.6, 329.6],
      ];
      for (const freq of chords[(step >> 4) % chords.length]) {
        const osc = ctx.createOscillator();
        const g = ctx.createGain();
        osc.type = "sine";
        osc.frequency.value = freq;
        g.gain.setValueAtTime(0.06, t);
        g.gain.exponentialRampToValueAtTime(0.001, t + stepDur * 6);
        osc.connect(g).connect(out);
        osc.start(t);
        osc.stop(t + stepDur * 6.2);
      }
    }
  }
}
