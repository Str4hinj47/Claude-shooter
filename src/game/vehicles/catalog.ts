export type CarId =
  | "golf"
  | "mercedes"
  | "audi"
  | "mustang"
  | "ferrari"
  | "r8"
  | "challenger"
  | "rangerover";
export type NpcCarId =
  | "sedan"
  | "offroad"
  | "compact"
  | "hatch"
  | "crossover"
  | "taxi"
  | "police_cruiser"
  | "van"
  | "delivery"
  | "garbage_truck"
  | "ambulance"
  | "firetruck";
export type TruckId = "semi" | "kraz";
export type TrafficId = CarId | NpcCarId | TruckId;

export const NPC_TRAFFIC_CARS: { id: NpcCarId; name: string }[] = [
  { id: "compact", name: "Civic Compact" },
  { id: "hatch", name: "City Hatchback" },
  { id: "sedan", name: "Thunderbolt Sedan" },
  { id: "crossover", name: "Family Crossover" },
  { id: "offroad", name: "Bokaroo 4x4" },
  { id: "taxi", name: "Westgate Taxi" },
  { id: "police_cruiser", name: "Patrol Cruiser" },
  { id: "van", name: "City Utility Van" },
  { id: "delivery", name: "Westgate Box Truck" },
  { id: "garbage_truck", name: "Sanitation Truck" },
  { id: "ambulance", name: "EMS Ambulance" },
  { id: "firetruck", name: "Fire Engine" },
];

export const TRUCKS: { id: TruckId; name: string }[] = [
  { id: "semi", name: "Tractor trailer" },
  { id: "kraz", name: "KrAZ truck" },
];

export type DrivetrainLayout = "FWD" | "RWD" | "AWD";

export interface RealVehicleSpec {
  /** Total curb mass [kg] */
  mass: number;
  /** Yaw moment of inertia Izz [kg*m^2] */
  yawInertia: number;
  /** Wheelbase [m] */
  wheelbase: number;
  /** Front & rear track widths [m] */
  frontTrack: number;
  rearTrack: number;
  /** Static front axle weight share (0..1) */
  frontWeightFraction: number;
  /** Center of gravity height above ground [m] */
  cgHeight: number;
  /** Front roll-stiffness share of total lateral load transfer (0..1; higher = more understeer) */
  frontRollShare: number;

  /** Drivetrain layout and front torque share for AWD (0..1) */
  drivetrain: DrivetrainLayout;
  awdFrontTorqueShare: number;
  /** Clutch-pack LSD locking parameters */
  lsdPreload: number; // [Nm]
  lsdPowerLock: number; // fraction of input torque
  lsdViscous: number; // [Nm / (rad/s)]

  /** Aerodynamics */
  dragArea: number; // Cd * A [m^2]
  downforceArea: number; // Cl * A [m^2]
  aeroFrontBalance: number;

  /** Tire model (similarity combined slip + load sensitivity + relaxation) */
  tireRadius: number; // [m]
  wheelInertia: number; // [kg*m^2]
  tireMuFront: number; // peak mu at nominal load
  tireMuRear: number;
  loadSensitivity: number; // mu loss per +100% normal load
  peakSlipRatio: number; // longitudinal peak kappa (~0.12..0.14)
  peakSlipAngleFrontDeg: number; // lateral peak alpha [deg]
  peakSlipAngleRearDeg: number; // lateral peak alpha [deg]
  slideGripFactor: number; // post-peak sliding grip fraction (0.76..0.84)

  /** Steering geometry */
  maxSteerDeg: number;
  ackermann: number; // 0..1
  steerRate: number; // normalized rack travel per second
  steerSpeedRef: number; // speed where lock halves [m/s]
  minSteerFactor: number;
  casterSelfAlign: number; // pneumatic-trail counter-steer assist strength

  /** Engine torque curve & gearbox */
  idleRpm: number;
  peakTorqueNm: number;
  peakTorqueRpm: number;
  redlineRpm: number;
  limiterRpm: number;
  engineInertia: number; // [kg*m^2]
  engineBrakeNm: number; // pumping/friction drag at peak rpm
  gearRatios: number[];
  reverseRatio: number;
  finalDrive: number;
  drivetrainEfficiency: number;
  shiftTime: number; // [s]
  upshiftLightRpm: number;
  upshiftFullRpm: number;
  downshiftLightRpm: number;
  downshiftFullRpm: number;

  /** Brakes & driver aids */
  maxBrakeTorqueFront: number; // per wheel [Nm]
  maxBrakeTorqueRear: number; // per wheel [Nm]
  handbrakeTorque: number; // per rear wheel [Nm]
  absEnabled: boolean;
  tcsEnabled: boolean;
  tcsMaxCut: number;
  escEnabled: boolean;
  escGain: number;
  escUndersteerGrad: number; // [rad / (m/s^2)]
  /** Off-road tire & suspension capability (0 = track slick/low-slung, 1 = lifted 4x4 A/T) */
  offroadCapability?: number;
}

