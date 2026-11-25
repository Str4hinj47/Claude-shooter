import * as THREE from "three";

const MAX_SKID_QUADS = 2400;

/**
 * Ring-buffered InstancedMesh tire skidmark renderer (adapted from MIT daranjacquet/open-road).
 * Zero allocations during driving; lays persistent dark rubber tracks when tires slip or handbrake.
 */
export class TireSkidmarks {
  readonly mesh: THREE.InstancedMesh;
  private cursor = 0;
  private count = 0;

  get activeQuads(): number {
    return this.count;
  }
  private readonly lastLeft = new THREE.Vector3();
  private readonly lastRight = new THREE.Vector3();
  private hasLeft = false;
  private hasRight = false;

  private readonly tmpPos = new THREE.Vector3();
  private readonly tmpQuat = new THREE.Quaternion();
  private readonly tmpScale = new THREE.Vector3();
  private readonly tmpMat = new THREE.Matrix4();
  private readonly tmpEuler = new THREE.Euler();

  constructor() {
    const geo = new THREE.PlaneGeometry(1, 1);
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.56,
      depthWrite: false,
    });
    mat.polygonOffset = true;
    mat.polygonOffsetFactor = -6;

    this.mesh = new THREE.InstancedMesh(geo, mat, MAX_SKID_QUADS);
    this.mesh.name = "westgate-tire-skidmarks";
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    // Initialize instanceColor buffer
    const initCol = new THREE.Color(0x090b0f);
    for (let i = 0; i < MAX_SKID_QUADS; i++) {
      this.mesh.setColorAt(i, initCol);
    }
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  private readonly snowTrackCol = new THREE.Color(0x9fb4c8);
  private readonly rubberTrackCol = new THREE.Color(0x090b0f);

  private stampWheel(isLeft: boolean, x: number, y: number, z: number, width: number, isSnow = false): void {
    const prev = isLeft ? this.lastLeft : this.lastRight;
    const has = isLeft ? this.hasLeft : this.hasRight;
    if (!has) {
      prev.set(x, y, z);
      if (isLeft) this.hasLeft = true;
      else this.hasRight = true;
      return;
    }

    const dx = x - prev.x;
    const dz = z - prev.z;
    const len = Math.hypot(dx, dz);
    if (len < 0.14) return;
    if (len > 4.5) {
      prev.set(x, y, z);
      return;
    }

    this.tmpPos.set((x + prev.x) * 0.5, y + 0.025, (z + prev.z) * 0.5);
    this.tmpEuler.set(0, Math.atan2(dx, dz), 0);
    this.tmpQuat.setFromEuler(this.tmpEuler);
    this.tmpScale.set(width, 1, len * 1.15);
    this.tmpMat.compose(this.tmpPos, this.tmpQuat, this.tmpScale);

    this.mesh.setMatrixAt(this.cursor, this.tmpMat);
    this.mesh.setColorAt(this.cursor, isSnow ? this.snowTrackCol : this.rubberTrackCol);
    this.cursor = (this.cursor + 1) % MAX_SKID_QUADS;
    this.count = Math.min(this.count + 1, MAX_SKID_QUADS);
    this.mesh.count = this.count;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    prev.set(x, y, z);
  }

  recordRearAxle(
    vehPos: THREE.Vector3,
    vehYaw: number,
    width: number,
    length: number,
    tireWidth = 0.24,
    isSnow = false,
  ): void {
    const fx = Math.sin(vehYaw);
    const fz = Math.cos(vehYaw);
    const rx = Math.cos(vehYaw);
    const rz = -Math.sin(vehYaw);
    const rearOffset = -length * 0.31;
    const trackHalf = width * 0.41;

    const lx = vehPos.x + fx * rearOffset - rx * trackHalf;
    const lz = vehPos.z + fz * rearOffset - rz * trackHalf;
    const rwx = vehPos.x + fx * rearOffset + rx * trackHalf;
    const rwz = vehPos.z + fz * rearOffset + rz * trackHalf;

    this.stampWheel(true, lx, vehPos.y, lz, tireWidth, isSnow);
    this.stampWheel(false, rwx, vehPos.y, rwz, tireWidth, isSnow);
  }

  lift(): void {
    this.hasLeft = false;
    this.hasRight = false;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}
