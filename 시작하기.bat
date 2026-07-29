@echo off
rem Letterpress launcher for Windows.
rem The real logic lives in scripts\start-windows.ps1 - PowerShell is far less
rem error-prone than batch, where program-files variables break if-blocks.
rem This file only starts it with the execution policy bypassed.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start-windows.ps1" %*
if errorlevel 1 pause
