@echo off
rem Fallback / debug launcher: shows a console with server logs.
rem Normal use: double-click the desktop shortcut "大肥鱼控制台".
setlocal
cd /d "%~dp0.." || exit /b 1
chcp 65001 >nul
echo Starting control panel server (visible console, for debugging) ...
echo Open http://127.0.0.1:8899/ in your browser.
node control\server.mjs
pause
