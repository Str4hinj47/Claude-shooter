#pragma once

#include "WgpuContext.hpp"
#include "WorldData.hpp"
#include "GltfAssetLoader.hpp"
#include <cstdint>
#include <glm/glm.hpp>
#include <string>
#include <vector>

namespace westgate {

struct RenderTelemetry {
  uint32_t visibleChunks = 0;
  uint32_t nearChunks = 0;
  uint32_t lodChunks = 0;
  uint32_t drawnBuildings = 0;
  uint32_t drawnProps = 0;
  uint32_t terrainTriangles = 0;
};

class WorldRenderer {
 public:
  bool init(WgpuContext& ctx, const WorldData& world, const std::string& shaderPath, const GltfModel* playerModel, std::string* err = nullptr);
  void shutdown();

  void render(
    WgpuContext& ctx,
    const WorldData& world,
    ChunkStreamer& streamer,
    const glm::vec3& camPos,
    const glm::vec3& camTarget,
    const glm::vec3& playerPos,
    float playerYawRad,
    bool drawUiCallback
  );

  const RenderTelemetry& telemetry() const { return telemetry_; }

 private:
  struct StaticVertex {
    float px, py, pz;
    float nx, ny, nz;
    float r, g, b;
  };

  struct UnitBoxVertex {
    float px, py, pz;
    float nx, ny, nz;
  };

  struct InstanceAttrib {
    float px, py, pz;
    float sx, sy, sz;
    float rotY;
    float r, g, b;
  };

  struct FrameUniforms {
    glm::mat4 viewProj;
    glm::vec4 camPos;
    glm::vec4 sunDir;
    glm::vec4 sunColor;
    glm::vec4 fogColor;
  };

  void buildTerrainAndOceanBuffers(WgpuContext& ctx, const WorldData& world);
  void buildRoadBuffers(WgpuContext& ctx, const WorldData& world);
  void buildUnitBoxAndProps(WgpuContext& ctx, const WorldData& world, const GltfModel* playerModel);

  WGPUShaderModule shader_ = nullptr;
  WGPUBindGroupLayout frameBgl_ = nullptr;
  WGPUBindGroup frameBg_ = nullptr;
  WGPUBuffer frameUbo_ = nullptr;
  WGPUPipelineLayout pipeLayout_ = nullptr;
  WGPURenderPipeline terrainPipeline_ = nullptr;
  WGPURenderPipeline instancedPipeline_ = nullptr;

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

  WGPUBuffer propInstVbo_ = nullptr;
  uint32_t propInstanceCount_ = 0;

  WGPUBuffer playerVbo_ = nullptr;
  WGPUBuffer playerIbo_ = nullptr;
  uint32_t playerIndexCount_ = 0;
  WGPUBuffer playerInstVbo_ = nullptr;

  std::vector<InstanceAttrib> buildingStaging_;
  RenderTelemetry telemetry_{};
};

} // namespace westgate
