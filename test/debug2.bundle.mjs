var __defProp = Object.defineProperty;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __esm = (fn, res) => function __init() {
  return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};

// src/character/math.ts
import * as THREE from "three";
var Spring, _v;
var init_math = __esm({
  "src/character/math.ts"() {
    "use strict";
    Spring = class {
      constructor(k = 120, c = 14) {
        this.k = k;
        this.c = c;
      }
      k;
      c;
      x = 0;
      v = 0;
      update(target, dt) {
        const steps = Math.ceil(dt / 8e-3);
        const h = dt / steps;
        for (let i = 0; i < steps; i++) {
          const a = this.k * (target - this.x) - this.c * this.v;
          this.v += a * h;
          this.x += this.v * h;
        }
        return this.x;
      }
      kick(impulse) {
        this.v += impulse;
      }
      reset() {
        this.x = 0;
        this.v = 0;
      }
    };
    _v = {
      a: new THREE.Vector3(),
      b: new THREE.Vector3(),
      c: new THREE.Vector3(),
      d: new THREE.Vector3()
    };
  }
});

// src/game/world.ts
import * as THREE2 from "three";
import { Sky } from "three/examples/jsm/objects/Sky.js";
function noiseCanvas(size, base, speck, blotch = true) {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const g2 = c.getContext("2d");
  g2.fillStyle = base;
  g2.fillRect(0, 0, size, size);
  if (blotch) {
    for (let i = 0; i < 90; i++) {
      const x = Math.random() * size;
      const y = Math.random() * size;
      const r = 20 + Math.random() * 80;
      const gr = g2.createRadialGradient(x, y, 0, x, y, r);
      const a = 0.05 + Math.random() * 0.08;
      gr.addColorStop(0, Math.random() > 0.5 ? `rgba(0,0,0,${a})` : `rgba(255,255,255,${a * 0.7})`);
      gr.addColorStop(1, "rgba(0,0,0,0)");
      g2.fillStyle = gr;
      g2.fillRect(x - r, y - r, r * 2, r * 2);
    }
  }
  for (const [col, n] of speck) {
    g2.fillStyle = col;
    for (let i = 0; i < n; i++) {
      const s = Math.random() * 2 + 0.5;
      g2.fillRect(Math.random() * size, Math.random() * size, s, s);
    }
  }
  return c;
}
function tex(c, rep, srgb = true) {
  const t = new THREE2.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE2.RepeatWrapping;
  t.repeat.set(rep, rep);
  t.anisotropy = 16;
  if (srgb) t.colorSpace = THREE2.SRGBColorSpace;
  return t;
}
function buildWorld(content, main, renderer) {
  const sunDir = new THREE2.Vector3().setFromSphericalCoords(1, THREE2.MathUtils.degToRad(90 - 34), THREE2.MathUtils.degToRad(215));
  const skyScene = new THREE2.Scene();
  const sky = new Sky();
  sky.scale.setScalar(1e3);
  const u = sky.material.uniforms;
  u["turbidity"].value = 3.2;
  u["rayleigh"].value = 1.3;
  u["mieCoefficient"].value = 4e-3;
  u["mieDirectionalG"].value = 0.82;
  u["sunPosition"].value.copy(sunDir);
  skyScene.add(sky);
  const cubeRT = new THREE2.WebGLCubeRenderTarget(1024, { type: THREE2.HalfFloatType });
  const cubeCam = new THREE2.CubeCamera(1, 5e3, cubeRT);
  cubeCam.update(renderer, skyScene);
  main.background = cubeRT.texture;
  const pmrem = new THREE2.PMREMGenerator(renderer);
  main.environment = pmrem.fromCubemap(cubeRT.texture).texture;
  main.environmentIntensity = 0.45;
  main.fog = new THREE2.FogExp2(13225938, 45e-4);
  const sun = new THREE2.DirectionalLight(16771532, 4.2);
  sun.castShadow = true;
  sun.shadow.mapSize.set(4096, 4096);
  const sc = sun.shadow.camera;
  sc.left = -9;
  sc.right = 9;
  sc.top = 9;
  sc.bottom = -9;
  sc.near = 1;
  sc.far = 80;
  sun.shadow.bias = -25e-5;
  sun.shadow.normalBias = 0.03;
  sun.shadow.radius = 2.5;
  content.add(sun, sun.target);
  const hemi = new THREE2.HemisphereLight(14673646, 6970440, 0.18);
  content.add(hemi);
  const colliders = [];
  const targets = [];
  const gc = noiseCanvas(1024, "#8c8068", [["rgba(0,0,0,0.18)", 9e3], ["rgba(255,255,255,0.12)", 5e3], ["rgba(90,70,40,0.2)", 3e3]]);
  const gTex = tex(gc, 70);
  const bump = tex(gc, 70, false);
  const ground = new THREE2.Mesh(
    new THREE2.PlaneGeometry(400, 400),
    new THREE2.MeshStandardMaterial({ map: gTex, bumpMap: bump, bumpScale: 1.6, roughness: 0.96, metalness: 0 })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  ground.userData.kind = "dirt";
  content.add(ground);
  colliders.push(ground);
  const ac = noiseCanvas(1024, "#55575a", [["rgba(255,255,255,0.1)", 9e3], ["rgba(0,0,0,0.35)", 6e3]]);
  const ag = ac.getContext("2d");
  ag.strokeStyle = "rgba(10,10,10,0.55)";
  ag.lineWidth = 1.5;
  for (let i = 0; i < 14; i++) {
    ag.beginPath();
    let x = Math.random() * 1024;
    let y = Math.random() * 1024;
    ag.moveTo(x, y);
    for (let j = 0; j < 8; j++) {
      x += (Math.random() - 0.5) * 90;
      y += (Math.random() - 0.5) * 90;
      ag.lineTo(x, y);
    }
    ag.stroke();
  }
  const aTex = tex(ac, 8);
  const pad = new THREE2.Mesh(
    new THREE2.PlaneGeometry(26, 90),
    new THREE2.MeshStandardMaterial({ map: aTex, bumpMap: tex(ac, 8, false), bumpScale: 0.8, roughness: 0.88, metalness: 0 })
  );
  pad.rotation.x = -Math.PI / 2;
  pad.position.set(0, 4e-3, 25);
  pad.receiveShadow = true;
  pad.userData.kind = "concrete";
  content.add(pad);
  colliders.push(pad);
  const paint = new THREE2.MeshStandardMaterial({ color: 14210244, roughness: 0.7 });
  const addPaint = (w, l, x, z) => {
    const m = new THREE2.Mesh(new THREE2.PlaneGeometry(w, l), paint);
    m.rotation.x = -Math.PI / 2;
    m.position.set(x, 8e-3, z);
    m.receiveShadow = true;
    content.add(m);
  };
  [-9, 0, 9].forEach((x) => {
    for (let z = -10; z < 66; z += 5) addPaint(0.12, 2.6, x, z + 1.5);
  });
  [10, 18, 26, 34].forEach((z) => addPaint(26, 0.14, 0, z));
  const add = (m, kind) => {
    m.castShadow = true;
    m.receiveShadow = true;
    m.userData.kind = kind;
    content.add(m);
    colliders.push(m);
    return m;
  };
  const concrete = new THREE2.MeshStandardMaterial({ map: tex(noiseCanvas(512, "#a09c94", [["rgba(0,0,0,0.25)", 5e3], ["rgba(255,255,255,0.15)", 3e3]]), 6), roughness: 0.92 });
  const wall = new THREE2.Mesh(new THREE2.BoxGeometry(80, 7, 3), concrete);
  wall.position.set(0, 3.5, 52);
  add(wall, "concrete");
  const sideL = new THREE2.Mesh(new THREE2.BoxGeometry(3, 5, 70), concrete);
  sideL.position.set(-26, 2.5, 18);
  add(sideL, "concrete");
  const sideR = sideL.clone();
  sideR.position.x = 26;
  add(sideR, "concrete");
  const wc = noiseCanvas(512, "#8a6a43", [["rgba(40,25,10,0.35)", 6e3], ["rgba(255,220,160,0.12)", 2500]]);
  const wg = wc.getContext("2d");
  wg.strokeStyle = "rgba(30,18,8,0.7)";
  wg.lineWidth = 5;
  for (let i = 1; i < 5; i++) {
    wg.beginPath();
    wg.moveTo(0, i * 512 / 5);
    wg.lineTo(512, i * 512 / 5);
    wg.stroke();
  }
  wg.strokeRect(6, 6, 500, 500);
  wg.beginPath();
  wg.moveTo(6, 6);
  wg.lineTo(506, 506);
  wg.stroke();
  const woodMat = new THREE2.MeshStandardMaterial({ map: tex(wc, 1), roughness: 0.82 });
  const crate = (x, z, s, ry = 0, y = 0) => {
    const m = new THREE2.Mesh(new THREE2.BoxGeometry(s, s, s), woodMat);
    m.position.set(x, y + s / 2, z);
    m.rotation.y = ry;
    add(m, "wood");
  };
  crate(-6.5, 8, 1.1, 0.3);
  crate(-6.9, 9.3, 0.9, -0.2);
  crate(-6.6, 8.4, 0.8, 0.8, 1.1);
  crate(7.5, 14, 1.2, -0.4);
  crate(8.8, 14.6, 1, 0.2);
  crate(-8, 20, 1.3, 0.5);
  const barrelMat = new THREE2.MeshStandardMaterial({ color: 10169378, roughness: 0.5, metalness: 0.7 });
  const barrel = (x, z, mat = barrelMat) => {
    const m = new THREE2.Mesh(new THREE2.CylinderGeometry(0.3, 0.3, 0.9, 28), mat);
    m.position.set(x, 0.45, z);
    add(m, "metal");
    [-0.28, 0, 0.28].forEach((y) => {
      const r = new THREE2.Mesh(new THREE2.TorusGeometry(0.302, 0.012, 8, 28), mat);
      r.rotation.x = Math.PI / 2;
      r.position.y = y;
      m.add(r);
    });
  };
  barrel(5.5, 8);
  barrel(6.2, 8.6);
  barrel(-4.5, 15, new THREE2.MeshStandardMaterial({ color: 3099502, roughness: 0.5, metalness: 0.7 }));
  const barrier = (x, z, ry = 0) => {
    const shape = new THREE2.Shape();
    shape.moveTo(-0.4, 0);
    shape.lineTo(0.4, 0);
    shape.lineTo(0.22, 0.28);
    shape.lineTo(0.13, 0.8);
    shape.lineTo(-0.13, 0.8);
    shape.lineTo(-0.22, 0.28);
    shape.closePath();
    const g2 = new THREE2.ExtrudeGeometry(shape, { depth: 2.2, bevelEnabled: false });
    g2.translate(0, 0, -1.1);
    const m = new THREE2.Mesh(g2, concrete);
    m.position.set(x, 0, z);
    m.rotation.y = ry + Math.PI / 2;
    add(m, "concrete");
  };
  barrier(3, 5.5, 0.1);
  barrier(-3.2, 11, -0.1);
  barrier(0, 16.5, Math.PI / 2 + 0.05);
  const steel = new THREE2.MeshStandardMaterial({ color: 4869973, roughness: 0.42, metalness: 0.9 });
  const rc = document.createElement("canvas");
  rc.width = rc.height = 256;
  const rg = rc.getContext("2d");
  ["#c8202a", "#f1f1f1", "#c8202a", "#f1f1f1", "#c8202a"].forEach((col, i) => {
    rg.fillStyle = col;
    rg.beginPath();
    rg.arc(128, 128, 126 - i * 25, 0, Math.PI * 2);
    rg.fill();
  });
  const rTex = new THREE2.CanvasTexture(rc);
  rTex.colorSpace = THREE2.SRGBColorSpace;
  const faceMat = new THREE2.MeshStandardMaterial({ map: rTex, roughness: 0.5, metalness: 0.5 });
  const plate = (x, z, r = 0.32) => {
    const grp = new THREE2.Group();
    grp.position.set(x, 0, z);
    const hinge = new THREE2.Group();
    hinge.position.y = 0.3;
    grp.add(hinge);
    const disc = new THREE2.Mesh(new THREE2.CylinderGeometry(r, r, 0.03, 40), [steel, faceMat, steel]);
    disc.rotation.x = -Math.PI / 2;
    disc.position.y = 0.55 + r - 0.3;
    disc.castShadow = true;
    disc.receiveShadow = true;
    disc.userData.kind = "metal";
    disc.userData.target = hinge;
    hinge.add(disc);
    disc.rotation.x = -Math.PI / 2;
    const post = new THREE2.Mesh(new THREE2.BoxGeometry(0.05, 0.9, 0.05), steel);
    post.position.set(-r - 0.08, 0.45, 0.06);
    post.castShadow = true;
    grp.add(post);
    const post2 = post.clone();
    post2.position.x = r + 0.08;
    grp.add(post2);
    const bar = new THREE2.Mesh(new THREE2.BoxGeometry(2 * r + 0.21, 0.05, 0.05), steel);
    bar.position.set(0, 0.88, 0.06);
    bar.castShadow = true;
    grp.add(bar);
    const base = new THREE2.Mesh(new THREE2.BoxGeometry(2 * r + 0.4, 0.04, 0.5), steel);
    base.position.y = 0.02;
    base.receiveShadow = true;
    grp.add(base);
    content.add(grp);
    colliders.push(disc);
    targets.push({ group: hinge, spring: new Spring(60, 3.5), spin: new Spring(0, 0), baseRotX: 0 });
  };
  plate(-3, 14);
  plate(3.2, 18, 0.28);
  plate(-1, 24, 0.34);
  plate(5, 28, 0.3);
  plate(-5.5, 32, 0.36);
  plate(1.6, 36, 0.4);
  const signMat = new THREE2.MeshStandardMaterial({ color: 15251476, roughness: 0.6 });
  [10, 18, 26, 34].forEach((z) => {
    const post = new THREE2.Mesh(new THREE2.CylinderGeometry(0.03, 0.03, 1.6, 8), steel);
    post.position.set(-11.5, 0.8, z);
    post.castShadow = true;
    content.add(post);
    const sign = new THREE2.Mesh(new THREE2.BoxGeometry(0.5, 0.35, 0.03), signMat);
    sign.position.set(-11.5, 1.55, z);
    sign.castShadow = true;
    content.add(sign);
  });
  const update = (dt, focus) => {
    sun.position.copy(focus).addScaledVector(sunDir, 40);
    sun.target.position.copy(focus);
    for (const t of targets) {
      const x = t.spring.update(0, dt);
      t.group.rotation.x = x;
    }
  };
  const hitTarget = (mesh, impulse) => {
    const hinge = mesh.userData.target;
    if (!hinge) return;
    const t = targets.find((tt) => tt.group === hinge);
    t?.spring.kick(impulse);
  };
  return { colliders, targets, sun, sunDir, update, hitTarget };
}
var init_world = __esm({
  "src/game/world.ts"() {
    "use strict";
    init_math();
  }
});

// src/game/levels.ts
var levels_exports = {};
__export(levels_exports, {
  buildLevel: () => buildLevel
});
import * as THREE3 from "three";
import { Sky as Sky2 } from "three/examples/jsm/objects/Sky.js";
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = a + 1831565813 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
function noiseCanvas2(size, base, speck, rng) {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const g2 = c.getContext("2d");
  g2.fillStyle = base;
  g2.fillRect(0, 0, size, size);
  for (let i = 0; i < 70; i++) {
    const x = rng() * size;
    const y = rng() * size;
    const r = 15 + rng() * 70;
    const gr = g2.createRadialGradient(x, y, 0, x, y, r);
    const a = 0.04 + rng() * 0.07;
    gr.addColorStop(0, rng() > 0.5 ? `rgba(0,0,0,${a})` : `rgba(255,255,255,${a * 0.7})`);
    gr.addColorStop(1, "rgba(0,0,0,0)");
    g2.fillStyle = gr;
    g2.fillRect(x - r, y - r, r * 2, r * 2);
  }
  for (const [col, n] of speck) {
    g2.fillStyle = col;
    for (let i = 0; i < n; i++) {
      const s = rng() * 2 + 0.5;
      g2.fillRect(rng() * size, rng() * size, s, s);
    }
  }
  return c;
}
function toTex(c, rep, srgb = true) {
  const t = new THREE3.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE3.RepeatWrapping;
  t.repeat.set(rep, rep);
  t.anisotropy = 16;
  if (srgb) t.colorSpace = THREE3.SRGBColorSpace;
  return t;
}
function facade(o) {
  const px = 256;
  const cy = px / o.rows;
  const color = document.createElement("canvas");
  color.width = color.height = px;
  const glow = document.createElement("canvas");
  glow.width = glow.height = px;
  const gc = color.getContext("2d");
  const gg = glow.getContext("2d");
  gc.fillStyle = o.base;
  gc.fillRect(0, 0, px, px);
  gg.fillStyle = "#000";
  gg.fillRect(0, 0, px, px);
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
      if (o.rng() < 0.12) continue;
      const x = c * (px / o.cols) + px / o.cols * 0.18;
      const y = r * cy + cy * 0.22;
      const w = px / o.cols * 0.64;
      const h = cy * 0.56;
      gc.fillStyle = o.glass;
      gc.fillRect(x, y, w, h);
      gc.strokeStyle = o.frame;
      gc.lineWidth = 2;
      gc.strokeRect(x, y, w, h);
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
    map: new THREE3.CanvasTexture(color),
    glow: new THREE3.CanvasTexture(glow),
    tileW,
    tileH: o.floorH * o.rows
  };
}
function setupAmbient(scene, renderer, c) {
  renderer.toneMappingExposure = c.exposure;
  const sunDir = new THREE3.Vector3().setFromSphericalCoords(
    1,
    THREE3.MathUtils.degToRad(90 - c.sunElev),
    THREE3.MathUtils.degToRad(c.sunAzim)
  );
  const skyScene = new THREE3.Scene();
  const sky = new Sky2();
  sky.scale.setScalar(1e4);
  const u = sky.material.uniforms;
  u["turbidity"].value = c.turbidity;
  u["rayleigh"].value = c.rayleigh;
  u["mieCoefficient"].value = 4e-3;
  u["mieDirectionalG"].value = 0.82;
  u["sunPosition"].value.copy(sunDir);
  skyScene.add(sky);
  const cubeRT = new THREE3.WebGLCubeRenderTarget(1024, { type: THREE3.HalfFloatType });
  const cubeCam = new THREE3.CubeCamera(1, 1e4, cubeRT);
  cubeCam.update(renderer, skyScene);
  scene.background = cubeRT.texture;
  const pmrem = new THREE3.PMREMGenerator(renderer);
  scene.environment = pmrem.fromCubemap(cubeRT.texture).texture;
  scene.environmentIntensity = c.envIntensity;
  scene.fog = new THREE3.FogExp2(c.fogColor, c.fogDensity);
  let stars = null;
  if (c.stars) {
    const starGeo = new THREE3.BufferGeometry();
    const n = 2600;
    const pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const v = new THREE3.Vector3().setFromSphericalCoords(1, Math.random() * 0.9, Math.random() * Math.PI * 2);
      v.multiplyScalar(2200 + Math.random() * 1500);
      pos[i * 3] = v.x;
      pos[i * 3 + 1] = Math.abs(v.y) * 0.8 + 40;
      pos[i * 3 + 2] = v.z;
    }
    starGeo.setAttribute("position", new THREE3.BufferAttribute(pos, 3));
    stars = new THREE3.Points(starGeo, new THREE3.PointsMaterial({ color: 14674175, size: 2.4, sizeAttenuation: false, transparent: true, opacity: 0.9, fog: false }));
  }
  const sun = new THREE3.DirectionalLight(c.sunColor, c.sunIntensity);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const sc = sun.shadow.camera;
  sc.left = -22;
  sc.right = 22;
  sc.top = 22;
  sc.bottom = -22;
  sc.near = 1;
  sc.far = c.shadowFar ?? 90;
  sun.shadow.bias = -3e-4;
  sun.shadow.normalBias = 0.03;
  sun.shadow.radius = 2.5;
  const hemi = new THREE3.HemisphereLight(c.hemiSky, c.hemiGround, c.hemiIntensity);
  const update = (_dt, focus) => {
    sun.position.copy(focus).addScaledVector(sunDir, 45);
    sun.target.position.copy(focus);
  };
  return { sun, hemi, stars, sunDir, update };
}
function buildRange(content, main, renderer) {
  const w = buildWorld(content, main, renderer);
  const aabbs = [];
  for (const c of w.colliders) {
    c.updateWorldMatrix(true, false);
    aabbs.push(new THREE3.Box3().setFromObject(c));
  }
  return { ...w, aabbs, destroyables: [] };
}
function buildVillage(content, main, renderer) {
  const K = new Kit(content, 1337);
  const ambient = setupAmbient(main, renderer, {
    sunElev: 9,
    sunAzim: 62,
    turbidity: 4.5,
    rayleigh: 1.6,
    fogColor: 14267535,
    fogDensity: 65e-4,
    hemiSky: 10335432,
    hemiGround: 5588527,
    hemiIntensity: 0.55,
    sunColor: 16767392,
    sunIntensity: 3.4,
    envIntensity: 0.5,
    exposure: 1.05,
    shadowFar: 100
  });
  content.add(ambient.sun, ambient.hemi);
  if (ambient.stars) content.add(ambient.stars);
  const gc = noiseCanvas2(1024, "#5a6b3a", [["rgba(120,130,80,0.35)", 9e3], ["rgba(90,100,55,0.3)", 7e3], ["rgba(80,60,35,0.15)", 4e3]], K.rng);
  const gTex = toTex(gc, 90);
  K.ground(400, new THREE3.MeshStandardMaterial({ map: gTex, bumpMap: toTex(gc, 90, false), bumpScale: 1.4, roughness: 0.97, metalness: 0 }));
  const rc = noiseCanvas2(512, "#7a6848", [["rgba(0,0,0,0.2)", 8e3], ["rgba(255,230,190,0.08)", 4e3]], K.rng);
  const road = K.mesh(new THREE3.MeshStandardMaterial({ map: toTex(rc, 14), bumpMap: toTex(rc, 14, false), bumpScale: 1, roughness: 0.98 }), new THREE3.PlaneGeometry(7, 100), 0, 0.02, 10);
  road.rotation.x = -Math.PI / 2;
  road.receiveShadow = true;
  content.add(road);
  K.houseVillage(-13, -2, 7, 8, 4.5, 0.2);
  K.houseVillage(-13, 6, 7, 8, 4, -0.1);
  K.houseVillage(-14, 18, 7, 8, 4.5, 0.3);
  K.houseVillage(-13, 30, 8, 8, 4, -0.2);
  K.houseVillage(13, -8, 8, 8, 4.5, -0.2);
  K.houseVillage(14, 4, 7, 8, 4, 0.1);
  K.houseVillage(13, 16, 7, 8, 4.5, 0.25);
  K.houseVillage(14, 28, 8, 8, 4, -0.15);
  K.houseVillage(-10, -26, 7, 7, 3.8, 0.15);
  K.church(-8, -18);
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
  const woodMat = new THREE3.MeshStandardMaterial({ color: 9071171, roughness: 0.82 });
  K.crate(woodMat, -6.5, 16, 1.1, 0.3);
  K.crate(woodMat, 7, -10, 1.2, -0.4);
  K.crate(woodMat, 8, 10, 1, 0.2);
  K.crate(woodMat, -8, -28, 1.1, 0.5);
  K.sandbag(4, 30, 0.2, 4);
  K.sandbag(-4, 30, -0.2, 4);
  K.sandbag(6, -20, 0.1, 4);
  const hillMat = new THREE3.MeshStandardMaterial({ color: 4872760, roughness: 1, flatShading: true });
  for (let i = 0; i < 14; i++) {
    const a = i / 14 * Math.PI * 2;
    const r = 48 + K.rng() * 12;
    const h = 12 + K.rng() * 14;
    const hill = K.mesh(hillMat, new THREE3.SphereGeometry(h * 0.9, 10, 8), Math.cos(a) * r, h * 0.35, Math.sin(a) * r);
    hill.scale.y = 0.5;
    content.add(hill);
  }
  return finish(K, ambient);
}
function buildConstruction(content, main, renderer) {
  const K = new Kit(content, 4242);
  const ambient = setupAmbient(main, renderer, {
    sunElev: 48,
    sunAzim: 210,
    turbidity: 8,
    rayleigh: 0.8,
    fogColor: 12107199,
    fogDensity: 6e-3,
    hemiSky: 13225170,
    hemiGround: 6971992,
    hemiIntensity: 0.75,
    sunColor: 16052972,
    sunIntensity: 2.4,
    envIntensity: 0.4,
    exposure: 1,
    shadowFar: 90
  });
  content.add(ambient.sun, ambient.hemi);
  if (ambient.stars) content.add(ambient.stars);
  const gc = noiseCanvas2(1024, "#8a847c", [["rgba(0,0,0,0.14)", 9e3], ["rgba(255,255,255,0.08)", 4e3]], K.rng);
  K.ground(300, new THREE3.MeshStandardMaterial({ map: toTex(gc, 40), bumpMap: toTex(gc, 40, false), bumpScale: 0.9, roughness: 0.95 }));
  const mud = K.mesh(new THREE3.MeshStandardMaterial({ color: 5917240, roughness: 1 }), new THREE3.PlaneGeometry(20, 14), -14, 0.02, 4);
  mud.rotation.x = -Math.PI / 2;
  mud.receiveShadow = true;
  content.add(mud);
  const jointMat = new THREE3.MeshStandardMaterial({ color: 2763306, roughness: 0.9 });
  for (let z = -40; z <= 40; z += 8) {
    const j = K.mesh(jointMat, new THREE3.PlaneGeometry(60, 0.12), 0, 0.03, z);
    j.rotation.x = -Math.PI / 2;
    content.add(j);
  }
  const concrete = new THREE3.MeshStandardMaterial({ color: 11841704, roughness: 0.92 });
  const concreteDark = new THREE3.MeshStandardMaterial({ color: 9078398, roughness: 0.95 });
  const bx = 0, bz = -16, bw = 18, bd = 14;
  for (let f = 1; f <= 3; f++) {
    const slab = K.box(concrete, bw, 0.4, bd, bx, f * 3, bz);
    slab.receiveShadow = true;
    content.add(slab);
    for (const [cx, cz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      const col = K.box(concreteDark, 0.6, f * 3, 0.6, bx + cx * (bw / 2 - 0.6), 0, bz + cz * (bd / 2 - 0.6));
      content.add(col);
    }
    if (f === 3) {
      for (let i = 0; i < 24; i++) {
        const rx = bx + (K.rng() - 0.5) * bw * 0.85;
        const rz = bz + (K.rng() - 0.5) * bd * 0.85;
        const rb = K.mesh(new THREE3.MeshStandardMaterial({ color: 5591120, roughness: 0.7, metalness: 0.6 }), new THREE3.CylinderGeometry(0.04, 0.04, 1.6, 6), rx, 9.8, rz);
        content.add(rb);
      }
    }
  }
  K.colliders.push(K.box(concrete, bw, 12, bd, bx, 0, bz));
  K.aabbs.push(new THREE3.Box3(new THREE3.Vector3(bx - bw / 2, 0, bz - bd / 2), new THREE3.Vector3(bx + bw / 2, 12, bz + bd / 2)));
  K.craneTower(-6, -16, 17, 0.1);
  K.craneTower(8, -16, 17, -0.1);
  const scaffoldMat = new THREE3.MeshStandardMaterial({ color: 13152288, roughness: 0.7, metalness: 0.5 });
  for (let i = 0; i < 14; i++) {
    const px = 8 + i % 4 * 1.2;
    const pz = -30 + Math.floor(i / 4) * 1.2;
    const pole = K.mesh(scaffoldMat, new THREE3.CylinderGeometry(0.06, 0.06, 9, 6), px, 4.5, pz);
    content.add(pole);
  }
  for (let y = 1.5; y <= 7.5; y += 1.5) {
    for (const px of [8, 9.2, 10.4, 11.6]) {
      const bar = K.mesh(scaffoldMat, new THREE3.CylinderGeometry(0.04, 0.04, 3.6, 6), px, y, -30);
      bar.rotation.z = Math.PI / 2;
      content.add(bar);
    }
  }
  K.building({
    x: -18,
    z: -20,
    w: 8,
    d: 6,
    h: 3.4,
    facade: facade({ base: "#d8d2c4", glass: "#2a3a4a", frame: "#5a5048", glow: "#ffd98a", bayW: 1.8, floorH: 3, cols: 3, rows: 1, rng: K.rng, sign: "SITE OFFICE" }),
    roof: "flat",
    roofMat: new THREE3.MeshStandardMaterial({ color: 4872762, roughness: 0.9 }),
    emissive: 0.5
  });
  K.containerRow(-18, 2, 4);
  K.containerRow(12, 18, 4);
  K.containerRow(-16, 22, 3);
  K.excavator(-14, 4, 0.4);
  for (const [gx, gz] of [[14, 24], [-12, 16], [6, 12]]) {
    const pile = K.mesh(new THREE3.MeshStandardMaterial({ color: 8024680, roughness: 1, flatShading: true }), new THREE3.ConeGeometry(2.4, 2.2, 8), gx, 1.1, gz);
    content.add(pile);
  }
  const pipeMat = new THREE3.MeshStandardMaterial({ color: 9079434, roughness: 0.5, metalness: 0.7 });
  for (let i = 0; i < 8; i++) {
    const pipe = K.mesh(pipeMat, new THREE3.CylinderGeometry(0.3, 0.3, 4, 12), -18 + i * 1.5, 0.3, 6);
    pipe.rotation.z = Math.PI / 2;
    pipe.rotation.y = K.rng() * 0.6;
    content.add(pipe);
  }
  const jammerMat = new THREE3.MeshStandardMaterial({ color: 9051164, roughness: 0.6, metalness: 0.3 });
  for (const [jx, jz] of [[16, -6], [-16, -8], [0, -34]]) {
    const grp = new THREE3.Group();
    grp.position.set(jx, 0, jz);
    const box = new THREE3.Mesh(new THREE3.BoxGeometry(1.6, 1.6, 1.6), jammerMat);
    box.position.y = 0.8;
    box.castShadow = true;
    box.receiveShadow = true;
    box.userData.kind = "metal";
    box.userData.destroyable = true;
    grp.add(box);
    const mast = new THREE3.Mesh(new THREE3.CylinderGeometry(0.05, 0.05, 4, 8), pipeMat);
    mast.position.y = 2.8;
    grp.add(mast);
    const b = new THREE3.Mesh(new THREE3.SphereGeometry(0.14, 8, 6), new THREE3.MeshStandardMaterial({ color: 16719904, emissive: 16711680, emissiveIntensity: 3 }));
    b.position.y = 4.9;
    grp.add(b);
    content.add(grp);
    K.colliders.push(box);
    K.destroyables.push(box);
    K.beacon(b, 4, K.rng() * 6);
  }
  const barrierMat = new THREE3.MeshStandardMaterial({ color: 14200860, roughness: 0.7 });
  for (let x = -30; x <= 30; x += 5) {
    const b = K.box(barrierMat, 1.8, 0.8, 0.2, x, 0, 48);
    content.add(b);
    const b2 = K.box(barrierMat, 1.8, 0.8, 0.2, x, 0, -42);
    content.add(b2);
  }
  K.barrel(new THREE3.MeshStandardMaterial({ color: 10169378, roughness: 0.5, metalness: 0.7 }), -6, 30);
  K.barrel(new THREE3.MeshStandardMaterial({ color: 3099502, roughness: 0.5, metalness: 0.7 }), -6.6, 30.6);
  K.barrel(new THREE3.MeshStandardMaterial({ color: 10169378, roughness: 0.5, metalness: 0.7 }), 6, 30);
  const wc = noiseCanvas2(512, "#8a6a43", [["rgba(40,25,10,0.35)", 6e3]], K.rng);
  const woodMat = new THREE3.MeshStandardMaterial({ map: toTex(wc, 1), roughness: 0.82 });
  K.crate(woodMat, 18, 12, 1.2, 0.3);
  K.crate(woodMat, -18, 14, 1.1, -0.2);
  return finish(K, ambient);
}
function buildDowntown(content, main, renderer) {
  const K = new Kit(content, 90210);
  const ambient = setupAmbient(main, renderer, {
    sunElev: 7,
    sunAzim: 265,
    turbidity: 6,
    rayleigh: 1.8,
    fogColor: 11041626,
    fogDensity: 65e-4,
    hemiSky: 9083568,
    hemiGround: 4864556,
    hemiIntensity: 0.6,
    sunColor: 16751194,
    sunIntensity: 3,
    envIntensity: 0.45,
    exposure: 1,
    shadowFar: 100
  });
  content.add(ambient.sun, ambient.hemi);
  if (ambient.stars) content.add(ambient.stars);
  const gc = noiseCanvas2(1024, "#4a4c4e", [["rgba(255,255,255,0.06)", 9e3], ["rgba(0,0,0,0.3)", 6e3]], K.rng);
  K.ground(300, new THREE3.MeshStandardMaterial({ map: toTex(gc, 60), bumpMap: toTex(gc, 60, false), bumpScale: 1.1, roughness: 0.93 }));
  const sideMat = new THREE3.MeshStandardMaterial({ color: 8025712, roughness: 0.95 });
  for (const sx of [-10, 10]) {
    for (let z = -34; z <= 42; z += 2) {
      const sw = K.box(sideMat, 0.6, 0.15, 2, sx + (sx < 0 ? -0.3 : 0.3), 0, z);
      sw.receiveShadow = true;
      sw.receiveShadow = true;
      K.scene.add(sw);
    }
  }
  const paintMat = new THREE3.MeshStandardMaterial({ color: 14210244, roughness: 0.7 });
  for (let z = -32; z <= 46; z += 6) {
    const dash = K.mesh(paintMat, new THREE3.PlaneGeometry(0.14, 3), 0, 0.03, z);
    dash.rotation.x = -Math.PI / 2;
    K.scene.add(dash);
  }
  const concreteF = facade({ base: "#9a968e", glass: "#1e242c", frame: "#4a4a50", glow: "#ffd27a", bayW: 1.8, floorH: 3.2, cols: 4, rows: 4, rng: K.rng });
  const brickF = facade({ base: "#8a5a44", glass: "#1e242c", frame: "#3a3a40", glow: "#ffd27a", bayW: 1.8, floorH: 3.2, cols: 4, rows: 4, rng: K.rng });
  const glassF = facade({ base: "#3a4450", glass: "#0e141c", frame: "#5a6068", glow: "#ffca7a", bayW: 2, floorH: 3.4, cols: 4, rows: 3, rng: K.rng });
  const roofSlab = new THREE3.MeshStandardMaterial({ color: 5921376, roughness: 0.85 });
  const B = (x, z, w, d, h, f, collideTo) => K.building({ x, z, w, d, h, facade: f, roof: "flat", roofMat: roofSlab, parapet: true, details: true, emissive: 0.85, collideTo });
  B(-15, -4, 12, 10, 26, concreteF);
  B(15, -4, 10, 10, 30, concreteF, 28.4);
  B(-15, 20, 12, 12, 22, brickF);
  B(15, 18, 10, 12, 26, concreteF);
  B(-15, 36, 12, 10, 20, brickF);
  B(15, 36, 10, 10, 22, concreteF);
  B(-8, -28, 10, 10, 24, glassF, 22.4);
  B(8, -28, 10, 10, 24, glassF);
  K.relayTower(18, -26, 13);
  for (let z = -28; z <= 44; z += 12) {
    K.streetlight(-9.4, z, 0);
    K.streetlight(9.4, z, 0);
  }
  K.car(-6, 30, 0.4, 3037836);
  K.car(6, 30, -0.2, 9058874);
  K.car(-6, -14, 0.5, 5921370);
  K.car(-6, 8, 0.1, 3041866);
  K.car(6, 16, -0.4, 9075246);
  K.car(-6, 22, 0.2, 3816026);
  const farMat = new THREE3.MeshStandardMaterial({ color: 4869976, roughness: 0.9 });
  for (let i = 0; i < 12; i++) {
    const fx = -70 + i * 12 + K.rng() * 6;
    const fz = -50 - K.rng() * 20;
    const fh = 25 + K.rng() * 55;
    const fb = K.box(farMat, 8 + K.rng() * 8, fh, 8 + K.rng() * 8, fx, 0, fz);
    K.scene.add(fb);
  }
  const mt = K.box(new THREE3.MeshStandardMaterial({ color: 5923440, roughness: 0.85, emissive: 1712688, emissiveIntensity: 0.6 }), 16, 78, 16, -58, 0, -56);
  K.scene.add(mt);
  const mtSign = K.mesh(new THREE3.MeshStandardMaterial({ color: 14200860, emissive: 14200860, emissiveIntensity: 0.8 }), new THREE3.PlaneGeometry(10, 3), -58, 41, -56);
  mtSign.rotation.y = Math.PI;
  K.scene.add(mtSign);
  K.sandbag(-7, 16, 0, 4);
  K.sandbag(7, -16, 0, 4);
  K.crate(new THREE3.MeshStandardMaterial({ color: 9071171, roughness: 0.82 }), 0, 28, 1.1, 0.2);
  K.crate(new THREE3.MeshStandardMaterial({ color: 9071171, roughness: 0.82 }), -3, -20, 1, -0.3);
  return finish(K, ambient);
}
function buildPort(content, main, renderer) {
  const K = new Kit(content, 5150);
  const ambient = setupAmbient(main, renderer, {
    sunElev: 3,
    sunAzim: 235,
    turbidity: 5,
    rayleigh: 1,
    fogColor: 329485,
    fogDensity: 0.011,
    hemiSky: 1713206,
    hemiGround: 329740,
    hemiIntensity: 0.3,
    sunColor: 2766928,
    sunIntensity: 0.35,
    envIntensity: 0.15,
    exposure: 1.15,
    stars: true,
    shadowFar: 90
  });
  content.add(ambient.sun, ambient.hemi);
  if (ambient.stars) content.add(ambient.stars);
  const dc = noiseCanvas2(1024, "#6a6a64", [["rgba(0,0,0,0.2)", 8e3], ["rgba(255,255,255,0.05)", 4e3]], K.rng);
  const deck = K.mesh(new THREE3.MeshStandardMaterial({ map: toTex(dc, 40), bumpMap: toTex(dc, 40, false), bumpScale: 1, roughness: 0.93 }), new THREE3.PlaneGeometry(90, 70), 0, 0, 21);
  deck.rotation.x = -Math.PI / 2;
  deck.receiveShadow = true;
  K.scene.add(deck);
  K.colliders.push(deck);
  K.water(400);
  const edge = K.mesh(new THREE3.MeshStandardMaterial({ color: 2763306, roughness: 0.9 }), new THREE3.PlaneGeometry(90, 0.5), 0, 0.05, -14);
  edge.rotation.x = -Math.PI / 2;
  K.scene.add(edge);
  const pileMat = new THREE3.MeshStandardMaterial({ color: 4867648, roughness: 0.9 });
  for (let x = -26; x <= 26; x += 4) {
    for (let z = -14; z <= -11; z += 1.5) {
      const p = K.mesh(pileMat, new THREE3.CylinderGeometry(0.18, 0.2, 4, 8), x, 2, z);
      K.scene.add(p);
      K.colliders.push(p);
    }
  }
  const bollardMat = new THREE3.MeshStandardMaterial({ color: 14200860, roughness: 0.6, metalness: 0.5 });
  for (let x = -24; x <= 24; x += 8) {
    const bol = K.mesh(bollardMat, new THREE3.CylinderGeometry(0.25, 0.3, 0.9, 10), x, 0.45, -12.5);
    K.scene.add(bol);
  }
  K.ship(0, -28);
  K.craneGantry(-13, -9, 16, 20);
  K.craneGantry(13, -9, 16, 20);
  K.containerRow(-16, -2, 3);
  K.containerRow(16, -2, 3);
  K.containerRow(-18, 10, 3, 0.1);
  K.containerRow(18, 10, 3, -0.1);
  const poleMat = new THREE3.MeshStandardMaterial({ color: 2764080, roughness: 0.6, metalness: 0.7 });
  for (const [fx, fz] of [[-10, 16], [10, 16], [-20, 28], [20, 28], [0, 38]]) {
    const pole = K.mesh(poleMat, new THREE3.CylinderGeometry(0.12, 0.15, 12, 10), fx, 6, fz);
    K.scene.add(pole);
    const lamp = K.mesh(new THREE3.MeshStandardMaterial({ color: 16774352, emissive: 16773312, emissiveIntensity: 2.6 }), new THREE3.SphereGeometry(0.5, 10, 8), fx, 12.4, fz);
    K.scene.add(lamp);
    const lamp2 = K.mesh(new THREE3.MeshStandardMaterial({ color: 16774352, emissive: 16773312, emissiveIntensity: 2.6 }), new THREE3.SphereGeometry(0.5, 10, 8), fx + 1.4, 12.2, fz);
    K.scene.add(lamp2);
    const cone = K.mesh(new THREE3.MeshBasicMaterial({ color: 16773320, transparent: true, opacity: 0.05, side: THREE3.DoubleSide, depthWrite: false }), new THREE3.ConeGeometry(5, 12, 12, 1, true), fx, 6.5, fz);
    K.scene.add(cone);
  }
  const wcMat = new THREE3.MeshStandardMaterial({ color: 3820074, roughness: 0.7, metalness: 0.3 });
  for (const [wx, wz] of [[14, -4], [-14, -6], [10, -10], [-10, -8]]) {
    const grp = new THREE3.Group();
    grp.position.set(wx, 0, wz);
    const box = new THREE3.Mesh(new THREE3.BoxGeometry(1.8, 1.4, 1.8), wcMat);
    box.position.y = 0.7;
    box.castShadow = true;
    box.receiveShadow = true;
    box.userData.kind = "wood";
    box.userData.destroyable = true;
    grp.add(box);
    const label = K.mesh(new THREE3.MeshStandardMaterial({ map: stripeLabel(), roughness: 0.6 }), new THREE3.PlaneGeometry(1.2, 0.5), wx, 1.45, wz + 0.92);
    K.scene.add(label);
    grp.position.y = 0;
    K.scene.add(grp);
    K.colliders.push(box);
    K.destroyables.push(box);
  }
  K.barrel(new THREE3.MeshStandardMaterial({ color: 10169378, roughness: 0.5, metalness: 0.7 }), -4, 20);
  K.barrel(new THREE3.MeshStandardMaterial({ color: 3099502, roughness: 0.5, metalness: 0.7 }), -4.6, 20.6);
  K.barrel(new THREE3.MeshStandardMaterial({ color: 10169378, roughness: 0.5, metalness: 0.7 }), 4, 20);
  K.sandbag(8, 30, 0, 5);
  K.sandbag(-8, 30, 0, 5);
  K.truck(12, 26, 0.3, 3824186);
  K.truck(-12, 30, -0.3, 4868682);
  return finish(K, ambient);
}
function stripeLabel() {
  const c = document.createElement("canvas");
  c.width = 512;
  c.height = 128;
  const g2 = c.getContext("2d");
  g2.fillStyle = "#2a3320";
  g2.fillRect(0, 0, 512, 128);
  g2.fillStyle = "#e8e4d8";
  g2.fillRect(0, 40, 512, 48);
  g2.fillStyle = "#1a1a1a";
  g2.font = "bold 34px sans-serif";
  g2.textAlign = "center";
  g2.fillText("MERIDIAN  \u2022  CONFIDENTIAL", 256, 72);
  const t = new THREE3.CanvasTexture(c);
  t.colorSpace = THREE3.SRGBColorSpace;
  return t;
}
function buildHQ(content, main, renderer) {
  const K = new Kit(content, 700013);
  const ambient = setupAmbient(main, renderer, {
    sunElev: 2,
    sunAzim: 100,
    turbidity: 10,
    rayleigh: 0.5,
    fogColor: 658448,
    fogDensity: 0.014,
    hemiSky: 2238513,
    hemiGround: 658448,
    hemiIntensity: 0.22,
    sunColor: 2764864,
    sunIntensity: 0.18,
    envIntensity: 0.1,
    exposure: 1.05,
    stars: true,
    shadowFar: 100
  });
  content.add(ambient.sun, ambient.hemi);
  if (ambient.stars) content.add(ambient.stars);
  const gc = noiseCanvas2(1024, "#40413f", [["rgba(0,0,0,0.25)", 9e3], ["rgba(255,255,255,0.04)", 4e3]], K.rng);
  K.ground(300, new THREE3.MeshStandardMaterial({ map: toTex(gc, 50), bumpMap: toTex(gc, 50, false), bumpScale: 1, roughness: 0.95 }));
  const glassF = facade({ base: "#2e343c", glass: "#0a0d12", frame: "#4a5058", glow: "#ffca7a", bayW: 2, floorH: 3.4, cols: 4, rows: 3, rng: K.rng, sign: "MERIDIAN" });
  K.building({
    x: 0,
    z: -32,
    w: 16,
    d: 10,
    h: 42,
    facade: glassF,
    roof: "flat",
    roofMat: new THREE3.MeshStandardMaterial({ color: 3817286, roughness: 0.85 }),
    parapet: true,
    details: true,
    emissive: 0.6
  });
  const canopy = K.box(new THREE3.MeshStandardMaterial({ color: 3817544, roughness: 0.8, metalness: 0.4 }), 4, 0.3, 3, 0, 0, -26.5);
  K.scene.add(canopy);
  const door = K.mesh(new THREE3.MeshStandardMaterial({ color: 14210240, emissive: 16767370, emissiveIntensity: 0.8 }), new THREE3.PlaneGeometry(2, 3), 0, 1.5, -25.01);
  K.scene.add(door);
  const wallMat = new THREE3.MeshStandardMaterial({ color: 5592666, roughness: 0.9 });
  K.solid(K.box(wallMat, 26, 4.2, 0.8, -15, 0, -20), "concrete");
  K.solid(K.box(wallMat, 22, 4.2, 0.8, 15, 0, -20), "concrete");
  K.solid(K.box(wallMat, 0.8, 5, 0.8, -2, 0, -20), "concrete");
  K.solid(K.box(wallMat, 0.8, 5, 0.8, 2, 0, -20), "concrete");
  K.solid(K.box(new THREE3.MeshStandardMaterial({ color: 4869716, roughness: 0.85 }), 3, 6.5, 3, -7, 0, -20), "concrete");
  const roofT = K.mesh(new THREE3.MeshStandardMaterial({ color: 2764080, roughness: 0.8 }), new THREE3.ConeGeometry(2.4, 1.4, 4), -7, 7.2, -20);
  roofT.rotation.y = Math.PI / 4;
  K.scene.add(roofT);
  const towerBeacon = K.mesh(new THREE3.MeshStandardMaterial({ color: 16719904, emissive: 16711680, emissiveIntensity: 3 }), new THREE3.SphereGeometry(0.14, 8, 6), -7, 8.1, -20);
  K.scene.add(towerBeacon);
  K.beacon(towerBeacon, 2, 0);
  const wireMat = new THREE3.MeshStandardMaterial({ color: 9079434, roughness: 0.4, metalness: 0.9 });
  for (let x = -24; x <= 24; x += 1.5) {
    if (Math.abs(x) < 2.6) continue;
    const ring = K.mesh(wireMat, new THREE3.TorusGeometry(0.4, 0.03, 6, 10), x, 4.5, -19.7);
    ring.rotation.x = Math.PI / 2;
    ring.rotation.z = x * 0.4;
    K.scene.add(ring);
  }
  K.sandbag(-6, -22, 0, 6);
  K.sandbag(6, -22, 0, 6);
  for (const [fx, fz] of [[-14, -24], [14, -24]]) {
    const tank = K.mesh(new THREE3.MeshStandardMaterial({ color: 9079338, roughness: 0.6, metalness: 0.4 }), new THREE3.CylinderGeometry(1.2, 1.2, 3, 12), fx, 1.5, fz);
    K.scene.add(tank);
    K.colliders.push(tank);
  }
  K.truck(-18, -12, 0.5, 3824186);
  K.truck(18, -12, -0.5, 3824186);
  const woodMat = new THREE3.MeshStandardMaterial({ color: 9071171, roughness: 0.82 });
  K.crate(woodMat, -4, -23, 1.2, 0.2);
  K.crate(woodMat, 4, -23, 1.1, -0.2);
  K.crate(woodMat, 0, -24.5, 1, 0.4);
  K.barrel(new THREE3.MeshStandardMaterial({ color: 10169378, roughness: 0.5, metalness: 0.7 }), -8, -22);
  K.barrel(new THREE3.MeshStandardMaterial({ color: 3099502, roughness: 0.5, metalness: 0.7 }), 8, -22);
  K.helipad(0, -44);
  for (let z = 44; z >= 16; z -= 12) {
    K.streetlight(-9, z, 0);
    K.streetlight(9, z, 0);
  }
  const rainGeo = new THREE3.BufferGeometry();
  const rainCount = 900;
  const rainPos = new Float32Array(rainCount * 3);
  for (let i = 0; i < rainCount; i++) {
    rainPos[i * 3] = (K.rng() - 0.5) * 130;
    rainPos[i * 3 + 1] = K.rng() * 45;
    rainPos[i * 3 + 2] = (K.rng() - 0.5) * 130;
  }
  rainGeo.setAttribute("position", new THREE3.BufferAttribute(rainPos, 3));
  const rain = new THREE3.Points(rainGeo, new THREE3.PointsMaterial({ color: 9089232, size: 0.08, transparent: true, opacity: 0.4, depthWrite: false }));
  K.scene.add(rain);
  K.extras.push({
    update: (dt) => {
      const p = rain.geometry.attributes.position;
      for (let i = 0; i < rainCount; i++) {
        p.array[i * 3 + 1] -= 26 * dt;
        if (p.array[i * 3 + 1] < 0) p.array[i * 3 + 1] = 45;
      }
      p.needsUpdate = true;
    }
  });
  const flash = new THREE3.PointLight(12110056, 0, 120, 2);
  K.scene.add(flash);
  let lightningTimer = 5;
  K.extras.push({
    update: (dt) => {
      lightningTimer -= dt;
      if (lightningTimer <= 0) {
        lightningTimer = 6 + Math.random() * 10;
        flash.position.set((Math.random() - 0.5) * 90, 30, (Math.random() - 0.5) * 90);
        flash.intensity = 2.5;
      }
      flash.intensity = Math.max(0, flash.intensity - dt * 10);
    }
  });
  return finish(K, ambient);
}
function finish(K, ambient) {
  const update = (_dt, focus) => {
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
    hitTarget: () => {
    },
    aabbs: K.aabbs,
    destroyables: K.destroyables
  };
}
function buildLevel(missionId, content, main, renderer) {
  switch (missionId) {
    case 0:
      return buildRange(content, main, renderer);
    case 1:
      return buildVillage(content, main, renderer);
    case 2:
      return buildConstruction(content, main, renderer);
    case 3:
      return buildDowntown(content, main, renderer);
    case 4:
      return buildPort(content, main, renderer);
    case 5:
      return buildHQ(content, main, renderer);
    default:
      return buildRange(content, main, renderer);
  }
}
var Kit;
var init_levels = __esm({
  "src/game/levels.ts"() {
    "use strict";
    init_world();
    Kit = class {
      colliders = [];
      aabbs = [];
      destroyables = [];
      beacons = [];
      extras = [];
      rng;
      scene;
      constructor(scene, seed) {
        this.scene = scene;
        this.rng = mulberry32(seed);
      }
      add(m, kind, noShadow = false) {
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
      solid(m, kind = "concrete") {
        this.add(m, kind);
        m.updateWorldMatrix(true, false);
        const box = new THREE3.Box3().setFromObject(m);
        if (box.isEmpty()) box.setFromCenterAndSize(m.position, new THREE3.Vector3(1, 1, 1));
        this.aabbs.push(box);
        return m;
      }
      mesh(mat, geo, x, y, z, ry = 0) {
        const m = new THREE3.Mesh(geo, mat);
        m.position.set(x, y, z);
        m.rotation.y = ry;
        return m;
      }
      box(mat, w, h, d, x, y, z, ry = 0) {
        return this.mesh(mat, new THREE3.BoxGeometry(w, h, d), x, y + h / 2, z, ry);
      }
      beacon(mesh, speed = 2.5, phase = 0) {
        this.beacons.push({ mesh, speed, phase });
      }
      ground(size, mat) {
        const g2 = this.mesh(mat, new THREE3.PlaneGeometry(size, size), 0, 0, 0);
        g2.rotation.x = -Math.PI / 2;
        g2.receiveShadow = true;
        g2.userData.kind = "dirt";
        this.scene.add(g2);
        this.colliders.push(g2);
      }
      /* ---------------- buildings ---------------- */
      building(o) {
        const { x, z, w, d, h } = o;
        const wallMat = new THREE3.MeshStandardMaterial({
          map: o.facade.map.clone(),
          bumpMap: o.facade.map.clone(),
          bumpScale: 0.06,
          roughness: 0.85,
          metalness: 0.02,
          emissive: 16777215,
          emissiveMap: o.facade.glow.clone(),
          emissiveIntensity: o.emissive ?? 0
        });
        wallMat.map.wrapS = wallMat.map.wrapT = THREE3.RepeatWrapping;
        wallMat.map.repeat.set(Math.max(1, w / o.facade.tileW), Math.max(1, h / o.facade.tileH));
        wallMat.map.needsUpdate = true;
        wallMat.emissiveMap.wrapS = wallMat.emissiveMap.wrapT = THREE3.RepeatWrapping;
        wallMat.emissiveMap.repeat.copy(wallMat.map.repeat);
        wallMat.emissiveMap.needsUpdate = true;
        wallMat.bumpMap.wrapS = wallMat.bumpMap.wrapT = THREE3.RepeatWrapping;
        wallMat.bumpMap.repeat.copy(wallMat.map.repeat);
        wallMat.bumpMap.needsUpdate = true;
        const wall = this.box(wallMat, w, h, d, x, 0, z, o.ry ?? 0);
        const colH = o.collideTo ?? h;
        this.solid(wall);
        if (colH < h) {
          const last = this.aabbs[this.aabbs.length - 1];
          last.max.y = colH;
        }
        if (o.roof !== "none") this.roof(x, z, w, d, h, o.roof ?? "flat", o.roofMat);
        if (o.parapet) this.parapet(x, z, w, d, h, o.roofMat);
        if (o.details) this.roofDetails(x, z, w, d, h, o.roofMat);
        return wall;
      }
      roof(x, z, w, d, h, kind, mat) {
        if (kind === "flat") {
          this.box(mat, w + 0.6, 0.4, d + 0.6, x, h, z);
        } else if (kind === "tile") {
          const shape = new THREE3.Shape();
          const rise = Math.min(2.2, d * 0.35);
          shape.moveTo(-w / 2 - 0.4, 0);
          shape.lineTo(w / 2 + 0.4, 0);
          shape.lineTo(w / 2, rise);
          shape.lineTo(-w / 2, rise);
          shape.closePath();
          const g2 = new THREE3.ExtrudeGeometry(shape, { depth: 0.35, bevelEnabled: false });
          g2.translate(0, 0, -d / 2);
          const m = this.mesh(mat, g2, x, h + rise / 2, z);
          this.scene.add(m);
        } else if (kind === "gable") {
          const shape = new THREE3.Shape();
          const rise = Math.min(3.2, d * 0.45);
          shape.moveTo(-d / 2 - 0.4, 0);
          shape.lineTo(d / 2 + 0.4, 0);
          shape.lineTo(d / 2, rise);
          shape.lineTo(-d / 2, rise);
          shape.closePath();
          const g2 = new THREE3.ExtrudeGeometry(shape, { depth: w, bevelEnabled: false });
          g2.translate(0, 0, -w / 2);
          const m = this.mesh(mat, g2, x, h + rise / 2, z);
          this.scene.add(m);
        } else {
          const m = this.box(mat, w + 0.5, 0.25, d + 0.5, x, h + 0.05, z);
          this.scene.add(m);
        }
      }
      parapet(x, z, w, d, h, mat) {
        const t = 0.25;
        const H = 0.9;
        this.scene.add(this.box(mat, t, H, d + 0.5, x - w / 2, h - 0.2, z));
        this.scene.add(this.box(mat, t, H, d + 0.5, x + w / 2, h - 0.2, z));
        this.scene.add(this.box(mat, w + 0.5, H, t, x, h - 0.2, z - d / 2));
        this.scene.add(this.box(mat, w + 0.5, H, t, x, h - 0.2, z + d / 2));
      }
      roofDetails(x, z, w, d, h, mat) {
        const r = this.rng;
        const steel = mat;
        const acCount = 1 + Math.floor(r() * 2);
        for (let i = 0; i < acCount; i++) {
          const ax = x + (r() - 0.5) * w * 0.6;
          const az = z + (r() - 0.5) * d * 0.6;
          this.box(steel, 1.1, 0.8, 0.9, ax, h, az, r() * Math.PI);
        }
        if (r() < 0.5) {
          const tx = x + (r() - 0.5) * w * 0.5;
          const tz = z + (r() - 0.5) * d * 0.5;
          const tank = this.mesh(new THREE3.MeshStandardMaterial({ color: 9080726, roughness: 0.5, metalness: 0.7 }), new THREE3.CylinderGeometry(0.8, 0.8, 1.6, 16), tx, h + 0.8, tz);
          this.scene.add(tank);
        }
        if (r() < 0.6) {
          const an = this.mesh(steel, new THREE3.CylinderGeometry(0.04, 0.04, 2 + r() * 2, 8), x + (r() - 0.5) * w * 0.4, h, z + (r() - 0.5) * d * 0.4);
          this.scene.add(an);
        }
      }
      /* ---------------- props ---------------- */
      crate(mat, x, z, s, ry = 0, y = 0) {
        return this.solid(this.box(mat, s, s, s, x, y, z, ry), "wood");
      }
      barrel(mat, x, z, color = 10169378) {
        const m = this.solid(
          this.mesh(mat, new THREE3.CylinderGeometry(0.3, 0.3, 0.9, 28), x, 0.45, z),
          "metal"
        );
        const ringMat = new THREE3.MeshStandardMaterial({ color, roughness: 0.5, metalness: 0.7 });
        [-0.28, 0, 0.28].forEach((y) => {
          const r = new THREE3.Mesh(new THREE3.TorusGeometry(0.302, 0.012, 8, 28), ringMat);
          r.rotation.x = Math.PI / 2;
          r.position.y = y;
          m.add(r);
        });
      }
      sandbag(x, z, ry = 0, count = 5) {
        const mat = new THREE3.MeshStandardMaterial({ color: 9273699, roughness: 0.95 });
        for (let i = 0; i < count; i++) {
          const b = this.box(mat, 0.65, 0.28, 0.35, x + i % 3 * 0.55 - 0.55, 0.12 + Math.floor(i / 3) * 0.28, z, ry);
          b.castShadow = true;
          this.scene.add(b);
        }
      }
      car(x, z, ry = 0, color = 3037836, scale = 1) {
        const body = new THREE3.MeshStandardMaterial({ color, roughness: 0.4, metalness: 0.5 });
        const glass = new THREE3.MeshStandardMaterial({ color: 1316892, roughness: 0.15, metalness: 0.9 });
        const grp = new THREE3.Group();
        grp.position.set(x, 0, z);
        grp.rotation.y = ry;
        const b = new THREE3.Mesh(new THREE3.BoxGeometry(2 * scale, 0.7 * scale, 4.6 * scale), body);
        b.position.y = 0.55 * scale;
        b.castShadow = true;
        grp.add(b);
        const c = new THREE3.Mesh(new THREE3.BoxGeometry(1.7 * scale, 0.65 * scale, 2.2 * scale), glass);
        c.position.y = 1.1 * scale;
        c.position.z = -0.1 * scale;
        c.castShadow = true;
        grp.add(c);
        for (const [wx, wz] of [[-0.8, 1.2], [0.8, 1.2], [-0.8, -1.4], [0.8, -1.4]]) {
          const wheel = new THREE3.Mesh(new THREE3.CylinderGeometry(0.38 * scale, 0.38 * scale, 0.25 * scale, 16), new THREE3.MeshStandardMaterial({ color: 273, roughness: 0.9 }));
          wheel.rotation.z = Math.PI / 2;
          wheel.position.set(wx * scale, 0.38 * scale, wz * scale);
          grp.add(wheel);
        }
        this.scene.add(grp);
        const col = this.box(body, 2 * scale, 0.7 * scale, 4.6 * scale, x, 0, z, ry);
        this.colliders.push(col);
        this.aabbs.push(new THREE3.Box3().setFromObject(col));
      }
      truck(x, z, ry = 0, color = 3824186) {
        const body = new THREE3.MeshStandardMaterial({ color, roughness: 0.5, metalness: 0.4 });
        const cab = new THREE3.MeshStandardMaterial({ color: 2902572, roughness: 0.4, metalness: 0.6 });
        const b = this.box(body, 2.4, 2.2, 7, x, 0, z, ry);
        const c = this.box(cab, 2.4, 1.6, 2.6, x + Math.sin(ry) * 3.3, 0, z + Math.cos(ry) * 3.3, ry);
        for (const [wx, wz] of [[-1, 2.2], [1, 2.2], [-1, -2.5], [1, -2.5]]) {
          const w = this.mesh(new THREE3.MeshStandardMaterial({ color: 273, roughness: 0.9 }), new THREE3.CylinderGeometry(0.5, 0.5, 0.3, 16), x + wx * Math.cos(ry) + wz * Math.sin(ry), 0.5, z - wx * Math.sin(ry) + wz * Math.cos(ry));
          w.rotation.z = Math.PI / 2;
          w.rotation.y = ry;
          this.scene.add(w);
        }
        this.scene.add(b, c);
        this.colliders.push(b, c);
        for (const m of [b, c]) {
          m.updateWorldMatrix(true, false);
          this.aabbs.push(new THREE3.Box3().setFromObject(m));
        }
      }
      container(x, y, z, ry = 0, color = 9071162) {
        const c = new THREE3.Color(color);
        const mat = new THREE3.MeshStandardMaterial({ color: c, roughness: 0.65, metalness: 0.35 });
        const m = this.box(mat, 6, 2.6, 2.5, x, y, z, ry);
        const ribMat = new THREE3.MeshStandardMaterial({ color: c.clone().multiplyScalar(0.75), roughness: 0.7 });
        for (let i = -2; i <= 2; i++) {
          const rib = new THREE3.Mesh(new THREE3.BoxGeometry(0.05, 2.6, 2.5), ribMat);
          rib.position.set(i * 1.15, y + 1.3, z);
          rib.rotation.y = ry;
          m.add(rib);
        }
        this.scene.add(m);
        this.colliders.push(m);
        return m;
      }
      containerRow(x, z, count, ry = 0, colors = [9071162, 3828362, 5929530, 9079434]) {
        for (let i = 0; i < count; i++) {
          const m = this.container(x + i * 6.4, 0, z, ry + (i % 2 ? 0.04 : -0.04), colors[(i + Math.floor(x)) % colors.length]);
          m.updateWorldMatrix(true, false);
          this.aabbs.push(new THREE3.Box3().setFromObject(m));
        }
      }
      fence(x1, z1, x2, z2) {
        const wood = new THREE3.MeshStandardMaterial({ color: 7032624, roughness: 0.9 });
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
      tree(x, z, s = 1) {
        const trunkMat = new THREE3.MeshStandardMaterial({ color: 5913890, roughness: 0.9 });
        const leafMat = new THREE3.MeshStandardMaterial({ color: 4020778, roughness: 0.9 });
        const trunk = this.mesh(trunkMat, new THREE3.CylinderGeometry(0.2 * s, 0.32 * s, 2.4 * s, 8), x, 1.2 * s, z);
        this.scene.add(trunk);
        for (let i = 0; i < 4; i++) {
          const leaf = this.mesh(leafMat, new THREE3.SphereGeometry((0.9 + this.rng() * 0.5) * s, 10, 8), x + (this.rng() - 0.5) * 1.4 * s, (2.6 + i * 0.45 + this.rng() * 0.5) * s, z + (this.rng() - 0.5) * 1.4 * s);
          this.scene.add(leaf);
        }
      }
      haystack(x, z) {
        const mat = new THREE3.MeshStandardMaterial({ color: 13215818, roughness: 1 });
        const m = this.mesh(mat, new THREE3.SphereGeometry(1.6, 12, 10), x, 1.1, z);
        m.scale.y = 0.8;
        this.scene.add(m);
      }
      streetlight(x, z, ry = 0) {
        const poleMat = new THREE3.MeshStandardMaterial({ color: 2764080, roughness: 0.6, metalness: 0.8 });
        const pole = this.mesh(poleMat, new THREE3.CylinderGeometry(0.09, 0.12, 5, 10), x, 2.5, z, ry);
        this.scene.add(pole);
        const arm = this.mesh(poleMat, new THREE3.CylinderGeometry(0.05, 0.05, 1.6, 8), x + Math.sin(ry) * 0.9, 5, z + Math.cos(ry) * 0.9, ry + Math.PI / 2);
        this.scene.add(arm);
        const bulb = this.mesh(new THREE3.MeshStandardMaterial({ color: 16771504, emissive: 16767370, emissiveIntensity: 2.2 }), new THREE3.SphereGeometry(0.14, 10, 8), x + Math.sin(ry) * 1.7, 4.95, z + Math.cos(ry) * 1.7);
        this.scene.add(bulb);
      }
      /* ---------------- industry ---------------- */
      craneTower(x, z, h, ry = 0) {
        const yellow = new THREE3.MeshStandardMaterial({ color: 14198812, roughness: 0.5, metalness: 0.5 });
        const dark = new THREE3.MeshStandardMaterial({ color: 2763306, roughness: 0.6, metalness: 0.7 });
        const mast = this.box(yellow, 1.3, h, 1.3, x, 0, z, ry);
        const jibLen = 22;
        const jib = this.box(yellow, 0.8, 0.9, jibLen, x, h, z + Math.cos(ry) * 9, ry);
        const counter = this.box(yellow, 0.8, 0.9, 9, x, h, z - Math.cos(ry) * 4.5, ry);
        const cw = this.box(dark, 2.2, 1.6, 1.6, x - Math.sin(ry) * 4.5, h - 0.6, z - Math.cos(ry) * 4.5, ry);
        const cab = this.box(yellow, 2, 2, 2.4, x + Math.sin(ry) * 1.6, h - 0.8, z + Math.cos(ry) * 1.6, ry);
        const hookX = x + Math.sin(ry) * 10;
        const hookZ = z + Math.cos(ry) * 10;
        const cable = this.mesh(dark, new THREE3.CylinderGeometry(0.03, 0.03, 6, 6), hookX, h - 3, hookZ);
        const block = this.box(dark, 0.7, 0.7, 0.7, hookX, h - 6.2, hookZ);
        this.scene.add(mast, jib, counter, cw, cab, cable, block);
        this.colliders.push(mast);
        const beacon = this.mesh(new THREE3.MeshStandardMaterial({ color: 16720418, emissive: 16711680, emissiveIntensity: 3 }), new THREE3.SphereGeometry(0.1, 8, 6), x, h + 0.3, z);
        this.scene.add(beacon);
        this.beacon(beacon, 3, this.rng() * 6);
        return { mast, x, z, h, ry };
      }
      craneGantry(x, z, h, span) {
        const yellow = new THREE3.MeshStandardMaterial({ color: 14198812, roughness: 0.5, metalness: 0.5 });
        const dark = new THREE3.MeshStandardMaterial({ color: 2763306, roughness: 0.6, metalness: 0.7 });
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
      excavator(x, z, ry = 0) {
        const yellow = new THREE3.MeshStandardMaterial({ color: 14198812, roughness: 0.5, metalness: 0.4 });
        const dark = new THREE3.MeshStandardMaterial({ color: 546, roughness: 0.9 });
        const b = this.box(yellow, 2.4, 1, 3.6, x, 0.7, z, ry);
        const c = this.box(yellow, 1.8, 1.4, 1.6, x + Math.sin(ry) * 1.4, 1.4, z + Math.cos(ry) * 1.4, ry);
        const arm = this.box(yellow, 0.6, 0.6, 3.4, x + Math.sin(ry) * 2.4, 2.2, z + Math.cos(ry) * 2.4, ry);
        const bucket = this.box(dark, 1, 0.9, 1.2, x + Math.sin(ry) * 3.8, 1.2, z + Math.cos(ry) * 3.8, ry);
        this.scene.add(b, c, arm, bucket);
      }
      ship(x, z) {
        const hullMat = new THREE3.MeshStandardMaterial({ color: 2902630, roughness: 0.6, metalness: 0.5 });
        const superMat = new THREE3.MeshStandardMaterial({ color: 15263456, roughness: 0.5, metalness: 0.3 });
        const glass = new THREE3.MeshStandardMaterial({ color: 1053720, roughness: 0.2, metalness: 0.8 });
        const hull = this.box(hullMat, 10, 7, 44, x, 0, z, 0);
        const bow = this.mesh(hullMat, new THREE3.CylinderGeometry(3.2, 5, 14, 18), x, 0, z - 25, 0);
        bow.rotation.x = Math.PI / 2;
        this.scene.add(hull, bow);
        this.colliders.push(this.box(hullMat, 10, 2, 44, x, 0, z, 0));
        const deck = this.box(new THREE3.MeshStandardMaterial({ color: 4866102, roughness: 0.9 }), 8.5, 0.3, 40, x, 7, z - 1, 0);
        this.scene.add(deck);
        const sup = this.box(superMat, 7, 4.5, 6, x, 7.5, z + 10, 0);
        this.scene.add(sup);
        const bridge = this.box(glass, 7.4, 2.2, 5, x, 12, z + 10, 0);
        this.scene.add(bridge);
        for (const [cx, cz] of [[-3.2, -18], [-3.2, -24], [3.2, -18], [3.2, -24]]) {
          for (let row = 0; row < 2; row++) {
            const m = this.container(x + cx, 7.3 + row * 2.6, z + cz, (cx + cz) % 2 ? 0.06 : -0.06, [9071162, 3828362, 5929530][(cx + cz + row) % 3]);
            m.updateWorldMatrix(true, false);
            this.aabbs.push(new THREE3.Box3().setFromObject(m));
          }
        }
        const railMat = new THREE3.MeshStandardMaterial({ color: 546, roughness: 0.7 });
        for (let i = -18; i <= 18; i += 3) {
          for (const sx of [-4.25, 4.25]) {
            const post = this.mesh(railMat, new THREE3.CylinderGeometry(0.05, 0.05, 1.1, 6), x + sx, 7.9, z - 1 + i);
            this.scene.add(post);
          }
        }
        return { x, z, deckY: 7.15 };
      }
      water(size) {
        const c = document.createElement("canvas");
        c.width = c.height = 512;
        const g2 = c.getContext("2d");
        g2.fillStyle = "#0b1a26";
        g2.fillRect(0, 0, 512, 512);
        const rng = mulberry32(7);
        for (let i = 0; i < 260; i++) {
          g2.strokeStyle = `rgba(120,160,190,${0.04 + rng() * 0.09})`;
          g2.lineWidth = 1 + rng() * 2.5;
          const y = rng() * 512;
          g2.beginPath();
          g2.moveTo(0, y);
          for (let x = 0; x <= 512; x += 32) g2.lineTo(x, y + Math.sin((x + i * 30) / 60) * 6);
          g2.stroke();
        }
        const t = new THREE3.CanvasTexture(c);
        t.wrapS = t.wrapT = THREE3.RepeatWrapping;
        t.repeat.set(size / 20, size / 20);
        t.colorSpace = THREE3.SRGBColorSpace;
        const m = this.mesh(
          new THREE3.MeshStandardMaterial({ map: t, transparent: true, opacity: 0.92, roughness: 0.25, metalness: 0.55, envMapIntensity: 1.2 }),
          new THREE3.PlaneGeometry(size, size),
          0,
          -0.06,
          0
        );
        m.rotation.x = -Math.PI / 2;
        m.receiveShadow = false;
        this.scene.add(m);
        return t;
      }
      helipad(x, z) {
        const c = document.createElement("canvas");
        c.width = c.height = 256;
        const g2 = c.getContext("2d");
        g2.fillStyle = "rgba(0,0,0,0)";
        g2.fillRect(0, 0, 256, 256);
        g2.strokeStyle = "rgba(240,240,240,0.9)";
        g2.lineWidth = 14;
        g2.beginPath();
        g2.arc(128, 128, 110, 0, Math.PI * 2);
        g2.stroke();
        g2.fillStyle = "rgba(240,240,240,0.95)";
        g2.font = "bold 150px sans-serif";
        g2.textAlign = "center";
        g2.fillText("H", 128, 185);
        const t = new THREE3.CanvasTexture(c);
        t.colorSpace = THREE3.SRGBColorSpace;
        const m = this.mesh(new THREE3.MeshStandardMaterial({ map: t, transparent: true, roughness: 0.8 }), new THREE3.PlaneGeometry(22, 22), x, 0.04, z);
        m.rotation.x = -Math.PI / 2;
        m.receiveShadow = true;
        this.scene.add(m);
        for (const [lx, lz] of [[-10, -10], [10, -10], [-10, 10], [10, 10]]) {
          const light = this.mesh(new THREE3.MeshStandardMaterial({ color: 16777215, emissive: 16773824, emissiveIntensity: 2.5 }), new THREE3.SphereGeometry(0.22, 8, 6), x + lx, 0.12, z + lz);
          this.scene.add(light);
          this.beacon(light, 1.6, (lx + lz) * 0.3);
        }
      }
      relayTower(x, z, h) {
        const steel = new THREE3.MeshStandardMaterial({ color: 10133672, roughness: 0.5, metalness: 0.8 });
        const pole = this.mesh(steel, new THREE3.CylinderGeometry(0.12, 0.22, h, 10), x, h / 2, z);
        this.scene.add(pole);
        this.colliders.push(pole);
        for (let i = 1; i <= 6; i++) {
          const r = 0.35 + i / 6 * 0.5;
          const ring = this.mesh(steel, new THREE3.TorusGeometry(r, 0.04, 6, 14), x, i / 6 * h, z);
          ring.rotation.x = Math.PI / 2;
          this.scene.add(ring);
        }
        const dish = this.mesh(steel, new THREE3.SphereGeometry(1.1, 16, 12, 0, Math.PI * 2, 0, Math.PI / 2.4), x, h, z);
        dish.rotation.x = -Math.PI / 2.4;
        dish.position.y = h + 0.3;
        this.scene.add(dish);
        const beacon = this.mesh(new THREE3.MeshStandardMaterial({ color: 16719904, emissive: 16711680, emissiveIntensity: 4 }), new THREE3.SphereGeometry(0.16, 8, 6), x, h + 1.6, z);
        this.scene.add(beacon);
        this.beacon(beacon, 2, this.rng() * 6);
      }
      houseVillage(x, z, w, d, h, ry = 0) {
        const stone = facade({
          base: "#8a8074",
          glass: "#2a2620",
          frame: "#5a5048",
          glow: "#ffcf7a",
          bayW: 1.6,
          floorH: 3,
          cols: 3,
          rows: 2,
          rng: this.rng
        });
        const roof = new THREE3.MeshStandardMaterial({ color: 9059114, roughness: 0.9, metalness: 0 });
        this.building({ x, z, w, d, h, facade: stone, roof: "tile", roofMat: roof, emissive: 0.35, parapet: false, details: false, ry });
        const door = this.box(new THREE3.MeshStandardMaterial({ color: 4862752, roughness: 0.9 }), 1.1, 2, 0.12, x + Math.sin(ry) * (w / 2 - 0.6), 0, z + Math.cos(ry) * (d / 2 + 0.1), ry + Math.PI);
        this.scene.add(door);
      }
      church(x, z) {
        const stoneMat = new THREE3.MeshStandardMaterial({ color: 14209732, roughness: 0.95 });
        const roofMat = new THREE3.MeshStandardMaterial({ color: 5921376, roughness: 0.8 });
        this.solid(this.box(stoneMat, 9, 6, 13, x, 0, z), "concrete");
        this.solid(this.box(stoneMat, 3.4, 13, 3.4, x + 6, 0, z + 4), "concrete");
        const towerRoof = this.mesh(roofMat, new THREE3.ConeGeometry(2.8, 2.6, 4), x + 6, 14.3, z + 4);
        towerRoof.rotation.y = Math.PI / 4;
        this.scene.add(towerRoof);
        const cross1 = this.box(new THREE3.MeshStandardMaterial({ color: 3814184, roughness: 0.9 }), 0.15, 1.1, 0.15, x + 6, 16.3, z + 4);
        const cross1b = this.box(new THREE3.MeshStandardMaterial({ color: 3814184, roughness: 0.9 }), 0.7, 0.15, 0.15, x + 6, 16.6, z + 4);
        this.scene.add(cross1, cross1b);
        this.roof(x, z, 9.4, 13.4, 6, "gable", roofMat);
        const door = this.box(new THREE3.MeshStandardMaterial({ color: 3811866, roughness: 0.9 }), 1.4, 2.4, 0.15, x, 0, z + 6.7);
        this.scene.add(door);
        const bell = this.mesh(new THREE3.MeshStandardMaterial({ color: 12098106, roughness: 0.4, metalness: 0.8 }), new THREE3.CylinderGeometry(0.5, 0.75, 0.9, 12), x + 6, 11.5, z + 4);
        this.scene.add(bell);
        this.fence(x - 8, z + 8, x + 14, z + 8);
      }
      well(x, z) {
        const stone = new THREE3.MeshStandardMaterial({ color: 10129540, roughness: 0.95 });
        const ring = this.mesh(stone, new THREE3.TorusGeometry(1.1, 0.22, 10, 20), x, 0.8, z);
        ring.rotation.x = Math.PI / 2;
        this.scene.add(ring);
        const roof = this.mesh(new THREE3.MeshStandardMaterial({ color: 5914672, roughness: 0.9 }), new THREE3.ConeGeometry(1.6, 0.9, 8), x, 1.7, z);
        this.scene.add(roof);
        const post1 = this.box(stone, 0.2, 1.7, 0.2, x + 1, 0, z + 1.1);
        const post2 = this.box(stone, 0.2, 1.7, 0.2, x - 1, 0, z + 1.1);
        this.scene.add(post1, post2);
      }
      stall(x, z, ry = 0) {
        const wood = new THREE3.MeshStandardMaterial({ color: 7032624, roughness: 0.9 });
        const awn = new THREE3.MeshStandardMaterial({ color: 10107690, roughness: 0.85 });
        this.box(wood, 2.4, 0.08, 2.4, x, 0.8, z, ry);
        for (const [px, pz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
          const post = this.box(wood, 0.1, 2, 0.1, x + px, 0, z + pz, ry);
          this.scene.add(post);
        }
        const shape = new THREE3.Shape();
        shape.moveTo(-1.3, 0);
        shape.lineTo(1.3, 0);
        shape.lineTo(1.3, 0.4);
        shape.lineTo(-1.3, 0.4);
        shape.closePath();
        const g2 = new THREE3.ExtrudeGeometry(shape, { depth: 2.4, bevelEnabled: false });
        g2.translate(0, 0, -1.2);
        const roofM = this.mesh(awn, g2, x, 2, z, ry);
        this.scene.add(roofM);
      }
    };
  }
});

// test/debug2.mjs
var ctxStub = new Proxy({}, { get: (_t, k) => {
  if (k === "createRadialGradient" || k === "createLinearGradient") return () => ({ addColorStop() {
  } });
  if (k === "measureText") return () => ({ width: 10 });
  if (k === "canvas") return { width: 1024, height: 1024 };
  return () => {
  };
}, set: () => true });
globalThis.document = { createElement: (tag) => tag === "canvas" ? { width: 1024, height: 1024, getContext: () => ctxStub, style: {} } : { style: {} } };
globalThis.window = { devicePixelRatio: 1, addEventListener() {
}, removeEventListener() {
} };
var THREE4 = await import("three");
THREE4.CubeCamera.prototype.update = function() {
};
THREE4.PMREMGenerator.prototype.fromCubemap = function() {
  return { texture: new THREE4.Texture() };
};
THREE4.PMREMGenerator.prototype.fromScene = function() {
  return { texture: new THREE4.Texture() };
};
THREE4.PMREMGenerator.prototype.dispose = function() {
};
var { buildLevel: buildLevel2 } = await Promise.resolve().then(() => (init_levels(), levels_exports));
var g = new THREE4.Group();
var level = buildLevel2(1, g, new THREE4.Scene(), { toneMappingExposure: 1 });
for (const b of level.aabbs) {
  console.log(`x[${b.min.x.toFixed(2)},${b.max.x.toFixed(2)}] y[${b.min.y.toFixed(2)},${b.max.y.toFixed(2)}] z[${b.min.z.toFixed(2)},${b.max.z.toFixed(2)}]`);
}
