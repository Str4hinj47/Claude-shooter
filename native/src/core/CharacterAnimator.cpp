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
  return !outClip.canonicalToSrcNode.empty();
}

void CharacterAnimator::initForTarget(const GltfModel& targetModel) {
  target_ = &targetModel;
  targetTopoOrder_ = buildTopologicalOrder(targetModel.nodes);
  targetCanonicalNames_.resize(targetModel.nodes.size());
  std::vector<glm::quat> restLocal(targetModel.nodes.size(), glm::quat(1.0f, 0.0f, 0.0f, 0.0f));
  for (size_t i = 0; i < targetModel.nodes.size(); ++i) {
    restLocal[i] = targetModel.nodes[i].restR;
    targetCanonicalNames_[i] = canonicalizeBoneName(targetModel.nodes[i].name);
    if (targetCanonicalNames_[i] == "Hips") {
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
  std::array<glm::mat4, kMaxSkinBones>& outPalette
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

  std::vector<glm::quat> targetWorldQ = targetRestWorldQ_;
  for (int32_t idx : targetTopoOrder_) {
    const int32_t p = target_->nodes[idx].parent;
    const glm::quat parentWorldQ = (p >= 0) ? targetWorldQ[p] : glm::quat(1.0f, 0.0f, 0.0f, 0.0f);

    const std::string& canon = targetCanonicalNames_[idx];
    if (!canon.empty()) {
      auto sit = src.canonicalToSrcNode.find(canon);
      if (sit != src.canonicalToSrcNode.end()) {
        const int32_t si = sit->second;
        // World-space rotation delta from source rest -> source anim, applied to target rest world quat
        const glm::quat deltaWorld = srcWorldQ[si] * glm::inverse(src.srcRestWorldQ[si]);
        const glm::quat desiredWorldQ = glm::normalize(deltaWorld * targetRestWorldQ_[idx]);
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
  std::array<glm::mat4, kMaxSkinBones>& outPalette
) const {
  const float rawB = std::clamp(blend, 0.0f, 1.0f);
  const float b = rawB * rawB * (3.0f - 2.0f * rawB);
  if (b <= 0.001f) {
    evaluateClip(clipA, timeA, outPalette);
    return;
  }
  if (b >= 0.999f) {
    evaluateClip(clipB, timeB, outPalette);
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
        const glm::quat desiredWorldQ = glm::normalize(glm::slerp(wA, wB, b));
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
  std::array<glm::mat4, kMaxSkinBones>& outPalette
) const {
  const float rawW = std::clamp(upperWeight, 0.0f, 1.0f);
  const float w = rawW * rawW * (3.0f - 2.0f * rawW);
  if (w <= 0.001f) {
    evaluateClip(lowerClip, lowerTime, outPalette);
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
        const glm::quat desiredWorldQ = glm::normalize(glm::slerp(wL, wU, mask));
        targetWorldQ[idx] = desiredWorldQ;
        localR[idx] = glm::normalize(glm::inverse(parentWorldQ) * desiredWorldQ);
        continue;
      } else if (itL != lowerClip.canonicalToSrcNode.end()) {
        const glm::quat wL = glm::normalize((srcLowerQ[itL->second] * glm::inverse(lowerClip.srcRestWorldQ[itL->second])) * targetRestWorldQ_[idx]);
        targetWorldQ[idx] = wL;
        localR[idx] = glm::normalize(glm::inverse(parentWorldQ) * wL);
        continue;
      }
    }
    targetWorldQ[idx] = glm::normalize(parentWorldQ * localR[idx]);
  }

  buildPaletteFromTargetLocals(localT, localR, localS, outPalette);
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
