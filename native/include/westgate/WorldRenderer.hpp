#pragma once

#include "CharacterAnimator.hpp"
#include "GltfAssetLoader.hpp"
#include "WgpuContext.hpp"
#include "WorldData.hpp"
#include <array>
#include <cstdint>
#include <glm/glm.hpp>
#include <string>
#include <vector>

namespace westgate {

struct RendererTelemetry {
  uint32_t visibleChunks = 0;
  uint32_t nearChunks = 0;
  uint32_t lodChunks = 0;
  uint32_t drawnBuildings = 0;
  uint32_t drawnProps = 0;
  uint32_t drawnVehicles = 0;
  uint32_t terrainTriangles = 0;
  uint32_t glbPropTypesLoaded = 0;
};

struct alignas(16) InstanceAttrib {
  float px, py, pz;
  float sx, sy, sz;
  float rotY;
  float r, g, b;
};

enum class SkinnedPartKind : uint8_t {
  PlayerBody = 0,
  PlayerShorts = 1,
  PlayerHair = 2,
  Opponent = 3,
};

struct SkinnedRenderCharacter {
  glm::vec3 position{0.0f};
  float yawRad = 0.0f;
  glm::vec4 tint{1.0f};
  SkinnedPartKind part = SkinnedPartKind::PlayerBody;
  const std::array<glm::mat4, kMaxSkinBones>* palette = nullptr;
};

struct WorldRenderAssets {
  std::string assetsRoot;
  const GltfModel* playerBody = nullptr;
  const GltfModel* playerShorts = nullptr;
  const GltfModel* playerHair = nullptr;
  const GltfModel* opponentModel = nullptr;
};

class WorldRenderer {
 public:
  bool init(
    WgpuContext& ctx,
    const WorldData& world,
    const std::string& shaderPath,
    const WorldRenderAssets& assets,
    std::string* err = nullptr
  );

  void render(
    WgpuContext& ctx,
    const WorldData& world,
    ChunkStreamer& streamer,
    const glm::vec3& camPos,
    const glm::vec3& camTarget,
    const glm::vec3& focusPos,
    float timeSec,
    const std::vector<SkinnedRenderCharacter>& characters,
    const std::vector<InstanceAttrib>& policeVehicles,
    const std::vector<InstanceAttrib>& taxiVehicles,
    bool drawUiCallback = true
  );

  void shutdown();

  const RendererTelemetry& telemetry() const { return telemetry_; }

 private:
  struct StaticVertex {
    float px, py, pz;
    float nx, ny, nz;
    float r, g, b;
    float u, v, kind; // kind: 0=terrain, 1=ocean, 2=road, 3=arena
  };

  struct ModelVertex {
    float px, py, pz;
    float nx, ny, nz;
    float u, v;
    float r, g, b;
  };

  struct SkinnedVertex {
    float px, py, pz;
    float nx, ny, nz;
    float u, v;
    float r, g, b;
    uint32_t j0, j1, j2, j3;
    float w0, w1, w2, w3;
  };

  struct alignas(16) FrameUniforms {
    glm::mat4 viewProj;
    glm::mat4 lightViewProj;
    glm::vec4 camPos;   // xyz = camPos, w = timeSec
    glm::vec4 sunDir;
    glm::vec4 sunColor;
    glm::vec4 fogColor;
  };

  struct alignas(16) SkinUniforms {
    glm::mat4 model;
    glm::vec4 tint;
    std::array<glm::mat4, kMaxSkinBones> bones;
  };

  struct GpuTextureBinding {
    WGPUTexture texture = nullptr;
    WGPUTextureView view = nullptr;
    WGPUBindGroup bindGroup = nullptr;
  };

  struct InstancedGlbBatch {
    WGPUBuffer vbo = nullptr;
    WGPUBuffer ibo = nullptr;
    WGPUBuffer instVbo = nullptr;
    uint32_t indexCount = 0;
    uint32_t instanceCount = 0;
    uint32_t maxInstances = 0;
  };

  struct SkinnedSubmesh {
    uint32_t indexOffset = 0;
    uint32_t indexCount = 0;
    WGPUBindGroup texBindGroup = nullptr;
  };

