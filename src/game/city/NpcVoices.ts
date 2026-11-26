export type NpcVoiceCategory =
  | "greeting"
  | "ambient"
  | "car_admire"
  | "honk"
  | "near_miss"
  | "bump"
  | "hit"
  | "panic"
  | "weapon_panic"
  | "body_witness"
  | "cop"
  | "carjack"
  | "robbery";

export interface SpokenLine {
  speaker: string;
  text: string;
  category: NpcVoiceCategory;
  at: number;
}

const VOICE_LINES: Record<NpcVoiceCategory, readonly string[]> = {
  greeting: [
    "Hey there, gorgeous day in Westgate Bay.",
    "Afternoon! Watch the traffic on Bayshore, it's packed.",
    "You heading down toward Del Sol Pier?",
    "Stay safe out there.",
    "Have a good one!",
    "Nice weather we're having down by the coast.",
    "If you're looking for fast cars, try the downtown lots.",
  ],
  ambient: [
    "Yeah, I'm crossing Legion Square right now, call you back.",
    "I swear these traffic lights take forever today.",
    "Did you see the Ferris wheel lit up on the pier?",
    "Rent in Midtown just keeps going up.",
    "Grabbing coffee before the afternoon rush.",
    "Wait till you see the sunset over West Coast.",
    "I left my keys at the garage again, unbelievable.",
    "Traffic's actually moving smoothly for once.",
  ],
  car_admire: [
    "Whoa, look at that ride!",
    "Clean paint job! What's under the hood?",
    "Now that's how you cruise Westgate Bay.",
    "Sweet wheels! Don't scratch it on the curbs.",
  ],
  honk: [
    "Hey, lay off the horn! I'm walking here!",
    "Alright, alright, I'm moving!",
    "Jeez, give me a second to clear the crosswalk!",
    "Relax! The light just turned!",
    "You scared the life out of me!",
  ],
  near_miss: [
    "Whoa! Watch where you're going!",
    "Are you crazy?! You almost hit me!",
    "Hey! Use your brakes, maniac!",
    "Slow down! This isn't a racetrack!",
    "Unbelievable! Learn how to drive!",
  ],
  bump: [
    "Hey, watch it!",
    "Excuse you!",
    "Whoa, easy there, pal.",
    "Watch where you're stepping!",
    "Seriously? Plenty of sidewalk here.",
  ],
  hit: [
    "Argh! Somebody call an ambulance!",
    "Ow! What the hell?!",
    "My leg! You hit me!",
    "Help! He just ran right into me!",
  ],
  panic: [
    "Shots fired! Get down!",
    "Oh god, everybody run!",
    "Someone call 911! Gunfire!",
    "Get out of here! Move, move!",
    "Take cover!",
  ],
  weapon_panic: [
    "Aaaah! He's got a gun!!",
    "Oh god, he's armed! Run!!",
    "Put that weapon away! Help!!",
    "Somebody call the cops, he has a gun!!",
    "Get back! He's carrying a firearm!",
  ],
  body_witness: [
    "Oh my god! That's a dead body!!",
    "Aaaah! Somebody help, he killed someone!!",
    "Murderer!! Call 911 right now!!",
    "Oh god, what did you do?! Stay away from me!!",
    "Police! He's carrying a corpse!!",
  ],
  cop: [
    "Keep the peace, citizen.",
    "Stay out of trouble on my beat.",
    "Watch your speed through the intersection.",
    "Everything looks quiet on Bayshore for now.",
    "Drop any hardware if you're walking near civilians.",
  ],
  carjack: [
    "Hey! That's my car! Stop!",
    "Whoa! Get out of my ride!",
    "Help! Somebody just stole my car!",
    "Are you kidding me?! My keys were in there!",
  ],
  robbery: [
    "Take the cash, just don't shoot!",
    "All right, register's open! Take it and go!",
    "Please! Take everything, leave me out of it!",
  ],
};

