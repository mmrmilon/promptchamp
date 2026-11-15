import './style.css';
const escape=(s:unknown)=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
const slug=new URLSearchParams(location.search).get('event')??'';
async function load(){try{const response=await fetch('/api/events/'+encodeURIComponent(slug)+'/leaderboard');const data=await response.json();if(!response.ok)throw new Error(data.error);
 document.querySelector('#board-title')!.textContent=data.title;
 document.querySelector('#board')!.innerHTML=data.released?`<table><thead><tr><th>Rank</th><th>Team</th><th>Visual match</th></tr></thead><tbody>${data.rows.map((r:any)=>`<tr><td>${r.rank}</td><td>${escape(r.name)}</td><td><strong>${r.score}%</strong></td></tr>`).join('')}</tbody></table>`:'<h2>The reveal is coming.</h2><p>The host will publish results after every team has finished.</p>';
}catch(error:any){document.querySelector('#board')!.textContent=error.message;}}
void load();setInterval(()=>void load(),5000);
