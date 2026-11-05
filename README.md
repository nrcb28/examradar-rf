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

Pause/resume or complete a session with the session controls. **Nueva simulación** clears its observations and report snapshot. **Calibrar aula · 5 s** starts a new baseline session, then begins surveillance; pausing also pauses the calibration countdown. Sound and vibration start disabled. Reduced-motion preferences, keyboard focus, small screens and a no-JavaScript explanation are supported.

The development server binds to `127.0.0.1` by default. In PowerShell, set `$env:PORT = '8081'` to change its port. Explicitly setting `$env:HOST = '0.0.0.0'` exposes the simulator to the network. There is no authentication or TLS: use a trusted network for that mode. Web Crypto report export requires localhost or HTTPS in browsers; plain HTTP over a LAN is insufficient.

## What is implemented

- Simulated BLE and Wi-Fi advertisements, classroom movement and a canvas radar.
- Heuristic name/service classification. Wi-Fi frames use the Wi-Fi classifier.
- UUID normalization accepts common 16/32/128-bit representations. Standard audio services and a missing advertised name do not, by themselves, trigger suspicious-device alerts. Name matching uses Unicode normalization and token boundaries to reduce accidental matches.
- Log-distance RSSI estimates and Kalman filtering.
- Calibration, one exam per session, stale-device expiry and historical observations.
- Bounded input, device and incident storage, with explicit rejection statuses and report flags when capacity is reached.
- Audio/haptic proximity feedback.
- Escaped HTML reports and detached JSON snapshots with a verifiable SHA-256 checksum.
- Per-report pseudonyms for device identifiers/names, enabled by default in the UI, plus local JSON verification in the browser or command line.
- An experimental Web Bluetooth scanner wrapper. `await scanner.startScan()` reports permission and support failures; `stopScan()` releases the scan and listener. Availability depends on browser support and permissions. It is not wired into the demo UI.

## Limits

Advertised names, services and identifiers can be spoofed. Signature scores are heuristics, not calibrated probabilities. RSSI distances are rough estimates; the radar angles are illustrative, not measured bearings. A detected device is not evidence of cheating or proof of who owns it. The simulator cannot detect passive magnetic earpieces or perform general RF spectrum analysis.

There is no implemented native Wi-Fi scanner, MAC rotation tracking, native Android/iOS project, or installed Capacitor/Bluetooth plugin. `capacitor.config.json` is a starting configuration, not a working native build or proof that platform permissions have been installed. `npm run build` prepares the browser assets in `dist/`, which is also the configured Capacitor web directory. A mobile package still needs platform-specific integrations, dependencies and device testing. Mixed HTTP content is disabled in the configuration.

Calibration records observed identifiers/profiles as a baseline; presence is not authorization and does not establish a trusted identity. BLE and Wi-Fi identities have separate namespaces. New-device alerts are suppressed for unchanged baseline profiles; a changed suspicious profile and immediate-proximity observations can still alert. Devices expire from the live radar after 15 seconds by default but remain in the historical report. A completed session must be replaced with a new `ExamSession` for the next exam.

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
const report = await generateIncidentAuditReport(session, { redactIdentifiers: true });
console.log(await verifyIncidentAuditReport(report)); // true
report.sessionMetadata.examName = 'Changed';
console.log(await verifyIncidentAuditReport(report)); // false
```

The checksum covers all exported JSON data except the hash itself, using sorted object keys and preserved array order. Snapshots do not change as scanning continues. Reports retain historical suspicious classifications, peak raw RSSI and minimum estimated distance, including devices no longer active.

Version 2 reports contain a `privacy` descriptor. Redaction gives each BLE/Wi-Fi identity a random, consistent alias within one report, replacing identifiers, advertised names and identifying classifier reasons in both observations and incident events. A new report gets new aliases. Exam, classroom, instructor and measurement metadata remain: this is pseudonymization, not anonymization. The library defaults to full identifiers for compatibility; the demo UI defaults to redaction. Verification also accepts the complete version 1 schema.

Use the file selector in **Comprobar un informe JSON** for verification entirely in the browser, or run:

```sh
npm run verify -- path/to/report.json
```

The CLI exits with 0 for a matching schema/checksum, 1 for an invalid or altered report, and 2 for usage, unreadable, malformed or oversized file errors. JSON files are limited to 5 MiB; the canonical data also has limits of 32 levels, 100,000 values, 5,000 elements per array and 4,096 characters per string. Unknown schema fields, invalid references and oversized structures are rejected even if a checksum has been recomputed. `REPORT_LIMITS` is exported for callers.

**This is an unsigned checksum, not a digital signature or a verified chain of custody.** Anyone who changes a report can recompute the hash. Keep the original JSON and a separately trusted reference hash to detect later changes. The HTML is a printable summary; verify the JSON with `verifyIncidentAuditReport()`.

Default and maximum session capacities are 1,000 tracked devices, 1,000 baseline identifiers and 5,000 incidents. Configure smaller `maxDevices`, `maxBaselineDevices` or `maxIncidents` values, or set `activeTimeoutMs` up to one hour. Exhaustion rejects additional identifiers or caps incident recording; live alert notifications continue with `recorded: false`, and proximity alerts remain rate-limited. Inspect ingestion statuses and the `deviceLimitReached`, `baselineLimitReached` and `incidentLimitReached` flags. A flood of spoofed identifiers can still exhaust these limits.

Collection getters, observation results and listener payloads are detached snapshots. Session metadata, limits and lifecycle cannot be reassigned. `getTrackedDevice(id, type)` reads an observation; collection snapshot keys use `BLE:<id>` or `WIFI:<id>`. `onAlert()` returns an unsubscribe function. Use the O(1) counters `totalDevicesScanned`, `totalBaselineDevices` and `totalIncidentEvents` for status displays.

## Static build

```sh
npm run build
```

Serve `dist/` at the origin root through a static host with HTTPS. The build includes public assets and browser modules, excluding the development server, CLI, tests and repository metadata. It rejects symlink inputs and only replaces this checkout's generated `dist/` directory. A meta CSP accompanies the assets; configure HTTP `frame-ancestors 'none'` and other response security headers on your static host as well. No production hosting or native deployment is included.

## Security and tests

The static server serves an explicit list of public assets and browser JavaScript modules only. It rejects repository internals, dotfiles, traversal, symlink aliases, request bodies, unexpected origins/hostnames and unsupported methods. Headers are capped at 8 KiB, request targets at 2,048 characters, served files at 2 MiB, simultaneous requests at 64 and sockets at 128. These are development safeguards, not a guarantee against denial of service. CSP allows neither inline scripts nor inline application styles. All processing is in memory; downloading reports stores observations on the user's computer.

`npm test` runs the unit and security regression tests, including static packaging and CLI checks. CI uses Linux, Windows and macOS with Node 22 and 24. Actions are pinned to verified commit SHAs and checkout credentials are not retained. CodeQL scans JavaScript and Actions workflows; Dependabot proposes updates to Actions. See [SECURITY_REVIEW.md](SECURITY_REVIEW.md) for findings and [SECURITY.md](SECURITY.md) for reporting guidance. This review is not a penetration test of a deployed service or native device.

## License

MIT. See [LICENSE](LICENSE).
