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
 * Procedural anatomical overlay applied in character space on top of retargeted clips
 * (breathing, idle sway, sprint lean, head-look, firearm aiming, recoil kick & reload).
 */
struct CharacterPoseOverlay {
  float timeSec = 0.0f;
  float seed = 0.0f;
  float idleWeight = 0.0f;
  float sprintLean = 0.0f;
  float turnBank = 0.0f;
  float headLookYaw = 0.0f;
  float headLookPitch = 0.0f;
  float weaponHoldWeight = 0.0f;
  bool twoHandedWeapon = false;
  float aimWeight = 0.0f;
  float recoilKick = 0.0f;
  float reloadProgress = 0.0f;
};

/**
 * Per-character animation crossfade & upper-body layer state machine.
 */
struct CharacterAnimState {
  std::string prevClip = "Idle";
  float prevTime = 0.0f;
  std::string currClip = "Idle";
  float currTime = 0.0f;
  float blend = 1.0f;
  float blendDuration = 0.16f;

  std::string upperClip;
  float upperTime = 0.0f;
  float upperWeight = 0.0f;
};

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
    glm::vec3 srcRestHipPos{0.0f, 0.95f, 0.0f};
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
    std::array<glm::mat4, kMaxSkinBones>& outPalette,
    const CharacterPoseOverlay* overlay = nullptr
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
    std::array<glm::mat4, kMaxSkinBones>& outPalette,
    const CharacterPoseOverlay* overlay = nullptr
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
    std::array<glm::mat4, kMaxSkinBones>& outPalette,
    const CharacterPoseOverlay* overlay = nullptr
  ) const;

  /** Advance a per-character crossfade + upper-body overlay state machine. */
  static void advanceAnimState(
    CharacterAnimState& state,
    const std::string& desiredClip,
    float desiredTime,
    const std::string& desiredUpperClip,
    float desiredUpperTime,
    float dt,
    float crossfadeSec = 0.16f
  );

  /** Evaluate a CharacterAnimState against a clip bank with smooth crossfades + optional pose overlay. */
  void evaluateState(
    const CharacterAnimState& state,
    const std::unordered_map<std::string, SourceClip>& clips,
    std::array<glm::mat4, kMaxSkinBones>& outPalette,
    const CharacterPoseOverlay* overlay = nullptr
  ) const;

  static std::string canonicalizeBoneName(const std::string& rawName);

 private:
  void sampleSourcePose(
    const SourceClip& src,
    float timeSec,
    std::vector<glm::quat>& outSrcWorldQ,
    glm::vec3& outSrcHipPos
  ) const;

  glm::quat computeOverlayDeltaWorld(
    const std::string& canon,
    const CharacterPoseOverlay& overlay
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
  int32_t targetHipsNode_ = -1;
  float targetHipHeight_ = 0.95f;
};

} // namespace westgate
