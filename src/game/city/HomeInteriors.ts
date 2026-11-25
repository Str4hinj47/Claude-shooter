import * as THREE from "three";
import type { ApartmentId } from "../progression";
import type { CarId } from "../vehicles/catalog";
import { attachGlbToGroup } from "./PropModels";

export type StationKind =
  | "bed"
  | "weapon_bench"
  | "closet"
  | "garage_mod"
  | "garage_door"
  | "intel_board"
  | "apt_door_ext"
  | "apt_door_int"
  | "apt_garage_ext"
  | "apt_garage_elev"
  | "apt_garage_to_apt"
  | "apt_garage_to_street"
  | "apt_garage_car";

export interface HomeStation {
  id: string;
  kind: StationKind;
  label: string;
  sublabel?: string;
  pos: { x: number; y: number; z: number };
  radius: number;
  autoOpen?: boolean;
  apartmentId?: ApartmentId;
  apartmentName?: string;
  price?: number;
  carId?: CarId;
}

export interface InteriorBuilderCtx {
  solid: (
    lx: number,
    ly: number,
    lz: number,
    w: number,
    h: number,
    d: number,
    mat: THREE.Material,
    kind?: "concrete" | "wood" | "metal" | "dirt",
    localYaw?: number,
    castShadow?: boolean,
  ) => void;
  visual: (
    lx: number,
    ly: number,
    lz: number,
    w: number,
    h: number,
    d: number,
    mat: THREE.Material,
    localYaw?: number,
    castShadow?: boolean,
  ) => void;
  addMesh: (mesh: THREE.Object3D, lx: number, ly: number, lz: number, localYaw?: number) => void;
}

export interface InteriorPalette {
  woodDark: THREE.Material;
  woodLight: THREE.Material;
  metalDark: THREE.Material;
  brass: THREE.Material;
  chrome: THREE.Material;
  stoneCounter: THREE.Material;
  fabricSofa: THREE.Material;
  fabricBed: THREE.Material;
  linenWhite: THREE.Material;
  accentPillow: THREE.Material;
  rugMat: THREE.Material;
  glass: THREE.Material;
  warmGlow: THREE.Material;
  coolGlow: THREE.Material;
  screenGlow: THREE.Material;
  foliage: THREE.Material;
  ceramic: THREE.Material;
}

export function createInteriorPalette(opts: {
  sofaHex?: number;
  throwHex?: number;
  accentHex?: number;
  rugHex?: number;
  woodDarkHex?: number;
  woodLightHex?: number;
  counterHex?: number;
} = {}): InteriorPalette {
  return {
    woodDark: new THREE.MeshStandardMaterial({ color: opts.woodDarkHex ?? 0x4b3221, roughness: 0.58, metalness: 0.06 }),
    woodLight: new THREE.MeshStandardMaterial({ color: opts.woodLightHex ?? 0xa57a52, roughness: 0.64, metalness: 0.04 }),
    metalDark: new THREE.MeshStandardMaterial({ color: 0x1b2028, roughness: 0.38, metalness: 0.78 }),
    brass: new THREE.MeshStandardMaterial({ color: 0xc8a15a, roughness: 0.28, metalness: 0.88 }),
    chrome: new THREE.MeshStandardMaterial({ color: 0xd5dde6, roughness: 0.18, metalness: 0.92 }),
    stoneCounter: new THREE.MeshStandardMaterial({ color: opts.counterHex ?? 0xe7e5e0, roughness: 0.24, metalness: 0.08 }),
    fabricSofa: new THREE.MeshStandardMaterial({ color: opts.sofaHex ?? 0x353c47, roughness: 0.88 }),
    fabricBed: new THREE.MeshStandardMaterial({ color: opts.throwHex ?? 0x26384d, roughness: 0.86 }),
    linenWhite: new THREE.MeshStandardMaterial({ color: 0xf4f1ea, roughness: 0.88 }),
    accentPillow: new THREE.MeshStandardMaterial({ color: opts.accentHex ?? 0xc7924e, roughness: 0.82 }),
    rugMat: new THREE.MeshStandardMaterial({ color: opts.rugHex ?? 0x7b756b, roughness: 0.94 }),
    glass: new THREE.MeshStandardMaterial({
      color: 0x8cc8e8,
      roughness: 0.08,
      metalness: 0.35,
      transparent: true,
      opacity: 0.38,
    }),
    warmGlow: new THREE.MeshStandardMaterial({
      color: 0xfff0cc,
      emissive: 0xffcb74,
      emissiveIntensity: 1.6,
      roughness: 0.25,
    }),
    coolGlow: new THREE.MeshStandardMaterial({
      color: 0xd8f3ff,
      emissive: 0x38bdf8,
      emissiveIntensity: 1.35,
      roughness: 0.25,
    }),
    screenGlow: new THREE.MeshStandardMaterial({
      color: 0x0e1726,
      emissive: 0x1e40af,
      emissiveIntensity: 0.95,
      roughness: 0.18,
    }),
    foliage: new THREE.MeshStandardMaterial({ color: 0x2e6438, roughness: 0.84 }),
    ceramic: new THREE.MeshStandardMaterial({ color: 0xf0efeb, roughness: 0.22, metalness: 0.05 }),
  };
}

