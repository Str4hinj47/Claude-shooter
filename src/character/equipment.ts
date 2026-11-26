import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import type { NvgMode } from "../game/progression";

/**
 * Modular bone-attached tactical equipment for SoldierRig.
 *
 * All parts are authored in METRES relative to each target Mixamo bone's local frame
 * (+Y up, +Z forward, +X left for Head/Spine2; +Y down, -X outer right, -Z forward for legs),
 * then each sub-group is scaled & aligned onto the target bone (supporting both Mixamo
 * native and Rocketbox/Bip01 skeletons).
 */

export interface EquipmentConfig {
  nvg: NvgMode;
  backpack: boolean;
  chestRig: boolean;
  holster: boolean;
  headset: boolean;
}

export interface BoneMountAlign {
  quat: THREE.Quaternion;
  scale: number;
}

export type EquipmentAlignMap = Partial<Record<"torso" | "head" | "rLeg" | "lLeg", BoneMountAlign>>;

export interface SoldierEquipment {
  attach: (bones: Record<string, THREE.Object3D>, align?: EquipmentAlignMap) => void;
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
  const geo = new RoundedBoxGeometry(w, h, d, 5, Math.min(r, w / 2.2, h / 2.2, d / 2.2));
  return makeMesh(geo, mat, x, y, z, rx, ry, rz);
}

