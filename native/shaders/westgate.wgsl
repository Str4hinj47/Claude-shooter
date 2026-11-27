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

@group(3) @binding(0) var shadowMap : texture_depth_2d_array;
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
  @location(8) pbrParams : vec2<f32>, // x = metallic, y = roughness
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
// Output is linear HDR (RGBA16Float) for bloom + final ACES tonemap pass
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
  let zenithDay = vec3<f32>(0.028, 0.145, 0.72);
  let zenithNight = vec3<f32>(0.002, 0.004, 0.016);
  let zenith = mix(zenithDay, zenithNight, nightFactor);

  var sky = mix(fogLin, zenith, pow(upness, 0.52));

  // Sun / Moon disc & Mie atmospheric halo
  let sunCos = max(dot(rayDir, L), 0.0);
  let halo = pow(sunCos, 14.0) * (0.48 - 0.34 * nightFactor) * (1.0 - rain * 0.65);
  let disc = smoothstep(0.9992, 0.9997, sunCos) * (1.0 - 0.65 * nightFactor) * (1.0 - rain * 0.85);
  sky += sunLin * (halo + disc * 5.0);

  // Twinkling Starfield at night
  if (nightFactor > 0.15 && rayDir.y > 0.04 && rain < 0.75) {
    let cell = floor(rayDir * 260.0);
    let h = fract(sin(dot(cell, vec3<f32>(12.9898, 78.233, 37.719))) * 43758.5453);
    if (h > 0.9935) {
      let twinkle = 0.65 + 0.35 * sin(tSec * 2.8 + h * 120.0);
      sky += vec3<f32>(0.75, 0.86, 1.10) * (nightFactor * (1.0 - rain * 0.8) * twinkle * smoothstep(0.04, 0.25, rayDir.y));
    }
  }

  // 2-Layer FBM Sky Clouds (clear sparse wisps -> thick storm deck lit by lightning)
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
// 2-Cascade Shadow Depth Vertex Shaders (Near = 50m crisp, Far = 260m skyline)
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
    let w1 = sin(pos.x * 0.14 + tSec * 1.55) * cos(pos.z * 0.13 - tSec * 1.05);
    let w2 = sin(pos.x * 0.31 - tSec * 2.05 + pos.z * 0.27);
    pos.y += (w1 * 0.16 + w2 * 0.08);
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
  out.pbrParams = vec2<f32>(0.0, 0.85);
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
  out.color = in.vtxCol * in.instColEm.rgb;
  out.uv = in.uv;
  out.surfaceKind = 4.0;
  out.emissiveBoost = in.instColEm.w;
  out.pbrParams = in.pbrParams;
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
  out.pbrParams = select(vec2<f32>(0.05, 0.65), vec2<f32>(0.0, 0.92), uSkin.tint.a > 1.5);
  return out;
}

