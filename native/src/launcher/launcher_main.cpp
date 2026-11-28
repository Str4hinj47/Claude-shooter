#include "westgate/GameSettings.hpp"
#include "westgate/UiTheme.hpp"
#include "westgate/WgpuContext.hpp"

#include "imgui.h"
#include "imgui_impl_sdl3.h"
#include "imgui_impl_wgpu.h"
#include <SDL3/SDL.h>
#include <nlohmann/json.hpp>

#include <algorithm>
#include <array>
#include <chrono>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <filesystem>
#include <fstream>
#include <string>
#include <thread>
#include <vector>

#if defined(_WIN32)
#include <process.h>
#else
#include <unistd.h>
#endif

namespace {

struct SaveSummary {
  bool exists = false;
  int storyStep = 0;
  int cashUsd = 1500;
  int stashes = 0;
  std::string difficulty = "OPERATIVE";
};

std::filesystem::path findAssetsRoot(const char* argv0) {
  std::filesystem::path exeDir = argv0 ? std::filesystem::path(argv0).parent_path() : std::filesystem::current_path();
  const std::filesystem::path candidates[] = {
    exeDir / "assets",
    std::filesystem::current_path() / "assets",
    std::filesystem::current_path() / "native" / "assets",
    std::filesystem::current_path().parent_path() / "assets",
  };
  for (const auto& c : candidates) {
    if (std::filesystem::exists(c / "world" / "westgate_world.json") ||
        std::filesystem::exists(c / "fonts" / "Roboto-Medium.ttf")) {
      return c;
    }
  }
  return exeDir / "assets";
}

std::filesystem::path findClientBinary(const char* argv0) {
  std::filesystem::path exeDir = argv0 ? std::filesystem::path(argv0).parent_path() : std::filesystem::current_path();
#if defined(_WIN32)
  const char* names[] = {"WestgateBay.exe", "westgate_engine.exe"};
#else
  const char* names[] = {"WestgateBay", "westgate_engine"};
#endif
  for (const char* nm : names) {
    if (std::filesystem::exists(exeDir / nm)) return exeDir / nm;
    if (std::filesystem::exists(std::filesystem::current_path() / nm)) return std::filesystem::current_path() / nm;
  }
  return exeDir / names[0];
}

SaveSummary inspectSaveFile(const std::filesystem::path& savePath) {
  SaveSummary s;
  if (!std::filesystem::exists(savePath)) return s;
  std::ifstream in(savePath);
  if (!in.is_open()) return s;
  try {
    nlohmann::json j;
    in >> j;
    s.exists = true;
    s.storyStep = j.value("storyStep", 0);
    s.cashUsd = j.value("cash", 1500);
    const int diff = j.value("difficulty", 1);
    s.difficulty = (diff <= 0) ? "STORY" : ((diff == 1) ? "OPERATIVE" : "BLACK CONTRACT");
    if (j.contains("stashesCollected") && j["stashesCollected"].is_array()) {
      for (const auto& v : j["stashesCollected"]) {
        if (v.is_boolean() && v.get<bool>()) ++s.stashes;
      }
    }
  } catch (...) {
  }
  return s;
}

bool launchGameClient(const std::filesystem::path& binPath, const std::vector<std::string>& extraArgs) {
  if (!std::filesystem::exists(binPath)) {
    std::fprintf(stderr, "[WestgateLauncher] Game client binary not found at: %s\n", binPath.string().c_str());
    return false;
  }
  std::vector<std::string> fullArgs;
  fullArgs.push_back(binPath.string());
  for (const auto& a : extraArgs) fullArgs.push_back(a);

#if defined(_WIN32)
  std::vector<const char*> cargs;
  for (const auto& a : fullArgs) cargs.push_back(a.c_str());
  cargs.push_back(nullptr);
  const intptr_t rc = _spawnv(_P_NOWAIT, binPath.string().c_str(), cargs.data());
  return rc != -1;
#else
  const pid_t pid = fork();
  if (pid < 0) return false;
  if (pid == 0) {
    const std::filesystem::path workDir = binPath.parent_path();
    if (!workDir.empty()) {
      (void)chdir(workDir.c_str());
    }
    std::vector<char*> cargs;
    for (auto& a : fullArgs) cargs.push_back(a.data());
    cargs.push_back(nullptr);
    execv(binPath.c_str(), cargs.data());
    _exit(127);
  }
  return true;
#endif
}

void drawChamferRect(
  ImDrawList* dl,
  ImVec2 tl,
  ImVec2 br,
  float cut,
  ImU32 fillCol,
  ImU32 borderCol,
  float borderThick = 1.2f
) {
  const ImVec2 pts[6] = {
    {tl.x + cut, tl.y},
    {br.x,       tl.y},
    {br.x,       br.y - cut},
    {br.x - cut, br.y},
    {tl.x,       br.y},
    {tl.x,       tl.y + cut},
  };
  dl->AddConvexPolyFilled(pts, 6, fillCol);
  if ((borderCol >> 24) > 0 && borderThick > 0.0f) {
    dl->AddPolyline(pts, 6, borderCol, ImDrawFlags_Closed, borderThick);
  }
}

void drawLauncherKeyArtBackdrop(ImDrawList* bg, ImVec2 disp, float timeSec) {
  const float horizonY = disp.y * 0.66f;

  // 1. Deep Obsidian-to-Crimson-Gold Sunset Sky Gradient
  bg->AddRectFilledMultiColor(
    {0.0f, 0.0f}, {disp.x, horizonY * 0.58f},
    IM_COL32(7, 11, 20, 255),  IM_COL32(12, 18, 34, 255),
    IM_COL32(36, 26, 54, 255), IM_COL32(22, 24, 46, 255)
  );
  bg->AddRectFilledMultiColor(
    {0.0f, horizonY * 0.58f}, {disp.x, horizonY},
    IM_COL32(22, 24, 46, 255),   IM_COL32(36, 26, 54, 255),
    IM_COL32(214, 102, 54, 255), IM_COL32(124, 52, 64, 255)
  );

  // 2. Atmospheric Sunset Disc & Volumetric Halo over Left Key-Art Pane
  const ImVec2 sunPos(disp.x * 0.27f, horizonY - 46.0f);
  for (int r = 5; r >= 1; --r) {
    const float rad = 38.0f + static_cast<float>(r) * 24.0f + std::sin(timeSec * 1.1f + static_cast<float>(r)) * 2.0f;
    bg->AddCircleFilled(sunPos, rad, IM_COL32(252, 164, 68, static_cast<int>(18 * (6 - r))), 48);
  }
  bg->AddCircleFilled(sunPos, 42.0f, IM_COL32(255, 208, 104, 235), 48);

  // 3. Distant Coastal Mountain Foothills Silhouette
  const ImVec2 hills[7] = {
    {0.0f, horizonY},
    {0.0f, horizonY - 38.0f},
    {disp.x * 0.14f, horizonY - 74.0f},
    {disp.x * 0.30f, horizonY - 48.0f},
    {disp.x * 0.46f, horizonY - 82.0f},
    {disp.x * 0.64f, horizonY - 34.0f},
    {disp.x * 0.64f, horizonY},
  };
  bg->AddConvexPolyFilled(hills, 7, IM_COL32(18, 22, 36, 230));

  // 4. Westgate Downtown High-Rise Skyline & Lit Office Windows
  struct TowerDef { float xFrac; float w; float h; bool spire; };
  constexpr TowerDef towers[] = {
    {0.03f, 34.0f,  96.0f, false},
    {0.07f, 44.0f, 148.0f, true},
    {0.12f, 38.0f, 118.0f, false},
    {0.17f, 52.0f, 196.0f, true},
    {0.23f, 40.0f, 136.0f, false},
    {0.28f, 48.0f, 172.0f, true},
    {0.34f, 36.0f, 112.0f, false},
    {0.39f, 44.0f, 144.0f, false},
    {0.44f, 32.0f,  88.0f, false},
  };
  for (size_t ti = 0; ti < std::size(towers); ++ti) {
    const auto& t = towers[ti];
    const float tx = disp.x * t.xFrac;
    const float ty = horizonY - t.h;
    bg->AddRectFilled({tx, ty}, {tx + t.w, horizonY}, IM_COL32(10, 15, 25, 250));
    bg->AddLine({tx, ty}, {tx, horizonY}, IM_COL32(252, 168, 78, 90), 1.2f);
    if (t.spire) {
      bg->AddLine({tx + t.w * 0.5f, ty}, {tx + t.w * 0.5f, ty - 22.0f}, IM_COL32(120, 170, 215, 180), 1.5f);
      const int beaconA = 140 + static_cast<int>(105.0f * (0.5f + 0.5f * std::sin(timeSec * 3.2f + static_cast<float>(ti))));
      bg->AddCircleFilled({tx + t.w * 0.5f, ty - 23.0f}, 2.4f, IM_COL32(255, 78, 68, beaconA));
    }
    // Lit window strips
    for (float wy = ty + 10.0f; wy < horizonY - 12.0f; wy += 11.0f) {
      for (float wx = tx + 6.0f; wx < tx + t.w - 8.0f; wx += 9.0f) {
        const uint32_t hsh = static_cast<uint32_t>(wx * 17.0f + wy * 31.0f + static_cast<float>(ti * 13));
        if ((hsh % 5u) < 2u) {
          const ImU32 wCol = (hsh % 7u == 0u) ? IM_COL32(72, 212, 255, 155) : IM_COL32(252, 202, 108, 145);
          bg->AddRectFilled({wx, wy}, {wx + 4.5f, wy + 4.0f}, wCol);
        }
      }
    }
  }

  // 5. Westgate Bay Arch Bridge Span Silhouette
  const float brX0 = disp.x * 0.34f;
  const float brX1 = disp.x * 0.62f;
  const float deckY = horizonY - 22.0f;
  bg->AddLine({brX0, deckY}, {brX1, deckY}, IM_COL32(16, 24, 38, 255), 4.0f);
  ImVec2 prevArch(brX0, deckY);
  for (int s = 1; s <= 18; ++s) {
    const float u = static_cast<float>(s) / 18.0f;
    const float ax = brX0 + (brX1 - brX0) * u;
    const float ay = deckY - std::sin(u * 3.14159265f) * 48.0f;
    bg->AddLine(prevArch, {ax, ay}, IM_COL32(28, 44, 68, 245), 2.5f);
    if (s % 2 == 0) {
      bg->AddLine({ax, ay}, {ax, deckY}, IM_COL32(58, 112, 156, 125), 1.0f);
    }
    prevArch = {ax, ay};
  }

  // 6. Westgate Bay Water & Shimmering Sunset Reflections
  bg->AddRectFilledMultiColor(
    {0.0f, horizonY}, disp,
    IM_COL32(14, 24, 42, 255), IM_COL32(10, 16, 28, 255),
    IM_COL32(5, 8, 14, 255),   IM_COL32(6, 10, 18, 255)
  );
  bg->AddLine({0.0f, horizonY}, {disp.x, horizonY}, IM_COL32(252, 172, 84, 155), 1.4f);
  for (int wi = 0; wi < 16; ++wi) {
    const float v = static_cast<float>(wi) / 16.0f;
    const float wy = horizonY + 8.0f + v * v * (disp.y - horizonY - 22.0f);
    const float halfW = (1.0f - v * 0.68f) * 68.0f + std::sin(timeSec * 2.3f + static_cast<float>(wi) * 1.4f) * 11.0f;
    const float cx = sunPos.x + std::cos(timeSec * 1.6f + static_cast<float>(wi)) * 8.0f;
    bg->AddLine({cx - halfW, wy}, {cx + halfW, wy}, IM_COL32(252, 178, 78, static_cast<int>(135 * (1.0f - v))), 2.0f);
  }

  // 7. Right-Side Control Deck Vignette & Tactical Grid Accents
  bg->AddRectFilledMultiColor(
    {disp.x * 0.44f, 0.0f}, disp,
    IM_COL32(6, 10, 16, 0),   IM_COL32(6, 10, 16, 246),
    IM_COL32(6, 10, 16, 252), IM_COL32(6, 10, 16, 0)
  );
  bg->AddRectFilledMultiColor(
    {0.0f, disp.y - 120.0f}, disp,
    IM_COL32(5, 8, 14, 0),   IM_COL32(5, 8, 14, 0),
    IM_COL32(5, 8, 14, 238), IM_COL32(5, 8, 14, 245)
  );
}

} // namespace

