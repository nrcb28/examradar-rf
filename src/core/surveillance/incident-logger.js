import { getProximityZone } from '../physics/path-loss.js';

export const REPORT_LIMITS = Object.freeze({
  maxBytes: 5 * 1024 * 1024, maxDepth: 32, maxNodes: 100000,
  maxStringLength: 4096, maxArrayLength: 5000,
});
const encoder = new TextEncoder();
const REDACTED_REASON = 'Clasificación heurística; identificadores anunciados omitidos';

// Validate before allocating a digest buffer. Enforce a budget while walking,
// including repeated references, instead of discovering oversized JSON at the end.
function canonicalJson(value) {
  const ancestors = new Set();
  let nodes = 0;
  let bytes = 0;
  function chunk(text) {
    bytes += encoder.encode(text).byteLength;
    if (bytes > REPORT_LIMITS.maxBytes) throw new RangeError('Report exceeds the 5 MiB JSON limit');
    return text;
  }
  function visit(item, depth) {
    if (++nodes > REPORT_LIMITS.maxNodes || depth > REPORT_LIMITS.maxDepth) {
      throw new RangeError('Report exceeds the JSON structure limits');
    }
    if (typeof item === 'string') {
      if (item.length > REPORT_LIMITS.maxStringLength) throw new RangeError('Report string is too long');
      return chunk(JSON.stringify(item));
    }
    if (item === null || typeof item === 'boolean' || (typeof item === 'number' && Number.isFinite(item))) {
      return chunk(JSON.stringify(item));
    }
    if (typeof item !== 'object' || ancestors.has(item)) throw new TypeError('Report must contain finite, acyclic JSON data only');
    const isArray = Array.isArray(item);
    const prototype = Object.getPrototypeOf(item);
    if (prototype !== (isArray ? Array.prototype : Object.prototype) && !(prototype === null && !isArray)) {
      throw new TypeError('Report objects must have plain JSON prototypes');
    }
    const allKeys = Reflect.ownKeys(item);
    if (allKeys.some((key) => typeof key !== 'string')) throw new TypeError('Symbol properties are not valid report data');
    const keys = allKeys.filter((key) => !(isArray && key === 'length'));
    if (keys.length > (isArray ? REPORT_LIMITS.maxArrayLength : 256) || nodes + keys.length > REPORT_LIMITS.maxNodes) {
      throw new RangeError('Report has too many properties');
    }
    const descriptors = Object.getOwnPropertyDescriptors(item);
    for (const key of keys) {
      if (key.length > REPORT_LIMITS.maxStringLength || !descriptors[key].enumerable || !Object.hasOwn(descriptors[key], 'value')) {
        throw new TypeError('Report properties must be bounded enumerable data properties');
      }
    }
    if (isArray && (keys.length !== item.length || keys.some((key, index) => key !== String(index)))) {
      throw new TypeError('Report arrays must be dense and have no extra properties');
    }
    ancestors.add(item);
    try {
      const entries = [];
      chunk(isArray ? '[' : '{');
      for (const key of isArray ? keys : keys.sort()) {
        if (entries.length) chunk(',');
        const prefix = isArray ? '' : chunk(`${JSON.stringify(key)}:`);
        entries.push(prefix + visit(descriptors[key].value, depth + 1));
      }
      chunk(isArray ? ']' : '}');
      return isArray ? `[${entries.join(',')}]` : `{${entries.join(',')}}`;
    } finally { ancestors.delete(item); }
  }
  return visit(value, 0);
}

async function sha256(value) {
  if (!globalThis.crypto?.subtle) throw new Error('Web Crypto is unavailable; use Node.js 22+ or HTTPS/localhost');
  const digest = await globalThis.crypto.subtle.digest('SHA-256', encoder.encode(canonicalJson(value)));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function unsignedReport(report) {
  const { hash, ...integrityMetadata } = report.evidenceIntegrity;
  return { ...report, evidenceIntegrity: integrityMetadata };
}

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
function keysMatch(value, required, optional = []) {
  return isObject(value) && required.every((key) => Object.hasOwn(value, key))
    && Object.keys(value).every((key) => required.includes(key) || optional.includes(key));
}
const text = (value, max = 256) => typeof value === 'string' && value.length > 0 && value.length <= max;
const count = (value, max) => Number.isSafeInteger(value) && value >= 0 && value <= max;
const bool = (value) => typeof value === 'boolean';
const rssi = (value) => Number.isFinite(value) && value >= -127 && value < 0;
const date = (value) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)
  && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
