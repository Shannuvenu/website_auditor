@echo off
setlocal
title PageSpeed Advisor launcher
cd /d "%~dp0"
set PORT=3000

if not exist "node_modules" (
  echo node_modules was not found. Run "npm install" in this folder first.
  pause
  exit /b 1
)

if not exist ".next\BUILD_ID" (
  echo First start: building the app. This takes about a minute...
  call npm run build
  if errorlevel 1 (
    echo The build failed. Open a terminal in this folder and run: npm run build
    pause
    exit /b 1
  )
)

powershell -NoProfile -Command "if ((Test-NetConnection -ComputerName localhost -Port %PORT% -WarningAction SilentlyContinue).TcpTestSucceeded) { exit 0 } else { exit 1 }"
if errorlevel 1 (
  echo Starting the server...
  start "PageSpeed Advisor server - close this window to stop the app" /min cmd /c "npm run start"
)

echo Waiting for the app to be ready...
set /a TRIES=0
:wait
set /a TRIES+=1
if %TRIES% gtr 60 (
  echo The app did not start within 60 seconds.
  pause
  exit /b 1
)
powershell -NoProfile -Command "if ((Test-NetConnection -ComputerName localhost -Port %PORT% -WarningAction SilentlyContinue).TcpTestSucceeded) { exit 0 } else { Start-Sleep -Seconds 1; exit 1 }"
if errorlevel 1 goto wait

start "" msedge --app=http://localhost:%PORT%
exit /b 0
