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
const { MeshoptDecoder } = await import("three/examples/jsm/libs/meshopt_decoder.module.js");
const { mergeGeometries, mergeVertices, toCreasedNormals } = await import("three/examples/jsm/utils/BufferGeometryUtils.js");
const { LoopSubdivision } = await import("three-subdivide");

await MeshoptDecoder.ready;

const MODELS_DIR = path.resolve("public/models");
const GLTFPACK_BIN = path.resolve("node_modules/.bin/gltfpack");

function extractRawGlbAssets(buf) {
  let off = 12;
  let json = null;
  let bin = Buffer.alloc(0);
  while (off < buf.length) {
    const chunkLen = buf.readUInt32LE(off);
    const chunkType = buf.readUInt32LE(off + 4);
    const data = buf.subarray(off + 8, off + 8 + chunkLen);
    if (chunkType === 0x4e4f534a) json = JSON.parse(data.toString("utf8"));
    else if (chunkType === 0x004e4942) bin = data;
    off += 8 + chunkLen;
  }
  const images = (json.images || []).map((img) => {
    if (img.bufferView === undefined) return null;
    const bv = json.bufferViews[img.bufferView];
    const start = bv.byteOffset || 0;
    return {
      bytes: Buffer.from(bin.subarray(start, start + bv.byteLength)),
      mimeType: img.mimeType || "image/png",
    };
  });
  return { json, images };
}

