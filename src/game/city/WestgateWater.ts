import * as THREE from "three";
import type { TerrainHeightFn } from "./HeightSystem";

export interface WestgateWaterHandle {
  mesh: THREE.Mesh;
  update: (dt: number) => void;
}

const WATER_VERT = /* glsl */ `
  attribute float aDepth;
  uniform float uTime;
  varying float vDepth;
  varying vec3 vWorldPos;
  varying vec3 vNormalW;

  void main() {
    vDepth = aDepth;
    vec4 wp = modelMatrix * vec4(position, 1.0);
    float waveMask = clamp(aDepth * 0.45, 0.0, 1.0);
    float w1 = sin(wp.x * 0.065 + uTime * 1.4) * cos(wp.z * 0.055 - uTime * 1.1);
    float w2 = sin((wp.x + wp.z) * 0.13 - uTime * 2.1);
    wp.y += (w1 * 0.11 + w2 * 0.045) * waveMask;

    float dHx = (0.065 * cos(wp.x * 0.065 + uTime * 1.4) * cos(wp.z * 0.055 - uTime * 1.1) * 0.11
               + 0.13 * cos((wp.x + wp.z) * 0.13 - uTime * 2.1) * 0.045) * waveMask;
    float dHz = (-0.055 * sin(wp.x * 0.065 + uTime * 1.4) * sin(wp.z * 0.055 - uTime * 1.1) * 0.11
               + 0.13 * cos((wp.x + wp.z) * 0.13 - uTime * 2.1) * 0.045) * waveMask;
    vNormalW = normalize(vec3(-dHx, 1.0, -dHz));
    vWorldPos = wp.xyz;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

const WATER_FRAG = /* glsl */ `
  uniform float uTime;
  uniform vec3 uSunDir;
  varying float vDepth;
  varying vec3 vWorldPos;
  varying vec3 vNormalW;

  void main() {
    if (vDepth <= 0.01) discard;

    vec3 viewDir = normalize(cameraPosition - vWorldPos);
    // Micro ripple normal perturbation
    float r1 = sin(vWorldPos.x * 0.55 + uTime * 2.3) * cos(vWorldPos.z * 0.48 - uTime * 1.8);
    float r2 = sin(vWorldPos.x * 1.1 - uTime * 3.1 + vWorldPos.z * 0.9);
    vec3 n = normalize(vNormalW + vec3(r1 * 0.045, 0.0, r2 * 0.045));

    float fresnel = pow(1.0 - max(dot(viewDir, n), 0.0), 3.4);
    vec3 shallowCol = vec3(0.11, 0.46, 0.52);
    vec3 deepCol = vec3(0.03, 0.15, 0.25);
    vec3 skyReflect = vec3(0.56, 0.74, 0.89);

    float depthT = clamp(vDepth / 4.2, 0.0, 1.0);
    vec3 baseCol = mix(shallowCol, deepCol, depthT);
    vec3 col = mix(baseCol, skyReflect, clamp(0.12 + fresnel * 0.72, 0.0, 0.85));

    // Sun specular sparkle
    vec3 halfVec = normalize(normalize(uSunDir) + viewDir);
    float spec = pow(max(dot(n, halfVec), 0.0), 160.0);
    col += vec3(1.0, 0.94, 0.82) * spec * 1.4;

    // Animated shoreline & seawall foam where water is shallow
    float foamBand = 1.0 - smoothstep(0.05, 0.95, vDepth);
    float foamWave = 0.5 + 0.5 * sin(vDepth * 14.0 - uTime * 3.2 + sin(vWorldPos.z * 0.25));
    float foam = foamBand * (0.45 + 0.55 * foamWave);
    col = mix(col, vec3(0.90, 0.95, 0.98), clamp(foam * 0.75, 0.0, 0.85));

    // Distance atmospheric blend
    float dist = length(cameraPosition - vWorldPos);
    float fogT = clamp((dist - 550.0) / 1150.0, 0.0, 1.0);
    col = mix(col, vec3(0.75, 0.83, 0.90), fogT * 0.75);

    float alpha = mix(0.62, 0.94, depthT);
    alpha = max(alpha, foam * 0.85);
    gl_FragColor = vec4(col, alpha);
  }
`;

export function buildWestgateWater(
  terrainAt: TerrainHeightFn,
  sunDir: THREE.Vector3,
  worldSize = 2400,
  segments = 160,
): WestgateWaterHandle {
  const geo = new THREE.PlaneGeometry(worldSize, worldSize, segments, segments);
  geo.rotateX(-Math.PI / 2);

  const pos = geo.attributes.position as THREE.BufferAttribute;
  const depths = new Float32Array(pos.count);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const h = terrainAt(x, z);
    depths[i] = h < 0 ? -h : 0;
  }
  geo.setAttribute("aDepth", new THREE.BufferAttribute(depths, 1));

  const mat = new THREE.ShaderMaterial({
    vertexShader: WATER_VERT,
    fragmentShader: WATER_FRAG,
    transparent: true,
    depthWrite: false,
    uniforms: {
      uTime: { value: 0 },
      uSunDir: { value: sunDir.clone().normalize() },
    },
  });

  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = "WestgateWater";
  mesh.position.y = 0.0;
  mesh.renderOrder = 1;

  return {
    mesh,
    update: (dt: number) => {
      mat.uniforms.uTime.value += dt;
    },
  };
}
