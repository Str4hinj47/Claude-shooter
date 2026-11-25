/* ------------------------------------------------------------------ */
/*  LEVELS — six distinct worlds, one per mission                      */
/*  • shared kit: seeded RNG, canvas PBR textures, facade system      */
/*  • buildings = box + canvas facade (windows baked in, emissive     */
/*    glow map for night) + roof/parapet/details                     */
/*  • every solid = raycast collider + AABB for movement             */
/*  See docs/RESEARCH.md for the architecture research behind this.  */
/* ------------------------------------------------------------------ */
import * as THREE from "three";
import { Sky } from "three/examples/jsm/objects/Sky.js";
import { createRealisticSky } from "./city/RealisticSky";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { buildWorld, World } from "./world";
import type { SurfaceKind } from "./world";
import {
  bevelledBox,
  craftedBarrel,
  craftedCrate,
  craftedRockCluster,
  craftedStall,
  craftedTreeConifer,
  craftedTreeRound,
  craftedWell,
  doorWithStep,
  gableRoof,
  insetWindow,
  part,
  scatterInstances,
} from "./kit/geom";
import { materialFor } from "./kit/surface";
import { SpatialAABBGrid, SpatialColliderGrid } from "./city/SpatialIndex";
import { WorldHeightSystem, type WalkableSurface } from "./city/HeightSystem";
import type { DistrictInfo } from "./city/WestgateTerrain";
import type { TimeOfDayMode } from "./city/WestgateMeta";
import type { MinimapData } from "./city/MinimapData";
import type { OpenWorldEngine } from "./city/OpenWorldEngine";
import type { WestgateActivityManager } from "./city/WestgateActivities";
import type { WestgateVehicleManager } from "./city/VehicleSystem";
import type { WeatherMode, WeatherState } from "./vehicles/weather";

/* ====================== seeded RNG ====================== */
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ====================== canvas textures ====================== */
function noiseCanvas(size: number, base: string, speck: [string, number][], rng: () => number) {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const g = c.getContext("2d")!;
  g.fillStyle = base;
  g.fillRect(0, 0, size, size);
  for (let i = 0; i < 70; i++) {
    const x = rng() * size;
    const y = rng() * size;
    const r = 15 + rng() * 70;
    const gr = g.createRadialGradient(x, y, 0, x, y, r);
    const a = 0.04 + rng() * 0.07;
    gr.addColorStop(0, rng() > 0.5 ? `rgba(0,0,0,${a})` : `rgba(255,255,255,${a * 0.7})`);
    gr.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = gr;
    g.fillRect(x - r, y - r, r * 2, r * 2);
  }
  for (const [col, n] of speck) {
    g.fillStyle = col;
    for (let i = 0; i < n; i++) {
      const s = rng() * 2 + 0.5;
      g.fillRect(rng() * size, rng() * size, s, s);
    }
  }
  return c;
}

