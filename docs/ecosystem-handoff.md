# Ecosystem handoff: exact launches, objectives and the authorization boundary

Parent run `run-1a41a3886630` · companion to [`ecosystem-readiness.md`](ecosystem-readiness.md) (evidence) and [`../provenance/ecosystem-readiness-report.json`](../provenance/ecosystem-readiness-report.json) (descriptive report).

## 1. Where the program stops

PICO cannot dispatch across repositories natively, and the current authorization covers **one** repository only:

| Repository | Local path (real) | Writable by PICO now? |
|---|---|---|
| `Neuronautix/ComputationalReviewTemplate_trust-knowledge` | `/home/dhuzard/projects/scientific-review-workspace/scientific-review-workspace/workspace/trust-knowledge` | **Yes** (branch + commit only; see §3.1) |
| `dhuzard/diggypaper` | `/home/dhuzard/projects/scientific-review-workspace/scientific-review-workspace/workspace/diggypaper` | No — user must authorize first |
| `dhuzard/oratlas` | `/home/dhuzard/projects/scientific-review-workspace/scientific-review-workspace/workspace/oratlas` | No — user must authorize first |
| `dhuzard/orcid-playground` | **none yet** — user chooses a durable clone (§3.4) | No |
| `dhuzard/ComputationalReviewTemplate` (reference fork) | `/home/dhuzard/projects/scientific-review-workspace/scientific-review-workspace/workspace/review-template` | No — read-only |
| `dhuzard/scientific-review-workspace` (coordinator) | `/home/dhuzard/projects/scientific-review-workspace/scientific-review-workspace` (local `master` unborn) | No — bootstrap is a separate session (§3.6) |

Do **not** use the nested `workspace/workspace/*` directories: they hold stale copies with no `.git`.

The program deliberately stops at this boundary. Everything below is a launch you run yourself, one repository at a time, after you decide to authorize it. This run made no foreign writes, no issue/PR/GitHub mutations, no worktree creation or removal, no pushes, and no per-repository launches.

### What this handoff will not do

- It does not approve ORAtlas #202 (the security ADR is unratified; draft PR #211) or the counsel/DPIA gate on D11. Those need their owner. Until they are ratified, every private feature (ORAtlas #203–#207, Diggypaper #53, TRUST #16, ORCID #9 private integration) stays unstarted. No objective below touches them.
- It does not spoof environment variables or bypass PICO's session-scope check. `pico run` fails closed when the target and `--repo` disagree; if it stops, fix the cause rather than working around it.
- It does not synthesize permission policies. PICO validates `.pi/autonomy.yaml`; see §2.
- It does not claim the Diggypaper → CRT/TRUST → ORAtlas mission is complete.

## 2. Preconditions you run yourself (human steps)

1. **Policy validation, not synthesis.** For each repository you authorize, run `pico doctor <path>` and read what it reports about `.pi/autonomy.yaml`. Only `trust-knowledge` and `review-template` have a `.pi/` directory today. `diggypaper` and `oratlas` have none; deciding whether to run `pico setup <path>` (which writes starter files) is your call, and the resulting policy needs your review. Note that the existing `trust-knowledge` policy has `create_github_issues` and `comment_on_issue` set to `true`, `merge.enabled: false`, `mark_pr_ready: false`; the objectives below therefore say explicitly **not** to create or comment on issues.
2. **Fresh bases.** The local checkouts are stale or diverged (see readiness §2):
   - TRUST: local `main` is `f205552`, 26 commits ahead of and 84 behind `origin/main` (`0db82e1`). Leave `main` alone. Create a base branch from `origin/main`:
     `git -C /home/dhuzard/projects/scientific-review-workspace/scientific-review-workspace/workspace/trust-knowledge fetch origin && git -C /home/dhuzard/projects/scientific-review-workspace/scientific-review-workspace/workspace/trust-knowledge switch -c ecosystem-base origin/main`
   - ORAtlas: local `main` is `f6c834b`, remote `230b8a3`. Same pattern (`fetch origin`, then a new branch from `origin/main`).
   - Diggypaper: local `main` equals `a34d18f` (remote at snapshot); still run `git fetch origin` and confirm.
