import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { exportFromSources, isRfc3339Utc, readSources } from '../scripts/oratlas/export-oratlas.mjs';
import { CLAIM_FINDING_MAP_SCHEMA, lineageToLinks } from '../scripts/source-evidence/lineage-to-links.mjs';
import { importPacket, phase2FindingDigest } from '../scripts/source-evidence/import.mjs';
import { curateIdentitySection, phase2ImportGate, phase5Gate } from '../scripts/source-evidence/phase-gates.mjs';
import { sha256 } from '../scripts/source-evidence/canonical.mjs';
import { writePacket } from './helpers/sep-packet.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OPTIONS = { repositoryUrl: 'https://github.com/Neuronautix/ComputationalReviewTemplate_trust-knowledge', title: 'Computational Review Template', license: 'MIT' };
const NA = 'not-available';
const claimGraph = JSON.parse(await (await import('node:fs/promises')).readFile(join(ROOT, 'knowledge/claim_graph.json'), 'utf8'));

const snap = (slug) => sha256(Buffer.from(`SYNTHETIC SNAPSHOT ${slug}`, 'utf8'));
const paper = (slug, doi, title) => ({
  authors: ['Synthetic, Author'], identifiers: { doi, pmcid: NA, pmid: NA }, paper_id: `paper:${slug}`, producer_ids: { article_ref: `article-${slug}` },
  rights: { full_text_included: false, license: 'synthetic-fixture-text-only', redistribution: 'allowed' },
  source_snapshot: { sha256: snap(slug), snapshot_ref: `snapshot:${slug}-1`, state: 'captured' }, source_type: 'journal-article', title,
});
const passage = (id, slug, text, start) => ({
  match: { matcher: 'quote-matcher-v1', receipt_ref: `receipt:${id}`, status: 'exact' }, paper_id: `paper:${slug}`, passage_id: `passage:${id}`,
  producer_ids: { evidence_ref: `evidence-${id}` }, quote: text, quote_sha256: sha256(Buffer.from(text, 'utf8')), quote_state: 'included',
  source: { end: start + text.length, snapshot_ref: `snapshot:${slug}-1`, start, view_id: 'view:text-v1' },
});
const finding = (id, slug, passageId) => ({
  context: { comparator: 'unknown', experimental_unit: 'unknown', exposure: 'unknown', outcome: 'unknown', population: 'unknown', time: 'unknown' },
  created_at: '2026-01-01T00:00:00Z', export_state: 'approved-for-export', finding_id: `finding:${id}`, numeric_results: [], origin: 'reviewer-interpretation',
  paper_id: `paper:${slug}`, passage_ids: [`passage:${passageId}`], review_state: 'human-reviewed', revision: 1, statement: `[SYNTHETIC] ${id}`,
  verification_level: 'source-verified', producer_ids: { answer_ref: `answer-${id}`, evidence_refs: [`evidence-${passageId}`], prediction_ref: 'prediction-links-v2' },
});
const assessment = (id, findingId, passageId, slug) => ({
  assessed_at: '2026-01-02T00:00:00Z', assessed_snapshot_sha256: snap(slug), assessment_id: `assessment:${id}`, finding_id: `finding:${findingId}`, finding_revision: 1,
  passage_id: `passage:${passageId}`, producer_ids: { support_assessment_ref: `support-${id}` }, protocol: 'seip-support-v1', rationale: 'Synthetic rationale.', reviewer_ref: 'rv-0123456789abcdef', status: 'supports',
});

function imported() {
  const dir = mkdtempSync(join(tmpdir(), 'links-v2-packet-'));
  writePacket(dir, {
    records: {
      papers: [paper('cardin', '10.1038/nature08002', 'Cardin'), paper('sohal', '10.1038/nature07991', 'Sohal')],
      passages: [passage('c1', 'cardin', '[SYNTHETIC] passage c1', 10), passage('c2', 'cardin', '[SYNTHETIC] passage c2', 90), passage('s1', 'sohal', '[SYNTHETIC] passage s1', 10)],
      findings: [finding('c-f1', 'cardin', 'c1'), finding('c-f2', 'cardin', 'c2'), finding('s-f1', 'sohal', 's1')],
      assessments: [assessment('a1', 'c-f1', 'c1', 'cardin'), assessment('a2', 'c-f2', 'c2', 'cardin'), assessment('a3', 's-f1', 's1', 'sohal')],
    },
  });
  const result = importPacket(dir, { minVerification: 'human-reviewed' });
  assert.equal(result.ok, true);
  const bytes = Buffer.from(result.outputs['source-evidence-lineage.json'], 'utf8');
  return { result, bytes, lineage: JSON.parse(bytes.toString('utf8')) };
}
const lineage = () => imported().bytes;

