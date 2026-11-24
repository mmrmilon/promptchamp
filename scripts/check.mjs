import {build} from 'esbuild';
import {readdir,access} from 'node:fs/promises';
const directory='netlify/functions';
const entryPoints=(await readdir(directory)).filter(name=>name.endsWith('.ts')).map(name=>directory+'/'+name);
await build({entryPoints,outdir:'.netlify/ci/functions',bundle:true,platform:'node',format:'esm',packages:'external'});
for(const name of ['index','admin','event','leaderboard','demo','share','present'])await access('dist/'+name+'.html');
console.log('PASS: application pages and all API, background, and scheduled functions compile.');
