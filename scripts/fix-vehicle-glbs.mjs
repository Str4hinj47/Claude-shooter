import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

globalThis.self = globalThis;
globalThis.createImageBitmap = async () => ({ width: 1, height: 1, close() {} });

const THREE = await import("three");
const { GLTFLoader } = await import("three/examples/jsm/loaders/GLTFLoader.js");
const { MeshoptDecoder } = await import("three/examples/jsm/libs/meshopt_decoder.module.js");
const { toCreasedNormals } = await import("three/examples/jsm/utils/BufferGeometryUtils.js");

await MeshoptDecoder.ready;

const MODELS_DIR = path.resolve("public/models");
const GLTFPACK_BIN = path.resolve("node_modules/.bin/gltfpack");

// ---------------------------------------------------------------------------
// Raw GLB image & sampler extractor (preserves original PNG/JPEG/WebP bytes)
// ---------------------------------------------------------------------------
function extractRawGlbAssets(buf) {
  const magic = buf.readUInt32LE(0);
  if (magic !== 0x46546c67) throw new Error("Not a GLB");
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
    const bytes = Buffer.from(bin.subarray(start, start + bv.byteLength));
    return {
      bytes,
      mimeType: img.mimeType || "image/png",
      name: img.name || "",
    };
  });
  return { json, images };
}

async function loadCarGlb(filePath) {
  const buf = fs.readFileSync(filePath);
  const raw = extractRawGlbAssets(buf);
  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);
  const gltf = await loader.parseAsync(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), "");
  // Tag every THREE.Texture with its original glTF image index so we preserve bytes losslessly
  for (const [obj, assoc] of gltf.parser.associations.entries()) {
    if (obj && obj.isTexture && assoc && typeof assoc.textures === "number") {
      const texDef = raw.json.textures?.[assoc.textures];
      if (texDef && typeof texDef.source === "number") {
        obj.userData.__origImageIndex = texDef.source;
      }
    }
  }
  return { gltf, raw };
}

