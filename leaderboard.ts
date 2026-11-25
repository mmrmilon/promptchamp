import './style.css';
import './leaderboard.css';

type Row={rank:number;name:string;score:number;imageUrl:string|null};
const escape=(s:unknown)=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
const slug=new URLSearchParams(location.search).get('event')??'';
const board=document.querySelector<HTMLElement>('#board')!;
const status=document.querySelector<HTMLElement>('#board-status')!;
const viewer=document.querySelector<HTMLDialogElement>('#image-viewer')!;
const viewerImage=viewer.querySelector<HTMLImageElement>('img')!;
const viewerTitle=viewer.querySelector<HTMLElement>('#viewer-title')!;
const viewerScore=viewer.querySelector<HTMLElement>('#viewer-score')!;
const previous=viewer.querySelector<HTMLButtonElement>('#previous-image')!;
const next=viewer.querySelector<HTMLButtonElement>('#next-image')!;
const fullScreen=document.querySelector<HTMLButtonElement>('#fullscreen')!;
let rows:Row[]=[],selected=0,signature='',demo=false;
const imageRows=()=>rows.filter(row=>row.imageUrl);

function showImage(index:number){
  const images=imageRows(),row=images[index];if(!row)return;
  selected=index;viewerTitle.textContent=row.name;
  viewerScore.textContent=`Rank ${row.rank} · ${row.score}% match${demo?' · Demo sample':''}`;
  viewerImage.src=row.imageUrl!;viewerImage.alt=`${demo?'Demo sample':'AI-generated image'} for ${row.name}`;
  viewer.querySelector<HTMLElement>('#viewer-position')!.textContent=`${index+1} of ${images.length}`;
  previous.disabled=index===0;next.disabled=index===images.length-1;
  if(!viewer.open)viewer.showModal();
}
function clearImages(){if(viewer.open)viewer.close();viewerImage.removeAttribute('src');rows=[];signature='';}
board.addEventListener('click',event=>{const button=(event.target as HTMLElement).closest<HTMLButtonElement>('[data-image]');if(button)showImage(Number(button.dataset.image));});
viewer.querySelector('#close-viewer')!.addEventListener('click',()=>viewer.close());
viewer.addEventListener('close',()=>viewerImage.removeAttribute('src'));
previous.addEventListener('click',()=>showImage(selected-1));next.addEventListener('click',()=>showImage(selected+1));
viewer.addEventListener('keydown',event=>{if(event.key==='ArrowLeft'||event.key==='ArrowRight'){event.preventDefault();showImage(selected+(event.key==='ArrowLeft'?-1:1));}});
viewerImage.addEventListener('error',()=>{viewer.querySelector<HTMLElement>('#viewer-position')!.textContent='Image unavailable. Close and try again.';});
fullScreen.hidden=!document.fullscreenEnabled;
fullScreen.addEventListener('click',()=>void(async()=>{try{if(document.fullscreenElement)await document.exitFullscreen();else await document.documentElement.requestFullscreen();}catch{status.textContent='Full screen is unavailable. Use F11 on the presentation computer.';}})());
document.addEventListener('fullscreenchange',()=>{fullScreen.textContent=document.fullscreenElement?'Exit full screen':'Full screen';});

async function load(){
  try{
    const response=await fetch('/api/events/'+encodeURIComponent(slug)+'/leaderboard',{signal:AbortSignal.timeout(15000)});
    const data=await response.json();
    if(!response.ok){if(response.status===404||response.status===403){clearImages();board.textContent='Results unavailable.';}throw new Error(data.error);}
    status.textContent='';demo=data.mode==='demo';
    document.querySelector('#board-title')!.textContent=data.title+(demo?' — DEMO':'');
    document.querySelector('#board-description')!.textContent=demo?'Demo samples and simulated scores. Equal scores share a rank.':'AI-generated images and visual match scores. Equal scores share a rank.';
    if(!data.released){clearImages();board.innerHTML='<div class="board-empty"><h2>The reveal is coming.</h2><p>The host will publish results after every team has finished.</p></div>';return;}
    const current=JSON.stringify(data.rows);if(signature===current)return;
    const openImage=viewer.open?imageRows()[selected]?.imageUrl:null;
    rows=data.rows;signature=current;
    let imageIndex=0;
    board.innerHTML=rows.length?`<div class="leaderboard-gallery">${rows.map(row=>`<article class="result-card"><header><span class="result-rank" aria-label="Rank ${row.rank}">${row.rank}</span><h2>${escape(row.name)}</h2><strong class="result-score">${row.score}<span>% match</span></strong></header>${row.imageUrl?`<button class="result-image" type="button" data-image="${imageIndex++}" aria-label="Enlarge ${escape(row.name)} image"><img src="${escape(row.imageUrl)}" alt="${demo?'Demo sample':'AI-generated image'} for ${escape(row.name)}" loading="lazy" decoding="async"><span>View on big screen</span></button>`:'<div class="result-no-image">No saved image available</div>'}<footer>${demo?'Demo sample · Simulated score':'AI-generated recreation'}</footer></article>`).join('')}</div>`:'<div class="board-empty"><h2>No scored entries.</h2><p>No teams received a final score for this event.</p></div>';
    board.querySelectorAll<HTMLImageElement>('img').forEach(img=>img.addEventListener('error',()=>{const button=img.closest('button')!;button.disabled=true;button.querySelector('span')!.textContent='Image unavailable';}));
    if(openImage){const index=imageRows().findIndex(row=>row.imageUrl===openImage);if(index<0)viewer.close();else showImage(index);}
  }catch(error:any){status.textContent=error.message??'Could not refresh results. Please try again.';}
  finally{setTimeout(()=>void load(),5000);}
}
void load();
