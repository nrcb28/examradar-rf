import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

const PORT = process.env.PORT || 8080;

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  let reqPath = url.pathname;

  if (reqPath === '/' || reqPath === '/index.html') {
    reqPath = '/public/index.html';
  }

  let filePath = path.join(rootDir, reqPath);

  // If path doesn't exist, check inside public/
  if (!fs.existsSync(filePath)) {
    filePath = path.join(rootDir, 'public', reqPath);
  }

  if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': contentType });
    fs.createReadStream(filePath).pipe(res);
  } else {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('404 Not Found');
  }
});

server.listen(PORT, () => {
  console.log('\n📡 =========================================================');
  console.log(`      EXAMRADAR-RF • SERVIDOR DE VIGILANCIA ACTIVO         `);
  console.log('   =========================================================');
  console.log(`\n  Acceso Web / Móvil:  http://localhost:${PORT}`);
  console.log('  Estado:             Simulación de aula y radar listos');
  console.log('  Presione Ctrl+C para detener el servidor.\n');
});
