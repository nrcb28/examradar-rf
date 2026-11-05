import { MockClassroom } from '/src/core/hardware/mock-classroom.js';
import { ExamSession, SESSION_STATES } from '/src/core/surveillance/exam-session.js';
import { GeigerEngine } from '/src/core/audio/geiger-synthesizer.js';
import { RadarRenderer } from '/src/ui/radar-canvas.js';
import { renderThreats } from '/src/ui/threat-list.js';
import { REPORT_LIMITS, generateIncidentAuditReport, generateHtmlIncidentCertificate, verifyIncidentAuditReport } from '/src/core/surveillance/incident-logger.js';

const byId = id => document.getElementById(id);
function message(text) { byId('app-status').textContent = text; byId('app-status').hidden = !text; }
let renderer;
try { renderer = new RadarRenderer(byId('radar')); }
catch { message('El radar gráfico no está disponible. Las observaciones siguen accesibles en la lista.'); }
const classroom = new MockClassroom();
const geiger = new GeigerEngine({ audioEnabled: false, hapticEnabled: false });
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
let session;
let posX = 2;
let posY = 3;
let paused = false;
let pageSuspended = false;
let scanInterval = null;
let calibrationRemaining = 0;
let calibrationDeadline = 0;
let reportSnapshot;
let snapshotVersion = 0;
let verifyVersion = 0;
const downloads = new Map();

function running() {
  return !paused && !pageSuspended && !document.hidden && session.state !== SESSION_STATES.COMPLETED;
}
function resetSnapshot(text = '') {
  reportSnapshot = undefined;
  ++snapshotVersion;
  byId('export-status').textContent = text;
}
function renderState() {
  const calibrating = session.state === SESSION_STATES.CALIBRATING;
  const complete = session.state === SESSION_STATES.COMPLETED;
  byId('status-badge').textContent = complete ? 'SIMULACIÓN · FINALIZADA' : paused ? 'SIMULACIÓN · PAUSADA' : calibrating ? 'SIMULACIÓN · CALIBRANDO' : 'SIMULACIÓN';
  byId('session-summary').textContent = `${session.totalDevicesScanned} dispositivos · ${session.totalBaselineDevices} en línea base · ${session.totalIncidentEvents} incidencias${calibrating ? ' · Calibración en curso' : ''}`;
  byId('btn-pause').textContent = paused ? 'Continuar' : 'Pausar';
  byId('btn-pause').disabled = complete;
  byId('btn-complete').disabled = complete || calibrating;
  for (const button of document.querySelectorAll('.btn-walk')) button.disabled = complete || paused;
}
function renderObservations(threats) {
  renderer?.setDevices(threats);
  if (reducedMotion.matches || !running()) renderer?.draw();
  renderThreats(byId('threats-list'), threats);
  const nearest = threats[0];
  byId('geiger-rssi').textContent = nearest ? `${nearest.rssiFiltered} dBm` : '— dBm';
  byId('geiger-distance').textContent = nearest ? `Distancia estimada: ~${nearest.distanceMeters.toFixed(2)} m (${nearest.proximityZone?.label || ''})` : 'Sin dispositivos señalados recientes';
  if (nearest && running()) geiger.updateDistance(nearest.distanceMeters);
  else void geiger.stop();
}
function scan() {
  if (!running()) return;
  try {
    const statuses = classroom.generateScanFrame().map(device => session.ingestDevice(device).status);
    if (session.state === SESSION_STATES.CALIBRATING && Date.now() >= calibrationDeadline) {
      session.startExam();
      calibrationRemaining = 0;
    }
    if (statuses.some(status => status.startsWith('REJECTED') || status === 'TRACKED_INCIDENT_LIMIT')) {
      message('Algunas observaciones no se registraron. Revisa los límites indicados en el informe.');
    }
    renderObservations(session.getActiveThreats());
    renderState();
  } catch {
    paused = true;
    stopLoop();
    renderState();
    message('La simulación se ha pausado por un error. Inicia una nueva simulación para continuar.');
  }
}
function stopLoop() {
  if (scanInterval !== null) clearInterval(scanInterval);
  scanInterval = null;
  if (session?.state === SESSION_STATES.CALIBRATING && calibrationDeadline) {
    calibrationRemaining = Math.max(0, calibrationDeadline - Date.now());
    calibrationDeadline = 0;
  }
  renderer?.stop();
  void geiger.stop();
}
function startLoop() {
  if (!running() || scanInterval !== null) return;
  if (session.state === SESSION_STATES.CALIBRATING) calibrationDeadline = Date.now() + calibrationRemaining;
  scan();
  if (!running()) return;
  scanInterval = setInterval(scan, 600);
  if (!reducedMotion.matches) renderer?.start();
}
function newSession(calibrate = false) {
  stopLoop();
  session = new ExamSession({ examName: 'SIMULACIÓN · Matemáticas', classroom: 'Aula ficticia 204' });
  paused = false;
  calibrationRemaining = calibrate ? 5000 : 0;
  if (calibrate) session.startCalibration(); else session.startExam();
  posX = 2; posY = 3;
  updatePosition();
  resetSnapshot('Captura anterior borrada. La próxima descarga utilizará la nueva sesión.');
  renderObservations([]);
  renderState();
  startLoop();
}
function updatePosition() {
  byId('pos-x').textContent = posX.toFixed(1);
  byId('pos-y').textContent = posY.toFixed(1);
  classroom.setTeacherPosition(posX, posY);
}
byId('btn-pause').addEventListener('click', () => {
  paused = !paused;
  if (paused) stopLoop(); else startLoop();
  renderState();
});
byId('btn-complete').addEventListener('click', () => {
  session.completeExam();
  stopLoop();
  resetSnapshot('Sesión finalizada. La próxima descarga incluirá las observaciones finales.');
  renderState();
});
byId('btn-reset').addEventListener('click', () => newSession());
byId('btn-calibrate').addEventListener('click', () => newSession(true));
byId('btn-audio').addEventListener('click', async event => {
  const button = event.currentTarget;
  button.disabled = true;
  try {
    if (geiger.audioEnabled) { geiger.audioEnabled = false; await geiger.stop(); }
    else {
      if (!geiger.initAudio()) throw new Error('Audio unavailable');
      geiger.audioEnabled = true;
      if (!await geiger.playClick()) throw new Error('Audio permission denied');
    }
  } catch {
    geiger.audioEnabled = false;
    message('No se pudo activar el audio. Comprueba los permisos de sonido del navegador.');
  } finally {
    button.textContent = geiger.audioEnabled ? '🔊 Clics Geiger: ON' : '🔊 Clics Geiger: OFF';
    button.setAttribute('aria-pressed', String(geiger.audioEnabled));
    button.disabled = false;
  }
});
byId('btn-haptic').addEventListener('click', () => {
  if (typeof navigator.vibrate !== 'function') { message('Este navegador no ofrece vibración.'); return; }
  geiger.hapticEnabled = !geiger.hapticEnabled;
  if (!geiger.hapticEnabled) navigator.vibrate(0);
  byId('btn-haptic').textContent = geiger.hapticEnabled ? '📳 Vibración: ON' : '📳 Vibración: OFF';
  byId('btn-haptic').setAttribute('aria-pressed', String(geiger.hapticEnabled));
});
for (const button of document.querySelectorAll('.btn-walk')) button.addEventListener('click', () => {
  if (paused || session.state === SESSION_STATES.COMPLETED) return;
  if (button.dataset.home) { posX = 2; posY = 3; }
  else {
    posX = Math.max(0, Math.min(8, posX + Number(button.dataset.dx) * 0.8));
    posY = Math.max(0, Math.min(10, posY + Number(button.dataset.dy) * 0.8));
  }
  updatePosition();
});

