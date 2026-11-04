import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { mkdtemp, mkdir, writeFile, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createStaticServer } from '../src/server.js';

function request(server, target, { method = 'GET', host = 'localhost' } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port: server.address().port, path: target, method, headers: { Host: host }, agent: false }, res => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
      res.on('error', reject);
    });
    req.on('error', reject);
    req.end();
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
  await writeFile(path.join(directory, 'private/secret.js'), 'SECRET_LINK');
  await symlink(path.join(directory, 'private'), path.join(directory, 'public/escape'), 'junction');
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
    '/escape/secret.js', '/src/core', '/C:/Windows/win.ini',
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
