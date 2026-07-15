import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

import humanReviewPlugin, {
  createHumanReviewTransform,
  findTextQuote,
  isAcceptedSubmission,
  loadSubmissionCollection,
  prepareAcceptedSubmissions,
  resolveSubmissionsPath,
} from '../plugins/human-review-plugin.mjs';

const require = createRequire(import.meta.url);
const { contentParagraphs } = require('../scripts/validate-trust.js');
const { validateContract } = require('../scripts/validate-community-contracts.js');
const TEST_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(TEST_DIR, '..');
const CONTENT_DIR = resolve(ROOT, 'content');
const COMMUNITY_ROOT = resolve(ROOT, 'community');

const SOURCE = 'The canonical review text makes a precise claim about evidence.';
const MANIFEST_DIGEST = '1'.repeat(64);
const CLAIM_ID = 'clm_7659634fb095cdce';

function fixtureRecords() {
  return JSON.parse(readFileSync(
    new URL('../community/examples/human_reviews.accepted.example.json', import.meta.url),
    'utf8',
  )).submissions;
}

test('directive exposes version, manifest, stable claim, and explicit submission ids', () => {
  const directive = humanReviewPlugin.directives[0];
  const [node] = directive.run({
    options: {
      'claim-id': CLAIM_ID,
      'review-version': '1.0.0',
      'release-manifest-sha256': MANIFEST_DIGEST,
      'submissions-path': '../community/examples/human_reviews.accepted.example.json',
      'submission-ids': 'hsub-ui-support-0001, hsub-ui-qualify-0002',
    },
  });
  assert.deepEqual(node, {
    type: 'human-reviews',
    claimId: CLAIM_ID,
    reviewVersion: '1.0.0',
    releaseManifestSha256: MANIFEST_DIGEST,
    submissionsPath: '../community/examples/human_reviews.accepted.example.json',
    submissionIds: ['hsub-ui-support-0001', 'hsub-ui-qualify-0002'],
  });
});

test('exact selectors normalize typography and require prefix/suffix to disambiguate', () => {
  assert.deepEqual(findTextQuote('Lead: “precise claim” follows.', '"precise claim"'), {
    start: 6,
    end: 21,
  });
  assert.equal(findTextQuote('same text and same text', 'same text'), null);
  assert.deepEqual(findTextQuote('same text and same text', 'same text', 'and '), {
    start: 14,
    end: 23,
  });
});

test('accepted state requires a real, non-backdated acceptance event and revision', () => {
  const accepted = fixtureRecords()[0];
  assert.equal(isAcceptedSubmission(accepted), true);

  const stateOnly = structuredClone(accepted);
  stateOnly.moderation.events = stateOnly.moderation.events.filter((event) => event.event !== 'accepted');
  assert.equal(isAcceptedSubmission(stateOnly), false);

  const backdated = structuredClone(accepted);
  backdated.moderation.events.find((event) => event.event === 'accepted').at = '2026-07-14T10:00:00Z';
  assert.equal(isAcceptedSubmission(backdated), false);

  const invalidRevision = structuredClone(accepted);
  invalidRevision.revision = 0;
  assert.equal(isAcceptedSubmission(invalidRevision), false);
});

test('loader uses the canonical public contract validator for accepted records', () => {
  const records = loadSubmissionCollection({
    submissionsPath: '../community/examples/human_reviews.accepted.example.json',
  }, CONTENT_DIR);
  const schema = JSON.parse(readFileSync(
    resolve(COMMUNITY_ROOT, 'schemas/human_submission.schema.json'),
    'utf8',
  ));
  assert.equal(records.length, 3);
  for (const record of records) assert.deepEqual(validateContract(record, schema), []);
});

