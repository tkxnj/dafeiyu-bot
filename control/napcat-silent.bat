@echo off
rem Hidden-console launcher for NapCat, used by the control panel.
rem The caller (napcat-silent.vbs) runs this with a hidden console window, so QQ
rem inherits an existing (hidden) console instead of popping up its own black window.
rem Args: %1 = QQ number, %2 = "qr" for QR login (omit for quick login)
setlocal DisableDelayedExpansion
cd /d "%~dp0..\napcat\napcat" || exit /b 1

if not exist "%~dp0..\data" mkdir "%~dp0..\data"

set "NAPCAT_PATCH_PACKAGE=%cd%\qqnt.json"
set "NAPCAT_LOAD_PATH=%cd%\loadNapCat.js"
set "NAPCAT_INJECT_PATH=%cd%\NapCatWinBootHook.dll"
set "NAPCAT_LAUNCHER_PATH=%cd%\NapCatWinBootMain.exe"
set "NAPCAT_MAIN_PATH=%cd%\napcat.mjs"

rem QQ number for quick login, passed by the control panel as %1
set "BOT_QQ=%~1"
if "%BOT_QQ%"=="" (
  echo [NapCat] BOT_QQ is empty. Fill BOT_QQ in .env first.>> "%~dp0..\data\napcat.log"
  exit /b 1
)
set "MODE=%~2"

set "UninstallString="
for /f "tokens=2*" %%a in ('reg query "HKLM\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\QQ" /v "UninstallString" 2^>nul') do set "UninstallString=%%~b"
set "QQDir=D:\QQ\"
if defined UninstallString (
  for %%a in ("%UninstallString%") do set "QQDir=%%~dpa"
)
set "QQExe=%QQDir%QQ.exe"
if not exist "%QQExe%" set "QQExe=D:\QQ\QQ.exe"
if not exist "%QQExe%" (
  echo [NapCat] QQ not found: %QQExe%>> "%~dp0..\data\napcat.log"
  exit /b 1
)

if /I "%MODE%"=="qr" (
  "%NAPCAT_LAUNCHER_PATH%" "%QQExe%" "%NAPCAT_INJECT_PATH%" >> "%~dp0..\data\napcat.log" 2>&1
) else (
  "%NAPCAT_LAUNCHER_PATH%" "%QQExe%" "%NAPCAT_INJECT_PATH%" -q %BOT_QQ% >> "%~dp0..\data\napcat.log" 2>&1
)
exit /b %ERRORLEVEL%
