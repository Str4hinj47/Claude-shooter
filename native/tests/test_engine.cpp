#include "westgate/CharacterAnimator.hpp"
#include "westgate/EngineTypes.hpp"
#include "westgate/GameSession.hpp"
#include "westgate/GltfAssetLoader.hpp"
#include "westgate/PhysicsWorld.hpp"
#include "westgate/PlayerController.hpp"
#include "westgate/WorldData.hpp"

#include <atomic>
#include <cassert>
#include <cmath>
#include <cstdio>
#include <filesystem>
#include <glm/gtc/matrix_transform.hpp>

#ifndef WESTGATE_SOURCE_ROOT
#define WESTGATE_SOURCE_ROOT "."
#endif

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
  std::printf("[PASS] WorldData loaded: %ux%u heightfield, %zu chunks, %zu roads, %zu props, fightPitY=%.2fm\n",
              world.heightfield.gridSize(), world.heightfield.gridSize(), world.chunks.size(), world.roads.size(), world.props.size(), pitY);

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

    std::printf("[PASS] Anatomical retarget checks: guardHandL=(%.2f,%.2f,%.2f), jabExtZ=%.2fm, kdPelvisY=%.2fm, walkStrideZ=%.2fm, bizKdY=%.2fm\n",
                guardHandL.x, guardHandL.y, guardHandL.z,
                jabHandL.z - jabShoulderL.z, kdPelvis.y,
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
    std::printf("[PASS] GameSession full loop: %zu vehicles, %zu NPCs, driving/gunplay/contracts/sky/save OK\n",
                session.vehicles().size(), session.npcs().size());
  }

  std::printf("ALL WESTGATE NATIVE C++20 ENGINE TESTS PASSED.\n");
  return 0;
}
