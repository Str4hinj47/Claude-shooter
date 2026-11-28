#include "westgate/GameSession.hpp"
#include <algorithm>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <fstream>
#include <nlohmann/json.hpp>
#include <string>
#include <vector>

namespace westgate {

namespace {

float raySphereHit(const glm::vec3& orig, const glm::vec3& dir, const glm::vec3& center, float radius) {
  const glm::vec3 oc = orig - center;
  const float b = glm::dot(oc, dir);
  const float c = glm::dot(oc, oc) - radius * radius;
  const float disc = b * b - c;
  if (disc < 0.0f) return -1.0f;
  const float t = -b - std::sqrt(disc);
  return t >= 0.0f ? t : -1.0f;
}

float wrapAnglePi(float a) {
  constexpr float kPi = 3.14159265359f;
  while (a > kPi) a -= 2.0f * kPi;
  while (a < -kPi) a += 2.0f * kPi;
  return a;
}

float moveTowardAngle(float current, float target, float maxStep) {
  const float diff = wrapAnglePi(target - current);
  if (std::abs(diff) <= maxStep) return target;
  return wrapAnglePi(current + (diff > 0.0f ? maxStep : -maxStep));
}

} // namespace

void GameSession::pushToast(const std::string& msg, float duration) {
  toastText_ = msg;
  toastTimer_ = duration;
}

void GameSession::init(const WorldData& world, PlayerController* player, PhysicsWorld* /*physics*/) {
  weapons_.clear();
  weapons_.push_back({"unarmed", "Iron Pit Boxing", "Fists", 0, 0, 18.0f, 1, 180.0f, 0.0f, 0.0f, 0.0f, 2.5f, false, true, true, true, 0, 0, 0, 0});
  weapons_.push_back({"pistol", "Apex P226-SD", "P226-SD", 0, 45, 36.0f, 1, 420.0f, 0.008f, 0.002f, 1.45f, 4.0f, false, true, false, true, 15, 15, 75, 120});
  weapons_.push_back({"carbine", "Vanguard M4A1-S", "M4A1-S", 850, 90, 38.0f, 1, 680.0f, 0.007f, 0.0015f, 2.1f, 7.5f, true, true, false, false, 30, 30, 120, 210});
  weapons_.push_back({"smg", "Spectre MP5-SD", "MP5-SD", 650, 75, 29.0f, 1, 780.0f, 0.011f, 0.003f, 1.85f, 5.5f, true, true, false, false, 30, 30, 150, 240});
  weapons_.push_back({"shotgun", "Breacher 870", "870 Tac", 700, 70, 19.0f, 8, 85.0f, 0.055f, 0.032f, 2.3f, 32.0f, false, false, false, false, 8, 8, 40, 64});
  weapons_.push_back({"dmr", "MK14 EBR", "MK14", 1200, 110, 68.0f, 1, 240.0f, 0.005f, 0.0008f, 2.35f, 38.0f, false, false, false, false, 20, 20, 80, 120});

  activeWeapon_ = 0;
  vehicles_.clear();
  npcs_.clear();
  tracers_.clear();

  // Collect driveable road splines
  std::vector<size_t> longRoads;
  for (size_t ri = 0; ri < world.roads.size(); ++ri) {
    if (world.roads[ri].samples.size() >= 6) longRoads.push_back(ri);
  }

  // 64 ambient traffic vehicles across 14 road vehicle models (dense Westgate Bay traffic!)
  if (!longRoads.empty()) {
    const VehicleModelKind trafficKinds[14] = {
      VehicleModelKind::Sedan,
      VehicleModelKind::Taxi,
      VehicleModelKind::RangeRover,
      VehicleModelKind::PoliceCruiser,
      VehicleModelKind::Audi,
      VehicleModelKind::Challenger,
      VehicleModelKind::Delivery,
      VehicleModelKind::R8,
      VehicleModelKind::Sedan,
      VehicleModelKind::Ambulance,
      VehicleModelKind::Firetruck,
      VehicleModelKind::Semi,
      VehicleModelKind::Mustang,
      VehicleModelKind::Taxi,
    };
    const glm::vec3 trafficTints[6] = {
      {1.0f, 1.0f, 1.0f}, {0.20f, 0.45f, 0.85f}, {0.82f, 0.18f, 0.20f},
      {0.25f, 0.65f, 0.42f}, {0.86f, 0.72f, 0.18f}, {0.42f, 0.44f, 0.48f},
    };
    for (int i = 0; i < 64; ++i) {
      VehicleEntity v;
      v.id = nextVehicleId_++;
      v.kind = trafficKinds[i % 14];
      v.isAmbientTraffic = true;
      v.roadIdx = longRoads[static_cast<size_t>(i) % longRoads.size()];
      const float maxS = static_cast<float>(world.roads[v.roadIdx].samples.size() - 1);
      v.samplePos = std::fmod(static_cast<float>(i) * 2.13f, std::max(1.0f, maxS - 0.1f));
      v.speed = (v.kind == VehicleModelKind::Semi || v.kind == VehicleModelKind::Firetruck)
        ? 9.0f + static_cast<float>(i % 4)
        : 11.0f + static_cast<float>((i * 5) % 8);
      v.forward = (i % 2) == 0;
      v.maxSpeed = (v.kind == VehicleModelKind::PoliceCruiser || v.kind == VehicleModelKind::R8) ? 44.0f : 34.0f;
      v.colorTint = (v.kind == VehicleModelKind::PoliceCruiser || v.kind == VehicleModelKind::Taxi ||
                     v.kind == VehicleModelKind::Ambulance || v.kind == VehicleModelKind::Firetruck)
        ? glm::vec3(1.0f)
        : trafficTints[i % 6];
      vehicles_.push_back(v);
    }
  }

  // 10 parked hero & street vehicles + 4 docked Boats + 2 flyable Helicopters
  struct ParkedSpec { VehicleModelKind kind; float x; float z; float yaw; glm::vec3 tint; float maxSpd; float acc; bool boat; bool heli; };
  const ParkedSpec parked[] = {
    {VehicleModelKind::Mustang, world.spawnPos.x + 7.0f, world.spawnPos.z + 5.5f, 0.35f, {0.85f, 0.14f, 0.18f}, 44.0f, 24.0f, false, false},
    {VehicleModelKind::RangeRover, world.spawnPos.x - 9.0f, world.spawnPos.z + 6.5f, -0.4f, {0.16f, 0.18f, 0.22f}, 36.0f, 20.0f, false, false},
    {VehicleModelKind::R8, 34.0f, -86.0f, 1.57f, {0.92f, 0.88f, 0.90f}, 54.0f, 31.0f, false, false},
    {VehicleModelKind::PoliceCruiser, 196.0f, 44.0f, 1.57f, {1.0f, 1.0f, 1.0f}, 42.0f, 23.0f, false, false},
    {VehicleModelKind::Taxi, -402.0f, -74.0f, 0.0f, {1.0f, 1.0f, 1.0f}, 35.0f, 19.0f, false, false},
    {VehicleModelKind::Challenger, -692.0f, 36.0f, -1.57f, {0.18f, 0.42f, 0.88f}, 46.0f, 25.0f, false, false},
    {VehicleModelKind::Mustang, world.fightPitPos.x - 16.0f, world.fightPitPos.z - 8.0f, 0.7f, {0.12f, 0.48f, 0.88f}, 44.0f, 24.0f, false, false},
    {VehicleModelKind::Ferrari, 625.0f, 425.0f, 0.0f, {0.95f, 0.78f, 0.12f}, 52.0f, 29.0f, false, false},
    {VehicleModelKind::Audi, -120.0f, 835.0f, 0.0f, {0.82f, 0.84f, 0.88f}, 45.0f, 25.0f, false, false},
    {VehicleModelKind::RangeRover, -955.0f, 365.0f, 0.8f, {0.18f, 0.42f, 0.30f}, 38.0f, 21.0f, false, false}, // Pelican Key SUV!
    // Docked Speedboats & Cruisers
    {VehicleModelKind::Speedboat, -748.0f, 42.0f, -1.57f, {0.95f, 0.95f, 0.98f}, 38.0f, 22.0f, true, false},
    {VehicleModelKind::CruiserBoat, -752.0f, -12.0f, -1.45f, {0.92f, 0.94f, 0.96f}, 30.0f, 16.0f, true, false},
    {VehicleModelKind::Speedboat, 655.0f, 465.0f, 1.2f, {0.92f, 0.22f, 0.20f}, 38.0f, 22.0f, true, false},
    {VehicleModelKind::Speedboat, -912.0f, 305.0f, -0.7f, {0.20f, 0.65f, 0.95f}, 38.0f, 22.0f, true, false},
    // Flyable Helicopters (Downtown Helipad & Westgate Airport)
    {VehicleModelKind::Helicopter, 32.0f, -108.0f, 0.0f, {0.20f, 0.24f, 0.30f}, 48.0f, 24.0f, false, true},
    {VehicleModelKind::Helicopter, 24.0f, 935.0f, 3.14f, {0.85f, 0.22f, 0.18f}, 52.0f, 26.0f, false, true},
  };
  for (const auto& ps : parked) {
    VehicleEntity v;
    v.id = nextVehicleId_++;
    v.kind = ps.kind;
    v.isBoat = ps.boat;
    v.isAircraft = ps.heli;
    const float y = ps.boat ? 0.05f : (world.heightfield.sampleHeight(ps.x, ps.z) + 0.05f);
    v.pos = glm::vec3(ps.x, y, ps.z);
    v.yawRad = ps.yaw;
    v.colorTint = ps.tint;
    v.maxSpeed = ps.maxSpd;
    v.accel = ps.acc;
    vehicles_.push_back(v);
  }

  // 96 ambient city pedestrians walking sidewalks, plazas, Del Sol & Pelican Key
  if (!longRoads.empty()) {
    const NpcModelKind pedKinds[3] = {NpcModelKind::Civilian, NpcModelKind::Business, NpcModelKind::Security};
    for (int i = 0; i < 96; ++i) {
      NpcEntity ped;
      ped.id = nextNpcId_++;
      ped.kind = pedKinds[i % 3];
      ped.roadIdx = longRoads[static_cast<size_t>(i * 3 + 1) % longRoads.size()];
      const auto& seg = world.roads[ped.roadIdx];
      const float maxS = static_cast<float>(seg.samples.size() - 1);
      ped.samplePos = std::fmod(static_cast<float>(i) * 1.43f, std::max(1.0f, maxS - 0.1f));
      ped.forward = (i % 2) == 0;
      ped.animClip = "Walk";
      ped.maxHp = 80.0f;
      ped.hp = 80.0f;
      const size_t si = std::min<size_t>(static_cast<size_t>(ped.samplePos), seg.samples.size() - 1);
      const auto& sp = seg.samples[si];
      ped.pos = glm::vec3(sp.pos.x + sp.rx * 6.5f, world.heightfield.sampleHeight(sp.pos.x, sp.pos.z) + 0.05f, sp.pos.z + sp.rz * 6.5f);
      ped.homePos = ped.pos;
      npcs_.push_back(ped);
    }
  }

  // Iron Pit 8-fighter roster + 3-match fight card + Tier 1 spawn
  pitRoster_ = {
    {"\"Scrapyard\" Rico", "Brawler", "9-4", 0.92f, 0.95f, 0.90f, {0.78f, 0.58f, 0.44f}, {0.84f, 0.16f, 0.16f}, {0.09f, 0.07f, 0.06f}},
    {"Darius \"Brick\" Cole", "Slugger", "12-3", 1.15f, 0.85f, 1.05f, {0.42f, 0.28f, 0.20f}, {0.15f, 0.45f, 0.88f}, {0.06f, 0.05f, 0.05f}},
    {"Kaito \"Razor\" Sato", "Counter", "14-2", 0.96f, 1.24f, 1.08f, {0.88f, 0.72f, 0.58f}, {0.92f, 0.72f, 0.14f}, {0.07f, 0.07f, 0.09f}},
    {"\"Hammer\" Kowalski", "Heavyweight", "16-4", 1.28f, 0.80f, 1.12f, {0.90f, 0.72f, 0.62f}, {0.20f, 0.75f, 0.42f}, {0.32f, 0.24f, 0.14f}},
    {"Mateo \"El Diablo\" Cruz", "Champion", "21-1", 1.26f, 1.18f, 1.22f, {0.72f, 0.52f, 0.38f}, {0.88f, 0.18f, 0.55f}, {0.06f, 0.05f, 0.05f}},
    {"Viktor \"The Bear\" Volkov", "Grappler", "11-5", 1.20f, 0.82f, 1.02f, {0.88f, 0.70f, 0.60f}, {0.48f, 0.22f, 0.85f}, {0.22f, 0.16f, 0.11f}},
    {"\"Slick\" Eddie Morales", "Boxer-Puncher", "13-6", 0.94f, 1.16f, 0.96f, {0.76f, 0.56f, 0.42f}, {0.14f, 0.78f, 0.82f}, {0.08f, 0.07f, 0.06f}},
    {"Tariq \"Steel\" Mensah", "Pressure", "15-3", 1.12f, 1.08f, 1.06f, {0.36f, 0.24f, 0.17f}, {0.96f, 0.46f, 0.12f}, {0.05f, 0.05f, 0.05f}},
  };
  spectatorBout_ = SpectatorBoutState{};
  refreshFightCard();
  spawnIronPitTier(1, world);

  // Surveillance Hit Contracts
  contracts_.clear();
  contracts_.push_back({"hit_port_auditor", "H1", "The Port Auditor", "Marcus Bell", "Seaport Docks", {635.0f, world.heightfield.sampleHeight(635.0f, 432.0f), 432.0f}, 3000, 1000, false});
  contracts_.push_back({"hit_cartel_broker", "H2", "Cartel Broker", "Viktor Vance", "Legion Square", {38.0f, world.heightfield.sampleHeight(38.0f, -165.0f), -165.0f}, 4200, 1500, false});
  contracts_.push_back({"hit_harbor_syndicate", "H3", "Harbor Syndicate", "Nadia Kurosawa", "Del Sol Pier", {-706.0f, world.heightfield.sampleHeight(-706.0f, 40.0f), 40.0f}, 5500, 2000, false});

  // Street Races
  races_.clear();
  races_.push_back({
    "race_bayshore",
    "Bayshore Sprint",
    {16.0f, world.heightfield.sampleHeight(16.0f, -38.0f), -38.0f},
    3.14f,
    {
      {14.0f, world.heightfield.sampleHeight(14.0f, -180.0f), -180.0f},
      {-210.0f, world.heightfield.sampleHeight(-210.0f, -180.0f), -180.0f},
      {-450.0f, world.heightfield.sampleHeight(-450.0f, -130.0f), -130.0f},
      {-670.0f, world.heightfield.sampleHeight(-670.0f, -40.0f), -40.0f},
      {-695.0f, world.heightfield.sampleHeight(-695.0f, 110.0f), 110.0f},
    },
    1500,
    false,
  });
  races_.push_back({
    "race_skyline",
    "Downtown Skyline Circuit",
    {24.0f, world.heightfield.sampleHeight(24.0f, -82.0f), -82.0f},
    0.0f,
    {
      {196.0f, world.heightfield.sampleHeight(196.0f, 48.0f), 48.0f},
      {385.0f, world.heightfield.sampleHeight(385.0f, -56.0f), -56.0f},
      {112.0f, world.heightfield.sampleHeight(112.0f, -162.0f), -162.0f},
      {24.0f, world.heightfield.sampleHeight(24.0f, -82.0f), -82.0f},
    },
    1800,
    false,
  });
  races_.push_back({
    "race_seaport",
    "Seaport Freight Run",
    {370.0f, world.heightfield.sampleHeight(370.0f, 268.0f), 268.0f},
    0.0f,
    {
      {635.0f, world.heightfield.sampleHeight(635.0f, 432.0f), 432.0f},
      {350.0f, world.heightfield.sampleHeight(350.0f, 595.0f), 595.0f},
      {-120.0f, world.heightfield.sampleHeight(-120.0f, 850.0f), 850.0f},
    },
    2200,
    false,
  });

  // 6 Stunt Jumps
  stuntJumps_.clear();
  stuntJumps_.push_back({"stunt_pier", "Del Sol Boardwalk Leap", {-735.0f, world.heightfield.sampleHeight(-735.0f, -24.0f), -24.0f}, 4.71f, false});
  stuntJumps_.push_back({"stunt_downtown", "Civic Boulevard Overpass", {14.0f, world.heightfield.sampleHeight(14.0f, -135.0f), -135.0f}, 0.0f, false});
  stuntJumps_.push_back({"stunt_airport", "Runway Booster Ramp", {10.0f, world.heightfield.sampleHeight(10.0f, 960.0f), 960.0f}, 1.57f, false});
  stuntJumps_.push_back({"stunt_port", "Eastgate Cargo Launch", {585.0f, world.heightfield.sampleHeight(585.0f, 385.0f), 385.0f}, 3.14f, false});
  stuntJumps_.push_back({"stunt_canals", "Venice Canal Gap", {-505.0f, world.heightfield.sampleHeight(-505.0f, -315.0f), -315.0f}, 3.14f, false});
  stuntJumps_.push_back({"stunt_midtown", "Midtown Skyway Jump", {-335.0f, world.heightfield.sampleHeight(-335.0f, -140.0f), -140.0f}, 1.57f, false});

  // 4 Stores + 4 Mod Garages
  shops_.clear();
  shops_.push_back({"store_downtown", "24/7 Westgate Mart (Civic)", {-38.0f, world.heightfield.sampleHeight(-38.0f, -125.0f), -125.0f}, false, 0.0f});
  shops_.push_back({"store_delsol", "24/7 Westgate Mart (Del Sol)", {-692.0f, world.heightfield.sampleHeight(-692.0f, -72.0f), -72.0f}, false, 0.0f});
  shops_.push_back({"store_oldquarter", "24/7 Westgate Mart (Old Quarter)", {355.0f, world.heightfield.sampleHeight(355.0f, -160.0f), -160.0f}, false, 0.0f});
  shops_.push_back({"store_mirror", "24/7 Westgate Mart (Mirror Park)", {-162.0f, world.heightfield.sampleHeight(-162.0f, 295.0f), 295.0f}, false, 0.0f});

  shops_.push_back({"garage_downtown", "Westgate Customs (Downtown)", {112.0f, world.heightfield.sampleHeight(112.0f, -135.0f), -135.0f}, true, 0.0f});
  shops_.push_back({"garage_delsol", "Westgate Customs (Del Sol)", {-640.0f, world.heightfield.sampleHeight(-640.0f, 75.0f), 75.0f}, true, 0.0f});
  shops_.push_back({"garage_midtown", "Westgate Customs (Midtown)", {-350.0f, world.heightfield.sampleHeight(-350.0f, -165.0f), -165.0f}, true, 0.0f});
  shops_.push_back({"garage_seaport", "Westgate Customs (Seaport)", {615.0f, world.heightfield.sampleHeight(615.0f, 345.0f), 345.0f}, true, 0.0f});

  hasWaypoint_ = true;
  waypointPos_ = world.fightPitPos;
  waypointLabel_ = "Iron Pit Arena (Tier 1)";
  pushToast("Welcome to Westgate Bay! Press [P] for Phone, [G] to Drive, [1-6] Weapons.", 5.0f);

  if (player) {
    player->teleport(world.spawnPos, world.spawnYawDeg);
  }
}

void GameSession::spawnIronPitTier(int tier, const WorldData& world) {
  if (ironPit_.betActive) {
    ironPit_.betProfit -= ironPit_.betWager;
    ironPit_.betActive = false;
    ironPit_.betWager = 0;
    ironPit_.winStreak = 0;
  }
  ironPit_.tier = std::clamp(tier, 1, 5);
  const float pitY = world.heightfield.sampleHeight(world.fightPitPos.x, world.fightPitPos.z) + 0.65f;
  ironPit_.pos = glm::vec3(world.fightPitPos.x, pitY, world.fightPitPos.z + 2.8f);
  ironPit_.yawRad = 3.14159f;
  ironPit_.animClip = "fight_idle";
  ironPit_.animTime = 0.0f;
  ironPit_.attackCooldown = 1.5f;
  ironPit_.hitFlash = 0.0f;
  ironPit_.hitApplied = false;
  ironPit_.defeated = false;

  static const int kTierPurses[5] = {500, 900, 1450, 2100, 3200};
  static const float kTierHps[5] = {105.0f, 145.0f, 185.0f, 230.0f, 290.0f};
  const size_t idx = static_cast<size_t>(ironPit_.tier - 1);
  if (idx < pitRoster_.size()) {
    const auto& f = pitRoster_[idx];
    ironPit_.opponentName = f.name;
    ironPit_.skinTint = f.skinTint;
    ironPit_.shortsTint = f.shortsTint;
    ironPit_.hairTint = f.hairTint;
  }
  ironPit_.maxHp = kTierHps[idx];
  ironPit_.purse = kTierPurses[idx];
  ironPit_.hp = ironPit_.maxHp;
}

void GameSession::refreshFightCard() {
  pitCard_.clear();
  if (pitRoster_.size() < 6) return;
  for (int m = 0; m < 3; ++m) {
    rng_ = rng_ * 1664525u + 1013904223u;
    const int r = static_cast<int>(rng_ % pitRoster_.size());
    rng_ = rng_ * 1664525u + 1013904223u;
    int b = static_cast<int>(rng_ % pitRoster_.size());
    if (b == r) b = (r + 1) % static_cast<int>(pitRoster_.size());

    const auto& fr = pitRoster_[static_cast<size_t>(r)];
    const auto& fb = pitRoster_[static_cast<size_t>(b)];
    const float ratingR = fr.power * 0.42f + fr.speed * 0.34f + fr.defense * 0.24f;
    const float ratingB = fb.power * 0.42f + fb.speed * 0.34f + fb.defense * 0.24f;
    const float pRed = std::clamp(0.5f + (ratingR - ratingB) * 0.65f, 0.22f, 0.78f);
    const float pBlue = 1.0f - pRed;
    const float rOdds = std::round((0.94f / pRed) * 100.0f) / 100.0f;
    const float bOdds = std::round((0.94f / pBlue) * 100.0f) / 100.0f;
    const float koOdds = std::round((1.75f + (fr.defense + fb.defense) * 0.45f) * 100.0f) / 100.0f;
    pitCard_.push_back({r, b, rOdds, bOdds, koOdds, false});
  }
}

bool GameSession::startSpectatorBout(int matchIdx, int pickCorner, int wager, bool quickKoProp, const WorldData& world, AudioEngine* audio) {
  if (spectatorBout_.active || matchIdx < 0 || matchIdx >= static_cast<int>(pitCard_.size())) return false;
  auto& card = pitCard_[static_cast<size_t>(matchIdx)];
  if (card.settled) return false;
  if (wager > 0 && playerCash_ < wager) {
    pushToast("Not enough cash for wager ($" + std::to_string(wager) + ")", 2.5f);
    return false;
  }
  if (wager > 0) playerCash_ -= wager;

  const float pitY = world.heightfield.sampleHeight(world.fightPitPos.x, world.fightPitPos.z) + 0.65f;
  spectatorBout_ = SpectatorBoutState{};
  spectatorBout_.active = true;
  spectatorBout_.matchIdx = matchIdx;
  spectatorBout_.betCorner = std::clamp(pickCorner, 0, 1);
  spectatorBout_.betWager = std::max(0, wager);
  spectatorBout_.quickKoProp = quickKoProp;

  const auto& fr = pitRoster_[static_cast<size_t>(card.redIdx)];
  const auto& fb = pitRoster_[static_cast<size_t>(card.blueIdx)];
  spectatorBout_.red.fighterIdx = card.redIdx;
  spectatorBout_.red.maxHp = 115.0f * fr.defense;
  spectatorBout_.red.hp = spectatorBout_.red.maxHp;
  spectatorBout_.red.pos = glm::vec3(world.fightPitPos.x - 2.3f, pitY, world.fightPitPos.z);
  spectatorBout_.red.yawRad = 1.5708f;
  spectatorBout_.red.attackCooldown = 0.7f;

  spectatorBout_.blue.fighterIdx = card.blueIdx;
  spectatorBout_.blue.maxHp = 115.0f * fb.defense;
  spectatorBout_.blue.hp = spectatorBout_.blue.maxHp;
  spectatorBout_.blue.pos = glm::vec3(world.fightPitPos.x + 2.3f, pitY, world.fightPitPos.z);
  spectatorBout_.blue.yawRad = -1.5708f;
  spectatorBout_.blue.attackCooldown = 0.85f;

  if (audio) audio->playPitBell(false);
  pushToast("CAGE BOUT LIVE: " + fr.name + " vs " + fb.name + "!", 3.5f);
  return true;
}

void GameSession::spawnSparks(const glm::vec3& pos, const glm::vec3& normal, const glm::vec3& color, int count) {
  for (int i = 0; i < count && sparks_.size() < 160; ++i) {
    rng_ = rng_ * 1664525u + 1013904223u;
    const float rx = (static_cast<float>((rng_ >> 8) & 0xFFFF) / 32768.0f - 1.0f) * 3.8f;
    rng_ = rng_ * 1664525u + 1013904223u;
    const float ry = static_cast<float>((rng_ >> 8) & 0xFFFF) / 65535.0f * 4.2f + 1.2f;
    rng_ = rng_ * 1664525u + 1013904223u;
    const float rz = (static_cast<float>((rng_ >> 8) & 0xFFFF) / 32768.0f - 1.0f) * 3.8f;
    SparkParticle sp;
    sp.pos = pos;
    sp.vel = normal * 2.4f + glm::vec3(rx, ry, rz);
    sp.color = color;
    sp.ttl = 0.25f + static_cast<float>(i % 4) * 0.07f;
    sp.size = 0.06f + static_cast<float>(i % 3) * 0.025f;
    sparks_.push_back(sp);
  }
}

void GameSession::setTimeOfDayPreset(TimeOfDayPreset preset) {
  switch (preset) {
    case TimeOfDayPreset::Afternoon: timeOfDayHours_ = 14.5f; break;
    case TimeOfDayPreset::Sunset: timeOfDayHours_ = 18.4f; break;
    case TimeOfDayPreset::Night: timeOfDayHours_ = 22.8f; break;
    case TimeOfDayPreset::Dawn: timeOfDayHours_ = 6.2f; break;
  }
}

void GameSession::cycleTimeOfDay() {
  if (timeOfDayHours_ < 11.0f) setTimeOfDayPreset(TimeOfDayPreset::Afternoon);
  else if (timeOfDayHours_ < 17.0f) setTimeOfDayPreset(TimeOfDayPreset::Sunset);
  else if (timeOfDayHours_ < 20.5f) setTimeOfDayPreset(TimeOfDayPreset::Night);
  else setTimeOfDayPreset(TimeOfDayPreset::Dawn);
}

std::string GameSession::timeOfDayLabel() const {
  if (timeOfDayHours_ >= 5.0f && timeOfDayHours_ < 9.5f) return "Dawn";
  if (timeOfDayHours_ >= 9.5f && timeOfDayHours_ < 17.0f) return "Afternoon";
  if (timeOfDayHours_ >= 17.0f && timeOfDayHours_ < 20.2f) return "Sunset";
  return "Night";
}

void GameSession::setWeatherPreset(WeatherPreset preset) {
  weatherPreset_ = preset;
  pushToast("Weather: " + weatherLabel(), 2.5f);
}

void GameSession::cycleWeather() {
  const int next = (static_cast<int>(weatherPreset_) + 1) % 4;
  setWeatherPreset(static_cast<WeatherPreset>(next));
}

std::string GameSession::weatherLabel() const {
  switch (weatherPreset_) {
    case WeatherPreset::Clear: return "Clear";
    case WeatherPreset::Overcast: return "Overcast";
    case WeatherPreset::Rain: return "Rain";
    case WeatherPreset::Thunderstorm: return "Thunderstorm";
  }
  return "Clear";
}

float GameSession::oceanWaveHeight(float x, float z, float timeSec) {
  const float w1 = std::sin(x * 0.14f + timeSec * 1.55f) * std::cos(z * 0.13f - timeSec * 1.05f);
  const float w2 = std::sin(x * 0.31f - timeSec * 2.05f + z * 0.27f);
  return (w1 * 0.16f + w2 * 0.08f);
}

SkyLightingState GameSession::skyLighting() const {
  SkyLightingState s;
  const float h = timeOfDayHours_;
  const float sunAngle = (h - 6.0f) / 12.0f * 3.14159265f; // 6am=0, 12pm=pi/2, 6pm=pi
  const float sunY = std::sin(sunAngle);
  const float sunX = std::cos(sunAngle) * 0.78f;
  const float sunZ = 0.45f;

  if (sunY >= 0.25f) {
    // Day
    const float t = std::clamp((sunY - 0.25f) / 0.75f, 0.0f, 1.0f);
    s.clearColor = glm::mix(glm::vec3(0.84f, 0.54f, 0.36f), glm::vec3(0.42f, 0.65f, 0.85f), t);
    s.fogColor = glm::mix(glm::vec3(0.86f, 0.60f, 0.44f), glm::vec3(0.58f, 0.73f, 0.86f), t);
    s.sunColor = glm::mix(glm::vec3(1.0f, 0.68f, 0.42f), glm::vec3(1.0f, 0.96f, 0.88f), t);
    s.sunDir = glm::normalize(glm::vec3(sunX, std::max(0.28f, sunY), sunZ));
    s.nightFactor = 0.0f;
  } else if (sunY > -0.15f) {
    // Sunset / Dawn twilight
    const float t = std::clamp((sunY + 0.15f) / 0.40f, 0.0f, 1.0f);
    s.clearColor = glm::mix(glm::vec3(0.06f, 0.09f, 0.18f), glm::vec3(0.84f, 0.54f, 0.36f), t);
    s.fogColor = glm::mix(glm::vec3(0.08f, 0.11f, 0.20f), glm::vec3(0.86f, 0.60f, 0.44f), t);
    s.sunColor = glm::mix(glm::vec3(0.28f, 0.34f, 0.52f), glm::vec3(1.0f, 0.68f, 0.42f), t);
    s.sunDir = glm::normalize(glm::vec3(sunX, 0.22f, sunZ));
    s.nightFactor = 1.0f - t;
  } else {
    // Moonlit night
    s.clearColor = glm::vec3(0.04f, 0.06f, 0.13f);
    s.fogColor = glm::vec3(0.06f, 0.08f, 0.15f);
    s.sunColor = glm::vec3(0.28f, 0.36f, 0.56f);
    s.sunDir = glm::normalize(glm::vec3(-0.35f, 0.65f, -0.45f));
    s.nightFactor = 1.0f;
  }

  // Apply dynamic weather cloud darkening, storm haze, wetness & lightning flash
  const float cloudCover = (weatherPreset_ == WeatherPreset::Overcast) ? 0.45f
                         : (weatherPreset_ == WeatherPreset::Rain) ? 0.70f
                         : (weatherPreset_ == WeatherPreset::Thunderstorm) ? 0.90f : 0.0f;
  const glm::vec3 stormGrey(0.18f, 0.21f, 0.26f);
  s.clearColor = glm::mix(s.clearColor, stormGrey * (1.0f - 0.6f * s.nightFactor), cloudCover);
  s.fogColor = glm::mix(s.fogColor, stormGrey * (1.0f - 0.55f * s.nightFactor), cloudCover * 0.85f);
  s.sunColor *= (1.0f - cloudCover * 0.58f);
  s.sunColor += glm::vec3(0.85f, 0.92f, 1.0f) * (lightningFlash_ * 2.4f);
  s.clearColor += glm::vec3(0.45f, 0.52f, 0.68f) * lightningFlash_;
  s.rainIntensity = rainIntensity_;
  s.wetness = wetness_;
  s.lightningFlash = lightningFlash_;
  return s;
}

void GameSession::setGpsWaypoint(const glm::vec3& pos, const std::string& label) {
  hasWaypoint_ = true;
  waypointPos_ = pos;
  waypointLabel_ = label;
}

void GameSession::teleportTo(const glm::vec3& pos, float yawDeg, PlayerController& player) {
  if (activeVehicleIdx_ >= 0 && activeVehicleIdx_ < static_cast<int>(vehicles_.size())) {
    vehicles_[static_cast<size_t>(activeVehicleIdx_)].occupiedByPlayer = false;
    activeVehicleIdx_ = -1;
  }
  player.teleport(pos, yawDeg);
}

void GameSession::acceptContract(int idx, const WorldData& world) {
  if (idx < 0 || idx >= static_cast<int>(contracts_.size())) return;
  // Clear previous contract NPCs
  npcs_.erase(std::remove_if(npcs_.begin(), npcs_.end(), [](const NpcEntity& n) {
    return n.isContractTarget || n.isContractGuard;
  }), npcs_.end());

  activeContractIdx_ = idx;
  contractSeenByWitness_ = false;
  const auto& c = contracts_[static_cast<size_t>(idx)];
  const float gy = world.heightfield.sampleHeight(c.targetPos.x, c.targetPos.z);

  NpcEntity target;
  target.id = nextNpcId_++;
  target.kind = NpcModelKind::Business;
  target.pos = glm::vec3(c.targetPos.x, gy + 0.05f, c.targetPos.z);
  target.homePos = target.pos;
  target.hp = 120.0f;
  target.maxHp = 120.0f;
  target.isContractTarget = true;
  target.contractIdx = idx;
  target.colorTint = glm::vec3(1.0f, 0.85f, 0.72f);
  npcs_.push_back(target);

  for (int g = 0; g < 2; ++g) {
    NpcEntity guard;
    guard.id = nextNpcId_++;
    guard.kind = NpcModelKind::Security;
    const float gx = c.targetPos.x + (g == 0 ? -3.2f : 3.2f);
    const float gz = c.targetPos.z + 2.4f;
    guard.pos = glm::vec3(gx, world.heightfield.sampleHeight(gx, gz) + 0.05f, gz);
    guard.homePos = guard.pos;
    guard.hp = 110.0f;
    guard.maxHp = 110.0f;
    guard.isContractGuard = true;
    guard.contractIdx = idx;
    npcs_.push_back(guard);
  }

  setGpsWaypoint(target.pos, c.code + ": " + c.targetName);
  pushToast("Contract Active: Eliminate " + c.targetName + " in " + c.district, 4.0f);
}

void GameSession::startStreetRace(int idx, PlayerController& player, const WorldData& world) {
  if (idx < 0 || idx >= static_cast<int>(races_.size())) return;
  // Clear prior race opponents
  vehicles_.erase(std::remove_if(vehicles_.begin(), vehicles_.end(), [](const VehicleEntity& v) {
    return v.isRacer;
  }), vehicles_.end());

  activeRaceIdx_ = idx;
  raceCheckpointIdx_ = 0;
  raceElapsed_ = 0.0f;
  racePlace_ = 1;

  const auto& race = races_[static_cast<size_t>(idx)];
  // Place player in a Ferrari if on foot
  if (activeVehicleIdx_ < 0) {
    VehicleEntity playerCar;
    playerCar.id = nextVehicleId_++;
    playerCar.kind = VehicleModelKind::Ferrari;
    playerCar.pos = glm::vec3(race.startPos.x, world.heightfield.sampleHeight(race.startPos.x, race.startPos.z) + 0.05f, race.startPos.z);
    playerCar.yawRad = race.startYaw;
    playerCar.colorTint = glm::vec3(0.95f, 0.16f, 0.14f);
    playerCar.maxSpeed = 52.0f;
    playerCar.accel = 30.0f;
    playerCar.occupiedByPlayer = true;
    vehicles_.push_back(playerCar);
    activeVehicleIdx_ = static_cast<int>(vehicles_.size() - 1);
  } else {
    auto& pv = vehicles_[static_cast<size_t>(activeVehicleIdx_)];
    pv.pos = glm::vec3(race.startPos.x, world.heightfield.sampleHeight(race.startPos.x, race.startPos.z) + 0.05f, race.startPos.z);
    pv.yawRad = race.startYaw;
    pv.speed = 0.0f;
  }
  player.teleport(vehicles_[static_cast<size_t>(activeVehicleIdx_)].pos + glm::vec3(0.0f, 1.0f, 0.0f), glm::degrees(race.startYaw));

  // Spawn 3 AI rival racers
  const VehicleModelKind rivalKinds[3] = {VehicleModelKind::Mustang, VehicleModelKind::Ferrari, VehicleModelKind::Sedan};
  const glm::vec3 rivalColors[3] = {{0.12f, 0.55f, 0.96f}, {0.98f, 0.78f, 0.12f}, {0.16f, 0.85f, 0.42f}};
  for (int i = 0; i < 3; ++i) {
    VehicleEntity rv;
    rv.id = nextVehicleId_++;
    rv.kind = rivalKinds[i];
    const float offX = static_cast<float>((i - 1) * 4.2f);
    const float rx = race.startPos.x + offX;
    const float rz = race.startPos.z - 4.5f;
    rv.pos = glm::vec3(rx, world.heightfield.sampleHeight(rx, rz) + 0.05f, rz);
    rv.yawRad = race.startYaw;
    rv.colorTint = rivalColors[i];
    rv.isRacer = true;
    rv.racerCheckpoint = 0;
    rv.maxSpeed = 39.0f + static_cast<float>(i) * 2.8f;
    vehicles_.push_back(rv);
  }

  setGpsWaypoint(race.checkpoints[0], race.name + " CP 1");
  pushToast("RACE STARTED: " + race.name + "! Drive through the glowing gates!", 4.0f);
}

void GameSession::cancelRace() {
  activeRaceIdx_ = -1;
  vehicles_.erase(std::remove_if(vehicles_.begin(), vehicles_.end(), [](const VehicleEntity& v) {
    return v.isRacer;
  }), vehicles_.end());
}

bool GameSession::buyWeaponOrAmmo(int slotIdx, AudioEngine* audio) {
  if (slotIdx < 1 || slotIdx >= static_cast<int>(weapons_.size())) return false;
  auto& w = weapons_[static_cast<size_t>(slotIdx)];
  if (!w.unlocked) {
    if (playerCash_ < w.price) {
      pushToast("Need $" + std::to_string(w.price) + " for " + w.name, 2.5f);
      return false;
    }
    playerCash_ -= w.price;
    w.unlocked = true;
    w.magAmmo = w.magSize;
    w.reserveAmmo = w.reserveMax;
    activeWeapon_ = slotIdx;
    if (audio) audio->playCashChime();
    pushToast("Purchased " + w.name + "!", 3.0f);
    return true;
  }
  if (w.reserveAmmo >= w.reserveMax && w.magAmmo >= w.magSize) {
    pushToast(w.shortName + " ammo is full.", 2.0f);
    return false;
  }
  if (playerCash_ < w.ammoPrice) {
    pushToast("Need $" + std::to_string(w.ammoPrice) + " for ammo.", 2.5f);
    return false;
  }
  playerCash_ -= w.ammoPrice;
  w.magAmmo = w.magSize;
  w.reserveAmmo = w.reserveMax;
  if (audio) audio->playCashChime();
  pushToast("Refilled " + w.shortName + " ammo.", 2.5f);
  return true;
}

bool GameSession::buyArmorAndMedkit(AudioEngine* audio) {
  constexpr int kCost = 150;
  if (playerHp_ >= playerMaxHp_ && playerArmor_ >= 100.0f) {
    pushToast("HP & Armor already full.", 2.0f);
    return false;
  }
  if (playerCash_ < kCost) {
    pushToast("Need $150 for Medkit + Armor.", 2.5f);
    return false;
  }
  playerCash_ -= kCost;
  playerHp_ = playerMaxHp_;
  playerArmor_ = 100.0f;
  if (audio) audio->playCashChime();
  pushToast("Restored 100 HP & 100 Armor (-$150)", 3.0f);
  return true;
}

void GameSession::reportCrime(CrimeKind kind, const glm::vec3& pos, const WorldData& world) {
  float addHeat = 0.0f;
  switch (kind) {
    case CrimeKind::Gunfire: addHeat = 0.55f; break;
    case CrimeKind::Assault: addHeat = 0.75f; break;
    case CrimeKind::Carjack: addHeat = 1.0f; break;
    case CrimeKind::Robbery: addHeat = 1.8f; break;
    case CrimeKind::CopHit: addHeat = 1.4f; break;
  }
  wantedHeat_ = std::min(5.0f, wantedHeat_ + addHeat);
  const int newStars = std::clamp(static_cast<int>(std::ceil(wantedHeat_)), 0, 5);
  if (newStars > wantedStars_) {
    wantedStars_ = newStars;
    pushToast("WANTED LEVEL " + std::to_string(wantedStars_) + " STAR" + (wantedStars_ > 1 ? "S" : "") + "!", 3.0f);
  }
  wantedEvadeTimer_ = 0.0f;

  // Alert nearby pedestrians
  for (auto& npc : npcs_) {
    if (!npc.alive || npc.isPolice || npc.isContractGuard) continue;
    if (glm::distance(npc.pos, pos) < 34.0f) {
      npc.fleeing = true;
      if (activeContractIdx_ >= 0 && npc.isContractTarget == false) {
        contractSeenByWitness_ = true;
      }
    }
  }
  (void)world;
}

void GameSession::damagePlayer(float amount, const WorldData& world, PlayerController& player, AudioEngine* audio) {
  if (amount <= 0.0f || playerDodgeTimer_ > 0.14f) return;
  float rem = amount;
  if (playerArmor_ > 0.0f) {
    const float absorbed = std::min(playerArmor_, rem * 0.7f);
    playerArmor_ -= absorbed;
    rem -= absorbed;
  }
  playerHp_ -= rem;
  playerHitFlash_ = 1.0f;
  if (playerAttackClip_.empty() && amount >= 7.0f) {
    playerHitAnimTimer_ = 0.34f;
  }
  if (audio) audio->playImpact(0.7f);

  if (playerHp_ <= 0.0f) {
    // Respawn at St. Jude's Medical Center (-146, -206), clear wanted
    playerHp_ = 100.0f;
    playerArmor_ = 25.0f;
    wantedStars_ = 0;
    wantedHeat_ = 0.0f;
    playerCash_ = std::max(0, playerCash_ - 100);
    const float medY = world.heightfield.sampleHeight(-146.0f, -206.0f) + 1.0f;
    teleportTo({-146.0f, medY, -206.0f}, 180.0f, player);
    pushToast("Wasted! Treated at St. Jude's Medical Center (-$100)", 4.5f);
  }
}

void GameSession::fireActiveWeapon(const PlayerController& player, PhysicsWorld& physics, const WorldData& world, AudioEngine* audio) {
  auto& w = weapons_[static_cast<size_t>(activeWeapon_)];
  if (w.isMelee || !w.unlocked || reloadTimer_ > 0.0f) return;
  if (w.magAmmo <= 0) {
    if (w.reserveAmmo > 0) reloadTimer_ = w.reloadTime;
    return;
  }

  w.magAmmo--;
  fireCooldown_ = 60.0f / std::max(30.0f, w.rpm);
  muzzleFlashTimer_ = 0.055f;
  const float kickAdd = (w.id == "shotgun" || w.id == "sniper") ? 0.95f : (w.id == "carbine" || w.id == "smg") ? 0.42f : 0.55f;
  recoilImpulse_ = std::min(1.0f, recoilImpulse_ + kickAdd);
  if (audio) audio->playGunshot(w.suppressed, 1.0f);

  const glm::vec3 camPos = cameraPosition(player);
  const glm::vec3 camTgt = cameraTarget(player);
  const glm::vec3 aimDir = glm::normalize(camTgt - camPos);
  const glm::vec3 muzzle = player.position() + glm::vec3(0.0f, 1.42f, 0.0f) + aimDir * 0.65f;
  muzzleFlashPos_ = muzzle;
  const float spread = aiming_ ? w.adsSpread : w.spread;

  bool hitAnything = false;
  for (int p = 0; p < w.pellets; ++p) {
    rng_ = rng_ * 1664525u + 1013904223u;
    const float rx = (static_cast<float>((rng_ >> 8) & 0xFFFF) / 32768.0f - 1.0f) * spread;
    rng_ = rng_ * 1664525u + 1013904223u;
    const float ry = (static_cast<float>((rng_ >> 8) & 0xFFFF) / 32768.0f - 1.0f) * spread;
    const glm::vec3 right = glm::normalize(glm::cross(aimDir, glm::vec3(0.0f, 1.0f, 0.0f)));
    const glm::vec3 up = glm::normalize(glm::cross(right, aimDir));
    const glm::vec3 rayDir = glm::normalize(aimDir + right * rx + up * ry);

    constexpr float kMaxRange = 160.0f;
    const RaycastHit worldHit = physics.raycast(camPos, rayDir, kMaxRange);
    float bestT = worldHit.hit ? worldHit.distance : kMaxRange;

    int hitNpcIdx = -1;
    bool hitIronOpp = false;

    for (size_t ni = 0; ni < npcs_.size(); ++ni) {
      const auto& npc = npcs_[ni];
      if (!npc.alive) continue;
      const float t = raySphereHit(camPos, rayDir, npc.pos + glm::vec3(0.0f, 0.95f, 0.0f), 0.68f);
      if (t > 0.5f && t < bestT) {
        bestT = t;
        hitNpcIdx = static_cast<int>(ni);
        hitIronOpp = false;
      }
    }

    if (!ironPit_.defeated) {
      const float tPit = raySphereHit(camPos, rayDir, ironPit_.pos + glm::vec3(0.0f, 0.95f, 0.0f), 0.72f);
      if (tPit > 0.5f && tPit < bestT) {
        bestT = tPit;
        hitNpcIdx = -1;
        hitIronOpp = true;
      }
    }

    const glm::vec3 endPt = camPos + rayDir * bestT;
    tracers_.push_back({muzzle, endPt, w.suppressed ? glm::vec3(0.65f, 0.92f, 1.0f) : glm::vec3(1.0f, 0.85f, 0.30f), 0.085f});
    if (worldHit.hit && hitNpcIdx < 0 && !hitIronOpp) {
      spawnSparks(worldHit.position, worldHit.normal, {1.0f, 0.78f, 0.32f}, 5);
      physics.applyImpulseNear(worldHit.position, rayDir * (w.damage * 0.65f), 1.6f);
    }

    if (hitNpcIdx >= 0) {
      hitAnything = true;
      auto& npc = npcs_[static_cast<size_t>(hitNpcIdx)];
      npc.hp -= w.damage;
      npc.hitFlash = 1.0f;
      if (npc.isPolice) reportCrime(CrimeKind::CopHit, npc.pos, world);
      else if (!npc.isContractTarget && !npc.isContractGuard) reportCrime(CrimeKind::Assault, npc.pos, world);

      if (npc.hp <= 0.0f && npc.alive) {
        npc.alive = false;
        npc.deadTimer = 0.0f;
        npc.animClip = "knockdown";
        npc.animTime = 0.0f;
        if (npc.isContractTarget && npc.contractIdx >= 0 && npc.contractIdx == activeContractIdx_) {
          auto& c = contracts_[static_cast<size_t>(npc.contractIdx)];
          c.completed = true;
          const int bonus = contractSeenByWitness_ ? 0 : c.unseenBonus;
          const int total = c.rewardBase + bonus;
          playerCash_ += total;
          if (audio) audio->playCashChime();
          pushToast("CONTRACT COMPLETE: " + c.targetName + " +$" + std::to_string(total), 5.0f);
          activeContractIdx_ = -1;
        } else {
          playerCash_ += npc.isPolice ? 120 : 45;
        }
      }
    } else if (hitIronOpp) {
      hitAnything = true;
      ironPit_.hp = std::max(0.0f, ironPit_.hp - w.damage);
      ironPit_.hitFlash = 1.0f;
      if (ironPit_.hp <= 0.0f) {
        ironPit_.defeated = true;
        ironPit_.animClip = "knockdown";
        ironPit_.animTime = 0.0f;
        ironPit_.wins++;
        playerCash_ += ironPit_.purse;
        if (audio) audio->playCashChime();
        pushToast("IRON PIT KO! Won $" + std::to_string(ironPit_.purse) + "! Press [R] for next tier.", 4.5f);
      }
    }
  }

  if (hitAnything) {
    hitmarkerTimer_ = 0.18f;
    if (audio) audio->playImpact(0.5f);
  }
  if (!w.suppressed) {
    reportCrime(CrimeKind::Gunfire, player.position(), world);
  }
}

int GameSession::findTakedownNpcIndex(const glm::vec3& playerPos) const {
  if (inVehicle()) return -1;
  int bestIdx = -1;
  float bestD = 2.4f;
  for (size_t i = 0; i < npcs_.size(); ++i) {
    const auto& n = npcs_[i];
    if (!n.alive || n.fleeing) continue;
    if (std::abs(n.pos.y - playerPos.y) > 1.35f) continue;
    const float d = glm::distance(glm::vec2(playerPos.x, playerPos.z), glm::vec2(n.pos.x, n.pos.z));
    if (d >= bestD) continue;
    const float toPX = (playerPos.x - n.pos.x) / std::max(0.01f, d);
    const float toPZ = (playerPos.z - n.pos.z) / std::max(0.01f, d);
    const float nFwdX = std::sin(n.yawRad);
    const float nFwdZ = std::cos(n.yawRad);
    if (nFwdX * toPX + nFwdZ * toPZ > (n.isPolice && wantedStars_ > 0 ? 0.15f : 0.38f)) continue;
    bestD = d;
    bestIdx = static_cast<int>(i);
  }
  return bestIdx;
}

bool GameSession::trySilentTakedown(PlayerController& player, const WorldData& world, AudioEngine* audio) {
  if (takedownCooldown_ > 0.0f || inVehicle()) return false;
  const int idx = findTakedownNpcIndex(player.position());
  if (idx < 0) return false;

  auto& target = npcs_[static_cast<size_t>(idx)];
  target.alive = false;
  target.hp = 0.0f;
  target.animClip = "knockdown";
  target.animTime = 0.0f;

  takedownCooldown_ = 0.55f;
  playerAttackClip_ = "hook";
  playerAttackTimer_ = 0.0f;
  playerAttackHitDone_ = true;
  hitmarkerTimer_ = 0.22f;
  stealthKills_++;
  playerCash_ += 65;

  bool witnessed = false;
  for (size_t i = 0; i < npcs_.size(); ++i) {
    if (static_cast<int>(i) == idx) continue;
    const auto& other = npcs_[i];
    if (!other.alive) continue;
    const float od = glm::distance(target.pos, other.pos);
    if (od > 16.0f) continue;
    const float toTX = (target.pos.x - other.pos.x) / std::max(0.01f, od);
    const float toTZ = (target.pos.z - other.pos.z) / std::max(0.01f, od);
    if (std::sin(other.yawRad) * toTX + std::cos(other.yawRad) * toTZ > 0.25f) {
      witnessed = true;
      break;
    }
  }

  if (audio) audio->playSpatialImpact(target.pos, 0.45f);
  if (witnessed) {
    reportCrime(target.isPolice ? CrimeKind::CopHit : CrimeKind::Assault, target.pos, world);
    pushToast("TAKEDOWN WITNESSED! +$65", 2.4f);
  } else {
    pushToast("SILENT TAKEDOWN +$65", 2.0f);
  }
  return true;
}

void GameSession::updateTrafficAndVehicles(float dt, const GameInputFrame& input, PlayerController& player, PhysicsWorld& physics, const WorldData& world, AudioEngine* audio) {
  // Enter / Exit nearest vehicle on G
  if (input.interactPressed) {
    if (activeVehicleIdx_ >= 0) {
      auto& v = vehicles_[static_cast<size_t>(activeVehicleIdx_)];
      v.occupiedByPlayer = false;
      v.speed *= 0.45f;
      const glm::vec3 leftDir(-std::cos(v.yawRad), 0.0f, std::sin(v.yawRad));
      glm::vec3 exitPos = v.pos + leftDir * 2.1f;
      exitPos.y = world.heightfield.sampleHeight(exitPos.x, exitPos.z) + 0.5f;
      player.teleport(exitPos, glm::degrees(v.yawRad));
      activeVehicleIdx_ = -1;
    } else {
      const glm::vec3 pPos = player.position();
      int bestIdx = -1;
      float bestDist = 4.6f;
      for (size_t i = 0; i < vehicles_.size(); ++i) {
        if (vehicles_[i].isRacer) continue;
        const float d = glm::distance(pPos, vehicles_[i].pos);
        if (d < bestDist) {
          bestDist = d;
          bestIdx = static_cast<int>(i);
        }
      }
      if (bestIdx >= 0) {
        auto& v = vehicles_[static_cast<size_t>(bestIdx)];
        if (v.isAmbientTraffic || v.isPolicePursuit) {
          reportCrime(CrimeKind::Carjack, v.pos, world);
        }
        v.isAmbientTraffic = false;
        v.isPolicePursuit = false;
        v.occupiedByPlayer = true;
        activeVehicleIdx_ = bestIdx;
        if (v.isAircraft) {
          pushToast("HELICOPTER: [WASD] Fly/Yaw | [Space] Climb | [C] Descend | [G] Exit", 4.0f);
        } else if (v.isBoat) {
          pushToast("BOAT: [WASD] Throttle/Steer | [Space] Reverse Brake | [G] Exit", 3.5f);
        } else {
          pushToast("Driving vehicle - [WASD] Drive | [Space] Brake | [H] Horn/Siren | [G] Exit", 3.0f);
        }
      }
    }
  }

  const glm::vec3 pPos = player.position();

  for (size_t vi = 0; vi < vehicles_.size(); ++vi) {
    auto& v = vehicles_[vi];
    if (v.isAircraft) {
      v.rotorAngleRad += dt * (v.occupiedByPlayer ? 28.0f : 3.5f);
    }
    if (v.occupiedByPlayer) {
      if (v.isAircraft) {
        // Flyable Helicopter 6-DOF Physics ([Space] climb, [C] descend, [WASD] forward/yaw)
        const float collective = (input.moveInput.jump ? 1.0f : 0.0f) - (input.moveInput.crouch ? 1.0f : 0.0f);
        const float thrust = input.moveInput.moveForward;
        const float yawInput = -input.moveInput.moveRight;
        v.yawRad = wrapAnglePi(v.yawRad + yawInput * 1.95f * dt);
        v.speed = std::clamp(v.speed + thrust * v.accel * dt, -14.0f, v.maxSpeed);
        v.speed *= (1.0f - std::min(1.0f, 0.85f * dt));
        v.verticalVel = std::clamp(v.verticalVel + (collective * 16.0f - v.verticalVel * 2.2f) * dt, -18.0f, 22.0f);

        v.pitchRad = thrust * 0.20f;
        v.rollRad = yawInput * -0.22f;

        const glm::vec3 fwd(std::sin(v.yawRad), 0.0f, std::cos(v.yawRad));
        v.pos += fwd * (v.speed * dt);
        v.pos.x = std::clamp(v.pos.x, world.worldMin + 20.0f, world.worldMax - 20.0f);
        v.pos.z = std::clamp(v.pos.z, world.worldMin + 20.0f, world.worldMax - 20.0f);
        const float floorY = std::max(0.2f, world.heightfield.sampleHeight(v.pos.x, v.pos.z)) + 0.05f;
        v.pos.y = std::clamp(v.pos.y + v.verticalVel * dt, floorY, 320.0f);
        if (v.pos.y <= floorY + 0.02f && v.verticalVel < 0.0f) {
          v.verticalVel = 0.0f;
          v.pitchRad *= 0.2f;
          v.rollRad *= 0.2f;
        }
        player.teleport(v.pos + glm::vec3(0.0f, 1.0f, 0.0f), glm::degrees(v.yawRad));
        continue;
      }

      if (v.isBoat) {
        // Wave-buoyant Speedboat / Cruiser Physics
        const float throttle = input.moveInput.moveForward;
        const float steer = -input.moveInput.moveRight;
        if (input.moveInput.jump) {
          v.speed *= (1.0f - std::min(1.0f, 4.5f * dt));
        } else if (std::abs(throttle) > 0.01f) {
          v.speed = std::clamp(v.speed + throttle * v.accel * dt, -10.0f, v.maxSpeed);
        } else {
          v.speed *= (1.0f - std::min(1.0f, 1.4f * dt));
        }
        const float turnAmt = std::clamp(std::abs(v.speed) / 4.0f, 0.25f, 1.0f) * (v.speed >= 0.0f ? 1.0f : -1.0f);
        v.yawRad = wrapAnglePi(v.yawRad + steer * 1.85f * turnAmt * dt);
        const glm::vec3 fwd(std::sin(v.yawRad), 0.0f, std::cos(v.yawRad));
        const glm::vec3 nextXZ = v.pos + fwd * (v.speed * dt);
        const float terrainNext = world.heightfield.sampleHeight(nextXZ.x, nextXZ.z);
        if (terrainNext < -0.25f) {
          v.pos.x = std::clamp(nextXZ.x, world.worldMin + 15.0f, world.worldMax - 15.0f);
          v.pos.z = std::clamp(nextXZ.z, world.worldMin + 15.0f, world.worldMax - 15.0f);
        } else {
          v.speed *= -0.25f;
        }
        const float wH = oceanWaveHeight(v.pos.x, v.pos.z, animClock_);
        const float wFwd = oceanWaveHeight(v.pos.x + fwd.x * 2.0f, v.pos.z + fwd.z * 2.0f, animClock_);
        v.pos.y = wH + 0.05f;
        v.pitchRad = std::atan2(wFwd - wH, 2.0f) - std::clamp(v.speed / v.maxSpeed, 0.0f, 1.0f) * 0.08f;
        v.rollRad = steer * -0.14f * std::clamp(std::abs(v.speed) / 18.0f, 0.0f, 1.0f);
        if (std::abs(v.speed) > 9.0f && static_cast<int>(animClock_ * 20.0f) % 2 == 0) {
          spawnSparks(v.pos - fwd * 2.3f + glm::vec3(0.0f, 0.2f, 0.0f), {0.0f, 0.8f, 0.0f}, {0.82f, 0.94f, 1.0f}, 2);
        }
        player.teleport(v.pos + glm::vec3(0.0f, 0.65f, 0.0f), glm::degrees(v.yawRad));
        continue;
      }

      // Player ground car driving physics
      const float throttle = input.moveInput.moveForward;
      const float steer = -input.moveInput.moveRight; // +yaw is left
      if (input.moveInput.jump) {
        // Handbrake
        v.speed = std::max(0.0f, std::abs(v.speed) - 34.0f * dt) * (v.speed >= 0.0f ? 1.0f : -1.0f);
      } else if (std::abs(throttle) > 0.01f) {
        v.speed = std::clamp(v.speed + throttle * v.accel * dt, -14.0f, v.maxSpeed);
      } else {
        const float drag = std::min(1.0f, 2.2f * dt);
        v.speed *= (1.0f - drag);
      }

      if (input.secondaryAction && sirenCooldown_ <= 0.0f) {
        sirenCooldown_ = 0.32f;
        if (audio) audio->playSirenPulse();
      }

      const float steerFactor = std::clamp(std::abs(v.speed) / 6.0f, 0.0f, 1.0f) * (v.speed >= 0.0f ? 1.0f : -1.0f);
      v.yawRad = wrapAnglePi(v.yawRad + steer * 2.25f * steerFactor * dt);
      const glm::vec3 fwd(std::sin(v.yawRad), 0.0f, std::cos(v.yawRad));

      const glm::vec3 nextXZ = v.pos + fwd * (v.speed * dt);
      // Real Jolt collision sweep against buildings/trees/pit walls + dynamic rigid-body crate/barrel smashing
      if (std::abs(v.speed) > 0.3f) {
        glm::vec3 pushXZ(0.0f);
        float impactScale = 1.0f;
        if (physics.resolveVehicleCollision(nextXZ, 2.15f, pushXZ, impactScale)) {
          v.pos.x = std::clamp(nextXZ.x + pushXZ.x, world.worldMin + 15.0f, world.worldMax - 15.0f);
          v.pos.z = std::clamp(nextXZ.z + pushXZ.z, world.worldMin + 15.0f, world.worldMax - 15.0f);
          if (std::abs(v.speed) > 8.0f) {
            spawnSparks(v.pos + fwd * 1.6f + glm::vec3(0.0f, 0.7f, 0.0f), -fwd, {1.0f, 0.72f, 0.25f}, 7);
            if (audio) audio->playVehicleCrash(std::min(1.1f, std::abs(v.speed) / 28.0f));
          }
          v.speed *= -0.32f;
        } else {
          v.pos.x = std::clamp(nextXZ.x, world.worldMin + 15.0f, world.worldMax - 15.0f);
          v.pos.z = std::clamp(nextXZ.z, world.worldMin + 15.0f, world.worldMax - 15.0f);
        }
        // Knock dynamic Jolt crates & barrels flying on impact!
        if (std::abs(v.speed) > 2.5f) {
          physics.applyImpulseNear(v.pos + fwd * 1.2f, fwd * (v.speed * 1.4f), 2.8f);
        }
      }

      // Check elevated bridge decks via Jolt raycast before falling back to terrain heightfield
      float groundY = world.heightfield.sampleHeight(v.pos.x, v.pos.z);
      const RaycastHit deckHit = physics.raycast(glm::vec3(v.pos.x, v.pos.y + 3.2f, v.pos.z), glm::vec3(0.0f, -1.0f, 0.0f), 18.0f);
      if (deckHit.hit && deckHit.position.y > groundY + 0.35f) {
        groundY = deckHit.position.y;
      }
      // Stunt jump ramp check & airtime tracking
      if (!v.airborne) {
        for (auto& sj : stuntJumps_) {
          if (glm::distance(glm::vec2(v.pos.x, v.pos.z), glm::vec2(sj.pos.x, sj.pos.z)) < 5.5f && std::abs(v.speed) > 16.0f) {
            v.airborne = true;
            v.airStartPos = v.pos;
            v.airPeakY = v.pos.y;
            v.pos.y += 3.2f;
            break;
          }
        }
      }
      if (v.airborne) {
        v.pos.y += (8.5f - 9.8f * 0.45f) * dt;
        v.airPeakY = std::max(v.airPeakY, v.pos.y);
        if (v.pos.y <= groundY + 0.06f) {
          v.pos.y = groundY + 0.05f;
          v.airborne = false;
          const float dist = glm::distance(glm::vec2(v.airStartPos.x, v.airStartPos.z), glm::vec2(v.pos.x, v.pos.z));
          if (dist > 14.0f) {
            const int bonus = static_cast<int>(dist * 15.0f);
            playerCash_ += bonus;
            if (audio) audio->playCashChime();
            pushToast("STUNT JUMP " + std::to_string(static_cast<int>(dist)) + "m! +$" + std::to_string(bonus), 4.0f);
          }
        }
      } else {
        v.pos.y = groundY + 0.05f;
      }

      player.teleport(v.pos + glm::vec3(0.0f, 0.55f, 0.0f), glm::degrees(v.yawRad));
    } else if (v.isPolicePursuit) {
      // Pursuing police cruiser steers toward player
      const glm::vec3 toP = pPos - v.pos;
      const float dist = glm::length(glm::vec2(toP.x, toP.z));
      if (dist > 10.0f) {
        const float targetYaw = std::atan2(toP.x, toP.z);
        v.yawRad = moveTowardAngle(v.yawRad, targetYaw, 2.4f * dt);
        v.speed = std::min(v.maxSpeed, 25.0f + static_cast<float>(wantedStars_) * 2.5f);
        const glm::vec3 fwd(std::sin(v.yawRad), 0.0f, std::cos(v.yawRad));
        v.pos += fwd * (v.speed * dt);
        v.pos.y = world.heightfield.sampleHeight(v.pos.x, v.pos.z) + 0.05f;
      } else {
        v.speed *= 0.85f;
      }
    } else if (v.isRacer && activeRaceIdx_ >= 0) {
      const auto& race = races_[static_cast<size_t>(activeRaceIdx_)];
      if (v.racerCheckpoint < static_cast<int>(race.checkpoints.size())) {
        const glm::vec3 cp = race.checkpoints[static_cast<size_t>(v.racerCheckpoint)];
        const glm::vec3 toCp = cp - v.pos;
        const float dist = glm::length(glm::vec2(toCp.x, toCp.z));
        const float targetYaw = std::atan2(toCp.x, toCp.z);
        v.yawRad = moveTowardAngle(v.yawRad, targetYaw, 2.8f * dt);
        v.speed = std::min(v.maxSpeed, v.speed + 18.0f * dt);
        const glm::vec3 fwd(std::sin(v.yawRad), 0.0f, std::cos(v.yawRad));
        v.pos += fwd * (v.speed * dt);
        v.pos.y = world.heightfield.sampleHeight(v.pos.x, v.pos.z) + 0.05f;
        if (dist < 11.0f) {
          v.racerCheckpoint++;
        }
      }
    } else if (v.isAmbientTraffic && v.roadIdx < world.roads.size()) {
      const auto& seg = world.roads[v.roadIdx];
      if (seg.samples.size() >= 2) {
        const float maxS = static_cast<float>(seg.samples.size() - 1);
        v.samplePos += (v.forward ? 1.0f : -1.0f) * (v.speed / 12.0f) * dt;
        if (v.samplePos >= maxS) { v.samplePos = maxS - 0.01f; v.forward = false; }
        if (v.samplePos <= 0.0f) { v.samplePos = 0.01f; v.forward = true; }

        const size_t i0 = std::min<size_t>(static_cast<size_t>(v.samplePos), seg.samples.size() - 2);
        const float f = std::clamp(v.samplePos - static_cast<float>(i0), 0.0f, 1.0f);
        const auto& s0 = seg.samples[i0];
        const auto& s1 = seg.samples[i0 + 1];
        const glm::vec3 p = glm::mix(s0.pos, s1.pos, f);
        const glm::vec3 delta = s1.pos - s0.pos;
        const float dLen = glm::length(delta);
        const glm::vec3 dir = (dLen > 1e-4f) ? ((v.forward ? 1.0f : -1.0f) * (delta / dLen)) : glm::vec3(0.0f, 0.0f, 1.0f);
        const glm::vec3 laneOffset = glm::vec3(s0.rx, 0.0f, s0.rz) * (v.forward ? 2.2f : -2.2f);
        const glm::vec3 wp = p + laneOffset;
        const float roadY = seg.isBridge ? wp.y : world.heightfield.sampleHeight(wp.x, wp.z);
        v.pos = glm::vec3(wp.x, roadY + 0.05f, wp.z);
        v.yawRad = std::atan2(dir.x, dir.z);
      }
    } else if (v.isBoat) {
      v.pos.y = oceanWaveHeight(v.pos.x, v.pos.z, animClock_) + 0.05f;
    }
  }
}

void GameSession::updateNpcsAndPolice(float dt, PlayerController& player, PhysicsWorld& physics, const WorldData& world, AudioEngine* audio) {
  const glm::vec3 pPos = player.position();

  // Wanted spawn & evade logic
  if (wantedStars_ > 0) {
    policeSpawnCooldown_ -= dt;
    int activeCops = 0;
    bool copClose = false;
    for (const auto& n : npcs_) {
      if (n.alive && n.isPolice) {
        ++activeCops;
        if (glm::distance(n.pos, pPos) < 42.0f) copClose = true;
      }
    }
    const int desiredCops = std::min(6, wantedStars_ * 2);
    if (activeCops < desiredCops && policeSpawnCooldown_ <= 0.0f) {
      policeSpawnCooldown_ = 4.0f;
      rng_ = rng_ * 1664525u + 1013904223u;
      const float ang = static_cast<float>(rng_ & 0xFFFF) / 65535.0f * 6.28318f;
      const float sx = std::clamp(pPos.x + std::cos(ang) * 34.0f, world.worldMin + 20.0f, world.worldMax - 20.0f);
      const float sz = std::clamp(pPos.z + std::sin(ang) * 34.0f, world.worldMin + 20.0f, world.worldMax - 20.0f);
      NpcEntity cop;
      cop.id = nextNpcId_++;
      cop.kind = NpcModelKind::Police;
      cop.isPolice = true;
      cop.pos = glm::vec3(sx, world.heightfield.sampleHeight(sx, sz) + 0.05f, sz);
      cop.homePos = cop.pos;
      cop.hp = 100.0f + static_cast<float>(wantedStars_) * 15.0f;
      cop.maxHp = cop.hp;
      npcs_.push_back(cop);
    }

    if (!copClose) {
      wantedEvadeTimer_ += dt;
      if (wantedEvadeTimer_ >= 18.0f) {
        const int bonus = wantedStars_ * 120;
        wantedStars_ = 0;
        wantedHeat_ = 0.0f;
        wantedEvadeTimer_ = 0.0f;
        playerCash_ += bonus;
        if (audio) audio->playCashChime();
        pushToast("WANTED EVADED! +$" + std::to_string(bonus), 3.5f);
        npcs_.erase(std::remove_if(npcs_.begin(), npcs_.end(), [](const NpcEntity& n) { return n.isPolice; }), npcs_.end());
      }
    } else {
      wantedEvadeTimer_ = std::max(0.0f, wantedEvadeTimer_ - dt * 0.5f);
    }
  }

  for (auto& n : npcs_) {
    n.hitFlash = std::max(0.0f, n.hitFlash - dt * 4.0f);
    n.animTime += dt;
    if (!n.alive) {
      n.deadTimer += dt;
      continue;
    }

    if (n.isPolice || (n.isContractGuard && activeContractIdx_ >= 0 && glm::distance(n.pos, pPos) < 26.0f && wantedStars_ > 0)) {
      const glm::vec3 toP = pPos - n.pos;
      const float dist = glm::length(glm::vec2(toP.x, toP.z));
      if (dist > 0.1f) n.yawRad = std::atan2(toP.x, toP.z);

      if (dist > 14.0f && dist < 80.0f) {
        const glm::vec2 dir = glm::normalize(glm::vec2(toP.x, toP.z));
        n.pos.x += dir.x * 4.4f * dt;
        n.pos.z += dir.y * 4.4f * dt;
        n.pos.y = world.heightfield.sampleHeight(n.pos.x, n.pos.z);
        n.animClip = "Run";
      } else {
        n.animClip = "Idle";
      }

      if (dist < 32.0f) {
        n.attackCooldown -= dt;
        if (n.attackCooldown <= 0.0f) {
          n.attackCooldown = std::max(0.7f, 1.85f - 0.2f * static_cast<float>(wantedStars_));
          const glm::vec3 eye = n.pos + glm::vec3(0.0f, 1.5f, 0.0f);
          const glm::vec3 pTarget = pPos + glm::vec3(0.0f, 1.25f, 0.0f);
          const glm::vec3 delta = pTarget - eye;
          const float dLen = glm::length(delta);
          const RaycastHit los = (dLen > 0.1f) ? physics.raycast(eye, delta / dLen, dLen) : RaycastHit{};
          if (!los.hit || los.distance > dLen * 0.92f) {
            if (audio) audio->playSpatialGunshot(eye, false, 1.1f);
            tracers_.push_back({eye, pTarget, {1.0f, 0.45f, 0.2f}, 0.09f});
            damagePlayer(6.0f + static_cast<float>(wantedStars_), world, player, audio);
          }
        }
      }
    } else if (n.fleeing) {
      const glm::vec3 away = n.pos - pPos;
      const float d = glm::length(glm::vec2(away.x, away.z));
      if (d > 0.1f && d < 55.0f) {
        const glm::vec2 dir = glm::normalize(glm::vec2(away.x, away.z));
        n.pos.x = std::clamp(n.pos.x + dir.x * 5.2f * dt, world.worldMin + 15.0f, world.worldMax - 15.0f);
        n.pos.z = std::clamp(n.pos.z + dir.y * 5.2f * dt, world.worldMin + 15.0f, world.worldMax - 15.0f);
        n.pos.y = world.heightfield.sampleHeight(n.pos.x, n.pos.z);
        n.yawRad = std::atan2(dir.x, dir.y);
        n.animClip = "Run";
      } else {
        n.fleeing = false;
        n.animClip = "Idle";
      }
    } else if (!n.isContractTarget && !n.isContractGuard && n.roadIdx < world.roads.size()) {
      const auto& seg = world.roads[n.roadIdx];
      if (seg.samples.size() >= 2) {
        const float maxS = static_cast<float>(seg.samples.size() - 1);
        const size_t curI = std::min<size_t>(static_cast<size_t>(n.samplePos), seg.samples.size() - 2);
        const float segLen = std::max(1.5f, glm::length(seg.samples[curI + 1].pos - seg.samples[curI].pos));
        const float walkMetersPerSec = 1.55f;
        n.samplePos += (n.forward ? 1.0f : -1.0f) * (walkMetersPerSec / segLen) * dt;
        if (n.samplePos >= maxS) { n.samplePos = maxS - 0.01f; n.forward = false; }
        if (n.samplePos <= 0.0f) { n.samplePos = 0.01f; n.forward = true; }
        const size_t i0 = std::min<size_t>(static_cast<size_t>(n.samplePos), seg.samples.size() - 2);
        const float f = std::clamp(n.samplePos - static_cast<float>(i0), 0.0f, 1.0f);
        const auto& s0 = seg.samples[i0];
        const auto& s1 = seg.samples[i0 + 1];
        const glm::vec3 p = glm::mix(s0.pos, s1.pos, f);
        const glm::vec3 delta = s1.pos - s0.pos;
        const float dLen = glm::length(delta);
        const glm::vec3 dir = (dLen > 1e-4f) ? ((n.forward ? 1.0f : -1.0f) * (delta / dLen)) : glm::vec3(0.0f, 0.0f, 1.0f);
        const glm::vec3 wp = p + glm::vec3(s0.rx, 0.0f, s0.rz) * (n.forward ? 6.5f : -6.5f);
        n.pos = glm::vec3(wp.x, world.heightfield.sampleHeight(wp.x, wp.z), wp.z);
        n.yawRad = std::atan2(dir.x, dir.z);
        n.animClip = "Walk";
      }
    } else {
      n.animClip = "Idle";
    }
  }

  // Cleanup long-dead non-contract NPCs
  npcs_.erase(std::remove_if(npcs_.begin(), npcs_.end(), [](const NpcEntity& n) {
    return !n.alive && !n.isContractTarget && n.deadTimer > 8.0f;
  }), npcs_.end());
}

bool GameSession::placeIronPitBet(int wager) {
  if (wager <= 0 || ironPit_.defeated || ironPit_.betActive || playerCash_ < wager) return false;
  playerCash_ -= wager;
  ironPit_.betWager = wager;
  ironPit_.betOdds = 1.45f + static_cast<float>(ironPit_.tier - 1) * 0.35f;
  ironPit_.betActive = true;
  pushToast("BOOKIE TICKET LOCKED: $" + std::to_string(wager) + " @ " + std::to_string(ironPit_.betOdds).substr(0, 4) + "x", 3.0f);
  return true;
}

bool GameSession::buyCutmanHeal() {
  if (playerHp_ >= playerMaxHp_ || playerCash_ < 50) return false;
  playerCash_ -= 50;
  playerHp_ = std::min(playerMaxHp_, playerHp_ + 75.0f);
  pushToast("CUTMAN PATCH-UP: +75 HP (-$50)", 2.5f);
  return true;
}

void GameSession::updateIronPit(float dt, const GameInputFrame& input, PlayerController& player, const WorldData& world, AudioEngine* audio) {
  const glm::vec3 pPos = player.position();
  const bool nearPit = glm::distance(glm::vec2(pPos.x, pPos.z), glm::vec2(world.fightPitPos.x, world.fightPitPos.z)) < 16.0f;
  const bool unarmed = weapons_[static_cast<size_t>(activeWeapon_)].isMelee;

  if (unarmed && nearPit && input.rematchPressed && !spectatorBout_.active) {
    const int nextTier = ironPit_.defeated ? (ironPit_.tier >= 5 ? 1 : ironPit_.tier + 1) : ironPit_.tier;
    spawnIronPitTier(nextTier, world);
    playerHp_ = playerMaxHp_;
    playerStamina_ = 100.0f;
    if (audio) audio->playPitBell(false);
    pushToast("IRON PIT TIER " + std::to_string(nextTier) + "/5: " + ironPit_.opponentName + "!", 3.0f);
  }

  auto tryStartMelee = [&](const std::string& clip, float stamCost) {
    if (!playerAttackClip_.empty() || playerStamina_ < stamCost) return;
    playerStamina_ = std::max(0.0f, playerStamina_ - stamCost);
    playerAttackClip_ = clip;
    playerAttackTimer_ = 0.0f;
    playerAttackHitDone_ = false;
  };

  if (!inVehicle() && unarmed) {
    if (inClinch_) {
      clinchTimer_ = std::max(0.0f, clinchTimer_ - dt);
      if (clinchTimer_ <= 0.0f || ironPit_.defeated || glm::distance(pPos, ironPit_.pos) > 3.0f) {
        inClinch_ = false;
      }
    }
    if (input.dodgePressed && playerAttackClip_.empty() && playerDodgeTimer_ <= 0.0f && playerStamina_ >= 14.0f) {
      inClinch_ = false;
      playerStamina_ -= 14.0f;
      playerDodgeTimer_ = 0.52f;
      playerAttackClip_ = "dodge";
      playerAttackTimer_ = 0.0f;
      playerAttackHitDone_ = true;
    } else if (input.grapplePressed) {
      if (!inClinch_ && !ironPit_.defeated && glm::distance(pPos, ironPit_.pos) < 2.45f && playerStamina_ >= 10.0f) {
        inClinch_ = true;
        clinchTimer_ = 4.2f;
        playerStamina_ -= 10.0f;
        ironPit_.attackCooldown = std::max(ironPit_.attackCooldown, 0.9f);
        if (audio) audio->playSpatialImpact(ironPit_.pos, 0.55f);
        pushToast("CLINCH LOCKED! [Z] Body Slam | [U] Choke | [LMB] Knee", 2.5f);
      } else if (inClinch_ && playerStamina_ >= 18.0f) {
        inClinch_ = false;
        tryStartMelee("uppercut", 18.0f);
        if (!ironPit_.defeated && glm::distance(pPos, ironPit_.pos) < 2.65f) {
          ironPit_.hp = std::max(0.0f, ironPit_.hp - 48.0f);
          ironPit_.hitFlash = 1.0f;
          ironPit_.attackCooldown = std::max(ironPit_.attackCooldown, 1.35f);
          hitmarkerTimer_ = 0.24f;
          spawnSparks(ironPit_.pos + glm::vec3(0.0f, 0.45f, 0.0f), {0.0f, 1.0f, 0.0f}, {0.95f, 0.82f, 0.52f}, 10);
          if (audio) audio->playSpatialImpact(ironPit_.pos, 1.6f);
          pushToast("BODY SLAM!", 1.8f);
          if (ironPit_.hp <= 0.0f) {
            ironPit_.defeated = true;
            ironPit_.animClip = "knockdown";
            ironPit_.animTime = 0.0f;
            ironPit_.wins++;
            const int streakPct = std::min(60, ironPit_.winStreak * 15);
            ironPit_.winStreak++;
            const int purseWon = static_cast<int>(std::round(static_cast<float>(ironPit_.purse) * (1.0f + static_cast<float>(streakPct) / 100.0f)));
            playerCash_ += purseWon;
            if (audio) {
              audio->playPitBell(true);
              audio->playCrowdCheer(0.95f);
              audio->playCashChime();
            }
            pushToast("SLAM KNOCKOUT! +$" + std::to_string(purseWon), 4.2f);
          } else {
            ironPit_.animClip = "hit";
            ironPit_.animTime = 0.0f;
          }
        }
      }
    } else if (input.takedownShootPressed && playerStamina_ >= 16.0f) {
      const bool wasClinch = inClinch_;
      inClinch_ = false;
      tryStartMelee("kick", 16.0f);
      if (!ironPit_.defeated && glm::distance(pPos, ironPit_.pos) < 2.65f) {
        const float wrestleDmg = wasClinch ? 44.0f : 36.0f;
        ironPit_.hp = std::max(0.0f, ironPit_.hp - wrestleDmg);
        ironPit_.hitFlash = 1.0f;
        ironPit_.attackCooldown = std::max(ironPit_.attackCooldown, 1.25f);
        hitmarkerTimer_ = 0.22f;
        spawnSparks(ironPit_.pos + glm::vec3(0.0f, 0.55f, 0.0f), {0.0f, 1.0f, 0.0f}, {0.88f, 0.85f, 0.78f}, 8);
        if (audio) audio->playSpatialImpact(ironPit_.pos, 1.35f);
        pushToast(wasClinch ? "GUILLOTINE CHOKE!" : "DOUBLE-LEG TAKEDOWN!", 1.8f);
        if (ironPit_.hp <= 0.0f) {
          ironPit_.defeated = true;
          ironPit_.animClip = "knockdown";
          ironPit_.animTime = 0.0f;
          ironPit_.wins++;
          const int streakPct = std::min(60, ironPit_.winStreak * 15);
          ironPit_.winStreak++;
          const int purseWon = static_cast<int>(std::round(static_cast<float>(ironPit_.purse) * (1.0f + static_cast<float>(streakPct) / 100.0f)));
          playerCash_ += purseWon;
          if (audio) {
            audio->playPitBell(true);
            audio->playCrowdCheer(0.95f);
            audio->playCashChime();
          }
          pushToast((wasClinch ? "SUBMISSION! +$" : "TAKEDOWN KO! +$") + std::to_string(purseWon), 4.2f);
        } else {
          ironPit_.animClip = "hit";
          ironPit_.animTime = 0.0f;
        }
      }
    } else if (input.firePressed) {
      const char* seq[3] = {"jab", "cross", "hook"};
      tryStartMelee(inClinch_ ? "kick" : seq[comboStep_ % 3], 11.0f);
      ++comboStep_;
    } else if (input.uppercutPressed) {
      tryStartMelee("uppercut", 17.0f);
    } else if (input.kickPressed) {
      tryStartMelee("kick", 19.0f);
    }
  } else {
    inClinch_ = false;
  }

  if (!playerAttackClip_.empty()) {
    const float clipDur = (playerAttackClip_ == "uppercut" || playerAttackClip_ == "kick") ? 0.85f
                        : (playerAttackClip_ == "dodge") ? 0.52f : 0.58f;
    playerAttackTimer_ += dt;
    if (!playerAttackHitDone_ && playerAttackTimer_ >= clipDur * 0.36f) {
      playerAttackHitDone_ = true;
      const float dmg = (playerAttackClip_ == "uppercut" || playerAttackClip_ == "kick") ? 28.0f : 17.0f;
      if (!ironPit_.defeated && glm::distance(pPos, ironPit_.pos) < 2.45f) {
        ironPit_.hp = std::max(0.0f, ironPit_.hp - dmg);
        ironPit_.hitFlash = 1.0f;
        hitmarkerTimer_ = 0.16f;
        spawnSparks(ironPit_.pos + glm::vec3(0.0f, 1.35f, 0.0f), {0.0f, 1.0f, 0.0f}, {1.0f, 0.85f, 0.4f}, 4);
        if (audio) audio->playSpatialImpact(ironPit_.pos, dmg / 20.0f);
        if (ironPit_.hp <= 0.0f) {
          ironPit_.defeated = true;
          ironPit_.animClip = "knockdown";
          ironPit_.animTime = 0.0f;
          ironPit_.wins++;
          const int streakPct = std::min(60, ironPit_.winStreak * 15);
          ironPit_.winStreak++;
          const int purseWon = static_cast<int>(std::round(static_cast<float>(ironPit_.purse) * (1.0f + static_cast<float>(streakPct) / 100.0f)));
          int betPayout = 0;
          if (ironPit_.betActive) {
            betPayout = static_cast<int>(std::round(static_cast<float>(ironPit_.betWager) * ironPit_.betOdds));
            ironPit_.betWins++;
            ironPit_.betProfit += (betPayout - ironPit_.betWager);
            ironPit_.betActive = false;
            ironPit_.betWager = 0;
          }
          playerCash_ += (purseWon + betPayout);
          if (audio) {
            audio->playPitBell(true);
            audio->playCrowdCheer(0.95f);
            audio->playCashChime();
          }
          pushToast("KNOCKOUT! +$" + std::to_string(purseWon + betPayout) + " - Press [R] for next tier!", 4.5f);
        } else {
          ironPit_.animClip = "hit";
          ironPit_.animTime = 0.0f;
        }
      } else {
        // Melee hits on world NPCs
        for (auto& npc : npcs_) {
          if (!npc.alive || glm::distance(pPos, npc.pos) >= 2.3f) continue;
          npc.hp -= dmg;
          npc.hitFlash = 1.0f;
          hitmarkerTimer_ = 0.16f;
          if (audio) audio->playImpact(0.9f);
          reportCrime(npc.isPolice ? CrimeKind::CopHit : CrimeKind::Assault, npc.pos, world);
          if (npc.hp <= 0.0f) {
            npc.alive = false;
            npc.animClip = "knockdown";
            npc.animTime = 0.0f;
            playerCash_ += 55;
          }
          break;
        }
      }
    }
    if (playerAttackTimer_ >= clipDur) playerAttackClip_.clear();
  }

  ironPit_.hitFlash = std::max(0.0f, ironPit_.hitFlash - dt * 4.0f);
  ironPit_.animTime += dt;
  if (!ironPit_.defeated) {
    const glm::vec3 toP = pPos - ironPit_.pos;
    const float dist = glm::length(glm::vec2(toP.x, toP.z));
    if (dist > 0.05f && nearPit) ironPit_.yawRad = std::atan2(toP.x, toP.z);

    const bool oppAttacking = (ironPit_.animClip == "jab" || ironPit_.animClip == "cross" ||
                               ironPit_.animClip == "hook" || ironPit_.animClip == "uppercut" ||
                               ironPit_.animClip == "kick");
    if (ironPit_.animClip == "hit" || ironPit_.animClip == "block" || oppAttacking) {
      const float dur = (ironPit_.animClip == "hit") ? 0.55f
                      : (ironPit_.animClip == "block") ? 0.65f
                      : (ironPit_.animClip == "uppercut" || ironPit_.animClip == "kick") ? 0.82f : 0.64f;
      if (oppAttacking && !ironPit_.hitApplied && ironPit_.animTime >= dur * 0.40f) {
        ironPit_.hitApplied = true;
        if (dist < 2.38f) {
          const float baseDmg = (ironPit_.animClip == "uppercut" || ironPit_.animClip == "kick") ? 17.0f : 12.0f;
          const float dmg = input.aimDown ? baseDmg * 0.28f : baseDmg;
          damagePlayer(dmg, world, player, audio);
        }
      }
      if (ironPit_.animTime >= dur) {
        ironPit_.animClip = "fight_idle";
        ironPit_.animTime = 0.0f;
      }
    } else if (nearPit && dist > 1.75f && dist < 9.5f) {
      const glm::vec2 dir = glm::normalize(glm::vec2(toP.x, toP.z));
      ironPit_.pos.x = std::clamp(ironPit_.pos.x + dir.x * 2.25f * dt, world.fightPitPos.x - 4.4f, world.fightPitPos.x + 4.4f);
      ironPit_.pos.z = std::clamp(ironPit_.pos.z + dir.y * 2.25f * dt, world.fightPitPos.z - 4.4f, world.fightPitPos.z + 4.4f);
      ironPit_.animClip = "Walk";
    } else {
      ironPit_.animClip = "fight_idle";
    }

    if (nearPit && dist <= 2.2f && ironPit_.animClip != "hit" && !oppAttacking && ironPit_.animClip != "block") {
      ironPit_.attackCooldown -= dt;
      if (ironPit_.attackCooldown <= 0.0f) {
        rng_ = rng_ * 1664525u + 1013904223u;
        if ((rng_ % 6) == 0 && ironPit_.tier >= 2) {
          ironPit_.animClip = "block";
        } else {
          static const char* kBossMoves[5] = {"jab", "cross", "hook", "uppercut", "kick"};
          const int maxMoves = std::min(5, 2 + ironPit_.tier);
          ironPit_.animClip = kBossMoves[(rng_ >> 4) % maxMoves];
        }
        ironPit_.animTime = 0.0f;
        ironPit_.hitApplied = false;
        ironPit_.attackCooldown = std::max(0.65f, 1.9f - 0.24f * static_cast<float>(ironPit_.tier));
      }
    }
  }
}

void GameSession::updateSpectatorBout(float dt, const WorldData& world, AudioEngine* audio) {
  if (!spectatorBout_.active) return;
  spectatorBout_.elapsed += dt;

  auto stepFighter = [&](SpectatorFighterState& self, SpectatorFighterState& opp, int corner) {
    self.hitFlash = std::max(0.0f, self.hitFlash - dt * 4.0f);
    self.animTime += dt;
    if (self.downed || spectatorBout_.winnerCorner >= 0) return;

    const glm::vec3 toOpp = opp.pos - self.pos;
    const float dist = glm::length(glm::vec2(toOpp.x, toOpp.z));
    if (dist > 0.05f) self.yawRad = std::atan2(toOpp.x, toOpp.z);

    const auto& def = pitRoster_[static_cast<size_t>(self.fighterIdx)];
    if (self.animClip == "jab" || self.animClip == "cross" || self.animClip == "hook" || self.animClip == "uppercut" || self.animClip == "kick") {
      const float dur = (self.animClip == "uppercut" || self.animClip == "kick") ? 0.80f : 0.56f;
      if (!self.hitApplied && self.animTime >= dur * 0.38f) {
        self.hitApplied = true;
        if (dist < 2.25f) {
          const float baseDmg = (self.animClip == "uppercut" || self.animClip == "kick") ? 22.0f : 14.0f;
          const float dmg = baseDmg * def.power;
          opp.hp = std::max(0.0f, opp.hp - dmg);
          opp.hitFlash = 1.0f;
          spawnSparks(opp.pos + glm::vec3(0.0f, 1.35f, 0.0f), {0.0f, 1.0f, 0.0f}, {1.0f, 0.82f, 0.35f}, 4);
          if (audio) audio->playSpatialImpact(opp.pos, 0.9f);
          if (opp.hp <= 0.0f) {
            opp.downed = true;
            opp.animClip = "knockdown";
            opp.animTime = 0.0f;
            spectatorBout_.winnerCorner = corner;
            spectatorBout_.endBannerTimer = 3.2f;
            if (audio) {
              audio->playPitBell(true);
              audio->playCrowdCheer(1.0f);
            }
          } else {
            opp.animClip = "hit";
            opp.animTime = 0.0f;
          }
        }
      }
      if (self.animTime >= dur) {
        self.animClip = "fight_idle";
        self.animTime = 0.0f;
      }
    } else if (self.animClip == "hit") {
      if (self.animTime >= 0.45f) {
        self.animClip = "fight_idle";
        self.animTime = 0.0f;
      }
    } else if (dist > 1.72f) {
      const glm::vec2 dir = glm::normalize(glm::vec2(toOpp.x, toOpp.z));
      self.pos.x = std::clamp(self.pos.x + dir.x * (2.5f * def.speed) * dt, world.fightPitPos.x - 4.4f, world.fightPitPos.x + 4.4f);
      self.pos.z = std::clamp(self.pos.z + dir.y * (2.5f * def.speed) * dt, world.fightPitPos.z - 4.4f, world.fightPitPos.z + 4.4f);
      self.animClip = "Walk";
    } else {
      self.animClip = "fight_idle";
      self.attackCooldown -= dt * def.speed;
      if (self.attackCooldown <= 0.0f) {
        rng_ = rng_ * 1664525u + 1013904223u;
        static const char* kMoves[5] = {"jab", "cross", "hook", "uppercut", "kick"};
        self.animClip = kMoves[rng_ % 5];
        self.animTime = 0.0f;
        self.hitApplied = false;
        self.attackCooldown = 0.72f + static_cast<float>((rng_ >> 8) % 40) * 0.015f;
      }
    }
  };

  stepFighter(spectatorBout_.red, spectatorBout_.blue, 0);
  stepFighter(spectatorBout_.blue, spectatorBout_.red, 1);

  if (spectatorBout_.winnerCorner >= 0) {
    spectatorBout_.endBannerTimer -= dt;
    if (spectatorBout_.endBannerTimer <= 0.0f) {
      auto& match = pitCard_[static_cast<size_t>(spectatorBout_.matchIdx)];
      match.settled = true;
      const bool wonBet = (spectatorBout_.betWager > 0 && spectatorBout_.betCorner == spectatorBout_.winnerCorner);
      int payout = 0;
      if (wonBet) {
        const float odds = (spectatorBout_.winnerCorner == 0) ? match.redOdds : match.blueOdds;
        payout = static_cast<int>(std::round(static_cast<float>(spectatorBout_.betWager) * odds));
        if (spectatorBout_.quickKoProp && spectatorBout_.elapsed <= 22.0f) {
          payout = static_cast<int>(std::round(static_cast<float>(payout) * 1.45f));
        }
        playerCash_ += payout;
        ironPit_.betWins++;
        ironPit_.betProfit += (payout - spectatorBout_.betWager);
        if (audio) audio->playCashChime();
        pushToast("BOOKIE PAYOUT! Won $" + std::to_string(payout) + " on cage bout!", 4.5f);
      } else if (spectatorBout_.betWager > 0) {
        ironPit_.betProfit -= spectatorBout_.betWager;
        pushToast("Cage bout settled - ticket lost (-$" + std::to_string(spectatorBout_.betWager) + ").", 3.5f);
      }
      spectatorBout_.active = false;
      bool allSettled = true;
      for (const auto& m : pitCard_) if (!m.settled) allSettled = false;
      if (allSettled) refreshFightCard();
    }
  }
}

void GameSession::updateActivitiesAndShops(float dt, const GameInputFrame& input, PlayerController& player, const WorldData& world, AudioEngine* audio) {
  const glm::vec3 pPos = player.position();
  contextPrompt_.clear();

  // Street Race checkpoint progression
  if (activeRaceIdx_ >= 0 && activeRaceIdx_ < static_cast<int>(races_.size())) {
    raceElapsed_ += dt;
    auto& race = races_[static_cast<size_t>(activeRaceIdx_)];
    if (raceCheckpointIdx_ < static_cast<int>(race.checkpoints.size())) {
      const glm::vec3 cp = race.checkpoints[static_cast<size_t>(raceCheckpointIdx_)];
      setGpsWaypoint(cp, race.name + " CP " + std::to_string(raceCheckpointIdx_ + 1));
      if (glm::distance(glm::vec2(pPos.x, pPos.z), glm::vec2(cp.x, cp.z)) < 12.0f) {
        raceCheckpointIdx_++;
        if (audio) audio->playCashChime();
        if (raceCheckpointIdx_ >= static_cast<int>(race.checkpoints.size())) {
          // Compute place based on rivals
          int place = 1;
          for (const auto& v : vehicles_) {
            if (v.isRacer && v.racerCheckpoint >= static_cast<int>(race.checkpoints.size())) ++place;
          }
          const int reward = (place == 1) ? race.rewardFirst : (place == 2 ? race.rewardFirst / 2 : race.rewardFirst / 4);
          race.won = race.won || (place == 1);
          playerCash_ += reward;
          pushToast("RACE FINISHED #" + std::to_string(place) + "! +$" + std::to_string(reward), 5.0f);
          cancelRace();
        }
      }
    }
  }

  // Vehicle entry prompt when on foot
  if (!inVehicle()) {
    for (const auto& v : vehicles_) {
      if (!v.isRacer && glm::distance(pPos, v.pos) < 4.3f) {
        contextPrompt_ = "[G] Enter Vehicle";
        break;
      }
    }
  }

  // Shops & Garages
  for (auto& s : shops_) {
    s.robCooldown = std::max(0.0f, s.robCooldown - dt);
    if (glm::distance(glm::vec2(pPos.x, pPos.z), glm::vec2(s.pos.x, s.pos.z)) < 7.5f) {
      if (s.isGarage && inVehicle()) {
        contextPrompt_ = "[B] Repair & Respray Vehicle (Free)";
        if (input.actionPressed && activeVehicleIdx_ >= 0) {
          auto& v = vehicles_[static_cast<size_t>(activeVehicleIdx_)];
          v.hp = 100.0f;
          rng_ = rng_ * 1664525u + 1013904223u;
          static const glm::vec3 kPaints[6] = {
            {0.85f, 0.14f, 0.18f}, {0.14f, 0.45f, 0.92f}, {0.12f, 0.72f, 0.42f},
            {0.96f, 0.72f, 0.14f}, {0.55f, 0.25f, 0.88f}, {0.90f, 0.92f, 0.96f},
          };
          v.colorTint = kPaints[rng_ % 6];
          if (audio) audio->playCashChime();
          pushToast("Westgate Customs: Vehicle Repaired & Resprayed!", 3.0f);
        }
      } else if (!s.isGarage) {
        contextPrompt_ = "[B] Buy Medkit+Armor ($150)  |  [H] Rob Register";
        if (input.actionPressed) {
          buyArmorAndMedkit(audio);
        } else if (input.secondaryAction && s.robCooldown <= 0.0f) {
          s.robCooldown = 45.0f;
          playerCash_ += 350;
          if (audio) audio->playCashChime();
          reportCrime(CrimeKind::Robbery, s.pos, world);
          pushToast("ROBBERY +$350! Police alerted!", 3.5f);
        }
      }
      break;
    }
  }

  if (contextPrompt_.empty() && glm::distance(glm::vec2(pPos.x, pPos.z), glm::vec2(722.0f, 115.0f)) < 12.0f) {
    contextPrompt_ = inClinch_
      ? "[Z] Body Slam | [U] Guillotine Choke | [LMB] Clinch Knee | [X] Break"
      : "[LMB/F] Punch | [Z] Clinch/Slam | [U] Double-Leg | [Q] Uppercut | [E] Kick | [X] Dodge | [RMB/V] Block";
  }
}

void GameSession::update(float dt, const GameInputFrame& input, PlayerController& player, PhysicsWorld& physics, const WorldData& world, AudioEngine* audio) {
  animClock_ += dt;
  sirenCooldown_ = std::max(0.0f, sirenCooldown_ - dt);
  playerHitFlash_ = std::max(0.0f, playerHitFlash_ - dt * 4.0f);
  playerDodgeTimer_ = std::max(0.0f, playerDodgeTimer_ - dt);
  playerHitAnimTimer_ = std::max(0.0f, playerHitAnimTimer_ - dt);
  takedownCooldown_ = std::max(0.0f, takedownCooldown_ - dt);
  recoilImpulse_ = std::max(0.0f, recoilImpulse_ - dt * 6.5f);
  hitmarkerTimer_ = std::max(0.0f, hitmarkerTimer_ - dt);
  toastTimer_ = std::max(0.0f, toastTimer_ - dt);
  fireCooldown_ = std::max(0.0f, fireCooldown_ - dt);
  muzzleFlashTimer_ = std::max(0.0f, muzzleFlashTimer_ - dt);
  lastCamFocus_ = cameraPosition(player);

  // Sync foot stride clock with real ground velocity & clip cycle duration to prevent foot skate
  const float spd = player.speed();
  if (spd > 0.35f) {
    const float rate = player.sprinting() ? (spd / 5.30f) * 0.733f : (spd / 2.90f) * 1.20f;
    playerLocomotionClock_ += dt * std::clamp(rate, 0.65f, 1.95f);
  } else {
    playerLocomotionClock_ += dt;
  }

  if (autoAdvanceTime_) {
    timeOfDayHours_ = std::fmod(timeOfDayHours_ + dt * 0.015f, 24.0f);
  }

  // Dynamic weather transitions (rain streaks, wet asphalt sheen, lightning & thunder)
  const float targetRain = (weatherPreset_ == WeatherPreset::Rain) ? 0.68f
                         : (weatherPreset_ == WeatherPreset::Thunderstorm) ? 1.0f : 0.0f;
  rainIntensity_ += (targetRain - rainIntensity_) * std::min(1.0f, dt * 1.4f);
  const float targetWet = (weatherPreset_ == WeatherPreset::Rain || weatherPreset_ == WeatherPreset::Thunderstorm) ? 1.0f
                        : (weatherPreset_ == WeatherPreset::Overcast) ? 0.35f : 0.0f;
  wetness_ += (targetWet - wetness_) * std::min(1.0f, dt * 0.35f);
  lightningFlash_ = std::max(0.0f, lightningFlash_ - dt * 3.8f);
  if (weatherPreset_ == WeatherPreset::Thunderstorm) {
    thunderCooldown_ -= dt;
    if (thunderCooldown_ <= 0.0f) {
      rng_ = rng_ * 1664525u + 1013904223u;
      thunderCooldown_ = 5.5f + static_cast<float>(rng_ % 700) * 0.01f;
      lightningFlash_ = 1.0f;
      if (audio) audio->playExplosion(player.position() + glm::vec3(30.0f, 35.0f, 20.0f));
    }
  }

  // Update 3D spatial audio listener + engine RPM rumble
  if (audio) {
    audio->setListener(player.position() + glm::vec3(0.0f, 1.5f, 0.0f), player.yaw());
    if (const auto* veh = currentVehicle()) {
      audio->setEngineState(true, std::abs(veh->speed) / std::max(1.0f, veh->maxSpeed));
    } else {
      audio->setEngineState(false, 0.0f);
    }
  }

  // Expire bullet tracers & integrate spark particles
  for (auto& tr : tracers_) tr.ttl -= dt;
  tracers_.erase(std::remove_if(tracers_.begin(), tracers_.end(), [](const BulletTracer& t) { return t.ttl <= 0.0f; }), tracers_.end());

  for (auto& sp : sparks_) {
    sp.pos += sp.vel * dt;
    sp.vel.y -= 16.0f * dt;
    sp.ttl -= dt;
  }
  sparks_.erase(std::remove_if(sparks_.begin(), sparks_.end(), [](const SparkParticle& s) { return s.ttl <= 0.0f; }), sparks_.end());

  // Weapon selection 0..5
  if (input.selectWeaponSlot >= 0 && input.selectWeaponSlot < static_cast<int>(weapons_.size())) {
    if (weapons_[static_cast<size_t>(input.selectWeaponSlot)].unlocked) {
      activeWeapon_ = input.selectWeaponSlot;
      reloadTimer_ = 0.0f;
    } else {
      pushToast(weapons_[static_cast<size_t>(input.selectWeaponSlot)].name + " locked - buy in Phone [P] -> Gun Runner!", 2.5f);
    }
  }

  aiming_ = input.aimDown && !inVehicle();

  // Reloading
  auto& activeW = weapons_[static_cast<size_t>(activeWeapon_)];
  if (!activeW.isMelee && input.reloadPressed && reloadTimer_ <= 0.0f && activeW.magAmmo < activeW.magSize && activeW.reserveAmmo > 0) {
    reloadTimer_ = activeW.reloadTime;
  }
  if (reloadTimer_ > 0.0f) {
    reloadTimer_ -= dt;
    if (reloadTimer_ <= 0.0f) {
      reloadTimer_ = 0.0f;
      const int need = activeW.magSize - activeW.magAmmo;
      const int take = std::min(need, activeW.reserveAmmo);
      activeW.magAmmo += take;
      activeW.reserveAmmo -= take;
    }
  }

  // Movement: on foot vs inside vehicle
  if (!inVehicle()) {
    player.update(dt, input.moveInput);
    if (player.steppedThisFrame() && audio) {
      const bool inWater = player.position().y < 0.25f;
      audio->playFootstep(player.stepIntensity(), inWater);
    }
    const bool blocking = aiming_ && activeW.isMelee;
    if (playerAttackClip_.empty()) {
      playerStamina_ = std::min(100.0f, playerStamina_ + (blocking ? 10.0f : 22.0f) * dt);
    }
    if (!activeW.isMelee && fireCooldown_ <= 0.0f && ((activeW.automatic && input.fireDown) || (!activeW.automatic && input.firePressed))) {
      fireActiveWeapon(player, physics, world, audio);
    }
  } else {
    // Still allow camera look while driving
    PlayerInputState lookOnly{};
    lookOnly.lookDeltaX = input.moveInput.lookDeltaX;
    lookOnly.lookDeltaY = input.moveInput.lookDeltaY;
    player.update(0.0f, lookOnly);
  }

  updateTrafficAndVehicles(dt, input, player, physics, world, audio);
  updateNpcsAndPolice(dt, player, physics, world, audio);
  if (input.takedownPressed) {
    trySilentTakedown(player, world, audio);
  }
  if (!spectatorBout_.active) {
    updateIronPit(dt, input, player, world, audio);
  }
  updateSpectatorBout(dt, world, audio);
  updateActivitiesAndShops(dt, input, player, world, audio);
  takedownReady_ = (takedownCooldown_ <= 0.0f) && (findTakedownNpcIndex(player.position()) >= 0);
  if (takedownReady_ && contextPrompt_.empty()) {
    contextPrompt_ = "[V] Silent Takedown";
  }
}

glm::vec3 GameSession::cameraPosition(const PlayerController& player) const {
  if (activeVehicleIdx_ >= 0 && activeVehicleIdx_ < static_cast<int>(vehicles_.size())) {
    const auto& v = vehicles_[static_cast<size_t>(activeVehicleIdx_)];
    const float yaw = player.yaw();
    const float pitch = player.pitch();
    const glm::vec3 fwd(std::sin(yaw) * std::cos(pitch), std::sin(pitch), std::cos(yaw) * std::cos(pitch));
    return v.pos + glm::vec3(0.0f, 1.9f, 0.0f) - fwd * 6.8f;
  }
  if (aiming_ && !weapons_[static_cast<size_t>(activeWeapon_)].isMelee) {
    const glm::vec3 tgt = player.cameraTarget();
    const glm::vec3 dir = glm::normalize(player.cameraTarget() - player.cameraPosition());
    return tgt - dir * 1.9f;
  }
  return player.cameraPosition();
}

glm::vec3 GameSession::cameraTarget(const PlayerController& player) const {
  if (activeVehicleIdx_ >= 0 && activeVehicleIdx_ < static_cast<int>(vehicles_.size())) {
    const auto& v = vehicles_[static_cast<size_t>(activeVehicleIdx_)];
    return v.pos + glm::vec3(0.0f, 1.4f, 0.0f);
  }
  return player.cameraTarget();
}

float GameSession::cameraFovDeg(bool aiming) const {
  if (inVehicle()) return 68.0f;
  if (aiming && !weapons_[static_cast<size_t>(activeWeapon_)].isMelee) return 44.0f;
  return 60.0f;
}

std::string GameSession::playerAnimClip(const PlayerController& player, bool blocking) const {
  if (playerHitAnimTimer_ > 0.0f && playerAttackClip_.empty()) return "hit";
  if (blocking && weapons_[static_cast<size_t>(activeWeapon_)].isMelee) return "block";
  if (player.speed() > 0.35f) return player.sprinting() ? "Run" : "Walk";
  return weapons_[static_cast<size_t>(activeWeapon_)].isMelee ? "fight_idle" : "Idle";
}

std::vector<WorldMarkerBox> GameSession::gatherWorldMarkers(float elapsedSec) const {
  std::vector<WorldMarkerBox> out;
  const float pulse = 0.5f + 0.5f * std::sin(elapsedSec * 4.5f);

  // GPS Waypoint vertical sky beacon
  if (hasWaypoint_) {
    out.push_back({{waypointPos_.x, waypointPos_.y + 18.0f, waypointPos_.z}, {0.7f, 36.0f, 0.7f}, elapsedSec * 1.5f, {0.22f, 0.85f, 1.0f}});
    out.push_back({{waypointPos_.x, waypointPos_.y + 0.3f, waypointPos_.z}, {2.4f + pulse * 0.6f, 0.25f, 2.4f + pulse * 0.6f}, 0.0f, {0.22f, 0.90f, 1.0f}});
  }

  // Stunt Jump glowing ramps
  for (const auto& sj : stuntJumps_) {
    out.push_back({{sj.pos.x, sj.pos.y + 0.7f, sj.pos.z}, {4.4f, 1.4f, 8.2f}, sj.yawRad, {0.98f, 0.68f, 0.14f}});
  }

  // Shops (green) & Mod Garages (purple)
  for (const auto& s : shops_) {
    out.push_back({
      {s.pos.x, s.pos.y + 0.25f, s.pos.z},
      {3.4f, 0.35f, 3.4f},
      0.0f,
      s.isGarage ? glm::vec3(0.68f, 0.28f, 0.96f) : glm::vec3(0.18f, 0.86f, 0.45f),
    });
  }

  // Bullet tracers rendered as glowing 3D streaks (yaw + pitch oriented!)
  for (const auto& tr : tracers_) {
    const glm::vec3 delta = tr.end - tr.start;
    const float len = glm::length(delta);
    if (len < 0.05f) continue;
    const glm::vec3 mid = (tr.start + tr.end) * 0.5f;
    const float yaw = std::atan2(delta.x, delta.z);
    const float horiz = std::hypot(delta.x, delta.z);
    const float pitch = -std::atan2(delta.y, std::max(1e-4f, horiz));
    out.push_back({mid, {0.06f, 0.06f, len}, yaw, tr.color, pitch});
  }

  // Dynamic spark particles (muzzle/bullet/vehicle/boxing impacts)
  for (const auto& sp : sparks_) {
    out.push_back({sp.pos, {sp.size, sp.size, sp.size * 2.2f}, 0.0f, sp.color, 0.0f});
  }

  // 3D Falling Rain Streaks around the camera when Weather = Rain or Thunderstorm
  if (rainIntensity_ > 0.05f) {
    const int drops = static_cast<int>(rainIntensity_ * 110.0f);
    for (int i = 0; i < drops; ++i) {
      const float h1 = std::fmod(static_cast<float>(i * 73 + 19) * 0.6180339f, 1.0f);
      const float h2 = std::fmod(static_cast<float>(i * 137 + 41) * 0.381966f, 1.0f);
      const float h3 = std::fmod(static_cast<float>(i * 211 + 7) * 0.754877f + animClock_ * 1.45f, 1.0f);
      const float rx = lastCamFocus_.x + (h1 - 0.5f) * 34.0f;
      const float rz = lastCamFocus_.z + (h2 - 0.5f) * 34.0f;
      const float ry = lastCamFocus_.y + 14.0f - h3 * 22.0f;
      out.push_back({{rx, ry, rz}, {0.025f, 0.55f, 0.025f}, 0.0f, {0.68f, 0.80f, 0.96f}, 0.14f});
    }
  }

  return out;
}

std::vector<DynamicPointLight> GameSession::gatherDynamicLights(const WorldData& world, const PlayerController& player, float elapsedSec) const {
  std::vector<DynamicPointLight> lights;
  lights.reserve(24);

  const SkyLightingState sky = skyLighting();
  const float pitY = world.heightfield.sampleHeight(world.fightPitPos.x, world.fightPitPos.z);

  // 1. Iron Pit overhead floodlights (4 corners)
  const float floodIntensity = 1.15f + sky.nightFactor * 0.95f;
  const glm::vec2 floodCorners[4] = {{-4.8f, -4.8f}, {4.8f, -4.8f}, {-4.8f, 4.8f}, {4.8f, 4.8f}};
  for (const auto& c : floodCorners) {
    lights.push_back({{world.fightPitPos.x + c.x, pitY + 5.8f, world.fightPitPos.z + c.y}, 22.0f, {0.98f, 0.93f, 0.84f}, floodIntensity});
  }

  // 2. Iron Pit flickering fire-drum braziers + Viktor's green bookmaker desk lamp
  const float flickerA = 0.85f + 0.25f * std::sin(elapsedSec * 14.3f) + 0.15f * std::cos(elapsedSec * 23.1f);
  const float flickerB = 0.85f + 0.25f * std::cos(elapsedSec * 12.7f) + 0.15f * std::sin(elapsedSec * 19.8f);
  lights.push_back({{world.fightPitPos.x - 6.8f, pitY + 1.45f, world.fightPitPos.z - 6.8f}, 14.0f, {1.0f, 0.45f, 0.12f}, 2.1f * flickerA});
  lights.push_back({{world.fightPitPos.x + 6.8f, pitY + 1.45f, world.fightPitPos.z + 6.8f}, 14.0f, {1.0f, 0.48f, 0.14f}, 2.1f * flickerB});
  lights.push_back({{world.fightPitPos.x + 9.2f, pitY + 1.85f, world.fightPitPos.z - 2.6f}, 9.5f, {0.22f, 0.96f, 0.50f}, 1.55f});

  // 3. Muzzle flash point light
  if (muzzleFlashTimer_ > 0.0f) {
    lights.push_back({muzzleFlashPos_, 16.0f, {1.0f, 0.78f, 0.35f}, 4.5f});
  }

  // 4. Active vehicle headlights & police cruiser red/blue strobe lights
  const float strobe = std::sin(elapsedSec * 18.0f);
  for (const auto& v : vehicles_) {
    if (lights.size() >= 22) break;
    const glm::vec3 fwd(std::sin(v.yawRad), 0.0f, std::cos(v.yawRad));
    if (v.occupiedByPlayer && sky.nightFactor > 0.15f) {
      lights.push_back({v.pos + fwd * 3.8f + glm::vec3(0.0f, 0.85f, 0.0f), 26.0f, {0.96f, 0.94f, 0.82f}, 2.2f});
    } else if (v.isPolicePursuit || (v.kind == VehicleModelKind::PoliceCruiser && wantedStars_ > 0)) {
      const bool redPhase = strobe >= 0.0f;
      lights.push_back({
        v.pos + glm::vec3(0.0f, 2.0f, 0.0f),
        20.0f,
        redPhase ? glm::vec3(1.0f, 0.12f, 0.12f) : glm::vec3(0.14f, 0.36f, 1.0f),
        2.6f,
      });
    }
  }

  // 5. Nearest night streetlamps around player
  if (sky.nightFactor > 0.15f) {
    const glm::vec3 pPos = player.position();
    for (const auto& prop : world.props) {
      if (lights.size() >= 24) break;
      if (prop.proto != "streetlamp") continue;
      if (glm::distance(glm::vec2(prop.pos.x, prop.pos.z), glm::vec2(pPos.x, pPos.z)) < 85.0f) {
        lights.push_back({prop.pos + glm::vec3(0.0f, 5.2f, 0.0f), 19.0f, {1.0f, 0.82f, 0.52f}, 1.45f * sky.nightFactor});
      }
    }
  }

  // 6. Walk-in Interior Warm Overhead Lights (Safehouse, 24/7 Mart, Customs Garage, Iron Pit Armory)
  const glm::vec2 interiors[4] = {
    {world.spawnPos.x - 13.0f, world.spawnPos.z - 11.0f},
    {-38.0f, -125.0f},
    {112.0f, -135.0f},
    {704.0f, 108.0f},
  };
  for (const auto& ir : interiors) {
    if (lights.size() >= 24) break;
    const float gy = world.heightfield.sampleHeight(ir.x, ir.y);
    lights.push_back({{ir.x, gy + 3.0f, ir.y}, 11.0f, {1.0f, 0.86f, 0.64f}, 1.35f});
  }

  return lights;
}

bool GameSession::saveToFile(const std::string& path) const {
  try {
    nlohmann::json j;
    j["version"] = 1;
    j["cash"] = playerCash_;
    j["hp"] = playerHp_;
    j["armor"] = playerArmor_;
    j["ironPitTier"] = ironPit_.tier;
    j["ironPitWins"] = ironPit_.wins;
    j["timeOfDayHours"] = timeOfDayHours_;

    nlohmann::json wArr = nlohmann::json::array();
    for (const auto& w : weapons_) {
      wArr.push_back({{"id", w.id}, {"unlocked", w.unlocked}, {"mag", w.magAmmo}, {"reserve", w.reserveAmmo}});
    }
    j["weapons"] = wArr;

    nlohmann::json cArr = nlohmann::json::array();
    for (const auto& c : contracts_) {
      cArr.push_back({{"id", c.id}, {"completed", c.completed}});
    }
    j["contracts"] = cArr;

    nlohmann::json rArr = nlohmann::json::array();
    for (const auto& r : races_) {
      rArr.push_back({{"id", r.id}, {"won", r.won}});
    }
    j["races"] = rArr;

    std::ofstream out(path);
    if (!out.is_open()) return false;
    out << j.dump(2);
    return out.good();
  } catch (...) {
    return false;
  }
}

bool GameSession::loadFromFile(const std::string& path) {
  try {
    std::ifstream in(path);
    if (!in.is_open()) return false;
    nlohmann::json j;
    in >> j;

    playerCash_ = j.value("cash", playerCash_);
    playerHp_ = std::clamp(j.value("hp", playerHp_), 10.0f, playerMaxHp_);
    playerArmor_ = std::clamp(j.value("armor", playerArmor_), 0.0f, 100.0f);
    ironPit_.tier = std::clamp(j.value("ironPitTier", ironPit_.tier), 1, 3);
    ironPit_.wins = j.value("ironPitWins", ironPit_.wins);
    timeOfDayHours_ = j.value("timeOfDayHours", timeOfDayHours_);

    if (j.contains("weapons") && j["weapons"].is_array()) {
      for (const auto& jw : j["weapons"]) {
        const std::string id = jw.value("id", "");
        for (auto& w : weapons_) {
          if (w.id == id) {
            w.unlocked = jw.value("unlocked", w.unlocked);
            w.magAmmo = std::clamp(jw.value("mag", w.magAmmo), 0, w.magSize);
            w.reserveAmmo = std::clamp(jw.value("reserve", w.reserveAmmo), 0, w.reserveMax);
          }
        }
      }
    }
    if (j.contains("contracts") && j["contracts"].is_array()) {
      for (const auto& jc : j["contracts"]) {
        const std::string id = jc.value("id", "");
        for (auto& c : contracts_) {
          if (c.id == id) c.completed = jc.value("completed", c.completed);
        }
      }
    }
    if (j.contains("races") && j["races"].is_array()) {
      for (const auto& jr : j["races"]) {
        const std::string id = jr.value("id", "");
        for (auto& r : races_) {
          if (r.id == id) r.won = jr.value("won", r.won);
        }
      }
    }
    return true;
  } catch (...) {
    return false;
  }
}

} // namespace westgate
