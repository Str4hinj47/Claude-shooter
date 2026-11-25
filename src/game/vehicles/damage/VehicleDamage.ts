import * as THREE from "three";
import { clamp } from "../../../character/math";

export type DamageZone = "front" | "rear" | "left" | "right" | "roof";

export interface ZoneState {
  front: number;
  rear: number;
  left: number;
  right: number;
  roof: number;
}

interface BoundMesh {
  mesh: THREE.Mesh;
  restPos: Float32Array;
  restNorm: Float32Array | null;
  dispMag: Float32Array;
  meshToChassis: THREE.Matrix4;
  chassisToMesh: THREE.Matrix4;
  centerChassis: THREE.Vector3;
  isGlass: boolean;
  isLight: boolean;
  isFrontLight: boolean;
  shattered: boolean;
}

interface DoorPart {
  name: string;
  node: THREE.Object3D;
  centerChassis: THREE.Vector3;
  homeRotY: number;
  sign: number;
  ajarAngle: number;
  detached: boolean;
}

interface DebrisPiece {
  mesh: THREE.Object3D;
  vx: number;
  vy: number;
  vz: number;
  rx: number;
  ry: number;
  rz: number;
  ttl: number;
}

const _v = new THREE.Vector3();
const _c = new THREE.Vector3();
const _inward = new THREE.Vector3();
const _norm = new THREE.Vector3();
const _invRoot = new THREE.Matrix4();

/**
 * MIT-inspired hybrid GTA + Burnout/open-road real-time vehicle crash deformation system:
 * - Volumetric radial vertex denting + sinusoidal sheet-metal fold buckling
 * - Passenger-cell cabin protection core so roofs/pillars don't collapse unrealistically
 * - Hinged door latch failure (ajar swing) & full door detachment as tumbling world debris
 * - Glass shattering & headlight/taillight breakage
 * - 5-zone mechanical degradation (engine power loss, alignment steering drift, grip loss)
 * - Full 100% mesh/part restoration at Westgate Customs Mod Garages
 */
export class VehicleCrashDeformer {
  readonly zones: ZoneState = { front: 0, rear: 0, left: 0, right: 0, roof: 0 };
  steerBias = 0;
  powerMult = 1;
  gripMult = 1;
  detachedCount = 0;
  brokenGlassCount = 0;
  shatteredLightsCount = 0;

  private readonly width: number;
  private readonly length: number;
  private readonly height: number;
  private modelRoot: THREE.Object3D | null = null;
  private worldScene: THREE.Object3D | null = null;
  private boundMeshes: BoundMesh[] = [];
  private doors: DoorPart[] = [];
  private debris: DebrisPiece[] = [];
  private bound = false;

  onShatter?: (worldPos: THREE.Vector3, kind: "glass" | "detach") => void;

  constructor(width: number, length: number, height: number) {
    this.width = width;
    this.length = length;
    this.height = height;
  }

  attachModel(modelRoot: THREE.Object3D, worldScene?: THREE.Object3D | null): void {
    this.modelRoot = modelRoot;
    this.worldScene = worldScene ?? null;
    this.bound = false;
    this.boundMeshes = [];
    this.doors = [];
  }

