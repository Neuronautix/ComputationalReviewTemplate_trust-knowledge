# Immutable release artifacts

All artifacts are source-native TRUST records. They are not ORAtlas-native and
have not been re-adjudicated by ORAtlas. The required
`source_native_provenance` object makes that boundary machine-verifiable and
keeps D01, D09, and D11 visibly `proposed`; consumers must not interpret the
current claim-level projection as a resolved assessment-unit or consensus
contract.

This directory contains versioned contracts, fixtures, and generated examples
for three archive-facing artifacts:

1. a scientific diff between two frozen computational-review versions; and
2. an executable evidence capsule described as RO-Crate 1.3 JSON-LD; and
3. a federated, nanopublication-like JSON-LD claim export.

The dependency-free Node.js tools read stored TRUST results as immutable input.
They never call the TRUST validator and never recompute a component or overall
score.

## Generate the complete static bundle

Run from the repository root:

```powershell
node scripts/release-artifacts/generate-release-artifacts.mjs `
  --from release_artifacts/fixtures/versions/review-example-v1.0.0.snapshot.json `
  --to release_artifacts/fixtures/versions/review-example-v1.1.0.snapshot.json `
  --from-trust-report release_artifacts/fixtures/versions/review-example-v1.0.0.trust-report.json `
  --to-trust-report release_artifacts/fixtures/versions/review-example-v1.1.0.trust-report.json `
  --capsule-descriptor release_artifacts/fixtures/capsule/capsule-descriptor.json `
  --capsule-base-dir release_artifacts/fixtures/capsule `
  --base-uri https://archive.example.org `
  --output-dir release_artifacts/examples
```

The command writes the JSON and Markdown scientific diff, RO-Crate capsule,
federated claim export, and `release-artifact-index.json`. The index records
media types, byte counts, hashes, release identity, and immutable input digests.
The same inputs produce the same bytes: generation times come from the frozen
release rather than the wall clock.

## Scientific review diff

```powershell
node scripts/release-artifacts/diff-review-versions.mjs `
  --from OLD.snapshot.json --to NEW.snapshot.json `
  --from-trust-report OLD.trust-report.json `
  --to-trust-report NEW.trust-report.json `
  --json diff.json --markdown diff.md
```

The command verifies the hashes and stored claim values in both frozen TRUST
reports before comparing the snapshots. It emits the same scientific changes
as machine-readable JSON and editor-readable Markdown.

## Executable evidence capsule

```powershell
node scripts/release-artifacts/build-evidence-capsule.mjs `
  --descriptor capsule-descriptor.json --base-dir capsule-files `
  --output ro-crate-metadata.json
```

Descriptors carry the expected SHA-256 for every capsule file, so generation
fails if code, data, environment, or output bytes drift. The builder records a
completed run; it does not execute the descriptor's command.

## Federated claims and archive validation

```powershell
node scripts/release-artifacts/export-federated-claims.mjs `
  --snapshot NEW.snapshot.json --trust-report NEW.trust-report.json `
  --base-uri https://archive.example.org `
  --output claims.jsonld

node scripts/release-artifacts/validate-release-artifact-bundle.mjs `
  --directory release_artifacts/examples

node scripts/release-artifacts/validate-release-artifact-schemas.mjs `
  --root .
```

The exporter assigns durable versioned HTTPS claim IDs and emits separate named
assertion, provenance, and publication-info graphs. The bundle validator starts
from the static index and verifies every referenced artifact before ingestion.

## Contracts and validation

The versioned schemas are under `schemas/`; valid and adversarial fixtures are
exercised by:

```powershell
node --test tests/release-diff-capsule.test.mjs tests/federated-archive.test.mjs
```

The tests cover frozen-version ordering, explicit claim succession, orphaned
anchors, exact TRUST deltas, capsule path safety and hashes, execution-status
coherence, durable claim URIs, named provenance graphs, all three claim-relation
types, deterministic bundle regeneration, and static-index hashes.

Published snapshots and generated artifacts are immutable. Corrections create a
new release ID, semantic version, manifest digest, snapshot, and artifacts; they
do not replace an earlier release.
