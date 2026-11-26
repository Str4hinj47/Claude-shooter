import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import {
  DEFAULT_WEAPON_CONFIGS,
  type WeaponCustomConfig,
  type WeaponFinish,
  type WeaponMagId,
  type WeaponMuzzleId,
  type WeaponOpticId,
  type WeaponPartFinish,
  type WeaponUnderbarrelId,
} from "../game/progression";

/**
 * Procedural modular weapons. Local space: origin = centre of pistol grip,
 * +Z = muzzle direction, +Y = up, +X = shooter's LEFT (same convention as the character).
 */
export type WeaponId = "pistol" | "carbine" | "smg" | "shotgun" | "dmr";

export interface WeaponSpec {
  id: WeaponId;
  slot: number;
  name: string;
  shortName: string;
  category: string;
  magSize: number;
  reserveMax: number;
  rpm: number;
  damage: number;
  pellets: number;
  auto: boolean;
  baseSpread: number;
  adsSpread: number;
  recoil: number;
  adsFovDefault: number;
  adsFovMin: number;
  adsFovMax: number;
  soundPitch: number;
  suppressed: boolean;
  noiseRadius: number;
  reloadTime: number;
}

export const WEAPONS: WeaponSpec[] = [
  {
    id: "pistol",
    slot: 1,
    name: "Apex P226-SD",
    shortName: "P226-SD",
    category: "Tactical Pistol",
    magSize: 15,
    reserveMax: 90,
    rpm: 420,
    damage: 34,
    pellets: 1,
    auto: false,
    baseSpread: 0.0085,
    adsSpread: 0.0018,
    recoil: 0.58,
    adsFovDefault: 52,
    adsFovMin: 38,
    adsFovMax: 56,
    soundPitch: 1.45,
    suppressed: true,
    noiseRadius: 3.5,
    reloadTime: 1.55,
  },
  {
    id: "carbine",
    slot: 2,
    name: "Vanguard M4A1-S",
    shortName: "M4A1-S",
    category: "Silenced Carbine",
    magSize: 30,
    reserveMax: 120,
    rpm: 700,
    damage: 36,
    pellets: 1,
    auto: true,
    baseSpread: 0.0075,
    adsSpread: 0.0014,
    recoil: 0.88,
    adsFovDefault: 44,
    adsFovMin: 24,
    adsFovMax: 48,
    soundPitch: 1.0,
    suppressed: true,
    noiseRadius: 7.0,
    reloadTime: 2.3,
  },
  {
    id: "smg",
    slot: 3,
    name: "Kobra MP-9 SD",
    shortName: "MP-9 SD",
    category: "Silenced SMG",
    magSize: 32,
    reserveMax: 160,
    rpm: 940,
    damage: 26,
    pellets: 1,
    auto: true,
    baseSpread: 0.0095,
    adsSpread: 0.0028,
    recoil: 0.64,
    adsFovDefault: 48,
    adsFovMin: 32,
    adsFovMax: 52,
    soundPitch: 1.28,
    suppressed: true,
    noiseRadius: 4.5,
    reloadTime: 1.85,
  },
  {
    id: "shotgun",
    slot: 4,
    name: "Breacher M870-S",
    shortName: "M870-S",
    category: "Silenced Shotgun",
    magSize: 8,
    reserveMax: 40,
    rpm: 90,
    damage: 21,
    pellets: 7,
    auto: false,
    baseSpread: 0.032,
    adsSpread: 0.02,
    recoil: 1.75,
    adsFovDefault: 50,
    adsFovMin: 36,
    adsFovMax: 54,
    soundPitch: 0.65,
    suppressed: true,
    noiseRadius: 9.5,
    reloadTime: 2.45,
  },
  {
    id: "dmr",
    slot: 5,
    name: "Falcon Mk14-SD",
    shortName: "MK14-SD",
    category: "Silenced DMR",
    magSize: 12,
    reserveMax: 60,
    rpm: 230,
    damage: 72,
    pellets: 1,
    auto: false,
    baseSpread: 0.012,
    adsSpread: 0.0004,
    recoil: 1.4,
    adsFovDefault: 30,
    adsFovMin: 14,
    adsFovMax: 42,
    soundPitch: 0.8,
    suppressed: true,
    noiseRadius: 7.5,
    reloadTime: 2.7,
  },
];

export const WEAPON_OPTIC_OPTS: { id: WeaponOpticId; label: string; note: string }[] = [
  { id: "holo", label: "EXPS Holo", note: "Wide-window CQB sight" },
  { id: "reddot", label: "Micro T2", note: "Low-profile reflex dot" },
  { id: "acog", label: "4× Prism", note: "+5° ADS magnification" },
  { id: "sniper", label: "8× Long-Range", note: "+10° variable zoom" },
];

export const WEAPON_MUZZLE_OPTS: { id: WeaponMuzzleId; label: string; note: string }[] = [
  { id: "suppressor", label: "Ti-Baffle Can", note: "Suppressed · Subsonic" },
  { id: "osprey", label: "Osprey Block", note: "Suppressed · Flat profile" },
  { id: "wrapped", label: "Cordura Wrap", note: "Suppressed · -6% Recoil" },
  { id: "comp", label: "Match Brake", note: "-16% Recoil · Unsuppressed" },
];

export const WEAPON_UNDERBARREL_OPTS: { id: WeaponUnderbarrelId; label: string; note: string }[] = [
  { id: "none", label: "Clean Rail", note: "Standard handling" },
  { id: "vfg", label: "Vertical Grip", note: "-10% Recoil kick" },
  { id: "angled", label: "Angled Stop", note: "-8% Bullet spread" },
  { id: "laser", label: "PEQ-15 Laser", note: "-16% Spread + IR beam" },
];