function serializeGlb(root, rawImages) {
  const binChunks = [];
  let binLen = 0;
  const bufferViews = [];
  const accessors = [];
  const images = [];
  const samplers = [];
  const textures = [];
  const materials = [];
  const meshes = [];
  const nodes = [];

  const pad4 = (b) => {
    const rem = b.length % 4;
    return rem === 0 ? b : Buffer.concat([b, Buffer.alloc(4 - rem, 0)]);
  };
  const pushBufferView = (bytes, target) => {
    const aligned = pad4(Buffer.from(bytes));
    const byteOffset = binLen;
    binChunks.push(aligned);
    binLen += aligned.length;
    const bv = { buffer: 0, byteOffset, byteLength: bytes.length };
    if (target !== undefined) bv.target = target;
    const idx = bufferViews.length;
    bufferViews.push(bv);
    return idx;
  };

  const imageMap = new Map();
  const textureMap = new Map();
  const materialMap = new Map();

  const ensureTexture = (tex) => {
    if (!tex) return undefined;
    if (textureMap.has(tex)) return textureMap.get(tex);
    const origIdx = tex.userData?.__origImageIndex;
    if (origIdx === undefined || !rawImages[origIdx]) return undefined;
    let imgIdx = imageMap.get(origIdx);
    if (imgIdx === undefined) {
      const raw = rawImages[origIdx];
      const bvIdx = pushBufferView(raw.bytes);
      imgIdx = images.length;
      images.push({ bufferView: bvIdx, mimeType: raw.mimeType });
      imageMap.set(origIdx, imgIdx);
    }
    const samplerIdx = samplers.length;
    samplers.push({
      magFilter: 9729,
      minFilter: 9987,
      wrapS: tex.wrapS === THREE.ClampToEdgeWrapping ? 33071 : tex.wrapS === THREE.MirroredRepeatWrapping ? 33648 : 10497,
      wrapT: tex.wrapT === THREE.ClampToEdgeWrapping ? 33071 : tex.wrapT === THREE.MirroredRepeatWrapping ? 33648 : 10497,
    });
    const texIdx = textures.length;
    textures.push({ sampler: samplerIdx, source: imgIdx });
    textureMap.set(tex, texIdx);
    return texIdx;
  };

  const ensureMaterial = (mat) => {
    if (!mat) return undefined;
    if (materialMap.has(mat)) return materialMap.get(mat);
    const m = {};
    if (mat.name) m.name = mat.name;
    const col = mat.color ? [mat.color.r, mat.color.g, mat.color.b] : [0.8, 0.8, 0.8];
    const alpha = typeof mat.opacity === "number" ? mat.opacity : 1.0;
    const pbr = {
      baseColorFactor: [col[0], col[1], col[2], alpha],
      metallicFactor: typeof mat.metalness === "number" ? mat.metalness : 0.0,
      roughnessFactor: typeof mat.roughness === "number" ? mat.roughness : 0.5,
    };
    const baseTex = ensureTexture(mat.map);
    if (baseTex !== undefined) pbr.baseColorTexture = { index: baseTex };
    m.pbrMetallicRoughness = pbr;
    if (mat.emissive && (mat.emissive.r > 0 || mat.emissive.g > 0 || mat.emissive.b > 0)) {
      const ei = typeof mat.emissiveIntensity === "number" ? mat.emissiveIntensity : 1.0;
      m.emissiveFactor = [Math.min(1, mat.emissive.r * ei), Math.min(1, mat.emissive.g * ei), Math.min(1, mat.emissive.b * ei)];
    }
    if (mat.transparent || alpha < 0.999) m.alphaMode = "BLEND";
    if (mat.side === THREE.DoubleSide) m.doubleSided = true;
    const idx = materials.length;
    materials.push(m);
    materialMap.set(mat, idx);
    return idx;
  };

  const pushVecAccessor = (arr, itemSize, componentType, typeStr, computeMinMax = false) => {
    const f32 = new Float32Array(arr.length);
    for (let i = 0; i < arr.length; i++) f32[i] = arr[i];
    const bytes = Buffer.from(f32.buffer, f32.byteOffset, f32.byteLength);
    const bvIdx = pushBufferView(bytes, 34962);
    const acc = { bufferView: bvIdx, componentType, count: arr.length / itemSize, type: typeStr };
    if (computeMinMax && f32.length > 0) {
      const min = new Array(itemSize).fill(Infinity);
      const max = new Array(itemSize).fill(-Infinity);
      for (let i = 0; i < f32.length; i += itemSize) {
        for (let k = 0; k < itemSize; k++) {
          const v = f32[i + k];
          if (v < min[k]) min[k] = v;
          if (v > max[k]) max[k] = v;
        }
      }
      acc.min = min;
      acc.max = max;
    }
    const idx = accessors.length;
    accessors.push(acc);
    return idx;
  };

  const pushIndexAccessor = (idxArr, vertCount) => {
    const useU16 = vertCount <= 65535;
    const typed = useU16 ? new Uint16Array(idxArr) : new Uint32Array(idxArr);
    const bytes = Buffer.from(typed.buffer, typed.byteOffset, typed.byteLength);
    const bvIdx = pushBufferView(bytes, 34963);
    const idx = accessors.length;
    accessors.push({ bufferView: bvIdx, componentType: useU16 ? 5123 : 5125, count: typed.length, type: "SCALAR" });
    return idx;
  };

  const exportMesh = (meshObj) => {
    const geo = meshObj.geometry;
    const pos = geo.getAttribute("position");
    if (!pos || pos.count === 0) return undefined;
    const attrs = {};
    const posArr = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      posArr[i * 3] = pos.getX(i); posArr[i * 3 + 1] = pos.getY(i); posArr[i * 3 + 2] = pos.getZ(i);
    }
    attrs.POSITION = pushVecAccessor(posArr, 3, 5126, "VEC3", true);
    let norm = geo.getAttribute("normal");
    if (!norm) { geo.computeVertexNormals(); norm = geo.getAttribute("normal"); }
    if (norm) {
      const nArr = new Float32Array(pos.count * 3);
      for (let i = 0; i < pos.count; i++) {
        let nx = norm.getX(i), ny = norm.getY(i), nz = norm.getZ(i);
        const l = Math.hypot(nx, ny, nz);
        if (l > 1e-6) { nx /= l; ny /= l; nz /= l; } else { nx = 0; ny = 1; nz = 0; }
        nArr[i * 3] = nx; nArr[i * 3 + 1] = ny; nArr[i * 3 + 2] = nz;
      }
      attrs.NORMAL = pushVecAccessor(nArr, 3, 5126, "VEC3", false);
    }
    const uv = geo.getAttribute("uv");
    if (uv) {
      const uArr = new Float32Array(pos.count * 2);
      for (let i = 0; i < pos.count; i++) { uArr[i * 2] = uv.getX(i); uArr[i * 2 + 1] = uv.getY(i); }
      attrs.TEXCOORD_0 = pushVecAccessor(uArr, 2, 5126, "VEC2", false);
    }
    const mat = Array.isArray(meshObj.material) ? meshObj.material[0] : meshObj.material;
    const matIdx = ensureMaterial(mat);
    const prim = { attributes: attrs, mode: 4 };
    if (matIdx !== undefined) prim.material = matIdx;
    if (geo.index) {
      const iArr = new Array(geo.index.count);
      for (let i = 0; i < geo.index.count; i++) iArr[i] = geo.index.getX(i);
      prim.indices = pushIndexAccessor(iArr, pos.count);
    }
    const meshIdx = meshes.length;
    meshes.push({ name: meshObj.name || undefined, primitives: [prim] });
    return meshIdx;
  };

  const buildNode = (obj) => {
    const node = {};
    if (obj.name) node.name = obj.name;
    const p = obj.position, q = obj.quaternion, s = obj.scale;
    if (p.x !== 0 || p.y !== 0 || p.z !== 0) node.translation = [p.x, p.y, p.z];
    if (q.x !== 0 || q.y !== 0 || q.z !== 0 || q.w !== 1) node.rotation = [q.x, q.y, q.z, q.w];
    if (s.x !== 1 || s.y !== 1 || s.z !== 1) node.scale = [s.x, s.y, s.z];
    if (obj.isMesh && obj.visible !== false) {
      const mIdx = exportMesh(obj);
      if (mIdx !== undefined) node.mesh = mIdx;
    }
    const childIds = [];
    for (const ch of obj.children) {
      const cid = buildNode(ch);
      if (cid !== null) childIds.push(cid);
    }
    if (childIds.length) node.children = childIds;
    if (node.mesh === undefined && !childIds.length && !node.name) return null;
    const idx = nodes.length;
    nodes.push(node);
    return idx;
  };

  const sceneNodes = [];
  for (const ch of root.children) {
    const id = buildNode(ch);
    if (id !== null) sceneNodes.push(id);
  }
  const gltfJson = {
    asset: { version: "2.0", generator: "westgate-hero-upgrade" },
    scene: 0,
    scenes: [{ nodes: sceneNodes }],
    nodes, meshes, materials, accessors, bufferViews,
    buffers: [{ byteLength: binLen }],
  };
  if (textures.length) gltfJson.textures = textures;
  if (images.length) gltfJson.images = images;
  if (samplers.length) gltfJson.samplers = samplers;
  const jsonBytes = Buffer.from(JSON.stringify(gltfJson), "utf8");
  const jsonPad = (4 - (jsonBytes.length % 4)) % 4;
  const jsonChunk = Buffer.concat([jsonBytes, Buffer.alloc(jsonPad, 0x20)]);
  const binBuf = Buffer.concat(binChunks);
  const totalLen = 12 + 8 + jsonChunk.length + 8 + binBuf.length;
  const out = Buffer.alloc(totalLen);
  out.writeUInt32LE(0x46546c67, 0);
  out.writeUInt32LE(2, 4);
  out.writeUInt32LE(totalLen, 8);
  out.writeUInt32LE(jsonChunk.length, 12);
  out.writeUInt32LE(0x4e4f534a, 16);
  jsonChunk.copy(out, 20);
  const binOff = 20 + jsonChunk.length;
  out.writeUInt32LE(binBuf.length, binOff);
  out.writeUInt32LE(0x004e4942, binOff + 4);
  binBuf.copy(out, binOff + 8);
  return out;
}

