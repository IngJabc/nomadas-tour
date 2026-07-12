'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { CancelBookingButton } from '@/components/ui/CancelBookingButton';
import { customerApi } from '@/lib/api';

interface BookingGroup {
  key: string;
  tripId: string;
  origin: string;
  destination: string;
  departureAt: string;
  seatCodes: string[];
  reservationIds: string[];
  transactionId: string;
  hasCancelled: boolean;
  qrCode: string;
}

function groupReservations(reservations: any[]): BookingGroup[] {
  const map = new Map<string, BookingGroup>();
  for (const r of reservations) {
    if (!r.trips) continue;
    const key = r.transaction_id || r.id;
    if (!map.has(key)) {
      map.set(key, {
        key,
        tripId: r.trips.id,
        origin: r.trips.routes?.origin ?? '?',
        destination: r.trips.routes?.destination ?? '?',
        departureAt: r.trips.departure_time,

        seatCodes: [],
        reservationIds: [],
        transactionId: r.transaction_id || '',
        hasCancelled: false,
        qrCode: r.qr_code,
      });
    }
    const group = map.get(key)!;
    group.seatCodes.push(r.seat_code);
    group.reservationIds.push(r.id);
    if (r.status === 'cancelled') group.hasCancelled = true;
  }
  return Array.from(map.values());
}

function statusBadge(hasCancelled: boolean) {
  if (hasCancelled) {
    return { label: 'Cancelada', bg: '#fef2f2', text: '#ef4444' };
  }
  return { label: 'Activa', bg: '#ecfdf5', text: '#059669' };
}

function formatDate(iso: string) {
  const d = new Date(iso);
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const day = days[d.getUTCDay()];
  const month = months[d.getUTCMonth()];
  const date = d.getUTCDate();
  const year = d.getUTCFullYear();
  const hours = d.getUTCHours();
  const minutes = String(d.getUTCMinutes()).padStart(2, '0');
  const ampm = hours >= 12 ? 'PM' : 'AM';
  const h12 = hours % 12 || 12;
  return `${day} ${date} ${month} ${year} · ${h12}:${minutes} ${ampm}`;
}

