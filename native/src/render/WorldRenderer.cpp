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
#include <utility>
#include <vector>

namespace westgate {

namespace {

constexpr uint32_t kShadowMapSize = 2048;

InstanceAttrib makeInst(
  float x, float y, float z,
  float sx, float sy, float sz,
  const glm::quat& q,
  float r, float g, float b,
  float emissive = 0.0f,
  float overrideRoughness = -1.0f,
  float familyAndMetal = 0.0f
) {
  return InstanceAttrib{x, y, z, sx, sy, sz, q.x, q.y, q.z, q.w, r, g, b, emissive, overrideRoughness, familyAndMetal};
}

InstanceAttrib makeInstYaw(
  float x, float y, float z,
  float sx, float sy, float sz,
  float yawRad,
  float r, float g, float b,
  float emissive = 0.0f,
  float overrideRoughness = -1.0f,
  float familyAndMetal = 0.0f
) {
  const glm::quat q = glm::angleAxis(yawRad, glm::vec3(0.0f, 1.0f, 0.0f));
  return makeInst(x, y, z, sx, sy, sz, q, r, g, b, emissive, overrideRoughness, familyAndMetal);
}

InstanceAttrib makeArchBoxInst(const PackedArchBox& b) {
  constexpr float invQ = 1.0f / 32767.0f;
  constexpr float inv255 = 1.0f / 255.0f;
  glm::quat q(b.qw * invQ, b.qx * invQ, b.qy * invQ, b.qz * invQ);
  const float qLen = glm::length(q);
  if (qLen > 1e-4f) q /= qLen;
  else q = glm::quat(1.0f, 0.0f, 0.0f, 0.0f);

  const float rough = std::clamp(b.rough * inv255, 0.05f, 0.98f);
  const float metal = std::clamp(b.metal * inv255, 0.0f, 1.0f);
  const float fam = static_cast<float>(std::min<uint8_t>(b.family, 9u));
  return InstanceAttrib{
    b.cx, b.cy, b.cz,
    b.hx * 2.0f, b.hy * 2.0f, b.hz * 2.0f,
    q.x, q.y, q.z, q.w,
    b.r * inv255, b.g * inv255, b.b * inv255,
    (b.emissive * inv255) * 4.0f,
    rough,
    fam + metal * 0.49f
  };
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

bool sphereInFrustum(const Frustum& f, const glm::vec3& c, float r) {
  for (const auto& pl : f.planes) {
    if (pl.x * c.x + pl.y * c.y + pl.z * c.z + pl.w < -r) return false;
  }
  return true;
}

bool aabbOverlapsXZ(const AABB& b, const glm::vec3& center, float halfExt) {
  return b.max.x >= center.x - halfExt && b.min.x <= center.x + halfExt &&
         b.max.z >= center.z - halfExt && b.min.z <= center.z + halfExt;
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

WGPUBindGroup WorldRenderer::createPbrMatBindGroup(
  WgpuContext& ctx,
  WGPUTextureView albedoView,
  WGPUTextureView normalView,
  WGPUTextureView mrView,
  WGPUTextureView emissiveView
) {
  WGPUBindGroupEntry entries[5]{};
  entries[0] = WGPU_BIND_GROUP_ENTRY_INIT;
  entries[0].binding = 0;
  entries[0].textureView = albedoView ? albedoView : defaultWhiteTex_.view;

  entries[1] = WGPU_BIND_GROUP_ENTRY_INIT;
  entries[1].binding = 1;
  entries[1].sampler = repeatSampler_;

  entries[2] = WGPU_BIND_GROUP_ENTRY_INIT;
  entries[2].binding = 2;
  entries[2].textureView = normalView ? normalView : defaultFlatNormalTex_.view;

  entries[3] = WGPU_BIND_GROUP_ENTRY_INIT;
  entries[3].binding = 3;
  entries[3].textureView = mrView ? mrView : defaultWhiteTex_.view;

  entries[4] = WGPU_BIND_GROUP_ENTRY_INIT;
  entries[4].binding = 4;
  entries[4].textureView = emissiveView ? emissiveView : defaultWhiteTex_.view;

  WGPUBindGroupDescriptor bgd = WGPU_BIND_GROUP_DESCRIPTOR_INIT;
  bgd.layout = matBgl_;
  bgd.entryCount = 5;
  bgd.entries = entries;
  return wgpuDeviceCreateBindGroup(ctx.device(), &bgd);
}

WorldRenderer::GpuTextureBinding WorldRenderer::createRgbaTexture(
  WgpuContext& ctx,
  uint32_t w,
  uint32_t h,
  const uint8_t* rgba8,
  bool createDefaultMatBg
) {
  // Prefilter oversized >1024 textures via 2x box downsample to save VRAM & prevent subpixel aliasing
  std::vector<uint8_t> downsampled;
  uint32_t curW = w;
  uint32_t curH = h;
  const uint8_t* srcPtr = rgba8;
  while ((curW > 1024 || curH > 1024) && curW >= 2 && curH >= 2) {
    const uint32_t nw = curW / 2;
    const uint32_t nh = curH / 2;
    std::vector<uint8_t> next(static_cast<size_t>(nw) * nh * 4);
    for (uint32_t y = 0; y < nh; ++y) {
      for (uint32_t x = 0; x < nw; ++x) {
        const size_t i00 = (static_cast<size_t>(y * 2) * curW + (x * 2)) * 4;
        const size_t i10 = i00 + 4;
        const size_t i01 = i00 + static_cast<size_t>(curW) * 4;
        const size_t i11 = i01 + 4;
        const size_t dstIdx = (static_cast<size_t>(y) * nw + x) * 4;
        for (size_t c = 0; c < 4; ++c) {
          next[dstIdx + c] = static_cast<uint8_t>((
            uint32_t(srcPtr[i00 + c]) + uint32_t(srcPtr[i10 + c]) +
            uint32_t(srcPtr[i01 + c]) + uint32_t(srcPtr[i11 + c]) + 2u
          ) >> 2);
        }
      }
    }
    downsampled = std::move(next);
    srcPtr = downsampled.data();
    curW = nw;
    curH = nh;
  }

  GpuTextureBinding out{};
  WGPUTextureDescriptor td = WGPU_TEXTURE_DESCRIPTOR_INIT;
  td.usage = WGPUTextureUsage_TextureBinding | WGPUTextureUsage_CopyDst;
  td.dimension = WGPUTextureDimension_2D;
  td.size = {curW, curH, 1};
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
  layout.bytesPerRow = curW * 4;
  layout.rowsPerImage = curH;
  WGPUExtent3D ext{curW, curH, 1};
  wgpuQueueWriteTexture(ctx.queue(), &dst, srcPtr, static_cast<size_t>(curW) * curH * 4, &layout, &ext);

  WGPUTextureViewDescriptor tvd = WGPU_TEXTURE_VIEW_DESCRIPTOR_INIT;
  tvd.format = WGPUTextureFormat_RGBA8Unorm;
  tvd.dimension = WGPUTextureViewDimension_2D;
  tvd.mipLevelCount = 1;
  tvd.arrayLayerCount = 1;
  tvd.aspect = WGPUTextureAspect_All;
  out.view = wgpuTextureCreateView(out.texture, &tvd);

  if (createDefaultMatBg && defaultFlatNormalTex_.view && defaultWhiteTex_.view) {
    out.bindGroup = createPbrMatBindGroup(ctx, out.view, defaultFlatNormalTex_.view, defaultWhiteTex_.view, defaultWhiteTex_.view);
  }
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

    // Repeat sampler for 3D PBR material textures (GLB tiled roofs, brick, roads, KHR_texture_transform)
    WGPUSamplerDescriptor rsd = WGPU_SAMPLER_DESCRIPTOR_INIT;
    rsd.addressModeU = WGPUAddressMode_Repeat;
    rsd.addressModeV = WGPUAddressMode_Repeat;
    rsd.addressModeW = WGPUAddressMode_Repeat;
    rsd.magFilter = WGPUFilterMode_Linear;
    rsd.minFilter = WGPUFilterMode_Linear;
    rsd.mipmapFilter = WGPUMipmapFilterMode_Linear;
    repeatSampler_ = wgpuDeviceCreateSampler(ctx.device(), &rsd);

    // ClampToEdge sampler for screen-space Post-FX passes (SSAO, Bloom, Composite)
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

  // @group(0): FrameUniforms
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

  // @group(3): 2-Cascade shadowMap + shadowSampler
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

  // @group(2): Full PBR Material BindGroup (albedoTex, repeatSampler, normalTex, mrTex, emissiveTex)
  {
    WGPUBindGroupLayoutEntry entries[5]{};
    auto initTexEntry = [&](uint32_t binding) {
      WGPUBindGroupLayoutEntry e = WGPU_BIND_GROUP_LAYOUT_ENTRY_INIT;
      e.binding = binding;
      e.visibility = WGPUShaderStage_Fragment;
      e.texture.sampleType = WGPUTextureSampleType_Float;
      e.texture.viewDimension = WGPUTextureViewDimension_2D;
      return e;
    };
    entries[0] = initTexEntry(0);
    entries[1] = WGPU_BIND_GROUP_LAYOUT_ENTRY_INIT;
    entries[1].binding = 1;
    entries[1].visibility = WGPUShaderStage_Fragment;
    entries[1].sampler.type = WGPUSamplerBindingType_Filtering;
    entries[2] = initTexEntry(2);
    entries[3] = initTexEntry(3);
    entries[4] = initTexEntry(4);

    WGPUBindGroupLayoutDescriptor bglDesc = WGPU_BIND_GROUP_LAYOUT_DESCRIPTOR_INIT;
    bglDesc.entryCount = 5;
    bglDesc.entries = entries;
    matBgl_ = wgpuDeviceCreateBindGroupLayout(ctx.device(), &bglDesc);

    const uint8_t white[4] = {255, 255, 255, 255};
    const uint8_t flatNorm[4] = {128, 128, 255, 255};
    defaultWhiteTex_ = createRgbaTexture(ctx, 1, 1, white, false);
    defaultFlatNormalTex_ = createRgbaTexture(ctx, 1, 1, flatNorm, false);
    defaultWhiteTex_.bindGroup = createPbrMatBindGroup(
      ctx,
      defaultWhiteTex_.view,
      defaultFlatNormalTex_.view,
      defaultWhiteTex_.view,
      defaultWhiteTex_.view
    );
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

  // Post-FX bind group layout
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

  // PackedWorldVertex (28 bytes) layout
  WGPUVertexAttribute customMeshAttrs[5]{};
  customMeshAttrs[0] = {nullptr, WGPUVertexFormat_Float32x3, offsetof(PackedWorldVertex, px), 0};
  customMeshAttrs[1] = {nullptr, WGPUVertexFormat_Sint8x4,   offsetof(PackedWorldVertex, nx), 1};
  customMeshAttrs[2] = {nullptr, WGPUVertexFormat_Sint16x2,  offsetof(PackedWorldVertex, u),  2};
  customMeshAttrs[3] = {nullptr, WGPUVertexFormat_Unorm8x4,  offsetof(PackedWorldVertex, r),  3};
  customMeshAttrs[4] = {nullptr, WGPUVertexFormat_Unorm8x4,  offsetof(PackedWorldVertex, rough), 4};
  WGPUVertexBufferLayout customMeshVbl = WGPU_VERTEX_BUFFER_LAYOUT_INIT;
  customMeshVbl.stepMode = WGPUVertexStepMode_Vertex;
  customMeshVbl.arrayStride = sizeof(PackedWorldVertex);
  customMeshVbl.attributeCount = 5;
  customMeshVbl.attributes = customMeshAttrs;

  WGPUVertexAttribute customInstAttrs[5]{};
  customInstAttrs[0] = {nullptr, WGPUVertexFormat_Float32x3, offsetof(InstanceAttrib, x), 5};
  customInstAttrs[1] = {nullptr, WGPUVertexFormat_Float32x3, offsetof(InstanceAttrib, sx), 6};
  customInstAttrs[2] = {nullptr, WGPUVertexFormat_Float32x4, offsetof(InstanceAttrib, qx), 7};
  customInstAttrs[3] = {nullptr, WGPUVertexFormat_Float32x4, offsetof(InstanceAttrib, r), 8};
  customInstAttrs[4] = {nullptr, WGPUVertexFormat_Float32x2, offsetof(InstanceAttrib, overrideRoughness), 9};
  WGPUVertexBufferLayout customInstVbls[2]{};
  customInstVbls[0] = customMeshVbl;
  customInstVbls[1] = WGPU_VERTEX_BUFFER_LAYOUT_INIT;
  customInstVbls[1].stepMode = WGPUVertexStepMode_Instance;
  customInstVbls[1].arrayStride = sizeof(InstanceAttrib);
  customInstVbls[1].attributeCount = 5;
  customInstVbls[1].attributes = customInstAttrs;

  WGPUVertexAttribute modelAttrs[5]{};
  modelAttrs[0] = {nullptr, WGPUVertexFormat_Float32x3, offsetof(ModelVertex, px), 0};
  modelAttrs[1] = {nullptr, WGPUVertexFormat_Float32x3, offsetof(ModelVertex, nx), 1};
  modelAttrs[2] = {nullptr, WGPUVertexFormat_Float32x2, offsetof(ModelVertex, u), 2};
  modelAttrs[3] = {nullptr, WGPUVertexFormat_Float32x3, offsetof(ModelVertex, r), 3};
  modelAttrs[4] = {nullptr, WGPUVertexFormat_Float32x2, offsetof(ModelVertex, metallic), 8};
  WGPUVertexAttribute instAttrs[5]{};
  instAttrs[0] = {nullptr, WGPUVertexFormat_Float32x3, offsetof(InstanceAttrib, x), 4};
  instAttrs[1] = {nullptr, WGPUVertexFormat_Float32x3, offsetof(InstanceAttrib, sx), 5};
  instAttrs[2] = {nullptr, WGPUVertexFormat_Float32x4, offsetof(InstanceAttrib, qx), 6};
  instAttrs[3] = {nullptr, WGPUVertexFormat_Float32x4, offsetof(InstanceAttrib, r), 7};
  instAttrs[4] = {nullptr, WGPUVertexFormat_Float32x2, offsetof(InstanceAttrib, overrideRoughness), 9};
  WGPUVertexBufferLayout instVbls[2]{};
  instVbls[0] = WGPU_VERTEX_BUFFER_LAYOUT_INIT;
  instVbls[0].stepMode = WGPUVertexStepMode_Vertex;
  instVbls[0].arrayStride = sizeof(ModelVertex);
  instVbls[0].attributeCount = 5;
  instVbls[0].attributes = modelAttrs;
  instVbls[1] = WGPU_VERTEX_BUFFER_LAYOUT_INIT;
  instVbls[1].stepMode = WGPUVertexStepMode_Instance;
  instVbls[1].arrayStride = sizeof(InstanceAttrib);
  instVbls[1].attributeCount = 5;
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

  // 2-Cascade Shadow pipelines
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

    rp.primitive.cullMode = WGPUCullMode_None;
    rp.vertex.entryPoint = {"vsShadowCustomNear", 18};
    rp.vertex.bufferCount = 1;
    rp.vertex.buffers = &customMeshVbl;
    shadowCustomNearPipeline_ = wgpuDeviceCreateRenderPipeline(ctx.device(), &rp);

    rp.vertex.entryPoint = {"vsShadowCustomFar", 17};
    shadowCustomFarPipeline_ = wgpuDeviceCreateRenderPipeline(ctx.device(), &rp);

    rp.vertex.entryPoint = {"vsShadowCustomInstNear", 22};
    rp.vertex.bufferCount = 2;
    rp.vertex.buffers = customInstVbls;
    shadowCustomInstNearPipeline_ = wgpuDeviceCreateRenderPipeline(ctx.device(), &rp);

    rp.vertex.entryPoint = {"vsShadowCustomInstFar", 21};
    shadowCustomInstFarPipeline_ = wgpuDeviceCreateRenderPipeline(ctx.device(), &rp);

    rp.primitive.cullMode = WGPUCullMode_Back;
    rp.vertex.entryPoint = {"vsShadowInstancedNear", 21};
    rp.vertex.bufferCount = 2;
    rp.vertex.buffers = instVbls;
    shadowInstancedNearPipeline_ = wgpuDeviceCreateRenderPipeline(ctx.device(), &rp);

    rp.vertex.entryPoint = {"vsShadowInstancedFar", 20};
    shadowInstancedFarPipeline_ = wgpuDeviceCreateRenderPipeline(ctx.device(), &rp);

    rp.layout = shadowSkinnedPipeLayout_;
    rp.primitive.cullMode = WGPUCullMode_None;
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

    rp.vertex.entryPoint = {"vsCustomMesh", 12};
    rp.vertex.bufferCount = 1;
    rp.vertex.buffers = &customMeshVbl;
    rp.primitive.cullMode = WGPUCullMode_None;
    customMeshPipeline_ = wgpuDeviceCreateRenderPipeline(ctx.device(), &rp);

    rp.vertex.entryPoint = {"vsCustomInstanced", 17};
    rp.vertex.bufferCount = 2;
    rp.vertex.buffers = customInstVbls;
    rp.primitive.cullMode = WGPUCullMode_None;
    customInstancedPipeline_ = wgpuDeviceCreateRenderPipeline(ctx.device(), &rp);

    rp.vertex.entryPoint = {"vsInstanced", 11};
    rp.vertex.bufferCount = 2;
    rp.vertex.buffers = instVbls;
    rp.primitive.cullMode = WGPUCullMode_Back;
    archBoxPipeline_ = wgpuDeviceCreateRenderPipeline(ctx.device(), &rp);

    rp.primitive.cullMode = WGPUCullMode_None;
    instancedPipeline_ = wgpuDeviceCreateRenderPipeline(ctx.device(), &rp);

    rp.vertex.entryPoint = {"vsSkinned", 9};
    rp.vertex.bufferCount = 1;
    rp.vertex.buffers = &skinVbl;
    rp.primitive.cullMode = WGPUCullMode_None;
    skinnedPipeline_ = wgpuDeviceCreateRenderPipeline(ctx.device(), &rp);
  }

  // Post-FX Pipelines
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
  buildCustomWorldMeshBuffers(ctx, world);
  if (!world.hasCustomMeshes) {
    buildRoadAndArenaBuffers(ctx, world);
  }
  buildPropAndVehicleBatches(ctx, world, assets.assetsRoot);

  if (assets.playerBody) buildSkinnedMesh(ctx, *assets.playerBody, playerBodyGpu_);
  if (assets.playerShorts) buildSkinnedMesh(ctx, *assets.playerShorts, playerShortsGpu_);
  if (assets.playerHair) buildSkinnedMesh(ctx, *assets.playerHair, playerHairGpu_);
  if (assets.businessModel) buildSkinnedMesh(ctx, *assets.businessModel, businessGpu_);
  if (assets.civilianModel) buildSkinnedMesh(ctx, *assets.civilianModel, civilianGpu_);
  if (assets.policeModel) buildSkinnedMesh(ctx, *assets.policeModel, policeGpu_);
  if (assets.securityModel) buildSkinnedMesh(ctx, *assets.securityModel, securityGpu_);
  if (assets.vanguardSoldier) buildSkinnedMesh(ctx, *assets.vanguardSoldier, vanguardSoldierGpu_);
  if (assets.militaryModel) buildSkinnedMesh(ctx, *assets.militaryModel, militaryGpu_);
  if (assets.constructionModel) buildSkinnedMesh(ctx, *assets.constructionModel, constructionGpu_);
  if (assets.sportsModel) buildSkinnedMesh(ctx, *assets.sportsModel, sportsGpu_);
  if (assets.dogHuskyModel) buildSkinnedMesh(ctx, *assets.dogHuskyModel, dogHuskyGpu_);
  if (assets.deerModel) buildSkinnedMesh(ctx, *assets.deerModel, deerGpu_);

  return terrainPipeline_ != nullptr && instancedPipeline_ != nullptr && skinnedPipeline_ != nullptr;
}

void WorldRenderer::buildTerrainAndOceanBuffers(WgpuContext& ctx, const WorldData& world) {
  constexpr uint32_t N = 512;
  constexpr uint32_t WN = 240;
  std::vector<StaticVertex> verts;
  std::vector<uint32_t> indices;
  verts.reserve(N * N + WN * WN + 64);
  indices.reserve((N - 1) * (N - 1) * 6 + WN * WN * 3);

  for (uint32_t iz = 0; iz < N; ++iz) {
    const float tz = static_cast<float>(iz) / static_cast<float>(N - 1);
    const float z = world.worldMin + tz * (world.worldMax - world.worldMin);
    for (uint32_t ix = 0; ix < N; ++ix) {
      const float tx = static_cast<float>(ix) / static_cast<float>(N - 1);
      const float x = world.worldMin + tx * (world.worldMax - world.worldMin);
      const float rawY = world.heightfield.sampleHeight(x, z);
      const float y = world.hasCustomMeshes ? (rawY - 0.035f) : rawY;
      const glm::vec3 n = world.heightfield.sampleNormal(x, z);

      // Multi-biome Westgate Bay terrain splatting (Beach Sand, Riprap, Park Lawn, Foothills Chaparral, Seaport Gravel)
      glm::vec3 col(0.24f, 0.38f, 0.20f); // lush coastal grass default
      if (rawY < 0.35f) {
        col = (x < -580.0f) ? glm::vec3(0.62f, 0.56f, 0.42f) : glm::vec3(0.36f, 0.35f, 0.33f);
      } else if (x < -640.0f && rawY < 4.2f) {
        const float sandT = std::clamp((4.2f - rawY) / 3.4f, 0.0f, 1.0f);
        col = glm::mix(glm::vec3(0.28f, 0.40f, 0.22f), glm::vec3(0.78f, 0.71f, 0.53f), sandT);
      } else if (rawY < 2.2f && x > -580.0f) {
        col = glm::vec3(0.45f, 0.44f, 0.41f); // river/canal/harbor stone riprap bank
      } else if (n.y < 0.76f) {
        col = glm::vec3(0.44f, 0.42f, 0.39f); // steep granite cliff
      } else if (z < -420.0f || rawY > 28.0f) {
        const float chapT = std::clamp((rawY - 18.0f) / 45.0f, 0.0f, 1.0f);
        col = glm::mix(glm::vec3(0.32f, 0.39f, 0.21f), glm::vec3(0.46f, 0.43f, 0.28f), chapT);
      } else if (x > 420.0f && z > 40.0f) {
        col = glm::vec3(0.39f, 0.39f, 0.38f); // East Seaport industrial gravel
      } else if (x > -240.0f && x < 240.0f && z > -260.0f && z < 360.0f) {
        col = glm::vec3(0.26f, 0.36f, 0.22f); // Downtown / Midtown manicured park & boulevard turf
      }

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

  // Wet-cell-clipped Interior Water Mesh (Pacific Ocean, Westgate River, Seaport Harbor, Venice Canals, Coves)
  const uint32_t wBase = static_cast<uint32_t>(verts.size());
  std::vector<float> waterGroundY(WN * WN, 0.0f);
  for (uint32_t iz = 0; iz < WN; ++iz) {
    const float tz = static_cast<float>(iz) / static_cast<float>(WN - 1);
    const float z = world.worldMin + tz * (world.worldMax - world.worldMin);
    for (uint32_t ix = 0; ix < WN; ++ix) {
      const float tx = static_cast<float>(ix) / static_cast<float>(WN - 1);
      const float x = world.worldMin + tx * (world.worldMax - world.worldMin);
      const float gy = world.heightfield.sampleHeight(x, z);
      waterGroundY[iz * WN + ix] = gy;
      verts.push_back(StaticVertex{x, 0.0f, z, 0.0f, 1.0f, 0.0f, 0.06f, 0.22f, 0.34f, gy, tz, 1.0f});
    }
  }
  for (uint32_t iz = 0; iz < WN - 1; ++iz) {
    for (uint32_t ix = 0; ix < WN - 1; ++ix) {
      const float g0 = waterGroundY[iz * WN + ix];
      const float g1 = waterGroundY[iz * WN + ix + 1];
      const float g2 = waterGroundY[(iz + 1) * WN + ix];
      const float g3 = waterGroundY[(iz + 1) * WN + ix + 1];
      if (std::min({g0, g1, g2, g3}) > 0.65f) continue; // Clip dry inland cells!
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

  // Outer Pacific Ocean & Southern Bay Horizon Skirts out to +-3200m (zero dry-land overlap!)
  auto addWaterSkirt = [&](float minX, float maxX, float minZ, float maxZ, uint32_t gx, uint32_t gz) {
    const uint32_t sb = static_cast<uint32_t>(verts.size());
    for (uint32_t iz = 0; iz <= gz; ++iz) {
      const float z = minZ + (static_cast<float>(iz) / static_cast<float>(gz)) * (maxZ - minZ);
      for (uint32_t ix = 0; ix <= gx; ++ix) {
        const float x = minX + (static_cast<float>(ix) / static_cast<float>(gx)) * (maxX - minX);
        verts.push_back(StaticVertex{x, 0.0f, z, 0.0f, 1.0f, 0.0f, 0.05f, 0.19f, 0.32f, -14.0f, 0.5f, 1.0f});
      }
    }
    const uint32_t row = gx + 1;
    for (uint32_t iz = 0; iz < gz; ++iz) {
      for (uint32_t ix = 0; ix < gx; ++ix) {
        const uint32_t i0 = sb + iz * row + ix;
        const uint32_t i1 = i0 + 1;
        const uint32_t i2 = i0 + row;
        const uint32_t i3 = i2 + 1;
        indices.push_back(i0); indices.push_back(i2); indices.push_back(i1);
        indices.push_back(i1); indices.push_back(i2); indices.push_back(i3);
      }
    }
  };
  addWaterSkirt(-3400.0f, world.worldMin, -3400.0f, 3400.0f, 24, 48); // Western Pacific horizon
  addWaterSkirt(world.worldMin, 3400.0f, world.worldMax, 3400.0f, 36, 24); // Southern Ocean/Harbor horizon
  addWaterSkirt(world.worldMax, 3400.0f, -3400.0f, world.worldMax, 18, 36); // Eastern Bay horizon

  terrainIndexCount_ = static_cast<uint32_t>(indices.size());
  telemetry_.terrainTriangles = terrainIndexCount_ / 3;
  terrainVbo_ = createBufferWithData(ctx.device(), ctx.queue(), WGPUBufferUsage_Vertex, verts.data(), verts.size() * sizeof(StaticVertex));
  terrainIbo_ = createBufferWithData(ctx.device(), ctx.queue(), WGPUBufferUsage_Index, indices.data(), indices.size() * sizeof(uint32_t));
}

void WorldRenderer::buildCustomWorldMeshBuffers(WgpuContext& ctx, const WorldData& world) {
  if (!world.hasCustomMeshes || world.customMeshVertices.empty() || world.customMeshIndices.empty()) return;

  customMeshIndexCount_ = static_cast<uint32_t>(world.customMeshIndices.size());
  customMeshVbo_ = createBufferWithData(
    ctx.device(), ctx.queue(), WGPUBufferUsage_Vertex,
    world.customMeshVertices.data(),
    world.customMeshVertices.size() * sizeof(PackedWorldVertex)
  );
  customMeshIbo_ = createBufferWithData(
    ctx.device(), ctx.queue(), WGPUBufferUsage_Index,
    world.customMeshIndices.data(),
    world.customMeshIndices.size() * sizeof(uint32_t)
  );
}

void WorldRenderer::buildRoadAndArenaBuffers(WgpuContext& ctx, const WorldData& world) {
  std::vector<StaticVertex> verts;
  std::vector<uint32_t> indices;

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
  float yawOffsetRad,
  bool centerXZOnRaw
) {
  if (!std::filesystem::exists(path)) return false;
  GltfModel model;
  if (!GltfAssetLoader::loadGlb(path, model, decodeTextures, nullptr) || model.primitives.empty()) return false;

  const float cosY = std::cos(yawOffsetRad);
  const float sinY = std::sin(yawOffsetRad);

  // Compute post-yawOffset bounds so rotated models (90-deg houses, aircraft, mustangs) center & scale identically to PropModels.ts
  glm::vec3 rotMin(1e30f), rotMax(-1e30f);
  for (const auto& prim : model.primitives) {
    for (const auto& v : prim.vertices) {
      const float rx = v.position.x * cosY + v.position.z * sinY;
      const float rz = -v.position.x * sinY + v.position.z * cosY;
      rotMin = glm::min(rotMin, glm::vec3(rx, v.position.y, rz));
      rotMax = glm::max(rotMax, glm::vec3(rx, v.position.y, rz));
    }
  }
  if (rotMin.x > rotMax.x) {
    rotMin = model.boundsMin;
    rotMax = model.boundsMax;
  }
  outBatch.rawMin = rotMin;
  outBatch.rawMax = rotMax;

  const glm::vec3 size = rotMax - rotMin;
  const float maxHoriz = std::max(size.x, size.z);
  const float scale = (normalizeTargetLength > 0.0f && maxHoriz > 1e-4f) ? (normalizeTargetLength / maxHoriz) : 1.0f;
  const bool doCenterXZ = (normalizeTargetLength > 0.0f) || centerXZOnRaw;
  const float cx = doCenterXZ ? (rotMin.x + rotMax.x) * 0.5f : 0.0f;
  const float cz = doCenterXZ ? (rotMin.z + rotMax.z) * 0.5f : 0.0f;
  const float minY = rotMin.y;

  std::unordered_map<int32_t, WGPUTextureView> texViewCache;
  auto getTexView = [&](int32_t idx, WGPUTextureView fallback) -> WGPUTextureView {
    if (idx < 0 || static_cast<size_t>(idx) >= model.textures.size()) return fallback;
    auto it = texViewCache.find(idx);
    if (it != texViewCache.end()) return it->second;
    const auto& td = model.textures[idx];
    if (td.width == 0 || td.height == 0 || td.rgba8.empty()) return fallback;
    GpuTextureBinding gtb = createRgbaTexture(ctx, td.width, td.height, td.rgba8.data(), false);
    outBatch.ownedTextures.push_back(gtb);
    texViewCache[idx] = gtb.view;
    return gtb.view;
  };

  std::unordered_map<uint64_t, WGPUBindGroup> matBgCache;
  auto getPbrBg = [&](int32_t alb, int32_t nrm, int32_t mr, int32_t em) -> WGPUBindGroup {
    if (alb < 0 && nrm < 0 && mr < 0 && em < 0) return defaultWhiteTex_.bindGroup;
    const uint64_t key =
      (static_cast<uint64_t>(static_cast<uint16_t>(alb + 1)) << 48) |
      (static_cast<uint64_t>(static_cast<uint16_t>(nrm + 1)) << 32) |
      (static_cast<uint64_t>(static_cast<uint16_t>(mr + 1))  << 16) |
      static_cast<uint64_t>(static_cast<uint16_t>(em + 1));
    auto it = matBgCache.find(key);
    if (it != matBgCache.end()) return it->second;
    WGPUBindGroup bg = createPbrMatBindGroup(
      ctx,
      getTexView(alb, defaultWhiteTex_.view),
      getTexView(nrm, defaultFlatNormalTex_.view),
      getTexView(mr, defaultWhiteTex_.view),
      getTexView(em, defaultWhiteTex_.view)
    );
    outBatch.ownedBindGroups.push_back(bg);
    matBgCache[key] = bg;
    return bg;
  };

  std::vector<size_t> primOrder(model.primitives.size());
  for (size_t i = 0; i < primOrder.size(); ++i) primOrder[i] = i;
  std::sort(primOrder.begin(), primOrder.end(), [&](size_t a, size_t b) {
    return model.primitives[a].materialIndex < model.primitives[b].materialIndex;
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

  std::vector<ModelVertex> verts;
  std::vector<uint32_t> indices;
  WGPUBindGroup curTexBg = nullptr;

  for (size_t pi : primOrder) {
    const auto& prim = model.primitives[pi];
    const uint32_t base = static_cast<uint32_t>(verts.size());
    const uint32_t iStart = static_cast<uint32_t>(indices.size());
    glm::vec3 matCol(1.0f);
    float metallic = 0.05f;
    float roughness = 0.62f;
    float encodedMetallic = metallic;
    WGPUBindGroup texBg = defaultWhiteTex_.bindGroup;
    bool hasTexture = false;

    if (prim.materialIndex >= 0 && static_cast<size_t>(prim.materialIndex) < model.materials.size()) {
      const auto& mat = model.materials[prim.materialIndex];
      matCol = glm::vec3(mat.baseColor);
      metallic = std::clamp(mat.metallic, 0.0f, 1.0f);
      roughness = std::clamp(mat.roughness, 0.06f, 0.98f);
      hasTexture = (mat.baseColorTexIndex >= 0 && static_cast<size_t>(mat.baseColorTexIndex) < model.textures.size());
      texBg = getPbrBg(mat.baseColorTexIndex, mat.normalTexIndex, mat.metallicRoughnessTexIndex, mat.emissiveTexIndex);

      if (isVehicle) {
        const std::string& mn = mat.name;
        if (startsWith(mn, "paint__")) {
          metallic = 0.26f;
          roughness = 0.14f;
          encodedMetallic = 2.0f + metallic;
          if (!hasTexture) matCol = glm::vec3(1.0f);
        } else if (startsWith(mn, "headlight__")) {
          if (containsCI(mn, "cover") || containsCI(mn, "glass")) {
            encodedMetallic = -3.0f; roughness = 0.05f; matCol = glm::vec3(0.84f, 0.90f, 0.96f);
          } else if (containsCI(mn, "beacon_blue")) {
            encodedMetallic = -4.0f; roughness = 0.10f; matCol = glm::vec3(0.18f, 0.48f, 1.0f);
          } else {
            encodedMetallic = -1.0f; roughness = 0.10f; matCol = glm::vec3(0.96f, 0.98f, 1.0f);
          }
        } else if (startsWith(mn, "taillight__")) {
          if (containsCI(mn, "cover")) {
            encodedMetallic = -3.0f; roughness = 0.06f; matCol = glm::vec3(0.55f, 0.04f, 0.06f);
          } else if (containsCI(mn, "beacon_red")) {
            encodedMetallic = -5.0f; roughness = 0.10f; matCol = glm::vec3(1.0f, 0.10f, 0.10f);
          } else {
            encodedMetallic = -2.0f; roughness = 0.12f; matCol = glm::vec3(0.95f, 0.08f, 0.08f);
          }
        } else if (startsWith(mn, "glass__") || containsCI(mn, "windshield")) {
          encodedMetallic = -3.0f; roughness = 0.05f; matCol = glm::vec3(0.10f, 0.14f, 0.20f);
        } else {
          if (startsWith(mn, "chrome__")) {
            metallic = 1.0f; roughness = 0.08f;
          } else if (startsWith(mn, "rim__")) {
            metallic = 0.88f; roughness = 0.18f;
          } else if (startsWith(mn, "brake__")) {
            const bool isDisc = containsCI(mn, "disc") || containsCI(mn, "disk") || containsCI(mn, "pad2") || containsCI(mn, "brake-discs");
            if (isDisc) { metallic = 0.90f; roughness = 0.22f; }
            else { metallic = 0.52f; roughness = 0.30f; if (!hasTexture) matCol = glm::vec3(0.76f, 0.09f, 0.09f); }
          } else if (startsWith(mn, "plate__")) {
            metallic = 0.34f; roughness = 0.28f;
            if (!hasTexture && matCol.r > 0.88f && matCol.g > 0.88f && matCol.b > 0.88f) matCol = glm::vec3(0.84f, 0.87f, 0.91f);
          } else if (startsWith(mn, "tire__")) {
            metallic = 0.02f; roughness = 0.86f;
            if (!hasTexture && (matCol.r > 0.25f || matCol.g > 0.25f || matCol.b > 0.25f)) matCol = glm::vec3(0.085f, 0.095f, 0.11f);
          } else if (startsWith(mn, "trim__") || startsWith(mn, "carbon__")) {
            metallic = 0.16f; roughness = 0.42f;
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
      const float rxRaw = v.position.x * cosY + v.position.z * sinY;
      const float rzRaw = -v.position.x * sinY + v.position.z * cosY;
      const float lx = (rxRaw - cx) * scale;
      const float ly = (v.position.y - minY) * scale;
      const float lz = (rzRaw - cz) * scale;
      const float nx = v.normal.x * cosY + v.normal.z * sinY;
      const float nz = -v.normal.x * sinY + v.normal.z * cosY;
      verts.push_back(ModelVertex{
        lx, ly, lz,
        nx, v.normal.y, nz,
        v.uv.x, v.uv.y, // Preserve unclamped tiled UVs for Repeat sampler!
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

  outBatch.maxInstances = static_cast<uint32_t>(std::max<size_t>(16, instances.size()));
  outBatch.instanceCount = static_cast<uint32_t>(instances.size());
  outBatch.instVbo = createBufferWithData(
    ctx.device(), ctx.queue(), WGPUBufferUsage_Vertex,
    instances.empty() ? nullptr : instances.data(),
    outBatch.maxInstances * sizeof(InstanceAttrib)
  );
  outBatch.shadowNearInstVbo = createBufferWithData(
    ctx.device(), ctx.queue(), WGPUBufferUsage_Vertex,
    nullptr,
    outBatch.maxInstances * sizeof(InstanceAttrib)
  );
  outBatch.shadowFarInstVbo = createBufferWithData(
    ctx.device(), ctx.queue(), WGPUBufferUsage_Vertex,
    nullptr,
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
  std::vector<InstanceAttrib> dummy(maxInstances);
  if (!loadGlbBatch(ctx, path, dummy, outBatch, 1.0f, true, false, 0.0f, true)) return false;
  outBatch.instanceCount = 0;
  return true;
}

bool WorldRenderer::loadVehicleAsset(
  WgpuContext& ctx,
  const std::string& glbPath,
  const VehicleSpec& spec,
  VehicleGpuAsset& outAsset
) {
  if (!std::filesystem::exists(glbPath)) return false;
  GltfModel model;
  if (!GltfAssetLoader::loadGlb(glbPath, model, true, nullptr) || model.primitives.empty()) return false;

  const float cosY = std::cos(spec.yawOffsetRad);
  const float sinY = std::sin(spec.yawOffsetRad);

  glm::vec3 rotMin(1e30f), rotMax(-1e30f);
  for (const auto& prim : model.primitives) {
    for (const auto& v : prim.vertices) {
      const float rx = v.position.x * cosY + v.position.z * sinY;
      const float rz = -v.position.x * sinY + v.position.z * cosY;
      rotMin = glm::min(rotMin, glm::vec3(rx, v.position.y, rz));
      rotMax = glm::max(rotMax, glm::vec3(rx, v.position.y, rz));
    }
  }
  const float cx = 0.5f * (rotMin.x + rotMax.x);
  const float cz = 0.5f * (rotMin.z + rotMax.z);
  const float minY = rotMin.y;
  const float rawLenZ = std::max(0.1f, rotMax.z - rotMin.z);
  const float scale = (spec.length > 0.1f) ? (spec.length / rawLenZ) : spec.visualScale;

  // Upload textures once onto outAsset.chassis so they are shared cleanly across chassis, wheels & rotors
  std::unordered_map<int32_t, WGPUTextureView> texViewCache;
  auto getTexView = [&](int32_t idx, WGPUTextureView fallback) -> WGPUTextureView {
    if (idx < 0 || static_cast<size_t>(idx) >= model.textures.size()) return fallback;
    auto it = texViewCache.find(idx);
    if (it != texViewCache.end()) return it->second;
    const auto& td = model.textures[idx];
    if (td.width == 0 || td.height == 0 || td.rgba8.empty()) return fallback;
    GpuTextureBinding gtb = createRgbaTexture(ctx, td.width, td.height, td.rgba8.data(), false);
    outAsset.chassis.ownedTextures.push_back(gtb);
    texViewCache[idx] = gtb.view;
    return gtb.view;
  };

  std::unordered_map<uint64_t, WGPUBindGroup> matBgCache;
  auto getPbrBg = [&](int32_t alb, int32_t nrm, int32_t mr, int32_t em) -> WGPUBindGroup {
    if (alb < 0 && nrm < 0 && mr < 0 && em < 0) return defaultWhiteTex_.bindGroup;
    const uint64_t key =
      (static_cast<uint64_t>(static_cast<uint16_t>(alb + 1)) << 48) |
      (static_cast<uint64_t>(static_cast<uint16_t>(nrm + 1)) << 32) |
      (static_cast<uint64_t>(static_cast<uint16_t>(mr + 1))  << 16) |
      static_cast<uint64_t>(static_cast<uint16_t>(em + 1));
    auto it = matBgCache.find(key);
    if (it != matBgCache.end()) return it->second;
    WGPUBindGroup bg = createPbrMatBindGroup(
      ctx,
      getTexView(alb, defaultWhiteTex_.view),
      getTexView(nrm, defaultFlatNormalTex_.view),
      getTexView(mr, defaultWhiteTex_.view),
      getTexView(em, defaultWhiteTex_.view)
    );
    outAsset.chassis.ownedBindGroups.push_back(bg);
    matBgCache[key] = bg;
    return bg;
  };

  auto startsWith = [](const std::string& s, const char* prefix) -> bool {
    const size_t n = std::strlen(prefix);
    return s.size() >= n && s.compare(0, n, prefix) == 0;
  };
  auto containsCI = [](const std::string& s, const char* needle) -> bool {
    std::string lo = s;
    for (char& c : lo) c = static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
    return lo.find(needle) != std::string::npos;
  };
  auto hasNodeAncestor = [&](int32_t nodeIdx, const char* ancName) -> bool {
    int32_t cur = nodeIdx;
    int guard = 0;
    while (cur >= 0 && static_cast<size_t>(cur) < model.nodes.size() && guard++ < 32) {
      if (model.nodes[static_cast<size_t>(cur)].name == ancName) return true;
      cur = model.nodes[static_cast<size_t>(cur)].parent;
    }
    return false;
  };

  struct TriItem {
    ModelVertex v[3];
    WGPUBindGroup texBg = nullptr;
    glm::vec3 center{0.0f};
  };

  std::vector<TriItem> chassisTris;
  std::vector<TriItem> mainRotorTris;
  std::vector<TriItem> tailRotorTris;
  std::vector<TriItem> rawWheelTris;

  const float maxWheelCenterY = (rotMax.y - minY) * scale * 0.56f;
  const float minWheelAbsX = (rotMax.x - rotMin.x) * scale * 0.17f;

  for (const auto& prim : model.primitives) {
    glm::vec3 matCol(1.0f);
    float metallic = 0.05f;
    float roughness = 0.62f;
    float encodedMetallic = 4.0f + metallic;
    WGPUBindGroup texBg = defaultWhiteTex_.bindGroup;
    bool hasTexture = false;
    bool isSpinningWheelMat = false;

    if (prim.materialIndex >= 0 && static_cast<size_t>(prim.materialIndex) < model.materials.size()) {
      const auto& mat = model.materials[prim.materialIndex];
      matCol = glm::vec3(mat.baseColor);
      metallic = std::clamp(mat.metallic, 0.0f, 1.0f);
      roughness = std::clamp(mat.roughness, 0.06f, 0.98f);
      hasTexture = (mat.baseColorTexIndex >= 0 && static_cast<size_t>(mat.baseColorTexIndex) < model.textures.size());
      texBg = getPbrBg(mat.baseColorTexIndex, mat.normalTexIndex, mat.metallicRoughnessTexIndex, mat.emissiveTexIndex);
      if (hasTexture) matCol = glm::vec3(1.0f);

      const std::string& mn = mat.name;
      if (startsWith(mn, "paint__")) {
        metallic = 0.26f;
        roughness = 0.14f;
        encodedMetallic = 2.0f + metallic;
        if (!hasTexture) matCol = glm::vec3(1.0f);
      } else if (startsWith(mn, "beacon__") || startsWith(mn, "nav__")) {
        if (containsCI(mn, "red")) {
          encodedMetallic = -5.0f; roughness = 0.10f; if (!hasTexture) matCol = glm::vec3(1.0f, 0.12f, 0.10f);
        } else {
          encodedMetallic = -4.0f; roughness = 0.10f; if (!hasTexture) matCol = glm::vec3(0.18f, 0.48f, 1.0f);
        }
      } else if (startsWith(mn, "headlight__")) {
        if (containsCI(mn, "cover") || containsCI(mn, "glass")) {
          encodedMetallic = -3.0f; roughness = 0.05f; if (!hasTexture) matCol = glm::vec3(0.84f, 0.90f, 0.96f);
        } else if (containsCI(mn, "beacon_blue")) {
          encodedMetallic = -4.0f; roughness = 0.10f; if (!hasTexture) matCol = glm::vec3(0.18f, 0.48f, 1.0f);
        } else {
          encodedMetallic = -1.0f; roughness = 0.10f; if (!hasTexture) matCol = glm::vec3(0.96f, 0.98f, 1.0f);
        }
      } else if (startsWith(mn, "taillight__")) {
        if (containsCI(mn, "cover") || containsCI(mn, "clear") || containsCI(mn, "case")) {
          encodedMetallic = -3.0f; roughness = 0.06f; if (!hasTexture) matCol = glm::vec3(0.55f, 0.04f, 0.06f);
        } else if (containsCI(mn, "beacon_red")) {
          encodedMetallic = -5.0f; roughness = 0.10f; if (!hasTexture) matCol = glm::vec3(1.0f, 0.10f, 0.10f);
        } else {
          encodedMetallic = -2.0f; roughness = 0.12f; if (!hasTexture) matCol = glm::vec3(0.95f, 0.08f, 0.08f);
        }
      } else if (startsWith(mn, "glass__") || containsCI(mn, "windshield")) {
        encodedMetallic = -3.0f; roughness = 0.05f; matCol = glm::vec3(0.10f, 0.14f, 0.20f);
      } else {
        if (startsWith(mn, "chrome__")) {
          metallic = 1.0f; roughness = 0.08f;
        } else if (startsWith(mn, "rim__") || mn == "other__Wheel-nuts") {
          metallic = 0.88f; roughness = 0.18f;
          isSpinningWheelMat = true;
        } else if (startsWith(mn, "brake__") || containsCI(mn, "disk brake")) {
          const bool isDisc = containsCI(mn, "disc") || containsCI(mn, "disk") || containsCI(mn, "pad2") || containsCI(mn, "brake-discs");
          if (isDisc) {
            metallic = 0.90f; roughness = 0.22f;
            isSpinningWheelMat = true;
          } else {
            metallic = 0.52f; roughness = 0.30f;
            if (!hasTexture) matCol = glm::vec3(0.76f, 0.09f, 0.09f);
          }
        } else if (startsWith(mn, "plate__")) {
          metallic = 0.34f; roughness = 0.28f;
          if (!hasTexture && matCol.r > 0.88f && matCol.g > 0.88f && matCol.b > 0.88f) matCol = glm::vec3(0.84f, 0.87f, 0.91f);
        } else if (startsWith(mn, "tire__")) {
          metallic = 0.02f; roughness = 0.86f;
          if (!hasTexture && (matCol.r > 0.25f || matCol.g > 0.25f || matCol.b > 0.25f)) matCol = glm::vec3(0.085f, 0.095f, 0.11f);
          isSpinningWheelMat = true;
        } else if (startsWith(mn, "trim__") || startsWith(mn, "carbon__")) {
          metallic = 0.16f; roughness = 0.42f;
          if (!hasTexture && !containsCI(mn, "_livery")) {
            const float lum = matCol.r * 0.299f + matCol.g * 0.587f + matCol.b * 0.114f;
            if (lum > 0.72f) matCol = glm::vec3(0.095f, 0.105f, 0.125f);
          }
        }
        encodedMetallic = 4.0f + metallic;
      }
    }

    const bool isHeliMainRotor = spec.isAircraft && hasNodeAncestor(prim.nodeIndex, "Cube004");
    const bool isHeliTailRotor = spec.isAircraft && !isHeliMainRotor && hasNodeAncestor(prim.nodeIndex, "Cube002");

    auto toModelVert = [&](const GltfVertex& gv) -> ModelVertex {
      const glm::vec3 col = glm::vec3(gv.color) * matCol;
      const float rxRaw = gv.position.x * cosY + gv.position.z * sinY;
      const float rzRaw = -gv.position.x * sinY + gv.position.z * cosY;
      const float lx = (rxRaw - cx) * scale;
      const float ly = (gv.position.y - minY) * scale;
      const float lz = (rzRaw - cz) * scale;
      const float nx = gv.normal.x * cosY + gv.normal.z * sinY;
      const float nz = -gv.normal.x * sinY + gv.normal.z * cosY;
      return ModelVertex{
        lx, ly, lz,
        nx, gv.normal.y, nz,
        gv.uv.x, gv.uv.y,
        col.r, col.g, col.b,
        encodedMetallic, roughness
      };
    };

    for (size_t ii = 0; ii + 2 < prim.indices.size(); ii += 3) {
      const uint32_t i0 = prim.indices[ii];
      const uint32_t i1 = prim.indices[ii + 1];
      const uint32_t i2 = prim.indices[ii + 2];
      if (i0 >= prim.vertices.size() || i1 >= prim.vertices.size() || i2 >= prim.vertices.size()) continue;
      TriItem tri;
      tri.v[0] = toModelVert(prim.vertices[i0]);
      tri.v[1] = toModelVert(prim.vertices[i1]);
      tri.v[2] = toModelVert(prim.vertices[i2]);
      tri.texBg = texBg;
      tri.center = glm::vec3(
        (tri.v[0].px + tri.v[1].px + tri.v[2].px) / 3.0f,
        (tri.v[0].py + tri.v[1].py + tri.v[2].py) / 3.0f,
        (tri.v[0].pz + tri.v[1].pz + tri.v[2].pz) / 3.0f
      );

      if (isHeliMainRotor) {
        mainRotorTris.push_back(tri);
      } else if (isHeliTailRotor) {
        tailRotorTris.push_back(tri);
      } else if (!spec.isBoat && !spec.isAircraft && isSpinningWheelMat &&
                 tri.center.y < maxWheelCenterY && std::abs(tri.center.x) > minWheelAbsX) {
        rawWheelTris.push_back(tri);
      } else {
        chassisTris.push_back(tri);
      }
    }
  }

  constexpr uint32_t kMaxVehInstances = 64;
  auto uploadTriBatch = [&](std::vector<TriItem>& tris, const glm::vec3& localPivotOffset, InstancedGlbBatch& outB) -> bool {
    if (tris.empty()) return false;
    std::stable_sort(tris.begin(), tris.end(), [](const TriItem& a, const TriItem& b) {
      return a.texBg < b.texBg;
    });
    std::vector<ModelVertex> verts;
    std::vector<uint32_t> indices;
    verts.reserve(tris.size() * 3);
    indices.reserve(tris.size() * 3);
    WGPUBindGroup curBg = nullptr;
    for (const auto& t : tris) {
      const uint32_t iStart = static_cast<uint32_t>(indices.size());
      for (int k = 0; k < 3; ++k) {
        ModelVertex mv = t.v[k];
        mv.px -= localPivotOffset.x;
        mv.py -= localPivotOffset.y;
        mv.pz -= localPivotOffset.z;
        indices.push_back(static_cast<uint32_t>(verts.size()));
        verts.push_back(mv);
      }
      if (!outB.submeshes.empty() && curBg == t.texBg) {
        outB.submeshes.back().indexCount += 3;
      } else {
        outB.submeshes.push_back(GlbSubmesh{iStart, 3, t.texBg});
        curBg = t.texBg;
      }
    }
    outB.indexCount = static_cast<uint32_t>(indices.size());
    outB.maxInstances = kMaxVehInstances;
    outB.vbo = createBufferWithData(ctx.device(), ctx.queue(), WGPUBufferUsage_Vertex, verts.data(), verts.size() * sizeof(ModelVertex));
    outB.ibo = createBufferWithData(ctx.device(), ctx.queue(), WGPUBufferUsage_Index, indices.data(), indices.size() * sizeof(uint32_t));
    outB.instVbo = createBufferWithData(ctx.device(), ctx.queue(), WGPUBufferUsage_Vertex, nullptr, kMaxVehInstances * sizeof(InstanceAttrib));
    return true;
  };

  if (!uploadTriBatch(chassisTris, glm::vec3(0.0f), outAsset.chassis)) return false;
  outAsset.chassisStaging.reserve(kMaxVehInstances);

  // Helicopter articulated Main Rotor (Cube004) & Tail Rotor (Cube002)
  auto computeBoundsCenter = [](const std::vector<TriItem>& tris, glm::vec3& bMin, glm::vec3& bMax) {
    bMin = glm::vec3(1e30f);
    bMax = glm::vec3(-1e30f);
    for (const auto& t : tris) {
      for (int k = 0; k < 3; ++k) {
        const glm::vec3 p(t.v[k].px, t.v[k].py, t.v[k].pz);
        bMin = glm::min(bMin, p);
        bMax = glm::max(bMax, p);
      }
    }
  };
  if (!mainRotorTris.empty()) {
    glm::vec3 bMin, bMax;
    computeBoundsCenter(mainRotorTris, bMin, bMax);
    outAsset.mainRotorPivotVeh = 0.5f * (bMin + bMax);
    outAsset.hasMainRotor = uploadTriBatch(mainRotorTris, outAsset.mainRotorPivotVeh, outAsset.mainRotor);
    outAsset.mainRotorStaging.reserve(16);
  }
  if (!tailRotorTris.empty()) {
    glm::vec3 bMin, bMax;
    computeBoundsCenter(tailRotorTris, bMin, bMax);
    outAsset.tailRotorPivotVeh = 0.5f * (bMin + bMax);
    outAsset.hasTailRotor = uploadTriBatch(tailRotorTris, outAsset.tailRotorPivotVeh, outAsset.tailRotor);
    outAsset.tailRotorStaging.reserve(16);
  }

  // Multi-axle spatial clustering for all spinning road wheels (4 wheels on cars, 6 on Semi & Kraz!)
  if (!rawWheelTris.empty()) {
    struct AxleCluster {
      float sumZ = 0.0f;
      int count = 0;
      float meanZ() const { return sumZ / static_cast<float>(std::max(1, count)); }
    };
    std::vector<AxleCluster> axles;
    for (const auto& t : rawWheelTris) {
      bool placed = false;
      for (auto& ax : axles) {
        if (std::abs(t.center.z - ax.meanZ()) < 0.52f) {
          ax.sumZ += t.center.z;
          ax.count++;
          placed = true;
          break;
        }
      }
      if (!placed) axles.push_back({t.center.z, 1});
    }
    std::sort(axles.begin(), axles.end(), [](const AxleCluster& a, const AxleCluster& b) {
      return a.meanZ() > b.meanZ(); // descending Z: axle 0 is Front (+Z)!
    });

    for (size_t ai = 0; ai < axles.size(); ++ai) {
      for (int side = 0; side < 2; ++side) { // 0 = Left (+X), 1 = Right (-X)
        std::vector<TriItem> clusterTris;
        for (const auto& t : rawWheelTris) {
          const int triSide = (t.center.x >= 0.0f) ? 0 : 1;
          if (triSide != side) continue;
          // Assign to nearest axle Z
          size_t bestAx = 0;
          float bestDz = 1e30f;
          for (size_t k = 0; k < axles.size(); ++k) {
            const float dz = std::abs(t.center.z - axles[k].meanZ());
            if (dz < bestDz) { bestDz = dz; bestAx = k; }
          }
          if (bestAx == ai) clusterTris.push_back(t);
        }
        if (clusterTris.size() < 4) continue;

        glm::vec3 wMin, wMax;
        computeBoundsCenter(clusterTris, wMin, wMax);
        ArticulatedWheelGpu wGpu;
        wGpu.pivotVeh = 0.5f * (wMin + wMax);
        wGpu.radius = std::max(0.20f, 0.5f * (wMax.y - wMin.y));
        wGpu.isFront = (ai == 0 && axles.size() >= 2);
        wGpu.cornerIdx = (wGpu.isFront ? 0 : 2) + side;
        if (uploadTriBatch(clusterTris, wGpu.pivotVeh, wGpu.batch)) {
          wGpu.staging.reserve(kMaxVehInstances);
          outAsset.wheels.push_back(std::move(wGpu));
        }
      }
    }
  }

  return true;
}

void WorldRenderer::buildPropAndVehicleBatches(WgpuContext& ctx, const WorldData& world, const std::string& assetsRoot) {
  // Unit 1x1x1 cube (uv = (-1000, -1000) flags procedural window grid ONLY on legacy untextured unitBox towers)
  const ModelVertex boxVerts[24] = {
    {-0.5f, -0.5f,  0.5f, 0, 0, 1, -1000, -1000, 1, 1, 1, 0.04f, 0.72f}, { 0.5f, -0.5f,  0.5f, 0, 0, 1, -1000, -1000, 1, 1, 1, 0.04f, 0.72f}, { 0.5f,  0.5f,  0.5f, 0, 0, 1, -1000, -1000, 1, 1, 1, 0.04f, 0.72f}, {-0.5f,  0.5f,  0.5f, 0, 0, 1, -1000, -1000, 1, 1, 1, 0.04f, 0.72f},
    { 0.5f, -0.5f, -0.5f, 0, 0, -1, -1000, -1000, 1, 1, 1, 0.04f, 0.72f}, {-0.5f, -0.5f, -0.5f, 0, 0, -1, -1000, -1000, 1, 1, 1, 0.04f, 0.72f}, {-0.5f,  0.5f, -0.5f, 0, 0, -1, -1000, -1000, 1, 1, 1, 0.04f, 0.72f}, { 0.5f,  0.5f, -0.5f, 0, 0, -1, -1000, -1000, 1, 1, 1, 0.04f, 0.72f},
    { 0.5f, -0.5f,  0.5f, 1, 0, 0, -1000, -1000, 1, 1, 1, 0.04f, 0.72f}, { 0.5f, -0.5f, -0.5f, 1, 0, 0, -1000, -1000, 1, 1, 1, 0.04f, 0.72f}, { 0.5f,  0.5f, -0.5f, 1, 0, 0, -1000, -1000, 1, 1, 1, 0.04f, 0.72f}, { 0.5f,  0.5f,  0.5f, 1, 0, 0, -1000, -1000, 1, 1, 1, 0.04f, 0.72f},
    {-0.5f, -0.5f, -0.5f, -1, 0, 0, -1000, -1000, 1, 1, 1, 0.04f, 0.72f}, {-0.5f, -0.5f,  0.5f, -1, 0, 0, -1000, -1000, 1, 1, 1, 0.04f, 0.72f}, {-0.5f,  0.5f,  0.5f, -1, 0, 0, -1000, -1000, 1, 1, 1, 0.04f, 0.72f}, {-0.5f,  0.5f, -0.5f, -1, 0, 0, -1000, -1000, 1, 1, 1, 0.04f, 0.72f},
    {-0.5f,  0.5f,  0.5f, 0, 1, 0, -1000, -1000, 1, 1, 1, 0.04f, 0.72f}, { 0.5f,  0.5f,  0.5f, 0, 1, 0, -1000, -1000, 1, 1, 1, 0.04f, 0.72f}, { 0.5f,  0.5f, -0.5f, 0, 1, 0, -1000, -1000, 1, 1, 1, 0.04f, 0.72f}, {-0.5f,  0.5f, -0.5f, 0, 1, 0, -1000, -1000, 1, 1, 1, 0.04f, 0.72f},
    {-0.5f, -0.5f, -0.5f, 0, -1, 0, -1000, -1000, 1, 1, 1, 0.04f, 0.72f}, { 0.5f, -0.5f, -0.5f, 0, -1, 0, -1000, -1000, 1, 1, 1, 0.04f, 0.72f}, { 0.5f, -0.5f,  0.5f, 0, -1, 0, -1000, -1000, 1, 1, 1, 0.04f, 0.72f}, {-0.5f, -0.5f,  0.5f, 0, -1, 0, -1000, -1000, 1, 1, 1, 0.04f, 0.72f},
  };
  const uint32_t boxIdx[36] = {
     0,  1,  2,  0,  2,  3,  4,  5,  6,  4,  6,  7,
     8,  9, 10,  8, 10, 11, 12, 13, 14, 12, 14, 15,
    16, 17, 18, 16, 18, 19, 20, 21, 22, 20, 22, 23,
  };
  unitBoxIndexCount_ = 36;
  unitBoxVbo_ = createBufferWithData(ctx.device(), ctx.queue(), WGPUBufferUsage_Vertex, boxVerts, sizeof(boxVerts));
  unitBoxIbo_ = createBufferWithData(ctx.device(), ctx.queue(), WGPUBufferUsage_Index, boxIdx, sizeof(boxIdx));

  size_t totalNearBoxes = 0;
  for (const auto& c : world.chunks) {
    totalNearBoxes += c.nearBoxes.size() + c.lodBoxes.size() + c.buildings.size();
  }
  buildingCapacity_ = static_cast<uint32_t>(std::clamp<size_t>(totalNearBoxes / 2 + 16384, 16384, 180000));
  shadowNearBoxCapacity_ = 40000;
  shadowFarBoxCapacity_ = 48000;
  buildingInstVbo_ = createBufferWithData(ctx.device(), ctx.queue(), WGPUBufferUsage_Vertex, nullptr, buildingCapacity_ * sizeof(InstanceAttrib));
  shadowNearBoxInstVbo_ = createBufferWithData(ctx.device(), ctx.queue(), WGPUBufferUsage_Vertex, nullptr, shadowNearBoxCapacity_ * sizeof(InstanceAttrib));
  shadowFarBoxInstVbo_ = createBufferWithData(ctx.device(), ctx.queue(), WGPUBufferUsage_Vertex, nullptr, shadowFarBoxCapacity_ * sizeof(InstanceAttrib));
  buildingStaging_.reserve(buildingCapacity_);
  shadowNearBoxStaging_.reserve(shadowNearBoxCapacity_);
  shadowFarBoxStaging_.reserve(shadowFarBoxCapacity_);

  markerCapacity_ = 2560;
  markerInstVbo_ = createBufferWithData(ctx.device(), ctx.queue(), WGPUBufferUsage_Vertex, nullptr, markerCapacity_ * sizeof(InstanceAttrib));
  markerStaging_.reserve(markerCapacity_);

  dynPropCapacity_ = 256;
  dynPropInstVbo_ = createBufferWithData(ctx.device(), ctx.queue(), WGPUBufferUsage_Vertex, nullptr, dynPropCapacity_ * sizeof(InstanceAttrib));
  dynPropStaging_.reserve(dynPropCapacity_);

  telemetry_.glbPropTypesLoaded = 0;

  // 1. Upload PropBatcher multi-part procedural prototypes (streetlight, traffic_light, hydrant)
  std::unordered_map<std::string, size_t> customProtoIndex;
  for (const auto& pp : world.propPrototypes) {
    if (pp.vertices.empty() || pp.indices.empty()) continue;
    CustomPropBatch cb;
    cb.protoId = pp.id;
    cb.indexCount = static_cast<uint32_t>(pp.indices.size());
    cb.vbo = createBufferWithData(ctx.device(), ctx.queue(), WGPUBufferUsage_Vertex, pp.vertices.data(), pp.vertices.size() * sizeof(PackedWorldVertex));
    cb.ibo = createBufferWithData(ctx.device(), ctx.queue(), WGPUBufferUsage_Index, pp.indices.data(), pp.indices.size() * sizeof(uint32_t));
    customProtoIndex[pp.id] = customPropBatches_.size();
    customPropBatches_.push_back(std::move(cb));
  }

  // 2. Group world.props across customPropBatches_ + textured GLB street props
  struct StreetGlbSpec { const char* file; float targetHeight; float maxDist; };
  static const std::unordered_map<std::string, StreetGlbSpec> protoGlbMap = {
    {"palm_tree",  {"tree_palm.glb",     9.2f, 520.0f}},
    {"oak_tree",   {"tree_oak.glb",      6.8f, 480.0f}},
    {"pine_tree",  {"tree_pine.glb",     8.2f, 500.0f}},
    {"bush",       {"bush.glb",          1.35f, 260.0f}},
    {"rock",       {"rock.glb",          1.55f, 320.0f}},
    {"dumpster",   {"dumpster_bin.glb",  1.85f, 260.0f}},
    {"park_bench", {"park_bench.glb",    1.65f, 240.0f}},
    {"stop_sign",  {"sign_stop.glb",     2.35f, 240.0f}},
    {"trashcan",   {"trash_bin.glb",     1.05f, 220.0f}},
  };

  std::unordered_map<std::string, std::vector<SpatialInstanceItem>> streetGlbItems;
  std::vector<InstanceAttrib> fallbackInst;

  for (const auto& p : world.props) {
    auto cit = customProtoIndex.find(p.proto);
    if (cit != customProtoIndex.end()) {
      auto& cb = customPropBatches_[cit->second];
      const float r = (p.proto == "hydrant") ? 0.9f : 4.2f;
      const float maxD = (p.proto == "hydrant") ? 210.0f : 440.0f;
      cb.spatialItems.push_back(SpatialInstanceItem{
        p.pos + glm::vec3(0.0f, r * 0.7f, 0.0f),
        r * p.scale,
        maxD,
        makeInstYaw(p.pos.x, p.pos.y, p.pos.z, p.scale, p.scale, p.scale, p.ry, 1.0f, 1.0f, 1.0f)
      });
      continue;
    }

    auto git = protoGlbMap.find(p.proto);
    if (git != protoGlbMap.end()) {
      streetGlbItems[p.proto].push_back(SpatialInstanceItem{
        p.pos,
        git->second.targetHeight * 0.6f * p.scale,
        git->second.maxDist,
        makeInstYaw(p.pos.x, p.pos.y, p.pos.z, p.scale, p.scale, p.scale, p.ry, 1.0f, 1.0f, 1.0f)
      });
    } else if (!world.hasCustomMeshes) {
      fallbackInst.push_back(makeInstYaw(p.pos.x, p.pos.y + 0.5f, p.pos.z, 0.36f, 1.0f, 0.36f, p.ry, 0.80f, 0.20f, 0.16f));
    }
  }

  for (auto& cb : customPropBatches_) {
    cb.maxInstances = static_cast<uint32_t>(std::max<size_t>(16, cb.spatialItems.size()));
    cb.instVbo = createBufferWithData(ctx.device(), ctx.queue(), WGPUBufferUsage_Vertex, nullptr, cb.maxInstances * sizeof(InstanceAttrib));
    cb.shadowNearInstVbo = createBufferWithData(ctx.device(), ctx.queue(), WGPUBufferUsage_Vertex, nullptr, cb.maxInstances * sizeof(InstanceAttrib));
    cb.visibleStaging.reserve(cb.maxInstances);
    cb.shadowNearStaging.reserve(cb.maxInstances);
  }

  // Load street prop GLBs normalized by Y height (matching Three.js PropBatcher)
  for (auto& [proto, items] : streetGlbItems) {
    const auto& spec = protoGlbMap.at(proto);
    const std::string glbPath = (std::filesystem::path(assetsRoot) / "models" / spec.file).string();
    std::vector<InstanceAttrib> placeholder(items.size());
    InstancedGlbBatch batch;
    batch.protoId = proto;
    if (loadGlbBatch(ctx, glbPath, placeholder, batch, 0.0f, true, false, 0.0f, true)) {
      const glm::vec3 rawSpan = glm::max(batch.rawMax - batch.rawMin, glm::vec3(0.01f));
      const float refDim = std::max(rawSpan.y, std::max(rawSpan.x, rawSpan.z));
      const float unitScale = spec.targetHeight / std::max(0.01f, refDim);
      for (auto& it : items) {
        it.attrib.sx *= unitScale;
        it.attrib.sy *= unitScale;
        it.attrib.sz *= unitScale;
        it.center.y += (rawSpan.y * it.attrib.sy) * 0.5f;
        it.radius = glm::length(rawSpan) * it.attrib.sx * 0.52f;
      }
      batch.spatialItems = std::move(items);
      batch.visibleStaging.reserve(batch.maxInstances);
      batch.shadowNearStaging.reserve(batch.maxInstances);
      batch.shadowFarStaging.reserve(batch.maxInstances);
      glbPropBatches_.push_back(std::move(batch));
      ++telemetry_.glbPropTypesLoaded;
    }
  }

  // 3. Load all 94 exact world.glbPlacements (PropModels.ts houses, villas, storefronts, trees, 737, ships, interiors, Fight Pit!)
  if (!world.glbPlacements.empty()) {
    struct PlacementGroupKey {
      std::string file;
      int32_t yawOffKey = 0;
      bool operator==(const PlacementGroupKey& o) const { return file == o.file && yawOffKey == o.yawOffKey; }
    };
    struct PlacementGroupHash {
      size_t operator()(const PlacementGroupKey& k) const {
        return std::hash<std::string>{}(k.file) ^ (static_cast<size_t>(k.yawOffKey) * 2654435761u);
      }
    };

    std::unordered_map<PlacementGroupKey, std::vector<const GlbPlacementData*>, PlacementGroupHash> groups;
    for (const auto& gp : world.glbPlacements) {
      PlacementGroupKey key{gp.file, static_cast<int32_t>(std::round(gp.yawOffset * 1000.0f))};
      groups[key].push_back(&gp);
    }

    for (auto& [key, list] : groups) {
      const std::string glbPath = (std::filesystem::path(assetsRoot) / "models" / key.file).string();
      std::vector<InstanceAttrib> placeholder(list.size());
      InstancedGlbBatch batch;
      batch.protoId = key.file;
      const float yawOff = list.front()->yawOffset;
      if (!loadGlbBatch(ctx, glbPath, placeholder, batch, 0.0f, true, false, yawOff, true)) continue;

      const glm::vec3 rawSpan = glm::max(batch.rawMax - batch.rawMin, glm::vec3(0.01f));
      batch.spatialItems.reserve(list.size());
      for (const GlbPlacementData* gp : list) {
        float k = 1.0f;
        if (gp->hasFitFootprint) {
          const float sx = gp->fitMaxWdh.x / rawSpan.x;
          const float sz = gp->fitMaxWdh.y / rawSpan.z;
          const float sy = gp->fitMaxWdh.z / rawSpan.y;
          k = std::min({sx, sz, sy});
        } else {
          float denom = rawSpan.y;
          if (gp->axis == 'x') denom = rawSpan.x;
          else if (gp->axis == 'z') denom = rawSpan.z;
          else if (gp->axis == 'm') denom = std::max({rawSpan.x, rawSpan.y, rawSpan.z});
          k = gp->targetMeters / std::max(0.01f, denom);
        }
        const glm::vec3 worldSize = rawSpan * k;
        const float radius = glm::length(worldSize) * 0.55f;
        const float maxDist = (radius > 9.0f) ? 1550.0f : (radius > 3.2f) ? 720.0f : 380.0f;
        const glm::vec3 basePos(gp->pos.x, gp->pos.y + gp->baseY, gp->pos.z);
        batch.spatialItems.push_back(SpatialInstanceItem{
          basePos + glm::vec3(0.0f, worldSize.y * 0.5f, 0.0f),
          radius,
          maxDist,
          makeInstYaw(basePos.x, basePos.y, basePos.z, k, k, k, gp->yaw, 1.0f, 1.0f, 1.0f)
        });
      }
      batch.visibleStaging.reserve(batch.maxInstances);
      batch.shadowNearStaging.reserve(batch.maxInstances);
      batch.shadowFarStaging.reserve(batch.maxInstances);
      glbPropBatches_.push_back(std::move(batch));
      ++telemetry_.glbPropTypesLoaded;
    }
  } else if (!world.hasCustomMeshes) {
    // Legacy synthetic unit-test fallback houses when custom mesh pack is absent
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
      loadGlbUnitBoxBatch(ctx, (std::filesystem::path(assetsRoot) / "models" / houseFiles[hi]).string(), 512, houseBatches_[hi]);
      houseStaging_[hi].reserve(256);
    }
  }

  fallbackPropCount_ = static_cast<uint32_t>(fallbackInst.size());
  if (fallbackPropCount_ > 0) {
    fallbackPropInstVbo_ = createBufferWithData(ctx.device(), ctx.queue(), WGPUBufferUsage_Vertex, fallbackInst.data(), fallbackInst.size() * sizeof(InstanceAttrib));
  }

  // 4. All 20 Real Articulated GLB Vehicles (spin + steer wheels, rotors, auto-centered X/Z, dynamic lights)
  for (size_t vi = 0; vi < kVehicleModelCount; ++vi) {
    const VehicleSpec& sp = GameSession::vehicleSpec(static_cast<VehicleModelKind>(vi));
    loadVehicleAsset(
      ctx,
      (std::filesystem::path(assetsRoot) / sp.glbFile).string(),
      sp,
      vehicleAssets_[vi]
    );
  }

  // 5. Dynamic Living-World GLB Props (stash_bag.glb, medkit.glb, fuel_tank.glb, gas_can.glb, bird.glb)
  struct DynGlbSpec {
    const char* file;
    float targetSpan;
    uint32_t maxInst;
  };
  constexpr DynGlbSpec kDynSpecs[kDynamicGlbPropCount] = {
    {"stash_bag.glb", 0.78f, 32},
    {"medkit.glb",    0.62f, 32},
    {"fuel_tank.glb", 1.05f, 48},
    {"gas_can.glb",   0.48f, 48},
    {"bird.glb",      0.85f, 32},
  };
  for (size_t di = 0; di < kDynamicGlbPropCount; ++di) {
    std::vector<InstanceAttrib> cap(kDynSpecs[di].maxInst);
    auto& db = dynGlbBatches_[di];
    db.protoId = kDynSpecs[di].file;
    const std::string p = (std::filesystem::path(assetsRoot) / "models" / kDynSpecs[di].file).string();
    if (loadGlbBatch(ctx, p, cap, db, kDynSpecs[di].targetSpan, true, false, 0.0f, true)) {
      db.visibleStaging.reserve(db.maxInstances);
      db.shadowNearStaging.reserve(db.maxInstances);
    }
  }

  // 6. Procedural 256x256 PBR Weapon Textures (Brushed CNC, Hex Laser-Stipple, Knurled Barrel, Coated Sapphire Lens)
  //    + 32 High-Detail Smooth 3D Firearm & First-Person Viewmodel Part Meshes
  {
    std::array<WeaponPbrTextureSet, kWeaponSurfaceMatCount> wepTex{};
    WeaponSystem3D::generateProceduralTextures(wepTex);
    weaponMatTextures_.reserve(kWeaponSurfaceMatCount * 3);
    for (size_t mi = 0; mi < kWeaponSurfaceMatCount; ++mi) {
      const auto& ts = wepTex[mi];
      GpuTextureBinding alb = createRgbaTexture(ctx, ts.width, ts.height, ts.albedoRgba.data(), false);
      GpuTextureBinding nrm = createRgbaTexture(ctx, ts.width, ts.height, ts.normalRgba.data(), false);
      GpuTextureBinding orm = createRgbaTexture(ctx, ts.width, ts.height, ts.ormRgba.data(), false);
      weaponMatTextures_.push_back(alb);
      weaponMatTextures_.push_back(nrm);
      weaponMatTextures_.push_back(orm);
      weaponMatBindGroups_[mi] = createPbrMatBindGroup(
        ctx,
        alb.view,
        nrm.view,
        orm.view,
        defaultWhiteTex_.view
      );
    }

    std::array<WeaponPartCpuMesh, kWeaponMeshPartCount> wepMeshes{};
    WeaponSystem3D::generateAllPartMeshes(wepMeshes);
    constexpr uint32_t kMaxWepInst = 96;
    for (size_t pi = 0; pi < kWeaponMeshPartCount; ++pi) {
      const auto& cpuM = wepMeshes[pi];
      if (cpuM.vertices.empty() || cpuM.indices.empty()) continue;
      auto& wb = weaponPartBatches_[pi];
      wb.protoId = "wep_part_" + std::to_string(pi);
      wb.maxInstances = kMaxWepInst;
      wb.indexCount = static_cast<uint32_t>(cpuM.indices.size());
      wb.vbo = createBufferWithData(
        ctx.device(), ctx.queue(), WGPUBufferUsage_Vertex,
        cpuM.vertices.data(), cpuM.vertices.size() * sizeof(WeaponPartVertex)
      );
      wb.ibo = createBufferWithData(
        ctx.device(), ctx.queue(), WGPUBufferUsage_Index,
        cpuM.indices.data(), cpuM.indices.size() * sizeof(uint32_t)
      );
      wb.instVbo = createBufferWithData(
        ctx.device(), ctx.queue(), WGPUBufferUsage_Vertex,
        nullptr, kMaxWepInst * sizeof(InstanceAttrib)
      );
      wb.shadowNearInstVbo = createBufferWithData(
        ctx.device(), ctx.queue(), WGPUBufferUsage_Vertex,
        nullptr, kMaxWepInst * sizeof(InstanceAttrib)
      );
      GlbSubmesh sub{};
      sub.indexOffset = 0;
      sub.indexCount = wb.indexCount;
      sub.texBindGroup = weaponMatBindGroups_[static_cast<size_t>(cpuM.material)];
      wb.submeshes.push_back(sub);
      wb.visibleStaging.reserve(kMaxWepInst);
      wb.shadowNearStaging.reserve(kMaxWepInst);
    }
  }
}

void WorldRenderer::buildSkinnedMesh(WgpuContext& ctx, const GltfModel& model, SkinnedMeshGpu& outMesh) {
  std::vector<SkinnedVertex> verts;
  std::vector<uint32_t> indices;

  std::unordered_map<int32_t, WGPUTextureView> texViewCache;
  auto getTexView = [&](int32_t idx, WGPUTextureView fallback) -> WGPUTextureView {
    if (idx < 0 || static_cast<size_t>(idx) >= model.textures.size()) return fallback;
    auto it = texViewCache.find(idx);
    if (it != texViewCache.end()) return it->second;
    const auto& td = model.textures[idx];
    if (td.width == 0 || td.height == 0 || td.rgba8.empty()) return fallback;
    GpuTextureBinding gtb = createRgbaTexture(ctx, td.width, td.height, td.rgba8.data(), false);
    outMesh.ownedTextures.push_back(gtb);
    texViewCache[idx] = gtb.view;
    return gtb.view;
  };

  std::unordered_map<uint64_t, WGPUBindGroup> matBgCache;
  for (const auto& prim : model.primitives) {
    const uint32_t vBase = static_cast<uint32_t>(verts.size());
    const uint32_t iStart = static_cast<uint32_t>(indices.size());

    glm::vec3 matCol(1.0f);
    WGPUBindGroup texBg = defaultWhiteTex_.bindGroup;
    if (prim.materialIndex >= 0 && static_cast<size_t>(prim.materialIndex) < model.materials.size()) {
      const auto& mat = model.materials[prim.materialIndex];
      matCol = glm::vec3(mat.baseColor);
      const int32_t alb = mat.baseColorTexIndex;
      const int32_t nrm = mat.normalTexIndex;
      const int32_t mr  = mat.metallicRoughnessTexIndex;
      const int32_t em  = mat.emissiveTexIndex;
      if (alb >= 0 || nrm >= 0 || mr >= 0 || em >= 0) {
        const uint64_t key =
          (static_cast<uint64_t>(static_cast<uint16_t>(alb + 1)) << 48) |
          (static_cast<uint64_t>(static_cast<uint16_t>(nrm + 1)) << 32) |
          (static_cast<uint64_t>(static_cast<uint16_t>(mr + 1))  << 16) |
          static_cast<uint64_t>(static_cast<uint16_t>(em + 1));
        auto it = matBgCache.find(key);
        if (it != matBgCache.end()) {
          texBg = it->second;
        } else {
          texBg = createPbrMatBindGroup(
            ctx,
            getTexView(alb, defaultWhiteTex_.view),
            getTexView(nrm, defaultFlatNormalTex_.view),
            getTexView(mr, defaultWhiteTex_.view),
            getTexView(em, defaultWhiteTex_.view)
          );
          outMesh.ownedBindGroups.push_back(texBg);
          matBgCache[key] = texBg;
        }
        if (alb >= 0) matCol = glm::vec3(1.0f);
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
  bool drawUiCallback,
  const std::vector<DynamicGlbPropInstance>& dynGlbProps,
  const std::vector<WeaponPartDrawInstance>& weaponParts
) {
  const float aspect = static_cast<float>(ctx.width()) / static_cast<float>(std::max(1u, ctx.height()));
  constexpr float kCameraZNear = 0.045f;
  const glm::mat4 proj = glm::perspectiveZO(glm::radians(fovDeg), aspect, kCameraZNear, 2800.0f);
  const glm::mat4 view = glm::lookAt(camPos, camTarget, glm::vec3(0.0f, 1.0f, 0.0f));
  const glm::mat4 vp = proj * view;

  const Frustum frustum = Frustum::fromViewProj(vp);
  // Stream chunks around camPos so distant camera shots (--cam) and helicopter flight stream Near detail around the viewer
  streamer.update(camPos, frustum);

  // Compute 2-cascade texel-snapped directional sun shadow matrices
  const glm::vec3 sunDir = glm::normalize(sky.sunDir);
  const glm::vec3 shadowUp = (std::abs(sunDir.y) > 0.98f) ? glm::vec3(0.0f, 0.0f, 1.0f) : glm::vec3(0.0f, 1.0f, 0.0f);
  const glm::vec3 shadowAnchor = (glm::distance(camPos, focusPos) > 45.0f) ? camTarget : focusPos;

  const float nearExt = 56.0f;
  const float nearTexel = (nearExt * 2.0f) / static_cast<float>(kShadowMapSize);
  const glm::vec3 nearCenter(
    std::floor(shadowAnchor.x / nearTexel) * nearTexel,
    shadowAnchor.y,
    std::floor(shadowAnchor.z / nearTexel) * nearTexel
  );
  const glm::mat4 lightProjNear = glm::orthoZO(-nearExt, nearExt, -nearExt, nearExt, 1.0f, 380.0f);
  const glm::mat4 lightViewNear = glm::lookAt(nearCenter + sunDir * 180.0f, nearCenter, shadowUp);

  const float farExt = 270.0f;
  const float farTexel = (farExt * 2.0f) / static_cast<float>(kShadowMapSize);
  const glm::vec3 farCenter(
    std::floor(shadowAnchor.x / farTexel) * farTexel,
    shadowAnchor.y,
    std::floor(shadowAnchor.z / farTexel) * farTexel
  );
  const glm::mat4 lightProjFar = glm::orthoZO(-farExt, farExt, -farExt, farExt, 1.0f, 680.0f);
  const glm::mat4 lightViewFar = glm::lookAt(farCenter + sunDir * 320.0f, farCenter, shadowUp);

  // 1. Gather streamed chunk custom mesh slices + architectural boxes (Near vs Lod + Shadow Cascades)
  buildingStaging_.clear();
  shadowNearBoxStaging_.clear();
  shadowFarBoxStaging_.clear();
  for (auto& hs : houseStaging_) hs.clear();
  std::vector<ChunkMeshSlice> visibleCustomSlices;
  std::vector<ChunkMeshSlice> shadowNearCustomSlices;
  std::vector<ChunkMeshSlice> shadowFarCustomSlices;
  visibleCustomSlices.reserve(96);
  shadowNearCustomSlices.reserve(16);
  shadowFarCustomSlices.reserve(64);

  uint32_t totalBuildingsDrawn = 0;

  if (world.hasCustomMeshes) {
    for (size_t ci = 0; ci < world.chunks.size(); ++ci) {
      const auto& ch = world.chunks[ci];
      const auto& cv = streamer.views()[ci];
      const bool inShadNear = aabbOverlapsXZ(ch.bounds, nearCenter, nearExt + 24.0f);
      const bool inShadFar  = aabbOverlapsXZ(ch.bounds, farCenter, farExt + 45.0f);

      if (ch.meshSlice.indexCount > 0) {
        if (cv.visibleInFrustum) visibleCustomSlices.push_back(ch.meshSlice);
        if (inShadNear) shadowNearCustomSlices.push_back(ch.meshSlice);
        if (inShadFar)  shadowFarCustomSlices.push_back(ch.meshSlice);
      }

      if (cv.visibleInFrustum) {
        const auto& srcBoxes = (cv.state == ChunkLodState::Near) ? ch.nearBoxes : ch.lodBoxes;
        for (const auto& pb : srcBoxes) {
          if (buildingStaging_.size() >= buildingCapacity_) break;
          buildingStaging_.push_back(makeArchBoxInst(pb));
          ++totalBuildingsDrawn;
        }
      }

      if (inShadNear) {
        for (const auto& pb : ch.nearBoxes) {
          if (shadowNearBoxStaging_.size() >= shadowNearBoxCapacity_) break;
          if (pb.hy < 0.22f) continue;
          shadowNearBoxStaging_.push_back(makeArchBoxInst(pb));
        }
      }
      if (inShadFar) {
        // Use clean structural boxes (>1.2m half-height) in far cascade for ultra-fast crisp skyline shadows
        const auto& farSrc = !ch.lodBoxes.empty() ? ch.lodBoxes : ch.nearBoxes;
        for (const auto& pb : farSrc) {
          if (shadowFarBoxStaging_.size() >= shadowFarBoxCapacity_) break;
          if (pb.hy < 0.85f) continue;
          shadowFarBoxStaging_.push_back(makeArchBoxInst(pb));
        }
      }
    }
  } else {
    // Legacy synthetic unit-test path
    for (const auto& v : streamer.views()) {
      if (!v.visibleInFrustum) continue;
      const auto& ch = world.chunks[v.chunkIndex];
      for (const auto& b : ch.buildings) {
        if (v.state == ChunkLodState::Lod && b.size.y < 8.0f) continue;
        if (buildingStaging_.size() < buildingCapacity_) {
          buildingStaging_.push_back(makeInstYaw(b.center.x, b.center.y, b.center.z, b.size.x, b.size.y, b.size.z, 0.0f, b.color.r, b.color.g, b.color.b));
          ++totalBuildingsDrawn;
        }
      }
    }
    shadowNearBoxStaging_ = buildingStaging_;
    shadowFarBoxStaging_ = buildingStaging_;
  }

  if (!buildingStaging_.empty()) {
    wgpuQueueWriteBuffer(ctx.queue(), buildingInstVbo_, 0, buildingStaging_.data(), buildingStaging_.size() * sizeof(InstanceAttrib));
  }
  if (!shadowFarBoxStaging_.empty()) {
    wgpuQueueWriteBuffer(ctx.queue(), shadowFarBoxInstVbo_, 0, shadowFarBoxStaging_.data(), shadowFarBoxStaging_.size() * sizeof(InstanceAttrib));
  }

  // 2. Spatial + Frustum + Shadow-Cascade Culling for PropBatcher Prototypes & 94 PBR GLB Placement Batches
  uint32_t drawnPropsCount = fallbackPropCount_;
  const float nearShadR2 = (nearExt + 18.0f) * (nearExt + 18.0f);
  const float farShadR2  = (farExt + 32.0f) * (farExt + 32.0f);

  for (auto& cb : customPropBatches_) {
    cb.visibleStaging.clear();
    cb.shadowNearStaging.clear();
    for (const auto& it : cb.spatialItems) {
      const glm::vec3 dCam = it.center - camPos;
      const float d2 = glm::dot(dCam, dCam);
      if (d2 <= it.maxDrawDist * it.maxDrawDist && sphereInFrustum(frustum, it.center, it.radius)) {
        cb.visibleStaging.push_back(it.attrib);
      }
      const float dxN = it.center.x - nearCenter.x;
      const float dzN = it.center.z - nearCenter.z;
      if (dxN * dxN + dzN * dzN <= nearShadR2 && it.radius > 1.2f) {
        cb.shadowNearStaging.push_back(it.attrib);
      }
    }
    cb.visibleCount = static_cast<uint32_t>(cb.visibleStaging.size());
    cb.shadowNearCount = static_cast<uint32_t>(cb.shadowNearStaging.size());
    drawnPropsCount += cb.visibleCount;
    if (cb.visibleCount > 0) {
      wgpuQueueWriteBuffer(ctx.queue(), cb.instVbo, 0, cb.visibleStaging.data(), cb.visibleCount * sizeof(InstanceAttrib));
    }
    if (cb.shadowNearCount > 0) {
      wgpuQueueWriteBuffer(ctx.queue(), cb.shadowNearInstVbo, 0, cb.shadowNearStaging.data(), cb.shadowNearCount * sizeof(InstanceAttrib));
    }
  }

  for (auto& batch : glbPropBatches_) {
    if (batch.spatialItems.empty()) continue;
    batch.visibleStaging.clear();
    batch.shadowNearStaging.clear();
    batch.shadowFarStaging.clear();
    for (const auto& it : batch.spatialItems) {
      const glm::vec3 dCam = it.center - camPos;
      const float d2 = glm::dot(dCam, dCam);
      if (d2 <= it.maxDrawDist * it.maxDrawDist && sphereInFrustum(frustum, it.center, it.radius)) {
        batch.visibleStaging.push_back(it.attrib);
      }
      const float dxN = it.center.x - nearCenter.x;
      const float dzN = it.center.z - nearCenter.z;
      if (dxN * dxN + dzN * dzN <= nearShadR2) {
        batch.shadowNearStaging.push_back(it.attrib);
      }
      if (it.radius >= 2.2f) {
        const float dxF = it.center.x - farCenter.x;
        const float dzF = it.center.z - farCenter.z;
        if (dxF * dxF + dzF * dzF <= farShadR2) {
          batch.shadowFarStaging.push_back(it.attrib);
        }
      }
    }
    batch.instanceCount = static_cast<uint32_t>(batch.visibleStaging.size());
    batch.shadowNearCount = static_cast<uint32_t>(batch.shadowNearStaging.size());
    batch.shadowFarCount = static_cast<uint32_t>(batch.shadowFarStaging.size());
    drawnPropsCount += batch.instanceCount;
    if (batch.instanceCount > 0) {
      wgpuQueueWriteBuffer(ctx.queue(), batch.instVbo, 0, batch.visibleStaging.data(), batch.instanceCount * sizeof(InstanceAttrib));
    }
    if (batch.shadowNearCount > 0) {
      wgpuQueueWriteBuffer(ctx.queue(), batch.shadowNearInstVbo, 0, batch.shadowNearStaging.data(), batch.shadowNearCount * sizeof(InstanceAttrib));
    }
    if (batch.shadowFarCount > 0) {
      wgpuQueueWriteBuffer(ctx.queue(), batch.shadowFarInstVbo, 0, batch.shadowFarStaging.data(), batch.shadowFarCount * sizeof(InstanceAttrib));
    }
  }

  // 3. Upload dynamic markers, tracers, laser beams & 3D modular held weapons
  markerStaging_.clear();
  for (const auto& m : markers) {
    if (markerStaging_.size() >= markerCapacity_) break;
    const glm::quat q = m.useQuat
      ? m.rot
      : (glm::angleAxis(m.yawRad, glm::vec3(0.0f, 1.0f, 0.0f)) *
         glm::angleAxis(m.pitchRad, glm::vec3(1.0f, 0.0f, 0.0f)));
    const float famMetal = (m.roughness >= 0.0f) ? (8.0f + std::clamp(m.metallic, 0.0f, 1.0f) * 0.49f) : 0.0f;
    const InstanceAttrib inst = makeInst(
      m.pos.x, m.pos.y, m.pos.z,
      m.scale.x, m.scale.y, m.scale.z,
      q,
      m.color.r, m.color.g, m.color.b,
      m.emissive, m.roughness, famMetal
    );
    markerStaging_.push_back(inst);
    if (m.roughness >= 0.0f && m.emissive < 0.5f && shadowNearBoxStaging_.size() < shadowNearBoxCapacity_) {
      shadowNearBoxStaging_.push_back(inst);
    }
  }
  if (!markerStaging_.empty()) {
    wgpuQueueWriteBuffer(ctx.queue(), markerInstVbo_, 0, markerStaging_.data(), markerStaging_.size() * sizeof(InstanceAttrib));
  }
  if (!shadowNearBoxStaging_.empty()) {
    wgpuQueueWriteBuffer(ctx.queue(), shadowNearBoxInstVbo_, 0, shadowNearBoxStaging_.data(), shadowNearBoxStaging_.size() * sizeof(InstanceAttrib));
  }

  // 4. Upload dynamic Jolt rigid-body crates, barrels & knockable props
  dynPropStaging_.clear();
  for (const auto& dp : dynamicProps) {
    if (dynPropStaging_.size() >= dynPropCapacity_) break;
    dynPropStaging_.push_back(makeInst(
      dp.position.x, dp.position.y, dp.position.z,
      dp.halfExtents.x * 2.0f, dp.halfExtents.y * 2.0f, dp.halfExtents.z * 2.0f,
      dp.rotation,
      dp.color.r, dp.color.g, dp.color.b,
      0.0f, 0.78f, 5.0f
    ));
  }
  if (!dynPropStaging_.empty()) {
    wgpuQueueWriteBuffer(ctx.queue(), dynPropInstVbo_, 0, dynPropStaging_.data(), dynPropStaging_.size() * sizeof(InstanceAttrib));
  }
  telemetry_.dynamicPhysicsProps = static_cast<uint32_t>(dynPropStaging_.size());

  // 4b. Upload dynamic Living-World GLB props (stashes, medkits, explosive tanks/cans, coastal birds)
  for (auto& db : dynGlbBatches_) {
    db.visibleStaging.clear();
    db.shadowNearStaging.clear();
    db.instanceCount = 0;
    db.shadowNearCount = 0;
  }
  for (const auto& dp : dynGlbProps) {
    const size_t k = static_cast<size_t>(dp.kind);
    if (k >= kDynamicGlbPropCount) continue;
    auto& db = dynGlbBatches_[k];
    if (!db.vbo || db.visibleStaging.size() >= db.maxInstances) continue;
    const float d = glm::distance(dp.pos, camPos);
    if (d > 420.0f) continue;
    const float rCull = 1.5f * dp.scale;
    if (!frustum.intersectsAABB(AABB{dp.pos - glm::vec3(rCull), dp.pos + glm::vec3(rCull)})) continue;
    const glm::quat q = glm::angleAxis(dp.yawRad, glm::vec3(0.0f, 1.0f, 0.0f)) *
                        glm::angleAxis(dp.pitchRad, glm::vec3(1.0f, 0.0f, 0.0f));
    const InstanceAttrib attr = makeInst(
      dp.pos.x, dp.pos.y, dp.pos.z,
      dp.scale, dp.scale, dp.scale,
      q,
      dp.tint.r, dp.tint.g, dp.tint.b,
      dp.emissive
    );
    db.visibleStaging.push_back(attr);
    if (d < 70.0f && db.shadowNearStaging.size() < db.maxInstances) {
      db.shadowNearStaging.push_back(attr);
    }
  }
  for (auto& db : dynGlbBatches_) {
    db.instanceCount = static_cast<uint32_t>(db.visibleStaging.size());
    db.shadowNearCount = static_cast<uint32_t>(db.shadowNearStaging.size());
    if (db.instanceCount > 0 && db.instVbo) {
      wgpuQueueWriteBuffer(ctx.queue(), db.instVbo, 0, db.visibleStaging.data(), db.instanceCount * sizeof(InstanceAttrib));
    }
    if (db.shadowNearCount > 0 && db.shadowNearInstVbo) {
      wgpuQueueWriteBuffer(ctx.queue(), db.shadowNearInstVbo, 0, db.shadowNearStaging.data(), db.shadowNearCount * sizeof(InstanceAttrib));
    }
  }

  // 4c. Upload 3D Modular Textured Weapons & First-Person Viewmodel Parts
  for (auto& wb : weaponPartBatches_) {
    wb.visibleStaging.clear();
    wb.shadowNearStaging.clear();
  }
  for (const auto& wp : weaponParts) {
    const size_t pi = static_cast<size_t>(wp.part);
    if (pi >= kWeaponMeshPartCount) continue;
    auto& wb = weaponPartBatches_[pi];
    if (!wb.vbo || wb.visibleStaging.size() >= wb.maxInstances) continue;
    InstanceAttrib attr = makeInst(
      wp.pos.x, wp.pos.y, wp.pos.z,
      wp.scale.x, wp.scale.y, wp.scale.z,
      wp.rot,
      wp.color.r, wp.color.g, wp.color.b,
      wp.emissive
    );
    attr.overrideRoughness = -10.0f - std::clamp(wp.roughness, 0.05f, 0.98f);
    attr.familyAndMetal = std::clamp(wp.metallic, 0.0f, 1.0f);
    wb.visibleStaging.push_back(attr);
    if (wp.castShadow && wb.shadowNearStaging.size() < wb.maxInstances) {
      wb.shadowNearStaging.push_back(attr);
    }
  }
  for (auto& wb : weaponPartBatches_) {
    wb.instanceCount = static_cast<uint32_t>(wb.visibleStaging.size());
    wb.shadowNearCount = static_cast<uint32_t>(wb.shadowNearStaging.size());
    if (wb.instanceCount > 0 && wb.instVbo) {
      wgpuQueueWriteBuffer(ctx.queue(), wb.instVbo, 0, wb.visibleStaging.data(), wb.instanceCount * sizeof(InstanceAttrib));
    }
    if (wb.shadowNearCount > 0 && wb.shadowNearInstVbo) {
      wgpuQueueWriteBuffer(ctx.queue(), wb.shadowNearInstVbo, 0, wb.shadowNearStaging.data(), wb.shadowNearCount * sizeof(InstanceAttrib));
    }
  }

  // 5. Upload articulated dynamic vehicles across all 20 GLB models (chassis + steered/spinning wheels + rotors!)
  uint32_t totalVehiclesDrawn = 0;
  for (auto& va : vehicleAssets_) {
    va.chassisStaging.clear();
    va.mainRotorStaging.clear();
    va.tailRotorStaging.clear();
    for (auto& w : va.wheels) w.staging.clear();
  }
  for (const auto& v : vehicles) {
    const size_t k = static_cast<size_t>(v.kind);
    if (k >= kVehicleModelCount) continue;
    auto& va = vehicleAssets_[k];
    if (!va.chassis.vbo || va.chassisStaging.size() >= va.chassis.maxInstances) continue;
    if (glm::distance(v.pos, camPos) > 560.0f) continue;

    const glm::quat qChassis = glm::angleAxis(v.yawRad, glm::vec3(0.0f, 1.0f, 0.0f)) *
                               glm::angleAxis(v.pitchRad, glm::vec3(1.0f, 0.0f, 0.0f)) *
                               glm::angleAxis(v.rollRad, glm::vec3(0.0f, 0.0f, 1.0f));
    const glm::vec3 bodyOrigin = v.pos + glm::vec3(0.0f, v.suspHeave, 0.0f);
    const float dmgShade = v.destroyed ? 0.16f : (0.68f + 0.32f * std::clamp(v.hp / 100.0f, 0.0f, 1.0f));
    const glm::vec3 bodyTint = v.colorTint * dmgShade;
    const uint32_t lightBits = (!v.destroyed)
      ? ((v.braking ? 1u : 0u) | (v.sirenActive ? 2u : 0u) | (v.headlightsOn ? 4u : 0u))
      : 0u;
    const float lightMaskFloat = static_cast<float>(lightBits);

    va.chassisStaging.push_back(makeInst(
      bodyOrigin.x, bodyOrigin.y, bodyOrigin.z,
      1.0f, 1.0f, 1.0f,
      qChassis,
      bodyTint.r, bodyTint.g, bodyTint.b,
      lightMaskFloat
    ));

    // Articulated multi-axle wheels (front steer + rolling tire spin + per-corner suspension travel)
    for (auto& w : va.wheels) {
      if (w.staging.size() >= w.batch.maxInstances) continue;
      const float suspOff = (w.cornerIdx >= 0 && w.cornerIdx < 4) ? v.wheelSuspOffsets[static_cast<size_t>(w.cornerIdx)] : 0.0f;
      const glm::vec3 wWorld = bodyOrigin + qChassis * (w.pivotVeh + glm::vec3(0.0f, suspOff, 0.0f));
      const float steer = w.isFront ? v.steerAngle : 0.0f;
      const glm::quat qWheel = qChassis *
                               glm::angleAxis(steer, glm::vec3(0.0f, 1.0f, 0.0f)) *
                               glm::angleAxis(v.wheelSpinRad, glm::vec3(1.0f, 0.0f, 0.0f));
      w.staging.push_back(makeInst(
        wWorld.x, wWorld.y, wWorld.z,
        1.0f, 1.0f, 1.0f,
        qWheel,
        dmgShade, dmgShade, dmgShade,
        0.0f
      ));
    }

    // Helicopter Main Rotor (Cube004 around +Y) & Tail Rotor (Cube002 around +X)
    const float rAng = (v.rotorAngleRad != 0.0f) ? v.rotorAngleRad : (timeSec * (v.occupiedByPlayer ? 24.0f : 3.5f));
    if (va.hasMainRotor && va.mainRotorStaging.size() < va.mainRotor.maxInstances) {
      const glm::vec3 hub = bodyOrigin + qChassis * va.mainRotorPivotVeh;
      const glm::quat qMain = qChassis * glm::angleAxis(rAng, glm::vec3(0.0f, 1.0f, 0.0f));
      va.mainRotorStaging.push_back(makeInst(hub.x, hub.y, hub.z, 1.0f, 1.0f, 1.0f, qMain, dmgShade, dmgShade, dmgShade, 0.0f));
    }
    if (va.hasTailRotor && va.tailRotorStaging.size() < va.tailRotor.maxInstances) {
      const glm::vec3 hub = bodyOrigin + qChassis * va.tailRotorPivotVeh;
      const glm::quat qTail = qChassis * glm::angleAxis(rAng * 4.5f, glm::vec3(1.0f, 0.0f, 0.0f));
      va.tailRotorStaging.push_back(makeInst(hub.x, hub.y, hub.z, 1.0f, 1.0f, 1.0f, qTail, dmgShade, dmgShade, dmgShade, 0.0f));
    }
  }
  for (auto& va : vehicleAssets_) {
    const uint32_t cnt = static_cast<uint32_t>(va.chassisStaging.size());
    if (cnt == 0) continue;
    totalVehiclesDrawn += cnt;
    if (va.chassis.instVbo) {
      wgpuQueueWriteBuffer(ctx.queue(), va.chassis.instVbo, 0, va.chassisStaging.data(), cnt * sizeof(InstanceAttrib));
    }
    for (auto& w : va.wheels) {
      if (!w.staging.empty() && w.batch.instVbo) {
        wgpuQueueWriteBuffer(ctx.queue(), w.batch.instVbo, 0, w.staging.data(), w.staging.size() * sizeof(InstanceAttrib));
      }
    }
    if (va.hasMainRotor && !va.mainRotorStaging.empty() && va.mainRotor.instVbo) {
      wgpuQueueWriteBuffer(ctx.queue(), va.mainRotor.instVbo, 0, va.mainRotorStaging.data(), va.mainRotorStaging.size() * sizeof(InstanceAttrib));
    }
    if (va.hasTailRotor && !va.tailRotorStaging.empty() && va.tailRotor.instVbo) {
      wgpuQueueWriteBuffer(ctx.queue(), va.tailRotor.instVbo, 0, va.tailRotorStaging.data(), va.tailRotorStaging.size() * sizeof(InstanceAttrib));
    }
  }

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
  postUbo.screenSize = glm::vec4(static_cast<float>(ctx.width()), static_cast<float>(ctx.height()), 1.05f, bloomIntensity_);
  postUbo.projParams = glm::vec4(kCameraZNear, 2800.0f, 16.0f, ssaoStrength_);
  wgpuQueueWriteBuffer(ctx.queue(), postUbo_, 0, &postUbo, sizeof(postUbo));

  const uint32_t charCount = static_cast<uint32_t>(std::min<size_t>(characters.size(), kMaxSkinSlots));
  for (uint32_t ci = 0; ci < charCount; ++ci) {
    const auto& ch = characters[ci];
    SkinUniforms su{};
    float modelYaw = ch.yawRad;
    if (ch.part == SkinnedPartKind::Business ||
        ch.part == SkinnedPartKind::Civilian ||
        ch.part == SkinnedPartKind::Police ||
        ch.part == SkinnedPartKind::Security ||
        ch.part == SkinnedPartKind::VanguardSoldier ||
        ch.part == SkinnedPartKind::Military ||
        ch.part == SkinnedPartKind::Construction ||
        ch.part == SkinnedPartKind::Sports) {
      modelYaw += 3.14159265f;
    }
    su.model = glm::translate(glm::mat4(1.0f), ch.position) *
               glm::rotate(glm::mat4(1.0f), modelYaw, glm::vec3(0.0f, 1.0f, 0.0f)) *
               glm::mat4_cast(ch.extraLocalRot) *
               glm::scale(glm::mat4(1.0f), glm::vec3(ch.uniformScale));
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
  telemetry_.drawnProps = drawnPropsCount;
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

  ensureOffscreenTargets(ctx);

  WGPUCommandEncoderDescriptor encDesc = {};
  WGPUCommandEncoder enc = wgpuDeviceCreateCommandEncoder(ctx.device(), &encDesc);

  // -------------------------------------------------------------------------
  // Pass 1A & 1B: 2-Cascade 2048x2048 Directional Sun Shadow Passes
  // -------------------------------------------------------------------------
  const auto runShadowCascade = [&](
    bool isNear,
    WGPUTextureView layerView,
    WGPURenderPipeline terrainPipe,
    WGPURenderPipeline customPipe,
    WGPURenderPipeline customInstPipe,
    WGPURenderPipeline instPipe,
    WGPURenderPipeline skinPipe
  ) {
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

    if (!isNear && terrainPipe && terrainIndexCount_ > 0) {
      wgpuRenderPassEncoderSetPipeline(spass, terrainPipe);
      wgpuRenderPassEncoderSetVertexBuffer(spass, 0, terrainVbo_, 0, WGPU_WHOLE_SIZE);
      wgpuRenderPassEncoderSetIndexBuffer(spass, terrainIbo_, WGPUIndexFormat_Uint32, 0, WGPU_WHOLE_SIZE);
      wgpuRenderPassEncoderDrawIndexed(spass, terrainIndexCount_, 1, 0, 0, 0);
    }

    const auto& customSlices = isNear ? shadowNearCustomSlices : shadowFarCustomSlices;
    if (customPipe && customMeshVbo_ && !customSlices.empty()) {
      wgpuRenderPassEncoderSetPipeline(spass, customPipe);
      wgpuRenderPassEncoderSetVertexBuffer(spass, 0, customMeshVbo_, 0, WGPU_WHOLE_SIZE);
      wgpuRenderPassEncoderSetIndexBuffer(spass, customMeshIbo_, WGPUIndexFormat_Uint32, 0, WGPU_WHOLE_SIZE);
      for (const auto& sl : customSlices) {
        wgpuRenderPassEncoderDrawIndexed(spass, sl.indexCount, 1, sl.firstIndex, 0, 0);
      }
    }

    if (isNear && customInstPipe && !customPropBatches_.empty()) {
      wgpuRenderPassEncoderSetPipeline(spass, customInstPipe);
      for (const auto& cb : customPropBatches_) {
        if (cb.shadowNearCount == 0) continue;
        wgpuRenderPassEncoderSetVertexBuffer(spass, 0, cb.vbo, 0, WGPU_WHOLE_SIZE);
        wgpuRenderPassEncoderSetVertexBuffer(spass, 1, cb.shadowNearInstVbo, 0, WGPU_WHOLE_SIZE);
        wgpuRenderPassEncoderSetIndexBuffer(spass, cb.ibo, WGPUIndexFormat_Uint32, 0, WGPU_WHOLE_SIZE);
        wgpuRenderPassEncoderDrawIndexed(spass, cb.indexCount, cb.shadowNearCount, 0, 0, 0);
      }
    }

    wgpuRenderPassEncoderSetPipeline(spass, instPipe);
    const auto& boxStaging = isNear ? shadowNearBoxStaging_ : shadowFarBoxStaging_;
    WGPUBuffer boxInstBuf  = isNear ? shadowNearBoxInstVbo_ : shadowFarBoxInstVbo_;
    if (!boxStaging.empty() && boxInstBuf) {
      wgpuRenderPassEncoderSetVertexBuffer(spass, 0, unitBoxVbo_, 0, WGPU_WHOLE_SIZE);
      wgpuRenderPassEncoderSetVertexBuffer(spass, 1, boxInstBuf, 0, WGPU_WHOLE_SIZE);
      wgpuRenderPassEncoderSetIndexBuffer(spass, unitBoxIbo_, WGPUIndexFormat_Uint32, 0, WGPU_WHOLE_SIZE);
      wgpuRenderPassEncoderDrawIndexed(spass, unitBoxIndexCount_, static_cast<uint32_t>(boxStaging.size()), 0, 0, 0);
    }

    if (isNear && !dynPropStaging_.empty() && dynPropInstVbo_) {
      wgpuRenderPassEncoderSetVertexBuffer(spass, 0, unitBoxVbo_, 0, WGPU_WHOLE_SIZE);
      wgpuRenderPassEncoderSetVertexBuffer(spass, 1, dynPropInstVbo_, 0, WGPU_WHOLE_SIZE);
      wgpuRenderPassEncoderSetIndexBuffer(spass, unitBoxIbo_, WGPUIndexFormat_Uint32, 0, WGPU_WHOLE_SIZE);
      wgpuRenderPassEncoderDrawIndexed(spass, unitBoxIndexCount_, static_cast<uint32_t>(dynPropStaging_.size()), 0, 0, 0);
    }

    for (const auto& batch : glbPropBatches_) {
      const uint32_t cnt = isNear ? batch.shadowNearCount : batch.shadowFarCount;
      WGPUBuffer ibuf = isNear ? batch.shadowNearInstVbo : batch.shadowFarInstVbo;
      if (cnt == 0 || !ibuf) continue;
      wgpuRenderPassEncoderSetVertexBuffer(spass, 0, batch.vbo, 0, WGPU_WHOLE_SIZE);
      wgpuRenderPassEncoderSetVertexBuffer(spass, 1, ibuf, 0, WGPU_WHOLE_SIZE);
      wgpuRenderPassEncoderSetIndexBuffer(spass, batch.ibo, WGPUIndexFormat_Uint32, 0, WGPU_WHOLE_SIZE);
      wgpuRenderPassEncoderDrawIndexed(spass, batch.indexCount, cnt, 0, 0, 0);
    }
    if (isNear) {
      for (const auto& db : dynGlbBatches_) {
        if (db.shadowNearCount == 0 || !db.shadowNearInstVbo || !db.vbo) continue;
        wgpuRenderPassEncoderSetVertexBuffer(spass, 0, db.vbo, 0, WGPU_WHOLE_SIZE);
        wgpuRenderPassEncoderSetVertexBuffer(spass, 1, db.shadowNearInstVbo, 0, WGPU_WHOLE_SIZE);
        wgpuRenderPassEncoderSetIndexBuffer(spass, db.ibo, WGPUIndexFormat_Uint32, 0, WGPU_WHOLE_SIZE);
        wgpuRenderPassEncoderDrawIndexed(spass, db.indexCount, db.shadowNearCount, 0, 0, 0);
      }
      for (const auto& wb : weaponPartBatches_) {
        if (wb.shadowNearCount == 0 || !wb.shadowNearInstVbo || !wb.vbo) continue;
        wgpuRenderPassEncoderSetVertexBuffer(spass, 0, wb.vbo, 0, WGPU_WHOLE_SIZE);
        wgpuRenderPassEncoderSetVertexBuffer(spass, 1, wb.shadowNearInstVbo, 0, WGPU_WHOLE_SIZE);
        wgpuRenderPassEncoderSetIndexBuffer(spass, wb.ibo, WGPUIndexFormat_Uint32, 0, WGPU_WHOLE_SIZE);
        wgpuRenderPassEncoderDrawIndexed(spass, wb.indexCount, wb.shadowNearCount, 0, 0, 0);
      }
    }

    auto drawVehShadowPart = [&](const InstancedGlbBatch& b, uint32_t cnt) {
      if (cnt == 0 || !b.vbo || !b.instVbo) return;
      wgpuRenderPassEncoderSetVertexBuffer(spass, 0, b.vbo, 0, WGPU_WHOLE_SIZE);
      wgpuRenderPassEncoderSetVertexBuffer(spass, 1, b.instVbo, 0, WGPU_WHOLE_SIZE);
      wgpuRenderPassEncoderSetIndexBuffer(spass, b.ibo, WGPUIndexFormat_Uint32, 0, WGPU_WHOLE_SIZE);
      wgpuRenderPassEncoderDrawIndexed(spass, b.indexCount, cnt, 0, 0, 0);
    };
    for (const auto& va : vehicleAssets_) {
      const uint32_t cnt = static_cast<uint32_t>(va.chassisStaging.size());
      if (cnt == 0) continue;
      drawVehShadowPart(va.chassis, cnt);
      if (isNear) {
        for (const auto& w : va.wheels) {
          drawVehShadowPart(w.batch, static_cast<uint32_t>(w.staging.size()));
        }
        if (va.hasMainRotor) drawVehShadowPart(va.mainRotor, static_cast<uint32_t>(va.mainRotorStaging.size()));
        if (va.hasTailRotor) drawVehShadowPart(va.tailRotor, static_cast<uint32_t>(va.tailRotorStaging.size()));
      }
    }

    if (isNear && charCount > 0) {
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
          case SkinnedPartKind::VanguardSoldier: drawSkinShadow(vanguardSoldierGpu_); break;
          case SkinnedPartKind::Business: drawSkinShadow(businessGpu_); break;
          case SkinnedPartKind::Civilian: drawSkinShadow(civilianGpu_); break;
          case SkinnedPartKind::Police: drawSkinShadow(policeGpu_); break;
          case SkinnedPartKind::Security: drawSkinShadow(securityGpu_); break;
          case SkinnedPartKind::Military: drawSkinShadow(militaryGpu_); break;
          case SkinnedPartKind::Construction: drawSkinShadow(constructionGpu_); break;
          case SkinnedPartKind::Sports: drawSkinShadow(sportsGpu_); break;
          case SkinnedPartKind::DogHusky: drawSkinShadow(dogHuskyGpu_); break;
          case SkinnedPartKind::Deer: drawSkinShadow(deerGpu_); break;
        }
      }
    }

    wgpuRenderPassEncoderEnd(spass);
    wgpuRenderPassEncoderRelease(spass);
  };

  runShadowCascade(true,  shadowLayerViews_[0], shadowTerrainNearPipeline_, shadowCustomNearPipeline_, shadowCustomInstNearPipeline_, shadowInstancedNearPipeline_, shadowSkinnedNearPipeline_);
  runShadowCascade(false, shadowLayerViews_[1], shadowTerrainFarPipeline_,  shadowCustomFarPipeline_,  shadowCustomInstFarPipeline_,  shadowInstancedFarPipeline_,  shadowSkinnedFarPipeline_);

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

    if (skyPipeline_) {
      wgpuRenderPassEncoderSetPipeline(pass, skyPipeline_);
      wgpuRenderPassEncoderSetBindGroup(pass, 0, frameBg_, 0, nullptr);
      wgpuRenderPassEncoderDraw(pass, 3, 1, 0, 0);
    }

    wgpuRenderPassEncoderSetBindGroup(pass, 0, frameBg_, 0, nullptr);
    wgpuRenderPassEncoderSetBindGroup(pass, 1, skinSlots_[0].bindGroup, 0, nullptr);
    wgpuRenderPassEncoderSetBindGroup(pass, 2, defaultWhiteTex_.bindGroup, 0, nullptr);
    wgpuRenderPassEncoderSetBindGroup(pass, 3, shadowReadBg_, 0, nullptr);

    // 1. Westgate Bay Terrain + Wet-Cell-Clipped Ocean/River/Harbor/Canal Water
    wgpuRenderPassEncoderSetPipeline(pass, terrainPipeline_);
    wgpuRenderPassEncoderSetVertexBuffer(pass, 0, terrainVbo_, 0, WGPU_WHOLE_SIZE);
    wgpuRenderPassEncoderSetIndexBuffer(pass, terrainIbo_, WGPUIndexFormat_Uint32, 0, WGPU_WHOLE_SIZE);
    wgpuRenderPassEncoderDrawIndexed(pass, terrainIndexCount_, 1, 0, 0, 0);

    if (roadIndexCount_ > 0) {
      wgpuRenderPassEncoderSetVertexBuffer(pass, 0, roadVbo_, 0, WGPU_WHOLE_SIZE);
      wgpuRenderPassEncoderSetIndexBuffer(pass, roadIbo_, WGPUIndexFormat_Uint32, 0, WGPU_WHOLE_SIZE);
      wgpuRenderPassEncoderDrawIndexed(pass, roadIndexCount_, 1, 0, 0, 0);
    }

    // 2. Streamed Custom World Meshes (RoadNetwork + Roundabouts + 5 Bridges + Landmarks + Safehouse + Compounds)
    if (customMeshPipeline_ && customMeshVbo_ && !visibleCustomSlices.empty()) {
      wgpuRenderPassEncoderSetPipeline(pass, customMeshPipeline_);
      wgpuRenderPassEncoderSetVertexBuffer(pass, 0, customMeshVbo_, 0, WGPU_WHOLE_SIZE);
      wgpuRenderPassEncoderSetIndexBuffer(pass, customMeshIbo_, WGPUIndexFormat_Uint32, 0, WGPU_WHOLE_SIZE);
      for (const auto& sl : visibleCustomSlices) {
        wgpuRenderPassEncoderDrawIndexed(pass, sl.indexCount, 1, sl.firstIndex, 0, 0);
      }
    }

    // 3. Multi-part PropBatcher Streetlights, Traffic Lights & Hydrants
    if (customInstancedPipeline_ && !customPropBatches_.empty()) {
      wgpuRenderPassEncoderSetPipeline(pass, customInstancedPipeline_);
      for (const auto& cb : customPropBatches_) {
        if (cb.visibleCount == 0) continue;
        wgpuRenderPassEncoderSetVertexBuffer(pass, 0, cb.vbo, 0, WGPU_WHOLE_SIZE);
        wgpuRenderPassEncoderSetVertexBuffer(pass, 1, cb.instVbo, 0, WGPU_WHOLE_SIZE);
        wgpuRenderPassEncoderSetIndexBuffer(pass, cb.ibo, WGPUIndexFormat_Uint32, 0, WGPU_WHOLE_SIZE);
        wgpuRenderPassEncoderDrawIndexed(pass, cb.indexCount, cb.visibleCount, 0, 0, 0);
      }
    }

    // 4. Streamed Procedural Architecture Boxes (Back-face culled: FacadeGrammar + CityBuildingKit + Compounds)
    if (!buildingStaging_.empty() && archBoxPipeline_) {
      wgpuRenderPassEncoderSetPipeline(pass, archBoxPipeline_);
      wgpuRenderPassEncoderSetBindGroup(pass, 2, defaultWhiteTex_.bindGroup, 0, nullptr);
      wgpuRenderPassEncoderSetVertexBuffer(pass, 0, unitBoxVbo_, 0, WGPU_WHOLE_SIZE);
      wgpuRenderPassEncoderSetVertexBuffer(pass, 1, buildingInstVbo_, 0, WGPU_WHOLE_SIZE);
      wgpuRenderPassEncoderSetIndexBuffer(pass, unitBoxIbo_, WGPUIndexFormat_Uint32, 0, WGPU_WHOLE_SIZE);
      wgpuRenderPassEncoderDrawIndexed(pass, unitBoxIndexCount_, static_cast<uint32_t>(buildingStaging_.size()), 0, 0, 0);
    }

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

    // 5. Textured PBR GLB Houses, Landmarks, Trees, Interiors, Vehicles & Dynamic Props
    wgpuRenderPassEncoderSetPipeline(pass, instancedPipeline_);
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
    for (const auto& db : dynGlbBatches_) {
      drawGlbBatch(db, db.instanceCount);
    }
    for (const auto& wb : weaponPartBatches_) {
      drawGlbBatch(wb, wb.instanceCount);
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
    for (const auto& va : vehicleAssets_) {
      const uint32_t cnt = static_cast<uint32_t>(va.chassisStaging.size());
      if (cnt == 0) continue;
      drawGlbBatch(va.chassis, cnt);
      for (const auto& w : va.wheels) {
        drawGlbBatch(w.batch, static_cast<uint32_t>(w.staging.size()));
      }
      if (va.hasMainRotor) drawGlbBatch(va.mainRotor, static_cast<uint32_t>(va.mainRotorStaging.size()));
      if (va.hasTailRotor) drawGlbBatch(va.tailRotor, static_cast<uint32_t>(va.tailRotorStaging.size()));
    }

    // 6. Skinned Textured Characters
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
          case SkinnedPartKind::VanguardSoldier: drawSkinFwd(vanguardSoldierGpu_); break;
          case SkinnedPartKind::Business: drawSkinFwd(businessGpu_); break;
          case SkinnedPartKind::Civilian: drawSkinFwd(civilianGpu_); break;
          case SkinnedPartKind::Police: drawSkinFwd(policeGpu_); break;
          case SkinnedPartKind::Security: drawSkinFwd(securityGpu_); break;
          case SkinnedPartKind::Military: drawSkinFwd(militaryGpu_); break;
          case SkinnedPartKind::Construction: drawSkinFwd(constructionGpu_); break;
          case SkinnedPartKind::Sports: drawSkinFwd(sportsGpu_); break;
          case SkinnedPartKind::DogHusky: drawSkinFwd(dogHuskyGpu_); break;
          case SkinnedPartKind::Deer: drawSkinFwd(deerGpu_); break;
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
    relBuf(b.shadowNearInstVbo);
    relBuf(b.shadowFarInstVbo);
    for (auto& bg : b.ownedBindGroups) {
      if (bg) wgpuBindGroupRelease(bg);
    }
    b.ownedBindGroups.clear();
    for (auto& t : b.ownedTextures) relTex(t);
    b.ownedTextures.clear();
    b.submeshes.clear();
    b.spatialItems.clear();
    b.indexCount = 0;
    b.instanceCount = 0;
  };
  auto relSkin = [&](SkinnedMeshGpu& m) {
    relBuf(m.vbo);
    relBuf(m.ibo);
    for (auto& bg : m.ownedBindGroups) {
      if (bg) wgpuBindGroupRelease(bg);
    }
    m.ownedBindGroups.clear();
    for (auto& t : m.ownedTextures) relTex(t);
    m.ownedTextures.clear();
    m.submeshes.clear();
  };

  relBuf(terrainVbo_);
  relBuf(terrainIbo_);
  relBuf(roadVbo_);
  relBuf(roadIbo_);
  relBuf(customMeshVbo_);
  relBuf(customMeshIbo_);
  relBuf(unitBoxVbo_);
  relBuf(unitBoxIbo_);
  relBuf(buildingInstVbo_);
  relBuf(shadowNearBoxInstVbo_);
  relBuf(shadowFarBoxInstVbo_);
  relBuf(fallbackPropInstVbo_);
  relBuf(markerInstVbo_);
  relBuf(dynPropInstVbo_);
  relBuf(frameUbo_);
  relBuf(postUbo_);
  for (auto& cb : customPropBatches_) {
    relBuf(cb.vbo);
    relBuf(cb.ibo);
    relBuf(cb.instVbo);
    relBuf(cb.shadowNearInstVbo);
  }
  customPropBatches_.clear();
  for (auto& s : skinSlots_) {
    relBuf(s.ubo);
    if (s.bindGroup) { wgpuBindGroupRelease(s.bindGroup); s.bindGroup = nullptr; }
  }
  for (auto& b : glbPropBatches_) relBatch(b);
  glbPropBatches_.clear();
  for (auto& hb : houseBatches_) relBatch(hb);
  for (auto& db : dynGlbBatches_) relBatch(db);
  for (auto& wb : weaponPartBatches_) relBatch(wb);
  for (auto& bg : weaponMatBindGroups_) {
    if (bg) { wgpuBindGroupRelease(bg); bg = nullptr; }
  }
  for (auto& wt : weaponMatTextures_) relTex(wt);
  weaponMatTextures_.clear();
  for (auto& va : vehicleAssets_) {
    for (auto& w : va.wheels) relBatch(w.batch);
    va.wheels.clear();
    if (va.hasMainRotor) relBatch(va.mainRotor);
    if (va.hasTailRotor) relBatch(va.tailRotor);
    va.hasMainRotor = false;
    va.hasTailRotor = false;
    relBatch(va.chassis);
  }
  relSkin(playerBodyGpu_);
  relSkin(playerShortsGpu_);
  relSkin(playerHairGpu_);
  relSkin(vanguardSoldierGpu_);
  relSkin(businessGpu_);
  relSkin(civilianGpu_);
  relSkin(policeGpu_);
  relSkin(securityGpu_);
  relSkin(militaryGpu_);
  relSkin(constructionGpu_);
  relSkin(sportsGpu_);
  relSkin(dogHuskyGpu_);
  relSkin(deerGpu_);
  relTex(defaultWhiteTex_);
  relTex(defaultFlatNormalTex_);

  for (auto& lv : shadowLayerViews_) {
    if (lv) { wgpuTextureViewRelease(lv); lv = nullptr; }
  }
  if (shadowArrayView_) { wgpuTextureViewRelease(shadowArrayView_); shadowArrayView_ = nullptr; }
  if (shadowTex_) { wgpuTextureRelease(shadowTex_); shadowTex_ = nullptr; }
  if (shadowSampler_) { wgpuSamplerRelease(shadowSampler_); shadowSampler_ = nullptr; }
  if (repeatSampler_) { wgpuSamplerRelease(repeatSampler_); repeatSampler_ = nullptr; }
  if (linearSampler_) { wgpuSamplerRelease(linearSampler_); linearSampler_ = nullptr; }

  auto relPipe = [](WGPURenderPipeline& p) {
    if (p) { wgpuRenderPipelineRelease(p); p = nullptr; }
  };
  relPipe(shadowTerrainNearPipeline_);
  relPipe(shadowTerrainFarPipeline_);
  relPipe(shadowCustomNearPipeline_);
  relPipe(shadowCustomFarPipeline_);
  relPipe(shadowCustomInstNearPipeline_);
  relPipe(shadowCustomInstFarPipeline_);
  relPipe(shadowInstancedNearPipeline_);
  relPipe(shadowInstancedFarPipeline_);
  relPipe(shadowSkinnedNearPipeline_);
  relPipe(shadowSkinnedFarPipeline_);
  relPipe(skyPipeline_);
  relPipe(terrainPipeline_);
  relPipe(customMeshPipeline_);
  relPipe(customInstancedPipeline_);
  relPipe(archBoxPipeline_);
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
