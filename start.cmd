@echo off
rem Muse AI Studio: double-click to start the installed app.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0start.ps1" %*
if errorlevel 1 pause
