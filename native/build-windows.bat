@echo off
setlocal
cd /d "%~dp0"

echo [Westgate Native Engine] Configuring CMake (MSVC x64 + SDL3 + wgpu-native + JoltPhysics)...
cmake -B build -G "Visual Studio 17 2022" -A x64 -DWESTGATE_BUILD_DESKTOP=ON
if errorlevel 1 (
  echo Fallback: trying default CMake generator...
  if exist build rmdir /s /q build
  cmake -B build -DWESTGATE_BUILD_DESKTOP=ON
  if errorlevel 1 exit /b 1
)

echo [Westgate Native Engine] Building Release...
cmake --build build --config Release --parallel
if errorlevel 1 exit /b 1

echo [Westgate Native Engine] Running Core Engine Tests...
build\Release\westgate_tests.exe
if errorlevel 1 exit /b 1

echo [Westgate Native Engine] Launching westgate_engine.exe...
start "" "build\Release\westgate_engine.exe"
