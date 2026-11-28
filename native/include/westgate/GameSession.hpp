#pragma once
#include "westgate/AudioEngine.hpp"
#include "westgate/PhysicsWorld.hpp"
#include "westgate/PlayerController.hpp"
#include "westgate/WorldData.hpp"
#include <algorithm>
#include <array>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <glm/glm.hpp>
#include <string>
#include <vector>

namespace westgate {

enum class TimeOfDayPreset : uint8_t {
  Afternoon = 0,
  Sunset = 1,
  Night = 2,
  Dawn = 3,
};

enum class WeatherPreset : uint8_t {
  Clear = 0,
  Overcast = 1,
  Rain = 2,
  Thunderstorm = 3,
};

enum class VehicleModelKind : uint8_t {
  PoliceCruiser = 0,
  Taxi = 1,
  Sedan = 2,
  Mustang = 3,
  Ferrari = 4,
  RangeRover = 5,
  Speedboat = 6,
  CruiserBoat = 7,
  Helicopter = 8,
  Ambulance = 9,
  Firetruck = 10,
  Delivery = 11,
  Semi = 12,
  Audi = 13,
  Challenger = 14,
  R8 = 15,
  Golf = 16,
  Mercedes = 17,
  Offroad = 18,
  Kraz = 19,
};

constexpr size_t kVehicleModelCount = 20;

enum class TrafficSignalAspect : uint8_t {
  Green = 0,
  Amber = 1,
  Red = 2,
};

struct SignalIntersection {
  int id = 0;
  glm::vec3 pos{0.0f};
  int phaseOffset = 0; // 0..3 staggered 6s offsets on 24s cycle
};

struct VehicleSpec {
  VehicleModelKind kind = VehicleModelKind::Sedan;
  const char* id = "sedan";
  const char* displayName = "Executive Sedan";
  const char* glbFile = "models/sedan.glb";
  const char* category = "Sedan";
  float yawOffsetRad = 0.0f; // 0 for +Z native GLBs, pi for -Z native GLBs
  float visualScale = 1.0f;
  float width = 1.95f;
  float height = 1.45f;
  float length = 4.65f;
  float wheelbase = 2.78f;
  float maxSpeed = 38.0f;
  float accel = 18.0f;
  float brakeDecel = 28.0f;
  float grip = 1.0f;
  float driftFactor = 0.45f; // 0 = planted AWD/FWD, 1 = tail-happy RWD muscle/exotic
  int gears = 6;
  float idleRpm = 800.0f;
  float redlineRpm = 6800.0f;
  float suspOmega = 11.8f;
  float suspZeta = 0.38f;
  float pitchGain = 0.0040f;
  float rollGain = 0.0052f;
  int dealershipPrice = 12000;
  bool purchasable = true;
  bool hasEmergencyStrobe = false;
  bool isBoat = false;
  bool isAircraft = false;
};

enum class NpcModelKind : uint8_t {
  Business = 0,
  Civilian = 1,
  Police = 2,
  Security = 3,
};

enum class CrimeKind : uint8_t {
  Gunfire = 0,
  Carjack = 1,
  Assault = 2,
  Robbery = 3,
  CopHit = 4,
};

struct SkyLightingState {
  glm::vec3 clearColor{0.42f, 0.65f, 0.85f};
  glm::vec3 sunDir{0.55f, 0.72f, 0.42f};
  glm::vec3 sunColor{1.0f, 0.96f, 0.88f};
  glm::vec3 fogColor{0.58f, 0.73f, 0.86f};
  float nightFactor = 0.0f; // 0 = day, 1 = night (drives building window glow)
  float rainIntensity = 0.0f;
  float wetness = 0.0f;
  float lightningFlash = 0.0f;
};

struct WeaponSlotState {
  std::string id;
  std::string name;
  std::string shortName;
  int price = 0;
  int ammoPrice = 60;
  float damage = 25.0f;
  int pellets = 1;
  float rpm = 400.0f;
  float spread = 0.008f;
  float adsSpread = 0.002f;
  float reloadTime = 1.6f;
  float noiseRadius = 4.0f;
  bool automatic = false;
  bool suppressed = true;
  bool isMelee = false;
  bool unlocked = false;
  int magSize = 15;
  int magAmmo = 15;
  int reserveAmmo = 60;
  int reserveMax = 120;
};

struct VehicleEntity {
  int id = 0;
  VehicleModelKind kind = VehicleModelKind::Sedan;
  glm::vec3 pos{0.0f};
  float yawRad = 0.0f;
  float pitchRad = 0.0f; // composite terrain + suspension pitch (+ = nose down, - = nose up)
  float rollRad = 0.0f;  // composite terrain + suspension roll
  float verticalVel = 0.0f;
  float speed = 0.0f;      // m/s signed forward velocity
  float vxLocal = 0.0f;    // body-frame forward velocity [m/s]
  float vyLocal = 0.0f;    // body-frame lateral velocity [m/s] (+ = left)
  float yawRate = 0.0f;    // angular velocity [rad/s]
  float steerAngle = 0.0f; // front wheel steer angle [rad] (+ = left)
  float wheelSpinRad = 0.0f; // cumulative tire rotation [rad]
  float suspHeave = 0.0f;
  float suspHeaveVel = 0.0f;
  float suspPitch = 0.0f;
  float suspPitchVel = 0.0f;
  float suspRoll = 0.0f;
  float suspRollVel = 0.0f;
  std::array<float, 4> wheelSuspOffsets{0.0f, 0.0f, 0.0f, 0.0f}; // FL, FR, RL, RR
  float rpm = 850.0f;
  int gear = 1;            // -1 = R, 0 = N, 1..8
  float shiftTimer = 0.0f;
  float slipIntensity = 0.0f; // 0..1 tire slip / drift intensity
  glm::vec3 colorTint{1.0f};
  float hp = 100.0f;
  float maxSpeed = 34.0f;
  float accel = 18.0f;
  int engineStage = 0;     // 0..3 Westgate Customs tuning stage
  bool braking = false;
  bool handbrakeDown = false;
  bool sirenActive = false;
  bool headlightsOn = false;
  bool destroyed = false;
  float wreckTimer = 0.0f;
  float smokeEmitAccum = 0.0f;
  bool occupiedByPlayer = false;
  bool isAmbientTraffic = false;
  bool isPolicePursuit = false;
  bool isRacer = false;
  bool isBoat = false;
  bool isAircraft = false;
  float rotorAngleRad = 0.0f;
  float rotorRpm01 = 0.0f;
  int racerRank = 0;
  int racerCheckpoint = 0;
  size_t roadIdx = 0;
  float samplePos = 0.0f;
  bool forward = true;
  float laneOffset = 3.1f;
  bool airborne = false;
  glm::vec3 airStartPos{0.0f};
  float airPeakY = 0.0f;
};

struct NpcEntity {
  int id = 0;
  NpcModelKind kind = NpcModelKind::Civilian;
  glm::vec3 pos{0.0f};
  float yawRad = 0.0f;
  float hp = 100.0f;
  float maxHp = 100.0f;
  glm::vec3 colorTint{1.0f};
  std::string animClip = "Idle";
  float animTime = 0.0f;
  float attackCooldown = 1.5f;
  float hitFlash = 0.0f;
  bool alive = true;
  float deadTimer = 0.0f;
  bool fleeing = false;
  bool isPolice = false;
  bool isContractTarget = false;
  bool isContractGuard = false;
  int contractIdx = -1;
  size_t roadIdx = 0;
  float samplePos = 0.0f;
  bool forward = true;
  glm::vec3 homePos{0.0f};
};

struct IronPitFighterDef {
  std::string name;
  std::string style;
  std::string record;
  float power = 1.0f;
  float speed = 1.0f;
  float defense = 1.0f;
  glm::vec3 skinTint{0.82f, 0.65f, 0.52f};
  glm::vec3 shortsTint{0.85f, 0.15f, 0.18f};
  glm::vec3 hairTint{0.10f, 0.08f, 0.07f};
};

struct IronPitCardMatch {
  int redIdx = 0;
  int blueIdx = 1;
  float redOdds = 1.85f;
  float blueOdds = 1.95f;
  float koPropOdds = 2.60f;
  bool settled = false;
};

struct SpectatorFighterState {
  int fighterIdx = 0;
  float hp = 120.0f;
  float maxHp = 120.0f;
  glm::vec3 pos{0.0f};
  float yawRad = 0.0f;
  std::string animClip = "fight_idle";
  float animTime = 0.0f;
  float attackCooldown = 1.0f;
  float hitFlash = 0.0f;
  bool hitApplied = false;
  bool downed = false;
};

struct SpectatorBoutState {
  bool active = false;
  int matchIdx = 0;
  SpectatorFighterState red;
  SpectatorFighterState blue;
  float elapsed = 0.0f;
  int winnerCorner = -1; // -1 none, 0 red, 1 blue
  int betCorner = 0;
  int betWager = 0;
  bool quickKoProp = false;
  float endBannerTimer = 0.0f;
};

struct IronPitState {
  int tier = 1;
  std::string opponentName = "\"Scrapyard\" Rico";
  glm::vec3 skinTint{0.80f, 0.62f, 0.48f};
  glm::vec3 shortsTint{0.84f, 0.16f, 0.16f};
  glm::vec3 hairTint{0.09f, 0.07f, 0.06f};
  float hp = 110.0f;
  float maxHp = 110.0f;
  int purse = 500;
  glm::vec3 pos{722.0f, 3.4f, 118.0f};
  float yawRad = 3.14159f;
  std::string animClip = "fight_idle";
  float animTime = 0.0f;
  float attackCooldown = 1.6f;
  float hitFlash = 0.0f;
  bool hitApplied = false;
  bool defeated = false;
  int wins = 0;
  int winStreak = 0;
  int betWager = 0;
  float betOdds = 1.65f;
  bool betActive = false;
  int betWins = 0;
  int betProfit = 0;
};

struct ContractDef {
  std::string id;
  std::string code;
  std::string title;
  std::string targetName;
  std::string district;
  glm::vec3 targetPos{0.0f};
  int rewardBase = 3000;
  int unseenBonus = 1000;
  bool completed = false;
};

struct StreetRaceDef {
  std::string id;
  std::string name;
  glm::vec3 startPos{0.0f};
  float startYaw = 0.0f;
  std::vector<glm::vec3> checkpoints;
  int rewardFirst = 1500;
  bool won = false;
};

struct StuntJumpDef {
  std::string id;
  std::string name;
  glm::vec3 pos{0.0f};
  float yawRad = 0.0f;
  bool completed = false;
};

struct ShopDef {
  std::string id;
  std::string name;
  glm::vec3 pos{0.0f};
  bool isGarage = false;
  float robCooldown = 0.0f;
};

struct BulletTracer {
  glm::vec3 start{0.0f};
  glm::vec3 end{0.0f};
  glm::vec3 color{1.0f, 0.88f, 0.35f};
  float ttl = 0.09f;
};

struct SparkParticle {
  glm::vec3 pos{0.0f};
  glm::vec3 vel{0.0f};
  glm::vec3 color{1.0f, 0.78f, 0.28f};
  float ttl = 0.35f;
  float size = 0.08f;
};

struct DynamicPointLight {
  glm::vec3 pos{0.0f};
  float radius = 12.0f;
  glm::vec3 color{1.0f};
  float intensity = 1.0f;
};

struct GameInputFrame {
  PlayerInputState moveInput{};
  bool fireDown = false;
  bool firePressed = false;
  bool aimDown = false;
  bool reloadPressed = false;
  bool interactPressed = false;   // G: Enter/Exit vehicle
  bool actionPressed = false;     // B: Shop / Garage / Start Race
  bool secondaryAction = false;   // H: Horn/Siren or Rob Store
  bool uppercutPressed = false;   // Q
  bool kickPressed = false;       // E
  bool dodgePressed = false;      // X
  bool rematchPressed = false;    // R (when unarmed near pit)
  bool takedownPressed = false;   // V (silent takedown on unaware/flanked NPC)
  bool grapplePressed = false;    // Z (collar-tie clinch / body slam)
  bool takedownShootPressed = false; // U (double-leg takedown / guillotine choke)
  int selectWeaponSlot = -1;      // 0..5 or -1
};

struct WorldMarkerBox {
  glm::vec3 pos{0.0f};
  glm::vec3 scale{1.0f};
  float yawRad = 0.0f;
  glm::vec3 color{1.0f};
  float pitchRad = 0.0f;
};

class GameSession {
public:
  void init(const WorldData& world, PlayerController* player, PhysicsWorld* physics);
  void update(float dt, const GameInputFrame& input, PlayerController& player, PhysicsWorld& physics, const WorldData& world, AudioEngine* audio);