3. Commit nothing to `main`; do not enable auto-merge anywhere.

## 3. Launches, in priority order

Each block gives the exact command, then the bounded objective to paste **inside the Pi session** that `pico run` opens, then preconditions, tests, acceptance and constraints. All objectives share these rules: work on a new branch from `origin/main`; no commits to `main`; no force-push; no auto-merge; no issue creation or comments; no push or PR unless you explicitly authorize it in that session; stop and report if a precondition fails.

### 3.1 TRUST — authorized now (priority: highest, smallest)

```
pico run /home/dhuzard/projects/scientific-review-workspace/scientific-review-workspace/workspace/trust-knowledge --repo Neuronautix/ComputationalReviewTemplate_trust-knowledge
```

```
/orchestrate On a new branch from origin/main (0db82e1), add one test-only change for TRUST #17 acceptance criterion 3 (cross-artifact private non-leak). Using the existing synthetic contributorship fixture whose private origin is "gamma", add a negative scan asserting that the private project_ref and project_title, the private source credit and ORCID, the candidate relation, and rights-protected passage text appear in no file the repository's own pipeline emits other than the private companion and private release report (the public companion, the ORAtlas export and sidecars, and the generated source-evidence/lineage outputs). Put it in a new tests/contributorship-private-leak.test.mjs or extend tests/contributorship.test.mjs. Do not change scripts/, schemas, fixtures, goldens, workflows, skills, TRUST_DECISIONS.md or any policy file; if CI wiring is needed, report it instead. Show negative proof in a disposable copy only (inject a private marker into each scanned artifact; the test must fail). Do not recompute packet manifests without packet bytes. Commit locally; do not push, open a PR, comment on or create issues, or merge.
```

- **Preconditions:** `ecosystem-base` branch from `origin/main` (§2.2); `mystmd@1.10.1` on `PATH` for the `test/` suite; the `ORATLAS_DIR` pin checkout is optional.
- **Tests to run before committing:** `node scripts/validate-trust.js`; `node scripts/test-trust-validator.js`; `node scripts/validate-community-contracts.js`; `node --test tests/*.test.mjs` (expect the current 144 plus the new tests; 1 skip without `ORATLAS_DIR`); `node --test test/*.test.mjs`; `node tests/fixtures/contributorship/build-fixture.mjs --check`; `python3 scripts/build_skill_manifest.py --check`; `python3 scripts/check_template_consistency.py`.
- **Acceptance:** the new test passes on the clean tree and fails under each injected marker; no existing test changed; goldens and fixture digests unchanged (`tests/fixtures/contributorship/expected/*` hashes in the report); `git status` clean after.
- **Not in scope:** TRUST #16 (blocked on #202), D01–D12 decisions, the unresolved Phase 5 shape question.

### 3.2 Diggypaper — needs your authorization first (priority 2)

Closes the loop for the producer side of #55 and feeds ORAtlas #209.

```
pico run /home/dhuzard/projects/scientific-review-workspace/scientific-review-workspace/workspace/diggypaper --repo dhuzard/diggypaper
```

```
/orchestrate On a new branch from origin/main (a34d18f), for Diggypaper #55 add the producer-side compatibility fixture/check requested in the 2026-10-19 comment, without renaming or adding fields to finding-credit-companion/0.1.0 or changing source-evidence-packet/0.1.0 schemas or validators. The check must: run the native fcc_validate.py and sep_validate.py on the frozen fixture; verify packet manifest bytes/hash, finding id+revision, separate proposer/curator/assessor roles, pseudonym/blinding and disclosure decisions; and compare against ORAtlas's documented SourceCreditObservations mapping, recording which fields map, which are lost, and which are withheld. Use synthetic data only; add no routes, migrations, UI or private-export code (that is #53, blocked on ORAtlas #202). Commit locally; do not push, open a PR, comment on or create issues, or merge.
```