const ROLE_LABELS: Record<string, string> = {
  business: "Downtown Commuter",
  civilian: "Westgate Local",
  sports: "Bayshore Runner",
  delivery: "Express Courier",
  construction: "Site Worker",
  police: "Westgate PD Officer",
  security: "Private Security",
  firefighter: "Bay Fire & Rescue",
};

/**
 * Manages situational NPC voicelines, Web Speech synthesis with varied pitch/voices,
 * and lightweight WebAudio vocal-cue fallbacks.
 */
export class NpcVoiceSystem {
  private audioCtx: AudioContext | null = null;
  private radioAudio: HTMLAudioElement | null = null;
  private voices: SpeechSynthesisVoice[] = [];
  private voicesLoaded = false;
  private lastGlobalSpeechMs = -10_000;
  private lastPrioritySpeechMs = -10_000;
  private lastPriorityCategory: NpcVoiceCategory | null = null;
  private lineCursor = 0;
  lastSpoken: SpokenLine | null = null;
  muted = false;

  private pickNaturalVoices(all: SpeechSynthesisVoice[]): SpeechSynthesisVoice[] {
    const en = all.filter((v) => v.lang.toLowerCase().startsWith("en"));
    const pool = en.length > 0 ? en : all;
    const roboticRe = /espeak|mbrola|festival|flite|pico|rhvoice|robot/i;
    const naturalRe = /natural|neural|online|google|aria|jenny|guy|ryan|libby|sonia|samantha|daniel|alex|karen|serena|moira|tessa|ava|allison|claire|oliver|kate|marcus/i;
    const nonRobotic = pool.filter((v) => !roboticRe.test(v.name));
    const base = nonRobotic.length > 0 ? nonRobotic : pool;
    const naturalOnly = base.filter((v) => naturalRe.test(v.name));
    if (naturalOnly.length > 0) return naturalOnly;
    return [...base].sort((a, b) => {
      const aRemote = a.localService === false ? 1 : 0;
      const bRemote = b.localService === false ? 1 : 0;
      return bRemote - aRemote;
    });
  }