  private ensureBound(): boolean {
    if (this.bound) return true;
    const root = this.modelRoot;
    if (!root) return false;
    this.bound = true;

    // Align chassis deformation coordinates with `v.group` (+Z forward, +Y up),
    // accounting for `modelRoot.rotation.y = Math.PI` when mounted inside `v.group`.
    const chassis = root.parent ?? root;
    chassis.updateMatrixWorld(true);
    _invRoot.copy(chassis.matrixWorld).invert();

    const skipSet = new Set<THREE.Object3D>();
    root.traverse((obj) => {
      if (obj.name.startsWith("wheel_pivot_") || obj.name === "contact-shadow" || obj.userData?.isLightbar) {
        obj.traverse((child) => skipSet.add(child));
      }
    });

    // Discover hinged doors (audi, mercedes, ferrari, mustang, golf)
    root.traverse((obj) => {
      if (skipSet.has(obj)) return;
      if (/^door_(fl|fr|rl|rr)$/.test(obj.name)) {
        const box = new THREE.Box3().setFromObject(obj);
        const ctr = box.isEmpty() ? new THREE.Vector3() : box.getCenter(new THREE.Vector3()).applyMatrix4(_invRoot);
        const sideSign =
          obj === root.userData?.driverDoor && typeof root.userData?.driverDoorSign === "number"
            ? (root.userData.driverDoorSign as number)
            : ctr.x < 0
              ? 1
              : -1;
        this.doors.push({
          name: obj.name,
          node: obj,
          centerChassis: ctr,
          homeRotY: obj.rotation.y,
          sign: sideSign,
          ajarAngle: 0,
          detached: false,
        });
      }
    });

    // Clone body/glass/light geometries cleanly so shared GLB prototypes remain untouched
    root.traverse((obj) => {
      if (skipSet.has(obj)) return;
      const mesh = obj as THREE.Mesh;
      if (!mesh.isMesh || !mesh.geometry) return;
      const posAttr = mesh.geometry.getAttribute("position");
      if (!posAttr) return;

      const mat0 = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
      const matName = mat0?.name ?? "";
      const isGlass = matName.startsWith("glass__") || /windshield|rear_glass/i.test(mesh.name);
      const isFrontLight = matName.startsWith("headlight__") || /_hl_/i.test(mesh.name);
      const isLight = isFrontLight || matName.startsWith("taillight__") || /_tl_/i.test(mesh.name);

      // Clone geometry lazily on first impact so undamaged vehicles keep zero extra memory
      const clonedGeo = mesh.geometry.clone();
      mesh.geometry = clonedGeo;

      const cPos = clonedGeo.getAttribute("position") as THREE.BufferAttribute;
      const cNorm = clonedGeo.getAttribute("normal") as THREE.BufferAttribute | undefined;
      const restPos = new Float32Array(cPos.array as ArrayLike<number>);
      const restNorm = cNorm ? new Float32Array(cNorm.array as ArrayLike<number>) : null;

      mesh.updateWorldMatrix(true, false);
      const meshToChassis = new THREE.Matrix4().multiplyMatrices(_invRoot, mesh.matrixWorld);
      const chassisToMesh = new THREE.Matrix4().copy(meshToChassis).invert();

      clonedGeo.computeBoundingBox();
      const centerChassis = clonedGeo.boundingBox
        ? clonedGeo.boundingBox.getCenter(new THREE.Vector3()).applyMatrix4(meshToChassis)
        : new THREE.Vector3();

      this.boundMeshes.push({
        mesh,
        restPos,
        restNorm,
        dispMag: new Float32Array(cPos.count),
        meshToChassis,
        chassisToMesh,
        centerChassis,
        isGlass,
        isLight,
        isFrontLight,
        shattered: false,
      });
    });

    return true;
  }

