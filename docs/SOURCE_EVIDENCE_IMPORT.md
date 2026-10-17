# Importing Diggypaper evidence packets into Phase 2

An optional, offline, deterministic importer that turns reviewed **source-paper findings** from a Diggypaper
[`source-evidence-packet/0.1.0`](https://github.com/dhuzard/diggypaper/issues/47) into the Phase 2 finding
representation of `skills/comprev-evidence-gathering.md`, so a fixed, already-reviewed corpus can feed Phase 5
curation. Agent-based evidence acquisition remains the default and is unchanged; nothing calls the importer
unless you run it.

Three things are never conflated:

| Object | Here |
|---|---|
| Source-paper finding (what a paper reports, with passages and native human judgments) | what is imported |
| Review-authored claim (what this review asserts) | never created by import |
| TRUST record / score | never created or converted; native Diggypaper judgments are kept verbatim in the lineage sidecar |

## Usage

```bash
# Frozen example (synthetic fixture; output digests are asserted in tests/source-evidence-import.test.mjs)
node scripts/import-source-evidence-packet.mjs \
  --packet tests/fixtures/source-evidence-packet/g2-pilot \
  --out    evidence/import/g2-pilot \
  --check-gates

# Validate only (contract validation, no outputs)
node scripts/import-source-evidence-packet.mjs --packet <dir> --validate-only

# Stricter threshold
node scripts/import-source-evidence-packet.mjs --packet <dir> --out <dir> --min-verification source-verified
```

Requirements: Node 22+, no network, no database, no dependencies. Exit codes: `0` imported/valid, `1` packet refused
(or a requested gate failed, or the output directory would change), `2` usage error.

Outputs (written only if the whole packet validates):

| File | Purpose |
|---|---|
| `cluster_evidence.json` | Phase 2 cluster package: `findings[]` in the existing schema, plus `import_provenance` |
| `source-evidence-lineage.json` | Immutable sidecar: packet hash, snapshot hashes, finding ID/revision, quoted passage and match state, assessment IDs and native protocol, producer IDs, per-field loss report |
| `import-report.json` | Per-record result (`accepted`, `rejected`, `withheld`, `incomplete`), reasons, counts, omitted-by-producer counts |

Same input bytes always produce the same output bytes (no clock, randomness or network; timestamps come from the packet).
The sidecar is immutable: the importer refuses to write over an existing file whose bytes would differ, so use a new
output directory when inputs or options change.

## What is verified (fail closed, nothing written)

- `schema_version` is exactly `source-evidence-packet/0.1.0`; anything else is `unsupported-schema-version` (no best-effort parsing).
- Every artifact's SHA-256, byte length and record count match the manifest; no undeclared files; canonical encoding.
- The vendored JSON Schemas (closed objects) and every semantic rule of the contract validator, with its error codes
  (verified against all 35 upstream negative fixtures, see below).
- Reference integrity and ownership: findings, passages and assessments resolve; a finding's passages belong to the same
  paper; a review's `assessed_snapshot_sha256` equals the paper snapshot hash (a stale review is a mismatched review).
  Beyond the contract validator, the importer also rejects an assessment that judges a passage its finding does not cite
  or that belongs to another paper (`assessment-cross-link`).
- Rights: `private` and `embargoed` packets are refused.
- Packet-level defects refuse the whole packet; they are never downgraded to per-record warnings.

The contract defines integrity by SHA-256 hashes in the manifest; it has **no cryptographic signature**. "Corrupt
signature" in the issue is therefore covered as a hash mismatch. Authenticity of the packet's origin is out of scope until
the producer adds signing in a later contract version.

## Per-finding result

Evaluated on the latest revision of each `finding_id` (older revisions are `rejected: superseded-revision`; revisions are never collapsed or merged).
Every record gets exactly one status; all reasons are listed. Precedence when several apply: `withheld` > `rejected` > `incomplete`.

| Status | Meaning | Reason codes |
|---|---|---|
| `accepted` | Mapped to Phase 2 and recorded in the lineage sidecar | none |
| `rejected` | Not importable as it stands | `superseded-revision`, `not-approved-for-export`, `unreviewed`, `verification-below-threshold`, `missing-doi`, `invalid-doi`, `source-unavailable`, `ambiguous-passage`, `no-matched-passage`, `no-supporting-judgment`, `reviewer-contradiction` |
| `withheld` | Restricted content; excluded and no protected text emitted | `packet-scope-restricted`, `paper-rights-not-redistributable`, `quote-withheld-for-rights` |
| `incomplete` | Otherwise acceptable but a required Phase 2 field cannot be filled honestly | `source-sentence-not-verbatim` (supported passage matched only after normalization) |

A finding is accepted only if it is `approved-for-export`, `human-reviewed`, at or above `--min-verification` (default
`human-reviewed`), its paper has a DOI, a captured snapshot and `redistribution: allowed`, at least one native
assessment says `supports` on a passage with an **exact** match and an included quote, and no assessment says `contradicts`.
Records the producer itself declared withheld (`export_status.withheld_counts`) are reported separately as
`omitted_by_producer`, not as rejections. A `partial` packet is never presented as complete.

## Phase 2 crosswalk (pinned)

This pins the table the contract (section 8.3) left PROVISIONAL. Phase 2 findings accept only schema fields, so
lineage lives in the sidecar, not in the finding.

| Phase 2 field | Source | Notes |
|---|---|---|
| `claim` | `finding.statement` | Worded by `finding.origin` (`source-explicit`, `ai-paraphrase`, `reviewer-interpretation`); recorded in the sidecar; never attributed to article authors |
| `claim_source_sentence` | the supporting passage `quote` | Verbatim; only for an `exact` match whose native assessment is `supports`. Match success alone is not support |
| `doi` | `paper.identifiers.doi` | Lower-cased, resolver prefix removed; PMID/PMCID alone are not enough (`missing-doi`) |
| `study_system` | `context.population` | `"unknown"` stays `"unknown"` |
| `n` | `numeric_results[].n.value` | Only when `n.definition` is `experimental-unit` and unambiguous. Article-level, group or unknown N is **not** relabelled; it stays in `evidence` and the sidecar with its definition |
| `evidence` | `context.*`, `numeric_results[]` | Composed text: value, unit, `n` and `n-definition` as written |
| `effect_size`, `effect_size_source_sentence` | none | The contract has no effect-size field: `null`, never computed or imputed. Whether a numeric value appears in the passage is recorded in the sidecar (`value_appears_in_claim_source_sentence`) |
| `replication_status`, `replication_evidence_dois` | none | Always `replication_unknown` and `[]`. `independently-verified` counts reviewers, not replications |
| `text_access` | none | `"unknown"`. The packet does not say whether a passage comes from the abstract or the body, and this is not deduced from size or from a sentence being in both |

Not carried into the Phase 2 finding, but kept in the sidecar: `verification_level`, `review_state`, `export_state`,
`revision`, article metadata and snapshot hashes, all passages with match state and offsets, all native assessments
(status, rationale, `protocol: seip-support-v1`, reviewer pseudonym, snapshot hash), and all producer IDs.

Every accepted finding carries a field-level loss report (`mapped`, `mapped-verbatim`, `composed`, `constant`,
`unknown-kept`, `null-absent-in-packet`, `null-not-comparable`) in both the sidecar and the report.

### Rights and identity

- Quotes appear only for papers with `redistribution: allowed` and an included quote. Withheld quotes, metadata-only or
  restricted papers' text, full text and PDFs never reach any output; `full_text_included` is always `false`.
- Reviewers appear only as the packet's project-scoped pseudonym (`rv-…`). No raw user ID or email exists in a valid packet
  (the schema rejects other forms). Reviewer rationales are copied as written; treat the sidecar as publishable only if the
  packet's `access_scope` and licenses allow it.

## Gates

`--check-gates` runs executable ports of the relevant skill gates (the skills stay authoritative):

- **Phase 2 import gate** (`phase2ImportGate`): provenance hash verified, DOIs present, no `"None"` strings, conflict shape,
  conflicts declared, no replication invented. Checks that measure search effort, retrieval or corpus size are listed as
  `exempt` with a category and reason (the pilot-specific corpus-size exceptions). Record the user's decision for
  `BIBLIOGRAPHY_FLOOR_HARD` in `gate_evidence_compliance.json` `user_signoff` as usual.
- **Phase 5 gate** (`phase5Gate`): shape check and checks 1-10 of `comprev-curation-validator.md`, run on a pilot identity
  curation (one section, `cite_key` derived mechanically from the DOI because the packet has no publication year). Real
  curation by the orchestrator replaces that helper.

Bounded gate changes made with this importer (skills updated, with tests):

1. **Empty conflict set.** `CONFLICTS_NONEMPTY`/`CONFLICT_COUNT` are replaced by `CONFLICTS_DECLARED`: empty `conflicts[]` passes only with
   `conflict_assessment.status` of `none_found` (with a basis naming the contradiction queries) or `not_assessed`
   (import: no conflict search was run). A bare empty array still fails. `ALL_CONFLICTS_ASSIGNED` is vacuously true for an empty set.
2. **`text_access: "unknown"`** is valid in Phase 5 only for a section curated from an import whose `import_provenance`
   matches, whose sidecar hash verifies, and whose findings are exactly those the sidecar recorded (each lineage entry carries `phase2_finding_sha256`, so editing a finding after import breaks the binding). Native findings still require `fulltext` or `abstract_only`.

Known limitation: two accepted findings supported by the same sentence trip `NO_INTRA_SECTION_DUPLICATES` in Phase 5. The importer
does not merge or deduplicate by text (contract section 5.1); curation must decide.

## Tests and conformance

```bash
node --test tests/source-evidence-import.test.mjs
```

- `tests/fixtures/source-evidence-packet/upstream-{valid,invalid}`: byte copies of the producer's fixtures (pinned commit in
  `UPSTREAM.md`); the validator must emit exactly each case's `expected.json` codes.
- `g2-pilot`: synthetic packet generated by `build-g2-fixture.mjs` — two accepted findings from one article, one from another,
  plus rejected, withheld and incomplete cases. Replay digests are frozen in the test.
- Vendored contract and hashes: `docs/contracts/source-evidence-packet/v0.1.0/UPSTREAM.md`. The importer's
  `scripts/release-artifacts/json-schema.mjs` dependency gained `anyOf`, `not` and `if/then/else` (additive; existing schemas unaffected).

## Open items for the maintainers

1. Contract open items 2 and 3 (minimum verification level; whether `unknown`/`restricted` assessment statuses are accepted upstream). Default threshold here: `human-reviewed`.
2. `text_access: "unknown"` needs the producer to add an abstract/body indicator per passage (a later contract version) before native `fulltext` can be asserted.
3. Packet signing, if packet authenticity (not just integrity) is required.