  // Actions callable from HUD / Tactical Phone
  void setTimeOfDayPreset(TimeOfDayPreset preset);
  void cycleTimeOfDay();
  void setWeatherPreset(WeatherPreset preset);
  void cycleWeather();
  WeatherPreset weatherPreset() const { return weatherPreset_; }
  std::string weatherLabel() const;
  float rainIntensity() const { return rainIntensity_; }
  float wetness() const { return wetness_; }
  static float oceanWaveHeight(float x, float z, float timeSec);
  void acceptContract(int idx, const WorldData& world);
  void startStreetRace(int idx, PlayerController& player, const WorldData& world);
  void cancelRace();
  bool buyWeaponOrAmmo(int slotIdx, AudioEngine* audio);
  bool buyArmorAndMedkit(AudioEngine* audio);
  void teleportTo(const glm::vec3& pos, float yawDeg, PlayerController& player);

  // Vehicle Catalog, Dealership, Personal Garage & Traffic Signals
  static const VehicleSpec& vehicleSpec(VehicleModelKind kind);
  static const glm::vec3& customPaintColor(int paintIdx, const char** outName = nullptr);
  static constexpr int kCustomPaintCount = 8;
  bool ownsVehicle(VehicleModelKind kind) const;
  bool buyDealershipVehicle(VehicleModelKind kind, AudioEngine* audio);
  int spawnPersonalVehicle(VehicleModelKind kind, int paintIdx, PlayerController& player, const WorldData& world, AudioEngine* audio, bool autoBoard = false);
  bool upgradeCurrentVehicleStage(AudioEngine* audio);
  void damageVehicle(size_t vehIdx, float amount, const WorldData& world, PlayerController* player, AudioEngine* audio, bool fromPlayer = false);
  const std::vector<SignalIntersection>& signalIntersections() const { return signalNodes_; }
  TrafficSignalAspect signalAspectForHeading(const SignalIntersection& node, const glm::vec2& headingXZ) const;
  void cycleDriveCameraMode() { driveCamMode_ = (driveCamMode_ + 1) % 3; }
  int driveCameraMode() const { return driveCamMode_; }
  int selectedPaintIdx() const { return selectedPaintIdx_; }
  void setSelectedPaintIdx(int idx) { selectedPaintIdx_ = std::clamp(idx, 0, kCustomPaintCount - 1); }
  int activePersonalVehicleId() const { return activePersonalVehicleId_; }
  void grantVehicleOwnership(VehicleModelKind kind) {
    const size_t idx = static_cast<size_t>(kind);
    if (idx < kVehicleModelCount) ownedVehicles_[idx] = true;
  }

