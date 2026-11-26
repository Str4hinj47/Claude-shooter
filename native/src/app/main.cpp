#include "westgate/AudioEngine.hpp"
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
#include <cstdio>
#include <filesystem>
#include <string>

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

  // Optional player GLB mesh (decode meshopt-compressed shirtless fighter or fallback)
  westgate::GltfModel playerModel;
  const std::filesystem::path playerGlb = assetsRoot / "characters" / "fighter" / "base_body.glb";
  const bool hasPlayerGlb = std::filesystem::exists(playerGlb) &&
                            westgate::GltfAssetLoader::loadGlb(playerGlb.string(), playerModel, false, nullptr);

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

  westgate::WorldRenderer renderer;
  const std::filesystem::path shaderPath = assetsRoot / "shaders" / "westgate.wgsl";
  if (!renderer.init(gpu, world, shaderPath.string(), hasPlayerGlb ? &playerModel : nullptr, &err)) {
    std::fprintf(stderr, "WorldRenderer init failed: %s\n", err.c_str());
    ImGui_ImplWGPU_Shutdown();
    ImGui_ImplSDL3_Shutdown();
    ImGui::DestroyContext();
    gpu.shutdown();
    SDL_DestroyWindow(window);
    SDL_Quit();
    return 1;
  }

  bool running = true;
  bool mouseCaptured = false;
  bool showTelemetry = true;
  westgate::FrameTimer timer;
  float physicsAccum = 0.0f;

  while (running) {
    const float dt = static_cast<float>(timer.tickSeconds());
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
      if (ev.type == SDL_EVENT_KEY_DOWN && !ev.key.repeat) {
        if (ev.key.scancode == SDL_SCANCODE_TAB || ev.key.scancode == SDL_SCANCODE_ESCAPE) {
          mouseCaptured = !mouseCaptured;
          SDL_SetWindowRelativeMouseMode(window, mouseCaptured);
        } else if (ev.key.scancode == SDL_SCANCODE_F9) {
          showTelemetry = !showTelemetry;
        } else if (ev.key.scancode == SDL_SCANCODE_SPACE) {
          jumpPressed = true;
        } else if (ev.key.scancode == SDL_SCANCODE_F1) {
          player.teleport(world.fightPitPos, 0.0f);
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

    ImGui_ImplWGPU_NewFrame();
    ImGui_ImplSDL3_NewFrame();
    ImGui::NewFrame();

    if (showTelemetry) {
      ImGui::SetNextWindowPos(ImVec2(14.0f, 14.0f), ImGuiCond_FirstUseEver);
      ImGui::SetNextWindowBgAlpha(0.78f);
      ImGui::Begin("Westgate Native Engine [F9]", &showTelemetry, ImGuiWindowFlags_AlwaysAutoResize);
      const auto& tel = renderer.telemetry();
      const glm::vec3 p = player.position();
      ImGui::Text("GPU: %s", gpu.adapterName().c_str());
      ImGui::Text("FPS: %.1f (%.2f ms)", io.Framerate, 1000.0f / std::max(1.0f, io.Framerate));
      ImGui::Separator();
      ImGui::Text("Pos: (%.1f, %.1f, %.1f) | Speed: %.1f m/s | %s",
                  p.x, p.y, p.z, player.speed(), player.grounded() ? "Grounded" : "Airborne");
      ImGui::Text("Chunks: %u vis (%u near, %u lod) | Buildings: %u | Props: %u",
                  tel.visibleChunks, tel.nearChunks, tel.lodChunks, tel.drawnBuildings, tel.drawnProps);
      ImGui::Text("Jolt Bodies: %u | Player GLB: %s",
                  physics.staticBodyCount(), hasPlayerGlb ? "base_body.glb" : "Fallback");
      ImGui::Separator();
      ImGui::Text("[TAB] Mouse Look: %s | [WASD] Move | [Shift] Sprint | [Space] Jump", mouseCaptured ? "ON" : "OFF");
      if (ImGui::Button("Iron Pit (722, 115)")) {
        player.teleport(world.fightPitPos, 0.0f);
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
      player.position(),
      player.yaw(),
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
