#include "westgate/WorldRenderer.hpp"
#include "imgui.h"
#include "imgui_impl_wgpu.h"
#include <algorithm>
#include <cmath>
#include <cstring>
#include <fstream>
#include <glm/gtc/matrix_transform.hpp>
#include <sstream>

namespace westgate {

namespace {

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

} // namespace

bool WorldRenderer::init(
  WgpuContext& ctx,
  const WorldData& world,
  const std::string& shaderPath,
  const GltfModel* playerModel,
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

  frameUbo_ = createBufferWithData(ctx.device(), ctx.queue(), WGPUBufferUsage_Uniform, nullptr, sizeof(FrameUniforms));

  WGPUBindGroupLayoutEntry bglEntry = WGPU_BIND_GROUP_LAYOUT_ENTRY_INIT;
  bglEntry.binding = 0;
  bglEntry.visibility = WGPUShaderStage_Vertex | WGPUShaderStage_Fragment;
  bglEntry.buffer.type = WGPUBufferBindingType_Uniform;
  bglEntry.buffer.minBindingSize = sizeof(FrameUniforms);

  WGPUBindGroupLayoutDescriptor bglDesc = WGPU_BIND_GROUP_LAYOUT_DESCRIPTOR_INIT;
  bglDesc.entryCount = 1;
  bglDesc.entries = &bglEntry;
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

  WGPUPipelineLayoutDescriptor plDesc = WGPU_PIPELINE_LAYOUT_DESCRIPTOR_INIT;
  plDesc.bindGroupLayoutCount = 1;
  plDesc.bindGroupLayouts = &frameBgl_;
  pipeLayout_ = wgpuDeviceCreatePipelineLayout(ctx.device(), &plDesc);

  WGPUColorTargetState colorTarget = WGPU_COLOR_TARGET_STATE_INIT;
  colorTarget.format = ctx.surfaceFormat();
  colorTarget.writeMask = WGPUColorWriteMask_All;

  WGPUFragmentState fragState = WGPU_FRAGMENT_STATE_INIT;
  fragState.module = shader_;
  fragState.entryPoint = {"fsMain", 6};
  fragState.targetCount = 1;
  fragState.targets = &colorTarget;

  WGPUDepthStencilState depthState = WGPU_DEPTH_STENCIL_STATE_INIT;
  depthState.format = ctx.depthFormat();
  depthState.depthWriteEnabled = WGPUOptionalBool_True;
  depthState.depthCompare = WGPUCompareFunction_Less;

  // 1. Terrain & Road pipeline
  {
    WGPUVertexAttribute attrs[3]{};
    attrs[0].format = WGPUVertexFormat_Float32x3;
    attrs[0].offset = offsetof(StaticVertex, px);
    attrs[0].shaderLocation = 0;
    attrs[1].format = WGPUVertexFormat_Float32x3;
    attrs[1].offset = offsetof(StaticVertex, nx);
    attrs[1].shaderLocation = 1;
    attrs[2].format = WGPUVertexFormat_Float32x3;
    attrs[2].offset = offsetof(StaticVertex, r);
    attrs[2].shaderLocation = 2;

    WGPUVertexBufferLayout vbl = WGPU_VERTEX_BUFFER_LAYOUT_INIT;
    vbl.stepMode = WGPUVertexStepMode_Vertex;
    vbl.arrayStride = sizeof(StaticVertex);
    vbl.attributeCount = 3;
    vbl.attributes = attrs;

    WGPURenderPipelineDescriptor rp = WGPU_RENDER_PIPELINE_DESCRIPTOR_INIT;
    rp.layout = pipeLayout_;
    rp.vertex.module = shader_;
    rp.vertex.entryPoint = {"vsTerrain", 9};
    rp.vertex.bufferCount = 1;
    rp.vertex.buffers = &vbl;
    rp.fragment = &fragState;
    rp.depthStencil = &depthState;
    rp.primitive.topology = WGPUPrimitiveTopology_TriangleList;
    rp.primitive.cullMode = WGPUCullMode_Back;
    rp.primitive.frontFace = WGPUFrontFace_CCW;
    rp.multisample.count = 1;
    rp.multisample.mask = 0xFFFFFFFFu;
    terrainPipeline_ = wgpuDeviceCreateRenderPipeline(ctx.device(), &rp);
  }

  // 2. Instanced Buildings / Props / Character pipeline
  {
    WGPUVertexAttribute vAttrs[2]{};
    vAttrs[0].format = WGPUVertexFormat_Float32x3;
    vAttrs[0].offset = offsetof(UnitBoxVertex, px);
    vAttrs[0].shaderLocation = 0;
    vAttrs[1].format = WGPUVertexFormat_Float32x3;
    vAttrs[1].offset = offsetof(UnitBoxVertex, nx);
    vAttrs[1].shaderLocation = 1;

    WGPUVertexAttribute iAttrs[4]{};
    iAttrs[0].format = WGPUVertexFormat_Float32x3;
    iAttrs[0].offset = offsetof(InstanceAttrib, px);
    iAttrs[0].shaderLocation = 2;
    iAttrs[1].format = WGPUVertexFormat_Float32x3;
    iAttrs[1].offset = offsetof(InstanceAttrib, sx);
    iAttrs[1].shaderLocation = 3;
    iAttrs[2].format = WGPUVertexFormat_Float32;
    iAttrs[2].offset = offsetof(InstanceAttrib, rotY);
    iAttrs[2].shaderLocation = 4;
    iAttrs[3].format = WGPUVertexFormat_Float32x3;
    iAttrs[3].offset = offsetof(InstanceAttrib, r);
    iAttrs[3].shaderLocation = 5;

    WGPUVertexBufferLayout vbls[2]{};
    vbls[0] = WGPU_VERTEX_BUFFER_LAYOUT_INIT;
    vbls[0].stepMode = WGPUVertexStepMode_Vertex;
    vbls[0].arrayStride = sizeof(UnitBoxVertex);
    vbls[0].attributeCount = 2;
    vbls[0].attributes = vAttrs;

    vbls[1] = WGPU_VERTEX_BUFFER_LAYOUT_INIT;
    vbls[1].stepMode = WGPUVertexStepMode_Instance;
    vbls[1].arrayStride = sizeof(InstanceAttrib);
    vbls[1].attributeCount = 4;
    vbls[1].attributes = iAttrs;

    WGPURenderPipelineDescriptor rp = WGPU_RENDER_PIPELINE_DESCRIPTOR_INIT;
    rp.layout = pipeLayout_;
    rp.vertex.module = shader_;
    rp.vertex.entryPoint = {"vsInstanced", 11};
    rp.vertex.bufferCount = 2;
    rp.vertex.buffers = vbls;
    rp.fragment = &fragState;
    rp.depthStencil = &depthState;
    rp.primitive.topology = WGPUPrimitiveTopology_TriangleList;
    rp.primitive.cullMode = WGPUCullMode_Back;
    rp.primitive.frontFace = WGPUFrontFace_CCW;
    rp.multisample.count = 1;
    rp.multisample.mask = 0xFFFFFFFFu;
    instancedPipeline_ = wgpuDeviceCreateRenderPipeline(ctx.device(), &rp);
  }

  buildTerrainAndOceanBuffers(ctx, world);
  buildRoadBuffers(ctx, world);
  buildUnitBoxAndProps(ctx, world, playerModel);
  return terrainPipeline_ != nullptr && instancedPipeline_ != nullptr;
}

void WorldRenderer::buildTerrainAndOceanBuffers(WgpuContext& ctx, const WorldData& world) {
  constexpr uint32_t N = 240;
  std::vector<StaticVertex> verts;
  std::vector<uint32_t> indices;
  verts.reserve(N * N + 4);
  indices.reserve((N - 1) * (N - 1) * 6 + 6);

  for (uint32_t iz = 0; iz < N; ++iz) {
    const float tz = static_cast<float>(iz) / static_cast<float>(N - 1);
    const float z = world.worldMin + tz * (world.worldMax - world.worldMin);
    for (uint32_t ix = 0; ix < N; ++ix) {
      const float tx = static_cast<float>(ix) / static_cast<float>(N - 1);
      const float x = world.worldMin + tx * (world.worldMax - world.worldMin);
      const float y = world.heightfield.sampleHeight(x, z);
      const glm::vec3 n = world.heightfield.sampleNormal(x, z);

      glm::vec3 col(0.24f, 0.34f, 0.21f);
      if (y < 0.8f) col = glm::vec3(0.68f, 0.62f, 0.48f);
      else if (n.y < 0.78f || y > 38.0f) col = glm::vec3(0.42f, 0.41f, 0.39f);
      else if (x > -420.0f && x < 340.0f && z > -420.0f && z < 480.0f) col = glm::vec3(0.32f, 0.34f, 0.36f);

      verts.push_back(StaticVertex{x, y, z, n.x, n.y, n.z, col.r, col.g, col.b});
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

  // Ocean water plane at y = 0
  const uint32_t wBase = static_cast<uint32_t>(verts.size());
  const float wExt = 1800.0f;
  verts.push_back(StaticVertex{-wExt, 0.0f, -wExt, 0.0f, 1.0f, 0.0f, 0.06f, 0.22f, 0.34f});
  verts.push_back(StaticVertex{wExt, 0.0f, -wExt, 0.0f, 1.0f, 0.0f, 0.06f, 0.22f, 0.34f});
  verts.push_back(StaticVertex{-wExt, 0.0f, wExt, 0.0f, 1.0f, 0.0f, 0.06f, 0.22f, 0.34f});
  verts.push_back(StaticVertex{wExt, 0.0f, wExt, 0.0f, 1.0f, 0.0f, 0.06f, 0.22f, 0.34f});
  indices.push_back(wBase + 0);
  indices.push_back(wBase + 2);
  indices.push_back(wBase + 1);
  indices.push_back(wBase + 1);
  indices.push_back(wBase + 2);
  indices.push_back(wBase + 3);

  terrainIndexCount_ = static_cast<uint32_t>(indices.size());
  telemetry_.terrainTriangles = terrainIndexCount_ / 3;
  terrainVbo_ = createBufferWithData(ctx.device(), ctx.queue(), WGPUBufferUsage_Vertex, verts.data(), verts.size() * sizeof(StaticVertex));
  terrainIbo_ = createBufferWithData(ctx.device(), ctx.queue(), WGPUBufferUsage_Index, indices.data(), indices.size() * sizeof(uint32_t));
}

void WorldRenderer::buildRoadBuffers(WgpuContext& ctx, const WorldData& world) {
  std::vector<StaticVertex> verts;
  std::vector<uint32_t> indices;

  for (const auto& seg : world.roads) {
    if (seg.samples.size() < 2) continue;
    const float hw = seg.width * 0.5f;
    const uint32_t base = static_cast<uint32_t>(verts.size());
    const glm::vec3 col = seg.isBridge ? glm::vec3(0.24f, 0.26f, 0.29f) : glm::vec3(0.14f, 0.15f, 0.17f);

    for (size_t i = 0; i < seg.samples.size(); ++i) {
      const auto& sp = seg.samples[i];
      const glm::vec3 left = sp.pos - glm::vec3(sp.rx * hw, 0.0f, sp.rz * hw);
      const glm::vec3 right = sp.pos + glm::vec3(sp.rx * hw, 0.0f, sp.rz * hw);
      verts.push_back(StaticVertex{left.x, left.y + 0.05f, left.z, 0.0f, 1.0f, 0.0f, col.r, col.g, col.b});
      verts.push_back(StaticVertex{right.x, right.y + 0.05f, right.z, 0.0f, 1.0f, 0.0f, col.r, col.g, col.b});
      if (i > 0) {
        const uint32_t r0 = base + static_cast<uint32_t>((i - 1) * 2);
        const uint32_t r1 = base + static_cast<uint32_t>(i * 2);
        // Right vector (rx, rz) = (-tz, tx) is left-normal in XZ, so (r0, r0+1, r1) is CCW facing +Y
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

void WorldRenderer::buildUnitBoxAndProps(WgpuContext& ctx, const WorldData& world, const GltfModel* playerModel) {
  // Unit 1x1x1 cube centered at origin with outward face normals (CCW)
  const UnitBoxVertex boxVerts[24] = {
    // +Z
    {-0.5f, -0.5f,  0.5f, 0, 0, 1}, { 0.5f, -0.5f,  0.5f, 0, 0, 1}, { 0.5f,  0.5f,  0.5f, 0, 0, 1}, {-0.5f,  0.5f,  0.5f, 0, 0, 1},
    // -Z
    { 0.5f, -0.5f, -0.5f, 0, 0, -1}, {-0.5f, -0.5f, -0.5f, 0, 0, -1}, {-0.5f,  0.5f, -0.5f, 0, 0, -1}, { 0.5f,  0.5f, -0.5f, 0, 0, -1},
    // +X
    { 0.5f, -0.5f,  0.5f, 1, 0, 0}, { 0.5f, -0.5f, -0.5f, 1, 0, 0}, { 0.5f,  0.5f, -0.5f, 1, 0, 0}, { 0.5f,  0.5f,  0.5f, 1, 0, 0},
    // -X
    {-0.5f, -0.5f, -0.5f, -1, 0, 0}, {-0.5f, -0.5f,  0.5f, -1, 0, 0}, {-0.5f,  0.5f,  0.5f, -1, 0, 0}, {-0.5f,  0.5f, -0.5f, -1, 0, 0},
    // +Y
    {-0.5f,  0.5f,  0.5f, 0, 1, 0}, { 0.5f,  0.5f,  0.5f, 0, 1, 0}, { 0.5f,  0.5f, -0.5f, 0, 1, 0}, {-0.5f,  0.5f, -0.5f, 0, 1, 0},
    // -Y
    {-0.5f, -0.5f, -0.5f, 0, -1, 0}, { 0.5f, -0.5f, -0.5f, 0, -1, 0}, { 0.5f, -0.5f,  0.5f, 0, -1, 0}, {-0.5f, -0.5f,  0.5f, 0, -1, 0},
  };
  const uint32_t boxIdx[36] = {
     0,  1,  2,  0,  2,  3,
     4,  5,  6,  4,  6,  7,
     8,  9, 10,  8, 10, 11,
    12, 13, 14, 12, 14, 15,
    16, 17, 18, 16, 18, 19,
    20, 21, 22, 20, 22, 23,
  };
  unitBoxIndexCount_ = 36;
  unitBoxVbo_ = createBufferWithData(ctx.device(), ctx.queue(), WGPUBufferUsage_Vertex, boxVerts, sizeof(boxVerts));
  unitBoxIbo_ = createBufferWithData(ctx.device(), ctx.queue(), WGPUBufferUsage_Index, boxIdx, sizeof(boxIdx));

  // Dynamic building instance buffer sized for all world buildings
  size_t totalB = 0;
  for (const auto& c : world.chunks) totalB += c.buildings.size();
  maxBuildingInstances_ = static_cast<uint32_t>(std::max<size_t>(64, totalB));
  buildingInstVbo_ = createBufferWithData(ctx.device(), ctx.queue(), WGPUBufferUsage_Vertex, nullptr, maxBuildingInstances_ * sizeof(InstanceAttrib));
  buildingStaging_.reserve(maxBuildingInstances_);

  // Static instanced city props (trees, poles, hydrants)
  std::vector<InstanceAttrib> propInst;
  propInst.reserve(world.props.size());
  for (const auto& p : world.props) {
    InstanceAttrib a{};
    a.rotY = p.ry;
    if (p.proto == "palm_tree" || p.proto == "oak_tree" || p.proto == "pine_tree") {
      const float h = (p.proto == "palm_tree" ? 8.5f : 6.2f) * p.scale;
      a.px = p.pos.x;
      a.py = p.pos.y + h * 0.5f;
      a.pz = p.pos.z;
      a.sx = 1.6f * p.scale;
      a.sy = h;
      a.sz = 1.6f * p.scale;
      a.r = 0.22f;
      a.g = 0.48f;
      a.b = 0.20f;
    } else if (p.proto == "streetlight") {
      a.px = p.pos.x;
      a.py = p.pos.y + 3.8f;
      a.pz = p.pos.z;
      a.sx = 0.28f;
      a.sy = 7.6f;
      a.sz = 0.28f;
      a.r = 0.35f;
      a.g = 0.38f;
      a.b = 0.42f;
    } else {
      a.px = p.pos.x;
      a.py = p.pos.y + 0.6f;
      a.pz = p.pos.z;
      a.sx = 0.7f * p.scale;
      a.sy = 1.2f * p.scale;
      a.sz = 0.7f * p.scale;
      a.r = 0.55f;
      a.g = 0.52f;
      a.b = 0.46f;
    }
    propInst.push_back(a);
  }
  propInstanceCount_ = static_cast<uint32_t>(propInst.size());
  if (propInstanceCount_ > 0) {
    propInstVbo_ = createBufferWithData(ctx.device(), ctx.queue(), WGPUBufferUsage_Vertex, propInst.data(), propInst.size() * sizeof(InstanceAttrib));
  }

  // Player glTF mesh (or capsule-box fallback if GLB omitted)
  if (playerModel && !playerModel->primitives.empty()) {
    std::vector<UnitBoxVertex> pVerts;
    std::vector<uint32_t> pIdx;
    for (const auto& prim : playerModel->primitives) {
      const uint32_t base = static_cast<uint32_t>(pVerts.size());
      for (const auto& v : prim.vertices) {
        pVerts.push_back(UnitBoxVertex{v.position.x, v.position.y, v.position.z, v.normal.x, v.normal.y, v.normal.z});
      }
      for (uint32_t idx : prim.indices) {
        pIdx.push_back(base + idx);
      }
    }
    playerIndexCount_ = static_cast<uint32_t>(pIdx.size());
    playerVbo_ = createBufferWithData(ctx.device(), ctx.queue(), WGPUBufferUsage_Vertex, pVerts.data(), pVerts.size() * sizeof(UnitBoxVertex));
    playerIbo_ = createBufferWithData(ctx.device(), ctx.queue(), WGPUBufferUsage_Index, pIdx.data(), pIdx.size() * sizeof(uint32_t));
  }
  playerInstVbo_ = createBufferWithData(ctx.device(), ctx.queue(), WGPUBufferUsage_Vertex, nullptr, sizeof(InstanceAttrib));
}

void WorldRenderer::render(
  WgpuContext& ctx,
  const WorldData& world,
  ChunkStreamer& streamer,
  const glm::vec3& camPos,
  const glm::vec3& camTarget,
  const glm::vec3& playerPos,
  float playerYawRad,
  bool drawUiCallback
) {
  const float aspect = static_cast<float>(ctx.width()) / static_cast<float>(std::max(1u, ctx.height()));
  const glm::mat4 proj = glm::perspectiveZO(glm::radians(60.0f), aspect, 0.25f, 2800.0f);
  const glm::mat4 view = glm::lookAt(camPos, camTarget, glm::vec3(0.0f, 1.0f, 0.0f));
  const glm::mat4 vp = proj * view;

  const Frustum frustum = Frustum::fromViewProj(vp);
  streamer.update(playerPos, frustum);

  // Gather frustum-visible streamed buildings into one contiguous GPU instance batch
  buildingStaging_.clear();
  for (const auto& v : streamer.views()) {
    if (!v.visibleInFrustum) continue;
    const auto& ch = world.chunks[v.chunkIndex];
    for (const auto& b : ch.buildings) {
      if (v.state == ChunkLodState::Lod && b.size.y < 8.0f) continue;
      if (buildingStaging_.size() >= maxBuildingInstances_) break;
      buildingStaging_.push_back(InstanceAttrib{
        b.center.x, b.center.y, b.center.z,
        b.size.x, b.size.y, b.size.z,
        0.0f,
        b.color.r, b.color.g, b.color.b
      });
    }
  }
  if (!buildingStaging_.empty()) {
    wgpuQueueWriteBuffer(ctx.queue(), buildingInstVbo_, 0, buildingStaging_.data(), buildingStaging_.size() * sizeof(InstanceAttrib));
  }

  // Player instance transform
  InstanceAttrib playerInst{};
  if (playerIndexCount_ > 0) {
    playerInst = {playerPos.x, playerPos.y, playerPos.z, 1.0f, 1.0f, 1.0f, playerYawRad, 0.78f, 0.62f, 0.52f};
  } else {
    playerInst = {playerPos.x, playerPos.y + 0.9f, playerPos.z, 0.65f, 1.8f, 0.45f, playerYawRad, 0.85f, 0.68f, 0.24f};
  }
  wgpuQueueWriteBuffer(ctx.queue(), playerInstVbo_, 0, &playerInst, sizeof(playerInst));

  FrameUniforms ubo{};
  ubo.viewProj = vp;
  ubo.camPos = glm::vec4(camPos, 1.0f);
  ubo.sunDir = glm::vec4(glm::normalize(glm::vec3(0.55f, 0.72f, 0.42f)), 0.0f);
  ubo.sunColor = glm::vec4(1.35f, 1.24f, 1.08f, 1.0f);
  ubo.fogColor = glm::vec4(0.65f, 0.78f, 0.90f, 1.0f);
  wgpuQueueWriteBuffer(ctx.queue(), frameUbo_, 0, &ubo, sizeof(ubo));

  telemetry_.visibleChunks = streamer.visibleCount();
  telemetry_.nearChunks = streamer.nearCount();
  telemetry_.lodChunks = streamer.lodCount();
  telemetry_.drawnBuildings = static_cast<uint32_t>(buildingStaging_.size());
  telemetry_.drawnProps = propInstanceCount_;

  WGPUSurfaceTexture surfTex{};
  wgpuSurfaceGetCurrentTexture(ctx.surface(), &surfTex);
  if (ImGui_ImplWGPU_IsSurfaceStatusError(surfTex.status)) {
    if (surfTex.texture) wgpuTextureRelease(surfTex.texture);
    ctx.reconfigureSurface();
    return;
  }
  if (ImGui_ImplWGPU_IsSurfaceStatusSubOptimal(surfTex.status)) {
    if (surfTex.texture) wgpuTextureRelease(surfTex.texture);
    ctx.reconfigureSurface();
    return;
  }

  WGPUTextureViewDescriptor tvd = WGPU_TEXTURE_VIEW_DESCRIPTOR_INIT;
  tvd.format = ctx.surfaceFormat();
  tvd.dimension = WGPUTextureViewDimension_2D;
  tvd.mipLevelCount = 1;
  tvd.arrayLayerCount = 1;
  tvd.aspect = WGPUTextureAspect_All;
  WGPUTextureView backView = wgpuTextureCreateView(surfTex.texture, &tvd);

  WGPUCommandEncoderDescriptor encDesc = {};
  WGPUCommandEncoder enc = wgpuDeviceCreateCommandEncoder(ctx.device(), &encDesc);

  WGPURenderPassColorAttachment colorAtt = WGPU_RENDER_PASS_COLOR_ATTACHMENT_INIT;
  colorAtt.view = backView;
  colorAtt.depthSlice = WGPU_DEPTH_SLICE_UNDEFINED;
  colorAtt.loadOp = WGPULoadOp_Clear;
  colorAtt.storeOp = WGPUStoreOp_Store;
  colorAtt.clearValue = {0.42, 0.65, 0.85, 1.0};

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

  // 1. Terrain + Ocean
  wgpuRenderPassEncoderSetPipeline(pass, terrainPipeline_);
  wgpuRenderPassEncoderSetBindGroup(pass, 0, frameBg_, 0, nullptr);
  wgpuRenderPassEncoderSetVertexBuffer(pass, 0, terrainVbo_, 0, WGPU_WHOLE_SIZE);
  wgpuRenderPassEncoderSetIndexBuffer(pass, terrainIbo_, WGPUIndexFormat_Uint32, 0, WGPU_WHOLE_SIZE);
  wgpuRenderPassEncoderDrawIndexed(pass, terrainIndexCount_, 1, 0, 0, 0);

  // 2. Road ribbons
  if (roadIndexCount_ > 0) {
    wgpuRenderPassEncoderSetVertexBuffer(pass, 0, roadVbo_, 0, WGPU_WHOLE_SIZE);
    wgpuRenderPassEncoderSetIndexBuffer(pass, roadIbo_, WGPUIndexFormat_Uint32, 0, WGPU_WHOLE_SIZE);
    wgpuRenderPassEncoderDrawIndexed(pass, roadIndexCount_, 1, 0, 0, 0);
  }

  // 3. Instanced Buildings + Props + Player GLB
  wgpuRenderPassEncoderSetPipeline(pass, instancedPipeline_);
  wgpuRenderPassEncoderSetBindGroup(pass, 0, frameBg_, 0, nullptr);
  if (!buildingStaging_.empty()) {
    wgpuRenderPassEncoderSetVertexBuffer(pass, 0, unitBoxVbo_, 0, WGPU_WHOLE_SIZE);
    wgpuRenderPassEncoderSetVertexBuffer(pass, 1, buildingInstVbo_, 0, WGPU_WHOLE_SIZE);
    wgpuRenderPassEncoderSetIndexBuffer(pass, unitBoxIbo_, WGPUIndexFormat_Uint32, 0, WGPU_WHOLE_SIZE);
    wgpuRenderPassEncoderDrawIndexed(pass, unitBoxIndexCount_, static_cast<uint32_t>(buildingStaging_.size()), 0, 0, 0);
  }
  if (propInstanceCount_ > 0) {
    wgpuRenderPassEncoderSetVertexBuffer(pass, 0, unitBoxVbo_, 0, WGPU_WHOLE_SIZE);
    wgpuRenderPassEncoderSetVertexBuffer(pass, 1, propInstVbo_, 0, WGPU_WHOLE_SIZE);
    wgpuRenderPassEncoderSetIndexBuffer(pass, unitBoxIbo_, WGPUIndexFormat_Uint32, 0, WGPU_WHOLE_SIZE);
    wgpuRenderPassEncoderDrawIndexed(pass, unitBoxIndexCount_, propInstanceCount_, 0, 0, 0);
  }
  if (playerIndexCount_ > 0) {
    wgpuRenderPassEncoderSetVertexBuffer(pass, 0, playerVbo_, 0, WGPU_WHOLE_SIZE);
    wgpuRenderPassEncoderSetVertexBuffer(pass, 1, playerInstVbo_, 0, WGPU_WHOLE_SIZE);
    wgpuRenderPassEncoderSetIndexBuffer(pass, playerIbo_, WGPUIndexFormat_Uint32, 0, WGPU_WHOLE_SIZE);
    wgpuRenderPassEncoderDrawIndexed(pass, playerIndexCount_, 1, 0, 0, 0);
  } else {
    wgpuRenderPassEncoderSetVertexBuffer(pass, 0, unitBoxVbo_, 0, WGPU_WHOLE_SIZE);
    wgpuRenderPassEncoderSetVertexBuffer(pass, 1, playerInstVbo_, 0, WGPU_WHOLE_SIZE);
    wgpuRenderPassEncoderSetIndexBuffer(pass, unitBoxIbo_, WGPUIndexFormat_Uint32, 0, WGPU_WHOLE_SIZE);
    wgpuRenderPassEncoderDrawIndexed(pass, unitBoxIndexCount_, 1, 0, 0, 0);
  }
  wgpuRenderPassEncoderEnd(pass);
  wgpuRenderPassEncoderRelease(pass);

  // 4. Dear ImGui Native HUD Pass
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
  wgpuSurfacePresent(ctx.surface());

  wgpuCommandBufferRelease(cmd);
  wgpuCommandEncoderRelease(enc);
  wgpuTextureViewRelease(backView);
  wgpuTextureRelease(surfTex.texture);
}

void WorldRenderer::shutdown() {
  auto relBuf = [](WGPUBuffer& b) {
    if (b) {
      wgpuBufferRelease(b);
      b = nullptr;
    }
  };
  relBuf(terrainVbo_);
  relBuf(terrainIbo_);
  relBuf(roadVbo_);
  relBuf(roadIbo_);
  relBuf(unitBoxVbo_);
  relBuf(unitBoxIbo_);
  relBuf(buildingInstVbo_);
  relBuf(propInstVbo_);
  relBuf(playerVbo_);
  relBuf(playerIbo_);
  relBuf(playerInstVbo_);
  relBuf(frameUbo_);

  if (terrainPipeline_) { wgpuRenderPipelineRelease(terrainPipeline_); terrainPipeline_ = nullptr; }
  if (instancedPipeline_) { wgpuRenderPipelineRelease(instancedPipeline_); instancedPipeline_ = nullptr; }
  if (pipeLayout_) { wgpuPipelineLayoutRelease(pipeLayout_); pipeLayout_ = nullptr; }
  if (frameBg_) { wgpuBindGroupRelease(frameBg_); frameBg_ = nullptr; }
  if (frameBgl_) { wgpuBindGroupLayoutRelease(frameBgl_); frameBgl_ = nullptr; }
  if (shader_) { wgpuShaderModuleRelease(shader_); shader_ = nullptr; }
}

} // namespace westgate
