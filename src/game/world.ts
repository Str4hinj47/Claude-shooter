import * as THREE from "three";
import { Sky } from "three/examples/jsm/objects/Sky.js";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { Spring } from "../character/math";
import { craftedBarrel, craftedCrate, craftedRockCluster } from "./kit/geom";

export type SurfaceKind = "dirt" | "metal" | "wood" | "concrete";

export interface TargetObj {
  group: THREE.Group;
  spring: Spring;
  spin: Spring;
  baseRotX: number;
}

export interface World {
  colliders: THREE.Object3D[];
  targets: TargetObj[];
  sun: THREE.DirectionalLight;
  sunDir: THREE.Vector3;
  update: (dt: number, focus: THREE.Vector3) => void;
  hitTarget: (mesh: THREE.Object3D, impulse: number) => void;
}

function noiseCanvas(size: number, base: string, speck: [string, number][], blotch = true) {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const g = c.getContext("2d")!;
  g.fillStyle = base;
  g.fillRect(0, 0, size, size);
  if (blotch) {
    for (let i = 0; i < 90; i++) {
      const x = Math.random() * size;
      const y = Math.random() * size;
      const r = 20 + Math.random() * 80;
      const gr = g.createRadialGradient(x, y, 0, x, y, r);
      const a = 0.05 + Math.random() * 0.08;
      gr.addColorStop(0, Math.random() > 0.5 ? `rgba(0,0,0,${a})` : `rgba(255,255,255,${a * 0.7})`);
      gr.addColorStop(1, "rgba(0,0,0,0)");
      g.fillStyle = gr;
      g.fillRect(x - r, y - r, r * 2, r * 2);
    }
  }
  for (const [col, n] of speck) {
    g.fillStyle = col;
    for (let i = 0; i < n; i++) {
      const s = Math.random() * 2 + 0.5;
      g.fillRect(Math.random() * size, Math.random() * size, s, s);
    }
  }
  return c;
}

function tex(c: HTMLCanvasElement, rep: number, srgb = true) {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(rep, rep);
  t.anisotropy = 16;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/* ---- polish decal textures (transparent backgrounds) ---- */
function stainCanvas(size: number) {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const g = c.getContext("2d")!;
  g.clearRect(0, 0, size, size);
  for (let i = 0; i < 12; i++) {
    const x = Math.random() * size;
    const y = Math.random() * size;
    const r = size * (0.1 + Math.random() * 0.26);
    const gr = g.createRadialGradient(x, y, 0, x, y, r);
    const a = 0.22 + Math.random() * 0.34;
    gr.addColorStop(0, `rgba(18,15,12,${a})`);
    gr.addColorStop(0.65, `rgba(18,15,12,${a * 0.35})`);
    gr.addColorStop(1, "rgba(18,15,12,0)");
    g.fillStyle = gr;
    g.fillRect(x - r, y - r, r * 2, r * 2);
  }
  return c;
}

function puddleCanvas(size: number) {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const g = c.getContext("2d")!;
  g.clearRect(0, 0, size, size);
  const gr = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size * 0.42);
  gr.addColorStop(0, "rgba(70,92,120,0.55)");
  gr.addColorStop(0.7, "rgba(60,80,105,0.3)");
  gr.addColorStop(1, "rgba(50,70,95,0)");
  g.fillStyle = gr;
  g.beginPath();
  g.arc(size / 2, size / 2, size * 0.42, 0, Math.PI * 2);
  g.fill();
  return c;
}