function download(content, type, filename) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const anchor = document.createElement('a');
  anchor.href = url; anchor.download = filename;
  document.body.append(anchor);
  anchor.click(); anchor.remove();
  downloads.set(url, setTimeout(() => { URL.revokeObjectURL(url); downloads.delete(url); }, 30_000));
}
function captureReport() {
  if (!reportSnapshot) {
    const pending = generateIncidentAuditReport(session, { redactIdentifiers: byId('redact-identifiers').checked });
    reportSnapshot = pending;
    pending.catch(() => { if (reportSnapshot === pending) reportSnapshot = undefined; });
  }
  return reportSnapshot;
}
byId('btn-refresh-report').addEventListener('click', () => resetSnapshot('La próxima descarga incluirá una nueva captura.'));
byId('redact-identifiers').addEventListener('change', () => resetSnapshot('Preferencia de privacidad actualizada. Se generará una nueva captura.'));
for (const format of ['html', 'json']) byId(`btn-export-${format}`).addEventListener('click', async event => {
  const button = event.currentTarget;
  const version = snapshotVersion;
  button.disabled = true;
  byId('export-status').textContent = 'Generando informe…';
  try {
    const report = await captureReport();
    if (version !== snapshotVersion) return;
    download(format === 'html' ? generateHtmlIncidentCertificate(report) : JSON.stringify(report),
      format === 'html' ? 'text/html;charset=utf-8' : 'application/json', `simulacion-${report.reportId}.${format}`);
    byId('export-status').textContent = `Captura ${report.timestamp} descargada${report.privacy.redactIdentifiers ? ' con seudónimos' : ' con identificadores completos'}. HTML y JSON comparten esta captura. La huella no acredita autenticidad.`;
  } catch {
    if (version === snapshotVersion) byId('export-status').textContent = 'No se pudo generar el informe. Utiliza localhost o HTTPS y revisa los límites del informe.';
  } finally { button.disabled = false; }
});
byId('verify-file').addEventListener('change', async event => {
  const version = ++verifyVersion;
  const file = event.target.files[0];
  if (!file) { byId('verify-status').textContent = ''; return; }
  byId('verify-status').textContent = 'Comprobando archivo local…';
  try {
    if (file.size > REPORT_LIMITS.maxBytes) throw new Error('oversized');
    const report = JSON.parse(await file.text());
    const valid = await verifyIncidentAuditReport(report);
    if (version !== verifyVersion) return;
    byId('verify-status').textContent = valid ? 'Huella y estructura válidas. Esta comprobación no autentica al autor.' : 'Informe inválido o alterado: la estructura o la huella no coincide.';
  } catch {
    if (version === verifyVersion) byId('verify-status').textContent = 'No se pudo verificar. Selecciona un JSON de informe válido de hasta 5 MiB.';
  }
});
document.addEventListener('visibilitychange', () => { if (document.hidden) stopLoop(); else startLoop(); });
window.addEventListener('pagehide', () => {
  pageSuspended = true;
  stopLoop();
  for (const [url, timer] of downloads) { clearTimeout(timer); URL.revokeObjectURL(url); }
  downloads.clear();
});
window.addEventListener('pageshow', () => { pageSuspended = false; startLoop(); });
reducedMotion.addEventListener('change', () => { renderer?.stop(); if (running() && !reducedMotion.matches) renderer?.start(); else renderer?.draw(); });
newSession();
