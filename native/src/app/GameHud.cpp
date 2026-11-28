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
  // 1. Center Crosshair & Hitmarker (when mouse captured & not in Phone)
  // -------------------------------------------------------------------------
  if (ui.mouseCaptured && !ui.showPhone) {
    const ImVec2 c(disp.x * 0.5f, disp.y * 0.5f);
    const bool armed = !session.activeWeapon().isMelee && !session.inVehicle();
    const ImU32 crossCol = armed ? IM_COL32(235, 245, 255, 210) : IM_COL32(220, 220, 220, 120);
    bgDraw->AddLine({c.x - 9.0f, c.y}, {c.x - 3.0f, c.y}, crossCol, 1.8f);
    bgDraw->AddLine({c.x + 3.0f, c.y}, {c.x + 9.0f, c.y}, crossCol, 1.8f);
    bgDraw->AddLine({c.x, c.y - 9.0f}, {c.x, c.y - 3.0f}, crossCol, 1.8f);
    bgDraw->AddLine({c.x, c.y + 3.0f}, {c.x, c.y + 9.0f}, crossCol, 1.8f);
    bgDraw->AddCircleFilled(c, 1.8f, crossCol);

    if (session.hitmarkerTimer() > 0.0f) {
      const ImU32 hmCol = IM_COL32(255, 75, 75, 240);
      bgDraw->AddLine({c.x - 10.0f, c.y - 10.0f}, {c.x - 4.0f, c.y - 4.0f}, hmCol, 2.2f);
      bgDraw->AddLine({c.x + 4.0f, c.y - 4.0f}, {c.x + 10.0f, c.y - 10.0f}, hmCol, 2.2f);
      bgDraw->AddLine({c.x - 10.0f, c.y + 10.0f}, {c.x - 4.0f, c.y + 4.0f}, hmCol, 2.2f);
      bgDraw->AddLine({c.x + 4.0f, c.y + 4.0f}, {c.x + 10.0f, c.y + 10.0f}, hmCol, 2.2f);
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

    // Shops & Garages
    for (const auto& s : session.shops()) {
      const ImVec2 sp = worldToMap(s.pos.x, s.pos.z);
      bgDraw->AddCircleFilled(sp, 3.5f, s.isGarage ? IM_COL32(175, 95, 255, 235) : IM_COL32(45, 215, 115, 235));
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
  // 3. Bottom-Right Cash / Vitals / Weapon / Speedometer
  // -------------------------------------------------------------------------
  {
    ImGui::SetNextWindowPos({disp.x - 275.0f, disp.y - 148.0f}, ImGuiCond_Always);
    ImGui::SetNextWindowSize({259.0f, 132.0f}, ImGuiCond_Always);
    ImGui::SetNextWindowBgAlpha(0.78f);
    ImGui::Begin("##StatusBox", nullptr, ImGuiWindowFlags_NoTitleBar | ImGuiWindowFlags_NoResize | ImGuiWindowFlags_NoMove | ImGuiWindowFlags_NoScrollbar);
    ImGui::TextColored({0.35f, 0.94f, 0.52f, 1.0f}, "$%d   |   %s (%02d:%02d)",
                       session.playerCash(),
                       session.timeOfDayLabel().c_str(),
                       static_cast<int>(session.timeOfDayHours()) % 24,
                       static_cast<int>((session.timeOfDayHours() - std::floor(session.timeOfDayHours())) * 60.0f));
    ImGui::ProgressBar(session.playerHp() / session.playerMaxHp(), {-1, 14}, "HP");
    ImGui::ProgressBar(session.playerArmor() / 100.0f, {-1, 14}, "ARMOR");
    if (session.inVehicle() && session.currentVehicle()) {
      const auto* cv = session.currentVehicle();
      const float kmh = glm::length(glm::vec3(cv->speed, cv->verticalVel, 0.0f)) * 3.6f;
      if (cv->isAircraft) {
        ImGui::Text("HELI: %.0f KM/H | ALT %.0fm  ([Space/C] Alt, [G] Exit)", kmh, std::max(0.0f, cv->pos.y));
      } else if (cv->isBoat) {
        ImGui::Text("BOAT: %.0f KTS  ([W/A/S/D] Steer, [G] Exit)", kmh * 0.54f);
      } else {
        ImGui::Text("DRIVING: %.0f KM/H  ([G] Exit)", std::abs(cv->speed) * 3.6f);
      }
    } else {
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
    ImGui::SetNextWindowPos({disp.x * 0.5f - 240.0f, disp.y * 0.5f - 210.0f}, ImGuiCond_FirstUseEver);
    ImGui::SetNextWindowSize({480.0f, 430.0f}, ImGuiCond_FirstUseEver);
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

        if (ImGui::BeginTabItem("Gun Runner")) {
          if (ImGui::Button("Buy Medkit + 100 Armor ($150)")) {
            session.buyArmorAndMedkit(audio);
          }
          ImGui::Separator();
          for (size_t i = 1; i < session.weapons().size(); ++i) {
            const auto& w = session.weapons()[i];
            ImGui::PushID(static_cast<int>(200 + i));
            ImGui::Text("[%zu] %s - DMG %.0f %s", i, w.name.c_str(), w.damage, w.suppressed ? "(Suppressed)" : "(Loud)");
            if (!w.unlocked) {
              char lbl[64];
              std::snprintf(lbl, sizeof(lbl), "Unlock ($%d)", w.price);
              if (ImGui::Button(lbl)) session.buyWeaponOrAmmo(static_cast<int>(i), audio);
            } else {
              char lbl[64];
              std::snprintf(lbl, sizeof(lbl), "Refill Ammo ($%d) [%d/%d]", w.ammoPrice, w.magAmmo, w.reserveAmmo);
              if (ImGui::Button(lbl)) session.buyWeaponOrAmmo(static_cast<int>(i), audio);
            }
            ImGui::PopID();
          }
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
