@echo off
REM AquaSense - Start Both Frontend and Backend Servers
REM Run this script to start the complete system

echo.
echo =====================================================
echo     AquaSense - Water Quality IoT System
echo =====================================================
echo.
echo Starting Backend Server (Public MQTT profile, port 5002)...
echo Starting Frontend Server (Port 3000)...
echo.

REM Start Backend in a new window
start "AquaSense Backend" cmd /k "cd Backend && npm run dev:public-dev"

REM Wait a few seconds for backend to start
timeout /t 3 /nobreak

REM Start Frontend in a new window
start "AquaSense Frontend" cmd /k "cd Frontend && npm run dev:public-dev"

echo.
echo =====================================================
echo Servers starting...
echo.
echo Backend: http://localhost:5002
echo Frontend: http://localhost:3000
echo.
echo Press any key when ready...
echo =====================================================
pause
