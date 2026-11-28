// Post-Processing Pipelines: SSAO, HDR Bloom Threshold/Blur, ACES Composite Tonemap

struct PostParams {
  screenSize  : vec4<f32>, // x = width, y = height, z = bloomThreshold, w = bloomIntensity
  projParams  : vec4<f32>, // x = near, y = far, z = ssaoRadius, w = ssaoStrength
};

@group(0) @binding(0) var<uniform> uPost : PostParams;
@group(0) @binding(1) var texA : texture_2d<f32>;
@group(0) @binding(2) var texB : texture_2d<f32>;
@group(0) @binding(3) var texLinearSampler : sampler;
@group(0) @binding(4) var depthTex : texture_depth_2d;
@group(0) @binding(5) var texSSAO : texture_2d<f32>;

struct FullscreenOut {
  @builtin(position) clipPos : vec4<f32>,
  @location(0) uv            : vec2<f32>,
};

@vertex
fn vsFullscreen(@builtin(vertex_index) vid : u32) -> FullscreenOut {
  var pos = array<vec2<f32>, 3>(
    vec2<f32>(-1.0, -1.0),
    vec2<f32>( 3.0, -1.0),
    vec2<f32>(-1.0,  3.0)
  );
  var out : FullscreenOut;
  let p = pos[vid];
  out.clipPos = vec4<f32>(p, 0.0, 1.0);
  out.uv = vec2<f32>(p.x * 0.5 + 0.5, 0.5 - p.y * 0.5);
  return out;
}

fn linearizeDepth(d : f32) -> f32 {
  let nearP = uPost.projParams.x;
  let farP = uPost.projParams.y;
  return (nearP * farP) / max(farP - d * (farP - nearP), 0.0001);
}

fn sampleDepthAtUV(uv : vec2<f32>) -> f32 {
  let dims = vec2<i32>(textureDimensions(depthTex, 0));
  let coord = clamp(vec2<i32>(uv * vec2<f32>(dims)), vec2<i32>(0), dims - vec2<i32>(1));
  return textureLoad(depthTex, coord, 0);
}

// ---------------------------------------------------------------------------
// Pass 4: Half-Res Screen-Space Horizon Ambient Occlusion (SSAO)
// Disocclusion-safe thickness rejection prevents foreground actors from
// casting dark screen-space silhouettes onto distant background surfaces.
// ---------------------------------------------------------------------------
@fragment
fn fsSSAO(in : FullscreenOut) -> @location(0) vec4<f32> {
  let centerRaw = sampleDepthAtUV(in.uv);
  if (centerRaw >= 0.9998) {
    return vec4<f32>(1.0, 1.0, 1.0, 1.0);
  }
  let centerZ = linearizeDepth(centerRaw);
  let texel = 1.0 / max(uPost.screenSize.xy, vec2<f32>(1.0));

  // 8-tap rotating spiral kernel in screen space; world-space radius ~0.45m
  let angNoise = fract(sin(dot(floor(in.uv * uPost.screenSize.xy * 0.5), vec2<f32>(12.9898, 78.233))) * 43758.5453) * 6.283185;
  let radiusPx = clamp((uPost.projParams.z * 2.4) / max(centerZ, 2.2), 3.0, 14.0);
  let maxThickness = clamp(0.32 + centerZ * 0.022, 0.35, 0.90);
  let minBias = 0.025 + centerZ * 0.002;

  var occ = 0.0;
  for (var i = 0; i < 8; i = i + 1) {
    let a = angNoise + f32(i) * 0.785398;
    let r = radiusPx * (0.30 + 0.70 * (f32(i % 4) / 3.0));
    let off = vec2<f32>(cos(a), sin(a)) * r * texel;
    let sRaw = sampleDepthAtUV(clamp(in.uv + off, vec2<f32>(0.001), vec2<f32>(0.999)));
    if (sRaw >= 0.9998) {
      continue;
    }
    let sZ = linearizeDepth(sRaw);
    let dz = centerZ - sZ;
    if (dz > minBias && dz < maxThickness) {
      let rangeCheck = smoothstep(maxThickness, minBias * 1.5, dz);
      occ += rangeCheck;
    }
  }
  let ao = clamp(1.0 - (occ / 8.0) * uPost.projParams.w, 0.42, 1.0);
  return vec4<f32>(ao, ao, ao, 1.0);
}