/**
 * Detailed King Platform Bed: uses open-source CC0 double bed GLB (`kk_bed_double.glb`)
 * over a textured area rug, flanked by twin nightstands, warm table lamps, and framed art.
 */
export function buildDetailedKingBed(
  ctx: InteriorBuilderCtx,
  pal: InteriorPalette,
  cx: number,
  yFloor: number,
  cz: number,
  yaw = 0,
): void {
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  const at = (dx: number, dz: number) => ({
    x: cx + dx * c + dz * s,
    z: cz - dx * s + dz * c,
  });

  // Woven area rug under bed (clean thin GLB + fallback visual pad)
  const rg = at(0, 0.2);
  const rugAnchor = new THREE.Group();
  ctx.addMesh(rugAnchor, rg.x, yFloor + 0.005, rg.z, yaw);
  attachGlbToGroup(rugAnchor, "kk_rug.glb", 0, 0, 0, { axis: "x", targetMeters: 3.4 });

  // Open-source modern double bed model (no oversized primitive boxes hiding it!)
  const pf = at(0, 0);
  const bedAnchor = new THREE.Group();
  ctx.addMesh(bedAnchor, pf.x, yFloor + 0.02, pf.z, yaw);
  attachGlbToGroup(bedAnchor, "kk_bed_double.glb", 0, 0, 0, { axis: "z", targetMeters: 2.35 });

  // Twin nightstands + warm glowing bedside lamps
  for (const nx of [-1.52, 1.52]) {
    const ns = at(nx, -0.78);
    const nsAnchor = new THREE.Group();
    ctx.addMesh(nsAnchor, ns.x, yFloor, ns.z, yaw);
    attachGlbToGroup(nsAnchor, "int_nightstand.glb", 0, 0, 0, { axis: "y", targetMeters: 0.56 });
    attachGlbToGroup(nsAnchor, "int_lamp.glb", 0, 0.56, 0, { axis: "y", targetMeters: 0.44 });
    // Subtle warm lamp shade glow
    const shade = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.11, 0.14, 12), pal.warmGlow);
    ctx.addMesh(shade, ns.x, yFloor + 0.88, ns.z, yaw);
  }
}

/**
 * Detailed Walk-In Wardrobe Closet: sleek Poly Haven & KayKit CC0 cabinetry
 * (steel-and-oak drawer cabinet, decorated double wardrobe, oak cubby shelves),
 * runner rug, and an illuminated full-length dressing mirror.
 */
