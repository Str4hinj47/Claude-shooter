#pragma once
#include "westgate/CharacterAnimator.hpp"
#include "westgate/EngineTypes.hpp"
#include "westgate/GameSession.hpp"
#include "westgate/GltfAssetLoader.hpp"
#include "westgate/PhysicsWorld.hpp"
#include "westgate/WgpuContext.hpp"
#include "westgate/WorldData.hpp"
#include <array>
#include <cstdint>
#include <glm/glm.hpp>
#include <string>
#include <vector>

namespace westgate {

constexpr size_t kMaxSkinSlots = 48;
constexpr size_t kMaxPointLights = 24;

struct RenderTelemetry {
  uint32_t visibleChunks = 0;
  uint32_t nearChunks = 0;
  uint32_t lodChunks = 0;
  uint32_t drawnBuildings = 0;
  uint32_t drawnProps = 0;
  uint32_t drawnVehicles = 0;
  uint32_t drawnCharacters = 0;
  uint32_t glbPropTypesLoaded = 0;
  uint32_t terrainTriangles = 0;
  uint32_t activePointLights = 0;
  uint32_t dynamicPhysicsProps = 0;
};

struct InstanceAttrib {
  float x, y, z;
  float sx, sy, sz;
  float qx, qy, qz, qw;
  float r, g, b, emissive;
};

enum class SkinnedPartKind : uint8_t {
  PlayerBody = 0,
  PlayerShorts = 1,
  PlayerHair = 2,
  Business = 3,
  Civilian = 4,
  Police = 5,
  Security = 6,
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
  const GltfModel* businessModel = nullptr;
  const GltfModel* civilianModel = nullptr;
  const GltfModel* policeModel = nullptr;
  const GltfModel* securityModel = nullptr;
};

class WorldRenderer {
public:
  bool init(
    WgpuContext& ctx,
    const WorldData& world,
    const std::string& shaderPath,
    const WorldRenderAssets& assets,
    std::string* outError = nullptr
  );
  void shutdown();

  void render(
    WgpuContext& ctx,
    const WorldData& world,
    ChunkStreamer& streamer,
    const glm::vec3& camPos,
    const glm::vec3& camTarget,
    const glm::vec3& playerPos,
    float fovDeg,
    float elapsedSec,
    const SkyLightingState& sky,
    const std::vector<SkinnedRenderCharacter>& characters,
    const std::vector<VehicleEntity>& vehicles,
    const std::vector<WorldMarkerBox>& markers,
    const std::vector<DynamicPointLight>& pointLights,
    const std::vector<DynamicPropPose>& dynamicProps,
    bool drawUiCallback
  );

  const RenderTelemetry& telemetry() const { return telemetry_; }

private:
  struct alignas(16) GpuPointLight {
    glm::vec4 posAndRadius;
    glm::vec4 colorAndIntensity;
  };

  struct alignas(16) FrameUniforms {
    glm::mat4 viewProj;
    glm::mat4 invViewProj;
    glm::mat4 lightViewProj;
    glm::vec4 camPos;
    glm::vec4 sunDir;   // w = pointLightCount
    glm::vec4 sunColor;
    glm::vec4 fogColor; // w = nightFactor
    std::array<GpuPointLight, kMaxPointLights> pointLights;
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
    std::string protoId;
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

  struct SkinSlot {
    WGPUBuffer ubo = nullptr;
    WGPUBindGroup bindGroup = nullptr;
  };

  void buildTerrainAndOceanBuffers(WgpuContext& ctx, const WorldData& world);
  void buildRoadAndArenaBuffers(WgpuContext& ctx, const WorldData& world);
  void buildPropAndVehicleBatches(WgpuContext& ctx, const WorldData& world, const std::string& assetsRoot);
  bool loadGlbBatch(WgpuContext& ctx, const std::string& glbPath, const std::vector<InstanceAttrib>& instances, InstancedGlbBatch& outBatch, float normalizeTargetLength = 0.0f);
  void buildSkinnedMesh(WgpuContext& ctx, const GltfModel& model, SkinnedMeshGpu& outMesh);
  GpuTextureBinding createRgbaTexture(WgpuContext& ctx, uint32_t w, uint32_t h, const uint8_t* rgba8);

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
  WGPURenderPipeline skyPipeline_ = nullptr;
  WGPURenderPipeline terrainPipeline_ = nullptr;
  WGPURenderPipeline instancedPipeline_ = nullptr;
  WGPURenderPipeline skinnedPipeline_ = nullptr;

  WGPUTexture shadowTex_ = nullptr;
  WGPUTextureView shadowView_ = nullptr;
  WGPUSampler shadowSampler_ = nullptr;
  WGPUSampler linearSampler_ = nullptr;
  GpuTextureBinding defaultWhiteTex_{};

  WGPUBuffer frameUbo_ = nullptr;
  std::array<SkinSlot, kMaxSkinSlots> skinSlots_{};

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
  uint32_t buildingCapacity_ = 0;
  std::vector<InstanceAttrib> buildingStaging_;

  WGPUBuffer fallbackPropInstVbo_ = nullptr;
  uint32_t fallbackPropCount_ = 0;

  WGPUBuffer markerInstVbo_ = nullptr;
  uint32_t markerCapacity_ = 0;
  std::vector<InstanceAttrib> markerStaging_;

  WGPUBuffer dynPropInstVbo_ = nullptr;
  uint32_t dynPropCapacity_ = 0;
  std::vector<InstanceAttrib> dynPropStaging_;

  std::vector<InstancedGlbBatch> glbPropBatches_;
  std::array<InstancedGlbBatch, 6> vehicleBatches_{};
  std::array<std::vector<InstanceAttrib>, 6> vehicleStaging_{};

  SkinnedMeshGpu playerBodyGpu_;
  SkinnedMeshGpu playerShortsGpu_;
  SkinnedMeshGpu playerHairGpu_;
  SkinnedMeshGpu businessGpu_;
  SkinnedMeshGpu civilianGpu_;
  SkinnedMeshGpu policeGpu_;
  SkinnedMeshGpu securityGpu_;

  RenderTelemetry telemetry_;
};

} // namespace westgate
