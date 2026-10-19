// TRUST #17 acceptance criterion 3, bounded offline regression (synthetic data only).
//
// WHAT THIS PROVES: unique canary strings are injected into realistic *private* builder inputs (a private
// source origin's project title/ref, an unpublished collaborator's name and ORCID, the source curator's
// pseudonymous ref, and the quoted passage and paper title of its packet). The existing credit builder is
// run on them, and the existing public pipeline is run in a scratch directory on separate, public-only
// packets. The complete output of each *enumerated* public surface is then scanned for the canaries.
//
// WHAT THIS DOES NOT PROVE (these stay blocked on ORAtlas #202 / #204 and are NOT tested here):
//  * The ORAtlas exporter and the source-evidence importer have NO access-control API. Gamma's `private`
//    visibility is declarations metadata consumed by the credit builder only. This test therefore never feeds
//    the private origin's packet to the exporter; the exporter is only given packets that are already public.
//  * Canaries detect leaked *values* (titles, names, ORCIDs, curator refs, passage text). A projection that exposed
//    only the existence or id of a private claim, without a canary value, would not be seen (see the "claim filter
//    removed alone" case in the clone mutation test: the field allowlist is the layer that held there).
//  * Caches, search/discovery indexes, logs, notifications, timing/count side channels, deployed-site output
//    and any real private data. A finite set of canaries is evidence for the listed surfaces, not a
//    universal leak-prevention guarantee.
import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test, { after } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { OUTPUT_FILES, buildContributorship, readConfig } from '../scripts/contributorship/build.mjs';
import { isValidOrcid } from '../scripts/contributorship/credit-roles.mjs';
import { exportFromSources, readSources } from '../scripts/oratlas/export-oratlas.mjs';
import { sha256 } from '../scripts/source-evidence/canonical.mjs';
import { importPacket } from '../scripts/source-evidence/import.mjs';
import { CLAIM_FINDING_MAP_SCHEMA, lineageToLinks } from '../scripts/source-evidence/lineage-to-links.mjs';
import { CLAIM_2, CLAIM_1 } from './fixtures/contributorship/build-fixture.mjs';
import { writePacket } from './helpers/sep-packet.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURE = join(ROOT, 'tests/fixtures/contributorship');
const SCRATCH = mkdtempSync(join(tmpdir(), 'crt17-leak-'));
after(() => rmSync(SCRATCH, { recursive: true, force: true }));

// ---- canaries -------------------------------------------------------------------------------------------
const CANARY = Object.freeze({
  projectRef: 'project:private-canary7f3a91-ref',
  projectTitle: 'Synthetic Private CANARY7f3a91 Title Project',
  person: 'Synthetic Collaborator CANARY7f3a91 Person',
  orcid: '0000-0002-9079-593X',
  curator: 'rv-7f3a91c0de7f3a91',
  paperTitle: '[SYNTHETIC] CANARY7f3a91 paper title',
  passage: '[SYNTHETIC] CANARY7f3a91 passage text of the private source',
});
// The ORCID is also checked without hyphens; every check is case-insensitive.
const MARKERS = [...Object.values(CANARY), CANARY.orcid.replaceAll('-', '')];

/** Scan whole artifact texts (label -> text) and return every [label, marker] hit. No label is exempt. */
function findLeaks(surfaces, markers = MARKERS) {
  const hits = [];
  for (const [label, text] of surfaces) {
    const haystack = text.toLowerCase();
    for (const marker of markers) if (haystack.includes(marker.toLowerCase())) hits.push([label, marker]);
  }
  return hits;
}

