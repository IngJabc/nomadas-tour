export function SeatLegend() {
  const items = [
    { label: 'Disponible', color: '#08a7bc' },
    { label: 'Seleccionado', color: '#f59e0b' },
    { label: 'Reservado', color: '#6b7280' },
    { label: 'Bloqueado', color: '#f97316' },
    { label: 'Guía', color: 'var(--color-brand-dark)' },
  ];

  return (
    <div className="w-full flex flex-wrap gap-4 items-center justify-center">
      {items.map((item) => (
        <div key={item.label} className="flex items-center gap-3">
          <div
            className="rounded-full"
            style={{ width: 10, height: 10, background: item.color }}
          />
          <span style={{ fontFamily: 'var(--font-sans)', fontWeight: 400, fontSize: 13, color: 'var(--color-brand-muted)' }}>{item.label}</span>
        </div>
      ))}
    </div>
  );
}
