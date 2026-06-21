import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ bookingId: string }> },
) {
  try {
    const { bookingId } = await params;
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
      .eq('id', bookingId)
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }

    return NextResponse.json(booking);
  } catch {
    return NextResponse.json(
      { error: 'Error interno del servidor' },
      { status: 500 },
    );
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ bookingId: string }> },
) {
  try {
    const { bookingId } = await params;
    const body = await request.json();
    const supabase = createAdminClient();

    const { status, passenger_name, passenger_cedula } = body;

    const VALID_STATUSES = ['confirmed', 'cancelled', 'boarded'] as const;
    if (status && !(VALID_STATUSES as readonly string[]).includes(status)) {
      return NextResponse.json({ error: 'Estado no válido' }, { status: 400 });
    }

    const updateData: Record<string, unknown> = {};
    if (status) updateData.status = status;
    if (passenger_name) updateData.passenger_name = passenger_name;
    if (passenger_cedula) updateData.passenger_cedula = passenger_cedula;

    // If cancelling, free the seat first
    if (status === 'cancelled') {
      const { data: booking } = await supabase
        .from('bookings')
        .select('seat_id')
        .eq('id', bookingId)
        .single();

      if (booking?.seat_id) {
        const { error: seatError } = await supabase
          .from('seats')
          .update({ status: 'available', locked_by: null, locked_at: null })
          .eq('id', booking.seat_id);

        if (seatError) {
          return NextResponse.json(
            { error: 'Error al liberar el asiento' },
            { status: 500 },
          );
        }
      }
    }

    // If reactivating, try to reserve the seat again
    if (status === 'confirmed') {
      const { data: booking } = await supabase
        .from('bookings')
        .select('seat_id')
        .eq('id', bookingId)
        .single();

      if (booking?.seat_id) {
        const { data: seat } = await supabase
          .from('seats')
          .select('status')
          .eq('id', booking.seat_id)
          .single();

        if (seat && seat.status === 'available') {
          await supabase
            .from('seats')
            .update({ status: 'reserved' })
            .eq('id', booking.seat_id);
        } else if (seat && seat.status !== 'available') {
          return NextResponse.json(
            { error: 'El asiento ya no está disponible. No se puede reactivar la reserva.' },
            { status: 409 },
          );
        }
      }
    }

    const { data, error } = await supabase
      .from('bookings')
      .update(updateData)
      .eq('id', bookingId)
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
      .single();

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
