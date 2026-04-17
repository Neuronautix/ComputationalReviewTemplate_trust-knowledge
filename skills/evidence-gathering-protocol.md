# Evidence Gathering Protocol

Phase 2 delegation template for EXPERT evidence-gathering agents. Each agent searches databases and returns structured evidence for one topic cluster.

**Information barrier:** This skill contains ONLY evidence-gathering instructions. You cannot see how sections are written (Phase 7), how they are critiqued (Phase 8), or how figures are audited (Phase 6). This is intentional.

---

## Phase 2: Evidence Gathering

**Agent:** EXPERT_CRITICAL_LITERATURE_REVIE (parallel — one per topic cluster) 

**Database selection:** The specific literature databases depend on the review's domain. This skill references PubMed, Europe PMC, bioRxiv, and medRxiv as examples because its initial deployment was in biomedical sciences. For other domains, substitute the appropriate databases:
- **Biomedical / life sciences:** PubMed, Europe PMC, bioRxiv, medRxiv
- **Physics / astronomy:** NASA ADS, INSPIRE-HEP, arXiv
- **Computer science:** DBLP, Semantic Scholar, arXiv
- **Social sciences / economics:** SSRN, RePEc, EconLit
- **General / multidisciplinary:** OpenAlex, Semantic Scholar, CrossRef, Google Scholar

CrossRef is domain-neutral and should always be included for DOI resolution. The principles below (DOI verification, full-text retrieval, database-first metadata) apply regardless of which databases are used. Where the text says "PubMed or Europe PMC," read it as "the appropriate domain database."

Each agent searches databases and returns structured evidence. Delegation MUST request this output schema:

```json
{
  "findings": [{"claim": "", "claim_source_sentence": "verbatim sentence from abstract or full text", "evidence": "", "effect_size": "", "effect_size_source_sentence": "verbatim sentence containing the number, or null if qualitative only", "n": 0, "study_system": "what was studied: e.g. species, material, model organism, dataset, language, market — domain-dependent", "replication_status": "", "replication_evidence_dois": ["doi1", "doi2"], "doi": "", "text_access": "fulltext | abstract_only"}],
  "conflicts": [{"paper_a_doi": "", "paper_b_doi": "", "nature_of_conflict": "", "likely_reason": "", "conflict_source": "describe which sentences in which papers' abstracts/text establish the conflict"}],
  "unreplicated_claims": [{"claim": "", "source": "", "years_since_publication": 0}],
  "evidence_gaps": [{"topic": "", "what_is_missing": "", "why_it_matters": ""}],
  "strongest_evidence": {"claim": "", "why_strong": ""},
  "weakest_evidence_cited": {"claim": "", "why_weak": ""},
  "papers_reviewed_count": 0,
  "evidence_artifact_id": "",
  "figure_data": [
    {
      "comparison_id": "descriptive-slug",
      "comparison_name": "Human-readable name",
      "papers": [
        {"doi": "", "metric": "", "value": "", "value_source_sentence": "verbatim sentence from abstract or full text containing this number", "ci_or_error": "", "n": 0, "n_analyzed": "number that passed QC or was actually used in analysis, if different from n", "n_definition": "what n counts: items profiled | items post-QC | subjects | samples", "study_system": "", "experimental_conditions": "", "method": "", "text_access": "fulltext | abstract_only", "scope_region": "domain/region scope: e.g., whole system | specific region | subregion | ...", "scope_population": "population scope: all items | all category-X | subtype-Y only | ...", "taxonomic_level": "granularity of the classification: broad category | subcategory | fine type | cluster | other"}
      ],
      "comparison_type": "cross-study conflict | convergent evidence | dose-response | timeline",
      "what_it_reveals": "Why this comparison matters",
      "suggested_plot_type": "forest plot | grouped bar | heatmap | timeline | scatter",
      "homogeneity_check": {
        "scope_region_uniform": "true | false",
        "scope_population_uniform": "true | false",
        "taxonomic_level_uniform": "true | false",
        "n_definition_uniform": "true | false",
        "caveats": ["list any comparability issues across entries, e.g. 'Paper X is whole-brain while others are cortex-only'"]
      }
    }
  ],
  "search_failures": [
    {
      "suggested_reference": "description from coordinator task",
      "searches_tried": ["query1", "query2"],
      "result": "zero results in PubMed and Europe PMC",
      "action": "excluded from evidence"
    }
  ]
}
```

