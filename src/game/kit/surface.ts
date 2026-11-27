import * as THREE from "three";
import { westgateEngine } from "../../engine/WestgateCore";

export type SurfaceFamily =
  | "wood"
  | "plaster"
  | "stone"
  | "roof-tile"
  | "metal"
  | "brick"
  | "concrete"
  | "asphalt"
  | "fabric"
  | "grass";

interface FamilyStyle {
  tileM: number;
  normal: number;
  albedo: number;
  rough: number;
}

export const SURFACE_STYLE: Record<SurfaceFamily, FamilyStyle> = {
  wood: { tileM: 1.5, normal: 0.42, albedo: 0.78, rough: 0.72 },
  plaster: { tileM: 2.2, normal: 0.58, albedo: 0.85, rough: 0.88 },
  stone: { tileM: 1.8, normal: 0.95, albedo: 0.74, rough: 0.82 },
  "roof-tile": { tileM: 0.85, normal: 0.95, albedo: 0.68, rough: 0.76 },
  metal: { tileM: 1.4, normal: 0.45, albedo: 0.8, rough: 0.42 },
  brick: { tileM: 1.6, normal: 0.92, albedo: 0.76, rough: 0.84 },
  concrete: { tileM: 2.4, normal: 0.65, albedo: 0.78, rough: 0.88 },
  asphalt: { tileM: 2.0, normal: 0.65, albedo: 0.72, rough: 0.9 },
  fabric: { tileM: 0.5, normal: 0.55, albedo: 0.78, rough: 0.92 },
  grass: { tileM: 2.4, normal: 0.72, albedo: 0.64, rough: 0.93 },
};

const ARCH_PBR_FAMILIES = new Set<SurfaceFamily>(["brick", "concrete", "metal", "plaster", "stone", "wood"]);

/**
 * Rewrites a BoxGeometry's UV attribute in-place so each face maps 1 texture repeat per
 * `[tileU, tileV]` meters (eliminating texture stretching across skyscrapers, walls, and trim).
 */
export function bakeBoxMetricUv(
  geo: THREE.BufferGeometry,
  w: number,
  h: number,
  d: number,
  tileU = 2.0,
  tileV = 2.0,
): THREE.BufferGeometry {
  const pos = geo.attributes.position;
  const norm = geo.attributes.normal;
  const uv = geo.attributes.uv;
  if (!pos || !norm || !uv) return geo;

  const invU = 1 / Math.max(0.15, tileU);
  const invV = 1 / Math.max(0.15, tileV);
  const hw = w * 0.5;
  const hh = h * 0.5;
  const hd = d * 0.5;

  for (let i = 0; i < pos.count; i++) {
    const nx = Math.abs(norm.getX(i));
    const ny = Math.abs(norm.getY(i));
    const px = pos.getX(i);
    const py = pos.getY(i);
    const pz = pos.getZ(i);

    let u: number;
    let v: number;
    if (ny >= nx && ny >= Math.abs(norm.getZ(i))) {
      // Top / bottom
      u = (px + hw) * invU;
      v = (pz + hd) * invV;
    } else if (nx >= ny && nx >= Math.abs(norm.getZ(i))) {
      // Left / right (+X / -X)
      u = (pz + hd) * invU;
      v = (py + hh) * invV;
    } else {
      // Front / back (+Z / -Z)
      u = (px + hw) * invU;
      v = (py + hh) * invV;
    }
    uv.setXY(i, u, v);
  }
  uv.needsUpdate = true;
  return geo;
}

