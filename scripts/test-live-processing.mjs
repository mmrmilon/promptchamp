import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import postgres from 'postgres';
process.loadEnvFile('.env');
const {processNext}=await import('../.netlify/local/processing-test.mjs');
const live=process.argv.includes('--live-ai');
const sql=postgres(process.env.DATABASE_URL,{prepare:false,max:1,ssl:'require',connect_timeout:10});
const base='http://localhost:5174',workerId=crypto.randomUUID();
const host={cookie:''},a={cookie:''},b={cookie:''};let eventId,calls=0;
async function call(client,path,method='GET',body,status=200){
 const response=await fetch(base+path,{signal:AbortSignal.timeout(20000),method,headers:{Origin:base,Cookie:client.cookie,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
 assert.equal(response.status,status,path);if(response.headers.has('set-cookie'))client.cookie=response.headers.get('set-cookie').split(';')[0];return response;
}
const hostPath=(suffix='')=>`/api/admin/events/${eventId}${suffix}`;
const teamPath=(action)=>`/api/team/${eventId}/${action}`;
const image=(await readFile('public/challenges/falls.webp')).toString('base64');
const providers={generate:async()=>{calls++;return{mimeType:'image/webp',data:image};},judge:async()=>({score:80,ratings:[4,4,4,4,4],tip:'Describe the waterfall position more clearly.'})};
try{
 await sql`insert into promptchamp.worker_heartbeats(id) values(${workerId})`;
 await call(host,'/api/admin/login','POST',{key:process.env.ADMIN_ACCESS_KEY});
 const slug='processing-test-'+crypto.randomUUID();
 const {event}=await(await call(host,'/api/admin/events','POST',{title:'Isolated live processing test',slug,scheduledAt:'2026-12-01T10:00:00+08:00',durationSeconds:120,generationCap:2,teamCapacity:live?1:2},201)).json();eventId=event.id;
 await call(host,hostPath('/reference'),'PUT',{mimeType:'image/webp',data:image});
 await call(host,hostPath(),'PATCH',{status:'registration'});
 await call(a,teamPath('register'),'POST',{name:'Processing Alpha'},201);await call(a,teamPath('number'),'POST',{number:1});
 if(!live){await call(b,teamPath('register'),'POST',{name:'Processing Beta'},201);await call(b,teamPath('number'),'POST',{number:2});}
 await call(host,hostPath('/queue/lock'),'POST',{});await call(host,hostPath('/queue/next'),'POST',{});await call(a,teamPath('start'),'POST',{});
 const requestId=crypto.randomUUID();const payload={requestId,prompt:'Realistic vertical photograph of a red wooden rowboat facing the camera with two extended oars, on a jade lake surrounded by lush tropical jungle. A thin white waterfall is centered in the background. Soft misty daylight, reflections, detailed leaves and water.'};
 const {submission}=await(await call(a,teamPath('submit'),'POST',payload)).json();
 await call(a,teamPath('submit'),'POST',payload);
 let [used]=await sql`select count(*)::int as total from promptchamp.generation_reservations where event_id=${eventId}`;assert.equal(used.total,1);
 const boardPath='/api/events/'+slug+'/leaderboard';
 assert.equal((await(await call(a,boardPath)).json()).released,false);
 await call(host,hostPath('/results/publish'),'POST',{},409);
 if(live){
  console.log('Running one real generation and one real judging call...');
  assert.equal(await processNext(undefined,submission.id),true);
  assert.equal(await processNext(undefined,submission.id),true);
 }else{
  const claims=await Promise.all([processNext(providers,submission.id),processNext(providers,submission.id)]);assert.deepEqual(claims.sort(),[false,true]);assert.equal(calls,1);
  await processNext({...providers,judge:async()=>{throw new Error('Simulated judge timeout');}},submission.id);
  let [row]=await sql`select status from promptchamp.submissions where id=${submission.id}`;assert.equal(row.status,'judge_failed');
  await call(host,hostPath('/results/retry-scoring'),'POST',{submissionId:submission.id});
  await processNext(providers,submission.id);assert.equal(calls,1);
 }
 const result=await(await call(a,teamPath('state'))).json();
 assert.equal(result.entry.submission_status,'scored');assert.ok(result.entry.score>=0&&result.entry.score<=100);assert.equal(result.entry.ratings.length,5);
 assert.equal(result.entry.state,'completed');assert.ok((await call(a,teamPath('image'))).headers.get('content-type').startsWith('image/'));
 if(!live){
  await call(host,hostPath('/queue/next'),'POST',{});await call(b,teamPath('start'),'POST',{});
  const second=await(await call(b,teamPath('submit'),'POST',{requestId:crypto.randomUUID(),prompt:'A second red boat on the lake'})).json();
  await sql`update promptchamp.processing_jobs set state='running',lease_token=${crypto.randomUUID()},lease_until=clock_timestamp()-interval '1 second' where submission_id=${second.submission.id}`;
  assert.equal(await processNext(providers,second.submission.id),false);assert.equal(calls,1);
  const [lost]=await sql`select status from promptchamp.submissions where id=${second.submission.id}`;assert.equal(lost.status,'needs_review');
  await call(host,hostPath('/results/retry-generation'),'POST',{submissionId:second.submission.id,reason:'Rehearsal tests the event cap'},409);
  await call(host,hostPath('/results/void'),'POST',{submissionId:second.submission.id,reason:'Rehearsal simulates uncertain generation'});
 }
 await call(host,hostPath('/results/publish'),'POST',{});
 const board=await(await call(a,boardPath)).json();assert.equal(board.released,true);assert.equal(board.rows.length,1);assert.equal(board.rows[0].rank,1);
 await call(host,hostPath('/results/retry-scoring'),'POST',{submissionId:submission.id},409);
 [used]=await sql`select count(*)::int as total from promptchamp.generation_reservations where event_id=${eventId}`;assert.equal(used.total,live?1:2);
 console.log(live?`PASS: real image generation, reference judging (${result.entry.score}/100), saved image, and final leaderboard publication.`:'PASS: durable processing, exclusive job claims, scoring recovery without regeneration, generation cap, expired leases, result privacy, and publication locking.');
}finally{
 if(eventId)await sql.begin(async tx=>{
  await tx`delete from promptchamp.evaluations where submission_id in(select id from promptchamp.submissions where event_id=${eventId})`;
  await tx`delete from promptchamp.generation_reservations where event_id=${eventId}`;
  await tx`delete from promptchamp.processing_jobs where submission_id in(select id from promptchamp.submissions where event_id=${eventId})`;
  await tx`delete from promptchamp.submissions where event_id=${eventId}`;
  await tx`delete from promptchamp.round_entries where event_id=${eventId}`;
  await tx`delete from promptchamp.team_sessions where team_id in(select id from promptchamp.teams where event_id=${eventId})`;
  await tx`delete from promptchamp.teams where event_id=${eventId}`;
  await tx`delete from promptchamp.audit_events where event_id=${eventId}`;
  await tx`delete from promptchamp.reference_images where event_id=${eventId}`;
  await tx`delete from promptchamp.rounds where event_id=${eventId}`;
  await tx`delete from promptchamp.events where id=${eventId}`;
 });
 await sql`delete from promptchamp.worker_heartbeats where id=${workerId}`;
 await sql.end({timeout:2});
}