export default function DashboardPage() {
  const [groups, setGroups] = useState<BookingGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [userName, setUserName] = useState('');
  const [isSuperadmin, setIsSuperadmin] = useState(false);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const { createClient } = await import('@/lib/supabase/client');
        const supabase = createClient();
        const { data: userData } = await supabase.auth.getUser();
        if (!userData.user) {
          window.location.href = '/login';
          return;
        }

        setUserName(userData.user.user_metadata?.full_name || userData.user.email || '');

        const role = userData.user.user_metadata?.role || '';
        setIsSuperadmin(role === 'superadmin');

        const reservations = await customerApi.getMyReservations();
        setGroups(groupReservations(reservations || []));
      } catch {
        setGroups([]);
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-100 pt-16 flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-brand-navy" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-100 pt-16">
      <main className="max-w-[1100px] mx-auto py-4 sm:py-6 px-4 sm:px-6">
        <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3 mb-1">
          <h1 className="font-['Montserrat',sans-serif] font-extrabold text-[22px] sm:text-[26px] text-brand-navy">
            Hola, {userName}
          </h1>
          {isSuperadmin && (
            <Link
              href="/admin"
              className="self-start sm:self-auto font-['Poppins',sans-serif] font-semibold text-[11px] text-brand-cyan bg-brand-cyan/10 px-2.5 py-0.5 rounded-full no-underline uppercase tracking-wider"
            >
              Panel Admin &rarr;
            </Link>
          )}
        </div>
        <p className="mb-6 sm:mb-8 font-['Poppins',sans-serif] font-normal text-sm text-brand-muted">
          Aquí están todas tus reservas
        </p>

        {groups.length === 0 ? (
          <div className="mx-auto text-center bg-white rounded-[20px] p-12 max-w-[480px] shadow-[0_2px_8px_rgba(0,0,0,0.07)]">
            <svg className="mx-auto mb-6" width="160" height="100" viewBox="0 0 160 100" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
              <rect x="30" y="35" width="100" height="40" rx="8" fill="#00D4FF" opacity="0.15" />
              <rect x="40" y="42" width="12" height="8" rx="2" fill="#00D4FF" opacity="0.4" />
              <rect x="58" y="42" width="12" height="8" rx="2" fill="#00D4FF" opacity="0.4" />
              <rect x="76" y="42" width="12" height="8" rx="2" fill="#00D4FF" opacity="0.4" />
              <rect x="94" y="42" width="12" height="8" rx="2" fill="#00D4FF" opacity="0.4" />
              <circle cx="50" cy="80" r="6" fill="#000024" opacity="0.2" />
              <circle cx="110" cy="80" r="6" fill="#000024" opacity="0.2" />
              <circle cx="80" cy="70" r="4" fill="#00D4FF" opacity="0.5" />
              <path d="M40 30h80v8H40z" fill="#00D4FF" opacity="0.08" />
              <path d="M20 40l8-10h104l8 10" stroke="#00D4FF" strokeWidth="1.5" fill="none" opacity="0.15" />
            </svg>
            <h2 className="font-['Montserrat',sans-serif] font-bold text-xl text-brand-navy">
              Aún no tienes reservas
            </h2>
            <p className="mx-auto mt-2 mb-6 font-['Poppins',sans-serif] font-normal text-sm text-brand-muted max-w-[320px]">
              Explora los viajes disponibles y reserva tu asiento en minutos.
            </p>
            <Link
              href="/"
              className="inline-flex items-center bg-brand-cyan text-white font-['Poppins',sans-serif] font-semibold text-sm rounded-xl px-6 py-3 transition-colors duration-200 hover:bg-brand-blue"
            >
              Ver viajes disponibles &rarr;
            </Link>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            {groups.map((group) => {
              const badge = statusBadge(group.hasCancelled);
              return (
                <div
                  key={group.key}
                  className="relative bg-white rounded-2xl shadow-[0_2px_8px_rgba(0,0,0,0.07)]"
                >
                  <div
                    className="h-1 rounded-t-2xl"
                    style={{
                      background: group.hasCancelled ? '#ef4444' : 'var(--color-brand-cyan)',
                    }}
                  />
                  <div className="flex flex-col sm:flex-row justify-between items-start gap-3 sm:gap-4 py-4 sm:py-5 px-4 sm:px-6">
                    <div className="w-full sm:flex-1">
                      <span
                        className="inline-block mb-2 font-['Poppins',sans-serif] font-semibold text-[11px] px-2.5 py-0.5 rounded-full"
                        style={{ background: badge.bg, color: badge.text }}
                      >
                        {badge.label}
                      </span>
                      <h3 className="font-['Poppins',sans-serif] font-semibold text-[17px] text-brand-navy">
                        {group.origin} → {group.destination}
                      </h3>
                      <p className="mt-1 font-['Poppins',sans-serif] font-normal text-[13px] text-brand-muted">
                        {formatDate(group.departureAt)}
                      </p>
                      <p className="font-['Poppins',sans-serif] font-normal text-[13px] text-brand-muted">
                        Asientos: {group.seatCodes.join(', ')}
                      </p>
                    </div>
                    <div className="flex sm:flex-col items-start sm:items-end gap-2 sm:gap-1.5 w-full sm:w-auto justify-between sm:justify-start">
                      <div className="flex gap-3 sm:flex-col sm:items-end">
                        <Link
                          href={`/bookings/${group.transactionId}`}
                          className="font-['Poppins',sans-serif] font-semibold text-[12px] text-brand-cyan bg-cyan-50 px-3 py-2 rounded-lg no-underline transition-colors duration-200 hover:bg-cyan-100 text-center"
                        >
                          Ver boleto
                        </Link>
                        {!group.hasCancelled && (
                          <CancelBookingButton
                            tripId={group.tripId}
                            transactionId={group.transactionId}
                            reservationIds={group.reservationIds}
                          />
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}
