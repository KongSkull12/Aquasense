@echo off
REM PostgreSQL Database Setup Script for AquaSense
REM This script helps create the AquaSense database

setlocal enabledelayedexpansion

echo.
echo =========================================================================
echo              AquaSense Database Setup
echo =========================================================================
echo.
echo This script will help you create the PostgreSQL database for AquaSense.
echo.
echo Prerequisites:
echo - PostgreSQL must be installed and running
echo - You need the postgres superuser password
echo.

REM Try to find psql in common PostgreSQL installation directories
set "PSQL="
for /D %%D in ("C:\Program Files\PostgreSQL*") do (
    if exist "%%D\bin\psql.exe" (
        set "PSQL=%%D\bin\psql.exe"
        goto :found
    )
)

for /D %%D in ("C:\Program Files (x86)\PostgreSQL*") do (
    if exist "%%D\bin\psql.exe" (
        set "PSQL=%%D\bin\psql.exe"
        goto :found
    )
)

:found
if "!PSQL!"=="" (
    echo ERROR: PostgreSQL installation not found!
    echo.
    echo Please:
    echo 1. Install PostgreSQL from https://www.postgresql.org/download/windows/
    echo 2. Make sure to remember or set the postgres password during installation
    echo 3. Run this script again
    echo.
    pause
    exit /b 1
)

echo Found PostgreSQL: !PSQL!
echo.
echo Please enter the postgres password when prompted...
echo.

REM Create the database
"!PSQL!" -U postgres -h localhost -p 5432 -q -c "CREATE DATABASE \"AquaSense\";" 2>nul

if errorlevel 1 (
    echo.
    echo ERROR: Failed to create database
    echo.
    echo Possible reasons:
    echo - Wrong postgres password
    echo - PostgreSQL is not running
    echo - Database already exists
    echo.
    echo To reset postgres password:
    echo 1. Open pg_ctl status or Services to verify PostgreSQL is running
    echo 2. Contact your system administrator for PostgreSQL password
    echo.
) else (
    echo.
    echo SUCCESS: AquaSense database created!
    echo.
    echo You can now start the backend server:
    echo   cd Backend
    echo   npm run dev
    echo.
)

pause
