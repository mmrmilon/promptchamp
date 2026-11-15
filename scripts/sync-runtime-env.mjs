import {pathToFileURL} from 'node:url';

// Only this allowlist can cross from GitHub Actions into the production runtime.
export function runtimeSettings(env) {
  const required = ['PRODUCTION_DATABASE_URL','SESSION_SECRET','CLOUDFLARE_ACCOUNT_ID','CLOUDFLARE_API_TOKEN','GEMINI_JUDGE_API_KEY','SUPABASE_URL','SUPABASE_PUBLISHABLE_KEY','PLATFORM_OWNER_EMAIL'];
  const missing = required.filter(key => !env[key]?.trim());
  if (missing.length) throw new Error(`Missing GitHub production secrets: ${missing.join(', ')}. No runtime settings changed.`);
  if (env.SESSION_SECRET.length < 32) throw new Error('SESSION_SECRET must contain at least 32 characters. No runtime settings changed.');
  if (env.ADMIN_ACCESS_KEY && env.ADMIN_ACCESS_KEY.length < 32) throw new Error('ADMIN_ACCESS_KEY must contain at least 32 characters when supplied.');
  try {
    if (!['postgres:','postgresql:'].includes(new URL(env.PRODUCTION_DATABASE_URL).protocol)) throw 0;
    if (new URL(env.SUPABASE_URL).protocol !== 'https:') throw 0;
    if (env.PUBLIC_APP_URL && new URL(env.PUBLIC_APP_URL).protocol !== 'https:') throw 0;
  } catch { throw new Error('Database or application/provider URL is invalid. No runtime settings changed.'); }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(env.PLATFORM_OWNER_EMAIL)) throw new Error('PLATFORM_OWNER_EMAIL must be an email address.');
  const appMode = env.APP_MODE || 'demo';
  if (!['demo','live'].includes(appMode)) throw new Error('APP_MODE must be demo or live.');
  const allowLegacy = env.ALLOW_LEGACY_HOST_LOGIN || (env.ADMIN_ACCESS_KEY ? 'true' : 'false');
  if (!['true','false'].includes(allowLegacy)) throw new Error('ALLOW_LEGACY_HOST_LOGIN must be true or false.');
  return {
    DATABASE_URL: env.PRODUCTION_DATABASE_URL,
    ...Object.fromEntries(required.slice(1).map(key => [key, env[key]])),
    ADMIN_ACCESS_KEY: env.ADMIN_ACCESS_KEY || null,
    PUBLIC_APP_URL: env.PUBLIC_APP_URL || null,
    APP_MODE: appMode,
    ALLOW_LEGACY_HOST_LOGIN: allowLegacy,
  };
}

export async function syncRuntime(env, request = fetch, log = console.log) {
  // Validate everything before the first write; never fall back to stale Netlify values.
  const settings = runtimeSettings(env);
  if (!env.NETLIFY_AUTH_TOKEN || !env.NETLIFY_SITE_ID) throw new Error('NETLIFY_AUTH_TOKEN and NETLIFY_SITE_ID are required.');
  async function api(path, method = 'GET', body) {
    let response;
    try {
      response = await request('https://api.netlify.com/api/v1' + path, {
        method, headers: {Authorization: `Bearer ${env.NETLIFY_AUTH_TOKEN}`, 'Content-Type': 'application/json'},
        body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(30_000),
      });
    } catch { throw new Error(`Runtime settings API request failed (${method}). Retry the workflow.`); }
    // Provider error bodies may echo credentials. Never log or propagate them.
    if (!response.ok) throw new Error(`Runtime settings API returned HTTP ${response.status} (${method}). Check token permissions and Functions scope support.`);
    return response.status === 204 ? null : response.json();
  }
  const site = await api(`/sites/${encodeURIComponent(env.NETLIFY_SITE_ID)}`);
  if (!site.account_id) throw new Error('The deployment site has no account ID.');
  const base = `/accounts/${encodeURIComponent(site.account_id)}/env`;
  const query = `?site_id=${encodeURIComponent(env.NETLIFY_SITE_ID)}`;
  const existing = new Set((await api(base + query)).map(item => item.key));
  for (const [key, value] of Object.entries(settings)) {
    if (value === null) {
      if (existing.has(key)) await api(`${base}/${key}${query}`, 'DELETE');
      log(`Runtime setting ${key}: cleared or absent.`);
      continue;
    }
    const variable = {key, scopes: ['functions'], is_secret: true, values: [{context: 'production', value}]};
    if (existing.has(key)) await api(`${base}/${key}${query}`, 'PUT', variable);
    else await api(base + query, 'POST', [variable]);
    log(`Runtime setting ${key}: synchronized.`);
  }
  log('Production runtime settings synchronized. Values were not logged. Deployment must follow.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  syncRuntime(process.env).catch(error => { console.error(error.message); process.exitCode = 1; });
}
