/**
 * Threat signature database for unauthorized exam communication devices.
 */

export const SPY_DEVICE_NAMES = [
  /vip[-_ ]?pro/i,
  /nano[-_ ]?ear/i,
  /spy[-_ ]?(mic|ear|box|pen|cam)/i,
  /induction[-_ ]?loop/i,
  /bt[-_ ]?neckloop/i,
  /micro[-_ ]?ear/i,
  /a680/i,
  /k5[-_ ]?ear/i,
  /hidden[-_ ]?mic/i,
  /magnetic[-_ ]?earpiece/i,
  /cheating[-_ ]?device/i,
];

export const SMARTWATCH_NAMES = [
  /apple[-_ ]?watch/i,
  /galaxy[-_ ]?watch/i,
  /amazfit/i,
  /mi[-_ ]?band/i,
  /fitbit/i,
  /huawei[-_ ]?watch/i,
  /garmin/i,
  /wear[-_ ]?os/i,
  /smartwatch/i,
];

export const HOTSPOT_SSID_PATTERNS = [
  /iphone (de|'s)/i,
  /android[-_ ]?ap/i,
  /galaxy (s\d+|a\d+|note)/i,
  /redmi/i,
  /xiaomi/i,
  /tether/i,
  /portable[-_ ]?hotspot/i,
  /mifi/i,
  /huawei[-_ ]?p\d+/i,
];

export const SUSPICIOUS_SERVICE_UUIDS = [
  // Serial Port Profile (often used by custom micro-controllers / Arduino spy relays)
  '00001101-0000-1000-8000-00805f9b34fb',
  // Audio Sink / Handsfree
  '0000110b-0000-1000-8000-00805f9b34fb',
  '0000111e-0000-1000-8000-00805f9b34fb',
  // Apple Notification Center Service (ANCS) - Smartwatches
  '7905f431-b5ce-4e99-a40f-4b1e122d00d0',
];
