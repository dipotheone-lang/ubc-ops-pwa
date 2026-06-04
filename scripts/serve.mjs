/**
 * serve.mjs — zero-dependency static file server for local PWA testing.
 * Serves ./frontend on http://localhost:5173 with correct MIME types and
 * the headers a service worker / PWA needs. Usage: node scripts/serve.mjs
 */
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, extname, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'frontend');
const PORT = process.env.PORT || 5173;
const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon'
};

createServer(async (req, res) => {
  try {
    let path = decodeURIComponent(req.url.split('?')[0]);
    if (path === '/') path = '/index.html';
    const full = normalize(join(dir, path));
    if (!full.startsWith(dir)) { res.writeHead(403).end('Forbidden'); return; }
    const info = await stat(full).catch(() => null);
    const target = info && info.isFile() ? full : join(dir, 'index.html');
    const data = await readFile(target);
    res.writeHead(200, {
      'Content-Type': MIME[extname(target)] || 'application/octet-stream',
      'Service-Worker-Allowed': '/',
      'Cache-Control': 'no-cache'
    });
    res.end(data);
  } catch (e) {
    res.writeHead(500).end('Server error: ' + e.message);
  }
}).listen(PORT, () => console.log(`Serving frontend on http://localhost:${PORT}`));
