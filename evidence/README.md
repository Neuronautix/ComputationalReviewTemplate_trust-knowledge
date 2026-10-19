# Evidence Directory

This directory contains the structured evidence packages that power the
interactive Evidence Explorer widget on the review site.

## Two accepted package shapes

The explorer reads packages through one loader
(`plugins/evidence-explorer-plugin.mjs`) and reports which adapter loaded each
file:

| Adapter | Shape | Who writes it |
|---|---|---|
| `canonical-v1` | Versioned contract **1.0.0**: [`schema/package.schema.json`](schema/package.schema.json) (`evidence_package_schema_version`, `section{id,order,title}`, `findings[]` with `sources[]`, `conflicts`, `figure_data`, `evidence_gaps`, `provenance`) | Producers that opt into the versioned contract |
| `legacy-section-package` | The Phase 5 section package (`section_id`, `section_title`, `findings[]` with `cite_key`/`doi`/`claim`, `argument_groups`, `conflicts`, `figure_data`, optional `conflict_assessment` and `import_provenance`) | This fork's Phase 5 curation, and the fixed-corpus source-evidence import (`docs/SOURCE_EVIDENCE_IMPORT.md`) |

In this TRUST fork the Phase 5 shape is still the production shape: the Phase 5
and 5b gates, the claim-seed builder and the source-evidence importer are
defined against it. Moving Phase 5 to emit `canonical-v1` is an open owner
decision, not something this loader decides. Despite its name, the
`legacy-section-package` adapter is therefore a supported path, not a
deprecation.

Adapters copy and never write back. A package file is never modified, and the
bound payload carries the native records unchanged:

- each finding keeps every native field; the payload only adds `section` and
  `section_title`, and fills `cite_key`, `doi`, `claim_source_sentence` and
  `tier` only where the native finding lacks them;
- each conflict is normalized for display and keeps the native record under
  `source_conflict`;
- section-level `import_provenance` and `conflict_assessment` are passed into
  the payload's `sections[]` verbatim. Lineage sidecars, digests, rights and
  native `seip-support-v1` judgments are not read or converted by the explorer.

## Discovery

Use `manifest.json` (schema [`schema/manifest.schema.json`](schema/manifest.schema.json))
for an explicit package list and ordering. Manifest filenames and orders must
each be unique, and every listed file must resolve to a file inside this
directory (no `..`, no symlink escape). Without a manifest the explorer
discovers these filenames and orders them by numeric section order, never
filesystem order:

```
evidence_section_01.json
evidence_section_02.json
...
evidence_section_NN.json
```

`section_NN_evidence_package.json` and `section_NN_evidence.json` are still read
for older trees. Loaded packages must have unique section orders. A package
that declares an unknown or future schema version is rejected explicitly; it is
never interpreted as a legacy package.

## Declared availability and diagnostics

The `:::{evidence-explorer}` directive declares `:availability:`:

- `available` (default): at least one compatible package must load. A missing
  directory, an invalid manifest, no compatible files, or only invalid packages
  **fails the build**. A partial set renders with a build warning and is
  rejected by the review gates.
- `not_provided`: an explicit, truthful "no Evidence Database" state. This is the
  only valid empty state; an empty directory is never silently accepted. The
  un-instantiated template declares it in `content/evidence_database.md`, and
  Phase 14 switches it to `available` once packages exist.

The payload exposes one status: `missing_directory`, `invalid_manifest`,
`no_compatible_files`, `invalid_packages`, `partial_loading`,
`loaded_zero_findings`, `loaded` or `not_provided`, plus the discovered,
loaded and rejected file lists. Build warnings also report an interior gap in
discovered sections, a count that disagrees with `:sections:`, zero findings, an
all-empty conflict set that some package leaves undeclared (no `conflict_assessment`),
and packages that load while `not_provided` is declared. Non-object `conflicts` or
`figure_data` entries reject their package.

## How Files Are Generated

The pipeline's Phase 5 (Evidence Curation) builds per-section evidence
packages from the raw cluster evidence. Phase 14 (Assembly) copies them into
this directory unchanged.

A combined `evidence_database.json` may also be generated, but the
evidence-explorer plugin does **not** read it directly — it requires
the individual per-section files.
