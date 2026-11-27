import fs from "node:fs";
import path from "node:path";
import {
  THREE,
  MODELS_DIR,
  parseRawGlb,
  packGlbChunks,
  readAccessorFloat,
  readAccessorIndices,
  loadGlbViaThree,
  cleanDegenerateTriangles,
  bakeSceneToMeters,
  serializeThreeToGlb,
  gltfpackOptimize,
  smoothSubdivideMesh,
} from "./lib/glb-utils.mjs";

const onlyArg = process.argv.find((a) => a.startsWith("--only="));
const ONLY = onlyArg ? new Set(onlyArg.slice(7).split(",")) : null;
const want = (id) => !ONLY || ONLY.has(id);

function groundAndCenter(scene, { centerXZ = true, groundY = true } = {}) {
  scene.traverse((o) => {
    if (o.isMesh && o.geometry) {
      o.geometry.computeBoundingBox();
      o.geometry.computeBoundingSphere();
    }
  });
  scene.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(scene);
  const c = box.getCenter(new THREE.Vector3());
  const dx = centerXZ ? -c.x : 0;
  const dz = centerXZ ? -c.z : 0;
  const dy = groundY ? -box.min.y : 0;
  scene.traverse((o) => {
    if (!o.isMesh) return;
    const pos = o.geometry.getAttribute("position");
    if (!pos) return;
    for (let i = 0; i < pos.count; i++) {
      pos.setXYZ(i, pos.getX(i) + dx, pos.getY(i) + dy, pos.getZ(i) + dz);
    }
    pos.needsUpdate = true;
    o.geometry.computeBoundingBox();
    o.geometry.computeBoundingSphere();
  });
}

function finalizeGlb(outPath, root, rawImages, { keepNames = false } = {}) {
  const raw = serializeThreeToGlb(root, rawImages);
  const tmp = outPath.replace(/\.glb$/, ".__tmp__.glb");
  fs.writeFileSync(tmp, raw);
  try {
    gltfpackOptimize(tmp, outPath, { keepNames });
  } finally {
    if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
  }
}

// ---------------------------------------------------------------------------
// 1. AIRLINER 737: bake scale/rot, subdivide faceted hull/engines, ground at Y=0, add nav lights
// ---------------------------------------------------------------------------
async function upgradeAirliner() {
  const file = path.join(MODELS_DIR, "airliner_737.glb");
  const { scene, images } = await loadGlbViaThree(file);
  bakeSceneToMeters(scene);
  scene.traverse((o) => {
    if (!o.isMesh) return;
    o.geometry = cleanDegenerateTriangles(o.geometry);
    smoothSubdivideMesh(o, 1, 38, 1e-4);
    o.geometry = cleanDegenerateTriangles(o.geometry);
    const m = Array.isArray(o.material) ? o.material[0] : o.material;
    if (m) {
      m.name = "livery__b737";
      m.color?.setHex(0xffffff);
      m.roughness = 0.24;
      m.metalness = 0.22;
      m.side = THREE.DoubleSide;
      m.transparent = false;
      m.opacity = 1.0;
    }
  });
  groundAndCenter(scene);
  const box = new THREE.Box3().setFromObject(scene);

  // Add subtle wingtip navigation beacons + tail anti-collision beacon
  const navRed = new THREE.Mesh(
    new THREE.SphereGeometry(0.16, 12, 8),
    new THREE.MeshStandardMaterial({ name: "nav_port_red", color: 0xff2222, emissive: 0xff2222, emissiveIntensity: 1.4, roughness: 0.15 })
  );
  navRed.name = "nav_light_port";
  navRed.position.set(box.min.x + 0.35, box.min.y + 3.05, -2.55);

  const navGreen = new THREE.Mesh(
    new THREE.SphereGeometry(0.16, 12, 8),
    new THREE.MeshStandardMaterial({ name: "nav_starboard_green", color: 0x22ff66, emissive: 0x22ff66, emissiveIntensity: 1.4, roughness: 0.15 })
  );
  navGreen.name = "nav_light_starboard";
  navGreen.position.set(box.max.x - 0.35, box.min.y + 3.05, -2.55);

  const tailStrobe = new THREE.Mesh(
    new THREE.SphereGeometry(0.14, 10, 8),
    new THREE.MeshStandardMaterial({ name: "nav_tail_white", color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 1.6, roughness: 0.1 })
  );
  tailStrobe.name = "nav_light_tail";
  tailStrobe.position.set(0, box.max.y - 0.2, box.min.z + 0.5);
  scene.add(navRed, navGreen, tailStrobe);

  finalizeGlb(file, scene, images, { keepNames: true });
  console.log("Upgraded airliner_737.glb");
}

