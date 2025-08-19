import React, { useEffect, useMemo, useRef, useState } from "react";
import { io } from "socket.io-client";

// --- Config ---------------------------------------------------------------
const SOCKET_URL = import.meta.env?.VITE_SOCKET_URL || "http://localhost:3001";

// --- Helpers ---------------------------------------------------------------
const clamp = (v, min, max) => Math.max(min, Math.min(max, Number(v) || 0));
const d10 = () => Math.floor(Math.random() * 10) + 1; // 1..10
const timeStr = (d) =>
  d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
const uid = () => Math.random().toString(36).slice(2) + Date.now().toString(36);
const getExt = (name) => (name.includes(".") ? name.split(".").pop().toLowerCase() : "");

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
  const q = quick.length ? quick : Array.from({ length: max - min + 1 }, (_, i) => i + min);
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

// --- Canvas with grid only (no drawing) -----------------------------------
function GridCanvas() {
  const canvasRef = useRef(null);
  const stageRef = useRef(null);

  const resizeCanvas = () => {
    const canvas = canvasRef.current;
    const stage = stageRef.current;
    if (!canvas || !stage) return;
    const dpr = window.devicePixelRatio || 1;
    const rect = stage.getBoundingClientRect();
    canvas.width = Math.floor(rect.width * dpr);
    canvas.height = Math.floor(rect.height * dpr);
    canvas.style.width = `${Math.floor(rect.width)}px`;
    canvas.style.height = `${Math.floor(rect.height)}px`;
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawGrid();
  };

  const drawGrid = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const w = canvas.width / (window.devicePixelRatio || 1);
    const h = canvas.height / (window.devicePixelRatio || 1);
    ctx.clearRect(0, 0, w, h);
    const step = 32;
    ctx.beginPath();
    ctx.lineWidth = 1;
    ctx.strokeStyle = "#e5e7eb";
    for (let x = 0; x <= w; x += step) {
      ctx.moveTo(x + 0.5, 0);
      ctx.lineTo(x + 0.5, h);
    }
    for (let y = 0; y <= h; y += step) {
      ctx.moveTo(0, y + 0.5);
      ctx.lineTo(w, y + 0.5);
    }
    ctx.stroke();
  };

  useEffect(() => {
    resizeCanvas();
    const onResize = () => resizeCanvas();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  return (
    <div className="h-full w-full flex flex-col">
      <div className="relative flex-1 min-h-0" ref={stageRef}>
        <canvas ref={canvasRef} className="absolute inset-0 select-none pointer-events-none" />
      </div>
    </div>
  );
}

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
  // Fallback kolory inline (gdyby Tailwind nie zadziałał)
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
            <span className="font-semibold">Wyniki:</span> {item.baseResults.join(", ")}
          </div>
          <div>
            <span className="font-semibold">Przerzuty:</span>{" "}
            {item.rerollResults.length ? item.rerollResults.join(", ") : "—"}
          </div>
          <div>
            <span className="font-semibold">Sukcesy naturalne:</span> {item.naturalSuccesses}
          </div>
          <div>
            <span className="font-semibold">AutoSukcesy:</span> {item.autoSucc}
          </div>
          <div>
            <span className="font-semibold">Jedynek:</span> {item.onesBase}{" "}
            {item.mitigated ? `(–${item.mitigated} niwel.)` : ""} ⇒ {item.onesEffective}
          </div>
          <div>
            <span className="font-semibold">Suma kości:</span> {item.sumAll}
          </div>
        </div>
      )}
    </div>
  );
}

