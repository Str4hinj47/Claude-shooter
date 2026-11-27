#include <Jolt/Jolt.h>
#include <Jolt/RegisterTypes.h>
#include <Jolt/Core/Factory.h>
#include <Jolt/Core/TempAllocator.h>
#include <Jolt/Core/JobSystemThreadPool.h>
#include <Jolt/Physics/PhysicsSettings.h>
#include <Jolt/Physics/PhysicsSystem.h>
#include <Jolt/Physics/Collision/Shape/BoxShape.h>
#include <Jolt/Physics/Collision/Shape/CapsuleShape.h>
#include <Jolt/Physics/Collision/Shape/CylinderShape.h>
#include <Jolt/Physics/Collision/Shape/HeightFieldShape.h>
#include <Jolt/Physics/Collision/RayCast.h>
#include <Jolt/Physics/Collision/CastResult.h>
#include <Jolt/Physics/Body/BodyCreationSettings.h>
#include <Jolt/Physics/Character/CharacterVirtual.h>

#include "westgate/PhysicsWorld.hpp"
#include <algorithm>
#include <atomic>
#include <cmath>
#include <thread>
#include <tuple>

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

struct DynamicBodyEntry {
  JPH::BodyID id;
  DynamicPropKind kind = DynamicPropKind::Crate;
  glm::vec3 halfExtents{0.35f};
  glm::vec3 color{0.7f, 0.5f, 0.3f};
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
  std::vector<DynamicBodyEntry> dynamicBodies;
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

  const uint32_t maxBodies = 24576;
  const uint32_t numBodyMutexes = 0;
  const uint32_t maxBodyPairs = 24576;
  const uint32_t maxContactConstraints = 12288;

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
  dynamicBodyCount_ = 0;

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

  // 3. Static prop colliders (trees, dumpsters) + breakable/knockable dynamic street furniture!
  std::vector<std::tuple<DynamicPropKind, glm::vec3, glm::vec3, glm::vec3, float>> streetDynamics;
  {
    JPH::ShapeRefC trunkShape = JPH::CylinderShapeSettings(2.1f, 0.35f).Create().Get();
    JPH::ShapeRefC dumpsterShape = JPH::BoxShapeSettings(JPH::Vec3(1.0f, 0.72f, 0.65f)).Create().Get();

    for (const auto& p : world.props) {
      JPH::ShapeRefC shape;
      float yOff = 0.0f;
      if (p.proto == "palm_tree" || p.proto == "oak_tree" || p.proto == "pine_tree") {
        shape = trunkShape;
        yOff = 2.1f;
      } else if (p.proto == "dumpster") {
        shape = dumpsterShape;
        yOff = 0.72f;
      } else if (p.proto == "trashcan" && streetDynamics.size() < 48) {
        streetDynamics.emplace_back(DynamicPropKind::TrashBin, p.pos, glm::vec3(0.28f, 0.45f, 0.28f), glm::vec3(0.22f, 0.48f, 0.34f), 14.0f);
        continue;
      } else if (p.proto == "park_bench" && streetDynamics.size() < 84) {
        streetDynamics.emplace_back(DynamicPropKind::Bench, p.pos, glm::vec3(0.90f, 0.42f, 0.35f), glm::vec3(0.46f, 0.32f, 0.20f), 28.0f);
        continue;
      }
      if (!shape) continue;
      const JPH::Quat rot = JPH::Quat::sRotation(JPH::Vec3::sAxisY(), p.ry);
      JPH::BodyCreationSettings bcs(
        shape,
        JPH::RVec3(p.pos.x, p.pos.y + yOff, p.pos.z),
        rot,
        JPH::EMotionType::Static,
        Layers::NON_MOVING
      );
      bodyInterface.CreateAndAddBody(bcs, JPH::EActivation::DontActivate);
      ++staticBodyCount_;
    }
  }

  // 3b. Bridge road deck colliders (so elevated causeway bridges over ocean have solid driveable decks)
  for (const auto& road : world.roads) {
    if (!road.isBridge || road.samples.size() < 2) continue;
    for (size_t i = 0; i + 1 < road.samples.size(); ++i) {
      const glm::vec3 a = road.samples[i].pos;
      const glm::vec3 b = road.samples[i + 1].pos;
      const glm::vec3 mid = (a + b) * 0.5f;
      const glm::vec3 d = b - a;
      const float segLen = std::max(0.5f, std::hypot(d.x, d.z));
      const float yaw = std::atan2(d.x, d.z);
      const float pitch = -std::atan2(d.y, segLen);
      JPH::ShapeRefC deckShape = JPH::BoxShapeSettings(JPH::Vec3(road.width * 0.52f, 0.35f, segLen * 0.56f)).Create().Get();
      const JPH::Quat rot = JPH::Quat::sRotation(JPH::Vec3::sAxisY(), yaw) * JPH::Quat::sRotation(JPH::Vec3::sAxisX(), pitch);
      bodyInterface.CreateAndAddBody(
        JPH::BodyCreationSettings(deckShape, JPH::RVec3(mid.x, mid.y - 0.30f, mid.z), rot, JPH::EMotionType::Static, Layers::NON_MOVING),
        JPH::EActivation::DontActivate
      );
      ++staticBodyCount_;
    }
  }

