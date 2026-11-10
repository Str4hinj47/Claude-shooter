import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";

/**
 * Procedural carbine. Local space: origin = centre of pistol grip,
 * +Z = muzzle direction, +Y = up, +X = shooter's LEFT (same convention as the character).
 */
export interface Rifle {
  group: THREE.Group;
  muzzle: THREE.Object3D;
  eject: THREE.Object3D;
  mag: THREE.Group;
  charge: THREE.Mesh;
  makeMagClone: () => THREE.Group;
}

export const RIFLE = {
  // Hand placement in weapon-local space
  rightPalm: new THREE.Vector3(0.0, -0.005, -0.012),
  leftPalm: new THREE.Vector3(0.0, 0.058, 0.25),
  magRest: new THREE.Vector3(0, -0.075, 0.115),
  chargeHandle: new THREE.Vector3(0, 0.16, -0.065),
  magWell: new THREE.Vector3(0, -0.02, 0.115),
};

function rbox(w: number, h: number, l: number, r: number, mat: THREE.Material, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(new RoundedBoxGeometry(w, h, l, 2, Math.min(r, w / 2.2, h / 2.2, l / 2.2)), mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}
function cyl(rt: number, rb: number, len: number, mat: THREE.Material, x = 0, y = 0, z = 0, seg = 20) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, len, seg), mat);
  m.rotation.x = Math.PI / 2;
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

export function buildRifle(): Rifle {
  const metal = new THREE.MeshStandardMaterial({ color: 0x23262b, metalness: 0.9, roughness: 0.38 });
  const darkMetal = new THREE.MeshStandardMaterial({ color: 0x131518, metalness: 0.85, roughness: 0.5 });
  const poly = new THREE.MeshStandardMaterial({ color: 0x17181a, metalness: 0.05, roughness: 0.72 });
  const tan = new THREE.MeshStandardMaterial({ color: 0x6d6150, metalness: 0.05, roughness: 0.62 });
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

  // --- pistol grip (slanted)
  const grip = rbox(0.034, 0.105, 0.046, 0.012, poly, 0, -0.035, -0.018);
  grip.rotation.x = 0.32;
  g.add(grip);
  // finger grooves bump
  const gripBack = rbox(0.03, 0.05, 0.016, 0.006, poly, 0, -0.01, -0.04);
  gripBack.rotation.x = 0.32;
  g.add(gripBack);

  // --- lower receiver + trigger guard
  g.add(rbox(0.04, 0.075, 0.2, 0.008, metal, 0, 0.075, 0.075));
  const tg = rbox(0.012, 0.012, 0.08, 0.004, metal, 0, 0.032, 0.085);
  g.add(tg);
  g.add(rbox(0.012, 0.03, 0.01, 0.004, darkMetal, 0, 0.035, 0.125)); // guard front
  g.add(rbox(0.008, 0.03, 0.006, 0.002, darkMetal, 0, 0.05, 0.075)); // trigger
  // magwell
  g.add(rbox(0.046, 0.05, 0.075, 0.006, metal, 0, 0.02, 0.115));

  // --- upper receiver with ejection bump
  g.add(rbox(0.042, 0.062, 0.29, 0.008, metal, 0, 0.133, 0.1));
  g.add(rbox(0.012, 0.04, 0.07, 0.004, darkMetal, 0.024, 0.13, 0.08)); // dust cover side (left)
  // picatinny rail (top)
  const rail = rbox(0.022, 0.01, 0.62, 0.002, darkMetal, 0, 0.17, 0.2);
  g.add(rail);
  for (let i = 0; i < 22; i++) {
    g.add(rbox(0.024, 0.004, 0.006, 0.001, metal, 0, 0.177, -0.08 + i * 0.026));
  }

  // --- charging handle
  const charge = rbox(0.034, 0.014, 0.03, 0.004, darkMetal, 0, 0.158, -0.056);
  g.add(charge);

  // --- handguard (tan, with vents)
  const hg = rbox(0.064, 0.064, 0.3, 0.014, tan, 0, 0.125, 0.4);
  g.add(hg);
  for (let i = 0; i < 6; i++) {
    g.add(rbox(0.066, 0.012, 0.018, 0.003, darkMetal, 0, 0.125, 0.3 + i * 0.045));
  }
  // under-rail
  g.add(rbox(0.02, 0.012, 0.22, 0.002, darkMetal, 0, 0.09, 0.42));

  // --- barrel, gas block, flash hider
  g.add(cyl(0.0085, 0.0085, 0.2, metal, 0, 0.125, 0.62));
  g.add(rbox(0.026, 0.03, 0.03, 0.006, darkMetal, 0, 0.14, 0.57));
  g.add(rbox(0.008, 0.032, 0.008, 0.002, darkMetal, 0, 0.17, 0.57)); // front sight post
  g.add(cyl(0.0125, 0.0125, 0.075, darkMetal, 0, 0.125, 0.745, 18));
  for (let i = 0; i < 3; i++) g.add(cyl(0.0145, 0.0145, 0.006, darkMetal, 0, 0.125, 0.72 + i * 0.022, 18));

  // --- stock
  g.add(cyl(0.0175, 0.0175, 0.17, darkMetal, 0, 0.13, -0.17));
  g.add(rbox(0.046, 0.1, 0.17, 0.016, poly, 0, 0.1, -0.215));
  g.add(rbox(0.036, 0.04, 0.14, 0.01, poly, 0, 0.165 - 0.065, -0.17));
  const pad = rbox(0.05, 0.12, 0.024, 0.008, new THREE.MeshStandardMaterial({ color: 0x0b0b0c, roughness: 0.95 }), 0, 0.096, -0.31);
  pad.rotation.x = -0.12;
  g.add(pad);

  // --- optic (holo / red dot)
  const optic = new THREE.Group();
  optic.add(rbox(0.036, 0.012, 0.075, 0.003, darkMetal, 0, 0, 0));
  optic.add(rbox(0.05, 0.05, 0.085, 0.01, darkMetal, 0, 0.034, 0.0));
  const win = new THREE.Mesh(new THREE.PlaneGeometry(0.038, 0.036), glass);
  win.position.set(0, 0.04, 0.0435);
  optic.add(win);
  const win2 = win.clone();
  win2.position.z = -0.0435;
  win2.rotation.y = Math.PI;
  optic.add(win2);
  optic.position.set(0, 0.182, 0.08);
  g.add(optic);

  // --- magazine (curved, own group so it can be animated)
  const mag = new THREE.Group();
  const magMat = new THREE.MeshStandardMaterial({ color: 0x1b1c1e, metalness: 0.5, roughness: 0.55 });
  const m1 = rbox(0.03, 0.1, 0.058, 0.006, magMat, 0, -0.01, 0);
  const m2 = rbox(0.03, 0.09, 0.058, 0.006, magMat, 0, -0.095, 0.014);
  m2.rotation.x = -0.16;
  const m3 = rbox(0.032, 0.014, 0.062, 0.004, new THREE.MeshStandardMaterial({ color: 0x08090a, roughness: 0.8 }), 0, -0.148, 0.025);
  m3.rotation.x = -0.16;
  mag.add(m1, m2, m3);
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

  // --- markers
  const muzzle = new THREE.Object3D();
  muzzle.position.set(0, 0.125, 0.79);
  g.add(muzzle);
  const eject = new THREE.Object3D();
  eject.position.set(0.03, 0.13, 0.06);
  g.add(eject);

  return { group: g, muzzle, eject, mag, charge, makeMagClone };
}
