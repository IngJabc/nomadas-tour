export function SeatLegend() {
  const items = [
    { label: "Disponible", color: "#00D4FF" },
    { label: "Seleccionado", color: "#f59e0b" },
    { label: "Reservado", color: "#374151" },
    { label: "Bloqueado", color: "#7c3aed" },
    { label: "Guía", color: "#1e3a5f" }, // <-- Color azul marino para hacer match con el asiento
  ];

  return (
    <div className="w-full flex flex-wrap gap-4 items-center justify-center">
      {items.map((item) => (
        <div key={item.label} className="flex items-center gap-3">
          <div
            className="w-2.5 h-2.5 rounded-full"
            style={{ background: item.color }}
          />
          <span className="font-['Poppins',sans-serif] font-normal text-[13px] text-brand-muted">
            {item.label}
          </span>
        </div>
      ))}
    </div>
  );
}