// ---- synthetic packets ----------------------------------------------------------------------------------
const NA = 'not-available';
function packetRecords(slug, { doi, title, curator, quote }) {
  const snap = sha256(Buffer.from(`SYNTHETIC SNAPSHOT ${slug}`, 'utf8'));
  return {
    papers: [{
      authors: [`Synthetic-${slug}, Ada`], identifiers: { doi, pmcid: NA, pmid: NA }, paper_id: `paper:${slug}`, producer_ids: { article_ref: `article-${slug}` },
      rights: { full_text_included: false, license: 'CC-BY-4.0', redistribution: 'allowed' },
      source_snapshot: { sha256: snap, snapshot_ref: `snapshot:${slug}-1`, state: 'captured' }, source_type: 'journal-article', title,
    }],
    passages: [{
      match: { matcher: 'quote-matcher-v1', receipt_ref: `receipt:${slug}-p1`, status: 'exact' }, paper_id: `paper:${slug}`, passage_id: `passage:${slug}-p1`,
      producer_ids: { evidence_ref: `evidence-${slug}-p1` }, quote, quote_sha256: sha256(Buffer.from(quote, 'utf8')), quote_state: 'included',
      source: { end: 10 + quote.length, snapshot_ref: `snapshot:${slug}-1`, start: 10, view_id: 'view:text-v1' },
    }],
    findings: [{
      context: { comparator: 'unknown', experimental_unit: 'unknown', exposure: 'unknown', outcome: 'unknown', population: 'unknown', time: 'unknown' },
      created_at: '2026-09-01T00:00:00Z', export_state: 'approved-for-export', finding_id: `finding:${slug}-f1`, numeric_results: [], origin: 'reviewer-interpretation',
      paper_id: `paper:${slug}`, passage_ids: [`passage:${slug}-p1`], review_state: 'human-reviewed', revision: 1, statement: `[SYNTHETIC] ${slug} finding`,
      verification_level: 'source-verified', producer_ids: { answer_ref: `answer-${slug}`, evidence_refs: [`evidence-${slug}-p1`], prediction_ref: 'prediction-links-v2' },
    }],
    assessments: [{
      assessed_at: '2026-09-02T00:00:00Z', assessed_snapshot_sha256: snap, assessment_id: `assessment:${slug}-a1`, finding_id: `finding:${slug}-f1`, finding_revision: 1,
      passage_id: `passage:${slug}-p1`, producer_ids: { support_assessment_ref: `support-${slug}` }, protocol: 'seip-support-v1', rationale: `[SYNTHETIC] ${slug} rationale`,
      reviewer_ref: curator, status: 'supports',
    }],
  };
}

/** Write a synthetic packet into SCRATCH and import it with the real importer. `scope` is the manifest access_scope.level. */
function writeAndImport(slug, packetId, fields, scope = 'public') {
  const dir = join(SCRATCH, `packet-${slug}-${scope}`);
  writePacket(dir, {
    records: packetRecords(slug, fields),
    manifest: { packet_id: packetId, created_at: '2026-09-03T00:00:00Z', access_scope: { level: scope, redistributable_full_text: false } },
  });
  return { dir, result: importPacket(dir, { minVerification: 'human-reviewed' }) };
}

// ---- the independent PUBLIC pipeline (public packets only) -----------------------------------------------
// importer outputs -> links/2 bridge -> ORAtlas export (claims/citations/relations, manifest, source-native
// sidecar, compatibility report). The review is the repository's own claim graph; both papers are cited by it.
const REVIEW_CLAIM = 'clm_7659634fb095cdce';
const PUBLIC_PAPERS = [
  { slug: 'cardin', doi: '10.1038/nature08002', packetId: 'packet:leak-public-cardin' },
  { slug: 'sohal', doi: '10.1038/nature07991', packetId: 'packet:leak-public-sohal' },
];
const PUBLIC_SURFACES = Object.freeze([
  'importer:cardin/phase2', 'importer:cardin/lineage', 'importer:cardin/report',
  'importer:sohal/phase2', 'importer:sohal/lineage', 'importer:sohal/report',
  'links/2:cardin', 'links/2:sohal',
]);
const claimGraph = JSON.parse(readFileSync(join(ROOT, 'knowledge/claim_graph.json'), 'utf8'));
const EXPORT_OPTIONS = { repositoryUrl: 'https://github.com/Neuronautix/ComputationalReviewTemplate_trust-knowledge', title: 'Computational Review Template', license: 'MIT' };

