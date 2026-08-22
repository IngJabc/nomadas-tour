import pg from 'pg';
const { Client } = pg;

const DB_URL = process.env.DATABASE_URL || 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const AGENCY_A = '11111111-1111-1111-1111-111111111111';
const AGENCY_B = '22222222-2222-2222-2222-222222222222';
const USER_A   = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const USER_B   = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

let passed = 0, failed = 0;
function ok(label, cond, detail = '') {
  if (cond) { console.log(`  PASS  ${label}`); passed++; }
  else { console.error(`  FAIL  ${label}  ${detail}`); failed++; }
}
function jwt(userId) { return JSON.stringify({ sub: userId, role: 'authenticated' }); }

async function main() {
  console.log('='.repeat(70));
  console.log('SEC-009.3-SP1 - RLS Validation');
  console.log('='.repeat(70));

  const c = new Client({ connectionString: DB_URL });
  await c.connect();
  console.log('[1] Connected.\n');

  console.log('[2] Cleanup...');
  await c.query('SET session_replication_role = replica');
  await c.query('DELETE FROM public.reservation_passengers WHERE reservation_id IN (SELECT id FROM public.reservations WHERE agency_id = ANY($1::uuid[]))', [[AGENCY_A, AGENCY_B]]);
  await c.query('DELETE FROM public.reservations WHERE agency_id = ANY($1::uuid[])', [[AGENCY_A, AGENCY_B]]);
  await c.query('DELETE FROM public.trip_agencies WHERE agency_id = ANY($1::uuid[])', [[AGENCY_A, AGENCY_B]]);
  await c.query('DELETE FROM public.users WHERE id = ANY($1::uuid[])', [[USER_A, USER_B]]);
  await c.query('DELETE FROM auth.users WHERE id = ANY($1::uuid[])', [[USER_A, USER_B]]);
  await c.query('DELETE FROM public.agencies WHERE id = ANY($1::uuid[])', [[AGENCY_A, AGENCY_B]]);
  await c.query('SET session_replication_role = origin');
  console.log('    Clean.\n');

  console.log('[3] Fixtures...');
  await c.query("INSERT INTO public.agencies (id,name,subdomain,status) VALUES ($1::uuid,'Agency A','test-a','active'),($2::uuid,'Agency B','test-b','active')", [AGENCY_A, AGENCY_B]);
  await c.query("INSERT INTO auth.users (id,email,encrypted_password,email_confirmed_at,aud,role) VALUES ($1::uuid,'a@test.com','',NOW(),'authenticated','authenticated'),($2::uuid,'b@test.com','',NOW(),'authenticated','authenticated')", [USER_A, USER_B]);
  await c.query("INSERT INTO public.users (id,email,password_hash,role,agency_id) VALUES ($1::uuid,'a@test.com','dummy','agency',$2::uuid),($3::uuid,'b@test.com','dummy','agency',$4::uuid)", [USER_A, AGENCY_A, USER_B, AGENCY_B]);
  const r = await c.query("INSERT INTO public.routes (origin,destination) VALUES ('A','B') RETURNING id");
  const rid = r.rows[0].id;
  const tA = await c.query("INSERT INTO public.trips (route_id,departure_time,capacity,status,vehicle_type) VALUES ($1::uuid,NOW()+INTERVAL '2h',30,'active','bus') RETURNING id", [rid]);
  const tB = await c.query("INSERT INTO public.trips (route_id,departure_time,capacity,status,vehicle_type) VALUES ($1::uuid,NOW()+INTERVAL '3h',30,'active','bus') RETURNING id", [rid]);
  const tAid = tA.rows[0].id, tBid = tB.rows[0].id;
  await c.query("INSERT INTO public.trip_agencies (trip_id,agency_id) VALUES ($1::uuid,$2::uuid),($3::uuid,$4::uuid)", [tAid, AGENCY_A, tBid, AGENCY_B]);
  await c.query("INSERT INTO public.seats (trip_id,seat_code,status) VALUES ($1::uuid,'A1','available'),($2::uuid,'A1','available')", [tAid, tBid]);
  const resA = await c.query("INSERT INTO public.reservations (agency_id,trip_id,booker_name,booker_document,booker_phone,qr_code,status) VALUES ($1::uuid,$2::uuid,'BookerA','DOC-A','555-1','QR-A','confirmed') RETURNING id", [AGENCY_A, tAid]);
  const resB = await c.query("INSERT INTO public.reservations (agency_id,trip_id,booker_name,booker_document,booker_phone,qr_code,status) VALUES ($1::uuid,$2::uuid,'BookerB','DOC-B','555-2','QR-B','confirmed') RETURNING id", [AGENCY_B, tBid]);
  console.log('    Done. resA=' + resA.rows[0].id + ' resB=' + resB.rows[0].id + '\n');

  console.log('[3b] Runtime grants for authenticated role...');
  await c.query('GRANT SELECT ON public.reservations TO authenticated');
  await c.query('GRANT SELECT ON public.agencies TO authenticated');
  await c.query('GRANT SELECT ON public.users TO authenticated');
  await c.query('GRANT SELECT ON public.trips TO authenticated');
  await c.query('GRANT SELECT ON public.seats TO authenticated');
  await c.query('GRANT SELECT ON public.routes TO authenticated');
  await c.query('GRANT SELECT ON public.trip_agencies TO authenticated');
  console.log('    Done.\n');

  console.log('[4] Auth context validation...');
  async function authQuery(sql) {
    await c.query('BEGIN');
    await c.query('SET LOCAL role=authenticated');
    await c.query(`SET LOCAL request.jwt.claims='${jwt(USER_A)}'`);
    const r = await c.query(sql);
    await c.query('COMMIT');
    return r;
  }
  const uid = await authQuery('SELECT auth.uid() AS uid');
  ok('auth.uid() = User A', uid.rows[0]?.uid === USER_A, JSON.stringify(uid.rows));
  const rl = await authQuery('SELECT private.auth_app_role() AS r');
  ok('auth_app_role() = agency', rl.rows[0]?.r === 'agency', JSON.stringify(rl.rows));
  const ag = await authQuery('SELECT private.auth_app_agency_id() AS aid');
  ok('auth_app_agency_id() = Agency A', ag.rows[0]?.aid === AGENCY_A, JSON.stringify(ag.rows));
  console.log('');

  console.log('[5] RLS positive (A reads own)...');
  const own = await authQuery('SELECT count(*) AS cnt FROM public.reservations');
  ok('A sees own reservation (count=1)', parseInt(own.rows[0]?.cnt) === 1, 'count=' + own.rows[0]?.cnt);
  console.log('');

  console.log('[6] RLS negative (A cannot read B)...');
  const cross = await authQuery('SELECT agency_id FROM public.reservations');
  const agencies = cross.rows.map(r => r.agency_id);
  ok('A does NOT see B reservation', !agencies.includes(AGENCY_B), JSON.stringify(agencies));
  console.log('');

  console.log('[7] Service role control...');
  const sr = await c.query('SELECT count(*) AS cnt FROM public.reservations');
  ok('service_role sees ALL reservations (count=2)', parseInt(sr.rows[0]?.cnt) === 2, 'count=' + sr.rows[0]?.cnt);
  console.log('');

  console.log('='.repeat(70));
  console.log(`RESULTS: ${passed} passed, ${failed} failed`);
  console.log('='.repeat(70));

  await c.end();
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
