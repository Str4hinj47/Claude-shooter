#pragma once

#include "EngineTypes.hpp"
#include <cstddef>
#include <cstdint>
#include <string>
#include <unordered_map>
#include <vector>

namespace westgate {

struct BuildingBox {
  glm::vec3 center{0.0f};
  glm::vec3 size{1.0f};
  glm::vec3 color{0.6f};
};

#pragma pack(push, 1)
struct PackedWorldVertex {
  float px = 0.0f;
  float py = 0.0f;
  float pz = 0.0f;
  int8_t nx = 0;
  int8_t ny = 127;
  int8_t nz = 0;
  int8_t nw = 0; // surfaceFamilyId: 0=generic, 1=asphalt, 2=concrete/sidewalk, 3=roadStripe, 4=brick/stone, 5=wood, 6=metal, 7=grass, 8=glass
  int16_t u = 0; // UV * 256
  int16_t v = 0;
  uint8_t r = 255;
  uint8_t g = 255;
  uint8_t b = 255;
  uint8_t a = 255;
  uint8_t rough = 200;
  uint8_t metal = 10;
  uint8_t emissive = 0;
  uint8_t flags = 0; // bit0=nightGlow, bit1=decal
};
static_assert(sizeof(PackedWorldVertex) == 28, "PackedWorldVertex must be 28 bytes");

struct PackedArchBox {
  float cx = 0.0f;
  float cy = 0.0f;
  float cz = 0.0f;
  float hx = 0.5f;
  float hy = 0.5f;
  float hz = 0.5f;
  int16_t qx = 0;
  int16_t qy = 0;
  int16_t qz = 0;
  int16_t qw = 32767;
  uint8_t r = 200;
  uint8_t g = 200;
  uint8_t b = 200;
  uint8_t a = 255;
  uint8_t rough = 200;
  uint8_t metal = 10;
  uint8_t emissive = 0;
  uint8_t family = 0;
};
static_assert(sizeof(PackedArchBox) == 40, "PackedArchBox must be 40 bytes");

struct ChunkMeshSlice {
  uint32_t firstIndex = 0;
  uint32_t indexCount = 0;
  uint32_t firstNearBox = 0;
  uint32_t nearBoxCount = 0;
  uint32_t firstLodBox = 0;
  uint32_t lodBoxCount = 0;
  float minY = 0.0f;
  float maxY = 12.0f;
};
static_assert(sizeof(ChunkMeshSlice) == 32, "ChunkMeshSlice must be 32 bytes");
#pragma pack(pop)

struct ProceduralPropPrototype {
  std::string id;
  std::vector<PackedWorldVertex> vertices;
  std::vector<uint32_t> indices;
};

struct GlbPlacementData {
  std::string file;
  glm::vec3 pos{0.0f};
  float yaw = 0.0f;
  float yawOffset = 0.0f;
  char axis = 'y';
  float targetMeters = 1.0f;
  bool hasFitFootprint = false;
  glm::vec3 fitMaxWdh{1.0f}; // (maxW, maxD, maxH)
  float baseY = 0.0f;
};

struct GrammarBuildingSpec {
  glm::vec3 pos{0.0f};
  float yaw = 0.0f;
  float w = 16.0f;
  float h = 24.0f;
  float d = 16.0f;
  std::string style;
  std::string kindOverride;
  int32_t storefrontOverride = -1;
  std::string rhythmOverride;
  bool skipGround = false;
  bool roofCap = true;
  int32_t maxFloors = 14;
  int32_t maxBays = 9;
  uint32_t seed = 0;
};

struct KitDetailSpec {
  std::string kind; // "relief" | "storefront" | "rooftop"
  glm::vec3 pos{0.0f};
  float yaw = 0.0f;
  float w = 12.0f;
  float h = 12.0f;
  float d = 12.0f;
  bool balconies = false;
  bool tall = false;
  bool waterTower = false;
  bool billboard = false;
  uint32_t awningColor = 0x1e40af;
};

struct WorldChunkData {
  std::string key;
  int32_t cx = 0;
  int32_t cz = 0;
  float minX = 0.0f;
  float maxX = 0.0f;
  float minZ = 0.0f;
  float maxZ = 0.0f;
  AABB bounds{};
  std::vector<BuildingBox> buildings;
  ChunkMeshSlice meshSlice{};
  std::vector<PackedArchBox> nearBoxes;
  std::vector<PackedArchBox> lodBoxes;
};

struct RoadSample {
  glm::vec3 pos{0.0f};
  float rx = 1.0f;
  float rz = 0.0f;
};

struct RoadSegmentData {
  std::string id;
  std::string name;
  std::string tier;
  float width = 10.0f;
  bool isBridge = false;
  std::vector<RoadSample> samples;
};

struct PropInstanceData {
  std::string proto;
  glm::vec3 pos{0.0f};
  float ry = 0.0f;
  float scale = 1.0f;
};

struct TeleportPoint {
  std::string id;
  std::string label;
  glm::vec3 pos{0.0f};
  float yawDeg = 0.0f;
};

struct WeaponSpecData {
  std::string id;
  std::string name;
  std::string category;
  float damage = 25.0f;
  float rpm = 600.0f;
  int32_t magSize = 30;
};

class Heightfield {
 public:
  bool loadBinary(const std::string& path, uint32_t gridSize, float worldMin, float worldMax);