int main(int argc, char** argv) {
  std::string headlessShotPath;
  int winW = 980;
  int winH = 600;

  for (int i = 1; i < argc; ++i) {
    const std::string arg = argv[i];
    if (arg == "--headless-shot" && i + 1 < argc) {
      headlessShotPath = argv[++i];
    } else if (arg == "--res" && i + 1 < argc) {
      int rw = 0, rh = 0;
      if (std::sscanf(argv[++i], "%dx%d", &rw, &rh) == 2 && rw >= 640 && rh >= 400) {
        winW = rw;
        winH = rh;
      }
    }
  }
  const bool headlessMode = !headlessShotPath.empty();

  if (!headlessMode) {
    if (!SDL_Init(SDL_INIT_VIDEO)) {
      std::fprintf(stderr, "SDL_Init failed: %s\n", SDL_GetError());
      return 1;
    }
  }

  const std::filesystem::path assetsRoot = findAssetsRoot(argv[0]);
  const std::filesystem::path clientBin = findClientBinary(argv[0]);
  const std::filesystem::path rootDir = assetsRoot.parent_path();
  const std::filesystem::path settingsPath = rootDir / "westgate_settings.json";
  const std::filesystem::path savePath = rootDir / "westgate_save.json";

  westgate::GameSettings settings;
  settings.loadFromFile(settingsPath.string());
  SaveSummary saveInfo = inspectSaveFile(savePath);

  float scale = headlessMode ? 1.0f : SDL_GetDisplayContentScale(SDL_GetPrimaryDisplay());
  if (scale <= 0.0f) scale = 1.0f;

  SDL_Window* window = nullptr;
  westgate::WgpuContext gpu;
  std::string err;
  if (headlessMode) {
    if (!gpu.initOffscreen(static_cast<uint32_t>(winW), static_cast<uint32_t>(winH), &err)) {
      std::fprintf(stderr, "WgpuContext offscreen init failed: %s\n", err.c_str());
      return 1;
    }
  } else {
    window = SDL_CreateWindow(
      "WESTGATE BAY — Desktop Launcher",
      static_cast<int>(winW * scale),
      static_cast<int>(winH * scale),
      0
    );
    if (!window) {
      std::fprintf(stderr, "SDL_CreateWindow failed: %s\n", SDL_GetError());
      SDL_Quit();
      return 1;
    }
    if (!gpu.init(window, static_cast<uint32_t>(winW * scale), static_cast<uint32_t>(winH * scale), &err)) {
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
  io.IniFilename = nullptr;
  westgate::UiFontSet fonts{};
  westgate::loadWestgateUiFonts(io, assetsRoot, scale, fonts);
  westgate::applyWestgateAaaTheme(scale);

  if (!headlessMode) {
    ImGui_ImplSDL3_InitForOther(window);
  }
  ImGui_ImplWGPU_InitInfo uiInfo{};
  uiInfo.Device = gpu.device();
  uiInfo.NumFramesInFlight = 3;
  uiInfo.RenderTargetFormat = gpu.surfaceFormat();
  uiInfo.DepthStencilFormat = WGPUTextureFormat_Undefined;
  ImGui_ImplWGPU_Init(&uiInfo);

  struct ResOpt { const char* label; int w; int h; };
  constexpr ResOpt kResOpts[] = {
    {"1280 x 720 (HD)",       1280,  720},
    {"1600 x 900 (HD+)",      1600,  900},
    {"1920 x 1080 (FHD)",     1920, 1080},
    {"2560 x 1440 (QHD)",     2560, 1440},
    {"3840 x 2160 (4K UHD)",  3840, 2160},
  };

  bool running = true;
  bool launchDevMode = false;
  std::string statusBanner = "READY TO DEPLOY  •  DIRECT NATIVE GPU SWAPCHAIN";
  float elapsedSec = 0.0f;
  int headlessStep = 0;
  auto prevTick = std::chrono::steady_clock::now();

  while (running) {
    const auto nowTick = std::chrono::steady_clock::now();
    const float dt = headlessMode
      ? (1.0f / 60.0f)
      : std::clamp(std::chrono::duration<float>(nowTick - prevTick).count(), 0.001f, 0.1f);
    prevTick = nowTick;
    elapsedSec += dt;

    if (!headlessMode) {
      SDL_Event ev;
      while (SDL_PollEvent(&ev)) {
        ImGui_ImplSDL3_ProcessEvent(&ev);
        if (ev.type == SDL_EVENT_QUIT) running = false;
        if (ev.type == SDL_EVENT_WINDOW_CLOSE_REQUESTED && ev.window.windowID == SDL_GetWindowID(window)) running = false;
        if (ev.type == SDL_EVENT_KEY_DOWN && !ev.key.repeat && ev.key.scancode == SDL_SCANCODE_ESCAPE) {
          running = false;
        }
      }
      int pixW = 0, pixH = 0;
      SDL_GetWindowSizeInPixels(window, &pixW, &pixH);
      if (pixW <= 0 || pixH <= 0) {
        SDL_Delay(16);
        continue;
      }
      gpu.resize(static_cast<uint32_t>(pixW), static_cast<uint32_t>(pixH));
    }

    ImGui_ImplWGPU_NewFrame();
    if (headlessMode) {
      io.DisplaySize = ImVec2(static_cast<float>(gpu.width()), static_cast<float>(gpu.height()));
      io.DeltaTime = dt;
    } else {
      ImGui_ImplSDL3_NewFrame();
    }
    ImGui::NewFrame();

    const ImVec2 disp = ImGui::GetMainViewport()->Size;
    ImDrawList* bg = ImGui::GetBackgroundDrawList();
    drawLauncherKeyArtBackdrop(bg, disp, elapsedSec);

    ImFont* fMono = fonts.mono ? fonts.mono : ImGui::GetFont();
    ImFont* fHead = fonts.heading ? fonts.heading : ImGui::GetFont();
    ImFont* fTitle = fonts.title ? fonts.title : fHead;

    // Left Key-Art Hero Branding & Operative Dossier
    const float leftPad = 42.0f;
    bg->AddRectFilled({leftPad, 38.0f}, {leftPad + 5.0f, 118.0f}, IM_COL32(248, 196, 68, 255), 1.5f);
    bg->AddText(fMono, fMono->LegacySize, {leftPad + 16.0f, 40.0f}, IM_COL32(84, 214, 255, 240),
                "WESTGATE RUNTIME v1.0  //  PRE-GAME DESKTOP HUB");
    bg->AddText(fTitle, fTitle->LegacySize, {leftPad + 15.0f, 59.0f}, IM_COL32(248, 250, 255, 255),
                "WESTGATE BAY");
    bg->AddText(fHead, fHead->LegacySize, {leftPad + 17.0f, 100.0f}, IM_COL32(248, 198, 72, 245),
                "VOSS // BLACK CONTRACT");

    // Bottom-Left Operative Save Dossier Card
    const ImVec2 dosTl(leftPad, disp.y - 168.0f);
    const ImVec2 dosBr(leftPad + 420.0f, disp.y - 52.0f);
    drawChamferRect(bg, dosTl, dosBr, 9.0f, IM_COL32(8, 14, 23, 218), IM_COL32(64, 152, 208, 140), 1.2f);
    bg->AddRectFilled({dosTl.x, dosTl.y + 8.0f}, {dosTl.x + 4.0f, dosBr.y - 8.0f},
                      saveInfo.exists ? IM_COL32(72, 236, 152, 245) : IM_COL32(248, 196, 68, 245), 1.5f);

    bg->AddText(fMono, fMono->LegacySize, {dosTl.x + 16.0f, dosTl.y + 11.0f}, IM_COL32(110, 214, 255, 235),
                saveInfo.exists ? "OPERATIVE SAVE PROFILE DETECTED" : "NEW OPERATIVE PROFILE READY");
    if (saveInfo.exists) {
      char saveLine1[128];
      std::snprintf(saveLine1, sizeof(saveLine1), "CAMPAIGN STEP %d / 9   •   %s",
                    saveInfo.storyStep, saveInfo.difficulty.c_str());
      bg->AddText(fHead, fHead->LegacySize * 0.88f, {dosTl.x + 16.0f, dosTl.y + 34.0f}, IM_COL32(244, 248, 255, 250), saveLine1);

      char saveLine2[128];
      std::snprintf(saveLine2, sizeof(saveLine2), "BANK BALANCE $%d USD   •   HIDDEN STASHES %d/15   •   OPEN-WORLD EDITION",
                    saveInfo.cashUsd, saveInfo.stashes);
      bg->AddText(fMono, fMono->LegacySize * 0.92f, {dosTl.x + 16.0f, dosTl.y + 64.0f}, IM_COL32(182, 204, 226, 225), saveLine2);
    } else {
      bg->AddText(fHead, fHead->LegacySize * 0.88f, {dosTl.x + 16.0f, dosTl.y + 36.0f}, IM_COL32(244, 248, 255, 250),
                  "CHAPTER 01 // PROLOGUE DEPLOYMENT");
      bg->AddText(fMono, fMono->LegacySize * 0.92f, {dosTl.x + 16.0f, dosTl.y + 64.0f}, IM_COL32(182, 204, 226, 225),
                  "420 CRESCENT SAFEHOUSE   •   STARTING BALANCE $1,500 USD");
    }
    char gpuLine[160];
    std::snprintf(gpuLine, sizeof(gpuLine), "ADAPTER: %s   •   CLIENT: %s",
                  gpu.adapterName().c_str(),
                  std::filesystem::exists(clientBin) ? "READY" : "BUILD TARGET");
    bg->AddText(fMono, fMono->LegacySize * 0.86f, {dosTl.x + 16.0f, dosTl.y + 88.0f}, IM_COL32(138, 168, 198, 205), gpuLine);

    // Bottom Status Strip
    bg->AddText(fMono, fMono->LegacySize * 0.90f, {leftPad, disp.y - 28.0f}, IM_COL32(158, 184, 212, 205), statusBanner.c_str());

    // Right Control Column: Quick Hardware Configuration + Launch Blades
    const float rightW = 412.0f;
    const float rightX = disp.x - rightW - 36.0f;
    drawChamferRect(bg, {rightX, 26.0f}, {rightX + rightW, disp.y - 26.0f}, 11.0f,
                    IM_COL32(9, 14, 23, 228), IM_COL32(72, 168, 224, 145), 1.3f);

    ImGui::SetNextWindowPos({rightX + 18.0f, 38.0f}, ImGuiCond_Always);
    ImGui::SetNextWindowSize({rightW - 36.0f, disp.y - 72.0f}, ImGuiCond_Always);
    ImGui::Begin("##LauncherRightDeck", nullptr,
                 ImGuiWindowFlags_NoTitleBar | ImGuiWindowFlags_NoResize | ImGuiWindowFlags_NoMove |
                 ImGuiWindowFlags_NoBackground | ImGuiWindowFlags_NoScrollbar);

    ImGui::PushFont(fHead);
    ImGui::TextColored({0.97f, 0.78f, 0.28f, 1.0f}, "HARDWARE & DISPLAY SETUP");
    ImGui::PopFont();
    ImGui::Separator();

    bool dirtySettings = false;
    int modeIdx = static_cast<int>(settings.windowMode);
    const char* modeItems = "Borderless Fullscreen\0Windowed\0Exclusive Fullscreen\0";
    if (ImGui::Combo("Display Mode", &modeIdx, modeItems)) {
      settings.windowMode = static_cast<westgate::WindowDisplayMode>(std::clamp(modeIdx, 0, 2));
      dirtySettings = true;
    }

    int resIdx = 0;
    for (int ri = 0; ri < static_cast<int>(std::size(kResOpts)); ++ri) {
      if (kResOpts[ri].w == settings.resolutionWidth && kResOpts[ri].h == settings.resolutionHeight) {
        resIdx = ri;
        break;
      }
    }
    if (ImGui::BeginCombo("Resolution", kResOpts[resIdx].label)) {
      for (int ri = 0; ri < static_cast<int>(std::size(kResOpts)); ++ri) {
        const bool sel = (ri == resIdx);
        if (ImGui::Selectable(kResOpts[ri].label, sel)) {
          settings.resolutionWidth = kResOpts[ri].w;
          settings.resolutionHeight = kResOpts[ri].h;
          dirtySettings = true;
        }
        if (sel) ImGui::SetItemDefaultFocus();
      }
      ImGui::EndCombo();
    }

    int presetIdx = static_cast<int>(settings.graphicsPreset);
    const char* presetItems = "Low\0Medium\0High\0Ultra\0Custom\0";
    if (ImGui::Combo("Graphics Quality", &presetIdx, presetItems)) {
      const auto gp = static_cast<westgate::GraphicsPreset>(std::clamp(presetIdx, 0, 4));
      settings.applyGraphicsPreset(gp);
      dirtySettings = true;
    }

    if (ImGui::Checkbox("Vertical Sync (VSync)", &settings.vsync)) {
      dirtySettings = true;
    }
    ImGui::SameLine(205.0f);
    if (ImGui::Checkbox("Show FPS", &settings.showFpsCounter)) {
      dirtySettings = true;
    }

    int masterPct = static_cast<int>(std::round(settings.masterVolume * 100.0f));
    if (ImGui::SliderInt("Master Audio %", &masterPct, 0, 100)) {
      settings.masterVolume = static_cast<float>(masterPct) / 100.0f;
      dirtySettings = true;
    }

    if (dirtySettings) {
      settings.clampValid();
      if (settings.saveToFile(settingsPath.string())) {
        statusBanner = "SAVED CONFIGURATION  ->  westgate_settings.json";
      }
    }

    ImGui::Separator();

    ImGui::PushFont(fHead);
    ImGui::TextColored({0.34f, 0.86f, 1.0f, 1.0f}, "DEPLOYMENT LAUNCHPAD");
    ImGui::PopFont();

    ImGui::Checkbox("Enable Developer Telemetry (--dev)", &launchDevMode);

    auto makeArgs = [&](std::initializer_list<const char*> base) {
      std::vector<std::string> out;
      for (const char* b : base) out.emplace_back(b);
      if (launchDevMode) out.emplace_back("--dev");
      return out;
    };

    // Primary Gold/Amber PLAY Button
    ImGui::PushFont(fHead);
    ImGui::PushStyleColor(ImGuiCol_Button, ImVec4(0.86f, 0.62f, 0.14f, 0.96f));
    ImGui::PushStyleColor(ImGuiCol_ButtonHovered, ImVec4(0.96f, 0.72f, 0.20f, 1.00f));
    ImGui::PushStyleColor(ImGuiCol_ButtonActive, ImVec4(0.76f, 0.52f, 0.10f, 1.00f));
    ImGui::PushStyleColor(ImGuiCol_Text, ImVec4(0.04f, 0.06f, 0.10f, 1.00f));
    const char* primaryLbl = saveInfo.exists ? "PLAY  —  CONTINUE OPERATION" : "PLAY  —  LAUNCH WESTGATE BAY";
    if (ImGui::Button(primaryLbl, {-1.0f, 48.0f})) {
      settings.saveToFile(settingsPath.string());
      const auto args = saveInfo.exists ? makeArgs({"--continue"}) : makeArgs({});
      if (launchGameClient(clientBin, args)) {
        running = false;
      } else {
        statusBanner = "ERROR: WestgateBay binary not found next to launcher";
      }
    }
    ImGui::PopStyleColor(4);
    ImGui::PopFont();

    if (ImGui::Button("LAUNCH TO LIVE 3D MAIN MENU", {-1.0f, 35.0f})) {
      settings.saveToFile(settingsPath.string());
      if (launchGameClient(clientBin, makeArgs({}))) {
        running = false;
      }
    }

    if (ImGui::Button("EXIT TO DESKTOP", {-1.0f, 32.0f})) {
      settings.saveToFile(settingsPath.string());
      running = false;
    }

    ImGui::End();
    ImGui::Render();

    // WebGPU Swapchain / Offscreen Render Pass
    WGPUSurfaceTexture surfTex{};
    WGPUTextureView backView = nullptr;
    bool ownsBackView = false;
    if (gpu.isOffscreen()) {
      backView = gpu.offscreenView();
    } else {
      wgpuSurfaceGetCurrentTexture(gpu.surface(), &surfTex);
      if (ImGui_ImplWGPU_IsSurfaceStatusError(surfTex.status) || ImGui_ImplWGPU_IsSurfaceStatusSubOptimal(surfTex.status)) {
        if (surfTex.texture) {
          wgpuTextureRelease(surfTex.texture);
          surfTex.texture = nullptr;
        }
        gpu.reconfigureSurface();
        wgpuSurfaceGetCurrentTexture(gpu.surface(), &surfTex);
        if (ImGui_ImplWGPU_IsSurfaceStatusError(surfTex.status) || !surfTex.texture) {
          if (surfTex.texture) wgpuTextureRelease(surfTex.texture);
          continue;
        }
      }
      WGPUTextureViewDescriptor tvd = WGPU_TEXTURE_VIEW_DESCRIPTOR_INIT;
      tvd.format = gpu.surfaceFormat();
      tvd.dimension = WGPUTextureViewDimension_2D;
      tvd.mipLevelCount = 1;
      tvd.arrayLayerCount = 1;
      tvd.aspect = WGPUTextureAspect_All;
      backView = wgpuTextureCreateView(surfTex.texture, &tvd);
      ownsBackView = true;
    }

    WGPUCommandEncoderDescriptor encDesc = {};
    WGPUCommandEncoder enc = wgpuDeviceCreateCommandEncoder(gpu.device(), &encDesc);

    WGPURenderPassColorAttachment uiAtt = WGPU_RENDER_PASS_COLOR_ATTACHMENT_INIT;
    uiAtt.view = backView;
    uiAtt.depthSlice = WGPU_DEPTH_SLICE_UNDEFINED;
    uiAtt.loadOp = WGPULoadOp_Clear;
    uiAtt.storeOp = WGPUStoreOp_Store;
    uiAtt.clearValue = {0.03, 0.05, 0.09, 1.0};

    WGPURenderPassDescriptor uiRp = {};
    uiRp.colorAttachmentCount = 1;
    uiRp.colorAttachments = &uiAtt;

    WGPURenderPassEncoder uiPass = wgpuCommandEncoderBeginRenderPass(enc, &uiRp);
    ImGui_ImplWGPU_RenderDrawData(ImGui::GetDrawData(), uiPass);
    wgpuRenderPassEncoderEnd(uiPass);
    wgpuRenderPassEncoderRelease(uiPass);

    WGPUCommandBufferDescriptor cmdDesc = {};
    WGPUCommandBuffer cmd = wgpuCommandEncoderFinish(enc, &cmdDesc);
    wgpuQueueSubmit(gpu.queue(), 1, &cmd);
    if (!gpu.isOffscreen() && gpu.surface()) {
      wgpuSurfacePresent(gpu.surface());
    }

    wgpuCommandBufferRelease(cmd);
    wgpuCommandEncoderRelease(enc);
    if (ownsBackView && backView) wgpuTextureViewRelease(backView);
    if (surfTex.texture) wgpuTextureRelease(surfTex.texture);

    if (headlessMode) {
      ++headlessStep;
      if (headlessStep >= 4) {
        if (!gpu.saveOffscreenPng(headlessShotPath, &err)) {
          std::fprintf(stderr, "saveOffscreenPng failed: %s\n", err.c_str());
          return 1;
        }
        std::printf("[WestgateLauncher] Wrote %ux%u PNG -> %s (GPU: %s)\n",
                    gpu.width(), gpu.height(), headlessShotPath.c_str(), gpu.adapterName().c_str());
        running = false;
      }
    } else {
      std::this_thread::sleep_for(std::chrono::milliseconds(16));
    }
  }

  ImGui_ImplWGPU_Shutdown();
  if (!headlessMode) ImGui_ImplSDL3_Shutdown();
  ImGui::DestroyContext();
  gpu.shutdown();
  if (window) SDL_DestroyWindow(window);
  if (!headlessMode) SDL_Quit();
  return 0;
}