  // 3c. Walk-In Interior Room Walls & Roofs (Safehouse, Downtown 24/7 Mart, Customs Garage, Iron Pit Armory)
  {
    auto addWall = [&](const glm::vec3& c, const glm::vec3& halfExt) {
      JPH::ShapeRefC s = JPH::BoxShapeSettings(JPH::Vec3(halfExt.x, halfExt.y, halfExt.z)).Create().Get();
      bodyInterface.CreateAndAddBody(
        JPH::BodyCreationSettings(s, JPH::RVec3(c.x, c.y, c.z), JPH::Quat::sIdentity(), JPH::EMotionType::Static, Layers::NON_MOVING),
        JPH::EActivation::DontActivate
      );
      ++staticBodyCount_;
    };
    auto addWalkInRoom = [&](float rx, float rz, float halfW, float halfD, float wallH) {
      const float gy = world.heightfield.sampleHeight(rx, rz);
      addWall({rx, gy + 0.08f, rz}, {halfW, 0.08f, halfD}); // floor slab
      addWall({rx, gy + wallH + 0.12f, rz}, {halfW + 0.2f, 0.12f, halfD + 0.2f}); // roof
      addWall({rx - halfW, gy + wallH * 0.5f, rz}, {0.18f, wallH * 0.5f, halfD}); // west
      addWall({rx + halfW, gy + wallH * 0.5f, rz}, {0.18f, wallH * 0.5f, halfD}); // east
      addWall({rx, gy + wallH * 0.5f, rz - halfD}, {halfW, wallH * 0.5f, 0.18f}); // north back wall
      // South wall has a wide 3.4m walk/drive doorway gap!
      const float wingW = std::max(0.5f, (halfW * 2.0f - 3.4f) * 0.25f);
      addWall({rx - halfW + wingW, gy + wallH * 0.5f, rz + halfD}, {wingW, wallH * 0.5f, 0.18f});
      addWall({rx + halfW - wingW, gy + wallH * 0.5f, rz + halfD}, {wingW, wallH * 0.5f, 0.18f});
    };

    addWalkInRoom(world.spawnPos.x - 13.0f, world.spawnPos.z - 11.0f, 4.8f, 4.2f, 3.4f); // Safehouse
    addWalkInRoom(-38.0f, -125.0f, 5.2f, 4.5f, 3.6f);                                   // Civic 24/7 Mart
    addWalkInRoom(112.0f, -135.0f, 6.2f, 5.6f, 4.2f);                                   // Customs Garage
    addWalkInRoom(704.0f, 108.0f, 4.4f, 4.0f, 3.4f);                                    // Iron Pit Armory
  }

  // 4. Iron Pit Arena Platform + Bleachers + Cage Posts colliders
  {
    const float pitY = world.heightfield.sampleHeight(world.fightPitPos.x, world.fightPitPos.z);
    JPH::ShapeRefC platShape = JPH::BoxShapeSettings(JPH::Vec3(6.5f, 0.34f, 6.5f)).Create().Get();
    bodyInterface.CreateAndAddBody(
      JPH::BodyCreationSettings(platShape, JPH::RVec3(world.fightPitPos.x, pitY + 0.34f, world.fightPitPos.z), JPH::Quat::sIdentity(), JPH::EMotionType::Static, Layers::NON_MOVING),
      JPH::EActivation::DontActivate
    );
    ++staticBodyCount_;

    JPH::ShapeRefC bleacherShape = JPH::BoxShapeSettings(JPH::Vec3(4.4f, 0.52f, 0.8f)).Create().Get();
    for (float side : {-1.0f, 1.0f}) {
      bodyInterface.CreateAndAddBody(
        JPH::BodyCreationSettings(bleacherShape, JPH::RVec3(world.fightPitPos.x, pitY + 0.52f, world.fightPitPos.z + side * 8.9f), JPH::Quat::sIdentity(), JPH::EMotionType::Static, Layers::NON_MOVING),
        JPH::EActivation::DontActivate
      );
      ++staticBodyCount_;
    }
  }

