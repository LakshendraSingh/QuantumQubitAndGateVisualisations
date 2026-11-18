#!/usr/bin/env python3
"""
Quantum Visualizer — Root Launcher.
Allows running `python app.py` directly from the project root.
Automatically detects, creates (if missing), and uses the local virtualenv cross-platform (Windows, macOS, Linux).
"""

import os
import subprocess
import sys
import threading
import webbrowser

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
BACKEND_DIR = os.path.join(BASE_DIR, "backend")

if BACKEND_DIR not in sys.path:
    sys.path.insert(0, BACKEND_DIR)

def re_exec(python_bin):
    """Re-executes the current script using the specified python binary."""
    print(f"[Quantum Visualizer] Activating virtualenv: {python_bin}")
    if sys.platform == "win32":
        sys.exit(subprocess.call([python_bin, os.path.abspath(__file__)] + sys.argv[1:]))
    else:
        os.execv(python_bin, [python_bin, os.path.abspath(__file__)] + sys.argv[1:])

# Try importing required dependencies; if missing, locate or create virtualenv
try:
    import flask
    import numpy
    import qiskit
except ImportError:
    candidate_venvs = [
        os.path.join(BASE_DIR, "venv", "Scripts", "python.exe"),
        os.path.join(BACKEND_DIR, "venv", "Scripts", "python.exe"),
        os.path.join(BASE_DIR, "venv", "bin", "python"),
        os.path.join(BACKEND_DIR, "venv", "bin", "python"),
    ]
    for venv_path in candidate_venvs:
        if os.path.isfile(venv_path) and os.path.abspath(sys.executable) != os.path.abspath(venv_path):
            re_exec(venv_path)

    # If no virtualenv found, auto-bootstrap one in ./venv
    print("\n[Quantum Visualizer] First-time setup detected. Bootstrapping virtual environment...")
    target_venv = os.path.join(BASE_DIR, "venv")
    is_win = sys.platform == "win32"
    target_py = os.path.join(target_venv, "Scripts", "python.exe") if is_win else os.path.join(target_venv, "bin", "python")
    target_pip = os.path.join(target_venv, "Scripts", "pip.exe") if is_win else os.path.join(target_venv, "bin", "pip")

    if not os.path.isfile(target_py):
        print(f"Creating virtual environment in: {target_venv}")
        subprocess.check_call([sys.executable, "-m", "venv", target_venv])

    print("Installing dependencies from backend/requirements.txt...")
    req_file = os.path.join(BACKEND_DIR, "requirements.txt")
    subprocess.check_call([target_pip, "install", "-r", req_file])
    re_exec(target_py)

import backend.app as backend_app
app = backend_app.app
PORT = backend_app.PORT

def _open_browser():
    webbrowser.open(f"http://localhost:{PORT}")

if __name__ == "__main__":
    print(f"\n=======================================================")
    print(f" ✨ Quantum Visualizer is running at: http://localhost:{PORT}")
    print(f" 👉 Browser will open automatically at http://localhost:{PORT}")
    print(f"=======================================================\n")
    if os.environ.get("WERKZEUG_RUN_MAIN") == "true" or not app.debug:
        threading.Timer(1.2, _open_browser).start()
    app.run(host="0.0.0.0", port=PORT, debug=True)
