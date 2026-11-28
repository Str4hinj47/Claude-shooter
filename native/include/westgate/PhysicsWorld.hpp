#pragma once

#include "WorldData.hpp"
#include <cstddef>
#include <cstdint>
#include <glm/glm.hpp>
#include <glm/gtc/quaternion.hpp>
#include <memory>
#include <string>
#include <vector>

namespace westgate {

struct RaycastHit {
  bool hit = false;
  float distance = 0.0f;
  glm::vec3 position{0.0f};
  glm::vec3 normal{0.0f, 1.0f, 0.0f};
};

enum class DynamicPropKind : uint8_t {
  Crate = 0,
  Barrel = 1,
  Cone = 2,
  TrashBin = 3,
  Bench = 4,
};

struct DynamicPropPose {
  DynamicPropKind kind = DynamicPropKind::Crate;
  glm::vec3 position{0.0f};
  glm::quat rotation{1.0f, 0.0f, 0.0f, 0.0f};
  glm::vec3 halfExtents{0.35f};
  glm::vec3 color{0.7f, 0.5f, 0.3f};
};

/**
 * Native JoltPhysics v5.7.0 simulation world for Westgate Bay.
 * Hosts the 512x512 HeightFieldShape terrain, static building/prop/cage colliders,
 * dynamic rigid-body crates/barrels, CharacterVirtual player capsule, and broadphase queries.
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

  /** Apply an impulse to any dynamic Jolt rigid bodies within `radius` of `pos` (gunshots, explosions, vehicle impacts). */
  void applyImpulseNear(const glm::vec3& pos, const glm::vec3& impulse, float radius);

  /** Resolve horizontal collision against static buildings/props for driven vehicles (returns true if hit). */
  bool resolveVehicleCollision(const glm::vec3& center, float radius, glm::vec3& outPushXZ, float& outImpactSpeedScale) const;

  /** Read live simulated transforms of all dynamic Jolt rigid bodies. */
  void gatherDynamicProps(std::vector<DynamicPropPose>& outProps) const;

  uint32_t staticBodyCount() const { return staticBodyCount_; }
  uint32_t dynamicBodyCount() const { return dynamicBodyCount_; }

 private:
  struct Impl;
  std::unique_ptr<Impl> impl_;
  uint32_t staticBodyCount_ = 0;
  uint32_t dynamicBodyCount_ = 0;
};

} // namespace westgate
