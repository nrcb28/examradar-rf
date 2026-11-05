import {
  SPY_DEVICE_NAMES,
  SMARTWATCH_NAMES,
  HOTSPOT_SSID_PATTERNS,
  AUDIO_SERVICE_UUIDS,
  ANCS_SERVICE_UUID,
} from './signatures.js';

export const THREAT_CATEGORIES = Object.freeze({
  SPY_EARPIECE: Object.freeze({ id: 'SPY_EARPIECE', label: 'Microauricular / Pinganillo Espía', level: 'CRITICAL', score: 95 }),
  SMARTWATCH: Object.freeze({ id: 'SMARTWATCH', label: 'Reloj Inteligente / Wearable', level: 'HIGH', score: 75 }),
  PORTABLE_HOTSPOT: Object.freeze({ id: 'PORTABLE_HOTSPOT', label: 'Punto de Acceso Móvil (Tethering)', level: 'HIGH', score: 70 }),
  // Legacy identifier: lack of an advertised name alone does not imply covert use.
  COVERT_BEACON: Object.freeze({ id: 'COVERT_BEACON', label: 'Dispositivo sin nombre anunciado', level: 'LOW', score: 40 }),
  GENERIC_AUDIO: Object.freeze({ id: 'GENERIC_AUDIO', label: 'Dispositivo de audio / Manos libres', level: 'LOW', score: 30 }),
  GENERIC_DEVICE: Object.freeze({ id: 'GENERIC_DEVICE', label: 'Dispositivo No Clasificado', level: 'LOW', score: 20 }),
});

function requireObject(value, label) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
}

function optionalString(value, label, maxLength = 256) {
  if (value === undefined) return '';
  if (typeof value !== 'string') throw new TypeError(`${label} must be a string`);
  if (value.length > maxLength) throw new RangeError(`${label} is too long`);
  return value;
}

function validateRssi(value) {
  if (value !== undefined && (!Number.isFinite(value) || value < -127 || value >= 0)) {
    throw new RangeError('RSSI must be a finite number in [-127, 0) dBm');
  }
}

// Bluetooth UUID aliases expand into the Bluetooth base UUID (Web Bluetooth § 19).
// https://webbluetoothcg.github.io/web-bluetooth/#dom-bluetoothuuid-canonicaluuid
function canonicalServiceUuid(value) {
  const normalized = value.trim().toLowerCase();
  const alias = normalized.replace(/^0x/, '');
  if (/^(?:[0-9a-f]{4}|[0-9a-f]{8})$/.test(alias)) {
    return `${alias.padStart(8, '0')}-0000-1000-8000-00805f9b34fb`;
  }
  if (/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(normalized)) return normalized;
  if (/^[0-9a-f]{32}$/.test(normalized)) {
    return `${normalized.slice(0, 8)}-${normalized.slice(8, 12)}-${normalized.slice(12, 16)}-${normalized.slice(16, 20)}-${normalized.slice(20)}`;
  }
  return null;
}

function result(category, confidence, reason, subjectKey, subject) {
  return {
    category,
    confidence,
    confidenceType: 'HEURISTIC_NOT_PROBABILITY',
    reason,
    [subjectKey]: subject,
  };
}

/**
 * Classify a bounded advertisement snapshot. Scores/confidence are heuristic
 * match strengths, not probabilities of identity or misconduct. Optional RSSI
 * is validated but does not establish device type. Malformed field types throw;
 * syntactically unknown UUID strings are ignored as unsupported service hints.
 */
export function classifyBleDevice(device) {
  requireObject(device, 'Device');
  const rawName = optionalString(device.name, 'Device name');
  const id = optionalString(device.id, 'Device identifier');
  const rssi = device.rssi;
  validateRssi(rssi);
  const inputServices = device.services === undefined ? [] : device.services;
  if (!Array.isArray(inputServices)) throw new TypeError('Services must be an array');
  if (inputServices.length > 64) throw new RangeError('Too many advertised services');
  const services = [];
  for (let index = 0; index < inputServices.length; index++) {
    const service = inputServices[index];
    if (service === undefined) throw new TypeError('Service UUID must be a string');
    services.push(optionalString(service, 'Service UUID', 64));
  }
  const snapshot = { id, name: rawName, services, ...(rssi === undefined ? {} : { rssi }) };
  const name = rawName.normalize('NFKC').trim();
  const canonicalServices = new Set(services.map(canonicalServiceUuid).filter(Boolean));

  if (name) {
    if (SPY_DEVICE_NAMES.some((pattern) => pattern.test(name))) {
      return result(THREAT_CATEGORIES.SPY_EARPIECE, 0.95,
        `Nombre anunciado coincide con firma de microauricular: "${name}"; no acredita identidad ni uso`, 'device', snapshot);
    }
    if (SMARTWATCH_NAMES.some((pattern) => pattern.test(name))) {
      return result(THREAT_CATEGORIES.SMARTWATCH, 0.9,
        `Nombre anunciado compatible con reloj o wearable: "${name}"; identidad no verificada`, 'device', snapshot);
    }
  }

  // Evaluate the strongest available hint regardless of service-array order.
  if (canonicalServices.has(ANCS_SERVICE_UUID)) {
    return result(THREAT_CATEGORIES.SMARTWATCH, 0.6,
      'Servicio Apple ANCS compatible con accesorios de notificaciones; no identifica de forma exclusiva un reloj', 'device', snapshot);
  }
  if (AUDIO_SERVICE_UUIDS.some((service) => canonicalServices.has(service))) {
    return result(THREAT_CATEGORIES.GENERIC_AUDIO, 0.5,
      'Servicio de audio o manos libres estándar; por sí solo no indica un microauricular espía', 'device', snapshot);
  }
  if (!name || /^(?:unknown|n\/a)$/i.test(name)) {
    return result(THREAT_CATEGORIES.COVERT_BEACON, 0.25,
      'Anuncio sin nombre identificable; información insuficiente para determinar el tipo o uso del dispositivo', 'device', snapshot);
  }
  return result(THREAT_CATEGORIES.GENERIC_DEVICE, 0.3,
    `Sin firma de tipo reconocida para el nombre anunciado: "${name}"`, 'device', snapshot);
}

/** Classify an SSID hint; a network name alone does not prove tethering or authorization. */
export function classifyWifiNetwork(ap) {
  requireObject(ap, 'Network');
  const rawSsid = optionalString(ap.ssid, 'SSID');
  const bssid = optionalString(ap.bssid, 'BSSID');
  const rssi = ap.rssi;
  validateRssi(rssi);
  const snapshot = { ssid: rawSsid, bssid, ...(rssi === undefined ? {} : { rssi }) };
  const ssid = rawSsid.normalize('NFKC').trim();
  if (HOTSPOT_SSID_PATTERNS.some((pattern) => pattern.test(ssid))) {
    return result(THREAT_CATEGORIES.PORTABLE_HOTSPOT, 0.9,
      `SSID anunciado compatible con punto de acceso móvil: "${ssid}"; no demuestra tethering ni falta de autorización`, 'network', snapshot);
  }
  return result(THREAT_CATEGORIES.GENERIC_DEVICE, 0.2,
    `SSID sin firma de punto de acceso móvil reconocida: "${ssid}"`, 'network', snapshot);
}
