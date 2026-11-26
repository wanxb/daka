import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { siteAssets as assets } from './site-assets.mjs';

// Preview and static export share one allowlist; raw project paths are never exposed.
const site = new URL('../site/', import.meta.url);
const types = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.jpg': 'image/jpeg',
};
const server = createServer(async (request, response) => {
  if (!['GET', 'HEAD'].includes(request.method)) {
    response.writeHead(405, { Allow: 'GET, HEAD' });
    response.end();
    return;
  }
  const target = assets.get(new URL(request.url, 'http://127.0.0.1').pathname);
  if (!target) {
    response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end('页面不存在');
    return;
  }
  try {
    const body = await readFile(target);
    const extension = target.pathname.slice(target.pathname.lastIndexOf('.'));
    response.writeHead(200, {
      'Content-Type': types[extension] || 'application/octet-stream',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    });
    response.end(request.method === 'HEAD' ? undefined : body);
  } catch {
    // A missing public asset is reported honestly without leaking filesystem paths to the browser.
    response.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end('资源暂时无法读取');
  }
});
server.on('error', (error) => {
  console.error(`Website preview: ${error.message}`);
  process.exitCode = 1;
});
server.listen(8128, '127.0.0.1', () =>
  console.log(`SITE_READY http://127.0.0.1:8128/ (${fileURLToPath(site)})`),
);
process.once('SIGINT', () => server.close());
process.once('SIGTERM', () => server.close());
