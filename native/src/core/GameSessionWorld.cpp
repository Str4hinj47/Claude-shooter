#include "westgate/GameSession.hpp"
#include "westgate/AudioEngine.hpp"
#include <algorithm>
#include <cmath>
#include <cstdio>
#include <glm/gtc/constants.hpp>

namespace westgate {

namespace {

float randRange01(uint32_t& state) {
  state ^= state << 13;
  state ^= state >> 17;
  state ^= state << 5;
  return static_cast<float>(state & 0x00FFFFFFu) / static_cast<float>(0x01000000u);
}

struct RawPt2 {
  float x;
  float z;
};

constexpr RawPt2 kStashSpots[15] = {
  {  38.0f, -165.0f}, // Legion Square
  { 185.0f,   58.0f}, // Police HQ Deck
  {-395.0f,  -95.0f}, // Midtown Mall
  {-146.0f, -206.0f}, // St. Jude's Medical
  {-165.0f, -332.0f}, // University Clocktower
  {-115.0f,  342.0f}, // Mirror Central Park
  {-735.0f,   36.0f}, // Del Sol Pier end
  {-648.0f,  164.0f}, // Venice Canals
  {-120.0f, -974.0f}, // Observatory Summit
  {-220.0f, -820.0f}, // Vinewood Crest
  { 265.0f, -635.0f}, // North Gorge Bridge
  { 635.0f,  432.0f}, // Seaport Terminal
  {-415.0f,  615.0f}, // Sports Arena
  {-120.0f,  850.0f}, // South Airport
  { 385.0f,  -56.0f}, // Downtown Arch Bridge
};

constexpr RawPt2 kMedkitSpots[8] = {
  {-142.0f, -202.0f}, // St. Jude's Medical Center
  { 714.0f,  112.0f}, // Iron Pit Arena Entrance
  {-295.0f,  338.0f}, // Safehouse Crescent Corner
  {-672.0f,  -74.0f}, // Del Sol Boardwalk
  {  32.0f, -168.0f}, // Legion Square Plaza
  { 588.0f,  416.0f}, // East Seaport Terminal
  {-212.0f, -788.0f}, // Observatory Overlook
  {-112.0f,  388.0f}, // Mirror Central Park
};

constexpr RawPt2 kExplosiveSpots[28] = {
  {-288.0f,  344.0f}, {-292.0f,  346.0f}, // Safehouse Crescent Street Corner
  {-215.0f,  275.0f}, {-208.0f,  275.0f}, // Old Quarter Gas Station
  {-206.0f,  179.0f}, {-198.0f,  179.0f}, // Old Quarter Compound Gate
  {-455.0f,   65.0f}, {-448.0f,   65.0f}, // Midtown Construction Yard
  {-430.0f, -110.0f}, {-424.0f, -110.0f}, // Midtown Service Barrel
  { -64.0f, -385.0f}, { -56.0f, -385.0f}, // Downtown Financial Plaza
  { 125.0f, -145.0f}, { 131.0f, -145.0f}, // Downtown Alley Tank
  { 395.0f, -116.0f}, { 403.0f, -116.0f}, // East Downtown Plaza
  { 585.0f,  412.0f}, { 592.0f,  412.0f}, // Seaport Fuel Tank
  { 690.0f,  462.0f}, { 697.0f,  462.0f}, // Eastgate Seaport Docks
  { -85.0f,  895.0f}, { -78.0f,  895.0f}, // Airport Fuel Depot
  {-675.0f,  -80.0f}, {-668.0f,  -80.0f}, // Del Sol Boardwalk Tank
  { 340.0f,  265.0f}, { 346.0f,  265.0f}, // East Industrial Depot
  {-495.0f, -415.0f}, {-488.0f, -415.0f}, // North Foothills Citadel
};

} // namespace

void GameSession::initLivingWorld(const WorldData& world) {
  apartments_.clear();
  activeApartmentIdx_ = -1;

  auto sampleGround = [&](float x, float z) {
    return std::max(0.2f, world.heightfield.sampleHeight(x, z));
  };

  apartments_ = {
    {
      "apt_oldquarter",
      "Crescent Brick Flat",
      "Old Quarter",
      120,
      {-347.0f, sampleGround(-347.0f, 187.4f), 187.4f},
      0.0f,
      {-360.0f, 260.0f, 180.0f},
      {0.96f, 0.62f, 0.05f},
      "Exposed brick studio above a jazz bar. Quiet street access.",
      false
    },
    {
      "apt_midtown",
      "Midtown Horizon Loft",
      "Midtown",
      320,
      {-342.0f, sampleGround(-342.0f, -91.4f), -91.4f},
      glm::pi<float>(),
      {-342.0f, 260.0f, -78.0f},
      {0.22f, 0.74f, 0.97f},
      "Double-height glass loft overlooking the Midtown boulevard.",
      false
    },
    {
      "apt_westcoast",
      "Del Sol Oceanfront Condo",
      "West Coast",
      550,
      {-628.4f, sampleGround(-628.4f, -19.0f), -19.0f},
      -glm::half_pi<float>(),
      {-620.0f, 260.0f, -25.0f},
      {0.98f, 0.45f, 0.09f},
      "Sun-bleached teak terrace facing the Pacific surf and boardwalk.",
      false
    },
    {
      "apt_downtown",
      "Sovereign Sky Penthouse",
      "Downtown",
      950,
      {-18.0f, sampleGround(-18.0f, -222.6f), -222.6f},
      0.0f,
      {-18.0f, 260.0f, -238.0f},
      {0.66f, 0.33f, 0.97f},
      "42nd-floor obsidian marble penthouse with private armory & skyline glass.",
      false
    },
  };

  collectibles_.clear();
  stashesFound_ = 0;
  totalStashes_ = 15;
  dropSeq_ = 1;
  for (int i = 0; i < 15; ++i) {
    const float x = kStashSpots[i].x;
    const float z = kStashSpots[i].z;
    CollectiblePickup cp;
    cp.id = "stash_" + std::to_string(i);
    cp.kind = CollectibleKind::Stash;
    cp.pos = {x, sampleGround(x, z), z};
    cp.cashValue = 350;
    cp.intelValue = 6;
    collectibles_.push_back(cp);
  }
  for (int i = 0; i < 8; ++i) {
    const float x = kMedkitSpots[i].x;
    const float z = kMedkitSpots[i].z;
    CollectiblePickup cp;
    cp.id = "medkit_static_" + std::to_string(i);
    cp.kind = CollectibleKind::Medkit;
    cp.pos = {x, sampleGround(x, z), z};
    cp.cashValue = 0;
    cp.intelValue = 0;
    collectibles_.push_back(cp);
  }

  explosiveProps_.clear();
  for (int i = 0; i < 28; ++i) {
    const float x = kExplosiveSpots[i].x;
    const float z = kExplosiveSpots[i].z;
    ExplosivePropEntity ep;
    ep.id = "exp_" + std::to_string(i);
    ep.kind = (i % 3 == 0) ? DynamicGlbPropKind::GasCan : DynamicGlbPropKind::FuelTank;
    ep.pos = {x, sampleGround(x, z), z};
    ep.yawRad = static_cast<float>(i) * 0.77f;
    ep.maxHp = (ep.kind == DynamicGlbPropKind::FuelTank) ? 55.0f : 32.0f;
    ep.hp = ep.maxHp;
    explosiveProps_.push_back(ep);
  }

  speedTraps_ = {
    {"trap_downtown",    "Civic Boulevard",       {  18.0f, sampleGround(  18.0f, -120.0f), -120.0f}, 110, 0, 0.0f},
    {"trap_bay_bridge",  "Westgate Bay Bridge",   { 350.0f, sampleGround( 350.0f,  595.0f),  595.0f}, 145, 0, 0.0f},
    {"trap_airport",     "Airport Runway Dash",   {  42.0f, sampleGround(  42.0f,  960.0f),  960.0f}, 185, 0, 0.0f},
    {"trap_coast",       "Del Sol Coast Highway", {-670.0f, sampleGround(-670.0f, -180.0f), -180.0f}, 135, 0, 0.0f},
    {"trap_midtown",     "Midtown Skyway",        {-292.0f, sampleGround(-292.0f, -140.0f), -140.0f}, 120, 0, 0.0f},
    {"trap_observatory", "Observatory Climb",     {-120.0f, sampleGround(-120.0f, -870.0f), -870.0f},  95, 0, 0.0f},
    {"trap_gorge",       "North Gorge Bridge",    { 265.0f, sampleGround( 265.0f, -635.0f), -635.0f}, 130, 0, 0.0f},
    {"trap_harbor",      "Seaport Freightway",    { 560.0f, sampleGround( 560.0f,  360.0f),  360.0f}, 125, 0, 0.0f},
    {"trap_arena",       "Arena Straightaway",    {-415.0f, sampleGround(-415.0f,  540.0f),  540.0f}, 130, 0, 0.0f},
    {"trap_university",  "University Avenue",     {-165.0f, sampleGround(-165.0f, -280.0f), -280.0f}, 115, 0, 0.0f},
  };

  activeRandomEvent_ = ActiveRandomEvent{};
  randomEventCooldown_ = 28.0f;
  randomEventsResolved_ = 0;

  // 3D Quadruped Wildlife: 5 Siberian Huskies + 4 Alpine Deer (exact WildlifeSystem.ts coordinates)
  wildlife_.clear();
  struct WildlifeSpawnSpec {
    WildlifeKind kind;
    float cx, cz, radius, phase, speed;
  };
  constexpr WildlifeSpawnSpec kWildlifeSpecs[9] = {
    {WildlifeKind::DogHusky, -115.0f,  392.0f, 12.0f, 0.4f, 0.24f}, // Mirror Central Park
    {WildlifeKind::DogHusky,  -92.0f,  376.0f, 11.0f, 2.1f, 0.22f}, // Mirror Central Park East
    {WildlifeKind::DogHusky, -644.0f,  162.0f, 11.0f, 1.2f, 0.20f}, // Venice Canals
    {WildlifeKind::DogHusky, -162.0f, -358.0f, 10.5f, 3.4f, 0.22f}, // University Quad
    {WildlifeKind::DogHusky, -662.0f,   38.0f, 12.0f, 4.5f, 0.23f}, // Del Sol Boardwalk Lawn
    {WildlifeKind::Deer,     -215.0f, -792.0f, 18.0f, 0.6f, 0.14f}, // Observatory Foothills
    {WildlifeKind::Deer,     -180.0f, -825.0f, 19.0f, 2.4f, 0.13f}, // Vinewood Crest
    {WildlifeKind::Deer,      -95.0f, -895.0f, 17.0f, 3.9f, 0.15f}, // Observatory Summit Pine
    {WildlifeKind::Deer,     -265.0f, -765.0f, 17.0f, 5.1f, 0.14f}, // Foothill Saddle
  };
  for (int i = 0; i < 9; ++i) {
    const auto& sp = kWildlifeSpecs[i];
    WildlifeEntity w;
    w.id = i + 1;
    w.kind = sp.kind;
    w.center = {sp.cx, sampleGround(sp.cx, sp.cz), sp.cz};
    w.radius = sp.radius;
    w.phase = sp.phase;
    w.speed = sp.speed;
    const float px = w.center.x + std::cos(w.phase) * w.radius;
    const float pz = w.center.z + std::sin(w.phase) * w.radius * 0.72f;
    w.pos = {px, sampleGround(px, pz), pz};
    w.yawRad = sp.phase + glm::half_pi<float>();
    w.activeClip = "Walk";
    wildlife_.push_back(w);
  }

  // 16 Instanced Coastal & Park Birds (4 wheeling flocks of 4 birds)
  birdFlocks_.clear();
  const RawPt2 flockHubs[4] = {
    {-710.0f,   36.0f}, // Del Sol Pier Seagulls
    {-115.0f,  380.0f}, // Mirror Central Park Flock
    {  38.0f, -165.0f}, // Legion Square Flock
    { 590.0f,  415.0f}, // East Seaport Cranes
  };
  for (int f = 0; f < 4; ++f) {
    const float baseH = sampleGround(flockHubs[f].x, flockHubs[f].z) + 28.0f + static_cast<float>(f) * 4.5f;
    for (int b = 0; b < 4; ++b) {
      BirdFlockMember bm;
      bm.center = {flockHubs[f].x, baseH, flockHubs[f].z};
      bm.radius = 22.0f + static_cast<float>(b) * 4.8f;
      bm.height = baseH + static_cast<float>(b % 2) * 2.4f;
      bm.phase = static_cast<float>(b) * glm::half_pi<float>() + static_cast<float>(f) * 0.7f;
      bm.angularSpeed = 0.32f + static_cast<float>(b) * 0.03f;
      bm.pos = {
        bm.center.x + std::cos(bm.phase) * bm.radius,
        bm.height,
        bm.center.z + std::sin(bm.phase) * bm.radius
      };
      bm.yawRad = bm.phase + glm::half_pi<float>();
      birdFlocks_.push_back(bm);
    }
  }
}

bool GameSession::buyApartment(int aptIdx, AudioEngine* audio) {
  if (aptIdx < 0 || static_cast<size_t>(aptIdx) >= apartments_.size()) return false;
  auto& apt = apartments_[static_cast<size_t>(aptIdx)];
  if (apt.owned) return true;
  if (playerCash_ < apt.price) {
    pushToast("NEED $" + std::to_string(apt.price) + " FOR " + apt.name, 2.8f);
    return false;
  }
  playerCash_ -= apt.price;
  apt.owned = true;
  if (audio) audio->playCashChime();
  pushToast("PURCHASED SAFEHOUSE: " + apt.name + " (-$" + std::to_string(apt.price) + ")", 4.2f);
  return true;
}

bool GameSession::enterApartment(int aptIdx, PlayerController& player, AudioEngine* audio) {
  if (aptIdx < 0 || static_cast<size_t>(aptIdx) >= apartments_.size()) return false;
  const auto& apt = apartments_[static_cast<size_t>(aptIdx)];
  if (!apt.owned) return false;
  if (activeVehicleIdx_ >= 0 && static_cast<size_t>(activeVehicleIdx_) < vehicles_.size()) {
    vehicles_[static_cast<size_t>(activeVehicleIdx_)].occupiedByPlayer = false;
    activeVehicleIdx_ = -1;
  }
  activeApartmentIdx_ = aptIdx;
  const glm::vec3 entryPos = apt.interiorOrigin + glm::vec3(0.0f, 0.05f, 5.2f);
  player.teleport(entryPos, 0.0f);
  if (audio) audio->playFootstep(0.6f, false);
  pushToast("ENTERED " + apt.name + " (" + apt.district + ")", 3.2f);
  return true;
}

void GameSession::exitApartment(PlayerController& player, AudioEngine* audio) {
  if (activeApartmentIdx_ < 0 || static_cast<size_t>(activeApartmentIdx_) >= apartments_.size()) return;
  const auto& apt = apartments_[static_cast<size_t>(activeApartmentIdx_)];
  const glm::vec3 outPos = apt.doorPos + glm::vec3(std::sin(apt.doorYaw) * 1.8f, 0.12f, std::cos(apt.doorYaw) * 1.8f);
  activeApartmentIdx_ = -1;
  player.teleport(outPos, glm::degrees(apt.doorYaw));
  if (audio) audio->playFootstep(0.6f, false);
  pushToast("EXITED TO " + apt.district, 2.5f);
}

void GameSession::useApartmentBed(AudioEngine* audio) {
  timeOfDayHours_ = std::fmod(timeOfDayHours_ + 6.0f, 24.0f);
  playerHp_ = playerMaxHp_;
  playerArmor_ = 100.0f;
  wantedStars_ = 0;
  wantedHeat_ = 0.0f;
  if (audio) audio->playCashChime();
  pushToast("RESTED +6 HOURS // FULL HP & ARMOR // HEAT CLEARED", 3.6f);
}

void GameSession::useApartmentWardrobe(AudioEngine* audio) {
  cyclePlayerSuit();
  const char* suitName = "Vanguard";
  suitTintColor(playerSuit_, &suitName);
  if (audio) audio->playFootstep(0.5f, false);
  pushToast(std::string("WARDROBE SUIT: ") + suitName, 2.8f);
}

void GameSession::useApartmentArmoryBench(AudioEngine* audio) {
  for (auto& w : weapons_) {
    if (w.isMelee) continue;
    w.unlocked = true;
    w.magAmmo = w.magSize;
    w.reserveAmmo = std::max(w.reserveAmmo, w.reserveMax);
  }
  if (audio) audio->playCashChime();
  pushToast("ARMORY BENCH // ALL WEAPONS & MAGAZINES TOPPED UP", 3.2f);
}

void GameSession::spawnMedkitDrop(const glm::vec3& pos) {
  CollectiblePickup cp;
  cp.id = "drop_medkit_" + std::to_string(dropSeq_++);
  cp.kind = CollectibleKind::Medkit;
  cp.pos = pos;
  cp.ttl = 45.0f;
  collectibles_.push_back(cp);
}

int GameSession::speedTrapsBeatenCount() const {
  int count = 0;
  for (const auto& t : speedTraps_) {
    if (t.bestKmh >= t.targetKmh) ++count;
  }
  return count;
}

void GameSession::alertWildlifeNear(const glm::vec3& pos, float radius) {
  const float r2 = radius * radius;
  for (auto& w : wildlife_) {
    const float dx = w.pos.x - pos.x;
    const float dz = w.pos.z - pos.z;
    const float d2 = dx * dx + dz * dz;
    if (d2 > r2) continue;
    w.fleeTimer = 4.2f;
    w.pauseTimer = 0.0f;
    w.fleeYaw = (d2 > 1e-4f) ? std::atan2(dx, dz) : 0.0f;
    w.activeClip = "Gallop";
  }
}

void GameSession::detonateExplosiveProp(
  size_t idx,
  const WorldData& world,
  PlayerController* player,
  PhysicsWorld* physics,
  AudioEngine* audio
) {
  if (idx >= explosiveProps_.size()) return;
  auto& ep = explosiveProps_[idx];
  if (ep.exploded) return;
  ep.exploded = true;
  ep.hp = 0.0f;
  ep.respawnTimer = 45.0f;

  const glm::vec3 blastPos = ep.pos + glm::vec3(0.0f, 0.65f, 0.0f);
  spawnSparks(blastPos, glm::vec3(0.0f, 1.0f, 0.0f), glm::vec3(1.0f, 0.52f, 0.12f), 42);
  if (audio) audio->playExplosion(blastPos);
  if (physics) physics->applyImpulseNear(blastPos, glm::vec3(0.0f, 14.0f, 0.0f), 9.5f);
  alertWildlifeNear(blastPos, 34.0f);
  playerSalvage_ += 2;

  constexpr float kBlastRadius = 8.5f;
  // Damage nearby NPCs
  for (auto& n : npcs_) {
    if (!n.alive || n.role == EnemyRole::Ally) continue;
    const float d = glm::distance(n.pos, ep.pos);
    if (d > kBlastRadius) continue;
    const float dmg = 145.0f * (1.0f - d / kBlastRadius);
    n.hp -= dmg;
    n.hitFlash = 0.35f;
    if (n.hp <= 0.0f) {
      n.hp = 0.0f;
      n.alive = false;
      n.deadTimer = 28.0f;
      if (activeMission_.active && n.contractIdx == -2) {
        ++activeMission_.missionKills;
        for (auto& obj : activeMission_.objectives) {
          if (obj.id == "eliminate_hostiles" || obj.id == "clear_site") {
            obj.current = std::min(obj.required, obj.current + 1);
          }
        }
      }
    }
  }

  // Damage nearby vehicles
  for (size_t vi = 0; vi < vehicles_.size(); ++vi) {
    if (vehicles_[vi].destroyed) continue;
    const float d = glm::distance(vehicles_[vi].pos, ep.pos);
    if (d <= kBlastRadius) {
      damageVehicle(vi, 120.0f * (1.0f - d / kBlastRadius), world, player, audio, true);
    }
  }

  // Damage nearby player if standing right beside the blast
  if (player) {
    const float pd = glm::distance(player->position(), ep.pos);
    if (pd < 6.0f) {
      damagePlayer(38.0f * (1.0f - pd / 6.0f), world, *player, audio);
    }
  }

  // Chain-detonate adjacent fuel tanks / gas cans within 6.2m!
  for (size_t j = 0; j < explosiveProps_.size(); ++j) {
    if (j == idx || explosiveProps_[j].exploded) continue;
    if (glm::distance(explosiveProps_[j].pos, ep.pos) <= 6.2f) {
      detonateExplosiveProp(j, world, player, physics, audio);
    }
  }
}

bool GameSession::damageExplosivePropsOnRay(
  const glm::vec3& rayOrig,
  const glm::vec3& rayDir,
  float maxDist,
  float dmg,
  const WorldData& world,
  PlayerController* player,
  PhysicsWorld* physics,
  AudioEngine* audio
) {
  int bestIdx = -1;
  float bestT = maxDist;

  for (size_t i = 0; i < explosiveProps_.size(); ++i) {
    const auto& ep = explosiveProps_[i];
    if (ep.exploded) continue;
    const float hitR = (ep.kind == DynamicGlbPropKind::FuelTank) ? 0.78f : 0.48f;
    const glm::vec3 center = ep.pos + glm::vec3(0.0f, hitR * 0.75f, 0.0f);
    const glm::vec3 oc = rayOrig - center;
    const float b = glm::dot(oc, rayDir);
    const float c = glm::dot(oc, oc) - hitR * hitR;
    const float disc = b * b - c;
    if (disc < 0.0f) continue;
    const float t = -b - std::sqrt(disc);
    if (t > 0.1f && t < bestT) {
      bestT = t;
      bestIdx = static_cast<int>(i);
    }
  }

  if (bestIdx < 0) return false;
  auto& hitProp = explosiveProps_[static_cast<size_t>(bestIdx)];
  hitProp.hp -= dmg;
  hitmarkerTimer_ = 0.14f;
  spawnSparks(rayOrig + rayDir * bestT, -rayDir, glm::vec3(1.0f, 0.72f, 0.22f), 10);
  if (hitProp.hp <= 0.0f) {
    detonateExplosiveProp(static_cast<size_t>(bestIdx), world, player, physics, audio);
  }
  return true;
}

bool GameSession::spawnRandomEvent(
  RandomEventKind kind,
  const glm::vec3& nearPos,
  const WorldData& world,
  AudioEngine* audio
) {
  activeRandomEvent_ = ActiveRandomEvent{};
  activeRandomEvent_.active = true;
  activeRandomEvent_.kind = kind;
  activeRandomEvent_.timer = 75.0f;

  const float gx = std::clamp(nearPos.x + 18.0f, world.worldMin + 60.0f, world.worldMax - 60.0f);
  const float gz = std::clamp(nearPos.z + 14.0f, world.worldMin + 60.0f, world.worldMax - 60.0f);
  const float gy = std::max(0.2f, world.heightfield.sampleHeight(gx, gz));
  activeRandomEvent_.origin = {gx, gy, gz};

  if (kind == RandomEventKind::PurseSnatcher) {
    activeRandomEvent_.title = "STREET EVENT // STOP PURSE SNATCHER";
    activeRandomEvent_.rewardCash = 380;
    activeRandomEvent_.rewardIntel = 4;

    NpcEntity thief;
    thief.id = nextNpcId_++;
    thief.kind = NpcModelKind::Sports;
    thief.role = EnemyRole::Target;
    thief.pos = {gx, gy, gz};
    thief.homePos = thief.pos;
    thief.yawRad = 0.65f;
    thief.hp = 65.0f;
    thief.maxHp = 65.0f;
    thief.fleeing = true;
    thief.colorTint = {0.95f, 0.35f, 0.18f};
    thief.displayName = "Purse Snatcher";
    activeRandomEvent_.npcIds.push_back(thief.id);
    npcs_.push_back(thief);
  } else if (kind == RandomEventKind::ArmoredTruck) {
    activeRandomEvent_.title = "STREET EVENT // ARMORED CONVOY INTERCEPT";
    activeRandomEvent_.rewardCash = 900;
    activeRandomEvent_.rewardIntel = 8;
    activeRandomEvent_.pickupReady = true;
    activeRandomEvent_.pickupPos = {gx - 3.2f, gy, gz - 2.4f};

    VehicleEntity van;
    van.id = nextVehicleId_++;
    van.kind = VehicleModelKind::Kraz;
    van.pos = {gx, gy, gz};
    van.yawRad = 0.4f;
    van.colorTint = {0.16f, 0.22f, 0.30f};
    van.hp = 260.0f;
    activeRandomEvent_.vehicleId = van.id;
    vehicles_.push_back(van);

    for (int g = 0; g < 2; ++g) {
      NpcEntity guard;
      guard.id = nextNpcId_++;
      guard.kind = NpcModelKind::Security;
      guard.role = EnemyRole::Guard;
      guard.isContractGuard = true;
      guard.suspicion = 1.0f;
      guard.pos = {gx + (g == 0 ? 2.4f : -2.4f), gy, gz + 2.0f};
      guard.homePos = guard.pos;
      guard.hp = 90.0f;
      guard.maxHp = 90.0f;
      guard.colorTint = {0.25f, 0.42f, 0.72f};
      guard.displayName = "Convoy Guard";
      activeRandomEvent_.npcIds.push_back(guard.id);
      npcs_.push_back(guard);
    }
  } else {
    activeRandomEvent_.title = "STREET EVENT // BREAK UP BACK-ALLEY BRAWL";
    activeRandomEvent_.rewardCash = 450;
    activeRandomEvent_.rewardIntel = 5;

    for (int b = 0; b < 2; ++b) {
      NpcEntity brawler;
      brawler.id = nextNpcId_++;
      brawler.kind = (b == 0) ? NpcModelKind::Construction : NpcModelKind::Sports;
      brawler.role = EnemyRole::Guard;
      brawler.isContractGuard = true;
      brawler.suspicion = 1.0f;
      brawler.pos = {gx + (b == 0 ? -1.4f : 1.4f), gy, gz};
      brawler.homePos = brawler.pos;
      brawler.hp = 85.0f;
      brawler.maxHp = 85.0f;
      brawler.colorTint = (b == 0) ? glm::vec3(0.88f, 0.52f, 0.16f) : glm::vec3(0.75f, 0.22f, 0.26f);
      brawler.displayName = "Street Brawler";
      activeRandomEvent_.npcIds.push_back(brawler.id);
      npcs_.push_back(brawler);
    }
  }

  if (audio) audio->playCashChime();
  pushToast(activeRandomEvent_.title + " (+$" + std::to_string(activeRandomEvent_.rewardCash) + ")", 4.0f);
  return true;
}

void GameSession::updateLivingWorld(
  float dt,
  const GameInputFrame& input,
  PlayerController& player,
  PhysicsWorld& physics,
  const WorldData& world,
  AudioEngine* audio
) {
  worldAnimClock_ += dt;
  const glm::vec3 pPos = (activeVehicleIdx_ >= 0 && static_cast<size_t>(activeVehicleIdx_) < vehicles_.size())
    ? vehicles_[static_cast<size_t>(activeVehicleIdx_)].pos
    : player.position();

  // 1. Luxury Apartments: Street Door Entry/Purchase & Sky-Suite Interior Stations
  if (activeApartmentIdx_ >= 0 && static_cast<size_t>(activeApartmentIdx_) < apartments_.size()) {
    const auto& apt = apartments_[static_cast<size_t>(activeApartmentIdx_)];
    const glm::vec3 bedPos     = apt.interiorOrigin + glm::vec3(-5.5f, 0.0f, -2.5f);
    const glm::vec3 closetPos  = apt.interiorOrigin + glm::vec3( 5.8f, 0.0f, -2.5f);
    const glm::vec3 armoryPos  = apt.interiorOrigin + glm::vec3( 5.8f, 0.0f,  2.8f);
    const glm::vec3 exitDoor   = apt.interiorOrigin + glm::vec3( 0.0f, 0.0f,  6.4f);

    if (glm::distance(player.position(), exitDoor) < 2.4f) {
      contextPrompt_ = "[B] Exit " + apt.name + " to " + apt.district;
      if (input.actionPressed) {
        exitApartment(player, audio);
      }
    } else if (glm::distance(player.position(), bedPos) < 2.6f) {
      contextPrompt_ = "[B] Rest in King Bed (+6h, Full Heal & Clear Heat)";
      if (input.actionPressed) {
        useApartmentBed(audio);
      }
    } else if (glm::distance(player.position(), closetPos) < 2.5f) {
      contextPrompt_ = "[B] Walk-In Wardrobe (Cycle Operative Suit)";
      if (input.actionPressed) {
        useApartmentWardrobe(audio);
      }
    } else if (glm::distance(player.position(), armoryPos) < 2.5f) {
      contextPrompt_ = "[B] Gunsmith Armory Bench (Refill All Magazines)";
      if (input.actionPressed) {
        useApartmentArmoryBench(audio);
      }
    }
  } else if (activeVehicleIdx_ < 0) {
    for (size_t i = 0; i < apartments_.size(); ++i) {
      const auto& apt = apartments_[i];
      if (glm::distance(pPos, apt.doorPos) < 3.4f) {
        if (apt.owned) {
          contextPrompt_ = "[B] Enter " + apt.name + " (Luxury Safehouse)";
          if (input.actionPressed) {
            enterApartment(static_cast<int>(i), player, audio);
          }
        } else {
          contextPrompt_ = "[B] Buy " + apt.name + " ($" + std::to_string(apt.price) + ")";
          if (input.actionPressed && buyApartment(static_cast<int>(i), audio)) {
            enterApartment(static_cast<int>(i), player, audio);
          }
        }
        break;
      }
    }
  }

  // 2. Collectibles (Hidden Cash Stashes + Medkits)
  for (auto& cp : collectibles_) {
    if (cp.collected) continue;
    if (cp.ttl > 0.0f) {
      cp.ttl -= dt;
      if (cp.ttl <= 0.0f) {
        cp.collected = true;
        continue;
      }
    }
    const float d = glm::distance(glm::vec2(pPos.x, pPos.z), glm::vec2(cp.pos.x, cp.pos.z));
    if (d < 2.35f && std::abs(pPos.y - cp.pos.y) < 3.2f) {
      if (cp.kind == CollectibleKind::Stash) {
        cp.collected = true;
        ++stashesFound_;
        playerCash_ += cp.cashValue;
        playerIntel_ += cp.intelValue;
        addBodyStatXp(BodyStatKind::Stealth, 8.0f);
        if (audio) audio->playCashChime();
        pushToast(
          "HIDDEN STASH (" + std::to_string(stashesFound_) + "/" + std::to_string(totalStashes_) +
          ") +$" + std::to_string(cp.cashValue) + " +" + std::to_string(cp.intelValue) + " INTEL",
          3.8f
        );
      } else if (cp.kind == CollectibleKind::Medkit) {
        if (playerHp_ < playerMaxHp_ - 0.5f || playerArmor_ < 99.5f) {
          cp.collected = true;
          playerHp_ = std::min(playerMaxHp_, playerHp_ + 45.0f);
          playerArmor_ = std::min(100.0f, playerArmor_ + 25.0f);
          if (audio) audio->playCashChime();
          pushToast("MEDKIT PICKUP // +45 HP +25 ARMOR", 2.8f);
        }
      }
    }
  }

  // 3. Explosive Fuel Tanks & Gas Cans (respawn timer + high-speed vehicle ram detonation)
  const bool inFastVehicle = (activeVehicleIdx_ >= 0 && static_cast<size_t>(activeVehicleIdx_) < vehicles_.size() &&
                              std::abs(vehicles_[static_cast<size_t>(activeVehicleIdx_)].speed) > 7.5f);
  for (size_t i = 0; i < explosiveProps_.size(); ++i) {
    auto& ep = explosiveProps_[i];
    if (ep.exploded) {
      ep.respawnTimer -= dt;
      if (ep.respawnTimer <= 0.0f) {
        ep.exploded = false;
        ep.hp = ep.maxHp;
      }
      continue;
    }
    if (inFastVehicle) {
      const auto& v = vehicles_[static_cast<size_t>(activeVehicleIdx_)];
      if (glm::distance(glm::vec2(v.pos.x, v.pos.z), glm::vec2(ep.pos.x, ep.pos.z)) < 2.2f) {
        detonateExplosiveProp(i, world, &player, &physics, audio);
      }
    }
  }

  // 4. 10 Radar Speed Traps
  for (auto& trap : speedTraps_) {
    if (trap.cooldown > 0.0f) trap.cooldown = std::max(0.0f, trap.cooldown - dt);
  }
  if (activeVehicleIdx_ >= 0 && static_cast<size_t>(activeVehicleIdx_) < vehicles_.size()) {
    const auto& v = vehicles_[static_cast<size_t>(activeVehicleIdx_)];
    const int speedKmh = static_cast<int>(std::round(std::abs(v.speed) * 3.6f));
    if (speedKmh >= 55) {
      for (auto& trap : speedTraps_) {
        if (trap.cooldown > 0.0f) continue;
        const float dXZ = glm::distance(glm::vec2(v.pos.x, v.pos.z), glm::vec2(trap.pos.x, trap.pos.z));
        if (dXZ < 9.5f) {
          trap.cooldown = 8.0f;
          const bool wasRecord = speedKmh > trap.bestKmh;
          const bool beatTarget = speedKmh >= trap.targetKmh;
          if (wasRecord) trap.bestKmh = speedKmh;
          addBodyStatXp(BodyStatKind::Agility, 12.0f);

          if (beatTarget && wasRecord) {
            playerCash_ += 250;
            playerIntel_ += 2;
            if (audio) audio->playCashChime();
            pushToast(
              "RADAR RECORD! " + trap.name + ": " + std::to_string(speedKmh) +
              " km/h (Target " + std::to_string(trap.targetKmh) + ") +$250",
              3.8f
            );
          } else {
            pushToast(
              "SPEED TRAP // " + trap.name + ": " + std::to_string(speedKmh) +
              " km/h (Target " + std::to_string(trap.targetKmh) + " km/h)",
              2.6f
            );
          }
          break;
        }
      }
    }
  }

  // 5. Dynamic Street Random Events (PurseSnatcher, ArmoredTruck, StreetBrawl)
  if (activeRandomEvent_.active) {
    activeRandomEvent_.timer -= dt;
    bool resolved = false;

    if (activeRandomEvent_.pickupReady &&
        glm::distance(glm::vec2(pPos.x, pPos.z), glm::vec2(activeRandomEvent_.pickupPos.x, activeRandomEvent_.pickupPos.z)) < 2.6f) {
      resolved = true;
      wantedStars_ = std::max(wantedStars_, 2);
      wantedHeat_ = std::max(wantedHeat_, 45.0f);
    } else if (!activeRandomEvent_.npcIds.empty()) {
      bool anyAlive = false;
      for (int nid : activeRandomEvent_.npcIds) {
        for (const auto& n : npcs_) {
          if (n.id == nid && n.alive) {
            anyAlive = true;
            break;
          }
        }
      }
      if (!anyAlive) resolved = true;
    }

    if (resolved) {
      playerCash_ += activeRandomEvent_.rewardCash;
      playerIntel_ += activeRandomEvent_.rewardIntel;
      playerSalvage_ += (activeRandomEvent_.kind == RandomEventKind::ArmoredTruck) ? 6 : 2;
      ++randomEventsResolved_;
      if (audio) audio->playCashChime();
      pushToast(
        "EVENT RESOLVED! +$" + std::to_string(activeRandomEvent_.rewardCash) +
        " +" + std::to_string(activeRandomEvent_.rewardIntel) + " INTEL",
        4.0f
      );
      activeRandomEvent_ = ActiveRandomEvent{};
      randomEventCooldown_ = 44.0f;
    } else if (activeRandomEvent_.timer <= 0.0f || glm::distance(pPos, activeRandomEvent_.origin) > 260.0f) {
      activeRandomEvent_ = ActiveRandomEvent{};
      randomEventCooldown_ = 36.0f;
    }
  } else if (!activeMission_.active && !activeSurveillance_.active && activeApartmentIdx_ < 0) {
    randomEventCooldown_ -= dt;
    if (randomEventCooldown_ <= 0.0f) {
      randomEventCooldown_ = 45.0f;
      const auto kind = static_cast<RandomEventKind>(randomEventsResolved_ % 3);
      spawnRandomEvent(kind, pPos, world, audio);
    }
  }

  // 6. 3D Wildlife (Huskies, Alpine Deer & Coastal Bird Flocks)
  if (inFastVehicle) {
    alertWildlifeNear(pPos, 15.0f);
  }
  for (auto& w : wildlife_) {
    const float baseSpeed = (w.kind == WildlifeKind::DogHusky) ? 2.55f : 2.15f;
    if (w.fleeTimer > 0.0f) {
      w.fleeTimer = std::max(0.0f, w.fleeTimer - dt);
      const float step = baseSpeed * 1.65f * dt;
      w.pos.x += std::sin(w.fleeYaw) * step;
      w.pos.z += std::cos(w.fleeYaw) * step;
      w.yawRad = w.fleeYaw;
      w.activeClip = "Gallop";
      w.animClock += dt * 1.55f;
      w.center.x = w.pos.x - std::cos(w.phase) * w.radius;
      w.center.z = w.pos.z - std::sin(w.phase) * w.radius * 0.72f;
    } else if (w.pauseTimer > 0.0f) {
      w.pauseTimer = std::max(0.0f, w.pauseTimer - dt);
      w.activeClip = (w.kind == WildlifeKind::Deer) ? "Eating" : "Idle";
      w.animClock += dt;
    } else {
      if (randRange01(rng_) < dt * 0.09f) {
        w.pauseTimer = 2.0f + randRange01(rng_) * 2.4f;
      } else {
        const float prevX = w.pos.x;
        const float prevZ = w.pos.z;
        w.phase += w.speed * dt;
        w.pos.x = w.center.x + std::cos(w.phase) * w.radius;
        w.pos.z = w.center.z + std::sin(w.phase) * w.radius * 0.72f;
        const float dx = w.pos.x - prevX;
        const float dz = w.pos.z - prevZ;
        if (dx * dx + dz * dz > 1e-6f) {
          w.yawRad = std::atan2(dx, dz);
        }
        w.activeClip = "Walk";
        w.animClock += dt;
      }
    }
    w.pos.x = std::clamp(w.pos.x, world.worldMin + 24.0f, world.worldMax - 24.0f);
    w.pos.z = std::clamp(w.pos.z, world.worldMin + 24.0f, world.worldMax - 24.0f);
    w.pos.y = std::max(0.15f, world.heightfield.sampleHeight(w.pos.x, w.pos.z));
  }

  for (auto& bm : birdFlocks_) {
    bm.phase += bm.angularSpeed * dt;
    bm.pos.x = bm.center.x + std::cos(bm.phase) * bm.radius;
    bm.pos.z = bm.center.z + std::sin(bm.phase) * bm.radius;
    bm.pos.y = bm.height + std::sin(bm.phase * 2.0f) * 1.4f;
    bm.yawRad = bm.phase + glm::half_pi<float>();
  }
}

std::vector<DynamicGlbPropInstance> GameSession::gatherDynamicGlbProps(float elapsedSec) const {
  std::vector<DynamicGlbPropInstance> out;
  out.reserve(collectibles_.size() + explosiveProps_.size() + birdFlocks_.size() + 4);

  const float bob = std::sin(elapsedSec * 2.8f) * 0.12f;
  const float spin = elapsedSec * 1.45f;

  for (const auto& cp : collectibles_) {
    if (cp.collected) continue;
    DynamicGlbPropInstance inst;
    inst.kind = (cp.kind == CollectibleKind::Stash) ? DynamicGlbPropKind::StashBag : DynamicGlbPropKind::Medkit;
    inst.pos = cp.pos + glm::vec3(0.0f, 0.55f + bob, 0.0f);
    inst.yawRad = spin;
    inst.scale = 1.0f;
    inst.emissive = 0.35f;
    out.push_back(inst);
  }

  for (const auto& ep : explosiveProps_) {
    if (ep.exploded) continue;
    DynamicGlbPropInstance inst;
    inst.kind = ep.kind;
    inst.pos = ep.pos;
    inst.yawRad = ep.yawRad;
    inst.scale = 1.0f;
    inst.emissive = (ep.hp < ep.maxHp * 0.5f) ? 0.65f : 0.0f;
    out.push_back(inst);
  }

  if (activeRandomEvent_.active && activeRandomEvent_.pickupReady) {
    DynamicGlbPropInstance inst;
    inst.kind = DynamicGlbPropKind::StashBag;
    inst.pos = activeRandomEvent_.pickupPos + glm::vec3(0.0f, 0.55f + bob, 0.0f);
    inst.yawRad = spin * 1.3f;
    inst.scale = 1.25f;
    inst.emissive = 0.55f;
    out.push_back(inst);
  }

  for (const auto& bm : birdFlocks_) {
    DynamicGlbPropInstance inst;
    inst.kind = DynamicGlbPropKind::Bird;
    inst.pos = bm.pos;
    inst.yawRad = bm.yawRad;
    inst.pitchRad = std::sin(elapsedSec * 6.0f + bm.phase) * 0.10f;
    inst.scale = 1.15f;
    out.push_back(inst);
  }

  return out;
}

void GameSession::appendLivingWorldMarkers(float elapsedSec, std::vector<WorldMarkerBox>& out) const {
  const float pulse = 0.5f + 0.5f * std::sin(elapsedSec * 3.4f);

  // 1. Apartment Street Entrance Beacons
  for (const auto& apt : apartments_) {
    const glm::vec3 col = apt.owned ? glm::vec3(0.18f, 0.92f, 0.58f) : apt.accentColor;
    out.push_back(WorldMarkerBox{
      apt.doorPos + glm::vec3(0.0f, 0.08f, 0.0f),
      glm::vec3(1.8f, 0.08f, 1.8f),
      elapsedSec * 0.6f,
      col,
      0.0f,
      2.2f + pulse * 0.8f
    });
    out.push_back(WorldMarkerBox{
      apt.doorPos + glm::vec3(0.0f, 2.2f, 0.0f),
      glm::vec3(0.22f, 2.2f, 0.22f),
      0.0f,
      col,
      0.0f,
      1.8f
    });
  }

  // 2. Luxury Sky-Suite Architectural Interior (when inside OR rendered at y=260m)
  if (activeApartmentIdx_ >= 0 && static_cast<size_t>(activeApartmentIdx_) < apartments_.size()) {
    const auto& apt = apartments_[static_cast<size_t>(activeApartmentIdx_)];
    const glm::vec3 o = apt.interiorOrigin;
    constexpr float kW = 18.0f;
    constexpr float kD = 15.0f;
    constexpr float kH = 3.6f;

    // Warm Herringbone Hardwood / Obsidian Marble Floor
    out.push_back({o + glm::vec3(0.0f, -0.08f, 0.0f), {kW, 0.16f, kD}, 0.0f, {0.22f, 0.17f, 0.13f}, 0.0f, 0.0f, 0.25f, 0.1f});
    // Coffered Ceiling + Warm Cove Lighting Strip
    out.push_back({o + glm::vec3(0.0f, kH + 0.10f, 0.0f), {kW, 0.20f, kD}, 0.0f, {0.14f, 0.15f, 0.18f}, 0.0f, 0.0f, 0.6f, 0.0f});
    out.push_back({o + glm::vec3(0.0f, kH - 0.04f, 0.0f), {kW - 2.0f, 0.06f, 0.22f}, 0.0f, {1.0f, 0.86f, 0.66f}, 0.0f, 3.2f});

    // Left, Right & South Walls (North wall -Z is floor-to-ceiling panoramic skyline glass with mullions!)
    out.push_back({o + glm::vec3(-kW * 0.5f, kH * 0.5f, 0.0f), {0.28f, kH, kD}, 0.0f, {0.26f, 0.24f, 0.23f}, 0.0f, 0.0f, 0.7f, 0.0f});
    out.push_back({o + glm::vec3( kW * 0.5f, kH * 0.5f, 0.0f), {0.28f, kH, kD}, 0.0f, {0.26f, 0.24f, 0.23f}, 0.0f, 0.0f, 0.7f, 0.0f});
    out.push_back({o + glm::vec3(0.0f, kH * 0.5f, kD * 0.5f), {kW, kH, 0.28f}, 0.0f, {0.20f, 0.21f, 0.24f}, 0.0f, 0.0f, 0.6f, 0.1f});
    // Panoramic Skyline Window Steel Mullions along North (-Z) edge
    for (int m = -3; m <= 3; ++m) {
      out.push_back({o + glm::vec3(static_cast<float>(m) * 2.5f, kH * 0.5f, -kD * 0.5f), {0.10f, kH, 0.12f}, 0.0f, {0.10f, 0.12f, 0.15f}, 0.0f, 0.0f, 0.3f, 0.8f});
    }
    out.push_back({o + glm::vec3(0.0f, 0.45f, -kD * 0.5f + 0.08f), {kW, 0.08f, 0.14f}, 0.0f, apt.accentColor, 0.0f, 2.2f});

    // King Bed Station (-5.5, 0, -2.5)
    out.push_back({o + glm::vec3(-5.5f, 0.28f, -2.5f), {2.6f, 0.52f, 3.0f}, 0.0f, {0.16f, 0.16f, 0.20f}, 0.0f, 0.0f, 0.8f, 0.0f});
    out.push_back({o + glm::vec3(-5.5f, 0.58f, -2.3f), {2.35f, 0.22f, 2.5f}, 0.0f, {0.86f, 0.86f, 0.90f}, 0.0f, 0.0f, 0.9f, 0.0f});
    out.push_back({o + glm::vec3(-5.5f, 0.95f, -3.85f), {2.6f, 1.25f, 0.20f}, 0.0f, apt.accentColor * 0.65f, 0.0f, 0.4f});

    // Center Lounge Rug, Sofa & Glass Coffee Table
    out.push_back({o + glm::vec3(-0.3f, 0.02f, -1.2f), {4.6f, 0.03f, 3.4f}, 0.0f, apt.accentColor * 0.38f, 0.0f, 0.0f, 0.95f, 0.0f});
    out.push_back({o + glm::vec3(-0.3f, 0.38f,  0.4f), {3.4f, 0.72f, 1.1f}, 0.0f, {0.18f, 0.19f, 0.22f}, 0.0f, 0.0f, 0.75f, 0.0f});
    out.push_back({o + glm::vec3(-0.3f, 0.28f, -1.4f), {1.8f, 0.42f, 0.9f}, 0.0f, {0.22f, 0.34f, 0.42f}, 0.0f, 0.3f, 0.15f, 0.6f});

    // Walk-In Wardrobe Station (+5.8, 0, -2.5)
    out.push_back({o + glm::vec3(6.8f, 1.35f, -2.5f), {1.1f, 2.6f, 2.8f}, 0.0f, {0.18f, 0.14f, 0.12f}, 0.0f, 0.0f, 0.4f, 0.2f});
    out.push_back({o + glm::vec3(5.8f, 0.06f, -2.5f), {1.3f, 0.08f, 1.3f}, 0.0f, {0.25f, 0.78f, 0.98f}, 0.0f, 2.4f});

    // Armory Gunsmith Bench (+5.8, 0, +2.8)
    out.push_back({o + glm::vec3(6.6f, 0.52f, 2.8f), {1.2f, 1.0f, 2.6f}, 0.0f, {0.15f, 0.18f, 0.22f}, 0.0f, 0.0f, 0.35f, 0.75f});
    out.push_back({o + glm::vec3(5.8f, 0.06f, 2.8f), {1.3f, 0.08f, 1.3f}, 0.0f, {0.98f, 0.64f, 0.14f}, 0.0f, 2.4f});

    // Penthouse Elevator Exit Door (0, 0, +6.4)
    out.push_back({o + glm::vec3(0.0f, 1.25f, kD * 0.5f - 0.16f), {1.8f, 2.4f, 0.16f}, 0.0f, {0.22f, 0.88f, 0.58f}, 0.0f, 1.8f});
  }

  // 3. Collectible Halo Rings (under stash_bag.glb / medkit.glb)
  for (const auto& cp : collectibles_) {
    if (cp.collected) continue;
    const glm::vec3 col = (cp.kind == CollectibleKind::Stash)
      ? glm::vec3(0.98f, 0.75f, 0.14f)
      : glm::vec3(0.22f, 0.74f, 0.97f);
    out.push_back({
      cp.pos + glm::vec3(0.0f, 0.06f, 0.0f),
      {1.15f, 0.05f, 1.15f},
      elapsedSec * 1.2f,
      col,
      0.0f,
      2.6f
    });
  }

  // 4. 10 Radar Speed Trap Camera Gantries
  for (const auto& trap : speedTraps_) {
    const glm::vec3 col = (trap.bestKmh >= trap.targetKmh)
      ? glm::vec3(0.20f, 0.92f, 0.52f)
      : glm::vec3(0.98f, 0.55f, 0.12f);
    out.push_back({trap.pos + glm::vec3(-4.8f, 1.8f, 0.0f), {0.24f, 3.6f, 0.24f}, 0.0f, {0.22f, 0.24f, 0.28f}, 0.0f, 0.0f, 0.4f, 0.7f});
    out.push_back({trap.pos + glm::vec3(-4.8f, 3.5f, 0.0f), {0.55f, 0.42f, 0.42f}, 0.0f, col, 0.0f, 2.8f});
  }

  // 5. Active Street Random Event Beacon
  if (activeRandomEvent_.active) {
    out.push_back({
      activeRandomEvent_.origin + glm::vec3(0.0f, 0.10f, 0.0f),
      {3.2f, 0.08f, 3.2f},
      elapsedSec * 1.4f,
      {0.98f, 0.32f, 0.24f},
      0.0f,
      2.8f + pulse
    });
  }
}

void GameSession::appendLivingWorldLights(float elapsedSec, std::vector<DynamicPointLight>& out) const {
  (void)elapsedSec;
  if (activeApartmentIdx_ >= 0 && static_cast<size_t>(activeApartmentIdx_) < apartments_.size()) {
    const auto& apt = apartments_[static_cast<size_t>(activeApartmentIdx_)];
    out.push_back(DynamicPointLight{
      apt.interiorOrigin + glm::vec3(0.0f, 3.1f, -1.0f),
      18.0f,
      {1.0f, 0.88f, 0.72f},
      2.4f
    });
    out.push_back(DynamicPointLight{
      apt.interiorOrigin + glm::vec3(-5.0f, 2.4f, -2.5f),
      10.0f,
      apt.accentColor,
      1.35f
    });
  }
}

} // namespace westgate
