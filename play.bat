@echo off
setlocal EnableExtensions EnableDelayedExpansion
title VANGUARD: Blackout Protocol - Local Launcher

set "REPO_URL=https://github.com/Str4hinj47/Claude-shooter.git"
set "BRANCH=arena/68ed033e-claude-shooter"
set "ZIP_URL=https://github.com/Str4hinj47/Claude-shooter/archive/refs/heads/arena/68ed033e-claude-shooter.zip"
set "PORT=5173"
set "SELF_DIR=%~dp0"
if "%SELF_DIR:~-1%"=="\" set "SELF_DIR=%SELF_DIR:~0,-1%"

echo ========================================================
echo   VANGUARD: BLACKOUT PROTOCOL - Local Setup ^& Launcher
echo ========================================================
echo.

REM --- 1. Locate or download project files ---
set "NEED_INSTALL=0"
if exist "%SELF_DIR%\package.json" (
    set "APP_DIR=%SELF_DIR%"
    echo [1/4] Found existing project in "%APP_DIR%".
    goto :AfterRepo
)

set "APP_DIR=%SELF_DIR%\Claude-shooter"
if exist "%APP_DIR%\package.json" (
    echo [1/4] Found existing project in "%APP_DIR%".
    where git >nul 2>&1
    if !errorlevel! equ 0 if exist "%APP_DIR%\.git" (
        echo       Checking for updates on %BRANCH%...
        pushd "%APP_DIR%"
        git pull --ff-only origin %BRANCH% >nul 2>&1 && set "NEED_INSTALL=1"
        popd
    )
    goto :AfterRepo
)

echo [1/4] Downloading game source from GitHub...
set "NEED_INSTALL=1"
where git >nul 2>&1
if %errorlevel% equ 0 (
    git clone --branch "%BRANCH%" --single-branch "%REPO_URL%" "%APP_DIR%"
    if !errorlevel! equ 0 goto :AfterRepo
    echo       Git clone failed, trying direct ZIP download...
)

call :DownloadRepoZip
if errorlevel 1 (
    echo.
    echo [ERROR] Failed to download repository from GitHub.
    echo Please check your internet connection and try again.
    pause
    exit /b 1
)

:AfterRepo
cd /d "%APP_DIR%" || (
    echo [ERROR] Could not enter "%APP_DIR%".
    pause
    exit /b 1
)

REM --- 2. Locate or download portable Node.js LTS ---
set "NODE_PORTABLE=%LOCALAPPDATA%\VanguardNode"
where node >nul 2>&1
if %errorlevel% neq 0 (
    if exist "%ProgramFiles%\nodejs\node.exe" set "PATH=%ProgramFiles%\nodejs;%PATH%"
)
where node >nul 2>&1
if %errorlevel% neq 0 (
    if exist "%NODE_PORTABLE%\node.exe" set "PATH=%NODE_PORTABLE%;%PATH%"
)

where node >nul 2>&1
if %errorlevel% equ 0 (
    for /f "delims=" %%v in ('node -v') do echo [2/4] Using Node.js %%v.
    goto :AfterNode
)

echo [2/4] Node.js not found. Downloading portable Node.js v22 LTS...
call :DownloadNodePortable
if errorlevel 1 (
    echo.
    echo [ERROR] Could not download Node.js automatically.
    echo Please install Node.js LTS from https://nodejs.org/ and re-run this file.
    pause
    exit /b 1
)
set "PATH=%NODE_PORTABLE%;%PATH%"

:AfterNode
REM --- 3. Install npm packages ---
if not exist "%APP_DIR%\node_modules" set "NEED_INSTALL=1"
if "%NEED_INSTALL%"=="1" (
    echo [3/4] Installing dependencies...
    call npm install --no-audit --no-fund
    if errorlevel 1 (
        echo.
        echo [ERROR] npm install failed.
        pause
        exit /b 1
    )
) else (
    echo [3/4] Dependencies already installed.
)

REM --- 4. Start local server & open browser tab ---
echo [4/4] Starting local server on http://localhost:%PORT%/ ...
echo       Keep this window open while playing. Press Ctrl+C to stop.
echo.

call npx vite --host localhost --port %PORT% --open
if errorlevel 1 (
    echo.
    echo [ERROR] Failed to start the local web server.
    pause
    exit /b 1
)

endlocal
exit /b 0

:DownloadRepoZip
set "TMP_ZIP=%TEMP%\vanguard-src.zip"
set "TMP_EXT=%TEMP%\vanguard-extract"
if exist "%TMP_ZIP%" del /f /q "%TMP_ZIP%"
if exist "%TMP_EXT%" rmdir /s /q "%TMP_EXT%"
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; " ^
  "Invoke-WebRequest -Uri '%ZIP_URL%' -OutFile '%TMP_ZIP%' -UseBasicParsing; " ^
  "Expand-Archive -Path '%TMP_ZIP%' -DestinationPath '%TMP_EXT%' -Force; " ^
  "$sub = Get-ChildItem -Path '%TMP_EXT%' -Directory | Select-Object -First 1; " ^
  "if (-not $sub) { throw 'Empty archive' }; " ^
  "Move-Item -Path $sub.FullName -Destination '%APP_DIR%' -Force"
set "DL_RC=%errorlevel%"
if exist "%TMP_ZIP%" del /f /q "%TMP_ZIP%"
if exist "%TMP_EXT%" rmdir /s /q "%TMP_EXT%"
exit /b %DL_RC%

:DownloadNodePortable
set "NODE_ZIP=%TEMP%\node-win-x64.zip"
set "NODE_EXT=%TEMP%\node-extract"
if exist "%NODE_ZIP%" del /f /q "%NODE_ZIP%"
if exist "%NODE_EXT%" rmdir /s /q "%NODE_EXT%"
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; " ^
  "$idx = Invoke-RestMethod -Uri 'https://nodejs.org/dist/index.json'; " ^
  "$ver = ($idx | Where-Object { $_.version -like 'v22.*' } | Select-Object -First 1).version; " ^
  "if (-not $ver) { $ver = 'v22.14.0' }; " ^
  "$url = 'https://nodejs.org/dist/' + $ver + '/node-' + $ver + '-win-x64.zip'; " ^
  "Write-Host ('      Downloading ' + $url); " ^
  "Invoke-WebRequest -Uri $url -OutFile '%NODE_ZIP%' -UseBasicParsing; " ^
  "Expand-Archive -Path '%NODE_ZIP%' -DestinationPath '%NODE_EXT%' -Force; " ^
  "$sub = Get-ChildItem -Path '%NODE_EXT%' -Directory | Select-Object -First 1; " ^
  "if (Test-Path '%NODE_PORTABLE%') { Remove-Item -Recurse -Force '%NODE_PORTABLE%' }; " ^
  "Move-Item -Path $sub.FullName -Destination '%NODE_PORTABLE%' -Force"
set "NODE_RC=%errorlevel%"
if exist "%NODE_ZIP%" del /f /q "%NODE_ZIP%"
if exist "%NODE_EXT%" rmdir /s /q "%NODE_EXT%"
exit /b %NODE_RC%
