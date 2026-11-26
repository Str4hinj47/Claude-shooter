#include "westgate/PlayerController.hpp"
#include <algorithm>
#include <cmath>
#include <glm/gtc/constants.hpp>

namespace westgate {

void PlayerController::init(PhysicsWorld* physics, const glm::vec3& startPos, float startYawDeg) {
  physics_ = physics;
  yaw_ = glm::radians(startYawDeg);
  pitch_ = 0.16f;
  currentSpeed_ = 0.0f;
  stepAccum_ = 0.0f;
  if (physics_) {
    physics_->setCharacterPosition(startPos);
  }
}

void PlayerController::teleport(const glm::vec3& pos, float yawDeg) {
  yaw_ = glm::radians(yawDeg);
  currentSpeed_ = 0.0f;
  if (physics_) {
    physics_->setCharacterPosition(pos + glm::vec3(0.0f, 0.35f, 0.0f));
  }
}

glm::vec3 PlayerController::forwardXZ() const {
  return glm::normalize(glm::vec3(std::sin(yaw_), 0.0f, std::cos(yaw_)));
}

glm::vec3 PlayerController::position() const {
  return physics_ ? physics_->characterPosition() : glm::vec3(0.0f);
}

bool PlayerController::grounded() const {
  return physics_ ? physics_->isCharacterGrounded() : false;
}

void PlayerController::update(float dt, const PlayerInputState& input) {
  steppedThisFrame_ = false;
  stepIntensity_ = 0.0f;

  yaw_ -= input.lookDeltaX * 0.0024f;
  pitch_ = std::clamp(pitch_ + input.lookDeltaY * 0.0021f, -0.65f, 1.05f);

  const glm::vec3 fwd(std::sin(yaw_), 0.0f, std::cos(yaw_));
  const glm::vec3 right(-std::cos(yaw_), 0.0f, std::sin(yaw_));

  glm::vec3 wishDir = fwd * input.moveForward + right * input.moveRight;
  const float wishLen = glm::length(wishDir);
  if (wishLen > 1e-4f) wishDir /= wishLen;

  sprinting_ = input.sprint && !input.crouch && wishLen > 0.2f;
  const float targetSpeed = wishLen > 0.05f ? (input.crouch ? 2.8f : (sprinting_ ? 8.6f : 4.8f)) : 0.0f;
  const float accel = targetSpeed > currentSpeed_ ? 14.0f : 18.0f;
  currentSpeed_ += (targetSpeed - currentSpeed_) * std::min(1.0f, accel * dt);

  const glm::vec3 desiredVel = wishDir * currentSpeed_;
  if (physics_) {
    physics_->updateCharacter(dt, desiredVel, input.jump);
  }

  // Click-free footstep trigger synced to real ground stride distance
  if (grounded() && currentSpeed_ > 0.6f) {
    const float strideLen = sprinting_ ? 2.65f : 1.75f;
    stepAccum_ += (currentSpeed_ * dt) / strideLen;
    if (stepAccum_ >= 1.0f) {
      stepAccum_ -= 1.0f;
      steppedThisFrame_ = true;
      stepIntensity_ = std::clamp(currentSpeed_ / 8.6f, 0.25f, 1.0f);
    }
  } else {
    stepAccum_ = 0.0f;
  }

  // Third-person over-shoulder camera with Jolt physics wall-clipping raycast
  const glm::vec3 pos = position();
  const glm::vec3 pivot = pos + glm::vec3(0.0f, input.crouch ? 1.15f : 1.55f, 0.0f);
  const glm::vec3 camDir(
    std::sin(yaw_) * std::cos(pitch_),
    std::sin(pitch_),
    std::cos(yaw_) * std::cos(pitch_)
  );
  const glm::vec3 shoulderOffset = right * 0.55f;
  const glm::vec3 camTarget = pivot + shoulderOffset;

  float dist = camDist_;
  if (physics_) {
    const RaycastHit hit = physics_->raycast(camTarget, -camDir, camDist_);
    if (hit.hit) {
      dist = std::max(0.85f, hit.distance - 0.3f);
    }
  }

  cameraTarget_ = camTarget + camDir * 10.0f;
  cameraPos_ = camTarget - camDir * dist;
}

} // namespace westgate
