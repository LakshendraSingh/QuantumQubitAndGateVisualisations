"""
Root entry point proxy for quantum_engine.
Redirects imports to backend/quantum_engine.py and ensures backend/ is in sys.path.
"""

import importlib.util
import os
import sys

_BASE_DIR = os.path.dirname(os.path.abspath(__file__))
_BACKEND_DIR = os.path.join(_BASE_DIR, "backend")

if _BACKEND_DIR not in sys.path:
    sys.path.insert(0, _BACKEND_DIR)

_TARGET_FILE = os.path.join(_BACKEND_DIR, "quantum_engine.py")

# Load backend/quantum_engine.py into sys.modules
_spec = importlib.util.spec_from_file_location("quantum_engine", _TARGET_FILE)
_module = importlib.util.module_from_spec(_spec)
sys.modules["quantum_engine"] = _module
_spec.loader.exec_module(_module)

# Expose attributes at the module level
globals().update({k: v for k, v in _module.__dict__.items() if not k.startswith("__")})
