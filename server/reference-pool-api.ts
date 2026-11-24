import {createHash} from 'node:crypto';
import {AccountError} from './account-session';
const json=(body:unknown,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'no-store'}});
export async function referencePoolApi(sql:any,eventId:string,imageId:string|undefined,method:string,body:any,validate:(mime:unknown,data:unknown)=>boolean){
 if(method==='GET'){
  if(imageId){const [image]=await sql`select mime_type,data from promptchamp.reference_pool_images where id=${imageId} and event_id=${eventId}`;
   return image?new Response(Buffer.from(image.data,'base64'),{headers:{'Content-Type':image.mime_type,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}}):json({error:'Reference not found.'},404);}
  const [event]=await sql`select status,reference_mode from promptchamp.events where id=${eventId}`;
  return json({images:await sql`select id,label from promptchamp.reference_pool_images where event_id=${eventId} order by created_at,id`,editable:['draft','registration'].includes(event.status)&&event.reference_mode==='random_unique'});
 }
 if((method!=='POST'||imageId)&&(method!=='DELETE'||!imageId))return json({error:'Method not allowed.'},405);
 if(method==='POST'&&!validate(body.mimeType,body.data))throw new AccountError('Choose a PNG, JPEG, or WebP image under 2 MiB.');
 await sql.begin(async(tx:any)=>{
  const [event]=await tx`select status,reference_mode from promptchamp.events where id=${eventId} for update`;
  if(event.reference_mode!=='random_unique'||!['draft','registration'].includes(event.status))throw new AccountError('The image pool is frozen after the draw locks.',409);
  if(method==='DELETE'){await tx`delete from promptchamp.reference_pool_images where id=${imageId} and event_id=${eventId}`;}
  else{
   const [count]=await tx`select count(*)::int as total from promptchamp.reference_pool_images where event_id=${eventId}`;
   if(count.total>=100)throw new AccountError('An event can contain up to 100 pool images.',409);
   const hash=createHash('sha256').update(Buffer.from(body.data,'base64')).digest('hex');
   const prior=await tx`select id from promptchamp.reference_pool_images where event_id=${eventId} and image_hash=${hash}`;
   if(prior.length)throw new AccountError('That exact image is already in this event pool. Choose a different image.',409);
   const label=typeof body.label==='string'?body.label.trim().slice(0,100):'';
   await tx`insert into promptchamp.reference_pool_images(event_id,label,mime_type,data,image_hash) values(${eventId},${label||'Reference image'},${body.mimeType},${body.data},${hash})`;
  }
  await tx`insert into promptchamp.audit_events(event_id,action) values(${eventId},${method==='DELETE'?'pool_image_removed':'pool_image_added'})`;
 });
 return json({},method==='POST'?201:200);
}
