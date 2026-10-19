import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { parseMiniYaml } from '../plugins/authorship-plugin.mjs';

// The upstream template moved to a remote AuthorshipExtractor release and added named
// human authors. This fork deliberately keeps its local plugin, widgets and authors.yml:
// the CRediT companion imports the plugin's parser, and its golden outputs are bound to
// these exact bytes. See docs/upstream-sync-validation.md, "Authorship integration boundary".

const ROOT = process.cwd();
const read = (path) => readFileSync(join(ROOT, path));
const digest = (path) => createHash('sha256').update(read(path)).digest('hex');

// Digests of the fork's files at a19a8dc, before the 8cc8383 template sync.
const PINNED = {
  'plugins/authorship-plugin.mjs': 'd65049bc2952d32b342869d9dde172448ea85e728d4ddcd86e0fbc7da0567595',
  'content/authorship-widget.mjs': 'af29790df4534c394b29990c278be5571d9a14421b20475607f680ae707a4615',
  'content/authorship-widget.css': '1512f24099277550f30b5030892cd20aca423c6e19b15783103cd1acbdd4d89b',
  'content/authors.yml': '8e8d339c64c529189c5ecd96da752248be7ec8ed91f44f45ddee547fb4d97b8d',
};

test('myst.yml loads the local authorship plugin, not a remote release', () => {
  const myst = read('myst.yml').toString('utf8');
  assert.match(myst, /^\s+- plugins\/authorship-plugin\.mjs$/mu);
  assert.doesNotMatch(myst, /AuthorshipExtractor|releases\/latest\/download/u);
  assert.match(myst, /^extends:\n\s+- content\/authors\.yml$/mu);
});

test('the local authorship plugin, widgets and authors.yml are byte-identical to the pre-sync fork', () => {
  for (const [path, expected] of Object.entries(PINNED)) assert.equal(digest(path), expected, path);
});

test('the credit builder still consumes the local parser, and authors.yml names no human', () => {
  assert.match(read('scripts/contributorship/build.mjs').toString('utf8'),
    /import \{ parseMiniYaml \} from '\.\.\/\.\.\/plugins\/authorship-plugin\.mjs';/u);
  const parsed = parseMiniYaml(read('content/authors.yml').toString('utf8'));
  const contributors = parsed.project.contributors;
  assert.deepEqual(contributors.map((c) => [c.id, c.is_ai_tool]), [['ai-pipeline', true]]);
  assert.ok(contributors.every((c) => !c.email), 'no contributor e-mail is published');
});
