import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const qr = searchParams.get('qr') ?? '';

    if (!qr) {
      return NextResponse.json({ error: 'Se requiere el parámetro qr' }, { status: 400 });
    }

    const supabase = createAdminClient();

    const { data: booking, error } = await supabase
      .from('bookings')
      .select(`
        *,
        seat:seats(seat_code),
        trip:trips(
          id,
          departure_at,
          price,
          total_seats,
          status,
          route:routes(origin, destination, duration_minutes)
        )
      `)
      .eq('qr_code', qr)
      .maybeSingle();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    if (!booking) {
      return NextResponse.json({ error: 'Reserva no encontrada' }, { status: 404 });
    }

    return NextResponse.json(booking);
  } catch {
    return NextResponse.json(
      { error: 'Error interno del servidor' },
      { status: 500 },
    );
  }
}