export const WEAPON_MAG_OPTS: { id: WeaponMagId; label: string; note: string }[] = [
  { id: "standard", label: "Standard", note: "Base capacity" },
  { id: "extended", label: "Extended", note: "+20% Mag capacity" },
  { id: "drum", label: "50-Rd Drum", note: "+45% Mag capacity" },
];

export const WEAPON_PART_FINISHES: { id: WeaponPartFinish; name: string; swatch: string }[] = [
  { id: "obsidian", name: "Obsidian", swatch: "#181a1f" },
  { id: "coyote", name: "Coyote", swatch: "#7c6b53" },
  { id: "arctic", name: "Arctic", swatch: "#bac2cc" },
  { id: "crimson", name: "Crimson", swatch: "#8b232a" },
  { id: "gold", name: "24K Gold", swatch: "#c29336" },
  { id: "olive", name: "OD Green", swatch: "#43533b" },
  { id: "cobalt", name: "Cobalt", swatch: "#294d7a" },
  { id: "titanium", name: "Titanium", swatch: "#6d747e" },
];

export const WEAPON_RETICLE_COLORS = [
  { hex: "#22d3ee", name: "Cyan" },
  { hex: "#ff3b30", name: "Crimson" },
  { hex: "#2dd4bf", name: "Emerald" },
  { hex: "#e5a93c", name: "Amber" },
  { hex: "#a855f7", name: "Violet" },
];

export interface Rifle {
  weaponId: WeaponId;
  group: THREE.Group;
  muzzle: THREE.Object3D;
  eject: THREE.Object3D;
  mag: THREE.Group;
  charge: THREE.Mesh;
  makeMagClone: () => THREE.Group;
  leftPalm?: THREE.Vector3;
  opticMount: THREE.Group;
  muzzleMount: THREE.Group;
  underbarrelMount: THREE.Group;
  magRest: THREE.Vector3;
  materials: {
    body: THREE.MeshStandardMaterial;
    accent: THREE.MeshStandardMaterial;
    hardware: THREE.MeshStandardMaterial;
    darkMetal: THREE.MeshStandardMaterial;
    poly: THREE.MeshStandardMaterial;
    glass: THREE.MeshPhysicalMaterial;
    reticle: THREE.MeshBasicMaterial;
  };
}

export const RIFLE = {
  // Hand placement in weapon-local space
  rightPalm: new THREE.Vector3(0.0, -0.005, -0.012),
  leftPalm: new THREE.Vector3(0.0, 0.058, 0.25),
  magRest: new THREE.Vector3(0, -0.075, 0.115),
  chargeHandle: new THREE.Vector3(0, 0.16, -0.065),
  magWell: new THREE.Vector3(0, -0.02, 0.115),
};

