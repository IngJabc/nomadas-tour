import { createServerSupabaseClient } from '@/lib/supabase/server';
import { notFound, redirect } from 'next/navigation';
import { QRTicket } from '@/components/booking/QRTicket';
import Link from 'next/link';

export default async function BookingDetailPage({
  params,
}: {
  params: Promise<{ bookingId: string }>;
}) {
  const { bookingId } = await params;
  const supabase = await createServerSupabaseClient();
  const { data: user } = await supabase.auth.getUser();

  if (!user.user) {
    redirect('/login');
  }

  const { data: booking } = await supabase
    .from('bookings')
    .select('*, seat:seats(*), trip:trips(*, route:routes(*))')
    .eq('id', bookingId)
    .single();

  if (!booking || booking.user_id !== user.user.id) {
    notFound();
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-blue-50 to-white">
      <header className="bg-white shadow-sm">
        <div className="max-w-3xl mx-auto px-4 py-6 flex justify-between items-center">
          <div>
            <Link href="/dashboard" className="text-sm text-blue-600 hover:underline">
              ← Mis reservas
            </Link>
            <h1 className="text-2xl font-bold text-gray-800 mt-1">Detalle de reserva</h1>
          </div>
          <div className="flex gap-3">
            <Link
              href="/"
              className="px-4 py-2 text-sm font-medium text-blue-600 bg-blue-100 rounded-lg hover:bg-blue-200"
            >
              Ver viajes
            </Link>
            <form action="/auth/signout" method="post">
              <button className="px-4 py-2 text-sm font-medium text-white bg-red-500 rounded-lg hover:bg-red-600">
                Cerrar sesión
              </button>
            </form>
          </div>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 py-8">
        <QRTicket booking={booking} />
      </main>
    </div>
  );
}
