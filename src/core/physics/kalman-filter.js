/**
 * 1D Kalman Filter for smoothing raw, noisy RSSI radiofrequency measurements.
 * Smooths multipath fading and body attenuation noise, with the usual filtering lag.
 */
export class RssiKalmanFilter {
  /**
   * @param {number} processNoise Q - Process noise covariance (defaults to 0.08)
   * @param {number} measurementNoise R - Measurement noise covariance (defaults to 4.0 dBm^2)
   */
  constructor(processNoise = 0.08, measurementNoise = 4.0) {
    if (!Number.isFinite(processNoise) || processNoise < 0 ||
        !Number.isFinite(measurementNoise) || measurementNoise <= 0) {
      throw new RangeError('Kalman noise must be finite with processNoise >= 0 and measurementNoise > 0');
    }
    this.Q = processNoise;
    this.R = measurementNoise;
    this.x = null; // Estimated value (filtered RSSI)
    this.p = 1.0;  // Estimation error covariance
    this.k = 0;    // Kalman gain
  }

  /**
   * Ingests a new raw RSSI observation and returns the filtered estimate.
   * @param {number} rawRssi Measured RSSI in dBm
   * @returns {number} Filtered RSSI in dBm
   */
  filter(rawRssi) {
    if (!Number.isFinite(rawRssi) || rawRssi < -127 || rawRssi >= 0) {
      throw new RangeError('RSSI must be a finite number in [-127, 0) dBm');
    }
    if (this.x === null) {
      this.x = rawRssi;
      return this.x;
    }

    // Scale the covariance terms before addition to avoid Infinity/Infinity for
    // large but finite noise settings. The result is the same Kalman gain.
    const scale = Math.max(this.p, this.Q, this.R);
    const predictedScaled = this.p / scale + this.Q / scale;
    this.k = predictedScaled / (predictedScaled + this.R / scale);

    // 3. Measurement update
    this.x = this.x + this.k * (rawRssi - this.x);
    this.p = this.R * this.k;

    const rounded = Math.round(this.x * 10) / 10;
    return rounded === 0 ? this.x : rounded;
  }

  reset() {
    this.x = null;
    this.p = 1.0;
    this.k = 0;
  }
}
