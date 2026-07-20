import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  buildEvidenceCapsule,
  validateCapsuleDescriptor,
  validateEvidenceCapsule,
} from '../scripts/release-artifacts/build-evidence-capsule.mjs';
import {
  buildScientificReviewDiff,
  renderScientificReviewDiffMarkdown,
} from '../scripts/release-artifacts/diff-review-versions.mjs';
import { validateJsonSchema } from '../scripts/release-artifacts/json-schema.mjs';
import {
  readJson,
  sha256File,
  stableJson,
  validateFrozenTrustReport,
} from '../scripts/release-artifacts/lib.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const RELEASE_ROOT = join(ROOT, 'release_artifacts');
const BEFORE_PATH = join(RELEASE_ROOT, 'fixtures/versions/review-example-v1.0.0.snapshot.json');
const AFTER_PATH = join(RELEASE_ROOT, 'fixtures/versions/review-example-v1.1.0.snapshot.json');
const BEFORE_TRUST_PATH = join(RELEASE_ROOT, 'fixtures/versions/review-example-v1.0.0.trust-report.json');
const AFTER_TRUST_PATH = join(RELEASE_ROOT, 'fixtures/versions/review-example-v1.1.0.trust-report.json');
const CAPSULE_DIR = join(RELEASE_ROOT, 'fixtures/capsule');
const CAPSULE_DESCRIPTOR_PATH = join(CAPSULE_DIR, 'capsule-descriptor.json');

function clone(value) {
  return structuredClone(value);
}

function diffDigests() {
  return {
    from_snapshot_sha256: sha256File(BEFORE_PATH),
    to_snapshot_sha256: sha256File(AFTER_PATH),
    from_trust_report_sha256: sha256File(BEFORE_TRUST_PATH),
    to_trust_report_sha256: sha256File(AFTER_TRUST_PATH),
  };
}

test('scientific diff compares frozen values without mutation or TRUST recomputation', () => {
  const before = readJson(BEFORE_PATH);
  const after = readJson(AFTER_PATH);
  const beforeBytes = stableJson(before);
  const afterBytes = stableJson(after);
  const options = diffDigests();
  const first = buildScientificReviewDiff(before, after, options);
  const second = buildScientificReviewDiff(before, after, options);

  assert.deepEqual(first, second);
  assert.equal(stableJson(before), beforeBytes);
  assert.equal(stableJson(after), afterBytes);
  assert.equal(first.methodology.trust_recomputed, false);
  assert.equal(first.source_native_provenance.semantic_origin, 'source_native_trust');
  assert.equal(first.source_native_provenance.oratlas_re_adjudicated, false);
  assert.equal(first.source_native_provenance.assessment_unit.status, 'proposed');
  assert.equal(first.source_native_provenance.disagreement.representation, 'not_available');
  assert.deepEqual(first.summary.claims, { added: 1, removed: 1, modified: 1, unchanged: 1 });
  const revised = first.claims.find((item) => item.after?.claim_id === 'clm_bbbbbbbbbbbbbbbb');
  assert.equal(revised.before.claim_id, 'clm_aaaaaaaaaaaaaaaa');
  assert.deepEqual(revised.changes.citations.added, ['SourceB']);
  assert.deepEqual(revised.changes.trust.components.robustness, { before: 2, after: 4 });
  assert.deepEqual(revised.changes.trust.overall, { before: 80, after: 100 });
  assert.deepEqual(revised.changes.human_decision_references.added, ['decision-example-0003']);
  assert.equal(first.orphaned_anchors[0].anchor_id, 'annotation-subgroup-pattern');

  const markdown = renderScientificReviewDiffMarkdown(first);
  assert.match(markdown, /Evidence basis/);
  assert.match(markdown, /robustness 2→4/);
  assert.match(markdown, /decision-example-0003/);
  assert.match(markdown, /annotation-subgroup-pattern/);
  assert.match(markdown, /does not recompute/);
});

test('diff rejects mutable, ambiguous, or silently retargeted version lineage', () => {
  const before = readJson(BEFORE_PATH);
  const sameVersion = clone(readJson(AFTER_PATH));
  sameVersion.release.version = before.release.version;
  assert.throws(() => buildScientificReviewDiff(before, sameVersion, diffDigests()), /to-version must be newer/);

  const duplicateSuccessor = clone(readJson(AFTER_PATH));
  duplicateSuccessor.claims[1].supersedes_claim_ids.push('clm_aaaaaaaaaaaaaaaa');
  assert.throws(() => buildScientificReviewDiff(before, duplicateSuccessor, diffDigests()), /Multiple old claims map/);

  const silentRetarget = clone(readJson(AFTER_PATH));
  silentRetarget.anchors[0].selector.claim_id = 'clm_dddddddddddddddd';
  assert.throws(() => buildScientificReviewDiff(before, silentRetarget, diffDigests()), /changed selector without explicit claim succession/);

  const missingBoundary = clone(readJson(AFTER_PATH));
  delete missingBoundary.source_native_provenance;
  assert.throws(() => buildScientificReviewDiff(before, missingBoundary, diffDigests()), /source_native_provenance/);
});

