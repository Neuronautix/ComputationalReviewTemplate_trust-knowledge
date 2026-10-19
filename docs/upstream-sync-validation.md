# Upstream template sync — validation record

Sync of this TRUST fork (starting point `a19a8dc`) with the upstream template
`source-template/main` at `8cc8383` (pipeline generation 30), plus a file-level port of
the reviewed Evidence Explorer contract from template main `f205552`. This page records
what was decided, what was checked, and what is still open. It is a summary, not a
transcript.

## Commits

| Commit | Content |
|---|---|
| `9da833c` | Real merge of `8cc8383` (parents `a19a8dc`, `8cc8383`). Conflicts resolved in favour of fork TRUST phases, local authorship and a non-destructive Phase 20. |
| `bc58201` | Versioned Evidence Explorer contract, compatibility report, golden/rendered tests, CI; ported file by file from `f205552` and reviewed, not cherry-picked. |
| `b23c902` | Repairs from the read-only review. |
| this commit | This page (docs only). |

The earlier candidate built on the wrong base (`208d612`, `cbec799`, `58b0958`) was used
only as a reference: its `scripts/test_evidence_explorer.mjs` rewrite was reused after
review and extended (attributed in the file). Its simplified conflict normalizer was not
reused, and nothing from `6836c17` (autonomy policy) was imported.

## Decisions taken in the merge

- **Skills.** Upstream's unversioned `comprev-orchestrator.md`, runtime, writing-style,
  manifest, deferred-check and coherence changes are adopted. Fork phases 5b/5bV and 16T,
  the `trust-claim` / `human-reviews` directive rows and the TRUST validator checks are
  kept; the latter are renumbered #28/#29 after upstream's #26/#27.
  `comprev-trust-score-validator` gains v30 frontmatter, so the manifest lists 22 skills.
- **Authorship integration boundary.** Upstream replaced the local plugin with a remote
  `releases/latest` AuthorshipExtractor and added named human authors. The fork keeps
  `plugins/authorship-plugin.mjs`, `content/authorship-widget.*` and its own
  `content/authors.yml` byte-for-byte: the CRediT companion imports `parseMiniYaml`, its
  golden outputs are bound to those bytes, and a mutable release URL would make rendered
  authorship unreproducible. Skill text that pointed writers at the remote release was
  corrected to the local plugin. Pinned by `tests/authorship-integration-boundary.test.mjs`.
- **Phase 20 push.** Upstream (and the fork before this sync) told the push step to
  `git rm -r content/ figures/ evidence/ provenance/ latex/ scripts/`, which in this fork
  would delete validators, importers, exporters, widgets and schemas. The step now removes
  only run-generated outputs and lists the TRUST/credit/ORAtlas infrastructure to preserve.
- **Optional human-review plugin.** Upstream's `PLUGINS_DECLARED` requires every local
  plugin in `myst.yml`. `scripts/check_template_consistency.py` now names
  `human-review-plugin.mjs` in `OPTIONAL_PLUGINS` (and only it), checks the entry is not
  stale, and adds `NO_EXAMPLE_REVIEW_DATA_BOUND`, which fails if `myst.yml` or any
  `content/*.md` references `community/examples`. Tested by
  `scripts/test_check_template_consistency.py`.
- **Historical provenance.** Reference-run files keep generation 29; only upstream's own
  path renames touched them. `community/examples/release_manifest.example.json` keeps its
  historical `comprev-orchestrator-v29` value. No scientific prose was rewritten.

## Evidence Explorer contract, integrated

- One loader: canonical v1 (`evidence/schema/package.schema.json`), or the
  `legacy-section-package` adapter for the Phase 5 shape. The adapter now accepts the
  `section_NN` ids the source-evidence importer's identity curation writes (the
  `f205552` loader rejected them). **Phase 5 still emits its existing shape**; moving it to
  canonical v1 would change fork gates and is left to the owner.
- Manifest discovery with containment (`realpath` must stay in the evidence directory),
  duplicate file/order detection, unknown schema versions rejected, explicit
  `:availability:` (`available` | `not_provided`), and statuses `missing_directory`,
  `invalid_manifest`, `no_compatible_files`, `invalid_packages`, `partial_loading`,
  `loaded_zero_findings`, `loaded`, `not_provided`.
