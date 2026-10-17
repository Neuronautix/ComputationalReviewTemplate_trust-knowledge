import { sha256 } from './canonical.mjs';
import { PILOT_EXCEPTIONS } from './import.mjs';

/**
 * Executable ports of the gates in skills/comprev-curation-validator.md (Phase 5) and of the
 * import-applicable subset of skills/comprev-evidence-validator.md (Phase 2V). The skills stay the
 * authority; these exist so imported packages can be checked offline and in CI.
 */

const TEXT_ACCESS = new Set(['fulltext', 'abstract_only']);
const CONFLICT_FIELDS = ['paper_a_doi', 'paper_b_doi', 'paper_a_claim', 'paper_b_claim', 'nature_of_conflict', 'resolution_status'];
const verdict = (ok) => (ok ? 'pass' : 'fail');

/** Imported text_access "unknown" is legitimate only for a package whose sidecar hash verifies. */
export function importProvenanceVerified(pkg, lineageBytes) {
  const prov = pkg?.import_provenance;
  return Boolean(prov && lineageBytes && prov.lineage_sha256 === sha256(lineageBytes));
}

export function conflictsDeclared(pkg) {
  if (Array.isArray(pkg.conflicts) && pkg.conflicts.length) return true;
  const assessment = pkg.conflict_assessment;
  return Boolean(
    Array.isArray(pkg.conflicts)
    && assessment
    && ['none_found', 'not_assessed'].includes(assessment.status)
    && typeof assessment.basis === 'string'
    && assessment.basis.trim(),
  );
}

/** Phase 2V checks that apply to an imported package; the rest are reported as exempt with reasons. */
export function phase2ImportGate(pkg, lineageBytes) {
  const findings = Array.isArray(pkg.findings) ? pkg.findings : [];
  const hasNoneString = JSON.stringify(pkg).includes('"None"');
  const checks = {
    IMPORT_PROVENANCE_VERIFIED: verdict(importProvenanceVerified(pkg, lineageBytes)),
    EVERY_PAPER_HAS_DOI: verdict(findings.every((f) => typeof f.doi === 'string' && f.doi.startsWith('10.'))),
    NULLS_NOT_STRINGS: verdict(!hasNoneString),
    CONFLICT_FIELDS_EXACT: verdict((pkg.conflicts || []).every((c) => JSON.stringify(Object.keys(c).sort()) === JSON.stringify([...CONFLICT_FIELDS].sort()))),
    FIGURE_DATA_DOIS_UNIQUE: verdict((pkg.figure_data || []).every((fig) => new Set((fig.papers || []).map((p) => p.doi)).size === (fig.papers || []).length)),
    CONFLICTS_DECLARED: verdict(conflictsDeclared(pkg)),
    FINDINGS_ARE_OBJECTS: verdict(findings.every((f) => f && typeof f === 'object' && !Array.isArray(f))),
    NO_REPLICATION_INVENTED: verdict(findings.every((f) => f.replication_status === 'replication_unknown' && !f.replication_evidence_dois.length)),
  };
  return {
    phase: 2,
    mode: 'fixed_corpus_import',
    gate: Object.values(checks).every((v) => v === 'pass') ? 'pass' : 'fail',
    total_findings: findings.length,
    checks,
    exempt: pkg.pilot_exceptions || PILOT_EXCEPTIONS,
  };
}

const slug = (doi) => `doi_${doi.replace(/[^a-z0-9]+/gu, '_')}`;

/**
 * Pilot identity curation: one section holding every imported finding, cite_keys derived mechanically
 * from the DOI (the packet carries no publication year, so no Author-Year key is fabricated). Used by
 * the gate harness only; real Phase 5 curation by the orchestrator replaces it.
 */
export function curateIdentitySection(pkg, sectionNumber = 2) {
  return {
    section_id: `section_${String(sectionNumber).padStart(2, '0')}`,
    cluster_source: pkg.evidence_artifact_id,
    findings: pkg.findings.map((f) => ({ ...f, cite_key: slug(f.doi) })),
    argument_groups: [],
    conflicts: pkg.conflicts,
    figure_data: pkg.figure_data,
    import_provenance: pkg.import_provenance,
  };
}

