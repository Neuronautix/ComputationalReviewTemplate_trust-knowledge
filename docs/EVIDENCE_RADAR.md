# Evidence Radar

Evidence Radar is an advisory update monitor for published TRUST reviews. It watches configured cited DOIs and topic queries, consumes normalized provider records, and emits deterministic proposals mapped to canonical claim IDs. Every watched ID must exist in the frozen `claim_index_path`; the artifact records that index's path and SHA-256.

It recognizes new works, corrections, expressions of concern, and retractions. Each proposal records the work, affected claims, match rationale, suggested review action, provider URL, record identifier, observation time, and input digests.

## Automation boundary

Radar never edits claim text, citations, TRUST inputs or scores, review content, or the default branch. Its output is not scientific acceptance. A human reviewer must inspect the source, decide relevance and validity, approve any citation/evidence change, and rerun the normal TRUST validation workflow. Alerts are prompts for review, not automatic findings.

## Deterministic offline run

```bash
node scripts/evidence-radar.mjs \
  --config config/evidence-radar.json \
  --claim-index knowledge/claim_index.json \
  --feed tests/fixtures/evidence-radar/feed.json \
  --output evidence-radar-output/proposals.json \
  --failure-output evidence-radar-output/failure.json
node --test tests/evidence-radar.test.mjs
```

The configuration snapshot, frozen claim index, and provider `retrieved_at`
timestamp are explicit inputs; the engine never reads the wall clock. Output
`generated_at` comes from the provider feed. Identical input bytes produce
identical proposal artifacts. Provider adapters must set `scan_status: scanned`
and preserve credential-free HTTPS provenance. Invalid, oversized,
credential-bearing, or noncanonical data fails closed.

With no provider, the workflow creates a timestamped input with
`scan_status: not_scanned` and `not_scanned_reason: no_provider`. Its artifact is
`not_scanned`, never `no_changes`; only a completed scan can report no changes.

The scheduled workflow uploads the artifact. Issue publication is opt-in on manual dispatch and uses a dedicated job with `issues: write`; the scanner itself has read-only repository access. Missing provider configuration produces a `not_scanned` advisory artifact rather than fabricated data.
