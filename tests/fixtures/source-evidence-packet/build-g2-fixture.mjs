#!/usr/bin/env node
// Deterministic generator for tests/fixtures/source-evidence-packet/g2-pilot/ (synthetic data only:
// fake 10.0000/ DOIs, "Synthetic" authors, invented sentences; no real paper text).
//   node tests/fixtures/source-evidence-packet/build-g2-fixture.mjs
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sha256 } from '../../../scripts/source-evidence/canonical.mjs';
import { writePacket } from '../../helpers/sep-packet.mjs';

const TS = '2026-01-01T00:00:00Z';
const TS_ASSESSED = '2026-01-02T00:00:00Z';
const NA = 'not-available';
const RV1 = 'rv-0123456789abcdef';
const RV2 = 'rv-fedcba9876543210';
const snap = (text) => sha256(Buffer.from(text, 'utf8'));
const SNAP_A = snap('Synthetic snapshot A');
const SNAP_C = snap('Synthetic snapshot C');
const SNAP_D = snap('Synthetic snapshot D');

const paper = (id, doi, pmid, title, snapshot, rights, authors) => ({
  authors,
  identifiers: { doi, pmcid: NA, pmid },
  paper_id: `paper:${id}`,
  producer_ids: { article_ref: `article-${id}` },
  rights: { full_text_included: false, license: rights === 'allowed' ? 'CC-BY-4.0' : 'unknown', redistribution: rights },
  source_snapshot: snapshot
    ? { sha256: snapshot.sha, snapshot_ref: `snapshot:${id}-1`, state: 'captured' }
    : { sha256: NA, snapshot_ref: NA, state: 'unavailable' },
  source_type: 'journal-article',
  title,
});

const quote = (id, paperId, text, status, start, end, snapshot) => ({
  match: { matcher: 'quote-matcher-v1', receipt_ref: `receipt:${id}`, status },
  paper_id: `paper:${paperId}`,
  passage_id: `passage:${id}`,
  producer_ids: { evidence_ref: `evidence-${id}` },
  quote: text,
  quote_sha256: sha256(Buffer.from(text, 'utf8')),
  quote_state: 'included',
  source: { end, snapshot_ref: `snapshot:${paperId}-1`, start, view_id: 'view:text-v1' },
});

const withheld = (id, paperId, hiddenText) => ({
  match: { matcher: 'unknown', receipt_ref: NA, status: 'source_unavailable' },
  paper_id: `paper:${paperId}`,
  passage_id: `passage:${id}`,
  producer_ids: { evidence_ref: `evidence-${id}` },
  quote: 'withheld',
  quote_sha256: sha256(Buffer.from(hiddenText, 'utf8')),
  quote_state: 'withheld-rights',
  source: { end: null, snapshot_ref: NA, start: null, view_id: NA },
});

const ctx = (population, exposure, comparator, outcome, time, unit) => ({ comparator, experimental_unit: unit, exposure, outcome, population, time });

const finding = (id, paperId, over) => ({
  created_at: TS,
  export_state: 'approved-for-export',
  finding_id: `finding:${id}`,
  numeric_results: [],
  origin: 'ai-paraphrase',
  paper_id: `paper:${paperId}`,
  review_state: 'human-reviewed',
  revision: 1,
  verification_level: 'human-reviewed',
  ...over,
  producer_ids: { answer_ref: `answer-${id}`, evidence_refs: over.passage_ids.map((p) => p.replace('passage:', 'evidence-')), prediction_ref: 'prediction-g2' },
});

const assess = (id, findingId, passageId, status, reviewer, snapshotSha, rationale) => ({
  assessed_at: TS_ASSESSED,
  assessed_snapshot_sha256: snapshotSha,
  assessment_id: `assessment:${id}`,
  finding_id: `finding:${findingId}`,
  finding_revision: 1,
  passage_id: `passage:${passageId}`,
  producer_ids: { support_assessment_ref: `support-${id}` },
  protocol: 'seip-support-v1',
  rationale: rationale || NA,
  reviewer_ref: reviewer,
  status,
});

