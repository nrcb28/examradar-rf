import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

test('build: produces a self-contained browser module graph without repository or Node-only files', async () => {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const script = path.join(root, 'scripts/build.mjs');
  await promisify(execFile)(process.execPath, [script], { cwd: root });
  const output = path.join(root, 'dist');
  const entries = await readdir(output, { recursive: true });
  for (const filename of ['index.html', 'app.js', 'styles.css', 'favicon.svg', 'src/index.js']) assert.ok(entries.includes(filename.replaceAll('/', path.sep)), filename);
  assert.ok(entries.every(entry => !/(?:^|[/\\])(?:server\.js|verify-report\.js|report-file\.js|package\.json|test|\.git)$/.test(entry)));
  const visited = new Set();
  async function visit(url) {
    if (visited.has(url)) return;
    visited.add(url);
    const source = await readFile(path.join(output, url.slice(1)), 'utf8');
    for (const match of source.matchAll(/(?:from\s*|import\s*)['"]([^'"]+)['"]/g)) {
      assert.ok(!match[1].startsWith('node:'), url);
      await visit(new URL(match[1], `https://example.test${url}`).pathname);
    }
  }
  await visit('/app.js');
  await visit('/src/index.js');
  assert.ok(visited.has('/src/core/surveillance/incident-logger.js'));
  const first = await readFile(path.join(output, 'app.js'));
  // A repeat build must replace only generated output and preserve the same assets.
  await promisify(execFile)(process.execPath, [script], { cwd: root });
  assert.deepEqual(await readFile(path.join(output, 'app.js')), first);
});