- **Preconditions:** authorization for this repo; backend dev environment (`pip install -c constraints.txt -e ".[dev,onnx]"` in `backend/`). PostgreSQL-only SEIP tests skip without `SEIP_TEST_POSTGRES_URL`; do not describe a skipped test as passing.
- **Tests:** in `backend/`: `ruff check .`, `ruff format --check .`, `pytest -q`; confirm `test_finding_credit.py`, `test_finding_credit_companion.py`, `test_source_evidence_packet.py` unchanged and green. Frontend untouched.
- **Acceptance:** new check passes and fails when a manifest byte, a finding revision or a role is altered; frozen schemas byte-identical (`git diff` shows none); the loss list is recorded in the check's output or docs, not only in a comment.
- **Not in scope:** #53, #7 pilot (needs two independent reviewers plus an adjudicator), #46 pilot.

### 3.3 ORAtlas — needs your authorization first (priority 3; do not mix with #202)

```
pico run /home/dhuzard/projects/scientific-review-workspace/scientific-review-workspace/workspace/oratlas --repo dhuzard/oratlas
```

```
/orchestrate On a new branch from origin/main (230b8a3; fetch first, the local tree is stale), for ORAtlas #209 add test-only coverage: (1) a named adapter-level test that a source "rights: public/allowed" declaration never becomes scientific support or a destination permission (accessEffect stays none); (2) an automated check that the pinned fixture bytes (Diggypaper a34d18f, CRT a19a8dc, ORCID ff5aff9) hash to the digests recorded in the fixtures' documentation, including the ORCID roster and schema (sha256 6b2cd197557213247c099f9fb84c47817aa48ec008ecc038d8200145db70a96e and 3ccfc0072ac214cdec86df966c96a7a4212f8cc1058b4cdd62ecfe29813b2e94); (3) confirm the loss report records an unmappable CRediT label. Update docs/source-credit-interop.md only to replace "ORCID bytes not compared" with the verified fact. Do not touch #202, PR #211, #203–#207, apps/web, the e2e specs or CI configuration (PRs #213/#214 are owned separately). Commit locally; do not push, open a PR, comment on or create issues, or merge.
```

