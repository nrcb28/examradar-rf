import {
  SPY_DEVICE_NAMES,
  SMARTWATCH_NAMES,
  HOTSPOT_SSID_PATTERNS,
  SUSPICIOUS_SERVICE_UUIDS,
} from './signatures.js';

export const THREAT_CATEGORIES = {
  SPY_EARPIECE: { id: 'SPY_EARPIECE', label: 'Microauricular / Pinganillo Espía', level: 'CRITICAL', score: 95 },
  SMARTWATCH: { id: 'SMARTWATCH', label: 'Reloj Inteligente / Wearable', level: 'HIGH', score: 75 },
  PORTABLE_HOTSPOT: { id: 'PORTABLE_HOTSPOT', label: 'Punto de Acceso Móvil (Tethering)', level: 'HIGH', score: 70 },
  COVERT_BEACON: { id: 'COVERT_BEACON', label: 'Transmisor Oculto (Sin Nombre)', level: 'MEDIUM', score: 60 },
  GENERIC_DEVICE: { id: 'GENERIC_DEVICE', label: 'Dispositivo No Clasificado', level: 'LOW', score: 20 },
};

/**
 * Evaluates a Bluetooth device against security signatures.
 * @param {object} device
 * @param {string} device.id MAC or Device Identifier
 * @param {string} [device.name] Advertised Name
 * @param {string[]} [device.services] Advertised Service UUIDs
 * @param {number} device.rssi Signal strength
 * @returns {object} Classification result
 */
export function classifyBleDevice(device) {
  const name = (device.name || '').trim();
  const services = (device.services || []).map((s) => s.toLowerCase());

  // 1. Explicit Spy Earpiece Name
  if (name) {
    for (const pattern of SPY_DEVICE_NAMES) {
      if (pattern.test(name)) {
        return {
          category: THREAT_CATEGORIES.SPY_EARPIECE,
          confidence: 0.95,
          reason: `Nombre coincide con firma de microauricular espía: "${name}"`,
          device,
        };
      }
    }

    // 2. Smartwatch / Wearable
    for (const pattern of SMARTWATCH_NAMES) {
      if (pattern.test(name)) {
        return {
          category: THREAT_CATEGORIES.SMARTWATCH,
          confidence: 0.9,
          reason: `Nombre coincide con firma de reloj inteligente: "${name}"`,
          device,
        };
      }
    }
  }

  // 3. Service UUIDs Check
  for (const s of services) {
    if (SUSPICIOUS_SERVICE_UUIDS.includes(s)) {
      if (s.includes('110b') || s.includes('111e')) {
        return {
          category: THREAT_CATEGORIES.SPY_EARPIECE,
          confidence: 0.85,
          reason: 'Servicio de audio manos libres encubierto (Audio Sink / Handsfree UUID)',
          device,
        };
      }
      if (s.includes('7905f431')) {
        return {
          category: THREAT_CATEGORIES.SMARTWATCH,
          confidence: 0.85,
          reason: 'Servicio de notificaciones Apple ANCS detectado',
          device,
        };
      }
    }
  }

  // 4. Covert / Unnamed Beacon (Broadcasting without local name, very common in cheating relays)
  if (!name || name === 'Unknown' || name === 'N/A') {
    return {
      category: THREAT_CATEGORIES.COVERT_BEACON,
      confidence: 0.65,
      reason: 'Transmisor sin nombre anunciado emitiendo paquetes periódicos',
      device,
    };
  }

  return {
    category: THREAT_CATEGORIES.GENERIC_DEVICE,
    confidence: 0.3,
    reason: `Dispositivo periférico estándar: "${name}"`,
    device,
  };
}

/**
 * Evaluates a Wi-Fi Access Point against tethering / rogue hotspot signatures.
 * @param {object} ap
 * @param {string} ap.ssid Network SSID name
 * @param {string} [ap.bssid] MAC address
 * @param {number} ap.rssi Signal strength
 * @returns {object} Classification result
 */
export function classifyWifiNetwork(ap) {
  const ssid = (ap.ssid || '').trim();

  for (const pattern of HOTSPOT_SSID_PATTERNS) {
    if (pattern.test(ssid)) {
      return {
        category: THREAT_CATEGORIES.PORTABLE_HOTSPOT,
        confidence: 0.9,
        reason: `Punto de acceso móvil / Tethering detectado en el aula: "${ssid}"`,
        network: ap,
      };
    }
  }

  return {
    category: THREAT_CATEGORIES.GENERIC_DEVICE,
    confidence: 0.2,
    reason: `Red Wi-Fi estándar o institucional: "${ssid}"`,
    network: ap,
  };
}
