import {registrationLink,registrationQR} from './registration-qr';
const escape = (s: unknown) => String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
let stop: (()=>void)|undefined;
export function attachQueue(parent: HTMLElement, event: {id:string;slug:string;status:string}) {
  stop?.();stop=undefined;
  if(!['registration','live'].includes(event.status)) return;
  const panel=document.createElement('section');panel.className='form host-queue';parent.append(panel);
  let active=true,busy=false,rows:any[]=[];
  stop=()=>{active=false;clearInterval(timer);};
  const endpoint=`/api/admin/events/${event.id}/queue`;
  const link=registrationLink(event.slug,location.origin);
  const presentation=new URL('/share?event='+encodeURIComponent(event.slug),location.origin).href;
  let notice='',qrImage='',sharingNotice='';
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
    panel.innerHTML=`<h2>Team queue</h2><div class="registration-share"><div class="registration-qr-preview">${qrImage?`<img src="${qrImage}" width="180" height="180" alt="Scan to open this event's team registration">`:'<span>Preparing QR code...</span>'}</div><div class="registration-share-details"><span class="eyebrow">${event.status==='registration'?'Invite your teams':'Team access'}</span><h3>${event.status==='registration'?'Scan to join the challenge':'Registration is closed'}</h3><p>${event.status==='registration'?'Display the QR code on a big screen. Each team scans it to register, save its recovery code, and pick a lucky number.':'Existing teams can use this link to continue or recover their team. New teams cannot register.'}</p><p><a href="${escape(link)}" target="_blank" rel="noopener">${escape(link)}</a></p><div class="registration-share-actions"><a class="button" href="${escape(presentation)}" target="_blank" rel="noopener">Show on big screen</a><button type="button" id="copy-registration-link">Copy link</button>${qrImage?`<a class="registration-download" href="${qrImage}" download="${event.slug}-registration.svg">Download QR</a>`:''}</div><p class="registration-share-status" role="status">${escape(sharingNotice)}</p></div></div><p>${rows.length} teams registered. Lucky numbers set playing order.</p>${notice?`<p class="notice" role="status">${escape(notice)}</p>`:''}
    <div class="queue-actions">${event.status==='registration'?`<button class="button" data-action="lock" ${busy||!rows.length||rows.some(r=>!r.lucky_number)?'disabled':''}>Close registration and lock draw</button>`:`<button class="button" data-action="next" ${busy||current||!rows.some(r=>r.state==='waiting')?'disabled':''}>Call next team</button><p>${current?`Current team: <strong>${escape(current.name)}</strong> (${escape(current.state)})${current.deadline_at?' · Deadline '+escape(new Date(current.deadline_at).toLocaleTimeString('en-MY',{timeZone:'Asia/Kuala_Lumpur'}))+' MYT':''}`:'No team is currently called.'}</p>`}</div>
    <div class="queue-scroll"><table><thead><tr><th>No.</th><th>Team</th><th>Status</th><th>Action</th></tr></thead><tbody>${rows.map(r=>`<tr><td>${r.lucky_number??'Not picked'}</td><td>${escape(r.name)}</td><td>${escape(r.state==='withdrawn'?'Skipped':r.state)}</td><td>${r.state==='called'?`<button data-action="skip" data-entry="${r.id}" ${busy?'disabled':''}>Skip absent team</button>`:r.state==='withdrawn'?`<button data-action="recall" data-entry="${r.id}" ${busy?'disabled':''}>Return to queue</button>`:''}</td></tr>`).join('')}</tbody></table></div><small>Accepted prompts are generated and scored in the background. Monitor results below.</small>`;
    panel.querySelectorAll<HTMLButtonElement>('[data-action]').forEach(button=>button.onclick=()=>void action(button.dataset.action!,button.dataset.entry));
    panel.querySelector<HTMLButtonElement>('#copy-registration-link')!.onclick=async()=>{try{await navigator.clipboard.writeText(link);sharingNotice='Registration link copied.';}catch{sharingNotice='Copy the registration link shown above.';}if(active&&panel.isConnected)panel.querySelector('.registration-share-status')!.textContent=sharingNotice;};
  }
  const timer=setInterval(()=>void load(),3000);void load();
  void registrationQR(event.slug,location.origin).then(qr=>{qrImage=qr.image;render();}).catch(()=>{sharingNotice='QR code unavailable. Use the registration link above.';render();});
}
