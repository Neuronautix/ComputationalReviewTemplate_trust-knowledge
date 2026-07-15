#!/usr/bin/env node

import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { assertSchemaValid } from './json-schema.mjs';
import { parseArgs, readJson } from './lib.mjs';

const CONTRACTS = [
  ['review_version_snapshot.schema.json', 'fixtures/versions/review-example-v1.0.0.snapshot.json'],
  ['review_version_snapshot.schema.json', 'fixtures/versions/review-example-v1.1.0.snapshot.json'],
  ['frozen_trust_report.schema.json', 'fixtures/versions/review-example-v1.0.0.trust-report.json'],
  ['frozen_trust_report.schema.json', 'fixtures/versions/review-example-v1.1.0.trust-report.json'],
  ['scientific_review_diff.schema.json', 'examples/scientific-review-diff.json'],
  ['evidence_capsule_descriptor.schema.json', 'fixtures/capsule/capsule-descriptor.json'],
  ['evidence_capsule_ro_crate.schema.json', 'examples/evidence-capsule.ro-crate.json'],
  ['federated_claim_export.schema.json', 'examples/federated-claims.jsonld'],
  ['release_artifact_index.schema.json', 'examples/release-artifact-index.json'],
];

export function validateReleaseArtifactSchemas(root) {
  const releaseRoot = resolve(root, 'release_artifacts');
  for (const [schemaName, documentPath] of CONTRACTS) {
    const schema = readJson(join(releaseRoot, 'schemas', schemaName));
    const document = readJson(join(releaseRoot, documentPath));
    assertSchemaValid(document, schema, documentPath);
  }
  return CONTRACTS.length;
}

function main() {
  const args = parseArgs(process.argv.slice(2), ['root']);
  const count = validateReleaseArtifactSchemas(args.root);
  process.stdout.write(`Release artifact schema validation passed: ${count} documents.\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
