# Scientific review version diff

From **1.0.0** (release-example-v1-0-0) to **1.1.0** (release-example-v1-1-0).

> TRUST values are compared from immutable inputs; this tool does not recompute them.

## Summary

- Claims: 1 added, 1 removed, 1 modified, 1 unchanged.
- TRUST overall changed: 1.
- TRUST records added or removed with claims: 2.
- Evidence basis changed: 1.
- Evidence-basis records added or removed with claims: 2.
- Added human decision references: 2.
- Orphaned anchors: 1.

## Claims

| Status | Before → after | Claim text | Citations | Evidence basis | TRUST components / overall | Human decisions |
| --- | --- | --- | --- | --- | --- | --- |
| modified | clm_aaaaaaaaaaaaaaaa → clm_bbbbbbbbbbbbbbbb | The intervention improves the measured outcome. ⇒ Across the sampled population, the intervention is associated with an improved measured outcome. | +SourceB | changed | robustness 2→4; source_integrity 3→4; transferability_scope_control 3→4; overall 80→100 | +decision-example-0003 |
| removed | clm_cccccccccccccccc → — | A preliminary subgroup pattern was observed. | -SourceC | changed | traceability 3→—; robustness 1→—; uncertainty_calibration 3→—; source_integrity 3→—; transferability_scope_control 2→—; overall 60→— | -decision-example-0002 |
| unchanged | clm_eeeeeeeeeeeeeeee → clm_eeeeeeeeeeeeeeee | The comparator protocol remained unchanged. | unchanged | unchanged | overall 100 | unchanged |
| added | — → clm_dddddddddddddddd | The effect estimate is bounded to the prespecified sampled population. | +SourceB | changed | traceability —→4; robustness —→3; uncertainty_calibration —→4; source_integrity —→4; transferability_scope_control —→4; overall —→95 | +decision-example-0003 |

## Orphaned anchors

- `annotation-subgroup-pattern`: {"kind":"claim","claim_id":"clm_cccccccccccccccc"}
