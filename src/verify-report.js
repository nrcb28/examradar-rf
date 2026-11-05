import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { readIncidentReport } from './report-file.js';
import { verifyIncidentAuditReport } from './core/surveillance/incident-logger.js';

export async function runReportVerification(args, output = console) {
  if (args.length === 1 && ['--help', '-h'].includes(args[0])) {
    output.log('Usage: npm run verify -- report.json\nExit codes: 0 valid checksum/schema; 1 invalid; 2 unreadable or oversized file.');
    return 0;
  }
  if (args.length !== 1) { output.error('Usage: npm run verify -- report.json'); return 2; }
  try {
    const report = await readIncidentReport(args[0]);
    if (!await verifyIncidentAuditReport(report)) { output.error('INVALID: report structure or SHA-256 checksum does not match.'); return 1; }
    output.log('VALID: report structure and SHA-256 checksum match. This does not authenticate its author.');
    return 0;
  } catch {
    output.error('Cannot read report: expected a UTF-8 JSON file of at most 5 MiB.');
    return 2;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  process.exitCode = await runReportVerification(process.argv.slice(2));
}
