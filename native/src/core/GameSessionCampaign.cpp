#include "westgate/GameSession.hpp"
#include <algorithm>
#include <cmath>

namespace westgate {

namespace {

struct RawMissionSite {
  int missionId;
  float x, y, z;
  float yaw;
  float approachX, approachZ;
  const char* district;
};

constexpr RawMissionSite kMissionSites[7] = {
  {0, -238.0f, 4.20f,  295.0f, 0.0f,        -238.0f,  309.0f, "Old Quarter Safehouse"},
  {1, -210.0f, 4.35f,  175.0f, 0.0f,        -210.0f,  221.0f, "Highland Estate / Old Quarter"},
  {2, -460.0f, 4.40f,   70.0f, 0.0f,        -460.0f,  116.0f, "Midtown Construction Vault"},
  {3,  -60.0f, 4.48f, -390.0f, 0.0f,         -60.0f, -344.0f, "Downtown Financial Core"},
  {4,  695.0f, 2.80f,  465.0f, 3.14159265f,  695.0f,  419.0f, "Eastgate Seaport Docks"},
  {5,  400.0f, 4.40f, -120.0f, 0.0f,         400.0f,  -76.0f, "East Downtown - Apex HQ"},
  {6, -500.0f, 4.40f, -420.0f, 0.0f,        -500.0f, -350.0f, "Mount Ironridge Citadel"},
};

glm::vec3 siteLocalToWorld(const RawMissionSite& site, const WorldData& world, float lx, float ly, float lz) {
  const float c = std::cos(site.yaw);
  const float s = std::sin(site.yaw);
  const float wx = std::clamp(site.x + lx * c + lz * s, world.worldMin + 18.0f, world.worldMax - 18.0f);
  const float wz = std::clamp(site.z - lx * s + lz * c, world.worldMin + 18.0f, world.worldMax - 18.0f);
  const float groundY = std::max(world.heightfield.sampleHeight(wx, wz), site.y);
  return {wx, groundY + ly, wz};
}

struct BossTauntSpec {
  const char* name;
  float hp;
  const char* engageLine;
  const char* engageMp3;
  const char* phaseBanner;
  const char* phaseLine;
  const char* phaseMp3;
};

constexpr BossTauntSpec kBossSpecs[4] = {
  {
    "Commander Ren",
    240.0f,
    "Lock down the pier! Nobody leaves this ship with Thorne's bullion!",
    "audio/bosses/boss_ren_engage.mp3",
    "COMMANDER REN: DECK SMOKE & PIER REINFORCEMENTS!",
    "Pop smoke on the upper deck! Seal the bridge and box him in!",
    "audio/bosses/boss_ren_smoke.mp3",
  },
  {
    "Viktor Kroll",
    280.0f,
    "Found the little ghost. Snipers, light up the street!",
    "audio/bosses/boss_kroll_engage.mp3",
    "VIKTOR KROLL: STUN FLASH & NVG SWEEP!",
    "Drop stunners in the courtyard! Floodlights up, sweep every corner!",
    "audio/bosses/boss_kroll_flash.mp3",
  },
  {
    "Viktor Sorin",
    340.0f,
    "You brought one suit and a traitor into my building, Voss? Lock the atrium!",
    "audio/bosses/boss_sorin_engage.mp3",
    "VIKTOR SORIN: ATRIUM LOCKDOWN SURGE!",
    "Override gamma! Trigger lobby lockdown surge and deploy security strike teams!",
    "audio/bosses/boss_sorin_lockdown.mp3",
  },
  {
    "General Drago Kovac",
    450.0f,
    "Praetorians, seal the east vault! Bring me Voss!",
    "audio/bosses/boss_kovac_engage.mp3",
    "GENERAL KOVAC: IRONRIDGE MORTAR BARRAGE!",
    "Ironridge Battery, fire for effect on my courtyard coordinates! Shell his cover!",
    "audio/bosses/boss_kovac_mortar.mp3",
  },
};

const BossTauntSpec* findBossSpec(const std::string& bossName) {
  for (const auto& b : kBossSpecs) {
    if (bossName == b.name) return &b;
  }
  return nullptr;
}

} // namespace

const char* GameSession::difficultyLabel(DifficultyMode mode) {
  switch (mode) {
    case DifficultyMode::Operative: return "OPERATIVE (1.0x)";
    case DifficultyMode::Veteran:   return "VETERAN (+25% Reward)";
    case DifficultyMode::Shadow:    return "SHADOW (+60% Reward)";
  }
  return "OPERATIVE";
}

void GameSession::setDifficulty(DifficultyMode mode) {
  difficulty_ = mode;
}

float GameSession::difficultyHpMult() const {
  switch (difficulty_) {
    case DifficultyMode::Operative: return 1.0f;
    case DifficultyMode::Veteran:   return 1.20f;
    case DifficultyMode::Shadow:    return 1.38f;
  }
  return 1.0f;
}

float GameSession::difficultyDamageMult() const {
  switch (difficulty_) {
    case DifficultyMode::Operative: return 1.0f;
    case DifficultyMode::Veteran:   return 1.25f;
    case DifficultyMode::Shadow:    return 1.55f;
  }
  return 1.0f;
}

float GameSession::difficultyRewardMult() const {
  switch (difficulty_) {
    case DifficultyMode::Operative: return 1.0f;
    case DifficultyMode::Veteran:   return 1.25f;
    case DifficultyMode::Shadow:    return 1.60f;
  }
  return 1.0f;
}

const char* GameSession::bodyStatName(BodyStatKind stat) {
  switch (stat) {
    case BodyStatKind::Speed:        return "Speed";
    case BodyStatKind::Stamina:      return "Stamina";
    case BodyStatKind::Strength:     return "Strength";
    case BodyStatKind::Toughness:    return "Toughness";
    case BodyStatKind::Agility:      return "Agility";
    case BodyStatKind::Stealth:      return "Stealth";
    case BodyStatKind::Marksmanship: return "Marksmanship";
    case BodyStatKind::Lung:         return "Lung Capacity";
  }
  return "Stat";
}

const char* GameSession::bodyStatShort(BodyStatKind stat) {
  switch (stat) {
    case BodyStatKind::Speed:        return "SPD";
    case BodyStatKind::Stamina:      return "STM";
    case BodyStatKind::Strength:     return "STR";
    case BodyStatKind::Toughness:    return "TGH";
    case BodyStatKind::Agility:      return "AGL";
    case BodyStatKind::Stealth:      return "STL";
    case BodyStatKind::Marksmanship: return "MRK";
    case BodyStatKind::Lung:         return "LNG";
  }
  return "STA";
}

void GameSession::addBodyStatXp(BodyStatKind stat, float xpAmount) {
  if (xpAmount <= 0.0f) return;
  const size_t idx = static_cast<size_t>(stat);
  if (idx >= kBodyStatCount) return;
  if (bodyStats_[idx] >= 100.0f) return;

  bodyStatsXp_[idx] += xpAmount;
  const float needed = 35.0f + bodyStats_[idx] * 1.4f;
  while (bodyStatsXp_[idx] >= needed && bodyStats_[idx] < 100.0f) {
    bodyStatsXp_[idx] -= needed;
    bodyStats_[idx] = std::min(100.0f, bodyStats_[idx] + 1.0f);
    recomputePlayerDerivedStats();
    pushToast(std::string(bodyStatName(stat)) + " increased to " + std::to_string(static_cast<int>(bodyStats_[idx])) + "/100!", 2.4f);
  }
}

int GameSession::upgradeLevel(const std::string& id) const {
  for (size_t i = 0; i < techUpgrades_.size() && i < upgradeLevels_.size(); ++i) {
    if (techUpgrades_[i].id == id) return upgradeLevels_[i];
  }
  return 0;
}

float GameSession::upgradeDamageMult() const {
  static constexpr float kMult[5] = {1.0f, 1.12f, 1.24f, 1.38f, 1.55f};
  return kMult[std::clamp(upgradeLevel("barrel_damage"), 0, 4)];
}

float GameSession::upgradeNoiseMult() const {
  static constexpr float kMult[5] = {1.0f, 0.84f, 0.70f, 0.58f, 0.46f};
  const float stealthFactor = 1.0f - 0.24f * (bodyStatValue(BodyStatKind::Stealth) / 100.0f);
  return kMult[std::clamp(upgradeLevel("silencer_baffle"), 0, 4)] * stealthFactor;
}

float GameSession::upgradeFireRateMult() const {
  static constexpr float kMult[5] = {1.0f, 1.08f, 1.16f, 1.25f, 1.35f};
  return kMult[std::clamp(upgradeLevel("bolt_cycling"), 0, 4)];
}

float GameSession::upgradeDamageTakenMult() const {
  static constexpr float kMult[5] = {1.0f, 0.90f, 0.80f, 0.70f, 0.60f};
  const float toughFactor = 1.0f - 0.18f * (bodyStatValue(BodyStatKind::Toughness) / 100.0f);
  return kMult[std::clamp(upgradeLevel("kevlar_weave"), 0, 4)] * toughFactor;
}

float GameSession::upgradeSuspicionMult() const {
  static constexpr float kMult[5] = {1.0f, 0.86f, 0.72f, 0.60f, 0.48f};
  const float stealthFactor = 1.0f - 0.22f * (bodyStatValue(BodyStatKind::Stealth) / 100.0f);
  return kMult[std::clamp(upgradeLevel("optical_camo"), 0, 4)] * stealthFactor;
}

void GameSession::recomputePlayerDerivedStats() {
  static constexpr float kPlateHp[5] = {100.0f, 120.0f, 145.0f, 175.0f, 210.0f};
  const float plateBase = kPlateHp[std::clamp(upgradeLevel("ballistic_plates"), 0, 4)];
  const float toughBonus = (bodyStatValue(BodyStatKind::Toughness) / 100.0f) * 50.0f;
  const float prevMax = playerMaxHp_;
  playerMaxHp_ = plateBase + toughBonus;
  if (playerMaxHp_ > prevMax) {
    playerHp_ = std::min(playerMaxHp_, playerHp_ + (playerMaxHp_ - prevMax));
  } else {
    playerHp_ = std::min(playerHp_, playerMaxHp_);
  }

  // Reapply High-Cap Magazines upgrade across all ranged weapons
  for (size_t i = 0; i < weapons_.size(); ++i) {
    auto& w = weapons_[i];
    if (w.isMelee) continue;
    configureWeaponSlot(static_cast<int>(i), w.optic, w.muzzle, w.underbarrel, w.mag, w.finish);
    static constexpr float kCapMult[5] = {1.0f, 1.15f, 1.30f, 1.45f, 1.60f};
    const float mult = kCapMult[std::clamp(upgradeLevel("extended_mags"), 0, 4)];
    w.magSize = std::max(1, static_cast<int>(std::round(static_cast<float>(w.magSize) * mult)));
    w.magAmmo = std::min(w.magAmmo, w.magSize);
  }
}

bool GameSession::buyTechUpgrade(size_t upgradeIdx, AudioEngine* audio) {
  if (upgradeIdx >= techUpgrades_.size() || upgradeIdx >= upgradeLevels_.size()) return false;
  const auto& def = techUpgrades_[upgradeIdx];
  const int curLvl = upgradeLevels_[upgradeIdx];
  if (curLvl >= def.maxLevel) {
    pushToast(def.name + " is already at MAX Tier!", 2.4f);
    return false;
  }
  const int cCost = def.dollarCosts[static_cast<size_t>(curLvl)];
  if (playerCash_ < cCost) {
    pushToast("Insufficient funds! Need $" + std::to_string(cCost) + " for " + def.name, 3.0f);
    return false;
  }
  playerCash_ -= cCost;
  recordBankEntry(-cCost, def.category + " Upgrade: " + def.name + " T" + std::to_string(curLvl + 1));
  upgradeLevels_[upgradeIdx] = curLvl + 1;
  recomputePlayerDerivedStats();
  if (audio) audio->playCashChime();
  pushToast("UPGRADED: " + def.name + " -> Tier " + std::to_string(curLvl + 1) +
            " (" + def.effectLabels[static_cast<size_t>(curLvl)] + ", -$" + std::to_string(cCost) + ")", 3.2f);
  return true;
}

void GameSession::initCampaignAndProgression(const WorldData& world) {
  upgradeLevels_.fill(0);
  bodyStats_ = {12.0f, 15.0f, 12.0f, 10.0f, 12.0f, 15.0f, 14.0f, 10.0f};
  bodyStatsXp_.fill(0.0f);
  storyStep_ = 1;
  epilogueChoice_ = EpilogueChoice::None;
  activeMission_ = ActiveCampaignMission{};
  activeSurveillance_ = ActiveSurveillanceState{};
  lastDebrief_ = MissionDebriefReport{};

  // Purchased strictly in the open world:
  // [0..3] Weapons -> Open-World Gunsmith Armory Benches
  // [4..7] Armour / Stealth / Precision -> Open-World Clothing Boutiques & Walk-In Wardrobes
  techUpgrades_ = {
    {"barrel_damage",   "Weapons",   "Subsonic Hollow-Point",     "Heavy-jacketed subsonic rounds boost ballistic damage", 4,
      {350, 700, 1150, 1750}, {"+12% Damage", "+24% Damage", "+38% Damage", "+55% Damage"}},
    {"silencer_baffle", "Weapons",   "Titanium Baffle Core",      "Multi-stage suppressor baffles shrink gunshot noise",   4,
      {320, 640, 1050, 1600}, {"-16% Shot Noise", "-30% Shot Noise", "-42% Shot Noise", "-54% Shot Noise"}},
    {"extended_mags",   "Weapons",   "High-Cap Magazines",        "Expanded magazine wells across all suppressed weapons", 4,
      {300, 600, 980, 1500},  {"+15% Capacity", "+30% Capacity", "+45% Capacity", "+60% Capacity"}},
    {"bolt_cycling",    "Weapons",   "Match-Grade Bolt",          "Polished carrier group increases cyclic fire rate",     4,
      {340, 680, 1100, 1680}, {"+8% Fire Rate", "+16% Fire Rate", "+25% Fire Rate", "+35% Fire Rate"}},
    {"ballistic_plates","Armour",    "Ceramic Ballistic Plates",  "Reinforced chest & back inserts raise operator Max HP", 4,
      {380, 750, 1250, 1900}, {"120 Max HP", "145 Max HP", "175 Max HP", "210 Max HP"}},
    {"kevlar_weave",    "Armour",    "Reactive Kevlar Weave",     "Aramid trauma liner reduces incoming combat damage",    4,
      {360, 720, 1180, 1800}, {"-10% Dmg Taken", "-20% Dmg Taken", "-30% Dmg Taken", "-40% Dmg Taken"}},
    {"optical_camo",    "Stealth",   "Acoustic Stealth Lining",   "Low-signature suit lining slows guard suspicion buildup", 4,
      {400, 780, 1300, 1950}, {"-14% Detection", "-28% Detection", "-40% Detection", "-52% Detection"}},
    {"neural_sync",     "Precision", "Stabilized Shooting Cuffs", "Tailored wrist stabilizers tighten ADS spread & reload", 4,
      {420, 820, 1350, 2050}, {"-15% ADS Spread", "-28% ADS Spread", "-40% ADS Spread", "-52% ADS Spread"}},
  };

  auto beaconAt = [&](float x, float z, float minY = 2.8f) -> glm::vec3 {
    const float y = std::max(world.heightfield.sampleHeight(x, z), minY);
    return {x, y, z};
  };

  storyChapters_ = {
    {
      0, "00", "PROLOGUE", false, 0, -1, "V",
      "CALIBRATION", "Safehouse Range", "Mara Vance (Broker)", "Old Quarter Safehouse",
      "Zero your suppressed rifle on steel targets and verify CQC readiness before touching the Sovereign Ledger.",
      "Training - Suppressed Ballistics & Stealth",
      beaconAt(kMissionSites[0].approachX, kMissionSites[0].approachZ, 4.0f), {0.18f, 0.83f, 0.75f},
      "MARA VANCE", "Safehouse range is hot, Voss. Zero your suppressors before we touch Sterling's ledger.", "audio/chapters/ch00_intro.mp3",
      "MARA VANCE", "Calibration complete. Your first live file is Highland Estate - Paper Trail.", "audio/chapters/ch00_debrief.mp3",
    },
    {
      1, "01", "ACT I - THE DOCKSIDE LEAK", false, 1, -1, "S",
      "PAPER TRAIL", "Highland Estate Village", "Sen. Arthur Sterling", "Highland Estate / Old Quarter",
      "Raid Senator Sterling's village storefronts for 2 Offshore Ledger Briefcases, scrub the Archive Terminal, and trace the Dock 4 seal.",
      "Infiltration - Data Theft - 11 Enforcers",
      beaconAt(kMissionSites[1].approachX, kMissionSites[1].approachZ, 4.2f), {0.66f, 0.78f, 0.53f},
      "MARA VANCE", "Ch 01 - Paper Trail. Pull Sterling's ledgers and see who is moving Sovereign money.", "audio/chapters/ch01_intro.mp3",
      "MARA VANCE", "Dock 4 manifests point straight to Customs Auditor Marcus Bell. Surveil and silence him next.", "audio/chapters/ch01_debrief.mp3",
    },
    {
      2, "02", "ACT I - THE DOCKSIDE LEAK", true, -1, 0, "H",
      "THE PORT AUDITOR", "Surveillance Hit: Marcus Bell", "Mara Vance", "Mirror Park -> Eastgate Quay",
      "Tail Port Auditor Marcus Bell's silver compact, catch him in an isolated harbor window, eliminate him silently, and sink his body at sea.",
      "Surveillance - Silent Takedown - Ocean Disposal",
      beaconAt(-265.0f, 488.0f, 3.8f), {0.96f, 0.62f, 0.04f},
      "MARA VANCE", "Ch 02 - Tail Marcus Bell's silver sedan, wait for an isolated window at Eastgate Quay, and sink the body offshore.", "audio/chapters/ch02_intro1.mp3",
      "MARA VANCE", "Bell is gone and the Dock 4 seals belong to us. Commander Ren won't see us coming tonight.", "audio/chapters/ch02_debrief.mp3",
    },
    {
      3, "03", "ACT I - THE DOCKSIDE LEAK", false, 4, -1, "T",
      "BLACK LEDGER", "Westgate Harbor Docks", "Victoria Thorne", "Eastgate Seaport Docks",
      "Recover Thorne's Gold Bullion, scrub 2 manifest terminals, torch 4 contraband crates, and assassinate Commander Ren.",
      "Night Raid - Sabotage - Boss: Commander Ren",
      beaconAt(kMissionSites[4].approachX, kMissionSites[4].approachZ, 2.8f), {0.98f, 0.75f, 0.14f},
      "MARA VANCE", "Ch 03 - Black Ledger. With Bell silenced, hit Commander Ren's freighter before the bullion sails.", "audio/chapters/ch03_intro.mp3",
      "MARA VANCE", "Ren's bridge log points straight to Midtown Construction - the Blood Star Diamond holds our cipher key.", "audio/chapters/ch03_debrief.mp3",
    },
    {
      4, "04", "ACT II - BREAKING THE CIPHER", false, 2, -1, "M",
      "GLASS VAULT", "Syndicate Construction Vault", "Countess Elena Vane", "Midtown Construction Zone",
      "Breach the Midtown construction vault, steal the Blood Star Diamond cipher, scrub 2 accounting terminals, and destroy 3 relay jammers.",
      "Vertical Heist - Sabotage - 13 Contractors",
      beaconAt(kMissionSites[2].approachX, kMissionSites[2].approachZ, 4.2f), {0.22f, 0.74f, 0.97f},
      "MARA VANCE", "Ch 04 - Glass Vault. Clone the Blood Star cipher and shatter their Midtown relays.", "audio/chapters/ch04_intro.mp3",
      "MARA VANCE", "The cipher exposed Dr. Victor Kaine - the fixer laundering payouts for Viktor Kroll. Track Kaine next.", "audio/chapters/ch04_debrief.mp3",
    },
    {
      5, "05", "ACT II - BREAKING THE CIPHER", true, -1, 1, "H",
      "THE PHARMA FIXER", "Surveillance Hit: Dr. Victor Kaine", "Mara Vance", "Venice Canals -> Pacific Marina",
      "Track Dr. Victor Kaine's blue SUV from Venice Canals to St. Jude's and Pacific Marina, strike in an isolated window, and dispose of him offshore.",
      "Surveillance - Isolated Kill - Ocean Disposal",
      beaconAt(-628.0f, 245.0f, 3.8f), {0.96f, 0.62f, 0.04f},
      "MARA VANCE", "Ch 05 - Watch Dr. Kaine's blue SUV leave Venice Canals, catch him isolated at Pacific Marina, and dump him in deep water.", "audio/chapters/ch05_intro1.mp3",
      "MARA VANCE", "Kaine is off the board and Kroll's payout shield just collapsed. Time to take Viktor Kroll downtown.", "audio/chapters/ch05_debrief.mp3",
    },
    {
      6, "06", "ACT II - BREAKING THE CIPHER", false, 3, -1, "J",
      "DEAD DROP", "Downtown Financial District", "Julian Mercer (CEO)", "Downtown Financial Core",
      "Steal 2 Prototype Drive Cases, wipe Kroll's Quantum Mainframe, evade 3 rooftop snipers, and assassinate Viktor Kroll at midnight.",
      "Midnight Ops - Rooftop Snipers - Boss: Viktor Kroll",
      beaconAt(kMissionSites[3].approachX, kMissionSites[3].approachZ, 4.3f), {0.13f, 0.83f, 0.93f},
      "MARA VANCE", "Ch 06 - Dead Drop. Kroll is isolated downtown with NVG snipers. Pull his mainframe data and end him.", "audio/chapters/ch06_intro.mp3",
      "MARA VANCE", "Kroll's mainframe exposed Damon Vale - the architect who built Apex Tower's blast locks.", "audio/chapters/ch06_debrief.mp3",
    },
    {
      7, "07", "ACT III - DECAPITATING THE CONSORTIUM", true, -1, 2, "H",
      "THE SYNDICATE ARCHITECT", "Surveillance Hit: Damon Vale", "Mara Vance", "Vinewood Crest -> Del Sol Cove",
      "Surveil infrastructure fixer Damon Vale's black sedan from Vinewood Crest through City Hall to Del Sol Cove, strip his overrides, and sink him.",
      "Surveillance - Override Extraction - Ocean Disposal",
      beaconAt(-358.0f, -818.0f, 4.2f), {0.96f, 0.62f, 0.04f},
      "MARA VANCE", "Ch 07 - Follow Damon Vale's black sedan from Vinewood Crest, isolate him at Del Sol Cove, strip his override keys, and sink the body.", "audio/chapters/ch07_intro1.mp3",
      "MARA VANCE", "Vale's master overrides are decrypted. Sending Brick the backdoor codes - Apex Tower is wide open.", "audio/chapters/ch07_debrief.mp3",
    },
    {
      8, "08", "ACT III - DECAPITATING THE CONSORTIUM", false, 5, -1, "B",
      "HOSTILE TAKEOVER", "Apex Corporate Tower", "Anonymous Board Director", "East Downtown - Apex HQ",
      "Storm Apex Corporate Tower beside Sgt. Brick Horvat, wipe 3 blackmail terminals, seize bearer bonds, and assassinate Viktor Sorin.",
      "Co-Op Assault w/ Sgt. Brick Horvat - Boss: Viktor Sorin",
      beaconAt(kMissionSites[5].approachX, kMissionSites[5].approachZ, 4.3f), {1.0f, 0.34f, 0.34f},
      "MARA VANCE", "Ch 08 - Hostile Takeover. Sgt. Brick Horvat is at the breach point. Drop Viktor Sorin and take the tower.", "audio/chapters/ch08_intro.mp3",
      "MARA VANCE", "Sorin is dead - and his cold-storage ledger shows General Drago Kovac waiting atop Mount Ironridge.", "audio/chapters/ch08_debrief.mp3",
    },
    {
      9, "09", "ACT III - DECAPITATING THE CONSORTIUM", false, 6, -1, "C",
      "THE SOVEREIGN CONTRACT", "Ironridge Fortress", "The Consortium", "Mount Ironridge Citadel",
      "Storm the alpine citadel, steal The Sovereign Diamond, scrub 3 classified servers, sabotage 4 backup relays, and eliminate General Drago Kovac.",
      "Finale - 26 Praetorians & Mortar Barrage - Boss: Gen. Kovac",
      beaconAt(kMissionSites[6].approachX, kMissionSites[6].approachZ, 4.4f), {0.75f, 0.52f, 0.99f},
      "MARA VANCE", "Ch 09 - The Sovereign Contract. End General Kovac and burn the Consortium to the ground.", "audio/chapters/ch09_intro.mp3",
      "ELIAS VOSS", "Ledger balanced. Burn the frequency, Mara - we're ghosts.", "audio/story/voss_m6_extract.mp3",
    },
  };

  recomputePlayerDerivedStats();
}

bool GameSession::isChapterUnlocked(int chapter) const {
  if (chapter < 0 || chapter >= static_cast<int>(storyChapters_.size())) return false;
  if (chapter <= 1) return true;
  if (storyChapters_[static_cast<size_t>(chapter)].completed) return true;
  if (storyStep_ >= chapter) return true;
  return storyChapters_[static_cast<size_t>(chapter - 1)].completed;
}

const NpcEntity* GameSession::activeBossNpc() const {
  if (!activeMission_.active || activeMission_.bossNpcId <= 0) return nullptr;
  for (const auto& n : npcs_) {
    if (n.id == activeMission_.bossNpcId && n.alive) return &n;
  }
  return nullptr;
}

const NpcEntity* GameSession::activeAllyNpc() const {
  if (!activeMission_.active || activeMission_.allyNpcId <= 0) return nullptr;
  for (const auto& n : npcs_) {
    if (n.id == activeMission_.allyNpcId && n.alive) return &n;
  }
  return nullptr;
}

void GameSession::abortActiveMissionOrSurveillance() {
  activeMission_ = ActiveCampaignMission{};
  activeSurveillance_ = ActiveSurveillanceState{};
  npcs_.erase(std::remove_if(npcs_.begin(), npcs_.end(), [](const NpcEntity& n) {
    return n.contractIdx == -2;
  }), npcs_.end());
}

void GameSession::selectEpilogueChoice(EpilogueChoice choice, AudioEngine* audio) {
  if (choice == EpilogueChoice::None) return;
  epilogueChoice_ = choice;
  lastDebrief_.awaitsEpilogueChoice = false;
  if (choice == EpilogueChoice::BurnLedger) {
    playerCash_ += 12000;
    recordBankEntry(12000, "Whistleblower Clean Wire");
    triggerCommsLine("ELIAS VOSS", "Ledger burned to zero bytes. Cut all satellites, Mara - Elias Voss never existed.", "audio/story/voss_m6_extract.mp3", audio, nullptr);
    pushToast("EPILOGUE: GHOST OF WESTGATE (+$12,000 Clean Wire)", 5.0f);
  } else {
    playerCash_ += 25000;
    recordBankEntry(25000, "Consortium Sovereign Escrow");
    triggerCommsLine("MARA VANCE", "Consortium escrow rerouted into our Sovereign accounts. Westgate Bay belongs to us now, Voss.", "audio/chapters/ch08_debrief.mp3", audio, nullptr);
    pushToast("EPILOGUE: SOVEREIGN BROKER (+$25,000 Consortium Escrow)", 5.0f);
  }
}

bool GameSession::startStoryChapter(int chapter, PlayerController& player, const WorldData& world, AudioEngine* audio, bool teleportToStart) {
  if (chapter < 0 || chapter >= static_cast<int>(storyChapters_.size())) return false;
  abortActiveMissionOrSurveillance();
  lastDebrief_.visible = false;
  wantedStars_ = 0;
  wantedHeat_ = 0.0f;

  const StoryChapterInfo& ch = storyChapters_[static_cast<size_t>(chapter)];
  // Ensure suppressed pistol + carbine are available for campaign deployments
  if (weapons_.size() > 2) {
    weapons_[1].unlocked = true;
    weapons_[2].unlocked = true;
    if (activeWeapon_ == 0) activeWeapon_ = 2;
  }

  // Trigger Chapter Briefing MP3 + atmospheric music cue
  triggerCommsLine(ch.introSpeaker, ch.introLine, ch.introMp3, audio, nullptr);
  if (audio) {
    audio->playMusicTrack(ch.isSurveillance ? "audio/missions/m1_music.mp3"
                                            : ("audio/missions/m" + std::to_string(std::clamp(ch.missionId, 1, 6)) + "_music.mp3"),
                          0.20f);
  }

  // -------------------------------------------------------------------------
  // A. Surveillance Tailing Contracts (Ch 02 = H1, Ch 05 = H2, Ch 07 = H3)
  // -------------------------------------------------------------------------
  if (ch.isSurveillance) {
    ActiveSurveillanceState sv;
    sv.active = true;
    sv.chapter = chapter;
    sv.survIdx = ch.surveillanceIdx;
    sv.codename = ch.codename;
    sv.phase = SurveillancePhase::TailingVehicle;

    auto roadY = [&](float x, float z) {
      return std::max(world.heightfield.sampleHeight(x, z), 2.9f);
    };

    VehicleModelKind vehKind = VehicleModelKind::Golf;
    glm::vec3 vehTint(0.80f, 0.84f, 0.89f);
    NpcModelKind targetModel = NpcModelKind::Business;
    glm::vec3 startPos(-265.0f, 4.0f, 502.0f);
    float startYaw = 3.14159f;
    glm::vec3 witnessPos(-261.0f, 4.0f, -106.0f);
    std::string witnessName = "Junior Analyst";

    if (sv.survIdx == 0) {
      sv.code = "H1";
      sv.targetName = "Marcus Bell";
      sv.roleTitle = "Senior Customs Compliance Auditor";
      sv.vehicleLabel = "Silver Compact Sedan";
      vehKind = VehicleModelKind::Golf;
      vehTint = {0.80f, 0.84f, 0.90f};
      startPos = {-265.0f, roadY(-265.0f, 502.0f), 502.0f};
      startYaw = 3.14159f;
      sv.routeWaypoints = {
        {-261.0f, roadY(-261.0f, -106.0f), -106.0f}, // Stop 0: Midtown Coffee w/ Colleague (Witnessed)
        {  34.0f, roadY(34.0f, -148.0f),   -148.0f}, // Drive-through: Downtown Customs Annex
        { 586.0f, roadY(586.0f, 442.0f),    442.0f}, // Stop 2: Eastgate Quay (ISOLATED WINDOW near ocean!)
      };
      sv.waypointIsolated = {false, false, true};
      sv.waypointNames = {"Midtown Espresso Plaza", "Downtown Customs Annex", "Eastgate Seaport Quay (ISOLATED)"};
      sv.waypointAudioMp3 = {"audio/surveillance/surv_01.mp3", "audio/surveillance/surv_02.mp3", "audio/surveillance/surv_03.mp3"};
      sv.waypointSubtitles = {
        "Marcus Bell: Hold the Dock Four manifest copies - I'm taking the physical seals to City Hall tonight.",
        "Marcus Bell: Security cleared my badge at Customs Annex. Heading out to Eastgate Quay alone.",
        "MARA VANCE: Bell is completely isolated on Eastgate Quay! Drop him quietly and dump the body into the bay!"
      };
      witnessPos = {-258.5f, roadY(-258.5f, -104.0f), -104.0f};
      witnessName = "Analyst Devon Park";
    } else if (sv.survIdx == 1) {
      sv.code = "H2";
      sv.targetName = "Dr. Victor Kaine";
      sv.roleTitle = "Syndicate Neuro-Payout Fixer";
      sv.vehicleLabel = "Cobalt Offroad SUV";
      vehKind = VehicleModelKind::RangeRover;
      vehTint = {0.16f, 0.36f, 0.68f};
      startPos = {-628.0f, roadY(-628.0f, 254.0f), 254.0f};
      startYaw = 1.57f;
      sv.routeWaypoints = {
        {-148.0f, roadY(-148.0f, -204.0f), -204.0f}, // Stop 0: St. Jude's Medical w/ Colleague
        {-395.0f, roadY(-395.0f, -95.0f),   -95.0f}, // Drive-through: Midtown Avenue
        {-708.0f, 4.22f,                     42.0f}, // Stop 2: Pacific Marina Pier (ISOLATED WINDOW over water!)
      };
      sv.waypointIsolated = {false, false, true};
      sv.waypointNames = {"St. Jude's Loading Bay", "Midtown Boulevard", "Pacific Marina Pier (ISOLATED)"};
      sv.waypointAudioMp3 = {"audio/surveillance/surv_04.mp3", "audio/surveillance/surv_05.mp3", "audio/surveillance/surv_06.mp3"};
      sv.waypointSubtitles = {
        "Dr. Kaine: Kroll's detail gets the last batch tonight - keep the offshore wire off hospital servers.",
        "Dr. Kaine: Routing west toward Pacific Marina to clear the burner ledger.",
        "MARA VANCE: Kaine is alone on the marina deck! Execute a silent kill and toss him into the Pacific!"
      };
      witnessPos = {-145.5f, roadY(-145.5f, -202.0f), -202.0f};
      witnessName = "Chief Pharmacist";
    } else {
      sv.code = "H3";
      sv.targetName = "Damon Vale";
      sv.roleTitle = "Apex Vault & Security Architect";
      sv.vehicleLabel = "Obsidian Executive Sedan";
      vehKind = VehicleModelKind::Mercedes;
      vehTint = {0.10f, 0.11f, 0.14f};
      startPos = {-358.0f, roadY(-358.0f, -804.0f), -804.0f};
      startYaw = 0.0f;
      sv.routeWaypoints = {
        { -18.0f, roadY(-18.0f, -218.0f), -218.0f}, // Stop 0: Civic Hall Plaza w/ Security
        {-342.0f, roadY(-342.0f, -96.0f),  -96.0f}, // Drive-through: Del Sol Avenue
        {-682.0f, roadY(-682.0f, -48.0f),  -48.0f}, // Stop 2: Del Sol Cove Overlook (ISOLATED WINDOW by surf!)
      };
      sv.waypointIsolated = {false, false, true};
      sv.waypointNames = {"City Hall Security Plaza", "Del Sol Avenue", "Del Sol Cove Overlook (ISOLATED)"};
      sv.waypointAudioMp3 = {"audio/surveillance/surv_07.mp3", "audio/surveillance/surv_08.mp3", "audio/surveillance/surv_09.mp3"};
      sv.waypointSubtitles = {
        "Damon Vale: Sorin's Apex blast locks stay keyed to my hardware token until my federal immunity clears.",
        "Damon Vale: Heading down to Del Sol Cove to stash the backup token.",
        "MARA VANCE: Vale is isolated by the Del Sol surf! Strike unseen, lift Brick's override keys, and sink the corpse!"
      };
      witnessPos = {-15.5f, roadY(-15.5f, -216.0f), -216.0f};
      witnessName = "Federal Marshal";
    }

    // Spawn target's signature vehicle
    VehicleEntity tv;
    tv.id = nextVehicleId_++;
    tv.kind = vehKind;
    tv.pos = startPos;
    tv.yawRad = startYaw;
    tv.colorTint = vehTint;
    tv.hp = 160.0f;
    tv.maxSpeed = 24.0f;
    tv.accel = 14.0f;
    tv.headlightsOn = (timeOfDayHours_ < 6.5f || timeOfDayHours_ > 18.5f);
    tv.isAmbientTraffic = false;
    sv.targetVehicleId = tv.id;
    vehicles_.push_back(tv);

    // Spawn target NPC
    NpcEntity tNpc;
    tNpc.id = nextNpcId_++;
    tNpc.kind = targetModel;
    tNpc.role = EnemyRole::Target;
    tNpc.pos = startPos + glm::vec3(1.6f, 0.0f, 0.0f);
    tNpc.homePos = tNpc.pos;
    tNpc.yawRad = startYaw;
    tNpc.hp = 95.0f;
    tNpc.maxHp = 95.0f;
    tNpc.colorTint = {0.95f, 0.72f, 0.20f};
    tNpc.isContractTarget = true;
    tNpc.contractIdx = -2;
    tNpc.displayName = sv.targetName;
    sv.targetNpcId = tNpc.id;
    npcs_.push_back(tNpc);

    // Spawn colleague witness at Stop 0
    NpcEntity wit;
    wit.id = nextNpcId_++;
    wit.kind = NpcModelKind::Security;
    wit.role = EnemyRole::Guard;
    wit.pos = witnessPos;
    wit.homePos = witnessPos;
    wit.yawRad = 1.57f;
    wit.hp = 110.0f;
    wit.maxHp = 110.0f;
    wit.colorTint = {0.32f, 0.40f, 0.52f};
    wit.isContractGuard = true;
    wit.contractIdx = -2;
    wit.displayName = witnessName;
    npcs_.push_back(wit);

    if (teleportToStart) {
      if (inVehicle()) activeVehicleIdx_ = -1;
      const glm::vec3 fwd(std::sin(startYaw), 0.0f, std::cos(startYaw));
      glm::vec3 stakeoutPos = startPos - fwd * 26.0f;
      stakeoutPos.y = roadY(stakeoutPos.x, stakeoutPos.z) + 0.9f;
      teleportTo(stakeoutPos, glm::degrees(startYaw), player);
      // Deliver Voss's personal car right next to surveillance stakeout!
      ownedVehicles_[static_cast<size_t>(VehicleModelKind::Golf)] = true;
      spawnPersonalVehicle(VehicleModelKind::Golf, selectedPaintIdx_, player, world, nullptr, false);
    }

    setGpsWaypoint(startPos, "Tail " + sv.targetName + " (" + sv.vehicleLabel + ")");
    activeSurveillance_ = std::move(sv);
    pushToast("CHAPTER " + ch.code + ": " + ch.codename + " - Tail " + activeSurveillance_.targetName + " (Keep 18m-105m)", 4.5f);
    return true;
  }

  // -------------------------------------------------------------------------
  // B. Fortress / Compound Story Missions (M0..M6)
  // -------------------------------------------------------------------------
  const int mid = std::clamp(ch.missionId, 0, 6);
  const RawMissionSite& site = kMissionSites[mid];

  ActiveCampaignMission m;
  m.active = true;
  m.chapter = chapter;
  m.missionId = mid;
  m.codename = ch.codename;
  m.title = ch.title;
  m.client = ch.client;
  m.siteOrigin = {site.x, site.y, site.z};
  m.siteYaw = site.yaw;

  const float hpMult = difficultyHpMult();
  auto addInteract = [&](const std::string& id, const std::string& objId, MissionInteractKind kind,
                         const std::string& label, float dur, float lx, float ly, float lz) {
    MissionInteractable it;
    it.id = id;
    it.objectiveId = objId;
    it.kind = kind;
    it.label = label;
    it.duration = dur;
    it.pos = siteLocalToWorld(site, world, lx, ly, lz);
    m.interactables.push_back(std::move(it));
  };
  auto addDestroyable = [&](const std::string& id, const std::string& label, float lx, float lz, float hp = 65.0f) {
    MissionDestroyable d;
    d.id = id;
    d.label = label;
    d.pos = siteLocalToWorld(site, world, lx, 0.0f, lz);
    d.hp = hp;
    d.maxHp = hp;
    m.destroyables.push_back(std::move(d));
  };
  auto spawnEnemy = [&](float lx, float ly, float lz, EnemyRole role, NpcModelKind model,
                        const glm::vec3& tint, float baseHp, const std::string& name = "", float yawDeg = 0.0f) -> int {
    NpcEntity e;
    e.id = nextNpcId_++;
    e.kind = model;
    e.role = role;
    e.pos = siteLocalToWorld(site, world, lx, ly, lz);
    e.homePos = e.pos;
    e.yawRad = site.yaw + glm::radians(yawDeg);
    e.maxHp = baseHp * hpMult;
    e.hp = e.maxHp;
    e.colorTint = tint;
    e.isContractGuard = (role != EnemyRole::Ally);
    e.isContractTarget = (role == EnemyRole::Boss);
    e.contractIdx = -2;
    e.displayName = name;
    const int id = e.id;
    npcs_.push_back(std::move(e));
    return id;
  };

  glm::vec3 playerSpawnWorld = siteLocalToWorld(site, world, 0.0f, 0.8f, 44.0f);
  float playerSpawnYawDeg = 180.0f + glm::degrees(site.yaw);

  if (mid == 0) {
    setTimeOfDayPreset(TimeOfDayPreset::Afternoon);
    setWeatherPreset(WeatherPreset::Clear);
    m.objectives = {
      {"targets", "Strike 3 Suppressed Calibration Steel Targets", 0, 3, false},
      {"extract", "Step onto Range Deployment Beacon", 0, 1, true},
    };
    addDestroyable("m0_t1", "Calibration Steel Target A", -5.5f, -14.0f, 25.0f);
    addDestroyable("m0_t2", "Calibration Steel Target B",  0.0f, -18.0f, 25.0f);
    addDestroyable("m0_t3", "Calibration Steel Target C",  5.5f, -14.0f, 25.0f);
    m.extractionPos = siteLocalToWorld(site, world, 0.0f, 0.0f, 10.0f);
    playerSpawnWorld = siteLocalToWorld(site, world, 0.0f, 0.8f, 4.0f);
  } else if (mid == 1) {
    setTimeOfDayPreset(TimeOfDayPreset::Dawn);
    setWeatherPreset(WeatherPreset::Clear);
    m.objectives = {
      {"files",   "Steal Offshore Ledger Briefcases", 0, 2, false},
      {"scrub",   "Scrub Village Archive Terminal",   0, 1, false},
      {"extract", "Exfiltrate - Highland Village Road", 0, 1, true},
    };
    addInteract("m1_f1", "files", MissionInteractKind::Files,    "Offshore Ledger Briefcase", 0.65f, -12.5f, 0.2f,   8.0f);
    addInteract("m1_f2", "files", MissionInteractKind::Files,    "Blackmail Dossier Case",    0.65f,  14.5f, 0.2f,   6.0f);
    addInteract("m1_t1", "scrub", MissionInteractKind::Terminal, "Village Archive Terminal",  1.35f,  13.0f, 0.2f, -28.0f);
    const glm::vec3 olive(0.42f, 0.50f, 0.34f);
    const float coords[11][3] = {
      {-8.0f, 0.0f, -6.0f}, {9.0f, 0.0f, 2.0f}, {-8.5f, 0.0f, 12.0f}, {6.0f, 0.0f, -28.0f},
      {-2.0f, 0.0f, -26.0f}, {10.0f, 0.0f, -22.0f}, {-8.0f, 0.0f, -16.0f}, {-16.2f, 0.0f, 10.0f},
      {16.5f, 0.0f, 19.0f}, {14.0f, 3.3f, 29.0f}, {-1.4f, 2.4f, -10.2f}
    };
    for (int i = 0; i < 11; ++i) {
      spawnEnemy(coords[i][0], coords[i][1], coords[i][2],
                 (i == 9) ? EnemyRole::Sniper : EnemyRole::Guard,
                 NpcModelKind::Security, olive, 100.0f, "Estate Enforcer", static_cast<float>(i * 35));
    }
    m.extractionPos = siteLocalToWorld(site, world, 0.0f, 0.0f, 44.0f);
    playerSpawnWorld = siteLocalToWorld(site, world, -6.2f, 0.8f, 41.0f);
  } else if (mid == 2) {
    setTimeOfDayPreset(TimeOfDayPreset::Afternoon);
    setWeatherPreset(WeatherPreset::Overcast);
    m.objectives = {
      {"diamond", "Steal the Blood Star Diamond",        0, 1, false},
      {"scrub",   "Scrub Auction Accounting Terminals",  0, 2, false},
      {"destroy", "Destroy Syndicate Signal Jammers",    0, 3, false},
      {"extract", "Exfiltrate - South Construction Gate",0, 1, true},
    };
    addInteract("m2_d1", "diamond", MissionInteractKind::Diamond,  "Blood Star Diamond",       0.85f, -15.8f, 0.2f, -20.0f);
    addInteract("m2_t1", "scrub",   MissionInteractKind::Terminal, "Warehouse Ledger Terminal",1.40f,  18.5f, 0.2f,   8.2f);
    addInteract("m2_t2", "scrub",   MissionInteractKind::Terminal, "Tower Core Terminal",      1.40f,   4.0f, 0.2f, -15.0f);
    addDestroyable("m2_j1", "Syndicate Signal Jammer East",  16.0f,  -6.0f, 70.0f);
    addDestroyable("m2_j2", "Syndicate Signal Jammer West", -16.0f,  -8.0f, 70.0f);
    addDestroyable("m2_j3", "Syndicate Signal Jammer North",  0.0f, -34.0f, 70.0f);
    const glm::vec3 charcoal(0.32f, 0.36f, 0.42f);
    const float coords[13][3] = {
      {10,0,-10}, {-12,0,8}, {13,0,16}, {-8,0,-28}, {16,0,-24}, {-16,0,-30},
      {4,0,24}, {-14,0,24}, {-3.5f,0,-18}, {5.5f,0,-14}, {4,3.4f,-19}, {-4,3.4f,-19}, {18.5f,0,4}
    };
    for (int i = 0; i < 13; ++i) {
      spawnEnemy(coords[i][0], coords[i][1], coords[i][2],
                 (i == 10 || i == 11) ? EnemyRole::Heavy : EnemyRole::Guard,
                 (i % 2 == 0) ? NpcModelKind::Construction : NpcModelKind::Security,
                 charcoal, 115.0f, "Syndicate Contractor", static_cast<float>(i * 28));
    }
    m.extractionPos = siteLocalToWorld(site, world, 0.0f, 0.0f, 46.0f);
    playerSpawnWorld = siteLocalToWorld(site, world, 0.0f, 0.8f, 46.0f);
  } else if (mid == 3) {
    setTimeOfDayPreset(TimeOfDayPreset::Night);
    setWeatherPreset(WeatherPreset::Clear);
    m.objectives = {
      {"files",   "Steal Prototype Hard-Drive Cases",  0, 2, false},
      {"scrub",   "Scrub Quantum Mainframe Server",    0, 1, false},
      {"boss",    "Assassinate Broker Viktor Kroll",   0, 1, false},
      {"extract", "Exfiltrate - Downtown South Street",0, 1, true},
    };
    addInteract("m3_f1", "files", MissionInteractKind::Files,    "Prototype Drive Case Alpha", 0.65f, -6.5f, 0.2f,  22.2f);
    addInteract("m3_f2", "files", MissionInteractKind::Files,    "Prototype Drive Case Beta",  0.65f,  6.5f, 0.2f,  20.2f);
    addInteract("m3_t1", "scrub", MissionInteractKind::Terminal, "Quantum Mainframe Server",   1.50f,  6.5f, 0.2f, -13.8f);
    const glm::vec3 cyberNavy(0.14f, 0.24f, 0.38f);
    const float coords[15][3] = {
      {-2,0,-4}, {12,0,10}, {-14,0,12}, {6.5f,0,-18.2f}, {-6.5f,0,-18.2f}, {16,0,-22}, {-16,0,-24},
      {13,6.5f,-4}, {17,6.5f,-4}, {-10,6.5f,-28}, {0,0,26}, {-6.5f,0,22}, {6.5f,0,20}, {-2.5f,3.4f,2}, {3.0f,3.4f,2}
    };
    for (int i = 0; i < 15; ++i) {
      const bool sniper = (i == 7 || i == 8 || i == 9);
      spawnEnemy(coords[i][0], coords[i][1], coords[i][2],
                 sniper ? EnemyRole::Sniper : EnemyRole::Guard,
                 sniper ? NpcModelKind::Security : NpcModelKind::Military,
                 cyberNavy, 125.0f, sniper ? "NVG Overwatch Sniper" : "Cyber-Spy Detail", 0.0f);
    }
    m.bossName = "Viktor Kroll";
    m.bossNpcId = spawnEnemy(0.0f, 0.0f, -24.0f, EnemyRole::Boss, NpcModelKind::Business,
                             {0.16f, 0.72f, 0.96f}, 280.0f, "Viktor Kroll", 0.0f);
    m.extractionPos = siteLocalToWorld(site, world, 0.0f, 0.0f, 46.0f);
    playerSpawnWorld = siteLocalToWorld(site, world, 0.0f, 0.8f, 46.0f);
  } else if (mid == 4) {
    setTimeOfDayPreset(TimeOfDayPreset::Night);
    setWeatherPreset(WeatherPreset::Overcast);
    m.objectives = {
      {"relic",   "Recover Thorne Gold Bullion",        0, 1, false},
      {"scrub",   "Scrub Shipping Manifest Terminals",  0, 2, false},
      {"destroy", "Destroy Contraband Cargo Crates",    0, 4, false},
      {"boss",    "Assassinate Commander Ren",          0, 1, false},
      {"extract", "Exfiltrate - Harbor Pier Boat",      0, 1, true},
    };
    addInteract("m4_r1", "relic", MissionInteractKind::Relic,    "Thorne Gold Bullion",         0.75f,  16.0f, 0.2f,  24.0f);
    addInteract("m4_t1", "scrub", MissionInteractKind::Terminal, "Dock Manifest Terminal",      1.40f, -14.0f, 0.2f,  26.2f);
    addInteract("m4_t2", "scrub", MissionInteractKind::Terminal, "Cargo Ship Bridge Terminal",  1.40f,   0.0f, 3.5f, -23.0f);
    addDestroyable("m4_c1", "Contraband Crate Alpha",  14.0f,  -4.0f, 60.0f);
    addDestroyable("m4_c2", "Contraband Crate Bravo", -14.0f,  -6.0f, 60.0f);
    addDestroyable("m4_c3", "Contraband Crate Charlie",10.0f, -10.0f, 60.0f);
    addDestroyable("m4_c4", "Contraband Crate Delta", -10.0f,  -8.0f, 60.0f);
    const glm::vec3 seaSteel(0.24f, 0.34f, 0.44f);
    const float coords[13][3] = {
      {-12,0,-6}, {14,0,13}, {-16,0,14}, {3,3.5f,-23}, {-3,3.5f,-23}, {18,0,-10}, {-18,0,-10},
      {6,0,24}, {-6,0,30}, {-16.2f,0,21.8f}, {-16.2f,0,26.2f}, {16,0,22}, {0,3.3f,8}
    };
    for (int i = 0; i < 13; ++i) {
      spawnEnemy(coords[i][0], coords[i][1], coords[i][2],
                 (i == 3 || i == 4) ? EnemyRole::Heavy : EnemyRole::Guard,
                 NpcModelKind::Military, seaSteel, 110.0f, "Harbor Mercenary", 0.0f);
    }
    m.bossName = "Commander Ren";
    m.bossNpcId = spawnEnemy(0.0f, 3.5f, -34.0f, EnemyRole::Boss, NpcModelKind::Military,
                             {0.92f, 0.64f, 0.14f}, 240.0f, "Commander Ren", 0.0f);
    m.extractionPos = siteLocalToWorld(site, world, 0.0f, 0.0f, 48.0f);
    playerSpawnWorld = siteLocalToWorld(site, world, 0.0f, 0.8f, 38.0f);
  } else if (mid == 5) {
    setTimeOfDayPreset(TimeOfDayPreset::Night);
    setWeatherPreset(WeatherPreset::Thunderstorm);
    m.objectives = {
      {"scrub",   "Scrub Executive Blackmail Terminals", 0, 3, false},
      {"files",   "Steal Sorin's Bearer Bonds Case",     0, 1, false},
      {"boss",    "Assassinate Chairman Viktor Sorin",   0, 1, false},
      {"extract", "Exfiltrate - North Tower Helipad",    0, 1, true},
    };
    addInteract("m5_t1", "scrub", MissionInteractKind::Terminal, "West Security Terminal",   1.45f, -20.0f, 0.2f,  12.2f);
    addInteract("m5_t2", "scrub", MissionInteractKind::Terminal, "East Security Terminal",   1.45f,  20.0f, 0.2f,  12.2f);
    addInteract("m5_t3", "scrub", MissionInteractKind::Terminal, "Executive Lobby Server",   1.45f,   3.2f, 0.2f, -31.0f);
    addInteract("m5_f1", "files", MissionInteractKind::Files,    "Bearer Bonds Briefcase",   0.70f,  -3.2f, 0.2f, -28.0f);
    const glm::vec3 obsidianCrimson(0.22f, 0.14f, 0.18f);
    const float coords[12][3] = {
      {-12,0,10}, {12,0,10}, {-14,0,-6}, {14,0,-6}, {-8,0,-24}, {8,0,-24},
      {-20,0,12}, {20,0,12}, {-19,4.5f,10}, {19,4.5f,10}, {-2.5f,0,-31}, {2.5f,0,-31}
    };
    for (int i = 0; i < 12; ++i) {
      const EnemyRole role = (i == 8 || i == 9) ? EnemyRole::Sniper : ((i >= 10) ? EnemyRole::Heavy : EnemyRole::Guard);
      spawnEnemy(coords[i][0], coords[i][1], coords[i][2], role, NpcModelKind::Military,
                 obsidianCrimson, 130.0f, "Executive Black-Ops", 0.0f);
    }
    m.allyName = "Sgt. Brick Horvat";
    m.allyNpcId = spawnEnemy(-4.0f, 0.0f, 40.0f, EnemyRole::Ally, NpcModelKind::Military,
                             {0.28f, 0.72f, 0.42f}, 340.0f, "Sgt. Brick Horvat", 180.0f);
    m.bossName = "Viktor Sorin";
    m.bossNpcId = spawnEnemy(0.0f, 0.0f, -26.0f, EnemyRole::Boss, NpcModelKind::Business,
                             {0.95f, 0.20f, 0.24f}, 340.0f, "Viktor Sorin", 0.0f);
    m.extractionPos = siteLocalToWorld(site, world, 0.0f, 0.0f, -43.0f);
    playerSpawnWorld = siteLocalToWorld(site, world, 0.0f, 0.8f, 44.0f);
  } else if (mid == 6) {
    setTimeOfDayPreset(TimeOfDayPreset::Night);
    setWeatherPreset(WeatherPreset::Thunderstorm);
    m.objectives = {
      {"diamond", "Steal The Sovereign Diamond (East Vault)", 0, 1, false},
      {"scrub",   "Scrub Classified Blackmail Servers",       0, 3, false},
      {"destroy", "Sabotage Backup Relay Nodes",              0, 4, false},
      {"boss",    "Assassinate General Drago Kovac",          0, 1, false},
      {"extract", "Exfiltrate - North Citadel Helipad",       0, 1, true},
    };
    addInteract("m6_d1", "diamond", MissionInteractKind::Diamond,  "The Sovereign Diamond",       0.90f,  24.0f, 0.2f, -46.0f);
    addInteract("m6_t1", "scrub",   MissionInteractKind::Terminal, "West Armory Blackmail Server",1.55f, -34.0f, 0.2f,  26.5f);
    addInteract("m6_t2", "scrub",   MissionInteractKind::Terminal, "East Comms Archive Server",   1.55f,  34.0f, 0.2f,  26.5f);
    addInteract("m6_t3", "scrub",   MissionInteractKind::Terminal, "Inner Vault Mainframe",       1.55f, -24.0f, 0.2f, -46.0f);
    addDestroyable("m6_r1", "Backup Relay Node NW", -34.0f,  14.0f, 80.0f);
    addDestroyable("m6_r2", "Backup Relay Node NE",  34.0f,  14.0f, 80.0f);
    addDestroyable("m6_r3", "Backup Relay Node SW", -14.0f, -14.0f, 80.0f);
    addDestroyable("m6_r4", "Backup Relay Node SE",  14.0f, -14.0f, 80.0f);
    const glm::vec3 praetorianViolet(0.32f, 0.24f, 0.48f);
    const float coords[25][3] = {
      {-12,0,60}, {12,0,60}, {0,0,50}, {-14,4.5f,54}, {14,4.5f,54},
      {-34,0,26}, {-34,0,21}, {-34,4.7f,24}, {34,0,26}, {34,0,21}, {34,4.7f,24},
      {-16,0,32}, {16,0,32}, {-10,3.8f,-4}, {10,3.8f,-4}, {-18,0,-12}, {18,0,-12}, {0,0,-16},
      {-24,0,-44}, {-24,4.5f,-46}, {24,0,-42}, {-4,0,-46}, {4,0,-46}, {-12,0,-66}, {12,0,-74}
    };
    for (int i = 0; i < 25; ++i) {
      const bool sniper = (i == 3 || i == 4 || i == 7 || i == 10 || i == 13 || i == 14 || i == 19);
      const bool heavy  = (i == 5 || i == 8 || i == 18 || i == 20 || i == 21 || i == 22);
      spawnEnemy(coords[i][0], coords[i][1], coords[i][2],
                 sniper ? EnemyRole::Sniper : (heavy ? EnemyRole::Heavy : EnemyRole::Guard),
                 NpcModelKind::Military, praetorianViolet, 150.0f,
                 sniper ? "Citadel Marksman" : (heavy ? "Praetorian Breacher" : "Citadel Praetorian"), 0.0f);
    }
    m.bossName = "General Drago Kovac";
    m.bossNpcId = spawnEnemy(0.0f, 0.0f, -72.0f, EnemyRole::Boss, NpcModelKind::Military,
                             {0.85f, 0.48f, 0.14f}, 450.0f, "General Drago Kovac", 0.0f);
    m.extractionPos = siteLocalToWorld(site, world, 0.0f, 0.0f, -84.0f);
    playerSpawnWorld = siteLocalToWorld(site, world, 0.0f, 0.8f, 78.0f);
  }

  if (teleportToStart) {
    if (inVehicle()) activeVehicleIdx_ = -1;
    teleportTo(playerSpawnWorld, playerSpawnYawDeg, player);
  }
  setGpsWaypoint(m.interactables.empty() ? m.extractionPos : m.interactables.front().pos,
                 "CH " + ch.code + ": " + ch.codename);
  activeMission_ = std::move(m);
  pushToast("DEPLOYED - CH " + ch.code + ": " + ch.codename + " (" + ch.title + ")", 4.2f);
  return true;
}

bool GameSession::damageMissionDestroyablesOnRay(
  const glm::vec3& rayOrig,
  const glm::vec3& rayDir,
  float maxDist,
  float dmg,
  AudioEngine* audio
) {
  if (!activeMission_.active) return false;
  bool hitAny = false;
  for (auto& d : activeMission_.destroyables) {
    if (d.destroyed) continue;
    const glm::vec3 center = d.pos + glm::vec3(0.0f, 1.0f, 0.0f);
    const glm::vec3 oc = rayOrig - center;
    const float b = glm::dot(oc, rayDir);
    const float c = glm::dot(oc, oc) - 1.15f * 1.15f;
    const float disc = b * b - c;
    if (disc < 0.0f) continue;
    const float t = -b - std::sqrt(disc);
    if (t >= 0.0f && t <= maxDist) {
      d.hp -= dmg;
      hitAny = true;
      spawnSparks(rayOrig + rayDir * t, -rayDir, {1.0f, 0.72f, 0.20f}, 10);
      if (d.hp <= 0.0f) {
        d.destroyed = true;
        spawnSparks(center, {0.0f, 1.0f, 0.0f}, {1.0f, 0.42f, 0.12f}, 24);
        if (audio) audio->playExplosion(center);
        for (auto& obj : activeMission_.objectives) {
          if (obj.id == "destroy" || obj.id == "targets") {
            obj.current = std::min(obj.required, obj.current + 1);
          }
        }
        pushToast("DESTROYED: " + d.label + "!", 2.5f);
      }
      break;
    }
  }
  return hitAny;
}

void GameSession::updateAllyAndBossCombat(
  float dt,
  PlayerController& player,
  PhysicsWorld& physics,
  const WorldData& world,
  AudioEngine* audio
) {
  if (!activeMission_.active) return;
  const glm::vec3 pPos = player.position();

  // 1. Co-Op Ally AI (Sgt. Brick Horvat in Ch 08 / M5)
  if (activeMission_.allyNpcId > 0) {
    for (size_t ai = 0; ai < npcs_.size(); ++ai) {
      auto& ally = npcs_[ai];
      if (ally.id != activeMission_.allyNpcId || !ally.alive) continue;

      int bestEnemyIdx = -1;
      float bestDist = 44.0f;
      for (size_t ei = 0; ei < npcs_.size(); ++ei) {
        if (ei == ai) continue;
        const auto& en = npcs_[ei];
        if (!en.alive || en.role == EnemyRole::Ally || en.role == EnemyRole::Civilian) continue;
        if (!en.isContractGuard && !en.isPolice) continue;
        const float d = glm::distance(ally.pos, en.pos);
        if (d < bestDist) {
          bestDist = d;
          bestEnemyIdx = static_cast<int>(ei);
        }
      }

      // Follow Voss on flank when beyond 9m
      const glm::vec3 desiredFollow = pPos + glm::vec3(-3.2f, 0.0f, 2.8f);
      const float distToFollow = glm::length(glm::vec2(desiredFollow.x - ally.pos.x, desiredFollow.z - ally.pos.z));
      if (distToFollow > 4.2f && (bestEnemyIdx < 0 || distToFollow > 16.0f)) {
        const glm::vec2 dir = glm::normalize(glm::vec2(desiredFollow.x - ally.pos.x, desiredFollow.z - ally.pos.z));
        ally.pos.x += dir.x * 5.0f * dt;
        ally.pos.z += dir.y * 5.0f * dt;
        ally.pos.y = std::max(world.heightfield.sampleHeight(ally.pos.x, ally.pos.z), activeMission_.siteOrigin.y);
        ally.yawRad = std::atan2(dir.x, dir.y);
        ally.animClip = "Run";
      } else {
        ally.animClip = "Idle";
      }

      if (bestEnemyIdx >= 0) {
        auto& target = npcs_[static_cast<size_t>(bestEnemyIdx)];
        const glm::vec3 toE = target.pos - ally.pos;
        ally.yawRad = std::atan2(toE.x, toE.z);
        ally.attackCooldown -= dt;
        if (ally.attackCooldown <= 0.0f) {
          ally.attackCooldown = 0.85f;
          const glm::vec3 muzzle = ally.pos + glm::vec3(0.0f, 1.45f, 0.0f);
          const glm::vec3 aimPt = target.pos + glm::vec3(0.0f, 1.15f, 0.0f);
          tracers_.push_back({muzzle, aimPt, {0.32f, 0.95f, 0.65f}, 0.10f});
          if (audio) audio->playSpatialGunshot(muzzle, true, 0.92f);
          target.hp -= 19.0f;
          target.hitFlash = 1.0f;
          target.alerted = true;
          target.suspicion = 1.0f;
          if (!activeMission_.firstContactSpoken) {
            activeMission_.firstContactSpoken = true;
            triggerCommsLine("SGT. BRICK HORVAT", "Black-ops squad moving! Suppressing flanks - watch the rooftops!", "audio/story/brick_m5_contact.mp3", audio, &ally.pos);
          }
          if (target.hp <= 0.0f) {
            target.alive = false;
            target.animClip = "knockdown";
            target.animTime = 0.0f;
            activeMission_.missionKills++;
          }
        }
      }
      break;
    }
  }

  // 2. Named Boss Phase Triggers & Mortar Barrage Hazards
  if (activeMission_.bossNpcId > 0) {
    bool bossAlive = false;
    for (auto& n : npcs_) {
      if (n.id != activeMission_.bossNpcId) continue;
      if (!n.alive) break;
      bossAlive = true;

      const BossTauntSpec* spec = findBossSpec(activeMission_.bossName);
      if (spec && !activeMission_.bossEngageSpoken && (n.alerted || n.hp < n.maxHp * 0.98f)) {
        activeMission_.bossEngageSpoken = true;
        n.alerted = true;
        n.suspicion = 1.0f;
        triggerCommsLine(activeMission_.bossName, spec->engageLine, spec->engageMp3, audio, &n.pos);
      }

      if (spec && !activeMission_.bossPhaseTriggered && n.hp <= n.maxHp * 0.52f) {
        activeMission_.bossPhaseTriggered = true;
        triggerCommsLine(activeMission_.bossName, spec->phaseLine, spec->phaseMp3, audio, &n.pos);
        pushToast(spec->phaseBanner, 4.5f);

        // Spawn 2 tactical phase reinforcements flanking the boss
        for (int s = -1; s <= 1; s += 2) {
          NpcEntity rf;
          rf.id = nextNpcId_++;
          rf.kind = NpcModelKind::Military;
          rf.role = EnemyRole::Heavy;
          rf.pos = n.pos + glm::vec3(static_cast<float>(s) * 4.5f, 0.0f, 3.0f);
          rf.homePos = rf.pos;
          rf.maxHp = 165.0f * difficultyHpMult();
          rf.hp = rf.maxHp;
          rf.colorTint = {0.82f, 0.22f, 0.22f};
          rf.isContractGuard = true;
          rf.alerted = true;
          rf.suspicion = 1.0f;
          rf.contractIdx = -2;
          rf.displayName = "Boss Strike Guard";
          npcs_.push_back(rf);
        }
      }

      // General Drago Kovac (M6) continuous Ironridge Mortar Barrage during Phase 2
      if (activeMission_.missionId == 6 && activeMission_.bossPhaseTriggered) {
        activeMission_.mortarSpawnCooldown -= dt;
        if (activeMission_.mortarSpawnCooldown <= 0.0f) {
          activeMission_.mortarSpawnCooldown = 3.8f;
          MortarHazardZone mz;
          mz.pos = {pPos.x, std::max(world.heightfield.sampleHeight(pPos.x, pPos.z), activeMission_.siteOrigin.y), pPos.z};
          mz.radius = 5.0f;
          mz.fuseTimer = 2.2f;
          mz.maxFuse = 2.2f;
          activeMission_.mortarZones.push_back(mz);
        }
      }
      break;
    }

    if (!bossAlive) {
      for (auto& obj : activeMission_.objectives) {
        if (obj.id == "boss" && obj.current < obj.required) {
          obj.current = obj.required;
          pushToast("TARGET TERMINATED: " + activeMission_.bossName + "!", 3.8f);
          if (activeMission_.missionId == 3) {
            triggerCommsLine("ELIAS VOSS", "Kroll is down. Mainframe cleared.", "audio/story/voss_m3_boss.mp3", audio, nullptr);
          } else if (activeMission_.missionId == 4) {
            triggerCommsLine("ELIAS VOSS", "Ren is down. Moving to the pier.", "audio/story/voss_m4_pier.mp3", audio, nullptr);
          } else if (activeMission_.missionId == 5) {
            triggerCommsLine("ELIAS VOSS", "Sorin is handled. Moving to the roof.", "audio/story/voss_m5_obj.mp3", audio, nullptr);
          } else if (activeMission_.missionId == 6) {
            triggerCommsLine("ELIAS VOSS", "Kovac is down. Diamond is secure. I'm done here.", "audio/story/voss_m6_end.mp3", audio, nullptr);
          }
        }
      }
      activeMission_.mortarZones.clear();
    }
  }

  // Step active Mortar Hazard Zones
  for (auto& mz : activeMission_.mortarZones) {
    mz.fuseTimer -= dt;
    if (mz.fuseTimer <= 0.0f) {
      spawnSparks(mz.pos + glm::vec3(0.0f, 0.8f, 0.0f), {0.0f, 1.0f, 0.0f}, {1.0f, 0.36f, 0.10f}, 36);
      if (audio) audio->playExplosion(mz.pos);
      if (glm::distance(pPos, mz.pos) <= mz.radius) {
        damagePlayer(30.0f * difficultyDamageMult(), world, player, audio);
      }
    }
  }
  activeMission_.mortarZones.erase(
    std::remove_if(activeMission_.mortarZones.begin(), activeMission_.mortarZones.end(),
                   [](const MortarHazardZone& z) { return z.fuseTimer <= 0.0f; }),
    activeMission_.mortarZones.end());
  (void)physics;
}

void GameSession::updateCampaignAndSurveillance(
  float dt,
  const GameInputFrame& input,
  PlayerController& player,
  PhysicsWorld& physics,
  const WorldData& world,
  AudioEngine* audio
) {
  const glm::vec3 pPos = player.position();

  // Passive BodyStats XP progression from live Voss traversal & swimming
  if (!inVehicle()) {
    const float terrainY = world.heightfield.sampleHeight(pPos.x, pPos.z);
    if (terrainY < -0.35f && pPos.y < 1.2f) {
      addBodyStatXp(BodyStatKind::Lung, dt * 4.5f);
      addBodyStatXp(BodyStatKind::Stamina, dt * 2.5f);
    } else if (player.sprinting() && player.speed() > 4.0f) {
      addBodyStatXp(BodyStatKind::Speed, dt * 3.2f);
      addBodyStatXp(BodyStatKind::Stamina, dt * 2.8f);
    } else if (player.crouching() && player.speed() > 0.4f) {
      addBodyStatXp(BodyStatKind::Stealth, dt * 3.8f);
    }
  }
  if (input.dodgePressed) {
    addBodyStatXp(BodyStatKind::Agility, 4.0f);
  }

  // Open-world Story Chapter Beacons when no mission/surveillance is currently running
  if (!activeMission_.active && !activeSurveillance_.active) {
    for (const auto& ch : storyChapters_) {
      if (!isChapterUnlocked(ch.chapter)) continue;
      const float d = glm::length(glm::vec2(pPos.x - ch.beaconPos.x, pPos.z - ch.beaconPos.z));
      if (d < 6.8f) {
        contextPrompt_ = "[B] Deploy CH " + ch.code + ": " + ch.codename + " (" + ch.title + ")";
        if (input.actionPressed) {
          startStoryChapter(ch.chapter, player, world, audio, true);
          return;
        }
        break;
      }
    }
  }

  // -------------------------------------------------------------------------
  // 1. Update Active Fortress / Compound Story Mission (M0..M6)
  // -------------------------------------------------------------------------
  if (activeMission_.active) {
    activeMission_.elapsedSec += dt;

    // Check if any mission guard was alerted (breaks Ghost bonus)
    for (const auto& n : npcs_) {
      if (n.contractIdx == -2 && n.isContractGuard && n.alerted) {
        activeMission_.playerAlertedAnyGuard = true;
        if (!activeMission_.firstContactSpoken && activeMission_.missionId != 5) {
          activeMission_.firstContactSpoken = true;
          const std::string clip = (activeMission_.missionId == 6)
            ? "audio/story/boss_kovac_contact.mp3"
            : ("audio/story/mara_m" + std::to_string(std::clamp(activeMission_.missionId, 1, 4)) + "_contact.mp3");
          triggerCommsLine(
            activeMission_.missionId == 6 ? "GENERAL DRAGO KOVAC" : "MARA VANCE",
            activeMission_.missionId == 6
              ? "Perimeter breach! Praetorians, seal the vault and hunt that thief down!"
              : "Hostiles alerted! Break line of sight or drop them fast!",
            clip, audio, nullptr);
        }
      }
    }

    updateAllyAndBossCombat(dt, player, physics, world, audio);

    // Interactive Terminals / Briefcases / Blood Star & Sovereign Diamonds
    activeMission_.activeInteractIdx = -1;
    for (size_t i = 0; i < activeMission_.interactables.size(); ++i) {
      auto& it = activeMission_.interactables[i];
      if (it.completed) continue;
      const float d = glm::distance(pPos, it.pos);
      if (d < 3.4f && !inVehicle()) {
        activeMission_.activeInteractIdx = static_cast<int>(i);
        const int pct = static_cast<int>(std::round((it.progress / std::max(0.1f, it.duration)) * 100.0f));
        contextPrompt_ = "[Hold E / B] " + it.label + " (" + std::to_string(pct) + "%)";
        if (input.useHeld || input.actionPressed || input.kickPressed) {
          it.progress += input.actionPressed ? std::max(dt, 0.45f) : dt;
          if (it.progress >= it.duration) {
            it.completed = true;
            if (audio) audio->playCashChime();
            const int secCash = (it.kind == MissionInteractKind::Terminal) ? 200 : 150;
            playerCash_ += secCash;
            for (auto& obj : activeMission_.objectives) {
              if (obj.id == it.objectiveId) {
                obj.current = std::min(obj.required, obj.current + 1);
              }
            }
            pushToast("SECURED: " + it.label + " (+$" + std::to_string(secCash) + ")", 3.0f);
          }
        } else {
          it.progress = std::max(0.0f, it.progress - dt * 0.8f);
        }
        break;
      } else {
        it.progress = std::max(0.0f, it.progress - dt * 0.8f);
      }
    }

    // Check primary objective completion & update GPS / Halfway / Extraction Comms
    int donePrimary = 0;
    int totalPrimary = 0;
    for (const auto& obj : activeMission_.objectives) {
      if (obj.isExtraction) continue;
      totalPrimary += obj.required;
      donePrimary += std::min(obj.current, obj.required);
    }

    if (!activeMission_.halfwaySpoken && totalPrimary >= 2 && donePrimary >= (totalPrimary + 1) / 2) {
      activeMission_.halfwaySpoken = true;
      if (activeMission_.missionId == 1) {
        triggerCommsLine("MARA VANCE", "Hold on - those account hashes belong to Dock Four customs. Pull the full manifest!", "audio/story/mara_m1_twist.mp3", audio, nullptr);
      } else if (activeMission_.missionId == 2) {
        triggerCommsLine("MARA VANCE", "The site ledger shows Dr. Victor Kaine laundering funds for Viktor Kroll. Finish up here!", "audio/story/mara_m2_half.mp3", audio, nullptr);
      } else if (activeMission_.missionId == 5) {
        triggerCommsLine("MARA VANCE", "Sorin already moved The Sovereign Diamond to General Kovac at Ironridge! Take his vault key!", "audio/story/mara_m5_twist.mp3", audio, nullptr);
      }
    }

    const bool readyToExtract = (donePrimary >= totalPrimary);
    if (readyToExtract) {
      if (!activeMission_.extractionReadySpoken) {
        activeMission_.extractionReadySpoken = true;
        setGpsWaypoint(activeMission_.extractionPos, "EXFILTRATE ZONE");
        pushToast("ALL PRIMARY OBJECTIVES COMPLETE - Reach the Exfiltration Beacon!", 4.0f);
      }
      const float dEx = glm::length(glm::vec2(pPos.x - activeMission_.extractionPos.x, pPos.z - activeMission_.extractionPos.z));
      if (dEx <= activeMission_.extractionRadius + 1.5f) {
        // Complete Chapter!
        const int chIdx = activeMission_.chapter;
        auto& ch = storyChapters_[static_cast<size_t>(chIdx)];
        const bool ghost = !activeMission_.playerAlertedAnyGuard;
        int score = 2; // B base
        if (ghost) score += 2;
        if (activeMission_.elapsedSec < 210.0f) score += 1;
        const char rank = (score >= 4) ? 'S' : ((score == 3) ? 'A' : ((score == 2) ? 'B' : 'C'));

        const float mult = difficultyRewardMult() * (ghost ? 1.25f : 1.0f);
        const int baseCash = (activeMission_.missionId == 0) ? 950 : (3000 + chIdx * 1050);
        const int earnedCash = static_cast<int>(std::round(static_cast<float>(baseCash) * mult));

        playerCash_ += earnedCash;
        recordBankEntry(earnedCash, "Campaign Op CH " + ch.code + ": " + ch.codename);
        pushPhoneMessage("Mara Vance", "CH " + ch.code + " Escrow Wired",
                         "Rank " + std::string(1, rank) + " on " + ch.title + ". $" + std::to_string(earnedCash) + " transferred to FruitPay.",
                         0x10B981u);

        ch.completed = true;
        if (ch.bestRank == '-' || rank < ch.bestRank) ch.bestRank = rank;
        if (ghost) ch.ghostCleared = true;
        storyStep_ = std::max(storyStep_, std::min(9, chIdx + 1));

        lastDebrief_.visible = true;
        lastDebrief_.chapter = chIdx;
        lastDebrief_.codename = ch.codename;
        lastDebrief_.title = ch.title;
        lastDebrief_.rank = rank;
        lastDebrief_.ghost = ghost;
        lastDebrief_.kills = activeMission_.missionKills;
        lastDebrief_.headshots = activeMission_.missionHeadshots;
        lastDebrief_.elapsedSec = activeMission_.elapsedSec;
        lastDebrief_.cashEarned = earnedCash;
        lastDebrief_.narrativeNote = ch.debriefLine;
        lastDebrief_.awaitsEpilogueChoice = (chIdx == 9 && epilogueChoice_ == EpilogueChoice::None);

        triggerCommsLine(ch.debriefSpeaker, ch.debriefLine, ch.debriefMp3, audio, nullptr);
        if (audio) audio->playCashChime();
        abortActiveMissionOrSurveillance();
        if (storyStep_ < static_cast<int>(storyChapters_.size())) {
          const auto& nextCh = storyChapters_[static_cast<size_t>(storyStep_)];
          setGpsWaypoint(nextCh.beaconPos, "NEXT CH " + nextCh.code + ": " + nextCh.codename);
        }
        pushToast(std::string("CHAPTER COMPLETE [RANK ") + rank + "] +$" + std::to_string(earnedCash) + "!", 5.0f);
      }
    } else {
      // Point GPS at next incomplete interactable, destroyable, or boss
      for (const auto& it : activeMission_.interactables) {
        if (!it.completed) {
          setGpsWaypoint(it.pos, it.label);
          break;
        }
      }
    }
    return;
  }

  // -------------------------------------------------------------------------
  // 2. Update Active Surveillance Tailing Hit (H1: Bell, H2: Kaine, H3: Vale)
  // -------------------------------------------------------------------------
  if (activeSurveillance_.active) {
    auto& sv = activeSurveillance_;
    sv.elapsedSec += dt;

    NpcEntity* targetNpc = nullptr;
    for (auto& n : npcs_) {
      if (n.id == sv.targetNpcId) { targetNpc = &n; break; }
    }
    VehicleEntity* targetVeh = nullptr;
    for (auto& v : vehicles_) {
      if (v.id == sv.targetVehicleId && !v.destroyed) { targetVeh = &v; break; }
    }

    if (!targetNpc) {
      abortActiveMissionOrSurveillance();
      return;
    }

    // Check if target has been eliminated!
    if (!targetNpc->alive) {
      if (sv.phase != SurveillancePhase::DisposeBody) {
        if (wantedStars_ > 0 || sv.phase == SurveillancePhase::ObservingStop) {
          sv.unseen = false;
        }
        sv.phase = SurveillancePhase::DisposeBody;
        setGpsWaypoint({-748.0f, 0.5f, 38.0f}, "Dump " + sv.targetName + " in Deep Ocean Water");
        pushToast("TARGET ELIMINATED - Pick up " + sv.targetName + " [J] and dump offshore in ocean water!", 4.5f);
      }

      if (targetNpc->disposedInOcean || targetNpc->bodyHidden) {
        const bool deepSea = targetNpc->disposedInOcean;
        const int chIdx = sv.chapter;
        auto& ch = storyChapters_[static_cast<size_t>(chIdx)];
        const char rank = (sv.unseen && deepSea) ? 'S' : ((sv.unseen || deepSea) ? 'A' : 'B');
        const float mult = difficultyRewardMult();
        const int earnedCash = static_cast<int>(std::round((3800.0f + (sv.unseen ? 1500.0f : 0.0f) + (deepSea ? 1000.0f : 0.0f)) * mult));

        playerCash_ += earnedCash;
        recordBankEntry(earnedCash, "Surveillance Hit CH " + ch.code + ": " + sv.targetName);
        pushPhoneMessage("Mara Vance", "Hit Verified", sv.targetName + " silenced cleanly. $" + std::to_string(earnedCash) + " wired to FruitPay.", 0x10B981u);

        ch.completed = true;
        if (ch.bestRank == '-' || rank < ch.bestRank) ch.bestRank = rank;
        if (sv.unseen) ch.ghostCleared = true;
        storyStep_ = std::max(storyStep_, std::min(9, chIdx + 1));

        lastDebrief_.visible = true;
        lastDebrief_.chapter = chIdx;
        lastDebrief_.codename = ch.codename;
        lastDebrief_.title = ch.title;
        lastDebrief_.rank = rank;
        lastDebrief_.ghost = sv.unseen;
        lastDebrief_.kills = 1;
        lastDebrief_.headshots = totalHeadshots_ > 0 ? 1 : 0;
        lastDebrief_.elapsedSec = sv.elapsedSec;
        lastDebrief_.cashEarned = earnedCash;
        lastDebrief_.narrativeNote = ch.debriefLine;
        lastDebrief_.awaitsEpilogueChoice = false;

        triggerCommsLine(ch.debriefSpeaker, ch.debriefLine, ch.debriefMp3, audio, nullptr);
        if (audio) audio->playCashChime();
        abortActiveMissionOrSurveillance();
        if (storyStep_ < static_cast<int>(storyChapters_.size())) {
          const auto& nextCh = storyChapters_[static_cast<size_t>(storyStep_)];
          setGpsWaypoint(nextCh.beaconPos, "NEXT CH " + nextCh.code + ": " + nextCh.codename);
        }
        pushToast(std::string("SURVEILLANCE HIT COMPLETE [RANK ") + rank + "] +$" + std::to_string(earnedCash) + "!", 5.0f);
      }
      return;
    }

    // Target is alive: update tailing / stop / isolated window routine
    sv.distanceToTarget = glm::distance(pPos, targetNpc->pos);
    if (sv.distanceToTarget < 13.5f && sv.phase != SurveillancePhase::IsolatedWindow) {
      sv.spookMeter = std::min(1.0f, sv.spookMeter + dt * 0.28f);
      if (sv.spookMeter >= 1.0f && sv.unseen) {
        sv.unseen = false;
        pushToast("COMPROMISED! " + sv.targetName + " spotted you tailing too closely!", 3.5f);
      }
    } else {
      sv.spookMeter = std::max(0.0f, sv.spookMeter - dt * 0.18f);
    }

    if (sv.distanceToTarget > 155.0f && sv.phase == SurveillancePhase::TailingVehicle) {
      sv.signalLossTimer += dt;
      if (sv.signalLossTimer >= 15.0f) {
        pushToast("SIGNAL LOST - " + sv.targetName + " escaped surveillance! Redeploy from SkyPhone.", 4.0f);
        abortActiveMissionOrSurveillance();
        return;
      }
    } else {
      sv.signalLossTimer = std::max(0.0f, sv.signalLossTimer - dt * 0.5f);
    }

    if (sv.phase == SurveillancePhase::TailingVehicle && targetVeh &&
        sv.waypointStep < static_cast<int>(sv.routeWaypoints.size())) {
      const glm::vec3 wp = sv.routeWaypoints[static_cast<size_t>(sv.waypointStep)];
      const glm::vec2 toWp(wp.x - targetVeh->pos.x, wp.z - targetVeh->pos.z);
      const float dWp = glm::length(toWp);
      if (dWp > 4.5f) {
        const glm::vec2 dir = toWp / dWp;
        const float driveSpeed = (sv.spookMeter >= 1.0f) ? 18.5f : 12.0f;
        targetVeh->pos.x += dir.x * driveSpeed * dt;
        targetVeh->pos.z += dir.y * driveSpeed * dt;
        targetVeh->pos.y = std::max(world.heightfield.sampleHeight(targetVeh->pos.x, targetVeh->pos.z), 2.85f);
        targetVeh->yawRad = std::atan2(dir.x, dir.y);
        targetVeh->speed = driveSpeed;
        targetVeh->wheelSpinRad += (driveSpeed / 0.34f) * dt;
        targetNpc->pos = targetVeh->pos + glm::vec3(0.0f, 0.2f, 0.0f);
        targetNpc->yawRad = targetVeh->yawRad;
        setGpsWaypoint(targetVeh->pos, "Tail " + sv.targetName + " -> " + sv.waypointNames[static_cast<size_t>(sv.waypointStep)]);
      } else {
        targetVeh->speed = 0.0f;
        const size_t stepIdx = static_cast<size_t>(sv.waypointStep);
        targetNpc->pos = wp + glm::vec3(2.4f, 0.0f, 1.2f);
        targetNpc->pos.y = (wp.y > 4.0f) ? wp.y : std::max(world.heightfield.sampleHeight(targetNpc->pos.x, targetNpc->pos.z), 2.85f);
        triggerCommsLine(
          sv.waypointIsolated[stepIdx] ? "MARA VANCE" : sv.targetName,
          sv.waypointSubtitles[stepIdx],
          sv.waypointAudioMp3[stepIdx],
          audio,
          sv.waypointIsolated[stepIdx] ? nullptr : &targetNpc->pos);

        if (sv.waypointIsolated[stepIdx]) {
          sv.phase = SurveillancePhase::IsolatedWindow;
          setGpsWaypoint(targetNpc->pos, "ISOLATED WINDOW: Eliminate " + sv.targetName + " Silently!");
          pushToast("ISOLATED WINDOW OPEN - Eliminate " + sv.targetName + " silently [V] or suppressed!", 4.5f);
        } else if (sv.waypointStep == 0) {
          sv.phase = SurveillancePhase::ObservingStop;
          sv.stopDwellTimer = 6.0f;
          setGpsWaypoint(targetNpc->pos, "Observe " + sv.targetName + " (Wait for Isolated Stop!)");
        } else {
          sv.waypointStep++;
        }
      }
    } else if (sv.phase == SurveillancePhase::ObservingStop) {
      sv.stopDwellTimer -= dt;
      if (sv.stopDwellTimer <= 0.0f) {
        sv.waypointStep++;
        sv.phase = SurveillancePhase::TailingVehicle;
      }
    }
  }
}

void GameSession::appendCampaignMarkers(float elapsedSec, std::vector<WorldMarkerBox>& out) const {
  const float pulse = 0.5f + 0.5f * std::sin(elapsedSec * 4.2f);

  // 1. Open-world Story Beacons when idle
  if (!activeMission_.active && !activeSurveillance_.active) {
    for (const auto& ch : storyChapters_) {
      if (!isChapterUnlocked(ch.chapter)) continue;
      const bool isNext = (!ch.completed && ch.chapter == storyStep_);
      const float ringScale = isNext ? (2.8f + pulse * 0.7f) : 2.1f;
      out.push_back({ch.beaconPos + glm::vec3(0.0f, 0.16f, 0.0f), {ringScale, 0.18f, ringScale}, elapsedSec * 1.1f, ch.accentColor, 0.0f, isNext ? 2.6f : 1.5f, 0.25f, 0.2f});
      out.push_back({ch.beaconPos + glm::vec3(0.0f, 7.5f, 0.0f), {0.38f, 15.0f, 0.38f}, elapsedSec * 1.6f, ch.accentColor, 0.0f, isNext ? 2.4f : 1.1f, 0.25f, 0.2f});
    }
  }

  // 2. Active Mission Interactables, Destroyable Relays/Crates, Sniper Towers, Mortar Zones & Extraction
  if (activeMission_.active) {
    for (const auto& it : activeMission_.interactables) {
      if (it.completed) continue;
      glm::vec3 col = {0.18f, 0.88f, 1.0f};
      if (it.kind == MissionInteractKind::Diamond) col = {0.82f, 0.38f, 1.0f};
      else if (it.kind == MissionInteractKind::Relic) col = {1.0f, 0.80f, 0.18f};
      else if (it.kind == MissionInteractKind::Files) col = {0.25f, 0.95f, 0.58f};

      // Pedestal / desk base + glowing objective prop
      out.push_back({it.pos + glm::vec3(0.0f, 0.45f, 0.0f), {0.95f, 0.90f, 0.65f}, 0.0f, {0.16f, 0.19f, 0.24f}, 0.0f, 0.0f, 0.42f, 0.72f});
      out.push_back({it.pos + glm::vec3(0.0f, 1.12f + pulse * 0.12f, 0.0f), {0.46f, 0.34f, 0.36f}, elapsedSec * 1.8f, col, 0.0f, 2.5f, 0.20f, 0.60f});
    }

    for (const auto& d : activeMission_.destroyables) {
      if (d.destroyed) continue;
      out.push_back({d.pos + glm::vec3(0.0f, 0.95f, 0.0f), {1.15f, 1.90f, 1.15f}, 0.0f, {0.24f, 0.26f, 0.30f}, 0.0f, 0.0f, 0.38f, 0.78f});
      out.push_back({d.pos + glm::vec3(0.0f, 2.05f, 0.0f), {0.32f, 0.45f, 0.32f}, elapsedSec * 3.0f, {1.0f, 0.32f, 0.16f}, 0.0f, 2.8f, 0.2f, 0.5f});
    }

    // Elevated sniper guard platforms so rooftop snipers stand on visible steel watchtowers
    for (const auto& n : npcs_) {
      if (n.contractIdx == -2 && n.alive && n.role == EnemyRole::Sniper && n.pos.y > activeMission_.siteOrigin.y + 1.8f) {
        const float h = n.pos.y - activeMission_.siteOrigin.y;
        out.push_back({{n.pos.x, activeMission_.siteOrigin.y + h * 0.5f, n.pos.z}, {2.4f, h, 2.4f}, 0.0f, {0.18f, 0.21f, 0.26f}, 0.0f, 0.0f, 0.48f, 0.65f});
      }
    }

    // Mortar Barrage red blast warning rings
    for (const auto& mz : activeMission_.mortarZones) {
      const float urgency = 1.0f - std::clamp(mz.fuseTimer / mz.maxFuse, 0.0f, 1.0f);
      const float r = mz.radius * 2.0f;
      out.push_back({mz.pos + glm::vec3(0.0f, 0.12f, 0.0f), {r, 0.14f, r}, elapsedSec * 4.0f, {1.0f, 0.15f, 0.12f}, 0.0f, 2.2f + urgency * 2.0f, 0.25f, 0.1f});
    }

    // Extraction Zone ring
    if (activeMission_.extractionReadySpoken) {
      out.push_back({activeMission_.extractionPos + glm::vec3(0.0f, 0.22f, 0.0f),
                     {3.8f + pulse * 0.8f, 0.24f, 3.8f + pulse * 0.8f}, 0.0f, {0.18f, 0.96f, 0.55f}, 0.0f, 2.8f, 0.2f, 0.2f});
      out.push_back({activeMission_.extractionPos + glm::vec3(0.0f, 9.0f, 0.0f),
                     {0.48f, 18.0f, 0.48f}, elapsedSec * 2.0f, {0.18f, 0.96f, 0.55f}, 0.0f, 2.4f, 0.2f, 0.2f});
    }
  }

  // 3. Active Surveillance Target Halo
  if (activeSurveillance_.active) {
    for (const auto& n : npcs_) {
      if (n.id == activeSurveillance_.targetNpcId && n.alive) {
        const glm::vec3 col = (activeSurveillance_.phase == SurveillancePhase::IsolatedWindow)
          ? glm::vec3(0.16f, 0.96f, 0.52f)
          : glm::vec3(0.98f, 0.68f, 0.12f);
        out.push_back({n.pos + glm::vec3(0.0f, 2.25f + pulse * 0.15f, 0.0f), {0.32f, 0.32f, 0.32f}, elapsedSec * 2.5f, col, 0.0f, 2.6f, 0.2f, 0.2f});
        break;
      }
    }
  }
}

void GameSession::appendCampaignLights(float /*elapsedSec*/, std::vector<DynamicPointLight>& out) const {
  if (activeMission_.active) {
    for (const auto& it : activeMission_.interactables) {
      if (it.completed || out.size() >= 22) continue;
      out.push_back({it.pos + glm::vec3(0.0f, 1.3f, 0.0f), 7.5f, {0.22f, 0.85f, 1.0f}, 1.4f});
    }
    for (const auto& mz : activeMission_.mortarZones) {
      if (out.size() >= 23) break;
      out.push_back({mz.pos + glm::vec3(0.0f, 1.0f, 0.0f), 9.0f, {1.0f, 0.20f, 0.10f}, 2.4f});
    }
  }
}

} // namespace westgate
