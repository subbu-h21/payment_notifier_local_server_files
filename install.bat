@echo off
echo ========================================
echo   Payment Notifier - First Time Setup
echo ========================================
echo.

:: Check Node.js
node --version >nul 2>&1
if errorlevel 1 (
    echo ERROR: Node.js is not installed.
    echo.
    echo Please download and install Node.js from:
    echo   https://nodejs.org  ^(choose the LTS version^)
    echo.
    echo Then run this file again.
    pause
    exit /b 1
)

echo Node.js found:
node --version
echo.

:: Install server dependencies
echo Installing server dependencies...
cd package\local_server_file
npm install
cd ..\..
echo.

:: Install Electron overlay dependencies
echo Installing overlay dependencies...
cd electron_app
npm install
cd ..
echo.

echo ========================================
echo   Setup complete!
echo   Run start.bat to launch the app.
echo ========================================
pause
