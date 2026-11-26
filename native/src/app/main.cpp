#include "westgate/AudioEngine.hpp"
#include "westgate/CharacterAnimator.hpp"
#include "westgate/EngineTypes.hpp"
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

struct TrafficAgent {
  size_t roadIdx = 0;
  float samplePos = 0.0f;
  float speed = 11.0f;
  bool forward = true;
  bool isPolice = false;
};

struct IronPitOpponent {
  int tier = 1;
  std::string name;
  float maxHp = 100.0f;
  float hp = 100.0f;
  int purse = 500;
  glm::vec3 pos{722.0f, 3.4f, 118.0f};
  float yawRad = 3.14159f;
  std::string animClip = "fight_idle";
  float animTime = 0.0f;
  float attackCooldown = 1.6f;
  float hitFlashTimer = 0.0f;
  bool hitAppliedThisSwing = false;
  bool defeated = false;
};

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

  // Load character meshes & animation clips
  const std::filesystem::path charDir = assetsRoot / "characters";
  const std::filesystem::path fallbackPublic = std::filesystem::current_path().parent_path() / "public";
  auto resolveAsset = [&](const std::filesystem::path& rel) -> std::filesystem::path {
    if (std::filesystem::exists(assetsRoot / rel)) return assetsRoot / rel;
    if (std::filesystem::exists(fallbackPublic / rel)) return fallbackPublic / rel;
    return assetsRoot / rel;
  };

  westgate::GltfModel bodyModel, shortsModel, hairModel, bizModel;
  const bool hasBody = westgate::GltfAssetLoader::loadGlb(resolveAsset("characters/fighter/base_body.glb").string(), bodyModel, true, nullptr);
  const bool hasShorts = westgate::GltfAssetLoader::loadGlb(resolveAsset("characters/fighter/clothing_shorts.glb").string(), shortsModel, true, nullptr);
  const bool hasHair = westgate::GltfAssetLoader::loadGlb(resolveAsset("characters/fighter/hair_short02.glb").string(), hairModel, true, nullptr);
  const bool hasBiz = westgate::GltfAssetLoader::loadGlb(resolveAsset("characters/business.glb").string(), bizModel, true, nullptr);

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

  westgate::CharacterAnimator bodyAnim, shortsAnim, hairAnim, oppAnim;
  if (hasBody) bodyAnim.initForTarget(bodyModel);
  if (hasShorts) shortsAnim.initForTarget(shortsModel);
  if (hasHair) hairAnim.initForTarget(hairModel);
  if (hasBiz) oppAnim.initForTarget(bizModel);

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
  renderAssets.opponentModel = hasBiz ? &bizModel : nullptr;

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

  // Spawn 16 ambient vehicles along Westgate Bay's road network
  std::vector<TrafficAgent> traffic;
  {
    std::vector<size_t> longRoads;
    for (size_t ri = 0; ri < world.roads.size(); ++ri) {
      if (world.roads[ri].samples.size() >= 6) longRoads.push_back(ri);
    }
    if (!longRoads.empty()) {
      for (int i = 0; i < 16; ++i) {
        TrafficAgent ta;
        ta.roadIdx = longRoads[static_cast<size_t>(i) % longRoads.size()];
        const float maxS = static_cast<float>(world.roads[ta.roadIdx].samples.size() - 1);
        ta.samplePos = std::fmod(static_cast<float>(i) * 3.7f, maxS);
        ta.speed = 9.5f + static_cast<float>((i * 7) % 6);
        ta.forward = (i % 2) == 0;
        ta.isPolice = (i % 3) == 0;
        traffic.push_back(ta);
      }
    }
  }

  // Westgate Iron Pit opponent setup
  const float pitGroundY = world.heightfield.sampleHeight(world.fightPitPos.x, world.fightPitPos.z) + 0.65f;
  auto spawnTierOpponent = [&](int tier) -> IronPitOpponent {
    IronPitOpponent opp;
    opp.tier = tier;
    opp.pos = glm::vec3(world.fightPitPos.x, pitGroundY, world.fightPitPos.z + 2.8f);
    if (tier == 1) {
      opp.name = "Dockside Scrapper";
      opp.maxHp = 100.0f;
      opp.purse = 500;
    } else if (tier == 2) {
      opp.name = "Foundry Heavy";
      opp.maxHp = 145.0f;
      opp.purse = 1250;
    } else {
      opp.name = "Iron Pit Champion";
      opp.maxHp = 200.0f;
      opp.purse = 2500;
    }
    opp.hp = opp.maxHp;
    return opp;
  };
  IronPitOpponent opponent = spawnTierOpponent(1);

  float playerHp = 100.0f;
  float playerStamina = 100.0f;
  int playerCash = 0;
  int comboStep = 0;
  std::string playerAttackClip;
  float playerAttackTimer = 0.0f;
  bool playerAttackHitDone = false;
  float playerHitFlash = 0.0f;
  float locoTimer = 0.0f;
  float locoBlend = 0.0f;
  float elapsedSec = 0.0f;

  std::array<glm::mat4, westgate::kMaxSkinBones> palBody{}, palShorts{}, palHair{}, palOpp{};
  palBody.fill(glm::mat4(1.0f));
  palShorts.fill(glm::mat4(1.0f));
  palHair.fill(glm::mat4(1.0f));
  palOpp.fill(glm::mat4(1.0f));

  bool running = true;
  bool mouseCaptured = false;
  bool showTelemetry = true;
  westgate::FrameTimer timer;
  float physicsAccum = 0.0f;

  std::vector<westgate::InstanceAttrib> policeInst;
  std::vector<westgate::InstanceAttrib> taxiInst;
  std::vector<westgate::SkinnedRenderCharacter> renderChars;

  auto triggerAttack = [&](const std::string& clipName, float stamCost) {
    if (!playerAttackClip.empty() || playerStamina < stamCost) return;
    if (clips.find(clipName) == clips.end()) return;
    playerStamina = std::max(0.0f, playerStamina - stamCost);
    playerAttackClip = clipName;
    playerAttackTimer = 0.0f;
    playerAttackHitDone = false;
  };

  while (running) {
    const float dt = static_cast<float>(timer.tickSeconds());
    elapsedSec += dt;
    float lookDx = 0.0f;
    float lookDy = 0.0f;
    bool jumpPressed = false;

    SDL_Event ev;
    while (SDL_PollEvent(&ev)) {
      ImGui_ImplSDL3_ProcessEvent(&ev);
      if (ev.type == SDL_EVENT_QUIT) running = false;
      if (ev.type == SDL_EVENT_WINDOW_CLOSE_REQUESTED && ev.window.windowID == SDL_GetWindowID(window)) running = false;
      if (ev.type == SDL_EVENT_MOUSE_MOTION && mouseCaptured) {
        lookDx += ev.motion.xrel;
        lookDy += ev.motion.yrel;
      }
      if (ev.type == SDL_EVENT_MOUSE_BUTTON_DOWN && mouseCaptured && ev.button.button == SDL_BUTTON_LEFT) {
        const char* seq[3] = {"jab", "cross", "hook"};
        triggerAttack(seq[comboStep % 3], 12.0f);
        ++comboStep;
      }
      if (ev.type == SDL_EVENT_KEY_DOWN && !ev.key.repeat) {
        if (ev.key.scancode == SDL_SCANCODE_TAB || ev.key.scancode == SDL_SCANCODE_ESCAPE) {
          mouseCaptured = !mouseCaptured;
          SDL_SetWindowRelativeMouseMode(window, mouseCaptured);
        } else if (ev.key.scancode == SDL_SCANCODE_F9) {
          showTelemetry = !showTelemetry;
        } else if (ev.key.scancode == SDL_SCANCODE_SPACE) {
          jumpPressed = true;
        } else if (ev.key.scancode == SDL_SCANCODE_F1) {
          player.teleport(glm::vec3(world.fightPitPos.x, pitGroundY + 0.25f, world.fightPitPos.z - 2.6f), 0.0f);
        } else if (ev.key.scancode == SDL_SCANCODE_F) {
          const char* seq[3] = {"jab", "cross", "hook"};
          triggerAttack(seq[comboStep % 3], 12.0f);
          ++comboStep;
        } else if (ev.key.scancode == SDL_SCANCODE_Q) {
          triggerAttack("uppercut", 18.0f);
        } else if (ev.key.scancode == SDL_SCANCODE_E) {
          triggerAttack("kick", 20.0f);
        } else if (ev.key.scancode == SDL_SCANCODE_R) {
          const int nextTier = opponent.defeated ? (opponent.tier >= 3 ? 1 : opponent.tier + 1) : opponent.tier;
          opponent = spawnTierOpponent(nextTier);
          playerHp = 100.0f;
          playerStamina = 100.0f;
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
    westgate::PlayerInputState input{};
    if (keys[SDL_SCANCODE_W]) input.moveForward += 1.0f;
    if (keys[SDL_SCANCODE_S]) input.moveForward -= 1.0f;
    if (keys[SDL_SCANCODE_D]) input.moveRight += 1.0f;
    if (keys[SDL_SCANCODE_A]) input.moveRight -= 1.0f;
    input.sprint = keys[SDL_SCANCODE_LSHIFT] || keys[SDL_SCANCODE_RSHIFT];
    input.crouch = keys[SDL_SCANCODE_C] || keys[SDL_SCANCODE_LCTRL];
    input.jump = jumpPressed;
    input.lookDeltaX = lookDx;
    input.lookDeltaY = lookDy;

    player.update(dt, input);
    if (player.steppedThisFrame()) {
      const bool inWater = player.position().y < 0.25f;
      audio.playFootstep(player.stepIntensity(), inWater);
    }

    physicsAccum += dt;
    constexpr float kFixedStep = 1.0f / 60.0f;
    while (physicsAccum >= kFixedStep) {
      physics.step(kFixedStep);
      physicsAccum -= kFixedStep;
    }

    // Regenerate stamina & tick hit flashes
    const bool blocking = (SDL_GetMouseState(nullptr, nullptr) & SDL_BUTTON_RMASK) != 0 || keys[SDL_SCANCODE_V];
    if (playerAttackClip.empty()) {
      playerStamina = std::min(100.0f, playerStamina + (blocking ? 10.0f : 22.0f) * dt);
    }
    playerHitFlash = std::max(0.0f, playerHitFlash - dt * 4.0f);
    opponent.hitFlashTimer = std::max(0.0f, opponent.hitFlashTimer - dt * 4.0f);

    // Update player combat animation & Iron Pit melee hit detection
    const glm::vec3 pPos = player.position();
    const bool nearPit = glm::distance(glm::vec2(pPos.x, pPos.z), glm::vec2(world.fightPitPos.x, world.fightPitPos.z)) < 16.0f;
    if (!playerAttackClip.empty()) {
      auto cit = clips.find(playerAttackClip);
      const float clipDur = (cit != clips.end()) ? cit->second.duration : 0.7f;
      playerAttackTimer += dt;
      if (!playerAttackHitDone && playerAttackTimer >= clipDur * 0.36f) {
        playerAttackHitDone = true;
        if (!opponent.defeated && glm::distance(pPos, opponent.pos) < 2.45f) {
          const float dmg = (playerAttackClip == "uppercut" || playerAttackClip == "kick") ? 28.0f : 16.0f;
          opponent.hp = std::max(0.0f, opponent.hp - dmg);
          opponent.hitFlashTimer = 1.0f;
          audio.playImpact(dmg / 22.0f);
          if (opponent.hp <= 0.0f) {
            opponent.defeated = true;
            opponent.animClip = "knockdown";
            opponent.animTime = 0.0f;
            playerCash += opponent.purse;
          } else {
            opponent.animClip = "hit";
            opponent.animTime = 0.0f;
          }
        }
      }
      if (playerAttackTimer >= clipDur) {
        playerAttackClip.clear();
      }
    }

    // Update Iron Pit Opponent AI
    opponent.animTime += dt;
    if (!opponent.defeated) {
      const glm::vec3 toPlayer = pPos - opponent.pos;
      const float distToPlayer = glm::length(glm::vec2(toPlayer.x, toPlayer.z));
      if (distToPlayer > 0.05f && nearPit) {
        opponent.yawRad = std::atan2(toPlayer.x, toPlayer.z);
      }

      if (opponent.animClip == "hit" || opponent.animClip == "jab") {
        auto oit = clips.find(opponent.animClip);
        const float dur = (oit != clips.end()) ? oit->second.duration : 0.75f;
        if (opponent.animClip == "jab" && !opponent.hitAppliedThisSwing && opponent.animTime >= dur * 0.42f) {
          opponent.hitAppliedThisSwing = true;
          if (distToPlayer < 2.35f) {
            const float dmg = blocking ? 3.5f : 12.0f;
            playerHp = std::max(1.0f, playerHp - dmg);
            playerHitFlash = blocking ? 0.35f : 1.0f;
            audio.playImpact(blocking ? 0.45f : 0.9f);
          }
        }
        if (opponent.animTime >= dur) {
          opponent.animClip = "fight_idle";
          opponent.animTime = 0.0f;
        }
      } else if (nearPit && distToPlayer > 1.75f && distToPlayer < 9.5f) {
        const glm::vec2 dir = glm::normalize(glm::vec2(toPlayer.x, toPlayer.z));
        opponent.pos.x = std::clamp(opponent.pos.x + dir.x * 2.6f * dt, world.fightPitPos.x - 4.4f, world.fightPitPos.x + 4.4f);
        opponent.pos.z = std::clamp(opponent.pos.z + dir.y * 2.6f * dt, world.fightPitPos.z - 4.4f, world.fightPitPos.z + 4.4f);
        opponent.animClip = "Walk";
      } else {
        opponent.animClip = "fight_idle";
      }

      if (nearPit && distToPlayer <= 2.2f && opponent.animClip != "hit" && opponent.animClip != "jab") {
        opponent.attackCooldown -= dt;
        if (opponent.attackCooldown <= 0.0f) {
          opponent.animClip = "jab";
          opponent.animTime = 0.0f;
          opponent.hitAppliedThisSwing = false;
          opponent.attackCooldown = std::max(0.85f, 2.0f - 0.35f * static_cast<float>(opponent.tier));
        }
      }
    }

    // Evaluate skeletal animations for player (body + shorts + hair) and opponent
    locoTimer += dt;
    const float targetBlend = player.speed() > 0.35f ? 1.0f : 0.0f;
    locoBlend += (targetBlend - locoBlend) * std::min(1.0f, dt * 10.0f);

    const std::string idleKey = (nearPit && clips.count("fight_idle")) ? "fight_idle" : (clips.count("Idle") ? "Idle" : "fight_idle");
    const std::string moveKey = (player.sprinting() && clips.count("Run")) ? "Run" : (clips.count("Walk") ? "Walk" : idleKey);

    auto evalPlayerPart = [&](const westgate::CharacterAnimator& anim, std::array<glm::mat4, westgate::kMaxSkinBones>& pal) {
      if (!playerAttackClip.empty() && clips.count(playerAttackClip)) {
        anim.evaluateClip(clips.at(playerAttackClip), playerAttackTimer, pal);
      } else if (blocking && clips.count("block")) {
        anim.evaluateClip(clips.at("block"), elapsedSec, pal);
      } else if (clips.count(idleKey) && clips.count(moveKey)) {
        anim.evaluateBlended(clips.at(idleKey), locoTimer, clips.at(moveKey), locoTimer, locoBlend, pal);
      } else {
        anim.evaluateRest(pal);
      }
    };
    if (hasBody) evalPlayerPart(bodyAnim, palBody);
    if (hasShorts) evalPlayerPart(shortsAnim, palShorts);
    if (hasHair) evalPlayerPart(hairAnim, palHair);

    if (hasBiz) {
      const std::string oppKey = clips.count(opponent.animClip) ? opponent.animClip : idleKey;
      if (clips.count(oppKey)) oppAnim.evaluateClip(clips.at(oppKey), opponent.animTime, palOpp);
      else oppAnim.evaluateRest(palOpp);
    }

    // Update ambient traffic vehicles along exported road splines
    policeInst.clear();
    taxiInst.clear();
    for (auto& ta : traffic) {
      const auto& seg = world.roads[ta.roadIdx];
      const float maxS = static_cast<float>(seg.samples.size() - 1);
      ta.samplePos += (ta.forward ? 1.0f : -1.0f) * (ta.speed / 12.0f) * dt;
      if (ta.samplePos >= maxS) { ta.samplePos = maxS - 0.01f; ta.forward = false; }
      if (ta.samplePos <= 0.0f) { ta.samplePos = 0.01f; ta.forward = true; }

      const size_t i0 = std::min<size_t>(static_cast<size_t>(ta.samplePos), seg.samples.size() - 2);
      const float f = ta.samplePos - static_cast<float>(i0);
      const auto& s0 = seg.samples[i0];
      const auto& s1 = seg.samples[i0 + 1];
      const glm::vec3 p = glm::mix(s0.pos, s1.pos, f);
      const glm::vec3 dir = (ta.forward ? 1.0f : -1.0f) * glm::normalize(s1.pos - s0.pos);
      const glm::vec3 laneOffset = glm::vec3(s0.rx, 0.0f, s0.rz) * (ta.forward ? 2.2f : -2.2f);
      const glm::vec3 wp = p + laneOffset;
      const float gy = world.heightfield.sampleHeight(wp.x, wp.z);
      const float yaw = std::atan2(dir.x, dir.z);

      westgate::InstanceAttrib inst{wp.x, gy + 0.06f, wp.z, 1.0f, 1.0f, 1.0f, yaw, 1.0f, 1.0f, 1.0f};
      if (ta.isPolice) policeInst.push_back(inst);
      else taxiInst.push_back(inst);
    }

    // Assemble skinned character draw list
    renderChars.clear();
    const glm::vec4 playerTint = glm::mix(glm::vec4(1.0f), glm::vec4(1.5f, 0.45f, 0.45f, 1.0f), playerHitFlash);
    if (hasBody) renderChars.push_back({pPos, player.yaw(), playerTint, westgate::SkinnedPartKind::PlayerBody, &palBody});
    if (hasShorts) renderChars.push_back({pPos, player.yaw(), glm::vec4(0.82f, 0.22f, 0.22f, 1.0f), westgate::SkinnedPartKind::PlayerShorts, &palShorts});
    if (hasHair) renderChars.push_back({pPos, player.yaw(), glm::vec4(1.0f), westgate::SkinnedPartKind::PlayerHair, &palHair});
    if (hasBiz) {
      const glm::vec4 oppTint = glm::mix(glm::vec4(1.0f), glm::vec4(1.6f, 0.4f, 0.4f, 1.0f), opponent.hitFlashTimer);
      renderChars.push_back({opponent.pos, opponent.yawRad, oppTint, westgate::SkinnedPartKind::Opponent, &palOpp});
    }

    ImGui_ImplWGPU_NewFrame();
    ImGui_ImplSDL3_NewFrame();
    ImGui::NewFrame();

    if (showTelemetry) {
      ImGui::SetNextWindowPos(ImVec2(14.0f, 14.0f), ImGuiCond_FirstUseEver);
      ImGui::SetNextWindowBgAlpha(0.80f);
      ImGui::Begin("Westgate Native Engine [F9]", &showTelemetry, ImGuiWindowFlags_AlwaysAutoResize);
      const auto& tel = renderer.telemetry();
      ImGui::Text("GPU: %s", gpu.adapterName().c_str());
      ImGui::Text("FPS: %.1f (%.2f ms)", io.Framerate, 1000.0f / std::max(1.0f, io.Framerate));
      ImGui::Separator();
      ImGui::Text("Pos: (%.1f, %.1f, %.1f) | Speed: %.1f m/s | %s",
                  pPos.x, pPos.y, pPos.z, player.speed(), player.grounded() ? "Grounded" : "Airborne");
      ImGui::Text("Chunks: %u vis (%u near, %u lod) | Bldgs: %u | GLB Props: %u (%u types) | Traffic: %u",
                  tel.visibleChunks, tel.nearChunks, tel.lodChunks, tel.drawnBuildings,
                  tel.drawnProps, tel.glbPropTypesLoaded, tel.drawnVehicles);
      ImGui::Text("Jolt Bodies: %u | Shadows: 2048x2048 PCF", physics.staticBodyCount());
      ImGui::Separator();
      ImGui::Text("HP: %.0f/100 | Stamina: %.0f/100 | Purse: $%d", playerHp, playerStamina, playerCash);
      if (nearPit || opponent.hp < opponent.maxHp) {
        ImGui::Text("IRON PIT TIER %d: %s  HP: %.0f / %.0f %s",
                    opponent.tier, opponent.name.c_str(), opponent.hp, opponent.maxHp,
                    opponent.defeated ? "[KO! Press R for Next Bout]" : "");
      }
      ImGui::Separator();
      ImGui::Text("[TAB] Mouse Look: %s | [LMB/F] Punch | [Q] Uppercut | [E] Kick | [RMB/V] Block", mouseCaptured ? "ON" : "OFF");
      if (ImGui::Button("Iron Pit (722, 115)")) {
        player.teleport(glm::vec3(world.fightPitPos.x, pitGroundY + 0.25f, world.fightPitPos.z - 2.6f), 0.0f);
      }
      ImGui::SameLine();
      if (ImGui::Button("Spawn")) {
        player.teleport(world.spawnPos, world.spawnYawDeg);
      }
      for (size_t i = 0; i < world.teleports.size() && i < 6; ++i) {
        if (i % 3 != 0) ImGui::SameLine();
        if (ImGui::Button(world.teleports[i].label.c_str())) {
          player.teleport(world.teleports[i].pos, world.teleports[i].yawDeg);
        }
      }
      ImGui::End();
    }

    ImGui::Render();
    renderer.render(
      gpu,
      world,
      streamer,
      player.cameraPosition(),
      player.cameraTarget(),
      pPos,
      elapsedSec,
      renderChars,
      policeInst,
      taxiInst,
      true
    );
  }

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
