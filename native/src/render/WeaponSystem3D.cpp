#include "westgate/WeaponSystem3D.hpp"
#include <algorithm>
#include <cmath>
#include <glm/gtc/constants.hpp>
#include <glm/gtc/matrix_transform.hpp>

namespace westgate {

namespace {

constexpr float kPi = 3.14159265358979323846f;
constexpr float kTwoPi = 6.28318530717958647692f;

uint32_t hash2dWrap(int x, int y, int period, uint32_t seed) {
  const uint32_t ux = static_cast<uint32_t>(((x % period) + period) % period);
  const uint32_t uy = static_cast<uint32_t>(((y % period) + period) % period);
  uint32_t h = ux * 374761393u + uy * 668265263u + seed * 2246822519u;
  h = (h ^ (h >> 13u)) * 1274126177u;
  return h ^ (h >> 16u);
}

float hash01Wrap(int x, int y, int period, uint32_t seed) {
  return static_cast<float>(hash2dWrap(x, y, period, seed) & 0xFFFFu) * (1.0f / 65535.0f);
}

float valueNoiseWrap(float fx, float fy, int period, uint32_t seed) {
  const int x0 = static_cast<int>(std::floor(fx));
  const int y0 = static_cast<int>(std::floor(fy));
  const float tx = fx - static_cast<float>(x0);
  const float ty = fy - static_cast<float>(y0);
  const float sx = tx * tx * (3.0f - 2.0f * tx);
  const float sy = ty * ty * (3.0f - 2.0f * ty);
  const float n00 = hash01Wrap(x0, y0, period, seed);
  const float n10 = hash01Wrap(x0 + 1, y0, period, seed);
  const float n01 = hash01Wrap(x0, y0 + 1, period, seed);
  const float n11 = hash01Wrap(x0 + 1, y0 + 1, period, seed);
  const float nx0 = n00 + (n10 - n00) * sx;
  const float nx1 = n01 + (n11 - n01) * sx;
  return nx0 + (nx1 - nx0) * sy;
}

uint8_t toByte(float v01) {
  return static_cast<uint8_t>(std::clamp(std::round(v01 * 255.0f), 0.0f, 255.0f));
}

struct MeshBuilder {
  WeaponPartCpuMesh* dst = nullptr;

  void emitTri(const WeaponPartVertex& a, const WeaponPartVertex& b, const WeaponPartVertex& c) {
    const uint32_t base = static_cast<uint32_t>(dst->vertices.size());
    dst->vertices.push_back(a);
    dst->vertices.push_back(b);
    dst->vertices.push_back(c);
    dst->indices.push_back(base);
    dst->indices.push_back(base + 1);
    dst->indices.push_back(base + 2);
  }

  void emitQuad(
    const glm::vec3& p0,
    const glm::vec3& p1,
    const glm::vec3& p2,
    const glm::vec3& p3,
    const glm::vec3& n0,
    const glm::vec3& n1,
    const glm::vec3& n2,
    const glm::vec3& n3,
    const glm::vec2& uv0,
    const glm::vec2& uv1,
    const glm::vec2& uv2,
    const glm::vec2& uv3,
    float shade = 1.0f
  ) {
    const auto mk = [&](const glm::vec3& p, const glm::vec3& n, const glm::vec2& uv) {
      const glm::vec3 nn = glm::length(n) > 1e-5f ? glm::normalize(n) : glm::vec3(0.0f, 1.0f, 0.0f);
      return WeaponPartVertex{p.x, p.y, p.z, nn.x, nn.y, nn.z, uv.x, uv.y, shade, shade, shade, 1.0f, 1.0f};
    };
    const WeaponPartVertex v0 = mk(p0, n0, uv0);
    const WeaponPartVertex v1 = mk(p1, n1, uv1);
    const WeaponPartVertex v2 = mk(p2, n2, uv2);
    const WeaponPartVertex v3 = mk(p3, n3, uv3);
    emitTri(v0, v1, v2);
    emitTri(v0, v2, v3);
  }

  // Smooth chamfered rounded box with soft bevel normals & clean triplanar UVs
  void addChamferBox(
    const glm::vec3& center,
    const glm::vec3& size,
    float bevel,
    float rotXRad = 0.0f,
    float uvDensity = 14.0f,
    float shade = 1.0f
  ) {
    const glm::vec3 h = glm::max(size * 0.5f, glm::vec3(0.0005f));
    const float b = std::min({bevel, h.x * 0.42f, h.y * 0.42f, h.z * 0.42f});
    const glm::mat3 rotM = (std::abs(rotXRad) > 1e-5f)
      ? glm::mat3(glm::rotate(glm::mat4(1.0f), rotXRad, glm::vec3(1.0f, 0.0f, 0.0f)))
      : glm::mat3(1.0f);

    // 4-ring profile along Z (-h.z, -h.z+b, +h.z-b, +h.z) with 8-vertex octagon cross-section in XY
    auto ringVert = [&](float zVal, float shrinkXY, int idx8, glm::vec3& outLocalN) -> glm::vec3 {
      const float hx = std::max(0.0003f, h.x - shrinkXY);
      const float hy = std::max(0.0003f, h.y - shrinkXY);
      const float ix = std::max(0.0002f, hx - b * 0.85f);
      const float iy = std::max(0.0002f, hy - b * 0.85f);
      glm::vec2 p2(0.0f);
      glm::vec2 n2(0.0f);
      switch (idx8 & 7) {
        case 0: p2 = { ix,  hy}; n2 = { 0.28f,  0.96f}; break;
        case 1: p2 = { hx,  iy}; n2 = { 0.96f,  0.28f}; break;
        case 2: p2 = { hx, -iy}; n2 = { 0.96f, -0.28f}; break;
        case 3: p2 = { ix, -hy}; n2 = { 0.28f, -0.96f}; break;
        case 4: p2 = {-ix, -hy}; n2 = {-0.28f, -0.96f}; break;
        case 5: p2 = {-hx, -iy}; n2 = {-0.96f, -0.28f}; break;
        case 6: p2 = {-hx,  iy}; n2 = {-0.96f,  0.28f}; break;
        default:p2 = {-ix,  hy}; n2 = {-0.28f,  0.96f}; break;
      }
      const float nz = (zVal > h.z - b * 0.5f) ? 0.55f : ((zVal < -h.z + b * 0.5f) ? -0.55f : 0.0f);
      outLocalN = glm::normalize(glm::vec3(n2.x, n2.y, nz));
      return glm::vec3(p2.x, p2.y, zVal);
    };

    const float zRings[4] = {-h.z, -h.z + b, h.z - b, h.z};
    const float shrink[4] = {b * 0.72f, 0.0f, 0.0f, b * 0.72f};

    for (int rz = 0; rz < 3; ++rz) {
      for (int i = 0; i < 8; ++i) {
        const int ni = (i + 1) & 7;
        glm::vec3 n00, n10, n11, n01;
        const glm::vec3 l00 = ringVert(zRings[rz], shrink[rz], i, n00);
        const glm::vec3 l10 = ringVert(zRings[rz], shrink[rz], ni, n10);
        const glm::vec3 l11 = ringVert(zRings[rz + 1], shrink[rz + 1], ni, n11);
        const glm::vec3 l01 = ringVert(zRings[rz + 1], shrink[rz + 1], i, n01);

        const glm::vec3 p00 = center + rotM * l00;
        const glm::vec3 p10 = center + rotM * l10;
        const glm::vec3 p11 = center + rotM * l11;
        const glm::vec3 p01 = center + rotM * l01;

        const float u0 = static_cast<float>(i) * 0.25f * (h.x + h.y) * uvDensity;
        const float u1 = static_cast<float>(i + 1) * 0.25f * (h.x + h.y) * uvDensity;
        const float v0 = (zRings[rz] + h.z) * uvDensity;
        const float v1 = (zRings[rz + 1] + h.z) * uvDensity;

        // Outward winding around +Z axis (clockwise index order when viewed from +Z -> p00, p01, p11, p10)
        emitQuad(
          p00, p01, p11, p10,
          rotM * n00, rotM * n01, rotM * n11, rotM * n10,
          {v0, u0}, {v1, u0}, {v1, u1}, {v0, u1},
          shade
        );
      }
    }

    // Back cap (-Z) and Front cap (+Z)
    for (int cap = 0; cap < 2; ++cap) {
      const float zc = (cap == 0) ? zRings[0] : zRings[3];
      const float sh = shrink[cap == 0 ? 0 : 3];
      const glm::vec3 capN = rotM * glm::vec3(0.0f, 0.0f, cap == 0 ? -1.0f : 1.0f);
      const glm::vec3 cPos = center + rotM * glm::vec3(0.0f, 0.0f, zc);
      const WeaponPartVertex vc{cPos.x, cPos.y, cPos.z, capN.x, capN.y, capN.z, 0.5f, 0.5f, shade, shade, shade, 1.0f, 1.0f};
      for (int i = 0; i < 8; ++i) {
        const int ni = (i + 1) & 7;
        glm::vec3 d0, d1;
        const glm::vec3 l0 = ringVert(zc, sh, i, d0);
        const glm::vec3 l1 = ringVert(zc, sh, ni, d1);
        const glm::vec3 p0 = center + rotM * l0;
        const glm::vec3 p1 = center + rotM * l1;
        const WeaponPartVertex v0{p0.x, p0.y, p0.z, capN.x, capN.y, capN.z, l0.x * uvDensity, l0.y * uvDensity, shade, shade, shade, 1.0f, 1.0f};
        const WeaponPartVertex v1{p1.x, p1.y, p1.z, capN.x, capN.y, capN.z, l1.x * uvDensity, l1.y * uvDensity, shade, shade, shade, 1.0f, 1.0f};
        if (cap == 0) {
          emitTri(vc, v0, v1);
        } else {
          emitTri(vc, v1, v0);
        }
      }
    }
  }

