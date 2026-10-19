// evidence-explorer-plugin.mjs
//
// The explorer consumes the versioned contract in evidence/schema. Older and
// Phase 5 per-section packages are adapted at this single boundary; the widget
// never needs to guess which producer created a package.
//
// Display adapters copy; they never write back. Source-native package fields
// (findings, conflicts, import_provenance, conflict_assessment, digests,
// rights) reach the payload verbatim, and a package file is never modified.
//
// Lineage: the versioned contract, manifest discovery, containment checks,
// diagnostics and :availability: declaration are ported from the reviewed
// evidence-contract work (dhuzard template main f205552). The :sections:
// option, build warnings and the rich conflict normalizer come from upstream
// ComputationalReviewTemplate 8cc8383.
import { existsSync, readFileSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { resolve, dirname, basename } from 'node:path';

export const EVIDENCE_SCHEMA_VERSION = '1.0.0';
const CANONICAL_FILENAME = /^evidence_section_(\d+)\.json$/;
const LEGACY_FILENAMES = [
  /^section_(\d+)_evidence_package\.json$/,
  /^section_(\d+)_evidence\.json$/,
];

/** Fields the payload adds to each finding for display; every other finding field is native. */
export const DISPLAY_FINDING_FIELDS = Object.freeze(['section', 'section_title']);
/** Fields filled for display only when the native finding does not carry them. */
export const DISPLAY_FALLBACK_FINDING_FIELDS = Object.freeze(['cite_key', 'doi', 'claim_source_sentence', 'tier']);
/** Section-level metadata carried from a package into the payload verbatim when present. */
export const PASSTHROUGH_SECTION_FIELDS = Object.freeze(['import_provenance', 'conflict_assessment']);

const evidenceDirective = {
  name: 'evidence-explorer',
  doc: 'Interactive evidence database explorer. The :evidence-dir: option is resolved relative to the calling markdown file (default "../evidence"). Packages are discovered from evidence/manifest.json or documented evidence filename patterns, so no section count is assumed; set the optional :sections: option to the review\'s section count to have an incomplete load reported as a build warning. :availability: is available (default) or not_provided.',
  options: {
    'evidence-dir': { type: String },
    availability: { type: String },
    height: { type: String },
    sections: { type: Number },
  },
  run(data) {
    return [{
      type: 'evidence-explorer',
      evidenceDir: data.options?.['evidence-dir'] || '../evidence',
      evidenceAvailability: data.options?.availability || 'available',
      height: data.options?.height || '700px',
      sectionCount: data.options?.sections || 0,
    }];
  },
};

// Raised when a declared Evidence Database cannot be bound; deliberately not
// caught by the transform, so a regression in filenames or the directory fails
// the build instead of publishing an empty explorer.
export class EvidenceLoadError extends Error {
  constructor(message) { super(message); this.name = 'EvidenceLoadError'; }
}

function asArray(value) { return Array.isArray(value) ? value : []; }
function integer(value) { return Number.isInteger(value) && value >= 0; }
function text(value) { return typeof value === 'string' && value.trim().length > 0; }
function object(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function hasOwn(value, property) { return Object.prototype.hasOwnProperty.call(value, property); }

/**
 * Validate the current contract without adding a runtime JSON-schema package.
 * The normative, machine-readable definition is evidence/schema/package.schema.json.
 */
export function validateCanonicalPackage(value) {
  const errors = [];
  if (!object(value)) return ['package must be an object'];
  if (value.evidence_package_schema_version !== EVIDENCE_SCHEMA_VERSION) {
    errors.push(`evidence_package_schema_version must be ${EVIDENCE_SCHEMA_VERSION}`);
  }
  if (!object(value.section)) errors.push('section must be an object');
  else {
    if (!integer(value.section.order)) errors.push('section.order must be a non-negative integer');
    if (!text(value.section.id)) errors.push('section.id must be a non-empty string');
    if (!text(value.section.title)) errors.push('section.title must be a non-empty string');
  }
  for (const field of ['findings', 'conflicts', 'figure_data', 'evidence_gaps']) {
    if (!Array.isArray(value[field])) errors.push(`${field} must be an array`);
  }
  if (hasOwn(value, 'replication') && !object(value.replication)) errors.push('replication must be an object');
  if (!object(value.provenance)) errors.push('provenance must be an object');
  for (const field of PASSTHROUGH_SECTION_FIELDS) {
    if (hasOwn(value, field) && !object(value[field])) errors.push(`${field} must be an object`);
  }
  for (const [index, finding] of asArray(value.findings).entries()) {
    if (!object(finding)) { errors.push(`findings[${index}] must be an object`); continue; }
    if (!text(finding.claim)) errors.push(`findings[${index}].claim must be a non-empty string`);
    if (!Array.isArray(finding.sources)) errors.push(`findings[${index}].sources must be an array`);
    else if (!finding.sources.length) errors.push(`findings[${index}].sources must contain a source`);
    for (const [sourceIndex, source] of asArray(finding.sources).entries()) {
      const sourcePath = `findings[${index}].sources[${sourceIndex}]`;
      if (!object(source)) { errors.push(`${sourcePath} must be an object`); continue; }
      if (!text(source.source_id)) errors.push(`${sourcePath}.source_id must be a non-empty string`);
      if (hasOwn(source, 'doi') && typeof source.doi !== 'string') errors.push(`${sourcePath}.doi must be a string`);
      if (hasOwn(source, 'supporting_passages') && !Array.isArray(source.supporting_passages)) {
        errors.push(`${sourcePath}.supporting_passages must be an array`);
        continue;
      }
      for (const [passageIndex, passage] of asArray(source.supporting_passages).entries()) {
        const passagePath = `${sourcePath}.supporting_passages[${passageIndex}]`;
        if (!object(passage)) { errors.push(`${passagePath} must be an object`); continue; }
        if (typeof passage.text !== 'string') errors.push(`${passagePath}.text must be a string`);
        if (hasOwn(passage, 'locator') && typeof passage.locator !== 'string') errors.push(`${passagePath}.locator must be a string`);
      }
    }
  }
  return errors;
}

function legacyFinding(finding, index) {
  if (!object(finding)) {
    throw new Error(`legacy findings[${index}] must be an object`);
  }
  const sourceId = finding.cite_key || finding.doi;
  if (!text(finding.claim) || !text(sourceId)) {
    throw new Error(`legacy findings[${index}] requires claim and cite_key or doi`);
  }
  if (hasOwn(finding, 'sources')) return { ...finding };
  const source = { source_id: sourceId };
  if (text(finding.doi)) source.doi = finding.doi;
  const passage = finding.claim_source_sentence || finding.supporting_passage;
  if (text(passage)) {
    const supportingPassage = { text: passage };
    if (text(finding.locator)) supportingPassage.locator = finding.locator;
    source.supporting_passages = [supportingPassage];
  }
  return { ...finding, sources: [source] };
}

/**
 * Finding records of a pre-v1 package. `findings` is authoritative; only when it is empty are
 * object-shaped argument-group entries accepted (bare cite-key strings there are references,
 * never findings).
 */
function legacyFindings(raw) {
  const findings = asArray(raw.findings);
  if (findings.length) return findings;
  const recovered = [];
  if (object(raw.argument_groups)) {
    for (const group of Object.values(raw.argument_groups)) {
      if (!object(group)) continue;
      for (const key of ['supporting_findings', 'supporting_evidence', 'counter_findings', 'counter_evidence']) {
        recovered.push(...asArray(group[key]).filter(object));
      }
    }
  }
  recovered.push(...asArray(raw.unmatched_findings).filter(object));
  return recovered;
}

/** Section order of a pre-v1 package: numeric `section_id`, the digits of `section_NN`, or the filename. */
function legacyOrder(raw, filename) {
  const id = raw.section_id;
  if (integer(id)) return id;
  if (typeof id === 'string') {
    const digits = id.match(/^(?:section_)?(\d+)$/);
    if (digits) return Number(digits[1]);
  }
  const match = filename.match(/(\d+)/);
  return match ? Number(match[1]) : NaN;
}

/** Adapt the historical filenames/shapes explicitly supported by v1, including the Phase 5 package. */
export function adaptEvidencePackage(raw, { filename = 'package.json' } = {}) {
  if (raw?.evidence_package_schema_version === EVIDENCE_SCHEMA_VERSION) {
    const errors = validateCanonicalPackage(raw);
    if (errors.length) throw new Error(errors.join('; '));
    return { package: raw, compatibility: 'canonical-v1' };
  }
  if (object(raw) && hasOwn(raw, 'evidence_package_schema_version')) {
    throw new Error(`unsupported evidence_package_schema_version: ${String(raw.evidence_package_schema_version)}`);
  }
  if (!object(raw)) throw new Error('legacy package must be an object');
  const order = legacyOrder(raw, filename);
  if (!integer(order)) throw new Error('legacy package requires numeric section_id, section_NN or a section filename');
  const findings = legacyFindings(raw).map(legacyFinding);
  const section = { id: String(raw.section_id ?? order), order, title: raw.section_title || `Section ${order}` };
  const packageV1 = {
    evidence_package_schema_version: EVIDENCE_SCHEMA_VERSION,
    section,
    findings,
    conflicts: asArray(raw.conflicts),
    figure_data: asArray(raw.figure_data),
    evidence_gaps: asArray(raw.evidence_gaps),
    replication: raw.replication || { unreplicated_claims: asArray(raw.unreplicated_claims) },
    provenance: raw.provenance || { migrated_from: filename, source_schema: 'legacy-section-package' },
  };
  for (const field of PASSTHROUGH_SECTION_FIELDS) {
    if (hasOwn(raw, field)) packageV1[field] = raw[field];
  }
  const errors = validateCanonicalPackage(packageV1);
  if (errors.length) throw new Error(errors.join('; '));
  return { package: packageV1, compatibility: 'legacy-section-package' };
}

function patternEntry(filename) {
  const canonical = filename.match(CANONICAL_FILENAME);
  if (canonical) return { file: filename, order: Number(canonical[1]), compatibility: 'canonical-v1' };
  for (const pattern of LEGACY_FILENAMES) {
    const legacy = filename.match(pattern);
    if (legacy) return { file: filename, order: Number(legacy[1]), compatibility: 'legacy-section-package' };
  }
  return null;
}

export function discoverEvidenceFiles(evidenceDir) {
  if (!existsSync(evidenceDir)) return { mode: 'none', entries: [], error: 'evidence directory does not exist' };
  const manifestPath = resolve(evidenceDir, 'manifest.json');
  if (existsSync(manifestPath)) {
    try {
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
      if (manifest?.schema_version !== 1 || !Array.isArray(manifest.packages)) throw new Error('manifest requires schema_version: 1 and packages[]');
      const files = new Set();
      const orders = new Set();
      const realEvidenceDir = realpathSync(evidenceDir);
      const entries = manifest.packages.map((entry, index) => {
        if (!object(entry) || !text(entry.file) || entry.file !== basename(entry.file) || !/^[^/\\]+\.json$/.test(entry.file) || !integer(entry.order)) {
          throw new Error(`manifest.packages[${index}] requires a local JSON file and non-negative order`);
        }
        if (files.has(entry.file)) throw new Error(`manifest.packages[${index}].file duplicates ${entry.file}`);
        if (orders.has(entry.order)) throw new Error(`manifest.packages[${index}].order duplicates ${entry.order}`);
        files.add(entry.file);
        orders.add(entry.order);
        const packagePath = resolve(realEvidenceDir, entry.file);
        if (!existsSync(packagePath)) throw new Error(`manifest.packages[${index}].file does not exist: ${entry.file}`);
        const realPackagePath = realpathSync(packagePath);
        if (dirname(realPackagePath) !== realEvidenceDir || !statSync(realPackagePath).isFile()) {
          throw new Error(`manifest.packages[${index}].file must resolve to a file inside the evidence directory`);
        }
        return { file: entry.file, order: entry.order, compatibility: 'manifest' };
      });
      return { mode: 'manifest', entries: entries.sort((a, b) => a.order - b.order || a.file.localeCompare(b.file)) };
    } catch (error) { return { mode: 'manifest-invalid', entries: [], error: error.message }; }
  }
  const entries = readdirSync(evidenceDir, { withFileTypes: true })
    .filter(entry => entry.isFile())
    .map(entry => patternEntry(entry.name))
    .filter(Boolean)
    .sort((a, b) => a.order - b.order || a.file.localeCompare(b.file));
  return { mode: 'pattern', entries };
}

function diagnosticStatus({ directory, discovered, loaded, rejected }) {
  if (directory.mode === 'none') return 'missing_directory';
  if (directory.mode === 'manifest-invalid') return 'invalid_manifest';
  if (!discovered.length) return 'no_compatible_files';
  if (!loaded.length) return 'invalid_packages';
  if (rejected.length) return 'partial_loading';
  if (loaded.every(entry => entry.package.findings.length === 0)) return 'loaded_zero_findings';
  return 'loaded';
}

export function loadEvidenceDirectory(evidenceDir) {
  const discovery = discoverEvidenceFiles(evidenceDir);
  const loaded = [];
  const rejected = [];
  const sectionOrders = new Map();
  for (const entry of discovery.entries) {
    const path = resolve(evidenceDir, entry.file);
    try {
      const raw = JSON.parse(readFileSync(path, 'utf-8'));
      const adapted = adaptEvidencePackage(raw, { filename: basename(path) });
      const duplicate = sectionOrders.get(adapted.package.section.order);
      if (duplicate) throw new Error(`section.order ${adapted.package.section.order} duplicates ${duplicate}`);
      sectionOrders.set(adapted.package.section.order, entry.file);
      loaded.push({ ...entry, ...adapted });
    } catch (error) { rejected.push({ file: entry.file, reason: error.message }); }
  }
  const status = diagnosticStatus({ directory: discovery, discovered: discovery.entries, loaded, rejected });
  return {
    status,
    discovery_mode: discovery.mode,
    diagnostics: {
      message: discovery.error || null,
      discovered: discovery.entries.map(entry => entry.file),
      loaded: loaded.map(entry => ({ file: entry.file, compatibility: entry.compatibility })),
      rejected,
    },
    packages: loaded.map(entry => entry.package),
  };
}

const BLOCKING_AVAILABLE_STATUSES = new Set([
  'missing_directory', 'invalid_manifest', 'no_compatible_files', 'invalid_packages',
]);

/** Apply the page author's explicit declaration to a loader result. */
export function applyEvidenceAvailability(result, availability = 'available') {
  if (!['available', 'not_provided'].includes(availability)) {
    throw new EvidenceLoadError(`evidence-explorer :availability: must be available or not_provided (received ${availability})`);
  }
  if (availability === 'not_provided') {
    return {
      ...result,
      status: 'not_provided',
      packages: [],
      diagnostics: { ...result.diagnostics, message: 'This review explicitly declares that no Evidence Database is provided.' },
    };
  }
  if (BLOCKING_AVAILABLE_STATUSES.has(result.status)) {
    const detail = result.diagnostics.message || result.diagnostics.rejected.map(entry => `${entry.file}: ${entry.reason}`).join('; ');
    throw new EvidenceLoadError(`Evidence Database is declared available but no compatible package could be loaded (${result.status}). ${detail}`);
  }
  return result;
}

function padOrder(order) { return String(order).padStart(2, '0'); }

const MAX_LISTED_GAPS = 20;

/**
 * Missing section orders between adjacent discovered orders, without walking the
 * span: work and output are bounded by the number of files and MAX_LISTED_GAPS,
 * however sparse the orders are. Orders beyond Number.MAX_SAFE_INTEGER cannot be
 * enumerated exactly, so they are excluded from the analysis and counted.
 */
function orderGaps(entries) {
  const safe = [...new Set(entries.filter(integer))].filter(Number.isSafeInteger).sort((a, b) => a - b);
  const unsafe = new Set(entries.filter(integer)).size - safe.length;
  const listed = [];
  let total = 0n;
  for (let i = 1; i < safe.length; i += 1) {
    const missing = BigInt(safe[i]) - BigInt(safe[i - 1]) - 1n;
    total += missing;
    for (let order = safe[i - 1] + 1; listed.length < MAX_LISTED_GAPS && order < safe[i]; order += 1) listed.push(padOrder(order));
  }
  return { listed, total, unsafe };
}

/** A package with no conflicts that says why (fork CONFLICTS_DECLARED semantics). */
function conflictsDeclaredEmpty(pkg) {
  const assessment = pkg.conflict_assessment;
  return pkg.conflicts.length === 0
    && object(assessment)
    && ['none_found', 'not_assessed'].includes(assessment.status)
    && text(assessment.basis);
}

/**
 * Advisory build warnings for a bound (non-fatal) load. They never change the
 * payload: a reader may still see a partial explorer, while review gates reject
 * partial sets from the loader diagnostics. Interior gaps are only meaningful
 * for filename discovery; a manifest declares its packages explicitly and may
 * be deliberately non-contiguous. Long gap lists are truncated with a count.
 * An empty conflict set is reported only when no package declares it through
 * `conflict_assessment`: a declared empty set is legitimate, not a defect.
 */
export function evidenceLoadWarnings(result, { sectionCount = 0, evidenceDir = 'evidence directory' } = {}) {
  if (result.status === 'not_provided') return [];
  const warnings = [];
  let gaps = { listed: [], total: 0n, unsafe: 0 };
  if (result.discovery_mode === 'pattern') {
    gaps = orderGaps(result.diagnostics.discovered.map(file => patternEntry(file)?.order));
  }
  if (gaps.unsafe) {
    warnings.push(`evidence-explorer: ${gaps.unsafe} evidence file(s) in ${evidenceDir} have a section order beyond ${Number.MAX_SAFE_INTEGER}; they were not checked for gaps.`);
  }
  const gapText = gaps.total > BigInt(gaps.listed.length)
    ? `${gaps.listed.join(', ')} and ${gaps.total - BigInt(gaps.listed.length)} more`
    : gaps.listed.join(', ');
  const loadedSections = result.packages.length;
  if (gaps.total > 0n || (sectionCount && loadedSections !== sectionCount)) {
    warnings.push(`evidence-explorer: loaded ${loadedSections} section(s) from ${evidenceDir}`
      + (sectionCount ? `, but :sections: declares ${sectionCount}` : '')
      + (gaps.total > 0n ? `; no evidence file for section(s) ${gapText}` : '')
      + '; the explorer is incomplete.');
  }
  if (result.status === 'partial_loading') {
    const rejected = result.diagnostics.rejected.map(entry => `${entry.file}: ${entry.reason}`).join('; ');
    warnings.push(`evidence-explorer: ${result.diagnostics.rejected.length} package(s) in ${evidenceDir} were rejected (${rejected}); the explorer renders a partial set, which review gates reject.`);
  }
  if (result.status === 'loaded_zero_findings') {
    warnings.push(`evidence-explorer: ${loadedSections} package(s) loaded from ${evidenceDir} but they contain zero findings; the explorer will render empty finding panels.`);
  }
  const conflictCount = result.packages.reduce((sum, pkg) => sum + pkg.conflicts.length, 0);
  const undeclared = result.packages.filter(pkg => pkg.conflicts.length === 0 && !conflictsDeclaredEmpty(pkg));
  if (loadedSections && conflictCount === 0 && undeclared.length) {
    warnings.push(`evidence-explorer: ${loadedSections} package(s) loaded from ${evidenceDir} with zero conflicts, and ${undeclared.length} of them declare no conflict_assessment; the Conflicts panel will render empty.`);
  }
  return warnings;
}

function firstDoi(value) {
  const match = String(value || '').match(/10\.\d{4,}\/[^\s,;)]+/);
  return match ? match[0] : '';
}

function sideText(side) {
  if (typeof side === 'string') return side;
  if (object(side)) return side.position || side.claim || JSON.stringify(side).slice(0, 200);
  return '';
}

/**
 * Universal conflict normalizer — handles the 15+ schema variants agents have
 * produced. Returns a display copy; the native record is kept unchanged under
 * `source_conflict`.
 */
export function normalizeConflict(c, sec) {
  const norm = { section: sec };

  norm.topic = c.topic || c.description || '';
  norm.nature_of_conflict = c.nature_of_conflict || c.description || c.topic || '';
  norm.resolution_status = c.resolution_status || c.resolution || '';

  norm.side_a = c.paper1_claim || c.paper_a_claim || c.claim_a || sideText(c.side_a);
  norm.side_b = c.paper2_claim || c.paper_b_claim || c.claim_b || sideText(c.side_b);

  norm.paper_a_doi = c.paper1_doi || c.paper_a_doi || '';
  norm.paper_b_doi = c.paper2_doi || c.paper_b_doi || '';

  // Nested structures: side objects carrying evidence text, then papers_* arrays.
  for (const [doiKey, side, letter] of [['paper_a_doi', c.side_a, 'a'], ['paper_b_doi', c.side_b, 'b']]) {
    if (norm[doiKey]) continue;
    if (object(side)) norm[doiKey] = firstDoi(side.supporting_evidence || side.evidence || '');
    for (const key of Object.keys(c)) {
      if (key.includes('papers') && key.includes(letter) && Array.isArray(c[key])) {
        const dois = c[key].filter(p => typeof p === 'string' && p.startsWith('10.'));
        if (dois.length > 0) norm[doiKey] = dois.join(', ');
      }
    }
  }

  // papers[] array format — DOIs from array items.
  if (Array.isArray(c.papers) && (!norm.paper_a_doi || !norm.paper_b_doi)) {
    const dois = c.papers.map(p => (typeof p === 'string' ? p : (p?.doi || ''))).filter(Boolean);
    if (dois.length >= 1 && !norm.paper_a_doi) norm.paper_a_doi = dois[0];
    if (dois.length >= 2 && !norm.paper_b_doi) norm.paper_b_doi = dois[1];
  }

  // Custom papers_<position> fields (e.g. papers_supporting_divisive).
  if (!norm.paper_a_doi || !norm.paper_b_doi) {
    const paperKeys = Object.keys(c).filter(k => k.startsWith('papers_'));
    if (paperKeys.length >= 2) {
      for (let i = 0; i < 2; i += 1) {
        const value = c[paperKeys[i]];
        const dois = Array.isArray(value) ? value.map(p => (typeof p === 'string' ? p : (p?.doi || ''))).filter(Boolean) : [];
        const [doiKey, sideKey] = i === 0 ? ['paper_a_doi', 'side_a'] : ['paper_b_doi', 'side_b'];
        if (!norm[doiKey] && dois.length > 0) {
          norm[doiKey] = dois.join(', ');
          if (!norm[sideKey]) norm[sideKey] = paperKeys[i].replace('papers_', '').replace(/_/g, ' ');
        }
      }
    }
  }

  norm.likely_reason = c.likely_reason || c.assessment || c.notes || c.significance || c.why_it_matters || '';
  norm.source_conflict = c;
  return norm;
}

/** Display copy of a native finding: only adds fields, never overwrites a native one except DISPLAY_FINDING_FIELDS. */
function displayFinding(finding, pkg) {
  const primarySource = finding.sources[0] || {};
  const fallbacks = {
    cite_key: primarySource.source_id,
    doi: primarySource.doi || '',
    claim_source_sentence: primarySource.supporting_passages?.[0]?.text || '',
    tier: finding.replication_status,
  };
  const display = { ...finding };
  for (const field of DISPLAY_FALLBACK_FINDING_FIELDS) {
    if (!hasOwn(display, field) && fallbacks[field] !== undefined) display[field] = fallbacks[field];
  }
  display.section = pkg.section.order;
  display.section_title = pkg.section.title;
  return display;
}

export function explorerDataFromLoad(result) {
  const sections = [];
  const findings = [];
  const conflicts = [];
  const figureData = [];
  const compatibility = new Map(asArray(result.diagnostics?.loaded).map(entry => [entry.file, entry.compatibility]));
  const loadedFiles = asArray(result.diagnostics?.loaded).map(entry => entry.file);
  for (const [index, pkg] of result.packages.entries()) {
    const section = pkg.section.order;
    const packageFindings = pkg.findings.map(finding => displayFinding(finding, pkg));
    const packageConflicts = pkg.conflicts.map(conflict => normalizeConflict(conflict, section));
    const packageFigureData = pkg.figure_data.map(data => ({ ...data, section }));
    const entry = {
      section,
      section_id: pkg.section.id,
      title: pkg.section.title,
      papers: new Set(packageFindings.flatMap(f => f.sources.map(s => s.doi || s.source_id))).size,
      findings: packageFindings.length,
      conflicts: packageConflicts.length,
      figure_comparisons: packageFigureData.length,
    };
    const file = loadedFiles[index];
    if (file) entry.compatibility = compatibility.get(file);
    for (const field of PASSTHROUGH_SECTION_FIELDS) {
      if (hasOwn(pkg, field)) entry[field] = pkg[field];
    }
    sections.push(entry);
    findings.push(...packageFindings); conflicts.push(...packageConflicts); figureData.push(...packageFigureData);
  }
  return { sections, findings, conflicts, figure_data: figureData, evidence_status: result.status, diagnostics: result.diagnostics };
}

const evidenceTransform = {
  name: 'evidence-data-loader',
  stage: 'document',
  plugin: (opts, utils) => (tree, vfile) => {
    function warn(message, node) {
      if (utils && typeof utils.fileWarn === 'function') utils.fileWarn(vfile, message, { node });
      else console.warn(message);
    }
    function transform(node) {
      if (node?.type === 'evidence-explorer') {
        const documentDir = vfile?.path ? dirname(vfile.path) : process.cwd();
        const evidenceDir = resolve(documentDir, node.evidenceDir || '../evidence');
        const loaded = loadEvidenceDirectory(evidenceDir);
        const result = applyEvidenceAvailability(loaded, node.evidenceAvailability || 'available');
        for (const message of evidenceLoadWarnings(result, { sectionCount: node.sectionCount || 0, evidenceDir })) warn(message, node);
        node.type = 'anywidget';
        node.id = `evidence-explorer-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
        node.esm = './evidence-explorer-widget.mjs';
        node.model = { evidence_data: JSON.stringify(explorerDataFromLoad(result)), height: node.height || '700px' };
      }
      for (const child of node?.children || []) transform(child);
    }
    transform(tree);
  },
};

export default { name: 'Evidence Explorer Plugin', directives: [evidenceDirective], transforms: [evidenceTransform] };
