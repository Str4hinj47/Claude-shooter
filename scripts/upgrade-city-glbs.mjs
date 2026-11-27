import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

globalThis.self = globalThis;
globalThis.createImageBitmap = async () => ({ width: 1, height: 1, close() {} });
if (!globalThis.FileReader) {
  globalThis.FileReader = class {
    readAsArrayBuffer(blob) {
      blob.arrayBuffer().then((buf) => {
        this.result = buf;
        this.onloadend?.();
      });
    }
    readAsDataURL(blob) {
      blob.arrayBuffer().then((buf) => {
        const b64 = Buffer.from(buf).toString("base64");
        this.result = `data:${blob.type || "application/octet-stream"};base64,${b64}`;
        this.onloadend?.();
      });
    }
  };
}

const THREE = await import("three");
const { GLTFLoader } = await import("three/examples/jsm/loaders/GLTFLoader.js");
const { GLTFExporter } = await import("three/examples/jsm/exporters/GLTFExporter.js");
const { MeshoptDecoder } = await import("three/examples/jsm/libs/meshopt_decoder.module.js");
const { toCreasedNormals } = await import("three/examples/jsm/utils/BufferGeometryUtils.js");

const MODELS_DIR = path.resolve("public/models");
const GLTFPACK_BIN = path.resolve("node_modules/.bin/gltfpack");

function deinterleaveGeometry(geo) {
  const out = new THREE.BufferGeometry();
  for (const [k, attr] of Object.entries(geo.attributes)) {
    const itemSize = attr.itemSize;
    const arr = new Float32Array(attr.count * itemSize);
    for (let i = 0; i < attr.count; i++) {
      arr[i * itemSize] = attr.getX(i);
      if (itemSize > 1) arr[i * itemSize + 1] = attr.getY(i);
      if (itemSize > 2) arr[i * itemSize + 2] = attr.getZ(i);
      if (itemSize > 3) arr[i * itemSize + 3] = attr.getW(i);
    }
    out.setAttribute(k, new THREE.Float32BufferAttribute(arr, itemSize));
  }
  if (geo.index) {
    const idxArr = new Uint32Array(geo.index.count);
    for (let i = 0; i < geo.index.count; i++) idxArr[i] = geo.index.getX(i);
    out.setIndex(new THREE.BufferAttribute(idxArr, 1));
  }
  return out;
}

function cloneWithIndices(srcGeo, triIndices) {
  const pos = srcGeo.getAttribute("position");
  const norm = srcGeo.getAttribute("normal");
  const uv = srcGeo.getAttribute("uv");
  const srcIdx = srcGeo.getIndex();
  const remap = new Map();
  const newIdx = [];
  const pArr = [], nArr = [], uvArr = [];
  for (const viRaw of triIndices) {
    const vi = srcIdx ? srcIdx.getX(viRaw) : viRaw;
    let ni = remap.get(vi);
    if (ni === undefined) {
      ni = pArr.length / 3;
      remap.set(vi, ni);
      pArr.push(pos.getX(vi), pos.getY(vi), pos.getZ(vi));
      if (norm) nArr.push(norm.getX(vi), norm.getY(vi), norm.getZ(vi));
      if (uv) uvArr.push(uv.getX(vi), uv.getY(vi));
    }
    newIdx.push(ni);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pArr, 3));
  if (nArr.length) g.setAttribute("normal", new THREE.Float32BufferAttribute(nArr, 3));
  if (uvArr.length) g.setAttribute("uv", new THREE.Float32BufferAttribute(uvArr, 2));
  g.setIndex(newIdx);
  return g;
}

function finalizeGeometry(geo) {
  const clean = deinterleaveGeometry(geo);
  try {
    return toCreasedNormals(clean, (44 * Math.PI) / 180);
  } catch {
    clean.computeVertexNormals();
    return clean;
  }
}

