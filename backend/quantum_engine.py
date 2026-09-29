"""
quantum_engine.py

All the actual quantum-mechanics work lives here. Everything above this
module (app.py) just moves JSON in and out. Qiskit does the simulation;
numpy handles the small amounts of linear algebra we need for Bloch
vectors and matrix formatting.
"""

import numpy as np
from qiskit import QuantumCircuit
from qiskit.quantum_info import Statevector, Operator, DensityMatrix, partial_trace

# ---------------------------------------------------------------------------
# Gate library: matrices, metadata, and how each gate maps onto a Qiskit
# QuantumCircuit method. Everything here is the single source of truth that
# both the "Qubit Basics" playground and the "Gate Library" reference page
# read from.
# ---------------------------------------------------------------------------

_SQRT2 = 1 / np.sqrt(2)

PAULI_X = np.array([[0, 1], [1, 0]], dtype=complex)
PAULI_Y = np.array([[0, -1j], [1j, 0]], dtype=complex)
PAULI_Z = np.array([[1, 0], [0, -1]], dtype=complex)

GATE_LIBRARY = {
    "I":    {"name": "Identity",    "symbol": "I",  "qubits": 1,
             "matrix": [[1, 0], [0, 1]],
             "description": "Leaves the qubit exactly as it was."},
    "X":    {"name": "Pauli-X",     "symbol": "X",  "qubits": 1,
             "matrix": [[0, 1], [1, 0]],
             "description": "Bit flip: swaps |0> and |1>. A 180° rotation about the Bloch sphere's X axis."},
    "Y":    {"name": "Pauli-Y",     "symbol": "Y",  "qubits": 1,
             "matrix": [[0, -1j], [1j, 0]],
             "description": "Bit flip plus a phase flip. A 180° rotation about the Y axis."},
    "Z":    {"name": "Pauli-Z",     "symbol": "Z",  "qubits": 1,
             "matrix": [[1, 0], [0, -1]],
             "description": "Phase flip: leaves |0> alone, sends |1> to -|1>. A 180° rotation about the Z axis."},
    "H":    {"name": "Hadamard",    "symbol": "H",  "qubits": 1,
             "matrix": [[_SQRT2, _SQRT2], [_SQRT2, -_SQRT2]],
             "description": "Creates an equal superposition. Maps |0> to |+> and |1> to |->."},
    "S":    {"name": "Phase (S)",   "symbol": "S",  "qubits": 1,
             "matrix": [[1, 0], [0, 1j]],
             "description": "Quarter turn about Z: adds a 90° phase to the |1> amplitude."},
    "Sdg":  {"name": "S-dagger",    "symbol": "S†", "qubits": 1,
             "matrix": [[1, 0], [0, -1j]],
             "description": "Inverse of S, a -90° phase on |1>."},
    "T":    {"name": "T Gate",      "symbol": "T",  "qubits": 1,
             "matrix": [[1, 0], [0, complex(np.cos(np.pi / 4), np.sin(np.pi / 4))]],
             "description": "Eighth turn about Z: a 45° phase on |1>. Key gate for universal circuits."},
    "Tdg":  {"name": "T-dagger",    "symbol": "T†", "qubits": 1,
             "matrix": [[1, 0], [0, complex(np.cos(-np.pi / 4), np.sin(-np.pi / 4))]],
             "description": "Inverse of T, a -45° phase on |1>."},
    "CX":   {"name": "CNOT",        "symbol": "⊕",  "qubits": 2,
             "matrix": [[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 0, 1], [0, 0, 1, 0]],
             "description": "Flips the target qubit only when the control qubit is |1>. Entangles the two qubits."},
    "CZ":   {"name": "Controlled-Z", "symbol": "CZ", "qubits": 2,
             "matrix": [[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0], [0, 0, 0, -1]],
             "description": "Applies a phase flip to the target only when the control is |1>. Symmetric in both qubits."},
    "SWAP": {"name": "SWAP",        "symbol": "×",  "qubits": 2,
             "matrix": [[1, 0, 0, 0], [0, 0, 1, 0], [0, 1, 0, 0], [0, 0, 0, 1]],
             "description": "Exchanges the states of two qubits entirely."},
}

