#include "westgate/PhoneOs.hpp"
#include "imgui.h"
#include <algorithm>
#include <cmath>
#include <cstdio>
#include <string>

namespace westgate {

namespace {

const char* shortDistrictForPhone(const glm::vec3& p, const WorldData& world) {
  if (glm::distance(glm::vec2(p.x, p.z), glm::vec2(world.fightPitPos.x, world.fightPitPos.z)) < 65.0f) {
    return "Iron Pit";
  }
  if (p.y > 220.0f) return "Sky-Suite";
  if (p.x < -520.0f) return "Del Sol Beach";
  if (p.z > 240.0f) return "Mirror Park";
  if (p.z < -220.0f) return "Downtown Bay";
  if (p.x > 260.0f) return "Eastgate Port";
  if (std::abs(p.x) < 190.0f && std::abs(p.z) < 190.0f) return "Civic Plaza";
  return "Westgate Bay";
}

int computeCelsiusTemp(float todHours, const std::string& weatherLbl) {
  const float dayWave = std::sin(((todHours - 8.0f) / 24.0f) * 6.2831853f);
  int base = static_cast<int>(std::round(27.0f + dayWave * 5.0f));
  if (weatherLbl.find("Storm") != std::string::npos) base -= 7;
  else if (weatherLbl.find("Rain") != std::string::npos) base -= 5;
  else if (weatherLbl.find("Overcast") != std::string::npos) base -= 2;
  return std::clamp(base, 16, 34);
}

std::string formatUsd(int amount) {
  const bool neg = amount < 0;
  int v = std::abs(amount);
  std::string digits = std::to_string(v);
  std::string out;
  int cnt = 0;
  for (int i = static_cast<int>(digits.size()) - 1; i >= 0; --i) {
    if (cnt > 0 && (cnt % 3) == 0) out.push_back(',');
    out.push_back(digits[static_cast<size_t>(i)]);
    ++cnt;
  }
  std::reverse(out.begin(), out.end());
  return (neg ? "-$" : "$") + out;
}

// Draw the iconic white iFruit fruit-bowl emblem (half bowl + two fruit domes + curved leaf)
void drawIFruitBowlGlyph(ImDrawList* dl, ImVec2 center, float radius, ImU32 col) {
  // Lower half-circle bowl
  constexpr int kSeg = 14;
  ImVec2 bowlPts[kSeg + 1];
  for (int i = 0; i <= kSeg; ++i) {
    const float a = 3.14159265f * (static_cast<float>(i) / static_cast<float>(kSeg)); // 0..pi (bottom arc)
    bowlPts[i] = {center.x + std::cos(a) * radius, center.y + 0.06f * radius + std::sin(a) * (radius * 0.86f)};
  }
  dl->AddConvexPolyFilled(bowlPts, kSeg + 1, col);

  // Two fruit domes above the bowl rim (with a crisp gap line)
  const float domeY = center.y - radius * 0.14f;
  dl->PathArcTo({center.x - radius * 0.34f, domeY}, radius * 0.42f, 3.14159265f, 6.2831853f, 10);
  dl->PathFillConvex(col);
  dl->PathArcTo({center.x + radius * 0.36f, domeY + radius * 0.04f}, radius * 0.36f, 3.14159265f, 6.2831853f, 10);
  dl->PathFillConvex(col);

  // Top curved leaf
  const ImVec2 l0(center.x - radius * 0.08f, center.y - radius * 0.68f);
  const ImVec2 l1(center.x + radius * 0.25f, center.y - radius * 0.98f);
  const ImVec2 l2(center.x + radius * 0.56f, center.y - radius * 0.84f);
  dl->AddBezierQuadratic(l0, l1, l2, col, std::max(1.4f, radius * 0.22f), 8);
}

// Helper for crisp rounded squircle gradient tile (pure rounded rects so corners never square-bleed)
void drawSquircleTile(ImDrawList* dl, ImVec2 p0, ImVec2 p1, float rounding, ImU32 topCol, ImU32 botCol, bool hovered) {
  // Subtle drop shadow
  dl->AddRectFilled({p0.x + 1.5f, p0.y + 3.0f}, {p1.x + 1.5f, p1.y + 3.5f}, IM_COL32(18, 12, 24, 58), rounding);
  dl->AddRectFilled(p0, p1, topCol, rounding);
  // Smooth lower-half tint band with rounded bottom corners
  const float midY = p0.y + (p1.y - p0.y) * 0.46f;
  const ImU32 botBlend = (botCol & 0x00FFFFFFu) | (168u << 24);
  dl->AddRectFilled({p0.x, midY}, p1, botBlend, rounding, ImDrawFlags_RoundCornersBottom);
  dl->AddRect(p0, p1, hovered ? IM_COL32(255, 255, 255, 235) : IM_COL32(255, 255, 255, 64), rounding, 0, hovered ? 2.0f : 1.0f);
}

void drawSunOrMoonIcon(ImDrawList* dl, ImVec2 c, float r, float todHours, const std::string& wx) {
  const bool night = (todHours < 6.0f || todHours >= 19.5f);
  if (wx.find("Rain") != std::string::npos || wx.find("Storm") != std::string::npos) {
    // Cloud + rain streaks
    dl->AddCircleFilled({c.x - r * 0.35f, c.y}, r * 0.48f, IM_COL32(238, 246, 255, 245));
    dl->AddCircleFilled({c.x + r * 0.22f, c.y - r * 0.14f}, r * 0.56f, IM_COL32(246, 250, 255, 250));
    dl->AddRectFilled({c.x - r * 0.55f, c.y}, {c.x + r * 0.58f, c.y + r * 0.44f}, IM_COL32(238, 246, 255, 245), 4.0f);
    for (int i = -1; i <= 1; ++i) {
      dl->AddLine({c.x + i * r * 0.36f, c.y + r * 0.56f},
                  {c.x + i * r * 0.36f - 2.5f, c.y + r * 0.96f},
                  IM_COL32(145, 228, 255, 245), 1.8f);
    }
    return;
  }
  if (night) {
    dl->AddCircleFilled(c, r * 0.68f, IM_COL32(255, 236, 150, 250), 20);
    dl->AddCircleFilled({c.x + r * 0.28f, c.y - r * 0.20f}, r * 0.58f, IM_COL32(12, 142, 232, 255), 20);
    return;
  }
  // Golden Sun with 8 crisp rays (matching image-1.png!)
  const ImU32 sunCol = IM_COL32(255, 224, 52, 255);
  dl->AddCircleFilled(c, r * 0.58f, sunCol, 22);
  for (int i = 0; i < 8; ++i) {
    const float a = static_cast<float>(i) * (6.2831853f / 8.0f);
    const ImVec2 a0(c.x + std::cos(a) * r * 0.74f, c.y + std::sin(a) * r * 0.74f);
    const ImVec2 a1(c.x + std::cos(a) * r * 1.04f, c.y + std::sin(a) * r * 1.04f);
    dl->AddLine(a0, a1, sunCol, 1.8f);
  }
}

std::string liveBreakingHeadline(const GameSession& session) {
  if (session.wantedStars() > 0) {
    return "WSPD Task Force pursues armed suspect (" + std::to_string(session.wantedStars()) + "-Star APB)";
  }
  if (session.activeMission().active) {
    return "Tactical lockdown reported near " + session.activeMission().title;
  }
  if (session.activeSurveillance().active) {
    return "Federal customs probes offshore wire trails in Eastgate";
  }
  if (session.storyStep() >= 6) {
    return "Apex Tower shares plunge amid Vanguard ledger leaks";
  }
  return "Armored convoy & high-speed pursuit spotted on Bay Fwy";
}

bool drawAppTopHeader(
  ImDrawList* dl,
  ImVec2 screenTl,
  float screenW,
  const char* appTitle,
  ImU32 titleCol,
  ImFont* fBody,
  ImFont* fHead,
  bool darkTheme
) {
  const ImVec2 backMin(screenTl.x + 10.0f, screenTl.y + 38.0f);
  const ImVec2 backMax(screenTl.x + 84.0f, screenTl.y + 66.0f);
  ImGui::SetCursorScreenPos(backMin);
  const bool backClicked = ImGui::InvisibleButton("##PhoneAppBackBtn", {backMax.x - backMin.x, backMax.y - backMin.y});
  const bool backHov = ImGui::IsItemHovered();

  const ImU32 chevCol = backHov ? IM_COL32(56, 189, 248, 255)
                                : (darkTheme ? IM_COL32(125, 211, 252, 245) : IM_COL32(14, 116, 224, 255));
  dl->AddLine({backMin.x + 12.0f, backMin.y + 9.0f},  {backMin.x + 5.0f, backMin.y + 14.0f}, chevCol, 2.0f);
  dl->AddLine({backMin.x + 5.0f,  backMin.y + 14.0f}, {backMin.x + 12.0f, backMin.y + 19.0f}, chevCol, 2.0f);
  dl->AddText(fBody, 14.5f, {backMin.x + 17.0f, backMin.y + 6.5f}, chevCol, "Home");

  const ImVec2 ts = fHead->CalcTextSizeA(17.5f, 220.0f, 0.0f, appTitle);
  dl->AddText(fHead, 17.5f, {screenTl.x + (screenW - ts.x) * 0.5f, screenTl.y + 43.0f}, titleCol, appTitle);
  dl->AddLine({screenTl.x + 12.0f, screenTl.y + 70.0f},
              {screenTl.x + screenW - 12.0f, screenTl.y + 70.0f},
              darkTheme ? IM_COL32(255, 255, 255, 28) : IM_COL32(15, 23, 42, 26), 1.0f);
  return backClicked;
}

} // namespace

void updateAndDrawPhoneOs(
  PhoneOsState& phone,
  bool& ioPhoneOpen,
  const UiFontSet& fonts,
  GameSession& session,
  PlayerController& player,
  const WorldData& world,
  AudioEngine* audio,
  const std::string& savePath,
  float dt,
  float elapsedSec,
  bool instantSlide
) {
  if (phone.shutterFlash > 0.0f) {
    phone.shutterFlash = std::max(0.0f, phone.shutterFlash - dt * 2.8f);
  }

  const float targetSlide = ioPhoneOpen ? 1.0f : 0.0f;
  if (instantSlide) {
    phone.slideProgress = targetSlide;
  } else {
    const float speed = ioPhoneOpen ? 10.5f : 12.0f;
    phone.slideProgress += (targetSlide - phone.slideProgress) * std::min(1.0f, dt * speed);
    if (std::abs(phone.slideProgress - targetSlide) < 0.004f) {
      phone.slideProgress = targetSlide;
    }
  }

  if (phone.slideProgress <= 0.005f && !ioPhoneOpen) {
    phone.activeApp = PhoneAppId::Home;
    return;
  }

  const ImGuiViewport* vp = ImGui::GetMainViewport();
  const ImVec2 disp = vp->Size;

  // Smooth cubic ease-out popup trajectory (screen-space only — zero 3D hand prop)
  const float t = std::clamp(phone.slideProgress, 0.0f, 1.0f);
  const float ease = 1.0f - (1.0f - t) * (1.0f - t) * (1.0f - t);

  const float phoneW = 352.0f;
  const float phoneH = std::min(676.0f, disp.y - 24.0f);
  const float baseX = disp.x - phoneW - 24.0f;
  const float openY = disp.y - phoneH - 14.0f;
  const float closedY = disp.y + 28.0f;
  const float curY = closedY + (openY - closedY) * ease;

  const ImVec2 chassisTl(baseX, curY);
  const ImVec2 chassisBr(baseX + phoneW, curY + phoneH);
  const float pad = 9.0f;
  const ImVec2 scrTl(chassisTl.x + pad, chassisTl.y + pad);
  const ImVec2 scrBr(chassisBr.x - pad, chassisBr.y - pad);
  const float scrW = scrBr.x - scrTl.x;
  const float scrH = scrBr.y - scrTl.y;

  ImFont* fBody = fonts.body ? fonts.body : ImGui::GetFont();
  ImFont* fMono = fonts.mono ? fonts.mono : fBody;
  ImFont* fHead = fonts.heading ? fonts.heading : fBody;
  ImFont* fTitle = fonts.title ? fonts.title : fHead;

  // Invisible frameless host window capturing clicks strictly inside the phone bezel
  ImGui::SetNextWindowPos(chassisTl, ImGuiCond_Always);
  ImGui::SetNextWindowSize({phoneW, phoneH}, ImGuiCond_Always);
  ImGui::PushStyleVar(ImGuiStyleVar_WindowPadding, ImVec2(0.0f, 0.0f));
  ImGui::PushStyleVar(ImGuiStyleVar_WindowBorderSize, 0.0f);
  ImGui::Begin("##PearOsPhonePopup", nullptr,
               ImGuiWindowFlags_NoTitleBar | ImGuiWindowFlags_NoResize | ImGuiWindowFlags_NoMove |
               ImGuiWindowFlags_NoBackground | ImGuiWindowFlags_NoScrollbar | ImGuiWindowFlags_NoScrollWithMouse |
               ImGuiWindowFlags_NoSavedSettings);

  ImDrawList* dl = ImGui::GetWindowDrawList();

  // =========================================================================
  // 1. Metallic Brushed-Titanium iFruit 15iX Chassis & Side Hardware Buttons
  // =========================================================================
  // Ambient drop shadow behind popup phone
  dl->AddRectFilled({chassisTl.x - 5.0f, chassisTl.y + 8.0f}, {chassisBr.x + 7.0f, chassisBr.y + 10.0f},
                    IM_COL32(3, 6, 12, 138), 50.0f);
  // Side hardware buttons (left action + volume rockers, right power button)
  dl->AddRectFilled({chassisTl.x - 2.5f, chassisTl.y + 118.0f}, {chassisTl.x + 1.0f, chassisTl.y + 144.0f}, IM_COL32(78, 84, 96, 255), 2.0f);
  dl->AddRectFilled({chassisTl.x - 2.5f, chassisTl.y + 162.0f}, {chassisTl.x + 1.0f, chassisTl.y + 206.0f}, IM_COL32(78, 84, 96, 255), 2.0f);
  dl->AddRectFilled({chassisTl.x - 2.5f, chassisTl.y + 216.0f}, {chassisTl.x + 1.0f, chassisTl.y + 260.0f}, IM_COL32(78, 84, 96, 255), 2.0f);
  dl->AddRectFilled({chassisBr.x - 1.0f, chassisTl.y + 180.0f}, {chassisBr.x + 2.5f, chassisTl.y + 242.0f}, IM_COL32(78, 84, 96, 255), 2.0f);

  // Outer titanium rim + inner obsidian OLED bezel
  dl->AddRectFilled(chassisTl, chassisBr, IM_COL32(42, 46, 54, 255), 46.0f);
  dl->AddRect(chassisTl, chassisBr, IM_COL32(168, 178, 196, 185), 46.0f, 0, 1.8f);
  dl->AddRectFilled({chassisTl.x + 2.5f, chassisTl.y + 2.5f}, {chassisBr.x - 2.5f, chassisBr.y - 2.5f},
                    IM_COL32(8, 10, 14, 255), 44.0f);

  // =========================================================================
  // 2. Display Wallpaper / App Surface (Clipped to OLED Display Bounds)
  // =========================================================================
  dl->PushClipRect(scrTl, scrBr, true);

  const bool isHome = (phone.activeApp == PhoneAppId::Home);
  const bool isSnapCam = (phone.activeApp == PhoneAppId::SnapCam);
  const bool darkAppTheme = (phone.activeApp == PhoneAppId::BlackNet ||
                             phone.activeApp == PhoneAppId::Motorsports ||
                             phone.activeApp == PhoneAppId::FruitPay ||
                             phone.activeApp == PhoneAppId::WeatherView ||
                             isSnapCam);

  if (isSnapCam) {
    // Semi-transparent live camera viewfinder letting the 3D WebGPU open world shine through!
    dl->AddRectFilled(scrTl, scrBr, IM_COL32(6, 10, 16, 48), 38.0f);
  } else if (isHome) {
    // Signature PearOS 15 Twilight-Blue -> Lavender -> Coral -> Warm-Peach Gradient (matching image-1.png!)
    const float y1 = scrTl.y + scrH * 0.34f;
    const float y2 = scrTl.y + scrH * 0.68f;
    dl->AddRectFilled(scrTl, scrBr, IM_COL32(86, 122, 182, 255), 38.0f);
    dl->AddRectFilledMultiColor(
      scrTl, {scrBr.x, y1},
      IM_COL32(78, 118, 182, 255), IM_COL32(94, 116, 178, 255),
      IM_COL32(158, 116, 178, 255), IM_COL32(146, 118, 182, 255)
    );
    dl->AddRectFilledMultiColor(
      {scrTl.x, y1}, {scrBr.x, y2},
      IM_COL32(146, 118, 182, 255), IM_COL32(158, 116, 178, 255),
      IM_COL32(238, 146, 134, 255), IM_COL32(232, 138, 132, 255)
    );
    dl->AddRectFilledMultiColor(
      {scrTl.x, y2}, scrBr,
      IM_COL32(232, 138, 132, 255), IM_COL32(238, 146, 134, 255),
      IM_COL32(253, 214, 176, 255), IM_COL32(252, 208, 168, 255)
    );
    // Subtle diagonal glass highlight bands
    const ImVec2 g0(scrTl.x - 20.0f, scrTl.y + 190.0f);
    const ImVec2 g1(scrBr.x + 20.0f, scrTl.y + 85.0f);
    const ImVec2 g2(scrBr.x + 20.0f, scrTl.y + 150.0f);
    const ImVec2 g3(scrTl.x - 20.0f, scrTl.y + 255.0f);
    const ImVec2 sheenPts[4] = {g0, g1, g2, g3};
    dl->AddConvexPolyFilled(sheenPts, 4, IM_COL32(255, 255, 255, 16));
  } else if (phone.activeApp == PhoneAppId::WeatherView) {
    dl->AddRectFilledMultiColor(
      scrTl, scrBr,
      IM_COL32(8, 128, 224, 255), IM_COL32(16, 168, 246, 255),
      IM_COL32(18, 92, 178, 255), IM_COL32(10, 58, 128, 255)
    );
  } else if (darkAppTheme) {
    dl->AddRectFilledMultiColor(
      scrTl, scrBr,
      IM_COL32(13, 16, 24, 252), IM_COL32(16, 20, 30, 252),
      IM_COL32(10, 12, 18, 254), IM_COL32(9, 11, 16, 254)
    );
  } else {
    dl->AddRectFilled(scrTl, scrBr, IM_COL32(244, 246, 251, 255), 38.0f);
  }

  // =========================================================================
  // 3. Top Status Bar: Clock + Signal Bars + Dynamic Island (w/ iFruit Logo) + Green Battery Pill
  // =========================================================================
  {
    const std::string clk = session.currentClockString();
    const ImU32 stCol = (isHome || darkAppTheme) ? IM_COL32(255, 255, 255, 248) : IM_COL32(18, 24, 36, 245);
    dl->AddText(fBody, 14.5f, {scrTl.x + 18.0f, scrTl.y + 11.0f}, stCol, clk.c_str());

    // 4 ascending cellular signal bars right beside clock
    const float sigX = scrTl.x + 60.0f;
    const float sigBot = scrTl.y + 24.0f;
    for (int bi = 0; bi < 4; ++bi) {
      const float bh = 4.5f + bi * 2.4f;
      dl->AddRectFilled({sigX + bi * 4.2f, sigBot - bh}, {sigX + bi * 4.2f + 2.6f, sigBot},
                        IM_COL32(118, 238, 198, 235), 1.0f);
    }

    // Center Black Dynamic Island Pill with Front Camera Lens + White iFruit Bowl Emblem
    const float diW = 136.0f;
    const float diH = 25.0f;
    const ImVec2 diTl(scrTl.x + (scrW - diW) * 0.5f, scrTl.y + 7.5f);
    const ImVec2 diBr(diTl.x + diW, diTl.y + diH);
    dl->AddRectFilled(diTl, diBr, IM_COL32(5, 6, 9, 255), diH * 0.5f);
    // Front camera lens ring on left of Dynamic Island
    const ImVec2 camC(diTl.x + 28.0f, (diTl.y + diBr.y) * 0.5f);
    dl->AddCircleFilled(camC, 5.2f, IM_COL32(22, 28, 42, 255));
    dl->AddCircle(camC, 5.2f, IM_COL32(95, 110, 135, 185), 14, 1.1f);
    dl->AddCircleFilled({camC.x - 1.2f, camC.y - 1.2f}, 1.5f, IM_COL32(92, 178, 255, 210));
    // White iFruit Bowl Emblem inside Dynamic Island (matching image-1.png!)
    drawIFruitBowlGlyph(dl, {diTl.x + diW * 0.54f, (diTl.y + diBr.y) * 0.5f + 1.0f}, 6.6f, IM_COL32(250, 252, 255, 250));

    // Right Bright-Green Battery Pill ("86%")
    const ImVec2 batTl(scrBr.x - 54.0f, scrTl.y + 11.5f);
    const ImVec2 batBr(scrBr.x - 17.0f, scrTl.y + 25.5f);
    dl->AddRectFilled(batTl, batBr, IM_COL32(245, 250, 255, 235), 6.5f);
    dl->AddRectFilled(batTl, {batTl.x + (batBr.x - batTl.x) * 0.84f, batBr.y}, IM_COL32(32, 218, 98, 255), 6.5f);
    dl->AddRectFilled({batBr.x + 1.2f, batTl.y + 4.0f}, {batBr.x + 3.0f, batBr.y - 4.0f}, stCol, 1.0f);
    dl->AddText(fBody, 10.5f, {batTl.x + 6.0f, batTl.y + 1.5f}, IM_COL32(255, 255, 255, 255), "86%");
  }

  const glm::vec3 pPos = player.position();

  // =========================================================================
  // 4. HOME SCREEN (Strictly Fixed Layout — Widgets & App Order Locked!)
  // =========================================================================
  if (isHome) {
    const float marginX = 18.0f;
    const float widgetGap = 12.0f;
    const float widgetW = (scrW - marginX * 2.0f - widgetGap) * 0.5f; // ~143px
    const float widgetH = 138.0f;
    const float widgetY = scrTl.y + 46.0f;

    // -----------------------------------------------------------------------
    // 4A. Top-Left Fixed Widget: Live District Weather (Matches image-1.png)
    // -----------------------------------------------------------------------
    {
      const ImVec2 w0(scrTl.x + marginX, widgetY);
      const ImVec2 w1(w0.x + widgetW, widgetY + widgetH);
      ImGui::SetCursorScreenPos(w0);
      const bool clicked = ImGui::InvisibleButton("##LockedWeatherWidget", {widgetW, widgetH});
      const bool hov = ImGui::IsItemHovered();

      drawSquircleTile(dl, w0, w1, 22.0f, IM_COL32(7, 146, 236, 252), IM_COL32(18, 194, 252, 252), hov);
      const char* distName = shortDistrictForPhone(pPos, world);
      dl->AddText(fBody, 16.0f, {w0.x + 14.0f, w0.y + 14.0f}, IM_COL32(246, 252, 255, 250), distName);

      char degBuf[16];
      std::snprintf(degBuf, sizeof(degBuf), "%d°", computeCelsiusTemp(session.timeOfDayHours(), session.weatherLabel()));
      dl->AddText(fTitle, 36.0f, {w0.x + 13.0f, w0.y + 34.0f}, IM_COL32(255, 255, 255, 255), degBuf);

      drawSunOrMoonIcon(dl, {w0.x + 30.0f, w1.y - 26.0f}, 14.0f, session.timeOfDayHours(), session.weatherLabel());
      dl->AddText(fBody, 11.5f, {w0.x + 52.0f, w1.y - 31.0f}, IM_COL32(226, 246, 255, 235), session.weatherLabel().c_str());

      if (clicked) {
        phone.activeApp = PhoneAppId::WeatherView;
      }
    }

    // -----------------------------------------------------------------------
    // 4B. Top-Right Fixed Widget: BREAKING NEWS / WBN (Matches image-1.png)
    // -----------------------------------------------------------------------
    {
      const ImVec2 n0(scrTl.x + marginX + widgetW + widgetGap, widgetY);
      const ImVec2 n1(n0.x + widgetW, widgetY + widgetH);
      ImGui::SetCursorScreenPos(n0);
      const bool clicked = ImGui::InvisibleButton("##LockedBreakingNewsWidget", {widgetW, widgetH});
      const bool hov = ImGui::IsItemHovered();

      drawSquircleTile(dl, n0, n1, 22.0f, IM_COL32(58, 68, 84, 252), IM_COL32(28, 34, 46, 252), hov);
      dl->PushClipRect(n0, n1, true);

      // Crisp White Top Header Strip with Bold Red "BREAKING NEWS"
      dl->AddRectFilled(n0, {n1.x, n0.y + 27.0f}, IM_COL32(250, 251, 254, 255), 22.0f, ImDrawFlags_RoundCornersTop);
      const char* bnHdr = "BREAKING NEWS";
      const ImVec2 bns = fHead->CalcTextSizeA(12.2f, widgetW, 0.0f, bnHdr);
      dl->AddText(fHead, 12.2f, {n0.x + (widgetW - bns.x) * 0.5f, n0.y + 7.5f}, IM_COL32(218, 24, 28, 255), bnHdr);

      // Aerial Highway Pursuit Vector Scene (Armored Van + Cruiser + Asphalt Lanes)
      dl->AddLine({n0.x + 8.0f, n1.y - 8.0f}, {n1.x - 10.0f, n0.y + 30.0f}, IM_COL32(84, 94, 110, 220), 34.0f);
      dl->AddLine({n0.x + 14.0f, n1.y - 12.0f}, {n1.x - 16.0f, n0.y + 34.0f}, IM_COL32(235, 212, 110, 145), 1.4f);
      // White getaway van silhouette (top-left of road)
      const ImVec2 vanPts[4] = {
        {n0.x + 22.0f, n0.y + 52.0f}, {n0.x + 48.0f, n0.y + 36.0f},
        {n0.x + 58.0f, n0.y + 48.0f}, {n0.x + 32.0f, n0.y + 64.0f}
      };
      dl->AddConvexPolyFilled(vanPts, 4, IM_COL32(236, 242, 250, 245));
      // Police pursuit cruiser + flashing red/blue lightbar
      const ImVec2 copPts[4] = {
        {n0.x + 62.0f, n0.y + 84.0f}, {n0.x + 84.0f, n0.y + 68.0f},
        {n0.x + 94.0f, n0.y + 78.0f}, {n0.x + 72.0f, n0.y + 94.0f}
      };
      dl->AddConvexPolyFilled(copPts, 4, IM_COL32(24, 30, 42, 250));
      const bool flash = std::fmod(elapsedSec * 5.0f, 1.0f) < 0.5f;
      dl->AddCircleFilled({n0.x + 78.0f, n0.y + 80.0f}, 4.2f,
                          flash ? IM_COL32(255, 52, 52, 235) : IM_COL32(56, 152, 255, 235));

      // Bottom subtle dark vignette + WBN NEWS square badge (matching WEAZEL NEWS badge in image-1.png)
      dl->AddRectFilledMultiColor(
        {n0.x, n1.y - 46.0f}, n1,
        IM_COL32(10, 14, 22, 0), IM_COL32(10, 14, 22, 0),
        IM_COL32(10, 14, 22, 225), IM_COL32(10, 14, 22, 225)
      );
      const ImVec2 b0(n0.x + 10.0f, n1.y - 34.0f);
      const ImVec2 b1(n0.x + 48.0f, n1.y - 12.0f);
      dl->AddRectFilled(b0, b1, IM_COL32(248, 250, 252, 245), 3.0f);
      dl->AddRectFilled(b0, {b1.x, b0.y + 11.0f}, IM_COL32(212, 26, 32, 255), 3.0f, ImDrawFlags_RoundCornersTop);
      dl->AddText(fHead, 9.5f, {b0.x + 6.0f, b0.y + 1.0f}, IM_COL32(255, 255, 255, 255), "WBN");
      dl->AddText(fBody, 8.8f, {b0.x + 5.0f, b0.y + 11.5f}, IM_COL32(20, 24, 32, 255), "NEWS");

      dl->PopClipRect();
      if (clicked) {
        phone.activeApp = PhoneAppId::Lifegram;
      }
    }

    // -----------------------------------------------------------------------
    // 4C. Fixed 3x2 Squircle App Grid (Strictly Non-Editable Order!)
    // -----------------------------------------------------------------------
    struct FixedHomeAppSpec {
      PhoneAppId id;
      const char* label;
      const char* subLabel;
      ImU32 topCol;
      ImU32 botCol;
    };
    static constexpr FixedHomeAppSpec kGridApps[6] = {
      {PhoneAppId::BlackNet,    "BlackNet",   "Contracts",   IM_COL32(238, 28, 37, 255),  IM_COL32(196, 16, 26, 255)},
      {PhoneAppId::WhatUp,      "WhatUp",     nullptr,       IM_COL32(8, 228, 142, 255),  IM_COL32(6, 195, 174, 255)},
      {PhoneAppId::Lifegram,    "Lifegram",   nullptr,       IM_COL32(254, 72, 239, 255), IM_COL32(234, 42, 214, 255)},
      {PhoneAppId::Motorsports, "Legendary",  "Motorsports", IM_COL32(76, 52, 124, 255),  IM_COL32(14, 168, 232, 255)},
      {PhoneAppId::Dynasty8,    "Dynasty 8",  nullptr,       IM_COL32(255, 212, 32, 255), IM_COL32(248, 66, 74, 255)},
      {PhoneAppId::FruitPay,    "iFruit Pay", nullptr,       IM_COL32(18, 20, 26, 255),   IM_COL32(10, 12, 16, 255)},
    };

    const float iconSz = 68.0f;
    const float colSpan = (scrW - marginX * 2.0f - iconSz * 3.0f) * 0.5f;
    const float gridTopY = widgetY + widgetH + 22.0f;
    const float rowStepY = 104.0f;

    for (int idx = 0; idx < 6; ++idx) {
      const int col = idx % 3;
      const int row = idx / 3;
      const auto& spec = kGridApps[idx];
      const ImVec2 i0(scrTl.x + marginX + col * (iconSz + colSpan), gridTopY + row * rowStepY);
      const ImVec2 i1(i0.x + iconSz, i0.y + iconSz);
      const ImVec2 ic((i0.x + i1.x) * 0.5f, (i0.y + i1.y) * 0.5f);

      ImGui::PushID(400 + idx);
      ImGui::SetCursorScreenPos(i0);
      const bool clicked = ImGui::InvisibleButton("##FixedGridIcon", {iconSz, iconSz + 22.0f});
      const bool hov = ImGui::IsItemHovered();
      ImGui::PopID();

      drawSquircleTile(dl, i0, i1, 16.5f, spec.topCol, spec.botCol, hov);

      // Custom crisp vector icon artwork matching image-1.png
      if (spec.id == PhoneAppId::BlackNet) {
        // Bold slanted white emblem (matching the red tile punch in image-1.png)
        const ImVec2 sPts[4] = {
          {ic.x - 4.0f, i0.y + 13.0f}, {ic.x + 5.0f, i0.y + 13.0f},
          {ic.x - 1.0f, i1.y - 15.0f}, {ic.x - 10.0f, i1.y - 15.0f}
        };
        dl->AddConvexPolyFilled(sPts, 4, IM_COL32(255, 255, 255, 255));
        dl->AddRectFilled({ic.x - 10.0f, i1.y - 22.0f}, {ic.x + 12.0f, i1.y - 14.0f}, IM_COL32(255, 255, 255, 255), 1.5f);
      } else if (spec.id == PhoneAppId::WhatUp) {
        // Speech bubble ring + tail + inner semi-circle handset
        dl->AddCircle(ic, 21.0f, IM_COL32(255, 255, 255, 250), 28, 3.0f);
        dl->AddTriangleFilled({ic.x - 18.0f, ic.y + 12.0f}, {ic.x - 23.0f, ic.y + 22.0f}, {ic.x - 9.0f, ic.y + 18.0f},
                              IM_COL32(255, 255, 255, 250));
        dl->PathArcTo({ic.x, ic.y + 3.0f}, 11.0f, 3.14159265f, 6.2831853f, 14);
        dl->PathFillConvex(IM_COL32(255, 255, 255, 250));
        const int unread = session.unreadPhoneMessageCount();
        if (unread > 0) {
          dl->AddCircleFilled({i1.x - 4.0f, i0.y + 5.0f}, 9.5f, IM_COL32(239, 38, 48, 255));
          char ub[8];
          std::snprintf(ub, sizeof(ub), "%d", std::min(9, unread));
          dl->AddText(fHead, 11.5f, {i1.x - 7.2f, i0.y - 1.0f}, IM_COL32(255, 255, 255, 255), ub);
        }
      } else if (spec.id == PhoneAppId::Lifegram) {
        // Stylish white "Life" wordmark
        const ImVec2 lts = fHead->CalcTextSizeA(22.0f, iconSz, 0.0f, "Life");
        dl->AddText(fHead, 22.0f, {ic.x - lts.x * 0.5f, ic.y - lts.y * 0.5f}, IM_COL32(255, 255, 255, 255), "Life");
      } else if (spec.id == PhoneAppId::Motorsports) {
        // Sleek sports-car roofline silhouette + bold "LMS"
        dl->AddBezierQuadratic({i0.x + 11.0f, ic.y - 3.0f}, {ic.x + 2.0f, i0.y + 13.0f}, {i1.x - 10.0f, ic.y - 2.0f},
                               IM_COL32(255, 255, 255, 235), 2.0f, 14);
        const ImVec2 mts = fHead->CalcTextSizeA(18.5f, iconSz, 0.0f, "LMS");
        dl->AddText(fHead, 18.5f, {ic.x - mts.x * 0.5f, ic.y - 2.0f}, IM_COL32(255, 255, 255, 255), "LMS");
      } else if (spec.id == PhoneAppId::Dynasty8) {
        // Overlapping white luxury property cards + rose emblem (matching center-bottom icon in image-1.png)
        dl->AddRectFilled({ic.x - 18.0f, ic.y - 19.0f}, {ic.x + 4.0f, ic.y + 13.0f}, IM_COL32(236, 240, 248, 235), 4.0f);
        dl->AddRectFilled({ic.x - 6.0f,  ic.y - 13.0f}, {ic.x + 18.0f, ic.y + 20.0f}, IM_COL32(255, 255, 255, 255), 4.0f);
        drawIFruitBowlGlyph(dl, {ic.x + 6.0f, ic.y + 5.0f}, 7.2f, IM_COL32(236, 48, 122, 255));
      } else if (spec.id == PhoneAppId::FruitPay) {
        // Jet-black tile with white iFruit bowl + "Pay" (exact match to iFruit Pay in image-1.png!)
        drawIFruitBowlGlyph(dl, {i0.x + 19.0f, ic.y + 1.5f}, 9.0f, IM_COL32(255, 255, 255, 255));
        dl->AddText(fBody, 16.0f, {i0.x + 32.0f, ic.y - 8.5f}, IM_COL32(255, 255, 255, 255), "Pay");
      }

      // Centered white app label(s) below squircle
      const ImVec2 lblSz = fBody->CalcTextSizeA(11.8f, 92.0f, 0.0f, spec.label);
      dl->AddText(fBody, 11.8f, {ic.x - lblSz.x * 0.5f, i1.y + 4.5f}, IM_COL32(255, 255, 255, 248), spec.label);
      if (spec.subLabel) {
        const ImVec2 subSz = fBody->CalcTextSizeA(11.2f, 96.0f, 0.0f, spec.subLabel);
        dl->AddText(fBody, 11.2f, {ic.x - subSz.x * 0.5f, i1.y + 16.5f}, IM_COL32(255, 255, 255, 238), spec.subLabel);
      }

      if (clicked) {
        phone.activeApp = spec.id;
        if (spec.id == PhoneAppId::WhatUp) {
          session.markPhoneMessagesRead();
        }
      }
    }

    // -----------------------------------------------------------------------
    // 4D. Frosted "New Message" Notification Banner (Matches Lucia banner in image-1.png!)
    // -----------------------------------------------------------------------
    if (!session.phoneMessages().empty()) {
      const auto& latest = session.phoneMessages().front();
      const float cardY = gridTopY + rowStepY * 2.0f + 8.0f;
      const ImVec2 c0(scrTl.x + 22.0f, cardY);
      const ImVec2 c1(scrBr.x - 22.0f, cardY + 64.0f);

      ImGui::SetCursorScreenPos(c0);
      const bool bannerClicked = ImGui::InvisibleButton("##SmsBannerCard", {c1.x - c0.x, c1.y - c0.y});
      const bool bannerHov = ImGui::IsItemHovered();

      dl->AddRectFilled({c0.x + 1.0f, c0.y + 3.0f}, {c1.x + 1.0f, c1.y + 3.5f}, IM_COL32(24, 16, 28, 36), 16.0f);
      dl->AddRectFilled(c0, c1, bannerHov ? IM_COL32(255, 255, 255, 246) : IM_COL32(246, 249, 254, 232), 16.0f);
      dl->AddRect(c0, c1, IM_COL32(255, 255, 255, 200), 16.0f, 0, 1.0f);

      // Circular contact portrait avatar on left
      const ImVec2 avC(c0.x + 30.0f, (c0.y + c1.y) * 0.5f);
      const uint8_t ar = static_cast<uint8_t>((latest.avatarHex >> 16) & 0xFFu);
      const uint8_t ag = static_cast<uint8_t>((latest.avatarHex >> 8) & 0xFFu);
      const uint8_t ab = static_cast<uint8_t>(latest.avatarHex & 0xFFu);
      dl->AddCircleFilled(avC, 21.0f, IM_COL32(ar, ag, ab, 255), 24);
      // Stylized portrait silhouette (head + shoulders)
      dl->AddCircleFilled({avC.x, avC.y - 5.0f}, 7.2f, IM_COL32(245, 214, 192, 255), 16);
      dl->PathArcTo({avC.x, avC.y + 15.0f}, 12.5f, 3.45f, 5.97f, 12);
      dl->PathFillConvex(IM_COL32(32, 38, 52, 245));
      dl->AddCircle(avC, 21.0f, IM_COL32(255, 255, 255, 220), 24, 1.5f);

      // Mini WhatUp badge in top-right corner of card
      const ImVec2 wb0(c1.x - 24.0f, c0.y + 7.0f);
      const ImVec2 wb1(c1.x - 8.0f, c0.y + 23.0f);
      dl->AddRectFilled(wb0, wb1, IM_COL32(10, 222, 152, 255), 4.5f);
      dl->AddCircle({(wb0.x + wb1.x) * 0.5f, (wb0.y + wb1.y) * 0.5f}, 4.8f, IM_COL32(255, 255, 255, 250), 14, 1.4f);

      // Text lines: "New Message", Sender Name, Snippet, Timestamp
      dl->AddText(fBody, 10.5f, {c0.x + 58.0f, c0.y + 7.0f}, IM_COL32(94, 104, 122, 245), "New Message");
      dl->AddText(fHead, 13.0f, {c0.x + 58.0f, c0.y + 20.5f}, IM_COL32(16, 20, 30, 255), latest.sender.c_str());

      std::string snip = latest.body;
      if (snip.size() > 34) snip = snip.substr(0, 32) + "..";
      dl->AddText(fBody, 10.6f, {c0.x + 58.0f, c0.y + 36.5f}, IM_COL32(52, 60, 76, 240), snip.c_str());
      dl->AddText(fBody, 9.8f,  {c1.x - 34.0f, c1.y - 15.5f}, IM_COL32(108, 116, 132, 235), latest.timeLabel.c_str());

      if (bannerClicked) {
        phone.activeApp = PhoneAppId::WhatUp;
        phone.selectedSmsIdx = 0;
        session.markPhoneMessagesRead();
      }
    }

    // Locked Page Indicator Pill above Dock
    const float dotY = scrBr.y - 98.0f;
    dl->AddCircle({scrTl.x + scrW * 0.5f - 7.0f, dotY}, 4.2f, IM_COL32(255, 255, 255, 245), 14, 2.0f);
    dl->AddCircleFilled({scrTl.x + scrW * 0.5f + 7.0f, dotY}, 2.8f, IM_COL32(255, 255, 255, 145), 12);

    // -----------------------------------------------------------------------
    // 4E. Fixed 4-Icon Frosted Bottom Dock (Phone, SnapCam, CityMaps, Settings)
    // -----------------------------------------------------------------------
    {
      const ImVec2 d0(scrTl.x + 14.0f, scrBr.y - 84.0f);
      const ImVec2 d1(scrBr.x - 14.0f, scrBr.y - 10.0f);
      dl->AddRectFilled(d0, d1, IM_COL32(148, 136, 128, 132), 24.0f);
      dl->AddRect(d0, d1, IM_COL32(255, 255, 255, 92), 24.0f, 0, 1.0f);

      const PhoneAppId dockIds[4] = {
        PhoneAppId::Dialer, PhoneAppId::SnapCam, PhoneAppId::CityMaps, PhoneAppId::Settings
      };
      const ImU32 dockTop[4] = {
        IM_COL32(24, 208, 78, 255), IM_COL32(168, 174, 184, 255),
        IM_COL32(42, 186, 248, 255), IM_COL32(246, 248, 252, 255)
      };
      const ImU32 dockBot[4] = {
        IM_COL32(16, 178, 62, 255), IM_COL32(128, 134, 146, 255),
        IM_COL32(18, 144, 232, 255), IM_COL32(226, 230, 238, 255)
      };

      const float dIconSz = 56.0f;
      const float dPadX = 14.0f;
      const float dGap = ((d1.x - d0.x) - dPadX * 2.0f - dIconSz * 4.0f) / 3.0f;
      const float dTopY = d0.y + ((d1.y - d0.y) - dIconSz) * 0.5f;

      for (int di = 0; di < 4; ++di) {
        const ImVec2 b0(d0.x + dPadX + di * (dIconSz + dGap), dTopY);
        const ImVec2 b1(b0.x + dIconSz, b0.y + dIconSz);
        const ImVec2 bc((b0.x + b1.x) * 0.5f, (b0.y + b1.y) * 0.5f);

        ImGui::PushID(450 + di);
        ImGui::SetCursorScreenPos(b0);
        const bool clicked = ImGui::InvisibleButton("##FixedDockBtn", {dIconSz, dIconSz});
        const bool hov = ImGui::IsItemHovered();
        ImGui::PopID();

        drawSquircleTile(dl, b0, b1, 14.0f, dockTop[di], dockBot[di], hov);

        if (di == 0) {
          // Green Phone icon: white mini phone bezel + black handset glyph (matching image-1.png!)
          dl->AddRectFilled({bc.x - 11.0f, bc.y - 18.0f}, {bc.x + 11.0f, bc.y + 18.0f}, IM_COL32(252, 253, 255, 255), 5.0f);
          dl->AddCircleFilled({bc.x, bc.y - 14.5f}, 1.4f, IM_COL32(24, 30, 38, 255));
          dl->PathArcTo({bc.x + 3.0f, bc.y}, 7.5f, 2.25f, 4.05f, 10);
          dl->PathStroke(IM_COL32(20, 24, 30, 255), 0, 3.2f);
        } else if (di == 1) {
          // Silver Camera icon: white rounded square body + dark multi-ring lens
          dl->AddRectFilled({bc.x - 17.0f, bc.y - 14.0f}, {bc.x + 17.0f, bc.y + 15.0f}, IM_COL32(250, 252, 255, 255), 6.0f);
          dl->AddCircleFilled(bc, 9.2f, IM_COL32(28, 34, 44, 255), 20);
          dl->AddCircle(bc, 5.2f, IM_COL32(118, 178, 238, 220), 16, 1.4f);
          dl->AddCircleFilled({bc.x + 10.5f, bc.y - 8.5f}, 2.0f, IM_COL32(248, 192, 64, 255));
        } else if (di == 2) {
          // Blue Radar/Maps icon: white outer ring + inner target compass
          dl->AddCircle(bc, 18.0f, IM_COL32(255, 255, 255, 245), 24, 2.4f);
          dl->AddCircleFilled(bc, 13.5f, IM_COL32(18, 152, 238, 255), 20);
          dl->AddCircle({bc.x + 2.5f, bc.y - 1.5f}, 5.5f, IM_COL32(255, 255, 255, 245), 16, 1.8f);
          dl->AddLine({bc.x - 9.0f, bc.y + 9.0f}, {bc.x - 2.0f, bc.y + 2.0f}, IM_COL32(255, 255, 255, 245), 2.2f);
        } else {
          // White Settings icon: two interlocking dark gears (matching image-1.png!)
          auto drawGear = [&](ImVec2 gc, float gr) {
            dl->AddCircleFilled(gc, gr, IM_COL32(26, 30, 38, 255), 16);
            for (int ti = 0; ti < 8; ++ti) {
              const float a = ti * (6.2831853f / 8.0f);
              dl->AddCircleFilled({gc.x + std::cos(a) * (gr + 1.8f), gc.y + std::sin(a) * (gr + 1.8f)},
                                  2.1f, IM_COL32(26, 30, 38, 255), 8);
            }
            dl->AddCircleFilled(gc, gr * 0.42f, IM_COL32(242, 245, 250, 255), 12);
          };
          drawGear({bc.x - 5.5f, bc.y + 5.5f}, 8.2f);
          drawGear({bc.x + 8.5f, bc.y - 7.5f}, 5.8f);
        }

        if (clicked) {
          phone.activeApp = dockIds[di];
        }
      }
    }
  } else {
    // =========================================================================
    // 5. OPEN PEAR-OS APPLICATIONS (Inside Locked iFruit 15iX Chassis)
    // =========================================================================
    ImGui::PushStyleColor(ImGuiCol_ChildBg, ImVec4(0.0f, 0.0f, 0.0f, 0.0f));
    const float bodyX = scrTl.x + 12.0f;
    const float bodyY = scrTl.y + 76.0f;
    const float bodyW = scrW - 24.0f;
    const float bodyH = scrH - 104.0f;

    // -------------------------------------------------------------------------
    // APP 1: BlackNet (Campaign Dossiers, Fixer Hits, Street Races & Fight Card)
    // -------------------------------------------------------------------------
    if (phone.activeApp == PhoneAppId::BlackNet) {
      if (drawAppTopHeader(dl, scrTl, scrW, "BLACKNET OPS", IM_COL32(248, 72, 82, 255), fBody, fHead, true)) {
        phone.activeApp = PhoneAppId::Home;
      } else {
        ImGui::SetCursorScreenPos({bodyX, bodyY});
        ImGui::BeginChild("##BlackNetBody", {bodyW, bodyH}, false);

        const char* subTabs[3] = {"Dossiers", "Fixer Hits", "Races & Pit"};
        for (int ti = 0; ti < 3; ++ti) {
          if (ti > 0) ImGui::SameLine();
          const bool sel = (phone.blackNetSubTab == ti);
          if (sel) ImGui::PushStyleColor(ImGuiCol_Button, ImVec4(0.76f, 0.14f, 0.18f, 1.0f));
          if (ImGui::Button(subTabs[ti], {(bodyW - 16.0f) / 3.0f, 25.0f})) {
            phone.blackNetSubTab = ti;
          }
          if (sel) ImGui::PopStyleColor();
        }
        ImGui::Separator();

        if (phone.blackNetSubTab == 0) {
          ImGui::TextColored({0.98f, 0.78f, 0.32f, 1.0f}, "VOSS // CAMPAIGN  (Step %d/9)", session.storyStep());
          if ((session.activeMission().active || session.activeSurveillance().active) &&
              ImGui::Button("Abort Active Operation", {-1.0f, 24.0f})) {
            session.abortActiveMissionOrSurveillance();
          }
          for (const auto& ch : session.storyChapters()) {
            const bool unlocked = session.isChapterUnlocked(ch.chapter);
            ImGui::PushID(5100 + ch.chapter);
            ImGui::TextColored(ch.completed ? ImVec4(0.38f, 0.96f, 0.62f, 1.0f)
                                            : (unlocked ? ImVec4(0.95f, 0.97f, 1.0f, 1.0f) : ImVec4(0.50f, 0.54f, 0.62f, 1.0f)),
                               "CH %s: %s %s",
                               ch.code.c_str(), ch.codename.c_str(),
                               ch.completed ? "[CLEARED]" : (unlocked ? "[LIVE]" : "[LOCKED]"));
            ImGui::TextWrapped("%s — %s", ch.title.c_str(), ch.district.c_str());
            if (unlocked) {
              if (ImGui::SmallButton("Deploy")) {
                session.startStoryChapter(ch.chapter, player, world, audio, true);
                ioPhoneOpen = false;
              }
              ImGui::SameLine();
              if (ImGui::SmallButton("Set GPS")) {
                session.setGpsWaypoint(ch.beaconPos, "CH " + ch.code + ": " + ch.codename);
              }
            }
            ImGui::Separator();
            ImGui::PopID();
          }
        } else if (phone.blackNetSubTab == 1) {
          ImGui::TextColored({0.42f, 0.96f, 0.62f, 1.0f}, "FIXER BOUNTIES ($USD WIRE):");
          for (size_t i = 0; i < session.contracts().size(); ++i) {
            const auto& c = session.contracts()[i];
            ImGui::PushID(static_cast<int>(5200 + i));
            ImGui::Text("%s // %s", c.code.c_str(), c.targetName.c_str());
            ImGui::TextDisabled("%s (%s)", c.title.c_str(), c.district.c_str());
            ImGui::TextColored({0.38f, 0.94f, 0.58f, 1.0f}, "$%d + $%d Unseen %s",
                               c.rewardBase, c.unseenBonus, c.completed ? "[PAID]" : "");
            if (ImGui::SmallButton("Accept & Track GPS")) {
              session.acceptContract(static_cast<int>(i), world);
            }
            ImGui::Separator();
            ImGui::PopID();
          }
        } else {
          ImGui::TextColored({1.0f, 0.78f, 0.28f, 1.0f}, "STREET RACES ($USD PRIZE):");
          for (size_t i = 0; i < session.races().size(); ++i) {
            const auto& r = session.races()[i];
            ImGui::PushID(static_cast<int>(5300 + i));
            ImGui::Text("%s ($%d)%s", r.name.c_str(), r.rewardFirst, r.won ? " [WON]" : "");
            if (ImGui::SmallButton("Enter Race")) {
              session.startStreetRace(static_cast<int>(i), player, world);
              ioPhoneOpen = false;
            }
            ImGui::PopID();
          }
          if (session.activeRaceIdx() >= 0 && ImGui::SmallButton("Cancel Active Race")) {
            session.cancelRace();
          }
          ImGui::Separator();
          ImGui::TextColored({0.98f, 0.54f, 0.28f, 1.0f}, "IRON PIT UNDERGROUND (Tier %d/5):", session.ironPit().tier);
          if (ImGui::SmallButton("GPS Iron Pit")) {
            session.setGpsWaypoint(world.fightPitPos, "Iron Pit Arena");
          }
          ImGui::SameLine();
          if (ImGui::SmallButton("Refresh Card")) {
            session.refreshFightCard();
          }
          const auto& roster = session.pitRoster();
          for (size_t mi = 0; mi < session.pitCard().size(); ++mi) {
            const auto& m = session.pitCard()[mi];
            if (static_cast<size_t>(m.redIdx) >= roster.size() || static_cast<size_t>(m.blueIdx) >= roster.size()) continue;
            ImGui::PushID(static_cast<int>(5350 + mi));
            ImGui::TextWrapped("%s (%.1fx) vs %s (%.1fx)",
                               roster[static_cast<size_t>(m.redIdx)].name.c_str(), m.redOdds,
                               roster[static_cast<size_t>(m.blueIdx)].name.c_str(), m.blueOdds);
            if (!m.settled && !session.spectatorBout().active) {
              if (ImGui::SmallButton("Bet Red $150")) session.startSpectatorBout(static_cast<int>(mi), 0, 150, false, world, audio);
              ImGui::SameLine();
              if (ImGui::SmallButton("Bet Blue $150")) session.startSpectatorBout(static_cast<int>(mi), 1, 150, false, world, audio);
            }
            ImGui::PopID();
          }
        }
        ImGui::EndChild();
      }
    }
    // -------------------------------------------------------------------------
    // APP 2: WhatUp Messenger (Contacts, SMS Inbox & Mara Quick-Reply)
    // -------------------------------------------------------------------------
    else if (phone.activeApp == PhoneAppId::WhatUp) {
      if (drawAppTopHeader(dl, scrTl, scrW, "WhatUp", IM_COL32(8, 156, 108, 255), fBody, fHead, false)) {
        phone.activeApp = PhoneAppId::Home;
      } else {
        ImGui::SetCursorScreenPos({bodyX, bodyY});
        ImGui::PushStyleColor(ImGuiCol_Text, ImVec4(0.08f, 0.11f, 0.18f, 1.0f));
        ImGui::BeginChild("##WhatUpList", {bodyW, bodyH}, false);

        ImGui::TextColored({0.05f, 0.56f, 0.42f, 1.0f}, "ENCRYPTED THREADS (%zu)", session.phoneMessages().size());
        ImGui::Separator();

        for (size_t mi = 0; mi < session.phoneMessages().size(); ++mi) {
          const auto& msg = session.phoneMessages()[mi];
          ImGui::PushID(static_cast<int>(5400 + mi));
          const ImVec2 p0 = ImGui::GetCursorScreenPos();
          dl->AddRectFilled(p0, {p0.x + bodyW - 6.0f, p0.y + 72.0f}, IM_COL32(255, 255, 255, 245), 11.0f);
          dl->AddRect(p0, {p0.x + bodyW - 6.0f, p0.y + 72.0f}, IM_COL32(208, 218, 232, 220), 11.0f);

          dl->AddText(fHead, 13.5f, {p0.x + 10.0f, p0.y + 7.0f}, IM_COL32(14, 22, 36, 255), msg.sender.c_str());
          dl->AddText(fBody, 11.0f, {p0.x + bodyW - 48.0f, p0.y + 8.0f}, IM_COL32(100, 116, 139, 240), msg.timeLabel.c_str());
          dl->AddText(fBody, 11.8f, {p0.x + 10.0f, p0.y + 25.0f}, IM_COL32(16, 138, 98, 255), msg.subtitle.c_str());

          std::string wrapped = msg.body;
          if (wrapped.size() > 76) wrapped = wrapped.substr(0, 74) + "..";
          dl->AddText(fBody, 11.5f, {p0.x + 10.0f, p0.y + 42.0f}, IM_COL32(51, 65, 85, 255), wrapped.c_str(), nullptr, bodyW - 24.0f);

          ImGui::Dummy({bodyW - 8.0f, 76.0f});
          ImGui::PopID();
        }

        if (session.storyStep() < static_cast<int>(session.storyChapters().size())) {
          const auto& nextCh = session.storyChapters()[static_cast<size_t>(session.storyStep())];
          ImGui::PushStyleColor(ImGuiCol_Button, ImVec4(0.06f, 0.68f, 0.46f, 1.0f));
          ImGui::PushStyleColor(ImGuiCol_Text, ImVec4(1.0f, 1.0f, 1.0f, 1.0f));
          char nextBtn[96];
          std::snprintf(nextBtn, sizeof(nextBtn), "Track Next Lead: CH %s %s", nextCh.code.c_str(), nextCh.codename.c_str());
          if (ImGui::Button(nextBtn, {-1.0f, 30.0f})) {
            session.setGpsWaypoint(nextCh.beaconPos, "CH " + nextCh.code + ": " + nextCh.codename);
          }
          ImGui::PopStyleColor(2);
        }

        ImGui::EndChild();
        ImGui::PopStyleColor();
      }
    }
    // -------------------------------------------------------------------------
    // APP 3: Lifegram & WBN Breaking News Feed
    // -------------------------------------------------------------------------
    else if (phone.activeApp == PhoneAppId::Lifegram) {
      if (drawAppTopHeader(dl, scrTl, scrW, "Lifegram • WBN", IM_COL32(218, 34, 186, 255), fBody, fHead, false)) {
        phone.activeApp = PhoneAppId::Home;
      } else {
        ImGui::SetCursorScreenPos({bodyX, bodyY});
        ImGui::PushStyleColor(ImGuiCol_Text, ImVec4(0.10f, 0.13f, 0.20f, 1.0f));
        ImGui::BeginChild("##LifegramFeed", {bodyW, bodyH}, false);

        struct PostCard {
          std::string handle;
          std::string tag;
          std::string copy;
          ImU32 accent;
        };
        const PostCard posts[4] = {
          {"@WBN_Breaking", "LIVE BULLETIN", liveBreakingHeadline(session), IM_COL32(220, 38, 38, 255)},
          {"@VanguardTailors", "LEGION SQUARE",
           "New executive & tactical collections in stock! Visit our open-world boutiques in Civic, Midtown & Del Sol to try outfits in person.",
           IM_COL32(217, 70, 239, 255)},
          {"@WestgateArmory", "CUSTOM WORKBENCH",
           "Need Cerakote finishes, suppressors or match barrels? Step up to any physical Tactical Armory bench across Westgate Bay.",
           IM_COL32(234, 138, 20, 255)},
          {"@DelSolRacer", "BAY SPEEDWAY",
           "Radar speed traps beaten across the bay: " + std::to_string(session.speedTrapsBeatenCount()) +
           "/" + std::to_string(session.speedTraps().size()) + " — Hidden cash stashes found: " +
           std::to_string(session.stashesFound()) + "/" + std::to_string(session.totalStashes()) + ".",
           IM_COL32(14, 165, 233, 255)},
        };

        for (int pi = 0; pi < 4; ++pi) {
          const ImVec2 p0 = ImGui::GetCursorScreenPos();
          dl->AddRectFilled(p0, {p0.x + bodyW - 6.0f, p0.y + 92.0f}, IM_COL32(255, 255, 255, 248), 12.0f);
          dl->AddRectFilled(p0, {p0.x + 5.0f, p0.y + 92.0f}, posts[pi].accent, 4.0f);
          dl->AddText(fHead, 13.0f, {p0.x + 12.0f, p0.y + 7.0f}, IM_COL32(15, 23, 42, 255), posts[pi].handle.c_str());
          dl->AddText(fBody, 10.5f, {p0.x + bodyW - 96.0f, p0.y + 9.0f}, posts[pi].accent, posts[pi].tag.c_str());
          dl->AddText(fBody, 11.6f, {p0.x + 12.0f, p0.y + 27.0f}, IM_COL32(51, 65, 85, 255),
                      posts[pi].copy.c_str(), nullptr, bodyW - 24.0f);
          ImGui::Dummy({bodyW - 8.0f, 98.0f});
        }

        ImGui::EndChild();
        ImGui::PopStyleColor();
      }
    }
    // -------------------------------------------------------------------------
    // APP 4: Legendary Motorsports ($USD Dealership & Curbside Valet)
    // -------------------------------------------------------------------------
    else if (phone.activeApp == PhoneAppId::Motorsports) {
      if (drawAppTopHeader(dl, scrTl, scrW, "MOTORSPORTS", IM_COL32(56, 189, 248, 255), fBody, fHead, true)) {
        phone.activeApp = PhoneAppId::Home;
      } else {
        ImGui::SetCursorScreenPos({bodyX, bodyY});
        ImGui::BeginChild("##LMSBody", {bodyW, bodyH}, false);
        ImGui::TextColored({0.38f, 0.96f, 0.64f, 1.0f}, "BALANCE: %s", formatUsd(session.playerCash()).c_str());
        ImGui::TextDisabled("Engine tuning & respray at Westgate Customs garages.");

        const char* pNames[4] = {"White", "Obsidian", "Corsa Red", "Cobalt"};
        for (int pi = 0; pi < 4; ++pi) {
          if (pi > 0) ImGui::SameLine();
          const bool sel = (session.selectedPaintIdx() == pi);
          if (sel) ImGui::PushStyleColor(ImGuiCol_Button, ImVec4(0.14f, 0.56f, 0.86f, 1.0f));
          if (ImGui::SmallButton(pNames[pi])) session.setSelectedPaintIdx(pi);
          if (sel) ImGui::PopStyleColor();
        }
        ImGui::Separator();

        for (size_t k = 0; k < kVehicleModelCount; ++k) {
          const auto kind = static_cast<VehicleModelKind>(k);
          const auto& sp = GameSession::vehicleSpec(kind);
          if (!sp.purchasable) continue;
          const bool owned = session.ownsVehicle(kind);
          ImGui::PushID(static_cast<int>(5500 + k));
          ImGui::TextColored(owned ? ImVec4(0.42f, 0.96f, 0.62f, 1.0f) : ImVec4(0.94f, 0.96f, 1.0f, 1.0f),
                             "%s  (%.0f km/h)", sp.displayName, sp.maxSpeed * 3.6f);
          if (!owned) {
            char buyLbl[64];
            std::snprintf(buyLbl, sizeof(buyLbl), "Order (%s)", formatUsd(sp.dealershipPrice).c_str());
            if (ImGui::SmallButton(buyLbl)) {
              session.buyDealershipVehicle(kind, audio);
            }
          } else {
            if (ImGui::SmallButton("Summon Valet")) {
              session.spawnPersonalVehicle(kind, session.selectedPaintIdx(), player, world, audio, false);
            }
            ImGui::SameLine();
            if (ImGui::SmallButton("Deliver & Drive")) {
              session.spawnPersonalVehicle(kind, session.selectedPaintIdx(), player, world, audio, true);
              ioPhoneOpen = false;
            }
          }
          ImGui::Separator();
          ImGui::PopID();
        }
        ImGui::EndChild();
      }
    }
    // -------------------------------------------------------------------------
    // APP 5: Dynasty 8 Executive Realty ($USD Apartments & Open-World Shop GPS)
    // -------------------------------------------------------------------------
    else if (phone.activeApp == PhoneAppId::Dynasty8) {
      if (drawAppTopHeader(dl, scrTl, scrW, "DYNASTY 8", IM_COL32(217, 119, 6, 255), fBody, fHead, false)) {
        phone.activeApp = PhoneAppId::Home;
      } else {
        ImGui::SetCursorScreenPos({bodyX, bodyY});
        ImGui::PushStyleColor(ImGuiCol_Text, ImVec4(0.10f, 0.13f, 0.20f, 1.0f));
        ImGui::BeginChild("##DynastyBody", {bodyW, bodyH}, false);

        ImGui::TextColored({0.06f, 0.56f, 0.34f, 1.0f}, "AVAILABLE FUNDS: %s", formatUsd(session.playerCash()).c_str());
        ImGui::TextWrapped("Every Sky-Suite includes a private Walk-In Wardrobe & Armory Bench inside.");
        ImGui::Separator();

        for (size_t ai = 0; ai < session.apartments().size(); ++ai) {
          const auto& apt = session.apartments()[ai];
          ImGui::PushID(static_cast<int>(5600 + ai));
          ImGui::TextColored(apt.owned ? ImVec4(0.06f, 0.58f, 0.36f, 1.0f) : ImVec4(0.12f, 0.16f, 0.24f, 1.0f),
                             "%s %s", apt.name.c_str(), apt.owned ? "[OWNED]" : "");
          ImGui::TextColored({0.42f, 0.48f, 0.58f, 1.0f}, "%s", apt.district.c_str());
          ImGui::PushStyleColor(ImGuiCol_Text, ImVec4(1.0f, 1.0f, 1.0f, 1.0f));
          if (!apt.owned) {
            char bLbl[64];
            std::snprintf(bLbl, sizeof(bLbl), "Buy Deed (%s)", formatUsd(apt.price).c_str());
            if (ImGui::SmallButton(bLbl)) session.buyApartment(static_cast<int>(ai), audio);
            ImGui::SameLine();
          }
          if (ImGui::SmallButton("GPSLobby")) {
            session.setGpsWaypoint(apt.doorPos, apt.name);
          }
          ImGui::PopStyleColor();
          ImGui::Separator();
          ImGui::PopID();
        }
        ImGui::EndChild();
        ImGui::PopStyleColor();
      }
    }
    // -------------------------------------------------------------------------
    // APP 6: iFruit Pay ($USD Bank Balance & Full Transaction Ledger)
    // -------------------------------------------------------------------------
    else if (phone.activeApp == PhoneAppId::FruitPay) {
      if (drawAppTopHeader(dl, scrTl, scrW, "iFruit Pay", IM_COL32(255, 255, 255, 255), fBody, fHead, true)) {
        phone.activeApp = PhoneAppId::Home;
      } else {
        // Sleek titanium-gradient iFruit Pay Virtual Card
        const ImVec2 card0(bodyX, bodyY + 4.0f);
        const ImVec2 card1(bodyX + bodyW, bodyY + 114.0f);
        dl->AddRectFilledMultiColor(
          card0, card1,
          IM_COL32(34, 42, 58, 255), IM_COL32(20, 94, 78, 255),
          IM_COL32(14, 62, 54, 255), IM_COL32(22, 26, 36, 255)
        );
        dl->AddRect(card0, card1, IM_COL32(134, 239, 172, 130), 16.0f, 0, 1.2f);
        drawIFruitBowlGlyph(dl, {card1.x - 26.0f, card0.y + 24.0f}, 9.0f, IM_COL32(255, 255, 255, 235));
        dl->AddText(fBody, 11.5f, {card0.x + 14.0f, card0.y + 12.0f}, IM_COL32(186, 230, 212, 240), "WESTGATE CHECKING • USD");
        const std::string balStr = formatUsd(session.playerCash());
        dl->AddText(fTitle, 30.0f, {card0.x + 14.0f, card0.y + 32.0f}, IM_COL32(255, 255, 255, 255), balStr.c_str());
        dl->AddText(fMono, 11.5f, {card0.x + 14.0f, card1.y - 22.0f}, IM_COL32(167, 243, 208, 225), "VOSS, ELIAS   •••• 4918");

        ImGui::SetCursorScreenPos({bodyX, card1.y + 12.0f});
        ImGui::BeginChild("##FruitPayLedger", {bodyW, bodyH - 126.0f}, false);
        ImGui::TextColored({0.58f, 0.86f, 1.0f, 1.0f}, "RECENT TRANSACTIONS");
        ImGui::Separator();
        for (size_t ti = 0; ti < session.bankTransactions().size(); ++ti) {
          const auto& tx = session.bankTransactions()[ti];
          const bool credit = tx.amountUsd >= 0;
          ImGui::TextColored({0.88f, 0.92f, 0.98f, 1.0f}, "%s", tx.description.c_str());
          ImGui::TextDisabled("%s", tx.timeLabel.c_str());
          ImGui::SameLine(bodyW - 96.0f);
          const std::string amt = (credit ? "+" : "") + formatUsd(tx.amountUsd);
          ImGui::TextColored(credit ? ImVec4(0.32f, 0.96f, 0.58f, 1.0f) : ImVec4(1.0f, 0.48f, 0.48f, 1.0f),
                             "%s", amt.c_str());
          ImGui::Separator();
        }
        ImGui::EndChild();
      }
    }
    // -------------------------------------------------------------------------
    // APP 7: Phone Dialer ($USD Open-World Services: Cab, WSPD Scrub, Medic, Valet)
    // -------------------------------------------------------------------------
    else if (phone.activeApp == PhoneAppId::Dialer) {
      if (drawAppTopHeader(dl, scrTl, scrW, "QUICK DIALER", IM_COL32(22, 163, 74, 255), fBody, fHead, false)) {
        phone.activeApp = PhoneAppId::Home;
      } else {
        ImGui::SetCursorScreenPos({bodyX, bodyY});
        ImGui::PushStyleColor(ImGuiCol_Text, ImVec4(0.10f, 0.13f, 0.20f, 1.0f));
        ImGui::BeginChild("##DialerContacts", {bodyW, bodyH}, false);

        ImGui::TextColored({0.08f, 0.58f, 0.34f, 1.0f}, "CITY DISPATCH & CONTACTS (Cash: %s)",
                           formatUsd(session.playerCash()).c_str());
        ImGui::Separator();

        ImGui::PushStyleColor(ImGuiCol_Text, ImVec4(1.0f, 1.0f, 1.0f, 1.0f));
        ImGui::PushStyleColor(ImGuiCol_Button, ImVec4(0.12f, 0.56f, 0.36f, 1.0f));
        if (ImGui::Button("Eddie's Valet — Deliver Starter Car (FREE)", {-1.0f, 32.0f})) {
          session.spawnPersonalVehicle(VehicleModelKind::Golf, session.selectedPaintIdx(), player, world, audio, false);
        }
        const int scrubCost = std::max(1, session.wantedStars()) * 500;
        char scrubLbl[80];
        std::snprintf(scrubLbl, sizeof(scrubLbl), "Fixer Rico — Clear WSPD Heat (%s)",
                      session.wantedStars() > 0 ? formatUsd(scrubCost).c_str() : "No Warrant");
        if (ImGui::Button(scrubLbl, {-1.0f, 32.0f})) {
          session.callBribePolice(audio);
        }
        if (ImGui::Button("St. Jude Trauma — Field Medic ($250)", {-1.0f, 32.0f})) {
          session.callFieldMedic(audio);
        }
        ImGui::PopStyleColor(2);

        ImGui::Spacing();
        ImGui::TextColored({0.78f, 0.46f, 0.06f, 1.0f}, "WESTGATE EXPRESS CAB ($120 FARE):");
        ImGui::PushStyleColor(ImGuiCol_Text, ImVec4(1.0f, 1.0f, 1.0f, 1.0f));
        ImGui::PushStyleColor(ImGuiCol_Button, ImVec4(0.20f, 0.32f, 0.52f, 1.0f));
        struct CabDest { const char* label; glm::vec3 pos; float yaw; };
        const CabDest kDests[5] = {
          {"420 Crescent Safehouse (Armory & Closet)", {-314.0f, world.heightfield.sampleHeight(-314.0f, 316.0f) + 1.0f, 316.0f}, 180.0f},
          {"Downtown Armory & Tailors (Civic)",        {62.0f,   world.heightfield.sampleHeight(62.0f, -134.0f) + 1.0f, -134.0f}, 0.0f},
          {"Del Sol Boardwalk & Gun Club",             {-682.0f, world.heightfield.sampleHeight(-682.0f, 0.0f) + 1.0f,     0.0f}, 90.0f},
          {"Moda Westgate Mall (Midtown)",             {-388.0f, world.heightfield.sampleHeight(-388.0f, -86.0f) + 1.0f, -86.0f}, 0.0f},
          {"Iron Pit Underground Arena",               {world.fightPitPos.x, world.fightPitPos.y + 1.0f, world.fightPitPos.z - 3.0f}, 0.0f},
        };
        for (int ci = 0; ci < 5; ++ci) {
          ImGui::PushID(5700 + ci);
          if (ImGui::Button(kDests[ci].label, {-1.0f, 28.0f})) {
            if (session.callTaxiCab(kDests[ci].pos, kDests[ci].yaw, kDests[ci].label, player, audio)) {
              ioPhoneOpen = false;
            }
          }
          ImGui::PopID();
        }
        ImGui::PopStyleColor(2);

        ImGui::EndChild();
        ImGui::PopStyleColor();
      }
    }
    // -------------------------------------------------------------------------
    // APP 8: SnapCam (Live 3D World Viewfinder HUD + Shutter Flash)
    // -------------------------------------------------------------------------
    else if (phone.activeApp == PhoneAppId::SnapCam) {
      if (drawAppTopHeader(dl, scrTl, scrW, "SNAPCAM", IM_COL32(255, 224, 92, 255), fBody, fHead, true)) {
        phone.activeApp = PhoneAppId::Home;
      } else {
        const ImVec2 vf0(bodyX + 4.0f, bodyY + 8.0f);
        const ImVec2 vf1(bodyX + bodyW - 4.0f, bodyY + bodyH - 86.0f);
        // Rule-of-thirds gridlines
        for (int gi = 1; gi <= 2; ++gi) {
          const float gx = vf0.x + (vf1.x - vf0.x) * (gi / 3.0f);
          const float gy = vf0.y + (vf1.y - vf0.y) * (gi / 3.0f);
          dl->AddLine({gx, vf0.y}, {gx, vf1.y}, IM_COL32(255, 255, 255, 65), 1.0f);
          dl->AddLine({vf0.x, gy}, {vf1.x, gy}, IM_COL32(255, 255, 255, 65), 1.0f);
        }
        dl->AddRect(vf0, vf1, IM_COL32(255, 255, 255, 140), 10.0f, 0, 1.2f);
        // Focus reticle square
        const ImVec2 fc((vf0.x + vf1.x) * 0.5f, (vf0.y + vf1.y) * 0.5f);
        dl->AddRect({fc.x - 24.0f, fc.y - 24.0f}, {fc.x + 24.0f, fc.y + 24.0f}, IM_COL32(255, 214, 52, 225), 4.0f, 0, 1.5f);
        dl->AddText(fMono, 11.5f, {vf0.x + 10.0f, vf1.y - 20.0f}, IM_COL32(255, 232, 120, 240),
                    shortDistrictForPhone(pPos, world));

        if (phone.shutterFlash > 0.0f) {
          dl->AddRectFilled(vf0, vf1, IM_COL32(255, 255, 255, static_cast<int>(phone.shutterFlash * 220.0f)), 10.0f);
        }

        // Shutter round button at bottom of SnapCam
        const ImVec2 shC(scrTl.x + scrW * 0.5f, scrBr.y - 54.0f);
        ImGui::SetCursorScreenPos({shC.x - 28.0f, shC.y - 28.0f});
        if (ImGui::InvisibleButton("##SnapShutter", {56.0f, 56.0f})) {
          phone.shutterFlash = 1.0f;
          if (audio) audio->playCashChime();
          session.triggerCommsLine("iFRUIT SNAPCAM", "Photo saved to iFruit Roll (" + std::string(shortDistrictForPhone(pPos, world)) + ").", "", nullptr);
        }
        dl->AddCircle(shC, 26.0f, IM_COL32(255, 255, 255, 245), 28, 3.0f);
        dl->AddCircleFilled(shC, 20.5f, IM_COL32(255, 255, 255, 245), 24);
      }
    }
    // -------------------------------------------------------------------------
    // APP 9: CityMaps (Open-World Armory, Boutique, Customs & Landmark GPS)
    // -------------------------------------------------------------------------
    else if (phone.activeApp == PhoneAppId::CityMaps) {
      if (drawAppTopHeader(dl, scrTl, scrW, "CITY MAPS GPS", IM_COL32(14, 134, 224, 255), fBody, fHead, false)) {
        phone.activeApp = PhoneAppId::Home;
      } else {
        ImGui::SetCursorScreenPos({bodyX, bodyY});
        ImGui::PushStyleColor(ImGuiCol_Text, ImVec4(0.10f, 0.13f, 0.20f, 1.0f));
        ImGui::BeginChild("##MapsBody", {bodyW, bodyH}, false);

        ImGui::TextWrapped("All weapon & outfit customization takes place in person at physical Armories & Boutiques:");
        const char* fNames[3] = {"Shops", "Garages", "Districts"};
        ImGui::PushStyleColor(ImGuiCol_Text, ImVec4(1.0f, 1.0f, 1.0f, 1.0f));
        const float mapTabW = (ImGui::GetContentRegionAvail().x - 16.0f) / 3.0f;
        for (int fi = 0; fi < 3; ++fi) {
          if (fi > 0) ImGui::SameLine();
          const bool sel = (phone.mapsFilter == fi);
          if (sel) ImGui::PushStyleColor(ImGuiCol_Button, ImVec4(0.08f, 0.52f, 0.88f, 1.0f));
          if (ImGui::Button(fNames[fi], {mapTabW, 24.0f})) {
            phone.mapsFilter = fi;
          }
          if (sel) ImGui::PopStyleColor();
        }
        if (session.hasGpsWaypoint()) {
          if (ImGui::SmallButton("Clear Active GPS Waypoint")) {
            session.clearGpsWaypoint();
          }
        }
        ImGui::PopStyleColor();
        ImGui::Separator();

        if (phone.mapsFilter == 0 || phone.mapsFilter == 1) {
          for (size_t si = 0; si < session.shops().size(); ++si) {
            const auto& s = session.shops()[si];
            const bool isCustShop = (s.kind == ShopKind::Armory || s.kind == ShopKind::Boutique);
            if ((phone.mapsFilter == 0 && !isCustShop) || (phone.mapsFilter == 1 && isCustShop)) continue;

            const int distM = static_cast<int>(glm::distance(glm::vec2(pPos.x, pPos.z), glm::vec2(s.pos.x, s.pos.z)));
            ImGui::PushID(static_cast<int>(5800 + si));
            const ImVec4 tagCol = (s.kind == ShopKind::Armory) ? ImVec4(0.78f, 0.44f, 0.04f, 1.0f)
                                : ((s.kind == ShopKind::Boutique) ? ImVec4(0.76f, 0.16f, 0.58f, 1.0f)
                                : ImVec4(0.12f, 0.48f, 0.32f, 1.0f));
            ImGui::TextColored(tagCol, "%s (%dm)", s.name.c_str(), distM);
            ImGui::PushStyleColor(ImGuiCol_Text, ImVec4(1.0f, 1.0f, 1.0f, 1.0f));
            if (ImGui::SmallButton("Set GPS Route")) {
              session.setGpsWaypoint(s.pos, s.name);
            }
            ImGui::PopStyleColor();
            ImGui::Separator();
            ImGui::PopID();
          }
        } else {
          for (size_t ti = 0; ti < world.teleports.size(); ++ti) {
            const auto& tp = world.teleports[ti];
            const int distM = static_cast<int>(glm::distance(glm::vec2(pPos.x, pPos.z), glm::vec2(tp.pos.x, tp.pos.z)));
            ImGui::PushID(static_cast<int>(5900 + ti));
            ImGui::Text("%s (%dm)", tp.label.c_str(), distM);
            ImGui::PushStyleColor(ImGuiCol_Text, ImVec4(1.0f, 1.0f, 1.0f, 1.0f));
            if (ImGui::SmallButton("Set GPS")) {
              session.setGpsWaypoint(tp.pos, tp.label);
            }
            ImGui::PopStyleColor();
            ImGui::Separator();
            ImGui::PopID();
          }
        }

        ImGui::EndChild();
        ImGui::PopStyleColor();
      }
    }
    // -------------------------------------------------------------------------
    // APP 10: Settings (Read-Only PearOS Policy, Biometrics, Difficulty & Save)
    // -------------------------------------------------------------------------
    else if (phone.activeApp == PhoneAppId::Settings) {
      if (drawAppTopHeader(dl, scrTl, scrW, "SETTINGS", IM_COL32(30, 41, 59, 255), fBody, fHead, false)) {
        phone.activeApp = PhoneAppId::Home;
      } else {
        ImGui::SetCursorScreenPos({bodyX, bodyY});
        ImGui::PushStyleColor(ImGuiCol_Text, ImVec4(0.10f, 0.13f, 0.20f, 1.0f));
        ImGui::BeginChild("##PearSettingsBody", {bodyW, bodyH}, false);

        ImGui::TextColored({0.08f, 0.48f, 0.82f, 1.0f}, "iFRUIT PHONE 15iX  •  PearOS 15.4");
        ImGui::TextDisabled("Home Layout: Locked (Fixed App & Widget Order)");
        ImGui::TextDisabled("Customization: Open-World Armories & Boutiques Only");
        ImGui::Separator();

        ImGui::Text("Combat Difficulty:");
        ImGui::PushStyleColor(ImGuiCol_Text, ImVec4(1.0f, 1.0f, 1.0f, 1.0f));
        if (ImGui::Button(GameSession::difficultyLabel(session.difficulty()), {-1.0f, 26.0f})) {
          session.setDifficulty(static_cast<DifficultyMode>((static_cast<int>(session.difficulty()) + 1) % 3));
        }
        if (ImGui::Button("Quick Save Checkpoint to Disk", {-1.0f, 26.0f})) {
          if (session.saveToFile(savePath) && audio) {
            audio->playCashChime();
          }
        }
        ImGui::PopStyleColor();

        ImGui::Separator();
        ImGui::TextColored({0.78f, 0.44f, 0.06f, 1.0f}, "OPERATIVE BIOMETRICS (READ-ONLY):");
        ImGui::PushStyleColor(ImGuiCol_Text, ImVec4(1.0f, 1.0f, 1.0f, 1.0f));
        for (size_t bi = 0; bi < kBodyStatCount; ++bi) {
          const auto kind = static_cast<BodyStatKind>(bi);
          const float val = session.bodyStatValue(kind);
          char lbl[64];
          std::snprintf(lbl, sizeof(lbl), "%s: %.0f / 100", GameSession::bodyStatName(kind), val);
          ImGui::ProgressBar(val / 100.0f, {-1.0f, 14.0f}, lbl);
        }
        ImGui::PopStyleColor();

        ImGui::EndChild();
        ImGui::PopStyleColor();
      }
    }
    // -------------------------------------------------------------------------
    // APP 11: Read-Only Weather Forecast Detail (Clicked Weather Widget)
    // -------------------------------------------------------------------------
    else if (phone.activeApp == PhoneAppId::WeatherView) {
      if (drawAppTopHeader(dl, scrTl, scrW, "BAY WEATHER", IM_COL32(255, 255, 255, 255), fBody, fHead, true)) {
        phone.activeApp = PhoneAppId::Home;
      } else {
        const char* dist = shortDistrictForPhone(pPos, world);
        const int curTemp = computeCelsiusTemp(session.timeOfDayHours(), session.weatherLabel());
        const ImVec2 dSz = fHead->CalcTextSizeA(22.0f, bodyW, 0.0f, dist);
        dl->AddText(fHead, 22.0f, {scrTl.x + (scrW - dSz.x) * 0.5f, bodyY + 12.0f}, IM_COL32(255, 255, 255, 255), dist);
        char tStr[16];
        std::snprintf(tStr, sizeof(tStr), "%d°C", curTemp);
        const ImVec2 tSz = fTitle->CalcTextSizeA(48.0f, bodyW, 0.0f, tStr);
        dl->AddText(fTitle, 48.0f, {scrTl.x + (scrW - tSz.x) * 0.5f, bodyY + 42.0f}, IM_COL32(255, 255, 255, 255), tStr);
        const std::string cond = session.weatherLabel() + "  •  " + session.timeOfDayLabel();
        const ImVec2 cSz = fBody->CalcTextSizeA(14.0f, bodyW, 0.0f, cond.c_str());
        dl->AddText(fBody, 14.0f, {scrTl.x + (scrW - cSz.x) * 0.5f, bodyY + 100.0f}, IM_COL32(224, 242, 254, 245), cond.c_str());

        // 4-slot Forecast Card
        const ImVec2 fc0(bodyX, bodyY + 144.0f);
        const ImVec2 fc1(bodyX + bodyW, bodyY + 292.0f);
        dl->AddRectFilled(fc0, fc1, IM_COL32(255, 255, 255, 38), 16.0f);
        dl->AddText(fBody, 12.0f, {fc0.x + 14.0f, fc0.y + 12.0f}, IM_COL32(224, 242, 254, 240), "24-HOUR COASTAL OUTLOOK");
        const char* slots[4] = {"06:00 Dawn", "13:00 Peak", "18:30 Sunset", "00:00 Night"};
        const char* temps[4] = {"22°C Clear", "32°C Sunny", "28°C Breeze", "20°C Calm"};
        for (int si = 0; si < 4; ++si) {
          const float ry = fc0.y + 38.0f + si * 26.0f;
          dl->AddText(fBody, 13.0f, {fc0.x + 16.0f, ry}, IM_COL32(255, 255, 255, 245), slots[si]);
          dl->AddText(fMono, 13.0f, {fc1.x - 104.0f, ry}, IM_COL32(254, 240, 138, 250), temps[si]);
        }
      }
    }

    // Bottom Gesture Home Bar (Click to return to Locked Home Screen)
    const ImVec2 hb0(scrTl.x + (scrW - 118.0f) * 0.5f, scrBr.y - 18.0f);
    const ImVec2 hb1(hb0.x + 118.0f, scrBr.y - 8.0f);
    ImGui::SetCursorScreenPos({hb0.x - 12.0f, hb0.y - 8.0f});
    if (ImGui::InvisibleButton("##PearGestureHomeBar", {142.0f, 22.0f})) {
      phone.activeApp = PhoneAppId::Home;
    }
    const ImU32 barCol = darkAppTheme ? IM_COL32(255, 255, 255, 210) : IM_COL32(30, 41, 59, 185);
    dl->AddRectFilled({hb0.x, scrBr.y - 13.0f}, {hb1.x, scrBr.y - 8.5f}, barCol, 3.0f);
    ImGui::PopStyleColor(); // ImGuiCol_ChildBg
  }

  dl->PopClipRect();
  // Crisp inner OLED rim highlight
  dl->AddRect(scrTl, scrBr, IM_COL32(255, 255, 255, 34), 38.0f, 0, 1.0f);

  ImGui::End();
  ImGui::PopStyleVar(2);
}

} // namespace westgate
