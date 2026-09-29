// ============================================================================
// app.js — Quantum Visualizer (Single-qubit playground & Multi-qubit circuit)
// High-contrast Bloch sphere, click-to-place & drag-and-drop circuit builder,
// circuit presets, and resilient backend connection.
// ============================================================================

// ---------------------------------------------------------------------------
// Backend API resolution
// ---------------------------------------------------------------------------

function getInitialApiCandidates() {
  const candidates = [];
  if (window.location.protocol.startsWith("http")) {
    candidates.push(window.location.origin + "/api");
  }
  candidates.push("http://localhost:5001/api");
  candidates.push("http://127.0.0.1:5001/api");
  candidates.push("http://localhost:5000/api");
  candidates.push("http://127.0.0.1:5000/api");
  return [...new Set(candidates)];
}

const CANDIDATE_API_BASES = getInitialApiCandidates();
let API_BASE = CANDIDATE_API_BASES[0];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fmtNum(n) {
  const r = Math.round(n * 1000) / 1000;
  if (Object.is(r, -0)) return "0";
  return r.toString();
}

function fmtComplex(z) {
  const re = z.re, im = z.im;
  const reZero = Math.abs(re) < 1e-4;
  const imZero = Math.abs(im) < 1e-4;
  if (reZero && imZero) return "0";
  if (imZero) return fmtNum(re);
  if (reZero) return (Math.abs(im - 1) < 1e-4 ? "" : Math.abs(im + 1) < 1e-4 ? "-" : fmtNum(im)) + "i";
  const sign = im < 0 ? "-" : "+";
  const imAbs = Math.abs(im);
  const imStr = Math.abs(imAbs - 1) < 1e-4 ? "i" : fmtNum(imAbs) + "i";
  return `${fmtNum(re)} ${sign} ${imStr}`;
}

// ---------------------------------------------------------------------------
// Resilient API Client & Client-Side Quantum Simulation Fallback
// ---------------------------------------------------------------------------

function c(re, im = 0) { return { re, im }; }
function cAdd(a, b) { return { re: a.re + b.re, im: a.im + b.im }; }
function cSub(a, b) { return { re: a.re - b.re, im: a.im - b.im }; }
function cMul(a, b) { return { re: a.re * b.re - a.im * b.im, im: a.re * b.im + a.im * b.re }; }
function cAbs2(a) { return a.re * a.re + a.im * a.im; }

function matMul2x2(A, B) {
  return [
    [cAdd(cMul(A[0][0], B[0][0]), cMul(A[0][1], B[1][0])), cAdd(cMul(A[0][0], B[0][1]), cMul(A[0][1], B[1][1]))],
    [cAdd(cMul(A[1][0], B[0][0]), cMul(A[1][1], B[1][0])), cAdd(cMul(A[1][0], B[0][1]), cMul(A[1][1], B[1][1]))]
  ];
}

