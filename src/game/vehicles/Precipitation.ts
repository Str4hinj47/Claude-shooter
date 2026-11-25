import * as THREE from "three";

export interface ShelterZone {
  ox: number;
  oy: number;
  oz: number;
  cos: number;
  sin: number;
  minLx: number;
  maxLx: number;
  minLz: number;
  maxLz: number;
  maxY: number;
}

export class Precipitation {
  readonly group = new THREE.Group();
  private rain: THREE.LineSegments;
  private rainGeo: THREE.BufferGeometry;
  private rainMat: THREE.LineBasicMaterial;
  private rainPos: Float32Array;
  private rainVel: Float32Array;
  private snow: THREE.Points;
  private snowGeo: THREE.BufferGeometry;
  private snowMat: THREE.PointsMaterial;
  private snowPos: Float32Array;
  private snowVel: Float32Array;
  private readonly rainCount = 1600;
  private readonly snowCount = 4400;
  private readonly box = { x: 46, y: 22, z: 56 };
  private shelters: ShelterZone[] = [];

  addShelterZone(
    ox: number,
    oy: number,
    oz: number,
    yaw: number,
    minLx: number,
    maxLx: number,
    minLz: number,
    maxLz: number,
    height = 9.0,
  ) {
    this.shelters.push({
      ox,
      oy,
      oz,
      cos: Math.cos(yaw),
      sin: Math.sin(yaw),
      minLx,
      maxLx,
      minLz,
      maxLz,
      maxY: oy + height,
    });
  }

  private isInsideShelter(wx: number, wy: number, wz: number): boolean {
    for (let i = 0; i < this.shelters.length; i++) {
      const s = this.shelters[i];
      if (wy > s.maxY || wy < s.oy - 0.5) continue;
      const dx = wx - s.ox;
      const dz = wz - s.oz;
      if (dx * dx + dz * dz > 1600) continue;
      const lx = dx * s.cos - dz * s.sin;
      const lz = dx * s.sin + dz * s.cos;
      if (lx >= s.minLx && lx <= s.maxLx && lz >= s.minLz && lz <= s.maxLz) return true;
    }
    return false;
  }

