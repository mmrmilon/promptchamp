import { readFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import postgres from 'postgres';
import {createHash} from 'node:crypto';
import {databaseTls} from '../server/database-tls.mjs';
if (existsSync('.env')) process.loadEnvFile('.env');
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
const sql = postgres(process.env.DATABASE_URL, { prepare: false, max: 1, ssl: databaseTls(), connect_timeout: 10, onnotice: () => {} });
try {
  const directory = new URL('../db/migrations/', import.meta.url);
  await sql.begin(async tx => {
    await tx`select pg_advisory_xact_lock(947462)`;
    await tx`create schema if not exists promptchamp`;
    await tx`create table if not exists promptchamp.schema_migrations (name text primary key,sha256 text not null,applied_at timestamptz not null default now())`;
    await tx`alter table promptchamp.schema_migrations enable row level security`;
    await tx`revoke all on schema promptchamp from public`;
    for (const file of (await readdir(directory)).filter(f => f.endsWith('.sql')).sort()) {
      const source=(await readFile(new URL(file,directory),'utf8')).replace(/\r\n/g,'\n');
      const checksum=createHash('sha256').update(source).digest('hex');
      const [existing]=await tx`select sha256 from promptchamp.schema_migrations where name=${file}`;
      if(existing){if(existing.sha256!==checksum)throw new Error('Applied migration changed: '+file);continue;}
      await tx.unsafe(source);
      await tx`insert into promptchamp.schema_migrations(name,sha256) values(${file},${checksum})`;
    }
  });
  console.log('PromptChamp migrations complete. Existing competition tables preserved.');
} catch (error) {
  console.error('Migration failed. Code:', error.code ?? error.name);
  process.exitCode = 1;
} finally { await sql.end({ timeout: 2 }); }
