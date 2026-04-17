# Computational Review Template

Template repository for producing comprehensive AI-assisted critical literature reviews using the Expert Review Orchestrator v24 pipeline.

## Quick Start

1. Create a new repo from this template
2. Open in Claude and provide your review prompt:

> Start a comprehensive critical literature review titled: "[YOUR TITLE]"
> 
> The attached repository (ComputationalReviewTemplate) contains all pipeline skills and scaffold.
> Read skills/expert-review-orchestrator-v24.md FIRST. It defines all 19 phases.
> Follow it phase by phase.
>
> Table of Contents:
> [YOUR SECTIONS]

3. The pipeline will populate content/, evidence/, figures/, and provenance/

## What's Included

- **skills/** — 12 pipeline skill files (orchestrator v24 + role-specific protocols)
- **plugins/** — MyST plugins for evidence explorer, citation annotations, authorship widget  
- **content/** — Placeholder section files and widget assets
- **.github/workflows/deploy.yml** — GitHub Pages auto-build and deploy
- **myst.yml** — MyST configuration (update title and metadata)

## Pipeline Architecture

The review is produced in 19 phases with actor-critic separation:
1. Scope → 2. Evidence Gathering → 3. Citation Infrastructure → 4. Scaffold → 5. Curation → 6. Figure Audit → 7. Section Drafting → 8. Section Critics → 9. Bibliography → 10. Integration → 11. Intro/Conclusion → 12. Methods → 13. Assembly → 14. Citation Triples → 15. Verification → 16-18. Fix Cycle → 19. Repository Push

## License

MIT