  // 5. Dynamic Jolt Rigid Bodies (smashable wooden crates & steel barrels around Safehouse, Iron Pit & Seaport)
  {
    auto addDynamic = [&](DynamicPropKind kind, const glm::vec3& pos, const glm::vec3& halfExt, const glm::vec3& color, float mass) {
      JPH::ShapeSettings::ShapeResult res = (kind == DynamicPropKind::Barrel || kind == DynamicPropKind::Cone || kind == DynamicPropKind::TrashBin)
        ? JPH::CylinderShapeSettings(halfExt.y, halfExt.x).Create()
        : JPH::BoxShapeSettings(JPH::Vec3(halfExt.x, halfExt.y, halfExt.z)).Create();
      if (!res.IsValid()) return;
      JPH::BodyCreationSettings bcs(
        res.Get(),
        JPH::RVec3(pos.x, pos.y + halfExt.y + 0.04f, pos.z),
        JPH::Quat::sIdentity(),
        JPH::EMotionType::Dynamic,
        Layers::MOVING
      );
      bcs.mOverrideMassProperties = JPH::EOverrideMassProperties::CalculateInertia;
      bcs.mMassPropertiesOverride.mMass = mass;
      bcs.mRestitution = 0.22f;
      bcs.mFriction = 0.62f;
      bcs.mLinearDamping = 0.12f;
      bcs.mAngularDamping = 0.18f;
      const JPH::BodyID id = bodyInterface.CreateAndAddBody(bcs, JPH::EActivation::DontActivate);
      if (!id.IsInvalid()) {
        impl_->dynamicBodies.push_back({id, kind, halfExt, color});
        ++dynamicBodyCount_;
      }
    };

    const float pitY = world.heightfield.sampleHeight(world.fightPitPos.x, world.fightPitPos.z);
    // Iron Pit dockyard stacks & barrels
    for (int i = 0; i < 6; ++i) {
      const float bx = world.fightPitPos.x + 8.6f + (i % 2) * 0.95f;
      const float bz = world.fightPitPos.z - 5.0f + static_cast<float>(i / 2) * 1.1f;
      addDynamic(DynamicPropKind::Crate, {bx, world.heightfield.sampleHeight(bx, bz), bz}, {0.42f, 0.42f, 0.42f}, {0.62f, 0.45f, 0.28f}, 24.0f);
    }
    for (int i = 0; i < 4; ++i) {
      const float bx = world.fightPitPos.x - 8.8f - (i % 2) * 0.95f;
      const float bz = world.fightPitPos.z + 5.8f + static_cast<float>(i / 2) * 1.0f;
      addDynamic(DynamicPropKind::Barrel, {bx, pitY, bz}, {0.34f, 0.48f, 0.34f}, {0.72f, 0.24f, 0.16f}, 32.0f);
    }

    // Safehouse driveway & Seaport cargo dynamic stacks
    const glm::vec2 clusters[] = {
      {world.spawnPos.x - 11.5f, world.spawnPos.z + 10.0f},
      {world.spawnPos.x + 11.0f, world.spawnPos.z - 8.0f},
      {620.0f, 415.0f},
      {380.0f, 255.0f},
      {-685.0f, 22.0f},
      {22.0f, -75.0f},
    };
    for (size_t ci = 0; ci < std::size(clusters); ++ci) {
      const auto& c = clusters[ci];
      for (int k = 0; k < 5; ++k) {
        const float px = c.x + static_cast<float>(k % 3) * 0.95f;
        const float pz = c.y + static_cast<float>(k / 3) * 0.95f;
        const float py = world.heightfield.sampleHeight(px, pz);
        if ((k + static_cast<int>(ci)) % 2 == 0) {
          addDynamic(DynamicPropKind::Crate, {px, py, pz}, {0.40f, 0.40f, 0.40f}, {0.64f, 0.47f, 0.29f}, 22.0f);
        } else {
          addDynamic(DynamicPropKind::Barrel, {px, py, pz}, {0.33f, 0.46f, 0.33f}, {0.22f, 0.46f, 0.72f}, 28.0f);
        }
      }
    }

    // Breakable/knockable street furniture (trash bins, benches, road cones)
    for (const auto& sd : streetDynamics) {
      addDynamic(std::get<0>(sd), std::get<1>(sd), std::get<2>(sd), std::get<3>(sd), std::get<4>(sd));
    }
    const glm::vec2 coneLines[] = {
      {12.0f, -68.0f}, {12.0f, -72.0f}, {12.0f, -76.0f},
      {-704.0f, 60.0f}, {-708.0f, 64.0f},
      {world.fightPitPos.x - 12.0f, world.fightPitPos.z + 2.0f},
      {world.fightPitPos.x - 12.0f, world.fightPitPos.z - 2.0f},
    };
    for (const auto& cl : coneLines) {
      const float cy = world.heightfield.sampleHeight(cl.x, cl.y);
      addDynamic(DynamicPropKind::Cone, {cl.x, cy, cl.y}, {0.22f, 0.38f, 0.22f}, {0.98f, 0.44f, 0.08f}, 7.0f);
    }
  }