export function buildDetailedCloset(
  ctx: InteriorBuilderCtx,
  pal: InteriorPalette,
  cx: number,
  yFloor: number,
  cz: number,
  yaw = 0,
): void {
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  const at = (dx: number, dz: number) => ({
    x: cx + dx * c + dz * s,
    z: cz - dx * s + dz * c,
  });

  // Left module: Poly Haven CC0 black steel & oak drawer cabinet
  const leftPos = at(-1.32, 0.0);
  const leftAnchor = new THREE.Group();
  ctx.addMesh(leftAnchor, leftPos.x, yFloor, leftPos.z, yaw);
  attachGlbToGroup(leftAnchor, "ph_drawer_cabinet.glb", 0, 0, 0, { axis: "y", targetMeters: 1.95 });

  // Center module: KayKit CC0 decorated double wardrobe cabinet
  const midPos = at(0.05, 0.0);
  const midAnchor = new THREE.Group();
  ctx.addMesh(midAnchor, midPos.x, yFloor, midPos.z, yaw);
  attachGlbToGroup(midAnchor, "kk_wardrobe.glb", 0, 0, 0, { axis: "y", targetMeters: 2.02 });

  // Right module: Poly Haven CC0 oak cubby wardrobe shelves with storage bins
  const rightPos = at(1.38, 0.0);
  const rightAnchor = new THREE.Group();
  ctx.addMesh(rightAnchor, rightPos.x, yFloor, rightPos.z, yaw + Math.PI * 0.5);
  attachGlbToGroup(rightAnchor, "ph_wardrobe_shelves.glb", 0, 0, 0, { axis: "y", targetMeters: 1.85 });

  // Illuminated full-length dressing mirror (opaque silvered mirror glass in brass frame)
  const mir = at(2.26, -0.08);
  ctx.solid(mir.x, yFloor, mir.z, 0.74, 2.06, 0.08, pal.brass, "metal", yaw);
  const mirrorMat = new THREE.MeshStandardMaterial({
    color: 0xb8c4d0,
    roughness: 0.06,
    metalness: 0.94,
  });
  const mirFace = at(2.26, -0.03);
  ctx.visual(mirFace.x, yFloor + 0.14, mirFace.z, 0.62, 1.82, 0.03, mirrorMat, yaw);
  ctx.visual(mirFace.x, yFloor + 1.98, mirFace.z, 0.64, 0.04, 0.04, pal.warmGlow, yaw);
}

/**
 * Detailed Gunsmith Weapon Workbench with heavy steel legs, oiled butcher-block top,
 * illuminated tactical pegboard, mounted rifle & SMG silhouettes, vise, and ammo crates.
 */
export function buildDetailedWeaponWorkbench(
  ctx: InteriorBuilderCtx,
  pal: InteriorPalette,
  cx: number,
  yFloor: number,
  cz: number,
  yaw = 0,
): void {
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  const at = (dx: number, dz: number) => ({
    x: cx + dx * c + dz * s,
    z: cz - dx * s + dz * c,
  });

  // Heavy steel bench frame + butcher-block oak worktop
  const base = at(0, 0);
  ctx.solid(base.x, yFloor, base.z, 2.45, 0.88, 0.84, pal.metalDark, "metal", yaw);
  ctx.visual(base.x, yFloor + 0.89, base.z, 2.52, 0.07, 0.9, pal.woodLight, yaw);

  // Under-bench red/gunmetal tool drawers
  const drw = at(-0.62, 0.02);
  const redMat = new THREE.MeshStandardMaterial({ color: 0xb91c1c, roughness: 0.42, metalness: 0.55 });
  ctx.visual(drw.x, yFloor + 0.44, drw.z, 0.95, 0.66, 0.76, redMat, yaw);

  // Illuminated pegboard backboard
  const pb = at(0, -0.36);
  ctx.solid(pb.x, yFloor + 0.95, pb.z, 2.44, 1.25, 0.07, pal.metalDark, "metal", yaw);
  const pegGlow = at(0, -0.31);
  ctx.visual(pegGlow.x, yFloor + 2.15, pegGlow.z, 2.36, 0.05, 0.08, pal.coolGlow, yaw);

  // Mounted carbine + suppressor + optic silhouette on pegboard
  const g1 = at(-0.35, -0.29);
  ctx.visual(g1.x, yFloor + 1.66, g1.z, 0.95, 0.11, 0.06, pal.chrome, yaw);
  ctx.visual(g1.x, yFloor + 1.78, g1.z, 0.24, 0.08, 0.05, pal.brass, yaw);
  const g2 = at(0.68, -0.29);
  ctx.visual(g2.x, yFloor + 1.56, g2.z, 0.58, 0.1, 0.06, pal.metalDark, yaw);

  // Rifle resting on bench mat + ammo cases
  const matPos = at(-0.15, 0.05);
  ctx.visual(matPos.x, yFloor + 0.96, matPos.z, 1.05, 0.02, 0.45, pal.fabricSofa, yaw);
  ctx.visual(matPos.x, yFloor + 1.0, matPos.z, 0.82, 0.08, 0.12, pal.metalDark, yaw);
  const ammo = at(0.85, 0.04);
  const oliveMat = new THREE.MeshStandardMaterial({ color: 0x3f4e37, roughness: 0.68, metalness: 0.25 });
  ctx.visual(ammo.x, yFloor + 1.05, ammo.z, 0.36, 0.2, 0.24, oliveMat, yaw);
}

