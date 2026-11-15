import pg from 'pg';
import { databaseTls } from './database-tls.mjs';

// Dedicated clients keep transaction commands off the shared query pipeline.
// All interpolated values remain PostgreSQL parameters, including UUIDs and dates.
type Sql = ((parts: TemplateStringsArray, ...values: any[]) => Promise<any[]>) & {
  begin<T>(run: (tx: Sql) => Promise<T>): Promise<T>;
};
let sql: Sql | undefined;
function tagged(query: (text: string, values: any[]) => Promise<any>): Sql {
  return (async (parts: TemplateStringsArray, ...values: any[]) => {
    const text = parts.reduce((result,part,index) => result + (index ? '$'+index : '') + part,'');
    return (await query(text,values)).rows;
  }) as Sql;
}
export function eventDb(): Sql {
  if (sql) return sql;
  const url = new URL(process.env.DATABASE_URL!);
  for (const key of ['sslmode','sslcert','sslkey','sslrootcert']) url.searchParams.delete(key);
  const pool = new pg.Pool({ connectionString:url.href, ssl:databaseTls(url.href),
    max:3, idleTimeoutMillis:20_000, connectionTimeoutMillis:10_000, statement_timeout:15_000 });
  pool.on('error',error => console.error('Event database connection error:',error.name));
  sql = tagged((text,values) => pool.query(text,values));
  sql.begin = async run => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await run(tagged((text,values) => client.query(text,values)));
      await client.query('COMMIT');
      return result;
    } catch(error) {
      await client.query('ROLLBACK');
      throw error;
    } finally { client.release(); }
  };
  return sql;
}