function crackCanvas(size: number) {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const g = c.getContext("2d")!;
  g.clearRect(0, 0, size, size);
  const branch = (sx: number, sy: number, ang: number, depth: number) => {
    if (depth <= 0) return;
    let x = sx;
    let y = sy;
    const steps = 6 + Math.floor(Math.random() * 8);
    for (let i = 0; i < steps; i++) {
      const len = (size / 24) * (0.6 + Math.random());
      ang += (Math.random() - 0.5) * 0.9;
      x += Math.cos(ang) * len;
      y += Math.sin(ang) * len;
      g.strokeStyle = `rgba(10,10,12,${0.35 + Math.random() * 0.4})`;
      g.lineWidth = Math.max(1, depth * 1.4);
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(x + Math.cos(ang) * len * 0.7, y + Math.sin(ang) * len * 0.7);
      g.stroke();
      if (Math.random() < 0.35) branch(x, y, ang + (Math.random() - 0.5) * 2, depth - 1);
    }
  };
  for (let i = 0; i < 3; i++) {
    const edge = Math.floor(Math.random() * 4);
    const sx = edge === 0 ? Math.random() * size : edge === 1 ? size : Math.random() * size;
    const sy = edge === 2 ? Math.random() * size : edge === 3 ? size : Math.random() * size;
    branch(sx, sy, Math.random() * Math.PI * 2, 4);
  }
  return c;
}