function toTex(c: HTMLCanvasElement, rep: number, srgb = true) {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(rep, rep);
  t.anisotropy = 4;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/* ================= environment polish: decal textures (visual only) ================= */

/** dark organic ground stain (oil/dirt/mud) on transparent background */
function stainTex(size: number, rng: () => number): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const g = c.getContext("2d")!;
  g.clearRect(0, 0, size, size);
  for (let i = 0; i < 12; i++) {
    const x = rng() * size;
    const y = rng() * size;
    const r = size * (0.1 + rng() * 0.26);
    const gr = g.createRadialGradient(x, y, 0, x, y, r);
    const a = 0.22 + rng() * 0.34;
    gr.addColorStop(0, `rgba(18,15,12,${a})`);
    gr.addColorStop(0.65, `rgba(18,15,12,${a * 0.35})`);
    gr.addColorStop(1, "rgba(18,15,12,0)");
    g.fillStyle = gr;
    g.fillRect(x - r, y - r, r * 2, r * 2);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** puddle: soft blue sheen, transparent edges */
function puddleTex(size: number, rng: () => number): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const g = c.getContext("2d")!;
  g.clearRect(0, 0, size, size);
  const x = size / 2;
  const y = size / 2;
  const r = size * 0.42;
  const gr = g.createRadialGradient(x, y, 0, x, y, r);
  gr.addColorStop(0, "rgba(70,92,120,0.55)");
  gr.addColorStop(0.7, "rgba(60,80,105,0.3)");
  gr.addColorStop(1, "rgba(50,70,95,0)");
  g.fillStyle = gr;
  g.beginPath();
  g.arc(x, y, r, 0, Math.PI * 2);
  g.fill();
  // a few droplets around the main blob
  for (let i = 0; i < 6; i++) {
    const ax = rng() * size;
    const ay = rng() * size;
    const ar = 6 + rng() * 14;
    const gr2 = g.createRadialGradient(ax, ay, 0, ax, ay, ar);
    gr2.addColorStop(0, "rgba(65,85,110,0.4)");
    gr2.addColorStop(1, "rgba(65,85,110,0)");
    g.fillStyle = gr2;
    g.beginPath();
    g.arc(ax, ay, ar, 0, Math.PI * 2);
    g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** asphalt/concrete cracks on transparent background */
function crackTex(size: number, rng: () => number): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const g = c.getContext("2d")!;
  g.clearRect(0, 0, size, size);
  const branch = (sx: number, sy: number, ang: number, depth: number) => {
    if (depth <= 0) return;
    let x = sx;
    let y = sy;
    const steps = 6 + Math.floor(rng() * 8);
    for (let i = 0; i < steps; i++) {
      const len = (size / 24) * (0.6 + rng());
      ang += (rng() - 0.5) * 0.9;
      x += Math.cos(ang) * len;
      y += Math.sin(ang) * len;
      g.strokeStyle = `rgba(10,10,12,${0.35 + rng() * 0.4})`;
      g.lineWidth = Math.max(1, depth * 1.4);
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(x + Math.cos(ang) * len * 0.7, y + Math.sin(ang) * len * 0.7);
      g.stroke();
      if (rng() < 0.35) branch(x, y, ang + (rng() - 0.5) * 2, depth - 1);
    }
  };
  for (let i = 0; i < 3; i++) {
    const edge = Math.floor(rng() * 4);
    const sx = edge === 0 ? rng() * size : edge === 1 ? size : rng() * size;
    const sy = edge === 2 ? rng() * size : edge === 3 ? size : rng() * size;
    branch(sx, sy, rng() * Math.PI * 2, 4);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** vertical grime / rust streaks for wall decals */
function streakTex(size: number, rng: () => number, rust = false): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const g = c.getContext("2d")!;
  g.clearRect(0, 0, size, size);
  const col = rust ? "74,44,24" : "22,20,18";
  for (let i = 0; i < 22; i++) {
    const x = rng() * size;
    const w = 5 + rng() * 18;
    const top = rng() * size * 0.3;
    const h = size * (0.4 + rng() * 0.6);
    const gr = g.createLinearGradient(x, top, x, top + h);
    const a = 0.18 + rng() * 0.4;
    gr.addColorStop(0, `rgba(${col},${a})`);
    gr.addColorStop(0.6, `rgba(${col},${a * 0.5})`);
    gr.addColorStop(1, `rgba(${col},0)`);
    g.fillStyle = gr;
    g.fillRect(x, top, w, h);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** rectangular sign board texture (post sign / billboard face) */
function signTex(text: string, bg: string, fg: string, rng: () => number): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 512;
  c.height = 256;
  const g = c.getContext("2d")!;
  g.fillStyle = bg;
  g.fillRect(0, 0, 512, 256);
  g.fillStyle = fg;
  g.font = "bold 64px sans-serif";
  g.textAlign = "center";
  g.fillText(text, 256, 150);
  // weathering: a few scratches/stains
  for (let i = 0; i < 14; i++) {
    g.fillStyle = `rgba(0,0,0,${0.05 + rng() * 0.1})`;
    g.fillRect(rng() * 512, rng() * 256, 20 + rng() * 80, 2 + rng() * 10);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** billboard face: ad-style panel with shapes + text */
function adTex(rng: () => number): THREE.CanvasTexture {
  const palettes = [
    ["#c8302a", "#f2e8c0", "#2a3a5a"],
    ["#2a5a8a", "#e8e0d0", "#c8a82a"],
    ["#3a6a3a", "#e8e0d0", "#8a3a3a"],
    ["#5a3a7a", "#e8e0d0", "#2a8a8a"],
  ];
  const p = palettes[Math.floor(rng() * palettes.length)];
  const c = document.createElement("canvas");
  c.width = 512;
  c.height = 256;
  const g = c.getContext("2d")!;
  g.fillStyle = p[2];
  g.fillRect(0, 0, 512, 256);
  g.fillStyle = p[0];
  g.beginPath();
  g.arc(128, 128, 70, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = p[1];
  g.font = "bold 58px sans-serif";
  g.textAlign = "center";
  g.fillText("MERIDIAN", 340, 120);
  g.font = "bold 30px sans-serif";
  g.fillText("GROUP", 340, 168);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/* ---- roof surface textures ---- */
/** flat-roof gravel/membrane: gray noise + speckles */
function gravelTex(size: number, rng: () => number): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const g = c.getContext("2d")!;
  g.fillStyle = "#5a5a5e";
  g.fillRect(0, 0, size, size);
  for (let i = 0; i < 260; i++) {
    const x = rng() * size;
    const y = rng() * size;
    const r = 2 + rng() * 12;
    const a = 0.05 + rng() * 0.2;
    g.fillStyle = rng() > 0.5 ? `rgba(0,0,0,${a})` : `rgba(255,255,255,${a * 0.8})`;
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.fill();
  }
  for (let i = 0; i < 4000; i++) {
    g.fillStyle = `rgba(0,0,0,${0.05 + rng() * 0.15})`;
    g.fillRect(rng() * size, rng() * size, 1 + rng() * 2, 1 + rng() * 2);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** corrugated metal: vertical wave stripes */
function corrugTex(size: number, rng: () => number): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const g = c.getContext("2d")!;
  g.fillStyle = "#5a5f66";
  g.fillRect(0, 0, size, size);
  const waves = 12;
  for (let i = 0; i < waves; i++) {
    const x = (i * size) / waves;
    g.fillStyle = i % 2 ? "rgba(255,255,255,0.10)" : "rgba(0,0,0,0.22)";
    g.fillRect(x, 0, size / waves, size);
  }
  for (let i = 0; i < 2000; i++) {
    g.fillStyle = `rgba(0,0,0,${0.04 + rng() * 0.1})`;
    g.fillRect(rng() * size, rng() * size, 1 + rng() * 2, 1 + rng() * 2);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** building facade: colour map + emissive glow map, tiled per bay/floor */
interface FacadeOpts {
  base: string;
  glass: string;
  frame: string;
  glow: string;
  bayW: number; // window width in m
  floorH: number; // floor height in m
  cols: number; // windows per tile horizontally
  rows: number; // windows per tile vertically
  rng: () => number;
  sign?: string;
}
function facade(o: FacadeOpts) {
  const px = typeof document !== "undefined" ? 512 : 128;
  const sc = px / 256;
  const cy = px / o.rows;
  const color = document.createElement("canvas");
  color.width = color.height = px;
  const glow = document.createElement("canvas");
  glow.width = glow.height = px;
  const rough = document.createElement("canvas");
  rough.width = rough.height = px;
  const bump = document.createElement("canvas");
  bump.width = bump.height = px;
  const gc = color.getContext("2d")!;
  const gg = glow.getContext("2d")!;
  const rg = rough.getContext("2d")!;
  const bg = bump.getContext("2d")!;
  gc.fillStyle = o.base;
  gc.fillRect(0, 0, px, px);
  gg.fillStyle = "#000";
  gg.fillRect(0, 0, px, px);
  rg.fillStyle = "rgb(225,225,225)";
  rg.fillRect(0, 0, px, px);
  bg.fillStyle = "rgb(205,205,205)";
  bg.fillRect(0, 0, px, px);
  // subtle stucco/plaster texture + masonry weathering
  for (let i = 0; i < 160; i++) {
    gc.fillStyle = i % 2 === 0 ? `rgba(0,0,0,${0.025 + o.rng() * 0.045})` : `rgba(255,255,255,${0.015 + o.rng() * 0.03})`;
    const r = (6 + o.rng() * 24) * sc;
    gc.beginPath();
    gc.arc(o.rng() * px, o.rng() * px, r, 0, Math.PI * 2);
    gc.fill();
  }
  const tileW = o.bayW * o.cols;
  for (let r = 0; r < o.rows; r++) {
    // horizontal floor band shadow
    gc.fillStyle = "rgba(0,0,0,0.08)";
    gc.fillRect(0, r * cy, px, Math.max(2, cy * 0.08));
    for (let c = 0; c < o.cols; c++) {
      if (o.rng() < 0.12) continue; // some windows blanked (blinds / dark rooms)
      const x = c * (px / o.cols) + (px / o.cols) * 0.18;
      const y = r * cy + cy * 0.22;
      const w = (px / o.cols) * 0.64;
      const h = cy * 0.56;
      // outer sill & frame recess
      gc.fillStyle = o.frame;
      gc.fillRect(x - 2 * sc, y - 2 * sc, w + 4 * sc, h + 5 * sc);
      bg.fillStyle = "rgb(236,236,236)";
      bg.fillRect(x - 2 * sc, y - 2 * sc, w + 4 * sc, h + 5 * sc);

      // reflective deep sky-tinted glass gradient
      const grad = gc.createLinearGradient(x, y, x, y + h);
      grad.addColorStop(0, o.glass);
      grad.addColorStop(0.55, "#1d2b38");
      grad.addColorStop(1, "#0d141c");
      gc.fillStyle = grad;
      gc.fillRect(x, y, w, h);
      // subtle sky glint
      gc.fillStyle = "rgba(210,234,255,0.22)";
      gc.fillRect(x + 2 * sc, y + 2 * sc, w * 0.34, h - 4 * sc);
      // mirror-gloss roughness for glass pane vs matte wall
      rg.fillStyle = "rgb(20,20,20)";
      rg.fillRect(x, y, w, h);
      bg.fillStyle = "rgb(80,80,80)";
      bg.fillRect(x, y, w, h);

      // center mullion & transom bar
      gc.fillStyle = o.frame;
      gc.fillRect(x + w * 0.5 - 1.2 * sc, y, 2.4 * sc, h);
      gc.fillRect(x, y + h * 0.45, w, 2 * sc);
      rg.fillStyle = "rgb(140,140,140)";
      rg.fillRect(x + w * 0.5 - 1.2 * sc, y, 2.4 * sc, h);
      rg.fillRect(x, y + h * 0.45, w, 2 * sc);
      bg.fillStyle = "rgb(190,190,190)";
      bg.fillRect(x + w * 0.5 - 1.2 * sc, y, 2.4 * sc, h);
      bg.fillRect(x, y + h * 0.45, w, 2 * sc);

      gg.fillStyle = o.glow;
      gg.globalAlpha = 0.42 + o.rng() * 0.48;
      gg.fillRect(x, y, w, h);
      gg.globalAlpha = 1;
    }
  }
  if (o.sign) {
    const sx = px / 2 - 90 * sc;
    const sy = px / 2 - 14 * sc;
    gc.fillStyle = "rgba(245,245,245,0.92)";
    gc.fillRect(sx, sy, 180 * sc, 28 * sc);
    gc.fillStyle = "#111";
    gc.font = `bold ${Math.round(17 * sc)}px sans-serif`;
    gc.textAlign = "center";
    gc.fillText(o.sign, px / 2, sy + 20 * sc);
  }
  const mapTex = new THREE.CanvasTexture(color);
  const glowTex = new THREE.CanvasTexture(glow);
  const roughTex = new THREE.CanvasTexture(rough);
  const bumpTex = new THREE.CanvasTexture(bump);
  for (const t of [mapTex, glowTex, roughTex, bumpTex]) t.anisotropy = 4;
  return {
    map: mapTex,
    glow: glowTex,
    rough: roughTex,
    bump: bumpTex,
    tileW,
    tileH: o.floorH * o.rows,
    rows: o.rows,
    cols: o.cols,
  };
}

/* ====================== ambient (sky/sun/fog) ====================== */
interface AmbientCfg {
  sunElev: number;
  sunAzim: number;
  turbidity: number;
  rayleigh: number;
  fogColor: number;
  fogDensity: number;
  hemiSky: number;
  hemiGround: number;
  hemiIntensity: number;
  sunColor: number;
  sunIntensity: number;
  envIntensity: number;
  exposure: number;
  stars?: boolean;
  shadowFar?: number;
  nightSky?: { zenith: number; horizon: number; moonColor?: number };
}
function setupAmbient(scene: THREE.Scene, renderer: THREE.WebGLRenderer, c: AmbientCfg) {
  renderer.toneMappingExposure = c.exposure;
  const sunDir = new THREE.Vector3().setFromSphericalCoords(
    1,
    THREE.MathUtils.degToRad(90 - c.sunElev),
    THREE.MathUtils.degToRad(c.sunAzim),
  );
  const skyScene = new THREE.Scene();
  const isNight = Boolean(c.nightSky);
  const sunsetMix = !isNight && c.sunElev < 20 ? THREE.MathUtils.clamp((22 - c.sunElev) / 16, 0, 1) : 0;
  const skyState = {
    zenith: c.nightSky ? c.nightSky.zenith : c.turbidity > 5.5 ? 0x456280 : 0x204d8c,
    midSky: c.nightSky ? c.nightSky.horizon : c.turbidity > 5.5 ? 0x8295a8 : 0x5c96cc,
    horizon: c.nightSky ? c.nightSky.horizon : c.fogColor,
    fogColor: c.fogColor,
    sunColor: c.nightSky ? (c.nightSky.moonColor ?? 0x9bbcff) : c.sunColor,
    sunDir,
    moonDir: sunDir,
    nightMix: isNight ? 1.0 : 0.0,
    sunsetMix,
    cloudCover: isNight ? 0.34 : c.turbidity > 5.5 ? 0.62 : 0.45,
    overcast: !isNight && c.turbidity > 5.5 ? 0.35 : 0.0,
  };
  const liveSky = createRealisticSky(skyState);

  let nightSkyHandle: ReturnType<typeof createRealisticSky> | null = null;
  let daySky: Sky | null = null;
  if (c.nightSky) {
    nightSkyHandle = createRealisticSky(skyState);
    skyScene.add(nightSkyHandle.mesh);
  } else {
    const sky = new Sky();
    sky.scale.setScalar(10000);
    const u = sky.material.uniforms;
    u["turbidity"].value = c.turbidity;
    u["rayleigh"].value = c.rayleigh;
    u["mieCoefficient"].value = 0.004;
    u["mieDirectionalG"].value = 0.82;
    u["sunPosition"].value.copy(sunDir);
    skyScene.add(sky);
    daySky = sky;
  }
  const cubeRT = new THREE.WebGLCubeRenderTarget(256, { type: THREE.HalfFloatType });
  const cubeCam = new THREE.CubeCamera(1, 10000, cubeRT);
  cubeCam.update(renderer, skyScene);
  scene.background = cubeRT.texture;
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envRT = pmrem.fromCubemap(cubeRT.texture);
  scene.environment = envRT.texture;
  pmrem.dispose();
  scene.environmentIntensity = c.envIntensity;
  scene.fog = new THREE.FogExp2(c.fogColor, c.fogDensity);

  const stars: THREE.Points | null = null;

  const sun = new THREE.DirectionalLight(c.sunColor, c.sunIntensity);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1536, 1536);
  const sc = sun.shadow.camera;
  sc.left = -22;
  sc.right = 22;
  sc.top = 22;
  sc.bottom = -22;
  sc.near = 1;
  sc.far = c.shadowFar ?? 90;
  sun.shadow.bias = -0.0003;
  sun.shadow.normalBias = 0.03;
  sun.shadow.radius = 2.2;

  const hemi = new THREE.HemisphereLight(c.hemiSky, c.hemiGround, c.hemiIntensity);

  const texelWorld = (sc.right - sc.left) / 1536;
  const snappedFocus = new THREE.Vector3();
  const update = (dt: number, focus: THREE.Vector3) => {
    liveSky.update(dt, focus);
    snappedFocus.set(
      Math.round(focus.x / texelWorld) * texelWorld,
      Math.round(focus.y / texelWorld) * texelWorld,
      Math.round(focus.z / texelWorld) * texelWorld,
    );
    sun.position.copy(snappedFocus).addScaledVector(sunDir, 45);
    sun.target.position.copy(snappedFocus);
  };
  const dispose = () => {
    cubeRT.dispose();
    envRT.dispose();
    liveSky.dispose();
    nightSkyHandle?.dispose();
    if (daySky) {
      daySky.geometry.dispose();
      (daySky.material as THREE.Material).dispose();
    }
  };
  return { sun, hemi, stars, skyMesh: liveSky.mesh, sunDir, update, dispose };
}

/* ====================== kit ====================== */
interface Beacon {
  mesh: THREE.Mesh;
  speed: number;
  phase: number;
}

interface StreetLampInfo {
  head: THREE.Vector3;
  ground: THREE.Vector3;
  color: number;
}

class Kit {
  colliders: THREE.Object3D[] = [];
  aabbs: THREE.Box3[] = [];
  destroyables: THREE.Mesh[] = [];
  beacons: Beacon[] = [];
  streetLamps: StreetLampInfo[] = [];
  walkableSurfaces: WalkableSurface[] = [];
  extras: { update: (dt: number) => void }[] = [];
  rng: () => number;
  scene: THREE.Object3D;
  invisMat = new THREE.MeshBasicMaterial({ visible: false });
  private wallMatCache = new Map<string, THREE.MeshStandardMaterial>();
  private facadeId = new WeakMap<object, number>();
  private nextFacadeId = 1;
  private clearZones: { x: number; z: number; r: number }[] = [];

  constructor(scene: THREE.Object3D, seed: number) {
    this.scene = scene;
    this.rng = mulberry32(seed);
  }

  /** Register a spawn/extraction clearance zone so trees, bushes, rocks & clutter never block it. */
  clearZone(x: number, z: number, r = 9) {
    this.clearZones.push({ x, z, r });
  }

  inClearZone(x: number, z: number, extraPad = 0): boolean {
    for (const cz of this.clearZones) {
      const rr = cz.r + extraPad;
      if ((x - cz.x) * (x - cz.x) + (z - cz.z) * (z - cz.z) < rr * rr) return true;
    }
    return false;
  }

  /** invisible physics-only collider + AABB (no z-fighting with detailed visual shells) */
  colliderBox(w: number, h: number, d: number, x: number, y: number, z: number, ry = 0, kind: SurfaceKind = "concrete") {
    const m = this.box(this.invisMat, w, h, d, x, y, z, ry);
    m.userData.kind = kind;
    this.scene.add(m);
    this.colliders.push(m);
    m.updateWorldMatrix(true, false);
    const box = new THREE.Box3().setFromObject(m);
    if (!box.isEmpty()) this.aabbs.push(box);
    return m;
  }

  add(m: THREE.Mesh, kind: SurfaceKind, noShadow = false) {
    if (!noShadow) {
      m.castShadow = true;
      m.receiveShadow = true;
    }
    m.userData.kind = kind;
    this.scene.add(m);
    this.colliders.push(m);
    return m;
  }

  /** add + register AABB for movement collision */
  solid(m: THREE.Mesh, kind: SurfaceKind = "concrete") {
    this.add(m, kind);
    m.updateWorldMatrix(true, false);
    const box = new THREE.Box3().setFromObject(m);
    if (box.isEmpty()) box.setFromCenterAndSize(m.position, new THREE.Vector3(1, 1, 1));
    this.aabbs.push(box);
    return m;
  }

  mesh(mat: THREE.Material, geo: THREE.BufferGeometry, x: number, y: number, z: number, ry = 0) {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.rotation.y = ry;
    return m;
  }

  box(mat: THREE.Material, w: number, h: number, d: number, x: number, y: number, z: number, ry = 0, label = "") {
    const m = this.mesh(mat, new THREE.BoxGeometry(w, h, d), x, y + h / 2, z, ry);
    if (label) m.userData.label = label;
    return m;
  }

  flagMesh: THREE.Object3D | null = null;
  beacon(mesh: THREE.Mesh, speed = 2.5, phase = 0) {
    this.beacons.push({ mesh, speed, phase });
  }

  ground(size: number, mat: THREE.Material) {
    const g = this.mesh(mat, new THREE.PlaneGeometry(size, size), 0, 0, 0);
    g.rotation.x = -Math.PI / 2;
    g.receiveShadow = true;
    g.userData.kind = "dirt";
    this.scene.add(g);
    this.colliders.push(g);
  }

  /* ---------------- buildings ---------------- */
  /** wall material with the facade tiled to this face's real length (bays align
      across faces and corners) */
  wallFaceMat(f: ReturnType<typeof facade>, lenH: number, h: number, emissive: number): THREE.MeshStandardMaterial {
    let fid = this.facadeId.get(f);
    if (!fid) {
      fid = this.nextFacadeId++;
      this.facadeId.set(f, fid);
    }
    const repX = Math.max(1, lenH / f.tileW);
    const repY = Math.max(1, h / f.tileH);
    const key = `${fid}|${repX.toFixed(2)}|${repY.toFixed(2)}|${emissive.toFixed(2)}`;
    const hit = this.wallMatCache.get(key);
    if (hit) return hit;

    const mapTex = f.map.clone();
    const glowTex = f.glow.clone();
    const roughTex = f.rough.clone();
    const bumpTex = f.bump.clone();
    mapTex.colorSpace = THREE.SRGBColorSpace;
    glowTex.colorSpace = THREE.SRGBColorSpace;
    for (const tx of [mapTex, glowTex, roughTex, bumpTex]) {
      tx.wrapS = tx.wrapT = THREE.RepeatWrapping;
      tx.repeat.set(repX, repY);
      tx.needsUpdate = true;
    }
    const m = new THREE.MeshStandardMaterial({
      map: mapTex,
      bumpMap: bumpTex,
      bumpScale: 0.04,
      roughnessMap: roughTex,
      roughness: 1.0,
      metalness: 0.12,
      emissive: 0xffffff,
      emissiveMap: glowTex,
      emissiveIntensity: emissive,
    });
    this.wallMatCache.set(key, m);
    return m;
  }

  /** roof surface material: clone the roof material and apply a surface texture */
  roofSurfaceMat(mat: THREE.Material, map: THREE.Texture, rep: [number, number]): THREE.MeshStandardMaterial {
    const rm = mat.clone() as THREE.MeshStandardMaterial;
    rm.map = map.clone();
    rm.map!.wrapS = rm.map!.wrapT = THREE.RepeatWrapping;
    rm.map!.repeat.set(rep[0], rep[1]);
    rm.map!.colorSpace = THREE.SRGBColorSpace;
    rm.needsUpdate = true;
    return rm;
  }

  building(o: {
    x: number;
    z: number;
    w: number;
    d: number;
    h: number;
    facade: ReturnType<typeof facade>;
    roof?: "flat" | "tile" | "metal" | "gable" | "none";
    roofMat: THREE.Material;
    emissive?: number;
    parapet?: boolean;
    details?: boolean;
    ry?: number;
    collideTo?: number; // shorter collider (leaves roofline shootable)
  }) {
    const { x, z, w, d, h } = o;
    const ry = o.ry ?? 0;
    const t = 0.3;
    const colH = o.collideTo ?? h;
    // invisible collision box (zero z-fighting with visual shell)
    const collider = this.colliderBox(w, colH, d, x, 0, z, ry, "concrete");
    if (colH < h) {
      const last = this.aabbs[this.aabbs.length - 1];
      last.max.y = colH;
    }
    // entire visual building + roof + parapet + details live in one rotated group
    const g = new THREE.Group();
    g.position.set(x, 0, z);
    g.rotation.y = ry;
    this.scene.add(g);

    const em = o.emissive ?? 0;
    const fbMat = this.wallFaceMat(o.facade, w, h, em);
    const lrMat = this.wallFaceMat(o.facade, d, h, em);
    for (const sz of [-1, 1]) {
      const m = this.mesh(fbMat, new THREE.BoxGeometry(w, h, t), 0, h / 2, sz * (d / 2 - t / 2), 0);
      m.castShadow = true;
      m.receiveShadow = true;
      g.add(m);
    }
    for (const sx of [-1, 1]) {
      const m = this.mesh(lrMat, new THREE.BoxGeometry(t, h, d - 2 * t), sx * (w / 2 - t / 2), h / 2, 0, 0);
      m.castShadow = true;
      m.receiveShadow = true;
      g.add(m);
    }
    // corner pilasters (flush masonry trim hiding corner seams)
    const quoinMat = materialFor(0x5a5550, { roughness: 0.9, family: "stone", seed: 4 });
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const q = this.mesh(quoinMat, bevelledBox(t * 1.15, h, t * 1.15, 0.025), sx * (w / 2 - t * 0.35), h / 2, sz * (d / 2 - t * 0.35), 0);
        q.castShadow = true;
        q.receiveShadow = true;
        g.add(q);
      }
    }
    // ground plinth
    const plinthMat = materialFor(0x4a4640, { roughness: 0.92, family: "stone", seed: 8 });
    const plinth = this.mesh(plinthMat, bevelledBox(w + 0.14, 0.48, d + 0.14, 0.03), 0, 0.24, 0, 0);
    plinth.receiveShadow = true;
    g.add(plinth);
    // floor-line stringer courses
    const floorH = o.facade.tileH / o.facade.rows;
    const bandMat = materialFor(0x7c7770, { roughness: 0.9 });
    for (let k = 1; k * floorH < h - 0.25; k++) {
      const band = this.mesh(bandMat, bevelledBox(w + 0.12, 0.13, d + 0.12, 0.02), 0, k * floorH, 0, 0);
      g.add(band);
    }
    if (o.roof !== "none") this.roofLocal(g, w, d, h, o.roof ?? "flat", o.roofMat, fbMat);
    if (o.parapet) this.parapetLocal(g, w, d, h, o.roofMat);
    if (o.details) this.roofDetailsLocal(g, w, d, h, o.roofMat);
    return collider;
  }

  /* Playable CS2-style multi-door, multi-window building with optional interior partition & walkable roof */
  enterable(o: {
    x: number;
    z: number;
    w: number;
    d: number;
    h: number;
    facade: ReturnType<typeof facade>;
    roof?: "flat" | "tile" | "metal" | "gable" | "none";
    roofMat: THREE.Material;
    doorW?: number;
    doorH?: number;
    doors?: ("N" | "S" | "E" | "W")[];
    windows?: ("N" | "S" | "E" | "W")[];
    partition?: "none" | "x" | "z";
    emissive?: number;
    ry?: number;
    inner?: THREE.Material;
    walkableRoof?: boolean;
    parapet?: boolean;
  }) {
    const { x, z, w, d, h } = o;
    const t = 0.3;
    const doorW = Math.min(o.doorW ?? 1.9, Math.min(w, d) - 1.4);
    const doorH = Math.min(o.doorH ?? 2.45, h - 0.45);
    const doors = new Set<"N" | "S" | "E" | "W">(o.doors ?? ["S"]);
    const windows = new Set<"N" | "S" | "E" | "W">(o.windows ?? []);
    const partition = o.partition ?? "none";
    const ry = o.ry ?? 0;
    const em = o.emissive ?? 0;
    const wallNS = this.wallFaceMat(o.facade, w, h, em);
    const wallEW = this.wallFaceMat(o.facade, d - 2 * t, h, em);

    const g = new THREE.Group();
    g.position.set(x, 0, z);
    g.rotation.y = ry;
    this.scene.add(g);

    const addLocalSolid = (mat: THREE.Material, bw: number, bh: number, bd: number, lx: number, ly: number, lz: number, cast = true) => {
      if (bw <= 0.02 || bh <= 0.02 || bd <= 0.02) return;
      const m = this.mesh(mat, new THREE.BoxGeometry(bw, bh, bd), lx, ly, lz, 0);
      m.castShadow = cast;
      m.receiveShadow = true;
      m.userData.kind = "concrete";
      g.add(m);
      this.colliders.push(m);
      m.updateWorldMatrix(true, false);
      const box = new THREE.Box3().setFromObject(m);
      if (!box.isEmpty()) this.aabbs.push(box);
      return m;
    };

    const linerMat = materialFor(0x403a34, { roughness: 0.95, family: "plaster", seed: 3 });
    const trimMat = materialFor(0x3a3228, { roughness: 0.85, family: "wood", seed: 7 });

    const buildWall = (side: "N" | "S" | "E" | "W") => {
      const alongX = side === "N" || side === "S";
      const span = alongX ? w : d - 2 * t;
      const mat = alongX ? wallNS : wallEW;
      const pos = alongX ? (side === "S" ? d / 2 - t / 2 : -d / 2 + t / 2) : (side === "E" ? w / 2 - t / 2 : -w / 2 + t / 2);

      const placeBox = (along: number, y: number, bLen: number, bh: number, m: THREE.Material) => {
        if (alongX) addLocalSolid(m, bLen, bh, t, along, y, pos);
        else addLocalSolid(m, t, bh, bLen, pos, y, along);
      };

      if (doors.has(side)) {
        const dW = Math.min(doorW, span - 1.0);
        const jambW = (span - dW) / 2;
        for (const sgn of [-1, 1]) {
          placeBox(sgn * (dW / 2 + jambW / 2), h / 2, jambW, h, mat);
        }
        const lintelH = h - doorH;
        if (lintelH > 0.05) placeBox(0, doorH + lintelH / 2, dW, lintelH, mat);
        const doorObj = doorWithStep({ width: dW, height: doorH, wallT: t, openAngle: -1.18 });
        if (side === "S") doorObj.position.set(0, 0, pos);
        else if (side === "N") { doorObj.position.set(0, 0, pos); doorObj.rotation.y = Math.PI; }
        else if (side === "E") { doorObj.position.set(pos, 0, 0); doorObj.rotation.y = Math.PI / 2; }
        else { doorObj.position.set(pos, 0, 0); doorObj.rotation.y = -Math.PI / 2; }
        g.add(doorObj);
      } else if (windows.has(side) && h >= 2.8 && span >= 3.2) {
        const winW = Math.min(2.2, span * 0.42);
        const sillH = 0.96;
        const winTop = Math.min(2.22, h - 0.45);
        const sideW = (span - winW) / 2;
        for (const sgn of [-1, 1]) {
          placeBox(sgn * (winW / 2 + sideW / 2), h / 2, sideW, h, mat);
        }
        placeBox(0, sillH / 2, winW, sillH, mat);
        if (h - winTop > 0.05) placeBox(0, winTop + (h - winTop) / 2, winW, h - winTop, mat);
        if (alongX) {
          g.add(part(bevelledBox(winW + 0.14, 0.08, t + 0.14, 0.02), trimMat, [0, sillH, pos]));
          g.add(part(bevelledBox(winW + 0.14, 0.08, t + 0.1, 0.02), trimMat, [0, winTop, pos]));
        } else {
          g.add(part(bevelledBox(t + 0.14, 0.08, winW + 0.14, 0.02), trimMat, [pos, sillH, 0]));
          g.add(part(bevelledBox(t + 0.1, 0.08, winW + 0.14, 0.02), trimMat, [pos, winTop, 0]));
        }
      } else {
        placeBox(0, h / 2, span, h, mat);
        const lSpan = Math.max(0.2, span - 0.1);
        const inOff = side === "S" ? pos - t / 2 - 0.03 : side === "N" ? pos + t / 2 + 0.03 : side === "E" ? pos - t / 2 - 0.03 : pos + t / 2 + 0.03;
        if (alongX) g.add(part(new THREE.BoxGeometry(lSpan, h - 0.18, 0.05), linerMat, [0, (h - 0.18) / 2 + 0.12, inOff], [0, 0, 0], false));
        else g.add(part(new THREE.BoxGeometry(0.05, h - 0.18, lSpan), linerMat, [inOff, (h - 0.18) / 2 + 0.12, 0], [0, 0, 0], false));
      }
    };

    buildWall("N");
    buildWall("S");
    buildWall("E");
    buildWall("W");

    // exterior trim: corner pilasters
    const quoinMat = materialFor(0x524d47, { roughness: 0.9, family: "stone", seed: 6 });
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        g.add(part(bevelledBox(t * 1.1, h, t * 1.1, 0.025), quoinMat, [sx * (w / 2 - t * 0.35), h / 2, sz * (d / 2 - t * 0.35)]));
      }
    }

    // interior floor slab (walkable)
    const innerMat = o.inner ?? materialFor(0x6b6258, { roughness: 0.94, family: "wood", seed: 14 });
    const floor = addLocalSolid(innerMat, w - 2 * t, 0.12, d - 2 * t, 0, 0.06, 0, false)!;
    floor.userData.kind = "wood";

    // interior partition wall with offset doorway (2-room CQB layout)
    if (partition !== "none") {
      const pT = 0.22;
      const gapW = 1.85;
      if (partition === "z" && d > 5) {
        const span = w - 2 * t;
        const leftW = Math.max(0.8, span * 0.58 - gapW / 2);
        const rightW = Math.max(0.8, span - leftW - gapW);
        addLocalSolid(linerMat, leftW, h - 0.15, pT, -span / 2 + leftW / 2, (h - 0.15) / 2 + 0.12, 0);
        addLocalSolid(linerMat, rightW, h - 0.15, pT, span / 2 - rightW / 2, (h - 0.15) / 2 + 0.12, 0);
        if (h - doorH > 0.08) {
          addLocalSolid(linerMat, gapW, h - doorH, pT, -span / 2 + leftW + gapW / 2, doorH + (h - doorH) / 2, 0);
        }
      } else if (partition === "x" && w > 5) {
        const span = d - 2 * t;
        const backD = Math.max(0.8, span * 0.58 - gapW / 2);
        const frontD = Math.max(0.8, span - backD - gapW);
        addLocalSolid(linerMat, pT, h - 0.15, backD, 0, (h - 0.15) / 2 + 0.12, -span / 2 + backD / 2);
        addLocalSolid(linerMat, pT, h - 0.15, frontD, 0, (h - 0.15) / 2 + 0.12, span / 2 - frontD / 2);
        if (h - doorH > 0.08) {
          addLocalSolid(linerMat, pT, h - doorH, gapW, 0, doorH + (h - doorH) / 2, -span / 2 + backD + gapW / 2);
        }
      }
    }

    // interior tactical furniture & warm overhead lamp
    const furnMat = materialFor(0x5a4a38, { roughness: 0.85, family: "wood", seed: 16 });
    const iz = partition === "z" ? -d * 0.25 : -d * 0.18;
    const ix = partition === "x" ? -w * 0.24 : 0;
    const cr1 = craftedCrate(0.68, 41);
    cr1.position.set(ix - 0.9, 0.12, iz + 0.2);
    cr1.rotation.y = 0.22;
    g.add(cr1);
    const cr2 = craftedCrate(0.55, 42);
    cr2.position.set(ix + 1.0, 0.12, iz - 0.25);
    cr2.rotation.y = -0.18;
    g.add(cr2);
    g.add(part(bevelledBox(1.2, 0.08, 0.7, 0.02), furnMat, [ix, 0.92, iz]));
    for (const [dx, dz] of [[-0.5, -0.25], [0.5, -0.25], [-0.5, 0.25], [0.5, 0.25]]) {
      g.add(part(new THREE.BoxGeometry(0.06, 0.82, 0.06), furnMat, [ix + dx, 0.51, iz + dz]));
    }
    const rodMat = materialFor(0x2a2a2a, { roughness: 0.6, metalness: 0.8 });
    g.add(part(new THREE.CylinderGeometry(0.02, 0.02, 0.55, 8), rodMat, [0, h - 0.3, 0], [0, 0, 0], false));
    g.add(part(new THREE.ConeGeometry(0.24, 0.14, 16, 1, true), rodMat, [0, h - 0.58, 0], [0, 0, 0], false));
    const bulb = new THREE.Mesh(
      new THREE.SphereGeometry(0.11, 12, 10),
      new THREE.MeshStandardMaterial({ color: 0xffe9b0, emissive: 0xffd98a, emissiveIntensity: 1.7, roughness: 0.4 })
    );
    bulb.position.set(0, h - 0.64, 0);
    g.add(bulb);

    if (o.roof !== "none") this.roofLocal(g, w, d, h, o.roof ?? "flat", o.roofMat, wallNS);
    if (o.walkableRoof) {
      addLocalSolid(this.invisMat, w + 0.45, 0.36, d + 0.45, 0, h + 0.18, 0, false);
    }
    if (o.parapet) this.parapetLocal(g, w, d, h, o.roofMat);
    return { x, z, w, d, h };
  }

  /** Recessed 3D window bays (+ optional shutters) mounted flush on all four faces */
  windowTrim(o: {
    x: number; z: number; w: number; d: number; h: number;
    bayW: number; floorH: number; rows: number; cols: number;
    ry: number; frameMat: THREE.Material; shutterMat: THREE.Material | null;
  }) {
    const { x, z, w, d, h, bayW, floorH, ry } = o;
    const rowCount = Math.max(1, Math.min(2, Math.floor((h - 0.8) / floorH) || 1));
    const winH = Math.min(1.15, floorH * 0.45);
    const g = new THREE.Group();
    g.position.set(x, 0, z);
    g.rotation.y = ry;
    this.scene.add(g);

    const frameCol = (o.frameMat as THREE.MeshStandardMaterial)?.color?.getHexString?.() ?? "5a422c";
    const shutterCol = (o.shutterMat as THREE.MeshStandardMaterial)?.color?.getHexString?.() ?? "3f533b";
    const addFace = (alongX: boolean, sign: number, len: number, wallDist: number) => {
      const count = Math.max(1, Math.min(4, Math.floor(len / (bayW * 1.4))));
      const winW = Math.min(0.95, (len / count) * 0.44);
      const step = len / (count + 0.4);
      for (let m = 0; m < count; m++) {
        const p = (m - (count - 1) / 2) * step;
        for (let row = 0; row < rowCount; row++) {
          const wy = 1.45 + row * floorH;
          if (wy + winH / 2 > h - 0.35) continue;
          const win = insetWindow({
            width: winW,
            height: winH,
            inset: 0.08,
            frame: 0.06,
            bars: 1,
            rows: 1,
            sill: true,
            shutters: Boolean(o.shutterMat),
            frameColor: "#" + frameCol,
            shutterColor: "#" + shutterCol,
            glassColor: "#212b36",
            emissive: "#ffcf7a",
            emissiveIntensity: 0.12,
            seed: Math.abs(Math.round(x * 7 + z * 11 + m * 3 + row)),
          });
          if (alongX) {
            win.position.set(p, wy, sign * (wallDist + 0.02));
            win.rotation.y = sign > 0 ? 0 : Math.PI;
          } else {
            win.position.set(sign * (wallDist + 0.02), wy, p);
            win.rotation.y = sign > 0 ? Math.PI / 2 : -Math.PI / 2;
          }
          g.add(win);
        }
      }
    };
    addFace(true, 1, w, d / 2);
    addFace(true, -1, w, d / 2);
    addFace(false, 1, d, w / 2);
    addFace(false, -1, d, w / 2);
    return g;
  }

  /* flight of steps ascending along +X/-X (or +Z/-Z when alongZ). */
  stairs(o: {
    x: number;
    z: number;
    steps: number;
    rise: number;
    run: number;
    width: number;
    alongZ?: boolean;
    dir?: 1 | -1;
    mat: THREE.Material;
    sideMat?: THREE.Material;
  }) {
    const { x, z, steps, rise, run, width } = o;
    const alongZ = o.alongZ ?? false;
    const dir = o.dir ?? 1;
    const stepMat = o.mat;
    const sideMat = o.sideMat ?? materialFor(0x7a7e84, { roughness: 0.55, metalness: 0.5 });
    for (let i = 0; i < steps; i++) {
      const h = (i + 1) * rise;
      const off = dir * i * run;
      const sx = x + (alongZ ? 0 : off);
      const sz = z + (alongZ ? off : 0);
      const m = this.mesh(
        stepMat,
        new RoundedBoxGeometry(alongZ ? width : run, h, alongZ ? run : width, 2, Math.min(0.035, h / 3)),
        sx,
        h / 2,
        sz,
        0
      );
      m.castShadow = true;
      m.receiveShadow = true;
      m.userData.kind = "concrete";
      this.scene.add(m);
      this.colliders.push(m);
      // Under-stair solid block so ground units can't walk underneath tall stairs,
      // recessed 0.55m below the ramp surface so climbers never snag on step risers.
      if (h > 0.7) {
        this.colliderBox(alongZ ? width : run, h - 0.55, alongZ ? run : width, sx, 0, sz, 0, "concrete");
      }
      // non-slip tread nosing on leading top edge of step
      const nosing = this.mesh(
        sideMat,
        new RoundedBoxGeometry(alongZ ? width : 0.08, 0.04, alongZ ? 0.08 : width, 2, 0.01),
        sx + (alongZ ? 0 : -dir * (run / 2 - 0.04)),
        h + 0.01,
        sz + (alongZ ? -dir * (run / 2 - 0.04) : 0),
        0
      );
      this.scene.add(nosing);
    }

    // Smooth inclined ramp surface covering the full stair flight (seamless climbing & descending)
    const totalRun = steps * run;
    const totalRise = steps * rise;
    const startCoord = (alongZ ? z : x) - dir * (run * 0.5);
    const endCoord = startCoord + dir * totalRun;
    const minAlong = Math.min(startCoord, endCoord) - 0.35;
    const maxAlong = Math.max(startCoord, endCoord) + 0.35;
    const halfLat = width * 0.5 + 0.16;
    const minX = alongZ ? x - halfLat : minAlong;
    const maxX = alongZ ? x + halfLat : maxAlong;
    const minZ = alongZ ? minAlong : z - halfLat;
    const maxZ = alongZ ? maxAlong : z + halfLat;
    this.walkableSurfaces.push({
      id: `stairs_${this.walkableSurfaces.length}`,
      minX,
      maxX,
      minZ,
      maxZ,
      minY: 0,
      maxY: totalRise,
      heightAt: (px, pz) => {
        if (px < minX || px > maxX || pz < minZ || pz > maxZ) return null;
        const coord = alongZ ? pz : px;
        const t = ((coord - startCoord) * dir) / totalRun;
        if (t < -0.25 / totalRun || t > 1 + 0.35 / totalRun) return null;
        return Math.max(0, Math.min(totalRise, t * totalRise));
      },
    });
    // handrails on both sides
    const railMat = materialFor(0x2a2d30, { roughness: 0.5, metalness: 0.85 });
    const railLen = Math.hypot((steps - 1) * run, (steps - 1) * rise) + 0.35;
    const slopeAng = Math.atan2(steps * rise, steps * run);
    const midOff = (dir * (steps - 1) * run) / 2;
    const midY = ((steps + 1) * rise) / 2 + 0.88;
    for (const side of [-1, 1]) {
      const sideOff = side * (width / 2 + 0.08);
      for (let i = 0; i < steps; i += 2) {
        const h = (i + 1) * rise;
        const off = dir * i * run;
        const px = x + (alongZ ? sideOff : off);
        const pz = z + (alongZ ? off : sideOff);
        const post = this.mesh(railMat, new THREE.CylinderGeometry(0.032, 0.032, 0.9, 10), px, h + 0.45, pz);
        post.castShadow = true;
        this.scene.add(post);
      }
      const rx = x + (alongZ ? sideOff : midOff);
      const rz = z + (alongZ ? midOff : sideOff);
      const bar = this.mesh(railMat, new THREE.CylinderGeometry(0.026, 0.026, railLen, 10), rx, midY, rz);
      if (alongZ) {
        bar.rotation.x = dir * (Math.PI / 2 - slopeAng);
      } else {
        bar.rotation.z = -dir * (Math.PI / 2 - slopeAng);
      }
      bar.castShadow = true;
      this.scene.add(bar);
    }
  }

  roofLocal(parent: THREE.Object3D, w: number, d: number, h: number, kind: string, mat: THREE.Material, wallMat?: THREE.Material) {
    const fasciaMat = materialFor(0x3a3a40, { roughness: 0.8, metalness: 0.35 });
    if (kind === "flat") {
      const rm = this.roofSurfaceMat(mat, this.pTex("gravel", () => gravelTex(256, this.rng)), [Math.max(1, w / 5), Math.max(1, d / 5)]);
      parent.add(part(bevelledBox(w + 0.5, 0.36, d + 0.5, 0.06), rm, [0, h + 0.18, 0]));
      parent.add(part(bevelledBox(w + 0.2, 0.1, d + 0.2, 0.03), rm, [0, h + 0.4, 0]));
      for (const sz of [-1, 1]) parent.add(part(bevelledBox(w + 0.56, 0.14, 0.14, 0.02), fasciaMat, [0, h + 0.08, sz * (d / 2 + 0.25)]));
      for (const sx of [-1, 1]) parent.add(part(bevelledBox(0.14, 0.14, d + 0.56, 0.02), fasciaMat, [sx * (w / 2 + 0.25), h + 0.08, 0]));
    } else if (kind === "tile" || kind === "gable") {
      const alongZ = d >= w;
      const rw = alongZ ? d : w;
      const rd = alongZ ? w : d;
      const tileCol = (mat as THREE.MeshStandardMaterial)?.color?.getHexString?.() ?? (kind === "tile" ? "8a3b2a" : "50545c");
      const ridgeCol = kind === "tile" ? "#6c2c1f" : "#3a3e46";
      const gRoof = gableRoof({
        width: rw,
        depth: rd,
        wallH: h,
        pitchDeg: kind === "tile" ? 30 : 34,
        eave: 0.38,
        verge: 0.25,
        tileColor: "#" + tileCol,
        ridgeColor: ridgeCol,
        wallMat: wallMat ?? materialFor(0x8a8074, { roughness: 0.9, family: "plaster" }),
        chimney: true,
        seed: Math.abs(Math.round(w * 11 + d * 17 + h * 5)),
      });
      if (alongZ) gRoof.rotation.y = Math.PI / 2;
      parent.add(gRoof);
    } else {
      const rm = this.roofSurfaceMat(mat, this.pTex("corr", () => corrugTex(256, this.rng)), [Math.max(1, w / 3), Math.max(1, d / 3)]);
      parent.add(part(bevelledBox(w + 0.45, 0.22, d + 0.45, 0.04), rm, [0, h + 0.14, 0]));
      for (const sz of [-1, 1]) parent.add(part(bevelledBox(w + 0.5, 0.14, 0.14, 0.02), fasciaMat, [0, h + 0.08, sz * (d / 2 + 0.22)]));
      for (const sx of [-1, 1]) parent.add(part(bevelledBox(0.14, 0.14, d + 0.5, 0.02), fasciaMat, [sx * (w / 2 + 0.22), h + 0.08, 0]));
    }
  }

  roof(x: number, z: number, w: number, d: number, h: number, kind: string, mat: THREE.Material) {
    const g = new THREE.Group();
    g.position.set(x, 0, z);
    this.scene.add(g);
    this.roofLocal(g, w, d, h, kind, mat);
  }

  parapetLocal(parent: THREE.Object3D, w: number, d: number, h: number, mat: THREE.Material) {
    const t = 0.25;
    const H = 0.85;
    const ox = w / 2 + 0.14;
    const oz = d / 2 + 0.14;
    const cap = materialFor(0x6a6a70, { roughness: 0.85, family: "stone", seed: 5 });
    for (const sx of [-1, 1]) parent.add(part(bevelledBox(t, H, d + 0.42, 0.03), mat, [sx * ox, h + H / 2, 0]));
    for (const sz of [-1, 1]) parent.add(part(bevelledBox(w + 0.42, H, t, 0.03), mat, [0, h + H / 2, sz * oz]));
    const step = 1.35;
    const n = Math.max(1, Math.floor((d + 0.4) / step));
    for (let i = 0; i <= n; i++) {
      const zc = -(d + 0.4) / 2 + i * step;
      for (const sx of [-1, 1]) parent.add(part(bevelledBox(t + 0.12, 0.14, step * 0.58, 0.02), cap, [sx * ox, h + H + 0.05, zc]));
    }
  }

  parapet(x: number, z: number, w: number, d: number, h: number, mat: THREE.Material) {
    const g = new THREE.Group();
    g.position.set(x, 0, z);
    this.scene.add(g);
    this.parapetLocal(g, w, d, h, mat);
  }

  roofDetailsLocal(parent: THREE.Object3D, w: number, d: number, h: number, mat: THREE.Material) {
    const r = this.rng;
    const acCount = 1 + Math.floor(r() * 2);
    for (let i = 0; i < acCount; i++) {
      const ac = this.makeAcUnitGroup(r() * Math.PI);
      ac.position.set((r() - 0.5) * w * 0.55, h + 0.42, (r() - 0.5) * d * 0.55);
      parent.add(ac);
    }
    if (r() < 0.5) {
      const tx = (r() - 0.5) * w * 0.45;
      const tz = (r() - 0.5) * d * 0.45;
      const tankMat = materialFor(0x8a8f96, { roughness: 0.5, metalness: 0.7 });
      for (const [lx, lz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
        parent.add(part(new THREE.CylinderGeometry(0.07, 0.07, 0.6, 8), tankMat, [tx + lx * 0.55, h + 0.7, tz + lz * 0.55]));
      }
      parent.add(part(new THREE.CylinderGeometry(0.75, 0.75, 1.35, 18), tankMat, [tx, h + 1.65, tz]));
      parent.add(part(new THREE.ConeGeometry(0.8, 0.4, 18), materialFor(0x5a5f66, { roughness: 0.6, metalness: 0.6 }), [tx, h + 2.5, tz]));
    }
    if (r() < 0.6) {
      const ax = (r() - 0.5) * w * 0.4;
      const az = (r() - 0.5) * d * 0.4;
      const mastH = 2 + r() * 2;
      parent.add(part(new THREE.CylinderGeometry(0.04, 0.05, mastH, 8), mat, [ax, h + 0.4 + mastH / 2, az]));
      parent.add(part(new THREE.CylinderGeometry(0.02, 0.02, 0.8, 6), mat, [ax, h + 0.4 + mastH * 0.7, az], [0, 0, Math.PI / 2]));
    }
  }

  roofDetails(x: number, z: number, w: number, d: number, h: number, mat: THREE.Material) {
    const g = new THREE.Group();
    g.position.set(x, 0, z);
    this.scene.add(g);
    this.roofDetailsLocal(g, w, d, h, mat);
  }

  /* ---------------- props ---------------- */
  crate(_mat: THREE.Material, x: number, z: number, s: number, ry = 0, y = 0) {
    const vis = craftedCrate(s, Math.abs(Math.round(x * 13 + z * 19 + s * 7)) + 1);
    vis.position.set(x, y, z);
    vis.rotation.y = ry;
    this.scene.add(vis);
    return this.colliderBox(s + 0.04, s + 0.06, s + 0.04, x, y, z, ry, "wood");
  }

  barrel(_mat: THREE.Material, x: number, z: number, color = 0x9b2c22) {
    const vis = craftedBarrel(color, true);
    vis.position.set(x, 0, z);
    this.scene.add(vis);
    const col = this.mesh(this.invisMat, new THREE.CylinderGeometry(0.4, 0.4, 1.05, 12), x, 0.525, z);
    col.userData.kind = "metal";
    this.scene.add(col);
    this.colliders.push(col);
    col.updateWorldMatrix(true, false);
    this.aabbs.push(new THREE.Box3().setFromObject(col));
  }

  sandbag(x: number, z: number, ry = 0, count = 5) {
    const g = new THREE.Group();
    g.position.set(x, 0, z);
    g.rotation.y = ry;
    this.scene.add(g);
    const mat = materialFor(0x8d8163, { roughness: 0.94, family: "fabric", seed: 18 });
    const seamMat = materialFor(0x5a5240, { roughness: 0.98 });
    const bagGeo = new RoundedBoxGeometry(0.65, 0.27, 0.36, 4, 0.09);
    const seamGeo = new THREE.BoxGeometry(0.6, 0.014, 0.3);
    for (let i = 0; i < count; i++) {
      const row = Math.floor(i / 3);
      const col = i % 3;
      const bx = (col - 1) * 0.58 + (row % 2) * 0.22;
      const by = 0.13 + row * 0.25;
      const b = this.mesh(mat, bagGeo, bx, by, 0, (col - 1) * 0.04);
      b.castShadow = true;
      b.receiveShadow = true;
      g.add(b);
      b.add(new THREE.Mesh(seamGeo, seamMat));
    }
  }

  car(x: number, z: number, ry = 0, color = 0x2e5a8c, scale = 1) {
    const body = materialFor(color, { roughness: 0.38, metalness: 0.55 });
    const darkTrim = materialFor(0x1b1e22, { roughness: 0.72, metalness: 0.2 });
    const glass = materialFor(0x14181e, { roughness: 0.14, metalness: 0.9 });
    const tire = materialFor(0x141416, { roughness: 0.9 });
    const chrome = materialFor(0x9aa0a8, { roughness: 0.28, metalness: 0.95 });
    const grp = new THREE.Group();
    grp.position.set(x, 0, z);
    grp.rotation.y = ry;
    this.scene.add(grp);

    // lower body + front/rear bumpers
    const b = this.mesh(body, new RoundedBoxGeometry(2.0 * scale, 0.64 * scale, 4.55 * scale, 4, 0.12 * scale), 0, 0.56 * scale, 0);
    b.castShadow = true;
    b.receiveShadow = true;
    grp.add(b);
    for (const sz of [-1, 1]) {
      grp.add(part(bevelledBox(1.96 * scale, 0.2 * scale, 0.18 * scale, 0.03 * scale), darkTrim, [0, 0.34 * scale, sz * 2.26 * scale]));
    }
    // grille
    grp.add(part(bevelledBox(0.95 * scale, 0.22 * scale, 0.06 * scale, 0.02 * scale), darkTrim, [0, 0.55 * scale, 2.28 * scale]));
    // cabin + sloped windshield + rear window
    const c = this.mesh(body, new RoundedBoxGeometry(1.7 * scale, 0.62 * scale, 2.0 * scale, 4, 0.09 * scale), 0, 1.12 * scale, -0.15 * scale);
    c.castShadow = true;
    grp.add(c);
    grp.add(part(bevelledBox(1.74 * scale, 0.5 * scale, 1.8 * scale, 0.04 * scale), glass, [0, 1.12 * scale, -0.15 * scale]));
    const ws = part(bevelledBox(1.56 * scale, 0.58 * scale, 0.08 * scale, 0.02 * scale), glass, [0, 1.08 * scale, 0.85 * scale], [-0.52, 0, 0]);
    grp.add(ws);
    // headlights + taillights
    const lightMat = materialFor(0xfff4c0, { emissive: 0xfff0b0, emissiveIntensity: 0.7 });
    const tailMat = materialFor(0xff2222, { emissive: 0xcc1111, emissiveIntensity: 0.6 });
    for (const sx of [-0.7, 0.7]) {
      grp.add(part(new THREE.BoxGeometry(0.28 * scale, 0.14 * scale, 0.08 * scale), lightMat, [sx * scale, 0.62 * scale, 2.27 * scale], [0, 0, 0], false));
      grp.add(part(new THREE.BoxGeometry(0.26 * scale, 0.13 * scale, 0.08 * scale), tailMat, [sx * scale, 0.62 * scale, -2.27 * scale], [0, 0, 0], false));
    }
    // mirrors
    for (const sx of [-1, 1]) {
      grp.add(part(new THREE.CylinderGeometry(0.03 * scale, 0.03 * scale, 0.2 * scale, 8), darkTrim, [sx * 0.94 * scale, 1.0 * scale, 0.5 * scale], [0, 0, Math.PI / 2]));
      grp.add(part(new RoundedBoxGeometry(0.16 * scale, 0.11 * scale, 0.08 * scale, 2, 0.02 * scale), body, [sx * 1.05 * scale, 1.0 * scale, 0.5 * scale]));
    }
    // wheels + wheel arches
    for (const [wx, wz] of [[-0.86, 1.32], [0.86, 1.32], [-0.86, -1.38], [0.86, -1.38]]) {
      grp.add(part(new THREE.CylinderGeometry(0.38 * scale, 0.38 * scale, 0.25 * scale, 24), tire, [wx * scale, 0.38 * scale, wz * scale], [0, 0, Math.PI / 2]));
      grp.add(part(new THREE.CylinderGeometry(0.2 * scale, 0.2 * scale, 0.27 * scale, 14), chrome, [wx * scale, 0.38 * scale, wz * scale], [0, 0, Math.PI / 2]));
    }
    // invisible physics collider (zero z-fighting!)
    this.colliderBox(2.0 * scale, 1.4 * scale, 4.55 * scale, x, 0, z, ry, "metal");
  }

  truck(x: number, z: number, ry = 0, color = 0x3a5a3a) {
    const body = materialFor(color, { roughness: 0.55, metalness: 0.35 });
    const cab = materialFor(0x2c4a2c, { roughness: 0.45, metalness: 0.55 });
    const tire = materialFor(0x141416, { roughness: 0.9 });
    const chrome = materialFor(0x9aa0a8, { roughness: 0.3, metalness: 0.92 });
    const glass = materialFor(0x14181e, { roughness: 0.15, metalness: 0.9 });

    const grp = new THREE.Group();
    grp.position.set(x, 0, z);
    grp.rotation.y = ry;
    this.scene.add(grp);

    // cargo bed body + cab in local space
    const visBody = this.mesh(body, new RoundedBoxGeometry(2.4, 2.0, 6.8, 4, 0.14), 0, 1.35, -0.5);
    visBody.castShadow = true;
    visBody.receiveShadow = true;
    grp.add(visBody);
    const chassis = this.mesh(materialFor(0x1e2024, { roughness: 0.75, metalness: 0.4 }), bevelledBox(2.1, 0.35, 9.2, 0.03), 0, 0.42, 0.5);
    grp.add(chassis);
    const visCab = this.mesh(cab, new RoundedBoxGeometry(2.35, 1.75, 2.5, 4, 0.14), 0, 1.35, 3.65);
    visCab.castShadow = true;
    visCab.receiveShadow = true;
    grp.add(visCab);
    // front grille + bumper
    grp.add(part(bevelledBox(1.8, 0.55, 0.08, 0.02), materialFor(0x1c1e22, { roughness: 0.6, metalness: 0.4 }), [0, 0.85, 4.91]));
    grp.add(part(bevelledBox(2.4, 0.25, 0.2, 0.03), chrome, [0, 0.42, 4.95]));
    // windshield + side mirrors
    grp.add(part(bevelledBox(2.06, 0.68, 0.08, 0.02), glass, [0, 1.66, 4.88], [-0.15, 0, 0]));
    for (const sx of [-1, 1]) {
      grp.add(part(new THREE.CylinderGeometry(0.03, 0.03, 0.35, 8), chrome, [sx * 1.32, 1.55, 4.2], [0, 0, Math.PI / 2]));
      grp.add(part(bevelledBox(0.12, 0.26, 0.08, 0.02), materialFor(0x222, { roughness: 0.6 }), [sx * 1.46, 1.55, 4.2]));
    }
    // cargo bed wooden slats + strapped crates on top
    const slatMat = materialFor(0x5a4a30, { roughness: 0.9, family: "wood", seed: 19 });
    for (let i = -2; i <= 2; i++) {
      grp.add(part(new THREE.BoxGeometry(2.26, 0.06, 0.14), slatMat, [0, 2.38, -0.5 + i * 1.25]));
    }
    const c1 = craftedCrate(0.85, 71);
    c1.position.set(-0.45, 2.41, -1.2);
    c1.rotation.y = 0.12;
    grp.add(c1);
    const c2 = craftedCrate(0.68, 72);
    c2.position.set(0.55, 2.41, 0.2);
    c2.rotation.y = -0.18;
    grp.add(c2);
    // wheels + hubs (6x6 military truck)
    for (const [wx, wz] of [[-1.08, 3.7], [1.08, 3.7], [-1.08, -0.3], [1.08, -0.3], [-1.08, -2.5], [1.08, -2.5]]) {
      grp.add(part(new THREE.CylinderGeometry(0.5, 0.5, 0.34, 24), tire, [wx, 0.5, wz], [0, 0, Math.PI / 2]));
      grp.add(part(new THREE.CylinderGeometry(0.24, 0.24, 0.36, 14), chrome, [wx, 0.5, wz], [0, 0, Math.PI / 2]));
    }

    // invisible physics colliders matching body + cab
    this.colliderBox(2.4, 2.35, 7.0, x - Math.sin(ry) * 0.5, 0, z - Math.cos(ry) * 0.5, ry, "metal");
    this.colliderBox(2.4, 2.1, 2.6, x + Math.sin(ry) * 3.6, 0, z + Math.cos(ry) * 3.6, ry, "metal");
  }

  container(x: number, y: number, z: number, ry = 0, color = 0x8a6a3a) {
    const c = new THREE.Color(color);
    const mat = materialFor(color, { roughness: 0.62, metalness: 0.35, family: "metal", seed: Math.abs(Math.round(x * 7 + z * 13)) });
    const ribMat = materialFor(c.clone().multiplyScalar(0.76).getHex(), { roughness: 0.68, metalness: 0.4 });
    const postMat = materialFor(c.clone().multiplyScalar(0.55).getHex(), { roughness: 0.65, metalness: 0.55 });
    const doorMat = materialFor(0x282a2e, { roughness: 0.55, metalness: 0.65 });

    const grp = new THREE.Group();
    grp.position.set(x, y, z);
    grp.rotation.y = ry;
    this.scene.add(grp);

    const body = this.mesh(mat, new RoundedBoxGeometry(5.96, 2.58, 2.46, 3, 0.08), 0, 1.3, 0);
    body.castShadow = true;
    body.receiveShadow = true;
    grp.add(body);
    // corrugated vertical ribs along both long sides + roof
    for (let i = -10; i <= 10; i++) {
      grp.add(part(new THREE.BoxGeometry(0.08, 2.32, 2.54), ribMat, [i * 0.26, 1.3, 0]));
    }
    // corner posts & castings
    for (const [px, pz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      grp.add(part(bevelledBox(0.16, 2.6, 0.16, 0.02), postMat, [px * 2.94, 1.3, pz * 1.19]));
    }
    // end double doors + locking bars at +x end
    grp.add(part(new THREE.BoxGeometry(0.06, 2.38, 0.04), doorMat, [3.0, 1.3, 0]));
    for (const dz of [-0.45, 0.45]) {
      grp.add(part(new THREE.CylinderGeometry(0.025, 0.025, 2.25, 8), doorMat, [3.03, 1.3, dz]));
      grp.add(part(new THREE.BoxGeometry(0.08, 0.07, 0.18), doorMat, [3.06, 0.95, dz]));
    }

    return this.colliderBox(6, 2.6, 2.5, x, y, z, ry, "metal");
  }

  containerRow(x: number, z: number, count: number, ry = 0, colors = [0x8a6a3a, 0x3a6a8a, 0x5a7a3a, 0x8a8a8a]) {
    for (let i = 0; i < count; i++) {
      this.container(x + i * 6.4, 0, z, ry + (i % 2 ? 0.04 : -0.04), colors[(i + Math.abs(Math.floor(x))) % colors.length]);
    }
  }

  fence(x1: number, z1: number, x2: number, z2: number) {
    const wood = materialFor(0x6b4f30, { roughness: 0.9, family: "wood", seed: 25 });
    const capMat = materialFor(0x4c3720, { roughness: 0.85, family: "wood", seed: 26 });
    const len = Math.hypot(x2 - x1, z2 - z1);
    const ux = (x2 - x1) / len;
    const uz = (z2 - z1) / len;
    const ang = Math.atan2(ux, uz) - Math.PI / 2;
    const grp = new THREE.Group();
    grp.position.set((x1 + x2) / 2, 0, (z1 + z2) / 2);
    grp.rotation.y = ang;
    this.scene.add(grp);

    const n = Math.max(2, Math.floor(len / 1.5));
    for (let i = 0; i <= n; i++) {
      const lx = -len / 2 + (len * i) / n;
      grp.add(part(bevelledBox(0.14, 1.38, 0.14, 0.02), wood, [lx, 0.69, 0]));
      grp.add(part(bevelledBox(0.18, 0.07, 0.18, 0.02), capMat, [lx, 1.4, 0]));
    }
    for (const y of [0.42, 1.08]) {
      grp.add(part(bevelledBox(len, 0.09, 0.06, 0.015), wood, [0, y, 0]));
    }
    const picketCount = Math.max(4, Math.floor(len / 0.24));
    const picketGeo = bevelledBox(0.11, 1.18, 0.03, 0.01);
    const picketInst = scatterInstances(
      picketGeo,
      wood,
      Array.from({ length: picketCount }, (_, i) => ({
        position: [-len / 2 + 0.12 + (i * (len - 0.24)) / Math.max(1, picketCount - 1), 0.68, 0.045] as [number, number, number],
        scale: [1, 0.96 + ((i * 7) % 5) * 0.02, 1] as [number, number, number],
        hue: (((i * 13) % 7) - 3) * 0.012,
      }))
    );
    grp.add(picketInst);

    // Segmented low fence colliders (1.28m tall so they block walking but can be jumped/vaulted over)
    const segs = Math.max(2, Math.ceil(len / 2.2));
    const segLen = len / segs;
    for (let i = 0; i < segs; i++) {
      const t = (i + 0.5) / segs;
      const sx = x1 + (x2 - x1) * t;
      const sz = z1 + (z2 - z1) * t;
      this.colliderBox(segLen, 1.28, 0.26, sx, 0, sz, ang, "wood");
    }
  }

  tree(x: number, z: number, s = 1) {
    if (this.inClearZone(x, z, 2.5)) return;
    const seed = Math.abs(Math.round(x * 19 + z * 31)) + 1;
    const t = seed % 3 === 0 ? craftedTreeConifer(s * 1.1, seed) : craftedTreeRound(s, seed);
    t.position.set(x, 0, z);
    this.scene.add(t);
  }

  haystack(x: number, z: number) {
    const mat = materialFor(0xc9a84a, { roughness: 0.96, family: "fabric", seed: 33 });
    const g = new THREE.Group();
    g.position.set(x, 0, z);
    this.scene.add(g);
    const m = this.mesh(mat, new THREE.CylinderGeometry(1.15, 1.55, 1.6, 20), 0, 0.8, 0);
    m.castShadow = true;
    m.receiveShadow = true;
    g.add(m);
    const cap = this.mesh(mat, new THREE.SphereGeometry(1.15, 20, 12, 0, Math.PI * 2, 0, Math.PI * 0.5), 0, 1.58, 0);
    cap.scale.y = 0.65;
    cap.castShadow = true;
    g.add(cap);
    const ridge = materialFor(0x8c702a, { roughness: 0.95 });
    for (const y of [0.55, 1.15]) {
      g.add(part(new THREE.TorusGeometry(y < 1 ? 1.4 : 1.24, 0.035, 8, 24), ridge, [0, y, 0], [Math.PI / 2, 0, 0], false));
    }
  }

  streetlight(x: number, z: number, ry = 0, lit = true, color = 0xffbe6b) {
    const poleMat = materialFor(0x2a2d30, { roughness: 0.55, metalness: 0.82 });
    const darkMat = materialFor(0x1a1c1f, { roughness: 0.55, metalness: 0.65 });
    const grp = new THREE.Group();
    grp.position.set(x, 0, z);
    grp.rotation.y = ry;
    this.scene.add(grp);

    // cast iron base collar + tapered shaft
    grp.add(part(new THREE.CylinderGeometry(0.18, 0.24, 0.55, 16), darkMat, [0, 0.275, 0]));
    grp.add(part(new THREE.CylinderGeometry(0.08, 0.13, 4.9, 18), poleMat, [0, 2.55, 0]));
    grp.add(part(new THREE.BoxGeometry(0.18, 0.45, 0.06), darkMat, [0, 1.2, 0.11]));
    // horizontal arm pointing along +Z in local space
    grp.add(part(new THREE.CylinderGeometry(0.045, 0.055, 1.6, 12), poleMat, [0, 4.95, 0.8], [Math.PI / 2, 0, 0]));
    grp.add(part(new THREE.CylinderGeometry(0.025, 0.025, 0.75, 8), poleMat, [0, 4.68, 0.35], [Math.PI / 4, 0, 0]));
    // lantern hood + glowing diffuser
    grp.add(part(bevelledBox(0.36, 0.14, 0.54, 0.03), darkMat, [0, 4.96, 1.56]));
    grp.add(
      part(
        new THREE.SphereGeometry(0.15, 14, 10),
        new THREE.MeshStandardMaterial({
          color: lit ? color : 0x555b62,
          emissive: lit ? color : 0x000000,
          emissiveIntensity: lit ? 3.8 : 0,
          roughness: 0.25,
        }),
        [0, 4.86, 1.62],
        [0, 0, 0],
        false,
      ),
    );

    if (lit) {
      const coneMat = new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.045,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
      });
      const cone = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 2.75, 1, 16, 1, true), coneMat);
      cone.scale.set(1, 4.86, 1);
      cone.position.set(0, 2.43, 1.62);
      cone.renderOrder = 2;
      grp.add(cone);

      const sinR = Math.sin(ry);
      const cosR = Math.cos(ry);
      const wx = x + sinR * 1.62;
      const wz = z + cosR * 1.62;
      this.streetLamps.push({
        head: new THREE.Vector3(wx, 4.82, wz),
        ground: new THREE.Vector3(wx, 0, wz),
        color,
      });
    }
  }

  /* ---------------- industry ---------------- */
  craneTower(x: number, z: number, h: number, ry = 0) {
    const yellow = materialFor(0xd8a81c, { roughness: 0.48, metalness: 0.55 });
    const braceMat = materialFor(0xb08614, { roughness: 0.55, metalness: 0.6 });
    const dark = materialFor(0x2a2a2a, { roughness: 0.6, metalness: 0.72 });
    const glass = materialFor(0x141a22, { roughness: 0.15, metalness: 0.9 });

    const grp = new THREE.Group();
    grp.position.set(x, 0, z);
    grp.rotation.y = ry;
    this.scene.add(grp);

    // ballast base pad
    grp.add(part(bevelledBox(3.2, 0.6, 3.2, 0.08), materialFor(0x6b6f75, { roughness: 0.9, family: "stone" }), [0, 0.3, 0]));
    // 4 corner mast chords + lattice braces
    for (const [cx, cz] of [[-0.55, -0.55], [0.55, -0.55], [-0.55, 0.55], [0.55, 0.55]]) {
      grp.add(part(new THREE.BoxGeometry(0.16, h, 0.16), yellow, [cx, h / 2, cz]));
    }
    for (let yy = 0.9; yy < h - 0.5; yy += 1.4) {
      for (const sz of [-0.55, 0.55]) grp.add(part(new THREE.BoxGeometry(1.15, 0.07, 0.07), braceMat, [0, yy, sz]));
      for (const sx of [-0.55, 0.55]) grp.add(part(new THREE.BoxGeometry(0.07, 0.07, 1.15), braceMat, [sx, yy, 0]));
    }
    // operator cab + slewing ring
    grp.add(part(new THREE.CylinderGeometry(0.85, 0.85, 0.35, 16), dark, [0, h - 0.2, 0]));
    grp.add(part(new RoundedBoxGeometry(1.75, 1.9, 2.2, 3, 0.12), yellow, [0.9, h - 0.75, 1.0]));
    grp.add(part(bevelledBox(1.4, 0.9, 1.5, 0.03), glass, [0.9, h - 0.55, 1.35]));
    // main jib along +Z and counter-jib along -Z
    const jibLen = 22;
    grp.add(part(new RoundedBoxGeometry(0.85, 0.85, jibLen, 3, 0.1), yellow, [0, h + 0.35, 9.5]));
    grp.add(part(new RoundedBoxGeometry(0.85, 0.85, 8.5, 3, 0.1), yellow, [0, h + 0.35, -4.5]));
    grp.add(part(new RoundedBoxGeometry(2.2, 1.6, 1.7, 3, 0.15), dark, [0, h - 0.5, -7.2]));
    // cat-head peak + stay cables (top of cylinder tilts toward +Z on +rotX, toward -Z on -rotX)
    grp.add(part(new THREE.ConeGeometry(0.8, 3.2, 4), yellow, [0, h + 2.2, 0], [0, Math.PI / 4, 0]));
    grp.add(part(new THREE.CylinderGeometry(0.03, 0.03, 18.4, 8), dark, [0, h + 2.25, 9.0], [-1.4, 0, 0]));
    grp.add(part(new THREE.CylinderGeometry(0.03, 0.03, 8.2, 8), dark, [0, h + 2.15, -3.7], [1.18, 0, 0]));
    // trolley + hoist cable + hook block
    grp.add(part(bevelledBox(1.0, 0.5, 1.1, 0.05), dark, [0, h - 0.1, 12.0]));
    grp.add(part(new THREE.CylinderGeometry(0.03, 0.03, 6.2, 10), dark, [0, h - 3.3, 12.0]));
    grp.add(part(bevelledBox(0.7, 0.7, 0.7, 0.08), dark, [0, h - 6.5, 12.0]));

    const beacon = new THREE.Mesh(
      new THREE.SphereGeometry(0.14, 14, 10),
      new THREE.MeshStandardMaterial({ color: 0xff2222, emissive: 0xff0000, emissiveIntensity: 3 })
    );
    beacon.position.set(0, h + 3.9, 0);
    grp.add(beacon);
    this.beacon(beacon, 3, this.rng() * 6);

    const mastCol = this.colliderBox(1.4, h, 1.4, x, 0, z, ry, "metal");
    return { mast: mastCol, x, z, h, ry };
  }

  craneGantry(x: number, z: number, h: number, span: number) {
    const yellow = materialFor(0xd8a81c, { roughness: 0.48, metalness: 0.55 });
    const dark = materialFor(0x2a2a2a, { roughness: 0.6, metalness: 0.72 });
    const grp = new THREE.Group();
    grp.position.set(x, 0, z);
    this.scene.add(grp);

    for (const sx of [-1, 1]) {
      const lx = sx * (span / 2);
      // wheel bogie beam along Z
      grp.add(part(bevelledBox(0.9, 0.6, 3.6, 0.06), dark, [lx, 0.3, 0]));
      // angled A-frame twin legs meeting at top girder
      grp.add(part(new RoundedBoxGeometry(0.65, h, 0.65, 3, 0.1), yellow, [lx, h / 2, -0.95], [0.06, 0, 0]));
      grp.add(part(new RoundedBoxGeometry(0.65, h, 0.65, 3, 0.1), yellow, [lx, h / 2, 0.95], [-0.06, 0, 0]));
      // mid horizontal tie
      grp.add(part(bevelledBox(0.35, 0.35, 1.8, 0.04), dark, [lx, h * 0.5, 0]));
      // colliders for both legs
      this.colliderBox(0.9, h, 2.4, x + lx, 0, z, 0, "metal");
    }
    // twin bridge girders spanning ALONG X between the legs!
    grp.add(part(new RoundedBoxGeometry(span + 2.2, 0.95, 0.75, 3, 0.12), yellow, [0, h, -0.55]));
    grp.add(part(new RoundedBoxGeometry(span + 2.2, 0.95, 0.75, 3, 0.12), yellow, [0, h, 0.55]));
    // trolley + spreader frame
    grp.add(part(bevelledBox(1.4, 0.6, 1.9, 0.06), dark, [3, h - 0.6, 0]));
    for (const sz of [-0.6, 0.6]) {
      grp.add(part(new THREE.CylinderGeometry(0.025, 0.025, 3.6, 8), dark, [3, h - 2.4, sz]));
    }
    grp.add(part(bevelledBox(2.4, 0.35, 1.6, 0.05), yellow, [3, h - 4.2, 0]));
  }

  excavator(x: number, z: number, ry = 0) {
    const yellow = materialFor(0xd8a81c, { roughness: 0.48, metalness: 0.45 });
    const dark = materialFor(0x222428, { roughness: 0.85, metalness: 0.3 });
    const track = materialFor(0x18181a, { roughness: 0.92 });
    const glass = materialFor(0x101418, { roughness: 0.18, metalness: 0.85 });

    const grp = new THREE.Group();
    grp.position.set(x, 0, z);
    grp.rotation.y = ry;
    this.scene.add(grp);

    // horizontal crawler tracks seated at y=0 along local Z
    for (const sx of [-1, 1]) {
      grp.add(part(new RoundedBoxGeometry(0.65, 0.72, 3.4, 3, 0.18), track, [sx * 1.15, 0.38, 0]));
      grp.add(part(bevelledBox(0.55, 0.44, 2.8, 0.05), dark, [sx * 1.15, 0.42, 0]));
      for (const sz of [-1.35, 1.35]) {
        grp.add(part(new THREE.CylinderGeometry(0.36, 0.36, 0.68, 18), dark, [sx * 1.15, 0.38, sz], [0, 0, Math.PI / 2]));
      }
    }
    // lower carbody + swing ring
    grp.add(part(bevelledBox(1.8, 0.4, 1.8, 0.06), dark, [0, 0.55, 0]));
    // upper rotating house + counterweight + operator cab
    grp.add(part(new RoundedBoxGeometry(2.3, 1.05, 3.2, 4, 0.16), yellow, [0, 1.25, -0.25]));
    grp.add(part(new RoundedBoxGeometry(2.35, 0.9, 0.7, 3, 0.14), dark, [0, 1.25, -1.65]));
    grp.add(part(new RoundedBoxGeometry(1.15, 1.45, 1.7, 3, 0.14), yellow, [-0.55, 1.95, 0.45]));
    grp.add(part(bevelledBox(0.92, 0.9, 1.35, 0.03), glass, [-0.55, 2.02, 0.62]));
    // articulated boom + stick + digging bucket
    grp.add(part(new RoundedBoxGeometry(0.45, 0.55, 3.2, 3, 0.1), yellow, [0.5, 2.35, 1.8], [-0.55, 0, 0]));
    grp.add(part(new RoundedBoxGeometry(0.38, 0.45, 2.3, 3, 0.08), yellow, [0.5, 2.25, 3.7], [0.75, 0, 0]));
    grp.add(part(new RoundedBoxGeometry(0.95, 0.8, 1.05, 3, 0.15), dark, [0.5, 1.2, 4.35], [0.35, 0, 0]));
    for (let i = 0; i < 4; i++) {
      grp.add(part(new THREE.ConeGeometry(0.06, 0.24, 6), dark, [0.16 + i * 0.22, 0.85, 4.82], [Math.PI / 2, 0, 0]));
    }
    this.colliderBox(2.6, 2.4, 3.8, x, 0, z, ry, "metal");
  }


  /* zigzag steel fire escape on a building's +z face — rooftop access */
  fireEscape(bx: number, bz: number, w: number, d: number, h: number) {
    const metal = new THREE.MeshStandardMaterial({ color: 0x2e2e34, roughness: 0.65, metalness: 0.85 });
    const stepMat = new THREE.MeshStandardMaterial({ color: 0x4a4a52, roughness: 0.8, metalness: 0.55 });
    const faceZ = bz + d / 2;
    const stepH = 0.5, stepD = 0.7, stepW = 3.0, perFlight = 3;
    const z0 = faceZ + 0.12;
    let y = 0;
    let dir = 1;
    let lat = bx - w / 2 + stepW / 2;
    let guard = 0;
    while (y < h - stepH && guard++ < 40) {
      for (let i = 0; i < perFlight && y < h - stepH; i++) {
        const s = this.mesh(stepMat, new RoundedBoxGeometry(stepW, stepH, stepD, 3, 0.05), lat + dir * i * stepW, y + stepH / 2, z0, 0);
        s.castShadow = true;
        s.receiveShadow = true;
        this.scene.add(s);
        this.colliders.push(s);
        this.aabbs.push(new THREE.Box3().setFromObject(s));
        // step nosing highlight
        const nose = this.mesh(new THREE.MeshStandardMaterial({ color: 0x5a5a62, roughness: 0.6, metalness: 0.6 }), new RoundedBoxGeometry(stepW, 0.04, 0.06, 2, 0.01), lat + dir * i * stepW, y + stepH, z0 + stepD / 2 - 0.03, 0);
        this.scene.add(nose);
        y += stepH;
      }
      // landing platform projecting from the wall at the flight top
      const landX = lat + dir * (perFlight - 1) * stepW + dir * stepW / 2;
      const land = this.mesh(metal, new RoundedBoxGeometry(stepW + 0.5, 0.12, stepD + 0.35, 3, 0.04), landX, y + 0.06, z0 + 0.05, 0);
      land.castShadow = true;
      land.receiveShadow = true;
      this.scene.add(land);
      this.colliders.push(land);
      this.aabbs.push(new THREE.Box3().setFromObject(land));
      lat += dir * perFlight * stepW;
      dir = -dir;
    }
    // outer railing (visual only)
    const railMat = new THREE.MeshStandardMaterial({ color: 0x222428, roughness: 0.7, metalness: 0.8 });
    const rz = z0 + stepD;
    let ry = 0;
    let rlat = bx - w / 2 + stepW / 2;
    let rdir = 1;
    let rguard = 0;
    while (ry < h && rguard++ < 40) {
      for (let i = 0; i < perFlight && ry < h; i++) {
        const post = this.mesh(railMat, new THREE.CylinderGeometry(0.04, 0.04, 0.9, 6), rlat + rdir * i * stepW, ry + 0.9, rz);
        this.scene.add(post);
        ry += stepH;
      }
      rlat += rdir * perFlight * stepW;
      rdir = -rdir;
    }
  }

  ship(x: number, z: number) {
    const hullMat = materialFor(0x2c4a66, { roughness: 0.58, metalness: 0.48, family: "metal", seed: 51 });
    const superMat = materialFor(0xe8e6e0, { roughness: 0.48, metalness: 0.25 });
    const deckMat = materialFor(0x4a4036, { roughness: 0.88, family: "wood", seed: 52 });
    const railMat = materialFor(0x22262a, { roughness: 0.6, metalness: 0.78 });
    const glass = materialFor(0x101418, { roughness: 0.16, metalness: 0.85 });

    // sculpted ship hull: full 13.4m beam matching the 14m walkable deck overhang
    const hull = this.mesh(hullMat, new RoundedBoxGeometry(13.4, 6.8, 42, 5, 0.55), x, 0, z, 0);
    hull.castShadow = true;
    hull.receiveShadow = true;
    // tapered V-bow pointing north (-Z)
    const bowShape = new THREE.Shape();
    bowShape.moveTo(-6.5, 0);
    bowShape.lineTo(0, 14);
    bowShape.lineTo(6.5, 0);
    bowShape.closePath();
    const bowGeo = new THREE.ExtrudeGeometry(bowShape, {
      depth: 6.4,
      bevelEnabled: true,
      bevelThickness: 0.35,
      bevelSize: 0.3,
      bevelSegments: 2,
    });
    bowGeo.rotateX(-Math.PI / 2);
    const bow = this.mesh(hullMat, bowGeo, x, -3.2, z - 20.5, 0);
    bow.castShadow = true;
    // bulbous bow below waterline
    const bulb = this.mesh(materialFor(0x8a1c1c, { roughness: 0.55, metalness: 0.35 }), new THREE.SphereGeometry(2.4, 20, 14), x, -2.0, z - 33, 0);
    bulb.scale.set(0.9, 0.55, 1.8);
    this.scene.add(hull, bow, bulb);

    // waterline stripe + boot topping (flush with hull sides)
    this.scene.add(part(new THREE.BoxGeometry(13.56, 0.46, 42.2), materialFor(0x8a1c1c, { roughness: 0.55, metalness: 0.35 }), [x, 0.05, z], [0, 0, 0], false));
    this.scene.add(part(new THREE.BoxGeometry(13.5, 0.32, 42.1), materialFor(0x1a1a1e, { roughness: 0.65, metalness: 0.4 }), [x, -0.7, z], [0, 0, 0], false));

    // waterline hull collider
    this.colliders.push(this.box(this.invisMat, 14, 2.9, 44, x, -1.45, z, 0));

    // walkable main deck (top at y = 3.5, width 14, z ± 21 — preserves all spawn/boss heights)
    const deck = this.mesh(deckMat, new RoundedBoxGeometry(14, 0.4, 42, 4, 0.08), x, 3.3, z, 0);
    deck.castShadow = true;
    deck.receiveShadow = true;
    this.scene.add(deck);
    const plankMat = materialFor(0x362f26, { roughness: 0.94 });
    for (let px = -6; px <= 6; px += 1.4) {
      this.scene.add(part(new THREE.BoxGeometry(0.05, 0.02, 40.4), plankMat, [x + px, 3.51, z], [0, 0, 0], false));
    }
    this.colliders.push(this.box(this.invisMat, 14, 0.4, 42, x, 3.1, z, 0));
    this.aabbs.push(new THREE.Box3(new THREE.Vector3(x - 7, 3.1, z - 21), new THREE.Vector3(x + 7, 3.5, z + 21)));

    // aft superstructure + bridge + funnel + radar mast
    const sup = this.mesh(superMat, new RoundedBoxGeometry(7.2, 4.5, 6.2, 4, 0.3), x, 3.5 + 2.25, z + 10, 0);
    sup.castShadow = true;
    sup.receiveShadow = true;
    this.scene.add(sup);
    const supCol = this.box(this.invisMat, 7.2, 4.5, 6.2, x, 3.5, z + 10, 0);
    this.colliders.push(supCol);
    this.aabbs.push(new THREE.Box3().setFromObject(supCol));

    this.scene.add(part(bevelledBox(7.28, 1.1, 6.28, 0.02), glass, [x, 5.4, z + 10], [0, 0, 0], false));
    const bridge = this.mesh(superMat, new RoundedBoxGeometry(8.2, 2.2, 5.2, 4, 0.2), x, 8 + 1.1, z + 10, 0);
    bridge.castShadow = true;
    this.scene.add(bridge);
    this.scene.add(part(bevelledBox(8.28, 1.0, 4.6, 0.02), glass, [x, 9.25, z + 9.9], [0, 0, 0], false));
    const bridgeCol = this.box(this.invisMat, 7.4, 2.2, 5, x, 8, z + 10, 0);
    this.colliders.push(bridgeCol);
    this.aabbs.push(new THREE.Box3().setFromObject(bridgeCol));

    // ship funnel + radar mast behind bridge
    this.scene.add(part(new THREE.CylinderGeometry(0.95, 1.25, 3.0, 16), materialFor(0x8a2420, { roughness: 0.6, metalness: 0.35 }), [x, 11.4, z + 11.8]));
    this.scene.add(part(new THREE.CylinderGeometry(0.98, 0.98, 0.5, 16), railMat, [x, 12.9, z + 11.8]));
    this.scene.add(part(new THREE.CylinderGeometry(0.08, 0.14, 3.4, 10), railMat, [x, 11.9, z + 9.2]));
    this.scene.add(part(bevelledBox(2.2, 0.14, 0.2, 0.02), superMat, [x, 13.3, z + 9.2]));

    // deck containers (side edges; centre lane kept open for boss fight)
    for (const [cx, cz] of [[-4, -6], [-4, -12], [4, -6], [4, -12]] as const) {
      for (let row = 0; row < 2; row++) {
        this.container(x + cx, 3.5 + row * 2.7, z + cz, (cx + cz) % 2 ? 0.06 : -0.06, [0x8a6a3a, 0x3a6a8a, 0x5a7a3a][(cx + cz + row) % 3]);
      }
    }

    // cargo hatches with raised coaming rims
    const hatchMat = materialFor(0x26282e, { roughness: 0.72, metalness: 0.45 });
    for (const [hx, hz] of [[-4, -15], [4, -15]] as const) {
      this.scene.add(part(bevelledBox(2.8, 0.32, 2.0, 0.04), hatchMat, [x + hx, 3.66, z + hz]));
    }

    // navigation lights mounted cleanly on bridge wingtips + masthead
    const navRed = this.mesh(new THREE.MeshStandardMaterial({ color: 0xff2020, emissive: 0xff0000, emissiveIntensity: 2.5 }), new THREE.SphereGeometry(0.14, 10, 8), x - 4.2, 9.2, z + 9.5);
    const navGreen = this.mesh(new THREE.MeshStandardMaterial({ color: 0x20ff40, emissive: 0x00ff30, emissiveIntensity: 2.5 }), new THREE.SphereGeometry(0.14, 10, 8), x + 4.2, 9.2, z + 9.5);
    const navWhite = this.mesh(new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffffee, emissiveIntensity: 2.5 }), new THREE.SphereGeometry(0.12, 10, 8), x, 13.7, z + 9.2);
    this.scene.add(navRed, navGreen, navWhite);
    this.beacon(navRed, 1.6, 0);
    this.beacon(navGreen, 1.6, 2);
    this.beacon(navWhite, 1.2, 4);

    // fluttering ensign flag
    const flagMat = new THREE.MeshStandardMaterial({ color: 0xc9a84a, roughness: 0.8, side: THREE.DoubleSide });
    this.scene.add(part(new THREE.CylinderGeometry(0.04, 0.04, 2.2, 8), railMat, [x + 2.8, 11.3, z + 10]));
    const flag = this.mesh(flagMat, new THREE.PlaneGeometry(0.95, 0.55), x + 3.28, 12.1, z + 10);
    this.scene.add(flag);
    this.flagMesh = flag;
    let flagPhase = 0;
    this.extras.push({
      update: (dt: number) => {
        flagPhase += dt * 5;
        flag.rotation.z = Math.sin(flagPhase) * 0.35;
      },
    });

    // continuous 2-rail safety railings around port & starboard deck edges
    for (const sx of [-6.85, 6.85]) {
      for (const ry of [4.05, 4.55]) {
        this.scene.add(part(new THREE.CylinderGeometry(0.028, 0.028, 41, 8), railMat, [x + sx, ry, z], [Math.PI / 2, 0, 0]));
      }
      for (let i = -20; i <= 20; i += 2.5) {
        this.scene.add(part(new THREE.CylinderGeometry(0.04, 0.04, 1.1, 8), railMat, [x + sx, 4.05, z + i]));
      }
    }
    return { x, z, deckY: 3.5 };
  }

  water(size: number) {
    const c = document.createElement("canvas");
    c.width = c.height = 512;
    const g = c.getContext("2d")!;
    g.fillStyle = "#0b1a26";
    g.fillRect(0, 0, 512, 512);
    const rng = mulberry32(7);
    for (let i = 0; i < 260; i++) {
      g.strokeStyle = `rgba(120,160,190,${0.04 + rng() * 0.09})`;
      g.lineWidth = 1 + rng() * 2.5;
      const y = rng() * 512;
      g.beginPath();
      g.moveTo(0, y);
      for (let x = 0; x <= 512; x += 32) g.lineTo(x, y + Math.sin((x + i * 30) / 60) * 6);
      g.stroke();
    }
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(size / 20, size / 20);
    t.colorSpace = THREE.SRGBColorSpace;
    const m = this.mesh(
      new THREE.MeshStandardMaterial({ map: t, transparent: true, opacity: 0.92, roughness: 0.25, metalness: 0.55, envMapIntensity: 1.2 }),
      new THREE.PlaneGeometry(size, size),
      0,
      -0.06,
      0,
    );
    m.rotation.x = -Math.PI / 2;
    m.receiveShadow = false;
    this.scene.add(m);
    return t;
  }

  helipad(x: number, z: number) {
    const c = document.createElement("canvas");
    c.width = c.height = 256;
    const g = c.getContext("2d")!;
    g.fillStyle = "rgba(0,0,0,0)";
    g.fillRect(0, 0, 256, 256);
    g.strokeStyle = "rgba(240,240,240,0.9)";
    g.lineWidth = 14;
    g.beginPath();
    g.arc(128, 128, 110, 0, Math.PI * 2);
    g.stroke();
    g.fillStyle = "rgba(240,240,240,0.95)";
    g.font = "bold 150px sans-serif";
    g.textAlign = "center";
    g.fillText("H", 128, 185);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    const m = this.mesh(new THREE.MeshStandardMaterial({ map: t, transparent: true, roughness: 0.8 }), new THREE.PlaneGeometry(22, 22), x, 0.04, z);
    m.rotation.x = -Math.PI / 2;
    m.receiveShadow = true;
    this.scene.add(m);
    for (const [lx, lz] of [[-10, -10], [10, -10], [-10, 10], [10, 10]] as const) {
      const light = this.mesh(new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff2c0, emissiveIntensity: 2.5 }), new THREE.SphereGeometry(0.22, 8, 6), x + lx, 0.12, z + lz);
      this.scene.add(light);
      this.beacon(light, 1.6, (lx + lz) * 0.3);
    }
  }

  relayTower(x: number, z: number, h: number) {
    const steel = materialFor(0x9aa0a8, { roughness: 0.48, metalness: 0.82 });
    const braceMat = materialFor(0x7a8088, { roughness: 0.58, metalness: 0.78 });
    const pole = this.mesh(steel, new THREE.CylinderGeometry(0.12, 0.22, h, 20, 4), x, h / 2, z);
    pole.castShadow = true;
    this.scene.add(pole);
    this.colliders.push(pole);
    for (let i = 1; i <= 6; i++) {
      const yy = (i / 6) * h;
      const r = 0.35 + (i / 6) * 0.5;
      const ring = this.mesh(steel, new THREE.TorusGeometry(r, 0.04, 8, 24), x, yy, z);
      ring.rotation.x = Math.PI / 2;
      this.scene.add(ring);
      for (let a = 0; a < 3; a++) {
        const ang = a * ((Math.PI * 2) / 3);
        const sx = Math.cos(ang) * r;
        const sz = Math.sin(ang) * r;
        this.scene.add(part(new THREE.CylinderGeometry(0.03, 0.03, i === 6 ? h - yy : 1.6, 8), braceMat, [x + sx, yy + (i === 6 ? (h - yy) / 2 : 0.8), z + sz]));
      }
    }
    const dish = this.mesh(steel, new THREE.SphereGeometry(1.1, 28, 18, 0, Math.PI * 2, 0, Math.PI / 2.4), x, h + 0.3, z);
    dish.rotation.x = -Math.PI / 2.4;
    dish.castShadow = true;
    this.scene.add(dish);
    for (let a = 0; a < 3; a++) {
      const ang = a * ((Math.PI * 2) / 3) + Math.PI / 6;
      const strut = this.mesh(steel, new THREE.CylinderGeometry(0.03, 0.03, 1.4, 8), x + Math.cos(ang) * 0.4, h + 0.5, z + Math.sin(ang) * 0.4);
      strut.rotation.z = Math.cos(ang) * 0.7;
      strut.rotation.x = -Math.sin(ang) * 0.7;
      this.scene.add(strut);
    }
    this.scene.add(part(new THREE.CylinderGeometry(0.08, 0.12, 0.4, 14), steel, [x, h + 0.9, z]));
    const beacon = this.mesh(new THREE.MeshStandardMaterial({ color: 0xff2020, emissive: 0xff0000, emissiveIntensity: 4 }), new THREE.SphereGeometry(0.16, 14, 10), x, h + 1.6, z);
    this.scene.add(beacon);
    this.beacon(beacon, 2, this.rng() * 6);
  }

  houseVillage(x: number, z: number, w: number, d: number, h: number, ry = 0) {
    const stone = facade({
      base: "#8a8074",
      glass: "#2a2620",
      frame: "#5a5048",
      glow: "#ffcf7a",
      bayW: 1.6,
      floorH: 3,
      cols: 3,
      rows: 2,
      rng: this.rng,
    });
    const roofMat = materialFor(0x8a3b2a, { roughness: 0.88, family: "roof-tile", seed: 12 });
    this.building({ x, z, w, d, h, facade: stone, roof: "tile", roofMat, emissive: 0.35, parapet: false, details: false, ry });
    this.windowTrim({
      x, z, w, d, h, bayW: 1.6, floorH: 3, rows: 2, cols: 3, ry,
      frameMat: materialFor(0x5a5048, { roughness: 0.88 }),
      shutterMat: materialFor(0x4a5a32, { roughness: 0.88 }),
    });
    // wooden door + stone step flush on local +z face
    const doorGrp = new THREE.Group();
    doorGrp.position.set(x, 0, z);
    doorGrp.rotation.y = ry;
    const dObj = doorWithStep({ width: 1.1, height: 2.05, wallT: 0.32, openAngle: 0, frameColor: "#5a5048", doorColor: "#4a3320" });
    dObj.position.set(0, 0, d / 2 - 0.14);
    doorGrp.add(dObj);
    this.scene.add(doorGrp);
  }

  church(x: number, z: number) {
    const stoneMat = materialFor(0xd8d2c4, { roughness: 0.92, family: "plaster", seed: 44 });
    const frameStone = materialFor(0xb8b0a0, { roughness: 0.9, family: "plaster", seed: 45 });
    const roofMat = materialFor(0x4a4d54, { roughness: 0.78, family: "roof-tile", seed: 46 });
    const innerStone = materialFor(0x6e695f, { roughness: 0.94, family: "stone", seed: 47 });
    const oakMat = materialFor(0x4f3822, { roughness: 0.85, family: "wood", seed: 48 });

    // Enterable hollow limestone nave (9 x 13 x 6m) with South main door, North vestry door, East sanctuary door
    const nw = 9;
    const nd = 13;
    const nh = 6;
    const wt = 0.36;
    const addNaveWall = (bw: number, bh: number, bd: number, lx: number, ly: number, lz: number, mat: THREE.Material = stoneMat) => {
      if (bw <= 0.02 || bh <= 0.02 || bd <= 0.02) return;
      const m = this.mesh(mat, bevelledBox(bw, bh, bd, 0.03), x + lx, ly, z + lz);
      m.castShadow = true;
      m.receiveShadow = true;
      this.solid(m, "concrete");
    };
    // Walkable flagstone nave floor
    const floor = this.mesh(innerStone, new THREE.BoxGeometry(nw - wt, 0.12, nd - wt), x, 0.06, z);
    floor.receiveShadow = true;
    this.solid(floor, "concrete");

    // South wall (main front entrance doorW = 2.2, doorH = 2.7)
    const sDoorW = 2.2;
    const sDoorH = 2.7;
    const sJamb = (nw - sDoorW) / 2;
    for (const sx of [-1, 1]) addNaveWall(sJamb, nh, wt, sx * (sDoorW / 2 + sJamb / 2), nh / 2, nd / 2 - wt / 2);
    addNaveWall(sDoorW, nh - sDoorH, wt, 0, sDoorH + (nh - sDoorH) / 2, nd / 2 - wt / 2);

    // North wall (rear vestry doorway doorW = 1.9, doorH = 2.5)
    const nDoorW = 1.9;
    const nDoorH = 2.5;
    const nJamb = (nw - nDoorW) / 2;
    for (const sx of [-1, 1]) addNaveWall(nJamb, nh, wt, sx * (nDoorW / 2 + nJamb / 2), nh / 2, -nd / 2 + wt / 2);
    addNaveWall(nDoorW, nh - nDoorH, wt, 0, nDoorH + (nh - nDoorH) / 2, -nd / 2 + wt / 2);

    // West wall (pierced shooting window at center z=0, sill=1.2m..2.6m)
    const wSpan = nd - 2 * wt;
    const winW = 2.4;
    const wSide = (wSpan - winW) / 2;
    for (const sz of [-1, 1]) addNaveWall(wt, nh, wSide, -nw / 2 + wt / 2, nh / 2, sz * (winW / 2 + wSide / 2));
    addNaveWall(wt, 1.2, winW, -nw / 2 + wt / 2, 0.6, 0);
    addNaveWall(wt, nh - 2.6, winW, -nw / 2 + wt / 2, 2.6 + (nh - 2.6) / 2, 0);

    // East wall (pierced sanctuary door at local z = -2.0 -> world z = -20.0 facing Old Petar!)
    // Local Z range: [-6.14 .. +6.14], doorway centered at local z = -2.0, width = 2.0 -> [-3.0 .. -1.0]
    const eNorthD = 3.14; // -6.14 .. -3.0
    const eSouthD = 7.14; // -1.0 .. +6.14
    addNaveWall(wt, nh, eNorthD, nw / 2 - wt / 2, nh / 2, -6.14 + eNorthD / 2);
    addNaveWall(wt, nh, eSouthD, nw / 2 - wt / 2, nh / 2, -1.0 + eSouthD / 2);
    addNaveWall(wt, nh - 2.5, 2.0, nw / 2 - wt / 2, 2.5 + (nh - 2.5) / 2, -2.0);

    // Interior pews (2 rows on West, 2 rows on East — center aisle clear!) + warm overhead chandelier
    for (const pz of [-2.4, 0.2, 2.8]) {
      for (const px of [-2.7, 2.7]) {
        this.solid(this.box(oakMat, 2.0, 0.85, 0.55, x + px, 0.12, z + pz), "wood");
      }
    }
    // Side stone altar table (clear of North vestry doorway)
    this.solid(this.box(frameStone, 1.4, 1.0, 0.7, x - 2.6, 0.12, z - 4.8), "concrete");
    const ironMat = materialFor(0x28282c, { roughness: 0.5, metalness: 0.85 });
    this.scene.add(part(new THREE.CylinderGeometry(0.03, 0.03, 1.4, 8), ironMat, [x, 5.1, z], [0, 0, 0], false));
    this.scene.add(part(new THREE.TorusGeometry(0.75, 0.04, 8, 20), ironMat, [x, 4.4, z], [Math.PI / 2, 0, 0], false));
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * Math.PI * 2;
      this.scene.add(part(new THREE.SphereGeometry(0.09, 8, 6), new THREE.MeshStandardMaterial({ color: 0xffe49c, emissive: 0xffc85a, emissiveIntensity: 2.0 }), [x + Math.cos(a) * 0.75, 4.5, z + Math.sin(a) * 0.75], [0, 0, 0], false));
    }

    // nave stone plinth + side buttresses
    for (const sx of [-1, 1]) {
      for (const zz of [-4, 0, 4]) {
        this.scene.add(part(bevelledBox(0.65, 4.8, 0.9, 0.06), frameStone, [x + sx * 4.7, 2.4, z + zz]));
      }
    }
    // gable slate roof on nave
    this.roof(x, z, 9.2, 13.2, 6, "gable", roofMat);

    // bell tower (east side): solid base (0..9.8) + open 4-pier belfry (9.8..13.2) so bronze bell is clearly visible!
    const tx = x + 6;
    const tz = z + 4;
    this.colliderBox(3.4, 13.2, 3.4, tx, 0, tz, 0, "concrete");
    this.scene.add(part(bevelledBox(3.4, 9.8, 3.4, 0.08), stoneMat, [tx, 4.9, tz]));
    this.scene.add(part(bevelledBox(3.7, 0.55, 3.7, 0.04), frameStone, [tx, 0.275, tz]));
    // stringer cornice around tower at belfry sill
    this.scene.add(part(bevelledBox(3.7, 0.28, 3.7, 0.03), frameStone, [tx, 9.8, tz]));
    // 4 corner stone piers forming open belfry
    for (const [px, pz] of [[-1.3, -1.3], [1.3, -1.3], [-1.3, 1.3], [1.3, 1.3]]) {
      this.scene.add(part(bevelledBox(0.75, 3.3, 0.75, 0.05), stoneMat, [tx + px, 11.45, tz + pz]));
    }
    // belfry top entablature
    this.scene.add(part(bevelledBox(3.65, 0.45, 3.65, 0.04), frameStone, [tx, 13.2, tz]));
    // hanging bronze bell + oak headstock yoke inside the open belfry
    const bellMat = materialFor(0xc89e3c, { roughness: 0.35, metalness: 0.85 });
    this.scene.add(part(bevelledBox(2.4, 0.22, 0.24, 0.02), materialFor(0x4a3420, { roughness: 0.9 }), [tx, 12.35, tz]));
    this.scene.add(part(new THREE.CylinderGeometry(0.42, 0.72, 1.05, 24), bellMat, [tx, 11.55, tz]));
    this.scene.add(part(new THREE.SphereGeometry(0.14, 12, 10), bellMat, [tx, 10.95, tz]));

    // octagonal slate spire + brass finial + wrought-iron cross
    const spireRoof = this.mesh(roofMat, new THREE.ConeGeometry(2.75, 3.2, 8, 1), tx, 15.0, tz);
    spireRoof.rotation.y = Math.PI / 8;
    spireRoof.castShadow = true;
    this.scene.add(spireRoof);
    this.scene.add(part(new THREE.SphereGeometry(0.18, 14, 10), bellMat, [tx, 16.65, tz]));
    const crossMat = materialFor(0x2a2622, { roughness: 0.7, metalness: 0.75 });
    this.scene.add(part(new THREE.BoxGeometry(0.14, 1.25, 0.14), crossMat, [tx, 17.4, tz]));
    this.scene.add(part(new THREE.BoxGeometry(0.75, 0.14, 0.14), crossMat, [tx, 17.68, tz]));

    // open arched oak double doors on front entrance + semicircular stone arch + east sanctuary frame
    const doorObj = doorWithStep({ width: sDoorW, height: sDoorH, wallT: wt, openAngle: -1.35, frameColor: "#b8b0a0", doorColor: "#3a2a1a" });
    doorObj.position.set(x, 0, z + nd / 2 - wt / 2);
    this.scene.add(doorObj);
    const eastDoorObj = doorWithStep({ width: 2.0, height: 2.5, wallT: wt, openAngle: -1.3, frameColor: "#b8b0a0", doorColor: "#3a2a1a" });
    eastDoorObj.position.set(x + nw / 2 - wt / 2, 0, z - 2.0);
    eastDoorObj.rotation.y = Math.PI / 2;
    this.scene.add(eastDoorObj);
    const arch = this.mesh(frameStone, new THREE.TorusGeometry(1.15, 0.13, 10, 24, Math.PI), x, sDoorH + 0.05, z + nd / 2 + 0.05);
    this.scene.add(arch);

    // recessed Gothic/stone windows on tower faces
    this.windowTrim({ x: tx, z: tz, w: 3.4, d: 3.4, h: 9.2, bayW: 1.8, floorH: 3.2, rows: 2, cols: 1, ry: 0, frameMat: frameStone, shutterMat: null });
  }

  well(x: number, z: number) {
    const w = craftedWell(1.0);
    w.position.set(x, 0, z);
    this.scene.add(w);
    const col = this.mesh(this.invisMat, new THREE.CylinderGeometry(1.15, 1.15, 1.1, 14), x, 0.55, z);
    col.userData.kind = "concrete";
    this.scene.add(col);
    this.colliders.push(col);
    col.updateWorldMatrix(true, false);
    this.aabbs.push(new THREE.Box3().setFromObject(col));
  }

  stall(x: number, z: number, ry = 0) {
    const st = craftedStall(Math.abs(Math.round(x * 7 + z * 11)) + 1);
    st.position.set(x, 0, z);
    st.rotation.y = ry;
    this.scene.add(st);
    this.colliderBox(2.8, 1.0, 1.9, x, 0, z, ry, "wood");
  }

  /* ================= environment polish (visual only — never collides) ================= */

  /** texture cache so repeated decals share one canvas texture */
  polishTex: Record<string, THREE.Texture> = {};
  pTex(key: string, make: () => THREE.Texture): THREE.Texture {
    let t = this.polishTex[key];
    if (!t) {
      t = make();
      this.polishTex[key] = t;
    }
    return t;
  }

  /** add an object that never participates in collision */
  decor(o: THREE.Object3D, cast = true, receive = true) {
    o.castShadow = cast;
    o.receiveShadow = receive;
    this.scene.add(o);
    return o;
  }

  /** flat ground decal: transparent texture plane, z-fighting offset, no collision */
  decal(tex: THREE.Texture, w: number, h: number, x: number, y: number, z: number, ry = 0, roughness = 0.95, metalness = 0) {
    const mat = new THREE.MeshStandardMaterial({
      map: tex,
      transparent: true,
      roughness,
      metalness,
      polygonOffset: true,
      polygonOffsetFactor: -4,
      polygonOffsetUnits: -4,
      depthWrite: false,
    });
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
    m.rotation.set(-Math.PI / 2, ry, 0, "YXZ");
    m.position.set(x, y, z);
    m.receiveShadow = true;
    this.scene.add(m);
    return m;
  }

  /** dark organic ground stain (oil/dirt/mud) */
  groundStain(x: number, z: number, r: number, key = "stain") {
    const t = this.pTex(key, () => stainTex(256, this.rng));
    this.decal(t, r * 2, r * 2, x, 0.012, z, this.rng() * Math.PI);
  }

  /** puddle on paved/ground surfaces (wet glossy specular reflection) */
  puddle(x: number, z: number, rx: number, rz: number) {
    const t = this.pTex("puddle", () => puddleTex(256, this.rng));
    this.decal(t, rx * 2, rz * 2, x, 0.013, z, this.rng() * Math.PI, 0.08, 0.55);
  }

  /** asphalt/concrete crack patch */
  cracks(x: number, z: number, s: number) {
    const t = this.pTex("crack", () => crackTex(256, this.rng));
    this.decal(t, s, s, x, 0.012, z, this.rng() * Math.PI);
  }

  /** vertical grime/rust streak decal on a wall (plane faces +Z by default) */
  wallStreak(x: number, y: number, z: number, w: number, h: number, ry = 0, rust = false) {
    const t = this.pTex(rust ? "rust" : "grime", () => streakTex(256, this.rng, rust));
    const mat = new THREE.MeshStandardMaterial({
      map: t,
      transparent: true,
      roughness: 0.95,
      metalness: 0,
      polygonOffset: true,
      polygonOffsetFactor: -4,
      polygonOffsetUnits: -4,
      depthWrite: false,
    });
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
    m.position.set(x, y, z);
    m.rotation.set(0, ry, 0);
    this.scene.add(m);
    return m;
  }

  /** sculpted stone cluster */
  rock(x: number, z: number, s = 1) {
    if (this.inClearZone(x, z, 1.0)) return;
    const rc = craftedRockCluster(s * 0.72, Math.abs(Math.round(x * 17 + z * 29)) + 1);
    rc.position.set(x, 0, z);
    this.scene.add(rc);
  }

  /** pile of rubble chunks */
  rubble(x: number, z: number, n = 5) {
    if (this.inClearZone(x, z, 1.0)) return;
    const mat = materialFor(0x6a6660, { roughness: 0.96, family: "stone", seed: 15 });
    for (let i = 0; i < n; i++) {
      const s = 0.14 + this.rng() * 0.24;
      const m = this.mesh(mat, bevelledBox(s, s * 0.75, s, 0.02), x + (this.rng() - 0.5) * 1.2, s * 0.35, z + (this.rng() - 0.5) * 1.2, this.rng() * 3);
      m.rotation.x = this.rng() * 0.5;
      m.rotation.z = this.rng() * 0.5;
      this.decor(m);
    }
  }

  /** traffic cone with white band + base */
  trafficCone(x: number, z: number, ry = 0) {
    const orange = materialFor(0xe06a1c, { roughness: 0.72 });
    const white = materialFor(0xf0ece0, { roughness: 0.78 });
    const dark = materialFor(0x1a1a1a, { roughness: 0.9 });
    const grp = new THREE.Group();
    grp.position.set(x, 0, z);
    grp.rotation.y = ry;
    grp.add(part(new THREE.ConeGeometry(0.18, 0.72, 16), orange, [0, 0.38, 0]));
    grp.add(part(new THREE.CylinderGeometry(0.12, 0.14, 0.12, 16), white, [0, 0.32, 0]));
    grp.add(part(bevelledBox(0.48, 0.05, 0.48, 0.015), dark, [0, 0.025, 0]));
    this.scene.add(grp);
  }

  /** post-mounted sign board */
  roadSign(x: number, z: number, ry = 0, text = "DANGER", bg = "#d8a01c", fg = "#1a1a1a") {
    const steel = materialFor(0x2a2d30, { roughness: 0.55, metalness: 0.8 });
    const grp = new THREE.Group();
    grp.position.set(x, 0, z);
    grp.rotation.y = ry;
    grp.add(part(new THREE.CylinderGeometry(0.045, 0.055, 2.2, 12), steel, [0, 1.1, 0]));
    grp.add(part(bevelledBox(1.18, 0.62, 0.06, 0.015), steel, [0, 1.88, 0.03]));
    const face = new THREE.Mesh(
      new THREE.PlaneGeometry(1.1, 0.55),
      new THREE.MeshStandardMaterial({ map: signTex(text, bg, fg, this.rng), roughness: 0.78 })
    );
    face.position.set(0, 1.88, 0.065);
    grp.add(face);
    this.scene.add(grp);
  }

  /** rooftop billboard: twin posts + framed ad panel */
  billboard(x: number, z: number, y: number, ry = 0) {
    const steel = materialFor(0x2a2d30, { roughness: 0.55, metalness: 0.8 });
    const grp = new THREE.Group();
    grp.position.set(x, y, z);
    grp.rotation.y = ry;
    for (const sx of [-1.4, 1.4]) {
      grp.add(part(new THREE.CylinderGeometry(0.08, 0.1, 4.6, 12), steel, [sx, 2.3, 0]));
    }
    grp.add(part(bevelledBox(4.56, 2.36, 0.12, 0.03), steel, [0, 4.5, 0.04]));
    const face = new THREE.Mesh(
      new THREE.PlaneGeometry(4.4, 2.2),
      new THREE.MeshStandardMaterial({ map: this.pTex("ad", () => adTex(this.rng)), roughness: 0.78 })
    );
    face.position.set(0, 4.5, 0.11);
    grp.add(face);
    this.scene.add(grp);
  }

  /** crossed grass blades tuft */
  grassTuft(x: number, z: number, n = 3) {
    if (this.inClearZone(x, z, 1.5)) return;
    const mat = new THREE.MeshStandardMaterial({ color: 0x3d5a2a, roughness: 0.95, side: THREE.DoubleSide });
    for (let i = 0; i < n; i++) {
      const blade = this.mesh(mat, new THREE.PlaneGeometry(0.12, 0.35), x + (this.rng() - 0.5) * 0.4, 0.17, z + (this.rng() - 0.5) * 0.4, this.rng() * 3);
      blade.rotation.x = -0.2 + this.rng() * 0.4;
      this.decor(blade, false);
    }
  }

  /** small wildflower patch */
  flowers(x: number, z: number, n = 5) {
    if (this.inClearZone(x, z, 1.5)) return;
    const cols = [0xc8403a, 0xe8c83a, 0xf0f0f0, 0xd05a8a, 0x8a6ad8];
    for (let i = 0; i < n; i++) {
      const m = this.mesh(new THREE.MeshStandardMaterial({ color: cols[Math.floor(this.rng() * cols.length)], roughness: 0.8 }), new THREE.SphereGeometry(0.06, 8, 6), x + (this.rng() - 0.5) * 0.8, 0.1, z + (this.rng() - 0.5) * 0.8);
      this.decor(m, false);
    }
  }

  /** small dirt mound */
  dirtMound(x: number, z: number, r = 1) {
    if (this.inClearZone(x, z, 1.5)) return;
    const mat = new THREE.MeshStandardMaterial({ color: 0x6a5438, roughness: 1, flatShading: true });
    const m = this.mesh(mat, new THREE.SphereGeometry(r, 12, 10), x, r * 0.25, z);
    m.scale.y = 0.45;
    this.decor(m);
  }

  makeAcUnitGroup(ry = 0) {
    const body = materialFor(0xb8bcc0, { roughness: 0.65, metalness: 0.42 });
    const dark = materialFor(0x2a2d30, { roughness: 0.68, metalness: 0.62 });
    const grp = new THREE.Group();
    grp.rotation.y = ry;
    grp.add(part(new RoundedBoxGeometry(1.2, 0.8, 0.9, 3, 0.08), body, [0, 0.4, 0]));
    for (let i = 0; i < 4; i++) {
      grp.add(part(new THREE.BoxGeometry(0.95, 0.05, 0.04), dark, [0, 0.18 + i * 0.14, 0.455], [0, 0, 0], false));
    }
    grp.add(part(new THREE.TorusGeometry(0.26, 0.035, 8, 18), dark, [0, 0.81, 0], [Math.PI / 2, 0, 0], false));
    return grp;
  }

  /** rooftop AC unit: rounded body + louver + top fan */
  acUnit(x: number, z: number, y: number, ry = 0) {
    const g = this.makeAcUnitGroup(ry);
    g.position.set(x, y, z);
    this.scene.add(g);
  }

  /** rooftop antenna array: masts + crossbars + small dish */
  antennaArray(x: number, z: number, y: number, ry = 0) {
    const steel = materialFor(0x8a9098, { roughness: 0.48, metalness: 0.84 });
    const grp = new THREE.Group();
    grp.position.set(x, y, z);
    grp.rotation.y = ry;
    for (let i = 0; i < 3; i++) {
      const h = 1.6 + i * 0.5;
      const dx = (i - 1) * 0.7;
      grp.add(part(new THREE.CylinderGeometry(0.03, 0.04, h, 8), steel, [dx, h / 2, 0]));
      for (let k = 0; k < 2; k++) {
        grp.add(part(new THREE.CylinderGeometry(0.02, 0.02, 0.5, 6), steel, [dx, h * (0.4 + k * 0.35), 0], [0, 0, Math.PI / 2], false));
      }
    }
    grp.add(part(new THREE.SphereGeometry(0.4, 18, 12, 0, Math.PI * 2, 0, Math.PI / 2.6), steel, [0, 2.7, 0], [-Math.PI / 2.6, 0, 0]));
    this.scene.add(grp);
  }

  /** sagging wire strand between two points */
  wireStrand(x1: number, z1: number, x2: number, z2: number, y: number, sag = 0.6) {
    const pts: THREE.Vector3[] = [];
    const n = 10;
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      pts.push(new THREE.Vector3(x1 + (x2 - x1) * t, y - sag * Math.sin(Math.PI * t), z1 + (z2 - z1) * t));
    }
    const curve = new THREE.CatmullRomCurve3(pts);
    const m = this.mesh(new THREE.MeshStandardMaterial({ color: 0x2a2a2a, roughness: 0.6, metalness: 0.85 }), new THREE.TubeGeometry(curve, 24, 0.014, 6), 0, 0, 0);
    this.decor(m, false);
  }

  /** dock fender: hanging rubber cylinder at the waterline edge */
  fender(x: number, z: number, ry = 0) {
    const rubber = new THREE.MeshStandardMaterial({ color: 0x1a1a1e, roughness: 0.95 });
    const c = this.mesh(rubber, new THREE.CylinderGeometry(0.14, 0.14, 1.4, 14), x, 1.2, z, ry + Math.PI / 2);
    this.decor(c);
    const chain = new THREE.MeshStandardMaterial({ color: 0x4a4a4e, roughness: 0.6, metalness: 0.8 });
    for (const sx of [-1, 1]) {
      const ch = this.mesh(chain, new THREE.CylinderGeometry(0.02, 0.02, 0.5, 6), x + sx * 0.5, 0.85, z, ry);
      this.decor(ch, false);
    }
  }

  /** drifting dust motes in a box volume */
  dustMotes(spreadX: number, spreadZ: number, yMax: number, count: number, color = 0xd8c8a0, speed = 0.25) {
    const pos = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      pos[i * 3] = (this.rng() - 0.5) * spreadX;
      pos[i * 3 + 1] = 1 + this.rng() * yMax;
      pos[i * 3 + 2] = (this.rng() - 0.5) * spreadZ;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    const points = new THREE.Points(geo, new THREE.PointsMaterial({ color, size: 0.05, transparent: true, opacity: 0.35, depthWrite: false }));
    this.decor(points, false, false);
    this.extras.push({
      update: (dt: number) => {
        const p = points.geometry.attributes.position as THREE.BufferAttribute;
        for (let i = 0; i < count; i++) {
          p.array[i * 3] += Math.sin(i + p.array[i * 3 + 1] * 0.7) * speed * dt;
          p.array[i * 3 + 1] -= speed * 0.6 * dt;
          if (p.array[i * 3 + 1] < 0.5) p.array[i * 3 + 1] = yMax;
        }
        p.needsUpdate = true;
      },
    });
  }
}

