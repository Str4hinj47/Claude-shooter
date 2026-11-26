#pragma once

#include <cstdint>
#include <glm/glm.hpp>
#include <glm/gtc/quaternion.hpp>
#include <string>
#include <vector>

namespace westgate {

struct GltfVertex {
  glm::vec3 position{0.0f};
  glm::vec3 normal{0.0f, 1.0f, 0.0f};
  glm::vec2 uv{0.0f};
  glm::vec4 color{1.0f};
  glm::uvec4 joints{0u};
  glm::vec4 weights{1.0f, 0.0f, 0.0f, 0.0f};
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
  bool hasSkin = false;
};

struct GltfNodeInfo {
  std::string name;
  int32_t parent = -1;
  glm::vec3 restT{0.0f};
  glm::quat restR{1.0f, 0.0f, 0.0f, 0.0f};
  glm::vec3 restS{1.0f};
};

struct GltfSkinInfo {
  bool valid = false;
  std::vector<int32_t> jointNodeIndices;
  std::vector<glm::mat4> inverseBindMatrices;
};

enum class GltfAnimPath : uint8_t {
  Translation = 0,
  Rotation = 1,
  Scale = 2,
};

struct GltfAnimChannel {
  int32_t targetNode = -1;
  std::string targetBoneName;
  GltfAnimPath path = GltfAnimPath::Rotation;
  std::vector<float> times;
  std::vector<float> values; // 3 floats per key for T/S, 4 floats (x,y,z,w) per key for R
};

struct GltfAnimationClip {
  std::string name;
  float duration = 0.0f;
  std::vector<GltfAnimChannel> channels;
};

struct GltfModel {
  std::string sourcePath;
  std::vector<GltfPrimitive> primitives;
  std::vector<GltfMaterialInfo> materials;
  std::vector<GltfTextureData> textures;
  std::vector<GltfNodeInfo> nodes;
  GltfSkinInfo skin;
  std::vector<GltfAnimationClip> animations;
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
 * Native glTF 2.0 / GLB loader powered by cgltf + meshoptimizer + stb_image.
 * Decodes standard glTF, KHR_mesh_quantization, EXT_meshopt_compression,
 * node transforms, skeletal skins, and animation keyframes.
 */
class GltfAssetLoader {
 public:
  static bool loadGlb(const std::string& path, GltfModel& outModel, bool decodeTextures = true, std::string* err = nullptr);
};

} // namespace westgate
