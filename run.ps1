# Quantum Visualizer - Windows PowerShell Launcher
$ErrorActionPreference = "Stop"

Set-Location -Path $PSScriptRoot

Write-Host "=======================================================" -ForegroundColor Cyan
Write-Host "  Quantum Visualizer - Windows One-Shot Launcher" -ForegroundColor Cyan
Write-Host "=======================================================" -ForegroundColor Cyan
Write-Host ""

# 1. Locate Python
$PythonCmd = $null
$PythonArgs = @()

if (Get-Command py -ErrorAction SilentlyContinue) {
    $PythonCmd = "py"
    $PythonArgs = @("-3")
} elseif (Get-Command python -ErrorAction SilentlyContinue) {
    $PythonCmd = "python"
} else {
    Write-Host "[ERROR] Python 3 was not detected on your system." -ForegroundColor Red
    Write-Host "Please install Python 3 from https://www.python.org/downloads/ and check 'Add Python to PATH'." -ForegroundColor Yellow
    exit 1
}

$VenvDir = Join-Path $PSScriptRoot "venv"
$VenvPy = Join-Path $VenvDir "Scripts\python.exe"
$VenvPip = Join-Path $VenvDir "Scripts\pip.exe"

# Check if backend\venv exists with Windows Scripts
$BackendVenvPy = Join-Path $PSScriptRoot "backend\venv\Scripts\python.exe"
if (-not (Test-Path $VenvPy) -and (Test-Path $BackendVenvPy)) {
    $VenvDir = Join-Path $PSScriptRoot "backend\venv"
    $VenvPy = $BackendVenvPy
    $VenvPip = Join-Path $PSScriptRoot "backend\venv\Scripts\pip.exe"
}

# 2. Create venv if needed
if (-not (Test-Path $VenvPy)) {
    Write-Host "[1/3] Creating Windows virtual environment in .\venv..." -ForegroundColor Yellow
    & $PythonCmd @PythonArgs -m venv $VenvDir
    if ($LASTEXITCODE -ne 0) {
        Write-Host "[ERROR] Failed to create virtual environment." -ForegroundColor Red
        exit 1
    }
}

# 3. Check and install dependencies
Write-Host "[2/3] Checking dependencies (Flask, Qiskit, NumPy)..." -ForegroundColor Yellow
$depsInstalled = $false
try {
    & $VenvPy -c "import flask, qiskit, numpy" 2>$null
    if ($LASTEXITCODE -eq 0) { $depsInstalled = $true }
} catch {
    $depsInstalled = $false
}

if (-not $depsInstalled) {
    Write-Host "Installing dependencies from backend\requirements.txt..." -ForegroundColor Yellow
    & $VenvPip install --upgrade pip
    & $VenvPip install -r (Join-Path $PSScriptRoot "backend\requirements.txt")
} else {
    Write-Host "Dependencies are ready." -ForegroundColor Green
}

# 4. Launch app and open browser
Write-Host "[3/3] Starting Quantum Visualizer at http://localhost:5001..." -ForegroundColor Green
Start-Process "http://localhost:5001"
& $VenvPy (Join-Path $PSScriptRoot "app.py")
