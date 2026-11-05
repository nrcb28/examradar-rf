import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { ExamSession } from '../src/core/surveillance/exam-session.js';
import { generateIncidentAuditReport, REPORT_LIMITS } from '../src/core/surveillance/incident-logger.js';
import { readIncidentReport } from '../src/report-file.js';
import { runReportVerification } from '../src/verify-report.js';

test('report file: verifies exported UTF-8/BOM reports and reports tampering through CLI exit codes', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'examradar-report-'));
  t.after(async () => {
    assert.ok(directory.startsWith(path.join(tmpdir(), 'examradar-report-')));
    await rm(directory, { recursive: true, force: true });
  });
  const session = new ExamSession();
  session.startExam();
  session.ingestDevice({ id: 'AA:11:22', name: 'Nano-Ear', rssi: -50 });
  const report = await generateIncidentAuditReport(session, { redactIdentifiers: true });
  const filename = path.join(directory, 'report.json');
  await writeFile(filename, '\uFEFF' + JSON.stringify(report, null, 2));
  assert.deepEqual(await readIncidentReport(filename), report);
  const output = { log() {}, error() {} };
  assert.equal(await runReportVerification([filename], output), 0);
  const cli = fileURLToPath(new URL('../src/verify-report.js', import.meta.url));
  const result = await promisify(execFile)(process.execPath, [cli, filename]);
  assert.match(result.stdout, /VALID:/);
  report.sessionMetadata.examName = 'changed';
  await writeFile(filename, JSON.stringify(report));
  assert.equal(await runReportVerification([filename], output), 1);
  await assert.rejects(promisify(execFile)(process.execPath, [cli, filename]), error => error.code === 1);
  await writeFile(filename, '{}');
  assert.equal(await runReportVerification([filename], output), 1);
  assert.equal(await runReportVerification([], output), 2);
  assert.equal(await runReportVerification(['--help'], output), 0);
});

test('report file: rejects malformed, oversized, missing, directory and non-UTF-8 inputs', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'examradar-report-'));
  t.after(async () => {
    assert.ok(directory.startsWith(path.join(tmpdir(), 'examradar-report-')));
    await rm(directory, { recursive: true, force: true });
  });
  const filename = path.join(directory, 'invalid.json');
  const output = { log() {}, error() {} };
  for (const data of ['{', Buffer.from([0xff, 0xfe]), Buffer.alloc(REPORT_LIMITS.maxBytes + 1)]) {
    await writeFile(filename, data);
    await assert.rejects(readIncidentReport(filename));
    assert.equal(await runReportVerification([filename], output), 2);
  }
  assert.equal(await runReportVerification([directory], output), 2);
  assert.equal(await runReportVerification([path.join(directory, 'missing.json')], output), 2);
});

test('report file: a POSIX FIFO is rejected without waiting for a writer', { skip: process.platform === 'win32', timeout: 5000 }, async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'examradar-report-'));
  t.after(async () => {
    assert.ok(directory.startsWith(path.join(tmpdir(), 'examradar-report-')));
    await rm(directory, { recursive: true, force: true });
  });
  const filename = path.join(directory, 'pipe.json');
  await promisify(execFile)('mkfifo', [filename]);
  // Run in a bounded child: a regression to blocking open must not hang the test runner.
  const cli = fileURLToPath(new URL('../src/verify-report.js', import.meta.url));
  await assert.rejects(
    promisify(execFile)(process.execPath, [cli, filename], { timeout: 2000 }),
    error => error.code === 2 && !error.killed,
  );
});
