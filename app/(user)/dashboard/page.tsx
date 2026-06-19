import { createServerSupabaseClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { formatDateTime, formatPrice } from '@/lib/utils';

export default async function DashboardPage() {
  const supabase = await createServerSupabaseClient();
  const { data: user } = await supabase.auth.getUser();

  if (!user.user) {
    redirect('/login');
  }

  const { data: bookings } = await supabase
    .from('bookings')
    .select('*, seat:seats(*), trip:trips(*, route:routes(*))')
    .eq('user_id', user.user.id)
    .order('created_at', { ascending: false });

  return (
    <div className="min-h-screen bg-gradient-to-b from-blue-50 to-white">
      <header className="bg-white shadow-sm">
        <div className="max-w-5xl mx-auto px-4 py-6 flex justify-between items-center">
          <div>
            <h1 className="text-2xl font-bold text-gray-800">Mis reservas</h1>
            <p className="text-gray-500 text-sm">{user.user.email}</p>
          </div>
          <div className="flex gap-3">
            <Link
              href="/"
              className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-200 rounded-lg hover:bg-gray-300"
            >
              Viajes
            </Link>
            <form action="/auth/signout" method="post">
              <button
                type="submit"
                className="px-4 py-2 text-sm font-medium text-white bg-red-500 rounded-lg hover:bg-red-600"
              >
                Cerrar sesión
              </button>
            </form>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-8">
        {!bookings || bookings.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-gray-500">No tienes reservas aún</p>
            <Link
              href="/"
              className="inline-block mt-4 px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
            >
              Ver viajes disponibles
            </Link>
          </div>
        ) : (
          <div className="grid gap-4">
            {bookings.map((booking) => (
              <Link
                key={booking.id}
                href={`/bookings/${booking.id}`}
                className="block bg-white rounded-xl p-6 shadow-md hover:shadow-lg transition-shadow"
              >
                <div className="flex justify-between items-center">
                  <div>
                    <h3 className="font-semibold text-gray-800">
                      {booking.trip?.route?.origin ?? '?'} →{' '}
                      {booking.trip?.route?.destination ?? '?'}
                    </h3>
                    <p className="text-sm text-gray-500 mt-1">
                      {booking.trip ? formatDateTime(booking.trip.departure_at) : '—'}
                    </p>
                    <p className="text-sm text-gray-400">
                      Asiento: {booking.seat?.seat_code ?? '—'} • Pasajero:{' '}
                      {booking.passenger_name}
                    </p>
                  </div>
                  <div className="text-right">
                    <span
                      className={`inline-block px-3 py-1 rounded-full text-xs font-medium ${
                        booking.status === 'confirmed'
                          ? 'text-green-600 bg-green-100'
                          : 'text-red-600 bg-red-100'
                      }`}
                    >
                      {booking.status === 'confirmed' ? 'Confirmado' : 'Cancelado'}
                    </span>
                    {booking.trip && (
                      <p className="text-lg font-bold text-blue-600 mt-1">
                        {formatPrice(booking.trip.price)}
                      </p>
                    )}
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