  // Persistence
  bool saveToFile(const std::string& path) const;
  bool loadFromFile(const std::string& path);

  // Queries for Renderer & HUD
  SkyLightingState skyLighting() const;
  std::vector<WorldMarkerBox> gatherWorldMarkers(float elapsedSec) const;
  std::vector<DynamicPointLight> gatherDynamicLights(const WorldData& world, const PlayerController& player, float elapsedSec) const;

  const std::vector<WeaponSlotState>& weapons() const { return weapons_; }
  int activeWeaponIdx() const { return activeWeapon_; }
  const WeaponSlotState& activeWeapon() const { return weapons_[static_cast<size_t>(activeWeapon_)]; }

  const std::vector<VehicleEntity>& vehicles() const { return vehicles_; }
  const std::vector<NpcEntity>& npcs() const { return npcs_; }
  const IronPitState& ironPit() const { return ironPit_; }
  const std::vector<IronPitFighterDef>& pitRoster() const { return pitRoster_; }
  const std::vector<IronPitCardMatch>& pitCard() const { return pitCard_; }
  const SpectatorBoutState& spectatorBout() const { return spectatorBout_; }
  const std::vector<ContractDef>& contracts() const { return contracts_; }
  const std::vector<StreetRaceDef>& races() const { return races_; }
  const std::vector<StuntJumpDef>& stuntJumps() const { return stuntJumps_; }
  const std::vector<ShopDef>& shops() const { return shops_; }
  const std::vector<BulletTracer>& tracers() const { return tracers_; }
  const std::vector<SparkParticle>& sparks() const { return sparks_; }

