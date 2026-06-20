"use client";

import Link from 'next/link';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';

function availabilityColor(percent: number) {
  if (percent > 0.5) return '#059669';
  if (percent > 0) return '#d97706';
  return '#ef4444';
}

interface TripCardProps {
  id: string;
  origin?: string;
  destination?: string;
  departure_at: string;
  duration_minutes: number;
  total_seats: number;
  price: number;
  available_seats: number;
}

export function TripCard({ trip }: { trip: TripCardProps }) {
  const { id, origin, destination, departure_at, duration_minutes, price, total_seats, available_seats } = trip;
  const date = new Date(departure_at);
  const day = format(date, 'EEE d MMM', { locale: es });
  const time = format(date, 'hh:mm a', { locale: es });
  const percent = total_seats > 0 ? available_seats / total_seats : 0;
  const isSoldOut = available_seats === 0;
  const isLowStock = available_seats > 0 && available_seats <= 5;

  const card = (
    <article
      className={`group flex flex-col sm:flex-row items-center gap-4 bg-white rounded-2xl shadow-md transition-transform duration-200 ease-out transform border-l-4 focus-within:ring-2 focus-within:ring-offset-2 ${isSoldOut ? '' : 'hover:-translate-y-1 hover:scale-[1.01] hover:shadow-2xl'}`}
      style={{
        borderLeftColor: isSoldOut ? '#ef4444' : isLowStock ? '#f59e0b' : 'var(--color-brand-cyan)',
        opacity: isSoldOut ? 0.7 : 1,
        cursor: isSoldOut ? 'not-allowed' : 'pointer',
      }}
    >
      <div className="w-full sm:flex-1 p-5 sm:p-6 flex items-start gap-4">
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="none" style={{ color: 'var(--color-brand-cyan)' }}>
              <path d="M3 13V6a2 2 0 012-2h14a2 2 0 012 2v7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M5 19a2 2 0 100-4 2 2 0 000 4zM19 19a2 2 0 100-4 2 2 0 000 4z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <div>
              <div className="text-brand-navy font-semibold" style={{ fontFamily: 'var(--font-sans)', fontWeight: 600, fontSize: 18 }}>
                {origin} → {destination}
              </div>
              <div className="text-sm text-brand-muted" style={{ fontFamily: 'var(--font-sans)', fontSize: 13 }}>
                {day} · {time}
              </div>
            </div>
            <div className="ml-4 flex items-center gap-2">
              <span className="inline-flex items-center px-2 py-1 rounded-full bg-sky-50 group-hover:bg-sky-100 transition-colors">
                <span style={{ color: 'var(--color-brand-cyan)', fontSize: 13 }} className="font-medium">{duration_minutes} min</span>
              </span>
              {(isLowStock || isSoldOut) && (
                <span
                  className="inline-flex items-center px-2 py-1 rounded-full font-semibold"
                  style={{
                    background: isSoldOut ? '#fef2f2' : '#fffbeb',
                    color: isSoldOut ? '#ef4444' : '#92400e',
                    fontSize: 11,
                  }}
                >
                  {isSoldOut ? 'Agotado' : 'Pocos asientos'}
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="hidden sm:block w-px h-14 bg-slate-100 mx-6" />

        <div className="hidden sm:flex flex-col items-center justify-center">
          <div className="font-bold" style={{ fontFamily: 'var(--font-heading)', fontSize: 20, color: availabilityColor(percent) }}>
            {available_seats}<span style={{ fontSize: 14, fontWeight: 400, opacity: 0.6 }}>/{total_seats}</span>
          </div>
          <div className="text-sm text-brand-muted">asientos libres</div>
        </div>
      </div>

      <div className="w-full sm:w-56 p-5 sm:p-6 flex flex-col items-end gap-2">
        <div style={{ fontFamily: 'var(--font-heading)', fontSize: 26, fontWeight: 800, color: 'var(--color-brand-cyan)' }} className={isSoldOut ? '' : 'group-hover:scale-105 transition-transform'}>
          {price.toFixed(2).replace('.', ',')} €
        </div>
        <div className="text-xs text-brand-muted">por asiento</div>
        <div className="w-full sm:w-auto mt-2">
          <button
            disabled={isSoldOut}
            className="w-full sm:w-auto text-white rounded-xl px-5 py-2 text-sm font-semibold transition transform shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
            style={{
              background: isSoldOut ? '#9ca3af' : 'var(--color-brand-cyan)',
              fontFamily: 'var(--font-sans)',
              fontWeight: 600,
              cursor: isSoldOut ? 'not-allowed' : 'pointer',
              opacity: isSoldOut ? 0.5 : 1,
            }}
          >
            {isSoldOut ? 'Sin disponibilidad' : 'Seleccionar asientos →'}
          </button>
        </div>
      </div>
    </article>
  );

  if (isSoldOut) {
    return <div className="block">{card}</div>;
  }

  return <Link href={`/trips/${id}`} className="block">{card}</Link>;
}