/**
 * Detailed Modern Kitchen Suite: lower cabinets, stone waterfall counter, upper cabinets,
 * stainless steel range hood, refrigerator tower, breakfast island, and 3 barstools.
 */
export function buildDetailedKitchen(
  ctx: InteriorBuilderCtx,
  pal: InteriorPalette,
  cx: number,
  yFloor: number,
  cz: number,
  yaw = 0,
): void {
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  const at = (dx: number, dz: number) => ({
    x: cx + dx * c + dz * s,
    z: cz - dx * s + dz * c,
  });

  // Back counter run + stone top
  const bc = at(-0.4, -1.35);
  ctx.solid(bc.x, yFloor, bc.z, 3.8, 0.92, 0.78, pal.woodDark, "wood", yaw);
  ctx.visual(bc.x, yFloor + 0.94, bc.z, 3.86, 0.06, 0.84, pal.stoneCounter, yaw);
  // Stovetop glass pad + stainless range hood
  const stv = at(-0.2, -1.32);
  ctx.visual(stv.x, yFloor + 0.98, stv.z, 0.95, 0.02, 0.56, pal.metalDark, yaw);
  ctx.visual(stv.x, yFloor + 2.05, stv.z, 1.05, 0.55, 0.52, pal.chrome, yaw);

  // Upper wall cabinets + under-cabinet warm strip
  const uc = at(-1.45, -1.48);
  ctx.solid(uc.x, yFloor + 1.65, uc.z, 1.65, 0.9, 0.45, pal.woodLight, "wood", yaw);
  ctx.visual(uc.x, yFloor + 1.63, uc.z + 0.08, 1.58, 0.03, 0.06, pal.warmGlow, yaw);

  // Tall brushed-steel double-door refrigerator
  const fr = at(1.95, -1.35);
  ctx.solid(fr.x, yFloor, fr.z, 0.95, 2.25, 0.84, pal.chrome, "metal", yaw);

  const fridgeAnchor = new THREE.Group();
  ctx.addMesh(fridgeAnchor, fr.x, yFloor, fr.z);
  attachGlbToGroup(fridgeAnchor, "int_fridge.glb", 0, 0, 0, { axis: "y", targetMeters: 2.15 });

  const ovenAnchor = new THREE.Group();
  ctx.addMesh(ovenAnchor, stv.x, yFloor, stv.z);
  attachGlbToGroup(ovenAnchor, "int_oven.glb", 0, 0, 0, { axis: "y", targetMeters: 0.94 });

  const sinkPos = at(-1.25, -1.35);
  const sinkAnchor = new THREE.Group();
  ctx.addMesh(sinkAnchor, sinkPos.x, yFloor, sinkPos.z);
  attachGlbToGroup(sinkAnchor, "int_sink.glb", 0, 0, 0, { axis: "y", targetMeters: 0.94 });

  const cabPos = at(-2.1, -1.35);
  const cabAnchor = new THREE.Group();
  ctx.addMesh(cabAnchor, cabPos.x, yFloor, cabPos.z);
  attachGlbToGroup(cabAnchor, "int_cabinet.glb", 0, 0, 0, { axis: "y", targetMeters: 0.92 });

  // Waterfall Island + 3 modern barstools
  const isl = at(0.1, 0.45);
  ctx.solid(isl.x, yFloor, isl.z, 3.2, 0.92, 1.05, pal.woodDark, "wood", yaw);
  ctx.visual(isl.x, yFloor + 0.94, isl.z, 3.3, 0.07, 1.12, pal.stoneCounter, yaw);
  for (const sx of [-0.95, 0.1, 1.15]) {
    const bs = at(sx, 1.32);
    ctx.solid(bs.x, yFloor, bs.z, 0.42, 0.68, 0.42, pal.metalDark, "metal", yaw);
    ctx.visual(bs.x, yFloor + 0.69, bs.z, 0.44, 0.08, 0.44, pal.accentPillow, yaw);
  }
}

