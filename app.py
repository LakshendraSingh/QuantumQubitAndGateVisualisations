#!/usr/bin/env python3
"""
Quantum Visualizer — Root Launcher.
Allows running `python app.py` directly from the project root.
Automatically detects and uses the local virtualenv if available.
"""

import os
import sys

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
BACKEND_DIR = os.path.join(BASE_DIR, "backend")

# Try importing flask; if missing, re-exec with venv python if available
try:
    import flask
except ImportError:
    for venv_path in [
        os.path.join(BASE_DIR, "venv", "bin", "python"),
        os.path.join(BACKEND_DIR, "venv", "bin", "python"),
        os.path.join(BASE_DIR, "venv", "Scripts", "python.exe"),
    ]:
        if os.path.isfile(venv_path) and sys.executable != venv_path:
            print(f"[Quantum Visualizer] Activating virtualenv: {venv_path}")
            os.execv(venv_path, [venv_path, os.path.abspath(__file__)] + sys.argv[1:])
    print("Error: Flask is not installed in the current environment.")
    print("Please activate your virtual environment: source venv/bin/activate")
    sys.exit(1)

import backend.app as backend_app
app = backend_app.app
PORT = backend_app.PORT

if __name__ == "__main__":
    print(f"\n✨ Quantum Visualizer running at: http://localhost:{PORT}")
    print(f"👉 Open http://localhost:{PORT} in your browser.\n")
    app.run(host="0.0.0.0", port=PORT, debug=True)
