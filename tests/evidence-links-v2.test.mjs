import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { exportFromSources, readSources } from '../scripts/oratlas/export-oratlas.mjs';
import { lineageToLinks } from '../scripts/source-evidence/lineage-to-links.mjs';
import { importPacket } from '../scripts/source-evidence/import.mjs';
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

function lineage() {
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
  return JSON.parse(result.outputs['source-evidence-lineage.json']);
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
  const source = lineage();
  const a = lineageToLinks(source, claimGraph).links;
  const b = lineageToLinks({ ...source, entries: [...source.entries].reverse() }, claimGraph).links;
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
  const source = lineage();
  source.entries[0].doi = '10.9999/not.cited';
  const { links, skipped } = lineageToLinks(source, claimGraph);
  assert.deepEqual(skipped, [{ finding_id: source.entries[0].finding.finding_id, reason: 'doi-not-cited-by-review' }]);
  assert.equal(links.findings.length, 2);
});