  /**
   * Applies an impact at `worldPoint` with outward surface `worldNormal` and closing `impactSpeedMs`.
   * Returns true if new plastic deformation occurred.
   */
  applyWorldImpact(
    worldPoint: THREE.Vector3,
    worldNormal: THREE.Vector3,
    vehPos: THREE.Vector3,
    vehYaw: number,
    impactSpeedMs: number,
    customRadius?: number,
  ): boolean {
    if (impactSpeedMs < 4.5 && !customRadius) return false;

    // Transform impact point and inward direction into vehicle chassis frame (+Z forward, +Y up)
    const cosY = Math.cos(-vehYaw);
    const sinY = Math.sin(-vehYaw);
    const dx = worldPoint.x - vehPos.x;
    const dy = worldPoint.y - vehPos.y;
    const dz = worldPoint.z - vehPos.z;
    const lx = dx * cosY + dz * sinY;
    const lz = -dx * sinY + dz * cosY;
    const hitLocal = new THREE.Vector3(
      clamp(lx, -this.width * 0.55, this.width * 0.55),
      clamp(dy, 0.15, this.height * 0.95),
      clamp(lz, -this.length * 0.55, this.length * 0.55),
    );

    const nwx = worldNormal.x;
    const nwy = worldNormal.y;
    const nwz = worldNormal.z;
    // worldNormal points FROM obstacle TOWARD car (or outward from impact); push vertices toward car center
    _inward.set(
      nwx * cosY + nwz * sinY,
      nwy,
      -nwx * sinY + nwz * cosY,
    );
    // Ensure inward vector points inward toward chassis center (0, height*0.42, 0)
    _c.set(-hitLocal.x, this.height * 0.42 - hitLocal.y, -hitLocal.z);
    if (_inward.dot(_c) < 0) _inward.negate();
    if (_inward.lengthSq() < 1e-4) _inward.copy(_c);
    _inward.normalize();

    // 1. Update 5-zone structural damage & mechanical handling degradation
    const sev = clamp((impactSpeedMs - 4.0) / 26.0, 0.04, 0.52);
    const zone = this.classifyZone(hitLocal);
    this.zones[zone] = clamp(this.zones[zone] + sev * (zone === "roof" ? 1.35 : 0.95), 0, 1);

    // Front-corner asymmetry creates realistic wheel alignment pull
    if (hitLocal.z > this.length * 0.12 && Math.abs(hitLocal.x) > this.width * 0.18) {
      const pullDir = hitLocal.x > 0 ? -1 : 1; // +X right corner damage pulls steering right/left
      this.steerBias = clamp(this.steerBias + pullDir * sev * 0.14, -0.16, 0.16);
    }
    this.powerMult = clamp(1 - this.zones.front * 0.42 - this.zones.rear * 0.08, 0.54, 1);
    this.gripMult = clamp(1 - (this.zones.left + this.zones.right) * 0.14 - this.zones.front * 0.1, 0.68, 1);

    // 2. Deform 3D body meshes if bound/available
    if (!this.ensureBound() || this.boundMeshes.length === 0) return true;

    const radius = customRadius ?? clamp(0.72 + impactSpeedMs * 0.042, 0.72, 1.75);
    const maxDentStep = customRadius ? 0.14 : clamp((impactSpeedMs - 4.0) * 0.015, 0.03, 0.24);
    const maxTotalCrush = 0.46;

    // Cabin passenger safety cell bounds (protect occupant greenhouse core)
    const coreHalfW = this.width * 0.26;
    const coreHalfL = this.length * 0.18;
    const coreMinY = 0.34;
    const coreMaxY = this.height * 0.72;

    for (const bm of this.boundMeshes) {
      if (bm.shattered) continue;
      const distCtr = bm.centerChassis.distanceTo(hitLocal);
      if (distCtr > radius + Math.max(this.width, this.length) * 0.65) continue;

      if (bm.isGlass) {
        if (distCtr < radius * 1.15 && (impactSpeedMs >= 10 || customRadius)) {
          bm.shattered = true;
          bm.mesh.visible = false;
          this.brokenGlassCount++;
          this.onShatter?.(worldPoint.clone(), "glass");
        }
        continue;
      }

      if (bm.isLight) {
        if (distCtr < radius * 0.95 && impactSpeedMs >= 11) {
          bm.shattered = true;
          bm.mesh.visible = false;
          this.shatteredLightsCount++;
        }
        continue;
      }

      const geo = bm.mesh.geometry;
      const posAttr = geo.getAttribute("position") as THREE.BufferAttribute;
      const arr = posAttr.array as Float32Array;
      let touched = false;

      // Transform crush direction into mesh-local space (rotation only)
      _norm.copy(_inward).transformDirection(bm.chassisToMesh).normalize();
      const invR = 1 / radius;

      for (let i = 0; i < posAttr.count; i++) {
        const ix = i * 3;
        _v.set(arr[ix], arr[ix + 1], arr[ix + 2]).applyMatrix4(bm.meshToChassis);
        const d = _v.distanceTo(hitLocal);
        if (d >= radius) continue;

        const t = 1 - d * invR;
        const falloff = t * t * (3 - 2 * t);

        // Cabin core guard prevents collapsing the passenger cell completely
        let cabinScale = 1.0;
        if (
          Math.abs(_v.x) < coreHalfW &&
          Math.abs(_v.z) < coreHalfL &&
          _v.y > coreMinY &&
          _v.y < coreMaxY
        ) {
          cabinScale = 0.18;
        }

        const room = Math.max(0, maxTotalCrush - bm.dispMag[i]);
        const delta = Math.min(room, maxDentStep * falloff * cabinScale);
        if (delta <= 0.002) continue;

        // Sinusoidal sheet-metal fold buckle + subtle upward hood/fender pop
        const buckle = Math.sin(_v.x * 23 + _v.z * 19 + _v.y * 17) * delta * 0.28;
        const hoodPop = _v.y > 0.45 && Math.abs(_v.z) > this.length * 0.2 ? delta * 0.26 : 0;

        arr[ix] += _norm.x * delta + buckle * 0.5;
        arr[ix + 1] += _norm.y * delta + hoodPop + buckle * 0.7;
        arr[ix + 2] += _norm.z * delta + buckle * 0.5;
        bm.dispMag[i] += delta;
        touched = true;
      }

      if (touched) {
        posAttr.needsUpdate = true;
        geo.computeVertexNormals();
        if (bm.restNorm) {
          const normAttr = geo.getAttribute("normal") as THREE.BufferAttribute | undefined;
          if (normAttr) {
            const nArr = normAttr.array as Float32Array;
            const rArr = bm.restNorm;
            for (let i = 0; i < posAttr.count; i++) {
              const disp = bm.dispMag[i];
              const ix = i * 3;
              if (disp <= 0.002) {
                nArr[ix] = rArr[ix];
                nArr[ix + 1] = rArr[ix + 1];
                nArr[ix + 2] = rArr[ix + 2];
              } else {
                const w = Math.min(1, disp / 0.075);
                const nx = rArr[ix] + (nArr[ix] - rArr[ix]) * w;
                const ny = rArr[ix + 1] + (nArr[ix + 1] - rArr[ix + 1]) * w;
                const nz = rArr[ix + 2] + (nArr[ix + 2] - rArr[ix + 2]) * w;
                const invLen = 1 / (Math.hypot(nx, ny, nz) || 1);
                nArr[ix] = nx * invLen;
                nArr[ix + 1] = ny * invLen;
                nArr[ix + 2] = nz * invLen;
              }
            }
            normAttr.needsUpdate = true;
          }
        }
      }
    }

    // 3. Hinged door latch failure (ajar) and tear-off detachment
    for (const door of this.doors) {
      if (door.detached) continue;
      const dd = door.centerChassis.distanceTo(hitLocal);
      if (dd > radius * 1.35) continue;

      if (impactSpeedMs >= 18 || this.zones.left > 0.65 || this.zones.right > 0.65) {
        this.detachDoor(door, vehPos, vehYaw, impactSpeedMs);
      } else if (impactSpeedMs >= 8.5) {
        door.ajarAngle = clamp(door.ajarAngle + sev * 0.6, 0.08, 0.42);
        door.node.rotation.y = door.homeRotY + door.sign * door.ajarAngle;
      }
    }

    return true;
  }

