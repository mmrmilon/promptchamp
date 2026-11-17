import { hostCookie, isHost, validHostKey } from './host-session';
import { eventDb as db } from './event-store';
import { hostQueue } from './team-api';
import { hostResults } from './results-api';
import { aiConfigured,workerReady } from './processing';
import {AccountError,accountContext,legacyAllowed,OFFICE_WORKSPACE,signOutAccount} from './account-session';

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
  if (!process.env.DATABASE_URL || (process.env.SESSION_SECRET?.length ?? 0) < 32) return json({ error: 'Host configuration is incomplete.' }, 503);
  try {
    // Keep request bodies bounded before parsing reference-image uploads.
    const raw = request.method === 'GET' ? '' : await request.text();
    if (raw.length > 2_850_000) return json({ error: 'Upload must be at most 2 MiB.' }, 413);
    let body: any = {};
    try { body = raw ? JSON.parse(raw) : {}; } catch { return json({ error: 'Invalid JSON.' }, 400); }
    if (!body || typeof body !== 'object' || Array.isArray(body)) return json({ error: 'Invalid request.' }, 400);
    if (path === '/api/admin/login' && request.method === 'POST') {
      if(!await legacyAllowed())return json({error:'The shared host key is retired. Sign in with your account.'},403);
      if (!validHostKey(body.key)) return json({ error: 'Host key not recognized.' }, 401);
      return json({}, 200, { 'Set-Cookie': hostCookie(request) });
    }
    if(path==='/api/admin/logout'&&request.method==='POST'){const response=json({});response.headers.append('Set-Cookie',hostCookie(request,true));response.headers.append('Set-Cookie',await signOutAccount(request));return response;}
    let context:any=await accountContext(request);
    if(!context&&isHost(request)&&await legacyAllowed()){
      const [workspace]=await db()`select * from promptchamp.workspaces where id=${OFFICE_WORKSPACE}`;
      context={workspace,workspaceId:workspace.id,role:'owner',legacy:true};
    }
    if(!context)return json({error:'Host sign-in required.'},401);
    const workspace=context.workspace;
    if(workspace.status!=='active'&&request.method!=='GET')return json({error:'This workspace is suspended.'},403);
    const target=path.match(/^\/api\/admin\/events\/([a-f0-9-]{36})(?:\/|$)/i);
    let targetEvent:any;
    if(target){[targetEvent]=await db()`select id,mode from promptchamp.events where id=${target[1]} and workspace_id=${workspace.id}`;if(!targetEvent)return json({error:'Event not found.'},404);}
    if (path === '/api/admin/session' && request.method === 'GET') return json({ authenticated: true,legacy:context.legacy,workspace,role:context.role,aiConfigured:aiConfigured(),workerReady:await workerReady() });
    const sql = db();
    const extra=path.match(/^\/api\/admin\/events\/([a-f0-9-]{36})\/(duplicate|archive|export)$/i);
    if(extra){
      const eventId=extra[1];
      if(extra[2]==='export'&&request.method==='GET'){
        const rows=await sql`select t.name,n.lucky_number,n.state,s.prompt,s.status,s.score,s.tip from promptchamp.round_entries n join promptchamp.teams t on t.id=n.team_id left join promptchamp.submissions s on s.entry_id=n.id where n.event_id=${eventId} and n.is_current order by n.queue_position nulls last`;
        const cell=(value:unknown)=>{let text=String(value??'');if(/^[=+\-@\t\r]/.test(text))text="'"+text;return '"'+text.replaceAll('"','""')+'"';};
        const csv=[['Team','Lucky number','Turn','Prompt','Processing','Score','Feedback'],...rows.map(r=>[r.name,r.lucky_number,r.state,r.prompt,r.status,r.score,r.tip])].map(row=>row.map(cell).join(',')).join('\r\n');
        return new Response(csv,{headers:{'Content-Type':'text/csv; charset=utf-8','Content-Disposition':'attachment; filename="promptchamp-results.csv"','Cache-Control':'no-store'}});
      }
      if(extra[2]==='duplicate'&&request.method==='POST'){
        const event=await sql.begin(async tx=>{const [old]=await tx`select e.*,r.duration_seconds from promptchamp.events e join promptchamp.rounds r on r.event_id=e.id and r.sequence=1 where e.id=${eventId}`;
          const mode=old.mode==='live'&&!workspace.live_enabled?'demo':old.mode;
          const [copy]=await tx`insert into promptchamp.events(title,slug,scheduled_at,generation_cap,team_capacity,workspace_id,mode) values(${(old.title+' (copy)').slice(0,100)},${old.slug.slice(0,70)+'-'+crypto.randomUUID().slice(0,8)},${old.scheduled_at},${old.generation_cap},${old.team_capacity},${workspace.id},${mode}) returning *`;
          await tx`insert into promptchamp.rounds(event_id,duration_seconds) values(${copy.id},${old.duration_seconds})`;
          await tx`insert into promptchamp.reference_images(event_id,mime_type,data) select ${copy.id},mime_type,data from promptchamp.reference_images where event_id=${old.id}`;
          await tx`insert into promptchamp.audit_events(event_id,action) values(${copy.id},'event_duplicated')`;return copy;});return json({event},201);
      }
      if(extra[2]==='archive'&&request.method==='POST'){
        const updated=await sql.begin(async tx=>{const [event]=await tx`select status from promptchamp.events where id=${eventId} for update`;const [teams]=await tx`select count(*)::int as total from promptchamp.teams where event_id=${eventId}`;
          if(event.status!=='completed'&&!(event.status==='draft'&&!teams.total))return false;
          await tx`update promptchamp.events set status='archived',updated_at=now() where id=${eventId}`;await tx`insert into promptchamp.audit_events(event_id,action) values(${eventId},'event_archived')`;return true;});return updated?json({}):json({error:'Archive a completed event or an unused draft.'},409);
      }
      return json({error:'Method not allowed.'},405);
    }
    const results=path.match(/^\/api\/admin\/events\/([a-f0-9-]{36})\/results(?:\/(publish|retry-scoring|retry-generation|void))?$/i);
    if(results)return hostResults(results[1],results[2],request.method,body);
    const control = path.match(/^\/api\/admin\/events\/([a-f0-9-]{36})\/queue(?:\/(lock|next|skip|recall))?$/i);
    if (control) return hostQueue(control[1], control[2], request.method, body);
    if (path === '/api/admin/events' && request.method === 'GET') {
      return json({ workspace,legacy:!!context.legacy,events: await sql`select e.*, r.duration_seconds,
        exists(select 1 from promptchamp.reference_images i where i.event_id=e.id) as has_reference
        from promptchamp.events e join promptchamp.rounds r on r.event_id=e.id and r.sequence=1 where e.workspace_id=${workspace.id}
        order by e.created_at desc` });
    }
    if (path === '/api/admin/events' && request.method === 'POST') {
      const title = typeof body.title === 'string' ? body.title.trim() : '';
      const slug = typeof body.slug === 'string' ? body.slug.trim().toLowerCase() : '';
      const time = Date.parse(body.scheduledAt);
      const mode=body.mode??workspace.default_mode;
      if(!['demo','live'].includes(mode))return json({error:'Choose demo or live mode.'},400);
      if(mode==='live'&&!workspace.live_enabled)return json({error:'Live access needs platform approval.'},403);
      if (title.length < 3 || title.length > 100 || !/^[a-z0-9-]{3,100}$/.test(slug) ||
          !Number.isFinite(time) || ![120,180].includes(body.durationSeconds) ||
          !Number.isInteger(body.generationCap) || body.generationCap < 1 || body.generationCap > 10000 ||
          !Number.isInteger(body.teamCapacity ?? 20) || (body.teamCapacity ?? 20) < 1 || (body.teamCapacity ?? 20) > 100) {
        return json({ error: 'Check the title, event address, date, duration, and budget.' }, 400);
      }
      const [event] = await sql.begin(async tx => {
        const [event] = await tx`insert into promptchamp.events(title,slug,scheduled_at,generation_cap,team_capacity,workspace_id,mode)
          values(${title},${slug},${new Date(time).toISOString()},${body.generationCap},${body.teamCapacity ?? 20},${workspace.id},${mode}) returning *`;
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
      if(body.referenceId){const [image]=await sql`select i.mime_type,i.data from promptchamp.reference_images i join promptchamp.events e on e.id=i.event_id where i.id=${body.referenceId} and e.workspace_id=${workspace.id}`;
        if(!image)return json({error:'Reference not found in this workspace.'},404);body.mimeType=image.mime_type;body.data=image.data;}
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
        const mode=body.mode??targetEvent.mode;
        if(!['demo','live'].includes(mode))return json({error:'Choose demo or live mode.'},400);
        if(mode==='live'&&!workspace.live_enabled)return json({error:'Live access needs platform approval.'},403);
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
            generation_cap=${body.generationCap},team_capacity=${body.teamCapacity ?? 20},mode=${mode},updated_at=now() where id=${id}`;
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
    if(error instanceof AccountError)return json({error:error.message},error.status);
    if (error.code === '23505') return json({ error: 'That event address is already used.' }, 409);
    console.error('Event API failed:', error.code ?? error.name);
    return json({ error: 'The event service is unavailable. Check server configuration and migrations.' }, 503);
  }
}
