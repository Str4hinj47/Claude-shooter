import { SAFEHOUSE_SPAWN } from "./SafehouseResidence";

export interface WestgateTeleportSpot {
  id: string;
  label: string;
  x: number;
  z: number;
  yawDeg: number;
}

export const WESTGATE_SPAWN: [number, number, number] = SAFEHOUSE_SPAWN;

export const WESTGATE_TELEPORTS: WestgateTeleportSpot[] = [
  { id: "safehouse", label: "Player Safehouse (420 Crescent)", x: SAFEHOUSE_SPAWN[0], z: SAFEHOUSE_SPAWN[1], yawDeg: SAFEHOUSE_SPAWN[2] },
  { id: "downtown", label: "Downtown Civic Roundabout", x: 24, z: -82, yawDeg: -22 },
  { id: "legion_square", label: "Legion Square & Skyline", x: 38, z: -165, yawDeg: -65 },
  { id: "city_hall", label: "City Hall & Reserve Bank", x: 112, z: -162, yawDeg: 90 },
  { id: "parking_deck", label: "Police HQ & Parking Deck", x: 196, z: 48, yawDeg: 95 },
  { id: "midtown_mall", label: "Midtown Grand Mall", x: -402, z: -86, yawDeg: 0 },
  { id: "medical_center", label: "St. Jude's Medical Center", x: -146, z: -206, yawDeg: 180 },
  { id: "university", label: "Westgate University Campus", x: -165, z: -332, yawDeg: 180 },
  { id: "mirror_park", label: "Mirror Central Park", x: -115, z: 342, yawDeg: 0 },
  { id: "old_townhouses", label: "Old Quarter & Suburbs", x: -240, z: 295, yawDeg: 120 },
  { id: "arch_bridge", label: "Downtown Arch Bridge", x: 385, z: -56, yawDeg: 85 },
  { id: "bay_bridge", label: "Westgate Bay Bridge", x: 350, z: 595, yawDeg: 72 },
  { id: "midtown_skyway", label: "Midtown Skyway & Roundabout", x: -292, z: -140, yawDeg: 90 },
  { id: "west_coast", label: "West Coast & Canals", x: -670, z: -110, yawDeg: -105 },
  { id: "del_sol_pier", label: "Del Sol Pier & Ferris Wheel", x: -706, z: 40, yawDeg: -90 },
  { id: "venice_canals", label: "Venice Canals Footbridges", x: -648, z: 164, yawDeg: 0 },
  { id: "north_canyon", label: "North Gorge Truss Bridge", x: 265, z: -635, yawDeg: 86 },
  { id: "observatory", label: "Observatory Foothills Summit", x: -120, z: -974, yawDeg: 180 },
  { id: "vinewood_crest", label: "Vinewood Crest Estates", x: -220, z: -820, yawDeg: 170 },
  { id: "east_industrial", label: "East Industrial Bascule Bridge", x: 370, z: 268, yawDeg: 86 },
  { id: "seaport_docks", label: "Seaport Container Terminal", x: 635, z: 432, yawDeg: 0 },
  { id: "sports_arena", label: "Westgate Sports Arena", x: -415, z: 615, yawDeg: 0 },
  { id: "south_airport", label: "South Airport Terminal Loop", x: -120, z: 850, yawDeg: 0 },
];

export type TimeOfDayMode = "afternoon" | "sunset" | "night" | "dawn";
export const TIME_OF_DAY_MODES: TimeOfDayMode[] = ["afternoon", "sunset", "night", "dawn"];
export const TIME_OF_DAY_LABELS: Record<TimeOfDayMode, string> = {
  afternoon: "Afternoon",
  sunset: "Sunset",
  night: "Night",
  dawn: "Dawn",
};
