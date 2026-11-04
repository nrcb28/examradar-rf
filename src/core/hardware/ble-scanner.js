import { MockClassroom } from './mock-classroom.js';

/** Simulation and experimental Web Bluetooth scanning bridge. */
export class HardwareScanner {
  constructor(options = {}) {
    this.useSimulation = options.useSimulation ?? true;
    this.simulator = new MockClassroom();
    this.isScanning = false;
    this.scanIntervalId = null;
    this.listeners = [];
    this._scanGeneration = 0;
    this._pendingStart = null;
    this._nativeScan = null;
    this._bluetooth = null;
    this._advertisementListener = null;
  }

  onDeviceDiscovered(callback) {
    if (typeof callback !== 'function') throw new TypeError('Device listener must be a function');
    this.listeners.push(callback);
    return () => {
      this.listeners = this.listeners.filter((listener) => listener !== callback);
    };
  }

  notifyDevice(device) {
    const generation = this._scanGeneration;
    for (const cb of this.listeners) {
      if (!this.isScanning || generation !== this._scanGeneration) break;
      try { cb(device); } catch (_) {}
    }
  }

  /**
   * Resolves true once scanning starts, or false if stopped while permission was pending.
   * Native permission/support errors reject so callers can show the actual failure.
   */
  async startScan(intervalMs = 800) {
    if (!Number.isInteger(intervalMs) || intervalMs < 100 || intervalMs > 60000) {
      throw new RangeError('Scan interval must be an integer between 100 and 60000 ms');
    }
    if (this.isScanning) return true;
    if (this._pendingStart) return this._pendingStart;

    const generation = ++this._scanGeneration;
    if (this.useSimulation) {
      this.isScanning = true;
      this.scanIntervalId = setInterval(() => {
        if (!this.isScanning || generation !== this._scanGeneration) return;
        for (const item of this.simulator.generateScanFrame()) {
          if (generation !== this._scanGeneration) break;
          this.notifyDevice(item);
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
        scan.stop();
        return false;
      }

      const listener = (event) => {
        if (!this.isScanning || generation !== this._scanGeneration) return;
        this.notifyDevice({
          id: event.device?.id,
          name: event.name ?? event.device?.name,
          rssi: event.rssi,
          services: event.uuids || [],
        });
      };
      try {
        bluetooth.addEventListener('advertisementreceived', listener);
      } catch (error) {
        scan.stop();
        throw error;
      }
      this._nativeScan = scan;
      this._bluetooth = bluetooth;
      this._advertisementListener = listener;
      this.isScanning = true;
      return true;
    })();
    this._pendingStart = pending;
    try {
      return await pending;
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
    this._nativeScan = null;
    this._bluetooth = null;
    this._advertisementListener = null;
    try {
      if (bluetooth && listener) bluetooth.removeEventListener('advertisementreceived', listener);
    } finally {
      scan?.stop();
    }
  }

  setTeacherPosition(x, y) {
    this.simulator.setTeacherPosition(x, y);
  }
}
