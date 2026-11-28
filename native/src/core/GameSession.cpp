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

constexpr float kPi = 3.14159265359f;

const std::array<VehicleSpec, kVehicleModelCount> kVehicleSpecs = {{
  // 0: PoliceCruiser (+Z)
  {VehicleModelKind::PoliceCruiser, "police_cruiser", "WSPD Interceptor V8", "models/police_cruiser.glb", "Emergency",
   0.0f, 1.14f, 2.02f, 1.48f, 4.78f, 2.86f, 46.0f, 23.5f, 32.0f, 1.04f, 0.42f, 6, 820.0f, 6600.0f, 12.2f, 0.42f, 0.0038f, 0.0048f, 18500, false, true, false, false},
  // 1: Taxi (+Z)
  {VehicleModelKind::Taxi, "taxi", "Westgate Yellow Cab", "models/taxi.glb", "Sedan",
   0.0f, 1.0f, 1.88f, 1.44f, 4.48f, 2.74f, 36.0f, 18.0f, 27.0f, 0.96f, 0.32f, 6, 780.0f, 6200.0f, 11.2f, 0.36f, 0.0044f, 0.0056f, 7500, false, false, false, false},
  // 2: Sedan (+Z)
  {VehicleModelKind::Sedan, "sedan", "Bavaria 330i Saloon", "models/sedan.glb", "Sedan",
   0.0f, 1.0f, 2.00f, 1.39f, 4.49f, 2.76f, 40.0f, 20.5f, 29.0f, 1.00f, 0.45f, 7, 780.0f, 6800.0f, 11.8f, 0.38f, 0.0040f, 0.0052f, 950, true, false, false, false},
  // 3: Mustang (-Z -> pi)
  {VehicleModelKind::Mustang, "mustang", "GT500 Fastback V8", "models/mustang.glb", "Muscle",
   kPi, 1.0f, 1.87f, 1.33f, 4.78f, 2.72f, 47.0f, 25.0f, 31.0f, 0.98f, 0.78f, 6, 850.0f, 7200.0f, 12.0f, 0.39f, 0.0042f, 0.0054f, 2200, true, false, false, false},
  // 4: Ferrari (+Z)
  {VehicleModelKind::Ferrari, "ferrari", "Scuderia 458 GTB", "models/ferrari.glb", "Supercar",
   0.0f, 1.0f, 1.84f, 1.12f, 4.11f, 2.65f, 56.0f, 31.0f, 36.0f, 1.14f, 0.62f, 7, 980.0f, 8900.0f, 14.2f, 0.45f, 0.0026f, 0.0036f, 5800, true, false, false, false},
  // 5: RangeRover (+Z)
  {VehicleModelKind::RangeRover, "rangerover", "Autobiography SVR", "models/rangerover.glb", "SUV",
   0.0f, 1.0f, 2.29f, 1.82f, 4.96f, 2.92f, 41.0f, 21.0f, 28.0f, 1.02f, 0.30f, 8, 760.0f, 6500.0f, 9.8f, 0.35f, 0.0052f, 0.0068f, 2400, true, false, false, false},
  // 6: Speedboat (+Z)
  {VehicleModelKind::Speedboat, "speedboat", "Del Sol Cigarette 32", "models/speedboat.glb", "Marine",
   0.0f, 1.0f, 1.97f, 1.71f, 6.20f, 3.80f, 40.0f, 22.0f, 20.0f, 1.0f, 0.25f, 1, 900.0f, 5800.0f, 8.0f, 0.35f, 0.004f, 0.006f, 2600, true, false, true, false},
  // 7: CruiserBoat (+Z)
  {VehicleModelKind::CruiserBoat, "cruiser_boat", "Harbor Patrol RIB", "models/cruiser_boat.glb", "Marine",
   0.0f, 1.0f, 4.26f, 2.03f, 9.50f, 5.40f, 32.0f, 16.5f, 18.0f, 1.0f, 0.20f, 1, 850.0f, 5400.0f, 7.5f, 0.35f, 0.004f, 0.006f, 3100, false, true, true, false},
  // 8: Helicopter (+Z)
  {VehicleModelKind::Helicopter, "heli", "Bell 407 Executive", "models/heli.glb", "Aircraft",
   0.0f, 1.0f, 8.70f, 2.83f, 10.84f, 4.20f, 54.0f, 25.0f, 20.0f, 1.0f, 0.0f, 1, 1200.0f, 9200.0f, 8.0f, 0.5f, 0.0f, 0.0f, 6500, true, true, false, true},
  // 9: Ambulance (+Z — upgraded VW LT EMS)
  {VehicleModelKind::Ambulance, "ambulance", "VW LT Paramedic Unit", "models/ambulance.glb", "Emergency",
   0.0f, 1.0f, 2.16f, 2.38f, 5.33f, 3.25f, 35.0f, 16.5f, 25.0f, 0.92f, 0.22f, 6, 760.0f, 5200.0f, 9.6f, 0.35f, 0.0054f, 0.0070f, 15000, false, true, false, false},
  // 10: Firetruck (+Z)
  {VehicleModelKind::Firetruck, "firetruck", "Westgate Engine Co. 4", "models/firetruck.glb", "Emergency",
   0.0f, 1.85f, 2.75f, 3.10f, 6.05f, 3.85f, 31.0f, 14.0f, 23.0f, 0.88f, 0.18f, 6, 700.0f, 4400.0f, 9.2f, 0.36f, 0.0050f, 0.0065f, 20000, false, true, false, false},
  // 11: Delivery (+Z)
  {VehicleModelKind::Delivery, "delivery", "Bay Freight Box Van", "models/delivery.glb", "Heavy",
   0.0f, 1.65f, 2.45f, 2.70f, 5.40f, 3.35f, 32.0f, 14.5f, 23.5f, 0.90f, 0.20f, 6, 740.0f, 4800.0f, 9.5f, 0.35f, 0.0052f, 0.0068f, 12000, false, false, false, false},
  // 12: Semi (-Z -> pi)
  {VehicleModelKind::Semi, "semi", "Peterbilt Hauler 6x4", "models/semi.glb", "Heavy",
   kPi, 1.0f, 2.45f, 3.15f, 12.50f, 6.40f, 29.0f, 11.5f, 21.0f, 0.86f, 0.18f, 8, 650.0f, 2800.0f, 8.8f, 0.36f, 0.0045f, 0.0060f, 28000, false, false, false, false},
  // 13: Audi (+Z)
  {VehicleModelKind::Audi, "audi", "RS7 Sportback Quattro", "models/audi.glb", "Supercar",
   0.0f, 1.0f, 2.11f, 1.49f, 4.99f, 2.93f, 49.0f, 27.5f, 33.5f, 1.10f, 0.34f, 8, 820.0f, 7100.0f, 13.4f, 0.43f, 0.0030f, 0.0040f, 3400, true, false, false, false},
  // 14: Challenger (+Z)
  {VehicleModelKind::Challenger, "challenger", "SRT Hellcat Widebody", "models/challenger.glb", "Muscle",
   0.0f, 1.0f, 2.20f, 1.48f, 5.03f, 2.95f, 48.5f, 26.5f, 30.5f, 0.95f, 0.84f, 8, 860.0f, 6600.0f, 11.6f, 0.38f, 0.0044f, 0.0056f, 2600, true, false, false, false},
  // 15: R8 (+Z)
  {VehicleModelKind::R8, "r8", "R8 V10 Performance", "models/r8.glb", "Supercar",
   0.0f, 1.0f, 2.12f, 1.20f, 4.43f, 2.65f, 55.0f, 31.5f, 36.0f, 1.15f, 0.40f, 7, 950.0f, 8700.0f, 14.0f, 0.44f, 0.0028f, 0.0038f, 4900, true, false, false, false},
  // 16: Golf (-Z -> pi)
  {VehicleModelKind::Golf, "golf", "VW Golf R Turbo AWD", "models/golf.glb", "Compact",
   kPi, 1.0f, 1.83f, 1.50f, 4.15f, 2.63f, 41.5f, 23.0f, 31.0f, 1.06f, 0.35f, 7, 800.0f, 6900.0f, 12.4f, 0.40f, 0.0036f, 0.0048f, 0, true, false, false, false},
  // 17: Mercedes (-Z -> pi)
  {VehicleModelKind::Mercedes, "mercedes", "S63 AMG Biturbo", "models/mercedes.glb", "Sedan",
   kPi, 1.0f, 2.11f, 1.48f, 5.25f, 3.16f, 46.5f, 24.5f, 32.0f, 1.03f, 0.48f, 7, 760.0f, 6600.0f, 11.0f, 0.40f, 0.0038f, 0.0048f, 2900, true, false, false, false},
  // 18: Offroad (+Z)
  {VehicleModelKind::Offroad, "offroad", "Baja Trail 4x4", "models/offroad.glb", "SUV",
   0.0f, 1.0f, 2.22f, 1.87f, 4.60f, 2.85f, 39.0f, 21.5f, 27.5f, 1.02f, 0.40f, 6, 780.0f, 6200.0f, 9.4f, 0.34f, 0.0056f, 0.0072f, 1450, true, false, false, false},
  // 19: Kraz (-Z -> pi)
  {VehicleModelKind::Kraz, "kraz", "KrAZ-255 6x6 Heavy", "models/kraz.glb", "Heavy",
   kPi, 1.0f, 2.55f, 3.16f, 8.00f, 4.60f, 30.5f, 14.0f, 23.0f, 0.94f, 0.22f, 6, 680.0f, 3200.0f, 9.0f, 0.35f, 0.0048f, 0.0062f, 3200, true, false, false, false},
}};

struct CustomPaintPreset {
  const char* name;
  glm::vec3 rgb;
};

const std::array<CustomPaintPreset, GameSession::kCustomPaintCount> kCustomPaintPresets = {{
  {"Pearl Glacier",  {0.93f, 0.95f, 0.98f}},
  {"Obsidian Black", {0.14f, 0.15f, 0.18f}},
  {"Crimson Corsa",  {0.86f, 0.14f, 0.17f}},
  {"Midnight Cobalt",{0.15f, 0.44f, 0.92f}},
  {"Solar Amber",    {0.96f, 0.72f, 0.14f}},
  {"Emerald Venom",  {0.12f, 0.74f, 0.44f}},
  {"Titanium Silver",{0.68f, 0.71f, 0.76f}},
  {"Violet Dusk",    {0.56f, 0.24f, 0.90f}},
}};

} // namespace

const VehicleSpec& GameSession::vehicleSpec(VehicleModelKind kind) {
  const size_t idx = std::min<size_t>(static_cast<size_t>(kind), kVehicleModelCount - 1);
  return kVehicleSpecs[idx];
}

const glm::vec3& GameSession::customPaintColor(int paintIdx, const char** outName) {
  const int idx = ((paintIdx % kCustomPaintCount) + kCustomPaintCount) % kCustomPaintCount;
  if (outName) *outName = kCustomPaintPresets[static_cast<size_t>(idx)].name;
  return kCustomPaintPresets[static_cast<size_t>(idx)].rgb;
}

bool GameSession::ownsVehicle(VehicleModelKind kind) const {
  const size_t idx = static_cast<size_t>(kind);
  return idx < kVehicleModelCount && ownedVehicles_[idx];
}

