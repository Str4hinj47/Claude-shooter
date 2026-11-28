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

  // =========================================================================
  // 0. Dedicated Interactive 3D Gunsmith Design Studio Mode [F2]
  // =========================================================================
  if (session.gunsmithOpen()) {
    const int slot = session.gunsmithSlot();
    const auto& w = session.weapons()[static_cast<size_t>(slot)];

    // Subtle studio vignette framing left/bottom around the 3D weapon turntable
    bgDraw->AddRectFilledMultiColor(
      {0.0f, 0.0f}, {disp.x, 86.0f},
      IM_COL32(6, 10, 16, 210), IM_COL32(6, 10, 16, 210),
      IM_COL32(6, 10, 16, 0),   IM_COL32(6, 10, 16, 0)
    );

    // Top-Left Studio Header & Camera Preset Controls
    ImGui::SetNextWindowPos({20.0f, 16.0f}, ImGuiCond_Always);
    ImGui::SetNextWindowSize({disp.x - 458.0f, 118.0f}, ImGuiCond_Always);
    ImGui::SetNextWindowBgAlpha(0.86f);
    ImGui::Begin("##GunsmithHeader", nullptr, ImGuiWindowFlags_NoTitleBar | ImGuiWindowFlags_NoResize | ImGuiWindowFlags_NoMove);
    ImGui::TextColored({0.38f, 0.92f, 1.0f, 1.0f}, "WESTGATE ARMORY // 3D GUNSMITH DESIGN STUDIO");
    ImGui::SameLine(ImGui::GetWindowWidth() - 235.0f);
    ImGui::TextColored({0.42f, 0.96f, 0.62f, 1.0f}, "CREDITS: $%d", session.playerCash());
    ImGui::TextDisabled("Left-Drag: 360 Orbit  |  Mouse Wheel: Precision Zoom  |  [F2 / ESC] Exit to Field");

    // Weapon platform selector tabs (Slots 1..5)
    for (int si = 1; si < static_cast<int>(session.weapons().size()); ++si) {
      if (si > 1) ImGui::SameLine();
      const auto& sw = session.weapons()[static_cast<size_t>(si)];
      const bool active = (si == slot);
      if (active) ImGui::PushStyleColor(ImGuiCol_Button, ImVec4(0.16f, 0.52f, 0.72f, 0.98f));
      char tabLbl[64];
      std::snprintf(tabLbl, sizeof(tabLbl), "[%d] %s%s", si + 1, sw.name.c_str(), sw.unlocked ? "" : " (LOCKED)");
      if (ImGui::SmallButton(tabLbl)) {
        session.setGunsmithSlot(si);
      }
      if (active) ImGui::PopStyleColor();
    }

    // Studio Camera Angles + Spin + Test Fire
    ImGui::TextDisabled("Camera:");
    ImGui::SameLine();
    if (ImGui::SmallButton("3/4 Showcase")) session.setGunsmithCameraPreset(0);
    ImGui::SameLine();
    if (ImGui::SmallButton("Side Profile")) session.setGunsmithCameraPreset(1);
    ImGui::SameLine();
    if (ImGui::SmallButton("Optic Sight")) session.setGunsmithCameraPreset(2);
    ImGui::SameLine();
    if (ImGui::SmallButton("Muzzle & Rail")) session.setGunsmithCameraPreset(3);
    ImGui::SameLine();
    bool autoSpin = session.gunsmithAutoRotate();
    if (ImGui::Checkbox("Turntable", &autoSpin)) session.setGunsmithAutoRotate(autoSpin);
    ImGui::SameLine();
    if (ImGui::SmallButton("Test Fire Kick")) {
      session.triggerGunsmithTestFire(audio);
    }
    ImGui::End();

    // Bottom-Left Live Ballistics & Acoustic Telemetry
    ImGui::SetNextWindowPos({20.0f, disp.y - 166.0f}, ImGuiCond_Always);
    ImGui::SetNextWindowSize({482.0f, 148.0f}, ImGuiCond_Always);
    ImGui::SetNextWindowBgAlpha(0.86f);
    ImGui::Begin("##GunsmithTelemetry", nullptr, ImGuiWindowFlags_NoTitleBar | ImGuiWindowFlags_NoResize | ImGuiWindowFlags_NoMove);
    ImGui::TextColored({0.95f, 0.82f, 0.34f, 1.0f}, "%s // BALLISTICS TELEMETRY", w.name.c_str());
    ImGui::SameLine(ImGui::GetWindowWidth() - 122.0f);
    ImGui::TextColored(w.suppressed ? ImVec4(0.35f, 0.96f, 0.68f, 1.0f) : ImVec4(1.0f, 0.52f, 0.36f, 1.0f),
                       w.suppressed ? "[SUBSONIC SD]" : "[UNSUPPRESSED]");

    float dmgMul = 1.0f;
    if (w.muzzle == WeaponMuzzleKind::Suppressor) dmgMul = 0.94f;
    else if (w.muzzle == WeaponMuzzleKind::Osprey) dmgMul = 0.96f;
    else if (w.muzzle == WeaponMuzzleKind::Wrapped) dmgMul = 0.98f;
    const float effDmg = w.damage * dmgMul * static_cast<float>(std::max(1, w.pellets));

    float spreadMul = 1.0f;
    if (w.muzzle == WeaponMuzzleKind::Compensator) spreadMul *= 0.76f;
    if (w.muzzle == WeaponMuzzleKind::Wrapped) spreadMul *= 0.88f;
    if (w.underbarrel == WeaponUnderbarrelKind::VerticalGrip) spreadMul *= 0.78f;
    if (w.underbarrel == WeaponUnderbarrelKind::LaserSight) spreadMul *= 0.82f;
    if (w.underbarrel == WeaponUnderbarrelKind::AngledGrip) spreadMul *= 0.84f;
    if (w.optic == WeaponOpticKind::RedDot || w.optic == WeaponOpticKind::Holo) spreadMul *= 0.88f;
    if (w.optic == WeaponOpticKind::Acog) spreadMul *= 0.75f;
    if (w.optic == WeaponOpticKind::SniperScope) spreadMul *= 0.58f;
    const float effSpread = w.spread * spreadMul;
    const float acc01 = std::clamp(1.0f - effSpread / 0.065f, 0.08f, 0.99f);
    const float rpm = w.rpm;

    char buf[96];
    std::snprintf(buf, sizeof(buf), "Terminal Damage: %.0f", effDmg);
    ImGui::ProgressBar(std::clamp(effDmg / 120.0f, 0.05f, 1.0f), {-1.0f, 15.0f}, buf);
    std::snprintf(buf, sizeof(buf), "Precision & Recoil Control: %.0f%%", acc01 * 100.0f);
    ImGui::ProgressBar(acc01, {-1.0f, 15.0f}, buf);
    std::snprintf(buf, sizeof(buf), "Cyclic Rate: %.0f RPM   |   Capacity: %d + %d rnds", rpm, w.magSize, w.reserveAmmo);
    ImGui::ProgressBar(std::clamp(rpm / 900.0f, 0.08f, 1.0f), {-1.0f, 15.0f}, buf);
    ImGui::TextDisabled("PBR: CNC Anodized + Laser-Stippled Polymer + Sapphire Lens");
    ImGui::End();

    // Right-Side Modular Workbench Inspector
    ImGui::SetNextWindowPos({disp.x - 422.0f, 16.0f}, ImGuiCond_Always);
    ImGui::SetNextWindowSize({404.0f, disp.y - 32.0f}, ImGuiCond_Always);
    ImGui::SetNextWindowBgAlpha(0.92f);
    ImGui::Begin("##GunsmithInspector", nullptr, ImGuiWindowFlags_NoTitleBar | ImGuiWindowFlags_NoResize | ImGuiWindowFlags_NoMove);
    ImGui::TextColored({0.45f, 0.92f, 1.0f, 1.0f}, "MODULAR ATTACHMENTS & CERAKOTE");
    ImGui::Separator();

    // Purchase / Ammo row
    if (!w.unlocked) {
      char buyLbl[80];
      std::snprintf(buyLbl, sizeof(buyLbl), "Unlock %s ($%d)", w.name.c_str(), w.price);
      if (ImGui::Button(buyLbl, {-1.0f, 28.0f})) {
        session.buyWeaponOrAmmo(slot, audio);
      }
    } else {
      char ammoLbl[80];
      std::snprintf(ammoLbl, sizeof(ammoLbl), "Refill Magazines ($%d) [%d/%d]", w.ammoPrice, w.magAmmo, w.reserveAmmo);
      if (ImGui::Button(ammoLbl, {-1.0f, 25.0f})) {
        session.buyWeaponOrAmmo(slot, audio);
      }
    }

    ImGui::Spacing();
    static const char* kOpticLabels[5] = {"Iron Sights", "Red Dot", "Holo EOTech", "4x ACOG", "8x Sniper"};
    static const char* kMuzzleLabels[5] = {"Standard", "Suppressor", "Compensator", "Osprey Box", "Thermal Wrap"};
    static const char* kUnderLabels[4] = {"Clean Rail", "Vert Grip", "PEQ Laser", "Angled Grip"};
    static const char* kMagLabels[3] = {"Standard", "Extended", "Drum Mag"};

    ImGui::TextColored({0.86f, 0.90f, 0.98f, 1.0f}, "1. OPTIC SIGHT RAIL");
    for (int oi = 0; oi < 5; ++oi) {
      if (oi > 0 && oi != 3) ImGui::SameLine();
      const bool sel = (static_cast<int>(w.optic) == oi);
      if (sel) ImGui::PushStyleColor(ImGuiCol_Button, ImVec4(0.18f, 0.56f, 0.78f, 1.0f));
      if (ImGui::Button(kOpticLabels[oi], {oi < 3 ? 124.0f : 190.0f, 23.0f})) {
        session.configureWeaponSlot(slot, static_cast<WeaponOpticKind>(oi), w.muzzle, w.underbarrel, w.mag, w.bodyFinish);
      }
      if (sel) ImGui::PopStyleColor();
    }

    // Illuminated Reticle Color Swatches (5 colors)
    ImGui::Text("Reticle Illumination:");
    ImGui::SameLine();
    for (int ri = 0; ri < static_cast<int>(kWeaponReticleColorCount); ++ri) {
      if (ri > 0) ImGui::SameLine();
      const char* rName = nullptr;
      const glm::vec3 rc = GameSession::weaponReticleColor(static_cast<uint8_t>(ri), &rName);
      ImGui::PushID(8100 + ri);
      const int flags = (w.reticleColorIdx == ri) ? 0 : ImGuiColorEditFlags_NoBorder;
      if (ImGui::ColorButton(rName ? rName : "Reticle", ImVec4(rc.r, rc.g, rc.b, 1.0f), flags, {22.0f, 18.0f})) {
        session.configureWeaponZones(slot, w.bodyFinish, w.accentFinish, w.hardwareFinish, w.surfaceSheen, static_cast<uint8_t>(ri));
      }
      if (w.reticleColorIdx == ri) {
        ImGui::GetWindowDrawList()->AddRect(ImGui::GetItemRectMin(), ImGui::GetItemRectMax(), IM_COL32(255, 255, 255, 255), 2.0f, 0, 2.0f);
      }
      ImGui::PopID();
    }

    ImGui::Spacing();
    ImGui::TextColored({0.86f, 0.90f, 0.98f, 1.0f}, "2. MUZZLE DEVICE");
    for (int mi = 0; mi < 5; ++mi) {
      if (mi > 0 && mi != 3) ImGui::SameLine();
      const bool sel = (static_cast<int>(w.muzzle) == mi);
      if (sel) ImGui::PushStyleColor(ImGuiCol_Button, ImVec4(0.18f, 0.56f, 0.78f, 1.0f));
      if (ImGui::Button(kMuzzleLabels[mi], {mi < 3 ? 124.0f : 190.0f, 23.0f})) {
        session.configureWeaponSlot(slot, w.optic, static_cast<WeaponMuzzleKind>(mi), w.underbarrel, w.mag, w.bodyFinish);
      }
      if (sel) ImGui::PopStyleColor();
    }

    ImGui::Spacing();
    ImGui::TextColored({0.86f, 0.90f, 0.98f, 1.0f}, "3. UNDERBARREL ACCESSORY");
    for (int uiIdx = 0; uiIdx < 4; ++uiIdx) {
      if (uiIdx % 2 == 1) ImGui::SameLine();
      const bool sel = (static_cast<int>(w.underbarrel) == uiIdx);
      if (sel) ImGui::PushStyleColor(ImGuiCol_Button, ImVec4(0.18f, 0.56f, 0.78f, 1.0f));
      if (ImGui::Button(kUnderLabels[uiIdx], {190.0f, 23.0f})) {
        session.configureWeaponSlot(slot, w.optic, w.muzzle, static_cast<WeaponUnderbarrelKind>(uiIdx), w.mag, w.bodyFinish);
      }
      if (sel) ImGui::PopStyleColor();
    }

    ImGui::Spacing();
    ImGui::TextColored({0.86f, 0.90f, 0.98f, 1.0f}, "4. MAGAZINE SYSTEM");
    for (int mgi = 0; mgi < 3; ++mgi) {
      if (mgi > 0) ImGui::SameLine();
      const bool sel = (static_cast<int>(w.mag) == mgi);
      if (sel) ImGui::PushStyleColor(ImGuiCol_Button, ImVec4(0.18f, 0.56f, 0.78f, 1.0f));
      if (ImGui::Button(kMagLabels[mgi], {124.0f, 23.0f})) {
        session.configureWeaponSlot(slot, w.optic, w.muzzle, w.underbarrel, static_cast<WeaponMagKind>(mgi), w.bodyFinish);
      }
      if (sel) ImGui::PopStyleColor();
    }

    ImGui::Spacing();
    ImGui::Separator();
    ImGui::TextColored({0.98f, 0.82f, 0.36f, 1.0f}, "5. 3-ZONE CERAKOTE & ANODIZED FINISH");

    static int sPaintZone = 0; // 0 = All Zones, 1 = Receiver Body, 2 = Handguard/Grip, 3 = Barrel/Hardware
    const char* zoneTabs[4] = {"All Zones", "Receiver", "Handguard", "Hardware"};
    for (int zi = 0; zi < 4; ++zi) {
      if (zi > 0) ImGui::SameLine();
      const bool zSel = (sPaintZone == zi);
      if (zSel) ImGui::PushStyleColor(ImGuiCol_Button, ImVec4(0.68f, 0.48f, 0.14f, 1.0f));
      if (ImGui::Button(zoneTabs[zi], {91.0f, 22.0f})) sPaintZone = zi;
      if (zSel) ImGui::PopStyleColor();
    }

    WeaponFinishKind activeZoneFin = w.bodyFinish;
    if (sPaintZone == 2) activeZoneFin = w.accentFinish;
    else if (sPaintZone == 3) activeZoneFin = w.hardwareFinish;

    static const char* kShortSwatchNames[8] = {
      "Obsidian", "Coyote", "Arctic", "Crimson",
      "24K Gold", "Titanium", "OD Olive", "Cobalt"
    };
    for (int fi = 0; fi < static_cast<int>(kWeaponFinishCount); ++fi) {
      if (fi % 4 != 0) ImGui::SameLine();
      const auto fk = static_cast<WeaponFinishKind>(fi);
      const char* fName = nullptr;
      glm::vec3 fc{0.2f};
      float fMet = 0.5f, fRgh = 0.5f;
      GameSession::weaponFinishPbr(fk, w.surfaceSheen, fc, fRgh, fMet, &fName);
      ImGui::PushID(8200 + fi);
      ImGui::BeginGroup();
      if (ImGui::ColorButton(fName ? fName : "Cerakote", ImVec4(fc.r, fc.g, fc.b, 1.0f), 0, {88.0f, 22.0f})) {
        WeaponFinishKind nb = w.bodyFinish;
        WeaponFinishKind na = w.accentFinish;
        WeaponFinishKind nh = w.hardwareFinish;
        if (sPaintZone == 0) { nb = fk; na = fk; nh = fk; }
        else if (sPaintZone == 1) { nb = fk; }
        else if (sPaintZone == 2) { na = fk; }
        else { nh = fk; }
        session.configureWeaponZones(slot, nb, na, nh, w.surfaceSheen, w.reticleColorIdx);
      }
      if (fk == activeZoneFin) {
        ImGui::GetWindowDrawList()->AddRect(ImGui::GetItemRectMin(), ImGui::GetItemRectMax(), IM_COL32(255, 232, 125, 255), 3.0f, 0, 2.2f);
      }
      ImGui::TextDisabled(" %s", kShortSwatchNames[fi]);
      ImGui::EndGroup();
      ImGui::PopID();
    }

    float sheenPct = w.surfaceSheen * 100.0f;
    if (ImGui::SliderFloat("Surface Sheen", &sheenPct, 0.0f, 100.0f, "%.0f%% Polish")) {
      session.configureWeaponZones(slot, w.bodyFinish, w.accentFinish, w.hardwareFinish, sheenPct * 0.01f, w.reticleColorIdx);
    }

    ImGui::Spacing();
    if (ImGui::Button("Factory Reset", {130.0f, 28.0f})) {
      session.resetWeaponSlotDefaults(slot);
    }
    ImGui::SameLine();
    ImGui::PushStyleColor(ImGuiCol_Button, ImVec4(0.15f, 0.54f, 0.36f, 1.0f));
    if (ImGui::Button("Save & Return to Field [F2]", {-1.0f, 28.0f})) {
      session.setGunsmithOpen(false);
    }
    ImGui::PopStyleColor();
    ImGui::End();
    return;
  }

  // -------------------------------------------------------------------------
  // 1. Center Crosshair, Sniper Scope Overlay & Hitmarker
  // -------------------------------------------------------------------------
  if ((ui.mouseCaptured || session.isAiming()) && !ui.showPhone) {
    const ImVec2 c(disp.x * 0.5f, disp.y * 0.5f);
    const auto& actW = session.activeWeapon();
    const bool armed = !actW.isMelee && !session.inVehicle();
    const bool scopeAds = armed && session.isAiming() && actW.optic == WeaponOpticKind::SniperScope;
    const bool fpOpticalAds = session.firstPersonMode() && armed && session.adsBlend() > 0.68f && !scopeAds;
    const glm::vec3 retRgb = GameSession::weaponReticleColor(actW.reticleColorIdx);
    const ImU32 retU32 = IM_COL32(
      static_cast<int>(retRgb.r * 255.0f),
      static_cast<int>(retRgb.g * 255.0f),
      static_cast<int>(retRgb.b * 255.0f),
      235
    );

    if (scopeAds) {
      const float r = std::min(disp.x, disp.y) * 0.41f;
      // Dark tactical scope surround in First-Person & 3rd-Person 8x ADS
      bgDraw->AddRectFilled({0.0f, 0.0f}, {c.x - r, disp.y}, IM_COL32(5, 8, 12, 225));
      bgDraw->AddRectFilled({c.x + r, 0.0f}, {disp.x, disp.y}, IM_COL32(5, 8, 12, 225));
      bgDraw->AddCircle(c, r + 14.0f, IM_COL32(8, 12, 18, 245), 72, 32.0f);
      bgDraw->AddCircle(c, r - 8.0f, retU32, 72, 1.6f);
      bgDraw->AddLine({c.x - r, c.y}, {c.x + r, c.y}, IM_COL32(18, 28, 38, 225), 1.4f);
      bgDraw->AddLine({c.x, c.y - r}, {c.x, c.y + r}, IM_COL32(18, 28, 38, 225), 1.4f);
      for (int md = -4; md <= 4; ++md) {
        if (md == 0) continue;
        bgDraw->AddCircleFilled({c.x + md * 24.0f, c.y}, 2.0f, retU32);
        bgDraw->AddCircleFilled({c.x, c.y + md * 24.0f}, 2.0f, retU32);
      }
      bgDraw->AddCircleFilled(c, 2.6f, retU32);
    } else if (!fpOpticalAds) {
      // Fade hip crosshair smoothly as First-Person ADS brings the true 3D iron/holo sight onto center screen
      const float fade = session.firstPersonMode() ? std::clamp(1.0f - session.adsBlend() * 1.45f, 0.0f, 1.0f) : 1.0f;
      const int alpha = static_cast<int>((armed ? 210.0f : 125.0f) * fade);
      if (alpha > 8) {
        const float spreadPx = armed ? (7.0f + (session.isAiming() ? 0.0f : 4.0f)) : 7.0f;
        const ImU32 crossCol = IM_COL32(235, 245, 255, alpha);
        bgDraw->AddLine({c.x - spreadPx - 5.0f, c.y}, {c.x - spreadPx + 1.0f, c.y}, crossCol, 1.8f);
        bgDraw->AddLine({c.x + spreadPx - 1.0f, c.y}, {c.x + spreadPx + 5.0f, c.y}, crossCol, 1.8f);
        bgDraw->AddLine({c.x, c.y - spreadPx - 5.0f}, {c.x, c.y - spreadPx + 1.0f}, crossCol, 1.8f);
        bgDraw->AddLine({c.x, c.y + spreadPx - 1.0f}, {c.x, c.y + spreadPx + 5.0f}, crossCol, 1.8f);
        bgDraw->AddCircleFilled(c, 1.7f, crossCol);
      }
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

    // Luxury Apartments, Nearby Unfound Stashes & Active Street Random Event
    for (const auto& apt : session.apartments()) {
      const ImVec2 ap = worldToMap(apt.doorPos.x, apt.doorPos.z);
      bgDraw->AddRectFilled({ap.x - 3.6f, ap.y - 3.6f}, {ap.x + 3.6f, ap.y + 3.6f},
                            apt.owned ? IM_COL32(55, 235, 145, 240) : IM_COL32(245, 185, 55, 215), 1.5f);
    }
    for (const auto& cp : session.collectibles()) {
      if (cp.collected || cp.kind != CollectibleKind::Stash) continue;
      if (glm::distance(glm::vec2(pPos.x, pPos.z), glm::vec2(cp.pos.x, cp.pos.z)) < 110.0f) {
        const ImVec2 sp = worldToMap(cp.pos.x, cp.pos.z);
        bgDraw->AddCircleFilled(sp, 3.4f, IM_COL32(250, 195, 45, 240));
      }
    }
    if (session.activeRandomEvent().active) {
      const ImVec2 ep = worldToMap(session.activeRandomEvent().origin.x, session.activeRandomEvent().origin.z);
      bgDraw->AddCircleFilled(ep, 4.8f, IM_COL32(255, 105, 55, 245));
      bgDraw->AddCircle(ep, 7.6f, IM_COL32(255, 225, 120, 220), 12, 1.5f);
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
    ImGui::TextColored({0.35f, 0.94f, 0.52f, 1.0f}, "$%d | %d INT | %d SLV  (%02d:%02d)",
                       session.playerCash(),
                       session.playerIntel(),
                       session.playerSalvage(),
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

  // Tactical Radio Comms & Voiceover Subtitle Banner (kept left of StatusBox so it never overlaps)
  if (session.commsTimer() > 0.0f && !session.commsSubtitle().empty()) {
    const float maxSubW = std::max(280.0f, disp.x - 360.0f);
    ImGui::SetNextWindowPos({18.0f, disp.y - 122.0f}, ImGuiCond_Always);
    ImGui::SetNextWindowSize({maxSubW, 50.0f}, ImGuiCond_Always);
    ImGui::SetNextWindowBgAlpha(0.88f);
    ImGui::Begin("##CommsSubtitleBox", nullptr, ImGuiWindowFlags_NoTitleBar | ImGuiWindowFlags_NoResize | ImGuiWindowFlags_NoMove | ImGuiWindowFlags_NoScrollbar);
    ImGui::TextColored({0.42f, 0.92f, 0.96f, 1.0f}, "[%s]", session.commsSpeaker().c_str());
    ImGui::SameLine();
    ImGui::TextWrapped("%s", session.commsSubtitle().c_str());
    ImGui::End();
  }

  // -------------------------------------------------------------------------
  // 4b. VOSS // BLACK CONTRACT: Boss Bar, Mission Checklist, Surveillance & Debrief
  // -------------------------------------------------------------------------
  if (const NpcEntity* boss = session.activeBossNpc()) {
    const float bossY = ui.showTelemetry ? 162.0f : 58.0f;
    ImGui::SetNextWindowPos({disp.x * 0.5f - 215.0f, bossY}, ImGuiCond_Always);
    ImGui::SetNextWindowSize({430.0f, 66.0f}, ImGuiCond_Always);
    ImGui::SetNextWindowBgAlpha(0.88f);
    ImGui::Begin("##CampaignBossBar", nullptr, ImGuiWindowFlags_NoTitleBar | ImGuiWindowFlags_NoResize | ImGuiWindowFlags_NoMove | ImGuiWindowFlags_NoScrollbar);
    ImGui::TextColored({1.0f, 0.34f, 0.34f, 1.0f}, "HIGH-VALUE TARGET: %s  %s",
                       boss->displayName.c_str(),
                       session.activeMission().bossPhaseTriggered ? "[PHASE 2 HAZARD ACTIVE!]" : "");
    char hpTxt[64];
    std::snprintf(hpTxt, sizeof(hpTxt), "%.0f / %.0f HP", std::max(0.0f, boss->hp), boss->maxHp);
    ImGui::ProgressBar(std::clamp(boss->hp / std::max(1.0f, boss->maxHp), 0.0f, 1.0f), {-1, 16}, hpTxt);
    ImGui::End();
  }

  if (session.activeMission().active) {
    const auto& am = session.activeMission();
    const float panelH = 88.0f + static_cast<float>(am.objectives.size()) * 19.0f + (session.activeAllyNpc() ? 32.0f : 0.0f);
    ImGui::SetNextWindowPos({disp.x - 324.0f, 206.0f}, ImGuiCond_Always);
    ImGui::SetNextWindowSize({308.0f, panelH}, ImGuiCond_Always);
    ImGui::SetNextWindowBgAlpha(0.82f);
    ImGui::Begin("##MissionChecklist", nullptr, ImGuiWindowFlags_NoTitleBar | ImGuiWindowFlags_NoResize | ImGuiWindowFlags_NoMove | ImGuiWindowFlags_NoScrollbar);
    ImGui::TextColored({0.38f, 0.88f, 1.0f, 1.0f}, "CH %02d // %s", am.chapter, am.codename.c_str());
    ImGui::TextColored(am.playerAlertedAnyGuard ? ImVec4(1.0f, 0.48f, 0.30f, 1.0f) : ImVec4(0.32f, 0.96f, 0.62f, 1.0f),
                       "%s  |  %.0fs", am.playerAlertedAnyGuard ? "[ALERTED]" : "[GHOST BONUS INTACT]", am.elapsedSec);
    ImGui::Separator();
    for (const auto& obj : am.objectives) {
      const bool done = obj.completed();
      ImGui::TextColored(done ? ImVec4(0.42f, 0.96f, 0.58f, 1.0f) : ImVec4(0.92f, 0.94f, 0.98f, 1.0f),
                         "%s %s (%d/%d)", done ? "[x]" : "[ ]", obj.label.c_str(), obj.current, obj.required);
    }
    if (const NpcEntity* ally = session.activeAllyNpc()) {
      ImGui::Separator();
      char allyBuf[64];
      std::snprintf(allyBuf, sizeof(allyBuf), "ALLY: %s (%.0f%%)", ally->displayName.c_str(), (ally->hp / std::max(1.0f, ally->maxHp)) * 100.0f);
      ImGui::ProgressBar(std::clamp(ally->hp / std::max(1.0f, ally->maxHp), 0.0f, 1.0f), {-1, 13}, allyBuf);
    }
    ImGui::End();
  } else if (session.activeSurveillance().active) {
    const auto& sv = session.activeSurveillance();
    ImGui::SetNextWindowPos({disp.x - 324.0f, 206.0f}, ImGuiCond_Always);
    ImGui::SetNextWindowSize({308.0f, 128.0f}, ImGuiCond_Always);
    ImGui::SetNextWindowBgAlpha(0.84f);
    ImGui::Begin("##SurveillanceHud", nullptr, ImGuiWindowFlags_NoTitleBar | ImGuiWindowFlags_NoResize | ImGuiWindowFlags_NoMove | ImGuiWindowFlags_NoScrollbar);
    ImGui::TextColored({0.98f, 0.72f, 0.16f, 1.0f}, "SURVEILLANCE [%s] // %s", sv.code.c_str(), sv.targetName.c_str());
    if (sv.phase == SurveillancePhase::IsolatedWindow) {
      ImGui::TextColored({0.25f, 0.98f, 0.58f, 1.0f}, "ISOLATED WINDOW OPEN! Strike Silently [V]!");
    } else if (sv.phase == SurveillancePhase::DisposeBody) {
      ImGui::TextColored({0.38f, 0.88f, 1.0f, 1.0f}, "CARRY [J] & DUMP CORPSE IN OCEAN WATER!");
    } else {
      ImGui::Text("Dist: %.0fm (Keep 18m-110m)  %s", sv.distanceToTarget, sv.unseen ? "[UNSEEN]" : "[SPOTTED]");
      ImGui::ProgressBar(sv.spookMeter, {-1, 12}, "SPOOK METER");
    }
    ImGui::TextDisabled("Vehicle: %s", sv.vehicleLabel.c_str());
    ImGui::End();
  }

  if (session.lastDebrief().visible) {
    const auto& db = session.lastDebrief();
    ImGui::SetNextWindowPos({disp.x * 0.5f - 230.0f, disp.y * 0.5f - 145.0f}, ImGuiCond_Always);
    ImGui::SetNextWindowSize({460.0f, db.awaitsEpilogueChoice ? 290.0f : 225.0f}, ImGuiCond_Always);
    ImGui::SetNextWindowBgAlpha(0.94f);
    ImGui::Begin("##CampaignDebriefModal", nullptr, ImGuiWindowFlags_NoTitleBar | ImGuiWindowFlags_NoResize | ImGuiWindowFlags_NoMove);
    ImGui::TextColored({0.35f, 0.94f, 0.65f, 1.0f}, "CONTRACT DEBRIEF // CH %02d: %s", db.chapter, db.codename.c_str());
    ImGui::TextColored({1.0f, 0.84f, 0.25f, 1.0f}, "OPERATIONAL RANK: [%c]   |   %s   |   Time: %.1fs",
                       db.rank, db.ghost ? "GHOST BONUS (+25%)" : "COMBAT CLEAR", db.elapsedSec);
    ImGui::Separator();
    ImGui::Text("Rewards: +$%d Credits   |   +%d Intel   |   +%d Salvage",
                db.creditsEarned, db.intelEarned, db.salvageEarned);
    ImGui::Text("Eliminations: %d   |   Precision Headshots: %d", db.kills, db.headshots);
    ImGui::TextWrapped("%s", db.narrativeNote.c_str());
    ImGui::Separator();
    if (db.awaitsEpilogueChoice) {
      ImGui::TextColored({0.82f, 0.58f, 1.0f, 1.0f}, "FINAL DIRECTIVE - THE SOVEREIGN LEDGER:");
      if (ImGui::Button("BURN THE LEDGER & VANISH (+120 Intel, +$8k)")) {
        session.selectEpilogueChoice(EpilogueChoice::BurnLedger, audio);
      }
      if (ImGui::Button("CLAIM CONSORTIUM ESCROW (+$25,000, +100 Salvage)")) {
        session.selectEpilogueChoice(EpilogueChoice::ClaimConsortium, audio);
      }
    } else if (ImGui::Button("Close Debrief & Continue")) {
      session.dismissDebrief();
    }
    ImGui::End();
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
    ImGui::Text("[TAB] Mouse: %s | [V] %s | [F2] 3D Gunsmith | [1-6] Weapons | [G] Vehicle | [P] Phone",
                ui.mouseCaptured ? "ON" : "OFF",
                session.firstPersonMode() ? "1ST-PERSON" : "3RD-PERSON");
    if (ImGui::Button("Toggle Phone [P]")) ui.showPhone = !ui.showPhone;
    ImGui::SameLine();
    if (session.firstPersonMode()) ImGui::PushStyleColor(ImGuiCol_Button, ImVec4(0.16f, 0.56f, 0.78f, 1.0f));
    if (ImGui::Button(session.firstPersonMode() ? "1st-Person [V]" : "3rd-Person [V]")) session.toggleFirstPersonMode();
    if (session.firstPersonMode()) ImGui::PopStyleColor();
    ImGui::SameLine();
    if (ImGui::Button("3D Gunsmith [F2]")) {
      ui.showPhone = false;
      session.setGunsmithOpen(true);
    }
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
    ImGui::SetNextWindowPos({disp.x * 0.5f - 315.0f, disp.y * 0.5f - 230.0f}, ImGuiCond_FirstUseEver);
    ImGui::SetNextWindowSize({630.0f, 465.0f}, ImGuiCond_FirstUseEver);
    ImGui::SetNextWindowBgAlpha(0.92f);
    if (ImGui::Begin("Westgate Tactical SkyPhone [P]", &ui.showPhone)) {
      if (ImGui::BeginTabBar("PhoneTabs")) {
        const ImGuiTabItemFlags campTabFlags = (ui.forcePhoneTab == 0) ? ImGuiTabItemFlags_SetSelected : ImGuiTabItemFlags_None;
        if (ImGui::BeginTabItem("Campaign", nullptr, campTabFlags)) {
          if (ui.forcePhoneTab == 0) ui.forcePhoneTab = -1;
          ImGui::TextColored({0.42f, 0.92f, 1.0f, 1.0f}, "VOSS // BLACK CONTRACT  (Step %d/9)", session.storyStep());
          ImGui::SameLine();
          if (ImGui::SmallButton(GameSession::difficultyLabel(session.difficulty()))) {
            session.setDifficulty(static_cast<DifficultyMode>((static_cast<int>(session.difficulty()) + 1) % 3));
          }
          if ((session.activeMission().active || session.activeSurveillance().active) && ImGui::SmallButton("Abort Active Deployment")) {
            session.abortActiveMissionOrSurveillance();
          }
          ImGui::Separator();
          ImGui::BeginChild("StoryChapterList", {0, 335}, true);
          std::string prevAct;
          for (const auto& ch : session.storyChapters()) {
            if (ch.act != prevAct) {
              prevAct = ch.act;
              ImGui::TextColored({0.98f, 0.78f, 0.28f, 1.0f}, "-- %s --", ch.act.c_str());
            }
            const bool unlocked = session.isChapterUnlocked(ch.chapter);
            ImGui::PushID(1000 + ch.chapter);
            ImGui::TextColored(ch.completed ? ImVec4(0.42f, 0.96f, 0.62f, 1.0f)
                                            : (unlocked ? ImVec4(0.94f, 0.96f, 1.0f, 1.0f) : ImVec4(0.52f, 0.55f, 0.62f, 1.0f)),
                               "[%s] CH %s: %s - %s  %s",
                               ch.letter.c_str(), ch.code.c_str(), ch.codename.c_str(), ch.title.c_str(),
                               ch.completed ? (std::string("[RANK ") + ch.bestRank + (ch.ghostCleared ? " GHOST]" : "]")).c_str()
                                            : (unlocked ? "[LIVE]" : "[LOCKED]"));
            ImGui::TextDisabled("%s | %s", ch.district.c_str(), ch.tacticalFocus.c_str());
            if (unlocked) {
              if (ImGui::SmallButton("Deploy Now")) {
                session.startStoryChapter(ch.chapter, player, world, audio, true);
                ui.showPhone = false;
              }
              ImGui::SameLine();
              if (ImGui::SmallButton("Track GPS")) {
                session.setGpsWaypoint(ch.beaconPos, "CH " + ch.code + ": " + ch.codename);
              }
            }
            ImGui::Separator();
            ImGui::PopID();
          }
          ImGui::EndChild();
          ImGui::EndTabItem();
        }

        const ImGuiTabItemFlags techTabFlags = (ui.forcePhoneTab == 5) ? ImGuiTabItemFlags_SetSelected : ImGuiTabItemFlags_None;
        if (ImGui::BeginTabItem("Tech & Stats", nullptr, techTabFlags)) {
          if (ui.forcePhoneTab == 5) ui.forcePhoneTab = -1;
          ImGui::TextColored({0.38f, 0.96f, 0.58f, 1.0f}, "Credits: $%d   |   Intel: %d   |   Salvage: %d",
                             session.playerCash(), session.playerIntel(), session.playerSalvage());
          ImGui::Separator();
          ImGui::BeginChild("TechAndBodyScroll", {0, 350}, true);
          ImGui::TextColored({0.45f, 0.88f, 1.0f, 1.0f}, "BLACK-MARKET TECH UPGRADES:");
          for (size_t uiIdx = 0; uiIdx < session.techUpgrades().size(); ++uiIdx) {
            const auto& up = session.techUpgrades()[uiIdx];
            const int lvl = session.upgradeLevel(up.id);
            ImGui::PushID(static_cast<int>(1200 + uiIdx));
            ImGui::Text("[%s] %s  (Tier %d/%d)", up.category.c_str(), up.name.c_str(), lvl, up.maxLevel);
            if (lvl < up.maxLevel) {
              char btn[96];
              std::snprintf(btn, sizeof(btn), "Upgrade -> %s ($%d%s%s)",
                            up.effectLabels[static_cast<size_t>(lvl)].c_str(),
                            up.creditCosts[static_cast<size_t>(lvl)],
                            up.intelCosts[static_cast<size_t>(lvl)] > 0 ? (" +" + std::to_string(up.intelCosts[static_cast<size_t>(lvl)]) + " INT").c_str() : "",
                            up.salvageCosts[static_cast<size_t>(lvl)] > 0 ? (" +" + std::to_string(up.salvageCosts[static_cast<size_t>(lvl)]) + " SLV").c_str() : "");
              if (ImGui::SmallButton(btn)) {
                session.buyTechUpgrade(uiIdx, audio);
              }
            } else {
              ImGui::TextColored({0.35f, 0.95f, 0.58f, 1.0f}, "MAX TIER (%s)", up.effectLabels[3].c_str());
            }
            ImGui::PopID();
          }
          ImGui::Separator();
          ImGui::TextColored({0.98f, 0.78f, 0.28f, 1.0f}, "OPERATIVE CONDITIONING (BODY STATS):");
          for (size_t bi = 0; bi < kBodyStatCount; ++bi) {
            const auto kind = static_cast<BodyStatKind>(bi);
            const float val = session.bodyStatValue(kind);
            char lbl[64];
            std::snprintf(lbl, sizeof(lbl), "%s (%s): %.0f / 100", GameSession::bodyStatName(kind), GameSession::bodyStatShort(kind), val);
            ImGui::ProgressBar(val / 100.0f, {-1, 13}, lbl);
          }
          ImGui::EndChild();
          ImGui::EndTabItem();
        }

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
          ImGui::PushStyleColor(ImGuiCol_Button, ImVec4(0.16f, 0.54f, 0.78f, 1.0f));
          if (ImGui::Button("Launch 3D Gunsmith Studio [F2]")) {
            ui.showPhone = false;
            session.setGunsmithOpen(true);
            session.setGunsmithSlot(session.activeWeaponIdx() > 0 ? session.activeWeaponIdx() : 2);
          }
          ImGui::PopStyleColor();
          ImGui::Text("Headshots: %d | Bodies Hidden: %d", session.totalHeadshots(), session.bodiesDisposedCount());
          ImGui::Separator();

          static const char* kOpticNames[5] = {"Irons", "Red Dot", "Holo", "ACOG", "8x Scope"};
          static const char* kMuzzleNames[5] = {"Std", "Suppressor", "Compensator", "Osprey SD", "Wrapped SD"};
          static const char* kUnderNames[4] = {"None", "Vert Grip", "PEQ Laser", "Angled Grip"};
          static const char* kMagNames[3] = {"Std Mag", "Ext Mag", "Drum"};
          static const char* kFinishNames[8] = {"Obsidian", "Coyote", "Arctic", "Crimson", "Gold", "Titanium", "Olive", "Cobalt"};

          ImGui::BeginChild("ArmoryWorkbench", {0, 275}, true);
          for (size_t i = 1; i < session.weapons().size(); ++i) {
            const auto& w = session.weapons()[i];
            ImGui::PushID(static_cast<int>(200 + i));
            ImGui::TextColored(w.unlocked ? ImVec4(0.45f, 0.96f, 0.65f, 1.0f) : ImVec4(0.88f, 0.88f, 0.92f, 1.0f),
                               "[%zu] %s  |  DMG %.0f  |  %d rnd  %s",
                               i + 1, w.name.c_str(), w.damage, w.magSize, w.suppressed ? "[SD]" : "[LOUD]");
            ImGui::SameLine();
            if (ImGui::SmallButton("Inspect 3D")) {
              ui.showPhone = false;
              session.setGunsmithOpen(true);
              session.setGunsmithSlot(static_cast<int>(i));
            }
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
                session.configureWeaponSlot(static_cast<int>(i), static_cast<WeaponOpticKind>((static_cast<int>(w.optic) + 1) % 5), w.muzzle, w.underbarrel, w.mag, w.bodyFinish);
              }
              ImGui::SameLine();
              if (ImGui::SmallButton((std::string("Muz: ") + kMuzzleNames[static_cast<int>(w.muzzle)]).c_str())) {
                session.configureWeaponSlot(static_cast<int>(i), w.optic, static_cast<WeaponMuzzleKind>((static_cast<int>(w.muzzle) + 1) % 5), w.underbarrel, w.mag, w.bodyFinish);
              }
              if (ImGui::SmallButton((std::string("Under: ") + kUnderNames[static_cast<int>(w.underbarrel)]).c_str())) {
                session.configureWeaponSlot(static_cast<int>(i), w.optic, w.muzzle, static_cast<WeaponUnderbarrelKind>((static_cast<int>(w.underbarrel) + 1) % 4), w.mag, w.bodyFinish);
              }
              ImGui::SameLine();
              if (ImGui::SmallButton((std::string("Mag: ") + kMagNames[static_cast<int>(w.mag)]).c_str())) {
                session.configureWeaponSlot(static_cast<int>(i), w.optic, w.muzzle, w.underbarrel, static_cast<WeaponMagKind>((static_cast<int>(w.mag) + 1) % 3), w.bodyFinish);
              }
              ImGui::SameLine();
              if (ImGui::SmallButton((std::string("Finish: ") + kFinishNames[static_cast<int>(w.bodyFinish)]).c_str())) {
                session.configureWeaponSlot(static_cast<int>(i), w.optic, w.muzzle, w.underbarrel, w.mag, static_cast<WeaponFinishKind>((static_cast<int>(w.bodyFinish) + 1) % 8));
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

        const ImGuiTabItemFlags realtyTabFlags = (ui.forcePhoneTab == 7) ? ImGuiTabItemFlags_SetSelected : ImGuiTabItemFlags_None;
        if (ImGui::BeginTabItem("Realty & World", nullptr, realtyTabFlags)) {
          if (ui.forcePhoneTab == 7) ui.forcePhoneTab = -1;
          ImGui::BeginChild("RealtyWorldScroll", {0, 390}, true);

          if (session.activeApartmentIdx() >= 0) {
            const auto& curApt = session.apartments()[static_cast<size_t>(session.activeApartmentIdx())];
            ImGui::TextColored({0.35f, 0.96f, 0.65f, 1.0f}, "INSIDE SAFEHOUSE: %s (%s)", curApt.name.c_str(), curApt.district.c_str());
            if (ImGui::SmallButton("Rest +6h & Heal")) session.useApartmentBed(audio);
            ImGui::SameLine();
            if (ImGui::SmallButton("Wardrobe Suit")) session.useApartmentWardrobe(audio);
            ImGui::SameLine();
            if (ImGui::SmallButton("Armory Refill")) session.useApartmentArmoryBench(audio);
            ImGui::SameLine();
            if (ImGui::SmallButton("Exit Suite")) session.exitApartment(player, audio);
            ImGui::Separator();
          }

          ImGui::TextColored({0.98f, 0.78f, 0.28f, 1.0f}, "WESTGATE LUXURY REALTY (SAFEHOUSES):");
          for (size_t ai = 0; ai < session.apartments().size(); ++ai) {
            const auto& apt = session.apartments()[ai];
            ImGui::PushID(static_cast<int>(1200 + ai));
            ImGui::TextColored(apt.owned ? ImVec4(0.42f, 0.96f, 0.62f, 1.0f) : ImVec4(0.94f, 0.94f, 0.98f, 1.0f),
                               "%s [%s]  %s", apt.name.c_str(), apt.district.c_str(), apt.owned ? "[OWNED]" : "");
            ImGui::TextDisabled("%s", apt.vibe.c_str());
            if (!apt.owned) {
              char buyAptLbl[64];
              std::snprintf(buyAptLbl, sizeof(buyAptLbl), "Buy Deed ($%d)", apt.price);
              if (ImGui::SmallButton(buyAptLbl)) session.buyApartment(static_cast<int>(ai), audio);
            } else {
              if (ImGui::SmallButton("Enter Sky-Suite")) {
                session.enterApartment(static_cast<int>(ai), player, audio);
                ui.showPhone = false;
              }
            }
            ImGui::SameLine();
            if (ImGui::SmallButton("GPS Door")) session.setGpsWaypoint(apt.doorPos, apt.name);
            ImGui::Separator();
            ImGui::PopID();
          }

          ImGui::TextColored({0.42f, 0.90f, 1.0f, 1.0f}, "LIVING WORLD EXPLORATION:");
          char stashBar[64];
          std::snprintf(stashBar, sizeof(stashBar), "Hidden Cash Stashes: %d / %d", session.stashesFound(), session.totalStashes());
          ImGui::ProgressBar(static_cast<float>(session.stashesFound()) / static_cast<float>(std::max(1, session.totalStashes())), {-1, 15}, stashBar);
          if (ImGui::SmallButton("Ping Nearest Unfound Stash GPS")) {
            float bestD = 1e9f;
            glm::vec3 bestP = pPos;
            for (const auto& cp : session.collectibles()) {
              if (!cp.collected && cp.kind == CollectibleKind::Stash) {
                const float d = glm::distance(pPos, cp.pos);
                if (d < bestD) { bestD = d; bestP = cp.pos; }
              }
            }
            if (bestD < 1e8f) session.setGpsWaypoint(bestP, "Hidden Cash Stash");
          }
          ImGui::SameLine();
          if (ImGui::SmallButton("Dispatch Street Event")) {
            const auto nextKind = static_cast<RandomEventKind>(session.randomEventsResolved() % 3);
            session.spawnRandomEvent(nextKind, pPos, world, audio);
          }
          ImGui::Text("Street Events Resolved: %d  |  3D Wildlife Active: %zu Quadrupeds + %zu Birds",
                      session.randomEventsResolved(), session.wildlife().size(), session.birdFlocks().size());

          ImGui::Separator();
          ImGui::TextColored({0.98f, 0.68f, 0.24f, 1.0f}, "RADAR SPEED TRAPS (%d / %zu Target Beaten):",
                             session.speedTrapsBeatenCount(), session.speedTraps().size());
          for (size_t ti = 0; ti < session.speedTraps().size(); ++ti) {
            const auto& tr = session.speedTraps()[ti];
            const bool beaten = tr.bestKmh >= tr.targetKmh;
            ImGui::PushID(static_cast<int>(1300 + ti));
            if (ImGui::SmallButton("GPS")) session.setGpsWaypoint(tr.pos, tr.name);
            ImGui::SameLine();
            ImGui::TextColored(beaten ? ImVec4(0.42f, 0.96f, 0.62f, 1.0f) : ImVec4(0.88f, 0.88f, 0.92f, 1.0f),
                               "%s: Best %d / %d km/h %s",
                               tr.name.c_str(), tr.bestKmh, tr.targetKmh, beaten ? "[RECORD]" : "");
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