// ---------------------------------------------------------------------------
// 2. PLANE (propeller plane): clean 4305 degen tris, fix alphaMode BLEND & emissive washout, ground at Y=0
// ---------------------------------------------------------------------------
async function upgradePlane() {
  const file = path.join(MODELS_DIR, "plane.glb");
  const { scene, images } = await loadGlbViaThree(file);
  bakeSceneToMeters(scene);
  scene.traverse((o) => {
    if (!o.isMesh) return;
    o.geometry = cleanDegenerateTriangles(o.geometry);
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    for (const m of mats) {
      if (!m) continue;
      const n = (m.name || "").toLowerCase();
      if (n.includes("glass")) {
        m.transparent = true;
        m.opacity = 0.55;
        m.roughness = 0.05;
        m.metalness = 0.15;
        m.emissive?.setHex(0x000000);
        m.emissiveIntensity = 0;
        m.side = THREE.DoubleSide;
      } else {
        // Fix original BLEND alphaMode & emissiveTexture washout on opaque hull/wings/interior
        m.transparent = false;
        m.opacity = 1.0;
        m.emissive?.setHex(0x000000);
        m.emissiveIntensity = 0;
        m.side = THREE.DoubleSide;
        if (n === "paint") {
          m.roughness = 0.22;
          m.metalness = 0.18;
        } else if (n === "spinner" || n === "prop") {
          m.roughness = 0.20;
          m.metalness = 0.80;
        } else {
          m.roughness = 0.55;
          m.metalness = 0.12;
        }
      }
    }
  });
  groundAndCenter(scene);
  finalizeGlb(file, scene, images, { keepNames: true });
  console.log("Upgraded plane.glb");
}

// ---------------------------------------------------------------------------
// 3. JET (F-16 style jet): bake mixed scales, clean degen, ground wheels at Y=0, tune canopy & metal
// ---------------------------------------------------------------------------
async function upgradeJet() {
  const file = path.join(MODELS_DIR, "jet.glb");
  const { scene, images } = await loadGlbViaThree(file);
  bakeSceneToMeters(scene);
  scene.traverse((o) => {
    if (!o.isMesh) return;
    o.geometry = cleanDegenerateTriangles(o.geometry);
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    for (const m of mats) {
      if (!m) continue;
      const n = (m.name || "").toLowerCase();
      if (n.includes("glass")) {
        m.transparent = true;
        m.opacity = 0.52;
        m.color?.setHex(0xd4a84f); // gold-tinted F-16 radar-reflective canopy
        m.roughness = 0.04;
        m.metalness = 0.25;
        m.side = THREE.DoubleSide;
      } else if (n === "paint") {
        m.transparent = false;
        m.opacity = 1.0;
        m.roughness = 0.34;
        m.metalness = 0.28;
        m.side = THREE.DoubleSide;
      } else if (n.startsWith("ins.")) {
        m.transparent = false;
        m.opacity = 1.0;
        m.roughness = 0.45;
      } else {
        m.transparent = false;
        m.opacity = 1.0;
        m.roughness = 0.42;
        m.metalness = 0.35;
      }
    }
  });
  groundAndCenter(scene);
  finalizeGlb(file, scene, images, { keepNames: true });
  console.log("Upgraded jet.glb");
}

