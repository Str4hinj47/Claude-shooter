import fs from "node:fs";
import path from "node:path";
import {
  THREE,
  MODELS_DIR,
  loadGlbViaThree,
  cleanDegenerateTriangles,
  bakeSceneToMeters,
  serializeThreeToGlb,
  gltfpackOptimize,
} from "./lib/glb-utils.mjs";

const onlyArg = process.argv.find((a) => a.startsWith("--only="));
const ONLY = onlyArg ? new Set(onlyArg.slice(7).split(",")) : null;
const want = (rel) => !ONLY || ONLY.has(rel) || ONLY.has(path.basename(rel, ".glb"));

function finalizeGlb(outPath, root, rawImages, { keepNames = false, vp = 15 } = {}) {
  const raw = serializeThreeToGlb(root, rawImages);
  const tmp = outPath.replace(/\.glb$/, ".__tmp__.glb");
  fs.writeFileSync(tmp, raw);
  try {
    gltfpackOptimize(tmp, outPath, { keepNames, vp });
  } finally {
    if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
  }
}

function scaleAndGroundScene(scene, { targetY = null, groundY = true, centerXZ = false } = {}) {
  scene.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(scene);
  if (box.isEmpty()) return;
  const sz = box.getSize(new THREE.Vector3());
  const k = targetY && sz.y > 1e-4 ? targetY / sz.y : 1;
  const c = box.getCenter(new THREE.Vector3());
  const dx = centerXZ ? -c.x : 0;
  const dz = centerXZ ? -c.z : 0;
  const dy = groundY ? -box.min.y : 0;

  const v = new THREE.Vector3();
  scene.traverse((o) => {
    if (!o.isMesh || !o.geometry?.attributes?.position) return;
    const pos = o.geometry.getAttribute("position");
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i);
      pos.setXYZ(i, (v.x + dx) * k, (v.y + dy) * k, (v.z + dz) * k);
    }
    pos.needsUpdate = true;
    o.geometry.computeBoundingBox();
    o.geometry.computeBoundingSphere();
  });
}

// ---------------------------------------------------------------------------
// 1. HERO PROP REPAIRS (int_tv & pit_floodlight)
// ---------------------------------------------------------------------------
async function upgradeIntTv() {
  const file = path.join(MODELS_DIR, "int_tv.glb");
  const { scene, images } = await loadGlbViaThree(file);
  bakeSceneToMeters(scene);

  const toRemove = [];
  scene.traverse((o) => {
    if (!o.isMesh) return;
    if (o.name === "TV_1_4") {
      toRemove.push(o);
      return;
    }
    o.geometry = cleanDegenerateTriangles(o.geometry, 1e-8);
    if (o.material?.name === "LightGrey") {
      o.material.roughness = 0.35;
      o.material.metalness = 0.08;
    } else if (o.material?.name === "Grey") {
      o.material.roughness = 0.45;
      o.material.metalness = 0.05;
    }
  });
  for (const r of toRemove) r.parent?.remove(r);

  // Add subtle chrome V-dipole rabbit ears centered on top of the TV cabinet (y=0.320)
  const antMat = new THREE.MeshStandardMaterial({
    name: "TV_Antenna_Metal",
    color: 0xbac4d0,
    metalness: 0.85,
    roughness: 0.22,
  });
  const basePos = new THREE.Vector3(0.045, 0.320, -0.065);
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.030, 0.036, 0.024, 16), antMat);
  base.name = "TV_Antenna_Base";
  base.position.copy(basePos);
  scene.add(base);

  for (const side of [-1, 1]) {
    const tipPos = new THREE.Vector3(basePos.x + side * 0.14, 0.495, basePos.z);
    const dir = new THREE.Vector3().subVectors(tipPos, basePos);
    const len = dir.length();
    const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.005, 0.007, len, 10), antMat);
    rod.name = `TV_Antenna_Rod_${side < 0 ? "L" : "R"}`;
    rod.position.copy(basePos).addScaledVector(dir, 0.5);
    rod.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
    const tip = new THREE.Mesh(new THREE.SphereGeometry(0.011, 10, 8), antMat);
    tip.name = `TV_Antenna_Tip_${side < 0 ? "L" : "R"}`;
    tip.position.copy(tipPos);
    scene.add(rod, tip);
  }

  // Bake new antenna node transforms into vertices BEFORE scaling & grounding!
  bakeSceneToMeters(scene);
  // Scale to ~1.22m tall grounded console TV, centered X/Z
  scaleAndGroundScene(scene, { targetY: 1.22, groundY: true, centerXZ: true });
  finalizeGlb(file, scene, images, { keepNames: false, vp: 15 });
  console.log("Upgraded int_tv.glb");
}