const ORIENTATION = {
  golf: 0,
  mercedes: 0,
  audi: Math.PI,
  mustang: 0,
  ferrari: Math.PI,
  r8: Math.PI,
  challenger: Math.PI,
  rangerover: Math.PI,
};

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

function smoothSubdivideMesh(mesh, iterations = 1, maxTri = 5000) {
  const geo = mesh.geometry;
  if (!geo?.attributes?.position) return;
  const tc = geo.index ? geo.index.count / 3 : geo.attributes.position.count / 3;
  if (tc <= 0 || tc > maxTri) return;
  try {
    const nonIdx = geo.index ? geo.toNonIndexed() : geo.clone();
    const clean = new THREE.BufferGeometry();
    for (const attrName of ["position", "uv", "uv1", "color"]) {
      const attr = nonIdx.getAttribute(attrName);
      if (attr) clean.setAttribute(attrName, attr);
    }
    const welded = mergeVertices(clean, 1e-4);
    const sub = LoopSubdivision.modify(welded, iterations, {
      split: false,
      uvSmooth: true,
      preserveEdges: true,
      flatOnly: false,
    });
    mesh.geometry = toCreasedNormals(sub, (44 * Math.PI) / 180);
  } catch {
    // Keep original geometry if non-manifold
  }
}

