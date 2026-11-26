#pragma once

#include "WorldData.hpp"
#include <glm/glm.hpp>
#include <memory>
#include <string>

namespace westgate {

struct RaycastHit {
  bool hit = false;
  float distance = 0.0f;
  glm::vec3 position{0.0f};
  glm::vec3 normal{0.0f, 1.0f, 0.0f};
};

/**
 * Native JoltPhysics v5.7.0 simulation world for Westgate Bay.
 * Hosts the 512x512 HeightFieldShape terrain, static building colliders,
 * CharacterVirtual player capsule, and multi-threaded broadphase raycasts.
 */
class PhysicsWorld {
 public:
  PhysicsWorld();
  ~PhysicsWorld();

  PhysicsWorld(const PhysicsWorld&) = delete;
  PhysicsWorld& operator=(const PhysicsWorld&) = delete;

  bool initFromWorld(const WorldData& world, std::string* err = nullptr);
  void shutdown();

  void step(float dt);

  void spawnCharacter(const glm::vec3& pos);
  void setCharacterPosition(const glm::vec3& pos);
  void updateCharacter(float dt, const glm::vec3& desiredVelocity, bool jumpRequested);

  glm::vec3 characterPosition() const;
  glm::vec3 characterVelocity() const;
  bool isCharacterGrounded() const;

  RaycastHit raycast(const glm::vec3& origin, const glm::vec3& direction, float maxDist) const;

  uint32_t staticBodyCount() const { return staticBodyCount_; }

 private:
  struct Impl;
  std::unique_ptr<Impl> impl_;
  uint32_t staticBodyCount_ = 0;
};

} // namespace westgate
