import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import test from 'node:test';
import { buildProposal } from '../scripts/evidence-radar.mjs';

const config = JSON.parse(fs.readFileSync('config/evidence-radar.json', 'utf8'));
const feed = JSON.parse(fs.readFileSync('tests/fixtures/evidence-radar/feed.json', 'utf8'));
const claimIndexText = fs.readFileSync('knowledge/claim_index.json', 'utf8');
const claimIndex = JSON.parse(claimIndexText);
const provenance = { claim_index_sha256: crypto.createHash('sha256').update(claimIndexText).digest('hex') };

test('radar deterministically maps alerts and new works to canonical claims', () => {
  const first = buildProposal(config, feed, { fixture: true, ...provenance }, claimIndex);
  const second = buildProposal(config, feed, { fixture: true, ...provenance }, claimIndex);
  assert.deepEqual(first, second);
  assert.equal(first.generated_at, feed.retrieved_at);
  assert.equal(first.provenance.claim_index_sha256, provenance.claim_index_sha256);
  assert.equal(first.proposals.length, 2);
  assert.deepEqual(first.proposals[0].affected_claim_ids, ['clm_7659634fb095cdce']);
  assert.ok(first.proposals.some((proposal) => proposal.alert_type === 'retraction'));
});

test('output is advisory and contains no mutable review fields', () => {
  const output = buildProposal(config, feed, provenance, claimIndex);
  assert.equal(output.mutation_policy.writes_trust_scores, false);
  const serialized = JSON.stringify(output);
  for (const forbidden of ['overall_score', 'trust_score', 'claim_text', 'citation_keys']) assert.equal(serialized.includes(`"${forbidden}"`), false);
});

test('invalid feeds fail closed without proposals', () => {
  const bad = structuredClone(feed);
  bad.records[0].source.url = 'http://unsafe.example';
  assert.throws(() => buildProposal(config, bad, provenance, claimIndex), /HTTPS source URL/);
});

test('well-formed but nonexistent watched claims fail against the frozen index', () => {
  const bad = structuredClone(config);
  bad.claims[0].claim_id = 'clm_aaaaaaaaaaaaaaaa';
  assert.throws(() => buildProposal(bad, feed, provenance, claimIndex), /absent from canonical claim index/);
});

test('no-provider input is not_scanned and remains deterministic from input bytes', () => {
  const empty = JSON.parse(fs.readFileSync('config/evidence-radar.empty-feed.json', 'utf8'));
  const first = buildProposal(config, empty, provenance, claimIndex);
  const second = buildProposal(config, structuredClone(empty), provenance, claimIndex);
  assert.deepEqual(first, second);
  assert.equal(first.status, 'not_scanned');
  assert.equal(first.scan_status, 'not_scanned');
  assert.equal(first.not_scanned_reason, 'no_provider');
  assert.equal(first.generated_at, empty.retrieved_at);
});

test('source URLs reject embedded credentials', () => {
  const bad = structuredClone(feed);
  bad.records[0].source.url = 'https://user:secret@example.org/notices/1';
  assert.throws(() => buildProposal(config, bad, provenance, claimIndex), /credential-free HTTPS/);
});