/* ====================== mission worlds ====================== */

/* ---------------- M0: range (existing world) ---------------- */
function indexLevelSpatial(colliders: THREE.Object3D[], aabbs: THREE.Box3[], walkableSurfaces: WalkableSurface[] = []) {
  const spatial = new SpatialAABBGrid(32);
  spatial.insertMany(aabbs);
  const spatialColliders = new SpatialColliderGrid(32);
  const tmpBox = new THREE.Box3();
  const tmpSize = new THREE.Vector3();
  for (const c of colliders) {
    c.updateWorldMatrix(true, false);
    tmpBox.setFromObject(c);
    tmpBox.getSize(tmpSize);
    if (tmpSize.x > 128 || tmpSize.z > 128) spatialColliders.addGlobal(c);
    else spatialColliders.insert(c, tmpBox);
  }
  const heightSystem = new WorldHeightSystem(() => 0, spatial);
  for (const s of walkableSurfaces) heightSystem.addSurface(s);
  return { spatial, spatialColliders, heightSystem };
}

function buildRange(content: THREE.Object3D, main: THREE.Scene, renderer: THREE.WebGLRenderer): LevelResult {
  const w = buildWorld(content, main, renderer);
  const aabbs: THREE.Box3[] = [];
  for (const c of w.colliders) {
    c.updateWorldMatrix(true, false);
    aabbs.push(new THREE.Box3().setFromObject(c));
  }
  const { spatial, spatialColliders, heightSystem } = indexLevelSpatial(w.colliders, aabbs);
  const groundHeightAt = (x: number, z: number, y: number): number => heightSystem.groundHeightAt(x, z, y);
  return { ...w, aabbs, destroyables: [] as THREE.Mesh[], groundHeightAt, spatial, spatialColliders, heightSystem };
}

