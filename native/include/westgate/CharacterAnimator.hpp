#pragma once

#include "westgate/GltfAssetLoader.hpp"
#include <array>
#include <glm/glm.hpp>
#include <glm/gtc/quaternion.hpp>
#include <string>
#include <unordered_map>
#include <vector>

namespace westgate {

constexpr uint32_t kMaxSkinBones = 96;

/**
 * Evaluates glTF skeletal animations and Mixamo-to-UE/CC4 bone retargeting
 * into a 96-bone GPU skinning matrix palette (mat4x4<f32>).
 */
class CharacterAnimator {
 public:
  struct SourceClip {
    std::string id;
    float duration = 0.0f;
    bool loop = true;
    std::vector<GltfNodeInfo> srcNodes;
    std::vector<glm::quat> srcRestWorldQ;
    std::unordered_map<std::string, int32_t> canonicalToSrcNode;
    GltfAnimationClip clip;
  };

  /** Build a canonical Mixamo-compatible SourceClip from an animation GLB (or embedded clip). */
  static bool buildSourceClip(
    const std::string& id,
    const GltfModel& animModel,
    size_t clipIndex,
    bool loop,
    SourceClip& outClip
  );

  /** Bind this animator to a skinned target model (e.g. base_body.glb, clothing_shorts.glb, business.glb). */
  void initForTarget(const GltfModel& targetModel);

  /** Compute GPU skinning palette at rest pose (no clip active). */
  void evaluateRest(std::array<glm::mat4, kMaxSkinBones>& outPalette) const;

  /**
   * Evaluate a SourceClip at `timeSec` onto the target skeleton using world-space
   * bind-pose delta retargeting (works seamlessly across Mixamo <-> UE/CC4 skeletons).
   */
  void evaluateClip(
    const SourceClip& src,
    float timeSec,
    std::array<glm::mat4, kMaxSkinBones>& outPalette
  ) const;

  /**
   * Evaluate a blended transition between two clips (`blend` in [0..1], 1 = 100% clipB).
   */
  void evaluateBlended(
    const SourceClip& clipA,
    float timeA,
    const SourceClip& clipB,
    float timeB,
    float blend,
    std::array<glm::mat4, kMaxSkinBones>& outPalette
  ) const;

  /**
   * Upper/lower-body skeletal layering:
   * Lower body (hips & legs) plays `lowerClip`, while upper body (spine, torso, arms, head)
   * smoothly blends toward `upperClip` by `upperWeight` in [0..1].
   */
  void evaluateLayered(
    const SourceClip& lowerClip,
    float lowerTime,
    const SourceClip& upperClip,
    float upperTime,
    float upperWeight,
    std::array<glm::mat4, kMaxSkinBones>& outPalette
  ) const;

  static std::string canonicalizeBoneName(const std::string& rawName);

 private:
  void sampleSourcePose(
    const SourceClip& src,
    float timeSec,
    std::vector<glm::quat>& outSrcWorldQ,
    glm::vec3& outSrcHipPos
  ) const;

  void buildPaletteFromTargetLocals(
    const std::vector<glm::vec3>& localT,
    const std::vector<glm::quat>& localR,
    const std::vector<glm::vec3>& localS,
    std::array<glm::mat4, kMaxSkinBones>& outPalette
  ) const;

  const GltfModel* target_ = nullptr;
  std::vector<int32_t> targetTopoOrder_;
  std::vector<glm::quat> targetRestWorldQ_;
  std::vector<std::string> targetCanonicalNames_;
  float targetHipHeight_ = 0.95f;
};

} // namespace westgate