/**
 * Detailed Living Lounge: large L-sectional sofa, cushions, glass coffee table,
 * area rug, credenza with 80" OLED TV, and a potted architectural fiddle-leaf plant.
 */
export function buildDetailedLivingLounge(
  ctx: InteriorBuilderCtx,
  pal: InteriorPalette,
  cx: number,
  yFloor: number,
  cz: number,
  yaw = 0,
): void {
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  const at = (dx: number, dz: number) => ({
    x: cx + dx * c + dz * s,
    z: cz - dx * s + dz * c,
  });

  // Area rug
  const rug = at(0, 0.2);
  ctx.visual(rug.x, yFloor + 0.015, rug.z, 4.4, 0.025, 3.6, pal.rugMat, yaw);

  // Sectional main + chaise
  const sf = at(-0.2, 1.25);
  ctx.solid(sf.x, yFloor, sf.z, 3.4, 0.46, 1.05, pal.fabricSofa, "wood", yaw);
  const sfb = at(-0.2, 1.64);
  ctx.solid(sfb.x, yFloor + 0.46, sfb.z, 3.4, 0.44, 0.28, pal.fabricSofa, "wood", yaw);
  const ch = at(1.0, 0.25);
  ctx.solid(ch.x, yFloor, ch.z, 1.05, 0.46, 1.95, pal.fabricSofa, "wood", yaw);
  for (const px of [-1.25, -0.3, 0.65]) {
    const pl = at(px, 1.38);
    ctx.visual(pl.x, yFloor + 0.56, pl.z, 0.46, 0.34, 0.2, pal.accentPillow, yaw);
  }

  // Coffee table
  const ct = at(-0.35, -0.05);
  ctx.solid(ct.x, yFloor, ct.z, 1.55, 0.38, 0.85, pal.metalDark, "metal", yaw);
  ctx.visual(ct.x, yFloor + 0.4, ct.z, 1.62, 0.04, 0.9, pal.glass, yaw);

  // Media credenza + 80" OLED TV
  const cr = at(-0.2, -1.85);
  ctx.solid(cr.x, yFloor, cr.z, 3.1, 0.54, 0.56, pal.woodDark, "wood", yaw);
  ctx.visual(cr.x, yFloor + 1.15, cr.z - 0.14, 2.35, 1.3, 0.08, pal.metalDark, yaw);
  ctx.visual(cr.x, yFloor + 1.18, cr.z - 0.08, 2.22, 1.16, 0.04, pal.screenGlow, yaw);

  // Potted architectural indoor plant
  const pl = at(2.1, -1.7);
  const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.18, 0.46, 14), pal.ceramic);
  ctx.addMesh(pot, pl.x, yFloor + 0.23, pl.z);
  const crown = new THREE.Mesh(new THREE.SphereGeometry(0.42, 12, 10), pal.foliage);
  ctx.addMesh(crown, pl.x, yFloor + 0.96, pl.z);

  const plantAnchor = new THREE.Group();
  ctx.addMesh(plantAnchor, pl.x, yFloor, pl.z);
  attachGlbToGroup(plantAnchor, "int_plant.glb", 0, 0, 0, {
    axis: "y",
    targetMeters: 1.28,
    onAttached: () => {
      pot.visible = false;
      crown.visible = false;
    },
  });

  const couchPos = at(0.05, 0.9);
  const couchAnchor = new THREE.Group();
  ctx.addMesh(couchAnchor, couchPos.x, yFloor, couchPos.z, Math.PI);
  attachGlbToGroup(couchAnchor, "int_couch_l.glb", 0, 0, 0, { axis: "x", targetMeters: 3.3 });

  const tvAnchor = new THREE.Group();
  ctx.addMesh(tvAnchor, cr.x, yFloor + 0.56, cr.z - 0.1);
  attachGlbToGroup(tvAnchor, "int_tv.glb", 0, 0, 0, { axis: "x", targetMeters: 1.85 });
}

