#!/usr/bin/env node
// Deterministic generator for tests/fixtures/contributorship/ (synthetic data only: 10.5555/ test
// DOIs, invented people, reserved/fictional ORCID iDs, invented sentences; no real paper text).
//   node tests/fixtures/contributorship/build-fixture.mjs           # rewrite inputs and expected/
//   node tests/fixtures/contributorship/build-fixture.mjs --check   # fail if anything would change
//
// Three source packets feed one synthetic review: two public origins (alpha, beta) whose findings a
// reviewed map binds to claim C1, and one private origin (gamma) bound to claim C2 with no disclosure
// approval. declarations.json and authors-mixed.yml are hand-written; everything else is generated.
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { prettyJson, sha256 } from '../../../scripts/source-evidence/canonical.mjs';
import { importPacket } from '../../../scripts/source-evidence/import.mjs';
import { CLAIM_FINDING_MAP_SCHEMA } from '../../../scripts/source-evidence/lineage-to-links.mjs';
import { buildContributorship, readConfig } from '../../../scripts/contributorship/build.mjs';
import { writePacket } from '../../helpers/sep-packet.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const NA = 'not-available';
export const CLAIM_1 = 'clm_c7ed170000000001';
export const CLAIM_2 = 'clm_c7ed170000000002';

const PAPERS = {
  alpha: { doi: '10.5555/crt17.alpha', cite_key: 'synthAlpha2026', redistribution: 'allowed' },
  beta: { doi: '10.5555/crt17.beta', cite_key: 'synthBeta2026', redistribution: 'allowed' },
  gamma: { doi: '10.5555/crt17.gamma', cite_key: 'synthGamma2026', redistribution: 'allowed' },
};

function packetRecords(slug, curator) {
  const { doi, redistribution } = PAPERS[slug];
  const snap = sha256(Buffer.from(`SYNTHETIC SNAPSHOT ${slug}`, 'utf8'));
  const text = `[SYNTHETIC] ${slug} passage text that must never be copied into a contributorship companion`;
  return {
    papers: [{
      authors: [`Synthetic-${slug}, Ada`, `Synthetic-${slug}, Bo`],
      identifiers: { doi, pmcid: NA, pmid: NA },
      paper_id: `paper:${slug}`,
      producer_ids: { article_ref: `article-${slug}` },
      rights: { full_text_included: false, license: redistribution === 'allowed' ? 'CC-BY-4.0' : 'unknown', redistribution },
      source_snapshot: { sha256: snap, snapshot_ref: `snapshot:${slug}-1`, state: 'captured' },
      source_type: 'journal-article',
      title: `[SYNTHETIC] ${slug} title`,
    }],
    passages: [{
      match: { matcher: 'quote-matcher-v1', receipt_ref: `receipt:${slug}-p1`, status: 'exact' },
      paper_id: `paper:${slug}`,
      passage_id: `passage:${slug}-p1`,
      producer_ids: { evidence_ref: `evidence-${slug}-p1` },
      quote: text,
      quote_sha256: sha256(Buffer.from(text, 'utf8')),
      quote_state: 'included',
      source: { end: 10 + text.length, snapshot_ref: `snapshot:${slug}-1`, start: 10, view_id: 'view:text-v1' },
    }],
    findings: [{
      context: { comparator: 'unknown', experimental_unit: 'unknown', exposure: 'unknown', outcome: 'unknown', population: 'unknown', time: 'unknown' },
      created_at: '2026-09-01T00:00:00Z',
      export_state: 'approved-for-export',
      finding_id: `finding:${slug}-f1`,
      numeric_results: [],
      origin: 'reviewer-interpretation',
      paper_id: `paper:${slug}`,
      passage_ids: [`passage:${slug}-p1`],
      producer_ids: { answer_ref: `answer-${slug}`, evidence_refs: [`evidence-${slug}-p1`], prediction_ref: 'prediction-links-v2' },
      review_state: 'human-reviewed',
      revision: 1,
      statement: `[SYNTHETIC] ${slug} finding`,
      verification_level: 'source-verified',
    }],
    assessments: [{
      assessed_at: '2026-09-02T00:00:00Z',
      assessed_snapshot_sha256: snap,
      assessment_id: `assessment:${slug}-a1`,
      finding_id: `finding:${slug}-f1`,
      finding_revision: 1,
      passage_id: `passage:${slug}-p1`,
      producer_ids: { support_assessment_ref: `support-${slug}` },
      protocol: 'seip-support-v1',
      rationale: `[SYNTHETIC] ${slug} rationale, private to the source`,
      reviewer_ref: curator,
      status: 'supports',
    }],
  };
}

