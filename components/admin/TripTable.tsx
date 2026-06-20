'use client';

import { Trip } from '@/types';
import { formatDateTime, formatPrice } from '@/lib/utils';

interface TripTableProps {
  trips: Trip[];
  onEdit: (trip: Trip) => void;
  onDelete: (tripId: string) => void;
}

const STATUS_STYLES: Record<string, { label: string; bg: string; text: string }> = {
  active: { label: 'Activo', bg: '#ecfdf5', text: '#059669' },
  cancelled: { label: 'Inactivo', bg: '#f1f5f9', text: '#6b7280' },
  completed: { label: 'Completado', bg: '#f1f5f9', text: '#6b7280' },
};

export function TripTable({ trips, onEdit, onDelete }: TripTableProps) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-slate-50">
            <th className="text-left px-5 py-3 font-['Poppins',sans-serif] font-semibold text-xs text-brand-muted uppercase tracking-wider">Salida</th>
            <th className="text-left px-5 py-3 font-['Poppins',sans-serif] font-semibold text-xs text-brand-muted uppercase tracking-wider">Ruta</th>
            <th className="text-left px-5 py-3 font-['Poppins',sans-serif] font-semibold text-xs text-brand-muted uppercase tracking-wider">Bus</th>
            <th className="text-left px-5 py-3 font-['Poppins',sans-serif] font-semibold text-xs text-brand-muted uppercase tracking-wider">Precio</th>
            <th className="text-left px-5 py-3 font-['Poppins',sans-serif] font-semibold text-xs text-brand-muted uppercase tracking-wider">Estado</th>
            <th className="text-left px-5 py-3 font-['Poppins',sans-serif] font-semibold text-xs text-brand-muted uppercase tracking-wider">Acciones</th>
          </tr>
        </thead>
        <tbody>
          {trips.map((trip) => {
            const s = STATUS_STYLES[trip.status] ?? STATUS_STYLES.active;
            return (
              <tr key={trip.id} className="border-b border-slate-100 hover:bg-slate-50 transition-colors">
                <td className="px-5 py-4 font-['Poppins',sans-serif] font-normal text-sm text-brand-navy">
                  {formatDateTime(trip.departure_at)}
                </td>
                <td className="px-5 py-4 font-['Poppins',sans-serif] font-normal text-sm text-brand-navy">
                  {trip.route?.origin ?? '—'} → {trip.route?.destination ?? '—'}
                </td>
                <td className="px-5 py-4 font-['Poppins',sans-serif] font-normal text-[13px] text-brand-muted">
                  {trip.total_seats} asientos
                </td>
                <td className="px-5 py-4 font-['Poppins',sans-serif] font-semibold text-sm text-brand-cyan">
                  {formatPrice(trip.price)}
                </td>
                <td className="px-5 py-4">
                  <span className="inline-block font-['Poppins',sans-serif] font-semibold text-[11px] px-[10px] py-[3px] rounded-full" style={{ background: s.bg, color: s.text }}>
                    {s.label}
                  </span>
                </td>
                <td className="px-5 py-4">
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => onEdit(trip)}
                      className="font-['Poppins',sans-serif] font-semibold text-xs px-3 py-[5px] rounded-lg border-none cursor-pointer transition-opacity duration-150 hover:opacity-70"
                      style={{ background: '#eff6ff', color: 'var(--color-brand-blue)' }}
                    >
                      Editar
                    </button>
                    <button
                      type="button"
                      onClick={() => onDelete(trip.id)}
                      className="font-['Poppins',sans-serif] font-semibold text-xs px-3 py-[5px] rounded-lg border-none cursor-pointer transition-opacity duration-150 hover:opacity-70"
                      style={{ background: '#fef2f2', color: '#ef4444' }}
                    >
                      Eliminar
                    </button>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
