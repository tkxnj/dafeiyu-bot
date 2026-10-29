@echo off
setlocal
cd /d "%~dp0" || exit /b 1
chcp 65001 >nul
title Blue Fatfish - First Setup

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo [ERROR] Node.js not found. Install Node.js 24+ from https://nodejs.org
  pause
  exit /b 1
)

node "%~dp0scripts\first-run-setup.mjs"
if errorlevel 1 (
  echo.
  pause
  exit /b 1
)

echo.
set /p "GO=Start now? [Y/n]: "
if /I "%GO%"=="n" (
  echo.
  echo Saved .env. Double-click 启动.bat when you want to start.
  pause
  exit /b 0
)

call "%~dp0启动.bat"
