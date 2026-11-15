import {spawn} from 'node:child_process';
import {existsSync} from 'node:fs';
import {setTimeout as delay} from 'node:timers/promises';
import {build} from 'esbuild';

// Never point the CI rehearsal harness at an office or production database.
const url=new URL(process.env.DATABASE_URL??'postgresql://localhost/invalid');
if(process.env.CI!=='true'||!['localhost','127.0.0.1'].includes(url.hostname)||url.pathname!=='/promptchamp_ci'||existsSync('.env')) {
  throw new Error('CI tests require CI=true, a loopback promptchamp_ci database, and no local .env file.');
}
const environment={...process.env,PROCESS_AI:'false',APP_MODE:'demo'};
const run=(file,args=[])=>new Promise((resolve,reject)=>{
 const child=spawn(process.execPath,[file,...args],{env:environment,stdio:'inherit'});
 child.on('error',reject);child.on('exit',(code,signal)=>code===0?resolve():reject(new Error(file+' failed: '+(code??signal))));
});
await run('scripts/migrate.mjs');
await run('scripts/migrate.mjs'); // A second deployment must not replay data migrations.
await build({entryPoints:['server/processing.ts'],outfile:'.netlify/local/processing-test.mjs',bundle:true,platform:'node',format:'esm',packages:'external'});
const server=spawn(process.execPath,['scripts/dev.mjs','--host','127.0.0.1','--port','5174','--strictPort'],{env:environment,stdio:'inherit'});
let serverError;
server.on('error',error=>{serverError=error;});
try{
 let ready=false;
 for(let count=0;count<60;count++){
  if(serverError)throw serverError;
  if(server.exitCode!==null)throw new Error('CI server exited before becoming ready.');
  try{if((await fetch('http://localhost:5174/admin.html',{signal:AbortSignal.timeout(1000)})).ok){ready=true;break;}}catch{}
  await delay(500);
 }
 if(!ready)throw new Error('CI server did not become ready.');
 for(const file of ['test-event-setup.mjs','test-team-gameplay.mjs','test-live-processing.mjs'])await run('scripts/'+file);
 console.log('PASS: isolated database, migration replay, host setup, timed gameplay, and mocked AI processing.');
}finally{server.kill('SIGTERM');}
