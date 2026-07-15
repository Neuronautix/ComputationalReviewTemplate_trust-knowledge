#!/usr/bin/env node

import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { validateEvidenceCapsule } from './build-evidence-capsule.mjs';
import { validateScientificReviewDiff } from './diff-review-versions.mjs';
import { validateFederatedClaimExport } from './export-federated-claims.mjs';
import { validateReleaseArtifactIndex } from './generate-release-artifacts.mjs';
import { deepEqual, invariant, parseArgs, readJson } from './lib.mjs';

function artifactPath(index, directory, role) {
  const artifact = index.artifacts.find((candidate) => candidate.role === role);
  invariant(artifact, `release artifact bundle lacks ${role}`);
  return join(directory, artifact.path);
}

export function validateReleaseArtifactBundle(directory) {
  const index = readJson(join(directory, 'release-artifact-index.json'));
  validateReleaseArtifactIndex(index, directory);
  const diff = readJson(artifactPath(index, directory, 'scientific_review_diff'));
  const capsule = readJson(artifactPath(index, directory, 'evidence_capsule'));
  const claims = readJson(artifactPath(index, directory, 'federated_claims'));
  validateScientificReviewDiff(diff);
  validateEvidenceCapsule(capsule);
  validateFederatedClaimExport(claims);

  invariant(deepEqual(index.release, diff.to_release), 'index release differs from scientific diff to_release');
  const capsuleRoot = capsule['@graph'].find((node) => node['@id'] === './');
  invariant(
    capsuleRoot?.['comprev:release']?.['@id'] === `urn:sha256:${index.release.manifest_sha256}`,
    'evidence capsule release digest differs from index',
  );
  invariant(claims['schema:version'] === index.release.version, 'claim export version differs from index');
  invariant(claims['dcterms:created'] === index.release.frozen_at, 'claim export timestamp differs from index');
  return { index, diff, capsule, claims };
}

function main() {
  const args = parseArgs(process.argv.slice(2), ['directory']);
  const result = validateReleaseArtifactBundle(args.directory);
  process.stdout.write(`Release artifact bundle valid: ${result.index.release.release_id}, ${result.index.artifacts.length} indexed artifacts.\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