/* ---------------- M1: Highland Village ---------------- */
function buildVillage(content: THREE.Object3D, main: THREE.Scene, renderer: THREE.WebGLRenderer): LevelResult {
  const K = new Kit(content, 1337);
  K.clearZone(-6.2, 41.0, 4.5);
  K.clearZone(0, 44, 4.5);
  const ambient = setupAmbient(main, renderer, {
    sunElev: 10,
    sunAzim: 62,
    turbidity: 4.2,
    rayleigh: 1.5,
    fogColor: 0xd9b48f,
    fogDensity: 0.0055,
    hemiSky: 0xa6bed4,
    hemiGround: 0x5c4b32,
    hemiIntensity: 0.65,
    sunColor: 0xffd79b,
    sunIntensity: 3.8,
    envIntensity: 0.65,
    exposure: 1.05,
    shadowFar: 100,
  });
  content.add(ambient.sun, ambient.hemi, ambient.skyMesh);
  if (ambient.stars) content.add(ambient.stars);

  // ground: textured valley turf + cobblestone village avenue + church square plaza
  K.ground(400, materialFor(0x4c6836, { roughness: 0.94, family: "grass", seed: 101, repeat: 115 }));
  const roadMat = materialFor(0x6e6558, { roughness: 0.88, family: "stone", seed: 102, repeat: 16 });
  const road = K.mesh(roadMat, new THREE.PlaneGeometry(7.2, 108), 0, 0.02, 10);
  road.rotation.x = -Math.PI / 2;
  road.receiveShadow = true;
  content.add(road);

  // cobblestone church & well plaza
  const cobbleMat = materialFor(0x888175, { roughness: 0.9, family: "stone", seed: 103, repeat: 7 });
  const plaza = K.mesh(cobbleMat, new THREE.PlaneGeometry(24, 18), -2, 0.028, -16);
  plaza.rotation.x = -Math.PI / 2;
  plaza.receiveShadow = true;
  content.add(plaza);

  // road curbstones + side paths to enterable houses
  const curbMat = materialFor(0x7c766c, { roughness: 0.93, family: "stone", seed: 104 });
  for (const sx of [-3.75, 3.75]) {
    for (let z = -6; z <= 46; z += 4.5) {
      content.add(part(bevelledBox(0.32, 0.14, 4.1, 0.02), curbMat, [sx, 0.07, z], [0, 0, 0], false));
    }
  }
  for (const [px, pz, pw, pd] of [[-7.5, 19, 7, 2.2], [-7.5, 39, 7, 2.2], [7.5, 17, 7, 2.2], [7.5, 29, 7, 2.2]] as const) {
    const p = K.mesh(cobbleMat, new THREE.PlaneGeometry(pw, pd), px, 0.022, pz);
    p.rotation.x = -Math.PI / 2;
    p.receiveShadow = true;
    content.add(p);
  }

  // south village entrance stone gate pillars + overhead timber beam & lanterns (frame spawn/extraction)
  const gateStone = materialFor(0x8a8276, { roughness: 0.92, family: "stone", seed: 105 });
  const gateWood = materialFor(0x523b26, { roughness: 0.88, family: "wood", seed: 106 });
  for (const sx of [-4.8, 4.8]) {
    K.solid(K.mesh(gateStone, bevelledBox(1.1, 3.6, 1.1, 0.05), sx, 1.8, 36), "concrete");
    content.add(part(bevelledBox(1.32, 0.25, 1.32, 0.03), gateStone, [sx, 3.7, 36]));
    content.add(part(new THREE.SphereGeometry(0.16, 10, 8), new THREE.MeshStandardMaterial({ color: 0xffe4a0, emissive: 0xffc864, emissiveIntensity: 1.8 }), [sx, 4.02, 36], [0, 0, 0], false));
  }
  content.add(part(bevelledBox(10.8, 0.35, 0.42, 0.03), gateWood, [0, 4.2, 36]));

  // village facade & roof styles
  const villageStone = facade({
    base: "#8a8074",
    glass: "#2a2620",
    frame: "#5a5048",
    glow: "#ffcf7a",
    bayW: 1.6,
    floorH: 3,
    cols: 3,
    rows: 2,
    rng: K.rng,
  });
  const tileRoof = materialFor(0x8a3b2a, { roughness: 0.88, family: "roof-tile", seed: 12 });
  const guardRoofMat = materialFor(0x5a5650, { roughness: 0.9, family: "concrete", seed: 108 });

  // west street houses (connected CS2-style indoor tavern + shop flank route)
  K.houseVillage(-14.5, -2, 7, 8, 4.5, Math.PI / 2);
  K.enterable({ x: -14.5, z: 8, w: 8, d: 8, h: 4.2, facade: villageStone, roof: "tile", roofMat: tileRoof, doors: ["S", "E", "W"], windows: ["N"], partition: "z", emissive: 0.5, ry: Math.PI / 2 });
  K.enterable({ x: -15, z: 19, w: 8, d: 8, h: 4.2, facade: villageStone, roof: "tile", roofMat: tileRoof, doors: ["S", "E", "W"], windows: ["N"], partition: "x", emissive: 0.45, ry: Math.PI / 2 });
  K.houseVillage(-14.5, 29, 7, 8, 4.2, Math.PI / 2);
  K.enterable({ x: -14.5, z: 39, w: 7, d: 8, h: 4.0, facade: villageStone, roof: "tile", roofMat: tileRoof, doors: ["S", "E"], windows: ["W"], emissive: 0.4, ry: Math.PI / 2 });
  K.houseVillage(-13, -27, 7, 7, 3.8, 0.15);

  // east street houses (enterable bakery/storehouse + shop + climbable guardhouse)
  K.houseVillage(14.5, -8, 8, 8, 4.5, -Math.PI / 2);
  K.enterable({ x: 14.5, z: 4, w: 8, d: 8, h: 4.1, facade: villageStone, roof: "tile", roofMat: tileRoof, doors: ["S", "E", "W"], windows: ["N"], partition: "x", emissive: 0.5, ry: -Math.PI / 2 });
  K.enterable({ x: 15, z: 17, w: 8, d: 8, h: 4.2, facade: villageStone, roof: "tile", roofMat: tileRoof, doors: ["S", "E", "W"], windows: ["N"], partition: "z", emissive: 0.45, ry: -Math.PI / 2 });

  // north-east barn connector behind church square
  K.enterable({ x: 13, z: -28, w: 7, d: 6.5, h: 3.8, facade: villageStone, roof: "tile", roofMat: tileRoof, doors: ["S", "W"], windows: ["E"], emissive: 0.4 });

  // climbable flat-roofed Guardhouse (enterable ground floor + accessible 3.0m rooftop terrace!)
  K.enterable({
    x: 15,
    z: 29,
    w: 7,
    d: 7,
    h: 3.0,
    facade: villageStone,
    roof: "flat",
    roofMat: guardRoofMat,
    doors: ["S", "E"],
    windows: ["N"],
    emissive: 0.5,
    ry: -Math.PI / 2,
    walkableRoof: true,
    parapet: false,
  });
  // stone parapet walls on guardhouse rooftop (leaving south-east landing open for the stairs)
  const parapetMat = materialFor(0x746d63, { roughness: 0.9, family: "stone", seed: 109 });
  content.add(part(bevelledBox(7.2, 0.85, 0.25, 0.03), parapetMat, [15, 3.65, 25.55])); // north
  content.add(part(bevelledBox(0.25, 0.85, 7.2, 0.03), parapetMat, [11.55, 3.65, 29])); // west (street side)
  content.add(part(bevelledBox(0.25, 0.85, 7.2, 0.03), parapetMat, [18.45, 3.65, 29])); // east
  content.add(part(bevelledBox(3.4, 0.85, 0.25, 0.03), parapetMat, [13.2, 3.65, 32.45])); // south-west (leaves x=15..18 open)
  // landing bridge + stone stairs ascending +X along south wall onto the guardhouse roof (y = 3.0m)
  const stairStone = materialFor(0x9a9284, { roughness: 0.92, family: "stone", seed: 110 });
  K.stairs({ x: 11.4, z: 33.4, steps: 10, rise: 0.33, run: 0.55, width: 1.5, mat: stairStone });
  const gLand = K.mesh(stairStone, bevelledBox(2.0, 0.28, 2.0, 0.03), 17.65, 3.18, 33.1);
  gLand.castShadow = true;
  gLand.receiveShadow = true;
  content.add(gLand);
  K.colliderBox(2.0, 3.32, 2.0, 17.65, 0, 33.1, 0, "concrete");
  // guardhouse rooftop sandbag cover + crate
  const rBag = K.mesh(materialFor(0x8d8163, { roughness: 0.94, family: "fabric", seed: 18 }), new RoundedBoxGeometry(0.65, 0.32, 1.8, 3, 0.08), 12.2, 3.52, 29);
  content.add(rBag);
  K.crate(materialFor(0x8a6a43, { roughness: 0.82 }), 17.2, 26.8, 0.9, 0.3, 3.36);

  // church + working stone staircase leading up onto a raised Bell-Tower Overlook Terrace!
  K.church(-8, -18);
  // raised colonnade overlook terrace (y = 2.4m) beside the bell tower, open underneath, parapet & sandbags on top
  const terraceX = -1.4;
  const terraceZ = -10.2;
  const terraceTop = K.mesh(stairStone, bevelledBox(4.4, 0.34, 2.8, 0.04), terraceX, 2.23, terraceZ);
  terraceTop.castShadow = true;
  terraceTop.receiveShadow = true;
  content.add(terraceTop);
  K.colliderBox(4.4, 0.34, 2.8, terraceX, 2.06, terraceZ, 0, "concrete");
  for (const [px, pz] of [[-3.3, -11.3], [0.5, -11.3], [-3.3, -9.1], [0.5, -9.1]] as const) {
    content.add(part(bevelledBox(0.42, 2.1, 0.42, 0.03), stairStone, [px, 1.05, pz]));
  }
  // waist-high stone parapet around terrace edges (leaving west x=-3.6 stair entry completely open!)
  content.add(part(bevelledBox(4.4, 0.85, 0.22, 0.03), parapetMat, [terraceX, 2.82, terraceZ + 1.29])); // south
  content.add(part(bevelledBox(4.4, 0.85, 0.22, 0.03), parapetMat, [terraceX, 2.82, terraceZ - 1.29])); // north
  content.add(part(bevelledBox(0.22, 0.85, 2.8, 0.03), parapetMat, [terraceX + 2.09, 2.82, terraceZ])); // east
  // stone staircase climbing +X directly onto the 2.4m Bell-Tower Overlook Terrace
  K.stairs({ x: -8.1, z: terraceZ, steps: 8, rise: 0.3, run: 0.56, width: 1.5, mat: stairStone });
  K.crate(materialFor(0x8a6a43, { roughness: 0.82 }), 0.0, terraceZ - 0.5, 0.75, 0.2, 2.4);

  // Old Petar's sanctuary lectern + open radio-codebook + warm lantern right beside rescue point (-2, -20)
  const shrineWood = materialFor(0x523b24, { roughness: 0.85, family: "wood", seed: 112 });
  content.add(part(bevelledBox(0.85, 0.95, 0.55, 0.02), shrineWood, [-3.15, 0.475, -20.8], [0, 0.45, 0]));
  content.add(part(bevelledBox(0.55, 0.08, 0.4, 0.01), materialFor(0xe8dfc8, { roughness: 0.9 }), [-3.15, 1.0, -20.8], [0.22, 0.45, 0]));
  content.add(part(new THREE.CylinderGeometry(0.06, 0.08, 2.4, 10), materialFor(0x2a2d30, { roughness: 0.6, metalness: 0.8 }), [-3.4, 1.2, -21.4]));
  content.add(part(new THREE.SphereGeometry(0.15, 10, 8), new THREE.MeshStandardMaterial({ color: 0xffe4a0, emissive: 0xffc864, emissiveIntensity: 2.0 }), [-3.4, 2.48, -21.4], [0, 0, 0], false));

  // low stone churchyard perimeter walls with wide open walkway gaps
  K.solid(K.box(parapetMat, 4.5, 0.95, 0.4, -12.5, 0, -8.5), "concrete");
  K.solid(K.box(parapetMat, 4.5, 0.95, 0.4, 5.2, 0, -8.5), "concrete");

  // corner ambush cover: low walls along the road approaches (kept clear of spawn/patrol lanes)
  const lowWall = materialFor(0x9a9288, { roughness: 0.92, family: "stone", seed: 114 });
  K.solid(K.box(lowWall, 4.6, 1.05, 0.4, -2.5, 0, 26, 0.1), "concrete");
  K.solid(K.box(lowWall, 4.6, 1.05, 0.4, 2.5, 0, 26, -0.1), "concrete");
  K.solid(K.box(lowWall, 0.4, 1.05, 5.2, -11.5, 0, 2, 0.15), "concrete");
  // south-west approach cover alcove protecting player insertion at (-6.2, 41.0)
  K.solid(K.box(gateStone, 4.2, 1.48, 0.58, -6.4, 0, 38.6, 0.12), "concrete");
  K.solid(K.box(gateStone, 0.55, 1.35, 3.0, -8.5, 0, 40.3, -0.08), "concrete");
  K.crate(materialFor(0x8a6a43, { roughness: 0.82 }), -7.4, 39.6, 0.85, 0.25);

  // village lanterns & utility poles along the street
  for (const z of [-6, 8, 22, 34]) {
    K.streetlight(-4.2, z, Math.PI / 2);
    K.streetlight(4.2, z, -Math.PI / 2);
  }

  // central props
  K.well(4.5, -14);
  K.stall(5.5, 8, 0.3);
  K.stall(-5.5, 12, -0.2);
  K.haystack(19, -4);
  K.haystack(-19, 2);
  K.haystack(-19, 26);

  // trees inside village & rich perimeter valley treeline
  for (const [tx, tz, sc] of [
    [19, -12, 1.05], [-19, -8, 1.0], [21, 16, 1.1], [-21, 10, 1.0],
    [20, 34, 1.05], [-20, 34, 1.0], [6.5, 28, 0.9], [-6.5, 34, 0.95],
    [26, -20, 1.2], [-26, -22, 1.15],
  ] as const) {
    K.tree(tx, tz, sc);
  }
  for (let i = 0; i < 28; i++) {
    const a = (i / 28) * Math.PI * 2;
    if (Math.abs(Math.sin(a)) < 0.12 && Math.cos(a) > 0) continue;
    const r = 46 + (i % 3) * 8;
    const px = Math.cos(a) * r;
    const pz = Math.sin(a) * r;
    if (Math.abs(px) < 14 && pz > 30) continue;
    K.tree(px, pz, 1.05 + (i % 4) * 0.15);
  }

  K.fence(-18, -2, -23, 6);
  K.fence(19, 8, 23, -2);
  K.fence(-18, 18, -23, 24);
  K.fence(19, 32, 24, 36);

  // cover for gunplay
  const woodMat = materialFor(0x8a6a43, { roughness: 0.82 });
  K.crate(woodMat, -6.5, 16, 1.1, 0.3);
  K.crate(woodMat, 7.2, -10, 1.2, -0.4);
  K.crate(woodMat, 8, 10, 1.0, 0.2);
  K.crate(woodMat, -8, -28, 1.1, 0.5);
  K.barrel(woodMat, 6.2, -13.5, 0x6b4428);
  K.barrel(woodMat, 5.5, -14.2, 0x6b4428);
  K.sandbag(4, 30, 0.2, 4);
  K.sandbag(-4, 30, -0.2, 4);
  K.sandbag(6, -20, 0.1, 4);

  // environment polish: weathering + small detail (visual only)
  for (let i = 0; i < 6; i++) K.groundStain(-2 + (K.rng() - 0.5) * 26, 6 + (K.rng() - 0.5) * 60, 0.6 + K.rng() * 0.8);
  K.puddle(-2, 22, 1.1, 0.8);
  K.puddle(3, -8, 0.9, 0.7);
  K.puddle(-4, 34, 1.0, 0.7);
  for (let i = 0; i < 4; i++) K.cracks(-12 + K.rng() * 24, 8 + K.rng() * 50, 2.4 + K.rng() * 1.6);
  for (let i = 0; i < 8; i++) {
    const rx = -22 + K.rng() * 44;
    const rz = -24 + K.rng() * 58;
    if (Math.abs(rx) > 5.5) K.rock(rx, rz, 0.7 + K.rng() * 0.8);
  }
  K.rubble(-16, 12, 4);
  K.rubble(15, 25, 4);
  K.dirtMound(-10, -18, 1.1);
  K.dirtMound(18, 20, 0.9);
  for (let i = 0; i < 16; i++) {
    const gx = -20 + K.rng() * 40;
    const gz = -26 + K.rng() * 60;
    if (Math.abs(gx) > 5.5) K.grassTuft(gx, gz, 3);
  }
  K.flowers(6, 24, 6);
  K.flowers(-6, 30, 5);
  K.flowers(4, -12, 5);
  K.flowers(-5.5, -8.8, 6);
  K.wireStrand(-4.2, -6, -4.2, 8, 5.1, 0.45);
  K.wireStrand(-4.2, 8, -4.2, 22, 5.1, 0.45);
  K.wireStrand(4.2, -6, 4.2, 8, 5.1, 0.45);
  K.wireStrand(4.2, 8, 4.2, 22, 5.1, 0.45);
  K.wireStrand(-4.2, 8, 4.2, 8, 5.1, 0.55);
  K.dustMotes(90, 110, 14, 90, 0xe8d8b0, 0.2);

  // hills ring: rolling olive-green foothills blending naturally into dawn haze (no tiled stone UVs)
  const hillMatA = new THREE.MeshStandardMaterial({ color: 0x4b5c38, roughness: 0.97, flatShading: true });
  const hillMatB = new THREE.MeshStandardMaterial({ color: 0x3f4e30, roughness: 0.98, flatShading: true });
  for (let i = 0; i < 18; i++) {
    const a = (i / 18) * Math.PI * 2;
    const r = 84 + (i % 3) * 14;
    const h = 12 + K.rng() * 11;
    const rad = h * 1.55;
    const geo = new THREE.IcosahedronGeometry(rad, 2);
    const pos = geo.attributes.position as THREE.BufferAttribute;
    for (let vi = 0; vi < pos.count; vi++) {
      const px = pos.getX(vi);
      const py = pos.getY(vi);
      const pz = pos.getZ(vi);
      const ridge = 1 + Math.sin(px * 0.16 + i) * 0.18 + Math.cos(pz * 0.14 - i) * 0.14;
      pos.setXYZ(vi, px * ridge, py * 0.56, pz * ridge);
    }
    geo.computeVertexNormals();
    const hill = K.mesh(i % 2 === 0 ? hillMatA : hillMatB, geo, Math.cos(a) * r, h * 0.25, Math.sin(a) * r, a + K.rng() * 0.4);
    hill.scale.set(1.4, 1.0, 0.95);
    content.add(hill);
  }

  return finish(K, ambient);
}

