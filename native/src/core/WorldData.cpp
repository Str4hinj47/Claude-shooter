#include "westgate/WorldData.hpp"
#include <algorithm>
#include <array>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <cstring>
#include <fstream>
#include <glm/gtc/quaternion.hpp>
#include <nlohmann/json.hpp>
#include <string>
#include <utility>
#include <vector>

namespace westgate {

namespace {

constexpr float kPi = 3.14159265358979323846f;

struct MatBytes {
  uint8_t r = 200;
  uint8_t g = 200;
  uint8_t b = 200;
  uint8_t a = 255;
  uint8_t rough = 200;
  uint8_t metal = 10;
  uint8_t emissive = 0;
  uint8_t family = 0;
};

MatBytes hexMat(uint32_t hex, float rough, float metal, uint8_t family, float emStrength = 0.0f, uint8_t alpha = 255) {
  MatBytes m;
  m.r = static_cast<uint8_t>((hex >> 16) & 0xFFu);
  m.g = static_cast<uint8_t>((hex >> 8) & 0xFFu);
  m.b = static_cast<uint8_t>(hex & 0xFFu);
  m.a = alpha;
  m.rough = static_cast<uint8_t>(std::clamp(rough * 255.0f, 8.0f, 252.0f));
  m.metal = static_cast<uint8_t>(std::clamp(metal * 255.0f, 0.0f, 255.0f));
  m.emissive = static_cast<uint8_t>(std::clamp(emStrength * 63.75f, 0.0f, 255.0f));
  m.family = family;
  return m;
}

PackedArchBox makePackedBox(
  const glm::vec3& center,
  const glm::vec3& halfExtents,
  const glm::quat& rot,
  const MatBytes& m
) {
  PackedArchBox b;
  b.cx = center.x;
  b.cy = center.y;
  b.cz = center.z;
  b.hx = std::max(0.01f, halfExtents.x);
  b.hy = std::max(0.01f, halfExtents.y);
  b.hz = std::max(0.01f, halfExtents.z);
  const glm::quat q = glm::normalize(rot);
  auto q16 = [](float v) -> int16_t {
    return static_cast<int16_t>(std::clamp(std::round(v * 32767.0f), -32767.0f, 32767.0f));
  };
  b.qx = q16(q.x);
  b.qy = q16(q.y);
  b.qz = q16(q.z);
  b.qw = q16(q.w);
  b.r = m.r;
  b.g = m.g;
  b.b = m.b;
  b.a = m.a;
  b.rough = m.rough;
  b.metal = m.metal;
  b.emissive = m.emissive;
  b.family = m.family;
  return b;
}

uint32_t hashSeed(uint32_t seed, const std::string& path) {
  uint32_t h = 2166136261u ^ seed;
  for (unsigned char c : path) {
    h ^= static_cast<uint32_t>(c);
    h *= 16777619u;
  }
  return h;
}

float mulberrySample(uint32_t a) {
  a += 0x6d2b79f5u;
  uint32_t t = (a ^ (a >> 15)) * (1u | a);
  t = (t + ((t ^ (t >> 7)) * (61u | t))) ^ t;
  return static_cast<float>(t ^ (t >> 14)) / 4294967296.0f;
}

struct FacadePresetCpp {
  const char* kind;
  uint8_t primaryFamily;
  uint32_t primaryColor;
  uint8_t secondaryFamily;
  uint32_t secondaryColor;
  uint32_t frameColor;
  uint32_t glassColor;
  uint32_t litColor;
  const char* rhythm;
  float windowRatio;
  float floorHeight;
  float bayWidth;
  int32_t divisions;
  int32_t louversPerFloor;
  float louverDepth;
  bool storefront;
  float parapetHeight;
  uint32_t coreColor;
};

FacadePresetCpp getFacadePreset(const std::string& style) {
  if (style == "glass_teal")   return {"curtainwall", 6, 0x2c4b57, 6, 0x3b6778, 0x202c35, 0x4b7f96, 0xbfe7ff, "regular",   0.72f, 4.1f, 3.8f, 2, 4, 0.18f, true,  0.75f, 0x16242d};
  if (style == "glass_navy")   return {"curtainwall", 6, 0x22364d, 4, 0x394b61, 0x1c2530, 0x355c82, 0xaed4ff, "alternate", 0.74f, 4.2f, 3.8f, 2, 4, 0.18f, true,  0.85f, 0x131d29};
  if (style == "glass_gold")   return {"curtainwall", 6, 0x6b583d, 4, 0x8a7554, 0x362b1c, 0x8a7446, 0xffe4a3, "group",     0.70f, 4.1f, 3.9f, 2, 4, 0.18f, true,  0.80f, 0x241d13};
  if (style == "glass_slate")  return {"louver",      6, 0x3a4652, 6, 0x566472, 0x1f252c, 0x42586b, 0xd4e8ff, "regular",   0.68f, 4.0f, 3.7f, 2, 3, 0.20f, true,  0.75f, 0x181e24};
  if (style == "limestone")    return {"classical",   4, 0xd4ccb9, 4, 0xbfb6a2, 0x4d483f, 0x2c4050, 0xffe6b5, "regular",   0.56f, 4.0f, 3.6f, 1, 3, 0.16f, true,  0.85f, 0x2a2722};
  if (style == "granite_dark") return {"classical",   4, 0x4b5058, 4, 0x626872, 0x24282e, 0x263747, 0xffdba1, "alternate", 0.58f, 4.0f, 3.7f, 1, 3, 0.16f, true,  0.80f, 0x1b1e22};
  if (style == "brick_red")    return {"grid",        4, 0x843f32, 4, 0xc8bfae, 0x2b2523, 0x293b4a, 0xffd18e, "regular",   0.54f, 3.6f, 3.3f, 1, 3, 0.16f, true,  0.65f, 0x261815};
  if (style == "brick_tan")    return {"grid",        4, 0xa28668, 4, 0xd2c7b4, 0x332b23, 0x2c3e4d, 0xffd99c, "alternate", 0.55f, 3.6f, 3.4f, 1, 3, 0.16f, true,  0.65f, 0x262019};
  if (style == "concrete_mod") return {"louver",      2, 0x9298a0, 2, 0x747b84, 0x2c3138, 0x31495c, 0xd6ecff, "group",     0.60f, 3.7f, 3.6f, 1, 3, 0.20f, false, 0.65f, 0x1d2126};
  return                              {"grid",        2, 0xdfd0b8, 5, 0x8f6644, 0x3d2e22, 0x355066, 0xffd58f, "regular",   0.54f, 3.5f, 3.4f, 1, 3, 0.16f, true,  0.55f, 0x26211c};
}

} // namespace

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

bool WorldData::loadMeshPack(const std::string& binPath) {
  std::ifstream bf(binPath, std::ios::binary);
  if (!bf) return false;

  uint32_t hdr[8]{};
  if (!bf.read(reinterpret_cast<char*>(hdr), sizeof(hdr))) return false;
  if (hdr[0] != 0x424d4757u || hdr[1] != 1u) return false; // "WGMB" v1

  const uint32_t chunkCnt = hdr[2];
  const uint32_t totalVerts = hdr[3];
  const uint32_t totalIdx = hdr[4];
  const uint32_t totalBoxes = hdr[5];
  const uint32_t protoCnt = hdr[6];

  std::vector<ChunkMeshSlice> slices(chunkCnt);
  if (chunkCnt > 0 && !bf.read(reinterpret_cast<char*>(slices.data()), static_cast<std::streamsize>(chunkCnt * sizeof(ChunkMeshSlice)))) {
    return false;
  }

  customMeshVertices.resize(totalVerts);
  if (totalVerts > 0 && !bf.read(reinterpret_cast<char*>(customMeshVertices.data()), static_cast<std::streamsize>(totalVerts * sizeof(PackedWorldVertex)))) {
    return false;
  }

  customMeshIndices.resize(totalIdx);
  if (totalIdx > 0 && !bf.read(reinterpret_cast<char*>(customMeshIndices.data()), static_cast<std::streamsize>(totalIdx * sizeof(uint32_t)))) {
    return false;
  }

  std::vector<PackedArchBox> allBoxes(totalBoxes);
  if (totalBoxes > 0 && !bf.read(reinterpret_cast<char*>(allBoxes.data()), static_cast<std::streamsize>(totalBoxes * sizeof(PackedArchBox)))) {
    return false;
  }

  const size_t nCopy = std::min(chunks.size(), slices.size());
  for (size_t ci = 0; ci < nCopy; ++ci) {
    WorldChunkData& dst = chunks[ci];
    const ChunkMeshSlice& sl = slices[ci];
    dst.meshSlice = sl;
    if (sl.nearBoxCount > 0 && static_cast<size_t>(sl.firstNearBox + sl.nearBoxCount) <= allBoxes.size()) {
      dst.nearBoxes.insert(
        dst.nearBoxes.end(),
        allBoxes.begin() + sl.firstNearBox,
        allBoxes.begin() + sl.firstNearBox + sl.nearBoxCount
      );
    }
    if (sl.lodBoxCount > 0 && static_cast<size_t>(sl.firstLodBox + sl.lodBoxCount) <= allBoxes.size()) {
      dst.lodBoxes.insert(
        dst.lodBoxes.end(),
        allBoxes.begin() + sl.firstLodBox,
        allBoxes.begin() + sl.firstLodBox + sl.lodBoxCount
      );
    }
    dst.bounds.min.y = std::min(dst.bounds.min.y, sl.minY - 2.0f);
    dst.bounds.max.y = std::max(dst.bounds.max.y, sl.maxY + 2.0f);
  }

  propPrototypes.clear();
  propPrototypes.reserve(protoCnt);
  for (uint32_t pi = 0; pi < protoCnt; ++pi) {
    char idBuf[32]{};
    uint32_t counts[2]{};
    if (!bf.read(idBuf, 32)) break;
    if (!bf.read(reinterpret_cast<char*>(counts), sizeof(counts))) break;
    idBuf[31] = '\0';
    ProceduralPropPrototype proto;
    proto.id = idBuf;
    proto.vertices.resize(counts[0]);
    proto.indices.resize(counts[1]);
    if (counts[0] > 0 && !bf.read(reinterpret_cast<char*>(proto.vertices.data()), static_cast<std::streamsize>(counts[0] * sizeof(PackedWorldVertex)))) {
      break;
    }
    if (counts[1] > 0 && !bf.read(reinterpret_cast<char*>(proto.indices.data()), static_cast<std::streamsize>(counts[1] * sizeof(uint32_t)))) {
      break;
    }
    propPrototypes.push_back(std::move(proto));
  }

  hasCustomMeshes = !customMeshVertices.empty() && !customMeshIndices.empty();
  return hasCustomMeshes;
}

void WorldData::expandProceduralArchitecture() {
  if (chunks.empty()) return;
  const int32_t gridSide = static_cast<int32_t>(std::round((worldMax - worldMin) / chunkSize));
  if (gridSide <= 0 || static_cast<size_t>(gridSide * gridSide) > chunks.size()) return;

  auto chunkIndexAt = [&](float x, float z) -> size_t {
    const int32_t cx = std::clamp(static_cast<int32_t>(std::floor((x - worldMin) / chunkSize)), 0, gridSide - 1);
    const int32_t cz = std::clamp(static_cast<int32_t>(std::floor((z - worldMin) / chunkSize)), 0, gridSide - 1);
    return static_cast<size_t>(cx * gridSide + cz);
  };

  auto addLocalBox = [&](size_t ci, bool toLod, const glm::vec3& origin, const glm::quat& rootQ,
                         float lx, float ly, float lz, float bw, float bh, float bd,
                         const glm::quat& localQ, const MatBytes& mat) {
    if (bw <= 0.02f || bh <= 0.02f || bd <= 0.02f) return;
    const glm::vec3 worldCenter = origin + rootQ * glm::vec3(lx, ly, lz);
    const glm::quat worldRot = rootQ * localQ;
    const PackedArchBox pb = makePackedBox(worldCenter, glm::vec3(bw * 0.5f, bh * 0.5f, bd * 0.5f), worldRot, mat);
    WorldChunkData& ch = chunks[ci];
    if (toLod) ch.lodBoxes.push_back(pb);
    else ch.nearBoxes.push_back(pb);
    ch.bounds.min.y = std::min(ch.bounds.min.y, worldCenter.y - bh * 0.6f);
    ch.bounds.max.y = std::max(ch.bounds.max.y, worldCenter.y + bh * 0.6f);
  };

  const glm::quat idQ(1.0f, 0.0f, 0.0f, 0.0f);

  // 1. Expand all 3D FacadeGrammar building shells (curtainwall, grid, louver, classical)
  for (const auto& gb : grammarBuildings) {
    const FacadePresetCpp base = getFacadePreset(gb.style);
    const std::string kind = gb.kindOverride.empty() ? base.kind : gb.kindOverride;
    const bool storefront = (gb.storefrontOverride >= 0) ? (gb.storefrontOverride != 0) : base.storefront;
    const std::string rhythm = gb.rhythmOverride.empty() ? base.rhythm : gb.rhythmOverride;

    const MatBytes matPrimary   = hexMat(base.primaryColor,   base.primaryFamily == 6 ? 0.42f : 0.84f, base.primaryFamily == 6 ? 0.55f : 0.05f, base.primaryFamily);
    const MatBytes matSecondary = hexMat(base.secondaryColor, base.secondaryFamily == 6 ? 0.38f : 0.80f, base.secondaryFamily == 6 ? 0.62f : 0.06f, base.secondaryFamily);
    const MatBytes matFrame     = hexMat(base.frameColor,     0.38f, 0.72f, 6);
    const MatBytes matGlassDay  = hexMat(base.glassColor,     0.08f, 0.84f, 8, 0.0f);
    const MatBytes matGlassLit  = hexMat(base.litColor,       0.12f, 0.45f, 8, 1.35f);
    const MatBytes matCore      = hexMat(base.coreColor,      0.90f, 0.05f, 2);

    const size_t ci = chunkIndexAt(gb.pos.x, gb.pos.z);
    const glm::quat rootQ = glm::angleAxis(gb.yaw, glm::vec3(0.0f, 1.0f, 0.0f));
    const float w = gb.w;
    const float h = gb.h;
    const float d = gb.d;

    // Structural core (also ensure LOD silhouette exists even if district omitted addLodBox)
    const float cw = std::max(0.5f, w - 0.42f);
    const float cd = std::max(0.5f, d - 0.42f);
    addLocalBox(ci, false, gb.pos, rootQ, 0.0f, h * 0.5f, 0.0f, cw, std::max(0.2f, h - 0.06f), cd, idQ, matCore);
    if (chunks[ci].lodBoxes.empty()) {
      addLocalBox(ci, true, gb.pos, rootQ, 0.0f, h * 0.5f, 0.0f, w, h, d, idQ, matPrimary);
    }

    // 4 Corner structural piers
    const float pierSize = (kind == "curtainwall") ? 0.44f : 0.52f;
    const MatBytes& cornerMat = (kind == "curtainwall") ? matFrame : matPrimary;
    for (float sx : {-1.0f, 1.0f}) {
      for (float sz : {-1.0f, 1.0f}) {
        addLocalBox(
          ci, false, gb.pos, rootQ,
          sx * (w * 0.5f - pierSize * 0.45f), h * 0.5f, sz * (d * 0.5f - pierSize * 0.45f),
          pierSize, h, pierSize, idQ, cornerMat
        );
      }
    }

    // Roof cap & parapet rim
    if (gb.roofCap) {
      addLocalBox(ci, false, gb.pos, rootQ, 0.0f, h - 0.14f, 0.0f, w - 0.12f, 0.28f, d - 0.12f, idQ, matSecondary);
      if (base.parapetHeight > 0.1f) {
        const float ph = base.parapetHeight;
        const float pt = 0.34f;
        addLocalBox(ci, false, gb.pos, rootQ, 0.0f, h + ph * 0.5f, d * 0.5f - pt * 0.5f, w, ph, pt, idQ, matPrimary);
        addLocalBox(ci, false, gb.pos, rootQ, 0.0f, h + ph * 0.5f, -d * 0.5f + pt * 0.5f, w, ph, pt, idQ, matPrimary);
        addLocalBox(ci, false, gb.pos, rootQ, -w * 0.5f + pt * 0.5f, h + ph * 0.5f, 0.0f, pt, ph, std::max(0.2f, d - pt * 2.0f), idQ, matPrimary);
        addLocalBox(ci, false, gb.pos, rootQ, w * 0.5f - pt * 0.5f, h + ph * 0.5f, 0.0f, pt, ph, std::max(0.2f, d - pt * 2.0f), idQ, matPrimary);
      }
    }

    const float startY = gb.skipGround ? std::min(h * 0.35f, 3.6f) : 0.0f;
    const float usableH = std::max(2.4f, h - startY);
    const int32_t idealFloors = std::max(1, static_cast<int32_t>(std::round(usableH / base.floorHeight)));
    const int32_t floorCount = std::min(std::max(1, gb.maxFloors), idealFloors);
    const float fh = usableH / static_cast<float>(floorCount);

    struct FaceDef { float span; float depthOffset; float ry; int faceId; };
    const std::array<FaceDef, 4> faces{{
      {std::max(1.2f, w - pierSize * 1.6f), d * 0.5f, 0.0f,        0},
      {std::max(1.2f, w - pierSize * 1.6f), d * 0.5f, kPi,         1},
      {std::max(1.2f, d - pierSize * 1.6f), w * 0.5f, kPi * 0.5f,  2},
      {std::max(1.2f, d - pierSize * 1.6f), w * 0.5f, -kPi * 0.5f, 3},
    }};

    for (const auto& face : faces) {
      const int32_t bays = std::min(std::max(1, gb.maxBays), std::max(1, static_cast<int32_t>(std::round(face.span / base.bayWidth))));
      const float bayW = face.span / static_cast<float>(bays);
      const float cosR = std::cos(face.ry);
      const float sinR = std::sin(face.ry);
      const glm::quat faceQ = glm::angleAxis(face.ry, glm::vec3(0.0f, 1.0f, 0.0f));

      std::string pat = "A";
      if (rhythm == "alternate") pat = "AB";
      else if (rhythm == "group") pat = "AAB";

      auto emitFace = [&](const MatBytes& m, float lx, float lyCenter, float lzOut, float bw, float bh, float bd) {
        const float lz = face.depthOffset + lzOut;
        const float wx = lx * cosR + lz * sinR;
        const float wz = -lx * sinR + lz * cosR;
        addLocalBox(ci, false, gb.pos, rootQ, wx, lyCenter, wz, bw, bh, bd, faceQ, m);
      };

      for (int32_t fl = 0; fl < floorCount; ++fl) {
        const float fy0 = startY + static_cast<float>(fl) * fh;
        const bool isGround = (fl == 0 && !gb.skipGround && storefront && h >= 6.5f);

        for (int32_t bi = 0; bi < bays; ++bi) {
          const float bx = -face.span * 0.5f + (static_cast<float>(bi) + 0.5f) * bayW;
          const char patCh = pat[static_cast<size_t>(bi) % pat.size()];
          const std::string cellKey = std::to_string(face.faceId) + "." + std::to_string(fl) + "." + std::to_string(bi);
          const float cellRand = mulberrySample(hashSeed(gb.seed, cellKey));
          const MatBytes& glassMat = (cellRand < 0.34f) ? matGlassLit : matGlassDay;

          if (isGround) {
            const float ft = 0.24f;
            const float headH = std::min(0.65f, fh * 0.18f);
            const float sillH = 0.28f;
            emitFace(matFrame, bx, fy0 + sillH * 0.5f, -0.06f, bayW, sillH, 0.22f);
            emitFace(matPrimary, bx, fy0 + fh - headH * 0.5f, -0.08f, bayW, headH, 0.28f);
            emitFace(matFrame, bx - bayW * 0.5f + ft * 0.5f, fy0 + fh * 0.5f, -0.05f, ft, fh, 0.22f);
            emitFace(matFrame, bx + bayW * 0.5f - ft * 0.5f, fy0 + fh * 0.5f, -0.05f, ft, fh, 0.22f);
            emitFace(glassMat, bx, fy0 + sillH + (fh - sillH - headH) * 0.5f, -0.15f, std::max(0.2f, bayW - ft * 2.0f), std::max(0.2f, fh - sillH - headH), 0.06f);
            continue;
          }

          if (kind == "curtainwall") {
            const float spandrelH = fh * (1.0f - base.windowRatio);
            const float visionH = fh - spandrelH;
            emitFace(patCh == 'B' ? matPrimary : matSecondary, bx, fy0 + spandrelH * 0.5f, -0.05f, bayW, spandrelH, 0.18f);
            const int32_t divs = std::max(1, base.divisions);
            const float subW = bayW / static_cast<float>(divs);
            for (int32_t di = 0; di < divs; ++di) {
              const float sx = bx - bayW * 0.5f + (static_cast<float>(di) + 0.5f) * subW;
              emitFace(matFrame, sx - subW * 0.5f + 0.045f, fy0 + spandrelH + visionH * 0.5f, -0.02f, 0.09f, visionH, 0.20f);
              if (visionH >= 2.2f) {
                emitFace(matFrame, sx, fy0 + spandrelH + visionH * 0.65f, -0.03f, subW, 0.07f, 0.18f);
              }
              const float subR = mulberrySample(hashSeed(gb.seed, cellKey + "." + std::to_string(di)));
              emitFace(subR < 0.32f ? matGlassLit : matGlassDay, sx, fy0 + spandrelH + visionH * 0.5f, -0.13f, std::max(0.2f, subW - 0.12f), visionH, 0.05f);
            }
          } else if (kind == "classical") {
            const float pierW = std::max(0.45f, bayW * 0.20f);
            const float winW = std::max(0.6f, bayW - pierW * 2.0f);
            const float sillH = std::max(0.45f, fh * 0.18f);
            const float headH = std::max(0.42f, fh * 0.16f);
            const float winH = std::max(0.6f, fh - sillH - headH);
            const float winCy = fy0 + sillH + winH * 0.5f;
            emitFace(matPrimary, bx, fy0 + sillH * 0.5f, -0.09f, bayW, sillH, 0.30f);
            emitFace(matPrimary, bx, fy0 + fh - headH * 0.5f, -0.07f, bayW, headH, 0.34f);
            emitFace(matPrimary, bx - bayW * 0.5f + pierW * 0.5f, winCy, -0.06f, pierW, winH, 0.34f);
            emitFace(matPrimary, bx + bayW * 0.5f - pierW * 0.5f, winCy, -0.06f, pierW, winH, 0.34f);
            emitFace(matSecondary, bx, fy0 + sillH, 0.04f, winW + 0.28f, 0.14f, 0.26f);
            emitFace(matSecondary, bx, fy0 + fh - headH, 0.03f, winW + 0.26f, 0.14f, 0.22f);
            emitFace(matFrame, bx, winCy, -0.14f, 0.08f, winH, 0.12f);
            emitFace(glassMat, bx, winCy, -0.18f, winW, winH, 0.05f);
          } else {
            const float marginX = std::max(0.28f, bayW * (1.0f - base.windowRatio) * 0.5f);
            const float marginBot = std::max(0.36f, fh * (1.0f - base.windowRatio) * 0.58f);
            const float marginTop = std::max(0.26f, fh * (1.0f - base.windowRatio) * 0.42f);
            const float winW = std::max(0.55f, bayW - marginX * 2.0f);
            const float winH = std::max(0.65f, fh - marginBot - marginTop);
            const float winCy = fy0 + marginBot + winH * 0.5f;
            emitFace(matPrimary, bx, fy0 + marginBot * 0.5f, -0.10f, bayW, marginBot, 0.26f);
            emitFace(matPrimary, bx, fy0 + fh - marginTop * 0.5f, -0.10f, bayW, marginTop, 0.26f);
            emitFace(matPrimary, bx - bayW * 0.5f + marginX * 0.5f, winCy, -0.10f, marginX, winH, 0.26f);
            emitFace(matPrimary, bx + bayW * 0.5f - marginX * 0.5f, winCy, -0.10f, marginX, winH, 0.26f);
            emitFace(matSecondary, bx, fy0 + marginBot - 0.04f, 0.02f, winW + 0.22f, 0.12f, 0.24f);
            emitFace(matFrame, bx, winCy, -0.14f, 0.07f, winH, 0.10f);
            emitFace(glassMat, bx, winCy, -0.17f, winW, winH, 0.05f);
            if (kind == "louver") {
              const int32_t lc = std::max(2, base.louversPerFloor);
              const float stepL = winH / static_cast<float>(lc);
              for (int32_t li = 0; li < lc; ++li) {
                emitFace(matSecondary, bx, fy0 + marginBot + (static_cast<float>(li) + 0.6f) * stepL, 0.06f, winW + 0.04f, 0.07f, 0.30f);
              }
            }
          }
        }
      }
    }
  }

  // 2. Expand CityBuildingKit reliefs, storefronts & rooftop assemblies
  const MatBytes darkSteel    = hexMat(0x252b33, 0.42f, 0.76f, 6);
  const MatBytes stoneBase    = hexMat(0x747678, 0.86f, 0.05f, 4);
  const MatBytes concreteWalk = hexMat(0xc0beb8, 0.86f, 0.04f, 2);
  const MatBytes glassPane    = hexMat(0x243b52, 0.08f, 0.82f, 8);
  const MatBytes hvacMetal    = hexMat(0x9aa2ac, 0.45f, 0.62f, 6);
  const MatBytes fenceWood    = hexMat(0x7e5a3c, 0.84f, 0.04f, 5);
  const MatBytes brassMat     = hexMat(0xd4a64a, 0.26f, 0.88f, 6);
  const MatBytes warmGlow     = hexMat(0xfff0c8, 0.20f, 0.10f, 0, 2.2f);
  const MatBytes beaconRed    = hexMat(0xff3b30, 0.25f, 0.10f, 0, 2.8f);
  const MatBytes shrubMat     = hexMat(0x3a6e34, 0.88f, 0.02f, 7);

  for (const auto& kd : kitDetails) {
    const size_t ci = chunkIndexAt(kd.pos.x, kd.pos.z);
    const glm::quat rootQ = glm::angleAxis(kd.yaw, glm::vec3(0.0f, 1.0f, 0.0f));
    const float w = kd.w;
    const float h = kd.h;
    const float d = kd.d;

    if (kd.kind == "relief" && h >= 8.0f) {
      const int32_t colsW = w >= 18.0f ? 4 : (w >= 12.0f ? 3 : 2);
      for (int32_t i = 0; i <= colsW; ++i) {
        const float px = -w * 0.5f + (static_cast<float>(i) / static_cast<float>(colsW)) * w;
        addLocalBox(ci, false, kd.pos, rootQ, px, h * 0.5f, -d * 0.5f - 0.08f, 0.32f, h, 0.22f, idQ, darkSteel);
        addLocalBox(ci, false, kd.pos, rootQ, px, h * 0.5f,  d * 0.5f + 0.08f, 0.32f, h, 0.22f, idQ, darkSteel);
      }
      const float bandStep = std::max(7.2f, h / 5.0f);
      for (float by = bandStep; by < h - 1.5f; by += bandStep) {
        addLocalBox(ci, false, kd.pos, rootQ, 0.0f, by, 0.0f, w + 0.45f, 0.36f, d + 0.45f, idQ, stoneBase);
      }
      if (kd.balconies && w >= 9.0f && h >= 10.0f && h <= 30.0f) {
        const float floorStep = std::max(5.2f, h / 4.0f);
        const float bw = std::min(3.4f, w * 0.32f);
        const float bd = 1.15f;
        for (float fy = 4.6f; fy < h - 2.2f; fy += floorStep) {
          for (float bx : (w >= 14.0f ? std::vector<float>{-w * 0.25f, w * 0.25f} : std::vector<float>{0.0f})) {
            addLocalBox(ci, false, kd.pos, rootQ, bx, fy, d * 0.5f + bd * 0.5f, bw, 0.16f, bd, idQ, concreteWalk);
            addLocalBox(ci, false, kd.pos, rootQ, bx, fy + 0.92f, d * 0.5f + bd - 0.04f, bw, 0.07f, 0.08f, idQ, darkSteel);
            addLocalBox(ci, false, kd.pos, rootQ, bx, fy + 0.48f, d * 0.5f + bd - 0.04f, bw - 0.10f, 0.78f, 0.05f, idQ, glassPane);
          }
          if (d >= 10.0f) {
            addLocalBox(ci, false, kd.pos, rootQ, w * 0.5f + 0.55f, fy, 0.0f, 1.10f, 0.12f, 2.60f, idQ, darkSteel);
            addLocalBox(ci, false, kd.pos, rootQ, w * 0.5f + 1.08f, fy + 0.45f, 0.0f, 0.06f, 0.85f, 2.60f, idQ, darkSteel);
          }
        }
      }
    } else if (kd.kind == "storefront") {
      const MatBytes awningMat = hexMat(kd.awningColor != 0 ? kd.awningColor : 0x1e40af, 0.84f, 0.04f, 0);
      addLocalBox(ci, false, kd.pos, rootQ, 0.0f, 3.25f, d * 0.5f + 0.08f, w + 0.36f, 0.34f, 0.42f, idQ, darkSteel);
      addLocalBox(ci, false, kd.pos, rootQ, 0.0f, 0.22f, d * 0.5f + 0.06f, w + 0.22f, 0.44f, 0.18f, idQ, stoneBase);
      addLocalBox(ci, false, kd.pos, rootQ, 0.0f, 1.24f, d * 0.5f + 0.12f, 2.15f, 2.45f, 0.16f, idQ, darkSteel);
      addLocalBox(ci, false, kd.pos, rootQ, 0.0f, 1.24f, d * 0.5f + 0.13f, 1.90f, 2.25f, 0.18f, idQ, glassPane);
      addLocalBox(ci, false, kd.pos, rootQ, -0.45f, 1.05f, d * 0.5f + 0.16f, 0.68f, 0.06f, 0.24f, idQ, brassMat);
      addLocalBox(ci, false, kd.pos, rootQ,  0.45f, 1.05f, d * 0.5f + 0.16f, 0.68f, 0.06f, 0.24f, idQ, brassMat);
      const glm::quat awningTilt = glm::angleAxis(0.28f, glm::vec3(1.0f, 0.0f, 0.0f));
      addLocalBox(ci, false, kd.pos, rootQ, 0.0f, 3.05f, d * 0.5f + 0.82f, w * 0.78f, 0.22f, 1.55f, awningTilt, awningMat);
      if (w >= 9.0f) {
        for (float px : {-w * 0.38f, -1.65f}) {
          addLocalBox(ci, false, kd.pos, rootQ, px, 0.24f, d * 0.5f + 0.85f, 0.75f, 0.48f, 0.75f, idQ, stoneBase);
          addLocalBox(ci, false, kd.pos, rootQ, px, 0.64f, d * 0.5f + 0.85f, 0.62f, 0.44f, 0.62f, idQ, shrubMat);
        }
        addLocalBox(ci, false, kd.pos, rootQ, 0.0f, 2.85f, d * 0.5f + 0.05f, w * 0.84f, 0.32f, 0.06f, idQ, warmGlow);
        addLocalBox(ci, false, kd.pos, rootQ, -w * 0.42f, 3.25f, d * 0.5f + 0.74f, 0.12f, 0.68f, 0.82f, idQ, warmGlow);
      }
    } else if (kd.kind == "rooftop") {
      const float pt = 0.35f;
      const float ph = 0.68f;
      addLocalBox(ci, false, kd.pos, rootQ, 0.0f, ph * 0.5f,  d * 0.5f, w + 0.30f, ph, pt, idQ, stoneBase);
      addLocalBox(ci, false, kd.pos, rootQ, 0.0f, ph * 0.5f, -d * 0.5f, w + 0.30f, ph, pt, idQ, stoneBase);
      addLocalBox(ci, false, kd.pos, rootQ, -w * 0.5f, ph * 0.5f, 0.0f, pt, ph, d + 0.30f, idQ, stoneBase);
      addLocalBox(ci, false, kd.pos, rootQ,  w * 0.5f, ph * 0.5f, 0.0f, pt, ph, d + 0.30f, idQ, stoneBase);
      const float pw = std::min(6.2f, w * 0.36f);
      const float pd = std::min(5.2f, d * 0.32f);
      const float ph2 = kd.tall ? 3.2f : 2.1f;
      addLocalBox(ci, false, kd.pos, rootQ, -w * 0.14f, ph2 * 0.5f, -d * 0.12f, pw, ph2, pd, idQ, hvacMetal);
      addLocalBox(ci, false, kd.pos, rootQ, -w * 0.14f, ph2 + 0.10f, -d * 0.12f, pw + 0.30f, 0.22f, pd + 0.30f, idQ, darkSteel);
      addLocalBox(ci, false, kd.pos, rootQ, -w * 0.14f + pw * 0.5f + 1.15f, 1.175f, -d * 0.12f, 2.10f, 2.35f, 2.20f, idQ, stoneBase);
      if (w >= 8.0f && d >= 8.0f) {
        addLocalBox(ci, false, kd.pos, rootQ, w * 0.22f, 0.525f,  d * 0.16f, 2.10f, 1.05f, 1.45f, idQ, hvacMetal);
        addLocalBox(ci, false, kd.pos, rootQ, w * 0.22f, 0.525f, -d * 0.14f, 2.10f, 1.05f, 1.45f, idQ, hvacMetal);
      }
      if (kd.waterTower && w >= 9.0f) {
        const float wx = -w * 0.26f;
        const float wz = d * 0.20f;
        for (float lx : {-0.65f, 0.65f}) {
          for (float lz : {-0.65f, 0.65f}) {
            addLocalBox(ci, false, kd.pos, rootQ, wx + lx, 0.95f, wz + lz, 0.14f, 1.90f, 0.14f, idQ, darkSteel);
          }
        }
        addLocalBox(ci, false, kd.pos, rootQ, wx, 2.90f, wz, 1.85f, 2.20f, 1.85f, idQ, fenceWood);
        addLocalBox(ci, false, kd.pos, rootQ, wx, 4.25f, wz, 2.05f, 0.55f, 2.05f, idQ, darkSteel);
      }
      if (kd.tall) {
        addLocalBox(ci, false, kd.pos, rootQ, -w * 0.14f, ph2 + 4.8f, -d * 0.12f, 0.22f, 9.50f, 0.22f, idQ, darkSteel);
        addLocalBox(ci, false, kd.pos, rootQ, -w * 0.14f, ph2 + 9.65f, -d * 0.12f, 0.48f, 0.48f, 0.48f, idQ, beaconRed);
      }
      if (kd.billboard && w >= 12.0f) {
        const float bw = std::min(8.5f, w * 0.62f);
        const float bz = d * 0.34f;
        addLocalBox(ci, false, kd.pos, rootQ, -bw * 0.34f, 1.40f, bz, 0.18f, 2.80f, 0.18f, idQ, darkSteel);
        addLocalBox(ci, false, kd.pos, rootQ,  bw * 0.34f, 1.40f, bz, 0.18f, 2.80f, 0.18f, idQ, darkSteel);
        addLocalBox(ci, false, kd.pos, rootQ, 0.0f, 3.35f, bz, bw + 0.30f, 3.10f, 0.22f, idQ, darkSteel);
        addLocalBox(ci, false, kd.pos, rootQ, 0.0f, 3.35f, bz, bw - 0.10f, 2.70f, 0.28f, idQ, warmGlow);
      }
    }
  }
}

bool WorldData::loadFromDirectory(const std::string& worldDir, std::string* err) {
  const std::string jsonPath = worldDir + "/westgate_world.json";
  const std::string hfPath = worldDir + "/westgate_heightfield.bin";
  const std::string meshBinPath = worldDir + "/westgate_meshes.bin";

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
      float minY = -12.0f;
      float maxY = 24.0f;
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

  glbPlacements.clear();
  if (j.contains("glbPlacements")) {
    for (const auto& g : j["glbPlacements"]) {
      GlbPlacementData gp;
      gp.file = g.value("file", "");
      gp.pos = glm::vec3(g.value("x", 0.0f), g.value("y", 0.0f), g.value("z", 0.0f));
      gp.yaw = g.value("yaw", 0.0f);
      gp.yawOffset = g.value("yawOffset", 0.0f);
      const std::string ax = g.value("axis", "y");
      gp.axis = ax.empty() ? 'y' : ax[0];
      gp.targetMeters = g.value("targetMeters", 1.0f);
      gp.baseY = g.value("baseY", 0.0f);
      if (g.contains("fit") && g["fit"].is_array() && g["fit"].size() >= 3) {
        gp.hasFitFootprint = true;
        gp.fitMaxWdh = glm::vec3(g["fit"][0].get<float>(), g["fit"][1].get<float>(), g["fit"][2].get<float>());
      }
      if (!gp.file.empty()) glbPlacements.push_back(std::move(gp));
    }
  }

  grammarBuildings.clear();
  if (j.contains("grammarBuildings")) {
    for (const auto& gb : j["grammarBuildings"]) {
      GrammarBuildingSpec sp;
      sp.pos = glm::vec3(gb.value("x", 0.0f), gb.value("y", 0.0f), gb.value("z", 0.0f));
      sp.yaw = gb.value("yaw", 0.0f);
      sp.w = gb.value("w", 16.0f);
      sp.h = gb.value("h", 24.0f);
      sp.d = gb.value("d", 16.0f);
      sp.style = gb.value("style", "concrete_mod");
      sp.kindOverride = gb.value("kind", "");
      sp.storefrontOverride = gb.value("storefront", -1);
      sp.rhythmOverride = gb.value("rhythm", "");
      sp.skipGround = gb.value("skipGround", 0) != 0;
      sp.roofCap = gb.value("roofCap", 1) != 0;
      sp.maxFloors = gb.value("maxFloors", 14);
      sp.maxBays = gb.value("maxBays", 9);
      sp.seed = gb.value("seed", 0u);
      grammarBuildings.push_back(std::move(sp));
    }
  }

  kitDetails.clear();
  if (j.contains("kitDetails")) {
    for (const auto& kd : j["kitDetails"]) {
      KitDetailSpec ks;
      ks.kind = kd.value("kind", "relief");
      ks.pos = glm::vec3(kd.value("x", 0.0f), kd.value("y", 0.0f), kd.value("z", 0.0f));
      ks.yaw = kd.value("yaw", 0.0f);
      ks.w = kd.value("w", 12.0f);
      ks.h = kd.value("h", 12.0f);
      ks.d = kd.value("d", 12.0f);
      ks.balconies = kd.value("balconies", 0) != 0;
      ks.tall = kd.value("tall", 0) != 0;
      ks.waterTower = kd.value("waterTower", 0) != 0;
      ks.billboard = kd.value("billboard", 0) != 0;
      ks.awningColor = kd.value("awningColor", 0x1e40afu);
      kitDetails.push_back(std::move(ks));
    }
  }

  loadMeshPack(meshBinPath);
  expandProceduralArchitecture();

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
