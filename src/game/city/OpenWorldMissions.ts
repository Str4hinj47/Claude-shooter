export interface OpenWorldMissionSite {
  missionId: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
  approachX: number;
  approachZ: number;
  districtLabel: string;
  clearRadius: number;
  escapeRadius: number;
  enterRadius: number;
}

export const OPEN_WORLD_MISSION_SITES: Record<number, OpenWorldMissionSite> = {
  1: {
    missionId: 1,
    x: -210,
    y: 4.35,
    z: 175,
    yaw: 0,
    approachX: -210,
    approachZ: 221,
    districtLabel: "Old Quarter",
    clearRadius: 46,
    enterRadius: 56,
    escapeRadius: 120,
  },
  2: {
    missionId: 2,
    x: -460,
    y: 4.40,
    z: 70,
    yaw: 0,
    approachX: -460,
    approachZ: 116,
    districtLabel: "Midtown Construction Zone",
    clearRadius: 46,
    enterRadius: 56,
    escapeRadius: 120,
  },
  3: {
    missionId: 3,
    x: -60,
    y: 4.48,
    z: -390,
    yaw: 0,
    approachX: -60,
    approachZ: -344,
    districtLabel: "Downtown Financial Core",
    clearRadius: 48,
    enterRadius: 56,
    escapeRadius: 125,
  },
  4: {
    missionId: 4,
    x: 695,
    y: 2.80,
    z: 465,
    yaw: Math.PI,
    approachX: 695,
    approachZ: 419,
    districtLabel: "Eastgate Seaport Docks",
    clearRadius: 50,
    enterRadius: 58,
    escapeRadius: 125,
  },
  5: {
    missionId: 5,
    x: 400,
    y: 4.40,
    z: -120,
    yaw: 0,
    approachX: 400,
    approachZ: -76,
    districtLabel: "East Downtown Plaza",
    clearRadius: 48,
    enterRadius: 56,
    escapeRadius: 125,
  },
  6: {
    missionId: 6,
    x: -500,
    y: 4.40,
    z: -420,
    yaw: 0,
    approachX: -500,
    approachZ: -350,
    districtLabel: "North Foothills Citadel",
    clearRadius: 68,
    enterRadius: 76,
    escapeRadius: 140,
  },
};

export function getOpenWorldMissionSite(missionId: number): OpenWorldMissionSite | null {
  return OPEN_WORLD_MISSION_SITES[missionId] ?? null;
}

export function localToWorldMissionPos(
  site: OpenWorldMissionSite,
  lx: number,
  ly: number,
  lz: number,
): [number, number, number] {
  const c = Math.cos(site.yaw);
  const s = Math.sin(site.yaw);
  return [
    site.x + lx * c + lz * s,
    site.y + ly,
    site.z - lx * s + lz * c,
  ];
}

export function localToWorldMissionYaw(site: OpenWorldMissionSite, lyaw: number): number {
  return lyaw + site.yaw;
}
