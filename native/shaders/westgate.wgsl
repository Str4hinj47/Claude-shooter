struct PointLight {
  posAndRadius      : vec4<f32>, // xyz = world pos, w = radius
  colorAndIntensity : vec4<f32>, // rgb = color, w = intensity
};

struct FrameUniforms {
  viewProj          : mat4x4<f32>,
  invViewProj       : mat4x4<f32>,
  lightViewProjNear : mat4x4<f32>,
  lightViewProjFar  : mat4x4<f32>,
  camPos            : vec4<f32>, // xyz = camPos, w = timeSec
  sunDir            : vec4<f32>, // xyz = sunDir, w = f32(pointLightCount)
  sunColor          : vec4<f32>,
  fogColor          : vec4<f32>, // rgb = fogColor, w = nightFactor
  weatherParams     : vec4<f32>, // x = rainIntensity, y = wetness, z = lightningFlash, w = nearShadowRadius
  pointLights       : array<PointLight, 24>,
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
@group(2) @binding(2) var normalTex : texture_2d<f32>;
@group(2) @binding(3) var mrTex : texture_2d<f32>;
@group(2) @binding(4) var emissiveTex : texture_2d<f32>;

@group(3) @binding(0) var shadowMap : texture_depth_2d_array;
@group(3) @binding(1) var shadowSampler : sampler_comparison;

struct TerrainVSIn {
  @location(0) pos    : vec3<f32>,
  @location(1) normal : vec3<f32>,
  @location(2) color  : vec3<f32>,
  @location(3) uvKind : vec3<f32>, // uv.x, uv.y, surfaceKind
};

// Matches PackedWorldVertex (28 bytes) directly in VRAM
struct CustomMeshVSIn {
  @location(0) pos      : vec3<f32>,
  @location(1) normFam  : vec4<i32>, // xyz = snorm int8 normal (-127..127), w = surfaceFamilyId (0..9)
  @location(2) uv16     : vec2<i32>, // metric/tiled UV * 256
  @location(3) color    : vec4<f32>, // unorm8x4 RGBA
  @location(4) matFlags : vec4<f32>, // unorm8x4: x=rough, y=metal, z=emissive, w=flags
};

// PackedWorldVertex + InstanceAttrib (for PropBatcher streetlights, traffic lights, hydrants)
struct CustomInstVSIn {
  @location(0) pos          : vec3<f32>,
  @location(1) normFam     : vec4<i32>,
  @location(2) uv16        : vec2<i32>,
  @location(3) color       : vec4<f32>,
  @location(4) matFlags    : vec4<f32>,
  @location(5) instPos     : vec3<f32>,
  @location(6) instScale   : vec3<f32>,
  @location(7) instQuat    : vec4<f32>,
  @location(8) instColEm   : vec4<f32>,
  @location(9) instMatOvrd : vec2<f32>,
};

struct InstancedVSIn {
  @location(0) pos         : vec3<f32>,
  @location(1) normal      : vec3<f32>,
  @location(2) uv          : vec2<f32>,
  @location(3) vtxCol      : vec3<f32>,
  @location(4) instPos     : vec3<f32>,
  @location(5) instScale   : vec3<f32>,
  @location(6) instQuat    : vec4<f32>, // (qx, qy, qz, qw)
  @location(7) instColEm   : vec4<f32>, // rgb = tint, w = emissiveBoost
  @location(8) pbrParams   : vec2<f32>, // x = metallic, y = roughness (vertex)
  @location(9) instMatOvrd : vec2<f32>, // x = overrideRoughness (<0 = use vertex), y = family + metallic*0.5
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
  @location(1) shadowPosNear : vec3<f32>,
  @location(2) shadowPosFar  : vec3<f32>,
  @location(3) normal        : vec3<f32>,
  @location(4) color         : vec3<f32>,
  @location(5) uv            : vec2<f32>,
  @location(6) surfaceKind   : f32,
  @location(7) emissiveBoost : f32,
  @location(8) pbrParams     : vec2<f32>, // x = metallic, y = roughness
};

struct SkyVSOut {
  @builtin(position) clipPos : vec4<f32>,
  @location(0) ndc           : vec2<f32>,
};

const PI : f32 = 3.14159265;

fn rotateByQuat(v : vec3<f32>, q : vec4<f32>) -> vec3<f32> {
  let u = q.xyz;
  let s = q.w;
  return 2.0 * dot(u, v) * u + (s * s - dot(u, u)) * v + 2.0 * s * cross(u, v);
}

fn computeShadowCoord(mat : mat4x4<f32>, worldPos : vec3<f32>) -> vec3<f32> {
  let lp = mat * vec4<f32>(worldPos, 1.0);
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

fn hash21(p : vec2<f32>) -> f32 {
  return fract(sin(dot(p, vec2<f32>(127.1, 311.7))) * 43758.5453);
}

fn noise2D(p : vec2<f32>) -> f32 {
  let i = floor(p);
  let f = fract(p);
  let u = f * f * (3.0 - 2.0 * f);
  let a = hash21(i);
  let b = hash21(i + vec2<f32>(1.0, 0.0));
  let c = hash21(i + vec2<f32>(0.0, 1.0));
  let d = hash21(i + vec2<f32>(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

fn fbmClouds(p : vec2<f32>) -> f32 {
  var v = 0.0;
  var a = 0.5;
  var pos = p;
  for (var i = 0; i < 4; i = i + 1) {
    v += a * noise2D(pos);
    pos = pos * 2.07 + vec2<f32>(13.7, 9.2);
    a *= 0.5;
  }
  return v;
}

fn srgbToLinear(c : vec3<f32>) -> vec3<f32> {
  return pow(max(c, vec3<f32>(0.0)), vec3<f32>(2.2));
}

// ---------------------------------------------------------------------------
// Procedural Atmospheric Sky Dome + Volumetric-Style FBM Clouds + Sun/Moon/Stars
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
  let rain = clamp(uFrame.weatherParams.x, 0.0, 1.0);
  let lightning = clamp(uFrame.weatherParams.z, 0.0, 1.0);

  let fogLin = srgbToLinear(uFrame.fogColor.rgb);
  let sunLin = srgbToLinear(uFrame.sunColor.rgb);

  let upness = clamp(rayDir.y, 0.0, 1.0);
  let goldenGlow = clamp(1.0 - abs(L.y - 0.08) / 0.28, 0.0, 1.0) * (1.0 - rain * 0.75);
  let deepNight = smoothstep(0.56, 0.92, nightFactor);
  let zenithDay = vec3<f32>(0.028, 0.145, 0.72);
  let zenithSunset = vec3<f32>(0.052, 0.088, 0.30);
  let zenithNight = vec3<f32>(0.002, 0.004, 0.016);
  let zenith = mix(mix(zenithDay, zenithSunset, goldenGlow * 0.78), zenithNight, deepNight);

  var sky = mix(fogLin, zenith, pow(upness, 0.52));

  let rayHoriz = normalize(vec3<f32>(rayDir.x, 0.0001, rayDir.z));
  let sunHoriz = normalize(vec3<f32>(L.x, 0.0001, L.z));
  let azimGlow = pow(clamp(dot(rayHoriz, sunHoriz) * 0.5 + 0.5, 0.0, 1.0), 1.8);
  let bandGlow = pow(clamp(1.0 - upness * 2.1, 0.0, 1.0), 2.0);
  sky += vec3<f32>(0.92, 0.30, 0.065) * (goldenGlow * azimGlow * bandGlow * 0.72);

  let sunCos = max(dot(rayDir, L), 0.0);
  let halo = pow(sunCos, 14.0) * (0.48 - 0.34 * deepNight) * (1.0 - rain * 0.65);
  let disc = smoothstep(0.9992, 0.9997, sunCos) * (1.0 - 0.75 * deepNight) * (1.0 - rain * 0.85);
  sky += sunLin * (halo + disc * 5.0);

  if (deepNight > 0.22 && rayDir.y > 0.04 && rain < 0.75) {
    let cell = floor(rayDir * 260.0);
    let h = fract(sin(dot(cell, vec3<f32>(12.9898, 78.233, 37.719))) * 43758.5453);
    if (h > 0.9935) {
      let twinkle = 0.65 + 0.35 * sin(tSec * 2.8 + h * 120.0);
      sky += vec3<f32>(0.75, 0.86, 1.10) * (deepNight * (1.0 - rain * 0.8) * twinkle * smoothstep(0.04, 0.25, rayDir.y));
    }
  }

  if (rayDir.y > 0.02) {
    let planeUV = rayDir.xz / (rayDir.y + 0.16);
    let driftA = vec2<f32>(tSec * 0.018, tSec * 0.009);
    let driftB = vec2<f32>(tSec * 0.031, -tSec * 0.012);
    let n1 = fbmClouds(planeUV * 1.15 + driftA);
    let n2 = fbmClouds(planeUV * 2.35 + driftB);
    let cloudDensity = n1 * 0.68 + n2 * 0.32;
    let coverage = mix(0.56, 0.26, clamp(rain + uFrame.weatherParams.y * 0.45, 0.0, 1.0));
    let alpha = smoothstep(coverage, coverage + 0.28, cloudDensity) * smoothstep(0.02, 0.18, rayDir.y);

    let cloudLit = mix(vec3<f32>(0.92, 0.89, 0.85), vec3<f32>(0.06, 0.08, 0.12), rain * 0.85) *
                   mix(1.0, 0.08, nightFactor) +
                   vec3<f32>(0.90, 1.05, 1.45) * (lightning * 1.8 * (1.0 - n2 * 0.5));
    let cloudDark = mix(vec3<f32>(0.16, 0.21, 0.30), vec3<f32>(0.015, 0.020, 0.030), max(rain, nightFactor));
    let sunScatter = pow(sunCos, 6.0) * (1.0 - rain * 0.6) * 0.55;
    let cloudCol = mix(cloudDark, cloudLit, clamp(0.45 + 0.55 * n1, 0.0, 1.0)) + sunLin * sunScatter;
    sky = mix(sky, cloudCol, alpha * mix(0.75, 0.94, rain));
  }

  return vec4<f32>(sky, 1.0);
}

// ---------------------------------------------------------------------------
// 2-Cascade Shadow Depth Vertex Shaders
// ---------------------------------------------------------------------------
@vertex
fn vsShadowTerrainNear(in : TerrainVSIn) -> @builtin(position) vec4<f32> {
  return uFrame.lightViewProjNear * vec4<f32>(in.pos, 1.0);
}
@vertex
fn vsShadowTerrainFar(in : TerrainVSIn) -> @builtin(position) vec4<f32> {
  return uFrame.lightViewProjFar * vec4<f32>(in.pos, 1.0);
}

@vertex
fn vsShadowCustomNear(in : CustomMeshVSIn) -> @builtin(position) vec4<f32> {
  return uFrame.lightViewProjNear * vec4<f32>(in.pos, 1.0);
}
@vertex
fn vsShadowCustomFar(in : CustomMeshVSIn) -> @builtin(position) vec4<f32> {
  return uFrame.lightViewProjFar * vec4<f32>(in.pos, 1.0);
}

@vertex
fn vsShadowCustomInstNear(in : CustomInstVSIn) -> @builtin(position) vec4<f32> {
  let worldPos = rotateByQuat(in.pos * in.instScale, in.instQuat) + in.instPos;
  return uFrame.lightViewProjNear * vec4<f32>(worldPos, 1.0);
}
@vertex
fn vsShadowCustomInstFar(in : CustomInstVSIn) -> @builtin(position) vec4<f32> {
  let worldPos = rotateByQuat(in.pos * in.instScale, in.instQuat) + in.instPos;
  return uFrame.lightViewProjFar * vec4<f32>(worldPos, 1.0);
}

@vertex
fn vsShadowInstancedNear(in : InstancedVSIn) -> @builtin(position) vec4<f32> {
  let worldPos = rotateByQuat(in.pos * in.instScale, in.instQuat) + in.instPos;
  return uFrame.lightViewProjNear * vec4<f32>(worldPos, 1.0);
}
@vertex
fn vsShadowInstancedFar(in : InstancedVSIn) -> @builtin(position) vec4<f32> {
  let worldPos = rotateByQuat(in.pos * in.instScale, in.instQuat) + in.instPos;
  return uFrame.lightViewProjFar * vec4<f32>(worldPos, 1.0);
}

@vertex
fn vsShadowSkinnedNear(in : SkinnedVSIn) -> @builtin(position) vec4<f32> {
  let sm = skinMatrix(in.joints, in.weights);
  let worldPos = (uSkin.model * (sm * vec4<f32>(in.pos, 1.0))).xyz;
  return uFrame.lightViewProjNear * vec4<f32>(worldPos, 1.0);
}
@vertex
fn vsShadowSkinnedFar(in : SkinnedVSIn) -> @builtin(position) vec4<f32> {
  let sm = skinMatrix(in.joints, in.weights);
  let worldPos = (uSkin.model * (sm * vec4<f32>(in.pos, 1.0))).xyz;
  return uFrame.lightViewProjFar * vec4<f32>(worldPos, 1.0);
}

// ---------------------------------------------------------------------------
// Main HDR Forward Pass Vertex Shaders
// ---------------------------------------------------------------------------
@vertex
fn vsTerrain(in : TerrainVSIn) -> VSOut {
  var pos = in.pos;
  let tSec = uFrame.camPos.w;
  if (in.uvKind.z > 0.5 && in.uvKind.z < 1.5) {
    let depthAtten = clamp(-in.uvKind.x * 0.55, 0.05, 1.0);
    let w1 = sin(pos.x * 0.14 + tSec * 1.55) * cos(pos.z * 0.13 - tSec * 1.05);
    let w2 = sin(pos.x * 0.31 - tSec * 2.05 + pos.z * 0.27);
    pos.y += (w1 * 0.11 + w2 * 0.05) * depthAtten;
  }
  var out : VSOut;
  out.clipPos = uFrame.viewProj * vec4<f32>(pos, 1.0);
  out.worldPos = pos;
  out.shadowPosNear = computeShadowCoord(uFrame.lightViewProjNear, pos);
  out.shadowPosFar = computeShadowCoord(uFrame.lightViewProjFar, pos);
  out.normal = normalize(in.normal);
  out.color = in.color;
  out.uv = in.uvKind.xy;
  out.surfaceKind = in.uvKind.z;
  out.emissiveBoost = 0.0;
  out.pbrParams = vec2<f32>(0.0, 0.86);
  return out;
}

@vertex
fn vsCustomMesh(in : CustomMeshVSIn) -> VSOut {
  let rawN = vec3<f32>(f32(in.normFam.x), f32(in.normFam.y), f32(in.normFam.z));
  let nLen = length(rawN);
  let worldN = select(vec3<f32>(0.0, 1.0, 0.0), rawN / nLen, nLen > 0.001);
  let fam = clamp(f32(in.normFam.w), 0.0, 9.0);

  let flagsBits = u32(round(in.matFlags.w * 255.0));
  let isRoadRibbon = (flagsBits & 4u) != 0u;

  var out : VSOut;
  out.clipPos = uFrame.viewProj * vec4<f32>(in.pos, 1.0);
  out.worldPos = in.pos;
  out.shadowPosNear = computeShadowCoord(uFrame.lightViewProjNear, in.pos);
  out.shadowPosFar = computeShadowCoord(uFrame.lightViewProjFar, in.pos);
  out.normal = worldN;
  out.color = in.color.rgb;
  out.uv = vec2<f32>(f32(in.uv16.x), f32(in.uv16.y)) / 256.0;
  out.surfaceKind = 20.0 + fam + select(0.0, 0.35, isRoadRibbon);
  out.emissiveBoost = in.matFlags.z * 4.0;
  out.pbrParams = vec2<f32>(in.matFlags.y, clamp(in.matFlags.x, 0.05, 0.98));
  return out;
}

@vertex
fn vsCustomInstanced(in : CustomInstVSIn) -> VSOut {
  let scaled = in.pos * in.instScale;
  let worldPos = rotateByQuat(scaled, in.instQuat) + in.instPos;
  let rawN = vec3<f32>(f32(in.normFam.x), f32(in.normFam.y), f32(in.normFam.z));
  let nLen = length(rawN);
  let localN = select(vec3<f32>(0.0, 1.0, 0.0), rawN / nLen, nLen > 0.001);
  let worldN = normalize(rotateByQuat(localN, in.instQuat));
  let fam = clamp(f32(in.normFam.w), 0.0, 9.0);

  var out : VSOut;
  out.clipPos = uFrame.viewProj * vec4<f32>(worldPos, 1.0);
  out.worldPos = worldPos;
  out.shadowPosNear = computeShadowCoord(uFrame.lightViewProjNear, worldPos);
  out.shadowPosFar = computeShadowCoord(uFrame.lightViewProjFar, worldPos);
  out.normal = worldN;
  out.color = in.color.rgb * in.instColEm.rgb;
  out.uv = vec2<f32>(f32(in.uv16.x), f32(in.uv16.y)) / 256.0;
  out.surfaceKind = 20.0 + fam;
  out.emissiveBoost = in.matFlags.z * 4.0 + in.instColEm.w;
  out.pbrParams = vec2<f32>(in.matFlags.y, clamp(in.matFlags.x, 0.05, 0.98));
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
  out.shadowPosNear = computeShadowCoord(uFrame.lightViewProjNear, worldPos);
  out.shadowPosFar = computeShadowCoord(uFrame.lightViewProjFar, worldPos);
  out.normal = rotNorm;

  if (in.instMatOvrd.x >= 0.0) {
    // Procedural Architecture Box (PackedArchBox: FacadeGrammar + CityBuildingKit + Compounds)
    let fam = floor(in.instMatOvrd.y + 0.001);
    let instMetal = clamp((in.instMatOvrd.y - fam) * 2.0, 0.0, 1.0);
    out.color = in.vtxCol * in.instColEm.rgb;
    out.surfaceKind = 20.0 + clamp(fam, 0.0, 9.0);
    out.pbrParams = vec2<f32>(instMetal, clamp(in.instMatOvrd.x, 0.05, 0.98));
    out.uv = vec2<f32>(worldPos.x * 0.25, worldPos.z * 0.25);
    out.emissiveBoost = in.instColEm.w;
    return out;
  }

  let mx = in.pbrParams.x;
  if (mx < -4.5) {
    out.color = in.vtxCol;
    out.surfaceKind = 15.0;
    out.pbrParams = vec2<f32>(0.10, in.pbrParams.y);
  } else if (mx < -3.5) {
    out.color = in.vtxCol;
    out.surfaceKind = 14.0;
    out.pbrParams = vec2<f32>(0.10, in.pbrParams.y);
  } else if (mx < -2.5) {
    out.color = in.vtxCol;
    out.surfaceKind = 13.0;
    out.pbrParams = vec2<f32>(0.22, in.pbrParams.y);
  } else if (mx < -1.5) {
    out.color = in.vtxCol;
    out.surfaceKind = 12.0;
    out.pbrParams = vec2<f32>(0.10, in.pbrParams.y);
  } else if (mx < -0.5) {
    out.color = in.vtxCol;
    out.surfaceKind = 11.0;
    out.pbrParams = vec2<f32>(0.10, in.pbrParams.y);
  } else if (mx >= 3.5) {
    out.color = in.vtxCol;
    out.surfaceKind = 4.0;
    out.pbrParams = vec2<f32>(mx - 4.0, in.pbrParams.y);
  } else if (mx >= 1.5) {
    out.color = in.vtxCol * in.instColEm.rgb;
    out.surfaceKind = 10.0;
    out.pbrParams = vec2<f32>(mx - 2.0, in.pbrParams.y);
  } else {
    out.color = in.vtxCol * in.instColEm.rgb;
    out.surfaceKind = 4.0;
    out.pbrParams = in.pbrParams;
  }

  out.uv = in.uv;
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
  out.shadowPosNear = computeShadowCoord(uFrame.lightViewProjNear, worldPos);
  out.shadowPosFar = computeShadowCoord(uFrame.lightViewProjFar, worldPos);
  out.normal = worldNorm;
  out.color = in.vtxCol * uSkin.tint.rgb;
  out.uv = in.uv;
  out.surfaceKind = select(5.0, 6.0, uSkin.tint.a > 1.5);
  out.emissiveBoost = 0.0;
  out.pbrParams = select(vec2<f32>(0.04, 0.64), vec2<f32>(0.0, 0.94), uSkin.tint.a > 1.5);
  return out;
}

// ---------------------------------------------------------------------------
// 2-Cascade 3x3 PCF Shadows & Cotangent Normal Mapping + Cook-Torrance GGX PBR
// ---------------------------------------------------------------------------
fn sampleCascadePCF(uvz : vec3<f32>, layer : i32, bias : f32) -> f32 {
  let uv = clamp(uvz.xy, vec2<f32>(0.0), vec2<f32>(1.0));
  let depthRef = uvz.z - bias;
  let texel = 1.0 / 2048.0;
  var acc = 0.0;
  for (var dy : i32 = -1; dy <= 1; dy = dy + 1) {
    for (var dx : i32 = -1; dx <= 1; dx = dx + 1) {
      let off = vec2<f32>(f32(dx), f32(dy)) * texel;
      acc += textureSampleCompareLevel(shadowMap, shadowSampler, uv + off, layer, depthRef);
    }
  }
  return acc / 9.0;
}

fn sampleShadowCSM(nearPos : vec3<f32>, farPos : vec3<f32>, ndotl : f32) -> f32 {
  let inNear = nearPos.x > 0.01 && nearPos.x < 0.99 &&
               nearPos.y > 0.01 && nearPos.y < 0.99 &&
               nearPos.z > 0.0 && nearPos.z < 1.0;
  let inFar = farPos.x > 0.005 && farPos.x < 0.995 &&
              farPos.y > 0.005 && farPos.y < 0.995 &&
              farPos.z > 0.0 && farPos.z < 1.0;

  let nearBias = max(0.00045, 0.0018 * (1.0 - ndotl));
  let farBias = max(0.0011, 0.0036 * (1.0 - ndotl));

  let nearSh = sampleCascadePCF(nearPos, 0, nearBias);
  let farSh = sampleCascadePCF(farPos, 1, farBias);

  let edgeDist = max(abs(nearPos.x - 0.5), abs(nearPos.y - 0.5));
  let cascadeBlend = smoothstep(0.40, 0.49, edgeDist);
  let farResolved = select(1.0, farSh, inFar);
  return select(farResolved, mix(nearSh, farResolved, cascadeBlend), inNear);
}

fn perturbCotangentNormal(N : vec3<f32>, dp1 : vec3<f32>, dp2 : vec3<f32>, duv1 : vec2<f32>, duv2 : vec2<f32>, mapN : vec3<f32>) -> vec3<f32> {
  let dp2perp = cross(dp2, N);
  let dp1perp = cross(N, dp1);
  let T = dp2perp * duv1.x + dp1perp * duv2.x;
  let B = dp2perp * duv1.y + dp1perp * duv2.y;
  let maxLenSq = max(dot(T, T), dot(B, B));
  if (maxLenSq < 1e-10) {
    return N;
  }
  let invmax = inverseSqrt(maxLenSq);
  return normalize(T * (mapN.x * invmax) + B * (mapN.y * invmax) + N * mapN.z);
}

fn distributionGGX(N : vec3<f32>, H : vec3<f32>, roughness : f32) -> f32 {
  let a = roughness * roughness;
  let a2 = a * a;
  let ndoth = max(dot(N, H), 0.0);
  let ndoth2 = ndoth * ndoth;
  let denom = (ndoth2 * (a2 - 1.0) + 1.0);
  return a2 / max(PI * denom * denom, 0.0001);
}

fn geometrySchlickGGX(ndotv : f32, roughness : f32) -> f32 {
  let r = roughness + 1.0;
  let k = (r * r) / 8.0;
  return ndotv / max(ndotv * (1.0 - k) + k, 0.0001);
}

fn geometrySmith(N : vec3<f32>, V : vec3<f32>, L : vec3<f32>, roughness : f32) -> f32 {
  return geometrySchlickGGX(max(dot(N, V), 0.0), roughness) *
         geometrySchlickGGX(max(dot(N, L), 0.0), roughness);
}

fn fresnelSchlick(cosTheta : f32, F0 : vec3<f32>) -> vec3<f32> {
  return F0 + (vec3<f32>(1.0) - F0) * pow(clamp(1.0 - cosTheta, 0.0, 1.0), 5.0);
}

fn cookTorranceDirect(N : vec3<f32>, V : vec3<f32>, L : vec3<f32>, albedo : vec3<f32>, metallic : f32, roughness : f32, lightCol : vec3<f32>) -> vec3<f32> {
  let H = normalize(L + V);
  let ndotl = max(dot(N, L), 0.0);
  let ndotv = max(dot(N, V), 0.001);
  let F0 = mix(vec3<f32>(0.04), albedo, metallic);
  let NDF = distributionGGX(N, H, roughness);
  let G = geometrySmith(N, V, L, roughness);
  let F = fresnelSchlick(max(dot(H, V), 0.0), F0);
  let spec = (NDF * G * F) / max(4.0 * ndotv * ndotl, 0.001);
  let kD = (vec3<f32>(1.0) - F) * (1.0 - metallic);
  return (kD * albedo / PI + spec) * lightCol * ndotl;
}

@fragment
fn fsMain(in : VSOut) -> @location(0) vec4<f32> {
  // All texture samples & screen-space derivatives MUST execute in uniform control flow
  let safeUV = select(in.uv, vec2<f32>(0.5, 0.5), in.uv.x < -500.0);
  let texColor = textureSample(albedoTex, albedoSampler, safeUV);
  let normTexSample = textureSample(normalTex, albedoSampler, safeUV).xyz;
  let mrTexSample = textureSample(mrTex, albedoSampler, safeUV).rgb;
  let emTexSample = textureSample(emissiveTex, albedoSampler, safeUV).rgb;
  let dp1 = dpdx(in.worldPos);
  let dp2 = dpdy(in.worldPos);
  let duv1 = dpdx(safeUV);
  let duv2 = dpdy(safeUV);

  if (in.surfaceKind > 3.5 && in.surfaceKind < 6.5 && texColor.a < 0.35) {
    discard;
  }

  var N = normalize(in.normal);
  let L = normalize(uFrame.sunDir.xyz);
  let V = normalize(uFrame.camPos.xyz - in.worldPos);
  let tSec = uFrame.camPos.w;

  let vtxLin = srgbToLinear(in.color);
  let texLin = srgbToLinear(texColor.rgb);
  let emTexLin = srgbToLinear(emTexSample);
  let fogLin = srgbToLinear(uFrame.fogColor.rgb);
  let sunLin = srgbToLinear(uFrame.sunColor.rgb);

  var albedo = vtxLin;
  var metallic = clamp(in.pbrParams.x, 0.0, 1.0);
  var roughness = clamp(in.pbrParams.y, 0.06, 0.98);
  var texAo = clamp(mrTexSample.r, 0.25, 1.0);
  var emissive = vec3<f32>(0.0);
  let nightFactor = clamp(uFrame.fogColor.w, 0.0, 1.0);
  let wetness = clamp(uFrame.weatherParams.y, 0.0, 1.0);

  // Apply tangent-space normal map on textured GLBs, vehicles & characters
  if (in.surfaceKind > 3.5 && in.surfaceKind < 16.5 && in.uv.x > -500.0) {
    let mapN = normTexSample * 2.0 - vec3<f32>(1.0);
    if (abs(mapN.x) + abs(mapN.y) > 0.02) {
      N = perturbCotangentNormal(N, dp1, dp2, duv1, duv2, normalize(mapN));
    }
  }

  if (in.surfaceKind >= 19.5) {
    // Native Custom World Meshes (westgate_meshes.bin) + Procedural Architecture (PackedArchBox)
    let fam = round(in.surfaceKind - 20.0);
    if (fam < 0.5) {
      // 0: Painted plaster / stucco / generic architectural panel
      let stucco = noise2D(in.worldPos.xz * 6.5 + vec2<f32>(in.worldPos.y * 6.5, 0.0));
      albedo = vtxLin * (0.93 + 0.14 * stucco) * mix(1.0, 0.72, wetness * 0.5);
      roughness = mix(roughness, 0.28, wetness * 0.55);
      emissive = vtxLin * (in.emissiveBoost * (0.45 + 0.95 * nightFactor));
    } else if (fam < 1.5) {
      // 1: Asphalt roadway, roundabout & bridge deck asphalt
      let gCoarse = noise2D(in.worldPos.xz * 2.2);
      let gFine = hash21(floor(in.worldPos.xz * 26.0));
      albedo = vtxLin * (0.84 + 0.22 * gCoarse + 0.12 * gFine) * mix(1.0, 0.44, wetness);
      var paintMask = 0.0;
      if (in.surfaceKind > 21.2) {
        // Roadway ribbon (in.uv.x = [0..1] across carriageway, in.uv.y = s / 16m along road)
        let u = clamp(in.uv.x, 0.0, 1.0);
        let vMeters = in.uv.y * 16.0;
        let tireWear = exp(-pow((abs(u - 0.5) - 0.24) * 14.0, 2.0));
        albedo *= 1.0 - 0.16 * tireWear;

        let dCenter = abs(u - 0.5);
        let yellowLine = smoothstep(0.022, 0.017, dCenter) * smoothstep(0.005, 0.009, dCenter);
        let edgeLine = smoothstep(0.011, 0.006, min(abs(u - 0.048), abs(u - 0.952)));
        let dashPhase = fract(vMeters / 9.0);
        let dashMask = smoothstep(0.40, 0.35, dashPhase) * smoothstep(0.02, 0.07, dashPhase);
        let laneDash = smoothstep(0.009, 0.005, min(abs(u - 0.265), abs(u - 0.735))) * dashMask;
        let whitePaint = clamp(edgeLine + laneDash, 0.0, 1.0);
        let bead = 0.92 + 0.14 * gFine;
        albedo = mix(albedo, vec3<f32>(0.76, 0.50, 0.045) * bead, yellowLine);
        albedo = mix(albedo, vec3<f32>(0.72, 0.74, 0.77) * bead, whitePaint);
        paintMask = max(yellowLine, whitePaint);
      }
      let puddle = smoothstep(0.38, 0.78, noise2D(in.worldPos.xz * 0.14)) * wetness * (1.0 - paintMask * 0.65);
      let roadFres = pow(1.0 - max(dot(N, V), 0.0), 4.0);
      albedo = mix(albedo, fogLin * 0.62, puddle * roadFres * 0.65);
      metallic = 0.02;
      roughness = mix(mix(clamp(roughness, 0.78, 0.95), 0.44, paintMask), 0.09, puddle);
    } else if (fam < 2.5) {
      // 2: Concrete sidewalk, curb, plaza, median & brutalist concrete
      let jx = smoothstep(0.0, 0.028, abs(fract(in.worldPos.x * 0.55) - 0.5));
      let jz = smoothstep(0.0, 0.028, abs(fract(in.worldPos.z * 0.55) - 0.5));
      let seam = mix(0.76, 1.0, min(jx, jz));
      let grain = noise2D(in.worldPos.xz * 7.5 + vec2<f32>(in.worldPos.y * 4.0, 0.0));
      albedo = vtxLin * seam * (0.91 + 0.16 * grain) * mix(1.0, 0.60, wetness * 0.75);
      roughness = mix(roughness, 0.24, wetness * 0.7);
      emissive = vtxLin * (in.emissiveBoost * (0.45 + 0.95 * nightFactor));
    } else if (fam < 3.5) {
      // 3: Thermoplastic road lane stripe, crosswalk, stop bar & runway marking
      let bead = hash21(floor(in.worldPos.xz * 34.0));
      albedo = vtxLin * (0.94 + 0.12 * bead);
      metallic = 0.05;
      roughness = mix(0.42, 0.18, wetness);
    } else if (fam < 4.5) {
      // 4: Masonry: brick, limestone, granite & cobblestone
      let row = floor(in.worldPos.y * 4.2);
      let hCoord = (in.worldPos.x + in.worldPos.z) * 1.65 + (row % 2.0) * 0.5;
      let mortarY = smoothstep(0.0, 0.09, fract(in.worldPos.y * 4.2));
      let mortarX = smoothstep(0.0, 0.06, fract(hCoord));
      let mortar = mix(0.74, 1.0, min(mortarX, mortarY));
      let brickVar = hash21(vec2<f32>(floor(hCoord), row));
      albedo = vtxLin * mortar * (0.90 + 0.20 * brickVar) * mix(1.0, 0.68, wetness * 0.6);
      roughness = mix(roughness, 0.28, wetness * 0.55);
    } else if (fam < 5.5) {
      // 5: Wood planks, pier timber, roof shingles, water towers & crates
      let plank = smoothstep(0.0, 0.06, fract((in.worldPos.x + in.worldPos.z) * 3.6));
      let grain = noise2D(vec2<f32>(in.worldPos.x * 14.0, in.worldPos.z * 2.2 + in.worldPos.y * 5.0));
      albedo = vtxLin * mix(0.78, 1.0, plank) * (0.88 + 0.22 * grain) * mix(1.0, 0.62, wetness * 0.7);
      roughness = mix(roughness, 0.30, wetness * 0.6);
    } else if (fam < 6.5) {
      // 6: Architectural & structural metal (mullions, bridge cables/towers, HVAC, streetlights, brass)
      let brush = noise2D(vec2<f32>((in.worldPos.x + in.worldPos.z) * 18.0, in.worldPos.y * 18.0));
      albedo = vtxLin * (0.94 + 0.12 * brush);
      metallic = max(metallic, 0.68);
      roughness = clamp(mix(roughness, 0.16, wetness * 0.5), 0.08, 0.62);
      emissive = vtxLin * (in.emissiveBoost * (0.50 + 0.90 * nightFactor));
    } else if (fam < 7.5) {
      // 7: Park turf, median grass & planter foliage
      let lush = noise2D(in.worldPos.xz * 1.4);
      let blade = noise2D(in.worldPos.xz * 11.0);
      albedo = vtxLin * (0.82 + 0.24 * lush + 0.14 * blade) * mix(1.0, 0.68, wetness * 0.5);
      metallic = 0.0;
      roughness = mix(0.88, 0.44, wetness);
    } else {
      // 8 & 9: Architectural Curtainwall / Storefront Glass & Swimming Pool Water
      if (N.y > 0.85) {
        // Horizontal glass skylight or Safehouse swimming pool water
        let rip = sin(in.worldPos.x * 2.4 + tSec * 2.2) * cos(in.worldPos.z * 2.3 - tSec * 1.8);
        N = normalize(vec3<f32>(rip * 0.05, 1.0, -rip * 0.05));
        albedo = vtxLin;
        metallic = 0.18;
        roughness = 0.05;
        emissive = vtxLin * (in.emissiveBoost * (0.25 + 0.85 * nightFactor));
      } else {
        // Curtainwall / Storefront Glass: sleek daytime sky reflections + warm interior glow at dusk/night
        let roomVar = 0.80 + 0.35 * noise2D(vec2<f32>((in.worldPos.x + in.worldPos.z) * 0.9, in.worldPos.y * 0.7));
        let isLitWindow = in.emissiveBoost > 0.15;
        let nightGlow = smoothstep(0.06, 0.68, nightFactor);
        albedo = select(vtxLin * 0.55, mix(vtxLin * 0.18, vtxLin, nightGlow * 0.75), isLitWindow);
        metallic = select(0.72, mix(0.68, 0.20, nightGlow), isLitWindow);
        roughness = 0.065;
        if (isLitWindow) {
          emissive = vtxLin * (in.emissiveBoost * roomVar * mix(0.04, 1.25, nightGlow));
        }
      }
    }
  } else if (in.surfaceKind > 14.5) {
    let pulseRed = 0.35 + 1.65 * max(0.0, sin(tSec * 14.0));
    albedo = vtxLin * texLin;
    metallic = 0.12;
    roughness = 0.10;
    emissive = vec3<f32>(2.85, 0.12, 0.08) * pulseRed;
  } else if (in.surfaceKind > 13.5) {
    let pulseBlue = 0.35 + 1.65 * max(0.0, -sin(tSec * 14.0));
    albedo = vtxLin * texLin;
    metallic = 0.12;
    roughness = 0.10;
    emissive = vec3<f32>(0.16, 0.65, 3.10) * pulseBlue;
  } else if (in.surfaceKind > 12.5) {
    albedo = mix(vtxLin * texLin, vec3<f32>(0.014, 0.024, 0.042), 0.72);
    metallic = 0.28;
    roughness = 0.05;
  } else if (in.surfaceKind > 11.5) {
    albedo = vtxLin * texLin;
    metallic = 0.12;
    roughness = 0.12;
    emissive = vec3<f32>(2.35, 0.07, 0.06) * (0.45 + nightFactor * 1.15);
  } else if (in.surfaceKind > 10.5) {
    albedo = vtxLin * texLin;
    metallic = 0.12;
    roughness = 0.10;
    emissive = vec3<f32>(2.25, 2.20, 2.05) * (0.35 + nightFactor * 1.35);
  } else if (in.surfaceKind > 9.5) {
    albedo = vtxLin * texLin;
    metallic = clamp(in.pbrParams.x * mrTexSample.b, 0.0, 1.0);
    roughness = mix(clamp(in.pbrParams.y * mrTexSample.g, 0.06, 0.98), 0.06, 0.45 + wetness * 0.35);
  } else if (in.surfaceKind > 5.5) {
    albedo = vtxLin * texLin;
    metallic = 0.0;
    roughness = 0.94;
  } else if (in.surfaceKind > 4.5) {
    albedo = vtxLin * texLin;
    metallic = clamp(0.04 * mrTexSample.b, 0.0, 1.0);
    roughness = mix(clamp(0.68 * mrTexSample.g, 0.12, 0.96), 0.36, wetness * 0.55);
  } else if (in.surfaceKind > 3.5) {
    // Textured PBR GLB Houses, Trees, Aircraft, Ships, Props & Markers
    albedo = vtxLin * texLin;
    metallic = clamp(metallic * mrTexSample.b, 0.0, 1.0);
    roughness = clamp(roughness * mrTexSample.g, 0.06, 0.98);
    if (in.emissiveBoost < -0.01) {
      emissive = emTexLin * (-in.emissiveBoost);
    } else {
      emissive = albedo * in.emissiveBoost;
    }
    if (abs(N.y) < 0.35 && in.worldPos.y > 4.5 && in.uv.x < -500.0) {
      let cellX = floor(in.worldPos.x * 0.28 + in.worldPos.z * 0.28);
      let cellY = floor(in.worldPos.y * 0.26);
      let gridX = fract(in.worldPos.x * 0.28 + in.worldPos.z * 0.28);
      let gridY = fract(in.worldPos.y * 0.26);
      if (gridX > 0.16 && gridX < 0.84 && gridY > 0.22 && gridY < 0.82) {
        albedo = mix(albedo, vec3<f32>(0.010, 0.025, 0.055), 0.78);
        metallic = 0.25;
        roughness = 0.12;
        let winHash = fract(sin(dot(vec2<f32>(cellX, cellY), vec2<f32>(12.9898, 78.233))) * 43758.5453);
        if (winHash > 0.50 && nightFactor > 0.05) {
          let warm = mix(vec3<f32>(0.22, 0.65, 1.15), vec3<f32>(1.45, 0.78, 0.18), step(0.66, winHash));
          emissive += warm * (nightFactor * 1.35);
        }
      }
    } else if (wetness > 0.05) {
      roughness = mix(roughness, 0.18, wetness * 0.60);
    }
  } else if (in.surfaceKind > 2.5 && in.surfaceKind < 3.5) {
    let tile = fract(in.worldPos.x * 0.5) * fract(in.worldPos.z * 0.5);
    let slabSeam = step(0.03, fract(in.worldPos.x * 0.35)) * step(0.03, fract(in.worldPos.z * 0.35));
    albedo = albedo * (0.86 + 0.14 * tile) * mix(0.75, 1.0, slabSeam);
    metallic = 0.04;
    roughness = mix(0.78, 0.28, wetness);
  } else if (in.surfaceKind > 1.5 && in.surfaceKind < 2.5) {
    let roadU = in.uv.x;
    let roadDist = in.uv.y;
    let grain = hash21(floor(in.worldPos.xz * 3.5));
    albedo = albedo * (0.88 + 0.24 * grain) * mix(1.0, 0.42, wetness);
    if (abs(roadU - 0.5) > 0.012 && abs(roadU - 0.5) < 0.032) {
      albedo = vec3<f32>(0.76, 0.43, 0.015);
    } else if (roadU < 0.045 || roadU > 0.955) {
      albedo = vec3<f32>(0.68, 0.72, 0.76);
    } else if (abs(roadU - 0.25) < 0.012 || abs(roadU - 0.75) < 0.012) {
      if (fract(roadDist * 0.12) < 0.42) {
        albedo = vec3<f32>(0.65, 0.68, 0.72);
      }
    }
    let puddle = smoothstep(0.35, 0.80, sin(in.worldPos.x * 0.18) * cos(in.worldPos.z * 0.19) * 0.5 + 0.5) * wetness;
    let roadFresnel = pow(1.0 - max(dot(N, V), 0.0), 4.0);
    albedo = mix(albedo, fogLin * 0.65, puddle * roadFresnel * 0.65);
    metallic = 0.02;
    roughness = mix(0.72, 0.10, puddle);
  } else if (in.surfaceKind > 0.5 && in.surfaceKind < 1.5) {
    // Pacific Ocean, Westgate River, East Seaport Harbor, Venice Canals & Mirror Park Lake
    let w1 = sin(in.worldPos.x * 0.22 + tSec * 1.65) * cos(in.worldPos.z * 0.18 - tSec * 1.15);
    let w2 = sin(in.worldPos.x * 0.54 - tSec * 2.15 + in.worldPos.z * 0.47);
    let w3 = noise2D(in.worldPos.xz * 0.85 + vec2<f32>(tSec * 0.45, -tSec * 0.35)) * 2.0 - 1.0;
    N = normalize(vec3<f32>((w1 + w2 * 0.55 + w3 * 0.35) * 0.085, 1.0, (w2 - w1 * 0.55 + w3 * 0.30) * 0.085));

    let waterDepth = max(0.0, -in.uv.x);
    let shallowT = 1.0 - smoothstep(0.0, 5.8, waterDepth);
    let deepCol = vec3<f32>(0.004, 0.020, 0.056);
    let coveCol = vec3<f32>(0.014, 0.170, 0.225);
    var waterBase = mix(deepCol, coveCol, shallowT);

    let surfWave = 0.5 + 0.5 * sin(waterDepth * 6.8 - tSec * 2.7 + w1 * 2.1);
    let foamMask = smoothstep(1.15, 0.04, waterDepth) * (0.42 + 0.58 * surfWave);
    waterBase = mix(waterBase, vec3<f32>(0.70, 0.80, 0.90), foamMask * 0.72);

    let fresnel = pow(1.0 - max(dot(N, V), 0.0), 4.2);
    albedo = mix(waterBase, fogLin * 0.84 + vec3<f32>(0.02, 0.06, 0.15), fresnel * 0.78);
    metallic = 0.14;
    roughness = mix(0.065, 0.42, foamMask);
    texAo = 1.0;
  } else {
    // Multi-biome Westgate Bay terrain splatting & slope strata
    let macroVar = noise2D(in.worldPos.xz * 0.065) * 0.22 - 0.11;
    let midVar = noise2D(in.worldPos.xz * 0.42) * 0.16 - 0.08;
    let fineVar = noise2D(in.worldPos.xz * 2.8) * 0.10 - 0.05;
    let cliffMask = 1.0 - smoothstep(0.68, 0.90, N.y);
    let strata = sin(in.worldPos.y * 1.7 + noise2D(in.worldPos.xz * 0.12) * 4.0) * 0.14 * cliffMask;
    let rockCol = vec3<f32>(0.115, 0.108, 0.098);
    albedo = mix(albedo, rockCol, cliffMask * 0.65);
    albedo = clamp(albedo * (1.0 + macroVar + midVar + fineVar + strata), vec3<f32>(0.004), vec3<f32>(1.0));
    albedo *= mix(1.0, 0.62, wetness * 0.6);
    metallic = 0.0;
    roughness = mix(mix(0.90, 0.76, cliffMask), 0.38, wetness);
    texAo = 1.0;
  }

  let ndotl = max(dot(N, L), 0.0);
  let shadow = sampleShadowCSM(in.shadowPosNear, in.shadowPosFar, ndotl);

  let hemi = 0.5 + 0.5 * N.y;
  let dayAmb = mix(vec3<f32>(0.044, 0.040, 0.036), vec3<f32>(0.165, 0.285, 0.55), hemi);
  let nightAmb = mix(vec3<f32>(0.007, 0.010, 0.022), vec3<f32>(0.020, 0.035, 0.078), hemi);
  let skyAmbient = mix(dayAmb, nightAmb, nightFactor);
  let F0 = mix(vec3<f32>(0.04), albedo, metallic);
  let envF = fresnelSchlick(max(dot(N, V), 0.0), F0) * (1.0 - roughness * 0.85);
  let R = reflect(-V, N);
  let envHorizon = mix(fogLin * 0.42, skyAmbient * 1.65, clamp(R.y * 0.5 + 0.5, 0.0, 1.0));
  let envSunBounce = sunLin * pow(max(dot(R, L), 0.0), 24.0) * (1.0 - roughness) * 0.65;
  let envColor = envHorizon + envSunBounce;

  var lit = (albedo * skyAmbient * (1.0 - metallic * 0.5) + envColor * envF) * texAo;
  lit += cookTorranceDirect(N, V, L, albedo, metallic, roughness, sunLin * 1.85) * shadow;
  if (in.surfaceKind > 9.5 && in.surfaceKind < 10.5) {
    let clearF = fresnelSchlick(max(dot(N, V), 0.0), vec3<f32>(0.04));
    lit += envColor * clearF * 0.55;
    lit += cookTorranceDirect(N, V, L, vec3<f32>(0.04), 0.0, 0.045, sunLin * 1.15) * shadow;
  }
  lit += emissive;

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
      let plLin = srgbToLinear(pl.colorAndIntensity.rgb) * (pl.colorAndIntensity.w * att);
      lit += cookTorranceDirect(N, V, pL, albedo, metallic, roughness, plLin);
    }
  }

  let dist = length(uFrame.camPos.xyz - in.worldPos);
  let distFog = 1.0 - exp(-dist * 0.00048);
  let heightAtten = exp(-max(0.0, in.worldPos.y) * 0.018);
  let fogFactor = clamp(distFog * (0.66 + 0.34 * heightAtten), 0.0, 0.88);
  lit = mix(lit, fogLin, fogFactor);

  return vec4<f32>(lit, 1.0);
}
