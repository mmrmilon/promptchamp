import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { database } from '../../server/database';
import { challenges } from '../../server/challenges';
import { judge, type Picture } from '../../server/image-judging';
import { generate } from '../../server/image-generation';
import eventApi from '../../server/event-api';
import teamApi from '../../server/team-api';

export const config = { path: '/api/*' };
export { startWorker } from '../../server/processing';
const json = (body: unknown, status = 200, headers: Record<string,string> = {}) => Response.json(body,
  { status, headers: { 'Cache-Control': 'no-store', ...headers } });
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const secureCookie = (request: Request) => new URL(request.url).protocol === 'https:' ? '; Secure' : '';

function signature(value: string) {
  return createHmac('sha256', process.env.SESSION_SECRET!).update(value).digest('hex');
}

function session(request: Request) {
  const cookie = request.headers.get('cookie')?.match(/(?:^|;\s*)pm_session=([^;]+)/)?.[1];
  if (!cookie) return null;
  const [id, deadline, tag] = cookie.split('.');
  if (!uuid.test(id) || !/^\d+$/.test(deadline ?? '') || Number(deadline) <= Date.now() ||
      !/^[0-9a-f]{64}$/.test(tag ?? '')) return null;
  return timingSafeEqual(Buffer.from(tag, 'hex'), Buffer.from(signature(id + '.' + deadline), 'hex')) ? id : null;
}

function tryPeriod() {
  const { EVENT_START, EVENT_END, GENERATION_CAP = '100' } = process.env;
  const start = Date.parse(EVENT_START ?? '');
  const end = Date.parse(EVENT_END ?? '');
  const cap = Number(GENERATION_CAP);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start ||
      !Number.isSafeInteger(cap) || cap < 1) throw new Error('Invalid competition dates or cap');
  return { start, end, cap };
}
const conflict: Record<string,string> = {
  closed: 'Submissions are closed.', cap: 'The event has reached its generation limit.',
  limit: 'You have used your generations.', locked: 'Complete all three challenges to unlock the wildcard.',
  pending: 'Finish your pending attempt first.', conflict: 'This request ID cannot be used.',
};

