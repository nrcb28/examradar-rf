/**
 * Physics module implementing the Log-Distance Path Loss model
 * for indoor radiofrequency propagation (BLE 2.4GHz and Wi-Fi).
 */

export const DEFAULT_TX_POWER_1M = -59; // Typical BLE beacon calibrated power at 1 meter (dBm)
export const DEFAULT_PATH_LOSS_EXPONENT = 2.6; // Indoor classroom environment with furniture

export const PROXIMITY_ZONES = Object.freeze({
  IMMEDIATE: { name: 'IMMEDIATE', maxDist: 0.6, label: 'En el cuerpo / Oído / Muñeca', alertLevel: 'CRITICAL' },
  DESK: { name: 'DESK', maxDist: 1.8, label: 'Mismo pupitre', alertLevel: 'HIGH' },
  AISLE: { name: 'AISLE', maxDist: 4.0, label: 'Fila / Pasillo adyacente', alertLevel: 'MEDIUM' },
  FAR: { name: 'FAR', maxDist: Infinity, label: 'Fondo del aula / Exterior', alertLevel: 'LOW' },
});
for (const zone of Object.values(PROXIMITY_ZONES)) Object.freeze(zone);

function isRssi(value) {
  // Zero and +127 are common unavailable-reading sentinels, not close transmitters.
  return Number.isFinite(value) && value >= -127 && value < 0;
}

/**
 * Calculates estimated distance in meters from RSSI value.
 * Equation: d = 10 ^ ((TxPower - RSSI) / (10 * n))
 *
 * @param {number} rssi Current Received Signal Strength Indicator in dBm (e.g. -65)
 * @param {number} txPower Calibrated RSSI at 1 meter (defaults to -59 dBm)
 * @param {number} n Path loss exponent (defaults to 2.6 for indoor classrooms)
 * @returns {number} Estimated distance in meters, or -1 for invalid/unrepresentable measurements
 */
export function rssiToDistance(rssi, txPower = DEFAULT_TX_POWER_1M, n = DEFAULT_PATH_LOSS_EXPONENT) {
  if (!isRssi(rssi) || !isRssi(txPower) || !Number.isFinite(n) || n <= 0) return -1;
  const exponent = (txPower - rssi) / (10 * n);
  const distance = Math.pow(10, exponent);
  const rounded = Math.round(distance * 100) / 100;
  // Extreme calibration values can overflow or round below measurement precision.
  return Number.isFinite(rounded) && rounded > 0 ? rounded : -1;
}

/**
 * Maps an estimated distance to a standardized surveillance zone.
 * @param {number} distance Distance in meters
 * @returns {object} Proximity zone definition
 */
export function getProximityZone(distance) {
  if (!Number.isFinite(distance) || distance <= 0) return PROXIMITY_ZONES.FAR;
  if (distance <= PROXIMITY_ZONES.IMMEDIATE.maxDist) return PROXIMITY_ZONES.IMMEDIATE;
  if (distance <= PROXIMITY_ZONES.DESK.maxDist) return PROXIMITY_ZONES.DESK;
  if (distance <= PROXIMITY_ZONES.AISLE.maxDist) return PROXIMITY_ZONES.AISLE;
  return PROXIMITY_ZONES.FAR;
}

/**
 * Detects whether the teacher is approaching or moving away from a transmitter.
 * @param {number} previousRssi
 * @param {number} currentRssi
 * @returns {'APPROACHING' | 'RECEDING' | 'STATIONARY'}
 */
export function evaluateMovementTrend(previousRssi, currentRssi, thresholdDbm = 3.0) {
  if (!Number.isFinite(thresholdDbm) || thresholdDbm < 0) {
    throw new RangeError('Movement threshold must be a finite, nonnegative number');
  }
  if (!isRssi(previousRssi) || !isRssi(currentRssi)) return 'STATIONARY';
  const delta = currentRssi - previousRssi;
  if (delta > thresholdDbm) return 'APPROACHING';
  if (delta < -thresholdDbm) return 'RECEDING';
  return 'STATIONARY';
}