**MANDATORY — Coordinator delegation discipline:**
The coordinator writes the Phase 2 delegation task descriptions. These contain topic descriptions and search guidance for each cluster. The following rules apply to the coordinator when writing these delegations:

- Describe TOPICS to search for, not specific "Author & Author Year" references. Write "search for papers on [topic X properties], [mechanism Y], and [pathway Z function]" — NOT "find Armstrong & Bhatt 2012, Varga et al 2010."
- If you want to suggest a landmark paper, describe it by its finding: "the landmark paper establishing [key finding X]" — not by author names recalled from memory.
- NEVER generate author names, co-author names, or years from LLM memory for inclusion in a delegation. These are the primary vector for Bhatt-type contamination, where the LLM substitutes a high-frequency author name for the correct but less-frequent co-author.
- The evidence agents have database access. Trust them to discover the actual papers. Your role is to define what topics to cover and what questions to answer, not to pre-populate the reference list.
- **No author names in output:** Do NOT include author names, cite_keys, or "Author Year" labels anywhere in your output. Use DOIs as the sole paper identifier. The coordinator will derive cite_keys mechanically from database metadata. This eliminates the possibility of author-name contamination. If you need to refer to a paper in your reasoning, use the DOI or a descriptive phrase ("the 2023 whole-brain atlas paper") — never "Bhatt et al." or any author name from memory.

**Citation discipline:**
- Every paper MUST have a DOI verified against a database (PubMed, Europe PMC, or CrossRef) — not recalled from LLM memory.
- Every finding entry must include the DOI. If a DOI cannot be found, flag with `DOI-NOT-FOUND` and include enough metadata (title, authors, journal, year) for later resolution.
- Do NOT fabricate bibliographic metadata. If uncertain about a detail, search for it rather than guessing.
- **Hard drop rule for failed searches:** If a database search for a paper returns zero results, the paper MUST be excluded from the evidence output. Do not fill in metadata from memory. Do not include a paper just because the coordinator's task description mentioned it. The coordinator's suggested topics are search guidance, not a source of truth — if a paper cannot be found in PubMed, Europe PMC, or CrossRef, it may not exist. Mark it in a `search_failures` list (paper description, search queries tried, zero-result confirmation) but do NOT include it in `findings` or assign it a DOI.
- **Schema-only requirement:** Findings must contain ONLY the schema fields: `claim`, `claim_source_sentence`, `effect_size`, `effect_size_source_sentence`, `n`, `species`, `replication_status`, `replication_evidence_dois`, `doi`, `text_access`. If a cluster returns findings with additional fields (`title`, `authors`, `journal`, `year`, `pmid`, `volume`, `pages`, `cite_key`), send back: "Remove non-schema fields. Each extra free-text field is a fabrication vector — measured 74% hallucination rate when agents add an authors field. Cite_keys are assigned mechanically by the coordinator, not by agents."
- **Full-text retrieval requirement:** Every paper must have `text_access` set to `fulltext`, `abstract_only`, or `metadata_only`, reflecting a genuine retrieval attempt.

**Full-Text Retrieval Protocol :**

Agents MUST use `retrieve_fulltext()` for ALL papers — not just the "top 50." The function tries publisher APIs first (which have higher success rates for paywalled content), then falls back to open-access sources.

The retrieval protocol (API tiers, size validation) is defined in the reviewer_agent skill.

