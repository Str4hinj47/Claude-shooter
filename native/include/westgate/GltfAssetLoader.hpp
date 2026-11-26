#pragma once

#include <cstdint>
#include <glm/glm.hpp>
#include <string>
#include <vector>

namespace westgate {

struct GltfVertex {
  glm::vec3 position{0.0f};
  glm::vec3 normal{0.0f, 1.0f, 0.0f};
  glm::vec2 uv{0.0f};
};

struct GltfMaterialInfo {
  std::string name;
  glm::vec4 baseColor{1.0f};
  float metallic = 0.0f;
  float roughness = 0.8f;
  int32_t baseColorTexIndex = -1;
};

struct GltfTextureData {
  uint32_t width = 0;
  uint32_t height = 0;
  std::vector<uint8_t> rgba8;
};

struct GltfPrimitive {
  std::vector<GltfVertex> vertices;
  std::vector<uint32_t> indices;
  int32_t materialIndex = -1;
};

struct GltfModel {
  std::string sourcePath;
  std::vector<GltfPrimitive> primitives;
  std::vector<GltfMaterialInfo> materials;
  std::vector<GltfTextureData> textures;
  uint32_t boneCount = 0;
  uint32_t animationCount = 0;
  glm::vec3 boundsMin{0.0f};
  glm::vec3 boundsMax{0.0f};

  size_t totalVertices() const {
    size_t n = 0;
    for (const auto& p : primitives) n += p.vertices.size();
    return n;
  }

  size_t totalIndices() const {
    size_t n = 0;
    for (const auto& p : primitives) n += p.indices.size();
    return n;
  }
};

/**
 * Native glTF 2.0 / GLB loader powered by cgltf + meshoptimizer.
 * Decodes standard glTF, KHR_mesh_quantization, and EXT_meshopt_compression buffers.
 */
class GltfAssetLoader {
 public:
  static bool loadGlb(const std::string& path, GltfModel& outModel, bool decodeTextures = true, std::string* err = nullptr);
};

} // namespace westgate