  private detachDoor(door: DoorPart, _vehPos: THREE.Vector3, vehYaw: number, impactSpeedMs: number): void {
    door.detached = true;
    door.node.visible = false;
    this.detachedCount++;

    const worldPos = new THREE.Vector3();
    door.node.getWorldPosition(worldPos);
    this.onShatter?.(worldPos, "detach");

    if (!this.worldScene) return;
    const debrisObj = door.node.clone(true);
    debrisObj.visible = true;
    debrisObj.position.copy(worldPos);
    door.node.getWorldQuaternion(debrisObj.quaternion);
    this.worldScene.add(debrisObj);

    const outX = Math.cos(vehYaw) * door.sign;
    const outZ = -Math.sin(vehYaw) * door.sign;
    const spd = clamp(impactSpeedMs * 0.35, 3, 10);
    this.debris.push({
      mesh: debrisObj,
      vx: outX * spd + (Math.random() - 0.5) * 2.5,
      vy: 3.5 + Math.random() * 2.5,
      vz: outZ * spd + (Math.random() - 0.5) * 2.5,
      rx: (Math.random() - 0.5) * 8,
      ry: (Math.random() - 0.5) * 8,
      rz: (Math.random() - 0.5) * 8,
      ttl: 9.0,
    });
  }

  updateDebris(dt: number, groundAt: (x: number, z: number, maxY: number) => number): void {
    for (let i = this.debris.length - 1; i >= 0; i--) {
      const d = this.debris[i];
      d.ttl -= dt;
      if (d.ttl <= 0) {
        d.mesh.parent?.remove(d.mesh);
        this.debris.splice(i, 1);
        continue;
      }
      d.vy -= 18.0 * dt;
      d.mesh.position.x += d.vx * dt;
      d.mesh.position.y += d.vy * dt;
      d.mesh.position.z += d.vz * dt;
      d.mesh.rotation.x += d.rx * dt;
      d.mesh.rotation.y += d.ry * dt;
      d.mesh.rotation.z += d.rz * dt;

      const gy = groundAt(d.mesh.position.x, d.mesh.position.z, d.mesh.position.y + 1.5);
      if (d.mesh.position.y <= gy + 0.14) {
        d.mesh.position.y = gy + 0.14;
        if (Math.abs(d.vy) > 1.2) {
          d.vy = -d.vy * 0.35;
          d.vx *= 0.62;
          d.vz *= 0.62;
          d.rx *= 0.5;
          d.ry *= 0.5;
          d.rz *= 0.5;
        } else {
          d.vy = 0;
          d.vx *= Math.max(0, 1 - 6 * dt);
          d.vz *= Math.max(0, 1 - 6 * dt);
          d.rx *= Math.max(0, 1 - 6 * dt);
          d.ry *= Math.max(0, 1 - 6 * dt);
          d.rz *= Math.max(0, 1 - 6 * dt);
        }
      }
    }
  }

