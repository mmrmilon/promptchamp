import './style.css';
import './present.css';
const root=document.querySelector<HTMLElement>('#present-root')!;
const id=new URLSearchParams(location.search).get('event')??'';
let busy=false,stopped=false,signature='',deadline:string|null=null,offset=0;
async function refresh(){
 if(busy||stopped||document.hidden)return;busy=true;const sent=Date.now();
 try{
  if(!/^[a-f0-9-]{36}$/i.test(id))throw new Error('Open this screen using Present current team in your event dashboard.');
  const response=await fetch(`/api/admin/events/${id}/presentation`,{cache:'no-store',signal:AbortSignal.timeout(10000)});
  const data=await response.json();
  if(!response.ok){if([401,403,404].includes(response.status))stopped=true;throw new Error(data.error??'Presentation unavailable.');}
  offset=data.serverNow-(sent+Date.now())/2;deadline=data.turn?.state==='active'?data.turn.deadline_at:null;
  const next=JSON.stringify([data.event,data.turn]);if(next!==signature){signature=next;render(data);}tick();
 }catch(error){signature='';deadline=null;root.innerHTML='<section class="present-message"><h1>Host presentation unavailable</h1><p role="status"></p><a href="/admin">Open the host dashboard to sign in, then reload this screen.</a></section>';root.querySelector('p')!.textContent=(error as Error).message;}
 finally{busy=false;}
}
function render(data:any){
 const turn=data.turn;
 root.innerHTML='<section class="present-heading"><div><p class="eyebrow" id="event-name"></p><h1 id="team-name"></h1><p id="turn-info"></p></div><div class="present-clock"><span id="clock-label"></span><strong id="countdown"></strong></div></section><section class="present-comparison"><figure><figcaption>Reference image</figcaption><div class="present-image" id="reference-slot"></div></figure><figure><figcaption id="result-label">Team recreation</figcaption><div class="present-image" id="result-slot"></div></figure></section><section class="present-prompt"><span class="eyebrow">Submitted prompt</span><p id="prompt-text"></p></section>';
 root.querySelector('#event-name')!.textContent=data.event.title;
 root.querySelector('#team-name')!.textContent=turn?turn.name:'Waiting for the next team';
 root.querySelector('#turn-info')!.textContent=turn?`Lucky number ${turn.lucky_number} · ${turn.state} · ${data.event.reference_mode==='random_unique'?'Unique random reference':'Shared reference'}`:'The host will call a team from the dashboard.';
 root.querySelector('#clock-label')!.textContent=turn?.state==='active'?'Time remaining':turn?.score!=null?'Visual match':'Turn status';
 root.querySelector('#countdown')!.textContent=turn?.score!=null?`${turn.score}%`:turn?.state==='expired'?'Time up':turn?.state==='called'?'Ready':turn?.processing_status??'Waiting';
 root.querySelector('#prompt-text')!.textContent=turn?.prompt??'The prompt appears after the team submits. Unsubmitted drafts are not projected.';
 if(data.event.mode==='demo')root.querySelector('#result-label')!.textContent='Demo sample · simulated score';
 const image=(slot:string,asset:string,show:boolean,message:string)=>{const box=root.querySelector<HTMLElement>('#'+slot)!;if(show){const img=document.createElement('img');img.alt=asset==='reference'?'Current team reference':'Current team recreation';img.src=`/api/admin/events/${id}/presentation/${asset}?entry=${turn.id}`;img.onerror=()=>{img.remove();box.textContent='Image updating. The host can refresh this screen.';};box.append(img);}else box.textContent=message;};
 image('reference-slot','reference',!!turn?.started_at,'Revealed when the called team presses Start.');
 image('result-slot','image',!!turn?.has_image,turn?.started_at?'The recreation appears after processing.':'Waiting for the challenge to begin.');
}
function tick(){if(!deadline)return;const remaining=Math.max(0,Math.ceil((Date.parse(deadline)-Date.now()-offset)/1000));const clock=root.querySelector('#countdown');if(clock)clock.textContent=`${Math.floor(remaining/60)}:${String(remaining%60).padStart(2,'0')}`;}
const button=document.querySelector<HTMLButtonElement>('#fullscreen')!;
if(document.fullscreenEnabled){button.hidden=false;button.onclick=async()=>{try{if(document.fullscreenElement)await document.exitFullscreen();else await document.documentElement.requestFullscreen();}catch{button.textContent='Use F11 for full screen';}};document.addEventListener('fullscreenchange',()=>{button.textContent=document.fullscreenElement?'Exit full screen':'Full screen';});}
void refresh();const poll=setInterval(()=>void refresh(),2000),clock=setInterval(tick,250);
window.addEventListener('focus',()=>void refresh());window.addEventListener('pagehide',()=>{clearInterval(poll);clearInterval(clock);},{once:true});window.addEventListener('pageshow',event=>{if(event.persisted)location.reload();});
