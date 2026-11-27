import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
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

export const THREE = await import("three");
export const { GLTFLoader } = await import("three/examples/jsm/loaders/GLTFLoader.js");
export const { MeshoptDecoder } = await import("three/examples/jsm/libs/meshopt_decoder.module.js");
export const { mergeGeometries, mergeVertices, toCreasedNormals } = await import(
  "three/examples/jsm/utils/BufferGeometryUtils.js"
);
export const { LoopSubdivision } = await import("three-subdivide");

await MeshoptDecoder.ready;

export const MODELS_DIR = path.resolve("public/models");
export const GLTFPACK_BIN = path.resolve("node_modules/.bin/gltfpack");

export function parseRawGlb(buf) {
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
  return { json, bin, images };
}

export function packGlbChunks(json, binBuf) {
  const jsonBytes = Buffer.from(JSON.stringify(json), "utf8");
  const jsonPad = (4 - (jsonBytes.length % 4)) % 4;
  const jsonChunk = Buffer.concat([jsonBytes, Buffer.alloc(jsonPad, 0x20)]);
  const binPad = (4 - (binBuf.length % 4)) % 4;
  const binChunk = binPad === 0 ? binBuf : Buffer.concat([binBuf, Buffer.alloc(binPad, 0)]);
  const totalLen = 12 + 8 + jsonChunk.length + 8 + binChunk.length;
  const out = Buffer.alloc(totalLen);
  out.writeUInt32LE(0x46546c67, 0);
  out.writeUInt32LE(2, 4);
  out.writeUInt32LE(totalLen, 8);
  out.writeUInt32LE(jsonChunk.length, 12);
  out.writeUInt32LE(0x4e4f534a, 16);
  jsonChunk.copy(out, 20);
  const binOff = 20 + jsonChunk.length;
  out.writeUInt32LE(binChunk.length, binOff);
  out.writeUInt32LE(0x004e4942, binOff + 4);
  binChunk.copy(out, binOff + 8);
  return out;
}

export function readAccessorFloat(json, bin, accIdx) {
  const acc = json.accessors[accIdx];
  const bv = json.bufferViews[acc.bufferView];
  const compCount = acc.type === "SCALAR" ? 1 : acc.type === "VEC2" ? 2 : acc.type === "VEC3" ? 3 : 4;
  const compType = acc.componentType;
  const compSize = compType === 5126 || compType === 5125 ? 4 : compType === 5123 || compType === 5122 ? 2 : 1;
  const stride = bv.byteStride || compCount * compSize;
  const baseOff = (bv.byteOffset || 0) + (acc.byteOffset || 0);
  const out = new Float32Array(acc.count * compCount);
  for (let i = 0; i < acc.count; i++) {
    const o = baseOff + i * stride;
    for (let k = 0; k < compCount; k++) {
      const ko = o + k * compSize;
      let v = 0;
      if (compType === 5126) v = bin.readFloatLE(ko);
      else if (compType === 5123) v = bin.readUInt16LE(ko);
      else if (compType === 5122) v = bin.readInt16LE(ko);
      else if (compType === 5121) v = bin.readUInt8(ko);
      else if (compType === 5120) v = bin.readInt8(ko);
      else if (compType === 5125) v = bin.readUInt32LE(ko);
      if (acc.normalized) {
        if (compType === 5121) v /= 255;
        else if (compType === 5120) v = Math.max(-1, v / 127);
        else if (compType === 5123) v /= 65535;
        else if (compType === 5122) v = Math.max(-1, v / 32767);
      }
      out[i * compCount + k] = v;
    }
  }
  return out;
}

export function readAccessorIndices(json, bin, accIdx) {
  const acc = json.accessors[accIdx];
  const bv = json.bufferViews[acc.bufferView];
  const baseOff = (bv.byteOffset || 0) + (acc.byteOffset || 0);
  const out = new Uint32Array(acc.count);
  for (let i = 0; i < acc.count; i++) {
    if (acc.componentType === 5125) out[i] = bin.readUInt32LE(baseOff + i * 4);
    else if (acc.componentType === 5123) out[i] = bin.readUInt16LE(baseOff + i * 2);
    else out[i] = bin.readUInt8(baseOff + i);
  }
  return out;
}

