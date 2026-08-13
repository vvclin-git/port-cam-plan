@echo off
setlocal

pushd "%~dp0"
if errorlevel 1 (
  echo Cannot open the project directory: %~dp0
  pause
  exit /b 1
)

where python >nul 2>&1
if errorlevel 1 (
  echo Python was not found on PATH.
  echo Install Python or run this command manually from the project directory:
  echo   python -m http.server 8765 --bind 127.0.0.1
  pause
  popd
  exit /b 1
)

start "" /b powershell.exe -NoProfile -WindowStyle Hidden -Command "Start-Sleep -Milliseconds 500; Start-Process 'http://127.0.0.1:8765/index.html'"
echo Serving this project at http://127.0.0.1:8765/index.html
echo Press Ctrl+C to stop the HTTP server.
python -m http.server 8765 --bind 127.0.0.1

popd
endlocal
