# Westgate Bay — Standalone AAA Native PC Architecture (`C++20` + `SDL3` + `wgpu-native` + `JoltPhysics`)

Pure native standalone PC game architecture (zero browser/WebSocket streaming, zero Electron/Tauri webview wrapper):
- **`libwestgate_core` & `libwestgate_runtime`**: Background C++20 engine runtime libraries (`wgpu-native v29.0.1.1` DirectX 12 / Metal / Vulkan, `JoltPhysics v5.7.0`, `cgltf` + `meshoptimizer`, `miniaudio` lock-free DSP mixer, persistent `GameSettings`, and anti-aliased TrueType typography).
- **`WestgateBay` (`WestgateBay.exe`)**: Standalone shipping AAA game client inside a single zero-copy GPU swapchain — Live 3D Cinematic Skyline Main Menu, simulation-freezing `[ESC]` Pause Menu, 5-tab PC Settings (`westgate_settings.json`), Save/Load (`westgate_save.json`), 3D Gunsmith Design Studio (`[F2]`), First-Person & Third-Person combat, and bespoke frameless vector Tactical HUD (`--dev` gates developer telemetry).
- **`WestgateLauncher` (`WestgateLauncher.exe`)**: Lightweight (`~4.6 MB`) native SDL3 + WebGPU pre-game desktop launcher (like *REDlauncher* / *Hitman*'s launcher) for key-art, operative save dossier, quick display/graphics setup, and launching `WestgateBay`.

## Quick Start (Windows 10 / 11 with Visual Studio 2022 + CMake)

If `cmake` or Visual Studio's C++ compiler (`MSVC`) is not installed yet, run these in PowerShell first (then open a new PowerShell window):
```powershell
winget install Kitware.CMake
winget install Microsoft.VisualStudio.2022.BuildTools --override "--wait --passive --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"
```

1. *(Optional, if world data changed)* Export Westgate Bay world data from the repo root:
   ```bat
   npm run export:native
   ```
2. Build and launch the Desktop Pre-Game Launcher:
   ```powershell
   cd native
   .\build-windows.bat
   ```
   Or manually:
   ```bat
   cmake -B build -G "Visual Studio 17 2022" -A x64 -DWESTGATE_BUILD_DESKTOP=ON
   cmake --build build --config Release --parallel
   build\Release\westgate_tests.exe
   build\Release\WestgateLauncher.exe
   rem Or boot the shipping game client directly:
   build\Release\WestgateBay.exe
   ```

## Controls & Gameplay
- `ESC`: Open/Close simulation-freezing **Pause Menu** (or close Settings / SkyPhone / 3D Gunsmith)
- `TAB`: Release / recapture mouse cursor in-game
- `V` / `F5`: Toggle **First-Person / Third-Person** on foot (or Rear Silent Takedown when behind an isolated target); cycle **Driving Camera** (`Chase` -> `Wide` -> `Hood`) in vehicles
- `F2`: Open Interactive **3D Gunsmith Design Studio** (`360°` orbit, zoom, 3-zone Cerakote finishes, optics, suppressors, grips, magazines)
- `W A S D`: Move / Drive / Boat Throttle & Rudder / Helicopter Cyclic (`Shift` sprint, `C` / `Ctrl` crouch or Heli descend, `Space` jump, handbrake drift, or Heli climb)
- `G`: Enter / Exit nearest vehicle across all **20 3D GLB Vehicles, Boats & Helicopter**
- `1`–`6` or Mouse Wheel: Switch weapons (`1: Boxing & Grappling`, `2: Apex P226-SD`, `3: Vanguard M4A1-S`, `4: MP5-SD`, `5: Breacher 870`, `6: MK14 EBR`)
- `Left Click` / `F`: Fire firearm or throw Jab → Cross → Hook combo
- `Right Click`: 3D Optical Aim Down Sights (firearms) or Block (boxing)
- `Q` / `E` / `X`: Uppercut / Kick / Directional Dodge Roll
- `Z` / `U`: Clinch Grapple & Body Slam / Double-Leg Takedown & Guillotine Choke
- `J`: Pick up / Carry / Dispose unconscious or eliminated body
- `R`: Reload firearm or start next Iron Pit opponent tier
- `B` / `H`: Context shop/valet/customs interaction & vehicle horn/siren/stage upgrade
- `P`: Open **Tactical SkyPhone** (`Campaign`, `Contracts`, `Races & Pit`, `Gun Runner`, `Autos & Garage`, `Tech & Stats`, `GPS & Save`)
- `T` / `Y`: Cycle Sky Time of Day (`Afternoon`, `Sunset`, `Night`, `Dawn`) / Weather (`Clear`, `Overcast`, `Rain`, `Thunderstorm`)
- `--dev` CLI flag: Enables developer diagnostics (`F9` Engine Telemetry overlay & `F1` quick pit teleport)
