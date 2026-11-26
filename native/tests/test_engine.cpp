#include "westgate/CharacterAnimator.hpp"
#include "westgate/EngineTypes.hpp"
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
  assert(!world.roads.empty());
  assert(!world.props.empty());

  const float pitY = world.heightfield.sampleHeight(world.fightPitPos.x, world.fightPitPos.z);
  assert(std::isfinite(pitY) && std::abs(pitY - 2.8f) < 0.8f);
  std::printf("[PASS] WorldData loaded: %zu chunks, %zu roads, %zu props, fightPitY=%.2fm\n",
              world.chunks.size(), world.roads.size(), world.props.size(), pitY);

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
  std::printf("[PASS] JoltPhysics: bodies=%u, walkedTo=(%.2f, %.2f, %.2f), grounded=%d, rayHitY=%.2f\n",
              physics.staticBodyCount(), endPos.x, endPos.y, endPos.z, player.grounded() ? 1 : 0, groundHit.position.y);

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

  std::printf("ALL WESTGATE NATIVE C++20 ENGINE TESTS PASSED.\n");
  return 0;
}
