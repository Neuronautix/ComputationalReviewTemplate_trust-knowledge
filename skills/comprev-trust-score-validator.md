# TRUST Score Validator - Binary Gate for Dedicated TRUST Scoring

**Purpose:** Compute and validate claim-level TRUST scores from structured claim contexts using deterministic rules.
**Agent:** DATAML (mechanical scoring only)

This validator is intentionally separate from section writing and criticism.
Writers do not assign final TRUST scores.

## Inputs

- `knowledge/claim_seed_index.json`
- `knowledge/claim_graph.json` (optional prior state)
- `knowledge/schemas/claim_context.schema.json`
- `knowledge/schemas/trust_score.schema.json`
- Verification artifacts from citation checking (Phase 16 outputs)

## Scoring Model

Each claim receives five component scores, each integer 0-4:

- **T (Traceability)**
- **R (Robustness)**
- **U (Uncertainty calibration)**
- **S (Source integrity)**
- **T (Transferability / scope control)**

Overall score:

`raw_score = 5 * sum(component_scores)`

`overall_score = min(raw_score, 60)` when any mandatory cap is triggered;
otherwise `overall_score = raw_score`.

Trust label:

- `85-100` -> `high_trust`
- `70-84` -> `moderate_trust`
- `50-69` -> `low_trust`
- `<50` -> `critical_or_unreliable`

## Mandatory Cap Rule

Cap `overall_score` at 60 when any trigger is present:

- unsupported citation
- direction mismatch
- contradicted claim without caveat
- invented reference
- missing DOI for cited empirical claim
- overextended biological/clinical/generalization scope

There are no score overrides. Correct a challenged verification input and
recompute the score.

## Attribution Rules

- A verified source passage must carry a locator, HTTPS `verification_source`,
  non-future `verified_at`, and atom IDs. A bare `verification_status` flag is
  not eligible evidence.
- Derive `evidence_relation` from eligible passage-to-atom coverage, conflicts,
  and scope. Fail if a stored value differs; never score the stored value by
  itself.
- Derive wording strength from lexical markers in exact `claim_text`, with the
  attribution-frame rules in `knowledge/TRUST_RUBRIC.md`. Emit the matched
  markers in `trust_score_report.json`.
- Supporting citations require `independence_basis`. Shared-author sources are
  one independence group by default; different groups with shared authors fail
  the gate.
- Emit and validate deterministic `score_basis` records containing eligible
  citations/DOIs, passage locators, atom coverage, independence groups per atom,
  derived evidence relation, wording basis, modality, and scope status.

## Mechanical Checks

1. **CLAIM_SCHEMA_VALID**: every claim validates against `claim_context.schema.json`.
2. **TRUST_SCHEMA_VALID**: produced `trust_score` objects validate against `trust_score.schema.json`.
3. **ALL_COMPONENTS_SCORED**: all five components have integer score 0-4 plus rationale/evidence/failure modes/recommended fix.
4. **OVERALL_FORMULA_CORRECT**: stored `overall_score` equals formula output.
5. **LABEL_BAND_CORRECT**: `trust_label` matches score band.
6. **CAP_RULE_ENFORCED**: if any trigger exists, `overall_score <= 60`.
7. **EMPIRICAL_DOI_RULE**: empirical claims with missing DOI are capped and flagged for human review.
8. **PROVENANCE_FIELDS_PRESENT**: `created_by_phase`, `updated_by_phase`, and `validation_status` present on every claim.
9. **CLAIM_ID_STABLE**: deterministic `claim_id` recomputes as `clm_` plus the first 16
   lowercase hex characters of SHA-256 over `section_id + "\\n" + canonical_claim_text`.
   Canonical text is the exact claim text after Unicode NFKC normalization, trimming, and
   whitespace collapse. Citation keys are excluded so evidence corrections preserve identity.
10. **PASSAGE_PROVENANCE_VALID**: every verified passage has an HTTPS source,
    valid timestamp, locator, and atom attribution.
11. **EVIDENCE_RELATION_DERIVED**: stored relation equals the deterministic
    result from eligible atom coverage/conflict/scope inputs.
12. **SURFACE_WORDING_ATTRIBUTED**: stored wording strength equals the result
    derived from exact prose and the report records its markers.
13. **INDEPENDENCE_BASIS_VALID**: relied-upon citations explain their grouping;
    shared-author sources are not counted as independent.
14. **SCORE_BASIS_MATCHES**: each report record exactly matches the inputs
    reconstructed from the claim graph.

## Output Artifacts

- `knowledge/trust_score_report.json`
- Updated `knowledge/claim_graph.json` with finalized trust scores
- Gate artifact `provenance/gate_trust_scores.json`

## Output Schema

```json
{
  "phase": "trust-score-validation",
  "gate": "pass|fail",
  "claims_checked": 0,
  "checks": {
    "CLAIM_SCHEMA_VALID": "pass|fail",
    "TRUST_SCHEMA_VALID": "pass|fail",
    "ALL_COMPONENTS_SCORED": "pass|fail",
    "OVERALL_FORMULA_CORRECT": "pass|fail",
    "LABEL_BAND_CORRECT": "pass|fail",
    "CAP_RULE_ENFORCED": "pass|fail",
    "EMPIRICAL_DOI_RULE": "pass|fail",
    "PROVENANCE_FIELDS_PRESENT": "pass|fail",
    "CLAIM_ID_STABLE": "pass|fail"
  },
  "failures": [
    {
      "claim_id": "clm_...",
      "check": "CAP_RULE_ENFORCED",
      "details": "direction mismatch detected but score not capped"
    }
  ]
}
```

Gate is `pass` only when all checks pass.
