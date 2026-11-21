import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";

/**
 * Procedural tactical equipment for the soldier rig.
 *
 * Built in the model's local space and parented to a spine bone so it follows
 * the character's animations. This adds genuine geometric detail (real triangles)
 * directly on the soldier — backpack, chest rig with ballistic plates, helmet,
 * pouches, grenades — without touching the binary rigged .glb (which can't be
 * subdivided in code). Designed to be tinted per faction like the body armour.
 */

export interface SoldierEquipment {
  group: THREE.Group;
  /** tint the loadout to a faction colour */
  tint: (bodyHex: number, accentHex: number) => void;
  dispose: () => void;
}

const M = {
  // fabric / load-bearing (tinted per faction)
  fabric: new THREE.MeshStandardMaterial({ color: 0x2f3338, roughness: 0.88, metalness: 0.02 }),
  // hard polymer / armor (tinted per faction)
  polymer: new THREE.MeshStandardMaterial({ color: 0x25282d, roughness: 0.55, metalness: 0.35 }),
  // ballistic plate (ceramic, stays neutral)
  plate: new THREE.MeshStandardMaterial({ color: 0x393c40, roughness: 0.62, metalness: 0.25 }),
  // metal hardware (buckles, clips, rails)
  metal: new THREE.MeshStandardMaterial({ color: 0x7d8086, roughness: 0.35, metalness: 0.95 }),
  darkMetal: new THREE.MeshStandardMaterial({ color: 0x191b1e, roughness: 0.6, metalness: 0.7 }),
  // visor / glass
  glass: new THREE.MeshStandardMaterial({ color: 0x101316, roughness: 0.12, metalness: 0.9 }),
};

function mesh(geo: THREE.BufferGeometry, mat: THREE.Material, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}
function rbox(w: number, h: number, d: number, r: number, x = 0, y = 0, z = 0, seg = 4) {
  return mesh(new RoundedBoxGeometry(w, h, d, seg, Math.min(r, w / 2.2, h / 2.2, d / 2.2)), M.polymer, x, y, z);
}
function cyl(rt: number, rb: number, len: number, x = 0, y = 0, z = 0, seg = 24, rotX = 0) {
  const m = mesh(new THREE.CylinderGeometry(rt, rb, len, seg, 1), M.metal, x, y, z);
  m.rotation.x = rotX;
  return m;
}

