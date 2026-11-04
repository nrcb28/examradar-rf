# Security review — 2026-11-04

Scope: source review of commit `74b98d7`, local HTTP abuse tests, automated regression tests and a headless Chrome integration check. The repository has no runtime npm dependencies. No deployed service, radio hardware, native package or historical Git secret audit was tested.

## Findings and fixes

| Finding | Effect in the original code | Correction |
| --- | --- | --- |
| Repository root served over HTTP | `/.git/config`, `/package.json`, server code and any locally placed files were downloadable; server listened on all interfaces by default. | Public assets and browser modules only; loopback binding; dotfile, traversal, symlink and unexpected-host rejection; GET/HEAD only; asynchronous file handling and controlled errors. |
| Unescaped advertised names and metadata | Device names and classifier reasons reached `innerHTML`; report fields reached HTML templates and `document.write`. Crafted input could execute JavaScript in the application/report origin. | DOM text nodes, complete HTML escaping, restrictive CSP, no inline event handlers, no report popup/opener. Reports are downloaded as HTML/JSON. |
| Browser startup failure | A transitive `node:crypto` import could not resolve in the browser and prevented the module entry point from executing. | Browser-compatible asynchronous Web Crypto; Node 22 minimum; HTTP module-graph regression and actual Chrome startup check. |
| Mutable and incompletely covered reports | `incidentEvents` referenced the live session; later scans changed reports after hashing. Some metadata/counts were absent from the hashed payload. | Detached snapshots before awaiting, checksum over every exported field except the hash, deterministic JSON representation, and an explicit verification API. |
| Unsupported authenticity claims | An unkeyed SHA-256 hash was labeled a verified chain of custody/digital signature. | Unsigned-checksum labeling and accurate limitations. This does not add authenticated evidence or a trusted timestamp. |
| Invalid and changing advertisements | Invalid RSSI/services could crash or poison tracking; benign first frames bypassed later classification; Wi-Fi frames were classified as BLE. | Bounded input validation, classification on every frame, Wi-Fi dispatch and suspicious-transition alerts. |
| Stale and misleading observations | Devices stayed active indefinitely; report fields labeled peaks/minima used current readings; restarting could mix exam data. | Live expiry, historical suspicious observations, real peak raw RSSI/minimum estimated distance, and explicit one-exam lifecycle. |
| Unbounded storage | Spoofed identifiers and recurring alerts could grow session memory without limit. | Device/baseline/incident caps, rejection statuses and report flags disclosing incomplete recording. Exhaustion can still prevent new observations. |
| Scanner and audio resource leaks | Repeated starts leaked timers, native scanning survived stop, permission rejection was hidden, audio contexts accumulated and distant clicks were reset before firing. | Awaitable permission-aware scanner lifecycle, cancellation and listener cleanup, reused audio contexts and stable click timers. |
| Mixed content and broad CI token permissions | Capacitor configuration permitted mixed content; workflow token permissions were implicit. | Mixed content disabled; CI token limited to repository read; job timeout and Node 22/24 matrix. Native deployment remains unimplemented. |

## Validation

- `npm test`: 40 passing tests on local Windows with Node 26.13.0.
- HTTP regression requests cover repository internals, percent-encoded traversal, Windows separators/ADS-shaped paths, malformed encodings, NUL, symlink/junction escape, disallowed methods, Host validation, HEAD and continued availability after errors.
- Report tests cover injected HTML, complete-payload tampering, reordered JSON keys, invalid/non-JSON values, snapshot independence and capacity warnings.
- Session tests cover invalid advertisements, Wi-Fi, classification changes, historical measurements, expiry, capacity and lifecycle transitions.
- Scanner tests cover duplicate starts, permission failure, cancellation while permission is pending, late callbacks and complete cleanup. Audio tests cover context reuse and timers.
- Separate headless Chrome smoke test: three simulated suspicious devices including Wi-Fi, movement/audio controls, matching HTML/JSON snapshot downloads, snapshot refresh, Web Crypto verification/tamper rejection, and DOM/report XSS payloads; no page errors.
- CI is configured to repeat unit/regression tests on Linux, Windows and macOS with Node 22 and 24. Results are reported by GitHub Actions on the pull request.

## Remaining limitations

This remains a simulator with an experimental Web Bluetooth wrapper. No native Wi-Fi scanner, passive-earpiece detection, measured bearings, MAC-rotation identity tracking or native Capacitor build exists. Name/service matching does not establish device ownership, authorization or cheating. Scores are heuristics rather than measured probabilities. Calibration is an observed-identifier baseline, not authenticated enrollment. Bluetooth/Wi-Fi identifiers can be spoofed and floods can exhaust configured caps. No authentication/TLS is provided by the local development server. LAN use must be explicitly enabled and browser report hashing still needs a secure context. Downloaded reports contain device identifiers and observations; protect and retain them according to the user's needs.

Implementation references: [MDN: CSP](https://developer.mozilla.org/en-US/docs/Web/Security/Practical_implementation_guides/CSP), [Node.js: Web Crypto](https://nodejs.org/api/webcrypto.html), [Chromium: experimental Bluetooth scanning](https://googlechrome.github.io/samples/web-bluetooth/scan.html).