  // Smooth cylinder / frustum aligned along +Z (barrel/suppressor/scope axis)
  void addCylinderZ(
    const glm::vec3& center,
    float rBack,
    float rFront,
    float length,
    int segs = 20,
    bool capEnds = true,
    float uvDensity = 16.0f,
    float shade = 1.0f
  ) {
    const float hz = length * 0.5f;
    const float slopeY = (rBack - rFront) / std::max(1e-4f, length);
    for (int i = 0; i < segs; ++i) {
      const float a0 = (static_cast<float>(i) / static_cast<float>(segs)) * kTwoPi;
      const float a1 = (static_cast<float>(i + 1) / static_cast<float>(segs)) * kTwoPi;
      const float c0 = std::cos(a0), s0 = std::sin(a0);
      const float c1 = std::cos(a1), s1 = std::sin(a1);

      const glm::vec3 p00 = center + glm::vec3(c0 * rBack, s0 * rBack, -hz);
      const glm::vec3 p01 = center + glm::vec3(c0 * rFront, s0 * rFront, hz);
      const glm::vec3 p11 = center + glm::vec3(c1 * rFront, s1 * rFront, hz);
      const glm::vec3 p10 = center + glm::vec3(c1 * rBack, s1 * rBack, -hz);

      const glm::vec3 n0 = glm::normalize(glm::vec3(c0, s0, slopeY));
      const glm::vec3 n1 = glm::normalize(glm::vec3(c1, s1, slopeY));

      const float u0 = (static_cast<float>(i) / static_cast<float>(segs)) * (kTwoPi * std::max(rBack, rFront) * uvDensity);
      const float u1 = (static_cast<float>(i + 1) / static_cast<float>(segs)) * (kTwoPi * std::max(rBack, rFront) * uvDensity);
      const float v0 = 0.0f;
      const float v1 = length * uvDensity;

      emitQuad(p00, p10, p11, p01, n0, n1, n1, n0, {v0, u0}, {v0, u1}, {v1, u1}, {v1, u0}, shade);

      if (capEnds) {
        if (rBack > 1e-5f) {
          const glm::vec3 cb = center + glm::vec3(0.0f, 0.0f, -hz);
          const WeaponPartVertex vc{cb.x, cb.y, cb.z, 0.0f, 0.0f, -1.0f, 0.5f, 0.5f, shade * 0.92f, shade * 0.92f, shade * 0.92f, 1.0f, 1.0f};
          const WeaponPartVertex v0b{p00.x, p00.y, p00.z, 0.0f, 0.0f, -1.0f, 0.5f + c0 * 0.45f, 0.5f + s0 * 0.45f, shade, shade, shade, 1.0f, 1.0f};
          const WeaponPartVertex v1b{p10.x, p10.y, p10.z, 0.0f, 0.0f, -1.0f, 0.5f + c1 * 0.45f, 0.5f + s1 * 0.45f, shade, shade, shade, 1.0f, 1.0f};
          emitTri(vc, v1b, v0b);
        }
        if (rFront > 1e-5f) {
          const glm::vec3 cf = center + glm::vec3(0.0f, 0.0f, hz);
          const WeaponPartVertex vc{cf.x, cf.y, cf.z, 0.0f, 0.0f, 1.0f, 0.5f, 0.5f, shade * 0.92f, shade * 0.92f, shade * 0.92f, 1.0f, 1.0f};
          const WeaponPartVertex v0f{p01.x, p01.y, p01.z, 0.0f, 0.0f, 1.0f, 0.5f + c0 * 0.45f, 0.5f + s0 * 0.45f, shade, shade, shade, 1.0f, 1.0f};
          const WeaponPartVertex v1f{p11.x, p11.y, p11.z, 0.0f, 0.0f, 1.0f, 0.5f + c1 * 0.45f, 0.5f + s1 * 0.45f, shade, shade, shade, 1.0f, 1.0f};
          emitTri(vc, v0f, v1f);
        }
      }
    }
  }

  // Smooth cylinder aligned along +Y (vertical grips, scope turrets)
  void addCylinderY(
    const glm::vec3& center,
    float rBot,
    float rTop,
    float height,
    int segs = 18,
    float uvDensity = 16.0f,
    float shade = 1.0f
  ) {
    const float hy = height * 0.5f;
    for (int i = 0; i < segs; ++i) {
      const float a0 = (static_cast<float>(i) / static_cast<float>(segs)) * kTwoPi;
      const float a1 = (static_cast<float>(i + 1) / static_cast<float>(segs)) * kTwoPi;
      const float c0 = std::cos(a0), s0 = std::sin(a0);
      const float c1 = std::cos(a1), s1 = std::sin(a1);

      const glm::vec3 p00 = center + glm::vec3(c0 * rBot, -hy, s0 * rBot);
      const glm::vec3 p01 = center + glm::vec3(c0 * rTop, hy, s0 * rTop);
      const glm::vec3 p11 = center + glm::vec3(c1 * rTop, hy, s1 * rTop);
      const glm::vec3 p10 = center + glm::vec3(c1 * rBot, -hy, s1 * rBot);

      const glm::vec3 n0 = glm::normalize(glm::vec3(c0, 0.0f, s0));
      const glm::vec3 n1 = glm::normalize(glm::vec3(c1, 0.0f, s1));

      const float u0 = (static_cast<float>(i) / static_cast<float>(segs)) * (kTwoPi * std::max(rBot, rTop) * uvDensity);
      const float u1 = (static_cast<float>(i + 1) / static_cast<float>(segs)) * (kTwoPi * std::max(rBot, rTop) * uvDensity);
      emitQuad(p00, p01, p11, p10, n0, n0, n1, n1, {u0, 0.0f}, {u0, height * uvDensity}, {u1, height * uvDensity}, {u1, 0.0f}, shade);

      const glm::vec3 cb = center + glm::vec3(0.0f, -hy, 0.0f);
      const glm::vec3 ct = center + glm::vec3(0.0f, hy, 0.0f);
      emitTri(
        {cb.x, cb.y, cb.z, 0.0f, -1.0f, 0.0f, 0.5f, 0.5f, shade, shade, shade, 1.0f, 1.0f},
        {p00.x, p00.y, p00.z, 0.0f, -1.0f, 0.0f, 0.5f + c0 * 0.4f, 0.5f + s0 * 0.4f, shade, shade, shade, 1.0f, 1.0f},
        {p10.x, p10.y, p10.z, 0.0f, -1.0f, 0.0f, 0.5f + c1 * 0.4f, 0.5f + s1 * 0.4f, shade, shade, shade, 1.0f, 1.0f}
      );
      emitTri(
        {ct.x, ct.y, ct.z, 0.0f, 1.0f, 0.0f, 0.5f, 0.5f, shade, shade, shade, 1.0f, 1.0f},
        {p11.x, p11.y, p11.z, 0.0f, 1.0f, 0.0f, 0.5f + c1 * 0.4f, 0.5f + s1 * 0.4f, shade, shade, shade, 1.0f, 1.0f},
        {p01.x, p01.y, p01.z, 0.0f, 1.0f, 0.0f, 0.5f + c0 * 0.4f, 0.5f + s0 * 0.4f, shade, shade, shade, 1.0f, 1.0f}
      );
    }
  }

  // Torus bezel ring in XY plane facing +Z
  void addRingZ(
    const glm::vec3& center,
    float majorR,
    float tubeR,
    int segs = 20,
    int tubeSegs = 8,
    float shade = 1.0f
  ) {
    for (int i = 0; i < segs; ++i) {
      const float u0 = (static_cast<float>(i) / static_cast<float>(segs)) * kTwoPi;
      const float u1 = (static_cast<float>(i + 1) / static_cast<float>(segs)) * kTwoPi;
      const float cu0 = std::cos(u0), su0 = std::sin(u0);
      const float cu1 = std::cos(u1), su1 = std::sin(u1);
      for (int j = 0; j < tubeSegs; ++j) {
        const float v0 = (static_cast<float>(j) / static_cast<float>(tubeSegs)) * kTwoPi;
        const float v1 = (static_cast<float>(j + 1) / static_cast<float>(tubeSegs)) * kTwoPi;
        auto pt = [&](float cu, float su, float v, glm::vec3& outN) {
          const float cv = std::cos(v), sv = std::sin(v);
          outN = glm::normalize(glm::vec3(cu * cv, su * cv, sv));
          return center + glm::vec3((majorR + tubeR * cv) * cu, (majorR + tubeR * cv) * su, tubeR * sv);
        };
        glm::vec3 n00, n10, n11, n01;
        const glm::vec3 p00 = pt(cu0, su0, v0, n00);
        const glm::vec3 p10 = pt(cu1, su1, v0, n10);
        const glm::vec3 p11 = pt(cu1, su1, v1, n11);
        const glm::vec3 p01 = pt(cu0, su0, v1, n01);
        emitQuad(p00, p10, p11, p01, n00, n10, n11, n01, {u0, v0}, {u1, v0}, {u1, v1}, {u0, v1}, shade);
      }
    }
  }

