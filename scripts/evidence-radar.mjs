#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const TYPES = new Set(['new_work', 'correction', 'expression_of_concern', 'retraction']);
const ACTIONS = {
  new_work: 'evaluate_candidate_evidence',
  correction: 'review_corrected_source_and_claim_support',
  expression_of_concern: 'urgent_source_integrity_review',
  retraction: 'urgent_source_integrity_review',
};
const normalizeDoi = (value) => String(value || '').trim().toLowerCase().replace(/^https?:\/\/(?:dx\.)?doi\.org\//, '');
const normalizeText = (value) => String(value || '').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const digest = (value) => crypto.createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const CLAIM_ID = /^clm_[a-f0-9]{16}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const MAX_FILE_BYTES = 10 * 1024 * 1024;

function safeHttps(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password;
  } catch { return false; }
}

function validate(config, feed, claimIndex, provenance) {
  const errors = [];
  if (config.schema_version !== '1.0.0' || typeof config.claim_index_path !== 'string') errors.push('config requires schema_version 1.0.0 and claim_index_path');
  if (!Array.isArray(config.claims) || !config.claims.length || config.claims.length > 10000) errors.push('config.claims must contain 1..10000 entries');
  if (!claimIndex?.claims_by_id || typeof claimIndex.claims_by_id !== 'object') errors.push('canonical claim index requires claims_by_id');
  if (!SHA256.test(provenance.claim_index_sha256 || '')) errors.push('canonical claim index SHA-256 is required');
  const ids = new Set();
  for (const claim of config.claims || []) {
    if (!CLAIM_ID.test(claim.claim_id || '')) errors.push(`invalid claim_id: ${claim.claim_id}`);
    else if (!Object.hasOwn(claimIndex?.claims_by_id || {}, claim.claim_id)) errors.push(`watched claim_id is absent from canonical claim index: ${claim.claim_id}`);
    if (ids.has(claim.claim_id)) errors.push(`duplicate claim_id: ${claim.claim_id}`);
    ids.add(claim.claim_id);
    if (!Array.isArray(claim.cited_dois) || !Array.isArray(claim.topic_queries)) errors.push(`${claim.claim_id}: watch arrays required`);
    if ((claim.cited_dois || []).length > 100 || (claim.topic_queries || []).length > 100) errors.push(`${claim.claim_id}: watch arrays exceed 100 entries`);
    if ((claim.topic_queries || []).some((query) => typeof query !== 'string' || query.length < 3 || query.length > 500)) errors.push(`${claim.claim_id}: topic query length is invalid`);
  }
  if (feed.schema_version !== '1.0.0' || !Array.isArray(feed.records) || feed.records.length > 10000) errors.push('feed requires schema_version 1.0.0 and at most 10000 records');
  if (!Number.isFinite(Date.parse(feed.retrieved_at))) errors.push('feed.retrieved_at must be valid');
  if (typeof feed.provider !== 'string' || feed.provider.length < 1 || feed.provider.length > 200) errors.push('feed.provider length is invalid');
  if (!['scanned', 'not_scanned'].includes(feed.scan_status)) errors.push('feed.scan_status must be scanned or not_scanned');
  if (feed.scan_status === 'not_scanned' && (feed.not_scanned_reason !== 'no_provider' || feed.records.length)) errors.push('not_scanned feed requires no_provider and zero records');
  for (const [index, record] of (feed.records || []).entries()) {
    if (!record.record_id || !record.title || !TYPES.has(record.alert_type)) errors.push(`record ${index}: record_id, title, and valid alert_type required`);
    if (String(record.record_id || '').length > 500 || String(record.title || '').length > 1000 || String(record.abstract || '').length > 50000) errors.push(`record ${index}: string size limit exceeded`);
    if (!Number.isFinite(Date.parse(record.observed_at))) errors.push(`record ${index}: observed_at must be valid`);
    else if (Date.parse(record.observed_at) > Date.parse(feed.retrieved_at)) errors.push(`record ${index}: observed_at is later than feed retrieval`);
    if (!safeHttps(record.source?.url) || !record.source?.provider) errors.push(`record ${index}: credential-free HTTPS source URL and provider required`);
    if (record.alert_type !== 'new_work' && !(record.related_dois || []).length) errors.push(`record ${index}: alerts require related_dois`);
  }
  return errors;
}

function topicMatch(query, record) {
  const haystack = normalizeText([record.title, record.abstract, ...(record.topics || [])].join(' '));
  const tokens = normalizeText(query).split(' ').filter((token) => token.length > 2);
  return tokens.length > 0 && tokens.every((token) => haystack.includes(token));
}

