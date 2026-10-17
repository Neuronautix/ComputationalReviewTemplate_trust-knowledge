#!/usr/bin/env node

// Runs the real ORAtlas contracts + extractKnowledgeWithOutcomes against an
// export directory and fails on any unexpected skipped, invalid or dropped record.
// Needs a dependency-installed ORAtlas checkout at ORATLAS_PINNED_COMMIT:
//   git clone https://github.com/dhuzard/oratlas && git -C oratlas checkout <pin>
//   (cd oratlas && pnpm install --frozen-lockfile --ignore-scripts)

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from '../release-artifacts/lib.mjs';
import { ORATLAS_PINNED_COMMIT, CLAIM_TYPES, RELATION_TYPES, REVIEW_TYPES } from './contract-pin.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

export function oratlasHead(oratlasDir) {
  try {
    return execFileSync('git', ['-C', oratlasDir, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  } catch {
    return null;
  }
}

export function oratlasAvailable(oratlasDir) {
  return Boolean(oratlasDir) && existsSync(join(oratlasDir, 'node_modules/.bin/tsx')) && existsSync(join(oratlasDir, 'packages/extractor/node_modules'));
}

// Fails if the local contract mirror drifted from the checked-out ORAtlas enums.
export function mirrorDrift(oratlasDir) {
  const enums = readFileSync(join(oratlasDir, 'packages/contracts/src/enums.ts'), 'utf8');
  const listed = (name) => {
    const match = enums.match(new RegExp(`export const ${name} = \\[([\\s\\S]*?)\\] as const`, 'u'));
    return match ? [...match[1].matchAll(/"([^"]+)"/gu)].map((item) => item[1]) : null;
  };
  const drift = [];
  for (const [name, mirror] of [['CLAIM_TYPES', CLAIM_TYPES], ['CLAIM_EVIDENCE_RELATION_TYPES', RELATION_TYPES], ['REVIEW_TYPES', REVIEW_TYPES]]) {
    if (JSON.stringify(listed(name)) !== JSON.stringify(mirror)) drift.push(name);
  }
  return drift;
}

export function runOratlasExtractor(oratlasDir, exportDir) {
  const tsx = join(resolve(oratlasDir), 'node_modules/.bin/tsx');
  const output = execFileSync(tsx, [join(HERE, 'oratlas-runner.mts'), resolve(oratlasDir), resolve(exportDir)], {
    cwd: resolve(oratlasDir),
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  return JSON.parse(output.trim().split('\n').pop());
}

// Returns problems; empty means ORAtlas ingested every record with nothing dropped.
export function oratlasProblems(result, expected) {
  if (!result.manifestOk) return result.errors.map((error) => `manifest rejected by ORAtlas: ${error}`);
  const problems = [];
  for (const kind of ['claims', 'citations', 'relations']) {
    const outcome = result.outcomes[kind];
    if (outcome.status !== 'loaded') problems.push(`${kind}: outcome ${outcome.status}`);
    if (outcome.skippedCount !== 0) problems.push(`${kind}: ${outcome.skippedCount} skipped`);
    if (result.counts[kind] !== expected[kind]) problems.push(`${kind}: loaded ${result.counts[kind]}, expected ${expected[kind]}`);
  }
  if (result.counts.trust !== 0 || result.outcomes.trust.status !== 'not-declared') problems.push('trust: ORAtlas must not receive any trust assessment records');
  if (result.warnings.length > 0) problems.push(...result.warnings.map((warning) => `warning: ${warning}`));
  return problems;
}

function main() {
  const args = parseArgs(process.argv.slice(2), ['oratlas-dir', 'directory']);
  const head = oratlasHead(args['oratlas-dir']);
  if (head !== ORATLAS_PINNED_COMMIT) {
    process.stderr.write(`ORAtlas checkout is at ${head}, expected pinned ${ORATLAS_PINNED_COMMIT}\n`);
    process.exit(2);
  }
  const drift = mirrorDrift(args['oratlas-dir']);
  if (drift.length > 0) {
    process.stderr.write(`contract mirror drift: ${drift.join(', ')}\n`);
    process.exit(1);
  }
  const report = JSON.parse(readFileSync(join(args.directory, 'knowledge/oratlas/compatibility-report.json'), 'utf8'));
  const result = runOratlasExtractor(args['oratlas-dir'], args.directory);
  const problems = oratlasProblems(result, report.exported);
  if (problems.length > 0) {
    process.stderr.write(`${problems.map((problem) => `- ${problem}`).join('\n')}\n`);
    process.exit(1);
  }
  process.stdout.write(`ORAtlas extractor @ ${head.slice(0, 12)} loaded ${result.counts.claims} claims, ${result.counts.citations} citations, ${result.counts.relations} relations with zero dropped records\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