// ---------------------------------------------------------------------------
// Clean glTF 2.0 binary GLB writer (Float32 geometry + exact raw textures)
// ---------------------------------------------------------------------------
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

  const pad4 = (buf) => {
    const rem = buf.length % 4;
    if (rem === 0) return buf;
    return Buffer.concat([buf, Buffer.alloc(4 - rem, 0)]);
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
      m.emissiveFactor = [
        Math.min(1, mat.emissive.r * ei),
        Math.min(1, mat.emissive.g * ei),
        Math.min(1, mat.emissive.b * ei),
      ];
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
    const acc = {
      bufferView: bvIdx,
      componentType,
      count: arr.length / itemSize,
      type: typeStr,
    };
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
    accessors.push({
      bufferView: bvIdx,
      componentType: useU16 ? 5123 : 5125,
      count: typed.length,
      type: "SCALAR",
    });
    return idx;
  };

  const exportMesh = (meshObj) => {
    const geo = meshObj.geometry;
    const pos = geo.getAttribute("position");
    if (!pos || pos.count === 0) return undefined;
    const attrs = {};
    const posArr = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      posArr[i * 3] = pos.getX(i);
      posArr[i * 3 + 1] = pos.getY(i);
      posArr[i * 3 + 2] = pos.getZ(i);
    }
    attrs.POSITION = pushVecAccessor(posArr, 3, 5126, "VEC3", true);

    let norm = geo.getAttribute("normal");
    if (!norm) {
      geo.computeVertexNormals();
      norm = geo.getAttribute("normal");
    }
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
      for (let i = 0; i < pos.count; i++) {
        uArr[i * 2] = uv.getX(i);
        uArr[i * 2 + 1] = uv.getY(i);
      }
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
    const p = obj.position;
    const q = obj.quaternion;
    const s = obj.scale;
    if (p.x !== 0 || p.y !== 0 || p.z !== 0) node.translation = [p.x, p.y, p.z];
    if (q.x !== 0 || q.y !== 0 || q.z !== 0 || q.w !== 1) node.rotation = [q.x, q.y, q.z, q.w];
    if (s.x !== 1 || s.y !== 1 || s.z !== 1) node.scale = [s.x, s.y, s.z];
    if (obj.isMesh) {
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
    asset: { version: "2.0", generator: "westgate-vehicle-repair" },
    scene: 0,
    scenes: [{ nodes: sceneNodes }],
    nodes,
    meshes,
    materials,
    accessors,
    bufferViews,
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

function saveAndPackGlb(root, rawImages, outPath, useGltfpack = true) {
  const tmpRaw = outPath + ".tmp.glb";
  fs.writeFileSync(tmpRaw, serializeGlb(root, rawImages));
  if (useGltfpack && fs.existsSync(GLTFPACK_BIN)) {
    execFileSync(GLTFPACK_BIN, ["-i", tmpRaw, "-o", outPath, "-cc", "-kn", "-km"], { stdio: "inherit" });
    console.log("  rawSize=", (fs.statSync(tmpRaw).size/1e6).toFixed(2)+"MB"); fs.unlinkSync(tmpRaw);
  } else {
    fs.renameSync(tmpRaw, outPath);
  }
}

// ---------------------------------------------------------------------------
// Geometry helpers: remove degenerate triangles + bake transforms cleanly
// ---------------------------------------------------------------------------
function stripDegenerateTriangles(mesh) {
  const geo = mesh.geometry;
  const pos = geo.getAttribute("position");
  if (!pos) return 0;
  const idx = geo.index;
  const cnt = idx ? idx.count : pos.count;
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  const ab = new THREE.Vector3(), ac = new THREE.Vector3(), cr = new THREE.Vector3();
  const kept = [];
  let removed = 0;
  for (let i = 0; i + 2 < cnt; i += 3) {
    const ia = idx ? idx.getX(i) : i;
    const ib = idx ? idx.getX(i + 1) : i + 1;
    const ic = idx ? idx.getX(i + 2) : i + 2;
    a.fromBufferAttribute(pos, ia);
    b.fromBufferAttribute(pos, ib);
    c.fromBufferAttribute(pos, ic);
    ab.subVectors(b, a);
    ac.subVectors(c, a);
    cr.crossVectors(ab, ac);
    if (cr.lengthSq() < 1e-20) {
      removed++;
      continue;
    }
    kept.push(ia, ib, ic);
  }
  if (removed > 0) {
    geo.setIndex(kept);
  }
  return removed;
}

// Bake world transform of every mesh directly into geometry vertices/normals,
// preserving named pivot groups (e.g. door_fl, door_fr, tire_FL..RR, caliper_FL..RR)
// at scale = [1, 1, 1] so gltfpack quantization precision is uniform everywhere.
function bakeTransformsPreservingPivots(root, pivotRegex = /^(door_(?:fl|fr|rl|rr)|(?:tire|caliper)_(?:FL|FR|RL|RR))$/) {
  root.updateMatrixWorld(true);
  const cleanRoot = new THREE.Group();
  const pivotGroups = new Map();

  const ensurePivot = (pivotObj) => {
    if (pivotGroups.has(pivotObj)) return pivotGroups.get(pivotObj);
    const g = new THREE.Group();
    g.name = pivotObj.name;
    const wp = new THREE.Vector3();
    pivotObj.getWorldPosition(wp);
    g.position.copy(wp);
    cleanRoot.add(g);
    pivotGroups.set(pivotObj, g);
    return g;
  };

  root.traverse((o) => {
    if (!o.isMesh || !o.visible) return;
    let pivotParent = null;
    let p = o.parent;
    while (p && p !== root) {
      if (pivotRegex.test(p.name)) { pivotParent = p; break; }
      p = p.parent;
    }

    const pos = o.geometry.getAttribute("position");
    if (!pos || pos.count === 0) return;

    // Promote any quantized Int8/Int16/Uint16 attributes to Float32 before applyMatrix4!
    const geo = new THREE.BufferGeometry();
    for (const attrName of ["position", "normal", "uv", "uv1"]) {
      const src = o.geometry.getAttribute(attrName);
      if (!src) continue;
      const itemSize = src.itemSize;
      const f32 = new Float32Array(src.count * itemSize);
      for (let i = 0; i < src.count; i++) {
        f32[i * itemSize] = src.getX(i);
        if (itemSize > 1) f32[i * itemSize + 1] = src.getY(i);
        if (itemSize > 2) f32[i * itemSize + 2] = src.getZ(i);
        if (itemSize > 3) f32[i * itemSize + 3] = src.getW(i);
      }
      geo.setAttribute(attrName, new THREE.Float32BufferAttribute(f32, itemSize));
    }
    if (o.geometry.index) {
      const si = o.geometry.index;
      const arr = new Uint32Array(si.count);
      for (let i = 0; i < si.count; i++) arr[i] = si.getX(i);
      geo.setIndex(new THREE.BufferAttribute(arr, 1));
    }
    let targetGroup = cleanRoot;
    let mat = o.matrixWorld.clone();

    if (pivotParent) {
      const pg = ensurePivot(pivotParent);
      targetGroup = pg;
      const invPivot = new THREE.Matrix4().makeTranslation(-pg.position.x, -pg.position.y, -pg.position.z);
      mat.premultiply(invPivot);
    }

    // Handle negative-determinant matrix cleanly
    const det = mat.determinant();
    geo.applyMatrix4(mat);
    if (det < 0) {
      if (!geo.index) {
        const arr = [];
        for (let i = 0; i < pos.count; i++) arr.push(i);
        geo.setIndex(arr);
      }
      const idx = geo.index;
      for (let i = 0; i + 2 < idx.count; i += 3) {
        const b = idx.getX(i + 1);
        idx.setX(i + 1, idx.getX(i + 2));
        idx.setX(i + 2, b);
      }
      idx.needsUpdate = true;
    }

    const m = new THREE.Mesh(geo, o.material);
    m.name = o.name;
    stripDegenerateTriangles(m);
    if ((m.geometry.index ? m.geometry.index.count : m.geometry.getAttribute("position").count) === 0) return;
    targetGroup.add(m);
  });

  return cleanRoot;
}

// ---------------------------------------------------------------------------
// Connected-component winding repair (fixes inverted glass/wheels/bumpers/panels)
// ---------------------------------------------------------------------------
function fixInvertedIslands(root, options = {}) {
  const {
    carCenter = new THREE.Vector3(0, 0.55, 0),
    minInwardFrac = 0.72,
    includeMaterials = /^(paint|glass|rim|tire|brake|chrome|taillight|headlight|trim|carbon|metal|other|plate)__/i,
    skipMeshRegex = /interior|mercedes_interior_template|floor|chassis|underbody/i,
  } = options;

  root.updateMatrixWorld(true);
  let totalFlippedTris = 0;

  root.traverse((o) => {
    if (!o.isMesh) return;
    const matName = o.material?.name || "";
    if (!includeMaterials.test(matName) && matName !== "") return;
    if (skipMeshRegex.test(o.name) || skipMeshRegex.test(o.parent?.name || "")) return;

    const geo = o.geometry;
    const pos = geo.getAttribute("position");
    if (!pos || pos.count < 3) return;
    if (!geo.index) {
      const seq = [];
      for (let i = 0; i < pos.count; i++) seq.push(i);
      geo.setIndex(seq);
    }
    const idx = geo.index;
    const triCount = Math.floor(idx.count / 3);
    if (triCount === 0) return;

    // Spatial vertex key (0.5mm grid) for connected component grouping
    const vertKey = new Int32Array(pos.count);
    const keyMap = new Map();
    const wp = new THREE.Vector3();
    let nextId = 0;
    for (let i = 0; i < pos.count; i++) {
      wp.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld);
      const k = `${Math.round(wp.x * 2000)},${Math.round(wp.y * 2000)},${Math.round(wp.z * 2000)}`;
      let id = keyMap.get(k);
      if (id === undefined) { id = nextId++; keyMap.set(k, id); }
      vertKey[i] = id;
    }

    // Union-Find over triangles sharing spatial vertices
    const parent = new Int32Array(triCount);
    for (let t = 0; t < triCount; t++) parent[t] = t;
    const find = (x) => {
      while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; }
      return x;
    };
    const unite = (a, b) => {
      const ra = find(a), rb = find(b);
      if (ra !== rb) parent[rb] = ra;
    };
    const vToTri = new Int32Array(nextId).fill(-1);
    for (let t = 0; t < triCount; t++) {
      for (let j = 0; j < 3; j++) {
        const vk = vertKey[idx.getX(t * 3 + j)];
        if (vToTri[vk] === -1) vToTri[vk] = t;
        else unite(t, vToTri[vk]);
      }
    }

    const islands = new Map();
    for (let t = 0; t < triCount; t++) {
      const r = find(t);
      let list = islands.get(r);
      if (!list) { list = []; islands.set(r, list); }
      list.push(t);
    }

    const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
    const ab = new THREE.Vector3(), ac = new THREE.Vector3(), nrm = new THREE.Vector3();
    const mid = new THREE.Vector3(), ic = new THREE.Vector3();
    const flippedVerts = new Set();
    let meshFlipped = false;

    const isWheelMat = /^(tire|rim|brake)__/i.test(matName);
    const isGlassOrLight = /^(glass|taillight|headlight)__/i.test(matName);

    for (const tris of islands.values()) {
      if (tris.length < 3) continue;
      ic.set(0, 0, 0);
      for (const t of tris) {
        a.fromBufferAttribute(pos, idx.getX(t * 3)).applyMatrix4(o.matrixWorld);
        b.fromBufferAttribute(pos, idx.getX(t * 3 + 1)).applyMatrix4(o.matrixWorld);
        c.fromBufferAttribute(pos, idx.getX(t * 3 + 2)).applyMatrix4(o.matrixWorld);
        ic.add(a).add(b).add(c);
      }
      ic.divideScalar(tris.length * 3);

      let inwardArea = 0;
      let totalArea = 0;
      let signedVol = 0;
      let radialFlux = 0;

      if (isWheelMat) {
        // Group triangles by wheel quadrant (x>0?1:0)+(z>0?2:0) and check each wheel quadrant independently
        const quadTris = [[], [], [], []];
        for (const t of tris) {
          a.fromBufferAttribute(pos, idx.getX(t * 3)).applyMatrix4(o.matrixWorld);
          b.fromBufferAttribute(pos, idx.getX(t * 3 + 1)).applyMatrix4(o.matrixWorld);
          c.fromBufferAttribute(pos, idx.getX(t * 3 + 2)).applyMatrix4(o.matrixWorld);
          mid.copy(a).add(b).add(c).multiplyScalar(1 / 3);
          const q = (mid.x > 0 ? 1 : 0) + (mid.z > 0 ? 2 : 0);
          quadTris[q].push(t);
        }
        for (const qlist of quadTris) {
          if (qlist.length < 4) continue;
          const qCenter = new THREE.Vector3();
          for (const t of qlist) {
            a.fromBufferAttribute(pos, idx.getX(t * 3)).applyMatrix4(o.matrixWorld);
            b.fromBufferAttribute(pos, idx.getX(t * 3 + 1)).applyMatrix4(o.matrixWorld);
            c.fromBufferAttribute(pos, idx.getX(t * 3 + 2)).applyMatrix4(o.matrixWorld);
            qCenter.add(a).add(b).add(c);
          }
          qCenter.divideScalar(qlist.length * 3);
          if (Math.abs(qCenter.x) < 0.4) continue; // skip non-wheel spanning fragments
          const sx = Math.sign(qCenter.x);
          let outerDot = 0, outerArea = 0;
          for (const t of qlist) {
            a.fromBufferAttribute(pos, idx.getX(t * 3)).applyMatrix4(o.matrixWorld);
            b.fromBufferAttribute(pos, idx.getX(t * 3 + 1)).applyMatrix4(o.matrixWorld);
            c.fromBufferAttribute(pos, idx.getX(t * 3 + 2)).applyMatrix4(o.matrixWorld);
            ab.subVectors(b, a); ac.subVectors(c, a); nrm.crossVectors(ab, ac);
            const area = nrm.length();
            if (area < 1e-14) continue;
            mid.copy(a).add(b).add(c).multiplyScalar(1 / 3);
            if ((mid.x - qCenter.x) * sx > 0.025) {
              outerDot += nrm.x * sx;
              outerArea += area;
            }
          }
          if (outerArea > 1e-6 && outerDot < -0.15 * outerArea) {
            meshFlipped = true;
            for (const t of qlist) {
              const i1 = idx.getX(t * 3 + 1), i2 = idx.getX(t * 3 + 2);
              idx.setX(t * 3 + 1, i2); idx.setX(t * 3 + 2, i1);
            }
            totalFlippedTris += qlist.length;
          }
        }
        continue;
      }

      for (const t of tris) {
        a.fromBufferAttribute(pos, idx.getX(t * 3)).applyMatrix4(o.matrixWorld);
        b.fromBufferAttribute(pos, idx.getX(t * 3 + 1)).applyMatrix4(o.matrixWorld);
        c.fromBufferAttribute(pos, idx.getX(t * 3 + 2)).applyMatrix4(o.matrixWorld);
        ab.subVectors(b, a);
        ac.subVectors(c, a);
        nrm.crossVectors(ab, ac);
        const area = nrm.length();
        if (area < 1e-14) continue;
        totalArea += area;
        mid.copy(a).add(b).add(c).multiplyScalar(1 / 3).sub(carCenter);
        const d = nrm.dot(mid);
        radialFlux += d;
        if (d < 0) inwardArea += area;
      }

      if (totalArea < 1e-8) continue;
      const inwardFrac = inwardArea / totalArea;
      const shouldFlip =
        (isGlassOrLight && inwardFrac >= 0.72 && radialFlux < 0) ||
        (!isGlassOrLight && inwardFrac >= 0.72 && radialFlux < 0);

      if (shouldFlip) {
        meshFlipped = true;
        for (const t of tris) {
          const i1 = idx.getX(t * 3 + 1);
          const i2 = idx.getX(t * 3 + 2);
          idx.setX(t * 3 + 1, i2);
          idx.setX(t * 3 + 2, i1);
          flippedVerts.add(idx.getX(t * 3));
          flippedVerts.add(i1);
          flippedVerts.add(i2);
        }
        totalFlippedTris += tris.length;
      }
    }

    if (meshFlipped) {
      idx.needsUpdate = true;
      // Recompute clean creased normals for any mesh with flipped islands
      try {
        o.geometry = toCreasedNormals(geo, (42 * Math.PI) / 180);
      } catch {
        geo.computeVertexNormals();
      }
    }
  });

  return totalFlippedTris;
}

