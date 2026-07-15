# TRUST scoring rubric

Version: `2.0.0`

TRUST is an audit score for a claim as written. It is not a score for a paper, an
author, or a topic. The inputs are citation-level verification records and the
claim's wording and scope. Once those inputs have been verified, every component
and the overall score are computed mechanically. Writers and reviewers never type
an overall score.

## Required inputs

Every scored claim has:

- an exact, contiguous plain-text excerpt from the rendered review in
  `claim_text`;
- atomic propositions in `claim_atoms`, each of which is an exact substring of
  `claim_text`;
- one `citation_context` per cited source, with the atoms it supports; its atom
  list must equal the union of its verified passages' atom lists;
- one or more short, verbatim source passages for every supporting citation,
  each including a locator, verification state, HTTPS `verification_source`,
  `verified_at` timestamp, and `supports_claim_atoms`;
- explicit source type, bibliographic status, integrity status, direction match,
  independence group with a written `independence_basis`, and scope match;
- claim-level evidence relation and scope status.

The automated score is only as sound as these inputs. Passage verification and
semantic atom attribution are performed by the citation-validation phase and may
be challenged in human review. The TRUST validator checks that the record is
complete and applies the tables below; it does not pretend that string matching
can establish scientific entailment.

## Deterministic text normalization and claim IDs

1. `exact_text` is `claim_text` normalized with Unicode NFKC, trimmed, and with
   every run of Unicode whitespace replaced by one ASCII space. Case and
   punctuation are retained.
2. The identity preimage is exactly:

   ```text
   <section_id>\n<exact_text>
   ```

   where `\n` is one LF byte and there is no final newline.
3. Encode the preimage as UTF-8, compute SHA-256, take the first 16 lowercase
   hexadecimal characters, and prefix `clm_`.
4. `normalized_claim` is `exact_text` lowercased with locale `en-US`, with every
   run of Unicode punctuation or symbol characters replaced by one space, then
   whitespace-collapsed and trimmed.

Changing wording or section changes the ID. Changing citations, scores, or file
position does not. Sixteen hexadecimal characters are the canonical length; a
collision is a hard gate failure and must be resolved by moving to a longer
digest for every claim in the corpus, never by hand-editing one ID.

## Eligible support

A citation is eligible support only when all of these are true:

- `bibliography_status = verified` and its key/DOI agree with the bibliography;
- `integrity_status = verified_no_known_issue`;
- `direction_match = true`;
- role is `direct_support` or `partial_support`;
- at least one passage has `verification_status = verified`, a locator, an
  HTTPS verification source, and a valid, non-future verification timestamp;
- `supports_claim_atoms` is non-empty.

`background`, `method_reference`, `review_context`, `contradictory`, and
`unverified` citations are retained for attribution but are not eligible support.
Two citations are independent only if their non-empty `independence_group` values
differ and the recorded basis supports the distinction. Merely assigning different
strings is not evidence of independence. Sources with shared authors are treated as
one group by default; an author-overlap/different-group combination is a hard gate
failure. Other shared laboratories, datasets, cohorts, or study infrastructure must
also be grouped conservatively during citation verification and explained in
`independence_basis`.

## Component decision tables

Rules are evaluated from top to bottom within the relevant table. The first
matching rule supplies both the integer score and the stored `rule_id`.

### T — Traceability

| Rule | Score | Mechanical condition |
|---|---:|---|
| `T0_UNRESOLVED` | 0 | No citation for a citation-requiring claim; a cited key/context/DOI is missing or mismatched; or any cited source is invented. |
| `T1_METADATA_ONLY` | 1 | All cited keys have contexts, but no eligible citation has a verified passage and locator. |
| `T2_PARTIAL_RECORD` | 2 | At least one eligible citation has a verified passage and locator, but another supporting citation has an unverified/missing passage or locator. |
| `T3_ATOMS_INCOMPLETE` | 3 | Every supporting citation has verified passage attribution, but eligible citations do not cover every claim atom. |
| `T4_ATOM_LEVEL` | 4 | Every supporting citation has verified passage attribution and eligible citations cover every claim atom. |