/**
 * Pure-Node PNG RGBA encoder & decoder (for reading Kenney colormaps & generating crisp plate textures).
 */
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (c & 1 ? 0xedb88320 : 0);
  }
  return (c ^ 0xffffffff) >>> 0;
}

export function encodeRgbaPng(width, height, rgba) {
  const raw = Buffer.alloc(height * (1 + width * 4));
  for (let y = 0; y < height; y++) {
    const rowOff = y * (1 + width * 4);
    raw[rowOff] = 0;
    Buffer.from(rgba.buffer, rgba.byteOffset + y * width * 4, width * 4).copy(raw, rowOff + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const idat = zlib.deflateSync(raw, { level: 9 });
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length, 0);
    const t = Buffer.from(type, "ascii");
    const crcBuf = Buffer.alloc(4);
    crcBuf.writeUInt32BE(crc32(Buffer.concat([t, data])), 0);
    return Buffer.concat([len, t, data, crcBuf]);
  };
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", idat),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

export function decodePngRgba(pngBytes) {
  let off = 8;
  let width = 0, height = 0, bitDepth = 8, colorType = 6;
  const idatParts = [];
  let palette = null;
  while (off < pngBytes.length) {
    const len = pngBytes.readUInt32BE(off);
    const type = pngBytes.subarray(off + 4, off + 8).toString("ascii");
    const data = pngBytes.subarray(off + 8, off + 8 + len);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
    } else if (type === "PLTE") {
      palette = data;
    } else if (type === "IDAT") {
      idatParts.push(data);
    } else if (type === "IEND") {
      break;
    }
    off += 12 + len;
  }
  const inflated = zlib.inflateSync(Buffer.concat(idatParts));
  const channels = colorType === 6 ? 4 : colorType === 2 ? 3 : colorType === 3 ? 1 : colorType === 4 ? 2 : 1;
  const bpp = Math.max(1, Math.ceil((channels * bitDepth) / 8));
  const rowBytes = Math.ceil((width * channels * bitDepth) / 8);
  const raw = Buffer.alloc(height * rowBytes);
  const paeth = (a, b, c) => {
    const p = a + b - c;
    const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
    return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
  };
  let src = 0;
  for (let y = 0; y < height; y++) {
    const filter = inflated[src++];
    const rowStart = y * rowBytes;
    for (let i = 0; i < rowBytes; i++) {
      const x = inflated[src++];
      const a = i >= bpp ? raw[rowStart + i - bpp] : 0;
      const b = y > 0 ? raw[rowStart - rowBytes + i] : 0;
      const c = y > 0 && i >= bpp ? raw[rowStart - rowBytes + i - bpp] : 0;
      if (filter === 0) raw[rowStart + i] = x;
      else if (filter === 1) raw[rowStart + i] = (x + a) & 0xff;
      else if (filter === 2) raw[rowStart + i] = (x + b) & 0xff;
      else if (filter === 3) raw[rowStart + i] = (x + ((a + b) >> 1)) & 0xff;
      else raw[rowStart + i] = (x + paeth(a, b, c)) & 0xff;
    }
  }
  const rgba = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const dst = (y * width + x) * 4;
      const rs = y * rowBytes;
      if (colorType === 6) {
        const s = rs + x * 4;
        rgba[dst] = raw[s]; rgba[dst + 1] = raw[s + 1]; rgba[dst + 2] = raw[s + 2]; rgba[dst + 3] = raw[s + 3];
      } else if (colorType === 2) {
        const s = rs + x * 3;
        rgba[dst] = raw[s]; rgba[dst + 1] = raw[s + 1]; rgba[dst + 2] = raw[s + 2]; rgba[dst + 3] = 255;
      } else if (colorType === 3 && palette) {
        const idx = raw[rs + x];
        rgba[dst] = palette[idx * 3]; rgba[dst + 1] = palette[idx * 3 + 1]; rgba[dst + 2] = palette[idx * 3 + 2]; rgba[dst + 3] = 255;
      } else if (colorType === 4) {
        const s = rs + x * 2;
        rgba[dst] = rgba[dst + 1] = rgba[dst + 2] = raw[s]; rgba[dst + 3] = raw[s + 1];
      } else {
        const g = raw[rs + x];
        rgba[dst] = rgba[dst + 1] = rgba[dst + 2] = g; rgba[dst + 3] = 255;
      }
    }
  }
  return { width, height, rgba };
}

