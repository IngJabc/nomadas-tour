import { createServerSupabaseClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { CancelBookingButton } from '@/components/ui/CancelBookingButton';

interface BookingGroup {
  key: string;
  tripId: string;
  origin: string;
  destination: string;
  departureAt: string;
  pricePerSeat: number;
  seatCodes: string[];
  bookingIds: string[];
  hasCancelled: boolean;
}

function groupBookings(bookings: any[]): BookingGroup[] {
  const map = new Map<string, BookingGroup>();
  for (const b of bookings) {
    if (!b.trip) continue;
    const key = b.qr_code || b.id;
    if (!map.has(key)) {
      map.set(key, {
        key,
        tripId: b.trip.id,
        origin: b.trip.route?.origin ?? '?',
        destination: b.trip.route?.destination ?? '?',
        departureAt: b.trip.departure_at,
        pricePerSeat: b.trip.price ?? 0,
        seatCodes: [],
        bookingIds: [],
        hasCancelled: false,
      });
    }
    const group = map.get(key)!;
    group.seatCodes.push(b.seat?.seat_code ?? '—');
    group.bookingIds.push(b.id);
    if (b.status === 'cancelled') group.hasCancelled = true;
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
  return format(d, "EEE d MMM yyyy '·' hh:mm a", { locale: es });
}

export default async function DashboardPage() {
  const supabase = await createServerSupabaseClient();
  const { data: userData } = await supabase.auth.getUser();

  if (!userData.user) {
    redirect('/login');
  }

  const { data: bookings } = await supabase
    .from('bookings')
    .select('*, seat:seats(*), trip:trips(*, route:routes(*))')
    .eq('user_id', userData.user.id)
    .order('created_at', { ascending: false });

  const userName = userData.user.user_metadata?.full_name ?? userData.user.email ?? '';
  const isAdmin = userData.user.user_metadata?.role === 'admin';

  const groups = groupBookings(bookings ?? []);

  return (
    <div className="min-h-screen bg-slate-100">
      <main className="pt-20 max-w-[1100px] mx-auto py-8 px-6">
        {/* Header */}
        <div className="flex items-center gap-3 mb-1">
          <h1 className="font-['Montserrat',sans-serif] font-extrabold text-[26px] text-brand-navy">
            Hola, {userName} &#x1f44b;
          </h1>
          {isAdmin && (
            <Link
              href="/admin"
              className="font-['Poppins',sans-serif] font-semibold text-[11px] text-brand-cyan bg-brand-cyan/10 px-2.5 py-0.5 rounded-full no-underline uppercase tracking-wider"
            >
              Panel Admin &rarr;
            </Link>
          )}
        </div>
        <p className="mb-8 font-['Poppins',sans-serif] font-normal text-sm text-brand-muted">
          Aquí están todas tus reservas
        </p>

        {groups.length === 0 ? (
          /* Empty state */
          <div className="mx-auto text-center bg-white rounded-[20px] p-12 max-w-[480px] shadow-[0_2px_8px_rgba(0,0,0,0.07)]">
            <svg className="mx-auto mb-6" width="160" height="100" viewBox="0 0 160 100" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
              <rect x="30" y="35" width="100" height="40" rx="8" fill="#088eb8" opacity="0.15" />
              <rect x="40" y="42" width="12" height="8" rx="2" fill="#088eb8" opacity="0.4" />
              <rect x="58" y="42" width="12" height="8" rx="2" fill="#088eb8" opacity="0.4" />
              <rect x="76" y="42" width="12" height="8" rx="2" fill="#088eb8" opacity="0.4" />
              <rect x="94" y="42" width="12" height="8" rx="2" fill="#088eb8" opacity="0.4" />
              <circle cx="50" cy="80" r="6" fill="#0c142d" opacity="0.2" />
              <circle cx="110" cy="80" r="6" fill="#0c142d" opacity="0.2" />
              <circle cx="80" cy="70" r="4" fill="#088eb8" opacity="0.5" />
              <path d="M40 30h80v8H40z" fill="#088eb8" opacity="0.08" />
              <path d="M20 40l8-10h104l8 10" stroke="#088eb8" strokeWidth="1.5" fill="none" opacity="0.15" />
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
              const totalPrice = group.pricePerSeat * group.seatCodes.length;
              const firstId = group.bookingIds[0];
              return (
                <div
                  key={group.tripId}
                  className="relative bg-white rounded-2xl shadow-[0_2px_8px_rgba(0,0,0,0.07)]"
                >
                  {/* Top status strip */}
                  <div
                    className="h-1 rounded-t-2xl"
                    style={{
                      background: group.hasCancelled ? '#ef4444' : 'var(--color-brand-cyan)',
                    }}
                  />
                  <div className="flex flex-col sm:flex-row justify-between items-start gap-4 py-5 px-6">
                    {/* Left zone */}
                    <div className="w-full sm:flex-1">
                      <span
                        className="inline-block mb-2 font-['Poppins',sans-serif] font-semibold text-[11px] px-2.5 py-0.5 rounded-full"
                        style={{
                          background: badge.bg,
                          color: badge.text,
                        }}
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
                    {/* Right zone */}
                    <div className="flex sm:flex-col items-start sm:items-end gap-2 sm:gap-1.5 w-full sm:w-auto justify-between sm:justify-start">
                      <div className="text-right">
                        <div className="font-['Montserrat',sans-serif] font-extrabold text-[22px] text-brand-cyan">
                          {totalPrice.toFixed(2).replace('.', ',')} €
                        </div>
                        <div className="font-['Poppins',sans-serif] font-normal text-[11px] text-brand-muted">
                          Total pagado
                        </div>
                      </div>
                      <div className="flex gap-3 sm:flex-col sm:items-end">
                        {!group.hasCancelled && (
                          <>
                            <Link
                              href={`/bookings/${firstId}`}
                              className="font-['Poppins',sans-serif] font-semibold text-[13px] text-brand-cyan hover:underline"
                            >
                              Ver detalles &rarr;
                            </Link>
                            <CancelBookingButton />
                          </>
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