# Gates that take a continuous angle parameter (theta, in radians) are kept
# separate since their matrix depends on user input.
PARAMETRIC_GATES = {
    "RX": {"name": "RX(θ)", "symbol": "RX", "qubits": 1,
           "description": "Rotation by θ about the X axis of the Bloch sphere."},
    "RY": {"name": "RY(θ)", "symbol": "RY", "qubits": 1,
           "description": "Rotation by θ about the Y axis of the Bloch sphere."},
    "RZ": {"name": "RZ(θ)", "symbol": "RZ", "qubits": 1,
           "description": "Rotation by θ about the Z axis of the Bloch sphere."},
}

QISKIT_METHOD = {
    "I": "id", "X": "x", "Y": "y", "Z": "z", "H": "h",
    "S": "s", "Sdg": "sdg", "T": "t", "Tdg": "tdg",
    "CX": "cx", "CZ": "cz", "SWAP": "swap",
    "RX": "rx", "RY": "ry", "RZ": "rz",
}


def _complex_to_json(z):
    z = complex(z)
    return {"re": round(z.real, 6), "im": round(z.imag, 6)}


def matrix_to_json(mat):
    """2D array/list of complex -> JSON-friendly nested {re, im} lists."""
    arr = np.array(mat, dtype=complex)
    return [[_complex_to_json(v) for v in row] for row in arr]


def statevector_to_json(sv: Statevector):
    return [_complex_to_json(a) for a in sv.data]


def bloch_vector_from_density(rho: np.ndarray):
    """Given a 2x2 density matrix, return the [x, y, z] Bloch coordinates."""
    x = np.real(np.trace(rho @ PAULI_X))
    y = np.real(np.trace(rho @ PAULI_Y))
    z = np.real(np.trace(rho @ PAULI_Z))
    return [round(float(x), 6), round(float(y), 6), round(float(z), 6)]


def rx_matrix(theta):
    c, s = np.cos(theta / 2), np.sin(theta / 2)
    return np.array([[c, -1j * s], [-1j * s, c]], dtype=complex)


def ry_matrix(theta):
    c, s = np.cos(theta / 2), np.sin(theta / 2)
    return np.array([[c, -s], [s, c]], dtype=complex)


def rz_matrix(theta):
    return np.array([[np.exp(-1j * theta / 2), 0], [0, np.exp(1j * theta / 2)]], dtype=complex)


def gate_matrix(gate_id, theta=None):
    if gate_id in GATE_LIBRARY:
        return np.array(GATE_LIBRARY[gate_id]["matrix"], dtype=complex)
    if gate_id == "RX":
        return rx_matrix(theta or 0.0)
    if gate_id == "RY":
        return ry_matrix(theta or 0.0)
    if gate_id == "RZ":
        return rz_matrix(theta or 0.0)
    raise ValueError(f"Unknown gate '{gate_id}'")


def full_gate_catalog():
    """Combine fixed and parametric gates into one JSON payload for the UI."""
    catalog = {}
    for gid, info in GATE_LIBRARY.items():
        catalog[gid] = {**info, "matrix": matrix_to_json(info["matrix"]), "parametric": False}
    for gid, info in PARAMETRIC_GATES.items():
        catalog[gid] = {**info, "matrix": None, "parametric": True}
    return catalog


# ---------------------------------------------------------------------------
# Single-qubit playground: apply a sequence of gates to |0>, one at a time,
# and report the state after every step so the frontend can animate it.
# ---------------------------------------------------------------------------

def simulate_single_qubit(gate_sequence):
    """
    gate_sequence: list of {"gate": "H", "theta": optional float}
    Returns per-step statevectors, Bloch vectors, and the combined matrix.
    """
    state = np.array([1, 0], dtype=complex)  # |0>
    combined = np.eye(2, dtype=complex)
    steps = []

    for item in gate_sequence:
        gid = item.get("gate")
        theta = item.get("theta")
        mat = gate_matrix(gid, theta)
        state = mat @ state
        combined = mat @ combined
        rho = np.outer(state, state.conj())
        steps.append({
            "gate": gid,
            "theta": theta,
            "matrix": matrix_to_json(mat),
            "statevector": [_complex_to_json(a) for a in state],
            "probabilities": [round(float(abs(a) ** 2), 6) for a in state],
            "bloch": bloch_vector_from_density(rho),
        })

    final_rho = np.outer(state, state.conj())
    return {
        "statevector": [_complex_to_json(a) for a in state],
        "probabilities": [round(float(abs(a) ** 2), 6) for a in state],
        "bloch": bloch_vector_from_density(final_rho),
        "matrix": matrix_to_json(combined),
        "steps": steps,
    }


