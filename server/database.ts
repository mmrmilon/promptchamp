import postgres from 'postgres';
import { neon } from '@neondatabase/serverless';

let connection: ReturnType<typeof postgres> | undefined;

export function database() {
  const url = process.env.DATABASE_URL!;
  if (new URL(url).hostname.endsWith('.neon.tech')) return neon(url);
  connection ??= postgres(url, {
    prepare: false,
    max: 1,
    ssl: 'require',
    connect_timeout: 10,
    idle_timeout: 20,
  });
  return connection;
}