// ---------------------------------------------------------------------------
// 4. HELI: Rebuild Sky-Watch helicopter cleanly (NO physics collider cubes/spheres!)
//    Preserves Cube004 (main rotor) and Cube002 (tail rotor) node names for LivingWorld & AirVehicleSystem!
// ---------------------------------------------------------------------------
async function upgradeHeli() {
  const file = path.join(MODELS_DIR, "heli.glb");
  const root = new THREE.Group();
  root.name = "SkyWatch_Heli";

  const matHull = new THREE.MeshStandardMaterial({ name: "paint__heli", color: 0x16243b, metalness: 0.42, roughness: 0.24 });
  const matAccent = new THREE.MeshStandardMaterial({ name: "livery__heli_stripe", color: 0xeab308, metalness: 0.25, roughness: 0.28 });
  const matWhite = new THREE.MeshStandardMaterial({ name: "livery__heli_white", color: 0xe2e8f0, metalness: 0.18, roughness: 0.28 });
  const matGlass = new THREE.MeshStandardMaterial({ name: "glass__heli", color: 0x0b1624, metalness: 0.2, roughness: 0.05, transparent: true, opacity: 0.62, side: THREE.DoubleSide });
  const matMetal = new THREE.MeshStandardMaterial({ name: "metal__heli", color: 0x262c36, metalness: 0.85, roughness: 0.26 });
  const matChrome = new THREE.MeshStandardMaterial({ name: "chrome__heli", color: 0xd0d8e0, metalness: 0.94, roughness: 0.14 });
  const matRotor = new THREE.MeshStandardMaterial({ name: "carbon__heli_rotor", color: 0x181b20, metalness: 0.3, roughness: 0.36 });
  const matRotorTip = new THREE.MeshStandardMaterial({ name: "livery__heli_tip", color: 0xfacc15, metalness: 0.15, roughness: 0.32 });
  const matInterior = new THREE.MeshStandardMaterial({ name: "trim__heli_interior", color: 0x1f242c, metalness: 0.1, roughness: 0.68 });
  const matRedGlow = new THREE.MeshStandardMaterial({ name: "beacon__heli_red", color: 0xff2222, emissive: 0xff1a1a, emissiveIntensity: 1.5, roughness: 0.15 });
  const matBlueGlow = new THREE.MeshStandardMaterial({ name: "beacon__heli_blue", color: 0x3b82f6, emissive: 0x2563eb, emissiveIntensity: 1.5, roughness: 0.15 });
  const matSearchGlow = new THREE.MeshStandardMaterial({ name: "headlight__heli_search", color: 0xf8fbff, emissive: 0xf0f7ff, emissiveIntensity: 1.4, roughness: 0.08 });

  const bodyGrp = new THREE.Group();
  bodyGrp.name = "Fuselage";

  // Smooth aerodynamic teardrop cabin (lathe-like sculpted sphere + smoothed nose + upper cowling)
  const cabinGeo = new THREE.SphereGeometry(1.0, 28, 20);
  cabinGeo.scale(0.95, 0.82, 2.05);
  // Flatten floor slightly & taper rear
  const cPos = cabinGeo.getAttribute("position");
  for (let i = 0; i < cPos.count; i++) {
    let x = cPos.getX(i), y = cPos.getY(i), z = cPos.getZ(i);
    if (y < -0.58) y = -0.58 + (y + 0.58) * 0.25;
    if (z < 0) {
      const t = Math.min(1, -z / 2.05);
      x *= 1 - t * 0.38;
      y = y * (1 - t * 0.28) + t * 0.18;
    } else {
      const t = Math.min(1, z / 2.05);
      if (y > -0.1) y *= 1 - t * 0.16;
    }
    cPos.setXYZ(i, x, y, z);
  }
  cabinGeo.computeVertexNormals();
  const cabin = new THREE.Mesh(cabinGeo, matHull);
  cabin.position.set(0, 1.32, 0.35);
  bodyGrp.add(cabin);

  // White top crown stripe & gold side livery band
  const crownGeo = new THREE.CylinderGeometry(0.46, 0.58, 2.2, 20);
  crownGeo.rotateX(Math.PI * 0.5);
  crownGeo.scale(1.0, 0.42, 1.0);
  const crown = new THREE.Mesh(crownGeo, matWhite);
  crown.position.set(0, 2.08, -0.05);
  bodyGrp.add(crown);

  const stripeGeo = new THREE.BoxGeometry(1.94, 0.16, 2.55);
  const stripe = new THREE.Mesh(stripeGeo, matAccent);
  stripe.position.set(0, 1.15, 0.2);
  bodyGrp.add(stripe);

  // Panoramic tinted cockpit windshield canopy
  const canopyGeo = new THREE.SphereGeometry(0.92, 24, 16, 0, Math.PI * 2, 0, Math.PI * 0.62);
  canopyGeo.scale(0.92, 0.78, 1.48);
  const canopy = new THREE.Mesh(canopyGeo, matGlass);
  canopy.position.set(0, 1.36, 1.24);
  canopy.rotation.x = 0.22;
  bodyGrp.add(canopy);

  // Interior pilot/copilot seats & instrument glare shield visible behind glass
  for (const sx of [-0.34, 0.34]) {
    const seat = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.65, 0.34), matInterior);
    seat.position.set(sx, 1.24, 0.92);
    seat.rotation.x = -0.12;
    bodyGrp.add(seat);
  }
  const dash = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.26, 0.45), matInterior);
  dash.position.set(0, 1.26, 1.55);
  bodyGrp.add(dash);

  // Nose FLIR / Searchlight pod
  const podMount = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.18, 0.26, 14), matMetal);
  podMount.position.set(0, 0.68, 1.95);
  const podBall = new THREE.Mesh(new THREE.SphereGeometry(0.22, 16, 12), matMetal);
  podBall.position.set(0, 0.52, 2.02);
  const podLens = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.06, 16), matSearchGlow);
  podLens.rotation.x = Math.PI * 0.5;
  podLens.position.set(0, 0.52, 2.22);
  bodyGrp.add(podMount, podBall, podLens);

  // Twin turbine intakes & brushed chrome exhausts
  const cowling = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.48, 1.65, 18), matMetal);
  cowling.rotation.x = Math.PI * 0.5;
  cowling.position.set(0, 2.18, -0.35);
  bodyGrp.add(cowling);
  for (const ex of [-0.24, 0.24]) {
    const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.11, 0.52, 14), matChrome);
    pipe.rotation.x = Math.PI * 0.5 + 0.14;
    pipe.rotation.z = ex < 0 ? 0.15 : -0.15;
    pipe.position.set(ex, 2.20, -1.25);
    bodyGrp.add(pipe);
  }

  // Tapered tail boom
  const boomGeo = new THREE.CylinderGeometry(0.15, 0.34, 4.45, 16);
  boomGeo.rotateX(Math.PI * 0.5);
  const boom = new THREE.Mesh(boomGeo, matHull);
  boom.position.set(0, 1.56, -3.55);
  bodyGrp.add(boom);

  // Horizontal stabilizer wings + endplates
  const hStab = new THREE.Mesh(new THREE.BoxGeometry(2.05, 0.07, 0.48), matAccent);
  hStab.position.set(0, 1.56, -4.75);
  bodyGrp.add(hStab);
  for (const sx of [-1.02, 1.02]) {
    const ep = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.34, 0.42), matHull);
    ep.position.set(sx, 1.60, -4.75);
    bodyGrp.add(ep);
  }

  // Swept vertical tail fin + lower tail guard skid
  const vFinGeo = new THREE.BoxGeometry(0.11, 1.38, 0.72);
  const vFin = new THREE.Mesh(vFinGeo, matHull);
  vFin.position.set(0, 2.02, -5.62);
  vFin.rotation.x = 0.28;
  const vCap = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.24, 0.68), matAccent);
  vCap.position.set(0, 2.58, -5.80);
  vCap.rotation.x = 0.28;
  const stinger = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.85, 8), matMetal);
  stinger.position.set(0, 1.15, -5.55);
  stinger.rotation.x = -0.35;
  bodyGrp.add(vFin, vCap, stinger);

  // Tubular steel landing skids (left & right + cross-tubes + boarding steps)
  for (const sx of [-0.95, 0.95]) {
    const skid = new THREE.Mesh(new THREE.CylinderGeometry(0.052, 0.052, 3.65, 12), matMetal);
    skid.rotation.x = Math.PI * 0.5;
    skid.position.set(sx, 0.055, 0.35);
    const tip = new THREE.Mesh(new THREE.CylinderGeometry(0.048, 0.052, 0.45, 10), matMetal);
    tip.rotation.x = Math.PI * 0.5 - 0.55;
    tip.position.set(sx, 0.16, 2.32);
    const step = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.03, 1.25), matChrome);
    step.position.set(sx * 1.04, 0.42, 0.75);
    bodyGrp.add(skid, tip, step);
    for (const sz of [-0.65, 1.25]) {
      const strut = new THREE.Mesh(new THREE.CylinderGeometry(0.044, 0.048, 0.96, 10), matMetal);
      strut.position.set(sx * 0.72, 0.45, sz);
      strut.rotation.z = sx > 0 ? -0.45 : 0.45;
      bodyGrp.add(strut);
    }
  }

  // Belly strobe & tail beacon
  const bellyBeacon = new THREE.Mesh(new THREE.SphereGeometry(0.09, 10, 8), matRedGlow);
  bellyBeacon.position.set(0, 0.72, -0.35);
  const topBeacon = new THREE.Mesh(new THREE.SphereGeometry(0.09, 10, 8), matBlueGlow);
  topBeacon.position.set(0, 2.74, -5.85);
  bodyGrp.add(bellyBeacon, topBeacon);
  root.add(bodyGrp);

  // Main Rotor Pivot (EXACT node name Cube004 expected by LivingWorld & AirVehicleSystem)
  const mainRotor = new THREE.Group();
  mainRotor.name = "Cube004";
  mainRotor.position.set(0, 2.68, 0.05);
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.12, 0.46, 14), matMetal);
  mast.position.y = -0.18;
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.24, 0.14, 16), matChrome);
  mainRotor.add(mast, hub);
  for (let i = 0; i < 4; i++) {
    const arm = new THREE.Group();
    arm.rotation.y = (i * Math.PI) / 2;
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.035, 3.85), matRotor);
    blade.position.set(0, 0.02, 2.12);
    const tip = new THREE.Mesh(new THREE.BoxGeometry(0.265, 0.038, 0.34), matRotorTip);
    tip.position.set(0, 0.02, 4.18);
    arm.add(blade, tip);
    mainRotor.add(arm);
  }
  root.add(mainRotor);

  // Tail Rotor Pivot (EXACT node name Cube002 expected by LivingWorld & AirVehicleSystem)
  const tailRotor = new THREE.Group();
  tailRotor.name = "Cube002";
  tailRotor.position.set(0.18, 2.15, -5.78);
  const tailHub = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.12, 12), matChrome);
  tailHub.rotation.z = Math.PI * 0.5;
  tailRotor.add(tailHub);
  for (let i = 0; i < 2; i++) {
    const tBlade = new THREE.Mesh(new THREE.BoxGeometry(0.03, 1.32, 0.14), matRotor);
    tBlade.position.set(0.04, 0, 0);
    tBlade.rotation.x = i * (Math.PI / 2);
    tailRotor.add(tBlade);
  }
  root.add(tailRotor);

  finalizeGlb(file, root, [], { keepNames: true });
  console.log("Upgraded heli.glb (clean Sky-Watch rebuild, Cube004/Cube002 preserved)");
}