function assertEvidencePackage(section) {
  const keys = new Set(Object.keys(section));
  if (['section_plan', 'figure_specs', 'figure_style_guide'].some((k) => keys.has(k)) && !keys.has('findings')) {
    return `WRONG_ARTIFACT_TYPE: expected evidence package, got scaffold extract (top-level keys: ${[...keys].sort()})`;
  }
  const missing = ['section_id', 'findings', 'argument_groups', 'conflicts', 'figure_data'].filter((k) => !keys.has(k));
  return missing.length ? `SCHEMA_INVALID: missing required keys ${missing}` : null;
}

/**
 * Phase 5 gate (checks 1-10). `phase2Packages` are the cluster packages the sections were curated from;
 * `lineageBytesByArtifact` maps evidence_artifact_id to the sidecar bytes so imported text_access can be verified.
 */
export function phase5Gate(sections, phase2Packages, lineageBytesByArtifact = {}) {
  const shapeErrors = sections.map(assertEvidencePackage).filter(Boolean);
  if (shapeErrors.length) return { phase: 5, gate: 'fail', sections_checked: sections.length, shape_errors: shapeErrors };

  const clusters = new Map(phase2Packages.map((p) => [p.evidence_artifact_id, p]));
  const phase2Dois = new Set(phase2Packages.flatMap((p) => p.findings.map((f) => f.doi)));
  const perSection = {};
  const byDoi = new Map();
  for (const section of sections) {
    const importOk = section.import_provenance
      && importProvenanceVerified(clusters.get(section.cluster_source), lineageBytesByArtifact[section.cluster_source])
      && JSON.stringify(section.import_provenance) === JSON.stringify(clusters.get(section.cluster_source).import_provenance);
    const f = section.findings;
    const sentences = f.map((x) => x.claim_source_sentence);
    perSection[section.section_id] = {
      TRACEABLE: verdict(f.every((x) => phase2Dois.has(x.doi))),
      NO_INTRA_SECTION_DUPLICATES: verdict(new Set(sentences).size === sentences.length),
      CITE_KEY_ASSIGNED: verdict(f.every((x) => typeof x.cite_key === 'string' && x.cite_key)),
      HAS_DOI: verdict(f.every((x) => typeof x.doi === 'string' && x.doi)),
      TEXT_ACCESS_VALID: verdict(f.every((x) => TEXT_ACCESS.has(x.text_access) || (x.text_access === 'unknown' && importOk))),
      FINDINGS_ARE_OBJECTS: verdict(f.every((x) => x && typeof x === 'object' && !Array.isArray(x) && 'cite_key' in x && 'doi' in x && 'claim' in x)),
    };
    for (const x of f) byDoi.set(x.doi, [...(byDoi.get(x.doi) || []), [section.section_id, x.claim_source_sentence]]);
  }
  for (const section of sections) {
    const differs = section.findings.every((x) => byDoi.get(x.doi).every(([other, sentence]) => other === section.section_id || sentence !== x.claim_source_sentence));
    perSection[section.section_id].CROSS_SECTION_DIFFERENTIATION = verdict(differs);
  }

  const anti = sections.every((section) => {
    const cluster = clusters.get(section.cluster_source);
    return cluster ? section.findings.length >= 0.75 * cluster.findings.length || cluster.findings.length === 0 : false;
  });
  const sectionFindings = sections.reduce((n, s) => n + s.findings.length, 0);
  const phase2Total = phase2Packages.reduce((n, p) => n + p.findings.length, 0);
  const sectionConflicts = new Set(sections.flatMap((s) => s.conflicts.map((c) => `${c.paper_a_doi}|${c.paper_b_doi}`)));
  const conflictsAssigned = phase2Packages.every((p) => p.conflicts.every((c) => sectionConflicts.has(`${c.paper_a_doi}|${c.paper_b_doi}`)));
  const aggregate = {
    ANTI_COMPRESSION: verdict(anti),
    ZERO_LOSS: verdict(sectionFindings >= phase2Total),
    // Vacuously true for an empty conflict set: zero Phase 2 conflicts leaves nothing to assign.
    ALL_CONFLICTS_ASSIGNED: verdict(conflictsAssigned),
  };
  const ok = Object.values(perSection).every((r) => Object.values(r).every((v) => v === 'pass')) && Object.values(aggregate).every((v) => v === 'pass');
  return { phase: 5, gate: ok ? 'pass' : 'fail', sections_checked: sections.length, per_section_results: perSection, aggregate_results: aggregate };
}
