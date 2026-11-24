import { randomUUID, createHmac, timingSafeEqual } from 'node:crypto';
import { eventDb } from './event-store';
import { generate } from './image-generation';
import { judgeReference } from './image-judging';
import {entryReference} from './references';

export const aiConfigured = () => !!(process.env.CLOUDFLARE_ACCOUNT_ID && process.env.CLOUDFLARE_API_TOKEN && process.env.GEMINI_JUDGE_API_KEY);
const hosted = () => !!(process.env.URL && process.env.SITE_ID);

export async function workerReady() {
  if (hosted()) return aiConfigured();
  const [ready] = await eventDb()`select exists(select 1 from promptchamp.worker_heartbeats where last_seen>clock_timestamp()-interval '90 seconds') as ready`;
  return aiConfigured() && ready.ready;
}

export function workerAuthorization() {
  return createHmac('sha256',process.env.SESSION_SECRET!).update('promptchamp-worker-v1').digest('hex');
}
export function authorizedWorker(request: Request) {
  if ((process.env.SESSION_SECRET?.length??0)<32) return false;
  const key=request.headers.get('x-processing-key')??'';
  return /^[a-f0-9]{64}$/.test(key) && timingSafeEqual(Buffer.from(key,'hex'),Buffer.from(workerAuthorization(),'hex'));
}
export async function wakeWorker() {
  if (!hosted()) return;
  try {
    const response=await fetch(new URL('/.netlify/functions/process-queue-background',process.env.URL),{
      method:'POST',headers:{'x-processing-key':workerAuthorization()},signal:AbortSignal.timeout(5000),
    });
    if(!response.ok) console.error('Background invocation failed:',response.status);
  }catch { console.error('Background invocation unavailable; scheduled fallback will retry.'); }
}
export async function runQueueBatch() {
  if(!aiConfigured()) throw new Error('AI credentials are missing');
  const end=Date.now()+8*60_000;
  for(let count=0;count<20 && Date.now()<end;count++) if(!await processNext())break;
}

export async function queueGeneration(tx: any, submissionId: string, eventId: string, cap: number) {
  // Callers must hold the event row lock. Reservation, job, and submission commit together.
  const [workspace]=await tx`select w.* from promptchamp.workspaces w join promptchamp.events e on e.workspace_id=w.id where e.id=${eventId} for update of w`;
  if(!workspace||workspace.status!=='active'||!workspace.live_enabled)throw new Error('WORKSPACE_ACCESS');
  const [monthly]=await tx`select count(*)::int as total from promptchamp.generation_reservations g join promptchamp.events e on e.id=g.event_id
    where e.workspace_id=${workspace.id} and g.created_at>=date_trunc('month',now() at time zone 'UTC') at time zone 'UTC'`;
  if(monthly.total>=workspace.monthly_generation_limit)throw new Error('WORKSPACE_CAP');
  const [used] = await tx`select count(*)::int as total from promptchamp.generation_reservations where event_id=${eventId}`;
  if (used.total >= cap) throw new Error('GENERATION_CAP');
  const [job] = await tx`insert into promptchamp.processing_jobs(submission_id,kind) values(${submissionId},'generate') returning id`;
  await tx`insert into promptchamp.generation_reservations(event_id,submission_id,job_id) values(${eventId},${submissionId},${job.id})`;
}