// ---------------------------------------------------------------------------
// 5. CRUISER BOAT: normalize 402m -> 9.5m, fix pitch-black M_ShortSword into authentic marine PBR
// ---------------------------------------------------------------------------
async function upgradeCruiserBoat() {
  const file = path.join(MODELS_DIR, "cruiser_boat.glb");
  const { scene } = await loadGlbViaThree(file);
  bakeSceneToMeters(scene);

  // Scale to 9.5m overall length
  const preBox = new THREE.Box3().setFromObject(scene);
  const preSize = preBox.getSize(new THREE.Vector3());
  const maxHoriz = Math.max(preSize.x, preSize.z);
  const scale = 9.5 / (maxHoriz || 1);
  scene.traverse((o) => {
    if (!o.isMesh) return;
    const pos = o.geometry.getAttribute("position");
    if (pos) {
      for (let i = 0; i < pos.count; i++) {
        pos.setXYZ(i, pos.getX(i) * scale, pos.getY(i) * scale, pos.getZ(i) * scale);
      }
      pos.needsUpdate = true;
    }
    o.geometry = cleanDegenerateTriangles(o.geometry);
    o.geometry.computeVertexNormals();
  });
  groundAndCenter(scene);

  // Assign crisp marine PBR per mesh role (replacing broken M_ShortSword)
  const hullWhite = new THREE.MeshStandardMaterial({ name: "hull__cruiser_white", color: 0xeef3f8, metalness: 0.14, roughness: 0.18 });
  const engineMetal = new THREE.MeshStandardMaterial({ name: "metal__cruiser_outboard", color: 0x1e2530, metalness: 0.72, roughness: 0.28 });
  const deckTeak = new THREE.MeshStandardMaterial({ name: "wood__cruiser_teak", color: 0x8f5b34, metalness: 0.04, roughness: 0.62 });
  const ribTube = new THREE.MeshStandardMaterial({ name: "rubber__cruiser_tube", color: 0x1e293b, metalness: 0.06, roughness: 0.56 });
  const helmSeat = new THREE.MeshStandardMaterial({ name: "vinyl__cruiser_seats", color: 0xd8dee9, metalness: 0.04, roughness: 0.48 });
  const helmGlass = new THREE.MeshStandardMaterial({ name: "glass__cruiser", color: 0x0b1a2a, metalness: 0.18, roughness: 0.05, transparent: true, opacity: 0.68, side: THREE.DoubleSide });
  const stainlessRail = new THREE.MeshStandardMaterial({ name: "chrome__cruiser_rails", color: 0xdbe3ec, metalness: 0.92, roughness: 0.14 });
  const navMast = new THREE.MeshStandardMaterial({ name: "nav__cruiser_beacon", color: 0xf8fafc, emissive: 0xfef3c7, emissiveIntensity: 0.85, metalness: 0.3, roughness: 0.2 });

  const roleMats = [hullWhite, engineMetal, deckTeak, ribTube, helmSeat, helmGlass, stainlessRail, navMast];
  let idx = 0;
  scene.traverse((o) => {
    if (!o.isMesh) return;
    o.material = roleMats[idx % roleMats.length];
    idx++;
  });

  finalizeGlb(file, scene, [], { keepNames: true });
  console.log("Upgraded cruiser_boat.glb");
}

