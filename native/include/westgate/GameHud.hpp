#pragma once
#include "westgate/AudioEngine.hpp"
#include "westgate/GameSession.hpp"
#include "westgate/GameSettings.hpp"
#include "westgate/PhysicsWorld.hpp"
#include "westgate/PlayerController.hpp"
#include "westgate/UiTheme.hpp"
#include "westgate/WgpuContext.hpp"
#include "westgate/WorldData.hpp"
#include "westgate/WorldRenderer.hpp"
#include <string>

namespace westgate {

enum class AppScreen : uint8_t {
  MainMenu = 0,
  InGame = 1,
  Paused = 2,
};

struct HudUiState {
  AppScreen screen = AppScreen::MainMenu;
  bool showSettings = false;
  int settingsTab = 0; // 0=Display, 1=Graphics, 2=Controls, 3=Audio, 4=Keybindings
  bool gunsmithReturnToMenu = false;

  bool devMode = false;       // Strictly opt-in (--dev); shipping AAA client has zero debug chrome
  bool showTelemetry = false; // Off by default
  bool showPhone = false;
  bool mouseCaptured = false;
  int forcePhoneTab = -1;

  // Save metadata displayed on Main Menu "CONTINUE OPERATION" blade
  bool saveFileExists = false;
  int savedStoryStep = 0;
  int savedCredits = 0;
  std::string saveStatusBanner;
  float saveStatusTimer = 0.0f;

  // One-shot requests handled cleanly by main client loop
  bool requestQuitApp = false;
  bool requestApplySettings = false;
  bool requestEngageMouseCapture = false;
  bool requestNewCampaign = false;
  bool requestLoadSave = false;

  std::string savePath = "westgate_save.json";
  std::string settingsPath = "westgate_settings.json";
  UiFontSet fonts{};
};

void drawWestgateHud(
  HudUiState& ui,
  GameSettings& settings,
  GameSession& session,
  PlayerController& player,
  const PhysicsWorld& physics,
  const WorldData& world,
  const WgpuContext& gpu,
  const RenderTelemetry& telemetry,
  AudioEngine* audio,
  float fps,
  float elapsedSec
);

} // namespace westgate
