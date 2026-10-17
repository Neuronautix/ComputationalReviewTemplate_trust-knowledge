# ORAtlas-compatible export

This repository can export its frozen claim graph into the lean review-repository
import shape that [ORAtlas](https://github.com/dhuzard/oratlas) reads, while keeping
native Computational Review TRUST v2 in a separate source-native artifact. The
exporter is dependency-free Node.js and is deterministic: the same inputs always
produce the same bytes.

Target contracts: `packages/contracts/src/{artifacts,manifest}.ts` in
`dhuzard/oratlas` at the pinned commit recorded in
[`scripts/oratlas/contract-pin.mjs`](../scripts/oratlas/contract-pin.mjs)
(`9cd3a0c284400b30dd0044cf3acb24df1047275d`).

## Usage

```bash
node scripts/oratlas/export-oratlas.mjs \
  --repository-url https://github.com/<org>/<review-repo> \
  --title "<review title>" \
  [--commit <full 40/64-hex git id>] [--release-tag v1.0.0] \
  [--abstract "..."] [--license MIT] \
  [--evidence-links path/to/evidence-links.json] \
  [--claim-graph knowledge/claim_graph.json] \
  [--trust-report knowledge/trust_score_report.json] \
  [--bibliography content/references.bib] \
  [--artifact-dir knowledge/oratlas] [--output-dir .]
```

`--commit` is optional on purpose: a commit cannot name a manifest that is part of
that same commit. Pass it when exporting for an already-frozen release.

Outputs:

| File | Purpose |
| --- | --- |
| `review-manifest.json` | ORAtlas manifest (schema 1.0.0). Declares `claims`, `citations`, `relations` and `provenance` (the sidecar). Never declares `trustAssessments`. |
| `knowledge/oratlas/claims.jsonl` | One record per review claim; `id` is the native `claim_id`, unchanged. |
| `knowledge/oratlas/citations.jsonl` | One record per cited work; id is the BibTeX key. |
| `knowledge/oratlas/relations.jsonl` | One record per claim→citation graph edge. |
| `knowledge/oratlas/source-native-trust.json` | Immutable source-native companion (see below). |
| `knowledge/oratlas/compatibility-report.json` | Records parsed/exported/dropped, lossy-shape accounting, metadata notes, digests. |

Verify and validate:

```bash
# Offline: strict mirror of the ORAtlas contracts + cross-file and hash integrity.
node scripts/oratlas/verify-oratlas-export.mjs --directory .

# Authoritative: the real ORAtlas extractor (extractKnowledgeWithOutcomes) at the pin.
git clone https://github.com/dhuzard/oratlas ../oratlas
git -C ../oratlas checkout 9cd3a0c284400b30dd0044cf3acb24df1047275d
(cd ../oratlas && pnpm install --frozen-lockfile --ignore-scripts --filter "@oratlas/extractor...")
node scripts/oratlas/validate-with-oratlas.mjs --oratlas-dir ../oratlas --directory .
ORATLAS_DIR=../oratlas node --test tests/oratlas-export.test.mjs
```

Without `ORATLAS_DIR` the extractor test is skipped; the
`ORAtlas export contract` workflow runs it in CI. The validator also fails if the
local contract mirror drifts from ORAtlas's enums.

## Field mapping

* **Claim**: `id`←`claim_id`, `text`←`claim_text`, `section`←`section_id`,
  `anchor`←`<source_file>#p<paragraph>s<sentence>`, `claimType`←`claim_type` when it is
  an ORAtlas claim type, `scope.method`←`claim_scope.methodological`.
* **Citation**: BibTeX key, DOI, PMID, title, authors, year and journal only when
  present. A DOI must be a valid bare DOI and must agree between bibliography and
  claim graph (disagreement aborts the export). A missing or invalid DOI/PMID is
  omitted and listed in `metadata_notes`; PMIDs are never looked up.
* **Relation**: `supports`, `partially_supports`→`partially-supports` and
  `contradicts` map directly. `sourceLocation` joins the verified passage locators.
  `extractionConfidence`, `humanReviewed` and `supportDirection` are omitted rather
  than invented. Other edge types (and non-citation targets) have no ORAtlas
  equivalent: they are reported under `dropped` and kept in the sidecar.
* A claim citation without an edge, or an edge to an unknown/uncited work, aborts the
  export.

## Source-native TRUST v2 (not ORAtlas TRUST)

`source-native-trust.json` carries, per claim and verbatim: claim atoms,
atom-to-citation coverage, citation contexts with passages and verification,
independence groups and basis, entities, knowledge edges, and the whole TRUST v2
record (rubric `2.0.0`, five components with rule IDs, raw/overall score, label,
caps and cap reasons, score basis). It records SHA-256 and size of
`claim_graph.json`, `trust_score_report.json`, the bibliography and any evidence-links
file, and the shared `source_native_provenance` marker
(`semantic_origin: source_native_trust`, `oratlas_re_adjudicated: false`).

Nothing is converted: no ORAtlas `TrustAssessmentRecord`, no mapping onto ORAtlas's
ten relation criteria, no 0–1 aggregate, no assessor or reviewer identity, no
“verified” status. See
[ORAtlas assessment protocol interoperability](https://github.com/dhuzard/oratlas/blob/main/docs/assessment-protocol-interoperability.md).

## Three kinds of evidence statement

| Level | What it is | Where |
| --- | --- | --- |
| **Producer finding** | A finding about a cited article in a Diggypaper evidence packet. About the article, not this review. | Only in the sidecar `evidence_links`, bound by packet and finding source SHA-256. |
| **Review claim** | A sentence authored in this review, identified by `claim_id`. | `claims.jsonl`, and `provenance_level: review_claim` in the sidecar. |
| **Graph relation** | A claim→citation edge in `claim_graph.json`, derived by the TRUST validator. Human confirmation is only whatever the graph records (`human_review_required`, decision references); the exporter never adds it. | `relations.jsonl`; the full edge set is in the sidecar. |

To link findings, pass `--evidence-links` (schema `comprev.evidence-packet-links/1`,
see `tests/fixtures/oratlas/evidence-links.synthetic.json`). Each link names a
finding ID, its source SHA-256, the review citation key (and optional DOI), and the
review claims that cite it; links that do not resolve against the claim graph abort
the export. The fixture’s IDs and hashes are synthetic; the committed export
therefore has no links. The Phase 2 importer referenced in the issue is not present
in this repository, so this file format is the interface it should produce.

## Compatibility report

`compatibility-report.json` lists records parsed, exported and dropped; counts what
the lean shape cannot hold (atoms, atom-level passages, independence groups,
entities, knowledge edges, scope fields, per-citation context fields); metadata
notes; the sidecar reference; and digests of every exported file. The expected
ORAtlas outcome is zero skipped records and no declared TRUST artifact.

## MyST

The export adds only JSON/JSONL files, which the MyST build ignores; `myst.yml` and
the existing validators are unchanged.
