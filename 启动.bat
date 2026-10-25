@echo off
setlocal DisableDelayedExpansion
cd /d "%~dp0" || exit /b 1
chcp 65001 >nul
title Blue Fatfish Bot

rem ---------- 1) Node.js ----------
where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js not found. Install Node.js 20+ from https://nodejs.org
  pause
  exit /b 1
)

rem ---------- 2) .env ----------
if not exist ".env" (
  echo First run: creating .env from .env.example ...
  copy /y ".env.example" ".env" >nul
  echo Please fill LLM_API_KEY in .env, save it, then run this script again.
  notepad ".env"
  pause
  exit /b 1
)

rem ---------- 3) npm dependencies ----------
if not exist "node_modules" (
  echo Installing dependencies, this only happens once ...
  call npm install --no-fund --no-audit
  if errorlevel 1 (
    echo.
    echo [ERROR] npm install failed. Try a mirror first:
    echo    npm config set registry https://registry.npmmirror.com
    pause
    exit /b 1
  )
)

rem ---------- 4) NapCat: start if WebSocket 3001 is not listening ----------
rem 从 .env 读取 BOT_QQ（用于快速登录和生成 OneBot 配置）
set "BOT_QQ="
for /f "tokens=1,* delims==" %%a in ('findstr /b "BOT_QQ=" ".env" 2^>nul') do set "BOT_QQ=%%b"

netstat -ano | findstr ":3001" | findstr "LISTENING" >nul
if errorlevel 1 (
  if not exist "%~dp0napcat\start-napcat.bat" (
    echo.
    echo [ERROR] NapCat not found in napcat\.
    echo   - If you downloaded dafeiyu-bot-full.zip it should be included; re-extract the zip.
    echo   - If you use the source repo, install NapCat into napcat\, or start your own OneBot 11 WS at ws://127.0.0.1:3001.
    pause
    exit /b 1
  )
  if "%BOT_QQ%"=="" (
    echo.
    echo [ERROR] BOT_QQ is empty in .env. Fill your bot QQ number first.
    pause
    exit /b 1
  )
  if exist "%~dp0scripts\setup-napcat.mjs" (
    node "%~dp0scripts\setup-napcat.mjs"
  )
  echo Starting NapCat in a new window ...
  start "NapCat" cmd /c "%~dp0napcat\start-napcat.bat" %BOT_QQ%
  echo Waiting for NapCat WebSocket on port 3001, up to 120 seconds ...
  powershell -NoProfile -Command "$ok=$false; for($i=0;$i -lt 120;$i++){ if(Get-NetTCPConnection -LocalPort 3001 -State Listen -ErrorAction SilentlyContinue){$ok=$true;break}; Start-Sleep -Seconds 1 }; if(-not $ok){exit 1}"
  if errorlevel 1 (
    echo.
    echo [WARN] NapCat did not open port 3001.
    echo   - First run: look at the NapCat window and scan the QR code with the bot QQ account.
    echo   - Still stuck? See data\napcat.log and README "首次登录 NapCat".
    pause
    exit /b 1
  )
)

rem ---------- 5) run the bot ----------
echo Starting bot ... press Ctrl+C to stop.
node src/index.js

echo.
echo Bot stopped. NapCat may still be running in its own window.
pause >nul