export function seeded(seed: number): () => number {
  let state = seed | 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Lattice {
  cx: number;
  cy: number;
  grid: Float32Array;
}

function lattice(cx: number, cy: number, rng: () => number): Lattice {
  const grid = new Float32Array(cx * cy);
  for (let i = 0; i < grid.length; i++) grid[i] = rng();
  return { cx, cy, grid };
}

function sample(l: Lattice, x: number, y: number): number {
  const fx = x * l.cx;
  const fy = y * l.cy;
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const tx = fx - x0;
  const ty = fy - y0;
  const xa = ((x0 % l.cx) + l.cx) % l.cx;
  const ya = ((y0 % l.cy) + l.cy) % l.cy;
  const xb = xa + 1 === l.cx ? 0 : xa + 1;
  const yb = ya + 1 === l.cy ? 0 : ya + 1;
  const rA = ya * l.cx;
  const rB = yb * l.cx;
  const top = l.grid[rA + xa] + (l.grid[rA + xb] - l.grid[rA + xa]) * tx;
  const bot = l.grid[rB + xa] + (l.grid[rB + xb] - l.grid[rB + xa]) * tx;
  return top + (bot - top) * ty;
}

function fbm(layers: Lattice[], x: number, y: number): number {
  let v = 0;
  let w = 0;
  let a = 1;
  for (let i = 0; i < layers.length; i++) {
    v += sample(layers[i], x, y) * a;
    w += a;
    a *= 0.5;
  }
  return v / w;
}

function joint(t: number): number {
  const f = ((t % 1) + 1) % 1;
  return 0.5 - Math.abs(f - 0.5);
}

function drawHeight(family: SurfaceFamily, size: number, rng: () => number): Float32Array {
  const out = new Float32Array(size * size);
  const fill = (fn: (u: number, v: number) => number) => {
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        out[y * size + x] = Math.min(1, Math.max(0, fn(x / size, y / size)));
      }
    }
  };

  if (family === "wood") {
    const g = [lattice(4, 4, rng), lattice(16, 16, rng), lattice(48, 48, rng)];
    const planks = 4;
    fill((x, y) => {
      const plank = Math.floor(y * planks);
      const warp = fbm(g, x, y);
      const u = x + ((plank * 0.37) % 1) + warp * 0.1;
      const rings = Math.abs(Math.sin(u * 27 * Math.PI + warp * 5));
      const seam = Math.min(1, joint(y * planks) * 14);
      return 0.5 + 0.34 * rings * seam + 0.16 * sample(g[2], x * 2, y * 2);
    });
  } else if (family === "plaster" || family === "concrete") {
    const c = [lattice(6, 6, rng), lattice(18, 18, rng), lattice(64, 64, rng)];
    fill((x, y) => 0.44 + 0.42 * fbm(c, x, y) + 0.14 * sample(c[2], x * 2, y * 2));
  } else if (family === "stone" || family === "brick") {
    const r = [lattice(8, 8, rng), lattice(24, 24, rng), lattice(64, 64, rng)];
    const rows = family === "brick" ? 8 : 5;
    const cols = family === "brick" ? 4 : 4;
    fill((x, y) => {
      const row = Math.floor(y * rows);
      const u = (x + (row % 2) * 0.5) * cols;
      const face = Math.min(1, Math.min(joint(u), joint(y * rows)) * (family === "brick" ? 11 : 9));
      const blk = sample(r[0], (Math.floor(u) + 0.5) / cols, (row + 0.5) / rows);
      return 0.2 + 0.5 * face * (0.7 + 0.3 * blk) + 0.28 * fbm(r, x, y) * face;
    });
  } else if (family === "roof-tile") {
    const c = [lattice(8, 8, rng), lattice(24, 24, rng)];
    const rows = 7;
    const per = 6;
    fill((x, y) => {
      const row = Math.floor(y * rows);
      const u = (x + (row % 2) * 0.5) * per;
      const lap = (y * rows) % 1;
      const groove = Math.min(1, joint(u) * 11);
      const course = Math.min(1, lap * 7) * (0.72 + 0.28 * Math.min(1, (1 - lap) * 3));
      const tint = 0.8 + 0.4 * sample(c[0], (Math.floor(u) + 0.5) / per, (row + 0.5) / rows);
      return (0.22 + 0.52 * groove * course) * tint + 0.12 * fbm(c, x * 2, y * 2);
    });
  } else if (family === "metal") {
    const b = [lattice(4, 4, rng), lattice(16, 16, rng)];
    const streak = lattice(4, 128, rng);
    fill((x, y) => 0.58 + 0.26 * sample(streak, x, y) + 0.16 * fbm(b, x, y));
  } else if (family === "asphalt") {
    const a = [lattice(8, 8, rng), lattice(32, 32, rng), lattice(96, 96, rng)];
    fill((x, y) => 0.35 + 0.4 * fbm(a, x, y) + 0.25 * sample(a[2], x * 2, y * 2));
  } else if (family === "grass") {
    const g0 = [lattice(10, 10, rng), lattice(32, 32, rng), lattice(96, 96, rng)];
    fill((x, y) => {
      const tuft = fbm(g0, x, y);
      const blade = sample(g0[2], x * 3.0, y * 3.0);
      const streak = Math.abs(Math.sin((x * 22 + tuft * 3.2) * Math.PI)) * 0.14;
      return 0.32 + 0.44 * tuft + 0.22 * blade + streak;
    });
  } else {
    // fabric
    const f = [lattice(16, 16, rng), lattice(48, 48, rng)];
    fill((x, y) => {
      const warp = Math.sin(x * 80 * Math.PI) * 0.08 + Math.sin(y * 80 * Math.PI) * 0.08;
      return 0.56 + warp + 0.28 * fbm(f, x, y);
    });
  }
  return out;
}

