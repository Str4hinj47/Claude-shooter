import * as THREE from "three";

/* ------------------------------------------------------------------ */
/*  Textures                                                           */
/* ------------------------------------------------------------------ */
export function radialTexture(stops: [number, string][], size = 128) {
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
  private head = 0;
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
    geo.setAttribute("position", new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute("size", new THREE.BufferAttribute(this.sizeA, 1).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute("alpha", new THREE.BufferAttribute(this.alphaA, 1).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute("pcolor", new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
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
  }
  setScale(s: number) {
    this.mat.uniforms.uScale.value = s;
  }
  emit(p: THREE.Vector3, v: THREE.Vector3, life: number, size: number, grow: number, color: THREE.Color, drag = 0) {
    const i = this.head;
    this.head = (this.head + 1) % this.max;
    this.pos.set([p.x, p.y, p.z], i * 3);
    this.vel.set([v.x, v.y, v.z], i * 3);
    this.life[i] = life;
    this.maxLife[i] = life;
    this.s0[i] = size;
    this.grow[i] = grow;
    this.col.set([color.r, color.g, color.b], i * 3);
    this.drag[i] = drag;
  }
  update(dt: number) {
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] <= 0) {
        this.alphaA[i] = 0;
        this.sizeA[i] = 0;
        continue;
      }
      this.life[i] -= dt;
      const k = 1 - Math.max(0, this.life[i]) / this.maxLife[i];
      const d = Math.exp(-this.drag[i] * dt);
      this.vel[i * 3] *= d;
      this.vel[i * 3 + 1] = this.vel[i * 3 + 1] * d - this.gravity * dt;
      this.vel[i * 3 + 2] *= d;
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      if (this.pos[i * 3 + 1] < 0.01 && this.gravity > 0) {
        this.pos[i * 3 + 1] = 0.01;
        this.vel[i * 3 + 1] *= -0.3;
      }
      this.sizeA[i] = this.s0[i] + this.grow[i] * k;
      this.alphaA[i] = (1 - k) * (1 - k);
    }
    const g = this.points.geometry;
    (g.getAttribute("position") as THREE.BufferAttribute).needsUpdate = true;
    (g.getAttribute("size") as THREE.BufferAttribute).needsUpdate = true;
    (g.getAttribute("alpha") as THREE.BufferAttribute).needsUpdate = true;
    (g.getAttribute("pcolor") as THREE.BufferAttribute).needsUpdate = true;
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
  private tracers: Tracer[] = [];
  private casings: Casing[] = [];
  private decals: THREE.Mesh[] = [];
  private decalHead = 0;
  private casingHead = 0;
  private tracerHead = 0;
  flash: THREE.Group;
  flashLight: THREE.PointLight;
  private flashT = 0;
  private flashMats: THREE.MeshBasicMaterial[] = [];

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
    this.sparks = new Particles(500, spark, true, 9);
    this.smoke = new Particles(400, soft, false, -0.25);
    this.flashes = new Particles(30, spark, true, 0);
    this.group.add(this.smoke.points, this.sparks.points, this.flashes.points);

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
  }

  muzzleFlash(camera: THREE.Camera) {
    this.flashT = 0.045;
    this.flash.visible = true;
    this.flash.rotation.z = Math.random() * Math.PI;
    const s = 0.8 + Math.random() * 0.5;
    this.flash.scale.setScalar(s);
    this.flashLight.intensity = 14 + Math.random() * 8;
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
    this.sparks.update(dt);
    this.smoke.update(dt);
    this.flashes.update(dt);
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

  init() {
    if (this.ctx) {
      if (this.ctx.state === "suspended") void this.ctx.resume();
      return;
    }
    try {
      const ctx = new AudioContext();
      this.ctx = ctx;
      this.master = ctx.createGain();
      this.master.gain.value = 0.55;
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

  shot() {
    this.burst({ dur: 0.22, freq: 5000, sweepTo: 600, q: 0.5, type: "lowpass", gain: 1.0, reverb: 0.9 });
    this.burst({ dur: 0.05, freq: 3200, q: 0.6, type: "highpass", gain: 0.7 });
    this.tone(150, 38, 0.2, 0.9, "sine");
    this.tone(90, 30, 0.28, 0.6, "triangle");
    this.burst({ dur: 0.9, freq: 700, sweepTo: 200, type: "lowpass", gain: 0.12, reverb: 1.0, delay: 0.02 });
  }
  dry() {
    this.burst({ dur: 0.03, freq: 3500, q: 3, gain: 0.5 });
  }
  magOut() {
    this.burst({ dur: 0.05, freq: 1800, q: 2, gain: 0.5 });
    this.tone(260, 120, 0.06, 0.3, "square");
  }
  magIn() {
    this.burst({ dur: 0.07, freq: 1100, q: 1.5, gain: 0.7 });
    this.tone(180, 70, 0.09, 0.5, "square");
  }
  bolt() {
    this.burst({ dur: 0.05, freq: 2400, q: 2, gain: 0.55 });
    this.burst({ dur: 0.06, freq: 1500, q: 2, gain: 0.7, delay: 0.1 });
    this.tone(320, 110, 0.07, 0.3, "square", 0.1);
  }
  magDrop() {
    this.burst({ dur: 0.08, freq: 600, q: 1, gain: 0.35, delay: 0.25 });
  }
  step(intensity: number) {
    this.burst({ dur: 0.09, freq: 300 + intensity * 250, q: 0.7, type: "lowpass", gain: 0.12 + intensity * 0.22 });
    this.burst({ dur: 0.04, freq: 2200, q: 0.8, gain: 0.03 + intensity * 0.06 });
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
}
