# TRUST methodological decision log

This log records **only** decisions that affect the scientific meaning of TRUST
or its compatibility with other systems. It is not a general changelog.

Each entry is append-only. Do not edit an accepted decision to change its
meaning; add a new decision that supersedes it and mark the old one
`superseded`. Do not mark a question `accepted` unless the repository already
contains an explicit, justified, and versioned decision — otherwise leave it
`proposed`.

**Status values:** `proposed` · `accepted` · `rejected` · `superseded`.

Entry template:

```
### D00 — <question in a sentence>
- Date:
- Question:
- Decision:
- Rationale:
- Alternatives considered:
- Consequences:
- Must be reviewed by:
- Status:
```

---

The following questions are **open** (`proposed`). They are seeded here as
unresolved on purpose; the current repository does not contain an explicit,
versioned answer to any of them. Agents must not invent an answer — see backlog
rule 10.

### D01 — Is the primary assessment unit a claim or a claim–evidence relation?
- Date: 2026-07-19
- Question: Does one TRUST score describe a claim *as written* in a section, or a
  specific claim–citation (claim–evidence) relation?
- Decision: **Open.** Current implementation attaches `trust_score` to the claim
  object; graph edges to citations carry only a role-derived `weight` (`1`/`0.5`),
  not a per-relation score. This is the de-facto behaviour but has not been
  ratified as the intended contract.
- Rationale: To be decided; the answer governs export shape, disagreement
  representation, and the "attach a claim-level score to every relation"
  prohibition.
- Alternatives considered: (a) claim-level unit with role-weighted relations
  (current); (b) relation-level primary unit with a derived claim rollup;
  (c) both, with an explicit mapping.
- Consequences: Blocks/clarifies TRUST-A01, A02, A04, B02, D01, G01, G02.
- Must be reviewed by: TRUST methodology owner + Jérôme (upstream compatibility).
- Status: proposed

### D02 — Which components are non-compensatory?
- Date: 2026-07-19
- Question: Should any component (e.g. source integrity) act as a gate rather than
  an additive term?
- Decision: **Open.** Today only the fixed cap-at-60 conditions (unsupported
  citation, direction mismatch, contradiction-without-caveat, invented reference,
  missing DOI on empirical claims, overextended scope) constrain the aggregate;
  no component is a pure gate.
- Rationale: To be decided against the benchmark (TRUST-F01) and weighting review
  (TRUST-B04).
- Alternatives considered: additive-only (current) vs integrity/traceability
  gates vs configurable gates per domain.
- Consequences: Governs TRUST-B05, B04, B06.
- Must be reviewed by: methodology owner + domain expert.
- Status: proposed

### D03 — Should a numerical aggregate remain a primary output?
- Date: 2026-07-19
- Question: Is a single 0–100 score a primary output, or should the five-component
  profile be primary with the aggregate optional?
- Decision: **Open.** Aggregate is currently primary in the viewer.
- Rationale: To be decided; bears directly on the "aggregate as probability" and
  "hide disagreement behind an average" prohibitions.
- Alternatives considered: aggregate-primary (current); profile-primary with
  optional aggregate (TRUST-B03); profile-only.
- Consequences: Governs TRUST-B03, E01/E03 copy.
- Must be reviewed by: methodology owner.
- Status: proposed

### D04 — Are equal component weights defensible?
- Date: 2026-07-19
- Question: Is equal weighting of the five components, added compensatorily,
  defensible?
- Decision: **Open.** Current rubric uses `5 × Σ(components)` — equal weights,
  fully compensatory.
- Rationale: Equal weighting is an assumption, not a neutral default; needs
  evidence (TRUST-F01/B06).
- Alternatives considered: equal (current); expert-elicited weights;
  data-derived weights; gated (see D02).
- Consequences: Governs TRUST-B04, B06.
- Must be reviewed by: methodology owner + statistician/expert.
- Status: proposed

### D05 — How should missing information affect presentation?
- Date: 2026-07-19
- Question: How are "not assessed" and "not applicable" represented and displayed
  so they never read as "assessed and low"?
- Decision: **Open.** Today an unsupported/uncited claim scores 0 →
  `critical_or_unreliable`, conflating missing information with a low assessment.
- Rationale: Directly implicates the "convert missing information into a low
  score" prohibition.
- Alternatives considered: explicit not-assessed/not-applicable states excluded
  from the aggregate; a separate "coverage" indicator; suppress aggregate when
  coverage is incomplete.
- Consequences: Blocks TRUST-B02; informs E01/E03.
- Must be reviewed by: methodology owner.
- Status: proposed

