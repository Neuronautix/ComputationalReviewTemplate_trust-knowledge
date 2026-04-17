(sec-methods)=
# Methods
This review was produced through a structured, multi-phase computational pipeline. All claims in this section are derived from recorded pipeline metadata and gate artifacts; no post-hoc characterizations have been added.

(sec-methods-search)=
## M.1 Search Strategy

Literature searches were conducted across four databases: **PubMed**, **Europe PMC**, **OpenAlex**, and **bioRxiv**. Searches were organized around topic clusters defined in the scope document, each corresponding to a body section of the review:

| Cluster | Topic | Papers Retrieved | Full-Text Obtained |
|---------|-------|------------------|-------------------|
| 1 | [PIPELINE FILLS THIS] | — | — |
| **Total** | | **—** | **—** |

Paper counts above are pre-deduplication totals across all clusters.

(sec-methods-inclusion)=
## M.2 Inclusion and Exclusion Criteria

The scope document specified the following inclusion criteria:

- **Target corpus size:** [PIPELINE FILLS THIS] unique papers across all evidence clusters.
- **Full-text target:** ≥50% of all retrieved papers.
- **Per-section minimum:** [PIPELINE FILLS THIS] papers per major topic cluster.
- **Citation density target:** ≥4.0 citations per synthesis paragraph.
- **Figure requirement:** ≥2 figures per section, with ≥1 cross-study comparison per section.

Papers were excluded if they did not address the review topic or related circuit mechanisms. Preprint–journal duplicate pairs were resolved during integration by replacing preprints with their published journal versions where identified.

(sec-methods-retrieval)=
## M.3 Full-Text Retrieval

Full-text retrieval was attempted for all retrieved papers using open-access sources (Unpaywall, Semantic Scholar, PubMed Central), publisher APIs (Elsevier, Springer Nature), and institutional proxy access. The overall full-text retrieval rate was **[PIPELINE FILLS THIS]**.

(sec-methods-extraction)=
## M.4 Evidence Extraction

Structured evidence extraction was performed for each cluster, producing evidence packages containing:

- **Findings:** Quantitative and qualitative claims extracted from each paper.
- **Conflicts:** Contradictions or disagreements between studies on the same topic.
- **Figure comparisons:** Cross-study data comparisons suitable for figure generation.
- **Research gaps:** Identified areas lacking sufficient evidence.

| Metric | Count |
|--------|-------|
| Total findings | [PIPELINE FILLS THIS] |
| Total conflicts | [PIPELINE FILLS THIS] |
| Total figure comparisons | [PIPELINE FILLS THIS] |

Each evidence package was stored as a versioned artifact linked to its cluster, enabling traceability from any claim in the review back to its source evidence.

(sec-methods-citation-verification)=
## M.5 Citation Verification

[PIPELINE FILLS THIS — citation verification results from Phase 15]

(sec-methods-pipeline)=
## M.6 Pipeline Execution

The review was produced through a 19-phase pipeline. Key execution metadata from completed phases:

| Phase | Description | Status | Key Outputs |
|-------|-------------|--------|-------------|
| 1 | Scope definition | Pending | — |
| 2 | Evidence gathering & compliance | Pending | — |
| 3 | Deduplication & conflict resolution | Pending | — |
| 4 | Scaffold approval | Pending | — |
| 5 | Figure comparison design | Pending | — |
| 6 | Figure audit | Pending | — |
| 7 | Section drafting | Pending | — |
| 8 | Critic review | Pending | — |
| 9 | Bibliography assembly | Pending | — |
| 10 | Integration | Pending | — |
| 11 | Introduction & Conclusion | Pending | — |
| 12 | Methods | Pending | — |
| 13–19 | Remaining phases | Pending | — |

(sec-methods-figures)=
## M.7 Figure Reproducibility

[PIPELINE FILLS THIS — figure reproducibility details from pipeline execution]

Figure generation notebooks are preserved in `figures/notebooks/` and can be re-executed against the archived evidence packages to reproduce all figures.

(sec-methods-reproducibility)=
## M.8 Reproducibility Statement

All pipeline artifacts are preserved and versioned, enabling full reproduction of this review:

- **Scope document:** Defines the topic clusters, inclusion criteria, and structural targets.
- **Evidence packages:** Cluster-level evidence JSONs containing all extracted findings, conflicts, figure comparisons, and research gaps.
- **Figure audit:** Gate artifact recording all figure comparison dispositions with verdicts and caveats.
- **Section drafts:** Body sections with citations.
- **Critic reports:** Reports documenting MUST_FIX, SHOULD_CAVEAT, and SUGGESTION items.
- **Bibliography:** Validated BibTeX entries with full DOI traceability.
- **Integration log:** Tracked changes including orphan citation removal, terminology standardization, and structural fixes.
- **Phase ledger:** Records the status and gate artifact for each of the 19 pipeline phases.

The pipeline used no manual curation steps. All evidence extraction, section drafting, critic review, and integration were performed computationally, with gate artifacts serving as checkpoints between phases.