  constructor() {
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      const load = () => {
        const all = window.speechSynthesis.getVoices();
        if (all.length > 0) {
          this.voices = this.pickNaturalVoices(all);
          this.voicesLoaded = true;
        }
      };
      load();
      if (typeof window.speechSynthesis.addEventListener === "function") {
        window.speechSynthesis.addEventListener("voiceschanged", load);
      }
    }
  }

  private ensureAudioCtx(): AudioContext | null {
    if (typeof window === "undefined") return null;
    if (!this.audioCtx) {
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (AC) {
        try {
          this.audioCtx = new AC();
        } catch {
          this.audioCtx = null;
        }
      }
    }
    if (this.audioCtx && this.audioCtx.state === "suspended") {
      this.audioCtx.resume().catch(() => {});
    }
    return this.audioCtx;
  }

  getSpeakerLabel(roleId: string): string {
    return ROLE_LABELS[roleId] ?? "Westgate Resident";
  }

  speak(
    roleId: string,
    category: NpcVoiceCategory,
    voiceSeed: number,
    distMeters: number,
    urgent = false,
  ): SpokenLine | null {
    const nowMs = typeof performance !== "undefined" ? performance.now() : Date.now();
    if (!urgent && nowMs - this.lastGlobalSpeechMs < 4200) return null;
    const samePriorityCat = this.lastPriorityCategory === category;
    const minPriorityGap =
      category === "panic" || category === "weapon_panic" || category === "body_witness" || category === "hit" || category === "honk"
        ? samePriorityCat
          ? 700
          : 0
        : samePriorityCat
          ? 1300
          : 250;
    if (urgent && nowMs - this.lastPrioritySpeechMs < minPriorityGap) return null;

    const pool = VOICE_LINES[category];
    const idx = (Math.floor(voiceSeed * 97) + this.lineCursor++) % pool.length;
    const text = pool[idx];
    const speaker = this.getSpeakerLabel(roleId);

    this.lastGlobalSpeechMs = nowMs;
    if (urgent) {
      this.lastPrioritySpeechMs = nowMs;
      this.lastPriorityCategory = category;
    }

    const spoken: SpokenLine = { speaker, text, category, at: nowMs };
    this.lastSpoken = spoken;

    if (this.muted || distMeters > 34) return spoken;

    const vol = Math.max(0.18, Math.min(0.95, 1 - distMeters / 36));
    let usedTts = false;

    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      try {
        const synth = window.speechSynthesis;
        if (!this.voicesLoaded) {
          const all = synth.getVoices();
          if (all.length > 0) {
            this.voices = this.pickNaturalVoices(all);
            this.voicesLoaded = true;
          }
        }
        if (urgent) synth.cancel();
        if (!synth.speaking || urgent) {
          const utt = new SpeechSynthesisUtterance(text);
          if (this.voices.length > 0) {
            utt.voice = this.voices[Math.floor(voiceSeed * this.voices.length) % this.voices.length];
          }
          // Keep pitch and rate inside natural human conversational range (never robotic/chipmunk)
          const isScream = category === "weapon_panic" || category === "body_witness" || category === "panic";
          utt.pitch = (isScream ? 1.02 : 0.93) + (voiceSeed % 1) * 0.12;
          utt.rate = isScream ? 1.06 : urgent ? 1.02 : 0.95 + ((voiceSeed * 7) % 1) * 0.09;
          utt.volume = vol;
          synth.speak(utt);
          usedTts = this.voices.length > 0;
        }
      } catch {
        usedTts = false;
      }
    }

    // Only use soft organic breath/whisper cue when no real voice is available (never robotic sawtooth over TTS)
    if (!usedTts && (category === "weapon_panic" || category === "body_witness" || category === "hit")) {
      this.playVocalCue(category, voiceSeed, vol * 0.18);
    }

    return spoken;
  }

  speakCustom(roleId: string, speakerName: string, text: string): SpokenLine {
    const now = typeof performance !== "undefined" ? performance.now() : Date.now();
    const spoken: SpokenLine = { speaker: speakerName, text, category: "ambient", at: now };
    this.lastSpoken = spoken;
    if (!this.muted && typeof window !== "undefined" && "speechSynthesis" in window) {
      try {
        const synth = window.speechSynthesis;
        if (!this.voicesLoaded) {
          const all = synth.getVoices();
          if (all.length > 0) {
            this.voices = this.pickNaturalVoices(all);
            this.voicesLoaded = true;
          }
        }
        if (!synth.speaking) {
          const utt = new SpeechSynthesisUtterance(text);
          if (this.voices.length > 0) {
            const idx = Math.abs(roleId.charCodeAt(0) + speakerName.charCodeAt(0)) % this.voices.length;
            utt.voice = this.voices[idx];
          }
          utt.pitch = 0.98;
          utt.rate = 1.0;
          utt.volume = 0.65;
          synth.speak(utt);
        }
      } catch {
        // ignore speech synthesis blocked before interaction
      }
    }
    return spoken;
  }

  /** Tactical radio comms callout (soft radio squelch + natural voice without robotic synth tones) */
  speakRadio(speakerName: string, text: string): SpokenLine {
    if (!this.muted) this.playRadioSquelch();
    return this.speakCustom("security", speakerName, text);
  }

  /** Pre-generated consistent neural radio callout (Kokoro-82M) */
  speakRadioAudio(speakerName: string, text: string, audioUrl: string, volume = 0.72): SpokenLine {
    return this.speakVoiceAudio(speakerName, text, audioUrl, volume, true);
  }

  /** Pre-generated consistent neural character line (Kokoro-82M), optional radio squelch */
  speakVoiceAudio(
    speakerName: string,
    text: string,
    audioUrl: string,
    volume = 0.68,
    radioSquelch = false,
  ): SpokenLine {
    const now = typeof performance !== "undefined" ? performance.now() : Date.now();
    const spoken: SpokenLine = { speaker: speakerName, text, category: "ambient", at: now };
    this.lastSpoken = spoken;
    if (!this.muted && typeof window !== "undefined") {
      if (radioSquelch) this.playRadioSquelch();
      try {
        if (this.radioAudio && !this.radioAudio.paused && !this.radioAudio.ended) {
          this.radioAudio.pause();
        }
        const audio = new Audio(audioUrl);
        audio.volume = Math.max(0.15, Math.min(1.0, volume));
        audio.muted = this.muted;
        this.radioAudio = audio;
        audio.onended = () => {
          if (this.radioAudio === audio) this.radioAudio = null;
        };
        void audio.play().catch(() => {
          if (this.radioAudio === audio) this.radioAudio = null;
        });
      } catch {}
    }
    return spoken;
  }

  speakDispatch(stars: number, districtName: string, reason?: string): SpokenLine {
    const code = stars >= 4 ? "10-99 SWAT & Chopper authorized" : stars >= 2 ? "10-31 Code 3 intercept" : "10-15 suspect spotted";
    const text = reason
      ? `Dispatch to all units: ${reason} in ${districtName}. ${code}.`
      : `Dispatch: ${code} in ${districtName}, respond immediately.`;
    const isRobbery = Boolean(reason && reason.toLowerCase().includes("robbery"));
    const tier = Math.min(5, Math.max(1, Math.round(stars)));
    const audioUrl = isRobbery
      ? "/audio/comms/dispatch_robbery.mp3"
      : `/audio/comms/dispatch_star${tier}.mp3`;
    return this.speakRadioAudio("WPD Dispatch", text, audioUrl, 0.72);
  }

  stopRadio(): void {
    if (this.radioAudio) {
      try {
        this.radioAudio.pause();
        this.radioAudio.src = "";
      } catch {}
      this.radioAudio = null;
    }
  }

  private playRadioSquelch(): void {
    const ctx = this.ensureAudioCtx();
    if (!ctx) return;
    try {
      const len = Math.floor(ctx.sampleRate * 0.055);
      const buf = ctx.createBuffer(1, len, ctx.sampleRate);
      const ch = buf.getChannelData(0);
      for (let i = 0; i < len; i++) {
        const env = Math.sin((i / len) * Math.PI);
        ch[i] = (Math.random() * 2 - 1) * env * 0.14;
      }
      const src = ctx.createBufferSource();
      src.buffer = buf;
      const bp = ctx.createBiquadFilter();
      bp.type = "bandpass";
      bp.frequency.value = 1850;
      bp.Q.value = 1.8;
      const g = ctx.createGain();
      g.gain.value = 0.22;
      src.connect(bp).connect(g).connect(ctx.destination);
      src.start();
    } catch {
      // ignore audio context restrictions prior to user gesture
    }
  }

  private playVocalCue(category: NpcVoiceCategory, _seed: number, gainLevel: number): void {
    const ctx = this.ensureAudioCtx();
    if (!ctx) return;
    try {
      // Soft organic breath/gasp via pink-filtered noise (no robotic sawtooth oscillators)
      const dur = category === "hit" ? 0.11 : 0.16;
      const len = Math.max(1, Math.floor(ctx.sampleRate * dur));
      const buf = ctx.createBuffer(1, len, ctx.sampleRate);
      const ch = buf.getChannelData(0);
      let b0 = 0;
      for (let i = 0; i < len; i++) {
        const env = Math.sin((i / len) * Math.PI);
        b0 = 0.92 * b0 + (Math.random() * 2 - 1) * 0.08;
        ch[i] = b0 * env;
      }
      const src = ctx.createBufferSource();
      src.buffer = buf;
      const filt = ctx.createBiquadFilter();
      filt.type = "bandpass";
      filt.frequency.value = category === "hit" ? 620 : 880;
      filt.Q.value = 1.4;
      const g = ctx.createGain();
      g.gain.setValueAtTime(Math.max(0.0001, gainLevel), ctx.currentTime);
      src.connect(filt).connect(g).connect(ctx.destination);
      src.start();
    } catch {
      // ignore audio context restrictions prior to user gesture
    }
  }
}
