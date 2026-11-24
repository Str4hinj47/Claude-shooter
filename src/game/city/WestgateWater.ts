import * as THREE from "three";
import type { TerrainHeightFn } from "./HeightSystem";

export interface WestgateWaterHandle {
  mesh: THREE.Mesh;
  update: (dt: number) => void;
}

export function buildWestgateWater(
  _terrainAt: TerrainHeightFn,
  _sunDir: THREE.Vector3,
  worldSize = 2400,
  _segments = 160,
): WestgateWaterHandle {
  const geo = new THREE.PlaneGeometry(worldSize, worldSize, 1, 1);
  geo.rotateX(-Math.PI / 2);

  const mat = new THREE.MeshStandardMaterial({
    color: 0x185b73,
    roughness: 0.24,
    metalness: 0.12,
    transparent: true,
    opacity: 0.84,
  });

  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = "WestgateWater";
  mesh.position.y = 0.0;
  mesh.renderOrder = 1;

  return {
    mesh,
    update: () => {},
  };
}
