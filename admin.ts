import { initAccounts } from './account-ui';
import { formatLocalInput, zonedInstant } from './time';
import { attachResults } from './admin-results';
import { attachQueue } from './admin-queue';
import {attachReferences} from './admin-references';
import './reference-pool.css';
import './style.css';
import './admin.css';
import './admin-sidebar.css';
import './registration-share.css';

type Event = { id: string; title: string; slug: string; scheduled_at: string; status: string; generation_cap: number; duration_seconds: number; team_capacity: number; mode: string; has_reference: boolean; reference_mode:string; reference_count:number };
let workspace = document.querySelector<HTMLElement>('#workspace')!;
let activeWorkspace:any={default_mode:'live',default_duration:120,timezone:'Asia/Kuala_Lumpur',live_enabled:true};
let legacyContext=false;
const feedback = document.querySelector<HTMLElement>('#feedback')!;
const logout = document.querySelector<HTMLButtonElement>('#logout')!;
let events: Event[] = [];
let selected: string | null = sessionStorage.getItem('promptchamp-host-event');
const escape = (s: unknown) => String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[c]!);
async function api(path: string, method = 'GET', body?: unknown) {
  const response = await fetch('/api/admin/' + path, { method, headers: { 'Content-Type':'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? 'Request failed.');
  return data;
}
async function action(run: () => Promise<void>) {
  const buttons = [...workspace.querySelectorAll<HTMLButtonElement>('button')];
  buttons.forEach(b => b.disabled = true);
  feedback.textContent = '';
  try { await run(); } catch (error) { feedback.textContent = (error as Error).message; }
  finally { buttons.forEach(b => b.disabled = false); }
}
function signIn() {
  logout.hidden = true;
  workspace.innerHTML = `<form id="login" class="form host-login"><h2>Host sign-in</h2><p>Use the host access key configured for this application.</p><label>Host access key<input name="key" type="password" required autocomplete="current-password"></label><button class="button">Sign in</button></form>`;
  workspace.querySelector('form')!.onsubmit = event => {
    event.preventDefault();
    const values = new FormData(event.currentTarget as HTMLFormElement);
    void action(async () => { await api('login','POST',{ key: values.get('key') }); await load(); });
  };
}
async function load() {
  const result=await api('events');
  events=result.events;activeWorkspace=result.workspace;legacyContext=!!result.legacy;
  logout.hidden = false;
  render();
}
function render() {
  if(selected) sessionStorage.setItem('promptchamp-host-event',selected); else sessionStorage.removeItem('promptchamp-host-event');
  const current = events.find(e => e.id === selected);
  workspace.innerHTML = `<div class="host-layout"><section><div class="section-head"><h2>Your events</h2><button class="button" id="new">New event</button></div><div class="event-list">${events.length ? events.map(e => `<button class="event-item ${selected === e.id ? 'selected' : ''}" data-event="${e.id}"><span class="pill">${escape(e.status)} / ${escape(e.mode)}</span><strong>${escape(e.title)}</strong><small>${escape(new Date(e.scheduled_at).toLocaleString('en-MY',{timeZone:'Asia/Kuala_Lumpur'}))} MYT</small><small>${e.duration_seconds / 60} minutes per team</small></button>`).join('') : '<p class="form">Your first monthly event starts here. Create one to set the timer and reference image.</p>'}</div></section>
  <section class="form setup-panel">${current ? `<div class="section-head"><h2>${escape(current.title)}</h2><span class="pill">${escape(current.status)}</span></div><dl><dt>Event address</dt><dd>${escape(current.slug)}</dd><dt>Mode</dt><dd>${escape(current.mode)}</dd><dt>Team timer</dt><dd>${current.duration_seconds / 60} minutes</dd><dt>Expected teams</dt><dd>${current.team_capacity}</dd><dt>Playing order</dt><dd>Lucky number, ascending</dd><dt>Reference</dt><dd>${current.reference_mode==='random_unique'?'Random unique image per team':'Same image for every team'}</dd></dl>
  ${current.reference_mode==='random_unique'?`<p class="notice">${current.reference_count} images in the random pool. Add images below; each team needs a different image before the draw locks.</p>`:current.has_reference ? `<img class="reference-preview" src="/api/admin/events/${current.id}/reference?v=${Date.now()}" alt="Private reference image for this event">` : '<p class="notice">Add the reference image before marking this event ready.</p>'}
  ${current.status === 'draft' ? `<details><summary>Edit event settings</summary><form id="edit"><label>Event title<input name="title" value="${escape(current.title)}" minlength="3" maxlength="100" required></label><label>Event date and time (${escape(activeWorkspace.timezone)})<input type="datetime-local" name="scheduledAt" value="${formatLocalInput(current.scheduled_at,activeWorkspace.timezone)}" required></label>${modeFields(current.mode)}${referenceFields(current.reference_mode)}<label>Time per team<select name="durationSeconds"><option value="120" ${current.duration_seconds===120?'selected':''}>2 minutes</option><option value="180" ${current.duration_seconds===180?'selected':''}>3 minutes</option></select></label><label>Expected teams / lucky numbers<input name="teamCapacity" type="number" value="${current.team_capacity}" min="1" max="100" required></label><details><summary>Advanced: AI safety limit</summary><label>Maximum image requests<input name="generationCap" type="number" value="${current.generation_cap}" min="1" max="10000" required></label><p>A safety ceiling for API usage, including technical retries.</p></details><button class="button">Save settings</button></form></details>${current.reference_mode==='random_unique'?'':`<form id="upload"><label>Reference image<input name="image" type="file" accept="image/png,image/jpeg,image/webp" required></label><small>PNG, JPEG, or WebP. Maximum 2 MiB. Visible only to hosts during setup.</small><button class="button">Save reference image</button></form>`}<button id="ready" class="button" ${(current.reference_mode==='random_unique'?current.reference_count>0:current.has_reference) ? '' : 'disabled'}>Open team registration</button>` : `<p class="notice">${current.status==='registration'?'Registration is open. Teams can join and choose a number below.':'The draw is locked. Call teams using the queue controls below.'}</p>${current.status==='registration'?'<button id="draft" class="button">Return to draft (only before teams join)</button>':''}`}` : `<h2>Create an event</h2><p>One image. One prompt. A room full of ideas.</p><form id="create">${modeFields(activeWorkspace.default_mode)}${referenceFields('shared')}<label>Event title<input name="title" minlength="3" maxlength="100" placeholder="IT Connect - December Prompt Challenge" required></label><label>Event address<input name="slug" minlength="3" maxlength="100" pattern="[a-z0-9-]+" placeholder="it-connect-december" required></label><label>Event date and time (${escape(activeWorkspace.timezone)})<input type="datetime-local" name="scheduledAt" required></label><div class="host-fields"><label>Time per team<select name="durationSeconds"><option value="120" ${activeWorkspace.default_duration===120?'selected':''}>2 minutes</option><option value="180" ${activeWorkspace.default_duration===180?'selected':''}>3 minutes</option></select></label><label>Expected teams / lucky numbers<input type="number" name="teamCapacity" min="1" max="100" value="20" required></label></div><details><summary>Advanced: AI safety limit</summary><label>Maximum image requests<input type="number" name="generationCap" min="1" max="10000" value="${Math.max(1,activeWorkspace.monthly_generation_limit)}" required></label><p>Limits total AI image requests, including technical retries.</p></details><div></div><p>Lucky numbers determine the queue. Each called team starts its own timer. Random-image assignments are hidden until the turn starts.</p><button class="button">Create draft event</button></form>`}</section></div>`;
  if(current) {attachReferences(workspace,current,load);attachQueue(workspace,current);attachResults(workspace,current);}
  if(current?.status==='draft'&&!legacyContext&&current.reference_mode!=='random_unique'){const reuse=document.createElement('form');reuse.className='form';reuse.innerHTML='<h2>Reuse a workspace reference</h2><label>Reference image<select name="referenceId" required><option value="">Loading library...</option></select></label><button class="button" disabled>Use selected reference</button>';workspace.append(reuse);
    void fetch('/api/account/library').then(async response=>{if(!response.ok)throw new Error('Library unavailable');return response.json();}).then(data=>{if(!reuse.isConnected)return;const references=data.references.filter((r:any)=>r.event_id!==current.id);reuse.querySelector('select')!.innerHTML='<option value="">'+(references.length?'Choose a reference':'No other references yet')+'</option>'+references.map((r:any)=>`<option value="${r.id}">${escape(r.title)}</option>`).join('');reuse.querySelector('button')!.disabled=!references.length;}).catch(()=>{if(reuse.isConnected)reuse.querySelector('select')!.innerHTML='<option value="">Library unavailable</option>';});
    reuse.onsubmit=event=>{event.preventDefault();const referenceId=new FormData(reuse).get('referenceId');void action(async()=>{await api(`events/${current.id}/reference`,'PUT',{referenceId});await load();feedback.textContent='Reference copied from your workspace library.';});};}
  if(current){const panel=document.createElement('section');panel.className='form';panel.innerHTML=`<div class="section-head"><h2>Event actions</h2><a href="/api/admin/events/${current.id}/export">Export results CSV</a></div><p>Copy the setup for another event without copying teams, sessions, or results.</p><button id="duplicate-event" class="button">Duplicate event</button>${['draft','completed'].includes(current.status)?'<button id="archive-event">Archive event</button>':''}`;workspace.append(panel);
    panel.querySelector('#duplicate-event')!.addEventListener('click',()=>void action(async()=>{const result=await api(`events/${current.id}/duplicate`,'POST',{});selected=result.event.id;await load();}));panel.querySelector('#archive-event')?.addEventListener('click',()=>void action(async()=>{await api(`events/${current.id}/archive`,'POST',{});selected=null;await load();}));}
  workspace.querySelector('#new')!.addEventListener('click', () => { selected = null; render(); });
  workspace.querySelectorAll<HTMLButtonElement>('[data-event]').forEach(b => b.onclick = () => { selected = b.dataset.event!; render(); });
  workspace.querySelector<HTMLFormElement>('#create')?.addEventListener('submit', event => {
    event.preventDefault();
    const values = new FormData(event.currentTarget as HTMLFormElement);
    void action(async () => {
      const { event: created } = await api('events','POST',{ title:values.get('title'),mode:values.get('mode'),referenceMode:values.get('referenceMode'),slug:values.get('slug'),scheduledAt:zonedInstant(String(values.get('scheduledAt')),activeWorkspace.timezone),durationSeconds:Number(values.get('durationSeconds')),generationCap:Number(values.get('generationCap')),teamCapacity:Number(values.get('teamCapacity')) });
      selected = created.id; await load(); feedback.textContent = 'Draft event saved. Add its reference image next.';
    });
  });
  workspace.querySelector<HTMLFormElement>('#upload')?.addEventListener('submit', event => {
    event.preventDefault();
    const file = new FormData(event.currentTarget as HTMLFormElement).get('image') as File;
    void action(async () => {
      if (!file?.size || file.size > 2*1024*1024) throw new Error('Choose an image under 2 MiB.');
      const data = await new Promise<string>((resolve,reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(',')[1]); reader.onerror = reject; reader.readAsDataURL(file); });
      await api(`events/${current!.id}/reference`,'PUT',{ mimeType:file.type,data }); await load(); feedback.textContent = 'Reference image saved privately.';
    });
  });
  workspace.querySelector<HTMLFormElement>('#edit')?.addEventListener('submit', event => {
    event.preventDefault();
    const values = new FormData(event.currentTarget as HTMLFormElement);
    void action(async () => {
      await api(`events/${current!.id}`,'PATCH',{title:values.get('title'),mode:values.get('mode'),referenceMode:values.get('referenceMode'),scheduledAt:zonedInstant(String(values.get('scheduledAt')),activeWorkspace.timezone),durationSeconds:Number(values.get('durationSeconds')),generationCap:Number(values.get('generationCap')),teamCapacity:Number(values.get('teamCapacity'))});
      await load(); feedback.textContent = 'Settings saved.';
    });
  });
  for (const [button,status] of [['ready','registration'],['draft','draft']]) {
    workspace.querySelector('#'+button)?.addEventListener('click', () => void action(async () => { await api(`events/${current!.id}`,'PATCH',{status}); await load(); feedback.textContent = 'Event status updated.'; }));
  }
}
function modeFields(mode:string){if(!activeWorkspace.live_enabled)mode='demo';return '<fieldset class="mode-options"><legend>Event mode</legend><label><input type="radio" name="mode" value="demo" '+(mode==='demo'?'checked':'')+'> Demo - sample images and simulated scores</label><label><input type="radio" name="mode" value="live" '+(mode==='live'?'checked':'')+' '+(!activeWorkspace.live_enabled?'disabled':'')+'> Live - real AI generation and judging</label>'+(!activeWorkspace.live_enabled?'<small>Live access needs platform approval.</small>':'')+'</fieldset>';}
async function mountEvents(target:HTMLElement){workspace=target;await load();}
function mountLegacy(target:HTMLElement){workspace=target;signIn();}
initAccounts({mountEvents,mountLegacy});

function referenceFields(mode:string){return `<label>Reference images<select name="referenceMode"><option value="shared" ${mode==='shared'?'selected':''}>Shared image — same for every team</option><option value="random_unique" ${mode==='random_unique'?'selected':''}>Random unique — different for each team</option></select></label>`;}
