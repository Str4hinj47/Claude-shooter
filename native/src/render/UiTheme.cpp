#include "westgate/UiTheme.hpp"
#include <algorithm>
#include <vector>

namespace westgate {

void loadWestgateUiFonts(
  ImGuiIO& io,
  const std::filesystem::path& assetsRoot,
  float dpiScale,
  UiFontSet& outFonts
) {
  const float s = std::clamp(dpiScale, 0.85f, 2.5f);
  io.Fonts->Clear();

  auto findFont = [&](const std::vector<std::filesystem::path>& relCandidates) -> std::string {
    for (const auto& c : relCandidates) {
      if (std::filesystem::exists(c)) return c.string();
    }
    return {};
  };

  const std::string sansPath = findFont({
    assetsRoot / "fonts" / "Roboto-Medium.ttf",
    std::filesystem::current_path() / "assets" / "fonts" / "Roboto-Medium.ttf",
    std::filesystem::current_path() / "native" / "build" / "_deps" / "imgui-src" / "misc" / "fonts" / "Roboto-Medium.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
  });

  const std::string monoPath = findFont({
    assetsRoot / "fonts" / "Cousine-Regular.ttf",
    std::filesystem::current_path() / "assets" / "fonts" / "Cousine-Regular.ttf",
    std::filesystem::current_path() / "native" / "build" / "_deps" / "imgui-src" / "misc" / "fonts" / "Cousine-Regular.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf",
  });

  ImFontConfig cfg{};
  cfg.OversampleH = 3;
  cfg.OversampleV = 2;

  if (!sansPath.empty()) {
    outFonts.body    = io.Fonts->AddFontFromFileTTF(sansPath.c_str(), 15.5f * s, &cfg);
    outFonts.heading = io.Fonts->AddFontFromFileTTF(sansPath.c_str(), 21.0f * s, &cfg);
    outFonts.title   = io.Fonts->AddFontFromFileTTF(sansPath.c_str(), 38.0f * s, &cfg);
  }
  if (!monoPath.empty()) {
    outFonts.mono    = io.Fonts->AddFontFromFileTTF(monoPath.c_str(), 14.5f * s, &cfg);
  }

  if (!outFonts.body) {
    outFonts.body = io.Fonts->AddFontDefault();
  }
  if (!outFonts.heading) outFonts.heading = outFonts.body;
  if (!outFonts.title)   outFonts.title   = outFonts.heading;
  if (!outFonts.mono)    outFonts.mono    = outFonts.body;

  io.FontDefault = outFonts.body;
}

void applyWestgateAaaTheme(float dpiScale) {
  ImGuiStyle& st = ImGui::GetStyle();
  st = ImGuiStyle();
  ImGui::StyleColorsDark(&st);

  st.WindowPadding     = ImVec2(16.0f, 14.0f);
  st.FramePadding      = ImVec2(11.0f, 6.5f);
  st.ItemSpacing       = ImVec2(9.0f, 7.5f);
  st.ItemInnerSpacing  = ImVec2(7.0f, 5.0f);
  st.ScrollbarSize     = 11.0f;
  st.GrabMinSize       = 11.0f;

  st.WindowBorderSize  = 1.0f;
  st.ChildBorderSize   = 1.0f;
  st.PopupBorderSize   = 1.0f;
  st.FrameBorderSize   = 0.0f;
  st.TabBorderSize     = 0.0f;

  st.WindowRounding    = 4.0f;
  st.ChildRounding     = 4.0f;
  st.FrameRounding     = 3.0f;
  st.PopupRounding     = 4.0f;
  st.ScrollbarRounding = 4.0f;
  st.GrabRounding      = 2.0f;
  st.TabRounding       = 3.0f;

  ImVec4* c = st.Colors;
  c[ImGuiCol_Text]                  = ImVec4(0.94f, 0.96f, 0.99f, 1.00f);
  c[ImGuiCol_TextDisabled]          = ImVec4(0.54f, 0.60f, 0.69f, 1.00f);
  c[ImGuiCol_WindowBg]              = ImVec4(0.045f, 0.056f, 0.078f, 0.94f);
  c[ImGuiCol_ChildBg]               = ImVec4(0.062f, 0.078f, 0.106f, 0.80f);
  c[ImGuiCol_PopupBg]               = ImVec4(0.050f, 0.062f, 0.086f, 0.97f);
  c[ImGuiCol_Border]                = ImVec4(0.20f, 0.30f, 0.42f, 0.55f);
  c[ImGuiCol_BorderShadow]          = ImVec4(0.00f, 0.00f, 0.00f, 0.00f);
  c[ImGuiCol_FrameBg]               = ImVec4(0.10f, 0.13f, 0.18f, 0.92f);
  c[ImGuiCol_FrameBgHovered]        = ImVec4(0.15f, 0.21f, 0.29f, 0.96f);
  c[ImGuiCol_FrameBgActive]         = ImVec4(0.19f, 0.28f, 0.38f, 1.00f);
  c[ImGuiCol_TitleBg]               = ImVec4(0.05f, 0.07f, 0.10f, 1.00f);
  c[ImGuiCol_TitleBgActive]         = ImVec4(0.07f, 0.11f, 0.16f, 1.00f);
  c[ImGuiCol_MenuBarBg]             = ImVec4(0.06f, 0.08f, 0.11f, 1.00f);
  c[ImGuiCol_ScrollbarBg]           = ImVec4(0.04f, 0.05f, 0.07f, 0.65f);
  c[ImGuiCol_ScrollbarGrab]         = ImVec4(0.24f, 0.34f, 0.46f, 0.85f);
  c[ImGuiCol_ScrollbarGrabHovered]  = ImVec4(0.32f, 0.46f, 0.62f, 0.95f);
  c[ImGuiCol_ScrollbarGrabActive]   = ImVec4(0.22f, 0.72f, 0.92f, 1.00f);
  c[ImGuiCol_CheckMark]             = ImVec4(0.24f, 0.86f, 0.98f, 1.00f);
  c[ImGuiCol_SliderGrab]            = ImVec4(0.22f, 0.78f, 0.94f, 0.95f);
  c[ImGuiCol_SliderGrabActive]      = ImVec4(0.96f, 0.78f, 0.28f, 1.00f);
  c[ImGuiCol_Button]                = ImVec4(0.11f, 0.16f, 0.23f, 0.94f);
  c[ImGuiCol_ButtonHovered]         = ImVec4(0.17f, 0.34f, 0.49f, 0.98f);
  c[ImGuiCol_ButtonActive]          = ImVec4(0.22f, 0.52f, 0.74f, 1.00f);
  c[ImGuiCol_Header]                = ImVec4(0.13f, 0.22f, 0.32f, 0.90f);
  c[ImGuiCol_HeaderHovered]         = ImVec4(0.18f, 0.34f, 0.48f, 0.95f);
  c[ImGuiCol_HeaderActive]          = ImVec4(0.22f, 0.46f, 0.64f, 1.00f);
  c[ImGuiCol_Separator]             = ImVec4(0.22f, 0.32f, 0.44f, 0.50f);
  c[ImGuiCol_Tab]                   = ImVec4(0.09f, 0.13f, 0.19f, 0.92f);
  c[ImGuiCol_TabHovered]            = ImVec4(0.18f, 0.36f, 0.52f, 0.98f);
  c[ImGuiCol_TabSelected]           = ImVec4(0.16f, 0.44f, 0.64f, 1.00f);
  c[ImGuiCol_PlotHistogram]         = ImVec4(0.22f, 0.82f, 0.96f, 0.95f);

  if (dpiScale != 1.0f) {
    st.ScaleAllSizes(std::clamp(dpiScale, 0.85f, 2.5f));
  }
}

} // namespace westgate
