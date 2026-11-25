import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { materialFor } from "../kit/surface";
import { RoadNetwork, type RoadNodeSpec, type RoadSegmentSpec } from "./RoadNetwork";
import type { TerrainHeightFn } from "./HeightSystem";
import { SpatialAABBGrid } from "./SpatialIndex";

export const WESTGATE_NODES: RoadNodeSpec[] = [
  // 5 District Roundabouts
  { id: "rb_legion", x: 60, y: 4.5, z: -80, kind: "roundabout", radius: 22 },
  { id: "rb_midtown", x: -260, y: 4.5, z: -140, kind: "roundabout", radius: 20 },
  { id: "rb_coast", x: -700, y: 2.8, z: -110, kind: "roundabout", radius: 18 },
  { id: "rb_oldquarter", x: -220, y: 5.2, z: 280, kind: "roundabout", radius: 18 },
  { id: "rb_industrial", x: 740, y: 2.8, z: -40, kind: "roundabout", radius: 20 },

  // Freeway Interchanges & Merges
  { id: "n_fw_nw", x: -710, y: 4.5, z: -920, kind: "merge" },
  { id: "n_fw_north_mid", x: -420, y: 5.5, z: -560, kind: "merge" },
  { id: "n_fw_north_east", x: 400, y: 5.5, z: -540, kind: "merge" },
  { id: "n_fw_ne_corner", x: 820, y: 4.5, z: -720, kind: "merge" },
  { id: "n_fw_south_jct", x: 280, y: 5.2, z: 560, kind: "merge" },
  { id: "n_fw_east_port", x: 980, y: 4.2, z: 520, kind: "merge" },
  { id: "n_fw_airport", x: -80, y: 2.6, z: 880, kind: "signal" },

  // Arterial & Collector Signal Junctions / Cul-de-sacs
  { id: "n_dt_north", x: 70, y: 5.2, z: -420, kind: "signal" },
  { id: "n_dt_south", x: 90, y: 4.5, z: 200, kind: "signal" },
  { id: "n_dt_airport_link", x: -40, y: 3.2, z: 540, kind: "signal" },
  { id: "n_airport_hub", x: -120, y: 2.6, z: 840, kind: "signal" },
  { id: "n_coast_south", x: -630, y: 2.6, z: 600, kind: "signal" },
  { id: "n_midtown_north", x: -340, y: 4.8, z: -420, kind: "signal" },
  { id: "n_canyon_west", x: -460, y: 12.0, z: -640, kind: "signal" },
  { id: "n_canyon_mid", x: -120, y: 11.0, z: -660, kind: "signal" },
  { id: "n_canyon_br_w", x: 300, y: 14.5, z: -632, kind: "signal" },
  { id: "n_canyon_br_e", x: 590, y: 12.5, z: -605, kind: "signal" },
  { id: "n_canyon_east", x: 740, y: 6.5, z: -580, kind: "signal" },
  { id: "n_obs_summit", x: -120, y: 68.0, z: -980, kind: "culdesac" },
  { id: "n_east_mid", x: 760, y: 2.8, z: 280, kind: "signal" },
  { id: "n_east_south", x: 790, y: 2.8, z: 520, kind: "signal" },
  { id: "n_dt_east_col", x: 290, y: 4.5, z: 260, kind: "signal" },
  { id: "n_suburb_cul", x: -310, y: 5.6, z: 560, kind: "culdesac" },
  { id: "n_foothill_mansion_e", x: 280, y: 26.0, z: -760, kind: "culdesac" },
];

