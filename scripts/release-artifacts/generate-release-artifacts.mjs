#!/usr/bin/env node

import { statSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { buildEvidenceCapsule, validateEvidenceCapsule } from './build-evidence-capsule.mjs';
import {
  buildScientificReviewDiff,
  renderScientificReviewDiffMarkdown,
  validateScientificReviewDiff,
} from './diff-review-versions.mjs';
import { exportFederatedClaims, validateFederatedClaimExport } from './export-federated-claims.mjs';
import {
  SHA256_PATTERN,
  invariant,
  parseArgs,
  readJson,
  safeRelativePath,
  sha256File,
  stableJson,
  unique,
  validateFrozenTrustReport,
  validateSourceNativeProvenance,
  writeText,
} from './lib.mjs';

function artifactRecord(outputDir, role, path, mediaType) {
  const absolutePath = join(outputDir, path);
  return {
    role,
    path,
    media_type: mediaType,
    bytes: statSync(absolutePath).size,
    sha256: sha256File(absolutePath),
  };
}

export function validateReleaseArtifactIndex(index, outputDir) {
  invariant(index?.schema_version === '1.0.0', 'release artifact index schema_version must be 1.0.0');
  invariant(index?.artifact_type === 'computational_review_release_artifact_index', 'release artifact index type is invalid');
  validateSourceNativeProvenance(index.source_native_provenance, 'release artifact index source_native_provenance');
  invariant(Array.isArray(index.artifacts), 'release artifact index artifacts must be an array');
  const requiredRoles = [
    'scientific_review_diff',
    'scientific_review_diff_human',
    'evidence_capsule',
    'federated_claims',
  ];
  unique(index.artifacts.map((artifact) => artifact.path), 'release artifact paths');
  for (const role of requiredRoles) {
    invariant(index.artifacts.some((artifact) => artifact.role === role), `release artifact index lacks ${role}`);
  }
  for (const artifact of index.artifacts) {
    invariant(SHA256_PATTERN.test(artifact.sha256), `release artifact ${artifact.path} has an invalid hash`);
    const absolutePath = safeRelativePath(outputDir, artifact.path, `release artifact ${artifact.path}`);
    invariant(sha256File(absolutePath) === artifact.sha256, `release artifact ${artifact.path} hash mismatch`);
    invariant(statSync(absolutePath).size === artifact.bytes, `release artifact ${artifact.path} byte count mismatch`);
  }
  return index;
}

export function generateReleaseArtifacts(options) {
  const before = readJson(options.from);
  const after = readJson(options.to);
  const fromTrustReport = readJson(options.from_trust_report);
  const toTrustReport = readJson(options.to_trust_report);
  const capsuleDescriptor = readJson(options.capsule_descriptor);
  invariant(
    capsuleDescriptor.release.release_id === after.release.release_id
      && capsuleDescriptor.release.manifest_sha256 === after.release.manifest_sha256,
    'Evidence capsule descriptor must target the to-release exactly',
  );
  const fromDigest = sha256File(options.from);
  const toDigest = sha256File(options.to);
  const fromTrustReportDigest = sha256File(options.from_trust_report);
  const toTrustReportDigest = sha256File(options.to_trust_report);
  validateFrozenTrustReport(before, fromTrustReport, fromTrustReportDigest, 'from_trust_report');
  validateFrozenTrustReport(after, toTrustReport, toTrustReportDigest, 'to_trust_report');
  const diff = buildScientificReviewDiff(before, after, {
    from_snapshot_sha256: fromDigest,
    to_snapshot_sha256: toDigest,
    from_trust_report_sha256: fromTrustReportDigest,
    to_trust_report_sha256: toTrustReportDigest,
  });
  const capsule = buildEvidenceCapsule(capsuleDescriptor, options.capsule_base_dir);
  const claims = exportFederatedClaims(after, {
    base_uri: options.base_uri,
    snapshot_sha256: toDigest,
    verified_trust_report_sha256: toTrustReportDigest,
  });
  validateScientificReviewDiff(diff);
  validateEvidenceCapsule(capsule);
  validateFederatedClaimExport(claims);

  const outputs = {
    diff_json: 'scientific-review-diff.json',
    diff_markdown: 'scientific-review-diff.md',
    capsule: 'evidence-capsule.ro-crate.json',
    claims: 'federated-claims.jsonld',
    index: 'release-artifact-index.json',
  };
  writeText(join(options.output_dir, outputs.diff_json), stableJson(diff));
  writeText(join(options.output_dir, outputs.diff_markdown), renderScientificReviewDiffMarkdown(diff));
  writeText(join(options.output_dir, outputs.capsule), stableJson(capsule));
  writeText(join(options.output_dir, outputs.claims), stableJson(claims));
  const index = {
    schema_version: '1.0.0',
    artifact_type: 'computational_review_release_artifact_index',
    generated_at: after.release.frozen_at,
    release: after.release,
    source_native_provenance: after.source_native_provenance,
    immutable_inputs: {
      from_snapshot_sha256: fromDigest,
      to_snapshot_sha256: toDigest,
      from_trust_report_sha256: fromTrustReportDigest,
      to_trust_report_sha256: toTrustReportDigest,
      capsule_descriptor_sha256: sha256File(options.capsule_descriptor),
    },
    artifacts: [
      artifactRecord(options.output_dir, 'scientific_review_diff', outputs.diff_json, 'application/json'),
      artifactRecord(options.output_dir, 'scientific_review_diff_human', outputs.diff_markdown, 'text/markdown'),
      artifactRecord(options.output_dir, 'evidence_capsule', outputs.capsule, 'application/ld+json'),
      artifactRecord(options.output_dir, 'federated_claims', outputs.claims, 'application/ld+json'),
    ],
  };
  validateReleaseArtifactIndex(index, options.output_dir);
  writeText(join(options.output_dir, outputs.index), stableJson(index));
  return { diff, capsule, claims, index, outputs };
}

function main() {
  const args = parseArgs(process.argv.slice(2), [
    'from',
    'to',
    'from-trust-report',
    'to-trust-report',
    'capsule-descriptor',
    'capsule-base-dir',
    'base-uri',
    'output-dir',
  ]);
  generateReleaseArtifacts({
    from: args.from,
    to: args.to,
    from_trust_report: args['from-trust-report'],
    to_trust_report: args['to-trust-report'],
    capsule_descriptor: args['capsule-descriptor'],
    capsule_base_dir: args['capsule-base-dir'],
    base_uri: args['base-uri'],
    output_dir: args['output-dir'],
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
