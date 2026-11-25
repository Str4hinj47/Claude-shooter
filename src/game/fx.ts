import * as THREE from "three";

/* ------------------------------------------------------------------ */
/*  Textures                                                           */
/* ------------------------------------------------------------------ */
export function radialTexture(stops: [number, string][], size = 128) {
  if (typeof document === "undefined") {
    return new THREE.Texture();
  }
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const g = c.getContext("2d")!;
  const gr = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  stops.forEach(([o, col]) => gr.addColorStop(o, col));
  g.fillStyle = gr;
  g.fillRect(0, 0, size, size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function bloodPoolTexture(size = 128): THREE.Texture {
  if (typeof document === "undefined") {
    return new THREE.Texture();
  }
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const g = c.getContext("2d")!;
  const cx = size / 2;
  const cy = size / 2;
  // Irregular multi-lobe organic crimson pool + peripheral splatter droplets
  const lobes = [
    [0, 0, size * 0.34],
    [size * 0.12, -size * 0.08, size * 0.22],
    [-size * 0.14, size * 0.09, size * 0.2],
    [size * 0.06, size * 0.15, size * 0.18],
    [-size * 0.09, -size * 0.13, size * 0.17],
  ];
  for (const [ox, oy, r] of lobes) {
    const gr = g.createRadialGradient(cx + ox, cy + oy, r * 0.1, cx + ox, cy + oy, r);
    gr.addColorStop(0, "rgba(68, 4, 8, 0.94)");
    gr.addColorStop(0.55, "rgba(115, 10, 14, 0.85)");
    gr.addColorStop(0.85, "rgba(135, 14, 18, 0.42)");
    gr.addColorStop(1, "rgba(90, 8, 12, 0)");
    g.fillStyle = gr;
    g.beginPath();
    g.arc(cx + ox, cy + oy, r, 0, Math.PI * 2);
    g.fill();
  }
  // Spatter dots
  for (let i = 0; i < 18; i++) {
    const a = (i / 18) * Math.PI * 2 + (i % 3) * 0.35;
    const dist = size * (0.28 + ((i * 37) % 100) / 600);
    const rr = size * (0.015 + ((i * 19) % 10) * 0.0025);
    g.fillStyle = "rgba(110, 8, 12, 0.78)";
    g.beginPath();
    g.arc(cx + Math.cos(a) * dist, cy + Math.sin(a) * dist, rr, 0, Math.PI * 2);
    g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/* ------------------------------------------------------------------ */
/*  Particles                                                          */
/* ------------------------------------------------------------------ */
const vs = /* glsl */ `
attribute float size; attribute float alpha; attribute vec3 pcolor;
varying float vA; varying vec3 vC; uniform float uScale;
void main(){
  vA = alpha; vC = pcolor;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = size * uScale / max(0.1, -mv.z);
  gl_Position = projectionMatrix * mv;
}`;
const fs = /* glsl */ `
uniform sampler2D map; varying float vA; varying vec3 vC;
void main(){
  vec4 t = texture2D(map, gl_PointCoord);
  gl_FragColor = vec4(vC * t.rgb, t.a * vA);
}`;

export class Particles {
  readonly points: THREE.Points;
  private max: number;
  private pos: Float32Array;
  private vel: Float32Array;
  private life: Float32Array;
  private maxLife: Float32Array;
  private s0: Float32Array;
  private grow: Float32Array;
  private col: Float32Array;
  private sizeA: Float32Array;
  private alphaA: Float32Array;
  private drag: Float32Array;
  private posAttr: THREE.BufferAttribute;
  private sizeAttr: THREE.BufferAttribute;
  private alphaAttr: THREE.BufferAttribute;
  private colAttr: THREE.BufferAttribute;
  private head = 0;
  private activeCount = 0;
  private dirty = false;
  private mat: THREE.ShaderMaterial;
  constructor(
    max: number,
    tex: THREE.Texture,
    additive: boolean,
    private gravity: number,
  ) {
    this.max = max;
    this.pos = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.life = new Float32Array(max);
    this.maxLife = new Float32Array(max).fill(1);
    this.s0 = new Float32Array(max);
    this.grow = new Float32Array(max);
    this.col = new Float32Array(max * 3);
    this.sizeA = new Float32Array(max);
    this.alphaA = new Float32Array(max);
    this.drag = new Float32Array(max);
    const geo = new THREE.BufferGeometry();
    this.posAttr = new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage);
    this.sizeAttr = new THREE.BufferAttribute(this.sizeA, 1).setUsage(THREE.DynamicDrawUsage);
    this.alphaAttr = new THREE.BufferAttribute(this.alphaA, 1).setUsage(THREE.DynamicDrawUsage);
    this.colAttr = new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute("position", this.posAttr);
    geo.setAttribute("size", this.sizeAttr);
    geo.setAttribute("alpha", this.alphaAttr);
    geo.setAttribute("pcolor", this.colAttr);
    this.mat = new THREE.ShaderMaterial({
      uniforms: { map: { value: tex }, uScale: { value: 600 } },
      vertexShader: vs,
      fragmentShader: fs,
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.points = new THREE.Points(geo, this.mat);
    this.points.frustumCulled = false;
    this.points.visible = false;
  }
  setScale(s: number) {
    this.mat.uniforms.uScale.value = s;
  }
  emit(p: THREE.Vector3, v: THREE.Vector3, life: number, size: number, grow: number, color: THREE.Color, drag = 0) {
    const i = this.head;
    const i3 = i * 3;
    this.head = (this.head + 1) % this.max;
    if (this.life[i] <= 0) this.activeCount++;
    this.pos[i3] = p.x;
    this.pos[i3 + 1] = p.y;
    this.pos[i3 + 2] = p.z;
    this.vel[i3] = v.x;
    this.vel[i3 + 1] = v.y;
    this.vel[i3 + 2] = v.z;
    this.life[i] = life;
    this.maxLife[i] = life;
    this.s0[i] = size;
    this.grow[i] = grow;
    this.col[i3] = color.r;
    this.col[i3 + 1] = color.g;
    this.col[i3 + 2] = color.b;
    this.drag[i] = drag;
    this.dirty = true;
    this.points.visible = true;
  }
  update(dt: number) {
    if (this.activeCount === 0 && !this.dirty) return;
    let alive = 0;
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] <= 0) {
        this.alphaA[i] = 0;
        this.sizeA[i] = 0;
        continue;
      }
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        this.life[i] = 0;
        this.alphaA[i] = 0;
        this.sizeA[i] = 0;
        continue;
      }
      const i3 = i * 3;
      const k = 1 - this.life[i] / this.maxLife[i];
      const d = Math.exp(-this.drag[i] * dt);
      this.vel[i3] *= d;
      this.vel[i3 + 1] = this.vel[i3 + 1] * d - this.gravity * dt;
      this.vel[i3 + 2] *= d;
      this.pos[i3] += this.vel[i3] * dt;
      this.pos[i3 + 1] += this.vel[i3 + 1] * dt;
      this.pos[i3 + 2] += this.vel[i3 + 2] * dt;
      if (this.pos[i3 + 1] < 0.01 && this.gravity > 0) {
        this.pos[i3 + 1] = 0.01;
        this.vel[i3 + 1] *= -0.3;
      }
      this.sizeA[i] = this.s0[i] + this.grow[i] * k;
      this.alphaA[i] = (1 - k) * (1 - k);
      alive++;
    }
    this.activeCount = alive;
    this.points.visible = alive > 0;
    this.posAttr.needsUpdate = true;
    this.sizeAttr.needsUpdate = true;
    this.alphaAttr.needsUpdate = true;
    this.colAttr.needsUpdate = true;
    this.dirty = alive > 0;
  }
}

/* ------------------------------------------------------------------ */
/*  Combat FX manager                                                  */
/* ------------------------------------------------------------------ */
interface Tracer {
  mesh: THREE.Mesh;
  from: THREE.Vector3;
  dir: THREE.Vector3;
  dist: number;
  t: number;
  active: boolean;
}
interface Casing {
  mesh: THREE.Mesh;
  vel: THREE.Vector3;
  spin: THREE.Vector3;
  rest: boolean;
  life: number;
}

export class CombatFX {
  readonly group = new THREE.Group();
  readonly sparks: Particles;
  readonly smoke: Particles;
  readonly flashes: Particles;
  readonly blood: Particles;
  readonly water: Particles;
  private tracers: Tracer[] = [];
  private casings: Casing[] = [];
  private decals: THREE.Mesh[] = [];
  private bloodPools: { mesh: THREE.Mesh; t: number; maxScale: number; active: boolean }[] = [];
  private decalHead = 0;
  private bloodPoolHead = 0;
  private casingHead = 0;
  private tracerHead = 0;
  private woundGeo = new THREE.SphereGeometry(0.085, 8, 6);
  private woundMat = new THREE.MeshStandardMaterial({
    color: 0x5c070b,
    roughness: 0.25,
    metalness: 0.08,
    depthWrite: true,
  });
  flash: THREE.Group;
  flashLight: THREE.PointLight;
  private flashT = 0;
  private flashMats: THREE.MeshBasicMaterial[] = [];
  private tmpPos = new THREE.Vector3();
  private tmpVel = new THREE.Vector3();
  private tmpCol = new THREE.Color();

  constructor() {
    const spark = radialTexture([
      [0, "rgba(255,255,255,1)"],
      [0.25, "rgba(255,220,150,0.9)"],
      [1, "rgba(255,120,20,0)"],
    ]);
    const soft = radialTexture([
      [0, "rgba(255,255,255,0.55)"],
      [0.5, "rgba(255,255,255,0.2)"],
      [1, "rgba(255,255,255,0)"],
    ]);
    const dropTex = radialTexture([
      [0, "rgba(255,255,255,0.96)"],
      [0.45, "rgba(220,220,220,0.88)"],
      [1, "rgba(180,180,180,0)"],
    ]);
    this.sparks = new Particles(500, spark, true, 9);
    this.smoke = new Particles(400, soft, false, -0.25);
    this.flashes = new Particles(30, spark, true, 0);
    this.blood = new Particles(320, dropTex, false, 12.5);
    this.water = new Particles(220, dropTex, false, 11.0);
    this.group.add(this.smoke.points, this.sparks.points, this.flashes.points, this.blood.points, this.water.points);

    // Spreading crimson ground blood pools
    const poolGeo = new THREE.PlaneGeometry(1.15, 1.15);
    poolGeo.rotateX(-Math.PI / 2);
    const poolTex = bloodPoolTexture(128);
    for (let i = 0; i < 64; i++) {
      const mat = new THREE.MeshBasicMaterial({
        map: poolTex,
        transparent: true,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -5,
        polygonOffsetUnits: -5,
      });
      const m = new THREE.Mesh(poolGeo, mat);
      m.visible = false;
      this.group.add(m);
      this.bloodPools.push({ mesh: m, t: 0, maxScale: 1, active: false });
    }

    // tracers
    const tg = new THREE.BoxGeometry(0.012, 0.012, 1);
    tg.translate(0, 0, 0.5);
    for (let i = 0; i < 24; i++) {
      const m = new THREE.Mesh(
        tg,
        new THREE.MeshBasicMaterial({ color: 0xffd9a0, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }),
      );
      m.visible = false;
      this.group.add(m);
      this.tracers.push({ mesh: m, from: new THREE.Vector3(), dir: new THREE.Vector3(), dist: 0, t: 0, active: false });
    }

    // bullet holes
    const dg = new THREE.CircleGeometry(0.035, 12);
    const dtex = radialTexture(
      [
        [0, "rgba(0,0,0,0.95)"],
        [0.45, "rgba(10,10,10,0.9)"],
        [0.7, "rgba(40,35,30,0.35)"],
        [1, "rgba(0,0,0,0)"],
      ],
      64,
    );
    for (let i = 0; i < 80; i++) {
      const m = new THREE.Mesh(
        dg,
        new THREE.MeshBasicMaterial({ map: dtex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }),
      );
      m.visible = false;
      this.group.add(m);
      this.decals.push(m);
    }

    // casings
    const cg = new THREE.CylinderGeometry(0.0042, 0.0046, 0.03, 8);
    const cm = new THREE.MeshStandardMaterial({ color: 0xc89b3c, metalness: 1, roughness: 0.28 });
    for (let i = 0; i < 40; i++) {
      const m = new THREE.Mesh(cg, cm);
      m.visible = false;
      m.castShadow = true;
      this.group.add(m);
      this.casings.push({ mesh: m, vel: new THREE.Vector3(), spin: new THREE.Vector3(), rest: true, life: 0 });
    }

    // muzzle flash (attached to muzzle by caller)
    this.flash = new THREE.Group();
    const ftex = radialTexture([
      [0, "rgba(255,255,240,1)"],
      [0.18, "rgba(255,225,140,0.95)"],
      [0.5, "rgba(255,130,30,0.5)"],
      [1, "rgba(255,80,0,0)"],
    ]);
    const ptex = (() => {
      // star / petal flash
      const c = document.createElement("canvas");
      c.width = 256;
      c.height = 128;
      const g = c.getContext("2d")!;
      const gr = g.createLinearGradient(0, 64, 256, 64);
      gr.addColorStop(0, "rgba(255,200,90,0)");
      gr.addColorStop(0.15, "rgba(255,240,190,1)");
      gr.addColorStop(0.5, "rgba(255,160,50,0.7)");
      gr.addColorStop(1, "rgba(255,90,0,0)");
      g.fillStyle = gr;
      g.beginPath();
      g.moveTo(0, 64);
      g.quadraticCurveTo(110, 4, 256, 64);
      g.quadraticCurveTo(110, 124, 0, 64);
      g.fill();
      const t = new THREE.CanvasTexture(c);
      t.colorSpace = THREE.SRGBColorSpace;
      return t;
    })();
    for (let i = 0; i < 3; i++) {
      const mat = new THREE.MeshBasicMaterial({ map: ptex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
      this.flashMats.push(mat);
      const wrap = new THREE.Group();
      wrap.rotation.z = (i * Math.PI) / 3;
      const p = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.17), mat);
      p.position.z = 0.17;
      p.rotation.y = Math.PI / 2;
      wrap.add(p);
      this.flash.add(wrap);
    }
    const fm = new THREE.MeshBasicMaterial({ map: ftex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
    this.flashMats.push(fm);
    const core = new THREE.Mesh(new THREE.PlaneGeometry(0.28, 0.28), fm);
    core.name = "core";
    this.flash.add(core);
    this.flashLight = new THREE.PointLight(0xffb060, 0, 9, 1.6);
    this.flash.add(this.flashLight);
    this.flash.visible = false;
  }

  setScale(s: number) {
    this.sparks.setScale(s);
    this.smoke.setScale(s);
    this.flashes.setScale(s);
    this.blood.setScale(s);
    this.water.setScale(s);
  }

  /** Arterial crimson splatter + mist on bullet/vehicle impact */
  bloodBurst(p: THREE.Vector3, dir?: THREE.Vector3, intensity = 1) {
    const count = Math.round(14 * intensity);
    const baseDir = dir ? dir.clone().normalize() : new THREE.Vector3(0, 0.4, 0);
    for (let i = 0; i < count; i++) {
      const spread = 1.6 + Math.random() * 2.8 * intensity;
      const v = new THREE.Vector3(
        baseDir.x * (1.2 + Math.random() * 2.2) + (Math.random() - 0.5) * spread,
        0.7 + Math.random() * 2.4 * intensity,
        baseDir.z * (1.2 + Math.random() * 2.2) + (Math.random() - 0.5) * spread,
      );
      const shade = 0.28 + Math.random() * 0.28;
      this.blood.emit(
        p,
        v,
        0.38 + Math.random() * 0.35,
        0.045 + Math.random() * 0.045,
        0.05,
        new THREE.Color(shade, 0.02, 0.03),
        1.1,
      );
    }
    // Fine crimson mist puff
    for (let i = 0; i < 4; i++) {
      const mv = new THREE.Vector3(
        (Math.random() - 0.5) * 0.9,
        0.2 + Math.random() * 0.6,
        (Math.random() - 0.5) * 0.9,
      );
      this.blood.emit(p, mv, 0.32, 0.12, 0.22, new THREE.Color(0.35, 0.02, 0.03), 3.0);
    }
  }

  /** Spreading blood pool on pavement/ground beneath a fallen or wounded character */
  spawnBloodPool(x: number, y: number, z: number, maxScale = 0.95) {
    const bp = this.bloodPools[this.bloodPoolHead];
    this.bloodPoolHead = (this.bloodPoolHead + 1) % this.bloodPools.length;
    bp.mesh.visible = true;
    bp.mesh.position.set(x, y + 0.022, z);
    bp.mesh.rotation.y = Math.random() * Math.PI * 2;
    bp.mesh.scale.setScalar(0.18);
    bp.t = 0;
    bp.maxScale = maxScale * (0.85 + Math.random() * 0.3);
    bp.active = true;
  }

  /** Small blood trail drop when carrying a wounded/dead body */
  bloodDrip(x: number, y: number, z: number) {
    this.spawnBloodPool(x, y, z, 0.22);
    this.blood.emit(
      new THREE.Vector3(x, y + 0.95, z),
      new THREE.Vector3((Math.random() - 0.5) * 0.25, -0.4, (Math.random() - 0.5) * 0.25),
      0.32,
      0.04,
      0.01,
      new THREE.Color(0.32, 0.015, 0.02),
      0.2,
    );
  }

  /** Attach a visible dark-crimson wound mark onto a shot NPC's body */
  attachWoundToCharacter(target: THREE.Object3D, hitHeight = 1.15) {
    if (target.userData.__woundCount >= 4) return;
    target.userData.__woundCount = (target.userData.__woundCount ?? 0) + 1;
    const wound = new THREE.Mesh(this.woundGeo, this.woundMat);
    const angle = Math.random() * Math.PI * 2;
    wound.position.set(Math.cos(angle) * 0.14, hitHeight + (Math.random() - 0.5) * 0.28, Math.sin(angle) * 0.11);
    wound.scale.set(1.1, 1.35, 0.45);
    wound.lookAt(wound.position.x * 2, wound.position.y, wound.position.z * 2);
    target.add(wound);
  }

  /** Ocean/water splash particle spray when dumping a body overboard */
  waterSplash(p: THREE.Vector3, intensity = 1) {
    const count = Math.round(28 * intensity);
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const rSpd = 0.8 + Math.random() * 3.4 * intensity;
      const v = new THREE.Vector3(
        Math.cos(a) * rSpd,
        2.5 + Math.random() * 4.5 * intensity,
        Math.sin(a) * rSpd,
      );
      this.water.emit(
        p,
        v,
        0.55 + Math.random() * 0.45,
        0.16 + Math.random() * 0.16,
        0.35,
        new THREE.Color(0.86, 0.95, 1.0),
        0.9,
      );
    }
  }

  muzzleFlash(camera: THREE.Camera, scale = 1.0) {
    this.flashT = scale < 0.5 ? 0.025 : 0.045;
    this.flash.visible = true;
    this.flash.rotation.z = Math.random() * Math.PI;
    const s = (0.8 + Math.random() * 0.5) * scale;
    this.flash.scale.setScalar(s);
    this.flashLight.intensity = (14 + Math.random() * 8) * scale * scale;
    const core = this.flash.getObjectByName("core")!;
    core.quaternion.copy(camera.quaternion);
    // smoke puff
    const p = this.flash.getWorldPosition(new THREE.Vector3());
    this.smoke.emit(p, new THREE.Vector3((Math.random() - 0.5) * 0.3, 0.25, (Math.random() - 0.5) * 0.3), 1.4, 0.12, 0.5, new THREE.Color(0.75, 0.75, 0.75), 1.5);
  }

  tracer(from: THREE.Vector3, to: THREE.Vector3) {
    const t = this.tracers[this.tracerHead];
    this.tracerHead = (this.tracerHead + 1) % this.tracers.length;
    t.from.copy(from);
    t.dir.copy(to).sub(from);
    t.dist = t.dir.length();
    t.dir.normalize();
    t.t = 0;
    t.active = true;
    t.mesh.visible = true;
    t.mesh.position.copy(from);
    t.mesh.lookAt(to);
  }

  impact(p: THREE.Vector3, n: THREE.Vector3, kind: "dirt" | "metal" | "wood" | "concrete") {
    // decal
    if (kind !== "metal" || true) {
      const d = this.decals[this.decalHead];
      this.decalHead = (this.decalHead + 1) % this.decals.length;
      d.visible = true;
      d.position.copy(p).addScaledVector(n, 0.004);
      d.lookAt(p.clone().add(n));
      d.scale.setScalar(kind === "dirt" ? 1.8 : 1);
    }
    const sparkN = kind === "metal" ? 22 : kind === "concrete" ? 12 : 5;
    const col = kind === "metal" ? new THREE.Color(1, 0.85, 0.5) : kind === "wood" ? new THREE.Color(0.9, 0.6, 0.3) : new THREE.Color(1, 0.8, 0.5);
    for (let i = 0; i < sparkN; i++) {
      const v = new THREE.Vector3((Math.random() - 0.5) * 2, Math.random() * 1.2, (Math.random() - 0.5) * 2).addScaledVector(n, 2 + Math.random() * 3.5).multiplyScalar(1 + Math.random());
      this.sparks.emit(p, v, 0.25 + Math.random() * 0.35, 0.03 + Math.random() * 0.02, -0.02, col, 0.6);
    }
    const dust = kind === "dirt" ? new THREE.Color(0.55, 0.47, 0.38) : kind === "wood" ? new THREE.Color(0.5, 0.4, 0.3) : new THREE.Color(0.6, 0.6, 0.6);
    const n2 = kind === "dirt" ? 7 : 4;
    for (let i = 0; i < n2; i++) {
      const v = new THREE.Vector3((Math.random() - 0.5) * 0.6, Math.random() * 0.4, (Math.random() - 0.5) * 0.6).addScaledVector(n, 0.5 + Math.random() * 0.8);
      this.smoke.emit(p, v, 0.8 + Math.random() * 0.8, 0.1, 0.55, dust, 2.2);
    }
  }

  glassBurst(p: THREE.Vector3) {
    const col = new THREE.Color(0.84, 0.95, 1.0);
    for (let i = 0; i < 16; i++) {
      const v = new THREE.Vector3(
        (Math.random() - 0.5) * 3.8,
        1.1 + Math.random() * 2.4,
        (Math.random() - 0.5) * 3.8,
      );
      this.sparks.emit(p, v, 0.35 + Math.random() * 0.3, 0.045, -0.015, col, 0.4);
    }
  }

  hydrantSpray(p: THREE.Vector3) {
    const sprayCol = new THREE.Color(0.86, 0.96, 1.0);
    for (let i = 0; i < 3; i++) {
      const origin = new THREE.Vector3(p.x, p.y + 0.72, p.z);
      const vel = new THREE.Vector3(
        (Math.random() - 0.5) * 1.35,
        7.5 + Math.random() * 4.2,
        (Math.random() - 0.5) * 1.35,
      );
      this.water.emit(origin, vel, 0.75 + Math.random() * 0.35, 0.28, 0.95, sprayCol, 3.8);
    }
  }

  boatWake(p: THREE.Vector3, yaw: number, speed: number) {
    const absSpd = Math.abs(speed);
    if (absSpd < 2.2) return;
    const fx = Math.sin(yaw);
    const fz = Math.cos(yaw);
    const rx = Math.cos(yaw);
    const rz = -Math.sin(yaw);
    this.tmpCol.setRGB(0.9, 0.97, 1.0);
    for (let s = -1; s <= 1; s += 2) {
      this.tmpPos.set(
        p.x - fx * 2.4 + rx * s * 0.85,
        Math.max(0.05, p.y + 0.05),
        p.z - fz * 2.4 + rz * s * 0.85,
      );
      this.tmpVel.set(
        rx * s * (0.9 + absSpd * 0.09) - fx * 0.8,
        0.3 + Math.random() * (absSpd * 0.05),
        rz * s * (0.9 + absSpd * 0.09) - fz * 0.8,
      );
      this.water.emit(this.tmpPos, this.tmpVel, 0.55 + Math.random() * 0.35, 0.45 + absSpd * 0.025, 0.65, this.tmpCol, 2.6);
    }
  }

  explosion(p: THREE.Vector3, scale = 1) {
    // Core fireball flash
    for (let i = 0; i < 16; i++) {
      const v = new THREE.Vector3(
        (Math.random() - 0.5) * 7 * scale,
        (1.5 + Math.random() * 5.5) * scale,
        (Math.random() - 0.5) * 7 * scale,
      );
      const col = new THREE.Color().setHSL(0.05 + Math.random() * 0.08, 1.0, 0.55);
      this.flashes.emit(p.clone().add(new THREE.Vector3(0, 0.5, 0)), v, 0.38 + Math.random() * 0.25, 1.4 * scale, 3.2 * scale, col, 2.5);
    }
    // Thick rising dark smoke plume
    for (let i = 0; i < 22; i++) {
      const v = new THREE.Vector3(
        (Math.random() - 0.5) * 4.2 * scale,
        (2.0 + Math.random() * 5.2) * scale,
        (Math.random() - 0.5) * 4.2 * scale,
      );
      const g = 0.14 + Math.random() * 0.14;
      this.smoke.emit(p.clone().add(new THREE.Vector3(0, 0.6, 0)), v, 1.6 + Math.random() * 1.4, 0.9 * scale, 1.8 * scale, new THREE.Color(g, g, g), 1.4);
    }
    // Hot flying debris sparks
    for (let i = 0; i < 36; i++) {
      const v = new THREE.Vector3(
        (Math.random() - 0.5) * 14 * scale,
        (3.5 + Math.random() * 10) * scale,
        (Math.random() - 0.5) * 14 * scale,
      );
      this.sparks.emit(p.clone().add(new THREE.Vector3(0, 0.5, 0)), v, 0.55 + Math.random() * 0.45, 0.08 * scale, -0.02, new THREE.Color(1, 0.68, 0.2), 0.7);
    }
  }

  vehicleSmoke(p: THREE.Vector3, burning: boolean) {
    const shade = burning ? 0.16 : 0.52;
    this.tmpVel.set((Math.random() - 0.5) * 0.6, 1.2 + Math.random() * 0.9, (Math.random() - 0.5) * 0.6);
    this.tmpCol.setRGB(shade, shade, shade);
    this.smoke.emit(p, this.tmpVel, 0.85 + Math.random() * 0.5, 0.35, 0.85, this.tmpCol, 1.2);
    if (burning && Math.random() < 0.65) {
      this.tmpVel.set((Math.random() - 0.5) * 0.8, 1.5 + Math.random() * 1.2, (Math.random() - 0.5) * 0.8);
      this.tmpCol.setRGB(1, 0.45, 0.08);
      this.flashes.emit(p, this.tmpVel, 0.24, 0.38, 0.4, this.tmpCol, 1.8);
    }
  }

  casing(pos: THREE.Vector3, dir: THREE.Vector3) {
    const c = this.casings[this.casingHead];
    this.casingHead = (this.casingHead + 1) % this.casings.length;
    c.mesh.visible = true;
    c.mesh.position.copy(pos);
    c.vel.copy(dir).multiplyScalar(2.2 + Math.random() * 1.4);
    c.spin.set(Math.random() * 30 - 15, Math.random() * 30 - 15, Math.random() * 30 - 15);
    c.rest = false;
    c.life = 8;
    c.mesh.rotation.set(Math.random() * 3, Math.random() * 3, Math.random() * 3);
  }

  update(dt: number) {
    if (this.flashT > 0) {
      this.flashT -= dt;
      this.flashLight.intensity *= 0.6;
      if (this.flashT <= 0) {
        this.flash.visible = false;
        this.flashLight.intensity = 0;
      }
    }
    for (const t of this.tracers) {
      if (!t.active) continue;
      t.t += dt;
      const head = t.t * 320;
      const tail = Math.max(0, head - 5);
      if (tail >= t.dist) {
        t.active = false;
        t.mesh.visible = false;
        continue;
      }
      const h = Math.min(head, t.dist);
      t.mesh.position.copy(t.from).addScaledVector(t.dir, tail);
      t.mesh.scale.set(1, 1, Math.max(0.01, h - tail));
    }
    for (const c of this.casings) {
      if (c.rest || !c.mesh.visible) continue;
      c.vel.y -= 12 * dt;
      c.mesh.position.addScaledVector(c.vel, dt);
      c.mesh.rotation.x += c.spin.x * dt;
      c.mesh.rotation.y += c.spin.y * dt;
      c.mesh.rotation.z += c.spin.z * dt;
      if (c.mesh.position.y < 0.006) {
        c.mesh.position.y = 0.006;
        if (c.vel.y < -1) {
          c.vel.y *= -0.35;
          c.vel.x *= 0.5;
          c.vel.z *= 0.5;
          c.spin.multiplyScalar(0.5);
        } else {
          c.rest = true;
          c.mesh.rotation.set(Math.PI / 2, 0, Math.random() * 6);
        }
      }
    }
    for (const bp of this.bloodPools) {
      if (!bp.active) continue;
      bp.t += dt;
      const k = Math.min(1, bp.t / 1.45);
      const ease = 1 - Math.pow(1 - k, 2.5);
      bp.mesh.scale.setScalar(0.18 + (bp.maxScale - 0.18) * ease);
      if (k >= 1) bp.active = false;
    }
    this.sparks.update(dt);
    this.smoke.update(dt);
    this.flashes.update(dt);
    this.blood.update(dt);
    this.water.update(dt);
  }
}

/* ------------------------------------------------------------------ */
/*  Synth audio                                                        */
/* ------------------------------------------------------------------ */
export class Sfx {
  ctx: AudioContext | null = null;
  private master!: GainNode;
  private verb!: ConvolverNode;
  private noise!: AudioBuffer;
  enabled = true;
  volume = 0.55;

  setVolume(v: number) {
    this.volume = Math.max(0, Math.min(1, v));
    if (this.master && this.ctx) {
      this.master.gain.setValueAtTime(this.volume, this.ctx.currentTime);
    }
  }

  init() {
    if (this.ctx) {
      if (this.ctx.state === "suspended") void this.ctx.resume();
      return;
    }
    try {
      const ctx = new AudioContext();
      this.ctx = ctx;
      this.master = ctx.createGain();
      this.master.gain.value = this.volume;
      const comp = ctx.createDynamicsCompressor();
      this.master.connect(comp).connect(ctx.destination);
      // noise + reverb tail
      const len = ctx.sampleRate * 1.5;
      this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = this.noise.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      const ir = ctx.createBuffer(2, ctx.sampleRate * 1.6, ctx.sampleRate);
      for (let c = 0; c < 2; c++) {
        const ch = ir.getChannelData(c);
        for (let i = 0; i < ch.length; i++) ch[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / ch.length, 3.2);
      }
      this.verb = ctx.createConvolver();
      this.verb.buffer = ir;
      const vg = ctx.createGain();
      vg.gain.value = 0.35;
      this.verb.connect(vg).connect(this.master);
    } catch {
      this.ctx = null;
    }
  }

  private burst(opts: { dur: number; freq: number; q?: number; type?: BiquadFilterType; gain: number; sweepTo?: number; reverb?: number; delay?: number }) {
    const ctx = this.ctx;
    if (!ctx || !this.enabled) return;
    const t0 = ctx.currentTime + (opts.delay ?? 0);
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = opts.type ?? "bandpass";
    f.frequency.setValueAtTime(opts.freq, t0);
    if (opts.sweepTo) f.frequency.exponentialRampToValueAtTime(opts.sweepTo, t0 + opts.dur);
    f.Q.value = opts.q ?? 0.8;
    const g = ctx.createGain();
    g.gain.setValueAtTime(opts.gain, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + opts.dur);
    src.connect(f).connect(g).connect(this.master);
    if (opts.reverb) {
      const r = ctx.createGain();
      r.gain.value = opts.reverb;
      g.connect(r).connect(this.verb);
    }
    src.start(t0, Math.random());
    src.stop(t0 + opts.dur + 0.05);
  }

  private tone(freq: number, to: number, dur: number, gain: number, type: OscillatorType = "sine", delay = 0) {
    const ctx = this.ctx;
    if (!ctx || !this.enabled) return;
    const t0 = ctx.currentTime + delay;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t0);
    o.frequency.exponentialRampToValueAtTime(to, t0 + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g).connect(this.master);
    o.start(t0);
    o.stop(t0 + dur + 0.05);
  }

  shot(pitch = 1.0, suppressed = false) {
    if (suppressed) {
      // Crisp tactical silencer "thwip / phut" + subtle mechanical bolt cycle
      this.burst({ dur: 0.065 / Math.sqrt(pitch), freq: 2400 * pitch, sweepTo: 550 * pitch, q: 1.1, type: "bandpass", gain: 0.42, reverb: 0.15 });
      this.burst({ dur: 0.03, freq: 4200 * pitch, q: 0.9, type: "highpass", gain: 0.22 });
      this.burst({ dur: 0.022, freq: 2900, q: 2.2, gain: 0.16, delay: 0.035 });
      this.tone(135 * pitch, 48 * pitch, 0.075, 0.28, "sine");
      return;
    }
    this.burst({ dur: 0.22 / Math.sqrt(pitch), freq: 5000 * pitch, sweepTo: 600 * pitch, q: 0.5, type: "lowpass", gain: 1.0, reverb: 0.95 });
    this.burst({ dur: 0.05, freq: 3200 * pitch, q: 0.6, type: "highpass", gain: 0.72 });
    this.tone(150 * pitch, 38 * pitch, 0.2, 0.9, "sine");
    this.tone(90 * pitch, 30 * pitch, 0.28, 0.6, "triangle");
    this.burst({ dur: 0.9, freq: 700, sweepTo: 200, type: "lowpass", gain: 0.14, reverb: 1.0, delay: 0.02 });
    // Distant urban/canyon slapback tail
    this.burst({ dur: 0.55, freq: 880, sweepTo: 240, type: "lowpass", gain: 0.09, reverb: 0.85, delay: 0.14 });
  }
  switchWeapon() {
    this.burst({ dur: 0.04, freq: 1400, q: 1.4, gain: 0.25 });
  }
  takedown() {
    this.burst({ dur: 0.09, freq: 520, sweepTo: 180, type: "lowpass", gain: 0.55 });
    this.tone(95, 42, 0.11, 0.35, "sine");
  }
  dry() {
    this.burst({ dur: 0.025, freq: 3200, q: 2.5, gain: 0.35 });
  }
  magOut() {
    this.burst({ dur: 0.035, freq: 1600, q: 1.5, gain: 0.28 });
  }
  magIn() {
    this.burst({ dur: 0.045, freq: 1050, q: 1.4, gain: 0.36 });
  }
  bolt() {
    this.burst({ dur: 0.035, freq: 2100, q: 1.8, gain: 0.32 });
    this.burst({ dur: 0.045, freq: 1450, q: 1.6, gain: 0.38, delay: 0.1 });
  }
  magDrop() {
    this.burst({ dur: 0.055, freq: 550, q: 1, gain: 0.2, delay: 0.25 });
  }
  step(intensity: number, surface: "asphalt" | "wood" | "metal" | "dirt" | "water" = "asphalt") {
    if (surface === "water") {
      this.burst({ dur: 0.16, freq: 1450, sweepTo: 420, type: "lowpass", gain: 0.24 + intensity * 0.18 });
      return;
    }
    if (surface === "wood") {
      this.burst({ dur: 0.075, freq: 460 + intensity * 180, q: 1.4, type: "bandpass", gain: 0.16 + intensity * 0.22 });
      this.tone(135, 65, 0.06, 0.14 + intensity * 0.1, "triangle");
      return;
    }
    if (surface === "metal") {
      this.burst({ dur: 0.06, freq: 1650 + intensity * 400, q: 2.2, type: "bandpass", gain: 0.14 + intensity * 0.18 });
      this.tone(410, 290, 0.065, 0.08 + intensity * 0.06, "sine");
      return;
    }
    if (surface === "dirt") {
      this.burst({ dur: 0.1, freq: 620 + intensity * 300, q: 0.6, type: "lowpass", gain: 0.14 + intensity * 0.2 });
      return;
    }
    this.burst({ dur: 0.09, freq: 300 + intensity * 250, q: 0.7, type: "lowpass", gain: 0.12 + intensity * 0.22 });
    this.burst({ dur: 0.04, freq: 2200, q: 0.8, gain: 0.03 + intensity * 0.06 });
  }
  glassShatter() {
    this.burst({ dur: 0.16, freq: 4800, sweepTo: 2200, q: 0.9, type: "highpass", gain: 0.55, reverb: 0.45 });
    this.burst({ dur: 0.22, freq: 3600, q: 1.4, type: "bandpass", gain: 0.35, delay: 0.04 });
    this.tone(2400, 1450, 0.08, 0.18, "triangle");
  }
  binocPing() {
    this.tone(1320, 1760, 0.08, 0.16, "sine");
  }
  headshotPing() {
    this.tone(1850, 2600, 0.09, 0.24, "triangle");
    this.burst({ dur: 0.045, freq: 3400, q: 1.5, gain: 0.28 });
  }
  land(i: number) {
    this.burst({ dur: 0.18, freq: 260, type: "lowpass", gain: 0.5 * i });
    this.tone(90, 45, 0.15, 0.4 * i);
  }
  ping() {
    this.tone(1900 + Math.random() * 500, 1500, 0.35, 0.18, "sine");
    this.burst({ dur: 0.04, freq: 4000, q: 1, gain: 0.3 });
  }
  thud() {
    this.burst({ dur: 0.08, freq: 500, type: "lowpass", gain: 0.4 });
  }
  hit() {
    this.burst({ dur: 0.12, freq: 400, q: 0.8, gain: 0.5 });
    this.tone(120, 60, 0.15, 0.45);
  }
  fall() {
    this.burst({ dur: 0.35, freq: 350, type: "lowpass", gain: 0.6, delay: 0.55 });
    this.tone(70, 35, 0.4, 0.6, "sine", 0.55);
  }
  interactTick() {
    this.tone(1100 + Math.random() * 250, 900, 0.035, 0.14, "triangle");
  }
  interactDone() {
    this.tone(580, 880, 0.12, 0.24, "sine");
    this.tone(880, 1320, 0.16, 0.22, "sine", 0.09);
  }
  trunkThud() {
    this.burst({ dur: 0.14, freq: 240, type: "lowpass", gain: 0.65 });
    this.tone(85, 38, 0.18, 0.55, "triangle");
    this.burst({ dur: 0.05, freq: 1400, q: 1.6, gain: 0.25, delay: 0.08 });
  }
  splash() {
    this.burst({ dur: 0.45, freq: 1800, sweepTo: 420, type: "lowpass", gain: 0.62 });
    this.burst({ dur: 0.22, freq: 3400, type: "highpass", gain: 0.28, delay: 0.03 });
    this.tone(130, 52, 0.22, 0.35, "sine");
  }
}
