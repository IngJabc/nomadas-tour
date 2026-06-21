import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { bookingIds, seatIds } = body as {
      bookingIds: string[];
      seatIds: string[];
    };

    if (!bookingIds?.length || !seatIds?.length) {
      return NextResponse.json(
        { error: 'Se requieren bookingIds y seatIds' },
        { status: 400 },
      );
    }

    const supabase = await createServerSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json(
        { error: 'Debes iniciar sesión' },
        { status: 401 },
      );
    }

    const adminClient = createAdminClient();

    const { data: bookings } = await adminClient
      .from('bookings')
      .select('id, user_id, status')
      .in('id', bookingIds);

    if (!bookings || bookings.length !== bookingIds.length) {
      return NextResponse.json(
        { error: 'Una o más reservas no existen' },
        { status: 404 },
      );
    }

    const allOwned = bookings.every((b) => b.user_id === user.id);
    if (!allOwned) {
      return NextResponse.json(
        { error: 'No tienes permiso para cancelar estas reservas' },
        { status: 403 },
      );
    }

    const alreadyCancelled = bookings.some((b) => b.status === 'cancelled');
    if (alreadyCancelled) {
      return NextResponse.json(
        { error: 'Una o más reservas ya están canceladas' },
        { status: 409 },
      );
    }

    const { error: bookingError } = await adminClient
      .from('bookings')
      .update({ status: 'cancelled' })
      .in('id', bookingIds);

    if (bookingError) {
      return NextResponse.json(
        { error: 'Error al cancelar reservas' },
        { status: 500 },
      );
    }

    const { error: seatError } = await adminClient
      .from('seats')
      .update({ status: 'available', locked_by: null, locked_at: null })
      .in('id', seatIds);

    if (seatError) {
      return NextResponse.json(
        { error: 'Error al liberar asientos' },
        { status: 500 },
      );
    }

    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json(
      { error: 'Error interno del servidor' },
      { status: 500 },
    );
  }
}
