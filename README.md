# 📡 ExamRadar-RF

<p align="center">
  <strong>Mobile Anti-Cheating RF, BLE & Wi-Fi Proximity Radar for Classroom Exam Surveillance</strong><br>
  <em>Designed for Teachers, Proctoring Teams, and Academic Integrity Boards</em>
</p>

<p align="center">
  <a href="https://github.com/nrcb28/examradar-rf/actions/workflows/ci.yml"><img src="https://img.shields.io/badge/build-passing-brightgreen?style=flat-square" alt="Build Status"></a>
  <a href="https://capacitorjs.com"><img src="https://img.shields.io/badge/platform-Android%20%7C%20Apple%20iOS%20%7C%20PWA-blue?style=flat-square" alt="Platform"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-purple?style=flat-square" alt="License"></a>
  <a href="https://github.com/nrcb28/examradar-rf"><img src="https://img.shields.io/badge/tests-12%20passed-success?style=flat-square" alt="Tests"></a>
  <a href="https://github.com/nrcb28/examradar-rf"><img src="https://img.shields.io/badge/PRs-welcome-green.svg?style=flat-square" alt="PRs Welcome"></a>
</p>

---

## ⚡ Overview

With the rapid miniaturization of consumer electronics, academic cheating during examinations has evolved beyond paper notes into **clandestine radiofrequency transmissions**:
- 🎧 **Magnetic Induction Spy Earpieces:** Micro-receivers placed inside the ear canal, powered by Bluetooth neckloops or spy pens.
- ⌚ **Smartwatches & Fitness Bands:** Unauthorized messaging and AI prompt queries disguised as standard digital watches.
- 📶 **Clandestine Wi-Fi Hotspots:** Smartphones sharing cellular data connection (tethering) to secondary cheating devices.

**ExamRadar-RF** is an open-source, mobile-first surveillance application for Android, Apple iOS, and modern web browsers. It equips teachers and proctors with an **interactive radiofrequency radar and acoustic Geiger counter**, enabling them to detect, classify, and pinpoint covert transmitting devices in the classroom.

```
   ┌────────────────────────────────────────────────────────────────────────┐
   │                        EXAMRADAR-RF ENGINE                             │
   │               [Teacher Smartphone: Android / Apple iOS]                │
   └───────────────────────────────────┬────────────────────────────────────┘
                                       │
     ┌─────────────────────────────────┼─────────────────────────────────┐
     ▼                                 ▼                                 ▼
[BLE 2.4GHz & Wi-Fi Radar]   [Heuristic Threat Engine]         [RF Physics Core]
• Continuous RSSI sampling    • Spy Earpieces (Nano-Ear)        • Log-Distance Path Loss
• Covert unnamed beacons      • Smartwatches (WearOS, Apple)    • 1D Kalman Noise Filter
• MAC rotation tracking       • Unauthorized Wi-Fi Tethering    • Proximity Zone Mapping
     │                                 │                                 │
     └─────────────────────────────────┼─────────────────────────────────┘
                                       │
     ┌─────────────────────────────────┴─────────────────────────────────┐
     ▼                                                                   ▼
[Classroom Baseline Mode]                                  [Aisle Geiger Counter]
• Pre-exam calibration                                     • Acoustic discharge clicks
• Instant anomaly alerts (mid-exam spikes)                 • Stealth haptic vibration mode
• Tamper-proof SHA-256 evidence certificate                • Proximity HUD (<0.6m point-blank)
```

---

## 🔬 Physics & Signal Processing Foundations

### 1. Log-Distance Path Loss Propagation Model
Received radiofrequency power indoors follows the log-distance path loss formulation:

$$RSSI = TxPower - 10 \cdot n \cdot \log_{10}(d) + X_\sigma$$

Where:
- $TxPower$: Calibrated signal strength at 1 meter (typically **-59 dBm** for BLE beacons).
- $n$: Indoor path loss exponent ($n = 2.6$ for classrooms with desks, walls, and human body absorption).
- $d$: Distance between teacher's smartphone and transmitting device in meters:

$$d = 10^{\frac{TxPower - RSSI}{10 \cdot n}}$$

### 2. 1D Kalman Noise Filtering
Indoor 2.4 GHz signals suffer from severe multipath fading and body shadowing (human tissue attenuates 2.4 GHz RF). ExamRadar-RF implements a real-time **1D Kalman Filter** to stabilize raw RSSI jitter without introducing latency:

$$\hat{x}_k = \hat{x}^-_k + K_k \cdot (z_k - \hat{x}^-_k)$$

---

## 🎯 Operational Modes

### 1. 🎛️ Baseline Room Calibration (Pre-Exam)
Prior to distributing exam papers, the teacher activates **Calibration Mode** for 60 seconds. The system fingerprints and whitelists authorized ambient devices (e.g. classroom projector, teacher's laptop, building Wi-Fi).

### 2. 🚨 Live Exam Surveillance & Anomaly Alerts
When the exam commences, the app monitors the classroom spectrum. Any newly activated transmitter (e.g. a student turning on an earpiece or smartwatch) immediately triggers a silent notification.

### 3. 🔊 Walking Aisle Geiger Counter & Stealth Mode
As the teacher walks between classroom rows:
- **Acoustic Mode:** Emits synthetic Geiger-Mueller discharge clicks that accelerate exponentially as the teacher approaches the emitting desk.
- **Stealth / Pocket Mode:** Screen goes black and clicks are replaced with discreet haptic vibration pulses, allowing covert aisle patrols without alerting students.

### 4. 📄 Cryptographic Chain of Custody Incident Report
Generates an official, printable forensic report with timestamps, MAC addresses, peak RSSI values, and a **SHA-256 digital signature** for academic disciplinary tribunals.

---

## 📱 Mobile Setup (Android & Apple iOS)

ExamRadar-RF is built on modern web standards wrapped with **Capacitor**, providing 100% native hardware access to Bluetooth Low Energy and Wi-Fi on Android and iOS devices.

### Native Permissions Included:
- **Android (`AndroidManifest.xml`):** `BLUETOOTH_SCAN`, `BLUETOOTH_CONNECT`, `ACCESS_FINE_LOCATION`, `ACCESS_WIFI_STATE`, `VIBRATE`.
- **Apple iOS (`Info.plist`):** `NSBluetoothAlwaysUsageDescription`, `NSLocationWhenInUseUsageDescription`.

### Build Native Mobile Apps:
```bash
# 1. Install dependencies
npm install

# 2. Add Android & iOS native projects
npx cap add android
npx cap add ios

# 3. Open in Android Studio or Xcode
npx cap open android
npx cap open ios
```

---

## 💻 Quick Start & Classroom Simulator

You can run ExamRadar-RF immediately on any computer, tablet, or smartphone:

```bash
# Clone the repository
git clone https://github.com/nrcb28/examradar-rf.git
cd examradar-rf

# Run automated test suite
npm test

# Launch the interactive surveillance studio
npm start
```

Open your browser at **`http://localhost:8080`**. Use the on-screen **Classroom Walking Pad** to simulate walking down aisles and observe the radar and Geiger counter pinpointing hidden spy earpieces!

---

## 🧪 Automated Testing

ExamRadar-RF includes 12 automated unit tests validating RF physics calculations, Kalman filtering, threat signatures, and cryptographic audit hashing:

```bash
npm test
```

---

## 📄 License

Distributed under the **MIT License**. See [`LICENSE`](LICENSE) for more information.

---

<p align="center">
  Crafted with care by <strong><a href="https://github.com/nrcb28">Nicolás Riquelme Lozano</a></strong>
</p>
