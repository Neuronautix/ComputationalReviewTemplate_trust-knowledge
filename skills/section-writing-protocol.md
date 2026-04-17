# Section Writing Protocol

Phase 7 delegation template for section writers. Draft one section of the review in MyST markdown with figures, citations, and evidence synthesis.

**Information barrier:** This skill contains ONLY writing instructions. You cannot see how your section will be critiqued (Phase 8), how figures were audited (Phase 6), or how citations will be verified (Phase 15). Write the best section you can from the evidence — the evaluation criteria are not your concern.

---

## Phase 7: Section Drafting

**Agent:** EXPERT_CRITICAL_LITERATURE_REVIE (parallel — one per section)

Section writers load `expert-figure-construction-v22` for figure production.

**PREREQUISITE:** Before launching ANY Phase 7 delegation, the coordinator
MUST verify:

```python
require_phase('3b_figure_audit')  # Asserts Phase 6 is complete
audit_gate_vid = check_gate('gate_figure_audit.json')
```

Each Phase 7 delegation template MUST include the Phase 6 verdicts artifact: `{{artifact:<audit_gate_vid>}}`. If the artifact doesn't exist, the delegation cannot be assembled — this is the structural enforcement.

**MANDATORY — Each section writer receives:**
1. Their per-section scaffold extract from Phase 5 (artifact reference) — NOT the full scaffold
2. Their section's curated evidence package from Phase 5
3. The document figure style guide
4. Adjacent section summaries (1-2 paragraphs each for N-1 and N+1)
5. Explicit opening and closing constraints
6. Cross-reference instructions
7. Voice/tone guide
8. Phase 6 verdicts for all figure_data comparisons in this section, including mandatory_caption_caveats
9. The `citation_key_map` artifact: `{{artifact:<citation_key_map_vid>}}` — maps DOI → canonical cite_key
10. The `author_name_table` artifact: `{{artifact:<author_name_table_vid>}}` — maps cite_key → author names for prose mentions

**MANDATORY — Delegation template must include:**
> "Your output is a SECTION of a larger document. Do NOT include \documentclass, \usepackage, \begin{document}, \end{document}, \begin{thebibliography}, or \bibitem. Use \citep{CiteKey} for parenthetical citations and \citet{CiteKey} for textual (e.g., "\citet{Author2020} showed…"). Do NOT use bare \cite{}. Start directly with \section{...}. Load `expert-figure-construction-v22` for figure production. Use ONLY the canonical citation keys provided in the citation_key_map from Phase 5. Do NOT invent new keys — no Unknown, Fix, or Placeholder keys. If a paper is not in the key map, skip the citation rather than fabricating a key.
>
> CITATION DENSITY SELF-CHECK: Before saving your .tex file, count
> your \citep{}/\citet{} commands and divide by the number of substantial
> paragraphs (exclude figure environments, single-sentence transitions,
> and subsection-opening topic sentences that are followed by elaboration).
> Report this as `citations_per_paragraph` in your structured output.
> If below 4.0, you MUST restructure: merge consecutive single-paper
> paragraphs into synthesis paragraphs that cite 5–8 papers in dialogue
> before each paragraph's concluding synthesis sentence."

**MyST format requirements (MANDATORY):**
- Citations: `` {cite:p}`AuthorYear` `` and `` {cite:t}`AuthorYear` `` — backticks AFTER the closing brace
- Figure directives: `:::{figure} ../figures/fig_secN_name.png` — note the `../` prefix
- Figure labels: use DASHES not colons: `:name: fig-secN-name` (NOT `fig:secN`)
- Section label: Start the file with `(sec-LABEL)=` on line 1, before the heading
- Cross-references: `` {ref}`sec-target-label` `` — no wrapping parentheses
- No double backticks except in code blocks
- Include `{authorship-explorer}` directive at end of file (before any code dropdowns)

