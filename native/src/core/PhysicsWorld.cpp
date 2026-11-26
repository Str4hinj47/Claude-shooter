#include <Jolt/Jolt.h>
#include <Jolt/RegisterTypes.h>
#include <Jolt/Core/Factory.h>
#include <Jolt/Core/TempAllocator.h>
#include <Jolt/Core/JobSystemThreadPool.h>
#include <Jolt/Physics/PhysicsSettings.h>
#include <Jolt/Physics/PhysicsSystem.h>
#include <Jolt/Physics/Collision/Shape/BoxShape.h>
#include <Jolt/Physics/Collision/Shape/CapsuleShape.h>
#include <Jolt/Physics/Collision/Shape/HeightFieldShape.h>
#include <Jolt/Physics/Collision/RayCast.h>
#include <Jolt/Physics/Collision/CastResult.h>
#include <Jolt/Physics/Body/BodyCreationSettings.h>
#include <Jolt/Physics/Character/CharacterVirtual.h>

#include "westgate/PhysicsWorld.hpp"
#include <algorithm>
#include <atomic>
#include <thread>

namespace westgate {

namespace {

namespace Layers {
static constexpr JPH::ObjectLayer NON_MOVING = 0;
static constexpr JPH::ObjectLayer MOVING = 1;
static constexpr JPH::ObjectLayer NUM_LAYERS = 2;
} // namespace Layers

namespace BroadPhaseLayers {
static constexpr JPH::BroadPhaseLayer NON_MOVING(0);
static constexpr JPH::BroadPhaseLayer MOVING(1);
static constexpr uint32_t NUM_LAYERS = 2;
} // namespace BroadPhaseLayers

class BPLayerInterfaceImpl final : public JPH::BroadPhaseLayerInterface {
 public:
  BPLayerInterfaceImpl() {
    mObjectToBroadPhase[Layers::NON_MOVING] = BroadPhaseLayers::NON_MOVING;
    mObjectToBroadPhase[Layers::MOVING] = BroadPhaseLayers::MOVING;
  }

  uint32_t GetNumBroadPhaseLayers() const override { return BroadPhaseLayers::NUM_LAYERS; }

  JPH::BroadPhaseLayer GetBroadPhaseLayer(JPH::ObjectLayer inLayer) const override {
    return mObjectToBroadPhase[inLayer];
  }

#if defined(JPH_EXTERNAL_PROFILE) || defined(JPH_PROFILE_ENABLED)
  const char* GetBroadPhaseLayerName(JPH::BroadPhaseLayer inLayer) const override {
    switch ((JPH::BroadPhaseLayer::Type)inLayer) {
      case (JPH::BroadPhaseLayer::Type)BroadPhaseLayers::NON_MOVING: return "NON_MOVING";
      case (JPH::BroadPhaseLayer::Type)BroadPhaseLayers::MOVING: return "MOVING";
      default: return "INVALID";
    }
  }
#endif

