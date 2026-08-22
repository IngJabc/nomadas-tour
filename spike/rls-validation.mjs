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
  await c.query('DELETE FROM public.boarding_logs WHERE reservation_id IN (SELECT id FROM public.reservations WHERE agency_id = ANY($1::uuid[]))', [[AGENCY_A, AGENCY_B]]);
  await c.query('DELETE FROM public.reservation_passengers WHERE reservation_id IN (SELECT id FROM public.reservations WHERE agency_id = ANY($1::uuid[]))', [[AGENCY_A, AGENCY_B]]);
  await c.query('DELETE FROM public.reservations WHERE agency_id = ANY($1::uuid[])', [[AGENCY_A, AGENCY_B]]);
  await c.query('DELETE FROM public.trip_agencies WHERE agency_id = ANY($1::uuid[])', [[AGENCY_A, AGENCY_B]]);
  await c.query('DELETE FROM public.users WHERE id = ANY($1::uuid[])', [[USER_A, USER_B]]);
  await c.query('DELETE FROM public.agencies WHERE id = ANY($1::uuid[])', [[AGENCY_A, AGENCY_B]]);
  console.log('    Clean.\n');

  console.log('[3] Fixtures...');
  await c.query("INSERT INTO public.agencies (id,name,subdomain,status) VALUES ($1::uuid,'Agency A','test-a','active'),($2::uuid,'Agency B','test-b','active')", [AGENCY_A, AGENCY_B]);
  await c.query("INSERT INTO public.users (id,email,role,agency_id,full_name) VALUES ($1::uuid,'a@test.com','agency',$2::uuid,'User A'),($3::uuid,'b@test.com','agency',$4::uuid,'User B')", [USER_A, AGENCY_A, USER_B, AGENCY_B]);
  const r = await c.query("INSERT INTO public.routes (name,origin,destination,status) VALUES ('Route','A','B','active') RETURNING id");
  const rid = r.rows[0].id;
  const tA = await c.query("INSERT INTO public.trips (route_id,departure_time,status,vehicle_type) VALUES ($1::uuid,NOW()+INTERVAL '2h','upcoming','bus') RETURNING id", [rid]);
  const tB = await c.query("INSERT INTO public.trips (route_id,departure_time,status,vehicle_type) VALUES ($1::uuid,NOW()+INTERVAL '3h','upcoming','bus') RETURNING id", [rid]);
  const tAid = tA.rows[0].id, tBid = tB.rows[0].id;
  await c.query("INSERT INTO public.trip_agencies (trip_id,agency_id,role) VALUES ($1::uuid,$2::uuid,'owner'),($3::uuid,$4::uuid,'owner')", [tAid, AGENCY_A, tBid, AGENCY_B]);
  await c.query("INSERT INTO public.seats (trip_id,seat_code,status) VALUES ($1::uuid,'A1','available'),($2::uuid,'A1','available')", [tAid, tBid]);
  const resA = await c.query("INSERT INTO public.reservations (agency_id,trip_id,booker_name,booker_phone,status,total_amount) VALUES ($1::uuid,$2::uuid,'BookerA','555-1','confirmed',100) RETURNING id", [AGENCY_A, tAid]);
  const resB = await c.query("INSERT INTO public.reservations (agency_id,trip_id,booker_name,booker_phone,status,total_amount) VALUES ($1::uuid,$2::uuid,'BookerB','555-2','confirmed',200) RETURNING id", [AGENCY_B, tBid]);
  console.log('    Done. resA=' + resA.rows[0].id + ' resB=' + resB.rows[0].id + '\n');

  console.log('[4] Auth context validation...');
  const uid = await c.query('BEGIN;SET LOCAL role=authenticated;SET LOCAL request.jwt.claims=$1;SELECT auth.uid() AS uid;COMMIT;', [jwt(USER_A)]);
  ok('auth.uid() = User A', uid.rows[0]?.uid === USER_A, JSON.stringify(uid.rows));
  const rl = await c.query('BEGIN;SET LOCAL role=authenticated;SET LOCAL request.jwt.claims=$1;SELECT private.auth_app_role() AS r;COMMIT;', [jwt(USER_A)]);
  ok('auth_app_role() = agency', rl.rows[0]?.r === 'agency', JSON.stringify(rl.rows));
  const ag = await c.query('BEGIN;SET LOCAL role=authenticated;SET LOCAL request.jwt.claims=$1;SELECT private.auth_app_agency_id() AS aid;COMMIT;', [jwt(USER_A)]);
  ok('auth_app_agency_id() = Agency A', ag.rows[0]?.aid === AGENCY_A, JSON.stringify(ag.rows));
  console.log('');

  console.log('[5] RLS positive (A reads own)...');
  const own = await c.query('BEGIN;SET LOCAL role=authenticated;SET LOCAL request.jwt.claims=$1;SELECT count(*) AS cnt FROM public.reservations;COMMIT;', [jwt(USER_A)]);
  ok('A sees own reservation (count=1)', parseInt(own.rows[0]?.cnt) === 1, 'count=' + own.rows[0]?.cnt);
  console.log('');

  console.log('[6] RLS negative (A cannot read B)...');
  const cross = await c.query('BEGIN;SET LOCAL role=authenticated;SET LOCAL request.jwt.claims=$1;SELECT agency_id FROM public.reservations;COMMIT;', [jwt(USER_A)]);
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
