#include "westgate/CharacterAnimator.hpp"
#include <algorithm>
#include <array>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <string>
#include <unordered_map>
#include <vector>

namespace westgate {

namespace {

constexpr float kPi = 3.14159265358979323846f;

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

void computeWorldTransforms(
  const std::vector<GltfNodeInfo>& nodes,
  const std::vector<int32_t>& topo,
  const std::vector<glm::vec3>& localT,
  const std::vector<glm::quat>& localR,
  const std::vector<glm::vec3>& localS,
  std::vector<glm::quat>& outWorldQ,
  std::vector<glm::vec3>& outWorldPos,
  std::vector<glm::mat4>* outWorldMat = nullptr
) {
  const size_t n = nodes.size();
  outWorldQ.resize(n, glm::quat(1.0f, 0.0f, 0.0f, 0.0f));
  outWorldPos.resize(n, glm::vec3(0.0f));
  std::vector<glm::mat4> worldMat(n, glm::mat4(1.0f));

  for (int32_t idx : topo) {
    const int32_t p = nodes[idx].parent;
    const glm::mat4 localM =
      glm::translate(glm::mat4(1.0f), localT[idx]) *
      glm::mat4_cast(localR[idx]) *
      glm::scale(glm::mat4(1.0f), localS[idx]);
    if (p >= 0) {
      outWorldQ[idx] = glm::normalize(outWorldQ[p] * localR[idx]);
      worldMat[idx] = worldMat[p] * localM;
    } else {
      outWorldQ[idx] = glm::normalize(localR[idx]);
      worldMat[idx] = localM;
    }
    outWorldPos[idx] = glm::vec3(worldMat[idx][3]);
  }
  if (outWorldMat) *outWorldMat = std::move(worldMat);
}

glm::quat rotationBetweenUnitVecs(const glm::vec3& from, const glm::vec3& to) {
  const float d = glm::clamp(glm::dot(from, to), -1.0f, 1.0f);
  if (d > 0.99995f) return glm::quat(1.0f, 0.0f, 0.0f, 0.0f);
  if (d < -0.99995f) {
    glm::vec3 ortho = glm::cross(glm::vec3(1.0f, 0.0f, 0.0f), from);
    if (glm::dot(ortho, ortho) < 1e-5f) {
      ortho = glm::cross(glm::vec3(0.0f, 1.0f, 0.0f), from);
    }
    return glm::angleAxis(kPi, glm::normalize(ortho));
  }
  const glm::vec3 c = glm::cross(from, to);
  return glm::normalize(glm::quat(1.0f + d, c.x, c.y, c.z));
}

float detectFacingYaw(
  const std::unordered_map<std::string, int32_t>& canonToNode,
  const std::vector<glm::vec3>& worldPos
) {
  auto findPair = [&](const char* lName, const char* rName, float& outDx) -> bool {
    auto itL = canonToNode.find(lName);
    auto itR = canonToNode.find(rName);
    if (itL == canonToNode.end() || itR == canonToNode.end()) return false;
    outDx = worldPos[itL->second].x - worldPos[itR->second].x;
    return std::abs(outDx) > 0.02f;
  };
  float dx = 0.0f;
  if (findPair("LeftArm", "RightArm", dx) || findPair("LeftUpLeg", "RightUpLeg", dx)) {
    return (dx < 0.0f) ? kPi : 0.0f;
  }
  return 0.0f;
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
  SourceClip& outClip,
  float tStart,
  float tEnd,
  bool pingPong
) {
  if (clipIndex >= animModel.animations.size()) return false;
  outClip = SourceClip{};
  outClip.id = id;
  outClip.loop = loop;
  outClip.pingPong = pingPong;
  outClip.srcNodes = animModel.nodes;
  outClip.clip = animModel.animations[clipIndex];
  outClip.rawDuration = std::max(0.01f, outClip.clip.duration);
  outClip.tStart = std::clamp(tStart, 0.0f, outClip.rawDuration);
  const float endVal = (tEnd > outClip.tStart) ? std::min(tEnd, outClip.rawDuration) : outClip.rawDuration;
  outClip.tEnd = endVal;
  outClip.duration = std::max(0.01f, outClip.tEnd - outClip.tStart);

  outClip.srcTopoOrder = buildTopologicalOrder(outClip.srcNodes);
  const size_t n = outClip.srcNodes.size();
  std::vector<glm::vec3> restT(n);
  std::vector<glm::quat> restR(n);
  std::vector<glm::vec3> restS(n);
  for (size_t i = 0; i < n; ++i) {
    restT[i] = outClip.srcNodes[i].restT;
    restR[i] = outClip.srcNodes[i].restR;
    restS[i] = outClip.srcNodes[i].restS;
    const std::string canon = canonicalizeBoneName(outClip.srcNodes[i].name);
    if (!canon.empty()) {
      outClip.canonicalToSrcNode[canon] = static_cast<int32_t>(i);
    }
  }
  computeWorldTransforms(
    outClip.srcNodes,
    outClip.srcTopoOrder,
    restT,
    restR,
    restS,
    outClip.srcRestWorldQ,
    outClip.srcRestWorldPos
  );
  outClip.srcFacingYaw = detectFacingYaw(outClip.canonicalToSrcNode, outClip.srcRestWorldPos);

  auto hipIt = outClip.canonicalToSrcNode.find("Hips");
  if (hipIt != outClip.canonicalToSrcNode.end()) {
    outClip.srcRestHipPos = outClip.srcNodes[hipIt->second].restT;
    outClip.srcRestHipWorldPos = outClip.srcRestWorldPos[hipIt->second];
  }
  return !outClip.canonicalToSrcNode.empty();
}

void CharacterAnimator::initForTarget(const GltfModel& targetModel) {
  target_ = &targetModel;
  alignedBindCache_.clear();
  canonicalToTargetNode_.clear();
  fingerCurlByNode_.clear();
  targetTopoOrder_ = buildTopologicalOrder(targetModel.nodes);
  targetCanonicalNames_.resize(targetModel.nodes.size());
  targetHipsNode_ = -1;
  targetHipHeight_ = 0.95f;
  targetFacingYaw_ = 0.0f;
  targetHipsParentInvRotScale_ = glm::mat3(1.0f);

  const size_t n = targetModel.nodes.size();
  std::vector<glm::vec3> restT(n);
  std::vector<glm::quat> restR(n);
  std::vector<glm::vec3> restS(n);
  for (size_t i = 0; i < n; ++i) {
    restT[i] = targetModel.nodes[i].restT;
    restR[i] = targetModel.nodes[i].restR;
    restS[i] = targetModel.nodes[i].restS;
    targetCanonicalNames_[i] = canonicalizeBoneName(targetModel.nodes[i].name);
    if (!targetCanonicalNames_[i].empty()) {
      canonicalToTargetNode_[targetCanonicalNames_[i]] = static_cast<int32_t>(i);
    }
    if (targetCanonicalNames_[i] == "Hips") {
      targetHipsNode_ = static_cast<int32_t>(i);
    }
  }
  std::vector<glm::mat4> worldMats;
  computeWorldTransforms(
    targetModel.nodes,
    targetTopoOrder_,
    restT,
    restR,
    restS,
    targetRestWorldQ_,
    targetRestWorldPos_,
    &worldMats
  );
  targetFacingYaw_ = detectFacingYaw(canonicalToTargetNode_, targetRestWorldPos_);
  if (targetHipsNode_ >= 0) {
    targetHipHeight_ = std::max(0.45f, std::abs(targetRestWorldPos_[targetHipsNode_].y));
    const int32_t p = targetModel.nodes[targetHipsNode_].parent;
    if (p >= 0) {
      const glm::mat3 pMat(worldMats[p]);
      if (std::abs(glm::determinant(pMat)) > 1e-8f) {
        targetHipsParentInvRotScale_ = glm::inverse(pMat);
      }
    }
  }

  // Precompute skin joint index + mesh-space bind origin per canonical bone for socket queries
  canonicalToSkinJoint_.clear();
  skinJointBindOriginMesh_.assign(targetModel.skin.jointNodeIndices.size(), glm::vec4(0.0f, 0.0f, 0.0f, 1.0f));
  for (size_t ji = 0; ji < targetModel.skin.jointNodeIndices.size(); ++ji) {
    const int32_t jn = targetModel.skin.jointNodeIndices[ji];
    if (jn >= 0 && static_cast<size_t>(jn) < targetCanonicalNames_.size() && !targetCanonicalNames_[jn].empty()) {
      canonicalToSkinJoint_.emplace(targetCanonicalNames_[jn], static_cast<uint32_t>(ji));
    }
    if (ji < targetModel.skin.inverseBindMatrices.size()) {
      const glm::mat4& ibm = targetModel.skin.inverseBindMatrices[ji];
      if (std::abs(glm::determinant(ibm)) > 1e-12f) {
        skinJointBindOriginMesh_[ji] = glm::inverse(ibm) * glm::vec4(0.0f, 0.0f, 0.0f, 1.0f);
      }
    }
  }

  // Build automatic per-finger inward curl axes from palm geometry
  for (int sideIdx = 0; sideIdx < 2; ++sideIdx) {
    const std::string side = (sideIdx == 0) ? "Left" : "Right";
    auto findNode = [&](const std::string& c) -> int32_t {
      auto it = canonicalToTargetNode_.find(c);
      return (it != canonicalToTargetNode_.end()) ? it->second : -1;
    };
    const int32_t handN = findNode(side + "Hand");
    int32_t midN = findNode(side + "HandMiddle1");
    if (midN < 0) midN = findNode(side + "HandMiddle");
    int32_t idxN = findNode(side + "HandIndex1");
    if (idxN < 0) idxN = findNode(side + "HandIndex");
    int32_t pnkN = findNode(side + "HandPinky1");
    if (pnkN < 0) pnkN = findNode(side + "HandPinky");
    if (handN < 0 || midN < 0 || idxN < 0 || pnkN < 0) continue;

    const glm::vec3 hp = targetRestWorldPos_[handN];
    const glm::vec3 fwd = glm::normalize(targetRestWorldPos_[midN] - hp);
    const glm::vec3 across = targetRestWorldPos_[idxN] - targetRestWorldPos_[pnkN];
    glm::vec3 palmIn = glm::cross(fwd, across);
    if (sideIdx == 1) palmIn = -palmIn;
    if (glm::dot(palmIn, palmIn) < 1e-6f) continue;
    palmIn = glm::normalize(palmIn);

    const char* fingerNames[] = {"Index", "Middle", "Ring", "Pinky", "Thumb"};
    for (int f = 0; f < 5; ++f) {
      const std::string fn = fingerNames[f];
      for (int seg = 1; seg <= 3; ++seg) {
        const std::string c = side + "Hand" + fn + std::to_string(seg);
        const int32_t bn = findNode(c);
        if (bn < 0) continue;
        glm::vec3 boneDir(0.0f);
        if (seg < 3) {
          const int32_t nextN = findNode(side + "Hand" + fn + std::to_string(seg + 1));
          if (nextN >= 0) boneDir = targetRestWorldPos_[nextN] - targetRestWorldPos_[bn];
        } else {
          // Terminal phalanx: inherit parent segment direction
          const int32_t prevN = findNode(side + "Hand" + fn + std::to_string(seg - 1));
          if (prevN >= 0) boneDir = targetRestWorldPos_[bn] - targetRestWorldPos_[prevN];
        }
        if (glm::dot(boneDir, boneDir) < 1e-6f) continue;
        boneDir = glm::normalize(boneDir);
        glm::vec3 axisWorld = glm::cross(boneDir, palmIn);
        if (glm::dot(axisWorld, axisWorld) < 1e-6f) continue;
        axisWorld = glm::normalize(axisWorld);
        const glm::vec3 localAxis = glm::normalize(glm::inverse(targetRestWorldQ_[bn]) * axisWorld);
        FingerCurlInfo info;
        info.localAxis = localAxis;
        if (fn == "Thumb") {
          info.curlScale = (seg == 1) ? 0.55f : (seg == 2 ? 0.72f : 0.85f);
        } else {
          info.curlScale = (seg == 1) ? 1.05f : (seg == 2 ? 1.18f : 0.92f);
        }
        fingerCurlByNode_[bn] = info;
      }
    }
  }
}

const CharacterAnimator::AlignedTargetBind& CharacterAnimator::getOrBuildAlignedBind(
  const SourceClip& src
) const {
  auto it = alignedBindCache_.find(src.id);
  if (it != alignedBindCache_.end()) return it->second;

  AlignedTargetBind out;
  const size_t n = target_->nodes.size();
  std::vector<glm::vec3> localT(n);
  std::vector<glm::quat> localR(n);
  std::vector<glm::vec3> localS(n);
  for (size_t i = 0; i < n; ++i) {
    localT[i] = target_->nodes[i].restT;
    localR[i] = target_->nodes[i].restR;
    localS[i] = target_->nodes[i].restS;
  }

  std::vector<glm::quat> worldQ = targetRestWorldQ_;
  std::vector<glm::vec3> worldPos = targetRestWorldPos_;

  const float relYaw = targetFacingYaw_ - src.srcFacingYaw;
  const glm::quat relFacingQ = glm::angleAxis(relYaw, glm::vec3(0.0f, 1.0f, 0.0f));

  static const std::pair<const char*, const char*> kAlignPairs[] = {
    {"LeftShoulder", "LeftArm"},
    {"LeftArm", "LeftForeArm"},
    {"LeftForeArm", "LeftHand"},
    {"LeftHand", "LeftHandMiddle1"},
    {"RightShoulder", "RightArm"},
    {"RightArm", "RightForeArm"},
    {"RightForeArm", "RightHand"},
    {"RightHand", "RightHandMiddle1"},
    {"LeftUpLeg", "LeftLeg"},
    {"LeftLeg", "LeftFoot"},
    {"RightUpLeg", "RightLeg"},
    {"RightLeg", "RightFoot"},
  };

  for (const auto& pair : kAlignPairs) {
    auto itB = canonicalToTargetNode_.find(pair.first);
    auto itC = canonicalToTargetNode_.find(pair.second);
    if (itB == canonicalToTargetNode_.end() || itC == canonicalToTargetNode_.end()) continue;
    auto itSB = src.canonicalToSrcNode.find(pair.first);
    auto itSC = src.canonicalToSrcNode.find(pair.second);
    if (itSB == src.canonicalToSrcNode.end() || itSC == src.canonicalToSrcNode.end()) continue;

    const int32_t b = itB->second;
    const int32_t c = itC->second;
    const int32_t sb = itSB->second;
    const int32_t sc = itSC->second;

    const glm::vec3 tVec = worldPos[c] - worldPos[b];
    const glm::vec3 sVec = relFacingQ * (src.srcRestWorldPos[sc] - src.srcRestWorldPos[sb]);
    if (glm::dot(tVec, tVec) < 1e-6f || glm::dot(sVec, sVec) < 1e-6f) continue;

    const glm::quat fix = rotationBetweenUnitVecs(glm::normalize(tVec), glm::normalize(sVec));
    const int32_t p = target_->nodes[b].parent;
    const glm::quat parentQ = (p >= 0) ? worldQ[p] : glm::quat(1.0f, 0.0f, 0.0f, 0.0f);
    const glm::quat alignedWorld = glm::normalize(fix * worldQ[b]);
    localR[b] = glm::normalize(glm::inverse(parentQ) * alignedWorld);

    computeWorldTransforms(target_->nodes, targetTopoOrder_, localT, localR, localS, worldQ, worldPos);
  }

  out.worldQ = std::move(worldQ);
  auto [insIt, _] = alignedBindCache_.emplace(src.id, std::move(out));
  return insIt->second;
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
  glm::vec3& outSrcHipWorldPos
) const {
  const size_t n = src.srcNodes.size();
  std::vector<glm::vec3> localT(n);
  std::vector<glm::quat> localR(n);
  std::vector<glm::vec3> localS(n);
  for (size_t i = 0; i < n; ++i) {
    localT[i] = src.srcNodes[i].restT;
    localR[i] = src.srcNodes[i].restR;
    localS[i] = src.srcNodes[i].restS;
  }

  float t = src.tStart;
  if (src.duration > 1e-4f) {
    if (src.loop) {
      if (src.pingPong) {
        const float cyc = std::fmod(std::max(0.0f, timeSec), src.duration * 2.0f);
        const float u = (cyc <= src.duration) ? cyc : (src.duration * 2.0f - cyc);
        t = src.tStart + u;
      } else {
        t = src.tStart + std::fmod(std::max(0.0f, timeSec), src.duration);
      }
    } else {
      t = src.tStart + std::clamp(timeSec, 0.0f, src.duration);
    }
  }

  for (const auto& ch : src.clip.channels) {
    if (ch.targetNode < 0 || static_cast<size_t>(ch.targetNode) >= n) continue;
    if (ch.path == GltfAnimPath::Rotation) {
      sampleChannelQuat(ch, t, localR[ch.targetNode]);
    } else if (ch.path == GltfAnimPath::Translation) {
      sampleChannelVec3(ch, t, localT[ch.targetNode]);
    }
  }

  std::vector<glm::vec3> worldPos;
  computeWorldTransforms(src.srcNodes, src.srcTopoOrder, localT, localR, localS, outSrcWorldQ, worldPos);
  auto it = src.canonicalToSrcNode.find("Hips");
  if (it != src.canonicalToSrcNode.end()) {
    outSrcHipWorldPos = worldPos[it->second];
  } else {
    outSrcHipWorldPos = glm::vec3(0.0f);
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
  glm::vec3 srcHipWorldPos(0.0f);
  sampleSourcePose(src, timeSec, srcWorldQ, srcHipWorldPos);

  const AlignedTargetBind& aligned = getOrBuildAlignedBind(src);
  const float relYaw = targetFacingYaw_ - src.srcFacingYaw;
  const glm::quat relFacingQ = glm::angleAxis(relYaw, glm::vec3(0.0f, 1.0f, 0.0f));
  const glm::quat invRelFacingQ = glm::inverse(relFacingQ);

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
    const float srcH = std::abs(src.srcRestHipWorldPos.y) > 0.1f ? std::abs(src.srcRestHipWorldPos.y) : targetHipHeight_;
    const float hipScale = std::clamp(targetHipHeight_ / srcH, 0.25f, 4.0f);
    glm::vec3 dWorld = relFacingQ * (srcHipWorldPos - src.srcRestHipWorldPos) * hipScale;
    const float unitScale = targetHipHeight_ / 0.95f;
    if (overlay && overlay->koProgress > 0.001f) {
      const float k = std::clamp(overlay->koProgress, 0.0f, 1.0f);
      const float ks = k * k * (3.0f - 2.0f * k);
      const float koAngle = ks * 1.48f;
      dWorld.y -= 0.78f * std::sin(koAngle) * unitScale;
    } else if (overlay) {
      dWorld.y -= 0.34f * std::clamp(overlay->crouchWeight, 0.0f, 1.0f) * unitScale;
      dWorld.y += 0.06f * std::clamp(overlay->airWeight, 0.0f, 1.0f) * unitScale;
    }
    dWorld.y = std::clamp(dWorld.y, -1.10f * unitScale, 0.35f * unitScale);
    dWorld.x = std::clamp(dWorld.x * 0.45f, -0.25f * unitScale, 0.25f * unitScale);
    dWorld.z = std::clamp(dWorld.z * 0.45f, -0.35f * unitScale, 0.35f * unitScale);
    localT[targetHipsNode_] += targetHipsParentInvRotScale_ * dWorld;
  }

  glm::quat koFallWorldQ(1.0f, 0.0f, 0.0f, 0.0f);
  bool hasKoFall = false;
  if (overlay && overlay->koProgress > 0.001f) {
    const float k = std::clamp(overlay->koProgress, 0.0f, 1.0f);
    const float ks = k * k * (3.0f - 2.0f * k);
    const float koAngle = ks * 1.48f;
    const float fSign = (std::abs(targetFacingYaw_) > 1.5f) ? -1.0f : 1.0f;
    koFallWorldQ = glm::normalize(
      glm::angleAxis(-koAngle * fSign, glm::vec3(1.0f, 0.0f, 0.0f)) *
      glm::angleAxis(0.14f * ks * fSign, glm::vec3(0.0f, 0.0f, 1.0f))
    );
    hasKoFall = true;
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
        const glm::quat srcDeltaWorld = srcWorldQ[si] * glm::inverse(src.srcRestWorldQ[si]);
        const glm::quat deltaWorld = relFacingQ * srcDeltaWorld * invRelFacingQ;
        glm::quat desiredWorldQ = glm::normalize(deltaWorld * aligned.worldQ[idx]);
        if (overlay) {
          desiredWorldQ = glm::normalize(computeOverlayDeltaWorld(canon, *overlay) * desiredWorldQ);
        }
        if (hasKoFall) {
          desiredWorldQ = glm::normalize(koFallWorldQ * desiredWorldQ);
        }
        targetWorldQ[idx] = desiredWorldQ;
        localR[idx] = glm::normalize(glm::inverse(parentWorldQ) * desiredWorldQ);
      } else {
        targetWorldQ[idx] = glm::normalize(parentWorldQ * localR[idx]);
      }
    } else {
      targetWorldQ[idx] = glm::normalize(parentWorldQ * localR[idx]);
    }

