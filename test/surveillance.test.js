import test from 'node:test';
import assert from 'node:assert/strict';
import { ExamSession } from '../src/core/surveillance/exam-session.js';
import {
  generateIncidentAuditReport,
  generateHtmlIncidentCertificate,
} from '../src/core/surveillance/incident-logger.js';

test('surveillance: registers baseline devices during calibration and suppresses alerts', () => {
  const session = new ExamSession({ examName: 'Física I', classroom: 'Aula 3' });
  session.startCalibration();

  // Ingest teacher laptop
  session.ingestDevice({ id: 'DEV_TEACHER', name: 'MacBook Pro', rssi: -45 });
  assert.equal(session.baselineDeviceIds.has('BLE:DEV_TEACHER'), true);

  // Start exam
  session.startExam();
  assert.equal(session.state, 'SURVEILLANCE_ACTIVE');

  // Existing baseline device should not trigger new-device alerts
  const alerts = [];
  session.onAlert((a) => alerts.push(a));

  session.ingestDevice({ id: 'DEV_TEACHER', name: 'MacBook Pro', rssi: -45 });
  assert.equal(alerts.length, 0);
});

test('surveillance: triggers immediate anomaly alert when a new suspicious device appears during exam', () => {
  const session = new ExamSession({ examName: 'Química Orgánica', classroom: 'Aula 10' });
  session.startExam();

  const alerts = [];
  session.onAlert((a) => alerts.push(a));

  // Ingest spy device during active exam
  session.ingestDevice({
    id: 'SPY_DEV_01',
    name: 'Nano-Ear Pro',
    rssi: -52,
  });

  assert.equal(alerts.length >= 1, true);
  assert.equal(alerts[0].type, 'ANOMALY_NEW_SUSPECT_DEVICE');
  assert.equal(alerts[0].deviceName, 'Nano-Ear Pro');
});

test('incident-logger: produces SHA-256 report checksum and HTML certificate', async () => {
  const session = new ExamSession({ examName: 'Matemáticas', classroom: 'Aula Magna' });
  session.startExam();

  session.ingestDevice({
    id: 'SPY_DEV_99',
    name: 'VIP-Pro Pen',
    rssi: -49,
  });

  const audit = await generateIncidentAuditReport(session);

  assert.ok(audit.reportId.startsWith('AUDIT-'));
  assert.equal(audit.sessionMetadata.examName, 'Matemáticas');
  assert.equal(audit.threats.length, 1);
  assert.equal(audit.evidenceIntegrity.algorithm, 'SHA-256');
  assert.equal(audit.evidenceIntegrity.hash.length, 64); // Valid sha256 hex length

  const html = generateHtmlIncidentCertificate(audit);
  assert.ok(html.includes('INFORME DE OBSERVACIONES DE RADIOFRECUENCIA'));
  assert.ok(html.includes(audit.evidenceIntegrity.hash));
});