// ---------------------------------------------------------------------------
// 6. SPEEDBOAT: scale 0.23m -> 6.2m, clean 396 degen tris, ground at Y=0, polish yacht materials
// ---------------------------------------------------------------------------
async function upgradeSpeedboat() {
  const file = path.join(MODELS_DIR, "speedboat.glb");
  const { scene, images } = await loadGlbViaThree(file);
  bakeSceneToMeters(scene);

  const preBox = new THREE.Box3().setFromObject(scene);
  const preSize = preBox.getSize(new THREE.Vector3());
  const maxHoriz = Math.max(preSize.x, preSize.z);
  const scale = 6.2 / (maxHoriz || 1);

  scene.traverse((o) => {
    if (!o.isMesh) return;
    const pos = o.geometry.getAttribute("position");
    if (pos) {
      for (let i = 0; i < pos.count; i++) {
        pos.setXYZ(i, pos.getX(i) * scale, pos.getY(i) * scale, pos.getZ(i) * scale);
      }
      pos.needsUpdate = true;
    }
    o.geometry = cleanDegenerateTriangles(o.geometry);
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    for (const m of mats) {
      if (!m) continue;
      const n = (m.name || "").toLowerCase();
      if (n.includes("glass") || n === "blinn9") {
        m.transparent = true;
        m.opacity = Math.min(m.opacity ?? 0.65, 0.65);
        m.roughness = 0.06;
        m.metalness = 0.2;
        m.side = THREE.DoubleSide;
      } else if (n === "blinn1" || n === "blinn2" || n === "blinn5") {
        m.roughness = 0.16;
        m.metalness = 0.22;
      } else if (n === "phong1") {
        m.roughness = 0.14;
        m.metalness = 0.88;
      } else {
        m.roughness = Math.max(0.25, m.roughness ?? 0.45);
      }
    }
  });
  groundAndCenter(scene);
  finalizeGlb(file, scene, images, { keepNames: false });
  console.log("Upgraded speedboat.glb");
}