// --- Attachments: tile + modal --------------------------------------------
function AttachmentTile({ file, onOpen, onRename, onDelete }) {
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
        title="Otwórz podgląd"
      >
        {isImg ? (
          <img src={file.url} alt={file.name} className="w-full h-full object-contain" />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-xs text-gray-600">
            {file.type || ext?.toUpperCase() || "PLIK"}
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

function FloatingViewer({ file, onClose }) {
  const overlayRef = useRef(null);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  if (!file) return null;

  const isImg = file.type.startsWith("image/");
  const isPdf = file.type === "application/pdf";
  const isVideo = file.type.startsWith("video/");
  const isAudio = file.type.startsWith("audio/");

  return (
    <div
      ref={overlayRef}
      className="fixed inset-0 z-50"
      style={{ background: "rgba(0,0,0,0.5)" }}
      onClick={(e) => {
        if (e.target === overlayRef.current) onClose();
      }}
    >
      <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 bg-white rounded-xl shadow-2xl p-3 max-w-[90vw] max-h-[85vh] w-fit">
        <div className="flex items-center justify-between mb-2 gap-4">
          <div className="text-sm font-semibold truncate max-w-[70vw]" title={file.name}>
            {file.name}
          </div>
          <button className="text-sm px-2 py-1 border rounded" onClick={onClose}>
            Zamknij
          </button>
        </div>
        <div className="bg-gray-50 rounded-lg border overflow-hidden flex items-center justify-center">
          {isImg && <img src={file.url} alt={file.name} className="max-w-[88vw] max-h-[75vh] object-contain" />}
          {isPdf && <embed src={file.url} type="application/pdf" className="w-[88vw] h-[75vh]" />}
          {isVideo && <video controls src={file.url} className="max-w-[88vw] max-h-[75vh]" />}
          {isAudio && <audio controls src={file.url} className="w-[80vw]" />}
          {!isImg && !isPdf && !isVideo && !isAudio && (
            <div className="p-6 text-sm">
              Nie można wyświetlić tego typu pliku.{" "}
              <a href={file.url} download={file.name} className="underline text-blue-600">
                Pobierz
              </a>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// --- Main App --------------------------------------------------------------
export default function App() {
  // form state
  const [playerName, setPlayerName] = useState(() => localStorage.getItem("player-name") || "");
  const [diceCount, setDiceCount] = useState(5);
  const [difficulty, setDifficulty] = useState(6);
  const [autoSucc, setAutoSucc] = useState(0);
  const [rerollExplode, setRerollExplode] = useState(false);
  const [mitigateOnes, setMitigateOnes] = useState(0);
  const [hidden, setHidden] = useState(false);
  const [damageMode, setDamageMode] = useState(false);

  const [connected, setConnected] = useState(false);

  // auto-scroll zawsze włączony (bez UI)
  const [autoScroll] = useState(true);

  const dialogRef = useRef(null);

  // Historia: trzymamy w localStorage aż do Reset
  const [log, setLog] = useState(() => {
    try {
      const raw = localStorage.getItem("dice-log");
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  });

  // Załączniki: trzymamy w localStorage (tylko lokalnie u użytkownika)
  const [files, setFiles] = useState(() => {
    try {
      const raw = localStorage.getItem("attachments");
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  });
  const [viewerFile, setViewerFile] = useState(null);

  useEffect(() => {
    try {
      localStorage.setItem("player-name", playerName || "");
    } catch {}
  }, [playerName]);

  // Obrażenia/Wyparowanie wymuszają PT=6 i przerzut zawsze
  useEffect(() => {
    if (damageMode) {
      setDifficulty(6);
      setRerollExplode(true);
    }
  }, [damageMode]);

  // zapisuj historię + auto-scroll do góry ramki
  useEffect(() => {
    try {
      localStorage.setItem("dice-log", JSON.stringify(log));
    } catch {}
    if (autoScroll && dialogRef.current) {
      dialogRef.current.scrollTo({ top: 0, behavior: "smooth" });
    }
  }, [log, autoScroll]);

  // zapisuj listę plików w localStorage
  useEffect(() => {
    try {
      localStorage.setItem("attachments", JSON.stringify(files));
    } catch {}
  }, [files]);

  const socketRef = useRef(null);
  const bcRef = useRef(null);
  const seenRef = useRef(new Set());

  useEffect(() => {
    const addItem = (item) => {
      const key = `${item.timestamp}|${item.playerName}|${item.sumAll || 0}|${item.naturalSuccesses || 0}`;
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

    // NIE nadpisujemy lokalnej historii — dokładamy nowe (do czasu Reset)
    s.on("history", (items) => {
      items.forEach((it) => {
        const key = `${it.timestamp}|${it.playerName}|${it.sumAll || 0}|${it.naturalSuccesses || 0}`;
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

    const bc = new BroadcastChannel("dice-roller");
    bcRef.current = bc;
    bc.onmessage = (ev) => {
      const { type, item, items } = ev.data || {};
      if (type === "roll:new" && item) {
        addItem(item);
      }
      if (type === "history-merge" && Array.isArray(items)) {
        items.forEach((it) => {
          const key = `${it.timestamp}|${it.playerName}|${it.sumAll || 0}|${it.naturalSuccesses || 0}`;
          if (!seenRef.current.has(key)) {
            seenRef.current.add(key);
            setLog((prev) => [it, ...prev]);
          }
        });
      }
      if (type === "session:new") {
        // nowa sesja nie czyści lokalnej historii — tylko sygnał dla innych
      }
    };

    return () => {
      s.disconnect();
      bc.close();
    };
  }, []);

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

    // RZUT UKRYTY: tylko lokalnie (bez socketów i bez BC)
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

  const onNewSession = () => {
    if (socketRef.current && socketRef.current.connected) {
      socketRef.current.emit("session:new");
    }
    bcRef.current?.postMessage({ type: "session:new" });
    // nie czyścimy lokalnej historii – trzyma się do czasu „Reset”
  };

  const onResetLocal = () => {
    if (!confirm("Zresetować lokalną historię rzutów i załączniki?")) return;

    // reset historii rzutów
    seenRef.current = new Set();
    setLog([]);
    try {
      localStorage.removeItem("dice-log");
    } catch {}

    // reset załączników (localStorage + ewentualne stare z sessionStorage)
    setFiles([]);
    try {
      localStorage.removeItem("attachments");
      sessionStorage.removeItem("attachments");
    } catch {}
  };

  // --- Attachments handlers ------------------------------------------------
  const onFilesSelected = async (e) => {
    const list = e.target.files;
    if (!list || !list.length) return;
    const added = [];
    for (const file of list) {
      const id = uid();
      const url = await readAsDataURL(file);
      added.push({ id, name: file.name, type: file.type || "application/octet-stream", url });
    }
    setFiles((prev) => [...added, ...prev]);
    e.target.value = "";
  };

  const readAsDataURL = (file) =>
    new Promise((res, rej) => {
      const fr = new FileReader();
      fr.onload = () => res(fr.result);
      fr.onerror = rej;
      fr.readAsDataURL(file);
    });

  const renameFile = (id, name) => setFiles((prev) => prev.map((f) => (f.id === id ? { ...f, name } : f)));
  const deleteFile = (id) => setFiles((prev) => prev.filter((f) => f.id !== id));

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-200 overflow-x-hidden">
      {/* Górny pasek z przyciskami (bez napisu i bez auto-scroll) */}
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
          <button className="text-xs underline" onClick={onResetLocal} title="Wyczyść lokalną historię i załączniki">
            Reset
          </button>
        </div>
      </div>

      <div className="grid grid-cols-5 gap-0 min-h-[70vh]">
        {/* Left: controls 1/5 */}
        <div className="col-span-1 border-r bg-white/80 backdrop-blur flex flex-col min-w-[300px]">
          <div className="p-4 space-y-4 flex flex-col">
            {/* Nazwa gracza (zapamiętywana) */}
            <div className="mb-3">
              <div className="flex items-center justify-between gap-2">
                <label className="text-xs font-semibold text-gray-600">Nazwa gracza *</label>
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

            {/* PT: tylko szybkie guziki 1–10 (2x5), pole może wpisać >10 */}
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
                  onChange={(e) => !damageMode && setRerollExplode(e.target.checked)}
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
                <input type="checkbox" checked={hidden} onChange={(e) => setHidden(e.target.checked)} />
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
                  <div style={{ fontSize: "12px", color: "#6b7280" }}>Brak wyniku.</div>
                )}
              </div>

              {/* Historia bez powtarzania najnowszego */}
              <div style={{ borderTop: "1px solid #e5e7eb", padding: "8px 6px" }}>
                <div className="space-y-2 pr-1">
                  {log.length <= 1 ? (
                    <div className="text-xs text-gray-500">Brak starszych rzutów.</div>
                  ) : (
                    log.slice(1).map((item, i) => <LogCard key={(i + 1) + item.timestamp} item={item} />)
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
                <div className="text-xs text-gray-500">Brak plików. Dodaj pierwszy załącznik.</div>
              ) : (
                <div className="grid grid-cols-2 gap-2">
                  {files.map((f) => (
                    <AttachmentTile
                      key={f.id}
                      file={f}
                      onOpen={setViewerFile}
                      onRename={renameFile}
                      onDelete={deleteFile}
                    />
                  ))}
                </div>
              )}
            </div>
            {/* ---------------------------------------------------------------- */}
          </div>
        </div>

        {/* Right: canvas area 4/5 */}
        <div className="col-span-4">
          <div className="h-[75vh]">
            <GridCanvas />
          </div>
        </div>
      </div>

      {/* Floating viewer (modal) */}
      <FloatingViewer file={viewerFile} onClose={() => setViewerFile(null)} />
    </div>
  );
}
