import { createHash, randomBytes } from 'node:crypto';
import { eventDb } from './event-store';
import { queueGeneration, wakeWorker, workerReady } from './processing';

const json = (value: unknown, status = 200, headers = {}) => Response.json(value, { status, headers: { 'Cache-Control':'no-store', ...headers } });
const hash = (text: string) => createHash('sha256').update(text).digest('hex');
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
class RuleError extends Error { constructor(message: string, public status = 409) { super(message); } }
function cookie(request: Request, id: string, token: string) {
  return `pc_team_${id.replaceAll('-','')}=${token}; Path=/api/team/${id}; HttpOnly; SameSite=Lax; Max-Age=86400${new URL(request.url).protocol === 'https:' ? '; Secure' : ''}`;
}
async function teamSession(request: Request, eventId: string) {
  const token = request.headers.get('cookie')?.match(new RegExp(`(?:^|;\\s*)pc_team_${eventId.replaceAll('-','')}=([a-f0-9]{64})(?:;|$)`))?.[1];
  if (!token) return null;
  const [team] = await eventDb()`select t.id,t.name from promptchamp.team_sessions s join promptchamp.teams t on t.id=s.team_id
    where s.token_hash=${hash(token)} and s.expires_at>clock_timestamp() and s.revoked_at is null
    and t.event_id=${eventId} and t.status='active'`;
  return team ?? null;
}
async function expire(tx: any, id: string) {
  await tx`update promptchamp.round_entries set state='expired' where event_id=${id} and is_current
    and state='active' and deadline_at<=clock_timestamp()`;
}
async function queue(sql: any, id: string) {
  return sql`select n.id,t.name,n.lucky_number,n.queue_position,n.state,n.started_at,n.deadline_at
    from promptchamp.round_entries n join promptchamp.teams t on t.id=n.team_id
    where n.event_id=${id} and n.is_current order by n.queue_position nulls last,n.lucky_number nulls last,t.name`;
}
function failure(error: any) {
  if (error instanceof RuleError) return json({error:error.message},error.status);
  if (error.message==='GENERATION_CAP') return json({error:'The event image limit has been reached. Ask the host for help.'},409);
  if (error.code === '23505') return json({error:'That team name or lucky number was just taken. Refresh and try again.'},409);
  console.error('Team event service failed:',error.code ?? error.name);
  return json({error:'The event service is temporarily unavailable.'},503);
}

