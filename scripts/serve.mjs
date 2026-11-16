import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export function serve() {
  const root = fileURLToPath(new URL('../dist/', import.meta.url));
  const types = { '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.css':'text/css; charset=utf-8', '.json':'application/json; charset=utf-8', '.png':'image/png', '.svg':'image/svg+xml' };
  const server = createServer(async (req, res) => {
    try {
      const parsed = new URL(req.url, 'http://localhost');
      const target = path.resolve(root, `.${decodeURIComponent(parsed.pathname === '/' ? '/index.html' : parsed.pathname)}`);
      if (!target.startsWith(root) || !(await stat(target)).isFile()) throw new Error('Not found');
      res.writeHead(200, { 'Content-Type': types[path.extname(target)] || 'application/octet-stream', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
      res.end(await readFile(target));
    } catch { res.writeHead(404); res.end('Not found'); }
  });
  server.listen(Number(process.env.PORT) || 4173, '127.0.0.1', () => console.log(`Local: http://127.0.0.1:${server.address().port}`));
  return server;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) serve();
