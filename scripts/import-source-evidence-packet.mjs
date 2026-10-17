#!/usr/bin/env node
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FILES, importPacket, writeImport } from './source-evidence/import.mjs';
import { curateIdentitySection, phase2ImportGate, phase5Gate } from './source-evidence/phase-gates.mjs';
import { validatePacket } from './source-evidence/validate.mjs';

const USAGE = `Usage:
  node scripts/import-source-evidence-packet.mjs --packet <dir> --out <dir> [--min-verification human-reviewed|source-verified|independently-verified] [--check-gates]
  node scripts/import-source-evidence-packet.mjs --packet <dir> --validate-only

Offline, deterministic import of a Diggypaper source-evidence-packet/0.1.0 into a Phase 2 cluster
package plus an immutable lineage sidecar. Opt-in: nothing in the native evidence-gathering flow calls it.
Exit codes: 0 imported (or valid), 1 packet refused, 2 usage error.`;

function parse(argv) {
  const options = { minVerification: 'human-reviewed' };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const value = () => {
      i += 1;
      if (i >= argv.length || argv[i].startsWith('--')) throw new Error(`${arg} requires a value`);
      return argv[i];
    };
    if (arg === '--packet') options.packet = value();
    else if (arg === '--out') options.out = value();
    else if (arg === '--min-verification') options.minVerification = value();
    else if (arg === '--check-gates') options.checkGates = true;
    else if (arg === '--validate-only') options.validateOnly = true;
    else if (arg === '--help' || arg === '-h') options.help = true;
    else throw new Error(`unknown argument ${arg}`);
  }
  return options;
}

export function main(argv, io = { out: (s) => process.stdout.write(s), err: (s) => process.stderr.write(s) }) {
  let options;
  try { options = parse(argv); } catch (error) {
    io.err(`error: ${error.message}\n${USAGE}\n`);
    return 2;
  }
  if (options.help) { io.out(`${USAGE}\n`); return 0; }
  if (!options.packet || (!options.out && !options.validateOnly)) {
    io.err(`error: --packet and --out (or --validate-only) are required\n${USAGE}\n`);
    return 2;
  }
  if (options.validateOnly) {
    const { packet, ...summary } = validatePacket(options.packet);
    io.out(`${JSON.stringify(summary, null, 2)}\n`);
    return summary.valid ? 0 : 1;
  }
  let result;
  try { result = importPacket(options.packet, { minVerification: options.minVerification }); } catch (error) {
    io.err(`error: ${error.message}\n`);
    return 2;
  }
  if (!result.ok) {
    const { packet, ...summary } = result.validation;
    io.err(`packet refused; nothing was written\n${JSON.stringify(summary, null, 2)}\n`);
    return 1;
  }
  let gates;
  if (options.checkGates) {
    const lineageBytes = Buffer.from(result.outputs[FILES.lineage], 'utf8');
    const section = curateIdentitySection(result.phase2);
    const { exempt, ...phase2Import } = phase2ImportGate(result.phase2, lineageBytes);
    gates = {
      phase2_import: { ...phase2Import, exempt_checks: exempt.map((e) => e.check) },
      phase5: phase5Gate([section], [result.phase2], { [result.phase2.evidence_artifact_id]: lineageBytes }),
    };
  }
  try { writeImport(options.out, result); } catch (error) {
    io.err(`error: ${error.message}\n`);
    return 1;
  }
  const { counts } = result.report;
  io.out(`${JSON.stringify({ out: options.out, packet_id: result.report.packet.packet_id, findings: counts.findings, by_reason: counts.by_reason, ...(gates ? { gates } : {}) }, null, 2)}\n`);
  return gates && Object.values(gates).some((g) => g.gate !== 'pass') ? 1 : 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