async function loadRawGlb(filePath) {
  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);
  const buf = fs.readFileSync(filePath);
  const gltf = await loader.parseAsync(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), "");
  gltf.scene.updateMatrixWorld(true);
  gltf.scene.traverse((o) => {
    if (o.isMesh) {
      o.geometry = deinterleaveGeometry(o.geometry);
    }
  });
  return gltf.scene;
}

async function exportAndPack(scene, outPath) {
  const exporter = new GLTFExporter();
  const glbBuf = await new Promise((resolve, reject) => {
    exporter.parse(scene, (res) => resolve(Buffer.from(res)), reject, { binary: true });
  });
  const tmpRaw = outPath + ".raw.glb";
  fs.writeFileSync(tmpRaw, glbBuf);
  try {
    execFileSync(GLTFPACK_BIN, ["-i", tmpRaw, "-o", outPath, "-cc", "-kn", "-km", "-vp", "16"], { stdio: "pipe" });
  } finally {
    if (fs.existsSync(tmpRaw)) fs.unlinkSync(tmpRaw);
  }
}

const CITY_SPECS = [
  { id: "compact", paintName: "Blue", paintHex: 0x2563eb },
  { id: "hatch", paintName: "LightBlue", paintHex: 0x38bdf8 },
  { id: "crossover", paintName: "White", paintHex: 0xe2e8f0 },
  { id: "taxi", paintName: "Yellow", paintHex: 0xf5b700 },
  { id: "police_cruiser", paintName: "White", paintHex: 0xf1f5f9 },
];

