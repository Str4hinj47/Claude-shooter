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
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { buildWorld, World } from "./world";
import type { SurfaceKind } from "./world";

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
  t.anisotropy = 16;
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

/** tile roof: horizontal tile rows (bands) stacking along the slope */
function tileTex(size: number, rng: () => number): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const g = c.getContext("2d")!;
  const rows = 6;
  for (let r = 0; r < rows; r++) {
    const base = 0.62 + rng() * 0.18;
    g.fillStyle = `rgb(${Math.floor(120 * base)},${Math.floor(62 * base)},${Math.floor(44 * base)})`;
    g.fillRect(0, (r * size) / rows, size, size / rows);
    // tile highlight + shadow within the row
    g.fillStyle = "rgba(255,220,180,0.10)";
    g.fillRect(0, (r * size) / rows, size, size / rows / 3);
    g.fillStyle = "rgba(0,0,0,0.18)";
    g.fillRect(0, ((r + 1) * size) / rows - 3, size, 3);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** slate roof: finer dark bands */
function slateTex(size: number, rng: () => number): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const g = c.getContext("2d")!;
  const rows = 9;
  for (let r = 0; r < rows; r++) {
    const v = 0.32 + rng() * 0.14;
    g.fillStyle = `rgb(${Math.floor(70 * v)},${Math.floor(74 * v)},${Math.floor(80 * v)})`;
    g.fillRect(0, (r * size) / rows, size, size / rows);
    g.fillStyle = "rgba(255,255,255,0.07)";
    g.fillRect(0, (r * size) / rows, size, size / rows / 3);
    g.fillStyle = "rgba(0,0,0,0.25)";
    g.fillRect(0, ((r + 1) * size) / rows - 2, size, 2);
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
  const px = 256;
  const cy = px / o.rows;
  const color = document.createElement("canvas");
  color.width = color.height = px;
  const glow = document.createElement("canvas");
  glow.width = glow.height = px;
  const gc = color.getContext("2d")!;
  const gg = glow.getContext("2d")!;
  gc.fillStyle = o.base;
  gc.fillRect(0, 0, px, px);
  gg.fillStyle = "#000";
  gg.fillRect(0, 0, px, px);
  // grime + render streaks on the wall
  for (let i = 0; i < 40; i++) {
    gc.fillStyle = `rgba(0,0,0,${0.03 + o.rng() * 0.06})`;
    const r = 10 + o.rng() * 40;
    gc.beginPath();
    gc.arc(o.rng() * px, o.rng() * px, r, 0, Math.PI * 2);
    gc.fill();
  }
  const tileW = o.bayW * o.cols;
  for (let r = 0; r < o.rows; r++) {
    for (let c = 0; c < o.cols; c++) {
      if (o.rng() < 0.12) continue; // some windows blanked (blinds / dark rooms)
      const x = c * (px / o.cols) + px / o.cols * 0.18;
      const y = r * cy + cy * 0.22;
      const w = (px / o.cols) * 0.64;
      const h = cy * 0.56;
      gc.fillStyle = o.glass;
      gc.fillRect(x, y, w, h);
      gc.strokeStyle = o.frame;
      gc.lineWidth = 2;
      gc.strokeRect(x, y, w, h);
      // horizontal dividing line for a second window row inside a floor
      if (o.rows > 1 && r < o.rows - 1) {
        gc.strokeStyle = o.frame;
        gc.globalAlpha = 0.6;
        gc.beginPath();
        gc.moveTo(x, y + h + cy * 0.06);
        gc.lineTo(x + w, y + h + cy * 0.06);
        gc.stroke();
        gc.globalAlpha = 1;
      }
      gg.fillStyle = o.glow;
      gg.globalAlpha = 0.5 + o.rng() * 0.5;
      gg.fillRect(x, y, w, h);
      gg.globalAlpha = 1;
    }
  }
  if (o.sign) {
    const sx = px / 2 - 90;
    const sy = px / 2 - 14;
    gc.fillStyle = "rgba(245,245,245,0.92)";
    gc.fillRect(sx, sy, 180, 28);
    gc.fillStyle = "#111";
    gc.font = "bold 17px sans-serif";
    gc.textAlign = "center";
    gc.fillText(o.sign, px / 2, sy + 20);
  }
  return {
    map: new THREE.CanvasTexture(color),
    glow: new THREE.CanvasTexture(glow),
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
}
function setupAmbient(scene: THREE.Scene, renderer: THREE.WebGLRenderer, c: AmbientCfg) {
  renderer.toneMappingExposure = c.exposure;
  const sunDir = new THREE.Vector3().setFromSphericalCoords(
    1,
    THREE.MathUtils.degToRad(90 - c.sunElev),
    THREE.MathUtils.degToRad(c.sunAzim),
  );
  const skyScene = new THREE.Scene();
  const sky = new Sky();
  sky.scale.setScalar(10000);
  const u = sky.material.uniforms;
  u["turbidity"].value = c.turbidity;
  u["rayleigh"].value = c.rayleigh;
  u["mieCoefficient"].value = 0.004;
  u["mieDirectionalG"].value = 0.82;
  u["sunPosition"].value.copy(sunDir);
  skyScene.add(sky);
  const cubeRT = new THREE.WebGLCubeRenderTarget(1024, { type: THREE.HalfFloatType });
  const cubeCam = new THREE.CubeCamera(1, 10000, cubeRT);
  cubeCam.update(renderer, skyScene);
  scene.background = cubeRT.texture;
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromCubemap(cubeRT.texture).texture;
  scene.environmentIntensity = c.envIntensity;
  scene.fog = new THREE.FogExp2(c.fogColor, c.fogDensity);

  let stars: THREE.Points | null = null;
  if (c.stars) {
    const starGeo = new THREE.BufferGeometry();
    const n = 2600;
    const pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const v = new THREE.Vector3().setFromSphericalCoords(1, Math.random() * 0.9, Math.random() * Math.PI * 2);
      v.multiplyScalar(2200 + Math.random() * 1500);
      pos[i * 3] = v.x;
      pos[i * 3 + 1] = Math.abs(v.y) * 0.8 + 40;
      pos[i * 3 + 2] = v.z;
    }
    starGeo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    stars = new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0xdfe8ff, size: 2.4, sizeAttenuation: false, transparent: true, opacity: 0.9, fog: false }));
  }

  const sun = new THREE.DirectionalLight(c.sunColor, c.sunIntensity);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const sc = sun.shadow.camera;
  sc.left = -22;
  sc.right = 22;
  sc.top = 22;
  sc.bottom = -22;
  sc.near = 1;
  sc.far = c.shadowFar ?? 90;
  sun.shadow.bias = -0.0003;
  sun.shadow.normalBias = 0.03;
  sun.shadow.radius = 2.5;

  const hemi = new THREE.HemisphereLight(c.hemiSky, c.hemiGround, c.hemiIntensity);

  const update = (_dt: number, focus: THREE.Vector3) => {
    sun.position.copy(focus).addScaledVector(sunDir, 45);
    sun.target.position.copy(focus);
  };
  return { sun, hemi, stars, sunDir, update };
}

/* ====================== kit ====================== */
interface Beacon {
  mesh: THREE.Mesh;
  speed: number;
  phase: number;
}

class Kit {
  colliders: THREE.Object3D[] = [];
  aabbs: THREE.Box3[] = [];
  destroyables: THREE.Mesh[] = [];
  beacons: Beacon[] = [];
  extras: { update: (dt: number) => void }[] = [];
  rng: () => number;
  scene: THREE.Object3D;

