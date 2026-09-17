@echo off
setlocal EnableExtensions
cd /d "%~dp0"
title The Small Machine at the Edge of Night - Webapp v1.2.3

if not exist "index.html" (
  echo ERROR: index.html was not found beside this launcher.
  echo.
  pause
  exit /b 1
)

set "PYTHON_CMD="

where py >nul 2>nul
if not errorlevel 1 (
  py -3 -c "import sys;raise SystemExit(0 if sys.version_info>=(3,8) else 1)" >nul 2>nul
  if not errorlevel 1 set "PYTHON_CMD=py -3"
)

if not defined PYTHON_CMD (
  where python >nul 2>nul
  if not errorlevel 1 (
    python -c "import sys;raise SystemExit(0 if sys.version_info>=(3,8) else 1)" >nul 2>nul
    if not errorlevel 1 set "PYTHON_CMD=python"
  )
)

if not defined PYTHON_CMD (
  where python3 >nul 2>nul
  if not errorlevel 1 (
    python3 -c "import sys;raise SystemExit(0 if sys.version_info>=(3,8) else 1)" >nul 2>nul
    if not errorlevel 1 set "PYTHON_CMD=python3"
  )
)

if not defined PYTHON_CMD (
  echo ERROR: Python 3.8 or newer was not found.
  echo.
  pause
  exit /b 9009
)

set "PORT="
for /f %%P in ('%PYTHON_CMD% -c "import socket;s=socket.socket();s.bind(('127.0.0.1',0));print(s.getsockname()[1]);s.close()"') do set "PORT=%%P"
if not defined PORT (
  echo ERROR: Could not allocate a localhost port.
  echo.
  pause
  exit /b 2
)

set "URL=http://127.0.0.1:%PORT%/"
echo.
echo Starting The Small Machine at the Edge of Night v1.2.3
echo %URL%
echo Close this window or press Ctrl+C to stop the local server.
echo.

start "" /b powershell -NoProfile -WindowStyle Hidden -Command ^
  "$u='%URL%'; for($i=0;$i -lt 100;$i++){ try { $r=Invoke-WebRequest -UseBasicParsing -Uri $u -TimeoutSec 1; if($r.StatusCode -eq 200){ Start-Process $u; exit 0 } } catch {}; Start-Sleep -Milliseconds 100 }; exit 1"

%PYTHON_CMD% -u -m http.server %PORT% --bind 127.0.0.1
set "EXITCODE=%ERRORLEVEL%"
if not "%EXITCODE%"=="0" (
  echo.
  echo Local web server exited with error code %EXITCODE%.
  pause
)
exit /b %EXITCODE%