test('frozen TRUST report bytes and claim projections are verified before provenance use', () => {
  const snapshot = readJson(AFTER_PATH);
  const report = readJson(AFTER_TRUST_PATH);
  validateFrozenTrustReport(snapshot, report, sha256File(AFTER_TRUST_PATH));

  const reinterpreted = clone(report);
  reinterpreted.source_native_provenance.oratlas_re_adjudicated = true;
  assert.throws(
    () => validateFrozenTrustReport(snapshot, reinterpreted, sha256File(AFTER_TRUST_PATH)),
    /oratlas_re_adjudicated must be false/,
  );

  const directory = mkdtempSync(join(tmpdir(), 'comprev-tampered-trust-'));
  try {
    const tamperedPath = join(directory, 'trust-report.json');
    const tampered = clone(report);
    tampered.claims[0].overall_score = 5;
    writeFileSync(tamperedPath, stableJson(tampered));
    assert.throws(
      () => validateFrozenTrustReport(snapshot, tampered, sha256File(tamperedPath)),
      /does not reference the verified trust_report digest/,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('RO-Crate 1.3 evidence capsule hashes all four artifact roles deterministically', () => {
  const descriptor = readJson(CAPSULE_DESCRIPTOR_PATH);
  const first = buildEvidenceCapsule(descriptor, CAPSULE_DIR);
  const second = buildEvidenceCapsule(descriptor, CAPSULE_DIR);
  validateEvidenceCapsule(first);
  assert.deepEqual(first, second);
  assert.ok(first['@context'].includes('https://w3id.org/ro/crate/1.3/context'));

  const fileNodes = first['@graph'].filter((node) => node['comprev:artifactRole']);
  assert.deepEqual(
    [...new Set(fileNodes.map((node) => node['comprev:artifactRole']))].sort(),
    ['code', 'data', 'environment', 'output'],
  );
  for (const node of fileNodes) {
    assert.equal(node['comprev:sha256'], sha256File(join(CAPSULE_DIR, node['@id'])));
  }
  const action = first['@graph'].find((node) => node['@type'] === 'CreateAction');
  assert.equal(action.actionStatus['@id'], 'https://schema.org/CompletedActionStatus');
  const root = first['@graph'].find((node) => node['@id'] === './');
  assert.equal(root['comprev:sourceNativeProvenance'].semantic_origin, 'source_native_trust');
});

test('capsule rejects path traversal, hash drift, and incoherent status', () => {
  const unsafe = clone(readJson(CAPSULE_DESCRIPTOR_PATH));
  unsafe.artifacts[0].path = '../private.txt';
  assert.throws(() => buildEvidenceCapsule(unsafe, CAPSULE_DIR), /unsafe/);

  const drifted = clone(readJson(CAPSULE_DESCRIPTOR_PATH));
  drifted.artifacts[0].expected_sha256 = 'f'.repeat(64);
  assert.throws(() => buildEvidenceCapsule(drifted, CAPSULE_DIR), /Hash mismatch/);

  const incoherent = clone(readJson(CAPSULE_DESCRIPTOR_PATH));
  incoherent.status = 'failed';
  assert.throws(() => validateCapsuleDescriptor(incoherent), /non-zero exit_code/);

  const missingBoundary = clone(readJson(CAPSULE_DESCRIPTOR_PATH));
  delete missingBoundary.source_native_provenance;
  assert.throws(() => validateCapsuleDescriptor(missingBoundary), /source_native_provenance/);
});

test('release-diff and capsule fixtures satisfy their Draft 2020-12 schemas', () => {
  const pairs = [
    ['review_version_snapshot.schema.json', 'fixtures/versions/review-example-v1.0.0.snapshot.json'],
    ['review_version_snapshot.schema.json', 'fixtures/versions/review-example-v1.1.0.snapshot.json'],
    ['frozen_trust_report.schema.json', 'fixtures/versions/review-example-v1.0.0.trust-report.json'],
    ['frozen_trust_report.schema.json', 'fixtures/versions/review-example-v1.1.0.trust-report.json'],
    ['scientific_review_diff.schema.json', 'examples/scientific-review-diff.json'],
    ['evidence_capsule_descriptor.schema.json', 'fixtures/capsule/capsule-descriptor.json'],
    ['evidence_capsule_ro_crate.schema.json', 'examples/evidence-capsule.ro-crate.json'],
  ];
  for (const [schemaName, documentName] of pairs) {
    const errors = validateJsonSchema(
      readJson(join(RELEASE_ROOT, documentName)),
      readJson(join(RELEASE_ROOT, 'schemas', schemaName)),
    );
    assert.deepEqual(errors, [], documentName);
  }

  const invalidSnapshot = clone(readJson(AFTER_PATH));
  invalidSnapshot.claims[0].claim_id = 'not-a-claim';
  const snapshotSchema = readJson(join(RELEASE_ROOT, 'schemas/review_version_snapshot.schema.json'));
  assert.ok(validateJsonSchema(invalidSnapshot, snapshotSchema).some((error) => /claim_id/.test(error)));

  const missingBoundary = clone(readJson(AFTER_PATH));
  delete missingBoundary.source_native_provenance;
  assert.ok(validateJsonSchema(missingBoundary, snapshotSchema).some((error) => /source_native_provenance/.test(error)));
});
