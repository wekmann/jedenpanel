// Lokalny serwer testowy: npm install && ADMIN_PASSWORD=cokolwiek npm run dev  ->  http://localhost:3000/panel
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const types = { '.html': 'text/html; charset=utf-8', '.png': 'image/png', '.js': 'text/javascript', '.css': 'text/css' };

http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  if (u.pathname.startsWith('/api/')) {
    const file = path.join(root, 'api', u.pathname.slice(5) + '.js');
    if (!fs.existsSync(file) || path.basename(file).startsWith('_')) { res.statusCode = 404; return res.end(); }
    const chunks = []; for await (const c of req) chunks.push(c);
    const raw = Buffer.concat(chunks).toString();
    try { req.body = raw ? JSON.parse(raw) : {}; } catch { req.body = {}; }
    req.query = Object.fromEntries(u.searchParams);
    res.status = (c) => { res.statusCode = c; return res; };
    res.json = (o) => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(o)); };
    return (await import(pathToFileURL(file).href)).default(req, res);
  }
  let p = u.pathname === '/panel' ? '/panel.html' : u.pathname === '/overlay' ? '/overlay.html' : u.pathname;
  const f = path.join(root, 'public', path.normalize(p));
  if (!f.startsWith(path.join(root, 'public')) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.statusCode = 404; return res.end('404'); }
  res.setHeader('Content-Type', types[path.extname(f)] || 'application/octet-stream');
  fs.createReadStream(f).pipe(res);
}).listen(3000, () => console.log('http://localhost:3000/panel'));