export async function hostQueue(id: string, action: string | undefined, method: string, body: any) {
  try {
    const sql = eventDb();
    if (!action && method === 'GET') {
      await expire(sql,id);
      return json({queue:await queue(sql,id),serverNow:Date.now()});
    }
    if (method !== 'POST') return json({error:'Method not allowed.'},405);
    await sql.begin(async tx => {
      const [event] = await tx`select * from promptchamp.events where id=${id} for update`;
      if (!event) throw new RuleError('Event not found.',404);
      const [round] = await tx`select * from promptchamp.rounds where event_id=${id} and sequence=1 for update`;
      await expire(tx,id);
      if (action === 'lock') {
        if (event.status === 'live' && round.draw_locked_at) return;
        if (event.status !== 'registration') throw new RuleError('Open registration before locking the draw.');
        const entries = await tx`select id,lucky_number from promptchamp.round_entries where round_id=${round.id} and is_current`;
        if (!entries.length || entries.some(e => !e.lucky_number)) throw new RuleError('Every registered team must choose a number first.');
        await tx`with ordered as (select id,row_number() over(order by lucky_number)::int as position
          from promptchamp.round_entries where round_id=${round.id} and is_current)
          update promptchamp.round_entries e set queue_position=o.position from ordered o where e.id=o.id`;
        await tx`update promptchamp.rounds set status='open',draw_locked_at=clock_timestamp() where id=${round.id}`;
        await tx`update promptchamp.events set status='live',updated_at=now() where id=${id}`;
      } else {
        if (event.status !== 'live' || !round.draw_locked_at) throw new RuleError('Lock the draw first.');
        if (action === 'next') {
          const active = await tx`select id from promptchamp.round_entries where round_id=${round.id} and is_current and state in ('called','active')`;
          if (active.length) throw new RuleError('The current team must submit, expire, or be skipped first.');
          const [next] = await tx`select id from promptchamp.round_entries where round_id=${round.id} and is_current and state='waiting' order by queue_position limit 1`;
          if (!next) throw new RuleError('No waiting teams remain.');
          await tx`update promptchamp.round_entries set state='called' where id=${next.id}`;
        } else if (action === 'skip' || action === 'recall') {
          if (!uuid.test(body.entryId ?? '')) throw new RuleError('Choose a team.',400);
          const [entry] = await tx`select * from promptchamp.round_entries where id=${body.entryId} and event_id=${id} and is_current for update`;
          if (!entry) throw new RuleError('Team turn not found.',404);
          if (action === 'skip' && entry.state !== 'called') throw new RuleError('Only a called team can be skipped before starting.');
          if (action === 'recall' && entry.state !== 'withdrawn') throw new RuleError('Only a skipped team can return to the queue.');
          await tx`update promptchamp.round_entries set state=${action === 'skip' ? 'withdrawn':'waiting'} where id=${entry.id}`;
        } else throw new RuleError('Unknown queue action.',404);
      }
      await tx`insert into promptchamp.audit_events(event_id,action,metadata) values(${id},${'queue_'+action},${JSON.stringify({entryId:body.entryId ?? null})}::jsonb)`;
    });
    return json({queue:await queue(sql,id)});
  } catch(error) { return failure(error); }
}

