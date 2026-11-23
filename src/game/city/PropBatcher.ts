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
        im.castShadow = partSpec.castShadow ?? true;
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

  getStats(): PropBatchStats {
    return {
      prototypes: this.prototypes.size,
      instances: this.totalPlacements,
      meshes: this.builtMeshes.length,
      colliders: this.builtColliders,
    };
  }

  clearPlacements(): void {
    this.buckets.clear();
    this.totalPlacements = 0;
    this.builtMeshes = [];
    this.builtColliders = 0;
  }
}
