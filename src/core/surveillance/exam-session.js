import { classifyBleDevice, classifyWifiNetwork } from '../classifier/classifier-engine.js';
import { RssiKalmanFilter } from '../physics/kalman-filter.js';
import { rssiToDistance, getProximityZone } from '../physics/path-loss.js';

export const SESSION_STATES = Object.freeze({
  IDLE: 'IDLE',
  CALIBRATING: 'CALIBRATING',
  SURVEILLANCE_ACTIVE: 'SURVEILLANCE_ACTIVE',
  COMPLETED: 'COMPLETED',
});

function positiveInteger(value, fallback, name) {
  const result = value ?? fallback;
  if (!Number.isSafeInteger(result) || result <= 0) {
    throw new RangeError(`${name} must be a positive safe integer`);
  }
  return result;
}

function normalizeDevice(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  if (typeof raw.id !== 'string' || !raw.id.trim() || raw.id.length > 256) return null;
  if (!Number.isFinite(raw.rssi) || raw.rssi < -127 || raw.rssi >= 0) return null;
  if (raw.type !== undefined && raw.type !== 'BLE' && raw.type !== 'WIFI') return null;
  for (const key of ['name', 'ssid']) {
    if (raw[key] !== undefined && (typeof raw[key] !== 'string' || raw[key].length > 256)) return null;
  }
  if (raw.services !== undefined && (
    !Array.isArray(raw.services) || raw.services.length > 64 ||
    [...raw.services].some((service) => typeof service !== 'string' || service.length > 64)
  )) return null;

  const type = raw.type ?? 'BLE';
  return {
    id: raw.id.trim(),
    type,
    name: type === 'WIFI' ? (raw.ssid ?? raw.name ?? '') : (raw.name ?? ''),
    ssid: raw.ssid ?? raw.name ?? '',
    rssi: raw.rssi,
    services: [...(raw.services ?? [])],
  };
}

export class ExamSession {
  constructor(options = {}) {
    this.id = 'exam_' + Date.now().toString(36);
    this.examName = options.examName || 'Examen Oficial';
    this.classroom = options.classroom || 'Aula 101';
    this.instructor = options.instructor || 'Profesor Vigilante';
    this.state = SESSION_STATES.IDLE;
    this.startTime = null;
    this.activeTimeoutMs = positiveInteger(options.activeTimeoutMs, 15000, 'activeTimeoutMs');
    this.maxDevices = positiveInteger(options.maxDevices, 1000, 'maxDevices');
    this.maxBaselineDevices = positiveInteger(options.maxBaselineDevices, 1000, 'maxBaselineDevices');
    this.maxIncidents = positiveInteger(options.maxIncidents, 5000, 'maxIncidents');
    this.baselineDeviceIds = new Set();
    this.trackedDevices = new Map();
    this.incidents = [];
    this.deviceLimitReached = false;
    this.baselineLimitReached = false;
    this.incidentLimitReached = false;
    this.alertListeners = [];
    this.nextIncidentId = 0;
  }

  onAlert(callback) {
    this.alertListeners.push(callback);
  }

  notifyAlert(alert) {
    for (const cb of this.alertListeners) {
      try { cb(alert); } catch (_) {}
    }
  }

  startCalibration() {
    if (this.state !== SESSION_STATES.IDLE) {
      throw new Error('Calibration can only start on a new session');
    }
    this.state = SESSION_STATES.CALIBRATING;
  }

  startExam() {
    if (![SESSION_STATES.IDLE, SESSION_STATES.CALIBRATING].includes(this.state)) {
      throw new Error('An exam can only start once per session');
    }
    this.state = SESSION_STATES.SURVEILLANCE_ACTIVE;
    this.startTime = new Date().toISOString();
  }

  completeExam() {
    if (this.state !== SESSION_STATES.SURVEILLANCE_ACTIVE) {
      throw new Error('Only an active exam can be completed');
    }
    this.state = SESSION_STATES.COMPLETED;
  }

  recordIncident(incident) {
    if (this.incidents.length >= this.maxIncidents) {
      this.incidentLimitReached = true;
      return false;
    }
    this.incidents.push({ ...incident, id: `${this.id}_inc_${++this.nextIncidentId}` });
    this.notifyAlert(this.incidents.at(-1));
    return true;
  }

