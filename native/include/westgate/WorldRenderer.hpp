#pragma once
#include "westgate/CharacterAnimator.hpp"
#include "westgate/EngineTypes.hpp"
#include "westgate/GameSession.hpp"
#include "westgate/GltfAssetLoader.hpp"
#include "westgate/PhysicsWorld.hpp"
#include "westgate/WgpuContext.hpp"
#include "westgate/WorldData.hpp"
#include <array>
#include <cstddef>
#include <cstdint>
#include <glm/glm.hpp>
#include <string>
#include <vector>

namespace westgate {

constexpr size_t kMaxSkinSlots = 128;
constexpr size_t kMaxPointLights = 24;
constexpr size_t kNumHouseGlbs = 12;

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
  float overrideRoughness = -1.0f; // < 0 uses vertex/GLB PBR; >= 0 overrides with PackedArchBox roughness
  float familyAndMetal = 0.0f;     // floor = surfaceFamilyId (0..9), fract * 2.0 = metallic (0..1)
};
static_assert(sizeof(InstanceAttrib) == 64, "InstanceAttrib must be 64 bytes");

enum class SkinnedPartKind : uint8_t {
  PlayerBody = 0,
  PlayerShorts = 1,
  PlayerHair = 2,
  Business = 3,
  Civilian = 4,
  Police = 5,
  Security = 6,
  VanguardSoldier = 7,
  Military = 8,
  Construction = 9,
  Sports = 10,
  DogHusky = 11,
  Deer = 12,
};

struct SkinnedRenderCharacter {
  glm::vec3 position{0.0f};
  float yawRad = 0.0f;
  glm::vec4 tint{1.0f};
  SkinnedPartKind part = SkinnedPartKind::PlayerBody;
  const std::array<glm::mat4, kMaxSkinBones>* palette = nullptr;
  glm::quat extraLocalRot{1.0f, 0.0f, 0.0f, 0.0f};
  float uniformScale = 1.0f;
};

