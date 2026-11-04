export { rssiToDistance, getProximityZone, evaluateMovementTrend } from './core/physics/path-loss.js';
export { RssiKalmanFilter } from './core/physics/kalman-filter.js';
export { classifyBleDevice, classifyWifiNetwork, THREAT_CATEGORIES } from './core/classifier/classifier-engine.js';
export { GeigerEngine } from './core/audio/geiger-synthesizer.js';
export { ExamSession, SESSION_STATES } from './core/surveillance/exam-session.js';
export { generateIncidentAuditReport, generateHtmlIncidentCertificate, verifyIncidentAuditReport } from './core/surveillance/incident-logger.js';
export { MockClassroom } from './core/hardware/mock-classroom.js';
export { HardwareScanner } from './core/hardware/ble-scanner.js';
