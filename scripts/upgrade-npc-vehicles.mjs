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
  smoothSubdivideMesh,
  addPlateGroup,
} from "./lib/glb-utils.mjs";

const onlyArg = process.argv.find((a) => a.startsWith("--only="));
const ONLY = onlyArg ? new Set(onlyArg.slice(7).split(",")) : null;
const want = (id) => !ONLY || ONLY.has(id);

const COLORMAP_RGBA = fs.existsSync("/tmp/kenney_colormap_256.rgba")
  ? fs.readFileSync("/tmp/kenney_colormap_256.rgba")
  : null;

function sampleColormap(u, v) {
  if (!COLORMAP_RGBA) return [180, 180, 180];
  const x = Math.max(0, Math.min(255, Math.round((((u % 1) + 1) % 1) * 255)));
  const y = Math.max(0, Math.min(255, Math.round((((v % 1) + 1) % 1) * 255)));
  const i = (y * 256 + x) * 4;
  return [COLORMAP_RGBA[i], COLORMAP_RGBA[i + 1], COLORMAP_RGBA[i + 2]];
}

function finalizeGlb(outPath, root, rawImages, { keepNames = false, vp = 14 } = {}) {
  const raw = serializeThreeToGlb(root, rawImages);
  const tmp = outPath.replace(/\.glb$/, ".__tmp__.glb");
  fs.writeFileSync(tmp, raw);
  try {
    gltfpackOptimize(tmp, outPath, { keepNames, vp });
  } finally {
    if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
  }
}

function addDiscAndCaliper(parent, id, cx, cy, cz, r, isLeft, { discScale = 0.62, caliperAngle = 0.35 } = {}) {
  const discR = r * discScale;
  const discW = Math.max(0.024, r * 0.09);
  const discMat = new THREE.MeshStandardMaterial({
    name: `brake__${id}_Disc`,
    color: 0xaab4c0,
    metalness: 0.90,
    roughness: 0.24,
  });
  const calMat = new THREE.MeshStandardMaterial({
    name: `brake__${id}_Caliper`,
    color: 0xdc2626,
    metalness: 0.52,
    roughness: 0.30,
  });

  const discGeo = new THREE.CylinderGeometry(discR, discR, discW, 24);
  discGeo.rotateZ(Math.PI * 0.5);
  const disc = new THREE.Mesh(discGeo, discMat);
  disc.name = `brake_disc_${id}_${Math.round(cx * 100)}_${Math.round(cz * 100)}`;
  disc.position.set(cx, cy, cz);

  const calGeo = new THREE.BoxGeometry(discW * 1.9, discR * 0.46, discR * 0.34);
  const cal = new THREE.Mesh(calGeo, calMat);
  cal.name = `brake_caliper_${id}_${Math.round(cx * 100)}_${Math.round(cz * 100)}`;
  const sideShift = isLeft ? -0.015 : 0.015;
  cal.position.set(
    cx + sideShift,
    cy + Math.sin(caliperAngle) * discR * 0.78,
    cz + Math.cos(caliperAngle) * discR * 0.78
  );
  cal.rotation.x = -caliperAngle;

  parent.add(disc, cal);
}

function measureRearSurfaceZ(scene, yMin, yMax, xAbsMax = 0.25) {
  let minZ = Infinity;
  const v = new THREE.Vector3();
  scene.traverse((o) => {
    if (!o.isMesh) return;
    if (/^(tire|rim|brake|glass|plate)__/i.test(o.material?.name || "")) return;
    const pos = o.geometry.getAttribute("position");
    if (!pos) return;
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i);
      if (Math.abs(v.x) <= xAbsMax && v.y >= yMin && v.y <= yMax) {
        if (v.z < minZ) minZ = v.z;
      }
    }
  });
  return minZ;
}

