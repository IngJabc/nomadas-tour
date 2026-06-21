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

  const { data: booking } = await supabase
    .from('bookings')
    .select('*, seat:seats(*), trip:trips(*, route:routes(*))')
    .eq('id', bookingId)
    .single();

  if (!booking || booking.user_id !== userData.user.id) {
    notFound();
  }

  let bookings: typeof booking[] = [booking];

  if (booking.qr_code) {
    const { data: grouped } = await supabase
      .from('bookings')
      .select('*, seat:seats(*), trip:trips(*, route:routes(*))')
      .eq('qr_code', booking.qr_code)
      .eq('user_id', userData.user.id);

    if (grouped && grouped.length > 1) {
      bookings = grouped;
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-brand-surface to-white pt-16">
      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-4 sm:py-6">
        <QRTicket bookings={bookings} />
      </main>
    </div>
  );
}
