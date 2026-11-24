export interface EngineSimState {
  rpm: number;
  speed: number;
  speedKmh: number;
  gear: number;
  gearCount: number;
  redline: number;
  throttle: number;
  brake: number;
  boost?: number;
  load?: number;
  rpmNorm?: number;
  shiftPhase?: string;
  [key: string]: unknown;
}

export class EngineSim {
  constructor(audioContext?: AudioContext | null, opts?: Record<string, unknown>);
  running: boolean;
  physics: {
    speed: number;
    ww: number;
    r: number;
    [key: string]: unknown;
  };
  start(): Promise<void>;
  stop(): void;
  dispose(): void;
  update(dt: number): void;
  setThrottle(v: number): void;
  setBrake(v: number): void;
  setClutch(v: number): void;
  setAutoShift(on: boolean): void;
  setEngineType(id: string): void;
  setVehicle(id: string): void;
  setTurbo(on: boolean): void;
  setVolume(v: number): void;
  setPerspective(p: string): void;
  getState(): EngineSimState;
  getEvents(): Record<string, number>;
  loadPreset(source: unknown): boolean;
  getPreset(): Record<string, any>;
  setVehicleProfile(vehicle: Record<string, unknown>): unknown;
  setMix(partial: Record<string, number>): void;
  setTone(tone: { rumble?: number; brightness?: number; punch?: number }): unknown;
  setParam(path: string, value: number): number | null;
  static presets(): Record<string, Record<string, any>>;
}