export default async function handler(request: Request) {
  const url = new URL(request.url);
  if (url.pathname.startsWith('/api/admin/')) return eventApi(request);
  if (url.pathname==='/api/events' || url.pathname.startsWith('/api/events/') || url.pathname.startsWith('/api/team/')) return teamApi(request);
  const route = url.pathname.replace(/\/$/, '');
  const method = request.method;
  if (route === '/api/config' && method === 'GET' && process.env.APP_MODE === 'demo') return json({ mode: 'demo' });
  try {
    if (process.env.APP_MODE !== 'live' || !process.env.DATABASE_URL ||
        (process.env.SESSION_SECRET?.length ?? 0) < 32) {
      return json({ error: 'Set APP_MODE=demo locally, or configure live mode.' }, 503);
    }
    const period = tryPeriod();
    if (route === '/api/config' && method === 'GET') return json({ mode: 'live', ...period });
    const sql = database();
    if (method === 'POST' && request.headers.get('origin') && request.headers.get('origin') !== url.origin) {
      return json({ error: 'Origin not allowed.' }, 403);
    }
    if (route === '/api/join' && method === 'POST') {
      const { code, name } = await request.json().catch(() => ({})) ?? {};
      if (typeof code !== 'string' || !/^[a-f0-9]{24}$/.test(code.trim().toLowerCase()) ||
          typeof name !== 'string' || name.trim().length < 2 || name.trim().length > 28) {
        return json({ error: 'Enter a valid invite code and a 2–28 character name.' }, 400);
      }
      const players = await sql`update players set display_name = coalesce(display_name, ${name.trim()})
        where invite_hash = ${digest(code.trim().toLowerCase())} returning id, display_name`;
      if (!players.length) return json({ error: 'Invite code not recognized.' }, 401);
      const key = players[0].id + '.' + (Date.now() + 14 * 86400_000);
      return json({ name: players[0].display_name }, 200,
        { 'Set-Cookie': `pm_session=${key}.${signature(key)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=1209600${secureCookie(request)}` });
    }
    if (route === '/api/leave' && method === 'POST') return json({}, 200,
      { 'Set-Cookie': 'pm_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0' + secureCookie(request) });

    const player = session(request);
    if (route === '/api/leaderboard' && method === 'GET') {
      const round = url.searchParams.get('round');
      if (round && !challenges.some(item => item.id === round)) return json({ error: 'Unknown challenge.' }, 400);
      const rows = await sql`with best as (
          select player_id, challenge_id, max(score) as score from attempts where status='scored'
          and (${round}::text is null or challenge_id = ${round}::text) group by player_id, challenge_id
        ), totals as (
          select player_id, sum(score)::int as total from best group by player_id having count(*) = ${round ? 1 : 3}
        )
        select rank() over(order by total desc)::int as rank, display_name as name, total,
          coalesce(players.id = ${player}::uuid, false) as "isYou"
        from totals join players on players.id = totals.player_id order by rank, name, players.id`;
      return json({ rows });
    }
    if (!player) return json({ error: 'Join with an invite code to play.' }, 401);
    if (route === '/api/me' && method === 'GET') {
      const [account] = await sql`select display_name as name from players where id = ${player}`;
      if (!account) return json({ error: 'Invite no longer exists.' }, 401);
      // A terminated function cannot leave a player waiting indefinitely.
      await sql`update attempts set status=case when image_data is null then 'generation_failed' else 'judge_failed' end,
        updated_at=now() where player_id=${player} and status in ('generating','judging')
        and updated_at < now() - interval '2 minutes'`;
      const rounds = await sql`select challenge_id as round, max(score)::int as best from attempts
        where player_id = ${player} and status = 'scored' group by challenge_id`;
      const [count] = await sql`select count(*)::int as used from attempts where player_id = ${player}`;
      const [pending] = await sql`select id, challenge_id as round,status from attempts where player_id=${player}
        and status in ('generating','judging','judge_failed') limit 1`;
      return json({ ...account, rounds, used: count.used, pending });
    }
    if (route !== '/api/attempts' && route !== '/api/rescore') return json({ error: 'Page not found.' }, 404);
    const id = method === 'GET' ? url.searchParams.get('id') : null;
    const body = method === 'POST' ? await request.json().catch(() => ({})) : {};
    const requestId = id ?? body?.requestId;
    if (typeof requestId !== 'string' || !uuid.test(requestId)) return json({ error: 'Invalid attempt ID.' }, 400);
    const get = async () => {
      const [attempt] = await sql`select id, challenge_id as round, status, score, ratings, tip, prompt,
        image_data as data, image_mime as "mimeType" from attempts where id = ${requestId} and player_id = ${player}`;
      return attempt ? json(attempt) : json({ error: 'Attempt not found.' }, 404);
    };
    if (method === 'GET' && route === '/api/attempts') return get();
    if (method !== 'POST') return json({ error: 'Method not allowed.' }, 405);
    if (!process.env.GEMINI_JUDGE_API_KEY || (route === '/api/attempts' &&
        (!process.env.CLOUDFLARE_ACCOUNT_ID || !process.env.CLOUDFLARE_API_TOKEN))) {
      return json({ error: 'The organizer needs to configure the AI service.' }, 503);
    }

    let picture: Picture;
    let challengeId: string;
    if (route === '/api/rescore') {
      // Keep a bounded grace period for accepted attempts after the event closes.
      const [attempt] = await sql`update attempts set status='judging',updated_at=now()
        where id=${requestId} and player_id=${player} and status='judge_failed'
        and now() < ${new Date(period.end + 3600_000).toISOString()}::timestamptz
        and updated_at < now() - interval '5 seconds'
        returning challenge_id, image_data as data, image_mime as "mimeType"`;
      if (!attempt) return json({ error: 'Scoring retry unavailable. Wait a moment and refresh the attempt.' }, 409);
      challengeId = attempt.challenge_id;
      picture = { data: attempt.data, mimeType: attempt.mimeType };
    } else {
      const prompt = typeof body?.prompt === 'string' ? body.prompt.trim() : '';
      challengeId = body?.challengeId;
      if (prompt.length < 5 || prompt.length > 500 || !challenges.some(item => item.id === challengeId)) {
        return json({ error: 'Choose a challenge and enter a 5–500 character prompt.' }, 400);
      }
      const [reservation] = await sql`select reserve_attempt(${requestId},${player},${challengeId},${prompt},${period.cap},
        ${new Date(period.start).toISOString()},${new Date(period.end).toISOString()}) as result`;
      if (reservation.result === 'duplicate') return get();
      if (reservation.result !== 'reserved') return json({ error: conflict[reservation.result] ?? 'Attempt unavailable.' }, 409);
      try {
        picture = await generate(prompt);
      } catch (error) {
        console.error('Generation failed:', error instanceof Error ? error.message : 'Unknown');
        await sql`update attempts set status='generation_failed',updated_at=now() where id=${requestId} and status='generating'`;
        return get();
      }
      await sql`update attempts set status='judging',image_data=${picture.data},image_mime=${picture.mimeType},updated_at=now()
        where id=${requestId} and status='generating'`;
    }
    try {
      const result = await judge(challenges.find(item => item.id === challengeId)!, picture);
      await sql`update attempts set status='scored',score=${result.score},ratings=${JSON.stringify(result.ratings)}::jsonb,
        tip=${result.tip},image_data=null,image_mime=null,updated_at=now() where id=${requestId} and status='judging'`;
      const response = await get();
      return json({ ...await response.json(), ...picture });
    } catch (error) {
      console.error('Scoring failed:', error instanceof Error ? error.message : 'Unknown');
      await sql`update attempts set status='judge_failed',updated_at=now() where id=${requestId} and status='judging'`;
      return get();
    }
  } catch (error) {
    console.error('Competition request failed:', error instanceof Error ? error.name : 'Unknown');
    return json({ error: 'The competition service is temporarily unavailable.' }, 503);
  }
}
