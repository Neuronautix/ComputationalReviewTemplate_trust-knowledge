import fs from 'node:fs';
import path from 'node:path';
import { canonicalLine, prettyJson, sha256 } from '../../scripts/source-evidence/canonical.mjs';

export const ARTIFACTS = [
  ['papers', 'papers.jsonl'],
  ['findings', 'findings.jsonl'],
  ['passages', 'passages.jsonl'],
  ['assessments', 'assessments.jsonl'],
];

export const jsonl = (records) => records.map((r) => `${canonicalLine(r)}\n`).join('');

/** Write a canonical packet directory with a manifest whose hashes, lengths and counts match the files. */
export function writePacket(dir, { records, manifest = {} }) {
  fs.mkdirSync(dir, { recursive: true });
  const artifacts = {};
  for (const [kind, file] of ARTIFACTS) {
    const text = jsonl(records[kind]);
    fs.writeFileSync(path.join(dir, file), text);
    artifacts[kind] = { bytes: Buffer.byteLength(text), path: file, record_count: records[kind].length, sha256: sha256(Buffer.from(text, 'utf8')) };
  }
  const full = {
    access_scope: { level: 'public', redistributable_full_text: false },
    artifacts,
    created_at: '2026-01-01T00:00:00Z',
    creation_method: 'synthetic-fixture',
    export_status: { reasons: [], state: 'complete', withheld_counts: { assessments: 0, findings: 0, papers: 0, passages: 0 } },
    licenses: [{ applies_to: 'packet-metadata', license_id: 'CC0-1.0' }, { applies_to: 'quotes', license_id: 'unknown' }],
    packet_id: 'packet:synth-g2-pilot',
    producer: {
      commit: 'synthetic-fixture',
      name: 'comprev-test-fixture-builder',
      schema_refs: [{ name: 'evidence-envelope-v1', version: '1' }, { name: 'seip-support-v1', version: '1' }, { name: 'evidence-links-v1', version: '1' }],
    },
    schema_version: 'source-evidence-packet/0.1.0',
    ...manifest,
  };
  fs.writeFileSync(path.join(dir, 'manifest.json'), prettyJson(full));
  return full;
}

export function readPacketRecords(dir) {
  return Object.fromEntries(ARTIFACTS.map(([kind, file]) => [
    kind,
    fs.readFileSync(path.join(dir, file), 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line)),
  ]));
}

/** Copy a packet, apply `mutate(records, manifest)`, and write it back with recomputed hashes. */
export function mutatedCopy(sourceDir, targetDir, mutate) {
  const records = readPacketRecords(sourceDir);
  const manifest = JSON.parse(fs.readFileSync(path.join(sourceDir, 'manifest.json'), 'utf8'));
  const { artifacts, ...rest } = manifest;
  mutate(records, rest);
  return writePacket(targetDir, { records, manifest: rest });
}
