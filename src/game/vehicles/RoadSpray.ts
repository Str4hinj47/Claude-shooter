import * as THREE from "three";

export class RoadSpray {
  readonly points: THREE.Points;
  private readonly count = 512;
  private positions = new Float32Array(this.count * 3);
  private colors = new Float32Array(this.count * 3);
  private sizes = new Float32Array(this.count);
  private opacity = new Float32Array(this.count);
  private kinds = new Float32Array(this.count);
  private seeds = new Float32Array(this.count);
  private velocities = new Float32Array(this.count * 3);
  private ages = new Float32Array(this.count).fill(-1);
  private lives = new Float32Array(this.count);
  private strengths = new Float32Array(this.count);
  private initialSizes = new Float32Array(this.count);
  private ground = new Float32Array(this.count);
  private geometry = new THREE.BufferGeometry();
  private material: THREE.PointsMaterial;
  private posAttr: THREE.BufferAttribute;
  private colAttr: THREE.BufferAttribute;
  private sizeAttr: THREE.BufferAttribute;
  private alphaAttr: THREE.BufferAttribute;
  private kindAttr: THREE.BufferAttribute;
  private seedAttr: THREE.BufferAttribute;
  private hasDirtyClear = false;
  private cursor = 0;
  private carry = 0;

  constructor(scene: THREE.Scene) {
    this.posAttr = new THREE.BufferAttribute(this.positions, 3).setUsage(THREE.DynamicDrawUsage);
    this.colAttr = new THREE.BufferAttribute(this.colors, 3).setUsage(THREE.DynamicDrawUsage);
    this.sizeAttr = new THREE.BufferAttribute(this.sizes, 1).setUsage(THREE.DynamicDrawUsage);
    this.alphaAttr = new THREE.BufferAttribute(this.opacity, 1).setUsage(THREE.DynamicDrawUsage);
    this.kindAttr = new THREE.BufferAttribute(this.kinds, 1).setUsage(THREE.DynamicDrawUsage);
    this.seedAttr = new THREE.BufferAttribute(this.seeds, 1).setUsage(THREE.DynamicDrawUsage);
    this.geometry.setAttribute("position", this.posAttr);
    this.geometry.setAttribute("color", this.colAttr);
    this.geometry.setAttribute("spraySize", this.sizeAttr);
    this.geometry.setAttribute("sprayAlpha", this.alphaAttr);
    this.geometry.setAttribute("sprayKind", this.kindAttr);
    this.geometry.setAttribute("spraySeed", this.seedAttr);
    this.material = new THREE.PointsMaterial({
      color: 0xffffff,
      size: 1,
      vertexColors: true,
      transparent: true,
      opacity: 0.75,
      depthWrite: false,
      sizeAttenuation: true,
    });
    this.material.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader
        .replace(
          "#include <common>",
          "#include <common>\nattribute float spraySize; attribute float sprayAlpha; attribute float sprayKind; attribute float spraySeed; varying float vSprayAlpha; varying float vSprayKind; varying float vSpraySeed;",
        )
        .replace(
          "gl_PointSize = size;",
          "gl_PointSize = size * spraySize; vSprayAlpha = sprayAlpha; vSprayKind = sprayKind; vSpraySeed = spraySeed;",
        );
      shader.fragmentShader = shader.fragmentShader
        .replace(
          "#include <common>",
          `#include <common>
        varying float vSprayAlpha; varying float vSprayKind; varying float vSpraySeed;
        float sprayHash(vec2 p) { return fract(sin(dot(p,vec2(127.1,311.7))) * 43758.5453); }
        float sprayNoise(vec2 p) {
          vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
          return mix(mix(sprayHash(i),sprayHash(i+vec2(1.,0.)),f.x),
                     mix(sprayHash(i+vec2(0.,1.)),sprayHash(i+vec2(1.,1.)),f.x),f.y);
        }`,
        )
        .replace(
          "#include <color_fragment>",
          `#include <color_fragment>
          vec2 uv = gl_PointCoord - vec2(0.5);
          float a = vSpraySeed * 6.283185;
          uv = mat2(cos(a),-sin(a),sin(a),cos(a)) * uv;
          float d = length(uv * vec2(1.0, 1.12)) * 2.0;
          float shape;
          if (vSprayKind > 1.5) {
            shape = 1.0 - smoothstep(0.38, 0.94, d);
          } else {
            float n = sprayNoise(uv * 6.0 + vec2(vSpraySeed * 19.0));
            float edge = 1.0 - smoothstep(0.25, 1.0, d);
            shape = edge * edge * mix(0.5, 1.25, n);
          }
          diffuseColor.a *= shape * vSprayAlpha;`,
        );
    };
    this.material.customProgramCacheKey = () => "road-tire-spray-v2";
    this.points = new THREE.Points(this.geometry, this.material);
    this.points.name = "tire-spray";
    this.points.frustumCulled = false;
    this.points.visible = false;
    scene.add(this.points);
  }

  emitForVehicle(
    dt: number,
    position: THREE.Vector3,
    yawPlusZ: number,
    width: number,
    length: number,
    speed: number,
    wet: number,
    snow: number,
    emitScale = 1.0,
  ) {
    dt = Math.max(0, Math.min(0.05, dt));
    const wetness = THREE.MathUtils.clamp(wet, 0, 1);
    const powder = THREE.MathUtils.clamp(snow, 0, 1);
    const moisture = Math.max(wetness, powder);
    const movement = THREE.MathUtils.smoothstep(Math.abs(speed), 3.2, 20);
    const amount = moisture * movement;
    if (amount <= 0.005) return;

    // Forward direction (+Z convention: (sin(yaw), cos(yaw)))
    const fx = Math.sin(yawPlusZ);
    const fz = Math.cos(yawPlusZ);
    const rx = -Math.cos(yawPlusZ);
    const rz = Math.sin(yawPlusZ);
    const spdSign = speed >= 0 ? 1 : -1;
    this.carry += dt * amount * THREE.MathUtils.lerp(135, 320, powder) * emitScale;
    while (this.carry >= 1) {
      this.carry--;
      const i = this.cursor++ % this.count;
      const p = i * 3;
      const isSnow = Math.random() < powder / Math.max(moisture, 0.001);
      const grain = (isSnow && Math.random() < 0.34) || (!isSnow && Math.random() < 0.22);
      const kind = grain ? 2 : isSnow ? 1 : 0;
      const side = (this.cursor % 2 ? -1 : 1) * width * 0.38;
      const jitter = (Math.random() - 0.5) * width * 0.14;
      // 72% rear tires, 28% front tires when moving fast
      const isFront = Math.abs(speed) > 8 && (this.cursor % 4 === 0);
      const axleOffset = (isFront ? -length * 0.31 : length * 0.34) * spdSign;
      this.positions[p] = position.x - fx * axleOffset + rx * (side + jitter);
      this.ground[i] = position.y + 0.02;
      this.positions[p + 1] = this.ground[i] + 0.07 + Math.random() * 0.12;
      this.positions[p + 2] = position.z - fz * axleOffset + rz * (side + jitter);
      const drift = -speed * (isSnow ? 0.38 + Math.random() * 0.22 : 0.46 + Math.random() * 0.14);
      const sideways = (side < 0 ? -1 : 1) * (isSnow ? 0.45 + Math.random() * 0.95 : 0.35 + Math.random() * 0.45);
      this.velocities[p] = fx * drift + rx * sideways;
      this.velocities[p + 1] = grain ? 1.15 + Math.random() * 1.95 : isSnow ? 0.28 + Math.random() * 0.65 : 0.32 + Math.random() * 0.48;
      this.velocities[p + 2] = fz * drift + rz * sideways;
      this.ages[i] = 0;
      this.lives[i] = grain ? 0.48 + Math.random() * 0.38 : isSnow ? 0.65 + Math.random() * 0.65 : 0.62 + Math.random() * 0.42;
      this.strengths[i] = amount;
      this.kinds[i] = kind;
      this.seeds[i] = Math.random();
      this.initialSizes[i] = grain ? 0.05 + Math.random() * 0.055 : isSnow ? 0.32 + Math.random() * 0.24 : 0.36 + Math.random() * 0.22;
      const shade = 0.88 + Math.random() * 0.11;
      this.colors[p] = isSnow ? shade * 0.97 : 0.72;
      this.colors[p + 1] = isSnow ? shade * 0.99 : 0.8;
      this.colors[p + 2] = isSnow ? shade : 0.88;
      this.opacity[i] = 0;
      this.sizes[i] = this.initialSizes[i];
    }
  }

  step(dt: number) {
    dt = Math.max(0, Math.min(0.05, dt));
    let active = 0;
    for (let i = 0; i < this.count; i++) {
      if (this.ages[i] < 0) continue;
      const age = (this.ages[i] += dt);
      const life = this.lives[i];
      const p = i * 3;
      const kind = this.kinds[i];
      if (age >= life || this.positions[p + 1] < this.ground[i]) {
        this.ages[i] = -1;
        this.opacity[i] = 0;
        continue;
      }
      const t = age / life;
      if (kind === 2) this.velocities[p + 1] -= 4.2 * dt;
      else if (kind === 1) {
        this.velocities[p] += Math.sin(age * 6 + this.seeds[i] * 17) * 0.45 * dt;
        this.velocities[p + 2] += Math.cos(age * 5 + this.seeds[i] * 13) * 0.35 * dt;
        this.velocities[p + 1] -= 0.25 * dt;
      }
      this.positions[p] += this.velocities[p] * dt;
      this.positions[p + 1] += this.velocities[p + 1] * dt;
      this.positions[p + 2] += this.velocities[p + 2] * dt;
      const fade = Math.min(1, t * 8) * Math.pow(1 - t, kind === 2 ? 1 : 1.45);
      this.opacity[i] = fade * this.strengths[i] * (kind === 2 ? 0.88 : kind === 1 ? 0.42 : 0.34);
      this.sizes[i] = this.initialSizes[i] * (kind === 2 ? 1 : kind === 1 ? 1 + t * 2.2 : 1 + t * 2.5);
      active++;
    }
    this.points.visible = active > 0;
    if (active > 0) {
      this.posAttr.needsUpdate = true;
      this.colAttr.needsUpdate = true;
      this.sizeAttr.needsUpdate = true;
      this.alphaAttr.needsUpdate = true;
      this.kindAttr.needsUpdate = true;
      this.seedAttr.needsUpdate = true;
      this.hasDirtyClear = true;
    } else if (this.hasDirtyClear) {
      this.alphaAttr.needsUpdate = true;
      this.hasDirtyClear = false;
    }
  }

  update(
    dt: number,
    position: THREE.Vector3,
    yawPlusZ: number,
    width: number,
    length: number,
    speed: number,
    wet: number,
    snow: number,
  ) {
    this.emitForVehicle(dt, position, yawPlusZ, width, length, speed, wet, snow, 1.0);
    this.step(dt);
  }

  dispose() {
    this.geometry.dispose();
    this.material.dispose();
    this.points.removeFromParent();
  }
}