export interface VehiclePhysics {
  grip: number;
  brake: number;
  wheelbase: number;
  maxSteer: number;
  understeer: number;
  yawResponse: number;
  steerResponse: number;
  drag: number;
  realSpec?: RealVehicleSpec;
}

export interface CarSpec {
  id: CarId;
  name: string;
  maker: string;
  tagline: string;
  klass: string;
  price: number; // Credits in Claude-shooter dealership
  maxSpeed: number; // m/s
  accel: number; // m/s^2
  handling: number;
  stats: { speed: number; handling: number; grip: number };
  color: string;
  physics: VehiclePhysics;
}

export const CARS: CarSpec[] = [
  {
    id: "golf",
    name: "Golf MK4 GTI",
    maker: "Volkswagen",
    tagline: "The hot-hatch original. Small, nimble, always up for a gap.",
    klass: "Hot hatch",
    price: 0,
    maxSpeed: 54,
    accel: 9.5,
    handling: 7.5,
    stats: { speed: 3, handling: 5, grip: 4 },
    color: "#9fb0bf",
    physics: {
      grip: 1.02,
      brake: 10.5,
      wheelbase: 2.51,
      maxSteer: 0.52,
      understeer: 0.005,
      yawResponse: 7.0,
      steerResponse: 7.5,
      drag: 0.00075,
    },
  },
  {
    id: "mustang",
    name: "Mustang GT",
    maker: "Ford",
    tagline: "American muscle. Loud, proud, and hungry for the avenue.",
    klass: "Muscle car",
    price: 160,
    maxSpeed: 58,
    accel: 9.8,
    handling: 5.8,
    stats: { speed: 4, handling: 3, grip: 3 },
    color: "#1f5fd0",
    physics: {
      grip: 1.0,
      brake: 10.8,
      wheelbase: 2.72,
      maxSteer: 0.5,
      understeer: 0.003,
      yawResponse: 6.8,
      steerResponse: 7.2,
      drag: 0.00082,
    },
  },
  {
    id: "challenger",
    name: "Challenger",
    maker: "Dodge",
    tagline: "Big V8 attitude, built for the open road.",
    klass: "Muscle car",
    price: 300,
    maxSpeed: 59,
    accel: 9.6,
    handling: 5.4,
    stats: { speed: 4, handling: 3, grip: 3 },
    color: "#3f7843",
    physics: {
      grip: 0.98,
      brake: 10.6,
      wheelbase: 2.95,
      maxSteer: 0.48,
      understeer: 0.003,
      yawResponse: 6.0,
      steerResponse: 6.5,
      drag: 0.00085,
    },
  },
  {
    id: "mercedes",
    name: "S 63 AMG",
    maker: "Mercedes-Benz",
    tagline: "Autobahn royalty. Effortless pace with a velvet hammer.",
    klass: "Super sedan",
    price: 480,
    maxSpeed: 60,
    accel: 8.5,
    handling: 5.5,
    stats: { speed: 4, handling: 3, grip: 4 },
    color: "#1c2129",
    physics: {
      grip: 1.05,
      brake: 11.5,
      wheelbase: 3.16,
      maxSteer: 0.48,
      understeer: 0.002,
      yawResponse: 5.5,
      steerResponse: 6.0,
      drag: 0.0008,
    },
  },
  {
    id: "audi",
    name: "RS 6 Avant",
    maker: "Audi",
    tagline: "The long-roof missile. Family wagon, supercar urgency.",
    klass: "Performance wagon",
    price: 680,
    maxSpeed: 61,
    accel: 9.0,
    handling: 6.5,
    stats: { speed: 4, handling: 4, grip: 4 },
    color: "#7d8a93",
    physics: {
      grip: 1.08,
      brake: 11.5,
      wheelbase: 2.91,
      maxSteer: 0.5,
      understeer: 0.0035,
      yawResponse: 6.5,
      steerResponse: 7.0,
      drag: 0.00078,
    },
  },
  {
    id: "rangerover",
    name: "Range Rover",
    maker: "Land Rover",
    tagline: "Commanding luxury SUV, built for any road or storm.",
    klass: "Luxury SUV",
    price: 850,
    maxSpeed: 54,
    accel: 8.8,
    handling: 5.6,
    stats: { speed: 3, handling: 3, grip: 5 },
    color: "#1e252c",
    physics: {
      grip: 1.06,
      brake: 10.6,
      wheelbase: 2.92,
      maxSteer: 0.46,
      understeer: 0.003,
      yawResponse: 5.5,
      steerResponse: 6.0,
      drag: 0.00095,
    },
  },
  {
    id: "r8",
    name: "R8",
    maker: "Audi",
    tagline: "Mid-engine balance and supercar pace.",
    klass: "Supercar",
    price: 1150,
    maxSpeed: 65,
    accel: 10.6,
    handling: 8.0,
    stats: { speed: 5, handling: 5, grip: 5 },
    color: "#b3bbc3",
    physics: {
      grip: 1.15,
      brake: 12.8,
      wheelbase: 2.65,
      maxSteer: 0.46,
      understeer: 0.002,
      yawResponse: 8.5,
      steerResponse: 8.5,
      drag: 0.0007,
    },
  },
  {
    id: "ferrari",
    name: "458 Italia",
    maker: "Ferrari",
    tagline: "Maranello precision. Pure naturally aspirated fury.",
    klass: "Supercar",
    price: 1600,
    maxSpeed: 66,
    accel: 11.0,
    handling: 8.0,
    stats: { speed: 5, handling: 5, grip: 5 },
    color: "#d40f1e",
    physics: {
      grip: 1.18,
      brake: 13.0,
      wheelbase: 2.65,
      maxSteer: 0.46,
      understeer: 0.002,
      yawResponse: 9.0,
      steerResponse: 9.0,
      drag: 0.00068,
    },
  },
];

