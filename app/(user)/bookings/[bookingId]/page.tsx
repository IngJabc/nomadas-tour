import { createServerSupabaseClient } from '@/lib/supabase/server';
import { notFound, redirect } from 'next/navigation';
import { QRTicket } from '@/components/booking/QRTicket';

export default async function BookingDetailPage({
  params,
}: {
  params: Promise<{ bookingId: string }>;
}) {
  const { bookingId } = await params;
  const supabase = await createServerSupabaseClient();
  const { data: userData } = await supabase.auth.getUser();

  if (!userData.user) {
    redirect('/login');
  }

  const { data: reservation } = await supabase
    .from('reservations')
    .select('*, trips(departure_time)')
    .eq('transaction_id', bookingId)
    .single();

  if (!reservation || reservation.user_id !== userData.user.id) {
    notFound();
  }

  let reservations: typeof reservation[] = [reservation];

  if (reservation.qr_code) {
    const { data: grouped } = await supabase
      .from('reservations')
      .select('*, trips(departure_time)')
      .eq('qr_code', reservation.qr_code)
      .eq('user_id', userData.user.id);

    if (grouped && grouped.length > 1) {
      reservations = grouped;
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-brand-surface to-white pt-16">
      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-4 sm:py-6">
        <QRTicket reservations={reservations} />
      </main>
    </div>
  );
}
