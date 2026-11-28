#include "westgate/WorldRenderer.hpp"
#include "imgui.h"
#include "imgui_impl_wgpu.h"
#include <algorithm>
#include <cctype>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <cstring>
#include <filesystem>
#include <fstream>
#include <glm/gtc/matrix_transform.hpp>
#include <glm/gtc/quaternion.hpp>
#include <sstream>
#include <string>
#include <unordered_map>
#include <vector>

namespace westgate {

namespace {

constexpr uint32_t kShadowMapSize = 2048;

InstanceAttrib makeInst(
  float x, float y, float z,
  float sx, float sy, float sz,
  const glm::quat& q,
  float r, float g, float b,
  float emissive = 0.0f
) {
  return InstanceAttrib{x, y, z, sx, sy, sz, q.x, q.y, q.z, q.w, r, g, b, emissive};
}

InstanceAttrib makeInstYaw(
  float x, float y, float z,
  float sx, float sy, float sz,
  float yawRad,
  float r, float g, float b,
  float emissive = 0.0f
) {
  const glm::quat q = glm::angleAxis(yawRad, glm::vec3(0.0f, 1.0f, 0.0f));
  return makeInst(x, y, z, sx, sy, sz, q, r, g, b, emissive);
}

struct StaticVertex {
  float px, py, pz;
  float nx, ny, nz;
  float r, g, b;
  float u, v;
  float kind;
};

struct ModelVertex {
  float px, py, pz;
  float nx, ny, nz;
  float u, v;
  float r, g, b;
  float metallic, roughness;
};

struct SkinnedVertex {
  float px, py, pz;
  float nx, ny, nz;
  float u, v;
  float r, g, b;
  uint32_t j0, j1, j2, j3;
  float w0, w1, w2, w3;
};

std::string loadTextFile(const std::string& path) {
  std::ifstream f(path);
  if (!f) return {};
  std::ostringstream ss;
  ss << f.rdbuf();
  return ss.str();
}

WGPUBuffer createBufferWithData(WGPUDevice dev, WGPUQueue queue, WGPUBufferUsage usage, const void* data, size_t sizeBytes) {
  const size_t aligned = (sizeBytes + 3u) & ~size_t(3u);
  WGPUBufferDescriptor desc = WGPU_BUFFER_DESCRIPTOR_INIT;
  desc.usage = usage | WGPUBufferUsage_CopyDst;
  desc.size = aligned > 0 ? aligned : 16;
  WGPUBuffer buf = wgpuDeviceCreateBuffer(dev, &desc);
  if (data && sizeBytes > 0) {
    wgpuQueueWriteBuffer(queue, buf, 0, data, sizeBytes);
  }
  return buf;
}

void appendBox(
  std::vector<glm::vec3>& outPos,
  std::vector<glm::vec3>& outNorm,
  std::vector<glm::vec3>& outCol,
  std::vector<uint32_t>& outIdx,
  const glm::vec3& center,
  const glm::vec3& size,
  const glm::vec3& color
) {
  const glm::vec3 hs = size * 0.5f;
  const uint32_t base = static_cast<uint32_t>(outPos.size());
  const glm::vec3 verts[24] = {
    {-hs.x, -hs.y,  hs.z}, { hs.x, -hs.y,  hs.z}, { hs.x,  hs.y,  hs.z}, {-hs.x,  hs.y,  hs.z},
    { hs.x, -hs.y, -hs.z}, {-hs.x, -hs.y, -hs.z}, {-hs.x,  hs.y, -hs.z}, { hs.x,  hs.y, -hs.z},
    { hs.x, -hs.y,  hs.z}, { hs.x, -hs.y, -hs.z}, { hs.x,  hs.y, -hs.z}, { hs.x,  hs.y,  hs.z},
    {-hs.x, -hs.y, -hs.z}, {-hs.x, -hs.y,  hs.z}, {-hs.x,  hs.y,  hs.z}, {-hs.x,  hs.y, -hs.z},
    {-hs.x,  hs.y,  hs.z}, { hs.x,  hs.y,  hs.z}, { hs.x,  hs.y, -hs.z}, {-hs.x,  hs.y, -hs.z},
    {-hs.x, -hs.y, -hs.z}, { hs.x, -hs.y, -hs.z}, { hs.x, -hs.y,  hs.z}, {-hs.x, -hs.y,  hs.z},
  };
  const glm::vec3 norms[6] = {
    {0, 0, 1}, {0, 0, -1}, {1, 0, 0}, {-1, 0, 0}, {0, 1, 0}, {0, -1, 0}
  };
  for (int f = 0; f < 6; ++f) {
    for (int k = 0; k < 4; ++k) {
      outPos.push_back(center + verts[f * 4 + k]);
      outNorm.push_back(norms[f]);
      outCol.push_back(color);
    }
    const uint32_t fb = base + static_cast<uint32_t>(f * 4);
    outIdx.push_back(fb + 0);
    outIdx.push_back(fb + 1);
    outIdx.push_back(fb + 2);
    outIdx.push_back(fb + 0);
    outIdx.push_back(fb + 2);
    outIdx.push_back(fb + 3);
  }
}

} // namespace

WorldRenderer::GpuTextureBinding WorldRenderer::createRgbaTexture(
  WgpuContext& ctx,
  uint32_t w,
  uint32_t h,
  const uint8_t* rgba8
) {
  GpuTextureBinding out{};
  WGPUTextureDescriptor td = WGPU_TEXTURE_DESCRIPTOR_INIT;
  td.usage = WGPUTextureUsage_TextureBinding | WGPUTextureUsage_CopyDst;
  td.dimension = WGPUTextureDimension_2D;
  td.size = {w, h, 1};
  td.format = WGPUTextureFormat_RGBA8Unorm;
  td.mipLevelCount = 1;
  td.sampleCount = 1;
  out.texture = wgpuDeviceCreateTexture(ctx.device(), &td);

  WGPUTexelCopyTextureInfo dst{};
  dst.texture = out.texture;
  dst.mipLevel = 0;
  dst.origin = {0, 0, 0};
  dst.aspect = WGPUTextureAspect_All;

  WGPUTexelCopyBufferLayout layout{};
  layout.offset = 0;
  layout.bytesPerRow = w * 4;
  layout.rowsPerImage = h;
  WGPUExtent3D ext{w, h, 1};
  wgpuQueueWriteTexture(ctx.queue(), &dst, rgba8, static_cast<size_t>(w) * h * 4, &layout, &ext);

  WGPUTextureViewDescriptor tvd = WGPU_TEXTURE_VIEW_DESCRIPTOR_INIT;
  tvd.format = WGPUTextureFormat_RGBA8Unorm;
  tvd.dimension = WGPUTextureViewDimension_2D;
  tvd.mipLevelCount = 1;
  tvd.arrayLayerCount = 1;
  tvd.aspect = WGPUTextureAspect_All;
  out.view = wgpuTextureCreateView(out.texture, &tvd);

  WGPUBindGroupEntry entries[2]{};
  entries[0] = WGPU_BIND_GROUP_ENTRY_INIT;
  entries[0].binding = 0;
  entries[0].textureView = out.view;
  entries[1] = WGPU_BIND_GROUP_ENTRY_INIT;
  entries[1].binding = 1;
  entries[1].sampler = linearSampler_;

  WGPUBindGroupDescriptor bgd = WGPU_BIND_GROUP_DESCRIPTOR_INIT;
  bgd.layout = matBgl_;
  bgd.entryCount = 2;
  bgd.entries = entries;
  out.bindGroup = wgpuDeviceCreateBindGroup(ctx.device(), &bgd);
  return out;
}

bool WorldRenderer::init(
  WgpuContext& ctx,
  const WorldData& world,
  const std::string& shaderPath,
  const WorldRenderAssets& assets,
  std::string* err
) {
  const std::string wgsl = loadTextFile(shaderPath);
  if (wgsl.empty()) {
    if (err) *err = "Failed to load WGSL shader: " + shaderPath;
    return false;
  }

  WGPUShaderSourceWGSL wgslSource = WGPU_SHADER_SOURCE_WGSL_INIT;
  wgslSource.code = {wgsl.c_str(), wgsl.size()};
  WGPUShaderModuleDescriptor smDesc = WGPU_SHADER_MODULE_DESCRIPTOR_INIT;
  smDesc.nextInChain = &wgslSource.chain;
  shader_ = wgpuDeviceCreateShaderModule(ctx.device(), &smDesc);
  if (!shader_) {
    if (err) *err = "wgpuDeviceCreateShaderModule failed";
    return false;
  }

  const std::string postPath = (std::filesystem::path(shaderPath).parent_path() / "post.wgsl").string();
  const std::string postWgsl = loadTextFile(postPath);
  if (postWgsl.empty()) {
    if (err) *err = "Failed to load post.wgsl shader: " + postPath;
    return false;
  }
  WGPUShaderSourceWGSL postSource = WGPU_SHADER_SOURCE_WGSL_INIT;
  postSource.code = {postWgsl.c_str(), postWgsl.size()};
  WGPUShaderModuleDescriptor postSmDesc = WGPU_SHADER_MODULE_DESCRIPTOR_INIT;
  postSmDesc.nextInChain = &postSource.chain;
  postShader_ = wgpuDeviceCreateShaderModule(ctx.device(), &postSmDesc);
  if (!postShader_) {
    if (err) *err = "wgpuDeviceCreateShaderModule (post.wgsl) failed";
    return false;
  }

  // Samplers & 2-Cascade Shadow Map Texture Array (2048x2048x2)
  {
    WGPUTextureDescriptor std = WGPU_TEXTURE_DESCRIPTOR_INIT;
    std.usage = WGPUTextureUsage_RenderAttachment | WGPUTextureUsage_TextureBinding;
    std.dimension = WGPUTextureDimension_2D;
    std.size = {kShadowMapSize, kShadowMapSize, 2};
    std.format = WGPUTextureFormat_Depth32Float;
    std.mipLevelCount = 1;
    std.sampleCount = 1;
    shadowTex_ = wgpuDeviceCreateTexture(ctx.device(), &std);

    for (uint32_t layer = 0; layer < 2; ++layer) {
      WGPUTextureViewDescriptor lvd = WGPU_TEXTURE_VIEW_DESCRIPTOR_INIT;
      lvd.format = WGPUTextureFormat_Depth32Float;
      lvd.dimension = WGPUTextureViewDimension_2D;
      lvd.baseMipLevel = 0;
      lvd.mipLevelCount = 1;
      lvd.baseArrayLayer = layer;
      lvd.arrayLayerCount = 1;
      lvd.aspect = WGPUTextureAspect_DepthOnly;
      shadowLayerViews_[layer] = wgpuTextureCreateView(shadowTex_, &lvd);
    }

    WGPUTextureViewDescriptor avd = WGPU_TEXTURE_VIEW_DESCRIPTOR_INIT;
    avd.format = WGPUTextureFormat_Depth32Float;
    avd.dimension = WGPUTextureViewDimension_2DArray;
    avd.baseMipLevel = 0;
    avd.mipLevelCount = 1;
    avd.baseArrayLayer = 0;
    avd.arrayLayerCount = 2;
    avd.aspect = WGPUTextureAspect_DepthOnly;
    shadowArrayView_ = wgpuTextureCreateView(shadowTex_, &avd);

    WGPUSamplerDescriptor ssd = WGPU_SAMPLER_DESCRIPTOR_INIT;
    ssd.addressModeU = WGPUAddressMode_ClampToEdge;
    ssd.addressModeV = WGPUAddressMode_ClampToEdge;
    ssd.addressModeW = WGPUAddressMode_ClampToEdge;
    ssd.magFilter = WGPUFilterMode_Linear;
    ssd.minFilter = WGPUFilterMode_Linear;
    ssd.mipmapFilter = WGPUMipmapFilterMode_Nearest;
    ssd.compare = WGPUCompareFunction_LessEqual;
    shadowSampler_ = wgpuDeviceCreateSampler(ctx.device(), &ssd);

    WGPUSamplerDescriptor lsd = WGPU_SAMPLER_DESCRIPTOR_INIT;
    lsd.addressModeU = WGPUAddressMode_ClampToEdge;
    lsd.addressModeV = WGPUAddressMode_ClampToEdge;
    lsd.addressModeW = WGPUAddressMode_ClampToEdge;
    lsd.magFilter = WGPUFilterMode_Linear;
    lsd.minFilter = WGPUFilterMode_Linear;
    lsd.mipmapFilter = WGPUMipmapFilterMode_Linear;
    linearSampler_ = wgpuDeviceCreateSampler(ctx.device(), &lsd);
  }

  frameUbo_ = createBufferWithData(ctx.device(), ctx.queue(), WGPUBufferUsage_Uniform, nullptr, sizeof(FrameUniforms));
  postUbo_ = createBufferWithData(ctx.device(), ctx.queue(), WGPUBufferUsage_Uniform, nullptr, sizeof(PostUniforms));

  // @group(0): FrameUniforms only (shared safely between Shadow Pass & Forward Pass)
  {
    WGPUBindGroupLayoutEntry entry = WGPU_BIND_GROUP_LAYOUT_ENTRY_INIT;
    entry.binding = 0;
    entry.visibility = WGPUShaderStage_Vertex | WGPUShaderStage_Fragment;
    entry.buffer.type = WGPUBufferBindingType_Uniform;
    entry.buffer.minBindingSize = sizeof(FrameUniforms);

    WGPUBindGroupLayoutDescriptor bglDesc = WGPU_BIND_GROUP_LAYOUT_DESCRIPTOR_INIT;
    bglDesc.entryCount = 1;
    bglDesc.entries = &entry;
    frameBgl_ = wgpuDeviceCreateBindGroupLayout(ctx.device(), &bglDesc);

    WGPUBindGroupEntry bgEntry = WGPU_BIND_GROUP_ENTRY_INIT;
    bgEntry.binding = 0;
    bgEntry.buffer = frameUbo_;
    bgEntry.offset = 0;
    bgEntry.size = sizeof(FrameUniforms);

    WGPUBindGroupDescriptor bgDesc = WGPU_BIND_GROUP_DESCRIPTOR_INIT;
    bgDesc.layout = frameBgl_;
    bgDesc.entryCount = 1;
    bgDesc.entries = &bgEntry;
    frameBg_ = wgpuDeviceCreateBindGroup(ctx.device(), &bgDesc);
  }

  // @group(3): 2-Cascade shadowMap (2DArray) + shadowSampler (Forward Pass only)
  {
    WGPUBindGroupLayoutEntry entries[2]{};
    entries[0] = WGPU_BIND_GROUP_LAYOUT_ENTRY_INIT;
    entries[0].binding = 0;
    entries[0].visibility = WGPUShaderStage_Fragment;
    entries[0].texture.sampleType = WGPUTextureSampleType_Depth;
    entries[0].texture.viewDimension = WGPUTextureViewDimension_2DArray;

    entries[1] = WGPU_BIND_GROUP_LAYOUT_ENTRY_INIT;
    entries[1].binding = 1;
    entries[1].visibility = WGPUShaderStage_Fragment;
    entries[1].sampler.type = WGPUSamplerBindingType_Comparison;

    WGPUBindGroupLayoutDescriptor bglDesc = WGPU_BIND_GROUP_LAYOUT_DESCRIPTOR_INIT;
    bglDesc.entryCount = 2;
    bglDesc.entries = entries;
    shadowReadBgl_ = wgpuDeviceCreateBindGroupLayout(ctx.device(), &bglDesc);

    WGPUBindGroupEntry bgEntries[2]{};
    bgEntries[0] = WGPU_BIND_GROUP_ENTRY_INIT;
    bgEntries[0].binding = 0;
    bgEntries[0].textureView = shadowArrayView_;
    bgEntries[1] = WGPU_BIND_GROUP_ENTRY_INIT;
    bgEntries[1].binding = 1;
    bgEntries[1].sampler = shadowSampler_;

    WGPUBindGroupDescriptor bgDesc = WGPU_BIND_GROUP_DESCRIPTOR_INIT;
    bgDesc.layout = shadowReadBgl_;
    bgDesc.entryCount = 2;
    bgDesc.entries = bgEntries;
    shadowReadBg_ = wgpuDeviceCreateBindGroup(ctx.device(), &bgDesc);
  }

  // @group(1): SkinUniforms
  {
    WGPUBindGroupLayoutEntry entry = WGPU_BIND_GROUP_LAYOUT_ENTRY_INIT;
    entry.binding = 0;
    entry.visibility = WGPUShaderStage_Vertex;
    entry.buffer.type = WGPUBufferBindingType_Uniform;
    entry.buffer.minBindingSize = sizeof(SkinUniforms);

    WGPUBindGroupLayoutDescriptor bglDesc = WGPU_BIND_GROUP_LAYOUT_DESCRIPTOR_INIT;
    bglDesc.entryCount = 1;
    bglDesc.entries = &entry;
    skinBgl_ = wgpuDeviceCreateBindGroupLayout(ctx.device(), &bglDesc);

    SkinUniforms defaultSkin{};
    defaultSkin.model = glm::mat4(1.0f);
    defaultSkin.tint = glm::vec4(1.0f);
    defaultSkin.bones.fill(glm::mat4(1.0f));
    for (uint32_t i = 0; i < kMaxSkinSlots; ++i) {
      skinSlots_[i].ubo = createBufferWithData(ctx.device(), ctx.queue(), WGPUBufferUsage_Uniform, &defaultSkin, sizeof(SkinUniforms));
      WGPUBindGroupEntry bgEntry = WGPU_BIND_GROUP_ENTRY_INIT;
      bgEntry.binding = 0;
      bgEntry.buffer = skinSlots_[i].ubo;
      bgEntry.offset = 0;
      bgEntry.size = sizeof(SkinUniforms);
      WGPUBindGroupDescriptor bgDesc = WGPU_BIND_GROUP_DESCRIPTOR_INIT;
      bgDesc.layout = skinBgl_;
      bgDesc.entryCount = 1;
      bgDesc.entries = &bgEntry;
      skinSlots_[i].bindGroup = wgpuDeviceCreateBindGroup(ctx.device(), &bgDesc);
    }
  }

  // @group(2): Albedo texture + sampler
  {
    WGPUBindGroupLayoutEntry entries[2]{};
    entries[0] = WGPU_BIND_GROUP_LAYOUT_ENTRY_INIT;
    entries[0].binding = 0;
    entries[0].visibility = WGPUShaderStage_Fragment;
    entries[0].texture.sampleType = WGPUTextureSampleType_Float;
    entries[0].texture.viewDimension = WGPUTextureViewDimension_2D;

    entries[1] = WGPU_BIND_GROUP_LAYOUT_ENTRY_INIT;
    entries[1].binding = 1;
    entries[1].visibility = WGPUShaderStage_Fragment;
    entries[1].sampler.type = WGPUSamplerBindingType_Filtering;

    WGPUBindGroupLayoutDescriptor bglDesc = WGPU_BIND_GROUP_LAYOUT_DESCRIPTOR_INIT;
    bglDesc.entryCount = 2;
    bglDesc.entries = entries;
    matBgl_ = wgpuDeviceCreateBindGroupLayout(ctx.device(), &bglDesc);

    const uint8_t white[4] = {255, 255, 255, 255};
    defaultWhiteTex_ = createRgbaTexture(ctx, 1, 1, white);
  }

  // Pipeline layouts
  {
    WGPUPipelineLayoutDescriptor pld = WGPU_PIPELINE_LAYOUT_DESCRIPTOR_INIT;
    pld.bindGroupLayoutCount = 1;
    pld.bindGroupLayouts = &frameBgl_;
    shadowStaticPipeLayout_ = wgpuDeviceCreatePipelineLayout(ctx.device(), &pld);

    WGPUBindGroupLayout bgls2[2] = {frameBgl_, skinBgl_};
    pld.bindGroupLayoutCount = 2;
    pld.bindGroupLayouts = bgls2;
    shadowSkinnedPipeLayout_ = wgpuDeviceCreatePipelineLayout(ctx.device(), &pld);

    WGPUBindGroupLayout bgls4[4] = {frameBgl_, skinBgl_, matBgl_, shadowReadBgl_};
    pld.bindGroupLayoutCount = 4;
    pld.bindGroupLayouts = bgls4;
    scenePipeLayout_ = wgpuDeviceCreatePipelineLayout(ctx.device(), &pld);
  }

  // Post-FX bind group layout (@group(0): uPost, texA, texB, linearSampler, depthTex, texSSAO)
  {
    WGPUBindGroupLayoutEntry pe[6]{};
    pe[0] = WGPU_BIND_GROUP_LAYOUT_ENTRY_INIT;
    pe[0].binding = 0;
    pe[0].visibility = WGPUShaderStage_Fragment;
    pe[0].buffer.type = WGPUBufferBindingType_Uniform;
    pe[0].buffer.minBindingSize = sizeof(PostUniforms);

    pe[1] = WGPU_BIND_GROUP_LAYOUT_ENTRY_INIT;
    pe[1].binding = 1;
    pe[1].visibility = WGPUShaderStage_Fragment;
    pe[1].texture.sampleType = WGPUTextureSampleType_Float;
    pe[1].texture.viewDimension = WGPUTextureViewDimension_2D;

    pe[2] = WGPU_BIND_GROUP_LAYOUT_ENTRY_INIT;
    pe[2].binding = 2;
    pe[2].visibility = WGPUShaderStage_Fragment;
    pe[2].texture.sampleType = WGPUTextureSampleType_Float;
    pe[2].texture.viewDimension = WGPUTextureViewDimension_2D;

    pe[3] = WGPU_BIND_GROUP_LAYOUT_ENTRY_INIT;
    pe[3].binding = 3;
    pe[3].visibility = WGPUShaderStage_Fragment;
    pe[3].sampler.type = WGPUSamplerBindingType_Filtering;

    pe[4] = WGPU_BIND_GROUP_LAYOUT_ENTRY_INIT;
    pe[4].binding = 4;
    pe[4].visibility = WGPUShaderStage_Fragment;
    pe[4].texture.sampleType = WGPUTextureSampleType_Depth;
    pe[4].texture.viewDimension = WGPUTextureViewDimension_2D;

    pe[5] = WGPU_BIND_GROUP_LAYOUT_ENTRY_INIT;
    pe[5].binding = 5;
    pe[5].visibility = WGPUShaderStage_Fragment;
    pe[5].texture.sampleType = WGPUTextureSampleType_Float;
    pe[5].texture.viewDimension = WGPUTextureViewDimension_2D;

    WGPUBindGroupLayoutDescriptor pbgl = WGPU_BIND_GROUP_LAYOUT_DESCRIPTOR_INIT;
    pbgl.entryCount = 6;
    pbgl.entries = pe;
    postBgl_ = wgpuDeviceCreateBindGroupLayout(ctx.device(), &pbgl);

    WGPUPipelineLayoutDescriptor ppld = WGPU_PIPELINE_LAYOUT_DESCRIPTOR_INIT;
    ppld.bindGroupLayoutCount = 1;
    ppld.bindGroupLayouts = &postBgl_;
    postPipeLayout_ = wgpuDeviceCreatePipelineLayout(ctx.device(), &ppld);
  }

  WGPUColorTargetState hdrColorTarget = WGPU_COLOR_TARGET_STATE_INIT;
  hdrColorTarget.format = WGPUTextureFormat_RGBA16Float;
  hdrColorTarget.writeMask = WGPUColorWriteMask_All;

  WGPUColorTargetState swapColorTarget = WGPU_COLOR_TARGET_STATE_INIT;
  swapColorTarget.format = ctx.surfaceFormat();
  swapColorTarget.writeMask = WGPUColorWriteMask_All;

  WGPUColorTargetState ssaoColorTarget = WGPU_COLOR_TARGET_STATE_INIT;
  ssaoColorTarget.format = WGPUTextureFormat_RGBA8Unorm;
  ssaoColorTarget.writeMask = WGPUColorWriteMask_All;

  WGPUFragmentState fragState = WGPU_FRAGMENT_STATE_INIT;
  fragState.module = shader_;
  fragState.entryPoint = {"fsMain", 6};
  fragState.targetCount = 1;
  fragState.targets = &hdrColorTarget;

  WGPUDepthStencilState depthState = WGPU_DEPTH_STENCIL_STATE_INIT;
  depthState.format = ctx.depthFormat();
  depthState.depthWriteEnabled = WGPUOptionalBool_True;
  depthState.depthCompare = WGPUCompareFunction_Less;

  WGPUDepthStencilState shadowDepthState = WGPU_DEPTH_STENCIL_STATE_INIT;
  shadowDepthState.format = WGPUTextureFormat_Depth32Float;
  shadowDepthState.depthWriteEnabled = WGPUOptionalBool_True;
  shadowDepthState.depthCompare = WGPUCompareFunction_Less;

  // Vertex buffer layout definitions
  WGPUVertexAttribute terrainAttrs[4]{};
  terrainAttrs[0] = {nullptr, WGPUVertexFormat_Float32x3, offsetof(StaticVertex, px), 0};
  terrainAttrs[1] = {nullptr, WGPUVertexFormat_Float32x3, offsetof(StaticVertex, nx), 1};
  terrainAttrs[2] = {nullptr, WGPUVertexFormat_Float32x3, offsetof(StaticVertex, r), 2};
  terrainAttrs[3] = {nullptr, WGPUVertexFormat_Float32x3, offsetof(StaticVertex, u), 3};
  WGPUVertexBufferLayout terrainVbl = WGPU_VERTEX_BUFFER_LAYOUT_INIT;
  terrainVbl.stepMode = WGPUVertexStepMode_Vertex;
  terrainVbl.arrayStride = sizeof(StaticVertex);
  terrainVbl.attributeCount = 4;
  terrainVbl.attributes = terrainAttrs;

  WGPUVertexAttribute modelAttrs[5]{};
  modelAttrs[0] = {nullptr, WGPUVertexFormat_Float32x3, offsetof(ModelVertex, px), 0};
  modelAttrs[1] = {nullptr, WGPUVertexFormat_Float32x3, offsetof(ModelVertex, nx), 1};
  modelAttrs[2] = {nullptr, WGPUVertexFormat_Float32x2, offsetof(ModelVertex, u), 2};
  modelAttrs[3] = {nullptr, WGPUVertexFormat_Float32x3, offsetof(ModelVertex, r), 3};
  modelAttrs[4] = {nullptr, WGPUVertexFormat_Float32x2, offsetof(ModelVertex, metallic), 8};
  WGPUVertexAttribute instAttrs[4]{};
  instAttrs[0] = {nullptr, WGPUVertexFormat_Float32x3, offsetof(InstanceAttrib, x), 4};
  instAttrs[1] = {nullptr, WGPUVertexFormat_Float32x3, offsetof(InstanceAttrib, sx), 5};
  instAttrs[2] = {nullptr, WGPUVertexFormat_Float32x4, offsetof(InstanceAttrib, qx), 6};
  instAttrs[3] = {nullptr, WGPUVertexFormat_Float32x4, offsetof(InstanceAttrib, r), 7};
  WGPUVertexBufferLayout instVbls[2]{};
  instVbls[0] = WGPU_VERTEX_BUFFER_LAYOUT_INIT;
  instVbls[0].stepMode = WGPUVertexStepMode_Vertex;
  instVbls[0].arrayStride = sizeof(ModelVertex);
  instVbls[0].attributeCount = 5;
  instVbls[0].attributes = modelAttrs;
  instVbls[1] = WGPU_VERTEX_BUFFER_LAYOUT_INIT;
  instVbls[1].stepMode = WGPUVertexStepMode_Instance;
  instVbls[1].arrayStride = sizeof(InstanceAttrib);
  instVbls[1].attributeCount = 4;
  instVbls[1].attributes = instAttrs;

  WGPUVertexAttribute skinAttrs[6]{};
  skinAttrs[0] = {nullptr, WGPUVertexFormat_Float32x3, offsetof(SkinnedVertex, px), 0};
  skinAttrs[1] = {nullptr, WGPUVertexFormat_Float32x3, offsetof(SkinnedVertex, nx), 1};
  skinAttrs[2] = {nullptr, WGPUVertexFormat_Float32x2, offsetof(SkinnedVertex, u), 2};
  skinAttrs[3] = {nullptr, WGPUVertexFormat_Float32x3, offsetof(SkinnedVertex, r), 3};
  skinAttrs[4] = {nullptr, WGPUVertexFormat_Uint32x4, offsetof(SkinnedVertex, j0), 4};
  skinAttrs[5] = {nullptr, WGPUVertexFormat_Float32x4, offsetof(SkinnedVertex, w0), 5};
  WGPUVertexBufferLayout skinVbl = WGPU_VERTEX_BUFFER_LAYOUT_INIT;
  skinVbl.stepMode = WGPUVertexStepMode_Vertex;
  skinVbl.arrayStride = sizeof(SkinnedVertex);
  skinVbl.attributeCount = 6;
  skinVbl.attributes = skinAttrs;

  // 2-Cascade Shadow pipelines (depth-only, Near 52m + Far 260m)
  {
    WGPURenderPipelineDescriptor rp = WGPU_RENDER_PIPELINE_DESCRIPTOR_INIT;
    rp.layout = shadowStaticPipeLayout_;
    rp.vertex.module = shader_;
    rp.vertex.entryPoint = {"vsShadowTerrainNear", 19};
    rp.vertex.bufferCount = 1;
    rp.vertex.buffers = &terrainVbl;
    rp.fragment = nullptr;
    rp.depthStencil = &shadowDepthState;
    rp.primitive.topology = WGPUPrimitiveTopology_TriangleList;
    rp.primitive.cullMode = WGPUCullMode_Back;
    rp.primitive.frontFace = WGPUFrontFace_CCW;
    rp.multisample.count = 1;
    rp.multisample.mask = 0xFFFFFFFFu;
    shadowTerrainNearPipeline_ = wgpuDeviceCreateRenderPipeline(ctx.device(), &rp);

    rp.vertex.entryPoint = {"vsShadowTerrainFar", 18};
    shadowTerrainFarPipeline_ = wgpuDeviceCreateRenderPipeline(ctx.device(), &rp);

    rp.vertex.entryPoint = {"vsShadowInstancedNear", 21};
    rp.vertex.bufferCount = 2;
    rp.vertex.buffers = instVbls;
    shadowInstancedNearPipeline_ = wgpuDeviceCreateRenderPipeline(ctx.device(), &rp);

    rp.vertex.entryPoint = {"vsShadowInstancedFar", 20};
    shadowInstancedFarPipeline_ = wgpuDeviceCreateRenderPipeline(ctx.device(), &rp);

    rp.layout = shadowSkinnedPipeLayout_;
    rp.vertex.entryPoint = {"vsShadowSkinnedNear", 19};
    rp.vertex.bufferCount = 1;
    rp.vertex.buffers = &skinVbl;
    shadowSkinnedNearPipeline_ = wgpuDeviceCreateRenderPipeline(ctx.device(), &rp);

    rp.vertex.entryPoint = {"vsShadowSkinnedFar", 18};
    shadowSkinnedFarPipeline_ = wgpuDeviceCreateRenderPipeline(ctx.device(), &rp);
  }

  // HDR Scene Forward pipelines (RGBA16Float)
  {
    WGPUFragmentState skyFrag = WGPU_FRAGMENT_STATE_INIT;
    skyFrag.module = shader_;
    skyFrag.entryPoint = {"fsSky", 5};
    skyFrag.targetCount = 1;
    skyFrag.targets = &hdrColorTarget;

    WGPUDepthStencilState skyDepth = WGPU_DEPTH_STENCIL_STATE_INIT;
    skyDepth.format = ctx.depthFormat();
    skyDepth.depthWriteEnabled = WGPUOptionalBool_False;
    skyDepth.depthCompare = WGPUCompareFunction_LessEqual;

    WGPURenderPipelineDescriptor skyRp = WGPU_RENDER_PIPELINE_DESCRIPTOR_INIT;
    skyRp.layout = shadowStaticPipeLayout_;
    skyRp.vertex.module = shader_;
    skyRp.vertex.entryPoint = {"vsSky", 5};
    skyRp.vertex.bufferCount = 0;
    skyRp.vertex.buffers = nullptr;
    skyRp.fragment = &skyFrag;
    skyRp.depthStencil = &skyDepth;
    skyRp.primitive.topology = WGPUPrimitiveTopology_TriangleList;
    skyRp.primitive.cullMode = WGPUCullMode_None;
    skyRp.primitive.frontFace = WGPUFrontFace_CCW;
    skyRp.multisample.count = 1;
    skyRp.multisample.mask = 0xFFFFFFFFu;
    skyPipeline_ = wgpuDeviceCreateRenderPipeline(ctx.device(), &skyRp);

    WGPURenderPipelineDescriptor rp = WGPU_RENDER_PIPELINE_DESCRIPTOR_INIT;
    rp.layout = scenePipeLayout_;
    rp.vertex.module = shader_;
    rp.vertex.entryPoint = {"vsTerrain", 9};
    rp.vertex.bufferCount = 1;
    rp.vertex.buffers = &terrainVbl;
    rp.fragment = &fragState;
    rp.depthStencil = &depthState;
    rp.primitive.topology = WGPUPrimitiveTopology_TriangleList;
    rp.primitive.cullMode = WGPUCullMode_Back;
    rp.primitive.frontFace = WGPUFrontFace_CCW;
    rp.multisample.count = 1;
    rp.multisample.mask = 0xFFFFFFFFu;
    terrainPipeline_ = wgpuDeviceCreateRenderPipeline(ctx.device(), &rp);

    rp.vertex.entryPoint = {"vsInstanced", 11};
    rp.vertex.bufferCount = 2;
    rp.vertex.buffers = instVbls;
    instancedPipeline_ = wgpuDeviceCreateRenderPipeline(ctx.device(), &rp);

    rp.vertex.entryPoint = {"vsSkinned", 9};
    rp.vertex.bufferCount = 1;
    rp.vertex.buffers = &skinVbl;
    rp.primitive.cullMode = WGPUCullMode_None;
    skinnedPipeline_ = wgpuDeviceCreateRenderPipeline(ctx.device(), &rp);
  }

  // Post-FX Pipelines (SSAO, Bloom Threshold, Bloom H/V Blur, Composite Tonemap)
  {
    auto makePostPipe = [&](const char* fragEntry, const WGPUColorTargetState* target) {
      WGPUFragmentState fs = WGPU_FRAGMENT_STATE_INIT;
      fs.module = postShader_;
      fs.entryPoint = {fragEntry, std::strlen(fragEntry)};
      fs.targetCount = 1;
      fs.targets = target;

      WGPURenderPipelineDescriptor prp = WGPU_RENDER_PIPELINE_DESCRIPTOR_INIT;
      prp.layout = postPipeLayout_;
      prp.vertex.module = postShader_;
      prp.vertex.entryPoint = {"vsFullscreen", 12};
      prp.vertex.bufferCount = 0;
      prp.vertex.buffers = nullptr;
      prp.fragment = &fs;
      prp.depthStencil = nullptr;
      prp.primitive.topology = WGPUPrimitiveTopology_TriangleList;
      prp.primitive.cullMode = WGPUCullMode_None;
      prp.primitive.frontFace = WGPUFrontFace_CCW;
      prp.multisample.count = 1;
      prp.multisample.mask = 0xFFFFFFFFu;
      return wgpuDeviceCreateRenderPipeline(ctx.device(), &prp);
    };
    ssaoPipeline_ = makePostPipe("fsSSAO", &ssaoColorTarget);
    bloomThreshPipeline_ = makePostPipe("fsBloomThreshold", &hdrColorTarget);
    bloomBlurHPipeline_ = makePostPipe("fsBloomBlurH", &hdrColorTarget);
    bloomBlurVPipeline_ = makePostPipe("fsBloomBlurV", &hdrColorTarget);
    compositePipeline_ = makePostPipe("fsComposite", &swapColorTarget);
  }

  ensureOffscreenTargets(ctx);

  buildTerrainAndOceanBuffers(ctx, world);
  buildRoadAndArenaBuffers(ctx, world);
  buildPropAndVehicleBatches(ctx, world, assets.assetsRoot);

  if (assets.playerBody) buildSkinnedMesh(ctx, *assets.playerBody, playerBodyGpu_);
  if (assets.playerShorts) buildSkinnedMesh(ctx, *assets.playerShorts, playerShortsGpu_);
  if (assets.playerHair) buildSkinnedMesh(ctx, *assets.playerHair, playerHairGpu_);
  if (assets.businessModel) buildSkinnedMesh(ctx, *assets.businessModel, businessGpu_);
  if (assets.civilianModel) buildSkinnedMesh(ctx, *assets.civilianModel, civilianGpu_);
  if (assets.policeModel) buildSkinnedMesh(ctx, *assets.policeModel, policeGpu_);
  if (assets.securityModel) buildSkinnedMesh(ctx, *assets.securityModel, securityGpu_);

  return terrainPipeline_ != nullptr && instancedPipeline_ != nullptr && skinnedPipeline_ != nullptr;
}

void WorldRenderer::buildTerrainAndOceanBuffers(WgpuContext& ctx, const WorldData& world) {
  constexpr uint32_t N = 384;
  constexpr uint32_t WN = 96;
  std::vector<StaticVertex> verts;
  std::vector<uint32_t> indices;
  verts.reserve(N * N + WN * WN);
  indices.reserve((N - 1) * (N - 1) * 6 + (WN - 1) * (WN - 1) * 6);

  for (uint32_t iz = 0; iz < N; ++iz) {
    const float tz = static_cast<float>(iz) / static_cast<float>(N - 1);
    const float z = world.worldMin + tz * (world.worldMax - world.worldMin);
    for (uint32_t ix = 0; ix < N; ++ix) {
      const float tx = static_cast<float>(ix) / static_cast<float>(N - 1);
      const float x = world.worldMin + tx * (world.worldMax - world.worldMin);
      const float y = world.heightfield.sampleHeight(x, z);
      const glm::vec3 n = world.heightfield.sampleNormal(x, z);

      glm::vec3 col(0.22f, 0.35f, 0.19f);
      if (y < 0.8f) col = glm::vec3(0.68f, 0.62f, 0.46f);
      else if (n.y < 0.78f || y > 38.0f) col = glm::vec3(0.42f, 0.41f, 0.39f);
      else if (x > -420.0f && x < 340.0f && z > -420.0f && z < 480.0f) col = glm::vec3(0.28f, 0.30f, 0.32f);

      verts.push_back(StaticVertex{x, y, z, n.x, n.y, n.z, col.r, col.g, col.b, x * 0.05f, z * 0.05f, 0.0f});
    }
  }

  for (uint32_t iz = 0; iz < N - 1; ++iz) {
    for (uint32_t ix = 0; ix < N - 1; ++ix) {
      const uint32_t i0 = iz * N + ix;
      const uint32_t i1 = i0 + 1;
      const uint32_t i2 = i0 + N;
      const uint32_t i3 = i2 + 1;
      indices.push_back(i0);
      indices.push_back(i2);
      indices.push_back(i1);
      indices.push_back(i1);
      indices.push_back(i2);
      indices.push_back(i3);
    }
  }

  // Subdivided Ocean Water Grid at y = 0 (kind = 1.0, u = groundY for shoreline foam & shallow cove tint)
  const uint32_t wBase = static_cast<uint32_t>(verts.size());
  const float wExt = 1800.0f;
  for (uint32_t iz = 0; iz < WN; ++iz) {
    const float tz = static_cast<float>(iz) / static_cast<float>(WN - 1);
    const float z = -wExt + tz * (2.0f * wExt);
    for (uint32_t ix = 0; ix < WN; ++ix) {
      const float tx = static_cast<float>(ix) / static_cast<float>(WN - 1);
      const float x = -wExt + tx * (2.0f * wExt);
      const float groundY = world.heightfield.sampleHeight(x, z);
      verts.push_back(StaticVertex{x, 0.0f, z, 0.0f, 1.0f, 0.0f, 0.06f, 0.22f, 0.34f, groundY, tz, 1.0f});
    }
  }
  for (uint32_t iz = 0; iz < WN - 1; ++iz) {
    for (uint32_t ix = 0; ix < WN - 1; ++ix) {
      const uint32_t i0 = wBase + iz * WN + ix;
      const uint32_t i1 = i0 + 1;
      const uint32_t i2 = i0 + WN;
      const uint32_t i3 = i2 + 1;
      indices.push_back(i0);
      indices.push_back(i2);
      indices.push_back(i1);
      indices.push_back(i1);
      indices.push_back(i2);
      indices.push_back(i3);
    }
  }

  terrainIndexCount_ = static_cast<uint32_t>(indices.size());
  telemetry_.terrainTriangles = terrainIndexCount_ / 3;
  terrainVbo_ = createBufferWithData(ctx.device(), ctx.queue(), WGPUBufferUsage_Vertex, verts.data(), verts.size() * sizeof(StaticVertex));
  terrainIbo_ = createBufferWithData(ctx.device(), ctx.queue(), WGPUBufferUsage_Index, indices.data(), indices.size() * sizeof(uint32_t));
}

void WorldRenderer::buildRoadAndArenaBuffers(WgpuContext& ctx, const WorldData& world) {
  std::vector<StaticVertex> verts;
  std::vector<uint32_t> indices;

  // 1. Exported roads with distance UVs for yellow center lines & lane dashes (kind = 2.0)
  for (const auto& seg : world.roads) {
    if (seg.samples.size() < 2) continue;
    const float hw = seg.width * 0.5f;
    const uint32_t base = static_cast<uint32_t>(verts.size());
    const glm::vec3 col = seg.isBridge ? glm::vec3(0.24f, 0.26f, 0.29f) : glm::vec3(0.11f, 0.12f, 0.14f);
    float distAlong = 0.0f;

    for (size_t i = 0; i < seg.samples.size(); ++i) {
      const auto& sp = seg.samples[i];
      if (i > 0) distAlong += glm::distance(seg.samples[i - 1].pos, sp.pos);
      const glm::vec3 left = sp.pos - glm::vec3(sp.rx * hw, 0.0f, sp.rz * hw);
      const glm::vec3 right = sp.pos + glm::vec3(sp.rx * hw, 0.0f, sp.rz * hw);
      verts.push_back(StaticVertex{left.x, left.y + 0.06f, left.z, 0.0f, 1.0f, 0.0f, col.r, col.g, col.b, 0.0f, distAlong, 2.0f});
      verts.push_back(StaticVertex{right.x, right.y + 0.06f, right.z, 0.0f, 1.0f, 0.0f, col.r, col.g, col.b, 1.0f, distAlong, 2.0f});
      if (i > 0) {
        const uint32_t r0 = base + static_cast<uint32_t>((i - 1) * 2);
        const uint32_t r1 = base + static_cast<uint32_t>(i * 2);
        indices.push_back(r0);
        indices.push_back(r0 + 1);
        indices.push_back(r1);
        indices.push_back(r0 + 1);
        indices.push_back(r1 + 1);
        indices.push_back(r1);
      }
    }

    // Concrete Sidewalks / Bridge Guardrails flanking road edges (kind = 3.0)
    const float swW = seg.isBridge ? 1.1f : 2.1f;
    const float swY = seg.isBridge ? 0.42f : 0.14f;
    const glm::vec3 swCol = seg.isBridge ? glm::vec3(0.45f, 0.48f, 0.52f) : glm::vec3(0.50f, 0.52f, 0.54f);
    for (float side : {-1.0f, 1.0f}) {
      const uint32_t sBase = static_cast<uint32_t>(verts.size());
      for (size_t i = 0; i < seg.samples.size(); ++i) {
        const auto& sp = seg.samples[i];
        const glm::vec3 inner = sp.pos + glm::vec3(sp.rx * hw * side, 0.0f, sp.rz * hw * side);
        const glm::vec3 outer = sp.pos + glm::vec3(sp.rx * (hw + swW) * side, 0.0f, sp.rz * (hw + swW) * side);
        verts.push_back(StaticVertex{inner.x, inner.y + swY, inner.z, 0.0f, 1.0f, 0.0f, swCol.r, swCol.g, swCol.b, 0.0f, 0.0f, 3.0f});
        verts.push_back(StaticVertex{outer.x, outer.y + swY, outer.z, 0.0f, 1.0f, 0.0f, swCol.r, swCol.g, swCol.b, 1.0f, 0.0f, 3.0f});
        if (i > 0) {
          const uint32_t r0 = sBase + static_cast<uint32_t>((i - 1) * 2);
          const uint32_t r1 = sBase + static_cast<uint32_t>(i * 2);
          if (side > 0.0f) {
            indices.push_back(r0); indices.push_back(r0 + 1); indices.push_back(r1);
            indices.push_back(r0 + 1); indices.push_back(r1 + 1); indices.push_back(r1);
          } else {
            indices.push_back(r0); indices.push_back(r1); indices.push_back(r0 + 1);
            indices.push_back(r0 + 1); indices.push_back(r1); indices.push_back(r1 + 1);
          }
        }
      }
    }
  }

  // 2. Westgate Iron Pit Boxing Ring at fightPitPos (kind = 3.0)
  {
    const float groundY = world.heightfield.sampleHeight(world.fightPitPos.x, world.fightPitPos.z);
    const glm::vec3 center(world.fightPitPos.x, groundY, world.fightPitPos.z);
    std::vector<glm::vec3> bPos, bNorm, bCol;
    std::vector<uint32_t> bIdx;

    // Concrete apron + canvas mat
    appendBox(bPos, bNorm, bCol, bIdx, center + glm::vec3(0.0f, 0.25f, 0.0f), glm::vec3(13.0f, 0.5f, 13.0f), glm::vec3(0.20f, 0.21f, 0.24f));
    appendBox(bPos, bNorm, bCol, bIdx, center + glm::vec3(0.0f, 0.55f, 0.0f), glm::vec3(10.6f, 0.14f, 10.6f), glm::vec3(0.68f, 0.18f, 0.18f));
    appendBox(bPos, bNorm, bCol, bIdx, center + glm::vec3(0.0f, 0.63f, 0.0f), glm::vec3(9.4f, 0.04f, 9.4f), glm::vec3(0.24f, 0.26f, 0.30f));

    // 4 Corner posts + 12 ring ropes
    const float rHalf = 5.1f;
    const glm::vec2 corners[4] = {{-rHalf, -rHalf}, {rHalf, -rHalf}, {rHalf, rHalf}, {-rHalf, rHalf}};
    for (int c = 0; c < 4; ++c) {
      const glm::vec3 postCol = (c == 0) ? glm::vec3(0.85f, 0.15f, 0.15f)
                              : (c == 2) ? glm::vec3(0.15f, 0.42f, 0.88f)
                                         : glm::vec3(0.82f, 0.82f, 0.84f);
      appendBox(bPos, bNorm, bCol, bIdx, center + glm::vec3(corners[c].x, 1.35f, corners[c].y), glm::vec3(0.26f, 1.7f, 0.26f), postCol);
    }
    const float ropeHeights[3] = {1.05f, 1.48f, 1.92f};
    for (float ry : ropeHeights) {
      const glm::vec3 ropeCol = (ry > 1.7f) ? glm::vec3(0.88f, 0.18f, 0.18f) : glm::vec3(0.86f, 0.86f, 0.88f);
      appendBox(bPos, bNorm, bCol, bIdx, center + glm::vec3(0.0f, ry, -rHalf), glm::vec3(rHalf * 2.0f, 0.06f, 0.06f), ropeCol);
      appendBox(bPos, bNorm, bCol, bIdx, center + glm::vec3(0.0f, ry, rHalf), glm::vec3(rHalf * 2.0f, 0.06f, 0.06f), ropeCol);
      appendBox(bPos, bNorm, bCol, bIdx, center + glm::vec3(-rHalf, ry, 0.0f), glm::vec3(0.06f, 0.06f, rHalf * 2.0f), ropeCol);
      appendBox(bPos, bNorm, bCol, bIdx, center + glm::vec3(rHalf, ry, 0.0f), glm::vec3(0.06f, 0.06f, rHalf * 2.0f), ropeCol);
    }

    // North & South 2-tier spectator bleachers
    for (float side : {-1.0f, 1.0f}) {
      const float bz = side * 8.6f;
      appendBox(bPos, bNorm, bCol, bIdx, center + glm::vec3(0.0f, 0.45f, bz), glm::vec3(8.8f, 0.14f, 0.7f), glm::vec3(0.36f, 0.24f, 0.15f));
      appendBox(bPos, bNorm, bCol, bIdx, center + glm::vec3(0.0f, 0.92f, bz + side * 0.65f), glm::vec3(8.8f, 0.14f, 0.7f), glm::vec3(0.36f, 0.24f, 0.15f));
    }
    // Viktor's Bookie Desk & Canopy (West-North apron)
    appendBox(bPos, bNorm, bCol, bIdx, center + glm::vec3(-9.2f, 0.42f, 3.4f), glm::vec3(1.8f, 0.84f, 0.85f), glm::vec3(0.34f, 0.22f, 0.14f));
    appendBox(bPos, bNorm, bCol, bIdx, center + glm::vec3(-9.2f, 2.55f, 3.4f), glm::vec3(2.4f, 0.12f, 1.4f), glm::vec3(0.14f, 0.17f, 0.22f));
    // Heavy Punching Bag Gallows Stand & Barbell Rack (South-West warm-up zone)
    appendBox(bPos, bNorm, bCol, bIdx, center + glm::vec3(-9.0f, 1.35f, -5.2f), glm::vec3(0.14f, 2.7f, 0.14f), glm::vec3(0.16f, 0.19f, 0.24f));
    appendBox(bPos, bNorm, bCol, bIdx, center + glm::vec3(-8.4f, 2.65f, -5.2f), glm::vec3(1.2f, 0.10f, 0.10f), glm::vec3(0.16f, 0.19f, 0.24f));
    appendBox(bPos, bNorm, bCol, bIdx, center + glm::vec3(-7.9f, 1.55f, -5.2f), glm::vec3(0.42f, 1.15f, 0.42f), glm::vec3(0.42f, 0.11f, 0.09f));
    // Entrance fire-drum braziers
    for (float bz : {-3.6f, 3.8f}) {
      appendBox(bPos, bNorm, bCol, bIdx, center + glm::vec3(-7.6f, 0.48f, bz), glm::vec3(0.62f, 0.96f, 0.62f), glm::vec3(0.32f, 0.24f, 0.19f));
      appendBox(bPos, bNorm, bCol, bIdx, center + glm::vec3(-7.6f, 1.00f, bz), glm::vec3(0.44f, 0.12f, 0.44f), glm::vec3(0.95f, 0.45f, 0.12f));
    }

    // 3. Pelican Key Suspension Bridge Towers, Piers & Lighthouse
    for (float t : {0.30f, 0.70f}) {
      const float bx = -706.0f + (-920.0f - -706.0f) * t;
      const float bz = 65.0f + (345.0f - 65.0f) * t;
      const float deckY = std::max(world.heightfield.sampleHeight(bx, bz), 2.2f + std::sin(t * 3.14159f) * 14.5f);
      // Concrete submerged piers + twin crimson suspension towers + crossbeam
      appendBox(bPos, bNorm, bCol, bIdx, {bx, deckY * 0.5f - 1.5f, bz}, {12.5f, deckY + 3.0f, 3.2f}, {0.42f, 0.44f, 0.46f});
      appendBox(bPos, bNorm, bCol, bIdx, {bx - 4.8f, deckY + 11.0f, bz + 3.8f}, {1.4f, 22.0f, 1.4f}, {0.78f, 0.22f, 0.18f});
      appendBox(bPos, bNorm, bCol, bIdx, {bx + 4.8f, deckY + 11.0f, bz - 3.8f}, {1.4f, 22.0f, 1.4f}, {0.78f, 0.22f, 0.18f});
      appendBox(bPos, bNorm, bCol, bIdx, {bx, deckY + 19.5f, bz}, {11.0f, 1.6f, 1.2f}, {0.78f, 0.22f, 0.18f});
    }
    // Pelican Key Island Lighthouse
    {
      const float lx = -965.0f, lz = 415.0f;
      const float ly = world.heightfield.sampleHeight(lx, lz);
      appendBox(bPos, bNorm, bCol, bIdx, {lx, ly + 8.0f, lz}, {3.6f, 16.0f, 3.6f}, {0.92f, 0.90f, 0.86f});
      appendBox(bPos, bNorm, bCol, bIdx, {lx, ly + 17.2f, lz}, {2.6f, 2.4f, 2.6f}, {0.98f, 0.84f, 0.34f});
      appendBox(bPos, bNorm, bCol, bIdx, {lx, ly + 19.2f, lz}, {3.2f, 1.2f, 3.2f}, {0.76f, 0.18f, 0.16f});
    }

    // 4. Walk-In Interior Architecture (Safehouse, Civic 24/7 Mart, Customs Garage, Iron Pit Armory)
    auto appendWalkInRoom = [&](float rx, float rz, float halfW, float halfD, float wallH, const glm::vec3& wallCol, const glm::vec3& floorCol) {
      const float gy = world.heightfield.sampleHeight(rx, rz);
      appendBox(bPos, bNorm, bCol, bIdx, {rx, gy + 0.08f, rz}, {halfW * 2.0f, 0.16f, halfD * 2.0f}, floorCol);
      appendBox(bPos, bNorm, bCol, bIdx, {rx, gy + wallH + 0.12f, rz}, {halfW * 2.0f + 0.4f, 0.24f, halfD * 2.0f + 0.4f}, {0.26f, 0.28f, 0.32f});
      appendBox(bPos, bNorm, bCol, bIdx, {rx - halfW, gy + wallH * 0.5f, rz}, {0.36f, wallH, halfD * 2.0f}, wallCol);
      appendBox(bPos, bNorm, bCol, bIdx, {rx + halfW, gy + wallH * 0.5f, rz}, {0.36f, wallH, halfD * 2.0f}, wallCol);
      appendBox(bPos, bNorm, bCol, bIdx, {rx, gy + wallH * 0.5f, rz - halfD}, {halfW * 2.0f, wallH, 0.36f}, wallCol);
      const float wingW = std::max(0.5f, (halfW * 2.0f - 3.4f) * 0.25f);
      appendBox(bPos, bNorm, bCol, bIdx, {rx - halfW + wingW, gy + wallH * 0.5f, rz + halfD}, {wingW * 2.0f, wallH, 0.36f}, wallCol);
      appendBox(bPos, bNorm, bCol, bIdx, {rx + halfW - wingW, gy + wallH * 0.5f, rz + halfD}, {wingW * 2.0f, wallH, 0.36f}, wallCol);
      appendBox(bPos, bNorm, bCol, bIdx, {rx, gy + wallH - 0.35f, rz + halfD}, {3.6f, 0.7f, 0.40f}, {0.18f, 0.42f, 0.72f});
    };
    appendWalkInRoom(world.spawnPos.x - 13.0f, world.spawnPos.z - 11.0f, 4.8f, 4.2f, 3.4f, {0.72f, 0.68f, 0.62f}, {0.42f, 0.32f, 0.24f});
    appendWalkInRoom(-38.0f, -125.0f, 5.2f, 4.5f, 3.6f, {0.82f, 0.84f, 0.86f}, {0.58f, 0.60f, 0.64f});
    appendWalkInRoom(112.0f, -135.0f, 6.2f, 5.6f, 4.2f, {0.46f, 0.48f, 0.52f}, {0.30f, 0.32f, 0.35f});
    appendWalkInRoom(704.0f, 108.0f, 4.4f, 4.0f, 3.4f, {0.38f, 0.34f, 0.32f}, {0.24f, 0.24f, 0.26f});

    const uint32_t vBase = static_cast<uint32_t>(verts.size());
    for (size_t i = 0; i < bPos.size(); ++i) {
      verts.push_back(StaticVertex{bPos[i].x, bPos[i].y, bPos[i].z, bNorm[i].x, bNorm[i].y, bNorm[i].z, bCol[i].r, bCol[i].g, bCol[i].b, 0.0f, 0.0f, 3.0f});
    }
    for (uint32_t idx : bIdx) indices.push_back(vBase + idx);
  }

  roadIndexCount_ = static_cast<uint32_t>(indices.size());
  if (roadIndexCount_ > 0) {
    roadVbo_ = createBufferWithData(ctx.device(), ctx.queue(), WGPUBufferUsage_Vertex, verts.data(), verts.size() * sizeof(StaticVertex));
    roadIbo_ = createBufferWithData(ctx.device(), ctx.queue(), WGPUBufferUsage_Index, indices.data(), indices.size() * sizeof(uint32_t));
  }
}

WGPUBindGroup WorldRenderer::createPostBindGroup(
  WgpuContext& ctx,
  WGPUTextureView texA,
  WGPUTextureView texB,
  WGPUTextureView depthView,
  WGPUTextureView ssaoView
) {
  WGPUBindGroupEntry pe[6]{};
  pe[0] = WGPU_BIND_GROUP_ENTRY_INIT;
  pe[0].binding = 0;
  pe[0].buffer = postUbo_;
  pe[0].offset = 0;
  pe[0].size = sizeof(PostUniforms);

  pe[1] = WGPU_BIND_GROUP_ENTRY_INIT;
  pe[1].binding = 1;
  pe[1].textureView = texA;

  pe[2] = WGPU_BIND_GROUP_ENTRY_INIT;
  pe[2].binding = 2;
  pe[2].textureView = texB;

  pe[3] = WGPU_BIND_GROUP_ENTRY_INIT;
  pe[3].binding = 3;
  pe[3].sampler = linearSampler_;

  pe[4] = WGPU_BIND_GROUP_ENTRY_INIT;
  pe[4].binding = 4;
  pe[4].textureView = depthView;

  pe[5] = WGPU_BIND_GROUP_ENTRY_INIT;
  pe[5].binding = 5;
  pe[5].textureView = ssaoView;

  WGPUBindGroupDescriptor bgd = WGPU_BIND_GROUP_DESCRIPTOR_INIT;
  bgd.layout = postBgl_;
  bgd.entryCount = 6;
  bgd.entries = pe;
  return wgpuDeviceCreateBindGroup(ctx.device(), &bgd);
}

void WorldRenderer::releaseOffscreenTargets() {
  auto relBg = [](WGPUBindGroup& bg) { if (bg) { wgpuBindGroupRelease(bg); bg = nullptr; } };
  auto relView = [](WGPUTextureView& v) { if (v) { wgpuTextureViewRelease(v); v = nullptr; } };
  auto relTex = [](WGPUTexture& t) { if (t) { wgpuTextureRelease(t); t = nullptr; } };

  relBg(postBgSSAO_);
  relBg(postBgThresh_);
  relBg(postBgBlurH_);
  relBg(postBgBlurV_);
  relBg(postBgComposite_);

  relView(hdrView_);
  relTex(hdrTex_);
  relView(ssaoView_);
  relTex(ssaoTex_);
  relView(bloomViewA_);
  relTex(bloomTexA_);
  relView(bloomViewB_);
  relTex(bloomTexB_);
  offscreenW_ = 0;
  offscreenH_ = 0;
  boundDepthView_ = nullptr;
}

void WorldRenderer::ensureOffscreenTargets(WgpuContext& ctx) {
  const uint32_t w = std::max(1u, ctx.width());
  const uint32_t h = std::max(1u, ctx.height());
  const bool sizeSame = (w == offscreenW_ && h == offscreenH_ && hdrView_ && ssaoView_ && bloomViewA_ && bloomViewB_);
  if (sizeSame && boundDepthView_ == ctx.depthView()) return;

  if (!sizeSame) {
    releaseOffscreenTargets();
    offscreenW_ = w;
    offscreenH_ = h;

    auto makeTarget = [&](uint32_t tw, uint32_t th, WGPUTextureFormat fmt, WGPUTexture& outTex, WGPUTextureView& outView) {
      WGPUTextureDescriptor td = WGPU_TEXTURE_DESCRIPTOR_INIT;
      td.usage = WGPUTextureUsage_RenderAttachment | WGPUTextureUsage_TextureBinding;
      td.dimension = WGPUTextureDimension_2D;
      td.size = {std::max(1u, tw), std::max(1u, th), 1};
      td.format = fmt;
      td.mipLevelCount = 1;
      td.sampleCount = 1;
      outTex = wgpuDeviceCreateTexture(ctx.device(), &td);

      WGPUTextureViewDescriptor tvd = WGPU_TEXTURE_VIEW_DESCRIPTOR_INIT;
      tvd.format = fmt;
      tvd.dimension = WGPUTextureViewDimension_2D;
      tvd.mipLevelCount = 1;
      tvd.arrayLayerCount = 1;
      tvd.aspect = WGPUTextureAspect_All;
      outView = wgpuTextureCreateView(outTex, &tvd);
    };

    makeTarget(w, h, WGPUTextureFormat_RGBA16Float, hdrTex_, hdrView_);
    makeTarget(std::max(1u, w / 2), std::max(1u, h / 2), WGPUTextureFormat_RGBA8Unorm, ssaoTex_, ssaoView_);
    makeTarget(std::max(1u, w / 4), std::max(1u, h / 4), WGPUTextureFormat_RGBA16Float, bloomTexA_, bloomViewA_);
    makeTarget(std::max(1u, w / 4), std::max(1u, h / 4), WGPUTextureFormat_RGBA16Float, bloomTexB_, bloomViewB_);
  } else {
    auto relBg = [](WGPUBindGroup& bg) {
      if (bg) { wgpuBindGroupRelease(bg); bg = nullptr; }
    };
    relBg(postBgSSAO_);
    relBg(postBgThresh_);
    relBg(postBgBlurH_);
    relBg(postBgBlurV_);
    relBg(postBgComposite_);
  }

  // Always bind the live ctx.depthView() so recreated depth buffers never leave a frozen silhouette in SSAO/Composite
  boundDepthView_ = ctx.depthView();
  postBgSSAO_ = createPostBindGroup(ctx, defaultWhiteTex_.view, defaultWhiteTex_.view, boundDepthView_, defaultWhiteTex_.view);
  postBgThresh_ = createPostBindGroup(ctx, hdrView_, defaultWhiteTex_.view, boundDepthView_, defaultWhiteTex_.view);
  postBgBlurH_ = createPostBindGroup(ctx, bloomViewA_, defaultWhiteTex_.view, boundDepthView_, defaultWhiteTex_.view);
  postBgBlurV_ = createPostBindGroup(ctx, bloomViewB_, defaultWhiteTex_.view, boundDepthView_, defaultWhiteTex_.view);
  postBgComposite_ = createPostBindGroup(ctx, hdrView_, bloomViewA_, boundDepthView_, ssaoView_);
}

bool WorldRenderer::loadGlbBatch(
  WgpuContext& ctx,
  const std::string& path,
  const std::vector<InstanceAttrib>& instances,
  InstancedGlbBatch& outBatch,
  float normalizeTargetLength,
  bool decodeTextures,
  bool isVehicle,
  float yawOffsetRad
) {
  if (!std::filesystem::exists(path)) return false;
  GltfModel model;
  if (!GltfAssetLoader::loadGlb(path, model, decodeTextures, nullptr) || model.primitives.empty()) return false;

  std::vector<ModelVertex> verts;
  std::vector<uint32_t> indices;
  const glm::vec3 size = model.boundsMax - model.boundsMin;
  const float maxHoriz = std::max(size.x, size.z);
  const float scale = (normalizeTargetLength > 0.0f && maxHoriz > 1e-4f) ? (normalizeTargetLength / maxHoriz) : 1.0f;
  const float cx = (normalizeTargetLength > 0.0f) ? (model.boundsMin.x + model.boundsMax.x) * 0.5f : 0.0f;
  const float cz = (normalizeTargetLength > 0.0f) ? (model.boundsMin.z + model.boundsMax.z) * 0.5f : 0.0f;
  const float minY = model.boundsMin.y;
  const float cosY = std::cos(yawOffsetRad);
  const float sinY = std::sin(yawOffsetRad);

  std::unordered_map<int32_t, WGPUBindGroup> texBgCache;
  std::vector<size_t> primOrder(model.primitives.size());
  for (size_t i = 0; i < primOrder.size(); ++i) primOrder[i] = i;
  std::sort(primOrder.begin(), primOrder.end(), [&](size_t a, size_t b) {
    const int32_t ma = model.primitives[a].materialIndex;
    const int32_t mb = model.primitives[b].materialIndex;
    const int32_t ta = (ma >= 0 && static_cast<size_t>(ma) < model.materials.size()) ? model.materials[ma].baseColorTexIndex : -1;
    const int32_t tb = (mb >= 0 && static_cast<size_t>(mb) < model.materials.size()) ? model.materials[mb].baseColorTexIndex : -1;
    return ta < tb;
  });

  auto startsWith = [](const std::string& s, const char* prefix) -> bool {
    const size_t n = std::strlen(prefix);
    return s.size() >= n && s.compare(0, n, prefix) == 0;
  };
  auto containsCI = [](const std::string& s, const char* needle) -> bool {
    std::string lo = s;
    for (char& c : lo) c = static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
    return lo.find(needle) != std::string::npos;
  };

  WGPUBindGroup curTexBg = nullptr;
  for (size_t pi : primOrder) {
    const auto& prim = model.primitives[pi];
    const uint32_t base = static_cast<uint32_t>(verts.size());
    const uint32_t iStart = static_cast<uint32_t>(indices.size());
    glm::vec3 matCol(1.0f);
    float metallic = 0.05f;
    float roughness = 0.58f;
    float encodedMetallic = metallic;
    WGPUBindGroup texBg = defaultWhiteTex_.bindGroup;
    bool hasTexture = false;

    if (prim.materialIndex >= 0 && static_cast<size_t>(prim.materialIndex) < model.materials.size()) {
      const auto& mat = model.materials[prim.materialIndex];
      matCol = glm::vec3(mat.baseColor);
      metallic = std::clamp(mat.metallic, 0.0f, 1.0f);
      roughness = std::clamp(mat.roughness, 0.08f, 0.98f);
      if (mat.baseColorTexIndex >= 0 && static_cast<size_t>(mat.baseColorTexIndex) < model.textures.size()) {
        auto it = texBgCache.find(mat.baseColorTexIndex);
        if (it != texBgCache.end()) {
          texBg = it->second;
          matCol = glm::vec3(1.0f);
          hasTexture = true;
        } else {
          const auto& td = model.textures[mat.baseColorTexIndex];
          if (td.width > 0 && td.height > 0 && !td.rgba8.empty()) {
            GpuTextureBinding gtb = createRgbaTexture(ctx, td.width, td.height, td.rgba8.data());
            texBg = gtb.bindGroup;
            texBgCache[mat.baseColorTexIndex] = texBg;
            outBatch.ownedTextures.push_back(gtb);
            matCol = glm::vec3(1.0f);
            hasTexture = true;
          }
        }
      }

      if (isVehicle) {
        const std::string& mn = mat.name;
        if (startsWith(mn, "paint__")) {
          // Metallic clearcoat body paint (receives instance colorTint)
          metallic = 0.26f;
          roughness = 0.14f;
          encodedMetallic = 2.0f + metallic;
          if (!hasTexture) matCol = glm::vec3(1.0f);
        } else if (startsWith(mn, "headlight__")) {
          if (containsCI(mn, "cover") || containsCI(mn, "glass")) {
            encodedMetallic = -3.0f;
            roughness = 0.05f;
            matCol = glm::vec3(0.84f, 0.90f, 0.96f);
          } else if (containsCI(mn, "beacon_blue")) {
            encodedMetallic = -4.0f;
            roughness = 0.10f;
            matCol = glm::vec3(0.18f, 0.48f, 1.0f);
          } else {
            encodedMetallic = -1.0f;
            roughness = 0.10f;
            matCol = glm::vec3(0.96f, 0.98f, 1.0f);
          }
        } else if (startsWith(mn, "taillight__")) {
          if (containsCI(mn, "cover")) {
            encodedMetallic = -3.0f;
            roughness = 0.06f;
            matCol = glm::vec3(0.55f, 0.04f, 0.06f);
          } else if (containsCI(mn, "beacon_red")) {
            encodedMetallic = -5.0f;
            roughness = 0.10f;
            matCol = glm::vec3(1.0f, 0.10f, 0.10f);
          } else {
            encodedMetallic = -2.0f;
            roughness = 0.12f;
            matCol = glm::vec3(0.95f, 0.08f, 0.08f);
          }
        } else if (startsWith(mn, "glass__") || containsCI(mn, "windshield")) {
          encodedMetallic = -3.0f;
          roughness = 0.05f;
          matCol = glm::vec3(0.10f, 0.14f, 0.20f);
        } else {
          if (startsWith(mn, "chrome__")) {
            metallic = 1.0f;
            roughness = 0.08f;
          } else if (startsWith(mn, "rim__")) {
            metallic = 0.88f;
            roughness = 0.18f;
          } else if (startsWith(mn, "brake__")) {
            const bool isDisc = containsCI(mn, "disc") || containsCI(mn, "disk") || containsCI(mn, "pad2") || containsCI(mn, "brake-discs");
            if (isDisc) {
              metallic = 0.90f;
              roughness = 0.22f;
            } else {
              metallic = 0.52f;
              roughness = 0.30f;
              if (!hasTexture) matCol = glm::vec3(0.76f, 0.09f, 0.09f);
            }
          } else if (startsWith(mn, "plate__")) {
            metallic = 0.34f;
            roughness = 0.28f;
            if (!hasTexture && matCol.r > 0.88f && matCol.g > 0.88f && matCol.b > 0.88f) {
              matCol = glm::vec3(0.84f, 0.87f, 0.91f);
            }
          } else if (startsWith(mn, "tire__")) {
            metallic = 0.02f;
            roughness = 0.86f;
            if (!hasTexture && (matCol.r > 0.25f || matCol.g > 0.25f || matCol.b > 0.25f)) {
              matCol = glm::vec3(0.085f, 0.095f, 0.11f);
            }
          } else if (startsWith(mn, "trim__") || startsWith(mn, "carbon__")) {
            metallic = 0.16f;
            roughness = 0.42f;
            if (!hasTexture && !containsCI(mn, "_livery")) {
              const float lum = matCol.r * 0.299f + matCol.g * 0.587f + matCol.b * 0.114f;
              if (lum > 0.72f) matCol = glm::vec3(0.095f, 0.105f, 0.125f);
            }
          }
          encodedMetallic = 4.0f + metallic;
        }
      } else {
        encodedMetallic = metallic;
      }
    } else if (isVehicle) {
      encodedMetallic = 4.0f + metallic;
    }

    for (const auto& v : prim.vertices) {
      const glm::vec3 col = glm::vec3(v.color) * matCol;
      const float lx = (v.position.x - cx) * scale;
      const float ly = (v.position.y - minY) * scale;
      const float lz = (v.position.z - cz) * scale;
      const float rx = lx * cosY + lz * sinY;
      const float rz = -lx * sinY + lz * cosY;
      const float nx = v.normal.x * cosY + v.normal.z * sinY;
      const float nz = -v.normal.x * sinY + v.normal.z * cosY;
      verts.push_back(ModelVertex{
        rx, ly, rz,
        nx, v.normal.y, nz,
        std::max(0.0f, v.uv.x), std::max(0.0f, v.uv.y),
        col.r, col.g, col.b,
        encodedMetallic, roughness
      });
    }
    for (uint32_t idx : prim.indices) {
      indices.push_back(base + idx);
    }
    const uint32_t addedIdx = static_cast<uint32_t>(indices.size()) - iStart;
    if (addedIdx > 0) {
      if (!outBatch.submeshes.empty() && curTexBg == texBg) {
        outBatch.submeshes.back().indexCount += addedIdx;
      } else {
        outBatch.submeshes.push_back(GlbSubmesh{iStart, addedIdx, texBg});
        curTexBg = texBg;
      }
    }
  }
  if (indices.empty()) return false;

  outBatch.indexCount = static_cast<uint32_t>(indices.size());
  outBatch.vbo = createBufferWithData(ctx.device(), ctx.queue(), WGPUBufferUsage_Vertex, verts.data(), verts.size() * sizeof(ModelVertex));
  outBatch.ibo = createBufferWithData(ctx.device(), ctx.queue(), WGPUBufferUsage_Index, indices.data(), indices.size() * sizeof(uint32_t));

  outBatch.maxInstances = static_cast<uint32_t>(std::max<size_t>(32, instances.size()));
  outBatch.instanceCount = static_cast<uint32_t>(instances.size());
  outBatch.instVbo = createBufferWithData(
    ctx.device(),
    ctx.queue(),
    WGPUBufferUsage_Vertex,
    instances.empty() ? nullptr : instances.data(),
    outBatch.maxInstances * sizeof(InstanceAttrib)
  );
  return true;
}

bool WorldRenderer::loadGlbUnitBoxBatch(
  WgpuContext& ctx,
  const std::string& path,
  uint32_t maxInstances,
  InstancedGlbBatch& outBatch
) {
  if (!std::filesystem::exists(path)) return false;
  GltfModel model;
  if (!GltfAssetLoader::loadGlb(path, model, false, nullptr) || model.primitives.empty()) return false;

  std::vector<ModelVertex> verts;
  std::vector<uint32_t> indices;
  const glm::vec3 sz = glm::max(model.boundsMax - model.boundsMin, glm::vec3(0.01f));
  const glm::vec3 ctr = (model.boundsMin + model.boundsMax) * 0.5f;

  std::unordered_map<int32_t, WGPUBindGroup> texBgCache;
  std::vector<size_t> primOrder(model.primitives.size());
  for (size_t i = 0; i < primOrder.size(); ++i) primOrder[i] = i;
  std::sort(primOrder.begin(), primOrder.end(), [&](size_t a, size_t b) {
    const int32_t ma = model.primitives[a].materialIndex;
    const int32_t mb = model.primitives[b].materialIndex;
    const int32_t ta = (ma >= 0 && static_cast<size_t>(ma) < model.materials.size()) ? model.materials[ma].baseColorTexIndex : -1;
    const int32_t tb = (mb >= 0 && static_cast<size_t>(mb) < model.materials.size()) ? model.materials[mb].baseColorTexIndex : -1;
    return ta < tb;
  });

  WGPUBindGroup curTexBg = nullptr;
  for (size_t pi : primOrder) {
    const auto& prim = model.primitives[pi];
    const uint32_t base = static_cast<uint32_t>(verts.size());
    const uint32_t iStart = static_cast<uint32_t>(indices.size());
    glm::vec3 matCol(1.0f);
    float metallic = 0.04f;
    float roughness = 0.76f;
    WGPUBindGroup texBg = defaultWhiteTex_.bindGroup;

    if (prim.materialIndex >= 0 && static_cast<size_t>(prim.materialIndex) < model.materials.size()) {
      const auto& mat = model.materials[prim.materialIndex];
      matCol = glm::vec3(mat.baseColor);
      metallic = std::clamp(mat.metallic, 0.0f, 1.0f);
      roughness = std::clamp(mat.roughness, 0.12f, 0.98f);
      if (mat.baseColorTexIndex >= 0 && static_cast<size_t>(mat.baseColorTexIndex) < model.textures.size()) {
        auto it = texBgCache.find(mat.baseColorTexIndex);
        if (it != texBgCache.end()) {
          texBg = it->second;
          matCol = glm::vec3(1.0f);
        } else {
          const auto& td = model.textures[mat.baseColorTexIndex];
          if (td.width > 0 && td.height > 0 && !td.rgba8.empty()) {
            GpuTextureBinding gtb = createRgbaTexture(ctx, td.width, td.height, td.rgba8.data());
            texBg = gtb.bindGroup;
            texBgCache[mat.baseColorTexIndex] = texBg;
            outBatch.ownedTextures.push_back(gtb);
            matCol = glm::vec3(1.0f);
          }
        }
      }
    }

    for (const auto& v : prim.vertices) {
      const glm::vec3 col = glm::vec3(v.color) * matCol;
      verts.push_back(ModelVertex{
        (v.position.x - ctr.x) / sz.x,
        (v.position.y - ctr.y) / sz.y,
        (v.position.z - ctr.z) / sz.z,
        v.normal.x, v.normal.y, v.normal.z,
        std::max(0.0f, v.uv.x), std::max(0.0f, v.uv.y),
        col.r, col.g, col.b,
        metallic, roughness
      });
    }
    for (uint32_t idx : prim.indices) {
      indices.push_back(base + idx);
    }
    const uint32_t addedIdx = static_cast<uint32_t>(indices.size()) - iStart;
    if (addedIdx > 0) {
      if (!outBatch.submeshes.empty() && curTexBg == texBg) {
        outBatch.submeshes.back().indexCount += addedIdx;
      } else {
        outBatch.submeshes.push_back(GlbSubmesh{iStart, addedIdx, texBg});
        curTexBg = texBg;
      }
    }
  }
  if (indices.empty()) return false;

  outBatch.indexCount = static_cast<uint32_t>(indices.size());
  outBatch.vbo = createBufferWithData(ctx.device(), ctx.queue(), WGPUBufferUsage_Vertex, verts.data(), verts.size() * sizeof(ModelVertex));
  outBatch.ibo = createBufferWithData(ctx.device(), ctx.queue(), WGPUBufferUsage_Index, indices.data(), indices.size() * sizeof(uint32_t));
  outBatch.maxInstances = std::max(64u, maxInstances);
  outBatch.instanceCount = 0;
  outBatch.instVbo = createBufferWithData(ctx.device(), ctx.queue(), WGPUBufferUsage_Vertex, nullptr, outBatch.maxInstances * sizeof(InstanceAttrib));
  return true;
}

void WorldRenderer::buildPropAndVehicleBatches(WgpuContext& ctx, const WorldData& world, const std::string& assetsRoot) {
  // Unit 1x1x1 cube for buildings & fallback props (uv = (-1, -1) flags building window grid in WGSL)
  const ModelVertex boxVerts[24] = {
    {-0.5f, -0.5f,  0.5f, 0, 0, 1, -1, -1, 1, 1, 1, 0.04f, 0.72f}, { 0.5f, -0.5f,  0.5f, 0, 0, 1, -1, -1, 1, 1, 1, 0.04f, 0.72f}, { 0.5f,  0.5f,  0.5f, 0, 0, 1, -1, -1, 1, 1, 1, 0.04f, 0.72f}, {-0.5f,  0.5f,  0.5f, 0, 0, 1, -1, -1, 1, 1, 1, 0.04f, 0.72f},
    { 0.5f, -0.5f, -0.5f, 0, 0, -1, -1, -1, 1, 1, 1, 0.04f, 0.72f}, {-0.5f, -0.5f, -0.5f, 0, 0, -1, -1, -1, 1, 1, 1, 0.04f, 0.72f}, {-0.5f,  0.5f, -0.5f, 0, 0, -1, -1, -1, 1, 1, 1, 0.04f, 0.72f}, { 0.5f,  0.5f, -0.5f, 0, 0, -1, -1, -1, 1, 1, 1, 0.04f, 0.72f},
    { 0.5f, -0.5f,  0.5f, 1, 0, 0, -1, -1, 1, 1, 1, 0.04f, 0.72f}, { 0.5f, -0.5f, -0.5f, 1, 0, 0, -1, -1, 1, 1, 1, 0.04f, 0.72f}, { 0.5f,  0.5f, -0.5f, 1, 0, 0, -1, -1, 1, 1, 1, 0.04f, 0.72f}, { 0.5f,  0.5f,  0.5f, 1, 0, 0, -1, -1, 1, 1, 1, 0.04f, 0.72f},
    {-0.5f, -0.5f, -0.5f, -1, 0, 0, -1, -1, 1, 1, 1, 0.04f, 0.72f}, {-0.5f, -0.5f,  0.5f, -1, 0, 0, -1, -1, 1, 1, 1, 0.04f, 0.72f}, {-0.5f,  0.5f,  0.5f, -1, 0, 0, -1, -1, 1, 1, 1, 0.04f, 0.72f}, {-0.5f,  0.5f, -0.5f, -1, 0, 0, -1, -1, 1, 1, 1, 0.04f, 0.72f},
    {-0.5f,  0.5f,  0.5f, 0, 1, 0, -1, -1, 1, 1, 1, 0.04f, 0.72f}, { 0.5f,  0.5f,  0.5f, 0, 1, 0, -1, -1, 1, 1, 1, 0.04f, 0.72f}, { 0.5f,  0.5f, -0.5f, 0, 1, 0, -1, -1, 1, 1, 1, 0.04f, 0.72f}, {-0.5f,  0.5f, -0.5f, 0, 1, 0, -1, -1, 1, 1, 1, 0.04f, 0.72f},
    {-0.5f, -0.5f, -0.5f, 0, -1, 0, -1, -1, 1, 1, 1, 0.04f, 0.72f}, { 0.5f, -0.5f, -0.5f, 0, -1, 0, -1, -1, 1, 1, 1, 0.04f, 0.72f}, { 0.5f, -0.5f,  0.5f, 0, -1, 0, -1, -1, 1, 1, 1, 0.04f, 0.72f}, {-0.5f, -0.5f,  0.5f, 0, -1, 0, -1, -1, 1, 1, 1, 0.04f, 0.72f},
  };
  const uint32_t boxIdx[36] = {
     0,  1,  2,  0,  2,  3,  4,  5,  6,  4,  6,  7,
     8,  9, 10,  8, 10, 11, 12, 13, 14, 12, 14, 15,
    16, 17, 18, 16, 18, 19, 20, 21, 22, 20, 22, 23,
  };
  unitBoxIndexCount_ = 36;
  unitBoxVbo_ = createBufferWithData(ctx.device(), ctx.queue(), WGPUBufferUsage_Vertex, boxVerts, sizeof(boxVerts));
  unitBoxIbo_ = createBufferWithData(ctx.device(), ctx.queue(), WGPUBufferUsage_Index, boxIdx, sizeof(boxIdx));

  size_t totalB = 0;
  for (const auto& c : world.chunks) totalB += c.buildings.size();
  buildingCapacity_ = static_cast<uint32_t>(std::max<size_t>(64, totalB));
  buildingInstVbo_ = createBufferWithData(ctx.device(), ctx.queue(), WGPUBufferUsage_Vertex, nullptr, buildingCapacity_ * sizeof(InstanceAttrib));
  buildingStaging_.reserve(buildingCapacity_);

  markerCapacity_ = 1024;
  markerInstVbo_ = createBufferWithData(ctx.device(), ctx.queue(), WGPUBufferUsage_Vertex, nullptr, markerCapacity_ * sizeof(InstanceAttrib));
  markerStaging_.reserve(markerCapacity_);

  dynPropCapacity_ = 256;
  dynPropInstVbo_ = createBufferWithData(ctx.device(), ctx.queue(), WGPUBufferUsage_Vertex, nullptr, dynPropCapacity_ * sizeof(InstanceAttrib));
  dynPropStaging_.reserve(dynPropCapacity_);

  static const std::unordered_map<std::string, std::pair<std::string, float>> protoGlbMap = {
    {"palm_tree", {"tree_palm.glb", 1.75f}},
    {"oak_tree", {"tree_oak.glb", 1.95f}},
    {"pine_tree", {"tree_pine.glb", 1.95f}},
    {"bush", {"bush.glb", 1.15f}},
    {"rock", {"rock.glb", 1.15f}},
    {"dumpster", {"dumpster_bin.glb", 1.0f}},
    {"park_bench", {"park_bench.glb", 1.0f}},
    {"stop_sign", {"sign_stop.glb", 1.0f}},
    {"trashcan", {"trash_bin.glb", 1.0f}},
  };

  std::unordered_map<std::string, std::vector<InstanceAttrib>> grouped;
  std::vector<InstanceAttrib> fallbackInst;

  for (const auto& p : world.props) {
    auto it = protoGlbMap.find(p.proto);
    if (it != protoGlbMap.end()) {
      const float s = p.scale * it->second.second;
      grouped[p.proto].push_back(makeInstYaw(p.pos.x, p.pos.y, p.pos.z, s, s, s, p.ry, 1.0f, 1.0f, 1.0f));
    } else if (p.proto == "streetlight") {
      fallbackInst.push_back(makeInstYaw(p.pos.x, p.pos.y + 3.6f, p.pos.z, 0.24f, 7.2f, 0.24f, p.ry, 0.34f, 0.37f, 0.42f));
      fallbackInst.push_back(makeInstYaw(p.pos.x, p.pos.y + 7.25f, p.pos.z, 0.85f, 0.22f, 0.35f, p.ry, 0.98f, 0.86f, 0.58f, 0.65f));
    } else if (p.proto == "traffic_light") {
      fallbackInst.push_back(makeInstYaw(p.pos.x, p.pos.y + 3.1f, p.pos.z, 0.28f, 6.2f, 0.28f, p.ry, 0.18f, 0.20f, 0.22f));
      fallbackInst.push_back(makeInstYaw(p.pos.x, p.pos.y + 5.9f, p.pos.z, 0.45f, 0.95f, 0.45f, p.ry, 0.95f, 0.22f, 0.18f, 0.85f));
    } else {
      fallbackInst.push_back(makeInstYaw(p.pos.x, p.pos.y + 0.48f, p.pos.z, 0.34f, 0.96f, 0.34f, p.ry, 0.82f, 0.18f, 0.14f));
    }
  }

  telemetry_.glbPropTypesLoaded = 0;
  for (auto& [proto, instList] : grouped) {
    const auto& info = protoGlbMap.at(proto);
    const std::string glbPath = (std::filesystem::path(assetsRoot) / "models" / info.first).string();
    InstancedGlbBatch batch;
    if (loadGlbBatch(ctx, glbPath, instList, batch)) {
      glbPropBatches_.push_back(batch);
      ++telemetry_.glbPropTypesLoaded;
    } else {
      for (const auto& inst : instList) {
        fallbackInst.push_back(makeInst(inst.x, inst.y + 2.5f, inst.z, 1.2f, 5.0f, 1.2f, glm::quat(inst.qw, inst.qx, inst.qy, inst.qz), 0.25f, 0.48f, 0.22f));
      }
    }
  }

  // Stage all 11+ CC0 Iron Pit GLB props & interior props around world.fightPitPos!
  {
    const float pitY = world.heightfield.sampleHeight(world.fightPitPos.x, world.fightPitPos.z);
    const float px = world.fightPitPos.x;
    const float pz = world.fightPitPos.z;
    struct PitPropPlace { const char* file; float normLen; float dx; float dy; float dz; float yaw; };
    const PitPropPlace pitPlaces[] = {
      {"pit_floodlight.glb", 2.4f, -6.2f, 0.0f, -6.2f,  0.78f},
      {"pit_floodlight.glb", 2.4f,  6.2f, 0.0f, -6.2f, -0.78f},
      {"pit_floodlight.glb", 2.4f, -6.2f, 0.0f,  6.2f,  2.35f},
      {"pit_floodlight.glb", 2.4f,  6.2f, 0.0f,  6.2f, -2.35f},
      {"pit_speaker.glb",    1.3f, -5.9f, 0.55f, -1.8f,  1.57f},
      {"pit_speaker.glb",    1.3f, -5.9f, 0.55f,  1.8f,  1.57f},
      {"pit_speaker.glb",    1.3f,  5.9f, 0.55f,  0.0f, -1.57f},
      {"pit_stool.glb",      0.75f, -4.4f, 0.65f, -4.4f,  0.0f},
      {"pit_stool.glb",      0.75f,  4.4f, 0.65f,  4.4f,  3.14f},
      {"pit_cash_register.glb", 0.65f, -9.1f, 0.85f,  3.2f, 1.57f},
      {"pos_terminal.glb",   0.52f, -9.1f, 0.85f,  3.8f, 1.57f},
      {"pit_chair.glb",      0.95f, -10.1f, 0.0f,  3.4f, 1.57f},
      {"pit_trophy.glb",     0.72f, -9.1f, 0.85f,  2.6f, 1.57f},
      {"pit_barrel.glb",     1.05f, -7.8f, 0.0f,  6.8f,  0.2f},
      {"pit_barrel_open.glb",1.05f,  7.8f, 0.0f, -6.8f,  1.1f},
      {"pit_crate_stack.glb",1.95f,  9.2f, 0.0f,  4.8f,  0.4f},
      {"pit_pallet.glb",     1.80f, -9.0f, 0.0f, -7.4f,  0.0f},
      {"pit_barrier.glb",    2.60f,  0.0f, 0.0f, -7.3f,  0.0f},
      {"pit_barrier.glb",    2.60f,  0.0f, 0.0f,  7.3f,  3.14f},
      {"medkit.glb",         0.62f, -8.8f, 0.85f, -2.5f, 0.4f},
      {"stash_bag.glb",      0.78f, -9.6f, 0.0f,  4.4f,  0.8f},
      {"int_table.glb",      1.65f,  9.4f, 0.0f, -2.2f,  0.0f},
    };
    std::unordered_map<std::string, std::pair<float, std::vector<InstanceAttrib>>> pitGrouped;
    for (const auto& pp : pitPlaces) {
      auto& entry = pitGrouped[pp.file];
      entry.first = pp.normLen;
      entry.second.push_back(makeInstYaw(px + pp.dx, pitY + pp.dy, pz + pp.dz, 1.0f, 1.0f, 1.0f, pp.yaw, 1.0f, 1.0f, 1.0f));
    }

    // Walk-in Interior Furniture (Safehouse, Civic 24/7 Mart, Customs Garage, Iron Pit Armory) & Bay/Airport Landmarks
    const float shX = world.spawnPos.x - 13.0f, shZ = world.spawnPos.z - 11.0f;
    const float shY = world.heightfield.sampleHeight(shX, shZ) + 0.16f;
    const float martY = world.heightfield.sampleHeight(-38.0f, -125.0f) + 0.16f;
    const float garY = world.heightfield.sampleHeight(112.0f, -135.0f) + 0.16f;
    const float armY = world.heightfield.sampleHeight(704.0f, 108.0f) + 0.16f;
    const struct LandmarkProp { const char* file; float normLen; float x; float y; float z; float yaw; } landmarks[] = {
      // Safehouse Studio interior
      {"int_bed.glb",       2.2f, shX - 2.6f, shY, shZ - 2.2f, 0.0f},
      {"int_couch_l.glb",   2.4f, shX + 2.2f, shY, shZ - 1.5f, 3.14f},
      {"int_tv.glb",        1.2f, shX + 2.2f, shY, shZ - 3.6f, 0.0f},
      {"kk_rug.glb",        2.8f, shX + 0.0f, shY, shZ + 0.2f, 0.0f},
      {"int_fridge.glb",    1.0f, shX - 3.8f, shY, shZ + 1.2f, 1.57f},
      {"stash_bag.glb",     0.8f, shX - 3.0f, shY, shZ - 0.5f, 0.4f},
      {"medkit.glb",        0.6f, shX + 3.4f, shY, shZ + 1.4f, 0.0f},
      // Civic 24/7 Mart interior
      {"store_shelf.glb",   2.2f, -40.5f, martY, -126.5f, 0.0f},
      {"store_shelf.glb",   2.2f, -35.5f, martY, -126.5f, 0.0f},
      {"int_fridge.glb",    1.1f, -42.0f, martY, -123.5f, 1.57f},
      {"pos_terminal.glb",  0.55f,-38.0f, martY + 0.85f, -122.2f, 0.0f},
      // Westgate Customs Garage interior
      {"ph_steel_shelves.glb", 2.0f, 107.0f, garY, -138.0f, 1.57f},
      {"pit_barrel.glb",       1.0f, 116.5f, garY, -138.0f, 0.0f},
      {"pit_crate_stack.glb",  1.8f, 116.2f, garY, -133.0f, 0.5f},
      // Iron Pit Armory interior
      {"ph_steel_shelves.glb", 2.0f, 701.2f, armY, 105.0f, 0.0f},
      {"int_table.glb",        1.6f, 705.5f, armY, 107.0f, 0.0f},
      {"medkit.glb",           0.65f,705.5f, armY + 0.78f, 107.0f, 0.3f},
      // Bay & Airport Landmarks
      {"cruise_ship.glb",  62.0f, -890.0f, -0.4f, 130.0f, 0.35f},
      {"airliner_737.glb", 38.0f, 18.0f, world.heightfield.sampleHeight(18.0f, 975.0f), 975.0f, 1.57f},
      {"plane.glb",        11.0f, -24.0f, world.heightfield.sampleHeight(-24.0f, 945.0f), 945.0f, 1.57f},
      {"fuel_tank.glb",    6.5f,  612.0f, world.heightfield.sampleHeight(612.0f, 448.0f), 448.0f, 0.0f},
      {"fuel_tank.glb",    6.5f,  622.0f, world.heightfield.sampleHeight(622.0f, 448.0f), 448.0f, 0.0f},
    };
    for (const auto& lm : landmarks) {
      auto& entry = pitGrouped[lm.file];
      entry.first = lm.normLen;
      entry.second.push_back(makeInstYaw(lm.x, lm.y, lm.z, 1.0f, 1.0f, 1.0f, lm.yaw, 1.0f, 1.0f, 1.0f));
    }

    for (const auto& [fname, pairData] : pitGrouped) {
      const std::string glbPath = (std::filesystem::path(assetsRoot) / "models" / fname).string();
      InstancedGlbBatch batch;
      if (loadGlbBatch(ctx, glbPath, pairData.second, batch, pairData.first)) {
        glbPropBatches_.push_back(batch);
        ++telemetry_.glbPropTypesLoaded;
      }
    }
  }

  // Real 3D GLB House & Storefront Prototypes (normalized to unit 1x1x1 box so they match Jolt colliders 1:1!)
  const char* houseFiles[kNumHouseGlbs] = {
    "houses/kenney-suburban/building-type-a.glb",
    "houses/kenney-suburban/building-type-c.glb",
    "houses/kenney-suburban/building-type-e.glb",
    "houses/kenney-suburban/building-type-g.glb",
    "houses/quaternius-buildings-2/House1.glb",
    "houses/quaternius-buildings-2/House2.glb",
    "houses/quaternius-buildings-3/2Story_Balcony_Mat.glb",
    "houses/quaternius-buildings-3/2Story_Wide_Mat.glb",
    "houses/quaternius-buildings-3/3Story_Balcony_Mat.glb",
    "houses/quaternius-buildings-3/3Story_Slim_Mat.glb",
    "houses/quaternius-buildings-2/Building1_Large.glb",
    "houses/quaternius-buildings-2/Building2_Large.glb",
  };
  for (size_t hi = 0; hi < kNumHouseGlbs; ++hi) {
    loadGlbUnitBoxBatch(ctx, (std::filesystem::path(assetsRoot) / "models" / houseFiles[hi]).string(), 1024, houseBatches_[hi]);
    houseStaging_[hi].reserve(512);
  }

  fallbackPropCount_ = static_cast<uint32_t>(fallbackInst.size());
  if (fallbackPropCount_ > 0) {
    fallbackPropInstVbo_ = createBufferWithData(ctx.device(), ctx.queue(), WGPUBufferUsage_Vertex, fallbackInst.data(), fallbackInst.size() * sizeof(InstanceAttrib));
  }

  // All 16 Real GLB Vehicles (Cars, Emergency, Trucks, Speedboats, Cruisers & Helicopter!)
  // GameSession forward is +Z at yaw=0; models facing -Z (mustang, semi) receive a PI yaw offset.
  struct VehicleGlbSpec { const char* file; float length; float yawOffset; };
  const VehicleGlbSpec vehicleSpecs[kVehicleModelCount] = {
    {"police_cruiser.glb", 4.45f, 0.0f},
    {"taxi.glb",           4.45f, 0.0f},
    {"sedan.glb",          4.55f, 0.0f},
    {"mustang.glb",        4.75f, 3.14159265f},
    {"ferrari.glb",        4.45f, 0.0f},
    {"rangerover.glb",     4.95f, 0.0f},
    {"speedboat.glb",      6.20f, 0.0f},
    {"cruiser_boat.glb",   8.80f, 0.0f},
    {"heli.glb",           9.40f, 0.0f},
    {"ambulance.glb",      5.40f, 0.0f},
    {"firetruck.glb",      8.20f, 0.0f},
    {"delivery.glb",       5.80f, 0.0f},
    {"semi.glb",           9.60f, 3.14159265f},
    {"audi.glb",           4.95f, 0.0f},
    {"challenger.glb",     4.95f, 0.0f},
    {"r8.glb",             4.45f, 0.0f},
  };
  std::vector<InstanceAttrib> dummyVeh(64);
  for (size_t vi = 0; vi < kVehicleModelCount; ++vi) {
    loadGlbBatch(
      ctx,
      (std::filesystem::path(assetsRoot) / "models" / vehicleSpecs[vi].file).string(),
      dummyVeh,
      vehicleBatches_[vi],
      vehicleSpecs[vi].length,
      true,
      true,
      vehicleSpecs[vi].yawOffset
    );
  }
}

void WorldRenderer::buildSkinnedMesh(WgpuContext& ctx, const GltfModel& model, SkinnedMeshGpu& outMesh) {
  std::vector<SkinnedVertex> verts;
  std::vector<uint32_t> indices;

  // Create GPU textures for referenced material images
  std::unordered_map<int32_t, WGPUBindGroup> texBgCache;
  for (const auto& prim : model.primitives) {
    const uint32_t vBase = static_cast<uint32_t>(verts.size());
    const uint32_t iStart = static_cast<uint32_t>(indices.size());

    glm::vec3 matCol(1.0f);
    WGPUBindGroup texBg = defaultWhiteTex_.bindGroup;
    if (prim.materialIndex >= 0 && static_cast<size_t>(prim.materialIndex) < model.materials.size()) {
      const auto& mat = model.materials[prim.materialIndex];
      matCol = glm::vec3(mat.baseColor);
      if (mat.baseColorTexIndex >= 0 && static_cast<size_t>(mat.baseColorTexIndex) < model.textures.size()) {
        auto it = texBgCache.find(mat.baseColorTexIndex);
        if (it != texBgCache.end()) {
          texBg = it->second;
        } else {
          const auto& td = model.textures[mat.baseColorTexIndex];
          if (td.width > 0 && td.height > 0 && !td.rgba8.empty()) {
            GpuTextureBinding gtb = createRgbaTexture(ctx, td.width, td.height, td.rgba8.data());
            texBg = gtb.bindGroup;
            texBgCache[mat.baseColorTexIndex] = texBg;
            outMesh.ownedTextures.push_back(gtb);
            // When textured, avoid double-darkening via scalar baseColor if material uses albedo map
            matCol = glm::vec3(1.0f);
          }
        }
      }
    }

    for (const auto& v : prim.vertices) {
      verts.push_back(SkinnedVertex{
        v.position.x, v.position.y, v.position.z,
        v.normal.x, v.normal.y, v.normal.z,
        v.uv.x, v.uv.y,
        v.color.r * matCol.r, v.color.g * matCol.g, v.color.b * matCol.b,
        v.joints.x, v.joints.y, v.joints.z, v.joints.w,
        v.weights.x, v.weights.y, v.weights.z, v.weights.w
      });
    }
    for (uint32_t idx : prim.indices) {
      indices.push_back(vBase + idx);
    }

    SkinnedSubmesh sub;
    sub.indexOffset = iStart;
    sub.indexCount = static_cast<uint32_t>(indices.size()) - iStart;
    sub.texBindGroup = texBg;
    outMesh.submeshes.push_back(sub);
  }

  if (!verts.empty() && !indices.empty()) {
    outMesh.vbo = createBufferWithData(ctx.device(), ctx.queue(), WGPUBufferUsage_Vertex, verts.data(), verts.size() * sizeof(SkinnedVertex));
    outMesh.ibo = createBufferWithData(ctx.device(), ctx.queue(), WGPUBufferUsage_Index, indices.data(), indices.size() * sizeof(uint32_t));
  }
}

void WorldRenderer::render(
  WgpuContext& ctx,
  const WorldData& world,
  ChunkStreamer& streamer,
  const glm::vec3& camPos,
  const glm::vec3& camTarget,
  const glm::vec3& focusPos,
  float fovDeg,
  float timeSec,
  const SkyLightingState& sky,
  const std::vector<SkinnedRenderCharacter>& characters,
  const std::vector<VehicleEntity>& vehicles,
  const std::vector<WorldMarkerBox>& markers,
  const std::vector<DynamicPointLight>& pointLights,
  const std::vector<DynamicPropPose>& dynamicProps,
  bool drawUiCallback
) {
  const float aspect = static_cast<float>(ctx.width()) / static_cast<float>(std::max(1u, ctx.height()));
  const glm::mat4 proj = glm::perspectiveZO(glm::radians(fovDeg), aspect, 0.25f, 2800.0f);
  const glm::mat4 view = glm::lookAt(camPos, camTarget, glm::vec3(0.0f, 1.0f, 0.0f));
  const glm::mat4 vp = proj * view;

  const Frustum frustum = Frustum::fromViewProj(vp);
  streamer.update(focusPos, frustum);

  // Gather streamed buildings: route low/mid-rise buildings to real 3D GLB houses/storefronts, keep tall towers in unitBox
  buildingStaging_.clear();
  for (auto& hs : houseStaging_) hs.clear();
  uint32_t totalBuildingsDrawn = 0;
  for (const auto& v : streamer.views()) {
    if (!v.visibleInFrustum) continue;
    const auto& ch = world.chunks[v.chunkIndex];
    for (const auto& b : ch.buildings) {
      if (v.state == ChunkLodState::Lod && b.size.y < 8.0f) continue;
      const bool useHouseGlb = (b.size.y < 24.0f && std::max(b.size.x, b.size.z) < 28.0f);
      if (useHouseGlb) {
        const uint32_t hIdx = static_cast<uint32_t>(std::abs(static_cast<int>(b.center.x * 13.0f + b.center.z * 7.0f))) % kNumHouseGlbs;
        if (houseBatches_[hIdx].vbo && houseStaging_[hIdx].size() < houseBatches_[hIdx].maxInstances) {
          const float yaw = (static_cast<int>(std::abs(b.center.x + b.center.z)) % 4) * 1.5707963f;
          houseStaging_[hIdx].push_back(makeInstYaw(
            b.center.x, b.center.y, b.center.z,
            b.size.x, b.size.y, b.size.z,
            yaw,
            0.88f + 0.12f * b.color.r, 0.88f + 0.12f * b.color.g, 0.88f + 0.12f * b.color.b
          ));
          ++totalBuildingsDrawn;
          continue;
        }
      }
      if (buildingStaging_.size() < buildingCapacity_) {
        buildingStaging_.push_back(makeInstYaw(
          b.center.x, b.center.y, b.center.z,
          b.size.x, b.size.y, b.size.z,
          0.0f,
          b.color.r, b.color.g, b.color.b
        ));
        ++totalBuildingsDrawn;
      }
    }
  }
  if (!buildingStaging_.empty()) {
    wgpuQueueWriteBuffer(ctx.queue(), buildingInstVbo_, 0, buildingStaging_.data(), buildingStaging_.size() * sizeof(InstanceAttrib));
  }
  for (size_t hi = 0; hi < kNumHouseGlbs; ++hi) {
    const uint32_t cnt = static_cast<uint32_t>(houseStaging_[hi].size());
    if (cnt > 0 && houseBatches_[hi].instVbo) {
      wgpuQueueWriteBuffer(ctx.queue(), houseBatches_[hi].instVbo, 0, houseStaging_[hi].data(), cnt * sizeof(InstanceAttrib));
    }
  }

  // Upload dynamic markers, 3D pitched tracers & sparks (with emissive boost!)
  markerStaging_.clear();
  for (const auto& m : markers) {
    if (markerStaging_.size() >= markerCapacity_) break;
    const glm::quat q = glm::angleAxis(m.yawRad, glm::vec3(0.0f, 1.0f, 0.0f)) *
                        glm::angleAxis(m.pitchRad, glm::vec3(1.0f, 0.0f, 0.0f));
    markerStaging_.push_back(makeInst(m.pos.x, m.pos.y, m.pos.z, m.scale.x, m.scale.y, m.scale.z, q, m.color.r, m.color.g, m.color.b, 2.2f));
  }
  // Spinning helicopter main & tail rotor blades
  for (const auto& v : vehicles) {
    if (v.kind != VehicleModelKind::Helicopter) continue;
    if (markerStaging_.size() + 2 > markerCapacity_) break;
    const glm::quat vq = glm::angleAxis(v.yawRad, glm::vec3(0.0f, 1.0f, 0.0f)) *
                         glm::angleAxis(v.pitchRad, glm::vec3(1.0f, 0.0f, 0.0f)) *
                         glm::angleAxis(v.rollRad, glm::vec3(0.0f, 0.0f, 1.0f));
    const glm::vec3 rotorHub = v.pos + vq * glm::vec3(0.0f, 3.05f, 0.25f);
    const float rotorAngle = timeSec * (v.occupiedByPlayer ? 22.0f : 14.0f);
    const glm::quat rq1 = vq * glm::angleAxis(rotorAngle, glm::vec3(0.0f, 1.0f, 0.0f));
    const glm::quat rq2 = vq * glm::angleAxis(rotorAngle + 1.5707963f, glm::vec3(0.0f, 1.0f, 0.0f));
    markerStaging_.push_back(makeInst(rotorHub.x, rotorHub.y, rotorHub.z, 9.6f, 0.06f, 0.22f, rq1, 0.16f, 0.17f, 0.20f, 0.0f));
    markerStaging_.push_back(makeInst(rotorHub.x, rotorHub.y, rotorHub.z, 9.6f, 0.06f, 0.22f, rq2, 0.16f, 0.17f, 0.20f, 0.0f));
  }
  if (!markerStaging_.empty()) {
    wgpuQueueWriteBuffer(ctx.queue(), markerInstVbo_, 0, markerStaging_.data(), markerStaging_.size() * sizeof(InstanceAttrib));
  }

  // Upload dynamic Jolt rigid-body crates, barrels & knockable street props (full 6-DOF quaternion rotation!)
  dynPropStaging_.clear();
  for (const auto& dp : dynamicProps) {
    if (dynPropStaging_.size() >= dynPropCapacity_) break;
    dynPropStaging_.push_back(makeInst(
      dp.position.x, dp.position.y, dp.position.z,
      dp.halfExtents.x * 2.0f, dp.halfExtents.y * 2.0f, dp.halfExtents.z * 2.0f,
      dp.rotation,
      dp.color.r, dp.color.g, dp.color.b
    ));
  }
  if (!dynPropStaging_.empty()) {
    wgpuQueueWriteBuffer(ctx.queue(), dynPropInstVbo_, 0, dynPropStaging_.data(), dynPropStaging_.size() * sizeof(InstanceAttrib));
  }
  telemetry_.dynamicPhysicsProps = static_cast<uint32_t>(dynPropStaging_.size());

  // Upload dynamic vehicles across all 16 GLB models with pitch & roll (wave buoyancy / heli banking)
  uint32_t totalVehiclesDrawn = 0;
  for (auto& vs : vehicleStaging_) vs.clear();
  for (const auto& v : vehicles) {
    const size_t k = static_cast<size_t>(v.kind);
    if (k < kVehicleModelCount && vehicleStaging_[k].size() < vehicleBatches_[k].maxInstances) {
      const glm::quat q = glm::angleAxis(v.yawRad, glm::vec3(0.0f, 1.0f, 0.0f)) *
                          glm::angleAxis(v.pitchRad, glm::vec3(1.0f, 0.0f, 0.0f)) *
                          glm::angleAxis(v.rollRad, glm::vec3(0.0f, 0.0f, 1.0f));
      vehicleStaging_[k].push_back(makeInst(v.pos.x, v.pos.y, v.pos.z, 1.0f, 1.0f, 1.0f, q, v.colorTint.r, v.colorTint.g, v.colorTint.b));
    }
  }
  for (size_t k = 0; k < kVehicleModelCount; ++k) {
    const uint32_t cnt = static_cast<uint32_t>(vehicleStaging_[k].size());
    if (cnt > 0 && vehicleBatches_[k].instVbo) {
      wgpuQueueWriteBuffer(ctx.queue(), vehicleBatches_[k].instVbo, 0, vehicleStaging_[k].data(), cnt * sizeof(InstanceAttrib));
      totalVehiclesDrawn += cnt;
    }
  }

  // Compute 2-cascade texel-snapped directional sun shadow matrices
  const glm::vec3 sunDir = glm::normalize(sky.sunDir);
  const glm::vec3 shadowUp = (std::abs(sunDir.y) > 0.98f) ? glm::vec3(0.0f, 0.0f, 1.0f) : glm::vec3(0.0f, 1.0f, 0.0f);

  const float nearExt = 52.0f;
  const float nearTexel = (nearExt * 2.0f) / static_cast<float>(kShadowMapSize);
  const glm::vec3 nearCenter(
    std::floor(focusPos.x / nearTexel) * nearTexel,
    focusPos.y,
    std::floor(focusPos.z / nearTexel) * nearTexel
  );
  const glm::mat4 lightProjNear = glm::orthoZO(-nearExt, nearExt, -nearExt, nearExt, 1.0f, 360.0f);
  const glm::mat4 lightViewNear = glm::lookAt(nearCenter + sunDir * 170.0f, nearCenter, shadowUp);

  const float farExt = 260.0f;
  const float farTexel = (farExt * 2.0f) / static_cast<float>(kShadowMapSize);
  const glm::vec3 farCenter(
    std::floor(focusPos.x / farTexel) * farTexel,
    focusPos.y,
    std::floor(focusPos.z / farTexel) * farTexel
  );
  const glm::mat4 lightProjFar = glm::orthoZO(-farExt, farExt, -farExt, farExt, 1.0f, 650.0f);
  const glm::mat4 lightViewFar = glm::lookAt(farCenter + sunDir * 300.0f, farCenter, shadowUp);

  const uint32_t lightCount = static_cast<uint32_t>(std::min<size_t>(pointLights.size(), kMaxPointLights));
  telemetry_.activePointLights = lightCount;

  FrameUniforms ubo{};
  ubo.viewProj = vp;
  ubo.invViewProj = glm::inverse(vp);
  ubo.lightViewProjNear = lightProjNear * lightViewNear;
  ubo.lightViewProjFar = lightProjFar * lightViewFar;
  ubo.camPos = glm::vec4(camPos, timeSec);
  ubo.sunDir = glm::vec4(sunDir, static_cast<float>(lightCount));
  ubo.sunColor = glm::vec4(sky.sunColor * 1.38f, 1.0f);
  ubo.fogColor = glm::vec4(sky.fogColor, sky.nightFactor);
  ubo.weatherParams = glm::vec4(sky.rainIntensity, sky.wetness, sky.lightningFlash, nearExt);
  for (uint32_t li = 0; li < lightCount; ++li) {
    ubo.pointLights[li].posAndRadius = glm::vec4(pointLights[li].pos, pointLights[li].radius);
    ubo.pointLights[li].colorAndIntensity = glm::vec4(pointLights[li].color, pointLights[li].intensity);
  }
  wgpuQueueWriteBuffer(ctx.queue(), frameUbo_, 0, &ubo, sizeof(ubo));

  PostUniforms postUbo{};
  postUbo.screenSize = glm::vec4(static_cast<float>(ctx.width()), static_cast<float>(ctx.height()), 1.05f, 0.28f);
  postUbo.projParams = glm::vec4(0.25f, 2800.0f, 16.0f, 0.72f);
  wgpuQueueWriteBuffer(ctx.queue(), postUbo_, 0, &postUbo, sizeof(postUbo));

  // Upload skinned character uniform slots
  const uint32_t charCount = static_cast<uint32_t>(std::min<size_t>(characters.size(), kMaxSkinSlots));
  for (uint32_t ci = 0; ci < charCount; ++ci) {
    const auto& ch = characters[ci];
    SkinUniforms su{};
    float modelYaw = ch.yawRad;
    if (ch.part == SkinnedPartKind::Business ||
        ch.part == SkinnedPartKind::Civilian ||
        ch.part == SkinnedPartKind::Police ||
        ch.part == SkinnedPartKind::Security) {
      modelYaw += 3.14159265f;
    }
    su.model = glm::translate(glm::mat4(1.0f), ch.position) *
               glm::rotate(glm::mat4(1.0f), modelYaw, glm::vec3(0.0f, 1.0f, 0.0f));
    su.tint = ch.tint;
    if (ch.part == SkinnedPartKind::PlayerHair) {
      su.tint.a = 2.0f;
    }
    if (ch.palette) su.bones = *ch.palette;
    else su.bones.fill(glm::mat4(1.0f));
    wgpuQueueWriteBuffer(ctx.queue(), skinSlots_[ci].ubo, 0, &su, sizeof(su));
  }

  telemetry_.visibleChunks = streamer.visibleCount();
  telemetry_.nearChunks = streamer.nearCount();
  telemetry_.lodChunks = streamer.lodCount();
  telemetry_.drawnBuildings = totalBuildingsDrawn;
  telemetry_.drawnProps = static_cast<uint32_t>(world.props.size());
  telemetry_.drawnVehicles = totalVehiclesDrawn;
  telemetry_.drawnCharacters = charCount;

  WGPUSurfaceTexture surfTex{};
  WGPUTextureView backView = nullptr;
  bool ownsBackView = false;
  if (ctx.isOffscreen()) {
    backView = ctx.offscreenView();
  } else {
    wgpuSurfaceGetCurrentTexture(ctx.surface(), &surfTex);
    if (ImGui_ImplWGPU_IsSurfaceStatusError(surfTex.status) || ImGui_ImplWGPU_IsSurfaceStatusSubOptimal(surfTex.status)) {
      if (surfTex.texture) {
        wgpuTextureRelease(surfTex.texture);
        surfTex.texture = nullptr;
      }
      ctx.reconfigureSurface();
      wgpuSurfaceGetCurrentTexture(ctx.surface(), &surfTex);
      if (ImGui_ImplWGPU_IsSurfaceStatusError(surfTex.status) || !surfTex.texture) {
        if (surfTex.texture) wgpuTextureRelease(surfTex.texture);
        return;
      }
    }
    WGPUTextureViewDescriptor tvd = WGPU_TEXTURE_VIEW_DESCRIPTOR_INIT;
    tvd.format = ctx.surfaceFormat();
    tvd.dimension = WGPUTextureViewDimension_2D;
    tvd.mipLevelCount = 1;
    tvd.arrayLayerCount = 1;
    tvd.aspect = WGPUTextureAspect_All;
    backView = wgpuTextureCreateView(surfTex.texture, &tvd);
    ownsBackView = true;
  }

  // Ensure offscreen targets + depth bind groups AFTER any swapchain reconfiguration so boundDepthView_ is always live
  ensureOffscreenTargets(ctx);

  WGPUCommandEncoderDescriptor encDesc = {};
  WGPUCommandEncoder enc = wgpuDeviceCreateCommandEncoder(ctx.device(), &encDesc);

  // -------------------------------------------------------------------------
  // Pass 1A & 1B: 2-Cascade 2048x2048 Directional Sun Shadow Passes (Near 52m + Far 260m)
  // -------------------------------------------------------------------------
  const auto runShadowCascade = [&](WGPUTextureView layerView, WGPURenderPipeline terrainPipe, WGPURenderPipeline instPipe, WGPURenderPipeline skinPipe) {
    WGPURenderPassDepthStencilAttachment sDepth = WGPU_RENDER_PASS_DEPTH_STENCIL_ATTACHMENT_INIT;
    sDepth.view = layerView;
    sDepth.depthLoadOp = WGPULoadOp_Clear;
    sDepth.depthStoreOp = WGPUStoreOp_Store;
    sDepth.depthClearValue = 1.0f;

    WGPURenderPassDescriptor srp = {};
    srp.colorAttachmentCount = 0;
    srp.depthStencilAttachment = &sDepth;

    WGPURenderPassEncoder spass = wgpuCommandEncoderBeginRenderPass(enc, &srp);
    wgpuRenderPassEncoderSetBindGroup(spass, 0, frameBg_, 0, nullptr);

    if (terrainPipe && terrainIndexCount_ > 0) {
      wgpuRenderPassEncoderSetPipeline(spass, terrainPipe);
      wgpuRenderPassEncoderSetVertexBuffer(spass, 0, terrainVbo_, 0, WGPU_WHOLE_SIZE);
      wgpuRenderPassEncoderSetIndexBuffer(spass, terrainIbo_, WGPUIndexFormat_Uint32, 0, WGPU_WHOLE_SIZE);
      wgpuRenderPassEncoderDrawIndexed(spass, terrainIndexCount_, 1, 0, 0, 0);
    }

    wgpuRenderPassEncoderSetPipeline(spass, instPipe);
    if (!buildingStaging_.empty()) {
      wgpuRenderPassEncoderSetVertexBuffer(spass, 0, unitBoxVbo_, 0, WGPU_WHOLE_SIZE);
      wgpuRenderPassEncoderSetVertexBuffer(spass, 1, buildingInstVbo_, 0, WGPU_WHOLE_SIZE);
      wgpuRenderPassEncoderSetIndexBuffer(spass, unitBoxIbo_, WGPUIndexFormat_Uint32, 0, WGPU_WHOLE_SIZE);
      wgpuRenderPassEncoderDrawIndexed(spass, unitBoxIndexCount_, static_cast<uint32_t>(buildingStaging_.size()), 0, 0, 0);
    }
    for (size_t hi = 0; hi < kNumHouseGlbs; ++hi) {
      const uint32_t cnt = static_cast<uint32_t>(houseStaging_[hi].size());
      if (cnt > 0 && houseBatches_[hi].vbo) {
        wgpuRenderPassEncoderSetVertexBuffer(spass, 0, houseBatches_[hi].vbo, 0, WGPU_WHOLE_SIZE);
        wgpuRenderPassEncoderSetVertexBuffer(spass, 1, houseBatches_[hi].instVbo, 0, WGPU_WHOLE_SIZE);
        wgpuRenderPassEncoderSetIndexBuffer(spass, houseBatches_[hi].ibo, WGPUIndexFormat_Uint32, 0, WGPU_WHOLE_SIZE);
        wgpuRenderPassEncoderDrawIndexed(spass, houseBatches_[hi].indexCount, cnt, 0, 0, 0);
      }
    }
    if (!dynPropStaging_.empty() && dynPropInstVbo_) {
      wgpuRenderPassEncoderSetVertexBuffer(spass, 0, unitBoxVbo_, 0, WGPU_WHOLE_SIZE);
      wgpuRenderPassEncoderSetVertexBuffer(spass, 1, dynPropInstVbo_, 0, WGPU_WHOLE_SIZE);
      wgpuRenderPassEncoderSetIndexBuffer(spass, unitBoxIbo_, WGPUIndexFormat_Uint32, 0, WGPU_WHOLE_SIZE);
      wgpuRenderPassEncoderDrawIndexed(spass, unitBoxIndexCount_, static_cast<uint32_t>(dynPropStaging_.size()), 0, 0, 0);
    }
    for (const auto& batch : glbPropBatches_) {
      if (batch.instanceCount == 0) continue;
      wgpuRenderPassEncoderSetVertexBuffer(spass, 0, batch.vbo, 0, WGPU_WHOLE_SIZE);
      wgpuRenderPassEncoderSetVertexBuffer(spass, 1, batch.instVbo, 0, WGPU_WHOLE_SIZE);
      wgpuRenderPassEncoderSetIndexBuffer(spass, batch.ibo, WGPUIndexFormat_Uint32, 0, WGPU_WHOLE_SIZE);
      wgpuRenderPassEncoderDrawIndexed(spass, batch.indexCount, batch.instanceCount, 0, 0, 0);
    }
    for (size_t k = 0; k < kVehicleModelCount; ++k) {
      const uint32_t cnt = static_cast<uint32_t>(vehicleStaging_[k].size());
      if (cnt > 0 && vehicleBatches_[k].vbo) {
        wgpuRenderPassEncoderSetVertexBuffer(spass, 0, vehicleBatches_[k].vbo, 0, WGPU_WHOLE_SIZE);
        wgpuRenderPassEncoderSetVertexBuffer(spass, 1, vehicleBatches_[k].instVbo, 0, WGPU_WHOLE_SIZE);
        wgpuRenderPassEncoderSetIndexBuffer(spass, vehicleBatches_[k].ibo, WGPUIndexFormat_Uint32, 0, WGPU_WHOLE_SIZE);
        wgpuRenderPassEncoderDrawIndexed(spass, vehicleBatches_[k].indexCount, cnt, 0, 0, 0);
      }
    }

    if (charCount > 0) {
      wgpuRenderPassEncoderSetPipeline(spass, skinPipe);
      wgpuRenderPassEncoderSetBindGroup(spass, 0, frameBg_, 0, nullptr);
      for (uint32_t ci = 0; ci < charCount; ++ci) {
        wgpuRenderPassEncoderSetBindGroup(spass, 1, skinSlots_[ci].bindGroup, 0, nullptr);
        const auto drawSkinShadow = [&](const SkinnedMeshGpu& mesh) {
          if (!mesh.vbo || !mesh.ibo) return;
          wgpuRenderPassEncoderSetVertexBuffer(spass, 0, mesh.vbo, 0, WGPU_WHOLE_SIZE);
          wgpuRenderPassEncoderSetIndexBuffer(spass, mesh.ibo, WGPUIndexFormat_Uint32, 0, WGPU_WHOLE_SIZE);
          for (const auto& sub : mesh.submeshes) {
            wgpuRenderPassEncoderDrawIndexed(spass, sub.indexCount, 1, sub.indexOffset, 0, 0);
          }
        };
        switch (characters[ci].part) {
          case SkinnedPartKind::PlayerBody: drawSkinShadow(playerBodyGpu_); break;
          case SkinnedPartKind::PlayerShorts: drawSkinShadow(playerShortsGpu_); break;
          case SkinnedPartKind::PlayerHair: drawSkinShadow(playerHairGpu_); break;
          case SkinnedPartKind::Business: drawSkinShadow(businessGpu_); break;
          case SkinnedPartKind::Civilian: drawSkinShadow(civilianGpu_); break;
          case SkinnedPartKind::Police: drawSkinShadow(policeGpu_); break;
          case SkinnedPartKind::Security: drawSkinShadow(securityGpu_); break;
        }
      }
    }

    wgpuRenderPassEncoderEnd(spass);
    wgpuRenderPassEncoderRelease(spass);
  };

  runShadowCascade(shadowLayerViews_[0], shadowTerrainNearPipeline_, shadowInstancedNearPipeline_, shadowSkinnedNearPipeline_);
  runShadowCascade(shadowLayerViews_[1], shadowTerrainFarPipeline_, shadowInstancedFarPipeline_, shadowSkinnedFarPipeline_);

  // -------------------------------------------------------------------------
  // Pass 2: Main Linear HDR Forward PBR + 2-Cascade Shadows Scene Pass
  // -------------------------------------------------------------------------
  {
    WGPURenderPassColorAttachment colorAtt = WGPU_RENDER_PASS_COLOR_ATTACHMENT_INIT;
    colorAtt.view = hdrView_;
    colorAtt.depthSlice = WGPU_DEPTH_SLICE_UNDEFINED;
    colorAtt.loadOp = WGPULoadOp_Clear;
    colorAtt.storeOp = WGPUStoreOp_Store;
    colorAtt.clearValue = {sky.clearColor.r, sky.clearColor.g, sky.clearColor.b, 1.0};

    WGPURenderPassDepthStencilAttachment depthAtt = WGPU_RENDER_PASS_DEPTH_STENCIL_ATTACHMENT_INIT;
    depthAtt.view = ctx.depthView();
    depthAtt.depthLoadOp = WGPULoadOp_Clear;
    depthAtt.depthStoreOp = WGPUStoreOp_Store;
    depthAtt.depthClearValue = 1.0f;

    WGPURenderPassDescriptor rpDesc = {};
    rpDesc.colorAttachmentCount = 1;
    rpDesc.colorAttachments = &colorAtt;
    rpDesc.depthStencilAttachment = &depthAtt;

    WGPURenderPassEncoder pass = wgpuCommandEncoderBeginRenderPass(enc, &rpDesc);

    // Sky Dome + FBM Clouds + Sun + Moon + Stars (fullscreen atmospheric pass)
    if (skyPipeline_) {
      wgpuRenderPassEncoderSetPipeline(pass, skyPipeline_);
      wgpuRenderPassEncoderSetBindGroup(pass, 0, frameBg_, 0, nullptr);
      wgpuRenderPassEncoderDraw(pass, 3, 1, 0, 0);
    }

    wgpuRenderPassEncoderSetBindGroup(pass, 0, frameBg_, 0, nullptr);
    wgpuRenderPassEncoderSetBindGroup(pass, 1, skinSlots_[0].bindGroup, 0, nullptr);
    wgpuRenderPassEncoderSetBindGroup(pass, 2, defaultWhiteTex_.bindGroup, 0, nullptr);
    wgpuRenderPassEncoderSetBindGroup(pass, 3, shadowReadBg_, 0, nullptr);

    // Terrain + Depth-Tinted Ocean
    wgpuRenderPassEncoderSetPipeline(pass, terrainPipeline_);
    wgpuRenderPassEncoderSetVertexBuffer(pass, 0, terrainVbo_, 0, WGPU_WHOLE_SIZE);
    wgpuRenderPassEncoderSetIndexBuffer(pass, terrainIbo_, WGPUIndexFormat_Uint32, 0, WGPU_WHOLE_SIZE);
    wgpuRenderPassEncoderDrawIndexed(pass, terrainIndexCount_, 1, 0, 0, 0);

    // Roads + Iron Pit Ring
    if (roadIndexCount_ > 0) {
      wgpuRenderPassEncoderSetVertexBuffer(pass, 0, roadVbo_, 0, WGPU_WHOLE_SIZE);
      wgpuRenderPassEncoderSetIndexBuffer(pass, roadIbo_, WGPUIndexFormat_Uint32, 0, WGPU_WHOLE_SIZE);
      wgpuRenderPassEncoderDrawIndexed(pass, roadIndexCount_, 1, 0, 0, 0);
    }

    // Helper for multi-submesh textured GLB instanced batches
    const auto drawGlbBatch = [&](const InstancedGlbBatch& batch, uint32_t count) {
      if (count == 0 || !batch.vbo || !batch.ibo) return;
      wgpuRenderPassEncoderSetVertexBuffer(pass, 0, batch.vbo, 0, WGPU_WHOLE_SIZE);
      wgpuRenderPassEncoderSetVertexBuffer(pass, 1, batch.instVbo, 0, WGPU_WHOLE_SIZE);
      wgpuRenderPassEncoderSetIndexBuffer(pass, batch.ibo, WGPUIndexFormat_Uint32, 0, WGPU_WHOLE_SIZE);
      if (batch.submeshes.empty()) {
        wgpuRenderPassEncoderSetBindGroup(pass, 2, defaultWhiteTex_.bindGroup, 0, nullptr);
        wgpuRenderPassEncoderDrawIndexed(pass, batch.indexCount, count, 0, 0, 0);
      } else {
        for (const auto& sub : batch.submeshes) {
          wgpuRenderPassEncoderSetBindGroup(pass, 2, sub.texBindGroup ? sub.texBindGroup : defaultWhiteTex_.bindGroup, 0, nullptr);
          wgpuRenderPassEncoderDrawIndexed(pass, sub.indexCount, count, sub.indexOffset, 0, 0);
        }
      }
    };

    // Instanced Buildings, Textured GLB Houses/Props/Vehicles, Fallback Street Props, Dynamic Props, Markers
    wgpuRenderPassEncoderSetPipeline(pass, instancedPipeline_);
    if (!buildingStaging_.empty()) {
      wgpuRenderPassEncoderSetBindGroup(pass, 2, defaultWhiteTex_.bindGroup, 0, nullptr);
      wgpuRenderPassEncoderSetVertexBuffer(pass, 0, unitBoxVbo_, 0, WGPU_WHOLE_SIZE);
      wgpuRenderPassEncoderSetVertexBuffer(pass, 1, buildingInstVbo_, 0, WGPU_WHOLE_SIZE);
      wgpuRenderPassEncoderSetIndexBuffer(pass, unitBoxIbo_, WGPUIndexFormat_Uint32, 0, WGPU_WHOLE_SIZE);
      wgpuRenderPassEncoderDrawIndexed(pass, unitBoxIndexCount_, static_cast<uint32_t>(buildingStaging_.size()), 0, 0, 0);
    }
    for (size_t hi = 0; hi < kNumHouseGlbs; ++hi) {
      drawGlbBatch(houseBatches_[hi], static_cast<uint32_t>(houseStaging_[hi].size()));
    }
    if (fallbackPropCount_ > 0 && fallbackPropInstVbo_) {
      wgpuRenderPassEncoderSetBindGroup(pass, 2, defaultWhiteTex_.bindGroup, 0, nullptr);
      wgpuRenderPassEncoderSetVertexBuffer(pass, 0, unitBoxVbo_, 0, WGPU_WHOLE_SIZE);
      wgpuRenderPassEncoderSetVertexBuffer(pass, 1, fallbackPropInstVbo_, 0, WGPU_WHOLE_SIZE);
      wgpuRenderPassEncoderSetIndexBuffer(pass, unitBoxIbo_, WGPUIndexFormat_Uint32, 0, WGPU_WHOLE_SIZE);
      wgpuRenderPassEncoderDrawIndexed(pass, unitBoxIndexCount_, fallbackPropCount_, 0, 0, 0);
    }
    for (const auto& batch : glbPropBatches_) {
      drawGlbBatch(batch, batch.instanceCount);
    }
    if (!markerStaging_.empty() && markerInstVbo_) {
      wgpuRenderPassEncoderSetBindGroup(pass, 2, defaultWhiteTex_.bindGroup, 0, nullptr);
      wgpuRenderPassEncoderSetVertexBuffer(pass, 0, unitBoxVbo_, 0, WGPU_WHOLE_SIZE);
      wgpuRenderPassEncoderSetVertexBuffer(pass, 1, markerInstVbo_, 0, WGPU_WHOLE_SIZE);
      wgpuRenderPassEncoderSetIndexBuffer(pass, unitBoxIbo_, WGPUIndexFormat_Uint32, 0, WGPU_WHOLE_SIZE);
      wgpuRenderPassEncoderDrawIndexed(pass, unitBoxIndexCount_, static_cast<uint32_t>(markerStaging_.size()), 0, 0, 0);
    }
    if (!dynPropStaging_.empty() && dynPropInstVbo_) {
      wgpuRenderPassEncoderSetBindGroup(pass, 2, defaultWhiteTex_.bindGroup, 0, nullptr);
      wgpuRenderPassEncoderSetVertexBuffer(pass, 0, unitBoxVbo_, 0, WGPU_WHOLE_SIZE);
      wgpuRenderPassEncoderSetVertexBuffer(pass, 1, dynPropInstVbo_, 0, WGPU_WHOLE_SIZE);
      wgpuRenderPassEncoderSetIndexBuffer(pass, unitBoxIbo_, WGPUIndexFormat_Uint32, 0, WGPU_WHOLE_SIZE);
      wgpuRenderPassEncoderDrawIndexed(pass, unitBoxIndexCount_, static_cast<uint32_t>(dynPropStaging_.size()), 0, 0, 0);
    }
    for (size_t k = 0; k < kVehicleModelCount; ++k) {
      drawGlbBatch(vehicleBatches_[k], static_cast<uint32_t>(vehicleStaging_[k].size()));
    }

    // Skinned Textured Characters (Player + City Pedestrians + Police + Contract Targets + Iron Pit)
    if (charCount > 0) {
      wgpuRenderPassEncoderSetPipeline(pass, skinnedPipeline_);
      for (uint32_t ci = 0; ci < charCount; ++ci) {
        wgpuRenderPassEncoderSetBindGroup(pass, 1, skinSlots_[ci].bindGroup, 0, nullptr);
        const auto drawSkinFwd = [&](const SkinnedMeshGpu& mesh) {
          if (!mesh.vbo || !mesh.ibo) return;
          wgpuRenderPassEncoderSetVertexBuffer(pass, 0, mesh.vbo, 0, WGPU_WHOLE_SIZE);
          wgpuRenderPassEncoderSetIndexBuffer(pass, mesh.ibo, WGPUIndexFormat_Uint32, 0, WGPU_WHOLE_SIZE);
          for (const auto& sub : mesh.submeshes) {
            wgpuRenderPassEncoderSetBindGroup(pass, 2, sub.texBindGroup ? sub.texBindGroup : defaultWhiteTex_.bindGroup, 0, nullptr);
            wgpuRenderPassEncoderDrawIndexed(pass, sub.indexCount, 1, sub.indexOffset, 0, 0);
          }
        };
        switch (characters[ci].part) {
          case SkinnedPartKind::PlayerBody: drawSkinFwd(playerBodyGpu_); break;
          case SkinnedPartKind::PlayerShorts: drawSkinFwd(playerShortsGpu_); break;
          case SkinnedPartKind::PlayerHair: drawSkinFwd(playerHairGpu_); break;
          case SkinnedPartKind::Business: drawSkinFwd(businessGpu_); break;
          case SkinnedPartKind::Civilian: drawSkinFwd(civilianGpu_); break;
          case SkinnedPartKind::Police: drawSkinFwd(policeGpu_); break;
          case SkinnedPartKind::Security: drawSkinFwd(securityGpu_); break;
        }
      }
    }

    wgpuRenderPassEncoderEnd(pass);
    wgpuRenderPassEncoderRelease(pass);
  }

  // -------------------------------------------------------------------------
  // Passes 3-7: Half-Res SSAO + Quarter-Res Bloom + ACES Composite Tonemap
  // -------------------------------------------------------------------------
  const auto runFullscreenPost = [&](WGPUTextureView targetView, WGPURenderPipeline pipe, WGPUBindGroup bg) {
    if (!targetView || !pipe || !bg) return;
    WGPURenderPassColorAttachment att = WGPU_RENDER_PASS_COLOR_ATTACHMENT_INIT;
    att.view = targetView;
    att.depthSlice = WGPU_DEPTH_SLICE_UNDEFINED;
    att.loadOp = WGPULoadOp_Clear;
    att.storeOp = WGPUStoreOp_Store;
    att.clearValue = {0.0, 0.0, 0.0, 1.0};

    WGPURenderPassDescriptor rpd = {};
    rpd.colorAttachmentCount = 1;
    rpd.colorAttachments = &att;

    WGPURenderPassEncoder p = wgpuCommandEncoderBeginRenderPass(enc, &rpd);
    wgpuRenderPassEncoderSetPipeline(p, pipe);
    wgpuRenderPassEncoderSetBindGroup(p, 0, bg, 0, nullptr);
    wgpuRenderPassEncoderDraw(p, 3, 1, 0, 0);
    wgpuRenderPassEncoderEnd(p);
    wgpuRenderPassEncoderRelease(p);
  };

  runFullscreenPost(ssaoView_, ssaoPipeline_, postBgSSAO_);
  runFullscreenPost(bloomViewA_, bloomThreshPipeline_, postBgThresh_);
  runFullscreenPost(bloomViewB_, bloomBlurHPipeline_, postBgBlurH_);
  runFullscreenPost(bloomViewA_, bloomBlurVPipeline_, postBgBlurV_);
  runFullscreenPost(backView, compositePipeline_, postBgComposite_);

  // -------------------------------------------------------------------------
  // Pass 8: Dear ImGui Native HUD Pass
  // -------------------------------------------------------------------------
  if (drawUiCallback) {
    WGPURenderPassColorAttachment uiAtt = WGPU_RENDER_PASS_COLOR_ATTACHMENT_INIT;
    uiAtt.view = backView;
    uiAtt.depthSlice = WGPU_DEPTH_SLICE_UNDEFINED;
    uiAtt.loadOp = WGPULoadOp_Load;
    uiAtt.storeOp = WGPUStoreOp_Store;

    WGPURenderPassDescriptor uiRp = {};
    uiRp.colorAttachmentCount = 1;
    uiRp.colorAttachments = &uiAtt;

    WGPURenderPassEncoder uiPass = wgpuCommandEncoderBeginRenderPass(enc, &uiRp);
    ImGui_ImplWGPU_RenderDrawData(ImGui::GetDrawData(), uiPass);
    wgpuRenderPassEncoderEnd(uiPass);
    wgpuRenderPassEncoderRelease(uiPass);
  }

  WGPUCommandBufferDescriptor cmdDesc = {};
  WGPUCommandBuffer cmd = wgpuCommandEncoderFinish(enc, &cmdDesc);
  wgpuQueueSubmit(ctx.queue(), 1, &cmd);
  if (!ctx.isOffscreen() && ctx.surface()) {
    wgpuSurfacePresent(ctx.surface());
  }

  wgpuCommandBufferRelease(cmd);
  wgpuCommandEncoderRelease(enc);
  if (ownsBackView && backView) wgpuTextureViewRelease(backView);
  if (surfTex.texture) wgpuTextureRelease(surfTex.texture);
}

void WorldRenderer::shutdown() {
  releaseOffscreenTargets();

  auto relBuf = [](WGPUBuffer& b) {
    if (b) { wgpuBufferRelease(b); b = nullptr; }
  };
  auto relTex = [](GpuTextureBinding& t) {
    if (t.bindGroup) { wgpuBindGroupRelease(t.bindGroup); t.bindGroup = nullptr; }
    if (t.view) { wgpuTextureViewRelease(t.view); t.view = nullptr; }
    if (t.texture) { wgpuTextureRelease(t.texture); t.texture = nullptr; }
  };
  auto relBatch = [&](InstancedGlbBatch& b) {
    relBuf(b.vbo);
    relBuf(b.ibo);
    relBuf(b.instVbo);
    for (auto& t : b.ownedTextures) relTex(t);
    b.ownedTextures.clear();
    b.submeshes.clear();
    b.indexCount = 0;
    b.instanceCount = 0;
  };
  auto relSkin = [&](SkinnedMeshGpu& m) {
    relBuf(m.vbo);
    relBuf(m.ibo);
    for (auto& t : m.ownedTextures) relTex(t);
    m.ownedTextures.clear();
    m.submeshes.clear();
  };

  relBuf(terrainVbo_);
  relBuf(terrainIbo_);
  relBuf(roadVbo_);
  relBuf(roadIbo_);
  relBuf(unitBoxVbo_);
  relBuf(unitBoxIbo_);
  relBuf(buildingInstVbo_);
  relBuf(fallbackPropInstVbo_);
  relBuf(markerInstVbo_);
  relBuf(dynPropInstVbo_);
  relBuf(frameUbo_);
  relBuf(postUbo_);
  for (auto& s : skinSlots_) {
    relBuf(s.ubo);
    if (s.bindGroup) { wgpuBindGroupRelease(s.bindGroup); s.bindGroup = nullptr; }
  }
  for (auto& b : glbPropBatches_) relBatch(b);
  glbPropBatches_.clear();
  for (auto& hb : houseBatches_) relBatch(hb);
  for (auto& vb : vehicleBatches_) relBatch(vb);
  relSkin(playerBodyGpu_);
  relSkin(playerShortsGpu_);
  relSkin(playerHairGpu_);
  relSkin(businessGpu_);
  relSkin(civilianGpu_);
  relSkin(policeGpu_);
  relSkin(securityGpu_);
  relTex(defaultWhiteTex_);

  for (auto& lv : shadowLayerViews_) {
    if (lv) { wgpuTextureViewRelease(lv); lv = nullptr; }
  }
  if (shadowArrayView_) { wgpuTextureViewRelease(shadowArrayView_); shadowArrayView_ = nullptr; }
  if (shadowTex_) { wgpuTextureRelease(shadowTex_); shadowTex_ = nullptr; }
  if (shadowSampler_) { wgpuSamplerRelease(shadowSampler_); shadowSampler_ = nullptr; }
  if (linearSampler_) { wgpuSamplerRelease(linearSampler_); linearSampler_ = nullptr; }

  auto relPipe = [](WGPURenderPipeline& p) {
    if (p) { wgpuRenderPipelineRelease(p); p = nullptr; }
  };
  relPipe(shadowTerrainNearPipeline_);
  relPipe(shadowTerrainFarPipeline_);
  relPipe(shadowInstancedNearPipeline_);
  relPipe(shadowInstancedFarPipeline_);
  relPipe(shadowSkinnedNearPipeline_);
  relPipe(shadowSkinnedFarPipeline_);
  relPipe(skyPipeline_);
  relPipe(terrainPipeline_);
  relPipe(instancedPipeline_);
  relPipe(skinnedPipeline_);
  relPipe(ssaoPipeline_);
  relPipe(bloomThreshPipeline_);
  relPipe(bloomBlurHPipeline_);
  relPipe(bloomBlurVPipeline_);
  relPipe(compositePipeline_);

  if (shadowStaticPipeLayout_) { wgpuPipelineLayoutRelease(shadowStaticPipeLayout_); shadowStaticPipeLayout_ = nullptr; }
  if (shadowSkinnedPipeLayout_) { wgpuPipelineLayoutRelease(shadowSkinnedPipeLayout_); shadowSkinnedPipeLayout_ = nullptr; }
  if (scenePipeLayout_) { wgpuPipelineLayoutRelease(scenePipeLayout_); scenePipeLayout_ = nullptr; }
  if (postPipeLayout_) { wgpuPipelineLayoutRelease(postPipeLayout_); postPipeLayout_ = nullptr; }
  if (shadowReadBg_) { wgpuBindGroupRelease(shadowReadBg_); shadowReadBg_ = nullptr; }
  if (frameBg_) { wgpuBindGroupRelease(frameBg_); frameBg_ = nullptr; }
  if (shadowReadBgl_) { wgpuBindGroupLayoutRelease(shadowReadBgl_); shadowReadBgl_ = nullptr; }
  if (frameBgl_) { wgpuBindGroupLayoutRelease(frameBgl_); frameBgl_ = nullptr; }
  if (skinBgl_) { wgpuBindGroupLayoutRelease(skinBgl_); skinBgl_ = nullptr; }
  if (matBgl_) { wgpuBindGroupLayoutRelease(matBgl_); matBgl_ = nullptr; }
  if (postBgl_) { wgpuBindGroupLayoutRelease(postBgl_); postBgl_ = nullptr; }
  if (shader_) { wgpuShaderModuleRelease(shader_); shader_ = nullptr; }
  if (postShader_) { wgpuShaderModuleRelease(postShader_); postShader_ = nullptr; }
}

} // namespace westgate