const CLAIM = 'clm_7659634fb095cdce';
/** A reviewed map: the claim uses c-f1 (Cardin) and s-f1 (Sohal); c-f2 is deliberately left unmapped. */
function reviewedMap({ bytes, lineage: parsed }, only = ['finding:c-f1', 'finding:s-f1']) {
  return {
    schema: CLAIM_FINDING_MAP_SCHEMA,
    lineage_sha256: sha256(bytes),
    mappings: parsed.entries
      .filter((entry) => only.includes(entry.finding.finding_id))
      .map((entry) => ({
        claim_id: CLAIM,
        finding_id: entry.finding.finding_id,
        finding_revision: entry.finding.revision,
        phase2_finding_sha256: entry.phase2_finding_sha256,
        decision_ref: 'decision:map-001',
        asserted_at: '2026-01-03T00:00:00Z',
        basis: 'Synthetic fixture decision.',
      })),
  };
}

function exportWith(links) {
  const dir = mkdtempSync(join(tmpdir(), 'links-v2-export-'));
  for (const path of ['knowledge/claim_graph.json', 'knowledge/trust_score_report.json', 'content/references.bib']) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    cpSync(join(ROOT, path), join(dir, path));
  }
  writeFileSync(join(dir, 'links.json'), `${JSON.stringify(links)}\n`);
  return exportFromSources(readSources({ 'evidence-links': 'links.json' }, dir), OPTIONS);
}

const LOCATOR_DOI = { kind: 'doi', doi: '10.5281/zenodo.1234567' };

test('the S2 lineage sidecar bridges to links/2 and exports passage-level lineage', () => {
  const { links, skipped } = lineageToLinks(lineage(), claimGraph, { locator: LOCATOR_DOI });
  assert.deepEqual(skipped, []);
  assert.equal(links.schema, 'comprev.evidence-packet-links/2');
  assert.deepEqual(links.findings.map((f) => f.finding_id), ['finding:c-f1', 'finding:c-f2', 'finding:s-f1']);
  const { files } = exportWith(links);
  const sidecar = JSON.parse(files.get('knowledge/oratlas/source-native-trust.json'));
  const first = sidecar.evidence_links[0];
  assert.equal(first.finding_revision, 1);
  assert.equal(first.verification_level, 'source-verified');
  assert.deepEqual(first.packet_locator, LOCATOR_DOI);
  assert.equal(first.finding_source_sha256_basis, 'article-source-snapshot');
  assert.match(first.passages[0].quote_sha256, /^sha256:[a-f0-9]{64}$/u);
  assert.equal(first.passages[0].match_status, 'exact');
  assert.deepEqual(first.assessments.map((a) => [a.protocol, a.status]), [['seip-support-v1', 'supports']]);
  // No TRUST vocabulary is introduced and the manifest still declares no ORAtlas TRUST.
  assert.equal(JSON.parse(files.get('review-manifest.json')).artifacts.trustAssessments, undefined);
  assert.doesNotMatch(JSON.stringify(sidecar.evidence_links), /trust/iu);
});

test('bridge and exporter are deterministic and order independent', () => {
  const source = imported();
  const reversed = Buffer.from(JSON.stringify({ ...source.lineage, entries: [...source.lineage.entries].reverse() }), 'utf8');
  const a = lineageToLinks(source.bytes, claimGraph).links;
  const b = lineageToLinks(reversed, claimGraph).links;
  assert.deepEqual(a, b);
  assert.equal(exportWith(a).files.get('knowledge/oratlas/source-native-trust.json'), exportWith(b).files.get('knowledge/oratlas/source-native-trust.json'));
});

