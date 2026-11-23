import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import type { WeaponFinish } from "../game/progression";

/**
 * Procedural carbine. Local space: origin = centre of pistol grip,
 * +Z = muzzle direction, +Y = up, +X = shooter's LEFT (same convention as the character).
 *
 * Built for detail: high-segment rounded boxes, bevelled cylinders and a full
 * complement of small parts (scope rings, muzzle device, sling swivel, control
 * detail) so the weapon reads as a high-poly asset.
 */
export type WeaponId = "carbine" | "smg" | "shotgun" | "dmr";

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
}

export const WEAPONS: WeaponSpec[] = [
  {
    id: "carbine",
    slot: 1,
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
  },
  {
    id: "smg",
    slot: 2,
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
  },
  {
    id: "shotgun",
    slot: 3,
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
  },
  {
    id: "dmr",
    slot: 4,
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
  },
];

export interface Rifle {
  group: THREE.Group;
  muzzle: THREE.Object3D;
  eject: THREE.Object3D;
  mag: THREE.Group;
  charge: THREE.Mesh;
  makeMagClone: () => THREE.Group;
  leftPalm?: THREE.Vector3;
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
// Rounded box with enough segments to show chamfers + edge curvature.
function rbox(w: number, h: number, l: number, r: number, mat: THREE.Material, x = 0, y = 0, z = 0, seg = 6) {
  const m = new THREE.Mesh(new RoundedBoxGeometry(w, h, l, seg, Math.min(r, w / 2.2, h / 2.2, l / 2.2)), mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}
// Barrel/rod, high radial resolution + openEnded option.
function cyl(rt: number, rb: number, len: number, mat: THREE.Material, x = 0, y = 0, z = 0, seg = 32, open = false) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, len, seg, 1, open), mat);
  m.rotation.x = Math.PI / 2;
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}
function sph(r: number, mat: THREE.Material, x = 0, y = 0, z = 0, seg = 20, ring = 14) {
  const m = new THREE.Mesh(new THREE.SphereGeometry(r, seg, ring), mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}
// Small torus (rings, swivels, ports)
function ring(radius: number, tube: number, mat: THREE.Material, x = 0, y = 0, z = 0, rotX = 0, rotY = 0, seg = 20) {
  const m = new THREE.Mesh(new THREE.TorusGeometry(radius, tube, 10, seg), mat);
  m.position.set(x, y, z);
  m.rotation.set(rotX, rotY, 0);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

export function buildRifle(): Rifle {
  const metal = new THREE.MeshStandardMaterial({ color: 0x23262b, metalness: 0.9, roughness: 0.38 });
  metal.name = "WeaponBody";
  const darkMetal = new THREE.MeshStandardMaterial({ color: 0x131518, metalness: 0.85, roughness: 0.5 });
  const steel = new THREE.MeshStandardMaterial({ color: 0x9aa0a8, metalness: 0.95, roughness: 0.28 });
  const poly = new THREE.MeshStandardMaterial({ color: 0x17181a, metalness: 0.05, roughness: 0.72 });
  const tan = new THREE.MeshStandardMaterial({ color: 0x6d6150, metalness: 0.05, roughness: 0.62 });
  tan.name = "WeaponAccent";
  const black = new THREE.MeshStandardMaterial({ color: 0x0b0b0c, roughness: 0.95 });
  const glass = new THREE.MeshPhysicalMaterial({
    color: 0x7a1010,
    metalness: 0.0,
    roughness: 0.05,
    transmission: 0,
    transparent: true,
    opacity: 0.55,
    emissive: 0x330000,
  });

  const g = new THREE.Group();
  g.name = "Rifle";

  /* --- pistol grip (slanted, with finger-groove reliefs) ------------------ */
  const grip = rbox(0.034, 0.105, 0.046, 0.012, poly, 0, -0.035, -0.018, 6);
  grip.rotation.x = 0.32;
  g.add(grip);
  g.add(rbox(0.03, 0.05, 0.016, 0.006, poly, 0, -0.01, -0.04, 6).rotateX(0.32));
  // grip stippling + lanyard loop
  for (let i = 0; i < 5; i++) {
    g.add(sph(0.004, poly, 0.008, -0.03 - i * 0.014, -0.018, 10, 6));
  }
  g.add(ring(0.012, 0.0035, black, 0, -0.085, -0.018, Math.PI / 2, 0, 14));

  /* --- lower receiver + trigger guard ------------------------------------ */
  g.add(rbox(0.04, 0.075, 0.2, 0.008, metal, 0, 0.075, 0.075, 6));
  g.add(rbox(0.012, 0.012, 0.08, 0.004, metal, 0, 0.032, 0.085, 5)); // trigger guard
  g.add(rbox(0.012, 0.03, 0.01, 0.004, darkMetal, 0, 0.035, 0.125, 4)); // guard front
  g.add(rbox(0.008, 0.03, 0.006, 0.002, darkMetal, 0, 0.05, 0.075, 4)); // trigger
  g.add(sph(0.005, darkMetal, 0, 0.05, 0.085, 10, 8)); // trigger curve
  // magwell with bevelled funnel
  g.add(rbox(0.046, 0.05, 0.075, 0.006, metal, 0, 0.02, 0.115, 6));
  g.add(rbox(0.04, 0.012, 0.07, 0.003, darkMetal, 0, 0.001, 0.118, 5)); // magwell floor
  // selector switch + lever
  g.add(rbox(0.014, 0.02, 0.012, 0.003, steel, -0.021, 0.12, 0.03, 5));
  g.add(rbox(0.018, 0.008, 0.02, 0.003, darkMetal, -0.018, 0.135, 0.03, 5));
  // pistol grip pivot bolt
  g.add(cyl(0.006, 0.006, 0.05, steel, 0, 0.075, -0.005, 24));

  /* --- upper receiver with ejection port + details ----------------------- */
  g.add(rbox(0.042, 0.062, 0.29, 0.008, metal, 0, 0.133, 0.1, 6));
  // brass deflector + forward assist on right side (+X is left, -X is right? Wait: eject is +0.03 X)
  g.add(rbox(0.018, 0.032, 0.024, 0.004, darkMetal, 0.025, 0.132, 0.032, 4));
  g.add(cyl(0.007, 0.008, 0.026, steel, 0.024, 0.125, 0.005, 16));
  // ejection port raised lips
  g.add(rbox(0.012, 0.04, 0.07, 0.004, darkMetal, 0.024, 0.13, 0.08, 5));
  g.add(rbox(0.012, 0.004, 0.07, 0.001, steel, 0.026, 0.15, 0.08, 4));
  g.add(rbox(0.012, 0.004, 0.07, 0.001, steel, 0.026, 0.11, 0.08, 4));
  // top picatinny rail (long, with raised serrations)
  g.add(rbox(0.024, 0.012, 0.66, 0.002, darkMetal, 0, 0.172, 0.2, 6));
  for (let i = 0; i < 26; i++) {
    g.add(rbox(0.026, 0.0045, 0.006, 0.001, steel, 0, 0.178, -0.11 + i * 0.026, 3));
  }
  // rail cross-slots (front)
  for (let i = 0; i < 3; i++) {
    g.add(rbox(0.026, 0.004, 0.02, 0.001, steel, 0, 0.178, 0.36 + i * 0.02, 3));
  }

  /* --- charging handle ---------------------------------------------------- */
  const charge = rbox(0.034, 0.014, 0.03, 0.004, darkMetal, 0, 0.158, -0.056, 6);
  g.add(charge);
  g.add(rbox(0.01, 0.01, 0.034, 0.003, steel, 0.013, 0.158, -0.056, 4)); // roller knob

  /* --- handguard (tan, vented, with full picatinny under-rail) ------------ */
  g.add(rbox(0.064, 0.064, 0.3, 0.014, tan, 0, 0.125, 0.4, 6));
  for (let i = 0; i < 6; i++) {
    g.add(rbox(0.066, 0.012, 0.018, 0.003, darkMetal, 0, 0.125, 0.3 + i * 0.045, 5));
  }
  // side vent slots
  for (let i = 0; i < 4; i++) {
    g.add(rbox(0.004, 0.04, 0.02, 0.001, darkMetal, 0.0325, 0.125, 0.32 + i * 0.06, 3));
    g.add(rbox(0.004, 0.04, 0.02, 0.001, darkMetal, -0.0325, 0.125, 0.32 + i * 0.06, 3));
  }
  g.add(rbox(0.02, 0.012, 0.22, 0.002, darkMetal, 0, 0.09, 0.42, 5)); // under-rail
  for (let i = 0; i < 10; i++) {
    g.add(rbox(0.022, 0.003, 0.005, 0.001, steel, 0, 0.095, 0.33 + i * 0.02, 3));
  }
  // handguard bolts
  g.add(sph(0.005, steel, 0.032, 0.155, 0.26, 10, 8));
  g.add(sph(0.005, steel, -0.032, 0.155, 0.26, 10, 8));
  // vertical/angled foregrip aligned with leftPalm (z ≈ 0.34) + side tactical PEQ laser module
  const vfg = rbox(0.026, 0.072, 0.032, 0.008, poly, 0, 0.056, 0.35, 5);
  vfg.rotation.x = -0.15;
  g.add(vfg);
  g.add(rbox(0.028, 0.022, 0.075, 0.005, tan, -0.04, 0.13, 0.46, 5));
  g.add(cyl(0.006, 0.006, 0.014, steel, -0.04, 0.13, 0.502, 14));

  /* --- barrel, gas block, front sight ------------------------------------ */
  g.add(cyl(0.0085, 0.0085, 0.2, metal, 0, 0.125, 0.62, 32));
  g.add(cyl(0.0085, 0.0085, 0.2, darkMetal, 0, 0.125, 0.62, 32, true)); // barrel sleeve
  g.add(rbox(0.026, 0.03, 0.03, 0.006, darkMetal, 0, 0.14, 0.57, 6)); // gas block
  g.add(cyl(0.011, 0.011, 0.018, steel, 0, 0.14, 0.585, 20)); // gas block vent
  g.add(rbox(0.008, 0.032, 0.008, 0.002, darkMetal, 0, 0.17, 0.57, 5)); // front sight post
  g.add(sph(0.005, darkMetal, 0, 0.188, 0.57, 12, 8)); // sight tip

  /* --- muzzle silencer (tactical suppressor for stealth ops) -------------- */
  g.add(cyl(0.013, 0.013, 0.04, darkMetal, 0, 0.125, 0.73, 20)); // mount collar
  g.add(cyl(0.0195, 0.0195, 0.19, darkMetal, 0, 0.125, 0.835, 28)); // suppressor body
  g.add(cyl(0.0205, 0.0205, 0.022, steel, 0, 0.125, 0.748, 24)); // locking ring
  for (let i = 0; i < 4; i++) {
    g.add(ring(0.02, 0.0016, steel, 0, 0.125, 0.785 + i * 0.034, 0, 0, 22));
  }
  g.add(ring(0.016, 0.0022, metal, 0, 0.125, 0.93, 0, 0, 20)); // end cap crown

  /* --- stock (tube + adjustable butt) ------------------------------------ */
  g.add(cyl(0.0175, 0.0175, 0.17, darkMetal, 0, 0.13, -0.17, 24));
  g.add(cyl(0.0175, 0.0175, 0.17, steel, 0, 0.13, -0.17, 24, true)); // tube sleeve
  g.add(rbox(0.046, 0.1, 0.17, 0.016, poly, 0, 0.1, -0.215, 6));
  g.add(rbox(0.036, 0.04, 0.14, 0.01, poly, 0, 0.1, -0.17, 6));
  const pad = rbox(0.05, 0.12, 0.024, 0.008, black, 0, 0.096, -0.31, 6);
  pad.rotation.x = -0.12;
  g.add(pad);
  g.add(ring(0.019, 0.003, steel, 0, 0.13, -0.255, 0, 0, 20)); // butt collar
  // sling swivel on stock
  g.add(ring(0.007, 0.0025, steel, 0.032, 0.15, -0.22, 0, Math.PI / 2, 14));

  /* --- optic (holo / red dot) with ring mounts ---------------------------- */
  const optic = new THREE.Group();
  optic.add(rbox(0.036, 0.012, 0.075, 0.003, darkMetal, 0, 0, 0, 5));
  optic.add(rbox(0.05, 0.05, 0.085, 0.01, darkMetal, 0, 0.034, 0.0, 6));
  const win = new THREE.Mesh(new THREE.CircleGeometry(0.02, 28), glass);
  win.position.set(0, 0.036, 0.0435);
  optic.add(win);
  const win2 = win.clone();
  win2.position.z = -0.0435;
  win2.rotation.y = Math.PI;
  optic.add(win2);
  // lens rim (XY plane facing Z -> rotX = 0)
  optic.add(ring(0.02, 0.0025, steel, 0, 0.036, 0.0435, 0, 0, 24));
  optic.add(ring(0.02, 0.0025, steel, 0, 0.036, -0.0435, 0, 0, 24));
  // scope rings on the rail
  optic.add(rbox(0.026, 0.016, 0.02, 0.003, steel, 0, -0.008, 0.02, 6));
  optic.add(rbox(0.026, 0.016, 0.02, 0.003, steel, 0, -0.008, -0.02, 6));
  optic.position.set(0, 0.188, 0.08);
  g.add(optic);

  /* --- magazine (curved, own group so it can be animated) ---------------- */
  const mag = new THREE.Group();
  const magMat = new THREE.MeshStandardMaterial({ color: 0x1b1c1e, metalness: 0.5, roughness: 0.55 });
  const m1 = rbox(0.03, 0.1, 0.058, 0.006, magMat, 0, -0.01, 0, 5);
  const m2 = rbox(0.03, 0.09, 0.058, 0.006, magMat, 0, -0.095, 0.014, 5);
  m2.rotation.x = -0.16;
  const m3 = rbox(0.032, 0.014, 0.062, 0.004, black, 0, -0.148, 0.025, 5);
  m3.rotation.x = -0.16;
  mag.add(m1, m2, m3);
  // magazine follower + floor + witness window
  mag.add(sph(0.006, darkMetal, 0, 0.06, 0.002, 10, 6));
  mag.add(rbox(0.03, 0.006, 0.05, 0.002, darkMetal, 0, -0.152, 0.02, 5));
  mag.add(rbox(0.01, 0.003, 0.02, 0.001, glass, 0.011, -0.05, 0.002, 4));
  // mag base pad
  mag.add(rbox(0.034, 0.01, 0.06, 0.004, black, 0, -0.16, 0.02, 5));
  mag.position.copy(RIFLE.magRest);
  g.add(mag);

  const makeMagClone = () => {
    const c = new THREE.Group();
    mag.children.forEach((ch) => {
      const m = (ch as THREE.Mesh).clone();
      c.add(m);
    });
    return c;
  };

  /* --- markers (gameplay anchors — keep positions stable) ----------------- */
  const muzzle = new THREE.Object3D();
  muzzle.position.set(0, 0.125, 0.94);
  g.add(muzzle);
  const eject = new THREE.Object3D();
  eject.position.set(0.03, 0.13, 0.06);
  g.add(eject);

  return { group: g, muzzle, eject, mag, charge, makeMagClone, leftPalm: RIFLE.leftPalm.clone() };
}

export function buildWeapon(id: WeaponId): Rifle {
  if (id === "carbine") return buildRifle();
  const metal = new THREE.MeshStandardMaterial({ color: 0x23262b, metalness: 0.9, roughness: 0.38 });
  metal.name = "WeaponBody";
  const darkMetal = new THREE.MeshStandardMaterial({ color: 0x131518, metalness: 0.85, roughness: 0.5 });
  const steel = new THREE.MeshStandardMaterial({ color: 0x9aa0a8, metalness: 0.95, roughness: 0.28 });
  const poly = new THREE.MeshStandardMaterial({ color: 0x17181a, metalness: 0.05, roughness: 0.72 });
  const tan = new THREE.MeshStandardMaterial({ color: 0x7c6e58, metalness: 0.08, roughness: 0.6 });
  tan.name = "WeaponAccent";
  const wood = new THREE.MeshStandardMaterial({ color: 0x4e3522, metalness: 0.05, roughness: 0.75 });
  wood.name = "WeaponAccent";
  const glass = new THREE.MeshPhysicalMaterial({ color: 0x14384e, metalness: 0.1, roughness: 0.05, transparent: true, opacity: 0.7, emissive: 0x0a1c28 });

  const g = new THREE.Group();
  g.name = `Weapon_${id}`;

  const grip = rbox(0.034, 0.105, 0.044, 0.012, poly, 0, -0.035, -0.018, 5);
  grip.rotation.x = 0.32;
  g.add(grip);
  g.add(rbox(0.012, 0.012, 0.075, 0.004, metal, 0, 0.032, 0.08, 4));
  g.add(rbox(0.008, 0.028, 0.006, 0.002, darkMetal, 0, 0.05, 0.075, 4));

  const charge = rbox(0.032, 0.014, 0.03, 0.004, darkMetal, 0, 0.155, -0.056, 5);
  g.add(charge);

  const mag = new THREE.Group();
  const magMat = new THREE.MeshStandardMaterial({ color: 0x1c1e22, metalness: 0.55, roughness: 0.5 });

  let muzzleZ = 0.75;
  let leftPalm = RIFLE.leftPalm.clone();

  if (id === "smg") {
    // Compact tactical suppressed SMG
    g.add(rbox(0.04, 0.085, 0.24, 0.008, darkMetal, 0, 0.105, 0.09, 5));
    g.add(rbox(0.022, 0.01, 0.26, 0.002, metal, 0, 0.155, 0.12, 4));
    // Folding wire stock
    g.add(cyl(0.007, 0.007, 0.22, steel, -0.016, 0.125, -0.14, 14));
    g.add(cyl(0.007, 0.007, 0.22, steel, 0.016, 0.125, -0.14, 14));
    g.add(rbox(0.042, 0.09, 0.022, 0.006, poly, 0, 0.1, -0.25, 5));
    // Compact forend + vertical foregrip
    g.add(rbox(0.048, 0.056, 0.14, 0.01, poly, 0, 0.115, 0.25, 5));
    g.add(rbox(0.026, 0.078, 0.03, 0.008, poly, 0, 0.05, 0.24, 5));
    leftPalm = new THREE.Vector3(0, 0.052, 0.24);
    // Integral suppressor shroud + baffled rings
    g.add(cyl(0.0225, 0.0225, 0.25, darkMetal, 0, 0.12, 0.43, 24));
    g.add(ring(0.023, 0.002, steel, 0, 0.12, 0.545, 0, 0, 20));
    g.add(ring(0.023, 0.0016, steel, 0, 0.12, 0.34, 0, 0, 20));
    // Micro reflex optic
    g.add(rbox(0.034, 0.034, 0.055, 0.006, darkMetal, 0, 0.18, 0.08, 4));
    const lens = new THREE.Mesh(new THREE.CircleGeometry(0.013, 18), glass);
    lens.position.set(0, 0.182, 0.109);
    g.add(lens);
    // Straight 32rd stick magazine
    const sm1 = rbox(0.024, 0.2, 0.036, 0.004, magMat, 0, -0.07, 0, 4);
    sm1.rotation.x = 0.08;
    mag.add(sm1);
    mag.position.set(0, -0.02, 0.13);
    muzzleZ = 0.565;
  } else if (id === "shotgun") {
    // Combat Pump-Action Shotgun with Salvo-style rectangular silencer
    g.add(rbox(0.044, 0.075, 0.24, 0.008, metal, 0, 0.105, 0.08, 5));
    // Fixed buttstock
    const st = rbox(0.044, 0.095, 0.26, 0.014, poly, 0, 0.08, -0.17, 5);
    st.rotation.x = -0.08;
    g.add(st);
    g.add(rbox(0.048, 0.115, 0.025, 0.008, darkMetal, 0, 0.07, -0.3, 5));
    // Long barrel + full under-barrel magazine tube
    g.add(cyl(0.012, 0.013, 0.56, darkMetal, 0, 0.132, 0.46, 24));
    g.add(cyl(0.011, 0.011, 0.48, metal, 0, 0.102, 0.42, 20));
    // Salvo-style tactical shotgun silencer
    g.add(rbox(0.038, 0.056, 0.2, 0.009, darkMetal, 0, 0.122, 0.83, 5));
    g.add(rbox(0.041, 0.06, 0.02, 0.004, steel, 0, 0.122, 0.735, 4));
    for (let i = 0; i < 3; i++) g.add(rbox(0.04, 0.006, 0.008, 0.002, steel, 0, 0.122, 0.78 + i * 0.045, 3));
    // Ribbed pump forend
    const pump = rbox(0.048, 0.052, 0.19, 0.012, wood, 0, 0.095, 0.33, 5);
    g.add(pump);
    for (let i = 0; i < 7; i++) g.add(rbox(0.051, 0.012, 0.012, 0.003, darkMetal, 0, 0.095, 0.25 + i * 0.026, 3));
    leftPalm = new THREE.Vector3(0, 0.06, 0.31);
    // Ghost-ring sight + barrel clamp
    g.add(rbox(0.022, 0.02, 0.03, 0.004, steel, 0, 0.155, 0.06, 4));
    g.add(rbox(0.028, 0.045, 0.024, 0.004, darkMetal, 0, 0.118, 0.64, 4));
    // Detachable side-saddle / shell block as mag prop
    mag.add(rbox(0.016, 0.045, 0.08, 0.004, darkMetal, 0, 0, 0, 4));
    for (let i = 0; i < 4; i++) {
      mag.add(cyl(0.008, 0.008, 0.042, new THREE.MeshStandardMaterial({ color: 0x9e2420, roughness: 0.5 }), 0, 0.005, -0.027 + i * 0.018, 12));
    }
    mag.position.set(-0.028, 0.105, 0.08);
    muzzleZ = 0.94;
  } else {
    // Falcon Mk14-SD Silenced Marksman Rifle (DMR)
    g.add(rbox(0.042, 0.072, 0.28, 0.008, tan, 0, 0.105, 0.1, 5));
    g.add(rbox(0.022, 0.012, 0.58, 0.002, darkMetal, 0, 0.152, 0.22, 4));
    // Precision stock w/ cheek riser
    g.add(rbox(0.046, 0.098, 0.24, 0.012, tan, 0, 0.095, -0.18, 5));
    g.add(rbox(0.04, 0.032, 0.14, 0.01, poly, 0, 0.145, -0.18, 5));
    // Long fluted handguard + folding bipod + extended precision barrel + long titanium silencer
    g.add(rbox(0.056, 0.058, 0.34, 0.01, tan, 0, 0.118, 0.41, 5));
    leftPalm = new THREE.Vector3(0, 0.06, 0.3);
    g.add(cyl(0.009, 0.011, 0.32, steel, 0, 0.125, 0.7, 24));
    g.add(cyl(0.021, 0.021, 0.23, darkMetal, 0, 0.125, 0.97, 28)); // titanium suppressor
    g.add(cyl(0.0225, 0.0225, 0.024, steel, 0, 0.125, 0.865, 24)); // collar
    for (let i = 0; i < 4; i++) g.add(ring(0.0215, 0.0016, steel, 0, 0.125, 0.91 + i * 0.042, 0, 0, 22));
    // Bipod legs tucked forward
    for (const sx of [-1, 1]) {
      const leg = cyl(0.006, 0.006, 0.18, darkMetal, sx * 0.024, 0.075, 0.47, 10);
      leg.rotation.y = sx * 0.1;
      g.add(leg);
    }
    // Magnified sniper scope (long tube + sunshade + elevation turrets)
    g.add(rbox(0.026, 0.022, 0.022, 0.003, steel, 0, 0.172, 0.05, 4));
    g.add(rbox(0.026, 0.022, 0.022, 0.003, steel, 0, 0.172, 0.17, 4));
    g.add(cyl(0.019, 0.019, 0.22, darkMetal, 0, 0.198, 0.11, 24));
    g.add(cyl(0.026, 0.021, 0.08, darkMetal, 0, 0.198, 0.24, 24));
    g.add(cyl(0.023, 0.02, 0.06, darkMetal, 0, 0.198, -0.02, 24));
    g.add(cyl(0.009, 0.009, 0.02, steel, 0, 0.22, 0.11, 14));
    const lensF = new THREE.Mesh(new THREE.CircleGeometry(0.022, 20), glass);
    lensF.position.set(0, 0.198, 0.281);
    g.add(lensF);
    // Short 12-rd box mag
    mag.add(rbox(0.03, 0.11, 0.062, 0.005, magMat, 0, -0.04, 0, 4));
    mag.position.set(0, -0.02, 0.125);
    muzzleZ = 1.095;
  }

  g.add(mag);
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

  return { group: g, muzzle, eject, mag, charge, makeMagClone, leftPalm };
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