/* ---------------- M2: Meridian Tower construction ---------------- */
function buildConstruction(content: THREE.Object3D, main: THREE.Scene, renderer: THREE.WebGLRenderer): LevelResult {
  const K = new Kit(content, 4242);
  K.clearZone(0, 46, 10);
  const ambient = setupAmbient(main, renderer, {
    sunElev: 46,
    sunAzim: 210,
    turbidity: 6.5,
    rayleigh: 0.9,
    fogColor: 0xb4bac0,
    fogDensity: 0.0055,
    hemiSky: 0xcbd2dc,
    hemiGround: 0x625a50,
    hemiIntensity: 0.78,
    sunColor: 0xf8f4ea,
    sunIntensity: 2.9,
    envIntensity: 0.55,
    exposure: 1.02,
    shadowFar: 95,
  });
  content.add(ambient.sun, ambient.hemi, ambient.skyMesh);
  if (ambient.stars) content.add(ambient.stars);

  // site ground (concrete slab + mud patches)
  const gc = noiseCanvas(1024, "#8a847c", [["rgba(0,0,0,0.14)", 9000], ["rgba(255,255,255,0.08)", 4000]], K.rng);
  K.ground(300, new THREE.MeshStandardMaterial({ map: toTex(gc, 40), bumpMap: toTex(gc, 40, false), bumpScale: 0.9, roughness: 0.95 }));
  const mud = K.mesh(new THREE.MeshStandardMaterial({ color: 0x5a4a38, roughness: 1 }), new THREE.PlaneGeometry(20, 14), -14, 0.02, 4);
  mud.rotation.x = -Math.PI / 2;
  mud.receiveShadow = true;
  content.add(mud);
  // expansion joints
  const jointMat = new THREE.MeshStandardMaterial({ color: 0x2a2a2a, roughness: 0.9 });
  for (let z = -40; z <= 40; z += 8) {
    const j = K.mesh(jointMat, new THREE.PlaneGeometry(60, 0.12), 0, 0.03, z);
    j.rotation.x = -Math.PI / 2;
    content.add(j);
  }

  // Playable multi-level Meridian Tower under construction (enterable ground floor + interior stairs to 2nd floor!)
  const concrete = materialFor(0xb4b0a8, { roughness: 0.92, family: "stone", seed: 70 });
  const concreteDark = materialFor(0x8a867e, { roughness: 0.94, family: "stone", seed: 71 });
  const rebarMat = materialFor(0x555050, { roughness: 0.65, metalness: 0.65 });
  const bx = 0, bz = -16, bw = 18, bd = 14;
  // ground floor walkable concrete slab
  const gfSlab = K.mesh(concrete, new THREE.BoxGeometry(bw, 0.12, bd), bx, 0.06, bz);
  gfSlab.receiveShadow = true;
  K.solid(gfSlab, "concrete");
  // full-height structural columns (individual colliders so ground & 2nd floor are open!)
  for (const cx of [-bw / 2 + 0.6, 0, bw / 2 - 0.6]) {
    for (const cz of [-bd / 2 + 0.6, bd / 2 - 0.6]) {
      const col = K.mesh(concreteDark, bevelledBox(0.7, 9.4, 0.7, 0.03), bx + cx, 4.7, bz + cz);
      col.castShadow = true;
      col.receiveShadow = true;
      K.solid(col, "concrete");
    }
  }
  // ground floor cinderblock half-walls & interior cover partitions with doorways (CS2 site fighting!)
  const blockWall = materialFor(0x9b968c, { roughness: 0.92, family: "concrete", seed: 72 });
  K.solid(K.box(blockWall, 5.2, 2.8, 0.35, bx - 6.0, 0, bz + 6.7), "concrete");
  K.solid(K.box(blockWall, 5.2, 2.8, 0.35, bx + 6.0, 0, bz + 6.7), "concrete");
  K.solid(K.box(blockWall, 5.2, 2.8, 0.35, bx - 6.0, 0, bz - 6.7), "concrete");
  K.solid(K.box(blockWall, 5.2, 2.8, 0.35, bx + 6.0, 0, bz - 6.7), "concrete");
  K.solid(K.box(blockWall, 0.35, 2.8, 4.6, bx + 2.2, 0, bz - 2.2), "concrete");
  K.solid(K.box(blockWall, 4.0, 1.1, 0.35, bx - 2.5, 0, bz - 2.8), "concrete");
  // 2nd floor walkable concrete deck (y = 3.0..3.36m) split around stairwell cutout [-7.2..-1.2, -13.5..-11.5]
  const f2Slabs: [number, number, number, number][] = [
    [0, -18.25, 18, 9.5],       // north deck
    [3.9, -11.25, 10.2, 4.5],   // east deck (stairs land onto x = -1.2)
    [-5.1, -10.25, 7.8, 2.5],   // south-west deck
    [-8.1, -12.5, 1.8, 2.0],    // west lip
  ];
  for (const [sx, sz, sw, sd] of f2Slabs) {
    const sl = K.mesh(concrete, new THREE.BoxGeometry(sw, 0.36, sd), sx, 3.18, sz);
    sl.castShadow = true;
    sl.receiveShadow = true;
    K.solid(sl, "concrete");
  }
  // 2nd floor concrete stair (climbs +X from x=-6.9..x=-1.2 at z=-12.5 flush onto y=3.36m deck)
  K.stairs({ x: -6.9, z: -12.5, steps: 11, rise: 0.306, run: 0.54, width: 1.5, mat: concreteDark });
  // 2nd floor low concrete cover + safety rails
  const railMat = materialFor(0xd87a1c, { roughness: 0.7 });
  K.solid(K.box(concreteDark, 3.8, 1.05, 0.4, 4.5, 3.36, -9.6), "concrete");
  K.solid(K.box(concreteDark, 3.8, 1.05, 0.4, -4.5, 3.36, -21.8), "concrete");
  for (const f of [2, 3]) {
    const sy = f * 3;
    if (f === 3) {
      const slab = K.mesh(concrete, bevelledBox(bw, 0.38, bd, 0.04), bx, sy + 0.19, bz);
      slab.castShadow = true;
      slab.receiveShadow = true;
      content.add(slab);
      for (let i = 0; i < 24; i++) {
        const rx = bx + (K.rng() - 0.5) * bw * 0.85;
        const rz = bz + (K.rng() - 0.5) * bd * 0.85;
        content.add(part(new THREE.CylinderGeometry(0.035, 0.035, 1.6, 6), rebarMat, [rx, 10.1, rz], [0, 0, 0], false));
      }
    }
    for (const sz of [-bd / 2 + 0.12, bd / 2 - 0.12]) {
      content.add(part(new THREE.BoxGeometry(bw - 0.4, 0.06, 0.06), railMat, [bx, sy + 1.1, bz + sz], [0, 0, 0], false));
    }
  }

  // tower cranes over the building
  K.craneTower(-6, -16, 17, 0.1);
  K.craneTower(8, -16, 17, -0.1);

  // scaffolding tower
  const scaffoldMat = new THREE.MeshStandardMaterial({ color: 0xc8b020, roughness: 0.7, metalness: 0.5 });
  for (let i = 0; i < 14; i++) {
    const px = 8 + (i % 4) * 1.2;
    const pz = -30 + Math.floor(i / 4) * 1.2;
    const pole = K.mesh(scaffoldMat, new THREE.CylinderGeometry(0.06, 0.06, 9, 6), px, 4.5, pz);
    content.add(pole);
  }
  for (let y = 1.5; y <= 7.5; y += 1.5) {
    for (const px of [8, 9.2, 10.4, 11.6]) {
      const bar = K.mesh(scaffoldMat, new THREE.CylinderGeometry(0.04, 0.04, 3.6, 6), px, y, -30);
      bar.rotation.z = Math.PI / 2;
      content.add(bar);
    }
  }

  // site office (rescue target) — 2-room enterable office with street window + side doors + walkable roof
  K.enterable({
    x: -18, z: -20, w: 8, d: 7, h: 3.4,
    facade: facade({ base: "#d8d2c4", glass: "#2a3a4a", frame: "#5a5048", glow: "#ffd98a", bayW: 1.8, floorH: 3, cols: 3, rows: 1, rng: K.rng, sign: "SITE OFFICE" }),
    roof: "flat",
    roofMat: new THREE.MeshStandardMaterial({ color: 0x4a5a3a, roughness: 0.9 }),
    doors: ["S", "E"],
    windows: ["N", "W"],
    partition: "x",
    emissive: 0.5,
  });

  // east modular site warehouse (indoor CQB lane + climbable 3.6m rooftop overlook)
  K.enterable({
    x: 18.5, z: 6, w: 7, d: 9, h: 3.6,
    facade: facade({ base: "#6f7780", glass: "#1e2934", frame: "#3c424a", glow: "#ffd98a", bayW: 1.8, floorH: 3, cols: 3, rows: 1, rng: K.rng }),
    roof: "flat",
    roofMat: new THREE.MeshStandardMaterial({ color: 0x4a4d52, roughness: 0.88 }),
    doors: ["W", "N", "S"],
    windows: ["E"],
    partition: "z",
    walkableRoof: true,
    parapet: true,
    emissive: 0.5,
  });
  K.stairs({ x: 14.3, z: 10.6, steps: 12, rise: 0.3, run: 0.56, width: 1.4, mat: new THREE.MeshStandardMaterial({ color: 0x8a867e, roughness: 0.85 }) });

  // staircase up to a walkable scaffold overlook deck (covered vantage over north jammer)
  K.stairs({ x: 7.4, z: -29, steps: 8, rise: 0.3, run: 0.6, width: 1.3, alongZ: false, mat: new THREE.MeshStandardMaterial({ color: 0xb0a830, roughness: 0.7, metalness: 0.4 }) });
  const scafDeck = K.mesh(new THREE.MeshStandardMaterial({ color: 0x8a6d42, roughness: 0.88 }), bevelledBox(3.4, 0.28, 3.6, 0.03), 13.0, 2.4, -29.8);
  K.solid(scafDeck, "wood");

  // stacked concrete barriers forming corner cover / lanes through the site
  const wedgeMat = new THREE.MeshStandardMaterial({ color: 0xc8b020, roughness: 0.7, metalness: 0.3 });
  for (const [wx, wz, ry] of [[0, 18, 0.4], [0, -14, -0.4], [-14, 26, 0.2], [14, 26, -0.2]] as const) {
    K.solid(K.box(wedgeMat, 4, 1.2, 1.6, wx, 0, wz, ry), "concrete");
  }

  // containers
  K.containerRow(-18, 2, 4);
  K.containerRow(12, 18, 4);
  K.containerRow(-16, 22, 3);

  // excavator + gravel piles + pipes
  K.excavator(-14, 4, 0.4);
  for (const [gx, gz] of [[14, 24], [-12, 16], [6, 12]] as const) {
    const pile = K.mesh(new THREE.MeshStandardMaterial({ color: 0x7a7268, roughness: 1, flatShading: true }), new THREE.ConeGeometry(2.4, 2.2, 8), gx, 1.1, gz);
    content.add(pile);
  }
  const pipeMat = new THREE.MeshStandardMaterial({ color: 0x8a8a8a, roughness: 0.5, metalness: 0.7 });
  for (let i = 0; i < 8; i++) {
    const pipe = K.mesh(pipeMat, new THREE.CylinderGeometry(0.3, 0.3, 4, 12), -18 + i * 1.5, 0.3, 6);
    pipe.rotation.z = Math.PI / 2;
    pipe.rotation.y = K.rng() * 0.6;
    content.add(pipe);
  }

  // jammers (destroyables) — red crates + antenna + blinking beacon
  const jammerMat = new THREE.MeshStandardMaterial({ color: 0x8a1c1c, roughness: 0.6, metalness: 0.3 });
  for (const [jx, jz] of [[16, -6], [-16, -8], [0, -34]] as const) {
    const grp = new THREE.Group();
    grp.position.set(jx, 0, jz);
    const box = new THREE.Mesh(new THREE.BoxGeometry(1.6, 1.6, 1.6), jammerMat);
    box.position.y = 0.8;
    box.castShadow = true;
    box.receiveShadow = true;
    box.userData.kind = "metal";
    box.userData.destroyable = true;
    grp.add(box);
    // antenna mast + beacon
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 4, 8), pipeMat);
    mast.position.y = 2.8;
    grp.add(mast);
    const b = new THREE.Mesh(new THREE.SphereGeometry(0.14, 8, 6), new THREE.MeshStandardMaterial({ color: 0xff2020, emissive: 0xff0000, emissiveIntensity: 3 }));
    b.position.y = 4.9;
    grp.add(b);
    content.add(grp);
    K.colliders.push(box);
    K.destroyables.push(box);
    K.beacon(b, 4, K.rng() * 6);
  }

  // safety barriers around the site (keep south gate behind spawn [0,46] open)
  const barrierMat = new THREE.MeshStandardMaterial({ color: 0xd8b01c, roughness: 0.7 });
  for (let x = -30; x <= 30; x += 5) {
    if (Math.abs(x) >= 7) {
      const b = K.box(barrierMat, 1.8, 0.8, 0.2, x, 0, 48);
      content.add(b);
    }
    const b2 = K.box(barrierMat, 1.8, 0.8, 0.2, x, 0, -42);
    content.add(b2);
  }

  // barrels + crates cover
  K.barrel(new THREE.MeshStandardMaterial({ color: 0x9b2c22, roughness: 0.5, metalness: 0.7 }), -6, 30);
  K.barrel(new THREE.MeshStandardMaterial({ color: 0x2f4b6e, roughness: 0.5, metalness: 0.7 }), -6.6, 30.6);
  K.barrel(new THREE.MeshStandardMaterial({ color: 0x9b2c22, roughness: 0.5, metalness: 0.7 }), 6, 30);
  const wc = noiseCanvas(512, "#8a6a43", [["rgba(40,25,10,0.35)", 6000]], K.rng);
  const woodMat = new THREE.MeshStandardMaterial({ map: toTex(wc, 1), roughness: 0.82 });
  K.crate(woodMat, 18, 12, 1.2, 0.3);
  K.crate(woodMat, -18, 14, 1.1, -0.2);

  // environment polish: site weathering + clutter (visual only)
  for (let i = 0; i < 7; i++) K.groundStain(-26 + K.rng() * 52, -36 + K.rng() * 72, 0.6 + K.rng() * 0.9);
  K.puddle(-12, 8, 1.3, 1.0);
  K.puddle(15, 22, 1.1, 0.8);
  K.puddle(-6, 30, 1.0, 0.7);
  for (let i = 0; i < 5; i++) K.cracks(-20 + K.rng() * 40, -28 + K.rng() * 56, 2.4 + K.rng() * 1.8);
  for (let i = 0; i < 7; i++) K.rock(-24 + K.rng() * 48, -34 + K.rng() * 68, 0.6 + K.rng() * 0.9);
  K.rubble(14, 24, 5);
  K.rubble(-12, 16, 5);
  K.dirtMound(6, 12, 1.2);
  K.dirtMound(-14, -10, 1.0);
  K.trafficCone(-2, 44, 0.2);
  K.trafficCone(-1, 44.7, 0.4);
  K.trafficCone(1, 44.2, -0.2);
  K.roadSign(-19, 30, 0.3, "SITE", "#d8a01c", "#1a1a1a");
  K.roadSign(19, -26, -0.3, "DANGER", "#d8302a", "#f0ece0");
  K.wireStrand(-6, -16, 8, -16, 18.5, 0.8);
  K.wireStrand(-18, 2, 12, 18, 12.5, 1.0);
  K.wallStreak(-18, 2.0, -16.86, 5, 3, 0, false);
  K.dustMotes(110, 120, 18, 110, 0xd0c0a0, 0.3);

  return finish(K, ambient);
}