- From upstream: `:sections:`, gap and count warnings, and the rich conflict normalizer
  (output identical to `8cc8383` on 7 representative shapes). Upstream's implicit
  "empty directory renders a placeholder" became an explicit declaration:
  `content/evidence_database.md` declares `:availability: not_provided`, and an empty
  directory declared available fails the build.
- The zero-conflicts warning is suppressed only when every empty package declares a
  `conflict_assessment` (fork `CONFLICTS_DECLARED` semantics), so a legitimate declared
  empty set is not reported as a defect.
- Display adapters copy and never write back. Native finding fields reach the payload
  unchanged; only `section`/`section_title` are added and `cite_key`, `doi`,
  `claim_source_sentence`, `tier` are filled only when absent. Conflicts keep the native
  record under `source_conflict`. `import_provenance` and `conflict_assessment` are passed
  into `sections[]` verbatim.

## Validation

Run in a fresh temp clone of the final commit (not the working tree), Node v24.21.0,
mystmd 1.10.1 (installed outside the repository), Python 3.12.3.

Validated commit: `b23c902` (this page is a docs-only commit on top of it).

| Command | Result |
|---|---|
| `node scripts/validate-trust.js` | pass — 4 claims, 5 citation contexts, 16 verified passages |
| `node scripts/test-trust-validator.js` | pass |
| `node scripts/validate-community-contracts.js` | pass |
| `node --test tests/*.test.mjs` | 144 tests: 143 pass, 0 fail, **1 skipped** (real ORAtlas extractor; needs `ORATLAS_DIR`) |
| `node tests/fixtures/contributorship/build-fixture.mjs --check` | pass — fixture current |
| `node scripts/release-artifacts/validate-release-artifact-schemas.mjs --root .` | pass — 9 documents |
| `node scripts/release-artifacts/validate-release-artifact-bundle.mjs --directory release_artifacts/examples` | pass — 4 indexed artifacts |
| `node scripts/oratlas/verify-oratlas-export.mjs --directory .` | pass |
| `python3 scripts/build_skill_manifest.py --check` | pass — 22 skills, pipeline v30 |
| `python3 scripts/check_template_consistency.py` | pass — 14/14 |
| `python3 scripts/check_prose_fidelity.py --self-test` | pass — 16/16 |
| `python3 scripts/test_check_template_consistency.py` (new) | pass — 6 tests |
| `node scripts/test_evidence_explorer.mjs` | pass — 21/21 |
| `node --test test/*.test.mjs` (pinned mystmd 1.10.1) | 25 tests: 25 pass — contract, compatibility report, golden fixture render, clean-copy TRUST site render |
| `ORATLAS_DIR=… node --test tests/oratlas-export.test.mjs` | 12/12 pass, including the real extractor at pinned `9cd3a0c` |
| `node scripts/oratlas/validate-with-oratlas.mjs` | pass — 4 claims, 5 citations, 5 relations, zero dropped |
| `BASE_URL=/ComputationalReviewTemplate_trust-knowledge myst build --html` | exit 0, 5 pages, 0 errors; 2 warnings about `authors.yml` extra keys, identical to the pre-sync fork build |

Rendered output of that clean build:

- assets emitted: `authorship-widget.{mjs,css}`, `trust-claim-widget.{mjs,css}`,
  `evidence-explorer-widget.mjs`, all under the `BASE_URL` prefix;
- authorship payload resolves `content/authors.yml` (contributor `ai-pipeline` only);
- four `trust-claim` widgets, each with the score and label held in
  `knowledge/claim_graph.json` (90/high_trust, 100/high_trust ×3);
- Evidence Database payload `evidence_status: not_provided`, zero sections;
- no human-review widget and no `community/examples` reference in any page;
- `git status` clean before and after the build (`_build/` is ignored).

