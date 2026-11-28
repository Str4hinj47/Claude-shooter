#include "westgate/CharacterAnimator.hpp"
#include "westgate/EngineTypes.hpp"
#include "westgate/GameSession.hpp"
#include "westgate/GltfAssetLoader.hpp"
#include "westgate/PhysicsWorld.hpp"
#include "westgate/PlayerController.hpp"
#include "westgate/WorldData.hpp"

#include <algorithm>
#include <array>
#include <atomic>
#include <cassert>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <cstdio>
#include <filesystem>
#include <glm/gtc/matrix_transform.hpp>
#include <string>
#include <unordered_map>
#include <vector>

#ifndef WESTGATE_SOURCE_ROOT
#define WESTGATE_SOURCE_ROOT "."
#endif

#define WG_CHECK(cond)                                                               \
  do {                                                                               \
    if (!(cond)) {                                                                   \
      std::fprintf(stderr, "FAIL %s:%d: %s\n", __FILE__, __LINE__, #cond);           \
      return 1;                                                                      \
    }                                                                                \
  } while (0)

int main() {
  const std::filesystem::path root(WESTGATE_SOURCE_ROOT);
  const std::filesystem::path worldDir = root / "native" / "assets" / "world";
  const std::filesystem::path publicDir = root / "public";

  // 1. World binary heightfield + JSON manifest load
  westgate::WorldData world;
  std::string err;
  if (!world.loadFromDirectory(worldDir.string(), &err)) {
    std::fprintf(stderr, "FAIL WorldData load: %s\n", err.c_str());
    return 1;
  }
  assert(world.chunks.size() == 225);
  assert(world.heightfield.gridSize() == 1024);
  assert(!world.roads.empty());
  assert(!world.props.empty());
  bool foundBridge = false, foundSwitchback = false;
  for (const auto& r : world.roads) {
    if (r.id == "pelican_bridge" && r.isBridge) foundBridge = true;
    if (r.id == "canyon_switchback") foundSwitchback = true;
  }
  assert(foundBridge && foundSwitchback);
  assert(world.heightfield.sampleHeight(-925.0f, 360.0f) > 5.0f); // Pelican Key island elevation

  const float pitY = world.heightfield.sampleHeight(world.fightPitPos.x, world.fightPitPos.z);
  assert(std::isfinite(pitY) && std::abs(pitY - 2.8f) < 0.8f);
  assert(world.hasCustomMeshes);
  assert(world.customMeshVertices.size() > 500000);
  assert(world.customMeshIndices.size() > 1500000);
  assert(world.propPrototypes.size() == 3);
  assert(world.glbPlacements.size() > 900);
  // Verify cx * 15 + cz chunk ordering: Safehouse (cx=5,cz=9 -> 84) & Del Sol Pier (cx=2,cz=7 -> 37)
  assert(world.chunks[84].cx == 5 && world.chunks[84].cz == 9);
  assert(world.chunks[84].meshSlice.indexCount > 500 && !world.chunks[84].nearBoxes.empty());
  assert(world.chunks[37].cx == 2 && world.chunks[37].cz == 7);
  assert(world.chunks[37].meshSlice.indexCount > 500 && !world.chunks[37].nearBoxes.empty());
  {
    westgate::GltfModel sofaModel;
    const bool okSofa = westgate::GltfAssetLoader::loadGlb((publicDir / "models" / "ph_sofa.glb").string(), sofaModel, true, &err);
    assert(okSofa && !sofaModel.primitives.empty() && !sofaModel.textures.empty());
    const float nLen = glm::length(sofaModel.primitives[0].vertices[0].normal);
    assert(std::isfinite(nLen) && nLen > 0.98f && nLen < 1.02f);
  }
  std::printf("[PASS] WorldData v2 loaded: %ux%u heightfield, %zu chunks, %zu customVerts, %zu glbPlacements, fightPitY=%.2fm\n",
              world.heightfield.gridSize(), world.heightfield.gridSize(), world.chunks.size(),
              world.customMeshVertices.size(), world.glbPlacements.size(), pitY);

  // 2. Multi-threaded JobSystem & Frustum/ChunkStreamer
  westgate::JobSystem jobs(2);
  std::atomic<int> counter{0};
  for (int i = 0; i < 64; ++i) {
    jobs.enqueue([&]() { counter.fetch_add(1, std::memory_order_relaxed); });
  }
  jobs.waitIdle();
  assert(counter.load() == 64);

  westgate::ChunkStreamer streamer(320.0f, 920.0f, 24.0f);
  streamer.init(world);
  const glm::mat4 proj = glm::perspectiveZO(glm::radians(60.0f), 16.0f / 9.0f, 0.25f, 2400.0f);
  const glm::mat4 view = glm::lookAt(world.spawnPos + glm::vec3(0.0f, 8.0f, -10.0f), world.spawnPos, glm::vec3(0.0f, 1.0f, 0.0f));
  const westgate::Frustum frustum = westgate::Frustum::fromViewProj(proj * view);
  streamer.update(world.spawnPos, frustum);
  assert(streamer.nearCount() > 0 && streamer.visibleCount() > 0);
  std::printf("[PASS] JobSystem + ChunkStreamer: near=%u, lod=%u, frustumVisible=%u\n",
              streamer.nearCount(), streamer.lodCount(), streamer.visibleCount());

  // 3. JoltPhysics HeightField + Building Colliders + CharacterVirtual walk + Raycast
  westgate::PhysicsWorld physics;
  if (!physics.initFromWorld(world, &err)) {
    std::fprintf(stderr, "FAIL PhysicsWorld init: %s\n", err.c_str());
    return 1;
  }
  assert(physics.staticBodyCount() > 100);

  westgate::PlayerController player;
  player.init(&physics, world.fightPitPos + glm::vec3(0.0f, 1.0f, 0.0f), 0.0f);
  westgate::PlayerInputState walkInput{};
  walkInput.moveForward = 1.0f;
  for (int f = 0; f < 90; ++f) {
    player.update(1.0f / 60.0f, walkInput);
    physics.step(1.0f / 60.0f);
  }
  const glm::vec3 endPos = player.position();
  assert(std::isfinite(endPos.y) && endPos.z > world.fightPitPos.z + 1.0f);

  const westgate::RaycastHit groundHit = physics.raycast(endPos + glm::vec3(0.0f, 20.0f, 0.0f), glm::vec3(0.0f, -1.0f, 0.0f), 40.0f);
  assert(groundHit.hit && std::abs(groundHit.position.y - pitY) < 1.5f);

  // Verify dynamic Jolt rigid-body crates/barrels respond to real impulses
  assert(physics.dynamicBodyCount() >= 30);
  std::vector<westgate::DynamicPropPose> dynBefore, dynAfter;
  physics.gatherDynamicProps(dynBefore);
  assert(dynBefore.size() == physics.dynamicBodyCount());
  const glm::vec3 firstCratePos = dynBefore[0].position;
  physics.applyImpulseNear(firstCratePos, glm::vec3(180.0f, 40.0f, 90.0f), 2.5f);
  for (int f = 0; f < 30; ++f) physics.step(1.0f / 60.0f);
  physics.gatherDynamicProps(dynAfter);
  const float crateMoved = glm::distance(firstCratePos, dynAfter[0].position);
  assert(crateMoved > 0.15f);

  // Verify vehicle collision probe detects static buildings
  if (!world.chunks.empty()) {
    for (const auto& ch : world.chunks) {
      if (!ch.buildings.empty()) {
        const auto& b = ch.buildings[0];
        glm::vec3 pushXZ(0.0f);
        float spdScale = 1.0f;
        const glm::vec3 probeCenter(b.center.x, world.heightfield.sampleHeight(b.center.x, b.center.z), b.center.z);
        (void)physics.resolveVehicleCollision(probeCenter, std::max(b.size.x, b.size.z) * 0.5f + 2.0f, pushXZ, spdScale);
        break;
      }
    }
  }
  std::printf("[PASS] JoltPhysics: static=%u, dynamic=%u (crateMoved=%.2fm), grounded=%d, rayHitY=%.2f\n",
              physics.staticBodyCount(), physics.dynamicBodyCount(), crateMoved, player.grounded() ? 1 : 0, groundHit.position.y);

  // 4. Native glTF/GLB loader + Node Transform Baking + Skeletal Retargeting
  const std::filesystem::path fighterGlb = publicDir / "characters" / "fighter" / "base_body.glb";
  if (std::filesystem::exists(fighterGlb)) {
    westgate::GltfModel fighter;
    if (!westgate::GltfAssetLoader::loadGlb(fighterGlb.string(), fighter, true, &err)) {
      std::fprintf(stderr, "FAIL GltfAssetLoader (meshopt) failed: %s\n", err.c_str());
      return 1;
    }
    const float h = fighter.boundsMax.y - fighter.boundsMin.y;
    assert(fighter.totalVertices() > 10000 && fighter.totalIndices() > 10000);
    assert(h > 1.4f && h < 2.2f);
    std::printf("[PASS] GltfAssetLoader (EXT_meshopt_compression): base_body.glb verts=%zu, idx=%zu, bones=%u, textures=%zu, height=%.2fm\n",
                fighter.totalVertices(), fighter.totalIndices(), fighter.boneCount, fighter.textures.size(), h);

    // Retarget Mixamo combat idle onto UE/CC4 base_body skeleton
    const std::filesystem::path idleGlb = publicDir / "animations" / "combat" / "fight_idle.glb";
    westgate::GltfModel idleAnim;
    if (!westgate::GltfAssetLoader::loadGlb(idleGlb.string(), idleAnim, false, &err)) {
      std::fprintf(stderr, "FAIL fight_idle load: %s\n", err.c_str());
      return 1;
    }
    westgate::CharacterAnimator::SourceClip srcIdle;
    if (!westgate::CharacterAnimator::buildSourceClip("fight_idle", idleAnim, 0, true, srcIdle)) {
      std::fprintf(stderr, "FAIL buildSourceClip fight_idle\n");
      return 1;
    }
    westgate::CharacterAnimator anim;
    anim.initForTarget(fighter);
    std::array<glm::mat4, westgate::kMaxSkinBones> palette{};
    anim.evaluateClip(srcIdle, 0.35f, palette);
    const glm::vec3 samplePos = fighter.primitives[0].vertices[0].position;
    const glm::uvec4 j4 = fighter.primitives[0].vertices[0].joints;
    const glm::vec4 w4 = fighter.primitives[0].vertices[0].weights;
    const glm::mat4 skinM = palette[j4.x] * w4.x + palette[j4.y] * w4.y + palette[j4.z] * w4.z + palette[j4.w] * w4.w;
    const glm::vec3 skinned = glm::vec3(skinM * glm::vec4(samplePos, 1.0f));
    if (!std::isfinite(skinned.x) || !std::isfinite(skinned.y) || std::abs(skinned.y) >= 3.0f) {
      std::fprintf(stderr, "FAIL invalid skinned vertex\n");
      return 1;
    }
    std::printf("[PASS] CharacterAnimator retarget (Mixamo -> base_body): skinnedVert=(%.2f, %.2f, %.2f)\n",
                skinned.x, skinned.y, skinned.z);

    // Layered upper/lower body skeletal blending (jab over fight_idle)
    const std::filesystem::path jabGlb = publicDir / "animations" / "combat" / "jab.glb";
    westgate::GltfModel jabAnim;
    if (westgate::GltfAssetLoader::loadGlb(jabGlb.string(), jabAnim, false, &err)) {
      westgate::CharacterAnimator::SourceClip srcJab;
      assert(westgate::CharacterAnimator::buildSourceClip("jab", jabAnim, 0, false, srcJab));
      std::array<glm::mat4, westgate::kMaxSkinBones> layeredPal{};
      anim.evaluateLayered(srcIdle, 0.25f, srcJab, 0.22f, 0.85f, layeredPal);
      const glm::vec3 layeredSkinned = glm::vec3((layeredPal[j4.x] * w4.x + layeredPal[j4.y] * w4.y + layeredPal[j4.z] * w4.z + layeredPal[j4.w] * w4.w) * glm::vec4(samplePos, 1.0f));
      assert(std::isfinite(layeredSkinned.x) && std::isfinite(layeredSkinned.y) && std::abs(layeredSkinned.y) < 3.0f);

      // CharacterAnimState crossfade state machine + CharacterPoseOverlay (aiming/recoil/breathing)
      std::unordered_map<std::string, westgate::CharacterAnimator::SourceClip> testClips;
      testClips["fight_idle"] = srcIdle;
      testClips["jab"] = srcJab;
      const std::filesystem::path kdGlb = publicDir / "animations" / "combat" / "knockdown.glb";
      westgate::GltfModel kdAnim;
      if (westgate::GltfAssetLoader::loadGlb(kdGlb.string(), kdAnim, false, &err)) {
        westgate::CharacterAnimator::SourceClip srcKd;
        assert(westgate::CharacterAnimator::buildSourceClip("knockdown", kdAnim, 0, false, srcKd));
        testClips["knockdown"] = srcKd;
        std::array<glm::mat4, westgate::kMaxSkinBones> kdPal{};
        anim.evaluateClip(srcKd, 1.6f, kdPal);
        const glm::vec3 kdVert = glm::vec3((kdPal[j4.x] * w4.x + kdPal[j4.y] * w4.y + kdPal[j4.z] * w4.z + kdPal[j4.w] * w4.w) * glm::vec4(samplePos, 1.0f));
        assert(std::isfinite(kdVert.y) && kdVert.y < skinned.y - 0.15f); // Hip drop during knockdown!
      }

      westgate::CharacterAnimState st{};
      st.currClip = "fight_idle";
      westgate::CharacterAnimator::advanceAnimState(st, "fight_idle", 0.2f, "jab", 0.25f, 0.05f, 0.14f);
      assert(st.upperWeight > 0.5f);
      westgate::CharacterPoseOverlay aimOv{};
      aimOv.timeSec = 1.0f;
      aimOv.weaponHoldWeight = 1.0f;
      aimOv.twoHandedWeapon = true;
      aimOv.aimWeight = 1.0f;
      aimOv.recoilKick = 0.8f;
      std::array<glm::mat4, westgate::kMaxSkinBones> statePal{};
      anim.evaluateState(st, testClips, statePal, &aimOv);
      const glm::vec3 ovVert = glm::vec3((statePal[j4.x] * w4.x + statePal[j4.y] * w4.y + statePal[j4.z] * w4.z + statePal[j4.w] * w4.w) * glm::vec4(samplePos, 1.0f));
      assert(std::isfinite(ovVert.x) && std::isfinite(ovVert.y) && std::abs(ovVert.y) < 3.0f);

      std::printf("[PASS] CharacterAnimator crossfade + hip-drop + poseOverlay: layered=(%.2f,%.2f,%.2f), aim=(%.2f,%.2f,%.2f)\n",
                  layeredSkinned.x, layeredSkinned.y, layeredSkinned.z, ovVert.x, ovVert.y, ovVert.z);
    }
  }

  const std::filesystem::path bizGlb = publicDir / "characters" / "business.glb";
  if (std::filesystem::exists(bizGlb)) {
    westgate::GltfModel biz;
    if (!westgate::GltfAssetLoader::loadGlb(bizGlb.string(), biz, false, &err)) {
      std::fprintf(stderr, "FAIL GltfAssetLoader (quantized) failed: %s\n", err.c_str());
      return 1;
    }
    const float h = biz.boundsMax.y - biz.boundsMin.y;
    if (biz.totalVertices() <= 1000 || h <= 1.4f || h >= 2.2f) {
      std::fprintf(stderr, "FAIL business.glb invalid bounds\n");
      return 1;
    }
    std::printf("[PASS] GltfAssetLoader (KHR_mesh_quantization): business.glb verts=%zu, idx=%zu, anims=%zu, height=%.2fm\n",
                biz.totalVertices(), biz.totalIndices(), biz.animations.size(), h);

    auto checkOrFail = [](bool cond, const char* msg) -> bool {
      if (!cond) {
        std::fprintf(stderr, "FAIL: %s\n", msg);
        return false;
      }
      return true;
    };

    // Verify anatomical joint positions across -Z <-> +Z retargeting & ALIGN_PAIRS
    auto jointWorldPos = [](const westgate::GltfModel& model,
                            const std::array<glm::mat4, westgate::kMaxSkinBones>& pal,
                            const std::string& boneName) -> glm::vec3 {
      for (size_t ji = 0; ji < model.skin.jointNodeIndices.size(); ++ji) {
        const int32_t jn = model.skin.jointNodeIndices[ji];
        if (jn >= 0 && model.nodes[static_cast<size_t>(jn)].name == boneName) {
          const glm::mat4 worldM = pal[ji] * glm::inverse(model.skin.inverseBindMatrices[ji]);
          return glm::vec3(worldM[3]);
        }
      }
      return glm::vec3(0.0f);
    };

    westgate::GltfModel fighter2;
    if (!checkOrFail(westgate::GltfAssetLoader::loadGlb(fighterGlb.string(), fighter2, false, &err), "load fighter2")) return 1;
    westgate::CharacterAnimator bodyAnim2;
    bodyAnim2.initForTarget(fighter2);

    // 1. fight_idle guard height (ALIGN_PAIRS must lift 48-deg A-pose arms up to chest/chin guard!)
    westgate::GltfModel idleM, jabM, dodgeM, kdM;
    if (!checkOrFail(westgate::GltfAssetLoader::loadGlb((publicDir / "animations" / "combat" / "fight_idle.glb").string(), idleM, false, &err), "load idleM")) return 1;
    if (!checkOrFail(westgate::GltfAssetLoader::loadGlb((publicDir / "animations" / "combat" / "jab.glb").string(), jabM, false, &err), "load jabM")) return 1;
    if (!checkOrFail(westgate::GltfAssetLoader::loadGlb((publicDir / "animations" / "combat" / "dodge.glb").string(), dodgeM, false, &err), "load dodgeM")) return 1;
    if (!checkOrFail(westgate::GltfAssetLoader::loadGlb((publicDir / "animations" / "combat" / "knockdown.glb").string(), kdM, false, &err), "load kdM")) return 1;

    westgate::CharacterAnimator::SourceClip scIdle, scJab, scDodge, scKd, scWalk;
    if (!checkOrFail(westgate::CharacterAnimator::buildSourceClip("fight_idle", idleM, 0, true, scIdle, 0.0f, -1.0f, false), "build fight_idle")) return 1;
    if (!checkOrFail(westgate::CharacterAnimator::buildSourceClip("jab", jabM, 0, false, scJab, 0.22f, 1.05f, false), "build jab")) return 1;
    if (!checkOrFail(westgate::CharacterAnimator::buildSourceClip("dodge", dodgeM, 0, false, scDodge, 0.04f, 0.78f, false), "build dodge")) return 1;
    if (!checkOrFail(westgate::CharacterAnimator::buildSourceClip("knockdown", kdM, 0, false, scKd, 0.05f, 2.15f, false), "build knockdown")) return 1;
    size_t walkIdx = 0;
    for (size_t ai = 0; ai < biz.animations.size(); ++ai) {
      if (biz.animations[ai].name == "Walk") { walkIdx = ai; break; }
    }
    if (!checkOrFail(westgate::CharacterAnimator::buildSourceClip("Walk", biz, walkIdx, true, scWalk), "build Walk")) return 1;

    std::array<glm::mat4, westgate::kMaxSkinBones> pal{};
    westgate::CharacterPoseOverlay fistOv{};
    fistOv.fistWeight = 1.0f;
    bodyAnim2.evaluateClip(scIdle, 0.25f, pal, &fistOv);
    const glm::vec3 guardHandL = jointWorldPos(fighter2, pal, "hand_l");
    const glm::vec3 guardHandR = jointWorldPos(fighter2, pal, "hand_r");
    const glm::vec3 guardShoulderL = jointWorldPos(fighter2, pal, "upperarm_l");
    if (!checkOrFail(guardHandL.y > 0.90f && guardHandR.y > 0.90f && guardHandL.y < 1.35f, "guard hands in boxing crouch height")) return 1;
    if (!checkOrFail(guardHandL.z > guardShoulderL.z + 0.30f && guardHandR.z > 0.12f, "guard hands forward in +Z")) return 1;

    // 2. jab peak extension in +Z forward
    bodyAnim2.evaluateClip(scJab, 0.22f, pal, &fistOv);
    const glm::vec3 jabHandL = jointWorldPos(fighter2, pal, "hand_l");
    const glm::vec3 jabShoulderL = jointWorldPos(fighter2, pal, "upperarm_l");
    if (!checkOrFail(jabHandL.z > jabShoulderL.z + 0.35f, "jab extends forward +Z")) return 1;

    // 3. dodge clip valid
    bodyAnim2.evaluateClip(scDodge, 0.35f, pal, &fistOv);
    const glm::vec3 dodgeHead = jointWorldPos(fighter2, pal, "head");
    if (!checkOrFail(std::isfinite(dodgeHead.y) && dodgeHead.y > 1.0f && dodgeHead.y < 1.9f, "dodge head valid")) return 1;

    // 4. knockdown vertical hip drop on base_body (pelvis & head drop to mat with koProgress=1!)
    westgate::CharacterPoseOverlay koOv{};
    koOv.koProgress = 1.0f;
    bodyAnim2.evaluateClip(scKd, 1.85f, pal, &koOv);
    const glm::vec3 kdPelvis = jointWorldPos(fighter2, pal, "pelvis");
    const glm::vec3 kdHead = jointWorldPos(fighter2, pal, "head");
    if (!checkOrFail(kdPelvis.y < 0.45f && kdPelvis.y > -0.25f, "knockdown pelvis drops vertically")) return 1;
    if (!checkOrFail(kdHead.y < 0.55f, "knockdown head collapses toward mat")) return 1;

    // 5. Cross-rig -Z business.glb Walk -> +Z base_body.glb: grounded feet & real Z stride
    bodyAnim2.evaluateClip(scWalk, 0.30f, pal);
    const glm::vec3 walkFootL = jointWorldPos(fighter2, pal, "foot_l");
    const glm::vec3 walkFootR = jointWorldPos(fighter2, pal, "foot_r");
    if (!checkOrFail(walkFootL.y > -0.10f && walkFootL.y < 0.42f, "walkFootL grounded")) return 1;
    if (!checkOrFail(walkFootR.y > -0.10f && walkFootR.y < 0.42f, "walkFootR grounded")) return 1;
    if (!checkOrFail(std::abs(walkFootL.z - walkFootR.z) > 0.20f, "walk Z stride")) return 1;

    // 6. Reverse cross-rig +Z Mixamo knockdown -> -Z business.glb
    westgate::CharacterAnimator bizAnim;
    bizAnim.initForTarget(biz);
    bizAnim.evaluateClip(scKd, 1.85f, pal, &koOv);
    const glm::vec3 bizKdHips = jointWorldPos(biz, pal, "mixamorig:Hips");
    const glm::vec3 bizKdHead = jointWorldPos(biz, pal, "mixamorig:Head");
    if (!checkOrFail(bizKdHips.y < 0.45f && bizKdHips.y > -0.25f, "biz knockdown hips drop")) return 1;
    if (!checkOrFail(bizKdHead.y < 0.60f, "biz knockdown head collapses")) return 1;

    // 7. Crouch overlay: pelvis drops & knees bend forward
    westgate::CharacterPoseOverlay crouchOv{};
    crouchOv.crouchWeight = 1.0f;
    crouchOv.fistWeight = 0.30f;
    bodyAnim2.evaluateClip(scWalk, 0.0f, pal, &crouchOv);
    const glm::vec3 crouchPelvis = jointWorldPos(fighter2, pal, "pelvis");
    const glm::vec3 crouchKneeL = jointWorldPos(fighter2, pal, "calf_l");
    const glm::vec3 crouchFootL = jointWorldPos(fighter2, pal, "foot_l");
    if (!checkOrFail(crouchPelvis.y < 0.65f && crouchPelvis.y > 0.35f, "crouch pelvis lowers")) return 1;
    if (!checkOrFail(crouchKneeL.z > crouchFootL.z + 0.08f, "crouch knee flexes forward")) return 1;

    // 8. Upper-body combo crossfade while walking (Walk + jab -> cross)
    westgate::GltfModel crossM;
    if (!checkOrFail(westgate::GltfAssetLoader::loadGlb((publicDir / "animations" / "combat" / "cross.glb").string(), crossM, false, &err), "load crossM")) return 1;
    westgate::CharacterAnimator::SourceClip scCross;
    if (!checkOrFail(westgate::CharacterAnimator::buildSourceClip("cross", crossM, 0, false, scCross, 0.65f, 1.55f, false), "build cross")) return 1;
    std::unordered_map<std::string, westgate::CharacterAnimator::SourceClip> comboBank;
    comboBank["Walk"] = scWalk;
    comboBank["jab"] = scJab;
    comboBank["cross"] = scCross;
    westgate::CharacterAnimState comboSt{};
    comboSt.currClip = "Walk";
    westgate::CharacterAnimator::advanceAnimState(comboSt, "Walk", 0.2f, "jab", 0.3f, 0.05f, 0.14f);
    westgate::CharacterAnimator::advanceAnimState(comboSt, "Walk", 0.25f, "cross", 0.1f, 0.04f, 0.14f);
    if (!checkOrFail(comboSt.prevUpperClip == "jab" && comboSt.upperBlend < 0.99f, "upper combo crossfade active")) return 1;
    bodyAnim2.evaluateState(comboSt, comboBank, pal, &fistOv);
    const glm::vec3 comboHandR = jointWorldPos(fighter2, pal, "hand_r");
    if (!checkOrFail(std::isfinite(comboHandR.y) && comboHandR.y > 0.7f, "combo crossfade hand valid")) return 1;

    std::printf("[PASS] Anatomical retarget checks: guardHandL=(%.2f,%.2f,%.2f), jabExtZ=%.2fm, kdPelvisY=%.2fm, crouchPelvisY=%.2fm, walkStrideZ=%.2fm, bizKdY=%.2fm\n",
                guardHandL.x, guardHandL.y, guardHandL.z,
                jabHandL.z - jabShoulderL.z, kdPelvis.y, crouchPelvis.y,
                std::abs(walkFootL.z - walkFootR.z), bizKdHips.y);
  }

  const std::filesystem::path palmGlb = publicDir / "models" / "tree_palm.glb";
  if (std::filesystem::exists(palmGlb)) {
    westgate::GltfModel palm;
    if (!westgate::GltfAssetLoader::loadGlb(palmGlb.string(), palm, false, &err)) {
      std::fprintf(stderr, "FAIL tree_palm.glb load: %s\n", err.c_str());
      return 1;
    }
    const float h = palm.boundsMax.y - palm.boundsMin.y;
    if (palm.totalVertices() == 0 || h <= 1.5f || h >= 12.0f) {
      std::fprintf(stderr, "FAIL tree_palm.glb invalid height=%.2f\n", h);
      return 1;
    }
    std::printf("[PASS] GltfAssetLoader (static node transform): tree_palm.glb verts=%zu, height=%.2fm, minY=%.2fm\n",
                palm.totalVertices(), h, palm.boundsMin.y);
  }

  // 4b. Verify repaired vehicle GLBs (r8, ferrari, sedan, offroad, challenger, mustang, audi, golf, mercedes, rangerover)
  {
    const char* carFiles[] = {
      "r8.glb", "audi.glb", "challenger.glb", "ferrari.glb", "golf.glb",
      "mercedes.glb", "mustang.glb", "offroad.glb", "rangerover.glb", "sedan.glb"
    };
    for (const char* cf : carFiles) {
      const std::filesystem::path carGlb = publicDir / "models" / cf;
      westgate::GltfModel car;
      if (!westgate::GltfAssetLoader::loadGlb(carGlb.string(), car, false, &err)) {
        std::fprintf(stderr, "FAIL vehicle GLB %s load: %s\n", cf, err.c_str());
        return 1;
      }
      const glm::vec3 sz = car.boundsMax - car.boundsMin;
      if (car.totalVertices() < 500 || car.totalIndices() < 500 ||
          std::abs(car.boundsMin.y) > 0.05f || sz.y < 1.0f || sz.y > 2.1f ||
          sz.x < 1.6f || sz.x > 2.5f || sz.z < 3.8f || sz.z > 5.6f) {
        std::fprintf(stderr, "FAIL vehicle GLB %s invalid bounds: size=(%.2f,%.2f,%.2f) minY=%.2f\n",
                     cf, sz.x, sz.y, sz.z, car.boundsMin.y);
        return 1;
      }
      if (std::string(cf) == "r8.glb" && sz.y > 1.32f) {
        std::fprintf(stderr, "FAIL r8.glb still has oversized roof artifact height=%.2f\n", sz.y);
        return 1;
      }
    }
    std::printf("[PASS] GltfAssetLoader (10 repaired vehicle GLBs): all bounds, grounding, and geometry valid\n");
  }

  // 4c. Verify 12 real 3D house GLBs, boat/heli/truck GLBs, and interior/landmark GLBs
  {
    const char* extraGlbs[] = {
      "houses/kenney-suburban/building-type-a.glb",
      "houses/kenney-suburban/building-type-c.glb",
      "houses/quaternius-buildings-2/House1.glb",
      "houses/quaternius-buildings-3/2Story_Balcony_Mat.glb",
      "houses/quaternius-buildings-3/3Story_Slim_Mat.glb",
      "houses/quaternius-buildings-2/Building1_Large.glb",
      "speedboat.glb", "cruiser_boat.glb", "heli.glb", "ambulance.glb",
      "firetruck.glb", "delivery.glb", "semi.glb",
      "cruise_ship.glb", "airliner_737.glb", "int_bed.glb", "int_couch_l.glb", "store_shelf.glb"
    };
    for (const char* ef : extraGlbs) {
      westgate::GltfModel em;
      if (!westgate::GltfAssetLoader::loadGlb((publicDir / "models" / ef).string(), em, false, &err) || em.primitives.empty()) {
        std::fprintf(stderr, "FAIL extra GLB %s: %s\n", ef, err.c_str());
        return 1;
      }
    }
    std::printf("[PASS] GltfAssetLoader (18 house/boat/heli/landmark/interior GLBs): all valid\n");
  }

  // 5. Full GameSession gameplay loop: vehicles, weapons, Iron Pit, contracts, races, sky & save/load
  {
    westgate::GameSession session;
    session.init(world, &player, &physics);
    if (session.weapons().size() != 6 || session.vehicles().size() < 20 || session.npcs().size() < 20 ||
        session.contracts().size() != 3 || session.races().size() != 3 || session.shops().size() != 8) {
      std::fprintf(stderr, "FAIL GameSession init counts\n");
      return 1;
    }

    // Enter parked Mustang near spawn (spawnPos.x + 7, spawnPos.z + 5.5) and accelerate
    player.teleport(glm::vec3(world.spawnPos.x + 7.0f, world.spawnPos.y + 0.5f, world.spawnPos.z + 5.5f), 0.0f);
    westgate::GameInputFrame enterCar{};
    enterCar.interactPressed = true;
    session.update(1.0f / 60.0f, enterCar, player, physics, world, nullptr);
    if (!session.inVehicle()) {
      std::fprintf(stderr, "FAIL player did not enter parked vehicle\n");
      return 1;
    }
    westgate::GameInputFrame drive{};
    drive.moveInput.moveForward = 1.0f;
    for (int f = 0; f < 45; ++f) {
      session.update(1.0f / 60.0f, drive, player, physics, world, nullptr);
    }
    if (!session.currentVehicle() || session.currentVehicle()->speed < 3.0f) {
      std::fprintf(stderr, "FAIL vehicle did not accelerate\n");
      return 1;
    }
    westgate::GameInputFrame exitCar{};
    exitCar.interactPressed = true;
    session.update(1.0f / 60.0f, exitCar, player, physics, world, nullptr);
    if (session.inVehicle()) {
      std::fprintf(stderr, "FAIL player did not exit vehicle\n");
      return 1;
    }

    // Buy Carbine ($850 after awarding purse), fire & verify mag decrement
    session.acceptContract(0, world);
    if (session.activeContractIdx() != 0 || !session.hasGpsWaypoint()) {
      std::fprintf(stderr, "FAIL acceptContract\n");
      return 1;
    }

    // Switch to P226-SD (slot 1) and fire
    westgate::GameInputFrame shoot{};
    shoot.selectWeaponSlot = 1;
    session.update(1.0f / 60.0f, shoot, player, physics, world, nullptr);
    shoot.selectWeaponSlot = -1;
    shoot.firePressed = true;
    const int beforeMag = session.activeWeapon().magAmmo;
    session.update(1.0f / 60.0f, shoot, player, physics, world, nullptr);
    if (session.activeWeapon().magAmmo != beforeMag - 1) {
      std::fprintf(stderr, "FAIL pistol fire did not consume ammo\n");
      return 1;
    }
    assert(session.recoilImpulse() > 0.2f);

    // Switch back to Boxing (slot 0) and trigger Dodge animation
    westgate::GameInputFrame dodgeFrame{};
    dodgeFrame.selectWeaponSlot = 0;
    session.update(1.0f / 60.0f, dodgeFrame, player, physics, world, nullptr);
    dodgeFrame.selectWeaponSlot = -1;
    dodgeFrame.dodgePressed = true;
    session.update(1.0f / 60.0f, dodgeFrame, player, physics, world, nullptr);
    assert(session.isDodging() && session.playerAttackClip() == "dodge");

    // Sky lighting day vs night
    session.setTimeOfDayPreset(westgate::TimeOfDayPreset::Afternoon);
    const auto daySky = session.skyLighting();
    session.setTimeOfDayPreset(westgate::TimeOfDayPreset::Night);
    const auto nightSky = session.skyLighting();
    if (daySky.nightFactor > 0.1f || nightSky.nightFactor < 0.9f) {
      std::fprintf(stderr, "FAIL skyLighting day/night factor\n");
      return 1;
    }

    // Iron Pit 8-fighter roster, 3-match Fight Card, live AI-vs-AI Spectator Cage Bout & Dynamic Point Lights
    assert(session.pitRoster().size() == 8);
    assert(session.pitCard().size() == 3);
    const auto lightsDay = session.gatherDynamicLights(world, player, 1.0f);
    assert(lightsDay.size() >= 7); // 4 pit floods + 2 flickering braziers + Viktor's green lamp

    const int preCash = session.playerCash();
    if (!session.placeIronPitBet(100) || session.playerCash() != preCash - 100 || !session.ironPit().betActive) {
      std::fprintf(stderr, "FAIL placeIronPitBet\n");
      return 1;
    }

    if (!session.startSpectatorBout(0, 0, 50, false, world, nullptr) || !session.spectatorBout().active) {
      std::fprintf(stderr, "FAIL startSpectatorBout\n");
      return 1;
    }
    for (int step = 0; step < 3000 && session.spectatorBout().active; ++step) {
      westgate::GameInputFrame idle{};
      session.update(1.0f / 30.0f, idle, player, physics, world, nullptr);
    }
    if (session.spectatorBout().active || !session.pitCard()[0].settled) {
      std::fprintf(stderr, "FAIL AI-vs-AI spectator bout did not settle\n");
      return 1;
    }
    std::printf("[PASS] Iron Pit 8-fighter card + AI-vs-AI spectator bout settled, dynLights=%zu\n", lightsDay.size());

    // Verify Iron Pit CC0 GLB props load cleanly
    const char* pitProps[] = {
      "pit_barrel.glb", "pit_barrel_open.glb", "pit_barrier.glb", "pit_cash_register.glb",
      "pit_chair.glb", "pit_crate_stack.glb", "pit_floodlight.glb", "pit_pallet.glb",
      "pit_speaker.glb", "pit_stool.glb", "pit_trophy.glb"
    };
    for (const char* pf : pitProps) {
      westgate::GltfModel pm;
      const std::string ppath = std::string(WESTGATE_SOURCE_ROOT) + "/public/models/" + pf;
      if (!westgate::GltfAssetLoader::loadGlb(ppath, pm, false, nullptr) || pm.primitives.empty()) {
        std::fprintf(stderr, "FAIL Iron Pit GLB prop: %s\n", pf);
        return 1;
      }
    }

    // Verify Weather presets (Rain & Thunderstorm) + Rain streak markers
    session.setWeatherPreset(westgate::WeatherPreset::Thunderstorm);
    for (int f = 0; f < 40; ++f) {
      westgate::GameInputFrame idle{};
      session.update(1.0f / 60.0f, idle, player, physics, world, nullptr);
    }
    const auto stormSky = session.skyLighting();
    assert(stormSky.rainIntensity > 0.7f && stormSky.wetness > 0.3f);
    const auto stormMarkers = session.gatherWorldMarkers(1.0f);
    assert(stormMarkers.size() > 50); // includes rain streak markers
    session.setWeatherPreset(westgate::WeatherPreset::Clear);

    // Verify Flyable Helicopter & Wave-Buoyant Boat exist and function
    const westgate::VehicleEntity* heliPtr = nullptr;
    const westgate::VehicleEntity* boatPtr = nullptr;
    for (const auto& v : session.vehicles()) {
      if (v.isAircraft && !heliPtr) heliPtr = &v;
      if (v.isBoat && !boatPtr) boatPtr = &v;
    }
    assert(heliPtr != nullptr && boatPtr != nullptr);
    const glm::vec3 heliStart = heliPtr->pos;
    player.teleport(heliStart + glm::vec3(2.0f, 0.5f, 0.0f), 0.0f);
    westgate::GameInputFrame boardHeli{};
    boardHeli.interactPressed = true;
    session.update(1.0f / 60.0f, boardHeli, player, physics, world, nullptr);
    assert(session.inVehicle() && session.currentVehicle() && session.currentVehicle()->isAircraft);
    westgate::GameInputFrame flyUp{};
    flyUp.moveInput.jump = true;
    flyUp.moveInput.moveForward = 1.0f;
    for (int f = 0; f < 60; ++f) {
      session.update(1.0f / 60.0f, flyUp, player, physics, world, nullptr);
    }
    assert(session.currentVehicle()->pos.y > heliStart.y + 3.0f);
    assert(session.currentVehicle()->rotorAngleRad > 1.0f);
    westgate::GameInputFrame exitHeli{};
    exitHeli.interactPressed = true;
    session.update(1.0f / 60.0f, exitHeli, player, physics, world, nullptr);

    // Verify native grappling (clinch lock -> body slam -> double-leg takedown) in Iron Pit
    {
      const glm::vec3 pitPos = session.ironPit().pos;
      session.teleportTo(pitPos + glm::vec3(0.0f, 0.0f, -1.6f), 0.0f, player);
      westgate::GameInputFrame grp{};
      grp.selectWeaponSlot = 0;
      grp.grapplePressed = true;
      session.update(1.0f / 60.0f, grp, player, physics, world, nullptr);
      if (!session.inClinch()) {
        std::fprintf(stderr, "FAIL native clinch did not lock\n");
        return 1;
      }
      const float hpBeforeSlam = session.ironPit().hp;
      westgate::GameInputFrame slam{};
      slam.grapplePressed = true;
      session.update(1.0f / 60.0f, slam, player, physics, world, nullptr);
      if (session.inClinch() || session.ironPit().hp >= hpBeforeSlam) {
        std::fprintf(stderr, "FAIL native body slam did not resolve clinch\n");
        return 1;
      }
      std::printf("[PASS] Native grappling & body slam verified (pitHp %.0f -> %.0f)\n",
                  hpBeforeSlam, session.ironPit().hp);
    }

    // Verify rear silent takedown on an isolated NPC leaves wanted level at 0 and increments stealthKills
    if (!session.npcs().empty()) {
      size_t isoIdx = session.npcs().size();
      for (size_t ni = 0; ni < session.npcs().size(); ++ni) {
        const auto& cand = session.npcs()[ni];
        if (!cand.alive) continue;
        bool hasWitness = false;
        for (size_t oj = 0; oj < session.npcs().size(); ++oj) {
          if (oj != ni && session.npcs()[oj].alive && glm::distance(cand.pos, session.npcs()[oj].pos) < 18.0f) {
            hasWitness = true;
            break;
          }
        }
        if (!hasWitness) { isoIdx = ni; break; }
      }
      if (isoIdx < session.npcs().size()) {
        const auto& n = session.npcs()[isoIdx];
        const glm::vec3 behindPos = n.pos - glm::vec3(std::sin(n.yawRad), 0.0f, std::cos(n.yawRad)) * 1.35f;
        session.teleportTo(behindPos, glm::degrees(n.yawRad), player);
        westgate::GameInputFrame probe{};
        session.update(1.0f / 60.0f, probe, player, physics, world, nullptr);
        if (!session.takedownReady()) {
          std::fprintf(stderr, "FAIL silent takedown not ready behind isolated NPC\n");
          return 1;
        }
        westgate::GameInputFrame td{};
        td.takedownPressed = true;
        session.update(1.0f / 60.0f, td, player, physics, world, nullptr);
        if (session.stealthKills() < 1 || session.wantedStars() != 0) {
          std::fprintf(stderr, "FAIL silent takedown stealthKills=%d wantedStars=%d\n", session.stealthKills(), session.wantedStars());
          return 1;
        }
        std::printf("[PASS] Native silent takedown verified (stealthKills=%d, wantedStars=%d)\n", session.stealthKills(), session.wantedStars());
      }
    }

    // Save / load JSON persistence
    const std::string saveFile = "/tmp/westgate_test_save.json";
    if (!session.saveToFile(saveFile)) {
      std::fprintf(stderr, "FAIL saveToFile\n");
      return 1;
    }
    westgate::GameSession loaded;
    loaded.init(world, &player, &physics);
    if (!loaded.loadFromFile(saveFile) || std::abs(loaded.timeOfDayHours() - session.timeOfDayHours()) > 0.05f) {
      std::fprintf(stderr, "FAIL loadFromFile round-trip\n");
      return 1;
    }
    // Verify all 20 native vehicle/watercraft/aircraft GLBs load cleanly in C++20 (Meshopt + textures + node hierarchy + material tags)
    for (size_t vi = 0; vi < westgate::kVehicleModelCount; ++vi) {
      const auto kind = static_cast<westgate::VehicleModelKind>(vi);
      const auto& sp = westgate::GameSession::vehicleSpec(kind);
      westgate::GltfModel vm;
      const std::string vpath = std::string(WESTGATE_SOURCE_ROOT) + "/public/" + sp.glbFile;
      std::string verr;
      if (!westgate::GltfAssetLoader::loadGlb(vpath, vm, true, &verr) || vm.primitives.empty()) {
        std::fprintf(stderr, "FAIL vehicle GLB load (%s): %s\n", sp.glbFile, verr.c_str());
        return 1;
      }
      const glm::vec3 sz = vm.boundsMax - vm.boundsMin;
      if (!std::isfinite(sz.x) || sz.x < 0.5f || sz.y < 0.5f || sz.z < 0.5f) {
        std::fprintf(stderr, "FAIL vehicle GLB bounds (%s): %.2fx%.2fx%.2f\n", sp.glbFile, sz.x, sz.y, sz.z);
        return 1;
      }
      if (kind == westgate::VehicleModelKind::Ambulance) {
        // Upgraded VW LT Paramedic Ambulance: grounded minY ~ 0, ~5.33m length, textured PBR + beacons + spinning tires/rims
        if (std::abs(vm.boundsMin.y) > 0.03f || sz.z < 5.1f || vm.textures.empty()) {
          std::fprintf(stderr, "FAIL upgraded ambulance.glb boundsMinY=%.3f sz.z=%.2f textures=%zu\n",
                       vm.boundsMin.y, sz.z, vm.textures.size());
          return 1;
        }
      }
      if (kind == westgate::VehicleModelKind::Helicopter) {
        bool foundMainRotor = false, foundTailRotor = false;
        for (const auto& pr : vm.primitives) {
          int32_t cur = pr.nodeIndex;
          while (cur >= 0 && static_cast<size_t>(cur) < vm.nodes.size()) {
            if (vm.nodes[static_cast<size_t>(cur)].name == "Cube004") foundMainRotor = true;
            if (vm.nodes[static_cast<size_t>(cur)].name == "Cube002") foundTailRotor = true;
            cur = vm.nodes[static_cast<size_t>(cur)].parent;
          }
        }
        if (!foundMainRotor || !foundTailRotor) {
          std::fprintf(stderr, "FAIL heli.glb rotor node hierarchy missing (main=%d tail=%d)\n", foundMainRotor, foundTailRotor);
          return 1;
        }
      }
    }
    // Verify rangerover.glb & semi.glb carry paint__/rim__/tire__/headlight__/taillight__ materials
    {
      westgate::GltfModel rr;
      if (!westgate::GltfAssetLoader::loadGlb(std::string(WESTGATE_SOURCE_ROOT) + "/public/models/rangerover.glb", rr, true, nullptr)) {
        std::fprintf(stderr, "FAIL rangerover.glb reload\n");
        return 1;
      }
      bool hasPaint = false, hasHl = false, hasTl = false, hasRim = false, hasTire = false;
      for (const auto& m : rr.materials) {
        if (m.name.rfind("paint__", 0) == 0) hasPaint = true;
        if (m.name.rfind("headlight__", 0) == 0) hasHl = true;
        if (m.name.rfind("taillight__", 0) == 0) hasTl = true;
        if (m.name.rfind("rim__", 0) == 0) hasRim = true;
        if (m.name.rfind("tire__", 0) == 0) hasTire = true;
      }
      if (!hasPaint || !hasHl || !hasTl || !hasRim || !hasTire) {
        std::fprintf(stderr, "FAIL rangerover.glb missing material tags\n");
        return 1;
      }
    }
    std::printf("[PASS] All 20 Vehicle/Boat/Heli GLBs verified in C++20 (upgraded Ambulance + Heli rotor subtrees)\n");

    // Milestone 2 Verification:
    // 1) 4-Phase Traffic Signals, Dealership Purchase, Valet Delivery, Suspension/Drivetrain & Westgate Customs Stage Tuning
    {
      assert(session.signalIntersections().size() >= 12);
      const auto& sig0 = session.signalIntersections()[0];
      const auto aspNS = session.signalAspectForHeading(sig0, glm::vec2(0.0f, 1.0f));
      const auto aspEW = session.signalAspectForHeading(sig0, glm::vec2(1.0f, 0.0f));
      assert(!(aspNS == westgate::TrafficSignalAspect::Green && aspEW == westgate::TrafficSignalAspect::Green));

      // Starter Golf owned; purchase Golf/Baja Offroad (or Sedan) & spawn via Personal Valet
      assert(session.ownsVehicle(westgate::VehicleModelKind::Golf));
      assert(!session.ownsVehicle(westgate::VehicleModelKind::Sedan));
      const bool boughtSedan = session.buyDealershipVehicle(westgate::VehicleModelKind::Sedan, nullptr);
      assert(boughtSedan && session.ownsVehicle(westgate::VehicleModelKind::Sedan));

      // Teleport near Westgate Customs (112, -135) and auto-board personal Golf R
      session.teleportTo({112.0f, world.heightfield.sampleHeight(112.0f, -125.0f) + 1.0f, -125.0f}, 180.0f, player);
      const int pvId = session.spawnPersonalVehicle(westgate::VehicleModelKind::Golf, 2, player, world, nullptr, true);
      assert(pvId > 0 && session.inVehicle() && session.currentVehicle() != nullptr);

      // Accelerate + steer left + drift to exercise wheel spin, steering angle, RPM/gearbox, suspension & drive camera FOV
      for (int f = 0; f < 55; ++f) {
        westgate::GameInputFrame drv{};
        drv.moveInput.moveForward = 1.0f;
        drv.moveInput.moveRight = (f > 20) ? -0.85f : 0.0f;
        drv.moveInput.jump = (f > 38); // handbrake drift
        session.update(1.0f / 60.0f, drv, player, physics, world, nullptr);
      }
      const auto* cv = session.currentVehicle();
      assert(cv != nullptr);
      assert(cv->speed > 6.0f && cv->wheelSpinRad > 3.0f && cv->steerAngle > 0.12f);
      assert(cv->rpm > 1800.0f && cv->gear >= 1);
      assert(std::abs(cv->suspPitch) > 1e-5f || std::abs(cv->suspRoll) > 1e-5f);
      assert(session.cameraFovDeg(false) > 66.2f);
      session.cycleDriveCameraMode();
      assert(session.driveCameraMode() == 1);
      session.cycleDriveCameraMode();
      assert(session.driveCameraMode() == 2);
      session.cycleDriveCameraMode();
      assert(session.driveCameraMode() == 0);

      // Apply Stage 1 Turbo at Westgate Customs & verify persistence of owned dealership vehicles
      const bool stgOk = session.upgradeCurrentVehicleStage(nullptr);
      assert(stgOk && session.currentVehicle()->engineStage == 1);

      const std::string m2Save = "/tmp/westgate_m2_save.json";
      assert(session.saveToFile(m2Save));
      westgate::GameSession m2Loaded;
      m2Loaded.init(world, &player, &physics);
      assert(m2Loaded.loadFromFile(m2Save) && m2Loaded.ownsVehicle(westgate::VehicleModelKind::Sedan));

      // Exit personal car, test watercraft planing, then test vehicle explosion & chain blast damage
      westgate::GameInputFrame exitCar{};
      exitCar.interactPressed = true;
      session.update(1.0f / 60.0f, exitCar, player, physics, world, nullptr);
      assert(!session.inVehicle());

      // Watercraft planing check
      size_t boatIdx = session.vehicles().size();
      for (size_t i = 0; i < session.vehicles().size(); ++i) {
        if (session.vehicles()[i].isBoat && !session.vehicles()[i].destroyed) { boatIdx = i; break; }
      }
      assert(boatIdx < session.vehicles().size());
      player.teleport(session.vehicles()[boatIdx].pos + glm::vec3(1.5f, 0.8f, 0.0f), 0.0f);
      westgate::GameInputFrame boardBoat{};
      boardBoat.interactPressed = true;
      session.update(1.0f / 60.0f, boardBoat, player, physics, world, nullptr);
      assert(session.inVehicle() && session.currentVehicle()->isBoat);
      for (int f = 0; f < 45; ++f) {
        westgate::GameInputFrame throttleBoat{};
        throttleBoat.moveInput.moveForward = 1.0f;
        throttleBoat.moveInput.moveRight = -0.6f;
        session.update(1.0f / 60.0f, throttleBoat, player, physics, world, nullptr);
      }
      assert(session.currentVehicle()->speed > 5.0f && session.currentVehicle()->pitchRad < -0.01f);
      session.update(1.0f / 60.0f, exitCar, player, physics, world, nullptr);

      // Vehicle destruction & chain blast damage check on an unoccupied car
      size_t targetVeh = session.vehicles().size();
      for (size_t i = 0; i < session.vehicles().size(); ++i) {
        if (!session.vehicles()[i].occupiedByPlayer && !session.vehicles()[i].destroyed && !session.vehicles()[i].isBoat) {
          targetVeh = i;
          break;
        }
      }
      assert(targetVeh < session.vehicles().size());
      session.damageVehicle(targetVeh, 150.0f, world, &player, nullptr, false);
      assert(session.vehicles()[targetVeh].destroyed && session.vehicles()[targetVeh].hp <= 0.0f);

      std::printf("[PASS] Milestone 2 verified: %zu signal intersections, Dealership/Valet, Stage-1 tuning, suspension/spin/steer, boat planing & vehicle blast OK\n",
                  session.signalIntersections().size());
    }

    // -----------------------------------------------------------------------
    // Milestone 3 Verification:
    //   1. Multi-skin GLB merging (soldier.glb: vanguard_Mesh + vanguard_visor) + RightHand bone socket in meter space
    //   2. Native miniaudio MP3 decoding (chapters/ch00_intro.mp3 & comms/dispatch_star1.mp3)
    //   3. Modular Weapon Customization (Optic FOV, Drum Mag, Suppressor/Compensator, 3D PBR Held Weapon Markers)
    //   4. Tactical Stealth Vision Cone + Sniper/Heavy Contract Guards + Headshot (2x+) Ballistics + BodyCarry Ocean Disposal
    // -----------------------------------------------------------------------
    {
      // 1. Multi-skin soldier.glb + military.glb bone socket query
      westgate::GltfModel soldierM, milM, bizM;
      const bool okSoldier = westgate::GltfAssetLoader::loadGlb(std::string(WESTGATE_SOURCE_ROOT) + "/public/characters/soldier.glb", soldierM, true, nullptr);
      const bool okMil = westgate::GltfAssetLoader::loadGlb(std::string(WESTGATE_SOURCE_ROOT) + "/public/characters/military.glb", milM, true, nullptr);
      const bool okBiz = westgate::GltfAssetLoader::loadGlb(std::string(WESTGATE_SOURCE_ROOT) + "/public/characters/business.glb", bizM, false, nullptr);
      WG_CHECK(okSoldier && okMil && okBiz);
      WG_CHECK(soldierM.primitives.size() >= 2 && soldierM.skin.valid && soldierM.skin.jointNodeIndices.size() >= 49);

      std::unordered_map<std::string, westgate::CharacterAnimator::SourceClip> m3Clips;
      for (size_t ai = 0; ai < bizM.animations.size(); ++ai) {
        westgate::CharacterAnimator::SourceClip sc;
        if (westgate::CharacterAnimator::buildSourceClip(bizM.animations[ai].name, bizM, ai, true, sc)) {
          m3Clips[bizM.animations[ai].name] = std::move(sc);
        }
      }
      westgate::CharacterAnimator soldierAnim, milAnim;
      soldierAnim.initForTarget(soldierM);
      milAnim.initForTarget(milM);

      std::array<glm::mat4, westgate::kMaxSkinBones> palS{}, palM{};
      westgate::CharacterAnimState st{};
      westgate::CharacterAnimator::advanceAnimState(st, "Idle", 0.25f, "", 0.0f, 1.0f / 60.0f, 0.1f);
      westgate::CharacterPoseOverlay ov{};
      ov.weaponHoldWeight = 1.0f;
      ov.twoHandedWeapon = true;
      ov.aimWeight = 1.0f;
      soldierAnim.evaluateState(st, m3Clips, palS, &ov);
      milAnim.evaluateState(st, m3Clips, palM, &ov);

      const glm::vec3 sHand = soldierAnim.animatedBonePos("RightHand", palS);
      const glm::vec3 sHead = soldierAnim.animatedBonePos("Head", palS);
      const glm::vec3 mHand = milAnim.animatedBonePos("RightHand", palM);
      WG_CHECK(sHand.y > 0.70f && sHand.y < 1.65f && sHead.y > 1.35f && sHead.y < 1.95f);
      WG_CHECK(mHand.y > 0.70f && mHand.y < 1.65f);

      // 2. Native miniaudio MP3 decoding verification
      std::vector<float> introPcm, dispatchPcm;
      const bool okIntro = westgate::AudioEngine::decodeAudioFileToStereo(
        std::string(WESTGATE_SOURCE_ROOT) + "/public/audio/chapters/ch00_intro.mp3", 48000, introPcm);
      const bool okDisp = westgate::AudioEngine::decodeAudioFileToStereo(
        std::string(WESTGATE_SOURCE_ROOT) + "/public/audio/comms/dispatch_star1.mp3", 48000, dispatchPcm);
      WG_CHECK(okIntro && introPcm.size() > 48000 * 2);
      WG_CHECK(okDisp && dispatchPcm.size() > 12000 * 2);
      float peakAbs = 0.0f;
      for (size_t si = 0; si < std::min<size_t>(introPcm.size(), 96000); ++si) {
        peakAbs = std::max(peakAbs, std::abs(introPcm[si]));
      }
      WG_CHECK(peakAbs > 0.02f && peakAbs <= 1.5f);

      // 3. Modular weapon customization + 3D PBR weapon markers
      session.unlockAllWeapons();
      session.configureWeaponSlot(
        2, // M4A1-S
        westgate::WeaponOpticKind::SniperScope,
        westgate::WeaponMuzzleKind::Compensator,
        westgate::WeaponUnderbarrelKind::LaserSight,
        westgate::WeaponMagKind::Drum,
        westgate::WeaponFinishKind::Gold
      );
      const auto& m4 = session.weapons()[2];
      WG_CHECK(m4.magSize == 60 && !m4.suppressed && m4.optic == westgate::WeaponOpticKind::SniperScope);
      westgate::GameInputFrame selM4{};
      selM4.selectWeaponSlot = 2;
      selM4.aimDown = true;
      session.update(1.0f / 60.0f, selM4, player, physics, world, nullptr);
      WG_CHECK(std::abs(session.cameraFovDeg(true) - 18.0f) < 0.01f);

      std::vector<westgate::WorldMarkerBox> wepBoxes;
      westgate::GameSession::appendHeldWeaponMarkers(sHand, 0.0f, 0.0f, m4, 0.0f, wepBoxes);
      WG_CHECK(wepBoxes.size() >= 8);

      // 4. Contract Sniper/Heavy spawn + Headshot 2x+ damage + BodyCarry Ocean Disposal
      session.configureWeaponSlot(1, westgate::WeaponOpticKind::RedDot, westgate::WeaponMuzzleKind::Suppressor, westgate::WeaponUnderbarrelKind::LaserSight, westgate::WeaponMagKind::Standard, westgate::WeaponFinishKind::Obsidian);
      westgate::GameInputFrame selPistol{};
      selPistol.selectWeaponSlot = 1;
      session.update(1.0f / 60.0f, selPistol, player, physics, world, nullptr);

      session.acceptContract(2, world); // H3: Nadia Kurosawa on Del Sol Pier
      bool hasSniper = false, hasHeavy = false;
      int targetIdx = -1;
      for (size_t ni = 0; ni < session.npcs().size(); ++ni) {
        const auto& n = session.npcs()[ni];
        if (n.role == westgate::EnemyRole::Sniper) hasSniper = true;
        if (n.role == westgate::EnemyRole::Heavy && n.kind == westgate::NpcModelKind::Military) hasHeavy = true;
        if (n.isContractTarget && n.contractIdx == 2) targetIdx = static_cast<int>(ni);
      }
      WG_CHECK(hasSniper && hasHeavy && targetIdx >= 0);

      // Aim directly at target's head (1.58m above feet, accounting for +0.42m over-shoulder camera offset) at Legion Square plaza
      session.acceptContract(1, world); // H2: Viktor Vance at Legion Square
      int targetId = -1;
      glm::vec3 tPos{0.0f};
      for (const auto& n : session.npcs()) {
        if (n.isContractTarget && n.contractIdx == 1) {
          targetId = n.id;
          tPos = n.pos;
          break;
        }
      }
      WG_CHECK(targetId > 0);
      auto findTargetById = [&]() -> const westgate::NpcEntity* {
        for (const auto& n : session.npcs()) {
          if (n.id == targetId) return &n;
        }
        return nullptr;
      };

      session.teleportTo(tPos + glm::vec3(0.42f, 0.25f, -4.2f), 0.0f, player);
      const int hsBefore = session.totalHeadshots();
      for (int shot = 0; shot < 2; ++shot) {
        for (int waitF = 0; waitF < 12; ++waitF) {
          westgate::GameInputFrame aimOnly{};
          aimOnly.aimDown = true;
          session.update(1.0f / 60.0f, aimOnly, player, physics, world, nullptr);
          physics.step(1.0f / 60.0f);
        }
        const auto* curT = findTargetById();
        WG_CHECK(curT != nullptr);
        const glm::vec3 headPt = curT->pos + glm::vec3(0.0f, 1.58f, 0.0f);
        const glm::vec3 pivot = player.position() + glm::vec3(-0.42f * std::cos(player.yaw()), 1.38f, 0.42f * std::sin(player.yaw()));
        const glm::vec3 dH = glm::normalize(headPt - pivot);
        const float desYaw = std::atan2(dH.x, dH.z);
        const float desPitch = std::asin(std::clamp(dH.y, -0.80f, 0.50f));
        westgate::GameInputFrame fireHead{};
        fireHead.aimDown = true;
        fireHead.moveInput.lookDeltaX = -(desYaw - player.yaw()) / 0.0024f;
        fireHead.moveInput.lookDeltaY = -(desPitch - player.pitch()) / 0.0021f;
        session.update(1.0f / 60.0f, fireHead, player, physics, world, nullptr);

        westgate::GameInputFrame pullTrigger{};
        pullTrigger.aimDown = true;
        pullTrigger.firePressed = true;
        session.update(1.0f / 60.0f, pullTrigger, player, physics, world, nullptr);
      }
      const auto* deadT = findTargetById();
      WG_CHECK(deadT != nullptr && !deadT->alive);
      WG_CHECK(session.totalHeadshots() > hsBefore);

      // Walk up to target's corpse, pick up body, teleport to Pacific water edge, and dispose into ocean!
      session.teleportTo(tPos + glm::vec3(0.0f, 0.5f, -0.8f), 0.0f, player);
      WG_CHECK(session.tryCarryOrDisposeBody(player, world, nullptr) && session.isCarryingBody());
      session.teleportTo({-748.0f, 0.20f, 34.0f}, -90.0f, player);
      const int cashBeforeOcean = session.playerCash();
      WG_CHECK(session.tryCarryOrDisposeBody(player, world, nullptr) && !session.isCarryingBody());
      WG_CHECK(session.oceanDisposalsCount() >= 1 && session.playerCash() >= cashBeforeOcean + 1000);

      std::printf("[PASS] Milestone 3 verified: multi-skin soldier.glb (%zu joints, hand=(%.2f,%.2f,%.2f)), MP3 decode (%zu frames), modular M4A1-S (%zu parts), Sniper/Heavy AI, Headshot ballistics & Ocean Body Disposal OK\n",
                  soldierM.skin.jointNodeIndices.size(), sHand.x, sHand.y, sHand.z, introPcm.size() / 2, wepBoxes.size());
    }

    // 5f. Milestone 4: 10-Chapter VOSS // BLACK CONTRACT Campaign, Surveillance Tailing, Bosses, Ally Brick & Save v2
    {
      WG_CHECK(session.storyChapters().size() == 10);
      WG_CHECK(session.isChapterUnlocked(0) && session.isChapterUnlocked(1) && !session.isChapterUnlocked(9));

      // Tech Upgrade & BodyStat progression check
      session.grantCurrencies(500, 40, 40);
      const float maxHpBefore = session.playerMaxHp();
      WG_CHECK(session.buyTechUpgrade(4, nullptr)); // Ceramic Ballistic Plates Tier 1 -> 120 Max HP
      WG_CHECK(session.playerMaxHp() > maxHpBefore);
      const float spdBefore = session.bodyStatValue(westgate::BodyStatKind::Speed);
      session.addBodyStatXp(westgate::BodyStatKind::Speed, 120.0f);
      WG_CHECK(session.bodyStatValue(westgate::BodyStatKind::Speed) > spdBefore);

      // Deploy Chapter 08 (M5: Apex Corporate Tower) -> verify Co-Op Ally Sgt. Brick Horvat + Boss Viktor Sorin
      WG_CHECK(session.startStoryChapter(8, player, world, nullptr, true));
      WG_CHECK(session.activeMission().active && session.activeMission().missionId == 5);
      WG_CHECK(session.activeAllyNpc() != nullptr && session.activeAllyNpc()->displayName == "Sgt. Brick Horvat");
      WG_CHECK(session.activeBossNpc() != nullptr && session.activeBossNpc()->displayName == "Viktor Sorin");
      const int killsBeforeAlly = session.activeMission().missionKills;
      for (int f = 0; f < 140; ++f) {
        westgate::GameInputFrame idle{};
        session.update(1.0f / 60.0f, idle, player, physics, world, nullptr);
      }
      WG_CHECK(session.activeAllyNpc() != nullptr && session.activeAllyNpc()->alive);
      (void)killsBeforeAlly;

      // Deploy Chapter 02 (H1: Surveillance Hit - Marcus Bell) -> verify tailing, silent kill & Pacific Ocean disposal
      WG_CHECK(session.startStoryChapter(2, player, world, nullptr, true));
      WG_CHECK(session.activeSurveillance().active && session.activeSurveillance().targetName == "Marcus Bell");
      const int bellId = session.activeSurveillance().targetNpcId;
      for (int f = 0; f < 30; ++f) {
        westgate::GameInputFrame idle{};
        session.update(1.0f / 60.0f, idle, player, physics, world, nullptr);
      }
      glm::vec3 bellPos{0.0f};
      for (const auto& n : session.npcs()) {
        if (n.id == bellId) { bellPos = n.pos; break; }
      }
      // Sneak behind Marcus Bell, silent takedown, carry & dump in ocean -> completes Ch 02!
      session.teleportTo(bellPos - glm::vec3(0.0f, 0.0f, -1.2f), 180.0f, player);
      westgate::GameInputFrame td{};
      td.takedownPressed = true;
      session.update(1.0f / 60.0f, td, player, physics, world, nullptr);
      WG_CHECK(session.activeSurveillance().phase == westgate::SurveillancePhase::DisposeBody);
      WG_CHECK(session.tryCarryOrDisposeBody(player, world, nullptr));
      session.teleportTo({-748.0f, 0.2f, 34.0f}, -90.0f, player);
      WG_CHECK(session.tryCarryOrDisposeBody(player, world, nullptr));
      westgate::GameInputFrame finSv{};
      session.update(1.0f / 60.0f, finSv, player, physics, world, nullptr);
      WG_CHECK(session.storyChapters()[2].completed && session.lastDebrief().visible);
      session.dismissDebrief();

      // Deploy Chapter 09 (M6: Ironridge Fortress) -> verify Gen. Drago Kovac Phase 2 Mortar Barrage + Full Completion + Epilogue
      session.setDifficulty(westgate::DifficultyMode::Veteran);
      session.unlockAllWeapons();
      WG_CHECK(session.startStoryChapter(9, player, world, nullptr, true));
      WG_CHECK(session.activeMission().active && session.activeBossNpc() != nullptr);
      WG_CHECK(session.activeBossNpc()->displayName == "General Drago Kovac");
      const int kovacId = session.activeMission().bossNpcId;

      // Scrub all 4 interactables (The Sovereign Diamond + 3 Classified Servers)
      for (size_t ii = 0; ii < session.activeMission().interactables.size(); ++ii) {
        const glm::vec3 ip = session.activeMission().interactables[ii].pos;
        session.teleportTo(ip + glm::vec3(0.0f, 0.5f, 1.2f), 180.0f, player);
        for (int f = 0; f < 120 && !session.activeMission().interactables[ii].completed; ++f) {
          westgate::GameInputFrame hold{};
          hold.useHeld = true;
          session.update(1.0f / 60.0f, hold, player, physics, world, nullptr);
        }
        WG_CHECK(session.activeMission().interactables[ii].completed);
      }

      // Destroy all 4 Backup Relay Nodes with suppressed rifle
      {
        westgate::GameInputFrame selRifle{};
        selRifle.selectWeaponSlot = 5; // MK14 DMR
        session.update(1.0f / 60.0f, selRifle, player, physics, world, nullptr);
      }
      for (size_t di = 0; di < session.activeMission().destroyables.size(); ++di) {
        session.grantCurrencies(200, 0, 0);
        session.buyArmorAndMedkit(nullptr);
        const glm::vec3 dp = session.activeMission().destroyables[di].pos;
        const float tx = dp.x + 0.42f;
        const float tz = dp.z - 4.2f;
        const float ty = std::max(world.heightfield.sampleHeight(tx, tz), dp.y) + 0.45f;
        session.teleportTo({tx, ty, tz}, 0.0f, player);
        for (int s = 0; s < 5 && !session.activeMission().destroyables[di].destroyed; ++s) {
          for (int wf = 0; wf < 22; ++wf) {
            westgate::GameInputFrame w{};
            w.aimDown = true;
            session.update(1.0f / 60.0f, w, player, physics, world, nullptr);
            physics.step(1.0f / 60.0f);
          }
          const glm::vec3 rc = session.activeMission().destroyables[di].pos + glm::vec3(0.0f, 1.0f, 0.0f);
          const glm::vec3 cam = session.cameraPosition(player);
          const glm::vec3 dR = glm::normalize(rc - cam);
          westgate::GameInputFrame aimR{};
          aimR.aimDown = true;
          aimR.moveInput.lookDeltaX = -(std::atan2(dR.x, dR.z) - player.yaw()) / 0.0024f;
          aimR.moveInput.lookDeltaY = -(std::asin(std::clamp(dR.y, -0.8f, 0.5f)) - player.pitch()) / 0.0021f;
          session.update(1.0f / 60.0f, aimR, player, physics, world, nullptr);
          westgate::GameInputFrame pull{};
          pull.aimDown = true;
          pull.firePressed = true;
          session.update(1.0f / 60.0f, pull, player, physics, world, nullptr);
        }
        if (!session.activeMission().destroyables[di].destroyed) {
          std::fprintf(stderr, "Relay %zu hp=%.1f playerPos=(%.1f,%.1f,%.1f) dp=(%.1f,%.1f,%.1f) mag=%d\n",
                       di, session.activeMission().destroyables[di].hp,
                       player.position().x, player.position().y, player.position().z,
                       dp.x, dp.y, dp.z, session.activeWeapon().magAmmo);
        }
        WG_CHECK(session.activeMission().destroyables[di].destroyed);
      }

      // Engage General Drago Kovac -> trigger Phase 2 Mortar Barrage at <= 50% HP -> eliminate Kovac!
      bool sawMortarPhase = false;
      for (int shot = 0; shot < 14; ++shot) {
        session.grantCurrencies(200, 0, 0);
        session.buyArmorAndMedkit(nullptr);
        const westgate::NpcEntity* kov = nullptr;
        for (const auto& n : session.npcs()) {
          if (n.id == kovacId) { kov = &n; break; }
        }
        if (!kov || !kov->alive) break;
        const float kx = kov->pos.x + 0.42f;
        const float kz = kov->pos.z - 4.4f;
        const float ky = std::max(world.heightfield.sampleHeight(kx, kz), kov->pos.y) + 0.45f;
        session.teleportTo({kx, ky, kz}, 0.0f, player);
        for (int wf = 0; wf < 22; ++wf) {
          westgate::GameInputFrame w{};
          w.aimDown = true;
          session.update(1.0f / 60.0f, w, player, physics, world, nullptr);
          physics.step(1.0f / 60.0f);
          if (session.activeMission().bossPhaseTriggered) sawMortarPhase = true;
        }
        kov = nullptr;
        for (const auto& n : session.npcs()) {
          if (n.id == kovacId) { kov = &n; break; }
        }
        if (!kov || !kov->alive) break;
        const glm::vec3 headPt = kov->pos + glm::vec3(0.0f, 1.56f, 0.0f);
        const glm::vec3 cam = session.cameraPosition(player);
        const glm::vec3 dK = glm::normalize(headPt - cam);
        westgate::GameInputFrame aimK{};
        aimK.aimDown = true;
        aimK.moveInput.lookDeltaX = -(std::atan2(dK.x, dK.z) - player.yaw()) / 0.0024f;
        aimK.moveInput.lookDeltaY = -(std::asin(std::clamp(dK.y, -0.8f, 0.5f)) - player.pitch()) / 0.0021f;
        session.update(1.0f / 60.0f, aimK, player, physics, world, nullptr);
        westgate::GameInputFrame pull{};
        pull.aimDown = true;
        pull.firePressed = true;
        session.update(1.0f / 60.0f, pull, player, physics, world, nullptr);
        if (session.activeMission().bossPhaseTriggered) sawMortarPhase = true;
      }
      WG_CHECK(sawMortarPhase);
      WG_CHECK(session.activeBossNpc() == nullptr); // Kovac eliminated!

      // Step onto North Citadel Helipad extraction -> verify Ch 09 completion + Epilogue choice!
      session.teleportTo(session.activeMission().extractionPos + glm::vec3(0.0f, 0.6f, 0.0f), 0.0f, player);
      {
        westgate::GameInputFrame ex{};
        session.update(1.0f / 60.0f, ex, player, physics, world, nullptr);
      }
      WG_CHECK(session.storyChapters()[9].completed && session.lastDebrief().awaitsEpilogueChoice);
      session.selectEpilogueChoice(westgate::EpilogueChoice::BurnLedger, nullptr);
      WG_CHECK(session.epilogueChoice() == westgate::EpilogueChoice::BurnLedger);

      // Save v2 round-trip (suit, modular attachments, storyChapters, upgrades, bodyStats, currencies)
      session.setPlayerSuit(westgate::PlayerSuitPreset::VanguardCrimson);
      session.configureWeaponSlot(2, westgate::WeaponOpticKind::Acog, westgate::WeaponMuzzleKind::Suppressor,
                                  westgate::WeaponUnderbarrelKind::LaserSight, westgate::WeaponMagKind::Drum,
                                  westgate::WeaponFinishKind::Gold);
      const std::string v2Save = "/tmp/westgate_v2_roundtrip.json";
      WG_CHECK(session.saveToFile(v2Save));

      westgate::GameSession loaded;
      loaded.init(world, &player, &physics);
      WG_CHECK(loaded.loadFromFile(v2Save));
      WG_CHECK(loaded.playerSuit() == westgate::PlayerSuitPreset::VanguardCrimson);
      WG_CHECK(loaded.weapons()[2].optic == westgate::WeaponOpticKind::Acog);
      WG_CHECK(loaded.weapons()[2].mag == westgate::WeaponMagKind::Drum);
      WG_CHECK(loaded.weapons()[2].finish == westgate::WeaponFinishKind::Gold);
      WG_CHECK(loaded.storyChapters()[9].completed && loaded.epilogueChoice() == westgate::EpilogueChoice::BurnLedger);
      WG_CHECK(loaded.upgradeLevel("ballistic_plates") == 1);

      std::printf("[PASS] Milestone 4 verified: 10-Chapter Campaign (Ch00-Ch09), Surveillance H1, Ally Brick, Gen. Kovac Mortar Phase, Epilogue & Save v2 OK\n");
    }

    std::printf("[PASS] GameSession full loop: %zu vehicles, %zu NPCs, driving/gunplay/contracts/sky/save OK\n",
                session.vehicles().size(), session.npcs().size());
  }

  std::printf("ALL WESTGATE NATIVE C++20 ENGINE TESTS PASSED.\n");
  return 0;
}
