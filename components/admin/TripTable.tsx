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
          <tr style={{ background: '#f8fafc' }}>
            <th className="text-left" style={{ padding: '12px 20px', fontFamily: 'var(--font-sans)', fontWeight: 600, fontSize: 12, color: 'var(--color-brand-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Salida</th>
            <th className="text-left" style={{ padding: '12px 20px', fontFamily: 'var(--font-sans)', fontWeight: 600, fontSize: 12, color: 'var(--color-brand-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Ruta</th>
            <th className="text-left" style={{ padding: '12px 20px', fontFamily: 'var(--font-sans)', fontWeight: 600, fontSize: 12, color: 'var(--color-brand-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Bus</th>
            <th className="text-left" style={{ padding: '12px 20px', fontFamily: 'var(--font-sans)', fontWeight: 600, fontSize: 12, color: 'var(--color-brand-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Precio</th>
            <th className="text-left" style={{ padding: '12px 20px', fontFamily: 'var(--font-sans)', fontWeight: 600, fontSize: 12, color: 'var(--color-brand-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Estado</th>
            <th className="text-left" style={{ padding: '12px 20px', fontFamily: 'var(--font-sans)', fontWeight: 600, fontSize: 12, color: 'var(--color-brand-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Acciones</th>
          </tr>
        </thead>
        <tbody>
          {trips.map((trip) => {
            const s = STATUS_STYLES[trip.status] ?? STATUS_STYLES.active;
            return (
              <tr key={trip.id} style={{ borderBottom: '1px solid #f1f5f9' }}
                className="hover:bg-[#f8fafc] transition-colors"
              >
                <td style={{ padding: '16px 20px', fontFamily: 'var(--font-sans)', fontWeight: 400, fontSize: 14, color: 'var(--color-brand-navy)' }}>
                  {formatDateTime(trip.departure_at)}
                </td>
                <td style={{ padding: '16px 20px', fontFamily: 'var(--font-sans)', fontWeight: 400, fontSize: 14, color: 'var(--color-brand-navy)' }}>
                  {trip.route?.origin ?? '—'} → {trip.route?.destination ?? '—'}
                </td>
                <td style={{ padding: '16px 20px', fontFamily: 'var(--font-sans)', fontWeight: 400, fontSize: 13, color: 'var(--color-brand-muted)' }}>
                  {trip.total_seats} asientos
                </td>
                <td style={{ padding: '16px 20px', fontFamily: 'var(--font-sans)', fontWeight: 600, fontSize: 14, color: 'var(--color-brand-cyan)' }}>
                  {formatPrice(trip.price)}
                </td>
                <td style={{ padding: '16px 20px' }}>
                  <span style={{
                    display: 'inline-block',
                    background: s.bg,
                    color: s.text,
                    fontFamily: 'var(--font-sans)',
                    fontWeight: 600,
                    fontSize: 11,
                    padding: '3px 10px',
                    borderRadius: 9999,
                  }}>
                    {s.label}
                  </span>
                </td>
                <td style={{ padding: '16px 20px' }}>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => onEdit(trip)}
                      style={{
                        background: '#eff6ff',
                        color: 'var(--color-brand-blue)',
                        fontFamily: 'var(--font-sans)',
                        fontWeight: 600,
                        fontSize: 12,
                        padding: '5px 12px',
                        borderRadius: 8,
                        border: 'none',
                        cursor: 'pointer',
                        transition: 'opacity 150ms',
                      }}
                      onMouseEnter={(e) => { e.currentTarget.style.opacity = '0.7'; }}
                      onMouseLeave={(e) => { e.currentTarget.style.opacity = '1'; }}
                    >
                      Editar
                    </button>
                    <button
                      type="button"
                      onClick={() => onDelete(trip.id)}
                      style={{
                        background: '#fef2f2',
                        color: '#ef4444',
                        fontFamily: 'var(--font-sans)',
                        fontWeight: 600,
                        fontSize: 12,
                        padding: '5px 12px',
                        borderRadius: 8,
                        border: 'none',
                        cursor: 'pointer',
                        transition: 'opacity 150ms',
                      }}
                      onMouseEnter={(e) => { e.currentTarget.style.opacity = '0.7'; }}
                      onMouseLeave={(e) => { e.currentTarget.style.opacity = '1'; }}
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