  struct SkinnedMeshGpu {
    WGPUBuffer vbo = nullptr;
    WGPUBuffer ibo = nullptr;
    std::vector<SkinnedSubmesh> submeshes;
    std::vector<GpuTextureBinding> ownedTextures;
  };

  struct SkinSlotGpu {
    WGPUBuffer ubo = nullptr;
    WGPUBindGroup bindGroup = nullptr;
  };

  static constexpr uint32_t kShadowMapSize = 2048;
  static constexpr uint32_t kMaxSkinSlots = 12;

  void buildTerrainAndOceanBuffers(WgpuContext& ctx, const WorldData& world);
  void buildRoadAndArenaBuffers(WgpuContext& ctx, const WorldData& world);
  void buildPropAndVehicleBatches(WgpuContext& ctx, const WorldData& world, const std::string& assetsRoot);
  void buildSkinnedMesh(WgpuContext& ctx, const GltfModel& model, SkinnedMeshGpu& outMesh);
  GpuTextureBinding createRgbaTexture(WgpuContext& ctx, uint32_t w, uint32_t h, const uint8_t* rgba8);
  bool loadGlbBatch(WgpuContext& ctx, const std::string& path, const std::vector<InstanceAttrib>& instances, InstancedGlbBatch& outBatch);

  WGPUShaderModule shader_ = nullptr;
  WGPUBindGroupLayout frameBgl_ = nullptr;
  WGPUBindGroupLayout skinBgl_ = nullptr;
  WGPUBindGroupLayout matBgl_ = nullptr;
  WGPUBindGroupLayout shadowReadBgl_ = nullptr;
  WGPUBindGroup frameBg_ = nullptr;
  WGPUBindGroup shadowReadBg_ = nullptr;

  WGPUPipelineLayout shadowStaticPipeLayout_ = nullptr;
  WGPUPipelineLayout shadowSkinnedPipeLayout_ = nullptr;
  WGPUPipelineLayout scenePipeLayout_ = nullptr;

  WGPURenderPipeline shadowTerrainPipeline_ = nullptr;
  WGPURenderPipeline shadowInstancedPipeline_ = nullptr;
  WGPURenderPipeline shadowSkinnedPipeline_ = nullptr;
  WGPURenderPipeline terrainPipeline_ = nullptr;
  WGPURenderPipeline instancedPipeline_ = nullptr;
  WGPURenderPipeline skinnedPipeline_ = nullptr;

  // Shadow map resources
  WGPUTexture shadowTex_ = nullptr;
  WGPUTextureView shadowView_ = nullptr;
  WGPUSampler shadowSampler_ = nullptr;
  WGPUSampler linearSampler_ = nullptr;
  GpuTextureBinding defaultWhiteTex_{};

  WGPUBuffer frameUbo_ = nullptr;
  std::array<SkinSlotGpu, kMaxSkinSlots> skinSlots_{};

  WGPUBuffer terrainVbo_ = nullptr;
  WGPUBuffer terrainIbo_ = nullptr;
  uint32_t terrainIndexCount_ = 0;

  WGPUBuffer roadVbo_ = nullptr;
  WGPUBuffer roadIbo_ = nullptr;
  uint32_t roadIndexCount_ = 0;

  WGPUBuffer unitBoxVbo_ = nullptr;
  WGPUBuffer unitBoxIbo_ = nullptr;
  uint32_t unitBoxIndexCount_ = 0;

  WGPUBuffer buildingInstVbo_ = nullptr;
  uint32_t maxBuildingInstances_ = 0;
  std::vector<InstanceAttrib> buildingStaging_;

  WGPUBuffer fallbackPropInstVbo_ = nullptr;
  uint32_t fallbackPropCount_ = 0;

  std::vector<InstancedGlbBatch> glbPropBatches_;
  InstancedGlbBatch policeBatch_{};
  InstancedGlbBatch taxiBatch_{};

  SkinnedMeshGpu playerBodyGpu_{};
  SkinnedMeshGpu playerShortsGpu_{};
  SkinnedMeshGpu playerHairGpu_{};
  SkinnedMeshGpu opponentGpu_{};

  RendererTelemetry telemetry_{};
};

} // namespace westgate