### R — Robustness

Historical attribution, definition, and method-description claims are evaluated
by the attribution table. Other empirical, causal, comparative, and synthesis
claims use the empirical table. A direct source is `source_type = primary` and
`role = direct_support`.

Attribution table (`methodological` and `definition`):

| Rule | Score | Mechanical condition |
|---|---:|---|
| `R0_ATTRIBUTION_UNSUPPORTED` | 0 | No eligible citation. |
| `R1_ATTRIBUTION_INDIRECT` | 1 | Eligible support exists only in a review or background source. |
| `R2_ATTRIBUTION_PARTIAL` | 2 | An eligible primary source covers some, but not all, atoms. |
| `R3_ATTRIBUTION_COMPLETE` | 3 | Eligible sources cover every atom, but no single direct primary source covers every atom. |
| `R4_ORIGINATING_SOURCE` | 4 | A direct primary source covers every atom and there is no unresolved contradiction. |

Empirical table (`empirical`, `causal`, `comparative`, `review_synthesis`,
`limitation`, and `speculation`):

| Rule | Score | Mechanical condition |
|---|---:|---|
| `R0_NO_SUPPORT` | 0 | No eligible citation. |
| `R1_SOME_ATOMS` | 1 | Eligible sources cover only some atoms. |
| `R2_SINGLE_GROUP` | 2 | Every atom is covered, but by only one independent group in total. |
| `R3_CONVERGENT` | 3 | Every atom is covered and at least two independent groups support the claim, but at least one atom has support from only one group. |
| `R4_REPLICATED_PER_ATOM` | 4 | Every atom is supported by at least two independent groups and there is no unresolved contradiction. |

### U — Uncertainty calibration

The validator derives a surface-wording basis from `claim_text`, not directive
metadata. Conflict markers are classified as `contested`; evidential markers such
as “suggests”, “indicates”, “can”, “could”, “may”, or “might” are classified as
`qualified`; otherwise wording is `unqualified`. For `methodological` and
`definition` claims, explicit reporting verbs such as “proposed”, “argued”,
“reported”, “defined”, “introduced”, or “added” establish an attribution frame,
which is `unqualified` about what the cited source said even when the attributed
proposal itself contains a hedge. The exact markers and surface rule are emitted
as `score_basis.wording_basis` in the score report. Stored `wording_strength` must
match this derived result or the gate fails.

| Rule | Score | Mechanical condition |
|---|---:|---|
| `U0_OVERSTATED` | 0 | Wording is unqualified while evidence is unsupported, conflicted, indirect, or overextended; or directive modality contradicts surface wording. |
| `U1_WEAK_HEDGE` | 1 | Evidence is unsupported/overextended but wording is qualified without saying that direct support is absent. |
| `U2_CONFLICT_DISCLOSED` | 2 | Evidence is conflicted and the conflict is disclosed, or evidence is partial/indirect and wording is unqualified but otherwise bounded. |
| `U3_CALIBRATED` | 3 | Partial/indirect evidence is qualified, or direct evidence is responsibly bounded while limitations remain. |
| `U4_EXACT_CALIBRATION` | 4 | Direct evidence supports every atom and wording strength matches the evidence; or the sentence accurately attributes a proposal/argument to its source. |

`evidence_relation` is derived from eligible passage-to-atom coverage, conflicts,
and scope state; it is never accepted as an independent scoring input. Complete
eligible atom coverage is `directly_supported`, incomplete non-empty coverage is
`partially_supported`, attributable review/background coverage is
`indirectly_supported`, conflict records or contradictory contexts are
`conflicted`, an overextended scope is `overextended`, and no attributable
coverage is `unsupported`. The stored value must match the derivation.

The validator implements this exact mapping: derived `directly_supported` plus
matching surface wording gives 4; `partially_supported`/`indirectly_supported`
plus `qualified` gives 3; `conflicted` plus `contested` gives 2;
unsupported/overextended plus `qualified` gives 1; other mismatches give 0.

### S — Source integrity

