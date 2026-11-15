import './style.css';
const escape=(s:unknown)=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
void(async()=>{const target=document.querySelector('#event-list')!;try{
 const response=await fetch('/api/events');const data=await response.json();if(!response.ok)throw new Error(data.error);
 target.innerHTML=data.events.length?data.events.map((e:any)=>`<a class="card card-body" href="/${e.status==='completed'?'leaderboard':'event'}.html?event=${encodeURIComponent(e.slug)}"><span class="pill">${escape(e.status)} / ${escape(e.mode)}</span><h3>${escape(e.title)}</h3><p>${escape(new Date(e.scheduled_at).toLocaleString('en-MY',{timeZone:'Asia/Kuala_Lumpur'}))} MYT</p><div class="card-bottom">${e.status==='completed'?'View results':'Open event'} &rarr;</div></a>`).join(''):'<p class="form">No events are open yet. Your host will share a registration link when ready.</p>';
 }catch(error:any){target.textContent=error.message;}})();
