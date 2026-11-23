import * as THREE from "three";
import type { PropBatcher } from "./PropBatcher";
import type { RoadNetwork } from "./RoadNetwork";
import type { TerrainHeightFn } from "./HeightSystem";
import { getDistrictAt } from "./WestgateTerrain";
import type { WestgateTeleportSpot } from "./WestgateWorld";

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const CAR_PALETTE = [
  0xb91c1c, // crimson
  0x1d4ed8, // cobalt
  0x334155, // slate metallic
  0xd1d5db, // silver
  0xf8fafc, // pearl white
  0x0f766e, // emerald teal
  0xb45309, // bronze amber
  0x18181b, // obsidian
];

export function registerWestgatePropPrototypes(batcher: PropBatcher): void {
  const barkMat = new THREE.MeshStandardMaterial({ color: 0x6d4c33, roughness: 0.92 });
  const palmCrownMat = new THREE.MeshStandardMaterial({ color: 0x3b7a38, roughness: 0.84 });
  const oakCrownMat = new THREE.MeshStandardMaterial({ color: 0x356934, roughness: 0.88 });
  const darkPoleMat = new THREE.MeshStandardMaterial({ color: 0x2a3038, roughness: 0.55, metalness: 0.55 });
  const lampGlowMat = new THREE.MeshStandardMaterial({
    color: 0xfff1c9,
    emissive: 0xffd27d,
    emissiveIntensity: 1.7,
    roughness: 0.3,
  });
  const carPaintMat = new THREE.MeshStandardMaterial({ color: 0xd1d5db, roughness: 0.38, metalness: 0.45 });
  const cabinGlassMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.22, metalness: 0.65 });
  const tireMat = new THREE.MeshStandardMaterial({ color: 0x17181c, roughness: 0.9 });
  const hydrantRed = new THREE.MeshStandardMaterial({ color: 0xdc2626, roughness: 0.45, metalness: 0.25 });

  // 1. California Palm Tree (8.5m tall)
  const palmTrunk = new THREE.CylinderGeometry(0.18, 0.32, 7.6, 7);
  const palmHead = new THREE.ConeGeometry(2.6, 1.5, 7);
  const palmTop = new THREE.ConeGeometry(1.9, 1.4, 7);
  batcher.registerPrototype({
    id: "palm_tree",
    colliderSize: [0.65, 6.0, 0.65],
    parts: [
      { geometry: palmTrunk, material: barkMat, localOffset: [0, 3.8, 0], preserveBaseColor: true },
      { geometry: palmHead, material: palmCrownMat, localOffset: [0, 7.6, 0], localRotation: [Math.PI, 0, 0] },
      { geometry: palmTop, material: palmCrownMat, localOffset: [0, 8.2, 0] },
    ],
  });

  // 2. Urban Oak / Sycamore Tree (6.5m tall)
  const oakTrunk = new THREE.CylinderGeometry(0.24, 0.38, 3.0, 7);
  const oakCanopyA = new THREE.DodecahedronGeometry(2.1, 0);
  const oakCanopyB = new THREE.DodecahedronGeometry(1.5, 0);
  batcher.registerPrototype({
    id: "oak_tree",
    colliderSize: [0.8, 4.5, 0.8],
    parts: [
      { geometry: oakTrunk, material: barkMat, localOffset: [0, 1.5, 0], preserveBaseColor: true },
      { geometry: oakCanopyA, material: oakCrownMat, localOffset: [0, 4.3, 0] },
      { geometry: oakCanopyB, material: oakCrownMat, localOffset: [0.7, 5.2, -0.4] },
    ],
  });

  // 3. Modern Streetlight Pole (6.6m tall with cantilever arm)
  const poleGeo = new THREE.CylinderGeometry(0.1, 0.16, 6.4, 7);
  const armGeo = new THREE.BoxGeometry(1.9, 0.14, 0.16);
  const lampGeo = new THREE.BoxGeometry(0.55, 0.14, 0.3);
  batcher.registerPrototype({
    id: "streetlight",
    colliderSize: [0.35, 6.2, 0.35],
    parts: [
      { geometry: poleGeo, material: darkPoleMat, localOffset: [0, 3.2, 0], preserveBaseColor: true },
      { geometry: armGeo, material: darkPoleMat, localOffset: [0.85, 6.35, 0], preserveBaseColor: true },
      { geometry: lampGeo, material: lampGlowMat, localOffset: [1.55, 6.22, 0], preserveBaseColor: true, castShadow: false },
    ],
  });

  // 4. Signal Intersection Traffic Mast (5.8m tall)
  const sigPole = new THREE.CylinderGeometry(0.14, 0.2, 5.8, 8);
  const sigArm = new THREE.BoxGeometry(4.4, 0.2, 0.2);
  const sigRed = new THREE.MeshStandardMaterial({ color: 0xef4444, emissive: 0xdc2626, emissiveIntensity: 1.5 });
  const sigGreen = new THREE.MeshStandardMaterial({ color: 0x22c55e, emissive: 0x16a34a, emissiveIntensity: 1.5 });
  const sigBox = new THREE.BoxGeometry(0.42, 1.05, 0.35);
  const sigLens = new THREE.BoxGeometry(0.24, 0.24, 0.4);
  batcher.registerPrototype({
    id: "traffic_light",
    colliderSize: [0.45, 5.6, 0.45],
    parts: [
      { geometry: sigPole, material: darkPoleMat, localOffset: [0, 2.9, 0], preserveBaseColor: true },
      { geometry: sigArm, material: darkPoleMat, localOffset: [2.0, 5.6, 0], preserveBaseColor: true },
      { geometry: sigBox, material: darkPoleMat, localOffset: [3.2, 5.2, 0], preserveBaseColor: true },
      { geometry: sigLens, material: sigRed, localOffset: [3.2, 5.48, 0], preserveBaseColor: true, castShadow: false },
      { geometry: sigLens, material: sigGreen, localOffset: [3.2, 4.95, 0], preserveBaseColor: true, castShadow: false },
    ],
  });

  // 5. Stylized Parked Sedan (`4.2m` long along Z, `1.85m` wide along X)
  const chassisGeo = new THREE.BoxGeometry(1.85, 0.72, 4.2);
  const cabinGeo = new THREE.BoxGeometry(1.56, 0.62, 2.15);
  const wheelGeo = new THREE.CylinderGeometry(0.34, 0.34, 0.26, 10);
  batcher.registerPrototype({
    id: "parked_car",
    colliderSize: [1.88, 1.5, 4.24],
    parts: [
      { geometry: chassisGeo, material: carPaintMat, localOffset: [0, 0.56, 0] },
      { geometry: cabinGeo, material: cabinGlassMat, localOffset: [0, 1.18, -0.15], preserveBaseColor: true },
      { geometry: wheelGeo, material: tireMat, localOffset: [-0.88, 0.34, 1.25], localRotation: [0, 0, Math.PI * 0.5], preserveBaseColor: true },
      { geometry: wheelGeo, material: tireMat, localOffset: [0.88, 0.34, 1.25], localRotation: [0, 0, Math.PI * 0.5], preserveBaseColor: true },
      { geometry: wheelGeo, material: tireMat, localOffset: [-0.88, 0.34, -1.25], localRotation: [0, 0, Math.PI * 0.5], preserveBaseColor: true },
      { geometry: wheelGeo, material: tireMat, localOffset: [0.88, 0.34, -1.25], localRotation: [0, 0, Math.PI * 0.5], preserveBaseColor: true },
    ],
  });

  // 6. Sidewalk Fire Hydrant
  const hydBody = new THREE.CylinderGeometry(0.18, 0.2, 0.78, 8);
  const hydCap = new THREE.SphereGeometry(0.19, 8, 6);
  batcher.registerPrototype({
    id: "hydrant",
    colliderSize: [0.42, 0.9, 0.42],
    parts: [
      { geometry: hydBody, material: hydrantRed, localOffset: [0, 0.39, 0], preserveBaseColor: true },
      { geometry: hydCap, material: hydrantRed, localOffset: [0, 0.78, 0], preserveBaseColor: true },
    ],
  });
}

