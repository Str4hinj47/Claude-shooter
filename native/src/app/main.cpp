#include "westgate/AudioEngine.hpp"
#include "westgate/CharacterAnimator.hpp"
#include "westgate/EngineTypes.hpp"
#include "westgate/GameHud.hpp"
#include "westgate/GameSession.hpp"
#include "westgate/GltfAssetLoader.hpp"
#include "westgate/PhysicsWorld.hpp"
#include "westgate/PlayerController.hpp"
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
  bool headlessTestReconfigure = false;
  int headlessSelectSlot = -1;
  bool hasTeleportOverride = false;
  glm::vec3 teleportOverridePos{0.0f};
  float teleportOverrideYawDeg = 0.0f;
  bool hasCamOverride = false;
  glm::vec3 camOverridePos{0.0f};
  glm::vec3 camOverrideTarget{0.0f};
  std::string todOverride;
  std::string weatherOverride;

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
    } else if (arg == "--test-reconfigure") {
      headlessTestReconfigure = true;
    } else if (arg == "--select-slot" && i + 1 < argc) {
      headlessSelectSlot = std::atoi(argv[++i]);
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

  // Load character models & animation clips
  westgate::GltfModel bodyModel, shortsModel, hairModel, bizModel, civModel, polModel, secModel;
  const bool hasBody = westgate::GltfAssetLoader::loadGlb(resolveAsset("characters/fighter/base_body.glb").string(), bodyModel, true, nullptr);
  const bool hasShorts = westgate::GltfAssetLoader::loadGlb(resolveAsset("characters/fighter/clothing_shorts.glb").string(), shortsModel, true, nullptr);
  const bool hasHair = westgate::GltfAssetLoader::loadGlb(resolveAsset("characters/fighter/hair_short02.glb").string(), hairModel, true, nullptr);
  const bool hasBiz = westgate::GltfAssetLoader::loadGlb(resolveAsset("characters/business.glb").string(), bizModel, true, nullptr);
  const bool hasCiv = westgate::GltfAssetLoader::loadGlb(resolveAsset("characters/civilian.glb").string(), civModel, true, nullptr);
  const bool hasPol = westgate::GltfAssetLoader::loadGlb(resolveAsset("characters/police.glb").string(), polModel, true, nullptr);
  const bool hasSec = westgate::GltfAssetLoader::loadGlb(resolveAsset("characters/security.glb").string(), secModel, true, nullptr);

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

  westgate::CharacterAnimator bodyAnim, shortsAnim, hairAnim, bizAnim, civAnim, polAnim, secAnim;
  if (hasBody) bodyAnim.initForTarget(bodyModel);
  if (hasShorts) shortsAnim.initForTarget(shortsModel);
  if (hasHair) hairAnim.initForTarget(hairModel);
  if (hasBiz) bizAnim.initForTarget(bizModel);
  if (hasCiv) civAnim.initForTarget(civModel);
  if (hasPol) polAnim.initForTarget(polModel);
  if (hasSec) secAnim.initForTarget(secModel);

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
  }

  if (hasTeleportOverride) {
    session.teleportTo(teleportOverridePos, teleportOverrideYawDeg, player);
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
  renderAssets.businessModel = hasBiz ? &bizModel : nullptr;
  renderAssets.civilianModel = hasCiv ? &civModel : nullptr;
  renderAssets.policeModel = hasPol ? &polModel : nullptr;
  renderAssets.securityModel = hasSec ? &secModel : nullptr;

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

  int headlessStep = 0;
  while (running) {
    const float dt = headlessMode ? (1.0f / 60.0f) : static_cast<float>(timer.tickSeconds());
    elapsedSec += dt;

    westgate::GameInputFrame gameInput{};
    float lookDx = 0.0f;
    float lookDy = 0.0f;
    bool jumpPressed = false;

    if (headlessMode) {
      if (headlessWalkForward) {
        gameInput.moveInput.moveForward = 1.0f;
      }
      if (headlessStep == 1 && headlessSelectSlot >= 0) {
        gameInput.selectWeaponSlot = headlessSelectSlot;
      }
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
        if (ev.type == SDL_EVENT_MOUSE_MOTION && ui.mouseCaptured && !ui.showPhone) {
          lookDx += ev.motion.xrel;
          lookDy += ev.motion.yrel;
        }
        if (ev.type == SDL_EVENT_MOUSE_BUTTON_DOWN && ui.mouseCaptured && !ui.showPhone && ev.button.button == SDL_BUTTON_LEFT) {
          gameInput.firePressed = true;
        }
        if (ev.type == SDL_EVENT_MOUSE_WHEEL && !ui.showPhone) {
          int slot = session.activeWeaponIdx() + (ev.wheel.y > 0 ? -1 : 1);
          const int maxS = static_cast<int>(session.weapons().size()) - 1;
          if (slot < 0) slot = maxS;
          if (slot > maxS) slot = 0;
          gameInput.selectWeaponSlot = slot;
        }
        if (ev.type == SDL_EVENT_KEY_DOWN && !ev.key.repeat) {
          const SDL_Scancode sc = ev.key.scancode;
          if (sc == SDL_SCANCODE_TAB || sc == SDL_SCANCODE_ESCAPE) {
            if (ui.showPhone) {
              ui.showPhone = false;
            } else {
              ui.mouseCaptured = !ui.mouseCaptured;
              SDL_SetWindowRelativeMouseMode(window, ui.mouseCaptured);
            }
          } else if (sc == SDL_SCANCODE_P) {
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
            gameInput.takedownPressed = true;
          } else if (sc == SDL_SCANCODE_Z) {
            gameInput.grapplePressed = true;
          } else if (sc == SDL_SCANCODE_U) {
            gameInput.takedownShootPressed = true;
          } else if (sc == SDL_SCANCODE_R) {
            gameInput.reloadPressed = true;
            gameInput.rematchPressed = true;
          } else if (sc >= SDL_SCANCODE_1 && sc <= SDL_SCANCODE_6) {
            gameInput.selectWeaponSlot = static_cast<int>(sc - SDL_SCANCODE_1);
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
      if (!ui.showPhone) {
        if (keys[SDL_SCANCODE_W]) gameInput.moveInput.moveForward += 1.0f;
        if (keys[SDL_SCANCODE_S]) gameInput.moveInput.moveForward -= 1.0f;
        if (keys[SDL_SCANCODE_D]) gameInput.moveInput.moveRight += 1.0f;
        if (keys[SDL_SCANCODE_A]) gameInput.moveInput.moveRight -= 1.0f;
        gameInput.moveInput.sprint = keys[SDL_SCANCODE_LSHIFT] || keys[SDL_SCANCODE_RSHIFT];
        gameInput.moveInput.crouch = keys[SDL_SCANCODE_C] || keys[SDL_SCANCODE_LCTRL];
        gameInput.moveInput.jump = jumpPressed || (session.inVehicle() && keys[SDL_SCANCODE_SPACE]);
        gameInput.moveInput.lookDeltaX = lookDx;
        gameInput.moveInput.lookDeltaY = lookDy;
        gameInput.fireDown = ui.mouseCaptured && ((mouseButtons & SDL_BUTTON_LMASK) != 0);
        gameInput.aimDown = ((mouseButtons & SDL_BUTTON_RMASK) != 0) || keys[SDL_SCANCODE_V];
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

      const glm::vec4 playerTint = glm::mix(glm::vec4(1.0f), glm::vec4(1.55f, 0.42f, 0.42f, 1.0f), session.playerHitFlash());
      if (hasBody) {
        bodyAnim.evaluateState(playerAnimState, clips, palBody, &playerOverlay);
        renderChars.push_back({pPos, player.yaw(), playerTint, westgate::SkinnedPartKind::PlayerBody, &palBody});
      }
      if (hasShorts) {
        shortsAnim.evaluateState(playerAnimState, clips, palShorts, &playerOverlay);
        renderChars.push_back({pPos, player.yaw(), glm::vec4(0.84f, 0.22f, 0.22f, 1.0f), westgate::SkinnedPartKind::PlayerShorts, &palShorts});
      }
      if (hasHair) {
        hairAnim.evaluateState(playerAnimState, clips, palHair, &playerOverlay);
        renderChars.push_back({pPos, player.yaw(), glm::vec4(1.0f), westgate::SkinnedPartKind::PlayerHair, &palHair});
      }
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

    // Closest NPCs / Police / Contract Targets up to kMaxSkinSlots (with smooth per-NPC crossfades!)
    std::vector<std::pair<float, size_t>> sortedNpcs;
    sortedNpcs.reserve(session.npcs().size());
    for (size_t i = 0; i < session.npcs().size(); ++i) {
      const float d = glm::distance(pPos, session.npcs()[i].pos);
      if (d < 130.0f) sortedNpcs.emplace_back(d, i);
    }
    std::sort(sortedNpcs.begin(), sortedNpcs.end());

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
      }
      if (!ok) continue;

      auto& npcSt = npcAnimStates[static_cast<uint32_t>(npc.id)];
      const float xf = (npc.animClip == "knockdown" || npc.animClip == "hit") ? 0.10f : 0.22f;
      westgate::CharacterAnimator::advanceAnimState(npcSt, npc.animClip, npc.animTime, "", 0.0f, dt, xf);
      westgate::CharacterPoseOverlay npcOv{};
      npcOv.timeSec = elapsedSec;
      npcOv.seed = static_cast<float>(npc.id) * 1.73f;
      npcOv.idleWeight = (npc.animClip == "Idle") ? 1.0f : 0.1f;
      npcOv.koProgress = !npc.alive ? std::clamp(npc.deadTimer / 0.50f, 0.0f, 1.0f) : 0.0f;
      if ((npc.isPolice || npc.isContractGuard) && npc.alive && dist < 36.0f && session.wantedStars() > 0) {
        npcOv.weaponHoldWeight = 1.0f;
        npcOv.aimWeight = 0.8f;
      }
      anim->evaluateState(npcSt, clips, npcPalettes[palIdx], &npcOv);
      const glm::vec4 tint = glm::mix(glm::vec4(npc.colorTint, 1.0f), glm::vec4(1.6f, 0.4f, 0.4f, 1.0f), npc.hitFlash);
      renderChars.push_back({npc.pos, npc.yawRad, tint, part, &npcPalettes[palIdx]});
    }

    const bool shouldRenderFrame = !headlessMode || (headlessTestReconfigure && headlessStep == 1) || (headlessStep + 1 >= headlessFrames);
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
      const glm::vec3 focus = hasCamOverride ? camOverrideTarget : pPos;
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
        session.gatherWorldMarkers(elapsedSec),
        session.gatherDynamicLights(world, player, elapsedSec),
        dynamicProps,
        true
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