  float playerHp() const { return playerHp_; }
  float playerMaxHp() const { return playerMaxHp_; }
  float playerArmor() const { return playerArmor_; }
  float playerStamina() const { return playerStamina_; }
  int playerCash() const { return playerCash_; }
  float playerHitFlash() const { return playerHitFlash_; }
  float hitmarkerTimer() const { return hitmarkerTimer_; }

  bool inVehicle() const { return activeVehicleIdx_ >= 0; }
  const VehicleEntity* currentVehicle() const {
    return (activeVehicleIdx_ >= 0 && activeVehicleIdx_ < static_cast<int>(vehicles_.size()))
             ? &vehicles_[static_cast<size_t>(activeVehicleIdx_)]
             : nullptr;
  }

  int wantedStars() const { return wantedStars_; }
  float wantedEvadeProgress() const { return wantedStars_ > 0 ? std::clamp(wantedEvadeTimer_ / 18.0f, 0.0f, 1.0f) : 0.0f; }

  int activeContractIdx() const { return activeContractIdx_; }
  int activeRaceIdx() const { return activeRaceIdx_; }
  int activeRaceCheckpoint() const { return raceCheckpointIdx_; }
  float activeRaceTime() const { return raceElapsed_; }
  int activeRacePlace() const { return racePlace_; }

