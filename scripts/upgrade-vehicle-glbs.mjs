import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";

globalThis.self = globalThis;
globalThis.createImageBitmap = async () => ({ width: 1, height: 1, close() {} });

const require = createRequire(import.meta.url);
const THREE = await import("three");
const { GLTFLoader } = await import("three/examples/jsm/loaders/GLTFLoader.js");
const { MeshoptDecoder } = await import("three/examples/jsm/libs/meshopt_decoder.module.js");
const { mergeVertices, toCreasedNormals } = await import("three/examples/jsm/utils/BufferGeometryUtils.js");

await MeshoptDecoder.ready;

const MODELS_DIR = path.resolve("public/models");
const GLTFPACK_BIN = path.resolve("node_modules/.bin/gltfpack");

// Load local Draco WASM decoder for semi.glb / kraz.glb
const dracoCode = fs.readFileSync(path.resolve("public/draco/draco_decoder.js"), "utf8");
const DracoDecoderModule = new Function("require", "__dirname", dracoCode + "; return DracoDecoderModule;")(
  require,
  path.resolve("public/draco"),
);
const dracoWasmBinary = fs.readFileSync(path.resolve("public/draco/draco_decoder.wasm"));
const dracoMod = await new Promise((resolve) =>
  DracoDecoderModule({ wasmBinary: dracoWasmBinary, onModuleLoaded: resolve }),
);

// Minimal Node-compatible DRACOLoader wrapper for GLTFLoader
const TYPED_MAP = { Float32Array, Uint32Array, Uint16Array, Uint8Array, Int16Array, Int8Array };
class NodeDracoLoader {
  preload() {}
  dispose() {}
  decodeDracoFile(buffer, callback, attributeIDs, attributeTypes, _vertexColorSpace, onError) {
    try {
      const decoder = new dracoMod.Decoder();
      const dracoBuf = new dracoMod.DecoderBuffer();
      dracoBuf.Init(new Int8Array(buffer), buffer.byteLength);
      const geomType = decoder.GetEncodedGeometryType(dracoBuf);
      let dracoGeom;
      let status;
      if (geomType === dracoMod.TRIANGULAR_MESH) {
        dracoGeom = new dracoMod.Mesh();
        status = decoder.DecodeBufferToMesh(dracoBuf, dracoGeom);
      } else {
        dracoGeom = new dracoMod.PointCloud();
        status = decoder.DecodeBufferToPointCloud(dracoBuf, dracoGeom);
      }
      if (!status.ok() || dracoGeom.ptr === 0) {
        throw new Error("Draco decoding failed: " + status.error_msg());
      }
      const geometry = new THREE.BufferGeometry();
      const numPoints = dracoGeom.num_points();
      for (const attrName in attributeIDs) {
        const typeKey = attributeTypes[attrName];
        const AttrType = (typeof typeKey === "string" ? TYPED_MAP[typeKey] : typeKey) || Float32Array;
        const attrId = attributeIDs[attrName];
        const attr = decoder.GetAttributeByUniqueId(dracoGeom, attrId);
        if (!attr) continue;
        const numComp = attr.num_components();
        const numVals = numPoints * numComp;
        const arr = new AttrType(numVals);
        let da;
        if (AttrType === Float32Array) {
          da = new dracoMod.DracoFloat32Array();
          decoder.GetAttributeFloatForAllPoints(dracoGeom, attr, da);
        } else if (AttrType === Uint32Array) {
          da = new dracoMod.DracoUInt32Array();
          decoder.GetAttributeUInt32ForAllPoints(dracoGeom, attr, da);
        } else if (AttrType === Uint16Array) {
          da = new dracoMod.DracoUInt16Array();
          decoder.GetAttributeUInt16ForAllPoints(dracoGeom, attr, da);
        } else if (AttrType === Uint8Array) {
          da = new dracoMod.DracoUInt8Array();
          decoder.GetAttributeUInt8ForAllPoints(dracoGeom, attr, da);
        } else if (AttrType === Int16Array) {
          da = new dracoMod.DracoInt16Array();
          decoder.GetAttributeInt16ForAllPoints(dracoGeom, attr, da);
        } else if (AttrType === Int8Array) {
          da = new dracoMod.DracoInt8Array();
          decoder.GetAttributeInt8ForAllPoints(dracoGeom, attr, da);
        } else {
          da = new dracoMod.DracoFloat32Array();
          decoder.GetAttributeFloatForAllPoints(dracoGeom, attr, da);
        }
        for (let i = 0; i < numVals; i++) arr[i] = da.GetValue(i);
        dracoMod.destroy(da);
        geometry.setAttribute(attrName, new THREE.BufferAttribute(arr, numComp));
      }
      if (geomType === dracoMod.TRIANGULAR_MESH) {
        const numFaces = dracoGeom.num_faces();
        const numIndices = numFaces * 3;
        const ia = new dracoMod.DracoInt32Array();
        const indices = new (numPoints > 65535 ? Uint32Array : Uint16Array)(numIndices);
        for (let i = 0; i < numFaces; i++) {
          decoder.GetFaceFromMesh(dracoGeom, i, ia);
          const off = i * 3;
          indices[off] = ia.GetValue(0);
          indices[off + 1] = ia.GetValue(1);
          indices[off + 2] = ia.GetValue(2);
        }
        dracoMod.destroy(ia);
        geometry.setIndex(new THREE.BufferAttribute(indices, 1));
      }
      dracoMod.destroy(dracoGeom);
      dracoMod.destroy(dracoBuf);
      dracoMod.destroy(decoder);
      callback(geometry);
    } catch (e) {
      onError?.(e);
    }
  }
}

// ---------------------------------------------------------------------------
// Raw GLB asset extractor & serializer (Float32 geometry + lossless raw images)
// ---------------------------------------------------------------------------
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

async function loadCarGlb(filePath) {
  const buf = fs.readFileSync(filePath);
  const raw = extractRawGlbAssets(buf);
  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);
  loader.setDRACOLoader(new NodeDracoLoader());
  const gltf = await loader.parseAsync(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), "");
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
    return rem === 0 ? buf : Buffer.concat([buf, Buffer.alloc(4 - rem, 0)]);
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
    asset: { version: "2.0", generator: "westgate-vehicle-upgrade-v2" },
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

function saveAndPackGlb(root, rawImages, outPath) {
  const tmpRaw = outPath + ".tmp.glb";
  fs.writeFileSync(tmpRaw, serializeGlb(root, rawImages));
  execFileSync(GLTFPACK_BIN, ["-i", tmpRaw, "-o", outPath, "-cc", "-vp", "16", "-kn", "-km"], { stdio: "inherit" });
  fs.unlinkSync(tmpRaw);
}

