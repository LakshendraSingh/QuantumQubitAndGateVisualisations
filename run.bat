@echo off
setlocal enabledelayedexpansion
title Quantum Visualizer

echo =======================================================
echo   Quantum Visualizer - Windows One-Shot Launcher
echo =======================================================
echo.

:: Ensure we run from the project root directory
cd /d "%~dp0"

:: 1. Detect Python
set "PYTHON_CMD="
where py >nul 2>&1
if !errorlevel! equ 0 (
    set "PYTHON_CMD=py -3"
) else (
    where python >nul 2>&1
    if !errorlevel! equ 0 (
        set "PYTHON_CMD=python"
    )
)

if "%PYTHON_CMD%"=="" (
    echo [ERROR] Python 3 was not detected on your system.
    echo Please install Python 3 from https://www.python.org/downloads/
    echo Make sure to check the box "Add Python to PATH" during installation.
    echo.
    pause
    exit /b 1
)

:: 2. Locate or create virtual environment
set "VENV_DIR=venv"
set "VENV_PY=%VENV_DIR%\Scripts\python.exe"
set "VENV_PIP=%VENV_DIR%\Scripts\pip.exe"

if not exist "%VENV_PY%" (
    :: Check if backend\venv has a Windows environment
    if exist "backend\venv\Scripts\python.exe" (
        set "VENV_DIR=backend\venv"
        set "VENV_PY=backend\venv\Scripts\python.exe"
        set "VENV_PIP=backend\venv\Scripts\pip.exe"
    ) else (
        echo [1/3] Setting up Windows virtual environment in .\%VENV_DIR%...
        %PYTHON_CMD% -m venv %VENV_DIR%
        if !errorlevel! neq 0 (
            echo [ERROR] Failed to create virtual environment.
            pause
            exit /b 1
        )
        echo Virtual environment created successfully.
        echo.
    )
)

:: 3. Verify / install dependencies
echo [2/3] Checking required packages (Flask, Qiskit, NumPy)...
"%VENV_PY%" -c "import flask, qiskit, numpy" >nul 2>&1
if !errorlevel! neq 0 (
    echo Installing dependencies from backend\requirements.txt...
    echo (First run may take a couple of minutes to download packages...)
    echo.
    "%VENV_PIP%" install --upgrade pip
    "%VENV_PIP%" install -r backend\requirements.txt
    if !errorlevel! neq 0 (
        echo.
        echo [ERROR] Failed to install requirements.
        pause
        exit /b 1
    )
    echo Dependencies successfully installed.
    echo.
) else (
    echo Dependencies are ready.
    echo.
)

:: 4. Start the application & open browser
echo [3/3] Starting Quantum Visualizer...
echo URL: http://localhost:5001
echo.

:: Automatically launch default browser after a brief delay
start "" http://localhost:5001

"%VENV_PY%" app.py

if !errorlevel! neq 0 (
    echo.
    echo [NOTICE] Application closed or exited with an error.
    pause
)
