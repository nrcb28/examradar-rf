import { MockClassroom } from '/src/core/hardware/mock-classroom.js';
import { ExamSession } from '/src/core/surveillance/exam-session.js';
import { GeigerEngine } from '/src/core/audio/geiger-synthesizer.js';
import { RadarRenderer } from '/src/ui/radar-canvas.js';
import { renderThreats } from '/src/ui/threat-list.js';
import { generateIncidentAuditReport, generateHtmlIncidentCertificate } from '/src/core/surveillance/incident-logger.js';

const renderer = new RadarRenderer(document.getElementById('radar'));
renderer.start();
const classroom = new MockClassroom();
const session = new ExamSession({ examName: 'SIMULACIÓN · Matemáticas', classroom: 'Aula ficticia 204' });
session.startExam();
const geiger = new GeigerEngine({ audioEnabled: false, hapticEnabled: true });
let posX = 2;
let posY = 3;
classroom.setTeacherPosition(posX, posY);

document.getElementById('btn-audio').addEventListener('click', () => {
  geiger.initAudio();
  geiger.audioEnabled = !geiger.audioEnabled;
  document.getElementById('btn-audio').textContent = geiger.audioEnabled ? '🔊 Clics Geiger: ON' : '🔊 Clics Geiger: OFF';
});
document.getElementById('btn-haptic').addEventListener('click', () => {
  geiger.hapticEnabled = !geiger.hapticEnabled;
  document.getElementById('btn-haptic').textContent = geiger.hapticEnabled ? '📳 Vibración: ON' : '📳 Vibración: OFF';
});
for (const button of document.querySelectorAll('[data-dx]')) {
  button.addEventListener('click', () => {
    posX = Math.max(0, Math.min(8, posX + Number(button.dataset.dx) * 0.8));
    posY = Math.max(0, Math.min(10, posY + Number(button.dataset.dy) * 0.8));
    document.getElementById('pos-x').textContent = posX.toFixed(1);
    document.getElementById('pos-y').textContent = posY.toFixed(1);
    classroom.setTeacherPosition(posX, posY);
  });
}

function scan() {
  for (const item of classroom.generateScanFrame()) session.ingestDevice(item);
  const threats = session.getActiveThreats();
  renderer.setDevices(threats);
  renderThreats(document.getElementById('threats-list'), threats);
  const nearest = threats[0];
  if (nearest) {
    document.getElementById('geiger-rssi').textContent = `${nearest.rssiFiltered} dBm`;
    document.getElementById('geiger-distance').textContent = `Distancia estimada: ~${nearest.distanceMeters.toFixed(2)} m (${nearest.proximityZone?.label || ''})`;
    geiger.updateDistance(nearest.distanceMeters);
  } else {
    document.getElementById('geiger-rssi').textContent = '— dBm';
    document.getElementById('geiger-distance').textContent = 'Sin dispositivos recientes';
    geiger.stop();
  }
}
scan();
let scanInterval = setInterval(scan, 600);

function download(content, type, filename) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

// Both downloads must describe the same snapshot and carry the same checksum.
let reportSnapshot;
function captureReport() {
  if (!reportSnapshot) {
    reportSnapshot = generateIncidentAuditReport(session).catch(error => {
      reportSnapshot = undefined;
      throw error;
    });
  }
  return reportSnapshot;
}
document.getElementById('btn-refresh-report').addEventListener('click', () => {
  reportSnapshot = undefined;
  document.getElementById('export-status').textContent = 'La próxima descarga incluirá una nueva captura de las observaciones.';
});

for (const format of ['html', 'json']) {
  document.getElementById(`btn-export-${format}`).addEventListener('click', async event => {
    const button = event.currentTarget;
    const status = document.getElementById('export-status');
    button.disabled = true;
    status.textContent = 'Generando informe…';
    try {
      const report = await captureReport();
      const content = format === 'html' ? generateHtmlIncidentCertificate(report) : JSON.stringify(report, null, 2);
      download(content, format === 'html' ? 'text/html;charset=utf-8' : 'application/json', `simulacion-${report.reportId}.${format}`);
      status.textContent = `Captura ${report.timestamp} descargada. HTML y JSON comparten la misma captura. La huella permite comprobar cambios; no acredita autenticidad.`;
    } catch {
      status.textContent = 'No se pudo generar el informe. Abre la aplicación en localhost o mediante HTTPS y vuelve a intentarlo.';
    } finally {
      button.disabled = false;
    }
  });
}

// Stop timers and audio while the page is hidden, including the back/forward cache.
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    clearInterval(scanInterval);
    scanInterval = null;
    geiger.stop();
    renderer.stop();
  } else if (!scanInterval) {
    scan();
    scanInterval = setInterval(scan, 600);
    renderer.start();
  }
});