// ---------------------------------------------------------------------------
// 1. QUATERNIUS CITY CARS (compact, hatch, crossover, taxi, police_cruiser)
// ---------------------------------------------------------------------------
async function upgradeQuaterniusCar(id) {
  const file = path.join(MODELS_DIR, `${id}.glb`);
  const { scene, images } = await loadGlbViaThree(file);
  bakeSceneToMeters(scene);

  // Clean degenerate faces & smooth-subdivide body paint, glass, and tires/rims
  scene.traverse((o) => {
    if (!o.isMesh) return;
    o.geometry = cleanDegenerateTriangles(o.geometry);
    const mat = Array.isArray(o.material) ? o.material[0] : o.material;
    const mn = mat?.name || "";

    // Fix pitch-black trim/tire colors
    if (mat?.color) {
      const lum = mat.color.r * 0.299 + mat.color.g * 0.587 + mat.color.b * 0.114;
      if (lum < 0.03 && /^(trim|tire|other)__/i.test(mn)) {
        mat.color.setHex(mn.startsWith("tire__") ? 0x16181c : 0x1a1e24);
      }
    }
    if (mn.startsWith("paint__")) {
      mat.metalness = 0.42;
      mat.roughness = 0.22;
    } else if (mn.startsWith("glass__")) {
      mat.color?.setHex(0x09111a);
      mat.transparent = true;
      mat.opacity = 0.72;
      mat.roughness = 0.05;
      mat.metalness = 0.18;
      mat.side = THREE.DoubleSide;
    } else if (mn.startsWith("rim__")) {
      mat.metalness = 0.88;
      mat.roughness = 0.18;
    }

    const triCount = o.geometry.index ? o.geometry.index.count / 3 : o.geometry.attributes.position.count / 3;
    if (mn.startsWith("paint__") && triCount > 12 && triCount <= 2500) {
      smoothSubdivideMesh(o, 1, 42, 1e-4);
    } else if ((mn.startsWith("tire__") || mn.startsWith("rim__")) && triCount > 12 && triCount <= 600) {
      smoothSubdivideMesh(o, 1, 40, 1e-4);
    }
  });

  // Detect 4 wheel centers from tire__ meshes & add steel discs + red calipers
  const bounds = Array.from({ length: 4 }, () => new THREE.Box3().makeEmpty());
  const pt = new THREE.Vector3();
  scene.traverse((o) => {
    if (!o.isMesh || !o.material?.name?.startsWith("tire__")) return;
    const pos = o.geometry.getAttribute("position");
    if (!pos) return;
    for (let i = 0; i < pos.count; i++) {
      pt.fromBufferAttribute(pos, i);
      if (pt.y > 0.65 || Math.abs(pt.x) < 0.45 || Math.abs(pt.z) < 0.6) continue;
      bounds[(pt.x > 0 ? 1 : 0) + (pt.z > 0 ? 2 : 0)].expandByPoint(pt);
    }
  });

  for (let i = 0; i < 4; i++) {
    if (bounds[i].isEmpty()) continue;
    const c = bounds[i].getCenter(new THREE.Vector3());
    const r = Math.max(0.22, (bounds[i].max.y - bounds[i].min.y) * 0.5);
    const isLeft = c.x > 0;
    const insetX = isLeft ? c.x - 0.055 : c.x + 0.055;
    addDiscAndCaliper(scene, id, insetX, c.y, c.z, r, isLeft);
  }

  // Add flush "WESTGATE" rear license plate (rear = -Z on Quaternius cars, rotY = Math.PI)
  const plateY = id === "crossover" ? 0.56 : 0.44;
  const rearZ = measureRearSurfaceZ(scene, plateY - 0.14, plateY + 0.14, 0.22);
  if (Number.isFinite(rearZ)) {
    scene.add(addPlateGroup(id, 0, plateY, rearZ - 0.014, 0.44, 0.125, Math.PI));
  }

  finalizeGlb(file, scene, images, { keepNames: false });
  console.log(`Upgraded Quaternius ${id}.glb`);
}