- **Preconditions:** authorization; `corepack enable`; `pnpm install --frozen-lockfile`; `pnpm --filter @oratlas/db db:generate`.
- **Tests:** `pnpm lint`, `pnpm format:check`, `pnpm typecheck`, `pnpm test`, `pnpm evidence-lineage:verify`; report the e2e flake (#213) as pre-existing if it appears, do not fix it here.
- **Acceptance:** new tests fail if a fixture byte or the `accessEffect` value changes; existing `source-credit-adapters`, `private-research-credit` and lineage suites unchanged; no change to any `private-*` contract semantics.
- **Not in scope:** #160, #178, #195 (independent of the synthetic MVP); all private features.

### 3.4 ORCID playground — needs a durable clone and your authorization (priority 4)

The only copy on disk is `/tmp/orcid-discovery-1a41`, a read-only temporary capture at `ff5aff9`. It is **not** a working repository. You choose where the durable clone lives; the path below is a suggestion only — edit it before running.

```
git clone https://github.com/dhuzard/orcid-playground.git /home/dhuzard/projects/orcid-playground
git -C /home/dhuzard/projects/orcid-playground log --oneline -1   # expect ff5aff9 or newer; if newer, re-read the readiness report before proceeding
pico run /home/dhuzard/projects/orcid-playground --repo dhuzard/orcid-playground
```

```
/orchestrate On a new branch from origin/main (ff5aff9 or the verified newer head), for ORCID #9 add a producer golden test for the canonical roster-assertion digest: a hard-coded digest for the committed demo export (tests/fixtures/roster/demo-export.json, sha256 6b2cd197557213247c099f9fb84c47817aa48ec008ecc038d8200145db70a96e) so a silent change to the canonicalization fails. Do not change src/orcid_biosketch/roster.py behaviour, the schema, the fixtures, or draft PR #7 content; do not add accounts, invitations, ORCID writes or any private-roster path. Commit locally; do not push, open a PR, comment on or create issues, or merge.
```

- **Preconditions:** durable clone chosen and authorized; `pip install -e ".[dev]"` in a virtualenv.
- **Tests:** `pytest -q`, `node --test web/orcid-biosketch.test.mjs`. (The parent ran only `tests/test_roster.py`, 24 passed, on the temporary capture.)
- **Acceptance:** new test passes and fails on a one-byte change; existing roster tests unchanged; schema and fixture hashes unchanged.
- **Owner decisions this does not make:** merging draft PR #7; ratifying that #6 supersedes #5 (candidate only); the ORCID API access/sync model.

### 3.5 Reference fork — read-only verification (priority 5)

```
pico run /home/dhuzard/projects/scientific-review-workspace/scientific-review-workspace/workspace/review-template --repo dhuzard/ComputationalReviewTemplate
```

```
/orchestrate Read-only: on a disposable branch that will not be committed, verify that main 0e36bac still has 8cc8383 and f205552 as ancestors and that the Evidence Explorer contract files match the file-level port recorded in the TRUST repository's docs/upstream-sync-validation.md; write the findings to the session output only. Make no commits, no pushes, no issue or PR actions and no policy changes.
```

- Issues are disabled on this repository; nothing to reconcile there. Skip this launch unless you want an independent parity check.

### 3.6 Coordinator — separate bootstrap session (priority 6)

The coordinator root has an unborn `master`, empty `docs/`, `scripts/`, `missions/`, and no issues or PRs. It was not bootstrapped. Do this in its own session after you decide what the coordinator should own.

```
pico run /home/dhuzard/projects/scientific-review-workspace/scientific-review-workspace --repo dhuzard/scientific-review-workspace
```

```
/orchestrate Bootstrap only: on a new branch (not master), create one initial commit containing a README that states this repository's coordination role, links the six repositories and the three ecosystem documents in the TRUST repository (docs/ecosystem-readiness.md, docs/ecosystem-handoff.md, provenance/ecosystem-readiness-report.json), and nothing else. No scripts, no missions, no policy files, no submodules, no remote operations. Commit locally; do not push, open a PR, or create issues.
```

- Stop if `pico doctor` reports a target mismatch; do not set environment variables to override it.

## 4. After any launch: how to bring results back

1. Look at the branch and the session's trace; run the listed tests yourself.
2. Compare any change to the criterion rows it targets in the readiness report; update the report in the TRUST repository (this is the only repository PICO may currently write to).
3. Decide on pushes, PRs and merges explicitly; nothing here will do that for you.

## 5. Owner actions that only people can take

| # | Action | Who | Unblocks |
|---|---|---|---|
| 1 | Authorize each foreign repository separately (or decline) | user | §3.2–3.6 |
| 2 | Choose a durable ORCID clone path | user | §3.4 |
| 3 | Refresh/rebase local bases as in §2.2 | user | all launches |
| 4 | Ratify or reject ORAtlas #202 (PR #211) and complete the counsel/DPIA review of D11 | ORAtlas owner | every private feature |
| 5 | Decide on ORAtlas PRs #213 (sign-in flake) and #214 (CI budget) | ORAtlas owner | trustworthy aggregate `e2e` signal |
| 6 | Accept, reject or revise TRUST decisions D01–D12 (all `proposed`) | TRUST owner | native-TRUST export semantics |
| 7 | Confirm the ten synthetic scenarios listed in readiness §7 (the brief referred to ten without listing them) | user | scenario coverage claim |
| 8 | Record acceptance, conflicts and sign-off for the proposed SEIP pilot reviewers and adjudicator | Diggypaper owner | Diggypaper #7, #1 |
| 9 | Decide the rights of the lineage fixture's `citation_contexts` excerpts and whether a real packet deposit may be made | owners of the packet | ORAtlas #198 real-data workflow |
| 10 | Decide MVP v0.1 release (ORAtlas #199) | ORAtlas owner | — |
| 11 | Ratify (or reject) that ORCID #6 supersedes #5; review draft PR #7 | ORCID owner | ORCID epic |

The public synthetic path (Diggypaper packet → TRUST importer → ORAtlas lineage view) does not wait on items 4–5; the private path waits on item 4 and nothing else can substitute for it.
