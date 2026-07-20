import test from 'node:test';
import assert from 'node:assert/strict';

import {
  activateHumanAnchor,
  bindAnchorLifecycle,
  findTextQuote,
  renderSubmissionCard,
  stancePresentation,
} from '../content/human-review-widget.mjs';

class FakeEventTarget {
  constructor() {
    this.listeners = new Map();
  }

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) || new Set();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type, listener) {
    this.listeners.get(type)?.delete(listener);
  }

  emit(type) {
    for (const listener of this.listeners.get(type) || []) listener();
  }
}

function exampleSubmission(overrides = {}) {
  return {
    submissionId: 'hsub-widget-0001',
    revision: 2,
    reviewer: {
      displayName: 'A. Reviewer',
      visibility: 'public',
      orcid: 'https://orcid.org/0000-0002-1825-0097',
    },
    reviewVersion: '1.2.0',
    releaseManifestSha256: '1'.repeat(64),
    payloadSha256: '2'.repeat(64),
    editorialStatus: 'accepted',
    content: {
      kind: 'peer_review',
      title: 'Scope is appropriately qualified',
      body: 'The <claim> is appropriately qualified & supported.',
      stance: 'qualifies',
      recommendation: 'minor_revision',
      confidence: 4,
    },
    selector: {
      kind: 'claim',
      targetAnchor: 'trust-claim-target-clm-example',
      targetId: '',
      scopeAnchor: '',
      exact: '',
      prefix: '',
      suffix: '',
      anchorStatus: 'current',
      orphanReason: '',
    },
    ...overrides,
  };
}

test('all human stances have explicit non-numeric labels', () => {
  assert.deepEqual(stancePresentation('supports'), {
    label: 'Supports', className: 'hr-stance-supports',
  });
  assert.equal(stancePresentation('disputes').label, 'Disputes');
  assert.equal(stancePresentation('qualifies').label, 'Qualifies');
  assert.equal(stancePresentation('no_position').label, 'No position');
});

test('runtime exact matcher preserves raw offsets and fails closed on ambiguity', () => {
  const source = 'Lead: “precise claim”\nabout evidence.';
  const range = findTextQuote(source, '"precise claim" about evidence');
  assert.equal(source.slice(range.start, range.end), '“precise claim”\nabout evidence');
  assert.equal(findTextQuote('same then same', 'same'), null);
  assert.deepEqual(findTextQuote('same then same', 'same', 'then '), { start: 10, end: 14 });
});

test('card is keyboard-native, exposes version/status, escapes comments, and separates TRUST', () => {
  const html = renderSubmissionCard(exampleSubmission(), 0, 'hr-test');
  assert.match(html, /<details class="hr-card"/u);
  assert.match(html, /<summary class="hr-summary" aria-describedby="hr-test-anchor-status-0">/u);
  assert.match(html, /role="status" aria-live="polite"/u);
  assert.match(html, /Human review/u);
  assert.match(html, /Qualifies/u);
  assert.match(html, /1\.2\.0/u);
  assert.match(html, new RegExp('1{64}', 'u'));
  assert.match(html, new RegExp('2{64}', 'u'));
  assert.match(html, /accepted/u);
  assert.match(html, /A\. Reviewer/u);
  assert.match(html, /&lt;claim&gt; is appropriately qualified &amp; supported/u);
  assert.match(html, /does not change the computational TRUST score/u);
  assert.doesNotMatch(html, /TRUST score:\s*\d/iu);
});

test('orphan state and reason are always visible in card semantics', () => {
  const submission = exampleSubmission({
    selector: {
      kind: 'text',
      anchorStatus: 'orphaned',
      orphanReason: 'The source file changed after acceptance.',
    },
  });
  const html = renderSubmissionCard(submission);
  assert.match(html, /data-anchor-status="orphaned"/u);
  assert.match(html, /Anchor unavailable in this version/u);
  assert.match(html, /Orphaned annotation:/u);
  assert.match(html, /source file changed after acceptance/u);
});

test('claim annotations reuse stable TRUST DOM ids without reading or changing the score', () => {
  const classes = new Set();
  const target = {
    classList: {
      add: (name) => classes.add(name),
      remove: (name) => classes.delete(name),
    },
  };
  const doc = {
    getElementById: (id) => (id === 'trust-claim-target-clm-example' ? target : null),
  };
  const el = { ownerDocument: doc };
  const result = activateHumanAnchor(el, exampleSubmission().selector, 'hsub-widget-0001');
  assert.equal(result.highlighted, true);
  assert.equal(classes.has('hr-is-highlighted'), true);
  assert.equal(classes.has('tc-is-highlighted'), false);
  result.cleanup();
  result.cleanup();
  assert.equal(classes.size, 0);
});

test('keyboard focus highlights the exact target and cleanup removes listeners', () => {
  const classes = new Set();
  const target = {
    classList: {
      add: (name) => classes.add(name),
      remove: (name) => classes.delete(name),
    },
  };
  const doc = {
    getElementById: (id) => (id === 'trust-claim-target-clm-example' ? target : null),
  };
  const el = { ownerDocument: doc };
  const trigger = new FakeEventTarget();
  const status = { textContent: '' };
  const badgeClasses = new Set();
  const orphanBadge = {
    textContent: '',
    dataset: {},
    classList: {
      add: (name) => badgeClasses.add(name),
      remove: (name) => badgeClasses.delete(name),
    },
  };
  const cleanup = bindAnchorLifecycle(trigger, el, exampleSubmission(), status, orphanBadge);

  trigger.emit('focus');
  assert.equal(classes.has('hr-is-highlighted'), true);
  assert.match(status.textContent, /exact text targeted/iu);
  trigger.emit('mouseenter');
  trigger.emit('mouseleave');
  assert.equal(classes.has('hr-is-highlighted'), true);
  trigger.emit('blur');
  assert.equal(classes.has('hr-is-highlighted'), false);

  cleanup();
  trigger.emit('focus');
  assert.equal(classes.has('hr-is-highlighted'), false);
});

test('orphaned focus never widens to unrelated text and announces the failure', () => {
  const el = { ownerDocument: { getElementById: () => null } };
  const trigger = new FakeEventTarget();
  const status = { textContent: '' };
  const badgeClasses = new Set(['hr-anchor-current']);
  const orphanBadge = {
    textContent: 'Exact anchor available',
    dataset: { anchorStatus: 'current' },
    classList: {
      add: (name) => badgeClasses.add(name),
      remove: (name) => badgeClasses.delete(name),
    },
  };
  const submission = exampleSubmission({
    selector: {
      kind: 'text',
      exact: 'missing text',
      anchorStatus: 'orphaned',
    },
  });
  bindAnchorLifecycle(trigger, el, submission, status, orphanBadge);
  trigger.emit('focus');
  assert.match(status.textContent, /unavailable in this version/iu);
  assert.equal(orphanBadge.dataset.anchorStatus, 'orphaned');
  assert.equal(badgeClasses.has('hr-anchor-current'), false);
  assert.equal(badgeClasses.has('hr-anchor-orphaned'), true);
});