// ---------------------------------------------------------------------------
// Center XZ & ground minY = 0
// ---------------------------------------------------------------------------
function normalizeBounds(root) {
  root.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(root);
  const c = box.getCenter(new THREE.Vector3());
  const dx = -c.x, dy = -box.min.y, dz = -c.z;
  const shift = new THREE.Matrix4().makeTranslation(dx, dy, dz);
  for (const ch of root.children) {
    if (ch.isMesh) {
      ch.geometry.applyMatrix4(shift);
    } else {
      ch.position.x += dx;
      ch.position.y += dy;
      ch.position.z += dz;
    }
  }
  root.updateMatrixWorld(true);
}

// ---------------------------------------------------------------------------
// R8 Precision Reconstruction: smooth doors + side mirrors + dark interior
// ---------------------------------------------------------------------------
function buildGridSurface(gridPts, uCount, vCount, flipWinding = false) {
  const positions = [];
  const uvs = [];
  const indices = [];
  for (let iv = 0; iv < vCount; iv++) {
    for (let iu = 0; iu < uCount; iu++) {
      const p = gridPts[iv * uCount + iu];
      positions.push(p.x, p.y, p.z);
      uvs.push(iu / (uCount - 1), iv / (vCount - 1));
    }
  }
  for (let iv = 0; iv < vCount - 1; iv++) {
    for (let iu = 0; iu < uCount - 1; iu++) {
      const a = iv * uCount + iu;
      const b = a + 1;
      const c = a + uCount;
      const d = c + 1;
      if (!flipWinding) {
        indices.push(a, b, d, a, d, c);
      } else {
        indices.push(a, d, b, a, c, d);
      }
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

function makeRoundedBoxMesh(w, h, d, cx, cy, cz, mat, name) {
  const geo = new THREE.BoxGeometry(w, h, d, 3, 2, 3);
  geo.translate(cx, cy, cz);
  const m = new THREE.Mesh(geo, mat);
  m.name = name;
  return m;
}

function buildR8DoorsAndInterior(root, paintMat, trimMat) {
  // Exact profile control points sampled directly from Node_0's front fender (Z~0.79)
  // and rear sideblade/quarter boundary (Z~-0.37..-0.41) at 0.00027m precision.
  const frontCurve = (v) => {
    // v in [0..1] maps y from 0.168 to 0.788
    const pts = [
      [0.892, 0.168, 0.790],
      [0.908, 0.240, 0.805],
      [0.916, 0.340, 0.805],
      [0.916, 0.460, 0.808],
      [0.912, 0.572, 0.816],
      [0.893, 0.653, 0.815],
      [0.868, 0.727, 0.816],
      [0.774, 0.788, 0.798],
    ];
    const f = v * (pts.length - 1);
    const i = Math.min(pts.length - 2, Math.floor(f));
    const t = f - i;
    return new THREE.Vector3(
      pts[i][0] + (pts[i + 1][0] - pts[i][0]) * t,
      pts[i][1] + (pts[i + 1][1] - pts[i][1]) * t,
      pts[i][2] + (pts[i + 1][2] - pts[i][2]) * t,
    );
  };

  const rearCurve = (v) => {
    const pts = [
      [0.917, 0.172, -0.328],
      [0.931, 0.245, -0.346],
      [0.890, 0.345, -0.368],
      [0.892, 0.450, -0.398],
      [0.886, 0.560, -0.402],
      [0.898, 0.660, -0.406],
      [0.865, 0.735, -0.398],
      [0.738, 0.822, -0.377],
    ];
    const f = v * (pts.length - 1);
    const i = Math.min(pts.length - 2, Math.floor(f));
    const t = f - i;
    return new THREE.Vector3(
      pts[i][0] + (pts[i + 1][0] - pts[i][0]) * t,
      pts[i][1] + (pts[i + 1][1] - pts[i][1]) * t,
      pts[i][2] + (pts[i + 1][2] - pts[i][2]) * t,
    );
  };

  const buildDoor = (sideSign, name) => {
    // sideSign = +1 (+X, door_fl in glTF before PI yaw -> -X in driver space), -1 (-X, door_fr)
    const hingeWorld = new THREE.Vector3(sideSign * 0.89, 0.48, 0.79);
    const doorGroup = new THREE.Group();
    doorGroup.name = name;
    doorGroup.position.copy(hingeWorld);

    const uN = 22, vN = 16;
    const outerPts = [];
    const innerPts = [];
    for (let iv = 0; iv < vN; iv++) {
      const v = iv / (vN - 1);
      const pf = frontCurve(v);
      const pr = rearCurve(v);
      for (let iu = 0; iu < uN; iu++) {
        const u = iu / (uN - 1); // 0 = front, 1 = rear
        // Smooth interpolation with Audi R8 waist bulge & lower intake tuck
        const xBase = pf.x * (1 - u) + pr.x * u;
        const yBase = pf.y * (1 - u) + pr.y * u;
        const zBase = pf.z * (1 - u) + pr.z * u;
        // Subtle convex door skin crown + shoulder crease around v=0.72
        const midArc = Math.sin(u * Math.PI);
        const shoulderCrease = Math.exp(-Math.pow((v - 0.72) / 0.12, 2)) * 0.012;
        const intakeScoop = Math.exp(-Math.pow((v - 0.38) / 0.22, 2)) * Math.pow(u, 1.5) * 0.022;
        const xSurf = xBase + midArc * 0.014 + shoulderCrease - intakeScoop;

        const ptOut = new THREE.Vector3(sideSign * xSurf, yBase, zBase).sub(hingeWorld);
        const ptIn = new THREE.Vector3(sideSign * (xSurf - 0.032), yBase, zBase).sub(hingeWorld);
        outerPts.push(ptOut);
        innerPts.push(ptIn);
      }
    }

    // For +X outer surface: u increases -Z, v increases +Y => (+u x +v) = (-Z x +Y) = +X!
    // Wait: (-Z) x (+Y) = (-1*1 - 0, ...) = (-1, 0, 0) = -X!
    // So to get +X outward on sideSign=+1, we pass flipWinding = (sideSign > 0)
    const skinGeo = buildGridSurface(outerPts, uN, vN, sideSign < 0);
    const skinMesh = new THREE.Mesh(skinGeo, paintMat);
    skinMesh.name = `${name}_skin`;
    doorGroup.add(skinMesh);

    const innerGeo = buildGridSurface(innerPts, uN, vN, sideSign > 0);
    const innerMesh = new THREE.Mesh(innerGeo, trimMat);
    innerMesh.name = `${name}_card`;
    doorGroup.add(innerMesh);

    // Side mirror stalk + aerodynamic mirror housing + paint cap
    const mirrorWorld = new THREE.Vector3(sideSign * 0.915, 0.825, 0.675);
    const mLocal = mirrorWorld.clone().sub(hingeWorld);
    const stalk = makeRoundedBoxMesh(0.06, 0.035, 0.055, mLocal.x + sideSign * 0.02, mLocal.y, mLocal.z, trimMat, `${name}_mirror_stalk`);
    const bezel = makeRoundedBoxMesh(0.11, 0.075, 0.085, mLocal.x + sideSign * 0.085, mLocal.y + 0.025, mLocal.z - 0.015, trimMat, `${name}_mirror_bezel`);
    const cap = makeRoundedBoxMesh(0.115, 0.082, 0.068, mLocal.x + sideSign * 0.088, mLocal.y + 0.028, mLocal.z + 0.002, paintMat, `${name}_mirror_cap`);
    doorGroup.add(stalk, bezel, cap);

    // Flush door handle
    const handlePos = new THREE.Vector3(sideSign * 0.905, 0.655, -0.18).sub(hingeWorld);
    const handle = makeRoundedBoxMesh(0.026, 0.028, 0.16, handlePos.x, handlePos.y, handlePos.z, paintMat, `${name}_handle`);
    doorGroup.add(handle);

    root.add(doorGroup);
  };

  buildDoor(+1, "door_fl");
  buildDoor(-1, "door_fr");

  // Clean recessed dark R8 sport cabin (strictly inside |X| <= 0.64, Y <= 0.90)
  const interior = new THREE.Group();
  interior.name = "r8_interior";
  interior.add(
    makeRoundedBoxMesh(1.24, 0.06, 1.35, 0, 0.24, 0.10, trimMat, "r8_floor"),
    makeRoundedBoxMesh(0.24, 0.26, 1.20, 0, 0.38, 0.15, trimMat, "r8_console"),
    makeRoundedBoxMesh(1.22, 0.24, 0.34, 0, 0.68, 0.56, trimMat, "r8_dashboard"),
    makeRoundedBoxMesh(0.38, 0.12, 0.44, 0.34, 0.34, -0.02, trimMat, "r8_seat_l_base"),
    makeRoundedBoxMesh(0.36, 0.48, 0.12, 0.34, 0.60, -0.22, trimMat, "r8_seat_l_back"),
    makeRoundedBoxMesh(0.38, 0.12, 0.44, -0.34, 0.34, -0.02, trimMat, "r8_seat_r_base"),
    makeRoundedBoxMesh(0.36, 0.48, 0.12, -0.34, 0.60, -0.22, trimMat, "r8_seat_r_back"),
    makeRoundedBoxMesh(1.18, 0.05, 0.50, 0, 0.55, -0.50, trimMat, "r8_bulkhead"),
  );
  // Steering wheel ring on driver side
  const swGeo = new THREE.TorusGeometry(0.145, 0.018, 10, 24);
  swGeo.rotateX(0.32);
  swGeo.translate(0.34, 0.72, 0.36);
  const sw = new THREE.Mesh(swGeo, trimMat);
  sw.name = "r8_steering_wheel";
  interior.add(sw);

  root.add(interior);
}

// ---------------------------------------------------------------------------
// Sculpted Range Rover Autobiography replacement (replaces crude 8-bit box)
// ---------------------------------------------------------------------------
function buildSculptedRangeRover() {
  const root = new THREE.Group();
  root.name = "rangerover_clean";

  const paintMat = new THREE.MeshStandardMaterial({ name: "paint__RangeRover", color: 0x76808c, metalness: 0.48, roughness: 0.22 });
  const trimMat = new THREE.MeshStandardMaterial({ name: "trim__RangeRover", color: 0x16191e, metalness: 0.15, roughness: 0.55 });
  const chromeMat = new THREE.MeshStandardMaterial({ name: "chrome__RangeRover", color: 0xd0d7e0, metalness: 0.95, roughness: 0.10 });
  const glassMat = new THREE.MeshStandardMaterial({ name: "glass__RangeRover", color: 0x0a111a, metalness: 0.15, roughness: 0.05, transparent: true, opacity: 0.78 });
  const headMat = new THREE.MeshStandardMaterial({ name: "headlight__RangeRover", color: 0xf4f8ff, emissive: 0xdde8ff, emissiveIntensity: 0.8 });
  const tailMat = new THREE.MeshStandardMaterial({ name: "taillight__RangeRover", color: 0xb8141a, emissive: 0xc81414, emissiveIntensity: 0.7 });
  const tireMat = new THREE.MeshStandardMaterial({ name: "tire__RangeRover", color: 0x181a1f, metalness: 0.02, roughness: 0.88 });
  const rimMat = new THREE.MeshStandardMaterial({ name: "rim__RangeRover", color: 0xc2c8d0, metalness: 0.88, roughness: 0.18 });

  // Sculpted Range Rover body via smooth profile lofting along Z (-2.42 rear .. +2.42 front)
  // Cross-section stations: [z, halfWidthBot, halfWidthBelt, halfWidthRoof, yBot, yBelt, yRoof]
  const stations = [
    [-2.42, 0.86, 0.88, 0.72, 0.34, 1.06, 1.08],
    [-2.30, 0.98, 1.01, 0.74, 0.30, 1.12, 1.56],
    [-1.95, 1.04, 1.05, 0.75, 0.28, 1.14, 1.72],
    [-1.40, 1.06, 1.06, 0.76, 0.28, 1.13, 1.77],
    [-0.45, 1.06, 1.05, 0.76, 0.27, 1.12, 1.78],
    [ 0.48, 1.06, 1.05, 0.75, 0.27, 1.11, 1.76],
    [ 0.98, 1.05, 1.03, 0.82, 0.28, 1.10, 1.32],
    [ 1.35, 1.05, 1.03, 0.88, 0.28, 1.06, 1.10],
    [ 2.05, 1.02, 0.99, 0.86, 0.29, 0.99, 1.04],
    [ 2.38, 0.93, 0.91, 0.78, 0.31, 0.91, 0.96],
    [ 2.45, 0.82, 0.80, 0.68, 0.36, 0.84, 0.89],
  ];

  // Interpolate smooth Z profile at higher resolution
  const zN = 32;
  const ringN = 20; // around half-perimeter from bottom-center -> outer side -> roof center -> mirrored
  const interpStation = (t) => {
    const f = t * (stations.length - 1);
    const i = Math.min(stations.length - 2, Math.floor(f));
    const a = f - i;
    const s = a * a * (3 - 2 * a);
    return stations[i].map((v, k) => v + (stations[i + 1][k] - v) * s);
  };

  // Build lower body shell (from rocker -> beltline -> hood/decklid/roof perimeter)
  const buildLoft = (name, mat, profileFn, uSteps = 32, vSteps = 18) => {
    const pts = [];
    for (let iu = 0; iu < uSteps; iu++) {
      const u = iu / (uSteps - 1);
      const st = interpStation(u);
      for (let iv = 0; iv < vSteps; iv++) {
        const v = iv / (vSteps - 1);
        pts.push(profileFn(st, u, v));
      }
    }
    // Transpose into vSteps x uSteps grid
    const grid = [];
    for (let iv = 0; iv < vSteps; iv++) {
      for (let iu = 0; iu < uSteps; iu++) {
        grid.push(pts[iu * vSteps + iv]);
      }
    }
    const geo = buildGridSurface(grid, uSteps, vSteps, true);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = name;
    return mesh;
  };

  // Full closed-loop outer hull (v from 0 = bottom-right -> +X side -> roof -> -X side -> bottom-left)
  const hullProfile = (st, _u, v) => {
    const [, wb, wm, wr, yb, ym, yr] = st;
    // Carve wheel arch recesses near z = +1.50 (front) and z = -1.48 (rear)
    const z = st[0];
    const dFront = Math.abs(z - 1.50);
    const dRear = Math.abs(z + 1.48);
    const archR = 0.45;
    let archLift = 0;
    if (dFront < archR) archLift = Math.max(archLift, Math.sqrt(Math.max(0, archR * archR - dFront * dFront)) * 0.92);
    if (dRear < archR) archLift = Math.max(archLift, Math.sqrt(Math.max(0, archR * archR - dRear * dRear)) * 0.92);

    // Map v in [0..1] around cross section:
    // 0.00..0.12: bottom right (x: 0 -> wb)
    // 0.12..0.34: right body side (yb+archLift -> ym)
    // 0.34..0.44: right greenhouse (ym -> yr, x: wm -> wr)
    // 0.44..0.56: roof crown (x: wr -> -wr)
    // 0.56..0.66: left greenhouse
    // 0.66..0.88: left body side
    // 0.88..1.00: bottom left
    const yFloor = yb + archLift * 0.72;
    if (v < 0.12) {
      const t = v / 0.12;
      return new THREE.Vector3(t * (wb - 0.05), yFloor, z);
    } else if (v < 0.35) {
      const t = (v - 0.12) / 0.23;
      const flare = Math.sin(t * Math.PI) * 0.04;
      const x = wb * (1 - t) + wm * t + flare;
      const y = yFloor + (ym - yFloor) * t;
      return new THREE.Vector3(x, y, z);
    } else if (v < 0.44) {
      const t = (v - 0.35) / 0.09;
      const x = wm * (1 - t) + wr * t;
      const y = ym + (yr - ym) * Math.sin(t * Math.PI * 0.5);
      return new THREE.Vector3(x, y, z);
    } else if (v < 0.56) {
      const t = (v - 0.44) / 0.12;
      const x = wr * (1 - 2 * t);
      const crown = Math.cos((t - 0.5) * Math.PI) * 0.025;
      return new THREE.Vector3(x, yr + crown, z);
    } else if (v < 0.65) {
      const t = (v - 0.56) / 0.09;
      const x = -wr * (1 - t) - wm * t;
      const y = yr - (yr - ym) * (1 - Math.cos(t * Math.PI * 0.5));
      return new THREE.Vector3(x, y, z);
    } else if (v < 0.88) {
      const t = (v - 0.65) / 0.23;
      const flare = Math.sin(t * Math.PI) * 0.04;
      const x = -wm * (1 - t) - wb * t - flare;
      const y = ym - (ym - yFloor) * t;
      return new THREE.Vector3(x, y, z);
    } else {
      const t = (v - 0.88) / 0.12;
      return new THREE.Vector3(-(wb - 0.05) * (1 - t), yFloor, z);
    }
  };

  root.add(buildLoft("rr_body_hull", paintMat, hullProfile, zN, 29));

  // Front & rear endcaps + sculpted bumpers
  root.add(
    makeRoundedBoxMesh(1.94, 0.34, 0.16, 0, 0.44, 2.38, trimMat, "rr_front_bumper"),
    makeRoundedBoxMesh(1.96, 0.32, 0.16, 0, 0.44, -2.38, trimMat, "rr_rear_bumper"),
    makeRoundedBoxMesh(1.22, 0.24, 0.06, 0, 0.77, 2.42, chromeMat, "rr_grille"),
    makeRoundedBoxMesh(1.16, 0.20, 0.07, 0, 0.77, 2.425, trimMat, "rr_grille_mesh"),
    // Headlights & Taillights
    makeRoundedBoxMesh(0.32, 0.13, 0.10, 0.74, 0.80, 2.38, headMat, "rr_hl_l"),
    makeRoundedBoxMesh(0.32, 0.13, 0.10, -0.74, 0.80, 2.38, headMat, "rr_hl_r"),
    makeRoundedBoxMesh(0.24, 0.26, 0.10, 0.84, 0.94, -2.37, tailMat, "rr_tl_l"),
    makeRoundedBoxMesh(0.24, 0.26, 0.10, -0.84, 0.94, -2.37, tailMat, "rr_tl_r"),
    // Flush tinted windshield, rear glass, and side greenhouse strips
    (() => {
      const g = new THREE.BoxGeometry(1.56, 0.56, 0.04, 4, 2, 1);
      g.rotateX(-0.76);
      g.translate(0, 1.44, 1.08);
      const m = new THREE.Mesh(g, glassMat);
      m.name = "rr_windshield";
      return m;
    })(),
    (() => {
      const g = new THREE.BoxGeometry(1.52, 0.48, 0.04, 4, 2, 1);
      g.rotateX(0.42);
      g.translate(0, 1.44, -2.14);
      const m = new THREE.Mesh(g, glassMat);
      m.name = "rr_rear_glass";
      return m;
    })(),
    // Flush wrap-around tinted side glass bands (sits cleanly outside recessed upper hull taper)
    (() => {
      const g = new THREE.BoxGeometry(2.04, 0.45, 2.72, 2, 2, 6);
      const pos = g.getAttribute("position");
      for (let i = 0; i < pos.count; i++) {
        const y = pos.getY(i);
        const z = pos.getZ(i);
        const taperY = y > 0 ? 0.775 : 0.995;
        const taperZ = z < -1.1 ? 0.96 : 1.0;
        pos.setX(i, pos.getX(i) * taperY * taperZ);
      }
      g.computeVertexNormals();
      g.translate(0, 1.41, -0.66);
      const m = new THREE.Mesh(g, glassMat);
      m.name = "rr_side_greenhouse";
      return m;
    })(),
    // Gloss-black A/B/C/D pillars (Range Rover floating-roof signature)
    (() => {
      const mkPillar = (zCenter, zLen, name) => {
        const g = new THREE.BoxGeometry(2.07, 0.47, zLen, 2, 2, 2);
        const pos = g.getAttribute("position");
        for (let i = 0; i < pos.count; i++) {
          const y = pos.getY(i);
          pos.setX(i, pos.getX(i) * (y > 0 ? 0.77 : 0.99));
        }
        g.computeVertexNormals();
        g.translate(0, 1.41, zCenter);
        const m = new THREE.Mesh(g, trimMat);
        m.name = name;
        return m;
      };
      const grp = new THREE.Group();
      grp.name = "rr_pillars";
      grp.add(
        mkPillar(0.62, 0.13, "rr_pillar_a"),
        mkPillar(-0.12, 0.14, "rr_pillar_b"),
        mkPillar(-1.05, 0.15, "rr_pillar_c"),
        mkPillar(-1.98, 0.24, "rr_pillar_d"),
      );
      return grp;
    })(),
    makeRoundedBoxMesh(1.60, 0.08, 2.86, 0, 1.74, -0.68, paintMat, "rr_roof_cap"),
    makeRoundedBoxMesh(1.86, 0.54, 0.10, 0, 0.78, -2.40, paintMat, "rr_tailgate"),
    // Dark wheel-well inner liners
    makeRoundedBoxMesh(1.76, 0.58, 0.82, 0, 0.56, 1.50, trimMat, "rr_arch_front"),
    makeRoundedBoxMesh(1.76, 0.58, 0.82, 0, 0.56, -1.48, trimMat, "rr_arch_rear"),
    // Roof rails & side mirrors
    makeRoundedBoxMesh(0.05, 0.04, 2.40, 0.68, 1.80, -0.65, trimMat, "rr_rail_l"),
    makeRoundedBoxMesh(0.05, 0.04, 2.40, -0.68, 1.80, -0.65, trimMat, "rr_rail_r"),
    makeRoundedBoxMesh(0.13, 0.10, 0.11, 1.07, 1.14, 0.62, paintMat, "rr_mirror_l"),
    makeRoundedBoxMesh(0.13, 0.10, 0.11, -1.07, 1.14, 0.62, paintMat, "rr_mirror_r"),
  );

  // Subtle hinged door_fl / door_fr / door_rl / door_rr outer flush trims so setDoorsOpen works cleanly
  const addDoorHandle = (name, x, y, z) => {
    const grp = new THREE.Group();
    grp.name = name;
    grp.position.set(x, y, z + 0.45);
    const h = makeRoundedBoxMesh(0.04, 0.035, 0.16, x > 0 ? 0.02 : -0.02, 0.02, -0.45, chromeMat, `${name}_handle`);
    grp.add(h);
    root.add(grp);
  };
  addDoorHandle("door_fl", 1.05, 0.98, 0.25);
  addDoorHandle("door_fr", -1.05, 0.98, 0.25);
  addDoorHandle("door_rl", 1.05, 0.98, -0.70);
  addDoorHandle("door_rr", -1.05, 0.98, -0.70);

  // 4 high-res multi-spoke luxury SUV wheels (minY = 0)
  const wheelCoords = [
    ["fl", 0.94, 0.42, 1.50],
    ["fr", -0.94, 0.42, 1.50],
    ["rl", 0.94, 0.42, -1.48],
    ["rr", -0.94, 0.42, -1.48],
  ];
  for (const [k, wx, wy, wz] of wheelCoords) {
    const tireGeo = new THREE.CylinderGeometry(0.42, 0.42, 0.29, 32, 1, false);
    tireGeo.rotateZ(Math.PI / 2);
    tireGeo.translate(wx, wy, wz);
    const tireMesh = new THREE.Mesh(tireGeo, tireMat);
    tireMesh.name = `wheel_${k}`;
    root.add(tireMesh);

    const rimGeo = new THREE.CylinderGeometry(0.28, 0.28, 0.30, 24, 1, false);
    rimGeo.rotateZ(Math.PI / 2);
    rimGeo.translate(wx, wy, wz);
    const rimMesh = new THREE.Mesh(rimGeo, rimMat);
    rimMesh.name = `wheel_${k}_rim`;
    root.add(rimMesh);

    // 5-spoke star overlay on outer wheel face
    const sign = Math.sign(wx);
    for (let s = 0; s < 5; s++) {
      const ang = (s / 5) * Math.PI * 2;
      const sg = new THREE.BoxGeometry(0.02, 0.26, 0.04);
      sg.rotateX(ang);
      sg.translate(wx + sign * 0.148, wy, wz);
      const sm = new THREE.Mesh(sg, rimMat);
      sm.name = `wheel_${k}_spoke_${s}`;
      root.add(sm);
    }
  }

  return root;
}

// ---------------------------------------------------------------------------
// Main repair pipeline
// ---------------------------------------------------------------------------
const TARGET_CARS = [
  "r8",
  "challenger",
  "ferrari",
  "audi",
  "mustang",
  "golf",
  "mercedes",
  "sedan",
  "offroad",
  "rangerover",
];

for (const id of TARGET_CARS) {
  const filePath = path.join(MODELS_DIR, `${id}.glb`);
  console.log(`\n=== Repairing ${id}.glb ===`);

  if (id === "rangerover") {
    const rrRoot = buildSculptedRangeRover();
    normalizeBounds(rrRoot);
    saveAndPackGlb(rrRoot, [], filePath, true);
    console.log("  rebuilt sculpted Range Rover");
    continue;
  }

  const { gltf, raw } = await loadCarGlb(filePath);
  const scene = gltf.scene;

  if (id === "r8") {
    // 1) Remove the 25 coarse 0.27m-quantized nodes outside Node_0
    for (const ch of [...scene.children]) {
      if (ch.name !== "Node_0") scene.remove(ch);
    }
  }

  if (id === "sedan" || id === "offroad") {
    const wPos =
      id === "sedan"
        ? { FL: [0.74, -0.22, 1.354], FR: [-0.739, -0.22, 1.354], RL: [0.74, -0.22, -1.236], RR: [-0.739, -0.22, -1.236] }
        : { FL: [0.784, -0.24, 1.429], FR: [-0.784, -0.24, 1.429], RL: [0.784, -0.24, -1.191], RR: [-0.784, -0.24, -1.191] };
    for (const [k, pos] of Object.entries(wPos)) {
      const tire = scene.getObjectByName(`tire_${k}`);
      if (tire) tire.position.set(pos[0], pos[1], pos[2]);
      const cal = scene.getObjectByName(`caliper_${k}`);
      if (cal) cal.position.set(pos[0], pos[1], pos[2]);
    }
  }

  if (id === "ferrari") {
    // Fix 13.5 deg yaw skew & remove floating plate mesh
    scene.rotation.y += (13.5 * Math.PI) / 180;
    scene.traverse((o) => {
      if (o.isMesh && (o.material?.name || "").startsWith("plate__")) {
        o.visible = false;
      }
      if (o.isMesh && (o.material?.name || "").startsWith("tire__")) {
        o.material.color.setRGB(0.14, 0.14, 0.15);
      }
    });
  }

  if (id === "mercedes") {
    scene.traverse((o) => {
      if (!o.isMesh) return;
      const mn = o.material?.name || "";
      if (mn.startsWith("taillight__")) {
        o.material.color.setRGB(0.62, 0.04, 0.04);
        o.material.emissive.setRGB(0.65, 0.05, 0.05);
      } else if (mn.startsWith("paint__")) {
        // Subtle obsidian sheen so body lines aren't flat #000000
        if (o.material.color.r < 0.02 && o.material.color.g < 0.02 && o.material.color.b < 0.02) {
          o.material.color.setRGB(0.045, 0.05, 0.06);
        }
      }
    });
  }

  // Bake world transforms into meters (scale = 1.0 everywhere) preserving named door/wheel pivots
  const cleanRoot = bakeTransformsPreservingPivots(scene);
  normalizeBounds(cleanRoot);

  if (id === "golf") {
    // Straighten the exported toe-out on Golf's front wheels (-10.89° FL, -12.7° FR)
    // In Golf raw coordinates (before ORIENTATION.golf = 0), front is -Z (or check bounds):
    cleanRoot.updateMatrixWorld(true);
    const frontTireLeftPts = [], frontTireRightPts = [];
    const tmp = new THREE.Vector3();
    cleanRoot.traverse((o) => {
      if (!o.isMesh || !(o.material?.name || "").startsWith("tire__")) return;
      const pos = o.geometry.getAttribute("position");
      for (let i = 0; i < pos.count; i++) {
        tmp.fromBufferAttribute(pos, i);
        if (tmp.y > 0.85 || Math.abs(tmp.x) < 0.3 || Math.abs(tmp.z) < 0.4) continue;
        if (tmp.z < 0) (tmp.x < 0 ? frontTireLeftPts : frontTireRightPts).push(tmp.clone());
      }
    });
    const centerOf = (pts) => {
      const b = new THREE.Box3();
      for (const p of pts) b.expandByPoint(p);
      return b.getCenter(new THREE.Vector3());
    };
    const cFL = centerOf(frontTireLeftPts);
    const cFR = centerOf(frontTireRightPts);
    const rotFL = -(10.89 * Math.PI) / 180;
    const rotFR = -(12.70 * Math.PI) / 180;
    // Rotate only vertices belonging to front-left or front-right wheel assemblies
    cleanRoot.traverse((o) => {
      if (!o.isMesh) return;
      const mn = o.material?.name || "";
      if (!/^(tire__New-Tyre|rim__Alloys|brake__Brake-discs|other__Wheel-nuts)$/.test(mn)) return;
      const pos = o.geometry.getAttribute("position");
      const norm = o.geometry.getAttribute("normal");
      for (let i = 0; i < pos.count; i++) {
        const vx = pos.getX(i), vy = pos.getY(i), vz = pos.getZ(i);
        if (vz >= -0.4 || vy > 0.85 || Math.abs(vx) < 0.3) continue;
        const c = vx < 0 ? cFL : cFR;
        const ang = vx < 0 ? rotFL : rotFR;
        const cos = Math.cos(ang), sin = Math.sin(ang);
        const dx = vx - c.x, dz = vz - c.z;
        pos.setXYZ(i, c.x + dx * cos + dz * sin, vy, c.z - dx * sin + dz * cos);
        if (norm) {
          const nx = norm.getX(i), ny = norm.getY(i), nz = norm.getZ(i);
          norm.setXYZ(i, nx * cos + nz * sin, ny, -nx * sin + nz * cos);
        }
      }
      pos.needsUpdate = true;
      if (norm) norm.needsUpdate = true;
    });
    console.log("  straightened Golf front wheels");
  }

  // Fix inverted surface islands (wheels, glass, taillights, bumpers, exterior paint)
  const flipped = fixInvertedIslands(cleanRoot);
  console.log(`  flipped ${flipped} inverted triangles across surface islands`);

  if (id === "r8") {
    // Reconstruct seamless curved R8 doors + mirrors + dark cabin interior
    let paintMat = null, trimMat = null;
    cleanRoot.traverse((o) => {
      if (!o.isMesh) return;
      if (!paintMat && o.material?.name === "paint__r8") paintMat = o.material;
      if (!trimMat && o.material?.name === "trim__r8") trimMat = o.material;
    });
    if (!paintMat) paintMat = new THREE.MeshStandardMaterial({ name: "paint__r8", color: 0xb8bec6, metalness: 0.45, roughness: 0.22 });
    if (!trimMat) trimMat = new THREE.MeshStandardMaterial({ name: "trim__r8", color: 0x16181d, metalness: 0.15, roughness: 0.55 });
    buildR8DoorsAndInterior(cleanRoot, paintMat, trimMat);
    console.log("  rebuilt R8 curved doors, mirrors & dark cabin interior");
  }

  normalizeBounds(cleanRoot);
  saveAndPackGlb(cleanRoot, raw.images, filePath, true);
  const szMb = (fs.statSync(filePath).size / (1024 * 1024)).toFixed(2);
  console.log(`  wrote ${id}.glb (${szMb} MB)`);
}
