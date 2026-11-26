import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const ROOT = process.cwd();
const GLTFPACK_BIN = path.resolve(
  ROOT,
  process.platform === "win32" ? "node_modules/.bin/gltfpack.cmd" : "node_modules/.bin/gltfpack",
);

if (!fs.existsSync(GLTFPACK_BIN)) {
  console.error("gltfpack binary not found at", GLTFPACK_BIN);
  process.exit(1);
}

function collectGlbs(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) collectGlbs(full, out);
    else if (ent.name.endsWith(".glb")) out.push(full);
  }
  return out;
}

const files = [
  ...collectGlbs(path.join(ROOT, "public/models")),
  ...collectGlbs(path.join(ROOT, "public/characters")),
];

let optimized = 0;
let skipped = 0;
let beforeBytes = 0;
let afterBytes = 0;

for (const file of files) {
  const origBuf = fs.readFileSync(file);
  const magic = origBuf.readUInt32LE(0);
  const version = origBuf.readUInt32LE(4);
  if (magic !== 0x46546c67 || version !== 2) {
    skipped++;
    continue;
  }
  const jlen = origBuf.readUInt32LE(12);
  const gltf = JSON.parse(origBuf.subarray(20, 20 + jlen).toString("utf8"));
  const exts = new Set([...(gltf.extensionsUsed ?? []), ...(gltf.extensionsRequired ?? [])]);
  if (exts.has("EXT_meshopt_compression") || exts.has("KHR_draco_mesh_compression")) {
    skipped++;
    continue;
  }

  const tmp = path.join(os.tmpdir(), `gltfpack_${process.pid}_${optimized}.glb`);
  try {
    // -c: meshopt compression + high-precision quantization (-vp 16 -vt 16 -vn 12), -kn/-km/-ke: preserve named nodes, materials, extras
    execFileSync(GLTFPACK_BIN, ["-i", file, "-o", tmp, "-c", "-vp", "16", "-vt", "16", "-vn", "12", "-kn", "-km", "-ke"], { stdio: "pipe" });
    const newBuf = fs.readFileSync(tmp);
    const nMagic = newBuf.readUInt32LE(0);
    const nVer = newBuf.readUInt32LE(4);
    if (nMagic !== 0x46546c67 || nVer !== 2) {
      throw new Error(`Invalid GLB v2 output for ${file}`);
    }
    const njlen = newBuf.readUInt32LE(12);
    const ngltf = JSON.parse(newBuf.subarray(20, 20 + njlen).toString("utf8"));
    for (const img of ngltf.images ?? []) {
      if (img.uri) throw new Error(`External image URI emitted for ${file}: ${img.uri}`);
    }
    if (newBuf.length < origBuf.length) {
      fs.writeFileSync(file, newBuf);
      beforeBytes += origBuf.length;
      afterBytes += newBuf.length;
      optimized++;
    } else {
      skipped++;
    }
  } finally {
    if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
  }
}

const savedMB = ((beforeBytes - afterBytes) / 1048576).toFixed(2);
const pct = beforeBytes > 0 ? Math.round((1 - afterBytes / beforeBytes) * 100) : 0;
console.log(
  `meshoptimizer (gltfpack): optimized ${optimized} GLBs, skipped ${skipped} | ${(beforeBytes / 1048576).toFixed(2)} MB -> ${(afterBytes / 1048576).toFixed(2)} MB (saved ${savedMB} MB / ${pct}%)`,
);
