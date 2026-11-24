import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import postgres from 'postgres';
import sharp from 'sharp';
const url=new URL(process.env.DATABASE_URL??'postgresql://localhost/invalid');
if(process.env.CI!=='true'||!['localhost','127.0.0.1'].includes(url.hostname)||url.pathname!=='/promptchamp_ci')throw new Error('Random-reference tests require the disposable CI database.');
const sql=postgres(process.env.DATABASE_URL,{prepare:false,max:1,ssl:false}),base='http://localhost:5174';
const {processNext}=await import('../.netlify/local/processing-test.mjs');
const host={cookie:''},events=[],worker=randomUUID();let checks=0;
const images=await Promise.all(['#ff0000','#00ff00','#0000ff','#ffff00','#ff00ff'].map(async color=>(await sharp({create:{width:40,height:40,channels:3,background:color}}).png().toBuffer()).toString('base64')));
async function call(client,path,method='GET',body,status=200){const r=await fetch(base+path,{method,headers:{Origin:base,Cookie:client.cookie,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(20000)});assert.equal(r.status,status,method+' '+path+' '+await(r.status===status?Promise.resolve(''):r.text()));checks++;if(r.headers.has('set-cookie'))client.cookie=r.headers.get('set-cookie').split(';')[0];return r;}
const admin=(event,path='',method='GET',body,status=200)=>call(host,`/api/admin/events/${event.id}${path}`,method,body,status);
const team=(client,event,action,method='GET',body,status=200)=>call(client,`/api/team/${event.id}/${action}`,method,body,status);
async function create(mode='demo',capacity=5){const {event}=await(await call(host,'/api/admin/events','POST',{title:'Random reference test',slug:'random-'+randomUUID(),scheduledAt:'2026-12-01T10:00:00+08:00',durationSeconds:120,generationCap:10,teamCapacity:capacity,mode,referenceMode:'random_unique'},201)).json();events.push(event.id);return event;}
const upload=(event,index)=>admin(event,'/references','POST',{mimeType:'image/png',data:images[index],label:'Private image '+index},201);
async function join(event,count){const teams=[];for(let i=0;i<count;i++){const client={cookie:''};const registered=await(await team(client,event,'register','POST',{name:'Random Team '+i},201)).json();client.recoveryCode=registered.recoveryCode;await team(client,event,'number','POST',{number:i+1});teams.push(client);}return teams;}
try{
 await call(host,'/api/admin/login','POST',{key:process.env.ADMIN_ACCESS_KEY});
 const event=await create();assert.equal(event.reference_mode,'random_unique');
 await admin(event,'','PATCH',{status:'registration'},409);
 for(let i=0;i<3;i++)await upload(event,i);
 await admin(event,'/references','POST',{mimeType:'image/png',data:images[0],label:'Duplicate'},409);
 const pool=await(await admin(event,'/references')).json();assert.equal(pool.images.length,3);
 await call({cookie:''},`/api/admin/events/${event.id}/references`,undefined,undefined,401);
 await call({cookie:''},`/api/admin/events/${event.id}/presentation`,undefined,undefined,401);
 await admin(event,'','PATCH',{status:'registration'});const teams=await join(event,5);
 await admin(event,'/queue/lock','POST',{},409);
 assert.equal((await sql`select id from promptchamp.round_entries where event_id=${event.id} and reference_image_id is not null`).length,0);
 await upload(event,3);await upload(event,4);
 const copies=await(await admin(event,'/duplicate','POST',{} ,201)).json();events.push(copies.event.id);assert.equal(copies.event.reference_mode,'random_unique');assert.equal((await sql`select id from promptchamp.reference_pool_images where event_id=${copies.event.id}`).length,5);
 await Promise.all([admin(event,'/queue/lock','POST',{}),admin(event,'/queue/lock','POST',{})]);
 const assigned=await sql`select n.id,n.reference_image_id,p.data from promptchamp.round_entries n join promptchamp.reference_pool_images p on p.id=n.reference_image_id where n.event_id=${event.id} order by n.lucky_number`;
 assert.equal(assigned.length,5);assert.equal(new Set(assigned.map(a=>a.reference_image_id)).size,5);
 await admin(event,'/queue/lock','POST',{});assert.deepEqual((await sql`select reference_image_id from promptchamp.round_entries where event_id=${event.id} order by lucky_number`).map(r=>r.reference_image_id),assigned.map(r=>r.reference_image_id));
 await admin(event,'/references/'+pool.images[0].id,'DELETE',{},409);
 await admin(event,'/references','POST',{mimeType:'image/png',data:images[0],label:'Locked'},409);
 assert.equal((await(await admin(event,'/presentation')).json()).turn,null);
 for(let i=0;i<teams.length;i++){
  const client=teams[i];await admin(event,'/queue/next','POST',{});
  const before=await(await admin(event,'/presentation')).json();assert.equal(before.turn.id,assigned[i].id);assert.equal(before.turn.started_at,null);
  await admin(event,'/presentation/reference?entry='+assigned[i].id,'GET',undefined,409);
  if(i>0)await admin(event,'/presentation/reference?entry='+assigned[i-1].id,'GET',undefined,409);
  await team(client,event,'reference','GET',undefined,403);
  const start=await(await team(client,event,'start','POST',{})).json();assert.deepEqual(await(await team(client,event,'start','POST',{})).json(),start);
  if(i===0){const recovered={cookie:''};await team(recovered,event,'recover','POST',{name:'Random Team 0',recoveryCode:client.recoveryCode});const restored=await(await team(recovered,event,'state')).json();assert.equal(Date.parse(restored.entry.deadline_at),Date.parse(start.deadlineAt));assert.equal(Buffer.from(await(await team(recovered,event,'reference')).arrayBuffer()).toString('base64'),assigned[i].data);}
  assert.equal(Buffer.from(await(await team(client,event,'reference')).arrayBuffer()).toString('base64'),assigned[i].data);
  const state=await(await team(client,event,'state')).json();assert.ok(!JSON.stringify(state).includes('reference_image_id'));assert.ok(!JSON.stringify(state).includes(assigned[(i+1)%5].reference_image_id));
  assert.equal(Buffer.from(await(await admin(event,'/presentation/reference?entry='+assigned[i].id)).arrayBuffer()).toString('base64'),assigned[i].data);
  await team(client,event,'submit','POST',{prompt:'A colorful reference recreation',requestId:randomUUID()});
  assert.equal(Buffer.from(await(await team(client,event,'image')).arrayBuffer()).toString('base64'),assigned[i].data);
  const presented=await(await admin(event,'/presentation')).json();assert.equal(presented.turn.prompt,'A colorful reference recreation');assert.equal(presented.turn.has_image,true);
  if(i<4)await team(teams[i+1],event,'reference','GET',undefined,403);
 }
 assert.equal((await sql`select id from promptchamp.processing_jobs where submission_id in(select id from promptchamp.submissions where event_id=${event.id})`).length,0);
 const live=await create('live',1);await upload(live,0);await upload(live,1);await admin(live,'','PATCH',{status:'registration'});const [client]=await join(live,1);
 await sql`insert into promptchamp.worker_heartbeats(id) values(${worker})`;
 await admin(live,'/queue/lock','POST',{});await admin(live,'/queue/next','POST',{});await team(client,live,'start','POST',{});
 const [pinned]=await sql`select n.reference_image_id,p.data from promptchamp.round_entries n join promptchamp.reference_pool_images p on p.id=n.reference_image_id where n.event_id=${live.id}`;
 const {submission}=await(await team(client,live,'submit','POST',{prompt:'Generate a colorful image',requestId:randomUUID()})).json();
 let generations=0,judgments=0;
 const providers={generate:async()=>{generations++;return{data:images[2],mimeType:'image/png'};},judge:async(reference)=>{assert.equal(reference.data,pinned.data);judgments++;if(judgments<3)throw new Error('Simulated judging failure');return{score:80,ratings:[4,4,4,4,4],tip:'Test evaluation'};}};
 await processNext(providers,submission.id);await processNext(providers,submission.id);
 await admin(live,'/results/retry-scoring','POST',{submissionId:submission.id});await processNext(providers,submission.id);assert.equal(generations,1);
 await admin(live,'/results/retry-generation','POST',{submissionId:submission.id,reason:'Isolated test replacement generation'});await processNext(providers,submission.id);await processNext(providers,submission.id);
 assert.equal(generations,2);assert.equal(judgments,3);assert.equal((await sql`select reference_image_id from promptchamp.round_entries where event_id=${live.id}`)[0].reference_image_id,pinned.reference_image_id);
 console.log(`PASS: ${checks} random-reference checks; five unique assignments, insufficient-pool rollback, idempotent lock, private reveal, recovery-safe starts, demo references, protected presentation, cloning, and pinned judging across both retry types.`);
}finally{
 for(const id of events){await sql.begin(async tx=>{await tx`delete from promptchamp.evaluations where submission_id in(select id from promptchamp.submissions where event_id=${id})`;await tx`delete from promptchamp.generation_reservations where event_id=${id}`;await tx`delete from promptchamp.processing_jobs where submission_id in(select id from promptchamp.submissions where event_id=${id})`;await tx`delete from promptchamp.submissions where event_id=${id}`;await tx`delete from promptchamp.round_entries where event_id=${id}`;await tx`delete from promptchamp.team_sessions where team_id in(select id from promptchamp.teams where event_id=${id})`;await tx`delete from promptchamp.teams where event_id=${id}`;await tx`delete from promptchamp.audit_events where event_id=${id}`;await tx`delete from promptchamp.reference_images where event_id=${id}`;await tx`delete from promptchamp.rounds where event_id=${id}`;await tx`delete from promptchamp.events where id=${id}`;});}
 await sql`delete from promptchamp.worker_heartbeats where id=${worker}`;await sql.end({timeout:2});
}
