const esc=(s:unknown)=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
export function attachReferences(parent:HTMLElement,event:{id:string;status:string;reference_mode:string},reload:()=>Promise<void>){
 if(event.reference_mode!=='random_unique')return;
 const panel=document.createElement('section');panel.className='form reference-pool';parent.append(panel);
 const endpoint=`/api/admin/events/${event.id}/references`;
 let images:any[]=[],editable=false,busy=false,notice='';
 async function api(path='',method='GET',body?:unknown){const response=await fetch(endpoint+path,{method,headers:{'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});const data=await response.json();if(!response.ok)throw new Error(data.error);return data;}
 async function load(){try{const data=await api();if(!panel.isConnected)return;images=data.images;editable=data.editable;render();}catch(error){notice=(error as Error).message;render();}}
 function render(){
  if(!panel.isConnected)return;
  panel.innerHTML=`<h2>Random reference pool</h2><p>Upload at least one different image per registered team. Assignments are random, unique, and saved when you lock the draw. Use images of similar difficulty.</p><p>${images.length} images available. ${editable?'You can add or remove images until the draw locks.':'The draw is locked; this pool is frozen.'}</p>${notice?`<p role="status" class="notice">${esc(notice)}</p>`:''}${editable?`<form id="pool-upload"><label>Reference images<input name="images" type="file" accept="image/png,image/jpeg,image/webp" multiple required ${busy?'disabled':''}></label><small>Up to 100 images. Maximum 2 MiB each. Images upload individually.</small><button class="button" ${busy?'disabled':''}>${busy?'Uploading...':'Add images'}</button></form>`:''}<div class="reference-pool-grid">${images.map(image=>`<figure><img loading="lazy" src="${endpoint}/${image.id}" alt="${esc(image.label)}"><figcaption>${esc(image.label)}</figcaption>${editable?`<button type="button" data-remove="${image.id}" ${busy?'disabled':''}>Remove</button>`:''}</figure>`).join('')}</div>`;
  panel.querySelector<HTMLFormElement>('#pool-upload')?.addEventListener('submit',e=>{e.preventDefault();const files=Array.from((panel.querySelector<HTMLInputElement>('input[type=file]')!).files??[]);void upload(files);});
  panel.querySelectorAll<HTMLButtonElement>('[data-remove]').forEach(button=>button.onclick=async()=>{if(busy)return;busy=true;notice='';render();try{await api('/'+button.dataset.remove,'DELETE');await reload();}catch(error){notice=(error as Error).message;}finally{busy=false;await load();}});
 }
 async function upload(files:File[]){
  if(busy)return;
  if(!files.length||files.some(f=>!f.size||f.size>2*1024*1024)){notice='Choose images under 2 MiB each.';render();return;}
  if(files.length+images.length>100){notice='An event can contain up to 100 images.';render();return;}
  busy=true;let uploaded=0;
  try{for(const file of files){notice=`Uploading ${uploaded+1} of ${files.length}...`;render();const data=await new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(',')[1]);reader.onerror=reject;reader.readAsDataURL(file);});await api('','POST',{mimeType:file.type,data,label:file.name});uploaded++;}notice=`${uploaded} images added.`;await reload();}
  catch(error){notice=`${uploaded} images added. ${(error as Error).message}`;}
  finally{busy=false;await load();}
 }
 panel.innerHTML='<p role="status">Loading reference pool...</p>';void load();
}
