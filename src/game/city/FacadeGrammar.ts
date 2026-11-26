import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { bakeBoxMetricUv, materialFor, type SurfaceFamily } from "../kit/surface";
import {
  registerNightGlowMaterial,
  type FacadeStyle,
} from "./CityBuildingKit";

export type FacadeGrammarKind = "curtainwall" | "grid" | "louver" | "classical";
export type FacadeRhythm = "regular" | "alternate" | "group" | "random";

export interface FacadeGrammarSpec {
  kind: FacadeGrammarKind;
  primaryFamily: SurfaceFamily;
  primaryColor: number;
  primaryTile: [number, number];
  secondaryFamily: SurfaceFamily;
  secondaryColor: number;
  secondaryTile: [number, number];
  frameColor: number;
  glassColor: number;
  litEmissiveColor: number;
  rhythm: FacadeRhythm;
  windowRatio: number;
  floorHeight: number;
  bayWidth: number;
  divisions: number;
  louversPerFloor: number;
  louverDepth: number;
  storefront: boolean;
  parapetHeight: number;
  coreColor: number;
}

/** Deterministic PRNG & path hashing adapted from Nonmaju/facade-studio (MIT). */
function hashSeed(seed: number, path: string): number {
  let h = (2166136261 ^ (seed | 0)) >>> 0;
  for (let i = 0; i < path.length; i++) {
    h ^= path.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

function mulberry32(a: number): () => number {
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeRhythmPattern(rhythm: FacadeRhythm, bays: number, seed: number): string {
  if (rhythm === "regular") return "A";
  if (rhythm === "alternate") return "AB";
  if (rhythm === "group") return "AAB";
  const rand = mulberry32(hashSeed(seed, "rhythm"));
  const letters = Array.from({ length: Math.max(1, bays) }, () => (rand() < 0.32 ? "B" : "A"));
  if (!letters.includes("A")) letters[0] = "A";
  return letters.join("");
}

export const FACADE_PRESETS: Record<FacadeStyle, FacadeGrammarSpec> = {
  glass_teal: {
    kind: "curtainwall",
    primaryFamily: "metal",
    primaryColor: 0x2c4b57,
    primaryTile: [1.6, 1.6],
    secondaryFamily: "metal",
    secondaryColor: 0x3b6778,
    secondaryTile: [1.6, 1.6],
    frameColor: 0x202c35,
    glassColor: 0x4b7f96,
    litEmissiveColor: 0xbfe7ff,
    rhythm: "regular",
    windowRatio: 0.72,
    floorHeight: 4.1,
    bayWidth: 3.8,
    divisions: 2,
    louversPerFloor: 4,
    louverDepth: 0.18,
    storefront: true,
    parapetHeight: 0.75,
    coreColor: 0x16242d,
  },
  glass_navy: {
    kind: "curtainwall",
    primaryFamily: "metal",
    primaryColor: 0x22364d,
    primaryTile: [1.6, 1.6],
    secondaryFamily: "stone",
    secondaryColor: 0x394b61,
    secondaryTile: [2.0, 2.0],
    frameColor: 0x1c2530,
    glassColor: 0x355c82,
    litEmissiveColor: 0xaed4ff,
    rhythm: "alternate",
    windowRatio: 0.74,
    floorHeight: 4.2,
    bayWidth: 3.8,
    divisions: 2,
    louversPerFloor: 4,
    louverDepth: 0.18,
    storefront: true,
    parapetHeight: 0.85,
    coreColor: 0x131d29,
  },
  glass_gold: {
    kind: "curtainwall",
    primaryFamily: "metal",
    primaryColor: 0x6b583d,
    primaryTile: [1.6, 1.6],
    secondaryFamily: "stone",
    secondaryColor: 0x8a7554,
    secondaryTile: [2.0, 2.0],
    frameColor: 0x362b1c,
    glassColor: 0x8a7446,
    litEmissiveColor: 0xffe4a3,
    rhythm: "group",
    windowRatio: 0.7,
    floorHeight: 4.0,
    bayWidth: 3.6,
    divisions: 2,
    louversPerFloor: 4,
    louverDepth: 0.2,
    storefront: true,
    parapetHeight: 0.85,
    coreColor: 0x251e14,
  },
  glass_slate: {
    kind: "louver",
    primaryFamily: "concrete",
    primaryColor: 0x525b66,
    primaryTile: [2.4, 2.4],
    secondaryFamily: "metal",
    secondaryColor: 0x6d7785,
    secondaryTile: [1.6, 1.6],
    frameColor: 0x222830,
    glassColor: 0x456075,
    litEmissiveColor: 0xcbe3f5,
    rhythm: "alternate",
    windowRatio: 0.66,
    floorHeight: 3.9,
    bayWidth: 3.8,
    divisions: 2,
    louversPerFloor: 3,
    louverDepth: 0.22,
    storefront: true,
    parapetHeight: 0.75,
    coreColor: 0x1a2026,
  },
  limestone: {
    kind: "grid",
    primaryFamily: "stone",
    primaryColor: 0xd8d0c0,
    primaryTile: [2.0, 2.0],
    secondaryFamily: "stone",
    secondaryColor: 0xbdb3a0,
    secondaryTile: [2.0, 2.0],
    frameColor: 0x3d3b38,
    glassColor: 0x2e4556,
    litEmissiveColor: 0xffdf9e,
    rhythm: "regular",
    windowRatio: 0.56,
    floorHeight: 3.7,
    bayWidth: 3.5,
    divisions: 1,
    louversPerFloor: 3,
    louverDepth: 0.16,
    storefront: true,
    parapetHeight: 0.7,
    coreColor: 0x242220,
  },
  granite_dark: {
    kind: "grid",
    primaryFamily: "stone",
    primaryColor: 0x4d535c,
    primaryTile: [2.0, 2.0],
    secondaryFamily: "metal",
    secondaryColor: 0x363b42,
    secondaryTile: [1.6, 1.6],
    frameColor: 0x1d2228,
    glassColor: 0x2c4254,
    litEmissiveColor: 0xffe0a8,
    rhythm: "alternate",
    windowRatio: 0.58,
    floorHeight: 3.9,
    bayWidth: 3.6,
    divisions: 1,
    louversPerFloor: 3,
    louverDepth: 0.18,
    storefront: true,
    parapetHeight: 0.8,
    coreColor: 0x181c21,
  },
  brick_red: {
    kind: "grid",
    primaryFamily: "brick",
    primaryColor: 0xa64e3e,
    primaryTile: [1.8, 0.9],
    secondaryFamily: "stone",
    secondaryColor: 0xc2b29c,
    secondaryTile: [1.8, 1.8],
    frameColor: 0x2b2826,
    glassColor: 0x2a3e4f,
    litEmissiveColor: 0xffd28a,
    rhythm: "group",
    windowRatio: 0.54,
    floorHeight: 3.5,
    bayWidth: 3.3,
    divisions: 1,
    louversPerFloor: 3,
    louverDepth: 0.14,
    storefront: true,
    parapetHeight: 0.65,
    coreColor: 0x201c1a,
  },
  brick_tan: {
    kind: "grid",
    primaryFamily: "brick",
    primaryColor: 0xc7a379,
    primaryTile: [1.8, 0.9],
    secondaryFamily: "stone",
    secondaryColor: 0xd8cbb6,
    secondaryTile: [1.8, 1.8],
    frameColor: 0x322d28,
    glassColor: 0x2e4354,
    litEmissiveColor: 0xffd796,
    rhythm: "alternate",
    windowRatio: 0.55,
    floorHeight: 3.5,
    bayWidth: 3.4,
    divisions: 1,
    louversPerFloor: 3,
    louverDepth: 0.14,
    storefront: true,
    parapetHeight: 0.65,
    coreColor: 0x211e1a,
  },
  concrete_mod: {
    kind: "louver",
    primaryFamily: "concrete",
    primaryColor: 0x9ca2aa,
    primaryTile: [2.4, 2.4],
    secondaryFamily: "metal",
    secondaryColor: 0x626a73,
    secondaryTile: [1.6, 1.6],
    frameColor: 0x242a32,
    glassColor: 0x31495c,
    litEmissiveColor: 0xd6ecff,
    rhythm: "group",
    windowRatio: 0.6,
    floorHeight: 3.7,
    bayWidth: 3.6,
    divisions: 1,
    louversPerFloor: 3,
    louverDepth: 0.2,
    storefront: false,
    parapetHeight: 0.65,
    coreColor: 0x1d2126,
  },
  stucco_warm: {
    kind: "grid",
    primaryFamily: "plaster",
    primaryColor: 0xdfd0b8,
    primaryTile: [2.2, 2.2],
    secondaryFamily: "wood",
    secondaryColor: 0x8f6644,
    secondaryTile: [1.8, 0.9],
    frameColor: 0x3d2e22,
    glassColor: 0x355066,
    litEmissiveColor: 0xffd58f,
    rhythm: "regular",
    windowRatio: 0.54,
    floorHeight: 3.5,
    bayWidth: 3.4,
    divisions: 1,
    louversPerFloor: 3,
    louverDepth: 0.16,
    storefront: true,
    parapetHeight: 0.55,
    coreColor: 0x26211c,
  },
};

interface GrammarMaterialSet {
  primary: THREE.MeshStandardMaterial;
  secondary: THREE.MeshStandardMaterial;
  frame: THREE.MeshStandardMaterial;
  glassDay: THREE.MeshStandardMaterial;
  glassLit: THREE.MeshStandardMaterial;
  core: THREE.MeshStandardMaterial;
}

const grammarMatCache = new Map<string, GrammarMaterialSet>();

function getGrammarMaterials(spec: FacadeGrammarSpec, styleKey: string): GrammarMaterialSet {
  const hit = grammarMatCache.get(styleKey);
  if (hit) return hit;

  const primary = materialFor(spec.primaryColor, {
    family: spec.primaryFamily,
    roughness: spec.primaryFamily === "metal" ? 0.42 : 0.86,
    metalness: spec.primaryFamily === "metal" ? 0.55 : 0.04,
    seed: 101,
  });
  const secondary = materialFor(spec.secondaryColor, {
    family: spec.secondaryFamily,
    roughness: spec.secondaryFamily === "metal" ? 0.38 : 0.82,
    metalness: spec.secondaryFamily === "metal" ? 0.62 : 0.06,
    seed: 102,
  });
  const frame = materialFor(spec.frameColor, {
    family: "metal",
    roughness: 0.38,
    metalness: 0.72,
    seed: 103,
  });
  const glassDay = registerNightGlowMaterial(
    new THREE.MeshStandardMaterial({
      color: spec.glassColor,
      roughness: 0.08,
      metalness: 0.82,
      emissive: spec.glassColor,
      emissiveIntensity: 0.12,
    }),
    0.12,
    0.42,
  );
  const glassLit = registerNightGlowMaterial(
    new THREE.MeshStandardMaterial({
      color: spec.glassColor,
      roughness: 0.1,
      metalness: 0.55,
      emissive: spec.litEmissiveColor,
      emissiveIntensity: 0.22,
    }),
    0.22,
    1.75,
  );
  const core = new THREE.MeshStandardMaterial({
    color: spec.coreColor,
    roughness: 0.92,
    metalness: 0.05,
  });

  const set: GrammarMaterialSet = { primary, secondary, frame, glassDay, glassLit, core };
  grammarMatCache.set(styleKey, set);
  return set;
}

type SlotName = "primary" | "secondary" | "frame" | "glassDay" | "glassLit" | "core";

class FacadeGeoBuilder {
  private readonly buckets: Record<SlotName, THREE.BufferGeometry[]> = {
    primary: [],
    secondary: [],
    frame: [],
    glassDay: [],
    glassLit: [],
    core: [],
  };

  constructor(private readonly spec: FacadeGrammarSpec) {}

  addBox(
    slot: SlotName,
    cx: number,
    cy: number,
    cz: number,
    w: number,
    h: number,
    d: number,
    ry = 0,
  ): void {
    if (w <= 0.01 || h <= 0.01 || d <= 0.01) return;
    const raw = new THREE.BoxGeometry(w, h, d);
    const tile =
      slot === "primary"
        ? this.spec.primaryTile
        : slot === "secondary"
          ? this.spec.secondaryTile
          : [1.6, 1.6];
    bakeBoxMetricUv(raw, w, h, d, tile[0], tile[1]);
    const g = raw.index ? raw.toNonIndexed() : raw;
    if (raw.index) raw.dispose();
    if (ry !== 0) g.rotateY(ry);
    g.translate(cx, cy, cz);
    this.buckets[slot].push(g);
  }

  flush(parent: THREE.Object3D, mats: GrammarMaterialSet): void {
    const order: SlotName[] = ["core", "primary", "secondary", "frame", "glassDay", "glassLit"];
    for (const slot of order) {
      const list = this.buckets[slot];
      if (list.length === 0) continue;
      const merged = list.length === 1 ? list[0] : mergeGeometries(list, false);
      if (merged) {
        const mesh = new THREE.Mesh(merged, mats[slot]);
        mesh.castShadow = slot !== "glassDay" && slot !== "glassLit";
        mesh.receiveShadow = true;
        parent.add(mesh);
      }
      if (list.length > 1) {
        for (const g of list) g.dispose();
      }
    }
  }
}

export interface BuildFacadeShellOpts {
  x: number;
  yBase: number;
  z: number;
  w: number;
  h: number;
  d: number;
  yaw?: number;
  style: FacadeStyle;
  seed?: number;
  kindOverride?: FacadeGrammarKind;
  storefront?: boolean;
  rhythmOverride?: FacadeRhythm;
  skipGroundFloor?: boolean;
  addRoofCap?: boolean;
  maxFloors?: number;
  maxBays?: number;
}

/**
 * Generates a true 3D recessed architectural facade shell (curtainwall, grid, louver, or classical)
 * around a `(w x h x d)` building volume with real 14–24 cm window reveals, projecting stone sills,
 * vertical mullions, louvers, and night-lit interior window panes, merged into <= 6 draw calls.
 */
export function buildGrammarFacadeShell(parent: THREE.Object3D, opts: BuildFacadeShellOpts): THREE.Group {
  const baseSpec = FACADE_PRESETS[opts.style];
  const spec: FacadeGrammarSpec = {
    ...baseSpec,
    kind: opts.kindOverride ?? baseSpec.kind,
    storefront: opts.storefront ?? baseSpec.storefront,
    rhythm: opts.rhythmOverride ?? baseSpec.rhythm,
  };
  const styleKey = `${opts.style}_${spec.kind}`;
  const mats = getGrammarMaterials(spec, styleKey);

  const grp = new THREE.Group();
  grp.position.set(opts.x, opts.yBase, opts.z);
  grp.rotation.y = opts.yaw ?? 0;
  parent.add(grp);

  const { w, h, d } = opts;
  const seed = opts.seed ?? Math.round(Math.abs(opts.x * 13 + opts.z * 7));
  const gb = new FacadeGeoBuilder(spec);

  // 1. Recessed opaque structural core (sits behind window glass so no gaps ever leak light)
  const coreInset = 0.42;
  const cw = Math.max(0.5, w - coreInset);
  const cd = Math.max(0.5, d - coreInset);
  gb.addBox("core", 0, h * 0.5, 0, cw, Math.max(0.2, h - 0.06), cd);

  // Corner structural piers (anchor all 4 elevations cleanly with no thin paper edges)
  const pierSize = spec.kind === "curtainwall" ? 0.44 : 0.52;
  const cornerSlot: SlotName = spec.kind === "curtainwall" ? "frame" : "primary";
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      gb.addBox(
        cornerSlot,
        sx * (w * 0.5 - pierSize * 0.45),
        h * 0.5,
        sz * (d * 0.5 - pierSize * 0.45),
        pierSize,
        h,
        pierSize,
      );
    }
  }

  // Roof cap & parapet rim
  if (opts.addRoofCap !== false) {
    gb.addBox("secondary", 0, h - 0.14, 0, w - 0.12, 0.28, d - 0.12);
    if (spec.parapetHeight > 0.1) {
      const ph = spec.parapetHeight;
      const pt = 0.34;
      gb.addBox("primary", 0, h + ph * 0.5, d * 0.5 - pt * 0.5, w, ph, pt);
      gb.addBox("primary", 0, h + ph * 0.5, -d * 0.5 + pt * 0.5, w, ph, pt);
      gb.addBox("primary", -w * 0.5 + pt * 0.5, h + ph * 0.5, 0, pt, ph, d - pt * 2);
      gb.addBox("primary", w * 0.5 - pt * 0.5, h + ph * 0.5, 0, pt, ph, d - pt * 2);
    }
  }

  // Compute floor heights cleanly capped for crisp detail + high FPS
  const startY = opts.skipGroundFloor ? Math.min(h * 0.35, 3.6) : 0;
  const usableH = Math.max(2.4, h - startY);
  const maxFloors = opts.maxFloors ?? 14;
  const idealFloors = Math.max(1, Math.round(usableH / spec.floorHeight));
  const floorCount = Math.min(maxFloors, idealFloors);
  const fh = usableH / floorCount;

  // Populate all 4 elevations (`+Z`, `-Z`, `+X`, `-X`)
  const faces: Array<{ span: number; depthOffset: number; ry: number; faceId: number }> = [
    { span: Math.max(1.2, w - pierSize * 1.6), depthOffset: d * 0.5, ry: 0, faceId: 0 },
    { span: Math.max(1.2, w - pierSize * 1.6), depthOffset: d * 0.5, ry: Math.PI, faceId: 1 },
    { span: Math.max(1.2, d - pierSize * 1.6), depthOffset: w * 0.5, ry: Math.PI * 0.5, faceId: 2 },
    { span: Math.max(1.2, d - pierSize * 1.6), depthOffset: w * 0.5, ry: -Math.PI * 0.5, faceId: 3 },
  ];

  const maxBays = opts.maxBays ?? 9;

  for (const face of faces) {
    const bays = Math.min(maxBays, Math.max(1, Math.round(face.span / spec.bayWidth)));
    const bayW = face.span / bays;
    const pattern = makeRhythmPattern(spec.rhythm, bays, seed + face.faceId * 31);
    const cosR = Math.cos(face.ry);
    const sinR = Math.sin(face.ry);

    // Emit box in face-local coords `(lx, ly, lzOut)` where `lzOut = 0` is the outer wall plane
    const emitFaceBox = (
      slot: SlotName,
      lx: number,
      lyCenter: number,
      lzOutCenter: number,
      bw: number,
      bh: number,
      bd: number,
    ) => {
      const lz = face.depthOffset + lzOutCenter;
      const wx = lx * cosR + lz * sinR;
      const wz = -lx * sinR + lz * cosR;
      gb.addBox(slot, wx, lyCenter, wz, bw, bh, bd, face.ry);
    };

    for (let fl = 0; fl < floorCount; fl++) {
      const fy0 = startY + fl * fh;
      const isGround = fl === 0 && !opts.skipGroundFloor && spec.storefront && h >= 6.5;

      for (let bi = 0; bi < bays; bi++) {
        const bx = -face.span * 0.5 + (bi + 0.5) * bayW;
        const pat = pattern[bi % pattern.length];
        const cellRand = mulberry32(hashSeed(seed, `${face.faceId}.${fl}.${bi}`))();
        const glassSlot: SlotName = cellRand < 0.36 ? "glassLit" : "glassDay";

        if (isGround) {
          // Ground-floor recessed shopfront/arcade bay
          const frameThick = 0.24;
          const headH = Math.min(0.65, fh * 0.18);
          const sillH = 0.28;
          emitFaceBox("frame", bx, fy0 + sillH * 0.5, -0.06, bayW, sillH, 0.22);
          emitFaceBox("primary", bx, fy0 + fh - headH * 0.5, -0.08, bayW, headH, 0.28);
          emitFaceBox("frame", bx - bayW * 0.5 + frameThick * 0.5, fy0 + fh * 0.5, -0.05, frameThick, fh, 0.22);
          emitFaceBox("frame", bx + bayW * 0.5 - frameThick * 0.5, fy0 + fh * 0.5, -0.05, frameThick, fh, 0.22);
          emitFaceBox(
            glassSlot,
            bx,
            fy0 + sillH + (fh - sillH - headH) * 0.5,
            -0.16,
            Math.max(0.2, bayW - frameThick * 2),
            Math.max(0.2, fh - sillH - headH),
            0.05,
          );
          continue;
        }

        if (spec.kind === "curtainwall") {
          const spandrelH = fh * (1 - spec.windowRatio);
          const visionH = fh - spandrelH;
          const spSlot: SlotName = pat === "B" ? "primary" : "secondary";
          // Spandrel slab slightly proud of glass
          emitFaceBox(spSlot, bx, fy0 + spandrelH * 0.5, -0.06, bayW, spandrelH, 0.16);
          // Vision glass divided by slender vertical mullions
          const divs = Math.max(1, spec.divisions);
          const subW = bayW / divs;
          for (let di = 0; di < divs; di++) {
            const sx = bx - bayW * 0.5 + (di + 0.5) * subW;
            const mullW = 0.08;
            emitFaceBox("frame", sx - subW * 0.5 + mullW * 0.5, fy0 + spandrelH + visionH * 0.5, -0.02, mullW, visionH, 0.2);
            emitFaceBox("frame", sx + subW * 0.5 - mullW * 0.5, fy0 + spandrelH + visionH * 0.5, -0.02, mullW, visionH, 0.2);
            // Mid transom bar on tall bays
            if (visionH >= 2.2) {
              emitFaceBox("frame", sx, fy0 + spandrelH + visionH * 0.65, -0.03, subW, 0.07, 0.18);
            }
            const subRand = mulberry32(hashSeed(seed, `${face.faceId}.${fl}.${bi}.${di}`))();
            const gSlot: SlotName = subRand < 0.34 ? "glassLit" : "glassDay";
            emitFaceBox(gSlot, sx, fy0 + spandrelH + visionH * 0.5, -0.14, Math.max(0.2, subW - mullW * 1.5), visionH, 0.04);
          }
        } else if (spec.kind === "louver") {
          if (pat === "B") {
            // Solid architectural accent panel
            emitFaceBox("secondary", bx, fy0 + fh * 0.5, -0.09, bayW, fh, 0.24);
          } else {
            const marginX = Math.max(0.28, (bayW * (1 - spec.windowRatio)) * 0.5);
            const marginBot = Math.max(0.35, fh * (1 - spec.windowRatio) * 0.58);
            const marginTop = Math.max(0.26, fh * (1 - spec.windowRatio) * 0.42);
            const winW = Math.max(0.5, bayW - marginX * 2);
            const winH = Math.max(0.6, fh - marginBot - marginTop);
            const winCy = fy0 + marginBot + winH * 0.5;

            // Wall surround (4 boxes around opening, 0.26m thick)
            emitFaceBox("primary", bx, fy0 + marginBot * 0.5, -0.11, bayW, marginBot, 0.26);
            emitFaceBox("primary", bx, fy0 + fh - marginTop * 0.5, -0.11, bayW, marginTop, 0.26);
            emitFaceBox("primary", bx - bayW * 0.5 + marginX * 0.5, winCy, -0.11, marginX, winH, 0.26);
            emitFaceBox("primary", bx + bayW * 0.5 - marginX * 0.5, winCy, -0.11, marginX, winH, 0.26);

            // Recessed frame & glass
            emitFaceBox("frame", bx, winCy, -0.15, winW, 0.08, 0.1);
            emitFaceBox(glassSlot, bx, winCy, -0.18, winW, winH, 0.04);

            // Projecting horizontal sun-shade louvers
            const lc = Math.max(2, spec.louversPerFloor);
            const stepL = winH / lc;
            for (let li = 0; li < lc; li++) {
              const ly = fy0 + marginBot + (li + 0.6) * stepL;
              emitFaceBox("secondary", bx, ly, -0.02 + spec.louverDepth * 0.5, winW + 0.04, 0.07, 0.16 + spec.louverDepth);
            }
          }
        } else if (spec.kind === "classical") {
          // Classical monumental stone piers + deep entablature + framed tall window + stone sill
          const pierW = Math.max(0.45, bayW * 0.2);
          const winW = Math.max(0.6, bayW - pierW * 2);
          const sillH = Math.max(0.45, fh * 0.18);
          const headerH = Math.max(0.42, fh * 0.16);
          const winH = Math.max(0.6, fh - sillH - headerH);
          const winCy = fy0 + sillH + winH * 0.5;

          emitFaceBox("primary", bx, fy0 + sillH * 0.5, -0.1, bayW, sillH, 0.3);
          emitFaceBox("primary", bx, fy0 + fh - headerH * 0.5, -0.08, bayW, headerH, 0.34);
          emitFaceBox("primary", bx - bayW * 0.5 + pierW * 0.5, winCy, -0.07, pierW, winH, 0.34);
          emitFaceBox("primary", bx + bayW * 0.5 - pierW * 0.5, winCy, -0.07, pierW, winH, 0.34);
          // Projecting window sill & architrave lintel
          emitFaceBox("secondary", bx, fy0 + sillH, 0.04, winW + 0.28, 0.14, 0.26);
          emitFaceBox("secondary", bx, fy0 + fh - headerH, 0.03, winW + 0.26, 0.14, 0.22);
          // Inset frame + center mullion + recessed glass
          emitFaceBox("frame", bx, winCy, -0.15, 0.08, winH, 0.12);
          emitFaceBox("frame", bx, winCy, -0.15, winW, 0.07, 0.12);
          emitFaceBox(glassSlot, bx, winCy, -0.19, winW, winH, 0.04);
        } else {
          // "grid" masonry / limestone / brick / stucco facade
          if (pat === "B" && bays >= 4) {
            // Variant fluted/inset masonry panel bay
            emitFaceBox("secondary", bx, fy0 + fh * 0.5, -0.09, bayW, fh, 0.26);
            emitFaceBox("frame", bx, fy0 + fh * 0.5, -0.06, bayW * 0.44, fh * 0.62, 0.1);
            emitFaceBox(glassSlot, bx, fy0 + fh * 0.5, -0.15, bayW * 0.38, fh * 0.56, 0.04);
          } else {
            const marginX = Math.max(0.28, (bayW * (1 - spec.windowRatio)) * 0.5);
            const marginBot = Math.max(0.38, fh * (1 - spec.windowRatio) * 0.6);
            const marginTop = Math.max(0.28, fh * (1 - spec.windowRatio) * 0.4);
            const winW = Math.max(0.55, bayW - marginX * 2);
            const winH = Math.max(0.65, fh - marginBot - marginTop);
            const winCy = fy0 + marginBot + winH * 0.5;

            // Masonry surround
            emitFaceBox("primary", bx, fy0 + marginBot * 0.5, -0.1, bayW, marginBot, 0.26);
            emitFaceBox("primary", bx, fy0 + fh - marginTop * 0.5, -0.1, bayW, marginTop, 0.26);
            emitFaceBox("primary", bx - bayW * 0.5 + marginX * 0.5, winCy, -0.1, marginX, winH, 0.26);
            emitFaceBox("primary", bx + bayW * 0.5 - marginX * 0.5, winCy, -0.1, marginX, winH, 0.26);

            // Projecting stone sill + lintel trim
            emitFaceBox("secondary", bx, fy0 + marginBot - 0.04, 0.02, winW + 0.22, 0.12, 0.24);
            // Window frame (vertical + horizontal muntin) + recessed glass
            emitFaceBox("frame", bx, winCy, -0.14, 0.07, winH, 0.1);
            emitFaceBox("frame", bx, winCy + winH * 0.1, -0.14, winW, 0.06, 0.1);
            emitFaceBox(glassSlot, bx, winCy, -0.18, winW, winH, 0.04);
          }
        }
      }
    }
  }

  gb.flush(grp, mats);
  return grp;
}