  bool hasGpsWaypoint() const { return hasWaypoint_; }
  glm::vec3 gpsWaypoint() const { return waypointPos_; }
  std::string gpsLabel() const { return waypointLabel_; }
  void setGpsWaypoint(const glm::vec3& pos, const std::string& label);

  float timeOfDayHours() const { return timeOfDayHours_; }
  std::string timeOfDayLabel() const;

  const std::string& contextPrompt() const { return contextPrompt_; }
  const std::string& toastText() const { return toastText_; }
  float toastTimer() const { return toastTimer_; }
  bool takedownReady() const { return takedownReady_; }
  int stealthKills() const { return stealthKills_; }
  bool inClinch() const { return inClinch_; }

  // Camera resolved for either on-foot or driving
  glm::vec3 cameraPosition(const PlayerController& player) const;
  glm::vec3 cameraTarget(const PlayerController& player) const;
  float cameraFovDeg(bool aiming) const;

  // Player animation clip evaluation helpers
  std::string playerAnimClip(const PlayerController& player, bool blocking) const;
  float playerAnimTime() const { return animClock_; }
  float playerLocomotionTime() const { return playerLocomotionClock_; }
  std::string playerAttackClip() const { return playerAttackClip_; }
  float playerAttackTime() const { return playerAttackTimer_; }
  float playerAttackDuration() const {
    if (playerAttackClip_ == "uppercut" || playerAttackClip_ == "kick") return 0.85f;
    if (playerAttackClip_ == "dodge") return 0.52f;
    return 0.58f;
  }
  float playerAttackProgress() const {
    return playerAttackClip_.empty() ? 0.0f : std::clamp(playerAttackTimer_ / playerAttackDuration(), 0.0f, 1.0f);
  }
  float playerHitAnimProgress() const {
    return (playerHitAnimTimer_ > 0.0f) ? std::clamp(1.0f - playerHitAnimTimer_ / 0.45f, 0.0f, 1.0f) : 0.0f;
  }
  bool isAiming() const { return aiming_; }
  bool isRangedWeapon() const { return !weapons_[static_cast<size_t>(activeWeapon_)].isMelee; }
  bool isTwoHandedWeapon() const {
    const auto& w = weapons_[static_cast<size_t>(activeWeapon_)];
    return !w.isMelee && w.id != "pistol_sd";
  }
  float recoilImpulse() const { return recoilImpulse_; }
  float reloadProgress() const {
    const auto& w = weapons_[static_cast<size_t>(activeWeapon_)];
    return (reloadTimer_ > 0.0f && w.reloadTime > 0.01f) ? std::clamp(1.0f - reloadTimer_ / w.reloadTime, 0.0f, 1.0f) : 0.0f;
  }
  bool isDodging() const { return playerDodgeTimer_ > 0.0f; }
  bool placeIronPitBet(int wager);
  bool buyCutmanHeal();
  bool startSpectatorBout(int matchIdx, int pickCorner, int wager, bool quickKoProp, const WorldData& world, AudioEngine* audio);
  void refreshFightCard();

private:
  void spawnSparks(const glm::vec3& pos, const glm::vec3& normal, const glm::vec3& color, int count);
  void pushToast(const std::string& msg, float duration = 3.5f);
  void reportCrime(CrimeKind kind, const glm::vec3& pos, const WorldData& world);
  void spawnIronPitTier(int tier, const WorldData& world);
  void fireActiveWeapon(PlayerController& player, PhysicsWorld& physics, const WorldData& world, AudioEngine* audio);
  void damagePlayer(float amount, const WorldData& world, PlayerController& player, AudioEngine* audio);
  int findTakedownNpcIndex(const glm::vec3& playerPos) const;
  bool trySilentTakedown(PlayerController& player, const WorldData& world, AudioEngine* audio);
  void updateTrafficAndVehicles(float dt, const GameInputFrame& input, PlayerController& player, PhysicsWorld& physics, const WorldData& world, AudioEngine* audio);
  void updateNpcsAndPolice(float dt, PlayerController& player, PhysicsWorld& physics, const WorldData& world, AudioEngine* audio);
  void updateIronPit(float dt, const GameInputFrame& input, PlayerController& player, const WorldData& world, AudioEngine* audio);
  void updateSpectatorBout(float dt, const WorldData& world, AudioEngine* audio);
  void updateActivitiesAndShops(float dt, const GameInputFrame& input, PlayerController& player, const WorldData& world, AudioEngine* audio);