**MANDATORY — Citation discipline:**
- Only cite papers provided in the evidence package for your section. Do NOT introduce new citations from LLM memory.
- Use \citep{CiteKey} (or \citet{CiteKey} for textual) with the DOI as a comment on first use: `\citep{Pouille2001} % doi:10.1126/science.1060342` — this ensures every citation is traceable during bibliography assembly.
- Never fabricate or guess bibliographic metadata.
- **Author names from table ONLY:** When writing prose-style author mentions (e.g., "Pouille and Scanziani (2001) established..."), you MUST look up the author names in the `author_name_table` provided with your evidence package. Use the `display` field for two-author papers, `et_al` for three or more. NEVER write author names from memory. If a cite_key is not in the author_name_table, use citation-only format: "It has been shown \citep{Key} that..." — do NOT guess the authors.
- **Hard prohibition:** Do NOT write "and Bhatt", "Bhatt et al.", "Bhatt and", or any author name not present in the author_name_table for that cite_key. Any occurrence of an author name not in the table is a compliance failure.

**MANDATORY — Section writers must NOT:**
- Write a standalone introduction to the field
- Define terms already in the terminology conventions
- Re-present findings already covered in earlier sections
- Write a section-level conclusion as if the document is ending
- Cite any paper not present in their evidence package

