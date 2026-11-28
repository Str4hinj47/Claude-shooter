#pragma once

#include "imgui.h"
#include <filesystem>

namespace westgate {

struct UiFontSet {
  ImFont* body = nullptr;    // Anti-aliased UI Sans 15.5px
  ImFont* mono = nullptr;    // Tactical Monospace 14.5px
  ImFont* heading = nullptr; // Bold Section/Blade Header 21px
  ImFont* title = nullptr;   // Large Display Title 38px
};

/**
 * Load crisp anti-aliased TrueType UI fonts (Roboto-Medium + Cousine-Regular)
 * with graceful fallback if font files are absent.
 */
void loadWestgateUiFonts(
  ImGuiIO& io,
  const std::filesystem::path& assetsRoot,
  float dpiScale,
  UiFontSet& outFonts
);

/**
 * Apply dark-obsidian, brushed-slate & tactical cyan/gold AAA client styling
 * (replaces Dear ImGui's default programmer-blue debug theme).
 */
void applyWestgateAaaTheme(float dpiScale = 1.0f);

} // namespace westgate