### D06 — What constitutes independent evidence?
- Date: 2026-07-19
- Question: What bases (authors, lab, dataset, cohort, funding, infrastructure)
  make two citations independent for robustness scoring?
- Decision: **Open.** Current rule: different non-empty `independence_group`
  strings *plus* a recorded basis; shared authors force one group; other shared
  infrastructure "must be grouped conservatively." The enumerated bases are not
  yet formalized.
- Rationale: Robustness (R component) depends entirely on this.
- Alternatives considered: author-only; structured multi-factor (TRUST-A06);
  reviewer-declared with audit.
- Consequences: Governs TRUST-A06; affects R scoring.
- Must be reviewed by: methodology owner + domain expert.
- Status: proposed

### D07 — What can an agent assess deterministically?
- Date: 2026-07-19
- Question: Which parts of an assessment are deterministic (mechanical validation)
  vs. requiring judgment (passage verification, atom entailment)?
- Decision: **Open.** The rubric already states the validator "does not pretend
  that string matching can establish scientific entailment," and that passage
  verification / atom attribution come from the citation-validation phase — but
  the deterministic/judgment boundary is not enumerated as a contract.
- Rationale: Defines what an autonomous agent may finalize vs. must escalate.
- Alternatives considered: n/a — needs enumeration.
- Consequences: Informs agent rules, TRUST-C01/C02, D02.
- Must be reviewed by: methodology owner.
- Status: proposed

### D08 — What requires domain-expert judgment?
- Date: 2026-07-19
- Question: Which decisions must be escalated to a domain expert rather than
  decided by an agent or generic reviewer?
- Decision: **Open.**
- Rationale: Backlog rule 14 requires items to be marked `blocked` when expert
  judgment is required; this decision defines the trigger list.
- Alternatives considered: n/a.
- Consequences: Sets which backlog items are `no`/`blocked`.
- Must be reviewed by: methodology owner + domain expert.
- Status: proposed

### D09 — How should disagreement be represented?
- Date: 2026-07-19
- Question: When assessments disagree, how is the disagreement stored and shown?
- Decision: **Open.** No multi-assessment/disagreement model exists on `main`
  (draft PR #5 adds version-bound human stances support/dispute/qualify, kept
  separate from the score).
- Rationale: "Hide disagreement behind an average" is prohibited.
- Alternatives considered: list all assessments; show a range/dispersion; require
  adjudication; never aggregate.
- Consequences: Blocks TRUST-D03; informs D01/D04, E05.
- Must be reviewed by: methodology owner.
- Status: proposed

### D10 — What evidence would be required to call the framework calibrated or validated?
- Date: 2026-07-19
- Question: What expert-rated evidence and agreement thresholds justify the words
  "calibrated" or "validated"?
- Decision: **Open.** No such evidence exists; agreement between agents does not
  count (prohibited shortcut).
- Rationale: Prevents overclaiming validation.
- Alternatives considered: n/a — requires real expert data (TRUST-F01/F02).
- Consequences: Blocks any "validated"/"calibrated" language; gates F workstream.
- Must be reviewed by: methodology owner + statistician + domain experts.
- Status: proposed

### D11 — How should native TRUST be exported without semantic reinterpretation?
- Date: 2026-07-19
- Question: What is the source-native export contract, and what marker prevents an
  export from being read as an ORAtlas-native (re-adjudicated) assessment?
- Decision: **Open.** No exporter exists on `main`; draft PR #8 adds a
  federation/nanopublication adapter whose semantic markers must be reviewed
  against this decision.
- Rationale: Prohibitions against silent protocol translation and
  overstated-validation UI.
- Alternatives considered: JSON source-native + provenance marker; JSON-LD /
  nanopublication (PR #8); RO-Crate capsule (PR #7).
- Consequences: Governs TRUST-G01, G02, G04, G05.
- Must be reviewed by: methodology owner + ORAtlas integration owner.
- Status: proposed

### D12 — Which changes should be proposed upstream to Jérôme's template?
- Date: 2026-07-19
- Question: Which extension changes are candidates to contribute back to
  `AllenNeuralDynamics/ComputationalReviewTemplate` vs. stay fork-local?
- Decision: **Open.**
- Rationale: Keeps the extension boundary maintainable (backlog rule 12).
- Alternatives considered: keep all TRUST work fork-local; propose the
  claim-anchoring/validator hooks upstream; propose only the pipeline-phase
  extension points.
- Consequences: Governs TRUST-G03.
- Must be reviewed by: methodology owner + Jérôme (upstream maintainer).
- Status: proposed