/* Detail-tuned geometry helpers -------------------------------------------- */
function rbox(w: number, h: number, l: number, r: number, mat: THREE.Material, x = 0, y = 0, z = 0, seg = 6) {
  const m = new THREE.Mesh(new RoundedBoxGeometry(w, h, l, seg, Math.min(r, w / 2.2, h / 2.2, l / 2.2)), mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}
function cyl(rt: number, rb: number, len: number, mat: THREE.Material, x = 0, y = 0, z = 0, seg = 32, open = false) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, len, seg, 1, open), mat);
  m.rotation.x = Math.PI / 2;
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}
function sph(r: number, mat: THREE.Material, x = 0, y = 0, z = 0, seg = 20, ringSeg = 14) {
  const m = new THREE.Mesh(new THREE.SphereGeometry(r, seg, ringSeg), mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}
function ring(radius: number, tube: number, mat: THREE.Material, x = 0, y = 0, z = 0, rotX = 0, rotY = 0, seg = 20) {
  const m = new THREE.Mesh(new THREE.TorusGeometry(radius, tube, 10, seg), mat);
  m.position.set(x, y, z);
  m.rotation.set(rotX, rotY, 0);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

const PART_FINISH_STYLES: Record<WeaponPartFinish, { color: number; metalness: number; roughness: number }> = {
  obsidian: { color: 0x181a1f, metalness: 0.85, roughness: 0.42 },
  coyote: { color: 0x7c6b53, metalness: 0.18, roughness: 0.56 },
  arctic: { color: 0xbac2cc, metalness: 0.52, roughness: 0.42 },
  crimson: { color: 0x8b232a, metalness: 0.58, roughness: 0.38 },
  gold: { color: 0xc29336, metalness: 0.92, roughness: 0.25 },
  olive: { color: 0x43533b, metalness: 0.15, roughness: 0.62 },
  cobalt: { color: 0x294d7a, metalness: 0.65, roughness: 0.36 },
  titanium: { color: 0x6d747e, metalness: 0.9, roughness: 0.3 },
};

function clearGroup(grp: THREE.Group) {
  while (grp.children.length > 0) {
    grp.remove(grp.children[0]);
  }
}

function populateOptic(mount: THREE.Group, optic: WeaponOpticId, mats: Rifle["materials"]) {
  clearGroup(mount);
  const { hardware, darkMetal, glass, reticle } = mats;
  if (optic === "holo") {
    mount.add(rbox(0.036, 0.012, 0.075, 0.003, darkMetal, 0, 0, 0, 5));
    mount.add(rbox(0.05, 0.05, 0.085, 0.01, darkMetal, 0, 0.034, 0, 6));
    const win = new THREE.Mesh(new THREE.CircleGeometry(0.02, 24), glass);
    win.position.set(0, 0.036, 0.0435);
    mount.add(win);
    const win2 = win.clone();
    win2.position.z = -0.0435;
    win2.rotation.y = Math.PI;
    mount.add(win2);
    mount.add(ring(0.02, 0.0025, hardware, 0, 0.036, 0.0435, 0, 0, 22));
    mount.add(ring(0.02, 0.0025, hardware, 0, 0.036, -0.0435, 0, 0, 22));
    mount.add(rbox(0.026, 0.016, 0.02, 0.003, hardware, 0, -0.008, 0.02, 5));
    mount.add(rbox(0.026, 0.016, 0.02, 0.003, hardware, 0, -0.008, -0.02, 5));
    const dot = new THREE.Mesh(new THREE.SphereGeometry(0.0032, 8, 6), reticle);
    dot.position.set(0, 0.036, 0);
    mount.add(dot);
  } else if (optic === "reddot") {
    mount.add(rbox(0.028, 0.02, 0.034, 0.003, hardware, 0, 0.006, 0, 4));
    mount.add(cyl(0.016, 0.016, 0.068, darkMetal, 0, 0.028, 0, 20));
    mount.add(ring(0.0165, 0.0022, hardware, 0, 0.028, 0.034, 0, 0, 18));
    mount.add(ring(0.0165, 0.0022, hardware, 0, 0.028, -0.034, 0, 0, 18));
    const lens = new THREE.Mesh(new THREE.CircleGeometry(0.014, 18), glass);
    lens.position.set(0, 0.028, 0.035);
    mount.add(lens);
    const dot = new THREE.Mesh(new THREE.SphereGeometry(0.0028, 8, 6), reticle);
    dot.position.set(0, 0.028, 0.012);
    mount.add(dot);
  } else if (optic === "acog") {
    mount.add(rbox(0.026, 0.016, 0.085, 0.003, hardware, 0, 0.004, 0, 4));
    mount.add(cyl(0.017, 0.015, 0.135, darkMetal, 0, 0.03, 0.005, 22));
    mount.add(cyl(0.021, 0.018, 0.038, darkMetal, 0, 0.03, 0.072, 22));
    mount.add(rbox(0.01, 0.008, 0.075, 0.002, reticle, 0, 0.05, 0.01, 3)); // fiber optic tube
    const lens = new THREE.Mesh(new THREE.CircleGeometry(0.018, 20), glass);
    lens.position.set(0, 0.03, 0.092);
    mount.add(lens);
  } else {
    // Variable 8x sniper scope
    mount.add(rbox(0.026, 0.022, 0.022, 0.003, hardware, 0, 0.004, -0.055, 4));
    mount.add(rbox(0.026, 0.022, 0.022, 0.003, hardware, 0, 0.004, 0.065, 4));
    mount.add(cyl(0.018, 0.018, 0.22, darkMetal, 0, 0.028, 0.005, 24));
    mount.add(cyl(0.025, 0.02, 0.08, darkMetal, 0, 0.028, 0.135, 24));
    mount.add(cyl(0.022, 0.019, 0.06, darkMetal, 0, 0.028, -0.115, 24));
    mount.add(cyl(0.009, 0.009, 0.02, hardware, 0, 0.05, 0.005, 14)); // elevation turret
    mount.add(rbox(0.016, 0.014, 0.014, 0.002, reticle, -0.022, 0.028, 0.005, 3)); // illuminated dial
    const lensF = new THREE.Mesh(new THREE.CircleGeometry(0.022, 20), glass);
    lensF.position.set(0, 0.028, 0.176);
    mount.add(lensF);
  }
}

function populateMuzzle(mount: THREE.Group, muzzleId: WeaponMuzzleId, weaponId: WeaponId, mats: Rifle["materials"]) {
  clearGroup(mount);
  const { hardware, accent, darkMetal } = mats;
  const lenScale = weaponId === "dmr" ? 1.15 : weaponId === "smg" ? 0.92 : weaponId === "pistol" ? 0.68 : 1.0;
  const radScale = weaponId === "pistol" ? 0.72 : 1.0;

  if (muzzleId === "suppressor") {
    mount.add(cyl(0.013 * radScale, 0.013 * radScale, 0.035, darkMetal, 0, 0, 0.01, 20));
    mount.add(cyl(0.02 * radScale, 0.02 * radScale, 0.19 * lenScale, darkMetal, 0, 0, 0.115 * lenScale, 28));
    mount.add(cyl(0.021 * radScale, 0.021 * radScale, 0.02, hardware, 0, 0, 0.028, 24));
    for (let i = 0; i < 4; i++) {
      mount.add(ring(0.0205 * radScale, 0.0015, hardware, 0, 0, 0.055 + i * 0.028 * lenScale, 0, 0, 22));
    }
    mount.add(ring(0.016 * radScale, 0.002, hardware, 0, 0, 0.21 * lenScale, 0, 0, 20));
  } else if (muzzleId === "osprey") {
    mount.add(rbox(0.038 * radScale, 0.054 * radScale, 0.19 * lenScale, 0.007, darkMetal, 0, -0.004, 0.105 * lenScale, 5));
    mount.add(rbox(0.041 * radScale, 0.058 * radScale, 0.02, 0.004, hardware, 0, -0.004, 0.02, 4));
    for (let i = 0; i < 3; i++) {
      mount.add(rbox(0.04 * radScale, 0.006, 0.008, 0.002, hardware, 0, -0.004, 0.055 + i * 0.038 * lenScale, 3));
    }
  } else if (muzzleId === "wrapped") {
    mount.add(cyl(0.014 * radScale, 0.014 * radScale, 0.03, hardware, 0, 0, 0.01, 20));
    mount.add(cyl(0.023 * radScale, 0.023 * radScale, 0.18 * lenScale, accent, 0, 0, 0.11 * lenScale, 24));
    for (let i = 0; i < 5; i++) {
      mount.add(ring(0.0235 * radScale, 0.002, darkMetal, 0, 0, 0.035 + i * 0.028 * lenScale, 0, 0, 20));
    }
    mount.add(cyl(0.019 * radScale, 0.019 * radScale, 0.018, darkMetal, 0, 0, 0.205 * lenScale, 20));
  } else {
    // Precision ported muzzle brake / compensator
    mount.add(cyl(0.014 * radScale, 0.013 * radScale, 0.022, hardware, 0, 0, 0.01, 20));
    mount.add(rbox(0.034 * radScale, 0.028 * radScale, 0.072 * lenScale, 0.004, hardware, 0, 0, 0.048 * lenScale, 4));
    for (let i = 0; i < 3; i++) {
      mount.add(rbox(0.036 * radScale, 0.012 * radScale, 0.009, 0.001, darkMetal, 0, 0, 0.024 + i * 0.019 * lenScale, 3));
    }
  }
}

function populateUnderbarrel(mount: THREE.Group, ub: WeaponUnderbarrelId, mats: Rifle["materials"]) {
  clearGroup(mount);
  const { hardware, accent, poly, reticle } = mats;
  if (ub === "none") return;
  if (ub === "vfg") {
    const vfg = rbox(0.026, 0.075, 0.032, 0.008, poly, 0, -0.04, 0, 5);
    vfg.rotation.x = -0.12;
    mount.add(vfg);
    mount.add(rbox(0.028, 0.012, 0.036, 0.003, hardware, 0, -0.006, 0, 4));
  } else if (ub === "angled") {
    const afg = rbox(0.028, 0.036, 0.095, 0.008, accent, 0, -0.022, 0.01, 5);
    afg.rotation.x = 0.22;
    mount.add(afg);
    mount.add(rbox(0.026, 0.024, 0.026, 0.004, poly, 0, -0.028, -0.028, 4));
  } else if (ub === "laser") {
    // Angled handstop + side-mounted PEQ-15 tactical laser module
    const afg = rbox(0.025, 0.048, 0.03, 0.007, poly, 0, -0.028, -0.01, 5);
    afg.rotation.x = -0.15;
    mount.add(afg);
    mount.add(rbox(0.028, 0.024, 0.078, 0.005, accent, -0.042, 0.036, 0.075, 5));
    mount.add(cyl(0.0065, 0.0065, 0.014, hardware, -0.042, 0.036, 0.116, 14));
    const emitter = new THREE.Mesh(new THREE.SphereGeometry(0.0045, 8, 6), reticle);
    emitter.position.set(-0.042, 0.036, 0.124);
    mount.add(emitter);
    // Short glowing laser guide beam
    const beamGeo = new THREE.CylinderGeometry(0.0014, 0.0014, 0.36, 6);
    beamGeo.rotateX(Math.PI / 2);
    const beamMat = new THREE.MeshBasicMaterial({ color: reticle.color, transparent: true, opacity: 0.45 });
    const beam = new THREE.Mesh(beamGeo, beamMat);
    beam.name = "WeaponLaserBeam";
    beam.position.set(-0.042, 0.036, 0.3);
    mount.add(beam);
  }
}

function populateMagazine(
  magGroup: THREE.Group,
  magId: WeaponMagId,
  weaponId: WeaponId,
  mats: Rifle["materials"],
) {
  clearGroup(magGroup);
  const { darkMetal, poly, hardware, glass } = mats;
  const magMat = new THREE.MeshStandardMaterial({ color: 0x1b1c1e, metalness: 0.5, roughness: 0.55 });

  if (weaponId === "pistol") {
    const pScale = magId === "drum" ? 1.45 : magId === "extended" ? 1.25 : 1.0;
    const pm = rbox(0.024, 0.11 * pScale, 0.034, 0.004, magMat, 0, -0.02 * pScale, 0, 4);
    pm.rotation.x = 0.28;
    magGroup.add(pm);
    const pad = rbox(0.028, 0.014, 0.038, 0.004, hardware, 0, -0.072 * pScale, -0.015 * pScale, 4);
    pad.rotation.x = 0.28;
    magGroup.add(pad);
    return;
  }

  if (weaponId === "shotgun" && magId === "standard") {
    magGroup.add(rbox(0.016, 0.045, 0.08, 0.004, darkMetal, 0, 0, 0, 4));
    const shellMat = new THREE.MeshStandardMaterial({ color: 0x9e2420, roughness: 0.5 });
    for (let i = 0; i < 4; i++) {
      magGroup.add(cyl(0.008, 0.008, 0.042, shellMat, 0, 0.005, -0.027 + i * 0.018, 12));
    }
    return;
  }

  if (magId === "drum") {
    magGroup.add(rbox(0.032, 0.085, 0.058, 0.005, magMat, 0, 0.005, 0, 5));
    magGroup.add(cyl(0.056, 0.056, 0.054, poly, 0, -0.068, 0.004, 24));
    magGroup.add(cyl(0.046, 0.046, 0.058, darkMetal, 0, -0.068, 0.004, 24));
    magGroup.add(cyl(0.016, 0.016, 0.062, hardware, 0, -0.068, 0.004, 16));
    return;
  }

  const lenScale = magId === "extended" ? 1.38 : 1.0;
  if (weaponId === "smg") {
    const sm1 = rbox(0.024, 0.2 * lenScale, 0.036, 0.004, magMat, 0, -0.06 * lenScale, 0, 4);
    sm1.rotation.x = 0.08;
    magGroup.add(sm1);
    magGroup.add(rbox(0.028, 0.014, 0.04, 0.003, hardware, 0, -0.155 * lenScale, -0.008, 4));
    return;
  }

  const m1 = rbox(0.03, 0.1 * lenScale, 0.058, 0.006, magMat, 0, -0.01, 0, 5);
  const m2 = rbox(0.03, 0.09 * lenScale, 0.058, 0.006, magMat, 0, -0.095 * lenScale, 0.014, 5);
  m2.rotation.x = -0.16;
  const m3 = rbox(0.032, 0.014, 0.062, 0.004, poly, 0, -0.148 * lenScale, 0.025 * lenScale, 5);
  m3.rotation.x = -0.16;
  magGroup.add(m1, m2, m3);
  magGroup.add(sph(0.006, darkMetal, 0, 0.06, 0.002, 10, 6));
  magGroup.add(rbox(0.01, 0.003, 0.02, 0.001, glass, 0.011, -0.05, 0.002, 4));
  magGroup.add(rbox(0.034, 0.01, 0.06, 0.004, hardware, 0, -0.16 * lenScale, 0.02 * lenScale, 5));
}

function createWeaponMaterials() {
  const body = new THREE.MeshStandardMaterial({ color: 0x23262b, metalness: 0.9, roughness: 0.38 });
  body.name = "WeaponBody";
  const accent = new THREE.MeshStandardMaterial({ color: 0x6d6150, metalness: 0.1, roughness: 0.62 });
  accent.name = "WeaponAccent";
  const hardware = new THREE.MeshStandardMaterial({ color: 0x9aa0a8, metalness: 0.95, roughness: 0.28 });
  hardware.name = "WeaponHardware";
  const darkMetal = new THREE.MeshStandardMaterial({ color: 0x131518, metalness: 0.85, roughness: 0.5 });
  const poly = new THREE.MeshStandardMaterial({ color: 0x17181a, metalness: 0.05, roughness: 0.72 });
  const glass = new THREE.MeshPhysicalMaterial({
    color: 0x14384e,
    metalness: 0.05,
    roughness: 0.05,
    transparent: true,
    opacity: 0.65,
    emissive: 0x0a1c28,
  });
  const reticle = new THREE.MeshBasicMaterial({ color: 0x22d3ee });
  reticle.name = "WeaponReticle";
  return { body, accent, hardware, darkMetal, poly, glass, reticle };
}

export function buildRifle(): Rifle {
  const mats = createWeaponMaterials();
  const { body, accent, hardware, darkMetal, poly } = mats;
  const black = new THREE.MeshStandardMaterial({ color: 0x0b0b0c, roughness: 0.95 });

  const g = new THREE.Group();
  g.name = "Rifle";

  /* --- pistol grip -------------------------------------------------------- */
  const grip = rbox(0.034, 0.105, 0.046, 0.012, poly, 0, -0.035, -0.018, 6);
  grip.rotation.x = 0.32;
  g.add(grip);
  g.add(rbox(0.03, 0.05, 0.016, 0.006, poly, 0, -0.01, -0.04, 6).rotateX(0.32));
  for (let i = 0; i < 5; i++) g.add(sph(0.004, poly, 0.008, -0.03 - i * 0.014, -0.018, 10, 6));
  g.add(ring(0.012, 0.0035, black, 0, -0.085, -0.018, Math.PI / 2, 0, 14));

  /* --- lower receiver + trigger guard ------------------------------------ */
  g.add(rbox(0.04, 0.075, 0.2, 0.008, body, 0, 0.075, 0.075, 6));
  g.add(rbox(0.012, 0.012, 0.08, 0.004, body, 0, 0.032, 0.085, 5));
  g.add(rbox(0.012, 0.03, 0.01, 0.004, darkMetal, 0, 0.035, 0.125, 4));
  g.add(rbox(0.008, 0.03, 0.006, 0.002, darkMetal, 0, 0.05, 0.075, 4));
  g.add(sph(0.005, darkMetal, 0, 0.05, 0.085, 10, 8));
  g.add(rbox(0.046, 0.05, 0.075, 0.006, body, 0, 0.02, 0.115, 6));
  g.add(rbox(0.04, 0.012, 0.07, 0.003, darkMetal, 0, 0.001, 0.118, 5));
  g.add(rbox(0.014, 0.02, 0.012, 0.003, hardware, -0.021, 0.12, 0.03, 5));
  g.add(rbox(0.018, 0.008, 0.02, 0.003, darkMetal, -0.018, 0.135, 0.03, 5));
  g.add(cyl(0.006, 0.006, 0.05, hardware, 0, 0.075, -0.005, 24));

  /* --- upper receiver + rail --------------------------------------------- */
  g.add(rbox(0.042, 0.062, 0.29, 0.008, body, 0, 0.133, 0.1, 6));
  g.add(rbox(0.018, 0.032, 0.024, 0.004, darkMetal, 0.025, 0.132, 0.032, 4));
  g.add(cyl(0.007, 0.008, 0.026, hardware, 0.024, 0.125, 0.005, 16));
  g.add(rbox(0.012, 0.04, 0.07, 0.004, darkMetal, 0.024, 0.13, 0.08, 5));
  g.add(rbox(0.024, 0.012, 0.66, 0.002, darkMetal, 0, 0.172, 0.2, 6));
  for (let i = 0; i < 26; i++) {
    g.add(rbox(0.026, 0.0045, 0.006, 0.001, hardware, 0, 0.178, -0.11 + i * 0.026, 3));
  }

  /* --- charging handle ---------------------------------------------------- */
  const charge = rbox(0.034, 0.014, 0.03, 0.004, darkMetal, 0, 0.158, -0.056, 6);
  g.add(charge);
  g.add(rbox(0.01, 0.01, 0.034, 0.003, hardware, 0.013, 0.158, -0.056, 4));

  /* --- handguard ---------------------------------------------------------- */
  g.add(rbox(0.064, 0.064, 0.3, 0.014, accent, 0, 0.125, 0.4, 6));
  for (let i = 0; i < 6; i++) {
    g.add(rbox(0.066, 0.012, 0.018, 0.003, darkMetal, 0, 0.125, 0.3 + i * 0.045, 5));
  }
  g.add(rbox(0.02, 0.012, 0.22, 0.002, darkMetal, 0, 0.09, 0.42, 5));

  /* --- barrel, gas block, front sight ------------------------------------ */
  g.add(cyl(0.0085, 0.0085, 0.2, body, 0, 0.125, 0.62, 32));
  g.add(rbox(0.026, 0.03, 0.03, 0.006, darkMetal, 0, 0.14, 0.57, 6));
  g.add(rbox(0.008, 0.032, 0.008, 0.002, darkMetal, 0, 0.17, 0.57, 5));

  /* --- stock -------------------------------------------------------------- */
  g.add(cyl(0.0175, 0.0175, 0.17, darkMetal, 0, 0.13, -0.17, 24));
  g.add(rbox(0.046, 0.1, 0.17, 0.016, accent, 0, 0.1, -0.215, 6));
  g.add(rbox(0.036, 0.04, 0.14, 0.01, poly, 0, 0.1, -0.17, 6));
  const pad = rbox(0.05, 0.12, 0.024, 0.008, black, 0, 0.096, -0.31, 6);
  pad.rotation.x = -0.12;
  g.add(pad);
  g.add(ring(0.019, 0.003, hardware, 0, 0.13, -0.255, 0, 0, 20));

  /* --- modular attachment anchors ---------------------------------------- */
  const opticMount = new THREE.Group();
  opticMount.position.set(0, 0.184, 0.08);
  g.add(opticMount);

  const muzzleMount = new THREE.Group();
  muzzleMount.position.set(0, 0.125, 0.72);
  g.add(muzzleMount);

  const underbarrelMount = new THREE.Group();
  underbarrelMount.position.set(0, 0.09, 0.35);
  g.add(underbarrelMount);

  const mag = new THREE.Group();
  const magRest = RIFLE.magRest.clone();
  mag.position.copy(magRest);
  g.add(mag);

  const makeMagClone = () => {
    const c = new THREE.Group();
    mag.children.forEach((ch) => c.add((ch as THREE.Mesh).clone()));
    return c;
  };

  const muzzle = new THREE.Object3D();
  muzzle.position.set(0, 0.125, 0.94);
  g.add(muzzle);
  const eject = new THREE.Object3D();
  eject.position.set(0.03, 0.13, 0.06);
  g.add(eject);

  const rifle: Rifle = {
    weaponId: "carbine",
    group: g,
    muzzle,
    eject,
    mag,
    charge,
    makeMagClone,
    leftPalm: RIFLE.leftPalm.clone(),
    opticMount,
    muzzleMount,
    underbarrelMount,
    magRest,
    materials: mats,
  };
  applyWeaponCustomization(rifle, DEFAULT_WEAPON_CONFIGS.carbine);
  return rifle;
}

export function buildWeapon(id: WeaponId): Rifle {
  if (id === "carbine") return buildRifle();

  const mats = createWeaponMaterials();
  const { body, accent, hardware, darkMetal, poly } = mats;
  const g = new THREE.Group();
  g.name = `Weapon_${id}`;

  if (id === "pistol") {
    // Textured tactical pistol frame, dust cover, Picatinny rail, slide, sights & trigger
    const pGroup = new THREE.Group();
    pGroup.name = "Weapon_pistol";
    const pGrip = rbox(0.03, 0.112, 0.04, 0.01, poly, 0, -0.022, -0.01, 5);
    pGrip.rotation.x = 0.28;
    pGroup.add(pGrip);
    // Beavertail & dustcover frame
    pGroup.add(rbox(0.028, 0.024, 0.17, 0.005, poly, 0, 0.056, 0.068, 5));
    // Trigger guard & curved trigger
    pGroup.add(rbox(0.01, 0.008, 0.052, 0.003, poly, 0, 0.022, 0.056, 4));
    pGroup.add(rbox(0.01, 0.026, 0.008, 0.002, poly, 0, 0.036, 0.078, 4));
    pGroup.add(rbox(0.006, 0.02, 0.005, 0.002, hardware, 0, 0.04, 0.052, 4));
    // Slide + forward/rear serrations + ejection port + iron sights
    pGroup.add(rbox(0.029, 0.03, 0.195, 0.006, body, 0, 0.084, 0.065, 5));
    pGroup.add(rbox(0.018, 0.016, 0.034, 0.003, hardware, 0.008, 0.09, 0.058, 4));
    for (let i = 0; i < 5; i++) {
      pGroup.add(rbox(0.031, 0.02, 0.004, 0.001, darkMetal, 0, 0.084, -0.018 + i * 0.009, 3));
    }
    pGroup.add(rbox(0.018, 0.01, 0.012, 0.002, darkMetal, 0, 0.104, -0.02, 3));
    pGroup.add(rbox(0.006, 0.01, 0.01, 0.002, darkMetal, 0, 0.104, 0.15, 3));
    // Threaded barrel stub
    pGroup.add(cyl(0.007, 0.007, 0.04, hardware, 0, 0.08, 0.17, 16));
    // Tactical under-rail laser/light block (compact)
    const pCharge = rbox(0.022, 0.012, 0.014, 0.003, darkMetal, 0, 0.084, -0.032, 4);
    pGroup.add(pCharge);

    const pOpticMount = new THREE.Group();
    pOpticMount.position.set(0, 0.102, 0.005);
    pOpticMount.scale.setScalar(0.55);

    const pMuzzleMount = new THREE.Group();
    pMuzzleMount.position.set(0, 0.08, 0.184);

    const pUnderbarrelMount = new THREE.Group();
    pUnderbarrelMount.position.set(0, 0.046, 0.11);
    pUnderbarrelMount.scale.setScalar(0.52);

    const pMag = new THREE.Group();
    const pMagRest = new THREE.Vector3(0, -0.02, -0.01);
    pMag.position.copy(pMagRest);

    pGroup.add(pOpticMount, pMuzzleMount, pUnderbarrelMount, pMag);

    const makePistolMagClone = () => {
      const c = new THREE.Group();
      pMag.children.forEach((ch) => c.add((ch as THREE.Mesh).clone()));
      return c;
    };

    const pMuzzle = new THREE.Object3D();
    pMuzzle.position.set(0, 0.08, 0.34);
    pGroup.add(pMuzzle);
    const pEject = new THREE.Object3D();
    pEject.position.set(0.022, 0.092, 0.058);
    pGroup.add(pEject);

    const pistolRifle: Rifle = {
      weaponId: "pistol",
      group: pGroup,
      muzzle: pMuzzle,
      eject: pEject,
      mag: pMag,
      charge: pCharge,
      makeMagClone: makePistolMagClone,
      leftPalm: new THREE.Vector3(-0.01, -0.015, 0.018),
      opticMount: pOpticMount,
      muzzleMount: pMuzzleMount,
      underbarrelMount: pUnderbarrelMount,
      magRest: pMagRest,
      materials: mats,
    };
    applyWeaponCustomization(pistolRifle, DEFAULT_WEAPON_CONFIGS.pistol);
    return pistolRifle;
  }

  const grip = rbox(0.034, 0.105, 0.044, 0.012, poly, 0, -0.035, -0.018, 5);
  grip.rotation.x = 0.32;
  g.add(grip);
  g.add(rbox(0.012, 0.012, 0.075, 0.004, body, 0, 0.032, 0.08, 4));
  g.add(rbox(0.008, 0.028, 0.006, 0.002, darkMetal, 0, 0.05, 0.075, 4));

  const charge = rbox(0.032, 0.014, 0.03, 0.004, darkMetal, 0, 0.155, -0.056, 5);
  g.add(charge);

  const opticMount = new THREE.Group();
  const muzzleMount = new THREE.Group();
  const underbarrelMount = new THREE.Group();
  const mag = new THREE.Group();
  let magRest = RIFLE.magRest.clone();
  let muzzleZ = 0.75;
  let leftPalm = RIFLE.leftPalm.clone();

  if (id === "smg") {
    g.add(rbox(0.04, 0.085, 0.24, 0.008, body, 0, 0.105, 0.09, 5));
    g.add(rbox(0.022, 0.01, 0.26, 0.002, darkMetal, 0, 0.155, 0.12, 4));
    g.add(cyl(0.007, 0.007, 0.22, hardware, -0.016, 0.125, -0.14, 14));
    g.add(cyl(0.007, 0.007, 0.22, hardware, 0.016, 0.125, -0.14, 14));
    g.add(rbox(0.042, 0.09, 0.022, 0.006, accent, 0, 0.1, -0.25, 5));
    g.add(rbox(0.048, 0.056, 0.14, 0.01, accent, 0, 0.115, 0.25, 5));
    leftPalm = new THREE.Vector3(0, 0.052, 0.24);
    opticMount.position.set(0, 0.16, 0.08);
    muzzleMount.position.set(0, 0.12, 0.33);
    underbarrelMount.position.set(0, 0.086, 0.24);
    magRest = new THREE.Vector3(0, -0.02, 0.13);
    muzzleZ = 0.565;
  } else if (id === "shotgun") {
    g.add(rbox(0.044, 0.075, 0.24, 0.008, body, 0, 0.105, 0.08, 5));
    const st = rbox(0.044, 0.095, 0.26, 0.014, accent, 0, 0.08, -0.17, 5);
    st.rotation.x = -0.08;
    g.add(st);
    g.add(rbox(0.048, 0.115, 0.025, 0.008, darkMetal, 0, 0.07, -0.3, 5));
    g.add(cyl(0.012, 0.013, 0.56, darkMetal, 0, 0.132, 0.46, 24));
    g.add(cyl(0.011, 0.011, 0.48, hardware, 0, 0.102, 0.42, 20));
    const pump = rbox(0.048, 0.052, 0.19, 0.012, accent, 0, 0.095, 0.33, 5);
    g.add(pump);
    for (let i = 0; i < 7; i++) g.add(rbox(0.051, 0.012, 0.012, 0.003, darkMetal, 0, 0.095, 0.25 + i * 0.026, 3));
    leftPalm = new THREE.Vector3(0, 0.06, 0.31);
    g.add(rbox(0.028, 0.045, 0.024, 0.004, darkMetal, 0, 0.118, 0.64, 4));
    opticMount.position.set(0, 0.15, 0.06);
    muzzleMount.position.set(0, 0.128, 0.72);
    underbarrelMount.position.set(0, 0.07, 0.35);
    magRest = new THREE.Vector3(-0.028, 0.105, 0.08);
    muzzleZ = 0.94;
  } else {
    g.add(rbox(0.042, 0.072, 0.28, 0.008, body, 0, 0.105, 0.1, 5));
    g.add(rbox(0.022, 0.012, 0.58, 0.002, darkMetal, 0, 0.152, 0.22, 4));
    g.add(rbox(0.046, 0.098, 0.24, 0.012, accent, 0, 0.095, -0.18, 5));
    g.add(rbox(0.04, 0.032, 0.14, 0.01, poly, 0, 0.145, -0.18, 5));
    g.add(rbox(0.056, 0.058, 0.34, 0.01, accent, 0, 0.118, 0.41, 5));
    leftPalm = new THREE.Vector3(0, 0.06, 0.3);
    g.add(cyl(0.009, 0.011, 0.32, hardware, 0, 0.125, 0.7, 24));
    for (const sx of [-1, 1]) {
      const leg = cyl(0.006, 0.006, 0.18, darkMetal, sx * 0.024, 0.075, 0.47, 10);
      leg.rotation.y = sx * 0.1;
      g.add(leg);
    }
    opticMount.position.set(0, 0.165, 0.1);
    muzzleMount.position.set(0, 0.125, 0.855);
    underbarrelMount.position.set(0, 0.088, 0.36);
    magRest = new THREE.Vector3(0, -0.02, 0.125);
    muzzleZ = 1.095;
  }

  mag.position.copy(magRest);
  g.add(opticMount, muzzleMount, underbarrelMount, mag);

  const makeMagClone = () => {
    const c = new THREE.Group();
    mag.children.forEach((ch) => c.add((ch as THREE.Mesh).clone()));
    return c;
  };

  const muzzle = new THREE.Object3D();
  muzzle.position.set(0, 0.125, muzzleZ);
  g.add(muzzle);
  const eject = new THREE.Object3D();
  eject.position.set(0.03, 0.13, 0.06);
  g.add(eject);

  const rifle: Rifle = {
    weaponId: id,
    group: g,
    muzzle,
    eject,
    mag,
    charge,
    makeMagClone,
    leftPalm,
    opticMount,
    muzzleMount,
    underbarrelMount,
    magRest,
    materials: mats,
  };
  applyWeaponCustomization(rifle, DEFAULT_WEAPON_CONFIGS[id]);
  return rifle;
}

function applyFinishToMat(mat: THREE.MeshStandardMaterial, finish: WeaponPartFinish) {
  const f = PART_FINISH_STYLES[finish] ?? PART_FINISH_STYLES.obsidian;
  mat.color.setHex(f.color);
  mat.metalness = f.metalness;
  mat.roughness = f.roughness;
}

export function applyWeaponCustomization(rifle: Rifle, cfg: WeaponCustomConfig) {
  applyFinishToMat(rifle.materials.body, cfg.bodyFinish);
  applyFinishToMat(rifle.materials.accent, cfg.accentFinish);
  applyFinishToMat(rifle.materials.hardware, cfg.hardwareFinish);
  rifle.materials.reticle.color.set(cfg.reticleColor || "#22d3ee");

  populateOptic(rifle.opticMount, cfg.optic, rifle.materials);
  populateMuzzle(rifle.muzzleMount, cfg.muzzle, rifle.weaponId, rifle.materials);
  populateUnderbarrel(rifle.underbarrelMount, cfg.underbarrel, rifle.materials);
  populateMagazine(rifle.mag, cfg.magazine, rifle.weaponId, rifle.materials);
}

const WEAPON_FINISHES: Record<WeaponFinish, { body: number; accent: number; metalness: number; roughness: number }> = {
  obsidian: { body: 0x181a1f, accent: 0x262930, metalness: 0.85, roughness: 0.42 },
  coyote: { body: 0x23262b, accent: 0x7c6b53, metalness: 0.72, roughness: 0.48 },
  arctic: { body: 0xbac2cc, accent: 0x8a939e, metalness: 0.55, roughness: 0.42 },
  crimson: { body: 0x28191c, accent: 0x8b232a, metalness: 0.65, roughness: 0.4 },
  gold: { body: 0x22201b, accent: 0xc29336, metalness: 0.92, roughness: 0.26 },
};

export function tintWeapon(rifle: Rifle, finish: WeaponFinish) {
  const f = WEAPON_FINISHES[finish] ?? WEAPON_FINISHES.coyote;
  rifle.group.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const mats = Array.isArray(m.material) ? m.material : [m.material];
    for (const mat of mats) {
      const s = mat as THREE.MeshStandardMaterial;
      if (s.name === "WeaponBody") {
        s.color.setHex(f.body);
        s.metalness = f.metalness;
        s.roughness = f.roughness;
      } else if (s.name === "WeaponAccent") {
        s.color.setHex(f.accent);
        s.metalness = f.metalness * 0.65;
        s.roughness = f.roughness;
      }
    }
  });
}
