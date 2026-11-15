import './style.css';
import { challenges, categories, weightedScore } from './server/challenges';

const root = document.querySelector<HTMLElement>('#app')!;
const modeLabel = document.querySelector<HTMLElement>('#mode')!;
type Challenge = typeof challenges[number];
type Attempt = {
  id: string; round: string; status: string; prompt?: string;
  score?: number; ratings?: number[]; tip?: string; data?: string; mimeType?: string;
};
type Player = { name: string; rounds: { round: string; best: number }[]; used: number; pending?: Attempt };
type Rank = { name: string; rank: number; total: number; isYou?: boolean };
let settings: { mode: string; start?: number; end?: number };
let player: Player | null = null;
let demo: { name: string; attempts: Attempt[] } | null = null;
const attempts = new Map<string,Attempt>();
const drafts = new Map<string,string>();
const requests = new Map<string,{ id: string; prompt: string }>();
let table = '';
let busy = false;

const escape = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, char =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);
const art = (id: string) => '/challenges/' + id + '.webp';
const post = (body: unknown) => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const roundBest = (id: string) => player?.rounds.find(r => r.round === id)?.best;
const inWindow = () => settings.mode === 'demo' || (Date.now() >= settings.start! && Date.now() < settings.end!);
const endText = () => settings.end ? new Intl.DateTimeFormat('en-MY', {
  dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kuala_Lumpur',
}).format(settings.end) + ' MYT' : '';

async function api(path: string, config?: RequestInit) {
  const response = await fetch('/api/' + path, config);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? 'Request failed.');
  return data;
}
function syncDemo() {
  localStorage.setItem('prompt-match-cup', JSON.stringify(demo));
  player = demo && {
    name: demo.name, used: demo.attempts.length,
    rounds: challenges.flatMap(({ id }) => {
      const scores = demo!.attempts.filter(a => a.round === id && a.score !== undefined).map(a => a.score!);
      return scores.length ? [{ round: id, best: Math.max(...scores) }] : [];
    }),
  };
}
async function loadPlayer() {
  if (settings.mode === 'demo') {
    syncDemo();
    return;
  }
  try { player = await api('me'); } catch (error) {
    if ((error as Error).message !== 'Join with an invite code to play.') throw error;
    player = null;
  }
}
function saveAttempt(attempt: Attempt) { attempts.set(attempt.round, attempt); }

