import * as THREE from "three";

export const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const smoothstep = (a: number, b: number, v: number) => {
  const t = clamp((v - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
/** frame-rate independent exponential smoothing */
export const damp = (cur: number, target: number, rate: number, dt: number) =>
  lerp(cur, target, 1 - Math.exp(-rate * dt));
export const wrapAngle = (a: number) => {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
};
export const dampAngle = (cur: number, target: number, rate: number, dt: number) =>
  cur + wrapAngle(target - cur) * (1 - Math.exp(-rate * dt));

/** Damped harmonic oscillator – used for recoil, hit reactions, landing, etc. */
export class Spring {
  x = 0;
  v = 0;
  constructor(
    public k = 120,
    public c = 14,
  ) {}
  update(target: number, dt: number) {
    // semi-implicit euler, sub-stepped for stability
    const steps = Math.ceil(dt / 0.008);
    const h = dt / steps;
    for (let i = 0; i < steps; i++) {
      const a = this.k * (target - this.x) - this.c * this.v;
      this.v += a * h;
      this.x += this.v * h;
    }
    return this.x;
  }
  kick(impulse: number) {
    this.v += impulse;
  }
  reset() {
    this.x = 0;
    this.v = 0;
  }
}

export const easeInOut = (t: number) => {
  t = clamp(t, 0, 1);
  return t * t * (3 - 2 * t);
};
export const easeOutCubic = (t: number) => 1 - Math.pow(1 - clamp(t, 0, 1), 3);

export const _v = {
  a: new THREE.Vector3(),
  b: new THREE.Vector3(),
  c: new THREE.Vector3(),
  d: new THREE.Vector3(),
};