// ---------------------------------------------------------------------------
// 7. CRUISE SHIP: subdivide blocky 858-tri hull, add illuminated promenade windows, bridge glass & radar masts
// ---------------------------------------------------------------------------
async function upgradeCruiseShip() {
  const file = path.join(MODELS_DIR, "cruise_ship.glb");
  const { scene } = await loadGlbViaThree(file);
  bakeSceneToMeters(scene);
  scene.traverse((o) => {
    if (!o.isMesh) return;
    o.geometry = cleanDegenerateTriangles(o.geometry);
    smoothSubdivideMesh(o, 1, 36, 1e-4);
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    for (const m of mats) {
      if (!m) continue;
      const n = (m.name || "").toLowerCase();
      m.metalness = n === "black" ? 0.25 : 0.15;
      m.roughness = n === "f2f2f2" ? 0.22 : 0.36;
    }
  });
  groundAndCenter(scene);
  const box = new THREE.Box3().setFromObject(scene);
  const s = box.getSize(new THREE.Vector3());

  // Add illuminated warm cabin deck window strips + dark tinted bridge glass + radar mast
  const winGlow = new THREE.MeshStandardMaterial({
    name: "emissive__cruise_windows",
    color: 0xfef3c7,
    emissive: 0xfbbf24,
    emissiveIntensity: 0.9,
    roughness: 0.1,
  });
  const bridgeGlass = new THREE.MeshStandardMaterial({
    name: "glass__cruise_bridge",
    color: 0x0b1622,
    metalness: 0.3,
    roughness: 0.06,
  });
  const mastMetal = new THREE.MeshStandardMaterial({
    name: "chrome__cruise_mast",
    color: 0xdbe2ea,
    metalness: 0.85,
    roughness: 0.2,
  });
  const boatOrange = new THREE.MeshStandardMaterial({
    name: "livery__lifeboat",
    color: 0xea580c,
    metalness: 0.1,
    roughness: 0.35,
  });

  // Cabin window ribbons along port & starboard flanks
  for (const sx of [-s.x * 0.43, s.x * 0.43]) {
    for (const dy of [0.36, 0.50, 0.64]) {
      const strip = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.26, s.z * 0.56), winGlow);
      strip.position.set(sx, s.y * dy, -s.z * 0.04);
      scene.add(strip);
    }
    // Lifeboat davits along lower promenade
    for (let li = -2; li <= 2; li++) {
      const lbGeo = new THREE.SphereGeometry(0.24, 12, 8);
      lbGeo.scale(1.0, 0.85, 2.5);
      const lb = new THREE.Mesh(lbGeo, boatOrange);
      lb.position.set(sx * 1.03, s.y * 0.32, li * (s.z * 0.11));
      scene.add(lb);
    }
  }
  // Navigation bridge wrap-around glass
  const bridge = new THREE.Mesh(new THREE.BoxGeometry(s.x * 0.88, 0.42, 0.65), bridgeGlass);
  bridge.position.set(0, s.y * 0.74, s.z * 0.24);
  scene.add(bridge);

  // Upper radar mast + nav light
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.14, s.y * 0.22, 10), mastMetal);
  mast.position.set(0, s.y * 0.96, s.z * 0.10);
  const radarBar = new THREE.Mesh(new THREE.BoxGeometry(s.x * 0.42, 0.08, 0.16), mastMetal);
  radarBar.position.set(0, s.y * 1.05, s.z * 0.10);
  scene.add(mast, radarBar);

  finalizeGlb(file, scene, [], { keepNames: false });
  console.log("Upgraded cruise_ship.glb");
}

