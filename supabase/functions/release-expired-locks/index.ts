// Supabase Edge Function — Scheduled: every 5 minutes
// Deploy with: supabase functions deploy release-expired-locks --no-verify-jwt
// Schedule with: supabase functions schedule create --cron "*/5 * * * *" release-expired-locks

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

serve(async (_req) => {
  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    );

    const { data, error } = await supabase
      .from('seats')
      .update({ status: 'available', locked_by: null, locked_at: null })
      .eq('status', 'locked')
      .lt('locked_at', new Date(Date.now() - 5 * 60 * 1000).toISOString());

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
