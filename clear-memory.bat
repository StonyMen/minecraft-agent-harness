@echo off
setlocal
cd /d "%~dp0"
title Minecraft Agent - Clear Memory

set "CONFIG=agent.config.json"
set "STATE=.agent-state"
set "NAME="
set "TARGET_NAME="

echo ==========================================
echo   Clear agent memory
echo ==========================================
echo.
echo Removes, for the chosen player:
echo   pi-sessions\      conversation history (what it remembers)
echo   mailbox.sqlite    public chat and private messages
echo   *.json *.jsonl    telemetry, status and death log
echo.
echo The agent then starts again as a brand new player.
echo This cannot be undone.
echo.

if not exist "%STATE%" goto :nothing

rem Read the player name from the config so we know which folder is "this agent".
if exist "%CONFIG%" (
    for /f "usebackq delims=" %%n in (`node -e "try{process.stdout.write(String(require('./%CONFIG%').name||''))}catch(e){}"`) do set "NAME=%%n"
)

if /i "%~1"=="--all" goto :confirm_all
if not "%~1"=="" goto :from_arg

:menu
echo   Player in %CONFIG%: %NAME%
echo.
echo   [1] Clear that player only
echo   [2] Clear every player under %STATE%
echo   [0] Cancel
echo.
set "PICK="
set /p "PICK=Choose 1, 2 or 0: "
if "%PICK%"=="1" goto :pick_one
if "%PICK%"=="2" goto :confirm_all
if "%PICK%"=="0" goto :cancel
echo.
echo [ERROR] Invalid choice.
echo.
goto :menu

:pick_one
if "%NAME%"=="" (
    echo.
    echo [ERROR] No "name" in %CONFIG%, so there is no player to target.
    echo         Fill it in with edit-config.bat, or choose 2 to clear everything.
    echo.
    pause
    exit /b 1
)
set "TARGET_NAME=%NAME%"
goto :check_one

:from_arg
set "TARGET_NAME=%~1"

:check_one
if not exist "%STATE%\%TARGET_NAME%" (
    echo.
    echo [SKIP] %STATE%\%TARGET_NAME% does not exist. Nothing to clear.
    echo.
    pause
    exit /b 0
)
echo.
echo About to delete %STATE%\%TARGET_NAME% :
dir /b "%STATE%\%TARGET_NAME%" 2>nul
echo.
echo Close the agent first, otherwise files stay locked.
echo.
set "OK="
set /p "OK=Type YES to confirm: "
if /i not "%OK%"=="YES" goto :cancel
rmdir /s /q "%STATE%\%TARGET_NAME%" 2>nul
if exist "%STATE%\%TARGET_NAME%" (
    echo.
    echo [ERROR] Something could not be deleted. The agent is probably still running.
    echo         Close it, then run this file again.
    echo.
    pause
    exit /b 1
)
echo.
echo [DONE] Memory cleared for %TARGET_NAME%.
echo.
pause
exit /b 0

:confirm_all
echo.
echo About to delete EVERYTHING under %STATE% :
dir /b "%STATE%" 2>nul
echo.
echo Close the agent first, otherwise files stay locked.
echo.
set "OK="
set /p "OK=Type YES to confirm: "
if /i not "%OK%"=="YES" goto :cancel
for /d %%d in ("%STATE%\*") do rmdir /s /q "%%d" 2>nul
del /q "%STATE%\*" 2>nul
for /f "delims=" %%f in ('dir /b "%STATE%" 2^>nul') do (
    echo.
    echo [ERROR] Could not delete %%f. The agent is probably still running.
    echo         Close it, then run this file again.
    echo.
    pause
    exit /b 1
)
echo.
echo [DONE] All agent memory cleared.
echo.
pause
exit /b 0

:cancel
echo.
echo [CANCEL] Nothing was deleted.
echo.
pause
exit /b 0

:nothing
echo [SKIP] %STATE% does not exist. Nothing to clear.
echo.
pause
exit /b 0
