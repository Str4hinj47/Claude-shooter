import * as THREE from "three";
import { Sky } from "three/examples/jsm/objects/Sky.js";
import { Spring } from "../character/math";

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
  const cubeRT = new THREE.WebGLCubeRenderTarget(1024, { type: THREE.HalfFloatType });
  const cubeCam = new THREE.CubeCamera(1, 5000, cubeRT);
  cubeCam.update(renderer, skyScene);
  main.background = cubeRT.texture;
  const pmrem = new THREE.PMREMGenerator(renderer);
  main.environment = pmrem.fromCubemap(cubeRT.texture).texture;
  main.environmentIntensity = 0.45;
  main.fog = new THREE.FogExp2(0xc9cfd2, 0.0045);

  /* ---------------- lights ---------------- */
  const sun = new THREE.DirectionalLight(0xffe9cc, 4.2);
  sun.castShadow = true;
  sun.shadow.mapSize.set(4096, 4096);
  const sc = sun.shadow.camera;
  sc.left = -9;
  sc.right = 9;
  sc.top = 9;
  sc.bottom = -9;
  sc.near = 1;
  sc.far = 80;
  sun.shadow.bias = -0.00025;
  sun.shadow.normalBias = 0.03;
  sun.shadow.radius = 2.5;
  content.add(sun, sun.target);
  const hemi = new THREE.HemisphereLight(0xdfe6ee, 0x6a5c48, 0.18);
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

  // concrete berm (backstop)
  const concrete = new THREE.MeshStandardMaterial({ map: tex(noiseCanvas(512, "#a09c94", [["rgba(0,0,0,0.25)", 5000], ["rgba(255,255,255,0.15)", 3000]]), 6), roughness: 0.92 });
  const wall = new THREE.Mesh(new THREE.BoxGeometry(80, 7, 3), concrete);
  wall.position.set(0, 3.5, 52);
  add(wall, "concrete");
  const sideL = new THREE.Mesh(new THREE.BoxGeometry(3, 5, 70), concrete);
  sideL.position.set(-26, 2.5, 18);
  add(sideL, "concrete");
  const sideR = sideL.clone();
  sideR.position.x = 26;
  add(sideR, "concrete");

  // crates
  const wc = noiseCanvas(512, "#8a6a43", [["rgba(40,25,10,0.35)", 6000], ["rgba(255,220,160,0.12)", 2500]]);
  const wg = wc.getContext("2d")!;
  wg.strokeStyle = "rgba(30,18,8,0.7)";
  wg.lineWidth = 5;
  for (let i = 1; i < 5; i++) {
    wg.beginPath();
    wg.moveTo(0, (i * 512) / 5);
    wg.lineTo(512, (i * 512) / 5);
    wg.stroke();
  }
  wg.strokeRect(6, 6, 500, 500);
  wg.beginPath();
  wg.moveTo(6, 6);
  wg.lineTo(506, 506);
  wg.stroke();
  const woodMat = new THREE.MeshStandardMaterial({ map: tex(wc, 1), roughness: 0.82 });
  const crate = (x: number, z: number, s: number, ry = 0, y = 0) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(s, s, s), woodMat);
    m.position.set(x, y + s / 2, z);
    m.rotation.y = ry;
    add(m, "wood");
  };
  crate(-6.5, 8, 1.1, 0.3);
  crate(-6.9, 9.3, 0.9, -0.2);
  crate(-6.6, 8.4, 0.8, 0.8, 1.1);
  crate(7.5, 14, 1.2, -0.4);
  crate(8.8, 14.6, 1.0, 0.2);
  crate(-8, 20, 1.3, 0.5);

  // barrels
  const barrelMat = new THREE.MeshStandardMaterial({ color: 0x9b2c22, roughness: 0.5, metalness: 0.7 });
  const barrel = (x: number, z: number, mat = barrelMat) => {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.9, 28), mat);
    m.position.set(x, 0.45, z);
    add(m, "metal");
    [-0.28, 0, 0.28].forEach((y) => {
      const r = new THREE.Mesh(new THREE.TorusGeometry(0.302, 0.012, 8, 28), mat);
      r.rotation.x = Math.PI / 2;
      r.position.y = y;
      m.add(r);
    });
  };
  barrel(5.5, 8);
  barrel(6.2, 8.6);
  barrel(-4.5, 15, new THREE.MeshStandardMaterial({ color: 0x2f4b6e, roughness: 0.5, metalness: 0.7 }));

  // jersey barriers
  const barrier = (x: number, z: number, ry = 0) => {
    const shape = new THREE.Shape();
    shape.moveTo(-0.4, 0);
    shape.lineTo(0.4, 0);
    shape.lineTo(0.22, 0.28);
    shape.lineTo(0.13, 0.8);
    shape.lineTo(-0.13, 0.8);
    shape.lineTo(-0.22, 0.28);
    shape.closePath();
    const g = new THREE.ExtrudeGeometry(shape, { depth: 2.2, bevelEnabled: false });
    g.translate(0, 0, -1.1);
    const m = new THREE.Mesh(g, concrete);
    m.position.set(x, 0, z);
    m.rotation.y = ry + Math.PI / 2;
    add(m, "concrete");
  };
  barrier(3, 5.5, 0.1);
  barrier(-3.2, 11, -0.1);
  barrier(0, 16.5, Math.PI / 2 + 0.05);

  // steel targets (hinged plates)
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
  const faceMat = new THREE.MeshStandardMaterial({ map: rTex, roughness: 0.5, metalness: 0.5 });
  const plate = (x: number, z: number, r = 0.32) => {
    const grp = new THREE.Group();
    grp.position.set(x, 0, z);
    const hinge = new THREE.Group();
    hinge.position.y = 0.3;
    grp.add(hinge);
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 0.03, 40), [steel, faceMat, steel]);
    disc.rotation.x = -Math.PI / 2;
    disc.position.y = 0.55 + r - 0.3;
    disc.castShadow = true;
    disc.receiveShadow = true;
    disc.userData.kind = "metal";
    disc.userData.target = hinge;
    hinge.add(disc);
    // faceMat sits on cylinder top cap (index 1) – we want it facing -Z (toward shooter)
    disc.rotation.x = -Math.PI / 2;
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.9, 0.05), steel);
    post.position.set(-r - 0.08, 0.45, 0.06);
    post.castShadow = true;
    grp.add(post);
    const post2 = post.clone();
    post2.position.x = r + 0.08;
    grp.add(post2);
    const bar = new THREE.Mesh(new THREE.BoxGeometry(2 * r + 0.21, 0.05, 0.05), steel);
    bar.position.set(0, 0.88, 0.06);
    bar.castShadow = true;
    grp.add(bar);
    const base = new THREE.Mesh(new THREE.BoxGeometry(2 * r + 0.4, 0.04, 0.5), steel);
    base.position.y = 0.02;
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

  // flags / range signs for scale
  const signMat = new THREE.MeshStandardMaterial({ color: 0xe8b814, roughness: 0.6 });
  [10, 18, 26, 34].forEach((z) => {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 1.6, 8), steel);
    post.position.set(-11.5, 0.8, z);
    post.castShadow = true;
    content.add(post);
    const sign = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.35, 0.03), signMat);
    sign.position.set(-11.5, 1.55, z);
    sign.castShadow = true;
    content.add(sign);
  });

  /* ---------------- update ---------------- */
  const update = (dt: number, focus: THREE.Vector3) => {
    sun.position.copy(focus).addScaledVector(sunDir, 40);
    sun.target.position.copy(focus);
    // snap shadow to texel grid to avoid shimmering
    for (const t of targets) {
      const x = t.spring.update(0, dt);
      t.group.rotation.x = x;
    }
  };

  const hitTarget = (mesh: THREE.Object3D, impulse: number) => {
    const hinge = mesh.userData.target as THREE.Object3D | undefined;
    if (!hinge) return;
    const t = targets.find((tt) => (tt.group as unknown as THREE.Object3D) === hinge);
    t?.spring.kick(impulse);
  };

  return { colliders, targets, sun, sunDir, update, hitTarget };
}