**Size-based validation (MANDATORY after any retrieval):**
- Response > 15KB AND contains `<body>` tag → genuine fulltext → `text_access = "fulltext"`
- Response > 15KB but no `<body>` tag → inspect manually; may be metadata-heavy XML
- Response < 15KB → metadata-only or abstract-only → `text_access = "abstract_only"` regardless of HTTP status code
- PMC frequently returns HTTP 200 with a valid XML envelope containing only the abstract. The size check catches this (Failure Mode #23).

**Coordinator full-text fallback tiers** remain as before, but agents now use `retrieve_fulltext()` instead of `fetch_article_fulltext` for their initial retrieval pass. Call with explicit keys:

```python
text, source = retrieve_fulltext(
    doi,
    elsevier_api_key=os.environ.get('ELSEVIER_API_KEY'),
    springer_api_key=os.environ.get('SPRINGER_API_KEY'),
    ncbi_api_key=os.environ.get('NCBI_API_KEY'),
)
```
- **Text-only extraction requirement:** All `claim`, `effect_size`, and `figure_data.papers.value` fields must come from retrieved text. Every value must have a corresponding `_source_sentence`. Papers with `text_access` = `metadata_only` must be excluded from findings entirely and moved to `search_failures` — they cannot contribute claims, source sentences, or quantitative data.
- **Figure data requirement:** Every `figure_data.papers.value` must have a non-null `value_source_sentence`. Papers without a traceable number are excluded from figure comparisons.
- **Replication evidence requirement:** `replication_status` = `independently_replicated` requires ≥2 DOIs from different labs in `replication_evidence_dois`. `contested` requires conflicting DOIs. Otherwise use `replication_unknown`.

**Coordinator enforcement obligation:** These are gates, not advisories. Send back non-compliant clusters via `send_message`.

**Compliance checklist (each returning cluster):**
- [ ] `conflicts` non-empty? If empty → send back.
- [ ] `weakest_evidence_cited` substantive? If "all strong" → send back.
- [ ] `figure_data` present? If empty → send back.
- [ ] `papers_reviewed_count` ≥ 70 per major topic? If below → send back with specific undertreated subtopics.
- [ ] Cross-cluster unique DOI count ≥ 80% of target? If below → send back thinnest clusters for additional citation chaining.
- [ ] Every paper has a DOI (starts with `10.`)? If not → send back.
- [ ] `search_failures` present for papers mentioned in delegation but not found in databases? If unfound papers appear in `findings` without database-verified DOI → send back.
- [ ] Fulltext retrieval rate ≥ 20% per cluster? If below → send back (worker likely skipped retrieval).
- [ ] Overall fulltext rate ≥ 50% across all clusters after fallback tiers? If below → delegate targeted retrieval to EXPERT agent via send_message.
- [ ] Quantitative extraction: ≥ 30% of findings have non-null `effect_size`? If below → send back for number extraction.
- [ ] Sample size: ≥ 20% of findings have `n` > 0? If below → send back.
- [ ] Replication status: ≤ 70% `replication_unknown`? If above → send back for replication investigation.
- [ ] Every `independently_replicated` finding has ≥2 DOIs in `replication_evidence_dois`? If not → send back.
- [ ] Every conflict has valid DOIs for both papers + non-empty `conflict_source` (≥20 chars)? If not → send back.
- [ ] `figure_data` comparisons have `homogeneity_check` with non-trivial `caveats` when uniformity fields are false? If not → send back.
- [ ] No `metadata_only` papers in findings? If present → send back.
- [ ] Schema field names exactly match the orchestrator schema? 
  Conflicts MUST have: paper_a_doi, paper_b_doi, nature_of_conflict, likely_reason, conflict_source
  Figure_data MUST have: comparison_id, comparison_name, what_it_reveals, suggested_plot_type, 
  papers, homogeneity_check
  If an agent returns 'topic' instead of 'nature_of_conflict', or 'title' instead of 
  'comparison_name' → send back: "Field names must match the schema exactly. 
  Rename [wrong_field] to [correct_field]."
- [ ] **Contradiction search executed?** For each major topic, at least one query must 
  explicitly search for papers that challenge or revise the textbook narrative. Include queries
  like "[mechanism X] challenged OR revised OR incorrect OR reconsidered" and 
  "[established claim] alternative OR reinterpretation". If zero contradiction-targeted queries
  were run → send back: "Add explicit searches for papers that challenge the consensus on [topic]."
- [ ] **False consensus risks identified?** The `evidence_gaps` array must include at least one
  entry with a claim that is "widely stated but primary experimental evidence is thin or absent."
  If the agent reports zero false-consensus risks across an entire topic cluster → this is itself
  suspicious. Send back: "Identify at least one claim in this topic area where the textbook 
  narrative may outpace the primary experimental evidence."



- **DOI-title cross-validation (MANDATORY, not a sample):** After each cluster returns, the coordinator verifies EVERY DOI by fetching its title from CrossRef and comparing against the reported title in the evidence package. Implementation:
  - For each paper in findings:
    - `GET https://api.crossref.org/works/{doi}`
    - Extract title from response
    - Compare word overlap between CrossRef title and the finding's `claim_source_sentence` (first 10 words of each)
    - If overlap < 0.2 and no shared domain-specific terms: flag as `WRONG_DOI`
  - If >10% of a cluster's DOIs are flagged:
    - Send back: "DOIs point to the wrong papers. Rebuild using search-first: iterate over database search results and extract DOIs with `result.get('doi')`. Do not pre-populate paper lists from memory."
  - For individual flagged DOIs:
    - Search Europe PMC by the REPORTED title
    - If found: replace with the correct DOI
    - If not found: move to `search_failures`
  - Papers with `text_access` = `metadata_only` must NOT appear in findings. If present → send back: "Remove metadata-only papers from findings. Papers without at least an abstract cannot contribute evidence."
- `replication_evidence_dois` populated for every `independently_replicated` finding? If not → send back.
- **Figure data comparability check:** For each `figure_data` comparison, verify the `homogeneity_check` is present and non-trivial. If `scope_region_uniform`, `scope_population_uniform`, or `taxonomic_level_uniform` is false, verify that `caveats` is non-empty and describes the heterogeneity. If all three are marked true but the `metric` fields across entries differ substantively (e.g., "Number of category-X types" vs "Number of clusters (whole dataset)"), send back: "The metric labels in comparison [comparison_id] differ but homogeneity_check claims uniformity. Re-examine whether these entries are measuring the same thing at the same scope."
- **Quantitative extraction rate:** At least 30% of findings must have a
  non-empty, non-null `effect_size` field (excluding values like "not
  reported", "N/A", "qualitative"). If below 30% → send back: "Only X%
  of findings have effect sizes. For the top 50 papers by relevance,
  return to the abstract or full text and extract any reported numbers:
  percentages, fold-changes, p-values, correlation coefficients, response
  magnitudes. Set effect_size_source_sentence to the verbatim sentence
  containing each number."
- **Sample size extraction rate:** At least 20% of findings must have
  `n` as an integer > 0. If below 20% → send back: "Only X% of findings
  report sample size. For each finding, check the abstract for n, number
  of cells, number of animals, number of slices, number of recordings.
  Use the most relevant n for the claim (e.g., neurons recorded, not
  total animals, if the claim is about neural activity)."
- **Replication status audit:** No more than 70% of findings may have
  `replication_status` = `replication_unknown`. If above 70% → send back:
  "X% of findings have unknown replication status. For the top 50 claims,
  actively investigate: search PubMed for [claim keywords] AND (replicate
  OR confirm OR consistent OR corroborate). For each, upgrade to
  `independently_replicated` (with ≥2 DOIs from different labs in
  `replication_evidence_dois`), `contested` (with conflicting DOIs), or
  confirm `replication_unknown` with a one-sentence note explaining why
  no replication evidence was found."
- **Conflict DOI completeness:** Every entry in `conflicts` must have
  valid DOIs for both papers (fields: `paper_a_doi` and `paper_b_doi`).
  Descriptions like "the 2012 gain control papers" are not sufficient —
  resolve them to DOIs. If any conflict lacks both DOIs → send back:
  "Resolve conflict paper descriptions to database-verified DOIs."
- **Conflict source completeness:** Every entry in `conflicts` must have
  a non-empty `conflict_source` field (≥20 characters) describing which
  sentences in which papers' abstracts or full text establish the conflict.
  If empty → send back: "Fill conflict_source with the specific sentences
  from each paper's text that demonstrate the disagreement."

**DOI-title cross-validation (MANDATORY — delegated to DATAML in Phase 3):**
For each DOI, DATAML compares CrossRef title word overlap with claim_source_sentence. Overlap < 0.2 → flag as WRONG_DOI. >10% flag rate per cluster → send cluster back for rebuild. Individual flags → search by reported title for correct DOI.


## Evidence Schema

Every evidence-gathering agent returns a JSON matching this schema. The coordinator validates compliance on return.

```json
{
  "findings": [{"claim": "", "claim_source_sentence": "verbatim sentence from abstract or full text", "evidence": "", "effect_size": "", "effect_size_source_sentence": "verbatim sentence containing the number, or null if qualitative only", "n": 0, "study_system": "what was studied: e.g. species, material, model organism, dataset, language, market — domain-dependent", "replication_status": "", "replication_evidence_dois": ["doi1", "doi2"], "doi": "", "text_access": "fulltext | abstract_only"}],
  "conflicts": [{"paper_a_doi": "", "paper_b_doi": "", "nature_of_conflict": "", "likely_reason": "", "conflict_source": "describe which sentences in which papers' abstracts/text establish the conflict"}],
  "unreplicated_claims": [{"claim": "", "source": "", "years_since_publication": 0}],
  "evidence_gaps": [{"topic": "", "what_is_missing": "", "why_it_matters": ""}],
  "strongest_evidence": {"claim": "", "why_strong": ""},
  "weakest_evidence_cited": {"claim": "", "why_weak": ""},
  "papers_reviewed_count": 0,
  "evidence_artifact_id": "",
  "figure_data": [
    {
      "comparison_id": "descriptive-slug",
      "comparison_name": "Human-readable name",
      "papers": [
        {"doi": "", "metric": "", "value": "", "value_source_sentence": "verbatim sentence from abstract or full text containing this number", "ci_or_error": "", "n": 0, "n_analyzed": "number that passed QC or was actually used in analysis, if different from n", "n_definition": "what n counts: items profiled | items post-QC | subjects | samples", "study_system": "", "experimental_conditions": "", "method": "", "text_access": "fulltext | abstract_only", "scope_region": "domain/region scope: e.g., whole system | specific region | subregion | ...", "scope_population": "population scope: all items | all category-X | subtype-Y only | ...", "taxonomic_level": "granularity of the classification: broad category | subcategory | fine type | cluster | other"}
      ],
      "comparison_type": "cross-study conflict | convergent evidence | dose-response | timeline",
      "what_it_reveals": "Why this comparison matters",
      "suggested_plot_type": "forest plot | grouped bar | heatmap | timeline | scatter",
      "homogeneity_check": {
        "scope_region_uniform": "true | false",
        "scope_population_uniform": "true | false",
        "taxonomic_level_uniform": "true | false",
        "n_definition_uniform": "true | false",
        "caveats": ["list any comparability issues across entries, e.g. 'Paper X is whole-brain while others are cortex-only'"]
      }
    }
  ],
  "search_failures": [
    {
      "suggested_reference": "description from coordinator task",
      "searches_tried": ["query1", "query2"],
      "result": "zero results in PubMed and Europe PMC",
      "action": "excluded from evidence"
    }
```


**MANDATORY — Evidence JSON compliance:**
- Conflicts MUST use exactly these fields: `paper_a_doi`, `paper_b_doi`, `paper_a_claim`, `paper_b_claim`, `nature_of_conflict`, `resolution_status`. No other field names. No nested objects for sides. No `papers[]` arrays. No custom field names per conflict type. Every conflict MUST have both DOIs.
- JSON values: use `null` for missing values, NEVER the Python string `"None"`. Agents must ensure None→null conversion during JSON serialization.
- `figure_data` papers arrays MUST have unique DOIs. Deduplicate before saving. If the same paper appears multiple times in a comparison, keep only the first entry.