function bakeSceneToMeters(scene) {
  scene.updateMatrixWorld(true);
  const topChildren = [];
  const doorGroups = new Map();
  scene.traverse((o) => {
    if (/^door_/.test(o.name)) {
      const worldPos = new THREE.Vector3();
      o.getWorldPosition(worldPos);
      const dg = new THREE.Group();
      dg.name = o.name;
      dg.position.copy(worldPos);
      doorGroups.set(o, dg);
      topChildren.push(dg);
    }
  });

  const findDoorAncestor = (obj) => {
    let cur = obj;
    while (cur) {
      if (doorGroups.has(cur)) return cur;
      cur = cur.parent;
    }
    return null;
  };

  scene.traverse((o) => {
    if (!o.isMesh || o.visible === false) return;
    const doorAnc = findDoorAncestor(o);
    const geo = o.geometry.clone();
    const mat = doorAnc
      ? new THREE.Matrix4().makeTranslation(
          -doorGroups.get(doorAnc).position.x,
          -doorGroups.get(doorAnc).position.y,
          -doorGroups.get(doorAnc).position.z
        ).multiply(o.matrixWorld)
      : o.matrixWorld.clone();

    geo.applyMatrix4(mat);
    if (mat.determinant() < 0) {
      if (geo.index) {
        const idx = geo.index;
        for (let i = 0; i + 2 < idx.count; i += 3) {
          const b = idx.getX(i + 1);
          idx.setX(i + 1, idx.getX(i + 2));
          idx.setX(i + 2, b);
        }
        idx.needsUpdate = true;
      }
      const norm = geo.getAttribute("normal");
      if (norm) {
        for (let i = 0; i < norm.count; i++) {
          norm.setXYZ(i, -norm.getX(i), -norm.getY(i), -norm.getZ(i));
        }
        norm.needsUpdate = true;
      }
    }

    const m = new THREE.Mesh(geo, o.material);
    m.name = o.name;
    if (doorAnc) doorGroups.get(doorAnc).add(m);
    else topChildren.push(m);
  });

  const clean = new THREE.Scene();
  for (const ch of topChildren) clean.add(ch);
  clean.updateMatrixWorld(true);
  return clean;
}

async function loadGlb(filePath) {
  const buf = fs.readFileSync(filePath);
  const raw = extractRawGlbAssets(buf);
  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);
  const gltf = await loader.parseAsync(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), "");
  for (const [obj, assoc] of gltf.parser.associations.entries()) {
    if (obj && obj.isTexture && assoc && typeof assoc.textures === "number") {
      const texDef = raw.json.textures?.[assoc.textures];
      if (texDef && typeof texDef.source === "number") {
        obj.userData.__origImageIndex = texDef.source;
      }
    }
  }
  gltf.scene.updateMatrixWorld(true);
  gltf.scene.traverse((o) => {
    if (o.isMesh) o.geometry = deinterleaveGeometry(o.geometry);
  });
  return { scene: bakeSceneToMeters(gltf.scene), rawImages: raw.images };
}

async function exportAndPack(scene, rawImages, outPath) {
  const tmpRaw = outPath + ".raw.glb";
  fs.writeFileSync(tmpRaw, serializeGlb(scene, rawImages));
  try {
    execFileSync(GLTFPACK_BIN, ["-i", tmpRaw, "-o", outPath, "-cc", "-kn", "-km", "-vp", "16"], { stdio: "pipe" });
  } finally {
    if (fs.existsSync(tmpRaw)) fs.unlinkSync(tmpRaw);
  }
}

