@echo off
setlocal EnableExtensions EnableDelayedExpansion
cd /d "%~dp0"

set "CMAKE_EXE="
set "VS_PATH="
set "VS_VER="

rem 1. Locate cmake.exe on PATH, standard Program Files, or bundled inside Visual Studio
for %%I in (cmake.exe) do set "CMAKE_EXE=%%~$PATH:I"

if not defined CMAKE_EXE (
  if exist "%ProgramFiles%\CMake\bin\cmake.exe" set "CMAKE_EXE=%ProgramFiles%\CMake\bin\cmake.exe"
)

set "VSWHERE=%ProgramFiles(x86)%\Microsoft Visual Studio\Installer\vswhere.exe"
if exist "%VSWHERE%" (
  for /f "usebackq delims=" %%P in (`"%VSWHERE%" -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath`) do set "VS_PATH=%%P"
  for /f "usebackq delims=" %%V in (`"%VSWHERE%" -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property catalog_productLineVersion`) do set "VS_VER=%%V"
)

if not defined CMAKE_EXE (
  if defined VS_PATH (
    if exist "!VS_PATH!\Common7\IDE\CommonExtensions\Microsoft\CMake\CMake\bin\cmake.exe" (
      set "CMAKE_EXE=!VS_PATH!\Common7\IDE\CommonExtensions\Microsoft\CMake\CMake\bin\cmake.exe"
    )
  )
)

if not defined CMAKE_EXE (
  echo.
  echo [Westgate Native Engine] ERROR: CMake was not found on this PC.
  echo Run this in PowerShell to install CMake ^(and restart PowerShell afterwards^):
  echo   winget install Kitware.CMake
  echo.
  if not defined VS_PATH (
    echo Also install Visual Studio 2022 C++ Build Tools if not already installed:
    echo   winget install Microsoft.VisualStudio.2022.BuildTools --override "--wait --passive --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"
    echo.
  )
  exit /b 1
)

if not defined VS_PATH (
  where cl.exe >nul 2>&1
  if errorlevel 1 (
    echo.
    echo [Westgate Native Engine] ERROR: No MSVC C++ compiler ^(Visual Studio^) was found.
    echo Install Visual Studio 2022 C++ Build Tools ^(Desktop development with C++^) via PowerShell:
    echo   winget install Microsoft.VisualStudio.2022.BuildTools --override "--wait --passive --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"
    echo.
    exit /b 1
  )
)

echo [Westgate Native Engine] Using CMake: "!CMAKE_EXE!"
if defined VS_PATH echo [Westgate Native Engine] Using Visual Studio !VS_VER!: "!VS_PATH!"

set "CMAKE_GEN="
if "!VS_VER!"=="2022" set "CMAKE_GEN=Visual Studio 17 2022"
if "!VS_VER!"=="2019" set "CMAKE_GEN=Visual Studio 16 2019"
if "!VS_VER!"=="18"   set "CMAKE_GEN=Visual Studio 18 2026"

echo [Westgate Native Engine] Configuring CMake (MSVC x64 + SDL3 + wgpu-native + JoltPhysics)...
if defined CMAKE_GEN (
  "!CMAKE_EXE!" -B build -G "!CMAKE_GEN!" -A x64 -DWESTGATE_BUILD_DESKTOP=ON
  if not errorlevel 1 goto :build_now
  echo Fallback: trying default CMake generator...
  if exist build rmdir /s /q build
)

"!CMAKE_EXE!" -B build -A x64 -DWESTGATE_BUILD_DESKTOP=ON
if errorlevel 1 (
  if exist build rmdir /s /q build
  "!CMAKE_EXE!" -B build -DWESTGATE_BUILD_DESKTOP=ON
  if errorlevel 1 exit /b 1
)

:build_now
echo [Westgate Native Engine] Building Release...
"!CMAKE_EXE!" --build build --config Release --parallel
if errorlevel 1 exit /b 1

echo [Westgate Native Engine] Running Core Engine Tests...
if exist "build\Release\westgate_tests.exe" (
  "build\Release\westgate_tests.exe"
) else (
  "build\westgate_tests.exe"
)
if errorlevel 1 exit /b 1

echo [Westgate Native Engine] Launching westgate_engine.exe...
if exist "build\Release\westgate_engine.exe" (
  start "" "build\Release\westgate_engine.exe"
) else (
  start "" "build\westgate_engine.exe"
)