export function buildEquipment(): SoldierEquipment {
  // Per-soldier physical materials so faction tinting never leaks across characters
  const fabric = new THREE.MeshPhysicalMaterial({
    color: 0x2f353b,
    roughness: 0.86,
    metalness: 0.02,
    sheen: 0.55,
    sheenRoughness: 0.8,
    sheenColor: new THREE.Color(0xcfd6df),
  });
  const polymer = new THREE.MeshPhysicalMaterial({
    color: 0x202429,
    roughness: 0.48,
    metalness: 0.25,
    clearcoat: 0.14,
    clearcoatRoughness: 0.4,
  });
  const plate = new THREE.MeshPhysicalMaterial({
    color: 0x383e45,
    roughness: 0.64,
    metalness: 0.18,
    sheen: 0.25,
    sheenRoughness: 0.72,
  });
  const metal = new THREE.MeshPhysicalMaterial({
    color: 0x868c96,
    roughness: 0.28,
    metalness: 0.9,
    clearcoat: 0.12,
  });
  const darkMetal = new THREE.MeshPhysicalMaterial({
    color: 0x16191e,
    roughness: 0.42,
    metalness: 0.78,
  });
  const patchMat = new THREE.MeshPhysicalMaterial({
    color: 0x3b4859,
    roughness: 0.84,
    metalness: 0.04,
    sheen: 0.4,
  });
  const lens = new THREE.MeshPhysicalMaterial({
    color: 0x0b2532,
    roughness: 0.06,
    metalness: 0.88,
    clearcoat: 1.0,
    clearcoatRoughness: 0.04,
    iridescence: 0.45,
    emissive: 0x145e75,
    emissiveIntensity: 0.42,
  });
  const flashLens = new THREE.MeshStandardMaterial({
    color: 0xdbeafe,
    roughness: 0.12,
    metalness: 0.2,
    emissive: 0x93c5fd,
    emissiveIntensity: 0.45,
  });
  const strobeMat = new THREE.MeshStandardMaterial({
    color: 0x22c55e,
    roughness: 0.25,
    emissive: 0x16a34a,
    emissiveIntensity: 0.6,
  });

  const groups: THREE.Group[] = [];

  /* ---------------- 1. Spine2: Rear Assault Pack + Chest Placard ---------------- */
  const torso = new THREE.Group();
  torso.name = "EquipTorso";
  groups.push(torso);

  // Rear tactical assault / radio pack (sits cleanly behind upper torso armor, z < -0.15)
  const pack = new THREE.Group();
  pack.position.set(0, -0.04, -0.2);
  pack.add(rbox(0.27, 0.34, 0.13, 0.025, fabric, 0, 0, 0));
  pack.add(rbox(0.28, 0.075, 0.145, 0.018, polymer, 0, 0.18, 0.005)); // top storm lid
  pack.add(rbox(0.11, 0.02, 0.022, 0.004, polymer, 0, 0.222, 0.0)); // top drag handle
  pack.add(rbox(0.22, 0.18, 0.055, 0.015, fabric, 0, -0.06, -0.075)); // outer admin pocket
  // Rolled bivy / tarp under pack
  pack.add(makeMesh(new THREE.CylinderGeometry(0.042, 0.042, 0.26, 24), polymer, 0, -0.195, -0.01, 0, 0, Math.PI / 2));
  // MOLLE webbing straps + quick-release buckles
  for (const py of [-0.08, 0.0, 0.08]) {
    pack.add(rbox(0.265, 0.018, 0.136, 0.004, darkMetal, 0, py, 0));
  }
  for (const sx of [-0.075, 0.075]) {
    pack.add(rbox(0.024, 0.038, 0.02, 0.004, metal, sx, 0.14, -0.072));
    pack.add(rbox(0.02, 0.06, 0.018, 0.004, darkMetal, sx, -0.19, -0.038));
  }
  // Side utility / water bottle pouches
  for (const sx of [-1, 1]) {
    pack.add(rbox(0.058, 0.165, 0.095, 0.014, fabric, sx * 0.16, -0.04, 0.01));
  }
  // PRC-152 Radio unit + folding whip antenna + hydration tube routing over right shoulder
  pack.add(rbox(0.055, 0.115, 0.042, 0.008, darkMetal, 0.105, 0.16, -0.02));
  pack.add(makeMesh(new THREE.CylinderGeometry(0.008, 0.01, 0.024, 18), metal, 0.11, 0.225, -0.02));
  pack.add(makeMesh(new THREE.CylinderGeometry(0.0035, 0.0055, 0.30, 16), darkMetal, 0.11, 0.37, -0.03, -0.08, 0, 0.05));
  pack.add(rbox(0.016, 0.016, 0.18, 0.005, polymer, -0.11, 0.21, 0.06, 0.35, 0, 0));
  torso.add(pack);

  // Front chest rig mag placard (sits flush over sternum/chest armor, z ≈ +0.135)
  const chest = new THREE.Group();
  chest.position.set(0, -0.09, 0.135);
  chest.add(rbox(0.245, 0.155, 0.032, 0.008, plate, 0, 0, 0));
  // 3 curved 5.56 PMAG pouches + retention bungee pull-tabs
  for (const mx of [-0.072, 0, 0.072]) {
    chest.add(rbox(0.058, 0.12, 0.045, 0.008, fabric, mx, -0.008, 0.026, -0.08));
    chest.add(rbox(0.046, 0.044, 0.032, 0.005, darkMetal, mx, 0.072, 0.022, -0.08));
    chest.add(rbox(0.050, 0.012, 0.036, 0.003, polymer, mx, 0.094, 0.020, -0.08));
    chest.add(rbox(0.052, 0.014, 0.012, 0.003, metal, mx, 0.045, 0.048));
  }
  // Upper chest PTT radio, tactical ID patch & tourniquet sleeve
  chest.add(rbox(0.052, 0.068, 0.026, 0.006, darkMetal, 0.088, 0.13, -0.008, -0.15));
  chest.add(rbox(0.072, 0.042, 0.010, 0.003, patchMat, -0.04, 0.125, -0.006, -0.12));
  chest.add(rbox(0.036, 0.085, 0.028, 0.006, polymer, -0.145, -0.01, 0.016));
  torso.add(chest);

  /* ---------------- 2. Head: Flip-Up PVS-31 NVG Shroud + Tactical Comms ---------------- */
  const head = new THREE.Group();
  head.name = "EquipHead";
  groups.push(head);

  // Brow Wilcox NVG shroud + flip-up dual-tube PVS-31 binocular optics + rear battery pack + IR strobe
  const nvg = new THREE.Group();
  nvg.position.set(0, 0.175, 0.105);
  nvg.add(rbox(0.056, 0.044, 0.022, 0.005, metal, 0, 0, 0)); // shroud mount
  const arm = new THREE.Group();
  arm.position.set(0, 0.015, 0.015);
  arm.rotation.x = -0.60; // flipped upward above brow
  arm.add(rbox(0.10, 0.022, 0.052, 0.006, darkMetal, 0, 0.01, 0.024));
  for (const sx of [-0.034, 0.034]) {
    // Dual objective barrel + knurled focus ring + ocular eyecup + sapphire objective lens
    arm.add(makeMesh(new THREE.CylinderGeometry(0.017, 0.019, 0.074, 28), darkMetal, sx, 0.006, 0.046, Math.PI / 2));
    arm.add(makeMesh(new THREE.CylinderGeometry(0.020, 0.020, 0.014, 28), metal, sx, 0.006, 0.068, Math.PI / 2));
    arm.add(makeMesh(new THREE.CylinderGeometry(0.015, 0.018, 0.018, 24), polymer, sx, 0.006, 0.006, Math.PI / 2));
    arm.add(makeMesh(new THREE.CylinderGeometry(0.014, 0.014, 0.008, 28), lens, sx, 0.006, 0.084, Math.PI / 2));
  }
  nvg.add(arm);
  // Rear helmet battery counterweight pack & top IR IFF strobe beacon
  nvg.add(rbox(0.086, 0.052, 0.036, 0.008, polymer, 0, -0.025, -0.225));
  nvg.add(rbox(0.034, 0.018, 0.042, 0.005, darkMetal, 0, 0.065, -0.105));
  nvg.add(makeMesh(new THREE.CylinderGeometry(0.009, 0.011, 0.012, 20), strobeMat, 0, 0.078, -0.105));
  head.add(nvg);

  // Side helmet accessory rails, Peltor ear-pro cups, headband arch, tactical light & boom mic
  const comms = new THREE.Group();
  for (const sx of [-1, 1]) {
    comms.add(rbox(0.018, 0.030, 0.115, 0.005, polymer, sx * 0.104, 0.132, 0.0));
    comms.add(rbox(0.026, 0.074, 0.066, 0.014, darkMetal, sx * 0.108, 0.074, -0.008));
    comms.add(rbox(0.012, 0.064, 0.056, 0.010, polymer, sx * 0.095, 0.074, -0.008));
  }
  // Tactical helmet flashlight on left rail (+X) with bezel & lens
  comms.add(makeMesh(new THREE.CylinderGeometry(0.012, 0.012, 0.068, 24), darkMetal, 0.120, 0.142, 0.02, Math.PI / 2));
  comms.add(makeMesh(new THREE.CylinderGeometry(0.014, 0.013, 0.012, 24), metal, 0.120, 0.142, 0.054, Math.PI / 2));
  comms.add(makeMesh(new THREE.CylinderGeometry(0.011, 0.011, 0.004, 24), flashLens, 0.120, 0.142, 0.060, Math.PI / 2));
  // Comms boom mic curving toward chin + foam windscreen tip
  comms.add(rbox(0.007, 0.007, 0.092, 0.002, darkMetal, 0.088, 0.044, 0.046, 0.18, -0.36, 0));
  comms.add(makeMesh(new THREE.SphereGeometry(0.011, 18, 12), polymer, 0.068, 0.034, 0.092));
  head.add(comms);

  /* ---------------- 3. RightUpLeg: Drop-Leg Kydex Holster + Sidearm ---------------- */
  // Note: in RightUpLeg local coords, +Y is DOWN toward knee, -X is outer right, -Z is forward
  const rLeg = new THREE.Group();
  rLeg.name = "EquipRightLeg";
  groups.push(rLeg);

  const strapGeo = new THREE.TorusGeometry(0.084, 0.011, 14, 36);
  strapGeo.rotateX(Math.PI / 2);
  rLeg.add(makeMesh(strapGeo, fabric, 0, 0.145, 0));
  rLeg.add(makeMesh(strapGeo, fabric, 0, 0.22, 0));
  rLeg.add(rbox(0.014, 0.026, 0.028, 0.003, metal, -0.084, 0.145, 0));
  rLeg.add(rbox(0.014, 0.026, 0.028, 0.003, metal, -0.084, 0.22, 0));
  // Molded Kydex holster + holstered pistol (slide + textured grip + rail)
  rLeg.add(rbox(0.048, 0.145, 0.078, 0.01, polymer, -0.090, 0.185, 0, 0, 0, -0.06));
  rLeg.add(rbox(0.028, 0.065, 0.042, 0.004, metal, -0.092, 0.118, -0.006, -0.1, 0, -0.06));
  rLeg.add(rbox(0.030, 0.082, 0.040, 0.008, darkMetal, -0.094, 0.096, 0.028, -0.38, 0, -0.08));

  /* ---------------- 4. LeftUpLeg: Thigh Utility / Mag Pouch ---------------- */
  const lLeg = new THREE.Group();
  lLeg.name = "EquipLeftLeg";
  groups.push(lLeg);

  lLeg.add(makeMesh(strapGeo, fabric, 0, 0.16, 0));
  lLeg.add(makeMesh(strapGeo, fabric, 0, 0.225, 0));
  lLeg.add(rbox(0.050, 0.145, 0.115, 0.012, fabric, 0.090, 0.175, 0));
  lLeg.add(rbox(0.024, 0.09, 0.034, 0.006, polymer, 0.106, 0.165, -0.026));
  lLeg.add(rbox(0.024, 0.09, 0.034, 0.006, polymer, 0.106, 0.165, 0.026));
  lLeg.add(rbox(0.014, 0.028, 0.042, 0.004, metal, 0.114, 0.12, 0));

  const attach = (bones: Record<string, THREE.Object3D>, align?: EquipmentAlignMap) => {
    const mount = (slot: keyof EquipmentAlignMap, bone: THREE.Object3D | undefined, grp: THREE.Group) => {
      if (!bone) return;
      const a = align?.[slot];
      if (a) {
        grp.quaternion.copy(a.quat);
        grp.scale.setScalar(a.scale);
      } else {
        grp.quaternion.identity();
        grp.scale.setScalar(100);
      }
      bone.add(grp);
    };
    mount("torso", bones["Spine2"] ?? bones["Spine"] ?? bones["Hips"], torso);
    mount("head", bones["Head"], head);
    mount("rLeg", bones["RightUpLeg"], rLeg);
    mount("lLeg", bones["LeftUpLeg"], lLeg);
  };

  const setVisible = (v: boolean) => {
    for (const g of groups) g.visible = v;
  };

  const tint = (bodyHex: number, accentHex: number, visorIntensity = 0.45) => {
    const b = new THREE.Color(bodyHex);
    const a = new THREE.Color(accentHex);
    fabric.color.copy(b);
    polymer.color.copy(b).multiplyScalar(0.72);
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
      // "flipped" tilts optics up on brow (-0.60); "deployed" lowers dual-tubes over eyes (+0.78)
      arm.rotation.x = cfg.nvg === "deployed" ? 0.78 : -0.60;
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
    patchMat.dispose();
    lens.dispose();
    flashLens.dispose();
    strobeMat.dispose();
  };

  return { attach, setVisible, tint, configure, dispose };
}
