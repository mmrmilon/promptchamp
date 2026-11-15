import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';

export function databaseTls(connectionString=process.env.DATABASE_URL) {
  const url=new URL(connectionString);
  // GitHub's disposable PostgreSQL service has no TLS. This exception cannot
  // apply to a remote database, including production Supabase.
  if(process.env.CI==='true' && ['127.0.0.1','localhost','[::1]'].includes(url.hostname))return false;
  const provider=url.hostname.endsWith('.supabase.com')||url.hostname.endsWith('.supabase.co');
  return {rejectUnauthorized:true,...(provider?{ca:readFileSync(resolve('db/root-ca.pem'),'utf8')}:{})};
}
