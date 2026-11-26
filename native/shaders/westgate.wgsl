struct FrameUniforms {
  viewProj      : mat4x4<f32>,
  lightViewProj : mat4x4<f32>,
  camPos        : vec4<f32>, // xyz = camPos, w = timeSec
  sunDir        : vec4<f32>,
  sunColor      : vec4<f32>,
  fogColor      : vec4<f32>,
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
  @location(6) instRotY  : f32,
  @location(7) instCol   : vec3<f32>,
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
};

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

// ---------------------------------------------------------------------------
// Shadow Depth Vertex Shaders
// ---------------------------------------------------------------------------
@vertex
fn vsShadowTerrain(in : TerrainVSIn) -> @builtin(position) vec4<f32> {
  return uFrame.lightViewProj * vec4<f32>(in.pos, 1.0);
}

@vertex
fn vsShadowInstanced(in : InstancedVSIn) -> @builtin(position) vec4<f32> {
  let c = cos(in.instRotY);
  let s = sin(in.instRotY);
  let scaled = in.pos * in.instScale;
  let worldPos = vec3<f32>(
    scaled.x * c + scaled.z * s,
    scaled.y,
    -scaled.x * s + scaled.z * c
  ) + in.instPos;
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
  var out : VSOut;
  out.clipPos = uFrame.viewProj * vec4<f32>(in.pos, 1.0);
  out.worldPos = in.pos;
  out.shadowPos = computeShadowPos(in.pos);
  out.normal = normalize(in.normal);
  out.color = in.color;
  out.uv = in.uvKind.xy;
  out.surfaceKind = in.uvKind.z;
  return out;
}

@vertex
fn vsInstanced(in : InstancedVSIn) -> VSOut {
  let c = cos(in.instRotY);
  let s = sin(in.instRotY);
  let scaled = in.pos * in.instScale;
  let rotPos = vec3<f32>(
    scaled.x * c + scaled.z * s,
    scaled.y,
    -scaled.x * s + scaled.z * c
  );
  let worldPos = rotPos + in.instPos;
  let rotNorm = normalize(vec3<f32>(
    in.normal.x * c + in.normal.z * s,
    in.normal.y,
    -in.normal.x * s + in.normal.z * c
  ));

  var out : VSOut;
  out.clipPos = uFrame.viewProj * vec4<f32>(worldPos, 1.0);
  out.worldPos = worldPos;
  out.shadowPos = computeShadowPos(worldPos);
  out.normal = rotNorm;
  out.color = in.vtxCol * in.instCol;
  out.uv = in.uv;
  out.surfaceKind = 4.0;
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
  out.surfaceKind = 5.0;
  return out;
}

// ---------------------------------------------------------------------------
// 3x3 PCF Shadows & ACES PBR Shading
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

fn acesTonemap(x : vec3<f32>) -> vec3<f32> {
  let a = 2.51;
  let b = 0.03;
  let c = 2.43;
  let d = 0.59;
  let e = 0.14;
  return clamp((x * (a * x + b)) / (x * (c * x + d) + e), vec3<f32>(0.0), vec3<f32>(1.0));
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

  if (in.surfaceKind > 4.5) {
    // Textured skinned character
    albedo = in.color * texColor.rgb;
    specPower = 24.0;
    specStrength = 0.22;
  } else if (in.surfaceKind > 3.5) {
    // Instanced buildings & GLB props: window facade grid ONLY on architectural box faces (uv < -0.5)
    if (abs(N.y) < 0.35 && in.worldPos.y > 4.5 && in.uv.x < -0.5) {
      let gridX = fract(in.worldPos.x * 0.28 + in.worldPos.z * 0.28);
      let gridY = fract(in.worldPos.y * 0.26);
      if (gridX > 0.16 && gridX < 0.84 && gridY > 0.22 && gridY < 0.82) {
        albedo = mix(albedo, vec3<f32>(0.12, 0.22, 0.32), 0.62);
        specPower = 64.0;
        specStrength = 0.45;
      }
    }
  } else if (in.surfaceKind > 1.5 && in.surfaceKind < 2.5) {
    // Asphalt road ribbons with double yellow center line & white shoulder lines
    let roadU = in.uv.x;
    let roadDist = in.uv.y;
    let grain = fract(sin(dot(floor(in.worldPos.xz * 3.0), vec2<f32>(12.9898, 78.233))) * 43758.5453);
    albedo = albedo * (0.94 + 0.12 * grain);
    if (abs(roadU - 0.5) > 0.012 && abs(roadU - 0.5) < 0.032) {
      albedo = vec3<f32>(0.88, 0.68, 0.14);
    } else if (roadU < 0.045 || roadU > 0.955) {
      albedo = vec3<f32>(0.84, 0.86, 0.88);
    } else if (abs(roadU - 0.25) < 0.012 || abs(roadU - 0.75) < 0.012) {
      if (fract(roadDist * 0.12) < 0.42) {
        albedo = vec3<f32>(0.82, 0.84, 0.86);
      }
    }
    specPower = 18.0;
    specStrength = 0.10;
  } else if (in.surfaceKind > 0.5 && in.surfaceKind < 1.5) {
    // Ocean water ripples + Fresnel sky reflection
    let w1 = sin(in.worldPos.x * 0.18 + tSec * 1.6) * cos(in.worldPos.z * 0.15 - tSec * 1.1);
    let w2 = sin(in.worldPos.x * 0.42 - tSec * 2.1 + in.worldPos.z * 0.37);
    N = normalize(vec3<f32>((w1 + w2 * 0.5) * 0.08, 1.0, (w2 - w1 * 0.5) * 0.08));
    let fresnel = pow(1.0 - max(dot(N, V), 0.0), 4.0);
    albedo = mix(vec3<f32>(0.04, 0.18, 0.29), vec3<f32>(0.36, 0.58, 0.76), fresnel * 0.75);
    specPower = 96.0;
    specStrength = 0.75;
  } else if (in.surfaceKind < 0.5) {
    // Terrain subtle micro-variation
    let micro = sin(in.worldPos.x * 0.35) * cos(in.worldPos.z * 0.35) * 0.04;
    albedo = clamp(albedo + vec3<f32>(micro), vec3<f32>(0.02), vec3<f32>(1.0));
    specPower = 12.0;
    specStrength = 0.04;
  }

  let ndotl = max(dot(N, L), 0.0);
  let shadow = sampleShadowPCF(in.shadowPos, ndotl);
  let H = normalize(L + V);
  let hemi = 0.5 + 0.5 * N.y;
  let skyAmbient = mix(vec3<f32>(0.22, 0.21, 0.20), vec3<f32>(0.42, 0.58, 0.78), hemi) * 0.62;
  let spec = pow(max(dot(N, H), 0.0), specPower) * specStrength * shadow;

  var lit = albedo * (skyAmbient + uFrame.sunColor.rgb * ndotl * shadow) + uFrame.sunColor.rgb * spec;

  // Atmospheric distance haze
  let dist = length(uFrame.camPos.xyz - in.worldPos);
  let fogFactor = 1.0 - exp(-dist * 0.00058);
  lit = mix(lit, uFrame.fogColor.rgb, clamp(fogFactor, 0.0, 0.90));

  let mapped = acesTonemap(lit);
  let gamma = pow(mapped, vec3<f32>(1.0 / 2.2));
  return vec4<f32>(gamma, 1.0);
}