function getWheelCentersFromTiresAndRims(scene) {
  scene.updateMatrixWorld(true);
  const bounds = [new THREE.Box3(), new THREE.Box3(), new THREE.Box3(), new THREE.Box3()];
  const p = new THREE.Vector3();
  scene.traverse((o) => {
    if (!o.isMesh || Array.isArray(o.material)) return;
    if (!o.material.name.startsWith("tire__") && !o.material.name.startsWith("rim__")) return;
    const pos = o.geometry.getAttribute("position");
    const idx = o.geometry.index;
    const cnt = idx ? idx.count : pos.count;
    for (let i = 0; i < cnt; i++) {
      const vi = idx ? idx.getX(i) : i;
      p.fromBufferAttribute(pos, vi).applyMatrix4(o.matrixWorld);
      if (p.y > 0.85 || Math.abs(p.x) < 0.35 || Math.abs(p.z) < 0.45) continue;
      bounds[(p.x > 0 ? 1 : 0) + (p.z > 0 ? 2 : 0)].expandByPoint(p);
    }
  });
  return bounds.map((b) => {
    const c = b.getCenter(new THREE.Vector3());
    const s = b.getSize(new THREE.Vector3());
    return { center: c, radius: Math.max(s.y, s.z) * 0.5 };
  });
}

function createBrakeDiscGeometry(discR) {
  const outer = new THREE.CylinderGeometry(discR, discR, 0.022, 36);
  outer.rotateZ(Math.PI / 2);
  const hat = new THREE.CylinderGeometry(discR * 0.46, discR * 0.46, 0.036, 24);
  hat.rotateZ(Math.PI / 2);
  return toCreasedNormals(mergeGeometries([outer, hat], false), (40 * Math.PI) / 180);
}

function createCaliperGeometry(discR) {
  const main = new THREE.BoxGeometry(0.056, discR * 0.66, discR * 0.36);
  const capTop = new THREE.BoxGeometry(0.048, discR * 0.16, discR * 0.28);
  capTop.translate(0, discR * 0.34, 0);
  const capBot = new THREE.BoxGeometry(0.048, discR * 0.16, discR * 0.28);
  capBot.translate(0, -discR * 0.34, 0);
  return toCreasedNormals(mergeGeometries([main, capTop, capBot], false), (35 * Math.PI) / 180);
}

function addDiscsAndCalipers(scene, tag, opts = { addDiscs: true, addCalipers: true, discR: 0.195 }) {
  // Remove any previously injected synthetic discs/calipers for idempotency (even after gltfpack node renaming)
  const stale = [];
  scene.traverse((o) => {
    const mn = o.material?.name || "";
    if (
      o.isMesh &&
      (o.name.startsWith(`${tag}_disc_`) ||
        o.name.startsWith(`${tag}_caliper_`) ||
        (opts.addDiscs && mn === `brake__${tag}_Disc`) ||
        (opts.addCalipers && mn === `brake__${tag}_Caliper`))
    ) {
      stale.push(o);
    }
  });
  for (const s of stale) s.parent?.remove(s);
  const wheels = getWheelCentersFromTiresAndRims(scene);
  const discMat = new THREE.MeshStandardMaterial({
    name: `brake__${tag}_Disc`,
    color: 0xa2aab5,
    metalness: 0.88,
    roughness: 0.24,
  });
  const caliperMat = new THREE.MeshStandardMaterial({
    name: `brake__${tag}_Caliper`,
    color: 0xb91c1c,
    metalness: 0.48,
    roughness: 0.32,
  });
  const discGeo = opts.addDiscs ? createBrakeDiscGeometry(opts.discR) : null;
  const calGeo = opts.addCalipers ? createCaliperGeometry(opts.discR) : null;

  wheels.forEach((w, i) => {
    const signX = Math.sign(w.center.x) || 1;
    const xInset = w.center.x - signX * 0.045;
    if (discGeo) {
      const disc = new THREE.Mesh(discGeo, discMat);
      disc.name = `${tag}_disc_${i}`;
      disc.position.set(xInset, w.center.y, w.center.z);
      scene.add(disc);
    }
    if (calGeo) {
      const cal = new THREE.Mesh(calGeo, caliperMat);
      cal.name = `${tag}_caliper_${i}`;
      // Place caliper on inboard-facing side toward center of car
      const zSign = w.center.z < 0 ? 1 : -1;
      cal.position.set(xInset + signX * 0.012, w.center.y + 0.02, w.center.z + zSign * opts.discR * 0.62);
      scene.add(cal);
    }
  });
}

