#include "westgate/AudioEngine.hpp"
#include "westgate/CharacterAnimator.hpp"
#include "westgate/EngineTypes.hpp"
#include "westgate/GameHud.hpp"
#include "westgate/GameSession.hpp"
#include "westgate/GltfAssetLoader.hpp"
#include "westgate/PhysicsWorld.hpp"
#include "westgate/PlayerController.hpp"
#include "westgate/WeaponSystem3D.hpp"
#include "westgate/WgpuContext.hpp"
#include "westgate/WorldData.hpp"
#include "westgate/WorldRenderer.hpp"

#include "imgui.h"
#include "imgui_impl_sdl3.h"
#include "imgui_impl_wgpu.h"
#include <SDL3/SDL.h>
#include <algorithm>
#include <array>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <filesystem>
#include <string>
#include <unordered_map>
#include <vector>

namespace {

std::filesystem::path findAssetsRoot(const char* argv0) {
  std::filesystem::path exeDir = argv0 ? std::filesystem::path(argv0).parent_path() : std::filesystem::current_path();
  const std::filesystem::path candidates[] = {
    exeDir / "assets",
    std::filesystem::current_path() / "assets",
    std::filesystem::current_path() / "native" / "assets",
    std::filesystem::current_path().parent_path() / "assets",
  };
  for (const auto& c : candidates) {
    if (std::filesystem::exists(c / "world" / "westgate_world.json")) return c;
  }
  return exeDir / "assets";
}

} // namespace