    if (overlay && overlay->fistWeight > 0.01f) {
      auto fit = fingerCurlByNode_.find(idx);
      if (fit != fingerCurlByNode_.end()) {
        const float curlRad = 1.05f * fit->second.curlScale * std::clamp(overlay->fistWeight, 0.0f, 1.0f);
        localR[idx] = glm::normalize(localR[idx] * glm::angleAxis(curlRad, fit->second.localAxis));
        targetWorldQ[idx] = glm::normalize(parentWorldQ * localR[idx]);
      }
    }
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

  const AlignedTargetBind& alignedA = getOrBuildAlignedBind(clipA);
  const AlignedTargetBind& alignedB = getOrBuildAlignedBind(clipB);
  const glm::quat relQA = glm::angleAxis(targetFacingYaw_ - clipA.srcFacingYaw, glm::vec3(0.0f, 1.0f, 0.0f));
  const glm::quat invRelQA = glm::inverse(relQA);
  const glm::quat relQB = glm::angleAxis(targetFacingYaw_ - clipB.srcFacingYaw, glm::vec3(0.0f, 1.0f, 0.0f));
  const glm::quat invRelQB = glm::inverse(relQB);

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
    const float srcHA = std::abs(clipA.srcRestHipWorldPos.y) > 0.1f ? std::abs(clipA.srcRestHipWorldPos.y) : targetHipHeight_;
    const float srcHB = std::abs(clipB.srcRestHipWorldPos.y) > 0.1f ? std::abs(clipB.srcRestHipWorldPos.y) : targetHipHeight_;
    const glm::vec3 dWorldA = relQA * (hipA - clipA.srcRestHipWorldPos) * std::clamp(targetHipHeight_ / srcHA, 0.25f, 4.0f);
    const glm::vec3 dWorldB = relQB * (hipB - clipB.srcRestHipWorldPos) * std::clamp(targetHipHeight_ / srcHB, 0.25f, 4.0f);
    glm::vec3 dWorld = glm::mix(dWorldA, dWorldB, b);
    const float unitScale = targetHipHeight_ / 0.95f;
    if (overlay && overlay->koProgress > 0.001f) {
      const float k = std::clamp(overlay->koProgress, 0.0f, 1.0f);
      const float ks = k * k * (3.0f - 2.0f * k);
      const float koAngle = ks * 1.48f;
      dWorld.y -= 0.78f * std::sin(koAngle) * unitScale;
    } else if (overlay) {
      dWorld.y -= 0.34f * std::clamp(overlay->crouchWeight, 0.0f, 1.0f) * unitScale;
      dWorld.y += 0.06f * std::clamp(overlay->airWeight, 0.0f, 1.0f) * unitScale;
    }
    dWorld.y = std::clamp(dWorld.y, -1.10f * unitScale, 0.35f * unitScale);
    dWorld.x = std::clamp(dWorld.x * 0.45f, -0.25f * unitScale, 0.25f * unitScale);
    dWorld.z = std::clamp(dWorld.z * 0.45f, -0.35f * unitScale, 0.35f * unitScale);
    localT[targetHipsNode_] += targetHipsParentInvRotScale_ * dWorld;
  }

