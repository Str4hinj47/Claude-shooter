#pragma once

#include "EngineTypes.hpp"
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

  bool loadFromDirectory(const std::string& worldDir, std::string* err = nullptr);
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
  ChunkStreamer(float nearRadius = 320.0f, float lodRadius = 920.0f, float hysteresis = 24.0f)
      : nearRadius_(nearRadius), lodRadius_(lodRadius), hysteresis_(hysteresis) {}

  void init(const WorldData& world);
  void update(const glm::vec3& focusPos, const Frustum& frustum);

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
