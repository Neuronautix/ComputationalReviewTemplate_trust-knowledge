# Immutable release artifacts

All artifacts are source-native TRUST records. They are not ORAtlas-native and
have not been re-adjudicated by ORAtlas. The required
`source_native_provenance` object makes that boundary machine-verifiable and
keeps D01, D09, and D11 visibly `proposed`; consumers must not interpret the
current claim-level projection as a resolved assessment-unit or consensus
contract.

This directory contains versioned contracts, fixtures, and generated examples
for two release-facing artifacts:

1. a scientific diff between two frozen computational-review versions; and
2. an executable evidence capsule described as RO-Crate 1.3 JSON-LD.

The dependency-free Node.js tools read stored TRUST results as immutable input.
They never call the TRUST validator and never recompute a component or overall
score.

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

## Contracts and validation

The foundation schemas are under `schemas/`; valid and adversarial fixtures are
exercised by:

```powershell
node --test tests/release-diff-capsule.test.mjs
```

The tests cover frozen-version ordering, explicit claim succession, orphaned
anchors, exact TRUST deltas, capsule path safety and hashes, execution-status
coherence, and deterministic regeneration.

Published snapshots and generated artifacts are immutable. Corrections create a
new release ID, semantic version, manifest digest, snapshot, and artifacts; they
do not replace an earlier release.
