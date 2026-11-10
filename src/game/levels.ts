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

  box(mat: THREE.Material, w: number, h: number, d: number, x: number, y: number, z: number, ry = 0) {
    return this.mesh(mat, new THREE.BoxGeometry(w, h, d), x, y + h / 2, z, ry);
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
    // wall (facade texture tiled to real dimensions)
    const wallMat = new THREE.MeshStandardMaterial({
      map: o.facade.map.clone(),
      bumpMap: o.facade.map.clone(),
      bumpScale: 0.06,
      roughness: 0.85,
      metalness: 0.02,
      emissive: 0xffffff,
      emissiveMap: o.facade.glow.clone(),
      emissiveIntensity: o.emissive ?? 0,
    });
    wallMat.map!.wrapS = wallMat.map!.wrapT = THREE.RepeatWrapping;
    wallMat.map!.repeat.set(Math.max(1, w / o.facade.tileW), Math.max(1, h / o.facade.tileH));
    wallMat.map!.needsUpdate = true;
    wallMat.emissiveMap!.wrapS = wallMat.emissiveMap!.wrapT = THREE.RepeatWrapping;
    wallMat.emissiveMap!.repeat.copy(wallMat.map!.repeat);
    wallMat.emissiveMap!.needsUpdate = true;
    wallMat.bumpMap!.wrapS = wallMat.bumpMap!.wrapT = THREE.RepeatWrapping;
    wallMat.bumpMap!.repeat.copy(wallMat.map!.repeat);
    wallMat.bumpMap!.needsUpdate = true;
    const wall = this.box(wallMat, w, h, d, x, 0, z, o.ry ?? 0);
    const colH = o.collideTo ?? h;
    this.solid(wall);
    if (colH < h) {
      // trim collider so rooftop combat works (raycast gap at roofline)
      const last = this.aabbs[this.aabbs.length - 1];
      last.max.y = colH;
    }
    if (o.roof !== "none") this.roof(x, z, w, d, h, o.roof ?? "flat", o.roofMat);
    if (o.parapet) this.parapet(x, z, w, d, h, o.roofMat);
    if (o.details) this.roofDetails(x, z, w, d, h, o.roofMat);
    return wall;
  }

  roof(x: number, z: number, w: number, d: number, h: number, kind: string, mat: THREE.Material) {
    if (kind === "flat") {
      this.box(mat, w + 0.6, 0.4, d + 0.6, x, h, z);
    } else if (kind === "tile") {
      const shape = new THREE.Shape();
      const rise = Math.min(2.2, d * 0.35);
      shape.moveTo(-w / 2 - 0.4, 0);
      shape.lineTo(w / 2 + 0.4, 0);
      shape.lineTo(w / 2, rise);
      shape.lineTo(-w / 2, rise);
      shape.closePath();
      const g = new THREE.ExtrudeGeometry(shape, { depth: 0.35, bevelEnabled: false });
      g.translate(0, 0, -d / 2);
      const m = this.mesh(mat, g, x, h + rise / 2, z);
      this.scene.add(m);
    } else if (kind === "gable") {
      const shape = new THREE.Shape();
      const rise = Math.min(3.2, d * 0.45);
      shape.moveTo(-d / 2 - 0.4, 0);
      shape.lineTo(d / 2 + 0.4, 0);
      shape.lineTo(d / 2, rise);
      shape.lineTo(-d / 2, rise);
      shape.closePath();
      const g = new THREE.ExtrudeGeometry(shape, { depth: w, bevelEnabled: false });
      g.translate(0, 0, -w / 2);
      const m = this.mesh(mat, g, x, h + rise / 2, z);
      this.scene.add(m);
    } else { // metal: shallow pitched corrugated sheet
      const m = this.box(mat, w + 0.5, 0.25, d + 0.5, x, h + 0.05, z);
      this.scene.add(m);
    }
  }

  parapet(x: number, z: number, w: number, d: number, h: number, mat: THREE.Material) {
    const t = 0.25;
    const H = 0.9;
    // long sides (along z)
    this.scene.add(this.box(mat, t, H, d + 0.5, x - w / 2, h - 0.2, z));
    this.scene.add(this.box(mat, t, H, d + 0.5, x + w / 2, h - 0.2, z));
    // short sides (along x)
    this.scene.add(this.box(mat, w + 0.5, H, t, x, h - 0.2, z - d / 2));
    this.scene.add(this.box(mat, w + 0.5, H, t, x, h - 0.2, z + d / 2));
  }

  roofDetails(x: number, z: number, w: number, d: number, h: number, mat: THREE.Material) {
    const r = this.rng;
    const steel = mat;
    // AC units
    const acCount = 1 + Math.floor(r() * 2);
    for (let i = 0; i < acCount; i++) {
      const ax = x + (r() - 0.5) * w * 0.6;
      const az = z + (r() - 0.5) * d * 0.6;
      this.box(steel, 1.1, 0.8, 0.9, ax, h, az, r() * Math.PI);
    }
    // water tank
    if (r() < 0.5) {
      const tx = x + (r() - 0.5) * w * 0.5;
      const tz = z + (r() - 0.5) * d * 0.5;
      const tank = this.mesh(new THREE.MeshStandardMaterial({ color: 0x8a8f96, roughness: 0.5, metalness: 0.7 }), new THREE.CylinderGeometry(0.8, 0.8, 1.6, 16), tx, h + 0.8, tz);
      this.scene.add(tank);
    }
    // antenna / pipes
    if (r() < 0.6) {
      const an = this.mesh(steel, new THREE.CylinderGeometry(0.04, 0.04, 2 + r() * 2, 8), x + (r() - 0.5) * w * 0.4, h, z + (r() - 0.5) * d * 0.4);
      this.scene.add(an);
    }
  }

  /* ---------------- props ---------------- */
  crate(mat: THREE.Material, x: number, z: number, s: number, ry = 0, y = 0) {
    return this.solid(this.box(mat, s, s, s, x, y, z, ry), "wood");
  }

  barrel(mat: THREE.Material, x: number, z: number, color = 0x9b2c22) {
    const m = this.solid(
      this.mesh(mat, new THREE.CylinderGeometry(0.3, 0.3, 0.9, 28), x, 0.45, z),
      "metal",
    );
    const ringMat = new THREE.MeshStandardMaterial({ color, roughness: 0.5, metalness: 0.7 });
    [-0.28, 0, 0.28].forEach((y) => {
      const r = new THREE.Mesh(new THREE.TorusGeometry(0.302, 0.012, 8, 28), ringMat);
      r.rotation.x = Math.PI / 2;
      r.position.y = y;
      m.add(r);
    });
  }

  sandbag(x: number, z: number, ry = 0, count = 5) {
    const mat = new THREE.MeshStandardMaterial({ color: 0x8d8163, roughness: 0.95 });
    for (let i = 0; i < count; i++) {
      const b = this.box(mat, 0.65, 0.28, 0.35, x + (i % 3) * 0.55 - 0.55, 0.12 + Math.floor(i / 3) * 0.28, z, ry);
      b.castShadow = true;
      this.scene.add(b);
    }
  }

  car(x: number, z: number, ry = 0, color = 0x2e5a8c, scale = 1) {
    const body = new THREE.MeshStandardMaterial({ color, roughness: 0.4, metalness: 0.5 });
    const glass = new THREE.MeshStandardMaterial({ color: 0x14181c, roughness: 0.15, metalness: 0.9 });
    const grp = new THREE.Group();
    grp.position.set(x, 0, z);
    grp.rotation.y = ry;
    const b = new THREE.Mesh(new THREE.BoxGeometry(2 * scale, 0.7 * scale, 4.6 * scale), body);
    b.position.y = 0.55 * scale;
    b.castShadow = true;
    grp.add(b);
    const c = new THREE.Mesh(new THREE.BoxGeometry(1.7 * scale, 0.65 * scale, 2.2 * scale), glass);
    c.position.y = 1.1 * scale;
    c.position.z = -0.1 * scale;
    c.castShadow = true;
    grp.add(c);
    for (const [wx, wz] of [[-0.8, 1.2], [0.8, 1.2], [-0.8, -1.4], [0.8, -1.4]]) {
      const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.38 * scale, 0.38 * scale, 0.25 * scale, 16), new THREE.MeshStandardMaterial({ color: 0x111, roughness: 0.9 }));
      wheel.rotation.z = Math.PI / 2;
      wheel.position.set(wx * scale, 0.38 * scale, wz * scale);
      grp.add(wheel);
    }
    this.scene.add(grp);
    const col = this.box(body, 2 * scale, 0.7 * scale, 4.6 * scale, x, 0, z, ry);
    this.colliders.push(col);
    this.aabbs.push(new THREE.Box3().setFromObject(col));
  }

  truck(x: number, z: number, ry = 0, color = 0x3a5a3a) {
    const body = new THREE.MeshStandardMaterial({ color, roughness: 0.5, metalness: 0.4 });
    const cab = new THREE.MeshStandardMaterial({ color: 0x2c4a2c, roughness: 0.4, metalness: 0.6 });
    const b = this.box(body, 2.4, 2.2, 7, x, 0, z, ry);
    const c = this.box(cab, 2.4, 1.6, 2.6, x + Math.sin(ry) * 3.3, 0, z + Math.cos(ry) * 3.3, ry);
    for (const [wx, wz] of [[-1, 2.2], [1, 2.2], [-1, -2.5], [1, -2.5]] as const) {
      const w = this.mesh(new THREE.MeshStandardMaterial({ color: 0x111, roughness: 0.9 }), new THREE.CylinderGeometry(0.5, 0.5, 0.3, 16), x + wx * Math.cos(ry) + wz * Math.sin(ry), 0.5, z - wx * Math.sin(ry) + wz * Math.cos(ry));
      w.rotation.z = Math.PI / 2;
      w.rotation.y = ry;
      this.scene.add(w);
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
    const m = this.box(mat, 6, 2.6, 2.5, x, y, z, ry);
    // corrugation lines via thin ribs
    const ribMat = new THREE.MeshStandardMaterial({ color: c.clone().multiplyScalar(0.75), roughness: 0.7 });
    for (let i = -2; i <= 2; i++) {
      const rib = new THREE.Mesh(new THREE.BoxGeometry(0.05, 2.6, 2.5), ribMat);
      rib.position.set(i * 1.15, 1.3, 0);
      rib.rotation.y = ry;
      m.add(rib);
    }
    this.scene.add(m);
    this.colliders.push(m);
    return m;
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
    const n = Math.max(2, Math.floor(len / 2.2));
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const px = x1 + (x2 - x1) * t;
      const pz = z1 + (z2 - z1) * t;
      const post = this.box(wood, 0.12, 1.4, 0.12, px, 0, pz, Math.atan2(ux, uz) - Math.PI / 2);
      this.scene.add(post);
    }
    for (const y of [0.7, 1.2]) {
      const rail = this.box(wood, len, 0.1, 0.06, (x1 + x2) / 2, y, (z1 + z2) / 2, Math.atan2(ux, uz) - Math.PI / 2);
      this.scene.add(rail);
    }
  }

  tree(x: number, z: number, s = 1) {
    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x5a3d22, roughness: 0.9 });
    const leafMat = new THREE.MeshStandardMaterial({ color: 0x3d5a2a, roughness: 0.9 });
    const trunk = this.mesh(trunkMat, new THREE.CylinderGeometry(0.2 * s, 0.32 * s, 2.4 * s, 8), x, 1.2 * s, z);
    this.scene.add(trunk);
    for (let i = 0; i < 4; i++) {
      const leaf = this.mesh(leafMat, new THREE.SphereGeometry((0.9 + this.rng() * 0.5) * s, 10, 8), x + (this.rng() - 0.5) * 1.4 * s, (2.6 + i * 0.45 + this.rng() * 0.5) * s, z + (this.rng() - 0.5) * 1.4 * s);
      this.scene.add(leaf);
    }
  }

  haystack(x: number, z: number) {
    const mat = new THREE.MeshStandardMaterial({ color: 0xc9a84a, roughness: 1 });
    const m = this.mesh(mat, new THREE.SphereGeometry(1.6, 12, 10), x, 1.1, z);
    m.scale.y = 0.8;
    this.scene.add(m);
  }

  streetlight(x: number, z: number, ry = 0) {
    const poleMat = new THREE.MeshStandardMaterial({ color: 0x2a2d30, roughness: 0.6, metalness: 0.8 });
    const pole = this.mesh(poleMat, new THREE.CylinderGeometry(0.09, 0.12, 5, 10), x, 2.5, z, ry);
    this.scene.add(pole);
    const arm = this.mesh(poleMat, new THREE.CylinderGeometry(0.05, 0.05, 1.6, 8), x + Math.sin(ry) * 0.9, 5, z + Math.cos(ry) * 0.9, ry + Math.PI / 2);
    this.scene.add(arm);
    const bulb = this.mesh(new THREE.MeshStandardMaterial({ color: 0xffe9b0, emissive: 0xffd98a, emissiveIntensity: 2.2 }), new THREE.SphereGeometry(0.14, 10, 8), x + Math.sin(ry) * 1.7, 4.95, z + Math.cos(ry) * 1.7);
    this.scene.add(bulb);
  }

  /* ---------------- industry ---------------- */
  craneTower(x: number, z: number, h: number, ry = 0) {
    const yellow = new THREE.MeshStandardMaterial({ color: 0xd8a81c, roughness: 0.5, metalness: 0.5 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x2a2a2a, roughness: 0.6, metalness: 0.7 });
    // mast
    const mast = this.box(yellow, 1.3, h, 1.3, x, 0, z, ry);
    // jib (long horizontal arm)
    const jibLen = 22;
    const jib = this.box(yellow, 0.8, 0.9, jibLen, x, h, z + Math.cos(ry) * 9, ry);
    const counter = this.box(yellow, 0.8, 0.9, 9, x, h, z - Math.cos(ry) * 4.5, ry);
    const cw = this.box(dark, 2.2, 1.6, 1.6, x - Math.sin(ry) * 4.5, h - 0.6, z - Math.cos(ry) * 4.5, ry);
    // cab
    const cab = this.box(yellow, 2, 2, 2.4, x + Math.sin(ry) * 1.6, h - 0.8, z + Math.cos(ry) * 1.6, ry);
    // hook cable + block
    const hookX = x + Math.sin(ry) * 10;
    const hookZ = z + Math.cos(ry) * 10;
    const cable = this.mesh(dark, new THREE.CylinderGeometry(0.03, 0.03, 6, 6), hookX, h - 3, hookZ);
    const block = this.box(dark, 0.7, 0.7, 0.7, hookX, h - 6.2, hookZ);
    this.scene.add(mast, jib, counter, cw, cab, cable, block);
    this.colliders.push(mast);
    const beacon = this.mesh(new THREE.MeshStandardMaterial({ color: 0xff2222, emissive: 0xff0000, emissiveIntensity: 3 }), new THREE.SphereGeometry(0.1, 8, 6), x, h + 0.3, z);
    this.scene.add(beacon);
    this.beacon(beacon, 3, this.rng() * 6);
    return { mast, x, z, h, ry };
  }

  craneGantry(x: number, z: number, h: number, span: number) {
    const yellow = new THREE.MeshStandardMaterial({ color: 0xd8a81c, roughness: 0.5, metalness: 0.5 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x2a2a2a, roughness: 0.6, metalness: 0.7 });
    for (const sx of [-1, 1]) {
      const leg = this.box(yellow, 0.7, h, 0.7, x + sx * span / 2, 0, z, 0);
      const leg2 = this.box(yellow, 0.7, h, 0.7, x + sx * span / 2, 0, z + 1.6, 0);
      this.scene.add(leg, leg2);
      this.colliders.push(leg, leg2);
    }
    const beam = this.box(yellow, 0.8, 0.9, span + 1, x, h, z + 0.8, 0);
    const cross = this.box(yellow, span + 1, 0.8, 0.8, x, h, z + 1.6, 0);
    this.scene.add(beam, cross);
    const trolley = this.box(dark, 1, 0.6, 0.8, x + 3, h - 0.8, z + 0.8, 0);
    this.scene.add(trolley);
  }

  excavator(x: number, z: number, ry = 0) {
    const yellow = new THREE.MeshStandardMaterial({ color: 0xd8a81c, roughness: 0.5, metalness: 0.4 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x222, roughness: 0.9 });
    const b = this.box(yellow, 2.4, 1, 3.6, x, 0.7, z, ry);
    const c = this.box(yellow, 1.8, 1.4, 1.6, x + Math.sin(ry) * 1.4, 1.4, z + Math.cos(ry) * 1.4, ry);
    const arm = this.box(yellow, 0.6, 0.6, 3.4, x + Math.sin(ry) * 2.4, 2.2, z + Math.cos(ry) * 2.4, ry);
    const bucket = this.box(dark, 1, 0.9, 1.2, x + Math.sin(ry) * 3.8, 1.2, z + Math.cos(ry) * 3.8, ry);
    this.scene.add(b, c, arm, bucket);
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
        const s = this.box(stepMat, stepW, stepH, stepD, lat + dir * i * stepW, y, z0, 0);
        this.scene.add(s);
        this.colliders.push(s);
        this.aabbs.push(new THREE.Box3().setFromObject(s));
        y += stepH;
      }
      // landing platform projecting from the wall at the flight top
      const landX = lat + dir * (perFlight - 1) * stepW + dir * stepW / 2;
      const land = this.box(metal, stepW + 0.5, 0.12, stepD + 0.35, landX, y, z0 + 0.05, 0);
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
    // hull (long in z, bow north): box + tapered bow
    const hull = this.box(hullMat, 10, 7, 44, x, 0, z, 0);
    const bow = this.mesh(hullMat, new THREE.CylinderGeometry(3.2, 5, 14, 18), x, 0, z - 25, 0);
    bow.rotation.x = Math.PI / 2;
    this.scene.add(hull, bow);
    // red waterline stripe
    const stripe = this.mesh(new THREE.MeshStandardMaterial({ color: 0x8a1c1c, roughness: 0.6, metalness: 0.4 }), new THREE.BoxGeometry(10.04, 0.45, 44.04), x, 0.05, z);
    this.scene.add(stripe);
    // waterline collider — blocks walking through the hull, shots at deck pass over
    this.colliders.push(this.box(hullMat, 14, 2.9, 44, x, -1.45, z, 0));
    // deck — walkable surface (top at y = 3.5)
    const deck = this.box(new THREE.MeshStandardMaterial({ color: 0x4a4036, roughness: 0.9 }), 14, 0.4, 42, x, 3.1, z, 0);
    this.scene.add(deck);
    this.colliders.push(deck);
    this.aabbs.push(new THREE.Box3().setFromObject(deck));
    // superstructure at stern (south end)
    const sup = this.box(superMat, 7, 4.5, 6, x, 3.5, z + 10, 0);
    this.scene.add(sup);
    this.colliders.push(sup);
    this.aabbs.push(new THREE.Box3().setFromObject(sup));
    const bridge = this.box(glass, 7.4, 2.2, 5, x, 8, z + 10, 0);
    this.scene.add(bridge);
    this.colliders.push(bridge);
    this.aabbs.push(new THREE.Box3().setFromObject(bridge));
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
    const pole = this.mesh(steel, new THREE.CylinderGeometry(0.12, 0.22, h, 10), x, h / 2, z);
    this.scene.add(pole);
    this.colliders.push(pole);
    // lattice ribs
    for (let i = 1; i <= 6; i++) {
      const r = 0.35 + (i / 6) * 0.5;
      const ring = this.mesh(steel, new THREE.TorusGeometry(r, 0.04, 6, 14), x, (i / 6) * h, z);
      ring.rotation.x = Math.PI / 2;
      this.scene.add(ring);
    }
    const dish = this.mesh(steel, new THREE.SphereGeometry(1.1, 16, 12, 0, Math.PI * 2, 0, Math.PI / 2.4), x, h, z);
    dish.rotation.x = -Math.PI / 2.4;
    dish.position.y = h + 0.3;
    this.scene.add(dish);
    const beacon = this.mesh(new THREE.MeshStandardMaterial({ color: 0xff2020, emissive: 0xff0000, emissiveIntensity: 4 }), new THREE.SphereGeometry(0.16, 8, 6), x, h + 1.6, z);
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
    // door + shutters
    const door = this.box(new THREE.MeshStandardMaterial({ color: 0x4a3320, roughness: 0.9 }), 1.1, 2, 0.12, x + Math.sin(ry) * (w / 2 - 0.6), 0, z + Math.cos(ry) * (d / 2 + 0.1), ry + Math.PI);
    this.scene.add(door);
  }

  church(x: number, z: number) {
    const stoneMat = new THREE.MeshStandardMaterial({ color: 0xd8d2c4, roughness: 0.95 });
    const roofMat = new THREE.MeshStandardMaterial({ color: 0x5a5a60, roughness: 0.8 });
    // nave
    this.solid(this.box(stoneMat, 9, 6, 13, x, 0, z), "concrete");
    // bell tower (east side)
    this.solid(this.box(stoneMat, 3.4, 13, 3.4, x + 6, 0, z + 4), "concrete");
    // pyramid tower roof
    const towerRoof = this.mesh(roofMat, new THREE.ConeGeometry(2.8, 2.6, 4), x + 6, 14.3, z + 4);
    towerRoof.rotation.y = Math.PI / 4;
    this.scene.add(towerRoof);
    // cross
    const cross1 = this.box(new THREE.MeshStandardMaterial({ color: 0x3a3328, roughness: 0.9 }), 0.15, 1.1, 0.15, x + 6, 16.3, z + 4);
    const cross1b = this.box(new THREE.MeshStandardMaterial({ color: 0x3a3328, roughness: 0.9 }), 0.7, 0.15, 0.15, x + 6, 16.6, z + 4);
    this.scene.add(cross1, cross1b);
    // main roof (gable)
    this.roof(x, z, 9.4, 13.4, 6, "gable", roofMat);
    // door
    const door = this.box(new THREE.MeshStandardMaterial({ color: 0x3a2a1a, roughness: 0.9 }), 1.4, 2.4, 0.15, x, 0, z + 6.7);
    this.scene.add(door);
    // bell (visible opening)
    const bell = this.mesh(new THREE.MeshStandardMaterial({ color: 0xb89a3a, roughness: 0.4, metalness: 0.8 }), new THREE.CylinderGeometry(0.5, 0.75, 0.9, 12), x + 6, 11.5, z + 4);
    this.scene.add(bell);
    // graveyard wall
    this.fence(x - 8, z + 8, x + 14, z + 8);
  }

  well(x: number, z: number) {
    const stone = new THREE.MeshStandardMaterial({ color: 0x9a9084, roughness: 0.95 });
    const ring = this.mesh(stone, new THREE.TorusGeometry(1.1, 0.22, 10, 20), x, 0.8, z);
    ring.rotation.x = Math.PI / 2;
    this.scene.add(ring);
    const roof = this.mesh(new THREE.MeshStandardMaterial({ color: 0x5a4030, roughness: 0.9 }), new THREE.ConeGeometry(1.6, 0.9, 8), x, 1.7, z);
    this.scene.add(roof);
    const post1 = this.box(stone, 0.2, 1.7, 0.2, x + 1, 0, z + 1.1);
    const post2 = this.box(stone, 0.2, 1.7, 0.2, x - 1, 0, z + 1.1);
    this.scene.add(post1, post2);
  }

  stall(x: number, z: number, ry = 0) {
    const wood = new THREE.MeshStandardMaterial({ color: 0x6b4f30, roughness: 0.9 });
    const awn = new THREE.MeshStandardMaterial({ color: 0x9a3b2a, roughness: 0.85 });
    this.box(wood, 2.4, 0.08, 2.4, x, 0.8, z, ry);
    for (const [px, pz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
      const post = this.box(wood, 0.1, 2, 0.1, x + px, 0, z + pz, ry);
      this.scene.add(post);
    }
    const shape = new THREE.Shape();
    shape.moveTo(-1.3, 0);
    shape.lineTo(1.3, 0);
    shape.lineTo(1.3, 0.4);
    shape.lineTo(-1.3, 0.4);
    shape.closePath();
    const g = new THREE.ExtrudeGeometry(shape, { depth: 2.4, bevelEnabled: false });
    g.translate(0, 0, -1.2);
    const roofM = this.mesh(awn, g, x, 2, z, ry);
    this.scene.add(roofM);
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
  return { ...w, aabbs, destroyables: [] as THREE.Mesh[] };
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

  // church + square
  K.church(-8, -18);

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

  // site office (rescue target)
  K.building({
    x: -18, z: -20, w: 8, d: 6, h: 3.4,
    facade: facade({ base: "#d8d2c4", glass: "#2a3a4a", frame: "#5a5048", glow: "#ffd98a", bayW: 1.8, floorH: 3, cols: 3, rows: 1, rng: K.rng, sign: "SITE OFFICE" }),
    roof: "flat",
    roofMat: new THREE.MeshStandardMaterial({ color: 0x4a5a3a, roughness: 0.9 }),
    emissive: 0.5,
  });

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

  // container stacks on dock
  K.containerRow(-16, -2, 3);
  K.containerRow(16, -2, 3);
  K.containerRow(-18, 10, 3, 0.1);
  K.containerRow(18, 10, 3, -0.1);

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
  return {
    colliders: K.colliders,
    targets: [],
    sun: ambient.sun,
    sunDir: ambient.sunDir,
    update,
    hitTarget: () => {},
    aabbs: K.aabbs,
    destroyables: K.destroyables,
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
