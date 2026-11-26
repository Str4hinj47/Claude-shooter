#include "westgate/WorldData.hpp"
#include <algorithm>
#include <cmath>
#include <fstream>
#include <nlohmann/json.hpp>

namespace westgate {

bool Heightfield::loadBinary(const std::string& path, uint32_t gridSize, float worldMin, float worldMax) {
  std::ifstream f(path, std::ios::binary | std::ios::ate);
  if (!f) return false;
  const std::streamsize byteSize = f.tellg();
  const std::streamsize expected = static_cast<std::streamsize>(gridSize) * gridSize * sizeof(float);
  if (byteSize != expected) return false;
  f.seekg(0, std::ios::beg);
  samples_.resize(static_cast<size_t>(gridSize) * gridSize);
  if (!f.read(reinterpret_cast<char*>(samples_.data()), byteSize)) return false;
  gridSize_ = gridSize;
  worldMin_ = worldMin;
  worldMax_ = worldMax;
  return true;
}

float Heightfield::sampleHeight(float x, float z) const {
  if (gridSize_ < 2 || samples_.empty()) return 0.0f;
  const float span = worldMax_ - worldMin_;
  const float u = std::clamp((x - worldMin_) / span, 0.0f, 1.0f) * static_cast<float>(gridSize_ - 1);
  const float v = std::clamp((z - worldMin_) / span, 0.0f, 1.0f) * static_cast<float>(gridSize_ - 1);

  const uint32_t x0 = static_cast<uint32_t>(std::floor(u));
  const uint32_t z0 = static_cast<uint32_t>(std::floor(v));
  const uint32_t x1 = std::min(gridSize_ - 1, x0 + 1);
  const uint32_t z1 = std::min(gridSize_ - 1, z0 + 1);
  const float tx = u - static_cast<float>(x0);
  const float tz = v - static_cast<float>(z0);

  const float h00 = samples_[static_cast<size_t>(z0) * gridSize_ + x0];
  const float h10 = samples_[static_cast<size_t>(z0) * gridSize_ + x1];
  const float h01 = samples_[static_cast<size_t>(z1) * gridSize_ + x0];
  const float h11 = samples_[static_cast<size_t>(z1) * gridSize_ + x1];

  const float hx0 = h00 + (h10 - h00) * tx;
  const float hx1 = h01 + (h11 - h01) * tx;
  return hx0 + (hx1 - hx0) * tz;
}

glm::vec3 Heightfield::sampleNormal(float x, float z) const {
  const float eps = 1.5f;
  const float hl = sampleHeight(x - eps, z);
  const float hr = sampleHeight(x + eps, z);
  const float hd = sampleHeight(x, z - eps);
  const float hu = sampleHeight(x, z + eps);
  return glm::normalize(glm::vec3(hl - hr, 2.0f * eps, hd - hu));
}

bool WorldData::loadFromDirectory(const std::string& worldDir, std::string* err) {
  const std::string jsonPath = worldDir + "/westgate_world.json";
  const std::string hfPath = worldDir + "/westgate_heightfield.bin";

  std::ifstream jf(jsonPath);
  if (!jf) {
    if (err) *err = "Failed to open " + jsonPath;
    return false;
  }

  nlohmann::json j;
  try {
    jf >> j;
  } catch (const std::exception& e) {
    if (err) *err = std::string("JSON parse error: ") + e.what();
    return false;
  }

  worldMin = j.value("worldMin", -1200.0f);
  worldMax = j.value("worldMax", 1200.0f);
  chunkSize = j.value("chunkSize", 160.0f);
  const uint32_t gridN = j.value("heightfieldGrid", 512u);

  if (!heightfield.loadBinary(hfPath, gridN, worldMin, worldMax)) {
    if (err) *err = "Failed to load binary heightfield " + hfPath;
    return false;
  }

  if (j.contains("spawn")) {
    const auto& s = j["spawn"];
    spawnPos = glm::vec3(s.value("x", 0.0f), s.value("y", 5.0f), s.value("z", 0.0f));
    spawnYawDeg = s.value("yawDeg", 0.0f);
  }
  if (j.contains("fightPit")) {
    const auto& fp = j["fightPit"];
    fightPitPos = glm::vec3(fp.value("x", 722.0f), fp.value("y", 2.8f), fp.value("z", 115.0f));
  }

  teleports.clear();
  if (j.contains("teleports")) {
    for (const auto& t : j["teleports"]) {
      TeleportPoint tp;
      tp.id = t.value("id", "");
      tp.label = t.value("label", "");
      tp.pos = glm::vec3(t.value("x", 0.0f), t.value("y", 5.0f), t.value("z", 0.0f));
      tp.yawDeg = t.value("yawDeg", 0.0f);
      teleports.push_back(std::move(tp));
    }
  }

  weapons.clear();
  if (j.contains("weapons")) {
    for (const auto& w : j["weapons"]) {
      WeaponSpecData ws;
      ws.id = w.value("id", "");
      ws.name = w.value("name", "");
      ws.category = w.value("category", "");
      ws.damage = w.value("damage", 25.0f);
      ws.rpm = w.value("rpm", 600.0f);
      ws.magSize = w.value("magSize", 30);
      weapons.push_back(std::move(ws));
    }
  }

  roads.clear();
  if (j.contains("roads")) {
    for (const auto& r : j["roads"]) {
      RoadSegmentData seg;
      seg.id = r.value("id", "");
      seg.name = r.value("name", "");
      seg.tier = r.value("tier", "street");
      seg.width = r.value("width", 10.0f);
      seg.isBridge = r.value("isBridge", false);
      if (r.contains("samples")) {
        for (const auto& sp : r["samples"]) {
          if (sp.size() >= 5) {
            RoadSample rs;
            rs.pos = glm::vec3(sp[0].get<float>(), sp[1].get<float>(), sp[2].get<float>());
            rs.rx = sp[3].get<float>();
            rs.rz = sp[4].get<float>();
            seg.samples.push_back(rs);
          }
        }
      }
      roads.push_back(std::move(seg));
    }
  }

  chunks.clear();
  if (j.contains("chunks")) {
    for (const auto& c : j["chunks"]) {
      WorldChunkData wc;
      wc.key = c.value("key", "");
      wc.cx = c.value("cx", 0);
      wc.cz = c.value("cz", 0);
      wc.minX = c.value("minX", 0.0f);
      wc.maxX = c.value("maxX", 0.0f);
      wc.minZ = c.value("minZ", 0.0f);
      wc.maxZ = c.value("maxZ", 0.0f);
      float minY = -20.0f;
      float maxY = 120.0f;
      if (c.contains("boxes")) {
        for (const auto& b : c["boxes"]) {
          BuildingBox box;
          box.center = glm::vec3(b.value("cx", 0.0f), b.value("cy", 0.0f), b.value("cz", 0.0f));
          box.size = glm::vec3(b.value("w", 1.0f), b.value("h", 1.0f), b.value("d", 1.0f));
          if (b.contains("color") && b["color"].size() >= 3) {
            box.color = glm::vec3(b["color"][0].get<float>(), b["color"][1].get<float>(), b["color"][2].get<float>());
          }
          minY = std::min(minY, box.center.y - box.size.y * 0.5f);
          maxY = std::max(maxY, box.center.y + box.size.y * 0.5f);
          wc.buildings.push_back(box);
        }
      }
      wc.bounds = AABB{glm::vec3(wc.minX, minY, wc.minZ), glm::vec3(wc.maxX, maxY, wc.maxZ)};
      chunks.push_back(std::move(wc));
    }
  }

  props.clear();
  if (j.contains("props")) {
    for (const auto& p : j["props"]) {
      PropInstanceData pi;
      pi.proto = p.value("proto", "");
      pi.pos = glm::vec3(p.value("x", 0.0f), p.value("y", 0.0f), p.value("z", 0.0f));
      pi.ry = p.value("ry", 0.0f);
      pi.scale = p.value("s", 1.0f);
      props.push_back(std::move(pi));
    }
  }

  return true;
}

void ChunkStreamer::init(const WorldData& world) {
  chunkBounds_.clear();
  views_.clear();
  chunkBounds_.reserve(world.chunks.size());
  views_.reserve(world.chunks.size());
  for (uint32_t i = 0; i < static_cast<uint32_t>(world.chunks.size()); ++i) {
    chunkBounds_.push_back(world.chunks[i].bounds);
    views_.push_back(ActiveChunkView{i, ChunkLodState::Unloaded, false});
  }
}

void ChunkStreamer::update(const glm::vec3& focusPos, const Frustum& frustum) {
  const float nearEnter2 = nearRadius_ * nearRadius_;
  const float nearExit2 = (nearRadius_ + hysteresis_) * (nearRadius_ + hysteresis_);
  const float lodEnter2 = lodRadius_ * lodRadius_;
  const float lodExit2 = (lodRadius_ + hysteresis_) * (lodRadius_ + hysteresis_);

  nearCount_ = 0;
  lodCount_ = 0;
  visibleCount_ = 0;

  for (size_t i = 0; i < chunkBounds_.size(); ++i) {
    const AABB& b = chunkBounds_[i];
    const float cx = std::clamp(focusPos.x, b.min.x, b.max.x);
    const float cz = std::clamp(focusPos.z, b.min.z, b.max.z);
    const float dx = focusPos.x - cx;
    const float dz = focusPos.z - cz;
    const float d2 = dx * dx + dz * dz;

    ChunkLodState next = views_[i].state;
    if (next == ChunkLodState::Near) {
      if (d2 > lodExit2) next = ChunkLodState::Unloaded;
      else if (d2 > nearExit2) next = ChunkLodState::Lod;
    } else if (next == ChunkLodState::Lod) {
      if (d2 <= nearEnter2) next = ChunkLodState::Near;
      else if (d2 > lodExit2) next = ChunkLodState::Unloaded;
    } else {
      if (d2 <= nearEnter2) next = ChunkLodState::Near;
      else if (d2 <= lodEnter2) next = ChunkLodState::Lod;
    }

    views_[i].state = next;
    const bool vis = (next != ChunkLodState::Unloaded) && frustum.intersectsAABB(b);
    views_[i].visibleInFrustum = vis;

    if (next == ChunkLodState::Near) ++nearCount_;
    else if (next == ChunkLodState::Lod) ++lodCount_;
    if (vis) ++visibleCount_;
  }
}

} // namespace westgate
