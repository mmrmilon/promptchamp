import { readFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import postgres from 'postgres';
if (existsSync('.env')) process.loadEnvFile('.env');
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
const sql = postgres(process.env.DATABASE_URL, { prepare: false, max: 1, ssl: 'require', connect_timeout: 10, onnotice: () => {} });
try {
  const directory = new URL('../db/migrations/', import.meta.url);
  await sql.begin(async tx => {
    await tx`select pg_advisory_xact_lock(947462)`;
    for (const file of (await readdir(directory)).filter(f => f.endsWith('.sql')).sort()) {
      await tx.unsafe(await readFile(new URL(file, directory), 'utf8'));
    }
  });
  console.log('PromptChamp migrations complete. Existing competition tables preserved.');
} catch (error) {
  console.error('Migration failed. Code:', error.code ?? error.name);
  process.exitCode = 1;
} finally { await sql.end({ timeout: 2 }); }
