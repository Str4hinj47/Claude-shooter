import * as THREE from "three";
import type { TerrainHeightFn } from "./HeightSystem";

export interface WestgateWaterHandle {
  mesh: THREE.Mesh;
  update: (dt: number) => void;
}

/** Builds a tileable 128×128 tangent-space wave normal DataTexture (works in both Browser and Node tests). */
function createWaterNormalTexture(size = 128): THREE.DataTexture {
  const data = new Uint8Array(size * size * 4);
  const tau = Math.PI * 2;
  const heightAt = (u: number, v: number): number => {
    const a = u * tau;
    const b = v * tau;
    return (
      Math.sin(a * 2 + b * 1) * 0.35 +
      Math.cos(a * 3 - b * 2) * 0.25 +
      Math.sin(a * 5 + b * 4) * 0.16 +
      Math.cos(a * 7 - b * 6) * 0.1
    );
  };

  const eps = 1 / size;
  for (let y = 0; y < size; y++) {
    const v = y / size;
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const dx = (heightAt(u + eps, v) - heightAt(u - eps, v)) * 1.8;
      const dy = (heightAt(u, v + eps) - heightAt(u, v - eps)) * 1.8;
      const nx = -dx;
      const ny = -dy;
      const nz = 1.0;
      const inv = 1 / Math.hypot(nx, ny, nz);
      const idx = (y * size + x) * 4;
      data[idx] = Math.round((nx * inv * 0.5 + 0.5) * 255);
      data[idx + 1] = Math.round((ny * inv * 0.5 + 0.5) * 255);
      data[idx + 2] = Math.round((nz * inv * 0.5 + 0.5) * 255);
      data[idx + 3] = 255;
    }
  }

  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(115, 115);
  tex.needsUpdate = true;
  return tex;
}

export function buildWestgateWater(
  terrainAt: TerrainHeightFn,
  _sunDir: THREE.Vector3,
  worldSize = 2400,
  segments = 160,
): WestgateWaterHandle {
  const segs = Math.max(32, Math.min(160, segments));
  const geo = new THREE.PlaneGeometry(worldSize, worldSize, segs, segs);
  geo.rotateX(-Math.PI / 2);

  // Subtle depth-based coastal turquoise & shallow shoreline tinting
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const colors = new Float32Array(pos.count * 3);
  const deepCol = new THREE.Color(0x134e66);
  const shallowCol = new THREE.Color(0x288fa6);
  const surfCol = new THREE.Color(0x7acbd4);
  const tmp = new THREE.Color();

  for (let i = 0; i < pos.count; i++) {
    const vx = pos.getX(i);
    const vz = pos.getZ(i);
    const ty = terrainAt(vx, vz);
    const depth = Math.max(0, -ty);
    if (depth < 1.2) {
      tmp.copy(surfCol).lerp(shallowCol, depth / 1.2);
    } else {
      const t = Math.min(1, (depth - 1.2) / 5.5);
      tmp.copy(shallowCol).lerp(deepCol, t);
    }
    colors[i * 3] = tmp.r;
    colors[i * 3 + 1] = tmp.g;
    colors[i * 3 + 2] = tmp.b;
  }
  geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));

  const normalMap = createWaterNormalTexture(128);
  const mat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    vertexColors: true,
    roughness: 0.14,
    metalness: 0.34,
    envMapIntensity: 1.35,
    normalMap,
    normalScale: new THREE.Vector2(0.42, 0.42),
    transparent: true,
    opacity: 0.87,
  });

  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = "WestgateWater";
  mesh.position.y = 0.0;
  mesh.receiveShadow = true;
  mesh.renderOrder = 1;

  return {
    mesh,
    update: (dt: number) => {
      normalMap.offset.x = (normalMap.offset.x + dt * 0.018) % 1;
      normalMap.offset.y = (normalMap.offset.y + dt * 0.011) % 1;
    },
  };
}
