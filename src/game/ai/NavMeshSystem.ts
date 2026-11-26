import * as THREE from "three";
import type { NavMesh, NavMeshQuery } from "recast-navigation";

type RecastMod = typeof import("recast-navigation");
type RecastThreeMod = typeof import("@recast-navigation/three");

let recastReady: Promise<{ recast: RecastMod; recastThree: RecastThreeMod }> | null = null;

async function ensureRecastInit(): Promise<{ recast: RecastMod; recastThree: RecastThreeMod }> {
  if (!recastReady) {
    recastReady = (async () => {
      const [recast, recastThree] = await Promise.all([
        import("recast-navigation"),
        import("@recast-navigation/three"),
      ]);
      await recast.init();
      return { recast, recastThree };
    })().catch((err) => {
      recastReady = null;
      throw err;
    });
  }
  return recastReady;
}

/**
 * Runtime Recast NavMesh builder & query wrapper for compound missions.
 * Converts static level collider meshes into a multi-level walkable NavMesh
 * so guards & allies navigate around buildings, doorways, containers, and stairs.
 */
export class NavMeshSystem {
  private navMesh: NavMesh | null = null;
  private query: NavMeshQuery | null = null;
  private disposed = false;

  get ready(): boolean {
    return this.query !== null && !this.disposed;
  }

  async buildFromObjects(objects: THREE.Object3D[]): Promise<boolean> {
    try {
      const { recast, recastThree } = await ensureRecastInit();
      if (this.disposed) return false;

      const meshes: THREE.Mesh[] = [];
      for (const obj of objects) {
        obj.traverse((child) => {
          if (child instanceof THREE.Mesh && child.visible && child.geometry) {
            const posAttr = child.geometry.getAttribute("position");
            if (!posAttr || posAttr.count < 3) return;
            // Skip tiny props, transparent markers, decals, or fighter hitboxes
            if (child.userData.fighter || child.userData.noNav) return;
            const mat = Array.isArray(child.material) ? child.material[0] : child.material;
            if (mat && "transparent" in mat && mat.transparent && "opacity" in mat && (mat.opacity as number) < 0.7) {
              return;
            }
            child.updateMatrixWorld(true);
            meshes.push(child);
          }
        });
      }

      if (meshes.length === 0) return false;

      const result = recastThree.threeToSoloNavMesh(meshes, {
        cs: 0.28,
        ch: 0.2,
        walkableSlopeAngle: 48,
        walkableHeight: 9,
        walkableClimb: 3,
        walkableRadius: 2,
        maxEdgeLen: 24,
        maxSimplificationError: 1.3,
        minRegionArea: 4,
        mergeRegionArea: 16,
        maxVertsPerPoly: 6,
        detailSampleDist: 6,
        detailSampleMaxError: 1,
      });

      if (this.disposed || !result.success || !result.navMesh) {
        return false;
      }

      this.disposeMesh();
      this.navMesh = result.navMesh;
      this.query = new recast.NavMeshQuery(this.navMesh);
      return true;
    } catch {
      return false;
    }
  }

  findPath(from: THREE.Vector3, to: THREE.Vector3): THREE.Vector3[] | null {
    if (!this.query || this.disposed) return null;
    try {
      const startPt = this.query.findClosestPoint(
        { x: from.x, y: from.y + 0.35, z: from.z },
        { halfExtents: { x: 2.5, y: 3.0, z: 2.5 } },
      );
      const endPt = this.query.findClosestPoint(
        { x: to.x, y: to.y + 0.35, z: to.z },
        { halfExtents: { x: 3.5, y: 3.5, z: 3.5 } },
      );
      const s = startPt.success ? startPt.point : { x: from.x, y: from.y, z: from.z };
      const e = endPt.success ? endPt.point : { x: to.x, y: to.y, z: to.z };
      const res = this.query.computePath(s, e, { maxPathPolys: 128 });
      if (!res.success || res.path.length < 2) return null;
      return res.path.map((pt) => new THREE.Vector3(pt.x, pt.y, pt.z));
    } catch {
      return null;
    }
  }

  private disposeMesh() {
    if (this.query) {
      try {
        this.query.destroy();
      } catch {}
      this.query = null;
    }
    if (this.navMesh) {
      try {
        this.navMesh.destroy();
      } catch {}
      this.navMesh = null;
    }
  }

  dispose() {
    this.disposed = true;
    this.disposeMesh();
  }
}