async function upgradePitFloodlight() {
  const file = path.join(MODELS_DIR, "pit_floodlight.glb");
  const root = new THREE.Group();
  root.name = "pit_floodlight";

  const steelMat = new THREE.MeshStandardMaterial({
    name: "flood_steel_dark",
    color: 0x1e242c,
    metalness: 0.72,
    roughness: 0.38,
  });
  const accentMat = new THREE.MeshStandardMaterial({
    name: "flood_hazard_yellow",
    color: 0xeab308,
    metalness: 0.22,
    roughness: 0.42,
  });
  const housingMat = new THREE.MeshStandardMaterial({
    name: "flood_housing_metal",
    color: 0x2c3440,
    metalness: 0.62,
    roughness: 0.34,
  });
  const ledMat = new THREE.MeshStandardMaterial({
    name: "flood_led_emitter",
    color: 0xfff8e6,
    emissive: 0xffe4a8,
    emissiveIntensity: 1.45,
    roughness: 0.10,
    metalness: 0.05,
  });

  // 3 splayed tripod legs touching y=0 cleanly
  const hubY = 0.62;
  const footR = 0.46;
  for (let i = 0; i < 3; i++) {
    const a = (i * Math.PI * 2) / 3 + Math.PI / 6;
    const fx = Math.cos(a) * footR;
    const fz = Math.sin(a) * footR;
    const p0 = new THREE.Vector3(fx, 0.015, fz);
    const p1 = new THREE.Vector3(0, hubY, 0);
    const dir = new THREE.Vector3().subVectors(p1, p0);
    const len = dir.length();
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.018, len, 12), steelMat);
    leg.name = `tripod_leg_${i}`;
    leg.position.copy(p0).addScaledVector(dir, 0.5);
    leg.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
    root.add(leg);

    const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.032, 0.03, 12), steelMat);
    foot.name = `tripod_foot_${i}`;
    foot.position.set(fx, 0.015, fz);
    root.add(foot);
  }

  // Central hub + telescoping mast + hazard collar
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.042, 0.042, 0.08, 16), accentMat);
  hub.name = "tripod_collar";
  hub.position.set(0, hubY, 0);
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.026, 0.95, 14), steelMat);
  mast.name = "tripod_mast";
  mast.position.set(0, 0.78, 0);
  const cross = new THREE.Mesh(new THREE.BoxGeometry(0.66, 0.045, 0.045), accentMat);
  cross.name = "flood_crossbar";
  cross.position.set(0, 1.24, 0);
  root.add(hub, mast, cross);

  // Twin floodlight heads aimed forward (+Z) and slightly down
  for (const side of [-1, 1]) {
    const headGrp = new THREE.Group();
    headGrp.name = `flood_head_${side < 0 ? "L" : "R"}`;
    headGrp.position.set(side * 0.21, 1.32, 0.02);
    headGrp.rotation.x = 0.22;

    const yoke = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.09, 0.04), steelMat);
    yoke.position.set(0, -0.06, -0.02);
    const casing = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.19, 0.12), housingMat);
    casing.position.set(0, 0.03, 0);
    const bezel = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.16, 0.02), steelMat);
    bezel.position.set(0, 0.03, 0.062);
    const lens = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.13, 0.014), ledMat);
    lens.position.set(0, 0.03, 0.068);
    headGrp.add(yoke, casing, bezel, lens);
    root.add(headGrp);
  }

  bakeSceneToMeters(root);
  scaleAndGroundScene(root, { groundY: true, centerXZ: true });
  finalizeGlb(file, root, [], { keepNames: false, vp: 15 });
  console.log("Upgraded pit_floodlight.glb");
}

