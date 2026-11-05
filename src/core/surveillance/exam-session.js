import { classifyBleDevice, classifyWifiNetwork } from '../classifier/classifier-engine.js';
import { RssiKalmanFilter } from '../physics/kalman-filter.js';
import { rssiToDistance, getProximityZone } from '../physics/path-loss.js';

export const SESSION_STATES = Object.freeze({
  IDLE: 'IDLE', CALIBRATING: 'CALIBRATING', SURVEILLANCE_ACTIVE: 'SURVEILLANCE_ACTIVE', COMPLETED: 'COMPLETED',
});

function positiveInteger(value, fallback, name, maximum) {
  const result = value ?? fallback;
  if (!Number.isSafeInteger(result) || result <= 0 || result > maximum) {
    throw new RangeError(`${name} must be an integer from 1 to ${maximum}`);
  }
  return result;
}

function metadata(value, fallback, name) {
  if (value === undefined) return fallback;
  if (typeof value !== 'string' || !value.trim() || value.length > 256) {
    throw new TypeError(`${name} must be a non-empty string of at most 256 characters`);
  }
  return value;
}

function createSessionId() {
  const random = globalThis.crypto;
  if (typeof random?.randomUUID === 'function') return `exam_${random.randomUUID()}`;
  if (typeof random?.getRandomValues !== 'function') {
    throw new Error('A cryptographically secure random number generator is required to create a session');
  }
  // getRandomValues is available on ordinary HTTP origins where randomUUID
  // requires a secure context. Preserve UUIDv4 entropy, version and variant.
  const bytes = new Uint8Array(16);
  random.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `exam_${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function normalizeDevice(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  if (![Object.prototype, null].includes(Object.getPrototypeOf(raw))) return null;
  const values = {};
  for (const key of ['id', 'rssi', 'type', 'name', 'ssid', 'services']) {
    const descriptor = Object.getOwnPropertyDescriptor(raw, key);
    if (descriptor && !Object.hasOwn(descriptor, 'value')) return null;
    values[key] = descriptor?.value;
  }
  if (typeof values.id !== 'string' || !values.id.trim() || values.id.length > 256) return null;
  if (!Number.isFinite(values.rssi) || values.rssi < -127 || values.rssi >= 0) return null;
  if (values.type !== undefined && values.type !== 'BLE' && values.type !== 'WIFI') return null;
  for (const key of ['name', 'ssid']) {
    if (values[key] !== undefined && (typeof values[key] !== 'string' || values[key].length > 256)) return null;
  }
  const services = [];
  if (values.services !== undefined) {
    if (!Array.isArray(values.services) || values.services.length > 64) return null;
    for (let index = 0; index < values.services.length; index++) {
      const descriptor = Object.getOwnPropertyDescriptor(values.services, String(index));
      if (!descriptor || !Object.hasOwn(descriptor, 'value')
          || typeof descriptor.value !== 'string' || descriptor.value.length > 64) return null;
      services.push(descriptor.value);
    }
  }
  const type = values.type ?? 'BLE';
  return {
    id: values.id.trim(), type,
    name: type === 'WIFI' ? (values.ssid ?? values.name ?? '') : (values.name ?? ''),
    ssid: values.ssid ?? values.name ?? '', rssi: values.rssi, services,
  };
}

const deviceKey = (id, type) => `${type}:${id}`;
const advertisedProfile = (device) => JSON.stringify([
  device.name, [...new Set(device.services.map((service) => service.toLowerCase()))].sort(),
]);

export class ExamSession {
  #state = SESSION_STATES.IDLE;
  #startTime = null;
  #baseline = new Map();
  #tracked = new Map();
  #incidents = [];
  #listeners = new Set();
  #nextIncidentId = 0;
  #deviceLimitReached = false;
  #baselineLimitReached = false;
  #incidentLimitReached = false;

  constructor(options = {}) {
    const config = {
      id: createSessionId(),
      examName: metadata(options.examName, 'Examen Oficial', 'examName'),
      classroom: metadata(options.classroom, 'Aula 101', 'classroom'),
      instructor: metadata(options.instructor, 'Profesor Vigilante', 'instructor'),
      activeTimeoutMs: positiveInteger(options.activeTimeoutMs, 15000, 'activeTimeoutMs', 3600000),
      maxDevices: positiveInteger(options.maxDevices, 1000, 'maxDevices', 1000),
      maxBaselineDevices: positiveInteger(options.maxBaselineDevices, 1000, 'maxBaselineDevices', 1000),
      maxIncidents: positiveInteger(options.maxIncidents, 5000, 'maxIncidents', 5000),
    };
    Object.defineProperties(this, Object.fromEntries(Object.entries(config).map(([key, value]) => [
      key, { value, enumerable: true },
    ])));
  }

  get state() { return this.#state; }
  get startTime() { return this.#startTime; }
  get deviceLimitReached() { return this.#deviceLimitReached; }
  get baselineLimitReached() { return this.#baselineLimitReached; }
  get incidentLimitReached() { return this.#incidentLimitReached; }
  get baselineDeviceIds() { return new Set(this.#baseline.keys()); }
  get trackedDevices() { return new Map([...this.#tracked].map(([key, tracked]) => [key, this.#snapshot(tracked)])); }
  get incidents() { return structuredClone(this.#incidents); }
  get alertListeners() { return [...this.#listeners]; }
  get totalDevicesScanned() { return this.#tracked.size; }
  get totalBaselineDevices() { return this.#baseline.size; }
  get totalIncidentEvents() { return this.#incidents.length; }

  #snapshot(tracked, historical = false) {
    const { filter, suspicionAlerted, highestThreatClassification, highestThreatName, lastProximityAlertAt, ...data } = tracked;
    return structuredClone({
      ...data,
      name: historical ? highestThreatName : data.name,
      classification: historical ? highestThreatClassification : data.classification,
    });
  }

  /** Returns a detached observation. Keys in collection snapshots are TYPE:id. */
  getTrackedDevice(id, type = 'BLE') {
    const tracked = this.#tracked.get(deviceKey(id, type));
    return tracked ? this.#snapshot(tracked) : undefined;
  }

  /** Register at most 64 listeners; each receives its own detached alert. */
  onAlert(callback) {
    if (typeof callback !== 'function') throw new TypeError('Alert listener must be a function');
    if (!this.#listeners.has(callback) && this.#listeners.size >= 64) throw new RangeError('Alert listener limit reached');
    this.#listeners.add(callback);
    return () => this.#listeners.delete(callback);
  }

  #recordIncident(incident) {
    const snapshot = structuredClone({ ...incident, id: `${this.id}_inc_${++this.#nextIncidentId}` });
    const recorded = this.#incidents.length < this.maxIncidents;
    if (recorded) this.#incidents.push(snapshot);
    else this.#incidentLimitReached = true;
    // Capacity limits do not stop live notifications. A listener cannot rewrite
    // stored history or the alert delivered to another listener.
    for (const callback of [...this.#listeners]) {
      try {
        Promise.resolve(callback(structuredClone({ ...snapshot, recorded }))).catch(() => {});
      } catch (_) {}
    }
    return recorded;
  }

  startCalibration() {
    if (this.#state !== SESSION_STATES.IDLE) throw new Error('Calibration can only start on a new session');
    this.#state = SESSION_STATES.CALIBRATING;
  }

  startExam() {
    if (![SESSION_STATES.IDLE, SESSION_STATES.CALIBRATING].includes(this.#state)) {
      throw new Error('An exam can only start once per session');
    }
    this.#state = SESSION_STATES.SURVEILLANCE_ACTIVE;
    this.#startTime = new Date().toISOString();
  }

  completeExam() {
    if (this.#state !== SESSION_STATES.SURVEILLANCE_ACTIVE) throw new Error('Only an active exam can be completed');
    this.#state = SESSION_STATES.COMPLETED;
  }

  /** Ingest a bounded snapshot of an untrusted BLE or Wi-Fi advertisement. */
  ingestDevice(rawDevice) {
    let device;
    try { device = normalizeDevice(rawDevice); } catch { device = null; }
    if (!device) return { status: 'REJECTED_INVALID_DEVICE' };
    const { id, type } = device;
    const key = deviceKey(id, type);
    const profile = advertisedProfile(device);

    if (this.#state === SESSION_STATES.CALIBRATING) {
      if (!this.#baseline.has(key) && this.#baseline.size >= this.maxBaselineDevices) {
        this.#baselineLimitReached = true;
        return { status: 'REJECTED_BASELINE_LIMIT', id, type };
      }
      // A baseline is an observed profile, never proof of device ownership.
      if (!this.#baseline.has(key)) this.#baseline.set(key, profile);
      return { status: 'BASELINED', id, type };
    }
    if (this.#state !== SESSION_STATES.SURVEILLANCE_ACTIVE) return { status: 'IGNORED_IDLE', id, type };

    let tracked = this.#tracked.get(key);
    if (!tracked && this.#tracked.size >= this.maxDevices) {
      this.#deviceLimitReached = true;
      return { status: 'REJECTED_DEVICE_LIMIT', id, type };
    }
    const classification = structuredClone(type === 'WIFI' ? classifyWifiNetwork(device) : classifyBleDevice(device));
    const now = Date.now();
    const timestamp = new Date(now).toISOString();
    const wasTracked = Boolean(tracked);
    const previousScore = tracked?.classification.category.score ?? 0;
    const baselineProfileChanged = this.#baseline.has(key) && this.#baseline.get(key) !== profile;
    if (!tracked) {
      tracked = {
        id, type, key, filter: new RssiKalmanFilter(), firstSeen: timestamp,
        isNewInExam: !this.#baseline.has(key), baselineProfileChanged,
        peakRssi: device.rssi, minimumDistanceMeters: Infinity, suspicionAlerted: false,
        highestThreatClassification: classification, highestThreatName: device.name || 'Desconocido',
        lastProximityAlertAt: null,
      };
      this.#tracked.set(key, tracked);
    }
    tracked.name = device.name || 'Desconocido';
    tracked.classification = classification;
    tracked.rssiRaw = device.rssi;
    tracked.rssiFiltered = tracked.filter.filter(device.rssi);
    tracked.lastSeen = timestamp;
    tracked.peakRssi = Math.max(tracked.peakRssi, device.rssi);
    tracked.distanceMeters = rssiToDistance(tracked.rssiFiltered);
    tracked.minimumDistanceMeters = Math.min(tracked.minimumDistanceMeters, tracked.distanceMeters);
    tracked.proximityZone = getProximityZone(tracked.distanceMeters);
    tracked.baselineProfileChanged ||= baselineProfileChanged;
    if (classification.category.score > tracked.highestThreatClassification.category.score) {
      tracked.highestThreatClassification = classification;
      tracked.highestThreatName = tracked.name;
    }

    if (classification.category.score >= 60 && !tracked.suspicionAlerted && (
      tracked.isNewInExam || baselineProfileChanged || (wasTracked && previousScore < 60)
    )) {
      // Set before callbacks: re-entrant listeners cannot produce duplicate alerts.
      tracked.suspicionAlerted = true;
      this.#recordIncident({
        timestamp,
        type: baselineProfileChanged ? 'ANOMALY_BASELINE_PROFILE_CHANGED'
          : wasTracked ? 'ANOMALY_DEVICE_RECLASSIFIED' : 'ANOMALY_NEW_SUSPECT_DEVICE',
        deviceId: id, deviceType: type, deviceKey: key, deviceName: tracked.name,
        category: { ...classification.category }, reason: classification.reason, rssi: device.rssi,
      });
    }

    // Keep per-device cooldown state instead of scanning the incident log on
    // every advertisement. It also remains effective after the log fills up.
    if (tracked.proximityZone.name === 'IMMEDIATE' && classification.category.score >= 60
        && (tracked.lastProximityAlertAt === null || now - tracked.lastProximityAlertAt >= 10000)) {
      tracked.lastProximityAlertAt = now;
      this.#recordIncident({
        timestamp, type: 'PROXIMITY_IMMEDIATE_ALERT', deviceId: id, deviceType: type,
        deviceKey: key, deviceName: tracked.name, category: { ...classification.category },
        distanceMeters: tracked.distanceMeters, rssi: tracked.rssiFiltered,
      });
    }
    return { status: this.#incidentLimitReached ? 'TRACKED_INCIDENT_LIMIT' : 'TRACKED', device: this.#snapshot(tracked) };
  }

  getActiveThreats() {
    const now = Date.now();
    return [...this.#tracked.values()]
      .filter((device) => device.classification.category.score >= 50
        && now - Date.parse(device.lastSeen) <= this.activeTimeoutMs)
      .sort((a, b) => b.rssiFiltered - a.rssiFiltered)
      .map((device) => this.#snapshot(device));
  }

  /** Detached historical observations retain the highest recorded classification. */
  getRecordedThreats() {
    return [...this.#tracked.values()]
      .filter((device) => device.highestThreatClassification.category.score >= 50)
      .sort((a, b) => b.peakRssi - a.peakRssi)
      .map((device) => this.#snapshot(device, true));
  }
}
