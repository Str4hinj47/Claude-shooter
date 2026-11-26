import * as THREE from "three";

export interface RealisticSkyState {
  zenith: THREE.ColorRepresentation;
  midSky: THREE.ColorRepresentation;
  horizon: THREE.ColorRepresentation;
  fogColor: THREE.ColorRepresentation;
  sunColor: THREE.ColorRepresentation;
  sunDir: THREE.Vector3;
  moonDir?: THREE.Vector3;
  nightMix?: number;
  sunsetMix?: number;
  cloudCover?: number;
  overcast?: number;
}

export interface RealisticSkyHandle {
  mesh: THREE.Mesh;
  material: THREE.ShaderMaterial;
  setState: (state: Partial<RealisticSkyState>) => void;
  update: (dt: number, focusPos?: THREE.Vector3) => void;
  dispose: () => void;
}

const VERTEX_SHADER = /* glsl */ `
  varying vec3 vWorldDir;
  void main() {
    vWorldDir = position;
    vec4 worldPos = vec4(cameraPosition + position * 100.0, 1.0);
    vec4 clip = projectionMatrix * viewMatrix * worldPos;
    gl_Position = vec4(clip.xy, clip.w * 0.99999, clip.w);
  }
`;

const FRAGMENT_SHADER = /* glsl */ `
  uniform vec3 uZenith;
  uniform vec3 uMidSky;
  uniform vec3 uHorizon;
  uniform vec3 uFogColor;
  uniform vec3 uSunColor;
  uniform vec3 uSunDir;
  uniform vec3 uMoonDir;
  uniform float uTime;
  uniform float uNightMix;
  uniform float uSunsetMix;
  uniform float uCloudCover;
  uniform float uOvercast;

  varying vec3 vWorldDir;

  float hash12(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
  }

  vec3 hash33(vec3 p3) {
    p3 = fract(p3 * vec3(0.1031, 0.1030, 0.0973));
    p3 += dot(p3, p3.yxz + 33.33);
    return fract((p3.xxy + p3.yxx) * p3.zyx);
  }

  float noise2(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(hash12(i), hash12(i + vec2(1.0, 0.0)), u.x),
      mix(hash12(i + vec2(0.0, 1.0)), hash12(i + vec2(1.0, 1.0)), u.x),
      u.y
    );
  }

  float fbm4(vec2 p) {
    float s = 0.0;
    float a = 0.5;
    mat2 rot = mat2(0.8, 0.6, -0.6, 0.8);
    for (int i = 0; i < 4; i++) {
      s += a * noise2(p);
      p = rot * p * 2.06 + vec2(13.7, 9.2);
      a *= 0.5;
    }
    return s;
  }

  float fbm3(vec2 p) {
    float s = 0.0;
    float a = 0.5;
    mat2 rot = mat2(0.8, 0.6, -0.6, 0.8);
    for (int i = 0; i < 3; i++) {
      s += a * noise2(p);
      p = rot * p * 2.08 + vec2(5.1, 11.3);
      a *= 0.5;
    }
    return s;
  }

  float cloudDensity(vec2 uv, float cover) {
    vec2 warp = vec2(
      fbm3(uv * 0.55 + vec2(uTime * 0.008, uTime * 0.003)),
      fbm3(uv * 0.55 + vec2(7.4 - uTime * 0.005, 3.1))
    );
    float base = fbm4(uv * 0.72 + warp * 0.72 + vec2(uTime * 0.011, uTime * 0.004));
    float detail = fbm3(uv * 2.15 - vec2(uTime * 0.018, 0.0));
    float d = base * 0.76 + detail * 0.24;
    float thresh = mix(0.57, 0.29, clamp(cover, 0.0, 1.0));
    return smoothstep(thresh, thresh + 0.16, d);
  }

  float starLayer(vec3 d, float scale, float threshold) {
    vec3 p = d * scale;
    vec3 id = floor(p);
    vec3 f = fract(p) - 0.5;
    vec3 rnd = hash33(id);
    if (rnd.x < threshold) return 0.0;
    vec3 off = (rnd - 0.5) * 0.62;
    float dist = length(f - off);
    float twinkle = 0.76 + 0.24 * sin(uTime * (1.8 + rnd.y * 2.6) + rnd.z * 40.0);
    float size = mix(0.06, 0.14, rnd.y);
    return smoothstep(size, 0.0, dist) * twinkle;
  }

  void main() {
    vec3 d = normalize(vWorldDir);
    float y = clamp(d.y, 0.0, 1.0);
    vec3 sunDir = normalize(uSunDir);
    vec3 moonDir = normalize(uMoonDir);

    // 1. Atmospheric Rayleigh + Horizon Optical Depth Sky Gradient
    float horizonCurve = smoothstep(0.0, 0.26, y);
    float zenithCurve = pow(y, 0.58);
    vec3 skyCol = mix(uHorizon, uMidSky, horizonCurve);
    skyCol = mix(skyCol, uZenith, smoothstep(0.14, 0.92, zenithCurve));

    // Directional twilight / Belt of Venus scattering when sun is low
    vec2 horizD = normalize(d.xz + vec2(1e-5));
    vec2 horizS = normalize(sunDir.xz + vec2(1e-5));
    float azimAlign = dot(horizD, horizS);
    float lowBand = exp(-y * 8.5);
    float solarWarmth = pow(max(0.0, azimAlign * 0.5 + 0.5), 2.4);
    skyCol += uSunColor * (uSunsetMix * 0.42 * lowBand * solarWarmth);
    // Subtle rose-violet anti-solar Belt of Venus near opposite horizon
    float antiSolar = pow(max(0.0, -azimAlign * 0.5 + 0.5), 2.0);
    skyCol += vec3(0.45, 0.22, 0.38) * (uSunsetMix * 0.18 * exp(-y * 11.0) * antiSolar);

    // 2. Solar Mie Aerosol Halo & Limb-Darkened Sun Disk (day/sunset/dawn)
    float sunDot = max(0.0, dot(d, sunDir));
    float dayVis = (1.0 - uNightMix * 0.95) * (1.0 - uOvercast * 0.78);
    float sunAbove = smoothstep(-0.06, 0.05, d.y);
    float mieBroad = pow(sunDot, 6.0) * 0.24 + pow(sunDot, 36.0) * 0.34;
    float mieCorona = pow(sunDot, 320.0) * 0.65;
    float sunDisk = smoothstep(0.99935, 0.99972, sunDot) * 1.55;
    skyCol += uSunColor * (mieBroad + mieCorona + sunDisk) * dayVis * sunAbove;

    // 3. Night Sky: Multi-Temperature Starfield, Milky Way Dust Band & Textured Moon
    if (uNightMix > 0.02 && d.y > -0.02) {
      float nightVis = uNightMix * (1.0 - uOvercast * 0.85) * smoothstep(0.0, 0.18, d.y);

      // Tilted Milky Way galactic band + dark dust rifts
      vec3 galAxis = normalize(vec3(0.42, 0.68, -0.59));
      float galDist = abs(dot(d, galAxis));
      float galBand = exp(-galDist * galDist * 11.5);
      vec2 galUv = vec2(dot(d, normalize(vec3(-0.6, 0.1, -0.8))), d.y * 2.2 + d.x * 1.4);
      float dustRift = fbm3(galUv * 3.8);
      float mw = galBand * smoothstep(0.28, 0.78, dustRift);
      skyCol += mix(vec3(0.09, 0.14, 0.26), vec3(0.22, 0.25, 0.36), mw) * mw * 0.52 * nightVis;

      // Crisp 2-tier starfield
      float s1 = starLayer(d, 210.0, 0.945);
      float s2 = starLayer(d, 430.0, 0.968);
      float temp = hash12(floor(d.xz * 210.0 + d.y * 130.0));
      vec3 starTint = mix(vec3(0.75, 0.86, 1.0), vec3(1.0, 0.91, 0.76), temp);
      skyCol += starTint * (s1 * 1.05 + s2 * 0.65) * nightVis;

      // Detailed Procedural Lunar Disk & Ice Halo
      float moonDot = dot(d, moonDir);
      float moonHalo = pow(max(0.0, moonDot), 10.0) * 0.08 + pow(max(0.0, moonDot), 140.0) * 0.26;
      skyCol += vec3(0.62, 0.76, 1.0) * moonHalo * nightVis;

      if (moonDot > 0.9988) {
        vec3 mUp = abs(moonDir.y) < 0.95 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0);
        vec3 mRight = normalize(cross(mUp, moonDir));
        vec3 mTop = cross(moonDir, mRight);
        vec2 mUv = vec2(dot(d, mRight), dot(d, mTop)) / 0.028;
        float r2 = dot(mUv, mUv);
        if (r2 < 1.0) {
          float limb = smoothstep(1.0, 0.82, r2);
          float mz = sqrt(max(0.0, 1.0 - r2));
          vec3 mNorm = normalize(mRight * mUv.x + mTop * mUv.y + moonDir * mz);
          float maria = fbm3(mUv * 2.8 + vec2(4.2, -1.7));
          float albedo = mix(0.62, 1.0, smoothstep(0.32, 0.66, maria));
          float phaseLight = smoothstep(-0.35, 0.75, dot(mNorm, normalize(vec3(0.65, 0.45, 0.6))));
          vec3 moonCol = vec3(0.90, 0.94, 1.0) * albedo * (0.18 + 0.92 * phaseLight) * 1.25;
          skyCol = mix(skyCol, moonCol, limb * nightVis);
        }
      }
    }

    // 4. Curved-Earth Multi-Layer Clouds (High Cirrus + Sun-Self-Shadowed Cumulus)
    if (d.y > 0.008) {
      float horizFade = smoothstep(0.008, 0.14, d.y);

      // High-altitude wispy cirrus layer
      float tCirrus = (sqrt(22.0 * 22.0 * y * y + 2.0 * 22.0 * 2.2 + 4.84) - 22.0 * y);
      vec2 cirrusUv = d.xz * tCirrus * 0.24;
      vec2 streakUv = vec2(cirrusUv.x * 0.45 + cirrusUv.y * 0.25, cirrusUv.y * 1.85 - cirrusUv.x * 0.35) + vec2(uTime * 0.004, 0.0);
      float cirrus = smoothstep(0.54, 0.86, fbm4(streakUv)) * horizFade * (1.0 - uOvercast * 0.65);
      vec3 cirrusDay = mix(vec3(0.95, 0.97, 1.0), uSunColor * 1.08, 0.32 + uSunsetMix * 0.55);
      vec3 cirrusCol = mix(cirrusDay, vec3(0.18, 0.24, 0.38), uNightMix * 0.92);
      skyCol = mix(skyCol, cirrusCol, cirrus * 0.34);

      // Lower billowing cumulus layer with directional sun self-shadowing
      float R = 18.0;
      float H = 1.0;
      float tCumulus = sqrt(R * R * y * y + 2.0 * R * H + H * H) - R * y;
      vec2 cuv = d.xz * tCumulus * 0.58;
      float cover = mix(uCloudCover, 0.88, uOvercast);
      float dens = cloudDensity(cuv, cover);
      if (dens > 0.005) {
        vec2 sunStep = normalize(sunDir.xz + vec2(1e-4)) * 0.38;
        float shadowDens = cloudDensity(cuv + sunStep, cover);
        float lit = exp(-shadowDens * 2.1);
        float powder = 1.0 - exp(-dens * 2.8);
        float hg = pow(sunDot, 8.0) * (1.0 - uNightMix * 0.85) * (1.0 - uOvercast * 0.7);

        vec3 dayLit = mix(vec3(1.0, 0.99, 0.98), uSunColor * 1.15, 0.30 + uSunsetMix * 0.58);
        vec3 dayAmb = mix(uMidSky * 0.64 + vec3(0.22), vec3(0.26, 0.21, 0.30), uSunsetMix);
        vec3 stormCol = uFogColor * 0.82;
        vec3 nightCloudLit = vec3(0.24, 0.30, 0.44);
        vec3 nightCloudAmb = vec3(0.06, 0.09, 0.16);

        vec3 litCol = mix(dayLit, nightCloudLit, uNightMix);
        vec3 ambCol = mix(dayAmb, nightCloudAmb, uNightMix);
        litCol = mix(litCol, stormCol * 1.06, uOvercast * 0.88);
        ambCol = mix(ambCol, stormCol * 0.66, uOvercast * 0.88);

        vec3 cloudCol = mix(ambCol, litCol, clamp(lit * (0.42 + 0.68 * powder), 0.0, 1.0));
        // Golden/silver lining around backlit cloud rims
        cloudCol += uSunColor * (hg * (1.0 - dens * 0.52) * 0.75);

        float alpha = dens * horizFade * mix(0.90, 0.97, uOvercast);
        skyCol = mix(skyCol, cloudCol, alpha);
      }
    }

    // 5. Seamless Atmospheric Horizon-to-Fog Blend
    vec3 horizFog = mix(uHorizon, uFogColor, 0.55 + uOvercast * 0.42);
    float fogBand = smoothstep(0.11, -0.04, d.y);
    skyCol = mix(skyCol, horizFog, fogBand);

    gl_FragColor = vec4(skyCol, 1.0);
  }
`;