  void addPicatinnyRail(float yBase, float zStart, float zEnd, float width = 0.021f) {
    const float len = zEnd - zStart;
    if (len <= 0.005f) return;
    addChamferBox({0.0f, yBase, (zStart + zEnd) * 0.5f}, {width, 0.006f, len}, 0.0012f, 0.0f, 18.0f, 0.92f);
    const int teeth = std::max(2, static_cast<int>(std::floor(len / 0.0115f)));
    for (int i = 0; i < teeth; ++i) {
      const float z = zStart + 0.006f + static_cast<float>(i) * 0.0115f;
      if (z > zEnd - 0.004f) break;
      addChamferBox({0.0f, yBase + 0.0042f, z}, {width + 0.002f, 0.0035f, 0.0055f}, 0.0008f, 0.0f, 20.0f, 1.03f);
    }
  }
};

struct WeaponMountSpec {
  glm::vec3 opticPos{0.0f};
  float opticScale = 1.0f;
  glm::vec3 muzzlePos{0.0f};
  float muzzleScale = 1.0f;
  glm::vec3 underPos{0.0f};
  float underScale = 1.0f;
  glm::vec3 magPos{0.0f};
  glm::vec3 magScale{1.0f};
  bool hasBoxMag = true;
};

WeaponMountSpec mountSpecForWeapon(const std::string& id) {
  WeaponMountSpec s{};
  if (id == "pistol" || id == "pistol_sd") {
    s.opticPos = {0.0f, 0.064f, 0.025f};
    s.opticScale = 0.58f;
    s.muzzlePos = {0.0f, 0.048f, 0.190f};
    s.muzzleScale = 0.72f;
    s.underPos = {0.0f, 0.022f, 0.118f};
    s.underScale = 0.56f;
    s.magPos = {0.0f, -0.068f, -0.008f};
    s.magScale = {0.72f, 0.62f, 0.58f};
    s.hasBoxMag = true;
  } else if (id == "smg") {
    s.opticPos = {0.0f, 0.084f, 0.075f};
    s.opticScale = 0.86f;
    s.muzzlePos = {0.0f, 0.052f, 0.355f};
    s.muzzleScale = 0.88f;
    s.underPos = {0.0f, 0.022f, 0.245f};
    s.underScale = 0.85f;
    s.magPos = {0.0f, -0.055f, 0.125f};
    s.magScale = {0.76f, 0.92f, 0.68f};
    s.hasBoxMag = true;
  } else if (id == "shotgun") {
    s.opticPos = {0.0f, 0.080f, 0.095f};
    s.opticScale = 0.92f;
    s.muzzlePos = {0.0f, 0.056f, 0.640f};
    s.muzzleScale = 0.96f;
    s.underPos = {0.0f, 0.012f, 0.355f};
    s.underScale = 0.92f;
    s.hasBoxMag = false;
  } else if (id == "dmr") {
    s.opticPos = {0.0f, 0.092f, 0.105f};
    s.opticScale = 1.05f;
    s.muzzlePos = {0.0f, 0.056f, 0.715f};
    s.muzzleScale = 1.12f;
    s.underPos = {0.0f, 0.022f, 0.395f};
    s.underScale = 1.0f;
    s.magPos = {0.0f, -0.048f, 0.145f};
    s.magScale = {1.04f, 0.86f, 1.18f};
    s.hasBoxMag = true;
  } else {
    // Default Vanguard M4A1-S Carbine
    s.opticPos = {0.0f, 0.090f, 0.085f};
    s.opticScale = 1.0f;
    s.muzzlePos = {0.0f, 0.055f, 0.555f};
    s.muzzleScale = 1.0f;
    s.underPos = {0.0f, 0.022f, 0.345f};
    s.underScale = 1.0f;
    s.magPos = {0.0f, -0.052f, 0.135f};
    s.magScale = {1.0f, 1.0f, 1.0f};
    s.hasBoxMag = true;
  }
  return s;
}

float opticAxisOffsetLocalY(WeaponOpticKind optic) {
  switch (optic) {
    case WeaponOpticKind::IronSights:  return 0.016f;
    case WeaponOpticKind::RedDot:      return 0.028f;
    case WeaponOpticKind::Holo:        return 0.032f;
    case WeaponOpticKind::Acog:        return 0.030f;
    case WeaponOpticKind::SniperScope: return 0.031f;
  }
  return 0.026f;
}

} // namespace

void WeaponSystem3D::generateProceduralTextures(
  std::array<WeaponPbrTextureSet, kWeaponSurfaceMatCount>& outTextures
) {
  constexpr int W = 256;
  constexpr int H = 256;

  auto bakeFromHeight = [&](
    WeaponPbrTextureSet& dst,
    float normalStrength,
    auto&& evalPixel // (int x, int y, float& outHeight, glm::vec3& outAlbedo, float& outAo, float& outRough, float& outMetal)
  ) {
    dst.width = W;
    dst.height = H;
    dst.albedoRgba.resize(W * H * 4);
    dst.normalRgba.resize(W * H * 4);
    dst.ormRgba.resize(W * H * 4);

    std::vector<float> hMap(W * H, 0.5f);
    for (int y = 0; y < H; ++y) {
      for (int x = 0; x < W; ++x) {
        float h = 0.5f, ao = 1.0f, rough = 1.0f, metal = 1.0f;
        glm::vec3 alb(0.95f);
        evalPixel(x, y, h, alb, ao, rough, metal);
        const size_t idx = static_cast<size_t>(y * W + x);
        hMap[idx] = h;
        dst.albedoRgba[idx * 4 + 0] = toByte(alb.r);
        dst.albedoRgba[idx * 4 + 1] = toByte(alb.g);
        dst.albedoRgba[idx * 4 + 2] = toByte(alb.b);
        dst.albedoRgba[idx * 4 + 3] = 255;

        dst.ormRgba[idx * 4 + 0] = toByte(ao);
        dst.ormRgba[idx * 4 + 1] = toByte(rough);
        dst.ormRgba[idx * 4 + 2] = toByte(metal);
        dst.ormRgba[idx * 4 + 3] = 255;
      }
    }

    for (int y = 0; y < H; ++y) {
      const int ym = (y - 1 + H) % H;
      const int yp = (y + 1) % H;
      for (int x = 0; x < W; ++x) {
        const int xm = (x - 1 + W) % W;
        const int xp = (x + 1) % W;
        const float dx = (hMap[static_cast<size_t>(y * W + xp)] - hMap[static_cast<size_t>(y * W + xm)]) * normalStrength;
        const float dy = (hMap[static_cast<size_t>(yp * W + x)] - hMap[static_cast<size_t>(ym * W + x)]) * normalStrength;
        const glm::vec3 n = glm::normalize(glm::vec3(-dx, -dy, 1.0f));
        const size_t idx = static_cast<size_t>(y * W + x);
        dst.normalRgba[idx * 4 + 0] = toByte(n.x * 0.5f + 0.5f);
        dst.normalRgba[idx * 4 + 1] = toByte(n.y * 0.5f + 0.5f);
        dst.normalRgba[idx * 4 + 2] = toByte(n.z * 0.5f + 0.5f);
        dst.normalRgba[idx * 4 + 3] = 255;
      }
    }
  };

  // 0: Brushed CNC Anodized Billet Receiver & Slide
  bakeFromHeight(
    outTextures[static_cast<size_t>(WeaponSurfaceMat::ReceiverAnodized)],
    2.6f,
    [&](int x, int y, float& h, glm::vec3& alb, float& ao, float& rough, float& metal) {
      const float brushLong = valueNoiseWrap(static_cast<float>(x) * 0.12f, static_cast<float>(y) * 1.85f, 32, 101u);
      const float brushFine = valueNoiseWrap(static_cast<float>(x) * 0.25f, static_cast<float>(y) * 3.7f, 64, 203u);
      const float bead = hash01Wrap(x, y, W, 307u);
      // Subtle micro-wear scratches
      const float diagA = std::sin((static_cast<float>(x) * 0.7f + static_cast<float>(y) * 1.3f) * 0.22f);
      const float scratch = (diagA > 0.985f && valueNoiseWrap(x * 0.08f, y * 0.08f, 16, 409u) > 0.62f) ? 0.16f : 0.0f;

      h = 0.45f + 0.32f * brushLong + 0.16f * brushFine + 0.07f * bead - scratch * 0.35f;
      const float lum = 0.88f + 0.10f * brushLong + 0.04f * bead + scratch * 0.12f;
      alb = glm::vec3(lum, lum * 0.995f, lum * 1.005f);
      ao = 0.90f + 0.10f * brushLong - scratch * 0.08f;
      rough = 0.84f + 0.24f * (1.0f - brushLong) - scratch * 0.28f;
      metal = std::min(1.0f, 0.94f + scratch * 0.06f);
    }
  );

  // 1: Laser-Stippled Tactical Polymer / Cerakote Handguard
  bakeFromHeight(
    outTextures[static_cast<size_t>(WeaponSurfaceMat::TacticalStipple)],
    3.8f,
    [&](int x, int y, float& h, glm::vec3& alb, float& ao, float& rough, float& metal) {
      // Tileable staggered hexagonal dimple lattice (period = 8 px -> 32x32 cells in 256x256)
      const float cellSz = 8.0f;
      const int row = static_cast<int>(std::floor(static_cast<float>(y) / cellSz));
      const float fx = static_cast<float>(x) / cellSz + ((row & 1) ? 0.5f : 0.0f);
      const float fy = static_cast<float>(y) / cellSz;
      const float cx = fx - std::floor(fx) - 0.5f;
      const float cy = fy - std::floor(fy) - 0.5f;
      const float r = std::sqrt(cx * cx + cy * cy);
      const float pit = std::clamp((r - 0.18f) / 0.26f, 0.0f, 1.0f);
      const float micro = hash01Wrap(x, y, W, 521u);

      h = 0.22f + 0.66f * pit + 0.12f * micro;
      const float lum = 0.82f + 0.15f * pit + 0.04f * micro;
      alb = glm::vec3(lum);
      ao = 0.72f + 0.28f * pit;
      rough = 0.92f + 0.08f * (1.0f - pit);
      metal = 0.86f + 0.14f * pit;
    }
  );

  // 2: Lathe-Turned Fluted Steel & Diamond-Knurled Hardware
  bakeFromHeight(
    outTextures[static_cast<size_t>(WeaponSurfaceMat::MachinedBarrel)],
    3.2f,
    [&](int x, int y, float& h, glm::vec3& alb, float& ao, float& rough, float& metal) {
      const float u = static_cast<float>(x) / static_cast<float>(W);
      const float v = static_cast<float>(y) / static_cast<float>(H);
      const float latheRings = 0.5f + 0.5f * std::sin(u * kTwoPi * 48.0f);
      const float knurlA = std::abs(std::sin((u + v) * kTwoPi * 24.0f));
      const float knurlB = std::abs(std::sin((u - v) * kTwoPi * 24.0f));
      const float knurl = knurlA * knurlB;
      const float grain = valueNoiseWrap(x * 0.35f, y * 0.35f, 64, 733u);

      h = 0.32f + 0.38f * latheRings + 0.22f * knurl + 0.08f * grain;
      const float lum = 0.86f + 0.12f * latheRings + 0.04f * knurl;
      alb = glm::vec3(lum * 0.99f, lum, lum * 1.02f);
      ao = 0.82f + 0.18f * h;
      rough = 0.78f + 0.22f * (1.0f - latheRings);
      metal = 0.98f;
    }
  );

  // 3: Multi-Coated Sapphire Reflex/Scope Lens & Reticle
  bakeFromHeight(
    outTextures[static_cast<size_t>(WeaponSurfaceMat::OpticGlass)],
    1.1f,
    [&](int x, int y, float& h, glm::vec3& alb, float& ao, float& rough, float& metal) {
      const float nx = (static_cast<float>(x) / static_cast<float>(W)) * 2.0f - 1.0f;
      const float ny = (static_cast<float>(y) / static_cast<float>(H)) * 2.0f - 1.0f;
      const float r2 = std::min(1.0f, nx * nx + ny * ny);
      h = 0.85f - 0.35f * r2;
      alb = glm::mix(glm::vec3(0.92f, 0.98f, 1.0f), glm::vec3(0.76f, 0.90f, 0.98f), r2);
      ao = 1.0f;
      rough = 0.25f;
      metal = 0.35f;
    }
  );
}

void WeaponSystem3D::generateAllPartMeshes(
  std::array<WeaponPartCpuMesh, kWeaponMeshPartCount>& outMeshes
) {
  for (auto& m : outMeshes) {
    m.vertices.clear();
    m.indices.clear();
  }

  auto initPart = [&](WeaponMeshPartId id, WeaponSurfaceMat mat) -> MeshBuilder {
    auto& m = outMeshes[static_cast<size_t>(id)];
    m.material = mat;
    return MeshBuilder{&m};
  };

  // =========================================================================
  // 1. PISTOL (Apex P226-SD)
  // =========================================================================
  {
    auto b = initPart(WeaponMeshPartId::Pistol_Body, WeaponSurfaceMat::ReceiverAnodized);
    // CNC Slide + forward/rear serrations + ejection port chamfer (right side = -X)
    b.addChamferBox({0.0f, 0.048f, 0.068f}, {0.029f, 0.028f, 0.192f}, 0.0045f);
    b.addChamferBox({-0.007f, 0.053f, 0.058f}, {0.017f, 0.015f, 0.036f}, 0.002f, 0.0f, 16.0f, 0.72f); // ejection port
    for (int i = 0; i < 6; ++i) {
      b.addChamferBox({0.0f, 0.047f, -0.014f + i * 0.0075f}, {0.0308f, 0.020f, 0.0032f}, 0.0008f, 0.0f, 18.0f, 0.86f);
    }
    for (int i = 0; i < 4; ++i) {
      b.addChamferBox({0.0f, 0.047f, 0.122f + i * 0.0075f}, {0.0308f, 0.018f, 0.0032f}, 0.0008f, 0.0f, 18.0f, 0.86f);
    }
  }
  {
    auto b = initPart(WeaponMeshPartId::Pistol_Accent, WeaponSurfaceMat::TacticalStipple);
    // Ergonomic raked stippled grip, undercut trigger guard, dustcover & under-rail
    b.addChamferBox({0.0f, -0.018f, -0.006f}, {0.030f, 0.106f, 0.042f}, 0.006f, 0.24f);
    b.addChamferBox({0.0f, -0.068f, -0.018f}, {0.033f, 0.012f, 0.046f}, 0.003f, 0.24f, 14.0f, 0.85f); // magwell flare
    b.addChamferBox({0.0f, 0.026f, 0.066f}, {0.027f, 0.020f, 0.168f}, 0.0035f);
    b.addChamferBox({0.0f, 0.028f, -0.024f}, {0.024f, 0.012f, 0.026f}, 0.003f, -0.25f); // beavertail
    b.addChamferBox({0.0f, -0.002f, 0.052f}, {0.011f, 0.007f, 0.052f}, 0.002f); // trigger guard bottom
    b.addChamferBox({0.0f, 0.011f, 0.076f}, {0.011f, 0.026f, 0.008f}, 0.002f);  // trigger guard front
  }
  {
    auto b = initPart(WeaponMeshPartId::Pistol_Hardware, WeaponSurfaceMat::MachinedBarrel);
    b.addCylinderZ({0.0f, 0.048f, 0.175f}, 0.0072f, 0.0072f, 0.038f, 18); // threaded barrel tip
    b.addChamferBox({0.0f, 0.013f, 0.048f}, {0.006f, 0.021f, 0.006f}, 0.0015f, 0.28f); // curved trigger
    b.addChamferBox({0.0f, 0.048f, -0.032f}, {0.007f, 0.016f, 0.014f}, 0.002f, -0.35f); // skeleton hammer
    b.addChamferBox({-0.0155f, 0.032f, 0.032f}, {0.004f, 0.009f, 0.028f}, 0.001f); // right-side extractor detail
    b.addChamferBox({ 0.0155f, 0.032f, 0.036f}, {0.004f, 0.010f, 0.032f}, 0.001f); // left-side slide stop & takedown lever
    b.addChamferBox({0.0f, 0.066f, -0.016f}, {0.016f, 0.009f, 0.012f}, 0.0015f); // rear tritium sight
    b.addChamferBox({0.0f, 0.066f, 0.152f}, {0.005f, 0.009f, 0.010f}, 0.0012f);  // front sight blade
    b.addPicatinnyRail(0.015f, 0.092f, 0.145f, 0.022f);
  }

  // =========================================================================
  // 2. CARBINE (Vanguard M4A1-S)
  // =========================================================================
  {
    auto b = initPart(WeaponMeshPartId::Carbine_Body, WeaponSurfaceMat::ReceiverAnodized);
    // Upper & lower forged receiver, flared magwell, brass deflector & buffer castle nut
    b.addChamferBox({0.0f, 0.060f, 0.088f}, {0.042f, 0.044f, 0.235f}, 0.0055f);
    b.addChamferBox({0.0f, 0.026f, 0.068f}, {0.040f, 0.038f, 0.195f}, 0.005f);
    b.addChamferBox({0.0f, -0.004f, 0.135f}, {0.044f, 0.048f, 0.072f}, 0.0045f); // flared magwell
    b.addChamferBox({-0.023f, 0.060f, 0.045f}, {0.012f, 0.024f, 0.026f}, 0.003f); // brass deflector (right)
    b.addChamferBox({-0.022f, 0.058f, 0.095f}, {0.005f, 0.022f, 0.068f}, 0.0015f, 0.0f, 16.0f, 0.80f); // ejection port cover
    b.addCylinderZ({0.0f, 0.054f, -0.095f}, 0.016f, 0.016f, 0.145f, 18); // receiver extension buffer tube
  }
  {
    auto b = initPart(WeaponMeshPartId::Carbine_Accent, WeaponSurfaceMat::TacticalStipple);
    // Ergonomic stippled grip + trigger guard + octagonal M-LOK handguard + collapsible SOPMOD stock
    b.addChamferBox({0.0f, -0.036f, -0.004f}, {0.033f, 0.106f, 0.046f}, 0.0065f, 0.28f);
    b.addChamferBox({0.0f, -0.002f, 0.068f}, {0.012f, 0.007f, 0.064f}, 0.002f);
    // Slotted octagonal M-LOK free-float handguard
    b.addChamferBox({0.0f, 0.055f, 0.335f}, {0.048f, 0.054f, 0.265f}, 0.011f);
    for (int i = 0; i < 5; ++i) {
      const float z = 0.235f + static_cast<float>(i) * 0.048f;
      b.addChamferBox({0.0f, 0.055f, z}, {0.051f, 0.014f, 0.024f}, 0.0025f, 0.0f, 18.0f, 0.78f);
    }
    // SOPMOD collapsible tactical stock + sloped cheekweld + rubber recoil buttpad
    b.addChamferBox({0.0f, 0.050f, -0.175f}, {0.044f, 0.068f, 0.165f}, 0.008f);
    b.addChamferBox({0.0f, 0.018f, -0.205f}, {0.036f, 0.068f, 0.105f}, 0.006f, 0.32f);
    b.addChamferBox({0.0f, 0.036f, -0.262f}, {0.046f, 0.118f, 0.018f}, 0.004f, 0.0f, 14.0f, 0.72f);
  }
  {
    auto b = initPart(WeaponMeshPartId::Carbine_Hardware, WeaponSurfaceMat::MachinedBarrel);
    b.addPicatinnyRail(0.084f, -0.022f, 0.465f, 0.022f);
    b.addPicatinnyRail(0.025f, 0.280f, 0.450f, 0.020f); // bottom M-LOK rail section
    b.addCylinderZ({0.0f, 0.055f, 0.495f}, 0.0105f, 0.0098f, 0.155f, 20); // fluted match barrel
    b.addCylinderZ({0.0f, 0.068f, 0.385f}, 0.0045f, 0.0045f, 0.165f, 12); // stainless gas tube
    b.addChamferBox({0.0f, 0.060f, 0.468f}, {0.022f, 0.030f, 0.026f}, 0.003f); // low-pro gas block
    b.addCylinderZ({-0.022f, 0.052f, -0.012f}, 0.0065f, 0.0075f, 0.026f, 14); // forward assist (right)
    b.addChamferBox({ 0.022f, 0.030f, 0.018f}, {0.005f, 0.008f, 0.022f}, 0.0015f); // fire selector lever (left)
    b.addChamferBox({ 0.022f, 0.048f, 0.088f}, {0.005f, 0.018f, 0.014f}, 0.0015f); // bolt catch paddle (left)
    b.addChamferBox({0.0f, 0.075f, -0.032f}, {0.036f, 0.011f, 0.024f}, 0.003f); // T-charging handle
    b.addChamferBox({0.0f, 0.012f, 0.058f}, {0.006f, 0.022f, 0.006f}, 0.0015f, 0.25f); // trigger
  }

  // =========================================================================
  // 3. SMG (Spectre MP5-SD / Tactical PDW)
  // =========================================================================
  {
    auto b = initPart(WeaponMeshPartId::Smg_Body, WeaponSurfaceMat::ReceiverAnodized);
    b.addChamferBox({0.0f, 0.054f, 0.105f}, {0.040f, 0.048f, 0.285f}, 0.007f);
    b.addChamferBox({0.0f, 0.004f, 0.125f}, {0.036f, 0.048f, 0.054f}, 0.004f); // PDW magwell
  }
  {
    auto b = initPart(WeaponMeshPartId::Smg_Accent, WeaponSurfaceMat::TacticalStipple);
    b.addChamferBox({0.0f, -0.034f, 0.002f}, {0.032f, 0.102f, 0.042f}, 0.006f, 0.18f);
    b.addChamferBox({0.0f, 0.042f, 0.255f}, {0.044f, 0.044f, 0.135f}, 0.008f); // polymer forend
    b.addChamferBox({0.0f, 0.022f, 0.312f}, {0.032f, 0.028f, 0.022f}, 0.004f); // integrated handstop
    b.addChamferBox({0.0f, 0.046f, -0.175f}, {0.038f, 0.096f, 0.022f}, 0.005f); // collapsing buttpad
  }
  {
    auto b = initPart(WeaponMeshPartId::Smg_Hardware, WeaponSurfaceMat::MachinedBarrel);
    b.addPicatinnyRail(0.080f, -0.020f, 0.305f, 0.021f);
    b.addCylinderZ({-0.021f, 0.050f, -0.105f}, 0.0042f, 0.0042f, 0.145f, 12); // left collapsing stock rod
    b.addCylinderZ({ 0.021f, 0.050f, -0.105f}, 0.0042f, 0.0042f, 0.145f, 12); // right collapsing stock rod
    b.addCylinderZ({0.0f, 0.052f, 0.325f}, 0.0115f, 0.0105f, 0.085f, 18); // heavy PDW barrel shroud
    b.addCylinderZ({ 0.022f, 0.064f, 0.215f}, 0.005f, 0.005f, 0.018f, 12); // left MP5 cocking handle knob
    b.addChamferBox({ 0.021f, 0.032f, 0.022f}, {0.005f, 0.008f, 0.022f}, 0.0015f); // ambidextrous fire selector
    b.addChamferBox({0.0f, 0.012f, 0.050f}, {0.006f, 0.022f, 0.006f}, 0.0015f, 0.22f);
  }

  // =========================================================================
  // 4. SHOTGUN (Breacher M1014 Combat Auto)
  // =========================================================================
  {
    auto b = initPart(WeaponMeshPartId::Shotgun_Body, WeaponSurfaceMat::ReceiverAnodized);
    b.addChamferBox({0.0f, 0.050f, 0.105f}, {0.044f, 0.056f, 0.255f}, 0.007f);
    b.addChamferBox({-0.022f, 0.054f, 0.125f}, {0.006f, 0.022f, 0.078f}, 0.0015f, 0.0f, 16.0f, 0.75f); // shell ejection window
  }
  {
    auto b = initPart(WeaponMeshPartId::Shotgun_Accent, WeaponSurfaceMat::TacticalStipple);
    b.addChamferBox({0.0f, -0.032f, -0.008f}, {0.034f, 0.104f, 0.046f}, 0.0065f, 0.26f);
    // Angled combat shotgun fixed/tactical stock + cheek riser
    b.addChamferBox({0.0f, 0.032f, -0.145f}, {0.040f, 0.068f, 0.225f}, 0.008f, -0.08f);
    b.addChamferBox({0.0f, 0.024f, -0.262f}, {0.044f, 0.118f, 0.022f}, 0.005f, 0.0f, 14.0f, 0.70f);
    // Ribbed tactical forend
    b.addChamferBox({0.0f, 0.032f, 0.365f}, {0.048f, 0.044f, 0.235f}, 0.009f);
    for (int i = 0; i < 7; ++i) {
      b.addChamferBox({0.0f, 0.028f, 0.275f + i * 0.028f}, {0.051f, 0.036f, 0.010f}, 0.002f, 0.0f, 16.0f, 0.84f);
    }
  }
  {
    auto b = initPart(WeaponMeshPartId::Shotgun_Hardware, WeaponSurfaceMat::MachinedBarrel);
    b.addPicatinnyRail(0.079f, 0.015f, 0.215f, 0.021f);
    b.addCylinderZ({0.0f, 0.056f, 0.435f}, 0.0128f, 0.0122f, 0.415f, 20); // 18.5" smoothbore barrel
    b.addCylinderZ({0.0f, 0.026f, 0.420f}, 0.0122f, 0.0122f, 0.390f, 18); // full-length 7-shell mag tube
    b.addChamferBox({0.0f, 0.041f, 0.565f}, {0.030f, 0.046f, 0.018f}, 0.003f); // barrel/tube figure-8 clamp
    b.addCylinderZ({-0.028f, 0.054f, 0.145f}, 0.0055f, 0.0065f, 0.022f, 12); // oversized combat bolt knob (right)
    b.addRingZ({0.0f, 0.088f, 0.012f}, 0.0075f, 0.002f, 16, 6); // ghost-ring rear aperture
    b.addChamferBox({0.0f, 0.074f, 0.618f}, {0.014f, 0.016f, 0.016f}, 0.002f); // winged front post
  }

  // =========================================================================
  // 5. DMR (SR-25 / MK14 Precision Match Rifle)
  // =========================================================================
  {
    auto b = initPart(WeaponMeshPartId::Dmr_Body, WeaponSurfaceMat::ReceiverAnodized);
    b.addChamferBox({0.0f, 0.062f, 0.105f}, {0.045f, 0.048f, 0.275f}, 0.0055f);
    b.addChamferBox({0.0f, 0.026f, 0.085f}, {0.043f, 0.040f, 0.225f}, 0.005f);
    b.addChamferBox({0.0f, -0.004f, 0.145f}, {0.046f, 0.050f, 0.088f}, 0.0045f); // 7.62 NATO straight magwell
  }
  {
    auto b = initPart(WeaponMeshPartId::Dmr_Accent, WeaponSurfaceMat::TacticalStipple);
    b.addChamferBox({0.0f, -0.038f, -0.006f}, {0.035f, 0.110f, 0.048f}, 0.0065f, 0.18f);
    // Long 15" precision octagonal M-LOK free-float handguard
    b.addChamferBox({0.0f, 0.056f, 0.395f}, {0.048f, 0.054f, 0.355f}, 0.010f);
    for (int i = 0; i < 7; ++i) {
      b.addChamferBox({0.0f, 0.056f, 0.255f + i * 0.046f}, {0.051f, 0.014f, 0.024f}, 0.0025f, 0.0f, 18.0f, 0.78f);
    }
    // Precision PRS sniper buttstock + raised adjustable cheekpiece + monopod cutout
    b.addChamferBox({0.0f, 0.046f, -0.165f}, {0.044f, 0.078f, 0.225f}, 0.007f);
    b.addChamferBox({0.0f, 0.086f, -0.145f}, {0.038f, 0.022f, 0.135f}, 0.005f, 0.0f, 14.0f, 0.82f); // cheek riser
    b.addChamferBox({0.0f, 0.034f, -0.282f}, {0.046f, 0.122f, 0.022f}, 0.004f, 0.0f, 14.0f, 0.72f);
  }
  {
    auto b = initPart(WeaponMeshPartId::Dmr_Hardware, WeaponSurfaceMat::MachinedBarrel);
    b.addPicatinnyRail(0.088f, -0.028f, 0.568f, 0.022f);
    b.addPicatinnyRail(0.025f, 0.320f, 0.560f, 0.020f);
    b.addCylinderZ({0.0f, 0.056f, 0.625f}, 0.0118f, 0.0108f, 0.195f, 22); // 20" heavy fluted match barrel
    b.addChamferBox({0.0f, 0.060f, 0.578f}, {0.024f, 0.032f, 0.028f}, 0.003f); // adjustable gas block
    // Folded front precision bipod legs under forend tip
    b.addCylinderZ({-0.024f, 0.018f, 0.485f}, 0.0055f, 0.0050f, 0.155f, 12);
    b.addCylinderZ({ 0.024f, 0.018f, 0.485f}, 0.0055f, 0.0050f, 0.155f, 12);
    b.addChamferBox({0.0f, 0.012f, 0.058f}, {0.006f, 0.022f, 0.006f}, 0.0015f, 0.20f);
  }

  // =========================================================================
  // 6. MODULAR OPTICS + COATED SAPPHIRE LENS + ILLUMINATED RETICLE
  // =========================================================================
  {
    // Micro T2 Red Dot
    auto b = initPart(WeaponMeshPartId::Optic_RedDot, WeaponSurfaceMat::ReceiverAnodized);
    b.addChamferBox({0.0f, 0.008f, 0.0f}, {0.028f, 0.016f, 0.042f}, 0.003f); // skeleton riser
    b.addCylinderZ({0.0f, 0.028f, 0.0f}, 0.0165f, 0.0165f, 0.068f, 22, false);
    b.addRingZ({0.0f, 0.028f,  0.034f}, 0.0155f, 0.0022f, 20, 8);
    b.addRingZ({0.0f, 0.028f, -0.034f}, 0.0155f, 0.0022f, 20, 8);
    b.addCylinderY({0.0f, 0.046f, 0.0f}, 0.0065f, 0.0065f, 0.008f, 14); // elevation cap
    b.addChamferBox({0.018f, 0.028f, 0.0f}, {0.008f, 0.014f, 0.014f}, 0.002f); // brightness dial
  }
  {
    // EXPS3 Holographic Sight
    auto b = initPart(WeaponMeshPartId::Optic_Holo, WeaponSurfaceMat::ReceiverAnodized);
    b.addChamferBox({0.0f, 0.007f, 0.0f}, {0.036f, 0.014f, 0.078f}, 0.003f); // QD rail base
    // Outer protective aluminum hood (left wall, right wall, roof bridge)
    b.addChamferBox({-0.022f, 0.032f, 0.0f}, {0.006f, 0.042f, 0.074f}, 0.002f);
    b.addChamferBox({ 0.022f, 0.032f, 0.0f}, {0.006f, 0.042f, 0.074f}, 0.002f);
    b.addChamferBox({0.0f, 0.052f, 0.0f}, {0.048f, 0.006f, 0.074f}, 0.002f);
    b.addCylinderZ({0.014f, 0.014f, 0.032f}, 0.0075f, 0.0075f, 0.032f, 14); // transverse CR123 battery cap
  }
  {
    // 4x32 ACOG Prism Scope
    auto b = initPart(WeaponMeshPartId::Optic_Acog, WeaponSurfaceMat::ReceiverAnodized);
    b.addChamferBox({0.0f, 0.006f, 0.0f}, {0.028f, 0.014f, 0.088f}, 0.003f);
    b.addCylinderZ({0.0f, 0.030f, -0.005f}, 0.016f, 0.0175f, 0.125f, 22, false);
    b.addCylinderZ({0.0f, 0.030f,  0.072f}, 0.0175f, 0.0225f, 0.042f, 22, false); // flared objective bell
    b.addRingZ({0.0f, 0.030f,  0.093f}, 0.0215f, 0.0024f, 20, 8);
    b.addRingZ({0.0f, 0.030f, -0.068f}, 0.0155f, 0.0022f, 20, 8);
    b.addChamferBox({0.0f, 0.050f, 0.015f}, {0.009f, 0.008f, 0.078f}, 0.002f); // fiber-optic collector housing
  }
  {
    // 8x Variable Long-Range Sniper Scope
    auto b = initPart(WeaponMeshPartId::Optic_Sniper, WeaponSurfaceMat::ReceiverAnodized);
    b.addChamferBox({0.0f, 0.010f, -0.055f}, {0.028f, 0.022f, 0.022f}, 0.003f); // rear scope ring
    b.addChamferBox({0.0f, 0.010f,  0.065f}, {0.028f, 0.022f, 0.022f}, 0.003f); // front scope ring
    b.addCylinderZ({0.0f, 0.031f, 0.005f}, 0.0155f, 0.0155f, 0.215f, 22, false); // 30mm main tube
    b.addCylinderZ({0.0f, 0.031f, 0.135f}, 0.0160f, 0.0265f, 0.078f, 24, false); // 50mm objective bell
    b.addCylinderZ({0.0f, 0.031f, -0.118f}, 0.0205f, 0.0160f, 0.058f, 22, false); // ocular bell
    b.addRingZ({0.0f, 0.031f,  0.174f}, 0.0255f, 0.0024f, 22, 8);
    b.addRingZ({0.0f, 0.031f, -0.147f}, 0.0195f, 0.0022f, 20, 8);
    b.addCylinderY({0.0f, 0.052f, 0.005f}, 0.0105f, 0.0105f, 0.018f, 16); // tactical elevation turret
    b.addChamferBox({0.022f, 0.031f, 0.005f}, {0.014f, 0.018f, 0.018f}, 0.003f); // windage turret
  }
  {
    // Coated Sapphire Peripheral Glass Ring + Corner Specular Glint (leaves sight bore 100% clear for ADS!)
    auto b = initPart(WeaponMeshPartId::Optic_Lens, WeaponSurfaceMat::OpticGlass);
    b.addRingZ({0.0f, 0.0f, 0.0f}, 0.0138f, 0.0015f, 22, 8, 0.92f);
    b.addChamferBox({-0.0058f, 0.0078f, 0.0004f}, {0.0062f, 0.0013f, 0.0010f}, 0.0003f, 0.0f, 12.0f, 1.0f);
  }
  {
    // Crisp Illuminated Holographic Ring + Center Dot Reticle
    auto b = initPart(WeaponMeshPartId::Optic_Reticle, WeaponSurfaceMat::OpticGlass);
    b.addCylinderZ({0.0f, 0.0f, 0.0f}, 0.0024f, 0.0024f, 0.0022f, 12, true, 8.0f, 1.0f);
    b.addRingZ({0.0f, 0.0f, 0.0f}, 0.0085f, 0.0009f, 18, 6, 1.0f);
  }

  // =========================================================================
  // 7. MODULAR MUZZLE DEVICES
  // =========================================================================
  {
    // Ti-Baffle Cylindrical Suppressor + knurled QD mount collar
    auto b = initPart(WeaponMeshPartId::Muzzle_Suppressor, WeaponSurfaceMat::MachinedBarrel);
    b.addCylinderZ({0.0f, 0.0f, 0.018f}, 0.0175f, 0.0185f, 0.036f, 20); // QD locking collar
    b.addCylinderZ({0.0f, 0.0f, 0.105f}, 0.0195f, 0.0195f, 0.145f, 24); // main titanium can
    b.addRingZ({0.0f, 0.0f, 0.045f}, 0.0198f, 0.0014f, 20, 6);
    b.addRingZ({0.0f, 0.0f, 0.176f}, 0.0165f, 0.0022f, 20, 6);
  }
  {
    // 3-Chamber Match Muzzle Brake / Compensator
    auto b = initPart(WeaponMeshPartId::Muzzle_Compensator, WeaponSurfaceMat::MachinedBarrel);
    b.addChamferBox({0.0f, 0.0f, 0.032f}, {0.026f, 0.024f, 0.064f}, 0.004f);
    for (int i = 0; i < 3; ++i) {
      b.addChamferBox({0.0f, 0.0f, 0.016f + i * 0.016f}, {0.0285f, 0.012f, 0.007f}, 0.001f, 0.0f, 18.0f, 0.55f);
    }
    b.addCylinderZ({0.0f, 0.0f, 0.065f}, 0.0095f, 0.0085f, 0.008f, 16);
  }
  {
    // Osprey Eccentric Polygonal Flat-Profile Suppressor
    auto b = initPart(WeaponMeshPartId::Muzzle_Osprey, WeaponSurfaceMat::ReceiverAnodized);
    b.addChamferBox({0.0f, -0.006f, 0.095f}, {0.033f, 0.044f, 0.185f}, 0.0065f);
    b.addChamferBox({0.0f, -0.028f, 0.018f}, {0.018f, 0.008f, 0.028f}, 0.002f); // eccentric cam latch
    b.addCylinderZ({0.0f, 0.0f, 0.188f}, 0.0095f, 0.0095f, 0.008f, 16);
  }
  {
    // Cordura Thermal-Mirage Wrapped Suppressor + cinch straps
    auto b = initPart(WeaponMeshPartId::Muzzle_Wrapped, WeaponSurfaceMat::TacticalStipple);
    b.addCylinderZ({0.0f, 0.0f, 0.098f}, 0.0218f, 0.0218f, 0.155f, 22);
    for (int i = 0; i < 4; ++i) {
      b.addRingZ({0.0f, 0.0f, 0.038f + i * 0.038f}, 0.0222f, 0.0018f, 20, 6, 0.78f);
    }
    b.addCylinderZ({0.0f, 0.0f, 0.184f}, 0.0165f, 0.0155f, 0.022f, 18, true, 16.0f, 0.85f);
  }

  // =========================================================================
  // 8. MODULAR UNDERBARREL ATTACHMENTS
  // =========================================================================
  {
    // Stubby Stippled Vertical Foregrip
    auto b = initPart(WeaponMeshPartId::Under_VertGrip, WeaponSurfaceMat::TacticalStipple);
    b.addChamferBox({0.0f, -0.004f, 0.0f}, {0.030f, 0.014f, 0.044f}, 0.003f);
    b.addCylinderY({0.0f, -0.046f, 0.0f}, 0.0155f, 0.0145f, 0.076f, 18);
    b.addCylinderY({0.0f, -0.084f, 0.0f}, 0.0168f, 0.0160f, 0.010f, 18, 16.0f, 0.82f);
  }
  {
    // AN/PEQ-15 Tactical Laser & IR Illuminator Box
    auto b = initPart(WeaponMeshPartId::Under_PeqLaser, WeaponSurfaceMat::TacticalStipple);
    b.addChamferBox({0.0f, -0.014f, 0.0f}, {0.046f, 0.024f, 0.082f}, 0.0045f);
    b.addCylinderZ({-0.013f, -0.014f, 0.045f}, 0.0065f, 0.0065f, 0.012f, 14); // visible/IR laser emitter
    b.addCylinderZ({ 0.013f, -0.014f, 0.045f}, 0.0080f, 0.0080f, 0.014f, 14); // IR illuminator bezel
    b.addCylinderY({0.0f, -0.001f, -0.008f}, 0.0085f, 0.0085f, 0.006f, 12, 14.0f, 0.75f); // mode selector
  }
  {
    // Ergonomic Angled Foregrip (AFG) + Thumb-Stop
    auto b = initPart(WeaponMeshPartId::Under_AngledGrip, WeaponSurfaceMat::TacticalStipple);
    b.addChamferBox({0.0f, -0.006f, 0.0f}, {0.028f, 0.012f, 0.108f}, 0.003f);
    b.addChamferBox({0.0f, -0.020f, -0.012f}, {0.028f, 0.024f, 0.078f}, 0.0045f, -0.34f);
    b.addChamferBox({0.0f, -0.022f,  0.044f}, {0.028f, 0.026f, 0.016f}, 0.0035f,  0.25f); // front index stop
  }

  // =========================================================================
  // 9. MODULAR MAGAZINES (Curved Ribbed PMAG & 50-Round Drum)
  // =========================================================================
  {
    auto b = initPart(WeaponMeshPartId::Mag_Curved, WeaponSurfaceMat::TacticalStipple);
    b.addChamferBox({0.0f, 0.018f, 0.0f}, {0.026f, 0.085f, 0.060f}, 0.004f);
    b.addChamferBox({0.0f, -0.052f, 0.010f}, {0.026f, 0.082f, 0.060f}, 0.004f, -0.16f);
    for (int i = 0; i < 4; ++i) {
      b.addChamferBox({0.0f, -0.015f - i * 0.020f, 0.002f + i * 0.003f}, {0.0285f, 0.006f, 0.062f}, 0.0015f, -0.12f, 16.0f, 0.85f);
    }
    b.addChamferBox({0.0f, -0.094f, 0.018f}, {0.030f, 0.014f, 0.066f}, 0.003f, -0.16f, 14.0f, 0.78f); // Ranger floorplate
  }
  {
    auto b = initPart(WeaponMeshPartId::Mag_Drum, WeaponSurfaceMat::MachinedBarrel);
    b.addChamferBox({0.0f, 0.032f, 0.0f}, {0.026f, 0.068f, 0.056f}, 0.0035f); // feed tower
    b.addCylinderZ({0.0f, -0.038f, 0.0f}, 0.064f, 0.064f, 0.072f, 24);        // 50-rd drum housing
    b.addRingZ({0.0f, -0.038f,  0.036f}, 0.048f, 0.003f, 20, 6);
    b.addRingZ({0.0f, -0.038f, -0.036f}, 0.048f, 0.003f, 20, 6);
    b.addCylinderZ({0.0f, -0.038f, 0.038f}, 0.018f, 0.018f, 0.008f, 16);      // ratcheting tension hub
  }

  // =========================================================================
  // 10. FIRST-PERSON TACTICAL ARMORED FOREARM & HARD-KNUCKLE GLOVE
  // =========================================================================
  {
    auto b = initPart(WeaponMeshPartId::Fpv_Forearm, WeaponSurfaceMat::TacticalStipple);
    b.addCylinderZ({0.0f, 0.0f, 0.0f}, 0.046f, 0.036f, 0.28f, 16);
    b.addChamferBox({0.0f, 0.034f, 0.02f}, {0.056f, 0.018f, 0.18f}, 0.005f, 0.0f, 14.0f, 0.88f); // forearm armor plate
    b.addRingZ({0.0f, 0.0f, 0.125f}, 0.037f, 0.0045f, 16, 6, 0.75f); // tactical wrist cuff / watch strap
  }
  {
    auto b = initPart(WeaponMeshPartId::Fpv_GloveHand, WeaponSurfaceMat::ReceiverAnodized);
    b.addChamferBox({0.0f, 0.0f, 0.0f}, {0.078f, 0.052f, 0.088f}, 0.014f);
    for (int k = 0; k < 4; ++k) {
      const float kx = -0.025f + static_cast<float>(k) * 0.0165f;
      b.addChamferBox({kx, 0.024f, 0.022f}, {0.014f, 0.014f, 0.024f}, 0.004f, 0.0f, 16.0f, 1.08f); // carbon knuckles
      b.addChamferBox({kx, -0.006f, 0.046f}, {0.015f, 0.034f, 0.024f}, 0.005f, 0.25f, 16.0f, 0.82f); // curled fingers
    }
    b.addChamferBox({0.042f, -0.004f, 0.012f}, {0.024f, 0.026f, 0.052f}, 0.006f, 0.18f, 16.0f, 0.86f); // thumb
  }
}

float WeaponSystem3D::opticSightLineY(const WeaponSlotState& w) {
  const WeaponMountSpec ms = mountSpecForWeapon(w.id);
  if (w.optic == WeaponOpticKind::IronSights) {
    return ms.opticPos.y + 0.012f;
  }
  return ms.opticPos.y + opticAxisOffsetLocalY(w.optic) * ms.opticScale;
}

void WeaponSystem3D::appendAssembledWeapon(
  const glm::vec3& gripWorldPos,
  const glm::quat& gunWorldRot,
  const WeaponSlotState& w,
  float recoil01,
  float reloadProgress01,
  float uniformScale,
  bool castShadow,
  std::vector<WeaponPartDrawInstance>& outInstances
) {
  if (w.isMelee) return;

  glm::vec3 bodyCol, accCol, hwCol;
  float bodyRough = 0.34f, bodyMetal = 0.85f;
  float accRough = 0.56f, accMetal = 0.22f;
  float hwRough = 0.26f, hwMetal = 0.92f;
  GameSession::weaponFinishPbr(w.bodyFinish, w.surfaceSheen, bodyCol, bodyRough, bodyMetal, nullptr);
  GameSession::weaponFinishPbr(w.accentFinish, w.surfaceSheen * 0.75f, accCol, accRough, accMetal, nullptr);
  GameSession::weaponFinishPbr(w.hardwareFinish, std::min(1.0f, w.surfaceSheen + 0.20f), hwCol, hwRough, hwMetal, nullptr);
  const glm::vec3 retCol = GameSession::weaponReticleColor(w.reticleColorIdx, nullptr);

  auto pushPart = [&](
    WeaponMeshPartId part,
    const glm::vec3& localPos,
    const glm::vec3& localScale,
    const glm::vec3& col,
    float rough,
    float metal,
    float emissive = 0.0f,
    const glm::quat& localRot = glm::quat(1.0f, 0.0f, 0.0f, 0.0f)
  ) {
    WeaponPartDrawInstance inst{};
    inst.part = part;
    inst.pos = gripWorldPos + gunWorldRot * (localPos * uniformScale);
    inst.rot = gunWorldRot * localRot;
    inst.scale = localScale * uniformScale;
    inst.color = col;
    inst.roughness = rough;
    inst.metallic = metal;
    inst.emissive = emissive;
    inst.castShadow = castShadow;
    outInstances.push_back(inst);
  };

  WeaponMeshPartId bodyId = WeaponMeshPartId::Carbine_Body;
  WeaponMeshPartId accId = WeaponMeshPartId::Carbine_Accent;
  WeaponMeshPartId hwId = WeaponMeshPartId::Carbine_Hardware;
  const bool isPistol = (w.id == "pistol" || w.id == "pistol_sd");
  if (isPistol) {
    bodyId = WeaponMeshPartId::Pistol_Body;
    accId = WeaponMeshPartId::Pistol_Accent;
    hwId = WeaponMeshPartId::Pistol_Hardware;
  } else if (w.id == "smg") {
    bodyId = WeaponMeshPartId::Smg_Body;
    accId = WeaponMeshPartId::Smg_Accent;
    hwId = WeaponMeshPartId::Smg_Hardware;
  } else if (w.id == "shotgun") {
    bodyId = WeaponMeshPartId::Shotgun_Body;
    accId = WeaponMeshPartId::Shotgun_Accent;
    hwId = WeaponMeshPartId::Shotgun_Hardware;
  } else if (w.id == "dmr") {
    bodyId = WeaponMeshPartId::Dmr_Body;
    accId = WeaponMeshPartId::Dmr_Accent;
    hwId = WeaponMeshPartId::Dmr_Hardware;
  }

  // Pistol slide reciprocates backward on shot kick & locks back mid-reload!
  const float slideKickZ = isPistol
    ? (-recoil01 * 0.032f - std::sin(std::clamp(reloadProgress01, 0.0f, 1.0f) * kPi) * 0.026f)
    : 0.0f;

  pushPart(bodyId, {0.0f, 0.0f, slideKickZ}, {1.0f, 1.0f, 1.0f}, bodyCol, bodyRough, bodyMetal);
  pushPart(accId, {0.0f, 0.0f, 0.0f}, {1.0f, 1.0f, 1.0f}, accCol, accRough, accMetal);
  pushPart(hwId, {0.0f, 0.0f, 0.0f}, {1.0f, 1.0f, 1.0f}, hwCol, hwRough, hwMetal);

  const WeaponMountSpec ms = mountSpecForWeapon(w.id);

  // Modular Magazine (animates smoothly out/in of magwell during reload; also supports 12ga drum on Shotgun!)
  if (ms.hasBoxMag || w.mag == WeaponMagKind::Drum) {
    const float rWave = std::sin(std::clamp(reloadProgress01, 0.0f, 1.0f) * kPi);
    const glm::vec3 magDrop(0.0f, -rWave * 0.14f, -rWave * 0.025f);
    const glm::vec3 baseMagPos = ms.hasBoxMag ? ms.magPos : glm::vec3(0.0f, -0.018f, 0.125f);
    if (w.mag == WeaponMagKind::Drum && !isPistol) {
      pushPart(WeaponMeshPartId::Mag_Drum, baseMagPos + magDrop, glm::vec3(1.0f), hwCol, hwRough, hwMetal);
    } else {
      glm::vec3 mScale = ms.magScale;
      glm::vec3 mPos = baseMagPos + magDrop;
      if (w.mag == WeaponMagKind::Extended) {
        mScale.y *= 1.34f;
        mPos.y -= 0.022f;
      } else if (w.mag == WeaponMagKind::Drum && isPistol) {
        mScale.y *= 1.55f;
        mPos.y -= 0.034f;
      }
      pushPart(WeaponMeshPartId::Mag_Curved, mPos, mScale, accCol, accRough, accMetal);
    }
  }

  // Modular Muzzle Attachment
  if (w.muzzle != WeaponMuzzleKind::Standard) {
    WeaponMeshPartId muzId = WeaponMeshPartId::Muzzle_Suppressor;
    glm::vec3 muzCol = hwCol;
    float muzRough = hwRough, muzMetal = hwMetal;
    if (w.muzzle == WeaponMuzzleKind::Compensator) {
      muzId = WeaponMeshPartId::Muzzle_Compensator;
    } else if (w.muzzle == WeaponMuzzleKind::Osprey) {
      muzId = WeaponMeshPartId::Muzzle_Osprey;
      muzCol = bodyCol;
      muzRough = bodyRough;
      muzMetal = bodyMetal;
    } else if (w.muzzle == WeaponMuzzleKind::Wrapped) {
      muzId = WeaponMeshPartId::Muzzle_Wrapped;
      muzCol = accCol;
      muzRough = accRough;
      muzMetal = accMetal;
    }
    pushPart(muzId, ms.muzzlePos, glm::vec3(ms.muzzleScale), muzCol, muzRough, muzMetal);
  }

  // Modular Underbarrel Attachment
  if (w.underbarrel != WeaponUnderbarrelKind::None) {
    WeaponMeshPartId ubId = WeaponMeshPartId::Under_VertGrip;
    if (w.underbarrel == WeaponUnderbarrelKind::LaserSight) ubId = WeaponMeshPartId::Under_PeqLaser;
    else if (w.underbarrel == WeaponUnderbarrelKind::AngledGrip) ubId = WeaponMeshPartId::Under_AngledGrip;
    pushPart(ubId, ms.underPos, glm::vec3(ms.underScale), accCol, accRough, accMetal);
  }

  // Modular Optic + Coated Lens + Emissive Reticle
  if (w.optic != WeaponOpticKind::IronSights) {
    const glm::vec3 optBase = ms.opticPos + glm::vec3(0.0f, 0.0f, slideKickZ);
    const float os = ms.opticScale;
    const float axisY = opticAxisOffsetLocalY(w.optic) * os;
    WeaponMeshPartId optId = WeaponMeshPartId::Optic_RedDot;
    float lensScale = 0.95f * os;
    float fLensZ = 0.032f * os;
    float bLensZ = -0.032f * os;
    if (w.optic == WeaponOpticKind::Holo) {
      optId = WeaponMeshPartId::Optic_Holo;
      lensScale = 1.10f * os;
      fLensZ = 0.034f * os;
      bLensZ = -0.034f * os;
    } else if (w.optic == WeaponOpticKind::Acog) {
      optId = WeaponMeshPartId::Optic_Acog;
      lensScale = 1.25f * os;
      fLensZ = 0.090f * os;
      bLensZ = -0.065f * os;
    } else if (w.optic == WeaponOpticKind::SniperScope) {
      optId = WeaponMeshPartId::Optic_Sniper;
      lensScale = 1.48f * os;
      fLensZ = 0.170f * os;
      bLensZ = -0.144f * os;
    }
    pushPart(optId, optBase, glm::vec3(os), bodyCol, bodyRough, bodyMetal);
    pushPart(WeaponMeshPartId::Optic_Lens, optBase + glm::vec3(0.0f, axisY, fLensZ), glm::vec3(lensScale), {0.16f, 0.42f, 0.56f}, 0.08f, 0.35f, 0.25f);
    pushPart(WeaponMeshPartId::Optic_Lens, optBase + glm::vec3(0.0f, axisY, bLensZ), glm::vec3(lensScale * 0.85f), {0.12f, 0.32f, 0.44f}, 0.08f, 0.35f, 0.18f);
    pushPart(WeaponMeshPartId::Optic_Reticle, optBase + glm::vec3(0.0f, axisY, 0.0f), glm::vec3(os), retCol, 0.10f, 0.0f, 4.5f);
  }
}

void WeaponSystem3D::appendFirstPersonViewmodel(
  const glm::vec3& camPos,
  const glm::vec3& camTarget,
  const WeaponSlotState& activeWep,
  PlayerSuitPreset suitPreset,
  float adsBlend01,
  float recoil01,
  float reloadProgress01,
  float walkSpeedMps,
  bool sprinting,
  float locomotionClock,
  float yawTurnBank,
  const std::string& meleeAttackClip,
  float meleeAttackNorm01,
  bool meleeBlocking,
  std::vector<WeaponPartDrawInstance>& outInstances
) {
  const glm::vec3 camFwd = glm::normalize(camTarget - camPos);
  // Note: In a right-handed world, cross(camFwd, +Y) points to the camera's RIGHT on screen!
  const glm::vec3 camRight = glm::normalize(glm::cross(camFwd, glm::vec3(0.0f, 1.0f, 0.0f)));
  const glm::vec3 camUp = glm::normalize(glm::cross(camRight, camFwd));

  // Orthonormal camera->world rotation where local (+X = screen Left, +Y = screen Up, +Z = camFwd)
  // Wait: weapon mesh has +Z = muzzle forward, +Y = up, +X = weapon's left (-camRight)!
  const glm::mat3 gunBasis(-camRight, camUp, camFwd);
  const glm::quat qCamGun = glm::normalize(glm::quat_cast(gunBasis));

  const glm::vec4 suitTint4 = GameSession::suitTintColor(suitPreset, nullptr);
  const glm::vec3 sleeveCol = glm::clamp(glm::vec3(suitTint4) * 0.42f, glm::vec3(0.10f), glm::vec3(0.65f));
  const glm::vec3 gloveCol(0.14f, 0.15f, 0.17f);

  const float spd01 = std::clamp(walkSpeedMps / 8.6f, 0.0f, 1.0f);
  const float bobFreq = sprinting ? 10.5f : 7.6f;
  const float bobAmp = spd01 * (1.0f - adsBlend01 * 0.85f);
  const float bobX = std::cos(locomotionClock * bobFreq) * 0.011f * bobAmp;
  const float bobY = -std::abs(std::sin(locomotionClock * bobFreq)) * 0.013f * bobAmp;
  const float breatheY = std::sin(locomotionClock * 2.1f) * 0.0022f * (1.0f - adsBlend01 * 0.75f);

  auto emitArmAndGlove = [&](const glm::vec3& wristWorld, const glm::quat& qHand, float mirrorX) {
    WeaponPartDrawInstance glove{};
    glove.part = WeaponMeshPartId::Fpv_GloveHand;
    glove.pos = wristWorld;
    glove.rot = qHand;
    glove.scale = {mirrorX, 1.0f, 1.0f};
    glove.color = gloveCol;
    glove.roughness = 0.46f;
    glove.metallic = 0.25f;
    glove.castShadow = false;
    outInstances.push_back(glove);

    WeaponPartDrawInstance arm{};
    arm.part = WeaponMeshPartId::Fpv_Forearm;
    arm.pos = wristWorld + qHand * glm::vec3(0.0f, -0.015f, -0.155f);
    arm.rot = qHand;
    arm.scale = {1.0f, 1.0f, 1.0f};
    arm.color = sleeveCol;
    arm.roughness = 0.58f;
    arm.metallic = 0.18f;
    arm.castShadow = false;
    outInstances.push_back(arm);
  };

  // Unarmed First-Person Boxing Fists & Tactical Forearms (including Iron Pit!)
  if (activeWep.isMelee) {
    const float punchWave = std::sin(std::clamp(meleeAttackNorm01, 0.0f, 1.0f) * kPi);
    const bool leftPunch = (meleeAttackClip == "jab" || meleeAttackClip == "hook");
    const bool rightPunch = (meleeAttackClip == "cross" || meleeAttackClip == "uppercut" || meleeAttackClip == "kick");
    const float guardLift = meleeBlocking ? 0.075f : 0.0f;
    const float guardIn = meleeBlocking ? 0.065f : 0.0f;

    glm::vec3 lOff(-0.165f + guardIn + bobX, -0.175f + guardLift + bobY + breatheY, 0.34f);
    glm::vec3 rOff( 0.165f - guardIn + bobX, -0.180f + guardLift + bobY - breatheY, 0.32f);
    if (leftPunch) {
      lOff.z += punchWave * 0.28f;
      lOff.x += punchWave * ((meleeAttackClip == "hook") ? 0.12f : 0.07f);
      lOff.y += punchWave * 0.04f;
    }
    if (rightPunch) {
      rOff.z += punchWave * 0.30f;
      rOff.x -= punchWave * 0.08f;
      rOff.y += punchWave * ((meleeAttackClip == "uppercut") ? 0.12f : 0.04f);
    }

    const glm::vec3 lWorld = camPos + camRight * lOff.x + camUp * lOff.y + camFwd * lOff.z;
    const glm::vec3 rWorld = camPos + camRight * rOff.x + camUp * rOff.y + camFwd * rOff.z;
    const glm::quat qLeft = qCamGun *
      glm::angleAxis(-0.32f - guardLift * 1.4f, glm::vec3(1.0f, 0.0f, 0.0f)) *
      glm::angleAxis(-0.22f, glm::vec3(0.0f, 1.0f, 0.0f)) *
      glm::angleAxis( 0.45f, glm::vec3(0.0f, 0.0f, 1.0f));
    const glm::quat qRight = qCamGun *
      glm::angleAxis(-0.32f - guardLift * 1.4f, glm::vec3(1.0f, 0.0f, 0.0f)) *
      glm::angleAxis( 0.22f, glm::vec3(0.0f, 1.0f, 0.0f)) *
      glm::angleAxis(-0.45f, glm::vec3(0.0f, 0.0f, 1.0f));

    emitArmAndGlove(lWorld, qLeft, -1.0f);
    emitArmAndGlove(rWorld, qRight, 1.0f);
    return;
  }

  // Hide 3D mesh at full 8x Sniper Scope zoom so the precision full-screen scope lens HUD is clean
  if (activeWep.optic == WeaponOpticKind::SniperScope && adsBlend01 > 0.88f) {
    return;
  }

  const bool isPistol = (activeWep.id == "pistol" || activeWep.id == "pistol_sd");
  const float ads = adsBlend01 * adsBlend01 * (3.0f - 2.0f * adsBlend01);
  const float sightY = opticSightLineY(activeWep);

  const glm::vec3 hipOffset(
    (isPistol ? 0.145f : 0.168f) + bobX - yawTurnBank * 0.018f,
    (isPistol ? -0.132f : -0.148f) + bobY + breatheY,
    isPistol ? 0.34f : 0.30f
  );
  const glm::vec3 adsOffset(
    0.0f,
    -sightY,
    isPistol ? 0.26f : 0.20f
  );

  const float reloadWave = std::sin(std::clamp(reloadProgress01, 0.0f, 1.0f) * kPi);
  glm::vec3 localViewOff = glm::mix(hipOffset, adsOffset, ads);
  localViewOff.z -= recoil01 * (isPistol ? 0.032f : 0.044f) * (1.0f - ads * 0.35f);
  localViewOff.y += recoil01 * 0.008f - reloadWave * 0.055f;
  localViewOff.x -= reloadWave * 0.035f;

  // Sprint tactical port-arms cant when running full speed without ADS
  const float sprintCant = (sprinting && ads < 0.15f && reloadProgress01 <= 0.001f) ? (spd01 * 0.38f) : 0.0f;

  const glm::quat qKickAndCant =
    glm::angleAxis(-recoil01 * (isPistol ? 0.14f : 0.085f) * (1.0f - ads * 0.45f) + reloadWave * 0.26f + sprintCant * 0.22f, glm::vec3(1.0f, 0.0f, 0.0f)) *
    glm::angleAxis(sprintCant * 0.55f + yawTurnBank * 0.04f * (1.0f - ads), glm::vec3(0.0f, 1.0f, 0.0f)) *
    glm::angleAxis(reloadWave * 0.48f + sprintCant * 0.35f, glm::vec3(0.0f, 0.0f, 1.0f));

  const glm::vec3 gripWorld =
    camPos +
    camRight * localViewOff.x +
    camUp * localViewOff.y +
    camFwd * localViewOff.z;
  const glm::quat qGun = qCamGun * qKickAndCant;

  appendAssembledWeapon(gripWorld, qGun, activeWep, recoil01, reloadProgress01, 1.0f, false, outInstances);

  // Right shooting glove & forearm anchored on pistol grip
  const glm::vec3 rWrist = gripWorld + qGun * glm::vec3(-0.006f, -0.042f, -0.018f);
  const glm::quat qRightArm = qGun * glm::angleAxis(-0.18f, glm::vec3(1.0f, 0.0f, 0.0f));
  emitArmAndGlove(rWrist, qRightArm, 1.0f);

  // Left support glove & forearm reaching forward to handguard / underbarrel grip (or magazine during reload!)
  const WeaponMountSpec ms = mountSpecForWeapon(activeWep.id);
  glm::vec3 lSupportLocal = isPistol
    ? glm::vec3(0.012f, -0.038f, 0.012f)
    : (ms.underPos + glm::vec3(0.018f, (activeWep.underbarrel == WeaponUnderbarrelKind::VerticalGrip) ? -0.048f : -0.014f, -0.015f));
  if (reloadProgress01 > 0.01f && ms.hasBoxMag) {
    lSupportLocal = glm::mix(lSupportLocal, ms.magPos + glm::vec3(0.015f, -0.065f - reloadWave * 0.11f, -0.015f), reloadWave);
  }
  const glm::vec3 lWrist = gripWorld + qGun * lSupportLocal;
  const glm::quat qLeftArm = qGun *
    glm::angleAxis(-0.12f, glm::vec3(1.0f, 0.0f, 0.0f)) *
    glm::angleAxis(-0.24f, glm::vec3(0.0f, 1.0f, 0.0f));
  emitArmAndGlove(lWrist, qLeftArm, -1.0f);
}

} // namespace westgate