function makeCanvasTexture(
  data: Uint8ClampedArray,
  size: number,
  colorSpace: THREE.ColorSpace,
  repeat = 1,
): THREE.Texture {
  if (typeof document === "undefined") {
    const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
    tex.colorSpace = colorSpace;
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(repeat, repeat);
    tex.needsUpdate = true;
    return tex;
  }
  const c = document.createElement("canvas");
  c.width = size;
  c.height = size;
  const ctx = c.getContext("2d");
  if (ctx) {
    const img = ctx.createImageData(size, size);
    img.data.set(data);
    ctx.putImageData(img, 0, 0);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = colorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeat, repeat);
  tex.anisotropy = westgateEngine.getMaxAnisotropy();
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.needsUpdate = true;
  return tex;
}

export interface SurfaceMaps {
  map: THREE.Texture;
  normalMap: THREE.Texture;
  roughnessMap: THREE.Texture;
}

const mapCache = new Map<string, SurfaceMaps>();

interface ArchPbrBundle {
  colorNative: THREE.Texture | null;
  colorNeutral: THREE.Texture | null;
  normal: THREE.Texture | null;
  rough: THREE.Texture | null;
  waiters: Array<(b: ArchPbrBundle) => void>;
}

const archPbrCache = new Map<SurfaceFamily, ArchPbrBundle>();
let sharedTexLoader: THREE.TextureLoader | null = null;

