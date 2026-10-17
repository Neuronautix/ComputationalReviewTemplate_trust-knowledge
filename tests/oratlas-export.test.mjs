import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { exportFromSources, readSources } from '../scripts/oratlas/export-oratlas.mjs';
import { verifyOratlasExport } from '../scripts/oratlas/verify-oratlas-export.mjs';
import {
  mirrorDrift,
  oratlasAvailable,
  oratlasHead,
  oratlasProblems,
  runOratlasExtractor,
} from '../scripts/oratlas/validate-with-oratlas.mjs';
import { ORATLAS_PINNED_COMMIT } from '../scripts/oratlas/contract-pin.mjs';
import { validateSourceNativeProvenance } from '../scripts/release-artifacts/lib.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OPTIONS = {
  repositoryUrl: 'https://github.com/Neuronautix/ComputationalReviewTemplate_trust-knowledge',
  title: 'Computational Review Template',
  license: 'MIT',
};
const LINKS = 'tests/fixtures/oratlas/evidence-links.synthetic.json';
const COMMITTED = ['review-manifest.json', 'knowledge/oratlas/claims.jsonl', 'knowledge/oratlas/citations.jsonl', 'knowledge/oratlas/relations.jsonl', 'knowledge/oratlas/source-native-trust.json', 'knowledge/oratlas/compatibility-report.json'];
const INPUTS = ['knowledge/claim_graph.json', 'knowledge/trust_score_report.json', 'content/references.bib'];

const readJsonFile = (path) => JSON.parse(readFileSync(join(ROOT, path), 'utf8'));
const jsonlRecords = (text) => text.split('\n').filter(Boolean).map((line) => JSON.parse(line));
const build = (loaded = readSources({}, ROOT), options = OPTIONS) => exportFromSources(loaded, options);

// Materialise an export plus its source files in a scratch directory.
function scratch(mutate, { links = false } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'oratlas-export-'));
  for (const path of [...INPUTS, ...(links ? [LINKS] : [])]) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    cpSync(join(ROOT, path), join(dir, path));
  }
  const loaded = readSources(links ? { 'evidence-links': LINKS } : {}, dir);
  const { files } = exportFromSources(loaded, OPTIONS);
  for (const [path, text] of files) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), text);
  }
  mutate?.(dir);
  return dir;
}
const edit = (dir, path, change) => writeFileSync(join(dir, path), change(readFileSync(join(dir, path), 'utf8')));

test('committed export is exactly what the exporter regenerates (idempotent)', () => {
  const first = build();
  const second = build();
  for (const [path, text] of first.files) {
    assert.equal(text, second.files.get(path), `${path} is not deterministic`);
    assert.equal(text, readFileSync(join(ROOT, path), 'utf8'), `${path} is stale; re-run scripts/oratlas/export-oratlas.mjs`);
  }
  assert.deepEqual([...first.files.keys()].sort(), [...COMMITTED].sort());
  assert.deepEqual(verifyOratlasExport(ROOT), []);
});

