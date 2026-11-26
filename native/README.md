# Westgate Native Engine (C++20 + SDL3 + wgpu-native + JoltPhysics)

True native desktop C++20 engine for **Westgate Bay** using:
- **Window / Input**: SDL3 (`release-3.4.20`)
- **Graphics Backend**: `wgpu-native` (`v29.0.1.1`) — runs **DirectX 12 / Vulkan** on Windows, Metal on macOS, Vulkan on Linux via unified WGSL shaders
- **Physics**: JoltPhysics (`v5.7.0`) — `512×512` `HeightFieldShape` terrain, static building colliders, `CharacterVirtual` player capsule, and multi-threaded raycasts
- **Asset Pipeline**: `cgltf` (`v1.15`) + `meshoptimizer` (`v1.3`) + `stb_image` (decodes standard glTF, `KHR_mesh_quantization`, and `EXT_meshopt_compression` GLBs)
- **Audio**: `miniaudio` click-free footstep DSP mixer
- **Debug / HUD Overlay**: Dear ImGui (`SDL3` + `WGPU`)

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
2. Build and launch:
   ```powershell
   cd native
   .\build-windows.bat
   ```
   (`build-windows.bat` automatically searches `PATH`, `Program Files\CMake`, and Visual Studio's bundled CMake via `vswhere.exe`.)
   Or manually:
   ```bat
   cmake -B build -G "Visual Studio 17 2022" -A x64 -DWESTGATE_BUILD_DESKTOP=ON
   cmake --build build --config Release --parallel
   build\Release\westgate_tests.exe
   build\Release\westgate_engine.exe
   ```

## Controls & Gameplay
- `TAB` or `ESC`: Toggle mouse-look camera (or close Tactical Phone)
- `W A S D`: Move / Drive (`Shift` sprint, `C` / `Ctrl` crouch, `Space` jump or vehicle handbrake)
- `G`: Enter / Exit nearest vehicle (`Mustang`, `Ferrari`, `Range Rover`, `Sedan`, `Taxi`, `Police Cruiser`)
- `1`–`6` or Mouse Wheel: Switch weapons (`1: Boxing`, `2: Apex P226-SD`, `3: Vanguard M4A1-S`, `4: MP5-SD`, `5: Breacher 870`, `6: MK14 EBR`)
- `Left Click` / `F`: Fire firearm or throw Jab → Cross → Hook combo
- `Right Click` / `V`: Aim down sights (firearms) or Block (boxing)
- `Q` / `E`: Uppercut / Kick (boxing)
- `R`: Reload firearm or start next Iron Pit opponent tier
- `B`: Buy Medkit + Armor at 24/7 Westgate Marts, or Repair & Respray at Westgate Customs Garages
- `H`: Horn / Siren while driving, or Rob 24/7 Mart register
- `P`: Open Tactical Phone (`Contracts`, `Street Races`, `Iron Pit`, `Gun Runner`, `GPS & Save`)
- `T`: Cycle Sky Time of Day (`Afternoon`, `Sunset`, `Night`, `Dawn`)
- `F1`: Quick teleport to Westgate Iron Pit (`722, 115`)
- `F9`: Toggle Engine Telemetry overlay