// ---------------------------------------------------------------------------
// Pass 5: Quarter-Res HDR Bloom Bright-Pass Threshold
// ---------------------------------------------------------------------------
@fragment
fn fsBloomThreshold(in : FullscreenOut) -> @location(0) vec4<f32> {
  let texel = 1.0 / max(uPost.screenSize.xy, vec2<f32>(1.0));
  let c0 = textureSample(texA, texLinearSampler, in.uv).rgb;
  let c1 = textureSample(texA, texLinearSampler, in.uv + vec2<f32>( texel.x,  texel.y)).rgb;
  let c2 = textureSample(texA, texLinearSampler, in.uv + vec2<f32>(-texel.x,  texel.y)).rgb;
  let c3 = textureSample(texA, texLinearSampler, in.uv + vec2<f32>( texel.x, -texel.y)).rgb;
  let c4 = textureSample(texA, texLinearSampler, in.uv + vec2<f32>(-texel.x, -texel.y)).rgb;
  let hdr = (c0 * 0.4 + (c1 + c2 + c3 + c4) * 0.15);

  let lum = dot(hdr, vec3<f32>(0.2126, 0.7152, 0.0722));
  let thresh = uPost.screenSize.z;
  let soft = clamp(lum - thresh, 0.0, 6.0);
  let contrib = soft / max(lum, 0.0001);
  return vec4<f32>(hdr * contrib, 1.0);
}

// ---------------------------------------------------------------------------
// Pass 6: Separable 9-Tap Gaussian Bloom Blur (H & V via texel direction)
// ---------------------------------------------------------------------------
@fragment
fn fsBloomBlurH(in : FullscreenOut) -> @location(0) vec4<f32> {
  let texel = vec2<f32>(4.0 / max(uPost.screenSize.x, 1.0), 0.0);
  let w = array<f32, 5>(0.227027, 0.1945946, 0.1216216, 0.054054, 0.016216);
  var sum = textureSample(texA, texLinearSampler, in.uv).rgb * w[0];
  for (var i = 1; i < 5; i = i + 1) {
    let off = texel * f32(i);
    sum += textureSample(texA, texLinearSampler, in.uv + off).rgb * w[i];
    sum += textureSample(texA, texLinearSampler, in.uv - off).rgb * w[i];
  }
  return vec4<f32>(sum, 1.0);
}

@fragment
fn fsBloomBlurV(in : FullscreenOut) -> @location(0) vec4<f32> {
  let texel = vec2<f32>(0.0, 4.0 / max(uPost.screenSize.y, 1.0));
  let w = array<f32, 5>(0.227027, 0.1945946, 0.1216216, 0.054054, 0.016216);
  var sum = textureSample(texA, texLinearSampler, in.uv).rgb * w[0];
  for (var i = 1; i < 5; i = i + 1) {
    let off = texel * f32(i);
    sum += textureSample(texA, texLinearSampler, in.uv + off).rgb * w[i];
    sum += textureSample(texA, texLinearSampler, in.uv - off).rgb * w[i];
  }
  return vec4<f32>(sum, 1.0);
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
// Pass 7: HDR + Depth-Aware Bilateral SSAO + Bloom Composite + ACES Tonemap
// ---------------------------------------------------------------------------
@fragment
fn fsComposite(in : FullscreenOut) -> @location(0) vec4<f32> {
  let hdr = textureSample(texA, texLinearSampler, in.uv).rgb;
  let bloom = textureSample(texB, texLinearSampler, in.uv).rgb;

  // Depth-aware bilateral 5-tap upsample of half-res SSAO so character silhouettes never bleed onto background
  let centerRaw = sampleDepthAtUV(in.uv);
  var ao = 1.0;
  if (centerRaw < 0.9998) {
    let centerZ = linearizeDepth(centerRaw);
    let ssaoTexel = 2.0 / max(uPost.screenSize.xy, vec2<f32>(1.0));
    let offs = array<vec2<f32>, 5>(
      vec2<f32>(0.0, 0.0),
      vec2<f32>( ssaoTexel.x, 0.0),
      vec2<f32>(-ssaoTexel.x, 0.0),
      vec2<f32>(0.0,  ssaoTexel.y),
      vec2<f32>(0.0, -ssaoTexel.y)
    );
    let baseW = array<f32, 5>(0.40, 0.15, 0.15, 0.15, 0.15);
    var aoSum = 0.0;
    var wSum = 0.0;
    for (var i = 0; i < 5; i = i + 1) {
      let suv = clamp(in.uv + offs[i], vec2<f32>(0.001), vec2<f32>(0.999));
      let sAo = textureSample(texSSAO, texLinearSampler, suv).r;
      let sRaw = sampleDepthAtUV(suv);
      let sZ = linearizeDepth(sRaw);
      let depthDiff = abs(sZ - centerZ) / max(1.0, centerZ * 0.12);
      let bw = baseW[i] * exp(-depthDiff * 8.0);
      aoSum += sAo * bw;
      wSum += bw;
    }
    ao = select(1.0, aoSum / wSum, wSum > 1e-4);
  }

  let lum = dot(hdr, vec3<f32>(0.2126, 0.7152, 0.0722));
  let aoMask = mix(ao, 1.0, smoothstep(0.55, 1.35, lum));
  let hdrOut = hdr * aoMask + bloom * uPost.screenSize.w;

  // Subtle cinematic edge vignette
  let d = length(in.uv - vec2<f32>(0.5));
  let vig = 1.0 - smoothstep(0.48, 0.92, d) * 0.16;

  let mapped = acesTonemap(hdrOut * vig);
  let gamma = pow(mapped, vec3<f32>(1.0 / 2.2));
  return vec4<f32>(gamma, 1.0);
}
