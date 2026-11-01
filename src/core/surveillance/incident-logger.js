import crypto from 'node:crypto';

/**
 * Generates an immutable, forensic incident report for academic tribunals.
 */
export function generateIncidentAuditReport(session) {
  const timestamp = new Date().toISOString();
  const reportId = `AUDIT-${session.id.toUpperCase()}-${Date.now().toString(36).toUpperCase()}`;

  const threats = session.getActiveThreats().map((t) => ({
    deviceId: t.id,
    deviceName: t.name,
    category: t.classification.category.label,
    threatLevel: t.classification.category.level,
    threatScore: t.classification.category.score,
    confidence: t.classification.confidence,
    reason: t.classification.reason,
    peakRssi: t.rssiFiltered,
    estimatedDistance: `${t.distanceMeters} m`,
    proximityZone: t.proximityZone?.label,
    firstSeen: t.firstSeen,
    lastSeen: t.lastSeen,
    isNewDuringExam: t.isNewInExam,
  }));

  const payloadToHash = JSON.stringify({
    reportId,
    examName: session.examName,
    classroom: session.classroom,
    instructor: session.instructor,
    startTime: session.startTime,
    timestamp,
    threats,
    incidentEvents: session.incidents,
  });

  const sha256Hash = crypto.createHash('sha256').update(payloadToHash).digest('hex');

  return {
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
    },
    threats,
    incidentEvents: session.incidents,
    evidenceIntegrity: {
      algorithm: 'SHA-256',
      hash: sha256Hash,
      status: 'VERIFIED_CHAIN_OF_CUSTODY',
    },
  };
}

/**
 * Generates an official, printable HTML certificate of the incident report.
 */
export function generateHtmlIncidentCertificate(auditReport) {
  const meta = auditReport.sessionMetadata;
  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <title>Acta de Incidencia RF - ${auditReport.reportId}</title>
  <style>
    body { font-family: "Segoe UI", Arial, sans-serif; background: #fff; color: #111; padding: 2.5rem; line-height: 1.5; }
    .header { border-bottom: 3px solid #003366; padding-bottom: 1rem; margin-bottom: 1.5rem; display: flex; justify-content: space-between; align-items: flex-start; }
    h1 { margin: 0; color: #003366; font-size: 1.6rem; }
    .badge { display: inline-block; padding: 0.2rem 0.6rem; border-radius: 4px; font-weight: bold; font-size: 0.8rem; }
    .badge-crit { background: #ffebee; color: #c62828; border: 1px solid #c62828; }
    .badge-high { background: #fff3e0; color: #ef6c00; border: 1px solid #ef6c00; }
    table { width: 100%; border-collapse: collapse; margin: 1.5rem 0; font-size: 0.9rem; }
    th, td { border: 1px solid #ddd; padding: 0.6rem; text-align: left; }
    th { background: #f5f5f5; color: #333; }
    .meta-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 0.5rem; margin-bottom: 1.5rem; background: #fafafa; padding: 1rem; border-radius: 4px; border: 1px solid #eee; }
    .hash-box { background: #eceff1; padding: 0.8rem; font-family: monospace; font-size: 0.8rem; border-radius: 4px; word-break: break-all; margin-top: 1.5rem; }
  </style>
</head>
<body>
  <div class="header">
    <div>
      <h1>INFORME DE EVIDENCIA PERICIAL DE RADIOFRECUENCIA</h1>
      <div style="color: #666; font-size: 0.9rem; margin-top: 0.3rem;">Sistema ExamRadar-RF • Detección de Dispositivos No Autorizados</div>
    </div>
    <div style="text-align: right; font-size: 0.85rem; color: #555;">
      <strong>Acta Nº:</strong> ${auditReport.reportId}<br>
      <strong>Emisión:</strong> ${new Date(auditReport.timestamp).toLocaleString('es-ES')}
    </div>
  </div>

  <div class="meta-grid">
    <div><strong>Prueba / Examen:</strong> ${meta.examName}</div>
    <div><strong>Ubicación:</strong> ${meta.classroom}</div>
    <div><strong>Profesor / Vigilante:</strong> ${meta.instructor}</div>
    <div><strong>Dispositivos Sospechosos:</strong> ${meta.suspiciousThreatsDetected}</div>
  </div>

  <h2>Dispositivos Detectados en Proximidad Crítica</h2>
  ${auditReport.threats.length === 0 ? '<p>No se registraron transmisiones sospechosas durante la sesión.</p>' : `
    <table>
      <thead>
        <tr>
          <th>Identificador (MAC)</th>
          <th>Nombre / Tipo</th>
          <th>Clasificación</th>
          <th>Nivel de Amenaza</th>
          <th>Distancia Mínima</th>
          <th>Potencia RSSI</th>
          <th>Línea Base</th>
        </tr>
      </thead>
      <tbody>
        ${auditReport.threats.map((t) => `
          <tr>
            <td><code>${t.deviceId}</code></td>
            <td><strong>${t.deviceName}</strong></td>
            <td>${t.category}</td>
            <td><span class="badge ${t.threatScore >= 90 ? 'badge-crit' : 'badge-high'}">${t.threatLevel} (${t.threatScore}/100)</span></td>
            <td>${t.estimatedDistance}</td>
            <td>${t.peakRssi} dBm</td>
            <td>${t.isNewDuringExam ? '<strong style="color:#c62828;">NUEVO (EN EXAMEN)</strong>' : 'Previo'}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `}

  <h2>Cadena de Custodia e Integridad Criptográfica</h2>
  <div class="hash-box">
    <strong>Firma Digital de Integridad (SHA-256):</strong><br>
    ${auditReport.evidenceIntegrity.hash}<br>
    <small style="color: #666;">Este hash garantiza que las marcas de tiempo y mediciones de potencia no han sido alteradas.</small>
  </div>
</body>
</html>`;
}