/* ---------------- M3: Downtown District ---------------- */
function buildDowntown(content: THREE.Object3D, main: THREE.Scene, renderer: THREE.WebGLRenderer): LevelResult {
  const K = new Kit(content, 90210);
  K.clearZone(0, 46, 9);
  const ambient = setupAmbient(main, renderer, {
    sunElev: 22,
    sunAzim: 255,
    turbidity: 4,
    rayleigh: 0.8,
    fogColor: 0x090e1a,
    fogDensity: 0.0082,
    hemiSky: 0x263858,
    hemiGround: 0x0c1018,
    hemiIntensity: 0.44,
    sunColor: 0x7ba4ff,
    sunIntensity: 0.92,
    envIntensity: 0.36,
    exposure: 1.15,
    stars: true,
    shadowFar: 110,
    nightSky: { zenith: 0x040712, horizon: 0x15223a, moonColor: 0x8fb4ff },
  });
  content.add(ambient.sun, ambient.hemi, ambient.skyMesh);
  if (ambient.stars) content.add(ambient.stars);

  // asphalt ground
  const gc = noiseCanvas(1024, "#4a4c4e", [["rgba(255,255,255,0.06)", 9000], ["rgba(0,0,0,0.3)", 6000]], K.rng);
  K.ground(300, new THREE.MeshStandardMaterial({ map: toTex(gc, 60), bumpMap: toTex(gc, 60, false), bumpScale: 1.1, roughness: 0.93 }));
  // sidewalks (E-W along z 8..12 and N-S strip)
  const sideMat = new THREE.MeshStandardMaterial({ color: 0x7a7670, roughness: 0.95 });
  for (const sx of [-10, 10]) {
    for (let z = -34; z <= 42; z += 2) {
      const sw = K.box(sideMat, 0.6, 0.15, 2, sx + (sx < 0 ? -0.3 : 0.3), 0, z);
      sw.receiveShadow = true;
      sw.receiveShadow = true;
      K.scene.add(sw);
    }
  }
  // road lines
  const paintMat = new THREE.MeshStandardMaterial({ color: 0xd8d4c4, roughness: 0.7 });
  for (let z = -32; z <= 46; z += 6) {
    const dash = K.mesh(paintMat, new THREE.PlaneGeometry(0.14, 3), 0, 0.03, z);
    dash.rotation.x = -Math.PI / 2;
    K.scene.add(dash);
  }

  // building materials
  const concreteF = facade({ base: "#9a968e", glass: "#1e242c", frame: "#4a4a50", glow: "#ffd27a", bayW: 1.8, floorH: 3.2, cols: 4, rows: 4, rng: K.rng });
  const brickF = facade({ base: "#8a5a44", glass: "#1e242c", frame: "#3a3a40", glow: "#ffd27a", bayW: 1.8, floorH: 3.2, cols: 4, rows: 4, rng: K.rng });
  const glassF = facade({ base: "#3a4450", glass: "#0e141c", frame: "#5a6068", glow: "#ffca7a", bayW: 2, floorH: 3.4, cols: 4, rows: 3, rng: K.rng });
  const roofSlab = new THREE.MeshStandardMaterial({ color: 0x5a5a60, roughness: 0.85 });

  const B = (x: number, z: number, w: number, d: number, h: number, f: ReturnType<typeof facade>, collideTo?: number) =>
    K.building({ x, z, w, d, h, facade: f, roof: "flat", roofMat: roofSlab, parapet: true, details: true, emissive: 0.85, collideTo });

  B(-15, -4, 12, 10, 26, concreteF);
  B(15, -4, 10, 10, 30, concreteF, 28.4); // rooftop snipers — collider trimmed
  K.fireEscape(15, -4, 10, 10, 30);
  K.fireEscape(-8, -28, 10, 10, 24);
  B(-15, 20, 12, 12, 22, brickF);
  B(15, 18, 10, 12, 26, concreteF);
  B(-15, 36, 12, 10, 20, brickF);
  B(15, 36, 10, 10, 22, concreteF);
  B(-8, -28, 10, 10, 24, glassF, 22.4); // rooftop sniper — trimmed
  B(8, -28, 10, 10, 24, glassF);

  // CS2-style pass-through urban shop/lobby connectors flanking the avenue (multi-door + pierced windows + 2-room interior)
  K.enterable({ x: -6.5, z: 20, w: 6.5, d: 9, h: 4.4, facade: brickF, roof: "flat", roofMat: roofSlab, doors: ["N", "S", "E", "W"], partition: "z", walkableRoof: true, parapet: true, emissive: 0.75 });
  K.enterable({ x: 6.5, z: 18, w: 6.5, d: 9, h: 4.2, facade: glassF, roof: "flat", roofMat: roofSlab, doors: ["N", "S", "E", "W"], partition: "z", walkableRoof: true, parapet: true, emissive: 0.85 });
  K.enterable({ x: 6.5, z: -16, w: 6.5, d: 9, h: 4.4, facade: glassF, roof: "flat", roofMat: roofSlab, doors: ["N", "S", "W"], windows: ["E"], partition: "z", emissive: 0.9 });
  K.enterable({ x: -6.5, z: -16, w: 6.5, d: 9, h: 4.4, facade: concreteF, roof: "flat", roofMat: roofSlab, doors: ["N", "S", "E"], windows: ["W"], partition: "z", emissive: 0.7 });

  // Elevated Downtown Pedestrian Skybridge / Overpass across the avenue (z = 2, y = 3.6m) with twin stairs!
  const skyMat = new THREE.MeshStandardMaterial({ color: 0x6a6e75, roughness: 0.85, metalness: 0.25 });
  const skyBridge = K.mesh(skyMat, bevelledBox(19.6, 0.34, 3.2, 0.04), 0, 3.43, 2);
  skyBridge.castShadow = true;
  skyBridge.receiveShadow = true;
  K.solid(skyBridge, "concrete");
  // skybridge waist-high railings + cover planters
  for (const sz of [0.55, 3.45]) {
    content.add(part(bevelledBox(17.2, 0.9, 0.16, 0.02), skyMat, [0, 4.05, sz]));
  }
  for (const sx of [-7.5, 7.5]) {
    content.add(part(bevelledBox(0.5, 3.3, 0.5, 0.03), skyMat, [sx, 1.65, 2]));
  }
  K.solid(K.box(skyMat, 1.8, 0.95, 0.45, 0, 3.6, 1.2), "concrete");
  // twin staircases climbing along -Z from south sidewalks up flush onto the skybridge (z=9.1 -> z=3.6)
  K.stairs({ x: -8.6, z: 9.1, alongZ: true, dir: -1, steps: 12, rise: 0.3, run: 0.48, width: 1.4, mat: skyMat });
  K.stairs({ x: 8.6, z: 9.1, alongZ: true, dir: -1, steps: 12, rise: 0.3, run: 0.48, width: 1.4, mat: skyMat });

  // stairs onto the shop rooftops + relay substation deck near (18, -26)
  K.stairs({ x: -9.8, z: 29.5, alongZ: true, dir: -1, steps: 14, rise: 0.31, run: 0.55, width: 1.3, mat: skyMat });
  K.stairs({ x: 9.8, z: 27.5, alongZ: true, dir: -1, steps: 14, rise: 0.3, run: 0.55, width: 1.3, mat: skyMat });

  // rooftop relay cache (objective) — mast in the street at (18, -26)
  K.relayTower(18, -26, 13);

  // streetlights (warm sodium avenue lamps + cool accent near relay)
  for (let z = -28; z <= 44; z += 12) {
    const col = z < -18 ? 0x9cd8ff : 0xffb866;
    K.streetlight(-9.4, z, Math.PI / 2, true, col);
    K.streetlight(9.4, z, -Math.PI / 2, true, col);
  }

  // cars (parked along the avenue center lanes, keeping shop doorways & skybridge stairs clear!)
  K.car(-2.6, 30, 0.3, 0x2e5a8c);
  K.car(2.6, 32, -0.2, 0x8a3a3a);
  K.car(-2.4, -10, 0.4, 0x5a5a5a);
  K.car(2.4, 8, -0.15, 0x2e6a4a);
  K.car(2.6, 16, -0.35, 0x8a7a2e);
  K.car(-2.5, 22, 0.2, 0x3a3a5a);

  // distant skyline (Meridian Tower under construction completion)
  const farMat = new THREE.MeshStandardMaterial({ color: 0x4a4f58, roughness: 0.9 });
  for (let i = 0; i < 12; i++) {
    const fx = -70 + i * 12 + K.rng() * 6;
    const fz = -50 - K.rng() * 20;
    const fh = 25 + K.rng() * 55;
    const fb = K.box(farMat, 8 + K.rng() * 8, fh, 8 + K.rng() * 8, fx, 0, fz);
    K.scene.add(fb);
  }
  // completed Meridian Tower in the distance (foreshadowing M2)
  const mt = K.box(new THREE.MeshStandardMaterial({ color: 0x5a6270, roughness: 0.85, emissive: 0x1a2230, emissiveIntensity: 0.6 }), 16, 78, 16, -58, 0, -56);
  K.scene.add(mt);
  const mtSign = K.mesh(new THREE.MeshStandardMaterial({ color: 0xd8b01c, emissive: 0xd8b01c, emissiveIntensity: 0.8 }), new THREE.PlaneGeometry(10, 3), -58, 41, -47.92);
  K.scene.add(mtSign);

  // cover props
  K.sandbag(-7, 16, 0, 4);
  K.sandbag(7, -16, 0, 4);
  K.crate(new THREE.MeshStandardMaterial({ color: 0x8a6a43, roughness: 0.82 }), 0, 28, 1.1, 0.2);
  K.crate(new THREE.MeshStandardMaterial({ color: 0x8a6a43, roughness: 0.82 }), -3, -20, 1.0, -0.3);

  // environment polish: street weathering + urban clutter (visual only)
  for (let i = 0; i < 8; i++) K.groundStain(-14 + K.rng() * 28, -26 + K.rng() * 68, 0.6 + K.rng() * 0.9);
  for (const [px, pz] of [[-6, 29], [6.5, 30], [-6.5, -14], [5.5, 17], [0, 26], [-2, 12]] as const) K.puddle(px, pz, 1.0 + K.rng() * 0.5, 0.7 + K.rng() * 0.4);
  for (let i = 0; i < 6; i++) K.cracks(-14 + K.rng() * 28, -26 + K.rng() * 68, 2.4 + K.rng() * 1.8);
  K.trafficCone(-5.2, 30.5, 0.2);
  K.trafficCone(-4.8, 31.2, 0.5);
  K.trafficCone(-5.6, 29.8, -0.3);
  K.trafficCone(6.8, 15.6, -0.2);
  K.trafficCone(7.2, 16.3, 0.4);
  K.roadSign(-12.6, 24, 0.2, "NO PARKING", "#d8302a", "#f0ece0");
  K.roadSign(12.6, -8, -0.2, "STREET", "#2a5a8a", "#f0ece0");
  K.billboard(-10.5, 40, 12.5, 0.15);
  K.billboard(10.5, 40, 12.5, -0.15);
  // rooftop equipment
  K.acUnit(-13, -0.5, 26.4, 0.1);
  K.acUnit(-17, -0.5, 26.4, 0.6);
  K.acUnit(15, -0.5, 30.4, -0.2);
  K.acUnit(-15, 23.5, 22.4, 0.3);
  K.acUnit(15, 21.5, 26.4, -0.3);
  K.acUnit(-15, 39.5, 20.4, 0.2);
  K.acUnit(15, 39.5, 22.4, -0.2);
  K.antennaArray(-15, -0.5, 26.4, 0.2);
  K.antennaArray(15, 21.5, 26.4, -0.2);
  K.antennaArray(-8, -24.5, 24.4, 0.1);
  // wall grime + rust streaks
  K.wallStreak(-15, 6, 1.17, 8, 6, 0, false);
  K.wallStreak(15, 8, 1.17, 8, 8, 0, false);
  K.wallStreak(-15, 5, 26.17, 7, 5, 0, true);
  K.wallStreak(15, 6, 24.17, 7, 6, 0, false);
  K.wallStreak(-8, 7, -22.83, 7, 7, 0, false);
  K.wallStreak(8, 6, -22.83, 7, 6, 0, true);
  // overhead wires between streetlight poles
  for (let z = -24; z <= 40; z += 12) {
    K.wireStrand(-9.4, z, -9.4, z + 12, 5.2, 0.4);
    K.wireStrand(9.4, z, 9.4, z + 12, 5.2, 0.4);
  }
  K.wireStrand(-9.4, 24, 9.4, 24, 5.4, 0.5);
  K.rubble(-3, 30.5, 4);
  K.rubble(2, -18, 4);
  K.rock(-12, 26, 0.8);
  K.rock(12, 22, 0.9);

  return finish(K, ambient);
}

