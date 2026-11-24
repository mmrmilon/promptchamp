import './style.css';
import './share.css';
import {registrationQR} from './registration-qr';
const slug=new URLSearchParams(location.search).get('event')??'';
const title=document.querySelector<HTMLElement>('#share-title')!,status=document.querySelector<HTMLElement>('#share-status')!,heading=document.querySelector<HTMLElement>('#share-heading')!;
const code=document.querySelector<HTMLElement>('#share-code')!,steps=document.querySelector<HTMLElement>('#share-steps')!,hint=document.querySelector<HTMLElement>('#share-hint')!,link=document.querySelector<HTMLAnchorElement>('#share-link')!;
let qr:Awaited<ReturnType<typeof registrationQR>>|undefined,loading=false;
async function refresh(){
 if(loading)return;loading=true;
 try{
  qr??=await registrationQR(slug,location.origin);
  const response=await fetch('/api/events/'+encodeURIComponent(slug),{cache:'no-store',signal:AbortSignal.timeout(10000)});
  const data=await response.json();if(!response.ok)throw new Error(data.error??'Event unavailable.');
  title.textContent=data.event.title;document.title=data.event.title+' | Join PromptChamp';
  const open=data.event.status==='registration';
  heading.innerHTML=open?'Scan. Join.<br>Get creative.':'Registration<br>is closed.';
  status.textContent=open?'Your next great prompt starts here. Join your team, then wait for the host to call your number.':'New teams can no longer register. Already joined? Open the team page to continue or recover your team.';
  code.hidden=!open;steps.hidden=!open;hint.hidden=!open;
  document.querySelector<HTMLImageElement>('#share-qr')!.src=qr.image;
  link.href=qr.link;link.textContent=open?qr.link:'Open your team page';link.hidden=false;
 }catch(error){title.textContent='Check the event link';heading.textContent='Registration unavailable';status.textContent=(error as Error).message;code.hidden=true;steps.hidden=true;hint.hidden=true;link.hidden=true;}
 finally{loading=false;}
}
const fullscreen=document.querySelector<HTMLButtonElement>('#share-fullscreen')!;
if(document.fullscreenEnabled){fullscreen.hidden=false;fullscreen.onclick=async()=>{try{if(document.fullscreenElement)await document.exitFullscreen();else await document.documentElement.requestFullscreen();}catch{status.textContent='Use your browser full-screen command, such as F11, to present this page.';}};document.addEventListener('fullscreenchange',()=>{fullscreen.textContent=document.fullscreenElement?'Exit full screen':'Full screen';});}
void refresh();
const timer=setInterval(()=>{if(!document.hidden)void refresh();},15000);
window.addEventListener('focus',()=>void refresh());
window.addEventListener('pagehide',()=>clearInterval(timer),{once:true});
window.addEventListener('pageshow',event=>{if(event.persisted)location.reload();});