**MANDATORY — Section writers MUST:**
- Write paragraphs organized by argument, not by paper. Each paragraph makes a claim and marshals multiple papers as evidence. Example structure: "Claim sentence citing \citep{A, B}. \citet{A} established X with method M1. \citet{B} extended this to Y but found a discrepancy in Z. \citet{C} resolved this by showing condition-dependence. Together, these studies establish [synthesis]."
- Synthesize across papers within paragraphs. A paragraph citing 3–5 papers in dialogue is stronger than three paragraphs each covering one paper.
- Do not add specific quantitative values (numbers, fold-changes, percentages) that are not present in your evidence package. If the evidence package describes a finding qualitatively, describe it qualitatively in the prose.
- Reserve single-paper paragraphs for landmark studies that require detailed methodological exposition (e.g., the 2012 gain control trio where each paper's specific methods explain the discrepancy).

**MANDATORY — Figure production:**
- Every scaffold-specified figure MUST be produced
- Figures use \label{fig:secN-name}, text uses \ref{fig:secN-name} — NEVER hard-coded numbers
- Cross-study comparison figures use pre-extracted data from evidence packages
- Follow document style guide (colors, fonts, DPI)
- Save figures as PNG files alongside the .tex section file

**MANDATORY — Figure filename discipline:**
- The filename in `\includegraphics{}` MUST exactly match the filename passed to `save_artifacts`. No path prefixes, no extension mismatches.
- Example: if you save `fig_sec4_gain_control.png`, your LaTeX must contain `\includegraphics{fig_sec4_gain_control.png}` — not `figures/fig_sec4_gain_control` or `gain_control_fig`.
- In your structured output, return a `figure_filenames` list mapping each `\includegraphics` path to the saved artifact filename:
  ```json
  [{"latex_path": "fig_sec4_gain_control.png", "artifact_filename": "fig_sec4_gain_control.png"}]
  ```
- NEVER use `{{artifact:...}}` markers inside `.tex` source code. These are platform references that do not resolve during LaTeX compilation — they will appear as literal broken paths. Use plain filenames only (e.g., `fig_sec4_gain_control.png`).

**MANDATORY — Figure placement:**
- ALL figures MUST use `\begin{figure}[H]` (requires `\usepackage{float}` in preamble — the coordinator handles this). This forces figures to appear exactly where they are placed in the source, preventing drift to section boundaries in long documents.
- Never use `[t]`, `[b]`, `[p]`, or `[htbp]` — in a 200+ page document with 35 figures, deferred placement causes figures to accumulate far from their textual references.
- Never use bare `\begin{figure}` without a placement specifier

**MANDATORY — Output filenames must match the repository's myst.yml toc entries:**

The GitHub repository's `myst.yml` expects these EXACT filenames. Section writers MUST use these names — not generic `section_NN.md`:

```python
SECTION_FILENAMES = {
    1:  '01_introduction',
    2:  '02_classification',
    3:  '03_tools',
    4:  '04_section_topic',
    5:  '05_section_topic',
    6:  '06_section_topic',
    7:  '07_noncardinal_types',
    8:  '08_invivo_processing',
    9:  '09_section_topic',
    10: '10_plasticity_development',
    11: '11_species_translation',
    12: '12_computational_models',
    13: '13_synthesis',
}
# MyST file: content/{name}.md
# LaTeX file: latex/{name}.tex
# Figure format: figures/fig_sec{N}_{descriptive_name}.png
```

The coordinator MUST include the correct filename in each Phase 7 delegation: "Save your MyST output as `{name}.md`" — not as `section_NN.md` or any other variant. Mismatched filenames cause the MyST build to miss sections.

**MANDATORY — Figure path format in MyST markdown:**

All figure directives MUST use this exact format:
```markdown
:::{figure} ../figures/fig_secN_descriptive_name.png
:name: fig-secN-descriptive-name
:width: 100%
Caption text.
:::
```

The `../figures/` prefix is required because content files are in `content/` and figures are in `figures/` (sibling directories). MyST resolves paths relative to the file. A bare filename like `fig_sec2_type_counts.png` will NOT resolve — it must be `../figures/fig_sec2_type_counts.png`.

**Each writer produces:**

1. **`section_NN.md`** — MyST markdown (primary, for the GitHub repo). Format:
   - Parenthetical citations: `` {cite:p}`CiteKey` `` (equivalent to `\citep{CiteKey}`)
   - Textual citations: `` {cite:t}`CiteKey` `` (equivalent to `\citet{CiteKey}`)
   - Figures:
     ```markdown
     :::{figure} ../figures/fig_secN_name.png
     :name: fig-secN-name
     :width: 100%
     Caption text with {cite:p}`Source2020` attribution.
     :::
     ```
   - Evidence conflicts:
     ```markdown
     :::{admonition} Evidence Conflict
     :class: warning
     Description of the conflict...
     :::
     ```
   - Provenance annotations on key claims:
     ```markdown
     :::{margin} Provenance
     **Source:** verbatim sentence from Paper2020 (fulltext)
     **Replication:** independently_replicated (3 labs)
     :::
     ```

2. **`section_NN.tex`** — LaTeX (for PDF compilation). Same content, LaTeX syntax.

3. **Figure PNGs** — 300 DPI, saved to `figures/`

4. **One Jupyter notebook per figure** — saved to `figures/notebooks/fig_secN_name.ipynb`:
   - Cell 1: Import `shared_style` and load evidence JSON
   - Cell 2: Extract the relevant comparison data
   - Cell 3: Create the figure using style guide colors/fonts
   - Cell 4: Save as PNG
   - Must be self-contained and runnable with: `jupyter execute figures/notebooks/fig_secN_name.ipynb`
   ```python
   import sys; sys.path.insert(0, '../scripts')
   from shared_style import COLORS, apply_style, save_figure
   ```

5. **Structured output:** `figure_filenames` mapping, `citations_per_paragraph`, word count

**Compliance checks:**
- grep for \begin{thebibliography} → NON-COMPLIANT
- grep for \documentclass → NON-COMPLIANT
- All scaffold figures produced?
- Opening connects to previous section?
- Closing sets up next section?
- At least one conflict/tension present?
- Key papers receive substantive treatment (not just a one-sentence citation), either within a synthesis paragraph or — for singular landmarks — in a dedicated paragraph?
- Paragraphs organized by argument, not by paper? Each paragraph should advance ONE claim or sub-argument and cite MULTIPLE papers as converging evidence, conflicting results, or methodological comparisons. Target: 5–8 citations per synthesis paragraph. A paragraph that discusses only one paper is acceptable only when that paper is a singular landmark requiring detailed methodological exposition. A section where most paragraphs map 1:1 to individual papers is catalog-style, not synthetic — send back: "Restructure paragraphs around arguments, not individual papers."
- Tiered treatment applied? Check that the section uses three levels of paper treatment: (1) landmark papers with detailed discussion of methods and results, (2) core papers with substantive 2–3 sentence treatment within synthesis paragraphs, (3) confirmatory papers cited as converging evidence. If all cited papers receive equal-depth treatment, the section will be either too long or too shallow — send back: "Apply tiered treatment. Not every paper needs a full paragraph — integrate core and confirmatory papers into synthesis paragraphs at higher density."
- Minimum citations per section: core sections ≥35, supporting sections ≥25? If a section writer uses fewer citations than provided in their evidence package, send back: "Your evidence package contained N papers but you only cited M. Key papers that should receive treatment: [list uncited papers from the package]."
- Citation density: the writer's self-reported `citations_per_paragraph`
  must be ≥ 4.0. The coordinator independently verifies by counting
  `\cite` commands and dividing by paragraph count in the .tex file.
  If either measure is below 3.0 → send back: "Synthesis density too
  low (X citations / Y paragraphs = Z). Merge consecutive single-paper
  paragraphs into synthesis paragraphs. Each synthesis paragraph should:
  (1) open with a claim sentence citing 2–3 papers, (2) elaborate with
  evidence from 2–3 more papers, (3) close with a synthesis sentence
  that integrates the cited papers. Target: 5–8 unique citations per
  paragraph." If between 3.0 and 4.0 → accept with a warning logged
  in the phase ledger.
- grep for `{{artifact:` in .tex files → NON-COMPLIANT. Send back: "Replace artifact markers with plain filenames in \includegraphics."
- grep for `% doi:` inside \caption{} blocks → NON-COMPLIANT. Send back: "Remove % doi: comments from inside captions — they break LaTeX brace matching."
- Brace balance check: count { and } in each section .tex file. If unbalanced → NON-COMPLIANT. Common cause: truncated captions from output limits. Send back: "Unbalanced braces — check all \caption{} arguments for missing closing braces."
- **Caption caveat enforcement:** For each figure_data comparison with Phase 6 verdict = CAVEAT, verify that ALL mandatory_caption_caveats appear in the figure's \caption{} text. If any are missing → send back: "Phase 6 required the following caveats in the caption for [figure_label]: [missing caveats]. Add them."

**MyST Format Validation (MANDATORY — run on every returned .md file before accepting):**

The coordinator delegates this to DATAML as a mechanical validation step. For each section .md file:

1. **Citation format:** Every `{cite:p}` and `{cite:t}` must use the pattern `` {cite:p}`key1, key2` ``. 
   Reject if: `` {cite:p`key `` (missing `}` before backtick), `{cite:p}key` (missing backtick wrapper), 
   or `` ({cite:p}`key`) `` (extra wrapping parens).
   Regex to catch malformed: `\{cite:[pt][^}]\`` or `\{cite:[pt]\}[A-Z]`

2. **Cross-reference format:** No `({numref}` or `({ref}` wrapping. 
   Regex: `\(\{numref` or `\(\{ref` → send back.

3. **Double backticks:** No `` `` `` outside of code blocks. Regex: `` [^`]``[^`] ``

4. **Figure paths:** All figure directives must use `../figures/` prefix (files are in content/).
   Pattern: `:::{figure} ../figures/fig_secN_name.png`
   Reject if: `:::{figure} figures/` (missing `../`)

5. **Label format:** All figure and section labels must use dashes, not colons.
   Reject if: `fig:sec` anywhere (should be `fig-sec`).

6. **Section labels present:** Each section .md must start with `(sec-LABEL)=` before the first heading.
   The canonical labels are defined in the Phase 4 scaffold.

7. **Word count:** Assert word count ≥ scaffold target for this section. If below 80% of target, 
   send back: "Section is N words, target is M. Expand coverage of [specific undertreated topics 
   from evidence package]."

