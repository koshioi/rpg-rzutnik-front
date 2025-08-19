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
            <span className="font-semibold">Sukcesy naturalne:</span>{" "}
            {item.naturalSuccesses}
          </div>
          <div>
            <span className="font-semibold">AutoSukcesy:</span> {item.autoSucc}
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