  glm::quat koFallWorldQ(1.0f, 0.0f, 0.0f, 0.0f);
  bool hasKoFall = false;
  if (overlay && overlay->koProgress > 0.001f) {
    const float k = std::clamp(overlay->koProgress, 0.0f, 1.0f);
    const float ks = k * k * (3.0f - 2.0f * k);
    const float koAngle = ks * 1.48f;
    const float fSign = (std::abs(targetFacingYaw_) > 1.5f) ? -1.0f : 1.0f;
    koFallWorldQ = glm::normalize(
      glm::angleAxis(-koAngle * fSign, glm::vec3(1.0f, 0.0f, 0.0f)) *
      glm::angleAxis(0.14f * ks * fSign, glm::vec3(0.0f, 0.0f, 1.0f))
    );
    hasKoFall = true;
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
        const glm::quat dA = relQA * (srcWorldQA[itA->second] * glm::inverse(clipA.srcRestWorldQ[itA->second])) * invRelQA;
        const glm::quat dB = relQB * (srcWorldQB[itB->second] * glm::inverse(clipB.srcRestWorldQ[itB->second])) * invRelQB;
        const glm::quat wA = glm::normalize(dA * alignedA.worldQ[idx]);
        const glm::quat wB = glm::normalize(dB * alignedB.worldQ[idx]);
        glm::quat desiredWorldQ = glm::normalize(glm::slerp(wA, wB, b));
        if (overlay) {
          desiredWorldQ = glm::normalize(computeOverlayDeltaWorld(canon, *overlay) * desiredWorldQ);
        }
        if (hasKoFall) {
          desiredWorldQ = glm::normalize(koFallWorldQ * desiredWorldQ);
        }
        targetWorldQ[idx] = desiredWorldQ;
        localR[idx] = glm::normalize(glm::inverse(parentWorldQ) * desiredWorldQ);
      } else if (itA != clipA.canonicalToSrcNode.end()) {
        const glm::quat dA = relQA * (srcWorldQA[itA->second] * glm::inverse(clipA.srcRestWorldQ[itA->second])) * invRelQA;
        glm::quat desiredWorldQ = glm::normalize(dA * alignedA.worldQ[idx]);
        if (overlay) {
          desiredWorldQ = glm::normalize(computeOverlayDeltaWorld(canon, *overlay) * desiredWorldQ);
        }
        if (hasKoFall) {
          desiredWorldQ = glm::normalize(koFallWorldQ * desiredWorldQ);
        }
        targetWorldQ[idx] = desiredWorldQ;
        localR[idx] = glm::normalize(glm::inverse(parentWorldQ) * desiredWorldQ);
      } else if (itB != clipB.canonicalToSrcNode.end()) {
        const glm::quat dB = relQB * (srcWorldQB[itB->second] * glm::inverse(clipB.srcRestWorldQ[itB->second])) * invRelQB;
        glm::quat desiredWorldQ = glm::normalize(dB * alignedB.worldQ[idx]);
        if (overlay) {
          desiredWorldQ = glm::normalize(computeOverlayDeltaWorld(canon, *overlay) * desiredWorldQ);
        }
        if (hasKoFall) {
          desiredWorldQ = glm::normalize(koFallWorldQ * desiredWorldQ);
        }
        targetWorldQ[idx] = desiredWorldQ;
        localR[idx] = glm::normalize(glm::inverse(parentWorldQ) * desiredWorldQ);
      } else {
        targetWorldQ[idx] = glm::normalize(parentWorldQ * localR[idx]);
      }
    } else {
      targetWorldQ[idx] = glm::normalize(parentWorldQ * localR[idx]);
    }

    if (overlay && overlay->fistWeight > 0.01f) {
      auto fit = fingerCurlByNode_.find(idx);
      if (fit != fingerCurlByNode_.end()) {
        const float curlRad = 1.05f * fit->second.curlScale * std::clamp(overlay->fistWeight, 0.0f, 1.0f);
        localR[idx] = glm::normalize(localR[idx] * glm::angleAxis(curlRad, fit->second.localAxis));
        targetWorldQ[idx] = glm::normalize(parentWorldQ * localR[idx]);
      }
    }
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

  const AlignedTargetBind& alignedL = getOrBuildAlignedBind(lowerClip);
  const AlignedTargetBind& alignedU = getOrBuildAlignedBind(upperClip);
  const glm::quat relQL = glm::angleAxis(targetFacingYaw_ - lowerClip.srcFacingYaw, glm::vec3(0.0f, 1.0f, 0.0f));
  const glm::quat invRelQL = glm::inverse(relQL);
  const glm::quat relQU = glm::angleAxis(targetFacingYaw_ - upperClip.srcFacingYaw, glm::vec3(0.0f, 1.0f, 0.0f));
  const glm::quat invRelQU = glm::inverse(relQU);

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
    const float srcH = std::abs(lowerClip.srcRestHipWorldPos.y) > 0.1f ? std::abs(lowerClip.srcRestHipWorldPos.y) : targetHipHeight_;
    const float hipScale = std::clamp(targetHipHeight_ / srcH, 0.25f, 4.0f);
    glm::vec3 dWorld = relQL * (hipL - lowerClip.srcRestHipWorldPos) * hipScale;
    const float unitScale = targetHipHeight_ / 0.95f;
    if (overlay && overlay->koProgress > 0.001f) {
      const float k = std::clamp(overlay->koProgress, 0.0f, 1.0f);
      const float ks = k * k * (3.0f - 2.0f * k);
      const float koAngle = ks * 1.48f;
      dWorld.y -= 0.78f * std::sin(koAngle) * unitScale;
    } else if (overlay) {
      dWorld.y -= 0.34f * std::clamp(overlay->crouchWeight, 0.0f, 1.0f) * unitScale;
      dWorld.y += 0.06f * std::clamp(overlay->airWeight, 0.0f, 1.0f) * unitScale;
    }
    dWorld.y = std::clamp(dWorld.y, -1.10f * unitScale, 0.35f * unitScale);
    dWorld.x = std::clamp(dWorld.x * 0.45f, -0.25f * unitScale, 0.25f * unitScale);
    dWorld.z = std::clamp(dWorld.z * 0.45f, -0.35f * unitScale, 0.35f * unitScale);
    localT[targetHipsNode_] += targetHipsParentInvRotScale_ * dWorld;
  }

  glm::quat koFallWorldQ(1.0f, 0.0f, 0.0f, 0.0f);
  bool hasKoFall = false;
  if (overlay && overlay->koProgress > 0.001f) {
    const float k = std::clamp(overlay->koProgress, 0.0f, 1.0f);
    const float ks = k * k * (3.0f - 2.0f * k);
    const float koAngle = ks * 1.48f;
    const float fSign = (std::abs(targetFacingYaw_) > 1.5f) ? -1.0f : 1.0f;
    koFallWorldQ = glm::normalize(
      glm::angleAxis(-koAngle * fSign, glm::vec3(1.0f, 0.0f, 0.0f)) *
      glm::angleAxis(0.14f * ks * fSign, glm::vec3(0.0f, 0.0f, 1.0f))
    );
    hasKoFall = true;
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
        const glm::quat dL = relQL * (srcLowerQ[itL->second] * glm::inverse(lowerClip.srcRestWorldQ[itL->second])) * invRelQL;
        const glm::quat dU = relQU * (srcUpperQ[itU->second] * glm::inverse(upperClip.srcRestWorldQ[itU->second])) * invRelQU;
        const glm::quat wL = glm::normalize(dL * alignedL.worldQ[idx]);
        const glm::quat wU = glm::normalize(dU * alignedU.worldQ[idx]);
        glm::quat desiredWorldQ = glm::normalize(glm::slerp(wL, wU, mask));
        if (overlay) {
          desiredWorldQ = glm::normalize(computeOverlayDeltaWorld(canon, *overlay) * desiredWorldQ);
        }
        if (hasKoFall) {
          desiredWorldQ = glm::normalize(koFallWorldQ * desiredWorldQ);
        }
        targetWorldQ[idx] = desiredWorldQ;
        localR[idx] = glm::normalize(glm::inverse(parentWorldQ) * desiredWorldQ);
      } else if (itL != lowerClip.canonicalToSrcNode.end()) {
        const glm::quat dL = relQL * (srcLowerQ[itL->second] * glm::inverse(lowerClip.srcRestWorldQ[itL->second])) * invRelQL;
        glm::quat wL = glm::normalize(dL * alignedL.worldQ[idx]);
        if (overlay) {
          wL = glm::normalize(computeOverlayDeltaWorld(canon, *overlay) * wL);
        }
        if (hasKoFall) {
          wL = glm::normalize(koFallWorldQ * wL);
        }
        targetWorldQ[idx] = wL;
        localR[idx] = glm::normalize(glm::inverse(parentWorldQ) * wL);
      } else {
        targetWorldQ[idx] = glm::normalize(parentWorldQ * localR[idx]);
      }
    } else {
      targetWorldQ[idx] = glm::normalize(parentWorldQ * localR[idx]);
    }

    if (overlay && overlay->fistWeight > 0.01f) {
      auto fit = fingerCurlByNode_.find(idx);
      if (fit != fingerCurlByNode_.end()) {
        const float curlRad = 1.05f * fit->second.curlScale * std::clamp(overlay->fistWeight, 0.0f, 1.0f);
        localR[idx] = glm::normalize(localR[idx] * glm::angleAxis(curlRad, fit->second.localAxis));
        targetWorldQ[idx] = glm::normalize(parentWorldQ * localR[idx]);
      }
    }
  }

  buildPaletteFromTargetLocals(localT, localR, localS, outPalette);
}