export async function processNext(providers = {generate,judge:judgeReference}, submissionScope?: string) {
  const sql = eventDb();
  const token = randomUUID();
  const job = await sql.begin(async tx => {
    // A lost worker may already have sent a generation request. Never repeat it automatically.
    const lost = await tx`update promptchamp.processing_jobs set state='needs_review',updated_at=now()
      where state='running' and lease_until<clock_timestamp() and (${submissionScope??null}::uuid is null or submission_id=${submissionScope??null}::uuid) returning submission_id,kind`;
    for (const item of lost) await tx`update promptchamp.submissions set status=${item.kind==='generate'?'needs_review':'judge_failed'},updated_at=now() where id=${item.submission_id}`;
    const [job] = await tx`select * from promptchamp.processing_jobs where state='queued' and (${submissionScope??null}::uuid is null or submission_id=${submissionScope??null}::uuid) order by created_at for update skip locked limit 1`;
    if (!job) return null;
    await tx`update promptchamp.processing_jobs set state='running',lease_token=${token},lease_until=clock_timestamp()+interval '90 seconds',updated_at=now() where id=${job.id}`;
    await tx`update promptchamp.submissions set status=${job.kind==='generate'?'generating':'judging'},updated_at=now() where id=${job.submission_id}`;
    return job;
  });
  if (!job) return false;
  try {
    const [submission] = await sql`select s.*,e.mode,w.status as workspace_status,w.live_enabled from promptchamp.submissions s
      join promptchamp.events e on e.id=s.event_id join promptchamp.workspaces w on w.id=e.workspace_id where s.id=${job.submission_id}`;
    if (!submission) throw new Error('Submission reference unavailable');
    const reference=await entryReference(sql,submission.entry_id);if(!reference)throw new Error('Assigned reference unavailable');
    if(submission.mode!=='live'||submission.workspace_status!=='active'||!submission.live_enabled)throw new Error('Workspace live access unavailable');
    const result = job.kind==='generate' ? await providers.generate(submission.prompt) :
      await providers.judge({mimeType:reference.mime_type,data:reference.data},{mimeType:submission.generated_mime,data:submission.generated_data});
    await sql.begin(async tx => {
      const [owned] = await tx`select id from promptchamp.processing_jobs where id=${job.id} and state='running' and lease_token=${token} and lease_until>clock_timestamp() for update`;
      if (!owned) return;
      if (job.kind==='generate') {
        const picture = result as Awaited<ReturnType<typeof generate>>;
        await tx`update promptchamp.submissions set status='judging',generated_data=${picture.data},generated_mime=${picture.mimeType},updated_at=now() where id=${submission.id}`;
        await tx`insert into promptchamp.processing_jobs(submission_id,kind) values(${submission.id},'judge')`;
      } else {
        const evaluation = result as Awaited<ReturnType<typeof judgeReference>>;
        await tx`insert into promptchamp.evaluations(submission_id,model,rubric_version,score,ratings,tip)
          values(${submission.id},'gemini-3.5-flash-lite','visual-match-v1',${evaluation.score},${JSON.stringify(evaluation.ratings)}::jsonb,${evaluation.tip})`;
        await tx`update promptchamp.submissions set status='scored',score=${evaluation.score},ratings=${JSON.stringify(evaluation.ratings)}::jsonb,
          tip=${evaluation.tip},image_expires_at=now()+interval '30 days',updated_at=now() where id=${submission.id}`;
        await tx`update promptchamp.round_entries set state='completed' where id=${submission.entry_id}`;
      }
      await tx`update promptchamp.processing_jobs set state='succeeded',updated_at=now() where id=${job.id} and lease_token=${token}`;
    });
  } catch(error) {
    console.error('AI processing failed:',job.kind,error instanceof Error ? error.name:'Unknown');
    await sql.begin(async tx => {
      const [owned] = await tx`update promptchamp.processing_jobs set state=${job.kind==='generate'?'needs_review':'failed'},updated_at=now()
        where id=${job.id} and state='running' and lease_token=${token} returning id`;
      if (owned) await tx`update promptchamp.submissions set status=${job.kind==='generate'?'needs_review':'judge_failed'},updated_at=now() where id=${job.submission_id}`;
    });
  }
  return true;
}

export function startWorker() {
  if (!aiConfigured() || process.env.PROCESS_AI==='false') return () => {};
  const id = randomUUID();let stopped=false;
  const sql = eventDb();
  const heartbeat = async () => { await sql`insert into promptchamp.worker_heartbeats(id) values(${id}) on conflict(id) do update set last_seen=clock_timestamp()`; };
  const timer = setInterval(()=>void heartbeat().catch(()=>{}),10_000);
  void(async()=>{
    while(!stopped) {
      try {await heartbeat();const worked=await processNext();
        await sql`update promptchamp.submissions set generated_data=null,generated_mime=null where image_expires_at<clock_timestamp() and generated_data is not null`;
        if(!worked)await new Promise(resolve=>setTimeout(resolve,2000));
      }catch(error){console.error('Processing worker unavailable:',error instanceof Error?error.name:'Unknown');await new Promise(resolve=>setTimeout(resolve,5000));}
    }
  })();
  return () => {stopped=true;clearInterval(timer);void sql`delete from promptchamp.worker_heartbeats where id=${id}`.catch(()=>{});};
}
