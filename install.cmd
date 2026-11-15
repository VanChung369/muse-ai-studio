@echo off
rem Muse AI Studio: double-click to install everything, then start the app.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install.ps1" %*
if errorlevel 1 pause
