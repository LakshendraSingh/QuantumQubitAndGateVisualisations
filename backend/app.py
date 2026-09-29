"""
app.py — Flask backend for the Qubit & Circuit Visualizer.

Run with:
    pip install -r requirements.txt
    python app.py

Then open http://localhost:5001 in your browser!
"""

import os
import sys

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
if BASE_DIR not in sys.path:
    sys.path.insert(0, BASE_DIR)

# Auto-detect venv if running with system python without flask
try:
    from flask import Flask, jsonify, request, send_from_directory
    from flask_cors import CORS
except ImportError:
    for venv_path in [
        os.path.join(BASE_DIR, "..", "venv", "bin", "python"),
        os.path.join(BASE_DIR, "venv", "bin", "python"),
        os.path.join(BASE_DIR, "..", "venv", "Scripts", "python.exe"),
    ]:
        if os.path.isfile(venv_path) and sys.executable != venv_path:
            print(f"[Quantum Visualizer] Activating virtualenv: {venv_path}")
            os.execv(venv_path, [venv_path, os.path.abspath(__file__)] + sys.argv[1:])
    raise

import quantum_engine as qe

FRONTEND_DIR = os.path.abspath(os.path.join(BASE_DIR, "..", "frontend"))

app = Flask(__name__, static_folder=FRONTEND_DIR, static_url_path="")
CORS(app, resources={r"/*": {"origins": "*"}})

@app.before_request
def handle_preflight():
    if request.method == "OPTIONS":
        resp = app.make_default_options_response()
        resp.headers["Access-Control-Allow-Origin"] = "*"
        resp.headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS"
        resp.headers["Access-Control-Allow-Headers"] = "Content-Type, Authorization"
        resp.headers["Access-Control-Allow-Private-Network"] = "true"
        return resp

@app.after_request
def add_cors_headers(response):
    response.headers["Access-Control-Allow-Origin"] = "*"
    response.headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS"
    response.headers["Access-Control-Allow-Headers"] = "Content-Type, Authorization"
    response.headers["Access-Control-Allow-Private-Network"] = "true"
    return response

@app.route("/")
def index():
    return send_from_directory(FRONTEND_DIR, "index.html")


@app.get("/api/health")
def health():
    return jsonify({"status": "ok"})


@app.get("/api/gates")
def get_gates():
    """Full gate catalog: matrices + descriptions for the reference library."""
    return jsonify({"gates": qe.full_gate_catalog()})


@app.post("/api/qubit/apply")
def apply_qubit_gates():
    """
    Single-qubit playground.
    Body: {"gates": [{"gate": "H"}, {"gate": "RX", "theta": 1.57}, ...]}
    """
    body = request.get_json(force=True) or {}
    sequence = body.get("gates", [])
    if not isinstance(sequence, list):
        return jsonify({"error": "'gates' must be a list"}), 400
    try:
        result = qe.simulate_single_qubit(sequence)
    except Exception as exc:
        return jsonify({"error": str(exc)}), 400
    return jsonify(result)


@app.post("/api/circuit/run")
def run_circuit():
    """
    Multi-qubit drag-and-drop circuit.
    Body: {
      "num_qubits": 2,
      "gates": [{"gate": "H", "qubits": [0], "step": 0},
                {"gate": "CX", "qubits": [0, 1], "step": 1}]
    }
    """
    body = request.get_json(force=True) or {}
    num_qubits = body.get("num_qubits", 1)
    gates = body.get("gates", [])
    try:
        result = qe.run_circuit(num_qubits, gates)
    except Exception as exc:
        return jsonify({"error": str(exc)}), 400
    return jsonify(result)


PORT = int(os.environ.get("PORT", 5001))

if __name__ == "__main__":
    print(f"\n=======================================================")
    print(f" Quantum Visualizer backend is live!")
    print(f" Open your browser at: http://localhost:{PORT}")
    print(f" (Port {PORT} avoids the macOS AirPlay Receiver conflict on 5000)")
    print(f"=======================================================\n")
    app.run(debug=True, host="0.0.0.0", port=PORT)