Invariants checked by diff against `a19a8dc`: no change under `knowledge/`, `community/`,
`release_artifacts/`, `docs/contracts/`, `review-manifest.json`, `scripts/oratlas/`,
`scripts/source-evidence/`, `scripts/contributorship/`, `scripts/release-artifacts/`, the
TRUST/community validators, the trust-claim and human-review plugins and widgets,
`content/01_introduction.md`, `content/references.bib`, `provenance/gate_trust_scores.json`,
`TRUST_DECISIONS.md` (D01–D12 still proposed), `TRUST_BACKLOG.md`, `tests/fixtures/`, and the
fork workflows (`deploy.yml`, `contributorship.yml`, `oratlas-export.yml`,
`source-evidence-import.yml`, `evidence-radar.yml`).

Test strength: mutation runs in a scratch clone showed the display tests fail when the
plugin overrides a native finding field, drops `import_provenance`/`conflict_assessment`,
alters the native conflict record, or mutates a loaded finding in memory. The rich
conflict normalizer produced output identical to `8cc8383` on 7 representative shapes. A
read-only reviewer pass found no high-severity defects; its medium and low findings were
repaired in `b23c902`, except those listed below.

## Open items for the owner

- **Deploy vs. validation toolchain.** `validate.yml` pins `mystmd@1.10.1` and executes no
  notebooks. `deploy.yml` is unchanged from the fork: it installs unpinned `mystmd` (pip
  and npm) and executes `figures/notebooks/*.ipynb` at build time, so the deployed site is
  built by a CLI version and from figure outputs that the deterministic checks did not
  see. Pinning or dropping runtime execution is a deployment-policy decision not taken
  here. The MyST build also fetches the unpinned `book-theme` template from GitHub.
- **Phase 5 output shape.** Whether Phase 5 should emit canonical v1 (as `f205552`
  prescribed for the generic template) instead of the Phase 5 shape the fork's gates,
  claim seeds and importer use.
- **Identity curation drops `conflict_assessment`.** `curateIdentitySection` (pilot
  helper) does not carry the cluster's declaration into the section, so the explorer
  warns about an empty Conflicts panel for an identity-curated import. Real Phase 5
  curation may carry it; the helper was not changed.
- **Scoping plan omits 5b/5bV/16T.** `skills/comprev-scoping.md`'s phase table (which
  feeds `generate_plan`) has no 5b or 16T rows although the orchestrator gates on them.
  This predates the sync; whether they are plan phases or sub-steps of 5 and 16 is a
  planning decision left open.
- **`NO_EXAMPLE_REVIEW_DATA_BOUND` is a static check.** It normalizes paths and scans
  `content/` recursively, but `plugins/human-review-plugin.mjs` itself still accepts any
  path inside `community/`, examples included. Rejecting examples in the plugin would
  change fork behaviour and its tests, so it was not done here.
- **ORAtlas integration** ran against a scratch clone of the local ORAtlas repository
  checked out at the pinned commit with `pnpm install --frozen-lockfile` (extractor
  subset). The local ORAtlas checkouts themselves are at `f6c834b`, not the pin, and have
  no dependencies installed; CI without `ORATLAS_DIR` still skips that one test.

## Repair pass after independent review

Two required repairs from the independent review of `866002f`:

- **Rendered-widget test gap.** `test/trust-site-render.test.mjs` now derives the expected
  claim IDs from the `:::{trust-claim}` directives in `content/01_introduction.md` and
  asserts the rendered `trust-claim-widget` multiset equals them (missing, duplicate and
  unexpected widgets fail); the score/label assertions against `knowledge/claim_graph.json`
  are kept. Negative proof, in a disposable copy only (no tracked production code
  changed): suppressing every widget but the first failed with the three missing IDs;
  duplicating the first widget failed with the extra `clm_7659634fb095cdce`; the unmutated
  copy passed.
- **Validator wording.** `skills/comprev-myst-validator.md` (empty-directory test rule and
  check 30) now says only an explicit `:availability: not_provided` survives an empty
  evidence set; an empty `evidence/` under empty or default `available` fails, matching the
  runtime. `skills/manifest.json` was regenerated for the changed skill hash. Runtime
  unchanged.