const deviceType = (value) => value === 'BLE' || value === 'WIFI';
const level = (value) => ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'].includes(value);
const score = (value) => Number.isFinite(value) && value >= 0 && value <= 100;
const pseudonym = (value) => typeof value === 'string'
  && /^DEV-[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(value);
function validCategory(category) {
  return keysMatch(category, ['id', 'label', 'level', 'score']) && text(category.id, 64)
    && /^[A-Z_]+$/.test(category.id) && text(category.label) && level(category.level) && score(category.score);
}

function validReport(report) {
  const legacy = report?.reportVersion === 1;
  if ((!legacy && report?.reportVersion !== 2)
      || !keysMatch(report, ['reportVersion', 'reportId', 'timestamp', 'sessionMetadata', 'threats', 'incidentEvents', 'evidenceIntegrity', ...(!legacy ? ['privacy'] : [])])
      || !text(report.reportId, 200) || !/^AUDIT-[A-Z0-9_-]+$/.test(report.reportId) || !date(report.timestamp)
      || !Array.isArray(report.threats) || report.threats.length > 1000
      || !Array.isArray(report.incidentEvents) || report.incidentEvents.length > 5000) return false;
  let redacted = false;
  if (!legacy) {
    if (!keysMatch(report.privacy, ['redactIdentifiers', 'scheme']) || !bool(report.privacy.redactIdentifiers)
        || report.privacy.scheme !== (report.privacy.redactIdentifiers ? 'PER_REPORT_RANDOM' : 'NONE')) return false;
    redacted = report.privacy.redactIdentifiers;
  }
  const meta = report.sessionMetadata;
  if (!keysMatch(meta, ['examName', 'classroom', 'instructor', 'startTime', 'totalDevicesScanned', 'totalBaselineDevices', 'suspiciousThreatsDetected', 'incidentLimitReached', 'deviceLimitReached', 'baselineLimitReached'])
      || !text(meta.examName) || !text(meta.classroom) || !text(meta.instructor)
      || !(meta.startTime === null || date(meta.startTime))
      || !count(meta.totalDevicesScanned, 1000) || !count(meta.totalBaselineDevices, 1000)
      || meta.suspiciousThreatsDetected !== report.threats.length || meta.totalDevicesScanned < report.threats.length
      || !bool(meta.incidentLimitReached) || !bool(meta.deviceLimitReached) || !bool(meta.baselineLimitReached)) return false;
  const identifiers = new Set();
  for (const threat of report.threats) {
    if (!keysMatch(threat, ['deviceId', 'deviceName', 'category', 'threatLevel', 'threatScore', 'confidence', 'reason', 'peakRssi', 'estimatedDistance', 'proximityZone', 'firstSeen', 'lastSeen', 'isNewDuringExam', ...(!legacy ? ['deviceType', 'baselineProfileChanged'] : [])])
        || !text(threat.deviceId) || !text(threat.deviceName) || !text(threat.category)
        || !level(threat.threatLevel) || !score(threat.threatScore)
        || !Number.isFinite(threat.confidence) || threat.confidence < 0 || threat.confidence > 1
        || !text(threat.reason, 1024) || !rssi(threat.peakRssi) || !text(threat.proximityZone)
        || !date(threat.firstSeen) || !date(threat.lastSeen) || !bool(threat.isNewDuringExam)
        || typeof threat.estimatedDistance !== 'string' || threat.estimatedDistance.length > 64
        || !/^\d+(?:\.\d+)?(?:e[+-]?\d+)? m$/i.test(threat.estimatedDistance)
        || !Number.isFinite(Number(threat.estimatedDistance.slice(0, -2))) || Number(threat.estimatedDistance.slice(0, -2)) <= 0
        || (!legacy && (!deviceType(threat.deviceType) || !bool(threat.baselineProfileChanged)))) return false;
    const key = `${threat.deviceType ?? 'BLE'}:${threat.deviceId}`;
    if (identifiers.has(key)) return false;
    identifiers.add(key);
    if (redacted && (!pseudonym(threat.deviceId) || threat.deviceName !== threat.deviceId || threat.reason !== REDACTED_REASON)) return false;
  }
  const eventIds = new Set();
  for (const event of report.incidentEvents) {
    if (!keysMatch(event, ['id', 'timestamp', 'type', 'deviceId', 'deviceName', 'category', 'rssi', ...(!legacy ? ['deviceType', 'deviceKey'] : [])], ['reason', 'distanceMeters'])
        || !text(event.id, 200) || !date(event.timestamp) || !text(event.deviceId) || !text(event.deviceName)
        || !['ANOMALY_NEW_SUSPECT_DEVICE', 'ANOMALY_DEVICE_RECLASSIFIED', 'ANOMALY_BASELINE_PROFILE_CHANGED', 'PROXIMITY_IMMEDIATE_ALERT'].includes(event.type)
        || !validCategory(event.category) || !rssi(event.rssi)
        || (event.reason !== undefined && !text(event.reason, 1024))
        || (event.distanceMeters !== undefined && (!Number.isFinite(event.distanceMeters) || event.distanceMeters <= 0))
        || (event.type === 'PROXIMITY_IMMEDIATE_ALERT' ? event.distanceMeters === undefined : event.reason === undefined)
        || (!legacy && (!deviceType(event.deviceType) || !text(event.deviceKey, 261)))) return false;
    if (eventIds.has(event.id)) return false;
    eventIds.add(event.id);
    if (!identifiers.has(`${event.deviceType ?? 'BLE'}:${event.deviceId}`)) return false;
    if (!legacy && event.deviceKey !== (redacted ? event.deviceId : `${event.deviceType}:${event.deviceId}`)) return false;
    if (redacted && (!pseudonym(event.deviceId) || event.deviceName !== event.deviceId
        || (event.reason !== undefined && event.reason !== REDACTED_REASON))) return false;
  }
  const integrity = report.evidenceIntegrity;
  return keysMatch(integrity, ['algorithm', 'status', 'hash']) && integrity.algorithm === 'SHA-256'
    && integrity.status === 'UNSIGNED_CHECKSUM' && typeof integrity.hash === 'string' && /^[a-f0-9]{64}$/.test(integrity.hash);
}

/**
 * Takes a detached snapshot with an unkeyed checksum. Redaction replaces device
 * identities/names/reasons with random per-report aliases; exam metadata remains.
 * A checksum is not a signature: an editor can also recompute it.
 */
export async function generateIncidentAuditReport(session, options = {}) {
  if (!globalThis.crypto?.subtle || !globalThis.crypto?.randomUUID) throw new Error('Web Crypto is unavailable; use Node.js 22+ or HTTPS/localhost');
  if (!isObject(options) || ![Object.prototype, null].includes(Object.getPrototypeOf(options))
      || Object.getOwnPropertySymbols(options).length > 0) throw new TypeError('Report options must be a plain object');
  const optionData = Object.getOwnPropertyDescriptors(options);
  if (Object.keys(optionData).some((key) => key !== 'redactIdentifiers')
      || (optionData.redactIdentifiers && (!Object.hasOwn(optionData.redactIdentifiers, 'value') || !bool(optionData.redactIdentifiers.value)))) {
    throw new TypeError('The only report option is redactIdentifiers (boolean)');
  }
  const redactIdentifiers = optionData.redactIdentifiers?.value ?? false;
  const identities = new Map();
  function alias(id, type) {
    const key = `${type}:${id}`;
    if (!identities.has(key)) identities.set(key, `DEV-${globalThis.crypto.randomUUID()}`);
    return identities.get(key);
  }
  const timestamp = new Date().toISOString();
  const reportId = `AUDIT-${session.id.toUpperCase()}-${globalThis.crypto.randomUUID().toUpperCase()}`;
  const threats = session.getRecordedThreats().map((t) => {
    const type = t.type ?? 'BLE';
    const id = redactIdentifiers ? alias(t.id, type) : t.id;
    return {
      deviceId: id, deviceType: type, deviceName: redactIdentifiers ? id : t.name,
      category: t.classification.category.label, threatLevel: t.classification.category.level,
      threatScore: t.classification.category.score, confidence: t.classification.confidence,
      reason: redactIdentifiers ? REDACTED_REASON : t.classification.reason,
      peakRssi: t.peakRssi, estimatedDistance: `${t.minimumDistanceMeters} m`,
      proximityZone: getProximityZone(t.minimumDistanceMeters).label,
      firstSeen: t.firstSeen, lastSeen: t.lastSeen, isNewDuringExam: t.isNewInExam,
      baselineProfileChanged: t.baselineProfileChanged ?? false,
    };
  });
  const incidentEvents = session.incidents.map((event, index) => {
    const type = event.deviceType ?? 'BLE';
    const id = redactIdentifiers ? alias(event.deviceId, type) : event.deviceId;
    return {
      ...event, id: redactIdentifiers ? `EVENT-${index + 1}` : event.id,
      deviceId: id, deviceType: type, deviceKey: redactIdentifiers ? id : `${type}:${event.deviceId}`,
      deviceName: redactIdentifiers ? id : event.deviceName,
      ...(redactIdentifiers && event.reason !== undefined ? { reason: REDACTED_REASON } : {}),
    };
  });
  // Serialize before awaiting so subsequent scans cannot mutate this snapshot.
  const report = JSON.parse(canonicalJson({
    reportVersion: 2, reportId, timestamp,
    privacy: { redactIdentifiers, scheme: redactIdentifiers ? 'PER_REPORT_RANDOM' : 'NONE' },
    sessionMetadata: {
      examName: session.examName, classroom: session.classroom, instructor: session.instructor, startTime: session.startTime,
      totalDevicesScanned: session.totalDevicesScanned ?? session.trackedDevices.size,
      totalBaselineDevices: session.totalBaselineDevices ?? session.baselineDeviceIds.size,
      suspiciousThreatsDetected: threats.length, incidentLimitReached: session.incidentLimitReached ?? false,
      deviceLimitReached: session.deviceLimitReached ?? false, baselineLimitReached: session.baselineLimitReached ?? false,
    },
    threats, incidentEvents,
    evidenceIntegrity: { algorithm: 'SHA-256', status: 'UNSIGNED_CHECKSUM', hash: '0'.repeat(64) },
  }));
  if (!validReport(report)) throw new TypeError('Session cannot be represented by the incident report schema');
  report.evidenceIntegrity.hash = await sha256(unsignedReport(report));
  return report;
}

/** Validates the bounded schema and checksum; does not authenticate its author. */
export async function verifyIncidentAuditReport(auditReport) {
  try {
    const report = JSON.parse(canonicalJson(auditReport));
    return validReport(report) && await sha256(unsignedReport(report)) === report.evidenceIntegrity.hash;
  } catch { return false; }
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character]);
}

/** Generates a printable, script-free summary with untrusted values escaped. */
export function generateHtmlIncidentCertificate(auditReport) {
  auditReport = JSON.parse(canonicalJson(auditReport));
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
  ${auditReport.privacy?.redactIdentifiers ? '<p><strong>Exportación con seudónimos:</strong> los identificadores y nombres anunciados se sustituyeron por alias nuevos para este informe. Los metadatos del examen, aula y profesor se conservan; revíselos antes de compartir.</p>' : '<p><strong>Datos identificativos:</strong> este informe incluye identificadores y nombres anunciados de dispositivos. Revise su contenido antes de compartir.</p>'}
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
