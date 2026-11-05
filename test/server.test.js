import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import { once } from 'node:events';
import { mkdtemp, mkdir, writeFile, symlink, rm, open } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createStaticServer } from '../src/server.js';

function request(server, target, { method = 'GET', host = 'localhost', headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port: server.address().port, path: target, method, headers: { Host: host, ...headers }, agent: false }, res => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
      res.on('error', reject);
    });
    req.on('error', reject);
    req.end(body);
  });
}

function rawRequest(server, headers) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: '127.0.0.1', port: server.address().port });
    let response = '';
    socket.setEncoding('utf8');
    socket.on('connect', () => socket.write(`GET / HTTP/1.1\r\n${headers}\r\nConnection: close\r\n\r\n`));
    socket.on('data', chunk => { response += chunk; });
    socket.on('end', () => resolve(response));
    socket.on('error', reject);
  });
}

test('server: restricts files, traversal, symlinks, methods and host headers; survives malformed requests', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'examradar-test-'));
  // A trusted configured root may itself have a symlink/junction ancestor.
  const server = createStaticServer({ directory: path.join(directory, 'mount') });
  t.after(async () => {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    assert.ok(directory.startsWith(path.join(tmpdir(), 'examradar-test-')));
    await rm(directory, { recursive: true, force: true });
  });
  await mkdir(path.join(directory, 'public'));
  await mkdir(path.join(directory, 'src/core'), { recursive: true });
  await mkdir(path.join(directory, '.git'));
  await mkdir(path.join(directory, 'private'));
  await writeFile(path.join(directory, 'public/index.html'), '<h1>Simulator</h1>');
  await writeFile(path.join(directory, 'public/app.js'), 'export const ready = true;');
  await writeFile(path.join(directory, 'src/core/device.js'), 'export const device = 1;');
  await writeFile(path.join(directory, 'src/server.js'), 'SECRET_SERVER');
  await writeFile(path.join(directory, 'package.json'), 'SECRET_PACKAGE');
  await writeFile(path.join(directory, '.git/config'), 'SECRET_GIT');
  await writeFile(path.join(directory, 'public/.env'), 'SECRET_ENV');
  await writeFile(path.join(directory, 'public/report.json'), 'SECRET_REPORT');
  await writeFile(path.join(directory, 'private/secret.js'), 'SECRET_LINK');
  await symlink(path.join(directory, 'private'), path.join(directory, 'public/escape'), 'junction');
  await symlink(path.join(directory, 'private'), path.join(directory, 'src/core/escape'), 'junction');
  await symlink(directory, path.join(directory, 'mount'), 'junction');
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');

  for (const target of ['/', '/index.html', '/app.js?version=1', '/src/core/device.js']) {
    const response = await request(server, target);
    assert.equal(response.status, 200, target);
    assert.equal(response.headers['x-content-type-options'], 'nosniff');
    assert.equal(response.headers['x-frame-options'], 'DENY');
    assert.ok(response.headers['content-security-policy'].includes("script-src 'self'"));
    assert.ok(!response.headers['content-security-policy'].includes("script-src 'self' 'unsafe-inline'"));
    assert.equal(response.headers['cache-control'], 'no-store');
  }
  const head = await request(server, '/', { method: 'HEAD' });
  assert.equal(head.status, 200);
  assert.equal(head.body, '');
  assert.equal(Number(head.headers['content-length']), Buffer.byteLength('<h1>Simulator</h1>'));

  for (const target of [
    '/.git/config', '/.env', '/package.json', '/src/server.js', '/missing.html',
    '/../package.json', '/%2e%2e/package.json', '/src/core/../../server.js',
    '/src/core/%2e%2e/%2e%2e/server.js', '/src/core/%2E%2E%2Fserver.js',
    '/escape/secret.js', '/src/core/escape/secret.js', '/src/core', '/C:/Windows/win.ini', '/report.json',
  ]) {
    const response = await request(server, target);
    assert.equal(response.status, 404, target);
    assert.ok(!response.body.includes('SECRET'), target);
  }
  for (const target of ['/%zz', '/%00', '/src%5ccore%5cdevice.js', '//evil.example/']) {
    assert.equal((await request(server, target)).status, 400, target);
  }
  const post = await request(server, '/', { method: 'POST' });
  assert.equal(post.status, 405);
  assert.equal(post.headers.allow, 'GET, HEAD');
  assert.equal((await request(server, '/', { host: 'evil.example' })).status, 403);
  assert.equal((await request(server, '/', { host: 'localhost@evil.example' })).status, 400);
  assert.equal((await request(server, '/', { headers: { 'Sec-Fetch-Site': 'cross-site' } })).status, 403);
  assert.equal((await request(server, '/', { headers: { Origin: 'https://evil.example' } })).status, 403);
  assert.equal((await request(server, '/', { headers: { Origin: 'http://localhost' } })).status, 200);
  assert.equal((await request(server, '/' + 'x'.repeat(2050))).status, 414);
  assert.equal((await request(server, '/', { headers: { 'Content-Length': '1' }, body: 'x' })).status, 413);
  assert.equal((await request(server, '/', { headers: { Expect: '100-continue' } })).status, 417);
  assert.equal((await request(server, '/', { headers: { 'X-Large': 'x'.repeat(9000) } })).status, 431);
  assert.equal((await request(server, '/', { headers: { Connection: 'Upgrade', Upgrade: 'websocket' } })).status, 426);
  await writeFile(path.join(directory, 'public/app.js'), 'x'.repeat(2 * 1024 * 1024 + 1));
  assert.equal((await request(server, '/app.js')).status, 413);
  assert.equal((await request(server, '/')).status, 200);
});