// ---------------------------------------------------------------------------
// Geometry & triangle-splitting helpers
// ---------------------------------------------------------------------------
function splitMeshTriangles(mesh, predicate, matFalse, matTrue, nameFalse, nameTrue) {
  const geo = mesh.geometry;
  const pos = geo.getAttribute("position");
  const idx = geo.index;
  if (!pos || !idx) return null;
  const falseIdx = [];
  const trueIdx = [];
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  const triCtr = new THREE.Vector3();
  for (let i = 0; i + 2 < idx.count; i += 3) {
    const i0 = idx.getX(i), i1 = idx.getX(i + 1), i2 = idx.getX(i + 2);
    a.fromBufferAttribute(pos, i0).applyMatrix4(mesh.matrixWorld);
    b.fromBufferAttribute(pos, i1).applyMatrix4(mesh.matrixWorld);
    c.fromBufferAttribute(pos, i2).applyMatrix4(mesh.matrixWorld);
    triCtr.copy(a).add(b).add(c).multiplyScalar(1 / 3);
    if (predicate(triCtr, a, b, c)) trueIdx.push(i0, i1, i2);
    else falseIdx.push(i0, i1, i2);
  }
  if (!trueIdx.length || !falseIdx.length) {
    if (trueIdx.length && !falseIdx.length) {
      mesh.material = matTrue;
      if (nameTrue) mesh.name = nameTrue;
    }
    return null;
  }

  const cloneWithIndices = (indices, mat, name) => {
    // Compact geometry vertices using getX/Y/Z/W so InterleavedBufferAttributes & normalized ints unpack cleanly
    const used = new Map();
    const compactIdx = new Uint32Array(indices.length);
    for (let i = 0; i < indices.length; i++) {
      const oldI = indices[i];
      let newI = used.get(oldI);
      if (newI === undefined) {
        newI = used.size;
        used.set(oldI, newI);
      }
      compactIdx[i] = newI;
    }
    const newG = new THREE.BufferGeometry();
    for (const k of Object.keys(geo.attributes)) {
      const src = geo.getAttribute(k);
      const is = src.itemSize;
      const arr = new Float32Array(used.size * is);
      for (const [oldI, newI] of used.entries()) {
        const base = newI * is;
        if (is >= 1) arr[base] = src.getX(oldI);
        if (is >= 2) arr[base + 1] = src.getY(oldI);
        if (is >= 3) arr[base + 2] = src.getZ(oldI);
        if (is >= 4) arr[base + 3] = src.getW(oldI);
      }
      newG.setAttribute(k, new THREE.Float32BufferAttribute(arr, is));
    }
    newG.setIndex(Array.from(compactIdx));
    const m = new THREE.Mesh(newG, mat);
    m.name = name;
    m.position.copy(mesh.position);
    m.quaternion.copy(mesh.quaternion);
    m.scale.copy(mesh.scale);
    return m;
  };

  const mFalse = cloneWithIndices(falseIdx, matFalse, nameFalse || mesh.name);
  const mTrue = cloneWithIndices(trueIdx, matTrue, nameTrue || `${mesh.name}_split`);
  return [mFalse, mTrue];
}

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
      if (!flipWinding) indices.push(a, b, d, a, d, c);
      else indices.push(a, d, b, a, c, d);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

function makeSubdividedBox(w, h, d, cx, cy, cz, mat, name, segs = [4, 3, 4], bevel = 0.014) {
  const geo = new THREE.BoxGeometry(w, h, d, segs[0], segs[1], segs[2]);
  if (bevel > 0) {
    const pos = geo.getAttribute("position");
    const hw = w * 0.5, hh = h * 0.5, hd = d * 0.5;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
      const ax = Math.abs(x) / Math.max(1e-4, hw);
      const ay = Math.abs(y) / Math.max(1e-4, hh);
      const az = Math.abs(z) / Math.max(1e-4, hd);
      const corner = Math.max(0, ax + ay + az - 2.0);
      const s = 1.0 - corner * bevel;
      pos.setXYZ(i, x * s, y * s, z * s);
    }
  }
  const smooth = toCreasedNormals(geo, (42 * Math.PI) / 180);
  smooth.translate(cx, cy, cz);
  const m = new THREE.Mesh(smooth, mat);
  m.name = name;
  return m;
}

