struct PointLight {
  posAndRadius      : vec4<f32>, // xyz = world pos, w = radius
  colorAndIntensity : vec4<f32>, // rgb = color, w = intensity
};

struct FrameUniforms {
  viewProj        : mat4x4<f32>,
  invViewProj     : mat4x4<f32>,
  lightViewProj   : mat4x4<f32>,
  camPos          : vec4<f32>, // xyz = camPos, w = timeSec
  sunDir          : vec4<f32>, // xyz = sunDir, w = f32(pointLightCount)
  sunColor        : vec4<f32>,
  fogColor        : vec4<f32>, // rgb = fogColor, w = nightFactor
  weatherParams   : vec4<f32>, // x = rainIntensity, y = wetness, z = lightningFlash, w = unused
  pointLights     : array<PointLight, 24>,
};

struct SkinUniforms {
  model : mat4x4<f32>,
  tint  : vec4<f32>,
  bones : array<mat4x4<f32>, 96>,
};

@group(0) @binding(0) var<uniform> uFrame : FrameUniforms;

@group(1) @binding(0) var<uniform> uSkin : SkinUniforms;

@group(2) @binding(0) var albedoTex : texture_2d<f32>;
@group(2) @binding(1) var albedoSampler : sampler;

@group(3) @binding(0) var shadowMap : texture_depth_2d;
@group(3) @binding(1) var shadowSampler : sampler_comparison;

struct TerrainVSIn {
  @location(0) pos    : vec3<f32>,
  @location(1) normal : vec3<f32>,
  @location(2) color  : vec3<f32>,
  @location(3) uvKind : vec3<f32>, // uv.x, uv.y, surfaceKind
};

struct InstancedVSIn {
  @location(0) pos       : vec3<f32>,
  @location(1) normal    : vec3<f32>,
  @location(2) uv        : vec2<f32>,
  @location(3) vtxCol    : vec3<f32>,
  @location(4) instPos   : vec3<f32>,
  @location(5) instScale : vec3<f32>,
  @location(6) instQuat  : vec4<f32>, // (qx, qy, qz, qw)
  @location(7) instColEm : vec4<f32>, // rgb = tint, w = emissiveBoost
};

struct SkinnedVSIn {
  @location(0) pos     : vec3<f32>,
  @location(1) normal  : vec3<f32>,
  @location(2) uv      : vec2<f32>,
  @location(3) vtxCol  : vec3<f32>,
  @location(4) joints  : vec4<u32>,
  @location(5) weights : vec4<f32>,
};

struct VSOut {
  @builtin(position) clipPos : vec4<f32>,
  @location(0) worldPos      : vec3<f32>,
  @location(1) shadowPos     : vec3<f32>,
  @location(2) normal        : vec3<f32>,
  @location(3) color         : vec3<f32>,
  @location(4) uv            : vec2<f32>,
  @location(5) surfaceKind   : f32,
  @location(6) emissiveBoost : f32,
};

struct SkyVSOut {
  @builtin(position) clipPos : vec4<f32>,
  @location(0) ndc           : vec2<f32>,
};

fn rotateByQuat(v : vec3<f32>, q : vec4<f32>) -> vec3<f32> {
  let u = q.xyz;
  let s = q.w;
  return 2.0 * dot(u, v) * u + (s * s - dot(u, u)) * v + 2.0 * s * cross(u, v);
}

fn computeShadowPos(worldPos : vec3<f32>) -> vec3<f32> {
  let lp = uFrame.lightViewProj * vec4<f32>(worldPos, 1.0);
  let ndc = lp.xyz / max(lp.w, 0.0001);
  return vec3<f32>(ndc.x * 0.5 + 0.5, -ndc.y * 0.5 + 0.5, ndc.z);
}

fn skinMatrix(joints : vec4<u32>, weights : vec4<f32>) -> mat4x4<f32> {
  let j0 = min(joints.x, 95u);
  let j1 = min(joints.y, 95u);
  let j2 = min(joints.z, 95u);
  let j3 = min(joints.w, 95u);
  return uSkin.bones[j0] * weights.x +
         uSkin.bones[j1] * weights.y +
         uSkin.bones[j2] * weights.z +
         uSkin.bones[j3] * weights.w;
}