export function buildWorld(content: THREE.Object3D, main: THREE.Scene, renderer: THREE.WebGLRenderer): World {
  /* ---------------- sky + image based lighting (main scene) ---------------- */
  const sunDir = new THREE.Vector3().setFromSphericalCoords(1, THREE.MathUtils.degToRad(90 - 34), THREE.MathUtils.degToRad(215));
  const skyScene = new THREE.Scene();
  const sky = new Sky();
  sky.scale.setScalar(1000);
  const u = sky.material.uniforms;
  u["turbidity"].value = 3.2;
  u["rayleigh"].value = 1.3;
  u["mieCoefficient"].value = 0.004;
  u["mieDirectionalG"].value = 0.82;
  u["sunPosition"].value.copy(sunDir);
  skyScene.add(sky);
  const cubeRT = new THREE.WebGLCubeRenderTarget(256, { type: THREE.HalfFloatType });
  const cubeCam = new THREE.CubeCamera(1, 5000, cubeRT);
  cubeCam.update(renderer, skyScene);
  main.background = cubeRT.texture;
  const pmrem = new THREE.PMREMGenerator(renderer);
  main.environment = pmrem.fromCubemap(cubeRT.texture).texture;
  pmrem.dispose();
  main.environmentIntensity = 0.58;
  main.fog = new THREE.FogExp2(0xc9cfd2, 0.0042);
  renderer.toneMappingExposure = 0.92;

  /* ---------------- lights ---------------- */
  const sun = new THREE.DirectionalLight(0xffe9cc, 3.8);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const sc = sun.shadow.camera;
  sc.left = -16;
  sc.right = 16;
  sc.top = 16;
  sc.bottom = -16;
  sc.near = 1;
  sc.far = 85;
  sun.shadow.bias = -0.00025;
  sun.shadow.normalBias = 0.03;
  sun.shadow.radius = 3.2;
  content.add(sun, sun.target);
  const hemi = new THREE.HemisphereLight(0xd2e2f2, 0x6a5c48, 0.42);
  content.add(hemi);

  const colliders: THREE.Object3D[] = [];
  const targets: TargetObj[] = [];

  /* ---------------- ground ---------------- */
  const gc = noiseCanvas(1024, "#8c8068", [["rgba(0,0,0,0.18)", 9000], ["rgba(255,255,255,0.12)", 5000], ["rgba(90,70,40,0.2)", 3000]]);
  const gTex = tex(gc, 70);
  const bump = tex(gc, 70, false);
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(400, 400),
    new THREE.MeshStandardMaterial({ map: gTex, bumpMap: bump, bumpScale: 1.6, roughness: 0.96, metalness: 0 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  ground.userData.kind = "dirt";
  content.add(ground);
  colliders.push(ground);

  // asphalt pad
  const ac = noiseCanvas(1024, "#55575a", [["rgba(255,255,255,0.1)", 9000], ["rgba(0,0,0,0.35)", 6000]]);
  const ag = ac.getContext("2d")!;
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
  const pad = new THREE.Mesh(
    new THREE.PlaneGeometry(26, 90),
    new THREE.MeshStandardMaterial({ map: aTex, bumpMap: tex(ac, 8, false), bumpScale: 0.8, roughness: 0.88, metalness: 0 }),
  );
  pad.rotation.x = -Math.PI / 2;
  pad.position.set(0, 0.004, 25);
  pad.receiveShadow = true;
  pad.userData.kind = "concrete";
  content.add(pad);
  colliders.push(pad);

  // lane markings
  const paint = new THREE.MeshStandardMaterial({ color: 0xd8d4c4, roughness: 0.7 });
  const addPaint = (w: number, l: number, x: number, z: number) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, l), paint);
    m.rotation.x = -Math.PI / 2;
    m.position.set(x, 0.008, z);
    m.receiveShadow = true;
    content.add(m);
  };
  [-9, 0, 9].forEach((x) => {
    for (let z = -10; z < 66; z += 5) addPaint(0.12, 2.6, x, z + 1.5);
  });
  [10, 18, 26, 34].forEach((z) => addPaint(26, 0.14, 0, z));

  /* ---------------- helpers ---------------- */
  const add = (m: THREE.Mesh, kind: SurfaceKind) => {
    m.castShadow = true;
    m.receiveShadow = true;
    m.userData.kind = kind;
    content.add(m);
    colliders.push(m);
    return m;
  };

  // concrete berm (backstop) — rounded slabs + fascia + buttresses
  const concrete = new THREE.MeshStandardMaterial({ map: tex(noiseCanvas(512, "#a09c94", [["rgba(0,0,0,0.25)", 5000], ["rgba(255,255,255,0.15)", 3000]]), 6), roughness: 0.92 });
  const wall = new THREE.Mesh(new RoundedBoxGeometry(80, 7, 3, 5, 0.5), concrete);
  wall.position.set(0, 3.5, 52);
  wall.castShadow = true;
  wall.receiveShadow = true;
  add(wall, "concrete");
  // wall fascia strip
  const fascia = new THREE.MeshStandardMaterial({ color: 0x8a8880, roughness: 0.92 });
  const wallCap = new THREE.Mesh(new RoundedBoxGeometry(80.4, 0.3, 3.4, 3, 0.1), fascia);
  wallCap.position.set(0, 6.85, 52);
  add(wallCap, "concrete");
  const sideL = new THREE.Mesh(new RoundedBoxGeometry(3, 5, 70, 5, 0.5), concrete);
  sideL.position.set(-26, 2.5, 18);
  sideL.castShadow = true;
  sideL.receiveShadow = true;
  add(sideL, "concrete");
  const sideR = sideL.clone();
  sideR.position.x = 26;
  add(sideR, "concrete");
  // buttress piers along the backstop face
  const pierMat = new THREE.MeshStandardMaterial({ color: 0x96948c, roughness: 0.92 });
  for (let px = -36; px <= 36; px += 12) {
    const pier = new THREE.Mesh(new RoundedBoxGeometry(1.2, 2.4, 0.8, 3, 0.15), pierMat);
    pier.position.set(px, 1.2, 53.2);
    add(pier, "concrete");
  }

  // crates (crafted beveled plank crates + invisible collider)
  const invisMat = new THREE.MeshBasicMaterial({ visible: false });
  const crate = (x: number, z: number, s: number, ry = 0, y = 0) => {
    const vis = craftedCrate(s, Math.abs(Math.round(x * 13 + z * 7)) + 1);
    vis.position.set(x, y, z);
    vis.rotation.y = ry;
    content.add(vis);
    const col = new THREE.Mesh(new THREE.BoxGeometry(s + 0.04, s + 0.06, s + 0.04), invisMat);
    col.position.set(x, y + s / 2, z);
    col.rotation.y = ry;
    col.userData.kind = "wood";
    content.add(col);
    colliders.push(col);
  };
  crate(-6.5, 8, 1.1, 0.3);
  crate(-6.9, 9.3, 0.9, -0.2);
  crate(-6.6, 8.4, 0.8, 0.8, 1.15);
  crate(7.5, 14, 1.2, -0.4);
  crate(8.8, 14.6, 1.0, 0.2);
  crate(-8, 20, 1.3, 0.5);

  // barrels (crafted ribbed steel drums + invisible collider)
  const barrel = (x: number, z: number, color = 0x9b2c22) => {
    const vis = craftedBarrel(color, true);
    vis.position.set(x, 0, z);
    content.add(vis);
    const col = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, 1.05, 12), invisMat);
    col.position.set(x, 0.525, z);
    col.userData.kind = "metal";
    content.add(col);
    colliders.push(col);
  };
  barrel(5.5, 8, 0x9b2c22);
  barrel(6.2, 8.6, 0x9b2c22);
  barrel(-4.5, 15, 0x2f4b6e);

  // jersey barriers (bevelled extrusion + flush hazard strips on both faces)
  const hazardMat = new THREE.MeshStandardMaterial({
    color: 0xd8b01c,
    emissive: 0x5a3e06,
    emissiveIntensity: 0.25,
    roughness: 0.55,
  });
  const barrier = (x: number, z: number, ry = 0) => {
    const shape = new THREE.Shape();
    shape.moveTo(-0.4, 0);
    shape.lineTo(0.4, 0);
    shape.lineTo(0.22, 0.28);
    shape.lineTo(0.13, 0.8);
    shape.lineTo(-0.13, 0.8);
    shape.lineTo(-0.22, 0.28);
    shape.closePath();
    const g = new THREE.ExtrudeGeometry(shape, { depth: 2.2, bevelEnabled: true, bevelThickness: 0.04, bevelSize: 0.04, bevelSegments: 2 });
    g.translate(0, 0, -1.1);
    const m = new THREE.Mesh(g, concrete);
    m.position.set(x, 0, z);
    m.rotation.y = ry + Math.PI / 2;
    m.castShadow = true;
    m.receiveShadow = true;
    add(m, "concrete");
    // flush reflective hazard bands attached in barrier-local space
    for (const sx of [-1, 1]) {
      const strip = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.09, 2.08), hazardMat);
      strip.position.set(sx * 0.175, 0.62, 0);
      strip.rotation.z = sx * 0.17;
      m.add(strip);
    }
  };
  barrier(3, 5.5, 0.1);
  barrier(-3.2, 11, -0.1);
  barrier(0, 16.5, Math.PI / 2 + 0.05);

  // steel targets (hinged plates with upright torus rim & gusseted stand)
  const steel = new THREE.MeshStandardMaterial({ color: 0x4a4f55, roughness: 0.42, metalness: 0.9 });
  const rc = document.createElement("canvas");
  rc.width = rc.height = 256;
  const rg = rc.getContext("2d")!;
  ["#c8202a", "#f1f1f1", "#c8202a", "#f1f1f1", "#c8202a"].forEach((col, i) => {
    rg.fillStyle = col;
    rg.beginPath();
    rg.arc(128, 128, 126 - i * 25, 0, Math.PI * 2);
    rg.fill();
  });
  const rTex = new THREE.CanvasTexture(rc);
  rTex.colorSpace = THREE.SRGBColorSpace;
  const faceMat = new THREE.MeshStandardMaterial({ map: rTex, roughness: 0.5, metalness: 0.35 });
  const plate = (x: number, z: number, r = 0.32) => {
    const grp = new THREE.Group();
    grp.position.set(x, 0, z);
    const hinge = new THREE.Group();
    hinge.position.y = 0.88;
    grp.add(hinge);
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 0.035, 36), [steel, faceMat, faceMat]);
    disc.rotation.x = Math.PI / 2;
    disc.position.y = -r * 0.12;
    disc.castShadow = true;
    disc.receiveShadow = true;
    disc.userData.kind = "metal";
    disc.userData.target = hinge;
    hinge.add(disc);
    // upright rim ring encircling the disc in XY plane
    const rim = new THREE.Mesh(new THREE.TorusGeometry(r, 0.015, 10, 36), steel);
    rim.position.y = -r * 0.12;
    rim.castShadow = true;
    hinge.add(rim);
    // rounded posts + crossbar + base with feet
    for (const sx of [-1, 1]) {
      const post = new THREE.Mesh(new RoundedBoxGeometry(0.055, 0.92, 0.055, 3, 0.012), steel);
      post.position.set(sx * (r + 0.08), 0.46, 0.06);
      post.castShadow = true;
      grp.add(post);
      const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.055, 0.06, 12), steel);
      foot.position.set(sx * (r + 0.12), 0.03, 0.18);
      foot.castShadow = true;
      grp.add(foot);
    }
    const bar = new THREE.Mesh(new RoundedBoxGeometry(2 * r + 0.22, 0.055, 0.055, 3, 0.012), steel);
    bar.position.set(0, 0.9, 0.06);
    bar.castShadow = true;
    grp.add(bar);
    const base = new THREE.Mesh(new RoundedBoxGeometry(2 * r + 0.4, 0.05, 0.5, 3, 0.012), steel);
    base.position.y = 0.025;
    base.receiveShadow = true;
    grp.add(base);
    content.add(grp);
    colliders.push(disc);
    targets.push({ group: hinge as unknown as THREE.Group, spring: new Spring(60, 3.5), spin: new Spring(0, 0), baseRotX: 0 });
  };
  plate(-3, 14);
  plate(3.2, 18, 0.28);
  plate(-1, 24, 0.34);
  plate(5, 28, 0.3);
  plate(-5.5, 32, 0.36);
  plate(1.6, 36, 0.4);

  // range distance lane signs (grounded post, horizontal arm, hanging sign board with distance label)
  const makeLaneSignTex = (label: string) => {
    const c = document.createElement("canvas");
    c.width = 256;
    c.height = 160;
    const g = c.getContext("2d")!;
    g.fillStyle = "#e2b218";
    g.fillRect(0, 0, 256, 160);
    g.strokeStyle = "#1d1d1f";
    g.lineWidth = 10;
    g.strokeRect(8, 8, 240, 144);
    g.fillStyle = "#18181a";
    g.font = "bold 74px sans-serif";
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText(label, 128, 84);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  };
  [10, 18, 26, 34].forEach((z) => {
    const grp = new THREE.Group();
    grp.position.set(-11.5, 0, z);
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.042, 1.75, 16), steel);
    post.position.y = 0.875;
    post.castShadow = true;
    grp.add(post);
    const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.095, 0.06, 12), steel);
    foot.position.y = 0.03;
    grp.add(foot);
    // crossarm pointing +X toward range
    const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.56, 10), steel);
    arm.rotation.z = Math.PI / 2;
    arm.position.set(0.24, 1.68, 0);
    arm.castShadow = true;
    grp.add(arm);
    // hanging straps
    for (const bx of [0.14, 0.42]) {
      const br = new THREE.Mesh(new THREE.BoxGeometry(0.024, 0.14, 0.04), steel);
      br.position.set(bx, 1.62, 0);
      grp.add(br);
    }
    // framed signboard facing -Z (toward shooter) and +Z
    const sMat = new THREE.MeshStandardMaterial({ map: makeLaneSignTex(`${z}M`), roughness: 0.55 });
    const board = new THREE.Mesh(new RoundedBoxGeometry(0.48, 0.3, 0.032, 3, 0.008), [steel, steel, steel, steel, sMat, sMat]);
    board.position.set(0.28, 1.44, 0);
    board.castShadow = true;
    grp.add(board);
    content.add(grp);
  });

  /* ---------------- environment polish (visual only, no collision) ---------------- */
  const deco = (m: THREE.Object3D, cast = true) => {
    m.castShadow = cast;
    content.add(m);
    return m;
  };
  const decal = (canvas: HTMLCanvasElement, w: number, h: number, x: number, y: number, z: number, ry = 0) => {
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(w, h),
      new THREE.MeshStandardMaterial({
        map: new THREE.CanvasTexture(canvas),
        transparent: true,
        roughness: 0.95,
        polygonOffset: true,
        polygonOffsetFactor: -4,
        polygonOffsetUnits: -4,
        depthWrite: false,
      }),
    );
    m.rotation.set(-Math.PI / 2, ry, 0, "YXZ");
    m.position.set(x, y, z);
    m.receiveShadow = true;
    content.add(m);
    return m;
  };
  // oil/dirt stains + puddles + cracks on the range
  const stainC = stainCanvas(256);
  for (let i = 0; i < 5; i++) decal(stainC, 2.4, 2.4, -10 + Math.random() * 20, 0.012, 4 + Math.random() * 44, Math.random() * Math.PI);
  decal(puddleCanvas(256), 2.6, 1.8, -4, 0.013, 20, 0.2);
  decal(puddleCanvas(256), 1.9, 1.5, 5, 0.013, 38, -0.3);
  const crackC = crackCanvas(256);
  for (let i = 0; i < 4; i++) decal(crackC, 3, 3, -8 + Math.random() * 16, 0.012, -4 + Math.random() * 50, Math.random() * Math.PI);
  // rocks at the field edges (crafted polyhedral clusters)
  for (let i = 0; i < 5; i++) {
    const cluster = craftedRockCluster(0.7 + Math.random() * 0.5, 100 + i * 17);
    cluster.position.set(-15 + Math.random() * 30, 0, -6 + Math.random() * 52);
    content.add(cluster);
  }
  // wire strand strung between the flag posts
  const wp: THREE.Vector3[] = [];
  for (let i = 0; i <= 8; i++) {
    const t = i / 8;
    wp.push(new THREE.Vector3(-11.5, 1.72 - 0.22 * Math.sin(Math.PI * t), 10 + 24 * t));
  }
  const wireCurve = new THREE.CatmullRomCurve3(wp);
  deco(
    new THREE.Mesh(new THREE.TubeGeometry(wireCurve, 20, 0.012, 6), new THREE.MeshStandardMaterial({ color: 0x2a2a2a, roughness: 0.6, metalness: 0.85 })),
    false,
  );
  // drifting dust motes
  const moteCount = 70;
  const motePos = new Float32Array(moteCount * 3);
  for (let i = 0; i < moteCount; i++) {
    motePos[i * 3] = (Math.random() - 0.5) * 60;
    motePos[i * 3 + 1] = 1 + Math.random() * 10;
    motePos[i * 3 + 2] = (Math.random() - 0.5) * 80;
  }
  const moteGeo = new THREE.BufferGeometry();
  moteGeo.setAttribute("position", new THREE.BufferAttribute(motePos, 3));
  const motes = new THREE.Points(moteGeo, new THREE.PointsMaterial({ color: 0xd8c8a0, size: 0.05, transparent: true, opacity: 0.3, depthWrite: false }));
  deco(motes, false);

  /* ---------------- update ---------------- */
  const update = (dt: number, focus: THREE.Vector3) => {
    sun.position.copy(focus).addScaledVector(sunDir, 40);
    sun.target.position.copy(focus);
    // snap shadow to texel grid to avoid shimmering
    for (const t of targets) {
      const x = t.spring.update(0, dt);
      t.group.rotation.x = x;
    }
    // drift dust motes
    const mp = motes.geometry.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < moteCount; i++) {
      mp.array[i * 3] += Math.sin(i + mp.array[i * 3 + 1] * 0.7) * 0.2 * dt;
      mp.array[i * 3 + 1] -= 0.15 * dt;
      if (mp.array[i * 3 + 1] < 0.5) mp.array[i * 3 + 1] = 11;
    }
    mp.needsUpdate = true;
  };

  const hitTarget = (mesh: THREE.Object3D, impulse: number) => {
    const hinge = mesh.userData.target as THREE.Object3D | undefined;
    if (!hinge) return;
    const t = targets.find((tt) => (tt.group as unknown as THREE.Object3D) === hinge);
    t?.spring.kick(impulse);
  };

  return { colliders, targets, sun, sunDir, update, hitTarget };
}
