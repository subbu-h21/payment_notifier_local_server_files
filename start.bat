@echo off

:: Check Node.js
node --version >nul 2>&1
if errorlevel 1 (
    echo ERROR: Node.js is not installed. Please run install.bat first.
    pause
    exit /b 1
)

:: Check dependencies are installed
if not exist "package\local_server_file\node_modules" (
    echo Dependencies not installed. Please run install.bat first.
    pause
    exit /b 1
)

if not exist "electron_app\node_modules" (
    echo Dependencies not installed. Please run install.bat first.
    pause
    exit /b 1
)

:: Check .env exists
if not exist "package\local_server_file\.env" (
    echo ERROR: .env file not found in package\local_server_file\
    echo Please copy your .env file there before starting.
    pause
    exit /b 1
)

:: Start server in a separate window
start "Payment Server" cmd /k "cd /d %~dp0package\local_server_file && node server.js"

:: Small delay to let server start before overlay connects
timeout /t 3 /nobreak >nul

:: Start Electron overlay
cd electron_app
npm start
