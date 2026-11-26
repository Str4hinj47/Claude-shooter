struct FrameUniforms {
  viewProj : mat4x4<f32>,
  camPos   : vec4<f32>,
  sunDir   : vec4<f32>,
  sunColor : vec4<f32>,
  fogColor : vec4<f32>,
};

@group(0) @binding(0) var<uniform> uFrame : FrameUniforms;

struct TerrainVSIn {
  @location(0) pos    : vec3<f32>,
  @location(1) normal : vec3<f32>,
  @location(2) color  : vec3<f32>,
};

struct InstancedVSIn {
  @location(0) pos      : vec3<f32>,
  @location(1) normal   : vec3<f32>,
  @location(2) instPos  : vec3<f32>,
  @location(3) instSize : vec3<f32>,
  @location(4) instRotY : f32,
  @location(5) instCol  : vec3<f32>,
};

struct VSOut {
  @builtin(position) clipPos : vec4<f32>,
  @location(0) worldPos      : vec3<f32>,
  @location(1) normal        : vec3<f32>,
  @location(2) color         : vec3<f32>,
  @location(3) isInstanced   : f32,
};

@vertex
fn vsTerrain(in : TerrainVSIn) -> VSOut {
  var out : VSOut;
  out.clipPos = uFrame.viewProj * vec4<f32>(in.pos, 1.0);
  out.worldPos = in.pos;
  out.normal = normalize(in.normal);
  out.color = in.color;
  out.isInstanced = 0.0;
  return out;
}

@vertex
fn vsInstanced(in : InstancedVSIn) -> VSOut {
  let c = cos(in.instRotY);
  let s = sin(in.instRotY);
  let scaled = in.pos * in.instSize;
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
  out.normal = rotNorm;
  out.color = in.instCol;
  out.isInstanced = 1.0;
  return out;
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
  let N = normalize(in.normal);
  let L = normalize(uFrame.sunDir.xyz);
  let V = normalize(uFrame.camPos.xyz - in.worldPos);
  let H = normalize(L + V);

  var albedo = in.color;
  // Architectural window grid sheen on tall buildings
  if (in.isInstanced > 0.5 && abs(N.y) < 0.35 && in.worldPos.y > 4.0) {
    let gridX = fract(in.worldPos.x * 0.28 + in.worldPos.z * 0.28);
    let gridY = fract(in.worldPos.y * 0.26);
    if (gridX > 0.16 && gridX < 0.84 && gridY > 0.22 && gridY < 0.82) {
      albedo = mix(albedo, vec3<f32>(0.14, 0.22, 0.30), 0.55);
    }
  }

  let ndotl = max(dot(N, L), 0.0);
  let hemi = 0.5 + 0.5 * N.y;
  let skyAmbient = mix(vec3<f32>(0.22, 0.20, 0.18), vec3<f32>(0.42, 0.58, 0.78), hemi) * 0.62;
  let spec = pow(max(dot(N, H), 0.0), 32.0) * 0.18;

  var lit = albedo * (skyAmbient + uFrame.sunColor.rgb * ndotl) + uFrame.sunColor.rgb * spec;

  // Exponential distance atmospheric fog
  let dist = length(uFrame.camPos.xyz - in.worldPos);
  let fogFactor = 1.0 - exp(-dist * 0.00072);
  lit = mix(lit, uFrame.fogColor.rgb, clamp(fogFactor, 0.0, 0.92));

  let mapped = acesTonemap(lit);
  let gamma = pow(mapped, vec3<f32>(1.0 / 2.2));
  return vec4<f32>(gamma, 1.0);
}
