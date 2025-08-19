import React, {
  useEffect,
  useMemo,
  useRef,
  useState,
  forwardRef,
  useImperativeHandle,
} from "react";
import { io } from "socket.io-client";

// --- Config ---------------------------------------------------------------
const SOCKET_URL = import.meta.env?.VITE_SOCKET_URL || "http://localhost:3001";

// --- Helpers ---------------------------------------------------------------
const clamp = (v, min, max) => Math.max(min, Math.min(max, Number(v) || 0));
const d10 = () => Math.floor(Math.random() * 10) + 1; // 1..10
const timeStr = (d) =>
  d.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
const uid = () => Math.random().toString(36).slice(2) + Date.now().toString(36);
const getExt = (name) =>
  name.includes(".") ? name.split(".").pop().toLowerCase() : "";

// --- Number Picker ---------------------------------------------------------
function NumberPicker({
  label,
  min = 0,
  max = 20,
  value,
  setValue,
  quick = [],
  disabled = false,
  rowSize = 10,
}) {
  const q = quick.length
    ? quick
    : Array.from({ length: max - min + 1 }, (_, i) => i + min);
  const gridCols = rowSize === 10 ? "grid-cols-10" : "grid-cols-5";
  return (
    <div className="mb-3">
      {/* label + input in one line */}
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-semibold text-gray-600">{label}</span>
        <input
          type="number"
          className="w-24 rounded-md border px-2 py-1 text-sm disabled:opacity-50 disabled:cursor-not-allowed"
          min={min}
          max={max}
          disabled={disabled}
          value={value}
          onChange={(e) => setValue(clamp(e.target.value, min, max))}
        />
      </div>
      {/* quick buttons */}
      <div className={`mt-2 grid ${gridCols} gap-1`}>
        {q.map((n) => (
          <button
            key={n}
            type="button"
            onClick={() => setValue(n)}
            disabled={disabled}
            className={`px-2 py-1 rounded-md text-xs border text-center disabled:opacity-50 disabled:cursor-not-allowed ${
              value === n ? "bg-gray-900 text-white" : "hover:bg-gray-100"
            }`}
            aria-label={`${label} ${n}`}
          >
            {n}
          </button>
        ))}
      </div>
    </div>
  );
}

