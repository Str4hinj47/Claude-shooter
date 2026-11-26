#pragma once
#include "westgate/AudioEngine.hpp"
#include "westgate/GameSession.hpp"
#include "westgate/PhysicsWorld.hpp"
#include "westgate/PlayerController.hpp"
#include "westgate/WgpuContext.hpp"
#include "westgate/WorldData.hpp"
#include "westgate/WorldRenderer.hpp"
#include <string>

namespace westgate {

struct HudUiState {
  bool showTelemetry = true;
  bool showPhone = false;
  bool mouseCaptured = false;
  std::string savePath = "westgate_save.json";
};

void drawWestgateHud(
  HudUiState& ui,
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