// Compute the world-space transform that ModelLibrary applies (`ORIENTATION` + centerXZ + minY=0),
// then invert it to place a normalized-space license plate cleanly into raw GLB space!
function addRearLicensePlate(scene, id, tag, normY, normZ, tiltX = 0, plateW = 0.326, plateH = 0.144) {
  const stalePlates = [];
  scene.traverse((o) => {
    const mn = o.material?.name || "";
    if (
      o.name === `${tag}_rear_plate` ||
      o.name === `${tag}_plate_bezel` ||
      o.name === `${tag}_plate_face` ||
      mn === `plate__${tag}` ||
      mn === `trim__${tag}_plate_frame`
    ) {
      stalePlates.push(o);
    }
  });
  for (const s of stalePlates) s.parent?.remove(s);
  scene.updateMatrixWorld(true);
  const rotY = ORIENTATION[id];
  const tempRoot = new THREE.Group();
  tempRoot.rotation.y = rotY;
  // Compute normalized bounds without modifying scene
  const box = new THREE.Box3();
  const v = new THREE.Vector3();
  const rotMat = new THREE.Matrix4().makeRotationY(rotY);
  scene.traverse((o) => {
    if (!o.isMesh) return;
    const pos = o.geometry.getAttribute("position");
    const m = new THREE.Matrix4().multiplyMatrices(rotMat, o.matrixWorld);
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(m);
      box.expandByPoint(v);
    }
  });
  const ctr = box.getCenter(new THREE.Vector3());
  // Normalized point (0, normY, normZ) -> oriented space -> raw GLB space
  const orientedPt = new THREE.Vector3(0, normY + box.min.y, normZ + ctr.z);
  orientedPt.x += ctr.x;
  const invRot = new THREE.Matrix4().makeRotationY(-rotY);
  const rawPt = orientedPt.clone().applyMatrix4(invRot);

  const plateGroup = new THREE.Group();
  plateGroup.name = `${tag}_rear_plate`;
  plateGroup.position.copy(rawPt);
  plateGroup.rotation.y = -rotY;
  plateGroup.rotation.x = tiltX;

  const frameMat = new THREE.MeshStandardMaterial({
    name: `trim__${tag}_plate_frame`,
    color: 0x16181e,
    metalness: 0.45,
    roughness: 0.35,
  });
  const plateMat = new THREE.MeshStandardMaterial({
    name: `plate__${tag}`,
    color: 0xd0d6df,
    metalness: 0.35,
    roughness: 0.34,
  });

  const bezel = new THREE.Mesh(new THREE.BoxGeometry(plateW + 0.024, plateH + 0.021, 0.010), frameMat);
  bezel.name = `${tag}_plate_bezel`;
  plateGroup.add(bezel);

  // Front-facing plane facing +Z in normalized car rear space with clean [0..1] UVs
  const faceGeo = new THREE.PlaneGeometry(plateW, plateH);
  faceGeo.translate(0, 0, 0.006);
  const face = new THREE.Mesh(faceGeo, plateMat);
  face.name = `${tag}_plate_face`;
  plateGroup.add(face);

  scene.add(plateGroup);
}

const onlyArg = process.argv.find((a) => a.startsWith("--only="));
const onlySet = onlyArg
  ? new Set(onlyArg.slice("--only=".length).split(",").map((s) => s.trim()).filter(Boolean))
  : null;
const shouldRun = (id) => !onlySet || onlySet.has(id);

