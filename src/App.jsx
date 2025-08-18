import React, { useEffect, useMemo, useRef, useState } from "react";
import { io } from "socket.io-client";

// --- Config ---------------------------------------------------------------
const SOCKET_URL = import.meta.env?.VITE_SOCKET_URL || "http://localhost:3001";

// --- Helpers ---------------------------------------------------------------
const clamp = (v, min, max) => Math.max(min, Math.min(max, Number(v) || 0));
const d10 = () => Math.floor(Math.random() * 10) + 1; // 1..10
const timeStr = (d) => d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

// --- Number Picker with quick buttons -------------------------------------
function NumberPicker({ label, min = 0, max = 20, value, setValue, quick = [], disabled = false }) {
  const q = quick.length ? quick : Array.from({ length: max - min + 1 }, (_, i) => i + min);
  return (
    <div className="mb-4">
      <label className="block text-xs font-semibold text-gray-600 mb-1">{label}</label>
      <div className="flex gap-2 items-center">
        <input
          type="number"
          className="w-20 rounded-md border px-2 py-1 text-sm disabled:opacity-50 disabled:cursor-not-allowed"
          min={min}
          max={max}
          disabled={disabled}
          value={value}
          onChange={(e) => setValue(clamp(e.target.value, min, max))}
        />
        <div className="flex flex-wrap gap-1">
          {q.map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => setValue(n)}
              disabled={disabled}
              className={`px-2 py-1 rounded-full text-xs border disabled:opacity-50 disabled:cursor-not-allowed ${
                value === n ? "bg-gray-900 text-white" : "hover:bg-gray-100"
              }`}
              aria-label={`${label} ${n}`}
            >
              {n}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// --- Canvas with grid + drawing (pen/brush/eraser) ------------------------
function GridCanvas({ bgUrl }) {
  const canvasRef = useRef(null);
  const stageRef = useRef(null);
  const [color, setColor] = useState("#111111");
  const [isDrawing, setIsDrawing] = useState(false);
  const [tool, setTool] = useState("pen"); // 'pen' | 'brush' | 'eraser'
  const [size, setSize] = useState(3); // 1..16
  const lastPt = useRef(null);

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
    // transparent background; show image below if any
    ctx.clearRect(0, 0, w, h);
    const step = 32;
    ctx.beginPath();
    ctx.lineWidth = 1;
    ctx.strokeStyle = "#e5e7eb";
    for (let x = 0; x <= w; x += step) { ctx.moveTo(x + 0.5, 0); ctx.lineTo(x + 0.5, h); }
    for (let y = 0; y <= h; y += step) { ctx.moveTo(0, y + 0.5); ctx.lineTo(w, y + 0.5); }
    ctx.stroke();
  };

  useEffect(() => {
    resizeCanvas();
    const obs = new ResizeObserver(resizeCanvas);
    if (stageRef.current) obs.observe(stageRef.current);
    window.addEventListener("resize", resizeCanvas);
    return () => { window.removeEventListener("resize", resizeCanvas); obs.disconnect(); };
  }, []);

  const getXY = (e) => {
    const rect = stageRef.current.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const applyTool = (ctx) => {
    ctx.lineCap = "round";
    if (tool === "eraser") {
      ctx.globalCompositeOperation = "destination-out";
      ctx.globalAlpha = 1;
      ctx.lineWidth = Math.max(2, size * 2);
    } else if (tool === "brush") {
      ctx.globalCompositeOperation = "source-over";
      ctx.globalAlpha = 0.6;
      ctx.lineWidth = Math.max(2, size * 2);
      ctx.strokeStyle = color;
    } else {
      ctx.globalCompositeOperation = "source-over";
      ctx.globalAlpha = 1;
      ctx.lineWidth = Math.max(1, size);
      ctx.strokeStyle = color;
    }
  };

  const onPointerDown = (e) => {
    e.preventDefault();
    canvasRef.current.setPointerCapture?.(e.pointerId);
    setIsDrawing(true);
    lastPt.current = getXY(e);
  };

  const onPointerMove = (e) => {
    if (!isDrawing) return;
    e.preventDefault();
    const { x, y } = getXY(e);
    const ctx = canvasRef.current.getContext("2d");
    applyTool(ctx);
    ctx.beginPath();
    ctx.moveTo(lastPt.current.x, lastPt.current.y);
    ctx.lineTo(x, y);
    ctx.stroke();
    lastPt.current = { x, y };
  };

  const onPointerUp = (e) => {
    setIsDrawing(false);
    canvasRef.current.releasePointerCapture?.(e.pointerId);
  };

  const clear = () => drawGrid();

  return (
    <div className="h-full w-full flex flex-col">
      <div className="flex flex-wrap items-center gap-3 p-2 border-b bg-white/80">
        <span className="text-xs text-gray-600">Narzędzia:</span>
        <div className="inline-flex rounded-xl border overflow-hidden">
          <button onClick={() => setTool('pen')} className={`px-3 py-1 text-xs ${tool==='pen'?'bg-gray-900 text-white':'hover:bg-gray-100'}`}>Ołówek</button>
          <button onClick={() => setTool('brush')} className={`px-3 py-1 text-xs ${tool==='brush'?'bg-gray-900 text-white':'hover:bg-gray-100'}`}>Pędzel</button>
          <button onClick={() => setTool('eraser')} className={`px-3 py-1 text-xs ${tool==='eraser'?'bg-gray-900 text-white':'hover:bg-gray-100'}`}>Gumka</button>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-600">Grubość</span>
          <input type="range" min={1} max={16} value={size} onChange={(e)=>setSize(Number(e.target.value))} />
          <div className="text-xs w-6 text-center">{size}</div>
        </div>
        <span className="text-xs text-gray-600">Kolor:</span>
        {["#111111", "#ef4444", "#3b82f6", "#22c55e", "#8b5cf6", "#f59e0b"].map((c) => (
          <button key={c} className={`w-6 h-6 rounded-full border ${color === c ? "ring-2 ring-offset-2" : ""}`} style={{ backgroundColor: c }} onClick={() => setColor(c)} aria-label={`Wybierz kolor ${c}`} />
        ))}
        <button onClick={clear} className="ml-auto text-xs px-2 py-1 border rounded hover:bg-gray-50">Wyczyść</button>
      </div>
      <div className="relative flex-1" ref={stageRef}>
        {bgUrl && <img src={bgUrl} alt="tło" className="absolute inset-0 w-full h-full object-contain pointer-events-none" />}
        <canvas
          ref={canvasRef}
          className="absolute inset-0 cursor-crosshair select-none touch-none"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onPointerLeave={onPointerUp}
        />
      </div>
    </div>
  );
}

// --- Dice logic (client copy — server is authoritative) -------------------
function rollDiceSet(count) {
  const arr = [];
  for (let i = 0; i < count; i++) arr.push(d10());
  return arr;
}

function computeRoll({ diceCount, difficulty, autoSucc, rerollExplode, mitigateOnes, playerName, hidden, damageMode }) {
  const effDifficulty = damageMode ? 6 : difficulty;
  const effReroll = damageMode ? true : rerollExplode;

  // 1) initial rolls
  const base = rollDiceSet(diceCount);
  const sumBase = base.reduce((a, b) => a + b, 0);
  const tensBase = base.filter((v) => v === 10).length;
  const onesBase = base.filter((v) => v === 1).length;
  const succBase = base.filter((v) => v >= effDifficulty).length;

  // 2) mitigate ones (niwelowanie pecha)
  const effMitigate = damageMode ? Math.max(100000, mitigateOnes || 0) : (mitigateOnes || 0);
  const mitigated = Math.min(effMitigate, onesBase);
  let onesEffective = Math.max(0, onesBase - mitigated);

  // 3) If reroll on: ones first cancel reroll opportunities from 10s, then successes
  let cancelledRerolls = 0;
  let rerollsToDo = 0;
  let rerollResults = [];
  let succRerolls = 0;

  if (effReroll) {
    cancelledRerolls = Math.min(tensBase, onesEffective);
    rerollsToDo = tensBase - cancelledRerolls; // remaining rerolls from base 10s
    onesEffective -= cancelledRerolls; // leftover ones will cancel successes later

    // exploding rerolls; 1s on rerolls DO NOT cancel anything
    let queue = rerollsToDo;
    while (queue > 0) {
      let next = 0;
      for (let i = 0; i < queue; i++) {
        const r = d10();
        rerollResults.push(r);
        if (r >= effDifficulty) succRerolls++;
        if (r === 10) next++;
      }
      queue = next; // more explosions
    }
  }

  const naturalSuccesses = succBase + succRerolls;
  const sumAll = sumBase + rerollResults.reduce((a, b) => a + b, 0);

  const successesBeforeOnes = naturalSuccesses + autoSucc;
  const finalSuccesses = Math.max(0, successesBeforeOnes - onesEffective);
  let leftoverBadLuck = Math.max(0, onesEffective - successesBeforeOnes);
  if (damageMode) leftoverBadLuck = 0; // no PECH in damage mode

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
    SUKCES: { text: "text-green-800 font-bold", bg: "bg-green-100", ring: "ring-green-600", border: "border-green-500" },
    PORAŻKA: { text: "text-amber-900 font-bold", bg: "bg-amber-100", ring: "ring-amber-600", border: "border-amber-500" },
    PECH: { text: "text-red-700 font-bold", bg: "bg-red-100", ring: "ring-red-600", border: "border-red-500" },
    UKRYTY: { text: "text-gray-900 font-bold", bg: "bg-gray-100", ring: "ring-gray-600", border: "border-gray-300" },
  };
  const c = colorMap[type];

  const label = isHidden
    ? "RZUT UKRYTY"
    : item.resultType + (item.resultType === "SUKCES" ? `!(${item.finalSuccesses})` : item.resultType === "PECH" ? `!(${item.leftoverBadLuck})` : "");

  return (
    <div className={`rounded-xl border p-3 bg-white shadow-sm border-l-4 ${c.border}`}>
      <div className="flex items-center gap-2 mb-2">
        <div className="text-base font-semibold text-gray-900">{item.playerName}:</div>
        <div className={`text-3xl md:text-4xl font-black tracking-tight ${c.text}`}>
          <span className={`inline-block ${c.bg} ${c.text} ring-1 ${c.ring} rounded-lg px-2 py-1`}>{label}</span>
        </div>
        <div className="text-xs text-gray-500 ml-auto">{timeStr(when)}</div>
      </div>

      {isHidden ? (
        <div className="text-xs text-gray-600">Szczegóły ukryte — widoczne tylko dla rzucającego.</div>
      ) : (
        <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
          <div><span className="font-semibold">Wyniki:</span> {item.baseResults.join(", ")}</div>
          <div><span className="font-semibold">Przerzuty:</span> {item.rerollResults.length ? item.rerollResults.join(", ") : "—"}</div>
          <div><span className="font-semibold">Sukcesy naturalne:</span> {item.naturalSuccesses}</div>
          <div><span className="font-semibold">AutoSukcesy:</span> {item.autoSucc}</div>
          <div><span className="font-semibold">Jedynek:</span> {item.onesBase} {item.mitigated ? `(–${item.mitigated} niwel.)` : ""} ⇒ {item.onesEffective}</div>
          <div><span className="font-semibold">Suma kości:</span> {item.sumAll}</div>
        </div>
      )}
    </div>
  );
}

// --- Main App --------------------------------------------------------------
export default function App() {
  // form state
  const [playerName, setPlayerName] = useState("");
  const [diceCount, setDiceCount] = useState(5);
  const [difficulty, setDifficulty] = useState(6);
  const [autoSucc, setAutoSucc] = useState(0); // 0..5
  const [rerollExplode, setRerollExplode] = useState(false);
  const [mitigateOnes, setMitigateOnes] = useState(0); // 0..5
  const [hidden, setHidden] = useState(false);
  const [damageMode, setDamageMode] = useState(false);

  const [connected, setConnected] = useState(false);
  const [autoScroll, setAutoScroll] = useState(true);
  const logRef = useRef(null);

  const [images, setImages] = useState([]);
  const [activeImage, setActiveImage] = useState(null);

  const [log, setLog] = useState(() => {
    try {
      const raw = sessionStorage.getItem("dice-log");
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  });

  const socketRef = useRef(null);
  const bcRef = useRef(null); // BroadcastChannel for same-origin multi-tab sync
  const seenRef = useRef(new Set()); // de-duplication

  useEffect(() => {
    try {
      sessionStorage.setItem("dice-log", JSON.stringify(log));
    } catch {}
    if (autoScroll && logRef.current) {
      logRef.current.scrollTo({ top: 0, behavior: "smooth" });
    }
  }, [log, autoScroll]);

  useEffect(() => {
    if (damageMode) {
      setDifficulty(6);
      setRerollExplode(true);
    }
  }, [damageMode]);

  // Connect to Socket.IO and BroadcastChannel
  useEffect(() => {
    const addItem = (item) => {
      const key = `${item.timestamp}|${item.playerName}|${item.sumAll || 0}|${item.naturalSuccesses || 0}`;
      if (seenRef.current.has(key)) return;
      seenRef.current.add(key);
      setLog((prev) => [item, ...prev]);
    };

    const s = io(SOCKET_URL, { transports: ["websocket", "polling"], autoConnect: true, withCredentials: false });
    socketRef.current = s;
    s.on("connect", () => setConnected(true));
    s.on("disconnect", () => setConnected(false));
    s.on("connect_error", () => setConnected(false));

    s.on("history", (items) => {
      const newSeen = new Set();
      items.forEach((it) => newSeen.add(`${it.timestamp}|${it.playerName}|${it.sumAll || 0}|${it.naturalSuccesses || 0}`));
      seenRef.current = newSeen;
      setLog(items);
      bcRef.current?.postMessage({ type: "history", items });
    });

    s.on("roll:new", (item) => {
      addItem(item);
      bcRef.current?.postMessage({ type: "roll:new", item });
    });

    const bc = new BroadcastChannel("dice-roller");
    bcRef.current = bc;
    bc.onmessage = (ev) => {
      const { type, item, items } = ev.data || {};
      if (type === "roll:new" && item) addItem(item);
      if (type === "history" && Array.isArray(items)) {
        const newSeen = new Set();
        items.forEach((it) => newSeen.add(`${it.timestamp}|${it.playerName}|${it.sumAll || 0}|${it.naturalSuccesses || 0}`));
        seenRef.current = newSeen;
        setLog(items);
      }
      if (type === "session:new") {
        seenRef.current = new Set();
        setLog([]);
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

    if (!(socketRef.current && socketRef.current.connected)) {
      alert("Brak połączenia z serwerem — tryb solo wyłączony. Upewnij się, że backend działa i adres SOCKET_URL jest poprawny.");
      return;
    }
    socketRef.current.emit("roll:request", payload);
  };

  const onNewSession = () => {
    const ok = window.confirm("Rozpocząć NOWĄ SESJĘ? Wspólna historia zostanie wyczyszczona dla wszystkich.");
    if (!ok) return;
    if (socketRef.current && socketRef.current.connected) {
      socketRef.current.emit("session:new");
    }
    bcRef.current?.postMessage({ type: "session:new" });
    setLog([]);
  };

  const clearLog = () => setLog([]);

  return (
    <div className="h-screen w-screen grid grid-cols-5 bg-gradient-to-br from-slate-50 to-slate-200">
      {/* Left panel: 1/5 width */}
      <div className="col-span-1 border-r bg-white/80 backdrop-blur flex flex-col min-w-[300px]">
        <div className="p-4 space-y-4 overflow-y-auto">
          {/* Nazwa gracza */}
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">Nazwa gracza *</label>
            <input
              value={playerName}
              onChange={(e) => setPlayerName(e.target.value)}
              placeholder="np. Anka"
              className="w-full rounded-md border px-2 py-1 text-sm"
            />
          </div>

          <NumberPicker label="Ilość kości" min={1} max={20} value={diceCount} setValue={setDiceCount} quick={[1,2,3,4,5,6,7,8,9,10,12,15,20]} />

          <label className="inline-flex items-center gap-2 text-sm">
            <input type="checkbox" checked={damageMode} onChange={(e) => setDamageMode(e.target.checked)} />
            <span>OBRAŻENIA/WYPAROWANIE</span>
          </label>

          <NumberPicker label="Poziom trudności (PT)" min={1} max={20} value={difficulty} setValue={setDifficulty} quick={[3,4,5,6,7,8,9,10,12,15,20]} disabled={damageMode} />
          <NumberPicker label="Automatyczne sukcesy" min={0} max={5} value={autoSucc} setValue={setAutoSucc} quick={[0,1,2,3,4,5]} />

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
            <div className="flex items-center gap-3">
              <label className="text-xs font-semibold text-gray-600">Niwelowanie pecha</label>
              <input
                type="number"
                className="w-16 rounded-md border px-2 py-1 text-sm disabled:opacity-50 disabled:cursor-not-allowed"
                min={0}
                max={5}
                value={mitigateOnes}
                disabled={damageMode}
                onChange={(e) => setMitigateOnes(clamp(e.target.value, 0, 5))}
              />
              <div className="flex gap-1">
                {[0,1,2,3,4,5].map((n) => (
                  <button
                    key={n}
                    disabled={damageMode}
                    onClick={() => setMitigateOnes(n)}
                    className={`px-2 py-1 rounded-full text-xs border disabled:opacity-50 disabled:cursor-not-allowed ${mitigateOnes===n?"bg-gray-900 text-white":"hover:bg-gray-100"}`}
                  >
                    {n}
                  </button>
                ))}
              </div>
            </div>
            <label className="inline-flex items-center gap-2 text-sm">
              <input type="checkbox" checked={hidden} onChange={(e) => setHidden(e.target.checked)} />
              <span>Rzut ukryty</span>
            </label>
          </div>

          <button
            onClick={onRoll}
            disabled={!playerName.trim() || !connected}
            className="w-full py-3 text-lg rounded-2xl bg-gray-900 text-white font-semibold hover:bg-black disabled:opacity-50 disabled:cursor-not-allowed"
            aria-label="Wykonaj rzut"
          >
            RZUT!
          </button>

          <div className="flex items-center justify-between mt-2">
            <div className="text-xs text-gray-500">Historia sesji (wspólna)</div>
            <div className="flex items-center gap-3">
              <button className="text-xs underline" onClick={() => { navigator.clipboard?.writeText(window.location.href); }} title="Kopiuj link do tej sesji">Kopiuj link</button>
              <label className="text-xs inline-flex items-center gap-1">
                <input type="checkbox" checked={autoScroll} onChange={(e)=>setAutoScroll(e.target.checked)} /> Auto-scroll
              </label>
              <button className="text-xs underline" onClick={onNewSession} title="Czyści historię dla wszystkich">Nowa sesja</button>
              <button className="text-xs underline" onClick={clearLog} title="Czyści tylko u Ciebie">Wyczyść lokalnie</button>
            </div>
          </div>

          {/* Scrollable results frame */}
          <div ref={logRef} className="rounded-xl border bg-white/80 p-2 h-[60vh] overflow-y-auto">
            <div className="space-y-2">
              {log.length === 0 ? (
                <div className="text-xs text-gray-500">Brak rzutów. Wykonaj pierwszy rzut!</div>
              ) : (
                log.map((item, i) => <LogCard key={i + item.timestamp} item={item} />)
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Right: canvas area 4/5 */}
      <div className="col-span-4 flex flex-col min-h-0">
        <div className="p-2 border-b bg-white/70 flex flex-wrap items-center gap-2">
          <label className="text-xs font-semibold">Wgraj obraz:</label>
          <input
            type="file"
            accept="image/*"
            multiple
            onChange={(e) => {
              const files = Array.from(e.target.files || []);
              const mapped = files.map((f) => ({ name: f.name, url: URL.createObjectURL(f) }));
              setImages((prev) => [...mapped, ...prev]);
              if (!activeImage && mapped[0]) setActiveImage(mapped[0]);
              e.target.value = '';
            }}
          />
          <div className="flex gap-1 flex-wrap">
            {images.map((img, idx) => (
              <button key={idx} onClick={() => setActiveImage(img)} className={`px-2 py-1 rounded border text-xs ${activeImage?.url===img.url? 'bg-gray-900 text-white':'hover:bg-gray-100'}`} title={img.name}>
                {img.name}
              </button>
            ))}
          </div>
        </div>
        <div className="flex-1 min-h-0">
          <GridCanvas bgUrl={activeImage?.url} />
        </div>
      </div>
    </div>
  );
}
