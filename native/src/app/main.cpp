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
#include <cstdio>
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
  (void)argc;
  if (!SDL_Init(SDL_INIT_VIDEO | SDL_INIT_GAMEPAD)) {
    std::fprintf(stderr, "SDL_Init failed: %s\n", SDL_GetError());
    return 1;
  }

  const std::filesystem::path assetsRoot = findAssetsRoot(argv[0]);
  westgate::WorldData world;
  std::string err;
  if (!world.loadFromDirectory((assetsRoot / "world").string(), &err)) {
    std::fprintf(stderr, "World load failed (%s): %s\n", assetsRoot.string().c_str(), err.c_str());
    SDL_Quit();
    return 1;
  }

  const std::filesystem::path fallbackPublic = std::filesystem::current_path().parent_path() / "public";
  auto resolveAsset = [&](const std::filesystem::path& rel) -> std::filesystem::path {
    if (std::filesystem::exists(assetsRoot / rel)) return assetsRoot / rel;
    if (std::filesystem::exists(fallbackPublic / rel)) return fallbackPublic / rel;
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
  struct CombatClipDef { const char* id; const char* file; bool loop; };
  const CombatClipDef combatDefs[] = {
    {"fight_idle", "animations/combat/fight_idle.glb", true},
    {"jab", "animations/combat/jab.glb", false},
    {"cross", "animations/combat/cross.glb", false},
    {"hook", "animations/combat/hook.glb", false},
    {"uppercut", "animations/combat/uppercut.glb", false},
    {"kick", "animations/combat/kick.glb", false},
    {"block", "animations/combat/block.glb", true},
    {"hit", "animations/combat/hit.glb", false},
    {"knockdown", "animations/combat/knockdown.glb", false},
  };
  for (const auto& def : combatDefs) {
    westgate::GltfModel am;
    if (westgate::GltfAssetLoader::loadGlb(resolveAsset(def.file).string(), am, false, nullptr)) {
      westgate::CharacterAnimator::SourceClip sc;
      if (westgate::CharacterAnimator::buildSourceClip(def.id, am, 0, def.loop, sc)) {
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

  westgate::ChunkStreamer streamer(340.0f, 980.0f, 24.0f);
  streamer.init(world);

  westgate::AudioEngine audio;
  audio.init();

  westgate::GameSession session;
  session.init(world, &player, &physics);

  westgate::HudUiState ui;
  ui.savePath = (assetsRoot.parent_path() / "westgate_save.json").string();
  session.loadFromFile(ui.savePath);

  float scale = SDL_GetDisplayContentScale(SDL_GetPrimaryDisplay());
  if (scale <= 0.0f) scale = 1.0f;
  const int initW = static_cast<int>(1280 * scale);
  const int initH = static_cast<int>(720 * scale);

  SDL_Window* window = SDL_CreateWindow("Westgate Bay — Custom Native C++20 Engine (SDL3 + wgpu + Jolt)", initW, initH, SDL_WINDOW_RESIZABLE);
  if (!window) {
    std::fprintf(stderr, "SDL_CreateWindow failed: %s\n", SDL_GetError());
    SDL_Quit();
    return 1;
  }

  westgate::WgpuContext gpu;
  if (!gpu.init(window, static_cast<uint32_t>(initW), static_cast<uint32_t>(initH), &err)) {
    std::fprintf(stderr, "WgpuContext init failed: %s\n", err.c_str());
    SDL_DestroyWindow(window);
    SDL_Quit();
    return 1;
  }

  IMGUI_CHECKVERSION();
  ImGui::CreateContext();
  ImGuiIO& io = ImGui::GetIO();
  io.ConfigFlags |= ImGuiConfigFlags_NavEnableKeyboard;
  ImGui::StyleColorsDark();
  ImGui::GetStyle().ScaleAllSizes(scale);

  ImGui_ImplSDL3_InitForOther(window);
  ImGui_ImplWGPU_InitInfo uiInfo{};
  uiInfo.Device = gpu.device();
  uiInfo.NumFramesInFlight = 3;
  uiInfo.RenderTargetFormat = gpu.surfaceFormat();
  uiInfo.DepthStencilFormat = WGPUTextureFormat_Undefined;
  ImGui_ImplWGPU_Init(&uiInfo);

  westgate::WorldRenderAssets renderAssets;
  renderAssets.assetsRoot = assetsRoot.string();
  renderAssets.playerBody = hasBody ? &bodyModel : nullptr;
  renderAssets.playerShorts = hasShorts ? &shortsModel : nullptr;
  renderAssets.playerHair = hasHair ? &hairModel : nullptr;
  renderAssets.businessModel = hasBiz ? &bizModel : nullptr;
  renderAssets.civilianModel = hasCiv ? &civModel : nullptr;
  renderAssets.policeModel = hasPol ? &polModel : nullptr;
  renderAssets.securityModel = hasSec ? &secModel : nullptr;

  westgate::WorldRenderer renderer;
  const std::filesystem::path shaderPath = assetsRoot / "shaders" / "westgate.wgsl";
  if (!renderer.init(gpu, world, shaderPath.string(), renderAssets, &err)) {
    std::fprintf(stderr, "WorldRenderer init failed: %s\n", err.c_str());
    ImGui_ImplWGPU_Shutdown();
    ImGui_ImplSDL3_Shutdown();
    ImGui::DestroyContext();
    gpu.shutdown();
    SDL_DestroyWindow(window);
    SDL_Quit();
    return 1;
  }

  std::array<glm::mat4, westgate::kMaxSkinBones> palBody{}, palShorts{}, palHair{}, palOpp{};
  std::vector<std::array<glm::mat4, westgate::kMaxSkinBones>> npcPalettes(westgate::kMaxSkinSlots);
  palBody.fill(glm::mat4(1.0f));
  palShorts.fill(glm::mat4(1.0f));
  palHair.fill(glm::mat4(1.0f));
  palOpp.fill(glm::mat4(1.0f));

  bool running = true;
  westgate::FrameTimer timer;
  float physicsAccum = 0.0f;
  float elapsedSec = 0.0f;
  float locoBlend = 0.0f;
  std::vector<westgate::SkinnedRenderCharacter> renderChars;

  auto evalAnim = [&](const westgate::CharacterAnimator& anim, const std::string& name, float t, std::array<glm::mat4, westgate::kMaxSkinBones>& pal) {
    auto it = clips.find(name);
    if (it != clips.end()) anim.evaluateClip(it->second, t, pal);
    else if (clips.count("Idle")) anim.evaluateClip(clips.at("Idle"), t, pal);
    else anim.evaluateRest(pal);
  };

  while (running) {
    const float dt = static_cast<float>(timer.tickSeconds());
    elapsedSec += dt;

    westgate::GameInputFrame gameInput{};
    float lookDx = 0.0f;
    float lookDy = 0.0f;
    bool jumpPressed = false;

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

    session.update(dt, gameInput, player, physics, world, &audio);

    physicsAccum += dt;
    constexpr float kFixedStep = 1.0f / 60.0f;
    while (physicsAccum >= kFixedStep) {
      physics.step(kFixedStep);
      physicsAccum -= kFixedStep;
    }

    // Evaluate player skeletal parts (hidden when driving inside vehicle)
    const glm::vec3 pPos = player.position();
    renderChars.clear();
    if (!session.inVehicle()) {
      const float targetBlend = player.speed() > 0.35f ? 1.0f : 0.0f;
      locoBlend += (targetBlend - locoBlend) * std::min(1.0f, dt * 10.0f);
      const std::string idleKey = session.activeWeapon().isMelee && clips.count("fight_idle") ? "fight_idle" : "Idle";
      const std::string moveKey = (player.sprinting() && clips.count("Run")) ? "Run" : "Walk";
      const std::string atk = session.playerAttackClip();

      auto evalPart = [&](const westgate::CharacterAnimator& anim, std::array<glm::mat4, westgate::kMaxSkinBones>& pal) {
        if (!atk.empty() && clips.count(atk)) anim.evaluateClip(clips.at(atk), session.playerAttackTime(), pal);
        else if (gameInput.aimDown && session.activeWeapon().isMelee && clips.count("block")) anim.evaluateClip(clips.at("block"), elapsedSec, pal);
        else if (clips.count(idleKey) && clips.count(moveKey)) anim.evaluateBlended(clips.at(idleKey), elapsedSec, clips.at(moveKey), elapsedSec, locoBlend, pal);
        else anim.evaluateRest(pal);
      };

      const glm::vec4 playerTint = glm::mix(glm::vec4(1.0f), glm::vec4(1.55f, 0.42f, 0.42f, 1.0f), session.playerHitFlash());
      if (hasBody) {
        evalPart(bodyAnim, palBody);
        renderChars.push_back({pPos, player.yaw(), playerTint, westgate::SkinnedPartKind::PlayerBody, &palBody});
      }
      if (hasShorts) {
        evalPart(shortsAnim, palShorts);
        renderChars.push_back({pPos, player.yaw(), glm::vec4(0.84f, 0.22f, 0.22f, 1.0f), westgate::SkinnedPartKind::PlayerShorts, &palShorts});
      }
      if (hasHair) {
        evalPart(hairAnim, palHair);
        renderChars.push_back({pPos, player.yaw(), glm::vec4(1.0f), westgate::SkinnedPartKind::PlayerHair, &palHair});
      }
    }

    // Iron Pit Opponent
    if (hasBiz) {
      const auto& pit = session.ironPit();
      evalAnim(bizAnim, pit.animClip, pit.animTime, palOpp);
      const glm::vec4 oppTint = glm::mix(glm::vec4(1.0f), glm::vec4(1.6f, 0.4f, 0.4f, 1.0f), pit.hitFlash);
      renderChars.push_back({pit.pos, pit.yawRad, oppTint, westgate::SkinnedPartKind::Business, &palOpp});
    }

    // Closest NPCs / Police / Contract Targets up to kMaxSkinSlots
    std::vector<std::pair<float, size_t>> sortedNpcs;
    sortedNpcs.reserve(session.npcs().size());
    for (size_t i = 0; i < session.npcs().size(); ++i) {
      const float d = glm::distance(pPos, session.npcs()[i].pos);
      if (d < 130.0f) sortedNpcs.emplace_back(d, i);
    }
    std::sort(sortedNpcs.begin(), sortedNpcs.end());

    for (const auto& [dist, idx] : sortedNpcs) {
      (void)dist;
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

      evalAnim(*anim, npc.animClip, npc.animTime, npcPalettes[palIdx]);
      const glm::vec4 tint = glm::mix(glm::vec4(npc.colorTint, 1.0f), glm::vec4(1.6f, 0.4f, 0.4f, 1.0f), npc.hitFlash);
      renderChars.push_back({npc.pos, npc.yawRad, tint, part, &npcPalettes[palIdx]});
    }

    ImGui_ImplWGPU_NewFrame();
    ImGui_ImplSDL3_NewFrame();
    ImGui::NewFrame();

    westgate::drawWestgateHud(
      ui,
      session,
      player,
      physics,
      world,
      gpu,
      renderer.telemetry(),
      &audio,
      io.Framerate,
      elapsedSec
    );

    ImGui::Render();
    renderer.render(
      gpu,
      world,
      streamer,
      session.cameraPosition(player),
      session.cameraTarget(player),
      pPos,
      session.cameraFovDeg(gameInput.aimDown),
      elapsedSec,
      session.skyLighting(),
      renderChars,
      session.vehicles(),
      session.gatherWorldMarkers(elapsedSec),
      true
    );
  }

  session.saveToFile(ui.savePath);
  renderer.shutdown();
  ImGui_ImplWGPU_Shutdown();
  ImGui_ImplSDL3_Shutdown();
  ImGui::DestroyContext();
  gpu.shutdown();
  audio.shutdown();
  physics.shutdown();
  SDL_DestroyWindow(window);
  SDL_Quit();
  return 0;
}