/**
 * Generates a crisp 256x128 "WESTGATE" plate PNG texture (navy top band, silver embossed plate).
 */
let _platePngBytes = null;
export function getWestgatePlatePngBytes() {
  if (_platePngBytes) return _platePngBytes;
  const W = 256, H = 128;
  const rgba = new Uint8Array(W * H * 4);
  const setPx = (x, y, r, g, b) => {
    if (x < 0 || y < 0 || x >= W || y >= H) return;
    const i = (y * W + x) * 4;
    rgba[i] = r; rgba[i + 1] = g; rgba[i + 2] = b; rgba[i + 3] = 255;
  };
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const border = x < 5 || x >= W - 5 || y < 5 || y >= H - 5;
      if (border) { setPx(x, y, 22, 28, 40); continue; }
      if (y < 36) { setPx(x, y, 15, 39, 76); continue; }
      const t = (y - 36) / (H - 36);
      const lum = Math.round(238 - t * 28);
      setPx(x, y, lum, lum + 2, Math.min(255, lum + 6));
    }
  }
  // 5x7 bitmap font for "WESTGATE" (header gold) & "WGT-742" (main navy)
  const FONT = {
    W: ["10001","10001","10001","10101","10101","11011","10001"],
    E: ["11111","10000","10000","11110","10000","10000","11111"],
    S: ["01111","10000","10000","01110","00001","00001","11110"],
    T: ["11111","00100","00100","00100","00100","00100","00100"],
    G: ["01110","10001","10000","10111","10001","10001","01110"],
    A: ["01110","10001","10001","11111","10001","10001","10001"],
    "-": ["00000","00000","00000","11111","00000","00000","00000"],
    "7": ["11111","00001","00010","00100","01000","01000","01000"],
    "4": ["00010","00110","01010","10010","11111","00010","00010"],
    "2": ["01110","10001","00001","00110","01000","10000","11111"],
    " ": ["00000","00000","00000","00000","00000","00000","00000"],
  };
  const drawStr = (str, startX, startY, sx, sy, r, g, b) => {
    let cx = startX;
    for (const ch of str) {
      const gl = FONT[ch] || FONT[" "];
      for (let row = 0; row < 7; row++) {
        for (let col = 0; col < 5; col++) {
          if (gl[row][col] === "1") {
            for (let dy = 0; dy < sy; dy++)
              for (let dx = 0; dx < sx; dx++) setPx(cx + col * sx + dx, startY + row * sy + dy, r, g, b);
          }
        }
      }
      cx += 6 * sx;
    }
  };
  drawStr("WESTGATE", 56, 11, 3, 2, 245, 165, 35);
  drawStr("WGT-742", 28, 56, 5, 7, 15, 34, 64);
  _platePngBytes = encodeRgbaPng(W, H, rgba);
  return _platePngBytes;
}

export function toFloat32Geometry(geo) {
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
  if (geo.groups && geo.groups.length > 0) {
    for (const g of geo.groups) out.addGroup(g.start, g.count, g.materialIndex);
  }
  return out;
}

