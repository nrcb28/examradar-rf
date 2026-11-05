# Security review — 2026-11-04; expanded 2026-11-05

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

- `npm test`: initially 40 passing tests; expanded to 95 cases (94 pass on Windows; the POSIX FIFO case runs on Linux/macOS) with Node 26.13.0 locally.
- HTTP regression requests cover repository internals, percent-encoded traversal, Windows separators/ADS-shaped paths, malformed encodings, NUL, symlink/junction escape, disallowed methods, Host validation, HEAD and continued availability after errors.
- Report tests cover injected HTML, complete-payload tampering, reordered JSON keys, invalid/non-JSON values, snapshot independence and capacity warnings.
- Session tests cover invalid advertisements, Wi-Fi, classification changes, historical measurements, expiry, capacity and lifecycle transitions.
- Scanner tests cover duplicate starts, permission failure, cancellation while permission is pending, late callbacks and complete cleanup. Audio tests cover context reuse and timers.
- Separate headless Chrome smoke test: three simulated suspicious devices including Wi-Fi, movement/audio controls, matching HTML/JSON snapshot downloads, snapshot refresh, Web Crypto verification/tamper rejection, and DOM/report XSS payloads; no page errors.
- CI is configured to repeat unit/regression tests on Linux, Windows and macOS with Node 22 and 24. Results are reported by GitHub Actions on the pull request.

## Remaining limitations

This remains a simulator with an experimental Web Bluetooth wrapper. No native Wi-Fi scanner, passive-earpiece detection, measured bearings, MAC-rotation identity tracking or native Capacitor build exists. Name/service matching does not establish device ownership, authorization or cheating. Scores are heuristics rather than measured probabilities. Calibration is an observed-identifier baseline, not authenticated enrollment. Bluetooth/Wi-Fi identifiers can be spoofed and floods can exhaust configured caps. No authentication/TLS is provided by the local development server. LAN use must be explicitly enabled and browser report hashing still needs a secure context. Downloaded reports contain device identifiers and observations; protect and retain them according to the user's needs.

Implementation references: [MDN: CSP](https://developer.mozilla.org/en-US/docs/Web/Security/Practical_implementation_guides/CSP), [Node.js: Web Crypto](https://nodejs.org/api/webcrypto.html), [Chromium: experimental Bluetooth scanning](https://googlechrome.github.io/samples/web-bluetooth/scan.html).

## Expanded review

A second pass examines the public physics/classifier APIs, trust boundaries between consumers and session state, hostile JSON processing, privacy, browser lifecycle and the CI supply chain. This extends the initial fixes rather than certifying a deployed product.

| Additional finding | Reproduction or consequence | Correction |
| --- | --- | --- |
| Common Bluetooth services mistaken for spy hardware | Audio Sink/Handsfree alone produced a critical spy-device classification; missing names also triggered suspicious-device alerts. | Separate low-score generic-audio category and low-score unnamed category. ANCS is a notification-accessory hint, not exclusive proof of a smartwatch. Name/service confidence is explicitly heuristic. |
| Overbroad names and inconsistent UUID forms | Unrelated substrings or manufacturer names caused matches; abbreviated UUIDs missed known services. | Token boundaries, reduced ambiguous patterns, Unicode NFKC and equivalent UUID normalization. |
| Invalid numerical inputs | NaN/Infinity, invalid path-loss parameters and extreme covariance could contaminate distance/filter results. | Input guards, safe unavailable-distance handling, validated thresholds and numerically scaled Kalman updates. |
| Shared mutable observations and identifiers | Returned device objects, collections and alerts allowed consumers to rewrite stored observations; identical BLE/Wi-Fi IDs shared state. | Private session state, detached snapshots, immutable configuration and transport namespaces. Changed baseline profiles are re-evaluated. |
| Incident cooldown tied to a growing log | Repeated advertisements scanned the full incident log; reaching capacity could impair alert behavior. | Per-device O(1) cooldown and continued isolated live notifications after storage is full. |
| Arbitrary or oversized checksum envelopes | A matching hash alone did not establish the shape or processing cost of imported data. | Strict versioned schemas, event references, bounded serialization and limits for bytes/depth/nodes/arrays/strings; v1 compatibility remains. |
| Identifiers leaked through export fields | Hiding a primary identifier alone would leave names/reasons/event keys intact. | Optional coherent per-report pseudonyms across observations and events, replacing names and identifying reasons. UI defaults to pseudonyms. Exam metadata remains visible. |
| Unbounded or cross-site HTTP work | Unexpected request bodies, long targets/headers and many open streams could consume resources; arbitrary public JSON files could be served accidentally. | Asset allowlist, origin/fetch-site checks, duplicate Host rejection, body/Expect/upgrade rejection, header/target/file/concurrency/socket limits and idle timeouts. |
| Inline application CSS and opener exposure | Application policy still allowed inline styles; cross-origin browsing-context isolation was absent. | External stylesheet and class-based rendering, strict script/style CSP, same-origin opener policy and restricted unrelated hardware permissions. |
| Native/audio/renderer lifecycle edge cases | Malformed callbacks, listener mutation, rejected async listeners, revoked permission, duplicate RAF loops and late audio resumes caused errors or lingering work. | Bounded immutable scanner events, isolated callbacks, revocation cleanup, generation guards, frame-rate-independent radar, reduced-motion fallback, immediate audio cancellation and handled resume/suspend/close. |
| Aborted HTTP work and special report files | Aborting during filesystem awaits could orphan read streams and bypass request accounting; opening a FIFO as a report could block before file-type validation. | Keep request slots through handle/stream cleanup, check cancellation after awaits, and open report files nonblocking before checking their regular-file type. |
| No static packaging or user-facing verifier | Public assets alone omitted imported modules; users lacked a direct way to verify downloaded JSON. | `npm run build` prepares self-contained browser assets; browser and bounded UTF-8 CLI verification are available. |
| Mutable workflow references | Actions version tags could change without a source diff, and checkout retained credentials. | Verified full-SHA pins, no persisted checkout credentials, constrained permissions, concurrency cancellation, CodeQL for JavaScript/Actions and Dependabot for Actions. |

Expanded validation covers 95 automated test cases, including numerical boundary/monotonicity checks, standard-audio false positives, namespaces, snapshot tampering, schema forgery with recomputed checksums, redaction leaks, permission revocation, audio races, RAF timing, static import graph and CLI file errors. Chrome integration covers pause/resume, completion/reset, five-second calibration, redacted/full downloads, local file verification, strict CSP without console errors, 320px/reduced-motion rendering and an honest no-JavaScript fallback.

The demo UI still consumes fictional advertisements, so the RF-to-XSS sink identified in the initial source review would require untrusted advertisements to be connected to it. The exported HTML API accepts caller data and was hardened independently. This distinction matters when assessing real-world exposure.

Additional primary references: [Bluetooth SIG assigned numbers](https://www.bluetooth.com/wp-content/uploads/Files/Specification/HTML/Assigned_Numbers/out/en/index-en.html), [Web Bluetooth UUID canonicalization](https://webbluetoothcg.github.io/web-bluetooth/), [GitHub secure Actions use](https://docs.github.com/en/actions/reference/security/secure-use).