export function g2Records() {
  const papers = [
    paper('g2-a', '10.0000/g2.a', NA, 'Synthetic Study A of a Toy Treatment', { sha: SNAP_A }, 'allowed', ['Synthetic, Alice', 'Synthetic, Bob']),
    paper('g2-b', NA, '00000002', 'Synthetic Study B of Another Toy Treatment', null, 'metadata-only', ['Synthetic, Carol']),
    paper('g2-c', '10.0000/G2.C', NA, 'Synthetic Study C of a Third Toy Treatment', { sha: SNAP_C }, 'allowed', ['Synthetic, Dan']),
    paper('g2-d', NA, '00000004', 'Synthetic Study D with No DOI', { sha: SNAP_D }, 'allowed', ['Synthetic, Eve']),
  ];
  const passages = [
    quote('g2-a-p1', 'g2-a', 'In synthetic mice, treatment X lowered marker Y by 2.5 units versus vehicle at day 14 (n = 12 animals per group).', 'exact', 120, 243, SNAP_A),
    quote('g2-a-p2', 'g2-a', 'By day 28 the change in marker Y persisted in both synthetic cohorts, one and two.', 'exact', 300, 380, SNAP_A),
    quote('g2-a-p3', 'g2-a', 'marker Y', 'ambiguous', null, null, SNAP_A),
    quote('g2-a-p4', 'g2-a', 'Treatment X raised marker Z in the synthetic liver samples that were assayed.', 'exact', 400, 474, SNAP_A),
    quote('g2-c-p1', 'g2-c', 'Treatment W reduced synthetic outcome V to 7.1 mg/dL across the 40 enrolled synthetic participants.', 'exact', 50, 148, SNAP_C),
    quote('g2-c-p2', 'g2-c', 'Treatment W  was well tolerated in the synthetic cohort overall.', 'normalized', 200, 262, SNAP_C),
    withheld('g2-b-p1', 'g2-b', 'Synthetic Study B hidden sentence.'),
    quote('g2-d-p1', 'g2-d', 'Synthetic treatment U improved synthetic outcome T in the synthetic sample studied here.', 'exact', 10, 95, SNAP_D),
  ];
  const findings = [
    finding('g2-a-f1', 'g2-a', {
      context: ctx('synthetic mice', 'treatment X', 'vehicle', 'marker Y level', 'day 14', 'animal'),
      numeric_results: [{ n: { definition: 'experimental-unit', value: 12 }, name: 'mean difference', unit: 'units', value: -2.5 }],
      passage_ids: ['passage:g2-a-p1'],
      statement: 'Treatment X lowered marker Y at day 14 in synthetic mice.',
      verification_level: 'independently-verified',
      origin: 'source-explicit',
    }),
    finding('g2-a-f2', 'g2-a', {
      context: ctx('synthetic mice, cohort one and cohort two', 'treatment X', 'unknown', 'marker Y change', 'day 28', 'cohort'),
      passage_ids: ['passage:g2-a-p2', 'passage:g2-a-p3'],
      statement: 'The change in marker Y persisted to day 28 in both synthetic cohorts.',
      verification_level: 'source-verified',
    }),
    finding('g2-a-f3', 'g2-a', {
      context: ctx('unknown', 'treatment X', 'unknown', 'marker Y', 'unknown', 'unknown'),
      export_state: 'proposed',
      passage_ids: ['passage:g2-a-p3'],
      review_state: 'unreviewed',
      statement: 'Marker Y is affected by treatment X.',
      verification_level: 'unverified',
    }),
    finding('g2-a-f4', 'g2-a', {
      context: ctx('synthetic mice', 'treatment X', 'vehicle', 'marker Z level', 'unknown', 'animal'),
      passage_ids: ['passage:g2-a-p4'],
      statement: 'Treatment X raised marker Z in synthetic liver.',
      verification_level: 'human-reviewed',
    }),
    finding('g2-b-f1', 'g2-b', {
      context: ctx('synthetic cohort', 'treatment Z', 'unknown', 'outcome W', 'unknown', 'unknown'),
      export_state: 'proposed',
      passage_ids: ['passage:g2-b-p1'],
      review_state: 'unreviewed',
      statement: 'Treatment Z was associated with outcome W in a synthetic cohort.',
      verification_level: 'unverified',
    }),
    finding('g2-c-f1', 'g2-c', {
      context: ctx('synthetic adults', 'treatment W', 'placebo', 'outcome V', 'week 12', 'participant'),
      numeric_results: [{ n: { definition: 'article-level', value: 40 }, name: 'mean outcome V', unit: 'mg/dL', value: 7.1 }],
      passage_ids: ['passage:g2-c-p1'],
      statement: 'Treatment W reduced outcome V in synthetic adults at week 12.',
    }),
    finding('g2-c-f2', 'g2-c', {
      context: ctx('synthetic adults', 'treatment W', 'unknown', 'tolerability', 'unknown', 'unknown'),
      passage_ids: ['passage:g2-c-p2'],
      statement: 'Treatment W was well tolerated in synthetic adults.',
    }),
    finding('g2-d-f1', 'g2-d', {
      context: ctx('synthetic sample', 'treatment U', 'unknown', 'outcome T', 'unknown', 'unknown'),
      passage_ids: ['passage:g2-d-p1'],
      statement: 'Treatment U improved outcome T in a synthetic sample.',
    }),
  ];
  const assessments = [
    assess('g2-1', 'g2-a-f1', 'g2-a-p1', 'supports', RV1, SNAP_A, 'Synthetic rationale: the sentence states the day 14 difference.'),
    assess('g2-2', 'g2-a-f1', 'g2-a-p1', 'supports', RV2, SNAP_A, 'Synthetic rationale: agrees.'),
    assess('g2-3', 'g2-a-f2', 'g2-a-p2', 'supports', RV1, SNAP_A, 'Synthetic rationale: both cohorts at day 28.'),
    assess('g2-4', 'g2-a-f2', 'g2-a-p3', 'not_assessed', RV1, SNAP_A),
    assess('g2-5', 'g2-a-f4', 'g2-a-p4', 'contradicts', RV1, SNAP_A, 'Synthetic rationale: the sentence reports a different marker.'),
    assess('g2-6', 'g2-c-f1', 'g2-c-p1', 'supports', RV1, SNAP_C, 'Synthetic rationale: states the week 12 value.'),
    assess('g2-7', 'g2-c-f2', 'g2-c-p2', 'supports', RV1, SNAP_C, 'Synthetic rationale: tolerability is stated.'),
    assess('g2-8', 'g2-d-f1', 'g2-d-p1', 'supports', RV1, SNAP_D, 'Synthetic rationale: improvement is stated.'),
  ];
  return { papers, findings, passages, assessments };
}

export function buildG2(dir) {
  return writePacket(dir, { records: g2Records() });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  buildG2(path.join(path.dirname(fileURLToPath(import.meta.url)), 'g2-pilot'));
}
