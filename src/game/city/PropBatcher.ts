import * as THREE from "three";
import { whiteBasedMaterial } from "../kit/surface";
import { SpatialAABBGrid } from "./SpatialIndex";

export interface PropPartSpec {
  geometry: THREE.BufferGeometry;
  material: THREE.MeshStandardMaterial;
  localOffset?: [number, number, number];
  localRotation?: [number, number, number];
  localScale?: [number, number, number];
  castShadow?: boolean;
  receiveShadow?: boolean;
  /** Disable per-instance hue/color tinting on this part (e.g. keep emissive lamp lens bright). */
  preserveBaseColor?: boolean;
}

export interface PropPrototype {
  id: string;
  parts: PropPartSpec[];
  /** Optional AABB collider footprint [widthX, heightY, depthZ] centered in XZ, grounded at Y + colliderOffsetY */
  colliderSize?: [number, number, number];
  colliderOffsetY?: number;
}

export interface PropPlacement {
  x: number;
  y: number;
  z: number;
  rx?: number;
  ry?: number;
  rz?: number;
  scale?: number | [number, number, number];
  hueShift?: number;
  colorHex?: number;
}

export interface PropBatchStats {
  prototypes: number;
  instances: number;
  meshes: number;
  colliders: number;
}

/**
 * Batches thousands of repeated city street props & trees (streetlights, palms, oaks,
 * hydrants, bollards, benches, trash cans) into spatially bucketed InstancedMeshes
 * so Three.js frustum culling works at quadrant granularity while draw calls stay minimal.
 */
export class PropBatcher {
  private readonly prototypes = new Map<string, PropPrototype>();
  private readonly buckets = new Map<string, PropPlacement[]>();
  private readonly bucketSize: number;
  private builtMeshes: THREE.InstancedMesh[] = [];
  private builtColliders = 0;
  private totalPlacements = 0;
  private readonly hydrants: Array<{ x: number; y: number; z: number; burstUntil: number }> = [];

  constructor(bucketSize = 480) {
    this.bucketSize = bucketSize;
  }

  registerPrototype(proto: PropPrototype): void {
    this.prototypes.set(proto.id, proto);
  }

  hasPrototype(id: string): boolean {
    return this.prototypes.has(id);
  }

  addInstance(protoId: string, placement: PropPlacement): void {
    if (!this.prototypes.has(protoId)) {
      throw new Error(`PropBatcher: unknown prototype "${protoId}"`);
    }
    const bx = Math.floor(placement.x / this.bucketSize);
    const bz = Math.floor(placement.z / this.bucketSize);
    const key = `${protoId}|${bx},${bz}`;
    let list = this.buckets.get(key);
    if (!list) {
      list = [];
      this.buckets.set(key, list);
    }
    list.push(placement);
    this.totalPlacements++;
    if (protoId === "hydrant") {
      this.hydrants.push({ x: placement.x, y: placement.y, z: placement.z, burstUntil: 0 });
    }
  }