export const TRAFFIC_COLORS = [
  0xb8bec6, 0x20252e, 0xa51f28, 0x245eac, 0xe4e7ed,
  0x32734a, 0xd37a22, 0x633c85, 0xbca32a, 0x318986,
];

export const PAINT_COLORS: { name: string; hex: string }[] = [
  { name: "Rosso", hex: "#d40f1e" },
  { name: "Nero", hex: "#101216" },
  { name: "Bianco", hex: "#e8eaee" },
  { name: "Argento", hex: "#9fb0bf" },
  { name: "Blu", hex: "#1f5fd0" },
  { name: "Giallo", hex: "#f2c230" },
  { name: "Verde", hex: "#1f6f43" },
  { name: "Arancio", hex: "#ff7a1a" },
  { name: "British Green", hex: "#0d3b2e" },
  { name: "Midnight Pearl", hex: "#17203a" },
  { name: "Ice Blue", hex: "#a8d8e8" },
  { name: "Stealth", hex: "#23262b" },
];

export function getCar(id: CarId): CarSpec {
  const car = CARS.find((c) => c.id === id);
  if (!car) throw new Error(`Unknown car ${id}`);
  return car;
}

export function isCarId(id: string): id is CarId {
  return CARS.some((c) => c.id === id);
}

const BASE_SEDAN_SPEC: RealVehicleSpec = {
  mass: 1420,
  yawInertia: 2250,
  wheelbase: 2.62,
  frontTrack: 1.54,
  rearTrack: 1.54,
  frontWeightFraction: 0.56,
  cgHeight: 0.52,
  frontRollShare: 0.58,
  drivetrain: "FWD",
  awdFrontTorqueShare: 0.5,
  lsdPreload: 18,
  lsdPowerLock: 0.12,
  lsdViscous: 120,
  dragArea: 0.68,
  downforceArea: 0.02,
  aeroFrontBalance: 0.45,
  tireRadius: 0.315,
  wheelInertia: 1.25,
  tireMuFront: 0.98,
  tireMuRear: 1.0,
  loadSensitivity: 0.13,
  peakSlipRatio: 0.12,
  peakSlipAngleFrontDeg: 8.6,
  peakSlipAngleRearDeg: 8.0,
  slideGripFactor: 0.80,
  maxSteerDeg: 35,
  ackermann: 0.85,
  steerRate: 3.4,
  steerSpeedRef: 28,
  minSteerFactor: 0.28,
  casterSelfAlign: 0.42,
  idleRpm: 800,
  peakTorqueNm: 220,
  peakTorqueRpm: 3800,
  redlineRpm: 6400,
  limiterRpm: 6600,
  engineInertia: 0.22,
  engineBrakeNm: 38,
  gearRatios: [3.45, 2.05, 1.38, 1.03, 0.82, 0.69],
  reverseRatio: 3.35,
  finalDrive: 3.9,
  drivetrainEfficiency: 0.91,
  shiftTime: 0.18,
  upshiftLightRpm: 2500,
  upshiftFullRpm: 6100,
  downshiftLightRpm: 1400,
  downshiftFullRpm: 3600,
  maxBrakeTorqueFront: 2200,
  maxBrakeTorqueRear: 1350,
  handbrakeTorque: 2100,
  absEnabled: true,
  tcsEnabled: true,
  tcsMaxCut: 0.72,
  escEnabled: true,
  escGain: 2200,
  escUndersteerGrad: 0.0028,
  offroadCapability: 0.36,
};