// ---------------------------------------------------------------------------
// 8. BIRD (Stork.glb): raw GLTF upgrade preserving ALL 13 morph targets & flap animation!
//    Fixes noNorm=1, normalizes 315m -> 2.1m wingspan, grounds minY=0, adds gull matte feather PBR
// ---------------------------------------------------------------------------
function computeSmoothNormals(posArr, indices) {
  const nArr = new Float32Array(posArr.length);
  const count = indices ? indices.length : posArr.length / 3;
  // Build spatial vertex hash so split UV seams share smooth normals too
  const map = new Map();
  const accum = new Float32Array(posArr.length);
  for (let i = 0; i < posArr.length / 3; i++) {
    const key = `${Math.round(posArr[i * 3] * 1e4)},${Math.round(posArr[i * 3 + 1] * 1e4)},${Math.round(posArr[i * 3 + 2] * 1e4)}`;
    let list = map.get(key);
    if (!list) { list = []; map.set(key, list); }
    list.push(i);
  }
  for (let t = 0; t + 2 < count; t += 3) {
    const i0 = indices ? indices[t] : t;
    const i1 = indices ? indices[t + 1] : t + 1;
    const i2 = indices ? indices[t + 2] : t + 2;
    const ax = posArr[i0 * 3], ay = posArr[i0 * 3 + 1], az = posArr[i0 * 3 + 2];
    const bx = posArr[i1 * 3], by = posArr[i1 * 3 + 1], bz = posArr[i1 * 3 + 2];
    const cx = posArr[i2 * 3], cy = posArr[i2 * 3 + 1], cz = posArr[i2 * 3 + 2];
    const ux = bx - ax, uy = by - ay, uz = bz - az;
    const vx = cx - ax, vy = cy - ay, vz = cz - az;
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    for (const vi of [i0, i1, i2]) {
      accum[vi * 3] += nx;
      accum[vi * 3 + 1] += ny;
      accum[vi * 3 + 2] += nz;
    }
  }
  for (const list of map.values()) {
    let sx = 0, sy = 0, sz = 0;
    for (const vi of list) { sx += accum[vi * 3]; sy += accum[vi * 3 + 1]; sz += accum[vi * 3 + 2]; }
    const l = Math.hypot(sx, sy, sz) || 1;
    for (const vi of list) { nArr[vi * 3] = sx / l; nArr[vi * 3 + 1] = sy / l; nArr[vi * 3 + 2] = sz / l; }
  }
  return nArr;
}

function upgradeBirdRaw() {
  const file = path.join(MODELS_DIR, "bird.glb");
  const buf = fs.readFileSync(file);
  const { json, bin } = parseRawGlb(buf);
  const prim = json.meshes[0].primitives[0];
  const basePos = readAccessorFloat(json, bin, prim.attributes.POSITION);
  const indices = prim.indices !== undefined ? readAccessorIndices(json, bin, prim.indices) : null;

  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (let i = 0; i < basePos.length; i += 3) {
    if (basePos[i] < minX) minX = basePos[i]; if (basePos[i] > maxX) maxX = basePos[i];
    if (basePos[i + 1] < minY) minY = basePos[i + 1]; if (basePos[i + 1] > maxY) maxY = basePos[i + 1];
    if (basePos[i + 2] < minZ) minZ = basePos[i + 2]; if (basePos[i + 2] > maxZ) maxZ = basePos[i + 2];
  }
  const span = Math.max(maxX - minX, maxY - minY, maxZ - minZ) || 1;
  const scale = 2.1 / span;
  const cx = (minX + maxX) * 0.5;
  const cz = (minZ + maxZ) * 0.5;

  const scaledPos = new Float32Array(basePos.length);
  for (let i = 0; i < basePos.length; i += 3) {
    scaledPos[i] = (basePos[i] - cx) * scale;
    scaledPos[i + 1] = (basePos[i + 1] - minY) * scale;
    scaledPos[i + 2] = (basePos[i + 2] - cz) * scale;
  }
  const baseNorm = computeSmoothNormals(scaledPos, indices);

  // Append scaled POSITION, NORMAL, and scaled morph target POSITIONs/NORMALs to a clean bin buffer
  const chunks = [bin];
  let binLen = bin.length;
  const pad4 = (b) => { const r = b.length % 4; return r === 0 ? b : Buffer.concat([b, Buffer.alloc(4 - r, 0)]); };
  const padStart = pad4(bin);
  if (padStart.length > bin.length) { chunks[0] = padStart; binLen = padStart.length; }

  const addVec3Accessor = (arr, withMinMax = false) => {
    const f32 = new Float32Array(arr);
    const bytes = Buffer.from(f32.buffer, f32.byteOffset, f32.byteLength);
    const bvIdx = json.bufferViews.length;
    json.bufferViews.push({ buffer: 0, byteOffset: binLen, byteLength: bytes.length, target: 34962 });
    chunks.push(pad4(bytes));
    binLen += pad4(bytes).length;
    const acc = { bufferView: bvIdx, componentType: 5126, count: f32.length / 3, type: "VEC3" };
    if (withMinMax) {
      const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
      for (let i = 0; i < f32.length; i += 3) {
        for (let k = 0; k < 3; k++) {
          if (f32[i + k] < mn[k]) mn[k] = f32[i + k];
          if (f32[i + k] > mx[k]) mx[k] = f32[i + k];
        }
      }
      acc.min = mn; acc.max = mx;
    }
    const aIdx = json.accessors.length;
    json.accessors.push(acc);
    return aIdx;
  };

  prim.attributes.POSITION = addVec3Accessor(scaledPos, true);
  prim.attributes.NORMAL = addVec3Accessor(baseNorm, false);
  if (prim.targets) {
    for (const tgt of prim.targets) {
      if (tgt.POSITION !== undefined) {
        const dp = readAccessorFloat(json, bin, tgt.POSITION);
        for (let i = 0; i < dp.length; i++) dp[i] *= scale;
        tgt.POSITION = addVec3Accessor(dp, true);
      }
      if (tgt.NORMAL !== undefined) {
        delete tgt.NORMAL;
      }
    }
  }
  json.materials = [{
    name: "gull_feathers",
    doubleSided: true,
    pbrMetallicRoughness: { baseColorFactor: [0.94, 0.95, 0.97, 1.0], metallicFactor: 0.0, roughnessFactor: 0.85 },
  }];
  prim.material = 0;
  json.buffers[0].byteLength = binLen;

  fs.writeFileSync(file, packGlbChunks(json, Buffer.concat(chunks)));
  console.log("Upgraded bird.glb (morphs preserved, smooth normals + 2.1m wingspan)");
}

