@echo off
setlocal
cd /d "%~dp0"

if not exist "agent.config.json" (
    if exist "agent.config.example.json" (
        copy "agent.config.example.json" "agent.config.json" >nul
        echo Created agent.config.json from the template.
    )
)

if not exist "agent.config.json" (
    echo [ERROR] agent.config.json is missing and the template was not found.
    pause
    exit /b 1
)

start "" notepad "agent.config.json"
