/**
 * Acoustic & Haptic Geiger Counter synthesizer for aisle proximity localization.
 * Calculates click frequencies based on transmitter distance or RSSI.
 */

export class GeigerEngine {
  constructor(options = {}) {
    this.audioEnabled = options.audioEnabled ?? false;
    this.hapticEnabled = options.hapticEnabled ?? true;
    this.audioContext = null;
    this.intervalId = null;
    this.currentFrequencyHz = 0; // clicks per second
    this.currentDistanceMeters = null;
  }

  /**
   * Calculates click frequency in Hz (clicks/sec) based on distance in meters.
   * Proximity formula: Frequency increases exponentially as distance drops below 3m.
   * @param {number} distance Distance in meters
   * @returns {number} Frequency in Hz (0 to 30 Hz)
   */
  static calculateClickFrequency(distance) {
    if (distance <= 0 || !Number.isFinite(distance)) return 0;
    if (distance > 4.5) return 0.5; // Ambient background tick
    if (distance > 2.5) return 2.0; // Distant detection
    if (distance > 1.2) return 6.0; // Same row/aisle
    if (distance > 0.5) return 15.0; // Immediate desk
    return 30.0; // Point-blank proximity (< 50 cm, on student)
  }

  /**
   * Initializes Web Audio Context on user gesture.
   */
  initAudio() {
    if (this.audioContext && this.audioContext.state !== 'closed') return this.audioContext;
    if (typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext)) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      this.audioContext = new AudioCtx();
    }
    return this.audioContext;
  }

  /**
   * Synthesizes a single mechanical Geiger-Mueller discharge click.
   */
  playClick() {
    if (!this.audioEnabled || !this.audioContext) return;

    try {
      if (this.audioContext.state === 'suspended') {
        this.audioContext.resume();
      }

      const osc = this.audioContext.createOscillator();
      const gain = this.audioContext.createGain();

      osc.type = 'triangle';
      osc.frequency.setValueAtTime(1400, this.audioContext.currentTime);
      osc.frequency.exponentialRampToValueAtTime(120, this.audioContext.currentTime + 0.015);

      gain.gain.setValueAtTime(0.3, this.audioContext.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, this.audioContext.currentTime + 0.015);

      osc.connect(gain);
      gain.connect(this.audioContext.destination);

      osc.start();
      osc.stop(this.audioContext.currentTime + 0.016);
    } catch (_) {}
  }

  /**
   * Triggers haptic vibration pulse on mobile (Android/iOS).
   */
  triggerHaptic(durationMs = 20) {
    if (!this.hapticEnabled) return;
    if (typeof navigator !== 'undefined' && navigator.vibrate) {
      navigator.vibrate(durationMs);
    }
  }

  /**
   * Updates target distance and adjusts tick cadence.
   * @param {number} distance
   */
  updateDistance(distance) {
    const freq = GeigerEngine.calculateClickFrequency(distance);
    this.currentDistanceMeters = Number.isFinite(distance) && distance > 0 ? distance : null;
    // Preserve the next scheduled click when consecutive scans keep the same cadence.
    if (freq === this.currentFrequencyHz && this.intervalId !== null) return;
    this.currentFrequencyHz = freq;

    if (this.intervalId !== null) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }

    if (freq <= 0) return;

    const intervalMs = Math.round(1000 / freq);
    this.intervalId = setInterval(() => {
      this.playClick();
      if (this.currentDistanceMeters !== null && this.currentDistanceMeters < 1.0) {
        this.triggerHaptic(15);
      }
    }, intervalMs);
  }

  stop() {
    if (this.intervalId !== null) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    this.currentFrequencyHz = 0;
    this.currentDistanceMeters = null;
  }
}