// ---------------------------------------------------------------------------
// 2. STREET, PIT, COLLECTIBLE & INTERIOR PROPS
// ---------------------------------------------------------------------------
const PROP_SPECS = [
  // Scale + ground + center
  { rel: "park_bench.glb", targetY: 0.78, groundY: true, centerXZ: true },
  { rel: "sign_stop.glb", targetY: 2.35, groundY: true, centerXZ: true },
  { rel: "trashcan_metal.glb", targetY: 1.02, groundY: true, centerXZ: true },
  { rel: "trash_bin.glb", targetY: 1.08, groundY: true, centerXZ: true },
  { rel: "dumpster_bin.glb", targetY: 1.48, groundY: true, centerXZ: true },
  { rel: "ph_steel_shelves.glb", targetY: 2.14, groundY: true, centerXZ: true },
  { rel: "pit_chair.glb", targetY: 0.90, groundY: true, centerXZ: true },

  // Ground + degen cleanup (preserve real scale)
  { rel: "fuel_tank.glb", groundY: true },
  { rel: "medkit.glb", groundY: true },
  { rel: "rooftop_ac.glb", groundY: true },
  { rel: "gas_can.glb", groundY: true },
  { rel: "antenna.glb", groundY: true },
  { rel: "bush.glb", groundY: true },
  { rel: "rock.glb", groundY: true },
  { rel: "stash_bag.glb", groundY: true },
  { rel: "store_shelf.glb", groundY: true },
  { rel: "pos_terminal.glb", groundY: true },
  { rel: "int_bed.glb", groundY: true },
  { rel: "int_bookshelf.glb", groundY: true },
  { rel: "int_cabinet.glb", groundY: true },
  { rel: "int_chair.glb", groundY: true },
  { rel: "int_couch_l.glb", groundY: true },
  { rel: "int_fridge.glb", groundY: true },
  { rel: "int_lamp.glb", groundY: true },
  { rel: "int_nightstand.glb", groundY: true },
  { rel: "int_oven.glb", groundY: true },
  { rel: "int_plant.glb", groundY: true },
  { rel: "int_sink.glb", groundY: true },
  { rel: "int_table.glb", groundY: true },
  { rel: "pit_barrel.glb", groundY: true },
  { rel: "pit_crate_stack.glb", groundY: true },
  { rel: "pit_pallet.glb", groundY: true },
  { rel: "pit_stool.glb", groundY: true },
  { rel: "tree_oak.glb", groundY: true },
  { rel: "tree_palm.glb", groundY: true },
  { rel: "tree_pine.glb", groundY: true },

  // Degen cleanup only (preserve pivot/origin)
  { rel: "ph_armchair.glb", groundY: false },
  { rel: "ph_ceiling_lamp.glb", groundY: false },
  { rel: "ph_coffee_table.glb", groundY: false },
  { rel: "ph_dining_chair.glb", groundY: false },
  { rel: "ph_drawer_cabinet.glb", groundY: false },
  { rel: "ph_media_console.glb", groundY: false },
  { rel: "ph_sofa.glb", groundY: false },
  { rel: "ph_wardrobe_shelves.glb", groundY: false },
];

async function upgradeProp(spec) {
  const file = path.join(MODELS_DIR, spec.rel);
  const { scene, images } = await loadGlbViaThree(file);
  bakeSceneToMeters(scene);
  if (spec.targetY || spec.groundY || spec.centerXZ) {
    scaleAndGroundScene(scene, {
      targetY: spec.targetY ?? null,
      groundY: Boolean(spec.groundY),
      centerXZ: Boolean(spec.centerXZ),
    });
  }
  scene.traverse((o) => {
    if (!o.isMesh) return;
    o.geometry = cleanDegenerateTriangles(o.geometry, 1e-10);
  });
  finalizeGlb(file, scene, images, { keepNames: false, vp: 15 });
  console.log(`Upgraded prop ${spec.rel}`);
}

// ---------------------------------------------------------------------------
// 3. HOUSES DEGENERATE TRIANGLE CLEANUP
// ---------------------------------------------------------------------------
async function cleanHousesWithDegen() {
  const housesDir = path.join(MODELS_DIR, "houses");
  const walk = (d) => {
    const out = [];
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) out.push(...walk(p));
      else if (e.name.endsWith(".glb")) out.push(p);
    }
    return out.sort();
  };
  const vA = new THREE.Vector3(), vB = new THREE.Vector3(), vC = new THREE.Vector3();
  const ab = new THREE.Vector3(), ac = new THREE.Vector3(), cr = new THREE.Vector3();

  let fixed = 0;
  for (const file of walk(housesDir)) {
    const rel = path.relative(MODELS_DIR, file);
    if (!want(rel)) continue;
    const { scene, images } = await loadGlbViaThree(file);
    bakeSceneToMeters(scene);
    let hasDegen = false;
    scene.traverse((o) => {
      if (!o.isMesh || !o.geometry?.attributes?.position) return;
      const pos = o.geometry.getAttribute("position");
      const idx = o.geometry.getIndex();
      const cnt = idx ? idx.count : pos.count;
      for (let i = 0; i + 2 < cnt; i += 3) {
        const i0 = idx ? idx.getX(i) : i, i1 = idx ? idx.getX(i + 1) : i + 1, i2 = idx ? idx.getX(i + 2) : i + 2;
        if (i0 === i1 || i1 === i2 || i0 === i2) { hasDegen = true; break; }
        vA.fromBufferAttribute(pos, i0); vB.fromBufferAttribute(pos, i1); vC.fromBufferAttribute(pos, i2);
        ab.subVectors(vB, vA); ac.subVectors(vC, vA); cr.crossVectors(ab, ac);
        if (0.5 * cr.length() < 1e-8) { hasDegen = true; break; }
      }
    });
    if (!hasDegen) continue;
    scene.traverse((o) => {
      if (!o.isMesh) return;
      o.geometry = cleanDegenerateTriangles(o.geometry, 1e-8);
    });
    finalizeGlb(file, scene, images, { keepNames: false, vp: 15 });
    fixed++;
    console.log(`Cleaned house ${rel}`);
  }
  console.log(`Cleaned ${fixed} house GLBs.`);
}

if (want("int_tv")) await upgradeIntTv();
if (want("pit_floodlight")) await upgradePitFloodlight();
for (const spec of PROP_SPECS) {
  if (want(spec.rel)) await upgradeProp(spec);
}
await cleanHousesWithDegen();
