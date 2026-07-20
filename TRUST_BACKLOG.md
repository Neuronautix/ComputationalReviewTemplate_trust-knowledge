# TRUST Knowledge extension backlog

Canonical, agent-executable backlog for the claim-knowledge and TRUST layer that
this repository adds on top of
[`AllenNeuralDynamics/ComputationalReviewTemplate`](https://github.com/AllenNeuralDynamics/ComputationalReviewTemplate).

This is the single source of truth for planned TRUST work. It is written to be
read by both humans and autonomous coding agents. Companion files:

- [`TRUST_DECISIONS.md`](TRUST_DECISIONS.md) — methodological decision log for
  questions that affect scientific meaning or compatibility.
- [`docs/HUMAN_REVIEW_AND_PUBLICATION.md`](docs/HUMAN_REVIEW_AND_PUBLICATION.md)
  — the pre-existing RFC for human review and archive publication. It contains
  its own dependency-ordered `PR-A … PR-J` implementation plan for the archive
  layer. That plan is **retained** and is not superseded by this file; this
  backlog references it from workstreams D and G rather than restating it.

## What TRUST is (and is not)

TRUST is a **transparent, versioned, challengeable evidence-audit framework**.
For a claim *as written*, it records which citations were checked, which exact
passages were verified, how atoms are attributed, and how well the recorded
evidence supports the wording — then computes component scores mechanically from
that record. TRUST is **not** a universal probability that a scientific claim is
true, and it is **not** a ranking of papers, authors, labs, or journals. Every
score must remain traceable to its inputs and open to challenge.

## Repository responsibility

**Owns:** claim extraction and identity; claim–citation knowledge
representation; native Computational-Review TRUST schemas and rubric;
deterministic TRUST validation; assessment provenance; multiple assessments and
disagreement representation; embedded claim/TRUST visualization; benchmark and
calibration infrastructure; source-native export formats; synchronization with
the upstream template.

**Does not own:** the generic computational-review pipeline (except where an
extension is genuinely required); the ORAtlas archive, discussion, or editorial
workflows; cross-review public discussion threads; scientific peer review;
automatic publication or adjudication; a universal scientific-quality score.

---

## Non-goals and prohibited shortcuts

These are hard project-level prohibitions. A PR that does any of these must be
rejected regardless of how convenient it is. The project must **not**:

- Score laboratories, institutions, journals, or authors by prestige.
- Treat p-values as direct trust scores.
- Treat citation count as evidence quality.
- Treat several agreeing agents as scientific validation.
- Present an aggregate as a probability that a claim is true.
- Hide disagreement behind an average.
- Convert missing information into a low score.
- Replace human review with agent consensus.
- Silently overwrite historical assessments.
- Silently translate native TRUST components into another protocol.
- Attach a claim-level score to every relation without preserving the original
  assessment unit.
- Allow UI presentation to imply more validation than the underlying record
  supports.
- Add complex infrastructure before the core contracts and tests are stable.

---

## Recommended first implementation tranche

Do these first, in roughly this order. They establish **correctness of the
contracts and the fail-loud paths** before any new feature surface is added.
None of them changes the scientific rubric; each is small and independently
reviewable.

| Order | Item | Why it comes first |
|---|---|---|
| 1 | **TRUST-A01** — Document the exact assessment unit | Every later item (relations, disagreement, export, aggregation) depends on a written, unambiguous answer to "what does one TRUST score describe?". Doc-only, zero code risk, unblocks A02/B02/D01/G02. |
| 2 | **TRUST-C03** — Fail loud on missing/malformed knowledge artifacts | The runtime widget and plugin currently fall back to empty state silently (`safeJsonParse`, silent `kb-path` reads). Silent degradation lets the UI imply an assessment exists when the record is absent — a correctness/integrity bug, not a feature. |
| 3 | **TRUST-E01** — Single coordinated detail panel | Each widget toggles its own `is-open` independently, so several TRUST pop-ups can be open at once. Fixing this is contained, testable, and removes a confusing interaction before more panel content is added. |
| 4 | **TRUST-E02** — Safari/WebKit interaction regression tests | Current tests run only against a Node mock DOM. The highlight path uses `splitText`/`normalize()`/`<details>`, which behave differently on WebKit. Foundational test coverage must exist before E01 and future viewer work land. |
| 5 | **TRUST-G01** — Guarantee exports are labelled source-native | Export code does not yet exist on `main`, but draft PR #8 introduces a federation/nanopublication adapter. Establish the "must carry an explicit source-native provenance marker; must not be presented as ORAtlas-native" contract *now*, as a schema/test guardrail, before any exporter merges. |

Rationale in one line: **clarify the contract, make loading fail loud, fix the
one clearly-wrong interaction, add the missing test surface, and fence the
export semantics — all before touching methodology or adding lifecycle
features.**

---

## Rules for autonomous agents

1. Work on one backlog item per branch and pull request unless two items are
   genuinely inseparable.
2. Read the item, its dependencies, and the relevant schemas before editing
   code.
3. Do not change the TRUST methodology incidentally while fixing a UI or
   validation issue.
4. Do not silently migrate existing assessment records.
5. Do not invent human review, expert agreement, or validation data.
6. Preserve source records and provenance.
7. Add or update tests for every behavioural or contract change.
8. Run the relevant tests, linting, type checks, and schema checks before
   opening a PR (`node scripts/validate-trust.js`,
   `node scripts/test-trust-validator.js`,
   `node scripts/validate-community-contracts.js`, `node --test tests/*.test.mjs`).
9. Update the backlog item status and link the PR.
10. Record unresolved methodological decisions in `TRUST_DECISIONS.md` instead
    of choosing arbitrary scientific rules.
11. Do not merge source-native TRUST semantics with ORAtlas semantics.
12. Do not modify the upstream review pipeline unless the extension genuinely
    requires it.
13. Prefer small, reviewable PRs over large autonomous refactors.
14. Stop and mark an item `blocked` when expert judgment is required.

---

## How to read a backlog item

Each item carries: **Status** (`backlog` · `ready` · `in-progress` · `blocked` ·
`review` · `done` · `superseded`), **Priority** (`P0` correctness / data
integrity / misleading scientific representation · `P1` required for a reliable
first public version · `P2` valuable after the core is stable · `P3`
exploratory), **Estimated size** (S/M/L), and **Suitable for autonomous agent**
(`yes` · `conditional` · `no`). `conditional` means an agent may do the
mechanical part but must stop at a marked decision point; `no` means the item
needs human/expert judgment before any code is written.

### Priority totals

- **P0:** 12
- **P1:** 12
- **P2:** 7
- **P3:** 5
- **Total:** 36

### In-flight work to avoid duplicating

Draft PRs **#5–#8** (`dhuzard`, stacked `proposal/03…06`) already implement large
parts of workstreams D and G: version-bound human annotations (#5), advisory
evidence agents (#6), verified review deltas + RO-Crate capsules (#7), and a
federated archive/nanopublication adapter (#8). They are **open drafts, not on
`main`**, and reference docs (`UPSTREAM_TRUST_IMPROVEMENTS.md`,
`RELEASE_ARTIFACTS.md`, `EVIDENCE_RADAR.md`, `AUTONOMOUS_TRUST_AGENTS.md`) that do
not yet exist on `main`. Before starting any D or G item, check whether the open
PR already covers it and coordinate rather than fork a competing implementation.

---

## Workstream A — Foundations and contracts

*Claim identity, claim atoms, citation relations, evidence pointers, schemas,
versioning, provenance.*

### TRUST-A01 — Document the exact assessment unit of native TRUST
- **Status:** ready
- **Priority:** P0
- **Goal:** State in one authoritative place what a single TRUST score is
  attached to (a claim *as written* in a section), and how that relates to
  claim atoms and to claim–citation relations.
- **Why it matters:** Every downstream contract (relations, disagreement,
  export, aggregation) is ambiguous until this is written down. It is also the
  guardrail against the "attach a claim-level score to every relation" shortcut.
- **Scope:** A short "Assessment unit" section in `knowledge/TRUST_RUBRIC.md`
  (and a cross-link from the README); resolve decision **D01** in
  `TRUST_DECISIONS.md` or explicitly record it as still open.
- **Non-goals:** Changing scoring; adding relation-level scores; editing schemas.
- **Dependencies:** none.
- **Acceptance criteria:** The rubric states the unit unambiguously; the claim
  vs claim–evidence-relation question (D01) is either resolved with rationale or
  marked `proposed`; no schema or score changes in the diff.
- **Suggested files:** `knowledge/TRUST_RUBRIC.md`, `README.md`,
  `TRUST_DECISIONS.md`.
- **Size:** S · **Autonomous:** conditional (must not invent a resolution to D01)

### TRUST-A02 — Audit whether claim-level scores are copied to claim–citation relations
- **Status:** ready
- **Priority:** P0
- **Goal:** Prove, with a test, that graph edges to citations carry only a
  role-derived weight (`1`/`0.5`) and never the claim's overall TRUST score.
- **Why it matters:** Conflating the claim-level score with per-relation weight
  would misrepresent how strongly any single citation supports the claim.
- **Scope:** Add a regression asserting edge `weight`/`relation` are derived from
  `role` only (see `scripts/validate-trust.js` edge checks); document the
  invariant in the schema description.
- **Non-goals:** Redesigning the edge model; adding relation-level scoring.
- **Dependencies:** TRUST-A01.
- **Acceptance criteria:** A failing test is added that would trip if any edge
  weight equalled `overall_score/100` or similar; validator still passes.
- **Suggested files:** `scripts/validate-trust.js`,
  `knowledge/schemas/claim_graph.schema.json`, `tests/`.
- **Size:** S · **Autonomous:** yes

### TRUST-A03 — Preserve component-level records as authoritative
- **Status:** backlog
- **Priority:** P0
- **Goal:** Make the five component records (`score`, `rule_id`, `rationale`,
  `evidence`) the authoritative store, with `overall_score` explicitly a derived
  view.
- **Why it matters:** If the aggregate is ever treated as the primary record,
  component transparency and challengeability are lost.
- **Scope:** Document/annotate in the schema and rubric that components are
  authoritative and the overall is computed; add a validator assertion that the
  stored overall equals the recomputed component aggregate (already checked —
  formalize and label it).
- **Non-goals:** Changing component definitions or weights.
- **Dependencies:** TRUST-A01.
- **Acceptance criteria:** Schema/rubric wording added; a named check asserts
  aggregate == derived-from-components.
- **Suggested files:** `knowledge/schemas/trust_score.schema.json`,
  `knowledge/TRUST_RUBRIC.md`, `scripts/validate-trust.js`.
- **Size:** S · **Autonomous:** yes

### TRUST-A04 — Version all schemas, rubrics, and aggregation methods
- **Status:** backlog
- **Priority:** P0
- **Goal:** Give the aggregation/scoring **method** its own explicit version
  identifier, separate from `schema_version`/`rubric_version`, recorded in every
  generated artifact.
- **Why it matters:** Today `schema_version` and `rubric_version` are pinned to
  `2.0.0`, but the aggregation method (equal weights, cap ceiling of 60) is not
  independently versioned, so a methodology change could silently reuse the same
  version.
- **Scope:** Add a `method_version` (or equivalent) to the trust-score schema and
  to `claim_graph.json`/report/gate; validator asserts consistency.
- **Non-goals:** Changing the aggregation itself (that is B04/B06).
- **Dependencies:** TRUST-A01, TRUST-A03.
- **Acceptance criteria:** All generated artifacts carry a method version; a
  mismatch fails the gate; migration path noted (see B07).
- **Suggested files:** `knowledge/schemas/*.json`, `scripts/validate-trust.js`,
  `knowledge/*.json`, `provenance/gate_trust_scores.json`.
- **Size:** M · **Autonomous:** conditional (coordinate with A01/B04)

### TRUST-A05 — Add claim-to-claim relations and contradiction representation
- **Status:** backlog
- **Priority:** P2
- **Goal:** Represent relations between claims (supports / contradicts /
  depends-on / scopes) and contradictions as first-class graph data.
- **Why it matters:** Disagreement and synthesis cannot be shown honestly if
  claim–claim contradictions are not representable.
- **Scope:** Extend `edges` usage (schema already allows `target_type: claim`);
  add validation and fixtures; keep it descriptive, not scored.
- **Non-goals:** Auto-detecting contradictions with an LLM as ground truth.
- **Dependencies:** TRUST-A01, TRUST-C01/C02.
- **Acceptance criteria:** Claim–claim edges validate; a contradiction fixture is
  covered; no new scoring semantics introduced.
- **Suggested files:** `knowledge/schemas/claim_graph.schema.json`,
  `scripts/validate-trust.js`, `knowledge/claim_graph.json`.
- **Size:** M · **Autonomous:** conditional

### TRUST-A06 — Add richer evidence-independence metadata
- **Status:** backlog
- **Priority:** P2
- **Goal:** Extend `independence_group`/`independence_basis` with structured
  bases (shared authors, lab, dataset, cohort, funding) rather than a free
  string.
- **Why it matters:** Robustness scoring hinges on independence; structured bases
  make the conservative grouping auditable.
- **Scope:** Optional structured fields on `citation_contexts`; validator honours
  the existing conservative default; fixtures.
- **Non-goals:** Automatic independence inference.
- **Dependencies:** TRUST-A01.
- **Acceptance criteria:** New fields validate and are optional/back-compatible;
  robustness scoring behaviour is unchanged unless explicitly justified.
- **Suggested files:** `knowledge/schemas/claim_context.schema.json`,
  `scripts/validate-trust.js`.
- **Size:** M · **Autonomous:** conditional

---

## Workstream B — TRUST methodology

*Component definitions, assessment unit, scoring assumptions, caps, missing
information, aggregation, epistemic wording.*

### TRUST-B01 — Clarify that TRUST is not a probability of truth or a ranking
- **Status:** ready
- **Priority:** P0
- **Goal:** Add explicit, prominent wording (rubric + README + viewer copy) that
  TRUST is an evidence-audit score, not P(true) and not a paper/author/journal
  ranking.
- **Why it matters:** Directly prevents the single most damaging
  misinterpretation of the whole framework.
- **Scope:** Wording in `knowledge/TRUST_RUBRIC.md`, `README.md`, and the widget
  header/label copy; no scoring change.
- **Non-goals:** Changing labels' thresholds or maths.
- **Dependencies:** TRUST-A01.
- **Acceptance criteria:** The disclaimer appears in all three surfaces; a test
  asserts the viewer renders the epistemic caveat text.
- **Suggested files:** `knowledge/TRUST_RUBRIC.md`, `README.md`,
  `content/trust-claim-widget.mjs`, `tests/`.
- **Size:** S · **Autonomous:** yes

### TRUST-B02 — Separate "not-assessed", "not-applicable", and genuinely low
- **Status:** blocked
- **Priority:** P0
- **Goal:** Distinguish, in both data and presentation, a component/claim that
  was **not assessed** or is **not applicable** from one that was assessed and
  scored **low**.
- **Why it matters:** Today an unsupported/uncited claim collapses to score 0 →
  `critical_or_unreliable`, which converts missing information into a low score —
  an explicitly prohibited shortcut.
- **Scope:** Introduce explicit not-assessed / not-applicable states in the score
  model and viewer; define how they aggregate (they must not read as low).
- **Non-goals:** Silently migrating existing records; guessing an aggregation
  rule.
- **Dependencies:** TRUST-A01; decisions **D05** (missing information) and **D03**
  (disagreement) in `TRUST_DECISIONS.md`.
- **Acceptance criteria:** Not-assessed/not-applicable are representable and
  visually distinct from low; aggregation of missing info is decided in D05, not
  invented; regression fixtures added.
- **Suggested files:** `knowledge/schemas/trust_score.schema.json`,
  `knowledge/TRUST_RUBRIC.md`, `scripts/validate-trust.js`,
  `content/trust-claim-widget.mjs`.
- **Size:** L · **Autonomous:** no (needs D05 resolved first)

### TRUST-B03 — Add a profile-only display mode without an aggregate score
- **Status:** backlog
- **Priority:** P1
- **Goal:** Offer a viewer mode that shows the five component profile with no
  single headline number.
- **Why it matters:** Lets readers evaluate the evidence audit without anchoring
  on a possibly-misleading aggregate.
- **Scope:** Viewer option + copy; the aggregate remains available but optional.
- **Non-goals:** Removing the aggregate for everyone (that is decision D03/D... —
  see D03 numeric-aggregate question).
- **Dependencies:** TRUST-A03; decision **D03**.
- **Acceptance criteria:** A profile-only mode renders all five components and no
  aggregate; tested.
- **Suggested files:** `content/trust-claim-widget.mjs`,
  `plugins/trust-claim-plugin.mjs`, `tests/`.
- **Size:** M · **Autonomous:** conditional

### TRUST-B04 — Review equal weighting and compensatory assumptions
- **Status:** blocked
- **Priority:** P1
- **Goal:** Assess whether equal component weights and fully compensatory
  addition are defensible.
- **Why it matters:** Equal weighting is a scientific assumption, not a neutral
  default; a high T can currently offset a low S.
- **Scope:** Analysis + a written recommendation into `TRUST_DECISIONS.md`
  (**D04**); no code change without a decision.
- **Non-goals:** Changing weights unilaterally.
- **Dependencies:** TRUST-A01, TRUST-A04.
- **Acceptance criteria:** D04 records the analysis and a proposed direction;
  reviewers named.
- **Suggested files:** `TRUST_DECISIONS.md`, `knowledge/TRUST_RUBRIC.md`.
- **Size:** M · **Autonomous:** no

### TRUST-B05 — Identify possible non-compensatory gates
- **Status:** blocked
- **Priority:** P1
- **Goal:** Determine which components (e.g. source integrity) should act as
  non-compensatory gates rather than additive terms.
- **Why it matters:** Some failures (retraction, invented reference) should cap
  or gate regardless of other strengths; the current model uses a fixed 60 cap
  for specific reasons only.
- **Scope:** Proposal into `TRUST_DECISIONS.md` (**D02**); enumerate candidate
  gates and their triggers.
- **Non-goals:** Implementing gates before D02 is accepted.
- **Dependencies:** TRUST-B04.
- **Acceptance criteria:** D02 lists candidate non-compensatory components with
  rationale and consequences.
- **Suggested files:** `TRUST_DECISIONS.md`.
- **Size:** M · **Autonomous:** no

### TRUST-B06 — Compare alternative aggregation methods
- **Status:** backlog
- **Priority:** P2
- **Goal:** Empirically compare additive vs weighted vs gated aggregation on the
  benchmark set.
- **Why it matters:** A defensible aggregation choice needs evidence, not
  assertion.
- **Dependencies:** TRUST-F01 (benchmark), TRUST-B04, TRUST-A04.
- **Acceptance criteria:** A reproducible comparison script and a written summary
  in `TRUST_DECISIONS.md`; no default change without a decision.
- **Suggested files:** `scripts/`, `TRUST_DECISIONS.md`.
- **Size:** L · **Autonomous:** no

### TRUST-B07 — Add migration tooling between rubric versions
- **Status:** backlog
- **Priority:** P2
- **Goal:** Provide an explicit, non-silent migration path when rubric/method
  versions change.
- **Why it matters:** Rule 4 forbids silent migration of assessment records.
- **Dependencies:** TRUST-A04.
- **Acceptance criteria:** A migration script that recomputes and records the
  version transition, never overwriting the prior record in place; fixtures.
- **Suggested files:** `scripts/`, `knowledge/`.
- **Size:** M · **Autonomous:** conditional

### TRUST-B08 — Explore domain-specific TRUST profiles
- **Status:** backlog
- **Priority:** P3
- **Goal:** Investigate whether some domains need adjusted component definitions.
- **Dependencies:** TRUST-B04, TRUST-F01.
- **Acceptance criteria:** Exploratory write-up; no default change.
- **Size:** L · **Autonomous:** no

### TRUST-B09 — Explore formal ontology alignment
- **Status:** backlog
- **Priority:** P3
- **Goal:** Explore aligning entities/relations with an external ontology.
- **Dependencies:** TRUST-A05, TRUST-A06.
- **Acceptance criteria:** Feasibility note; no binding commitment.
- **Size:** L · **Autonomous:** conditional

---

## Workstream C — Validation and quality assurance

*Deterministic validation, fixtures, schema tests, regression tests, failure
diagnostics.*

### TRUST-C01 — Validate exact claim-to-prose anchoring
- **Status:** ready
- **Priority:** P0
- **Goal:** Harden the check that every `claim_text` is an exact contiguous
  excerpt of its `paragraph_index`, including the fragile paragraph-splitting
  heuristic in `contentParagraphs`.
- **Why it matters:** A claim that cannot be located in the rendered prose cannot
  be honestly scored or highlighted.
- **Scope:** Strengthen `scripts/validate-trust.js` anchoring; add adversarial
  fixtures (moved prose, directive-stripping edge cases).
- **Non-goals:** Changing claim identity semantics.
- **Dependencies:** TRUST-A01.
- **Acceptance criteria:** Anchoring failures are caught with a clear diagnostic;
  new negative fixtures pass/fail as intended.
- **Suggested files:** `scripts/validate-trust.js`, `tests/`, `content/*.md`.
- **Size:** M · **Autonomous:** yes

### TRUST-C02 — Validate claim atoms and citation-to-atom attribution
- **Status:** ready
- **Priority:** P0
- **Goal:** Extend coverage of the atom-substring and passage-atom-union checks
  with explicit negative fixtures.
- **Why it matters:** Atom attribution is the backbone of traceability and
  robustness scoring.
- **Scope:** Add fixtures where a passage claims an atom it does not support, or a
  context's atoms diverge from its verified passages' union.
- **Non-goals:** Semantic entailment checking (out of deterministic scope).
- **Dependencies:** TRUST-A01.
- **Acceptance criteria:** Each attribution invariant has at least one negative
  fixture; validator diagnostics name the offending atom/passage.
- **Suggested files:** `scripts/validate-trust.js`,
  `scripts/test-trust-validator.js`, `tests/`.
- **Size:** M · **Autonomous:** yes

### TRUST-C03 — Prevent silent loading of missing or malformed knowledge artifacts
- **Status:** ready
- **Priority:** P0
- **Goal:** Make the runtime plugin/widget fail **loud and visible** when a
  knowledge artifact is missing or malformed, instead of silently rendering an
  empty/pending state.
- **Why it matters:** `safeJsonParse` and the plugin's `kb-path` read currently
  degrade silently, which can make the UI imply an assessment exists when the
  record is absent — an integrity problem.
- **Scope:** Detect missing/malformed data in `plugins/trust-claim-plugin.mjs`
  and `content/trust-claim-widget.mjs`; render an explicit error/absent state
  distinct from "pending validation"; add tests.
- **Non-goals:** Changing scoring; changing the schema.
- **Dependencies:** none.
- **Acceptance criteria:** A missing/malformed artifact produces a visible,
  distinct error state (not silent empty); regression tests cover both plugin
  and widget paths.
- **Suggested files:** `plugins/trust-claim-plugin.mjs`,
  `content/trust-claim-widget.mjs`, `tests/`.
- **Size:** M · **Autonomous:** yes

### TRUST-C04 — Strengthen fixtures and failure diagnostics
- **Status:** backlog
- **Priority:** P1
- **Goal:** Grow the deterministic fixture set (valid + adversarial) and make
  every validator failure message actionable.
- **Why it matters:** Autonomous agents rely on precise diagnostics to fix issues
  safely.
- **Scope:** Consolidate fixtures; ensure each error path has a test; audit
  diagnostic wording.
- **Dependencies:** TRUST-C01, TRUST-C02, TRUST-C03.
- **Acceptance criteria:** Coverage of each validator branch; diagnostics name
  file, claim, and rule.
- **Suggested files:** `scripts/`, `tests/`.
- **Size:** M · **Autonomous:** yes

---

## Workstream D — Assessment lifecycle

*Agent proposals, independent assessments, human review, disagreement,
adjudication, supersession.*

> **Coordinate with draft PR #5** (version-bound human annotations) and **PR #6**
> (advisory evidence agents) before starting D items; much of this may already be
> implemented off-`main`.

### TRUST-D01 — Support multiple assessments without overwriting previous records
- **Status:** backlog
- **Priority:** P1
- **Goal:** Allow more than one assessment of the same claim to coexist, each an
  append-only record.
- **Why it matters:** Rule 4 / non-goal "silently overwrite historical
  assessments"; disagreement and re-assessment require history.
- **Scope:** Model a collection of assessments per claim with stable IDs;
  validator ensures no in-place overwrite.
- **Non-goals:** Auto-resolving which assessment "wins".
- **Dependencies:** TRUST-A01, TRUST-A03; check PR #5.
- **Acceptance criteria:** Multiple assessments validate and are individually
  addressable; a migration/back-compat note is included; no record is
  overwritten.
- **Suggested files:** `knowledge/schemas/`, `scripts/validate-trust.js`.
- **Size:** L · **Autonomous:** conditional

### TRUST-D02 — Represent assessor provenance and protocol version
- **Status:** backlog
- **Priority:** P1
- **Goal:** Record who/what produced each assessment (agent id, model/protocol
  version, human reviewer id) alongside method version.
- **Why it matters:** Provenance is required to interpret disagreement and to
  audit calibration.
- **Dependencies:** TRUST-D01, TRUST-A04.
- **Acceptance criteria:** Each assessment carries assessor + protocol/method
  version; validated; private identities referenced by opaque id only.
- **Suggested files:** `knowledge/schemas/`, `scripts/`.
- **Size:** M · **Autonomous:** conditional

### TRUST-D03 — Represent disagreement explicitly
- **Status:** blocked
- **Priority:** P1
- **Goal:** Make disagreement between assessments a first-class, visible record
  rather than an averaged-away difference.
- **Why it matters:** Non-goal "hide disagreement behind an average."
- **Dependencies:** TRUST-D01, TRUST-D02; decision **D09** (how disagreement is
  represented).
- **Acceptance criteria:** Disagreement is representable and displayed; D09
  resolved or explicitly open.
- **Suggested files:** `knowledge/schemas/`, `content/trust-claim-widget.mjs`.
- **Size:** M · **Autonomous:** no

### TRUST-D04 — Add adjudication and supersession records
- **Status:** backlog
- **Priority:** P1
- **Goal:** Model editorial adjudication and supersession (an assessment marked
  superseded, never deleted), mirroring the RFC's append-only decisions.
- **Why it matters:** Enables human-authorized resolution without erasing
  history.
- **Dependencies:** TRUST-D01, TRUST-D03; RFC in
  `docs/HUMAN_REVIEW_AND_PUBLICATION.md`; check PR #5.
- **Acceptance criteria:** Supersession is append-only and validated; superseded
  records remain retrievable.
- **Suggested files:** `knowledge/schemas/`, `scripts/`, `docs/`.
- **Size:** M · **Autonomous:** conditional

---

## Workstream E — Viewer and interaction

*Claim highlighting, one active detail panel, accessibility, Safari/WebKit
behaviour, component-level explanations.*

### TRUST-E01 — Replace multiple open pop-ups with coordinated single-panel behaviour
- **Status:** ready
- **Priority:** P0
- **Goal:** Ensure at most one TRUST detail panel is open at a time, with
  keyboard and screen-reader state kept correct.
- **Why it matters:** Each widget currently toggles its own `is-open`
  independently (highlights are coordinated via a `WeakMap`, panels are not), so
  several pop-ups can stack open and confuse the reader.
- **Scope:** Coordinate open/close across widgets (shared controller or a
  document-level event); update `aria-expanded`/`aria-hidden`; close on Escape and
  on opening another.
- **Non-goals:** Redesigning the card visuals; changing scoring content.
- **Dependencies:** TRUST-E02 (land the WebKit test surface alongside).
- **Acceptance criteria:** Opening one panel closes any other; ARIA state
  reflects reality; tested including keyboard path.
- **Suggested files:** `content/trust-claim-widget.mjs`, `tests/`.
- **Size:** M · **Autonomous:** yes

### TRUST-E02 — Add regression tests for Safari/WebKit interaction
- **Status:** ready
- **Priority:** P0
- **Goal:** Add regression coverage for the interaction paths that behave
  differently on WebKit (`splitText`/`Node.normalize()`, `<details>`/`<summary>`,
  focus/hover, shadow DOM).
- **Why it matters:** Current tests only run against a Node mock DOM; WebKit
  quirks in the highlight and panel code are untested.
- **Scope:** Add a WebKit-capable test path (e.g. Playwright with the
  pre-installed Chromium plus a documented WebKit run) or targeted unit
  regressions that pin the WebKit-sensitive behaviours; document how to run them.
- **Non-goals:** Full cross-browser matrix CI in this item.
- **Dependencies:** none.
- **Acceptance criteria:** New tests exercise highlight cleanup and panel
  toggling on a WebKit-representative path; documented run command; green in CI.
- **Suggested files:** `tests/`, `.github/workflows/deploy.yml`, `README.md`.
- **Size:** M · **Autonomous:** conditional (sandbox WebKit availability)

### TRUST-E03 — Component-level explanations and accessibility pass
- **Status:** backlog
- **Priority:** P1
- **Goal:** Ensure every component score in the panel has a plain-language
  explanation and that the panel meets accessibility expectations (focus order,
  labels, live-region status).
- **Why it matters:** Transparency requires the reader to understand *why* each
  component scored as it did.
- **Dependencies:** TRUST-E01.
- **Acceptance criteria:** Each component renders rule + rationale + evidence;
  accessibility checks pass; tested.
- **Suggested files:** `content/trust-claim-widget.mjs`, `tests/`.
- **Size:** M · **Autonomous:** yes

### TRUST-E04 — Improve assessment navigation across long reviews
- **Status:** backlog
- **Priority:** P2
- **Goal:** Provide navigation (index/jump/filter) across many claims in a long
  review.
- **Dependencies:** TRUST-E01, TRUST-E03.
- **Acceptance criteria:** Readers can locate and jump between claims; tested.
- **Size:** M · **Autonomous:** yes

### TRUST-E05 — Visual comparison of competing assessments
- **Status:** backlog
- **Priority:** P3
- **Goal:** Explore a UI that shows multiple assessments/disagreement
  side-by-side.
- **Dependencies:** TRUST-D01, TRUST-D03, TRUST-E01.
- **Acceptance criteria:** Prototype that never averages disagreement away.
- **Size:** L · **Autonomous:** conditional

---

## Workstream F — Calibration and evaluation

*Expert-rated benchmark format, agreement analysis, sensitivity testing,
protocol/model comparisons.*

### TRUST-F01 — Build a real benchmark format for expert assessment
- **Status:** blocked
- **Priority:** P1
- **Goal:** Define a machine-readable format for expert-rated claims to serve as
  a calibration/evaluation set.
- **Why it matters:** Calibration claims require real expert data; the format
  must exist before any "validated"/"calibrated" statement (see D10).
- **Scope:** Schema + fixtures for the *format only*; **no fabricated expert
  ratings** (rule 5).
- **Non-goals:** Inventing expert judgments; claiming the framework is calibrated.
- **Dependencies:** TRUST-A01; decision **D10**.
- **Acceptance criteria:** A benchmark schema and an empty/example (clearly
  synthetic) fixture; documentation that real ratings must come from experts.
- **Suggested files:** `knowledge/schemas/`, `docs/`, `scripts/`.
- **Size:** M · **Autonomous:** conditional (format yes; data no)

### TRUST-F02 — Add scripts for component-level agreement analysis
- **Status:** backlog
- **Priority:** P1
- **Goal:** Provide analysis scripts that compute agreement per component between
  assessments/experts.
- **Dependencies:** TRUST-F01, TRUST-D01.
- **Acceptance criteria:** Deterministic agreement stats per component from real
  input; tested on synthetic-but-labelled fixtures.
- **Suggested files:** `scripts/`, `tests/`.
- **Size:** M · **Autonomous:** conditional

### TRUST-F03 — Test sensitivity to model and prompt changes
- **Status:** backlog
- **Priority:** P2
- **Goal:** Measure how assessment outputs vary across models/prompts/protocol
  versions.
- **Why it matters:** Non-goal "treat several agreeing agents as validation";
  sensitivity data shows the limits of agent assessment.
- **Dependencies:** TRUST-F01, TRUST-D02.
- **Acceptance criteria:** A reproducible sensitivity report; agreement across
  agents is explicitly **not** presented as validation.
- **Suggested files:** `scripts/`, `docs/`.
- **Size:** L · **Autonomous:** conditional

### TRUST-F04 — Protocol and model comparison harness
- **Status:** backlog
- **Priority:** P2
- **Goal:** Compare assessment protocols/models on the benchmark.
- **Dependencies:** TRUST-F01, TRUST-F03.
- **Acceptance criteria:** Comparison outputs with provenance; no leaderboard of
  authors/journals.
- **Size:** L · **Autonomous:** conditional

### TRUST-F05 — Explore reviewer calibration exercises
- **Status:** backlog
- **Priority:** P3
- **Goal:** Explore exercises that calibrate human reviewers against the rubric.
- **Dependencies:** TRUST-F01.
- **Acceptance criteria:** Exploratory design note.
- **Size:** M · **Autonomous:** no

---

## Workstream G — Interoperability

*Source-native exports, ORAtlas adapter semantics, manifest integration,
upstream-template compatibility.*

> **Coordinate with draft PRs #7 and #8** (verified deltas / RO-Crate capsules;
> federated archive + nanopublication adapter) before starting G items.

### TRUST-G01 — Ensure source-native TRUST exports cannot be mistaken for ORAtlas-native assessments
- **Status:** ready
- **Priority:** P0
- **Goal:** Establish a contract that any TRUST export carries an explicit
  source-native provenance marker (originating repo, rubric + method version,
  "source-native, not re-adjudicated") and can never be presented as an
  ORAtlas-native assessment.
- **Why it matters:** Non-goals forbid silently translating native TRUST into
  another protocol and letting UI imply more validation than the record supports.
  Draft PR #8 is about to add an export path — the guardrail must exist first.
- **Scope:** Define the required provenance marker in an export contract/schema;
  add a validator/test that rejects an export lacking it; document the semantic
  boundary. Applies to future exporters (and to PR #8 when it merges).
- **Non-goals:** Building the full exporter (that is G02); merging ORAtlas
  semantics.
- **Dependencies:** TRUST-A01, TRUST-A04; coordinate with PR #8.
- **Acceptance criteria:** An export missing the source-native marker fails a
  test; the boundary is documented; no ORAtlas-native re-interpretation is
  produced.
- **Suggested files:** `community/schemas/`, `scripts/`, `docs/`.
- **Size:** M · **Autonomous:** conditional (coordinate with PR #8)

### TRUST-G02 — Add deterministic source-native export contracts
- **Status:** backlog
- **Priority:** P1
- **Goal:** Provide a deterministic exporter that emits TRUST records in a
  documented source-native format with stable serialization and digests.
- **Why it matters:** External platforms (e.g. ORAtlas) must ingest without
  changing the original semantics.
- **Dependencies:** TRUST-G01, TRUST-A03, TRUST-A04; check PR #7/#8.
- **Acceptance criteria:** Byte-stable export; round-trip/validation tests;
  semantics preserved and marked source-native.
- **Suggested files:** `scripts/`, `community/schemas/`, `tests/`.
- **Size:** L · **Autonomous:** conditional

### TRUST-G03 — Add synchronization documentation for the upstream template
- **Status:** backlog
- **Priority:** P1
- **Goal:** Document how this fork tracks and re-syncs with
  `AllenNeuralDynamics/ComputationalReviewTemplate`, including which changes are
  candidates to propose upstream.
- **Why it matters:** Rule 12 / non-owned "generic pipeline"; keeps the extension
  boundary maintainable.
- **Dependencies:** none; decision **D12** (what to propose upstream).
- **Acceptance criteria:** A sync doc listing divergences, sync procedure, and
  upstream-candidate changes; D12 seeded.
- **Suggested files:** `docs/`, `TRUST_DECISIONS.md`.
- **Size:** M · **Autonomous:** conditional

### TRUST-G04 — Add optional import/export adapters for external systems
- **Status:** backlog
- **Priority:** P2
- **Goal:** Provide optional adapters (behind the source-native boundary) for
  external systems.
- **Dependencies:** TRUST-G01, TRUST-G02.
- **Acceptance criteria:** Adapters are optional, documented, and never rewrite
  native semantics.
- **Size:** L · **Autonomous:** conditional

### TRUST-G05 — ORAtlas adapter semantics and richer open-review integration
- **Status:** backlog
- **Priority:** P3
- **Goal:** Explore the semantic mapping to ORAtlas / open-review platforms
  without importing their adjudication semantics.
- **Dependencies:** TRUST-G01, TRUST-G02, TRUST-G04.
- **Acceptance criteria:** A mapping proposal that keeps native TRUST authoritative.
- **Size:** L · **Autonomous:** no

---

## Workstream H — Documentation and governance

*User instructions, contributor guidance, methodological limitations,
attribution, decision records.*

### TRUST-H01 — Create clear contributor and reviewer documentation
- **Status:** backlog
- **Priority:** P1
- **Goal:** Document how humans and agents contribute claims, assessments, and
  challenges, and how reviewers use the rubric.
- **Why it matters:** Required for a reliable first public version.
- **Dependencies:** TRUST-A01, TRUST-D01.
- **Acceptance criteria:** A contributor + reviewer guide covering workflow,
  provenance, and the non-goals; linked from README.
- **Suggested files:** `docs/`, `README.md`.
- **Size:** M · **Autonomous:** yes

### TRUST-H02 — Document methodological limitations and attribution
- **Status:** backlog
- **Priority:** P1
- **Goal:** Publish an explicit limitations statement (what TRUST cannot do) and
  attribution to the upstream template and cited methods.
- **Dependencies:** TRUST-A01, TRUST-B01.
- **Acceptance criteria:** A limitations + attribution doc consistent with the
  non-goals; linked from README.
- **Suggested files:** `docs/`, `README.md`.
- **Size:** S · **Autonomous:** yes

### TRUST-H03 — Maintain the methodological decision log
- **Status:** ready
- **Priority:** P1
- **Goal:** Keep `TRUST_DECISIONS.md` current: every scientific/compatibility
  decision recorded, with status and reviewers.
- **Why it matters:** Rule 10; prevents arbitrary scientific rules being baked in
  silently.
- **Dependencies:** none.
- **Acceptance criteria:** New methodological decisions are appended, not edited
  away; superseded decisions are marked, not deleted.
- **Suggested files:** `TRUST_DECISIONS.md`.
- **Size:** S · **Autonomous:** yes

---

## Status board

| ID | Title | WS | Pri | Status | Size | Agent |
|---|---|---|---|---|---|---|
| TRUST-A01 | Document assessment unit | A | P0 | ready | S | conditional |
| TRUST-A02 | Audit relation vs claim score | A | P0 | ready | S | yes |
| TRUST-A03 | Component records authoritative | A | P0 | backlog | S | yes |
| TRUST-A04 | Version schemas/rubric/method | A | P0 | backlog | M | conditional |
| TRUST-A05 | Claim–claim + contradictions | A | P2 | backlog | M | conditional |
| TRUST-A06 | Richer independence metadata | A | P2 | backlog | M | conditional |
| TRUST-B01 | Not a probability / ranking | B | P0 | ready | S | yes |
| TRUST-B02 | Not-assessed vs N/A vs low | B | P0 | blocked | L | no |
| TRUST-B03 | Profile-only display mode | B | P1 | backlog | M | conditional |
| TRUST-B04 | Review equal weighting | B | P1 | blocked | M | no |
| TRUST-B05 | Non-compensatory gates | B | P1 | blocked | M | no |
| TRUST-B06 | Compare aggregation methods | B | P2 | backlog | L | no |
| TRUST-B07 | Rubric-version migration tooling | B | P2 | backlog | M | conditional |
| TRUST-B08 | Domain-specific profiles | B | P3 | backlog | L | no |
| TRUST-B09 | Ontology alignment | B | P3 | backlog | L | conditional |
| TRUST-C01 | Validate prose anchoring | C | P0 | ready | M | yes |
| TRUST-C02 | Validate atom attribution | C | P0 | ready | M | yes |
| TRUST-C03 | Fail loud on bad artifacts | C | P0 | ready | M | yes |
| TRUST-C04 | Fixtures + diagnostics | C | P1 | backlog | M | yes |
| TRUST-D01 | Multiple assessments | D | P1 | backlog | L | conditional |
| TRUST-D02 | Assessor + protocol provenance | D | P1 | backlog | M | conditional |
| TRUST-D03 | Represent disagreement | D | P1 | blocked | M | no |
| TRUST-D04 | Adjudication + supersession | D | P1 | backlog | M | conditional |
| TRUST-E01 | Single active panel | E | P0 | ready | M | yes |
| TRUST-E02 | Safari/WebKit tests | E | P0 | ready | M | conditional |
| TRUST-E03 | Component explanations + a11y | E | P1 | backlog | M | yes |
| TRUST-E04 | Long-review navigation | E | P2 | backlog | M | yes |
| TRUST-E05 | Compare assessments visually | E | P3 | backlog | L | conditional |
| TRUST-F01 | Expert benchmark format | F | P1 | blocked | M | conditional |
| TRUST-F02 | Agreement analysis scripts | F | P1 | backlog | M | conditional |
| TRUST-F03 | Model/prompt sensitivity | F | P2 | backlog | L | conditional |
| TRUST-F04 | Protocol/model comparison | F | P2 | backlog | L | conditional |
| TRUST-F05 | Reviewer calibration exercises | F | P3 | backlog | M | no |
| TRUST-G01 | Exports labelled source-native | G | P0 | ready | M | conditional |
| TRUST-G02 | Deterministic export contracts | G | P1 | backlog | L | conditional |
| TRUST-G03 | Upstream sync documentation | G | P1 | backlog | M | conditional |
| TRUST-G04 | Optional external adapters | G | P2 | backlog | L | conditional |
| TRUST-G05 | ORAtlas adapter semantics | G | P3 | backlog | L | no |
| TRUST-H01 | Contributor/reviewer docs | H | P1 | backlog | M | yes |
| TRUST-H02 | Limitations + attribution | H | P1 | backlog | S | yes |
| TRUST-H03 | Maintain decision log | H | P1 | ready | S | yes |