test('locator is optional and omitted locators stay explicit null', () => {
  const { links } = lineageToLinks(lineage(), claimGraph);
  assert.equal(links.packet.locator, undefined);
  const first = JSON.parse(exportWith(links).files.get('knowledge/oratlas/source-native-trust.json')).evidence_links[0];
  assert.equal(first.packet_locator, null);
});

test('only a DOI or a GitHub release asset is accepted as a locator', () => {
  const { links } = lineageToLinks(lineage(), claimGraph);
  const good = { kind: 'github-release-asset', url: 'https://github.com/org/packets/releases/download/v1.0.0/packet.tar' };
  assert.doesNotThrow(() => exportWith({ ...links, packet: { ...links.packet, locator: good } }));
  for (const locator of [
    { kind: 'url', url: 'https://example.org/p' },
    { kind: 'github-release-asset', url: 'http://github.com/org/r/releases/download/v1/p' },
    { kind: 'github-release-asset', url: 'https://github.com/org/r/blob/main/p' },
    { kind: 'github-release-asset', url: 'https://evil.example/https://github.com/org/r/releases/download/v1/p' },
    { kind: 'doi', doi: 'not-a-doi' },
  ]) {
    assert.throws(() => exportWith({ ...links, packet: { ...links.packet, locator } }), /locator/u, JSON.stringify(locator));
  }
});

test('a locator is refused on schema /1 and malformed passage detail aborts the export', () => {
  const { links } = lineageToLinks(lineage(), claimGraph);
  assert.throws(() => exportWith({ ...links, schema: 'comprev.evidence-packet-links/1', packet: { ...links.packet, locator: LOCATOR_DOI } }), /requires schema/u);
  const broken = structuredClone(links);
  broken.findings[0].passages[0].quote_sha256 = 'abc';
  assert.throws(() => exportWith(broken), /quote_sha256/u);
  const unknownLevel = structuredClone(links);
  unknownLevel.findings[0].verification_level = 'verified';
  assert.throws(() => exportWith(unknownLevel), /verification_level/u);
});

test('a DOI the review does not cite is skipped, never linked by text', () => {
  const { lineage: source } = imported();
  source.entries[0].doi = '10.9999/not.cited';
  const { links, skipped } = lineageToLinks(Buffer.from(JSON.stringify(source)), claimGraph);
  assert.deepEqual(skipped, [{ finding_id: source.entries[0].finding.finding_id, reason: 'doi-not-cited-by-review' }]);
  assert.equal(links.findings.length, 2);
});

test('DOI equality alone yields only same-paper candidates, never claim evidence', () => {
  const { links } = lineageToLinks(lineage(), claimGraph);
  assert.ok(links.findings.length > 0);
  assert.ok(links.findings.every((f) => f.binding === 'same-paper-candidate' && f.mappings === undefined));
  const first = JSON.parse(exportWith(links).files.get('knowledge/oratlas/source-native-trust.json')).evidence_links[0];
  assert.equal(first.binding, 'same-paper-candidate');
});

test('a reviewed map binds only the mapped finding; a second finding of the same paper stays a candidate', () => {
  const source = imported();
  const { links } = lineageToLinks(source.bytes, claimGraph, { claimFindingMap: reviewedMap(source) });
  const pick = (id, binding) => links.findings.find((f) => f.finding_id === id && f.binding === binding);
  assert.deepEqual(pick('finding:c-f1', 'reviewed-mapping').claim_ids, [CLAIM]);
  assert.equal(pick('finding:c-f1', 'reviewed-mapping').phase2_finding_sha256, source.lineage.entries.find((e) => e.finding.finding_id === 'finding:c-f1').phase2_finding_sha256);
  // Same paper (Cardin), different finding (the "body temperature" next to the "locomotor activity"): not evidence.
  assert.equal(pick('finding:c-f2', 'reviewed-mapping'), undefined);
  assert.deepEqual(pick('finding:c-f2', 'same-paper-candidate').claim_ids, [CLAIM]);
  const sidecar = JSON.parse(exportWith(links).files.get('knowledge/oratlas/source-native-trust.json'));
  const claim = sidecar.claims.find((c) => c.claim_id === CLAIM);
  assert.deepEqual(
    claim.evidence_links.map((l) => [l.finding_id, l.binding]).sort(),
    [['finding:c-f1', 'reviewed-mapping'], ['finding:c-f2', 'same-paper-candidate'], ['finding:s-f1', 'reviewed-mapping']],
  );
  assert.deepEqual(claim.evidence_links.find((l) => l.binding === 'reviewed-mapping').mappings[0], {
    claim_id: CLAIM, decision_ref: 'decision:map-001', asserted_at: '2026-01-03T00:00:00Z', basis: 'Synthetic fixture decision.',
  });
});