/**
 * Populates citywide street furniture, district-themed trees, traffic signals,
 * and parked cars into `PropBatcher`.
 */
export function populateWestgateProps(
  batcher: PropBatcher,
  roads: RoadNetwork,
  terrainAt: TerrainHeightFn,
  teleports: readonly WestgateTeleportSpot[],
): void {
  registerWestgatePropPrototypes(batcher);
  const rng = mulberry32(20261122);

  const isNearTeleport = (x: number, z: number, minDist = 8.5): boolean => {
    for (let i = 0; i < teleports.length; i++) {
      const tp = teleports[i];
      if ((x - tp.x) * (x - tp.x) + (z - tp.z) * (z - tp.z) < minDist * minDist) return true;
    }
    return false;
  };

  // Track placed poles/trees on a coarse 6m grid so roads crossing don't double-place
  const occupied = new Set<string>();
  const tryReserve = (x: number, z: number): boolean => {
    const key = `${Math.round(x / 6)},${Math.round(z / 6)}`;
    if (occupied.has(key)) return false;
    occupied.add(key);
    return true;
  };

  // 1. Streetlights & District Trees along Arterial / Collector / Local curbs
  for (const seg of roads.getSegments()) {
    if (seg.spec.isBridge || seg.spec.tier === "freeway" || seg.spec.tier === "ramp") continue;
    const samples = seg.samples;
    if (samples.length < 4) continue;

    const halfW = seg.totalWidth * 0.5;
    let nextLampS = 22;
    let nextTreeS = 14;
    let lampSide = 1;

    for (let i = 1; i < samples.length - 1; i++) {
      const sp = samples[i];
      // Streetlights alternating/paired along road curbs
      if (sp.s >= nextLampS) {
        nextLampS = sp.s + 46;
        for (const side of seg.spec.tier === "arterial" ? [-1, 1] : [lampSide]) {
          const lx = sp.x + sp.rx * (halfW + 0.9) * side;
          const lz = sp.z + sp.rz * (halfW + 0.9) * side;
          const gy = terrainAt(lx, lz);
          if (gy >= 2.0 && !isNearTeleport(lx, lz) && tryReserve(lx, lz)) {
            const inf = roads.getRoadInfluence(lx, lz, 14, true);
            if (!inf || inf.edgeDist >= 0.4) {
              // Orient arm inward (+X -> (-sp.rx * side, -sp.rz * side)) over road
              const ry = Math.atan2(sp.rz * side, -sp.rx * side);
              batcher.addInstance("streetlight", { x: lx, y: gy, z: lz, ry });
            }
          }
        }
        lampSide *= -1;
      }

      // Palms & Oaks behind sidewalk apron
      if (sp.s >= nextTreeS) {
        nextTreeS = sp.s + (seg.spec.tier === "arterial" ? 34 : 28);
        const side = rng() > 0.5 ? 1 : -1;
        const tx = sp.x + sp.rx * (halfW + 3.4) * side;
        const tz = sp.z + sp.rz * (halfW + 3.4) * side;
        const gy = terrainAt(tx, tz);
        if (gy >= 2.1 && !isNearTeleport(tx, tz, 9.5) && tryReserve(tx, tz)) {
          const inf = roads.getRoadInfluence(tx, tz, 16, true);
          if (!inf || inf.edgeDist >= 2.2) {
            const dist = getDistrictAt(tx, tz).id;
            const usePalm =
              dist === "west_coast" || dist === "downtown" || dist === "south_airport" || (dist === "midtown" && rng() > 0.45);
            const scale = 0.85 + rng() * 0.35;
            batcher.addInstance(usePalm ? "palm_tree" : "oak_tree", {
              x: tx,
              y: gy,
              z: tz,
              ry: rng() * Math.PI * 2,
              scale,
              hueShift: (rng() - 0.5) * 0.08,
            });
          }
        }
      }
    }
  }

  // 2. Signalized Intersection Traffic Lights
  for (const node of roads.getNodes()) {
    if (node.kind !== "signal") continue;
    const sx = node.x + 11.5;
    const sz = node.z + 11.5;
    const gy = terrainAt(sx, sz);
    if (gy >= 2.0 && !isNearTeleport(sx, sz) && tryReserve(sx, sz)) {
      batcher.addInstance("traffic_light", { x: sx, y: gy, z: sz, ry: Math.PI * 0.75 });
    }
  }

  // 3. Mirror Central Park, University Quad, & Foothills Organic Tree Groves
  const parkZones = [
    { cx: -115, cz: 395, rx: 52, rz: 48, count: 32, palmChance: 0.15, avoidCenterR: 28 },
    { cx: -165, cz: -362, rx: 38, rz: 28, count: 18, palmChance: 0.25, avoidCenterR: 16 },
    { cx: -220, cz: -790, rx: 240, rz: 90, count: 48, palmChance: 0.1, avoidCenterR: 0 },
  ];
  for (const pz of parkZones) {
    for (let i = 0; i < pz.count; i++) {
      const ox = (rng() - 0.5) * 2 * pz.rx;
      const oz = (rng() - 0.5) * 2 * pz.rz;
      if (pz.avoidCenterR > 0 && Math.hypot(ox, oz) < pz.avoidCenterR) continue;
      const tx = pz.cx + ox;
      const tz = pz.cz + oz;
      const gy = terrainAt(tx, tz);
      if (gy < 2.2 || isNearTeleport(tx, tz, 10)) continue;
      const inf = roads.getRoadInfluence(tx, tz, 18, true);
      if (inf && inf.edgeDist < 4.0) continue;
      if (!tryReserve(tx, tz)) continue;
      batcher.addInstance(rng() < pz.palmChance ? "palm_tree" : "oak_tree", {
        x: tx,
        y: gy,
        z: tz,
        ry: rng() * Math.PI * 2,
        scale: 0.85 + rng() * 0.4,
        hueShift: (rng() - 0.5) * 0.08,
      });
    }
  }

  // 4. Parked Cars along RoadNetwork ParkedBaySlots (~42% occupancy)
  for (const bay of roads.getParkedBays()) {
    if (rng() > 0.42) continue;
    const gy = terrainAt(bay.x, bay.z);
    if (gy < 2.2 || isNearTeleport(bay.x, bay.z, 9.0)) continue;
    if (!tryReserve(bay.x, bay.z)) continue;
    const colorHex = CAR_PALETTE[Math.floor(rng() * CAR_PALETTE.length)];
    batcher.addInstance("parked_car", {
      x: bay.x,
      y: gy,
      z: bay.z,
      ry: bay.yaw + (rng() > 0.5 ? 0 : Math.PI),
      colorHex,
    });
  }

  // 5. Downtown & Midtown Sidewalk Hydrants
  for (const seg of roads.getSegments()) {
    if (seg.spec.isBridge || seg.spec.tier !== "arterial") continue;
    for (let i = 2; i < seg.samples.length - 2; i += 14) {
      const sp = seg.samples[i];
      const dist = getDistrictAt(sp.x, sp.z).id;
      if (dist !== "downtown" && dist !== "midtown") continue;
      const hx = sp.x + sp.rx * (seg.totalWidth * 0.5 + 1.2);
      const hz = sp.z + sp.rz * (seg.totalWidth * 0.5 + 1.2);
      const gy = terrainAt(hx, hz);
      if (gy >= 2.2 && !isNearTeleport(hx, hz, 8) && tryReserve(hx, hz)) {
        batcher.addInstance("hydrant", { x: hx, y: gy, z: hz });
      }
    }
  }
}