export async function loadGlbViaThree(filePath) {
  const buf = fs.readFileSync(filePath);
  const { json, images } = parseRawGlb(buf);
  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  const gltf = await loader.parseAsync(ab, "");
  // Use GLTFLoader's exact parser associations so every texture maps 1:1 to its embedded image!
  if (gltf.parser?.associations) {
    for (const [obj, assoc] of gltf.parser.associations.entries()) {
      if (obj && obj.isTexture && assoc && typeof assoc.textures === "number") {
        const texDef = json.textures?.[assoc.textures];
        const imgIdx = texDef?.source ?? texDef?.extensions?.EXT_texture_webp?.source;
        if (typeof imgIdx === "number" && images[imgIdx]) {
          obj.userData.__origImageIndex = imgIdx;
        }
      }
    }
  }
  // Convert all quantized / interleaved attributes to full Float32 before any vertex math,
  // and bake any KHR_texture_transform (offset/repeat) directly into Float32 UV coordinates.
  const resetTex = new Set();
  gltf.scene.traverse((o) => {
    if (o.isMesh && o.geometry) {
      o.geometry = toFloat32Geometry(o.geometry);
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      const tex = mats.map((m) => m?.map || m?.normalMap || m?.roughnessMap).find(Boolean);
      const uv = o.geometry.getAttribute("uv");
      if (tex && uv && (tex.offset.x !== 0 || tex.offset.y !== 0 || tex.repeat.x !== 1 || tex.repeat.y !== 1)) {
        const ox = tex.offset.x, oy = tex.offset.y, rx = tex.repeat.x, ry = tex.repeat.y;
        for (let i = 0; i < uv.count; i++) {
          uv.setXY(i, uv.getX(i) * rx + ox, uv.getY(i) * ry + oy);
        }
        uv.needsUpdate = true;
      }
      for (const m of mats) {
        if (!m) continue;
        for (const t of [m.map, m.normalMap, m.roughnessMap, m.metalnessMap, m.aoMap, m.emissiveMap]) {
          if (t) resetTex.add(t);
        }
      }
    }
  });
  for (const tex of resetTex) {
    tex.offset.set(0, 0);
    tex.repeat.set(1, 1);
  }
  return { scene: gltf.scene, json, images };
}

export function cleanDegenerateTriangles(geo, minArea = 1e-10) {
  const pos = geo.getAttribute("position");
  if (!pos) return geo;
  const norm = geo.getAttribute("normal");
  const uv = geo.getAttribute("uv");
  const color = geo.getAttribute("color");
  const idx = geo.getIndex();
  const count = idx ? idx.count : pos.count;
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  const ab = new THREE.Vector3(), ac = new THREE.Vector3(), cr = new THREE.Vector3();

  if (idx) {
    const keep = [];
    for (let i = 0; i + 2 < count; i += 3) {
      const i0 = idx.getX(i), i1 = idx.getX(i + 1), i2 = idx.getX(i + 2);
      if (i0 === i1 || i1 === i2 || i0 === i2) continue;
      a.fromBufferAttribute(pos, i0);
      b.fromBufferAttribute(pos, i1);
      c.fromBufferAttribute(pos, i2);
      ab.subVectors(b, a);
      ac.subVectors(c, a);
      cr.crossVectors(ab, ac);
      if (cr.lengthSq() * 0.25 > minArea) {
        keep.push(i0, i1, i2);
      }
    }
    if (keep.length === count) return geo;
    const out = new THREE.BufferGeometry();
    for (const [k, attr] of Object.entries(geo.attributes)) out.setAttribute(k, attr);
    out.setIndex(keep);
    return out;
  } else {
    const pArr = [], nArr = [], uArr = [], cArr = [];
    for (let i = 0; i + 2 < count; i += 3) {
      a.fromBufferAttribute(pos, i);
      b.fromBufferAttribute(pos, i + 1);
      c.fromBufferAttribute(pos, i + 2);
      ab.subVectors(b, a);
      ac.subVectors(c, a);
      cr.crossVectors(ab, ac);
      if (cr.lengthSq() * 0.25 > minArea) {
        for (let j = 0; j < 3; j++) {
          const vi = i + j;
          pArr.push(pos.getX(vi), pos.getY(vi), pos.getZ(vi));
          if (norm) nArr.push(norm.getX(vi), norm.getY(vi), norm.getZ(vi));
          if (uv) uArr.push(uv.getX(vi), uv.getY(vi));
          if (color) cArr.push(color.getX(vi), color.getY(vi), color.getZ(vi));
        }
      }
    }
    if (pArr.length === pos.count * 3) return geo;
    const out = new THREE.BufferGeometry();
    out.setAttribute("position", new THREE.Float32BufferAttribute(pArr, 3));
    if (norm) out.setAttribute("normal", new THREE.Float32BufferAttribute(nArr, 3));
    if (uv) out.setAttribute("uv", new THREE.Float32BufferAttribute(uArr, 2));
    if (color) out.setAttribute("color", new THREE.Float32BufferAttribute(cArr, 3));
    return out;
  }
}

