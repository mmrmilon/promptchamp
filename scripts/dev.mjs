import { createServer } from 'vite';
import { build } from 'esbuild';
import { existsSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

if (existsSync('.env')) process.loadEnvFile('.env');
process.env.APP_MODE ??= 'demo';

const { values } = parseArgs({ options: { host: { type: 'string' }, port: { type: 'string' }, strictPort: { type: 'boolean' } } });
const output = resolve('.netlify/local/competition.mjs');
await build({ entryPoints: ['netlify/functions/competition.ts'], outfile: output,
  bundle: true, platform: 'node', format: 'esm', packages: 'external' });
const { default: handler, startWorker } = await import(pathToFileURL(output).href);
const stopWorker=startWorker();
process.on('SIGINT',()=>{stopWorker();process.exit(0);});
process.on('SIGTERM',()=>{stopWorker();process.exit(0);});

const server = await createServer({
  server: { host: values.host, port: values.port ? Number(values.port) : undefined, strictPort: values.strictPort },
  plugins: [{
    name: 'local-netlify-function',
    configureServer(vite) {
      vite.middlewares.use(async (req, res, next) => {
        if (!req.url?.startsWith('/api/')) return next();
        try {
          const chunks = [];
          for await (const chunk of req) chunks.push(chunk);
          const body = chunks.length ? Buffer.concat(chunks) : undefined;
          const response = await handler(new Request('http://' + req.headers.host + req.url,
            { method: req.method, headers: req.headers, body }));
          res.writeHead(response.status, Object.fromEntries(response.headers));
          res.end(Buffer.from(await response.arrayBuffer()));
        } catch (error) {
          console.error(error);
          res.writeHead(500).end('Local API error');
        }
      });
    },
  }],
});
await server.listen();
server.printUrls();