  build(parent: THREE.Object3D, spatialAABBs?: SpatialAABBGrid, rawAabbOut?: THREE.Box3[]): THREE.Group {
    const group = new THREE.Group();
    group.name = "InstancedPropBatches";

    const parentMat = new THREE.Matrix4();
    const localMat = new THREE.Matrix4();
    const finalMat = new THREE.Matrix4();
    const pos = new THREE.Vector3();
    const quat = new THREE.Quaternion();
    const euler = new THREE.Euler();
    const scale = new THREE.Vector3();
    const lPos = new THREE.Vector3();
    const lQuat = new THREE.Quaternion();
    const lEuler = new THREE.Euler();
    const lScale = new THREE.Vector3();
    const color = new THREE.Color();
    const baseHsl = { h: 0, s: 0, l: 0 };

    this.builtMeshes = [];
    this.builtColliders = 0;

    for (const [key, list] of this.buckets) {
      if (list.length === 0) continue;
      const protoId = key.slice(0, key.indexOf("|"));
      const proto = this.prototypes.get(protoId);
      if (!proto) continue;

      // 1. Build one InstancedMesh per part inside this spatial bucket
      for (let pIdx = 0; pIdx < proto.parts.length; pIdx++) {
        const partSpec = proto.parts[pIdx];
        const useTint = !partSpec.preserveBaseColor;
        const mat = useTint ? whiteBasedMaterial(partSpec.material) : partSpec.material;
        const im = new THREE.InstancedMesh(partSpec.geometry, mat, list.length);
        const baseShadow = partSpec.castShadow ?? true;
        im.castShadow = baseShadow;
        im.userData.baseCastShadow = baseShadow;
        im.receiveShadow = partSpec.receiveShadow ?? true;
        im.name = `${key}_p${pIdx}`;

        const off = partSpec.localOffset ?? [0, 0, 0];
        const lrot = partSpec.localRotation ?? [0, 0, 0];
        const lsc = partSpec.localScale ?? [1, 1, 1];
        lPos.set(off[0], off[1], off[2]);
        lEuler.set(lrot[0], lrot[1], lrot[2]);
        lQuat.setFromEuler(lEuler);
        lScale.set(lsc[0], lsc[1], lsc[2]);
        localMat.compose(lPos, lQuat, lScale);

        partSpec.material.color.getHSL(baseHsl);

        for (let i = 0; i < list.length; i++) {
          const pl = list[i];
          pos.set(pl.x, pl.y, pl.z);
          euler.set(pl.rx ?? 0, pl.ry ?? 0, pl.rz ?? 0);
          quat.setFromEuler(euler);
          if (Array.isArray(pl.scale)) scale.set(pl.scale[0], pl.scale[1], pl.scale[2]);
          else {
            const s = pl.scale ?? 1;
            scale.set(s, s, s);
          }
          parentMat.compose(pos, quat, scale);
          finalMat.multiplyMatrices(parentMat, localMat);
          im.setMatrixAt(i, finalMat);

          if (useTint) {
            if (pl.colorHex !== undefined) {
              color.setHex(pl.colorHex);
            } else {
              const hs = pl.hueShift ?? 0;
              color.setHSL(
                (baseHsl.h + hs + 1) % 1,
                baseHsl.s,
                Math.min(1, Math.max(0.05, baseHsl.l * (1 + hs * 2.5))),
              );
            }
            im.setColorAt(i, color);
          }
        }

        im.instanceMatrix.needsUpdate = true;
        if (im.instanceColor) im.instanceColor.needsUpdate = true;
        im.computeBoundingSphere();
        im.computeBoundingBox();
        im.updateMatrix();
        im.matrixAutoUpdate = false;
        group.add(im);
        this.builtMeshes.push(im);
      }

      // 2. Register static AABB colliders (trunks, streetlight poles, hydrants)
      if (proto.colliderSize && (spatialAABBs || rawAabbOut)) {
        const [cw, ch, cd] = proto.colliderSize;
        const cyOff = proto.colliderOffsetY ?? 0;
        for (let i = 0; i < list.length; i++) {
          const pl = list[i];
          const sx = Array.isArray(pl.scale) ? pl.scale[0] : (pl.scale ?? 1);
          const sy = Array.isArray(pl.scale) ? pl.scale[1] : (pl.scale ?? 1);
          const sz = Array.isArray(pl.scale) ? pl.scale[2] : (pl.scale ?? 1);
          const ry = pl.ry ?? 0;
          const ca = Math.abs(Math.cos(ry));
          const sa = Math.abs(Math.sin(ry));
          const hx = (cw * sx * ca + cd * sz * sa) * 0.5;
          const hz = (cw * sx * sa + cd * sz * ca) * 0.5;
          const box = new THREE.Box3(
            new THREE.Vector3(pl.x - hx, pl.y + cyOff * sy, pl.z - hz),
            new THREE.Vector3(pl.x + hx, pl.y + (cyOff + ch) * sy, pl.z + hz),
          );
          spatialAABBs?.insert(box);
          rawAabbOut?.push(box);
          this.builtColliders++;
        }
      }
    }

    parent.add(group);
    return group;
  }

  /** Enables shadow casting only on prop buckets intersecting the local sun shadow frustum. */
  updateShadowCulling(focusX: number, focusZ: number, halfExtent = 74): void {
    const minX = focusX - halfExtent;
    const maxX = focusX + halfExtent;
    const minZ = focusZ - halfExtent;
    const maxZ = focusZ + halfExtent;
    for (let i = 0; i < this.builtMeshes.length; i++) {
      const im = this.builtMeshes[i];
      if (!im.userData.baseCastShadow) continue;
      const bb = im.boundingBox;
      if (!bb) continue;
      im.castShadow = bb.max.x >= minX && bb.min.x <= maxX && bb.max.z >= minZ && bb.min.z <= maxZ;
    }
  }