  /** Restores 100% original geometry, glass, lights, doors, and alignment at Mod Garages. */
  repairAll(): void {
    this.zones.front = 0;
    this.zones.rear = 0;
    this.zones.left = 0;
    this.zones.right = 0;
    this.zones.roof = 0;
    this.steerBias = 0;
    this.powerMult = 1;
    this.gripMult = 1;
    this.detachedCount = 0;
    this.brokenGlassCount = 0;
    this.shatteredLightsCount = 0;

    for (const bm of this.boundMeshes) {
      bm.shattered = false;
      bm.mesh.visible = true;
      bm.dispMag.fill(0);
      const geo = bm.mesh.geometry;
      const posAttr = geo.getAttribute("position") as THREE.BufferAttribute;
      (posAttr.array as Float32Array).set(bm.restPos);
      posAttr.needsUpdate = true;
      if (bm.restNorm) {
        const normAttr = geo.getAttribute("normal") as THREE.BufferAttribute | undefined;
        if (normAttr) {
          (normAttr.array as Float32Array).set(bm.restNorm);
          normAttr.needsUpdate = true;
        }
      } else {
        geo.computeVertexNormals();
      }
    }
    for (const door of this.doors) {
      door.detached = false;
      door.ajarAngle = 0;
      door.node.visible = true;
      door.node.rotation.y = door.homeRotY;
    }
    for (const d of this.debris) {
      d.mesh.parent?.remove(d.mesh);
    }
    this.debris.length = 0;
  }

  private classifyZone(hitLocal: THREE.Vector3): DamageZone {
    if (hitLocal.y > this.height * 0.72) return "roof";
    if (hitLocal.z > this.length * 0.18) return "front";
    if (hitLocal.z < -this.length * 0.18) return "rear";
    return hitLocal.x < 0 ? "left" : "right";
  }
}