// ---------------------------------------------------------------------------
// 9 & 10. DEER & DOG_HUSKY: raw GLTF upgrade preserving ALL bones/skins/animations!
//    Fixes metallicFactor: 0.4 -> 0.0 organic fur, pitch-black mats, and computes smooth normals
// ---------------------------------------------------------------------------
function upgradeSkinnedWildlife(filename, matFixer) {
  const file = path.join(MODELS_DIR, filename);
  const buf = fs.readFileSync(file);
  const { json, bin } = parseRawGlb(buf);

  const chunks = [];
  const pad4 = (b) => { const r = b.length % 4; return r === 0 ? b : Buffer.concat([b, Buffer.alloc(4 - r, 0)]); };
  const binPad = pad4(bin);
  chunks.push(binPad);
  let binLen = binPad.length;

  for (const mesh of json.meshes || []) {
    for (const prim of mesh.primitives || []) {
      const pos = readAccessorFloat(json, bin, prim.attributes.POSITION);
      const indices = prim.indices !== undefined ? readAccessorIndices(json, bin, prim.indices) : null;
      const smoothN = computeSmoothNormals(pos, indices);
      const bytes = Buffer.from(smoothN.buffer, smoothN.byteOffset, smoothN.byteLength);
      const bvIdx = json.bufferViews.length;
      json.bufferViews.push({ buffer: 0, byteOffset: binLen, byteLength: bytes.length, target: 34962 });
      const pBytes = pad4(bytes);
      chunks.push(pBytes);
      binLen += pBytes.length;
      const aIdx = json.accessors.length;
      json.accessors.push({ bufferView: bvIdx, componentType: 5126, count: smoothN.length / 3, type: "VEC3" });
      prim.attributes.NORMAL = aIdx;
    }
  }
  for (const m of json.materials || []) matFixer(m);
  json.buffers[0].byteLength = binLen;
  fs.writeFileSync(file, packGlbChunks(json, Buffer.concat(chunks)));
  console.log(`Upgraded ${filename} (skin & animations preserved, smooth organic normals + PBR fur)`);
}

function upgradeDeerRaw() {
  upgradeSkinnedWildlife("deer.glb", (m) => {
    const n = m.name || "";
    const pbr = m.pbrMetallicRoughness || (m.pbrMetallicRoughness = {});
    if (n.startsWith("Eye_")) {
      pbr.metallicFactor = 0.0;
      pbr.roughnessFactor = 0.14;
    } else if (n === "Hooves") {
      pbr.metallicFactor = 0.05;
      pbr.roughnessFactor = 0.38;
    } else {
      pbr.metallicFactor = 0.0;
      pbr.roughnessFactor = 0.86;
    }
  });
}

function upgradeHuskyRaw() {
  upgradeSkinnedWildlife("dog_husky.glb", (m) => {
    const n = m.name || "";
    const pbr = m.pbrMetallicRoughness || (m.pbrMetallicRoughness = {});
    pbr.metallicFactor = 0.0;
    if (n === "Material.002") {
      // Wet nose & eyes (was pitch black 0.005)
      pbr.baseColorFactor = [0.055, 0.055, 0.06, 1.0];
      pbr.roughnessFactor = 0.22;
    } else if (n === "Material.006") {
      // Dark markings (was near black 0.021)
      pbr.baseColorFactor = [0.075, 0.075, 0.085, 1.0];
      pbr.roughnessFactor = 0.82;
    } else {
      pbr.roughnessFactor = 0.85;
    }
  });
}

if (want("airliner_737")) await upgradeAirliner();
if (want("plane")) await upgradePlane();
if (want("jet")) await upgradeJet();
if (want("heli")) await upgradeHeli();
if (want("cruiser_boat")) await upgradeCruiserBoat();
if (want("speedboat")) await upgradeSpeedboat();
if (want("cruise_ship")) await upgradeCruiseShip();
if (want("bird")) upgradeBirdRaw();
if (want("deer")) upgradeDeerRaw();
if (want("dog_husky")) upgradeHuskyRaw();