// 1. MERCEDES W222
if (shouldRun("mercedes")) {
  const p = path.join(MODELS_DIR, "mercedes.glb");
  const { scene, rawImages } = await loadGlb(p);
  scene.traverse((o) => {
    if (!o.isMesh || Array.isArray(o.material)) return;
    const mn = o.material.name || "";
    if (mn.startsWith("paint__") || mn.startsWith("glass__") || mn === "trim__W222 - Glossy Black") {
      smoothSubdivideMesh(o, 1, 5500);
    }
  });
  addDiscsAndCalipers(scene, "W222", { addDiscs: true, addCalipers: true, discR: 0.195 });
  addRearLicensePlate(scene, "mercedes", "W222", 0.832, 2.510, 0, 0.50, 0.115);
  await exportAndPack(scene, rawImages, p);
  console.log(`[HERO] mercedes.glb -> ${(fs.statSync(p).size / 1024).toFixed(1)} KB`);
}

// 2. R8
if (shouldRun("r8")) {
  const p = path.join(MODELS_DIR, "r8.glb");
  const { scene, rawImages } = await loadGlb(p);
  const staleFloor = [];
  scene.traverse((o) => { if (o.name === "r8_underbody_floor") staleFloor.push(o); });
  for (const s of staleFloor) s.parent?.remove(s);
  const extraAdd = [];
  scene.traverse((o) => {
    if (!o.isMesh || Array.isArray(o.material)) return;
    const mn = o.material.name || "";
    if (mn === "glass__r8" || mn === "paint__r8") {
      smoothSubdivideMesh(o, 1, 2200);
    }
    // Split front lower lamp/grille lens (mesh_95: y ~ 0.51, z > 1.5 in raw GLB)
    if (mn === "glass__r8") {
      o.geometry.computeBoundingBox();
      const bb = o.geometry.boundingBox;
      const c = bb.getCenter(new THREE.Vector3());
      const s = bb.getSize(new THREE.Vector3());
      if (s.y < 0.05 && c.z > 1.5) {
        const covMat = new THREE.MeshStandardMaterial({
          name: "headlight__r8_cover",
          color: 0xdbe7f3,
          transparent: true,
          opacity: 0.24,
          roughness: 0.05,
        });
        o.material = covMat;
      }
    }
  });
  // Dark underbody floor pan so wheel wells & lower chassis don't look hollow
  const floorGeo = new THREE.BoxGeometry(1.56, 0.03, 3.35);
  const floorMat = new THREE.MeshStandardMaterial({ name: "trim__r8_underbody", color: 0x101216, roughness: 0.85, metalness: 0.1 });
  const floorMesh = new THREE.Mesh(floorGeo, floorMat);
  floorMesh.name = "r8_underbody_floor";
  floorMesh.position.set(0, 0.14, 0.05);
  extraAdd.push(floorMesh);
  for (const m of extraAdd) scene.add(m);

  addDiscsAndCalipers(scene, "r8", { addDiscs: true, addCalipers: true, discR: 0.195 });
  addRearLicensePlate(scene, "r8", "r8", 0.59, 2.138);
  await exportAndPack(scene, rawImages, p);
  console.log(`[HERO] r8.glb -> ${(fs.statSync(p).size / 1024).toFixed(1)} KB`);
}

