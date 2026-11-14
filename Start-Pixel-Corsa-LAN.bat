@echo off
setlocal
cd /d "%~dp0"
echo.
echo =============================================
echo        PIXEL CORSA - LAN MULTIPLAYER
echo =============================================
echo.
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js was not found. Install Node.js 18 or newer from https://nodejs.org/
  echo Only the host needs Node.js. Other players use a browser.
  pause
  exit /b 1
)
for /f %%V in ('node -p "Number(process.versions.node.split('.')[0])"') do set NODE_MAJOR=%%V
if not defined NODE_MAJOR (
  echo Could not detect the Node.js version. Reinstall Node.js from https://nodejs.org/
  pause
  exit /b 1
)
if %NODE_MAJOR% LSS 18 (
  echo Node.js 18 or newer is required. Detected major version: %NODE_MAJOR%
  echo Install the LTS version from https://nodejs.org/ and reopen this window.
  pause
  exit /b 1
)
node --check server.js
if errorlevel 1 (
  echo The multiplayer server has a syntax error. Re-extract the latest game bundle.
  pause
  exit /b 1
)
echo No npm install is required. This LAN server uses Node.js built-in modules only.
node server.js
pause
