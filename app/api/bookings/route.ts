import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { bookingSchema } from '@/lib/validations/booking';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const parsed = bookingSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Datos inválidos', details: parsed.error.flatten() },
        { status: 400 },
      );
    }

    // Get authenticated user
    const serverSupabase = await createServerSupabaseClient();
    const { data: { user } } = await serverSupabase.auth.getUser();

    if (!user) {
      return NextResponse.json(
        { error: 'Debes iniciar sesión para reservar' },
        { status: 401 },
      );
    }

    const { trip_id, seat_id, passenger_name, passenger_email } = parsed.data;
    const adminClient = createAdminClient();

    // Verify seat is available or locked by this user
    const { data: seat } = await adminClient
      .from('seats')
      .select('*')
      .eq('id', seat_id)
      .eq('trip_id', trip_id)
      .single();

    const isBookable =
      seat?.status === 'available' ||
      (seat?.status === 'locked' && seat.locked_by === user.id);

    if (!seat || !isBookable) {
      return NextResponse.json(
        { error: 'El asiento no está disponible' },
        { status: 409 },
      );
    }

    // Generate unique QR code
    const qrCode = `CAMPING-${Date.now()}-${Math.random().toString(36).substring(2, 10).toUpperCase()}`;

    // Create booking and update seat in transaction
    const { data: booking, error: bookingError } = await adminClient
      .from('bookings')
      .insert({
        user_id: user.id,
        trip_id,
        seat_id,
        passenger_name,
        passenger_email,
        qr_code: qrCode,
        status: 'confirmed',
      })
      .select()
      .single();

    if (bookingError) {
      return NextResponse.json(
        { error: 'Error al crear la reserva' },
        { status: 500 },
      );
    }

    const { error: updateError } = await adminClient
      .from('seats')
      .update({
        status: 'reserved',
        locked_by: null,
        locked_at: null,
      })
      .eq('id', seat_id)
      .in('status', ['available', 'locked']);

    if (updateError) {
      await adminClient.from('bookings').delete().eq('id', booking.id);
      return NextResponse.json(
        { error: 'Error al actualizar el asiento' },
        { status: 500 },
      );
    }

    return NextResponse.json({ booking }, { status: 201 });
  } catch {
    return NextResponse.json(
      { error: 'Error interno del servidor' },
      { status: 500 },
    );
  }
}
