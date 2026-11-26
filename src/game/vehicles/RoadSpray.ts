import * as THREE from "three";

export type TireSurfaceKind = "asphalt" | "dirt" | "grass" | "sand" | "mud" | "rock";

export class RoadSpray {
  readonly points: THREE.Points;
  private readonly count = 1024;
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
      size: 1.0,
      vertexColors: true,
      transparent: true,
      opacity: 0.92,
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
            shape = 1.0 - smoothstep(0.45, 0.96, d);
          } else {
            float n = sprayNoise(uv * 5.2 + vec2(vSpraySeed * 19.0));
            float edge = 1.0 - smoothstep(0.18, 1.0, d);
            shape = edge * mix(0.62, 1.25, n);
          }
          diffuseColor.a *= clamp(shape, 0.0, 1.0) * vSprayAlpha;`,
        );
    };
    this.material.customProgramCacheKey = () => "road-tire-spray-v3";
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
    slipAmount = 0,
    surfaceKind: TireSurfaceKind = "asphalt",
  ) {
    dt = Math.max(0, Math.min(0.05, dt));
    const wetness = THREE.MathUtils.clamp(wet, 0, 1);
    const powder = THREE.MathUtils.clamp(snow, 0, 1);
    const slip = THREE.MathUtils.clamp(slipAmount, 0, 1);
    const isOffroad = surfaceKind !== "asphalt";
    const offroadFactor =
      surfaceKind === "mud"
        ? 0.95
        : surfaceKind === "sand"
          ? 0.90
          : surfaceKind === "dirt"
            ? 0.78
            : surfaceKind === "grass"
              ? 0.65
              : surfaceKind === "rock"
                ? 0.50
                : 0;
    const surfaceEmit = Math.max(wetness, powder, offroadFactor);
    if (surfaceEmit <= 0.02) return;

    const movement = THREE.MathUtils.smoothstep(Math.abs(speed), 1.6, 16.5);
    const wheelActivity = Math.max(movement, slip * 0.95);
    const amount = surfaceEmit * wheelActivity;
    if (amount <= 0.008) return;

    // Forward direction (+Z convention: (sin(yaw), cos(yaw)))
    const fx = Math.sin(yawPlusZ);
    const fz = Math.cos(yawPlusZ);
    const rx = Math.cos(yawPlusZ);
    const rz = -Math.sin(yawPlusZ);
    const spdSign = speed >= 0 ? 1 : -1;
    const rate = THREE.MathUtils.lerp(165, 360, Math.max(powder, offroadFactor)) * (1 + slip * 0.65);
    this.carry += dt * amount * rate * emitScale;

    while (this.carry >= 1) {
      this.carry--;
      const i = this.cursor++ % this.count;
      const p = i * 3;

      // Choose dominant tire particle mode: snow > mud > sand/dirt/grass > wet spray
      let mode: "snow" | "wet" | "mud" | "sand" | "dirt" | "grass" = "wet";
      if (powder > 0.05 && (powder >= offroadFactor * 0.8 || Math.random() < 0.65)) {
        mode = "snow";
      } else if (isOffroad && surfaceKind !== "rock") {
        mode = surfaceKind;
      } else if (surfaceKind === "rock") {
        mode = "dirt";
      } else if (wetness > 0.04) {
        mode = "wet";
      } else {
        continue;
      }

      const isGrain =
        (mode === "snow" && Math.random() < 0.42) ||
        ((mode === "dirt" || mode === "sand" || mode === "mud" || mode === "grass") && Math.random() < 0.36) ||
        (mode === "wet" && Math.random() < 0.28);
      const kind = isGrain ? 2 : mode === "snow" || mode === "dirt" || mode === "sand" || mode === "grass" ? 1 : 0;

      const side = (this.cursor % 2 ? -1 : 1) * width * 0.40;
      const jitter = (Math.random() - 0.5) * width * 0.14;
      const isFront = (Math.abs(speed) > 4.5 || slip > 0.35) && (this.cursor % 4 === 0);
      const axleOffset = (isFront ? length * 0.31 : -length * 0.32) * spdSign;
      this.positions[p] = position.x + fx * axleOffset + rx * (side + jitter);
      this.ground[i] = position.y - 0.12;
      this.positions[p + 1] = position.y + 0.10 + Math.random() * 0.14;
      this.positions[p + 2] = position.z + fz * axleOffset + rz * (side + jitter);

      const kickBack = Math.max(Math.abs(speed), slip * 11.0) * (mode === "snow" ? 0.34 + Math.random() * 0.24 : 0.40 + Math.random() * 0.22);
      const backSign = speed >= -0.2 ? -1 : 1;
      const sideways = (side < 0 ? -1 : 1) * (0.55 + Math.random() * 1.15) * (1 + slip * 0.7);
      this.velocities[p] = fx * kickBack * backSign + rx * sideways;
      this.velocities[p + 1] = isGrain
        ? 1.55 + Math.random() * 2.25 + slip * 0.9
        : mode === "snow"
          ? 0.55 + Math.random() * 0.95
          : 0.48 + Math.random() * 0.85;
      this.velocities[p + 2] = fz * kickBack * backSign + rz * sideways;

      this.ages[i] = 0;
      this.lives[i] = isGrain ? 0.52 + Math.random() * 0.38 : 0.68 + Math.random() * 0.58;
      this.strengths[i] = Math.max(0.35, amount);
      this.kinds[i] = kind;
      this.seeds[i] = Math.random();
      this.initialSizes[i] = isGrain
        ? 0.11 + Math.random() * 0.08
        : mode === "snow"
          ? 0.46 + Math.random() * 0.34
          : 0.44 + Math.random() * 0.32;

      const shade = 0.88 + Math.random() * 0.12;
      if (mode === "snow") {
        this.colors[p] = shade * 0.96;
        this.colors[p + 1] = shade * 0.98;
        this.colors[p + 2] = shade;
      } else if (mode === "sand") {
        this.colors[p] = shade * 0.86;
        this.colors[p + 1] = shade * 0.76;
        this.colors[p + 2] = shade * 0.56;
      } else if (mode === "mud") {
        this.colors[p] = shade * 0.34;
        this.colors[p + 1] = shade * 0.28;
        this.colors[p + 2] = shade * 0.22;
      } else if (mode === "grass") {
        this.colors[p] = shade * 0.46;
        this.colors[p + 1] = shade * 0.48;
        this.colors[p + 2] = shade * 0.30;
      } else if (mode === "dirt") {
        this.colors[p] = shade * 0.58;
        this.colors[p + 1] = shade * 0.48;
        this.colors[p + 2] = shade * 0.36;
      } else {
        // wet water mist
        this.colors[p] = 0.74;
        this.colors[p + 1] = 0.82;
        this.colors[p + 2] = 0.90;
      }

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
      if (kind === 2) {
        this.velocities[p + 1] -= 5.4 * dt;
      } else if (kind === 1) {
        this.velocities[p] += Math.sin(age * 6 + this.seeds[i] * 17) * 0.55 * dt;
        this.velocities[p + 2] += Math.cos(age * 5 + this.seeds[i] * 13) * 0.45 * dt;
        this.velocities[p + 1] -= 0.35 * dt;
      }
      this.positions[p] += this.velocities[p] * dt;
      this.positions[p + 1] += this.velocities[p + 1] * dt;
      this.positions[p + 2] += this.velocities[p + 2] * dt;
      const fade = Math.min(1, t * 9) * Math.pow(1 - t, kind === 2 ? 0.95 : 1.3);
      this.opacity[i] = fade * this.strengths[i] * (kind === 2 ? 0.94 : kind === 1 ? 0.62 : 0.48);
      this.sizes[i] = this.initialSizes[i] * (kind === 2 ? 1.0 : kind === 1 ? 1 + t * 2.1 : 1 + t * 2.4);
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
