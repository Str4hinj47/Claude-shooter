import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import type { NvgMode } from "../game/progression";

/**
 * Modular bone-attached tactical equipment for SoldierRig.
 *
 * All parts are authored in METRES relative to each target Mixamo bone's local frame,
 * then each sub-group is scaled by 100 when attached to the Mixamo Armature bones
 * (because soldier.glb's Armature scales 0.01 cm -> m).
 */

export interface EquipmentConfig {
  nvg: NvgMode;
  backpack: boolean;
  chestRig: boolean;
  holster: boolean;
  headset: boolean;
}

export interface SoldierEquipment {
  attach: (bones: Record<string, THREE.Object3D>) => void;
  setVisible: (v: boolean) => void;
  tint: (bodyHex: number, accentHex: number, visorIntensity?: number) => void;
  configure: (cfg: EquipmentConfig) => void;
  dispose: () => void;
}

function makeMesh(geo: THREE.BufferGeometry, mat: THREE.Material, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.rotation.set(rx, ry, rz);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

function rbox(w: number, h: number, d: number, r: number, mat: THREE.Material, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) {
  const geo = new RoundedBoxGeometry(w, h, d, 3, Math.min(r, w / 2.2, h / 2.2, d / 2.2));
  return makeMesh(geo, mat, x, y, z, rx, ry, rz);
}

export function buildEquipment(): SoldierEquipment {
  // Per-soldier materials so faction tinting never leaks across characters
  const fabric = new THREE.MeshStandardMaterial({ color: 0x2e3338, roughness: 0.88, metalness: 0.04 });
  const polymer = new THREE.MeshStandardMaterial({ color: 0x24282d, roughness: 0.52, metalness: 0.35 });
  const plate = new THREE.MeshStandardMaterial({ color: 0x383c42, roughness: 0.62, metalness: 0.25 });
  const metal = new THREE.MeshStandardMaterial({ color: 0x80848c, roughness: 0.35, metalness: 0.9 });
  const darkMetal = new THREE.MeshStandardMaterial({ color: 0x16181c, roughness: 0.55, metalness: 0.72 });
  const lens = new THREE.MeshStandardMaterial({
    color: 0x102830,
    roughness: 0.1,
    metalness: 0.9,
    emissive: 0x1a5a6a,
    emissiveIntensity: 0.35,
  });

  const groups: THREE.Group[] = [];

  /* ---------------- 1. Spine2: Rear Assault Pack + Chest Placard ---------------- */
  const torso = new THREE.Group();
  torso.name = "EquipTorso";
  torso.scale.setScalar(100);
  groups.push(torso);

  // Rear tactical assault / radio pack (sits cleanly behind upper torso armor, z < -0.15)
  const pack = new THREE.Group();
  pack.position.set(0, -0.04, -0.2);
  pack.add(rbox(0.27, 0.34, 0.13, 0.025, fabric, 0, 0, 0));
  pack.add(rbox(0.28, 0.075, 0.145, 0.018, polymer, 0, 0.18, 0.005)); // top lid
  pack.add(rbox(0.22, 0.18, 0.055, 0.015, fabric, 0, -0.06, -0.075)); // outer admin pocket
  // MOLLE webbing straps + buckles
  for (const py of [-0.08, 0.0, 0.08]) {
    pack.add(rbox(0.26, 0.018, 0.136, 0.004, darkMetal, 0, py, 0));
  }
  for (const sx of [-0.075, 0.075]) {
    pack.add(rbox(0.026, 0.036, 0.02, 0.004, metal, sx, 0.14, -0.072));
  }
  // Side utility pouches
  for (const sx of [-1, 1]) {
    pack.add(rbox(0.055, 0.16, 0.095, 0.014, fabric, sx * 0.158, -0.04, 0.01));
  }
  // Radio unit + whip antenna on left shoulder of pack
  pack.add(rbox(0.055, 0.11, 0.04, 0.008, darkMetal, 0.105, 0.16, -0.02));
  pack.add(makeMesh(new THREE.CylinderGeometry(0.004, 0.006, 0.28, 8), darkMetal, 0.11, 0.34, -0.03, -0.08, 0, 0.05));
  torso.add(pack);

  // Front chest rig mag placard (sits flush over sternum/chest armor, z ≈ +0.135)
  const chest = new THREE.Group();
  chest.position.set(0, -0.09, 0.135);
  chest.add(rbox(0.24, 0.15, 0.032, 0.008, plate, 0, 0, 0));
  // 3 AR mag pouches + protruding mag tops
  for (const mx of [-0.072, 0, 0.072]) {
    chest.add(rbox(0.058, 0.12, 0.045, 0.008, fabric, mx, -0.008, 0.026, -0.08));
    chest.add(rbox(0.046, 0.04, 0.032, 0.005, darkMetal, mx, 0.068, 0.022, -0.08));
    chest.add(rbox(0.052, 0.014, 0.012, 0.003, metal, mx, 0.045, 0.048));
  }
  // Upper chest PTT radio + IFAK pouch
  chest.add(rbox(0.05, 0.065, 0.026, 0.006, darkMetal, 0.085, 0.13, -0.01, -0.15));
  torso.add(chest);

  /* ---------------- 2. Head: Flip-Up NVG Shroud + Tactical Comms ---------------- */
  const head = new THREE.Group();
  head.name = "EquipHead";
  head.scale.setScalar(100);
  groups.push(head);

  // Brow NVG shroud + flip-up dual-tube optics (folded cleanly above visor)
  const nvg = new THREE.Group();
  nvg.position.set(0, 0.185, 0.105);
  nvg.add(rbox(0.055, 0.042, 0.022, 0.005, metal, 0, 0, 0)); // shroud mount
  const arm = new THREE.Group();
  arm.position.set(0, 0.015, 0.015);
  arm.rotation.x = -0.62; // flipped upward at ~35 deg above brow
  arm.add(rbox(0.095, 0.024, 0.055, 0.006, darkMetal, 0, 0.01, 0.022));
  for (const sx of [-0.032, 0.032]) {
    arm.add(makeMesh(new THREE.CylinderGeometry(0.017, 0.019, 0.068, 12), darkMetal, sx, 0.006, 0.045, Math.PI / 2));
    arm.add(makeMesh(new THREE.CylinderGeometry(0.013, 0.013, 0.008, 12), lens, sx, 0.006, 0.08, Math.PI / 2));
  }
  nvg.add(arm);
  head.add(nvg);

  // Side helmet accessory rails, ear-pro cups, tactical light & boom mic
  const comms = new THREE.Group();
  for (const sx of [-1, 1]) {
    comms.add(rbox(0.018, 0.032, 0.11, 0.005, polymer, sx * 0.102, 0.135, 0.0));
    comms.add(rbox(0.024, 0.072, 0.064, 0.012, darkMetal, sx * 0.106, 0.078, -0.008));
  }
  // Tactical helmet flashlight on left rail (+X)
  comms.add(makeMesh(new THREE.CylinderGeometry(0.012, 0.012, 0.065, 10), metal, 0.118, 0.145, 0.02, Math.PI / 2));
  // Comms boom mic curving toward chin
  comms.add(rbox(0.008, 0.008, 0.095, 0.002, darkMetal, 0.088, 0.045, 0.048, 0.18, -0.35, 0));
  head.add(comms);

  /* ---------------- 3. RightUpLeg: Drop-Leg Holster ---------------- */
  // Note: in RightUpLeg local coords, +Y is DOWN toward knee, -X is outer right, -Z is forward
  const rLeg = new THREE.Group();
  rLeg.name = "EquipRightLeg";
  rLeg.scale.setScalar(100);
  groups.push(rLeg);

  const strapGeo = new THREE.TorusGeometry(0.082, 0.012, 8, 18);
  strapGeo.rotateX(Math.PI / 2);
  rLeg.add(makeMesh(strapGeo, fabric, 0, 0.15, 0));
  rLeg.add(makeMesh(strapGeo, fabric, 0, 0.22, 0));
  // Kydex drop-leg holster + pistol grip
  rLeg.add(rbox(0.046, 0.14, 0.075, 0.01, polymer, -0.088, 0.185, 0, 0, 0, -0.06));
  rLeg.add(rbox(0.032, 0.085, 0.042, 0.008, darkMetal, -0.092, 0.105, 0.022, -0.35, 0, -0.08));

  /* ---------------- 4. LeftUpLeg: Thigh Utility / Mag Pouch ---------------- */
  const lLeg = new THREE.Group();
  lLeg.name = "EquipLeftLeg";
  lLeg.scale.setScalar(100);
  groups.push(lLeg);

  lLeg.add(makeMesh(strapGeo, fabric, 0, 0.16, 0));
  lLeg.add(rbox(0.048, 0.14, 0.11, 0.012, fabric, 0.088, 0.165, 0));
  lLeg.add(rbox(0.014, 0.028, 0.042, 0.004, metal, 0.112, 0.12, 0));

  const attach = (bones: Record<string, THREE.Object3D>) => {
    (bones["Spine2"] ?? bones["Spine"] ?? bones["Hips"])?.add(torso);
    bones["Head"]?.add(head);
    bones["RightUpLeg"]?.add(rLeg);
    bones["LeftUpLeg"]?.add(lLeg);
  };

  const setVisible = (v: boolean) => {
    for (const g of groups) g.visible = v;
  };

  const tint = (bodyHex: number, accentHex: number, visorIntensity = 0.45) => {
    const b = new THREE.Color(bodyHex);
    const a = new THREE.Color(accentHex);
    fabric.color.copy(b);
    polymer.color.copy(b).multiplyScalar(0.75);
    plate.color.copy(b).multiplyScalar(0.88);
    lens.color.copy(a).multiplyScalar(0.35);
    lens.emissive.copy(a);
    lens.emissiveIntensity = visorIntensity;
  };

  const configure = (cfg: EquipmentConfig) => {
    pack.visible = cfg.backpack;
    chest.visible = cfg.chestRig;
    rLeg.visible = cfg.holster;
    lLeg.visible = cfg.holster;
    comms.visible = cfg.headset;
    if (cfg.nvg === "none") {
      nvg.visible = false;
    } else {
      nvg.visible = true;
      // "flipped" tilts optics up on brow (-0.62); "deployed" lowers dual-tubes right over the visor (+0.78)
      arm.rotation.x = cfg.nvg === "deployed" ? 0.78 : -0.62;
    }
  };

  const dispose = () => {
    for (const g of groups) {
      g.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh) m.geometry.dispose();
      });
    }
    fabric.dispose();
    polymer.dispose();
    plate.dispose();
    metal.dispose();
    darkMetal.dispose();
    lens.dispose();
  };

  return { attach, setVisible, tint, configure, dispose };
}
