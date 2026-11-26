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

  // 4. Native glTF/GLB loader (standard + KHR_mesh_quantization + EXT_meshopt_compression)
  const std::filesystem::path fighterGlb = publicDir / "characters" / "fighter" / "base_body.glb";
  if (std::filesystem::exists(fighterGlb)) {
    westgate::GltfModel fighter;
    if (!westgate::GltfAssetLoader::loadGlb(fighterGlb.string(), fighter, true, &err)) {
      std::fprintf(stderr, "FAIL GltfAssetLoader (meshopt) failed: %s\n", err.c_str());
      return 1;
    }
    assert(fighter.totalVertices() > 10000 && fighter.totalIndices() > 10000);
    std::printf("[PASS] GltfAssetLoader (EXT_meshopt_compression): base_body.glb verts=%zu, idx=%zu, bones=%u, textures=%zu\n",
                fighter.totalVertices(), fighter.totalIndices(), fighter.boneCount, fighter.textures.size());
  }

  const std::filesystem::path bizGlb = publicDir / "characters" / "business.glb";
  if (std::filesystem::exists(bizGlb)) {
    westgate::GltfModel biz;
    if (!westgate::GltfAssetLoader::loadGlb(bizGlb.string(), biz, false, &err)) {
      std::fprintf(stderr, "FAIL GltfAssetLoader (quantized) failed: %s\n", err.c_str());
      return 1;
    }
    assert(biz.totalVertices() > 1000);
    std::printf("[PASS] GltfAssetLoader (KHR_mesh_quantization): business.glb verts=%zu, idx=%zu\n",
                biz.totalVertices(), biz.totalIndices());
  }

  std::printf("ALL WESTGATE NATIVE C++20 ENGINE TESTS PASSED.\n");
  return 0;
}
