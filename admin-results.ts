const escape=(s:unknown)=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
let dispose:(()=>void)|undefined;
export function attachResults(parent:HTMLElement,event:{id:string;slug:string;status:string}){
 dispose?.();dispose=undefined;if(!['live','completed'].includes(event.status))return;
 const panel=document.createElement('section');panel.className='form host-queue';parent.append(panel);
 let busy=false,signature='',notice='';
 const endpoint=`/api/admin/events/${event.id}/results`;
 async function load(){if(!panel.isConnected||busy)return;try{
  const response=await fetch(endpoint);const data=await response.json();if(!response.ok)throw new Error(data.error);
  const key=JSON.stringify(data);if(key===signature)return;signature=key;render(data);
 }catch(error:any){panel.textContent=error.message;}}
 async function act(action:string,submissionId?:string){
  if(busy)return;const reason=panel.querySelector<HTMLInputElement>(`[data-reason="${submissionId}"]`)?.value;
  busy=true;notice='';panel.querySelectorAll<HTMLButtonElement>('button').forEach(b=>b.disabled=true);
  try{const response=await fetch(endpoint+'/'+action,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({submissionId,reason})});const data=await response.json();if(!response.ok)throw new Error(data.error);if(action==='publish'){location.reload();return;}}
  catch(error:any){notice=error.message;}finally{busy=false;signature='';await load();}
 }
 function render(data:any){
  const released=data.usage.results_visibility==='released';
  const incomplete=data.rows.some((r:any)=>['waiting','called','active'].includes(r.state)||(r.submission_id&&!['scored','voided'].includes(r.status)));
  const board='/leaderboard.html?event='+encodeURIComponent(event.slug);
  panel.innerHTML=`<div class="section-head"><h2>Results and AI processing</h2><a href="${board}" target="_blank" rel="noopener">Presentation leaderboard</a></div><p>AI image requests reserved: ${data.usage.used} / ${data.usage.generation_cap}. Scoring retries reuse the saved image.</p>${notice?`<p class="notice" role="status">${escape(notice)}</p>`:''}<div class="queue-scroll"><table><thead><tr><th>Team</th><th>Processing</th><th>Match</th><th>Resolve</th></tr></thead><tbody>${data.rows.map((r:any)=>`<tr><td>${escape(r.name)}</td><td>${escape(r.status??r.state)}</td><td>${r.score==null?'Pending':r.score+'%'}</td><td>${!released&&r.status==='judge_failed'?`<button data-action="retry-scoring" data-id="${r.submission_id}">Retry scoring</button>`:''}${!released&&['judge_failed','needs_review','generation_failed'].includes(r.status)?`<label>Resolution reason<input data-reason="${r.submission_id}" minlength="5" maxlength="300" placeholder="Explain the technical problem"></label><button data-action="retry-generation" data-id="${r.submission_id}">Generate replacement (uses quota)</button><button data-action="void" data-id="${r.submission_id}">Void failed entry</button>`:''}</td></tr>`).join('')}</tbody></table></div>${released?'<p class="notice">Final results are published.</p>':`<p>Publish after every turn and result is resolved. Equal match scores share a rank.</p><button class="button" data-action="publish" ${incomplete?'disabled':''}>Publish final leaderboard</button>`}`;
  panel.querySelectorAll<HTMLButtonElement>('[data-action]').forEach(b=>b.onclick=()=>void act(b.dataset.action!,b.dataset.id));
 }
 const timer=setInterval(()=>void load(),3000);dispose=()=>clearInterval(timer);void load();
}
