import assert from 'node:assert/strict';
import test from 'node:test';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

// Builds this TRUST fork's own site in an isolated copy of the tracked tree (never the
// working directory, so generated _build/ output cannot leak in or out) and inspects the
// rendered pages: TRUST claim, authorship and evidence widgets must be emitted with their
// resolved payloads, and the opt-in human-review layer must stay off.

const repositoryRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const BASE_URL = '/ComputationalReviewTemplate_trust-knowledge';

function trackedFiles() {
  const listed = spawnSync('git', ['ls-files', '-co', '--exclude-standard', '-z'], { cwd: repositoryRoot, encoding: 'utf8' });
  assert.equal(listed.status, 0, `git ls-files failed: ${listed.stderr}`);
  return listed.stdout.split('\0').filter(Boolean).filter(file => existsSync(join(repositoryRoot, file)));
}

function mystCommand() {
  if (process.env.MYST_COMMAND) return [process.env.MYST_COMMAND, ['build', '--html']];
  return process.platform === 'win32' ? ['cmd.exe', ['/d', '/s', '/c', 'myst', 'build', '--html']] : ['myst', ['build', '--html']];
}

function anywidgets(path) {
  const document = JSON.parse(readFileSync(path, 'utf8'));
  const nodes = [];
  const walk = value => {
    if (!value || typeof value !== 'object') return;
    if (value.type === 'anywidget') nodes.push(value);
    for (const child of Object.values(value)) walk(child);
  };
  walk(document.mdast);
  return nodes;
}

test('the TRUST site renders its claim, authorship and evidence widgets from a clean copy', { timeout: 240000 }, () => {
  const buildRoot = mkdtempSync(join(tmpdir(), 'trust-site-'));
  try {
    for (const file of trackedFiles()) {
      mkdirSync(dirname(join(buildRoot, file)), { recursive: true });
      cpSync(join(repositoryRoot, file), join(buildRoot, file));
    }
    assert.equal(existsSync(join(buildRoot, '_build')), false, 'the copy must start without generated output');

    const [command, args] = mystCommand();
    const result = spawnSync(command, args, {
      cwd: buildRoot, encoding: 'utf8', timeout: 220000, env: { ...process.env, BASE_URL },
    });
    const log = `${result.stdout}\n${result.stderr}`;
    assert.equal(result.error, undefined, `Unable to run ${command}. Install mystmd@1.10.1.\n${result.error ?? ''}`);
    assert.equal(result.status, 0, log);
    assert.doesNotMatch(log, /(?:⛔|Could not link citation|Cannot find (?:asset|image))/u, log);

    const html = join(buildRoot, '_build', 'html');
    for (const page of ['index', 'introduction', 'methods', 'evidence-database', 'provenance']) {
      assert.ok(existsSync(join(html, `${page}.json`)), `${page}.json was not rendered`);
    }
    assert.match(readFileSync(join(html, 'index.html'), 'utf8'), new RegExp(`${BASE_URL}/build/`, 'u'));

    const emitted = widget => {
      assert.ok(widget.esm.startsWith(`${BASE_URL}/build/`), widget.esm);
      assert.ok(existsSync(join(html, widget.esm.slice(BASE_URL.length + 1))), `missing asset ${widget.esm}`);
    };

    // Authorship: the local plugin resolves content/authors.yml into the widget model.
    const [authorship] = anywidgets(join(html, 'index.json')).filter(w => /authorship-widget/u.test(w.esm));
    assert.ok(authorship, 'authorship widget not rendered');
    emitted(authorship);
    const authors = JSON.parse(authorship.model.authors);
    assert.ok(authors.primary.some(author => author.id === 'ai-pipeline'), 'authors.yml contributors were not resolved');

    // TRUST claims: every rendered claim resolves to the claim graph with its validator-assigned score.
    const graph = JSON.parse(readFileSync(join(repositoryRoot, 'knowledge', 'claim_graph.json'), 'utf8'));
    const claims = new Map(graph.claims.map(claim => [claim.claim_id, claim]));
    const trust = anywidgets(join(html, 'introduction.json')).filter(w => /trust-claim-widget/u.test(w.esm));
    const source = readFileSync(join(repositoryRoot, 'content', '01_introduction.md'), 'utf8');
    const expectedIds = [...source.matchAll(/^:{3,}\{trust-claim\}[^\n]*\n((?:(?!:{3,}\s*$)[^\n]*\n)*)/gmu)]
      .map(([, body]) => /^:claim-id:\s*(\S+)\s*$/mu.exec(body)?.[1]);
    assert.ok(expectedIds.length > 0 && expectedIds.every(Boolean), 'every source trust-claim directive must declare :claim-id:');
    // The complete rendered multiset must equal the source: catches missing, duplicate and unexpected widgets.
    assert.deepEqual(trust.map(w => w.model.claimId).sort(), [...expectedIds].sort(), 'rendered trust-claim widgets differ from source directives');
    for (const widget of trust) {
      emitted(widget);
      const claim = claims.get(widget.model.claimId);
      assert.ok(claim, `rendered claim ${widget.model.claimId} is not in knowledge/claim_graph.json`);
      assert.equal(Number(widget.model.trustScore), claim.trust_score.overall_score, widget.model.claimId);
      assert.equal(widget.model.trustLabel, claim.trust_score.trust_label, widget.model.claimId);
    }

    // Evidence: the un-instantiated template declares not_provided and renders that state truthfully.
    const [explorer] = anywidgets(join(html, 'evidence-database.json')).filter(w => /evidence-explorer/u.test(w.esm));
    assert.ok(explorer, 'evidence explorer not rendered');
    emitted(explorer);
    const evidence = JSON.parse(explorer.model.evidence_data);
    assert.equal(evidence.evidence_status, 'not_provided');
    assert.deepEqual([evidence.sections.length, evidence.findings.length], [0, 0]);

    // Human review stays opt-in: no widget, and no example acceptance reaches the site.
    const pages = ['index', 'introduction', 'methods', 'evidence-database', 'provenance']
      .map(page => readFileSync(join(html, `${page}.json`), 'utf8')).join('\n');
    assert.doesNotMatch(pages, /human-review-widget|community\/examples/u);
  } finally {
    rmSync(buildRoot, { recursive: true, force: true });
  }
});
