import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {randomUUID,randomBytes} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import postgres from 'postgres';
const dbUrl=new URL(process.env.DATABASE_URL??'postgresql://localhost/invalid');
if(process.env.CI!=='true'||!['localhost','127.0.0.1'].includes(dbUrl.hostname)||dbUrl.pathname!=='/promptchamp_ci'||process.env.SUPABASE_URL!=='http://127.0.0.1:54321')throw new Error('Account tests require the isolated CI database and mock auth endpoint.');
const base='http://localhost:5174',password='Test-only-password-12345!',office='00000000-0000-4000-8000-000000000001';
const sql=postgres(process.env.DATABASE_URL,{prepare:false,max:1,ssl:false});
const users=new Map(),access=new Map(),refresh=new Map(),latest=new Map();
function userView(user){return{id:user.id,email:user.email,email_confirmed_at:user.verified?new Date().toISOString():null,confirmed_at:user.phoneVerified?new Date().toISOString():null,user_metadata:user.metadata};}
function tokens(user){const value={access_token:randomBytes(24).toString('hex'),refresh_token:randomBytes(24).toString('hex')};access.set(value.access_token,user);refresh.set(value.refresh_token,user);latest.set(user.email,value);return value;}
const provider=createServer(async(req,res)=>{
 try{
  const url=new URL(req.url,'http://localhost');let raw='';for await(const chunk of req)raw+=chunk;
  const body=raw?JSON.parse(raw):{},token=req.headers.authorization?.replace(/^Bearer /,'');
  const reply=(value,status=200)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(value));};
  if(req.headers.apikey!==process.env.SUPABASE_PUBLISHABLE_KEY)return reply({},401);
  if(url.pathname==='/auth/v1/signup'){
   if(users.has(body.email))return reply({user:{}});
   const user={id:randomUUID(),email:body.email,password:body.password,metadata:body.data??{},verified:false};users.set(body.email,user);return reply({user:userView(user)});
  }
  if(url.pathname==='/auth/v1/token'){
   const user=url.searchParams.get('grant_type')==='refresh_token'?refresh.get(body.refresh_token):users.get(body.email);
   if(!user||(url.searchParams.get('grant_type')==='password'&&user.password!==body.password))return reply({},401);
   return reply(tokens(user));
  }
  if(url.pathname==='/auth/v1/user'){
   const user=access.get(token);if(!user)return reply({},401);
   if(req.method==='PUT'&&body.password)user.password=body.password;
   return reply(userView(user));
  }
  if(url.pathname==='/auth/v1/recover'||url.pathname==='/auth/v1/resend')return reply({});
  if(url.pathname==='/auth/v1/logout'){access.delete(token);return reply({});}
  reply({},404);
 }catch{res.writeHead(500);res.end('{}');}
});
await new Promise(resolve=>provider.listen(54321,'127.0.0.1',resolve));
let checks=0;const events=[],workspaces=[];const owner={cookie:''},a={cookie:''},b={cookie:''},host={cookie:''},legacy={cookie:''};
async function call(client,path,method='GET',body,status=200){const response=await fetch(base+path,{method,signal:AbortSignal.timeout(20000),headers:{Origin:base,Cookie:client.cookie,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});assert.equal(response.status,status,method+' '+path);checks++;if(response.headers.has('set-cookie'))client.cookie=response.headers.get('set-cookie').split(';')[0];return response;}
const account=(client,path,method='GET',body,status=200)=>call(client,'/api/account/'+path,method,body,status);
const admin=(client,path,method='GET',body,status=200)=>call(client,'/api/admin/'+path,method,body,status);
async function register(client,email){await account(client,'signup','POST',{email,password,displayName:'Test host',role:'platform_admin'},201);users.get(email).verified=true;await account(client,'login','POST',{email,password});}
async function createEvent(client,slug,mode='demo'){
 const {event}=await(await admin(client,'events','POST',{title:'Account isolation rehearsal',slug,mode,scheduledAt:'2026-12-01T09:00:00+08:00',durationSeconds:120,generationCap:20,teamCapacity:1},201)).json();events.push(event.id);return event;
}
const image=(await readFile('public/challenges/falls.webp')).toString('base64');
async function prepareTurn(client,event){
 await admin(client,`events/${event.id}/reference`,'PUT',{mimeType:'image/webp',data:image});
 await admin(client,`events/${event.id}`,'PATCH',{status:'registration'});
 const team={cookie:''},path=`/api/team/${event.id}/`;
 await call(team,path+'register','POST',{name:'Rehearsal team'},201);await call(team,path+'number','POST',{number:1});
 await admin(client,`events/${event.id}/queue/lock`,'POST',{});await admin(client,`events/${event.id}/queue/next`,'POST',{});await call(team,path+'start','POST',{});return team;
}
const workerId=randomUUID();
try{
 await admin(legacy,'login','POST',{key:process.env.ADMIN_ACCESS_KEY});
 await register(a,'customer-a@example.test');
 const registered=users.get('customer-a@example.test');assert.equal(registered.metadata.role,undefined);
 const initial=await(await account(a,'session')).json();assert.equal(initial.platformAdmin,false);assert.equal(initial.workspaces.length,0);
 const [encrypted]=await sql`select provider_tokens from promptchamp.account_sessions where user_id=${registered.id}`;
 assert.ok(!encrypted.provider_tokens.includes(latest.get(registered.email).access_token));assert.ok(!a.cookie.includes(latest.get(registered.email).access_token));
 const {workspace:wa}=await(await account(a,'workspaces','POST',{name:'Customer A'},201)).json();workspaces.push(wa.id);assert.equal(wa.live_enabled,false);assert.equal(wa.default_mode,'demo');
 await register(b,'customer-b@example.test');const {workspace:wb}=await(await account(b,'workspaces','POST',{name:'Customer B'},201)).json();workspaces.push(wb.id);
 await account(a,'select-workspace','POST',{workspaceId:wb.id},403);
 await account(a,'platform','GET',undefined,403);
 await admin(a,'events','POST',{title:'Forbidden live event',slug:'account-live-denied',mode:'live',scheduledAt:'2026-12-01T09:00:00+08:00',durationSeconds:120,generationCap:20,teamCapacity:1},403);
 const ea=await createEvent(a,'account-demo-a'),eb=await createEvent(b,'account-demo-b');assert.equal(ea.workspace_id,wa.id);assert.equal(eb.workspace_id,wb.id);
 const aEvents=await(await admin(a,'events')).json();assert.ok(aEvents.events.some(e=>e.id===ea.id));assert.ok(!aEvents.events.some(e=>e.id===eb.id));
 for(const suffix of ['','/reference','/results','/queue','/export'])await admin(b,'events/'+ea.id+suffix,'GET',undefined,404);
 await admin(b,'events/'+ea.id,'PATCH',{status:'registration'},404);
 await admin(a,'events/'+ea.id+'/reference','PUT',{mimeType:'image/webp',data:image});
 const library=await(await account(a,'library')).json();assert.equal(library.references.length,1);
 await admin(b,'events/'+eb.id+'/reference','PUT',{referenceId:library.references[0].id},404);
 const team=await prepareTurn(a,ea);
 const publicEvents=await(await call(team,'/api/events')).json();assert.ok(!publicEvents.events.some(e=>e.slug===ea.slug));
 await call(team,`/api/team/${ea.id}/submit`,'POST',{prompt:'A red boat and a jungle waterfall',requestId:randomUUID()});
 const demo=await(await call(team,`/api/team/${ea.id}/state`)).json();assert.equal(demo.entry.state,'completed');assert.ok(demo.entry.score>=0);assert.equal(demo.event.mode,'demo');
 const [demoJobs]=await sql`select count(*)::int as total from promptchamp.processing_jobs j join promptchamp.submissions s on s.id=j.submission_id where s.event_id=${ea.id}`;assert.equal(demoJobs.total,0);
 const [demoQuota]=await sql`select count(*)::int as total from promptchamp.generation_reservations where event_id=${ea.id}`;assert.equal(demoQuota.total,0);
 const invite=await(await account(a,'members','POST',{email:'invited-host@example.test'},201)).json();const invitation=new URL(invite.inviteUrl).searchParams.get('invite');
 await account(b,'accept-invite','POST',{token:invitation},403);
 await register(host,'invited-host@example.test');await account(host,'accept-invite','POST',{token:invitation});await account(host,'accept-invite','POST',{token:invitation},403);
 await admin(host,'events');await account(host,'settings','PATCH',{name:'Unauthorized',timezone:'UTC',defaultMode:'demo',defaultDuration:120},403);await account(host,'members','POST',{email:'other@example.test'},403);await account(host,'platform','GET',undefined,403);
 await account(a,'members/'+users.get('invited-host@example.test').id,'DELETE',{});await admin(host,'events','GET',undefined,403);
 // Only the configured, verified identity may claim the reserved office.
 await account(owner,'signup','POST',{email:process.env.PLATFORM_OWNER_EMAIL,password},201);users.get(process.env.PLATFORM_OWNER_EMAIL).phoneVerified=true;await account(owner,'login','POST',{email:process.env.PLATFORM_OWNER_EMAIL,password},401);
 users.get(process.env.PLATFORM_OWNER_EMAIL).verified=true;await account(owner,'login','POST',{email:process.env.PLATFORM_OWNER_EMAIL,password});
 const platform=await(await account(owner,'session')).json();assert.equal(platform.platformAdmin,true);assert.ok(platform.workspaces.some(w=>w.id===office));
 await admin(legacy,'login','POST',{key:process.env.ADMIN_ACCESS_KEY},403);await admin(legacy,'events','GET',undefined,401);
 await account(owner,'platform/'+wa.id,'PATCH',{status:'active',liveEnabled:true,monthlyLimit:1});
 await admin(a,'events/'+ea.id,'PATCH',{title:'Frozen demo',mode:'live',scheduledAt:'2026-12-01T09:00:00+08:00',durationSeconds:120,generationCap:20,teamCapacity:1},409);
 await sql`insert into promptchamp.worker_heartbeats(id) values(${workerId})`;
 const live1=await createEvent(a,'account-live-a1','live'),live2=await createEvent(a,'account-live-a2','live');
 const t1=await prepareTurn(a,live1),t2=await prepareTurn(a,live2);
 const submitted=await Promise.all([[t1,live1],[t2,live2]].map(async([client,event])=>{const response=await fetch(base+`/api/team/${event.id}/submit`,{method:'POST',headers:{Origin:base,Cookie:client.cookie,'Content-Type':'application/json'},body:JSON.stringify({prompt:'A red boat on a jungle lake',requestId:randomUUID()})});return response.status;}));assert.deepEqual(submitted.sort(),[200,409]);
 const [monthly]=await sql`select count(*)::int as total from promptchamp.generation_reservations g join promptchamp.events e on e.id=g.event_id where e.workspace_id=${wa.id}`;assert.equal(monthly.total,1);
 await account(owner,'platform/'+wb.id,'PATCH',{status:'suspended',liveEnabled:false,monthlyLimit:0});await account(b,'dashboard','GET',undefined,403);await admin(b,'events','GET',undefined,403);await admin(a,'events');
 const oldToken=latest.get(registered.email).access_token;access.delete(oldToken);await account(a,'session');assert.notEqual(latest.get(registered.email).access_token,oldToken);
 const recoveryTokens=tokens(users.get('customer-b@example.test'));await account(b,'recovery-session','POST',{accessToken:recoveryTokens.access_token,refreshToken:recoveryTokens.refresh_token});await admin(b,'events','GET',undefined,403);
 await account(b,'password','POST',{password:'Updated-test-password-54321!'});assert.equal(users.get('customer-b@example.test').password,'Updated-test-password-54321!');
 const staleCookie=b.cookie;await account(b,'logout','POST',{});await account({cookie:staleCookie},'session','GET',undefined,401);
 let rlsChecked=false;
 try{await sql.begin(async tx=>{await tx.unsafe('create role promptchamp_ci_reader nologin');await tx.unsafe('grant usage on schema promptchamp to promptchamp_ci_reader');await tx.unsafe('grant select on promptchamp.events to promptchamp_ci_reader');await tx`select set_config('request.jwt.claim.sub',${registered.id},true)`;await tx.unsafe('set local role promptchamp_ci_reader');const visible=await tx`select id from promptchamp.events`;assert.ok(visible.some(e=>e.id===ea.id));assert.ok(!visible.some(e=>e.id===eb.id));rlsChecked=true;throw new Error('ROLLBACK_RLS_FIXTURE');});}catch(error){if(error.message!=='ROLLBACK_RLS_FIXTURE')throw error;}
 assert.ok(rlsChecked);
 console.log(`PASS: ${checks} account/workspace checks; verified signup, encrypted sessions, refresh/recovery, invitation roles, platform bootstrap, legacy retirement, customer isolation, demo quota, monthly cap races, suspension, and database RLS.`);
}finally{
 await sql.begin(async tx=>{
  for(const eventId of events){await tx`delete from promptchamp.evaluations where submission_id in(select id from promptchamp.submissions where event_id=${eventId})`;await tx`delete from promptchamp.generation_reservations where event_id=${eventId}`;await tx`delete from promptchamp.processing_jobs where submission_id in(select id from promptchamp.submissions where event_id=${eventId})`;await tx`delete from promptchamp.submissions where event_id=${eventId}`;await tx`delete from promptchamp.round_entries where event_id=${eventId}`;await tx`delete from promptchamp.team_sessions where team_id in(select id from promptchamp.teams where event_id=${eventId})`;await tx`delete from promptchamp.teams where event_id=${eventId}`;await tx`delete from promptchamp.audit_events where event_id=${eventId}`;await tx`delete from promptchamp.reference_images where event_id=${eventId}`;await tx`delete from promptchamp.rounds where event_id=${eventId}`;await tx`delete from promptchamp.events where id=${eventId}`;}
  for(const user of users.values()){await tx`delete from promptchamp.account_sessions where user_id=${user.id}`;await tx`delete from promptchamp.workspace_audit where actor_id=${user.id}`;await tx`delete from promptchamp.workspace_members where user_id=${user.id}`;await tx`delete from promptchamp.platform_admins where user_id=${user.id}`;}
  for(const id of workspaces){await tx`delete from promptchamp.workspace_invites where workspace_id=${id}`;await tx`delete from promptchamp.workspace_audit where workspace_id=${id}`;await tx`delete from promptchamp.workspaces where id=${id}`;}
  for(const user of users.values())await tx`delete from promptchamp.profiles where id=${user.id}`;
  await tx`delete from promptchamp.worker_heartbeats where id=${workerId}`;await tx`update promptchamp.platform_settings set legacy_login_enabled=true where id=true`;
 });
 provider.closeAllConnections();await new Promise(resolve=>provider.close(resolve));await sql.end({timeout:2});
}