# ---------------------------------------------------------------------------
# Multi-qubit circuit builder: build an actual Qiskit circuit from the
# drag-and-drop grid, then read off everything the UI wants to show.
# ---------------------------------------------------------------------------

MAX_UNITARY_QUBITS = 6  # beyond this, computing/serialising the full 2^n x 2^n matrix is too slow


def run_circuit(num_qubits, placed_gates):
    """
    placed_gates: list of {"gate": "H"/"CX"/..., "qubits": [q0, (q1)], "step": int, "theta": optional}
    Ordered by 'step' (time column in the grid), ties broken by qubit index.
    """
    if num_qubits < 1 or num_qubits > 8:
        raise ValueError("num_qubits must be between 1 and 8")

    qc = QuantumCircuit(num_qubits)
    ordered = sorted(placed_gates, key=lambda g: (g.get("step", 0), min(g.get("qubits", [0]))))

    for g in ordered:
        gid = g["gate"]
        qubits = g["qubits"]
        theta = g.get("theta")
        method_name = QISKIT_METHOD.get(gid)
        if method_name is None:
            raise ValueError(f"Unknown gate '{gid}'")
        method = getattr(qc, method_name)
        if gid in ("RX", "RY", "RZ"):
            method(theta or 0.0, qubits[0])
        elif gid in ("CX", "CZ", "SWAP"):
            method(qubits[0], qubits[1])
        else:
            method(qubits[0])

    sv = Statevector.from_instruction(qc)
    probs = sv.probabilities_dict()
    # probabilities_dict keys are little-endian bit strings from qiskit; keep as-is
    # but round for display.
    probabilities = {k: round(float(v), 6) for k, v in probs.items()}

    # Per-qubit reduced density matrix -> Bloch vector + purity
    qubit_info = []
    for q in range(num_qubits):
        others = [i for i in range(num_qubits) if i != q]
        rho = partial_trace(sv, others).data if others else DensityMatrix(sv).data
        purity = float(np.real(np.trace(rho @ rho)))
        qubit_info.append({
            "index": q,
            "bloch": bloch_vector_from_density(rho),
            "purity": round(purity, 6),
        })

    unitary = None
    if num_qubits <= MAX_UNITARY_QUBITS and len(ordered) > 0:
        try:
            unitary = matrix_to_json(Operator(qc).data)
        except Exception:
            unitary = None

    # A small simulated measurement, shots, for an intuitive counts histogram
    counts = None
    try:
        shots = 1024
        rng = np.random.default_rng(42)
        basis_states = list(probs.keys())
        weights = list(probs.values())
        if basis_states:
            draws = rng.choice(basis_states, size=shots, p=np.array(weights) / sum(weights))
            counts = {}
            for d in draws:
                counts[d] = counts.get(d, 0) + 1
    except Exception:
        counts = None

    # Circuit complexity metrics: Depth, Size, Width, 2-Qubit Non-local gates, and Op breakdown
    try:
        circuit_depth = int(qc.depth())
        circuit_size = int(qc.size())
        num_nonlocal = int(qc.num_nonlocal_gates())
        ops_dict = {str(k).upper(): int(v) for k, v in qc.count_ops().items()}
    except Exception:
        circuit_depth = 0
        circuit_size = len(ordered)
        num_nonlocal = sum(1 for g in ordered if len(g.get("qubits", [])) > 1)
        ops_dict = {}

    return {
        "num_qubits": num_qubits,
        "depth": circuit_depth,
        "size": circuit_size,
        "num_nonlocal": num_nonlocal,
        "ops_count": ops_dict,
        "statevector": statevector_to_json(sv),
        "basis_labels": [format(i, f"0{num_qubits}b") for i in range(2 ** num_qubits)],
        "probabilities": probabilities,
        "counts": counts,
        "qubits": qubit_info,
        "unitary": unitary,
        "circuit_text": qc.draw(output="text").single_string(),
    }