  std::vector<WeaponSlotState> weapons_;
  int activeWeapon_ = 0; // 0 = Boxing / Unarmed, 1 = Apex P226-SD
  float fireCooldown_ = 0.0f;
  float reloadTimer_ = 0.0f;

  float playerHp_ = 100.0f;
  float playerMaxHp_ = 100.0f;
  float playerArmor_ = 50.0f;
  float playerStamina_ = 100.0f;
  int playerCash_ = 650;
  float playerHitFlash_ = 0.0f;
  float hitmarkerTimer_ = 0.0f;
  bool aiming_ = false;

  // Melee combat & procedural weapon animation state
  int comboStep_ = 0;
  std::string playerAttackClip_;
  float playerAttackTimer_ = 0.0f;
  bool playerAttackHitDone_ = false;
  float playerDodgeTimer_ = 0.0f;
  float playerHitAnimTimer_ = 0.0f;
  float takedownCooldown_ = 0.0f;
  bool takedownReady_ = false;
  int stealthKills_ = 0;
  bool inClinch_ = false;
  float clinchTimer_ = 0.0f;
  float recoilImpulse_ = 0.0f;
  float animClock_ = 0.0f;
  float playerLocomotionClock_ = 0.0f;

  // Vehicle driving state, traffic signals & garage ownership
  std::vector<VehicleEntity> vehicles_;
  std::vector<SignalIntersection> signalNodes_;
  std::array<bool, kVehicleModelCount> ownedVehicles_{};
  int activePersonalVehicleId_ = -1;
  int selectedPaintIdx_ = 2;
  int driveCamMode_ = 0; // 0 = chase near, 1 = chase far, 2 = hood/bonnet cam
  int activeVehicleIdx_ = -1;
  float sirenCooldown_ = 0.0f;

  // NPCs, Police, Contracts
  std::vector<NpcEntity> npcs_;
  int nextNpcId_ = 1;
  int nextVehicleId_ = 1;

  int wantedStars_ = 0;
  float wantedHeat_ = 0.0f;
  float wantedEvadeTimer_ = 0.0f;
  float policeSpawnCooldown_ = 0.0f;

  IronPitState ironPit_;
  std::vector<IronPitFighterDef> pitRoster_;
  std::vector<IronPitCardMatch> pitCard_;
  SpectatorBoutState spectatorBout_;
  std::vector<ContractDef> contracts_;
  int activeContractIdx_ = -1;
  bool contractSeenByWitness_ = false;

  std::vector<StreetRaceDef> races_;
  int activeRaceIdx_ = -1;
  int raceCheckpointIdx_ = 0;
  float raceElapsed_ = 0.0f;
  int racePlace_ = 1;

  std::vector<StuntJumpDef> stuntJumps_;
  std::vector<ShopDef> shops_;
  std::vector<BulletTracer> tracers_;
  std::vector<SparkParticle> sparks_;
  float muzzleFlashTimer_ = 0.0f;
  glm::vec3 muzzleFlashPos_{0.0f};

  bool hasWaypoint_ = true;
  glm::vec3 waypointPos_{722.0f, 2.8f, 115.0f};
  std::string waypointLabel_ = "Iron Pit Arena";

  float timeOfDayHours_ = 14.5f; // 2:30 PM sunny afternoon
  bool autoAdvanceTime_ = true;
  WeatherPreset weatherPreset_ = WeatherPreset::Clear;
  float rainIntensity_ = 0.0f;
  float wetness_ = 0.0f;
  float lightningFlash_ = 0.0f;
  float thunderCooldown_ = 6.0f;
  glm::vec3 lastCamFocus_{0.0f};

  std::string contextPrompt_;
  std::string toastText_;
  float toastTimer_ = 0.0f;
  uint32_t rng_ = 0x9E3779B9u;
};

} // namespace westgate