export const WESTGATE_SEGMENTS: RoadSegmentSpec[] = [
  // ================= TIER 1: FREEWAYS & INTERCHANGE RAMPS =================
  {
    id: "fw_north_arc",
    name: "North Foothills Beltway",
    tier: "freeway",
    startNodeId: "n_fw_nw",
    endNodeId: "n_fw_north_mid",
    points: [
      [-710, 4.5, -920],
      [-640, 5.2, -740],
      [-520, 5.5, -620],
      [-420, 5.5, -560],
    ],
  },
  {
    id: "fw_north_cross",
    name: "Crosstown Expressway North",
    tier: "freeway",
    startNodeId: "n_fw_north_mid",
    endNodeId: "n_fw_north_east",
    points: [
      [-420, 5.5, -560],
      [-160, 5.5, -510],
      [140, 5.5, -500],
      [400, 5.5, -540],
    ],
  },
  {
    id: "fw_ne_bend",
    name: "Northeast Freeway Bend",
    tier: "freeway",
    startNodeId: "n_fw_north_east",
    endNodeId: "n_fw_ne_corner",
    points: [
      [400, 5.5, -540],
      [620, 5.0, -610],
      [820, 4.5, -720],
    ],
  },
  {
    id: "fw_east_belt",
    name: "East Port Expressway",
    tier: "freeway",
    startNodeId: "n_fw_ne_corner",
    endNodeId: "n_fw_east_port",
    points: [
      [820, 4.5, -720],
      [910, 3.8, -320],
      [950, 3.6, 120],
      [980, 4.2, 520],
    ],
  },
  // BRIDGE 3: Midtown Elevated Freeway Flyover Viaduct
  {
    id: "fw_midtown_viaduct",
    name: "Midtown Skyway Viaduct",
    tier: "freeway",
    isBridge: true,
    startNodeId: "n_fw_north_mid",
    endNodeId: "n_fw_south_jct",
    points: [
      [-420, 5.5, -560],
      [-330, 10.8, -380],
      [-210, 12.6, -140],
      [-60, 12.6, 60],
      [120, 11.4, 300],
      [280, 5.2, 560],
    ],
  },
  // BRIDGE 1: Westgate Harbor Cable-Stayed Bay Bridge
  {
    id: "fw_harbor_bridge",
    name: "Westgate Bay Bridge",
    tier: "freeway",
    isBridge: true,
    startNodeId: "n_fw_south_jct",
    endNodeId: "n_fw_east_port",
    points: [
      [280, 5.2, 560],
      [380, 11.0, 612],
      [505, 16.8, 636],
      [665, 17.4, 636],
      [825, 13.5, 608],
      [925, 7.2, 558],
      [980, 4.2, 520],
    ],
  },
  {
    id: "fw_airport_spur",
    name: "Airport Expressway Spur",
    tier: "freeway",
    startNodeId: "n_fw_south_jct",
    endNodeId: "n_fw_airport",
    points: [
      [280, 5.2, 560],
      [145, 3.6, 750],
      [-80, 2.6, 880],
    ],
  },

  // Freeway On/Off Ramps (connecting Freeway <-> Arterials cleanly)
  {
    id: "ramp_midtown_north",
    tier: "ramp",
    startNodeId: "n_fw_north_mid",
    endNodeId: "n_midtown_north",
    points: [
      [-420, 5.5, -560],
      [-395, 5.1, -485],
      [-340, 4.8, -420],
    ],
  },
  {
    id: "ramp_downtown_north",
    tier: "ramp",
    startNodeId: "n_fw_north_mid",
    endNodeId: "n_dt_north",
    points: [
      [-180, 5.5, -512],
      [-55, 5.3, -468],
      [70, 5.2, -420],
    ],
  },
  {
    id: "ramp_south_port",
    tier: "ramp",
    startNodeId: "n_fw_east_port",
    endNodeId: "n_east_south",
    points: [
      [980, 4.2, 520],
      [885, 3.4, 525],
      [790, 2.8, 520],
    ],
  },
  {
    id: "ramp_south_airport",
    tier: "ramp",
    startNodeId: "n_fw_south_jct",
    endNodeId: "n_dt_airport_link",
    points: [
      [280, 5.2, 560],
      [115, 4.0, 550],
      [-40, 3.2, 540],
    ],
  },

  // ================= TIER 2: CURVED ARTERIAL BOULEVARDS =================
  {
    id: "art_coast_pkwy_n",
    name: "Pacific Coastal Parkway North",
    tier: "arterial",
    startNodeId: "n_fw_nw",
    endNodeId: "rb_coast",
    points: [
      [-710, 4.5, -920],
      [-745, 3.4, -640],
      [-715, 2.9, -360],
      [-700, 2.8, -130],
    ],
  },
  {
    id: "art_coast_pkwy_s",
    name: "Pacific Coastal Parkway South",
    tier: "arterial",
    startNodeId: "rb_coast",
    endNodeId: "n_coast_south",
    points: [
      [-700, 2.8, -90],
      [-702, 2.8, 120],
      [-682, 2.7, 360],
      [-630, 2.6, 600],
    ],
  },
  {
    id: "art_coast_airport",
    name: "South Bay Coastal Boulevard",
    tier: "arterial",
    startNodeId: "n_coast_south",
    endNodeId: "n_airport_hub",
    points: [
      [-630, 2.6, 600],
      [-510, 2.6, 760],
      [-320, 2.6, 825],
      [-120, 2.6, 840],
    ],
  },
  {
    id: "art_midtown_west",
    name: "Del Sol Avenue",
    tier: "arterial",
    startNodeId: "rb_coast",
    endNodeId: "rb_midtown",
    points: [
      [-680, 2.8, -110],
      [-540, 3.6, -135],
      [-400, 4.3, -142],
      [-282, 4.5, -140],
    ],
  },
  {
    id: "art_midtown_ew",
    name: "Westgate Central Boulevard",
    tier: "arterial",
    startNodeId: "rb_midtown",
    endNodeId: "rb_legion",
    points: [
      [-238, 4.5, -138],
      [-150, 4.5, -118],
      [-55, 4.5, -98],
      [36, 4.5, -82],
    ],
  },
  // BRIDGE 2: Downtown Arch Viaduct across the Westgate River
  {
    id: "art_arch_bridge",
    name: "Legion Arch Viaduct",
    tier: "arterial",
    isBridge: true,
    startNodeId: "rb_legion",
    endNodeId: "rb_industrial",
    points: [
      [84, 4.5, -78],
      [230, 4.8, -66],
      [375, 7.6, -56],
      [518, 11.4, -46],
      [645, 6.2, -42],
      [718, 2.8, -40],
    ],
  },
  {
    id: "art_downtown_n",
    name: "Vinewood Financial Avenue North",
    tier: "arterial",
    startNodeId: "n_dt_north",
    endNodeId: "rb_legion",
    points: [
      [70, 5.2, -420],
      [78, 4.8, -260],
      [62, 4.5, -104],
    ],
  },
  {
    id: "art_downtown_s",
    name: "Civic Center Avenue South",
    tier: "arterial",
    startNodeId: "rb_legion",
    endNodeId: "n_dt_south",
    points: [
      [64, 4.5, -56],
      [84, 4.5, 65],
      [90, 4.5, 200],
    ],
  },
  {
    id: "art_south_connector",
    name: "South Metro Arterial",
    tier: "arterial",
    startNodeId: "n_dt_south",
    endNodeId: "n_dt_airport_link",
    points: [
      [90, 4.5, 200],
      [42, 4.0, 380],
      [-40, 3.2, 540],
    ],
  },
  {
    id: "art_airport_approach",
    name: "Terminal Approach Boulevard",
    tier: "arterial",
    startNodeId: "n_dt_airport_link",
    endNodeId: "n_airport_hub",
    points: [
      [-40, 3.2, 540],
      [-92, 2.8, 690],
      [-120, 2.6, 840],
    ],
  },
  {
    id: "art_oldquarter_w",
    name: "Midtown Crescent West",
    tier: "arterial",
    startNodeId: "rb_midtown",
    endNodeId: "rb_oldquarter",
    points: [
      [-265, 4.5, -118],
      [-305, 4.9, 65],
      [-236, 5.2, 260],
    ],
  },
  {
    id: "art_oldquarter_e",
    name: "Old Quarter Promenade",
    tier: "arterial",
    startNodeId: "rb_oldquarter",
    endNodeId: "n_dt_south",
    points: [
      [-200, 5.2, 275],
      [-55, 4.9, 240],
      [90, 4.5, 200],
    ],
  },
  {
    id: "art_canyon_west",
    name: "Foothills Scenic Drive West",
    tier: "arterial",
    startNodeId: "n_canyon_west",
    endNodeId: "n_canyon_mid",
    points: [
      [-460, 12.0, -640],
      [-310, 11.4, -665],
      [-120, 11.0, -660],
    ],
  },
  {
    id: "art_canyon_approach",
    name: "Foothills Scenic Drive Mid",
    tier: "arterial",
    startNodeId: "n_canyon_mid",
    endNodeId: "n_canyon_br_w",
    points: [
      [-120, 11.0, -660],
      [95, 11.8, -646],
      [300, 14.5, -632],
    ],
  },
  // BRIDGE 4: North Canyon Steel Truss Bridge
  {
    id: "art_canyon_bridge",
    name: "North Gorge Truss Bridge",
    tier: "arterial",
    isBridge: true,
    startNodeId: "n_canyon_br_w",
    endNodeId: "n_canyon_br_e",
    points: [
      [300, 14.5, -632],
      [435, 16.6, -622],
      [590, 12.5, -605],
    ],
  },
  {
    id: "art_canyon_east",
    name: "Foothills Scenic Drive East",
    tier: "arterial",
    startNodeId: "n_canyon_br_e",
    endNodeId: "n_canyon_east",
    points: [
      [590, 12.5, -605],
      [665, 9.2, -592],
      [740, 6.5, -580],
    ],
  },
  {
    id: "art_east_quay_n",
    name: "East Industrial Boulevard North",
    tier: "arterial",
    startNodeId: "n_canyon_east",
    endNodeId: "rb_industrial",
    points: [
      [740, 6.5, -580],
      [755, 3.8, -310],
      [742, 2.8, -62],
    ],
  },
  {
    id: "art_east_quay_s",
    name: "Seaport Freight Corridor",
    tier: "arterial",
    startNodeId: "rb_industrial",
    endNodeId: "n_east_mid",
    points: [
      [744, 2.8, -18],
      [756, 2.8, 130],
      [760, 2.8, 280],
    ],
  },
  {
    id: "art_east_port_dock",
    name: "Harbor Quay Boulevard",
    tier: "arterial",
    startNodeId: "n_east_mid",
    endNodeId: "n_east_south",
    points: [
      [760, 2.8, 280],
      [776, 2.8, 405],
      [790, 2.8, 520],
    ],
  },

  // ================= TIER 3: DISTRICT COLLECTORS =================
  {
    id: "col_midtown_loop",
    name: "University & Medical Collector",
    tier: "collector",
    startNodeId: "n_midtown_north",
    endNodeId: "rb_midtown",
    points: [
      [-340, 4.8, -420],
      [-415, 4.6, -300],
      [-350, 4.5, -210],
      [-276, 4.5, -155],
    ],
  },
  {
    id: "col_downtown_east",
    name: "Civic Precinct & Hospital Loop",
    tier: "collector",
    startNodeId: "n_dt_north",
    endNodeId: "n_dt_south",
    points: [
      [70, 5.2, -420],
      [230, 4.8, -310],
      [285, 4.5, -140],
      [275, 4.5, 110],
      [90, 4.5, 200],
    ],
  },
  {
    id: "col_downtown_river_south",
    name: "Riverside Collector",
    tier: "collector",
    startNodeId: "n_dt_south",
    endNodeId: "n_dt_east_col",
    points: [
      [90, 4.5, 200],
      [195, 4.5, 232],
      [290, 4.5, 260],
    ],
  },
  // BRIDGE 5: East Industrial Steel Girder / Bascule Bridge
  {
    id: "col_industrial_bridge",
    name: "Cypress Industrial Bascule Bridge",
    tier: "collector",
    isBridge: true,
    startNodeId: "n_dt_east_col",
    endNodeId: "n_east_mid",
    points: [
      [290, 4.5, 260],
      [390, 6.6, 271],
      [525, 8.8, 280],
      [660, 6.2, 280],
      [760, 2.8, 280],
    ],
  },
  {
    id: "col_canals_loop",
    name: "Westgate Canals Promenade",
    tier: "collector",
    startNodeId: "rb_coast",
    endNodeId: "n_coast_south",
    points: [
      [-684, 2.8, -96],
      [-515, 3.2, 65],
      [-488, 3.2, 250],
      [-510, 3.0, 445],
      [-630, 2.6, 600],
    ],
  },
  {
    id: "col_observatory_switchback",
    name: "Observatory Canyon Switchback",
    tier: "collector",
    startNodeId: "n_canyon_mid",
    endNodeId: "n_obs_summit",
    points: [
      [-120, 11.0, -660],
      [-310, 24.0, -750],
      [-40, 40.0, -835],
      [-255, 56.0, -915],
      [-120, 68.0, -980],
    ],
  },
  {
    id: "col_airport_loop",
    name: "Westgate International Terminal Loop",
    tier: "collector",
    startNodeId: "n_airport_hub",
    endNodeId: "n_fw_airport",
    points: [
      [-120, 2.6, 840],
      [-335, 2.6, 915],
      [-165, 2.6, 1015],
      [115, 2.6, 965],
      [-80, 2.6, 880],
    ],
  },

  // ================= TIER 4: LOCAL CRESCENTS & CUL-DE-SACS =================
  {
    id: "loc_oldquarter_crescent",
    name: "Mirror Park Crescent",
    tier: "local",
    startNodeId: "rb_oldquarter",
    endNodeId: "n_suburb_cul",
    points: [
      [-232, 5.2, 298],
      [-348, 5.6, 375],
      [-405, 6.0, 485],
      [-310, 5.6, 560],
    ],
  },
  {
    id: "loc_foothills_estates",
    name: "Vinewood Crest Drive",
    tier: "local",
    startNodeId: "n_canyon_west",
    endNodeId: "n_foothill_mansion_e",
    points: [
      [-460, 12.0, -640],
      [-420, 27.0, -785],
      [-220, 38.0, -820],
      [60, 34.0, -805],
      [280, 26.0, -760],
    ],
  },
];

