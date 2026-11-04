import { getProximityZone } from '../physics/path-loss.js';

// Only JSON data is accepted: do not silently discard undefined, non-finite
// numbers, accessors, sparse arrays or custom prototypes when hashing evidence.
function canonicalJson(value, ancestors = new Set()) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return JSON.stringify(value);
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return JSON.stringify(value);
  }
  if (typeof value !== 'object' || ancestors.has(value)) {
    throw new TypeError('Report must contain finite, acyclic JSON data only');
  }
  if (Object.getOwnPropertySymbols(value).length > 0) {
    throw new TypeError('Symbol properties are not valid report data');
  }

  const descriptors = Object.getOwnPropertyDescriptors(value);
  const isArray = Array.isArray(value);
  if (Object.getPrototypeOf(value) !== (isArray ? Array.prototype : Object.prototype)
      && !(Object.getPrototypeOf(value) === null && !isArray)) {
    throw new TypeError('Report objects must have plain JSON prototypes');
  }

  const keys = Object.keys(descriptors).filter((key) => !(isArray && key === 'length'));
  for (const key of keys) {
    if (!descriptors[key].enumerable || !Object.hasOwn(descriptors[key], 'value')) {
      throw new TypeError('Report properties must be enumerable data properties');
    }
  }
  if (isArray && (keys.length !== value.length
      || keys.some((key, index) => key !== String(index)))) {
    throw new TypeError('Report arrays must be dense and have no extra properties');
  }

  ancestors.add(value);
  try {
    if (isArray) {
      return `[${keys.map((key) => canonicalJson(descriptors[key].value, ancestors)).join(',')}]`;
    }
    return `{${keys.sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(descriptors[key].value, ancestors)}`).join(',')}}`;
  } finally {
    ancestors.delete(value);
  }
}

async function sha256(value) {
  if (!globalThis.crypto?.subtle) {
    throw new Error('Web Crypto is unavailable; use Node.js 22+ or a secure browser context (HTTPS/localhost)');
  }
  const bytes = new TextEncoder().encode(canonicalJson(value));
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function unsignedReport(report) {
  const { hash, ...integrityMetadata } = report.evidenceIntegrity;
  return { ...report, evidenceIntegrity: integrityMetadata };
}

/**
 * Takes a detached JSON snapshot and computes an unkeyed checksum of every
 * exported field except the checksum itself. This is not a digital signature:
 * anyone able to modify a report can also recompute its checksum.
 */
export async function generateIncidentAuditReport(session) {
  if (!globalThis.crypto?.subtle || !globalThis.crypto?.randomUUID) {
    throw new Error('Web Crypto is unavailable; use Node.js 22+ or a secure browser context (HTTPS/localhost)');
  }
  const timestamp = new Date().toISOString();
  const reportId = `AUDIT-${session.id.toUpperCase()}-${globalThis.crypto.randomUUID().toUpperCase()}`;
  const threats = session.getRecordedThreats().map((t) => ({
    deviceId: t.id,
    deviceName: t.name,
    category: t.classification.category.label,
    threatLevel: t.classification.category.level,
    threatScore: t.classification.category.score,
    confidence: t.classification.confidence,
    reason: t.classification.reason,
    peakRssi: t.peakRssi,
    estimatedDistance: `${t.minimumDistanceMeters} m`,
    proximityZone: getProximityZone(t.minimumDistanceMeters).label,
    firstSeen: t.firstSeen,
    lastSeen: t.lastSeen,
    isNewDuringExam: t.isNewInExam,
  }));

  // Detach all nested values before awaiting so scans cannot mutate this report.
  const report = JSON.parse(canonicalJson({
    reportVersion: 1,
    reportId,
    timestamp,
    sessionMetadata: {
      examName: session.examName,
      classroom: session.classroom,
      instructor: session.instructor,
      startTime: session.startTime,
      totalDevicesScanned: session.trackedDevices.size,
      totalBaselineDevices: session.baselineDeviceIds.size,
      suspiciousThreatsDetected: threats.length,
      incidentLimitReached: session.incidentLimitReached ?? false,
      deviceLimitReached: session.deviceLimitReached ?? false,
      baselineLimitReached: session.baselineLimitReached ?? false,
    },
    threats,
    incidentEvents: session.incidents,
    evidenceIntegrity: {
      algorithm: 'SHA-256',
      status: 'UNSIGNED_CHECKSUM',
    },
  }));
  report.evidenceIntegrity.hash = await sha256(report);
  return report;
}

/** Checks data consistency only; does not authenticate the report or its author. */
export async function verifyIncidentAuditReport(auditReport) {
  try {
    const report = JSON.parse(canonicalJson(auditReport));
    const integrity = report.evidenceIntegrity;
    if (report.reportVersion !== 1 || !integrity || Array.isArray(integrity)
        || Object.keys(integrity).sort().join(',') !== 'algorithm,hash,status'
        || integrity.algorithm !== 'SHA-256' || integrity.status !== 'UNSIGNED_CHECKSUM'
        || typeof integrity.hash !== 'string' || !/^[a-f0-9]{64}$/.test(integrity.hash)) {
      return false;
    }
    return await sha256(unsignedReport(report)) === integrity.hash;
  } catch {
    return false;
  }
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character]);
}

/** Generates a printable, script-free summary with untrusted values escaped. */
export function generateHtmlIncidentCertificate(auditReport) {
  const meta = auditReport.sessionMetadata;
  const text = escapeHtml;
  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'">
  <meta name="referrer" content="no-referrer">
  <title>Informe de observaciones RF - ${text(auditReport.reportId)}</title>
  <style>
    body { font-family: "Segoe UI", Arial, sans-serif; background: #fff; color: #111; padding: 2.5rem; line-height: 1.5; }
    .header { border-bottom: 3px solid #003366; padding-bottom: 1rem; margin-bottom: 1.5rem; display: flex; justify-content: space-between; align-items: flex-start; }
    h1 { margin: 0; color: #003366; font-size: 1.6rem; }
    .badge { display: inline-block; padding: 0.2rem 0.6rem; border-radius: 4px; font-weight: bold; font-size: 0.8rem; }
    .badge-crit { background: #ffebee; color: #c62828; border: 1px solid #c62828; }
    .badge-high { background: #fff3e0; color: #ef6c00; border: 1px solid #ef6c00; }
    table { width: 100%; border-collapse: collapse; margin: 1.5rem 0; font-size: 0.9rem; }
    th, td { border: 1px solid #ddd; padding: 0.6rem; text-align: left; overflow-wrap: anywhere; }
    th { background: #f5f5f5; color: #333; }
    .meta-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 0.5rem; margin-bottom: 1.5rem; background: #fafafa; padding: 1rem; border-radius: 4px; border: 1px solid #eee; }
    .hash-box { background: #eceff1; padding: 0.8rem; font-family: monospace; font-size: 0.8rem; border-radius: 4px; word-break: break-all; margin-top: 1.5rem; }
  </style>
</head>
<body>
  <div class="header">
    <div>
      <h1>INFORME DE OBSERVACIONES DE RADIOFRECUENCIA</h1>
      <div style="color: #666; font-size: 0.9rem; margin-top: 0.3rem;">ExamRadar-RF • Clasificación heurística de señales</div>
    </div>
    <div style="text-align: right; font-size: 0.85rem; color: #555;">
      <strong>Informe Nº:</strong> ${text(auditReport.reportId)}<br>
      <strong>Emisión:</strong> ${text(new Date(auditReport.timestamp).toLocaleString('es-ES'))}
    </div>
  </div>

  <div class="meta-grid">
    <div><strong>Prueba / Examen:</strong> ${text(meta.examName)}</div>
    <div><strong>Ubicación:</strong> ${text(meta.classroom)}</div>
    <div><strong>Profesor / Vigilante:</strong> ${text(meta.instructor)}</div>
    <div><strong>Dispositivos señalados:</strong> ${text(meta.suspiciousThreatsDetected)}</div>
  </div>

  <p>Los nombres y servicios anunciados pueden ser falsificados. Las distancias son estimaciones por RSSI; estas observaciones no demuestran fraude ni identifican a una persona.</p>
  ${meta.incidentLimitReached ? '<p><strong>Registro limitado:</strong> se alcanzó el máximo de incidencias; algunas alertas posteriores no se guardaron.</p>' : ''}
  ${meta.deviceLimitReached || meta.baselineLimitReached ? '<p><strong>Muestreo incompleto:</strong> se alcanzó el límite de dispositivos o de línea base; algunas transmisiones no se registraron.</p>' : ''}
  <h2>Dispositivos registrados durante la sesión</h2>
  ${auditReport.threats.length === 0 ? '<p>No se registraron dispositivos señalados durante la sesión.</p>' : `
    <table>
      <thead>
        <tr>
          <th>Identificador anunciado</th>
          <th>Nombre / Tipo</th>
          <th>Clasificación</th>
          <th>Puntuación heurística</th>
          <th>Distancia mínima estimada</th>
          <th>RSSI máximo observado</th>
          <th>Línea base</th>
        </tr>
      </thead>
      <tbody>
        ${auditReport.threats.map((t) => `
          <tr>
            <td><code>${text(t.deviceId)}</code></td>
            <td><strong>${text(t.deviceName)}</strong></td>
            <td>${text(t.category)}</td>
            <td><span class="badge ${t.threatScore >= 90 ? 'badge-crit' : 'badge-high'}">${text(t.threatLevel)} (${text(t.threatScore)}/100)</span></td>
            <td>${text(t.estimatedDistance)}</td>
            <td>${text(t.peakRssi)} dBm</td>
            <td>${t.isNewDuringExam ? '<strong style="color:#c62828;">NUEVO (EN EXAMEN)</strong>' : 'Previo'}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `}

  <h2>Huella de consistencia de los datos</h2>
  <div class="hash-box">
    <strong>Huella SHA-256 del informe JSON:</strong><br>
    ${text(auditReport.evidenceIntegrity.hash)}<br>
    <small>Esta huella permite comprobar la consistencia del JSON completo. No es una firma digital, no autentica al autor ni acredita una cadena de custodia. Quien modifique el informe también puede recalcular la huella.</small>
  </div>
</body>
</html>`;
}
