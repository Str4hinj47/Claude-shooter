import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const ROOT = process.cwd();
const HERO_TARGET_DIM = 2048;
const PROP_TARGET_DIM = 1024;

function collectGlbs(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) collectGlbs(full, out);
    else if (ent.name.endsWith(".glb")) out.push(full);
  }
  return out;
}

function getImageDims(buf, mime) {
  if (buf.length < 24) return null;
  if (mime === "image/png" || (buf[0] === 0x89 && buf[1] === 0x50)) {
    return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20), ext: "png" };
  }
  if (mime === "image/jpeg" || (buf[0] === 0xff && buf[1] === 0xd8)) {
    let off = 2;
    while (off < buf.length - 8) {
      const marker = buf.readUInt16BE(off);
      const len = buf.readUInt16BE(off + 2);
      if (marker >= 0xffc0 && marker <= 0xffc3) {
        return { w: buf.readUInt16BE(off + 5), h: buf.readUInt16BE(off + 7), ext: "jpg" };
      }
      off += 2 + len;
    }
  }
  if (mime === "image/webp" || (buf.subarray(0, 4).toString("ascii") === "RIFF" && buf.subarray(8, 12).toString("ascii") === "WEBP")) {
    try {
      const tmp = path.join(os.tmpdir(), `webp_probe_${process.pid}.webp`);
      fs.writeFileSync(tmp, buf);
      const out = execFileSync("identify", ["-format", "%w %h", tmp], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
      fs.unlinkSync(tmp);
      const [w, h] = out.split(/\s+/).map(Number);
      if (w > 0 && h > 0) return { w, h, ext: "webp" };
    } catch {
      return null;
    }
  }
  return null;
}