fn acesTonemap(x : vec3<f32>) -> vec3<f32> {
  let a = 2.51;
  let b = 0.03;
  let c = 2.43;
  let d = 0.59;
  let e = 0.14;
  return clamp((x * (a * x + b)) / (x * (c * x + d) + e), vec3<f32>(0.0), vec3<f32>(1.0));
}

// ---------------------------------------------------------------------------
// Procedural Atmospheric Sky Dome + Sun Disc + Moon + Starfield
// ---------------------------------------------------------------------------
@vertex
fn vsSky(@builtin(vertex_index) vid : u32) -> SkyVSOut {
  var pos = array<vec2<f32>, 3>(
    vec2<f32>(-1.0, -1.0),
    vec2<f32>( 3.0, -1.0),
    vec2<f32>(-1.0,  3.0)
  );
  var out : SkyVSOut;
  let p = pos[vid];
  out.clipPos = vec4<f32>(p, 0.9999, 1.0);
  out.ndc = p;
  return out;
}

@fragment
fn fsSky(in : SkyVSOut) -> @location(0) vec4<f32> {
  let farWorld = uFrame.invViewProj * vec4<f32>(in.ndc, 1.0, 1.0);
  let rayDir = normalize(farWorld.xyz / farWorld.w - uFrame.camPos.xyz);
  let L = normalize(uFrame.sunDir.xyz);
  let nightFactor = clamp(uFrame.fogColor.w, 0.0, 1.0);
  let tSec = uFrame.camPos.w;

  let upness = clamp(rayDir.y, 0.0, 1.0);
  let zenithDay = vec3<f32>(0.16, 0.42, 0.82);
  let zenithNight = vec3<f32>(0.02, 0.03, 0.08);
  let zenith = mix(zenithDay, zenithNight, nightFactor);
  let horizon = uFrame.fogColor.rgb;

  var sky = mix(horizon, zenith, pow(upness, 0.55));

  // Sun / Moon disc & Mie atmospheric halo
  let sunCos = max(dot(rayDir, L), 0.0);
  let halo = pow(sunCos, 16.0) * (0.45 - 0.30 * nightFactor);
  let disc = smoothstep(0.9992, 0.9997, sunCos) * (1.0 - 0.65 * nightFactor);
  sky += uFrame.sunColor.rgb * (halo + disc * 3.2);

  // Subtle starfield at dusk/night
  if (nightFactor > 0.15 && rayDir.y > 0.04) {
    let cell = floor(rayDir * 240.0);
    let h = fract(sin(dot(cell, vec3<f32>(12.9898, 78.233, 37.719))) * 43758.5453);
    if (h > 0.993) {
      let twinkle = 0.65 + 0.35 * sin(tSec * 2.8 + h * 120.0);
      sky += vec3<f32>(0.85, 0.90, 1.0) * (nightFactor * twinkle * smoothstep(0.04, 0.25, rayDir.y));
    }
  }

  let mapped = acesTonemap(sky);
  let gamma = pow(mapped, vec3<f32>(1.0 / 2.2));
  return vec4<f32>(gamma, 1.0);
}

// ---------------------------------------------------------------------------
// Shadow Depth Vertex Shaders
// ---------------------------------------------------------------------------
@vertex
fn vsShadowTerrain(in : TerrainVSIn) -> @builtin(position) vec4<f32> {
  return uFrame.lightViewProj * vec4<f32>(in.pos, 1.0);
}

@vertex
fn vsShadowInstanced(in : InstancedVSIn) -> @builtin(position) vec4<f32> {
  let scaled = in.pos * in.instScale;
  let worldPos = rotateByQuat(scaled, in.instQuat) + in.instPos;
  return uFrame.lightViewProj * vec4<f32>(worldPos, 1.0);
}

@vertex
fn vsShadowSkinned(in : SkinnedVSIn) -> @builtin(position) vec4<f32> {
  let sm = skinMatrix(in.joints, in.weights);
  let localPos = (sm * vec4<f32>(in.pos, 1.0)).xyz;
  let worldPos = (uSkin.model * vec4<f32>(localPos, 1.0)).xyz;
  return uFrame.lightViewProj * vec4<f32>(worldPos, 1.0);
}

