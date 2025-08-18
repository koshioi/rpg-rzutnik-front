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
    <div className="mb-3">
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

// --- Canvas with grid + drawing -------------------------------------------
function GridCanvas() {
  const canvasRef = useRef(null);
  const containerRef = useRef(null);
  const [color, setColor] = useState("#111111");
  const [isDrawing, setIsDrawing] = useState(false);
  const lastPt = useRef(null);

  // Resize canvas to container, handle DPR
  const resizeCanvas = () => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;
    const dpr = window.devicePixelRatio || 1;
    const rect = container.getBoundingClientRect();
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

    // clear
    ctx.clearRect(0, 0, w, h);

    // background
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, w, h);

    // grid
    const step = 32;
    ctx.beginPath();
    ctx.lineWidth = 1;
    ctx.strokeStyle = "#e5e7eb"; // gray-200
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
    const obs = new ResizeObserver(resizeCanvas);
    if (containerRef.current) obs.observe(containerRef.current);
    window.addEventListener("resize", resizeCanvas);
    return () => {
      window.removeEventListener("resize", resizeCanvas);
      obs.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleDown = (e) => {
    setIsDrawing(true);
    const rect = canvasRef.current.getBoundingClientRect();
    const x = (e.clientX || e.touches?.[0]?.clientX) - rect.left;
    const y = (e.clientY || e.touches?.[0]?.clientY) - rect.top;
    lastPt.current = { x, y };
  };

  const handleMove = (e) => {
    if (!isDrawing) return;
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX || e.touches?.[0]?.clientX) - rect.left;
    const y = (e.clientY || e.touches?.[0]?.clientY) - rect.top;
    const ctx = canvas.getContext("2d");
    ctx.lineWidth = 2;
    ctx.lineCap = "round";
    ctx.strokeStyle = color;

    ctx.beginPath();
    ctx.moveTo(lastPt.current.x, lastPt.current.y);
    ctx.lineTo(x, y);
    ctx.stroke();

    lastPt.current = { x, y };
  };

  const handleUp = () => setIsDrawing(false);
  const clear = () => drawGrid();

  return (
    <div className="h-full w-full flex flex-col" ref={containerRef}>
      <div className="flex items-center gap-2 p-2 border-b">
        <span className="text-xs text-gray-600">Kolor:</span>
        {["#111111", "#ef4444", "#3b82f6", "#22c55e", "#8b5cf6", "#f59e0b"].map((c) => (
          <button
            key={c}
            className={`w-6 h-6 rounded-full border ${color === c ? "ring-2 ring-offset-2" : ""}`}
            style={{ backgroundColor: c }}
            onClick={() => setColor(c)}
            aria-label={`Wybierz kolor ${c}`}
          />
        ))}
        <button onClick={clear} className="ml-auto text-xs px-2 py-1 border rounded hover:bg-gray-50">
          Wyczyść
        </button>
      </div>
      <canvas
        ref={canvasRef}
        className="flex-1 cursor-crosshair select-none"
        onMouseDown={handleDown}
        onMouseMove={handleMove}
        onMouseUp={handleUp}
        onMouseLeave={handleUp}
        onTouchStart={handleDown}
        onTouchMove={handleMove}
        onTouchEnd={handleUp}
      />
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
  // effective flags for damage mode
  const effDifficulty = damageMode ? 6 : difficulty;
  const effReroll = damageMode ? true : rerollExplode;

  // 1) initial rolls
  const base = rollDiceSet(diceCount);
  const sumBase = base.reduce((a, b) => a + b, 0);
  const tensBase = base.filter((v) => v === 10).length;
  const onesBase = base.filter((v) => v === 1).length;
  const succBase = base.filter((v) => v >= effDifficulty).length;

  // 2) mitigate ones (niwelowanie pecha)
  const mitigated = Math.min(mitigateOnes, onesBase);
  let onesEffective = Math.max(0, onesBase - mitigated);

  // 3) If reroll on: ones first cancel reroll opportunities from 10s, then successes
  let cancelledRerolls = 0;
  let rerollsToDo = 0;
  let rerollResults = [];
  let succRerolls = 0;

  if (effReroll) {
    cancelledRerolls = Math.min(tensBase, onesEffective);
    rerollsToDo = tensBase - cancelledRerolls; // start with remaining rerolls from base 10s
    onesEffective -= cancelledRerolls; // remaining ones will cancel successes later

    // perform exploding rerolls; 1s on rerolls DO NOT cancel anything
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

  // 4) Totals
  const naturalSuccesses = succBase + succRerolls;
  const sumAll = sumBase + rerollResults.reduce((a, b) => a + b, 0);

  // Ones now cancel successes (both base + rerolls), 1-for-1
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
  const colorMap = {
    SUKCES: "text-green-600",
    PORAŻKA: "text-gray-900",
    PECH: "text-red-600",
    UKRYTY: "text-gray-900",
  };
  const isHidden = item.redacted === true;
  const type = isHidden ? "UKRYTY" : item.resultType;
  const label = isHidden
    ? "RZUT UKRYTY"
    : item.resultType + (item.resultType === "SUKCES" ? `!(${item.finalSuccesses})` : item.resultType === "PECH" ? `!(${item.leftoverBadLuck})` : "");

  return (
    <div className="rounded-xl border p-3 bg-white shadow-sm">
      <div className="flex items-baseline gap-2 mb-1">
        <div className={`font-extrabold text-lg ${colorMap[type]}`}>{label}</div>
        <div className="text-xs text-gray-500 ml-auto">{timeStr(when)}</div>
      </div>
      <div className="text-sm text-gray-800 mb-1">
        <span className="font-semibold">{item.playerName}</span>
        {isHidden ? " · (ukryty)" : ` · PT ${item.difficulty} · Kości ${item.diceCount}`}
        {!isHidden && (item.autoSucc ? ` · AutoSukcesy ${item.autoSucc}` : "")}
        {!isHidden && (item.cancelledRerolls ? ` · Jedynki anulowały przerzuty ${item.cancelledRerolls}` : "")}
        {!isHidden && (item.damageMode ? " · Tryb: Obrażenia/Wyparowanie" : "")}
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

  const [log, setLog] = useState(() => {
    try {
      const raw = sessionStorage.getItem("dice-log");
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  });

  const socketRef = useRef(null);

  useEffect(() => {
    try {
      sessionStorage.setItem("dice-log", JSON.stringify(log));
    } catch {}
  }, [log]);

  useEffect(() => {
    if (damageMode) {
      setDifficulty(6);
      setRerollExplode(true);
    }
  }, [damageMode]);

  // Connect to Socket.IO server
  useEffect(() => {
    const s = io(SOCKET_URL, { transports: ["websocket"], autoConnect: true });
    socketRef.current = s;

    s.on("connect", () => {
      // console.log("connected", s.id);
    });

    s.on("history", (items) => {
      // server sends newest first
      setLog(items);
    });

    s.on("roll:new", (item) => {
      setLog((prev) => [item, ...prev]);
    });

    return () => {
      s.disconnect();
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
      mitigateOnes: clamp(mitigateOnes, 0, 5),
      playerName: playerName.trim(),
      hidden,
      damageMode,
    };

    // Ask server to compute & broadcast authoritative result
    if (socketRef.current && socketRef.current.connected) {
      socketRef.current.emit("roll:request", payload);
    } else {
      // fallback: compute locally and just show (single-user)
      const item = computeRoll(payload);
      setLog((prev) => [item, ...prev]);
    }
  };

  const onNewSession = () => {
    const ok = window.confirm('Rozpocząć NOWĄ SESJĘ? Wspólna historia zostanie wyczyszczona dla wszystkich.');
    if (!ok) return;
    if (socketRef.current && socketRef.current.connected) {
      socketRef.current.emit('session:new');
    }
    setLog([]);
  };

  const clearLog = () => setLog([]);

  return (
    <div className="h-screen w-screen grid grid-cols-5">
      {/* Left panel: 1/5 width */}
      <div className="col-span-1 border-r bg-gray-50 flex flex-col min-w-[300px]">
        <div className="p-3 space-y-3 overflow-y-auto">
          <h1 className="text-lg font-bold">Rzutnik RPG</h1>
          <p className="text-xs text-gray-600">Panel zajmuje ~1/5 strony. Wyniki są współdzielone między użytkownikami.</p>

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
          <NumberPicker label="Poziom trudności (PT)" min={1} max={20} value={difficulty} setValue={setDifficulty} quick={[3,4,5,6,7,8,9,10,12,15,20]} disabled={damageMode} />
          <NumberPicker label="Automatyczne sukcesy" min={0} max={5} value={autoSucc} setValue={setAutoSucc} quick={[0,1,2,3,4,5]} />

          <div className="flex flex-col gap-2">
            <label className="inline-flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={damageMode}
                onChange={(e) => setDamageMode(e.target.checked)}
              />
              <span>OBRAŻENIA/WYPAROWANIE (PT=6, przerzut zawsze, bez PECHA)</span>
            </label>
            <label className="inline-flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={damageMode ? true : rerollExplode}
                disabled={damageMode}
                onChange={(e) => !damageMode && setRerollExplode(e.target.checked)}
              />
              <span>Przerzut (10 eksploduje)</span>
            </label>
            <div className="flex items-center gap-2">
              <label className="text-xs font-semibold text-gray-600">Niwelowanie pecha</label>
              <input
                type="number"
                className="w-16 rounded-md border px-2 py-1 text-sm"
                min={0}
                max={5}
                value={mitigateOnes}
                onChange={(e) => setMitigateOnes(clamp(e.target.value, 0, 5))}
              />
              <div className="flex gap-1">
                {[0,1,2,3,4,5].map((n) => (
                  <button key={n} onClick={() => setMitigateOnes(n)} className={`px-2 py-1 rounded-full text-xs border ${mitigateOnes===n?"bg-gray-900 text-white":"hover:bg-gray-100"}`}>{n}</button>
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
            disabled={!playerName.trim()}
            className="w-full py-2 rounded-xl bg-gray-900 text-white font-semibold hover:bg-black disabled:opacity-50"
            aria-label="Wykonaj rzut"
          >
            RZUT!
          </button>

          <div className="flex items-center justify-between mt-2">
            <div className="text-xs text-gray-500">Historia sesji (wspólna)</div>
            <div className="flex items-center gap-3">
              <button className="text-xs underline" onClick={onNewSession} title="Czyści historię dla wszystkich">Nowa sesja</button>
              <button className="text-xs underline" onClick={clearLog} title="Czyści tylko u Ciebie">Wyczyść lokalnie</button>
            </div>
          </div>

          <div className="space-y-2 max-h-[50vh] overflow-y-auto pr-1">
            {log.length === 0 ? (
              <div className="text-xs text-gray-500">Brak rzutów. Wykonaj pierwszy rzut!</div>
            ) : (
              log.map((item, i) => <LogCard key={i + item.timestamp} item={item} />)
            )}
          </div>
        </div>
      </div>

      {/* Right: canvas area 4/5 */}
      <div className="col-span-4">
        <GridCanvas />
      </div>
    </div>
  );
}