// --- Right board: grid + bg + collaborative drawing -----------------------
const DrawingBoard = forwardRef(function DrawingBoard(
  {
    strokes,
    onStrokeComplete,
    clearSignal,
    color,
    size,
    mode,
    bgDataUrl,
    showGrid,
    gridStep,
    gridOpacity,
  },
  ref
) {
  // canvases
  const bgRef = useRef(null); // background image
  const gridRef = useRef(null); // grid
  const drawRef = useRef(null); // persistent strokes
  const liveRef = useRef(null); // current stroke preview
  const stageRef = useRef(null);

  const bgImgRef = useRef(null);

  // Load background image when dataUrl changes
  useEffect(() => {
    if (!bgDataUrl) {
      bgImgRef.current = null;
      redrawAll();
      return;
    }
    const img = new Image();
    img.onload = () => {
      bgImgRef.current = img;
      redrawAll();
    };
    img.src = bgDataUrl;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bgDataUrl]);

  // resize & DPR handling
  const resizeAll = () => {
    const stage = stageRef.current;
    if (!stage) return;
    const rect = stage.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;

    for (const c of [bgRef.current, gridRef.current, drawRef.current, liveRef.current]) {
      if (!c) continue;
      c.width = Math.floor(rect.width * dpr);
      c.height = Math.floor(rect.height * dpr);
      c.style.width = `${Math.floor(rect.width)}px`;
      c.style.height = `${Math.floor(rect.height)}px`;
      const ctx = c.getContext("2d");
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
    }
    redrawAll();
  };

  const drawBackground = () => {
    const c = bgRef.current;
    if (!c) return;
    const ctx = c.getContext("2d");
    const w = c.width / (window.devicePixelRatio || 1);
    theight: {
    }
    const h = c.height / (window.devicePixelRatio || 1);
    ctx.clearRect(0, 0, w, h);
    const img = bgImgRef.current;
    if (!img) return;
    // fit: contain, centered
    const scale = Math.min(w / img.naturalWidth, h / img.naturalHeight);
    const dw = img.naturalWidth * scale;
    const dh = img.naturalHeight * scale;
    const dx = Math.floor((w - dw) / 2);
    const dy = Math.floor((h - dh) / 2);
    ctx.drawImage(img, dx, dy, dw, dh);
  };

  const drawGridTo = (ctx, w, h, stepCssPx, opacity, devicePx = false) => {
    const dpr = window.devicePixelRatio || 1;
    const step = devicePx ? stepCssPx * dpr : stepCssPx;
    ctx.save();
    ctx.globalAlpha = clamp(opacity, 0, 1);
    ctx.beginPath();
    ctx.lineWidth = 1;
    ctx.strokeStyle = "#e5e7eb";
    for (let x = 0; x <= w; x += step) {
      const xx = Math.round(x) + 0.5;
      ctx.moveTo(xx, 0);
      ctx.lineTo(xx, h);
    }
    for (let y = 0; y <= h; y += step) {
      const yy = Math.round(y) + 0.5;
      ctx.moveTo(0, yy);
      ctx.lineTo(w, yy);
    }
    ctx.stroke();
    ctx.restore();
  };

  const drawGrid = () => {
    const c = gridRef.current;
    if (!c) return;
    const ctx = c.getContext("2d");
    const w = c.width / (window.devicePixelRatio || 1);
    const h = c.height / (window.devicePixelRatio || 1);
    ctx.clearRect(0, 0, w, h);
    if (!showGrid) return;
    drawGridTo(ctx, w, h, gridStep, gridOpacity, false);
  };

  const drawStroke = (ctx, stroke) => {
    if (!stroke.points || stroke.points.length < 2) return;
    ctx.save();
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.lineWidth = stroke.size;
    if (stroke.mode === "erase") {
      ctx.globalCompositeOperation = "destination-out";
      ctx.strokeStyle = "rgba(0,0,0,1)";
    } else {
      ctx.globalCompositeOperation = "source-over";
      ctx.strokeStyle = stroke.color || "#000";
    }
    ctx.beginPath();
    const pts = stroke.points;
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) {
      ctx.lineTo(pts[i].x, pts[i].y);
    }
    ctx.stroke();
    ctx.restore();
  };

  const redrawAllStrokes = () => {
    const c = drawRef.current;
    if (!c) return;
    const ctx = c.getContext("2d");
    const w = c.width / (window.devicePixelRatio || 1);
    const h = c.height / (window.devicePixelRatio || 1);
    ctx.clearRect(0, 0, w, h);
    for (const s of strokes) drawStroke(ctx, s);
  };

  const redrawAll = () => {
    drawBackground();
    drawGrid();
    redrawAllStrokes();
  };

  // handle window resizing
  useEffect(() => {
    resizeAll();
    const onResize = () => resizeAll();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showGrid, gridStep, gridOpacity]);

  // redraw when strokes change
  useEffect(() => {
    redrawAllStrokes();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [strokes]);

  // clear external signal
  useEffect(() => {
    if (!clearSignal) return;
    const c = drawRef.current;
    if (!c) return;
    const ctx = c.getContext("2d");
    const w = c.width / (window.devicePixelRatio || 1);
    const h = c.height / (window.devicePixelRatio || 1);
    ctx.clearRect(0, 0, w, h);
    const l = liveRef.current;
    if (l) {
      const lctx = l.getContext("2d");
      lctx.clearRect(0, 0, w, h);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clearSignal]);

  // pointer drawing
  const drawingRef = useRef(false);
  const currentPointsRef = useRef([]);

  const getPos = (ev) => {
    const target = liveRef.current;
    const rect = target.getBoundingClientRect();
    const x = (ev.clientX ?? ev.touches?.[0]?.clientX) - rect.left;
    const y = (ev.clientY ?? ev.touches?.[0]?.clientY) - rect.top;
    return { x, y };
  };

  const onPointerDown = (ev) => {
    if (ev.button !== undefined && ev.button !== 0) return;
    drawingRef.current = true;
    currentPointsRef.current = [getPos(ev)];
    const ctx = liveRef.current.getContext("2d");
    drawStroke(ctx, { points: currentPointsRef.current, color, size, mode });
  };
  const onPointerMove = (ev) => {
    if (!drawingRef.current) return;
    currentPointsRef.current.push(getPos(ev));
    const ctx = liveRef.current.getContext("2d");
    const c = liveRef.current;
    const w = c.width / (window.devicePixelRatio || 1);
    const h = c.height / (window.devicePixelRatio || 1);
    ctx.clearRect(0, 0, w, h);
    drawStroke(ctx, { points: currentPointsRef.current, color, size, mode });
  };
  const finishStroke = () => {
    if (!drawingRef.current) return;
    drawingRef.current = false;
    const points = currentPointsRef.current.slice();
    currentPointsRef.current = [];
    const c = liveRef.current;
    const ctxLive = c.getContext("2d");
    const w = c.width / (window.devicePixelRatio || 1);
    const h = c.height / (window.devicePixelRatio || 1);
    ctxLive.clearRect(0, 0, w, h);
    const stroke = { id: uid(), points, color, size, mode };
    // draw permanently
    const ctx = drawRef.current.getContext("2d");
    drawStroke(ctx, stroke);
    onStrokeComplete?.(stroke);
  };
  const onPointerUp = () => finishStroke();
  const onPointerLeave = () => finishStroke();

  // Export PNG (tło + siatka + rysunek)
  useImperativeHandle(ref, () => ({
    exportPNG: () => {
      const dpr = window.devicePixelRatio || 1;
      const draw = drawRef.current;
      if (!draw) return null;
      const w = draw.width; // device px
      const h = draw.height;
      const off = document.createElement("canvas");
      off.width = w;
      off.height = h;
      const ctx = off.getContext("2d");
      // background
      if (bgImgRef.current) {
        const img = bgImgRef.current;
        const scale = Math.min(w / img.naturalWidth, h / img.naturalHeight);
        const dw = img.naturalWidth * scale;
        const dh = img.naturalHeight * scale;
        const dx = Math.floor((w - dw) / 2);
        const dy = Math.floor((h - dh) / 2);
        ctx.drawImage(img, dx, dy, dw, dh);
      }
      // grid
      if (showGrid) {
        drawGridTo(ctx, w, h, gridStep, gridOpacity, true /* device px */);
      }
      // strokes layer
      ctx.drawImage(draw, 0, 0, w, h);
      return off.toDataURL("image/png");
    },
  }));

  return (
    <div className="h-full w-full flex flex-col">
      <div className="relative flex-1 min-h-[60vh]" ref={stageRef}>
        {/* background */}
        <canvas ref={bgRef} className="absolute inset-0 select-none" />
        {/* grid */}
        <canvas ref={gridRef} className="absolute inset-0 select-none" />
        {/* persistent drawing */}
        <canvas ref={drawRef} className="absolute inset-0" />
        {/* live preview */}
        <canvas
          ref={liveRef}
          className="absolute inset-0 cursor-crosshair"
          onMouseDown={onPointerDown}
          onMouseMove={onPointerMove}
          onMouseUp={onPointerUp}
          onMouseLeave={onPointerLeave}
          onTouchStart={(e) => {
            e.preventDefault();
            onPointerDown(e.touches[0]);
          }}
          onTouchMove={(e) => {
            e.preventDefault();
            onPointerMove(e.touches[0]);
          }}
          onTouchEnd={(e) => {
            e.preventDefault();
            finishStroke();
          }}
        />
      </div>
    </div>
  );
});

// --- Dice logic ------------------------------------------------------------
function rollDiceSet(count) {
  return Array.from({ length: count }, d10);
}

function computeRoll({
  diceCount,
  difficulty,
  autoSucc,
  rerollExplode,
  mitigateOnes,
  playerName,
  hidden,
  damageMode,
}) {
  const effDifficulty = damageMode ? 6 : difficulty;
  const effReroll = damageMode ? true : rerollExplode;

  const base = rollDiceSet(diceCount);
  const sumBase = base.reduce((a, b) => a + b, 0);
  const tensBase = base.filter((v) => v === 10).length;
  const onesBase = base.filter((v) => v === 1).length;
  const succBase = base.filter((v) => v >= effDifficulty).length;

  const effMitigate = damageMode ? Math.max(100000, mitigateOnes || 0) : mitigateOnes || 0;
  const mitigated = Math.min(effMitigate, onesBase);
  let onesEffective = Math.max(0, onesBase - mitigated);

  let cancelledRerolls = 0;
  let rerollsToDo = 0;
  let rerollResults = [];
  let succRerolls = 0;

  if (effReroll) {
    cancelledRerolls = Math.min(tensBase, onesEffective);
    rerollsToDo = tensBase - cancelledRerolls;
    onesEffective -= cancelledRerolls;

    let queue = rerollsToDo;
    while (queue > 0) {
      let next = 0;
      for (let i = 0; i < queue; i++) {
        const r = d10();
        rerollResults.push(r);
        if (r >= effDifficulty) succRerolls++;
        if (r === 10) next++;
      }
      queue = next;
    }
  }

  const naturalSuccesses = succBase + succRerolls;
  const sumAll = sumBase + rerollResults.reduce((a, b) => a + b, 0);

  const successesBeforeOnes = naturalSuccesses + autoSucc;
  const finalSuccesses = Math.max(0, successesBeforeOnes - onesEffective);
  let leftoverBadLuck = Math.max(0, onesEffective - successesBeforeOnes);
  if (damageMode) leftoverBadLuck = 0;

  let resultType = "PORAŻKA";
  if (!damageMode && leftoverBadLuck > 0) resultType = "PECH";
  else if (finalSuccesses > 0) resultType = "SUKCES";

  return {
    playerName,
    hidden,
    timestamp: new Date().toISOString(),
    diceCount,
    difficulty: effDifficulty,
    autoSucc,
    baseResults: base,
    rerollResults,
    sumBase,
    sumAll,
    tensBase,
    onesBase,
    mitigated,
    onesEffective,
    cancelledRerolls,
    succBase,
    succRerolls,
    naturalSuccesses,
    successesBeforeOnes,
    finalSuccesses,
    leftoverBadLuck,
    resultType,
    damageMode,
  };
}

// --- Log item --------------------------------------------------------------
function LogCard({ item }) {
  const when = useMemo(() => new Date(item.timestamp), [item.timestamp]);
  const isHidden = item.redacted === true;
  const type = isHidden ? "UKRYTY" : item.resultType;

  const colorMap = {
    SUKCES: {
      text: "text-green-700 font-bold",
      bg: "bg-green-100",
      ring: "ring-green-600",
      border: "border-green-600",
    },
    PORAŻKA: {
      text: "text-amber-800 font-bold",
      bg: "bg-amber-100",
      ring: "ring-amber-700",
      border: "border-amber-700",
    },
    PECH: {
      text: "text-red-700 font-bold",
      bg: "bg-red-100",
      ring: "ring-red-600",
      border: "border-red-600",
    },
    UKRYTY: {
      text: "text-gray-900 font-bold",
      bg: "bg-gray-100",
      ring: "ring-gray-600",
      border: "border-gray-400",
    },
  };
  const c = colorMap[type];
  const fallback = {
    SUKCES: { text: "#166534", bg: "#dcfce7", border: "#16a34a" },
    PORAŻKA: { text: "#92400e", bg: "#fef3c7", border: "#92400e" },
    PECH: { text: "#b91c1c", bg: "#fee2e2", border: "#b91c1c" },
    UKRYTY: { text: "#111827", bg: "#f3f4f6", border: "#9ca3af" },
  }[type];

  const label = isHidden
    ? "RZUT UKRYTY"
    : item.resultType +
      (item.resultType === "SUKCES"
        ? `!(${item.finalSuccesses})`
        : item.resultType === "PECH"
        ? `!(${item.leftoverBadLuck})`
        : "");

  return (
    <div className={`rounded-xl border p-3 bg-white shadow-sm border-l-4 ${c.border}`}>
      {/* NAZWA GRACZA + STATUS W JEDNEJ LINII */}
      <div className="flex items-baseline gap-3 mb-1 flex-nowrap whitespace-nowrap">
        <div className="text-base font-semibold text-gray-900 shrink-0">
          {item.playerName}:
        </div>
        <div
          className={`text-3xl md:text-4xl font-black tracking-tight ${c.text} shrink-0`}
          style={{ color: fallback.text }}
        >
          <span
            className={`inline-block ${c.bg} ${c.text} rounded-lg px-2 py-1`}
            style={{
              background: fallback.bg,
              color: fallback.text,
              border: `1px solid ${fallback.border}`,
            }}
          >
            {label}
          </span>
        </div>
        <div className="text-xs text-gray-500 ml-auto whitespace-nowrap">
          {timeStr(when)}
        </div>
      </div>

      {/* Poziom trudności pod godziną, nad wynikami */}
      {!isHidden && (
        <div className="text-xs text-gray-600 mb-1">
          Poziom trudności: {item.difficulty}
        </div>
      )}

      {isHidden ? (
        <div className="text-xs text-gray-600">
          Szczegóły ukryte — widoczne tylko dla rzucającego.
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
          <div>
            <span className="font-semibold">Wyniki:</span>{" "}
            {item.baseResults.join(", ")}
          </div>
          <div>
            <span className="font-semibold">Przerzuty:</span>{" "}
            {item.rerollResults.length ? item.rerollResults.join(", ") : "—"}
          </div>
          <div>
            <span className="font-semibold">Sukcesy naturalne:</span>{" "}
            {item.naturalSuccesses}
          </div>
          <div>
            <span className="font-semibold">AutoSukcesy:</span>{" "}
            {item.autoSucc}
          </div>
          <div>
            <span className="font-semibold">Jedynek:</span> {item.onesBase}{" "}
            {item.mitigated ? `(–${item.mitigated} niwel.)` : ""} ⇒{" "}
            {item.onesEffective}
          </div>
          <div>
            <span className="font-semibold">Suma kości:</span> {item.sumAll}
          </div>
        </div>
      )}
    </div>
  );
}

// --- Attachments: tile + popup window -------------------------------------
function AttachmentTile({ file, onOpen, onRename, onDelete, onToggleHidden }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(file.name);

  useEffect(() => setName(file.name), [file.name]);

  const isImg = file.type.startsWith("image/");
  const ext = getExt(file.name);

  return (
    <div className="border rounded-lg p-2 shadow-sm hover:shadow transition bg-white flex flex-col">
      <button
        className="relative w-full h-28 rounded-md overflow-hidden border mb-2 bg-gray-50"
        onClick={() => onOpen(file)}
        title="Otwórz w nowym oknie"
      >
        {isImg && !file.hidden ? (
          <img src={file.url} alt={file.name} className="w-full h-full object-contain" />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-xs text-gray-600">
            {file.hidden ? "Ukryty" : file.type || ext?.toUpperCase() || "PLIK"}
          </div>
        )}
      </button>

      {editing ? (
        <div className="flex items-center gap-1">
          <input
            className="flex-1 border rounded px-2 py-1 text-xs"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                onRename(file.id, name.trim() || file.name);
                setEditing(false);
              }
            }}
          />
          <button
            className="text-xs px-2 py-1 border rounded"
            onClick={() => {
              onRename(file.id, name.trim() || file.name);
              setEditing(false);
            }}
          >
            Zapisz
          </button>
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <div className="text-xs font-medium truncate flex-1" title={file.name}>
            {file.name}
          </div>
          {/* Ikona ukryj/pokaż obok nazwy */}
          <button
            className="text-xs px-2 py-1 border rounded"
            onClick={() => onToggleHidden(file.id, !file.hidden)}
            title={file.hidden ? "Pokaż miniaturę" : "Ukryj miniaturę"}
          >
            {file.hidden ? "👁️" : "🙈"}
          </button>
          <button
            className="text-xs px-2 py-1 border rounded"
            onClick={() => setEditing(true)}
            title="Zmień nazwę"
          >
            ✏️
          </button>
        </div>
      )}

      <div className="mt-2">
        <button
          className="text-xs text-red-600 underline"
          onClick={() => onDelete(file.id)}
          title="Usuń"
        >
          Usuń
        </button>
      </div>
    </div>
  );
}

