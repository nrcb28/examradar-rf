# ExamRadar-RF

RF proximity and device classification **simulator**, written in dependency-free JavaScript. The web interface uses fictional classroom transmitters; it does not scan nearby hardware.

## Run

Requires Node.js 22 or newer. No npm dependencies need to be installed.

```sh
git clone https://github.com/nrcb28/examradar-rf.git
cd examradar-rf
npm test
npm start
```

Open `http://127.0.0.1:8080`. Move the simulated instructor with the walking controls, enable audio or haptics, and download HTML and JSON reports. Both downloads use the same snapshot; select **Actualizar captura del informe** before exporting new observations.

The development server binds to `127.0.0.1` by default. In PowerShell, set `$env:PORT = '8081'` to change its port. Explicitly setting `$env:HOST = '0.0.0.0'` exposes the simulator to the network. There is no authentication or TLS: use a trusted network for that mode. Web Crypto report export requires localhost or HTTPS in browsers; plain HTTP over a LAN is insufficient.

## What is implemented

- Simulated BLE and Wi-Fi advertisements, classroom movement and a canvas radar.
- Heuristic name/service classification. Wi-Fi frames use the Wi-Fi classifier.
- Log-distance RSSI estimates and Kalman filtering.
- Calibration, one exam per session, stale-device expiry and historical observations.
- Bounded input, device and incident storage, with explicit rejection statuses and report flags when capacity is reached.
- Audio/haptic proximity feedback.
- Escaped HTML reports and detached JSON snapshots with a verifiable SHA-256 checksum.
- An experimental Web Bluetooth scanner wrapper. `await scanner.startScan()` reports permission and support failures; `stopScan()` releases the scan and listener. Availability depends on browser support and permissions. It is not wired into the demo UI.

## Limits

Advertised names, services and identifiers can be spoofed. Signature scores are heuristics, not calibrated probabilities. RSSI distances are rough estimates; the radar angles are illustrative, not measured bearings. A detected device is not evidence of cheating or proof of who owns it. The simulator cannot detect passive magnetic earpieces or perform general RF spectrum analysis.

There is no implemented native Wi-Fi scanner, MAC rotation tracking, native Android/iOS project, or installed Capacitor/Bluetooth plugin. `capacitor.config.json` is a starting configuration, not a working native build or proof that platform permissions have been installed. A mobile package still needs a build step that bundles the browser modules with the public assets, platform-specific integrations and device testing. Mixed HTTP content is disabled in the configuration.

Calibration records observed identifiers as a baseline; presence is not authorization and does not establish a trusted device identity. New-device alerts are suppressed for baseline identifiers, while suspicious classification changes and immediate-proximity alerts remain possible. Devices expire from the live radar after 15 seconds by default but remain in the historical report. A completed session must be replaced with a new `ExamSession` for the next exam.

## Reports and verification

Report generation is asynchronous and uses Web Crypto in Node and secure browser contexts:

```js
import {
  ExamSession,
  generateIncidentAuditReport,
  verifyIncidentAuditReport,
} from './src/index.js';

const session = new ExamSession({ examName: 'Demo' });
session.startExam();
session.ingestDevice({ id: 'demo-1', name: 'Demo Watch', rssi: -65 });
const report = await generateIncidentAuditReport(session);
console.log(await verifyIncidentAuditReport(report)); // true
report.sessionMetadata.examName = 'Changed';
console.log(await verifyIncidentAuditReport(report)); // false
```

The checksum covers all exported JSON data except the hash itself, using sorted object keys and preserved array order. Snapshots do not change as scanning continues. Reports retain historical suspicious classifications, peak raw RSSI and minimum estimated distance, including devices no longer active.

**This is an unsigned checksum, not a digital signature or a verified chain of custody.** Anyone who changes a report can recompute the hash. Keep the original JSON and a separately trusted reference hash to detect later changes. The HTML is a printable summary; verify the JSON with `verifyIncidentAuditReport()`.

Default session limits are 1,000 tracked devices, 1,000 baseline identifiers and 5,000 incidents. Configure `maxDevices`, `maxBaselineDevices`, `maxIncidents` and `activeTimeoutMs` in the constructor. Exhaustion rejects additional identifiers or caps incident recording; it does not silently discard historical records. Inspect ingestion statuses and the `deviceLimitReached`, `baselineLimitReached` and `incidentLimitReached` flags. A flood of spoofed identifiers can still exhaust these limits.

## Security and tests

The static server serves public assets and browser JavaScript modules only. It rejects repository internals, dotfiles, traversal, symlink aliases, unsupported methods and unexpected hostnames, and supplies restrictive security headers. All processing is in memory; downloading reports stores device observations on the user's computer.

`npm test` runs the unit and security regression tests. CI runs them on Linux, Windows and macOS with Node 22 and 24. See [SECURITY_REVIEW.md](SECURITY_REVIEW.md) for fixes, verification scope and remaining limitations. This review is not a penetration test of a deployed service or native device.

## License

MIT. See [LICENSE](LICENSE).
