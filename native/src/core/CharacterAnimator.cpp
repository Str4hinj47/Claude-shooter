#include "westgate/CharacterAnimator.hpp"
#include <algorithm>
#include <cmath>
#include <unordered_map>

namespace westgate {

namespace {

const std::unordered_map<std::string, std::string>& ueToMixamoMap() {
  static const std::unordered_map<std::string, std::string> m = {
    {"pelvis", "Hips"},
    {"spine_01", "Spine"},
    {"spine_02", "Spine1"},
    {"spine_03", "Spine2"},
    {"neck_01", "Neck"},
    {"head", "Head"},
    {"clavicle_l", "LeftShoulder"},
    {"upperarm_l", "LeftArm"},
    {"lowerarm_l", "LeftForeArm"},
    {"hand_l", "LeftHand"},
    {"thumb_01_l", "LeftHandThumb1"},
    {"thumb_02_l", "LeftHandThumb2"},
    {"thumb_03_l", "LeftHandThumb3"},
    {"index_01_l", "LeftHandIndex1"},
    {"index_02_l", "LeftHandIndex2"},
    {"index_03_l", "LeftHandIndex3"},
    {"middle_01_l", "LeftHandMiddle1"},
    {"middle_02_l", "LeftHandMiddle2"},
    {"middle_03_l", "LeftHandMiddle3"},
    {"ring_01_l", "LeftHandRing1"},
    {"ring_02_l", "LeftHandRing2"},
    {"ring_03_l", "LeftHandRing3"},
    {"pinky_01_l", "LeftHandPinky1"},
    {"pinky_02_l", "LeftHandPinky2"},
    {"pinky_03_l", "LeftHandPinky3"},
    {"clavicle_r", "RightShoulder"},
    {"upperarm_r", "RightArm"},
    {"lowerarm_r", "RightForeArm"},
    {"hand_r", "RightHand"},
    {"thumb_01_r", "RightHandThumb1"},
    {"thumb_02_r", "RightHandThumb2"},
    {"thumb_03_r", "RightHandThumb3"},
    {"index_01_r", "RightHandIndex1"},
    {"index_02_r", "RightHandIndex2"},
    {"index_03_r", "RightHandIndex3"},
    {"middle_01_r", "RightHandMiddle1"},
    {"middle_02_r", "RightHandMiddle2"},
    {"middle_03_r", "RightHandMiddle3"},
    {"ring_01_r", "RightHandRing1"},
    {"ring_02_r", "RightHandRing2"},
    {"ring_03_r", "RightHandRing3"},
    {"pinky_01_r", "RightHandPinky1"},
    {"pinky_02_r", "RightHandPinky2"},
    {"pinky_03_r", "RightHandPinky3"},
    {"thigh_l", "LeftUpLeg"},
    {"calf_l", "LeftLeg"},
    {"foot_l", "LeftFoot"},
    {"ball_l", "LeftToeBase"},
    {"thigh_r", "RightUpLeg"},
    {"calf_r", "RightLeg"},
    {"foot_r", "RightFoot"},
    {"ball_r", "RightToeBase"},
  };
  return m;
}

std::vector<int32_t> buildTopologicalOrder(const std::vector<GltfNodeInfo>& nodes) {
  std::vector<int32_t> order;
  order.reserve(nodes.size());
  std::vector<uint8_t> visited(nodes.size(), 0);
  auto dfs = [&](auto& self, int32_t idx) -> void {
    if (idx < 0 || static_cast<size_t>(idx) >= nodes.size() || visited[idx]) return;
    visited[idx] = 1;
    if (nodes[idx].parent >= 0) self(self, nodes[idx].parent);
    order.push_back(idx);
  };
  for (int32_t i = 0; i < static_cast<int32_t>(nodes.size()); ++i) dfs(dfs, i);
  return order;
}

void computeWorldQuats(
  const std::vector<GltfNodeInfo>& nodes,
  const std::vector<int32_t>& topo,
  const std::vector<glm::quat>& localR,
  std::vector<glm::quat>& outWorldQ
) {
  outWorldQ.resize(nodes.size(), glm::quat(1.0f, 0.0f, 0.0f, 0.0f));
  for (int32_t idx : topo) {
    const int32_t p = nodes[idx].parent;
    if (p >= 0) {
      outWorldQ[idx] = glm::normalize(outWorldQ[p] * localR[idx]);
    } else {
      outWorldQ[idx] = glm::normalize(localR[idx]);
    }
  }
}

void sampleChannelVec3(const GltfAnimChannel& ch, float t, glm::vec3& out) {
  const size_t n = ch.times.size();
  if (n == 0) return;
  if (n == 1 || t <= ch.times.front()) {
    out = glm::vec3(ch.values[0], ch.values[1], ch.values[2]);
    return;
  }
  if (t >= ch.times.back()) {
    const size_t k = (n - 1) * 3;
    out = glm::vec3(ch.values[k], ch.values[k + 1], ch.values[k + 2]);
    return;
  }
  auto it = std::upper_bound(ch.times.begin(), ch.times.end(), t);
  const size_t i1 = static_cast<size_t>(it - ch.times.begin());
  const size_t i0 = i1 - 1;
  const float span = std::max(1e-6f, ch.times[i1] - ch.times[i0]);
  const float a = std::clamp((t - ch.times[i0]) / span, 0.0f, 1.0f);
  const glm::vec3 v0(ch.values[i0 * 3], ch.values[i0 * 3 + 1], ch.values[i0 * 3 + 2]);
  const glm::vec3 v1(ch.values[i1 * 3], ch.values[i1 * 3 + 1], ch.values[i1 * 3 + 2]);
  out = glm::mix(v0, v1, a);
}

void sampleChannelQuat(const GltfAnimChannel& ch, float t, glm::quat& out) {
  const size_t n = ch.times.size();
  if (n == 0) return;
  auto readQ = [&](size_t idx) {
    const size_t k = idx * 4;
    return glm::normalize(glm::quat(ch.values[k + 3], ch.values[k], ch.values[k + 1], ch.values[k + 2]));
  };
  if (n == 1 || t <= ch.times.front()) {
    out = readQ(0);
    return;
  }
  if (t >= ch.times.back()) {
    out = readQ(n - 1);
    return;
  }
  auto it = std::upper_bound(ch.times.begin(), ch.times.end(), t);
  const size_t i1 = static_cast<size_t>(it - ch.times.begin());
  const size_t i0 = i1 - 1;
  const float span = std::max(1e-6f, ch.times[i1] - ch.times[i0]);
  const float a = std::clamp((t - ch.times[i0]) / span, 0.0f, 1.0f);
  glm::quat q0 = readQ(i0);
  glm::quat q1 = readQ(i1);
  if (glm::dot(q0, q1) < 0.0f) q1 = -q1;

  if (n < 4) {
    const float s = a * a * (3.0f - 2.0f * a);
    out = glm::normalize(glm::slerp(q0, q1, s));
    return;
  }
  const size_t im1 = (i0 > 0) ? (i0 - 1) : 0;
  const size_t i2 = (i1 + 1 < n) ? (i1 + 1) : (n - 1);
  glm::quat qm1 = readQ(im1);
  glm::quat q2 = readQ(i2);
  if (glm::dot(qm1, q0) < 0.0f) qm1 = -qm1;
  if (glm::dot(q2, q1) < 0.0f) q2 = -q2;

  const glm::quat tA = glm::normalize(glm::slerp(qm1, q1, 0.5f));
  const glm::quat tB = glm::normalize(glm::slerp(q0, q2, 0.5f));
  const float s = a * a * (3.0f - 2.0f * a);
  const glm::quat lin = glm::normalize(glm::slerp(q0, q1, s));
  const glm::quat tan = glm::normalize(glm::slerp(tA, tB, s));
  out = glm::normalize(glm::slerp(lin, tan, 2.0f * a * (1.0f - a) * 0.32f));
}

} // namespace

std::string CharacterAnimator::canonicalizeBoneName(const std::string& rawName) {
  if (rawName.rfind("mixamorig:", 0) == 0) return rawName.substr(10);
  if (rawName.rfind("mixamorig", 0) == 0) return rawName.substr(9);
  const auto& m = ueToMixamoMap();
  auto it = m.find(rawName);
  return it != m.end() ? it->second : std::string();
}

bool CharacterAnimator::buildSourceClip(
  const std::string& id,
  const GltfModel& animModel,
  size_t clipIndex,
  bool loop,
  SourceClip& outClip
) {
  if (clipIndex >= animModel.animations.size()) return false;
  outClip = SourceClip{};
  outClip.id = id;
  outClip.loop = loop;
  outClip.srcNodes = animModel.nodes;
  outClip.clip = animModel.animations[clipIndex];
  outClip.duration = std::max(0.01f, outClip.clip.duration);

  const auto topo = buildTopologicalOrder(outClip.srcNodes);
  std::vector<glm::quat> restLocal(outClip.srcNodes.size(), glm::quat(1.0f, 0.0f, 0.0f, 0.0f));
  for (size_t i = 0; i < outClip.srcNodes.size(); ++i) {
    restLocal[i] = outClip.srcNodes[i].restR;
    const std::string canon = canonicalizeBoneName(outClip.srcNodes[i].name);
    if (!canon.empty()) {
      outClip.canonicalToSrcNode[canon] = static_cast<int32_t>(i);
    }
  }
  computeWorldQuats(outClip.srcNodes, topo, restLocal, outClip.srcRestWorldQ);
  auto hipIt = outClip.canonicalToSrcNode.find("Hips");
  if (hipIt != outClip.canonicalToSrcNode.end()) {
    outClip.srcRestHipPos = outClip.srcNodes[hipIt->second].restT;
  }
  return !outClip.canonicalToSrcNode.empty();
}

void CharacterAnimator::initForTarget(const GltfModel& targetModel) {
  target_ = &targetModel;
  targetTopoOrder_ = buildTopologicalOrder(targetModel.nodes);
  targetCanonicalNames_.resize(targetModel.nodes.size());
  targetHipsNode_ = -1;
  targetHipHeight_ = 0.95f;
  std::vector<glm::quat> restLocal(targetModel.nodes.size(), glm::quat(1.0f, 0.0f, 0.0f, 0.0f));
  for (size_t i = 0; i < targetModel.nodes.size(); ++i) {
    restLocal[i] = targetModel.nodes[i].restR;
    targetCanonicalNames_[i] = canonicalizeBoneName(targetModel.nodes[i].name);
    if (targetCanonicalNames_[i] == "Hips") {
      targetHipsNode_ = static_cast<int32_t>(i);
      targetHipHeight_ = std::max(0.5f, std::abs(targetModel.nodes[i].restT.y));
    }
  }
  computeWorldQuats(targetModel.nodes, targetTopoOrder_, restLocal, targetRestWorldQ_);
}

void CharacterAnimator::evaluateRest(std::array<glm::mat4, kMaxSkinBones>& outPalette) const {
  outPalette.fill(glm::mat4(1.0f));
  if (!target_ || !target_->skin.valid) return;
  const size_t n = target_->nodes.size();
  std::vector<glm::vec3> localT(n);
  std::vector<glm::quat> localR(n);
  std::vector<glm::vec3> localS(n);
  for (size_t i = 0; i < n; ++i) {
    localT[i] = target_->nodes[i].restT;
    localR[i] = target_->nodes[i].restR;
    localS[i] = target_->nodes[i].restS;
  }
  buildPaletteFromTargetLocals(localT, localR, localS, outPalette);
}

void CharacterAnimator::sampleSourcePose(
  const SourceClip& src,
  float timeSec,
  std::vector<glm::quat>& outSrcWorldQ,
  glm::vec3& outSrcHipPos
) const {
  const size_t n = src.srcNodes.size();
  std::vector<glm::vec3> localT(n);
  std::vector<glm::quat> localR(n);
  for (size_t i = 0; i < n; ++i) {
    localT[i] = src.srcNodes[i].restT;
    localR[i] = src.srcNodes[i].restR;
  }

  float t = timeSec;
  if (src.duration > 1e-4f) {
    if (src.loop) {
      t = std::fmod(std::max(0.0f, timeSec), src.duration);
    } else {
      t = std::clamp(timeSec, 0.0f, src.duration);
    }
  } else {
    t = 0.0f;
  }

  for (const auto& ch : src.clip.channels) {
    if (ch.targetNode < 0 || static_cast<size_t>(ch.targetNode) >= n) continue;
    if (ch.path == GltfAnimPath::Rotation) {
      sampleChannelQuat(ch, t, localR[ch.targetNode]);
    } else if (ch.path == GltfAnimPath::Translation) {
      sampleChannelVec3(ch, t, localT[ch.targetNode]);
    }
  }

  const auto topo = buildTopologicalOrder(src.srcNodes);
  computeWorldQuats(src.srcNodes, topo, localR, outSrcWorldQ);
  auto it = src.canonicalToSrcNode.find("Hips");
  if (it != src.canonicalToSrcNode.end()) {
    outSrcHipPos = localT[it->second];
  } else {
    outSrcHipPos = glm::vec3(0.0f);
  }
}

void CharacterAnimator::evaluateClip(
  const SourceClip& src,
  float timeSec,
  std::array<glm::mat4, kMaxSkinBones>& outPalette,
  const CharacterPoseOverlay* overlay
) const {
  outPalette.fill(glm::mat4(1.0f));
  if (!target_ || !target_->skin.valid) return;

  std::vector<glm::quat> srcWorldQ;
  glm::vec3 srcHipPos(0.0f);
  sampleSourcePose(src, timeSec, srcWorldQ, srcHipPos);

  const size_t n = target_->nodes.size();
  std::vector<glm::vec3> localT(n);
  std::vector<glm::quat> localR(n);
  std::vector<glm::vec3> localS(n);
  for (size_t i = 0; i < n; ++i) {
    localT[i] = target_->nodes[i].restT;
    localR[i] = target_->nodes[i].restR;
    localS[i] = target_->nodes[i].restS;
  }

  if (targetHipsNode_ >= 0) {
    const float srcH = std::abs(src.srcRestHipPos.y) > 0.1f ? std::abs(src.srcRestHipPos.y) : targetHipHeight_;
    const float hipScale = std::clamp(targetHipHeight_ / srcH, 0.004f, 250.0f);
    const glm::vec3 d = (srcHipPos - src.srcRestHipPos) * hipScale;
    const float unitScale = targetHipHeight_ / 0.95f;
    localT[targetHipsNode_].y += std::clamp(d.y, -0.88f * unitScale, 0.35f * unitScale);
    localT[targetHipsNode_].x += std::clamp(d.x * 0.35f, -0.22f * unitScale, 0.22f * unitScale);
  }

  std::vector<glm::quat> targetWorldQ = targetRestWorldQ_;
  for (int32_t idx : targetTopoOrder_) {
    const int32_t p = target_->nodes[idx].parent;
    const glm::quat parentWorldQ = (p >= 0) ? targetWorldQ[p] : glm::quat(1.0f, 0.0f, 0.0f, 0.0f);

    const std::string& canon = targetCanonicalNames_[idx];
    if (!canon.empty()) {
      auto sit = src.canonicalToSrcNode.find(canon);
      if (sit != src.canonicalToSrcNode.end()) {
        const int32_t si = sit->second;
        const glm::quat deltaWorld = srcWorldQ[si] * glm::inverse(src.srcRestWorldQ[si]);
        glm::quat desiredWorldQ = glm::normalize(deltaWorld * targetRestWorldQ_[idx]);
        if (overlay) {
          desiredWorldQ = glm::normalize(computeOverlayDeltaWorld(canon, *overlay) * desiredWorldQ);
        }
        targetWorldQ[idx] = desiredWorldQ;
        localR[idx] = glm::normalize(glm::inverse(parentWorldQ) * desiredWorldQ);
        continue;
      }
    }
    targetWorldQ[idx] = glm::normalize(parentWorldQ * localR[idx]);
  }

  buildPaletteFromTargetLocals(localT, localR, localS, outPalette);
}

void CharacterAnimator::evaluateBlended(
  const SourceClip& clipA,
  float timeA,
  const SourceClip& clipB,
  float timeB,
  float blend,
  std::array<glm::mat4, kMaxSkinBones>& outPalette,
  const CharacterPoseOverlay* overlay
) const {
  const float rawB = std::clamp(blend, 0.0f, 1.0f);
  const float b = rawB * rawB * (3.0f - 2.0f * rawB);
  if (b <= 0.001f) {
    evaluateClip(clipA, timeA, outPalette, overlay);
    return;
  }
  if (b >= 0.999f) {
    evaluateClip(clipB, timeB, outPalette, overlay);
    return;
  }
  if (!target_ || !target_->skin.valid) {
    outPalette.fill(glm::mat4(1.0f));
    return;
  }

  std::vector<glm::quat> srcWorldQA, srcWorldQB;
  glm::vec3 hipA(0.0f), hipB(0.0f);
  sampleSourcePose(clipA, timeA, srcWorldQA, hipA);
  sampleSourcePose(clipB, timeB, srcWorldQB, hipB);

  const size_t n = target_->nodes.size();
  std::vector<glm::vec3> localT(n);
  std::vector<glm::quat> localR(n);
  std::vector<glm::vec3> localS(n);
  for (size_t i = 0; i < n; ++i) {
    localT[i] = target_->nodes[i].restT;
    localR[i] = target_->nodes[i].restR;
    localS[i] = target_->nodes[i].restS;
  }

  if (targetHipsNode_ >= 0) {
    const float srcHA = std::abs(clipA.srcRestHipPos.y) > 0.1f ? std::abs(clipA.srcRestHipPos.y) : targetHipHeight_;
    const float srcHB = std::abs(clipB.srcRestHipPos.y) > 0.1f ? std::abs(clipB.srcRestHipPos.y) : targetHipHeight_;
    const glm::vec3 dA = (hipA - clipA.srcRestHipPos) * std::clamp(targetHipHeight_ / srcHA, 0.004f, 250.0f);
    const glm::vec3 dB = (hipB - clipB.srcRestHipPos) * std::clamp(targetHipHeight_ / srcHB, 0.004f, 250.0f);
    const glm::vec3 d = glm::mix(dA, dB, b);
    const float unitScale = targetHipHeight_ / 0.95f;
    localT[targetHipsNode_].y += std::clamp(d.y, -0.88f * unitScale, 0.35f * unitScale);
    localT[targetHipsNode_].x += std::clamp(d.x * 0.35f, -0.22f * unitScale, 0.22f * unitScale);
  }

  std::vector<glm::quat> targetWorldQ = targetRestWorldQ_;
  for (int32_t idx : targetTopoOrder_) {
    const int32_t p = target_->nodes[idx].parent;
    const glm::quat parentWorldQ = (p >= 0) ? targetWorldQ[p] : glm::quat(1.0f, 0.0f, 0.0f, 0.0f);
    const std::string& canon = targetCanonicalNames_[idx];

    if (!canon.empty()) {
      auto itA = clipA.canonicalToSrcNode.find(canon);
      auto itB = clipB.canonicalToSrcNode.find(canon);
      if (itA != clipA.canonicalToSrcNode.end() && itB != clipB.canonicalToSrcNode.end()) {
        const glm::quat wA = glm::normalize((srcWorldQA[itA->second] * glm::inverse(clipA.srcRestWorldQ[itA->second])) * targetRestWorldQ_[idx]);
        const glm::quat wB = glm::normalize((srcWorldQB[itB->second] * glm::inverse(clipB.srcRestWorldQ[itB->second])) * targetRestWorldQ_[idx]);
        glm::quat desiredWorldQ = glm::normalize(glm::slerp(wA, wB, b));
        if (overlay) {
          desiredWorldQ = glm::normalize(computeOverlayDeltaWorld(canon, *overlay) * desiredWorldQ);
        }
        targetWorldQ[idx] = desiredWorldQ;
        localR[idx] = glm::normalize(glm::inverse(parentWorldQ) * desiredWorldQ);
        continue;
      }
    }
    targetWorldQ[idx] = glm::normalize(parentWorldQ * localR[idx]);
  }

  buildPaletteFromTargetLocals(localT, localR, localS, outPalette);
}

void CharacterAnimator::evaluateLayered(
  const SourceClip& lowerClip,
  float lowerTime,
  const SourceClip& upperClip,
  float upperTime,
  float upperWeight,
  std::array<glm::mat4, kMaxSkinBones>& outPalette,
  const CharacterPoseOverlay* overlay
) const {
  const float rawW = std::clamp(upperWeight, 0.0f, 1.0f);
  const float w = rawW * rawW * (3.0f - 2.0f * rawW);
  if (w <= 0.001f) {
    evaluateClip(lowerClip, lowerTime, outPalette, overlay);
    return;
  }
  if (!target_ || !target_->skin.valid) {
    outPalette.fill(glm::mat4(1.0f));
    return;
  }

  std::vector<glm::quat> srcLowerQ, srcUpperQ;
  glm::vec3 hipL(0.0f), hipU(0.0f);
  sampleSourcePose(lowerClip, lowerTime, srcLowerQ, hipL);
  sampleSourcePose(upperClip, upperTime, srcUpperQ, hipU);

  auto boneUpperMask = [](const std::string& canon) -> float {
    if (canon == "Spine") return 0.55f;
    if (canon == "Spine1") return 0.85f;
    if (canon == "Spine2" || canon == "Neck" || canon == "Head") return 1.0f;
    if (canon.rfind("LeftShoulder", 0) == 0 || canon.rfind("LeftArm", 0) == 0 ||
        canon.rfind("LeftForeArm", 0) == 0 || canon.rfind("LeftHand", 0) == 0 ||
        canon.rfind("RightShoulder", 0) == 0 || canon.rfind("RightArm", 0) == 0 ||
        canon.rfind("RightForeArm", 0) == 0 || canon.rfind("RightHand", 0) == 0) {
      return 1.0f;
    }
    return 0.0f;
  };

  const size_t n = target_->nodes.size();
  std::vector<glm::vec3> localT(n);
  std::vector<glm::quat> localR(n);
  std::vector<glm::vec3> localS(n);
  for (size_t i = 0; i < n; ++i) {
    localT[i] = target_->nodes[i].restT;
    localR[i] = target_->nodes[i].restR;
    localS[i] = target_->nodes[i].restS;
  }

  if (targetHipsNode_ >= 0) {
    const float srcH = std::abs(lowerClip.srcRestHipPos.y) > 0.1f ? std::abs(lowerClip.srcRestHipPos.y) : targetHipHeight_;
    const float hipScale = std::clamp(targetHipHeight_ / srcH, 0.004f, 250.0f);
    const glm::vec3 d = (hipL - lowerClip.srcRestHipPos) * hipScale;
    const float unitScale = targetHipHeight_ / 0.95f;
    localT[targetHipsNode_].y += std::clamp(d.y, -0.88f * unitScale, 0.35f * unitScale);
    localT[targetHipsNode_].x += std::clamp(d.x * 0.35f, -0.22f * unitScale, 0.22f * unitScale);
  }

  std::vector<glm::quat> targetWorldQ = targetRestWorldQ_;
  for (int32_t idx : targetTopoOrder_) {
    const int32_t p = target_->nodes[idx].parent;
    const glm::quat parentWorldQ = (p >= 0) ? targetWorldQ[p] : glm::quat(1.0f, 0.0f, 0.0f, 0.0f);
    const std::string& canon = targetCanonicalNames_[idx];

    if (!canon.empty()) {
      auto itL = lowerClip.canonicalToSrcNode.find(canon);
      auto itU = upperClip.canonicalToSrcNode.find(canon);
      const float mask = w * boneUpperMask(canon);
      if (itL != lowerClip.canonicalToSrcNode.end() && itU != upperClip.canonicalToSrcNode.end()) {
        const glm::quat wL = glm::normalize((srcLowerQ[itL->second] * glm::inverse(lowerClip.srcRestWorldQ[itL->second])) * targetRestWorldQ_[idx]);
        const glm::quat wU = glm::normalize((srcUpperQ[itU->second] * glm::inverse(upperClip.srcRestWorldQ[itU->second])) * targetRestWorldQ_[idx]);
        glm::quat desiredWorldQ = glm::normalize(glm::slerp(wL, wU, mask));
        if (overlay) {
          desiredWorldQ = glm::normalize(computeOverlayDeltaWorld(canon, *overlay) * desiredWorldQ);
        }
        targetWorldQ[idx] = desiredWorldQ;
        localR[idx] = glm::normalize(glm::inverse(parentWorldQ) * desiredWorldQ);
        continue;
      } else if (itL != lowerClip.canonicalToSrcNode.end()) {
        glm::quat wL = glm::normalize((srcLowerQ[itL->second] * glm::inverse(lowerClip.srcRestWorldQ[itL->second])) * targetRestWorldQ_[idx]);
        if (overlay) {
          wL = glm::normalize(computeOverlayDeltaWorld(canon, *overlay) * wL);
        }
        targetWorldQ[idx] = wL;
        localR[idx] = glm::normalize(glm::inverse(parentWorldQ) * wL);
        continue;
      }
    }
    targetWorldQ[idx] = glm::normalize(parentWorldQ * localR[idx]);
  }

  buildPaletteFromTargetLocals(localT, localR, localS, outPalette);
}

glm::quat CharacterAnimator::computeOverlayDeltaWorld(
  const std::string& canon,
  const CharacterPoseOverlay& ov
) const {
  const float t = ov.timeSec + ov.seed * 7.13f;
  // Non-repeating two-octave breathing & micro-sway
  const float breath = 0.65f * std::sin(t * 1.65f) + 0.35f * std::sin(t * 2.71f + 1.1f);
  const float swayYaw = (0.62f * std::sin(t * 0.58f) + 0.38f * std::cos(t * 1.13f)) * 0.042f * ov.idleWeight;
  const float swayRoll = std::sin(t * 0.49f + 0.8f) * 0.022f * ov.idleWeight;
  const float scanYaw = (0.65f * std::sin(t * 0.43f) + 0.35f * std::sin(t * 0.91f)) * 0.11f * ov.idleWeight;
  const float scanPitch = std::sin(t * 0.37f + 1.7f) * 0.045f * ov.idleWeight;

  const float lean = ov.sprintLean * 0.16f;
  const float bank = std::clamp(ov.turnBank, -1.0f, 1.0f) * 0.12f;
  const float recoil = ov.recoilKick;
  const float reloadDip = std::sin(std::clamp(ov.reloadProgress, 0.0f, 1.0f) * 3.1415926f);

  float pitchX = 0.0f;
  float yawY = 0.0f;
  float rollZ = 0.0f;

  if (canon == "Spine" || canon == "Spine1") {
    const float w = (canon == "Spine") ? 0.5f : 0.65f;
    pitchX += lean * w + breath * 0.014f * (0.4f + 0.6f * ov.idleWeight) - recoil * 0.07f * w + reloadDip * 0.08f * w;
    yawY += swayYaw * w - ov.weaponHoldWeight * (0.14f + 0.12f * ov.aimWeight) * w;
    rollZ += swayRoll * w + bank * w;
  } else if (canon == "Spine2") {
    pitchX += lean * 0.45f + breath * 0.020f * (0.45f + 0.55f * ov.idleWeight) - recoil * 0.11f + reloadDip * 0.10f;
    yawY += swayYaw * 0.5f - ov.weaponHoldWeight * (0.12f + 0.10f * ov.aimWeight);
    rollZ += bank * 0.45f;
  } else if (canon == "Neck" || canon == "Head") {
    const float hw = (canon == "Neck") ? 0.42f : 0.65f;
    pitchX += -ov.headLookPitch * hw + scanPitch * hw - recoil * 0.04f * hw + reloadDip * 0.12f * hw;
    yawY += ov.headLookYaw * hw + scanYaw * hw + ov.weaponHoldWeight * 0.18f * hw;
  } else if (canon == "RightShoulder" || canon == "RightArm") {
    if (ov.weaponHoldWeight > 0.01f) {
      const float w = ov.weaponHoldWeight;
      const float raise = (canon == "RightShoulder") ? 0.18f : (0.98f + 0.22f * ov.aimWeight);
      pitchX += (-raise - recoil * 0.24f + reloadDip * 0.35f) * w;
      yawY += (0.16f * ov.aimWeight + reloadDip * 0.25f) * w;
      rollZ += (canon == "RightArm") ? (-0.28f * w) : 0.0f;
    } else {
      pitchX += breath * 0.012f * ov.idleWeight;
    }
  } else if (canon == "RightForeArm") {
    if (ov.weaponHoldWeight > 0.01f) {
      const float w = ov.weaponHoldWeight;
      pitchX += (-0.42f - 0.16f * ov.aimWeight - recoil * 0.18f - reloadDip * 0.45f) * w;
      yawY += (0.28f + 0.15f * ov.aimWeight) * w;
    }
  } else if (canon == "LeftShoulder" || canon == "LeftArm") {
    if (ov.weaponHoldWeight > 0.01f) {
      const float w = ov.weaponHoldWeight * (ov.twoHandedWeapon ? 1.0f : 0.72f * ov.aimWeight);
      const float raise = (canon == "LeftShoulder") ? 0.16f : (0.94f + 0.20f * ov.aimWeight);
      pitchX += (-raise - recoil * 0.16f + reloadDip * 0.55f) * w;
      yawY += (-0.42f - 0.18f * ov.aimWeight) * w;
      rollZ += (canon == "LeftArm") ? (0.32f * w) : 0.0f;
    } else {
      pitchX += breath * 0.012f * ov.idleWeight;
    }
  } else if (canon == "LeftForeArm") {
    if (ov.weaponHoldWeight > 0.01f) {
      const float w = ov.weaponHoldWeight * (ov.twoHandedWeapon ? 1.0f : 0.75f * ov.aimWeight);
      pitchX += (-0.36f - 0.18f * ov.aimWeight - reloadDip * 0.35f) * w;
      yawY += (-0.52f - 0.12f * ov.aimWeight) * w;
    }
  }

  if (std::abs(pitchX) < 1e-5f && std::abs(yawY) < 1e-5f && std::abs(rollZ) < 1e-5f) {
    return glm::quat(1.0f, 0.0f, 0.0f, 0.0f);
  }
  return glm::normalize(
    glm::angleAxis(yawY, glm::vec3(0.0f, 1.0f, 0.0f)) *
    glm::angleAxis(pitchX, glm::vec3(1.0f, 0.0f, 0.0f)) *
    glm::angleAxis(rollZ, glm::vec3(0.0f, 0.0f, 1.0f))
  );
}

void CharacterAnimator::advanceAnimState(
  CharacterAnimState& st,
  const std::string& desiredClip,
  float desiredTime,
  const std::string& desiredUpperClip,
  float desiredUpperTime,
  float dt,
  float crossfadeSec
) {
  if (desiredClip != st.currClip) {
    st.prevClip = st.currClip;
    st.prevTime = st.currTime;
    st.currClip = desiredClip;
    st.currTime = desiredTime;
    st.blend = 0.0f;
    st.blendDuration = std::max(0.04f, crossfadeSec);
  } else {
    st.currTime = desiredTime;
  }

  st.prevTime += dt;
  if (st.blend < 1.0f) {
    st.blend = std::min(1.0f, st.blend + dt / std::max(0.04f, st.blendDuration));
  }

  if (!desiredUpperClip.empty()) {
    if (desiredUpperClip != st.upperClip) {
      st.upperClip = desiredUpperClip;
    }
    st.upperTime = desiredUpperTime;
    st.upperWeight = std::min(1.0f, st.upperWeight + dt * 16.0f);
  } else {
    st.upperTime += dt;
    st.upperWeight = std::max(0.0f, st.upperWeight - dt * 11.0f);
    if (st.upperWeight <= 0.005f) {
      st.upperWeight = 0.0f;
      st.upperClip.clear();
    }
  }
}

void CharacterAnimator::evaluateState(
  const CharacterAnimState& st,
  const std::unordered_map<std::string, SourceClip>& clips,
  std::array<glm::mat4, kMaxSkinBones>& outPalette,
  const CharacterPoseOverlay* overlay
) const {
  auto itCurr = clips.find(st.currClip);
  if (itCurr == clips.end()) {
    evaluateRest(outPalette);
    return;
  }

  auto itUpper = (!st.upperClip.empty() && st.upperWeight > 0.01f) ? clips.find(st.upperClip) : clips.end();
  if (itUpper != clips.end()) {
    // Lower body plays current locomotion/stance, upper body layers combat strike/block!
    evaluateLayered(itCurr->second, st.currTime, itUpper->second, st.upperTime, st.upperWeight, outPalette, overlay);
    return;
  }

  auto itPrev = (st.blend < 0.999f) ? clips.find(st.prevClip) : clips.end();
  if (itPrev != clips.end() && st.prevClip != st.currClip) {
    evaluateBlended(itPrev->second, st.prevTime, itCurr->second, st.currTime, st.blend, outPalette, overlay);
  } else {
    evaluateClip(itCurr->second, st.currTime, outPalette, overlay);
  }
}

void CharacterAnimator::buildPaletteFromTargetLocals(
  const std::vector<glm::vec3>& localT,
  const std::vector<glm::quat>& localR,
  const std::vector<glm::vec3>& localS,
  std::array<glm::mat4, kMaxSkinBones>& outPalette
) const {
  const size_t n = target_->nodes.size();
  std::vector<glm::mat4> world(n, glm::mat4(1.0f));
  for (int32_t idx : targetTopoOrder_) {
    const glm::mat4 local =
      glm::translate(glm::mat4(1.0f), localT[idx]) *
      glm::mat4_cast(localR[idx]) *
      glm::scale(glm::mat4(1.0f), localS[idx]);
    const int32_t p = target_->nodes[idx].parent;
    world[idx] = (p >= 0) ? (world[p] * local) : local;
  }

  const size_t jointCount = std::min<size_t>(kMaxSkinBones, target_->skin.jointNodeIndices.size());
  for (size_t ji = 0; ji < jointCount; ++ji) {
    const int32_t jn = target_->skin.jointNodeIndices[ji];
    if (jn >= 0 && static_cast<size_t>(jn) < n) {
      outPalette[ji] = world[jn] * target_->skin.inverseBindMatrices[ji];
    }
  }
}

} // namespace westgate
