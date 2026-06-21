export function SeatLegend() {
  const items = [
    { label: "Disponible", color: "#00D4FF" },
    { label: "Seleccionado", color: "#f59e0b" },
    { label: "Reservado", color: "#374151" },
    { label: "Bloqueado", color: "#7c3aed" },
    { label: "Guía", color: "#166534" },
  ];

  return (
    <div className="w-full flex flex-wrap gap-x-4 gap-y-2 items-center justify-center">
      {items.map((item) => (
        <div key={item.label} className="flex items-center gap-2">
          <div
            className="w-2.5 h-2.5 rounded-full shrink-0"
            style={{ background: item.color }}
          />
          <span className="font-['Poppins',sans-serif] font-normal text-[12px] sm:text-[13px] text-brand-muted whitespace-nowrap">
            {item.label}
          </span>
        </div>
      ))}
    </div>
  );
}