// --- Main App --------------------------------------------------------------
export default function App() {
  // form state
  const [playerName, setPlayerName] = useState(
    () => localStorage.getItem("player-name") || ""
  );
  const [diceCount, setDiceCount] = useState(5);
  const [difficulty, setDifficulty] = useState(6);
  const [autoSucc, setAutoSucc] = useState(0);
  const [rerollExplode, setRerollExplode] = useState(false);
  const [mitigateOnes, setMitigateOnes] = useState(0);
  const [hidden, setHidden] = useState(false);
  const [damageMode, setDamageMode] = useState(false);

  // drawing state
  const [strokes, setStrokes] = useState([]);
  const [drawColor, setDrawColor] = useState("#111827");
  const [drawSize, setDrawSize] = useState(3);
  const [drawMode, setDrawMode] = useState("draw"); // 'draw' | 'erase'
  const [drawClearTick, setDrawClearTick] = useState(0);
  const [bgDataUrl, setBgDataUrl] = useState(
    () => localStorage.getItem("draw-bg") || null
  );
  const [showGrid, setShowGrid] = useState(true);
  const [gridStep, setGridStep] = useState(32);
  const [gridOpacity, setGridOpacity] = useState(1);

  // undo/redo stacks (for this client only)
  const redoStack = useRef([]);
  const [redoCount, setRedoCount] = useState(0);

  const CLIENT_ID = useMemo(() => {
    let id = localStorage.getItem("client-id");
    if (!id) {
      id = uid();
      localStorage.setItem("client-id", id);
    }
    return id;
  }, []);

  const [connected, setConnected] = useState(false); // opcjonalnie do diagnostyki
  const [autoScroll] = useState(true);
  const dialogRef = useRef(null);
  const boardRef = useRef(null);

  // Historia: trzymamy w localStorage aż do Reset
  const [log, setLog] = useState(() => {
    try {
      const raw = localStorage.getItem("dice-log");
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  });

  // Załączniki: localStorage (tylko lokalnie)
  const [files, setFiles] = useState(() => {
    try {
      const raw = localStorage.getItem("attachments");
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  });

  // popup okienka po id
  const popupsRef = useRef({});

  // persist
  useEffect(() => {
    try {
      localStorage.setItem("player-name", playerName || "");
    } catch {}
  }, [playerName]);
  useEffect(() => {
    try {
      localStorage.setItem("dice-log", JSON.stringify(log));
    } catch {}
    if (autoScroll && dialogRef.current) {
      dialogRef.current.scrollTo({ top: 0, behavior: "smooth" });
    }
  }, [log, autoScroll]);
  useEffect(() => {
    try {
      localStorage.setItem("attachments", JSON.stringify(files));
    } catch {}
  }, [files]);
  useEffect(() => {
    if (bgDataUrl) localStorage.setItem("draw-bg", bgDataUrl);
    else localStorage.removeItem("draw-bg");
  }, [bgDataUrl]);

  // damage mode forces difficulty=6 & rerollExplode=true
  useEffect(() => {
    if (damageMode) {
      setDifficulty(6);
      setRerollExplode(true);
    }
  }, [damageMode]);

  const socketRef = useRef(null);
  const bcRef = useRef(null);
  const seenRef = useRef(new Set());

  useEffect(() => {
    const addItem = (item) => {
      const key = `${item.timestamp}|${item.playerName}|${item.sumAll || 0}|${
        item.naturalSuccesses || 0
      }`;
      if (seenRef.current.has(key)) return;
      seenRef.current.add(key);
      setLog((prev) => [item, ...prev]);
    };

    const s = io(SOCKET_URL, {
      transports: ["websocket", "polling"],
      autoConnect: true,
      withCredentials: false,
    });
    socketRef.current = s;
    s.on("connect", () => setConnected(true));
    s.on("disconnect", () => setConnected(false));
    s.on("connect_error", () => setConnected(false));

    // dice
    s.on("history", (items) => {
      items.forEach((it) => {
        const key = `${it.timestamp}|${it.playerName}|${it.sumAll || 0}|${
          it.naturalSuccesses || 0
        }`;
        if (!seenRef.current.has(key)) {
          seenRef.current.add(key);
          setLog((prev) => [it, ...prev]);
        }
      });
      bcRef.current?.postMessage({ type: "history-merge", items });
    });
    s.on("roll:new", (item) => {
      addItem(item);
      bcRef.current?.postMessage({ type: "roll:new", item });
    });

    // drawing
    s.on("draw:stroke", (stroke) => {
      setStrokes((p) => [...p, stroke]);
      bcRef.current?.postMessage({ type: "draw:stroke", stroke });
    });
    s.on("draw:remove", (id) => {
      setStrokes((prev) => {
        const found = prev.find((x) => x.id === id);
        if (found && found.author === CLIENT_ID) {
          redoStack.current.push(found);
          setRedoCount(redoStack.current.length);
        }
        return prev.filter((x) => x.id !== id);
      });
      bcRef.current?.postMessage({ type: "draw:remove", id });
    });
    s.on("draw:clear", () => {
      setStrokes([]);
      setDrawClearTick((t) => t + 1);
      bcRef.current?.postMessage({ type: "draw:clear" });
    });
    s.on("draw:bg", (dataUrl) => {
      setBgDataUrl(dataUrl || null);
      bcRef.current?.postMessage({ type: "draw:bg", dataUrl });
    });

    const bc = new BroadcastChannel("dice-roller");
    bcRef.current = bc;
    bc.onmessage = (ev) => {
      const { type, item, items, stroke, id, dataUrl } = ev.data || {};
      if (type === "roll:new" && item) addItem(item);
      if (type === "history-merge" && Array.isArray(items)) {
        items.forEach((it) => {
          const key = `${it.timestamp}|${it.playerName}|${it.sumAll || 0}|${
            it.naturalSuccesses || 0
          }`;
          if (!seenRef.current.has(key)) {
            seenRef.current.add(key);
            setLog((prev) => [it, ...prev]);
          }
        });
      }
      if (type === "draw:stroke" && stroke) setStrokes((p) => [...p, stroke]);
      if (type === "draw:remove" && id) {
        setStrokes((prev) => {
          const found = prev.find((x) => x.id === id);
          if (found && found.author === CLIENT_ID) {
            redoStack.current.push(found);
            setRedoCount(redoStack.current.length);
          }
          return prev.filter((x) => x.id !== id);
        });
      }
      if (type === "draw:clear") {
        setStrokes([]);
        setDrawClearTick((t) => t + 1);
      }
      if (type === "draw:bg") setBgDataUrl(dataUrl || null);
    };

    return () => {
      s.disconnect();
      bc.close();
    };
  }, [CLIENT_ID]);

  // dice roll handler
  const onRoll = () => {
    if (!playerName.trim()) {
      alert("Podaj nazwę gracza – bez tego nie można wykonać rzutu.");
      return;
    }
    const payload = {
      diceCount: clamp(diceCount, 1, 20),
      difficulty: clamp(difficulty, 1, 20),
      autoSucc: clamp(autoSucc, 0, 5),
      rerollExplode,
      mitigateOnes: damageMode ? 100000 : clamp(mitigateOnes, 0, 5),
      playerName: playerName.trim(),
      hidden,
      damageMode,
    };
    if (hidden) {
      const item = computeRoll(payload);
      setLog((prev) => [item, ...prev]);
      return;
    }
    if (socketRef.current && socketRef.current.connected) {
      socketRef.current.emit("roll:request", payload);
    } else {
      const item = computeRoll(payload);
      setLog((prev) => [item, ...prev]);
    }
  };

  // session / reset
  const onNewSession = () => {
    if (socketRef.current && socketRef.current.connected)
      socketRef.current.emit("session:new");
    bcRef.current?.postMessage({ type: "session:new" });
  };

  const onResetLocal = () => {
    if (
      !confirm(
        "Zresetować lokalną historię rzutów, załączniki, szkic i tło?"
      )
    )
      return;

    // dice
    seenRef.current = new Set();
    setLog([]);
    try {
      localStorage.removeItem("dice-log");
    } catch {}

    // attachments
    setFiles([]);
    try {
      localStorage.removeItem("attachments");
      sessionStorage.removeItem("attachments");
    } catch {}

    // drawing
    setStrokes([]);
    setDrawClearTick((t) => t + 1);
    redoStack.current = [];
    setRedoCount(0);

    // clear bg (local + broadcast + socket)
    setBgDataUrl(null);
    bcRef.current?.postMessage({ type: "draw:clear" });
    bcRef.current?.postMessage({ type: "draw:bg", dataUrl: null });
    if (socketRef.current && socketRef.current.connected) {
      socketRef.current.emit("draw:clear");
      socketRef.current.emit("draw:bg", null);
    }
  };

  // attachments handlers
  const readAsDataURL = (file) =>
    new Promise((res, rej) => {
      const fr = new FileReader();
      fr.onload = () => res(fr.result);
      fr.onerror = rej;
      fr.readAsDataURL(file);
    });

  const onFilesSelected = async (e) => {
    const list = e.target.files;
    if (!list || !list.length) return;
    const added = [];
    for (const file of list) {
      const id = uid();
      const url = await readAsDataURL(file);
      added.push({
        id,
        name: file.name,
        type: file.type || "application/octet-stream",
        url,
        hidden: true,
      });
    }
    setFiles((prev) => [...added, ...prev]);
    e.target.value = "";
  };

  const renameFile = (id, name) =>
    setFiles((prev) => prev.map((f) => (f.id === id ? { ...f, name } : f)));
  const deleteFile = (id) => setFiles((prev) => prev.filter((f) => f.id !== id));
  const toggleHidden = (id, nextHidden) =>
    setFiles((prev) => prev.map((f) => (f.id === id ? { ...f, hidden: nextHidden } : f)));

  // popup viewer
  const openInPopup = (file) => {
    const name = `viewer_${file.id}`;
    const features =
      "popup=yes,width=900,height=700,scrollbars=yes,resizable=yes";
    let w = popupsRef.current[name];
    try {
      if (!w || w.closed) {
        w = window.open("", name, features);
        popupsRef.current[name] = w;
      } else {
        w.focus();
      }
      if (!w) return;
      const isImg = file.type.startsWith("image/");
      const isPdf = file.type === "application/pdf";
      const isVideo = file.type.startsWith("video/");
      const isAudio = file.type.startsWith("audio/");
      const esc = (s) =>
        (s || "").replace(/[&<>"']/g, (m) => ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        }[m]));
      const html = `<!doctype html><html><head><meta charset="utf-8"/><title>${esc(
        file.name
      )}</title><meta name="viewport" content="width=device-width, initial-scale=1"/><style>
        html,body{height:100%;margin:0;background:#111}.wrap{height:100%;display:flex;align-items:center;justify-content:center;background:#111}
        .box{background:#000;padding:8px;border-radius:10px;box-shadow:0 10px 30px rgba(0,0,0,.6);max-width:96vw;max-height:92vh}
        img,video,embed{max-width:95vw;max-height:90vh;display:block}audio{width:90vw}
        .toolbar{position:fixed;top:8px;right:12px;z-index:10}.btn{background:#fff;border:1px solid #ddd;padding:6px 10px;border-radius:8px;font:12px system-ui;cursor:pointer}
      </style></head><body>
      <div class="toolbar"><button class="btn" onclick="window.close()">Zamknij</button></div>
      <div class="wrap"><div class="box">
        ${
          isImg
            ? `<img src="${file.url}" alt="${esc(file.name)}"/>`
            : isPdf
            ? `<embed src="${file.url}" type="application/pdf" />`
            : isVideo
            ? `<video controls src="${file.url}"></video>`
            : isAudio
            ? `<audio controls src="${file.url}"></audio>`
            : `<div style="background:#111;color:#fff;padding:20px;border-radius:8px">Nie można wyświetlić tego typu pliku. <a href="${file.url}" download="${esc(
                file.name
              )}" style="color:#4ea1ff">Pobierz</a></div>`
        }
      </div></div></body></html>`;
      w.document.open();
      w.document.write(html);
      w.document.close();
    } catch (e) {
      console.error(e);
    }
  };

  // drawing handlers
  const handleStrokeComplete = (stroke) => {
    // add author id for undo/redo ownership
    const full = { ...stroke, author: CLIENT_ID };
    setStrokes((p) => [...p, full]);
    // new stroke invalidates redo
    redoStack.current = [];
    setRedoCount(0);
    // broadcast
    bcRef.current?.postMessage({ type: "draw:stroke", stroke: full });
    if (socketRef.current && socketRef.current.connected)
      socketRef.current.emit("draw:stroke", full);
  };

  const clearDrawing = () => {
    setStrokes([]);
    setDrawClearTick((t) => t + 1);
    bcRef.current?.postMessage({ type: "draw:clear" });
    if (socketRef.current && socketRef.current.connected)
      socketRef.current.emit("draw:clear");
  };

  const canUndo = strokes.some((s) => s.author === CLIENT_ID);
  const undo = () => {
    if (!canUndo) return;
    let removed = null;
    setStrokes((prev) => {
      for (let i = prev.length - 1; i >= 0; i--) {
        if (prev[i].author === CLIENT_ID) {
          removed = prev[i];
          return [...prev.slice(0, i), ...prev.slice(i + 1)];
        }
      }
      return prev;
    });
    if (removed) {
      redoStack.current.push(removed);
      setRedoCount(redoStack.current.length);
      bcRef.current?.postMessage({ type: "draw:remove", id: removed.id });
      if (socketRef.current && socketRef.current.connected)
        socketRef.current.emit("draw:remove", removed.id);
    }
  };

  const redo = () => {
    const stroke = redoStack.current.pop();
    setRedoCount(redoStack.current.length);
    if (!stroke) return;
    setStrokes((p) => [...p, stroke]);
    bcRef.current?.postMessage({ type: "draw:stroke", stroke });
    if (socketRef.current && socketRef.current.connected)
      socketRef.current.emit("draw:stroke", stroke);
  };

  const onSetBg = async (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const dataUrl = await readAsDataURL(f);
    setBgDataUrl(dataUrl);
    bcRef.current?.postMessage({ type: "draw:bg", dataUrl });
    if (socketRef.current && socketRef.current.connected)
      socketRef.current.emit("draw:bg", dataUrl);
    e.target.value = "";
  };
  const onClearBg = () => {
    setBgDataUrl(null);
    bcRef.current?.postMessage({ type: "draw:bg", dataUrl: null });
    if (socketRef.current && socketRef.current.connected)
      socketRef.current.emit("draw:bg", null);
  };

  const savePNG = () => {
    const url = boardRef.current?.exportPNG();
    if (!url) return;
    const a = document.createElement("a");
    a.href = url;
    a.download = `rysunek-${new Date()
      .toISOString()
      .replace(/[:.]/g, "-")}.png`;
    a.click();
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-200 overflow-x-hidden">
      {/* Top bar */}
      <div
        className="w-full bg-white/90 border-b sticky top-0 z-20"
        style={{
          position: "sticky",
          top: 0,
          zIndex: 20,
          background: "#ffffffcc",
          backdropFilter: "saturate(180%) blur(4px)",
          borderBottom: "1px solid rgba(0,0,0,0.1)",
        }}
      >
        <div className="max-w-screen-2xl mx-auto px-4 py-2 flex items-center justify-end gap-3">
          <button
            className="text-xs underline"
            onClick={() => {
              navigator.clipboard?.writeText(window.location.href);
            }}
            title="Kopiuj link do tej sesji"
          >
            Kopiuj link
          </button>
          <button
            className="text-xs underline"
            onClick={onNewSession}
            title="Rozpocznij nową sesję (bez czyszczenia lokalnej historii)"
          >
            Nowa sesja
          </button>
          <button
            className="text-xs underline"
            onClick={onResetLocal}
            title="Wyczyść wszystko (historia, załączniki, szkic, tło)"
          >
            Reset
          </button>
        </div>
      </div>

      <div className="grid grid-cols-5 gap-0 min-h-[70vh]">
        {/* Left: controls 1/5 */}
        <div className="col-span-1 border-r bg-white/80 backdrop-blur flex flex-col min-w-[300px]">
          <div className="p-4 space-y-4 flex flex-col">
            {/* Nazwa gracza */}
            <div className="mb-3">
              <div className="flex items-center justify-between gap-2">
                <label className="text-xs font-semibold text-gray-600">
                  Nazwa gracza *
                </label>
                <input
                  value={playerName}
                  onChange={(e) => setPlayerName(e.target.value)}
                  placeholder="np. Anka"
                  className="w-44 md:w-56 rounded-md border px-2 py-1 text-sm"
                />
              </div>
            </div>

            {/* Ilość kości: 1–20 (2x10) */}
            <NumberPicker
              label="Ilość kości"
              min={1}
              max={20}
              value={diceCount}
              setValue={setDiceCount}
              quick={Array.from({ length: 20 }, (_, i) => i + 1)}
              rowSize={10}
            />

            {/* Obrażenia/Wyparowanie */}
            <label className="inline-flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={damageMode}
                onChange={(e) => setDamageMode(e.target.checked)}
              />
              <span>OBRAŻENIA/WYPAROWANIE</span>
            </label>

            {/* PT: 1–10 (2x5) */}
            <NumberPicker
              label="Poziom trudności (PT)"
              min={1}
              max={20}
              value={difficulty}
              setValue={setDifficulty}
              quick={Array.from({ length: 10 }, (_, i) => i + 1)}
              disabled={damageMode}
              rowSize={5}
            />

            {/* Auto-sukcesy */}
            <NumberPicker
              label="Automatyczne sukcesy"
              min={0}
              max={5}
              value={autoSucc}
              setValue={setAutoSucc}
              quick={[0, 1, 2, 3, 4, 5]}
              rowSize={5}
            />

            <div className="flex flex-col gap-3">
              <label className="inline-flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={damageMode ? true : rerollExplode}
                  disabled={damageMode}
                  onChange={(e) =>
                    !damageMode && setRerollExplode(e.target.checked)
                  }
                />
                <span>Przerzut</span>
              </label>

              <NumberPicker
                label="Niwelowanie pecha"
                min={0}
                max={5}
                value={mitigateOnes}
                setValue={setMitigateOnes}
                quick={[0, 1, 2, 3, 4, 5]}
                disabled={damageMode}
                rowSize={5}
              />

              <label className="inline-flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={hidden}
                  onChange={(e) => setHidden(e.target.checked)}
                />
                <span>Rzut ukryty</span>
              </label>
            </div>

            <button
              onClick={onRoll}
              disabled={!playerName.trim()}
              className="w-full py-3 text-lg rounded-2xl bg-gray-900 text-white font-semibold hover:bg-black disabled:opacity-50 disabled:cursor-not-allowed"
              aria-label="Wykonaj rzut"
            >
              RZUT!
            </button>

            {/* Ramka: ostatni wynik + historia (bez duplikatu pierwszego) */}
            <div
              ref={dialogRef}
              className="mt-3 rounded-2xl border-2 border-gray-800 bg-white shadow-xl"
              style={{
                overflowY: "auto",
                resize: "vertical",
                height: "50vh",
                minHeight: "220px",
                maxHeight: "80dvh",
                padding: "8px",
              }}
            >
              {/* Ostatni rzut */}
              <div style={{ padding: "6px" }}>
                {log[0] ? (
                  <LogCard item={log[0]} />
                ) : (
                  <div style={{ fontSize: "12px", color: "#6b7280" }}>
                    Brak wyniku.
                  </div>
                )}
              </div>

              {/* Historia bez powtarzania najnowszego */}
              <div style={{ borderTop: "1px solid #e5e7eb", padding: "8px 6px" }}>
                <div className="space-y-2 pr-1">
                  {log.length <= 1 ? (
                    <div className="text-xs text-gray-500">
                      Brak starszych rzutów.
                    </div>
                  ) : (
                    log
                      .slice(1)
                      .map((item, i) => (
                        <LogCard key={(i + 1) + item.timestamp} item={item} />
                      ))
                  )}
                </div>
              </div>
            </div>

            {/* --- ZAŁĄCZNIKI ------------------------------------------------ */}
            <div className="mt-3">
              <div className="flex items-center justify-between mb-2">
                <div className="text-sm font-semibold">Załączniki</div>
                <label className="text-xs px-3 py-1 border rounded cursor-pointer bg-white hover:bg-gray-50">
                  Dodaj pliki
                  <input type="file" multiple className="hidden" onChange={onFilesSelected} />
                </label>
              </div>

              {files.length === 0 ? (
                <div className="text-xs text-gray-500">
                  Brak plików. Dodaj pierwszy załącznik.
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-2">
                  {files.map((f) => (
                    <AttachmentTile
                      key={f.id}
                      file={f}
                      onOpen={openInPopup}
                      onRename={renameFile}
                      onDelete={deleteFile}
                      onToggleHidden={toggleHidden}
                    />
                  ))}
                </div>
              )}
            </div>

            {/* --- RYSOWANIE (współdzielone) -------------------------------- */}
            <div className="mt-4 border rounded-xl p-3 bg-white shadow-sm">
              <div className="text-sm font-semibold mb-2">Rysowanie</div>
              <div className="flex items-center gap-2 flex-wrap">
                {/* Kolory */}
                {["#111827", "#ef4444", "#3b82f6", "#10b981", "#f59e0b", "#9333ea"].map(
                  (c) => (
                    <button
                      key={c}
                      className="w-7 h-7 rounded-full border"
                      style={{
                        background: c,
                        borderColor:
                          c === drawColor ? "#111827" : "#e5e7eb",
                        boxShadow:
                          c === drawColor ? "0 0 0 2px #111827 inset" : "none",
                      }}
                      title={c}
                      onClick={() => {
                        setDrawColor(c);
                        setDrawMode("draw");
                      }}
                    />
                  )
                )}
                {/* Gumka */}
                <button
                  className={`px-2 py-1 border rounded ${
                    drawMode === "erase" ? "bg-gray-900 text-white" : "bg-white"
                  }`}
                  onClick={() =>
                    setDrawMode((m) => (m === "erase" ? "draw" : "erase"))
                  }
                  title="Gumka"
                >
                  Gumka
                </button>
                {/* Grubość */}
                <label className="text-xs ml-2">Grubość</label>
                <input
                  type="range"
                  min={1}
                  max={24}
                  value={drawSize}
                  onChange={(e) => setDrawSize(clamp(e.target.value, 1, 24))}
                />

                {/* Cofnij / Ponów */}
                <button
                  className={`text-xs px-2 py-1 border rounded ${
                    !strokes.some((s) => s.author === CLIENT_ID)
                      ? "opacity-50 cursor-not-allowed"
                      : ""
                  }`}
                  disabled={!strokes.some((s) => s.author === CLIENT_ID)}
                  onClick={undo}
                >
                  Cofnij
                </button>
                <button
                  className={`text-xs px-2 py-1 border rounded ${
                    redoCount === 0 ? "opacity-50 cursor-not-allowed" : ""
                  }`}
                  disabled={redoCount === 0}
                  onClick={redo}
                >
                  Ponów
                </button>

                {/* Zapisz PNG */}
                <button
                  className="text-xs px-2 py-1 border rounded"
                  onClick={savePNG}
                  title="Zapisz PNG"
                >
                  Zapisz PNG
                </button>

                {/* Siatka */}
                <label className="text-xs inline-flex items-center gap-1 ml-2">
                  <input
                    type="checkbox"
                    checked={showGrid}
                    onChange={(e) => setShowGrid(e.target.checked)}
                  />
                  Siatka
                </label>
                <label className="text-xs ml-2">Krok</label>
                <input
                  type="range"
                  min={8}
                  max={80}
                  step={1}
                  value={gridStep}
                  onChange={(e) => setGridStep(clamp(e.target.value, 8, 80))}
                />
                <label className="text-xs ml-2">Przezr.</label>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={gridOpacity}
                  onChange={(e) => setGridOpacity(Number(e.target.value))}
                />

                {/* Wyczyść szkic (tylko rysunek) */}
                <button
                  className="ml-auto text-xs underline"
                  onClick={clearDrawing}
                  title="Wyczyść wspólny szkic"
                >
                  Wyczyść szkic
                </button>
              </div>

              {/* TŁO */}
              <div className="mt-3 flex items-center gap-2">
                <label className="text-xs px-3 py-1 border rounded cursor-pointer bg-white hover:bg-gray-50">
                  Ustaw tło
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={onSetBg}
                  />
                </label>
                <button
                  className="text-xs px-3 py-1 border rounded"
                  onClick={onClearBg}
                >
                  Usuń tło
                </button>
                <div className="text-xs text-gray-500">
                  {bgDataUrl ? "Tło ustawione (wspólne)" : "Brak tła"}
                </div>
              </div>
            </div>
            {/* ---------------------------------------------------------------- */}
          </div>
        </div>

        {/* Right: board 4/5 */}
        <div className="col-span-4">
          <div className="h-[75vh]">
            <DrawingBoard
              ref={boardRef}
              strokes={strokes}
              onStrokeComplete={handleStrokeComplete}
              clearSignal={drawClearTick}
              color={drawColor}
              size={drawSize}
              mode={drawMode}
              bgDataUrl={bgDataUrl}
              showGrid={showGrid}
              gridStep={gridStep}
              gridOpacity={gridOpacity}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
