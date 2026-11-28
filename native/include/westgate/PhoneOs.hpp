#pragma once

#include "westgate/AudioEngine.hpp"
#include "westgate/GameSession.hpp"
#include "westgate/PlayerController.hpp"
#include "westgate/UiTheme.hpp"
#include "westgate/WorldData.hpp"
#include <cstdint>

namespace westgate {

/**
 * Fixed, non-reorderable PearOS 15 (iFruit Phone 15iX) applications & widget views.
 * App and widget positions on the Home Screen are strictly locked by design.
 */
enum class PhoneAppId : uint8_t {
  Home = 0,
  BlackNet = 1,     // Top-left grid: Contracts, Campaign Dossiers, Street Races & Fight Card
  WhatUp = 2,       // Top-center grid: SMS Messenger & Contacts
  Lifegram = 3,     // Top-right grid: WBN Breaking News & Westgate Live Feed
  Motorsports = 4,  // Bottom-left grid: Legendary Motorsports ($USD) & Personal Valet
  Dynasty8 = 5,     // Bottom-center grid: Luxury Realty ($USD) & Open-World Shop Directory
  FruitPay = 6,     // Bottom-right grid: $USD Bank Balance & Transaction Ledger
  Dialer = 7,       // Dock 1: Quick-Service Dialer (Cab, WSPD Scrub, Paramedic, Valet)
  SnapCam = 8,      // Dock 2: Live Viewfinder Camera HUD
  CityMaps = 9,     // Dock 3: Open-World GPS Waypoint & Armory/Boutique Locator
  Settings = 10,    // Dock 4: Read-only PearOS Info, Operative Biometrics & Difficulty
  WeatherView = 11, // Clicked top-left Weather Widget (read-only forecast)
};

struct PhoneOsState {
  PhoneAppId activeApp = PhoneAppId::Home;
  float slideProgress = 0.0f; // 0 = offscreen bottom, 1 = popped up on screen
  int blackNetSubTab = 0;     // 0 = Campaign Ops, 1 = Fixer Hits, 2 = Races & Iron Pit
  int mapsFilter = 0;         // 0 = Armories & Boutiques, 1 = Garages & Marts, 2 = Apartments, 3 = Landmarks
  int selectedSmsIdx = 0;
  float camZoomFactor = 1.0f; // 1.0x or 2.0x viewfinder indicator
  float shutterFlash = 0.0f;
};

/**
 * Advance popup slide animation & draw the screen-space iFruit Phone 15iX OS
 * when open or sliding out. Never spawns a 3D handheld prop; layout is strictly fixed.
 */
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
  bool instantSlide = false
);

} // namespace westgate