 private:
  JPH::BroadPhaseLayer mObjectToBroadPhase[Layers::NUM_LAYERS];
};

class ObjectVsBroadPhaseLayerFilterImpl final : public JPH::ObjectVsBroadPhaseLayerFilter {
 public:
  bool ShouldCollide(JPH::ObjectLayer inLayer1, JPH::BroadPhaseLayer inLayer2) const override {
    if (inLayer1 == Layers::NON_MOVING) return inLayer2 == BroadPhaseLayers::MOVING;
    return true;
  }
};

class ObjectLayerPairFilterImpl final : public JPH::ObjectLayerPairFilter {
 public:
  bool ShouldCollide(JPH::ObjectLayer inObject1, JPH::ObjectLayer inObject2) const override {
    if (inObject1 == Layers::NON_MOVING) return inObject2 == Layers::MOVING;
    return true;
  }
};

std::atomic<int> gJoltRefCount{0};

void ensureJoltInitialized() {
  if (gJoltRefCount.fetch_add(1) == 0) {
    JPH::RegisterDefaultAllocator();
    JPH::Factory::sInstance = new JPH::Factory();
    JPH::RegisterTypes();
  }
}

void releaseJoltIfLast() {
  if (gJoltRefCount.fetch_sub(1) == 1) {
    JPH::UnregisterTypes();
    delete JPH::Factory::sInstance;
    JPH::Factory::sInstance = nullptr;
  }
}

} // namespace

struct PhysicsWorld::Impl {
  std::unique_ptr<JPH::TempAllocatorImpl> tempAllocator;
  std::unique_ptr<JPH::JobSystemThreadPool> jobSystem;
  BPLayerInterfaceImpl broadPhaseLayerInterface;
  ObjectVsBroadPhaseLayerFilterImpl objectVsBroadPhaseLayerFilter;
  ObjectLayerPairFilterImpl objectVsObjectLayerFilter;
  std::unique_ptr<JPH::PhysicsSystem> physicsSystem;
  JPH::Ref<JPH::CharacterVirtual> character;
  bool initialized = false;
};

PhysicsWorld::PhysicsWorld() : impl_(std::make_unique<Impl>()) {
  ensureJoltInitialized();
}

PhysicsWorld::~PhysicsWorld() {
  shutdown();
  releaseJoltIfLast();
}

bool PhysicsWorld::initFromWorld(const WorldData& world, std::string* err) {
  shutdown();

  impl_->tempAllocator = std::make_unique<JPH::TempAllocatorImpl>(16 * 1024 * 1024);
  const uint32_t threads = std::max(1u, std::thread::hardware_concurrency() > 1 ? std::thread::hardware_concurrency() - 1 : 1u);
  impl_->jobSystem = std::make_unique<JPH::JobSystemThreadPool>(JPH::cMaxPhysicsJobs, JPH::cMaxPhysicsBarriers, static_cast<int>(threads));

  const uint32_t maxBodies = 16384;
  const uint32_t numBodyMutexes = 0;
  const uint32_t maxBodyPairs = 16384;
  const uint32_t maxContactConstraints = 8192;

  impl_->physicsSystem = std::make_unique<JPH::PhysicsSystem>();
  impl_->physicsSystem->Init(
    maxBodies,
    numBodyMutexes,
    maxBodyPairs,
    maxContactConstraints,
    impl_->broadPhaseLayerInterface,
    impl_->objectVsBroadPhaseLayerFilter,
    impl_->objectVsObjectLayerFilter
  );
  impl_->physicsSystem->SetGravity(JPH::Vec3(0.0f, -20.0f, 0.0f));

  JPH::BodyInterface& bodyInterface = impl_->physicsSystem->GetBodyInterface();
  staticBodyCount_ = 0;

  // 1. 512x512 HeightFieldShape terrain
  const uint32_t gridN = world.heightfield.gridSize();
  if (gridN >= 2 && !world.heightfield.rawSamples().empty()) {
    const float cellSize = (world.worldMax - world.worldMin) / static_cast<float>(gridN - 1);
    JPH::HeightFieldShapeSettings hfSettings(
      world.heightfield.rawSamples().data(),
      JPH::Vec3(world.worldMin, 0.0f, world.worldMin),
      JPH::Vec3(cellSize, 1.0f, cellSize),
      gridN
    );
    JPH::ShapeSettings::ShapeResult hfRes = hfSettings.Create();
    if (!hfRes.IsValid()) {
      if (err) *err = std::string("Jolt HeightFieldShape failed: ") + hfRes.GetError().c_str();
      return false;
    }
    JPH::BodyCreationSettings terrainBody(
      hfRes.Get(),
      JPH::RVec3::sZero(),
      JPH::Quat::sIdentity(),
      JPH::EMotionType::Static,
      Layers::NON_MOVING
    );
    bodyInterface.CreateAndAddBody(terrainBody, JPH::EActivation::DontActivate);
    ++staticBodyCount_;
  }

  // 2. Static building colliders across all 225 Westgate Bay chunks
  for (const auto& chunk : world.chunks) {
    for (const auto& b : chunk.buildings) {
      if (b.size.x < 0.25f || b.size.y < 0.25f || b.size.z < 0.25f) continue;
      JPH::BoxShapeSettings boxSettings(JPH::Vec3(b.size.x * 0.5f, b.size.y * 0.5f, b.size.z * 0.5f));
      JPH::ShapeSettings::ShapeResult boxRes = boxSettings.Create();
      if (!boxRes.IsValid()) continue;
      JPH::BodyCreationSettings bcs(
        boxRes.Get(),
        JPH::RVec3(b.center.x, b.center.y, b.center.z),
        JPH::Quat::sIdentity(),
        JPH::EMotionType::Static,
        Layers::NON_MOVING
      );
      bodyInterface.CreateAndAddBody(bcs, JPH::EActivation::DontActivate);
      ++staticBodyCount_;
    }
  }

  impl_->physicsSystem->OptimizeBroadPhase();
  impl_->initialized = true;
  spawnCharacter(world.spawnPos + glm::vec3(0.0f, 1.0f, 0.0f));
  return true;
}

void PhysicsWorld::shutdown() {
  impl_->character = nullptr;
  impl_->physicsSystem.reset();
  impl_->jobSystem.reset();
  impl_->tempAllocator.reset();
  impl_->initialized = false;
  staticBodyCount_ = 0;
}

void PhysicsWorld::spawnCharacter(const glm::vec3& pos) {
  if (!impl_->initialized) return;
  JPH::CharacterVirtualSettings settings;
  settings.mShape = new JPH::CapsuleShape(0.6f, 0.35f);
  settings.mMaxSlopeAngle = JPH::DegreesToRadians(48.0f);
  settings.mSupportingVolume = JPH::Plane(JPH::Vec3::sAxisY(), -0.35f);
  impl_->character = new JPH::CharacterVirtual(
    &settings,
    JPH::RVec3(pos.x, pos.y + 0.95f, pos.z),
    JPH::Quat::sIdentity(),
    impl_->physicsSystem.get()
  );
}

void PhysicsWorld::setCharacterPosition(const glm::vec3& pos) {
  if (!impl_->character || !impl_->initialized) return;
  impl_->character->SetPosition(JPH::RVec3(pos.x, pos.y + 0.95f, pos.z));
  impl_->character->SetLinearVelocity(JPH::Vec3::sZero());
  impl_->character->RefreshContacts(
    impl_->physicsSystem->GetDefaultBroadPhaseLayerFilter(Layers::MOVING),
    impl_->physicsSystem->GetDefaultLayerFilter(Layers::MOVING),
    {},
    {},
    *impl_->tempAllocator
  );
}

void PhysicsWorld::updateCharacter(float dt, const glm::vec3& desiredVelocity, bool jumpRequested) {
  if (!impl_->character || !impl_->initialized) return;
  JPH::Vec3 currentVel = impl_->character->GetLinearVelocity();
  float vy = currentVel.GetY();
  const bool grounded = impl_->character->GetGroundState() == JPH::CharacterBase::EGroundState::OnGround;
  if (grounded) {
    vy = jumpRequested ? 7.4f : -0.5f;
  } else {
    vy = std::max(-45.0f, vy - 20.0f * dt);
  }
  impl_->character->SetLinearVelocity(JPH::Vec3(desiredVelocity.x, vy, desiredVelocity.z));

  JPH::CharacterVirtual::ExtendedUpdateSettings updateSettings;
  updateSettings.mStickToFloorStepDown = JPH::Vec3(0.0f, -0.5f, 0.0f);
  updateSettings.mWalkStairsStepUp = JPH::Vec3(0.0f, 0.4f, 0.0f);

  impl_->character->ExtendedUpdate(
    dt,
    JPH::Vec3(0.0f, -20.0f, 0.0f),
    updateSettings,
    impl_->physicsSystem->GetDefaultBroadPhaseLayerFilter(Layers::MOVING),
    impl_->physicsSystem->GetDefaultLayerFilter(Layers::MOVING),
    {},
    {},
    *impl_->tempAllocator
  );
}

void PhysicsWorld::step(float dt) {
  if (!impl_->initialized) return;
  impl_->physicsSystem->Update(dt, 1, impl_->tempAllocator.get(), impl_->jobSystem.get());
}

glm::vec3 PhysicsWorld::characterPosition() const {
  if (!impl_->character) return glm::vec3(0.0f);
  const JPH::RVec3 p = impl_->character->GetPosition();
  return glm::vec3(static_cast<float>(p.GetX()), static_cast<float>(p.GetY()) - 0.95f, static_cast<float>(p.GetZ()));
}

glm::vec3 PhysicsWorld::characterVelocity() const {
  if (!impl_->character) return glm::vec3(0.0f);
  const JPH::Vec3 v = impl_->character->GetLinearVelocity();
  return glm::vec3(v.GetX(), v.GetY(), v.GetZ());
}

bool PhysicsWorld::isCharacterGrounded() const {
  if (!impl_->character) return false;
  return impl_->character->GetGroundState() == JPH::CharacterBase::EGroundState::OnGround;
}

RaycastHit PhysicsWorld::raycast(const glm::vec3& origin, const glm::vec3& direction, float maxDist) const {
  RaycastHit out;
  if (!impl_->initialized) return out;
  const glm::vec3 dir = glm::normalize(direction);
  JPH::RRayCast ray(
    JPH::RVec3(origin.x, origin.y, origin.z),
    JPH::Vec3(dir.x * maxDist, dir.y * maxDist, dir.z * maxDist)
  );
  JPH::RayCastResult hitRes;
  if (impl_->physicsSystem->GetNarrowPhaseQuery().CastRay(ray, hitRes)) {
    out.hit = true;
    out.distance = hitRes.mFraction * maxDist;
    out.position = origin + dir * out.distance;
    const JPH::BodyLockRead lock(impl_->physicsSystem->GetBodyLockInterface(), hitRes.mBodyID);
    if (lock.Succeeded()) {
      const JPH::Vec3 n = lock.GetBody().GetWorldSpaceSurfaceNormal(hitRes.mSubShapeID2, ray.GetPointOnRay(hitRes.mFraction));
      out.normal = glm::vec3(n.GetX(), n.GetY(), n.GetZ());
    }
  }
  return out;
}

} // namespace westgate
