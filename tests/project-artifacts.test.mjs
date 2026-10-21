import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { buildManifest, serializeManifest } from '../scripts/project-artifacts/build.mjs';

const root = fileURLToPath(new URL('fixtures/project-artifacts/', import.meta.url));
const input = () => JSON.parse(fs.readFileSync(path.join(root, 'declaration.json')));
const mutation = (change) => { const data = input(); change(data); return data; };

test('private synthetic draft, reviewed graph and released version match exact deterministic golden bytes', () => {
  const data = input();
  const before = JSON.stringify(data);
  const first = serializeManifest(buildManifest(data, root));
  assert.equal(first, fs.readFileSync(path.join(root, 'expected.private.json'), 'utf8'));
  assert.equal(first, serializeManifest(buildManifest({ ...data, artifacts: [...data.artifacts].reverse() }, root)));
  assert.equal(JSON.stringify(data), before);
  assert.equal(JSON.parse(first).access_effect, 'none');
  assert.equal(JSON.parse(first).scope, 'private-descriptor');
});

test('hash swaps, missing bytes, duplicate ids/paths and withdrawn permission fail closed', () => {
  for (const change of [
    (d) => { d.artifacts[0].sha256 = d.artifacts[1].sha256; },
    (d) => { d.artifacts[0].bytes += 1; },
    (d) => { d.artifacts.push(d.artifacts[0]); },
    (d) => { d.artifacts[1].path = d.artifacts[0].path; },
    (d) => { d.artifacts[0].clearance = 'withdrawn'; },
    (d) => { d.artifacts[0].path = 'missing.txt'; },
  ]) assert.throws(() => buildManifest(mutation(change), root));
});

test('unpublished drafts, restricted corpus and unknown rights cannot be declared public', () => {
  for (const change of [
    (d) => { d.artifacts[0].visibility = 'public'; },
    (d) => { d.artifacts[2].rights.redistribution = 'prohibited'; },
    (d) => { d.artifacts[2].rights.redistribution = 'unknown'; },
    (d) => { d.artifacts[2].state = 'reviewed'; },
  ]) assert.throws(() => buildManifest(mutation(change), root));
});

test('credentials, inferred membership, ORCID people, AI authors and unsupported schema fields are refused', () => {
  for (const change of [
    (d) => { d.source.repository = 'https://token@github.com/owner/repo?token=secret'; },
    (d) => { d.source.token = 'secret'; },
    (d) => { d.source.commit += '\n'; },
    (d) => { d.source.repository += '\n'; },
    (d) => { d.members = ['orcid:claimed']; },
    (d) => { d.artifacts[0].author = { type: 'agent', orcid: 'claimed' }; },
    (d) => { d.scope = 'public'; },
    (d) => { delete d.protocol; },
    (d) => { d.protocol = 'research-project-artifacts/999'; },
    (d) => { d.protocol = 'research-project-artifacts/0.1\n'; },
    (d) => { d.access_effect = 'authorized'; },
  ]) assert.throws(() => buildManifest(mutation(change), root));
  const agent = mutation((d) => { d.artifacts[0].generator = { name: 'Synthetic agent', version: '1', role: 'drafting', run_id: 'run-1' }; });
  assert.equal(buildManifest(agent, root).artifacts[0].generator.name, 'Synthetic agent');
});

test('traversal, URLs, hidden credential paths and symlink escape are refused', () => {
  for (const value of ['../outside', '/tmp/outside', 'C:/outside', 'files\\draft.txt', '.env', 'files/../draft.txt', 'https://example.com/doc', 'files//draft.txt'])
    assert.throws(() => buildManifest(mutation((d) => { d.artifacts[0].path = value; }), root));
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'project-artifacts-'));
  try {
    const newlineName = 'draft.txt\n';
    fs.copyFileSync(path.join(root, 'files/draft.txt'), path.join(scratch, newlineName));
    const newlineInput = input();
    newlineInput.artifacts = [{ ...newlineInput.artifacts[0], path: newlineName }];
    assert.ok(fs.existsSync(path.join(scratch, newlineName)), 'the trailing-newline file really exists');
    assert.throws(() => buildManifest(newlineInput, scratch), /unsafe artifact path/);
    fs.symlinkSync(path.join(root, 'files'), path.join(scratch, 'files'));
    assert.throws(() => buildManifest(input(), scratch), /escapes root/);
  } finally { fs.rmSync(scratch, { recursive: true, force: true }); }
});

test('CLI writes only descriptor, never overwrites existing output and gives metadata-free failures', () => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'project-artifacts-cli-'));
  const cli = fileURLToPath(new URL('../scripts/project-artifacts/build.mjs', import.meta.url));
  const output = path.join(scratch, 'private.json');
  const run = () => spawnSync(process.execPath, [cli, path.join(root, 'declaration.json'), root, output], { encoding: 'utf8' });
  try {
    const first = run(); assert.equal(first.status, 0); assert.equal(first.stdout, '');
    assert.deepEqual(fs.readdirSync(scratch), ['private.json']);
    assert.equal(fs.readFileSync(output, 'utf8'), serializeManifest(buildManifest(input(), root)));
    const second = run(); assert.equal(second.status, 1); assert.equal(second.stdout, '');
    assert.doesNotMatch(second.stderr, /synthetic-project|draft|sha256|Synthetic/);
  } finally { fs.rmSync(scratch, { recursive: true, force: true }); }
});
