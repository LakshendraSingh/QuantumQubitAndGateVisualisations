# Qubit & Circuit Visualizer

A small teaching tool for single- and multi-qubit quantum computing:

- **Qubit Basics** — apply gates one at a time to a single qubit starting at `|0⟩`, and watch the state vector, probabilities, matrices, and Bloch sphere update live.
- **Gate Library** — every standard gate (I, X, Y, Z, H, S, S†, T, T†, CNOT, CZ, SWAP) with its matrix and a plain-language description.
- **Circuit Builder** — drag gates onto a multi-qubit, multi-step grid and run the circuit on a real Qiskit backend. Shows the resulting state vector, basis-state probabilities, a simulated 1024-shot measurement histogram, a Bloch sphere *per qubit* (which visibly shrinks toward the center when that qubit is entangled — the reduced state is then mixed, not pure), the Qiskit circuit diagram, and the full unitary matrix of the circuit.

The frontend is a static HTML/CSS/JS page (uses [three.js](https://threejs.org/) via CDN for the 3D Bloch spheres). The backend is a small Flask API that does the actual linear algebra with [Qiskit](https://www.ibm.com/quantum/qiskit).

## Running it

**1. Start the backend**

```bash
cd backend
python -m venv venv
source venv/bin/activate        # on Windows: venv\Scripts\activate
pip install -r requirements.txt
python app.py
```

This starts the server on `http://localhost:5001` (using port 5001 avoids port 5000 conflicts with macOS AirPlay Receiver). Leave it running.

**2. Open the app**

Simply open your browser to:

👉 **[http://localhost:5001](http://localhost:5001)**

The Flask backend now serves both the API and the interactive HTML visualizer directly.

*(Alternative)* You can also still open `frontend/index.html` directly (double-click it or `open frontend/index.html`). The frontend will automatically detect and connect to the backend running on port 5001.

The top-right of the page shows a connection indicator — it turns green once it connects to the backend.

## How the pieces fit together

```
backend/
  quantum_engine.py   Gate matrices, single-qubit step-by-step simulation,
                       and full circuit simulation (statevector, per-qubit
                       reduced density matrices / Bloch vectors, unitary,
                       simulated measurement counts) — all via Qiskit.
  app.py               Thin Flask wrapper exposing quantum_engine as JSON:
                          GET  /api/gates
                          POST /api/qubit/apply
                          POST /api/circuit/run
  requirements.txt

frontend/
  index.html            Page structure, three tabs.
  style.css             Dark "quantum lab" theme.
  app.js                Tab switching, API calls, three.js Bloch spheres,
                         drag-and-drop circuit grid.
```

## Notes on the physics

- The Bloch sphere uses the usual convention: `|0⟩` at the north pole (+Z), `|1⟩` at the south pole (−Z). The X and Y axes are drawn in cyan and violet respectively.
- For a circuit with more than one qubit, each qubit's own Bloch vector is computed from its **reduced density matrix** (via partial trace over the other qubits). When a qubit is entangled with the rest of the circuit, this reduced state is *mixed*, so the vector no longer reaches the surface of the sphere — the shrinkage is a direct visual signal of entanglement. The "purity" shown under each mini sphere is `Tr(ρ²)`: 1 for a pure state, 0.5 for a maximally mixed single qubit.
- The full unitary matrix is only computed for circuits of 6 qubits or fewer (a 2ⁿ×2ⁿ matrix grows fast — 64×64 at 6 qubits already).
- The "simulated measurement" panel draws 1024 samples from the exact probability distribution (a stand-in for running on real shot-based hardware/simulator); it's not re-running the circuit through a noisy backend.

## Extending it

- Add more gates by adding entries to `GATE_LIBRARY` / `PARAMETRIC_GATES` and `QISKIT_METHOD` in `quantum_engine.py`, then to `ALL_CHIP_GATES` in `app.js`.
- To support 3-qubit gates (e.g. Toffoli), the circuit grid's drag/click logic currently assumes at most two endpoints per gate — that part of `app.js` would need a small extension.