function buildLuminanceNormalizedAlbedo(img: HTMLImageElement | ImageBitmap): THREE.CanvasTexture | null {
  if (typeof document === "undefined") return null;
  const size = 512;
  const c = document.createElement("canvas");
  c.width = size;
  c.height = size;
  const ctx = c.getContext("2d");
  if (!ctx) return null;
  ctx.drawImage(img as CanvasImageSource, 0, 0, size, size);
  const im = ctx.getImageData(0, 0, size, size);
  const d = im.data;
  let sum = 0;
  for (let i = 0; i < d.length; i += 4) {
    sum += 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
  }
  const mean = Math.max(40, sum / (size * size));
  const targetMean = 224; // keeps tinted hues vivid while preserving masonry mortar & grain contrast
  for (let i = 0; i < d.length; i += 4) {
    const lum = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    const v = Math.min(255, Math.max(58, Math.round((lum / mean) * targetMean)));
    d[i] = v;
    d[i + 1] = v;
    d[i + 2] = v;
  }
  ctx.putImageData(im, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = westgateEngine.getMaxAnisotropy();
  tex.needsUpdate = true;
  return tex;
}

function subscribeArchPbr(family: SurfaceFamily, onReady: (b: ArchPbrBundle) => void): void {
  if (!ARCH_PBR_FAMILIES.has(family)) return;
  if (!westgateEngine.allowExternalArchPbr()) return;
  if (
    typeof window === "undefined" ||
    typeof document === "undefined" ||
    typeof document.createElementNS !== "function" ||
    typeof Image === "undefined"
  ) {
    return;
  }

  let bundle = archPbrCache.get(family);
  if (bundle) {
    if (bundle.colorNative && bundle.normal && bundle.rough) {
      onReady(bundle);
    } else {
      bundle.waiters.push(onReady);
    }
    return;
  }

  bundle = {
    colorNative: null,
    colorNeutral: null,
    normal: null,
    rough: null,
    waiters: [onReady],
  };
  archPbrCache.set(family, bundle);

  if (!sharedTexLoader) sharedTexLoader = new THREE.TextureLoader();
  const base = (import.meta as unknown as { env?: { BASE_URL?: string } }).env?.BASE_URL ?? "/";
  const prefix = `${base}textures/arch/${family}`;

  let pending = 3;
  const finishOne = () => {
    pending -= 1;
    if (pending <= 0 && bundle) {
      const ws = bundle.waiters.splice(0, bundle.waiters.length);
      for (const fn of ws) fn(bundle);
    }
  };

  sharedTexLoader.load(
    `${prefix}/color.jpg`,
    (t) => {
      t.colorSpace = THREE.SRGBColorSpace;
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.anisotropy = 16;
      bundle!.colorNative = t;
      if (t.image) bundle!.colorNeutral = buildLuminanceNormalizedAlbedo(t.image as HTMLImageElement);
      finishOne();
    },
    undefined,
    finishOne,
  );
  sharedTexLoader.load(
    `${prefix}/normal.jpg`,
    (t) => {
      t.colorSpace = THREE.NoColorSpace;
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.anisotropy = 16;
      bundle!.normal = t;
      finishOne();
    },
    undefined,
    finishOne,
  );
  sharedTexLoader.load(
    `${prefix}/rough.jpg`,
    (t) => {
      t.colorSpace = THREE.NoColorSpace;
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.anisotropy = 16;
      bundle!.rough = t;
      finishOne();
    },
    undefined,
    finishOne,
  );
}

export function surfaceMaps(family: SurfaceFamily, seed = 1, size = 256, repeat = 1): SurfaceMaps {
  const key = `${family}|${seed}|${size}|${repeat.toFixed(2)}`;
  const hit = mapCache.get(key);
  if (hit) return hit;

  const baseKey = `${family}|${seed}|${size}|1.00`;
  let base = mapCache.get(baseKey);
  if (!base) {
    const style = SURFACE_STYLE[family];
    const rng = seeded(seed);
    const h = drawHeight(family, size, rng);

    const albedoData = new Uint8ClampedArray(size * size * 4);
    const lowA = style.albedo;
    for (let i = 0; i < h.length; i++) {
      const v = Math.round(255 * (lowA + (1 - lowA) * h[i]));
      albedoData[i * 4] = v;
      albedoData[i * 4 + 1] = v;
      albedoData[i * 4 + 2] = v;
      albedoData[i * 4 + 3] = 255;
    }

    const roughData = new Uint8ClampedArray(size * size * 4);
    const lowR = style.rough;
    for (let i = 0; i < h.length; i++) {
      const v = Math.round(255 * (lowR + (1 - lowR) * (1 - h[i] * 0.65)));
      roughData[i * 4] = v;
      roughData[i * 4 + 1] = v;
      roughData[i * 4 + 2] = v;
      roughData[i * 4 + 3] = 255;
    }

    const normData = new Uint8ClampedArray(size * size * 4);
    const gain = style.normal * 5.0;
    for (let y = 0; y < size; y++) {
      const up = ((y + size - 1) % size) * size;
      const row = y * size;
      const dn = ((y + 1) % size) * size;
      for (let x = 0; x < size; x++) {
        const xl = (x + size - 1) % size;
        const xr = (x + 1) % size;
        const dx =
          h[up + xr] + 2 * h[row + xr] + h[dn + xr] - h[up + xl] - 2 * h[row + xl] - h[dn + xl];
        const dy =
          h[dn + xl] + 2 * h[dn + x] + h[dn + xr] - h[up + xl] - 2 * h[up + x] - h[up + xr];
        const nx = -dx * gain;
        const ny = -dy * gain;
        const len = Math.hypot(nx, ny, 1);
        const idx = (row + x) * 4;
        normData[idx] = Math.round(255 * ((nx / len) * 0.5 + 0.5));
        normData[idx + 1] = Math.round(255 * ((ny / len) * 0.5 + 0.5));
        normData[idx + 2] = Math.round(255 * ((1 / len) * 0.5 + 0.5));
        normData[idx + 3] = 255;
      }
    }

    base = {
      map: makeCanvasTexture(albedoData, size, THREE.SRGBColorSpace, 1),
      normalMap: makeCanvasTexture(normData, size, THREE.NoColorSpace, 1),
      roughnessMap: makeCanvasTexture(roughData, size, THREE.NoColorSpace, 1),
    };
    mapCache.set(baseKey, base);
    if (repeat === 1) return base;
  }

  const cloneTex = (src: THREE.Texture) => {
    const t = src.clone();
    t.repeat.set(repeat, repeat);
    // Only flag an upload when the shared source actually holds image data.
    // Flagging a still-empty clone makes WebGLRenderer warn
    // "Texture marked for update but no image data found" every frame.
    if (t.image) t.needsUpdate = true;
    return t;
  };
  const tuned: SurfaceMaps = {
    map: cloneTex(base.map),
    normalMap: cloneTex(base.normalMap),
    roughnessMap: cloneTex(base.roughnessMap),
  };
  mapCache.set(key, tuned);
  return tuned;
}

const matCache = new Map<string, THREE.MeshStandardMaterial>();
const whiteCache = new WeakMap<THREE.MeshStandardMaterial, THREE.MeshStandardMaterial>();

export interface MatOpts {
  roughness?: number;
  metalness?: number;
  emissive?: THREE.ColorRepresentation | null;
  emissiveIntensity?: number;
  flatShading?: boolean;
  family?: SurfaceFamily;
  seed?: number;
  repeat?: number;
  doubleSide?: boolean;
  /** When true (or color is pure white 0xffffff), binds the raw full-color ambientCG albedo texture. */
  nativeAlbedo?: boolean;
}

export function materialFor(color: THREE.ColorRepresentation, opts: MatOpts = {}): THREE.MeshStandardMaterial {
  const cHex = "#" + new THREE.Color(color).getHexString();
  const roughness = opts.roughness ?? 0.72;
  const metalness = opts.metalness ?? 0;
  const emissive = opts.emissive ? "#" + new THREE.Color(opts.emissive).getHexString() : null;
  const emissiveIntensity = opts.emissiveIntensity ?? 0;
  const flatShading = opts.flatShading ?? false;
  const family = opts.family ?? null;
  const seed = opts.seed ?? 1;
  const repeat = opts.repeat ?? 1;
  const doubleSide = opts.doubleSide ?? false;
  const nativeAlbedo = opts.nativeAlbedo ?? cHex === "#ffffff";

  const key = `${cHex}|${roughness.toFixed(2)}|${metalness.toFixed(2)}|${emissive ?? ""}|${emissiveIntensity.toFixed(2)}|${flatShading}|${family ?? ""}|${seed}|${repeat.toFixed(2)}|${doubleSide}|${nativeAlbedo}`;
  const hit = matCache.get(key);
  if (hit) return hit;

  const params: THREE.MeshStandardMaterialParameters = {
    color: cHex,
    roughness,
    metalness,
    flatShading,
    side: doubleSide ? THREE.DoubleSide : THREE.FrontSide,
  };
  if (emissive) {
    params.emissive = emissive;
    params.emissiveIntensity = emissiveIntensity;
  }
  if (family) {
    const texSize = westgateEngine.getSurfaceTexSize();
    const maps = surfaceMaps(family, seed, texSize, repeat);
    params.map = maps.map;
    params.normalMap = maps.normalMap;
    params.roughnessMap = maps.roughnessMap;
    params.roughness = Math.min(1, roughness * (2 / (1 + SURFACE_STYLE[family].rough)));
  }

  const mat = new THREE.MeshStandardMaterial(params);

  // Upgrade architectural families asynchronously with 1K CC0 ambientCG PBR textures
  if (family && ARCH_PBR_FAMILIES.has(family)) {
    subscribeArchPbr(family, (bundle) => {
      const bindTex = (src: THREE.Texture | null): THREE.Texture | null => {
        if (!src) return null;
        if (repeat === 1) return src;
        const c = src.clone();
        c.repeat.set(repeat, repeat);
        // Guard the upload flag: cloning an arch-PBR texture that has not
        // decoded yet must not queue a texture upload with no image, which
        // spams "Texture marked for update but no image data found".
        if (c.image) c.needsUpdate = true;
        return c;
      };
      const chosenColor = nativeAlbedo ? bundle.colorNative : (bundle.colorNeutral ?? bundle.colorNative);
      const mapTex = bindTex(chosenColor);
      const normTex = bindTex(bundle.normal);
      const roughTex = bindTex(bundle.rough);
      if (mapTex) mat.map = mapTex;
      if (normTex) {
        mat.normalMap = normTex;
        mat.normalScale.set(family === "brick" || family === "stone" ? 1.15 : 0.9, family === "brick" || family === "stone" ? 1.15 : 0.9);
      }
      if (roughTex) {
        mat.roughnessMap = roughTex;
        mat.roughness = family === "metal" ? Math.min(0.65, roughness + 0.15) : 0.95;
      }
      mat.needsUpdate = true;
    });
  }

  matCache.set(key, mat);
  return mat;
}

export function whiteBasedMaterial(mat: THREE.MeshStandardMaterial): THREE.MeshStandardMaterial {
  const hit = whiteCache.get(mat);
  if (hit) return hit;
  const clone = mat.clone();
  clone.color.setRGB(1, 1, 1);
  whiteCache.set(mat, clone);
  return clone;
}
