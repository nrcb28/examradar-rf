import { open } from 'node:fs/promises';
import { constants } from 'node:fs';
import { REPORT_LIMITS } from './core/surveillance/incident-logger.js';

/** Read a regular UTF-8 report file without trusting its advertised size. */
export async function readIncidentReport(filename) {
  // A FIFO must not block in open() before its non-regular type can be checked.
  const file = await open(filename, constants.O_RDONLY | (constants.O_NONBLOCK ?? 0));
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.size > REPORT_LIMITS.maxBytes) throw new RangeError('Report must be a regular file of at most 5 MiB');
    const buffer = Buffer.alloc(REPORT_LIMITS.maxBytes + 1);
    let length = 0;
    while (length < buffer.length) {
      const { bytesRead } = await file.read(buffer, length, buffer.length - length, length);
      if (!bytesRead) break;
      length += bytesRead;
    }
    if (length > REPORT_LIMITS.maxBytes) throw new RangeError('Report exceeds 5 MiB');
    const text = new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, length));
    return JSON.parse(text.replace(/^\uFEFF/, ''));
  } finally { await file.close(); }
}
