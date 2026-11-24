import { defineConfig } from 'vite';
import { resolve } from 'node:path';
const pageNames = new Set(['admin', 'event', 'leaderboard', 'demo', 'share']);
function pageRoutes(server: {middlewares: {use: Function}}) {
  server.middlewares.use((req: any, res: any, next: () => void) => {
    const url = new URL(req.url || '/', 'http://localhost');
    const legacy = url.pathname.match(/^\/(admin|event|leaderboard|demo|share)\.html$/);
    if (legacy || url.pathname === '/index.html') {
      res.writeHead(301, {Location: (legacy ? '/' + legacy[1] : '/') + url.search});
      res.end();
      return;
    }
    if (pageNames.has(url.pathname.slice(1))) req.url = url.pathname + '.html' + url.search;
    next();
  });
}
export default defineConfig({ appType: 'mpa', plugins: [{name: 'clean-page-routes', configureServer: pageRoutes, configurePreviewServer: pageRoutes}], build: { rollupOptions: { input: {
  main: resolve('index.html'), admin: resolve('admin.html'), event: resolve('event.html'), leaderboard:resolve('leaderboard.html'),demo:resolve('demo.html'),share:resolve('share.html'),
} } } });