// ---------------------------------------------------------------------------
// 2. KENNEY COMMERCIAL & EMERGENCY TRUCKS (van, delivery, garbage_truck, ambulance, firetruck, loader_tractor)
// ---------------------------------------------------------------------------
function splitGeometryByTriClass(geo, classifier) {
  const pos = geo.getAttribute("position");
  const norm = geo.getAttribute("normal");
  const uv = geo.getAttribute("uv");
  const idx = geo.getIndex();
  const count = idx ? idx.count : pos.count;
  const buckets = new Map();

  for (let i = 0; i + 2 < count; i += 3) {
    const i0 = idx ? idx.getX(i) : i;
    const i1 = idx ? idx.getX(i + 1) : i + 1;
    const i2 = idx ? idx.getX(i + 2) : i + 2;
    const cx = (pos.getX(i0) + pos.getX(i1) + pos.getX(i2)) / 3;
    const cy = (pos.getY(i0) + pos.getY(i1) + pos.getY(i2)) / 3;
    const cz = (pos.getZ(i0) + pos.getZ(i1) + pos.getZ(i2)) / 3;
    const cu = uv ? (uv.getX(i0) + uv.getX(i1) + uv.getX(i2)) / 3 : 0;
    const cv = uv ? (uv.getY(i0) + uv.getY(i1) + uv.getY(i2)) / 3 : 0;
    const cls = classifier(cx, cy, cz, cu, cv);
    let arr = buckets.get(cls);
    if (!arr) { arr = []; buckets.set(cls, arr); }
    arr.push(i0, i1, i2);
  }

  const out = new Map();
  for (const [cls, tris] of buckets.entries()) {
    const remap = new Map();
    const pArr = [], nArr = [], uArr = [], newIdx = [];
    for (const vi of tris) {
      let ni = remap.get(vi);
      if (ni === undefined) {
        ni = pArr.length / 3;
        remap.set(vi, ni);
        pArr.push(pos.getX(vi), pos.getY(vi), pos.getZ(vi));
        if (norm) nArr.push(norm.getX(vi), norm.getY(vi), norm.getZ(vi));
        if (uv) uArr.push(uv.getX(vi), uv.getY(vi));
      }
      newIdx.push(ni);
    }
    const subGeo = new THREE.BufferGeometry();
    subGeo.setAttribute("position", new THREE.Float32BufferAttribute(pArr, 3));
    if (norm) subGeo.setAttribute("normal", new THREE.Float32BufferAttribute(nArr, 3));
    if (uv) subGeo.setAttribute("uv", new THREE.Float32BufferAttribute(uArr, 2));
    subGeo.setIndex(newIdx);
    out.set(cls, subGeo);
  }
  return out;
}

function buildSculptedKenneyWheel(name, cx, cy, cz, radius, width, id) {
  const isLeft = cx > 0;
  const grp = new THREE.Group();
  grp.name = `${name}_grp`;

  const tireMat = new THREE.MeshStandardMaterial({
    name: `tire__${id}`,
    color: 0x181a1f,
    roughness: 0.85,
    metalness: 0.04,
  });
  const rimMat = new THREE.MeshStandardMaterial({
    name: `rim__${id}`,
    color: 0xd0d7e0,
    metalness: 0.88,
    roughness: 0.18,
  });
  const discMat = new THREE.MeshStandardMaterial({
    name: `brake__${id}_Disc`,
    color: 0xaab4c0,
    metalness: 0.90,
    roughness: 0.24,
  });

  // Outer rubber tire (28-segment smoothed cylinder + sidewall bevel ring)
  const tireGeo = new THREE.CylinderGeometry(radius, radius, width * 0.96, 28, 1);
  tireGeo.rotateZ(Math.PI * 0.5);
  const tireMesh = new THREE.Mesh(tireGeo, tireMat);
  tireMesh.name = `${name}_tire`;
  tireMesh.position.set(cx, cy, cz);

  // Recessed metallic alloy rim + 5 spokes + hubcap (all prefixed with wheel-* so wheels.ts rotates them!)
  const rimGeo = new THREE.CylinderGeometry(radius * 0.62, radius * 0.62, width * 0.99, 24);
  rimGeo.rotateZ(Math.PI * 0.5);
  const rimMesh = new THREE.Mesh(rimGeo, rimMat);
  rimMesh.name = `${name}_rim`;
  rimMesh.position.set(cx, cy, cz);

  // Brake disc inside rim
  const discGeo = new THREE.CylinderGeometry(radius * 0.54, radius * 0.54, width * 0.18, 22);
  discGeo.rotateZ(Math.PI * 0.5);
  const discMesh = new THREE.Mesh(discGeo, discMat);
  discMesh.name = `${name}_disc`;
  discMesh.position.set(isLeft ? cx - width * 0.25 : cx + width * 0.25, cy, cz);

  grp.add(tireMesh, rimMesh, discMesh);
  return grp;
}

