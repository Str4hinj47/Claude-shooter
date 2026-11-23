/* ------------------------------------------------------------------ */
/*  SHADERS — Post-processing grading + Volumetric light beams        */
/* ------------------------------------------------------------------ */
import * as THREE from "three";

/**
 * Custom cinematic post-processing shader pass:
 * - Subtle split-tone color grading (cool shadows, warm highlights)
 * - Filmic S-curve contrast boost
 * - Dynamic vignette + ADS edge focus + low-health damage pulse
 * - Fine dithering / micro film grain to eliminate night sky/fog banding
 */
export const CinematicPostShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uTime: { value: 0 },
    uNight: { value: 0 },       // 0 = day/dawn, 1 = night
    uAds: { value: 0 },         // 0..1 ADS focus vignette
    uDamage: { value: 0 },      // 0..1 low-HP crimson edge tint
    uGrain: { value: 0.011 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uTime;
    uniform float uNight;
    uniform float uAds;
    uniform float uDamage;
    uniform float uGrain;
    varying vec2 vUv;

    float hash12(vec2 p) {
      vec3 p3 = fract(vec3(p.xyx) * 0.1031);
      p3 += dot(p3, p3.yzx + 33.33);
      return fract((p3.x + p3.y) * p3.z);
    }

    void main() {
      vec2 uv = vUv;
      vec2 centered = uv - 0.5;
      float dist = length(centered);

      // Subtle chromatic aberration only near screen edge when taking damage or zooming
      float ca = (uAds * 0.0012 + uDamage * 0.0032) * smoothstep(0.18, 0.72, dist);
      vec2 dir = dist > 0.0001 ? centered / dist : vec2(0.0);
      float r = texture2D(tDiffuse, uv + dir * ca).r;
      float g = texture2D(tDiffuse, uv).g;
      float b = texture2D(tDiffuse, uv - dir * ca).b;
      vec3 col = vec3(r, g, b);

      // Luminance for split-toning
      float luma = dot(col, vec3(0.2126, 0.7152, 0.0722));

      // Split-tone grading: deep cool shadows + crisp warm highlights
      vec3 shadowTint = mix(vec3(0.95, 0.98, 1.05), vec3(0.84, 0.93, 1.12), uNight);
      vec3 highTint   = mix(vec3(1.04, 1.01, 0.96), vec3(1.06, 0.99, 0.90), uNight);
      float t = smoothstep(0.05, 0.75, luma);
      col *= mix(shadowTint, highTint, t);

      // Gentle contrast lift (preserves shadow detail while deepening blacks)
      col = max(col, vec3(0.0));
      col = mix(col, col * col * (3.0 - 2.0 * clamp(col, 0.0, 1.0)), 0.16);

      // Tactical vignette (stronger in ADS and night)
      float vigStart = mix(0.46, 0.32, uAds);
      float vigAmt = mix(0.28, 0.42, uNight) + uAds * 0.22;
      float vig = smoothstep(vigStart, 0.88, dist);
      col *= 1.0 - vig * vigAmt;

      // Low-health crimson edge pulse
      if (uDamage > 0.001) {
        float dmgMask = smoothstep(0.28, 0.78, dist) * uDamage;
        col = mix(col, vec3(0.75, 0.04, 0.04), dmgMask * 0.55);
      }

      // Micro film grain / dithering (prevents night sky & fog banding)
      float n = (hash12(uv * 1024.0 + fract(uTime * 17.3)) - 0.5) * uGrain;
      col += n;

      gl_FragColor = vec4(max(col, 0.0), 1.0);
    }
  `,
};

/**
 * Custom additive volumetric light-cone shader for guard flashlights and streetlights.
 * Assumes a unit-height open-ended cone/frustum oriented along -Y or +Z via geometry.
 * Here `vAlong` (0 at emitter, 1 at far end) drives smooth quadratic falloff,
 * while view-space Fresnel softens hard silhouette edges.
 */
export function createVolumetricBeamMaterial(
  colorHex: number,
  opacity = 0.22,
  falloffPower = 1.85,
): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color(colorHex) },
      uOpacity: { value: opacity },
      uFalloff: { value: falloffPower },
      uTime: { value: 0 },
    },
    vertexShader: /* glsl */ `
      varying vec3 vNormalView;
      varying vec3 vViewPos;
      varying float vAlong;
      void main() {
        // Expect cone/cylinder spanning y in [-0.5, +0.5], where +0.5 is emitter tip
        vAlong = clamp(0.5 - position.y, 0.0, 1.0);
        vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
        vViewPos = -mvPos.xyz;
        vNormalView = normalize(normalMatrix * normal);
        gl_Position = projectionMatrix * mvPos;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uOpacity;
      uniform float uFalloff;
      uniform float uTime;
      varying vec3 vNormalView;
      varying vec3 vViewPos;
      varying float vAlong;

      void main() {
        vec3 viewDir = normalize(vViewPos);
        // Smooth edge fade (0 at grazing silhouette, 1 facing camera)
        float edge = pow(abs(dot(normalize(vNormalView), viewDir)), 1.65);
        // Smooth tip & far-end attenuation
        float nearFade = smoothstep(0.0, 0.06, vAlong);
        float farFade = pow(1.0 - vAlong, uFalloff);
        // Subtle volumetric dust shimmer
        float shimmer = 0.92 + 0.08 * sin(vAlong * 18.0 - uTime * 2.2);
        float alpha = uOpacity * edge * nearFade * farFade * shimmer;
        gl_FragColor = vec4(uColor * (1.15 - vAlong * 0.35), clamp(alpha, 0.0, 0.65));
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
}

/**
 * Soft radial ground light-pool material for streetlights.
 */
export function createLightPoolMaterial(colorHex: number, opacity = 0.24): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color(colorHex) },
      uOpacity: { value: opacity },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uOpacity;
      varying vec2 vUv;
      void main() {
        float d = length(vUv - 0.5) * 2.0;
        float glow = pow(clamp(1.0 - d, 0.0, 1.0), 2.2);
        gl_FragColor = vec4(uColor, glow * uOpacity);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
}