glm::quat CharacterAnimator::computeOverlayDeltaWorld(
  const std::string& canon,
  const CharacterPoseOverlay& ov
) const {
  const float t = ov.timeSec + ov.seed * 7.13f;
  const float breath = 0.65f * std::sin(t * 1.65f) + 0.35f * std::sin(t * 2.71f + 1.1f);
  const float swayYaw = (0.62f * std::sin(t * 0.58f) + 0.38f * std::cos(t * 1.13f)) * 0.042f * ov.idleWeight;
  const float swayRoll = std::sin(t * 0.49f + 0.8f) * 0.022f * ov.idleWeight;
  const float scanYaw = (0.65f * std::sin(t * 0.43f) + 0.35f * std::sin(t * 0.91f)) * 0.11f * ov.idleWeight;
  const float scanPitch = std::sin(t * 0.37f + 1.7f) * 0.045f * ov.idleWeight;

  const float lean = ov.sprintLean * 0.16f;
  const float bank = std::clamp(ov.turnBank, -1.0f, 1.0f) * 0.12f;
  const float recoil = ov.recoilKick;
  const float reloadDip = std::sin(std::clamp(ov.reloadProgress, 0.0f, 1.0f) * 3.1415926f);

  // Rotate procedural pitch/yaw/roll from canonical +Z character space into target facing space
  const float fSign = (std::abs(targetFacingYaw_) > 1.5f) ? -1.0f : 1.0f;

  float pitchX = 0.0f;
  float yawY = 0.0f;
  float rollZ = 0.0f;

  if (ov.koProgress > 0.001f) {
    const float k = std::clamp(ov.koProgress, 0.0f, 1.0f);
    const float ks = k * k * (3.0f - 2.0f * k);
    if (canon == "LeftLeg" || canon == "RightLeg") {
      pitchX += 0.35f * ks * fSign;
    } else if (canon == "Spine" || canon == "Spine1") {
      pitchX += 0.14f * ks * fSign;
    }
  }

  const float crouch = std::clamp(ov.crouchWeight, 0.0f, 1.0f);
  const float air = std::clamp(ov.airWeight, 0.0f, 1.0f);

  if (canon == "Spine" || canon == "Spine1") {
    const float w = (canon == "Spine") ? 0.5f : 0.65f;
    pitchX += (lean * w + crouch * 0.20f * w + breath * 0.014f * (0.4f + 0.6f * ov.idleWeight) - recoil * 0.07f * w + reloadDip * 0.08f * w) * fSign;
    yawY += swayYaw * w - ov.weaponHoldWeight * (0.14f + 0.12f * ov.aimWeight) * w;
    rollZ += (swayRoll * w + bank * w) * fSign;
  } else if (canon == "Spine2") {
    pitchX += (lean * 0.45f + crouch * 0.10f + breath * 0.020f * (0.45f + 0.55f * ov.idleWeight) - recoil * 0.11f + reloadDip * 0.10f) * fSign;
    yawY += swayYaw * 0.5f - ov.weaponHoldWeight * (0.12f + 0.10f * ov.aimWeight);
    rollZ += bank * 0.45f * fSign;
  } else if (canon == "Neck" || canon == "Head") {
    const float hw = (canon == "Neck") ? 0.42f : 0.65f;
    pitchX += (-ov.headLookPitch * hw - crouch * 0.14f * hw + scanPitch * hw - recoil * 0.04f * hw + reloadDip * 0.12f * hw) * fSign;
    yawY += ov.headLookYaw * hw + scanYaw * hw + ov.weaponHoldWeight * 0.18f * hw;
  } else if (canon == "LeftUpLeg" || canon == "RightUpLeg") {
    pitchX += (-0.68f * crouch - 0.34f * air) * fSign;
  } else if (canon == "LeftLeg" || canon == "RightLeg") {
    pitchX += (1.16f * crouch + 0.54f * air) * fSign;
  } else if (canon == "LeftFoot" || canon == "RightFoot") {
    pitchX += (-0.42f * crouch - 0.16f * air) * fSign;
  } else if (canon == "RightShoulder" || canon == "RightArm") {
    if (ov.weaponHoldWeight > 0.01f) {
      const float w = ov.weaponHoldWeight;
      const float raise = (canon == "RightShoulder") ? 0.18f : (0.98f + 0.22f * ov.aimWeight);
      pitchX += (-raise - recoil * 0.24f + reloadDip * 0.35f) * w * fSign;
      yawY += (0.16f * ov.aimWeight + reloadDip * 0.25f) * w;
      rollZ += (canon == "RightArm") ? (-0.28f * w * fSign) : 0.0f;
    } else {
      pitchX += breath * 0.012f * ov.idleWeight * fSign;
      if (canon == "RightArm") rollZ += (-0.24f * air) * fSign;
    }
  } else if (canon == "RightForeArm") {
    if (ov.weaponHoldWeight > 0.01f) {
      const float w = ov.weaponHoldWeight;
      pitchX += (-0.42f - 0.16f * ov.aimWeight - recoil * 0.18f - reloadDip * 0.45f) * w * fSign;
      yawY += (0.28f + 0.15f * ov.aimWeight) * w;
    }
  } else if (canon == "LeftShoulder" || canon == "LeftArm") {
    if (ov.weaponHoldWeight > 0.01f) {
      const float w = ov.weaponHoldWeight * (ov.twoHandedWeapon ? 1.0f : 0.72f * ov.aimWeight);
      const float raise = (canon == "LeftShoulder") ? 0.16f : (0.94f + 0.20f * ov.aimWeight);
      pitchX += (-raise - recoil * 0.16f + reloadDip * 0.55f) * w * fSign;
      yawY += (-0.42f - 0.18f * ov.aimWeight) * w;
      rollZ += (canon == "LeftArm") ? (0.32f * w * fSign) : 0.0f;
    } else {
      pitchX += breath * 0.012f * ov.idleWeight * fSign;
      if (canon == "LeftArm") rollZ += (0.24f * air) * fSign;
    }
  } else if (canon == "LeftForeArm") {
    if (ov.weaponHoldWeight > 0.01f) {
      const float w = ov.weaponHoldWeight * (ov.twoHandedWeapon ? 1.0f : 0.75f * ov.aimWeight);
      pitchX += (-0.36f - 0.18f * ov.aimWeight - reloadDip * 0.35f) * w * fSign;
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

void CharacterAnimator::evaluateLayeredBlended(
  const SourceClip& lowerClip,
  float lowerTime,
  const SourceClip& prevUpperClip,
  float prevUpperTime,
  const SourceClip& upperClip,
  float upperTime,
  float upperBlend,
  float upperWeight,
  std::array<glm::mat4, kMaxSkinBones>& outPalette,
  const CharacterPoseOverlay* overlay
) const {
  const float rawUb = std::clamp(upperBlend, 0.0f, 1.0f);
  const float ub = rawUb * rawUb * (3.0f - 2.0f * rawUb);
  if (ub >= 0.999f) {
    evaluateLayered(lowerClip, lowerTime, upperClip, upperTime, upperWeight, outPalette, overlay);
    return;
  }
  if (ub <= 0.001f) {
    evaluateLayered(lowerClip, lowerTime, prevUpperClip, prevUpperTime, upperWeight, outPalette, overlay);
    return;
  }
  const float rawW = std::clamp(upperWeight, 0.0f, 1.0f);
  const float w = rawW * rawW * (3.0f - 2.0f * rawW);
  if (w <= 0.001f || !target_ || !target_->skin.valid) {
    evaluateClip(lowerClip, lowerTime, outPalette, overlay);
    return;
  }

  std::vector<glm::quat> srcLowerQ, srcPrevUQ, srcUpperQ;
  glm::vec3 hipL(0.0f), hipPU(0.0f), hipU(0.0f);
  sampleSourcePose(lowerClip, lowerTime, srcLowerQ, hipL);
  sampleSourcePose(prevUpperClip, prevUpperTime, srcPrevUQ, hipPU);
  sampleSourcePose(upperClip, upperTime, srcUpperQ, hipU);

  const AlignedTargetBind& alignedL = getOrBuildAlignedBind(lowerClip);
  const AlignedTargetBind& alignedPU = getOrBuildAlignedBind(prevUpperClip);
  const AlignedTargetBind& alignedU = getOrBuildAlignedBind(upperClip);
  const glm::quat relQL = glm::angleAxis(targetFacingYaw_ - lowerClip.srcFacingYaw, glm::vec3(0.0f, 1.0f, 0.0f));
  const glm::quat invRelQL = glm::inverse(relQL);
  const glm::quat relQPU = glm::angleAxis(targetFacingYaw_ - prevUpperClip.srcFacingYaw, glm::vec3(0.0f, 1.0f, 0.0f));
  const glm::quat invRelQPU = glm::inverse(relQPU);
  const glm::quat relQU = glm::angleAxis(targetFacingYaw_ - upperClip.srcFacingYaw, glm::vec3(0.0f, 1.0f, 0.0f));
  const glm::quat invRelQU = glm::inverse(relQU);

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
    const float srcH = std::abs(lowerClip.srcRestHipWorldPos.y) > 0.1f ? std::abs(lowerClip.srcRestHipWorldPos.y) : targetHipHeight_;
    const float hipScale = std::clamp(targetHipHeight_ / srcH, 0.25f, 4.0f);
    glm::vec3 dWorld = relQL * (hipL - lowerClip.srcRestHipWorldPos) * hipScale;
    const float unitScale = targetHipHeight_ / 0.95f;
    if (overlay && overlay->koProgress > 0.001f) {
      const float k = std::clamp(overlay->koProgress, 0.0f, 1.0f);
      const float ks = k * k * (3.0f - 2.0f * k);
      dWorld.y -= 0.78f * std::sin(ks * 1.48f) * unitScale;
    } else if (overlay) {
      dWorld.y -= 0.34f * std::clamp(overlay->crouchWeight, 0.0f, 1.0f) * unitScale;
      dWorld.y += 0.06f * std::clamp(overlay->airWeight, 0.0f, 1.0f) * unitScale;
    }
    dWorld.y = std::clamp(dWorld.y, -1.10f * unitScale, 0.35f * unitScale);
    dWorld.x = std::clamp(dWorld.x * 0.45f, -0.25f * unitScale, 0.25f * unitScale);
    dWorld.z = std::clamp(dWorld.z * 0.45f, -0.35f * unitScale, 0.35f * unitScale);
    localT[targetHipsNode_] += targetHipsParentInvRotScale_ * dWorld;
  }

  std::vector<glm::quat> targetWorldQ = targetRestWorldQ_;
  for (int32_t idx : targetTopoOrder_) {
    const int32_t p = target_->nodes[idx].parent;
    const glm::quat parentWorldQ = (p >= 0) ? targetWorldQ[p] : glm::quat(1.0f, 0.0f, 0.0f, 0.0f);
    const std::string& canon = targetCanonicalNames_[idx];

    if (!canon.empty()) {
      auto itL = lowerClip.canonicalToSrcNode.find(canon);
      auto itPU = prevUpperClip.canonicalToSrcNode.find(canon);
      auto itU = upperClip.canonicalToSrcNode.find(canon);
      const float mask = w * boneUpperMask(canon);
      if (itL != lowerClip.canonicalToSrcNode.end() && itU != upperClip.canonicalToSrcNode.end()) {
        const glm::quat dL = relQL * (srcLowerQ[itL->second] * glm::inverse(lowerClip.srcRestWorldQ[itL->second])) * invRelQL;
        const glm::quat wL = glm::normalize(dL * alignedL.worldQ[idx]);
        const glm::quat dU = relQU * (srcUpperQ[itU->second] * glm::inverse(upperClip.srcRestWorldQ[itU->second])) * invRelQU;
        glm::quat wU = glm::normalize(dU * alignedU.worldQ[idx]);
        if (itPU != prevUpperClip.canonicalToSrcNode.end()) {
          const glm::quat dPU = relQPU * (srcPrevUQ[itPU->second] * glm::inverse(prevUpperClip.srcRestWorldQ[itPU->second])) * invRelQPU;
          const glm::quat wPU = glm::normalize(dPU * alignedPU.worldQ[idx]);
          wU = glm::normalize(glm::slerp(wPU, wU, ub));
        }
        glm::quat desiredWorldQ = glm::normalize(glm::slerp(wL, wU, mask));
        if (overlay) {
          desiredWorldQ = glm::normalize(computeOverlayDeltaWorld(canon, *overlay) * desiredWorldQ);
        }
        targetWorldQ[idx] = desiredWorldQ;
        localR[idx] = glm::normalize(glm::inverse(parentWorldQ) * desiredWorldQ);
      } else if (itL != lowerClip.canonicalToSrcNode.end()) {
        const glm::quat dL = relQL * (srcLowerQ[itL->second] * glm::inverse(lowerClip.srcRestWorldQ[itL->second])) * invRelQL;
        glm::quat wL = glm::normalize(dL * alignedL.worldQ[idx]);
        if (overlay) {
          wL = glm::normalize(computeOverlayDeltaWorld(canon, *overlay) * wL);
        }
        targetWorldQ[idx] = wL;
        localR[idx] = glm::normalize(glm::inverse(parentWorldQ) * wL);
      } else {
        targetWorldQ[idx] = glm::normalize(parentWorldQ * localR[idx]);
      }
    } else {
      targetWorldQ[idx] = glm::normalize(parentWorldQ * localR[idx]);
    }

    if (overlay && overlay->fistWeight > 0.01f) {
      auto fit = fingerCurlByNode_.find(idx);
      if (fit != fingerCurlByNode_.end()) {
        const float curlRad = 1.05f * fit->second.curlScale * std::clamp(overlay->fistWeight, 0.0f, 1.0f);
        localR[idx] = glm::normalize(localR[idx] * glm::angleAxis(curlRad, fit->second.localAxis));
        targetWorldQ[idx] = glm::normalize(parentWorldQ * localR[idx]);
      }
    }
  }

  buildPaletteFromTargetLocals(localT, localR, localS, outPalette);
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
      if (!st.upperClip.empty() && st.upperWeight > 0.05f) {
        st.prevUpperClip = st.upperClip;
        st.prevUpperTime = st.upperTime;
        st.upperBlend = 0.0f;
      } else {
        st.prevUpperClip.clear();
        st.upperBlend = 1.0f;
      }
      st.upperClip = desiredUpperClip;
    }
    st.upperTime = desiredUpperTime;
    st.prevUpperTime += dt;
    st.upperBlend = std::min(1.0f, st.upperBlend + dt / 0.09f);
    st.upperWeight = std::min(1.0f, st.upperWeight + dt * 16.0f);
  } else {
    st.upperTime += dt;
    st.prevUpperTime += dt;
    st.upperWeight = std::max(0.0f, st.upperWeight - dt * 11.0f);
    if (st.upperWeight <= 0.005f) {
      st.upperWeight = 0.0f;
      st.upperClip.clear();
      st.prevUpperClip.clear();
      st.upperBlend = 1.0f;
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
    auto itPrevUpper = (!st.prevUpperClip.empty() && st.upperBlend < 0.999f) ? clips.find(st.prevUpperClip) : clips.end();
    if (itPrevUpper != clips.end()) {
      evaluateLayeredBlended(
        itCurr->second, st.currTime,
        itPrevUpper->second, st.prevUpperTime,
        itUpper->second, st.upperTime,
        st.upperBlend, st.upperWeight,
        outPalette, overlay
      );
    } else {
      evaluateLayered(itCurr->second, st.currTime, itUpper->second, st.upperTime, st.upperWeight, outPalette, overlay);
    }
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

glm::vec3 CharacterAnimator::animatedBonePos(
  const std::string& canonicalName,
  const std::array<glm::mat4, kMaxSkinBones>& palette,
  const glm::vec3& fallback
) const {
  auto it = canonicalToSkinJoint_.find(canonicalName);
  if (it == canonicalToSkinJoint_.end()) return fallback;
  const uint32_t ji = it->second;
  if (ji >= kMaxSkinBones || ji >= skinJointBindOriginMesh_.size()) return fallback;
  return glm::vec3(palette[ji] * skinJointBindOriginMesh_[ji]);
}

} // namespace westgate