export const REAL_VEHICLE_SPECS: Record<TrafficId, RealVehicleSpec> = {
  // VW Golf MK4 GTI (1.8T 20v): nimble FWD hot hatch, 1279 kg, 235 Nm @ 1950-5000 rpm, 6-speed
  golf: {
    ...BASE_SEDAN_SPEC,
    mass: 1279,
    yawInertia: 1850,
    wheelbase: 2.51,
    frontTrack: 1.51,
    rearTrack: 1.49,
    frontWeightFraction: 0.59,
    cgHeight: 0.49,
    frontRollShare: 0.56,
    drivetrain: "FWD",
    lsdPreload: 35,
    lsdPowerLock: 0.22,
    lsdViscous: 180,
    dragArea: 0.68,
    downforceArea: 0.05,
    tireRadius: 0.31,
    wheelInertia: 1.15,
    tireMuFront: 1.05,
    tireMuRear: 1.04,
    peakSlipRatio: 0.13,
    peakSlipAngleFrontDeg: 8.4,
    peakSlipAngleRearDeg: 7.8,
    slideGripFactor: 0.80,
    maxSteerDeg: 35,
    steerRate: 3.8,
    steerSpeedRef: 29,
    casterSelfAlign: 0.48,
    idleRpm: 850,
    peakTorqueNm: 265,
    peakTorqueRpm: 3200,
    redlineRpm: 6500,
    limiterRpm: 6750,
    engineInertia: 0.17,
    engineBrakeNm: 36,
    gearRatios: [3.31, 2.13, 1.48, 1.14, 0.95, 0.82],
    reverseRatio: 3.45,
    finalDrive: 4.05,
    shiftTime: 0.13,
    upshiftLightRpm: 2700,
    upshiftFullRpm: 6350,
    downshiftLightRpm: 1450,
    downshiftFullRpm: 3900,
    maxBrakeTorqueFront: 2450,
    maxBrakeTorqueRear: 1500,
    handbrakeTorque: 2400,
    tcsMaxCut: 0.65,
    escGain: 1800,
    escUndersteerGrad: 0.0022,
  },

  // Ford Mustang GT (S550 5.0L Coyote V8): RWD muscle coupe, 1680 kg, 542 Nm @ 4250 rpm, clutch-pack LSD
  mustang: {
    ...BASE_SEDAN_SPEC,
    mass: 1680,
    yawInertia: 2750,
    wheelbase: 2.72,
    frontTrack: 1.58,
    rearTrack: 1.64,
    frontWeightFraction: 0.54,
    cgHeight: 0.48,
    frontRollShare: 0.53,
    drivetrain: "RWD",
    lsdPreload: 85,
    lsdPowerLock: 0.36,
    lsdViscous: 340,
    dragArea: 0.74,
    downforceArea: 0.12,
    aeroFrontBalance: 0.42,
    tireRadius: 0.35,
    wheelInertia: 1.45,
    tireMuFront: 1.07,
    tireMuRear: 1.06,
    peakSlipRatio: 0.13,
    peakSlipAngleFrontDeg: 8.2,
    peakSlipAngleRearDeg: 7.2,
    slideGripFactor: 0.78,
    maxSteerDeg: 34,
    steerRate: 3.5,
    steerSpeedRef: 30,
    casterSelfAlign: 0.56,
    idleRpm: 750,
    peakTorqueNm: 542,
    peakTorqueRpm: 4250,
    redlineRpm: 7000,
    limiterRpm: 7250,
    engineInertia: 0.28,
    engineBrakeNm: 62,
    gearRatios: [3.66, 2.43, 1.69, 1.32, 1.00, 0.65],
    reverseRatio: 3.38,
    finalDrive: 3.73,
    shiftTime: 0.15,
    upshiftLightRpm: 2600,
    upshiftFullRpm: 6850,
    downshiftLightRpm: 1400,
    downshiftFullRpm: 4200,
    maxBrakeTorqueFront: 2950,
    maxBrakeTorqueRear: 1850,
    handbrakeTorque: 2600,
    tcsMaxCut: 0.48,
    escGain: 1400,
    escUndersteerGrad: 0.0014,
  },

  // Dodge Challenger R/T Scat Pack (6.4L HEMI V8): heavy long-wheelbase RWD muscle cruiser, 1900 kg, 640 Nm
  challenger: {
    ...BASE_SEDAN_SPEC,
    mass: 1900,
    yawInertia: 3350,
    wheelbase: 2.95,
    frontTrack: 1.61,
    rearTrack: 1.63,
    frontWeightFraction: 0.55,
    cgHeight: 0.51,
    frontRollShare: 0.54,
    drivetrain: "RWD",
    lsdPreload: 90,
    lsdPowerLock: 0.34,
    lsdViscous: 360,
    dragArea: 0.80,
    downforceArea: 0.08,
    tireRadius: 0.36,
    wheelInertia: 1.55,
    tireMuFront: 1.04,
    tireMuRear: 1.03,
    peakSlipRatio: 0.13,
    peakSlipAngleFrontDeg: 8.5,
    peakSlipAngleRearDeg: 7.4,
    slideGripFactor: 0.78,
    maxSteerDeg: 33,
    steerRate: 3.2,
    steerSpeedRef: 29,
    casterSelfAlign: 0.56,
    idleRpm: 700,
    peakTorqueNm: 640,
    peakTorqueRpm: 4200,
    redlineRpm: 6200,
    limiterRpm: 6450,
    engineInertia: 0.32,
    engineBrakeNm: 68,
    gearRatios: [2.97, 2.10, 1.46, 1.00, 0.80, 0.63],
    reverseRatio: 2.90,
    finalDrive: 3.73,
    shiftTime: 0.15,
    upshiftLightRpm: 2400,
    upshiftFullRpm: 6050,
    downshiftLightRpm: 1300,
    downshiftFullRpm: 3800,
    maxBrakeTorqueFront: 3150,
    maxBrakeTorqueRear: 1950,
    handbrakeTorque: 2700,
    tcsMaxCut: 0.45,
    escGain: 1350,
    escUndersteerGrad: 0.0015,
    offroadCapability: 0.24,
  },

  // Mercedes-AMG S 63 (W222): 5.5L V8 biturbo, 900 Nm @ 2250 rpm, rear-biased 33/67 4MATIC AWD, 2070 kg
  mercedes: {
    ...BASE_SEDAN_SPEC,
    mass: 2070,
    yawInertia: 3750,
    wheelbase: 3.16,
    frontTrack: 1.63,
    rearTrack: 1.64,
    frontWeightFraction: 0.53,
    cgHeight: 0.49,
    frontRollShare: 0.56,
    drivetrain: "AWD",
    awdFrontTorqueShare: 0.33,
    lsdPreload: 75,
    lsdPowerLock: 0.32,
    lsdViscous: 340,
    dragArea: 0.72,
    downforceArea: 0.14,
    aeroFrontBalance: 0.44,
    tireRadius: 0.34,
    wheelInertia: 1.50,
    tireMuFront: 1.09,
    tireMuRear: 1.11,
    peakSlipRatio: 0.13,
    peakSlipAngleFrontDeg: 8.1,
    peakSlipAngleRearDeg: 7.4,
    slideGripFactor: 0.80,
    maxSteerDeg: 33,
    steerRate: 3.2,
    steerSpeedRef: 33,
    casterSelfAlign: 0.46,
    idleRpm: 650,
    peakTorqueNm: 860,
    peakTorqueRpm: 2600,
    redlineRpm: 6300,
    limiterRpm: 6500,
    engineInertia: 0.36,
    engineBrakeNm: 65,
    gearRatios: [4.38, 2.86, 1.92, 1.37, 1.00, 0.82, 0.73],
    reverseRatio: 3.42,
    finalDrive: 2.82,
    drivetrainEfficiency: 0.92,
    shiftTime: 0.11,
    upshiftLightRpm: 2200,
    upshiftFullRpm: 6150,
    downshiftLightRpm: 1200,
    downshiftFullRpm: 3600,
    maxBrakeTorqueFront: 3600,
    maxBrakeTorqueRear: 2250,
    handbrakeTorque: 2800,
    tcsMaxCut: 0.68,
    escGain: 2100,
    escUndersteerGrad: 0.0018,
    offroadCapability: 0.40,
  },

  // Audi RS 6 Avant (C7): 4.0L V8 biturbo, 700 Nm, quattro 40/60 AWD, 1935 kg, 8-speed Tiptronic
  audi: {
    ...BASE_SEDAN_SPEC,
    mass: 1935,
    yawInertia: 3250,
    wheelbase: 2.91,
    frontTrack: 1.63,
    rearTrack: 1.62,
    frontWeightFraction: 0.54,
    cgHeight: 0.48,
    frontRollShare: 0.54,
    drivetrain: "AWD",
    awdFrontTorqueShare: 0.40,
    lsdPreload: 80,
    lsdPowerLock: 0.35,
    lsdViscous: 380,
    dragArea: 0.70,
    downforceArea: 0.16,
    aeroFrontBalance: 0.44,
    tireRadius: 0.35,
    wheelInertia: 1.48,
    tireMuFront: 1.12,
    tireMuRear: 1.13,
    peakSlipRatio: 0.135,
    peakSlipAngleFrontDeg: 7.9,
    peakSlipAngleRearDeg: 7.2,
    slideGripFactor: 0.80,
    maxSteerDeg: 34,
    steerRate: 3.6,
    steerSpeedRef: 33,
    casterSelfAlign: 0.48,
    idleRpm: 700,
    peakTorqueNm: 700,
    peakTorqueRpm: 2400,
    redlineRpm: 6700,
    limiterRpm: 6900,
    engineInertia: 0.32,
    engineBrakeNm: 60,
    gearRatios: [4.71, 3.14, 2.11, 1.67, 1.29, 1.00, 0.84, 0.67],
    reverseRatio: 3.32,
    finalDrive: 3.09,
    drivetrainEfficiency: 0.92,
    shiftTime: 0.09,
    upshiftLightRpm: 2400,
    upshiftFullRpm: 6550,
    downshiftLightRpm: 1300,
    downshiftFullRpm: 3900,
    maxBrakeTorqueFront: 3500,
    maxBrakeTorqueRear: 2150,
    handbrakeTorque: 2700,
    tcsMaxCut: 0.60,
    escGain: 1850,
    escUndersteerGrad: 0.0016,
    offroadCapability: 0.56,
  },

  // Land Rover Range Rover 5.0 Supercharged: heavy luxury 4x4 SUV, 2380 kg, 625 Nm, high CG, 50/50 AWD
  rangerover: {
    ...BASE_SEDAN_SPEC,
    mass: 2380,
    yawInertia: 4450,
    wheelbase: 2.92,
    frontTrack: 1.69,
    rearTrack: 1.68,
    frontWeightFraction: 0.51,
    cgHeight: 0.68,
    frontRollShare: 0.55,
    drivetrain: "AWD",
    awdFrontTorqueShare: 0.50,
    lsdPreload: 90,
    lsdPowerLock: 0.35,
    lsdViscous: 420,
    dragArea: 0.98,
    downforceArea: 0.02,
    tireRadius: 0.39,
    wheelInertia: 1.85,
    tireMuFront: 1.02,
    tireMuRear: 1.02,
    peakSlipRatio: 0.13,
    peakSlipAngleFrontDeg: 9.0,
    peakSlipAngleRearDeg: 8.5,
    slideGripFactor: 0.82,
    maxSteerDeg: 34,
    steerRate: 3.0,
    steerSpeedRef: 28,
    casterSelfAlign: 0.44,
    idleRpm: 650,
    peakTorqueNm: 650,
    peakTorqueRpm: 3500,
    redlineRpm: 6500,
    limiterRpm: 6700,
    engineInertia: 0.36,
    engineBrakeNm: 68,
    gearRatios: [4.71, 3.14, 2.11, 1.67, 1.29, 1.00, 0.84, 0.67],
    reverseRatio: 3.30,
    finalDrive: 3.55,
    drivetrainEfficiency: 0.90,
    shiftTime: 0.14,
    upshiftLightRpm: 2300,
    upshiftFullRpm: 6300,
    downshiftLightRpm: 1250,
    downshiftFullRpm: 3600,
    maxBrakeTorqueFront: 3900,
    maxBrakeTorqueRear: 2500,
    handbrakeTorque: 3000,
    tcsMaxCut: 0.72,
    escGain: 2300,
    escUndersteerGrad: 0.0022,
    offroadCapability: 0.86,
  },

  // Audi R8 V10 Plus (5.2L FSI V10): mid-engine rear-biased AWD supercar, 1580 kg, 8500 rpm, 7-speed DCT
  r8: {
    ...BASE_SEDAN_SPEC,
    mass: 1580,
    yawInertia: 2150,
    wheelbase: 2.65,
    frontTrack: 1.64,
    rearTrack: 1.60,
    frontWeightFraction: 0.43,
    cgHeight: 0.43,
    frontRollShare: 0.48,
    drivetrain: "AWD",
    awdFrontTorqueShare: 0.25,
    lsdPreload: 75,
    lsdPowerLock: 0.40,
    lsdViscous: 360,
    dragArea: 0.64,
    downforceArea: 0.36,
    aeroFrontBalance: 0.42,
    tireRadius: 0.34,
    wheelInertia: 1.35,
    tireMuFront: 1.18,
    tireMuRear: 1.21,
    loadSensitivity: 0.11,
    peakSlipRatio: 0.135,
    peakSlipAngleFrontDeg: 7.4,
    peakSlipAngleRearDeg: 6.8,
    slideGripFactor: 0.79,
    maxSteerDeg: 33,
    steerRate: 4.1,
    steerSpeedRef: 36,
    casterSelfAlign: 0.58,
    idleRpm: 800,
    peakTorqueNm: 540,
    peakTorqueRpm: 6500,
    redlineRpm: 8500,
    limiterRpm: 8700,
    engineInertia: 0.22,
    engineBrakeNm: 58,
    gearRatios: [3.13, 2.05, 1.52, 1.18, 0.94, 0.77, 0.63],
    reverseRatio: 2.95,
    finalDrive: 4.10,
    drivetrainEfficiency: 0.93,
    shiftTime: 0.065,
    upshiftLightRpm: 3100,
    upshiftFullRpm: 8350,
    downshiftLightRpm: 1800,
    downshiftFullRpm: 5400,
    maxBrakeTorqueFront: 3600,
    maxBrakeTorqueRear: 2350,
    handbrakeTorque: 2700,
    tcsMaxCut: 0.55,
    escGain: 1600,
    escUndersteerGrad: 0.0011,
    offroadCapability: 0.14,
  },

  // Ferrari 458 Italia (4.5L F136 flat-plane V8): mid-engine RWD precision, 1485 kg, 9000 rpm, 7-speed F1 DCT
  ferrari: {
    ...BASE_SEDAN_SPEC,
    mass: 1485,
    yawInertia: 1980,
    wheelbase: 2.65,
    frontTrack: 1.67,
    rearTrack: 1.61,
    frontWeightFraction: 0.42,
    cgHeight: 0.42,
    frontRollShare: 0.47,
    drivetrain: "RWD",
    lsdPreload: 80,
    lsdPowerLock: 0.42,
    lsdViscous: 380,
    dragArea: 0.62,
    downforceArea: 0.42,
    aeroFrontBalance: 0.43,
    tireRadius: 0.34,
    wheelInertia: 1.30,
    tireMuFront: 1.20,
    tireMuRear: 1.24,
    loadSensitivity: 0.11,
    peakSlipRatio: 0.135,
    peakSlipAngleFrontDeg: 7.2,
    peakSlipAngleRearDeg: 6.6,
    slideGripFactor: 0.78,
    maxSteerDeg: 33,
    steerRate: 4.3,
    steerSpeedRef: 37,
    casterSelfAlign: 0.62,
    idleRpm: 900,
    peakTorqueNm: 540,
    peakTorqueRpm: 6000,
    redlineRpm: 9000,
    limiterRpm: 9200,
    engineInertia: 0.19,
    engineBrakeNm: 60,
    gearRatios: [3.08, 2.19, 1.63, 1.29, 1.03, 0.84, 0.69],
    reverseRatio: 3.10,
    finalDrive: 4.20,
    drivetrainEfficiency: 0.94,
    shiftTime: 0.045,
    upshiftLightRpm: 3200,
    upshiftFullRpm: 8800,
    downshiftLightRpm: 1900,
    downshiftFullRpm: 5600,
    maxBrakeTorqueFront: 3650,
    maxBrakeTorqueRear: 2400,
    handbrakeTorque: 2700,
    tcsMaxCut: 0.50,
    escGain: 1500,
    escUndersteerGrad: 0.0010,
    offroadCapability: 0.08,
  },

  // NPC & Service Fleet Vehicles
  compact: { ...BASE_SEDAN_SPEC, mass: 1240, yawInertia: 1850, wheelbase: 2.58, peakTorqueNm: 185, offroadCapability: 0.34 },
  hatch: { ...BASE_SEDAN_SPEC, mass: 1150, yawInertia: 1620, wheelbase: 2.38, peakTorqueNm: 170, offroadCapability: 0.36 },
  sedan: { ...BASE_SEDAN_SPEC, mass: 1480, yawInertia: 2380, wheelbase: 2.65, drivetrain: "RWD", frontWeightFraction: 0.54, peakTorqueNm: 250, lsdPreload: 15, offroadCapability: 0.28 },
  crossover: { ...BASE_SEDAN_SPEC, mass: 1680, yawInertia: 2750, wheelbase: 2.68, cgHeight: 0.62, tireRadius: 0.35, dragArea: 0.82, peakTorqueNm: 265, drivetrain: "AWD", awdFrontTorqueShare: 0.45, offroadCapability: 0.72 },
  offroad: { ...BASE_SEDAN_SPEC, mass: 1980, yawInertia: 3200, wheelbase: 2.65, cgHeight: 0.68, drivetrain: "AWD", awdFrontTorqueShare: 0.5, tireRadius: 0.38, dragArea: 0.94, peakTorqueNm: 380, lsdPreload: 115, lsdPowerLock: 0.45, tireMuFront: 1.01, tireMuRear: 1.02, offroadCapability: 0.98 },
  taxi: { ...BASE_SEDAN_SPEC, mass: 1540, yawInertia: 2480, wheelbase: 2.66, drivetrain: "RWD", frontWeightFraction: 0.54, peakTorqueNm: 265 },
  police_cruiser: {
    ...BASE_SEDAN_SPEC,
    mass: 1790,
    yawInertia: 2880,
    wheelbase: 2.75,
    frontWeightFraction: 0.54,
    drivetrain: "AWD",
    awdFrontTorqueShare: 0.35,
    lsdPreload: 75,
    lsdPowerLock: 0.32,
    tireMuFront: 1.07,
    tireMuRear: 1.08,
    peakTorqueNm: 485,
    peakTorqueRpm: 4200,
    redlineRpm: 6600,
    limiterRpm: 6800,
    finalDrive: 3.55,
    maxBrakeTorqueFront: 3200,
    maxBrakeTorqueRear: 2050,
  },
  van: { ...BASE_SEDAN_SPEC, mass: 2050, yawInertia: 3600, wheelbase: 2.85, cgHeight: 0.74, dragArea: 1.15, tireRadius: 0.36, peakTorqueNm: 310, maxBrakeTorqueFront: 3100, maxBrakeTorqueRear: 2100 },
  delivery: { ...BASE_SEDAN_SPEC, mass: 4200, yawInertia: 9600, wheelbase: 3.40, frontTrack: 1.85, rearTrack: 1.85, cgHeight: 0.95, drivetrain: "RWD", frontWeightFraction: 0.48, dragArea: 2.2, tireRadius: 0.42, wheelInertia: 2.8, tireMuFront: 0.92, tireMuRear: 0.92, peakTorqueNm: 620, peakTorqueRpm: 2200, redlineRpm: 4200, limiterRpm: 4400, finalDrive: 4.56, maxBrakeTorqueFront: 4800, maxBrakeTorqueRear: 3600 },
  garbage_truck: { ...BASE_SEDAN_SPEC, mass: 8500, yawInertia: 24000, wheelbase: 3.80, frontTrack: 2.0, rearTrack: 2.0, cgHeight: 1.08, drivetrain: "RWD", frontWeightFraction: 0.45, dragArea: 3.0, tireRadius: 0.48, wheelInertia: 4.2, tireMuFront: 0.88, tireMuRear: 0.88, peakTorqueNm: 980, peakTorqueRpm: 1600, redlineRpm: 3200, limiterRpm: 3400, finalDrive: 5.12, maxBrakeTorqueFront: 8500, maxBrakeTorqueRear: 7200 },
  ambulance: { ...BASE_SEDAN_SPEC, mass: 3600, yawInertia: 7800, wheelbase: 3.30, frontTrack: 1.82, rearTrack: 1.82, cgHeight: 0.88, drivetrain: "RWD", frontWeightFraction: 0.50, dragArea: 1.9, tireRadius: 0.40, wheelInertia: 2.4, tireMuFront: 0.95, tireMuRear: 0.95, peakTorqueNm: 580, peakTorqueRpm: 2600, redlineRpm: 4600, limiterRpm: 4800, finalDrive: 4.10, maxBrakeTorqueFront: 4600, maxBrakeTorqueRear: 3400 },
  firetruck: { ...BASE_SEDAN_SPEC, mass: 11200, yawInertia: 36000, wheelbase: 4.30, frontTrack: 2.1, rearTrack: 2.1, cgHeight: 1.15, drivetrain: "RWD", frontWeightFraction: 0.46, dragArea: 3.4, tireRadius: 0.52, wheelInertia: 5.0, tireMuFront: 0.88, tireMuRear: 0.88, peakTorqueNm: 1280, peakTorqueRpm: 1600, redlineRpm: 3000, limiterRpm: 3200, finalDrive: 5.29, maxBrakeTorqueFront: 10500, maxBrakeTorqueRear: 9000 },
  semi: { ...BASE_SEDAN_SPEC, mass: 7800, yawInertia: 28000, wheelbase: 5.20, frontTrack: 2.05, rearTrack: 2.05, cgHeight: 1.05, drivetrain: "RWD", frontWeightFraction: 0.52, dragArea: 3.8, tireRadius: 0.44, wheelInertia: 4.5, tireMuFront: 0.88, tireMuRear: 0.88, peakTorqueNm: 1450, peakTorqueRpm: 1400, redlineRpm: 2600, limiterRpm: 2800, finalDrive: 4.33, maxBrakeTorqueFront: 9500, maxBrakeTorqueRear: 8500 },
  kraz: { ...BASE_SEDAN_SPEC, mass: 9600, yawInertia: 32000, wheelbase: 4.60, frontTrack: 2.10, rearTrack: 2.10, cgHeight: 1.12, drivetrain: "AWD", awdFrontTorqueShare: 0.40, frontWeightFraction: 0.50, dragArea: 3.4, tireRadius: 0.62, wheelInertia: 5.4, tireMuFront: 0.91, tireMuRear: 0.91, peakTorqueNm: 1380, peakTorqueRpm: 1500, redlineRpm: 2800, limiterRpm: 3000, finalDrive: 5.10, maxBrakeTorqueFront: 10500, maxBrakeTorqueRear: 9500, offroadCapability: 0.92 },
};

export function getRealVehicleSpec(id: TrafficId): RealVehicleSpec {
  return REAL_VEHICLE_SPECS[id] ?? BASE_SEDAN_SPEC;
}
