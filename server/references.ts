import {randomInt} from 'node:crypto';

// Called under the event lock, before the draw is marked live. No re-draw on retries.
export async function assignReferences(tx:any,event:any,roundId:string){
 if(event.reference_mode!=='random_unique')return;
 const entries=await tx`select id from promptchamp.round_entries where round_id=${roundId} and is_current order by id`;
 const images=await tx`select id from promptchamp.reference_pool_images where event_id=${event.id} order by id`;
 if(images.length<entries.length)throw new Error('REFERENCE_POOL_SHORT');
 for(let i=images.length-1;i>0;i--){const j=randomInt(i+1);[images[i],images[j]]=[images[j],images[i]];}
 // Assign in one statement, avoiding one database round trip per team.
 const entryIds=entries.map((entry:any)=>entry.id),imageIds=images.slice(0,entries.length).map((image:any)=>image.id);
 await tx`update promptchamp.round_entries n set reference_image_id=a.image_id
  from unnest(${entryIds}::uuid[],${imageIds}::uuid[]) as a(entry_id,image_id) where n.id=a.entry_id`;
}

export async function entryReference(sql:any,entryId:string){
 const [image]=await sql`select case when e.reference_mode='random_unique' then p.mime_type else r.mime_type end as mime_type,
  case when e.reference_mode='random_unique' then p.data else r.data end as data
  from promptchamp.round_entries n join promptchamp.events e on e.id=n.event_id
  left join promptchamp.reference_images r on r.event_id=e.id
  left join promptchamp.reference_pool_images p on p.id=n.reference_image_id and p.event_id=e.id where n.id=${entryId}`;
 return image?.data?image:null;
}
