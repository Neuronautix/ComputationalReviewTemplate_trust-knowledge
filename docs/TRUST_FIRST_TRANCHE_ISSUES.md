# First-tranche GitHub issue drafts

Ready-to-file issue text for the five items in the "Recommended first
implementation tranche" of [`TRUST_BACKLOG.md`](../TRUST_BACKLOG.md).

**These are drafts only.** No issues have been created. File them only when
repository permissions and the task explicitly authorize it. Before filing,
re-check open issues/PRs to avoid duplicating existing work (as of drafting,
there were **no open issues**; open draft PRs #5–#8 cover later D/G work, not
these items).

---

## 1. TRUST-A01 — Document the exact assessment unit of native TRUST

**Labels:** `P0`, `workstream:A`, `docs`, `good-first-agent-task`

**Body:**

Establish a single authoritative statement of what one native TRUST score is
attached to, so every later contract (relations, disagreement, export,
aggregation) has an unambiguous reference.

**Context.** `trust_score` is currently attached to the claim object, and graph
edges to citations carry only a role-derived `weight` (`1`/`0.5`), not a
per-relation score. This behaviour is not yet ratified as the intended contract.
See decision **D01** in `TRUST_DECISIONS.md`.

**Scope.**
- Add an "Assessment unit" section to `knowledge/TRUST_RUBRIC.md` stating the
  unit (a claim as written in a section) and its relationship to claim atoms and
  to claim–citation relations.
- Cross-link from `README.md`.
- Resolve **D01** with rationale, or explicitly record it as still `proposed`.

**Non-goals.** No scoring changes; no relation-level scores; no schema edits.

**Dependencies.** None.

**Acceptance criteria.**
- [ ] Rubric states the assessment unit unambiguously.
- [ ] D01 is resolved with rationale or left `proposed` (not invented).
- [ ] Diff contains no schema or score changes.

**Size:** S · **Suitable for autonomous agent:** conditional (must not invent a
resolution to D01).

---

## 2. TRUST-C03 — Fail loud on missing or malformed knowledge artifacts

**Labels:** `P0`, `workstream:C`, `bug`, `data-integrity`

**Body:**

Make the runtime plugin and widget fail loudly and visibly when a knowledge
artifact is missing or malformed, instead of degrading to a silent empty/pending
state that can imply an assessment exists when the record is absent.

**Context.** `content/trust-claim-widget.mjs` uses `safeJsonParse`, which returns
a fallback on any parse error; `plugins/trust-claim-plugin.mjs` reads `kb-path`
without a visible failure path. Silent degradation is an integrity problem: the
UI must not imply more validation than the underlying record supports.

**Scope.**
- Detect missing/malformed data in the plugin and widget load paths.
- Render an explicit, visually distinct error/absent state (not the existing
  "pending validation" state).
- Add regression tests for both the plugin and widget paths.

**Non-goals.** No scoring changes; no schema changes.

**Dependencies.** None.

**Acceptance criteria.**
- [ ] A missing artifact produces a visible error state distinct from "pending".
- [ ] A malformed (invalid JSON / wrong shape) artifact produces the same visible
      error state, never a silent empty render.
- [ ] Tests cover both plugin and widget failure paths.

**Size:** M · **Suitable for autonomous agent:** yes.

---

## 3. TRUST-E01 — Coordinate a single active TRUST detail panel

**Labels:** `P0`, `workstream:E`, `bug`, `ux`, `accessibility`

**Body:**

Ensure at most one TRUST detail panel is open at a time, with keyboard and
screen-reader state kept correct.

**Context.** Each widget toggles its own `is-open` class independently in
`content/trust-claim-widget.mjs`. Highlights are already coordinated through a
document-level `WeakMap`, but panels are not — so several pop-ups can stack open
and confuse the reader.

**Scope.**
- Coordinate open/close across widgets (shared controller or a document-level
  event) so opening one panel closes any other.
- Keep `aria-expanded`/`aria-hidden` in sync with actual state.
- Close on Escape and when another panel opens.

**Non-goals.** No card visual redesign; no change to scored content.

**Dependencies.** Land alongside TRUST-E02 (WebKit test surface).

**Acceptance criteria.**
- [ ] Opening one panel closes any previously open panel.
- [ ] ARIA state reflects reality for every open/close transition.
- [ ] Keyboard path (open, Escape, focus move) is tested.

**Size:** M · **Suitable for autonomous agent:** yes.

---

## 4. TRUST-E02 — Add Safari/WebKit interaction regression tests

**Labels:** `P0`, `workstream:E`, `testing`

**Body:**

Add regression coverage for interaction paths that behave differently on WebKit,
which the current Node mock-DOM tests do not exercise.

**Context.** Tests in `tests/*.test.mjs` run only against a Node mock DOM. The
highlight code relies on `Text.splitText`, `Node.normalize()`, `<details>` /
`<summary>`, focus/hover, and shadow DOM — all areas with known WebKit quirks.

**Scope.**
- Add a WebKit-representative test path (e.g. Playwright using the pre-installed
  Chromium plus a documented WebKit run) or targeted regressions pinning the
  WebKit-sensitive behaviours.
- Cover highlight application/cleanup and panel toggling.
- Document how to run the tests and wire them into CI where feasible.

**Non-goals.** A full cross-browser matrix in this issue.

**Dependencies.** None.

**Acceptance criteria.**
- [ ] New tests exercise highlight cleanup and panel toggling on a
      WebKit-representative path.
- [ ] Run command is documented (`README.md`).
- [ ] Tests are green in CI (or a fallback is documented if sandbox WebKit is
      unavailable).

**Size:** M · **Suitable for autonomous agent:** conditional (depends on sandbox
WebKit availability).

---

## 5. TRUST-G01 — Guarantee source-native exports cannot be mistaken for ORAtlas-native

**Labels:** `P0`, `workstream:G`, `interoperability`, `data-integrity`

**Body:**

Establish the contract that any TRUST export carries an explicit source-native
provenance marker and can never be presented as an ORAtlas-native (re-adjudicated)
assessment — before any exporter merges.

**Context.** No exporter exists on `main`, but draft PR #8 introduces a
federation / nanopublication adapter. The project's non-goals forbid silently
translating native TRUST into another protocol and forbid UI/exports implying
more validation than the record supports. The guardrail must exist first. See
decision **D11**.

**Scope.**
- Define the required provenance marker (originating repository, rubric version,
  method version, and an explicit "source-native, not re-adjudicated" flag) in an
  export contract/schema.
- Add a validator/test that rejects any export lacking the marker.
- Document the semantic boundary between source-native TRUST and ORAtlas-native
  assessment. Coordinate with PR #8.

**Non-goals.** Building the full exporter (that is TRUST-G02); merging ORAtlas
semantics into native TRUST.

**Dependencies.** TRUST-A01, TRUST-A04; coordinate with draft PR #8.

**Acceptance criteria.**
- [ ] An export missing the source-native provenance marker fails a test.
- [ ] The source-native vs ORAtlas-native boundary is documented.
- [ ] No ORAtlas-native re-interpretation of native TRUST is produced.

**Size:** M · **Suitable for autonomous agent:** conditional (coordinate with
PR #8).
