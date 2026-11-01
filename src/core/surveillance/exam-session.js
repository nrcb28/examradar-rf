import { classifyBleDevice, classifyWifiNetwork } from '../classifier/classifier-engine.js';
import { RssiKalmanFilter } from '../physics/kalman-filter.js';
import { rssiToDistance, getProximityZone } from '../physics/path-loss.js';

export const SESSION_STATES = {
  IDLE: 'IDLE',
  CALIBRATING: 'CALIBRATING',
  SURVEILLANCE_ACTIVE: 'SURVEILLANCE_ACTIVE',
  COMPLETED: 'COMPLETED',
};

export class ExamSession {
  /**
   * @param {object} options
   * @param {string} options.examName e.g. "Examen Final de Física"
   * @param {string} options.classroom e.g. "Aula Magna 2B"
   * @param {string} options.instructor e.g. "Prof. Riquelme"
   */
  constructor(options = {}) {
    this.id = 'exam_' + Date.now().toString(36);
    this.examName = options.examName || 'Examen Oficial';
    this.classroom = options.classroom || 'Aula 101';
    this.instructor = options.instructor || 'Profesor Vigilante';
    this.state = SESSION_STATES.IDLE;
    this.startTime = null;

    // Baseline authorized devices (registered during calibration)
    this.baselineDeviceIds = new Set();

    // Active tracked devices: id -> { device, filter, lastSeen, history, classification }
    this.trackedDevices = new Map();

    // Incident alerts
    this.incidents = [];
    this.alertListeners = [];
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
    this.state = SESSION_STATES.CALIBRATING;
    this.baselineDeviceIds.clear();
  }

  startExam() {
    this.state = SESSION_STATES.SURVEILLANCE_ACTIVE;
    this.startTime = new Date().toISOString();
  }

  /**
   * Processes a newly discovered raw RF/BLE device transmission.
   * @param {object} rawDevice { id, name, rssi, services }
   */
  ingestDevice(rawDevice) {
    const id = rawDevice.id;

    if (this.state === SESSION_STATES.CALIBRATING) {
      this.baselineDeviceIds.add(id);
      return { status: 'BASELINED', id };
    }

    if (this.state !== SESSION_STATES.SURVEILLANCE_ACTIVE) {
      return { status: 'IGNORED_IDLE', id };
    }

    let tracked = this.trackedDevices.get(id);
    if (!tracked) {
      const filter = new RssiKalmanFilter();
      const classification = classifyBleDevice(rawDevice);

      tracked = {
        id,
        name: rawDevice.name || 'Desconocido',
        classification,
        filter,
        firstSeen: new Date().toISOString(),
        lastSeen: new Date().toISOString(),
        rssiRaw: rawDevice.rssi,
        rssiFiltered: filter.filter(rawDevice.rssi),
        distanceMeters: 0,
        proximityZone: null,
        isNewInExam: !this.baselineDeviceIds.has(id),
      };
      this.trackedDevices.set(id, tracked);

      // Trigger anomaly alert if new suspicious device appears during exam
      if (tracked.isNewInExam && tracked.classification.category.score >= 60) {
        const incident = {
          id: 'inc_' + Date.now().toString(36),
          timestamp: new Date().toISOString(),
          type: 'ANOMALY_NEW_SUSPECT_DEVICE',
          deviceId: id,
          deviceName: tracked.name,
          category: tracked.classification.category,
          reason: tracked.classification.reason,
          rssi: rawDevice.rssi,
        };
        this.incidents.push(incident);
        this.notifyAlert(incident);
      }
    } else {
      // Update existing device
      tracked.rssiRaw = rawDevice.rssi;
      tracked.rssiFiltered = tracked.filter.filter(rawDevice.rssi);
      tracked.lastSeen = new Date().toISOString();
    }

    // Compute distance and proximity zone
    tracked.distanceMeters = rssiToDistance(tracked.rssiFiltered);
    tracked.proximityZone = getProximityZone(tracked.distanceMeters);

    // High proximity alert (within 0.6m of teacher walking down aisles)
    if (tracked.proximityZone.name === 'IMMEDIATE' && tracked.classification.category.score >= 60) {
      const exists = this.incidents.some(
        (inc) => inc.deviceId === id && inc.type === 'PROXIMITY_IMMEDIATE_ALERT' &&
        (Date.now() - new Date(inc.timestamp).getTime() < 10000)
      );
      if (!exists) {
        const alert = {
          id: 'prox_' + Date.now().toString(36),
          timestamp: new Date().toISOString(),
          type: 'PROXIMITY_IMMEDIATE_ALERT',
          deviceId: id,
          deviceName: tracked.name,
          category: tracked.classification.category,
          distanceMeters: tracked.distanceMeters,
          rssi: tracked.rssiFiltered,
        };
        this.incidents.push(alert);
        this.notifyAlert(alert);
      }
    }

    return { status: 'TRACKED', device: tracked };
  }

  getActiveThreats() {
    return Array.from(this.trackedDevices.values())
      .filter((d) => d.classification.category.score >= 50)
      .sort((a, b) => b.rssiFiltered - a.rssiFiltered);
  }
}