8. **Notebook quality:** Every saved .ipynb must have ≥1 code cell containing `plt.subplots` 
   or `fig =` or `ax.`. Reject notebooks with only comments like "see main workspace".

If ANY check fails, `send_message` back to the writer with the specific regex matches and line numbers.
9. **No uncited mechanistic claims:** Grep for mechanistic verbs without adjacent citations.
   Patterns: sentences containing "targets", "inhibits", "drives", "gates", "modulates",
   "mediates", "provides", "controls", "generates", "stabilizes" that lack a `{cite:p}` or
   `{cite:t}` within the same sentence or the immediately preceding/following sentence.
   If found without citation, send back: "Line N contains a mechanistic claim without a
   primary data citation. Either add a citation to the paper that experimentally demonstrated
   this, or qualify with 'commonly described as...' / 'widely assumed to...' if no primary
   source can be identified. The absence of a citable primary source is itself a finding
   worth noting in the review."

Do NOT accept the section until all 9 checks pass.



**MANDATORY — Figure code reproducibility:**
For EACH figure produced, include a `:::{dropdown} 📓 Figure code` block immediately after the `:::{figure}` directive containing the COMPLETE Python code used to generate it. The code must be the actual executed code, not a stub or placeholder.

**MANDATORY — No authorship-explorer in sections:**
Do NOT include `{authorship-explorer}` in section files. It belongs only on the frontmatter page (added during Phase 13 assembly).

**Gate check — dropdown count:**
After the writer returns, the coordinator verifies: the number of `:::{dropdown}` blocks equals the number of `:::{figure}` blocks. If not, send back.


