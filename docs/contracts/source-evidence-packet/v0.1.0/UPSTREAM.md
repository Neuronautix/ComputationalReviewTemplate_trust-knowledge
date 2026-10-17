# Vendored contract: source-evidence-packet/0.1.0

`schemas/*.json` and `UPSTREAM-README.md` (the normative contract text) are unmodified copies from
[dhuzard/diggypaper](https://github.com/dhuzard/diggypaper) at commit
`303e3771e79c938b45ca8a9d2941b0706e09189c` (contract issue #47, PR #48). The producer owns this
contract; change it there, then re-vendor and update the commit and hashes below.

| File | sha256 |
|---|---|
| `schemas/evidence-assessment.schema.json` | `8ce7cdcec399f6b9d8b932f3ffdacd505909430a1bc5a74874509d2353b1fc95` |
| `schemas/finding.schema.json` | `dacf16d34c0ac85412ace474cf9a26cae1580821e83465c237f35f00f46fb964` |
| `schemas/manifest.schema.json` | `93f30f8a03c008967ca9d98200b6490fe3e58b2084529694b6c9c086cdd1c02a` |
| `schemas/paper.schema.json` | `9353e1eb3e198f9ac8f5e8fa56b4e75922c0a1b48ceba211b9feeb2da763276b` |
| `schemas/passage-evidence.schema.json` | `b41a8987e34f1d4641719cd4a5e4f74e96963638de5e6a06f7fcb84a7cb4c81f` |
| `UPSTREAM-README.md` | `9f4fb0c0cd8af9d75b71f31fc9fea3e3a43c2340499862c238a833f99a4c7a12` |

The importer (`scripts/source-evidence/`) refuses any `schema_version` other than
`source-evidence-packet/0.1.0`. The Phase 2 crosswalk that the upstream README marks PROVISIONAL
(section 8.3) is pinned in `docs/SOURCE_EVIDENCE_IMPORT.md`.