  constructor(scene: THREE.Scene) {
    this.rainGeo = new THREE.BufferGeometry();
    this.rainPos = new Float32Array(this.rainCount * 6);
    this.rainVel = new Float32Array(this.rainCount * 3);
    const rainColor = new Float32Array(this.rainCount * 6);
    for (let i = 0; i < this.rainCount; i++) {
      this.respawnRain(i, true);
      const c = 0.55 + Math.random() * 0.25;
      rainColor.set([c, c + 0.05, c + 0.12, c * 0.3, c * 0.35, c * 0.4], i * 6);
    }
    this.rainGeo.setAttribute("position", new THREE.BufferAttribute(this.rainPos, 3).setUsage(THREE.DynamicDrawUsage));
    this.rainGeo.setAttribute("color", new THREE.BufferAttribute(rainColor, 3));
    this.rainMat = new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.rain = new THREE.LineSegments(this.rainGeo, this.rainMat);
    this.rain.frustumCulled = false;
    this.group.add(this.rain);

    this.snowGeo = new THREE.BufferGeometry();
    this.snowPos = new Float32Array(this.snowCount * 3);
    this.snowVel = new Float32Array(this.snowCount * 3);
    for (let i = 0; i < this.snowCount; i++) this.respawnSnow(i, true);
    this.snowGeo.setAttribute("position", new THREE.BufferAttribute(this.snowPos, 3).setUsage(THREE.DynamicDrawUsage));
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 16;
    const ctx = canvas.getContext("2d")!;
    const g = ctx.createRadialGradient(8, 8, 0, 8, 8, 8);
    g.addColorStop(0, "rgba(255,255,255,1)");
    g.addColorStop(0.5, "rgba(255,255,255,0.7)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 16, 16);
    this.snowMat = new THREE.PointsMaterial({
      map: new THREE.CanvasTexture(canvas),
      color: 0xffffff,
      size: 0.36,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      sizeAttenuation: true,
    });
    this.snow = new THREE.Points(this.snowGeo, this.snowMat);
    this.snow.frustumCulled = false;
    this.group.add(this.snow);
    scene.add(this.group);
  }

  private respawnRain(i: number, randomY = false) {
    const i3 = i * 3;
    const i6 = i * 6;
    const x = (Math.random() - 0.5) * this.box.x;
    const y = randomY ? Math.random() * this.box.y - 6 : this.box.y - 6 + Math.random() * 6;
    const z = (Math.random() - 0.5) * this.box.z;
    this.rainPos[i6] = x;
    this.rainPos[i6 + 1] = y;
    this.rainPos[i6 + 2] = z;
    this.rainVel[i3] = (Math.random() - 0.5) * 0.6;
    this.rainVel[i3 + 1] = -18 - Math.random() * 10;
    this.rainVel[i3 + 2] = (Math.random() - 0.5) * 0.6;
  }

  private respawnSnow(i: number, randomY = false) {
    const i3 = i * 3;
    this.snowPos[i3] = (Math.random() - 0.5) * this.box.x;
    this.snowPos[i3 + 1] = randomY ? Math.random() * this.box.y - 10 : this.box.y - 10 + Math.random() * 5;
    this.snowPos[i3 + 2] = (Math.random() - 0.5) * this.box.z;
    this.snowVel[i3] = (Math.random() - 0.5) * 0.6;
    this.snowVel[i3 + 1] = -1.2 - Math.random() * 1.4;
    this.snowVel[i3 + 2] = (Math.random() - 0.5) * 0.6;
  }

  update(
    dt: number,
    cameraPos: THREE.Vector3,
    speed: number,
    weather: { rain: number; snow: number; wind: number },
    elapsed: number,
  ) {
    this.group.position.copy(cameraPos);
    this.group.position.y -= 2;
    const rain = weather.rain;
    const snow = weather.snow;
    this.rain.visible = rain > 0.01;
    this.snow.visible = snow > 0.01;
    this.rainMat.opacity = rain * 0.85;
    this.snowMat.opacity = snow * 0.96;
    const wind = weather.wind * 2.5;
    const forward = speed * 0.35;

    const gx = this.group.position.x;
    const gy = this.group.position.y;
    const gz = this.group.position.z;
    const hasShelter = this.shelters.length > 0;

    if (this.rain.visible) {
      const count = Math.floor(this.rainCount * Math.max(0.05, rain));
      this.rainGeo.setDrawRange(0, count * 2);
      for (let i = 0; i < count; i++) {
        const i3 = i * 3;
        const i6 = i * 6;
        let x = this.rainPos[i6] + (this.rainVel[i3] + wind) * dt;
        let y = this.rainPos[i6 + 1] + this.rainVel[i3 + 1] * dt;
        let z = this.rainPos[i6 + 2] + (this.rainVel[i3 + 2] + forward) * dt;
        if (y < -8 || z > this.box.z / 2 || z < -this.box.z / 2) {
          this.respawnRain(i);
          x = this.rainPos[i6];
          y = this.rainPos[i6 + 1];
          z = this.rainPos[i6 + 2];
        }
        const len = 0.55 + Math.min(0.8, Math.abs(speed) * 0.012);
        const vy = this.rainVel[i3 + 1];
        const vz = this.rainVel[i3 + 2] + forward;
        const mag = Math.hypot(vy, vz) || 1;
        this.rainPos[i6] = x;
        this.rainPos[i6 + 1] = y;
        this.rainPos[i6 + 2] = z;
        if (hasShelter && this.isInsideShelter(gx + x, gy + y, gz + z)) {
          this.rainPos[i6 + 3] = x;
          this.rainPos[i6 + 4] = y;
          this.rainPos[i6 + 5] = z;
        } else {
          this.rainPos[i6 + 3] = x - (wind / mag) * len * 0.3;
          this.rainPos[i6 + 4] = y - (vy / mag) * len;
          this.rainPos[i6 + 5] = z - (vz / mag) * len;
        }
      }
      this.rainGeo.attributes.position.needsUpdate = true;
    }

    if (this.snow.visible) {
      const count = Math.floor(this.snowCount * Math.max(0.05, snow));
      this.snowGeo.setDrawRange(0, count);
      for (let i = 0; i < count; i++) {
        const i3 = i * 3;
        const sway = Math.sin(elapsed * 0.9 + this.snowPos[i3 + 2] * 0.12) * 0.7;
        let x = this.snowPos[i3] + (this.snowVel[i3] + wind * 0.5 + sway) * dt;
        let y = this.snowPos[i3 + 1] + this.snowVel[i3 + 1] * dt;
        let z = this.snowPos[i3 + 2] + (this.snowVel[i3 + 2] + forward * 0.4) * dt;
        if (z > this.box.z / 2) z -= this.box.z;
        if (z < -this.box.z / 2) z += this.box.z;
        if (x > this.box.x / 2) x -= this.box.x;
        if (x < -this.box.x / 2) x += this.box.x;
        if (y < -10) y = this.box.y - 10 + Math.random() * 5;
        if (hasShelter && this.isInsideShelter(gx + x, gy + y, gz + z)) {
          // Keep logical flake outside covered building footprint or parked above roof
          y = this.box.y - 4 + Math.random() * 4;
        }
        this.snowPos[i3] = x;
        this.snowPos[i3 + 1] = y;
        this.snowPos[i3 + 2] = z;
      }
      this.snowGeo.attributes.position.needsUpdate = true;
    }
  }

  dispose() {
    this.rainGeo.dispose();
    this.rainMat.dispose();
    this.snowGeo.dispose();
    this.snowMat.dispose();
    this.group.removeFromParent();
  }
}
