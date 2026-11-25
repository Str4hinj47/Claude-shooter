import { WESTGATE_CONTRACT_SPOTS } from "./WestgateActivities";
import { WESTGATE_TELEPORTS } from "./WestgateWorld";
import { APARTMENTS } from "../progression";

export interface GpsWaypoint {
  id: string;
  label: string;
  x: number;
  z: number;
  isCustom?: boolean;
  color?: string;
}

export function resolveGpsTarget(
  gpsTargetId: string | null,
  customWaypoint?: GpsWaypoint | null,
): GpsWaypoint | null {
  if (gpsTargetId === "custom" && customWaypoint) return customWaypoint;
  if (!gpsTargetId) return customWaypoint ?? null;
  if (gpsTargetId.startsWith("contract:")) {
    const mid = Number(gpsTargetId.slice("contract:".length));
    const c = WESTGATE_CONTRACT_SPOTS.find((s) => s.missionId === mid);
    return c ? { id: gpsTargetId, label: `Contract C${c.missionId} · ${c.districtLabel}`, x: c.x, z: c.z } : null;
  }
  const apt = APARTMENTS.find((a) => a.id === gpsTargetId);
  if (apt) return { id: apt.id, label: apt.name, x: apt.exitStreetPos.x, z: apt.exitStreetPos.z, color: apt.accentHex };
  const tp = WESTGATE_TELEPORTS.find((t) => t.id === gpsTargetId);
  if (tp) return { id: tp.id, label: tp.label, x: tp.x, z: tp.z };
  return customWaypoint ?? null;
}
