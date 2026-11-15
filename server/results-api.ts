import { eventDb } from './event-store';
import { queueGeneration,wakeWorker } from './processing';
const json=(body:unknown,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'no-store'}});

export async function hostResults(eventId:string,action:string|undefined,method:string,body:any) {
  const sql=eventDb();
  if(!action&&method==='GET') {
    const rows=await sql`select n.id as entry_id,t.name,n.state,s.id as submission_id,s.status,s.score,s.tip,s.prompt
      from promptchamp.round_entries n join promptchamp.teams t on t.id=n.team_id left join promptchamp.submissions s on s.entry_id=n.id
      where n.event_id=${eventId} and n.is_current order by n.queue_position nulls last,t.name`;
    const [usage]=await sql`select e.generation_cap,e.results_visibility,(select count(*)::int from promptchamp.generation_reservations g where g.event_id=e.id) as used
      from promptchamp.events e where e.id=${eventId}`;
    return json({rows,usage});
  }
  if(method!=='POST')return json({error:'Method not allowed.'},405);
  try{
    await sql.begin(async tx=>{
      const [event]=await tx`select * from promptchamp.events where id=${eventId} for update`;
      if(!event)throw new Error('Event not found.');
      if(action==='publish') {
        if(event.status==='completed'&&event.results_visibility==='released')return;
        if(event.status!=='live')throw new Error('Start the event before publishing results.');
        await tx`update promptchamp.round_entries set state='expired' where event_id=${eventId} and is_current and state='active' and deadline_at<=clock_timestamp()`;
        const unfinished=await tx`select n.id from promptchamp.round_entries n left join promptchamp.submissions s on s.entry_id=n.id
          where n.event_id=${eventId} and n.is_current and (n.state in ('waiting','called','active') or (s.id is not null and s.status not in ('scored','voided')))`;
        if(unfinished.length)throw new Error('Finish all turns and resolve pending or failed results before publication.');
        await tx`update promptchamp.events set status='completed',results_visibility='released',updated_at=now() where id=${eventId}`;
        await tx`update promptchamp.rounds set status='closed' where event_id=${eventId}`;
      } else {
        if(event.results_visibility==='released')throw new Error('Published results are locked.');
        if(action?.startsWith('retry-')){const [workspace]=await tx`select status,live_enabled from promptchamp.workspaces where id=${event.workspace_id}`;if(event.mode!=='live'||workspace.status!=='active'||!workspace.live_enabled)throw new Error('Live processing is not enabled for this workspace.');}
        if(!/^[a-f0-9-]{36}$/i.test(body.submissionId??''))throw new Error('Select a submission.');
        const [submission]=await tx`select * from promptchamp.submissions where id=${body.submissionId} and event_id=${eventId} for update`;
        if(!submission)throw new Error('Submission not found.');
        const active=await tx`select id from promptchamp.processing_jobs where submission_id=${submission.id} and state in ('queued','running')`;
        if(active.length)throw new Error('This submission is still processing.');
        if(action==='retry-scoring') {
          if(submission.status!=='judge_failed'||!submission.generated_data)throw new Error('Only failed judging with a saved image can be retried.');
          await tx`insert into promptchamp.processing_jobs(submission_id,kind) values(${submission.id},'judge')`;
          await tx`update promptchamp.submissions set status='judging',updated_at=now() where id=${submission.id}`;
        }else if(action==='retry-generation'||action==='void') {
          if(typeof body.reason!=='string'||body.reason.trim().length<5||body.reason.length>300)throw new Error('Enter a brief reason (5–300 characters) for this action.');
          if(!['needs_review','generation_failed','judge_failed'].includes(submission.status))throw new Error('Only a failed or unprocessed submission can be resolved.');
          if(action==='retry-generation') {
            await queueGeneration(tx,submission.id,eventId,event.generation_cap);
            await tx`update promptchamp.submissions set status='queued',generated_data=null,generated_mime=null,updated_at=now() where id=${submission.id}`;
          }else{
            await tx`update promptchamp.submissions set status='voided',updated_at=now() where id=${submission.id}`;
            await tx`update promptchamp.round_entries set state='completed' where id=${submission.entry_id}`;
          }
        }else throw new Error('Unknown results action.');
      }
      await tx`insert into promptchamp.audit_events(event_id,action,metadata) values(${eventId},${'results_'+action},${JSON.stringify({submissionId:body.submissionId??null,reason:body.reason??null})}::jsonb)`;
    });
    if(action?.startsWith('retry-'))await wakeWorker();
    return json({});
  }catch(error:any){
    if(error.code){console.error('Results API failed:',error.code);return json({error:'Could not update results.'},503);}
    return json({error:error.message==='GENERATION_CAP'?'The event image limit has been reached.':error.message==='WORKSPACE_CAP'?'The workspace monthly AI allowance has been reached.':error.message==='WORKSPACE_ACCESS'?'Workspace live access is not available.':error.message},409);
  }
}
