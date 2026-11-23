import * as THREE from "three";

export type SurfaceFamily =
  | "wood"
  | "plaster"
  | "stone"
  | "roof-tile"
  | "metal"
  | "brick"
  | "concrete"
  | "asphalt"
  | "fabric";

interface FamilyStyle {
  tileM: number;
  normal: number;
  albedo: number;
  rough: number;
}

export const SURFACE_STYLE: Record<SurfaceFamily, FamilyStyle> = {
  wood: { tileM: 0.7, normal: 0.25, albedo: 0.76, rough: 0.76 },
  plaster: { tileM: 1.4, normal: 0.45, albedo: 0.84, rough: 0.88 },
  stone: { tileM: 1.0, normal: 0.8, albedo: 0.7, rough: 0.82 },
  "roof-tile": { tileM: 0.45, normal: 0.85, albedo: 0.7, rough: 0.78 },
  metal: { tileM: 0.6, normal: 0.3, albedo: 0.82, rough: 0.45 },
  brick: { tileM: 0.9, normal: 0.75, albedo: 0.72, rough: 0.84 },
  concrete: { tileM: 1.6, normal: 0.5, albedo: 0.78, rough: 0.9 },
  asphalt: { tileM: 1.8, normal: 0.55, albedo: 0.74, rough: 0.92 },
  fabric: { tileM: 0.4, normal: 0.45, albedo: 0.8, rough: 0.92 },
};

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
  repeat = 1
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
    t.needsUpdate = true;
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

  const key = `${cHex}|${roughness.toFixed(2)}|${metalness.toFixed(2)}|${emissive ?? ""}|${emissiveIntensity.toFixed(2)}|${flatShading}|${family ?? ""}|${seed}|${repeat.toFixed(2)}|${doubleSide}`;
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
    const maps = surfaceMaps(family, seed, 256, repeat);
    params.map = maps.map;
    params.normalMap = maps.normalMap;
    params.roughnessMap = maps.roughnessMap;
    params.roughness = Math.min(1, roughness * (2 / (1 + SURFACE_STYLE[family].rough)));
  }

  const mat = new THREE.MeshStandardMaterial(params);
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
