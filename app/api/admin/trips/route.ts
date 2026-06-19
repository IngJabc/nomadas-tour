import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { tripSchema } from '@/lib/validations/booking';

export async function GET() {
  try {
    const supabase = createAdminClient();
    const { data, error } = await supabase
      .from('trips')
      .select('*, route:routes(*)')
      .order('departure_at', { ascending: false });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json(data);
  } catch {
    return NextResponse.json(
      { error: 'Error interno del servidor' },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const parsed = tripSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Datos inválidos', details: parsed.error.flatten() },
        { status: 400 },
      );
    }

    const supabase = createAdminClient();

    const { data: trip, error: tripError } = await supabase
      .from('trips')
      .insert({
        route_id: parsed.data.route_id,
        departure_at: new Date(parsed.data.departure_at).toISOString(),
        price: parsed.data.price,
        status: 'active',
      })
      .select()
      .single();

    if (tripError) {
      return NextResponse.json({ error: tripError.message }, { status: 500 });
    }

    // Create default seats for the trip
    const seatCodes = [
      ...Array.from({ length: 30 }, (_, i) => `A${i + 1}`),
      'G',
    ];

    const { error: seatsError } = await supabase.from('seats').insert(
      seatCodes.map((code) => ({
        trip_id: trip.id,
        seat_code: code,
        status: code === 'G' ? 'locked' : 'available',
      })),
    );

    if (seatsError) {
      // Rollback trip creation
      await supabase.from('trips').delete().eq('id', trip.id);
      return NextResponse.json({ error: seatsError.message }, { status: 500 });
    }

    return NextResponse.json({ trip }, { status: 201 });
  } catch {
    return NextResponse.json(
      { error: 'Error interno del servidor' },
      { status: 500 },
    );
  }
}
