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
  private voices: SpeechSynthesisVoice[] = [];
  private voicesLoaded = false;
  private lastGlobalSpeechMs = -10_000;
  private lastPrioritySpeechMs = -10_000;
  private lastPriorityCategory: NpcVoiceCategory | null = null;
  private lineCursor = 0;
  lastSpoken: SpokenLine | null = null;
  muted = false;

  constructor() {
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      const load = () => {
        const all = window.speechSynthesis.getVoices();
        if (all.length > 0) {
          const en = all.filter((v) => v.lang.toLowerCase().startsWith("en"));
          this.voices = en.length > 0 ? en : all;
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
            const en = all.filter((v) => v.lang.toLowerCase().startsWith("en"));
            this.voices = en.length > 0 ? en : all;
            this.voicesLoaded = true;
          }
        }
        if (urgent) synth.cancel();
        if (!synth.speaking || urgent) {
          const utt = new SpeechSynthesisUtterance(text);
          if (this.voices.length > 0) {
            utt.voice = this.voices[Math.floor(voiceSeed * this.voices.length) % this.voices.length];
          }
          const isScream = category === "weapon_panic" || category === "body_witness" || category === "panic";
          utt.pitch = (isScream ? 1.12 : 0.86) + (voiceSeed % 1) * 0.34;
          utt.rate = isScream ? 1.18 : urgent ? 1.08 : 0.96 + ((voiceSeed * 7) % 1) * 0.14;
          utt.volume = vol;
          synth.speak(utt);
          usedTts = this.voices.length > 0;
        }
      } catch {
        usedTts = false;
      }
    }

    // Vocal cadence / scream cue fallback (and extra panic gasp on screams so reactions are always audible)
    if (!usedTts || category === "weapon_panic" || category === "body_witness") {
      this.playVocalCue(category, voiceSeed, vol * (usedTts ? 0.16 : 0.34));
    }

    return spoken;
  }

  speakCustom(roleId: string, speakerName: string, text: string): SpokenLine {
    const now = typeof performance !== "undefined" ? performance.now() : Date.now();
    const spoken: SpokenLine = { speaker: speakerName, text, category: "ambient", at: now };
    this.lastSpoken = spoken;
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      try {
        const synth = window.speechSynthesis;
        if (!synth.speaking) {
          const utt = new SpeechSynthesisUtterance(text);
          if (this.voices.length > 0) {
            const idx = Math.abs(roleId.charCodeAt(0) + speakerName.charCodeAt(0)) % this.voices.length;
            utt.voice = this.voices[idx];
          }
          utt.rate = 1.02;
          utt.volume = 0.65;
          synth.speak(utt);
        }
      } catch {
        // ignore speech synthesis blocked before interaction
      }
    }
    return spoken;
  }

  speakDispatch(stars: number, districtName: string, reason?: string): SpokenLine {
    const code = stars >= 4 ? "10-99 SWAT & Chopper authorized" : stars >= 2 ? "10-31 Code 3 intercept" : "10-15 suspect spotted";
    const text = reason
      ? `Dispatch to all units: ${reason} in ${districtName}. ${code}.`
      : `Dispatch: ${code} in ${districtName}, respond immediately.`;
    return this.speakCustom("police", "WPD Dispatch", text);
  }

  private playVocalCue(category: NpcVoiceCategory, seed: number, gainLevel: number): void {
    const ctx = this.ensureAudioCtx();
    if (!ctx) return;
    try {
      const now = ctx.currentTime;
      const isScream = category === "weapon_panic" || category === "body_witness" || category === "panic" || category === "hit";
      const baseFreq = (isScream ? 360 : 145) + (seed % 1) * 110;
      const syllables = isScream ? 3 : category === "near_miss" ? 3 : 2;
      for (let s = 0; s < syllables; s++) {
        const t0 = now + s * (isScream ? 0.095 : 0.11);
        const osc = ctx.createOscillator();
        const filt = ctx.createBiquadFilter();
        const g = ctx.createGain();
        osc.type = "sawtooth";
        osc.frequency.setValueAtTime(baseFreq * (s % 2 === 0 ? 1.08 : 1.24), t0);
        osc.frequency.exponentialRampToValueAtTime(baseFreq * (isScream ? 0.78 : 0.88), t0 + 0.09);
        filt.type = "bandpass";
        filt.frequency.value = isScream ? 1350 : 950;
        filt.Q.value = isScream ? 2.6 : 3.2;
        g.gain.setValueAtTime(0.0001, t0);
        g.gain.linearRampToValueAtTime(gainLevel, t0 + 0.015);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.095);
        osc.connect(filt).connect(g).connect(ctx.destination);
        osc.start(t0);
        osc.stop(t0 + 0.1);
      }
    } catch {
      // ignore audio context restrictions prior to user gesture
    }
  }
}