/* ---------------- M4: Westgate Port ---------------- */
function buildPort(content: THREE.Object3D, main: THREE.Scene, renderer: THREE.WebGLRenderer): LevelResult {
  const K = new Kit(content, 5150);
  K.clearZone(0, -10, 8);
  K.clearZone(0, 48, 8);
  const ambient = setupAmbient(main, renderer, {
    sunElev: 20,
    sunAzim: 235,
    turbidity: 5,
    rayleigh: 1.0,
    fogColor: 0x060a14,
    fogDensity: 0.009,
    hemiSky: 0x24344c,
    hemiGround: 0x080c14,
    hemiIntensity: 0.42,
    sunColor: 0x6f98f2,
    sunIntensity: 0.88,
    envIntensity: 0.34,
    exposure: 1.18,
    stars: true,
    shadowFar: 100,
    nightSky: { zenith: 0x03060f, horizon: 0x101c30, moonColor: 0x7da4ff },
  });
  content.add(ambient.sun, ambient.hemi, ambient.skyMesh);
  if (ambient.stars) content.add(ambient.stars);

  // dock concrete deck (south half)
  const dc = noiseCanvas(1024, "#6a6a64", [["rgba(0,0,0,0.2)", 8000], ["rgba(255,255,255,0.05)", 4000]], K.rng);
  const deck = K.mesh(new THREE.MeshStandardMaterial({ map: toTex(dc, 40), bumpMap: toTex(dc, 40, false), bumpScale: 1, roughness: 0.93 }), new THREE.PlaneGeometry(90, 70), 0, 0, 21);
  deck.rotation.x = -Math.PI / 2;
  deck.receiveShadow = true;
  K.scene.add(deck);
  K.colliders.push(deck);

  // water (north half) + dock edge line
  K.water(400);
  const edge = K.mesh(new THREE.MeshStandardMaterial({ color: 0x2a2a2a, roughness: 0.9 }), new THREE.PlaneGeometry(90, 0.5), 0, 0.05, -14);
  edge.rotation.x = -Math.PI / 2;
  K.scene.add(edge);

  // pilings along the dock edge
  const pileMat = new THREE.MeshStandardMaterial({ color: 0x4a4640, roughness: 0.9 });
  for (let x = -26; x <= 26; x += 4) {
    for (let z = -14; z <= -11; z += 1.5) {
      const p = K.mesh(pileMat, new THREE.CylinderGeometry(0.18, 0.2, 4, 8), x, 2, z);
      K.scene.add(p);
      K.colliders.push(p);
    }
  }
  // bollards
  const bollardMat = new THREE.MeshStandardMaterial({ color: 0xd8b01c, roughness: 0.6, metalness: 0.5 });
  for (let x = -24; x <= 24; x += 8) {
    K.solid(K.mesh(bollardMat, new THREE.CylinderGeometry(0.25, 0.3, 0.9, 10), x, 0.45, -12.5), "concrete");
  }

  // cargo ship (deck guards + boss)
  K.ship(0, -28);

  // gangway stairs from the dock edge up to the ship deck
  const stepMat = new THREE.MeshStandardMaterial({ color: 0x5a554c, roughness: 0.9 });
  for (let i = 0; i < 6; i++) {
    K.solid(K.box(stepMat, 2.6, 0.5, 0.5, -1, 0.5 * i, -14 + 0.5 * i + 0.25, 0), "concrete");
  }
  K.solid(K.box(stepMat, 3, 0.6, 4, -1, 2.9, -9, 0), "concrete");

  // gantry cranes
  K.craneGantry(-13, -8.5, 16, 20);
  K.craneGantry(13, -8.5, 16, 20);

  // Enterable dockside Customs Warehouse + Harbor Security Station (multi-door indoor CQB + climbable rooftop catwalks!)
  const warehouseF = facade({ base: "#5a5a60", glass: "#1a2430", frame: "#3a3a40", glow: "#ffca7a", bayW: 2, floorH: 3.4, cols: 3, rows: 2, rng: K.rng });
  const roofSlabP = new THREE.MeshStandardMaterial({ color: 0x3a3a40, roughness: 0.85 });
  K.enterable({ x: -14, z: 24, w: 11, d: 9, h: 4.2, facade: warehouseF, roof: "flat", roofMat: roofSlabP, doors: ["N", "S", "E"], windows: ["W"], partition: "z", walkableRoof: true, parapet: true, emissive: 0.65 });
  K.enterable({ x: 14, z: 24, w: 8, d: 7, h: 3.6, facade: warehouseF, roof: "flat", roofMat: roofSlabP, doors: ["W", "N", "S"], windows: ["E"], partition: "x", walkableRoof: true, parapet: true, emissive: 0.55 });
  const dockStairMat = new THREE.MeshStandardMaterial({ color: 0x6a727a, roughness: 0.7, metalness: 0.5 });
  K.stairs({ x: -19.8, z: 18.5, alongZ: true, dir: 1, steps: 14, rise: 0.3, run: 0.55, width: 1.4, mat: dockStairMat });
  K.stairs({ x: 18.8, z: 19.5, alongZ: true, dir: 1, steps: 12, rise: 0.3, run: 0.55, width: 1.4, mat: dockStairMat });

  // Central covered shipping-container breezeway tunnel (x = 0, z = 8) + climbable top deck (y = 3.0m)
  const tunMat = materialFor(0x2e4a62, { roughness: 0.72, metalness: 0.35, family: "metal", seed: 84 });
  K.solid(K.box(tunMat, 0.45, 3.0, 9.0, -2.8, 0, 8), "metal");
  K.solid(K.box(tunMat, 0.45, 3.0, 9.0, 2.8, 0, 8), "metal");
  const tunRoof = K.mesh(tunMat, bevelledBox(6.1, 0.32, 9.2, 0.03), 0, 3.16, 8);
  K.solid(tunRoof, "metal");
  K.stairs({ x: -4.2, z: 14.2, alongZ: true, dir: -1, steps: 11, rise: 0.3, run: 0.52, width: 1.4, mat: dockStairMat });

  // container stacks on dock
  K.containerRow(-16, -2, 3);
  K.containerRow(16, -2, 3);
  K.containerRow(-18, 10, 3, 0.1);
  K.containerRow(18, 10, 3, -0.1);

  // staircase up a container stack at (-16, -2) and (+16, -2) for an elevated vantage over the dock
  K.stairs({ x: -16.0, z: 2.85, alongZ: true, dir: -1, steps: 8, rise: 0.325, run: 0.46, width: 1.4, mat: new THREE.MeshStandardMaterial({ color: 0x8a6a3a, roughness: 0.7, metalness: 0.3 }) });
  K.stairs({ x: 16.0, z: 2.85, alongZ: true, dir: -1, steps: 8, rise: 0.325, run: 0.46, width: 1.4, mat: new THREE.MeshStandardMaterial({ color: 0x3a6a8a, roughness: 0.7, metalness: 0.3 }) });

  // floodlight towers (with crossbar head mounting twin lamps)
  const poleMat = materialFor(0x2a2d30, { roughness: 0.55, metalness: 0.75 });
  for (const [fx, fz] of [[-10, 16], [10, 16], [-20, 28], [20, 28], [0, 38]] as const) {
    const pole = K.mesh(poleMat, new THREE.CylinderGeometry(0.12, 0.16, 12, 10), fx, 6, fz);
    K.scene.add(pole);
    content.add(part(bevelledBox(2.2, 0.14, 0.14, 0.02), poleMat, [fx + 0.7, 12.1, fz]));
    for (const lx of [fx, fx + 1.4]) {
      content.add(part(bevelledBox(0.55, 0.38, 0.35, 0.03), poleMat, [lx, 12.42, fz]));
      const lamp = K.mesh(new THREE.MeshStandardMaterial({ color: 0xfff4d0, emissive: 0xfff0c0, emissiveIntensity: 2.6 }), new THREE.SphereGeometry(0.28, 10, 8), lx, 12.35, fz + 0.12);
      K.scene.add(lamp);
    }
    const cone = K.mesh(new THREE.MeshBasicMaterial({ color: 0xfff0c8, transparent: true, opacity: 0.04, side: THREE.DoubleSide, depthWrite: false }), new THREE.ConeGeometry(5, 12, 12, 1, true), fx + 0.7, 6.2, fz);
    K.scene.add(cone);
  }

  // weapon crates (destroyables)
  const wcMat = materialFor(0x3a4a2a, { roughness: 0.7, metalness: 0.3, family: "wood", seed: 82 });
  const labelTex = stripeLabel();
  for (const [wx, wz] of [[14, -4], [-14, -6], [10, -10], [-10, -8]] as const) {
    const grp = new THREE.Group();
    grp.position.set(wx, 0, wz);
    const box = new THREE.Mesh(new RoundedBoxGeometry(1.8, 1.4, 1.8, 3, 0.06), wcMat);
    box.position.y = 0.7;
    box.castShadow = true;
    box.receiveShadow = true;
    box.userData.kind = "wood";
    box.userData.destroyable = true;
    grp.add(box);
    const label = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 0.5), new THREE.MeshStandardMaterial({ map: labelTex, roughness: 0.6 }));
    label.position.set(0, 0.05, 0.91);
    box.add(label);
    K.scene.add(grp);
    K.colliders.push(box);
    K.destroyables.push(box);
  }

  // cover props on dock
  K.barrel(new THREE.MeshStandardMaterial({ color: 0x9b2c22, roughness: 0.5, metalness: 0.7 }), -4, 20);
  K.barrel(new THREE.MeshStandardMaterial({ color: 0x2f4b6e, roughness: 0.5, metalness: 0.7 }), -4.6, 20.6);
  K.barrel(new THREE.MeshStandardMaterial({ color: 0x9b2c22, roughness: 0.5, metalness: 0.7 }), 4, 20);
  K.sandbag(8, 30, 0, 5);
  K.sandbag(-8, 30, 0, 5);
  K.container(12, 0, 34, 0.3, 0x3a5a3a);
  K.container(-14, 0, 38, -0.25, 0x4a5a6a);

  // dock & pier streetlights
  for (let z = 6; z <= 42; z += 12) {
    K.streetlight(-22, z, Math.PI / 2, true, 0x9cd8ff);
    K.streetlight(22, z, -Math.PI / 2, true, 0xffbe6b);
  }
  K.streetlight(-10, -10, 0, true, 0x9cd8ff);
  K.streetlight(10, -10, 0, true, 0x9cd8ff);

  // environment polish: dock weathering + clutter (visual only)
  for (let i = 0; i < 8; i++) K.groundStain(-24 + K.rng() * 48, -16 + K.rng() * 64, 0.6 + K.rng() * 0.9);
  for (const [px, pz] of [[-10, 18], [6, 22], [-16, 8], [18, 6], [-2, 34], [4, 28]] as const) K.puddle(px, pz, 1.0 + K.rng() * 0.6, 0.7 + K.rng() * 0.5);
  for (let i = 0; i < 6; i++) K.cracks(-22 + K.rng() * 44, -14 + K.rng() * 60, 2.4 + K.rng() * 1.8);
  // waterline fenders along the dock edge
  for (let x = -22; x <= 22; x += 7) K.fender(x, -12.8, 0.1);
  for (let i = 0; i < 6; i++) K.rock(-26 + K.rng() * 52, 8 + K.rng() * 50, 0.6 + K.rng() * 0.9);
  K.rubble(-14, 24, 5);
  K.rubble(14, 24, 5);
  K.trafficCone(-12.5, 22, 0.2);
  K.trafficCone(-13, 22.7, 0.5);
  K.trafficCone(-12, 22.2, -0.3);
  K.trafficCone(13, 22, -0.2);
  K.trafficCone(13.5, 22.7, 0.4);
  K.roadSign(-20, 30, 0.2, "DOCK", "#2a5a8a", "#f0ece0");
  K.roadSign(20, 30, -0.2, "NO ENTRY", "#d8302a", "#f0ece0");
  // rust + grime streaks on warehouses and containers
  K.wallStreak(-14, 3.2, 28.17, 8, 3.4, 0, true);
  K.wallStreak(14, 2.6, 27.17, 7, 3, 0, true);
  K.wallStreak(-14, 4.5, 24.17, 6, 2.5, 0, false);
  K.wallStreak(-12.98, 1.3, 2, 5, 2.4, Math.PI / 2, true);
  K.wallStreak(19.02, 1.3, 2, 5, 2.4, -Math.PI / 2, true);
  K.wallStreak(-15.02, 1.3, 10, 5, 2.4, Math.PI / 2, true);
  K.wallStreak(21.02, 1.3, 10, 5, 2.4, -Math.PI / 2, true);
  K.wireStrand(-13, -8.5, 13, -8.5, 17, 0.9);
  K.wireStrand(-13, -8.5, -13, 8, 16, 0.8);
  K.wireStrand(13, -8.5, 13, 8, 16, 0.8);

  return finish(K, ambient);
}

