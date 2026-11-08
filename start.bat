@echo off
setlocal
cd /d "%~dp0"
title Minecraft Agent

set "CONFIG=agent.config.json"

echo ==========================================
echo   Minecraft Agent launcher
echo ==========================================
echo.

where node >nul 2>nul
if errorlevel 1 (
    echo [ERROR] Node.js not found in PATH.
    echo         Install Node.js 22.19 or newer from https://nodejs.org
    echo.
    pause
    exit /b 1
)

if not exist "%CONFIG%" (
    if exist "agent.config.example.json" (
        copy "agent.config.example.json" "%CONFIG%" >nul
        echo [SETUP] Created %CONFIG% from the template.
        echo [SETUP] Fill in your server address, player name and API key.
        start "" notepad "%CONFIG%"
    ) else (
        echo [ERROR] %CONFIG% is missing.
    )
    echo.
    pause
    exit /b 1
)

findstr /C:"PUT_YOUR_API_KEY_HERE" "%CONFIG%" >nul 2>nul
if not errorlevel 1 (
    echo [ERROR] %CONFIG% still has the placeholder API key.
    echo         Open it with edit-config.bat and fill in a real key.
    echo.
    pause
    exit /b 1
)

if not exist "node_modules" (
    echo [SETUP] Installing dependencies. First run only, takes a few minutes.
    echo.
    call npm ci
    if errorlevel 1 (
        echo.
        echo [ERROR] npm ci failed. Check the messages above.
        pause
        exit /b 1
    )
    echo.
)

echo [RUN] Starting agent with %CONFIG%
echo [RUN] Press Ctrl+C to stop.
echo.
node --no-warnings bin\minecraft-agent.js run --config "%CONFIG%" %*

set "CODE=%ERRORLEVEL%"
echo.
if not "%CODE%"=="0" (
    echo [EXIT] Agent stopped with code %CODE%.
) else (
    echo [EXIT] Agent stopped.
)
echo.
pause
