export function SeatLegend() {
  const items = [
    { label: 'Disponible', color: 'bg-blue-500' },
    { label: 'Seleccionado', color: 'bg-green-500' },
    { label: 'Reservado', color: 'bg-red-500' },
    { label: 'Bloqueado', color: 'bg-amber-500' },
    { label: 'Guía', color: 'bg-green-800' },
  ];

  return (
    <div className="flex flex-wrap gap-4 justify-center">
      {items.map((item) => (
        <div key={item.label} className="flex items-center gap-2">
          <div className={`w-5 h-5 rounded ${item.color}`} />
          <span className="text-sm text-gray-600">{item.label}</span>
        </div>
      ))}
    </div>
  );
}