export function populateWestgateRoads(roads: RoadNetwork): void {
  roads.addNodes(WESTGATE_NODES);
  roads.addSegments(WESTGATE_SEGMENTS);
}

function makeStrut(
  a: THREE.Vector3,
  b: THREE.Vector3,
  rTop: number,
  rBot: number,
  mat: THREE.Material,
): THREE.Mesh {
  const dir = new THREE.Vector3().subVectors(b, a);
  const len = Math.max(0.05, dir.length());
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(rTop, rBot, len, 8), mat);
  mesh.position.addVectors(a, b).multiplyScalar(0.5);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

const bridgeGlowMats: THREE.MeshStandardMaterial[] = [];
const bridgeBeaconMats: THREE.MeshStandardMaterial[] = [];

export function setBridgeLandmarkDarkness(darkness: number): void {
  const d = Math.max(0, Math.min(1, darkness));
  const glow = 0.25 + d * 3.4;
  const beacon = 1.0 + d * 3.2;
  for (let i = 0; i < bridgeGlowMats.length; i++) bridgeGlowMats[i].emissiveIntensity = glow;
  for (let i = 0; i < bridgeBeaconMats.length; i++) bridgeBeaconMats[i].emissiveIntensity = beacon;
}

/**
 * Builds the 5 roundabout islands + architectural superstructures for all 5 bridges
 * (cable-stayed pylons & cables, parabolic arch ribs, flyover gantries, canyon trusses, bascule lift towers).
 */