// ---------------------------------------------------------------------------
// 1. High-Resolution Sculpted Range Rover Autobiography SV (~48k smooth tris)
// ---------------------------------------------------------------------------
function buildHighResRangeRover() {
  const root = new THREE.Group();
  root.name = "rangerover_autobiography_sv";

  const paintMat = new THREE.MeshStandardMaterial({ name: "paint__RangeRover", color: 0x3b4554, metalness: 0.52, roughness: 0.20 });
  const trimMat = new THREE.MeshStandardMaterial({ name: "trim__RangeRover", color: 0x111419, metalness: 0.16, roughness: 0.48 });
  const interiorMat = new THREE.MeshStandardMaterial({ name: "trim__RangeRover_Interior", color: 0x16181e, metalness: 0.06, roughness: 0.72 });
  const chromeMat = new THREE.MeshStandardMaterial({ name: "chrome__RangeRover", color: 0xd4dbe4, metalness: 0.96, roughness: 0.09 });
  const glassMat = new THREE.MeshStandardMaterial({ name: "glass__RangeRover", color: 0x080f18, metalness: 0.16, roughness: 0.04, transparent: true, opacity: 0.76 });
  const headMat = new THREE.MeshStandardMaterial({ name: "headlight__RangeRover", color: 0xf4f8ff, emissive: 0xdde8ff, emissiveIntensity: 0.9 });
  const headCoverMat = new THREE.MeshStandardMaterial({ name: "headlight__RangeRover_Cover", color: 0xdce6f2, metalness: 0.1, roughness: 0.05, transparent: true, opacity: 0.24 });
  const tailMat = new THREE.MeshStandardMaterial({ name: "taillight__RangeRover", color: 0xc2141a, emissive: 0xd01818, emissiveIntensity: 0.8 });
  const tailCoverMat = new THREE.MeshStandardMaterial({ name: "taillight__RangeRover_Cover", color: 0x8c0c12, metalness: 0.1, roughness: 0.06, transparent: true, opacity: 0.42 });
  const tireMat = new THREE.MeshStandardMaterial({ name: "tire__RangeRover", color: 0x14161a, metalness: 0.02, roughness: 0.86 });
  const rimMat = new THREE.MeshStandardMaterial({ name: "rim__RangeRover", color: 0xcbd2db, metalness: 0.90, roughness: 0.16 });
  const discMat = new THREE.MeshStandardMaterial({ name: "brake__RangeRover_Disc", color: 0x9aa2ad, metalness: 0.86, roughness: 0.26 });
  const caliperMat = new THREE.MeshStandardMaterial({ name: "brake__RangeRover_Caliper", color: 0xb91c1c, metalness: 0.45, roughness: 0.35 });

  // Sculpted cross-sections: [z, halfW_bot, halfW_belt, halfW_roof, yBot, yBelt, yRoof]
  const stations = [
    [-2.44, 0.84, 0.86, 0.70, 0.36, 1.04, 1.07],
    [-2.38, 0.94, 0.96, 0.72, 0.31, 1.10, 1.38],
    [-2.26, 0.99, 1.01, 0.74, 0.29, 1.13, 1.62],
    [-1.95, 1.04, 1.04, 0.75, 0.28, 1.14, 1.73],
    [-1.48, 1.06, 1.05, 0.76, 0.28, 1.13, 1.77],
    [-0.90, 1.06, 1.05, 0.76, 0.27, 1.12, 1.78],
    [ 0.00, 1.06, 1.05, 0.76, 0.27, 1.12, 1.78],
    [ 0.50, 1.06, 1.05, 0.75, 0.27, 1.11, 1.76],
    [ 0.92, 1.05, 1.03, 0.80, 0.28, 1.10, 1.44],
    [ 1.25, 1.05, 1.03, 0.87, 0.28, 1.07, 1.14],
    [ 1.68, 1.04, 1.01, 0.88, 0.28, 1.04, 1.09],
    [ 2.12, 1.00, 0.98, 0.85, 0.29, 0.98, 1.03],
    [ 2.38, 0.92, 0.90, 0.78, 0.31, 0.91, 0.95],
    [ 2.46, 0.80, 0.78, 0.66, 0.38, 0.82, 0.86],
  ];
  const interpStation = (t) => {
    const f = t * (stations.length - 1);
    const i = Math.min(stations.length - 2, Math.floor(f));
    const a = f - i;
    const s = a * a * (3 - 2 * a);
    return stations[i].map((v, k) => v + (stations[i + 1][k] - v) * s);
  };

  const uSteps = 72;
  const vSteps = 44;
  const grid = [];
  for (let iv = 0; iv < vSteps; iv++) {
    const v = iv / (vSteps - 1);
    for (let iu = 0; iu < uSteps; iu++) {
      const u = iu / (uSteps - 1);
      const st = interpStation(u);
      const [z, wb, wm, wr, yb, ym, yr] = st;

      // Wheel arch openings centered at z = +1.50 and z = -1.48
      const dFront = Math.abs(z - 1.50);
      const dRear = Math.abs(z + 1.48);
      const archR = 0.46;
      let archLift = 0;
      if (dFront < archR) archLift = Math.max(archLift, Math.sqrt(Math.max(0, archR * archR - dFront * dFront)) * 0.94);
      if (dRear < archR) archLift = Math.max(archLift, Math.sqrt(Math.max(0, archR * archR - dRear * dRear)) * 0.94);

      const yFloor = yb + archLift * 0.74;
      let pt;
      if (v < 0.12) {
        const t = v / 0.12;
        pt = new THREE.Vector3(t * (wb - 0.05), yFloor, z);
      } else if (v < 0.35) {
        const t = (v - 0.12) / 0.23;
        // Sculpted Range Rover body side: lower sill tuck + subtle mid shoulder flare
        const flare = Math.sin(t * Math.PI) * 0.045 - Math.exp(-Math.pow((t - 0.25) / 0.14, 2)) * 0.015;
        const x = wb * (1 - t) + wm * t + flare;
        const y = yFloor + (ym - yFloor) * t;
        pt = new THREE.Vector3(x, y, z);
      } else if (v < 0.44) {
        const t = (v - 0.35) / 0.09;
        const x = wm * (1 - t) + wr * t;
        const y = ym + (yr - ym) * Math.sin(t * Math.PI * 0.5);
        pt = new THREE.Vector3(x, y, z);
      } else if (v < 0.56) {
        const t = (v - 0.44) / 0.12;
        const x = wr * (1 - 2 * t);
        const crown = Math.cos((t - 0.5) * Math.PI) * 0.028;
        // Subtle clamshell hood power dome for z > 1.1
        const hoodCrown = z > 1.1 ? Math.cos((t - 0.5) * Math.PI) * 0.018 : 0;
        pt = new THREE.Vector3(x, yr + crown + hoodCrown, z);
      } else if (v < 0.65) {
        const t = (v - 0.56) / 0.09;
        const x = -wr * (1 - t) - wm * t;
        const y = yr - (yr - ym) * (1 - Math.cos(t * Math.PI * 0.5));
        pt = new THREE.Vector3(x, y, z);
      } else if (v < 0.88) {
        const t = (v - 0.65) / 0.23;
        const flare = Math.sin(t * Math.PI) * 0.045 - Math.exp(-Math.pow((t - 0.75) / 0.14, 2)) * 0.015;
        const x = -wm * (1 - t) - wb * t - flare;
        const y = ym - (ym - yFloor) * t;
        pt = new THREE.Vector3(x, y, z);
      } else {
        const t = (v - 0.88) / 0.12;
        pt = new THREE.Vector3(-(wb - 0.05) * (1 - t), yFloor, z);
      }
      grid.push(pt);
    }
  }
  const hullGeo = toCreasedNormals(buildGridSurface(grid, uSteps, vSteps, true), (40 * Math.PI) / 180);
  const hullMesh = new THREE.Mesh(hullGeo, paintMat);
  hullMesh.name = "rr_body_hull";
  root.add(hullMesh);

  // Sculpted fender wheel-arch flare rings (clean curved arcs around each wheel well)
  for (const [label, wz] of [["front", 1.50], ["rear", -1.48]]) {
    for (const [side, sx] of [["l", 1], ["r", -1]]) {
      const archGeo = new THREE.TorusGeometry(0.47, 0.026, 10, 32, Math.PI * 0.92);
      archGeo.rotateY(Math.PI / 2);
      archGeo.rotateX(-Math.PI * 0.04);
      archGeo.translate(sx * 1.03, 0.44, wz);
      const archMesh = new THREE.Mesh(archGeo, trimMat);
      archMesh.name = `rr_flare_${label}_${side}`;
      root.add(archMesh);
    }
    // Dark inner wheel-well tub liner
    const liner = makeSubdividedBox(1.82, 0.62, 0.92, 0, 0.56, wz, interiorMat, `rr_arch_liner_${label}`, [2, 2, 4], 0.02);
    root.add(liner);
  }

  // Front Autobiography fascia: sculpted bumper, lower air dam, satin skidplate, Atlas grille + honeycomb slats
  root.add(
    makeSubdividedBox(1.94, 0.32, 0.18, 0, 0.43, 2.38, trimMat, "rr_front_bumper", [6, 3, 3], 0.025),
    makeSubdividedBox(1.24, 0.09, 0.14, 0, 0.30, 2.42, chromeMat, "rr_front_skid", [4, 2, 2], 0.02),
    makeSubdividedBox(1.74, 0.16, 0.06, 0, 0.45, 2.45, trimMat, "rr_lower_intake", [6, 2, 2], 0.015),
    makeSubdividedBox(0.98, 0.25, 0.06, 0, 0.79, 2.43, chromeMat, "rr_grille_frame", [6, 3, 2], 0.015),
    makeSubdividedBox(0.92, 0.21, 0.07, 0, 0.79, 2.435, trimMat, "rr_grille_mesh", [6, 3, 2], 0.01),
    // Side intake blades
    makeSubdividedBox(0.05, 0.16, 0.05, 0.72, 0.45, 2.44, chromeMat, "rr_intake_vane_l", [2, 2, 2], 0.01),
    makeSubdividedBox(0.05, 0.16, 0.05, -0.72, 0.45, 2.44, chromeMat, "rr_intake_vane_r", [2, 2, 2], 0.01),
  );

  // Dual-projector Matrix LED headlights + clear polycarbonate outer lenses
  for (const [side, sx] of [["l", 1], ["r", -1]]) {
    root.add(
      makeSubdividedBox(0.34, 0.13, 0.09, sx * 0.74, 0.80, 2.38, trimMat, `rr_hl_housing_${side}`, [3, 2, 2], 0.015),
      makeSubdividedBox(0.28, 0.035, 0.04, sx * 0.74, 0.755, 2.425, headMat, `rr_hl_drl_${side}`, [4, 2, 2], 0.01),
      makeSubdividedBox(0.09, 0.06, 0.04, sx * 0.67, 0.815, 2.415, headMat, `rr_hl_proj1_${side}`, [3, 3, 2], 0.02),
      makeSubdividedBox(0.09, 0.06, 0.04, sx * 0.80, 0.815, 2.415, headMat, `rr_hl_proj2_${side}`, [3, 3, 2], 0.02),
      makeSubdividedBox(0.35, 0.14, 0.03, sx * 0.74, 0.80, 2.435, headCoverMat, `rr_hl_cover_${side}`, [4, 2, 2], 0.015),
    );
  }

  // Rear fascia: vertical signature LED taillights, gloss-black tailgate finisher, diffuser & twin exhausts
  root.add(
    makeSubdividedBox(1.94, 0.30, 0.16, 0, 0.43, -2.38, trimMat, "rr_rear_bumper", [6, 3, 3], 0.025),
    makeSubdividedBox(1.36, 0.11, 0.10, 0, 0.32, -2.41, trimMat, "rr_rear_diffuser", [4, 2, 2], 0.015),
    makeSubdividedBox(0.20, 0.065, 0.08, 0.56, 0.34, -2.43, chromeMat, "rr_exhaust_l", [3, 2, 2], 0.015),
    makeSubdividedBox(0.20, 0.065, 0.08, -0.56, 0.34, -2.43, chromeMat, "rr_exhaust_r", [3, 2, 2], 0.015),
    makeSubdividedBox(1.88, 0.52, 0.08, 0, 0.82, -2.40, paintMat, "rr_tailgate", [6, 3, 2], 0.015),
    makeSubdividedBox(1.48, 0.09, 0.04, 0, 0.99, -2.43, trimMat, "rr_tailgate_finisher", [4, 2, 2], 0.01),
  );
  for (const [side, sx] of [["l", 1], ["r", -1]]) {
    root.add(
      makeSubdividedBox(0.14, 0.28, 0.08, sx * 0.87, 0.95, -2.37, trimMat, `rr_tl_housing_${side}`, [3, 3, 2], 0.015),
      makeSubdividedBox(0.09, 0.24, 0.04, sx * 0.87, 0.95, -2.405, tailMat, `rr_tl_led_${side}`, [3, 4, 2], 0.01),
      makeSubdividedBox(0.15, 0.29, 0.03, sx * 0.87, 0.95, -2.42, tailCoverMat, `rr_tl_cover_${side}`, [3, 3, 2], 0.015),
    );
  }

  // Signature front door vertical gill vents (chromed trim accent)
  for (const [side, sx] of [["l", 1], ["r", -1]]) {
    root.add(
      makeSubdividedBox(0.03, 0.34, 0.08, sx * 1.045, 0.82, 0.84, chromeMat, `rr_gill_${side}`, [2, 3, 2], 0.01),
    );
  }

  // Greenhouse: angled windshield, rear glass, wrap-around side windows, panoramic sunroof, gloss-black pillars
  const windshieldGeo = new THREE.BoxGeometry(1.56, 0.58, 0.035, 8, 4, 1);
  windshieldGeo.rotateX(-0.76);
  windshieldGeo.translate(0, 1.44, 1.08);
  const windshield = new THREE.Mesh(toCreasedNormals(windshieldGeo, 0.7), glassMat);
  windshield.name = "rr_windshield";

  const rearGlassGeo = new THREE.BoxGeometry(1.50, 0.50, 0.035, 8, 4, 1);
  rearGlassGeo.rotateX(0.42);
  rearGlassGeo.translate(0, 1.44, -2.14);
  const rearGlass = new THREE.Mesh(toCreasedNormals(rearGlassGeo, 0.7), glassMat);
  rearGlass.name = "rr_rear_glass";

  const sideGlassGeo = new THREE.BoxGeometry(2.04, 0.45, 2.74, 4, 4, 14);
  {
    const pos = sideGlassGeo.getAttribute("position");
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i), z = pos.getZ(i);
      const taperY = y > 0 ? 0.775 : 0.995;
      const taperZ = z < -1.1 ? 0.96 : 1.0;
      pos.setX(i, pos.getX(i) * taperY * taperZ);
    }
    sideGlassGeo.translate(0, 1.41, -0.66);
  }
  const sideGlass = new THREE.Mesh(toCreasedNormals(sideGlassGeo, 0.7), glassMat);
  sideGlass.name = "rr_side_greenhouse";

  const panoRoof = makeSubdividedBox(1.26, 0.04, 2.15, 0, 1.785, -0.62, glassMat, "rr_pano_roof", [6, 1, 8], 0.01);
  const roofCap = makeSubdividedBox(1.58, 0.075, 2.86, 0, 1.745, -0.68, paintMat, "rr_roof_cap", [8, 2, 12], 0.018);
  const roofSpoiler = makeSubdividedBox(1.50, 0.06, 0.22, 0, 1.72, -2.14, paintMat, "rr_roof_spoiler", [6, 2, 3], 0.015);
  root.add(windshield, rearGlass, sideGlass, panoRoof, roofCap, roofSpoiler);

  const mkPillar = (zCenter, zLen, name) => {
    const g = new THREE.BoxGeometry(2.07, 0.47, zLen, 2, 3, 2);
    const pos = g.getAttribute("position");
    for (let i = 0; i < pos.count; i++) {
      pos.setX(i, pos.getX(i) * (pos.getY(i) > 0 ? 0.77 : 0.99));
    }
    g.translate(0, 1.41, zCenter);
    const m = new THREE.Mesh(toCreasedNormals(g, 0.7), trimMat);
    m.name = name;
    return m;
  };
  root.add(
    mkPillar(0.62, 0.13, "rr_pillar_a"),
    mkPillar(-0.12, 0.14, "rr_pillar_b"),
    mkPillar(-1.05, 0.15, "rr_pillar_c"),
    mkPillar(-1.98, 0.24, "rr_pillar_d"),
    makeSubdividedBox(0.045, 0.04, 2.40, 0.68, 1.805, -0.65, trimMat, "rr_rail_l", [2, 2, 8], 0.01),
    makeSubdividedBox(0.045, 0.04, 2.40, -0.68, 1.805, -0.65, trimMat, "rr_rail_r", [2, 2, 8], 0.01),
    // Sculpted side mirrors
    makeSubdividedBox(0.08, 0.04, 0.06, 0.98, 1.12, 0.62, trimMat, "rr_mirror_stalk_l", [2, 2, 2], 0.01),
    makeSubdividedBox(0.08, 0.04, 0.06, -0.98, 1.12, 0.62, trimMat, "rr_mirror_stalk_r", [2, 2, 2], 0.01),
    makeSubdividedBox(0.15, 0.10, 0.13, 1.07, 1.15, 0.60, paintMat, "rr_mirror_l", [4, 3, 3], 0.025),
    makeSubdividedBox(0.15, 0.10, 0.13, -1.07, 1.15, 0.60, paintMat, "rr_mirror_r", [4, 3, 3], 0.025),
  );

  // Dark luxury interior visible behind tinted glass
  const interior = new THREE.Group();
  interior.name = "rr_interior";
  interior.add(
    makeSubdividedBox(1.48, 0.08, 2.60, 0, 0.44, -0.55, interiorMat, "rr_floor", [4, 1, 6], 0),
    makeSubdividedBox(0.28, 0.36, 1.80, 0, 0.68, -0.15, interiorMat, "rr_console", [3, 2, 4], 0.02),
    makeSubdividedBox(1.46, 0.28, 0.42, 0, 0.98, 0.56, interiorMat, "rr_dash", [4, 2, 3], 0.02),
    makeSubdividedBox(0.44, 0.14, 0.48, 0.40, 0.64, -0.05, interiorMat, "rr_seat_fl_base", [3, 2, 3], 0.02),
    makeSubdividedBox(0.42, 0.56, 0.14, 0.40, 0.95, -0.28, interiorMat, "rr_seat_fl_back", [3, 3, 2], 0.02),
    makeSubdividedBox(0.44, 0.14, 0.48, -0.40, 0.64, -0.05, interiorMat, "rr_seat_fr_base", [3, 2, 3], 0.02),
    makeSubdividedBox(0.42, 0.56, 0.14, -0.40, 0.95, -0.28, interiorMat, "rr_seat_fr_back", [3, 3, 2], 0.02),
    makeSubdividedBox(1.36, 0.14, 0.48, 0, 0.64, -1.05, interiorMat, "rr_rear_bench_base", [4, 2, 3], 0.02),
    makeSubdividedBox(1.34, 0.56, 0.14, 0, 0.95, -1.28, interiorMat, "rr_rear_bench_back", [4, 3, 2], 0.02),
  );
  const swGeo = new THREE.TorusGeometry(0.16, 0.02, 10, 28);
  swGeo.rotateX(0.32);
  swGeo.translate(0.40, 1.02, 0.34);
  interior.add(new THREE.Mesh(swGeo, interiorMat));
  root.add(interior);

  // Hinged doors (front & rear) with flush handles
  for (const [name, x, y, z] of [
    ["door_fl", 1.05, 0.97, 0.25],
    ["door_fr", -1.05, 0.97, 0.25],
    ["door_rl", 1.05, 0.97, -0.70],
    ["door_rr", -1.05, 0.97, -0.70],
  ]) {
    const grp = new THREE.Group();
    grp.name = name;
    grp.position.set(x, y, z + 0.45);
    const h = makeSubdividedBox(0.03, 0.032, 0.18, x > 0 ? 0.022 : -0.022, 0.02, -0.45, chromeMat, `${name}_handle`, [2, 2, 3], 0.01);
    grp.add(h);
    root.add(grp);
  }

  // High-Resolution 22-inch 10-Spoke Autobiography Turbine Wheels + Radial Tires + Brake Discs + Calipers
  // Build sculpted curved tire torus profile once
  const makeCurvedTireGeometry = (outerR, rimR, width, radSeg = 56, profSeg = 18) => {
    const pos = [];
    const idx = [];
    for (let i = 0; i <= radSeg; i++) {
      const theta = (i / radSeg) * Math.PI * 2;
      const cosT = Math.cos(theta), sinT = Math.sin(theta);
      for (let j = 0; j <= profSeg; j++) {
        const u = j / profSeg; // 0..1 around half-cross-section from inner bead -> tread -> outer bead
        const ang = u * Math.PI * 2;
        // Closed tire tube cross section: x in [-width/2..+width/2], r in [rimR..outerR]
        const rMid = (outerR + rimR) * 0.5;
        const rAmp = (outerR - rimR) * 0.5;
        // Square off the tread shoulder gently
        const sinA = Math.sin(ang);
        const cosA = Math.cos(ang);
        const shoulderX = Math.sign(cosA) * Math.pow(Math.abs(cosA), 0.65) * (width * 0.5);
        const r = rMid + Math.sign(sinA) * Math.pow(Math.abs(sinA), 0.72) * rAmp;
        pos.push(shoulderX, r * cosT, r * sinT);
      }
    }
    const stride = profSeg + 1;
    for (let i = 0; i < radSeg; i++) {
      for (let j = 0; j < profSeg; j++) {
        const a = i * stride + j;
        const b = a + stride;
        const c = a + 1;
        const d = b + 1;
        idx.push(a, b, d, a, d, c);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    return toCreasedNormals(g, (45 * Math.PI) / 180);
  };

  const tireR = 0.425;
  const rimR = 0.29;
  const tireW = 0.295;
  const wheelCoords = [
    ["fl", 0.94, tireR, 1.50],
    ["fr", -0.94, tireR, 1.50],
    ["rl", 0.94, tireR, -1.48],
    ["rr", -0.94, tireR, -1.48],
  ];

  for (const [k, wx, wy, wz] of wheelCoords) {
    const sign = Math.sign(wx);
    // 1) Sculpted radial tire (~2,016 tris per tire)
    const tGeo = makeCurvedTireGeometry(tireR, rimR - 0.01, tireW, 56, 18);
    tGeo.translate(wx, wy, wz);
    const tMesh = new THREE.Mesh(tGeo, tireMat);
    tMesh.name = `wheel_${k}_tire`;
    root.add(tMesh);

    // 2) Outer alloy barrel lip + inner barrel drum
    const lipGeo = new THREE.TorusGeometry(rimR, 0.016, 10, 48);
    lipGeo.rotateY(Math.PI / 2);
    lipGeo.translate(wx + sign * (tireW * 0.44), wy, wz);
    const lipMesh = new THREE.Mesh(lipGeo, rimMat);
    lipMesh.name = `wheel_${k}_lip`;
    root.add(lipMesh);

    const barrelGeo = new THREE.CylinderGeometry(rimR - 0.01, rimR - 0.01, tireW * 0.85, 44, 1, true);
    barrelGeo.rotateZ(Math.PI / 2);
    barrelGeo.translate(wx, wy, wz);
    const barrelMesh = new THREE.Mesh(barrelGeo, trimMat);
    barrelMesh.name = `wheel_${k}_barrel`;
    root.add(barrelMesh);

    // 3) Center hub + 10 split-Y Autobiography turbine spokes
    const hubGeo = new THREE.CylinderGeometry(0.068, 0.074, 0.045, 24);
    hubGeo.rotateZ(Math.PI / 2);
    hubGeo.translate(wx + sign * (tireW * 0.42), wy, wz);
    const hubMesh = new THREE.Mesh(hubGeo, rimMat);
    hubMesh.name = `wheel_${k}_hub`;
    root.add(hubMesh);

    for (let s = 0; s < 10; s++) {
      const ang = (s / 10) * Math.PI * 2;
      const sg = new THREE.BoxGeometry(0.022, 0.23, 0.028, 2, 3, 2);
      sg.translate(0, 0.145, 0);
      sg.rotateX(ang);
      sg.translate(wx + sign * (tireW * 0.415), wy, wz);
      const sm = new THREE.Mesh(toCreasedNormals(sg, 0.65), rimMat);
      sm.name = `wheel_${k}_spoke_${s}`;
      root.add(sm);
    }

    // 4) Ventilated brake rotor disc (spins with wheel) + stationary painted Brembo caliper
    const discGeo = new THREE.CylinderGeometry(0.215, 0.215, 0.024, 36);
    discGeo.rotateZ(Math.PI / 2);
    discGeo.translate(wx + sign * 0.03, wy, wz);
    const discMesh = new THREE.Mesh(discGeo, discMat);
    discMesh.name = `wheel_${k}_disc`;
    root.add(discMesh);

    const calGeo = new THREE.BoxGeometry(0.055, 0.13, 0.075, 2, 3, 2);
    calGeo.translate(wx + sign * 0.045, wy + 0.04, wz - 0.155);
    const calMesh = new THREE.Mesh(toCreasedNormals(calGeo, 0.65), caliperMat);
    calMesh.name = `caliper_${k}`;
    root.add(calMesh);
  }

  return root;
}

// ---------------------------------------------------------------------------
// Main Upgrade Pipeline
// ---------------------------------------------------------------------------
const TARGET_CARS = [
  "rangerover",
  "sedan",
  "offroad",
  "audi",
  "mercedes",
  "r8",
  "ferrari",
  "golf",
  "semi",
  "kraz",
];

for (const id of TARGET_CARS) {
  const filePath = path.join(MODELS_DIR, `${id}.glb`);
  console.log(`\n=== Upgrading ${id}.glb ===`);

  if (id === "rangerover") {
    const rr = buildHighResRangeRover();
    rr.updateMatrixWorld(true);
    const b = new THREE.Box3().setFromObject(rr);
    const c = b.getCenter(new THREE.Vector3());
    const shift = new THREE.Matrix4().makeTranslation(-c.x, -b.min.y, -c.z);
    rr.traverse((o) => { if (o.isMesh) o.geometry.applyMatrix4(shift); });
    saveAndPackGlb(rr, [], filePath);
    console.log(`  rebuilt Range Rover Autobiography SV (${(fs.statSync(filePath).size / 1024).toFixed(1)} KB)`);
    continue;
  }

  const { gltf, raw } = await loadCarGlb(filePath);
  const scene = gltf.scene;
  scene.traverse((o) => {
    if (!o.isMesh || !o.geometry) return;
    const g = o.geometry;
    for (const k of Object.keys(g.attributes)) {
      const src = g.getAttribute(k);
      if (src.isInterleavedBufferAttribute || !(src.array instanceof Float32Array)) {
        const is = src.itemSize;
        const arr = new Float32Array(src.count * is);
        for (let i = 0; i < src.count; i++) {
          const base = i * is;
          if (is >= 1) arr[base] = src.getX(i);
          if (is >= 2) arr[base + 1] = src.getY(i);
          if (is >= 3) arr[base + 2] = src.getZ(i);
          if (is >= 4) arr[base + 3] = src.getW(i);
        }
        g.setAttribute(k, new THREE.Float32BufferAttribute(arr, is));
      }
    }
  });
  scene.updateMatrixWorld(true);

  if (id === "sedan" || id === "offroad") {
    const paintMat = new THREE.MeshStandardMaterial({
      name: `paint__${id}`,
      color: id === "sedan" ? 0xd96014 : 0x164a78,
      metalness: 0.46,
      roughness: 0.22,
    });
    const tireMat = new THREE.MeshStandardMaterial({ name: `tire__${id}`, color: 0x16181c, metalness: 0.02, roughness: 0.86 });
    const rimMat = new THREE.MeshStandardMaterial({ name: `rim__${id}`, color: 0xc2c8d0, metalness: 0.90, roughness: 0.18 });
    const spareTireMat = new THREE.MeshStandardMaterial({ name: `tire__${id}_spare`, color: 0x16181c, metalness: 0.02, roughness: 0.86 });
    const spareRimMat = new THREE.MeshStandardMaterial({ name: `rim__${id}_spare`, color: 0xc2c8d0, metalness: 0.90, roughness: 0.18 });
    const trimMat = new THREE.MeshStandardMaterial({ name: `trim__${id}`, color: 0x1a1c21, metalness: 0.14, roughness: 0.56 });
    const underbodyMat = new THREE.MeshStandardMaterial({ name: `trim__${id}_underbody`, color: 0x131519, metalness: 0.12, roughness: 0.68 });
    const interiorMat = new THREE.MeshStandardMaterial({ name: `trim__${id}_interior`, color: 0x1e2026, metalness: 0.05, roughness: 0.78 });
    const plateMat = new THREE.MeshStandardMaterial({ name: `plate__${id}`, color: 0xc4c8cf, metalness: 0.30, roughness: 0.38 });
    const glassMat = new THREE.MeshStandardMaterial({ name: `glass__${id}`, color: 0x0a1018, metalness: 0.15, roughness: 0.05, transparent: true, opacity: 0.54 });
    const headMat = new THREE.MeshStandardMaterial({ name: `headlight__${id}`, color: 0xf4f8ff, emissive: 0xdde8ff, emissiveIntensity: 0.85, metalness: 0.1, roughness: 0.12 });
    const tailMat = new THREE.MeshStandardMaterial({ name: `taillight__${id}`, color: 0xb8141a, emissive: 0xc81414, emissiveIntensity: 0.75, metalness: 0.1, roughness: 0.18 });
    const caliperMat = new THREE.MeshStandardMaterial({ name: `brake__${id}_caliper`, color: 0x991b1b, metalness: 0.45, roughness: 0.35 });

    const splitThreshold = id === "sedan" ? 0.225 : 0.265;
    const toProcess = [];
    scene.traverse((o) => { if (o.isMesh) toProcess.push(o); });

    for (const mesh of toProcess) {
      const mn = mesh.material?.name || "";
      if (mn === "paint" || mn.startsWith("paint__")) {
        mesh.material = paintMat;
      } else if (mn === "underbody" || mn.includes("underbody")) {
        mesh.material = underbodyMat;
      } else if (mn.startsWith("trim_matte") || mn === `trim__${id}`) {
        mesh.material = trimMat;
      } else if (mn === "interior" || mn.includes("interior")) {
        mesh.material = interiorMat;
      } else if (mn === "plate" || mn.startsWith("plate__")) {
        mesh.material = plateMat;
      } else if (mn === "glass" || mn.startsWith("glass__")) {
        mesh.material = glassMat;
      } else if (mn === "lights") {
        // In raw GLB before Math.PI yaw: front is +Z (z > 0), rear is -Z (z < 0)
        const res = splitMeshTriangles(mesh, (ctr) => ctr.z < 0, headMat, tailMat, `${mesh.name}_hl`, `${mesh.name}_tl`);
        if (res) {
          mesh.parent.add(res[0], res[1]);
          mesh.parent.remove(mesh);
        } else {
          const b = new THREE.Box3().setFromObject(mesh);
          mesh.material = b.getCenter(new THREE.Vector3()).z < 0 ? tailMat : headMat;
        }
      } else if (mn === "tire" || mn.startsWith("tire__") || mn.startsWith("rim__")) {
        const b = new THREE.Box3().setFromObject(mesh);
        const c = b.getCenter(new THREE.Vector3());
        const sz = b.getSize(new THREE.Vector3());
        if (sz.y < 0.28 && sz.z < 0.28) {
          mesh.material = caliperMat;
          continue;
        }
        const isSpare = id === "offroad" && c.y > 0.85;
        const rMat = isSpare ? spareRimMat : rimMat;
        const tMat = isSpare ? spareTireMat : tireMat;
        const res = splitMeshTriangles(
          mesh,
          (ctr) => Math.hypot(ctr.y - c.y, ctr.z - c.z) < splitThreshold,
          tMat,
          rMat,
          isSpare ? "spare_tire" : `tire_wheel_${c.x > 0 ? "l" : "r"}${c.z > 0 ? "f" : "r"}`,
          isSpare ? "spare_rim" : `rim_wheel_${c.x > 0 ? "l" : "r"}${c.z > 0 ? "f" : "r"}`,
        );
        if (res) {
          mesh.parent.add(res[0], res[1]);
          mesh.parent.remove(mesh);
        } else {
          mesh.material = tMat;
        }
      }
    }
    // Note: offroad spare wheel assembly (mesh_31..33) should also be darkened (handled by interior/underbody/trim above)
    console.log(`  repaired ${id} PBR materials, radial rim/tire split, & headlight/taillight split`);
  }

  if (id === "audi") {
    const darkTrimMat = new THREE.MeshStandardMaterial({ name: "trim__Audi_Dark", color: 0x16181e, metalness: 0.18, roughness: 0.45 });
    const badgeMat = new THREE.MeshStandardMaterial({ name: "other__RS_Red_Badge", color: 0xc41414, metalness: 0.35, roughness: 0.25 });
    const toProcess = [];
    scene.traverse((o) => { if (o.isMesh) toProcess.push(o); });

    for (const mesh of toProcess) {
      const mn = mesh.material?.name || "";
      if (mn === "rim__RIM DARK") {
        const res = splitMeshTriangles(
          mesh,
          (ctr) =>
            Math.abs(ctr.x) > 0.65 &&
            (Math.hypot(ctr.y - 0.37, ctr.z - 1.54) < 0.35 || Math.hypot(ctr.y - 0.37, ctr.z + 1.39) < 0.35),
          darkTrimMat,
          mesh.material,
          `${mesh.name}_trim`,
          mesh.name,
        );
        if (res) {
          mesh.parent.add(res[0], res[1]);
          mesh.parent.remove(mesh);
        }
      } else if (mn === "rim__RIM BRIGHT_red") {
        mesh.material = badgeMat;
      } else if (mn === "other__Material.001") {
        mesh.material.color.setRGB(0.82, 0.88, 0.96);
        mesh.material.metalness = 0.85;
        mesh.material.roughness = 0.18;
      } else if (mn === "other__Material.005") {
        mesh.material.color.setRGB(0.55, 0.02, 0.02);
        mesh.material.metalness = 0.15;
        mesh.material.roughness = 0.22;
      } else if (mn === "other__Material.002" || mn === "other__Material.006") {
        mesh.material.color.setRGB(0.08, 0.08, 0.10);
        mesh.material.metalness = 0.25;
        mesh.material.roughness = 0.45;
      }
    }
    console.log("  split Audi rim__RIM DARK from body trim & fixed RS7 badge / lamp housings");
  }

  if (id === "mercedes") {
    const toProcess = [];
    scene.traverse((o) => { if (o.isMesh) toProcess.push(o); });
    for (const mesh of toProcess) {
      const mn = mesh.material?.name || "";
      if (mn === "photo__W222 - Photo Textures" || mn === "photo__W222 - Photo Textures Rough 0") {
        const hlMat = mesh.material.clone();
        hlMat.name = "headlight__W222";
        hlMat.emissive = new THREE.Color(0xf4f8ff);
        hlMat.emissiveIntensity = 0.75;

        const tlMat = mesh.material.clone();
        tlMat.name = "taillight__W222";
        tlMat.emissive = new THREE.Color(0xd81818);
        tlMat.emissiveIntensity = 0.75;

        // First split off front headlights (z < -1.95, |x| > 0.45, y in [0.48..0.88])
        const frontRes = splitMeshTriangles(
          mesh,
          (ctr) => ctr.z < -1.95 && Math.abs(ctr.x) > 0.45 && ctr.y > 0.48 && ctr.y < 0.88,
          mesh.material,
          hlMat,
          mesh.name,
          `${mesh.name}_hl`,
        );
        const bodyMesh = frontRes ? frontRes[0] : mesh;
        if (frontRes) {
          mesh.parent.add(frontRes[0], frontRes[1]);
          mesh.parent.remove(mesh);
        }
        // Then split rear taillights (z > 2.00, |x| > 0.45, y in [0.48..0.85])
        bodyMesh.updateMatrixWorld(true);
        const rearRes = splitMeshTriangles(
          bodyMesh,
          (ctr) => ctr.z > 2.00 && Math.abs(ctr.x) > 0.45 && ctr.y > 0.48 && ctr.y < 0.85,
          bodyMesh.material,
          tlMat,
          bodyMesh.name,
          `${bodyMesh.name}_tl`,
        );
        if (rearRes) {
          bodyMesh.parent.add(rearRes[0], rearRes[1]);
          bodyMesh.parent.remove(bodyMesh);
        }
      } else if (mn.startsWith("other__Unknown")) {
        mesh.material.color.setRGB(0.85, 0.45, 0.08);
        mesh.material.metalness = 0.25;
        mesh.material.roughness = 0.30;
      }
    }
    console.log("  separated Mercedes W222 photo-textured headlights & taillights + side markers");
  }

  if (id === "r8") {
    const capMat = new THREE.MeshStandardMaterial({ name: "rim__r8_cap", color: 0xd0d6de, metalness: 0.94, roughness: 0.12 });
    scene.traverse((o) => {
      if (!o.isMesh) return;
      if ((o.material?.name || "") === "chrome__r8") {
        const b = new THREE.Box3().setFromObject(o);
        const sz = b.getSize(new THREE.Vector3());
        const c = b.getCenter(new THREE.Vector3());
        if (Math.abs(c.x) > 0.80 && Math.abs(c.y - 0.31) < 0.06 && sz.y < 0.12 && sz.z < 0.12) {
          o.material = capMat;
        }
      }
    });
    console.log("  tagged R8 wheel center-cap badges as rim__r8_cap so they spin with wheels");
  }

  if (id === "ferrari") {
    scene.traverse((o) => {
      if (!o.isMesh) return;
      const mn = o.material?.name || "";
      if (mn.startsWith("plate__")) o.visible = false;
      else if (mn === "other__SideBlinker.000") {
        o.material.color.setRGB(0.92, 0.42, 0.03);
        o.material.metalness = 0.15;
        o.material.roughness = 0.25;
      } else if (mn === "other__WheelArches.000") {
        o.material.color.setRGB(0.02, 0.02, 0.025);
        o.material.metalness = 0.05;
        o.material.roughness = 0.85;
      } else if (mn === "other__RearFibreSurroundings.000") {
        o.material.color.setRGB(0.04, 0.04, 0.045);
        o.material.metalness = 0.22;
        o.material.roughness = 0.48;
      } else if (mn === "other__Keyhole.000") {
        o.material.color.setRGB(0.84, 0.86, 0.90);
        o.material.metalness = 0.92;
        o.material.roughness = 0.14;
      }
    });
    console.log("  upgraded Ferrari accent materials & removed floating plate");
  }

  if (id === "golf") {
    scene.traverse((o) => {
      if (!o.isMesh) return;
      const mn = o.material?.name || "";
      if (mn === "plate__Plates") {
        o.material.color.setRGB(0.76, 0.78, 0.82);
        o.material.metalness = 0.28;
        o.material.roughness = 0.36;
      } else if (mn === "trim__Black-plastic") {
        const pos = o.geometry.getAttribute("position");
        const inv = new THREE.Matrix4().copy(o.matrixWorld).invert();
        const p = new THREE.Vector3();
        let trimmed = 0;
        for (let i = 0; i < pos.count; i++) {
          p.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld);
          if (p.y > 1.44 && Math.abs(p.x) < 0.08 && p.z > 1.2) {
            p.y = 1.44 + (p.y - 1.44) * 0.24; // sleek 6cm sport stub instead of 24cm whip
            p.applyMatrix4(inv);
            pos.setXYZ(i, p.x, p.y, p.z);
            trimmed++;
          }
        }
        if (trimmed > 0) {
          pos.needsUpdate = true;
          o.geometry.computeBoundingBox();
        }
      }
    });
    console.log("  trimmed Golf roof whip antenna to GTI sport stub & toned plates");
  }

  // Re-normalize bounds (ground minY = 0, centered XZ)
  scene.updateMatrixWorld(true);
  const b = new THREE.Box3().setFromObject(scene);
  const c = b.getCenter(new THREE.Vector3());
  const dx = -c.x, dy = -b.min.y, dz = -c.z;
  for (const ch of scene.children) {
    ch.position.x += dx;
    ch.position.y += dy;
    ch.position.z += dz;
  }
  scene.updateMatrixWorld(true);

  // Bake root node transforms so GLB is clean meters while keeping door/wheel/caliper pivot groups
  const isPivotGroup = (name) => /^(door|tire|caliper)_(fl|fr|rl|rr)$/i.test(name || "");
  const outRoot = new THREE.Group();
  const bake = (obj, parentOut, insidePivot = false) => {
    for (const ch of obj.children) {
      if (ch.isMesh) {
        if (ch.visible === false) continue;
        const g = ch.geometry.clone();
        if (insidePivot) {
          const m = new THREE.Mesh(g, ch.material);
          m.name = ch.name;
          m.position.copy(ch.position);
          m.quaternion.copy(ch.quaternion);
          m.scale.copy(ch.scale);
          parentOut.add(m);
        } else {
          g.applyMatrix4(ch.matrixWorld);
          const m = new THREE.Mesh(g, ch.material);
          m.name = ch.name;
          parentOut.add(m);
        }
      } else {
        if (isPivotGroup(ch.name)) {
          const grp = new THREE.Group();
          grp.name = ch.name;
          // Preserve world position of pivot relative to scene root
          const wp = new THREE.Vector3();
          const wq = new THREE.Quaternion();
          const ws = new THREE.Vector3();
          ch.matrixWorld.decompose(wp, wq, ws);
          grp.position.copy(wp);
          grp.quaternion.copy(wq);
          grp.scale.copy(ws);
          parentOut.add(grp);
          bake(ch, grp, true);
        } else {
          bake(ch, parentOut, insidePivot);
        }
      }
    }
  };
  bake(scene, outRoot, false);

  saveAndPackGlb(outRoot, raw.images, filePath);
  const szKb = (fs.statSync(filePath).size / 1024).toFixed(1);
  console.log(`  wrote ${id}.glb (${szKb} KB)`);
}
