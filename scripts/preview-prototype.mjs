import { createServer } from 'node:http';
import { readFile, watch } from 'node:fs';
import { fileURLToPath } from 'node:url';

// This loopback server exposes only reviewed prototype assets, never the project or personal WeChat data.
const root = fileURLToPath(new URL('../prototype/', import.meta.url));
const assets = new Map([
  ['/', 'index.html'],
  ['/index.html', 'index.html'],
  ['/board.html', 'board.html'],
  ['/app.js', 'app.js'],
  ['/appearance.js', 'appearance.js'],
  ['/styles.css', 'styles.css'],
  // Only the selected local particle engine is exposed; arbitrary project paths remain inaccessible.
  ['/confetti-review.js', 'confetti-review.js'],
  ['/vendor/tsparticles-confetti-4.6.0.min.js', 'vendor/tsparticles-confetti-4.6.0.min.js'],
]);
const clients = new Set();
const reload =
  '<script>const previewReload=new EventSource("/__reload");previewReload.onmessage=()=>location.reload();</script>';
const server = createServer((request, response) => {
  if (!['GET', 'HEAD'].includes(request.method)) {
    response.writeHead(405);
    response.end();
    return;
  }
  const path = new URL(request.url, 'http://127.0.0.1').pathname;
  if (path === '/__reload' && request.method === 'GET') {
    response.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });
    response.write(': preview connected\n\n');
    clients.add(response);
    request.on('close', () => clients.delete(response));
    return;
  }
  const asset = assets.get(path);
  if (!asset) {
    response.writeHead(404);
    response.end('Not found');
    return;
  }
  readFile(root + asset, 'utf8', (error, content) => {
    if (error) {
      response.writeHead(500);
      response.end('Unable to read prototype');
      return;
    }
    const html = asset.endsWith('.html');
    response.writeHead(200, {
      'Content-Type': html
        ? 'text/html; charset=utf-8'
        : asset.endsWith('.css')
          ? 'text/css; charset=utf-8'
          : 'text/javascript; charset=utf-8',
      'Cache-Control': 'no-store',
    });
    response.end(
      request.method === 'HEAD'
        ? undefined
        : html
          ? content.replace('</body>', reload + '</body>')
          : content,
    );
  });
});
// Reload only when the visual prototype changes; native WXML/WXSS is intentionally a separate runtime.
let debounce;
const watcher = watch(root, (_event, name) => {
  if (!name || !['index.html', 'board.html', 'app.js', 'styles.css'].includes(name.toString()))
    return;
  clearTimeout(debounce);
  debounce = setTimeout(() => {
    for (const response of clients) response.write('data: reload\n\n');
  }, 150);
});
server.on('error', (error) => {
  console.error('scripts/preview-prototype.mjs: ' + error.message);
  watcher.close();
  process.exitCode = 1;
});
console.log('Starting prototype preview');
server.listen(8127, '127.0.0.1', () =>
  console.log('PROTOTYPE_READY http://127.0.0.1:8127/index.html'),
);
function stop() {
  clearTimeout(debounce);
  watcher.close();
  for (const response of clients) response.end();
  server.close();
}
process.once('SIGINT', stop);
process.once('SIGTERM', stop);