  impl_->physicsSystem->OptimizeBroadPhase();
  impl_->initialized = true;
  spawnCharacter(world.spawnPos + glm::vec3(0.0f, 1.0f, 0.0f));
  return true;
}

void PhysicsWorld::shutdown() {
  impl_->dynamicBodies.clear();
  impl_->character = nullptr;
  impl_->physicsSystem.reset();
  impl_->jobSystem.reset();
  impl_->tempAllocator.reset();
  impl_->initialized = false;
  staticBodyCount_ = 0;
  dynamicBodyCount_ = 0;
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

void PhysicsWorld::applyImpulseNear(const glm::vec3& pos, const glm::vec3& impulse, float radius) {
  if (!impl_->initialized || impl_->dynamicBodies.empty()) return;
  JPH::BodyInterface& bi = impl_->physicsSystem->GetBodyInterface();
  const float rSq = radius * radius;
  for (const auto& entry : impl_->dynamicBodies) {
    const JPH::RVec3 bp = bi.GetPosition(entry.id);
    const glm::vec3 p(static_cast<float>(bp.GetX()), static_cast<float>(bp.GetY()), static_cast<float>(bp.GetZ()));
    const glm::vec3 d = p - pos;
    const float dSq = glm::dot(d, d);
    if (dSq <= rSq) {
      const float falloff = 1.0f - std::sqrt(dSq) / std::max(0.01f, radius);
      const JPH::Vec3 imp(impulse.x * falloff, (impulse.y + 1.8f) * falloff, impulse.z * falloff);
      bi.ActivateBody(entry.id);
      bi.AddImpulse(entry.id, imp);
      bi.AddAngularImpulse(entry.id, JPH::Vec3(impulse.z * 0.25f * falloff, 0.3f * falloff, -impulse.x * 0.25f * falloff));
    }
  }
}

bool PhysicsWorld::resolveVehicleCollision(const glm::vec3& center, float radius, glm::vec3& outPushXZ, float& outImpactSpeedScale) const {
  outPushXZ = glm::vec3(0.0f);
  outImpactSpeedScale = 1.0f;
  if (!impl_->initialized) return false;

  // 8-direction horizontal perimeter raycasts against NON_MOVING world geometry (buildings, trees, pit walls)
  bool hitAny = false;
  const glm::vec3 probeOrig = center + glm::vec3(0.0f, 0.95f, 0.0f);
  const JPH::SpecifiedObjectLayerFilter staticFilter(Layers::NON_MOVING);
  const JPH::SpecifiedBroadPhaseLayerFilter bpStaticFilter(BroadPhaseLayers::NON_MOVING);

  for (int i = 0; i < 8; ++i) {
    const float a = static_cast<float>(i) * (6.2831853f / 8.0f);
    const glm::vec3 dir(std::sin(a), 0.0f, std::cos(a));
    JPH::RRayCast ray(JPH::RVec3(probeOrig.x, probeOrig.y, probeOrig.z), JPH::Vec3(dir.x * radius, 0.0f, dir.z * radius));
    JPH::RayCastResult res;
    if (impl_->physicsSystem->GetNarrowPhaseQuery().CastRay(ray, res, bpStaticFilter, staticFilter)) {
      const float pen = radius * (1.0f - res.mFraction);
      if (pen > 0.01f) {
        outPushXZ.x -= dir.x * pen;
        outPushXZ.z -= dir.z * pen;
        hitAny = true;
      }
    }
  }
  if (hitAny) outImpactSpeedScale = 0.42f;
  return hitAny;
}

void PhysicsWorld::gatherDynamicProps(std::vector<DynamicPropPose>& outProps) const {
  outProps.clear();
  if (!impl_->initialized || impl_->dynamicBodies.empty()) return;
  outProps.reserve(impl_->dynamicBodies.size());
  const JPH::BodyInterface& bi = impl_->physicsSystem->GetBodyInterface();
  for (const auto& entry : impl_->dynamicBodies) {
    JPH::RVec3 pos;
    JPH::Quat rot;
    bi.GetPositionAndRotation(entry.id, pos, rot);
    DynamicPropPose p;
    p.kind = entry.kind;
    p.position = glm::vec3(static_cast<float>(pos.GetX()), static_cast<float>(pos.GetY()), static_cast<float>(pos.GetZ()));
    p.rotation = glm::quat(rot.GetW(), rot.GetX(), rot.GetY(), rot.GetZ());
    p.halfExtents = entry.halfExtents;
    p.color = entry.color;
    outProps.push_back(p);
  }
}

} // namespace westgate