  /**
   * Swaps built InstancedMeshes of `protoId` to upgraded GLB parts while preserving
   * exact world placement matrices, instance colors, shadow flags, and spatial buckets.
   */
  upgradePrototypeMeshes(
    protoId: string,
    parts: Array<{ geometry: THREE.BufferGeometry; material: THREE.MeshStandardMaterial; castShadow?: boolean; receiveShadow?: boolean }>,
  ): void {
    if (parts.length === 0 || this.builtMeshes.length === 0) return;

    // Group existing InstancedMeshes for this prototype by bucket prefix (`protoId|bx,bz`)
    const buckets = new Map<string, THREE.InstancedMesh[]>();
    const prefix = `${protoId}|`;
    for (const im of this.builtMeshes) {
      if (!im.name.startsWith(prefix)) continue;
      const idx = im.name.lastIndexOf("_p");
      const bKey = idx > 0 ? im.name.slice(0, idx) : im.name;
      let list = buckets.get(bKey);
      if (!list) {
        list = [];
        buckets.set(bKey, list);
      }
      list.push(im);
    }
    if (buckets.size === 0) return;

    const toRemove = new Set<THREE.InstancedMesh>();
    const added: THREE.InstancedMesh[] = [];

    for (const [bKey, oldList] of buckets.entries()) {
      const ref = oldList[0];
      const parent = ref.parent;
      if (!parent) continue;
      const count = ref.count;

      for (let pIdx = 0; pIdx < parts.length; pIdx++) {
        const part = parts[pIdx];
        const mat = whiteBasedMaterial(part.material);
        const im = new THREE.InstancedMesh(part.geometry, mat, count);
        im.castShadow = part.castShadow ?? ref.castShadow;
        im.userData.baseCastShadow = ref.userData.baseCastShadow ?? true;
        im.receiveShadow = part.receiveShadow ?? ref.receiveShadow;
        im.name = `${bKey}_p${pIdx}`;
        im.instanceMatrix.array.set(ref.instanceMatrix.array);
        im.instanceMatrix.needsUpdate = true;
        if (ref.instanceColor && im.instanceColor) {
          im.instanceColor.array.set(ref.instanceColor.array);
          im.instanceColor.needsUpdate = true;
        } else if (ref.instanceColor) {
          const c = new THREE.Color();
          for (let i = 0; i < count; i++) {
            ref.getColorAt(i, c);
            im.setColorAt(i, c);
          }
          if (im.instanceColor) im.instanceColor.needsUpdate = true;
        }
        im.computeBoundingSphere();
        im.computeBoundingBox();
        im.updateMatrix();
        im.matrixAutoUpdate = false;
        parent.add(im);
        added.push(im);
      }

      for (const old of oldList) {
        old.removeFromParent();
        toRemove.add(old);
      }
    }

    this.builtMeshes = this.builtMeshes.filter((m) => !toRemove.has(m));
    this.builtMeshes.push(...added);
  }

  getStats(): PropBatchStats {
    return {
      prototypes: this.prototypes.size,
      instances: this.totalPlacements,
      meshes: this.builtMeshes.length,
      colliders: this.builtColliders,
    };
  }

  hitHydrantAtPoint(px: number, py: number, pz: number, nowSec: number): { x: number; y: number; z: number } | null {
    for (let i = 0; i < this.hydrants.length; i++) {
      const h = this.hydrants[i];
      if (Math.hypot(px - h.x, pz - h.z) < 0.72 && py >= h.y - 0.1 && py <= h.y + 1.25) {
        h.burstUntil = nowSec + 12.0;
        return { x: h.x, y: h.y, z: h.z };
      }
    }
    return null;
  }

  getActiveHydrants(nowSec: number, playerX: number, playerZ: number): Array<{ x: number; y: number; z: number }> {
    const out: Array<{ x: number; y: number; z: number }> = [];
    for (let i = 0; i < this.hydrants.length; i++) {
      const h = this.hydrants[i];
      if (h.burstUntil > nowSec && Math.hypot(h.x - playerX, h.z - playerZ) < 135) {
        out.push(h);
      }
    }
    return out;
  }

  clearPlacements(): void {
    this.buckets.clear();
    this.hydrants.length = 0;
    this.totalPlacements = 0;
    this.builtMeshes = [];
    this.builtColliders = 0;
  }
}