async function apiPost(path, body) {
  const bases = [API_BASE, ...CANDIDATE_API_BASES.filter((b) => b !== API_BASE)];
  let lastErr = null;
  for (const base of bases) {
    try {
      const res = await fetch(`${base}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        API_BASE = base;
        return await res.json();
      }
      const err = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(err.error || "Request failed");
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error("Backend unreachable");
}

async function apiGet(path) {
  const bases = [API_BASE, ...CANDIDATE_API_BASES.filter((b) => b !== API_BASE)];
  let lastErr = null;
  for (const base of bases) {
    try {
      const res = await fetch(`${base}${path}`);
      if (res.ok) {
        API_BASE = base;
        return await res.json();
      }
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error("Backend unreachable");
}

function renderMatrixTable(matrix) {
  const table = document.createElement("table");
  table.className = "matrix-table";
  matrix.forEach((row) => {
    const tr = document.createElement("tr");
    row.forEach((cell) => {
      const td = document.createElement("td");
      td.textContent = fmtComplex(cell);
      tr.appendChild(td);
    });
    table.appendChild(tr);
  });
  return table;
}

// ---------------------------------------------------------------------------
// Connection check
// ---------------------------------------------------------------------------

async function checkConnection(verbose = false) {
  const dot = document.getElementById("connDot");
  const text = document.getElementById("connText");
  if (verbose && text) text.textContent = "probing backend…";

  const basesToTry = [API_BASE, ...CANDIDATE_API_BASES.filter((b) => b !== API_BASE)];
  for (const base of basesToTry) {
    try {
      const res = await fetch(`${base}/health`, { method: "GET", mode: "cors" });
      if (res.ok) {
        API_BASE = base;
        dot.className = "dot ok";
        text.textContent = "backend connected (port " + (base.includes("5001") ? "5001" : "5000") + ")";
        return true;
      }
    } catch (e) {
      // try next candidate
    }
  }
  dot.className = "dot warn";
  text.textContent = "local simulation active (run 'python app.py' for Qiskit)";
  return false;
}

const statusBadge = document.getElementById("connStatus");
if (statusBadge) {
  statusBadge.style.cursor = "pointer";
  statusBadge.title = "Click to re-check backend connection";
  statusBadge.addEventListener("click", () => checkConnection(true));
}

// ---------------------------------------------------------------------------
// Tabs
// ---------------------------------------------------------------------------

document.getElementById("tabs").addEventListener("click", (e) => {
  const btn = e.target.closest(".tab-btn");
  if (!btn) return;
  document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
  document.querySelectorAll(".tab-panel").forEach((p) => p.classList.remove("active"));
  btn.classList.add("active");
  const panel = document.getElementById(`tab-${btn.dataset.tab}`);
  if (panel) panel.classList.add("active");

  // Dispatch window resize event so Three.js renders in newly active tabs
  setTimeout(() => window.dispatchEvent(new Event("resize")), 30);
});

// ---------------------------------------------------------------------------
// Gate Catalog (Static default with dynamic backend hydration)
// ---------------------------------------------------------------------------

const _SQRT2 = 1 / Math.SQRT2;

const DEFAULT_GATE_CATALOG = {
  I: {
    name: "Identity", symbol: "I", qubits: 1,
    matrix: [[{ re: 1, im: 0 }, { re: 0, im: 0 }], [{ re: 0, im: 0 }, { re: 1, im: 0 }]],
    description: "Leaves the qubit exactly as it was."
  },
  X: {
    name: "Pauli-X", symbol: "X", qubits: 1,
    matrix: [[{ re: 0, im: 0 }, { re: 1, im: 0 }], [{ re: 1, im: 0 }, { re: 0, im: 0 }]],
    description: "Bit flip: swaps |0⟩ and |1⟩. 180° rotation about the X axis."
  },
  Y: {
    name: "Pauli-Y", symbol: "Y", qubits: 1,
    matrix: [[{ re: 0, im: 0 }, { re: 0, im: -1 }], [{ re: 0, im: 1 }, { re: 0, im: 0 }]],
    description: "Bit flip plus phase flip. 180° rotation about the Y axis."
  },
  Z: {
    name: "Pauli-Z", symbol: "Z", qubits: 1,
    matrix: [[{ re: 1, im: 0 }, { re: 0, im: 0 }], [{ re: 0, im: 0 }, { re: -1, im: 0 }]],
    description: "Phase flip: leaves |0⟩ alone, sends |1⟩ to -|1⟩. 180° rotation about the Z axis."
  },
  H: {
    name: "Hadamard", symbol: "H", qubits: 1,
    matrix: [[{ re: _SQRT2, im: 0 }, { re: _SQRT2, im: 0 }], [{ re: _SQRT2, im: 0 }, { re: -_SQRT2, im: 0 }]],
    description: "Creates equal superposition: maps |0⟩ to |+⟩ and |1⟩ to |-⟩."
  },
  S: {
    name: "Phase (S)", symbol: "S", qubits: 1,
    matrix: [[{ re: 1, im: 0 }, { re: 0, im: 0 }], [{ re: 0, im: 0 }, { re: 0, im: 1 }]],
    description: "Quarter turn about Z: adds +90° phase to |1⟩."
  },
  Sdg: {
    name: "S-dagger", symbol: "S†", qubits: 1,
    matrix: [[{ re: 1, im: 0 }, { re: 0, im: 0 }], [{ re: 0, im: 0 }, { re: 0, im: -1 }]],
    description: "Inverse of S: adds -90° phase to |1⟩."
  },
  T: {
    name: "T Gate", symbol: "T", qubits: 1,
    matrix: [[{ re: 1, im: 0 }, { re: 0, im: 0 }], [{ re: 0, im: 0 }, { re: Math.cos(Math.PI / 4), im: Math.sin(Math.PI / 4) }]],
    description: "Eighth turn about Z: adds +45° phase to |1⟩."
  },
  Tdg: {
    name: "T-dagger", symbol: "T†", qubits: 1,
    matrix: [[{ re: 1, im: 0 }, { re: 0, im: 0 }], [{ re: 0, im: 0 }, { re: Math.cos(-Math.PI / 4), im: Math.sin(-Math.PI / 4) }]],
    description: "Inverse of T: adds -45° phase to |1⟩."
  },
  RX: {
    name: "RX(θ)", symbol: "RX", qubits: 1,
    description: "Rotation by θ about the X axis of the Bloch sphere."
  },
  RY: {
    name: "RY(θ)", symbol: "RY", qubits: 1,
    description: "Rotation by θ about the Y axis of the Bloch sphere."
  },
  RZ: {
    name: "RZ(θ)", symbol: "RZ", qubits: 1,
    description: "Rotation by θ about the Z axis of the Bloch sphere."
  },
  CX: {
    name: "CNOT", symbol: "⊕", qubits: 2,
    matrix: [
      [{ re: 1, im: 0 }, { re: 0, im: 0 }, { re: 0, im: 0 }, { re: 0, im: 0 }],
      [{ re: 0, im: 0 }, { re: 1, im: 0 }, { re: 0, im: 0 }, { re: 0, im: 0 }],
      [{ re: 0, im: 0 }, { re: 0, im: 0 }, { re: 0, im: 0 }, { re: 1, im: 0 }],
      [{ re: 0, im: 0 }, { re: 0, im: 0 }, { re: 1, im: 0 }, { re: 0, im: 0 }]
    ],
    description: "Flips target qubit only when control qubit is |1⟩. Entangles the two qubits."
  },
  CZ: {
    name: "Controlled-Z", symbol: "CZ", qubits: 2,
    matrix: [
      [{ re: 1, im: 0 }, { re: 0, im: 0 }, { re: 0, im: 0 }, { re: 0, im: 0 }],
      [{ re: 0, im: 0 }, { re: 1, im: 0 }, { re: 0, im: 0 }, { re: 0, im: 0 }],
      [{ re: 0, im: 0 }, { re: 0, im: 0 }, { re: 1, im: 0 }, { re: 0, im: 0 }],
      [{ re: 0, im: 0 }, { re: 0, im: 0 }, { re: 0, im: 0 }, { re: -1, im: 0 }]
    ],
    description: "Applies a phase flip to target when control is |1⟩. Symmetric in both qubits."
  },
  SWAP: {
    name: "SWAP", symbol: "×", qubits: 2,
    matrix: [
      [{ re: 1, im: 0 }, { re: 0, im: 0 }, { re: 0, im: 0 }, { re: 0, im: 0 }],
      [{ re: 0, im: 0 }, { re: 0, im: 0 }, { re: 1, im: 0 }, { re: 0, im: 0 }],
      [{ re: 0, im: 0 }, { re: 1, im: 0 }, { re: 0, im: 0 }, { re: 0, im: 0 }],
      [{ re: 0, im: 0 }, { re: 0, im: 0 }, { re: 0, im: 0 }, { re: 1, im: 0 }]
    ],
    description: "Exchanges the states of two qubits entirely."
  }
};

let GATE_CATALOG = { ...DEFAULT_GATE_CATALOG };

async function loadGateCatalog() {
  try {
    const data = await apiGet("/gates");
    if (data && data.gates) {
      GATE_CATALOG = { ...DEFAULT_GATE_CATALOG, ...data.gates };
      renderGateLibrary();
      renderBasicGateButtons();
      renderPaletteChips();
    }
  } catch (e) {
    console.warn("Using built-in gate catalog:", e.message);
  }
}

function renderGateLibrary() {
  const wrap = document.getElementById("gateCards");
  if (!wrap) return;
  wrap.innerHTML = "";
  Object.entries(GATE_CATALOG).forEach(([id, g]) => {
    const card = document.createElement("div");
    card.className = "gate-card";
    const head = document.createElement("div");
    head.className = "head";
    head.innerHTML = `<span class="symbol">${g.symbol || id}</span><span class="name">${g.name || id}</span><span class="qcount">${g.qubits || 1}-qubit</span>`;
    card.appendChild(head);
    const desc = document.createElement("div");
    desc.className = "desc";
    desc.textContent = g.description || "";
    card.appendChild(desc);
    if (g.matrix) {
      const box = document.createElement("div");
      box.className = "matrix-box";
      box.appendChild(renderMatrixTable(g.matrix));
      card.appendChild(box);
    } else {
      const box = document.createElement("div");
      box.className = "matrix-box";
      box.innerHTML = `<span class="hint">Matrix depends on angle θ — see it live in Qubit Basics.</span>`;
      card.appendChild(box);
    }
    wrap.appendChild(card);
  });
}

// ---------------------------------------------------------------------------
// Bloch sphere (State-of-the-art Three.js WebGL & 2D fallback)
// ---------------------------------------------------------------------------

function makeLabelBadge(text, subtext = "", colorHex = "#f5eedc", bgColor = "rgba(22, 18, 14, 0.94)") {
  if (typeof THREE === "undefined") return null;
  const canvas = document.createElement("canvas");
  canvas.width = 384;
  canvas.height = 160;
  const ctx = canvas.getContext("2d");

  const hasSub = Boolean(subtext);
  const w = hasSub ? 280 : 210;
  const h = hasSub ? 108 : 84;
  const x = (384 - w) / 2;
  const y = (160 - h) / 2;
  const r = h / 2;

  // Glassmorphic rounded pill container
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.arc(x + w - r, y + r, r, -Math.PI / 2, Math.PI / 2);
  ctx.lineTo(x + r, y + h);
  ctx.arc(x + r, y + r, r, Math.PI / 2, -Math.PI / 2);
  ctx.closePath();

  // Subtle obsidian gradient
  const grad = ctx.createLinearGradient(x, y, x, y + h);
  grad.addColorStop(0, bgColor);
  grad.addColorStop(1, "rgba(14, 11, 8, 0.97)");
  ctx.fillStyle = grad;
  ctx.fill();

  // Glowing border
  ctx.strokeStyle = colorHex;
  ctx.lineWidth = 4;
  ctx.shadowColor = colorHex;
  ctx.shadowBlur = 18;
  ctx.stroke();
  ctx.shadowBlur = 0;

  // Main state text
  ctx.fillStyle = colorHex;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = "bold 46px 'IBM Plex Mono', 'Space Mono', monospace";

  if (hasSub) {
    ctx.fillText(text, 192, y + 42);
    // Subtext annotation (e.g. Ground, Excited, Superposition)
    ctx.font = "600 22px 'Plus Jakarta Sans', system-ui, sans-serif";
    ctx.fillStyle = "rgba(245, 238, 220, 0.75)";
    ctx.letterSpacing = "1.5px";
    ctx.fillText(subtext.toUpperCase(), 192, y + 78);
  } else {
    ctx.fillText(text, 192, 80);
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.minFilter = THREE.LinearFilter;
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(hasSub ? 0.52 : 0.44, hasSub ? 0.22 : 0.18, 1);
  return sprite;
}

function createBlochSphere(container, isMini = false) {
  if (!container) return { setVector: () => {} };
  const existingCanvas = container.querySelector("canvas");
  if (existingCanvas) existingCanvas.remove();

  // Check if THREE is loaded; if not, use 2D canvas fallback
  if (typeof THREE === "undefined") {
    return create2DBlochFallback(container);
  }

  const getW = () => Math.max(container.clientWidth || container.parentElement?.clientWidth || 280, 160);
  const getH = () => Math.max(container.clientHeight || getW(), 160);

  let width = getW();
  let height = getH();

  const scene = new THREE.Scene();
  const defaultDist = isMini ? 3.8 : 4.15;
  const camera = new THREE.PerspectiveCamera(isMini ? 46 : 44, width / height, 0.1, 100);
  camera.position.set(0, 0, defaultDist);

  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "high-performance" });
  } catch (err) {
    console.warn("WebGL unavailable, using 2D fallback", err);
    return create2DBlochFallback(container);
  }

  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(width, height);
  renderer.domElement.style.width = "100%";
  renderer.domElement.style.height = "100%";
  renderer.domElement.style.display = "block";
  container.appendChild(renderer.domElement);

  // Lighting — Warm Solar Orange & Desert Champagne Radiance
  const ambient = new THREE.AmbientLight(0xfef3c7, 0.92);
  scene.add(ambient);
  const keyLight = new THREE.DirectionalLight(0xfb923c, 1.55);
  keyLight.position.set(3.5, 4.5, 3.5);
  scene.add(keyLight);
  const rimLight = new THREE.DirectionalLight(0xf5eedc, 1.1);
  rimLight.position.set(-3.5, -2.5, -3);
  scene.add(rimLight);
  const fillLight = new THREE.DirectionalLight(0xd4a373, 0.6);
  fillLight.position.set(0, -4, 2);
  scene.add(fillLight);

  // Quantum particle dust field (ambient space depth in warm amber/gold)
  let pMesh = null;
  if (!isMini) {
    const pCount = 80;
    const pGeo = new THREE.BufferGeometry();
    const pPos = new Float32Array(pCount * 3);
    for (let i = 0; i < pCount; i++) {
      const rad = 1.35 + Math.random() * 0.95;
      const th = Math.random() * Math.PI * 2;
      const ph = Math.acos(2 * Math.random() - 1);
      pPos[i * 3] = rad * Math.sin(ph) * Math.cos(th);
      pPos[i * 3 + 1] = rad * Math.sin(ph) * Math.sin(th);
      pPos[i * 3 + 2] = rad * Math.cos(ph);
    }
    pGeo.setAttribute("position", new THREE.BufferAttribute(pPos, 3));
    const pMat = new THREE.PointsMaterial({ color: 0xfb923c, size: 0.026, transparent: true, opacity: 0.5 });
    pMesh = new THREE.Points(pGeo, pMat);
    scene.add(pMesh);
  }

  const rig = new THREE.Group();
  scene.add(rig);

  // Outer translucent glass sphere — Warm Espresso Obsidian
  const sphereGeo = new THREE.SphereGeometry(1, isMini ? 32 : 56, isMini ? 24 : 40);
  const glassMat = new THREE.MeshPhongMaterial({
    color: 0x14100c,
    emissive: 0x000000,
    specular: 0x4a3726,
    shininess: 50,
    transparent: true,
    opacity: isMini ? 0.22 : 0.12,
    depthWrite: false,
  });
  rig.add(new THREE.Mesh(sphereGeo, glassMat));

  // Geodesic outer crystalline cage (gives refined scientific optical depth)
  if (!isMini) {
    const cageGeo = new THREE.WireframeGeometry(new THREE.IcosahedronGeometry(1.002, 2));
    const cageMat = new THREE.LineBasicMaterial({
      color: 0xd4a373,
      transparent: true,
      opacity: 0.075,
    });
    const cage = new THREE.LineSegments(cageGeo, cageMat);
    rig.add(cage);
  }

  // Equator Primary Torus (XY Plane) — Glowing Radiant Neon Solar Orange
  const equatorTorus = new THREE.Mesh(
    new THREE.TorusGeometry(1, isMini ? 0.009 : 0.0078, 14, 100),
    new THREE.MeshBasicMaterial({ color: 0xf97316, transparent: true, opacity: 0.95 })
  );
  equatorTorus.rotation.x = Math.PI / 2;
  rig.add(equatorTorus);

  // Equatorial Precision Compass Dial (Tick marks every 15° and 45° with outer thin ring)
  if (!isMini) {
    // Subtle outer halo ring
    const haloTorus = new THREE.Mesh(
      new THREE.TorusGeometry(1.045, 0.0032, 8, 80),
      new THREE.MeshBasicMaterial({ color: 0xf5eedc, transparent: true, opacity: 0.28 })
    );
    haloTorus.rotation.x = Math.PI / 2;
    rig.add(haloTorus);

    // Radial tick segments along equator
    const tickPts = [];
    const numTicks = 24;
    for (let i = 0; i < numTicks; i++) {
      const angle = (i / numTicks) * Math.PI * 2;
      const isMajor = i % 6 === 0; // 0, 90, 180, 270 deg
      const isSemi = i % 3 === 0;  // 45, 135, etc.
      const innerR = 1.0;
      const outerR = isMajor ? 1.075 : (isSemi ? 1.05 : 1.03);

      const cosA = Math.cos(angle);
      const sinA = Math.sin(angle);

      // In Three.js rig: X = cosA, Z = sinA, Y = 0 (equator plane)
      tickPts.push(new THREE.Vector3(innerR * cosA, 0, innerR * sinA));
      tickPts.push(new THREE.Vector3(outerR * cosA, 0, outerR * sinA));
    }
    const ticksGeo = new THREE.BufferGeometry().setFromPoints(tickPts);
    const ticksMat = new THREE.LineBasicMaterial({ color: 0xfb923c, transparent: true, opacity: 0.65 });
    rig.add(new THREE.LineSegments(ticksGeo, ticksMat));
  }

  // Latitude circles at 45° and 135° (Warm Champagne Wireframe rings)
  if (!isMini) {
    const latR = Math.cos(Math.PI / 4);
    const latY = Math.sin(Math.PI / 4);
    const latMat = new THREE.MeshBasicMaterial({ color: 0xe6d7be, transparent: true, opacity: 0.28 });
    const latNorth = new THREE.Mesh(new THREE.TorusGeometry(latR, 0.0035, 8, 64), latMat);
    latNorth.position.y = latY;
    latNorth.rotation.x = Math.PI / 2;
    rig.add(latNorth);
    const latSouth = new THREE.Mesh(new THREE.TorusGeometry(latR, 0.0035, 8, 64), latMat);
    latSouth.position.y = -latY;
    latSouth.rotation.x = Math.PI / 2;
    rig.add(latSouth);
  }

  // Meridian XZ Torus — Warm Amber-Orange
  const meridianXZ = new THREE.Mesh(
    new THREE.TorusGeometry(1, isMini ? 0.007 : 0.006, 12, 100),
    new THREE.MeshBasicMaterial({ color: 0xfb923c, transparent: true, opacity: 0.72 })
  );
  rig.add(meridianXZ);

  // Meridian YZ Torus — Champagne Beige
  const meridianYZ = new THREE.Mesh(
    new THREE.TorusGeometry(1, isMini ? 0.006 : 0.005, 12, 100),
    new THREE.MeshBasicMaterial({ color: 0xd4c2a5, transparent: true, opacity: 0.52 })
  );
  meridianYZ.rotation.y = Math.PI / 2;
  rig.add(meridianYZ);

  // Central Origin Precision Gimbal Hub (Anchoring center at (0,0,0))
  const hubMat = new THREE.MeshPhongMaterial({
    color: 0x221a14,
    emissive: 0x140e0a,
    specular: 0xf5eedc,
    shininess: 90,
  });
  const hubBead = new THREE.Mesh(new THREE.SphereGeometry(0.045, 20, 20), hubMat);
  rig.add(hubBead);

  const hubRing = new THREE.Mesh(
    new THREE.TorusGeometry(0.07, 0.006, 12, 32),
    new THREE.MeshBasicMaterial({ color: 0xd4a373, transparent: true, opacity: 0.85 })
  );
  hubRing.rotation.x = Math.PI / 2;
  rig.add(hubRing);

  // Coordinate axes with glowing directional arrow cones
  function createAxis(from, to, colorHex, coneDir) {
    const pts = [from, to];
    const lineGeo = new THREE.BufferGeometry().setFromPoints(pts);
    const lineMat = new THREE.LineBasicMaterial({ color: colorHex, transparent: true, opacity: 0.85, linewidth: 2 });
    rig.add(new THREE.Line(lineGeo, lineMat));

    if (coneDir && !isMini) {
      const coneGeo = new THREE.ConeGeometry(0.038, 0.12, 16);
      const coneMat = new THREE.MeshPhongMaterial({ color: colorHex, emissive: colorHex, specular: 0xffffff, shininess: 80 });
      const cone = new THREE.Mesh(coneGeo, coneMat);
      cone.position.copy(to);
      cone.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), coneDir);
      rig.add(cone);
    }
  }

  // Axes (Physics (x,y,z) -> Three.js (x, z, y)): Z = Beige, X = Orange, Y = Terracotta
  createAxis(new THREE.Vector3(0, -1.35, 0), new THREE.Vector3(0, 1.35, 0), 0xf5eedc, new THREE.Vector3(0, 1, 0)); // Z (Beige)
  createAxis(new THREE.Vector3(-1.35, 0, 0), new THREE.Vector3(1.35, 0, 0), 0xf97316, new THREE.Vector3(1, 0, 0)); // X (Orange)
  createAxis(new THREE.Vector3(0, 0, -1.35), new THREE.Vector3(0, 0, 1.35), 0xd4a373, new THREE.Vector3(0, 0, 1)); // Y (Terracotta)

  // Quantum State Badges with crisp sub-labels
  if (!isMini) {
    const s0 = makeLabelBadge("|0⟩", "Ground", "#f5eedc");
    if (s0) { s0.position.set(0, 1.58, 0); rig.add(s0); }
    const s1 = makeLabelBadge("|1⟩", "Excited", "#f5eedc");
    if (s1) { s1.position.set(0, -1.58, 0); rig.add(s1); }
    const sx = makeLabelBadge("|+⟩", "X+", "#fb923c");
    if (sx) { sx.position.set(1.56, 0, 0); rig.add(sx); }
    const smx = makeLabelBadge("|-⟩", "X-", "#ea580c");
    if (smx) { smx.position.set(-1.56, 0, 0); rig.add(smx); }
    const sy = makeLabelBadge("|i⟩", "Y+", "#e6d7be");
    if (sy) { sy.position.set(0, 0, 1.56); rig.add(sy); }
    const smy = makeLabelBadge("|-i⟩", "Y-", "#d4a373");
    if (smy) { smy.position.set(0, 0, -1.56); rig.add(smy); }
  }

  // -------------------------------------------------------------------------
  // State Vector Architecture (Dual-Core Laser Beam + Glowing Tip + Phase Arm)
  // -------------------------------------------------------------------------

  const vecGroup = new THREE.Group();
  rig.add(vecGroup);

  // Outer sheath beam (Glowing Solar Orange)
  const sheathGeo = new THREE.CylinderGeometry(0.024, 0.024, 1, 16);
  sheathGeo.translate(0, 0.5, 0);
  const sheathMat = new THREE.MeshPhongMaterial({
    color: 0xf97316,
    emissive: 0xc2410c,
    specular: 0xffffff,
    shininess: 90,
    transparent: true,
    opacity: 0.75,
  });
  const sheathMesh = new THREE.Mesh(sheathGeo, sheathMat);
  vecGroup.add(sheathMesh);

  // Inner core laser (Ultra-bright Desert White/Cream)
  const coreGeo = new THREE.CylinderGeometry(0.011, 0.011, 1, 12);
  coreGeo.translate(0, 0.5, 0);
  const coreMat = new THREE.MeshBasicMaterial({ color: 0xfff7ed });
  const coreMesh = new THREE.Mesh(coreGeo, coreMat);
  vecGroup.add(coreMesh);

  // Faceted Arrowhead Cone
  const headGeo = new THREE.ConeGeometry(0.065, 0.17, 20);
  headGeo.translate(0, 0.085, 0);
  const headMat = new THREE.MeshPhongMaterial({
    color: 0xff8a3d,
    emissive: 0xea580c,
    specular: 0xffffff,
    shininess: 100,
  });
  const headMesh = new THREE.Mesh(headGeo, headMat);
  vecGroup.add(headMesh);

  // Glowing Tip Orb & Orientation Halo
  const tipGroup = new THREE.Group();
  rig.add(tipGroup);

  const tipGeo = new THREE.SphereGeometry(0.044, 20, 20);
  const tipMat = new THREE.MeshBasicMaterial({ color: 0xffa559 });
  const tipMesh = new THREE.Mesh(tipGeo, tipMat);
  tipGroup.add(tipMesh);

  const tipHalo = new THREE.Mesh(
    new THREE.TorusGeometry(0.066, 0.005, 8, 24),
    new THREE.MeshBasicMaterial({ color: 0xffedd5, transparent: true, opacity: 0.85 })
  );
  tipGroup.add(tipHalo);

  // Equatorial Projection: Dotted Drop Line, Radial Phase Arm & Radar Ring
  let dropLine = null;
  let phaseArm = null;
  let dropDot = null;
  let dropRing = null;

  if (!isMini) {
    // Dotted vertical drop line from state tip down to equator plane
    const dropPts = [new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, 0)];
    const dropGeo = new THREE.BufferGeometry().setFromPoints(dropPts);
    const dropMat = new THREE.LineDashedMaterial({
      color: 0xf5eedc,
      dashSize: 0.04,
      gapSize: 0.03,
      transparent: true,
      opacity: 0.75,
    });
    dropLine = new THREE.Line(dropGeo, dropMat);
    dropLine.visible = false;
    rig.add(dropLine);

    // Radial Phase Arm connecting origin (0,0,0) to equatorial projection (v.x, 0, v.z)
    const armPts = [new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, 0)];
    const armGeo = new THREE.BufferGeometry().setFromPoints(armPts);
    const armMat = new THREE.LineBasicMaterial({
      color: 0xf97316,
      transparent: true,
      opacity: 0.85,
      linewidth: 2,
    });
    phaseArm = new THREE.Line(armGeo, armMat);
    phaseArm.visible = false;
    rig.add(phaseArm);

    // Projection target dot (Champagne Beige)
    const dotGeo = new THREE.CircleGeometry(0.036, 20);
    dotGeo.rotateX(Math.PI / 2);
    const dotMat = new THREE.MeshBasicMaterial({ color: 0xf5eedc, transparent: true, opacity: 0.85, side: THREE.DoubleSide });
    dropDot = new THREE.Mesh(dotGeo, dotMat);
    dropDot.visible = false;
    rig.add(dropDot);

    // Concentric projection radar ring
    const ringGeo = new THREE.RingGeometry(0.052, 0.066, 32);
    ringGeo.rotateX(Math.PI / 2);
    const ringMat = new THREE.MeshBasicMaterial({ color: 0xfb923c, transparent: true, opacity: 0.75, side: THREE.DoubleSide });
    dropRing = new THREE.Mesh(ringGeo, ringMat);
    dropRing.visible = false;
    rig.add(dropRing);
  }

  // Trajectory Arc Ribbon (shows rotation path in Orange)
  let trajectoryLine = null;
  let trajectoryOpacity = 0;
  if (!isMini) {
    const trajGeo = new THREE.BufferGeometry();
    const trajMat = new THREE.LineBasicMaterial({ color: 0xf97316, transparent: true, opacity: 0, linewidth: 2.5 });
    trajectoryLine = new THREE.Line(trajGeo, trajMat);
    rig.add(trajectoryLine);
  }

  // Initial orientation
  let currentVec = new THREE.Vector3(0, 1, 0); // |0> in Three.js coords (x, z, y)
  let targetVec = new THREE.Vector3(0, 1, 0);
  let animStartVec = new THREE.Vector3(0, 1, 0);
  let animStartTime = 0;
  const ANIM_DURATION = 350; // ms

  rig.rotation.x = -0.32;
  rig.rotation.y = 0.55;

  // Orbit controls with smooth inertial momentum
  let isDragging = false;
  let prevX = 0, prevY = 0;
  let velX = 0, velY = 0;
  let autoSpin = !isMini;
  let cameraDist = defaultDist;

  const dom = renderer.domElement;
  dom.style.cursor = "grab";

  dom.addEventListener("pointerdown", (e) => {
    isDragging = true;
    prevX = e.clientX;
    prevY = e.clientY;
    velX = 0;
    velY = 0;
    dom.style.cursor = "grabbing";
  });
  window.addEventListener("pointerup", () => {
    isDragging = false;
    dom.style.cursor = "grab";
  });
  window.addEventListener("pointermove", (e) => {
    if (!isDragging) return;
    const dx = e.clientX - prevX;
    const dy = e.clientY - prevY;
    prevX = e.clientX;
    prevY = e.clientY;

    const sens = 0.007;
    rig.rotation.y += dx * sens;
    rig.rotation.x += dy * sens;
    velX = dx * sens;
    velY = dy * sens;
  });

  // Wheel zoom
  dom.addEventListener("wheel", (e) => {
    e.preventDefault();
    cameraDist = Math.max(2.4, Math.min(6.5, cameraDist + e.deltaY * 0.002));
    camera.position.z = cameraDist;
  }, { passive: false });

  // View preset buttons wiring (if main canvas)
  if (!isMini) {
    const btnIso = document.getElementById("viewIsoBtn");
    const btnTop = document.getElementById("viewTopBtn");
    const btnFront = document.getElementById("viewFrontBtn");
    const btnSpin = document.getElementById("viewSpinBtn");
    const btnExpand = document.getElementById("viewExpandBtn");
    const blochPanel = document.querySelector(".bloch-panel");

    const clearActive = () => {
      [btnIso, btnTop, btnFront].forEach((b) => b && b.classList.remove("active"));
    };

    if (btnIso) {
      btnIso.addEventListener("click", () => {
        clearActive();
        btnIso.classList.add("active");
        rig.rotation.x = -0.32;
        rig.rotation.y = 0.55;
        cameraDist = 4.15;
        camera.position.z = cameraDist;
      });
    }
    if (btnTop) {
      btnTop.addEventListener("click", () => {
        clearActive();
        btnTop.classList.add("active");
        rig.rotation.x = -Math.PI / 2 + 0.001;
        rig.rotation.y = 0;
        cameraDist = 4.0;
        camera.position.z = cameraDist;
      });
    }
    if (btnFront) {
      btnFront.addEventListener("click", () => {
        clearActive();
        btnFront.classList.add("active");
        rig.rotation.x = 0;
        rig.rotation.y = -Math.PI / 2;
        cameraDist = 4.15;
        camera.position.z = cameraDist;
      });
    }
    if (btnSpin) {
      btnSpin.addEventListener("click", () => {
        autoSpin = !autoSpin;
        btnSpin.classList.toggle("active", autoSpin);
      });
    }

    if (btnExpand && blochPanel) {
      btnExpand.addEventListener("click", () => {
        const isExp = blochPanel.classList.toggle("expanded");
        btnExpand.textContent = isExp ? "✕ Collapse" : "⛶ Expand";
        btnExpand.classList.toggle("active", isExp);
        setTimeout(() => {
          window.dispatchEvent(new Event("resize"));
        }, 60);
      });
    }

    window.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && blochPanel && blochPanel.classList.contains("expanded")) {
        blochPanel.classList.remove("expanded");
        if (btnExpand) {
          btnExpand.textContent = "⛶ Expand";
          btnExpand.classList.remove("active");
        }
        setTimeout(() => window.dispatchEvent(new Event("resize")), 60);
      }
    });
  }

  // ResizeObserver for dynamic scaling
  const ro = new ResizeObserver((entries) => {
    for (const entry of entries) {
      const w = entry.contentRect.width;
      const h = entry.contentRect.height || w;
      if (w > 20 && h > 20) {
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
        renderer.setSize(w, h, false);
      }
    }
  });
  ro.observe(container);

  // -------------------------------------------------------------------------
  // Render Loop
  // -------------------------------------------------------------------------

  let lastTime = performance.now();

  function animate(now) {
    requestAnimationFrame(animate);
    const dt = Math.min((now - lastTime) / 1000, 0.1);
    lastTime = now;

    // Smooth inertial momentum
    if (!isDragging) {
      rig.rotation.y += velX;
      rig.rotation.x += velY;
      velX *= 0.92;
      velY *= 0.92;

      // Gentle auto-rotation
      if (autoSpin) {
        rig.rotation.y += 0.0022;
      }
    }

    // SLERP state vector animation
    if (animStartTime > 0) {
      const progress = Math.min(1, (now - animStartTime) / ANIM_DURATION);
      const ease = progress < 0.5 ? 2 * progress * progress : 1 - Math.pow(-2 * progress + 2, 2) / 2;

      // Spherical linear interpolation between animStartVec and targetVec
      const lStart = animStartVec.length();
      const lTarget = targetVec.length();
      const curLen = lStart + (lTarget - lStart) * ease;

      const normStart = animStartVec.clone().normalize();
      const normTarget = targetVec.clone().normalize();
      const dot = Math.max(-1, Math.min(1, normStart.dot(normTarget)));

      if (Math.abs(dot - 1) < 1e-4) {
        currentVec.copy(normTarget).multiplyScalar(curLen);
      } else {
        const omega = Math.acos(dot);
        const sinOmega = Math.sin(omega);
        const wStart = Math.sin((1 - ease) * omega) / sinOmega;
        const wTarget = Math.sin(ease * omega) / sinOmega;
        currentVec.copy(normStart).multiplyScalar(wStart).addScaledVector(normTarget, wTarget).normalize().multiplyScalar(curLen);
      }

      applyVectorGeometry(currentVec);

      if (progress >= 1) {
        animStartTime = 0;
        currentVec.copy(targetVec);
        applyVectorGeometry(currentVec);
      }
    }

    // Trajectory arc fade out
    if (trajectoryLine && trajectoryOpacity > 0.01) {
      trajectoryOpacity = Math.max(0, trajectoryOpacity - dt * 0.65);
      trajectoryLine.material.opacity = trajectoryOpacity;
    }

    // Pulse tip orb subtly and drift cosmic particles
    if (pMesh) {
      pMesh.rotation.y += 0.0004;
      pMesh.rotation.x += 0.0001;
    }
    if (tipGroup) {
      const pulse = 1.0 + 0.07 * Math.sin(now * 0.005);
      tipMesh.scale.set(pulse, pulse, pulse);
      tipHalo.rotation.z += 0.015;
    }

    renderer.render(scene, camera);
  }
  requestAnimationFrame(animate);

  // Update 3D geometry of state vector
  function applyVectorGeometry(v) {
    const len = v.length();

    if (len < 0.02) {
      vecGroup.visible = false;
      tipGroup.visible = false;
      if (dropLine) dropLine.visible = false;
      if (phaseArm) phaseArm.visible = false;
      if (dropDot) dropDot.visible = false;
      if (dropRing) dropRing.visible = false;
    } else {
      vecGroup.visible = true;
      tipGroup.visible = true;
      const dir = v.clone().normalize();
      const quat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
      vecGroup.quaternion.copy(quat);

      const shaftLen = Math.max(0.001, len - 0.17);
      sheathMesh.scale.set(1, shaftLen, 1);
      coreMesh.scale.set(1, shaftLen, 1);
      headMesh.position.set(0, shaftLen, 0);

      tipGroup.position.copy(v);
      tipGroup.quaternion.copy(quat);

      if (len < 0.95) {
        // Entangled / Mixed state inside sphere: warm terracotta rose
        sheathMat.color.setHex(0xe11d48);
        sheathMat.emissive.setHex(0x881337);
        headMat.color.setHex(0xe11d48);
        headMat.emissive.setHex(0xe11d48);
        tipMat.color.setHex(0xf43f5e);
      } else {
        // Pure state: radiant solar orange & warm amber
        sheathMat.color.setHex(0xf97316);
        sheathMat.emissive.setHex(0xc2410c);
        headMat.color.setHex(0xff8a3d);
        headMat.emissive.setHex(0xea580c);
        tipMat.color.setHex(0xffa559);
      }

      // Equatorial drop line, radial phase arm, and drop radar ring
      if (dropLine && dropDot) {
        const transverseDist = Math.hypot(v.x, v.z);
        if (transverseDist > 0.08) {
          dropLine.visible = true;
          if (phaseArm) phaseArm.visible = true;
          dropDot.visible = true;
          if (dropRing) dropRing.visible = true;

          // Dotted vertical drop line from state tip down to equator plane
          const dropPts = [v, new THREE.Vector3(v.x, 0, v.z)];
          dropLine.geometry.setFromPoints(dropPts);
          dropLine.computeLineDistances();

          // Radial Phase Arm connecting origin (0,0,0) to equatorial projection
          if (phaseArm) {
            const armPts = [new THREE.Vector3(0, 0, 0), new THREE.Vector3(v.x, 0, v.z)];
            phaseArm.geometry.setFromPoints(armPts);
          }

          dropDot.position.set(v.x, 0, v.z);
          if (dropRing) dropRing.position.set(v.x, 0, v.z);
        } else {
          dropLine.visible = false;
          if (phaseArm) phaseArm.visible = false;
          dropDot.visible = false;
          if (dropRing) dropRing.visible = false;
        }
      }
    }
  }

  // Public setter called by application
  function setVector(x, y, z) {
    const newTarget = new THREE.Vector3(x, z, y); // physics (x, y, z) -> Three.js (x, z, y)

    // Build trajectory arc curve if significant movement
    if (trajectoryLine && !isMini) {
      const pA = currentVec.clone().normalize();
      const pB = newTarget.clone().normalize();
      const dot = Math.max(-1, Math.min(1, pA.dot(pB)));

      if (dot < 0.995 && dot > -0.995) {
        const arcPts = [];
        const omega = Math.acos(dot);
        const sinOmega = Math.sin(omega);
        const steps = 28;
        for (let i = 0; i <= steps; i++) {
          const t = i / steps;
          const wA = Math.sin((1 - t) * omega) / sinOmega;
          const wB = Math.sin(t * omega) / sinOmega;
          const pt = pA.clone().multiplyScalar(wA).addScaledVector(pB, wB).normalize().multiplyScalar(1.002);
          arcPts.push(pt);
        }
        trajectoryLine.geometry.setFromPoints(arcPts);
        trajectoryOpacity = 0.9;
        trajectoryLine.material.opacity = trajectoryOpacity;
      }
    }

    animStartVec.copy(currentVec);
    targetVec.copy(newTarget);
    animStartTime = performance.now();
  }

  // Initialize vector geometry and positions immediately so vector starts correctly at |0>
  applyVectorGeometry(currentVec);

  return { setVector };
}

// ---------------------------------------------------------------------------
// 2D Canvas Fallback in case WebGL is blocked
// ---------------------------------------------------------------------------

function create2DBlochFallback(container) {
  const canvas = document.createElement("canvas");
  canvas.width = 320;
  canvas.height = 320;
  canvas.style.width = "100%";
  canvas.style.height = "100%";
  container.appendChild(canvas);
  const ctx = canvas.getContext("2d");

  let vec = { x: 0, y: 0, z: 1 };
  let angle = 0.55;

  function draw() {
    ctx.clearRect(0, 0, 320, 320);
    const cx = 160, cy = 160, r = 115;

    // Glowing background orb
    const grad = ctx.createRadialGradient(cx, cy, 10, cx, cy, r);
    grad.addColorStop(0, "rgba(35, 26, 18, 0.85)");
    grad.addColorStop(0.7, "rgba(20, 16, 12, 0.95)");
    grad.addColorStop(1, "rgba(10, 8, 6, 1)");

    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = grad;
    ctx.fill();
    ctx.strokeStyle = "#f97316";
    ctx.lineWidth = 1.5;
    ctx.shadowColor = "#f97316";
    ctx.shadowBlur = 10;
    ctx.stroke();
    ctx.shadowBlur = 0;

    // Equator ellipse
    ctx.beginPath();
    ctx.ellipse(cx, cy, r, r * 0.32, 0, 0, Math.PI * 2);
    ctx.strokeStyle = "#fb923c";
    ctx.lineWidth = 1.2;
    ctx.stroke();

    // Z-axis (vertical)
    ctx.beginPath();
    ctx.moveTo(cx, cy - r * 1.25);
    ctx.lineTo(cx, cy + r * 1.25);
    ctx.strokeStyle = "#f5eedc";
    ctx.lineWidth = 1.6;
    ctx.stroke();

    // Labels
    ctx.fillStyle = "#f5eedc";
    ctx.font = "bold 14px 'IBM Plex Mono', monospace";
    ctx.textAlign = "center";
    ctx.fillText("|0⟩", cx, cy - r * 1.32);
    ctx.fillText("|1⟩", cx, cy + r * 1.42);

    // Vector projection
    const px = cx + (vec.x * Math.cos(angle) - vec.y * Math.sin(angle)) * r;
    const py = cy - vec.z * r + (vec.x * Math.sin(angle) + vec.y * Math.cos(angle)) * r * 0.3;

    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(px, py);
    const len = Math.hypot(vec.x, vec.y, vec.z);
    ctx.strokeStyle = len < 0.96 ? "#f43f5e" : "#f97316";
    ctx.lineWidth = 3.5;
    ctx.shadowColor = len < 0.96 ? "#f43f5e" : "#f97316";
    ctx.shadowBlur = 8;
    ctx.stroke();
    ctx.shadowBlur = 0;

    ctx.beginPath();
    ctx.arc(px, py, 6, 0, Math.PI * 2);
    ctx.fillStyle = len < 0.96 ? "#f43f5e" : "#ff8a3d";
    ctx.fill();
  }

  draw();

  return {
    setVector(x, y, z) {
      vec = { x, y, z };
      draw();
    }
  };
}

// ---------------------------------------------------------------------------
// Qubit Basics tab
// ---------------------------------------------------------------------------

const SINGLE_QUBIT_GATES = ["I", "X", "Y", "Z", "H", "S", "Sdg", "T", "Tdg"];
const PARAM_GATES = ["RX", "RY", "RZ"];

let basicsSequence = [];
let basicsBloch = null;
let pendingParamGate = null;

function renderBasicGateButtons() {
  const wrap = document.getElementById("basicGateButtons");
  if (!wrap) return;
  wrap.innerHTML = "";
  SINGLE_QUBIT_GATES.forEach((id) => {
    const g = GATE_CATALOG[id] || { symbol: id, name: id };
    const btn = document.createElement("button");
    btn.className = "gate-btn";
    btn.textContent = g.symbol;
    btn.title = g.name;
    btn.addEventListener("click", () => addBasicGate(id));
    wrap.appendChild(btn);
  });
  PARAM_GATES.forEach((id) => {
    const btn = document.createElement("button");
    btn.className = "gate-btn";
    btn.textContent = id;
    btn.title = `${id}(θ)`;
    btn.addEventListener("click", () => {
      pendingParamGate = id;
      document.getElementById("thetaControl").hidden = false;
    });
    wrap.appendChild(btn);
  });
}

document.getElementById("thetaSlider").addEventListener("input", (e) => {
  document.getElementById("thetaValue").textContent = parseFloat(e.target.value).toFixed(2);
});

document.getElementById("applyThetaBtn").addEventListener("click", () => {
  if (!pendingParamGate) return;
  const theta = parseFloat(document.getElementById("thetaSlider").value);
  addBasicGate(pendingParamGate, theta);
});

async function addBasicGate(gate, theta) {
  basicsSequence.push({ gate, theta });
  await recomputeBasics();
}

document.getElementById("undoBtn").addEventListener("click", async () => {
  basicsSequence.pop();
  await recomputeBasics();
});

document.getElementById("resetBtn").addEventListener("click", async () => {
  basicsSequence = [];
  await recomputeBasics();
});

function getSingleQubitGateMatrix(gate, theta) {
  if (gate === "Rx" && theta != null) {
    const h = theta / 2;
    return [[c(Math.cos(h), 0), c(0, -Math.sin(h))], [c(0, -Math.sin(h)), c(Math.cos(h), 0)]];
  }
  if (gate === "Ry" && theta != null) {
    const h = theta / 2;
    return [[c(Math.cos(h), 0), c(-Math.sin(h), 0)], [c(Math.sin(h), 0), c(Math.cos(h), 0)]];
  }
  if (gate === "Rz" && theta != null) {
    const h = theta / 2;
    return [[c(Math.cos(h), -Math.sin(h)), c(0, 0)], [c(0, 0), c(Math.cos(h), Math.sin(h))]];
  }
  if (DEFAULT_GATE_CATALOG[gate] && DEFAULT_GATE_CATALOG[gate].matrix) {
    return DEFAULT_GATE_CATALOG[gate].matrix;
  }
  return [[c(1, 0), c(0, 0)], [c(0, 0), c(1, 0)]];
}

function simulateSingleQubitSequence(seq) {
  let v0 = c(1, 0);
  let v1 = c(0, 0);
  let mat = [[c(1, 0), c(0, 0)], [c(0, 0), c(1, 0)]];
  const steps = [];

  for (const s of seq) {
    const gMat = getSingleQubitGateMatrix(s.gate, s.theta);
    const n0 = cAdd(cMul(gMat[0][0], v0), cMul(gMat[0][1], v1));
    const n1 = cAdd(cMul(gMat[1][0], v0), cMul(gMat[1][1], v1));
    v0 = n0;
    v1 = n1;
    mat = matMul2x2(gMat, mat);
    steps.push({
      gate: s.gate,
      theta: s.theta,
      matrix: gMat,
      statevector: [v0, v1]
    });
  }

  const p0 = cAbs2(v0);
  const p1 = cAbs2(v1);
  const v0conj_v1 = {
    re: v0.re * v1.re + v0.im * v1.im,
    im: v0.re * v1.im - v0.im * v1.re
  };
  const bx = 2 * v0conj_v1.re;
  const by = 2 * v0conj_v1.im;
  const bz = p0 - p1;

  return {
    statevector: [v0, v1],
    probabilities: [p0, p1],
    bloch: [bx, by, bz],
    matrix: mat,
    steps
  };
}

async function recomputeBasics() {
  let result;
  if (basicsSequence.length === 0) {
    result = {
      statevector: [{ re: 1, im: 0 }, { re: 0, im: 0 }],
      probabilities: [1, 0],
      bloch: [0, 0, 1],
      matrix: [[{ re: 1, im: 0 }, { re: 0, im: 0 }], [{ re: 0, im: 0 }, { re: 1, im: 0 }]],
      steps: [],
    };
  } else {
    try {
      result = await apiPost("/qubit/apply", { gates: basicsSequence });
    } catch (e) {
      result = simulateSingleQubitSequence(basicsSequence);
    }
  }
  renderBasicsResult(result);
}

function renderBasicsResult(result) {
  document.getElementById("ketDisplay").textContent =
    `|ψ⟩ = (${fmtComplex(result.statevector[0])})|0⟩ + (${fmtComplex(result.statevector[1])})|1⟩`;

  const probWrap = document.getElementById("probBars");
  probWrap.innerHTML = "";
  ["0", "1"].forEach((label, i) => {
    probWrap.appendChild(makeProbRow(`|${label}⟩`, result.probabilities[i]));
  });

  document.getElementById("combinedMatrix").innerHTML = "";
  document.getElementById("combinedMatrix").appendChild(renderMatrixTable(result.matrix));

  const lastBox = document.getElementById("lastGateMatrix");
  lastBox.innerHTML = "";
  if (result.steps && result.steps.length) {
    const last = result.steps[result.steps.length - 1];
    lastBox.appendChild(renderMatrixTable(last.matrix));
  } else {
    lastBox.innerHTML = `<span class="hint">— apply a gate —</span>`;
  }

  const stepList = document.getElementById("stepList");
  stepList.innerHTML = "";
  if (basicsSequence.length === 0) {
    stepList.innerHTML = `<li class="empty">— none yet —</li>`;
  } else {
    basicsSequence.forEach((s, i) => {
      const li = document.createElement("li");
      const label = s.theta != null ? `${s.gate}(${s.theta.toFixed(2)})` : s.gate;
      li.innerHTML = `<span><span class="idx">${i + 1}.</span>${label}</span>`;
      stepList.appendChild(li);
    });
  }

  if (basicsBloch) basicsBloch.setVector(...result.bloch);

  // Compute spherical coordinates and state recognition
  const [bx, by, bz] = result.bloch;
  const r = Math.hypot(bx, by, bz);
  const thetaRad = Math.acos(Math.max(-1, Math.min(1, r > 1e-6 ? bz / r : 1)));
  const thetaDeg = (thetaRad * 180 / Math.PI).toFixed(1);
  let phiRad = Math.atan2(by, bx);
  if (phiRad < 0) phiRad += 2 * Math.PI;
  const phiDeg = (phiRad * 180 / Math.PI).toFixed(1);

  const cartEl = document.getElementById("blochBasicsReadout");
  if (cartEl) {
    cartEl.innerHTML = `<span class="m-label">Cartesian:</span> x = ${bx.toFixed(3)} &nbsp; y = ${by.toFixed(3)} &nbsp; z = ${bz.toFixed(3)}`;
  }
  const angEl = document.getElementById("blochAnglesReadout");
  if (angEl) {
    angEl.innerHTML = `<span class="m-label">Spherical:</span> θ = ${thetaDeg}° &nbsp; φ = ${phiDeg}° &nbsp; |r| = ${r.toFixed(2)}`;
  }

  // Update HUD badge state description
  const hudState = document.getElementById("blochHudState");
  if (hudState) {
    if (Math.abs(bz - 1) < 0.05 && r > 0.95) hudState.textContent = "|0⟩ Ground State";
    else if (Math.abs(bz + 1) < 0.05 && r > 0.95) hudState.textContent = "|1⟩ Excited State";
    else if (Math.abs(bx - 1) < 0.05 && r > 0.95) hudState.textContent = "|+⟩ Superposition (|0⟩+|1⟩)/√2";
    else if (Math.abs(bx + 1) < 0.05 && r > 0.95) hudState.textContent = "|-⟩ Superposition (|0⟩-|1⟩)/√2";
    else if (Math.abs(by - 1) < 0.05 && r > 0.95) hudState.textContent = "|i⟩ Phase State (|0⟩+i|1⟩)/√2";
    else if (Math.abs(by + 1) < 0.05 && r > 0.95) hudState.textContent = "|-i⟩ Phase State (|0⟩-i|1⟩)/√2";
    else if (r < 0.95) hudState.textContent = `Mixed State (Purity ${(r * r).toFixed(2)})`;
    else hudState.textContent = `Pure State (θ=${thetaDeg}°, φ=${phiDeg}°)`;
  }
}

function makeProbRow(label, p) {
  const row = document.createElement("div");
  row.className = "prob-row";
  const pct = (p * 100).toFixed(1);
  row.innerHTML = `
    <span class="label">${label}</span>
    <span class="track"><span class="fill" style="width:${pct}%"></span></span>
    <span class="pct">${pct}%</span>`;
  return row;
}

// ---------------------------------------------------------------------------
// Circuit Builder tab (Click-to-place, Drag-and-drop, and Quick Presets)
// ---------------------------------------------------------------------------

const ALL_CHIP_GATES = ["I", "X", "Y", "Z", "H", "S", "Sdg", "T", "Tdg", "RX", "RY", "RZ", "CX", "CZ", "SWAP"];
const TWO_QUBIT = new Set(["CX", "CZ", "SWAP"]);

let numQubits = 2;
let numSteps = 6;
let placedGates = [];
let gateIdCounter = 1;
let pending = null;              // { gate, qubit, step } for 2-qubit targets
let selectedPaletteGate = null;  // currently selected gate for click-to-place

function renderPaletteChips() {
  const wrap = document.getElementById("paletteChips");
  if (!wrap) return;
  wrap.innerHTML = "";
  ALL_CHIP_GATES.forEach((id) => {
    const g = GATE_CATALOG[id] || { symbol: id, name: id };
    const chip = document.createElement("div");
    chip.className = "chip" + (TWO_QUBIT.has(id) ? " two-qubit" : "") + (selectedPaletteGate === id ? " selected" : "");
    chip.textContent = g.symbol || id;
    chip.title = `${g.name || id} (${id}) — click to select, or drag`;
    chip.draggable = true;

    // Click to select
    chip.addEventListener("click", () => {
      if (selectedPaletteGate === id) {
        selectedPaletteGate = null;
      } else {
        selectedPaletteGate = id;
      }
      updatePaletteSelectionUI();
    });

    // Drag to place
    chip.addEventListener("dragstart", (e) => {
      e.dataTransfer.setData("text/gate", id);
      selectedPaletteGate = id;
      updatePaletteSelectionUI();
    });

    wrap.appendChild(chip);
  });
}

function updatePaletteSelectionUI() {
  document.querySelectorAll("#paletteChips .chip").forEach((c, idx) => {
    const id = ALL_CHIP_GATES[idx];
    c.classList.toggle("selected", selectedPaletteGate === id);
  });
  const grid = document.getElementById("circuitGrid");
  if (grid) {
    grid.querySelectorAll(".circuit-cell").forEach((cell) => {
      cell.classList.toggle("has-selected-gate", !!selectedPaletteGate);
      cell.classList.toggle("is-two-qubit", !!(selectedPaletteGate && TWO_QUBIT.has(selectedPaletteGate)));
    });
  }
}

document.getElementById("numQubits").addEventListener("change", (e) => {
  numQubits = parseInt(e.target.value, 10);
  placedGates = placedGates.filter((g) => g.qubits.every((q) => q < numQubits));
  buildCircuitGrid();
});

document.getElementById("numSteps").addEventListener("change", (e) => {
  numSteps = parseInt(e.target.value, 10);
  placedGates = placedGates.filter((g) => g.step < numSteps);
  buildCircuitGrid();
});

document.getElementById("clearCircuitBtn").addEventListener("click", () => {
  placedGates = [];
  pending = null;
  selectedPaletteGate = null;
  updatePaletteSelectionUI();
  buildCircuitGrid();
  document.getElementById("builderResults").hidden = true;
});

document.getElementById("runCircuitBtn").addEventListener("click", runCircuit);

function cellKeyFree(qubit, step, excludeId) {
  return !placedGates.some((g) => g.step === step && g.qubits.includes(qubit) && g.id !== excludeId);
}

function removeGate(id) {
  placedGates = placedGates.filter((g) => g.id !== id);
  buildCircuitGrid();
}

function buildCircuitGrid() {
  const grid = document.getElementById("circuitGrid");
  if (!grid) return;
  grid.innerHTML = "";

  for (let q = 0; q < numQubits; q++) {
    const row = document.createElement("div");
    row.className = "circuit-row";
    const label = document.createElement("div");
    label.className = "qubit-label";
    label.textContent = `q${q}: |0⟩`;
    row.appendChild(label);

    for (let s = 0; s < numSteps; s++) {
      const cell = document.createElement("div");
      cell.className = "circuit-cell";
      cell.dataset.qubit = q;
      cell.dataset.step = s;

      if (selectedPaletteGate) {
        cell.classList.add("has-selected-gate");
        if (TWO_QUBIT.has(selectedPaletteGate)) cell.classList.add("is-two-qubit");
      }

      cell.addEventListener("dragover", (e) => {
        e.preventDefault();
        cell.classList.add("drag-over");
      });
      cell.addEventListener("dragleave", () => cell.classList.remove("drag-over"));
      cell.addEventListener("drop", (e) => {
        e.preventDefault();
        cell.classList.remove("drag-over");
        const gateId = e.dataTransfer.getData("text/gate");
        if (gateId) handleDrop(gateId, q, s);
      });
      cell.addEventListener("click", () => handleCellClick(q, s));

      row.appendChild(cell);
    }
    grid.appendChild(row);
  }

  // Paint placed gates
  placedGates.forEach((g) => paintGate(g));

  // Paint pending 2-qubit target highlight
  const note = document.getElementById("pendingNote");
  if (pending) {
    note.hidden = false;
    note.textContent = `${pending.gate} placed on q${pending.qubit} at step ${pending.step + 1} — click another qubit in that column to set the target (click control qubit to cancel).`;
    grid.querySelectorAll(".circuit-cell").forEach((cell) => {
      const q = parseInt(cell.dataset.qubit, 10), s = parseInt(cell.dataset.step, 10);
      if (s === pending.step && q !== pending.qubit) cell.classList.add("pending-target");
    });
  } else {
    note.hidden = true;
  }

  // Update live circuit telemetry stats bar
  updateCircuitStats();
}

function calculateCircuitMetrics(nQubits, gates) {
  const size = gates.length;
  if (size === 0) {
    return {
      depth: 0,
      size: 0,
      width: nQubits,
      activeQubits: 0,
      oneQubitGates: 0,
      twoQubitGates: 0,
      density: "0%",
      opsCount: {},
    };
  }

  // Sort gates chronologically by step
  const sorted = [...gates].sort((a, b) => (a.step ?? 0) - (b.step ?? 0));
  const wireDepth = new Array(nQubits).fill(0);
  let oneQubitGates = 0;
  let twoQubitGates = 0;
  const opsCount = {};
  const activeSet = new Set();

  for (const g of sorted) {
    const qList = g.qubits || [];
    qList.forEach((q) => activeSet.add(q));
    const gName = (g.gate || "").toUpperCase();
    opsCount[gName] = (opsCount[gName] || 0) + 1;

    if (qList.length === 1) {
      oneQubitGates++;
      const q = qList[0];
      if (q < nQubits) {
        wireDepth[q] += 1;
      }
    } else if (qList.length >= 2) {
      twoQubitGates++;
      let maxD = 0;
      for (const q of qList) {
        if (q < nQubits) maxD = Math.max(maxD, wireDepth[q]);
      }
      for (const q of qList) {
        if (q < nQubits) wireDepth[q] = maxD + 1;
      }
    }
  }

  const depth = Math.max(0, ...wireDepth);
  const activeQubits = activeSet.size;
  const maxCapacity = (activeQubits > 0 ? activeQubits : nQubits) * (depth > 0 ? depth : 1);
  const density = maxCapacity > 0 ? Math.round((size / maxCapacity) * 100) + "%" : "0%";

  return {
    depth,
    size,
    width: nQubits,
    activeQubits,
    oneQubitGates,
    twoQubitGates,
    density,
    opsCount,
  };
}

function updateCircuitStats() {
  const metrics = calculateCircuitMetrics(numQubits, placedGates);

  const elDepth = document.getElementById("liveDepth");
  const elSize = document.getElementById("liveSize");
  const elWidth = document.getElementById("liveWidth");
  const el2Q = document.getElementById("live2Q");
  const el1Q = document.getElementById("live1Q");
  const elDensity = document.getElementById("liveDensity");

  if (elDepth) elDepth.textContent = metrics.depth;
  if (elSize) elSize.textContent = `${metrics.size} ${metrics.size === 1 ? "gate" : "gates"}`;
  if (elWidth) elWidth.textContent = `${metrics.width}Q (${metrics.activeQubits} active)`;
  if (el2Q) el2Q.textContent = metrics.twoQubitGates;
  if (el1Q) el1Q.textContent = metrics.oneQubitGates;
  if (elDensity) elDensity.textContent = metrics.density;
}

function cellAt(q, s) {
  return document.querySelector(`.circuit-cell[data-qubit="${q}"][data-step="${s}"]`);
}

function paintGate(g) {
  if (g.qubits.length === 1) {
    const cell = cellAt(g.qubits[0], g.step);
    if (!cell) return;
    const node = document.createElement("div");
    node.className = "placed-gate";
    const symbol = GATE_CATALOG[g.gate] ? GATE_CATALOG[g.gate].symbol : g.gate;
    node.textContent = g.theta != null ? `${g.gate}` : symbol;
    node.title = `${g.gate} (Click to remove)`;
    node.addEventListener("click", (e) => {
      e.stopPropagation();
      removeGate(g.id);
    });
    cell.appendChild(node);
    return;
  }

  // Two-qubit gate: control = qubits[0], target = qubits[1]
  const [ctrl, tgt] = g.qubits;
  const top = Math.min(ctrl, tgt), bottom = Math.max(ctrl, tgt);

  const topCell = cellAt(top, g.step);
  const bottomCell = cellAt(bottom, g.step);
  if (topCell && bottomCell) {
    const line = document.createElement("div");
    line.className = "link-line";
    line.style.top = "28px";
    line.style.height = `${(bottom - top) * 56}px`;
    topCell.appendChild(line);
  }

  const ctrlCell = cellAt(ctrl, g.step);
  if (ctrlCell) {
    const dot = document.createElement("div");
    dot.className = "placed-gate control-node";
    dot.title = `Control for ${g.gate} (Click to remove)`;
    dot.addEventListener("click", (e) => {
      e.stopPropagation();
      removeGate(g.id);
    });
    ctrlCell.appendChild(dot);
  }

  const tgtCell = cellAt(tgt, g.step);
  if (tgtCell) {
    const node = document.createElement("div");
    node.className = "placed-gate two-qubit-node";
    const symbol = GATE_CATALOG[g.gate] ? GATE_CATALOG[g.gate].symbol : g.gate;
    node.textContent = symbol;
    node.title = `Target for ${g.gate} (Click to remove)`;
    node.addEventListener("click", (e) => {
      e.stopPropagation();
      removeGate(g.id);
    });
    tgtCell.appendChild(node);
  }
}

function handleDrop(gateId, qubit, step) {
  pending = null;
  if (TWO_QUBIT.has(gateId)) {
    if (numQubits < 2) {
      alert("This gate needs at least 2 qubits — increase the qubit count first.");
      return;
    }
    placedGates = placedGates.filter((g) => !(g.step === step && g.qubits.includes(qubit)));
    pending = { gate: gateId, qubit, step };
    buildCircuitGrid();
    return;
  }
  let theta = null;
  if (["RX", "RY", "RZ"].includes(gateId)) {
    const input = prompt(`Angle θ for ${gateId}, in radians (e.g. 1.5708 for π/2):`, "1.5708");
    if (input === null) return;
    theta = parseFloat(input);
    if (Number.isNaN(theta)) theta = 0;
  }
  placedGates = placedGates.filter((g) => !(g.step === step && g.qubits.includes(qubit)));
  placedGates.push({ id: gateIdCounter++, gate: gateId, qubits: [qubit], step, theta });
  buildCircuitGrid();
}

function handleCellClick(qubit, step) {
  // If waiting for second qubit of a 2-qubit gate:
  if (pending) {
    if (pending.qubit === qubit && pending.step === step) {
      pending = null;
      buildCircuitGrid();
      return;
    }
    if (step !== pending.step) return;
    if (!cellKeyFree(qubit, step)) return;
    placedGates.push({ id: gateIdCounter++, gate: pending.gate, qubits: [pending.qubit, qubit], step, theta: null });
    pending = null;
    selectedPaletteGate = null;
    updatePaletteSelectionUI();
    buildCircuitGrid();
    return;
  }

  // If a palette gate is selected, place it in the clicked cell!
  if (selectedPaletteGate) {
    handleDrop(selectedPaletteGate, qubit, step);
    return;
  }

  // Otherwise, if the cell already has a gate, remove it
  const existing = placedGates.find((g) => g.step === step && g.qubits.includes(qubit));
  if (existing) {
    removeGate(existing.id);
  }
}

// ---------------------------------------------------------------------------
// Circuit Presets
// ---------------------------------------------------------------------------

function initPresets() {
  document.querySelectorAll(".btn-preset").forEach((btn) => {
    btn.addEventListener("click", () => {
      loadPreset(btn.dataset.preset);
    });
  });
}

function loadPreset(name) {
  pending = null;
  selectedPaletteGate = null;
  updatePaletteSelectionUI();

  if (name === "bell") {
    numQubits = 2;
    numSteps = 4;
    placedGates = [
      { id: gateIdCounter++, gate: "H", qubits: [0], step: 0, theta: null },
      { id: gateIdCounter++, gate: "CX", qubits: [0, 1], step: 1, theta: null }
    ];
  } else if (name === "ghz") {
    numQubits = 3;
    numSteps = 6;
    placedGates = [
      { id: gateIdCounter++, gate: "H", qubits: [0], step: 0, theta: null },
      { id: gateIdCounter++, gate: "CX", qubits: [0, 1], step: 1, theta: null },
      { id: gateIdCounter++, gate: "CX", qubits: [1, 2], step: 2, theta: null }
    ];
  } else if (name === "super") {
    numQubits = 3;
    numSteps = 4;
    placedGates = [
      { id: gateIdCounter++, gate: "H", qubits: [0], step: 0, theta: null },
      { id: gateIdCounter++, gate: "H", qubits: [1], step: 0, theta: null },
      { id: gateIdCounter++, gate: "H", qubits: [2], step: 0, theta: null }
    ];
  } else if (name === "swap") {
    numQubits = 2;
    numSteps = 4;
    placedGates = [
      { id: gateIdCounter++, gate: "X", qubits: [0], step: 0, theta: null },
      { id: gateIdCounter++, gate: "H", qubits: [1], step: 0, theta: null },
      { id: gateIdCounter++, gate: "SWAP", qubits: [0, 1], step: 1, theta: null }
    ];
  }

  document.getElementById("numQubits").value = numQubits;
  document.getElementById("numSteps").value = numSteps;
  buildCircuitGrid();

  // Run automatically so user sees results immediately
  runCircuit();
}

function simulateCircuitClient(nQubits, gates) {
  const dim = 1 << nQubits;
  let state = new Array(dim).fill(null).map((_, i) => (i === 0 ? c(1, 0) : c(0, 0)));

  // Sort gates by step
  const sortedGates = [...gates].sort((a, b) => (a.step ?? 0) - (b.step ?? 0));

  for (const g of sortedGates) {
    const name = g.gate;
    const qList = g.qubits || [];

    if (qList.length === 1) {
      const q = qList[0];
      const gMat = getSingleQubitGateMatrix(name, g.theta);
      const mask = 1 << q;
      for (let i = 0; i < dim; i++) {
        if ((i & mask) === 0) {
          const j = i | mask;
          const a = state[i];
          const b = state[j];
          state[i] = cAdd(cMul(gMat[0][0], a), cMul(gMat[0][1], b));
          state[j] = cAdd(cMul(gMat[1][0], a), cMul(gMat[1][1], b));
        }
      }
    } else if (qList.length === 2) {
      const [cQ, tQ] = qList;
      const cMask = 1 << cQ;
      const tMask = 1 << tQ;

      if (name === "CX" || name === "CNOT") {
        for (let i = 0; i < dim; i++) {
          if ((i & cMask) !== 0 && (i & tMask) === 0) {
            const j = i | tMask;
            const tmp = state[i];
            state[i] = state[j];
            state[j] = tmp;
          }
        }
      } else if (name === "CZ") {
        for (let i = 0; i < dim; i++) {
          if ((i & cMask) !== 0 && (i & tMask) !== 0) {
            state[i] = { re: -state[i].re, im: -state[i].im };
          }
        }
      } else if (name === "SWAP") {
        for (let i = 0; i < dim; i++) {
          const bitC = (i >> cQ) & 1;
          const bitT = (i >> tQ) & 1;
          if (bitC === 0 && bitT === 1) {
            const j = (i ^ cMask) ^ tMask;
            const tmp = state[i];
            state[i] = state[j];
            state[j] = tmp;
          }
        }
      }
    }
  }

  // Basis state labels & probabilities
  const basis_labels = [];
  const probabilities = {};
  const probsArr = [];
  for (let i = 0; i < dim; i++) {
    let bits = "";
    for (let q = nQubits - 1; q >= 0; q--) {
      bits += (i >> q) & 1;
    }
    basis_labels.push(bits);
    const p = Math.max(0, cAbs2(state[i]));
    probabilities[bits] = p;
    probsArr.push(p);
  }

  // Simulated measurement sampling (1024 shots)
  const counts = {};
  for (let s = 0; s < 1024; s++) {
    const r = Math.random();
    let acc = 0;
    let chosen = basis_labels[0];
    for (let i = 0; i < dim; i++) {
      acc += probsArr[i];
      if (r <= acc || i === dim - 1) {
        chosen = basis_labels[i];
        break;
      }
    }
    counts[chosen] = (counts[chosen] || 0) + 1;
  }

  // Per-qubit Bloch vector & purity via partial trace
  const qubits = [];
  for (let q = 0; q < nQubits; q++) {
    const mask = 1 << q;
    let rho00 = 0;
    let rho11 = 0;
    let rho01 = c(0, 0);

    for (let i = 0; i < dim; i++) {
      if ((i & mask) === 0) {
        const j = i | mask;
        rho00 += cAbs2(state[i]);
        rho11 += cAbs2(state[j]);
        const term = {
          re: state[i].re * state[j].re + state[i].im * state[j].im,
          im: state[i].im * state[j].re - state[i].re * state[j].im
        };
        rho01 = cAdd(rho01, term);
      }
    }

    const bx = 2 * rho01.re;
    const by = 2 * rho01.im;
    const bz = rho00 - rho11;
    const purity = Math.min(1.0, Math.max(0.0, rho00 * rho00 + rho11 * rho11 + 2 * (rho01.re * rho01.re + rho01.im * rho01.im)));

    qubits.push({
      index: q,
      bloch: [bx, by, bz],
      purity
    });
  }

  // Simple ASCII circuit diagram
  let circuit_text = "";
  for (let q = 0; q < nQubits; q++) {
    circuit_text += `q_${q}: `;
    const qGates = sortedGates.filter((g) => (g.qubits || []).includes(q));
    if (qGates.length === 0) {
      circuit_text += "─── (idle) ───\n";
    } else {
      qGates.forEach((g) => {
        if ((g.qubits || []).length === 2) {
          const isCtrl = g.qubits[0] === q;
          circuit_text += isCtrl ? "──■──" : `──${g.gate === "CX" ? "X" : g.gate}──`;
        } else {
          circuit_text += `──[${g.gate}]──`;
        }
      });
      circuit_text += "\n";
    }
  }

  const clientMetrics = calculateCircuitMetrics(nQubits, sortedGates);

  return {
    num_qubits: nQubits,
    depth: clientMetrics.depth,
    size: clientMetrics.size,
    num_nonlocal: clientMetrics.twoQubitGates,
    ops_count: clientMetrics.opsCount,
    statevector: state,
    basis_labels,
    probabilities,
    counts,
    qubits,
    circuit_text,
    unitary: null
  };
}

async function runCircuit() {
  const btn = document.getElementById("runCircuitBtn");
  btn.disabled = true;
  btn.textContent = "Running…";
  try {
    const gates = placedGates.map((g) => ({ gate: g.gate, qubits: g.qubits, step: g.step, theta: g.theta }));
    let result;
    try {
      result = await apiPost("/circuit/run", { num_qubits: numQubits, gates });
    } catch (apiErr) {
      console.warn("Backend offline or request failed; executing client-side simulation:", apiErr);
      result = simulateCircuitClient(numQubits, gates);
    }
    renderCircuitResult(result);
  } catch (e) {
    alert("Simulation note: " + e.message);
  } finally {
    btn.disabled = false;
    btn.textContent = "Run circuit";
  }
}

function renderCircuitResult(result) {
  document.getElementById("builderResults").hidden = false;

  const metrics = calculateCircuitMetrics(numQubits, placedGates);
  const depth = result.depth ?? metrics.depth;
  const size = result.size ?? metrics.size;
  const numNonlocal = result.num_nonlocal ?? metrics.twoQubitGates;
  const ops = (result.ops_count && Object.keys(result.ops_count).length > 0)
    ? result.ops_count
    : metrics.opsCount;

  // Header quick pills
  const quickStats = document.getElementById("resultsQuickStats");
  if (quickStats) {
    quickStats.innerHTML = `
      <span class="stat-pill"><span class="stat-lbl">DEPTH</span> <span class="stat-val highlight">${depth}</span></span>
      <span class="stat-pill"><span class="stat-lbl">SIZE</span> <span class="stat-val">${size}</span></span>
      <span class="stat-pill"><span class="stat-lbl">2Q</span> <span class="stat-val">${numNonlocal}</span></span>
    `;
  }

  // Circuit Complexity & Metrics Banner
  const banner = document.getElementById("circuitMetricsBanner");
  if (banner) {
    const opsEntries = Object.entries(ops);
    const opsTagsHtml = opsEntries.length > 0
      ? opsEntries.map(([k, v]) => `<span class="metric-op-tag">${k}: ${v}</span>`).join("")
      : `<span class="metric-card-sub">None placed</span>`;

    banner.innerHTML = `
      <div class="metric-card">
        <div class="metric-card-title">Circuit Depth</div>
        <div class="metric-card-value">${depth}</div>
        <div class="metric-card-sub">Parallel critical path layers</div>
      </div>
      <div class="metric-card">
        <div class="metric-card-title">Circuit Size</div>
        <div class="metric-card-value">${size}</div>
        <div class="metric-card-sub">Total quantum gate count</div>
      </div>
      <div class="metric-card">
        <div class="metric-card-title">Register Width</div>
        <div class="metric-card-value">${numQubits}Q</div>
        <div class="metric-card-sub">${metrics.activeQubits} active qubit wires</div>
      </div>
      <div class="metric-card">
        <div class="metric-card-title">Entangling (2Q)</div>
        <div class="metric-card-value">${numNonlocal}</div>
        <div class="metric-card-sub">Non-local CX/CZ/SWAP</div>
      </div>
      <div class="metric-card">
        <div class="metric-card-title">Gate Density</div>
        <div class="metric-card-value">${metrics.density}</div>
        <div class="metric-card-sub">Execution capacity fill</div>
      </div>
      <div class="metric-card" style="grid-column: span 2;">
        <div class="metric-card-title">Ops Breakdown</div>
        <div class="metric-ops-tags">${opsTagsHtml}</div>
      </div>
    `;
  }

  const ketParts = (result.statevector || [])
    .map((amp, i) => `(${fmtComplex(amp)})|${result.basis_labels[i]}⟩`)
    .filter((_, i) => Math.hypot(result.statevector[i].re, result.statevector[i].im) > 1e-4);
  document.getElementById("circuitKet").textContent = "|ψ⟩ = " + (ketParts.join(" + ") || "0");

  const probWrap = document.getElementById("circuitProbBars");
  probWrap.innerHTML = "";
  if (result.probabilities) {
    Object.entries(result.probabilities)
      .sort((a, b) => b[1] - a[1])
      .forEach(([label, p]) => probWrap.appendChild(makeProbRow(`|${label}⟩`, p)));
  }

  const countsWrap = document.getElementById("circuitCounts");
  countsWrap.innerHTML = "";
  if (result.counts) {
    const total = Object.values(result.counts).reduce((a, b) => a + b, 0);
    Object.entries(result.counts)
      .sort((a, b) => b[1] - a[1])
      .forEach(([label, n]) => countsWrap.appendChild(makeProbRow(`|${label}⟩`, n / total)));
  }

  const blochRow = document.getElementById("circuitBlochRow");
  blochRow.innerHTML = "";
  (result.qubits || []).forEach((qinfo) => {
    const mini = document.createElement("div");
    mini.className = "bloch-mini";
    const canvasWrap = document.createElement("div");
    canvasWrap.className = "canvas-wrap";
    mini.appendChild(canvasWrap);
    const caption = document.createElement("div");
    caption.className = "caption";
    caption.textContent = `q${qinfo.index} · purity ${qinfo.purity.toFixed(2)}`;
    mini.appendChild(caption);
    blochRow.appendChild(mini);
    const sphere = createBlochSphere(canvasWrap);
    sphere.setVector(...qinfo.bloch);
  });

  document.getElementById("circuitText").textContent = result.circuit_text || "";

  const unitaryBox = document.getElementById("circuitUnitary");
  unitaryBox.innerHTML = "";
  if (result.unitary) {
    unitaryBox.appendChild(renderMatrixTable(result.unitary));
  } else {
    unitaryBox.innerHTML = `<span class="hint">Circuit has too many qubits (or is empty) to display the full 2ⁿ×2ⁿ unitary here.</span>`;
  }
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

(async function init() {
  try {
    renderGateLibrary();
    renderBasicGateButtons();
    renderPaletteChips();
    initPresets();
  } catch (err) {
    console.error("Error rendering UI panels:", err);
  }

  try {
    basicsBloch = createBlochSphere(document.getElementById("blochBasicsWrap"));
  } catch (err) {
    console.error("Error initializing Bloch sphere:", err);
  }

  try {
    await recomputeBasics();
  } catch (err) {
    console.error("Error in recomputeBasics:", err);
  }

  try {
    buildCircuitGrid();
  } catch (err) {
    console.error("Error building circuit grid:", err);
  }

  // Probe backend and hydrate
  try {
    await checkConnection();
  } catch (err) {
    console.error("Error checking connection:", err);
  }
  setInterval(checkConnection, 8000);

  try {
    await loadGateCatalog();
  } catch (e) {
    console.warn("Could not load gate catalog from backend:", e);
  }
})();