test('server: real entry point and browser modules load without Node-only imports', async t => {
  const server = createStaticServer();
  t.after(async () => {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const index = await request(server, '/');
  assert.match(index.body, /src="\/app\.js"/);
  assert.doesNotMatch(index.body, /\son\w+\s*=/i);
  assert.doesNotMatch(index.body, /\sstyle\s*=|<style/i);
  assert.ok(!index.headers['content-security-policy'].includes('unsafe-inline'));
  assert.equal((await request(server, '/styles.css')).status, 200);
  assert.equal((await request(server, '/favicon.svg')).status, 200);
  const visited = new Set();
  async function visit(url) {
    if (visited.has(url)) return;
    visited.add(url);
    const response = await request(server, url);
    assert.equal(response.status, 200, url);
    assert.match(response.headers['content-type'], /javascript/);
    for (const match of response.body.matchAll(/(?:from\s*|import\s*)['"]([^'"]+)['"]/g)) {
      assert.ok(!match[1].startsWith('node:'), `${url} must work in a browser`);
      const next = new URL(match[1], `http://localhost${url}`).pathname;
      await visit(next);
    }
  }
  await visit('/app.js');
  assert.ok(visited.has('/src/core/surveillance/incident-logger.js'));
});

test('server: raw duplicate or excessive headers cannot bypass authority and request checks', async t => {
  const server = createStaticServer();
  t.after(async () => {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  assert.match(await rawRequest(server, 'Host: localhost\r\nHost: evil.example'), /^HTTP\/1\.1 400 /);
  assert.match(await rawRequest(server, 'Host: localhost\r\nContent-Length: 0\r\nContent-Length: 0'), /^HTTP\/1\.1 400 /);
  const filler = Array.from({ length: 31 }, (_value, index) => `X-Pad-${index}: 0`).join('\r\n');
  assert.match(await rawRequest(server, `Host: localhost\r\n${filler}\r\nSec-Fetch-Site: cross-site`), /^HTTP\/1\.1 431 /);
  assert.equal((await request(server, '/')).status, 200);
});

test('server: aborted filesystem requests retain capacity until handles close and never create orphaned streams', { timeout: 10000 }, async t => {
  const server = createStaticServer();
  const probe = await open(new URL('../public/app.js', import.meta.url), 'r');
  const prototype = Object.getPrototypeOf(probe);
  await probe.close();
  const originalStat = prototype.stat;
  const originalStream = prototype.createReadStream;
  let resume;
  const gate = new Promise(resolve => { resume = resolve; });
  let reached;
  const allBlocked = new Promise(resolve => { reached = resolve; });
  let closed;
  const allClosed = new Promise(resolve => { closed = resolve; });
  const blockedFiles = new Set();
  const closedFiles = new Set();
  const createdStreams = [];
  const clients = [];
  const serverSockets = [];
  server.on('connection', socket => serverSockets.push(socket));
  t.mock.method(prototype, 'stat', async function(...args) {
    const stat = await originalStat.apply(this, args);
    if (blockedFiles.size < 64) {
      blockedFiles.add(this);
      // FileHandle.close is an own method, not a prototype method in Node 22+.
      const originalClose = this.close;
      this.close = async function(...closeArgs) {
        const result = await originalClose.apply(this, closeArgs);
        closedFiles.add(this);
        if (closedFiles.size === 64) closed();
        return result;
      };
      if (blockedFiles.size === 64) reached();
      await gate;
    }
    return stat;
  });
  t.mock.method(prototype, 'createReadStream', function(...args) {
    const stream = originalStream.apply(this, args);
    createdStreams.push(stream);
    return stream;
  });
  t.after(async () => {
    resume();
    for (const client of clients) client.destroy();
    for (const stream of createdStreams) stream.destroy();
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    await Promise.all([...blockedFiles].map(file => file.close().catch(() => {})));
    t.mock.restoreAll();
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  await Promise.all(Array.from({ length: 64 }, async () => {
    const client = net.createConnection({ host: '127.0.0.1', port: server.address().port });
    clients.push(client);
    await once(client, 'connect');
    client.write('GET /app.js HTTP/1.1\r\nHost: localhost\r\n\r\n');
  }));
  await allBlocked;
  const disconnected = Promise.all(serverSockets.map(socket => once(socket, 'close')));
  for (const client of clients) client.destroy();
  await disconnected;
  // Client disconnects must not free slots while their filesystem work is pending.
  assert.equal((await request(server, '/')).status, 503);
  resume();
  await allClosed;
  assert.equal(createdStreams.length, 0);
  assert.equal(closedFiles.size, 64);
  assert.equal((await request(server, '/')).status, 200);
});
