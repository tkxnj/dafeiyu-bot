@echo off
setlocal
cd /d "%~dp0" || exit /b 1
chcp 65001 >nul
title Stop Blue Fatfish

echo Stopping NapCat (headless QQ) ...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\stop-all.ps1"
echo.
echo Bot: press Ctrl+C in the bot window, or just close that window.
echo Done.
pause >nul