// ---------------------------------------------------------------------------
// 2-Cascade 3x3 PCF Shadows & Cook-Torrance GGX PBR Shading
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

  // Sample both in uniform control flow for WebGPU validation
  let nearSh = sampleCascadePCF(nearPos, 0, nearBias);
  let farSh = sampleCascadePCF(farPos, 1, farBias);

  let edgeDist = max(abs(nearPos.x - 0.5), abs(nearPos.y - 0.5));
  let cascadeBlend = smoothstep(0.40, 0.49, edgeDist);
  let farResolved = select(1.0, farSh, inFar);
  return select(farResolved, mix(nearSh, farResolved, cascadeBlend), inNear);
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
  let texColor = textureSample(albedoTex, albedoSampler, in.uv);

  var N = normalize(in.normal);
  let L = normalize(uFrame.sunDir.xyz);
  let V = normalize(uFrame.camPos.xyz - in.worldPos);
  let tSec = uFrame.camPos.w;

  let vtxLin = srgbToLinear(in.color);
  let texLin = srgbToLinear(texColor.rgb);
  let fogLin = srgbToLinear(uFrame.fogColor.rgb);
  let sunLin = srgbToLinear(uFrame.sunColor.rgb);

  var albedo = vtxLin;
  var metallic = clamp(in.pbrParams.x, 0.0, 1.0);
  var roughness = clamp(in.pbrParams.y, 0.08, 0.98);
  var emissive = vtxLin * in.emissiveBoost;
  let nightFactor = clamp(uFrame.fogColor.w, 0.0, 1.0);
  let wetness = clamp(uFrame.weatherParams.y, 0.0, 1.0);

  if (in.surfaceKind > 5.5) {
    // Matte fibrous hair (zero plastic specular glare)
    albedo = vtxLin * texLin;
    metallic = 0.0;
    roughness = 0.94;
  } else if (in.surfaceKind > 4.5) {
    // Textured skinned character
    albedo = vtxLin * texLin;
    metallic = 0.04;
    roughness = mix(0.68, 0.36, wetness * 0.55);
  } else if (in.surfaceKind > 3.5) {
    // Instanced GLB houses/vehicles/props + skyscraper box facades
    albedo = vtxLin * texLin;
    if (abs(N.y) < 0.35 && in.worldPos.y > 4.5 && in.uv.x < -0.5) {
      let cellX = floor(in.worldPos.x * 0.28 + in.worldPos.z * 0.28);
      let cellY = floor(in.worldPos.y * 0.26);
      let gridX = fract(in.worldPos.x * 0.28 + in.worldPos.z * 0.28);
      let gridY = fract(in.worldPos.y * 0.26);
      if (gridX > 0.16 && gridX < 0.84 && gridY > 0.22 && gridY < 0.82) {
        albedo = mix(albedo, vec3<f32>(0.010, 0.025, 0.055), 0.78);
        metallic = 0.25;
        roughness = 0.14;
        let winHash = fract(sin(dot(vec2<f32>(cellX, cellY), vec2<f32>(12.9898, 78.233))) * 43758.5453);
        if (winHash > 0.50 && nightFactor > 0.05) {
          let warm = mix(vec3<f32>(0.22, 0.65, 1.15), vec3<f32>(1.45, 0.78, 0.18), step(0.66, winHash));
          emissive += warm * (nightFactor * 1.45);
        }
      }
    } else if (wetness > 0.05) {
      roughness = mix(roughness, 0.18, wetness * 0.65);
    }
  } else if (in.surfaceKind > 2.5 && in.surfaceKind < 3.5) {
    // Sidewalks, bridge steel, concrete plazas & walk-in interior masonry
    let tile = fract(in.worldPos.x * 0.5) * fract(in.worldPos.z * 0.5);
    let slabSeam = step(0.03, fract(in.worldPos.x * 0.35)) * step(0.03, fract(in.worldPos.z * 0.35));
    albedo = albedo * (0.86 + 0.14 * tile) * mix(0.75, 1.0, slabSeam);
    metallic = 0.04;
    roughness = mix(0.78, 0.28, wetness);
  } else if (in.surfaceKind > 1.5 && in.surfaceKind < 2.5) {
    // Asphalt road ribbons with lane markings + wet-puddle mirror reflections
    let roadU = in.uv.x;
    let roadDist = in.uv.y;
    let grain = fract(sin(dot(floor(in.worldPos.xz * 3.5), vec2<f32>(12.9898, 78.233))) * 43758.5453);
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
    // Depth-tinted Ocean Water + Shoreline Foam + Fresnel Sky + Sun-Glitter GGX
    let w1 = sin(in.worldPos.x * 0.18 + tSec * 1.6) * cos(in.worldPos.z * 0.15 - tSec * 1.1);
    let w2 = sin(in.worldPos.x * 0.42 - tSec * 2.1 + in.worldPos.z * 0.37);
    N = normalize(vec3<f32>((w1 + w2 * 0.5) * 0.095, 1.0, (w2 - w1 * 0.5) * 0.095));

    let groundY = in.uv.x;
    let waterDepth = max(0.0, -groundY);
    let shallowT = 1.0 - smoothstep(0.0, 5.5, waterDepth);
    let deepCol = vec3<f32>(0.005, 0.022, 0.058);
    let coveCol = vec3<f32>(0.014, 0.165, 0.215);
    var waterBase = mix(deepCol, coveCol, shallowT);

    // Animated white shore surf / foam band near beaches & islands
    let surfWave = 0.5 + 0.5 * sin(waterDepth * 6.5 - tSec * 2.8 + w1 * 2.0);
    let foamMask = smoothstep(1.35, 0.08, waterDepth) * (0.45 + 0.55 * surfWave);
    waterBase = mix(waterBase, vec3<f32>(0.68, 0.78, 0.88), foamMask * 0.72);

    let fresnel = pow(1.0 - max(dot(N, V), 0.0), 4.2);
    albedo = mix(waterBase, fogLin * 0.82 + vec3<f32>(0.02, 0.06, 0.14), fresnel * 0.76);
    metallic = 0.12;
    roughness = mix(0.09, 0.45, foamMask);
  } else if (in.surfaceKind < 0.5) {
    // Multi-band procedural terrain micro-detail
    let microA = sin(in.worldPos.x * 0.45) * cos(in.worldPos.z * 0.45) * 0.09;
    let microB = sin(in.worldPos.x * 1.9 + in.worldPos.z * 1.4) * 0.05;
    let strata = sin(in.worldPos.y * 1.6 + in.worldPos.x * 0.08) * 0.11 * (1.0 - smoothstep(0.70, 0.92, N.y));
    albedo = clamp(albedo * (1.0 + microA + microB + strata), vec3<f32>(0.004), vec3<f32>(1.0));
    albedo *= mix(1.0, 0.62, wetness * 0.6);
    metallic = 0.0;
    roughness = mix(0.88, 0.38, wetness);
  }

  let ndotl = max(dot(N, L), 0.0);
  let shadow = sampleShadowCSM(in.shadowPosNear, in.shadowPosFar, ndotl);

  // Analytic Sky/Ground Hemisphere IBL + Fresnel Specular Reflection (linear HDR)
  let hemi = 0.5 + 0.5 * N.y;
  let dayAmb = mix(vec3<f32>(0.042, 0.038, 0.035), vec3<f32>(0.16, 0.28, 0.54), hemi);
  let nightAmb = mix(vec3<f32>(0.006, 0.009, 0.020), vec3<f32>(0.018, 0.032, 0.072), hemi);
  let skyAmbient = mix(dayAmb, nightAmb, nightFactor);
  let F0 = mix(vec3<f32>(0.04), albedo, metallic);
  let envF = fresnelSchlick(max(dot(N, V), 0.0), F0) * (1.0 - roughness * 0.85);
  let R = reflect(-V, N);
  let envColor = mix(fogLin * 0.35, skyAmbient * 1.55, clamp(R.y * 0.5 + 0.5, 0.0, 1.0));

  var lit = albedo * skyAmbient * (1.0 - metallic * 0.5) + envColor * envF;
  lit += cookTorranceDirect(N, V, L, albedo, metallic, roughness, sunLin * 1.85) * shadow;
  lit += emissive;

  // Dynamic Local Point Lights with Cook-Torrance GGX specular highlights
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

  // Distance + Coastal Low-Height Atmospheric Haze
  let dist = length(uFrame.camPos.xyz - in.worldPos);
  let distFog = 1.0 - exp(-dist * 0.00056);
  let heightAtten = exp(-max(0.0, in.worldPos.y) * 0.018);
  let fogFactor = clamp(distFog * (0.68 + 0.32 * heightAtten), 0.0, 0.90);
  lit = mix(lit, fogLin, fogFactor);

  return vec4<f32>(lit, 1.0);
}
