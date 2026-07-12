"use client";

import Link from 'next/link';

function availabilityColor(percent: number) {
  if (percent > 0.5) return 'var(--color-brand-cyan)';
  if (percent > 0) return 'var(--color-warning, #f59e0b)';
  return 'var(--color-danger, #ef4444)';
}

interface TripCardProps {
  id: string;
  origin?: string;
  destination?: string;
  departure_at: string;
  duration_minutes: number;
  total_seats: number;
  available_seats: number;
}

export function TripCard({ trip }: { trip: TripCardProps }) {
  const { id, origin, destination, departure_at, duration_minutes, total_seats, available_seats } = trip;
  const date = new Date(departure_at);
  const days = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];
  const months = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
  const day = days[date.getUTCDay()];
  const month = months[date.getUTCMonth()];
  const dayNum = date.getUTCDate();
  const hours = date.getUTCHours();
  const minutes = String(date.getUTCMinutes()).padStart(2, '0');
  const ampm = hours >= 12 ? 'PM' : 'AM';
  const h12 = hours % 12 || 12;
  const dayStr = `${day} ${dayNum} ${month}`;
  const timeStr = `${h12}:${minutes} ${ampm}`;
  const percent = total_seats > 0 ? available_seats / total_seats : 0;
  const isSoldOut = available_seats === 0;
  const isLowStock = available_seats > 0 && available_seats <= 5;

  const card = (
    <article
      className={`group flex flex-col sm:flex-row items-center gap-4 bg-white rounded-2xl shadow-md transition-transform duration-200 ease-out transform border-l-4 focus-within:ring-2 focus-within:ring-offset-2 ${
        isSoldOut ? 'opacity-70 cursor-not-allowed' : 'cursor-pointer hover:-translate-y-1 hover:scale-[1.01] hover:shadow-2xl'
      }`}
      style={{
        borderLeftColor: isSoldOut ? 'var(--color-danger, #ef4444)' : isLowStock ? 'var(--color-warning, #f59e0b)' : 'var(--color-brand-cyan)',
      }}
    >
      <div className="w-full sm:flex-1 p-4 sm:p-6 flex items-start gap-3 sm:gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3">
            <div className="flex items-center gap-2 min-w-0">
              <svg className="w-4 h-4 shrink-0 text-brand-cyan" viewBox="0 0 24 24" fill="none">
                <path d="M3 13V6a2 2 0 012-2h14a2 2 0 012 2v7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M5 19a2 2 0 100-4 2 2 0 000 4zM19 19a2 2 0 100-4 2 2 0 000 4z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              <div className="truncate">
                <div className="text-brand-navy font-['Poppins',sans-serif] font-semibold text-[15px] sm:text-lg truncate">
                  {origin} → {destination}
                </div>
                <div className="text-brand-muted font-['Poppins',sans-serif] text-[12px] sm:text-[13px]">
                  {day} · {timeStr}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2 sm:ml-4 shrink-0">
              <span className="inline-flex items-center px-2 py-1 rounded-full bg-sky-50 group-hover:bg-sky-100 transition-colors">
                <span className="font-medium text-brand-cyan text-[11px] sm:text-[13px]">{duration_minutes} min</span>
              </span>
              {(isLowStock || isSoldOut) && (
                <span
                  className="inline-flex items-center px-2 py-1 rounded-full font-semibold text-[10px] sm:text-[11px]"
                  style={{
                    background: isSoldOut ? 'var(--color-danger-bg, #fef2f2)' : 'var(--color-warning-bg, #fffbeb)',
                    color: isSoldOut ? 'var(--color-danger, #ef4444)' : 'var(--color-warning-text, #92400e)',
                  }}
                >
                  {isSoldOut ? 'Agotado' : 'Pocos asientos'}
                </span>
              )}
            </div>
          </div>
          {/* Mobile-only availability row */}
          <div className="sm:hidden flex items-center gap-2 mt-2">
            <div className="font-bold font-['Montserrat',sans-serif] text-sm" style={{ color: availabilityColor(percent) }}>
              {available_seats}<span className="text-[11px] font-normal opacity-60">/{total_seats}</span>
            </div>
            <span className="text-[11px] text-brand-muted font-['Poppins',sans-serif]">asientos libres</span>
          </div>
        </div>

        <div className="hidden sm:flex w-px h-14 bg-slate-100 mx-6 shrink-0" />

        <div className="hidden sm:flex flex-col items-center justify-center shrink-0">
          <div className="font-bold font-['Montserrat',sans-serif] text-xl" style={{ color: availabilityColor(percent) }}>
            {available_seats}<span className="text-sm font-normal opacity-60">/{total_seats}</span>
          </div>
          <div className="text-sm text-brand-muted whitespace-nowrap">asientos libres</div>
        </div>
      </div>

      <div className="w-full sm:w-56 px-4 sm:px-6 pb-4 sm:pb-6 sm:pt-6 flex flex-row sm:flex-col items-center sm:items-end justify-between sm:justify-center gap-2 sm:gap-2">
        <div className="sm:w-full sm:mt-2">
          <button
            disabled={isSoldOut}
            className="w-full sm:w-auto text-white rounded-xl px-4 sm:px-5 py-2 text-[13px] sm:text-sm font-semibold transition transform shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 font-['Poppins',sans-serif]"
            style={{
              background: isSoldOut ? '#9ca3af' : 'var(--color-brand-cyan)',
              cursor: isSoldOut ? 'not-allowed' : 'pointer',
              opacity: isSoldOut ? 0.5 : 1,
            }}
          >
            {isSoldOut ? 'Sin disponibilidad' : 'Seleccionar asientos'}
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
