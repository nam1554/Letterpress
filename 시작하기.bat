@echo off
rem Letterpress(레터프레스) — 더블클릭 시작 런처 (Windows)
rem 실제 동작은 scripts\start-windows.ps1 에 있습니다. 이 파일은 실행기일 뿐입니다
rem (배치 문법의 함정을 피하려고 PowerShell로 작성했습니다).
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start-windows.ps1" %*
if errorlevel 1 pause
