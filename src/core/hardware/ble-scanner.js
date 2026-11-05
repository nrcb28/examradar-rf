import { MockClassroom } from './mock-classroom.js';

function deviceSnapshot(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const { id, rssi, name = '', services = [] } = raw;
  if (typeof id !== 'string' || !id.trim() || id.length > 256 ||
      typeof name !== 'string' || name.length > 256 ||
      !Number.isFinite(rssi) || rssi < -127 || rssi >= 0 ||
      !Array.isArray(services) || services.length > 64 ||
      [...services].some(value => typeof value !== 'string' || value.length > 64)) return null;
  const snapshot = { id: id.trim(), name, rssi, services: Object.freeze([...services]) };
  if (raw.type === 'BLE' || raw.type === 'WIFI') snapshot.type = raw.type;
  if (typeof raw.ssid === 'string' && raw.ssid.length <= 256) snapshot.ssid = raw.ssid;
  if (typeof raw.desk === 'string' && raw.desk.length <= 256) snapshot.desk = raw.desk;
  if (Number.isFinite(raw.simulatedTrueDistance)) snapshot.simulatedTrueDistance = raw.simulatedTrueDistance;
  return Object.freeze(snapshot);
}

/** Simulation and experimental Web Bluetooth scanning bridge. */
export class HardwareScanner {
  constructor(options = {}) {
    if (!options || typeof options !== 'object' || Array.isArray(options) ||
        (options.useSimulation !== undefined && typeof options.useSimulation !== 'boolean')) {
      throw new TypeError('Scanner options must contain a boolean useSimulation');
    }
    this.useSimulation = options.useSimulation ?? true;
    this.simulator = new MockClassroom();
    this.isScanning = false;
    this.scanIntervalId = null;
    this.listeners = new Set();
    this.lastError = null;
    this._scanGeneration = 0;
    this._pendingStart = null;
    this._nativeScan = null;
    this._bluetooth = null;
    this._advertisementListener = null;
    this._availabilityListener = null;
  }

  onDeviceDiscovered(callback) {
    if (typeof callback !== 'function') throw new TypeError('Device listener must be a function');
    if (!this.listeners.has(callback) && this.listeners.size >= 100) throw new RangeError('Too many device listeners');
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  notifyDevice(device) {
    let snapshot;
    try { snapshot = deviceSnapshot(device); } catch { return false; }
    if (!snapshot || !this.isScanning) return false;
    const generation = this._scanGeneration;
    for (const cb of [...this.listeners]) {
      if (!this.isScanning || generation !== this._scanGeneration) break;
      if (!this.listeners.has(cb)) continue;
      try { Promise.resolve(cb(snapshot)).catch(() => {}); } catch (_) {}
    }
    return true;
  }

  /**
   * Resolves true once scanning starts, or false if stopped while permission was pending.
   * Native permission/support errors reject so callers can show the actual failure.
   */
  async startScan(intervalMs = 800) {
    if (!Number.isInteger(intervalMs) || intervalMs < 100 || intervalMs > 60000) {
      throw new RangeError('Scan interval must be an integer between 100 and 60000 ms');
    }
    if (this.isScanning && this._nativeScan?.active === false) this.stopScan();
    if (this.isScanning) return true;
    if (this._pendingStart) return this._pendingStart;

    const generation = ++this._scanGeneration;
    this.lastError = null;
    if (this.useSimulation) {
      this.isScanning = true;
      this.scanIntervalId = setInterval(() => {
        if (!this.isScanning || generation !== this._scanGeneration) return;
        try {
          for (const item of this.simulator.generateScanFrame()) {
            if (generation !== this._scanGeneration) break;
            this.notifyDevice(item);
          }
        } catch (error) {
          this.stopScan();
          this.lastError = error;
        }
      }, intervalMs);
      return true;
    }

    const bluetooth = globalThis.navigator?.bluetooth;
    if (typeof bluetooth?.requestLEScan !== 'function' ||
        typeof bluetooth.addEventListener !== 'function' ||
        typeof bluetooth.removeEventListener !== 'function') {
      throw new Error('Web Bluetooth LE scanning is not supported by this browser');
    }

    const pending = (async () => {
      const scan = await bluetooth.requestLEScan({
        acceptAllAdvertisements: true,
        keepRepeatedDevices: true,
      });
      if (!scan || typeof scan.stop !== 'function') {
        throw new Error('Bluetooth adapter did not return a valid scan');
      }
      if (generation !== this._scanGeneration) {
        try { scan.stop(); } catch (_) {}
        return false;
      }
      if (scan.active === false) {
        try { scan.stop(); } catch (_) {}
        throw new Error('Bluetooth scan is no longer active');
      }

      const listener = (event) => {
        if (!this.isScanning || generation !== this._scanGeneration) return;
        if (scan.active === false) return scanEnded();
        try {
          this.notifyDevice({
            id: event?.device?.id,
            name: event?.name ?? event?.device?.name ?? '',
            rssi: event?.rssi,
            services: event?.uuids ?? [],
          });
        } catch (_) {} // Ignore malformed adapter events, never interrupt the scan loop.
      };
      const scanEnded = () => {
        if (generation !== this._scanGeneration) return;
        this.stopScan();
        this.lastError = new Error('Bluetooth scanning stopped or permission was revoked');
      };
      const availabilityListener = event => {
        try { if (event?.value === false) scanEnded(); } catch (_) {}
      };
      try {
        bluetooth.addEventListener('advertisementreceived', listener);
        bluetooth.addEventListener('availabilitychanged', availabilityListener);
      } catch (error) {
        try { bluetooth.removeEventListener('advertisementreceived', listener); } catch (_) {}
        try { bluetooth.removeEventListener('availabilitychanged', availabilityListener); } catch (_) {}
        try { scan.stop(); } catch (_) {}
        throw error;
      }
      this._nativeScan = scan;
      this._bluetooth = bluetooth;
      this._advertisementListener = listener;
      this._availabilityListener = availabilityListener;
      this.isScanning = true;
      this.scanIntervalId = setInterval(() => {
        if (scan.active === false) scanEnded();
      }, intervalMs);
      return true;
    })();
    this._pendingStart = pending;
    try {
      return await pending;
    } catch (error) {
      if (generation === this._scanGeneration) {
        this.stopScan();
        this.lastError = error;
      }
      throw error;
    } finally {
      if (this._pendingStart === pending) this._pendingStart = null;
    }
  }

  stopScan() {
    ++this._scanGeneration;
    this.isScanning = false;
    this._pendingStart = null;
    if (this.scanIntervalId !== null) {
      clearInterval(this.scanIntervalId);
      this.scanIntervalId = null;
    }
    const scan = this._nativeScan;
    const bluetooth = this._bluetooth;
    const listener = this._advertisementListener;
    const availabilityListener = this._availabilityListener;
    this._nativeScan = null;
    this._bluetooth = null;
    this._advertisementListener = null;
    this._availabilityListener = null;
    // Cleanup remains idempotent even if an adapter throws after permission revocation.
    try { if (bluetooth && listener) bluetooth.removeEventListener('advertisementreceived', listener); } catch (_) {}
    try { if (bluetooth && availabilityListener) bluetooth.removeEventListener('availabilitychanged', availabilityListener); } catch (_) {}
    try { scan?.stop(); } catch (error) { this.lastError = error; }
  }

  setTeacherPosition(x, y) {
    this.simulator.setTeacherPosition(x, y);
  }
}
