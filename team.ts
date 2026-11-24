import './style.css';
import './team.css';
const workspace = document.querySelector<HTMLElement>('#team-workspace')!;
const message = document.querySelector<HTMLElement>('#team-message')!;
const slug = new URLSearchParams(location.search).get('event') ?? '';
const escape = (s: unknown) => String(s ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
let event: any, state: any, signature = '', text = '', savedText = '', version = 0, offset = 0;
let busy = false, saving = false, recoveryCode = '', requestId = crypto.randomUUID();
async function api(action: string, method='GET', body?: unknown) {
  const response = await fetch(`/api/team/${event.id}/${action}`,{method,headers:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
  const data=await response.json();
  if(!response.ok) throw Object.assign(new Error(data.error),{status:response.status});
  return data;
}
async function run(task:()=>Promise<void>) {
  if(busy) return; busy=true; message.textContent='';
  workspace.querySelectorAll<HTMLButtonElement>('button').forEach(b=>b.disabled=true);
  try {await task();} catch(error:any){message.textContent=error.message;}
  finally {busy=false;signature='';if(state) render();else join();}
}
function join() {
  workspace.innerHTML=`<div class="team-columns"><form id="join-team" class="form"><h2>Bring your team.</h2><p>Choose one device to play. Save the recovery code after joining.</p><label>Team name<input name="name" required minlength="2" maxlength="50" autocomplete="organization"></label><button class="button" ${event.status!=='registration'?'disabled':''}>Join event</button>${event.status!=='registration'?'<p>New registrations have closed.</p>':''}</form><form id="recover-team" class="form"><h2>Already joined?</h2><label>Team name<input name="name" required minlength="2" maxlength="50"></label><label>Private recovery code<input name="recoveryCode" type="password" required autocomplete="off"></label><button class="button">Recover team</button></form></div>`;
  for(const [id,action] of [['join-team','register'],['recover-team','recover']]) workspace.querySelector('#'+id)!.addEventListener('submit', e=>{
    e.preventDefault();const values=new FormData(e.currentTarget as HTMLFormElement);
    void run(async()=>{const result=await api(action,'POST',Object.fromEntries(values));recoveryCode=result.recoveryCode??'';await refresh();});
  });
}
async function refresh() {
  const sent=Date.now();
  try {
    const next=await api('state'); offset=next.serverNow-(sent+Date.now())/2;
    const first=!state;state=next;event.status=state.event.status;
    if(first){text=state.entry.draft_prompt;savedText=text;version=state.entry.draft_version;}
    const key=JSON.stringify([state.entry.id,state.entry.state,state.entry.submission_status,state.entry.score,state.event.status,state.event.results_visibility,state.queue,recoveryCode]);
    if(key!==signature){signature=key;render();}
    tick();
  }catch(error:any){if(error.status===401){state=null;join();}else message.textContent=error.message;}
}
function render() {
  const entry=state.entry;
  const available=Array.from({length:state.event.team_capacity},(_,i)=>i+1);
  const taken=new Set(state.queue.filter((e:any)=>e.id!==entry.id).map((e:any)=>e.lucky_number));
  workspace.innerHTML=`${recoveryCode?`<div class="notice"><strong>Save your private recovery code</strong><p>Use it with your team name to return on another device. Do not share it with other teams.</p><code>${escape(recoveryCode)}</code><button id="saved-code" type="button">I've saved it</button></div>`:''}<div class="section-head"><h2>${escape(state.team.name)}</h2><span class="pill">${escape(entry.state==='withdrawn'?'Skipped':entry.state)}</span></div>
  ${state.event.status==='registration'?`<section class="form"><h2>Pick your lucky number</h2><p>Lower numbers play first. ${event.reference_mode==='random_unique'?'Each team receives a different random image when its turn starts.':'Every team gets the same reference image.'}</p><div class="number-grid">${available.map(n=>`<button type="button" class="lucky ${entry.lucky_number===n?'chosen':''}" data-number="${n}" ${taken.has(n)?'disabled':''}>${n}</button>`).join('')}</div><p>${entry.lucky_number?`Your number is ${entry.lucky_number}. You can change it until the host locks the draw.`:'Choose an available number to reserve your place.'}</p></section>`:
    entry.state==='called'?`<section class="form"><h2>It's your turn.</h2><p>Start reveals the image and begins your ${event.duration_seconds/60}-minute timer. Submit before time runs out. Refreshing will not restart the clock.</p><button id="start" class="button">Start challenge</button></section>`:
    entry.state==='active'?`<section class="form"><div class="section-head"><h2>Recreate the image</h2><strong id="countdown" role="timer"></strong></div><div class="team-challenge"><img class="team-reference" src="/api/team/${event.id}/reference" alt="Reference image to recreate"><form id="prompt-form"><label>Your prompt<textarea name="prompt" id="team-prompt" minlength="5" maxlength="1000" required>${escape(text)}</textarea></label><p id="draft-status">Draft saved after you stop typing. Submission is final.</p><button class="button" id="submit-prompt">Submit prompt</button></form></div></section>`:
    ['submitted','completed'].includes(entry.state)?`<section class="form"><h2>Prompt submitted.</h2><p>Your prompt was accepted before the deadline and saved for scoring.</p><blockquote>${escape(entry.submitted_prompt)}</blockquote><p class="notice">${entry.submission_status==='scored'?'Your visual match has been scored.':['needs_review','generation_failed','judge_failed'].includes(entry.submission_status)?'The host is resolving a processing problem. Your accepted prompt is saved.':entry.submission_status==='voided'?'The host voided this entry after a technical problem.':'Your recreation is being generated and scored. You can leave this page and return later.'}</p>${entry.has_image?`<div class="comparison"><figure><figcaption>Reference</figcaption><img src="/api/team/${event.id}/reference" alt="Reference image"></figure><figure><figcaption>${event.mode==='demo'?'Demo sample':'Your recreation'}</figcaption><img src="/api/team/${event.id}/image" alt="Generated image"></figure></div>`:''}${entry.score!=null?`<h2>${event.mode==='demo'?'Simulated match':'Visual match'}: ${entry.score}%</h2><p>${escape(entry.tip)}</p><ul>${['Main subject','Setting and objects','Composition','Lighting and color','Visual style'].map((label,i)=>`<li>${label}: ${entry.ratings[i]}/5</li>`).join('')}</ul>`:''}<p><a class="button" href="/leaderboard?event=${encodeURIComponent(event.slug)}">View leaderboard</a></p></section>`:
    entry.state==='expired'?'<section class="form"><h2>Time is up.</h2><p>No prompt was submitted before the deadline. Your saved draft has not been automatically entered. Speak to the host if there was a technical problem.</p></section>':`<section class="form"><h2>${entry.state==='withdrawn'?'Your team was skipped.':'You’re in the queue.'}</h2><p>${entry.state==='withdrawn'?'Ask the host to recall your team when ready.':'Wait for the host to call your team. Your timer starts only when you press Start.'}</p></section>`}
  <section class="form"><h2>Playing order</h2><div class="queue-scroll"><table><thead><tr><th>Number</th><th>Team</th><th>Status</th></tr></thead><tbody>${state.queue.map((q:any)=>`<tr><td>${q.lucky_number??'—'}</td><td>${escape(q.name)}${q.id===entry.id?' (you)':''}</td><td>${escape(q.state==='withdrawn'?'Skipped':q.state)}</td></tr>`).join('')}</tbody></table></div></section>`;
  workspace.querySelector('#saved-code')?.addEventListener('click',()=>{recoveryCode='';render();});
  workspace.querySelectorAll<HTMLButtonElement>('[data-number]').forEach(b=>b.onclick=()=>void run(async()=>{await api('number','POST',{number:Number(b.dataset.number)});await refresh();}));
  workspace.querySelector('#start')?.addEventListener('click',()=>void run(async()=>{await api('start','POST',{});await refresh();}));
  workspace.querySelector<HTMLTextAreaElement>('#team-prompt')?.addEventListener('input',e=>{text=(e.target as HTMLTextAreaElement).value;});
  workspace.querySelector('#prompt-form')?.addEventListener('submit',e=>{e.preventDefault();void run(async()=>{await api('submit','POST',{prompt:text,requestId});await refresh();});});
  tick();
}
function tick() {
  const clock=document.querySelector('#countdown');if(!clock||!state?.entry.deadline_at)return;
  const remaining=Math.max(0,Math.ceil((Date.parse(state.entry.deadline_at)-Date.now()-offset)/1000));
  clock.textContent=`${Math.floor(remaining/60)}:${String(remaining%60).padStart(2,'0')}`;
  const input=document.querySelector<HTMLTextAreaElement>('#team-prompt');const submit=document.querySelector<HTMLButtonElement>('#submit-prompt');
  if(input) input.disabled=remaining===0;if(submit)submit.disabled=remaining===0||busy;
}
setInterval(tick,250);
setInterval(()=>{if(event&&state&&!busy)void refresh();},3000);
setInterval(async()=>{
  if(!state||state.entry.state!=='active'||saving||busy||text===savedText)return;
  saving=true;const draft=text;
  try{const result=await api('draft','PUT',{prompt:draft,version});version=result.version;savedText=draft;const status=document.querySelector('#draft-status');if(status)status.textContent='Draft saved. Submit before time runs out.';}
  catch(error:any){message.textContent=error.message;}finally{saving=false;}
},1500);
window.addEventListener('focus',()=>{if(event&&state)void refresh();});
void(async()=>{
  try{const response=await fetch('/api/events/'+encodeURIComponent(slug));const data=await response.json();if(!response.ok)throw new Error(data.error);event=data.event;document.querySelector('#event-title')!.textContent=event.title;document.querySelector('#event-info')!.textContent=`${event.duration_seconds/60} minutes. ${event.reference_mode==='random_unique'?'Different reference per team.':'Shared reference image.'} ${event.mode==='demo'?'DEMO: sample images and simulated scores.':'Live AI generation and visual judging.'}`;await refresh();}
  catch(error:any){workspace.textContent=error.message;}
})();
