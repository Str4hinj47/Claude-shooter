import * as THREE from "three";
import type { TerrainHeightFn } from "./HeightSystem";

export interface WestgateWaterHandle {
  mesh: THREE.Mesh;
  update: (
    dt: number,
    sunDir?: THREE.Vector3,
    skyHorizon?: THREE.Color,
    skyZenith?: THREE.Color,
    nightMix?: number,
  ) => void;
}

/** Builds a tileable 128×128 tangent-space micro-wave normal DataTexture (works in Browser & Node tests). */
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
  tex.repeat.set(120, 120);
  tex.needsUpdate = true;
  return tex;
}

export function buildWestgateWater(
  terrainAt: TerrainHeightFn,
  sunDir: THREE.Vector3,
  worldSize = 2400,
  segments = 140,
): WestgateWaterHandle {
  const segs = Math.max(48, Math.min(240, segments));
  const geo = new THREE.PlaneGeometry(worldSize, worldSize, segs, segs);
  geo.rotateX(-Math.PI / 2);

  // Depth-based coastal turquoise -> deep ocean tint + per-vertex water depth attribute for shoreline foam & wave damping
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const colors = new Float32Array(pos.count * 3);
  const depths = new Float32Array(pos.count);
  const deepCol = new THREE.Color(0x0b3a4f);
  const midCol = new THREE.Color(0x16647d);
  const shallowCol = new THREE.Color(0x2899ad);
  const surfCol = new THREE.Color(0x76ced6);
  const tmp = new THREE.Color();

  for (let i = 0; i < pos.count; i++) {
    const vx = pos.getX(i);
    const vz = pos.getZ(i);
    const ty = terrainAt(vx, vz);
    const depth = Math.max(0, -ty);
    depths[i] = depth;
    if (depth < 1.1) {
      tmp.copy(surfCol).lerp(shallowCol, depth / 1.1);
    } else if (depth < 3.4) {
      tmp.copy(shallowCol).lerp(midCol, (depth - 1.1) / 2.3);
    } else {
      const t = Math.min(1, (depth - 3.4) / 4.8);
      tmp.copy(midCol).lerp(deepCol, t);
    }
    colors[i * 3] = tmp.r;
    colors[i * 3 + 1] = tmp.g;
    colors[i * 3 + 2] = tmp.b;
  }
  geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  geo.setAttribute("aDepth", new THREE.BufferAttribute(depths, 1));

  const normalMap = createWaterNormalTexture(128);
  const waterUniforms = {
    uTime: { value: 0 },
    uSunDir: { value: sunDir.clone().normalize() },
    uSkyHorizon: { value: new THREE.Color(0xb7d7eb) },
    uSkyZenith: { value: new THREE.Color(0x1a539c) },
    uNightMix: { value: 0 },
  };

  const mat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    vertexColors: true,
    roughness: 0.09,
    metalness: 0.28,
    envMapIntensity: 1.55,
    normalMap,
    normalScale: new THREE.Vector2(0.55, 0.55),
    transparent: true,
    opacity: 0.92,
  });

  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = waterUniforms.uTime;
    shader.uniforms.uSunDir = waterUniforms.uSunDir;
    shader.uniforms.uSkyHorizon = waterUniforms.uSkyHorizon;
    shader.uniforms.uSkyZenith = waterUniforms.uSkyZenith;
    shader.uniforms.uNightMix = waterUniforms.uNightMix;

    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        `#include <common>
        attribute float aDepth;
        uniform float uTime;
        varying float vWaterDepth;
        varying vec3 vWaterWorldPos;
        varying float vWaveCrest;`,
      )
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
        vWaterDepth = aDepth;
        float swellMask = smoothstep(0.15, 2.2, aDepth);
        float w1 = sin(transformed.x * 0.085 + transformed.z * 0.045 + uTime * 1.45);
        float w2 = cos(transformed.x * 0.055 - transformed.z * 0.115 + uTime * 1.85);
        float w3 = sin(transformed.x * 0.19 + transformed.z * 0.16 - uTime * 2.45);
        float disp = (w1 * 0.14 + w2 * 0.09 + w3 * 0.045) * swellMask;
        transformed.y += disp;
        vWaveCrest = clamp((w1 * 0.5 + w2 * 0.35 + w3 * 0.15) * 0.5 + 0.5, 0.0, 1.0) * swellMask;
        vWaterWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;`,
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
        uniform float uTime;
        uniform vec3 uSunDir;
        uniform vec3 uSkyHorizon;
        uniform vec3 uSkyZenith;
        uniform float uNightMix;
        varying float vWaterDepth;
        varying vec3 vWaterWorldPos;
        varying float vWaveCrest;
        float wHash(vec2 p) {
          return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
        }
        float wNoise(vec2 p) {
          vec2 i = floor(p);
          vec2 f = fract(p);
          vec2 u = f * f * (3.0 - 2.0 * f);
          return mix(
            mix(wHash(i), wHash(i + vec2(1.0, 0.0)), u.x),
            mix(wHash(i + vec2(0.0, 1.0)), wHash(i + vec2(1.0, 1.0)), u.x),
            u.y
          );
        }`,
      )
      .replace(
        "#include <normal_fragment_maps>",
        `#include <normal_fragment_maps>
        // Multi-directional animated capillary wave normal perturbation
        vec2 wp = vWaterWorldPos.xz;
        float rnA = wNoise(wp * 0.42 + vec2(uTime * 0.32, uTime * 0.18));
        float rnB = wNoise(wp * 1.15 - vec2(uTime * 0.24, uTime * 0.46));
        float rnC = wNoise(wp * 3.10 + vec2(uTime * 0.55, -uTime * 0.35));
        float eps = 0.18;
        float rDx = (wNoise((wp + vec2(eps, 0.0)) * 0.72 + vec2(uTime * 0.28, 0.0)) - rnA) * 0.65
                  + (wNoise((wp + vec2(eps, 0.0)) * 2.15 - vec2(0.0, uTime * 0.38)) - rnB) * 0.45;
        float rDz = (wNoise((wp + vec2(0.0, eps)) * 0.72 + vec2(uTime * 0.28, 0.0)) - rnA) * 0.65
                  + (wNoise((wp + vec2(0.0, eps)) * 2.15 - vec2(0.0, uTime * 0.38)) - rnB) * 0.45;
        vec3 wavePerturb = (viewMatrix * vec4(-rDx * 1.4, 0.0, -rDz * 1.4, 0.0)).xyz;
        normal = normalize(normal + wavePerturb * (0.45 + 0.55 * rnC));`,
      )
      .replace(
        "#include <color_fragment>",
        `#include <color_fragment>
        vec3 viewDirW = normalize(cameraPosition - vWaterWorldPos);
        // Schlick Fresnel sky reflection & sun specular sparkle
        float ndotv = clamp(viewDirW.y, 0.02, 1.0);
        float fresnel = 0.03 + 0.97 * pow(1.0 - ndotv, 4.2);
        vec3 skyRefl = mix(uSkyZenith, uSkyHorizon, pow(1.0 - ndotv, 1.8));
        diffuseColor.rgb = mix(diffuseColor.rgb, skyRefl, fresnel * 0.72);

        // Animated shoreline & pier surf foam
        float foamNoise1 = wNoise(vWaterWorldPos.xz * 0.65 + vec2(uTime * 0.22, -uTime * 0.14));
        float foamNoise2 = wNoise(vWaterWorldPos.xz * 2.1 - vec2(uTime * 0.36, uTime * 0.25));
        float shoreBand = 1.0 - smoothstep(0.05, 0.95, vWaterDepth);
        float surfWave = 0.5 + 0.5 * sin(vWaterDepth * 7.5 - uTime * 2.6 + foamNoise1 * 3.0);
        float shoreFoam = shoreBand * smoothstep(0.28, 0.78, foamNoise1 * 0.55 + foamNoise2 * 0.45 + surfWave * 0.42);
        // Subtle offshore whitecaps on high wave crests
        float crestFoam = smoothstep(0.76, 0.96, vWaveCrest) * smoothstep(0.42, 0.85, foamNoise2) * 0.38;
        float foamAmt = clamp(shoreFoam * 0.85 + crestFoam, 0.0, 0.92);
        vec3 foamCol = mix(vec3(0.88, 0.94, 0.97), vec3(0.45, 0.54, 0.65), uNightMix * 0.75);
        diffuseColor.rgb = mix(diffuseColor.rgb, foamCol, foamAmt);

        // Shallow water clarity -> deep opaque Pacific absorption
        float depthAlpha = mix(0.60, 0.96, smoothstep(0.0, 2.4, vWaterDepth));
        diffuseColor.a = max(depthAlpha, foamAmt * 0.92);`,
      )
      .replace(
        "#include <dithering_fragment>",
        `#include <dithering_fragment>
        // Crisp directional sun/moon glitter path on wave ripples
        vec3 vDirG = normalize(cameraPosition - vWaterWorldPos);
        vec3 hVecG = normalize(normalize(uSunDir) + vDirG);
        float glitterN = wNoise(vWaterWorldPos.xz * 2.8 + vec2(uTime * 0.55, -uTime * 0.42));
        float specTight = pow(max(0.0, dot(vec3(0.0, 1.0, 0.0), hVecG)), 140.0) * (0.55 + 0.95 * glitterN);
        vec3 sunGlint = mix(vec3(1.0, 0.92, 0.78), vec3(0.62, 0.74, 0.95), uNightMix);
        gl_FragColor.rgb += sunGlint * specTight * (1.0 - uNightMix * 0.68) * 0.95;`,
      );
  };
  mat.customProgramCacheKey = () => "westgate-water-gerstner-v2";

  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = "WestgateWater";
  mesh.position.y = 0.0;
  mesh.receiveShadow = true;
  mesh.renderOrder = 1;

  return {
    mesh,
    update: (dt: number, liveSunDir?: THREE.Vector3, skyHorizon?: THREE.Color, skyZenith?: THREE.Color, nightMix?: number) => {
      waterUniforms.uTime.value += dt;
      if (liveSunDir) waterUniforms.uSunDir.value.copy(liveSunDir).normalize();
      if (skyHorizon) waterUniforms.uSkyHorizon.value.copy(skyHorizon);
      if (skyZenith) waterUniforms.uSkyZenith.value.copy(skyZenith);
      if (nightMix !== undefined) waterUniforms.uNightMix.value = nightMix;
      normalMap.offset.x = (normalMap.offset.x + dt * 0.018) % 1;
      normalMap.offset.y = (normalMap.offset.y + dt * 0.011) % 1;
    },
  };
}