int main(int argc, char** argv) {
  std::string headlessShotPath;
  int headlessFrames = 20;
  bool headlessWalkForward = false;
  bool headlessShowPhone = false;
  int headlessPhoneTab = -1;
  bool headlessTestReconfigure = false;
  int headlessSelectSlot = -1;
  bool headlessUnlockWeapons = false;
  bool headlessAimDown = false;
  int headlessSuitIdx = -1;
  int headlessContractIdx = -1;
  int headlessStartChapter = -1;
  int headlessEnterApartment = -1;
  int headlessSpawnVehKind = -1;
  int headlessPaintIdx = -1;
  bool headlessBoardVeh = false;
  bool hasHeadlessDrive = false;
  float headlessDriveFwd = 0.0f;
  float headlessDriveRight = 0.0f;
  bool headlessDriveJump = false;
  int headlessDriveCam = -1;
  bool hasTeleportOverride = false;
  glm::vec3 teleportOverridePos{0.0f};
  float teleportOverrideYawDeg = 0.0f;
  bool hasCamOverride = false;
  glm::vec3 camOverridePos{0.0f};
  glm::vec3 camOverrideTarget{0.0f};
  std::string todOverride;
  std::string weatherOverride;
  bool headlessFirstPerson = false;
  int headlessGunsmithSlot = -1;
  int headlessGunsmithPreset = -1;
  bool hasHeadlessGunsmithYaw = false;
  float headlessGunsmithYaw = 0.0f;
  int headlessWepOptic = -1;
  int headlessWepMuzzle = -1;
  int headlessWepUnder = -1;
  int headlessWepMag = -1;
  int headlessWepBodyFin = -1;
  int headlessWepAccFin = -1;
  int headlessWepHwFin = -1;
  int headlessWepReticle = -1;

  int headlessW = 1280;
  int headlessH = 720;
  for (int i = 1; i < argc; ++i) {
    const std::string arg = argv[i];
    if (arg == "--headless-shot" && i + 1 < argc) {
      headlessShotPath = argv[++i];
    } else if (arg == "--res" && i + 1 < argc) {
      int rw = 0, rh = 0;
      if (std::sscanf(argv[++i], "%dx%d", &rw, &rh) == 2 && rw >= 160 && rh >= 120) {
        headlessW = rw;
        headlessH = rh;
      }
    } else if (arg == "--frames" && i + 1 < argc) {
      headlessFrames = std::max(1, std::atoi(argv[++i]));
    } else if (arg == "--walk-forward") {
      headlessWalkForward = true;
    } else if (arg == "--show-phone") {
      headlessShowPhone = true;
    } else if (arg == "--phone-tab" && i + 1 < argc) {
      headlessShowPhone = true;
      headlessPhoneTab = std::atoi(argv[++i]);
    } else if (arg == "--spawn-vehicle" && i + 1 < argc) {
      headlessSpawnVehKind = std::atoi(argv[++i]);
    } else if (arg == "--paint" && i + 1 < argc) {
      headlessPaintIdx = std::atoi(argv[++i]);
    } else if (arg == "--board-vehicle") {
      headlessBoardVeh = true;
    } else if (arg == "--drive" && i + 1 < argc) {
      int jmp = 0, cm = 0;
      if (std::sscanf(argv[++i], "%f,%f,%d,%d", &headlessDriveFwd, &headlessDriveRight, &jmp, &cm) >= 2) {
        hasHeadlessDrive = true;
        headlessDriveJump = (jmp != 0);
        headlessDriveCam = cm;
      }
    } else if (arg == "--test-reconfigure") {
      headlessTestReconfigure = true;
    } else if (arg == "--select-slot" && i + 1 < argc) {
      headlessSelectSlot = std::atoi(argv[++i]);
    } else if (arg == "--unlock-weapons") {
      headlessUnlockWeapons = true;
    } else if (arg == "--aim") {
      headlessAimDown = true;
    } else if (arg == "--suit" && i + 1 < argc) {
      headlessSuitIdx = std::atoi(argv[++i]);
    } else if (arg == "--accept-contract" && i + 1 < argc) {
      headlessContractIdx = std::atoi(argv[++i]);
    } else if (arg == "--start-chapter" && i + 1 < argc) {
      headlessStartChapter = std::atoi(argv[++i]);
    } else if (arg == "--enter-apartment" && i + 1 < argc) {
      headlessEnterApartment = std::atoi(argv[++i]);
    } else if (arg == "--teleport" && i + 1 < argc) {
      float tx = 0.0f, ty = 0.0f, tz = 0.0f, tyaw = 0.0f;
      if (std::sscanf(argv[++i], "%f,%f,%f,%f", &tx, &ty, &tz, &tyaw) >= 3) {
        hasTeleportOverride = true;
        teleportOverridePos = {tx, ty, tz};
        teleportOverrideYawDeg = tyaw;
      }
    } else if (arg == "--cam" && i + 1 < argc) {
      float cx = 0.0f, cy = 0.0f, cz = 0.0f, tx = 0.0f, ty = 0.0f, tz = 0.0f;
      if (std::sscanf(argv[++i], "%f,%f,%f,%f,%f,%f", &cx, &cy, &cz, &tx, &ty, &tz) == 6) {
        hasCamOverride = true;
        camOverridePos = {cx, cy, cz};
        camOverrideTarget = {tx, ty, tz};
      }
    } else if (arg == "--tod" && i + 1 < argc) {
      todOverride = argv[++i];
    } else if (arg == "--weather" && i + 1 < argc) {
      weatherOverride = argv[++i];
    } else if (arg == "--first-person") {
      headlessFirstPerson = true;
    } else if (arg == "--ads") {
      headlessAimDown = true;
    } else if (arg == "--gunsmith" && i + 1 < argc) {
      headlessGunsmithSlot = std::atoi(argv[++i]);
    } else if (arg == "--gunsmith-preset" && i + 1 < argc) {
      headlessGunsmithPreset = std::atoi(argv[++i]);
    } else if (arg == "--gunsmith-yaw" && i + 1 < argc) {
      hasHeadlessGunsmithYaw = true;
      headlessGunsmithYaw = static_cast<float>(std::atof(argv[++i]));
    } else if (arg == "--optic" && i + 1 < argc) {
      headlessWepOptic = std::atoi(argv[++i]);
    } else if (arg == "--muzzle" && i + 1 < argc) {
      headlessWepMuzzle = std::atoi(argv[++i]);
    } else if (arg == "--underbarrel" && i + 1 < argc) {
      headlessWepUnder = std::atoi(argv[++i]);
    } else if (arg == "--mag" && i + 1 < argc) {
      headlessWepMag = std::atoi(argv[++i]);
    } else if (arg == "--finish" && i + 1 < argc) {
      headlessWepBodyFin = std::atoi(argv[++i]);
    } else if (arg == "--accent-finish" && i + 1 < argc) {
      headlessWepAccFin = std::atoi(argv[++i]);
    } else if (arg == "--hardware-finish" && i + 1 < argc) {
      headlessWepHwFin = std::atoi(argv[++i]);
    } else if (arg == "--reticle" && i + 1 < argc) {
      headlessWepReticle = std::atoi(argv[++i]);
    }
  }
  const bool headlessMode = !headlessShotPath.empty();

  if (!headlessMode) {
    if (!SDL_Init(SDL_INIT_VIDEO | SDL_INIT_GAMEPAD)) {
      std::fprintf(stderr, "SDL_Init failed: %s\n", SDL_GetError());
      return 1;
    }
  }

  const std::filesystem::path assetsRoot = findAssetsRoot(argv[0]);
  westgate::WorldData world;
  std::string err;
  if (!world.loadFromDirectory((assetsRoot / "world").string(), &err)) {
    std::fprintf(stderr, "World load failed (%s): %s\n", assetsRoot.string().c_str(), err.c_str());
    SDL_Quit();
    return 1;
  }

  std::filesystem::path publicRoot = assetsRoot;
  for (const auto& cand : {
    std::filesystem::current_path() / "public",
    std::filesystem::current_path().parent_path() / "public",
    assetsRoot.parent_path().parent_path().parent_path() / "public",
    assetsRoot
  }) {
    if (std::filesystem::exists(cand / "models" / "ph_sofa.glb") || std::filesystem::exists(cand / "models")) {
      publicRoot = cand;
      if (std::filesystem::exists(cand / "models" / "ph_sofa.glb")) break;
    }
  }
  auto resolveAsset = [&](const std::filesystem::path& rel) -> std::filesystem::path {
    if (std::filesystem::exists(assetsRoot / rel)) return assetsRoot / rel;
    if (std::filesystem::exists(publicRoot / rel)) return publicRoot / rel;
    return assetsRoot / rel;
  };

  // Load character models & animation clips (Vanguard Soldier + Bare-Knuckle Fighter + 7 City/Tactical Archetypes)
  westgate::GltfModel bodyModel, shortsModel, hairModel, soldierModel;
  westgate::GltfModel bizModel, civModel, polModel, secModel, milModel, conModel, sptModel;
  const bool hasBody = westgate::GltfAssetLoader::loadGlb(resolveAsset("characters/fighter/base_body.glb").string(), bodyModel, true, nullptr);
  const bool hasShorts = westgate::GltfAssetLoader::loadGlb(resolveAsset("characters/fighter/clothing_shorts.glb").string(), shortsModel, true, nullptr);
  const bool hasHair = westgate::GltfAssetLoader::loadGlb(resolveAsset("characters/fighter/hair_short02.glb").string(), hairModel, true, nullptr);
  const bool hasSoldier = westgate::GltfAssetLoader::loadGlb(resolveAsset("characters/soldier.glb").string(), soldierModel, true, nullptr);
  const bool hasBiz = westgate::GltfAssetLoader::loadGlb(resolveAsset("characters/business.glb").string(), bizModel, true, nullptr);
  const bool hasCiv = westgate::GltfAssetLoader::loadGlb(resolveAsset("characters/civilian.glb").string(), civModel, true, nullptr);
  const bool hasPol = westgate::GltfAssetLoader::loadGlb(resolveAsset("characters/police.glb").string(), polModel, true, nullptr);
  const bool hasSec = westgate::GltfAssetLoader::loadGlb(resolveAsset("characters/security.glb").string(), secModel, true, nullptr);
  const bool hasMil = westgate::GltfAssetLoader::loadGlb(resolveAsset("characters/military.glb").string(), milModel, true, nullptr);
  const bool hasCon = westgate::GltfAssetLoader::loadGlb(resolveAsset("characters/construction.glb").string(), conModel, true, nullptr);
  const bool hasSpt = westgate::GltfAssetLoader::loadGlb(resolveAsset("characters/sports.glb").string(), sptModel, true, nullptr);
  westgate::GltfModel dogModel, deerModel;
  const bool hasDog = westgate::GltfAssetLoader::loadGlb(resolveAsset("models/dog_husky.glb").string(), dogModel, true, nullptr);
  const bool hasDeer = westgate::GltfAssetLoader::loadGlb(resolveAsset("models/deer.glb").string(), deerModel, true, nullptr);

  std::unordered_map<std::string, westgate::CharacterAnimator::SourceClip> clips;
  if (hasBiz) {
    for (size_t i = 0; i < bizModel.animations.size(); ++i) {
      westgate::CharacterAnimator::SourceClip sc;
      const std::string& nm = bizModel.animations[i].name;
      if (westgate::CharacterAnimator::buildSourceClip(nm, bizModel, i, true, sc)) {
        clips[nm] = std::move(sc);
      }
    }
  }
  struct CombatClipDef {
    const char* id;
    const char* file;
    bool loop;
    float tStart;
    float tEnd;
    bool pingPong;
  };
  const CombatClipDef combatDefs[] = {
    {"fight_idle", "animations/combat/fight_idle.glb", true,  0.00f, -1.00f, false},
    {"jab",        "animations/combat/jab.glb",        false, 0.22f,  1.05f, false},
    {"cross",      "animations/combat/cross.glb",      false, 0.65f,  1.55f, false},
    {"hook",       "animations/combat/hook.glb",       false, 0.72f,  1.72f, false},
    {"uppercut",   "animations/combat/uppercut.glb",   false, 0.16f,  0.96f, false},
    {"kick",       "animations/combat/kick.glb",       false, 0.22f,  1.28f, false},
    {"block",      "animations/combat/block.glb",      true,  0.44f,  0.86f, true},
    {"dodge",      "animations/combat/dodge.glb",      false, 0.04f,  0.78f, false},
    {"hit",        "animations/combat/hit.glb",        false, 0.05f,  0.78f, false},
    {"knockdown",  "animations/combat/knockdown.glb",  false, 0.05f,  2.15f, false},
  };
  for (const auto& def : combatDefs) {
    westgate::GltfModel am;
    if (westgate::GltfAssetLoader::loadGlb(resolveAsset(def.file).string(), am, false, nullptr)) {
      westgate::CharacterAnimator::SourceClip sc;
      if (westgate::CharacterAnimator::buildSourceClip(def.id, am, 0, def.loop, sc, def.tStart, def.tEnd, def.pingPong)) {
        clips[def.id] = std::move(sc);
      }
    }
  }

  westgate::CharacterAnimator bodyAnim, shortsAnim, hairAnim, soldierAnim;
  westgate::CharacterAnimator bizAnim, civAnim, polAnim, secAnim, milAnim, conAnim, sptAnim;
  if (hasBody) bodyAnim.initForTarget(bodyModel);
  if (hasShorts) shortsAnim.initForTarget(shortsModel);
  if (hasHair) hairAnim.initForTarget(hairModel);
  if (hasSoldier) soldierAnim.initForTarget(soldierModel);
  if (hasBiz) bizAnim.initForTarget(bizModel);
  if (hasCiv) civAnim.initForTarget(civModel);
  if (hasPol) polAnim.initForTarget(polModel);
  if (hasSec) secAnim.initForTarget(secModel);
  if (hasMil) milAnim.initForTarget(milModel);
  if (hasCon) conAnim.initForTarget(conModel);
  if (hasSpt) sptAnim.initForTarget(sptModel);
  westgate::CharacterAnimator dogAnim, deerAnim;
  if (hasDog) dogAnim.initForTarget(dogModel);
  if (hasDeer) deerAnim.initForTarget(deerModel);

  auto computeSkinnedScaleAndGround = [](const westgate::GltfModel& mdl, const westgate::CharacterAnimator& anim, float targetH, float& outScale, float& outYOff) {
    outScale = 1.0f;
    outYOff = 0.0f;
    std::array<glm::mat4, westgate::kMaxSkinBones> restPal{};
    anim.evaluateRest(restPal);
    float minY = 1e9f, maxY = -1e9f;
    for (const auto& prim : mdl.primitives) {
      for (const auto& v : prim.vertices) {
        const glm::mat4 m =
          restPal[std::min<uint32_t>(v.joints.x, westgate::kMaxSkinBones - 1)] * v.weights.x +
          restPal[std::min<uint32_t>(v.joints.y, westgate::kMaxSkinBones - 1)] * v.weights.y +
          restPal[std::min<uint32_t>(v.joints.z, westgate::kMaxSkinBones - 1)] * v.weights.z +
          restPal[std::min<uint32_t>(v.joints.w, westgate::kMaxSkinBones - 1)] * v.weights.w;
        const float py = (m * glm::vec4(v.position, 1.0f)).y;
        minY = std::min(minY, py);
        maxY = std::max(maxY, py);
      }
    }
    const float spanY = maxY - minY;
    if (spanY > 1e-4f) {
      outScale = targetH / spanY;
      outYOff = -minY * outScale;
    }
  };
  float dogScale = 1.0f, dogGroundOff = 0.0f;
  float deerScale = 1.0f, deerGroundOff = 0.0f;
  if (hasDog) computeSkinnedScaleAndGround(dogModel, dogAnim, 0.68f, dogScale, dogGroundOff);
  if (hasDeer) computeSkinnedScaleAndGround(deerModel, deerAnim, 1.28f, deerScale, deerGroundOff);

  westgate::PhysicsWorld physics;
  if (!physics.initFromWorld(world, &err)) {
    std::fprintf(stderr, "Physics init failed: %s\n", err.c_str());
    SDL_Quit();
    return 1;
  }

  westgate::PlayerController player;
  player.init(&physics, world.spawnPos, world.spawnYawDeg);

  westgate::ChunkStreamer streamer(335.0f, 1550.0f, 24.0f);
  streamer.init(world);

  westgate::AudioEngine audio;
  audio.setAssetsRoot(publicRoot.string());
  if (!headlessMode) {
    audio.init();
  }

  westgate::GameSession session;
  session.init(world, &player, &physics);

  westgate::HudUiState ui;
  ui.savePath = (assetsRoot.parent_path() / "westgate_save.json").string();
  if (!headlessMode) {
    session.loadFromFile(ui.savePath);
  } else {
    ui.showPhone = headlessShowPhone;
    ui.forcePhoneTab = headlessPhoneTab;
  }

  if (headlessSuitIdx >= 0 && headlessSuitIdx < westgate::kPlayerSuitCount) {
    session.setPlayerSuit(static_cast<westgate::PlayerSuitPreset>(headlessSuitIdx));
  }
  if (headlessUnlockWeapons) {
    session.unlockAllWeapons();
  }
  {
    const int cfgSlot = (headlessGunsmithSlot >= 1 && headlessGunsmithSlot < static_cast<int>(session.weapons().size()))
      ? headlessGunsmithSlot
      : ((headlessSelectSlot >= 1 && headlessSelectSlot < static_cast<int>(session.weapons().size())) ? headlessSelectSlot : 2);
    const auto& cw = session.weapons()[static_cast<size_t>(cfgSlot)];
    if (headlessWepOptic >= 0 || headlessWepMuzzle >= 0 || headlessWepUnder >= 0 || headlessWepMag >= 0 || headlessWepBodyFin >= 0) {
      session.configureWeaponSlot(
        cfgSlot,
        headlessWepOptic >= 0 ? static_cast<westgate::WeaponOpticKind>(std::clamp(headlessWepOptic, 0, 4)) : cw.optic,
        headlessWepMuzzle >= 0 ? static_cast<westgate::WeaponMuzzleKind>(std::clamp(headlessWepMuzzle, 0, 4)) : cw.muzzle,
        headlessWepUnder >= 0 ? static_cast<westgate::WeaponUnderbarrelKind>(std::clamp(headlessWepUnder, 0, 3)) : cw.underbarrel,
        headlessWepMag >= 0 ? static_cast<westgate::WeaponMagKind>(std::clamp(headlessWepMag, 0, 2)) : cw.mag,
        headlessWepBodyFin >= 0 ? static_cast<westgate::WeaponFinishKind>(std::clamp(headlessWepBodyFin, 0, 7)) : cw.bodyFinish
      );
    }
    if (headlessWepAccFin >= 0 || headlessWepHwFin >= 0 || headlessWepReticle >= 0) {
      const auto& cw2 = session.weapons()[static_cast<size_t>(cfgSlot)];
      session.configureWeaponZones(
        cfgSlot,
        cw2.bodyFinish,
        headlessWepAccFin >= 0 ? static_cast<westgate::WeaponFinishKind>(std::clamp(headlessWepAccFin, 0, 7)) : cw2.accentFinish,
        headlessWepHwFin >= 0 ? static_cast<westgate::WeaponFinishKind>(std::clamp(headlessWepHwFin, 0, 7)) : cw2.hardwareFinish,
        cw2.surfaceSheen,
        headlessWepReticle >= 0 ? static_cast<uint8_t>(std::clamp(headlessWepReticle, 0, 4)) : cw2.reticleColorIdx
      );
    }
  }
  if (headlessFirstPerson) {
    session.setFirstPersonMode(true);
    player.setPitch(0.0f);
  }
  if (headlessGunsmithSlot >= 1 && headlessGunsmithSlot < static_cast<int>(session.weapons().size())) {
    session.setGunsmithOpen(true);
    session.setGunsmithSlot(headlessGunsmithSlot);
    session.setGunsmithAutoRotate(false);
    if (headlessGunsmithPreset >= 0) {
      session.setGunsmithCameraPreset(headlessGunsmithPreset);
    }
    if (hasHeadlessGunsmithYaw) {
      session.orbitGunsmith(headlessGunsmithYaw - session.gunsmithYaw(), 0.0f, 0.0f);
    }
  }
  if (headlessContractIdx >= 0) {
    session.acceptContract(headlessContractIdx, world);
  }
  if (headlessStartChapter >= 0) {
    session.startStoryChapter(headlessStartChapter, player, world, nullptr, true);
  }
  if (headlessEnterApartment >= 0) {
    session.grantCurrencies(5000, 0, 0);
    session.buyApartment(headlessEnterApartment, nullptr);
    session.enterApartment(headlessEnterApartment, player, nullptr);
  }
  if (hasTeleportOverride) {
    session.teleportTo(teleportOverridePos, teleportOverrideYawDeg, player);
  }
  if (headlessPaintIdx >= 0) {
    session.setSelectedPaintIdx(headlessPaintIdx);
  }
  if (headlessSpawnVehKind >= 0 && headlessSpawnVehKind < static_cast<int>(westgate::kVehicleModelCount)) {
    const auto hk = static_cast<westgate::VehicleModelKind>(headlessSpawnVehKind);
    session.grantVehicleOwnership(hk);
    session.spawnPersonalVehicle(hk, session.selectedPaintIdx(), player, world, nullptr, headlessBoardVeh);
  }
  if (headlessDriveCam > 0) {
    for (int ci = 0; ci < headlessDriveCam; ++ci) session.cycleDriveCameraMode();
  }
  if (!todOverride.empty()) {
    if (todOverride == "sunset") session.setTimeOfDayPreset(westgate::TimeOfDayPreset::Sunset);
    else if (todOverride == "night") session.setTimeOfDayPreset(westgate::TimeOfDayPreset::Night);
    else if (todOverride == "dawn") session.setTimeOfDayPreset(westgate::TimeOfDayPreset::Dawn);
    else session.setTimeOfDayPreset(westgate::TimeOfDayPreset::Afternoon);
  }
  if (!weatherOverride.empty()) {
    if (weatherOverride == "overcast") session.setWeatherPreset(westgate::WeatherPreset::Overcast);
    else if (weatherOverride == "rain") session.setWeatherPreset(westgate::WeatherPreset::Rain);
    else if (weatherOverride == "storm") session.setWeatherPreset(westgate::WeatherPreset::Thunderstorm);
    else session.setWeatherPreset(westgate::WeatherPreset::Clear);
  }

  float scale = headlessMode ? 1.0f : SDL_GetDisplayContentScale(SDL_GetPrimaryDisplay());
  if (scale <= 0.0f) scale = 1.0f;
  const int initW = headlessMode ? headlessW : static_cast<int>(1280 * scale);
  const int initH = headlessMode ? headlessH : static_cast<int>(720 * scale);

  SDL_Window* window = nullptr;
  westgate::WgpuContext gpu;
  if (headlessMode) {
    if (!gpu.initOffscreen(static_cast<uint32_t>(initW), static_cast<uint32_t>(initH), &err)) {
      std::fprintf(stderr, "WgpuContext offscreen init failed: %s\n", err.c_str());
      physics.shutdown();
      return 1;
    }
  } else {
    window = SDL_CreateWindow("Westgate Bay - Custom Native C++20 Engine (SDL3 + wgpu + Jolt)", initW, initH, SDL_WINDOW_RESIZABLE);
    if (!window) {
      std::fprintf(stderr, "SDL_CreateWindow failed: %s\n", SDL_GetError());
      SDL_Quit();
      return 1;
    }
    if (!gpu.init(window, static_cast<uint32_t>(initW), static_cast<uint32_t>(initH), &err)) {
      std::fprintf(stderr, "WgpuContext init failed: %s\n", err.c_str());
      SDL_DestroyWindow(window);
      SDL_Quit();
      return 1;
    }
  }

  IMGUI_CHECKVERSION();
  ImGui::CreateContext();
  ImGuiIO& io = ImGui::GetIO();
  io.ConfigFlags |= ImGuiConfigFlags_NavEnableKeyboard;
  io.Fonts->AddFontDefault();
  ImGui::StyleColorsDark();
  ImGui::GetStyle().ScaleAllSizes(scale);

  if (!headlessMode) {
    ImGui_ImplSDL3_InitForOther(window);
  }
  ImGui_ImplWGPU_InitInfo uiInfo{};
  uiInfo.Device = gpu.device();
  uiInfo.NumFramesInFlight = 3;
  uiInfo.RenderTargetFormat = gpu.surfaceFormat();
  uiInfo.DepthStencilFormat = WGPUTextureFormat_Undefined;
  ImGui_ImplWGPU_Init(&uiInfo);

  westgate::WorldRenderAssets renderAssets;
  renderAssets.assetsRoot = publicRoot.string();
  renderAssets.playerBody = hasBody ? &bodyModel : nullptr;
  renderAssets.playerShorts = hasShorts ? &shortsModel : nullptr;
  renderAssets.playerHair = hasHair ? &hairModel : nullptr;
  renderAssets.vanguardSoldier = hasSoldier ? &soldierModel : nullptr;
  renderAssets.businessModel = hasBiz ? &bizModel : nullptr;
  renderAssets.civilianModel = hasCiv ? &civModel : nullptr;
  renderAssets.policeModel = hasPol ? &polModel : nullptr;
  renderAssets.securityModel = hasSec ? &secModel : nullptr;
  renderAssets.militaryModel = hasMil ? &milModel : nullptr;
  renderAssets.constructionModel = hasCon ? &conModel : nullptr;
  renderAssets.sportsModel = hasSpt ? &sptModel : nullptr;
  renderAssets.dogHuskyModel = hasDog ? &dogModel : nullptr;
  renderAssets.deerModel = hasDeer ? &deerModel : nullptr;

  westgate::WorldRenderer renderer;
  std::filesystem::path shaderPath = assetsRoot / "shaders" / "westgate.wgsl";
  if (std::filesystem::exists("native/shaders/westgate.wgsl")) {
    shaderPath = "native/shaders/westgate.wgsl";
  }
  if (!renderer.init(gpu, world, shaderPath.string(), renderAssets, &err)) {
    std::fprintf(stderr, "WorldRenderer init failed: %s\n", err.c_str());
    ImGui_ImplWGPU_Shutdown();
    if (!headlessMode) ImGui_ImplSDL3_Shutdown();
    ImGui::DestroyContext();
    gpu.shutdown();
    if (window) SDL_DestroyWindow(window);
    if (!headlessMode) SDL_Quit();
    return 1;
  }

  std::array<glm::mat4, westgate::kMaxSkinBones> palBody{}, palShorts{}, palHair{};
  std::array<glm::mat4, westgate::kMaxSkinBones> palOppBody{}, palOppShorts{}, palOppHair{};
  std::array<glm::mat4, westgate::kMaxSkinBones> palSpecBody{}, palSpecShorts{}, palSpecHair{};
  std::vector<std::array<glm::mat4, westgate::kMaxSkinBones>> npcPalettes(westgate::kMaxSkinSlots);
  palBody.fill(glm::mat4(1.0f));
  palShorts.fill(glm::mat4(1.0f));
  palHair.fill(glm::mat4(1.0f));
  palOppBody.fill(glm::mat4(1.0f));
  palOppShorts.fill(glm::mat4(1.0f));
  palOppHair.fill(glm::mat4(1.0f));
  palSpecBody.fill(glm::mat4(1.0f));
  palSpecShorts.fill(glm::mat4(1.0f));
  palSpecHair.fill(glm::mat4(1.0f));

  bool running = true;
  westgate::FrameTimer timer;
  float physicsAccum = 0.0f;
  float elapsedSec = 0.0f;
  float prevPlayerYaw = player.yaw();
  float turnBankSmooth = 0.0f;
  float weaponHoldSmooth = 0.0f;
  float aimSmooth = 0.0f;
  float fistSmooth = 0.0f;
  float crouchSmooth = 0.0f;
  float airSmooth = 0.0f;
  westgate::CharacterAnimState playerAnimState{};
  westgate::CharacterAnimState pitOppAnimState{};
  westgate::CharacterAnimState specRedAnimState{};
  westgate::CharacterAnimState specBlueAnimState{};
  std::unordered_map<uint32_t, westgate::CharacterAnimState> npcAnimStates;
  std::vector<westgate::SkinnedRenderCharacter> renderChars;
  std::vector<westgate::DynamicPropPose> dynamicProps;
  std::vector<westgate::WeaponPartDrawInstance> weaponPartInstances;

  int headlessStep = 0;
  while (running) {
    const float dt = headlessMode ? (1.0f / 60.0f) : static_cast<float>(timer.tickSeconds());
    elapsedSec += dt;

    westgate::GameInputFrame gameInput{};
    float lookDx = 0.0f;
    float lookDy = 0.0f;
    bool jumpPressed = false;
    glm::vec3 pHandWorld{0.0f};
    bool hasPlayerHandWorld = false;

    if (headlessMode) {
      if (headlessWalkForward) {
        gameInput.moveInput.moveForward = 1.0f;
      }
      if (hasHeadlessDrive) {
        gameInput.moveInput.moveForward = headlessDriveFwd;
        gameInput.moveInput.moveRight = headlessDriveRight;
        gameInput.moveInput.jump = headlessDriveJump;
      }
      if (headlessStep == 1 && headlessSelectSlot >= 0) {
        gameInput.selectWeaponSlot = headlessSelectSlot;
      }
      if (headlessAimDown) {
        gameInput.aimDown = true;
      }
      gameInput.moveInput.firstPersonLook = session.firstPersonMode() && !session.inVehicle();
      if (headlessTestReconfigure && headlessStep == 2) {
        // Simulate Windows swapchain SubOptimal depth recreation mid-movement to verify zero frozen SSAO silhouette
        gpu.reconfigureSurface(true);
      }
    } else {
      SDL_Event ev;
      while (SDL_PollEvent(&ev)) {
        ImGui_ImplSDL3_ProcessEvent(&ev);
        if (ev.type == SDL_EVENT_QUIT) running = false;
        if (ev.type == SDL_EVENT_WINDOW_CLOSE_REQUESTED && ev.window.windowID == SDL_GetWindowID(window)) running = false;
        if (ev.type == SDL_EVENT_MOUSE_MOTION) {
          if (session.gunsmithOpen()) {
            if (!io.WantCaptureMouse && (ev.motion.state & SDL_BUTTON_LMASK) != 0) {
              session.setGunsmithAutoRotate(false);
              session.orbitGunsmith(-ev.motion.xrel * 0.0085f, ev.motion.yrel * 0.0065f, 0.0f);
            }
          } else if (ui.mouseCaptured && !ui.showPhone) {
            lookDx += ev.motion.xrel;
            lookDy += ev.motion.yrel;
          }
        }
        if (ev.type == SDL_EVENT_MOUSE_BUTTON_DOWN && !session.gunsmithOpen() && ui.mouseCaptured && !ui.showPhone && ev.button.button == SDL_BUTTON_LEFT) {
          gameInput.firePressed = true;
        }
        if (ev.type == SDL_EVENT_MOUSE_WHEEL) {
          if (session.gunsmithOpen()) {
            if (!io.WantCaptureMouse) {
              session.orbitGunsmith(0.0f, 0.0f, -ev.wheel.y * 0.055f);
            }
          } else if (!ui.showPhone) {
            int slot = session.activeWeaponIdx() + (ev.wheel.y > 0 ? -1 : 1);
            const int maxS = static_cast<int>(session.weapons().size()) - 1;
            if (slot < 0) slot = maxS;
            if (slot > maxS) slot = 0;
            gameInput.selectWeaponSlot = slot;
          }
        }
        if (ev.type == SDL_EVENT_KEY_DOWN && !ev.key.repeat) {
          const SDL_Scancode sc = ev.key.scancode;
          if (sc == SDL_SCANCODE_TAB || sc == SDL_SCANCODE_ESCAPE) {
            if (session.gunsmithOpen()) {
              session.setGunsmithOpen(false);
            } else if (ui.showPhone) {
              ui.showPhone = false;
            } else {
              ui.mouseCaptured = !ui.mouseCaptured;
              SDL_SetWindowRelativeMouseMode(window, ui.mouseCaptured);
            }
          } else if (sc == SDL_SCANCODE_F2) {
            const bool nextOpen = !session.gunsmithOpen();
            session.setGunsmithOpen(nextOpen);
            if (nextOpen) {
              ui.showPhone = false;
              if (ui.mouseCaptured) {
                ui.mouseCaptured = false;
                SDL_SetWindowRelativeMouseMode(window, false);
              }
            }
          } else if (sc == SDL_SCANCODE_F5) {
            session.toggleFirstPersonMode();
          } else if (sc == SDL_SCANCODE_P) {
            if (session.gunsmithOpen()) session.setGunsmithOpen(false);
            ui.showPhone = !ui.showPhone;
            if (ui.showPhone && ui.mouseCaptured) {
              ui.mouseCaptured = false;
              SDL_SetWindowRelativeMouseMode(window, false);
            }
          } else if (sc == SDL_SCANCODE_F9) {
            ui.showTelemetry = !ui.showTelemetry;
          } else if (sc == SDL_SCANCODE_F1) {
            session.teleportTo({world.fightPitPos.x, world.fightPitPos.y + 1.0f, world.fightPitPos.z - 2.6f}, 0.0f, player);
          } else if (sc == SDL_SCANCODE_T) {
            session.cycleTimeOfDay();
          } else if (sc == SDL_SCANCODE_Y) {
            session.cycleWeather();
          } else if (sc == SDL_SCANCODE_SPACE) {
            jumpPressed = true;
          } else if (sc == SDL_SCANCODE_G) {
            gameInput.interactPressed = true;
          } else if (sc == SDL_SCANCODE_B) {
            gameInput.actionPressed = true;
          } else if (sc == SDL_SCANCODE_H) {
            gameInput.secondaryAction = true;
          } else if (sc == SDL_SCANCODE_F) {
            gameInput.firePressed = true;
          } else if (sc == SDL_SCANCODE_Q) {
            gameInput.uppercutPressed = true;
          } else if (sc == SDL_SCANCODE_E) {
            gameInput.kickPressed = true;
          } else if (sc == SDL_SCANCODE_X) {
            gameInput.dodgePressed = true;
          } else if (sc == SDL_SCANCODE_V) {
            if (session.inVehicle()) {
              session.cycleDriveCameraMode();
            } else if (session.takedownReady()) {
              gameInput.takedownPressed = true;
            } else {
              session.toggleFirstPersonMode();
            }
          } else if (sc == SDL_SCANCODE_Z) {
            gameInput.grapplePressed = true;
          } else if (sc == SDL_SCANCODE_U) {
            gameInput.takedownShootPressed = true;
          } else if (sc == SDL_SCANCODE_J) {
            gameInput.carryBodyPressed = true;
          } else if (sc == SDL_SCANCODE_R) {
            gameInput.reloadPressed = true;
            gameInput.rematchPressed = true;
          } else if (sc >= SDL_SCANCODE_1 && sc <= SDL_SCANCODE_6) {
            const int chosen = static_cast<int>(sc - SDL_SCANCODE_1);
            if (session.gunsmithOpen() && chosen >= 1) {
              session.setGunsmithSlot(chosen);
            } else {
              gameInput.selectWeaponSlot = chosen;
            }
          }
        }
      }

      int pixW = 0, pixH = 0;
      SDL_GetWindowSizeInPixels(window, &pixW, &pixH);
      if (pixW <= 0 || pixH <= 0) {
        SDL_Delay(16);
        continue;
      }
      gpu.resize(static_cast<uint32_t>(pixW), static_cast<uint32_t>(pixH));

      const bool* keys = SDL_GetKeyboardState(nullptr);
      const SDL_MouseButtonFlags mouseButtons = SDL_GetMouseState(nullptr, nullptr);
      if (!ui.showPhone && !session.gunsmithOpen()) {
        if (keys[SDL_SCANCODE_W]) gameInput.moveInput.moveForward += 1.0f;
        if (keys[SDL_SCANCODE_S]) gameInput.moveInput.moveForward -= 1.0f;
        if (keys[SDL_SCANCODE_D]) gameInput.moveInput.moveRight += 1.0f;
        if (keys[SDL_SCANCODE_A]) gameInput.moveInput.moveRight -= 1.0f;
        gameInput.moveInput.sprint = keys[SDL_SCANCODE_LSHIFT] || keys[SDL_SCANCODE_RSHIFT];
        gameInput.moveInput.crouch = keys[SDL_SCANCODE_C] || keys[SDL_SCANCODE_LCTRL];
        gameInput.moveInput.jump = jumpPressed || (session.inVehicle() && keys[SDL_SCANCODE_SPACE]);
        gameInput.moveInput.lookDeltaX = lookDx;
        gameInput.moveInput.lookDeltaY = lookDy;
        gameInput.moveInput.firstPersonLook = session.firstPersonMode() && !session.inVehicle();
        gameInput.fireDown = ui.mouseCaptured && ((mouseButtons & SDL_BUTTON_LMASK) != 0);
        gameInput.aimDown = ((mouseButtons & SDL_BUTTON_RMASK) != 0);
        gameInput.useHeld = keys[SDL_SCANCODE_E] || keys[SDL_SCANCODE_F] || keys[SDL_SCANCODE_B];
      }
    }

    session.update(dt, gameInput, player, physics, world, headlessMode ? nullptr : &audio);

    physicsAccum += dt;
    constexpr float kFixedStep = 1.0f / 60.0f;
    while (physicsAccum >= kFixedStep) {
      physics.step(kFixedStep);
      physicsAccum -= kFixedStep;
    }

    // Evaluate player skeletal parts with smooth crossfades, upper/lower combat layering, and procedural aiming/recoil
    const glm::vec3 pPos = player.position();
    const float rawYawDelta = player.yaw() - prevPlayerYaw;
    prevPlayerYaw = player.yaw();
    const float yawRate = std::clamp(rawYawDelta / std::max(0.004f, dt), -4.0f, 4.0f);
    turnBankSmooth += (yawRate * 0.25f - turnBankSmooth) * std::min(1.0f, dt * 10.0f);

    renderChars.clear();
    const auto mapNormalizedTime = [&](const std::string& clipId, float norm01) -> float {
      auto it = clips.find(clipId);
      if (it == clips.end()) return 0.0f;
      return std::clamp(norm01, 0.0f, 1.0f) * it->second.duration;
    };

    if (!session.inVehicle()) {
      const bool blocking = gameInput.aimDown && session.activeWeapon().isMelee && clips.count("block");
      const std::string atk = session.playerAttackClip();
      const bool moving = player.speed() > 0.35f;
      const std::string locoClip = session.playerAnimClip(player, false);
      const bool hasAtk = !atk.empty() && clips.count(atk);
      const float atkTime = hasAtk ? mapNormalizedTime(atk, session.playerAttackProgress()) : 0.0f;
      const float locoTime = (locoClip == "hit")
                               ? mapNormalizedTime("hit", session.playerHitAnimProgress())
                               : session.playerLocomotionTime();
      const std::string desiredBase = (!moving && hasAtk) ? atk
                                    : (moving && atk == "dodge" && hasAtk) ? atk
                                    : locoClip;
      const float desiredBaseTime = ((!moving && hasAtk) || (moving && atk == "dodge" && hasAtk))
                                      ? atkTime
                                      : locoTime;
      const std::string desiredUpper = (moving && hasAtk && atk != "dodge")
                                         ? atk
                                         : (moving && blocking ? std::string("block") : std::string());
      const float desiredUpperTime = (hasAtk && atk != "dodge") ? atkTime : elapsedSec;
      const float crossfadeSec = (hasAtk || blocking) ? 0.10f : 0.20f;

      westgate::CharacterAnimator::advanceAnimState(
        playerAnimState, desiredBase, desiredBaseTime, desiredUpper, desiredUpperTime, dt, crossfadeSec
      );

      const float targetWeaponHold = (session.isRangedWeapon() && !hasAtk) ? 1.0f : 0.0f;
      const float targetAim = (session.isRangedWeapon() && session.isAiming() && !hasAtk) ? 1.0f : 0.0f;
      const float targetFist = (session.activeWeapon().isMelee && (!moving || hasAtk || blocking || locoClip == "fight_idle"))
                                 ? 1.0f
                                 : (session.activeWeapon().isMelee ? 0.32f : 0.28f);
      const float targetCrouch = player.crouching() ? 1.0f : 0.0f;
      const float targetAir = player.grounded() ? 0.0f : 1.0f;
      const float smoothAlpha = std::min(1.0f, dt * 14.0f);
      weaponHoldSmooth += (targetWeaponHold - weaponHoldSmooth) * smoothAlpha;
      aimSmooth += (targetAim - aimSmooth) * smoothAlpha;
      fistSmooth += (targetFist - fistSmooth) * smoothAlpha;
      crouchSmooth += (targetCrouch - crouchSmooth) * std::min(1.0f, dt * 12.0f);
      airSmooth += (targetAir - airSmooth) * std::min(1.0f, dt * 16.0f);

      westgate::CharacterPoseOverlay playerOverlay{};
      playerOverlay.timeSec = elapsedSec;
      playerOverlay.seed = 1.0f;
      playerOverlay.idleWeight = moving ? 0.15f : 1.0f;
      playerOverlay.sprintLean = player.sprinting() ? std::clamp(player.speed() / 8.6f, 0.0f, 1.0f) : 0.0f;
      playerOverlay.turnBank = moving ? turnBankSmooth : 0.0f;
      playerOverlay.headLookPitch = std::clamp(player.pitch(), -0.55f, 0.55f);
      playerOverlay.weaponHoldWeight = weaponHoldSmooth;
      playerOverlay.twoHandedWeapon = session.isTwoHandedWeapon();
      playerOverlay.aimWeight = aimSmooth;
      playerOverlay.recoilKick = session.recoilImpulse();
      playerOverlay.reloadProgress = session.reloadProgress();
      playerOverlay.fistWeight = fistSmooth;
      playerOverlay.crouchWeight = crouchSmooth;
      playerOverlay.airWeight = airSmooth;

      const glm::vec4 hitFlashCol(1.55f, 0.42f, 0.42f, 1.0f);
      const bool bareKnuckle = session.shouldUseBareKnuckleRig(world, pPos);
      const bool hidePlayerBody = !hasCamOverride && (
        session.gunsmithOpen() ||
        session.firstPersonMode() ||
        (session.isAiming() && session.isRangedWeapon() &&
         session.activeWeapon().optic == westgate::WeaponOpticKind::SniperScope)
      );
      glm::vec3 playerRightHandWorld = pPos + glm::vec3(0.0f, 1.15f, 0.0f);

      if (!bareKnuckle && hasSoldier) {
        soldierAnim.evaluateState(playerAnimState, clips, palBody, &playerOverlay);
        if (!hidePlayerBody) {
          const glm::vec4 suitTint = glm::mix(westgate::GameSession::suitTintColor(session.playerSuit()), hitFlashCol, session.playerHitFlash());
          renderChars.push_back({pPos, player.yaw(), suitTint, westgate::SkinnedPartKind::VanguardSoldier, &palBody});
        }
        const glm::vec3 localHand = soldierAnim.animatedBonePos("RightHand", palBody, {0.22f, 1.10f, -0.25f});
        const glm::mat4 charWorld = glm::translate(glm::mat4(1.0f), pPos) *
                                    glm::rotate(glm::mat4(1.0f), player.yaw() + 3.14159265f, glm::vec3(0.0f, 1.0f, 0.0f));
        playerRightHandWorld = glm::vec3(charWorld * glm::vec4(localHand, 1.0f));
      } else {
        const glm::vec4 playerTint = glm::mix(glm::vec4(1.0f), hitFlashCol, session.playerHitFlash());
        if (hasBody) {
          bodyAnim.evaluateState(playerAnimState, clips, palBody, &playerOverlay);
          if (!hidePlayerBody) {
            renderChars.push_back({pPos, player.yaw(), playerTint, westgate::SkinnedPartKind::PlayerBody, &palBody});
          }
          const glm::vec3 localHand = bodyAnim.animatedBonePos("RightHand", palBody, {0.22f, 1.10f, 0.25f});
          const glm::mat4 charWorld = glm::translate(glm::mat4(1.0f), pPos) *
                                      glm::rotate(glm::mat4(1.0f), player.yaw(), glm::vec3(0.0f, 1.0f, 0.0f));
          playerRightHandWorld = glm::vec3(charWorld * glm::vec4(localHand, 1.0f));
        }
        if (hasShorts && !hidePlayerBody) {
          shortsAnim.evaluateState(playerAnimState, clips, palShorts, &playerOverlay);
          renderChars.push_back({pPos, player.yaw(), glm::vec4(0.84f, 0.22f, 0.22f, 1.0f), westgate::SkinnedPartKind::PlayerShorts, &palShorts});
        }
        if (hasHair && !hidePlayerBody) {
          hairAnim.evaluateState(playerAnimState, clips, palHair, &playerOverlay);
          renderChars.push_back({pPos, player.yaw(), glm::vec4(1.0f), westgate::SkinnedPartKind::PlayerHair, &palHair});
        }
      }
      // Cache playerRightHandWorld on a frame local for 3rd-person 3D modular weapon rendering below!
      pHandWorld = playerRightHandWorld;
      hasPlayerHandWorld = session.isRangedWeapon() && !session.isCarryingBody() && !hidePlayerBody;
    }

    auto mapPitClipTime = [&](const std::string& clipId, float stateTime) -> float {
      if (clipId == "hit") return mapNormalizedTime(clipId, stateTime / 0.55f);
      if (clipId == "uppercut" || clipId == "kick") return mapNormalizedTime(clipId, stateTime / 0.82f);
      if (clipId == "jab" || clipId == "cross" || clipId == "hook") return mapNormalizedTime(clipId, stateTime / 0.64f);
      if (clipId == "Walk") return stateTime * 1.45f;
      return stateTime;
    };

    // Iron Pit: Either Live AI-vs-AI Spectator Bout OR Player's Shirtless Championship Opponent (smooth crossfades!)
    const auto& spec = session.spectatorBout();
    if (spec.active && hasBody) {
      const auto& roster = session.pitRoster();
      const auto emitShirtlessFighter = [&](const westgate::SpectatorFighterState& fs,
                                            westgate::CharacterAnimState& animSt,
                                            float seed,
                                            std::array<glm::mat4, westgate::kMaxSkinBones>& pb,
                                            std::array<glm::mat4, westgate::kMaxSkinBones>& ps,
                                            std::array<glm::mat4, westgate::kMaxSkinBones>& ph) {
        const auto& def = roster[static_cast<size_t>(fs.fighterIdx)];
        const float xf = (fs.animClip == "Walk" || fs.animClip == "fight_idle") ? 0.18f : 0.10f;
        const float mappedT = mapPitClipTime(fs.animClip, fs.animTime);
        westgate::CharacterAnimator::advanceAnimState(animSt, fs.animClip, mappedT, "", 0.0f, dt, xf);
        westgate::CharacterPoseOverlay ov{};
        ov.timeSec = elapsedSec;
        ov.seed = seed;
        ov.idleWeight = (fs.animClip == "fight_idle") ? 1.0f : 0.15f;
        ov.fistWeight = (fs.animClip == "knockdown") ? 0.25f : 0.95f;
        ov.koProgress = fs.downed ? std::clamp(fs.animTime / 0.55f, 0.0f, 1.0f) : 0.0f;
        bodyAnim.evaluateState(animSt, clips, pb, &ov);
        const glm::vec4 bodyTint = glm::mix(glm::vec4(def.skinTint, 1.0f), glm::vec4(1.6f, 0.4f, 0.4f, 1.0f), fs.hitFlash);
        renderChars.push_back({fs.pos, fs.yawRad, bodyTint, westgate::SkinnedPartKind::PlayerBody, &pb});
        if (hasShorts) {
          shortsAnim.evaluateState(animSt, clips, ps, &ov);
          renderChars.push_back({fs.pos, fs.yawRad, glm::vec4(def.shortsTint, 1.0f), westgate::SkinnedPartKind::PlayerShorts, &ps});
        }
        if (hasHair) {
          hairAnim.evaluateState(animSt, clips, ph, &ov);
          renderChars.push_back({fs.pos, fs.yawRad, glm::vec4(def.hairTint, 1.0f), westgate::SkinnedPartKind::PlayerHair, &ph});
        }
      };
      emitShirtlessFighter(spec.red, specRedAnimState, 11.0f, palOppBody, palOppShorts, palOppHair);
      emitShirtlessFighter(spec.blue, specBlueAnimState, 23.0f, palSpecBody, palSpecShorts, palSpecHair);
    } else if (hasBody) {
      const auto& pit = session.ironPit();
      const float xf = (pit.animClip == "Walk" || pit.animClip == "fight_idle") ? 0.18f : 0.10f;
      const float mappedT = mapPitClipTime(pit.animClip, pit.animTime);
      westgate::CharacterAnimator::advanceAnimState(pitOppAnimState, pit.animClip, mappedT, "", 0.0f, dt, xf);
      westgate::CharacterPoseOverlay ov{};
      ov.timeSec = elapsedSec;
      ov.seed = 7.0f;
      ov.idleWeight = (pit.animClip == "fight_idle") ? 1.0f : 0.15f;
      ov.fistWeight = (pit.animClip == "knockdown") ? 0.25f : 0.95f;
      ov.koProgress = pit.defeated ? std::clamp(pit.animTime / 0.55f, 0.0f, 1.0f) : 0.0f;
      bodyAnim.evaluateState(pitOppAnimState, clips, palOppBody, &ov);
      const glm::vec4 oppTint = glm::mix(glm::vec4(pit.skinTint, 1.0f), glm::vec4(1.6f, 0.4f, 0.4f, 1.0f), pit.hitFlash);
      renderChars.push_back({pit.pos, pit.yawRad, oppTint, westgate::SkinnedPartKind::PlayerBody, &palOppBody});
      if (hasShorts) {
        shortsAnim.evaluateState(pitOppAnimState, clips, palOppShorts, &ov);
        renderChars.push_back({pit.pos, pit.yawRad, glm::vec4(pit.shortsTint, 1.0f), westgate::SkinnedPartKind::PlayerShorts, &palOppShorts});
      }
      if (hasHair) {
        hairAnim.evaluateState(pitOppAnimState, clips, palOppHair, &ov);
        renderChars.push_back({pit.pos, pit.yawRad, glm::vec4(pit.hairTint, 1.0f), westgate::SkinnedPartKind::PlayerHair, &palOppHair});
      }
    } else if (hasBiz) {
      const auto& pit = session.ironPit();
      westgate::CharacterAnimator::advanceAnimState(pitOppAnimState, pit.animClip, pit.animTime, "", 0.0f, dt, 0.14f);
      bizAnim.evaluateState(pitOppAnimState, clips, palOppBody);
      const glm::vec4 oppTint = glm::mix(glm::vec4(1.0f), glm::vec4(1.6f, 0.4f, 0.4f, 1.0f), pit.hitFlash);
      renderChars.push_back({pit.pos, pit.yawRad, oppTint, westgate::SkinnedPartKind::Business, &palOppBody});
    }

    weaponPartInstances.clear();
    if (session.gunsmithOpen()) {
      const int gSlot = session.gunsmithSlot();
      const auto& gw = session.weapons()[static_cast<size_t>(gSlot)];
      const glm::vec3 gAnchor = session.gunsmithAnchorPos(player) -
                                glm::vec3(0.0f, 0.0f, session.recoilImpulse() * 0.028f);
      const glm::quat gRot = glm::angleAxis(-session.recoilImpulse() * 0.085f, glm::vec3(1.0f, 0.0f, 0.0f));
      westgate::WeaponSystem3D::appendAssembledWeapon(
        gAnchor,
        gRot,
        gw,
        session.recoilImpulse(),
        0.0f,
        1.0f,
        true,
        weaponPartInstances
      );
    } else if (hasPlayerHandWorld && !session.inVehicle()) {
      const float aimPitch = -player.pitch() * (session.isAiming() ? 0.85f : 0.35f);
      const glm::quat wRot = glm::angleAxis(player.yaw(), glm::vec3(0.0f, 1.0f, 0.0f)) *
                             glm::angleAxis(aimPitch, glm::vec3(1.0f, 0.0f, 0.0f));
      westgate::WeaponSystem3D::appendAssembledWeapon(
        pHandWorld,
        wRot,
        session.activeWeapon(),
        session.recoilImpulse(),
        session.reloadProgress01(),
        1.0f,
        true,
        weaponPartInstances
      );
    }

    // Closest NPCs / Police / Contract Targets / Snipers / Heavies / Carried Corpses up to kMaxSkinSlots
    std::vector<std::pair<float, size_t>> sortedNpcs;
    sortedNpcs.reserve(session.npcs().size());
    for (size_t i = 0; i < session.npcs().size(); ++i) {
      if (session.npcs()[i].bodyHidden) continue;
      const float d = glm::distance(pPos, session.npcs()[i].pos);
      if (d < 130.0f) sortedNpcs.emplace_back(d, i);
    }
    std::sort(sortedNpcs.begin(), sortedNpcs.end());

    // Pre-build standard NPC rifle/pistol templates for armed hostiles
    westgate::WeaponSlotState npcRifleTemplate{};
    npcRifleTemplate.id = "carbine";
    npcRifleTemplate.isMelee = false;
    npcRifleTemplate.optic = westgate::WeaponOpticKind::RedDot;
    npcRifleTemplate.muzzle = westgate::WeaponMuzzleKind::Compensator;
    npcRifleTemplate.underbarrel = westgate::WeaponUnderbarrelKind::VerticalGrip;
    npcRifleTemplate.mag = westgate::WeaponMagKind::Standard;
    npcRifleTemplate.finish = westgate::WeaponFinishKind::Obsidian;
    npcRifleTemplate.bodyFinish = westgate::WeaponFinishKind::Obsidian;
    npcRifleTemplate.accentFinish = westgate::WeaponFinishKind::Titanium;
    npcRifleTemplate.hardwareFinish = westgate::WeaponFinishKind::Obsidian;

    westgate::WeaponSlotState npcSniperTemplate = npcRifleTemplate;
    npcSniperTemplate.id = "dmr";
    npcSniperTemplate.optic = westgate::WeaponOpticKind::SniperScope;
    npcSniperTemplate.underbarrel = westgate::WeaponUnderbarrelKind::LaserSight;
    npcSniperTemplate.finish = westgate::WeaponFinishKind::Coyote;
    npcSniperTemplate.bodyFinish = westgate::WeaponFinishKind::Coyote;
    npcSniperTemplate.accentFinish = westgate::WeaponFinishKind::Olive;

    westgate::WeaponSlotState npcBossTemplate = npcSniperTemplate;
    npcBossTemplate.optic = westgate::WeaponOpticKind::Acog;
    npcBossTemplate.muzzle = westgate::WeaponMuzzleKind::Osprey;
    npcBossTemplate.mag = westgate::WeaponMagKind::Drum;
    npcBossTemplate.finish = westgate::WeaponFinishKind::Gold;
    npcBossTemplate.bodyFinish = westgate::WeaponFinishKind::Gold;
    npcBossTemplate.accentFinish = westgate::WeaponFinishKind::Obsidian;

    for (const auto& [dist, idx] : sortedNpcs) {
      if (renderChars.size() >= westgate::kMaxSkinSlots) break;
      const auto& npc = session.npcs()[idx];
      const size_t palIdx = renderChars.size();
      westgate::SkinnedPartKind part = westgate::SkinnedPartKind::Civilian;
      const westgate::CharacterAnimator* anim = &civAnim;
      bool ok = hasCiv;
      if (npc.kind == westgate::NpcModelKind::Business) {
        part = westgate::SkinnedPartKind::Business;
        anim = &bizAnim;
        ok = hasBiz;
      } else if (npc.kind == westgate::NpcModelKind::Police) {
        part = westgate::SkinnedPartKind::Police;
        anim = &polAnim;
        ok = hasPol;
      } else if (npc.kind == westgate::NpcModelKind::Security) {
        part = westgate::SkinnedPartKind::Security;
        anim = &secAnim;
        ok = hasSec;
      } else if (npc.kind == westgate::NpcModelKind::Military) {
        part = westgate::SkinnedPartKind::Military;
        anim = &milAnim;
        ok = hasMil;
      } else if (npc.kind == westgate::NpcModelKind::Construction) {
        part = westgate::SkinnedPartKind::Construction;
        anim = &conAnim;
        ok = hasCon;
      } else if (npc.kind == westgate::NpcModelKind::Sports) {
        part = westgate::SkinnedPartKind::Sports;
        anim = &sptAnim;
        ok = hasSpt;
      }
      if (!ok) continue;

      const bool isCarried = (!npc.alive && npc.id == session.carriedNpcId());
      auto& npcSt = npcAnimStates[static_cast<uint32_t>(npc.id)];
      const std::string clipUse = isCarried ? std::string("Idle") : npc.animClip;
      const float xf = (clipUse == "knockdown" || clipUse == "hit") ? 0.10f : 0.22f;
      westgate::CharacterAnimator::advanceAnimState(npcSt, clipUse, npc.animTime, "", 0.0f, dt, xf);
      westgate::CharacterPoseOverlay npcOv{};
      npcOv.timeSec = elapsedSec;
      npcOv.seed = static_cast<float>(npc.id) * 1.73f;
      npcOv.idleWeight = (clipUse == "Idle") ? 1.0f : 0.1f;
      npcOv.koProgress = (!npc.alive && !isCarried) ? std::clamp(npc.deadTimer / 0.50f, 0.0f, 1.0f) : 0.0f;

      const bool npcArmed = (npc.isPolice || npc.isContractGuard ||
                             npc.role == westgate::EnemyRole::Ally ||
                             npc.role == westgate::EnemyRole::Boss) && npc.alive;
      if (npcArmed && dist < 56.0f) {
        npcOv.weaponHoldWeight = 1.0f;
        npcOv.twoHandedWeapon = true;
        npcOv.aimWeight = (npc.alerted || session.wantedStars() > 0 || npc.sniperTracking || npc.role == westgate::EnemyRole::Ally) ? 0.85f : 0.30f;
      }
      anim->evaluateState(npcSt, clips, npcPalettes[palIdx], &npcOv);
      const glm::vec4 tint = glm::mix(glm::vec4(npc.colorTint, 1.0f), glm::vec4(1.6f, 0.4f, 0.4f, 1.0f), npc.hitFlash);

      if (isCarried) {
        // Drape carried corpse horizontally across Voss's right shoulder with walk sway
        const float sway = std::sin(session.playerLocomotionTime() * 6.0f) * 0.04f;
        const glm::vec3 fwd(std::sin(player.yaw()), 0.0f, std::cos(player.yaw()));
        const glm::vec3 right(fwd.z, 0.0f, -fwd.x);
        const glm::vec3 carryPos = pPos + glm::vec3(0.0f, 1.38f, 0.0f) + right * 0.16f - fwd * 0.12f;
        const glm::quat carryRot = glm::angleAxis(1.52f + sway, glm::vec3(0.0f, 0.0f, 1.0f)) *
                                   glm::angleAxis(0.28f, glm::vec3(1.0f, 0.0f, 0.0f));
        renderChars.push_back({carryPos, player.yaw(), tint, part, &npcPalettes[palIdx], carryRot});
      } else {
        renderChars.push_back({npc.pos, npc.yawRad, tint, part, &npcPalettes[palIdx]});
        if (!session.gunsmithOpen() && npcArmed && dist < 55.0f) {
          const glm::vec3 localHand = anim->animatedBonePos("RightHand", npcPalettes[palIdx], {0.20f, 1.08f, -0.24f});
          const glm::mat4 npcWorld = glm::translate(glm::mat4(1.0f), npc.pos) *
                                     glm::rotate(glm::mat4(1.0f), npc.yawRad + 3.14159265f, glm::vec3(0.0f, 1.0f, 0.0f));
          const glm::vec3 handW = glm::vec3(npcWorld * glm::vec4(localHand, 1.0f));
          const auto& wpl = (npc.role == westgate::EnemyRole::Boss) ? npcBossTemplate
                          : ((npc.role == westgate::EnemyRole::Sniper) ? npcSniperTemplate : npcRifleTemplate);
          const glm::quat npcGunRot = glm::angleAxis(npc.yawRad, glm::vec3(0.0f, 1.0f, 0.0f));
          westgate::WeaponSystem3D::appendAssembledWeapon(
            handW,
            npcGunRot,
            wpl,
            0.0f,
            0.0f,
            1.0f,
            dist < 28.0f,
            weaponPartInstances
          );
        }
      }
    }

    // Living-World Quadruped Wildlife (Siberian Huskies & Alpine Deer with direct embedded clip skinning)
    for (const auto& w : session.wildlife()) {
      if (renderChars.size() >= westgate::kMaxSkinSlots) break;
      if (glm::distance(pPos, w.pos) > 150.0f) continue;
      const size_t palIdx = renderChars.size();
      if (w.kind == westgate::WildlifeKind::DogHusky && hasDog) {
        dogAnim.evaluateDirectEmbeddedClip(w.activeClip, w.animClock, npcPalettes[palIdx]);
        renderChars.push_back({
          w.pos + glm::vec3(0.0f, dogGroundOff, 0.0f),
          w.yawRad,
          glm::vec4(1.42f, 1.42f, 1.46f, 1.0f),
          westgate::SkinnedPartKind::DogHusky,
          &npcPalettes[palIdx],
          glm::quat(1.0f, 0.0f, 0.0f, 0.0f),
          dogScale
        });
      } else if (w.kind == westgate::WildlifeKind::Deer && hasDeer) {
        deerAnim.evaluateDirectEmbeddedClip(w.activeClip, w.animClock, npcPalettes[palIdx]);
        renderChars.push_back({
          w.pos + glm::vec3(0.0f, deerGroundOff, 0.0f),
          w.yawRad,
          glm::vec4(1.32f, 1.28f, 1.24f, 1.0f),
          westgate::SkinnedPartKind::Deer,
          &npcPalettes[palIdx],
          glm::quat(1.0f, 0.0f, 0.0f, 0.0f),
          deerScale
        });
      }
    }

    const bool shouldRenderFrame = !headlessMode || (headlessTestReconfigure && headlessStep == 1) || (headlessStep + 2 >= headlessFrames);
    if (shouldRenderFrame) {
      ImGui_ImplWGPU_NewFrame();
      if (headlessMode) {
        io.DisplaySize = ImVec2(static_cast<float>(gpu.width()), static_cast<float>(gpu.height()));
        io.DeltaTime = dt;
      } else {
        ImGui_ImplSDL3_NewFrame();
      }
      ImGui::NewFrame();

      westgate::drawWestgateHud(
        ui,
        session,
        player,
        physics,
        world,
        gpu,
        renderer.telemetry(),
        headlessMode ? nullptr : &audio,
        headlessMode ? 60.0f : io.Framerate,
        elapsedSec
      );

      physics.gatherDynamicProps(dynamicProps);
      ImGui::Render();

      const glm::vec3 camPos = hasCamOverride ? camOverridePos : session.cameraPosition(player);
      const glm::vec3 camTgt = hasCamOverride ? camOverrideTarget : session.cameraTarget(player);
      const glm::vec3 focus = hasCamOverride ? camOverrideTarget : (session.gunsmithOpen() ? session.gunsmithAnchorPos(player) : pPos);

      // Assemble First-Person 3D Viewmodel + Gloves locked to the exact eye camera (unless in Sniper 8x glass scope)
      const bool inSniperGlass = session.isAiming() && session.isRangedWeapon() &&
                                 session.activeWeapon().optic == westgate::WeaponOpticKind::SniperScope;
      if (!hasCamOverride && !session.gunsmithOpen() && !session.inVehicle() && session.firstPersonMode() && !inSniperGlass) {
        const bool meleeBlocking = gameInput.aimDown && session.activeWeapon().isMelee;
        westgate::WeaponSystem3D::appendFirstPersonViewmodel(
          camPos,
          camTgt,
          session.activeWeapon(),
          session.playerSuit(),
          session.adsBlend(),
          session.recoilImpulse(),
          session.reloadProgress01(),
          player.speed(),
          player.sprinting(),
          session.playerLocomotionTime(),
          turnBankSmooth,
          session.playerAttackClip(),
          session.playerAttackProgress(),
          meleeBlocking,
          weaponPartInstances
        );
      }

      auto worldMarkers = session.gatherWorldMarkers(elapsedSec);
      renderer.render(
        gpu,
        world,
        streamer,
        camPos,
        camTgt,
        focus,
        session.cameraFovDeg(gameInput.aimDown),
        elapsedSec,
        session.skyLighting(),
        renderChars,
        session.vehicles(),
        worldMarkers,
        session.gatherDynamicLights(world, player, elapsedSec),
        dynamicProps,
        true,
        session.gatherDynamicGlbProps(elapsedSec),
        weaponPartInstances
      );
    }

    if (headlessMode) {
      ++headlessStep;
      if (headlessStep >= headlessFrames) {
        if (!gpu.saveOffscreenPng(headlessShotPath, &err)) {
          std::fprintf(stderr, "saveOffscreenPng failed: %s\n", err.c_str());
          running = false;
        } else {
          std::printf("[headless-shot] Wrote %ux%u PNG -> %s (GPU: %s, visChunks=%u, bldgs=%u, props=%u, veh=%u, chars=%u)\n",
                      gpu.width(), gpu.height(), headlessShotPath.c_str(), gpu.adapterName().c_str(),
                      renderer.telemetry().visibleChunks, renderer.telemetry().drawnBuildings,
                      renderer.telemetry().drawnProps, renderer.telemetry().drawnVehicles,
                      renderer.telemetry().drawnCharacters);
          running = false;
        }
      }
    }
  }

  if (!headlessMode) {
    session.saveToFile(ui.savePath);
  }
  renderer.shutdown();
  ImGui_ImplWGPU_Shutdown();
  if (!headlessMode) ImGui_ImplSDL3_Shutdown();
  ImGui::DestroyContext();
  gpu.shutdown();
  if (!headlessMode) audio.shutdown();
  physics.shutdown();
  if (window) SDL_DestroyWindow(window);
  if (!headlessMode) SDL_Quit();
  return 0;
}