// 3. CHALLENGER
if (shouldRun("challenger")) {
  const p = path.join(MODELS_DIR, "challenger.glb");
  const { scene, rawImages } = await loadGlb(p);
  const discMat = new THREE.MeshStandardMaterial({
    name: "brake__challenger_Disc",
    color: 0xa2aab5,
    metalness: 0.88,
    roughness: 0.24,
  });
  const hlCoverMat = new THREE.MeshStandardMaterial({
    name: "headlight__challenger_cover",
    color: 0xdbe7f3,
    transparent: true,
    opacity: 0.22,
    roughness: 0.05,
  });
  const tlCoverMat = new THREE.MeshStandardMaterial({
    name: "taillight__challenger_cover",
    color: 0x9e0a10,
    transparent: true,
    opacity: 0.40,
    roughness: 0.06,
  });

  const toAdd = [];
  const toRemove = [];
  scene.updateMatrixWorld(true);
  scene.traverse((o) => {
    if (!o.isMesh || Array.isArray(o.material)) return;
    const mn = o.material.name || "";
    const bb = new THREE.Box3().setFromObject(o);
    const sz = bb.getSize(new THREE.Vector3());
    const ctr = bb.getCenter(new THREE.Vector3());

    // Re-tag the 4 existing brake rotor meshes from trim__challenger -> brake__challenger_Disc
    if (mn === "trim__challenger" && sz.x < 0.14 && sz.y > 0.30 && sz.y < 0.46 && Math.abs(sz.y - sz.z) < 0.04 && Math.abs(ctr.x) > 0.55) {
      o.material = discMat;
    }
    // Re-tag front headlight & rear taillight covers from glass__challenger -> cover materials
    if (mn === "glass__challenger") {
      if (sz.y < 0.20 && sz.z < 0.15 && ctr.z > 2.0) {
        o.material = hlCoverMat;
      } else if (sz.y < 0.20 && sz.z < 0.15 && ctr.z < -2.0) {
        o.material = tlCoverMat;
      } else if (sz.z > 4.0 && sz.y < 0.25 && ctr.y < 0.65) {
        // mesh_22_1: split front fog/marker lenses (raw z > 0) vs rear side markers/reverse lenses (raw z < 0)
        const pos = o.geometry.getAttribute("position");
        const idx = o.geometry.getIndex();
        const cnt = idx ? idx.count : pos.count;
        const fTris = [], rTris = [];
        const pt = new THREE.Vector3();
        for (let i = 0; i + 2 < cnt; i += 3) {
          let avgZ = 0;
          for (let k = 0; k < 3; k++) {
            const vi = idx ? idx.getX(i + k) : i + k;
            pt.fromBufferAttribute(pos, vi).applyMatrix4(o.matrixWorld);
            avgZ += pt.z / 3;
          }
          (avgZ > 0 ? fTris : rTris).push(i, i + 1, i + 2);
        }
        if (fTris.length) {
          const fm = new THREE.Mesh(cloneWithIndices(o.geometry, fTris), hlCoverMat);
          fm.name = "challenger_front_markers";
          fm.applyMatrix4(o.matrixWorld);
          toAdd.push(fm);
        }
        if (rTris.length) {
          const rm = new THREE.Mesh(cloneWithIndices(o.geometry, rTris), tlCoverMat);
          rm.name = "challenger_rear_markers";
          rm.applyMatrix4(o.matrixWorld);
          toAdd.push(rm);
        }
        toRemove.push(o);
      }
    }
  });
  for (const r of toRemove) r.parent?.remove(r);
  for (const a of toAdd) scene.add(a);

  addDiscsAndCalipers(scene, "challenger", { addDiscs: false, addCalipers: true, discR: 0.195 });
  addRearLicensePlate(scene, "challenger", "challenger", 0.54, 2.464);
  await exportAndPack(scene, rawImages, p);
  console.log(`[HERO] challenger.glb -> ${(fs.statSync(p).size / 1024).toFixed(1)} KB`);
}

// 4. MUSTANG
if (shouldRun("mustang")) {
  const p = path.join(MODELS_DIR, "mustang.glb");
  const { scene, rawImages } = await loadGlb(p);
  scene.traverse((o) => {
    if (!o.isMesh || Array.isArray(o.material)) return;
    const mn = o.material.name || "";
    if (mn.startsWith("paint__") || mn.startsWith("glass__")) {
      smoothSubdivideMesh(o, 1, 5500);
    }
  });
  addRearLicensePlate(scene, "mustang", "mustang", 0.45, 2.240);
  await exportAndPack(scene, rawImages, p);
  console.log(`[HERO] mustang.glb -> ${(fs.statSync(p).size / 1024).toFixed(1)} KB`);
}

// 5. AUDI, FERRARI, RANGEROVER (flush rear Westgate plates)
for (const spec of [
  { id: "audi", tag: "audi", y: 0.76, z: 2.392 },
  { id: "ferrari", tag: "ferrari", y: 0.54, z: 2.072 },
  { id: "rangerover", tag: "RangeRover", y: 0.75, z: 2.456 },
]) {
  if (!shouldRun(spec.id)) continue;
  const p = path.join(MODELS_DIR, `${spec.id}.glb`);
  const { scene, rawImages } = await loadGlb(p);
  addRearLicensePlate(scene, spec.id, spec.tag, spec.y, spec.z);
  await exportAndPack(scene, rawImages, p);
  console.log(`[HERO] ${spec.id}.glb -> ${(fs.statSync(p).size / 1024).toFixed(1)} KB`);
}
