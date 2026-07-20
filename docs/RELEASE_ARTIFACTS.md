# Verified review deltas and executable evidence capsules

## Source-native semantic boundary

Every snapshot, frozen TRUST report, scientific diff, and evidence capsule must
carry `source_native_provenance`. The marker identifies the originating
repository, rubric and method versions, states that the artifact is native
TRUST rather than an ORAtlas re-adjudication, and records the status of D01,
D09, and D11.

While those decisions remain `proposed`, the claim-level score is explicitly a
projection of current storage behaviour, not a ratified assessment-unit
contract. Disagreement is declared `not_available` and no consensus or
cross-reviewer aggregation is implied. Validators reject missing, weakened, or
contradictory markers.

The release-artifact foundation compares two immutable review releases and
packages a completed computational run without recalculating scientific
judgments. Its command-line interface is documented in
[`release_artifacts/README.md`](../release_artifacts/README.md).

## Frozen snapshot boundary

A `review_version_snapshot` names the review, release, semantic version,
release-manifest SHA-256, and freeze time. Each claim copies the exact published
text, citations, evidence basis, stored TRUST component/overall values, source
digest, human decision references, explicit claim relations, and succession
IDs. Anchors are frozen with the release they target.

Before a diff is written, the tool hashes the actual frozen TRUST report bytes
and checks every snapshot claim against the report's stored rubric version,
component scores, overall score, and label. This verifies immutable provenance;
it does not calculate a score.

The diff reports changes between already-published values and marks
`methodology.trust_recomputed=false`. A changed claim ID is paired only through
an explicit `supersedes_claim_ids` edge; ambiguous succession fails closed. An
anchor is `current` only when its selector is byte-for-byte equivalent, and is
`remapped` only when its old and new claim IDs follow that explicit succession
edge. Missing anchors are reported as orphans; any other same-ID selector
change fails closed.

The JSON diff is suitable for APIs and release gates. The Markdown view presents
the same claim text, citations, evidence basis, TRUST components and overall,
human decisions, and orphan information for editorial review.

## Executable evidence capsule

The capsule descriptor records a command, timestamps, exit code, release
identity, and code/data/environment/output files. The builder validates safe
relative paths, hashes the actual bytes, checks every expected digest, and emits
RO-Crate 1.3 JSON-LD with a `CreateAction` and explicit action status.

The builder does not execute the declared command. An isolated runner executes
the code first, records status and outputs, and then invokes the builder. This
separation prevents metadata generation from executing untrusted release
content while preserving enough information for an authorized reproducer.

Every capsule includes at least one artifact in each role:

- `code`: source or executable workflow definition;
- `data`: immutable input data;
- `environment`: runtime, lockfile, or container description; and
- `output`: the produced evidence artifact.

All four roles carry SHA-256 and byte length in the crate. A `passed` capsule
must have exit code zero; a `failed` capsule must have a nonzero exit code.

## Federated claim graph

The claim exporter assigns each versioned claim a durable HTTPS URI beneath the
archive base URL. Each nanopublication-like JSON-LD record has separate named
assertion, provenance, and publication-info graphs. Assertions include exact
claim text, citation links, evidence relation, frozen TRUST values, and
`supports`, `contradicts`, or `qualifies` relations to other durable claim URIs.

Provenance links the assertion to the release-manifest digest, snapshot digest,
source digest, and frozen TRUST-report digest. Publication info includes review
version and human editorial-decision references. Because JSON-LD is an RDF
serialization, downstream services can load the graphs without scraping review
HTML.

## Static archive ingestion

`generate-release-artifacts.mjs` writes a content-addressable
`release-artifact-index.json`. A registry can:

1. fetch the immutable release directory;
2. verify every indexed byte count and SHA-256;
3. validate the JSON artifacts against the versioned schemas;
4. expose the Markdown diff next to the version page;
5. serve the RO-Crate as a reproducibility artifact; and
6. index the JSON-LD claim dataset for cross-review search and federation.

The base URL is an input, so deployment does not hard-code one archive vendor.
An archive must never repoint a versioned claim URI or replace an artifact at an
indexed path; corrections publish a new versioned directory and lineage.

Published snapshots, reports, diffs, and capsules are immutable. A correction
creates a new release ID, semantic version, manifest digest, and snapshot rather
than overwriting an earlier release.