export function bakeSceneToMeters(scene) {
  scene.updateMatrixWorld(true);
  const invMat = new THREE.Matrix3();
  const v = new THREE.Vector3();
  scene.traverse((o) => {
    if (!o.isMesh) return;
    o.updateMatrixWorld(true);
    const mat4 = o.matrixWorld;
    const geo = o.geometry;
    const pos = geo.getAttribute("position");
    if (pos) {
      for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i).applyMatrix4(mat4);
        pos.setXYZ(i, v.x, v.y, v.z);
      }
      pos.needsUpdate = true;
    }
    const norm = geo.getAttribute("normal");
    if (norm) {
      invMat.getNormalMatrix(mat4);
      for (let i = 0; i < norm.count; i++) {
        v.fromBufferAttribute(norm, i).applyMatrix3(invMat).normalize();
        norm.setXYZ(i, v.x, v.y, v.z);
      }
      norm.needsUpdate = true;
    }
    geo.computeBoundingBox();
    geo.computeBoundingSphere();
  });
  scene.traverse((o) => {
    o.position.set(0, 0, 0);
    o.rotation.set(0, 0, 0);
    o.scale.set(1, 1, 1);
    o.updateMatrix();
  });
  scene.updateMatrixWorld(true);
}

export function serializeThreeToGlb(root, rawImages = []) {
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
  let usesWebp = false;

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
  const customImageMap = new Map();
  const textureMap = new Map();
  const materialMap = new Map();

  const ensureTexture = (tex) => {
    if (!tex) return undefined;
    if (textureMap.has(tex)) return textureMap.get(tex);
    let imgIdx;
    let mime = "image/png";
    if (tex.userData?.__pngBytes) {
      const buf = tex.userData.__pngBytes;
      if (customImageMap.has(buf)) imgIdx = customImageMap.get(buf);
      else {
        const bvIdx = pushBufferView(buf);
        imgIdx = images.length;
        images.push({ bufferView: bvIdx, mimeType: "image/png" });
        customImageMap.set(buf, imgIdx);
      }
    } else {
      const origIdx = tex.userData?.__origImageIndex;
      if (origIdx === undefined || !rawImages[origIdx]) return undefined;
      mime = rawImages[origIdx].mimeType || "image/png";
      if (imageMap.has(origIdx)) imgIdx = imageMap.get(origIdx);
      else {
        const bvIdx = pushBufferView(rawImages[origIdx].bytes);
        imgIdx = images.length;
        images.push({ bufferView: bvIdx, mimeType: mime });
        imageMap.set(origIdx, imgIdx);
      }
    }
    const samplerIdx = samplers.length;
    samplers.push({
      magFilter: 9729,
      minFilter: 9987,
      wrapS: tex.wrapS === THREE.ClampToEdgeWrapping ? 33071 : tex.wrapS === THREE.MirroredRepeatWrapping ? 33648 : 10497,
      wrapT: tex.wrapT === THREE.ClampToEdgeWrapping ? 33071 : tex.wrapT === THREE.MirroredRepeatWrapping ? 33648 : 10497,
    });
    const texIdx = textures.length;
    if (mime === "image/webp") {
      usesWebp = true;
      textures.push({ sampler: samplerIdx, extensions: { EXT_texture_webp: { source: imgIdx } } });
    } else {
      textures.push({ sampler: samplerIdx, source: imgIdx });
    }
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
    const mrTex = ensureTexture(mat.roughnessMap || mat.metalnessMap);
    if (mrTex !== undefined) pbr.metallicRoughnessTexture = { index: mrTex };
    m.pbrMetallicRoughness = pbr;
    const nrmTex = ensureTexture(mat.normalMap);
    if (nrmTex !== undefined) m.normalTexture = { index: nrmTex };
    const occTex = ensureTexture(mat.aoMap);
    if (occTex !== undefined) m.occlusionTexture = { index: occTex };
    const emiTex = ensureTexture(mat.emissiveMap);
    if (emiTex !== undefined) m.emissiveTexture = { index: emiTex };
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

    const primitives = [];
    if (Array.isArray(meshObj.material) && geo.groups && geo.groups.length > 0) {
      for (const grp of geo.groups) {
        const mat = meshObj.material[grp.materialIndex];
        const matIdx = ensureMaterial(mat);
        let iArr;
        if (geo.index) {
          iArr = [];
          for (let i = grp.start; i < grp.start + grp.count; i++) iArr.push(geo.index.getX(i));
        } else {
          iArr = [];
          for (let i = grp.start; i < grp.start + grp.count; i++) iArr.push(i);
        }
        if (iArr.length === 0) continue;
        const prim = { attributes: attrs, mode: 4, indices: pushIndexAccessor(iArr, pos.count) };
        if (matIdx !== undefined) prim.material = matIdx;
        primitives.push(prim);
      }
    } else {
      const mat = Array.isArray(meshObj.material) ? meshObj.material[0] : meshObj.material;
      const matIdx = ensureMaterial(mat);
      const prim = { attributes: attrs, mode: 4 };
      if (matIdx !== undefined) prim.material = matIdx;
      if (geo.index) {
        const iArr = new Array(geo.index.count);
        for (let i = 0; i < geo.index.count; i++) iArr[i] = geo.index.getX(i);
        prim.indices = pushIndexAccessor(iArr, pos.count);
      }
      primitives.push(prim);
    }
    if (primitives.length === 0) return undefined;
    const meshIdx = meshes.length;
    meshes.push({ name: meshObj.name || undefined, primitives });
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
    asset: { version: "2.0", generator: "westgate-asset-upgrade" },
    scene: 0,
    scenes: [{ nodes: sceneNodes }],
    nodes, meshes, materials, accessors, bufferViews,
    buffers: [{ byteLength: binLen }],
  };
  if (textures.length) gltfJson.textures = textures;
  if (images.length) gltfJson.images = images;
  if (samplers.length) gltfJson.samplers = samplers;
  if (usesWebp) {
    gltfJson.extensionsUsed = ["EXT_texture_webp"];
    gltfJson.extensionsRequired = ["EXT_texture_webp"];
  }
  return packGlbChunks(gltfJson, Buffer.concat(binChunks));
}

