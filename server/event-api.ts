import { hostCookie, isHost, validHostKey } from './host-session';
import { eventDb as db } from './event-store';
import { hostQueue } from './team-api';
import { hostResults } from './results-api';
import { aiConfigured,workerReady } from './processing';

const json = (value: unknown, status = 200, headers = {}) => Response.json(value, {
  status, headers: { 'Cache-Control': 'no-store', ...headers },
});
const uuid = /^[a-f0-9-]{36}$/i;

export function referenceImage(mime: unknown, data: unknown) {
  if (typeof data !== 'string' || !data.length || data.length > 2796204 ||
      data.length % 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(data)) return false;
  const bytes = Buffer.from(data, 'base64');
  if (bytes.length > 2 * 1024 * 1024) return false;
  return (mime === 'image/png' && bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) ||
    (mime === 'image/jpeg' && bytes.subarray(0, 3).equals(Buffer.from([255,216,255]))) ||
    (mime === 'image/webp' && bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP');
}

export default async function eventApi(request: Request) {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/$/, '');
  if (request.method !== 'GET' && request.headers.get('origin') !== url.origin) {
    return json({ error: 'Origin not allowed.' }, 403);
  }
  if (!process.env.DATABASE_URL || (process.env.SESSION_SECRET?.length ?? 0) < 32 ||
      (process.env.ADMIN_ACCESS_KEY?.length ?? 0) < 32) return json({ error: 'Host configuration is incomplete.' }, 503);
  try {
    // Keep request bodies bounded before parsing reference-image uploads.
    const raw = request.method === 'GET' ? '' : await request.text();
    if (raw.length > 2_850_000) return json({ error: 'Upload must be at most 2 MiB.' }, 413);
    let body: any = {};
    try { body = raw ? JSON.parse(raw) : {}; } catch { return json({ error: 'Invalid JSON.' }, 400); }
    if (!body || typeof body !== 'object' || Array.isArray(body)) return json({ error: 'Invalid request.' }, 400);
    if (path === '/api/admin/login' && request.method === 'POST') {
      if (!validHostKey(body.key)) return json({ error: 'Host key not recognized.' }, 401);
      return json({}, 200, { 'Set-Cookie': hostCookie(request) });
    }
    if (!isHost(request)) return json({ error: 'Host sign-in required.' }, 401);
    if (path === '/api/admin/logout' && request.method === 'POST') return json({}, 200, { 'Set-Cookie': hostCookie(request, true) });
    if (path === '/api/admin/session' && request.method === 'GET') return json({ authenticated: true,aiConfigured:aiConfigured(),workerReady:await workerReady() });
    const sql = db();
    const results=path.match(/^\/api\/admin\/events\/([a-f0-9-]{36})\/results(?:\/(publish|retry-scoring|retry-generation|void))?$/i);
    if(results)return hostResults(results[1],results[2],request.method,body);
    const control = path.match(/^\/api\/admin\/events\/([a-f0-9-]{36})\/queue(?:\/(lock|next|skip|recall))?$/i);
    if (control) return hostQueue(control[1], control[2], request.method, body);
    if (path === '/api/admin/events' && request.method === 'GET') {
      return json({ events: await sql`select e.*, r.duration_seconds,
        exists(select 1 from promptchamp.reference_images i where i.event_id=e.id) as has_reference
        from promptchamp.events e join promptchamp.rounds r on r.event_id=e.id and r.sequence=1
        order by e.created_at desc` });
    }
    if (path === '/api/admin/events' && request.method === 'POST') {
      const title = typeof body.title === 'string' ? body.title.trim() : '';
      const slug = typeof body.slug === 'string' ? body.slug.trim().toLowerCase() : '';
      const time = Date.parse(body.scheduledAt);
      if (title.length < 3 || title.length > 100 || !/^[a-z0-9-]{3,100}$/.test(slug) ||
          !Number.isFinite(time) || ![120,180].includes(body.durationSeconds) ||
          !Number.isInteger(body.generationCap) || body.generationCap < 1 || body.generationCap > 10000 ||
          !Number.isInteger(body.teamCapacity ?? 20) || (body.teamCapacity ?? 20) < 1 || (body.teamCapacity ?? 20) > 100) {
        return json({ error: 'Check the title, event address, date, duration, and budget.' }, 400);
      }
      const [event] = await sql.begin(async tx => {
        const [event] = await tx`insert into promptchamp.events(title,slug,scheduled_at,generation_cap,team_capacity)
          values(${title},${slug},${new Date(time).toISOString()},${body.generationCap},${body.teamCapacity ?? 20}) returning *`;
        await tx`insert into promptchamp.rounds(event_id,duration_seconds) values(${event.id},${body.durationSeconds})`;
        await tx`insert into promptchamp.audit_events(event_id,action) values(${event.id},'event_created')`;
        return [event];
      });
      return json({ event }, 201);
    }
    const match = path.match(/^\/api\/admin\/events\/([^/]+)(\/reference)?$/);
    if (!match || !uuid.test(match[1])) return json({ error: 'Page not found.' }, 404);
    const id = match[1];
    if (match[2] && request.method === 'GET') {
      const [image] = await sql`select mime_type,data from promptchamp.reference_images where event_id=${id}`;
      return image ? new Response(Buffer.from(image.data, 'base64'), { headers: {
        'Content-Type': image.mime_type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
      } }) : json({ error: 'Reference not found.' }, 404);
    }
    if (match[2] && request.method === 'PUT') {
      if (!referenceImage(body.mimeType, body.data)) return json({ error: 'Choose a PNG, JPEG, or WebP image under 2 MiB.' }, 400);
      const updated = await sql.begin(async tx => {
        const [event] = await tx`select status from promptchamp.events where id=${id} for update`;
        if (!event || event.status !== 'draft') return false;
        await tx`insert into promptchamp.reference_images(event_id,mime_type,data) values(${id},${body.mimeType},${body.data})
          on conflict(event_id) do update set mime_type=excluded.mime_type,data=excluded.data`;
        await tx`insert into promptchamp.audit_events(event_id,action) values(${id},'reference_uploaded')`;
        return true;
      });
      return updated ? json({}) : json({ error: 'Only draft events can change their reference.' }, 409);
    }
    if (!match[2] && request.method === 'PATCH') {
      if (body.status === undefined) {
        const title = typeof body.title === 'string' ? body.title.trim() : '';
        const time = Date.parse(body.scheduledAt);
        if (title.length < 3 || title.length > 100 || !Number.isFinite(time) ||
            ![120,180].includes(body.durationSeconds) || !Number.isInteger(body.generationCap) ||
            body.generationCap < 1 || body.generationCap > 10000 || !Number.isInteger(body.teamCapacity ?? 20) ||
            (body.teamCapacity ?? 20) < 1 || (body.teamCapacity ?? 20) > 100) return json({ error: 'Check the event settings.' }, 400);
        const changed = await sql.begin(async tx => {
          const [event] = await tx`select status from promptchamp.events where id=${id} for update`;
          if (!event || event.status !== 'draft') return false;
          const [count] = await tx`select count(*)::int as total from promptchamp.teams where event_id=${id}`;
          if (count.total) return false;
          await tx`update promptchamp.events set title=${title},scheduled_at=${new Date(time).toISOString()},
            generation_cap=${body.generationCap},team_capacity=${body.teamCapacity ?? 20},updated_at=now() where id=${id}`;
          await tx`update promptchamp.rounds set duration_seconds=${body.durationSeconds} where event_id=${id} and sequence=1`;
          await tx`insert into promptchamp.audit_events(event_id,action) values(${id},'settings_updated')`;
          return true;
        });
        return changed ? json({}) : json({ error: 'Only draft events can change settings.' }, 409);
      }
      if (!['draft','registration'].includes(body.status)) return json({ error: 'Only draft and registration are available in this setup release.' }, 400);
      const changed = await sql.begin(async tx => {
        const [event] = await tx`select status from promptchamp.events where id=${id} for update`;
        if (!event || !['draft','registration'].includes(event.status)) return false;
        const [count] = await tx`select count(*)::int as total from promptchamp.teams where event_id=${id}`;
        if (body.status === 'draft' && count.total) return false;
        const [image] = await tx`select id from promptchamp.reference_images where event_id=${id}`;
        if (body.status === 'registration' && !image) return false;
        await tx`update promptchamp.events set status=${body.status},updated_at=now() where id=${id}`;
        await tx`insert into promptchamp.audit_events(event_id,action,metadata)
          values(${id},'status_changed',${JSON.stringify({ from: event.status, to: body.status })}::jsonb)`;
        return true;
      });
      return changed ? json({}) : json({ error: 'Event unavailable or missing its reference image.' }, 409);
    }
    return json({ error: 'Method not allowed.' }, 405);
  } catch (error: any) {
    if (error.code === '23505') return json({ error: 'That event address is already used.' }, 409);
    console.error('Event API failed:', error.code ?? error.name);
    return json({ error: 'The event service is unavailable. Check server configuration and migrations.' }, 503);
  }
}