/**
 * Detailed Dining Table & 4 Chairs.
 */
export function buildDetailedDiningSet(
  ctx: InteriorBuilderCtx,
  pal: InteriorPalette,
  cx: number,
  yFloor: number,
  cz: number,
  yaw = 0,
): void {
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  const at = (dx: number, dz: number) => ({
    x: cx + dx * c + dz * s,
    z: cz - dx * s + dz * c,
  });

  const tb = at(0, 0);
  ctx.solid(tb.x, yFloor, tb.z, 2.1, 0.76, 1.05, pal.woodLight, "wood", yaw);
  const tableAnchor = new THREE.Group();
  ctx.addMesh(tableAnchor, tb.x, yFloor, tb.z);
  attachGlbToGroup(tableAnchor, "int_table.glb", 0, 0, 0, { axis: "x", targetMeters: 2.08 });
  // 4 chairs
  for (const [dx, dz] of [
    [-0.55, -0.78],
    [0.55, -0.78],
    [-0.55, 0.78],
    [0.55, 0.78],
  ]) {
    const ch = at(dx, dz);
    ctx.solid(ch.x, yFloor, ch.z, 0.48, 0.46, 0.48, pal.fabricSofa, "wood", yaw);
    ctx.visual(ch.x, yFloor + 0.48, ch.z + (dz > 0 ? 0.18 : -0.18), 0.46, 0.44, 0.1, pal.fabricSofa, yaw);
    const chAnchor = new THREE.Group();
    ctx.addMesh(chAnchor, ch.x, yFloor, ch.z, dz > 0 ? Math.PI : 0);
    attachGlbToGroup(chAnchor, "int_chair.glb", 0, 0, 0, { axis: "y", targetMeters: 0.88 });
  }
}

/**
 * Detailed Overtake Garage Car Customization Bay (illuminated floor pad, tire display rack,
 * diagnostic cart & monitor).
 */
export function buildGarageModBay(
  ctx: InteriorBuilderCtx,
  pal: InteriorPalette,
  cx: number,
  yFloor: number,
  cz: number,
  yaw = 0,
): void {
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  const at = (dx: number, dz: number) => ({
    x: cx + dx * c + dz * s,
    z: cz - dx * s + dz * c,
  });

  // Illuminated floor strip markers framing the 1-car mod bay (3.0m wide)
  for (const sx of [-1.48, 1.48]) {
    const strip = at(sx, 0);
    ctx.visual(strip.x, yFloor + 0.015, strip.z, 0.12, 0.02, 5.0, pal.coolGlow, yaw);
  }
  const frontStrip = at(0, -2.45);
  ctx.visual(frontStrip.x, yFloor + 0.015, frontStrip.z, 3.08, 0.02, 0.12, pal.coolGlow, yaw);

  // Compact Overtake ECU diagnostic kiosk tucked cleanly in the front corner of the bay
  const k = at(1.62, -2.15);
  ctx.solid(k.x, yFloor, k.z, 0.56, 1.05, 0.48, pal.metalDark, "metal", yaw);
  ctx.visual(k.x, yFloor + 1.24, k.z, 0.52, 0.38, 0.08, pal.screenGlow, yaw);
}