/** Build a detailed tactical loadout. Coordinates: model-local, +Y up, ~1.82m tall, +Z forward. */
export function buildEquipment(): SoldierEquipment {
  const g = new THREE.Group();
  g.name = "Equipment";

  /* ---------------- backpack (parented high on the back) ---------------- */
  const pack = new THREE.Group();
  pack.position.set(0, 1.25, -0.27);
  // main pack body (rounded)
  pack.add(rbox(0.5, 0.72, 0.3, 0.08, 0, 0, 0, 5));
  // pack lid + flap
  pack.add(rbox(0.52, 0.16, 0.32, 0.04, 0, 0.4, 0.01, 4));
  pack.add(rbox(0.5, 0.28, 0.04, 0.02, 0, 0.24, 0.16, 4));
  // bungee cord loops (torus) around the pack
  for (const yy of [-0.18, 0.06, 0.24]) {
    const loop = mesh(new THREE.TorusGeometry(0.25, 0.018, 8, 24), M.darkMetal, 0, yy, 0);
    loop.rotation.x = Math.PI / 2;
    pack.add(loop);
  }
  // buckles + D-rings on the straps
  for (const sx of [-0.16, 0.16]) {
    pack.add(mesh(new THREE.BoxGeometry(0.05, 0.08, 0.03), M.metal, sx, 0.24, 0.17));
    const ring = mesh(new THREE.TorusGeometry(0.04, 0.012, 8, 16), M.metal, sx, 0.34, 0.17);
    ring.rotation.x = Math.PI / 2;
    pack.add(ring);
  }
  // side pouches
  for (const sx of [-1, 1]) {
    const pouch = rbox(0.14, 0.34, 0.26, 0.04, sx * 0.27, -0.08, 0, 4);
    pack.add(pouch);
    pack.add(mesh(new THREE.BoxGeometry(0.05, 0.04, 0.03), M.metal, sx * 0.27, 0.02, 0.14));
  }
  // hydration tube + mouthpiece over the shoulder
  const tube = cyl(0.022, 0.022, 0.5, 0.14, 0.46, 0.02, 12, Math.PI / 2 + 0.3);
  pack.add(tube);
  g.add(pack);

  /* ---------------- chest rig + ballistic plates ---------------- */
  const chest = new THREE.Group();
  chest.position.set(0, 1.18, 0.04);
  // vest base (front panel)
  chest.add(rbox(0.62, 0.6, 0.16, 0.05, 0, 0, 0.02, 5));
  // back panel
  chest.add(rbox(0.6, 0.58, 0.1, 0.04, 0, 0, -0.09, 4));
  // shoulder straps looping over the shoulders
  for (const sx of [-1, 1]) {
    const strap = mesh(new THREE.TorusGeometry(0.16, 0.03, 8, 20, Math.PI), M.fabric, sx * 0.2, 0.28, -0.02);
    strap.rotation.x = Math.PI / 2;
    strap.rotation.z = sx * 0.2;
    chest.add(strap);
  }
  // ballistic plates (front + back), with standoffs
  for (const sz of [1, -1]) {
    const plate = mesh(new RoundedBoxGeometry(0.46, 0.5, 0.08, 4, 0.03), M.plate, 0, 0.02, sz * 0.09);
    chest.add(plate);
    // plate standoff bolts
    for (const [px, py] of [[-0.18, 0.18], [0.18, 0.18], [-0.18, -0.18], [0.18, -0.18]]) {
      chest.add(cyl(0.02, 0.02, 0.04, px, py, sz * 0.13, 10));
    }
  }
  // front mag pouches (angled)
  for (const sx of [-1, 1]) {
    const pouch = rbox(0.13, 0.26, 0.12, 0.03, sx * 0.18, -0.12, 0.06, 4);
    pouch.rotation.x = -0.15;
    chest.add(pouch);
    chest.add(mesh(new THREE.BoxGeometry(0.09, 0.03, 0.02), M.metal, sx * 0.18, -0.02, 0.12));
  }
  // centre admin pouch
  chest.add(rbox(0.16, 0.2, 0.1, 0.03, 0, -0.16, 0.07, 4));
  chest.add(mesh(new THREE.BoxGeometry(0.05, 0.02, 0.02), M.metal, 0, -0.07, 0.12));
  // quick-release buckles
  for (const sx of [-1, 1]) chest.add(mesh(new THREE.BoxGeometry(0.04, 0.05, 0.02), M.metal, sx * 0.2, 0.27, 0.03));
  g.add(chest);

  /* ---------------- helmet ---------------- */
  const helmet = new THREE.Group();
  helmet.position.set(0, 1.62, 0.0);
  // dome (sphere top)
  const dome = mesh(new THREE.SphereGeometry(0.16, 28, 20, 0, Math.PI * 2, 0, Math.PI / 2), M.polymer, 0, 0, 0);
  helmet.add(dome);
  // brim
  const brim = mesh(new THREE.CylinderGeometry(0.185, 0.17, 0.04, 28, 1, true), M.polymer, 0, -0.02, 0);
  helmet.add(brim);
  // rear ridge / nape
  helmet.add(rbox(0.2, 0.1, 0.14, 0.04, 0, -0.02, -0.12, 4));
  // visor mount rail + visor
  helmet.add(rbox(0.3, 0.03, 0.04, 0.01, 0, 0.0, 0.16, 3));
  const visor = mesh(new RoundedBoxGeometry(0.28, 0.1, 0.03, 3, 0.01), M.glass, 0, 0.0, 0.185);
  helmet.add(visor);
  // side accessory rails + small light
  for (const sx of [-1, 1]) {
    helmet.add(rbox(0.02, 0.06, 0.2, 0.008, sx * 0.16, 0.02, 0.02, 3));
    const light = mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.03, 12), M.metal, sx * 0.16, 0.06, 0.06);
    light.rotation.x = Math.PI / 2;
    helmet.add(light);
  }
  // chin strap
  const strap = mesh(new THREE.TorusGeometry(0.13, 0.015, 8, 20, Math.PI), M.fabric, 0, -0.05, 0.1);
  strap.rotation.x = Math.PI / 2;
  helmet.add(strap);
  g.add(helmet);

  /* ---------------- leg pouches + grenades ---------------- */
  const legs = new THREE.Group();
  legs.position.set(0, 0.72, 0);
  for (const sx of [-1, 1]) {
    // thigh drop pouch
    const pouch = rbox(0.16, 0.24, 0.12, 0.03, sx * 0.14, 0.1, -0.02, 4);
    legs.add(pouch);
    legs.add(mesh(new THREE.BoxGeometry(0.06, 0.03, 0.02), M.metal, sx * 0.14, 0.18, -0.07));
    // grenade on the pouch
    const grenade = mesh(new THREE.SphereGeometry(0.05, 16, 12), M.darkMetal, sx * 0.14, 0.28, -0.04);
    legs.add(grenade);
    const pin = cyl(0.006, 0.006, 0.04, sx * 0.14, 0.32, -0.04, 8);
    legs.add(pin);
    // shin pocket
    const shin = rbox(0.15, 0.2, 0.1, 0.03, sx * 0.13, -0.28, -0.02, 4);
    legs.add(shin);
  }
  g.add(legs);

  /* ---------------- arm guards ---------------- */
  const arms = new THREE.Group();
  arms.position.set(0, 1.2, 0);
  for (const sx of [-1, 1]) {
    const guard = rbox(0.14, 0.22, 0.12, 0.03, sx * 0.24, 0.12, 0.1, 4);
    arms.add(guard);
    arms.add(mesh(new THREE.BoxGeometry(0.06, 0.03, 0.02), M.metal, sx * 0.24, 0.2, 0.14));
  }
  g.add(arms);

  /* ---------------- faction tint ---------------- */
  const tint = (bodyHex: number, accentHex: number) => {
    M.fabric.color.setHex(bodyHex);
    M.polymer.color.setHex(accentHex);
  };

  const dispose = () => {
    g.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) {
        (m.geometry as THREE.BufferGeometry).dispose();
      }
    });
  };

  return { group: g, tint, dispose };
}
