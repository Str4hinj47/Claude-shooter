#pragma once

#include <cstdint>
#include <string>

namespace westgate {

enum class WindowDisplayMode : uint8_t {
  BorderlessFullscreen = 0,
  Windowed = 1,
  ExclusiveFullscreen = 2,
};

enum class GraphicsPreset : uint8_t {
  Low = 0,
  Medium = 1,
  High = 2,
  Ultra = 3,
  Custom = 4,
};

struct GameSettings {
  // Display
  WindowDisplayMode windowMode = WindowDisplayMode::Windowed;
  int resolutionWidth = 1600;
  int resolutionHeight = 900;
  bool vsync = true;
  int frameRateLimit = 0; // 0 = Uncapped, or 60 / 120 / 144 / 240
  bool showFpsCounter = false;

  // Graphics & Post-FX
  GraphicsPreset graphicsPreset = GraphicsPreset::High;
  float fieldOfViewDeg = 75.0f;    // 65..105
  float drawDistanceScale = 1.0f;  // 0.65..1.40
  float ssaoStrength = 0.72f;      // 0.0..1.30
  float bloomIntensity = 0.34f;    // 0.0..1.00

  // Controls & Camera
  float mouseSensitivity = 1.0f;   // 0.20..3.00
  float adsSensitivityMult = 0.72f;// 0.25..1.20
  bool invertMouseY = false;
  bool defaultFirstPerson = false;
  bool showSubtitles = true;

  // Audio Mixer (0.0 .. 1.0)
  float masterVolume = 0.90f;
  float sfxVolume = 0.90f;
  float voiceVolume = 1.00f;
  float musicVolume = 0.70f;

  void applyGraphicsPreset(GraphicsPreset preset);
  void clampValid();

  bool saveToFile(const std::string& path) const;
  bool loadFromFile(const std::string& path);

  static const char* windowModeLabel(WindowDisplayMode mode);
  static const char* graphicsPresetLabel(GraphicsPreset preset);
};

} // namespace westgate
