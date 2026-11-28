#include "westgate/GameSettings.hpp"
#include <algorithm>
#include <fstream>
#include <nlohmann/json.hpp>

namespace westgate {

void GameSettings::applyGraphicsPreset(GraphicsPreset preset) {
  graphicsPreset = preset;
  switch (preset) {
    case GraphicsPreset::Low:
      drawDistanceScale = 0.70f;
      ssaoStrength = 0.0f;
      bloomIntensity = 0.14f;
      break;
    case GraphicsPreset::Medium:
      drawDistanceScale = 0.88f;
      ssaoStrength = 0.45f;
      bloomIntensity = 0.26f;
      break;
    case GraphicsPreset::High:
      drawDistanceScale = 1.00f;
      ssaoStrength = 0.72f;
      bloomIntensity = 0.34f;
      break;
    case GraphicsPreset::Ultra:
      drawDistanceScale = 1.32f;
      ssaoStrength = 0.96f;
      bloomIntensity = 0.44f;
      break;
    case GraphicsPreset::Custom:
      break;
  }
  clampValid();
}

void GameSettings::clampValid() {
  resolutionWidth = std::clamp(resolutionWidth, 960, 7680);
  resolutionHeight = std::clamp(resolutionHeight, 540, 4320);
  if (frameRateLimit != 0 && frameRateLimit < 30) frameRateLimit = 30;
  if (frameRateLimit > 500) frameRateLimit = 500;
  fieldOfViewDeg = std::clamp(fieldOfViewDeg, 65.0f, 105.0f);
  drawDistanceScale = std::clamp(drawDistanceScale, 0.65f, 1.40f);
  ssaoStrength = std::clamp(ssaoStrength, 0.0f, 1.30f);
  bloomIntensity = std::clamp(bloomIntensity, 0.0f, 1.00f);
  mouseSensitivity = std::clamp(mouseSensitivity, 0.20f, 3.00f);
  adsSensitivityMult = std::clamp(adsSensitivityMult, 0.25f, 1.20f);
  masterVolume = std::clamp(masterVolume, 0.0f, 1.0f);
  sfxVolume = std::clamp(sfxVolume, 0.0f, 1.0f);
  voiceVolume = std::clamp(voiceVolume, 0.0f, 1.0f);
  musicVolume = std::clamp(musicVolume, 0.0f, 1.0f);
}

const char* GameSettings::windowModeLabel(WindowDisplayMode mode) {
  switch (mode) {
    case WindowDisplayMode::BorderlessFullscreen: return "Borderless Fullscreen";
    case WindowDisplayMode::Windowed:             return "Windowed";
    case WindowDisplayMode::ExclusiveFullscreen:  return "Fullscreen";
  }
  return "Windowed";
}

const char* GameSettings::graphicsPresetLabel(GraphicsPreset preset) {
  switch (preset) {
    case GraphicsPreset::Low:    return "Low";
    case GraphicsPreset::Medium: return "Medium";
    case GraphicsPreset::High:   return "High";
    case GraphicsPreset::Ultra:  return "Ultra";
    case GraphicsPreset::Custom: return "Custom";
  }
  return "High";
}

bool GameSettings::saveToFile(const std::string& path) const {
  try {
    nlohmann::json j;
    j["version"] = 1;
    j["windowMode"] = static_cast<int>(windowMode);
    j["resolutionWidth"] = resolutionWidth;
    j["resolutionHeight"] = resolutionHeight;
    j["vsync"] = vsync;
    j["frameRateLimit"] = frameRateLimit;
    j["showFpsCounter"] = showFpsCounter;
    j["graphicsPreset"] = static_cast<int>(graphicsPreset);
    j["fieldOfViewDeg"] = fieldOfViewDeg;
    j["drawDistanceScale"] = drawDistanceScale;
    j["ssaoStrength"] = ssaoStrength;
    j["bloomIntensity"] = bloomIntensity;
    j["mouseSensitivity"] = mouseSensitivity;
    j["adsSensitivityMult"] = adsSensitivityMult;
    j["invertMouseY"] = invertMouseY;
    j["defaultFirstPerson"] = defaultFirstPerson;
    j["showSubtitles"] = showSubtitles;
    j["masterVolume"] = masterVolume;
    j["sfxVolume"] = sfxVolume;
    j["voiceVolume"] = voiceVolume;
    j["musicVolume"] = musicVolume;

    std::ofstream out(path, std::ios::trunc);
    if (!out.is_open()) return false;
    out << j.dump(2) << "\n";
    return out.good();
  } catch (...) {
    return false;
  }
}

bool GameSettings::loadFromFile(const std::string& path) {
  try {
    std::ifstream in(path);
    if (!in.is_open()) return false;
    nlohmann::json j;
    in >> j;

    if (j.contains("windowMode")) {
      windowMode = static_cast<WindowDisplayMode>(std::clamp(j["windowMode"].get<int>(), 0, 2));
    }
    if (j.contains("resolutionWidth")) resolutionWidth = j["resolutionWidth"].get<int>();
    if (j.contains("resolutionHeight")) resolutionHeight = j["resolutionHeight"].get<int>();
    if (j.contains("vsync")) vsync = j["vsync"].get<bool>();
    if (j.contains("frameRateLimit")) frameRateLimit = j["frameRateLimit"].get<int>();
    if (j.contains("showFpsCounter")) showFpsCounter = j["showFpsCounter"].get<bool>();
    if (j.contains("graphicsPreset")) {
      graphicsPreset = static_cast<GraphicsPreset>(std::clamp(j["graphicsPreset"].get<int>(), 0, 4));
    }
    if (j.contains("fieldOfViewDeg")) fieldOfViewDeg = j["fieldOfViewDeg"].get<float>();
    if (j.contains("drawDistanceScale")) drawDistanceScale = j["drawDistanceScale"].get<float>();
    if (j.contains("ssaoStrength")) ssaoStrength = j["ssaoStrength"].get<float>();
    if (j.contains("bloomIntensity")) bloomIntensity = j["bloomIntensity"].get<float>();
    if (j.contains("mouseSensitivity")) mouseSensitivity = j["mouseSensitivity"].get<float>();
    if (j.contains("adsSensitivityMult")) adsSensitivityMult = j["adsSensitivityMult"].get<float>();
    if (j.contains("invertMouseY")) invertMouseY = j["invertMouseY"].get<bool>();
    if (j.contains("defaultFirstPerson")) defaultFirstPerson = j["defaultFirstPerson"].get<bool>();
    if (j.contains("showSubtitles")) showSubtitles = j["showSubtitles"].get<bool>();
    if (j.contains("masterVolume")) masterVolume = j["masterVolume"].get<float>();
    if (j.contains("sfxVolume")) sfxVolume = j["sfxVolume"].get<float>();
    if (j.contains("voiceVolume")) voiceVolume = j["voiceVolume"].get<float>();
    if (j.contains("musicVolume")) musicVolume = j["musicVolume"].get<float>();

    clampValid();
    return true;
  } catch (...) {
    return false;
  }
}

} // namespace westgate
