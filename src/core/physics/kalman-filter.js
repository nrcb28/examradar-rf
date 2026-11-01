/**
 * 1D Kalman Filter for smoothing raw, noisy RSSI radiofrequency measurements.
 * Stabilizes multipath fading and body attenuation noise without lag.
 */
export class RssiKalmanFilter {
  /**
   * @param {number} processNoise Q - Process noise covariance (defaults to 0.08)
   * @param {number} measurementNoise R - Measurement noise covariance (defaults to 4.0 dBm^2)
   */
  constructor(processNoise = 0.08, measurementNoise = 4.0) {
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
    if (this.x === null) {
      this.x = rawRssi;
      return this.x;
    }

    // 1. Prediction step
    const pPredict = this.p + this.Q;

    // 2. Kalman Gain calculation
    this.k = pPredict / (pPredict + this.R);

    // 3. Measurement update
    this.x = this.x + this.k * (rawRssi - this.x);
    this.p = (1 - this.k) * pPredict;

    return Math.round(this.x * 10) / 10;
  }

  reset() {
    this.x = null;
    this.p = 1.0;
    this.k = 0;
  }
}