test('the reviewed map fails closed on every mismatch', () => {
  const source = imported();
  const cases = [
    ['lineage_sha256', (m) => { m.lineage_sha256 = `sha256:${'0'.repeat(64)}`; }],
    ['not an accepted finding', (m) => { m.mappings[0].finding_revision = 2; }],
    ['not an accepted finding', (m) => { m.mappings[0].finding_id = 'finding:absent'; }],
    ['phase2_finding_sha256', (m) => { m.mappings[0].phase2_finding_sha256 = `sha256:${'1'.repeat(64)}`; }],
    ['does not cite', (m) => { m.mappings[0].claim_id = 'clm_3ea62e8a65cbdb75'; }],
    ['unknown review claim', (m) => { m.mappings[0].claim_id = 'clm_missing'; }],
    ['twice', (m) => { m.mappings.push({ ...m.mappings[0] }); }],
    ['decision_ref', (m) => { m.mappings[0].decision_ref = ' '; }],
    ['basis', (m) => { delete m.mappings[0].basis; }],
    ['asserted_at', (m) => { m.mappings[0].asserted_at = '2026-01-03'; }],
    ['schema', (m) => { m.schema = 'comprev.claim-finding-map/0'; }],
  ];
  for (const [message, mutate] of cases) {
    const map = reviewedMap(source);
    mutate(map);
    assert.throws(() => lineageToLinks(source.bytes, claimGraph, { claimFindingMap: map }), new RegExp(message.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'u'), message);
  }
});

test('the exporter refuses inconsistent bindings', () => {
  const source = imported();
  const { links } = lineageToLinks(source.bytes, claimGraph, { claimFindingMap: reviewedMap(source) });
  const reviewed = () => structuredClone(links);
  const at = (l) => l.findings.findIndex((f) => f.binding === 'reviewed-mapping');
  const noBinding = reviewed(); delete noBinding.findings[0].binding;
  assert.throws(() => exportWith(noBinding), /binding/u);
  const uncovered = reviewed(); uncovered.findings[at(uncovered)].mappings = [];
  assert.throws(() => exportWith(uncovered), /mappings/u);
  const noDigest = reviewed(); delete noDigest.findings[at(noDigest)].phase2_finding_sha256;
  assert.throws(() => exportWith(noDigest), /phase2_finding_sha256/u);
  const candidateWithMapping = reviewed();
  const c = candidateWithMapping.findings.findIndex((f) => f.binding === 'same-paper-candidate');
  candidateWithMapping.findings[c].mappings = candidateWithMapping.findings[at(candidateWithMapping)].mappings;
  assert.throws(() => exportWith(candidateWithMapping), /candidate carries no mapping/u);
});

test('the imported Phase 2 package passes the real Phase 2 and Phase 5 gates, and mapped digests are the vouched ones', () => {
  const source = imported();
  const pkg = source.result.phase2;
  assert.equal(phase2ImportGate(pkg, source.bytes).gate, 'pass');
  const section = curateIdentitySection(pkg);
  const gate5 = phase5Gate([section], [pkg], { [pkg.evidence_artifact_id]: source.bytes });
  assert.equal(gate5.gate, 'pass', JSON.stringify(gate5));
  assert.ok(pkg.findings.every((f) => f.text_access === 'unknown'));
  const vouched = new Set(pkg.findings.map(phase2FindingDigest));
  for (const mapping of reviewedMap(source).mappings) assert.ok(vouched.has(mapping.phase2_finding_sha256));
  // Editing an imported finding after import breaks the binding: text_access "unknown" is no longer vouched.
  const edited = structuredClone(pkg);
  edited.findings[0].claim = `${edited.findings[0].claim} (edited)`;
  const editedGate = phase5Gate([curateIdentitySection(edited)], [edited], { [edited.evidence_artifact_id]: source.bytes });
  assert.equal(editedGate.gate, 'fail');
  // A native (non-import) section may not use text_access "unknown" at all.
  const native = { ...curateIdentitySection(pkg), import_provenance: undefined };
  assert.equal(phase5Gate([native], [pkg], {}).per_section_results[native.section_id].TEXT_ACCESS_VALID, 'fail');
});

