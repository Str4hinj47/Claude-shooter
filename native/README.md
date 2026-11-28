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
- `W A S D`: Move / Drive / Boat Throttle & Rudder / Helicopter Cyclic (`Shift` sprint, `C` / `Ctrl` crouch or Heli descend, `Space` jump, handbrake drift, or Heli climb)
- `G`: Enter / Exit nearest vehicle across all **20 3D GLB Vehicles, Boats & Helicopter** (`Golf R`, `Mercedes S63`, `Baja 4x4`, `KrAZ 6x6`, `Mustang`, `Ferrari`, `R8`, `Challenger`, `RS7`, `Range Rover`, `Sedan`, `Taxi`, `Police Cruiser`, upgraded `VW LT Ambulance`, `Firetruck`, `Delivery Van`, `Semi`, `Cigarette Speedboat`, `Harbor Cruiser`, `Bell 407 Helicopter`)
- `V`: Cycle **Driving Camera** (`Chase` -> `Cinematic Wide` -> `Hood/Bonnet`) while driving; **Rear Silent Takedown** / Block on foot
- `1`–`6` or Mouse Wheel: Switch weapons (`1: Boxing & Grappling`, `2: Apex P226-SD`, `3: Vanguard M4A1-S`, `4: MP5-SD`, `5: Breacher 870`, `6: MK14 EBR`)
- `Left Click` / `F`: Fire firearm or throw Jab → Cross → Hook combo
- `Right Click`: Aim down sights (firearms) or Block (boxing)
- `Q` / `E` / `X`: Uppercut / Kick / Directional Dodge Roll
- `Z` / `U`: Clinch Grapple & Body Slam / Double-Leg Takedown & Guillotine Choke
- `R`: Reload firearm or start next Iron Pit opponent tier
- `B`: Buy Medkit + Armor at 24/7 Westgate Marts, Free Repair & Respray at Westgate Customs Garages, or Free Starter Golf R Valet at the Luxury Auto Dealership `(56, -118)`
- `H`: Horn / Emergency Strobe Siren while driving, **Stage 1–3 Turbo Engine Upgrade** inside Westgate Customs, or Rob 24/7 Mart register
- `P`: Open Tactical Phone (`Contracts`, `Races & Pit`, `Gun Runner`, **`Autos & Garage`** Dealership + Personal Valet, `GPS & Save`)
- `T` / `Y`: Cycle Sky Time of Day (`Afternoon`, `Sunset`, `Night`, `Dawn`) / Weather (`Clear`, `Overcast`, `Rain`, `Thunderstorm`)
- `F1`: Quick teleport to Westgate Iron Pit (`722, 115`)
- `F9`: Toggle Engine Telemetry overlay
