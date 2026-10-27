// Supabase Edge Function — Scheduled: every 5 minutes
// Deploy with: supabase functions deploy release-expired-locks --no-verify-jwt
// Schedule with: supabase functions schedule create --cron "*/5 * * * *" release-expired-locks
// F5-004: expire by lock_expires_at only. Do not use locked_at + TTL.

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

serve(async (_req) => {
  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    );

    // MKT-010: primero se cierran los intentos de checkout vencidos
    // (RPC 087) — esa RPC libera, en la misma transacción, SOLO los
    // locks de cada intento. Después se liberan los locks vencidos
    // huérfanos, excluyendo los asientos con `checkout_attempt_id`
    // para no destruir compras en curso si el cleanup falló.
    const { error: cleanupError } = await supabase.rpc(
      'cleanup_expired_checkout_attempts',
    );
    if (cleanupError) throw cleanupError;

    const { data, error } = await supabase
      .from('seats')
      .update({ status: 'available', locked_by: null, locked_at: null, lock_expires_at: null })
      .eq('status', 'locked')
      .lt('lock_expires_at', new Date().toISOString())
      .is('checkout_attempt_id', null);

    if (error) throw error;

    return new Response(
      JSON.stringify({ released: data ?? [], success: true }),
      { headers: { 'Content-Type': 'application/json' } },
    );
  } catch (error) {
    return new Response(
      JSON.stringify({ error: error.message, success: false }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    );
  }
});