function gallery() {
  const day = settings.start ? Math.max(0, Math.floor((Date.now() - settings.start) / 86400_000)) : 0;
  const feature = challenges[day % challenges.length];
  return `<section class="hero">
    <div><div class="eyebrow">Featured challenge</div><h1>Can you<br><em>recreate it?</em></h1>
    <p>Study the image, write a prompt, and see how closely your recreation matches. Three challenges. One wildcard retry.</p>
    <a class="button" href="#play/${feature.id}">Play ${feature.name} <span aria-hidden="true">↗</span></a>
    ${settings.end ? `<small>Competition closes ${escape(endText())}</small>` : ''}</div>
    <div class="hero-image"><img src="${art(feature.id)}" alt="${escape(feature.title)}"><span>${feature.name}</span></div>
  </section>
  <section><div class="section-head"><div><h2>All challenges</h2><p>Play the three images in any order.</p></div>
  <a href="#leaderboard">View rankings →</a></div>
  <div class="cards">${challenges.map(challenge => `<a class="card" href="#play/${challenge.id}">
    <img src="${art(challenge.id)}" alt=""><div class="card-body"><span class="pill">${challenge.difficulty}</span>
    <h3>${challenge.name}</h3><p>${challenge.title}</p><div class="card-bottom"><span>${roundBest(challenge.id) === undefined ? 'Play challenge' : 'Your best · ' + roundBest(challenge.id) + '%'}</span><span>↗</span></div></div></a>`).join('')}</div></section>`;
}
function scorePanel(attempt?: Attempt) {
  if (!attempt) return '';
  if (attempt.status === 'judge_failed') return '<p class="notice">Your recreation is ready. Scoring is temporarily unavailable.</p><button id="rescore" class="button" type="button">Retry scoring</button>';
  if (attempt.status === 'generation_failed') return '<p class="notice">Image generation failed. The reserved generation counts toward the limit.</p>';
  if (attempt.score === undefined) return '<p class="notice">Your attempt is processing. <button id="refresh" type="button">Refresh result</button></p>';
  return `<div class="score card-body"><div class="section-head"><div><h2>${settings.mode === 'demo' ? 'Simulated match' : 'Visual match'}</h2><p>${escape(attempt.tip)}</p></div><strong>${attempt.score}%</strong></div>
  <div class="metrics">${categories.map((category, index) => `<label>${category.label}<progress max="5" value="${attempt.ratings?.[index] ?? 0}"></progress><span>${attempt.ratings?.[index] ?? 0}/5</span></label>`).join('')}</div></div>`;
}
function play(challenge: Challenge) {
  const last = attempts.get(challenge.id);
  const best = roundBest(challenge.id);
  const pending = player?.pending;
  const mayPlay = player && inWindow() && player.used < 4 && !pending &&
    (best === undefined || player.rounds.length === 3);
  const dataUrl = last?.data && ['image/png','image/jpeg','image/webp'].includes(last.mimeType ?? '') ?
    'data:' + last.mimeType + ';base64,' + last.data : '';
  return `<a class="back" href="#gallery">← All challenges</a>
  <header class="play-head"><div><span class="pill">${challenge.difficulty}</span><h1>${challenge.name}</h1></div>
  <div class="progress-note">${best === undefined ? '' : '<strong>Best ' + best + '%</strong>'}
  ${player ? `<span>${4 - player.used} generations left</span>` : ''}</div></header>
  ${settings.mode === 'demo' ? '<p class="notice">Demo mode simulates scores and uses a sample image. Cloudflare, Gemini, and Neon stay offline.</p>' : ''}
  <div class="comparison">
    <figure><figcaption>Reference image</figcaption><img src="${art(challenge.id)}" alt="${escape(challenge.title)}"></figure>
    <figure><figcaption>${settings.mode === 'demo' ? 'Sample recreation' : 'Your recreation'}</figcaption>
    ${dataUrl ? `<img src="${escape(dataUrl)}" alt="Image generated from your prompt">` : last?.score !== undefined && settings.mode === 'demo' ?
      `<img class="demo-image" src="${art(challenge.id)}" alt="Sample image for the demo">` :
      '<div class="empty-image"><span aria-hidden="true">✦</span><p>Your recreation appears here after generation.</p></div>'}</figure>
  </div>
  ${!player ? `<form id="join" class="form"><h2>Join to play</h2><label>Display name<input name="name" required minlength="2" maxlength="28"></label>
    ${settings.mode === 'live' ? '<label>Invite code<input name="code" required maxlength="24" autocomplete="off"></label>' : ''}
    <button class="button" type="submit">Join competition</button></form>` :
    `<form id="attempt" class="form"><div class="section-head"><h2><label for="prompt">Your prompt</label></h2><small>${escape(player.name)}</small></div>
    <textarea id="prompt" name="prompt" minlength="5" maxlength="500" required placeholder="Describe the subject, composition, colors and lighting…">${escape(drafts.get(challenge.id) ?? last?.prompt ?? '')}</textarea>
    <div class="form-foot"><span>${!inWindow() ? 'Submissions are closed.' : player.used >= 4 ? 'You’ve used all your generations.' :
      pending && pending.round !== challenge.id ? `<a href="#play/${escape(pending.round)}">Finish your pending attempt →</a>` :
      pending ? 'Resolve the pending attempt below.' : best !== undefined && player.rounds.length < 3 ? 'Finish all three rounds to unlock your wildcard.' : best !== undefined ? 'This uses your wildcard.' : '5–500 characters'}</span>
    <button class="button" type="submit" ${mayPlay ? '' : 'disabled'}>Generate &amp; match ✦</button></div></form>`}
  <p id="status" role="status"></p>
  ${scorePanel(last)}`;
}
async function leader() {
  root.innerHTML = `<a class="back" href="#gallery">← All challenges</a><header class="play-head"><div><h1>Leaderboard</h1>
    <p>Best score per challenge. Finish all three to rank overall.</p></div></header>
    <label class="select-label">Rankings <select id="board-select"><option value="">Overall</option>${challenges.map(c =>
      `<option value="${c.id}" ${table === c.id ? 'selected' : ''}>${c.name}</option>`).join('')}</select></label>
    <div id="standings" class="form">Loading rankings…</div>`;
  const selected = table;
  const target = root.querySelector('#standings')!;
  root.querySelector('#board-select')!.addEventListener('change', event => {
    table = (event.target as HTMLSelectElement).value;
    void leader();
  });
  try {
    let rows: Rank[];
    if (settings.mode === 'demo') {
      const total = table ? roundBest(table) : player?.rounds.length === 3 ? player.rounds.reduce((sum, row) => sum + row.best, 0) : undefined;
      rows = total === undefined ? [] : [{ name: player!.name, total, rank: 1, isYou: true }];
    } else ({ rows } = await api('leaderboard' + (selected ? '?round=' + selected : '')));
    target.innerHTML = rows.length ? `<table><thead><tr><th>Rank</th><th>Player</th><th>Score</th></tr></thead><tbody>
      ${rows.map(r => `<tr><td>${r.rank}</td><td>${escape(r.name)}${r.isYou ? ' <span class="pill">You</span>' : ''}</td>
      <td>${r.total}${selected ? '%' : ' / 300'}</td></tr>`).join('')}</tbody></table>` :
      '<p>No ranked scores yet.</p>';
  } catch (error) { target.textContent = (error as Error).message; }
}
function report(message: string) {
  const status = root.querySelector('#status');
  if (status) status.textContent = message;
}
async function show() {
  const hash = location.hash.slice(1);
  if (hash === 'leaderboard') return leader();
  const challenge = hash.startsWith('play/') ? challenges.find(c => c.id === hash.slice(5)) : null;
  if (!challenge) {
    root.innerHTML = gallery();
    return;
  }
  if (player?.pending?.round === challenge.id && !attempts.has(challenge.id)) {
    try { saveAttempt(await api('attempts?id=' + player.pending.id)); } catch { saveAttempt(player.pending); }
    if (location.hash.slice(1) !== hash) return;
  }
  root.innerHTML = play(challenge);
  const promptInput = root.querySelector<HTMLTextAreaElement>('#prompt');
  promptInput?.addEventListener('input', () => drafts.set(challenge.id, promptInput.value));
  root.querySelector('#join')?.addEventListener('submit', async event => {
    event.preventDefault();
    if (busy) return;
    busy = true;
    try {
      const values = new FormData(event.currentTarget as HTMLFormElement);
      const name = String(values.get('name') ?? '').trim();
      if (name.length < 2) throw new Error('Enter at least two characters for your name.');
      if (settings.mode === 'demo') { demo = { name, attempts: [] }; syncDemo(); }
      else { await api('join', post({ name, code: values.get('code') })); await loadPlayer(); }
      await show();
    } catch (error) { report((error as Error).message); } finally { busy = false; }
  });
  root.querySelector('#attempt')?.addEventListener('submit', async event => {
    event.preventDefault();
    const prompt = promptInput!.value.trim();
    if (prompt.length < 5) { report('Enter at least five characters.'); return; }
    const prior = requests.get(challenge.id);
    const requestId = prior?.prompt === prompt ? prior.id : crypto.randomUUID();
    requests.set(challenge.id, { id: requestId, prompt });
    await action(async () => {
      if (settings.mode === 'live') return api('attempts', post({ requestId, challengeId: challenge.id, prompt }));
      const ratings = challenge.keywords.map(group => {
        const count = group.split('|').filter(word => new RegExp('\\b' + word + '\\b','i').test(prompt)).length;
        return Math.min(5, 1 + count * 2);
      });
      const weak = ratings.indexOf(Math.min(...ratings));
      const attempt = { id: requestId, round: challenge.id, status: 'scored', score: weightedScore(ratings),
        prompt, ratings, tip: 'Try describing this detail. ' + challenge.rubric[weak] };
      demo!.attempts.push(attempt);
      syncDemo();
      return attempt;
    });
  });
  const last = attempts.get(challenge.id);
  root.querySelector('#rescore')?.addEventListener('click', () => action(() => api('rescore', post({ requestId: last!.id }))));
  root.querySelector('#refresh')?.addEventListener('click', () => action(() => api('attempts?id=' + last!.id)));
}

async function action(run: () => Promise<Attempt>) {
  if (busy) return;
  busy = true;
  const buttons = [...root.querySelectorAll<HTMLButtonElement>('button')].filter(button => !button.disabled);
  buttons.forEach(button => button.disabled = true);
  report('Working on your attempt…');
  try {
    const attempt = await run();
    saveAttempt(attempt);
    requests.delete(attempt.round);
    await loadPlayer();
    await show();
  } catch (error) {
    report((error as Error).message);
  } finally {
    busy = false;
    buttons.forEach(button => button.disabled = false);
  }
}

try {
  settings = await api('config');
  modeLabel.hidden = settings.mode !== 'demo';
  if (settings.mode === 'demo') {
    try { demo = JSON.parse(localStorage.getItem('prompt-match-cup') ?? 'null'); } catch { demo = null; }
    demo?.attempts.forEach(saveAttempt);
  }
  await loadPlayer();
  window.addEventListener('hashchange', () => void show());
  await show();
} catch (error) { root.textContent = (error as Error).message; }