export function buildProposal(config, feed, provenance = {}, claimIndex = null) {
  const errors = validate(config, feed, claimIndex, provenance);
  if (errors.length) throw new Error(errors.join('; '));
  const proposals = [];
  for (const record of feed.records) {
    const recordDoi = normalizeDoi(record.doi);
    const related = new Set((record.related_dois || []).map(normalizeDoi));
    const affected = [];
    const reasons = [];
    for (const claim of config.claims) {
      const cited = claim.cited_dois.map(normalizeDoi);
      const doiHits = cited.filter((doi) => doi === recordDoi || related.has(doi));
      const queryHits = claim.topic_queries.filter((query) => topicMatch(query, record));
      if (doiHits.length || queryHits.length) {
        affected.push(claim.claim_id);
        if (doiHits.length) reasons.push(`${claim.claim_id}:watched_doi:${doiHits.sort().join(',')}`);
        for (const query of queryHits.sort()) reasons.push(`${claim.claim_id}:topic_query:${query}`);
      }
    }
    if (!affected.length) continue;
    proposals.push({
      proposal_id: `radar_${digest(`${record.source.provider}\n${record.record_id}\n${record.alert_type}`).slice(0, 16)}`,
      alert_type: record.alert_type,
      work: { doi: recordDoi || null, title: record.title, published_at: record.published_at || null, related_dois: [...related].sort() },
      affected_claim_ids: affected.sort(),
      rationale: [...new Set(reasons)].sort(),
      suggested_review_action: ACTIONS[record.alert_type],
      source: { provider: record.source.provider, url: record.source.url, record_id: record.record_id, observed_at: record.observed_at },
    });
  }
  proposals.sort((a, b) => a.proposal_id.localeCompare(b.proposal_id));
  return {
    schema_version: '1.0.0',
    generated_at: feed.retrieved_at,
    status: feed.scan_status === 'not_scanned' ? 'not_scanned' : (proposals.length ? 'proposals_available' : 'no_changes'),
    scan_status: feed.scan_status,
    not_scanned_reason: feed.scan_status === 'not_scanned' ? feed.not_scanned_reason : null,
    automation_mode: 'advisory_only',
    provenance,
    proposals,
    mutation_policy: {
      writes_trust_scores: false, writes_citations: false, writes_claim_text: false, writes_default_branch: false,
      human_approval_required: 'Scientific acceptance and every TRUST or review-content change require explicit human review.',
    },
  };
}

function args(argv) {
  const result = {};
  for (let i = 0; i < argv.length; i += 2) result[argv[i].replace(/^--/, '')] = argv[i + 1];
  return result;
}

function readBounded(file, label) {
  if (fs.statSync(file).size > MAX_FILE_BYTES) throw new Error(`${label} exceeds ${MAX_FILE_BYTES} bytes`);
  return fs.readFileSync(file, 'utf8');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const options = args(process.argv.slice(2));
  if (!options.config || !options.feed || !options.output) {
    console.error('Usage: evidence-radar.mjs --config FILE --feed FILE --output FILE [--claim-index FILE] [--failure-output FILE]');
    process.exit(2);
  }
  try {
    const configText = readBounded(options.config, 'config');
    const config = JSON.parse(configText);
    const feedText = readBounded(options.feed, 'feed');
    const claimIndexLogicalPath = options['claim-index'] || config.claim_index_path;
    const claimIndexPath = options['claim-index']
      ? options['claim-index']
      : path.resolve(path.dirname(options.config), '..', config.claim_index_path);
    const claimIndexText = readBounded(claimIndexPath, 'claim index');
    const output = buildProposal(config, JSON.parse(feedText), {
      config_path: options.config.replace(/\\/g, '/'), config_sha256: digest(configText),
      feed_path: options.feed.replace(/\\/g, '/'), feed_sha256: digest(feedText),
      claim_index_path: claimIndexLogicalPath.replace(/\\/g, '/'), claim_index_sha256: digest(claimIndexText),
    }, JSON.parse(claimIndexText));
    fs.mkdirSync(path.dirname(options.output), { recursive: true });
    fs.writeFileSync(options.output, `${JSON.stringify(output, null, 2)}\n`);
    console.log(`Evidence Radar: ${output.status}; ${output.proposals.length} proposal(s).`);
  } catch (error) {
    if (options['failure-output']) {
      fs.mkdirSync(path.dirname(options['failure-output']), { recursive: true });
      fs.writeFileSync(options['failure-output'], `${JSON.stringify({ schema_version: '1.0.0', status: 'failed_safe', automation_mode: 'advisory_only', error: error.message, proposals: [] }, null, 2)}\n`);
    }
    console.error(`Evidence Radar failed safely: ${error.message}`);
    process.exit(1);
  }
}