test('review-authored claim identities and citation bindings are preserved', () => {
  const graph = readJsonFile('knowledge/claim_graph.json');
  const { files } = build();
  const claims = jsonlRecords(files.get('knowledge/oratlas/claims.jsonl'));
  assert.deepEqual(claims.map((claim) => claim.id).sort(), graph.claims.map((claim) => claim.claim_id).sort());
  const multi = graph.claims.find((claim) => claim.citation_keys.length > 1);
  const relations = jsonlRecords(files.get('knowledge/oratlas/relations.jsonl')).filter((relation) => relation.claimId === multi.claim_id);
  assert.deepEqual(relations.map((relation) => relation.citationId).sort(), [...multi.citation_keys].sort());
  assert.deepEqual(relations.map((relation) => relation.relationType).sort(), ['partially-supports', 'supports']);
  const citations = jsonlRecords(files.get('knowledge/oratlas/citations.jsonl'));
  assert.ok(citations.every((citation) => /^10\.\d{4,9}\//u.test(citation.doi) && citation.pmid === undefined));
  assert.ok(citations.find((citation) => citation.id === 'Cardin2009').authors.includes('Carlén, Marie'));
});

test('native TRUST v2 is never expressed as an ORAtlas assessment or score', () => {
  const { files, report } = build();
  const manifest = JSON.parse(files.get('review-manifest.json'));
  assert.equal(manifest.artifacts.trustAssessments, undefined);
  for (const path of ['claims', 'citations', 'relations'].map((name) => `knowledge/oratlas/${name}.jsonl`)) {
    assert.doesNotMatch(files.get(path), /trust|score|verified|assessor|aggregate|reviewStatus/iu, `${path} leaks TRUST semantics`);
  }
  assert.equal(report.exported.trust_assessments, 0);
});

test('source-native sidecar keeps the claim graph, atoms, groups and TRUST v2 intact and hash-bound', () => {
  const graph = readJsonFile('knowledge/claim_graph.json');
  const trust = readJsonFile('knowledge/trust_score_report.json');
  const sidecar = JSON.parse(build().files.get('knowledge/oratlas/source-native-trust.json'));
  validateSourceNativeProvenance(sidecar.source_native_provenance);
  assert.equal(sidecar.sources.claim_graph.sha256, readSources({}, ROOT).claimGraph.sha256);
  for (const claim of graph.claims) {
    const kept = sidecar.claims.find((candidate) => candidate.claim_id === claim.claim_id);
    assert.deepEqual(kept.claim_atoms, claim.claim_atoms);
    assert.deepEqual(kept.citation_contexts, claim.citation_contexts);
    assert.deepEqual(kept.knowledge_edges, claim.knowledge_edges);
    assert.deepEqual(kept.uncovered_atoms, []);
    assert.equal(kept.trust_v2.origin, 'source_native_trust');
    assert.equal(kept.trust_v2.rubric_version, '2.0.0');
    assert.equal(kept.trust_v2.overall_score, claim.trust_score.overall_score);
    assert.deepEqual(kept.trust_v2.components, claim.trust_score.components);
    assert.deepEqual(kept.trust_v2.report_entry, trust.claims.find((entry) => entry.claim_id === claim.claim_id));
  }
  const first = sidecar.claims.find((claim) => claim.claim_id === 'clm_7659634fb095cdce');
  assert.deepEqual(first.atom_citation_coverage, { a1: ['Cardin2009', 'Sohal2009'], a2: ['Cardin2009'] });
  assert.deepEqual(first.independence_groups, ['deisseroth_optogenetics_2009']);
});

test('compatibility report accounts for parsed, exported and lost data', () => {
  const { report } = build();
  assert.deepEqual(report.parsed, { claims: 4, citations_cited: 5, edges: 5 });
  assert.deepEqual(report.exported, { claims: 4, citations: 5, relations: 5, trust_assessments: 0 });
  assert.deepEqual(report.dropped, []);
  assert.equal(report.lossy_import_shape.claim_atoms, 15);
  assert.equal(report.lossy_import_shape.atom_level_passages, 16);
  assert.ok(report.metadata_notes.some((note) => note.field === 'pmid'), 'missing PMIDs must be noted explicitly');
  assert.equal(report.target.pinned_commit, ORATLAS_PINNED_COMMIT);
  assert.equal(report.sidecar_reference.path, 'knowledge/oratlas/source-native-trust.json');
});

test('producer findings link to review claims at a separate, labelled provenance level', () => {
  const dir = scratch(undefined, { links: true });
  try {
    const sidecar = JSON.parse(readFileSync(join(dir, 'knowledge/oratlas/source-native-trust.json'), 'utf8'));
    assert.equal(sidecar.evidence_links.length, 2);
    const claim = sidecar.claims.find((candidate) => candidate.claim_id === 'clm_7659634fb095cdce');
    assert.equal(claim.provenance_level, 'review_claim');
    assert.deepEqual(claim.evidence_links.map((link) => link.level), ['producer_finding', 'producer_finding']);
    assert.deepEqual(claim.evidence_links.map((link) => link.cite_key).sort(), ['Cardin2009', 'Sohal2009']);
    assert.ok(claim.evidence_links.every((link) => link.finding_source_sha256 && link.packet_sha256));
    assert.deepEqual(verifyOratlasExport(dir), []);
    // Findings never become review claims.
    assert.equal(jsonlRecords(readFileSync(join(dir, 'knowledge/oratlas/claims.jsonl'), 'utf8')).length, 4);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('evidence links that do not resolve to the claim graph are rejected', () => {
  const links = readJsonFile(LINKS);
  const loaded = (mutate) => {
    const copy = structuredClone(links);
    mutate(copy);
    const base = readSources({}, ROOT);
    return { ...base, links: { path: LINKS, sha256: 'a'.repeat(64), bytes: 1, text: JSON.stringify(copy) } };
  };
  assert.throws(() => build(loaded((l) => { l.findings[0].claim_ids = ['clm_0000000000000000']; })), /unknown review claim/u);
  assert.throws(() => build(loaded((l) => { l.findings[0].cite_key = 'gebru2021datasheets'; })), /does not cite/u);
  assert.throws(() => build(loaded((l) => { l.findings[0].doi = '10.1000/other'; })), /DOI differs/u);
  assert.throws(() => build(loaded((l) => { l.findings[0].source_sha256 = 'xyz'; })), /SHA-256/u);
});

test('negative: bad DOI is omitted with a note and cannot pass the verifier', () => {
  const loaded = readSources({}, ROOT);
  const bad = { ...loaded, bibliography: { ...loaded.bibliography, text: loaded.bibliography.text.replace('doi = {10.1145/3458723}', 'doi = {not-a-doi}') } };
  assert.throws(() => build(bad), /conflicts with claim graph DOI/u);
  // A bibliography with no DOI at all: graph DOI is used; a malformed graph DOI is omitted and reported.
  const dir = scratch((d) => {
    edit(d, 'knowledge/oratlas/citations.jsonl', (text) => text.replace('10.1145/3458723', 'not-a-doi'));
  });
  try {
    assert.ok(verifyOratlasExport(dir).some((problem) => /citations:\d+: doi/u.test(problem)));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('negative: missing citation/claim link fails closed', () => {
  const loaded = readSources({}, ROOT);
  const graph = JSON.parse(loaded.claimGraph.text);
  graph.edges = graph.edges.filter((edge) => edge.target !== 'Sohal2009');
  assert.throws(() => build({ ...loaded, claimGraph: { ...loaded.claimGraph, text: JSON.stringify(graph) } }), /no claim-graph edge/u);
  const dangling = JSON.parse(loaded.claimGraph.text);
  dangling.edges[0].target = 'Unknown2020';
  assert.throws(() => build({ ...loaded, claimGraph: { ...loaded.claimGraph, text: JSON.stringify(dangling) } }), /uncited or unknown/u);
  const dir = scratch((d) => edit(d, 'knowledge/oratlas/relations.jsonl', (text) => text.replace('"citationId":"Cardin2009"', '"citationId":"Missing2000"')));
  try {
    assert.ok(verifyOratlasExport(dir).some((problem) => /unknown claim or citation/u.test(problem)));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('edges ORAtlas cannot represent are reported, never silently converted', () => {
  const loaded = readSources({}, ROOT);
  const graph = JSON.parse(loaded.claimGraph.text);
  graph.edges.push({ source_claim_id: graph.claims[0].claim_id, relation: 'depends_on', target: graph.claims[1].claim_id, target_type: 'claim', weight: 1, notes: 'test' });
  const { report, files } = build({ ...loaded, claimGraph: { ...loaded.claimGraph, text: JSON.stringify(graph) } });
  assert.equal(report.dropped.length, 1);
  assert.match(report.dropped[0].reason, /not a citation/u);
  assert.equal(JSON.parse(files.get('knowledge/oratlas/source-native-trust.json')).non_exported_graph_edges.length, 1);
});

test('negative: truncated JSONL, changed hash and incompatible manifests are rejected', () => {
  let dir = scratch((d) => edit(d, 'knowledge/oratlas/claims.jsonl', (text) => text.slice(0, -40)));
  try {
    assert.ok(verifyOratlasExport(dir).some((problem) => /truncated|invalid JSON/u.test(problem)));
  } finally { rmSync(dir, { recursive: true, force: true }); }

  dir = scratch((d) => edit(d, 'knowledge/claim_graph.json', (text) => text.replace('"modality": "likely"', '"modality": "certain"')));
  try {
    assert.ok(verifyOratlasExport(dir).some((problem) => /claim_graph .*hash changed/u.test(problem)));
  } finally { rmSync(dir, { recursive: true, force: true }); }

  dir = scratch((d) => edit(d, 'knowledge/oratlas/relations.jsonl', (text) => text.replace('supports', 'amplifies')));
  try {
    assert.ok(verifyOratlasExport(dir).length > 0);
  } finally { rmSync(dir, { recursive: true, force: true }); }

  for (const [label, change, expected] of [
    ['schema version', (m) => { m.schemaVersion = '2.0.0'; }, /schemaVersion/u],
    ['unsafe path', (m) => { m.artifacts.claims = '../claims.jsonl'; }, /artifacts\.claims path/u],
    ['declared native trust', (m) => { m.artifacts.trustAssessments = 'knowledge/oratlas/source-native-trust.json'; }, /trustAssessments|trust/u],
    ['unknown key', (m) => { m.extra = true; }, /unknown top-level key/u],
  ]) {
    dir = scratch((d) => edit(d, 'review-manifest.json', (text) => { const m = JSON.parse(text); change(m); return JSON.stringify(m); }));
    try {
      assert.ok(verifyOratlasExport(dir).some((problem) => expected.test(problem)), label);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }
});

test('the real ORAtlas extractor ingests the export with zero dropped records', (t) => {
  const oratlasDir = process.env.ORATLAS_DIR;
  if (!oratlasAvailable(oratlasDir)) {
    t.skip('set ORATLAS_DIR to a dependency-installed dhuzard/oratlas checkout (see docs/ORATLAS_EXPORT.md)');
    return;
  }
  assert.equal(oratlasHead(oratlasDir), ORATLAS_PINNED_COMMIT, 'ORAtlas checkout must be at the pinned commit');
  assert.deepEqual(mirrorDrift(oratlasDir), [], 'contract mirror drifted from ORAtlas');
  const expected = build().report.exported;
  assert.deepEqual(oratlasProblems(runOratlasExtractor(oratlasDir, ROOT), expected), []);

  const linked = scratch(undefined, { links: true });
  const truncated = scratch((d) => edit(d, 'knowledge/oratlas/citations.jsonl', (text) => text.slice(0, -30)));
  const badDoi = scratch((d) => edit(d, 'knowledge/oratlas/citations.jsonl', (text) => text.replace('10.1145/3458723', 'not-a-doi')));
  const badManifest = scratch((d) => edit(d, 'review-manifest.json', (text) => text.replace('"1.0.0"', '"9.9.9"')));
  try {
    assert.deepEqual(oratlasProblems(runOratlasExtractor(oratlasDir, linked), expected), []);
    assert.ok(oratlasProblems(runOratlasExtractor(oratlasDir, truncated), expected).length > 0, 'truncated JSONL must be flagged');
    assert.ok(oratlasProblems(runOratlasExtractor(oratlasDir, badDoi), expected).length > 0, 'bad DOI must be flagged');
    assert.ok(oratlasProblems(runOratlasExtractor(oratlasDir, badManifest), expected).some((p) => /manifest rejected/u.test(p)));
  } finally {
    for (const dir of [linked, truncated, badDoi, badManifest]) rmSync(dir, { recursive: true, force: true });
  }
});