  constructor(scene: THREE.Object3D, seed: number) {
    this.scene = scene;
    this.rng = mulberry32(seed);
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
    const m = new THREE.MeshStandardMaterial({
      map: f.map.clone(),
      bumpMap: f.map.clone(),
      bumpScale: 0.06,
      roughness: 0.85,
      metalness: 0.02,
      emissive: 0xffffff,
      emissiveMap: f.glow.clone(),
      emissiveIntensity: emissive,
    });
    const repX = Math.max(1, lenH / f.tileW);
    const repY = Math.max(1, h / f.tileH);
    for (const tx of [m.map, m.bumpMap, m.emissiveMap] as THREE.Texture[]) {
      tx!.wrapS = tx!.wrapT = THREE.RepeatWrapping;
      tx!.repeat.set(repX, repY);
      tx!.needsUpdate = true;
    }
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
    // hidden collision box (identical AABB to before — gameplay unchanged)
    const collider = this.box(this.wallFaceMat(o.facade, w, h, o.emissive ?? 0), w, colH, d, x, 0, z, ry);
    this.solid(collider);
    if (colH < h) {
      // trim collider so rooftop combat works (raycast gap at roofline)
      const last = this.aabbs[this.aabbs.length - 1];
      last.max.y = colH;
    }
    // visual shell (non-colliding) in a rotated group; outer faces flush with the collider
    const g = new THREE.Group();
    g.position.set(x, 0, z);
    g.rotation.y = ry;
    this.scene.add(g);
    // four wall faces, each tiled to its own length so bays line up at corners
    for (const sz of [-1, 1]) {
      const m = this.mesh(this.wallFaceMat(o.facade, w, h, o.emissive ?? 0), new THREE.BoxGeometry(w, h, t), 0, h / 2, sz * (d / 2 - t / 2), 0);
      g.add(m);
    }
    for (const sx of [-1, 1]) {
      const m = this.mesh(this.wallFaceMat(o.facade, d, h, o.emissive ?? 0), new THREE.BoxGeometry(t, h, d), sx * (w / 2 - t / 2), h / 2, 0, 0);
      g.add(m);
    }
    // corner quoins (protrude slightly, hide face seams)
    const quoinMat = new THREE.MeshStandardMaterial({ color: 0x5a5550, roughness: 0.9 });
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const q = this.mesh(quoinMat, new RoundedBoxGeometry(t * 1.15, h, t * 1.15, 2, 0.03), sx * (w / 2 + t * 0.28), h / 2, sz * (d / 2 + t * 0.28), 0);
        g.add(q);
      }
    }
    // plinth band around the base
    const plinthMat = new THREE.MeshStandardMaterial({ color: 0x4a4640, roughness: 0.92 });
    for (const sz of [-1, 1]) {
      const p = this.mesh(plinthMat, new RoundedBoxGeometry(w + 0.1, 0.5, t + 0.12, 3, 0.04), 0, 0.25, sz * (d / 2 + 0.04), 0);
      g.add(p);
    }
    for (const sx of [-1, 1]) {
      const p = this.mesh(plinthMat, new RoundedBoxGeometry(t + 0.12, 0.5, d + 0.1, 3, 0.04), sx * (w / 2 + 0.04), 0.25, 0, 0);
      g.add(p);
    }
    // floor-line bands (sill/lintel courses) at each floor level
    const floorH = o.facade.tileH / o.facade.rows;
    const bandMat = new THREE.MeshStandardMaterial({ color: 0x8a8580, roughness: 0.9 });
    for (let k = 1; k * floorH < h - 0.2; k++) {
      for (const sz of [-1, 1]) {
        const b = this.mesh(bandMat, new RoundedBoxGeometry(w + 0.08, 0.14, t + 0.1, 2, 0.02), 0, k * floorH, sz * (d / 2 + 0.03), 0);
        g.add(b);
      }
      for (const sx of [-1, 1]) {
        const b = this.mesh(bandMat, new RoundedBoxGeometry(t + 0.1, 0.14, d + 0.08, 2, 0.02), sx * (w / 2 + 0.03), k * floorH, 0, 0);
        g.add(b);
      }
    }
    if (o.roof !== "none") this.roof(x, z, w, d, h, o.roof ?? "flat", o.roofMat);
    if (o.parapet) this.parapet(x, z, w, d, h, o.roofMat);
    if (o.details) this.roofDetails(x, z, w, d, h, o.roofMat);
    return collider;
  }

  /* hollow building with a doorway on the +z face — player can walk inside.
     Walls are separate solid segments so the interior is open; the rooftop stays
     walkable (short collider) for rooftop combat. */
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
    emissive?: number;
    ry?: number;
    inner?: THREE.Material;
  }) {
    const { x, z, w, d, h } = o;
    const t = 0.3;
    const doorW = o.doorW ?? 1.8;
    const doorH = o.doorH ?? 2.4;
    const ry = o.ry ?? 0;
    const em = o.emissive ?? 0;
    const wallNorth = this.wallFaceMat(o.facade, w, h, em);
    const wallSouth = this.wallFaceMat(o.facade, w, h, em);
    const wallSide = this.wallFaceMat(o.facade, d - 2 * t, h, em);
    const wallDoor = this.wallFaceMat(o.facade, w, h, em);

    // north + south walls (full span, along X)
    this.solid(this.box(wallNorth, w, h, t, x, 0, z - d / 2, ry), "concrete");
    this.solid(this.box(wallSouth, w, h, t, x, 0, z + d / 2, ry), "concrete");
    // west + east walls (along Z)
    const sideSpan = d - 2 * t;
    const doorInset = doorW / 2 + t;
    for (const sx of [-1, 1]) {
      const cx = x + sx * (w / 2);
      this.solid(this.box(wallSide, t, h, sideSpan, cx, 0, z, ry), "concrete");
    }
    // lintel above the door on the south wall (keeps the opening head solid)
    this.solid(this.box(wallDoor, doorW, h - doorH, t, x, 0, z + d / 2, ry), "concrete");
    // door reveal on the south wall (two jamb returns)
    for (const sx of [-1, 1]) {
      this.solid(this.box(wallDoor, doorW / 2, doorH, t, x + sx * doorInset, 0, z + d / 2, ry), "concrete");
    }

    // exterior trim: plinth + floor bands (visual only)
    const g = new THREE.Group();
    g.position.set(x, 0, z);
    g.rotation.y = ry;
    this.scene.add(g);
    const plinthMat = new THREE.MeshStandardMaterial({ color: 0x4a4640, roughness: 0.92 });
    const bandMat = new THREE.MeshStandardMaterial({ color: 0x8a8580, roughness: 0.9 });
    const floorH = o.facade.tileH / o.facade.rows;
    for (const sz of [-1, 1]) {
      const p = this.mesh(plinthMat, new RoundedBoxGeometry(w + 0.1, 0.5, t + 0.12, 3, 0.04), 0, 0.25, sz * (d / 2 + 0.04), 0);
      g.add(p);
    }
    for (const sx of [-1, 1]) {
      const p = this.mesh(plinthMat, new RoundedBoxGeometry(t + 0.12, 0.5, d + 0.1, 3, 0.04), sx * (w / 2 + 0.04), 0.25, 0, 0);
      g.add(p);
    }
    for (let k = 1; k * floorH < h - 0.2; k++) {
      for (const sz of [-1, 1]) {
        const b = this.mesh(bandMat, new RoundedBoxGeometry(w + 0.08, 0.14, t + 0.1, 2, 0.02), 0, k * floorH, sz * (d / 2 + 0.03), 0);
        g.add(b);
      }
      for (const sx of [-1, 1]) {
        const b = this.mesh(bandMat, new RoundedBoxGeometry(t + 0.1, 0.14, d + 0.08, 2, 0.02), sx * (w / 2 + 0.03), k * floorH, 0, 0);
        g.add(b);
      }
    }
    // door frame (trim around the doorway on the outside)
    const frameMat = new THREE.MeshStandardMaterial({ color: 0x3a3328, roughness: 0.9 });
    g.add(this.mesh(frameMat, new RoundedBoxGeometry(doorW + 0.2, 0.14, 0.14, 2, 0.03), 0, doorH + 0.07, d / 2 + 0.07, 0));
    for (const sx of [-1, 1]) {
      g.add(this.mesh(frameMat, new RoundedBoxGeometry(0.14, doorH + 0.2, 0.14, 2, 0.03), sx * (doorW / 2 + 0.07), (doorH + 0.2) / 2, d / 2 + 0.07, 0));
    }

    // interior floor slab (visual + walkable top)
    const innerMat = o.inner ?? new THREE.MeshStandardMaterial({ color: 0x6b6258, roughness: 0.95 });
    const floor = this.box(innerMat, w - 2 * t, 0.12, d - 2 * t, x, 0.06, z, ry);
    floor.receiveShadow = true;
    this.scene.add(floor);
    this.colliders.push(floor);
    this.aabbs.push(new THREE.Box3().setFromObject(floor));
    // floor plank lines
    const plankMat = new THREE.MeshStandardMaterial({ color: 0x4a3f33, roughness: 0.95 });
    for (let px = -(w - 2 * t) / 2 + 0.5; px < (w - 2 * t) / 2; px += 0.7) {
      const pl = this.mesh(plankMat, new THREE.BoxGeometry(0.03, 0.01, d - 2 * t - 0.2), x + px, 0.19, z, ry);
      this.scene.add(pl);
    }

    // interior wall liners (hide mirrored facade texture from inside)
    const linerMat = new THREE.MeshStandardMaterial({ color: 0x2a2622, roughness: 0.95 });
    const linerH = h - 0.15;
    const innerW = w - 2 * t - 0.1;
    const innerD = d - 2 * t - 0.1;
    const addLiner = (lx: number, lz: number, lw: number, ld: number) => {
      const ln = this.mesh(linerMat, new THREE.BoxGeometry(lw, linerH, ld), lx, linerH / 2 + 0.08, lz, ry);
      this.scene.add(ln);
    };
    addLiner(x, z - d / 2 + t / 2 - 0.05, innerW, 0.08); // north
    addLiner(x, z + d / 2 - t / 2 - 0.05, innerW, 0.08); // south (behind door — mostly covered by door threshold)
    for (const sx of [-1, 1]) addLiner(x + sx * (w / 2 - t / 2 - 0.05), z, 0.08, innerD); // east/west

    // interior furniture (visual only — placed clear of the doorway path)
    const furnMat = new THREE.MeshStandardMaterial({ color: 0x5a4a38, roughness: 0.9 });
    const crateMat = new THREE.MeshStandardMaterial({ color: 0x6a5438, roughness: 0.92 });
    const ix = x, iz = z - d * 0.24;
    // table
    this.scene.add(this.mesh(furnMat, new RoundedBoxGeometry(1.3, 0.08, 0.75, 3, 0.02), ix, 0.95, iz, ry));
    for (const [dx, dz] of [[-0.55, -0.28], [0.55, -0.28], [-0.55, 0.28], [0.55, 0.28]]) {
      this.scene.add(this.mesh(furnMat, new THREE.BoxGeometry(0.07, 0.9, 0.07), ix + dx, 0.49, iz + dz, ry));
    }
    // crates
    for (const [cx, cz, s] of [[ix - 1.1, iz + 0.3, 0.6], [ix + 1.1, iz + 0.35, 0.5]]) {
      this.scene.add(this.mesh(crateMat, new RoundedBoxGeometry(s, s, s, 3, 0.05), cx, s / 2 + 0.12, cz, ry + 0.2));
    }
    // shelf unit against the north wall
    this.scene.add(this.mesh(furnMat, new RoundedBoxGeometry(1.6, 1.6, 0.4, 3, 0.04), ix + 0.6, 0.9, z - d / 2 + 0.5, ry));
    for (const sy of [0.5, 1.0, 1.5]) {
      this.scene.add(this.mesh(furnMat, new THREE.BoxGeometry(1.5, 0.05, 0.38), ix + 0.6, sy, z - d / 2 + 0.5, ry));
    }
    // hanging lamp
    const lampRod = this.mesh(new THREE.MeshStandardMaterial({ color: 0x2a2a2a, roughness: 0.7, metalness: 0.8 }), new THREE.CylinderGeometry(0.02, 0.02, 0.7, 6), ix - 0.4, h - 0.35, iz + 0.2, ry);
    this.scene.add(lampRod);
    const lamp = this.mesh(new THREE.MeshStandardMaterial({ color: 0xffe9b0, emissive: 0xffd98a, emissiveIntensity: 1.6, roughness: 0.6 }), new THREE.SphereGeometry(0.14, 12, 10), ix - 0.4, h - 0.75, iz + 0.2, ry);
    this.scene.add(lamp);
    // rug
    const rug = this.mesh(new THREE.MeshStandardMaterial({ color: 0x7a3a30, roughness: 0.95 }), new THREE.PlaneGeometry(1.8, 1.2), ix, 0.205, iz, ry);
    rug.rotation.x = -Math.PI / 2;
    this.scene.add(rug);

    // door threshold (visual)
    const door = this.box(new THREE.MeshStandardMaterial({ color: 0x3a2a1a, roughness: 0.9 }), doorW, doorH, 0.08, x, 0, z + d / 2 + 0.02, ry);
    this.scene.add(door);

    if (o.roof !== "none") this.roof(x, z, w, d, h, o.roof ?? "flat", o.roofMat);
    return { x, z, w, d, h };
  }

  /** 3D window frames (+ optional shutters) on all four faces, aligned to the
      facade's bay grid so frames sit exactly on the textured windows */
  windowTrim(o: {
    x: number; z: number; w: number; d: number; h: number;
    bayW: number; floorH: number; rows: number; cols: number;
    ry: number; frameMat: THREE.Material; shutterMat: THREE.Material | null;
  }) {
    const { x, z, w, d, h, bayW, floorH, rows, cols, ry } = o;
    const tileW = bayW * cols;
    const tileH = floorH * rows;
    // vertical mapping (same for all faces)
    const clampY = h < tileH;
    const rowCount = clampY ? rows : Math.max(1, Math.floor(h / floorH));
    const winY = (row: number) => (row + 0.5) * (clampY ? h / rows : floorH);
    const winH = (clampY ? h / rows : floorH) * 0.56;
    const g = new THREE.Group();
    g.position.set(x, 0, z);
    g.rotation.y = ry;
    this.scene.add(g);
    const face = (alongX: boolean, sign: number, len: number) => {
      const clampX = len < tileW;
      const nWin = clampX ? cols : Math.max(1, Math.floor(len / bayW));
      const winW = (clampX ? len / cols : bayW) * 0.64;
      for (let m = 0; m < nWin; m++) {
        const p = (m + 0.5) * (clampX ? len / cols : bayW);
        for (let row = 0; row < rowCount; row++) {
          const wy = winY(row);
          if (alongX) {
            g.add(this.mesh(o.frameMat, new RoundedBoxGeometry(winW + 0.14, winH + 0.14, 0.1, 2, 0.02), sign * p, wy, d / 2 + 0.05, 0));
          } else {
            g.add(this.mesh(o.frameMat, new RoundedBoxGeometry(0.1, winH + 0.14, winW + 0.14, 2, 0.02), w / 2 + 0.05, wy, sign * p, 0));
          }
          if (o.shutterMat) {
            const off = winW / 2 + 0.06;
            if (alongX) {
              g.add(this.mesh(o.shutterMat, new RoundedBoxGeometry(0.07, winH + 0.06, 0.06, 2, 0.02), sign * (p - off), wy, d / 2 + 0.08, 0));
              g.add(this.mesh(o.shutterMat, new RoundedBoxGeometry(0.07, winH + 0.06, 0.06, 2, 0.02), sign * (p + off), wy, d / 2 + 0.08, 0));
            } else {
              g.add(this.mesh(o.shutterMat, new RoundedBoxGeometry(0.06, winH + 0.06, 0.07, 2, 0.02), w / 2 + 0.08, wy, sign * (p - off), 0));
              g.add(this.mesh(o.shutterMat, new RoundedBoxGeometry(0.06, winH + 0.06, 0.07, 2, 0.02), w / 2 + 0.08, wy, sign * (p + off), 0));
            }
          }
        }
      }
    };
    face(true, 1, w);
    face(true, -1, w);
    face(false, 1, d);
    face(false, -1, d);
    return g;
  }

  /* flight of steps ascending along +X (or +Z when alongZ). Each step is a solid
     block; the player auto-steps up the risers (see resolveCircleAABBs + groundHeightAt). */
  stairs(o: {
    x: number;
    z: number;
    steps: number;
    rise: number;
    run: number;
    width: number;
    alongZ?: boolean;
    mat: THREE.Material;
    sideMat?: THREE.Material;
  }) {
    const { x, z, steps, rise, run, width } = o;
    const alongZ = o.alongZ ?? false;
    const stepMat = o.mat;
    const sideMat = o.sideMat ?? stepMat;
    for (let i = 0; i < steps; i++) {
      const h = (i + 1) * rise;
      const off = i * run;
      const m = this.mesh(stepMat, new RoundedBoxGeometry(alongZ ? width : run, h, alongZ ? run : width, 3, Math.min(0.05, h / 3)), x + (alongZ ? 0 : off), h / 2, z + (alongZ ? off : 0), 0);
      m.castShadow = true;
      m.receiveShadow = true;
      this.solid(m, "concrete");
      // riser facing the ascending direction (visual highlight on the front face)
      const fm = this.mesh(sideMat, new RoundedBoxGeometry(alongZ ? width : run, 0.06, 0.12, 2, 0.02), x + (alongZ ? 0 : off), h - 0.03, z + (alongZ ? off : 0) + (alongZ ? 0 : run / 2 - 0.06), 0);
      fm.castShadow = true;
      this.scene.add(fm);
    }
    // handrail: posts + continuous top rail + mid rail
    const railMat = new THREE.MeshStandardMaterial({ color: 0x2a2d30, roughness: 0.6, metalness: 0.8 });
    const rSeg = 20;
    for (let i = 0; i <= steps; i++) {
      const h = i * rise + 0.9;
      const off = i * run;
      const post = this.mesh(railMat, new THREE.CylinderGeometry(0.04, 0.04, 0.9, rSeg, 3), x + (alongZ ? 0 : off) + width / 2 + 0.2, h - 0.45, z + (alongZ ? off : 0), 0);
      post.castShadow = true;
      this.scene.add(post);
    }
    // continuous rail bar along the top of the posts
    const railLen = steps * run;
    const railBar = this.mesh(railMat, new THREE.CylinderGeometry(0.025, 0.025, railLen, rSeg, 3), x + width / 2 + 0.2, steps * rise / 2 + 0.9, z + (alongZ ? 0 : 0) + (alongZ ? railLen / 2 : 0), 0);
    if (!alongZ) {
      railBar.rotation.z = Math.PI / 2;
      railBar.position.x = x + width / 2 + 0.2;
      railBar.position.z = steps * run / 2;
    } else {
      railBar.rotation.x = Math.PI / 2;
      railBar.position.x = x + width / 2 + 0.2;
      railBar.position.z = z + railLen / 2;
    }
    railBar.castShadow = true;
    this.scene.add(railBar);
  }

  roof(x: number, z: number, w: number, d: number, h: number, kind: string, mat: THREE.Material) {
    const fasciaMat = new THREE.MeshStandardMaterial({ color: 0x3a3a40, roughness: 0.8, metalness: 0.4 });
    if (kind === "flat") {
      // gravel membrane slab + raised cap + eave fascia on ALL four sides
      const rm = this.roofSurfaceMat(mat, this.pTex("gravel", () => gravelTex(256, this.rng)), [Math.max(1, w / 5), Math.max(1, d / 5)]);
      this.scene.add(this.mesh(rm, new RoundedBoxGeometry(w + 0.6, 0.4, d + 0.6, 4, 0.1), x, h + 0.2, z));
      this.scene.add(this.mesh(rm, new RoundedBoxGeometry(w + 0.3, 0.12, d + 0.3, 3, 0.04), x, h + 0.42, z));
      for (const sz of [-1, 1]) this.scene.add(this.mesh(fasciaMat, new RoundedBoxGeometry(w + 0.66, 0.16, 0.18, 3, 0.03), x, h + 0.1, z + sz * (d / 2 + 0.32)));
      for (const sx of [-1, 1]) this.scene.add(this.mesh(fasciaMat, new RoundedBoxGeometry(0.18, 0.16, d + 0.66, 3, 0.03), x + sx * (w / 2 + 0.32), h + 0.1, z));
    } else if (kind === "tile") {
      // pitched tile roof: shape x-axis = depth (world Z via 90° rotation),
      // extruded along the width (world X). Ridge runs along Z.
      const rise = Math.min(2.2, d * 0.35);
      const shape = new THREE.Shape();
      shape.moveTo(-d / 2 - 0.4, 0);
      shape.lineTo(d / 2 + 0.4, 0);
      shape.lineTo(d / 2, rise);
      shape.lineTo(-d / 2, rise);
      shape.closePath();
      const g = new THREE.ExtrudeGeometry(shape, { depth: w, bevelEnabled: true, bevelThickness: 0.04, bevelSize: 0.04, bevelSegments: 2 });
      g.translate(0, -rise / 2, -w / 2);
      const rm = this.roofSurfaceMat(mat, this.pTex("tile", () => tileTex(256, this.rng)), [1, 1]);
      const m = this.mesh(rm, g, x, h + rise / 2, z);
      m.rotation.y = Math.PI / 2;
      this.scene.add(m);
      // eave fascia along the two long eaves (world x sides)
      for (const sx of [-1, 1]) this.scene.add(this.mesh(fasciaMat, new RoundedBoxGeometry(0.24, 0.24, d + 0.8, 3, 0.04), x + sx * (w / 2 + 0.2), h + 0.08, z));
      // gable-end trim (extrusion ends at world x) framing the trapezoid ends
      for (const sx of [-1, 1]) this.scene.add(this.mesh(fasciaMat, new RoundedBoxGeometry(0.2, rise + 0.2, d + 0.8, 3, 0.04), x + sx * (w / 2 + 0.1), h + rise / 2, z));
      // ridge cap + rolls at the ridge ends
      const ridge = new THREE.MeshStandardMaterial({ color: 0x6a2a1a, roughness: 0.9 });
      this.scene.add(this.mesh(ridge, new RoundedBoxGeometry(0.28, 0.16, d + 0.4, 3, 0.04), x, h + rise + 0.05, z));
      for (const sz of [-1, 1]) {
        const roll = this.mesh(ridge, new THREE.CylinderGeometry(0.16, 0.16, 0.4, 16), x, h + rise + 0.05, z + sz * (d / 2 + 0.2));
        roll.rotation.x = Math.PI / 2;
        this.scene.add(roll);
      }
      this.chimney(x, z, w, d, h, rise);
    } else if (kind === "gable") {
      // pitched slate roof, same orientation fix as tile
      const rise = Math.min(3.2, d * 0.45);
      const shape = new THREE.Shape();
      shape.moveTo(-d / 2 - 0.4, 0);
      shape.lineTo(d / 2 + 0.4, 0);
      shape.lineTo(d / 2, rise);
      shape.lineTo(-d / 2, rise);
      shape.closePath();
      const g = new THREE.ExtrudeGeometry(shape, { depth: w, bevelEnabled: true, bevelThickness: 0.05, bevelSize: 0.05, bevelSegments: 2 });
      g.translate(0, -rise / 2, -w / 2);
      const rm = this.roofSurfaceMat(mat, this.pTex("slate", () => slateTex(256, this.rng)), [1, 1]);
      const m = this.mesh(rm, g, x, h + rise / 2, z);
      m.rotation.y = Math.PI / 2;
      this.scene.add(m);
      for (const sx of [-1, 1]) this.scene.add(this.mesh(fasciaMat, new RoundedBoxGeometry(0.26, 0.26, d + 0.8, 3, 0.04), x + sx * (w / 2 + 0.2), h + 0.08, z));
      for (const sx of [-1, 1]) this.scene.add(this.mesh(fasciaMat, new RoundedBoxGeometry(0.22, rise + 0.2, d + 0.8, 3, 0.04), x + sx * (w / 2 + 0.1), h + rise / 2, z));
      const ridge = new THREE.MeshStandardMaterial({ color: 0x4a4a50, roughness: 0.85 });
      this.scene.add(this.mesh(ridge, new RoundedBoxGeometry(0.3, 0.34, d + 0.5, 3, 0.05), x, h + rise + 0.08, z));
      for (const sz of [-1, 1]) {
        const roll = this.mesh(ridge, new THREE.CylinderGeometry(0.18, 0.18, 0.44, 16), x, h + rise + 0.08, z + sz * (d / 2 + 0.25));
        roll.rotation.x = Math.PI / 2;
        this.scene.add(roll);
      }
      this.chimney(x, z, w, d, h, rise);
    } else { // metal: shallow pitched corrugated sheet + eave trim
      const rm = this.roofSurfaceMat(mat, this.pTex("corr", () => corrugTex(256, this.rng)), [Math.max(1, w / 3), Math.max(1, d / 3)]);
      this.scene.add(this.mesh(rm, new RoundedBoxGeometry(w + 0.5, 0.25, d + 0.5, 4, 0.06), x, h + 0.05 + 0.125, z));
      for (const sz of [-1, 1]) this.scene.add(this.mesh(fasciaMat, new RoundedBoxGeometry(w + 0.54, 0.16, 0.16, 3, 0.03), x, h + 0.1, z + sz * (d / 2 + 0.28)));
      for (const sx of [-1, 1]) this.scene.add(this.mesh(fasciaMat, new RoundedBoxGeometry(0.16, 0.16, d + 0.54, 3, 0.03), x + sx * (w / 2 + 0.28), h + 0.1, z));
      const ridge = new THREE.MeshStandardMaterial({ color: 0x5a5a60, roughness: 0.7, metalness: 0.6 });
      this.scene.add(this.mesh(ridge, new THREE.CylinderGeometry(0.1, 0.1, d + 0.5, 18), x, h + 0.25, z, Math.PI / 2));
    }
  }

  /** chimney on a pitched roof (sits on the roof's flat top strip) */
  chimney(x: number, z: number, w: number, d: number, h: number, rise: number) {
    const cx = x + (this.rng() - 0.5) * w * 0.4;
    const cz = z + (this.rng() - 0.5) * d * 0.3;
    const chim = new THREE.MeshStandardMaterial({ color: 0x7a5a48, roughness: 0.95 });
    this.scene.add(this.mesh(chim, new RoundedBoxGeometry(0.5, 1.7, 0.5, 3, 0.08), cx, h + rise + 0.95, cz));
    this.scene.add(this.mesh(chim, new RoundedBoxGeometry(0.62, 0.12, 0.62, 3, 0.03), cx, h + rise + 1.81, cz));
  }

  parapet(x: number, z: number, w: number, d: number, h: number, mat: THREE.Material) {
    const t = 0.25;
    const H = 0.9;
    // sits on the roof slab edge (slab overhangs the walls by ~0.3)
    const ox = w / 2 + 0.25;
    const oz = d / 2 + 0.25;
    // rounded merlon caps along the long edges
    const cap = new THREE.MeshStandardMaterial({ color: 0x6a6a70, roughness: 0.85 });
    // long sides (along z)
    this.scene.add(this.mesh(mat, new RoundedBoxGeometry(t, H, d + 0.5, 3, 0.05), x - ox, h - 0.2 + H / 2, z));
    this.scene.add(this.mesh(mat, new RoundedBoxGeometry(t, H, d + 0.5, 3, 0.05), x + ox, h - 0.2 + H / 2, z));
    // short sides (along x)
    this.scene.add(this.mesh(mat, new RoundedBoxGeometry(w + 0.5, H, t, 3, 0.05), x, h - 0.2 + H / 2, z - oz));
    this.scene.add(this.mesh(mat, new RoundedBoxGeometry(w + 0.5, H, t, 3, 0.05), x, h - 0.2 + H / 2, z + oz));
    // crenellated cap stones on the two long sides
    const step = 1.2;
    const n = Math.max(1, Math.floor((d + 0.5) / step));
    for (let i = 0; i <= n; i++) {
      const zc = z - (d + 0.5) / 2 + i * step;
      this.scene.add(this.mesh(cap, new RoundedBoxGeometry(t + 0.14, 0.16, step * 0.6, 3, 0.03), x - ox, h + H - 0.04, zc));
      this.scene.add(this.mesh(cap, new RoundedBoxGeometry(t + 0.14, 0.16, step * 0.6, 3, 0.03), x + ox, h + H - 0.04, zc));
    }
  }

  roofDetails(x: number, z: number, w: number, d: number, h: number, mat: THREE.Material) {
    const r = this.rng;
    // detailed AC units
    const acCount = 1 + Math.floor(r() * 2);
    for (let i = 0; i < acCount; i++) {
      this.acUnit(x + (r() - 0.5) * w * 0.6, z + (r() - 0.5) * d * 0.6, h, r() * Math.PI);
    }
    // water tank: legs + cylindrical body + conical top
    if (r() < 0.5) {
      const tx = x + (r() - 0.5) * w * 0.5;
      const tz = z + (r() - 0.5) * d * 0.5;
      const tankMat = new THREE.MeshStandardMaterial({ color: 0x8a8f96, roughness: 0.5, metalness: 0.7 });
      for (const [lx, lz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
        const leg = this.mesh(tankMat, new THREE.CylinderGeometry(0.08, 0.08, 0.6, 8), tx + lx * 0.6, h + 0.3, tz + lz * 0.6);
        this.scene.add(leg);
      }
      const tank = this.mesh(tankMat, new THREE.CylinderGeometry(0.8, 0.8, 1.4, 20), tx, h + 1.3, tz);
      this.scene.add(tank);
      const top = this.mesh(new THREE.MeshStandardMaterial({ color: 0x5a5f66, roughness: 0.6, metalness: 0.6 }), new THREE.ConeGeometry(0.85, 0.4, 20), tx, h + 2.1, tz);
      this.scene.add(top);
    }
    // antenna mast with crossbar
    if (r() < 0.6) {
      const ax = x + (r() - 0.5) * w * 0.4;
      const az = z + (r() - 0.5) * d * 0.4;
      const mastH = 2 + r() * 2;
      const mast = this.mesh(mat, new THREE.CylinderGeometry(0.04, 0.05, mastH, 8), ax, h + mastH / 2, az);
      this.scene.add(mast);
      const bar = this.mesh(mat, new THREE.CylinderGeometry(0.02, 0.02, 0.8, 6), ax, h + mastH * 0.7, az);
      bar.rotation.z = Math.PI / 2;
      this.scene.add(bar);
    }
  }

  /* ---------------- props ---------------- */
  crate(mat: THREE.Material, x: number, z: number, s: number, ry = 0, y = 0) {
    // collision = plain box (stable AABB); visual = rounded box + metal banding
    const col = this.solid(this.box(mat, s, s, s, x, y, z, ry), "wood");
    const vis = this.mesh(
      mat,
      new RoundedBoxGeometry(s, s, s, 4, Math.min(0.08, s / 5)),
      x,
      y + s / 2,
      z,
      ry,
    );
    vis.castShadow = true;
    vis.receiveShadow = true;
    this.scene.add(vis);
    // corner posts
    const postMat = new THREE.MeshStandardMaterial({ color: 0x3a2a16, roughness: 0.85 });
    const pr = s * 0.1;
    for (const [px, pz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      const p = this.mesh(postMat, new THREE.CylinderGeometry(pr, pr, s * 1.04, 10), x + px * (s / 2 - pr * 0.6), y + s / 2, z + pz * (s / 2 - pr * 0.6), ry);
      this.scene.add(p);
    }
    // horizontal metal straps
    const strapMat = new THREE.MeshStandardMaterial({ color: 0x6a6a6e, roughness: 0.5, metalness: 0.8 });
    for (const sy of [y + s * 0.28, y + s * 0.72]) {
      const band = this.mesh(strapMat, new THREE.BoxGeometry(s + 0.04, s * 0.05, s + 0.04), x, sy, z, ry);
      band.castShadow = true;
      this.scene.add(band);
    }
    return col;
  }

  barrel(mat: THREE.Material, x: number, z: number, color = 0x9b2c22) {
    const m = this.solid(
      this.mesh(mat, new THREE.CylinderGeometry(0.3, 0.3, 0.9, 40), x, 0.45, z),
      "metal",
    );
    const ringMat = new THREE.MeshStandardMaterial({ color, roughness: 0.5, metalness: 0.7 });
    // steel hoops (more, finer) + rims
    [-0.3, -0.13, 0.04, 0.21, 0.34].forEach((y) => {
      const r = new THREE.Mesh(new THREE.TorusGeometry(0.304, 0.014, 12, 40), ringMat);
      r.rotation.x = Math.PI / 2;
      r.position.y = y;
      m.add(r);
    });
    // chime ring at the top + base ring
    [0.36, -0.36].forEach((y) => {
      const r = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.022, 12, 40), new THREE.MeshStandardMaterial({ color: 0x8a8a8e, roughness: 0.4, metalness: 0.85 }));
      r.rotation.x = Math.PI / 2;
      r.position.y = y;
      m.add(r);
    });
    // bung cap on the side
    const bung = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.05, 16), new THREE.MeshStandardMaterial({ color: 0x2a2a2a, roughness: 0.6, metalness: 0.7 }));
    bung.position.set(0.3, 0.2, 0);
    m.add(bung);
  }

  sandbag(x: number, z: number, ry = 0, count = 5) {
    const mat = new THREE.MeshStandardMaterial({ color: 0x8d8163, roughness: 0.95 });
    for (let i = 0; i < count; i++) {
      const col = Math.floor(i / 3);
      const b = this.mesh(mat, new RoundedBoxGeometry(0.65, 0.28, 0.35, 4, 0.08), x + (i % 3) * 0.55 - 0.55, 0.12 + col * 0.28, z, ry);
      b.castShadow = true;
      b.receiveShadow = true;
      this.scene.add(b);
      // stitching seam for detail
      const seam = this.mesh(new THREE.MeshStandardMaterial({ color: 0x5a5240, roughness: 1 }), new THREE.BoxGeometry(0.6, 0.012, 0.3), 0, 0, 0, 0);
      b.add(seam);
    }
  }

  car(x: number, z: number, ry = 0, color = 0x2e5a8c, scale = 1) {
    const body = new THREE.MeshStandardMaterial({ color, roughness: 0.4, metalness: 0.5 });
    const glass = new THREE.MeshStandardMaterial({ color: 0x14181c, roughness: 0.15, metalness: 0.9 });
    const tire = new THREE.MeshStandardMaterial({ color: 0x111, roughness: 0.9 });
    const chrome = new THREE.MeshStandardMaterial({ color: 0x9aa0a8, roughness: 0.3, metalness: 0.95 });
    const grp = new THREE.Group();
    grp.position.set(x, 0, z);
    grp.rotation.y = ry;
    // lower body (rounded)
    const b = new THREE.Mesh(new RoundedBoxGeometry(2 * scale, 0.7 * scale, 4.6 * scale, 4, 0.12 * scale), body);
    b.position.y = 0.55 * scale;
    b.castShadow = true;
    grp.add(b);
    // upper cabin glass (rounded)
    const c = new THREE.Mesh(new RoundedBoxGeometry(1.7 * scale, 0.65 * scale, 2.2 * scale, 4, 0.1 * scale), glass);
    c.position.y = 1.1 * scale;
    c.position.z = -0.1 * scale;
    c.castShadow = true;
    grp.add(c);
    // roof + door cut lines
    const roof = new THREE.Mesh(new RoundedBoxGeometry(1.75 * scale, 0.06 * scale, 2.25 * scale, 3, 0.02 * scale), body);
    roof.position.y = 1.42 * scale;
    roof.position.z = -0.1 * scale;
    grp.add(roof);
    for (const sx of [-0.45, 0.45]) {
      const line = new THREE.Mesh(new THREE.BoxGeometry(0.02 * scale, 0.5 * scale, 2.2 * scale), new THREE.MeshStandardMaterial({ color: 0x0a0a0a, roughness: 0.6 }));
      line.position.set(sx * scale, 0.95 * scale, -0.1 * scale);
      grp.add(line);
    }
    // headlights + taillights
    const lightMat = new THREE.MeshStandardMaterial({ color: 0xfff4c0, emissive: 0xfff0b0, emissiveIntensity: 0.6 });
    const tailMat = new THREE.MeshStandardMaterial({ color: 0xff2222, emissive: 0xcc1111, emissiveIntensity: 0.5 });
    for (const sx of [-0.7, 0.7]) {
      const hl = new THREE.Mesh(new THREE.BoxGeometry(0.28 * scale, 0.14 * scale, 0.08 * scale), lightMat);
      hl.position.set(sx * scale, 0.62 * scale, 2.3 * scale);
      grp.add(hl);
      const tl = new THREE.Mesh(new THREE.BoxGeometry(0.26 * scale, 0.13 * scale, 0.08 * scale), tailMat);
      tl.position.set(sx * scale, 0.62 * scale, -2.3 * scale);
      grp.add(tl);
    }
    // mirrors
    for (const sx of [-1, 1]) {
      const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.03 * scale, 0.03 * scale, 0.22 * scale, 10), chrome);
      arm.rotation.z = Math.PI / 2;
      arm.position.set(sx * (1.0 * scale), 1.05 * scale, 0.5 * scale);
      grp.add(arm);
      const cap = new THREE.Mesh(new RoundedBoxGeometry(0.18 * scale, 0.12 * scale, 0.06 * scale, 3, 0.02 * scale), body);
      cap.position.set(sx * (1.1 * scale), 1.05 * scale, 0.58 * scale);
      grp.add(cap);
    }
    // wheels with hubs
    for (const [wx, wz] of [[-0.8, 1.2], [0.8, 1.2], [-0.8, -1.4], [0.8, -1.4]]) {
      const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.38 * scale, 0.38 * scale, 0.25 * scale, 28), tire);
      wheel.rotation.z = Math.PI / 2;
      wheel.position.set(wx * scale, 0.38 * scale, wz * scale);
      grp.add(wheel);
      const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.18 * scale, 0.18 * scale, 0.27 * scale, 16), chrome);
      hub.rotation.z = Math.PI / 2;
      hub.position.set(wx * scale, 0.38 * scale, wz * scale);
      grp.add(hub);
    }
    this.scene.add(grp);
    // collision stays a stable box
    const col = this.box(body, 2 * scale, 0.7 * scale, 4.6 * scale, x, 0, z, ry);
    this.colliders.push(col);
    this.aabbs.push(new THREE.Box3().setFromObject(col));
  }

  truck(x: number, z: number, ry = 0, color = 0x3a5a3a) {
    const body = new THREE.MeshStandardMaterial({ color, roughness: 0.5, metalness: 0.4 });
    const cab = new THREE.MeshStandardMaterial({ color: 0x2c4a2c, roughness: 0.4, metalness: 0.6 });
    const tire = new THREE.MeshStandardMaterial({ color: 0x111, roughness: 0.9 });
    const chrome = new THREE.MeshStandardMaterial({ color: 0x9aa0a8, roughness: 0.3, metalness: 0.95 });
    const b = this.box(body, 2.4, 2.2, 7, x, 0, z, ry);
    const c = this.box(cab, 2.4, 1.6, 2.6, x + Math.sin(ry) * 3.3, 0, z + Math.cos(ry) * 3.3, ry);
    // rounded visual bodies on top of collision boxes
    const visBody = this.mesh(body, new RoundedBoxGeometry(2.4, 2.2, 7, 4, 0.18), x, 1.1, z, ry);
    visBody.castShadow = true;
    visBody.receiveShadow = true;
    this.scene.add(visBody);
    const visCab = this.mesh(cab, new RoundedBoxGeometry(2.4, 1.6, 2.6, 4, 0.14), x + Math.sin(ry) * 3.3, 0.8, z + Math.cos(ry) * 3.3, ry);
    visCab.castShadow = true;
    this.scene.add(visCab);
    // cab windshield + mirrors
    const glass = new THREE.MeshStandardMaterial({ color: 0x14181c, roughness: 0.15, metalness: 0.9 });
    const ws = this.mesh(glass, new RoundedBoxGeometry(2.1, 0.7, 0.06, 3, 0.03), x + Math.sin(ry) * 3.3, 1.2, z + Math.cos(ry) * 4.6, ry);
    this.scene.add(ws);
    for (const sx of [-1, 1]) {
      const arm = this.mesh(chrome, new THREE.CylinderGeometry(0.04, 0.04, 0.4, 10), x + Math.sin(ry) * 3.3 + sx * 1.3, 1.1, z + Math.cos(ry) * 3.6, ry);
      arm.rotation.z = Math.PI / 2;
      this.scene.add(arm);
    }
    // cargo bed slats + stacked crates
    const slatMat = new THREE.MeshStandardMaterial({ color: 0x5a4a30, roughness: 0.9 });
    for (let i = -2; i <= 2; i++) {
      const slat = this.mesh(slatMat, new THREE.BoxGeometry(2.2, 0.06, 0.1), x + i * 1.2, 2.3, z, ry);
      slat.rotation.y = ry;
      this.scene.add(slat);
    }
    const crateMat = new THREE.MeshStandardMaterial({ color: 0x8a6a43, roughness: 0.82 });
    for (const [dx, dz, h] of [[-0.6, 0.4, 0.8], [0.6, -0.3, 0.6]] as const) {
      const cr = this.mesh(crateMat, new THREE.BoxGeometry(1.0, h, 1.0), x + dx, 2.3 + h / 2, z + dz, ry);
      this.scene.add(cr);
    }
    // wheels with hubs
    for (const [wx, wz] of [[-1, 2.2], [1, 2.2], [-1, -2.5], [1, -2.5]] as const) {
      const w = this.mesh(tire, new THREE.CylinderGeometry(0.5, 0.5, 0.3, 28), x + wx * Math.cos(ry) + wz * Math.sin(ry), 0.5, z - wx * Math.sin(ry) + wz * Math.cos(ry));
      w.rotation.z = Math.PI / 2;
      w.rotation.y = ry;
      this.scene.add(w);
      const hub = this.mesh(chrome, new THREE.CylinderGeometry(0.24, 0.24, 0.32, 16), x + wx * Math.cos(ry) + wz * Math.sin(ry), 0.5, z - wx * Math.sin(ry) + wz * Math.cos(ry));
      hub.rotation.z = Math.PI / 2;
      hub.rotation.y = ry;
      this.scene.add(hub);
    }
    this.scene.add(b, c);
    this.colliders.push(b, c);
    for (const m of [b, c]) {
      m.updateWorldMatrix(true, false);
      this.aabbs.push(new THREE.Box3().setFromObject(m));
    }
  }

  container(x: number, y: number, z: number, ry = 0, color = 0x8a6a3a) {
    const c = new THREE.Color(color);
    const mat = new THREE.MeshStandardMaterial({ color: c, roughness: 0.65, metalness: 0.35 });
    const col = this.box(mat, 6, 2.6, 2.5, x, y, z, ry);
    // rounded visual shell + corrugation + end frames + doors
    const vis = this.mesh(mat, new RoundedBoxGeometry(6, 2.6, 2.5, 4, 0.14), x, y + 1.3, z, ry);
    vis.castShadow = true;
    vis.receiveShadow = true;
    this.scene.add(vis);
    const ribMat = new THREE.MeshStandardMaterial({ color: c.clone().multiplyScalar(0.75), roughness: 0.7 });
    for (let i = -2; i <= 2; i++) {
      const rib = new THREE.Mesh(new THREE.BoxGeometry(0.05, 2.6, 2.5), ribMat);
      rib.position.set(i * 1.15, 1.3, 0);
      rib.rotation.y = ry;
      vis.add(rib);
    }
    // vertical corrugation on the ends
    for (let i = -1; i <= 1; i++) {
      const end = new THREE.Mesh(new THREE.BoxGeometry(0.04, 2.6, 0.04), ribMat);
      end.position.set(i * 0.7, 1.3, 1.25);
      vis.add(end);
    }
    // corner posts
    const postMat = new THREE.MeshStandardMaterial({ color: c.clone().multiplyScalar(0.55), roughness: 0.7, metalness: 0.5 });
    for (const [px, pz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      const p = new THREE.Mesh(new THREE.BoxGeometry(0.1, 2.6, 0.1), postMat);
      p.position.set(px * 2.95, 1.3, pz * 1.2);
      p.rotation.y = ry;
      vis.add(p);
    }
    // door lines + handles
    const doorMat = new THREE.MeshStandardMaterial({ color: 0x2a2a2a, roughness: 0.6, metalness: 0.6 });
    for (const dz of [-0.6, 0.6]) {
      const line = new THREE.Mesh(new THREE.BoxGeometry(0.02, 2.4, 0.02), ribMat);
      line.position.set(0, 1.3, dz);
      vis.add(line);
      const handle = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.06, 0.08), doorMat);
      handle.position.set(0.5, 0.9, dz);
      vis.add(handle);
    }
    this.scene.add(col);
    this.colliders.push(col);
    return col;
  }

  containerRow(x: number, z: number, count: number, ry = 0, colors = [0x8a6a3a, 0x3a6a8a, 0x5a7a3a, 0x8a8a8a]) {
    for (let i = 0; i < count; i++) {
      const m = this.container(x + i * 6.4, 0, z, (ry + (i % 2 ? 0.04 : -0.04)), colors[(i + Math.floor(x)) % colors.length]);
      m.updateWorldMatrix(true, false);
      this.aabbs.push(new THREE.Box3().setFromObject(m));
    }
  }

  fence(x1: number, z1: number, x2: number, z2: number) {
    const wood = new THREE.MeshStandardMaterial({ color: 0x6b4f30, roughness: 0.9 });
    const len = Math.hypot(x2 - x1, z2 - z1);
    const ux = (x2 - x1) / len;
    const uz = (z2 - z1) / len;
    const ang = Math.atan2(ux, uz) - Math.PI / 2;
    const n = Math.max(2, Math.floor(len / 1.4));
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const px = x1 + (x2 - x1) * t;
      const pz = z1 + (z2 - z1) * t;
      const post = this.mesh(wood, new RoundedBoxGeometry(0.13, 1.4, 0.13, 3, 0.03), px, 0, pz, ang);
      post.castShadow = true;
      this.scene.add(post);
      // post foot
      const foot = this.mesh(wood, new THREE.BoxGeometry(0.2, 0.1, 0.2), px, 0.05, pz, ang);
      this.scene.add(foot);
    }
    for (const y of [0.7, 1.2, 1.32]) {
      const rail = this.mesh(wood, new RoundedBoxGeometry(len, 0.1, 0.07, 3, 0.02), (x1 + x2) / 2, y, (z1 + z2) / 2, ang);
      rail.castShadow = true;
      this.scene.add(rail);
    }
  }

  tree(x: number, z: number, s = 1) {
    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x5a3d22, roughness: 0.9 });
    const leafMat = new THREE.MeshStandardMaterial({ color: 0x3d5a2a, roughness: 0.9 });
    const trunk = this.mesh(trunkMat, new THREE.CylinderGeometry(0.2 * s, 0.32 * s, 2.4 * s, 16, 4), x, 1.2 * s, z);
    this.scene.add(trunk);
    // branch stubs
    for (const [by, bx, bz] of [[2.0, 0.3, 0], [1.8, -0.3, 0.1], [2.2, 0.1, -0.3]]) {
      const br = this.mesh(trunkMat, new THREE.CylinderGeometry(0.04 * s, 0.07 * s, 0.5 * s, 8), x + bx * s, by * s, z + bz * s);
      br.rotation.z = bx * 0.6;
      br.rotation.x = bz * 0.6;
      this.scene.add(br);
    }
    // multi-layer canopy
    for (let i = 0; i < 7; i++) {
      const leaf = this.mesh(leafMat, new THREE.SphereGeometry((0.85 + this.rng() * 0.55) * s, 18, 14), x + (this.rng() - 0.5) * 1.5 * s, (2.4 + i * 0.4 + this.rng() * 0.5) * s, z + (this.rng() - 0.5) * 1.5 * s);
      this.scene.add(leaf);
    }
    // small under-foliage
    for (let i = 0; i < 3; i++) {
      const low = this.mesh(leafMat, new THREE.SphereGeometry((0.5 + this.rng() * 0.3) * s, 14, 10), x + (this.rng() - 0.5) * 1.2 * s, 1.5 * s + this.rng() * 0.3, z + (this.rng() - 0.5) * 1.2 * s);
      this.scene.add(low);
    }
  }

  haystack(x: number, z: number) {
    const mat = new THREE.MeshStandardMaterial({ color: 0xc9a84a, roughness: 1 });
    const m = this.mesh(mat, new THREE.SphereGeometry(1.6, 28, 22), x, 1.1, z);
    m.scale.y = 0.8;
    this.scene.add(m);
    // bale wrap ridges
    const ridge = new THREE.MeshStandardMaterial({ color: 0xb5963c, roughness: 1 });
    for (let i = 0; i < 3; i++) {
      const r = this.mesh(ridge, new THREE.TorusGeometry(1.5 - i * 0.25, 0.04, 8, 28), x, 1.0 + i * 0.12, z);
      r.rotation.x = Math.PI / 2;
      r.scale.y = 0.8;
      this.scene.add(r);
    }
  }

  streetlight(x: number, z: number, ry = 0) {
    const poleMat = new THREE.MeshStandardMaterial({ color: 0x2a2d30, roughness: 0.6, metalness: 0.8 });
    const pole = this.mesh(poleMat, new THREE.CylinderGeometry(0.09, 0.12, 5, 24, 4), x, 2.5, z, ry);
    this.scene.add(pole);
    // access panel on the pole
    const panel = this.mesh(new THREE.MeshStandardMaterial({ color: 0x1a1c1f, roughness: 0.7, metalness: 0.5 }), new THREE.BoxGeometry(0.2, 0.5, 0.06), x + Math.sin(ry) * 0.1, 1.2, z + Math.cos(ry) * 0.1);
    this.scene.add(panel);
    const arm = this.mesh(poleMat, new THREE.CylinderGeometry(0.05, 0.05, 1.6, 16), x + Math.sin(ry) * 0.9, 5, z + Math.cos(ry) * 0.9, ry + Math.PI / 2);
    this.scene.add(arm);
    // lamp housing + bulb
    const housing = this.mesh(new THREE.MeshStandardMaterial({ color: 0x1a1c1f, roughness: 0.5, metalness: 0.7 }), new THREE.CylinderGeometry(0.16, 0.12, 0.18, 20), x + Math.sin(ry) * 1.7, 4.9, z + Math.cos(ry) * 1.7);
    this.scene.add(housing);
    const bulb = this.mesh(new THREE.MeshStandardMaterial({ color: 0xffe9b0, emissive: 0xffd98a, emissiveIntensity: 2.2 }), new THREE.SphereGeometry(0.14, 20, 16), x + Math.sin(ry) * 1.7, 4.8, z + Math.cos(ry) * 1.7);
    this.scene.add(bulb);
  }

  /* ---------------- industry ---------------- */
  craneTower(x: number, z: number, h: number, ry = 0) {
    const yellow = new THREE.MeshStandardMaterial({ color: 0xd8a81c, roughness: 0.5, metalness: 0.5 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x2a2a2a, roughness: 0.6, metalness: 0.7 });
    // mast (rounded) + lattice cross-braces
    const mast = this.mesh(yellow, new RoundedBoxGeometry(1.3, h, 1.3, 4, 0.2), x, h / 2, z, ry);
    mast.castShadow = true;
    this.scene.add(mast);
    const braceMat = new THREE.MeshStandardMaterial({ color: 0xb89018, roughness: 0.6, metalness: 0.6 });
    for (let yy = 1; yy < h; yy += 1.5) {
      const br1 = this.mesh(braceMat, new THREE.BoxGeometry(1.4, 0.05, 0.05), x - 0.6, yy, z, ry);
      const br2 = this.mesh(braceMat, new THREE.BoxGeometry(0.05, 0.05, 1.4), x + 0.6, yy, z, ry);
      this.scene.add(br1, br2);
    }
    // jib (long horizontal arm) + counter-jib (rounded)
    const jibLen = 22;
    const jib = this.mesh(yellow, new RoundedBoxGeometry(0.8, 0.9, jibLen, 4, 0.18), x, h, z + Math.cos(ry) * 9, ry);
    jib.castShadow = true;
    const counter = this.mesh(yellow, new RoundedBoxGeometry(0.8, 0.9, 9, 4, 0.18), x, h, z - Math.cos(ry) * 4.5, ry);
    const cw = this.mesh(dark, new RoundedBoxGeometry(2.2, 1.6, 1.6, 4, 0.3), x - Math.sin(ry) * 4.5, h - 0.6, z - Math.cos(ry) * 4.5, ry);
    const cab = this.mesh(yellow, new RoundedBoxGeometry(2, 2, 2.4, 4, 0.3), x + Math.sin(ry) * 1.6, h - 0.8, z + Math.cos(ry) * 1.6, ry);
    cab.castShadow = true;
    // jib truss detail (diagonals)
    const trussMat = new THREE.MeshStandardMaterial({ color: 0x9a7214, roughness: 0.6, metalness: 0.6 });
    for (let i = 0; i < 6; i++) {
      const zz = -jibLen / 2 + i * (jibLen / 5);
      const diag = this.mesh(trussMat, new THREE.BoxGeometry(0.06, 0.85, 0.06), x, h, z + Math.cos(ry) * 9 + zz, ry);
      diag.rotation.z = 0.4;
      this.scene.add(diag);
    }
    // hook cable (tapered, high segment) + block
    const hookX = x + Math.sin(ry) * 10;
    const hookZ = z + Math.cos(ry) * 10;
    const cable = this.mesh(dark, new THREE.CylinderGeometry(0.02, 0.04, 6, 12), hookX, h - 3, hookZ);
    const block = this.mesh(dark, new RoundedBoxGeometry(0.7, 0.7, 0.7, 3, 0.12), hookX, h - 6.2, hookZ);
    block.castShadow = true;
    this.scene.add(jib, counter, cw, cab, cable, block);
    this.colliders.push(mast);
    const beacon = this.mesh(new THREE.MeshStandardMaterial({ color: 0xff2222, emissive: 0xff0000, emissiveIntensity: 3 }), new THREE.SphereGeometry(0.12, 16, 12), x, h + 0.3, z);
    this.scene.add(beacon);
    this.beacon(beacon, 3, this.rng() * 6);
    return { mast, x, z, h, ry };
  }

  craneGantry(x: number, z: number, h: number, span: number) {
    const yellow = new THREE.MeshStandardMaterial({ color: 0xd8a81c, roughness: 0.5, metalness: 0.5 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x2a2a2a, roughness: 0.6, metalness: 0.7 });
    for (const sx of [-1, 1]) {
      const leg = this.mesh(yellow, new RoundedBoxGeometry(0.7, h, 0.7, 4, 0.15), x + sx * span / 2, h / 2, z, 0);
      leg.castShadow = true;
      const leg2 = this.mesh(yellow, new RoundedBoxGeometry(0.7, h, 0.7, 4, 0.15), x + sx * span / 2, h / 2, z + 1.6, 0);
      leg2.castShadow = true;
      this.scene.add(leg, leg2);
      this.colliders.push(leg, leg2);
      // diagonal brace
      const brace = this.mesh(dark, new THREE.BoxGeometry(0.1, Math.hypot(h, 1.6), 0.1), x + sx * span / 2, h / 2, z + 0.8, 0);
      brace.rotation.z = Math.atan2(1.6, h);
      this.scene.add(brace);
    }
    const beam = this.mesh(yellow, new RoundedBoxGeometry(0.8, 0.9, span + 1, 4, 0.18), x, h, z + 0.8, 0);
    beam.castShadow = true;
    const cross = this.mesh(yellow, new RoundedBoxGeometry(span + 1, 0.8, 0.8, 4, 0.18), x, h, z + 1.6, 0);
    this.scene.add(beam, cross);
    // trolley + hoist cable
    const trolley = this.mesh(dark, new RoundedBoxGeometry(1, 0.6, 0.8, 3, 0.12), x + 3, h - 0.8, z + 0.8, 0);
    this.scene.add(trolley);
    const cable = this.mesh(dark, new THREE.CylinderGeometry(0.02, 0.02, 3, 10), x + 3, h - 2.3, z + 0.8);
    this.scene.add(cable);
  }

  excavator(x: number, z: number, ry = 0) {
    const yellow = new THREE.MeshStandardMaterial({ color: 0xd8a81c, roughness: 0.5, metalness: 0.4 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x222, roughness: 0.9 });
    const track = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.95 });
    // tracks (rounded, high segment)
    for (const sx of [-1, 1]) {
      const t = this.mesh(track, new THREE.CylinderGeometry(0.5, 0.5, 2.4, 28), x + sx * 1.2, 0.5, z, ry + Math.PI / 2);
      t.castShadow = true;
      this.scene.add(t);
      // track tread links
      for (let i = -1; i <= 1; i++) {
        const link = this.mesh(dark, new THREE.BoxGeometry(2.4, 0.16, 0.12), x + sx * 1.2, 0.5 + Math.cos(i * 0.6) * 0.4, z + Math.sin(i * 0.6) * 0.4, ry);
        this.scene.add(link);
      }
    }
    // body + cab (rounded)
    const b = this.mesh(yellow, new RoundedBoxGeometry(2.4, 1, 3.6, 4, 0.2), x, 0.7, z, ry);
    b.castShadow = true;
    b.receiveShadow = true;
    const c = this.mesh(yellow, new RoundedBoxGeometry(1.8, 1.4, 1.6, 4, 0.25), x + Math.sin(ry) * 1.4, 1.4, z + Math.cos(ry) * 1.4, ry);
    c.castShadow = true;
    // cab window
    const glass = new THREE.MeshStandardMaterial({ color: 0x101418, roughness: 0.2, metalness: 0.8 });
    const win = this.mesh(glass, new THREE.BoxGeometry(1.5, 0.6, 0.06), x + Math.sin(ry) * 1.4, 1.7, z + Math.cos(ry) * 2.2, ry);
    this.scene.add(win);
    // arm (rounded, two segments) + bucket
    const arm = this.mesh(yellow, new RoundedBoxGeometry(0.6, 0.6, 3.4, 4, 0.15), x + Math.sin(ry) * 2.4, 2.2, z + Math.cos(ry) * 2.4, ry);
    arm.castShadow = true;
    const arm2 = this.mesh(yellow, new RoundedBoxGeometry(0.5, 0.5, 2.2, 4, 0.13), x + Math.sin(ry) * 3.6, 1.6, z + Math.cos(ry) * 3.6, ry);
    arm2.castShadow = true;
    const bucket = this.mesh(dark, new RoundedBoxGeometry(1, 0.9, 1.2, 4, 0.2), x + Math.sin(ry) * 4.4, 1.2, z + Math.cos(ry) * 4.4, ry);
    bucket.castShadow = true;
    // bucket teeth
    for (let i = 0; i < 4; i++) {
      const tooth = this.mesh(dark, new THREE.ConeGeometry(0.08, 0.25, 8), x + Math.sin(ry) * 4.4 + (i - 1.5) * 0.25, 1.0, z + Math.cos(ry) * 4.4 + 0.6, 0);
      tooth.rotation.x = Math.PI / 2;
      this.scene.add(tooth);
    }
    this.scene.add(b, c, arm, arm2, bucket);
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
    const hullMat = new THREE.MeshStandardMaterial({ color: 0x2c4a66, roughness: 0.6, metalness: 0.5 });
    const superMat = new THREE.MeshStandardMaterial({ color: 0xe8e6e0, roughness: 0.5, metalness: 0.3 });
    const glass = new THREE.MeshStandardMaterial({ color: 0x101418, roughness: 0.2, metalness: 0.8 });
    // hull (long in z, bow north): rounded box + tapered, rounded bow
    const hull = this.mesh(hullMat, new RoundedBoxGeometry(10, 7, 44, 5, 0.6), x, 0, z, 0);
    hull.castShadow = true;
    hull.receiveShadow = true;
    const bow = this.mesh(hullMat, new THREE.CylinderGeometry(3.2, 5, 14, 32, 3, false), x, 0, z - 25, 0);
    bow.rotation.x = Math.PI / 2;
    bow.castShadow = true;
    // bow bulb
    const bulb = this.mesh(hullMat, new THREE.SphereGeometry(3.2, 24, 16), x, -2.2, z - 30, 0);
    bulb.scale.set(1, 0.5, 1.6);
    this.scene.add(hull, bow, bulb);
    // red waterline stripe + boot topping
    const stripe = this.mesh(new THREE.MeshStandardMaterial({ color: 0x8a1c1c, roughness: 0.6, metalness: 0.4 }), new THREE.BoxGeometry(10.2, 0.45, 44.2), x, 0.05, z);
    this.scene.add(stripe);
    const boot = this.mesh(new THREE.MeshStandardMaterial({ color: 0x1a1a1e, roughness: 0.7, metalness: 0.4 }), new THREE.BoxGeometry(10.1, 0.3, 44.1), x, -0.75, z);
    this.scene.add(boot);
    // waterline collider — blocks walking through the hull, shots at deck pass over
    this.colliders.push(this.box(hullMat, 14, 2.9, 44, x, -1.45, z, 0));
    // deck — walkable surface (top at y = 3.5), rounded slab + planking lines
    const deck = this.mesh(new THREE.MeshStandardMaterial({ color: 0x4a4036, roughness: 0.9 }), new RoundedBoxGeometry(14, 0.4, 42, 4, 0.1), x, 3.3, z, 0);
    deck.castShadow = true;
    deck.receiveShadow = true;
    this.scene.add(deck);
    const plankMat = new THREE.MeshStandardMaterial({ color: 0x3a3228, roughness: 0.95 });
    for (let px = -6; px <= 6; px += 1.4) {
      const plank = this.mesh(plankMat, new THREE.BoxGeometry(0.05, 0.02, 40), x + px, 3.52, z);
      this.scene.add(plank);
    }
    this.colliders.push(this.box(new THREE.MeshStandardMaterial({ color: 0x4a4036, roughness: 0.9 }), 14, 0.4, 42, x, 3.1, z, 0));
    this.aabbs.push(new THREE.Box3(new THREE.Vector3(x - 7, 3.1, z - 21), new THREE.Vector3(x + 7, 3.5, z + 21)));
    // superstructure at stern (south end) — rounded, with window band
    const sup = this.mesh(superMat, new RoundedBoxGeometry(7, 4.5, 6, 5, 0.4), x, 3.5 + 2.25, z + 10, 0);
    sup.castShadow = true;
    sup.receiveShadow = true;
    this.scene.add(sup);
    const supCol = this.box(superMat, 7, 4.5, 6, x, 3.5, z + 10, 0);
    this.colliders.push(supCol);
    this.aabbs.push(new THREE.Box3().setFromObject(supCol));
    const winBand = this.mesh(glass, new THREE.BoxGeometry(7.05, 1.2, 6.05), x, 5.2, z + 10);
    this.scene.add(winBand);
    const bridge = this.mesh(glass, new RoundedBoxGeometry(7.4, 2.2, 5, 5, 0.2), x, 8 + 1.1, z + 10, 0);
    bridge.castShadow = true;
    this.scene.add(bridge);
    const bridgeCol = this.box(glass, 7.4, 2.2, 5, x, 8, z + 10, 0);
    this.colliders.push(bridgeCol);
    this.aabbs.push(new THREE.Box3().setFromObject(bridgeCol));
    // containers on deck (edges, centre lane left clear for the boss)
    for (const [cx, cz] of [[-4, -6], [-4, -12], [4, -6], [4, -12]] as const) {
      for (let row = 0; row < 2; row++) {
        const m = this.container(x + cx, 3.5 + row * 2.7, z + cz, (cx + cz) % 2 ? 0.06 : -0.06, [0x8a6a3a, 0x3a6a8a, 0x5a7a3a][(cx + cz + row) % 3]);
        m.updateWorldMatrix(true, false);
        this.aabbs.push(new THREE.Box3().setFromObject(m));
      }
    }
    // deck hatches (dark panels)
    const hatchMat = new THREE.MeshStandardMaterial({ color: 0x1a1a1e, roughness: 0.8, metalness: 0.4 });
    for (const [hx, hz] of [[-4, -14], [4, -14], [-4, -24], [4, -24]] as const) {
      const hatch = this.mesh(hatchMat, new THREE.BoxGeometry(2.2, 0.06, 1.6), x + hx, 3.56, z + hz, (hx + hz) % 2 ? 0.3 : -0.3);
      this.scene.add(hatch);
    }
    // navigation lights (red port, green starboard) + mast beacon
    const navRed = this.mesh(new THREE.MeshStandardMaterial({ color: 0xff2020, emissive: 0xff0000, emissiveIntensity: 2.5 }), new THREE.SphereGeometry(0.12, 8, 6), x - 3.2, 2.6, z - 16);
    const navGreen = this.mesh(new THREE.MeshStandardMaterial({ color: 0x20ff40, emissive: 0x00ff30, emissiveIntensity: 2.5 }), new THREE.SphereGeometry(0.12, 8, 6), x + 3.2, 2.6, z - 16);
    const navWhite = this.mesh(new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffffee, emissiveIntensity: 2.5 }), new THREE.SphereGeometry(0.1, 8, 6), x, 10.8, z + 10);
    this.scene.add(navRed, navGreen, navWhite);
    this.beacon(navRed, 1.6, 0);
    this.beacon(navGreen, 1.6, 2);
    this.beacon(navWhite, 1.2, 4);
    // flag on the bridge mast
    const flagMat = new THREE.MeshStandardMaterial({ color: 0xc9a84a, roughness: 0.8, side: THREE.DoubleSide });
    const flagPole = this.mesh(new THREE.MeshStandardMaterial({ color: 0x222, roughness: 0.7, metalness: 0.8 }), new THREE.CylinderGeometry(0.04, 0.04, 2.2, 6), x + 2.6, 11.3, z + 10);
    this.scene.add(flagPole);
    const flag = this.mesh(flagMat, new THREE.PlaneGeometry(0.9, 0.55), x + 3.0, 12.2, z + 10);
    this.scene.add(flag);
    this.flagMesh = flag;
    let flagPhase = 0;
    this.extras.push({
      update: (dt: number) => {
        flagPhase += dt * 5;
        flag.rotation.z = Math.sin(flagPhase) * 0.35;
      },
    });
    // deck railings (thin posts along both long edges)
    const railMat = new THREE.MeshStandardMaterial({ color: 0x222, roughness: 0.7 });
    for (let i = -17; i <= 17; i += 3) {
      for (const sx of [-7, 7]) {
        const post = this.mesh(railMat, new THREE.CylinderGeometry(0.05, 0.05, 1.1, 6), x + sx, 4.05, z + i);
        this.scene.add(post);
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
    const steel = new THREE.MeshStandardMaterial({ color: 0x9aa0a8, roughness: 0.5, metalness: 0.8 });
    const pole = this.mesh(steel, new THREE.CylinderGeometry(0.12, 0.22, h, 24, 4), x, h / 2, z);
    pole.castShadow = true;
    this.scene.add(pole);
    this.colliders.push(pole);
    // triangular lattice cross-braces
    const braceMat = new THREE.MeshStandardMaterial({ color: 0x7a8088, roughness: 0.6, metalness: 0.8 });
    for (let i = 1; i <= 6; i++) {
      const yy = (i / 6) * h;
      const r = 0.35 + (i / 6) * 0.5;
      const ring = this.mesh(steel, new THREE.TorusGeometry(r, 0.04, 8, 28), x, yy, z);
      ring.rotation.x = Math.PI / 2;
      this.scene.add(ring);
      // vertical corner struts
      for (let a = 0; a < 3; a++) {
        const ang = a * (Math.PI * 2 / 3);
        const sx = Math.cos(ang) * r;
        const sz = Math.sin(ang) * r;
        const strut = this.mesh(braceMat, new THREE.CylinderGeometry(0.03, 0.03, (i === 6 ? h - yy : 1.6), 8), x + sx, yy + (i === 6 ? (h - yy) / 2 : 0.8), z + sz);
        this.scene.add(strut);
      }
    }
    const dish = this.mesh(steel, new THREE.SphereGeometry(1.1, 32, 20, 0, Math.PI * 2, 0, Math.PI / 2.4), x, h, z);
    dish.rotation.x = -Math.PI / 2.4;
    dish.position.y = h + 0.3;
    dish.castShadow = true;
    this.scene.add(dish);
    // dish support struts
    for (let a = 0; a < 3; a++) {
      const ang = a * (Math.PI * 2 / 3) + Math.PI / 6;
      const strut = this.mesh(steel, new THREE.CylinderGeometry(0.03, 0.03, 1.4, 8), x + Math.cos(ang) * 0.4, h + 0.5, z + Math.sin(ang) * 0.4);
      strut.rotation.z = Math.cos(ang) * 0.7;
      strut.rotation.x = -Math.sin(ang) * 0.7;
      this.scene.add(strut);
    }
    // feed horn at dish focus
    const horn = this.mesh(steel, new THREE.CylinderGeometry(0.08, 0.12, 0.4, 16), x, h + 0.9, z);
    this.scene.add(horn);
    const beacon = this.mesh(new THREE.MeshStandardMaterial({ color: 0xff2020, emissive: 0xff0000, emissiveIntensity: 4 }), new THREE.SphereGeometry(0.16, 16, 12), x, h + 1.6, z);
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
    const roof = new THREE.MeshStandardMaterial({ color: 0x8a3b2a, roughness: 0.9, metalness: 0 });
    this.building({ x, z, w, d, h, facade: stone, roof: "tile", roofMat: roof, emissive: 0.35, parapet: false, details: false, ry });
    // 3D window frames + shutters on all faces
    this.windowTrim({
      x, z, w, d, h, bayW: 1.6, floorH: 3, rows: 2, cols: 3, ry,
      frameMat: new THREE.MeshStandardMaterial({ color: 0x5a5048, roughness: 0.9 }),
      shutterMat: new THREE.MeshStandardMaterial({ color: 0x4a5a32, roughness: 0.9 }),
    });
    // door + frame + step
    const doorX = x + Math.sin(ry) * (w / 2 - 0.6);
    const doorZ = z + Math.cos(ry) * (d / 2 + 0.1);
    const door = this.box(new THREE.MeshStandardMaterial({ color: 0x4a3320, roughness: 0.9 }), 1.1, 2, 0.12, doorX, 0, doorZ, ry + Math.PI);
    this.scene.add(door);
    const frameMat = new THREE.MeshStandardMaterial({ color: 0x5a5048, roughness: 0.9 });
    this.scene.add(this.mesh(frameMat, new RoundedBoxGeometry(1.35, 0.14, 0.16, 2, 0.03), doorX, 2.12, doorZ + Math.cos(ry) * 0.08, ry));
    this.scene.add(this.mesh(frameMat, new RoundedBoxGeometry(0.16, 2.2, 0.16, 2, 0.03), doorX + Math.sin(ry) * 0.75, 1.1, doorZ + Math.cos(ry) * 0.08, ry));
    this.scene.add(this.mesh(frameMat, new RoundedBoxGeometry(0.16, 2.2, 0.16, 2, 0.03), doorX - Math.sin(ry) * 0.75, 1.1, doorZ + Math.cos(ry) * 0.08, ry));
    const step = this.mesh(new THREE.MeshStandardMaterial({ color: 0x6a6258, roughness: 0.95 }), new RoundedBoxGeometry(1.5, 0.14, 0.4, 3, 0.03), doorX, 0.07, doorZ + Math.cos(ry) * 0.25, ry);
    this.scene.add(step);
  }

  church(x: number, z: number) {
    const stoneMat = new THREE.MeshStandardMaterial({ color: 0xd8d2c4, roughness: 0.95 });
    const roofMat = new THREE.MeshStandardMaterial({ color: 0x5a5a60, roughness: 0.8 });
    // nave (collision box) + rounded visual shell
    this.solid(this.box(stoneMat, 9, 6, 13, x, 0, z), "concrete");
    const naveVis = this.mesh(stoneMat, new RoundedBoxGeometry(9, 6, 13, 5, 0.4), x, 3, z);
    naveVis.castShadow = true;
    naveVis.receiveShadow = true;
    this.scene.add(naveVis);
    // buttresses along the nave sides
    for (const sx of [-1, 1]) {
      for (const zz of [-3, 0, 3]) {
        const but = this.mesh(stoneMat, new RoundedBoxGeometry(0.7, 4.5, 1.2, 3, 0.15), x + sx * 4.8, 2.2, z + zz, 0);
        but.castShadow = true;
        this.scene.add(but);
      }
    }
    // bell tower (east side): collision box + rounded visual + belfry
    this.solid(this.box(stoneMat, 3.4, 13, 3.4, x + 6, 0, z + 4), "concrete");
    const towerVis = this.mesh(stoneMat, new RoundedBoxGeometry(3.4, 13, 3.4, 5, 0.35), x + 6, 6.5, z + 4);
    towerVis.castShadow = true;
    towerVis.receiveShadow = true;
    this.scene.add(towerVis);
    // belfry opening ring (stone collar)
    const collar = this.mesh(stoneMat, new THREE.TorusGeometry(1.7, 0.35, 10, 28), x + 6, 11.2, z + 4);
    collar.rotation.x = Math.PI / 2;
    this.scene.add(collar);
    // pyramid tower roof (higher segment)
    const towerRoof = this.mesh(roofMat, new THREE.ConeGeometry(2.8, 2.6, 8, 1), x + 6, 14.3, z + 4);
    towerRoof.rotation.y = Math.PI / 4;
    towerRoof.castShadow = true;
    this.scene.add(towerRoof);
    // spire + finial ball
    const spire = this.mesh(roofMat, new THREE.ConeGeometry(0.3, 1.2, 12), x + 6, 15.9, z + 4);
    this.scene.add(spire);
    const finial = this.mesh(new THREE.MeshStandardMaterial({ color: 0xb89a3a, roughness: 0.4, metalness: 0.8 }), new THREE.SphereGeometry(0.12, 16, 12), x + 6, 16.75, z + 4);
    this.scene.add(finial);
    // cross
    const crossMat = new THREE.MeshStandardMaterial({ color: 0x3a3328, roughness: 0.9 });
    const cross1 = this.mesh(crossMat, new THREE.BoxGeometry(0.15, 1.1, 0.15), x + 6, 17.4, z + 4);
    const cross1b = this.mesh(crossMat, new THREE.BoxGeometry(0.7, 0.15, 0.15), x + 6, 17.7, z + 4);
    this.scene.add(cross1, cross1b);
    // main roof (gable)
    this.roof(x, z, 9.4, 13.4, 6, "gable", roofMat);
    // door
    const door = this.mesh(new THREE.MeshStandardMaterial({ color: 0x3a2a1a, roughness: 0.9 }), new RoundedBoxGeometry(1.4, 2.4, 0.15, 3, 0.03), x, 1.2, z + 6.75);
    door.castShadow = true;
    this.scene.add(door);
    // door arch keystone
    const arch = this.mesh(stoneMat, new THREE.TorusGeometry(0.85, 0.12, 8, 20, Math.PI), x, 2.4, z + 6.85);
    arch.rotation.x = Math.PI / 2;
    arch.rotation.z = -Math.PI / 2;
    this.scene.add(arch);
    // window frames on nave + tower
    const frameStone = new THREE.MeshStandardMaterial({ color: 0xb8b0a0, roughness: 0.95 });
    this.windowTrim({ x, z, w: 9, d: 13, h: 6, bayW: 3, floorH: 3, rows: 2, cols: 3, ry: 0, frameMat: frameStone, shutterMat: null });
    this.windowTrim({ x: x + 6, z: z + 4, w: 3.4, d: 3.4, h: 13, bayW: 1.7, floorH: 3, rows: 1, cols: 2, ry: 0, frameMat: frameStone, shutterMat: null });
    // bell (visible opening)
    const bell = this.mesh(new THREE.MeshStandardMaterial({ color: 0xb89a3a, roughness: 0.4, metalness: 0.8 }), new THREE.CylinderGeometry(0.5, 0.75, 0.9, 28, 1, true), x + 6, 11.5, z + 4);
    this.scene.add(bell);
    const bellKnob = this.mesh(new THREE.MeshStandardMaterial({ color: 0xb89a3a, roughness: 0.4, metalness: 0.8 }), new THREE.SphereGeometry(0.14, 16, 12), x + 6, 12.0, z + 4);
    this.scene.add(bellKnob);
    // graveyard wall
    this.fence(x - 8, z + 8, x + 14, z + 8);
  }

  well(x: number, z: number) {
    const stone = new THREE.MeshStandardMaterial({ color: 0x9a9084, roughness: 0.95 });
    // well housing stone base (rounded)
    const base = this.mesh(stone, new RoundedBoxGeometry(2.4, 0.9, 2.4, 4, 0.2), x, 0.45, z);
    base.castShadow = true;
    base.receiveShadow = true;
    this.scene.add(base);
    // well opening ring (stone)
    const ring = this.mesh(stone, new THREE.TorusGeometry(1.0, 0.24, 12, 28), x, 0.8, z);
    ring.rotation.x = Math.PI / 2;
    ring.castShadow = true;
    this.scene.add(ring);
    // inner dark well mouth
    const mouth = this.mesh(new THREE.MeshStandardMaterial({ color: 0x14100c, roughness: 1 }), new THREE.CylinderGeometry(0.85, 0.85, 0.6, 28, 1, true), x, 0.78, z);
    this.scene.add(mouth);
    // roof (high-segment cone) + finial
    const roof = this.mesh(new THREE.MeshStandardMaterial({ color: 0x5a4030, roughness: 0.9 }), new THREE.ConeGeometry(1.6, 0.9, 16, 1), x, 1.7, z);
    roof.castShadow = true;
    this.scene.add(roof);
    const finial = this.mesh(stone, new THREE.SphereGeometry(0.12, 16, 12), x, 2.18, z);
    this.scene.add(finial);
    // support posts (rounded) + crossbeam
    const beam = this.mesh(stone, new RoundedBoxGeometry(2.6, 0.14, 0.16, 3, 0.04), x, 1.5, z + 1.15, 0);
    beam.castShadow = true;
    this.scene.add(beam);
    for (const sx of [-1, 1]) {
      const post = this.mesh(stone, new RoundedBoxGeometry(0.2, 1.7, 0.2, 3, 0.04), x + sx, 0.85, z + 1.1, 0);
      post.castShadow = true;
      this.scene.add(post);
    }
    // diagonal brace struts
    for (const sx of [-1, 1]) {
      const brace = this.mesh(stone, new THREE.BoxGeometry(0.1, 0.9, 0.1), x + sx, 1.3, z + 0.6, 0);
      this.scene.add(brace);
    }
  }

  stall(x: number, z: number, ry = 0) {
    const wood = new THREE.MeshStandardMaterial({ color: 0x6b4f30, roughness: 0.9 });
    const awn = new THREE.MeshStandardMaterial({ color: 0x9a3b2a, roughness: 0.85 });
    // counter (rounded)
    const counter = this.mesh(wood, new RoundedBoxGeometry(2.4, 0.08, 2.4, 4, 0.04), x, 0.84, z, ry);
    counter.castShadow = true;
    counter.receiveShadow = true;
    this.scene.add(counter);
    // counter base
    const base = this.mesh(wood, new RoundedBoxGeometry(2.2, 0.5, 2.2, 4, 0.08), x, 0.55, z, ry);
    this.scene.add(base);
    for (const [px, pz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
      const post = this.mesh(wood, new RoundedBoxGeometry(0.1, 2, 0.1, 3, 0.03), x + px, 1.0, z + pz, ry);
      post.castShadow = true;
      this.scene.add(post);
    }
    // awning (high-segment extruded, with scalloped edge)
    const shape = new THREE.Shape();
    shape.moveTo(-1.3, 0);
    shape.lineTo(1.3, 0);
    shape.lineTo(1.3, 0.4);
    shape.lineTo(-1.3, 0.4);
    shape.closePath();
    const g = new THREE.ExtrudeGeometry(shape, { depth: 2.4, bevelEnabled: true, bevelThickness: 0.03, bevelSize: 0.03, bevelSegments: 2 });
    g.translate(0, 0, -1.2);
    const roofM = this.mesh(awn, g, x, 2, z, ry);
    roofM.castShadow = true;
    this.scene.add(roofM);
    // awning trim
    const trim = this.mesh(new THREE.MeshStandardMaterial({ color: 0x6a2418, roughness: 0.9 }), new RoundedBoxGeometry(2.5, 0.05, 2.5, 3, 0.02), x, 1.97, z, ry);
    this.scene.add(trim);
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
  decal(tex: THREE.Texture, w: number, h: number, x: number, y: number, z: number, ry = 0) {
    const mat = new THREE.MeshStandardMaterial({
      map: tex,
      transparent: true,
      roughness: 0.95,
      metalness: 0,
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

  /** puddle on paved/ground surfaces */
  puddle(x: number, z: number, rx: number, rz: number) {
    const t = this.pTex("puddle", () => puddleTex(256, this.rng));
    this.decal(t, rx * 2, rz * 2, x, 0.013, z, this.rng() * Math.PI);
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
    m.rotation.y = ry;
    this.scene.add(m);
    return m;
  }

  /** irregular grey rock */
  rock(x: number, z: number, s = 1) {
    const mat = new THREE.MeshStandardMaterial({ color: 0x7a746c, roughness: 0.98, flatShading: true });
    const m = this.mesh(mat, new THREE.IcosahedronGeometry(0.45 * s, 0), x, 0.2 * s, z);
    m.scale.set(1 + this.rng() * 0.5, 0.6 + this.rng() * 0.3, 1 + this.rng() * 0.5);
    m.rotation.set(this.rng() * 3, this.rng() * 3, this.rng() * 3);
    this.decor(m);
  }

  /** pile of rubble chunks */
  rubble(x: number, z: number, n = 5) {
    const mat = new THREE.MeshStandardMaterial({ color: 0x6a6660, roughness: 0.98, flatShading: true });
    for (let i = 0; i < n; i++) {
      const s = 0.12 + this.rng() * 0.24;
      const m = this.mesh(mat, new THREE.BoxGeometry(s, s * 0.8, s), x + (this.rng() - 0.5) * 1.2, s * 0.4, z + (this.rng() - 0.5) * 1.2, this.rng() * 3);
      m.rotation.x = this.rng() * 0.6;
      m.rotation.z = this.rng() * 0.6;
      this.decor(m);
    }
  }

  /** traffic cone with white band + base */
  trafficCone(x: number, z: number, ry = 0) {
    const orange = new THREE.MeshStandardMaterial({ color: 0xe06a1c, roughness: 0.75 });
    const white = new THREE.MeshStandardMaterial({ color: 0xf0ece0, roughness: 0.8 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.9 });
    const cone = this.mesh(orange, new THREE.ConeGeometry(0.2, 0.75, 18), x, 0.38, z, ry);
    this.decor(cone);
    const band = this.mesh(white, new THREE.CylinderGeometry(0.15, 0.17, 0.12, 18), x, 0.32, z, ry);
    this.decor(band);
    const base = this.mesh(dark, new THREE.BoxGeometry(0.5, 0.05, 0.5), x, 0.025, z, ry);
    this.decor(base, false);
  }

  /** post-mounted sign board */
  roadSign(x: number, z: number, ry = 0, text = "DANGER", bg = "#d8a01c", fg = "#1a1a1a") {
    const steel = new THREE.MeshStandardMaterial({ color: 0x2a2d30, roughness: 0.6, metalness: 0.8 });
    const post = this.mesh(steel, new THREE.CylinderGeometry(0.05, 0.06, 2.2, 12), x, 1.1, z, ry);
    this.decor(post);
    const face = this.mesh(new THREE.MeshStandardMaterial({ map: signTex(text, bg, fg, this.rng), roughness: 0.8, side: THREE.DoubleSide }), new THREE.PlaneGeometry(1.1, 0.55), x, 1.85, z + Math.cos(ry) * 0.55, ry);
    this.decor(face);
  }

  /** rooftop billboard: two posts + large ad panel */
  billboard(x: number, z: number, y: number, ry = 0) {
    const steel = new THREE.MeshStandardMaterial({ color: 0x2a2d30, roughness: 0.6, metalness: 0.8 });
    for (const sx of [-1, 1]) {
      const post = this.mesh(steel, new THREE.CylinderGeometry(0.08, 0.1, 5, 12), x + sx * 1.4, y + 2.5, z, ry);
      this.decor(post);
    }
    const face = this.mesh(new THREE.MeshStandardMaterial({ map: this.pTex("ad", () => adTex(this.rng)), roughness: 0.8, side: THREE.DoubleSide }), new THREE.PlaneGeometry(4.4, 2.2), x, y + 5.6, z + Math.cos(ry) * 0.1, ry);
    this.decor(face);
  }

  /** crossed grass blades tuft */
  grassTuft(x: number, z: number, n = 3) {
    const mat = new THREE.MeshStandardMaterial({ color: 0x3d5a2a, roughness: 0.95, side: THREE.DoubleSide });
    for (let i = 0; i < n; i++) {
      const blade = this.mesh(mat, new THREE.PlaneGeometry(0.12, 0.35), x + (this.rng() - 0.5) * 0.4, 0.17, z + (this.rng() - 0.5) * 0.4, this.rng() * 3);
      blade.rotation.x = -0.2 + this.rng() * 0.4;
      this.decor(blade, false);
    }
  }

  /** small wildflower patch */
  flowers(x: number, z: number, n = 5) {
    const cols = [0xc8403a, 0xe8c83a, 0xf0f0f0, 0xd05a8a, 0x8a6ad8];
    for (let i = 0; i < n; i++) {
      const m = this.mesh(new THREE.MeshStandardMaterial({ color: cols[Math.floor(this.rng() * cols.length)], roughness: 0.8 }), new THREE.SphereGeometry(0.06, 8, 6), x + (this.rng() - 0.5) * 0.8, 0.1, z + (this.rng() - 0.5) * 0.8);
      this.decor(m, false);
    }
  }

  /** small dirt mound */
  dirtMound(x: number, z: number, r = 1) {
    const mat = new THREE.MeshStandardMaterial({ color: 0x6a5438, roughness: 1, flatShading: true });
    const m = this.mesh(mat, new THREE.SphereGeometry(r, 12, 10), x, r * 0.25, z);
    m.scale.y = 0.45;
    this.decor(m);
  }

  /** rooftop AC unit: rounded body + louver + fan */
  acUnit(x: number, z: number, y: number, ry = 0) {
    const body = new THREE.MeshStandardMaterial({ color: 0xb8bcc0, roughness: 0.7, metalness: 0.4 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x2a2d30, roughness: 0.7, metalness: 0.6 });
    const b = this.mesh(body, new RoundedBoxGeometry(1.2, 0.8, 0.9, 4, 0.12), x, y + 0.4, z, ry);
    this.decor(b);
    // louver slats on the front face
    for (let i = 0; i < 4; i++) {
      const s = this.mesh(dark, new THREE.BoxGeometry(1.0, 0.05, 0.04), x, y + 0.15 + i * 0.15, z + Math.cos(ry) * 0.46 + Math.sin(ry) * 0.46, ry);
      this.decor(s, false);
    }
    // fan ring on the side
    const fan = this.mesh(dark, new THREE.TorusGeometry(0.28, 0.04, 8, 20), x - Math.sin(ry) * 0.5, y + 0.4, z + Math.cos(ry) * 0.5, ry + Math.PI / 2);
    fan.rotation.x = Math.PI / 2;
    this.decor(fan, false);
  }

  /** rooftop antenna array: masts + crossbars + small dish */
  antennaArray(x: number, z: number, y: number, ry = 0) {
    const steel = new THREE.MeshStandardMaterial({ color: 0x8a9098, roughness: 0.5, metalness: 0.85 });
    for (let i = 0; i < 3; i++) {
      const h = 1.6 + i * 0.5;
      const dx = (i - 1) * 0.7;
      const mast = this.mesh(steel, new THREE.CylinderGeometry(0.03, 0.04, h, 8), x + Math.cos(ry) * dx, y + h / 2, z + Math.sin(ry) * dx, ry);
      this.decor(mast);
      for (let k = 0; k < 2; k++) {
        const bar = this.mesh(steel, new THREE.CylinderGeometry(0.02, 0.02, 0.5, 6), x + Math.cos(ry) * dx, y + h * (0.4 + k * 0.35), z + Math.sin(ry) * dx, ry + Math.PI / 2);
        bar.rotation.z = Math.PI / 2;
        this.decor(bar, false);
      }
    }
    // small dish on the tallest mast
    const dish = this.mesh(steel, new THREE.SphereGeometry(0.4, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2.6), x, y + 2.9, z);
    dish.rotation.x = -Math.PI / 2.6;
    this.decor(dish);
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
function buildRange(content: THREE.Object3D, main: THREE.Scene, renderer: THREE.WebGLRenderer) {
  const w = buildWorld(content, main, renderer);
  const aabbs: THREE.Box3[] = [];
  for (const c of w.colliders) {
    c.updateWorldMatrix(true, false);
    aabbs.push(new THREE.Box3().setFromObject(c));
  }
  const groundHeightAt = (x: number, z: number, y: number): number => {
    let best = 0;
    for (const box of aabbs) {
      // small forward tolerance so a step's top is caught as the player reaches its riser
      if (x < box.min.x - 0.3 || x > box.max.x + 0.3) continue;
      if (z < box.min.z - 0.3 || z > box.max.z + 0.3) continue;
      const top = box.max.y;
      if (top > y + 0.6) continue;
      if (top > best) best = top;
    }
    return best;
  };
  return { ...w, aabbs, destroyables: [] as THREE.Mesh[], groundHeightAt };
}

/* ---------------- M1: Gornja Luka village ---------------- */
function buildVillage(content: THREE.Object3D, main: THREE.Scene, renderer: THREE.WebGLRenderer): LevelResult {
  const K = new Kit(content, 1337);
  const ambient = setupAmbient(main, renderer, {
    sunElev: 9,
    sunAzim: 62,
    turbidity: 4.5,
    rayleigh: 1.6,
    fogColor: 0xd9b48f,
    fogDensity: 0.0065,
    hemiSky: 0x9db4c8,
    hemiGround: 0x55462f,
    hemiIntensity: 0.55,
    sunColor: 0xffd9a0,
    sunIntensity: 3.4,
    envIntensity: 0.5,
    exposure: 1.05,
    shadowFar: 100,
  });
  content.add(ambient.sun, ambient.hemi);
  if (ambient.stars) content.add(ambient.stars);

  // ground: grass field patches + dirt road
  const gc = noiseCanvas(1024, "#5a6b3a", [["rgba(120,130,80,0.35)", 9000], ["rgba(90,100,55,0.3)", 7000], ["rgba(80,60,35,0.15)", 4000]], K.rng);
  const gTex = toTex(gc, 90);
  K.ground(400, new THREE.MeshStandardMaterial({ map: gTex, bumpMap: toTex(gc, 90, false), bumpScale: 1.4, roughness: 0.97, metalness: 0 }));
  // dirt road N-S
  const rc = noiseCanvas(512, "#7a6848", [["rgba(0,0,0,0.2)", 8000], ["rgba(255,230,190,0.08)", 4000]], K.rng);
  const road = K.mesh(new THREE.MeshStandardMaterial({ map: toTex(rc, 14), bumpMap: toTex(rc, 14, false), bumpScale: 1, roughness: 0.98 }), new THREE.PlaneGeometry(7, 100), 0, 0.02, 10);
  road.rotation.x = -Math.PI / 2;
  road.receiveShadow = true;
  content.add(road);

  // houses
  K.houseVillage(-13, -2, 7, 8, 4.5, 0.2);
  K.houseVillage(-13, 6, 7, 8, 4, -0.1);
  K.houseVillage(-14, 18, 7, 8, 4.5, 0.3);
  K.houseVillage(-13, 30, 8, 8, 4, -0.2);
  K.houseVillage(13, -8, 8, 8, 4.5, -0.2);
  K.houseVillage(14, 4, 7, 8, 4, 0.1);
  K.houseVillage(13, 16, 7, 8, 4.5, 0.25);
  K.houseVillage(14, 28, 8, 8, 4, -0.15);
  K.houseVillage(-10, -26, 7, 7, 3.8, 0.15);

  // enterable houses (hollow walls + doorways) for interior & corner ambush play
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
  const tileRoof = new THREE.MeshStandardMaterial({ color: 0x8a3b2a, roughness: 0.9, metalness: 0 });
  // a cluster of enterable houses flanking the road — enemies can pop out of doorways
  K.enterable({ x: -16, z: 18, w: 7, d: 8, h: 4.2, facade: villageStone, roof: "tile", roofMat: tileRoof, emissive: 0.4 });
  K.enterable({ x: 16, z: 18, w: 7, d: 8, h: 4.2, facade: villageStone, roof: "tile", roofMat: tileRoof, emissive: 0.4, ry: 0.2 });
  K.enterable({ x: -14, z: 38, w: 7, d: 8, h: 4, facade: villageStone, roof: "tile", roofMat: tileRoof, emissive: 0.35, ry: -0.2 });
  K.enterable({ x: 14, z: 38, w: 7, d: 8, h: 4, facade: villageStone, roof: "tile", roofMat: tileRoof, emissive: 0.35, ry: 0.2 });

  // church + square
  K.church(-8, -18);
  // staircase up the church tower (climbable, rooftop vantage over the square)
  K.stairs({ x: -8, z: -10.5, steps: 6, rise: 0.3, run: 0.7, width: 1.4, mat: new THREE.MeshStandardMaterial({ color: 0xc8c2b4, roughness: 0.95 }) });

  // corner ambush cover: low walls along the road approaches (kept clear of spawn/patrol lanes)
  const lowWall = new THREE.MeshStandardMaterial({ color: 0x9a9288, roughness: 0.95 });
  K.solid(K.box(lowWall, 6, 1.1, 0.4, -2, 0, 26, 0.1), "concrete");
  K.solid(K.box(lowWall, 6, 1.1, 0.4, 2, 0, 26, -0.1), "concrete");
  K.solid(K.box(lowWall, 0.4, 1.1, 6, -16, 0, 2, 0.2), "concrete");
  K.solid(K.box(lowWall, 0.4, 1.1, 6, 16, 0, 2, -0.2), "concrete");

  // props
  K.well(4, -14);
  K.stall(5, 8, 0.3);
  K.stall(-5, 12, -0.2);
  K.haystack(18, -4);
  K.haystack(-18, 2);
  K.haystack(-18, 26);
  K.tree(19, -12);
  K.tree(-19, -8);
  K.tree(21, 16);
  K.tree(-21, 10);
  K.tree(18, 32);
  K.tree(-19, 34);
  K.tree(6, 26);
  K.tree(-6, 36);
  K.tree(26, -20);
  K.tree(-26, -22);
  K.fence(-17, -2, -22, 6);
  K.fence(18, 8, 22, -2);
  K.fence(-17, 18, -22, 24);
  K.fence(17, 30, 22, 34);
  // cover for gunplay
  const woodMat = new THREE.MeshStandardMaterial({ color: 0x8a6a43, roughness: 0.82 });
  K.crate(woodMat, -6.5, 16, 1.1, 0.3);
  K.crate(woodMat, 7, -10, 1.2, -0.4);
  K.crate(woodMat, 8, 10, 1.0, 0.2);
  K.crate(woodMat, -8, -28, 1.1, 0.5);
  K.sandbag(4, 30, 0.2, 4);
  K.sandbag(-4, 30, -0.2, 4);
  K.sandbag(6, -20, 0.1, 4);

  // environment polish: weathering + small detail (visual only)
  for (let i = 0; i < 6; i++) K.groundStain(-2 + (K.rng() - 0.5) * 26, 6 + (K.rng() - 0.5) * 60, 0.6 + K.rng() * 0.8);
  K.puddle(-2, 22, 1.1, 0.8);
  K.puddle(3, -8, 0.9, 0.7);
  K.puddle(-4, 34, 1.0, 0.7);
  for (let i = 0; i < 4; i++) K.cracks(-12 + K.rng() * 24, 8 + K.rng() * 50, 2.4 + K.rng() * 1.6);
  for (let i = 0; i < 8; i++) K.rock(-22 + K.rng() * 44, -24 + K.rng() * 66, 0.7 + K.rng() * 0.8);
  K.rubble(-16, 12, 4);
  K.rubble(15, 26, 4);
  K.dirtMound(-10, -18, 1.1);
  K.dirtMound(18, 20, 0.9);
  for (let i = 0; i < 14; i++) K.grassTuft(-20 + K.rng() * 40, -26 + K.rng() * 70, 3);
  K.flowers(6, 24, 6);
  K.flowers(-6, 30, 5);
  K.flowers(4, -12, 5);
  K.wireStrand(-13, -2, -13, 6, 5.2, 0.5);
  K.wireStrand(13, 4, 14, 16, 5.3, 0.6);
  K.wireStrand(-14, 18, -14, 30, 5.2, 0.5);
  K.dustMotes(90, 110, 14, 90, 0xe8d8b0, 0.2);

  // hills ring
  const hillMat = new THREE.MeshStandardMaterial({ color: 0x4a5a38, roughness: 1, flatShading: true });
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * Math.PI * 2;
    const r = 48 + K.rng() * 12;
    const h = 12 + K.rng() * 14;
    const hill = K.mesh(hillMat, new THREE.SphereGeometry(h * 0.9, 10, 8), Math.cos(a) * r, h * 0.35, Math.sin(a) * r);
    hill.scale.y = 0.5;
    content.add(hill);
  }

  return finish(K, ambient);
}

/* ---------------- M2: Meridian Tower construction ---------------- */
function buildConstruction(content: THREE.Object3D, main: THREE.Scene, renderer: THREE.WebGLRenderer): LevelResult {
  const K = new Kit(content, 4242);
  const ambient = setupAmbient(main, renderer, {
    sunElev: 48,
    sunAzim: 210,
    turbidity: 8,
    rayleigh: 0.8,
    fogColor: 0xb8bdbf,
    fogDensity: 0.006,
    hemiSky: 0xc9ccd2,
    hemiGround: 0x6a6258,
    hemiIntensity: 0.75,
    sunColor: 0xf4f2ec,
    sunIntensity: 2.4,
    envIntensity: 0.4,
    exposure: 1.0,
    shadowFar: 90,
  });
  content.add(ambient.sun, ambient.hemi);
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

  // building under construction (slabs + columns + rebar)
  const concrete = new THREE.MeshStandardMaterial({ color: 0xb4b0a8, roughness: 0.92 });
  const concreteDark = new THREE.MeshStandardMaterial({ color: 0x8a867e, roughness: 0.95 });
  const bx = 0, bz = -16, bw = 18, bd = 14;
  for (let f = 1; f <= 3; f++) {
    const slab = K.box(concrete, bw, 0.4, bd, bx, f * 3, bz);
    slab.receiveShadow = true;
    content.add(slab);
    // corner columns
    for (const [cx, cz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
      const col = K.box(concreteDark, 0.6, f * 3, 0.6, bx + cx * (bw / 2 - 0.6), 0, bz + cz * (bd / 2 - 0.6));
      content.add(col);
    }
    // rebar sticking up from the top slab
    if (f === 3) {
      for (let i = 0; i < 24; i++) {
        const rx = bx + (K.rng() - 0.5) * bw * 0.85;
        const rz = bz + (K.rng() - 0.5) * bd * 0.85;
        const rb = K.mesh(new THREE.MeshStandardMaterial({ color: 0x555050, roughness: 0.7, metalness: 0.6 }), new THREE.CylinderGeometry(0.04, 0.04, 1.6, 6), rx, 9.8, rz);
        content.add(rb);
      }
    }
  }
  K.colliders.push(K.box(concrete, bw, 12, bd, bx, 0, bz));
  K.aabbs.push(new THREE.Box3(new THREE.Vector3(bx - bw / 2, 0, bz - bd / 2), new THREE.Vector3(bx + bw / 2, 12, bz + bd / 2)));

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

  // site office (rescue target) — enterable so the player can clear it room by room
  K.enterable({
    x: -18, z: -20, w: 8, d: 6, h: 3.4,
    facade: facade({ base: "#d8d2c4", glass: "#2a3a4a", frame: "#5a5048", glow: "#ffd98a", bayW: 1.8, floorH: 3, cols: 3, rows: 1, rng: K.rng, sign: "SITE OFFICE" }),
    roof: "flat",
    roofMat: new THREE.MeshStandardMaterial({ color: 0x4a5a3a, roughness: 0.9 }),
    emissive: 0.5,
  });

  // staircase up to the scaffold platform (covered ambush vantage over the site)
  K.stairs({ x: 7.6, z: -29, steps: 8, rise: 0.3, run: 0.6, width: 1.2, alongZ: false, mat: new THREE.MeshStandardMaterial({ color: 0xb0a830, roughness: 0.7, metalness: 0.4 }) });

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

  // safety barriers around the site
  const barrierMat = new THREE.MeshStandardMaterial({ color: 0xd8b01c, roughness: 0.7 });
  for (let x = -30; x <= 30; x += 5) {
    const b = K.box(barrierMat, 1.8, 0.8, 0.2, x, 0, 48);
    content.add(b);
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

/* ---------------- M3: Downtown Zlatograd ---------------- */
function buildDowntown(content: THREE.Object3D, main: THREE.Scene, renderer: THREE.WebGLRenderer): LevelResult {
  const K = new Kit(content, 90210);
  const ambient = setupAmbient(main, renderer, {
    sunElev: 7,
    sunAzim: 265,
    turbidity: 6,
    rayleigh: 1.8,
    fogColor: 0xa87b5a,
    fogDensity: 0.0065,
    hemiSky: 0x8a9ab0,
    hemiGround: 0x4a3a2c,
    hemiIntensity: 0.6,
    sunColor: 0xff9a5a,
    sunIntensity: 3.0,
    envIntensity: 0.45,
    exposure: 1.0,
    shadowFar: 100,
  });
  content.add(ambient.sun, ambient.hemi);
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

  // enterable street-level shops (hollow, doorways) — interior & corner ambush play
  K.enterable({ x: -5, z: 20, w: 6, d: 8, h: 5, facade: brickF, roof: "flat", roofMat: roofSlab, emissive: 0.7 });
  K.enterable({ x: 5, z: -16, w: 6, d: 8, h: 5, facade: glassF, roof: "flat", roofMat: roofSlab, emissive: 0.9, ry: 0.2 });
  K.enterable({ x: 6, z: 30, w: 6, d: 8, h: 4.5, facade: concreteF, roof: "flat", roofMat: roofSlab, emissive: 0.6 });
  K.enterable({ x: -6, z: -18, w: 6, d: 8, h: 4.5, facade: concreteF, roof: "flat", roofMat: roofSlab, emissive: 0.6, ry: -0.2 });

  // staircase up the side of a mid-rise for a rooftop vantage over the avenue
  K.stairs({ x: -10.4, z: 30, steps: 14, rise: 0.28, run: 0.6, width: 1.3, mat: new THREE.MeshStandardMaterial({ color: 0x6a6a70, roughness: 0.9 }) });
  K.stairs({ x: 10.4, z: 18, steps: 12, rise: 0.3, run: 0.6, width: 1.3, mat: new THREE.MeshStandardMaterial({ color: 0x6a6a70, roughness: 0.9 }) });

  // rooftop relay cache (objective) — mast in the street at (18, -26)
  K.relayTower(18, -26, 13);

  // streetlights
  for (let z = -28; z <= 44; z += 12) {
    K.streetlight(-9.4, z, 0);
    K.streetlight(9.4, z, 0);
  }

  // cars
  K.car(-6, 30, 0.4, 0x2e5a8c);
  K.car(6, 30, -0.2, 0x8a3a3a);
  K.car(-6, -14, 0.5, 0x5a5a5a);
  K.car(-6, 8, 0.1, 0x2e6a4a);
  K.car(6, 16, -0.4, 0x8a7a2e);
  K.car(-6, 22, 0.2, 0x3a3a5a);

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
  const mtSign = K.mesh(new THREE.MeshStandardMaterial({ color: 0xd8b01c, emissive: 0xd8b01c, emissiveIntensity: 0.8 }), new THREE.PlaneGeometry(10, 3), -58, 41, -56);
  mtSign.rotation.y = Math.PI;
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

/* ---------------- M4: Zlatograd Port ---------------- */
function buildPort(content: THREE.Object3D, main: THREE.Scene, renderer: THREE.WebGLRenderer): LevelResult {
  const K = new Kit(content, 5150);
  const ambient = setupAmbient(main, renderer, {
    sunElev: 3,
    sunAzim: 235,
    turbidity: 5,
    rayleigh: 1.0,
    fogColor: 0x05070d,
    fogDensity: 0.011,
    hemiSky: 0x1a2436,
    hemiGround: 0x05080c,
    hemiIntensity: 0.3,
    sunColor: 0x2a3850,
    sunIntensity: 0.35,
    envIntensity: 0.15,
    exposure: 1.15,
    stars: true,
    shadowFar: 90,
  });
  content.add(ambient.sun, ambient.hemi);
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

  // enterable dockside warehouse + guard hut (interior clearing + corner ambush)
  const warehouseF = facade({ base: "#5a5a60", glass: "#1a2430", frame: "#3a3a40", glow: "#ffca7a", bayW: 2, floorH: 3.4, cols: 3, rows: 2, rng: K.rng });
  const roofSlabP = new THREE.MeshStandardMaterial({ color: 0x3a3a40, roughness: 0.85 });
  K.enterable({ x: -14, z: 24, w: 10, d: 8, h: 5, facade: warehouseF, roof: "flat", roofMat: roofSlabP, emissive: 0.6 });
  K.enterable({ x: 14, z: 24, w: 8, d: 6, h: 3.6, facade: warehouseF, roof: "flat", roofMat: roofSlabP, emissive: 0.5, ry: 0.2 });

  // container stacks on dock
  K.containerRow(-16, -2, 3);
  K.containerRow(16, -2, 3);
  K.containerRow(-18, 10, 3, 0.1);
  K.containerRow(18, 10, 3, -0.1);

  // staircase up a container stack for an elevated vantage over the dock
  K.stairs({ x: -15.4, z: 2, steps: 5, rise: 0.5, run: 0.7, width: 1.4, mat: new THREE.MeshStandardMaterial({ color: 0x8a6a3a, roughness: 0.7, metalness: 0.3 }) });
  K.stairs({ x: 15.4, z: 2, steps: 5, rise: 0.5, run: 0.7, width: 1.4, mat: new THREE.MeshStandardMaterial({ color: 0x3a6a8a, roughness: 0.7, metalness: 0.3 }) });

  // floodlight towers
  const poleMat = new THREE.MeshStandardMaterial({ color: 0x2a2d30, roughness: 0.6, metalness: 0.7 });
  for (const [fx, fz] of [[-10, 16], [10, 16], [-20, 28], [20, 28], [0, 38]] as const) {
    const pole = K.mesh(poleMat, new THREE.CylinderGeometry(0.12, 0.15, 12, 10), fx, 6, fz);
    K.scene.add(pole);
    const lamp = K.mesh(new THREE.MeshStandardMaterial({ color: 0xfff4d0, emissive: 0xfff0c0, emissiveIntensity: 2.6 }), new THREE.SphereGeometry(0.5, 10, 8), fx, 12.4, fz);
    K.scene.add(lamp);
    const lamp2 = K.mesh(new THREE.MeshStandardMaterial({ color: 0xfff4d0, emissive: 0xfff0c0, emissiveIntensity: 2.6 }), new THREE.SphereGeometry(0.5, 10, 8), fx + 1.4, 12.2, fz);
    K.scene.add(lamp2);
    // light cone
    const cone = K.mesh(new THREE.MeshBasicMaterial({ color: 0xfff0c8, transparent: true, opacity: 0.05, side: THREE.DoubleSide, depthWrite: false }), new THREE.ConeGeometry(5, 12, 12, 1, true), fx, 6.5, fz);
    K.scene.add(cone);
  }

  // weapon crates (destroyables)
  const wcMat = new THREE.MeshStandardMaterial({ color: 0x3a4a2a, roughness: 0.7, metalness: 0.3 });
  for (const [wx, wz] of [[14, -4], [-14, -6], [10, -10], [-10, -8]] as const) {
    const grp = new THREE.Group();
    grp.position.set(wx, 0, wz);
    const box = new THREE.Mesh(new THREE.BoxGeometry(1.8, 1.4, 1.8), wcMat);
    box.position.y = 0.7;
    box.castShadow = true;
    box.receiveShadow = true;
    box.userData.kind = "wood";
    box.userData.destroyable = true;
    grp.add(box);
    // white stripe + MERIDIAN label
    const label = K.mesh(new THREE.MeshStandardMaterial({ map: stripeLabel(), roughness: 0.6 }), new THREE.PlaneGeometry(1.2, 0.5), wx, 1.45, wz + 0.92);
    K.scene.add(label);
    grp.position.y = 0;
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
  K.truck(12, 26, 0.3, 0x3a5a3a);
  K.truck(-12, 30, -0.3, 0x4a4a4a);

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
  const ambient = setupAmbient(main, renderer, {
    sunElev: 2,
    sunAzim: 100,
    turbidity: 10,
    rayleigh: 0.5,
    fogColor: 0x0a0c10,
    fogDensity: 0.014,
    hemiSky: 0x222831,
    hemiGround: 0x0a0c10,
    hemiIntensity: 0.22,
    sunColor: 0x2a3040,
    sunIntensity: 0.18,
    envIntensity: 0.1,
    exposure: 1.05,
    stars: true,
    shadowFar: 100,
  });
  content.add(ambient.sun, ambient.hemi);
  if (ambient.stars) content.add(ambient.stars);

  // ground: compound asphalt + gravel
  const gc = noiseCanvas(1024, "#40413f", [["rgba(0,0,0,0.25)", 9000], ["rgba(255,255,255,0.04)", 4000]], K.rng);
  K.ground(300, new THREE.MeshStandardMaterial({ map: toTex(gc, 50), bumpMap: toTex(gc, 50, false), bumpScale: 1, roughness: 0.95 }));

  // main tower (Sorin's perch)
  const glassF = facade({ base: "#2e343c", glass: "#0a0d12", frame: "#4a5058", glow: "#ffca7a", bayW: 2, floorH: 3.4, cols: 4, rows: 3, rng: K.rng, sign: "MERIDIAN" });
  K.building({
    x: 0, z: -32, w: 16, d: 10, h: 42,
    facade: glassF, roof: "flat",
    roofMat: new THREE.MeshStandardMaterial({ color: 0x3a3f46, roughness: 0.85 }),
    parapet: true, details: true, emissive: 0.6,
  });
  // tower entrance canopy + lit door
  const canopy = K.box(new THREE.MeshStandardMaterial({ color: 0x3a4048, roughness: 0.8, metalness: 0.4 }), 4, 0.3, 3, 0, 0, -26.5);
  K.scene.add(canopy);
  const door = K.mesh(new THREE.MeshStandardMaterial({ color: 0xd8d4c0, emissive: 0xffd98a, emissiveIntensity: 0.8 }), new THREE.PlaneGeometry(2, 3), 0, 1.5, -25.01);
  K.scene.add(door);

  // compound wall (z=-20) with gate gap at x -2..2
  const wallMat = new THREE.MeshStandardMaterial({ color: 0x55565a, roughness: 0.9 });
  K.solid(K.box(wallMat, 26, 4.2, 0.8, -15, 0, -20), "concrete");
  K.solid(K.box(wallMat, 22, 4.2, 0.8, 15, 0, -20), "concrete");
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
  // razor wire on the wall (decorative rings)
  const wireMat = new THREE.MeshStandardMaterial({ color: 0x8a8a8a, roughness: 0.4, metalness: 0.9 });
  for (let x = -24; x <= 24; x += 1.5) {
    if (Math.abs(x) < 2.6) continue;
    const ring = K.mesh(wireMat, new THREE.TorusGeometry(0.4, 0.03, 6, 10), x, 4.5, -19.7);
    ring.rotation.x = Math.PI / 2;
    ring.rotation.z = x * 0.4;
    K.scene.add(ring);
  }

  // courtyard props
  K.sandbag(-6, -22, 0, 6);
  K.sandbag(6, -22, 0, 6);

  // enterable barracks (interior clearing + corner ambush) flanking the approach
  const barracksF = facade({ base: "#4a5058", glass: "#161c24", frame: "#33383f", glow: "#ffca7a", bayW: 2, floorH: 3.4, cols: 3, rows: 2, rng: K.rng });
  const hqRoof = new THREE.MeshStandardMaterial({ color: 0x2a2e33, roughness: 0.85 });
  K.enterable({ x: -20, z: 10, w: 10, d: 8, h: 5, facade: barracksF, roof: "flat", roofMat: hqRoof, emissive: 0.5 });
  K.enterable({ x: 20, z: 10, w: 10, d: 8, h: 5, facade: barracksF, roof: "flat", roofMat: hqRoof, emissive: 0.5, ry: 0.2 });

  // staircase up the side of a compound building for a covered vantage over the gate
  K.stairs({ x: -20.4, z: 6, steps: 12, rise: 0.3, run: 0.6, width: 1.3, mat: new THREE.MeshStandardMaterial({ color: 0x55565a, roughness: 0.9 }) });

  // low corner cover / barricades in the courtyard
  const bqMat = new THREE.MeshStandardMaterial({ color: 0x5a5c60, roughness: 0.9 });
  K.solid(K.box(bqMat, 5, 1.1, 0.5, -10, 0, -16, 0.1), "concrete");
  K.solid(K.box(bqMat, 5, 1.1, 0.5, 10, 0, -16, -0.1), "concrete");
  K.solid(K.box(bqMat, 0.5, 1.1, 8, 0, 0, -18, 0), "concrete");
  for (const [fx, fz] of [[-14, -25], [14, -25]] as const) {
    K.solid(K.mesh(new THREE.MeshStandardMaterial({ color: 0x8a8a2a, roughness: 0.6, metalness: 0.4 }), new THREE.CylinderGeometry(1.2, 1.2, 3, 12), fx, 1.5, fz), "metal");
  }
  // APCs (Brick's ride) + trucks
  K.truck(-18, -12, 0.5, 0x3a5a3a);
  K.truck(18, -12, -0.5, 0x3a5a3a);
  // crates + barrels
  const woodMat = new THREE.MeshStandardMaterial({ color: 0x8a6a43, roughness: 0.82 });
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

  // streetlights (dim) along approach
  for (let z = 44; z >= 16; z -= 12) {
    K.streetlight(-9, z, 0);
    K.streetlight(9, z, 0);
  }

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

/* ====================== result helpers ====================== */
export interface LevelResult extends World {
  aabbs: THREE.Box3[];
  destroyables: THREE.Mesh[];
  /** highest walkable surface top at (x, z) that is at/below y (within step range) */
  groundHeightAt: (x: number, z: number, y: number) => number;
}

function finish(K: Kit, ambient: ReturnType<typeof setupAmbient>): LevelResult {
  const update = (_dt: number, focus: THREE.Vector3) => {
    ambient.update(_dt, focus);
    K.beacons.forEach((b) => {
      b.phase += b.speed * _dt;
      b.mesh.visible = Math.sin(b.phase) > 0;
    });
    K.extras.forEach((e) => e.update(_dt));
  };
  const groundHeightAt = (x: number, z: number, y: number): number => {
    let best = 0;
    for (const box of K.aabbs) {
      // small forward tolerance so a step's top is caught as the player reaches its riser
      if (x < box.min.x - 0.3 || x > box.max.x + 0.3) continue;
      if (z < box.min.z - 0.3 || z > box.max.z + 0.3) continue;
      const top = box.max.y;
      if (top > y + 0.6) continue; // surface too high to be the ground we stand on
      if (top > best) best = top;
    }
    return best;
  };
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
    default: return buildRange(content, main, renderer);
  }
}