struct WorldRenderAssets {
  std::string assetsRoot;
  const GltfModel* playerBody = nullptr;
  const GltfModel* playerShorts = nullptr;
  const GltfModel* playerHair = nullptr;
  const GltfModel* vanguardSoldier = nullptr;
  const GltfModel* businessModel = nullptr;
  const GltfModel* civilianModel = nullptr;
  const GltfModel* policeModel = nullptr;
  const GltfModel* securityModel = nullptr;
  const GltfModel* militaryModel = nullptr;
  const GltfModel* constructionModel = nullptr;
  const GltfModel* sportsModel = nullptr;
  const GltfModel* dogHuskyModel = nullptr;
  const GltfModel* deerModel = nullptr;
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
    bool drawUiCallback,
    const std::vector<DynamicGlbPropInstance>& dynGlbProps = {}
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
    glm::mat4 lightViewProjNear;
    glm::mat4 lightViewProjFar;
    glm::vec4 camPos;
    glm::vec4 sunDir;        // w = pointLightCount
    glm::vec4 sunColor;
    glm::vec4 fogColor;      // w = nightFactor
    glm::vec4 weatherParams; // x = rainIntensity, y = wetness, z = lightningFlash, w = nearSplit
    std::array<GpuPointLight, kMaxPointLights> pointLights;
  };

  struct alignas(16) PostUniforms {
    glm::vec4 screenSize; // x = width, y = height, z = bloomThreshold, w = bloomIntensity
    glm::vec4 projParams; // x = near, y = far, z = ssaoRadius, w = ssaoStrength
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

  struct SpatialInstanceItem {
    glm::vec3 center{0.0f};
    float radius = 2.0f;
    float maxDrawDist = 520.0f;
    InstanceAttrib attrib{};
  };

  struct GlbSubmesh {
    uint32_t indexOffset = 0;
    uint32_t indexCount = 0;
    WGPUBindGroup texBindGroup = nullptr;
  };

  struct InstancedGlbBatch {
    std::string protoId;
    WGPUBuffer vbo = nullptr;
    WGPUBuffer ibo = nullptr;
    WGPUBuffer instVbo = nullptr;
    WGPUBuffer shadowNearInstVbo = nullptr;
    WGPUBuffer shadowFarInstVbo = nullptr;
    std::vector<GlbSubmesh> submeshes;
    std::vector<GpuTextureBinding> ownedTextures;
    std::vector<WGPUBindGroup> ownedBindGroups;
    std::vector<SpatialInstanceItem> spatialItems;
    std::vector<InstanceAttrib> visibleStaging;
    std::vector<InstanceAttrib> shadowNearStaging;
    std::vector<InstanceAttrib> shadowFarStaging;
    glm::vec3 rawMin{0.0f};
    glm::vec3 rawMax{1.0f};
    uint32_t indexCount = 0;
    uint32_t instanceCount = 0;
    uint32_t shadowNearCount = 0;
    uint32_t shadowFarCount = 0;
    uint32_t maxInstances = 0;
  };

  struct CustomPropBatch {
    std::string protoId;
    WGPUBuffer vbo = nullptr;
    WGPUBuffer ibo = nullptr;
    WGPUBuffer instVbo = nullptr;
    WGPUBuffer shadowNearInstVbo = nullptr;
    uint32_t indexCount = 0;
    uint32_t maxInstances = 0;
    uint32_t visibleCount = 0;
    uint32_t shadowNearCount = 0;
    std::vector<SpatialInstanceItem> spatialItems;
    std::vector<InstanceAttrib> visibleStaging;
    std::vector<InstanceAttrib> shadowNearStaging;
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
    std::vector<WGPUBindGroup> ownedBindGroups;
  };

  struct SkinSlot {
    WGPUBuffer ubo = nullptr;
    WGPUBindGroup bindGroup = nullptr;
  };

  struct ArticulatedWheelGpu {
    InstancedGlbBatch batch;
    std::vector<InstanceAttrib> staging;
    glm::vec3 pivotVeh{0.0f}; // vehicle-local meter pivot (+Z fwd, +X left, +Y up)
    float radius = 0.35f;
    bool isFront = false;
    int cornerIdx = 0; // 0=FL, 1=FR, 2=RL, 3=RR
  };

  struct VehicleGpuAsset {
    InstancedGlbBatch chassis;
    std::vector<InstanceAttrib> chassisStaging;
    std::vector<ArticulatedWheelGpu> wheels;
    bool hasMainRotor = false;
    InstancedGlbBatch mainRotor;
    std::vector<InstanceAttrib> mainRotorStaging;
    glm::vec3 mainRotorPivotVeh{0.0f};
    bool hasTailRotor = false;
    InstancedGlbBatch tailRotor;
    std::vector<InstanceAttrib> tailRotorStaging;
    glm::vec3 tailRotorPivotVeh{0.0f};
  };

  bool loadVehicleAsset(
    WgpuContext& ctx,
    const std::string& glbPath,
    const VehicleSpec& spec,
    VehicleGpuAsset& outAsset
  );

  void buildTerrainAndOceanBuffers(WgpuContext& ctx, const WorldData& world);
  void buildRoadAndArenaBuffers(WgpuContext& ctx, const WorldData& world);
  void buildCustomWorldMeshBuffers(WgpuContext& ctx, const WorldData& world);
  void buildPropAndVehicleBatches(WgpuContext& ctx, const WorldData& world, const std::string& assetsRoot);
  bool loadGlbBatch(
    WgpuContext& ctx,
    const std::string& glbPath,
    const std::vector<InstanceAttrib>& instances,
    InstancedGlbBatch& outBatch,
    float normalizeTargetLength = 0.0f,
    bool decodeTextures = false,
    bool isVehicle = false,
    float yawOffsetRad = 0.0f,
    bool centerXZOnRaw = false
  );
  bool loadGlbUnitBoxBatch(WgpuContext& ctx, const std::string& glbPath, uint32_t maxInstances, InstancedGlbBatch& outBatch);
  void buildSkinnedMesh(WgpuContext& ctx, const GltfModel& model, SkinnedMeshGpu& outMesh);
  GpuTextureBinding createRgbaTexture(WgpuContext& ctx, uint32_t w, uint32_t h, const uint8_t* rgba8, bool createDefaultMatBg = false);
  WGPUBindGroup createPbrMatBindGroup(
    WgpuContext& ctx,
    WGPUTextureView albedoView,
    WGPUTextureView normalView,
    WGPUTextureView mrView,
    WGPUTextureView emissiveView
  );
  void ensureOffscreenTargets(WgpuContext& ctx);
  void releaseOffscreenTargets();
  WGPUBindGroup createPostBindGroup(WgpuContext& ctx, WGPUTextureView texA, WGPUTextureView texB, WGPUTextureView depthView, WGPUTextureView ssaoView);

  WGPUShaderModule shader_ = nullptr;
  WGPUShaderModule postShader_ = nullptr;
  WGPUBindGroupLayout frameBgl_ = nullptr;
  WGPUBindGroupLayout skinBgl_ = nullptr;
  WGPUBindGroupLayout matBgl_ = nullptr;
  WGPUBindGroupLayout shadowReadBgl_ = nullptr;
  WGPUBindGroupLayout postBgl_ = nullptr;
  WGPUBindGroup frameBg_ = nullptr;
  WGPUBindGroup shadowReadBg_ = nullptr;

  WGPUPipelineLayout shadowStaticPipeLayout_ = nullptr;
  WGPUPipelineLayout shadowSkinnedPipeLayout_ = nullptr;
  WGPUPipelineLayout scenePipeLayout_ = nullptr;
  WGPUPipelineLayout postPipeLayout_ = nullptr;

  WGPURenderPipeline shadowTerrainNearPipeline_ = nullptr;
  WGPURenderPipeline shadowTerrainFarPipeline_ = nullptr;
  WGPURenderPipeline shadowCustomNearPipeline_ = nullptr;
  WGPURenderPipeline shadowCustomFarPipeline_ = nullptr;
  WGPURenderPipeline shadowCustomInstNearPipeline_ = nullptr;
  WGPURenderPipeline shadowCustomInstFarPipeline_ = nullptr;
  WGPURenderPipeline shadowInstancedNearPipeline_ = nullptr;
  WGPURenderPipeline shadowInstancedFarPipeline_ = nullptr;
  WGPURenderPipeline shadowSkinnedNearPipeline_ = nullptr;
  WGPURenderPipeline shadowSkinnedFarPipeline_ = nullptr;
  WGPURenderPipeline skyPipeline_ = nullptr;
  WGPURenderPipeline terrainPipeline_ = nullptr;
  WGPURenderPipeline customMeshPipeline_ = nullptr;
  WGPURenderPipeline customInstancedPipeline_ = nullptr;
  WGPURenderPipeline archBoxPipeline_ = nullptr;
  WGPURenderPipeline instancedPipeline_ = nullptr;
  WGPURenderPipeline skinnedPipeline_ = nullptr;

  WGPURenderPipeline ssaoPipeline_ = nullptr;
  WGPURenderPipeline bloomThreshPipeline_ = nullptr;
  WGPURenderPipeline bloomBlurHPipeline_ = nullptr;
  WGPURenderPipeline bloomBlurVPipeline_ = nullptr;
  WGPURenderPipeline compositePipeline_ = nullptr;

  WGPUTexture shadowTex_ = nullptr;
  WGPUTextureView shadowLayerViews_[2] = {nullptr, nullptr};
  WGPUTextureView shadowArrayView_ = nullptr;
  WGPUSampler shadowSampler_ = nullptr;
  WGPUSampler repeatSampler_ = nullptr;
  WGPUSampler linearSampler_ = nullptr;
  GpuTextureBinding defaultWhiteTex_{};
  GpuTextureBinding defaultFlatNormalTex_{};

  uint32_t offscreenW_ = 0;
  uint32_t offscreenH_ = 0;
  WGPUTextureView boundDepthView_ = nullptr;
  WGPUTexture hdrTex_ = nullptr;
  WGPUTextureView hdrView_ = nullptr;
  WGPUTexture ssaoTex_ = nullptr;
  WGPUTextureView ssaoView_ = nullptr;
  WGPUTexture bloomTexA_ = nullptr;
  WGPUTextureView bloomViewA_ = nullptr;
  WGPUTexture bloomTexB_ = nullptr;
  WGPUTextureView bloomViewB_ = nullptr;
  WGPUBuffer postUbo_ = nullptr;
  WGPUBindGroup postBgSSAO_ = nullptr;
  WGPUBindGroup postBgThresh_ = nullptr;
  WGPUBindGroup postBgBlurH_ = nullptr;
  WGPUBindGroup postBgBlurV_ = nullptr;
  WGPUBindGroup postBgComposite_ = nullptr;

  WGPUBuffer frameUbo_ = nullptr;
  std::array<SkinSlot, kMaxSkinSlots> skinSlots_{};

  WGPUBuffer terrainVbo_ = nullptr;
  WGPUBuffer terrainIbo_ = nullptr;
  uint32_t terrainIndexCount_ = 0;

  WGPUBuffer roadVbo_ = nullptr;
  WGPUBuffer roadIbo_ = nullptr;
  uint32_t roadIndexCount_ = 0;

  WGPUBuffer customMeshVbo_ = nullptr;
  WGPUBuffer customMeshIbo_ = nullptr;
  uint32_t customMeshIndexCount_ = 0;

  WGPUBuffer unitBoxVbo_ = nullptr;
  WGPUBuffer unitBoxIbo_ = nullptr;
  uint32_t unitBoxIndexCount_ = 0;

  WGPUBuffer buildingInstVbo_ = nullptr;
  WGPUBuffer shadowNearBoxInstVbo_ = nullptr;
  WGPUBuffer shadowFarBoxInstVbo_ = nullptr;
  uint32_t buildingCapacity_ = 0;
  uint32_t shadowNearBoxCapacity_ = 0;
  uint32_t shadowFarBoxCapacity_ = 0;
  std::vector<InstanceAttrib> buildingStaging_;
  std::vector<InstanceAttrib> shadowNearBoxStaging_;
  std::vector<InstanceAttrib> shadowFarBoxStaging_;

  WGPUBuffer fallbackPropInstVbo_ = nullptr;
  uint32_t fallbackPropCount_ = 0;

  WGPUBuffer markerInstVbo_ = nullptr;
  uint32_t markerCapacity_ = 0;
  std::vector<InstanceAttrib> markerStaging_;

  WGPUBuffer dynPropInstVbo_ = nullptr;
  uint32_t dynPropCapacity_ = 0;
  std::vector<InstanceAttrib> dynPropStaging_;

  std::vector<CustomPropBatch> customPropBatches_;
  std::vector<InstancedGlbBatch> glbPropBatches_;
  std::array<InstancedGlbBatch, kNumHouseGlbs> houseBatches_{};
  std::array<std::vector<InstanceAttrib>, kNumHouseGlbs> houseStaging_{};
  std::array<VehicleGpuAsset, kVehicleModelCount> vehicleAssets_{};
  std::array<InstancedGlbBatch, kDynamicGlbPropCount> dynGlbBatches_{};

  SkinnedMeshGpu playerBodyGpu_;
  SkinnedMeshGpu playerShortsGpu_;
  SkinnedMeshGpu playerHairGpu_;
  SkinnedMeshGpu vanguardSoldierGpu_;
  SkinnedMeshGpu businessGpu_;
  SkinnedMeshGpu civilianGpu_;
  SkinnedMeshGpu policeGpu_;
  SkinnedMeshGpu securityGpu_;
  SkinnedMeshGpu militaryGpu_;
  SkinnedMeshGpu constructionGpu_;
  SkinnedMeshGpu sportsGpu_;
  SkinnedMeshGpu dogHuskyGpu_;
  SkinnedMeshGpu deerGpu_;

  RenderTelemetry telemetry_;
};

} // namespace westgate
