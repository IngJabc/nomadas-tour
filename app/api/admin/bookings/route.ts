import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const q = searchParams.get('q')?.toLowerCase() ?? '';
    const statusFilter = searchParams.get('status') ?? '';

    const supabase = createAdminClient();

    let query = supabase
      .from('bookings')
      .select(`
        *,
        seat:seats(seat_code),
        trip:trips!inner(
          id,
          departure_at,
          price,
          total_seats,
          status,
          route:routes(origin, destination, duration_minutes)
        )
      `)
      .order('created_at', { ascending: false });

    if (statusFilter === 'confirmed' || statusFilter === 'cancelled') {
      query = query.eq('status', statusFilter);
    }

    const { data: bookings, error } = await query;

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    type BookingRow = {
      id: string;
      user_id: string;
      trip_id: string;
      seat_id: string;
      passenger_name: string;
      passenger_email: string;
      passenger_cedula: string;
      qr_code: string;
      status: string;
      created_at: string;
      seat: { seat_code: string } | null;
      trip: {
        id: string;
        departure_at: string;
        price: number;
        total_seats: number;
        status: string;
        route: { origin: string; destination: string; duration_minutes: number } | null;
      } | null;
    };

    let result = bookings as unknown as BookingRow[];

    if (q) {
      result = result.filter((b) =>
        b.passenger_name?.toLowerCase().includes(q) ||
        b.passenger_email?.toLowerCase().includes(q) ||
        b.passenger_cedula?.toLowerCase().includes(q) ||
        b.trip?.route?.origin?.toLowerCase().includes(q) ||
        b.trip?.route?.destination?.toLowerCase().includes(q) ||
        b.seat?.seat_code?.toLowerCase().includes(q) ||
        b.qr_code?.toLowerCase().includes(q)
      );
    }

    return NextResponse.json(result);
  } catch {
    return NextResponse.json(
      { error: 'Error interno del servidor' },
      { status: 500 },
    );
  }
}
