/**
 * Advertised-name hints, not authenticated device identities or proof of misuse.
 * Token boundaries avoid treating unrelated words/product identifiers as matches.
 */
const token = (expression) => new RegExp(`(?:^|[^a-z0-9])(?:${expression})(?=$|[^a-z0-9])`, 'i');

export const SPY_DEVICE_NAMES = Object.freeze([
  token('vip[-_ ]?pro'),
  token('nano[-_ ]?ear'),
  token('spy[-_ ]?(?:mic|ear|box|pen|cam)'),
  token('induction[-_ ]?loop'),
  token('bt[-_ ]?neckloop'),
  token('micro[-_ ]?ear(?:piece)?'),
  token('k5[-_ ]?ear'),
  token('hidden[-_ ]?mic'),
  token('magnetic[-_ ]?earpiece'),
  token('cheating[-_ ]?device'),
]);

export const SMARTWATCH_NAMES = Object.freeze([
  token('apple[-_ ]?watch'),
  token('galaxy[-_ ]?watch'),
  token('amazfit'),
  token('mi[-_ ]?band'),
  token('fitbit'),
  token('huawei[-_ ]?watch'),
  token('garmin[-_ ]?(?:watch|venu|vivoactive|forerunner|fenix|epix|instinct)'),
  token('wear[-_ ]?os'),
  token('smartwatch'),
]);

export const HOTSPOT_SSID_PATTERNS = Object.freeze([
  /(?:^|[^a-z0-9])iphone\s+de(?:\s|$)/i,
  /['\u2019]s\s+iphone(?=$|[^a-z0-9])/i,
  token('android[-_ ]?ap'),
  token('galaxy (?:s\\d+|a\\d+|note)'),
  token('tether(?:ing)?'),
  token('(?:portable[-_ ]?)?hotspot'),
  token('mifi'),
]);

// Bluetooth SIG assigns these to common audio/notification services, not spy devices.
// https://www.bluetooth.com/wp-content/uploads/Files/Specification/HTML/Assigned_Numbers/out/en/index-en.html
export const AUDIO_SERVICE_UUIDS = Object.freeze([
  '0000110b-0000-1000-8000-00805f9b34fb',
  '0000111e-0000-1000-8000-00805f9b34fb',
]);
export const ANCS_SERVICE_UUID = '7905f431-b5ce-4e99-a40f-4b1e122d00d0';

// Kept as an export for compatibility. Membership is only a service hint.
export const SUSPICIOUS_SERVICE_UUIDS = Object.freeze([
  '00001101-0000-1000-8000-00805f9b34fb',
  ...AUDIO_SERVICE_UUIDS,
  ANCS_SERVICE_UUID,
]);