function publicPipeline(tag) {
  const surfaces = new Map();
  const workDir = join(SCRATCH, `export-${tag}`);
  for (const rel of ['knowledge/claim_graph.json', 'knowledge/trust_score_report.json', 'content/references.bib']) {
    mkdirSync(dirname(join(workDir, rel)), { recursive: true });
    cpSync(join(ROOT, rel), join(workDir, rel));
  }
  for (const { slug, doi, packetId } of PUBLIC_PAPERS) {
    const { result } = writeAndImport(slug, packetId, { doi, title: `[SYNTHETIC] public ${slug}`, curator: 'rv-0123456789abcdef', quote: `[SYNTHETIC] public passage ${slug}` });
    assert.equal(result.ok, true, `public packet ${slug} must import`);
    const [phase2, lineage, report] = Object.values(result.outputs);
    surfaces.set(`importer:${slug}/phase2`, phase2);
    surfaces.set(`importer:${slug}/lineage`, lineage);
    surfaces.set(`importer:${slug}/report`, report);
    const lineageBytes = Buffer.from(lineage, 'utf8');
    const entry = JSON.parse(lineage).entries[0];
    const claimFindingMap = {
      schema: CLAIM_FINDING_MAP_SCHEMA, lineage_sha256: sha256(lineageBytes),
      mappings: [{ claim_id: REVIEW_CLAIM, finding_id: entry.finding.finding_id, finding_revision: entry.finding.revision, phase2_finding_sha256: entry.phase2_finding_sha256, decision_ref: `decision:map-${slug}`, asserted_at: '2026-09-04T00:00:00Z', basis: 'Synthetic fixture decision.' }],
    };
    const { links, skipped } = lineageToLinks(lineageBytes, claimGraph, { claimFindingMap });
    assert.deepEqual(skipped, []);
    surfaces.set(`links/2:${slug}`, `${JSON.stringify(links)}\n`);
  }
  // Export one links/2 file per paper's packet: the exporter takes a single evidence-links file, so each is exported separately.
  for (const { slug } of PUBLIC_PAPERS) {
    writeFileSync(join(workDir, `links-${slug}.json`), surfaces.get(`links/2:${slug}`));
    const { files } = exportFromSources(readSources({ 'evidence-links': `links-${slug}.json` }, workDir), EXPORT_OPTIONS);
    for (const [path, text] of files) surfaces.set(`oratlas:${slug}/${path}`, text);
  }
  return surfaces;
}

// ---- the PRIVATE credit builder inputs (canaries injected) -----------------------------------------------
function markedCreditInputs() {
  const inputs = readConfig(join(FIXTURE, 'config.json'));
  const { dir: _dir, result } = writeAndImport('gamma', 'packet:crt17-gamma', { doi: '10.5555/crt17.gamma', title: CANARY.paperTitle, curator: CANARY.curator, quote: CANARY.passage });
  assert.equal(result.ok, true, 'the marked packet must import so the builder is tested for privacy, not for invalid input');
  const lineageBytes = Buffer.from(result.outputs['source-evidence-lineage.json'], 'utf8');
  const entry = JSON.parse(lineageBytes.toString('utf8')).entries[0];
  const claimFindingMap = {
    schema: CLAIM_FINDING_MAP_SCHEMA, lineage_sha256: sha256(lineageBytes),
    mappings: [{ claim_id: CLAIM_2, finding_id: entry.finding.finding_id, finding_revision: entry.finding.revision, phase2_finding_sha256: entry.phase2_finding_sha256, decision_ref: 'decision:map-gamma', asserted_at: '2026-09-04T00:00:00Z', basis: 'Synthetic fixture decision.' }],
  };
  // Replace the committed gamma source (third in config.json) with the marked one, bound to the NEW lineage bytes.
  const gammaIndex = inputs.sources.length - 1;
  assert.equal(JSON.parse(inputs.sources[gammaIndex].lineageBytes.toString('utf8')).packet.packet_id, 'packet:crt17-gamma');
  inputs.sources[gammaIndex] = { lineageBytes, claimFindingMap };
  const origin = inputs.declarations.source_origins.find((o) => o.origin_id === 'origin-gamma');
  assert.equal(origin.visibility, 'private');
  Object.assign(origin, { project_ref: CANARY.projectRef, project_title: CANARY.projectTitle });
  const person = inputs.declarations.contributors.find((c) => c.id === 'person-c');
  Object.assign(person, { display_name: CANARY.person, orcid: { id: CANARY.orcid, status: 'claimed' } });
  return { inputs, lineageBytes };
}

function digestTree(dir) {
  const out = new Map();
  const walk = (current) => {
    for (const name of readdirSync(current).sort()) {
      const full = join(current, name);
      if (statSync(full).isDirectory()) walk(full);
      else out.set(full.slice(dir.length + 1), sha256(readFileSync(full)));
    }
  };
  walk(dir);
  return out;
}

const PRIVATE_ALLOWLIST = Object.freeze([OUTPUT_FILES.private, OUTPUT_FILES.report]);

test('the exact private allowlist is the private companion and the private release report; the public companion is the only public builder output', () => {
  assert.deepEqual(Object.values(OUTPUT_FILES).sort(), [OUTPUT_FILES.private, OUTPUT_FILES.public, OUTPUT_FILES.report].sort());
  assert.deepEqual([...PRIVATE_ALLOWLIST].sort(), ['contributorship-release-report.json', 'contributorship.private.json']);
  assert.ok(!PRIVATE_ALLOWLIST.includes(OUTPUT_FILES.public));
  assert.ok(isValidOrcid(CANARY.orcid), 'the canary ORCID must be schema-valid so the builder accepts it');
});

