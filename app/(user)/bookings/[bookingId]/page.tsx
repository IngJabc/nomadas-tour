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
          <h1 className="text-2xl font-bold text-gray-800">Detalle de reserva</h1>
          <Link
            href="/dashboard"
            className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-200 rounded-lg hover:bg-gray-300"
          >
            Mis reservas
          </Link>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 py-8">
        <QRTicket booking={booking} />
      </main>
    </div>
  );
}
