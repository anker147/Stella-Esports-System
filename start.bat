@echo off
cd /d "%~dp0"
set "NODE_EXE=%~dp0runtime\node.exe"
if exist "%NODE_EXE%" goto run

set "NODE_EXE=%ProgramFiles%\nodejs\node.exe"
if exist "%NODE_EXE%" goto run

where node >nul 2>nul
if not errorlevel 1 (
  set "NODE_EXE=node"
  goto run
)

echo [ERROR] Bundled runtime\node.exe was not found.
echo Copy the complete project folder and try again.
pause
exit /b 1

:run
echo Using runtime: %NODE_EXE%
"%NODE_EXE%" server\server.js
if errorlevel 1 (
  echo.
  echo Server failed to start. Keep this window open for diagnostics.
  pause
)
