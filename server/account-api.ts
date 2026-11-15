import {randomBytes} from 'node:crypto';
import {eventDb} from './event-store';
import {AccountError,accountFor,accountContext,accountCookie,authConfigured,authRequest,createAccountSession,decryptTokens,digest,legacyAllowed,signOutAccount} from './account-session';
import {hostCookie} from './host-session';
const json=(body:unknown,status=200,headers={})=>Response.json(body,{status,headers:{'Cache-Control':'no-store',...headers}});
const email=(value:unknown)=>typeof value==='string'&&value.trim().length<=254&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
const uuid=/^[a-f0-9-]{36}$/i;
async function listWorkspaces(account:any){return account.platformAdmin?
 eventDb()`select w.*,'owner' as role from promptchamp.workspaces w order by w.created_at`:
 eventDb()`select w.*,m.role from promptchamp.workspaces w join promptchamp.workspace_members m on m.workspace_id=w.id where m.user_id=${account.user.id} order by w.created_at`;}
function appUrl(request:Request){return new URL('/admin.html',process.env.PUBLIC_APP_URL||process.env.URL||new URL(request.url).origin);}
export default async function accountApi(request:Request){
 const url=new URL(request.url),path=url.pathname.replace(/\/$/,'');
 if(request.method!=='GET'&&request.headers.get('origin')!==url.origin)return json({error:'Origin not allowed.'},403);
 if(!process.env.DATABASE_URL||(process.env.SESSION_SECRET?.length??0)<32)return json({error:'Account service is not configured.'},503);
 try{
  const sql=eventDb();
  if(path==='/api/account/config'&&request.method==='GET')return json({configured:authConfigured(),legacyAvailable:await legacyAllowed()});
  const raw=request.method==='GET'?'':await request.text();if(raw.length>10000)return json({error:'Request too large.'},413);
  let body:any={};try{body=raw?JSON.parse(raw):{};}catch{return json({error:'Invalid JSON.'},400);}
  if(!body||typeof body!=='object'||Array.isArray(body))return json({error:'Invalid request.'},400);
  if(['/api/account/signup','/api/account/login','/api/account/forgot','/api/account/resend'].includes(path)&&request.method==='POST'){
   if(!email(body.email))throw new AccountError('Enter a valid email address.');const address=body.email.trim().toLowerCase();
   if(path.endsWith('/forgot')||path.endsWith('/resend')){
    const recovery=path.endsWith('/forgot'),redirect=appUrl(request);if(recovery)redirect.searchParams.set('recovery','1');
    try{await authRequest((recovery?'recover':'resend')+'?redirect_to='+encodeURIComponent(redirect.href),'POST',recovery?{email:address}:{email:address,type:'signup'});}catch(error){if(!(error instanceof AccountError)||error.status!==401)throw error;}
    return json({message:'If the account is eligible, an email has been sent. Check your inbox and spam folder.'});
   }
   if(typeof body.password!=='string'||body.password.length<12||body.password.length>128)throw new AccountError('Use a password with 12–128 characters.');
   if(path.endsWith('/signup')){
    await authRequest('signup?redirect_to='+encodeURIComponent(appUrl(request).href),'POST',{email:address,password:body.password,data:{display_name:typeof body.displayName==='string'?body.displayName.trim().slice(0,80):''}});
    return json({message:'Check your email to confirm your account, then sign in.'},201);
   }
   const tokens=await authRequest('token?grant_type=password','POST',{email:address,password:body.password});
   return json({},200,{'Set-Cookie':await createAccountSession(request,tokens)});
  }
  if(path==='/api/account/recovery-session'&&request.method==='POST'){
   if(typeof body.accessToken!=='string'||typeof body.refreshToken!=='string')throw new AccountError('The recovery link is incomplete. Request another email.');
   return json({},200,{'Set-Cookie':await createAccountSession(request,{access_token:body.accessToken,refresh_token:body.refreshToken},'recovery')});
  }
  if(path==='/api/account/logout'&&request.method==='POST'){
   const response=json({});response.headers.append('Set-Cookie',await signOutAccount(request));response.headers.append('Set-Cookie',hostCookie(request,true));return response;
  }
  const account=await accountFor(request);if(!account)throw new AccountError('Sign in to your account.',401);
  if(path==='/api/account/session'&&request.method==='GET')return json({...account,workspaces:await listWorkspaces(account)});
  if(path==='/api/account/password'&&request.method==='POST'){
   if(typeof body.password!=='string'||body.password.length<12||body.password.length>128)throw new AccountError('Use a password with 12–128 characters.');
   const [session]=await sql`select provider_tokens from promptchamp.account_sessions where id=${account.sessionId}`;
   await authRequest('user','PUT',{password:body.password},decryptTokens(session.provider_tokens).access_token);
   await sql`update promptchamp.account_sessions set purpose='normal' where id=${account.sessionId}`;return json({message:'Password updated.'});
  }
  if(account.purpose==='recovery')throw new AccountError('Set your new password before continuing.',403);
  if(path==='/api/account/workspaces'&&request.method==='POST'){
   const name=typeof body.name==='string'?body.name.trim():'';if(name.length<2||name.length>80)throw new AccountError('Use a workspace name with 2–80 characters.');
   const workspace=await sql.begin(async tx=>{
    await tx`select id from promptchamp.profiles where id=${account.user.id} for update`;
    const [count]=await tx`select count(*)::int as total from promptchamp.workspace_members where user_id=${account.user.id} and role='owner'`;
    if(count.total>=5)throw new AccountError('You can own up to five workspaces.',409);
    const [workspace]=await tx`insert into promptchamp.workspaces(name) values(${name}) returning *`;
    await tx`insert into promptchamp.workspace_members(workspace_id,user_id,role) values(${workspace.id},${account.user.id},'owner')`;
    await tx`update promptchamp.account_sessions set workspace_id=${workspace.id} where id=${account.sessionId}`;
    await tx`insert into promptchamp.workspace_audit(workspace_id,actor_id,action) values(${workspace.id},${account.user.id},'workspace_created')`;return workspace;
   });return json({workspace},201);
  }
  if(path==='/api/account/select-workspace'&&request.method==='POST'){
   if(!uuid.test(body.workspaceId??''))throw new AccountError('Choose a workspace.');
   const workspaces=await listWorkspaces(account);if(!workspaces.some((w:any)=>w.id===body.workspaceId))throw new AccountError('Workspace access denied.',403);
   await sql`update promptchamp.account_sessions set workspace_id=${body.workspaceId} where id=${account.sessionId}`;return json({});
  }
  if(path==='/api/account/accept-invite'&&request.method==='POST'){
   if(typeof body.token!=='string'||!/^[a-f0-9]{64}$/.test(body.token))throw new AccountError('Invalid invitation.');
   await sql.begin(async tx=>{
    const [invite]=await tx`select i.*,w.status from promptchamp.workspace_invites i join promptchamp.workspaces w on w.id=i.workspace_id
      where token_hash=${digest(body.token)} and accepted_at is null and expires_at>clock_timestamp() for update of i`;
    if(!invite||invite.email!==account.user.email.toLowerCase()||invite.status!=='active')throw new AccountError('This invitation is expired or belongs to another email.',403);
    await tx`insert into promptchamp.workspace_members(workspace_id,user_id,role) values(${invite.workspace_id},${account.user.id},'host') on conflict do nothing`;
    await tx`update promptchamp.workspace_invites set accepted_at=now() where id=${invite.id}`;
    await tx`update promptchamp.account_sessions set workspace_id=${invite.workspace_id} where id=${account.sessionId}`;
    await tx`insert into promptchamp.workspace_audit(workspace_id,actor_id,action) values(${invite.workspace_id},${account.user.id},'invite_accepted')`;
   });return json({});
  }
  if(path==='/api/account/platform'&&request.method==='GET'){
   if(!account.platformAdmin)throw new AccountError('Platform administrator access required.',403);
   return json({workspaces:await sql`select w.*,(select count(*)::int from promptchamp.events e where e.workspace_id=w.id) as events,
    (select count(*)::int from promptchamp.workspace_members m where m.workspace_id=w.id) as members from promptchamp.workspaces w order by created_at desc`});
  }
  const platform=path.match(/^\/api\/account\/platform\/([a-f0-9-]{36})$/i);
  if(platform&&request.method==='PATCH'){
   if(!account.platformAdmin)throw new AccountError('Platform administrator access required.',403);
   if(!['active','suspended'].includes(body.status)||typeof body.liveEnabled!=='boolean'||!Number.isInteger(body.monthlyLimit)||body.monthlyLimit<0||body.monthlyLimit>10000)throw new AccountError('Check workspace access and allowance settings.');
   await sql.begin(async tx=>{const [row]=await tx`update promptchamp.workspaces set status=${body.status},live_enabled=${body.liveEnabled},monthly_generation_limit=${body.monthlyLimit} where id=${platform[1]} returning id`;
    if(!row)throw new AccountError('Workspace not found.',404);
    await tx`insert into promptchamp.workspace_audit(workspace_id,actor_id,action,details) values(${platform[1]},${account.user.id},'platform_access_changed',${JSON.stringify({status:body.status,liveEnabled:body.liveEnabled,monthlyLimit:body.monthlyLimit})}::jsonb)`;
   });return json({});
  }
  const context=await accountContext(request);if(!context)throw new AccountError('Sign in to your account.',401);
  const w=context.workspace;
  if(path==='/api/account/dashboard'&&request.method==='GET'){
   const [stats]=await sql`select (select count(*)::int from promptchamp.events where workspace_id=${w.id}) as events,
    (select count(*)::int from promptchamp.teams t join promptchamp.events e on e.id=t.event_id where e.workspace_id=${w.id}) as teams,
    (select count(*)::int from promptchamp.submissions s join promptchamp.events e on e.id=s.event_id where e.workspace_id=${w.id} and s.status='scored') as scored,
    (select count(*)::int from promptchamp.generation_reservations g join promptchamp.events e on e.id=g.event_id where e.workspace_id=${w.id} and g.created_at>=date_trunc('month',now() at time zone 'UTC') at time zone 'UTC') as used`;
   return json({workspace:w,stats,role:context.role});
  }
  if(path==='/api/account/settings'&&request.method==='PATCH'){
   if(context.role!=='owner')throw new AccountError('Only workspace owners can change settings.',403);
   const name=typeof body.name==='string'?body.name.trim():'';
   if(name.length<2||name.length>80||!['demo','live'].includes(body.defaultMode)||![120,180].includes(body.defaultDuration))throw new AccountError('Check the workspace settings.');
   if(typeof body.timezone!=='string'||!body.timezone.trim()||body.timezone.length>60)throw new AccountError('Choose a valid time zone.');
   try{new Intl.DateTimeFormat('en',{timeZone:body.timezone});}catch{throw new AccountError('Choose a valid time zone.');}
   if(body.defaultMode==='live'&&!w.live_enabled)throw new AccountError('Live access needs platform approval.',403);
   await sql`update promptchamp.workspaces set name=${name},timezone=${String(body.timezone).slice(0,60)},default_mode=${body.defaultMode},default_duration=${body.defaultDuration} where id=${w.id}`;
   return json({});
  }
  if(path==='/api/account/members'&&request.method==='GET')return json({members:await sql`select p.id,p.email,p.display_name,m.role from promptchamp.workspace_members m join promptchamp.profiles p on p.id=m.user_id where m.workspace_id=${w.id} order by m.role,p.email`,invites:context.role==='owner'?await sql`select id,email,expires_at from promptchamp.workspace_invites where workspace_id=${w.id} and accepted_at is null and expires_at>now()`:[]});
  if(path==='/api/account/members'&&request.method==='POST'){
   if(context.role!=='owner')throw new AccountError('Only workspace owners can invite hosts.',403);
   if(!email(body.email))throw new AccountError('Enter a valid email address.');const token=randomBytes(32).toString('hex');
   await sql`insert into promptchamp.workspace_invites(workspace_id,email,token_hash) values(${w.id},${body.email.trim().toLowerCase()},${digest(token)})`;
   const link=appUrl(request);link.searchParams.set('invite',token);return json({inviteUrl:link.href,message:'Share this private link with the invited host. They must sign in using the invited email.'},201);
  }
  const member=path.match(/^\/api\/account\/members\/([a-f0-9-]{36})$/i);
  if(member&&request.method==='DELETE'){
   if(context.role!=='owner')throw new AccountError('Only owners can remove hosts.',403);
   await sql`delete from promptchamp.workspace_members where workspace_id=${w.id} and user_id=${member[1]} and role='host'`;return json({});
  }
  if(path==='/api/account/library'&&request.method==='GET')return json({references:await sql`select i.id,i.event_id,e.title from promptchamp.reference_images i join promptchamp.events e on e.id=i.event_id where e.workspace_id=${w.id} order by i.created_at desc`});
  if(path==='/api/account/teams'&&request.method==='GET')return json({teams:await sql`select t.name,t.status,e.title as event,e.mode from promptchamp.teams t join promptchamp.events e on e.id=t.event_id where e.workspace_id=${w.id} order by t.created_at desc limit 500`});
  throw new AccountError('Page not found.',404);
 }catch(error:any){if(error instanceof AccountError)return json({error:error.message},error.status);console.error('Account service failed:',error.code??error.name);return json({error:'The account service is temporarily unavailable.'},503);}
}