function isOpaqueImage(tmpPath) {
  try {
    const res = execFileSync("identify", ["-format", "%[opaque]", tmpPath], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    return res.toLowerCase() === "true";
  } catch {
    return false;
  }
}

function pad4(buf) {
  const rem = buf.length & 3;
  if (rem === 0) return buf;
  return Buffer.concat([buf, Buffer.alloc(4 - rem, 0)]);
}

function processGlb(filePath, targetMax) {
  const orig = fs.readFileSync(filePath);
  if (orig.readUInt32LE(0) !== 0x46546c67 || orig.readUInt32LE(4) !== 2) {
    return { status: "skip-not-glb2" };
  }
  const jlen = orig.readUInt32LE(12);
  const gltf = JSON.parse(orig.subarray(20, 20 + jlen).toString("utf8"));
  const binHeaderOff = 20 + jlen;
  if (orig.readUInt32LE(binHeaderOff + 4) !== 0x004e4942) {
    return { status: "skip-no-bin" };
  }
  const binLen = orig.readUInt32LE(binHeaderOff);
  const bin = orig.subarray(binHeaderOff + 8, binHeaderOff + 8 + binLen);

  let samplersTouched = false;
  if (Array.isArray(gltf.samplers)) {
    for (const s of gltf.samplers) {
      if (s.magFilter !== 9729 || s.minFilter !== 9987) {
        s.magFilter = 9729; // LINEAR
        s.minFilter = 9987; // LINEAR_MIPMAP_LINEAR
        samplersTouched = true;
      }
    }
  }

  const images = gltf.images ?? [];
  const imgBvMap = new Map();
  for (let i = 0; i < images.length; i++) {
    const img = images[i];
    if (img.bufferView != null) {
      imgBvMap.set(img.bufferView, i);
    }
  }

  let upgradedCount = 0;
  const newBvSlices = [];
  let cursor = 0;

  for (let bvIdx = 0; bvIdx < (gltf.bufferViews?.length ?? 0); bvIdx++) {
    const bv = gltf.bufferViews[bvIdx];
    const meshoptExt = bv.extensions?.EXT_meshopt_compression;

    // Determine exact byte range in the original BIN chunk (buffer 0)
    if (meshoptExt) {
      if ((meshoptExt.buffer ?? 0) !== 0) {
        throw new Error(`Unsupported meshopt buffer index in ${filePath}`);
      }
      const mStart = meshoptExt.byteOffset ?? 0;
      const mSlice = bin.subarray(mStart, mStart + meshoptExt.byteLength);
      const alignedOffset = (cursor + 3) & ~3;
      if (alignedOffset > cursor) {
        newBvSlices.push(Buffer.alloc(alignedOffset - cursor, 0));
        cursor = alignedOffset;
      }
      meshoptExt.byteOffset = cursor;
      newBvSlices.push(mSlice);
      cursor += mSlice.length;
      continue;
    }

    const start = bv.byteOffset ?? 0;
    const rawSlice = bin.subarray(start, start + bv.byteLength);
    let finalSlice = rawSlice;

    if (imgBvMap.has(bvIdx)) {
      const imgIdx = imgBvMap.get(bvIdx);
      const img = images[imgIdx];
      const info = getImageDims(rawSlice, img.mimeType || "");
      const maxDim = info ? Math.max(info.w, info.h) : 0;
      const needsResize = info && maxDim < targetMax;

      if (info && needsResize) {
        const tmpIn = path.join(os.tmpdir(), `glb_up_in_${process.pid}_${imgIdx}.${info.ext}`);
        let outExt = info.ext;
        let outMime = img.mimeType || (info.ext === "png" ? "image/png" : info.ext === "jpg" ? "image/jpeg" : "image/webp");
        let tmpOut = path.join(os.tmpdir(), `glb_up_out_${process.pid}_${imgIdx}.${outExt}`);
        try {
          fs.writeFileSync(tmpIn, rawSlice);
          // Opaque PNGs upscale cleanly into 2048px JPEG without multi-MB RGBA PNG bloat
          let effectiveTarget = targetMax;
          if (info.ext === "png") {
            if (isOpaqueImage(tmpIn)) {
              outExt = "jpg";
              outMime = "image/jpeg";
              tmpOut = path.join(os.tmpdir(), `glb_up_out_${process.pid}_${imgIdx}.jpg`);
            } else {
              // Transparent alpha PNGs (e.g. hair/eyelash masks or wheel rims) cap at 1024px/1536px to keep size lean
              effectiveTarget = Math.min(targetMax, 1024);
            }
          }
          const scale = effectiveTarget / maxDim;
          const newW = Math.max(16, Math.round(info.w * scale));
          const newH = Math.max(16, Math.round(info.h * scale));
          if (newW > info.w || newH > info.h) {
            const args = [
              tmpIn,
              "-strip",
              "-filter",
              "Lanczos",
              "-resize",
              `${newW}x${newH}!`,
              "-unsharp",
              "0x0.6+0.42+0.02",
            ];
            if (outExt === "jpg") {
              args.push("-sampling-factor", "4:2:0", "-quality", "86");
            } else if (outExt === "webp") {
              args.push("-quality", "85");
            } else {
              args.push("-define", "png:compression-level=9");
            }
            args.push(tmpOut);
            execFileSync("convert", args, { stdio: "pipe" });
            const outBytes = fs.readFileSync(tmpOut);
            if (outBytes.length > 0) {
              finalSlice = outBytes;
              img.mimeType = outMime;
              upgradedCount++;
            }
          }
        } finally {
          if (fs.existsSync(tmpIn)) fs.unlinkSync(tmpIn);
          if (fs.existsSync(tmpOut)) fs.unlinkSync(tmpOut);
        }
      }
    }

    const alignedOffset = (cursor + 3) & ~3;
    if (alignedOffset > cursor) {
      newBvSlices.push(Buffer.alloc(alignedOffset - cursor, 0));
      cursor = alignedOffset;
    }
    bv.byteOffset = cursor;
    bv.byteLength = finalSlice.length;
    newBvSlices.push(finalSlice);
    cursor += finalSlice.length;
  }

  if (upgradedCount === 0 && !samplersTouched) {
    return { status: "unchanged", upgradedCount: 0 };
  }

  const newBin = pad4(Buffer.concat(newBvSlices));
  if (gltf.buffers?.[0]) {
    gltf.buffers[0].byteLength = newBin.length;
  }

  const jsonBufRaw = Buffer.from(JSON.stringify(gltf), "utf8");
  const jsonRem = jsonBufRaw.length & 3;
  const jsonBuf = jsonRem === 0 ? jsonBufRaw : Buffer.concat([jsonBufRaw, Buffer.alloc(4 - jsonRem, 0x20)]);

  const totalLen = 12 + 8 + jsonBuf.length + 8 + newBin.length;
  const header = Buffer.alloc(12);
  header.writeUInt32LE(0x46546c67, 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(totalLen, 8);

  const jsonChunkHdr = Buffer.alloc(8);
  jsonChunkHdr.writeUInt32LE(jsonBuf.length, 0);
  jsonChunkHdr.writeUInt32LE(0x4e4f534a, 4);

  const binChunkHdr = Buffer.alloc(8);
  binChunkHdr.writeUInt32LE(newBin.length, 0);
  binChunkHdr.writeUInt32LE(0x004e4942, 4);

  const outBuf = Buffer.concat([header, jsonChunkHdr, jsonBuf, binChunkHdr, newBin]);
  fs.writeFileSync(filePath, outBuf);
  return {
    status: "upgraded",
    upgradedCount,
    beforeKB: Math.round(orig.length / 1024),
    afterKB: Math.round(outBuf.length / 1024),
  };
}

const charGlbs = collectGlbs(path.join(ROOT, "public/characters"));
const modelGlbs = collectGlbs(path.join(ROOT, "public/models")).filter((f) => !f.includes(`${path.sep}houses${path.sep}`));

for (const file of [...charGlbs, ...modelGlbs]) {
  const base = path.basename(file);
  const isProp = /^(ph_|kk_|int_|traffic_cone|loader_tractor)/.test(base);
  const targetMax = isProp ? PROP_TARGET_DIM : HERO_TARGET_DIM;
  const res = processGlb(file, targetMax);
  if (res.status === "upgraded") {
    console.log(`✔ ${path.relative(ROOT, file)} (${targetMax}px): ${res.upgradedCount} imgs (${res.beforeKB}KB -> ${res.afterKB}KB)`);
  }
}
