import { MockClassroom } from './mock-classroom.js';

/**
 * Universal Mobile & Web RF Scanner bridge.
 */
export class HardwareScanner {
  constructor(options = {}) {
    this.useSimulation = options.useSimulation ?? true;
    this.simulator = new MockClassroom();
    this.isScanning = false;
    this.scanIntervalId = null;
    this.listeners = [];
  }

  onDeviceDiscovered(callback) {
    this.listeners.push(callback);
  }

  notifyDevice(device) {
    for (const cb of this.listeners) {
      try { cb(device); } catch (_) {}
    }
  }

  /**
   * Starts scanning loop (Simulated or Native Hardware).
   */
  startScan(intervalMs = 800) {
    this.isScanning = true;

    if (this.useSimulation) {
      this.scanIntervalId = setInterval(() => {
        const frame = this.simulator.generateScanFrame();
        for (const item of frame) {
          this.notifyDevice(item);
        }
      }, intervalMs);
    } else if (typeof navigator !== 'undefined' && navigator.bluetooth) {
      // Web Bluetooth API bridge (when supported)
      try {
        navigator.bluetooth.requestLEScan?.({ acceptAllAdvertisements: true });
        navigator.bluetooth.addEventListener?.('advertisementreceived', (event) => {
          this.notifyDevice({
            id: event.device.id,
            name: event.device.name,
            rssi: event.rssi,
            services: event.uuids || [],
          });
        });
      } catch (_) {}
    }
  }

  stopScan() {
    this.isScanning = false;
    if (this.scanIntervalId) {
      clearInterval(this.scanIntervalId);
      this.scanIntervalId = null;
    }
  }

  setTeacherPosition(x, y) {
    if (this.simulator) {
      this.simulator.setTeacherPosition(x, y);
    }
  }
}
