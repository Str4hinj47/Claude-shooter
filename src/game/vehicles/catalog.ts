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

export interface VehiclePhysics {
  grip: number;
  brake: number;
  wheelbase: number;
  maxSteer: number;
  understeer: number;
  yawResponse: number;
  steerResponse: number;
  drag: number;
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