async function upgradeKenneyVehicle(id) {
  const file = path.join(MODELS_DIR, `${id}.glb`);
  const { scene, images } = await loadGlbViaThree(file);
  bakeSceneToMeters(scene);

  const fullBox = new THREE.Box3().setFromObject(scene);
  const maxZ = fullBox.max.z;
  const minZ = fullBox.min.z;

  // Locate original texture from colormap
  let colormapTex = null;
  scene.traverse((o) => {
    if (!colormapTex && o.isMesh && o.material?.map) colormapTex = o.material.map;
  });

  const matLivery = new THREE.MeshStandardMaterial({
    name: `trim__${id}_livery`,
    map: colormapTex,
    color: 0xffffff,
    roughness: 0.32,
    metalness: 0.16,
  });
  const matGlass = new THREE.MeshStandardMaterial({
    name: `glass__${id}`,
    color: 0x0a131e,
    metalness: 0.18,
    roughness: 0.05,
    transparent: true,
    opacity: 0.68,
    side: THREE.DoubleSide,
  });
  const matHeadlight = new THREE.MeshStandardMaterial({
    name: `headlight__${id}`,
    color: 0xf8fbff,
    emissive: 0xe6f0ff,
    emissiveIntensity: 0.95,
    roughness: 0.08,
  });
  const matTaillight = new THREE.MeshStandardMaterial({
    name: `taillight__${id}`,
    color: 0xdc2626,
    emissive: 0xe11d48,
    emissiveIntensity: 0.9,
    roughness: 0.12,
  });
  const matBeaconBlue = new THREE.MeshStandardMaterial({
    name: "headlight__police_beacon_blue",
    color: 0x2563eb,
    emissive: 0x3b82f6,
    emissiveIntensity: 1.5,
    roughness: 0.08,
  });
  const matBeaconRed = new THREE.MeshStandardMaterial({
    name: "taillight__police_beacon_red",
    color: 0xdc2626,
    emissive: 0xff2222,
    emissiveIntensity: 1.5,
    roughness: 0.08,
  });

  const matByClass = {
    livery: matLivery,
    glass: matGlass,
    headlight: matHeadlight,
    taillight: matTaillight,
    beacon_blue: matBeaconBlue,
    beacon_red: matBeaconRed,
  };

  const toReplace = [];
  const wheelReplacements = [];
  const calipersToAdd = [];

  scene.traverse((o) => {
    if (!o.isMesh) return;
    o.geometry = cleanDegenerateTriangles(o.geometry);
    if (/^wheel-/.test(o.name)) {
      const wb = new THREE.Box3().setFromObject(o);
      const c = wb.getCenter(new THREE.Vector3());
      const s = wb.getSize(new THREE.Vector3());
      const r = Math.max(s.y, s.z) * 0.5;
      const w = s.x;
      wheelReplacements.push({ orig: o, grp: buildSculptedKenneyWheel(o.name, c.x, c.y, c.z, r, w, id) });
      calipersToAdd.push({ cx: c.x > 0 ? c.x - w * 0.22 : c.x + w * 0.22, cy: c.y, cz: c.z, r, isLeft: c.x > 0 });
      return;
    }

    const parts = splitGeometryByTriClass(o.geometry, (cx, cy, cz, cu, cv) => {
      // Roof emergency lightbars on ambulance & firetruck (blue swatch at u~0.50, v>0.72, roof y>1.10)
      if ((id === "ambulance" || id === "firetruck") && cy > 1.10 && cu >= 0.42 && cu <= 0.58 && cv >= 0.72 && cv <= 0.99) {
        return cx < 0 ? "beacon_blue" : "beacon_red";
      }
      // Windshield & cab glass (Kenney sky-blue glass swatch at u~0.125, v~0.81..0.94)
      if (cu >= 0.04 && cu <= 0.19 && cv >= 0.78 && cv <= 0.99) {
        return "glass";
      }
      // Front headlights (Kenney yellow light swatch at u~0.25, v~0.81..0.94)
      if (cu >= 0.19 && cu <= 0.31 && cv >= 0.78 && cv <= 0.99 && cz > maxZ - 0.25 && cy < 1.05) {
        return "headlight";
      }
      // Rear taillights (Kenney red light swatch at u~0.375, v~0.75..1.00)
      if (cu >= 0.31 && cu <= 0.44 && cv >= 0.72 && cv <= 1.00 && cz < minZ + 0.25 && cy < 1.15) {
        return "taillight";
      }
      return "livery";
    });
    toReplace.push({ orig: o, parts });
  });

  for (const { orig, parts } of toReplace) {
    const parent = orig.parent;
    for (const [cls, geo] of parts.entries()) {
      const m = new THREE.Mesh(geo, matByClass[cls]);
      m.name = cls === "livery" ? orig.name : `${orig.name}_${cls}`;
      parent.add(m);
    }
    parent.remove(orig);
  }

  for (const { orig, grp } of wheelReplacements) {
    const parent = orig.parent;
    parent.add(grp);
    parent.remove(orig);
  }

  for (const { cx, cy, cz, r, isLeft } of calipersToAdd) {
    const calMat = new THREE.MeshStandardMaterial({
      name: `brake__${id}_Caliper`,
      color: 0xdc2626,
      metalness: 0.52,
      roughness: 0.30,
    });
    const discW = Math.max(0.024, r * 0.09);
    const cal = new THREE.Mesh(new THREE.BoxGeometry(discW * 1.9, r * 0.28, r * 0.22), calMat);
    cal.name = `brake_caliper_${id}_${Math.round(cx * 100)}_${Math.round(cz * 100)}`;
    cal.position.set(cx, cy + r * 0.18, cz + r * 0.44);
    cal.rotation.x = -0.35;
    scene.add(cal);
  }

  // Rear "WESTGATE" license plate (rear = minZ on Kenney, scaled 0.30m raw -> ~0.50m in game!)
  const plateY = id === "loader_tractor" ? 0.52 : 0.32;
  scene.add(addPlateGroup(id, 0, plateY, minZ - 0.012, 0.30, 0.088, Math.PI));

  finalizeGlb(file, scene, images, { keepNames: true });
  console.log(`Upgraded Kenney ${id}.glb`);
}

