import {createCipheriv,createDecipheriv,createHash,randomBytes} from 'node:crypto';
import {eventDb} from './event-store';

export const OFFICE_WORKSPACE='00000000-0000-4000-8000-000000000001';
export const digest=(value:string)=>createHash('sha256').update(value).digest('hex');
const encryptionKey=()=>createHash('sha256').update('account-tokens:'+process.env.SESSION_SECRET).digest();
export function encryptTokens(value:unknown){const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',encryptionKey(),iv);const encrypted=Buffer.concat([cipher.update(JSON.stringify(value),'utf8'),cipher.final()]);return Buffer.concat([iv,cipher.getAuthTag(),encrypted]).toString('base64');}
export function decryptTokens(value:string){const bytes=Buffer.from(value,'base64'),cipher=createDecipheriv('aes-256-gcm',encryptionKey(),bytes.subarray(0,12));cipher.setAuthTag(bytes.subarray(12,28));return JSON.parse(Buffer.concat([cipher.update(bytes.subarray(28)),cipher.final()]).toString('utf8'));}
export const authConfigured=()=>!!(process.env.SUPABASE_URL&&(process.env.SUPABASE_PUBLISHABLE_KEY||process.env.SUPABASE_ANON_KEY));
export class AccountError extends Error{constructor(message:string,public status=400){super(message);}}
export async function authRequest(path:string,method='GET',body?:unknown,accessToken?:string){
 if(!authConfigured())throw new AccountError('Account registration is not configured yet. Ask the host to finish authentication setup.',503);
 const base=new URL(process.env.SUPABASE_URL!);
 if(base.protocol!=='https:'&&!(process.env.CI==='true'&&['localhost','127.0.0.1'].includes(base.hostname)))throw new AccountError('Authentication requires a secure provider URL.',503);
 const response=await fetch(new URL('/auth/v1/'+path,base),{method,headers:{apikey:process.env.SUPABASE_PUBLISHABLE_KEY||process.env.SUPABASE_ANON_KEY!,'Content-Type':'application/json',...(accessToken?{Authorization:'Bearer '+accessToken}:{})},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(10_000)});
 const data=await response.json().catch(()=>({}));
 if(!response.ok)throw new AccountError(response.status===429?'Too many requests. Please try again later.':response.status>=500?'Authentication is temporarily unavailable.':'Sign-in or account verification failed. Check your details and confirm your email.',response.status===429?429:response.status>=500?503:401);
 return data;
}
function checkedUser(user:any){if(!user?.id||!user.email||!user.email_confirmed_at)throw new AccountError('Please verify your email before signing in.',401);return user;}
export function accountCookie(request:Request,token:string,clear=false){return `pc_account=${clear?'':token}; Path=/api; HttpOnly; SameSite=Lax; Max-Age=${clear?0:14*86400}${new URL(request.url).protocol==='https:'?'; Secure':''}`;}
const rawSession=(request:Request)=>request.headers.get('cookie')?.match(/(?:^|;\s*)pc_account=([a-f0-9]{64})(?:;|$)/)?.[1];
async function syncProfile(tx:any,user:any){
 const email=user.email.toLowerCase();
 await tx`insert into promptchamp.profiles(id,email,display_name) values(${user.id},${email},${String(user.user_metadata?.display_name??'').slice(0,80)}) on conflict(id) do update set email=excluded.email`;
 if(process.env.PLATFORM_OWNER_EMAIL&&email===process.env.PLATFORM_OWNER_EMAIL.trim().toLowerCase()){
  await tx`select pg_advisory_xact_lock(947463)`;
  await tx`insert into promptchamp.platform_admins(user_id) values(${user.id}) on conflict do nothing`;
  const [owner]=await tx`select user_id from promptchamp.workspace_members where workspace_id=${OFFICE_WORKSPACE} and role='owner'`;
  if(!owner){await tx`insert into promptchamp.workspace_members(workspace_id,user_id,role) values(${OFFICE_WORKSPACE},${user.id},'owner') on conflict do nothing`;await tx`update promptchamp.platform_settings set legacy_login_enabled=false where id=true`;}
 }
}
export async function createAccountSession(request:Request,tokens:any,purpose='normal'){
 const user=checkedUser(await authRequest('user','GET',undefined,tokens.access_token));
 if(typeof tokens.refresh_token!=='string'||!tokens.refresh_token)throw new AccountError('Sign-in session is incomplete.',401);
 const token=randomBytes(32).toString('hex');
 await eventDb().begin(async tx=>{await syncProfile(tx,user);const [member]=await tx`select workspace_id from promptchamp.workspace_members where user_id=${user.id} order by created_at limit 1`;
  await tx`insert into promptchamp.account_sessions(user_id,token_hash,provider_tokens,workspace_id,purpose) values(${user.id},${digest(token)},${encryptTokens({access_token:tokens.access_token,refresh_token:tokens.refresh_token})},${member?.workspace_id??null},${purpose})`;});
 return accountCookie(request,token);
}
// Share authentication only inside one HTTP request. A later request must still
// revalidate identity and read current roles; this is not a login/role cache.
const requestAccounts=new WeakMap<Request,ReturnType<typeof resolveAccount>>();
export function accountFor(request:Request){
 let result=requestAccounts.get(request);
 if(!result){result=resolveAccount(request);requestAccounts.set(request,result);}
 return result;
}
async function resolveAccount(request:Request){
 const token=rawSession(request);if(!token)return null;
 const sql=eventDb();
 const [session]=await sql`select s.*,p.email as profile_email,
   exists(select 1 from promptchamp.platform_admins where user_id=s.user_id) as platform_admin,
   exists(select 1 from promptchamp.workspace_members where workspace_id=${OFFICE_WORKSPACE} and role='owner') as office_owned
   from promptchamp.account_sessions s join promptchamp.profiles p on p.id=s.user_id
   where s.token_hash=${digest(token)} and s.expires_at>clock_timestamp()`;
  if(!session)return null;
  let tokens;try{tokens=decryptTokens(session.provider_tokens);}catch{await sql`delete from promptchamp.account_sessions where id=${session.id}`;return null;}
  let user;
  try{user=await authRequest('user','GET',undefined,tokens.access_token);}catch(error){
   if(!(error instanceof AccountError)||error.status!==401)throw error;
   // Only expired-token refresh needs a row lock. Re-read after taking it so
   // concurrent requests can reuse a token another request already refreshed.
   user=await sql.begin(async tx=>{
    const [current]=await tx`select provider_tokens from promptchamp.account_sessions where id=${session.id} and expires_at>clock_timestamp() for update`;
    if(!current)return null;
    try{
     const latest=decryptTokens(current.provider_tokens);
     if(current.provider_tokens!==session.provider_tokens){
      try{return checkedUser(await authRequest('user','GET',undefined,latest.access_token));}
      catch(changedError){if(!(changedError instanceof AccountError)||changedError.status!==401)throw changedError;}
     }
     const refreshed=await authRequest('token?grant_type=refresh_token','POST',{refresh_token:latest.refresh_token});
     const verified=checkedUser(await authRequest('user','GET',undefined,refreshed.access_token));
     if(verified.id!==session.user_id)throw new AccountError('Session identity mismatch.',401);
     await tx`update promptchamp.account_sessions set provider_tokens=${encryptTokens(refreshed)} where id=${session.id}`;
     return verified;
    }catch(refreshError){if(refreshError instanceof AccountError&&refreshError.status===401){await tx`delete from promptchamp.account_sessions where id=${session.id}`;return null;}throw refreshError;}
   });
   if(!user)return null;
  }
  checkedUser(user);if(user.id!==session.user_id)throw new AccountError('Session identity mismatch.',401);
  let platformAdmin=session.platform_admin;
  const bootstrap=user.email.toLowerCase()===process.env.PLATFORM_OWNER_EMAIL?.trim().toLowerCase();
  if(session.profile_email!==user.email.toLowerCase()||(bootstrap&&(!session.platform_admin||!session.office_owned))){
   await sql.begin(tx=>syncProfile(tx,user));
   const [platform]=await sql`select user_id from promptchamp.platform_admins where user_id=${user.id}`;
   platformAdmin=!!platform;
  }
  return {user:{id:user.id,email:user.email,displayName:user.user_metadata?.display_name??''},sessionId:session.id,workspaceId:session.workspace_id,purpose:session.purpose,platformAdmin};
}
export async function signOutAccount(request:Request){const token=rawSession(request);if(token){const [session]=await eventDb()`delete from promptchamp.account_sessions where token_hash=${digest(token)} returning provider_tokens`;if(session){try{await authRequest('logout?scope=local','POST',{},decryptTokens(session.provider_tokens).access_token);}catch{}}}return accountCookie(request,'',true);}
export async function legacyAllowed(){const [row]=await eventDb()`select legacy_login_enabled from promptchamp.platform_settings where id=true`;return !!row?.legacy_login_enabled&&process.env.ALLOW_LEGACY_HOST_LOGIN!=='false';}
export async function accountContext(request:Request){
 const account=await accountFor(request);if(!account)return null;
 if(account.purpose==='recovery')throw new AccountError('Set your new password before opening the dashboard.',403);
 if(!account.workspaceId)throw new AccountError('Create or select a workspace to continue.',409);
 const [workspace]=await eventDb()`select w.*,m.role from promptchamp.workspaces w left join promptchamp.workspace_members m on m.workspace_id=w.id and m.user_id=${account.user.id} where w.id=${account.workspaceId}`;
 if(!workspace||(!workspace.role&&!account.platformAdmin))throw new AccountError('Workspace access denied.',403);
 if(workspace.status==='suspended'&&!account.platformAdmin)throw new AccountError('This workspace is suspended. Contact the platform administrator.',403);
 return {...account,workspace,role:account.platformAdmin?'owner':workspace.role,legacy:false};
}