test('plugin and canonical validator imports are side-effect-free outside repository cwd', () => {
  const pluginUrl = pathToFileURL(resolve(ROOT, 'plugins/human-review-plugin.mjs')).href;
  const probe = `import(${JSON.stringify(pluginUrl)}).then((module) => { if (!module.default) process.exitCode = 2; else process.stdout.write('loaded'); });`;
  const result = spawnSync(process.execPath, ['--input-type=module', '--eval', probe], {
    cwd: tmpdir(),
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, 'loaded');
  assert.equal(result.stderr, '');
});

test('submissions path rejects traversal, outside files, missing files, and non-JSON inputs', () => {
  assert.throws(
    () => resolveSubmissionsPath('../../README.md', CONTENT_DIR),
    /must resolve to a JSON file inside/iu,
  );
  assert.throws(
    () => resolveSubmissionsPath('../README.md', CONTENT_DIR),
    /must resolve to a JSON file inside/iu,
  );
  assert.throws(
    () => resolveSubmissionsPath('../community/examples/not-present.json', CONTENT_DIR),
    /cannot read submissions-path/iu,
  );
  assert.throws(
    () => resolveSubmissionsPath('../community/examples/human_reviews.accepted.example.txt', CONTENT_DIR),
    /must name a \.json file/iu,
  );
});

test('malformed accepted records fail the build with contract errors', () => {
  assert.throws(
    () => loadSubmissionCollection({
      submissionsPath: '../community/examples/human_reviews.malformed-accepted.fixture.json',
    }, CONTENT_DIR),
    /accepted submission hsub-malformed-accepted-0001[\s\S]*violates the public contract[\s\S]*missing required property target/iu,
  );
});

test('fresh production content does not publish example human acceptances', () => {
  const myst = readFileSync(resolve(ROOT, 'myst.yml'), 'utf8');
  assert.doesNotMatch(myst, /^\s*-\s+plugins\/human-review-plugin\.mjs\s*$/mu);
  for (const filename of readdirSync(CONTENT_DIR).filter((name) => name.endsWith('.md'))) {
    const markdown = readFileSync(resolve(CONTENT_DIR, filename), 'utf8');
    assert.doesNotMatch(markdown, /:::\{human-reviews\}/u, `${filename} must not invoke opt-in human reviews`);
    assert.doesNotMatch(markdown, /human_reviews\.accepted\.example\.json/u, `${filename} must not publish example acceptance data`);
  }
  assert.equal(typeof humanReviewPlugin.transforms[0].plugin, 'function');
});

test('TRUST prose paragraph indices ignore opt-in human-review directives', () => {
  const proseA = 'First canonical claim. {cite:p}`One`';
  const proseB = 'Second canonical claim. {cite:p}`Two`';
  const directive = `:::{human-reviews}\n:claim-id: ${CLAIM_ID}\n:review-version: 1.0.0\n:release-manifest-sha256: ${MANIFEST_DIGEST}\n:submissions-path: ../community/human_submissions.json\n:::`;
  assert.deepEqual(
    contentParagraphs(`${proseA}\n\n${directive}\n\n${proseB}`),
    contentParagraphs(`${proseA}\n\n${proseB}`),
  );
});

test('preparation admits only the exact version and release manifest', () => {
  const context = {
    claimId: CLAIM_ID,
    reviewVersion: '1.0.0',
    releaseManifestSha256: MANIFEST_DIGEST,
    submissionIds: ['hsub-ui-support-0001'],
    sourcePath: 'content/human-review-fixture.md',
    sourceDigest: 'ca5a0ab41e3d9adf044aaf76836445b701751b9c4defc86d48bf770d48083df3',
    paragraphText: SOURCE,
    scopeAnchor: 'human-review-scope',
    trustModel: { claimId: CLAIM_ID, targetAnchor: `trust-claim-target-${CLAIM_ID}` },
  };
  assert.equal(prepareAcceptedSubmissions(fixtureRecords(), context).length, 1);
  assert.equal(prepareAcceptedSubmissions(fixtureRecords(), { ...context, reviewVersion: '1.0.1' }).length, 0);
  assert.equal(prepareAcceptedSubmissions(fixtureRecords(), { ...context, releaseManifestSha256: '9'.repeat(64) }).length, 0);
});

test('transform pairs accepted records with the canonical TRUST target and marks stale text orphaned', () => {
  const targetAnchor = `trust-claim-target-${CLAIM_ID}`;
  const tree = {
    type: 'root',
    children: [
      {
        type: 'paragraph',
        children: [{
          type: 'span',
          identifier: targetAnchor,
          class: 'trust-claim-target',
          children: [{ type: 'text', value: SOURCE }],
        }],
      },
      {
        type: 'aside',
        class: 'trust-claim-aside',
        children: [{
          type: 'anywidget',
          model: {
            claimId: CLAIM_ID,
            targetAnchor,
            targetId: '',
            scopeAnchor: '',
            quote: SOURCE,
            prefix: '',
            suffix: '',
          },
        }],
      },
      {
        type: 'human-reviews',
        claimId: CLAIM_ID,
        reviewVersion: '1.0.0',
        releaseManifestSha256: MANIFEST_DIGEST,
        submissionsPath: '../community/examples/human_reviews.accepted.example.json',
        submissionIds: [
          'hsub-ui-support-0001',
          'hsub-ui-qualify-0002',
          'hsub-ui-orphaned-0003',
        ],
      },
    ],
  };

  createHumanReviewTransform()(tree, {
    path: 'content/human-review-fixture.md',
    value: SOURCE,
  });

  const scope = tree.children[0].children[0];
  assert.equal(scope.identifier, `human-review-scope-${CLAIM_ID.replace('_', '-')}`);
  assert.equal(scope.class, 'human-review-scope');

  const aside = tree.children[2];
  const widget = aside.children[0];
  const submissions = JSON.parse(widget.model.submissions);
  assert.equal(aside.class, 'human-review-aside');
  assert.equal(widget.model.claimId, CLAIM_ID);
  assert.equal(widget.model.reviewVersion, '1.0.0');
  assert.equal(widget.model.releaseManifestSha256, MANIFEST_DIGEST);
  assert.match(widget.model.instanceId, /^human-reviews-clm-7659634fb095cdce-/u);
  assert.equal(Object.hasOwn(widget.model, 'trustScore'), false);
  assert.match(widget.model.layerNotice, /never modify the computational TRUST score/iu);
  assert.equal(submissions.length, 3);

  const claimReview = submissions.find((item) => item.submissionId === 'hsub-ui-support-0001');
  assert.equal(claimReview.selector.kind, 'claim');
  assert.equal(claimReview.releaseManifestSha256, MANIFEST_DIGEST);
  assert.equal(claimReview.payloadSha256, '2'.repeat(64));
  assert.equal(claimReview.selector.targetAnchor, targetAnchor);
  assert.equal(claimReview.selector.anchorStatus, 'current');

  const textReview = submissions.find((item) => item.submissionId === 'hsub-ui-qualify-0002');
  assert.equal(textReview.selector.scopeAnchor, scope.identifier);
  assert.equal(textReview.selector.exact, 'precise claim');
  assert.equal(textReview.selector.prefix, 'makes a');
  assert.equal(textReview.selector.suffix, 'about evidence');
  assert.equal(textReview.selector.anchorStatus, 'current');

  const orphaned = submissions.find((item) => item.submissionId === 'hsub-ui-orphaned-0003');
  assert.equal(orphaned.selector.anchorStatus, 'orphaned');
  assert.match(orphaned.selector.orphanReason, /missing or ambiguous/iu);
});

test('source digest drift visibly orphans exact-text records', () => {
  const selected = prepareAcceptedSubmissions(fixtureRecords(), {
    claimId: CLAIM_ID,
    reviewVersion: '1.0.0',
    releaseManifestSha256: MANIFEST_DIGEST,
    submissionIds: ['hsub-ui-qualify-0002'],
    sourcePath: 'content/human-review-fixture.md',
    sourceDigest: '0'.repeat(64),
    paragraphText: SOURCE,
    scopeAnchor: 'human-review-scope',
    trustModel: null,
  });
  assert.equal(selected[0].selector.anchorStatus, 'orphaned');
  assert.match(selected[0].selector.orphanReason, /source file changed/iu);
});
