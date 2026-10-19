#!/usr/bin/env node
// Regression tests for the evidence-explorer plugin's data binding.
//
// Run from the repository root:  node scripts/test_evidence_explorer.mjs
// Exits non-zero on any failure. No dependencies beyond node >= 18.
//
// Every case below corresponds to a defect that actually shipped. A complete
// evidence set once bound an empty payload while the MyST build stayed green
// (wrong filenames, a 02..13 loop, cite-key strings read as finding records,
// and `catch { continue }` hiding all of it); the opposite fix then failed the
// template's own build, whose evidence directory is legitimately empty.
//
// The loader follows the versioned evidence contract (evidence/schema): an
// un-instantiated template is not inferred from an empty directory, it is
// declared with `:availability: not_provided`. A directory declared available
// that yields no compatible package stays fatal.
//
// Provenance: the upstream cases are from ComputationalReviewTemplate 8cc8383;
// the contract-aware rewrite was reused, after review, from the untrusted
// integration candidate 58b0958; the conflict-normalization, conflict-assessment
// and no-mutation cases were added for the TRUST fork sync.

import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { cpSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES = resolve(HERE, 'test_fixtures', 'evidence_explorer');
const plugin = await import(resolve(HERE, '..', 'plugins', 'evidence-explorer-plugin.mjs'));

// Totals across scripts/test_fixtures/evidence_explorer/populated/.
const EXPECTED = { sections: 3, findings: 6, conflicts: 3, figure_data: 3 };

function render(dirName, opts = {}) {
  const warnings = [];
  const node = {
    type: 'evidence-explorer',
    evidenceDir: resolve(FIXTURES, dirName), // absolute: resolve() returns it unchanged
    evidenceAvailability: 'available',
    height: '700px',
    ...opts,
  };
  const utils = { fileWarn: (_vfile, message) => warnings.push(message) };
  let threw = null;
  try {
    plugin.default.transforms[0].plugin({}, utils)(
      { type: 'root', children: [node] },
      { path: resolve(FIXTURES, 'page.md') },
    );
  } catch (err) {
    threw = err;
  }
  const payload = node.type === 'anywidget' ? JSON.parse(node.model.evidence_data) : null;
  return { node, payload, warnings, threw };
}

// Copy a fixture into a scratch directory so a case can add malformed files.
function scratch(dirName, extraFiles = {}) {
  const target = mkdtempSync(join(tmpdir(), 'evidence-explorer-'));
  cpSync(resolve(FIXTURES, dirName), target, { recursive: true });
  for (const [name, body] of Object.entries(extraFiles)) writeFileSync(join(target, name), body);
  return target;
}

const cases = [
  ['populated binds every section', () => {
    const r = render('populated');
    if (r.threw) return `threw: ${r.threw.message}`;
    if (!r.payload) return `expected a bound widget, got node.type=${r.node.type}`;
    for (const [key, want] of Object.entries(EXPECTED)) {
      const got = r.payload[key].length;
      if (got !== want) return `${key}: bound ${got}, fixtures hold ${want}`;
    }
    if (!r.payload.findings.every((f) => f && typeof f === 'object')) {
      return 'a non-object leaked into findings (cite-key strings are not records)';
    }
    if (r.payload.evidence_status !== 'loaded') return `expected status loaded, got ${r.payload.evidence_status}`;
    if (r.warnings.length) return `unexpected warning: ${r.warnings[0]}`;
    return null;
  }],

  ['cite-key strings stay out of findings', () => {
    const r = render('populated');
    if (r.threw || !r.payload) return 'did not bind';
    const ids = new Set(r.payload.findings.map((f) => f.finding_id));
    // populated/evidence_section_01.json lists cite keys under argument_groups;
    // those must not become findings, and no finding may be missing its id.
    if (ids.has(undefined)) return 'a finding arrived without finding_id';
    if (r.payload.findings.length !== EXPECTED.findings) return 'finding count drifted';
    // Findings come only from `findings`, each adapted to carry source provenance.
    if (!r.payload.findings.every((f) => Array.isArray(f.sources) && f.sources[0]?.source_id)) {
      return 'a finding arrived without sources[0].source_id';
    }
    return null;
  }],

  ['declared not_provided renders an explicit empty state, build survives', () => {
    const r = render('template_like', { evidenceAvailability: 'not_provided' });
    if (r.threw) return `threw on a declared-absent Evidence Database: ${r.threw.message}`;
    if (r.node.type !== 'anywidget') return `expected an anywidget, got ${r.node.type}`;
    if (r.payload.evidence_status !== 'not_provided') return `expected status not_provided, got ${r.payload.evidence_status}`;
    for (const key of ['sections', 'findings', 'conflicts', 'figure_data']) {
      if (r.payload[key].length !== 0) return `${key} must be empty, got ${r.payload[key].length}`;
    }
    if (r.warnings.length) return `unexpected warning: ${r.warnings[0]}`;
    return null;
  }],

  ['empty directory declared available is fatal', () => {
    const r = render('template_like');
    if (!r.threw) return `expected a throw, got node.type=${r.node.type}`;
    if (!/no_compatible_files/.test(r.threw.message)) return `unexpected error: ${r.threw.message}`;
    return null;
  }],

  ['unmatched JSON is fatal', () => {
    const r = render('stray');
    if (!r.threw) return `expected a throw, got node.type=${r.node.type}`;
    if (!/declared available/.test(r.threw.message)) return `unexpected error: ${r.threw.message}`;
    return null;
  }],

  ['missing directory is fatal', () => {
    const r = render('no_such_directory');
    if (!r.threw) return `expected a throw, got node.type=${r.node.type}`;
    if (!/missing_directory/.test(r.threw.message)) return `unexpected error: ${r.threw.message}`;
    return null;
  }],

  ['legacy filenames still load', () => {
    const r = render('legacy');
    if (r.threw) return `threw: ${r.threw.message}`;
    if (!r.payload || r.payload.sections.length !== 2) {
      return `expected 2 sections, got ${r.payload ? r.payload.sections.length : 'none'}`;
    }
    if (!r.payload.diagnostics.loaded.every((entry) => entry.compatibility === 'legacy-section-package')) {
      return 'legacy packages were not reported through the legacy adapter';
    }
    return null;
  }],

  ['a gap in the section run warns but renders', () => {
    const r = render('gap');
    if (r.threw) return `threw: ${r.threw.message}`;
    if (!r.payload || r.payload.sections.length !== 3) return 'expected 3 sections';
    if (!r.warnings.some((w) => w.includes('03') && w.includes('04'))) {
      return `expected a warning naming sections 03 and 04, got: ${r.warnings.join(' | ')}`;
    }
    return null;
  }],

  ['a manifest may be non-contiguous without a gap warning', () => {
    const dir = scratch('gap', {
      'manifest.json': JSON.stringify({ schema_version: 1, packages: [
        { file: 'evidence_section_01.json', order: 1 },
        { file: 'evidence_section_02.json', order: 2 },
        { file: 'evidence_section_05.json', order: 5 },
      ] }),
    });
    try {
      const r = render(dir);
      if (r.threw) return `threw: ${r.threw.message}`;
      if (!r.payload || r.payload.sections.length !== 3) return 'expected 3 sections';
      if (r.warnings.length) return `unexpected warning: ${r.warnings[0]}`;
      return null;
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }],

  ['a :sections: count that disagrees warns', () => {
    const r = render('populated', { sectionCount: 12 });
    if (r.threw) return `threw: ${r.threw.message}`;
    if (!r.warnings.some((w) => w.includes(':sections: declares 12'))) {
      return `expected a warning about the declared count, got: ${r.warnings.join(' | ')}`;
    }
    return null;
  }],

  ['a :sections: count that agrees is silent', () => {
    const r = render('populated', { sectionCount: 3 });
    if (r.threw) return `threw: ${r.threw.message}`;
    if (r.warnings.length) return `unexpected warning: ${r.warnings[0]}`;
    return null;
  }],

  ['a malformed package is diagnosed, warned and kept out of the payload', () => {
    const dir = scratch('populated', { 'evidence_section_04.json': '{broken' });
    try {
      const r = render(dir);
      if (r.threw) return `partial sets must still render for readers: ${r.threw.message}`;
      if (r.payload.evidence_status !== 'partial_loading') return `expected partial_loading, got ${r.payload.evidence_status}`;
      const rejected = r.payload.diagnostics.rejected;
      if (rejected.length !== 1 || rejected[0].file !== 'evidence_section_04.json') {
        return `expected evidence_section_04.json rejected, got ${JSON.stringify(rejected)}`;
      }
      if (r.payload.sections.length !== EXPECTED.sections) return 'valid sections were dropped';
      if (!r.warnings.some((w) => w.includes('rejected') && w.includes('evidence_section_04.json'))) {
        return `expected a rejection warning, got: ${r.warnings.join(' | ')}`;
      }
      return null;
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }],

  ['only malformed packages declared available is fatal', () => {
    const dir = scratch('template_like', { 'evidence_section_01.json': '{broken' });
    try {
      const r = render(dir);
      if (!r.threw) return `expected a throw, got node.type=${r.node.type}`;
      if (!/invalid_packages/.test(r.threw.message)) return `unexpected error: ${r.threw.message}`;
      return null;
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }],

  ['directive options reach the transform', () => {
    const [node] = plugin.default.directives[0].run({ options: {
      'evidence-dir': resolve(FIXTURES, 'populated'), availability: 'available', height: '500px', sections: 12,
    } });
    if (node.sectionCount !== 12 || node.height !== '500px' || node.evidenceAvailability !== 'available') {
      return `directive dropped an option: ${JSON.stringify(node)}`;
    }
    const warnings = [];
    plugin.default.transforms[0].plugin({}, { fileWarn: (_vfile, message) => warnings.push(message) })(
      { type: 'root', children: [node] }, { path: resolve(FIXTURES, 'page.md') },
    );
    if (node.type !== 'anywidget' || node.model.height !== '500px') return 'directive node did not bind';
    if (!warnings.some((w) => w.includes(':sections: declares 12'))) return 'the :sections: option was not plumbed through';
    const [defaults] = plugin.default.directives[0].run({ options: {} });
    if (defaults.evidenceDir !== '../evidence' || defaults.evidenceAvailability !== 'available' || defaults.sectionCount !== 0) {
      return `unexpected directive defaults: ${JSON.stringify(defaults)}`;
    }
    return null;
  }],

  ['rich conflict variants are normalized and the native record kept', () => {
    const native = {
      side_a: { position: 'Divisive gain', supporting_evidence: 'see 10.1234/demo.a1 for details' },
      side_b: { claim: 'Subtractive shift', evidence: 'doi 10.1234/demo.b1' },
      description: 'Gain versus shift',
      notes: 'Different preparations',
    };
    const custom = {
      topic: 'Custom paper keys',
      papers_supporting_divisive: ['10.1234/demo.c1'],
      papers_supporting_subtractive: [{ doi: '10.1234/demo.c2' }],
    };
    const dir = scratch('populated', {
      'evidence_section_04.json': JSON.stringify({
        section_id: 'section_04', section_title: 'Conflict shapes',
        findings: [{ cite_key: 'Author41', doi: '10.1234/demo.41', claim: 'Claim 41.' }],
        conflicts: [native, custom], figure_data: [],
      }),
    });
    try {
      const r = render(dir);
      if (r.threw) return `threw: ${r.threw.message}`;
      const shaped = r.payload.conflicts.filter((c) => c.section === 4);
      if (shaped.length !== 2) return `expected 2 section-4 conflicts, got ${shaped.length}`;
      const [a, b] = shaped;
      if (a.side_a !== 'Divisive gain' || a.side_b !== 'Subtractive shift') return `side text lost: ${a.side_a} / ${a.side_b}`;
      if (a.paper_a_doi !== '10.1234/demo.a1' || a.paper_b_doi !== '10.1234/demo.b1') return `nested DOIs lost: ${a.paper_a_doi} / ${a.paper_b_doi}`;
      if (a.nature_of_conflict !== 'Gain versus shift' || a.likely_reason !== 'Different preparations') return 'description/notes lost';
      if (JSON.stringify(a.source_conflict) !== JSON.stringify(native)) return 'native conflict record not kept verbatim';
      if (b.paper_a_doi !== '10.1234/demo.c1' || b.paper_b_doi !== '10.1234/demo.c2') return `papers_* DOIs lost: ${b.paper_a_doi} / ${b.paper_b_doi}`;
      if (!b.side_b.includes('supporting subtractive')) return `papers_* side label lost: ${b.side_b}`;
      return null;
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }],

  ['an empty conflict set warns unless a package declares its conflict assessment', () => {
    const pkg = (extra) => JSON.stringify({
      section_id: 'section_01', section_title: 'No conflicts',
      findings: [{ cite_key: 'Author11', doi: '10.1234/demo.11', claim: 'Claim 11.' }],
      conflicts: [], figure_data: [], ...extra,
    });
    const undeclared = scratch('template_like', { 'evidence_section_01.json': pkg({}) });
    const declared = scratch('template_like', { 'evidence_section_01.json': pkg({
      conflict_assessment: { status: 'not_assessed', basis: 'fixed-corpus import performs no conflict detection' },
    }) });
    try {
      const u = render(undeclared);
      if (u.threw) return `threw: ${u.threw.message}`;
      if (!u.warnings.some((w) => w.includes('zero conflicts'))) return `expected a zero-conflict warning, got: ${u.warnings.join(' | ')}`;
      const d = render(declared);
      if (d.threw) return `threw: ${d.threw.message}`;
      if (d.warnings.length) return `a declared empty set must not warn: ${d.warnings[0]}`;
      const section = d.payload.sections[0];
      if (section.conflict_assessment?.status !== 'not_assessed') return 'conflict_assessment did not reach the payload';
      if (section.section_id !== 'section_01' || section.section !== 1) return `section_NN id not adapted: ${JSON.stringify(section)}`;
      return null;
    } finally {
      rmSync(undeclared, { recursive: true, force: true });
      rmSync(declared, { recursive: true, force: true });
    }
  }],

  ['binding never modifies a package file', () => {
    const dir = scratch('populated');
    try {
      const before = Object.fromEntries(readdirSync(dir).map((f) => [f, readFileSync(join(dir, f), 'utf8')]));
      const r = render(dir);
      if (r.threw) return `threw: ${r.threw.message}`;
      for (const [file, bytes] of Object.entries(before)) {
        if (readFileSync(join(dir, file), 'utf8') !== bytes) return `${file} changed on disk`;
      }
      const native = JSON.parse(before['evidence_section_01.json']).findings[0];
      const shown = r.payload.findings.find((f) => f.finding_id === native.finding_id);
      for (const [key, value] of Object.entries(native)) {
        if (JSON.stringify(shown[key]) !== JSON.stringify(value)) return `native field ${key} changed in the payload`;
      }
      return null;
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }],
];

let failed = 0;
for (const [name, run] of cases) {
  let problem;
  try {
    problem = run();
  } catch (err) {
    problem = `test itself threw: ${err.message}`;
  }
  if (problem) failed += 1;
  console.log(`${problem ? 'FAIL' : 'ok  '}  ${name}${problem ? ` — ${problem}` : ''}`);
}
console.log(`\n${cases.length - failed}/${cases.length} passed`);
process.exit(failed === 0 ? 0 : 1);