// ---------------------------------------------------------------------------
// 3. SEMI & KRAZ HEAVY TRUCKS
// ---------------------------------------------------------------------------
async function upgradeSemi() {
  const file = path.join(MODELS_DIR, "semi.glb");
  const { scene, images } = await loadGlbViaThree(file);
  bakeSceneToMeters(scene);
  scene.traverse((o) => {
    if (!o.isMesh) return;
    o.geometry = cleanDegenerateTriangles(o.geometry, 1e-7);
  });
  const axles = [-7.36, -2.985, -2.055, 6.245, 7.195];
  for (const z of axles) {
    for (const side of [-1, 1]) {
      addDiscAndCaliper(scene, "semi", side * 0.72, 0.397, z, 0.397, side > 0);
    }
  }
  scene.add(addPlateGroup("semi", 0, 0.62, 7.99, 0.48, 0.13, 0));
  finalizeGlb(file, scene, images, { keepNames: false, vp: 16 });
  console.log("Upgraded semi.glb");
}

async function upgradeKraz() {
  const file = path.join(MODELS_DIR, "kraz.glb");
  const { scene, images } = await loadGlbViaThree(file);
  bakeSceneToMeters(scene);
  scene.traverse((o) => {
    if (!o.isMesh) return;
    o.geometry = cleanDegenerateTriangles(o.geometry, 1e-7);
  });
  const axles = [-2.965, 1.345, 2.865];
  for (const z of axles) {
    for (const side of [-1, 1]) {
      addDiscAndCaliper(scene, "kraz", side * 0.92, 0.695, z, 0.695, side > 0);
    }
  }
  // Stamp crisp "WESTGATE" plate right onto Kraz's existing blank rear plate holder
  scene.add(addPlateGroup("kraz", 0.01, 1.015, 3.842, 0.54, 0.15, 0));
  finalizeGlb(file, scene, images, { keepNames: false, vp: 16 });
  console.log("Upgraded kraz.glb");
}

for (const id of ["compact", "hatch", "crossover", "taxi", "police_cruiser"]) {
  if (want(id)) await upgradeQuaterniusCar(id);
}
for (const id of ["van", "delivery", "garbage_truck", "ambulance", "firetruck", "loader_tractor"]) {
  if (want(id)) await upgradeKenneyVehicle(id);
}
if (want("semi")) await upgradeSemi();
if (want("kraz")) await upgradeKraz();