TrafficSignalAspect GameSession::signalAspectForHeading(const SignalIntersection& node, const glm::vec2& headingXZ) const {
  constexpr float kCycle = 24.0f;
  constexpr float kGreen = 9.2f;
  constexpr float kAmber = 2.4f;
  constexpr float kHalf = 12.0f;
  const float t = std::fmod(animClock_ + static_cast<float>(node.phaseOffset) * 6.0f, kCycle);
  TrafficSignalAspect ns = TrafficSignalAspect::Red;
  TrafficSignalAspect ew = TrafficSignalAspect::Red;
  if (t < kGreen) {
    ns = TrafficSignalAspect::Green;
  } else if (t < kGreen + kAmber) {
    ns = TrafficSignalAspect::Amber;
  } else if (t >= kHalf && t < kHalf + kGreen) {
    ew = TrafficSignalAspect::Green;
  } else if (t >= kHalf + kGreen && t < kHalf + kGreen + kAmber) {
    ew = TrafficSignalAspect::Amber;
  }
  return (std::abs(headingXZ.y) >= std::abs(headingXZ.x)) ? ns : ew;
}

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
  signalNodes_.clear();
  npcs_.clear();
  tracers_.clear();
  ownedVehicles_.fill(false);
  ownedVehicles_[static_cast<size_t>(VehicleModelKind::Golf)] = true; // Free starter car in Personal Garage!
  activePersonalVehicleId_ = -1;

  // Build signalized road intersections across Westgate Bay where distinct roads cross or meet
  for (size_t i = 0; i < world.roads.size(); ++i) {
    const auto& rA = world.roads[i];
    if (rA.isBridge || rA.samples.size() < 3) continue;
    for (size_t j = i + 1; j < world.roads.size(); ++j) {
      const auto& rB = world.roads[j];
      if (rB.isBridge || rB.samples.size() < 3) continue;
      for (size_t sa = 0; sa < rA.samples.size(); sa += 2) {
        const glm::vec3 pA = rA.samples[sa].pos;
        for (size_t sb = 0; sb < rB.samples.size(); sb += 2) {
          const glm::vec3 pB = rB.samples[sb].pos;
          if (glm::distance(glm::vec2(pA.x, pA.z), glm::vec2(pB.x, pB.z)) > 11.5f) continue;
          const size_t saNext = std::min(sa + 1, rA.samples.size() - 1);
          const size_t saPrev = sa > 0 ? sa - 1 : 0;
          const size_t sbNext = std::min(sb + 1, rB.samples.size() - 1);
          const size_t sbPrev = sb > 0 ? sb - 1 : 0;
          const glm::vec2 dA = glm::normalize(glm::vec2(rA.samples[saNext].pos.x - rA.samples[saPrev].pos.x,
                                                        rA.samples[saNext].pos.z - rA.samples[saPrev].pos.z) + glm::vec2(1e-5f, 0.0f));
          const glm::vec2 dB = glm::normalize(glm::vec2(rB.samples[sbNext].pos.x - rB.samples[sbPrev].pos.x,
                                                        rB.samples[sbNext].pos.z - rB.samples[sbPrev].pos.z) + glm::vec2(0.0f, 1e-5f));
          if (std::abs(glm::dot(dA, dB)) > 0.78f) continue; // nearly parallel
          const glm::vec3 mid = 0.5f * (pA + pB);
          bool dup = false;
          for (const auto& existing : signalNodes_) {
            if (glm::distance(glm::vec2(existing.pos.x, existing.pos.z), glm::vec2(mid.x, mid.z)) < 34.0f) {
              dup = true;
              break;
            }
          }
          if (!dup && signalNodes_.size() < 64) {
            SignalIntersection node;
            node.id = static_cast<int>(signalNodes_.size());
            node.pos = glm::vec3(mid.x, world.heightfield.sampleHeight(mid.x, mid.z), mid.z);
            node.phaseOffset = static_cast<int>(signalNodes_.size() % 4);
            signalNodes_.push_back(node);
          }
        }
      }
    }
  }

  // Collect driveable road splines
  std::vector<size_t> longRoads;
  for (size_t ri = 0; ri < world.roads.size(); ++ri) {
    if (world.roads[ri].samples.size() >= 6) longRoads.push_back(ri);
  }

  // 72 ambient traffic vehicles across all 17 road vehicle models (Golf, Mercedes, Offroad, Kraz, upgraded Ambulance, etc.)
  if (!longRoads.empty()) {
    const VehicleModelKind trafficKinds[18] = {
      VehicleModelKind::Golf,
      VehicleModelKind::Sedan,
      VehicleModelKind::Taxi,
      VehicleModelKind::Mercedes,
      VehicleModelKind::RangeRover,
      VehicleModelKind::PoliceCruiser,
      VehicleModelKind::Offroad,
      VehicleModelKind::Audi,
      VehicleModelKind::Challenger,
      VehicleModelKind::Delivery,
      VehicleModelKind::R8,
      VehicleModelKind::Golf,
      VehicleModelKind::Ambulance,
      VehicleModelKind::Firetruck,
      VehicleModelKind::Kraz,
      VehicleModelKind::Semi,
      VehicleModelKind::Mustang,
      VehicleModelKind::Ferrari,
    };
    const glm::vec3 trafficTints[8] = {
      {0.93f, 0.95f, 0.98f}, {0.18f, 0.44f, 0.88f}, {0.84f, 0.16f, 0.19f}, {0.17f, 0.19f, 0.23f},
      {0.18f, 0.66f, 0.42f}, {0.70f, 0.73f, 0.78f}, {0.92f, 0.68f, 0.15f}, {0.42f, 0.25f, 0.72f},
    };
    for (int i = 0; i < 72; ++i) {
      VehicleEntity v;
      v.id = nextVehicleId_++;
      v.kind = trafficKinds[i % 18];
      const VehicleSpec& sp = vehicleSpec(v.kind);
      v.isAmbientTraffic = true;
      v.roadIdx = longRoads[static_cast<size_t>(i) % longRoads.size()];
      const auto& seg = world.roads[v.roadIdx];
      const float maxS = static_cast<float>(seg.samples.size() - 1);
      v.samplePos = std::fmod(static_cast<float>(i) * 2.13f, std::max(1.0f, maxS - 0.1f));
      v.speed = (v.kind == VehicleModelKind::Semi || v.kind == VehicleModelKind::Firetruck || v.kind == VehicleModelKind::Kraz)
        ? 9.5f + static_cast<float>(i % 4)
        : 12.0f + static_cast<float>((i * 5) % 8);
      v.vxLocal = v.speed;
      v.forward = (i % 2) == 0;
      v.laneOffset = std::clamp(seg.width * 0.26f, 2.2f, 3.8f);
      v.maxSpeed = sp.maxSpeed;
      v.accel = sp.accel;
      v.rpm = sp.idleRpm + 900.0f;
      if (v.kind == VehicleModelKind::Taxi) {
        v.colorTint = {0.98f, 0.78f, 0.14f};
      } else if (v.kind == VehicleModelKind::PoliceCruiser || v.kind == VehicleModelKind::Ambulance ||
                 v.kind == VehicleModelKind::Firetruck || v.kind == VehicleModelKind::Delivery) {
        v.colorTint = glm::vec3(1.0f);
      } else {
        v.colorTint = trafficTints[i % 8];
      }
      // Initialize initial world pose on road spline so frame 0 has exact positions
      const size_t i0 = std::min<size_t>(static_cast<size_t>(v.samplePos), seg.samples.size() - 2);
      const float f = std::clamp(v.samplePos - static_cast<float>(i0), 0.0f, 1.0f);
      const auto& s0 = seg.samples[i0];
      const auto& s1 = seg.samples[i0 + 1];
      const glm::vec3 p = glm::mix(s0.pos, s1.pos, f);
      const glm::vec3 delta = s1.pos - s0.pos;
      const float dLen = glm::length(delta);
      const glm::vec3 dir = (dLen > 1e-4f) ? ((v.forward ? 1.0f : -1.0f) * (delta / dLen)) : glm::vec3(0.0f, 0.0f, 1.0f);
      const glm::vec3 wp = p + glm::vec3(s0.rx, 0.0f, s0.rz) * (v.forward ? v.laneOffset : -v.laneOffset);
      const float roadY = seg.isBridge ? wp.y : world.heightfield.sampleHeight(wp.x, wp.z);
      v.pos = glm::vec3(wp.x, roadY + 0.03f, wp.z);
      v.yawRad = std::atan2(dir.x, dir.z);
      vehicles_.push_back(v);
    }
  }

  // Parked hero, Dealership showcase & district vehicles + 5 docked Boats + 3 flyable Helicopters
  struct ParkedSpec { VehicleModelKind kind; float x; float z; float yaw; glm::vec3 tint; };
  const ParkedSpec parked[] = {
    {VehicleModelKind::Mustang, world.spawnPos.x + 7.0f, world.spawnPos.z + 5.5f, 0.35f, {0.85f, 0.14f, 0.18f}},
    {VehicleModelKind::Golf, world.spawnPos.x - 9.0f, world.spawnPos.z + 6.5f, -0.4f, {0.15f, 0.44f, 0.92f}},
    {VehicleModelKind::R8, 34.0f, -86.0f, 1.57f, {0.92f, 0.88f, 0.90f}},
    // Westgate Luxury Motorsport Showroom (Downtown 56, -118)
    {VehicleModelKind::Ferrari, 52.0f, -118.0f, 0.45f, {0.88f, 0.12f, 0.15f}},
    {VehicleModelKind::Mercedes, 60.0f, -118.0f, -0.45f, {0.16f, 0.17f, 0.20f}},
    {VehicleModelKind::Ambulance, 188.0f, 44.0f, 1.57f, {1.0f, 1.0f, 1.0f}},
    {VehicleModelKind::PoliceCruiser, 196.0f, 44.0f, 1.57f, {1.0f, 1.0f, 1.0f}},
    {VehicleModelKind::Taxi, -402.0f, -74.0f, 0.0f, {0.98f, 0.78f, 0.14f}},
    {VehicleModelKind::Challenger, -692.0f, 36.0f, -1.57f, {0.18f, 0.42f, 0.88f}},
    {VehicleModelKind::Mustang, world.fightPitPos.x - 16.0f, world.fightPitPos.z - 8.0f, 0.7f, {0.12f, 0.48f, 0.88f}},
    {VehicleModelKind::Kraz, 625.0f, 425.0f, 0.0f, {0.28f, 0.36f, 0.24f}},
    {VehicleModelKind::Audi, -120.0f, 835.0f, 0.0f, {0.82f, 0.84f, 0.88f}},
    {VehicleModelKind::Offroad, -126.0f, -958.0f, 2.4f, {0.90f, 0.55f, 0.14f}}, // Foothills Observatory 4x4!
    {VehicleModelKind::RangeRover, -955.0f, 365.0f, 0.8f, {0.18f, 0.42f, 0.30f}}, // Pelican Key SUV!
    // Docked Speedboats & Cruisers
    {VehicleModelKind::Speedboat, -748.0f, 42.0f, -1.57f, {0.95f, 0.95f, 0.98f}},
    {VehicleModelKind::CruiserBoat, -752.0f, -12.0f, -1.45f, {0.92f, 0.94f, 0.96f}},
    {VehicleModelKind::Speedboat, 655.0f, 465.0f, 1.2f, {0.92f, 0.22f, 0.20f}},
    {VehicleModelKind::Speedboat, -912.0f, 305.0f, -0.7f, {0.20f, 0.65f, 0.95f}},
    {VehicleModelKind::CruiserBoat, -612.0f, 252.0f, 0.25f, {0.94f, 0.95f, 0.97f}}, // Venice Canals Marina
    // Flyable Helicopters (Downtown Plaza Helipad, Foothills Observatory & Westgate Airport)
    {VehicleModelKind::Helicopter, 32.0f, -108.0f, 0.0f, {0.20f, 0.24f, 0.30f}},
    {VehicleModelKind::Helicopter, -104.0f, -966.0f, 2.8f, {0.15f, 0.44f, 0.90f}},
    {VehicleModelKind::Helicopter, 24.0f, 935.0f, 3.14f, {0.85f, 0.22f, 0.18f}},
  };
  for (const auto& ps : parked) {
    const VehicleSpec& sp = vehicleSpec(ps.kind);
    VehicleEntity v;
    v.id = nextVehicleId_++;
    v.kind = ps.kind;
    v.isBoat = sp.isBoat;
    v.isAircraft = sp.isAircraft;
    const float y = sp.isBoat
      ? (oceanWaveHeight(ps.x, ps.z, 0.0f) + 0.05f)
      : (world.heightfield.sampleHeight(ps.x, ps.z) + 0.03f);
    v.pos = glm::vec3(ps.x, y, ps.z);
    v.yawRad = ps.yaw;
    v.colorTint = ps.tint;
    v.maxSpeed = sp.maxSpeed;
    v.accel = sp.accel;
    v.rpm = sp.idleRpm;
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
    case TimeOfDayPreset::Sunset: timeOfDayHours_ = 17.55f; break;
    case TimeOfDayPreset::Night: timeOfDayHours_ = 22.8f; break;
    case TimeOfDayPreset::Dawn: timeOfDayHours_ = 6.45f; break;
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
  if (preset == WeatherPreset::Rain) {
    rainIntensity_ = std::max(rainIntensity_, 0.68f);
    wetness_ = std::max(wetness_, 0.92f);
  } else if (preset == WeatherPreset::Thunderstorm) {
    rainIntensity_ = 1.0f;
    wetness_ = 1.0f;
  } else if (preset == WeatherPreset::Overcast) {
    rainIntensity_ = 0.0f;
    wetness_ = std::max(wetness_, 0.35f);
  } else {
    rainIntensity_ = 0.0f;
    wetness_ = 0.0f;
  }
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

bool GameSession::buyDealershipVehicle(VehicleModelKind kind, AudioEngine* audio) {
  const VehicleSpec& sp = vehicleSpec(kind);
  const size_t idx = static_cast<size_t>(kind);
  if (idx >= kVehicleModelCount) return false;
  if (ownedVehicles_[idx]) {
    pushToast(std::string(sp.displayName) + " already in your Personal Garage!", 2.5f);
    return true;
  }
  if (!sp.purchasable || playerCash_ < sp.dealershipPrice) {
    pushToast("Need $" + std::to_string(sp.dealershipPrice) + " for " + sp.displayName, 2.5f);
    return false;
  }
  playerCash_ -= sp.dealershipPrice;
  ownedVehicles_[idx] = true;
  if (audio) audio->playCashChime();
  pushToast("PURCHASED: " + std::string(sp.displayName) + " (-$" + std::to_string(sp.dealershipPrice) + ")!", 3.5f);
  return true;
}

int GameSession::spawnPersonalVehicle(VehicleModelKind kind, int paintIdx, PlayerController& player, const WorldData& world, AudioEngine* audio, bool autoBoard) {
  const size_t kIdx = static_cast<size_t>(kind);
  if (kIdx >= kVehicleModelCount || !ownedVehicles_[kIdx]) {
    pushToast("Vehicle locked - purchase in Dealership first!", 2.5f);
    return -1;
  }
  const VehicleSpec& sp = vehicleSpec(kind);
  selectedPaintIdx_ = ((paintIdx % kCustomPaintCount) + kCustomPaintCount) % kCustomPaintCount;
  const glm::vec3 pPos = player.position();
  const float pYaw = player.yaw();
  const glm::vec3 fwd(std::sin(pYaw), 0.0f, std::cos(pYaw));
  const glm::vec3 right(fwd.z, 0.0f, -fwd.x);

  glm::vec3 spawnPos = pPos + fwd * 6.2f + right * 2.2f;
  float spawnYaw = pYaw;
  if (sp.isBoat) {
    // Deliver boat to nearest open water or Del SolMarina if player is inland
    if (world.heightfield.sampleHeight(spawnPos.x, spawnPos.z) > -0.2f) {
      spawnPos = glm::vec3(-746.0f, oceanWaveHeight(-746.0f, 34.0f, animClock_) + 0.05f, 34.0f);
      spawnYaw = -1.57f;
    } else {
      spawnPos.y = oceanWaveHeight(spawnPos.x, spawnPos.z, animClock_) + 0.05f;
    }
  } else {
    spawnPos.x = std::clamp(spawnPos.x, world.worldMin + 25.0f, world.worldMax - 25.0f);
    spawnPos.z = std::clamp(spawnPos.z, world.worldMin + 25.0f, world.worldMax - 25.0f);
    float groundY = world.heightfield.sampleHeight(spawnPos.x, spawnPos.z);
    if (pPos.y > groundY + 2.5f) {
      groundY = pPos.y - 1.0f; // elevated deck / Del Sol Pier / overpass
    } else if (!sp.isAircraft) {
      // Snap Valet road vehicles onto the nearest asphalt road centerline/curb lane within 32m so they never clip buildings
      float bestD2 = 32.0f * 32.0f;
      glm::vec3 bestRoadPos = spawnPos;
      float bestRoadYaw = spawnYaw;
      bool foundRoad = false;
      for (const auto& road : world.roads) {
        for (size_t si = 0; si + 1 < road.samples.size(); ++si) {
          const glm::vec3 a = road.samples[si].pos;
          const glm::vec3 b = road.samples[si + 1].pos;
          const glm::vec2 ab(b.x - a.x, b.z - a.z);
          const float len2 = glm::dot(ab, ab);
          if (len2 < 0.25f) continue;
          const float t = std::clamp(glm::dot(glm::vec2(spawnPos.x - a.x, spawnPos.z - a.z), ab) / len2, 0.0f, 1.0f);
          const glm::vec3 proj = glm::mix(a, b, t);
          const float dx = spawnPos.x - proj.x;
          const float dz = spawnPos.z - proj.z;
          const float d2 = dx * dx + dz * dz;
          if (d2 < bestD2) {
            bestD2 = d2;
            const glm::vec2 dir = ab / std::sqrt(len2);
            const float align = dir.x * fwd.x + dir.y * fwd.z;
            const glm::vec2 travelDir = (align >= 0.0f) ? dir : -dir;
            const glm::vec2 rightLane(travelDir.y, -travelDir.x);
            const float laneOff = std::min(road.width * 0.24f, 2.8f);
            bestRoadPos = glm::vec3(proj.x + rightLane.x * laneOff, proj.y, proj.z + rightLane.y * laneOff);
            bestRoadYaw = std::atan2(travelDir.x, travelDir.y);
            foundRoad = true;
          }
        }
      }
      if (foundRoad) {
        spawnPos.x = bestRoadPos.x;
        spawnPos.z = bestRoadPos.z;
        groundY = std::max(bestRoadPos.y, world.heightfield.sampleHeight(spawnPos.x, spawnPos.z));
        spawnYaw = bestRoadYaw;
      }
    }
    spawnPos.y = groundY + 0.05f;
  }

  // Reuse existing personal vehicle slot if not currently occupied by player, otherwise append
  int slot = -1;
  if (activePersonalVehicleId_ > 0) {
    for (size_t i = 0; i < vehicles_.size(); ++i) {
      if (vehicles_[i].id == activePersonalVehicleId_ && !vehicles_[i].occupiedByPlayer) {
        slot = static_cast<int>(i);
        break;
      }
    }
  }

  VehicleEntity v;
  v.id = (slot >= 0) ? vehicles_[static_cast<size_t>(slot)].id : nextVehicleId_++;
  v.kind = kind;
  v.pos = spawnPos;
  v.yawRad = spawnYaw;
  v.isBoat = sp.isBoat;
  v.isAircraft = sp.isAircraft;
  v.maxSpeed = sp.maxSpeed;
  v.accel = sp.accel;
  v.rpm = sp.idleRpm;
  v.hp = 100.0f;
  v.colorTint = (kind == VehicleModelKind::Taxi) ? glm::vec3(0.98f, 0.78f, 0.14f) : customPaintColor(selectedPaintIdx_);

  if (slot >= 0) {
    vehicles_[static_cast<size_t>(slot)] = v;
  } else {
    slot = static_cast<int>(vehicles_.size());
    vehicles_.push_back(v);
  }
  activePersonalVehicleId_ = v.id;

  if (autoBoard && !inVehicle()) {
    hasWaypoint_ = false;
    auto& spawned = vehicles_[static_cast<size_t>(slot)];
    spawned.occupiedByPlayer = true;
    if (spawned.isAircraft) spawned.rotorRpm01 = 0.65f;
    activeVehicleIdx_ = slot;
    player.teleport(spawned.pos + glm::vec3(0.0f, 0.65f, 0.0f), glm::degrees(spawned.yawRad));
  } else {
    setGpsWaypoint(v.pos, std::string("Valet: ") + sp.displayName);
  }

  if (audio) audio->playCashChime();
  pushToast(std::string("VALET DELIVERED: ") + sp.displayName + "!", 3.2f);
  return slot;
}

bool GameSession::upgradeCurrentVehicleStage(AudioEngine* audio) {
  if (!inVehicle() || activeVehicleIdx_ < 0) return false;
  auto& v = vehicles_[static_cast<size_t>(activeVehicleIdx_)];
  if (v.engineStage >= 3) {
    pushToast("Engine already at Max Stage 3 Twin-Turbo!", 2.5f);
    return false;
  }
  const int cost = 400 + v.engineStage * 300;
  if (playerCash_ < cost) {
    pushToast("Need $" + std::to_string(cost) + " for Stage " + std::to_string(v.engineStage + 1) + " Tune", 2.5f);
    return false;
  }
  playerCash_ -= cost;
  v.engineStage++;
  const VehicleSpec& sp = vehicleSpec(v.kind);
  const float mult = 1.0f + 0.10f * static_cast<float>(v.engineStage);
  v.maxSpeed = sp.maxSpeed * mult;
  v.accel = sp.accel * (1.0f + 0.12f * static_cast<float>(v.engineStage));
  v.hp = 100.0f;
  v.destroyed = false;
  if (audio) audio->playCashChime();
  pushToast("WESTGATE CUSTOMS: Stage " + std::to_string(v.engineStage) + " ECU + Turbo Installed!", 3.2f);
  return true;
}

void GameSession::damageVehicle(size_t vehIdx, float amount, const WorldData& world, PlayerController* player, AudioEngine* audio, bool fromPlayer) {
  if (vehIdx >= vehicles_.size() || amount <= 0.0f) return;
  auto& v = vehicles_[vehIdx];
  if (v.destroyed) return;

  v.hp = std::max(0.0f, v.hp - amount);
  if (v.hp > 0.0f) {
    if (v.hp < 25.0f && v.occupiedByPlayer) {
      pushToast("WARNING: ENGINE ON FIRE - EXIT VEHICLE [G]!", 1.8f);
    }
    return;
  }

  // Detonate vehicle: scorched wreck, upward blast impulse, radial damage & chain-reaction blast!
  v.destroyed = true;
  v.wreckTimer = 0.0f;
  v.speed *= 0.2f;
  v.vxLocal *= 0.2f;
  v.vyLocal = 0.0f;
  v.braking = false;
  v.sirenActive = false;
  v.headlightsOn = false;
  v.colorTint = glm::vec3(0.12f, 0.12f, 0.13f);
  v.suspHeaveVel = 5.8f;
  v.suspPitchVel = 1.6f;
  v.suspRollVel = 1.2f;

  const glm::vec3 blastPos = v.pos + glm::vec3(0.0f, 1.0f, 0.0f);
  spawnSparks(blastPos, {0.0f, 1.0f, 0.0f}, {1.0f, 0.52f, 0.12f}, 24);
  spawnSparks(blastPos + glm::vec3(0.0f, 0.6f, 0.0f), {0.0f, 1.0f, 0.0f}, {0.22f, 0.22f, 0.24f}, 14);
  muzzleFlashPos_ = blastPos + glm::vec3(0.0f, 1.2f, 0.0f);
  muzzleFlashTimer_ = 0.22f;
  if (audio) audio->playExplosion(blastPos);

  if (v.occupiedByPlayer && player) {
    v.occupiedByPlayer = false;
    activeVehicleIdx_ = -1;
    const glm::vec3 leftDir(-std::cos(v.yawRad), 0.0f, std::sin(v.yawRad));
    glm::vec3 ejectPos = v.pos + leftDir * 2.8f;
    ejectPos.y = world.heightfield.sampleHeight(ejectPos.x, ejectPos.z) + 0.6f;
    player->teleport(ejectPos, glm::degrees(v.yawRad));
    damagePlayer(62.0f, world, *player, audio);
  } else if (player) {
    const float pDist = glm::distance(player->position(), blastPos);
    if (pDist < 13.0f) {
      damagePlayer((1.0f - pDist / 13.0f) * 58.0f, world, *player, audio);
    }
  }

  // Radial blast against nearby NPCs
  for (auto& npc : npcs_) {
    if (!npc.alive) continue;
    const float d = glm::distance(npc.pos, blastPos);
    if (d < 13.5f) {
      npc.hp -= (1.0f - d / 13.5f) * 140.0f;
      npc.hitFlash = 1.0f;
      if (npc.hp <= 0.0f) {
        npc.alive = false;
        npc.deadTimer = 0.0f;
        npc.animClip = "knockdown";
        npc.animTime = 0.0f;
      }
    }
  }

  // Chain-reaction blast to adjacent vehicles within 10.5m
  for (size_t oj = 0; oj < vehicles_.size(); ++oj) {
    if (oj == vehIdx || vehicles_[oj].destroyed) continue;
    const float od = glm::distance(vehicles_[oj].pos, blastPos);
    if (od < 10.5f) {
      damageVehicle(oj, (1.0f - od / 10.5f) * 85.0f, world, player, audio, fromPlayer);
    }
  }

  if (fromPlayer) {
    reportCrime(v.kind == VehicleModelKind::PoliceCruiser ? CrimeKind::CopHit : CrimeKind::Gunfire, blastPos, world);
  }
}

void GameSession::fireActiveWeapon(PlayerController& player, PhysicsWorld& physics, const WorldData& world, AudioEngine* audio) {
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
    int hitVehIdx = -1;
    bool hitIronOpp = false;

    for (size_t ni = 0; ni < npcs_.size(); ++ni) {
      const auto& npc = npcs_[ni];
      if (!npc.alive) continue;
      const float t = raySphereHit(camPos, rayDir, npc.pos + glm::vec3(0.0f, 0.95f, 0.0f), 0.68f);
      if (t > 0.5f && t < bestT) {
        bestT = t;
        hitNpcIdx = static_cast<int>(ni);
        hitVehIdx = -1;
        hitIronOpp = false;
      }
    }

    for (size_t vi = 0; vi < vehicles_.size(); ++vi) {
      const auto& veh = vehicles_[vi];
      if (veh.destroyed || veh.occupiedByPlayer) continue;
      const VehicleSpec& vsp = vehicleSpec(veh.kind);
      const float hitRad = std::clamp(0.42f * std::max(vsp.width, vsp.length * 0.62f), 1.45f, 3.2f);
      const float tV = raySphereHit(camPos, rayDir, veh.pos + glm::vec3(0.0f, vsp.height * 0.45f, 0.0f), hitRad);
      if (tV > 0.8f && tV < bestT) {
        bestT = tV;
        hitVehIdx = static_cast<int>(vi);
        hitNpcIdx = -1;
        hitIronOpp = false;
      }
    }

    if (!ironPit_.defeated) {
      const float tPit = raySphereHit(camPos, rayDir, ironPit_.pos + glm::vec3(0.0f, 0.95f, 0.0f), 0.72f);
      if (tPit > 0.5f && tPit < bestT) {
        bestT = tPit;
        hitNpcIdx = -1;
        hitVehIdx = -1;
        hitIronOpp = true;
      }
    }

    const glm::vec3 endPt = camPos + rayDir * bestT;
    tracers_.push_back({muzzle, endPt, w.suppressed ? glm::vec3(0.65f, 0.92f, 1.0f) : glm::vec3(1.0f, 0.85f, 0.30f), 0.085f});
    if (worldHit.hit && hitNpcIdx < 0 && hitVehIdx < 0 && !hitIronOpp) {
      spawnSparks(worldHit.position, worldHit.normal, {1.0f, 0.78f, 0.32f}, 5);
      physics.applyImpulseNear(worldHit.position, rayDir * (w.damage * 0.65f), 1.6f);
    }

    if (hitVehIdx >= 0) {
      hitAnything = true;
      spawnSparks(endPt, -rayDir, {1.0f, 0.75f, 0.28f}, 6);
      damageVehicle(static_cast<size_t>(hitVehIdx), w.damage * 0.82f, world, &player, audio, true);
    } else if (hitNpcIdx >= 0) {
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
  const float clampedDt = std::clamp(dt, 1e-4f, 0.05f);
  const bool darkOrWet = (skyLighting().nightFactor > 0.16f) || (rainIntensity_ > 0.18f);

  // Enter / Exit nearest intact vehicle on G
  if (input.interactPressed) {
    if (activeVehicleIdx_ >= 0 && activeVehicleIdx_ < static_cast<int>(vehicles_.size())) {
      auto& v = vehicles_[static_cast<size_t>(activeVehicleIdx_)];
      v.occupiedByPlayer = false;
      v.braking = false;
      v.handbrakeDown = false;
      v.speed *= 0.45f;
      v.vxLocal = v.speed;
      v.vyLocal *= 0.25f;
      const glm::vec3 leftDir(std::cos(v.yawRad), 0.0f, -std::sin(v.yawRad));
      glm::vec3 exitPos = v.pos + leftDir * (vehicleSpec(v.kind).width * 0.58f + 0.95f);
      exitPos.y = std::max(world.heightfield.sampleHeight(exitPos.x, exitPos.z), v.pos.y - 0.35f) + 0.5f;
      player.teleport(exitPos, glm::degrees(v.yawRad));
      activeVehicleIdx_ = -1;
    } else {
      const glm::vec3 pPos0 = player.position();
      int bestIdx = -1;
      float bestDist = 5.2f;
      for (size_t i = 0; i < vehicles_.size(); ++i) {
        if (vehicles_[i].isRacer || vehicles_[i].destroyed) continue;
        const float d = glm::distance(pPos0, vehicles_[i].pos);
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
        if (v.isAircraft) v.rotorRpm01 = std::max(v.rotorRpm01, 0.58f);
        activeVehicleIdx_ = bestIdx;
        const VehicleSpec& sp = vehicleSpec(v.kind);
        if (v.isAircraft) {
          pushToast(std::string(sp.displayName) + ": [WASD] Cyclic/Yaw | [Space] Climb | [C] Descend | [G] Exit", 4.0f);
        } else if (v.isBoat) {
          pushToast(std::string(sp.displayName) + ": [WASD] Throttle/Steer | [Space] Brake | [G] Exit", 3.5f);
        } else {
          pushToast(std::string(sp.displayName) + ": [WASD] Drive | [Space] Handbrake Drift | [H] Horn/Siren | [G] Exit", 3.2f);
        }
      }
    }
  }

  const glm::vec3 pPos = player.position();
  const float roadGripWeather = 1.0f - wetness_ * 0.24f;

  auto sampleDriveSurfaceY = [&](float x, float z, float refY) -> float {
    float groundY = world.heightfield.sampleHeight(x, z);
    const RaycastHit deckHit = physics.raycast(glm::vec3(x, refY + 2.8f, z), glm::vec3(0.0f, -1.0f, 0.0f), 16.0f);
    if (deckHit.hit && deckHit.position.y > groundY + 0.30f && deckHit.position.y < refY + 2.5f) {
      groundY = deckHit.position.y;
    }
    return groundY;
  };

  auto stepFourCornerSuspension = [&](VehicleEntity& v, const VehicleSpec& sp, float lonAccel, float latAccel, bool detailedRay) {
    const float fx = std::sin(v.yawRad);
    const float fz = std::cos(v.yawRad);
    const float lx = std::cos(v.yawRad);
    const float lz = -std::sin(v.yawRad);
    const float hw = sp.width * 0.40f;
    const float hl = sp.length * 0.34f;
    const auto hAt = [&](float x, float z) -> float {
      return detailedRay ? sampleDriveSurfaceY(x, z, v.pos.y) : world.heightfield.sampleHeight(x, z);
    };
    const float hFL = hAt(v.pos.x + fx * hl + lx * hw, v.pos.z + fz * hl + lz * hw);
    const float hFR = hAt(v.pos.x + fx * hl - lx * hw, v.pos.z + fz * hl - lz * hw);
    const float hRL = hAt(v.pos.x - fx * hl + lx * hw, v.pos.z - fz * hl + lz * hw);
    const float hRR = hAt(v.pos.x - fx * hl - lx * hw, v.pos.z - fz * hl - lz * hw);
    const float avgFront = 0.5f * (hFL + hFR);
    const float avgRear = 0.5f * (hRL + hRR);
    const float avgLeft = 0.5f * (hFL + hRL);
    const float avgRight = 0.5f * (hFR + hRR);
    const float avgGround = 0.25f * (hFL + hFR + hRL + hRR);

    // +pitch tilts nose DOWN around +X_veh (since +Z_veh is forward and +X_veh is left: X x Z = -Y!)
    const float slopePitch = std::clamp(-std::atan2(avgFront - avgRear, std::max(1.2f, 2.0f * hl)), -0.42f, 0.42f);
    // +roll tilts LEFT side UP / RIGHT side DOWN around +Z_veh
    const float slopeRoll = std::clamp(std::atan2(avgLeft - avgRight, std::max(0.9f, 2.0f * hw)), -0.38f, 0.38f);

    // Load-transfer target pitch (+lonAccel squats rear -> negative pitch; braking dives nose -> positive pitch)
    const float targetDynPitch = std::clamp(-lonAccel * sp.pitchGain, -0.11f, 0.11f);
    const float targetDynRoll = std::clamp(latAccel * sp.rollGain, -0.14f, 0.14f);

    const float omega = sp.suspOmega;
    const float dampC = 2.0f * sp.suspZeta * omega;
    v.suspHeaveVel += (-omega * omega * v.suspHeave - dampC * v.suspHeaveVel) * clampedDt;
    v.suspHeave = std::clamp(v.suspHeave + v.suspHeaveVel * clampedDt, -0.22f, 0.28f);

    v.suspPitchVel += (omega * omega * (targetDynPitch - v.suspPitch) - dampC * v.suspPitchVel) * clampedDt;
    v.suspPitch = std::clamp(v.suspPitch + v.suspPitchVel * clampedDt, -0.22f, 0.22f);

    v.suspRollVel += (omega * omega * (targetDynRoll - v.suspRoll) - dampC * v.suspRollVel) * clampedDt;
    v.suspRoll = std::clamp(v.suspRoll + v.suspRollVel * clampedDt, -0.24f, 0.24f);

    v.pitchRad = slopePitch + v.suspPitch;
    v.rollRad = slopeRoll + v.suspRoll;

    v.wheelSuspOffsets[0] = std::clamp(hFL - avgGround - v.suspHeave, -0.16f, 0.16f);
    v.wheelSuspOffsets[1] = std::clamp(hFR - avgGround - v.suspHeave, -0.16f, 0.16f);
    v.wheelSuspOffsets[2] = std::clamp(hRL - avgGround - v.suspHeave, -0.16f, 0.16f);
    v.wheelSuspOffsets[3] = std::clamp(hRR - avgGround - v.suspHeave, -0.16f, 0.16f);
    return avgGround;
  };

  for (size_t vi = 0; vi < vehicles_.size(); ++vi) {
    auto& v = vehicles_[vi];
    const VehicleSpec& sp = vehicleSpec(v.kind);

    // Wrecked vehicle smoke & traffic recycle
    if (v.destroyed) {
      v.wreckTimer += clampedDt;
      v.speed *= (1.0f - std::min(1.0f, 3.5f * clampedDt));
      v.suspHeaveVel -= 14.0f * clampedDt;
      v.suspHeave = std::max(0.0f, v.suspHeave + v.suspHeaveVel * clampedDt);
      if (v.suspHeave <= 0.0f && v.suspHeaveVel < 0.0f) v.suspHeaveVel *= -0.25f;
      v.smokeEmitAccum += clampedDt;
      if (v.smokeEmitAccum > 0.14f && glm::distance(v.pos, pPos) < 120.0f) {
        v.smokeEmitAccum = 0.0f;
        spawnSparks(v.pos + glm::vec3(0.0f, 1.0f, 0.0f), {0.0f, 0.8f, 0.0f},
                    (v.wreckTimer < 6.0f) ? glm::vec3(0.95f, 0.42f, 0.12f) : glm::vec3(0.24f, 0.24f, 0.26f), 2);
      }
      if (v.isAmbientTraffic && v.wreckTimer > 22.0f && glm::distance(v.pos, pPos) > 75.0f) {
        v.destroyed = false;
        v.hp = 100.0f;
        v.wreckTimer = 0.0f;
        v.colorTint = customPaintColor(v.id);
      }
      continue;
    }

    // Engine smoke & fire DoT when critically damaged
    if (v.hp < 55.0f) {
      v.smokeEmitAccum += clampedDt;
      const float interval = (v.hp < 25.0f) ? 0.09f : 0.22f;
      if (v.smokeEmitAccum >= interval && glm::distance(v.pos, pPos) < 130.0f) {
        v.smokeEmitAccum = 0.0f;
        const glm::vec3 fwd(std::sin(v.yawRad), 0.0f, std::cos(v.yawRad));
        const glm::vec3 hood = v.pos + fwd * (sp.length * 0.32f) + glm::vec3(0.0f, sp.height * 0.58f, 0.0f);
        const glm::vec3 col = (v.hp < 25.0f) ? glm::vec3(1.0f, 0.46f, 0.12f) : glm::vec3(0.45f, 0.47f, 0.50f);
        spawnSparks(hood, {0.0f, 0.9f, 0.0f}, col, (v.hp < 25.0f) ? 3 : 1);
      }
      if (v.hp < 22.0f) {
        damageVehicle(vi, 5.5f * clampedDt, world, &player, audio, false);
        if (v.destroyed) continue;
      }
    }

    // Helicopter rotor spooling & articulation
    if (v.isAircraft) {
      const float targetRpm = v.occupiedByPlayer ? 1.0f : 0.08f;
      v.rotorRpm01 += (targetRpm - v.rotorRpm01) * std::min(1.0f, clampedDt * (v.occupiedByPlayer ? 2.6f : 0.65f));
      v.rotorAngleRad = std::fmod(v.rotorAngleRad + clampedDt * (3.2f + v.rotorRpm01 * 28.5f), 6283.185f);
      v.headlightsOn = v.occupiedByPlayer || darkOrWet;
      v.sirenActive = v.occupiedByPlayer && v.sirenActive;
    }

    if (v.occupiedByPlayer) {
      if (v.isAircraft) {
        // 6-DOF Helicopter Flight Dynamics (Cyclic pitch/bank, Collective climb/sink, Pedals yaw)
        const float collective = (input.moveInput.jump ? 1.0f : 0.0f) - (input.moveInput.crouch ? 1.0f : 0.0f);
        const float cyclicFwd = input.moveInput.moveForward;
        const float yawPedal = -input.moveInput.moveRight;
        if (input.secondaryAction && sirenCooldown_ <= 0.0f) {
          sirenCooldown_ = 0.30f;
          v.sirenActive = !v.sirenActive;
        }
        v.yawRate += (yawPedal * 2.15f - v.yawRate) * std::min(1.0f, clampedDt * 6.5f);
        v.yawRad = wrapAnglePi(v.yawRad + v.yawRate * clampedDt);

        const float liftReady = std::clamp(v.rotorRpm01 * 1.25f, 0.35f, 1.0f);
        v.speed = std::clamp(v.speed + cyclicFwd * v.accel * liftReady * clampedDt, -16.0f, v.maxSpeed);
        v.speed *= (1.0f - std::min(1.0f, 0.78f * clampedDt));
        v.vxLocal = v.speed;
        v.vyLocal += (yawPedal * 3.8f - v.vyLocal) * std::min(1.0f, clampedDt * 2.5f);
        v.verticalVel = std::clamp(v.verticalVel + (collective * 17.5f * liftReady - v.verticalVel * 2.1f) * clampedDt, -18.0f, 24.0f);

        const float targetPitch = cyclicFwd * 0.22f + std::clamp(v.speed / v.maxSpeed, -0.3f, 1.0f) * 0.06f;
        const float targetRoll = -yawPedal * 0.26f;
        v.pitchRad += (targetPitch - v.pitchRad) * std::min(1.0f, clampedDt * 6.0f);
        v.rollRad += (targetRoll - v.rollRad) * std::min(1.0f, clampedDt * 6.0f);
        v.suspPitch = v.pitchRad;
        v.suspRoll = v.rollRad;
        v.rpm = sp.idleRpm + (sp.redlineRpm - sp.idleRpm) * v.rotorRpm01;

        const glm::vec3 fwd(std::sin(v.yawRad), 0.0f, std::cos(v.yawRad));
        const glm::vec3 left(std::cos(v.yawRad), 0.0f, -std::sin(v.yawRad));
        v.pos += (fwd * v.speed + left * (v.vyLocal * 0.25f)) * clampedDt;
        v.pos.x = std::clamp(v.pos.x, world.worldMin + 20.0f, world.worldMax - 20.0f);
        v.pos.z = std::clamp(v.pos.z, world.worldMin + 20.0f, world.worldMax - 20.0f);
        const float floorY = std::max(0.2f, sampleDriveSurfaceY(v.pos.x, v.pos.z, v.pos.y)) + 0.05f;
        v.pos.y = std::clamp(v.pos.y + v.verticalVel * clampedDt, floorY, 340.0f);
        if (v.pos.y <= floorY + 0.03f && v.verticalVel < 0.0f) {
          if (v.verticalVel < -13.0f) {
            damageVehicle(vi, (-v.verticalVel - 11.0f) * 3.5f, world, &player, audio, false);
          }
          v.verticalVel = 0.0f;
          v.pitchRad *= 0.25f;
          v.rollRad *= 0.25f;
          v.suspPitch = v.pitchRad;
          v.suspRoll = v.rollRad;
        }
        player.teleport(v.pos + glm::vec3(0.0f, 1.0f, 0.0f), glm::degrees(v.yawRad));
        continue;
      }

      if (v.isBoat) {
        // Wave-buoyant Speedboat / Patrol RIB Physics with planing trim, turn banking & wake foam
        const float throttle = input.moveInput.moveForward;
        const float steer = -input.moveInput.moveRight;
        v.braking = input.moveInput.jump || (throttle < -0.1f && v.speed > 1.0f);
        v.headlightsOn = darkOrWet || v.occupiedByPlayer;
        if (input.moveInput.jump) {
          v.speed *= (1.0f - std::min(1.0f, 4.2f * clampedDt));
        } else if (std::abs(throttle) > 0.01f) {
          v.speed = std::clamp(v.speed + throttle * v.accel * clampedDt, -11.0f, v.maxSpeed);
        } else {
          v.speed *= (1.0f - std::min(1.0f, 1.25f * clampedDt));
        }
        v.vxLocal = v.speed;
        const float speedFrac = std::clamp(std::abs(v.speed) / std::max(1.0f, v.maxSpeed), 0.0f, 1.0f);
        v.rpm = sp.idleRpm + (sp.redlineRpm - sp.idleRpm) * std::clamp(speedFrac * 0.85f + std::max(0.0f, std::abs(throttle)) * 0.2f, 0.0f, 1.0f);

        const float turnAmt = std::clamp(std::abs(v.speed) / 3.8f, 0.22f, 1.0f) * (v.speed >= 0.0f ? 1.0f : -1.0f);
        v.steerAngle += (steer * 0.45f - v.steerAngle) * std::min(1.0f, clampedDt * 8.0f);
        v.yawRad = wrapAnglePi(v.yawRad + steer * 1.90f * turnAmt * clampedDt);

        const glm::vec3 fwd(std::sin(v.yawRad), 0.0f, std::cos(v.yawRad));
        const glm::vec3 left(std::cos(v.yawRad), 0.0f, -std::sin(v.yawRad));
        const glm::vec3 nextXZ = v.pos + fwd * (v.speed * clampedDt);
        const float terrainNext = world.heightfield.sampleHeight(nextXZ.x, nextXZ.z);
        if (terrainNext < -0.22f) {
          v.pos.x = std::clamp(nextXZ.x, world.worldMin + 15.0f, world.worldMax - 15.0f);
          v.pos.z = std::clamp(nextXZ.z, world.worldMin + 15.0f, world.worldMax - 15.0f);
        } else {
          if (std::abs(v.speed) > 9.0f) {
            damageVehicle(vi, std::abs(v.speed) * 0.7f, world, &player, audio, false);
          }
          v.speed *= -0.28f;
        }
        const float wCenter = oceanWaveHeight(v.pos.x, v.pos.z, animClock_);
        const float wBow = oceanWaveHeight(v.pos.x + fwd.x * 2.4f, v.pos.z + fwd.z * 2.4f, animClock_);
        const float wPort = oceanWaveHeight(v.pos.x + left.x * 1.1f, v.pos.z + left.z * 1.1f, animClock_);
        const float wStbd = oceanWaveHeight(v.pos.x - left.x * 1.1f, v.pos.z - left.z * 1.1f, animClock_);
        const float planingLift = std::clamp((v.speed - 6.0f) / 26.0f, 0.0f, 1.0f);
        v.pos.y = wCenter + 0.06f + planingLift * 0.14f;
        // Planing lifts bow UP -> negative pitch around +X_veh; turning left (+steer) banks hull inward (-roll)
        const float targetPitch = -std::atan2(wBow - wCenter, 2.4f) - planingLift * 0.095f;
        const float targetRoll = std::atan2(wPort - wStbd, 2.2f) - steer * 0.22f * speedFrac;
        v.suspPitch += (targetPitch - v.suspPitch) * std::min(1.0f, clampedDt * 7.5f);
        v.suspRoll += (targetRoll - v.suspRoll) * std::min(1.0f, clampedDt * 7.5f);
        v.pitchRad = v.suspPitch;
        v.rollRad = v.suspRoll;

        if (std::abs(v.speed) > 6.5f && static_cast<int>(animClock_ * 24.0f) % 2 == 0) {
          const glm::vec3 stern = v.pos - fwd * (sp.length * 0.46f) + glm::vec3(0.0f, 0.18f, 0.0f);
          spawnSparks(stern + left * 0.55f, {0.0f, 0.65f, 0.0f}, {0.84f, 0.95f, 1.0f}, 1);
          spawnSparks(stern - left * 0.55f, {0.0f, 0.65f, 0.0f}, {0.84f, 0.95f, 1.0f}, 1);
        }
        player.teleport(v.pos + glm::vec3(0.0f, 0.65f, 0.0f), glm::degrees(v.yawRad));
        continue;
      }

      // -----------------------------------------------------------------------
      // Player 4-Wheel Combined-Slip Drivetrain, Handbrake Drift & Suspension
      // -----------------------------------------------------------------------
      const float cmdInput = input.moveInput.moveForward;
      const float steerInput = -input.moveInput.moveRight; // +1 = left, -1 = right
      v.handbrakeDown = input.moveInput.jump;
      v.headlightsOn = darkOrWet || v.occupiedByPlayer;

      if (input.secondaryAction && sirenCooldown_ <= 0.0f) {
        sirenCooldown_ = 0.32f;
        if (sp.hasEmergencyStrobe) v.sirenActive = !v.sirenActive;
        if (audio) audio->playSirenPulse();
      }

      // Speed-sensitive Ackermann steering rack
      const float absVx = std::abs(v.vxLocal);
      const float maxSteerRad = glm::mix(0.58f, 0.22f, std::clamp(absVx / 42.0f, 0.0f, 1.0f));
      const float desiredSteer = steerInput * maxSteerRad;
      v.steerAngle += (desiredSteer - v.steerAngle) * std::min(1.0f, clampedDt * 10.5f);

      // Throttle vs service brake vs reverse logic
      const bool wantsReverse = (cmdInput < -0.05f) && (v.vxLocal <= 1.2f);
      const bool serviceBraking = (cmdInput < -0.05f && v.vxLocal > 1.2f) || (cmdInput > 0.05f && v.vxLocal < -1.2f);
      v.braking = serviceBraking || v.handbrakeDown;

      const float prevVx = v.vxLocal;
      const float effGrip = sp.grip * roadGripWeather;

      if (serviceBraking) {
        const float decel = sp.brakeDecel * effGrip * std::abs(cmdInput);
        if (v.vxLocal > 0.0f) v.vxLocal = std::max(0.0f, v.vxLocal - decel * clampedDt);
        else v.vxLocal = std::min(0.0f, v.vxLocal + decel * clampedDt);
      } else if (v.handbrakeDown) {
        // Rear wheels lock: moderate longitudinal decel + strong lateral drift kick!
        const float hbDecel = sp.brakeDecel * 0.58f * effGrip;
        if (v.vxLocal > 0.0f) v.vxLocal = std::max(0.0f, v.vxLocal - hbDecel * clampedDt);
        else v.vxLocal = std::min(0.0f, v.vxLocal + hbDecel * clampedDt);
      } else if (wantsReverse) {
        v.vxLocal = std::max(-15.5f, v.vxLocal + cmdInput * (v.accel * 0.72f) * clampedDt);
      } else if (cmdInput > 0.01f) {
        // Torque curve tapers smoothly near top speed with aero drag
        const float speedRatio = std::clamp(v.vxLocal / std::max(1.0f, v.maxSpeed), 0.0f, 1.05f);
        const float torqueEnvelope = 1.0f - 0.52f * speedRatio * speedRatio;
        const float shiftCut = (v.shiftTimer > 0.0f) ? 0.35f : 1.0f;
        v.vxLocal = std::min(v.maxSpeed, v.vxLocal + cmdInput * v.accel * torqueEnvelope * shiftCut * clampedDt);
      } else {
        // Rolling resistance + aerodynamic drag
        const float dragDecel = 1.65f + 0.018f * v.vxLocal * std::abs(v.vxLocal);
        if (std::abs(v.vxLocal) <= dragDecel * clampedDt) v.vxLocal = 0.0f;
        else v.vxLocal -= (v.vxLocal > 0.0f ? 1.0f : -1.0f) * dragDecel * clampedDt;
      }

      // Automatic multi-speed gearbox & RPM synthesis
      v.shiftTimer = std::max(0.0f, v.shiftTimer - clampedDt);
      if (v.vxLocal < -0.4f) {
        v.gear = -1;
        v.rpm = sp.idleRpm + (sp.redlineRpm - sp.idleRpm) * std::clamp(-v.vxLocal / 15.5f, 0.0f, 0.92f);
      } else {
        const int numGears = std::max(1, sp.gears);
        const float normSpd = std::clamp(v.vxLocal / std::max(1.0f, v.maxSpeed), 0.0f, 0.999f);
        const int targetGear = std::clamp(1 + static_cast<int>(normSpd * static_cast<float>(numGears)), 1, numGears);
        if (targetGear != v.gear && v.shiftTimer <= 0.0f) {
          v.gear = targetGear;
          v.shiftTimer = 0.11f;
        }
        const float gearLo = static_cast<float>(v.gear - 1) / static_cast<float>(numGears);
        const float gearHi = static_cast<float>(v.gear) / static_cast<float>(numGears);
        const float inGear = std::clamp((normSpd - gearLo) / std::max(0.08f, gearHi - gearLo), 0.0f, 1.0f);
        const float targetRpm = sp.idleRpm + (sp.redlineRpm - sp.idleRpm) * (0.24f + 0.74f * inGear);
        v.rpm += (targetRpm - v.rpm) * std::min(1.0f, clampedDt * 14.0f);
      }

      // Planar bicycle + lateral slip / handbrake drift solver
      const float moveSign = (v.vxLocal >= -0.05f) ? 1.0f : -1.0f;
      const float steerAuthority = std::clamp(std::abs(v.vxLocal) / 3.4f, 0.0f, 1.0f);
      const float kinematicYawRate = (std::abs(v.vxLocal) / std::max(1.8f, sp.wheelbase)) * std::tan(v.steerAngle) * moveSign * steerAuthority;
      const float driftBoost = (v.handbrakeDown && absVx > 6.5f) ? (1.45f + 0.55f * sp.driftFactor) : 1.0f;
      const float targetYawRate = std::clamp(kinematicYawRate * driftBoost, -3.4f, 3.4f);
      v.yawRate += (targetYawRate - v.yawRate) * std::min(1.0f, clampedDt * (v.handbrakeDown ? 7.5f : 11.5f));
      if (!v.airborne) {
        v.yawRad = wrapAnglePi(v.yawRad + v.yawRate * clampedDt);
      }

      // Lateral velocity vyLocal: builds up during high-G cornering & handbrake slides, damped by rear tire cornering stiffness
      const float centrifugalKick = -v.yawRate * v.vxLocal * (v.handbrakeDown ? 0.34f : (0.07f + 0.09f * sp.driftFactor));
      const float lateralDamp = (v.handbrakeDown ? 2.4f : (8.8f * effGrip));
      v.vyLocal += (centrifugalKick - v.vyLocal * lateralDamp) * clampedDt;
      v.vyLocal = std::clamp(v.vyLocal, -14.0f, 14.0f);

      v.speed = v.vxLocal;
      const float wheelRadius = std::clamp(sp.height * 0.23f, 0.31f, 0.54f);
      v.wheelSpinRad = std::fmod(v.wheelSpinRad + (v.handbrakeDown ? v.vxLocal * 0.35f : v.vxLocal) / wheelRadius * clampedDt, 6283.185f);

      const float lonAccel = (v.vxLocal - prevVx) / clampedDt;
      const float latAccel = v.yawRate * v.vxLocal;
      v.slipIntensity = std::clamp((std::abs(v.vyLocal) / 6.5f) + (v.handbrakeDown && absVx > 5.0f ? 0.65f : 0.0f), 0.0f, 1.0f);

      // Emit tire smoke / hot sparks during hard drift or burnout
      if (!v.airborne && v.slipIntensity > 0.48f && absVx > 6.0f && static_cast<int>(animClock_ * 30.0f) % 2 == 0) {
        const glm::vec3 fwd0(std::sin(v.yawRad), 0.0f, std::cos(v.yawRad));
        const glm::vec3 left0(std::cos(v.yawRad), 0.0f, -std::sin(v.yawRad));
        const glm::vec3 rearAxle = v.pos - fwd0 * (sp.length * 0.33f) + glm::vec3(0.0f, 0.16f, 0.0f);
        spawnSparks(rearAxle + left0 * (sp.width * 0.42f), {0.0f, 0.45f, 0.0f}, {0.82f, 0.84f, 0.88f}, 1);
        spawnSparks(rearAxle - left0 * (sp.width * 0.42f), {0.0f, 0.45f, 0.0f}, {0.82f, 0.84f, 0.88f}, 1);
      }

      const glm::vec3 fwd(std::sin(v.yawRad), 0.0f, std::cos(v.yawRad));
      const glm::vec3 left(std::cos(v.yawRad), 0.0f, -std::sin(v.yawRad));
      const glm::vec3 worldVelXZ = fwd * v.vxLocal + left * v.vyLocal;
      const glm::vec3 nextXZ = v.pos + worldVelXZ * clampedDt;

      // Jolt building/wall collision resolution + impact damage
      if (glm::length(glm::vec2(worldVelXZ.x, worldVelXZ.z)) > 0.25f) {
        glm::vec3 pushXZ(0.0f);
        float impactScale = 1.0f;
        const float colRad = std::clamp(sp.width * 0.98f, 1.85f, 2.55f);
        if (physics.resolveVehicleCollision(nextXZ, colRad, pushXZ, impactScale)) {
          v.pos.x = std::clamp(nextXZ.x + pushXZ.x, world.worldMin + 15.0f, world.worldMax - 15.0f);
          v.pos.z = std::clamp(nextXZ.z + pushXZ.z, world.worldMin + 15.0f, world.worldMax - 15.0f);
          const float impactSpd = std::abs(v.vxLocal);
          if (impactSpd > 7.5f) {
            spawnSparks(v.pos + fwd * (sp.length * 0.42f) + glm::vec3(0.0f, 0.65f, 0.0f), -fwd, {1.0f, 0.72f, 0.25f}, 8);
            if (audio) audio->playVehicleCrash(std::min(1.15f, impactSpd / 28.0f));
            damageVehicle(vi, (impactSpd - 6.5f) * 0.85f, world, &player, audio, false);
            if (v.destroyed) continue;
          }
          // Slide glancing blows along walls instead of dead-stopping on slight scrapes
          const float nLen = glm::length(glm::vec2(pushXZ.x, pushXZ.z));
          if (nLen > 1e-4f) {
            const glm::vec2 nDir = glm::vec2(pushXZ.x, pushXZ.z) / nLen;
            const float headOn = std::abs(glm::dot(glm::vec2(fwd.x, fwd.z), nDir));
            v.vxLocal *= (headOn > 0.65f) ? -0.28f : (1.0f - headOn * 0.55f);
            v.speed = v.vxLocal;
          }
        } else {
          v.pos.x = std::clamp(nextXZ.x, world.worldMin + 15.0f, world.worldMax - 15.0f);
          v.pos.z = std::clamp(nextXZ.z, world.worldMin + 15.0f, world.worldMax - 15.0f);
        }
        if (absVx > 2.5f) {
          physics.applyImpulseNear(v.pos + fwd * (sp.length * 0.35f), fwd * (v.vxLocal * 1.4f), 2.8f);
        }
      }

      // Vehicle-to-vehicle collision impulse & damage
      for (size_t oj = 0; oj < vehicles_.size(); ++oj) {
        if (oj == vi) continue;
        auto& other = vehicles_[oj];
        if (other.isAircraft || other.isBoat) continue;
        const glm::vec2 diff(v.pos.x - other.pos.x, v.pos.z - other.pos.z);
        const float dist = glm::length(diff);
        const float minSep = 0.46f * (sp.width + vehicleSpec(other.kind).width) + 0.85f;
        if (dist > 0.05f && dist < minSep && std::abs(v.pos.y - other.pos.y) < 2.4f) {
          const glm::vec2 n = diff / dist;
          const float overlap = minSep - dist;
          v.pos.x += n.x * overlap * 0.55f;
          v.pos.z += n.y * overlap * 0.55f;
          other.pos.x -= n.x * overlap * 0.45f;
          other.pos.z -= n.y * overlap * 0.45f;
          const float relImpact = std::abs(v.vxLocal - other.speed);
          if (relImpact > 6.5f) {
            spawnSparks(0.5f * (v.pos + other.pos) + glm::vec3(0.0f, 0.7f, 0.0f), {0.0f, 1.0f, 0.0f}, {1.0f, 0.76f, 0.30f}, 6);
            if (audio) audio->playVehicleCrash(std::min(1.0f, relImpact / 26.0f));
            damageVehicle(oj, relImpact * 0.75f, world, &player, audio, true);
            damageVehicle(vi, relImpact * 0.38f, world, &player, audio, false);
            if (v.destroyed) break;
          }
          v.vxLocal *= 0.62f;
          v.speed = v.vxLocal;
        }
      }
      if (v.destroyed) continue;

      const float groundY = stepFourCornerSuspension(v, sp, lonAccel, latAccel, true);

      // Stunt jump ramp check & ballistic flight
      if (!v.airborne) {
        for (auto& sj : stuntJumps_) {
          if (glm::distance(glm::vec2(v.pos.x, v.pos.z), glm::vec2(sj.pos.x, sj.pos.z)) < 5.8f && std::abs(v.speed) > 15.5f) {
            v.airborne = true;
            v.airStartPos = v.pos;
            v.airPeakY = v.pos.y;
            v.verticalVel = 7.8f + std::min(6.0f, std::abs(v.speed) * 0.14f);
            v.pos.y += 0.45f;
            break;
          }
        }
      }
      if (v.airborne) {
        v.verticalVel -= 13.8f * clampedDt;
        v.pos.y += v.verticalVel * clampedDt;
        v.airPeakY = std::max(v.airPeakY, v.pos.y);
        v.pitchRad = std::clamp(-v.verticalVel * 0.032f, -0.35f, 0.35f);
        if (v.pos.y <= groundY + 0.05f) {
          v.pos.y = groundY + 0.03f;
          v.airborne = false;
          v.suspHeaveVel = -std::clamp( std::abs(v.verticalVel) * 0.25f, 0.5f, 2.8f);
          v.verticalVel = 0.0f;
          const float dist = glm::distance(glm::vec2(v.airStartPos.x, v.airStartPos.z), glm::vec2(v.pos.x, v.pos.z));
          if (dist > 14.0f) {
            const int bonus = static_cast<int>(dist * 15.0f);
            playerCash_ += bonus;
            if (audio) audio->playCashChime();
            pushToast("STUNT JUMP " + std::to_string(static_cast<int>(dist)) + "m! +$" + std::to_string(bonus), 4.0f);
          }
        }
      } else {
        v.pos.y = groundY + 0.03f;
      }

      player.teleport(v.pos + glm::vec3(0.0f, 0.55f, 0.0f), glm::degrees(v.yawRad));
    } else if (v.isPolicePursuit) {
      // Pursuing police cruiser with active red/blue strobes
      v.sirenActive = true;
      v.headlightsOn = true;
      const glm::vec3 toP = pPos - v.pos;
      const float dist = glm::length(glm::vec2(toP.x, toP.z));
      if (dist > 9.5f) {
        const float targetYaw = std::atan2(toP.x, toP.z);
        const float prevYaw = v.yawRad;
        v.yawRad = moveTowardAngle(v.yawRad, targetYaw, 2.45f * clampedDt);
        v.steerAngle = std::clamp(wrapAnglePi(v.yawRad - prevYaw) / clampedDt * 0.22f, -0.45f, 0.45f);
        v.speed = std::min(v.maxSpeed, 24.0f + static_cast<float>(wantedStars_) * 2.6f);
        v.braking = false;
        const glm::vec3 fwd(std::sin(v.yawRad), 0.0f, std::cos(v.yawRad));
        v.pos += fwd * (v.speed * clampedDt);
      } else {
        v.speed *= 0.84f;
        v.braking = true;
      }
      v.vxLocal = v.speed;
      const float wRad = std::clamp(sp.height * 0.23f, 0.31f, 0.52f);
      v.wheelSpinRad = std::fmod(v.wheelSpinRad + (v.speed / wRad) * clampedDt, 6283.185f);
      const float gY = stepFourCornerSuspension(v, sp, 0.0f, 0.0f, false);
      v.pos.y = gY + 0.03f;
    } else if (v.isRacer && activeRaceIdx_ >= 0) {
      v.headlightsOn = darkOrWet;
      const auto& race = races_[static_cast<size_t>(activeRaceIdx_)];
      if (v.racerCheckpoint < static_cast<int>(race.checkpoints.size())) {
        const glm::vec3 cp = race.checkpoints[static_cast<size_t>(v.racerCheckpoint)];
        const glm::vec3 toCp = cp - v.pos;
        const float dist = glm::length(glm::vec2(toCp.x, toCp.z));
        const float targetYaw = std::atan2(toCp.x, toCp.z);
        const float prevYaw = v.yawRad;
        v.yawRad = moveTowardAngle(v.yawRad, targetYaw, 2.85f * clampedDt);
        v.steerAngle = std::clamp(wrapAnglePi(v.yawRad - prevYaw) / clampedDt * 0.22f, -0.45f, 0.45f);
        v.speed = std::min(v.maxSpeed, v.speed + 18.5f * clampedDt);
        v.vxLocal = v.speed;
        const glm::vec3 fwd(std::sin(v.yawRad), 0.0f, std::cos(v.yawRad));
        v.pos += fwd * (v.speed * clampedDt);
        const float wRad = std::clamp(sp.height * 0.23f, 0.31f, 0.52f);
        v.wheelSpinRad = std::fmod(v.wheelSpinRad + (v.speed / wRad) * clampedDt, 6283.185f);
        v.pos.y = stepFourCornerSuspension(v, sp, 0.0f, 0.0f, false) + 0.03f;
        if (dist < 11.0f) {
          v.racerCheckpoint++;
        }
      }
    } else if (v.isAmbientTraffic && v.roadIdx < world.roads.size()) {
      // -----------------------------------------------------------------------
      // Smart Multi-Lane AI Traffic: Live Signals + IDM Car-Following + Turns!
      // -----------------------------------------------------------------------
      v.headlightsOn = darkOrWet;
      v.sirenActive = (v.kind == VehicleModelKind::PoliceCruiser && wantedStars_ >= 2);
      const auto* segPtr = &world.roads[v.roadIdx];
      if (segPtr->samples.size() >= 2) {
        const glm::vec3 fwdCur(std::sin(v.yawRad), 0.0f, std::cos(v.yawRad));
        const glm::vec3 rightCur(fwdCur.z, 0.0f, -fwdCur.x);
        const float cruiseSpeed = (v.kind == VehicleModelKind::Semi || v.kind == VehicleModelKind::Firetruck || v.kind == VehicleModelKind::Kraz)
          ? 10.5f
          : (segPtr->tier == "highway" || segPtr->tier == "arterial" ? 15.5f : 12.5f);
        float desiredSpeed = cruiseSpeed * roadGripWeather;

        // 1. Live Intersection Traffic Signal Compliance (Red / Amber stop bar)
        if (!v.sirenActive) {
          for (const auto& sig : signalNodes_) {
            const glm::vec2 toSig(sig.pos.x - v.pos.x, sig.pos.z - v.pos.z);
            const float along = toSig.x * fwdCur.x + toSig.y * fwdCur.z;
            const float lat = std::abs(toSig.x * rightCur.x + toSig.y * rightCur.z);
            if (along > 5.0f && along < 22.0f && lat < 9.5f) {
              const TrafficSignalAspect aspect = signalAspectForHeading(sig, {fwdCur.x, fwdCur.z});
              if (aspect == TrafficSignalAspect::Red || (aspect == TrafficSignalAspect::Amber && along > 9.5f)) {
                const float stopGap = std::max(0.0f, along - 6.8f);
                desiredSpeed = std::min(desiredSpeed, stopGap * 0.72f);
                if (stopGap < 1.4f) desiredSpeed = 0.0f;
              }
              break;
            }
          }
        }

        // 2. IDM Car-Following: maintain safe gap behind slower/stopped cars in same lane
        const float myHalfLen = sp.length * 0.5f;
        for (size_t oj = 0; oj < vehicles_.size(); ++oj) {
          if (oj == vi) continue;
          const auto& lead = vehicles_[oj];
          if (lead.isAircraft || lead.isBoat) continue;
          if (std::abs(lead.pos.y - v.pos.y) > 3.0f) continue;
          const glm::vec2 rel(lead.pos.x - v.pos.x, lead.pos.z - v.pos.z);
          const float along = rel.x * fwdCur.x + rel.y * fwdCur.z;
          if (along <= 0.5f || along > 24.0f) continue;
          const float lat = std::abs(rel.x * rightCur.x + rel.y * rightCur.z);
          if (lat > 2.35f) continue;
          const float leadHalfLen = vehicleSpec(lead.kind).length * 0.5f;
          const float bumperGap = along - myHalfLen - leadHalfLen;
          if (bumperGap < 3.4f) {
            desiredSpeed = 0.0f;
          } else if (bumperGap < 16.0f) {
            const float leadAlongVel = std::max(0.0f, lead.speed * ( std::sin(lead.yawRad) * fwdCur.x + std::cos(lead.yawRad) * fwdCur.z ));
            desiredSpeed = std::min(desiredSpeed, leadAlongVel + (bumperGap - 3.4f) * 0.65f);
          }
        }

        // 3. Pedestrian & on-foot Player crosswalk yielding
        if (!inVehicle()) {
          const glm::vec2 toPlayer(pPos.x - v.pos.x, pPos.z - v.pos.z);
          const float alongP = toPlayer.x * fwdCur.x + toPlayer.y * fwdCur.z;
          const float latP = std::abs(toPlayer.x * rightCur.x + toPlayer.y * rightCur.z);
          if (alongP > 1.0f && alongP < 11.5f && latP < 2.2f && std::abs(pPos.y - v.pos.y) < 2.2f) {
            desiredSpeed = 0.0f;
          }
        }

        const float prevSpd = v.speed;
        if (v.speed > desiredSpeed + 0.25f) {
          v.speed = std::max(desiredSpeed, v.speed - 16.5f * clampedDt);
          v.braking = true;
        } else {
          v.speed = std::min(desiredSpeed, v.speed + 7.5f * clampedDt);
          v.braking = (v.speed < 0.35f && desiredSpeed < 0.2f);
        }
        v.vxLocal = v.speed;

        // Advance along road spline & seamlessly turn onto connected roads at endpoints!
        const size_t curI = std::min<size_t>(static_cast<size_t>(v.samplePos), segPtr->samples.size() - 2);
        const float segStepLen = std::max(2.0f, glm::length(segPtr->samples[curI + 1].pos - segPtr->samples[curI].pos));
        const float maxS = static_cast<float>(segPtr->samples.size() - 1);
        v.samplePos += (v.forward ? 1.0f : -1.0f) * (v.speed / segStepLen) * clampedDt;

        if (v.samplePos >= maxS || v.samplePos <= 0.0f) {
          const glm::vec3 endPt = (v.samplePos >= maxS) ? segPtr->samples.back().pos : segPtr->samples.front().pos;
          bool switchedRoad = false;
          const size_t startSearch = static_cast<size_t>(v.id * 7) % std::max<size_t>(1, world.roads.size());
          for (size_t k = 0; k < world.roads.size(); ++k) {
            const size_t candIdx = (startSearch + k) % world.roads.size();
            if (candIdx == v.roadIdx || world.roads[candIdx].samples.size() < 4) continue;
            const auto& cand = world.roads[candIdx];
            if (glm::distance(glm::vec2(endPt.x, endPt.z), glm::vec2(cand.samples.front().pos.x, cand.samples.front().pos.z)) < 20.0f) {
              v.roadIdx = candIdx;
              v.samplePos = 0.25f;
              v.forward = true;
              v.laneOffset = std::clamp(cand.width * 0.26f, 2.2f, 3.8f);
              segPtr = &cand;
              switchedRoad = true;
              break;
            }
            if (glm::distance(glm::vec2(endPt.x, endPt.z), glm::vec2(cand.samples.back().pos.x, cand.samples.back().pos.z)) < 20.0f) {
              v.roadIdx = candIdx;
              v.samplePos = static_cast<float>(cand.samples.size() - 1) - 0.25f;
              v.forward = false;
              v.laneOffset = std::clamp(cand.width * 0.26f, 2.2f, 3.8f);
              segPtr = &cand;
              switchedRoad = true;
              break;
            }
          }
          if (!switchedRoad) {
            if (v.samplePos >= maxS) { v.samplePos = maxS - 0.02f; v.forward = false; }
            if (v.samplePos <= 0.0f) { v.samplePos = 0.02f; v.forward = true; }
          }
        }

        const size_t i0 = std::min<size_t>(static_cast<size_t>(std::max(0.0f, v.samplePos)), segPtr->samples.size() - 2);
        const float f = std::clamp(v.samplePos - static_cast<float>(i0), 0.0f, 1.0f);
        const auto& s0 = segPtr->samples[i0];
        const auto& s1 = segPtr->samples[i0 + 1];
        const glm::vec3 p = glm::mix(s0.pos, s1.pos, f);
        const glm::vec3 delta = s1.pos - s0.pos;
        const float dLen = glm::length(delta);
        const glm::vec3 dir = (dLen > 1e-4f) ? ((v.forward ? 1.0f : -1.0f) * (delta / dLen)) : glm::vec3(0.0f, 0.0f, 1.0f);
        const glm::vec3 rightVec = glm::normalize(glm::vec3(s0.rx, 0.0f, s0.rz) + glm::vec3(1e-5f, 0.0f, 0.0f));
        const glm::vec3 wp = p + rightVec * (v.forward ? v.laneOffset : -v.laneOffset);
        const float roadY = segPtr->isBridge ? wp.y : world.heightfield.sampleHeight(wp.x, wp.z);
        v.pos = glm::vec3(wp.x, roadY + 0.03f, wp.z);

        const float targetYaw = std::atan2(dir.x, dir.z);
        const float prevYaw = v.yawRad;
        v.yawRad = moveTowardAngle(v.yawRad, targetYaw, 4.2f * clampedDt);
        v.steerAngle = std::clamp(wrapAnglePi(v.yawRad - prevYaw) / clampedDt * 0.25f, -0.42f, 0.42f);

        const float wRad = std::clamp(sp.height * 0.23f, 0.31f, 0.54f);
        v.wheelSpinRad = std::fmod(v.wheelSpinRad + (v.speed / wRad) * clampedDt, 6283.185f);
        if (glm::distance(glm::vec2(v.pos.x, v.pos.z), glm::vec2(pPos.x, pPos.z)) < 140.0f) {
          const float lonA = (v.speed - prevSpd) / clampedDt;
          stepFourCornerSuspension(v, sp, lonA, 0.0f, false);
          if (segPtr->isBridge) v.pitchRad = v.suspPitch;
        }
      }
    } else if (v.isBoat) {
      const glm::vec3 fwd(std::sin(v.yawRad), 0.0f, std::cos(v.yawRad));
      const float wH = oceanWaveHeight(v.pos.x, v.pos.z, animClock_);
      const float wBow = oceanWaveHeight(v.pos.x + fwd.x * 2.2f, v.pos.z + fwd.z * 2.2f, animClock_);
      v.pos.y = wH + 0.05f;
      v.pitchRad = -std::atan2(wBow - wH, 2.2f);
      v.rollRad = 0.035f * std::sin(animClock_ * 1.4f + static_cast<float>(v.id));
    } else {
      // Parked land vehicle: settle suspension & keep grounded
      v.speed *= (1.0f - std::min(1.0f, 4.0f * clampedDt));
      v.vxLocal = v.speed;
      v.braking = false;
      v.headlightsOn = false;
      if (std::abs(v.suspHeave) > 0.002f || std::abs(v.suspPitch) > 0.002f) {
        stepFourCornerSuspension(v, sp, 0.0f, 0.0f, false);
      }
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

  // Clear custom GPS waypoint on arrival (when not tracking an active contract or street race)
  if (hasWaypoint_ && activeRaceIdx_ < 0 && activeContractIdx_ < 0) {
    if (glm::distance(glm::vec2(pPos.x, pPos.z), glm::vec2(waypointPos_.x, waypointPos_.z)) < 13.0f) {
      hasWaypoint_ = false;
    }
  }

  // Vehicle entry prompt when on foot
  if (!inVehicle()) {
    for (const auto& v : vehicles_) {
      if (!v.isRacer && !v.destroyed && glm::distance(pPos, v.pos) < 4.5f) {
        contextPrompt_ = std::string("[G] Enter ") + vehicleSpec(v.kind).displayName;
        break;
      }
    }
  }

  // Luxury Auto Dealership Showroom (56, -118)
  if (glm::distance(glm::vec2(pPos.x, pPos.z), glm::vec2(56.0f, -118.0f)) < 8.5f) {
    contextPrompt_ = "[B] Valet Deliver Golf R (Free)  |  [P] Browse Luxury Dealership Catalog";
    if (input.actionPressed) {
      spawnPersonalVehicle(VehicleModelKind::Golf, selectedPaintIdx_, player, world, audio, false);
    }
  }

  // Shops & Westgate Customs Garages
  for (auto& s : shops_) {
    s.robCooldown = std::max(0.0f, s.robCooldown - dt);
    if (glm::distance(glm::vec2(pPos.x, pPos.z), glm::vec2(s.pos.x, s.pos.z)) < 8.0f) {
      if (s.isGarage && inVehicle() && activeVehicleIdx_ >= 0) {
        auto& v = vehicles_[static_cast<size_t>(activeVehicleIdx_)];
        const int nextCost = 400 + v.engineStage * 300;
        if (v.engineStage < 3) {
          contextPrompt_ = "[B] Repair & Respray (Free)  |  [H] Stage " + std::to_string(v.engineStage + 1) + " Turbo ($" + std::to_string(nextCost) + ")";
        } else {
          contextPrompt_ = "[B] Repair & Respray (Free)  |  [MAX STAGE 3 TWIN-TURBO]";
        }
        if (input.actionPressed) {
          v.hp = 100.0f;
          v.destroyed = false;
          selectedPaintIdx_ = (selectedPaintIdx_ + 1) % kCustomPaintCount;
          v.colorTint = customPaintColor(selectedPaintIdx_);
          if (audio) audio->playCashChime();
          const char* pName = nullptr;
          customPaintColor(selectedPaintIdx_, &pName);
          pushToast(std::string("Westgate Customs: Repaired + Resprayed (") + (pName ? pName : "Custom") + ")!", 3.0f);
        } else if (input.secondaryAction) {
          upgradeCurrentVehicleStage(audio);
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
    const VehicleSpec& sp = vehicleSpec(v.kind);
    if (driveCamMode_ == 2 && !v.isAircraft) {
      // Hood / Bonnet camera
      const glm::vec3 vFwd(std::sin(v.yawRad), -std::sin(v.pitchRad), std::cos(v.yawRad));
      return v.pos + glm::vec3(0.0f, sp.height * 0.84f + v.suspHeave, 0.0f) + vFwd * (sp.length * 0.14f);
    }
    const float yaw = player.yaw();
    const float pitch = player.pitch();
    const glm::vec3 fwd(std::sin(yaw) * std::cos(pitch), std::sin(pitch), std::cos(yaw) * std::cos(pitch));
    const float dist = v.isAircraft ? 12.0f : (driveCamMode_ == 1 ? (8.8f + sp.length * 0.38f) : (5.8f + sp.length * 0.28f));
    const float upH = v.isAircraft ? 3.2f : (driveCamMode_ == 1 ? (2.35f + sp.height * 0.35f) : (1.65f + sp.height * 0.28f));
    return v.pos + glm::vec3(0.0f, upH + v.suspHeave * 0.45f, 0.0f) - fwd * dist;
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
    const VehicleSpec& sp = vehicleSpec(v.kind);
    if (driveCamMode_ == 2 && !v.isAircraft) {
      const glm::vec3 vFwd(std::sin(v.yawRad), -std::sin(v.pitchRad), std::cos(v.yawRad));
      return v.pos + glm::vec3(0.0f, sp.height * 0.78f + v.suspHeave, 0.0f) + vFwd * 18.0f;
    }
    return v.pos + glm::vec3(0.0f, sp.height * 0.72f + 0.35f + v.suspHeave * 0.35f, 0.0f);
  }
  return player.cameraTarget();
}

float GameSession::cameraFovDeg(bool aiming) const {
  if (inVehicle()) {
    if (const auto* cv = currentVehicle()) {
      const float spdFrac = std::clamp(std::abs(cv->speed) / 52.0f, 0.0f, 1.0f);
      return 66.0f + spdFrac * 9.0f;
    }
    return 68.0f;
  }
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
