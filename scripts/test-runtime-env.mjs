import {test} from 'node:test';
import assert from 'node:assert/strict';
import {runtimeSettings, syncRuntime} from './sync-runtime-env.mjs';

const fixture = () => ({NETLIFY_AUTH_TOKEN:'private-deploy-token', NETLIFY_SITE_ID:'test-site',
  PRODUCTION_DATABASE_URL:'postgresql://user:private-password@db.example.test/app', SESSION_SECRET:'private-session-secret-00000000000000000000',
  CLOUDFLARE_ACCOUNT_ID:'account', CLOUDFLARE_API_TOKEN:'private-ai-token', GEMINI_JUDGE_API_KEY:'private-judge-token',
  SUPABASE_URL:'https://example.supabase.co', SUPABASE_PUBLISHABLE_KEY:'publishable-test', PLATFORM_OWNER_EMAIL:'owner@example.test'});

test('missing or invalid configuration makes no provider calls', async () => {
  for (const change of [{SUPABASE_URL:''},{SESSION_SECRET:'short'},{SUPABASE_URL:'http://example.test'},{APP_MODE:'invalid'}]) {
    let calls=0;
    await assert.rejects(syncRuntime({...fixture(),...change}, async()=>{calls++;}));
    assert.equal(calls,0);
  }
});

test('allowlisted settings use production Functions scope; existing settings update and absent optionals clear', async () => {
  const calls=[], logs=[];
  const env={...fixture(), UNRELATED_SECRET:'never-copy-this'};
  await syncRuntime(env, async(url,options)=>{
    calls.push({url,...options,body:options.body?JSON.parse(options.body):undefined});
    const payload=url.includes('/sites/')?{account_id:'test-account'}:options.method==='GET'?[{key:'DATABASE_URL'},{key:'ADMIN_ACCESS_KEY'},{key:'UNRELATED_SETTING'}]:{};
    return new Response(options.method==='DELETE'?null:JSON.stringify(payload),{status:options.method==='DELETE'?204:200});
  }, line=>logs.push(line));
  const writes=calls.filter(call=>['PUT','POST'].includes(call.method));
  assert.equal(writes.length,10);
  for (const call of writes) {
    const item=Array.isArray(call.body)?call.body[0]:call.body;
    assert.deepEqual(item.scopes,['functions']); assert.equal(item.is_secret,true);
    assert.deepEqual(item.values.map(v=>v.context),['production']);
    assert.ok(call.url.endsWith('?site_id=test-site'));
  }
  assert.equal(writes.find(call=>call.method==='PUT').body.values[0].value,env.PRODUCTION_DATABASE_URL);
  assert.equal(calls.filter(call=>call.method==='DELETE').length,1);
  assert.ok(calls.find(call=>call.method==='DELETE').url.includes('/ADMIN_ACCESS_KEY?'));
  assert.ok(!JSON.stringify(calls).includes('never-copy-this'));
  assert.ok(!logs.join('\n').includes('private-'));
  assert.equal(runtimeSettings(env).ALLOW_LEGACY_HOST_LOGIN,'false');
});

test('provider errors do not leak response bodies or continue to write', async () => {
  let calls=0;
  await assert.rejects(syncRuntime(fixture(),async()=>{calls++;return new Response('private-provider-response',{status:403});}),error=>{
    assert.match(error.message,/HTTP 403/); assert.ok(!error.message.includes('private-')); return true;
  });
  assert.equal(calls,1);
});
