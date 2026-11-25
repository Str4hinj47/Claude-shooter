/* Verification for open-source house GLBs (`public/models/houses/`), HouseCatalog, and fitGlbToFootprint */

import fs from "node:fs";
import path from "node:path";
import * as THREE from "three";
import { createServer } from "vite";

const server = await createServer({
  server: { middlewareMode: true },
  appType: "custom",
});

try {
  const {
    ALL_STANDALONE_HOUSE_MODELS,
    KENNEY_SUBURBAN_YARD_PROPS,
    pickHouseModelForLot,
    pickTownhouseModel,
  } = await server.ssrLoadModule("/src/game/city/HouseCatalog.ts");
  const { fitGlbToFootprint } = await server.ssrLoadModule("/src/game/city/PropModels.ts");

  const failures = [];
  const check = (cond, msg) => {
    if (!cond) failures.push(msg);
  };

  // 1. Verify all 193 GLB files under public/models/houses/ are valid GLB v2 with zero external URIs
  const housesRoot = path.resolve("public/models/houses");
  const glbFiles = [];
  for (const sub of fs.readdirSync(housesRoot)) {
    const dir = path.join(housesRoot, sub);
    if (!fs.statSync(dir).isDirectory()) continue;
    for (const f of fs.readdirSync(dir)) {
      if (f.endsWith(".glb")) glbFiles.push(path.join(dir, f));
    }
  }
  check(glbFiles.length === 193, `Expected 193 house/building GLBs, found ${glbFiles.length}`);

  for (const full of glbFiles) {
    const buf = fs.readFileSync(full);
    const magic = buf.readUInt32LE(0);
    const version = buf.readUInt32LE(4);
    check(magic === 0x46546c67 && version === 2, `Invalid GLB v2 header in ${full}`);
    const jsonLen = buf.readUInt32LE(12);
    const gltf = JSON.parse(buf.subarray(20, 20 + jsonLen).toString("utf8"));
    for (const img of gltf.images ?? []) {
      check(!img.uri, `Unexpected external image URI "${img.uri}" in ${full}`);
    }
  }

  // 2. Verify every catalog entry points to an existing GLB
  check(ALL_STANDALONE_HOUSE_MODELS.length === 73, `Expected 73 standalone house/building entries, got ${ALL_STANDALONE_HOUSE_MODELS.length}`);
  for (const entry of ALL_STANDALONE_HOUSE_MODELS) {
    const p = path.resolve("public/models", entry.file);
    check(fs.existsSync(p), `Missing catalog house GLB: ${entry.file}`);
  }
  for (const propFile of KENNEY_SUBURBAN_YARD_PROPS) {
    const p = path.resolve("public/models", propFile);
    check(fs.existsSync(p), `Missing yard prop GLB: ${propFile}`);
  }

  // 3. Verify district pickers return diverse packs
  const packsSeen = new Set();
  for (const district of ["old_quarter", "west_coast", "foothills"]) {
    for (let s = 0; s < 40; s++) {
      const pick = pickHouseModelForLot(s, district);
      check(!!pick && fs.existsSync(path.resolve("public/models", pick.file)), `Invalid pick for ${district}:${s}`);
      packsSeen.add(pick.pack);
    }
  }
  for (let s = 0; s < 30; s++) {
    const tp = pickTownhouseModel(s);
    check(!!tp && fs.existsSync(path.resolve("public/models", tp.file)), `Invalid townhouse pick:${s}`);
    packsSeen.add(tp.pack);
  }
  check(packsSeen.size === 5, `Expected all 5 house packs used across pickers, got ${Array.from(packsSeen).join(",")}`);

  // 4. Verify fitGlbToFootprint bounds & grounding
  const dummy = new THREE.Group();
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(4, 3, 2));
  mesh.position.set(1.5, 2.0, -0.5);
  dummy.add(mesh);
  const fitted = fitGlbToFootprint(dummy, 12, 10, 6, 1.25, Math.PI);
  fitted.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(fitted);
  const size = new THREE.Vector3();
  const center = new THREE.Vector3();
  box.getSize(size);
  box.getCenter(center);
  check(size.x <= 12.01 && size.z <= 10.01 && size.y <= 6.01, `Fitted size exceeded bounds: ${size.toArray()}`);
  check(Math.abs(box.min.y - 1.25) < 1e-3, `Expected min.y=1.25, got ${box.min.y}`);
  check(Math.abs(center.x) < 1e-3 && Math.abs(center.z) < 1e-3, `Expected centered XZ, got (${center.x}, ${center.z})`);

  if (failures.length > 0) {
    console.error("House models test failures:");
    failures.forEach((f) => console.error(" ✘", f));
    process.exit(1);
  }

  console.log(`✔ House models test passed: ${glbFiles.length} self-contained GLBs across 5 open-source packs verified`);
} finally {
  await server.close();
}
