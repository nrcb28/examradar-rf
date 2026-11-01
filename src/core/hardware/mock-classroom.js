/**
 * Realistic RF simulation engine modeling classroom physics, student desks,
 * and covert electronic cheating devices.
 */

export class MockClassroom {
  constructor() {
    this.teacherPosition = { x: 0.0, y: 0.0 }; // Teacher starting at front podium (meters)
    this.classroomWidth = 8.0;  // 8 meters wide
    this.classroomLength = 10.0; // 10 meters long

    // Virtual student desks and RF transmitters
    this.transmitters = [
      {
        id: 'AA:11:22:33:44:55',
        name: 'VIP-Pro Nano-Ear',
        type: 'BLE',
        services: ['0000110b-0000-1000-8000-00805f9b34fb'],
        desk: 'Pupitre Fila 2, Asiento 3',
        position: { x: 2.0, y: 4.0 },
        txPower: -56,
      },
      {
        id: 'BB:22:33:44:55:66',
        name: 'Apple Watch Ultra',
        type: 'BLE',
        services: ['7905f431-b5ce-4e99-a40f-4b1e122d00d0'],
        desk: 'Pupitre Fila 4, Asiento 1',
        position: { x: 6.0, y: 8.0 },
        txPower: -60,
      },
      {
        id: 'CC:33:44:55:66:77',
        name: 'iPhone de Carlos (Hotspot)',
        type: 'WIFI',
        desk: 'Pupitre Fila 3, Asiento 4',
        position: { x: 5.5, y: 6.0 },
        txPower: -48,
      },
      {
        id: 'DD:44:55:66:77:88',
        name: 'Epson Proyector Aula',
        type: 'BLE',
        services: [],
        desk: 'Techo / Pizarra',
        position: { x: 4.0, y: 1.0 },
        txPower: -62,
      },
    ];
  }

  setTeacherPosition(x, y) {
    this.teacherPosition.x = Math.max(0, Math.min(this.classroomWidth, x));
    this.teacherPosition.y = Math.max(0, Math.min(this.classroomLength, y));
  }

  /**
   * Generates realistic simulated RF scan frames based on current teacher position.
   */
  generateScanFrame() {
    return this.transmitters.map((tx) => {
      const dx = this.teacherPosition.x - tx.position.x;
      const dy = this.teacherPosition.y - tx.position.y;
      const distanceMeters = Math.max(0.3, Math.sqrt(dx * dx + dy * dy));

      // Physics equation: RSSI = TxPower - 10 * n * log10(d) + noise
      const n = 2.6;
      const noise = (Math.random() - 0.5) * 4.0; // +/- 2dBm jitter
      const rawRssi = Math.round(tx.txPower - 10 * n * Math.log10(distanceMeters) + noise);

      return {
        id: tx.id,
        name: tx.name,
        type: tx.type,
        services: tx.services || [],
        rssi: rawRssi,
        simulatedTrueDistance: Math.round(distanceMeters * 100) / 100,
        desk: tx.desk,
      };
    });
  }
}