function stripeLabel(): THREE.Texture {
  const c = document.createElement("canvas");
  c.width = 512;
  c.height = 128;
  const g = c.getContext("2d")!;
  g.fillStyle = "#2a3320";
  g.fillRect(0, 0, 512, 128);
  g.fillStyle = "#e8e4d8";
  g.fillRect(0, 40, 512, 48);
  g.fillStyle = "#1a1a1a";
  g.font = "bold 34px sans-serif";
  g.textAlign = "center";
  g.fillText("MERIDIAN  •  CONFIDENTIAL", 256, 72);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/* ---------------- M5: Meridian HQ ---------------- */
function buildHQ(content: THREE.Object3D, main: THREE.Scene, renderer: THREE.WebGLRenderer): LevelResult {
  const K = new Kit(content, 700013);
  K.clearZone(0, 44, 9);
  K.clearZone(0, -43, 8);
  const ambient = setupAmbient(main, renderer, {
    sunElev: 24,
    sunAzim: 115,
    turbidity: 8,
    rayleigh: 0.6,
    fogColor: 0x080b12,
    fogDensity: 0.0105,
    hemiSky: 0x263244,
    hemiGround: 0x080a0f,
    hemiIntensity: 0.4,
    sunColor: 0x6e84b8,
    sunIntensity: 0.78,
    envIntensity: 0.32,
    exposure: 1.16,
    stars: true,
    shadowFar: 105,
    nightSky: { zenith: 0x03050b, horizon: 0x111724, moonColor: 0x8aa2d8 },
  });
  content.add(ambient.sun, ambient.hemi, ambient.skyMesh);
  if (ambient.stars) content.add(ambient.stars);

  // ground: compound asphalt + gravel
  const gc = noiseCanvas(1024, "#40413f", [["rgba(0,0,0,0.25)", 9000], ["rgba(255,255,255,0.04)", 4000]], K.rng);
  K.ground(300, new THREE.MeshStandardMaterial({ map: toTex(gc, 50), bumpMap: toTex(gc, 50, false), bumpScale: 1, roughness: 0.95 }));

  // Main Meridian Tower with Playable Ground-Floor Marble & Glass Lobby (fight INSIDE the HQ through to the helipad!)
  const glassF = facade({ base: "#2e343c", glass: "#0a0d12", frame: "#4a5058", glow: "#ffca7a", bayW: 2, floorH: 3.4, cols: 4, rows: 3, rng: K.rng, sign: "MERIDIAN" });
  const marbleMat = materialFor(0x2c3036, { roughness: 0.55, metalness: 0.25, family: "stone", seed: 91 });
  const lobbyFloor = K.mesh(marbleMat, new THREE.BoxGeometry(16, 0.14, 10), 0, 0.07, -32);
  lobbyFloor.receiveShadow = true;
  K.solid(lobbyFloor, "concrete");
  // Lobby walls (South entrance + North helipad exit, wide 3.6m double openings + interior security desk/columns!)
  const lH = 4.4;
  for (const sz of [-36.8, -27.2]) {
    for (const sx of [-5.0, 5.0]) {
      K.solid(K.box(marbleMat, 6.0, lH, 0.4, sx, 0, sz), "concrete");
    }
    K.solid(K.box(marbleMat, 4.0, lH - 3.0, 0.4, 0, 3.0, sz), "concrete");
  }
  for (const sx of [-7.8, 7.8]) {
    K.solid(K.box(marbleMat, 0.4, lH, 10.0, sx, 0, -32), "concrete");
  }
  // Lobby interior tactical columns + flanking security desks (clear center corridor to helipad!)
  for (const [cx, cz] of [[-4.8, -32], [4.8, -32]] as const) {
    K.solid(K.box(marbleMat, 0.85, lH, 0.85, cx, 0, cz), "concrete");
  }
  const deskMat = materialFor(0x4a3828, { roughness: 0.7 });
  K.solid(K.box(deskMat, 2.2, 1.05, 0.7, -2.7, 0.14, -32.2), "wood");
  K.solid(K.box(deskMat, 2.2, 1.05, 0.7, 2.7, 0.14, -32.2), "wood");
  // Lobby ceiling / Upper Skyscraper Shaft (y = 4.4 .. 42m, clear overhead!)
  const upperTowerMat = K.wallFaceMat(glassF, 16, 37.6, 0.6);
  const upperTower = K.mesh(upperTowerMat, new THREE.BoxGeometry(16, 37.6, 10), 0, 4.4 + 18.8, -32);
  upperTower.castShadow = true;
  upperTower.receiveShadow = true;
  content.add(upperTower);
  K.colliderBox(16, 37.6, 10, 0, 4.4, -32, 0, "concrete");
  K.roof(0, -32, 16, 10, 42, "flat", new THREE.MeshStandardMaterial({ color: 0x3a3f46, roughness: 0.85 }));
  K.parapet(0, -32, 16, 10, 42, new THREE.MeshStandardMaterial({ color: 0x3a3f46, roughness: 0.85 }));

  // tower entrance canopy (elevated overhead at y = 3.6 with support columns) + glowing lobby arch
  const canopyMat = materialFor(0x3a4048, { roughness: 0.7, metalness: 0.5 });
  K.scene.add(part(bevelledBox(5.2, 0.28, 3.0, 0.04), canopyMat, [0, 3.65, -25.5]));
  for (const sx of [-2.2, 2.2]) {
    K.scene.add(part(new THREE.CylinderGeometry(0.11, 0.11, 3.6, 12), canopyMat, [sx, 1.8, -24.3]));
  }

  // compound wall (z=-20) with main gate (x=-2..2) AND APC west breach gap (x=-15..-11) for CS2 A/B split assault!
  const wallMat = new THREE.MeshStandardMaterial({ color: 0x55565a, roughness: 0.9 });
  K.solid(K.box(wallMat, 12, 4.2, 0.8, -22, 0, -20), "concrete");
  K.solid(K.box(wallMat, 9, 4.2, 0.8, -6.5, 0, -20), "concrete");
  K.solid(K.box(wallMat, 22, 4.2, 0.8, 13, 0, -20), "concrete");
  // gate posts + guard tower
  K.solid(K.box(wallMat, 0.8, 5, 0.8, -2, 0, -20), "concrete");
  K.solid(K.box(wallMat, 0.8, 5, 0.8, 2, 0, -20), "concrete");
  K.solid(K.box(new THREE.MeshStandardMaterial({ color: 0x4a4e54, roughness: 0.85 }), 3, 6.5, 3, -7, 0, -20), "concrete");
  const roofT = K.mesh(new THREE.MeshStandardMaterial({ color: 0x2a2d30, roughness: 0.8 }), new THREE.ConeGeometry(2.4, 1.4, 4), -7, 7.2, -20);
  roofT.rotation.y = Math.PI / 4;
  K.scene.add(roofT);
  const towerBeacon = K.mesh(new THREE.MeshStandardMaterial({ color: 0xff2020, emissive: 0xff0000, emissiveIntensity: 3 }), new THREE.SphereGeometry(0.14, 8, 6), -7, 8.1, -20);
  K.scene.add(towerBeacon);
  K.beacon(towerBeacon, 2, 0);
  // razor wire on the wall (skip both gate and west breach!)
  const wireMat = new THREE.MeshStandardMaterial({ color: 0x8a8a8a, roughness: 0.4, metalness: 0.9 });
  for (let x = -24; x <= 24; x += 1.5) {
    if (Math.abs(x) < 2.6 || (x > -15.6 && x < -10.4)) continue;
    const ring = K.mesh(wireMat, new THREE.TorusGeometry(0.4, 0.03, 6, 10), x, 4.5, -19.7);
    ring.rotation.x = Math.PI / 2;
    ring.rotation.z = x * 0.4;
    K.scene.add(ring);
  }

  // courtyard props
  K.sandbag(-6, -22, 0, 6);
  K.sandbag(6, -22, 0, 6);

  // enterable multi-door security barracks (interior room-clearing + climbable 4.2m rooftops overlooking courtyard!)
  const barracksF = facade({ base: "#4a5058", glass: "#161c24", frame: "#33383f", glow: "#ffca7a", bayW: 2, floorH: 3.4, cols: 3, rows: 2, rng: K.rng });
  const hqRoof = new THREE.MeshStandardMaterial({ color: 0x2a2e33, roughness: 0.85 });
  K.enterable({ x: -20, z: 10, w: 10, d: 9, h: 4.2, facade: barracksF, roof: "flat", roofMat: hqRoof, doors: ["E", "N", "S"], windows: ["W"], partition: "z", walkableRoof: true, parapet: true, emissive: 0.55 });
  K.enterable({ x: 20, z: 10, w: 10, d: 9, h: 4.2, facade: barracksF, roof: "flat", roofMat: hqRoof, doors: ["W", "N", "S"], windows: ["E"], partition: "z", walkableRoof: true, parapet: true, emissive: 0.55 });

  // staircases up BOTH barracks rooftops for elevated crossfire over the approach & wall breach
  const hqStairMat = new THREE.MeshStandardMaterial({ color: 0x55565a, roughness: 0.9 });
  K.stairs({ x: -26.0, z: 14.5, alongZ: true, dir: -1, steps: 14, rise: 0.3, run: 0.55, width: 1.4, mat: hqStairMat });
  K.stairs({ x: 26.0, z: 14.5, alongZ: true, dir: -1, steps: 14, rise: 0.3, run: 0.55, width: 1.4, mat: hqStairMat });

  // low corner cover / barricades in the courtyard
  const bqMat = new THREE.MeshStandardMaterial({ color: 0x5a5c60, roughness: 0.9 });
  K.solid(K.box(bqMat, 5, 1.1, 0.5, -10, 0, -16, 0.1), "concrete");
  K.solid(K.box(bqMat, 5, 1.1, 0.5, 10, 0, -16, -0.1), "concrete");
  K.solid(K.box(bqMat, 0.5, 1.1, 8, 0, 0, -18, 0), "concrete");
  for (const [fx, fz] of [[-14, -25], [14, -25]] as const) {
    K.solid(K.mesh(new THREE.MeshStandardMaterial({ color: 0x8a8a2a, roughness: 0.6, metalness: 0.4 }), new THREE.CylinderGeometry(1.2, 1.2, 3, 12), fx, 1.5, fz), "metal");
  }
  // perimeter cover barricades
  K.sandbag(-18, -12, 0.5, 5);
  K.sandbag(18, -12, -0.5, 5);
  // crates + barrels
  const woodMat = new THREE.MeshStandardMaterial({ color: 0x8a6a43, roughness: 0.82 });
  K.crate(woodMat, -18, -10.5, 1.15, 0.4);
  K.crate(woodMat, 18, -10.5, 1.15, -0.4);
  K.crate(woodMat, -4, -23, 1.2, 0.2);
  K.crate(woodMat, 4, -23, 1.1, -0.2);
  K.crate(woodMat, 0, -24.5, 1.0, 0.4);
  K.barrel(new THREE.MeshStandardMaterial({ color: 0x9b2c22, roughness: 0.5, metalness: 0.7 }), -8, -22);
  K.barrel(new THREE.MeshStandardMaterial({ color: 0x2f4b6e, roughness: 0.5, metalness: 0.7 }), 8, -22);

  // environment polish: compound weathering + clutter (visual only)
  for (let i = 0; i < 7; i++) K.groundStain(-20 + K.rng() * 40, -34 + K.rng() * 60, 0.6 + K.rng() * 0.9);
  for (const [px, pz] of [[-14, -18], [12, -20], [-6, 20], [8, 14], [0, -14]] as const) K.puddle(px, pz, 1.0 + K.rng() * 0.5, 0.7 + K.rng() * 0.4);
  for (let i = 0; i < 5; i++) K.cracks(-18 + K.rng() * 36, -32 + K.rng() * 56, 2.4 + K.rng() * 1.8);
  K.trafficCone(-3.4, -21.4, 0.2);
  K.trafficCone(-3.8, -22, 0.5);
  K.trafficCone(3.4, -21.4, -0.2);
  K.trafficCone(3.8, -22, -0.4);
  K.roadSign(-22, 14, 0.2, "NO ENTRY", "#d8302a", "#f0ece0");
  K.roadSign(22, 14, -0.2, "HQ", "#2a5a8a", "#f0ece0");
  // wall grime/rust on tower + barracks + compound wall
  K.wallStreak(0, 12, -26.87, 10, 10, 0, false);
  K.wallStreak(0, 20, -26.87, 8, 8, 0, true);
  K.wallStreak(-20, 3.2, 14.17, 8, 3.4, 0, false);
  K.wallStreak(20, 3.2, 14.17, 8, 3.4, 0, true);
  K.wallStreak(-15, 2.5, -19.42, 20, 3, 0, false);
  K.wallStreak(15, 2.5, -19.42, 20, 3, 0, false);
  // rooftop equipment
  K.acUnit(-20, 12, 5.4, 0.2);
  K.acUnit(20, 12, 5.4, -0.2);
  K.acUnit(-20, 13, 5.4, 0.5);
  K.acUnit(20, 13, 5.4, -0.5);
  K.antennaArray(0, -32, 42.4, 0.1);
  // overhead wires along the compound wall top
  for (let x = -24; x <= 20; x += 8) K.wireStrand(x, -19.7, x + 8, -19.7, 4.9, 0.3);
  K.wireStrand(-20, 10, 20, 10, 5.6, 0.5);
  K.rubble(-6, -22, 4);
  K.rubble(6, -22, 4);
  K.rock(-22, 12, 0.8);
  K.rock(22, 12, 0.9);

  // helipad (extraction, north of tower)
  K.helipad(0, -44);

  // streetlights along approach & courtyard perimeter
  for (let z = 44; z >= 16; z -= 12) {
    K.streetlight(-9, z, Math.PI / 2, true, 0xffbd68);
    K.streetlight(9, z, -Math.PI / 2, true, 0xffbd68);
  }
  K.streetlight(-18, -14, Math.PI / 2, true, 0x9cd8ff);
  K.streetlight(18, -14, -Math.PI / 2, true, 0x9cd8ff);
  K.streetlight(-12, -38, Math.PI / 2, true, 0x9cd8ff);
  K.streetlight(12, -38, -Math.PI / 2, true, 0x9cd8ff);

  // rain
  const rainGeo = new THREE.BufferGeometry();
  const rainCount = 900;
  const rainPos = new Float32Array(rainCount * 3);
  for (let i = 0; i < rainCount; i++) {
    rainPos[i * 3] = (K.rng() - 0.5) * 130;
    rainPos[i * 3 + 1] = K.rng() * 45;
    rainPos[i * 3 + 2] = (K.rng() - 0.5) * 130;
  }
  rainGeo.setAttribute("position", new THREE.BufferAttribute(rainPos, 3));
  const rain = new THREE.Points(rainGeo, new THREE.PointsMaterial({ color: 0x8ab0d0, size: 0.08, transparent: true, opacity: 0.4, depthWrite: false }));
  K.scene.add(rain);
  K.extras.push({
    update: (dt: number) => {
      const p = rain.geometry.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < rainCount; i++) {
        p.array[i * 3 + 1] -= 26 * dt;
        if (p.array[i * 3 + 1] < 0) p.array[i * 3 + 1] = 45;
      }
      p.needsUpdate = true;
    },
  });
  // lightning flashes
  const flash = new THREE.PointLight(0xb8c8e8, 0, 120, 2);
  K.scene.add(flash);
  let lightningTimer = 5;
  K.extras.push({
    update: (dt: number) => {
      lightningTimer -= dt;
      if (lightningTimer <= 0) {
        lightningTimer = 6 + Math.random() * 10;
        flash.position.set((Math.random() - 0.5) * 90, 30, (Math.random() - 0.5) * 90);
        flash.intensity = 2.5;
      }
      flash.intensity = Math.max(0, flash.intensity - dt * 10);
    },
  });

  return finish(K, ambient);
}

/* ---------------- M6: Iron Citadel (260m Black-Site Fortress) ---------------- */
function buildCitadel(content: THREE.Object3D, main: THREE.Scene, renderer: THREE.WebGLRenderer): LevelResult {
  const K = new Kit(content, 900017);
  K.clearZone(0, 84, 10);
  K.clearZone(0, -84, 8);
  const ambient = setupAmbient(main, renderer, {
    sunElev: 25,
    sunAzim: 145,
    turbidity: 7,
    rayleigh: 0.7,
    fogColor: 0x080b15,
    fogDensity: 0.0072,
    hemiSky: 0x28334a,
    hemiGround: 0x0a0d14,
    hemiIntensity: 0.44,
    sunColor: 0x7898e8,
    sunIntensity: 0.88,
    envIntensity: 0.36,
    exposure: 1.18,
    stars: true,
    shadowFar: 160,
    nightSky: { zenith: 0x03050d, horizon: 0x13192b, moonColor: 0x9eb8ff },
  });
  content.add(ambient.sun, ambient.hemi, ambient.skyMesh);
  if (ambient.stars) content.add(ambient.stars);

  // Massive 380m alpine dark-stone & asphalt compound ground
  const gc = noiseCanvas(1024, "#363a42", [["rgba(0,0,0,0.25)", 9500], ["rgba(255,255,255,0.05)", 4500]], K.rng);
  K.ground(380, new THREE.MeshStandardMaterial({ map: toTex(gc, 65), bumpMap: toTex(gc, 65, false), bumpScale: 1.1, roughness: 0.94 }));

  const wallMat = materialFor(0x464a54, { roughness: 0.88, family: "stone", seed: 101 });
  const darkSteel = materialFor(0x282d36, { roughness: 0.55, metalness: 0.55, family: "metal", seed: 102 });
  const bunkerRoof = new THREE.MeshStandardMaterial({ color: 0x2a2f38, roughness: 0.85 });
  const stairMat = new THREE.MeshStandardMaterial({ color: 0x5c6470, roughness: 0.75, metalness: 0.4 });
  const citadelF = facade({ base: "#323844", glass: "#0d121a", frame: "#4a5260", glow: "#c084fc", bayW: 2, floorH: 3.4, cols: 4, rows: 2, rng: K.rng });

  // Outer perimeter mountain ridge walls (keeps 260m arena framed)
  for (const sx of [-70, 70]) {
    K.solid(K.box(wallMat, 3.0, 7.0, 204, sx, 0, -5), "concrete");
  }
  K.solid(K.box(wallMat, 144, 7.0, 3.0, 0, 0, -106), "concrete");
  K.solid(K.box(wallMat, 144, 7.0, 3.0, 0, 0, 96), "concrete");

  // ---- Zone 1: South Perimeter Wall (z = +54) with 3 breach gaps + Twin Watchtowers ----
  K.solid(K.box(wallMat, 44, 4.2, 1.0, -46, 0, 54), "concrete");
  K.solid(K.box(wallMat, 15, 4.2, 1.0, -10.5, 0, 54), "concrete");
  K.solid(K.box(wallMat, 15, 4.2, 1.0, 10.5, 0, 54), "concrete");
  K.solid(K.box(wallMat, 44, 4.2, 1.0, 46, 0, 54), "concrete");

  // Twin climbable sniper watchtowers at (-14, 54) and (+14, 54), deck y = 4.5m
  for (const tx of [-14, 14]) {
    K.solid(K.box(darkSteel, 4.4, 4.5, 4.4, tx, 0, 54), "metal");
    K.parapet(tx, 54, 4.4, 4.4, 4.5, darkSteel);
    K.stairs({ x: tx + (tx < 0 ? -3.2 : 3.2), z: 60.5, alongZ: true, dir: -1, steps: 15, rise: 0.3, run: 0.52, width: 1.4, mat: stairMat });
  }
  K.sandbag(0, 62, 0, 6);
  K.container(-22, 0, 66, 0.25, 0x3b4248);
  K.container(22, 0, 66, -0.25, 0x3b4248);

  // ---- Zone 2: West Armory Bunker (-34, 24) & East Comms Bunker (+34, 24) ----
  K.enterable({ x: -34, z: 24, w: 14, d: 10, h: 4.4, facade: citadelF, roof: "flat", roofMat: bunkerRoof, doors: ["N", "S", "E"], windows: ["W"], partition: "z", walkableRoof: true, parapet: true, emissive: 0.65 });
  K.enterable({ x: 34, z: 24, w: 14, d: 10, h: 4.4, facade: citadelF, roof: "flat", roofMat: bunkerRoof, doors: ["N", "S", "W"], windows: ["E"], partition: "z", walkableRoof: true, parapet: true, emissive: 0.65 });
  K.stairs({ x: -42.5, z: 29.5, alongZ: true, dir: -1, steps: 15, rise: 0.3, run: 0.55, width: 1.5, mat: stairMat });
  K.stairs({ x: 42.5, z: 29.5, alongZ: true, dir: -1, steps: 15, rise: 0.3, run: 0.55, width: 1.5, mat: stairMat });

  // Courtyard shipping containers & tactical cover
  K.containerRow(-14, 38, 2);
  K.containerRow(14, 38, 2);
  K.containerRow(-22, 8, 2);
  K.containerRow(22, 8, 2);
  K.container(0, 0, 26, Math.PI / 2, 0x323b45);
  K.sandbag(-8, 20, 0, 6);
  K.sandbag(8, 20, 0, 6);

  // ---- Zone 3: 48m Central Elevated Skyway Catwalk (z = -4, y = 3.6m) ----
  const skyDeck = K.mesh(darkSteel, bevelledBox(48, 0.36, 4.4, 0.04), 0, 3.58, -4);
  K.solid(skyDeck, "metal");
  K.parapet(0, -4, 48, 4.4, 3.76, darkSteel);
  for (const sx of [-20, -8, 8, 20]) {
    K.solid(K.box(darkSteel, 0.7, 3.4, 0.7, sx, 0, -4), "metal");
  }
  K.stairs({ x: -25.2, z: 3.5, alongZ: true, dir: -1, steps: 12, rise: 0.3, run: 0.52, width: 1.5, mat: stairMat });
  K.stairs({ x: 25.2, z: 3.5, alongZ: true, dir: -1, steps: 12, rise: 0.3, run: 0.52, width: 1.5, mat: stairMat });

  // ---- 4 Sabotage Lattice Relays (destroyables) ----
  const relayMat = new THREE.MeshStandardMaterial({ color: 0x5b21b6, roughness: 0.45, metalness: 0.45 });
  const mastMat = new THREE.MeshStandardMaterial({ color: 0x333842, metalness: 0.7, roughness: 0.4 });
  for (const [rx, rz] of [[-34, 14], [34, 14], [-14, -14], [14, -14]] as const) {
    const grp = new THREE.Group();
    grp.position.set(rx, 0, rz);
    const box = new THREE.Mesh(new THREE.BoxGeometry(1.8, 1.8, 1.8), relayMat);
    box.position.y = 0.9;
    box.castShadow = true;
    box.receiveShadow = true;
    box.userData.kind = "metal";
    box.userData.destroyable = true;
    grp.add(box);
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 4.4, 8), mastMat);
    mast.position.y = 3.1;
    grp.add(mast);
    const orb = new THREE.Mesh(
      new THREE.SphereGeometry(0.18, 10, 8),
      new THREE.MeshStandardMaterial({ color: 0xc084fc, emissive: 0xa855f7, emissiveIntensity: 3.5 }),
    );
    orb.position.y = 5.4;
    grp.add(orb);
    content.add(grp);
    K.colliders.push(box);
    K.destroyables.push(box);
    K.beacon(orb, 4, K.rng() * 6);
  }

  // ---- Zone 4: Inner Citadel Wall (z = -28) + Enterable Citadel Core + Vault & Barracks ----
  K.solid(K.box(wallMat, 40, 4.4, 1.0, -48, 0, -28), "concrete");
  K.solid(K.box(wallMat, 18, 4.4, 1.0, -13, 0, -28), "concrete");
  K.solid(K.box(wallMat, 18, 4.4, 1.0, 13, 0, -28), "concrete");
  K.solid(K.box(wallMat, 40, 4.4, 1.0, 48, 0, -28), "concrete");

  // Main Citadel Fortress Core (0, -48): 22m x 16m enterable command hall leading through to North Helipad
  const hallMat = materialFor(0x282d36, { roughness: 0.6, metalness: 0.25, family: "stone", seed: 103 });
  const hallFloor = K.mesh(hallMat, new THREE.BoxGeometry(22, 0.14, 16), 0, 0.07, -48);
  hallFloor.receiveShadow = true;
  K.solid(hallFloor, "concrete");
  const hH = 4.8;
  for (const hz of [-55.8, -40.2]) {
    for (const sx of [-7.0, 7.0]) {
      K.solid(K.box(hallMat, 8.0, hH, 0.45, sx, 0, hz), "concrete");
    }
    K.solid(K.box(hallMat, 6.0, hH - 3.2, 0.45, 0, 3.2, hz), "concrete");
  }
  for (const sx of [-10.8, 10.8]) {
    K.solid(K.box(hallMat, 0.45, hH, 16.0, sx, 0, -48), "concrete");
  }
  for (const [cx, cz] of [[-5.6, -48], [5.6, -48], [-5.6, -43], [5.6, -43]] as const) {
    K.solid(K.box(hallMat, 0.9, hH, 0.9, cx, 0, cz), "concrete");
  }
  const upperFortMat = K.wallFaceMat(citadelF, 22, 24, 0.65);
  const upperFort = K.mesh(upperFortMat, new THREE.BoxGeometry(22, 24, 16), 0, 4.8 + 12, -48);
  upperFort.castShadow = true;
  upperFort.receiveShadow = true;
  content.add(upperFort);
  K.colliderBox(22, 24, 16, 0, 4.8, -48, 0, "concrete");
  K.roof(0, -48, 22, 16, 28.8, "flat", bunkerRoof);
  K.parapet(0, -48, 22, 16, 28.8, bunkerRoof);
  K.antennaArray(0, -48, 29.2, 0.1);

  // West Citadel Barracks (-24, -46, climbable roof y = 4.2m) & East Detention Vault (+24, -46 holding Mara)
  K.enterable({ x: -24, z: -46, w: 10, d: 9, h: 4.2, facade: citadelF, roof: "flat", roofMat: bunkerRoof, doors: ["N", "S", "E"], windows: ["W"], walkableRoof: true, parapet: true, emissive: 0.6 });
  K.stairs({ x: -30.5, z: -41.5, alongZ: true, dir: -1, steps: 14, rise: 0.3, run: 0.55, width: 1.4, mat: stairMat });
  K.enterable({ x: 24, z: -46, w: 10, d: 9, h: 4.2, facade: citadelF, roof: "flat", roofMat: bunkerRoof, doors: ["N", "S", "W"], windows: ["E"], walkableRoof: true, parapet: true, emissive: 0.6 });

  // North Helipad Arena cover & extraction pad at (0, -84)
  K.sandbag(-8, -68, 0.2, 6);
  K.sandbag(8, -68, -0.2, 6);
  K.crate(new THREE.MeshStandardMaterial({ color: 0x6b5335, roughness: 0.82 }), -10, -76, 1.3, 0.3);
  K.crate(new THREE.MeshStandardMaterial({ color: 0x6b5335, roughness: 0.82 }), 10, -76, 1.3, -0.3);
  K.helipad(0, -84);

  // Atmospheric streetlights & heavy alpine rain
  for (let z = 76; z >= -76; z -= 18) {
    const col = z < -40 ? 0xa3c8ff : 0xffbe6b;
    K.streetlight(-22, z, Math.PI / 2, true, col);
    K.streetlight(22, z, -Math.PI / 2, true, col);
  }
  K.streetlight(-12, -78, Math.PI / 2, true, 0xa3c8ff);
  K.streetlight(12, -78, -Math.PI / 2, true, 0xa3c8ff);
  const rainGeo = new THREE.BufferGeometry();
  const rainCount = 1100;
  const rainPos = new Float32Array(rainCount * 3);
  for (let i = 0; i < rainCount; i++) {
    rainPos[i * 3] = (K.rng() - 0.5) * 180;
    rainPos[i * 3 + 1] = K.rng() * 50;
    rainPos[i * 3 + 2] = (K.rng() - 0.5) * 200;
  }
  rainGeo.setAttribute("position", new THREE.BufferAttribute(rainPos, 3));
  const rain = new THREE.Points(rainGeo, new THREE.PointsMaterial({ color: 0x94b8dc, size: 0.08, transparent: true, opacity: 0.42, depthWrite: false }));
  K.scene.add(rain);
  K.extras.push({
    update: (dt: number) => {
      const p = rain.geometry.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < rainCount; i++) {
        p.array[i * 3 + 1] -= 28 * dt;
        if (p.array[i * 3 + 1] < 0) p.array[i * 3 + 1] = 50;
      }
      p.needsUpdate = true;
    },
  });

  return finish(K, ambient);
}

/* ====================== result helpers ====================== */
export interface LevelResult extends World {
  aabbs: THREE.Box3[];
  destroyables: THREE.Mesh[];
  /** highest walkable surface top at (x, z) that is at/below y (within step range) */
  groundHeightAt: (x: number, z: number, y: number) => number;
  spatial?: SpatialAABBGrid;
  spatialColliders?: SpatialColliderGrid;
  heightSystem?: WorldHeightSystem;
  openWorld?: OpenWorldEngine;
  vehicles?: WestgateVehicleManager;
  activities?: WestgateActivityManager;
  apartments?: import("./city/Apartments").ApartmentSystem;
  signals?: import("./city/TrafficSignals").TrafficSignalManager;
  pedestrians?: import("./city/PedestrianSystem").PedestrianSystem;
  livingWorld?: import("./city/LivingWorld").LivingWorldController;
  wildlife?: import("./city/WildlifeSystem").WildlifeSystem;
  wanted?: import("./city/WantedSystem").WantedSystem;
  shops?: import("./city/CityShops").CityShopsManager;
  randomEvents?: import("./city/RandomEvents").RandomEventsManager;
  aircraft?: import("./vehicles/air/AirVehicleSystem").AirVehicleSystem;
  boats?: import("./vehicles/water/BoatSystem").BoatSystem;
  collectibles?: import("./city/CollectiblesSystem").CollectiblesSystem;
  bodyCarry?: import("./city/BodyCarrySystem").BodyCarrySystem;
  contracts?: import("./city/ContractSurveillance").ContractSurveillanceSystem;
  minimapData?: MinimapData;
  getDistrictAt?: (x: number, z: number) => DistrictInfo;
  weather?: WeatherState;
  setWeatherMode?: (mode: WeatherMode) => void;
  getWeatherLabel?: () => string;
  getWeatherGrip?: () => number;
  timeOfDay?: TimeOfDayMode;
  setTimeOfDay?: (mode: TimeOfDayMode) => void;
  getTimeOfDayDarkness?: () => number;
  updateWeatherFx?: (
    dt: number,
    camPos: THREE.Vector3,
    camera: THREE.Camera,
    speed: number,
    vehPos?: THREE.Vector3,
    vehYaw?: number,
    vehWidth?: number,
    vehLength?: number,
  ) => void;
  disposeExtra?: () => void;
}

function finish(K: Kit, ambient: ReturnType<typeof setupAmbient>): LevelResult {
  // Pooled real SpotLights for the closest lit streetlights (respects WebGL uniform limits)
  const lampPoolCount = Math.min(4, K.streetLamps.length);
  const lampLights: THREE.SpotLight[] = [];
  for (let i = 0; i < lampPoolCount; i++) {
    const sl = new THREE.SpotLight(0xffbe6b, 28, 22, 0.72, 0.75, 1.55);
    sl.castShadow = false;
    K.scene.add(sl, sl.target);
    lampLights.push(sl);
  }
  const update = (_dt: number, focus: THREE.Vector3) => {
    ambient.update(_dt, focus);

    if (lampLights.length > 0 && K.streetLamps.length > 0) {
      const sorted = K.streetLamps
        .map((l) => ({ l, d2: l.ground.distanceToSquared(focus) }))
        .sort((a, b) => a.d2 - b.d2);
      for (let i = 0; i < lampLights.length; i++) {
        const sl = lampLights[i];
        const pick = sorted[i];
        if (pick && pick.d2 < 3600) {
          sl.visible = true;
          sl.color.setHex(pick.l.color);
          sl.position.copy(pick.l.head);
          sl.target.position.copy(pick.l.ground);
          sl.target.updateMatrixWorld();
        } else {
          sl.visible = false;
        }
      }
    }

    K.beacons.forEach((b) => {
      b.phase += b.speed * _dt;
      b.mesh.visible = Math.sin(b.phase) > 0;
    });
    K.extras.forEach((e) => e.update(_dt));
  };
  const { spatial, spatialColliders, heightSystem } = indexLevelSpatial(K.colliders, K.aabbs, K.walkableSurfaces);
  const groundHeightAt = (x: number, z: number, y: number): number => heightSystem.groundHeightAt(x, z, y);
  return {
    colliders: K.colliders,
    targets: [],
    sun: ambient.sun,
    sunDir: ambient.sunDir,
    update,
    hitTarget: () => {},
    aabbs: K.aabbs,
    destroyables: K.destroyables,
    groundHeightAt,
    spatial,
    spatialColliders,
    heightSystem,
    disposeExtra: ambient.dispose,
  };
}

export function buildLevel(missionId: number, content: THREE.Object3D, main: THREE.Scene, renderer: THREE.WebGLRenderer): LevelResult {
  switch (missionId) {
    case 0: return buildRange(content, main, renderer);
    case 1: return buildVillage(content, main, renderer);
    case 2: return buildConstruction(content, main, renderer);
    case 3: return buildDowntown(content, main, renderer);
    case 4: return buildPort(content, main, renderer);
    case 5: return buildHQ(content, main, renderer);
    case 6: return buildCitadel(content, main, renderer);
    default: return buildRange(content, main, renderer);
  }
}

export async function buildLevelAsync(missionId: number, content: THREE.Object3D, main: THREE.Scene, renderer: THREE.WebGLRenderer): Promise<LevelResult> {
  if (missionId === -1) {
    const { buildWestgateWorld } = await import("./city/WestgateWorld");
    return buildWestgateWorld(content, main, renderer);
  }
  return buildLevel(missionId, content, main, renderer);
}
