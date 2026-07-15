function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function safeJsonParse(value, fallback) {
  if (value == null) return fallback;
  if (typeof value === 'object') return value;
  if (typeof value !== 'string') return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function normalizeCharacter(character) {
  if (/\s/u.test(character)) return ' ';
  if (/[\u2018\u2019\u201A\u201B]/u.test(character)) return "'";
  if (/[\u201C\u201D\u201E\u201F]/u.test(character)) return '"';
  if (/[\u2010-\u2015\u2212]/u.test(character)) return '-';
  if (character === '\u00AD') return '';
  return character.normalize('NFKC');
}

function normalizeTextWithMap(value) {
  const source = String(value || '');
  let text = '';
  const starts = [];
  const ends = [];
  for (let rawStart = 0; rawStart < source.length;) {
    const codePoint = source.codePointAt(rawStart);
    const character = String.fromCodePoint(codePoint);
    const rawEnd = rawStart + character.length;
    const normalized = normalizeCharacter(character);
    for (const outputCharacter of normalized) {
      if (outputCharacter === ' ' && text.endsWith(' ')) {
        ends[ends.length - 1] = rawEnd;
        continue;
      }
      text += outputCharacter;
      starts.push(rawStart);
      ends.push(rawEnd);
    }
    rawStart = rawEnd;
  }
  return { text, starts, ends };
}

function normalizedSelector(value) {
  return normalizeTextWithMap(value).text.trim();
}

/** Resolve exactly one W3C TextQuoteSelector and retain source offsets. */
export function findTextQuote(text, exact, prefix = '', suffix = '') {
  const haystack = normalizeTextWithMap(text);
  const quote = normalizedSelector(exact);
  const before = normalizedSelector(prefix);
  const after = normalizedSelector(suffix);
  if (!quote) return null;

  const matches = [];
  let from = 0;
  while (from <= haystack.text.length - quote.length) {
    const index = haystack.text.indexOf(quote, from);
    if (index === -1) break;
    const prefixMatches = !before || haystack.text.slice(0, index).trimEnd().endsWith(before);
    const suffixMatches = !after || haystack.text.slice(index + quote.length).trimStart().startsWith(after);
    if (prefixMatches && suffixMatches) matches.push(index);
    from = index + 1;
  }
  if (matches.length !== 1) return null;
  const start = matches[0];
  return {
    start: haystack.starts[start],
    end: haystack.ends[start + quote.length - 1],
  };
}

const activeHighlights = new WeakMap();

function collectTextNodes(element) {
  const doc = element.ownerDocument;
  const showText = doc.defaultView?.NodeFilter?.SHOW_TEXT ?? 4;
  const walker = doc.createTreeWalker(element, showText);
  const nodes = [];
  let node = walker.nextNode();
  while (node) {
    const parentName = node.parentElement?.tagName?.toLowerCase();
    if (parentName !== 'script' && parentName !== 'style') nodes.push(node);
    node = walker.nextNode();
  }
  return nodes;
}

function markTextRange(element, range, submissionId) {
  const doc = element.ownerDocument;
  const segments = [];
  let offset = 0;
  for (const node of collectTextNodes(element)) {
    const nodeStart = offset;
    const nodeEnd = nodeStart + node.data.length;
    const start = Math.max(range.start, nodeStart);
    const end = Math.min(range.end, nodeEnd);
    if (start < end) segments.push({ node, start: start - nodeStart, end: end - nodeStart });
    offset = nodeEnd;
  }
  if (segments.length === 0) return null;

  const marks = [];
  for (const segment of segments.reverse()) {
    const tail = segment.node.splitText(segment.end);
    const selected = segment.node.splitText(segment.start);
    const mark = doc.createElement('mark');
    mark.className = 'hr-runtime-highlight';
    mark.dataset.humanSubmissionId = submissionId;
    selected.parentNode.replaceChild(mark, selected);
    mark.appendChild(selected);
    marks.push(mark);
    void tail;
  }
  return () => {
    for (const mark of marks) {
      if (!mark.parentNode) continue;
      const parent = mark.parentNode;
      while (mark.firstChild) parent.insertBefore(mark.firstChild, mark);
      parent.removeChild(mark);
      parent.normalize();
    }
  };
}

/** Activate a claim anchor or an exact text selector; never widen on failure. */
export function activateHumanAnchor(el, selector = {}, submissionId = 'human-review') {
  const doc = el.ownerDocument;
  activeHighlights.get(doc)?.();

  if (selector.anchorStatus === 'orphaned') {
    return { highlighted: false, cleanup() {} };
  }

  const targetAnchor = selector.targetAnchor ? doc.getElementById(selector.targetAnchor) : null;
  const explicitTarget = selector.targetId ? doc.getElementById(selector.targetId) : null;
  const scope = selector.scopeAnchor ? doc.getElementById(selector.scopeAnchor) : null;
  let cleanup = null;

  if (targetAnchor && selector.kind === 'claim') {
    targetAnchor.classList.add('hr-is-highlighted');
    cleanup = () => targetAnchor.classList.remove('hr-is-highlighted');
  } else if (explicitTarget && selector.kind === 'claim' && !selector.exact) {
    explicitTarget.classList.add('hr-is-highlighted');
    cleanup = () => explicitTarget.classList.remove('hr-is-highlighted');
  } else {
    const quoteScope = explicitTarget || scope || targetAnchor;
    if (quoteScope && selector.exact) {
      const range = findTextQuote(
        quoteScope.textContent || '',
        selector.exact,
        selector.prefix,
        selector.suffix,
      );
      if (range) cleanup = markTextRange(quoteScope, range, submissionId);
    }
  }

  if (!cleanup) return { highlighted: false, cleanup() {} };
  let active = true;
  const coordinatedCleanup = () => {
    if (!active) return;
    active = false;
    cleanup();
    if (activeHighlights.get(doc) === coordinatedCleanup) activeHighlights.delete(doc);
  };
  activeHighlights.set(doc, coordinatedCleanup);
  return { highlighted: true, cleanup: coordinatedCleanup };
}

const STANCES = {
  supports: { label: 'Supports', className: 'hr-stance-supports' },
  disputes: { label: 'Disputes', className: 'hr-stance-disputes' },
  qualifies: { label: 'Qualifies', className: 'hr-stance-qualifies' },
  no_position: { label: 'No position', className: 'hr-stance-neutral' },
};

export function stancePresentation(stance) {
  return STANCES[stance] || STANCES.no_position;
}

function recommendationLabel(value) {
  return ({
    accept: 'Accept current version',
    minor_revision: 'Minor revision',
    major_revision: 'Major revision',
    decline: 'Do not publish in current form',
    not_applicable: 'Not applicable',
  })[value] || 'Not applicable';
}

function orcidLink(reviewer) {
  const orcid = String(reviewer?.orcid || '');
  if (!/^https:\/\/orcid\.org\/[0-9]{4}-[0-9]{4}-[0-9]{4}-[0-9X]{4}$/u.test(orcid)) return '';
  return ` <a href="${escapeHtml(orcid)}" target="_blank" rel="noopener noreferrer">ORCID</a>`;
}

/** Pure HTML renderer used by the widget and the dependency-free tests. */
export function renderSubmissionCard(submission, index = 0, idPrefix = 'hr') {
  const reviewer = submission.reviewer || {};
  const content = submission.content || {};
  const selector = submission.selector || {};
  const stance = stancePresentation(content.stance);
  const isOrphaned = selector.anchorStatus === 'orphaned';
  const statusId = `${idPrefix}-anchor-status-${index}`;
  const confidence = content.confidence == null ? '' : ` (${escapeHtml(content.confidence)}/5 confidence)`;
  const orphanHtml = isOrphaned
    ? `<span class="hr-anchor-status hr-anchor-orphaned" data-anchor-status="orphaned">Anchor unavailable in this version</span>`
    : `<span class="hr-anchor-status hr-anchor-current" data-anchor-status="current">Exact anchor available</span>`;

  return `
    <details class="hr-card" data-submission-id="${escapeHtml(submission.submissionId)}">
      <summary class="hr-summary" aria-describedby="${statusId}">
        <span class="hr-kind">Human review</span>
        <span class="hr-stance ${stance.className}">${stance.label}</span>
        <span class="hr-reviewer">${escapeHtml(reviewer.displayName || 'Anonymous reviewer')}</span>
        ${orphanHtml}
      </summary>
      <div class="hr-body">
        <h4>${escapeHtml(content.title || 'Human review comment')}</h4>
        <p class="hr-comment">${escapeHtml(content.body || '')}</p>
        <dl class="hr-metadata">
          <div><dt>Review version</dt><dd>${escapeHtml(submission.reviewVersion || 'unspecified')}</dd></div>
          <div><dt>Release manifest</dt><dd><code>${escapeHtml(submission.releaseManifestSha256 || 'unspecified')}</code></dd></div>
          <div><dt>Editorial status</dt><dd>${escapeHtml(submission.editorialStatus || 'unknown')}</dd></div>
          <div><dt>Stance</dt><dd>${stance.label}</dd></div>
          <div><dt>Recommendation</dt><dd>${escapeHtml(recommendationLabel(content.recommendation))}${confidence}</dd></div>
          <div><dt>Reviewer</dt><dd>${escapeHtml(reviewer.displayName || 'Anonymous reviewer')}${orcidLink(reviewer)}</dd></div>
          <div><dt>Submission</dt><dd>${escapeHtml(submission.submissionId || 'unknown')} · revision ${escapeHtml(submission.revision || 1)} · payload <code>${escapeHtml(submission.payloadSha256 || 'unspecified')}</code></dd></div>
        </dl>
        ${isOrphaned ? `<p class="hr-orphan-reason"><strong>Orphaned annotation:</strong> ${escapeHtml(selector.orphanReason || 'The exact target could not be located.')}</p>` : ''}
        <p class="hr-separation">This human assessment is displayed separately and does not change the computational TRUST score.</p>
      </div>
      <span class="hr-sr-only" id="${statusId}" role="status" aria-live="polite"></span>
    </details>`;
}

/** Bind both pointer and keyboard focus to the exact annotation target. */
export function bindAnchorLifecycle(trigger, el, submission, status, orphanBadge) {
  let hovered = false;
  let focused = false;
  let activeCleanup = null;

  function activate() {
    activeCleanup?.();
    const result = activateHumanAnchor(el, submission.selector, submission.submissionId);
    activeCleanup = result.cleanup;
    if (result.highlighted) {
      status.textContent = 'The exact text targeted by this human review is highlighted.';
      return;
    }
    status.textContent = 'The exact text targeted by this human review is unavailable in this version.';
    if (orphanBadge) {
      orphanBadge.textContent = 'Anchor unavailable in this version';
      orphanBadge.dataset.anchorStatus = 'orphaned';
      orphanBadge.classList?.remove('hr-anchor-current');
      orphanBadge.classList?.add('hr-anchor-orphaned');
    }
  }

  function deactivate() {
    if (hovered || focused) return;
    activeCleanup?.();
    activeCleanup = null;
    status.textContent = '';
  }

  const onMouseEnter = () => { hovered = true; activate(); };
  const onMouseLeave = () => { hovered = false; deactivate(); };
  const onFocus = () => { focused = true; activate(); };
  const onBlur = () => { focused = false; deactivate(); };

  trigger.addEventListener('mouseenter', onMouseEnter);
  trigger.addEventListener('mouseleave', onMouseLeave);
  trigger.addEventListener('focus', onFocus);
  trigger.addEventListener('blur', onBlur);

  return () => {
    hovered = false;
    focused = false;
    activeCleanup?.();
    activeCleanup = null;
    trigger.removeEventListener('mouseenter', onMouseEnter);
    trigger.removeEventListener('mouseleave', onMouseLeave);
    trigger.removeEventListener('focus', onFocus);
    trigger.removeEventListener('blur', onBlur);
  };
}

const WIDGET_STYLES = `
  :host { display: block; color: #172033; }
  .hr-root { border-left: 3px solid #7c3aed; padding-left: .58rem; font: 0.78rem/1.45 system-ui, sans-serif; }
  .hr-header { display: flex; gap: .4rem; align-items: baseline; margin-bottom: .25rem; }
  .hr-header h3 { font-size: .82rem; margin: 0; color: #5b21b6; }
  .hr-count { color: #64748b; font-size: .7rem; }
  .hr-layer-note { margin: 0 0 .45rem; color: #475569; font-size: .7rem; }
  .hr-card { border: 1px solid #ddd6fe; border-radius: .5rem; background: #faf8ff; margin: .36rem 0; overflow: hidden; }
  .hr-summary { cursor: pointer; display: grid; grid-template-columns: auto auto 1fr; align-items: center; gap: .3rem; padding: .45rem .5rem; list-style: none; }
  .hr-summary::-webkit-details-marker { display: none; }
  .hr-summary:focus-visible { outline: 3px solid #2563eb; outline-offset: 2px; }
  .hr-kind { font-weight: 750; color: #4c1d95; }
  .hr-reviewer { color: #334155; overflow-wrap: anywhere; }
  .hr-stance, .hr-anchor-status { border-radius: 999px; padding: .08rem .34rem; font-size: .66rem; font-weight: 700; white-space: nowrap; }
  .hr-stance-supports { color: #166534; background: #dcfce7; }
  .hr-stance-disputes { color: #991b1b; background: #fee2e2; }
  .hr-stance-qualifies { color: #854d0e; background: #fef3c7; }
  .hr-stance-neutral { color: #334155; background: #e2e8f0; }
  .hr-anchor-status { grid-column: 1 / -1; justify-self: start; }
  .hr-anchor-current { color: #166534; background: #dcfce7; }
  .hr-anchor-orphaned { color: #9a3412; background: #ffedd5; }
  .hr-body { border-top: 1px solid #ede9fe; padding: .52rem .58rem; background: #fff; }
  .hr-body h4 { margin: 0 0 .28rem; font-size: .8rem; }
  .hr-comment { white-space: pre-wrap; margin: 0 0 .48rem; }
  .hr-metadata { margin: 0; display: grid; gap: .18rem; }
  .hr-metadata div { display: grid; grid-template-columns: 7.1rem 1fr; gap: .3rem; }
  .hr-metadata dt { color: #64748b; font-weight: 650; }
  .hr-metadata dd { margin: 0; overflow-wrap: anywhere; }
  .hr-orphan-reason { padding: .35rem; background: #fff7ed; border-left: 3px solid #f97316; }
  .hr-separation { color: #5b21b6; font-size: .68rem; margin: .5rem 0 0; }
  .hr-empty { color: #64748b; margin: 0; }
  .hr-sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0; }
  @media (prefers-color-scheme: dark) {
    :host { color: #e2e8f0; }
    .hr-root { border-left-color: #a78bfa; }
    .hr-header h3, .hr-kind, .hr-separation { color: #c4b5fd; }
    .hr-layer-note, .hr-count, .hr-reviewer { color: #cbd5e1; }
    .hr-card, .hr-body { background: #1e1b2e; border-color: #4c1d95; }
    .hr-body { border-top-color: #4c1d95; }
    .hr-metadata dt { color: #cbd5e1; }
  }
  @media (prefers-reduced-motion: reduce) { * { scroll-behavior: auto !important; } }
`;

function render({ model, el }) {
  if (typeof el.__humanReviewCleanup === 'function') el.__humanReviewCleanup();
  const submissions = safeJsonParse(model.get('submissions'), []);
  const instanceId = String(model.get('instanceId') || model.get('claimId') || 'claim')
    .replace(/[^a-zA-Z0-9_-]+/gu, '-');
  const idPrefix = `hr-${instanceId}`;
  const layerNotice = model.get('layerNotice')
    || 'Human assessments are separate from and never modify the computational TRUST score.';
  const doc = el.ownerDocument || document;
  const root = el.shadowRoot || el.attachShadow({ mode: 'open' });
  root.innerHTML = '';

  const style = doc.createElement('style');
  style.textContent = WIDGET_STYLES;
  root.appendChild(style);

  const section = doc.createElement('section');
  section.className = 'hr-root';
  section.setAttribute('aria-label', 'Human review annotations, separate from computational TRUST');
  section.innerHTML = `
    <div class="hr-header"><h3>Human review</h3><span class="hr-count">${submissions.length} accepted</span></div>
    <p class="hr-layer-note" id="${idPrefix}-layer-note">${escapeHtml(layerNotice)}</p>
    ${submissions.length ? submissions.map((submission, index) => renderSubmissionCard(submission, index, idPrefix)).join('') : '<p class="hr-empty">No accepted human submissions for this version.</p>'}
  `;
  root.appendChild(section);

  const cleanups = [];
  const cards = section.querySelectorAll('.hr-card');
  for (const [index, submission] of submissions.entries()) {
    const card = cards[index];
    const summary = card?.querySelector('summary');
    const status = card?.querySelector(`#${idPrefix}-anchor-status-${index}`);
    const orphanBadge = card?.querySelector('[data-anchor-status]');
    if (summary && status) cleanups.push(bindAnchorLifecycle(summary, el, submission, status, orphanBadge));
  }
  el.__humanReviewCleanup = () => cleanups.forEach((cleanup) => cleanup());
}

export default { render };
