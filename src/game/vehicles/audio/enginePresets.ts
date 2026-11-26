import type { CarId } from "../catalog";

export interface EnginePreset {
  engine: string;
  label: string;
  turbo: boolean;
  engineOverrides: Record<string, unknown>;
  turboOverrides?: Record<string, unknown>;
  vehicle: Record<string, unknown>;
  mix?: Record<string, number>;
  tone?: { rumble?: number; brightness?: number; punch?: number };
}

export const ENGINE_PRESETS: Record<CarId, EnginePreset> = {
  // VW Golf MK4 GTI: 1.8T 20v EA113 turbo inline-4, 235 Nm @ 1950 rpm.
  golf: {
    engine: "i4",
    label: "Golf MK4 GTI 1.8T 20v",
    turbo: true,
    engineOverrides: {
      idleRpm: 850, redlineRpm: 6500, peakTorque: 235, peakTorqueRpm: 1950,
      gears: 6, engineInertia: 0.17, gasTempFactor: 1.28,
      exhaust: { bank: 1.20, collector: 0.95, reflection: 0.50, damping: 0.46, muffler: [0.28, 0.18, 0.11] },
      intake: { helmholtz: 125, q: 5.5, level: 0.34 },
    },
    turboOverrides: { maxBoost: 0.9, boostRpm: 2200, inertia: 0.35, bov: 0.35 },
    vehicle: {
      label: "MK4 GTI hatch", mass: 1279, wheelRadius: 0.31, finalDrive: 4.05,
      gearRatios: [3.31, 2.13, 1.48, 1.14, 0.95, 0.82],
      dragArea: 0.68, rollingResistance: 0.014, brakeForce: 9500,
      gearbox: "manual", shiftTimeMs: 130, gearTeeth: [37, 31, 27, 24, 22, 20],
    },
    mix: { exhaust: 1.0, intake: 0.8, turbo: 0.38, transmission: 0.45 },
    tone: { rumble: 0.9, brightness: 1.0, punch: 0.95 },
  },

  // Mercedes-AMG S 63 (W222): M157 5.5L V8 biturbo, 900 Nm.
  mercedes: {
    engine: "v8tt",
    label: "S 63 AMG M157 5.5 V8 biturbo",
    turbo: true,
    engineOverrides: {
      idleRpm: 650, redlineRpm: 6300, peakTorque: 900, peakTorqueRpm: 2250,
      gears: 7, engineInertia: 0.46, gasTempFactor: 1.19,
      exhaust: { bank: 1.35, collector: 1.70, reflection: 0.58, damping: 0.60, muffler: [0.46, 0.30, 0.20] },
      intake: { helmholtz: 70, q: 4.6, level: 0.24 },
    },
    turboOverrides: { maxBoost: 1.2, boostRpm: 2250, inertia: 0.45, valve: 0.7, bov: 0.30 },
    vehicle: {
      label: "W222 S 63 sedan", mass: 2070, wheelRadius: 0.34, finalDrive: 2.82,
      gearRatios: [4.38, 2.86, 1.92, 1.37, 1.00, 0.82, 0.73],
      dragArea: 0.72, rollingResistance: 0.013, brakeForce: 16000,
      gearbox: "auto", shiftTimeMs: 120, gearTeeth: [43, 36, 31, 27, 24, 21, 19],
    },
    mix: { exhaust: 1.0, intake: 0.55, turbo: 0.42, transmission: 0.35, sub: 0.30 },
    tone: { rumble: 1.2, brightness: 0.85, punch: 1.05 },
  },

  // Audi RS 6 Avant (C7): 4.0 TFSI V8 biturbo, 700 Nm.
  audi: {
    engine: "v8tt",
    label: "RS 6 4.0 TFSI V8 biturbo",
    turbo: true,
    engineOverrides: {
      idleRpm: 700, redlineRpm: 6700, peakTorque: 700, peakTorqueRpm: 1750,
      gears: 8, engineInertia: 0.42, gasTempFactor: 1.21,
      exhaust: { bank: 1.05, collector: 1.45, reflection: 0.56, damping: 0.50, muffler: [0.40, 0.26, 0.17] },
      intake: { helmholtz: 78, q: 5.0, level: 0.30 },
    },
    turboOverrides: { maxBoost: 1.15, boostRpm: 1900, inertia: 0.40, bov: 0.35 },
    vehicle: {
      label: "C7 RS 6 Avant", mass: 1935, wheelRadius: 0.35, finalDrive: 3.09,
      gearRatios: [4.71, 3.14, 2.11, 1.67, 1.29, 1.00, 0.84, 0.67],
      dragArea: 0.70, rollingResistance: 0.013, brakeForce: 15500,
      gearbox: "auto", shiftTimeMs: 90, gearTeeth: [45, 38, 33, 29, 25, 22, 20, 18],
    },
    mix: { exhaust: 1.05, intake: 0.7, turbo: 0.40, transmission: 0.40 },
    tone: { rumble: 1.05, brightness: 0.95, punch: 1.0 },
  },

  // Ford Mustang GT: 5.0L Coyote V8.
  mustang: {
    engine: "v8cross",
    label: "Mustang GT 5.0 Coyote V8",
    turbo: false,
    engineOverrides: {
      idleRpm: 750, redlineRpm: 7000, peakTorque: 542, peakTorqueRpm: 4250,
      gears: 6, engineInertia: 0.38, gasTempFactor: 1.26,
      exhaust: { bank: 1.75, collector: 1.35, reflection: 0.63, damping: 0.34, muffler: [0.40, 0.26, 0.17] },
      intake: { helmholtz: 78, q: 5.0, level: 0.32 },
    },
    vehicle: {
      label: "S550 Mustang GT", mass: 1680, wheelRadius: 0.35, finalDrive: 3.73,
      gearRatios: [3.66, 2.43, 1.69, 1.32, 1.00, 0.65],
      dragArea: 0.74, rollingResistance: 0.015, brakeForce: 12500,
      gearbox: "manual", shiftTimeMs: 150, gearTeeth: [39, 33, 28, 25, 22, 18],
    },
    mix: { exhaust: 1.1, intake: 0.75, turbo: 0, transmission: 0.5, sub: 0.28 },
    tone: { rumble: 1.25, brightness: 0.95, punch: 1.1 },
  },

  // Ferrari 458 Italia: 4.5L F136 flat-plane V8, 9000 rpm.
  ferrari: {
    engine: "v8flat",
    label: "458 Italia 4.5 F136 flat-plane V8",
    turbo: false,
    engineOverrides: {
      idleRpm: 900, redlineRpm: 9000, peakTorque: 540, peakTorqueRpm: 6000,
      gears: 7, engineInertia: 0.25, gasTempFactor: 1.33,
      exhaust: { bank: 0.78, collector: 0.62, reflection: 0.44, damping: 0.26, muffler: [0.18, 0.12, 0.08] },
      intake: { helmholtz: 155, q: 7.8, level: 0.44 },
    },
    vehicle: {
      label: "458 Italia", mass: 1485, wheelRadius: 0.34, finalDrive: 4.20,
      gearRatios: [3.08, 2.19, 1.63, 1.29, 1.03, 0.84, 0.69],
      dragArea: 0.62, rollingResistance: 0.012, brakeForce: 16000,
      gearbox: "dct", shiftTimeMs: 45, gearTeeth: [41, 35, 30, 26, 23, 20, 18],
    },
    mix: { exhaust: 1.1, intake: 0.9, turbo: 0, transmission: 0.45, sub: 0.20 },
    tone: { rumble: 0.9, brightness: 1.15, punch: 1.05 },
  },

  r8: {
    engine: "v10",
    label: "R8 5.2 FSI V10",
    turbo: false,
    engineOverrides: { idleRpm: 800, redlineRpm: 8500, peakTorque: 540, peakTorqueRpm: 6500, gears: 7 },
    vehicle: {
      label: "Audi R8", mass: 1580, wheelRadius: 0.34, finalDrive: 4.1,
      gearRatios: [3.13, 2.05, 1.52, 1.18, 0.94, 0.77, 0.63], gearbox: "dct", shiftTimeMs: 65,
    },
  },

  challenger: {
    engine: "v8cross",
    label: "Challenger R/T HEMI V8",
    turbo: false,
    engineOverrides: { idleRpm: 700, redlineRpm: 6200, peakTorque: 640, peakTorqueRpm: 4200, gears: 6 },
    vehicle: {
      label: "Dodge Challenger", mass: 1900, wheelRadius: 0.36, finalDrive: 3.73,
      gearRatios: [2.97, 2.10, 1.46, 1.00, 0.80, 0.63], gearbox: "manual", shiftTimeMs: 150,
    },
  },

  rangerover: {
    engine: "v8cross",
    label: "Range Rover 5.0 Supercharged V8",
    turbo: false,
    engineOverrides: {
      idleRpm: 650, redlineRpm: 6500, peakTorque: 625, peakTorqueRpm: 3500, gears: 8,
      exhaust: { bank: 1.25, collector: 1.55, reflection: 0.54, damping: 0.56, muffler: [0.42, 0.28, 0.18] },
    },
    vehicle: {
      label: "Range Rover Autobiography", mass: 2450, wheelRadius: 0.39, finalDrive: 3.31,
      gearRatios: [4.71, 3.14, 2.11, 1.67, 1.29, 1.00, 0.84, 0.67], gearbox: "auto", shiftTimeMs: 130,
    },
    mix: { exhaust: 0.95, intake: 0.6, turbo: 0, transmission: 0.35, sub: 0.34 },
    tone: { rumble: 1.2, brightness: 0.85, punch: 1.0 },
  },
};
