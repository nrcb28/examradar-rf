import http from 'node:http';
import { open, realpath } from 'node:fs/promises';
import path from 'node:path';
import { isIP } from 'node:net';
import { fileURLToPath, pathToFileURL } from 'node:url';

const rootDir = fileURLToPath(new URL('../', import.meta.url));
const MAX_HEADERS = 32;
const PUBLIC_ASSETS = new Set(['index.html', 'app.js', 'styles.css', 'favicon.svg']);
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

const SECURITY_HEADERS = {
  'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; base-uri 'none'; object-src 'none'; frame-ancestors 'none'; form-action 'none'",
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Cache-Control': 'no-store',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
};

/** Serve only browser assets, never the repository root or server source. */
export function createStaticServer({ directory = rootDir, host = '127.0.0.1' } = {}) {
  const roots = {
    public: path.resolve(directory, 'public'),
    src: path.resolve(directory, 'src'),
  };
  const allowedHosts = new Set(['localhost', '127.0.0.1', '[::1]', host]);
  let activeRequests = 0;
  const server = http.createServer({ maxHeaderSize: 8192, connectionsCheckingInterval: 1000 }, async (req, res) => {
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) res.setHeader(name, value);
    const reply = (status, message) => {
      if (res.destroyed || res.writableEnded) return;
      res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end(req.method === 'HEAD' ? undefined : message);
    };

    let file;
    let counted = false;
    let handlerFinished = false;
    let responseFinished = false;
    let streamOpen = false;
    let released = false;
    const release = () => {
      if (counted && handlerFinished && responseFinished && !streamOpen && !released) {
        released = true;
        --activeRequests;
      }
    };
    const responseDone = () => { responseFinished = true; release(); };
    const cancelled = () => res.destroyed || req.aborted;
    try {
      if (activeRequests >= 64) {
        res.setHeader('Connection', 'close');
        res.setHeader('Retry-After', '1');
        return reply(503, '503 Service Unavailable');
      }
      ++activeRequests;
      counted = true;
      responseFinished = res.destroyed || res.writableFinished;
      res.once('finish', responseDone);
      res.once('close', responseDone);
      if (cancelled()) return;
      // maxHeadersCount truncates req.headers rather than rejecting the request.
      if (req.rawHeaders.length / 2 > MAX_HEADERS) return reply(431, '431 Request Header Fields Too Large');
      const authority = req.headers.host;
      if (req.rawHeaders.filter((_value, index) => index % 2 === 0 && req.rawHeaders[index].toLowerCase() === 'host').length !== 1) {
        return reply(400, '400 Bad Request');
      }
      if (!authority || !/^[a-zA-Z0-9.\-\[\]:]+$/.test(authority)) return reply(400, '400 Bad Request');
      const hostname = new URL(`http://${authority}`).hostname;
      const wildcard = host === '0.0.0.0' || host === '::';
      if (!allowedHosts.has(hostname) && !(wildcard && isIP(hostname.replace(/^\[|\]$/g, '')))) {
        return reply(403, '403 Forbidden');
      }
      if (req.headers['sec-fetch-site'] === 'cross-site') return reply(403, '403 Forbidden');
      if (req.headers.origin && req.headers.origin !== `http://${authority}` && req.headers.origin !== `https://${authority}`) {
        return reply(403, '403 Forbidden');
      }
      // Static routes never consume request bodies. Close instead of buffering them.
      if (req.headers['transfer-encoding'] || (req.headers['content-length'] && req.headers['content-length'] !== '0')) {
        res.setHeader('Connection', 'close');
        return reply(413, '413 Content Too Large');
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        res.setHeader('Allow', 'GET, HEAD');
        return reply(405, '405 Method Not Allowed');
      }
      // Decode the raw request target before URL normalization can hide traversal.
      if (req.url.length > 2048) return reply(414, '414 URI Too Long');
      if (!req.url.startsWith('/') || req.url.startsWith('//')) return reply(400, '400 Bad Request');
      const pathname = decodeURIComponent(req.url.split('?')[0]);
      if (/[\\\x00-\x1f\x7f]/.test(pathname)) return reply(400, '400 Bad Request');
      if (pathname.split('/').some(segment => segment.startsWith('.') || segment.includes(':'))) {
        return reply(404, '404 Not Found');
      }

      let base = roots.public;
      let relative = pathname === '/' ? 'index.html' : pathname.slice(1);
      if (pathname === '/src/index.js' || pathname.startsWith('/src/core/') || pathname.startsWith('/src/ui/')) {
        if (path.extname(pathname) !== '.js') return reply(404, '404 Not Found');
        base = roots.src;
        relative = pathname.slice('/src/'.length);
      } else if (!PUBLIC_ASSETS.has(relative)) {
        return reply(404, '404 Not Found');
      }
      const contentType = MIME_TYPES[path.extname(relative)];
      if (!contentType) return reply(404, '404 Not Found');
      const canonicalBase = await realpath(base);
      if (cancelled()) return;
      // Resolve trusted root aliases first (e.g. macOS /var -> /private/var).
      const candidate = path.resolve(canonicalBase, relative);
      const canonicalFile = await realpath(candidate);
      if (cancelled()) return;
      const contained = path.relative(canonicalBase, canonicalFile);
      if (!contained || contained.startsWith(`..${path.sep}`) || contained === '..' || path.isAbsolute(contained)) {
        return reply(404, '404 Not Found');
      }
      // Disallow symlink/junction aliases, including aliases to other repository files.
      const samePath = process.platform === 'win32'
        ? canonicalFile.toLowerCase() === candidate.toLowerCase()
        : canonicalFile === candidate;
      if (!samePath) return reply(404, '404 Not Found');
      file = await open(canonicalFile, 'r');
      if (cancelled()) return;
      const stat = await file.stat();
      if (cancelled()) return;
      if (!stat.isFile()) return reply(404, '404 Not Found');
      if (stat.size > 2 * 1024 * 1024) return reply(413, '413 Content Too Large');
      res.writeHead(200, { 'Content-Type': contentType, 'Content-Length': stat.size });
      if (req.method === 'HEAD' || stat.size === 0) return res.end();
      const stream = file.createReadStream({ start: 0, end: stat.size - 1 });
      streamOpen = true;
      file = undefined; // The stream now owns the checked handle.
      stream.once('close', () => { streamOpen = false; release(); });
      stream.on('error', () => res.destroy());
      res.on('close', () => stream.destroy());
      if (cancelled()) { stream.destroy(); return; }
      stream.pipe(res);
    } catch (error) {
      if (res.headersSent) res.destroy();
      else if (error instanceof URIError || error.code === 'ERR_INVALID_URL') reply(400, '400 Bad Request');
      else if (['ENOENT', 'ENOTDIR', 'EACCES', 'EPERM', 'EISDIR'].includes(error.code)) reply(404, '404 Not Found');
      else reply(500, '500 Internal Server Error');
    } finally {
      if (file) await file.close().catch(() => {});
      handlerFinished = true;
      release();
    }
  });
  server.requestTimeout = 15_000;
  server.headersTimeout = 10_000;
  server.keepAliveTimeout = 5_000;
  server.maxRequestsPerSocket = 100;
  server.maxHeadersCount = MAX_HEADERS;
  server.maxConnections = 128;
  server.setTimeout(15_000, socket => socket.destroy());
  server.on('checkContinue', (_req, res) => {
    res.writeHead(417, { Connection: 'close' });
    res.end();
  });
  server.on('upgrade', (_req, socket) => socket.end('HTTP/1.1 426 Upgrade Required\r\nConnection: close\r\nContent-Length: 0\r\n\r\n'));
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const port = Number(process.env.PORT ?? 8080);
  const host = process.env.HOST || '127.0.0.1';
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be an integer from 1 to 65535');
  const server = createStaticServer({ host });
  server.on('error', error => {
    console.error(`Cannot start server: ${error.message}`);
    process.exitCode = 1;
  });
  server.listen(port, host, () => {
    const address = host.includes(':') ? `[${host}]` : host;
    console.log(`ExamRadar-RF · SIMULACIÓN: http://${address}:${port}`);
  });
}