  /** Ingest a bounded snapshot of an untrusted BLE or Wi-Fi advertisement. */
  ingestDevice(rawDevice) {
    const device = normalizeDevice(rawDevice);
    if (!device) return { status: 'REJECTED_INVALID_DEVICE' };
    const { id } = device;

    if (this.state === SESSION_STATES.CALIBRATING) {
      if (!this.baselineDeviceIds.has(id) && this.baselineDeviceIds.size >= this.maxBaselineDevices) {
        this.baselineLimitReached = true;
        return { status: 'REJECTED_BASELINE_LIMIT', id };
      }
      this.baselineDeviceIds.add(id);
      return { status: 'BASELINED', id };
    }
    if (this.state !== SESSION_STATES.SURVEILLANCE_ACTIVE) {
      return { status: 'IGNORED_IDLE', id };
    }

    let tracked = this.trackedDevices.get(id);
    if (!tracked && this.trackedDevices.size >= this.maxDevices) {
      this.deviceLimitReached = true;
      return { status: 'REJECTED_DEVICE_LIMIT', id };
    }
    const classification = device.type === 'WIFI'
      ? classifyWifiNetwork(device)
      : classifyBleDevice(device);
    const timestamp = new Date().toISOString();
    const wasTracked = Boolean(tracked);
    const previousScore = tracked?.classification.category.score ?? 0;

    if (!tracked) {
      tracked = {
        id,
        filter: new RssiKalmanFilter(),
        firstSeen: timestamp,
        isNewInExam: !this.baselineDeviceIds.has(id),
        peakRssi: device.rssi,
        minimumDistanceMeters: Infinity,
        suspicionAlerted: false,
        highestThreatClassification: classification,
        highestThreatName: device.name || 'Desconocido',
      };
      this.trackedDevices.set(id, tracked);
    }

    tracked.name = device.name || 'Desconocido';
    tracked.type = device.type;
    tracked.classification = classification;
    tracked.rssiRaw = device.rssi;
    tracked.rssiFiltered = tracked.filter.filter(device.rssi);
    tracked.lastSeen = timestamp;
    tracked.peakRssi = Math.max(tracked.peakRssi, device.rssi);
    tracked.distanceMeters = rssiToDistance(tracked.rssiFiltered);
    tracked.minimumDistanceMeters = Math.min(tracked.minimumDistanceMeters, tracked.distanceMeters);
    tracked.proximityZone = getProximityZone(tracked.distanceMeters);
    if (classification.category.score > tracked.highestThreatClassification.category.score) {
      tracked.highestThreatClassification = classification;
      tracked.highestThreatName = tracked.name;
    }

    // Re-check advertisements: a transmitter can change its name or services.
    if (classification.category.score >= 60 && !tracked.suspicionAlerted && (
      tracked.isNewInExam || (wasTracked && previousScore < 60)
    )) {
      tracked.suspicionAlerted = this.recordIncident({
        timestamp,
        type: wasTracked ? 'ANOMALY_DEVICE_RECLASSIFIED' : 'ANOMALY_NEW_SUSPECT_DEVICE',
        deviceId: id,
        deviceName: tracked.name,
        category: { ...classification.category },
        reason: classification.reason,
        rssi: device.rssi,
      });
    }

    if (tracked.proximityZone.name === 'IMMEDIATE' && classification.category.score >= 60) {
      const exists = this.incidents.some((incident) => incident.deviceId === id &&
        incident.type === 'PROXIMITY_IMMEDIATE_ALERT' &&
        Date.now() - Date.parse(incident.timestamp) < 10000);
      if (!exists) {
        this.recordIncident({
          timestamp,
          type: 'PROXIMITY_IMMEDIATE_ALERT',
          deviceId: id,
          deviceName: tracked.name,
          category: { ...classification.category },
          distanceMeters: tracked.distanceMeters,
          rssi: tracked.rssiFiltered,
        });
      }
    }

    return { status: this.incidentLimitReached ? 'TRACKED_INCIDENT_LIMIT' : 'TRACKED', device: tracked };
  }

  getActiveThreats() {
    const now = Date.now();
    return Array.from(this.trackedDevices.values())
      .filter((device) => device.classification.category.score >= 50 &&
        now - Date.parse(device.lastSeen) <= this.activeTimeoutMs)
      .sort((a, b) => b.rssiFiltered - a.rssiFiltered);
  }

  /** Historical suspicious observations remain available after a device expires or changes its name. */
  getRecordedThreats() {
    return Array.from(this.trackedDevices.values())
      .filter((device) => device.highestThreatClassification.category.score >= 50)
      .map((device) => ({
        ...device,
        name: device.highestThreatName,
        classification: device.highestThreatClassification,
      }))
      .sort((a, b) => b.peakRssi - a.peakRssi);
  }
}