test('canaries in private builder inputs reach the private companion only; no enumerated public surface contains any, and no input or fixture byte changes', () => {
  const fixtureBefore = digestTree(FIXTURE);
  const publicBefore = publicPipeline('before');
  const { inputs, lineageBytes } = markedCreditInputs();
  const inputDigests = inputs.sources.map((s) => sha256(s.lineageBytes));
  const declarationsDigest = sha256(Buffer.from(JSON.stringify(inputs.declarations)));

  // Preconditions: the canaries really are in the private inputs and in the private expected artifacts.
  assert.ok(lineageBytes.toString('utf8').includes(CANARY.passage), 'the marked private lineage carries the passage canary');
  const { files } = buildContributorship(inputs);
  assert.deepEqual([...files.keys()].sort(), [...Object.values(OUTPUT_FILES)].sort(), 'no builder output outside the three enumerated files');
  const privateText = files.get(OUTPUT_FILES.private);
  for (const marker of [CANARY.projectRef, CANARY.projectTitle, CANARY.person, CANARY.orcid, CANARY.curator]) assert.ok(privateText.includes(marker), `private companion must carry ${marker}`);
  const privateHits = findLeaks(new Map([[OUTPUT_FILES.private, privateText]])).map(([, marker]) => marker);
  for (const marker of [CANARY.projectRef, CANARY.projectTitle, CANARY.person, CANARY.orcid, CANARY.curator]) assert.ok(privateHits.includes(marker));
  // Builder inputs were not mutated by the build.
  assert.deepEqual(inputs.sources.map((s) => sha256(s.lineageBytes)), inputDigests);
  assert.equal(sha256(Buffer.from(JSON.stringify(inputs.declarations))), declarationsDigest);

  // The public pipeline runs again after private processing: its output is byte-identical (no contamination through shared state).
  const publicAfter = publicPipeline('after');
  assert.deepEqual([...publicAfter.keys()], [...publicBefore.keys()]);
  for (const [label, text] of publicBefore) assert.equal(publicAfter.get(label), text, `${label} changed after private credit processing`);

  // Scan the COMPLETE enumerated public output set: the public companion plus every importer, bridge and ORAtlas export file.
  const surfaces = new Map([[`credit:${OUTPUT_FILES.public}`, files.get(OUTPUT_FILES.public)], ...publicAfter]);
  for (const label of PUBLIC_SURFACES) assert.ok(surfaces.has(label), `missing enumerated surface ${label}`);
  // The ORAtlas export contributes exactly these files per exported packet: no file is skipped from the scan.
  const exportFiles = ['review-manifest.json', ...['claims.jsonl', 'citations.jsonl', 'relations.jsonl', 'source-native-trust.json', 'compatibility-report.json'].map((n) => `knowledge/oratlas/${n}`)];
  assert.deepEqual([...surfaces.keys()].filter((l) => l.startsWith('oratlas:')).sort(), PUBLIC_PAPERS.flatMap(({ slug }) => exportFiles.map((f) => `oratlas:${slug}/${f}`)).sort());
  assert.equal(surfaces.size, 1 + PUBLIC_SURFACES.length + 2 * exportFiles.length);
  assert.deepEqual(findLeaks(surfaces), []);
  // Only the private companion and release report may differ from the public set, and neither is in it.
  assert.ok(![...surfaces.keys()].some((label) => PRIVATE_ALLOWLIST.some((name) => label.endsWith(name))));

  assert.deepEqual(digestTree(FIXTURE), fixtureBefore, 'the committed fixture tree is unchanged');
});

test('a private-scope packet is refused by the importer and produces no public source artifact, canaries included', () => {
  const fields = { doi: '10.5555/crt17.gamma', title: CANARY.paperTitle, curator: CANARY.curator, quote: CANARY.passage };
  const refused = writeAndImport('gamma', 'packet:crt17-gamma-private', fields, 'private').result;
  assert.equal(refused.ok, false);
  assert.equal(refused.outputs, undefined);
  assert.ok(refused.validation.errors.some((e) => e.code === 'private-packet-not-exportable'));
  assert.deepEqual(findLeaks(new Map([['refused-import-result', JSON.stringify(refused)]])), []);
  // Control: the same records declared public ARE imported. The gate is the packet's access_scope, not content inspection,
  // which is why the builder-only `private` origin visibility is never fed to the exporter in this suite.
  const accepted = writeAndImport('gamma', 'packet:crt17-gamma-public', fields, 'public').result;
  assert.equal(accepted.ok, true);
  assert.ok(findLeaks(new Map(Object.entries(accepted.outputs))).length > 0, 'a public-scope import does carry the canaries');
});

