import {entryReference} from './references';
const json=(body:unknown,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'no-store'}});
// Caller has already authenticated the host and checked event/workspace ownership.
export async function presentationApi(sql:any,eventId:string,asset:string|undefined,url:URL){
 const [event]=await sql`select id,title,slug,status,mode,reference_mode from promptchamp.events where id=${eventId}`;
 const [turn]=await sql`select n.id,t.name,n.lucky_number,n.state,n.started_at,n.deadline_at,s.prompt,s.status as processing_status,s.score,s.tip,
  (s.generated_data is not null and s.image_expires_at>clock_timestamp()) as has_image,
  case when n.state='active' and n.deadline_at<=clock_timestamp() then 'expired' else n.state end as display_state
  from promptchamp.round_entries n join promptchamp.teams t on t.id=n.team_id left join promptchamp.submissions s on s.entry_id=n.id
  where n.event_id=${eventId} and n.is_current and (n.state in ('called','active') or n.started_at is not null)
  order by case when n.state in ('called','active') and (n.deadline_at is null or n.deadline_at>clock_timestamp()) then 0 else 1 end,n.started_at desc nulls first,n.queue_position limit 1`;
 if(!asset)return json({event,turn:turn?{...turn,state:turn.display_state}:null,serverNow:Date.now()});
 // Require the displayed turn's ID to avoid serving another team's bytes during a transition.
 if(!turn?.started_at||url.searchParams.get('entry')!==turn.id)return json({error:'Wait for this team to start.'},409);
 const image=asset==='reference'?await entryReference(sql,turn.id):(await sql`select generated_mime as mime_type,generated_data as data from promptchamp.submissions where entry_id=${turn.id} and image_expires_at>clock_timestamp()`)[0];
 return image?.data?new Response(Buffer.from(image.data,'base64'),{headers:{'Content-Type':image.mime_type,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}}):json({error:'Image unavailable.'},404);
}