export function buildWestgateRoadLandmarks(
  parent: THREE.Object3D,
  roads: RoadNetwork,
  terrainAt: TerrainHeightFn,
  collidersOut?: THREE.Object3D[],
  spatialAABBs?: SpatialAABBGrid,
): THREE.Group {
  const group = new THREE.Group();
  group.name = "WestgateRoadLandmarks";

  const asphaltMat = materialFor(0x2b2e33, { roughness: 0.86, metalness: 0.04, family: "asphalt", seed: 601, repeat: 6 });
  const curbMat = materialFor(0xa6aba8, { roughness: 0.84, metalness: 0.04, family: "stone", seed: 602, repeat: 4 });
  const turfMat = materialFor(0x456b3b, { roughness: 0.94, family: "grass", seed: 603, repeat: 6 });
  const flowerMat = materialFor(0x376632, { roughness: 0.9, family: "grass", seed: 604, repeat: 3 });
  const waterMat = new THREE.MeshStandardMaterial({
    color: 0x228ba8,
    emissive: 0x11495c,
    emissiveIntensity: 0.4,
    roughness: 0.1,
    metalness: 0.55,
  });
  const bronzeMat = materialFor(0xb08a48, { roughness: 0.34, metalness: 0.84, family: "metal", seed: 605 });
  const pylonOrangeMat = materialFor(0xc2492d, { roughness: 0.5, metalness: 0.35, family: "metal", seed: 606 });
  const cableMat = materialFor(0xd0d7e0, { roughness: 0.35, metalness: 0.8, family: "metal", seed: 607 });
  const steelDarkMat = materialFor(0x3b424c, { roughness: 0.45, metalness: 0.78, family: "metal", seed: 608 });
  const archWhiteMat = materialFor(0xd9dde3, { roughness: 0.65, metalness: 0.18, family: "concrete", seed: 609 });
  const warmGlowMat = new THREE.MeshStandardMaterial({
    color: 0xfff3d1,
    emissive: 0xffc663,
    emissiveIntensity: 0.25,
    roughness: 0.2,
  });
  const beaconMat = new THREE.MeshStandardMaterial({
    color: 0xff3b30,
    emissive: 0xff2a1f,
    emissiveIntensity: 1.0,
    roughness: 0.25,
  });
  bridgeGlowMats.push(warmGlowMat);
  bridgeBeaconMats.push(beaconMat);
  const gantryGreenMat = new THREE.MeshStandardMaterial({ color: 0x1e5638, roughness: 0.55, metalness: 0.15 });
  const hazardYellowMat = new THREE.MeshStandardMaterial({ color: 0xe6a825, roughness: 0.5, metalness: 0.3 });

  const registerSolid = (m: THREE.Object3D) => {
    collidersOut?.push(m);
    if (spatialAABBs) {
      m.updateWorldMatrix(true, false);
      spatialAABBs.insert(new THREE.Box3().setFromObject(m));
    }
  };

  // 1. Roundabout circular carriageways, stepped stone curbs, landscaped rings & tiered civic fountains
  for (const node of roads.getNodes()) {
    if (node.kind !== "roundabout") continue;
    const r = node.radius ?? 18;
    const innerR = Math.max(4, r - 5.5);
    const outerR = r + 7.0;

    const ringGeo = new THREE.RingGeometry(innerR, outerR, 40);
    ringGeo.rotateX(-Math.PI / 2);
    const ring = new THREE.Mesh(ringGeo, asphaltMat);
    ring.position.set(node.x, node.y + 0.045, node.z);
    ring.receiveShadow = true;
    group.add(ring);

    // Outer stepped curb + inner textured turf lawn
    const island = new THREE.Mesh(new THREE.CylinderGeometry(innerR, innerR + 0.25, 0.28, 36), curbMat);
    island.position.set(node.x, node.y + 0.14, node.z);
    island.receiveShadow = true;
    group.add(island);

    const lawn = new THREE.Mesh(new THREE.CylinderGeometry(innerR - 0.55, innerR - 0.55, 0.3, 36), turfMat);
    lawn.position.set(node.x, node.y + 0.15, node.z);
    lawn.receiveShadow = true;
    group.add(lawn);

    // Sculpted shrub border ring + 6 stone bollards with warm uplights
    const hedgeRing = new THREE.Mesh(new THREE.TorusGeometry(innerR - 1.6, 0.42, 8, 28), flowerMat);
    hedgeRing.rotation.x = Math.PI * 0.5;
    hedgeRing.position.set(node.x, node.y + 0.42, node.z);
    hedgeRing.castShadow = true;
    hedgeRing.receiveShadow = true;
    group.add(hedgeRing);

    for (let b = 0; b < 6; b++) {
      const a = (b / 6) * Math.PI * 2;
      const bx = node.x + Math.cos(a) * (innerR - 0.9);
      const bz = node.z + Math.sin(a) * (innerR - 0.9);
      const bollard = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.2, 0.85, 8), steelDarkMat);
      bollard.position.set(bx, node.y + 0.58, bz);
      bollard.castShadow = true;
      group.add(bollard);
      const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 0.14, 8), warmGlowMat);
      cap.position.set(bx, node.y + 0.94, bz);
      group.add(cap);
    }

    // Tiered granite fountain basin + turquoise water + bronze civic sculpture column
    const basinOuter = new THREE.Mesh(new THREE.CylinderGeometry(4.4, 4.7, 0.65, 24), curbMat);
    basinOuter.position.set(node.x, node.y + 0.52, node.z);
    basinOuter.castShadow = true;
    basinOuter.receiveShadow = true;
    basinOuter.userData.kind = "concrete";
    group.add(basinOuter);
    registerSolid(basinOuter);

    const pool = new THREE.Mesh(new THREE.CylinderGeometry(3.85, 3.85, 0.14, 24), waterMat);
    pool.position.set(node.x, node.y + 0.84, node.z);
    group.add(pool);

    const stepPlinth = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 1.9, 1.4, 12), curbMat);
    stepPlinth.position.set(node.x, node.y + 1.4, node.z);
    stepPlinth.castShadow = true;
    stepPlinth.userData.kind = "concrete";
    group.add(stepPlinth);
    registerSolid(stepPlinth);

    const upperBowl = new THREE.Mesh(new THREE.CylinderGeometry(1.85, 0.85, 0.55, 16), curbMat);
    upperBowl.position.set(node.x, node.y + 2.25, node.z);
    upperBowl.castShadow = true;
    group.add(upperBowl);

    const spire = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.62, 3.6, 12), archWhiteMat);
    spire.position.set(node.x, node.y + 4.1, node.z);
    spire.castShadow = true;
    spire.userData.kind = "concrete";
    group.add(spire);
    registerSolid(spire);

    const finial = new THREE.Mesh(new THREE.OctahedronGeometry(0.55, 1), bronzeMat);
    finial.scale.set(0.85, 1.45, 0.85);
    finial.position.set(node.x, node.y + 6.3, node.z);
    finial.castShadow = true;
    group.add(finial);
  }

  // 2. BRIDGE 1: Westgate Golden Cable-Stayed Bay Bridge
  const br1 = roads.getSegment("fw_harbor_bridge");
  if (br1) {
    const halfW = br1.carriagewayWidth * 0.5 + 0.9;
    for (const tTower of [0.35, 0.65]) {
      const p = br1.curve.getPointAt(tTower);
      const tan = br1.curve.getTangentAt(tTower);
      const rx = -tan.z / (Math.hypot(tan.x, tan.z) || 1);
      const rz = tan.x / (Math.hypot(tan.x, tan.z) || 1);

      const baseTop = p.y;
      const gY = Math.min(0, terrainAt(p.x, p.z));
      const legBotY = gY - 1.0;
      const towerTopY = baseTop + 34.0;

      const leftBot = new THREE.Vector3(p.x - rx * halfW, legBotY, p.z - rz * halfW);
      const rightBot = new THREE.Vector3(p.x + rx * halfW, legBotY, p.z + rz * halfW);
      const leftTop = new THREE.Vector3(p.x - rx * (halfW * 0.68), towerTopY, p.z - rz * (halfW * 0.68));
      const rightTop = new THREE.Vector3(p.x + rx * (halfW * 0.68), towerTopY, p.z + rz * (halfW * 0.68));

      const legL = makeStrut(leftBot, leftTop, 1.05, 1.65, pylonOrangeMat);
      const legR = makeStrut(rightBot, rightTop, 1.05, 1.65, pylonOrangeMat);
      const crossTop = makeStrut(
        leftTop.clone().setY(towerTopY - 2.5),
        rightTop.clone().setY(towerTopY - 2.5),
        0.85,
        0.85,
        pylonOrangeMat,
      );
      const crossMid = makeStrut(
        leftBot.clone().lerp(leftTop, 0.56),
        rightBot.clone().lerp(rightTop, 0.56),
        0.75,
        0.75,
        pylonOrangeMat,
      );
      group.add(legL, legR, crossTop, crossMid);
      registerSolid(legL);
      registerSolid(legR);

      // Aviation warning beacons at tower crowns
      for (const topPt of [leftTop, rightTop]) {
        const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.55, 10, 8), beaconMat);
        beacon.position.set(topPt.x, topPt.y + 0.65, topPt.z);
        group.add(beacon);
      }

      // Splayed steel stay cables
      for (let k = -5; k <= 5; k++) {
        if (k === 0) continue;
        const ct = Math.max(0.06, Math.min(0.94, tTower + k * 0.025));
        const dp = br1.curve.getPointAt(ct);
        const dtan = br1.curve.getTangentAt(ct);
        const drx = -dtan.z / (Math.hypot(dtan.x, dtan.z) || 1);
        const drz = dtan.x / (Math.hypot(dtan.x, dtan.z) || 1);
        const anchorH = towerTopY - Math.abs(k) * 2.1;

        const cL = makeStrut(
          new THREE.Vector3(leftTop.x, anchorH, leftTop.z),
          new THREE.Vector3(dp.x - drx * (halfW - 0.5), dp.y + 0.4, dp.z - drz * (halfW - 0.5)),
          0.1,
          0.1,
          cableMat,
        );
        const cR = makeStrut(
          new THREE.Vector3(rightTop.x, anchorH, rightTop.z),
          new THREE.Vector3(dp.x + drx * (halfW - 0.5), dp.y + 0.4, dp.z + drz * (halfW - 0.5)),
          0.1,
          0.1,
          cableMat,
        );
        group.add(cL, cR);
      }
    }
  }

  // 3. BRIDGE 2: Downtown Arch Viaduct (parabolic ribs & hangers)
  const br2 = roads.getSegment("art_arch_bridge");
  if (br2) {
    const halfW = br2.carriagewayWidth * 0.5 + 0.5;
    const tStart = 0.25;
    const tEnd = 0.85;
    const steps = 16;
    for (const side of [-1, 1] as const) {
      let prevPt: THREE.Vector3 | null = null;
      for (let i = 0; i <= steps; i++) {
        const u = i / steps;
        const t = tStart + (tEnd - tStart) * u;
        const dp = br2.curve.getPointAt(t);
        const dtan = br2.curve.getTangentAt(t);
        const hl = Math.hypot(dtan.x, dtan.z) || 1;
        const rx = -dtan.z / hl;
        const rz = dtan.x / hl;
        const archRise = Math.sin(u * Math.PI) * 16.5;
        const pt = new THREE.Vector3(dp.x + rx * side * halfW, dp.y + archRise, dp.z + rz * side * halfW);
        if (prevPt) {
          const rib = makeStrut(prevPt, pt, 0.55, 0.55, archWhiteMat);
          group.add(rib);
        }
        if (i > 1 && i < steps - 1 && i % 2 === 0) {
          const deckAnchor = new THREE.Vector3(dp.x + rx * side * halfW, dp.y + 0.3, dp.z + rz * side * halfW);
          group.add(makeStrut(pt, deckAnchor, 0.11, 0.11, cableMat));
          if (side === -1 && i >= 4 && i <= steps - 4) {
            const oppPt = new THREE.Vector3(dp.x + rx * halfW, dp.y + archRise, dp.z + rz * halfW);
            group.add(makeStrut(pt, oppPt, 0.24, 0.24, archWhiteMat));
          }
        }
        prevPt = pt;
      }
    }
  }

  // 4. FREEWAY OVERHEAD DIRECTIONAL SIGN GANTRIES (Midtown Viaduct + Coast & Harbor Freeways)
  for (const [segId, tSamples] of [
    ["fw_midtown_viaduct", [0.35, 0.68]],
    ["fw_coast_south", [0.45]],
    ["fw_harbor_east", [0.5]],
  ] as const) {
    const br3 = roads.getSegment(segId);
    if (!br3) continue;
    const halfW = br3.carriagewayWidth * 0.5 + 0.8;
    for (const tG of tSamples) {
      const dp = br3.curve.getPointAt(tG);
      const dtan = br3.curve.getTangentAt(tG);
      const hl = Math.hypot(dtan.x, dtan.z) || 1;
      const rx = -dtan.z / hl;
      const rz = dtan.x / hl;
      const yaw = Math.atan2(dtan.x, dtan.z);

      const postL = makeStrut(
        new THREE.Vector3(dp.x - rx * halfW, dp.y, dp.z - rz * halfW),
        new THREE.Vector3(dp.x - rx * halfW, dp.y + 6.4, dp.z - rz * halfW),
        0.22,
        0.25,
        steelDarkMat,
      );
      const postR = makeStrut(
        new THREE.Vector3(dp.x + rx * halfW, dp.y, dp.z + rz * halfW),
        new THREE.Vector3(dp.x + rx * halfW, dp.y + 6.4, dp.z + rz * halfW),
        0.22,
        0.25,
        steelDarkMat,
      );
      const beam = makeStrut(
        new THREE.Vector3(dp.x - rx * halfW, dp.y + 6.2, dp.z - rz * halfW),
        new THREE.Vector3(dp.x + rx * halfW, dp.y + 6.2, dp.z + rz * halfW),
        0.2,
        0.2,
        steelDarkMat,
      );
      const sign = new THREE.Mesh(new THREE.BoxGeometry(10.5, 2.2, 0.25), gantryGreenMat);
      sign.position.set(dp.x, dp.y + 6.1, dp.z);
      sign.rotation.y = yaw;
      sign.castShadow = true;
      const signTrim = new THREE.Mesh(new THREE.BoxGeometry(10.8, 2.45, 0.14), archWhiteMat);
      signTrim.position.set(dp.x, dp.y + 6.1, dp.z);
      signTrim.rotation.y = yaw;
      group.add(postL, postR, beam, signTrim, sign);
    }
  }

  // 5. BRIDGE 4: North Canyon Steel Warren Truss Bridge
  const br4 = roads.getSegment("art_canyon_bridge");
  if (br4) {
    const halfW = br4.carriagewayWidth * 0.5 + 0.7;
    const bays = 12;
    const trussH = 6.2;
    for (const side of [-1, 1] as const) {
      let prevBot: THREE.Vector3 | null = null;
      let prevTop: THREE.Vector3 | null = null;
      for (let i = 0; i <= bays; i++) {
        const t = 0.05 + (0.9 * i) / bays;
        const dp = br4.curve.getPointAt(t);
        const dtan = br4.curve.getTangentAt(t);
        const hl = Math.hypot(dtan.x, dtan.z) || 1;
        const rx = -dtan.z / hl;
        const rz = dtan.x / hl;

        const bot = new THREE.Vector3(dp.x + rx * side * halfW, dp.y + 0.3, dp.z + rz * side * halfW);
        const top = new THREE.Vector3(dp.x + rx * side * halfW, dp.y + trussH, dp.z + rz * side * halfW);
        group.add(makeStrut(bot, top, 0.22, 0.24, steelDarkMat));
        if (prevBot && prevTop) {
          group.add(makeStrut(prevTop, top, 0.24, 0.24, steelDarkMat));
          group.add(makeStrut(prevBot, top, 0.16, 0.16, steelDarkMat));
          group.add(makeStrut(prevTop, bot, 0.16, 0.16, steelDarkMat));
        }
        if (side === -1 && i % 2 === 0) {
          const oppTop = new THREE.Vector3(dp.x - rx * halfW, dp.y + trussH, dp.z - rz * halfW);
          const curTop = new THREE.Vector3(dp.x + rx * halfW, dp.y + trussH, dp.z + rz * halfW);
          group.add(makeStrut(curTop, oppTop, 0.2, 0.2, steelDarkMat));
        }
        prevBot = bot;
        prevTop = top;
      }
    }
  }

  // 6. BRIDGE 5: East Industrial Bascule / Girder Bridge + Lift Towers & Operator House
  const br5 = roads.getSegment("col_industrial_bridge");
  if (br5) {
    const halfW = br5.carriagewayWidth * 0.5 + 0.85;
    for (const tLift of [0.38, 0.62]) {
      const dp = br5.curve.getPointAt(tLift);
      const dtan = br5.curve.getTangentAt(tLift);
      const hl = Math.hypot(dtan.x, dtan.z) || 1;
      const rx = -dtan.z / hl;
      const rz = dtan.x / hl;
      const yaw = Math.atan2(dtan.x, dtan.z);

      for (const side of [-1, 1] as const) {
        const tower = new THREE.Mesh(new THREE.BoxGeometry(1.6, 13.5, 1.6), steelDarkMat);
        tower.position.set(dp.x + rx * side * (halfW + 0.5), dp.y + 6.5, dp.z + rz * side * (halfW + 0.5));
        tower.rotation.y = yaw;
        tower.castShadow = true;
        tower.userData.kind = "metal";
        group.add(tower);
        registerSolid(tower);

        const stripe = new THREE.Mesh(new THREE.BoxGeometry(1.66, 0.85, 1.66), hazardYellowMat);
        stripe.position.set(tower.position.x, dp.y + 2.2, tower.position.z);
        stripe.rotation.y = yaw;
        group.add(stripe);
      }

      const overhead = makeStrut(
        new THREE.Vector3(dp.x - rx * (halfW + 0.5), dp.y + 12.6, dp.z - rz * (halfW + 0.5)),
        new THREE.Vector3(dp.x + rx * (halfW + 0.5), dp.y + 12.6, dp.z + rz * (halfW + 0.5)),
        0.38,
        0.38,
        steelDarkMat,
      );
      group.add(overhead);

      if (tLift < 0.5) {
        const booth = new THREE.Mesh(new THREE.BoxGeometry(3.2, 3.4, 3.6), curbMat);
        booth.position.set(dp.x + rx * (halfW + 2.6), dp.y + 2.4, dp.z + rz * (halfW + 2.6));
        booth.rotation.y = yaw;
        booth.castShadow = true;
        booth.userData.kind = "concrete";
        group.add(booth);
        registerSolid(booth);
      }
    }
  }

  // 7. Batched Zebra Pedestrian Crosswalk Bars at Signalized Arterial/Collector Intersections
  const nodeById = new Map(roads.getNodes().map((n) => [n.id, n]));
  const crosswalkGeos: THREE.BufferGeometry[] = [];
  for (const seg of roads.getSegments()) {
    if (seg.spec.isBridge || seg.spec.tier === "freeway" || seg.spec.tier === "ramp") continue;
    const startNode = seg.spec.startNodeId ? nodeById.get(seg.spec.startNodeId) : undefined;
    const endNode = seg.spec.endNodeId ? nodeById.get(seg.spec.endNodeId) : undefined;
    const checks: Array<{ node: typeof startNode; t: number }> = [];
    if (startNode?.kind === "signal") checks.push({ node: startNode, t: Math.min(0.18, 12.5 / Math.max(20, seg.length)) });
    if (endNode?.kind === "signal") checks.push({ node: endNode, t: Math.max(0.82, 1 - 12.5 / Math.max(20, seg.length)) });
    const halfCw = seg.carriagewayWidth * 0.44;
    const stripeCount = Math.max(4, Math.floor((halfCw * 2) / 1.45));
    for (const chk of checks) {
      const sp = seg.curve.getPointAt(chk.t);
      const tan = seg.curve.getTangentAt(chk.t);
      const yaw = Math.atan2(tan.x, tan.z);
      const hl = Math.hypot(tan.x, tan.z) || 1;
      const rx = -tan.z / hl;
      const rz = tan.x / hl;
      const fx = tan.x / hl;
      const fz = tan.z / hl;
      for (let i = 0; i < stripeCount; i++) {
        const u = stripeCount === 1 ? 0 : (i / (stripeCount - 1)) * 2 - 1;
        const off = u * (halfCw - 0.5);
        const bar = new THREE.BoxGeometry(0.55, 0.03, 2.35);
        bar.rotateY(yaw);
        bar.translate(sp.x + rx * off, sp.y + 0.06, sp.z + rz * off);
        crosswalkGeos.push(bar);
      }
      // Solid white traffic stop bar behind the crosswalk
      const stopSign = chk.t < 0.5 ? 1 : -1;
      const stopBar = new THREE.BoxGeometry(halfCw * 1.9, 0.03, 0.45);
      stopBar.rotateY(yaw);
      stopBar.translate(sp.x + fx * stopSign * 2.4, sp.y + 0.06, sp.z + fz * stopSign * 2.4);
      crosswalkGeos.push(stopBar);
    }
  }
  if (crosswalkGeos.length > 0) {
    const mergedCw = mergeGeometries(crosswalkGeos, false);
    if (mergedCw) {
      const cwMesh = new THREE.Mesh(mergedCw, archWhiteMat);
      cwMesh.receiveShadow = true;
      group.add(cwMesh);
    }
  }

  // 8. Batched Bridge Deck Streetlamp Poles & Warm Luminaires on Bay & Arch Bridges
  const brLampPoles: THREE.BufferGeometry[] = [];
  const brLampGlows: THREE.BufferGeometry[] = [];
  for (const br of [br1, br2]) {
    if (!br) continue;
    const halfW = br.carriagewayWidth * 0.5 + 0.55;
    for (let u = 0.14; u <= 0.86; u += 0.12) {
      const dp = br.curve.getPointAt(u);
      const dtan = br.curve.getTangentAt(u);
      const hl = Math.hypot(dtan.x, dtan.z) || 1;
      const rx = -dtan.z / hl;
      const rz = dtan.x / hl;
      for (const side of [-1, 1] as const) {
        const px = dp.x + rx * side * halfW;
        const pz = dp.z + rz * side * halfW;
        const pole = new THREE.CylinderGeometry(0.08, 0.12, 5.2, 6);
        pole.translate(px, dp.y + 2.6, pz);
        brLampPoles.push(pole);
        const arm = new THREE.BoxGeometry(1.1, 0.08, 0.08);
        arm.rotateY(Math.atan2(dtan.x, dtan.z) + Math.PI * 0.5);
        arm.translate(px - rx * side * 0.5, dp.y + 5.18, pz - rz * side * 0.5);
        brLampPoles.push(arm);
        const glow = new THREE.BoxGeometry(0.45, 0.1, 0.25);
        glow.rotateY(Math.atan2(dtan.x, dtan.z) + Math.PI * 0.5);
        glow.translate(px - rx * side * 0.95, dp.y + 5.1, pz - rz * side * 0.95);
        brLampGlows.push(glow);
      }
    }
  }
  if (brLampPoles.length > 0 && brLampGlows.length > 0) {
    const pGeo = mergeGeometries(brLampPoles, false);
    const gGeo = mergeGeometries(brLampGlows, false);
    if (pGeo) group.add(new THREE.Mesh(pGeo, steelDarkMat));
    if (gGeo) group.add(new THREE.Mesh(gGeo, warmGlowMat));
  }

  // 9. Batched Bridge Edge Safety Guardrails across all 5 City Bridges
  const guardGeos: THREE.BufferGeometry[] = [];
  for (const seg of roads.getSegments()) {
    if (!seg.spec.isBridge) continue;
    const halfW = seg.carriagewayWidth * 0.5 + 0.32;
    const steps = Math.max(8, Math.floor(seg.length / 6.5));
    for (const side of [-1, 1] as const) {
      let prevPt: THREE.Vector3 | null = null;
      for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        const sp = seg.curve.getPointAt(t);
        const tan = seg.curve.getTangentAt(t);
        const hl = Math.hypot(tan.x, tan.z) || 1;
        const rx = -tan.z / hl;
        const rz = tan.x / hl;
        const px = sp.x + rx * side * halfW;
        const pz = sp.z + rz * side * halfW;
        const post = new THREE.BoxGeometry(0.14, 1.05, 0.14);
        post.translate(px, sp.y + 0.52, pz);
        guardGeos.push(post);

        const curPt = new THREE.Vector3(px, sp.y + 0.96, pz);
        if (prevPt) {
          const mid = prevPt.clone().add(curPt).multiplyScalar(0.5);
          const dist = prevPt.distanceTo(curPt);
          const yaw = Math.atan2(curPt.x - prevPt.x, curPt.z - prevPt.z);
          const rail = new THREE.BoxGeometry(0.1, 0.1, dist + 0.08);
          rail.rotateY(yaw);
          rail.translate(mid.x, mid.y, mid.z);
          guardGeos.push(rail);
          if (spatialAABBs) {
            const cY = Math.abs(Math.cos(yaw));
            const sY = Math.abs(Math.sin(yaw));
            const hx = 0.22 * cY + dist * 0.48 * sY;
            const hz = 0.22 * sY + dist * 0.48 * cY;
            const yBot = Math.min(prevPt.y, curPt.y) - 0.96;
            spatialAABBs.insert(
              new THREE.Box3(
                new THREE.Vector3(mid.x - hx, yBot, mid.z - hz),
                new THREE.Vector3(mid.x + hx, yBot + 1.0, mid.z + hz),
              ),
            );
          }
        }
        prevPt = curPt;
      }
    }
  }
  if (guardGeos.length > 0) {
    const mergedGuard = mergeGeometries(guardGeos, false);
    if (mergedGuard) {
      const guardMesh = new THREE.Mesh(mergedGuard, steelDarkMat);
      guardMesh.castShadow = true;
      group.add(guardMesh);
    }
  }

  // 10. Batched Concrete Jersey Median Barriers along Multi-Lane Freeways + Cat-Eye Road Reflectors
  const jerseyGeos: THREE.BufferGeometry[] = [];
  const studGeos: THREE.BufferGeometry[] = [];
  for (const seg of roads.getSegments()) {
    if (seg.spec.tier === "freeway" && seg.medianWidth > 0.5) {
      const steps = Math.max(12, Math.floor(seg.length / 4.0));
      for (let i = 0; i < steps; i++) {
        const spA = seg.curve.getPointAt(i / steps);
        const spB = seg.curve.getPointAt((i + 1) / steps);
        const mid = spA.clone().add(spB).multiplyScalar(0.5);
        const len = spA.distanceTo(spB);
        const yaw = Math.atan2(spB.x - spA.x, spB.z - spA.z);
        const bar = new THREE.BoxGeometry(0.62, 0.88, len + 0.08);
        bar.rotateY(yaw);
        bar.translate(mid.x, mid.y + 0.44, mid.z);
        jerseyGeos.push(bar);
        if (spatialAABBs) {
          const cY = Math.abs(Math.cos(yaw));
          const sY = Math.abs(Math.sin(yaw));
          const hx = 0.31 * cY + len * 0.48 * sY;
          const hz = 0.31 * sY + len * 0.48 * cY;
          spatialAABBs.insert(
            new THREE.Box3(
              new THREE.Vector3(mid.x - hx, mid.y, mid.z - hz),
              new THREE.Vector3(mid.x + hx, mid.y + 0.88, mid.z + hz),
            ),
          );
        }
      }
    }
    if (seg.spec.tier === "arterial" || seg.spec.tier === "freeway") {
      const stepCount = Math.max(6, Math.floor(seg.length / 18));
      for (let i = 1; i < stepCount; i++) {
        const sp = seg.curve.getPointAt(i / stepCount);
        const stud = new THREE.BoxGeometry(0.18, 0.05, 0.24);
        stud.translate(sp.x, sp.y + 0.04, sp.z);
        studGeos.push(stud);
      }
    }
  }
  if (jerseyGeos.length > 0) {
    const jGeo = mergeGeometries(jerseyGeos, false);
    if (jGeo) {
      const jMesh = new THREE.Mesh(jGeo, curbMat);
      jMesh.castShadow = true;
      jMesh.receiveShadow = true;
      group.add(jMesh);
    }
  }
  if (studGeos.length > 0) {
    const sGeo = mergeGeometries(studGeos, false);
    if (sGeo) group.add(new THREE.Mesh(sGeo, warmGlowMat));
  }

  // 11. Batched Concrete Hammerhead Support Piers & Crosshead Caps under Bridges & Elevated Viaducts
  const pierGeos: THREE.BufferGeometry[] = [];
  for (const segId of [
    "fw_midtown_viaduct",
    "fw_harbor_bridge",
    "art_arch_bridge",
    "art_canyon_bridge",
    "col_industrial_bridge",
  ]) {
    const seg = roads.getSegment(segId);
    if (!seg) continue;
    const steps = Math.max(6, Math.floor(seg.length / 36));
    const capW = seg.carriagewayWidth * 0.78;
    for (let i = 1; i < steps; i++) {
      const t = i / steps;
      const dp = seg.curve.getPointAt(t);
      const gY = terrainAt(dp.x, dp.z);
      const clearance = dp.y - gY;
      if (clearance < 2.2) continue;

      const dtan = seg.curve.getTangentAt(t);
      const yaw = Math.atan2(dtan.x, dtan.z);
      const hl = Math.hypot(dtan.x, dtan.z) || 1;
      const rx = -dtan.z / hl;
      const rz = dtan.x / hl;

      const botY = Math.min(gY, -1.5) - 1.0;
      const topY = dp.y - 1.1;
      const colH = Math.max(1.0, topY - botY);

      // Twin cylindrical columns + footing plinth + tapered hammerhead pier cap
      for (const side of [-1, 1] as const) {
        const px = dp.x + rx * side * (capW * 0.34);
        const pz = dp.z + rz * side * (capW * 0.34);
        const col = new THREE.CylinderGeometry(0.85, 1.05, colH, 10);
        col.translate(px, botY + colH * 0.5, pz);
        pierGeos.push(col);
      }
      const cap = new THREE.BoxGeometry(capW, 1.15, 1.9);
      cap.rotateY(yaw);
      cap.translate(dp.x, topY + 0.35, dp.z);
      pierGeos.push(cap);
    }
  }
  if (pierGeos.length > 0) {
    const pGeo = mergeGeometries(pierGeos, false);
    if (pGeo) {
      const pMesh = new THREE.Mesh(pGeo, curbMat);
      pMesh.castShadow = true;
      pMesh.receiveShadow = true;
      group.add(pMesh);
    }
  }

  // 12. Batched Highway Guardrails along Mountain Switchbacks & Elevated Freeway Ramps
  const rampGuardGeos: THREE.BufferGeometry[] = [];
  for (const seg of roads.getSegments()) {
    if (
      seg.spec.id !== "col_observatory_switchback" &&
      seg.spec.id !== "loc_foothills_estates" &&
      seg.spec.tier !== "ramp"
    ) {
      continue;
    }
    const halfW = seg.carriagewayWidth * 0.5 + 0.38;
    const steps = Math.max(8, Math.floor(seg.length / 8.0));
    for (const side of [-1, 1] as const) {
      let prevPt: THREE.Vector3 | null = null;
      for (let i = 1; i < steps; i++) {
        const sp = seg.curve.getPointAt(i / steps);
        const tan = seg.curve.getTangentAt(i / steps);
        const hl = Math.hypot(tan.x, tan.z) || 1;
        const rx = -tan.z / hl;
        const rz = tan.x / hl;
        const px = sp.x + rx * side * halfW;
        const pz = sp.z + rz * side * halfW;
        const post = new THREE.BoxGeometry(0.12, 0.78, 0.12);
        post.translate(px, sp.y + 0.39, pz);
        rampGuardGeos.push(post);

        const curPt = new THREE.Vector3(px, sp.y + 0.66, pz);
        if (prevPt) {
          const mid = prevPt.clone().add(curPt).multiplyScalar(0.5);
          const dist = prevPt.distanceTo(curPt);
          const yaw = Math.atan2(curPt.x - prevPt.x, curPt.z - prevPt.z);
          const rail = new THREE.BoxGeometry(0.08, 0.2, dist + 0.08);
          rail.rotateY(yaw);
          rail.translate(mid.x, mid.y, mid.z);
          rampGuardGeos.push(rail);
        }
        prevPt = curPt;
      }
    }
  }
  if (rampGuardGeos.length > 0) {
    const rgGeo = mergeGeometries(rampGuardGeos, false);
    if (rgGeo) {
      const rgMesh = new THREE.Mesh(rgGeo, steelDarkMat);
      rgMesh.castShadow = true;
      group.add(rgMesh);
    }
  }

  parent.add(group);
  return group;
}
