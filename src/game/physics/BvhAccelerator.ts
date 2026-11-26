import * as THREE from "three";
import { acceleratedRaycast, computeBoundsTree, disposeBoundsTree } from "three-mesh-bvh";

let bvhPatched = false;

/**
 * Installs three-mesh-bvh accelerated raycast & BVH builder methods onto Three.js
 * BufferGeometry and Mesh prototypes. Safe to call repeatedly.
 */
export function installBvhPatches(): void {
  if (bvhPatched) return;
  bvhPatched = true;
  (THREE.BufferGeometry.prototype as THREE.BufferGeometry & { computeBoundsTree?: typeof computeBoundsTree }).computeBoundsTree =
    computeBoundsTree;
  (THREE.BufferGeometry.prototype as THREE.BufferGeometry & { disposeBoundsTree?: typeof disposeBoundsTree }).disposeBoundsTree =
    disposeBoundsTree;
  THREE.Mesh.prototype.raycast = acceleratedRaycast;
}

/**
 * Builds BVH acceleration structures on static collider meshes with >= minTriangles
 * so bullet traces, AI line-of-sight checks, and camera occlusion raycasts run 10x–50x faster.
 */
export function buildBvhForObjects(objects: THREE.Object3D[], minTriangles = 24): number {
  installBvhPatches();
  const seen = new Set<THREE.BufferGeometry>();
  let built = 0;

  for (const root of objects) {
    root.traverse((obj) => {
      if (!(obj instanceof THREE.Mesh) || obj.userData.fighter || obj.userData.noBvh) return;
      const geo = obj.geometry as (THREE.BufferGeometry & { boundsTree?: unknown; computeBoundsTree?: () => void }) | undefined;
      if (!geo || geo.boundsTree || seen.has(geo)) return;
      seen.add(geo);
      const pos = geo.getAttribute("position");
      if (!pos) return;
      const triCount = geo.index ? geo.index.count / 3 : pos.count / 3;
      if (triCount < minTriangles) return;
      try {
        geo.computeBoundsTree?.();
        built++;
      } catch {
        // Ignore non-indexed or malformed custom geometries
      }
    });
  }
  return built;
}

export function disposeBvhForObjects(objects: THREE.Object3D[]): void {
  const seen = new Set<THREE.BufferGeometry>();
  for (const root of objects) {
    root.traverse((obj) => {
      if (!(obj instanceof THREE.Mesh)) return;
      const geo = obj.geometry as (THREE.BufferGeometry & { boundsTree?: unknown; disposeBoundsTree?: () => void }) | undefined;
      if (!geo || !geo.boundsTree || seen.has(geo)) return;
      seen.add(geo);
      try {
        geo.disposeBoundsTree?.();
      } catch {}
    });
  }
}