export function createRealisticSky(initial: RealisticSkyState): RealisticSkyHandle {
  const geo = new THREE.SphereGeometry(1, 48, 28);
  const material = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: true,
    fog: false,
    uniforms: {
      uZenith: { value: new THREE.Color(initial.zenith) },
      uMidSky: { value: new THREE.Color(initial.midSky) },
      uHorizon: { value: new THREE.Color(initial.horizon) },
      uFogColor: { value: new THREE.Color(initial.fogColor) },
      uSunColor: { value: new THREE.Color(initial.sunColor) },
      uSunDir: { value: initial.sunDir.clone().normalize() },
      uMoonDir: { value: (initial.moonDir ?? initial.sunDir).clone().normalize() },
      uTime: { value: 0 },
      uNightMix: { value: initial.nightMix ?? 0 },
      uSunsetMix: { value: initial.sunsetMix ?? 0 },
      uCloudCover: { value: initial.cloudCover ?? 0.44 },
      uOvercast: { value: initial.overcast ?? 0 },
    },
    vertexShader: VERTEX_SHADER,
    fragmentShader: FRAGMENT_SHADER,
  });

  const mesh = new THREE.Mesh(geo, material);
  mesh.frustumCulled = false;
  mesh.renderOrder = -1000;

  const setState = (state: Partial<RealisticSkyState>) => {
    const u = material.uniforms;
    if (state.zenith !== undefined) u.uZenith.value.set(state.zenith);
    if (state.midSky !== undefined) u.uMidSky.value.set(state.midSky);
    if (state.horizon !== undefined) u.uHorizon.value.set(state.horizon);
    if (state.fogColor !== undefined) u.uFogColor.value.set(state.fogColor);
    if (state.sunColor !== undefined) u.uSunColor.value.set(state.sunColor);
    if (state.sunDir !== undefined) u.uSunDir.value.copy(state.sunDir).normalize();
    if (state.moonDir !== undefined) u.uMoonDir.value.copy(state.moonDir).normalize();
    if (state.nightMix !== undefined) u.uNightMix.value = state.nightMix;
    if (state.sunsetMix !== undefined) u.uSunsetMix.value = state.sunsetMix;
    if (state.cloudCover !== undefined) u.uCloudCover.value = state.cloudCover;
    if (state.overcast !== undefined) u.uOvercast.value = state.overcast;
  };

  const update = (dt: number, _focusPos?: THREE.Vector3) => {
    material.uniforms.uTime.value += dt;
  };

  return {
    mesh,
    material,
    setState,
    update,
    dispose: () => {
      geo.dispose();
      material.dispose();
    },
  };
}