test('mutation sensitivity: the scanner fails when a canary is inserted into any public artifact', () => {
  const { files } = buildContributorship(markedCreditInputs().inputs);
  const surfaces = new Map([[`credit:${OUTPUT_FILES.public}`, files.get(OUTPUT_FILES.public)], ...publicPipeline('mutation')]);
  assert.deepEqual(findLeaks(surfaces), []);
  const categories = new Set();
  for (const [label, text] of surfaces) {
    categories.add(label.split(/[:/]/u)[0]);
    for (const marker of MARKERS) {
      const mutated = new Map(surfaces).set(label, `${text}\n${marker}`);
      assert.deepEqual(findLeaks(mutated), [[label, marker]], `${label} <- ${marker}`);
    }
  }
  assert.deepEqual([...categories].sort(), ['credit', 'importer', 'links', 'oratlas']);
});

test('mutation sensitivity: a leaking projection in a disposable clone of the builder is caught by the scanner', () => {
  const clone = join(SCRATCH, 'builder-clone');
  for (const rel of ['scripts', 'plugins', 'docs/contracts/contributorship']) cpSync(join(ROOT, rel), join(clone, rel), { recursive: true });
  const target = join(clone, 'scripts/contributorship/build.mjs');
  const original = readFileSync(target, 'utf8');
  const FILTER = ['privateDoc.source_credit.filter((claim) => claim.disclosure.public).map((claim) => ({', 'privateDoc.source_credit.map((claim) => ({'];
  const UNPICK = ['source_assessments: f.source_assessments.map((s) => pick(s, A.source_assessment)),', 'source_assessments: f.source_assessments,'];
  const NO_SCHEMA = ['validateCompanions({ privateDoc, publicDoc, report });\n  return {', 'return {'];
  const patches = [
    { name: 'contributor disclosure filter removed', edits: [["privateDoc.contributors.filter((c) => c.disclosure.public).map((c) => [c.id, c])", 'privateDoc.contributors.map((c) => [c.id, c])']], expected: [CANARY.person] },
    // Removing only the claim filter is NOT enough to leak a canary: the field allowlist still holds (defence in depth).
    { name: 'claim filter removed alone', edits: [FILTER], expected: [] },
    // Widening the assessment projection as well exposes the curator ref; the closed public schema is the next layer.
    { name: 'claim filter and assessment allowlist removed, schema check kept', edits: [FILTER, UNPICK], throws: /additional property is not allowed/u },
    { name: 'claim filter and assessment allowlist removed, schema check disabled', edits: [FILTER, UNPICK, NO_SCHEMA], expected: [CANARY.curator] },
  ];
  const base = markedCreditInputs().inputs;
  const run = async (source, label) => {
    const file = join(clone, 'scripts/contributorship', `build-${label}.mjs`);
    writeFileSync(file, source);
    const mod = await import(pathToFileURL(file).href);
    return mod.buildContributorship({ ...base, sources: base.sources.map((s) => ({ ...s, lineageBytes: Buffer.from(s.lineageBytes) })), declarations: structuredClone(base.declarations) });
  };
  return (async () => {
    // The unmodified copy of the code stays clean, so every detection below comes from the mutation alone.
    const clean = await run(original, 'clean');
    assert.deepEqual(findLeaks(new Map([['public', clean.files.get(OUTPUT_FILES.public)]])), []);
    for (const [index, { name, edits, expected = [], throws }] of patches.entries()) {
      let source = original;
      for (const [from, to] of edits) {
        assert.equal(source.split(from).length - 1, 1, `patch anchor for "${name}" must match exactly once`);
        source = source.replace(from, to);
      }
      if (throws) {
        await assert.rejects(run(source, `m${index}`), throws, name);
        continue;
      }
      const result = await run(source, `m${index}`);
      const hits = findLeaks(new Map([['public', result.files.get(OUTPUT_FILES.public)]])).map(([, marker]) => marker);
      assert.deepEqual(hits.sort(), [...expected].sort(), name);
    }
  })();
});

// Keep the claim ids referenced so a fixture rename fails loudly here rather than silently skipping a source.
test('the private origin is bound to the claim that carries no public source credit', () => {
  const { files } = buildContributorship(markedCreditInputs().inputs);
  const publicDoc = JSON.parse(files.get(OUTPUT_FILES.public));
  assert.deepEqual(publicDoc.source_credit.map((c) => c.claim_id), [CLAIM_1]);
  assert.ok(JSON.parse(files.get(OUTPUT_FILES.private)).source_credit.some((c) => c.claim_id === CLAIM_2));
});