test('native fields are checked against the packet contract, not just for presence', () => {
  const { links } = lineageToLinks(lineage(), claimGraph);
  const cases = [
    ['status', (l) => { l.findings[0].assessments[0].status = 'trust-verified'; }],
    ['status', (l) => { l.findings[0].assessments[0].status = 'verified'; }],
    ['assessment_id', (l) => { l.findings[0].assessments[0].assessment_id = ''; }],
    ['assessment_id', (l) => { l.findings[0].assessments[0].assessment_id = 'a1'; }],
    ['passage_id', (l) => { l.findings[0].passages[0].passage_id = 'p1'; }],
    ['finding_id', (l) => { l.findings[0].finding_id = 'c-f1'; }],
  ];
  for (const [field, mutate] of cases) {
    const broken = structuredClone(links);
    mutate(broken);
    assert.throws(() => exportWith(broken), new RegExp(field, 'u'), field);
  }
  // Every status the contract defines is accepted as written.
  for (const status of ['supports', 'contradicts', 'insufficient', 'unclear', 'not_assessed', 'unknown', 'restricted']) {
    const ok = structuredClone(links);
    ok.findings[0].assessments[0].status = status;
    assert.doesNotThrow(() => exportWith(ok), status);
  }
});

test('a repeated assessment id is refused rather than shown as two judgments', () => {
  const { links } = lineageToLinks(lineage(), claimGraph);
  const repeated = structuredClone(links);
  repeated.findings[0].assessments.push({ ...repeated.findings[0].assessments[0] });
  assert.throws(() => exportWith(repeated), /repeats an assessment/u);
});

test('a same-paper candidate does not claim the citation was drawn from the finding', () => {
  const source = imported();
  const { links } = lineageToLinks(source.bytes, claimGraph, { claimFindingMap: reviewedMap(source) });
  const sidecar = JSON.parse(exportWith(links).files.get('knowledge/oratlas/source-native-trust.json'));
  const candidate = sidecar.evidence_links.find((l) => l.binding === 'same-paper-candidate');
  const reviewed = sidecar.evidence_links.find((l) => l.binding === 'reviewed-mapping');
  assert.doesNotMatch(candidate.note, /drawn from/u);
  assert.match(candidate.note, /no recorded decision says the review claim uses this finding/u);
  assert.match(reviewed.note, /drawn from/u);
});

test('asserted_at must be a real RFC 3339 UTC date and time', () => {
  for (const value of ['2026-01-03T00:00:00Z', '2024-02-29T23:59:59Z', '2026-01-03T00:00:00.123Z']) {
    assert.equal(isRfc3339Utc(value), true, value);
  }
  for (const value of ['2026-13-40T25:61:61Z', '2026-02-30T00:00:00Z', '2025-02-29T00:00:00Z', '2026-01-03T24:00:00Z', '2026-01-03T00:00:60Z', '2026-01-03T00:00:00+01:00', '2026-01-03', 7]) {
    assert.equal(isRfc3339Utc(value), false, String(value));
  }
  const source = imported();
  const map = reviewedMap(source);
  map.mappings[0].asserted_at = '2026-13-40T25:61:61Z';
  assert.throws(() => lineageToLinks(source.bytes, claimGraph, { claimFindingMap: map }), /asserted_at/u);
  const { links } = lineageToLinks(source.bytes, claimGraph, { claimFindingMap: reviewedMap(source) });
  const broken = structuredClone(links);
  broken.findings.find((f) => f.binding === 'reviewed-mapping').mappings[0].asserted_at = '2026-02-30T00:00:00Z';
  assert.throws(() => exportWith(broken), /asserted_at/u);
});
