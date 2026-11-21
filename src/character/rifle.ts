import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";

/**
 * Procedural carbine. Local space: origin = centre of pistol grip,
 * +Z = muzzle direction, +Y = up, +X = shooter's LEFT (same convention as the character).
 *
 * Built for detail: high-segment rounded boxes, bevelled cylinders and a full
 * complement of small parts (scope rings, muzzle device, sling swivel, control
 * detail) so the weapon reads as a high-poly asset.
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
  const darkMetal = new THREE.MeshStandardMaterial({ color: 0x131518, metalness: 0.85, roughness: 0.5 });
  const steel = new THREE.MeshStandardMaterial({ color: 0x9aa0a8, metalness: 0.95, roughness: 0.28 });
  const poly = new THREE.MeshStandardMaterial({ color: 0x17181a, metalness: 0.05, roughness: 0.72 });
  const tan = new THREE.MeshStandardMaterial({ color: 0x6d6150, metalness: 0.05, roughness: 0.62 });
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

  /* --- barrel, gas block, front sight ------------------------------------ */
  g.add(cyl(0.0085, 0.0085, 0.2, metal, 0, 0.125, 0.62, 32));
  g.add(cyl(0.0085, 0.0085, 0.2, darkMetal, 0, 0.125, 0.62, 32, true)); // barrel sleeve
  g.add(rbox(0.026, 0.03, 0.03, 0.006, darkMetal, 0, 0.14, 0.57, 6)); // gas block
  g.add(cyl(0.011, 0.011, 0.018, steel, 0, 0.14, 0.585, 20)); // gas block vent
  g.add(rbox(0.008, 0.032, 0.008, 0.002, darkMetal, 0, 0.17, 0.57, 5)); // front sight post
  g.add(sph(0.005, darkMetal, 0, 0.188, 0.57, 12, 8)); // sight tip

  /* --- muzzle device (flash hider with ring detail) ---------------------- */
  g.add(cyl(0.0125, 0.0125, 0.075, darkMetal, 0, 0.125, 0.745, 24));
  for (let i = 0; i < 3; i++) g.add(cyl(0.0145, 0.0145, 0.006, darkMetal, 0, 0.125, 0.72 + i * 0.022, 24));
  g.add(ring(0.015, 0.0035, steel, 0, 0.125, 0.775, Math.PI / 2, 0, 24));
  // muzzle threads
  for (let i = 0; i < 6; i++) g.add(ring(0.0132, 0.0015, steel, 0, 0.125, 0.782 + i * 0.004, Math.PI / 2, 0, 20));
  // crown ports
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    g.add(cyl(0.002, 0.002, 0.012, darkMetal, Math.sin(a) * 0.009, 0.125, Math.cos(a) * 0.009 + 0.795, 8));
  }

  /* --- stock (tube + adjustable butt) ------------------------------------ */
  g.add(cyl(0.0175, 0.0175, 0.17, darkMetal, 0, 0.13, -0.17, 24));
  g.add(cyl(0.0175, 0.0175, 0.17, steel, 0, 0.13, -0.17, 24, true)); // tube sleeve
  g.add(rbox(0.046, 0.1, 0.17, 0.016, poly, 0, 0.1, -0.215, 6));
  g.add(rbox(0.036, 0.04, 0.14, 0.01, poly, 0, 0.1, -0.17, 6));
  const pad = rbox(0.05, 0.12, 0.024, 0.008, black, 0, 0.096, -0.31, 6);
  pad.rotation.x = -0.12;
  g.add(pad);
  g.add(ring(0.019, 0.003, steel, 0, 0.13, -0.255, Math.PI / 2, 0, 20)); // butt pivot
  // sling swivel on stock
  g.add(ring(0.007, 0.0025, steel, 0.032, 0.15, -0.22, 0, 0, 14));

  /* --- optic (holo / red dot) with ring mounts ---------------------------- */
  const optic = new THREE.Group();
  optic.add(rbox(0.036, 0.012, 0.075, 0.003, darkMetal, 0, 0, 0, 5));
  optic.add(rbox(0.05, 0.05, 0.085, 0.01, darkMetal, 0, 0.034, 0.0, 6));
  const win = new THREE.Mesh(new THREE.CircleGeometry(0.02, 28), glass);
  win.position.set(0, 0.04, 0.0435);
  optic.add(win);
  const win2 = win.clone();
  win2.position.z = -0.0435;
  win2.rotation.y = Math.PI;
  optic.add(win2);
  // lens rim
  optic.add(ring(0.02, 0.0025, steel, 0, 0.04, 0.0435, Math.PI / 2, 0, 24));
  optic.add(ring(0.02, 0.0025, steel, 0, 0.04, -0.0435, Math.PI / 2, 0, 24));
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
  muzzle.position.set(0, 0.125, 0.79);
  g.add(muzzle);
  const eject = new THREE.Object3D();
  eject.position.set(0.03, 0.13, 0.06);
  g.add(eject);

  return { group: g, muzzle, eject, mag, charge, makeMagClone };
}
