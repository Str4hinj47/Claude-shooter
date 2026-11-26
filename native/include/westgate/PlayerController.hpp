#pragma once

#include "PhysicsWorld.hpp"
#include <glm/glm.hpp>

namespace westgate {

struct PlayerInputState {
  float moveForward = 0.0f; // -1..+1
  float moveRight = 0.0f;   // -1..+1
  float lookDeltaX = 0.0f;
  float lookDeltaY = 0.0f;
  bool sprint = false;
  bool crouch = false;
  bool jump = false;
};

class PlayerController {
 public:
  void init(PhysicsWorld* physics, const glm::vec3& startPos, float startYawDeg = 0.0f);
  void teleport(const glm::vec3& pos, float yawDeg);
  void update(float dt, const PlayerInputState& input);

  glm::vec3 position() const;
  glm::vec3 cameraPosition() const { return cameraPos_; }
  glm::vec3 cameraTarget() const { return cameraTarget_; }
  glm::vec3 forwardXZ() const;
  float speed() const { return currentSpeed_; }
  float yaw() const { return yaw_; }
  float pitch() const { return pitch_; }
  bool grounded() const;
  bool sprinting() const { return sprinting_; }
  bool steppedThisFrame() const { return steppedThisFrame_; }
  float stepIntensity() const { return stepIntensity_; }

 private:
  PhysicsWorld* physics_ = nullptr;
  float yaw_ = 0.0f;
  float pitch_ = -0.18f;
  float camDist_ = 3.8f;
  float currentSpeed_ = 0.0f;
  float stepAccum_ = 0.0f;
  bool sprinting_ = false;
  bool steppedThisFrame_ = false;
  float stepIntensity_ = 0.0f;
  glm::vec3 cameraPos_{0.0f, 8.0f, -6.0f};
  glm::vec3 cameraTarget_{0.0f, 1.5f, 0.0f};
};

} // namespace westgate