for (const spec of CITY_SPECS) {
  const filePath = path.join(MODELS_DIR, `${spec.id}.glb`);
  const raw = await loadRawGlb(filePath);

  // Bake world transforms into vertices so grounding & wheel splitting are exact
  const baked = new THREE.Group();
  baked.name = spec.id;
  raw.updateMatrixWorld(true);
  const meshes = [];
  raw.traverse((o) => {
    if (o.isMesh) meshes.push(o);
  });

  for (const m of meshes) {
    const g = m.geometry.clone();
    g.applyMatrix4(m.matrixWorld);
    m.geometry = g;
    m.position.set(0, 0, 0);
    m.rotation.set(0, 0, 0);
    m.scale.set(1, 1, 1);
    m.updateMatrix();
  }

  // Ground minY to 0.000
  const worldBox = new THREE.Box3();
  for (const m of meshes) {
    m.geometry.computeBoundingBox();
    worldBox.union(m.geometry.boundingBox);
  }
  const shiftY = -worldBox.min.y;
  for (const m of meshes) {
    m.geometry.translate(0, shiftY, 0);
    m.geometry.computeBoundingBox();
  }

  // Detect exact 4 circular wheel hubs/rims from Grey mesh
  const rimBounds = [new THREE.Box3(), new THREE.Box3(), new THREE.Box3(), new THREE.Box3()];
  const greyMesh = meshes.find((m) => m.name === "Grey");
  if (greyMesh) {
    const pos = greyMesh.geometry.getAttribute("position");
    const idx = greyMesh.geometry.getIndex();
    const count = idx ? idx.count : pos.count;
    for (let i = 0; i < count; i++) {
      const vi = idx ? idx.getX(i) : i;
      const x = pos.getX(vi), y = pos.getY(vi), z = pos.getZ(vi);
      if (y < 0.56 && Math.abs(x) > 0.58 && Math.abs(z) > 0.70) {
        rimBounds[(x > 0 ? 1 : 0) + (z > 0 ? 2 : 0)].expandByPoint(new THREE.Vector3(x, y, z));
      }
    }
  }
  const wheelCenters = rimBounds.map((b) => {
    const c = b.getCenter(new THREE.Vector3());
    const s = b.getSize(new THREE.Vector3());
    const rRim = Math.max(0.14, Math.max(s.y, s.z) * 0.5);
    return { c, rRim, rTire: Math.max(rRim * 1.56, c.y + 0.015) };
  });

  // Materials
  const paintMat = new THREE.MeshStandardMaterial({
    name: spec.id === "police_cruiser" ? "trim__police_cruiser_livery" : `paint__${spec.id}`,
    color: spec.paintHex,
    metalness: spec.id === "police_cruiser" ? 0.16 : 0.32,
    roughness: spec.id === "police_cruiser" ? 0.35 : 0.20,
  });
  const glassMat = new THREE.MeshStandardMaterial({
    name: `glass__${spec.id}`,
    color: 0x0b121c,
    metalness: 0.18,
    roughness: 0.06,
    transparent: true,
    opacity: 0.76,
  });
  const headMat = new THREE.MeshStandardMaterial({
    name: `headlight__${spec.id}`,
    color: 0xf4f8ff,
    emissive: 0xeef6ff,
    emissiveIntensity: 0.8,
    roughness: 0.12,
  });
  const tailMat = new THREE.MeshStandardMaterial({
    name: `taillight__${spec.id}`,
    color: 0xcc1418,
    emissive: 0xff2222,
    emissiveIntensity: 0.8,
    roughness: 0.14,
  });
  const tireMat = new THREE.MeshStandardMaterial({
    name: `tire__${spec.id}`,
    color: 0x16181d,
    metalness: 0.02,
    roughness: 0.86,
  });
  const rimMat = new THREE.MeshStandardMaterial({
    name: `rim__${spec.id}`,
    color: 0xc2c8d2,
    metalness: 0.88,
    roughness: 0.18,
  });
  const trimMat = new THREE.MeshStandardMaterial({
    name: `trim__${spec.id}`,
    color: 0x1c2028,
    metalness: 0.16,
    roughness: 0.44,
  });

  const WHEEL_NAMES = ["FL", "FR", "RL", "RR"]; // qIdx: (x>0?1:0)+(z>0?2:0) -> FL/FR/RL/RR

  for (const m of meshes) {
    const n = m.name;
    if (n === spec.paintName || n === "Blue" || n === "LightBlue" || n === "Yellow" || n === "White") {
      const out = new THREE.Mesh(finalizeGeometry(m.geometry), paintMat);
      out.name = `${spec.id}_body`;
      baked.add(out);
    } else if (n === "Windows") {
      const out = new THREE.Mesh(finalizeGeometry(m.geometry), glassMat);
      out.name = `${spec.id}_windows`;
      baked.add(out);
    } else if (n === "Headlights") {
      const out = new THREE.Mesh(finalizeGeometry(m.geometry), headMat);
      out.name = `${spec.id}_headlights`;
      baked.add(out);
    } else if (n === "BlueLights") {
      const mat = new THREE.MeshStandardMaterial({
        name: "headlight__police_beacon_blue",
        color: 0x2563eb,
        emissive: 0x3b82f6,
        emissiveIntensity: 1.4,
        roughness: 0.12,
      });
      const out = new THREE.Mesh(finalizeGeometry(m.geometry), mat);
      out.name = "police_beacon_blue";
      baked.add(out);
    } else if (n === "WhiteLights") {
      const mat = new THREE.MeshStandardMaterial({
        name: "headlight__police_beacon_white",
        color: 0xf8fafc,
        emissive: 0xf8fafc,
        emissiveIntensity: 1.2,
        roughness: 0.10,
      });
      const out = new THREE.Mesh(finalizeGeometry(m.geometry), mat);
      out.name = "police_beacon_white";
      baked.add(out);
    } else if (n === "TailLights") {
      if (spec.id === "police_cruiser") {
        // Split roof red beacon (y > 0.96) from rear taillights (y <= 0.96)
        const pos = m.geometry.getAttribute("position");
        const idx = m.geometry.getIndex();
        const cnt = idx ? idx.count : pos.count;
        const rearTris = [], roofTris = [];
        for (let i = 0; i + 2 < cnt; i += 3) {
          const i0 = idx ? idx.getX(i) : i;
          const i1 = idx ? idx.getX(i + 1) : i + 1;
          const i2 = idx ? idx.getX(i + 2) : i + 2;
          const cy = (pos.getY(i0) + pos.getY(i1) + pos.getY(i2)) / 3;
          const target = cy > 0.96 ? roofTris : rearTris;
          target.push(i, i + 1, i + 2);
        }
        if (rearTris.length) {
          const out = new THREE.Mesh(finalizeGeometry(cloneWithIndices(m.geometry, rearTris)), tailMat);
          out.name = "police_taillights";
          baked.add(out);
        }
        if (roofTris.length) {
          const redBeaconMat = new THREE.MeshStandardMaterial({
            name: "taillight__police_beacon_red",
            color: 0xef4444,
            emissive: 0xff2020,
            emissiveIntensity: 1.4,
            roughness: 0.12,
          });
          const out = new THREE.Mesh(finalizeGeometry(cloneWithIndices(m.geometry, roofTris)), redBeaconMat);
          out.name = "police_beacon_red";
          baked.add(out);
        }
      } else {
        const out = new THREE.Mesh(finalizeGeometry(m.geometry), tailMat);
        out.name = `${spec.id}_taillights`;
        baked.add(out);
      }
    } else if (n === "Black" || n === "Grey") {
      // Radially split the 4 wheel tires (Black) / rims (Grey) from stationary body trim
      const pos = m.geometry.getAttribute("position");
      const idx = m.geometry.getIndex();
      const cnt = idx ? idx.count : pos.count;
      const wheelTris = [[], [], [], []];
      const trimTris = [];
      for (let i = 0; i + 2 < cnt; i += 3) {
        const verts = [0, 1, 2].map((k) => {
          const vi = idx ? idx.getX(i + k) : i + k;
          return new THREE.Vector3(pos.getX(vi), pos.getY(vi), pos.getZ(vi));
        });
        let matched = -1;
        for (let w = 0; w < 4; w++) {
          const wc = wheelCenters[w];
          const maxR = n === "Grey" ? wc.rRim * 1.12 : wc.rTire * 1.08;
          const maxXOff = n === "Grey" ? 0.16 : 0.24;
          const ok = verts.every(
            (v) =>
              Math.sign(v.x) === Math.sign(wc.c.x) &&
              Math.abs(v.x - wc.c.x) < maxXOff &&
              Math.hypot(v.y - wc.c.y, v.z - wc.c.z) <= maxR,
          );
          if (ok) {
            matched = w;
            break;
          }
        }
        if (matched >= 0) wheelTris[matched].push(i, i + 1, i + 2);
        else trimTris.push(i, i + 1, i + 2);
      }

      for (let w = 0; w < 4; w++) {
        if (!wheelTris[w].length) continue;
        const g = finalizeGeometry(cloneWithIndices(m.geometry, wheelTris[w]));
        const out = new THREE.Mesh(g, n === "Grey" ? rimMat : tireMat);
        out.name = `${n === "Grey" ? "rim" : "tire"}_wheel_${WHEEL_NAMES[w]}`;
        baked.add(out);
      }
      if (trimTris.length) {
        const g = finalizeGeometry(cloneWithIndices(m.geometry, trimTris));
        const out = new THREE.Mesh(g, trimMat);
        out.name = `${spec.id}_trim_${n.toLowerCase()}`;
        baked.add(out);
      }
    } else {
      const out = new THREE.Mesh(finalizeGeometry(m.geometry), trimMat);
      out.name = `${spec.id}_${n}`;
      baked.add(out);
    }
  }

  await exportAndPack(baked, filePath);
  const sz = (fs.statSync(filePath).size / 1024).toFixed(1);
  console.log(`[UPGRADED] ${spec.id}.glb -> ${sz} KB`);
}