export default async function teamApi(request: Request) {
  const url = new URL(request.url);
  if (request.method !== 'GET' && request.headers.get('origin') !== url.origin) return json({error:'Origin not allowed.'},403);
  if (!process.env.DATABASE_URL) return json({error:'Event database is not configured.'},503);
  try {
    const sql = eventDb();
    if(url.pathname==='/api/events'&&request.method==='GET')return json({events:await sql`select title,slug,status,scheduled_at from promptchamp.events where status in ('registration','live','completed') order by scheduled_at desc limit 50`});
    const leaderboardPath=url.pathname.match(/^\/api\/events\/([a-z0-9-]{3,100})\/leaderboard$/);
    if(leaderboardPath && request.method==='GET') {
      const [event]=await sql`select id,title,results_visibility from promptchamp.events where slug=${leaderboardPath[1]} and status in ('registration','live','completed')`;
      if(!event) return json({error:'Event not found.'},404);
      if(event.results_visibility!=='released') return json({title:event.title,released:false,rows:[]});
      const rows=await sql`select rank() over(order by s.score desc)::int as rank,t.name,s.score
        from promptchamp.submissions s join promptchamp.round_entries n on n.id=s.entry_id join promptchamp.teams t on t.id=n.team_id
        where s.event_id=${event.id} and s.status='scored' and n.is_current and t.status='active' order by rank,t.name`;
      return json({title:event.title,released:true,rows});
    }
    const publicPath = url.pathname.match(/^\/api\/events\/([a-z0-9-]{3,100})$/);
    if (publicPath && request.method === 'GET') {
      const [event] = await sql`select e.id,e.slug,e.title,e.status,e.scheduled_at,e.team_capacity,r.duration_seconds
        from promptchamp.events e join promptchamp.rounds r on r.event_id=e.id and r.sequence=1
        where e.slug=${publicPath[1]} and e.status in ('registration','live','completed')`;
      return event ? json({event}) : json({error:'This event is not open yet. Check the link with your host.'},404);
    }
    const match = url.pathname.match(/^\/api\/team\/([^/]+)\/(register|recover|state|number|start|draft|submit|reference|image)$/);
    if (!match || !uuid.test(match[1])) return json({error:'Page not found.'},404);
    const [,id,action] = match;
    const allowed = ['state','reference','image'].includes(action) ? 'GET' : action === 'draft' ? 'PUT':'POST';
    if (request.method !== allowed) return json({error:'Method not allowed.'},405);
    const raw = request.method === 'GET' ? '' : await request.text();
    if (raw.length>5000) return json({error:'Request too large.'},413);
    let body: any;
    try { body = raw ? JSON.parse(raw):{}; } catch { return json({error:'Invalid JSON.'},400); }
    if (!body || typeof body !== 'object' || Array.isArray(body)) return json({error:'Invalid request.'},400);
    if (action === 'register' || action === 'recover') {
      const name = typeof body.name === 'string' ? body.name.trim():'';
      const recoveryCode = action === 'register' ? randomBytes(16).toString('hex'):String(body.recoveryCode ?? '').trim();
      const token = randomBytes(32).toString('hex');
      if (name.length<2 || name.length>50) throw new RuleError('Enter a team name with 2–50 characters.',400);
      if (action === 'register' && await teamSession(request,id)) throw new RuleError('This browser already has a team for this event.');
      const team = await sql.begin(async tx => {
        const [event] = await tx`select * from promptchamp.events where id=${id} for update`;
        if (!event || !['registration','live','completed'].includes(event.status)) throw new RuleError('This event is not accepting teams.');
        let team;
        if (action === 'register') {
          if (event.status !== 'registration') throw new RuleError('Registration has closed.');
          const [count] = await tx`select count(*)::int as total from promptchamp.teams where event_id=${id}`;
          if (count.total>=event.team_capacity) throw new RuleError('The event is full.');
          [team] = await tx`insert into promptchamp.teams(event_id,name,recovery_code_hash) values(${id},${name},${hash(recoveryCode)}) returning id,name`;
          const [round] = await tx`select id from promptchamp.rounds where event_id=${id} and sequence=1`;
          await tx`insert into promptchamp.round_entries(event_id,round_id,team_id) values(${id},${round.id},${team.id})`;
        } else {
          [team] = await tx`select id,name from promptchamp.teams where event_id=${id} and name_key=lower(${name}) and recovery_code_hash=${hash(recoveryCode)} and status='active'`;
          if (!team) throw new RuleError('Team name or recovery code not recognized.',401);
        }
        await tx`insert into promptchamp.team_sessions(team_id,token_hash,expires_at) values(${team.id},${hash(token)},clock_timestamp()+interval '1 day')`;
        return team;
      });
      return json({team,...(action==='register'?{recoveryCode}:{})},action==='register'?201:200,{'Set-Cookie':cookie(request,id,token)});
    }
    const team = await teamSession(request,id);
    if (!team) return json({error:'Join or recover your team to continue.'},401);
    if (action === 'state') {
      await expire(sql,id);
      const [entry] = await sql`select n.id,n.state,n.lucky_number,n.queue_position,n.started_at,n.deadline_at,n.draft_prompt,n.draft_version,
        s.id as submission_id,s.prompt as submitted_prompt,s.status as submission_status,s.score,s.ratings,s.tip,
        (s.generated_data is not null) as has_image
        from promptchamp.round_entries n left join promptchamp.submissions s on s.entry_id=n.id where n.team_id=${team.id} and n.is_current`;
      const [clock] = await sql`select clock_timestamp() as now`;
      const [event] = await sql`select status,team_capacity,results_visibility from promptchamp.events where id=${id}`;
      return json({team,entry,event,queue:await queue(sql,id),serverNow:new Date(clock.now).getTime()});
    }
    if (action === 'reference') {
      const [image] = await sql`select i.mime_type,i.data from promptchamp.reference_images i join promptchamp.round_entries n on n.event_id=i.event_id
        where n.event_id=${id} and n.team_id=${team.id} and n.is_current and n.started_at is not null`;
      return image ? new Response(Buffer.from(image.data,'base64'),{headers:{'Content-Type':image.mime_type,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}}):json({error:'The reference is revealed when your turn starts.'},403);
    }
    if(action==='image') {
      const [image]=await sql`select s.generated_data as data,s.generated_mime as mime_type from promptchamp.submissions s
        join promptchamp.round_entries n on n.id=s.entry_id where n.team_id=${team.id} and n.is_current and s.generated_data is not null`;
      return image?new Response(Buffer.from(image.data,'base64'),{headers:{'Content-Type':image.mime_type,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}}):json({error:'The generated image is not available.'},404);
    }
    const ready=['start','submit'].includes(action)?await workerReady():true;
    // All turn mutations share the event lock with host queue changes and registration.
    const result = await sql.begin(async tx => {
      const [event] = await tx`select * from promptchamp.events where id=${id} for update`;
      const [entry] = await tx`select * from promptchamp.round_entries where team_id=${team.id} and is_current for update`;
      if (!entry) throw new RuleError('Turn not found.',404);
      if (action === 'number') {
        if (event.status !== 'registration') throw new RuleError('The draw is locked.');
        if (!Number.isInteger(body.number) || body.number<1 || body.number>event.team_capacity) throw new RuleError('Choose an available number.',400);
        await tx`update promptchamp.round_entries set lucky_number=${body.number} where id=${entry.id}`;
        return {};
      }
      if (action === 'submit') {
        if (!uuid.test(body.requestId ?? '')) throw new RuleError('Invalid submission ID.',400);
        const [prior] = await tx`select id,prompt,status from promptchamp.submissions where entry_id=${entry.id}`;
        if (prior) return {submission:prior};
      }
      if (event.status !== 'live') throw new RuleError('The host has not started this event.');
      if (action === 'start') {
        if (entry.started_at) return {startedAt:entry.started_at,deadlineAt:entry.deadline_at};
        if (entry.state !== 'called') throw new RuleError('Wait for the host to call your team.');
        if(!ready)throw new RuleError('AI processing is not ready. Ask the host before starting.',503);
        const [round] = await tx`select duration_seconds from promptchamp.rounds where id=${entry.round_id}`;
        const [turn] = await tx`update promptchamp.round_entries set state='active',started_at=clock_timestamp(),
          deadline_at=clock_timestamp()+${round.duration_seconds}*interval '1 second' where id=${entry.id} returning started_at,deadline_at`;
        return {startedAt:turn.started_at,deadlineAt:turn.deadline_at};
      }
      const prompt = typeof body.prompt === 'string' ? body.prompt.trim():'';
      if (prompt.length>1000 || (action==='submit' && prompt.length<5)) throw new RuleError('Write a prompt with 5–1,000 characters.',400);
      if (entry.state !== 'active') throw new RuleError('This turn is not accepting prompts.');
      if (action === 'draft') {
        if (!Number.isInteger(body.version) || body.version !== entry.draft_version) throw new RuleError('A newer draft exists. Refresh to recover it.');
        const [saved] = await tx`update promptchamp.round_entries set draft_prompt=${prompt},draft_version=draft_version+1
          where id=${entry.id} and deadline_at>clock_timestamp() returning draft_version`;
        if (!saved) throw new RuleError('Time is up. Your draft was not submitted.');
        return {version:saved.draft_version};
      }
      if (action === 'submit') {
        if(!ready)throw new RuleError('AI processing is temporarily offline. Ask the host for help.',503);
        const [accepted] = await tx`insert into promptchamp.submissions(entry_id,event_id,request_id,prompt)
          select ${entry.id},${id},${body.requestId},${prompt} where ${entry.deadline_at}::timestamptz>clock_timestamp() returning id,prompt,status`;
        if (!accepted) throw new RuleError('Time is up. Submission was not accepted.');
        await queueGeneration(tx,accepted.id,id,event.generation_cap);
        await tx`update promptchamp.round_entries set state='submitted',draft_prompt=${prompt} where id=${entry.id}`;
        return {submission:accepted};
      }
      throw new RuleError('Unknown action.',404);
    });
    if(action==='submit')await wakeWorker();
    return json(result);
  } catch(error) { return failure(error); }
}
