#include "westgate/GameHud.hpp"
#include "imgui.h"
#include <algorithm>
#include <cmath>
#include <cstddef>
#include <cstdio>

namespace westgate {

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
) {
  const ImGuiViewport* vp = ImGui::GetMainViewport();
  const ImVec2 disp = vp->Size;
  ImDrawList* bgDraw = ImGui::GetBackgroundDrawList();
  const glm::vec3 pPos = player.position();

  // -------------------------------------------------------------------------
  // 1. Center Crosshair, Sniper Scope Overlay & Hitmarker
  // -------------------------------------------------------------------------
  if ((ui.mouseCaptured || session.isAiming()) && !ui.showPhone) {
    const ImVec2 c(disp.x * 0.5f, disp.y * 0.5f);
    const auto& actW = session.activeWeapon();
    const bool armed = !actW.isMelee && !session.inVehicle();
    const bool scopeAds = armed && session.isAiming() && actW.optic == WeaponOpticKind::SniperScope;

    if (scopeAds) {
      const float r = std::min(disp.x, disp.y) * 0.39f;
      bgDraw->AddCircle(c, r, IM_COL32(18, 28, 36, 245), 64, 18.0f);
      bgDraw->AddCircle(c, r - 9.0f, IM_COL32(95, 225, 255, 190), 64, 1.5f);
      bgDraw->AddLine({c.x - r, c.y}, {c.x + r, c.y}, IM_COL32(20, 35, 45, 215), 1.3f);
      bgDraw->AddLine({c.x, c.y - r}, {c.x, c.y + r}, IM_COL32(20, 35, 45, 215), 1.3f);
      for (int md = -4; md <= 4; ++md) {
        if (md == 0) continue;
        bgDraw->AddCircleFilled({c.x + md * 24.0f, c.y}, 2.0f, IM_COL32(95, 235, 255, 210));
        bgDraw->AddCircleFilled({c.x, c.y + md * 24.0f}, 2.0f, IM_COL32(95, 235, 255, 210));
      }
      bgDraw->AddCircleFilled(c, 2.4f, IM_COL32(255, 65, 65, 245));
    } else {
      const ImU32 crossCol = armed ? IM_COL32(235, 245, 255, 210) : IM_COL32(220, 220, 220, 120);
      bgDraw->AddLine({c.x - 9.0f, c.y}, {c.x - 3.0f, c.y}, crossCol, 1.8f);
      bgDraw->AddLine({c.x + 3.0f, c.y}, {c.x + 9.0f, c.y}, crossCol, 1.8f);
      bgDraw->AddLine({c.x, c.y - 9.0f}, {c.x, c.y - 3.0f}, crossCol, 1.8f);
      bgDraw->AddLine({c.x, c.y + 3.0f}, {c.x, c.y + 9.0f}, crossCol, 1.8f);
      bgDraw->AddCircleFilled(c, 1.8f, crossCol);
    }

    if (session.hitmarkerTimer() > 0.0f) {
      const ImU32 hmCol = session.lastHitHeadshot()
        ? IM_COL32(255, 215, 55, 255)
        : IM_COL32(255, 75, 75, 240);
      bgDraw->AddLine({c.x - 11.0f, c.y - 11.0f}, {c.x - 4.0f, c.y - 4.0f}, hmCol, 2.4f);
      bgDraw->AddLine({c.x + 4.0f, c.y - 4.0f}, {c.x + 11.0f, c.y - 11.0f}, hmCol, 2.4f);
      bgDraw->AddLine({c.x - 11.0f, c.y + 11.0f}, {c.x - 4.0f, c.y + 4.0f}, hmCol, 2.4f);
      bgDraw->AddLine({c.x + 4.0f, c.y + 4.0f}, {c.x + 11.0f, c.y + 11.0f}, hmCol, 2.4f);
    }
  }

  // -------------------------------------------------------------------------
  // 2. Top-Right GTA-Style Minimap + Wanted Stars
  // -------------------------------------------------------------------------
  {
    const float mapSize = 176.0f;
    const ImVec2 tl(disp.x - mapSize - 16.0f, 16.0f);
    const ImVec2 br(tl.x + mapSize, tl.y + mapSize);
    const ImVec2 center((tl.x + br.x) * 0.5f, (tl.y + br.y) * 0.5f);
    constexpr float kScale = 0.42f; // pixels per meter

    bgDraw->PushClipRect(tl, br, true);
    bgDraw->AddRectFilled(tl, br, IM_COL32(16, 28, 44, 225), 10.0f);

    auto worldToMap = [&](float wx, float wz) -> ImVec2 {
      return {center.x + (wx - pPos.x) * kScale, center.y + (wz - pPos.z) * kScale};
    };

    // Draw nearby roads onto minimap
    for (const auto& road : world.roads) {
      if (road.samples.size() < 2) continue;
      for (size_t i = 0; i + 1 < road.samples.size(); ++i) {
        const ImVec2 a = worldToMap(road.samples[i].pos.x, road.samples[i].pos.z);
        const ImVec2 b = worldToMap(road.samples[i + 1].pos.x, road.samples[i + 1].pos.z);
        if ((a.x < tl.x - 20 && b.x < tl.x - 20) || (a.x > br.x + 20 && b.x > br.x + 20)) continue;
        bgDraw->AddLine(a, b, IM_COL32(88, 102, 122, 220), std::max(1.5f, road.width * kScale * 0.35f));
      }
    }

    // Shops, Garages & Luxury Auto Dealership
    for (const auto& s : session.shops()) {
      const ImVec2 sp = worldToMap(s.pos.x, s.pos.z);
      bgDraw->AddCircleFilled(sp, 3.5f, s.isGarage ? IM_COL32(175, 95, 255, 235) : IM_COL32(45, 215, 115, 235));
    }
    {
      const ImVec2 dp = worldToMap(56.0f, -118.0f);
      bgDraw->AddCircleFilled(dp, 4.2f, IM_COL32(255, 198, 52, 245));
      bgDraw->AddCircle(dp, 6.2f, IM_COL32(255, 245, 190, 210), 12, 1.3f);
    }

    // Personal Vehicle & Active Police Pursuit Cruisers on Minimap
    for (const auto& v : session.vehicles()) {
      if (v.destroyed) continue;
      if (v.id == session.activePersonalVehicleId() && !v.occupiedByPlayer) {
        const ImVec2 vp = worldToMap(v.pos.x, v.pos.z);
        bgDraw->AddCircleFilled(vp, 4.4f, IM_COL32(72, 215, 255, 250));
        bgDraw->AddCircle(vp, 6.4f, IM_COL32(255, 255, 255, 215), 12, 1.3f);
      } else if (v.isPolicePursuit) {
        const ImVec2 vp = worldToMap(v.pos.x, v.pos.z);
        const bool flash = std::fmod(elapsedSec * 6.0f, 1.0f) < 0.5f;
        bgDraw->AddCircleFilled(vp, 4.0f, flash ? IM_COL32(255, 50, 50, 255) : IM_COL32(55, 145, 255, 255));
      }
    }

    // NPCs / Police / Contract Target
    for (const auto& n : session.npcs()) {
      if (!n.alive) continue;
      const ImVec2 np = worldToMap(n.pos.x, n.pos.z);
      if (n.isContractTarget) {
        bgDraw->AddCircleFilled(np, 5.2f, IM_COL32(255, 60, 60, 255));
        bgDraw->AddCircle(np, 7.5f, IM_COL32(255, 220, 90, 230), 12, 1.5f);
      } else if (n.isPolice) {
        const bool flash = std::fmod(elapsedSec * 5.0f, 1.0f) < 0.5f;
        bgDraw->AddCircleFilled(np, 3.8f, flash ? IM_COL32(245, 55, 55, 255) : IM_COL32(60, 145, 255, 255));
      }
    }

    // GPS Waypoint
    if (session.hasGpsWaypoint()) {
      const glm::vec3 wp = session.gpsWaypoint();
      ImVec2 mp = worldToMap(wp.x, wp.z);
      mp.x = std::clamp(mp.x, tl.x + 8.0f, br.x - 8.0f);
      mp.y = std::clamp(mp.y, tl.y + 8.0f, br.y - 8.0f);
      bgDraw->AddCircleFilled(mp, 5.0f, IM_COL32(50, 220, 255, 255));
      bgDraw->AddCircle(mp, 7.2f, IM_COL32(255, 255, 255, 200), 12, 1.5f);
    }

    // Player heading triangle
    const float yaw = player.yaw();
    const ImVec2 fwd(std::sin(yaw), std::cos(yaw));
    const ImVec2 right(fwd.y, -fwd.x);
    bgDraw->AddTriangleFilled(
      {center.x + fwd.x * 7.5f, center.y + fwd.y * 7.5f},
      {center.x - fwd.x * 5.0f + right.x * 5.0f, center.y - fwd.y * 5.0f + right.y * 5.0f},
      {center.x - fwd.x * 5.0f - right.x * 5.0f, center.y - fwd.y * 5.0f - right.y * 5.0f},
      IM_COL32(255, 235, 80, 255)
    );
    bgDraw->PopClipRect();
    bgDraw->AddRect(tl, br, IM_COL32(110, 155, 205, 190), 10.0f, 0, 2.0f);

    // Wanted Stars row under minimap
    if (session.wantedStars() > 0) {
      const bool sirenPhase = std::fmod(elapsedSec * 4.0f, 1.0f) < 0.5f;
      char starsBuf[64];
      std::snprintf(starsBuf, sizeof(starsBuf), "WANTED  %.*s%.*s",
                    session.wantedStars(), "*****",
                    5 - session.wantedStars(), ".....");
      bgDraw->AddRectFilled({tl.x, br.y + 6.0f}, {br.x, br.y + 30.0f},
                            sirenPhase ? IM_COL32(150, 24, 34, 215) : IM_COL32(24, 52, 145, 215), 6.0f);
      bgDraw->AddText({tl.x + 12.0f, br.y + 11.0f}, IM_COL32(255, 255, 255, 255), starsBuf);
    }
  }

  // -------------------------------------------------------------------------
  // 3. Bottom-Right Cash / Vitals / Weapon / Drivetrain Speedometer & RPM
  // -------------------------------------------------------------------------
  {
    const bool drivingHud = session.inVehicle() && session.currentVehicle() != nullptr;
    const float boxH = drivingHud ? 174.0f : 132.0f;
    ImGui::SetNextWindowPos({disp.x - 324.0f, disp.y - boxH - 16.0f}, ImGuiCond_Always);
    ImGui::SetNextWindowSize({308.0f, boxH}, ImGuiCond_Always);
    ImGui::SetNextWindowBgAlpha(0.80f);
    ImGui::Begin("##StatusBox", nullptr, ImGuiWindowFlags_NoTitleBar | ImGuiWindowFlags_NoResize | ImGuiWindowFlags_NoMove | ImGuiWindowFlags_NoScrollbar);
    ImGui::TextColored({0.35f, 0.94f, 0.52f, 1.0f}, "$%d   |   %s (%02d:%02d)",
                       session.playerCash(),
                       session.timeOfDayLabel().c_str(),
                       static_cast<int>(session.timeOfDayHours()) % 24,
                       static_cast<int>((session.timeOfDayHours() - std::floor(session.timeOfDayHours())) * 60.0f));
    ImGui::ProgressBar(session.playerHp() / session.playerMaxHp(), {-1, 13}, "PLAYER HP");
    if (drivingHud) {
      const auto* cv = session.currentVehicle();
      const auto& sp = GameSession::vehicleSpec(cv->kind);
      char vehHpLabel[64];
      std::snprintf(vehHpLabel, sizeof(vehHpLabel), "CHASSIS %.0f%%", std::clamp(cv->hp, 0.0f, 100.0f));
      ImGui::ProgressBar(std::clamp(cv->hp / 100.0f, 0.0f, 1.0f), {-1, 13}, vehHpLabel);

      const float kmh = glm::length(glm::vec3(cv->speed, cv->verticalVel, 0.0f)) * 3.6f;
      if (cv->isAircraft) {
        ImGui::TextColored({0.95f, 0.84f, 0.36f, 1.0f}, "%s  |  %.0f KM/H  |  ALT %.0fm",
                           sp.displayName, kmh, std::max(0.0f, cv->pos.y));
        ImGui::TextDisabled("[Space/C] Climb/Descend  [V] Cam  [G] Exit");
      } else if (cv->isBoat) {
        ImGui::TextColored({0.42f, 0.88f, 0.98f, 1.0f}, "%s  |  %.0f KTS (%.0f KM/H)",
                           sp.displayName, kmh * 0.54f, kmh);
        ImGui::TextDisabled("[W/S] Throttle  [A/D] Rudder  [V] Cam  [G] Exit");
      } else {
        const char gearCh = (cv->gear < 0) ? 'R' : static_cast<char>('0' + std::clamp(cv->gear, 1, 9));
        char stageTag[16] = "";
        if (cv->engineStage > 0) std::snprintf(stageTag, sizeof(stageTag), " [STG%d]", cv->engineStage);
        ImGui::TextColored({0.96f, 0.86f, 0.40f, 1.0f}, "%s%s  |  %.0f KM/H  [G%c]",
                           sp.displayName, stageTag, std::abs(cv->speed) * 3.6f, gearCh);
        char rpmLbl[48];
        std::snprintf(rpmLbl, sizeof(rpmLbl), "%.0f RPM  ([Space] Drift  [V] Cam)", cv->rpm);
        const float rpmNorm = std::clamp((cv->rpm - sp.idleRpm) / std::max(500.0f, sp.redlineRpm - sp.idleRpm), 0.0f, 1.0f);
        ImGui::ProgressBar(rpmNorm, {-1, 13}, rpmLbl);
      }
    } else {
      ImGui::ProgressBar(session.playerArmor() / 100.0f, {-1, 13}, "ARMOR");
      const auto& w = session.activeWeapon();
      if (w.isMelee) {
        ImGui::Text("WEAPON: %s  (Stamina %.0f%%)", w.shortName.c_str(), session.playerStamina());
      } else {
        ImGui::Text("WEAPON: %s   %d / %d", w.shortName.c_str(), w.magAmmo, w.reserveAmmo);
      }
    }
    ImGui::End();
  }

  // -------------------------------------------------------------------------
  // 4. Center Toast & Context Interaction Banner
  // -------------------------------------------------------------------------
  if (session.toastTimer() > 0.0f && !session.toastText().empty()) {
    const ImVec2 ts = ImGui::CalcTextSize(session.toastText().c_str());
    const float bx = (disp.x - ts.x) * 0.5f - 18.0f;
    bgDraw->AddRectFilled({bx, 22.0f}, {bx + ts.x + 36.0f, 52.0f}, IM_COL32(12, 22, 36, 225), 8.0f);
    bgDraw->AddRect({bx, 22.0f}, {bx + ts.x + 36.0f, 52.0f}, IM_COL32(72, 185, 255, 220), 8.0f);
    bgDraw->AddText({bx + 18.0f, 30.0f}, IM_COL32(245, 250, 255, 255), session.toastText().c_str());
  }

  if (!session.contextPrompt().empty()) {
    const ImVec2 ts = ImGui::CalcTextSize(session.contextPrompt().c_str());
    const float bx = (disp.x - ts.x) * 0.5f - 16.0f;
    const float by = disp.y - 68.0f;
    bgDraw->AddRectFilled({bx, by}, {bx + ts.x + 32.0f, by + 30.0f}, IM_COL32(14, 24, 38, 220), 6.0f);
    bgDraw->AddText({bx + 16.0f, by + 8.0f}, IM_COL32(255, 232, 120, 255), session.contextPrompt().c_str());
  }

  // Tactical Radio Comms & Voiceover Subtitle Banner
  if (session.commsTimer() > 0.0f && !session.commsSubtitle().empty()) {
    const std::string line = "[" + session.commsSpeaker() + "]  " + session.commsSubtitle();
    const ImVec2 ts = ImGui::CalcTextSize(line.c_str());
    const float bx = (disp.x - ts.x) * 0.5f - 18.0f;
    const float by = disp.y - 108.0f;
    bgDraw->AddRectFilled({bx, by}, {bx + ts.x + 36.0f, by + 30.0f}, IM_COL32(8, 16, 26, 232), 6.0f);
    bgDraw->AddRect({bx, by}, {bx + ts.x + 36.0f, by + 30.0f}, IM_COL32(72, 205, 195, 210), 6.0f);
    bgDraw->AddText({bx + 18.0f, by + 8.0f}, IM_COL32(195, 245, 255, 255), line.c_str());
  }

  // Active Iron Pit Boss Bar or Live AI-vs-AI Spectator Cage Bout (when nearby)
  const float pitDist = glm::distance(glm::vec2(pPos.x, pPos.z), glm::vec2(world.fightPitPos.x, world.fightPitPos.z));
  if (pitDist < 22.0f) {
    const auto& spec = session.spectatorBout();
    if (spec.active) {
      const auto& roster = session.pitRoster();
      const auto& rf = roster[static_cast<size_t>(spec.red.fighterIdx)];
      const auto& bf = roster[static_cast<size_t>(spec.blue.fighterIdx)];
      ImGui::SetNextWindowPos({disp.x * 0.5f - 230.0f, 64.0f}, ImGuiCond_Always);
      ImGui::SetNextWindowSize({460.0f, 118.0f}, ImGuiCond_Always);
      ImGui::SetNextWindowBgAlpha(0.86f);
      ImGui::Begin("##SpectatorPitBar", nullptr, ImGuiWindowFlags_NoTitleBar | ImGuiWindowFlags_NoResize | ImGuiWindowFlags_NoMove);
      ImGui::TextColored({1.0f, 0.78f, 0.25f, 1.0f}, "LIVE CAGE BOUT (%.1fs)  |  Ticket: %s $%d",
                         spec.elapsed, spec.betCorner == 0 ? "RED" : "BLUE", spec.betWager);
      ImGui::TextColored({1.0f, 0.35f, 0.35f, 1.0f}, "RED: %s", rf.name.c_str());
      ImGui::ProgressBar(spec.red.hp / std::max(1.0f, spec.red.maxHp), {-1, 14});
      ImGui::TextColored({0.35f, 0.65f, 1.0f, 1.0f}, "BLUE: %s", bf.name.c_str());
      ImGui::ProgressBar(spec.blue.hp / std::max(1.0f, spec.blue.maxHp), {-1, 14});
      ImGui::End();
    } else {
      const auto& pit = session.ironPit();
      ImGui::SetNextWindowPos({disp.x * 0.5f - 220.0f, 64.0f}, ImGuiCond_Always);
      ImGui::SetNextWindowSize({440.0f, 112.0f}, ImGuiCond_Always);
      ImGui::SetNextWindowBgAlpha(0.84f);
      ImGui::Begin("##IronPitBar", nullptr, ImGuiWindowFlags_NoTitleBar | ImGuiWindowFlags_NoResize | ImGuiWindowFlags_NoMove);
      ImGui::Text("IRON PIT TIER %d/5: %s  (Purse $%d | Streak %d)", pit.tier, pit.opponentName.c_str(), pit.purse, pit.winStreak);
      ImGui::ProgressBar(pit.hp / std::max(1.0f, pit.maxHp), {-1, 16}, pit.defeated ? "KO! Press [R]" : nullptr);
      if (pit.betActive) {
        ImGui::TextColored({0.3f, 0.95f, 0.45f, 1.0f}, "ACTIVE BET: $%d @ %.2fx (Net $%d)", pit.betWager, pit.betOdds, pit.betProfit);
      } else if (!pit.defeated) {
        if (ImGui::SmallButton("Bet $100")) session.placeIronPitBet(100);
        ImGui::SameLine();
        if (ImGui::SmallButton("Bet $250")) session.placeIronPitBet(250);
        ImGui::SameLine();
        if (ImGui::SmallButton("Bet $500")) session.placeIronPitBet(500);
        ImGui::SameLine();
        if (ImGui::SmallButton("Cutman +75HP ($50)")) session.buyCutmanHeal();
      } else {
        ImGui::Text("Bet Wins: %d | Net Profit: $%d", pit.betWins, pit.betProfit);
      }
      ImGui::End();
    }
  }

  // -------------------------------------------------------------------------
  // 5. F9 Telemetry Panel (Left)
  // -------------------------------------------------------------------------
  if (ui.showTelemetry) {
    ImGui::SetNextWindowPos({14.0f, 14.0f}, ImGuiCond_FirstUseEver);
    ImGui::SetNextWindowBgAlpha(0.78f);
    ImGui::Begin("Westgate Engine [F9]  |  Phone [P]", &ui.showTelemetry, ImGuiWindowFlags_AlwaysAutoResize);
    ImGui::Text("GPU: %s", gpu.adapterName().c_str());
    ImGui::Text("FPS: %.1f (%.2f ms) | Pos: (%.1f, %.1f, %.1f)", fps, 1000.0f / std::max(1.0f, fps), pPos.x, pPos.y, pPos.z);
    ImGui::Text("Chunks: %u vis (%u near, %u lod) | Bldgs: %u | Props: %u | Veh: %u | NPCs: %u",
                telemetry.visibleChunks, telemetry.nearChunks, telemetry.lodChunks,
                telemetry.drawnBuildings, telemetry.drawnProps, telemetry.drawnVehicles, telemetry.drawnCharacters);
    ImGui::Text("Jolt Static: %u | Dyn Rigid: %u | Lights: %u | GLB Types: %u | Sky: %s | Wx: %s",
                physics.staticBodyCount(), physics.dynamicBodyCount(), telemetry.activePointLights,
                telemetry.glbPropTypesLoaded, session.timeOfDayLabel().c_str(), session.weatherLabel().c_str());
    ImGui::Separator();
    ImGui::Text("[TAB] Mouse Look: %s | [1-6] Weapons | [G] Vehicle | [T] Sky | [Y] Weather | [P] Phone", ui.mouseCaptured ? "ON" : "OFF");
    if (ImGui::Button("Toggle Phone [P]")) ui.showPhone = !ui.showPhone;
    ImGui::SameLine();
    if (ImGui::Button("Cycle Sky [T]")) session.cycleTimeOfDay();
    ImGui::SameLine();
    if (ImGui::Button("Weather [Y]")) session.cycleWeather();
    ImGui::SameLine();
    if (ImGui::Button("Iron Pit [F1]")) session.teleportTo({world.fightPitPos.x, world.fightPitPos.y + 1.0f, world.fightPitPos.z - 2.6f}, 0.0f, player);
    ImGui::End();
  }

  // -------------------------------------------------------------------------
  // 6. Tactical Phone Overlay [P] (Contracts, Races, Gun Runner, GPS/Save)
  // -------------------------------------------------------------------------
  if (ui.showPhone) {
    ImGui::SetNextWindowPos({disp.x * 0.5f - 260.0f, disp.y * 0.5f - 215.0f}, ImGuiCond_FirstUseEver);
    ImGui::SetNextWindowSize({520.0f, 435.0f}, ImGuiCond_FirstUseEver);
    ImGui::SetNextWindowBgAlpha(0.92f);
    if (ImGui::Begin("Westgate Tactical Phone [P]", &ui.showPhone)) {
      if (ImGui::BeginTabBar("PhoneTabs")) {
        if (ImGui::BeginTabItem("Contracts")) {
          for (size_t i = 0; i < session.contracts().size(); ++i) {
            const auto& c = session.contracts()[i];
            ImGui::PushID(static_cast<int>(i));
            ImGui::Text("%s: %s - %s (%s)", c.code.c_str(), c.title.c_str(), c.targetName.c_str(), c.district.c_str());
            ImGui::TextColored({0.4f, 0.9f, 0.5f, 1.0f}, "Payout: $%d (+$%d Unseen)  %s",
                               c.rewardBase, c.unseenBonus, c.completed ? "[COMPLETED]" : "");
            if (ImGui::Button("Accept & Track GPS")) {
              session.acceptContract(static_cast<int>(i), world);
            }
            ImGui::Separator();
            ImGui::PopID();
          }
          ImGui::EndTabItem();
        }

        if (ImGui::BeginTabItem("Races & Pit")) {
          ImGui::Text("Iron Pit Championship (Wins: %d | Tier: %d/5 | Bookie Net: $%d)",
                      session.ironPit().wins, session.ironPit().tier, session.ironPit().betProfit);
          if (ImGui::Button("Teleport to Iron Pit (722, 115)")) {
            session.teleportTo({world.fightPitPos.x, world.fightPitPos.y + 1.0f, world.fightPitPos.z - 2.6f}, 0.0f, player);
            session.setGpsWaypoint(world.fightPitPos, "Iron Pit Arena");
          }
          ImGui::SameLine();
          if (ImGui::Button("New Fight Card")) {
            session.refreshFightCard();
          }
          ImGui::Separator();
          ImGui::TextColored({1.0f, 0.78f, 0.28f, 1.0f}, "Viktor's 3-Match Underground Fight Card (AI-vs-AI Cage Bouts):");
          const auto& roster = session.pitRoster();
          const auto& card = session.pitCard();
          for (size_t mi = 0; mi < card.size(); ++mi) {
            const auto& m = card[mi];
            if (static_cast<size_t>(m.redIdx) >= roster.size() || static_cast<size_t>(m.blueIdx) >= roster.size()) continue;
            const auto& rf = roster[static_cast<size_t>(m.redIdx)];
            const auto& bf = roster[static_cast<size_t>(m.blueIdx)];
            ImGui::PushID(static_cast<int>(500 + mi));
            ImGui::Text("Bout %zu: %s (%.2fx) vs %s (%.2fx) %s",
                        mi + 1, rf.name.c_str(), m.redOdds, bf.name.c_str(), m.blueOdds,
                        m.settled ? "[SETTLED]" : "");
            if (!m.settled && !session.spectatorBout().active) {
              if (ImGui::SmallButton("Bet Red $150")) {
                session.startSpectatorBout(static_cast<int>(mi), 0, 150, false, world, audio);
              }
              ImGui::SameLine();
              if (ImGui::SmallButton("Bet Blue $150")) {
                session.startSpectatorBout(static_cast<int>(mi), 1, 150, false, world, audio);
              }
              ImGui::SameLine();
              if (ImGui::SmallButton("Watch Free")) {
                session.startSpectatorBout(static_cast<int>(mi), 0, 0, false, world, audio);
              }
            }
            ImGui::PopID();
          }
          ImGui::Separator();
          for (size_t i = 0; i < session.races().size(); ++i) {
            const auto& r = session.races()[i];
            ImGui::PushID(static_cast<int>(100 + i));
            ImGui::Text("%s - 1st Prize: $%d %s", r.name.c_str(), r.rewardFirst, r.won ? "[WON]" : "");
            if (ImGui::Button("Start Race (Spawns Supercar)")) {
              session.startStreetRace(static_cast<int>(i), player, world);
              ui.showPhone = false;
            }
            ImGui::PopID();
          }
          if (session.activeRaceIdx() >= 0 && ImGui::Button("Cancel Active Race")) {
            session.cancelRace();
          }
          ImGui::EndTabItem();
        }

        const ImGuiTabItemFlags armoryTabFlags = (ui.forcePhoneTab == 2) ? ImGuiTabItemFlags_SetSelected : ImGuiTabItemFlags_None;
        if (ImGui::BeginTabItem("Armory & Suit", nullptr, armoryTabFlags)) {
          if (ui.forcePhoneTab == 2) ui.forcePhoneTab = -1;
          const char* suitName = nullptr;
          GameSession::suitTintColor(session.playerSuit(), &suitName);
          ImGui::TextColored({0.52f, 0.92f, 1.0f, 1.0f}, "Operative Rig: %s", suitName ? suitName : "Vanguard");
          ImGui::SameLine();
          if (ImGui::SmallButton("Cycle Suit")) session.cyclePlayerSuit();
          if (ImGui::Button("Buy Medkit + 100 Armor ($150)")) {
            session.buyArmorAndMedkit(audio);
          }
          ImGui::SameLine();
          ImGui::Text("Headshots: %d | Bodies Hidden: %d", session.totalHeadshots(), session.bodiesDisposedCount());
          ImGui::Separator();

          static const char* kOpticNames[5] = {"Irons", "Red Dot", "Holo", "ACOG", "8x Scope"};
          static const char* kMuzzleNames[3] = {"Std", "Suppressor", "Compensator"};
          static const char* kUnderNames[3] = {"None", "Vert Grip", "Laser"};
          static const char* kMagNames[3] = {"Std Mag", "Ext Mag", "Drum"};
          static const char* kFinishNames[6] = {"Obsidian", "Coyote", "Arctic", "Crimson", "Gold", "Titanium"};

          ImGui::BeginChild("ArmoryWorkbench", {0, 295}, true);
          for (size_t i = 1; i < session.weapons().size(); ++i) {
            const auto& w = session.weapons()[i];
            ImGui::PushID(static_cast<int>(200 + i));
            ImGui::TextColored(w.unlocked ? ImVec4(0.45f, 0.96f, 0.65f, 1.0f) : ImVec4(0.88f, 0.88f, 0.92f, 1.0f),
                               "[%zu] %s  |  DMG %.0f  |  %d rnd  %s",
                               i + 1, w.name.c_str(), w.damage, w.magSize, w.suppressed ? "[SD]" : "[LOUD]");
            if (!w.unlocked) {
              char lbl[64];
              std::snprintf(lbl, sizeof(lbl), "Unlock ($%d)", w.price);
              if (ImGui::Button(lbl)) session.buyWeaponOrAmmo(static_cast<int>(i), audio);
            } else {
              char lbl[64];
              std::snprintf(lbl, sizeof(lbl), "Ammo ($%d) [%d/%d]", w.ammoPrice, w.magAmmo, w.reserveAmmo);
              if (ImGui::SmallButton(lbl)) session.buyWeaponOrAmmo(static_cast<int>(i), audio);
              ImGui::SameLine();
              if (ImGui::SmallButton((std::string("Optic: ") + kOpticNames[static_cast<int>(w.optic)]).c_str())) {
                session.configureWeaponSlot(static_cast<int>(i), static_cast<WeaponOpticKind>((static_cast<int>(w.optic) + 1) % 5), w.muzzle, w.underbarrel, w.mag, w.finish);
              }
              ImGui::SameLine();
              if (ImGui::SmallButton((std::string("Muz: ") + kMuzzleNames[static_cast<int>(w.muzzle)]).c_str())) {
                session.configureWeaponSlot(static_cast<int>(i), w.optic, static_cast<WeaponMuzzleKind>((static_cast<int>(w.muzzle) + 1) % 3), w.underbarrel, w.mag, w.finish);
              }
              if (ImGui::SmallButton((std::string("Under: ") + kUnderNames[static_cast<int>(w.underbarrel)]).c_str())) {
                session.configureWeaponSlot(static_cast<int>(i), w.optic, w.muzzle, static_cast<WeaponUnderbarrelKind>((static_cast<int>(w.underbarrel) + 1) % 3), w.mag, w.finish);
              }
              ImGui::SameLine();
              if (ImGui::SmallButton((std::string("Mag: ") + kMagNames[static_cast<int>(w.mag)]).c_str())) {
                session.configureWeaponSlot(static_cast<int>(i), w.optic, w.muzzle, w.underbarrel, static_cast<WeaponMagKind>((static_cast<int>(w.mag) + 1) % 3), w.finish);
              }
              ImGui::SameLine();
              if (ImGui::SmallButton((std::string("Finish: ") + kFinishNames[static_cast<int>(w.finish)]).c_str())) {
                session.configureWeaponSlot(static_cast<int>(i), w.optic, w.muzzle, w.underbarrel, w.mag, static_cast<WeaponFinishKind>((static_cast<int>(w.finish) + 1) % 6));
              }
            }
            ImGui::Separator();
            ImGui::PopID();
          }
          ImGui::EndChild();
          ImGui::EndTabItem();
        }

        const ImGuiTabItemFlags garageTabFlags = (ui.forcePhoneTab == 4) ? ImGuiTabItemFlags_SetSelected : ImGuiTabItemFlags_None;
        if (ImGui::BeginTabItem("Autos & Garage", nullptr, garageTabFlags)) {
          if (ui.forcePhoneTab == 4) ui.forcePhoneTab = -1;
          ImGui::TextColored({0.95f, 0.82f, 0.32f, 1.0f}, "Westgate Luxury Dealership & Personal Valet");
          const char* paintNames[8] = {
            "Glacier White", "Obsidian", "Corsa Red", "Cobalt Blue",
            "Solar Amber", "Emerald", "Titanium", "Violet Dusk"
          };
          ImGui::Text("Custom Paint:");
          for (int pi = 0; pi < 8; ++pi) {
            if (pi == 4) ImGui::NewLine();
            else if (pi > 0) ImGui::SameLine();
            ImGui::PushID(700 + pi);
            const bool sel = (session.selectedPaintIdx() == pi);
            if (sel) ImGui::PushStyleColor(ImGuiCol_Button, ImVec4(0.24f, 0.58f, 0.34f, 1.0f));
            if (ImGui::SmallButton(paintNames[pi])) session.setSelectedPaintIdx(pi);
            if (sel) ImGui::PopStyleColor();
            ImGui::PopID();
          }
          ImGui::Separator();
          ImGui::BeginChild("AutoCatalogList", {0, 295}, true);
          for (size_t k = 0; k < kVehicleModelCount; ++k) {
            const auto kind = static_cast<VehicleModelKind>(k);
            const auto& sp = GameSession::vehicleSpec(kind);
            if (!sp.purchasable) continue;
            const bool owned = session.ownsVehicle(kind);
            ImGui::PushID(static_cast<int>(800 + k));
            ImGui::TextColored(owned ? ImVec4(0.45f, 0.96f, 0.62f, 1.0f) : ImVec4(0.92f, 0.92f, 0.95f, 1.0f),
                               "%s  [%s]  %.0f KM/H",
                               sp.displayName, sp.category, sp.maxSpeed * 3.6f);
            if (!owned) {
              char buyLbl[64];
              std::snprintf(buyLbl, sizeof(buyLbl), "Buy ($%d)", sp.dealershipPrice);
              if (ImGui::Button(buyLbl)) {
                session.buyDealershipVehicle(kind, audio);
              }
            } else {
              if (ImGui::Button("Valet Deliver")) {
                session.spawnPersonalVehicle(kind, session.selectedPaintIdx(), player, world, audio, false);
              }
              ImGui::SameLine();
              if (ImGui::Button("Drive Now")) {
                session.spawnPersonalVehicle(kind, session.selectedPaintIdx(), player, world, audio, true);
                ui.showPhone = false;
              }
            }
            ImGui::Separator();
            ImGui::PopID();
          }
          ImGui::EndChild();
          ImGui::EndTabItem();
        }

        if (ImGui::BeginTabItem("GPS & Save")) {
          ImGui::Text("Time of Day: %s", session.timeOfDayLabel().c_str());
          if (ImGui::Button("Afternoon")) session.setTimeOfDayPreset(TimeOfDayPreset::Afternoon);
          ImGui::SameLine();
          if (ImGui::Button("Sunset")) session.setTimeOfDayPreset(TimeOfDayPreset::Sunset);
          ImGui::SameLine();
          if (ImGui::Button("Night")) session.setTimeOfDayPreset(TimeOfDayPreset::Night);
          ImGui::SameLine();
          if (ImGui::Button("Dawn")) session.setTimeOfDayPreset(TimeOfDayPreset::Dawn);
          ImGui::Text("Weather: %s", session.weatherLabel().c_str());
          if (ImGui::Button("Clear")) session.setWeatherPreset(WeatherPreset::Clear);
          ImGui::SameLine();
          if (ImGui::Button("Overcast")) session.setWeatherPreset(WeatherPreset::Overcast);
          ImGui::SameLine();
          if (ImGui::Button("Rain")) session.setWeatherPreset(WeatherPreset::Rain);
          ImGui::SameLine();
          if (ImGui::Button("Storm")) session.setWeatherPreset(WeatherPreset::Thunderstorm);
          ImGui::Separator();
          if (ImGui::Button("Save Progress")) session.saveToFile(ui.savePath);
          ImGui::SameLine();
          if (ImGui::Button("Load Progress")) session.loadFromFile(ui.savePath);
          ImGui::Separator();
          ImGui::BeginChild("DistrictList", {0, 210}, true);
          for (size_t i = 0; i < world.teleports.size(); ++i) {
            const auto& tp = world.teleports[i];
            ImGui::PushID(static_cast<int>(300 + i));
            if (ImGui::Button("Go")) session.teleportTo(tp.pos, tp.yawDeg, player);
            ImGui::SameLine();
            if (ImGui::Button("GPS")) session.setGpsWaypoint(tp.pos, tp.label);
            ImGui::SameLine();
            ImGui::Text("%s", tp.label.c_str());
            ImGui::PopID();
          }
          ImGui::EndChild();
          ImGui::EndTabItem();
        }
        ImGui::EndTabBar();
      }
    }
    ImGui::End();
  }
}

} // namespace westgate