export function gltfpackOptimize(tmpIn, outPath, { keepNames = false, vp = 14 } = {}) {
  const args = ["-i", tmpIn, "-o", outPath, "-c", "-vp", String(vp), "-vt", "12", "-vn", "10"];
  if (keepNames) args.push("-kn");
  execFileSync(GLTFPACK_BIN, args, { stdio: "pipe" });
}

export function smoothSubdivideMesh(mesh, iters = 1, creaseDeg = 42, weldEps = 1e-4) {
  let geo = mesh.geometry;
  if (!geo?.attributes?.position) return;
  geo = cleanDegenerateTriangles(geo);
  const nonIdx = geo.index ? geo.toNonIndexed() : geo.clone();
  const clean = new THREE.BufferGeometry();
  for (const attrName of ["position", "uv", "uv1", "color"]) {
    const attr = nonIdx.getAttribute(attrName);
    if (attr) clean.setAttribute(attrName, attr);
  }
  const welded = mergeVertices(clean, weldEps);
  const sub = LoopSubdivision.modify(welded, iters, {
    split: false,
    uvSmooth: true,
    preserveEdges: true,
    flatOnly: false,
  });
  mesh.geometry = toCreasedNormals(sub, (creaseDeg * Math.PI) / 180);
}

export function addPlateGroup(name, x, y, z, width = 0.44, height = 0.13, rotY = 0) {
  const grp = new THREE.Group();
  grp.name = `${name}_plate_grp`;
  grp.position.set(x, y, z);
  grp.rotation.y = rotY;
  const frameMat = new THREE.MeshStandardMaterial({
    name: `trim__${name}_plate_frame`,
    color: 0x16191f,
    metalness: 0.25,
    roughness: 0.45,
  });
  const plateTex = new THREE.Texture();
  plateTex.userData.__pngBytes = getWestgatePlatePngBytes();
  const faceMat = new THREE.MeshStandardMaterial({
    name: `plate__${name}`,
    map: plateTex,
    color: 0xffffff,
    metalness: 0.25,
    roughness: 0.28,
  });
  const bezel = new THREE.Mesh(new THREE.BoxGeometry(width + 0.024, height + 0.022, 0.014), frameMat);
  bezel.name = `${name}_plate_bezel`;
  const face = new THREE.Mesh(new THREE.PlaneGeometry(width, height), faceMat);
  face.name = `${name}_plate_face`;
  face.position.z = 0.0085;
  grp.add(bezel, face);
  return grp;
}
