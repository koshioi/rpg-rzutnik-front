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
  const [tool, setTool] = useState("pen"); // 'pen' | 'brush' | 'eraser'
  const [size, setSize] = useState(3); // 1..16
  const lastPt = useRef(null);

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
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, w, h);
    const step = 32;
    ctx.beginPath();
    ctx.lineWidth = 1;
    ctx.strokeStyle = "#e5e7eb";
    for (let x = 0; x <= w; x += step) { ctx.moveTo(x + 0.5, 0); ctx.lineTo(x + 0.5, h); }
    for (let y = 0; y <= h; y += step) { ctx.moveTo(0, y + 0.5); ctx.lineTo(w, y + 0.5); }
    ctx.stroke();
  };

  useEffect(() => {
    const addItem = (item) => {
      const key = `${item.timestamp}|${item.playerName}|${item.sumAll || 0}|${item.naturalSuccesses || 0}`;
      if (seenRef.current.has(key)) return;
      seenRef.current.add(key);
      setLog((prev) => [item, ...prev]);
    };

    // Socket.IO connection
    const s = io(SOCKET_URL, { transports: ["websocket","polling"], autoConnect: true, withCredentials: false });
    socketRef.current = s;

    s.on("connect", () => { setConnected(true); });
    s.on("disconnect", () => setConnected(false));
    s.on("connect_error", () => setConnected(false));

    s.on("history", (items) => {
      // rebuild seen set and log
      const newSeen = new Set();
      items.forEach((it) => {
        const k = `${it.timestamp}|${it.playerName}|${it.sumAll || 0}|${it.naturalSuccesses || 0}`;
        newSeen.add(k);
      });
      seenRef.current = newSeen;
      setLog(items);
      // also broadcast to other tabs
      bcRef.current?.postMessage({ type: 'history', items });
    });

    s.on("roll:new", (item) => {
      addItem(item);
      bcRef.current?.postMessage({ type: 'roll:new', item });
    });

    // BroadcastChannel for same-origin tabs
    const bc = new BroadcastChannel('dice-roller');
    bcRef.current = bc;
    bc.onmessage = (ev) => {
      const { type, item, items } = ev.data || {};
      if (type === 'roll:new' && item) addItem(item);
      if (type === 'history' && Array.isArray(items)) {
        const newSeen = new Set();
        items.forEach((it) => newSeen.add(`${it.timestamp}|${it.playerName}|${it.sumAll || 0}|${it.naturalSuccesses || 0}`));
        seenRef.current = newSeen;
        setLog(items);
      }
      if (type === 'session:new') {
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
    bcRef.current?.postMessage({ type: 'session:new' });
    setLog([]);
  };

  const clearLog = () => setLog([]);

  return (
    <div className="h-screen w-screen grid grid-cols-5 bg-gradient-to-br from-slate-50 to-slate-200">
      {/* Left panel: 1/5 width */}
      <div className="col-span-1 border-r bg-white/80 backdrop-blur flex flex-col min-w-[300px]">
        <div className="p-3 space-y-3 overflow-y-auto">
          <h1 className="text-xl font-bold tracking-tight">Rzutnik RPG</h1>
          <div className="flex items-center gap-2 text-xs">
            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border ${connected ? 'border-green-600 text-green-700' : 'border-red-600 text-red-700'}`}>
              <span className={`w-2 h-2 rounded-full ${connected ? 'bg-green-600' : 'bg-red-600'}`}></span>
              {connected ? 'Połączono z serwerem' : 'Tryb solo – brak połączenia'}
            </span>
            <span className="text-gray-500">Panel = 1/5 szerokości, wyniki poniżej.</span>
          </div>

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
            disabled={!playerName.trim()}
            className="w-full py-2 rounded-xl bg-gray-900 text-white font-semibold hover:bg-black disabled:opacity-50"
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

          <div ref={logRef} className="rounded-xl border bg-white/80 p-2 h-[45vh] overflow-y-auto">
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
      <div className="col-span-4">
        <GridCanvas />
      </div>
    </div>
  );
}
