import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import postgres from 'postgres';
process.loadEnvFile('.env');
const base = 'http://localhost:5174';
let cookie = '';
let eventId;
let checks = 0;
async function request(path, method = 'GET', body, expected = 200, origin = base) {
  const response = await fetch(base + '/api/admin/' + path, { method,
    headers: { Origin: origin, Cookie: cookie, 'Content-Type':'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body) });
  assert.equal(response.status, expected, `${method} ${path}`);
  checks++;
  return response;
}
const sql = postgres(process.env.DATABASE_URL, { prepare:false,max:1,ssl:'require',connect_timeout:10 });
try {
  assert.equal((await fetch(base + '/admin.html')).status, 200);
  assert.equal((await fetch(base + '/api/config')).status, 200);
  await request('events','GET',undefined,401);
  await request('login','POST',{key:'wrong'},401);
  await request('login','POST',{key:process.env.ADMIN_ACCESS_KEY},403,'https://another.example');
  const login = await request('login','POST',{key:process.env.ADMIN_ACCESS_KEY});
  cookie = login.headers.get('set-cookie').split(';')[0];
  await request('session');
  const slug = 'setup-test-' + crypto.randomUUID();
  const settings = {title:'Automated setup rehearsal',slug,scheduledAt:'2026-12-01T10:00:00+08:00',durationSeconds:120,generationCap:80};
  await request('events','POST',{...settings,durationSeconds:30},400);
  const created = await (await request('events','POST',settings,201)).json();
  eventId = created.event.id;
  await request('events','POST',settings,409);
  await request(`events/${eventId}`,'PATCH',{status:'registration'},409);
  await request(`events/${eventId}`,'PATCH',{...settings,durationSeconds:180});
  await request(`events/${eventId}/reference`,'PUT',{mimeType:'image/png',data:'bm90YW5pbWFnZQ=='},400);
  const data = (await readFile('public/challenges/falls.webp')).toString('base64');
  await request(`events/${eventId}/reference`,'PUT',{mimeType:'image/webp',data});
  const image = await request(`events/${eventId}/reference`);
  assert.equal(image.headers.get('content-type'),'image/webp');
  assert.equal(Buffer.from(await image.arrayBuffer()).toString('base64'), data);
  const listing = await (await request('events')).json();
  const saved = listing.events.find(event => event.id === eventId);
  assert.equal(saved.duration_seconds,180);
  assert.equal(saved.has_reference,true);
  assert.equal(new Date(saved.scheduled_at).toISOString(),'2026-12-01T02:00:00.000Z');
  assert.equal(JSON.stringify(listing).includes(data),false);
  await request(`events/${eventId}`,'PATCH',{status:'registration'});
  await request(`events/${eventId}`,'PATCH',settings,409);
  await request(`events/${eventId}/reference`,'PUT',{mimeType:'image/webp',data},409);
  await request(`events/${eventId}`,'PATCH',{status:'live'},400);
  await request(`events/${eventId}`,'PATCH',{status:'draft'});
  await request('logout','POST',{});
  cookie = 'pc_host=invalid';
  await request(`events/${eventId}/reference`,'GET',undefined,401);
  const tables = await sql`select relname,relrowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='promptchamp' and c.relkind='r'`;
  assert.ok(tables.length>=7);
  assert.ok(tables.every(table => table.relrowsecurity));
  const [original] = await sql`select to_regclass('public.players') is not null as players,to_regclass('public.attempts') is not null as attempts`;
  assert.ok(original.players && original.attempts);
  console.log(`PASS: ${checks} API checks, private image access, date conversion, RLS, and legacy tables.`);
} finally {
  if (eventId) await sql.begin(async tx => {
    await tx`delete from promptchamp.audit_events where event_id=${eventId}`;
    await tx`delete from promptchamp.reference_images where event_id=${eventId}`;
    await tx`delete from promptchamp.rounds where event_id=${eventId}`;
    await tx`delete from promptchamp.events where id=${eventId}`;
  });
  await sql.end({timeout:2});
}
