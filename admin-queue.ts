const escape = (s: unknown) => String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
let stop: (()=>void)|undefined;
export function attachQueue(parent: HTMLElement, event: {id:string;slug:string;status:string}) {
  stop?.();stop=undefined;
  if(!['registration','live'].includes(event.status)) return;
  const panel=document.createElement('section');panel.className='form host-queue';parent.append(panel);
  let active=true,busy=false,rows:any[]=[];
  stop=()=>{active=false;clearInterval(timer);};
  const endpoint=`/api/admin/events/${event.id}/queue`;
  const link=new URL('/event?event='+encodeURIComponent(event.slug),location.origin).href;
  let notice='';
  async function load(){
    if(!active||!panel.isConnected||busy)return;
    try{const response=await fetch(endpoint);const data=await response.json();if(!response.ok)throw new Error(data.error);rows=data.queue;render();}
    catch(error:any){notice=error.message;render();}
  }
  async function action(name:string,entryId?:string){
    if(busy)return;busy=true;notice='';render();
    try{const response=await fetch(endpoint+'/'+name,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({entryId})});const data=await response.json();if(!response.ok)throw new Error(data.error);
      if(name==='lock'){location.reload();return;} rows=data.queue;
    }catch(error:any){notice=error.message;}finally{busy=false;render();}
  }
  function render(){
    if(!active||!panel.isConnected)return;
    const current=rows.find(r=>['called','active'].includes(r.state));
    panel.innerHTML=`<h2>Team queue</h2><p>Share this registration link with participating teams:</p><p><a href="${escape(link)}" target="_blank" rel="noopener">${escape(link)}</a></p><p>${rows.length} teams registered. Lucky numbers set playing order.</p>${notice?`<p class="notice" role="status">${escape(notice)}</p>`:''}
    <div class="queue-actions">${event.status==='registration'?`<button class="button" data-action="lock" ${busy||!rows.length||rows.some(r=>!r.lucky_number)?'disabled':''}>Close registration and lock draw</button>`:`<button class="button" data-action="next" ${busy||current||!rows.some(r=>r.state==='waiting')?'disabled':''}>Call next team</button><p>${current?`Current team: <strong>${escape(current.name)}</strong> (${escape(current.state)})${current.deadline_at?' · Deadline '+escape(new Date(current.deadline_at).toLocaleTimeString('en-MY',{timeZone:'Asia/Kuala_Lumpur'}))+' MYT':''}`:'No team is currently called.'}</p>`}</div>
    <div class="queue-scroll"><table><thead><tr><th>No.</th><th>Team</th><th>Status</th><th>Action</th></tr></thead><tbody>${rows.map(r=>`<tr><td>${r.lucky_number??'Not picked'}</td><td>${escape(r.name)}</td><td>${escape(r.state==='withdrawn'?'Skipped':r.state)}</td><td>${r.state==='called'?`<button data-action="skip" data-entry="${r.id}" ${busy?'disabled':''}>Skip absent team</button>`:r.state==='withdrawn'?`<button data-action="recall" data-entry="${r.id}" ${busy?'disabled':''}>Return to queue</button>`:''}</td></tr>`).join('')}</tbody></table></div><small>Accepted prompts are generated and scored in the background. Monitor results below.</small>`;
    panel.querySelectorAll<HTMLButtonElement>('[data-action]').forEach(button=>button.onclick=()=>void action(button.dataset.action!,button.dataset.entry));
  }
  const timer=setInterval(()=>void load(),3000);void load();
}