// ---------------------------------------------------------------------------
// Main Forward Pass Vertex Shaders
// ---------------------------------------------------------------------------
@vertex
fn vsTerrain(in : TerrainVSIn) -> VSOut {
  var pos = in.pos;
  let tSec = uFrame.camPos.w;
  if (in.uvKind.z > 0.5 && in.uvKind.z < 1.5) {
    let w1 = sin(pos.x * 0.14 + tSec * 1.55) * cos(pos.z * 0.13 - tSec * 1.05);
    let w2 = sin(pos.x * 0.31 - tSec * 2.05 + pos.z * 0.27);
    pos.y += (w1 * 0.16 + w2 * 0.08);
  }
  var out : VSOut;
  out.clipPos = uFrame.viewProj * vec4<f32>(pos, 1.0);
  out.worldPos = pos;
  out.shadowPos = computeShadowPos(pos);
  out.normal = normalize(in.normal);
  out.color = in.color;
  out.uv = in.uvKind.xy;
  out.surfaceKind = in.uvKind.z;
  out.emissiveBoost = 0.0;
  return out;
}

@vertex
fn vsInstanced(in : InstancedVSIn) -> VSOut {
  let scaled = in.pos * in.instScale;
  let worldPos = rotateByQuat(scaled, in.instQuat) + in.instPos;
  let rotNorm = normalize(rotateByQuat(in.normal, in.instQuat));

  var out : VSOut;
  out.clipPos = uFrame.viewProj * vec4<f32>(worldPos, 1.0);
  out.worldPos = worldPos;
  out.shadowPos = computeShadowPos(worldPos);
  out.normal = rotNorm;
  out.color = in.vtxCol * in.instColEm.rgb;
  out.uv = in.uv;
  out.surfaceKind = 4.0;
  out.emissiveBoost = in.instColEm.w;
  return out;
}

@vertex
fn vsSkinned(in : SkinnedVSIn) -> VSOut {
  let sm = skinMatrix(in.joints, in.weights);
  let m = uSkin.model * sm;
  let worldPos = (m * vec4<f32>(in.pos, 1.0)).xyz;
  let nMat = mat3x3<f32>(m[0].xyz, m[1].xyz, m[2].xyz);
  let worldNorm = normalize(nMat * in.normal);

  var out : VSOut;
  out.clipPos = uFrame.viewProj * vec4<f32>(worldPos, 1.0);
  out.worldPos = worldPos;
  out.shadowPos = computeShadowPos(worldPos);
  out.normal = worldNorm;
  out.color = in.vtxCol * uSkin.tint.rgb;
  out.uv = in.uv;
  out.surfaceKind = select(5.0, 6.0, uSkin.tint.a > 1.5);
  out.emissiveBoost = 0.0;
  return out;
}

// ---------------------------------------------------------------------------
// 3x3 PCF Shadows & Multi-Light ACES PBR Shading
// ---------------------------------------------------------------------------
fn sampleShadowPCF(shadowPos : vec3<f32>, ndotl : f32) -> f32 {
  let inBounds = shadowPos.x > 0.002 && shadowPos.x < 0.998 &&
                 shadowPos.y > 0.002 && shadowPos.y < 0.998 &&
                 shadowPos.z > 0.0 && shadowPos.z < 1.0;
  let uv = clamp(shadowPos.xy, vec2<f32>(0.0), vec2<f32>(1.0));
  let bias = max(0.0008, 0.0028 * (1.0 - ndotl));
  let depthRef = shadowPos.z - bias;
  let texel = 1.0 / 2048.0;

  var acc = 0.0;
  for (var dy : i32 = -1; dy <= 1; dy = dy + 1) {
    for (var dx : i32 = -1; dx <= 1; dx = dx + 1) {
      let off = vec2<f32>(f32(dx), f32(dy)) * texel;
      acc += textureSampleCompareLevel(shadowMap, shadowSampler, uv + off, depthRef);
    }
  }
  let pcf = acc / 9.0;
  return select(1.0, pcf, inBounds);
}