| Rule | Score | Mechanical condition |
|---|---:|---|
| `S0_COMPROMISED` | 0 | Any relied-upon source is invented, retracted, bibliographically mismatched, or direction-mismatched. |
| `S1_UNRESOLVED` | 1 | Any relied-upon source key or DOI is unresolved. |
| `S2_UNCHECKED` | 2 | Sources resolve, but all relied-upon sources have `integrity_status = not_checked`. |
| `S3_MIXED_CHECKS` | 3 | All sources resolve and at least one is integrity-verified, but another relied-upon source is not checked or is non-primary. |
| `S4_VERIFIED_PRIMARY` | 4 | Every relied-upon source is primary, DOI-linked, integrity-verified, direction-matched, and has a verified source passage. |

`verified_no_known_issue` means that the registry/publisher record in the
non-empty HTTPS `integrity_check_source` was checked at `integrity_checked_at`;
it is not a permanent guarantee. A verified status with a missing source or a
future/invalid timestamp is a hard validation failure.

### T — Transferability and scope control

| Rule | Score | Mechanical condition |
|---|---:|---|
| `X0_OVEREXTENDED` | 0 | `scope_status = overextended`, including an unqualified biological, clinical, population, method, or domain transfer. |
| `X1_SCOPE_UNKNOWN` | 1 | Scope cannot be checked or supporting citations have `scope_match = unverified`. |
| `X2_MAJOR_QUALIFIER` | 2 | A material evidence/claim scope difference is explicitly disclosed in the sentence. |
| `X3_MINOR_QUALIFIER` | 3 | Only a minor scope difference remains and the sentence bounds it. |
| `X4_SCOPE_MATCHED` | 4 | `scope_status = matched` and every eligible citation is `exact` or `not_applicable`. |

The prefix `X` avoids ambiguity between the two T components in machine-readable
rule IDs. The component field remains `transferability_scope_control`.

## Overall score, labels, and caps

```text
raw_score = 5 * (
  traceability + robustness + uncertainty_calibration +
  source_integrity + transferability_scope_control
)
overall_score = min(raw_score, cap_value) when a cap is triggered
overall_score = raw_score otherwise
```

No rounding is needed; valid scores are multiples of five.

| Overall | Label |
|---:|---|
| 85–100 | `high_trust` |
| 70–84 | `moderate_trust` |
| 50–69 | `low_trust` |
| 0–49 | `critical_or_unreliable` |

### Mandatory cap semantics

The cap ceiling is 60 when any of these conditions occurs:

- `unsupported_citation`
- `direction_mismatch`
- `contradicted_without_caveat`
- `invented_reference`
- `missing_doi_empirical`
- `overextended_scope`

`capped` means a cap condition was triggered, even when the raw score was already
at or below 60. `cap_value` is `60` when triggered and `null` otherwise.
`cap_reasons` contains every triggered condition in the enum order above, and
`cap_reason` repeats the first item for backwards-compatible display. Thus a
non-binding cap is transparent rather than silently lost.

There are no score overrides. Human reviewers submit comments, challenges, and
proposed changes to verification inputs; accepted changes cause the validator to
recompute a new score. A human opinion never replaces the mechanical result.

`knowledge/trust_score_report.json` exposes a deterministic `score_basis` for
each claim: the exact claim text, eligible citations and DOIs, verified passage
locators, atom coverage, independence groups per atom, derived evidence relation,
surface-wording basis, modality, and scope status. The validator reconstructs this
object from `claim_graph.json` and fails if the report differs, so readers can trace
every component score without trusting hand-written rationales alone.

## Gate policy

The TRUST gate passes only if:

- all claim IDs, normalized text, atom substrings, citation mappings, component
  rules, totals, labels, caps, graph edges, summaries, and derived indexes agree;
- each claim text is found as an exact contiguous excerpt in rendered prose;
- every directive resolves to its claim and repeats the exact claim and citations;
- all generated artifacts identify the same rubric/schema version;
- high or moderate claims do not require human review.

Run:

```bash
node scripts/validate-trust.js
node scripts/test-trust-validator.js
```
