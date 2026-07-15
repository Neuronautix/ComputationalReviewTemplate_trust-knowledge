import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  exportFederatedClaims,
  validateFederatedClaimExport,
} from '../scripts/release-artifacts/export-federated-claims.mjs';
import { generateReleaseArtifacts } from '../scripts/release-artifacts/generate-release-artifacts.mjs';
import { validateReleaseArtifactBundle } from '../scripts/release-artifacts/validate-release-artifact-bundle.mjs';
import { validateJsonSchema } from '../scripts/release-artifacts/json-schema.mjs';
import { validateReleaseArtifactSchemas } from '../scripts/release-artifacts/validate-release-artifact-schemas.mjs';
import {
  readJson,
  sha256File,
  validateSnapshot,
} from '../scripts/release-artifacts/lib.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const RELEASE_ROOT = join(ROOT, 'release_artifacts');
const BEFORE_PATH = join(RELEASE_ROOT, 'fixtures/versions/review-example-v1.0.0.snapshot.json');
const AFTER_PATH = join(RELEASE_ROOT, 'fixtures/versions/review-example-v1.1.0.snapshot.json');
const BEFORE_TRUST_PATH = join(RELEASE_ROOT, 'fixtures/versions/review-example-v1.0.0.trust-report.json');
const AFTER_TRUST_PATH = join(RELEASE_ROOT, 'fixtures/versions/review-example-v1.1.0.trust-report.json');
const CAPSULE_DIR = join(RELEASE_ROOT, 'fixtures/capsule');
const CAPSULE_DESCRIPTOR_PATH = join(CAPSULE_DIR, 'capsule-descriptor.json');
const EXAMPLES_DIR = join(RELEASE_ROOT, 'examples');

function clone(value) {
  return structuredClone(value);
}

test('federated export uses durable IDs, named provenance graphs, and all relation types', () => {
  const snapshot = readJson(AFTER_PATH);
  const exported = exportFederatedClaims(snapshot, {
    base_uri: 'https://archive.example.org',
    snapshot_sha256: sha256File(AFTER_PATH),
    verified_trust_report_sha256: sha256File(AFTER_TRUST_PATH),
  });
  validateFederatedClaimExport(exported);
  assert.equal(exported['@graph'].length, snapshot.claims.length);
  const primary = exported['@graph'].find((item) => item['@id'].endsWith('clm_bbbbbbbbbbbbbbbb'));
  const assertion = primary['np:hasAssertion']['@graph'];
  assert.ok(assertion.some((triple) => triple['cito:supports']));
  assert.ok(assertion.some((triple) => triple['cito:disagreesWith']));
  const provenance = primary['np:hasProvenance']['@graph'][0]['prov:wasDerivedFrom'];
  assert.ok(provenance.some((item) => item['@id'] === `urn:sha256:${snapshot.release.manifest_sha256}`));
  assert.deepEqual(
    primary['np:hasPublicationInfo']['@graph'][0]['comprev:humanDecisionReference'],
    ['decision-example-0001', 'decision-example-0003'],
  );
  const qualifier = exported['@graph'].find((item) => item['@id'].endsWith('clm_dddddddddddddddd'));
  assert.ok(qualifier['np:hasAssertion']['@graph'].some((triple) => triple['comprev:qualifies']));
});

test('claim export rejects dangling relationships before emitting RDF', () => {
  const invalid = clone(readJson(AFTER_PATH));
  invalid.claims[0].relations[0].target_claim_id = 'clm_ffffffffffffffff';
  assert.throws(() => validateSnapshot(invalid), /target is absent/);
});

test('aggregate CLI reproduces committed static archive examples and index hashes', () => {
  const outputDir = mkdtempSync(join(tmpdir(), 'comprev-release-artifacts-'));
  try {
    const options = {
      from: BEFORE_PATH,
      to: AFTER_PATH,
      from_trust_report: BEFORE_TRUST_PATH,
      to_trust_report: AFTER_TRUST_PATH,
      capsule_descriptor: CAPSULE_DESCRIPTOR_PATH,
      capsule_base_dir: CAPSULE_DIR,
      base_uri: 'https://archive.example.org',
      output_dir: outputDir,
    };
    generateReleaseArtifacts(options);
    validateReleaseArtifactBundle(outputDir);
    for (const name of readdirSync(EXAMPLES_DIR).sort()) {
      assert.equal(
        readFileSync(join(outputDir, name), 'utf8'),
        readFileSync(join(EXAMPLES_DIR, name), 'utf8'),
        `${name} is stale`,
      );
    }
    const index = readJson(join(outputDir, 'release-artifact-index.json'));
    for (const artifact of index.artifacts) {
      assert.equal(artifact.sha256, sha256File(join(outputDir, artifact.path)));
    }

    const cliOutput = join(outputDir, 'cli');
    execFileSync(process.execPath, [
      join(ROOT, 'scripts/release-artifacts/generate-release-artifacts.mjs'),
      '--from', BEFORE_PATH,
      '--to', AFTER_PATH,
      '--from-trust-report', BEFORE_TRUST_PATH,
      '--to-trust-report', AFTER_TRUST_PATH,
      '--capsule-descriptor', CAPSULE_DESCRIPTOR_PATH,
      '--capsule-base-dir', CAPSULE_DIR,
      '--base-uri', 'https://archive.example.org',
      '--output-dir', cliOutput,
    ]);
    assert.equal(
      readFileSync(join(cliOutput, 'release-artifact-index.json'), 'utf8'),
      readFileSync(join(outputDir, 'release-artifact-index.json'), 'utf8'),
    );
    const validationOutput = execFileSync(process.execPath, [
      join(ROOT, 'scripts/release-artifacts/validate-release-artifact-bundle.mjs'),
      '--directory', cliOutput,
    ], { encoding: 'utf8' });
    assert.match(validationOutput, /Release artifact bundle valid/);
  } finally {
    rmSync(outputDir, { recursive: true, force: true });
  }
});

test('archive adapter validates every schema and full fixture', () => {
  const schemaDir = join(RELEASE_ROOT, 'schemas');
  const schemas = readdirSync(schemaDir).filter((name) => name.endsWith('.json')).map((name) => readJson(join(schemaDir, name)));
  assert.equal(schemas.length, 7);
  assert.ok(schemas.every((schema) => schema.$schema === 'https://json-schema.org/draft/2020-12/schema'));
  assert.equal(new Set(schemas.map((schema) => schema.$id)).size, schemas.length);
  assert.equal(validateReleaseArtifactSchemas(ROOT), 9);

  const invalidSnapshot = clone(readJson(AFTER_PATH));
  invalidSnapshot.claims[0].claim_id = 'not-a-claim';
  const snapshotSchema = readJson(join(schemaDir, 'review_version_snapshot.schema.json'));
  assert.ok(validateJsonSchema(invalidSnapshot, snapshotSchema).some((error) => /claim_id/.test(error)));
});