@fragment
fn fsMain(in : VSOut) -> @location(0) vec4<f32> {
  // Always sample texture in uniform control flow for WGSL validation compliance
  let texColor = textureSample(albedoTex, albedoSampler, in.uv);

  var N = normalize(in.normal);
  let L = normalize(uFrame.sunDir.xyz);
  let V = normalize(uFrame.camPos.xyz - in.worldPos);
  let tSec = uFrame.camPos.w;

  var albedo = in.color;
  var specPower = 32.0;
  var specStrength = 0.16;
  var emissive = in.color * in.emissiveBoost;
  let nightFactor = clamp(uFrame.fogColor.w, 0.0, 1.0);
  let wetness = clamp(uFrame.weatherParams.y, 0.0, 1.0);

  if (in.surfaceKind > 5.5) {
    // Matte fibrous hair (zero plastic specular glare)
    albedo = in.color * texColor.rgb;
    specPower = 6.0;
    specStrength = 0.025;
  } else if (in.surfaceKind > 4.5) {
    // Textured skinned character
    albedo = in.color * texColor.rgb;
    specPower = 24.0 + wetness * 28.0;
    specStrength = 0.22 + wetness * 0.18;
  } else if (in.surfaceKind > 3.5) {
    // Instanced buildings & GLB props: window facade grid ONLY on architectural box faces (uv < -0.5)
    if (abs(N.y) < 0.35 && in.worldPos.y > 4.5 && in.uv.x < -0.5) {
      let cellX = floor(in.worldPos.x * 0.28 + in.worldPos.z * 0.28);
      let cellY = floor(in.worldPos.y * 0.26);
      let gridX = fract(in.worldPos.x * 0.28 + in.worldPos.z * 0.28);
      let gridY = fract(in.worldPos.y * 0.26);
      if (gridX > 0.16 && gridX < 0.84 && gridY > 0.22 && gridY < 0.82) {
        albedo = mix(albedo, vec3<f32>(0.10, 0.20, 0.30), 0.68);
        specPower = 72.0;
        specStrength = 0.52;
        let winHash = fract(sin(dot(vec2<f32>(cellX, cellY), vec2<f32>(12.9898, 78.233))) * 43758.5453);
        if (winHash > 0.52 && nightFactor > 0.05) {
          let warm = mix(vec3<f32>(0.45, 0.78, 0.96), vec3<f32>(1.0, 0.78, 0.40), step(0.68, winHash));
          emissive += warm * (nightFactor * 0.92);
        }
      }
    } else if (wetness > 0.05) {
      specPower = mix(28.0, 76.0, wetness);
      specStrength = mix(0.18, 0.48, wetness);
    }
  } else if (in.surfaceKind > 2.5 && in.surfaceKind < 3.5) {
    // Sidewalks, bridge steel, concrete plazas & walk-in interior masonry (tiled micro-concrete)
    let tile = fract(in.worldPos.x * 0.5) * fract(in.worldPos.z * 0.5);
    let slabSeam = step(0.03, fract(in.worldPos.x * 0.35)) * step(0.03, fract(in.worldPos.z * 0.35));
    albedo = albedo * (0.90 + 0.08 * tile) * mix(0.82, 1.0, slabSeam);
    specPower = mix(18.0, 64.0, wetness);
    specStrength = mix(0.08, 0.36, wetness);
  } else if (in.surfaceKind > 1.5 && in.surfaceKind < 2.5) {
    // Asphalt road ribbons with double yellow center line, white shoulder lines & wet-puddle reflections
    let roadU = in.uv.x;
    let roadDist = in.uv.y;
    let grain = fract(sin(dot(floor(in.worldPos.xz * 3.5), vec2<f32>(12.9898, 78.233))) * 43758.5453);
    albedo = albedo * (0.93 + 0.14 * grain) * mix(1.0, 0.56, wetness);
    if (abs(roadU - 0.5) > 0.012 && abs(roadU - 0.5) < 0.032) {
      albedo = vec3<f32>(0.88, 0.68, 0.14);
    } else if (roadU < 0.045 || roadU > 0.955) {
      albedo = vec3<f32>(0.84, 0.86, 0.88);
    } else if (abs(roadU - 0.25) < 0.012 || abs(roadU - 0.75) < 0.012) {
      if (fract(roadDist * 0.12) < 0.42) {
        albedo = vec3<f32>(0.82, 0.84, 0.86);
      }
    }
    let puddle = smoothstep(0.35, 0.80, sin(in.worldPos.x * 0.18) * cos(in.worldPos.z * 0.19) * 0.5 + 0.5) * wetness;
    let roadFresnel = pow(1.0 - max(dot(N, V), 0.0), 4.0);
    albedo = mix(albedo, uFrame.fogColor.rgb * 0.65, puddle * roadFresnel * 0.65);
    specPower = mix(22.0, 110.0, wetness);
    specStrength = mix(0.12, 0.78, puddle);
  } else if (in.surfaceKind > 0.5 && in.surfaceKind < 1.5) {
    // Ocean water ripples + Fresnel sky reflection
    let w1 = sin(in.worldPos.x * 0.18 + tSec * 1.6) * cos(in.worldPos.z * 0.15 - tSec * 1.1);
    let w2 = sin(in.worldPos.x * 0.42 - tSec * 2.1 + in.worldPos.z * 0.37);
    N = normalize(vec3<f32>((w1 + w2 * 0.5) * 0.09, 1.0, (w2 - w1 * 0.5) * 0.09));
    let fresnel = pow(1.0 - max(dot(N, V), 0.0), 4.0);
    albedo = mix(vec3<f32>(0.04, 0.18, 0.29), vec3<f32>(0.36, 0.58, 0.76), fresnel * 0.78);
    specPower = 96.0;
    specStrength = 0.78;
  } else if (in.surfaceKind < 0.5) {
    // Multi-band procedural terrain micro-detail (sand ripples, grass blades, rock strata)
    let microA = sin(in.worldPos.x * 0.45) * cos(in.worldPos.z * 0.45) * 0.045;
    let microB = sin(in.worldPos.x * 1.9 + in.worldPos.z * 1.4) * 0.025;
    let strata = sin(in.worldPos.y * 1.6 + in.worldPos.x * 0.08) * 0.05 * (1.0 - smoothstep(0.70, 0.92, N.y));
    albedo = clamp(albedo + vec3<f32>(microA + microB + strata), vec3<f32>(0.02), vec3<f32>(1.0));
    albedo *= mix(1.0, 0.76, wetness * 0.6);
    specPower = mix(12.0, 48.0, wetness);
    specStrength = mix(0.04, 0.28, wetness);
  }

  let ndotl = max(dot(N, L), 0.0);
  let shadow = sampleShadowPCF(in.shadowPos, ndotl);
  let H = normalize(L + V);
  let hemi = 0.5 + 0.5 * N.y;
  let dayAmb = mix(vec3<f32>(0.22, 0.21, 0.20), vec3<f32>(0.42, 0.58, 0.78), hemi) * 0.62;
  let nightAmb = mix(vec3<f32>(0.05, 0.07, 0.12), vec3<f32>(0.12, 0.16, 0.26), hemi) * 0.55;
  let skyAmbient = mix(dayAmb, nightAmb, nightFactor);
  let spec = pow(max(dot(N, H), 0.0), specPower) * specStrength * shadow;

  var lit = albedo * (skyAmbient + uFrame.sunColor.rgb * ndotl * shadow) + uFrame.sunColor.rgb * spec + emissive;

  // Dynamic local point lights (Iron Pit braziers, floodlights, muzzle flash, siren strobes, streetlamps)
  let lightCount = min(u32(max(uFrame.sunDir.w, 0.0)), 24u);
  for (var li : u32 = 0u; li < lightCount; li = li + 1u) {
    let pl = uFrame.pointLights[li];
    let toLight = pl.posAndRadius.xyz - in.worldPos;
    let distSq = dot(toLight, toLight);
    let radius = max(pl.posAndRadius.w, 0.1);
    if (distSq < radius * radius) {
      let d = sqrt(distSq);
      let win = clamp(1.0 - d / radius, 0.0, 1.0);
      let att = (win * win) / (1.0 + 0.08 * distSq);
      let pL = toLight / max(d, 0.001);
      let pNdotL = max(dot(N, pL), 0.0);
      let pH = normalize(pL + V);
      let pSpec = pow(max(dot(N, pH), 0.0), specPower) * specStrength * 0.8;
      lit += (albedo * pNdotL + vec3<f32>(pSpec)) * pl.colorAndIntensity.rgb * (pl.colorAndIntensity.w * att);
    }
  }

  // Atmospheric distance haze
  let dist = length(uFrame.camPos.xyz - in.worldPos);
  let fogFactor = 1.0 - exp(-dist * 0.00058);
  lit = mix(lit, uFrame.fogColor.rgb, clamp(fogFactor, 0.0, 0.90));

  let mapped = acesTonemap(lit);
  let gamma = pow(mapped, vec3<f32>(1.0 / 2.2));
  return vec4<f32>(gamma, 1.0);
}