  float sampleHeight(float x, float z) const;
  glm::vec3 sampleNormal(float x, float z) const;

  uint32_t gridSize() const { return gridSize_; }
  float worldMin() const { return worldMin_; }
  float worldMax() const { return worldMax_; }
  const std::vector<float>& rawSamples() const { return samples_; }

 private:
  uint32_t gridSize_ = 0;
  float worldMin_ = -1200.0f;
  float worldMax_ = 1200.0f;
  std::vector<float> samples_;
};

struct WorldData {
  float worldMin = -1200.0f;
  float worldMax = 1200.0f;
  float chunkSize = 160.0f;
  glm::vec3 spawnPos{0.0f, 5.0f, 0.0f};
  float spawnYawDeg = 0.0f;
  glm::vec3 fightPitPos{722.0f, 2.8f, 115.0f};

  Heightfield heightfield;
  std::vector<TeleportPoint> teleports;
  std::vector<WeaponSpecData> weapons;
  std::vector<RoadSegmentData> roads;
  std::vector<WorldChunkData> chunks;
  std::vector<PropInstanceData> props;
  std::vector<GlbPlacementData> glbPlacements;
  std::vector<GrammarBuildingSpec> grammarBuildings;
  std::vector<KitDetailSpec> kitDetails;

  // Binary static custom mesh pack ("WGMB" v1: RoadNetwork + 5 Bridges + Landmarks + Prototypes)
  bool hasCustomMeshes = false;
  std::vector<PackedWorldVertex> customMeshVertices;
  std::vector<uint32_t> customMeshIndices;
  std::vector<ProceduralPropPrototype> propPrototypes;

  bool loadFromDirectory(const std::string& worldDir, std::string* err = nullptr);

 private:
  bool loadMeshPack(const std::string& binPath);
  void expandProceduralArchitecture();
};

enum class ChunkLodState : uint8_t { Unloaded = 0, Lod = 1, Near = 2 };

struct ActiveChunkView {
  uint32_t chunkIndex = 0;
  ChunkLodState state = ChunkLodState::Unloaded;
  bool visibleInFrustum = false;
};

/**
 * Distance + Frustum sector streamer across Westgate Bay's 15x15 160m chunks.
 */
class ChunkStreamer {
 public:
  ChunkStreamer(float nearRadius = 335.0f, float lodRadius = 1550.0f, float hysteresis = 24.0f)
      : nearRadius_(nearRadius), lodRadius_(lodRadius), hysteresis_(hysteresis) {}

  void init(const WorldData& world);
  void update(const glm::vec3& focusPos, const Frustum& frustum);
  void setRadii(float nearRadius, float lodRadius) {
    nearRadius_ = nearRadius;
    lodRadius_ = lodRadius;
  }

  const std::vector<ActiveChunkView>& views() const { return views_; }
  uint32_t nearCount() const { return nearCount_; }
  uint32_t lodCount() const { return lodCount_; }
  uint32_t visibleCount() const { return visibleCount_; }

 private:
  float nearRadius_;
  float lodRadius_;
  float hysteresis_;
  std::vector<AABB> chunkBounds_;
  std::vector<ActiveChunkView> views_;
  uint32_t nearCount_ = 0;
  uint32_t lodCount_ = 0;
  uint32_t visibleCount_ = 0;
};

} // namespace westgate