const SOURCES = [
  { slug: 'alpha', packet_id: 'packet:crt17-alpha', curator: 'rv-a1a1a1a1a1a1a1a1', claim: CLAIM_1 },
  { slug: 'beta', packet_id: 'packet:crt17-beta', curator: 'rv-b2b2b2b2b2b2b2b2', claim: CLAIM_1 },
  { slug: 'gamma', packet_id: 'packet:crt17-gamma', curator: 'rv-c3c3c3c3c3c3c3c3', claim: CLAIM_2 },
];

const claim = (id, slugs) => ({
  claim_id: id,
  claim_text: `[SYNTHETIC] review claim ${id}`,
  citation_contexts: slugs.map((slug) => ({ cite_key: PAPERS[slug].cite_key, doi: PAPERS[slug].doi })),
});

/** Every generated input and expected output, keyed by path relative to this directory. */
export function generate() {
  const files = new Map();
  const graph = { schema_version: 'synthetic-fixture', claims: [claim(CLAIM_1, ['alpha', 'beta']), claim(CLAIM_2, ['gamma'])] };
  files.set('claim-graph.json', prettyJson(graph));
  for (const source of SOURCES) {
    const dir = mkdtempSync(path.join(tmpdir(), `crt17-${source.slug}-`));
    writePacket(dir, { records: packetRecords(source.slug, source.curator), manifest: { packet_id: source.packet_id, created_at: '2026-09-03T00:00:00Z' } });
    const result = importPacket(dir, { minVerification: 'human-reviewed' });
    if (!result.ok) throw new Error(`${source.slug}: synthetic packet failed import: ${JSON.stringify(result.validation?.errors ?? result)}`);
    const bytes = Buffer.from(result.outputs['source-evidence-lineage.json'], 'utf8');
    const entry = JSON.parse(bytes.toString('utf8')).entries[0];
    files.set(`lineage-${source.slug}.json`, bytes.toString('utf8'));
    files.set(`map-${source.slug}.json`, prettyJson({
      schema: CLAIM_FINDING_MAP_SCHEMA,
      lineage_sha256: sha256(bytes),
      mappings: [{
        claim_id: source.claim,
        finding_id: entry.finding.finding_id,
        finding_revision: entry.finding.revision,
        phase2_finding_sha256: entry.phase2_finding_sha256,
        decision_ref: `decision:map-${source.slug}`,
        asserted_at: '2026-09-04T00:00:00Z',
        basis: 'Synthetic fixture decision.',
      }],
    }));
  }
  return files;
}

export const CONFIG = 'config.json';

function main() {
  const check = process.argv.includes('--check');
  const files = generate();
  const write = (rel, text) => {
    const target = path.join(HERE, rel);
    let current = null;
    try { current = readFileSync(target, 'utf8'); } catch { /* new file */ }
    if (current === text) return false;
    if (check) throw new Error(`${rel} is stale; run node tests/fixtures/contributorship/build-fixture.mjs`);
    writeFileSync(target, text);
    return true;
  };
  for (const [rel, text] of files) write(rel, text);
  const { files: outputs } = buildContributorship(readConfig(path.join(HERE, CONFIG)));
  for (const [name, text] of outputs) write(`expected/${name}`, text);
  process.stdout.write(check ? 'contributorship fixture is current\n' : 'contributorship fixture written\n');
}

if (process.argv[1] && import.meta.url === new URL(`file://${path.resolve(process.argv[1])}`).href) main();
