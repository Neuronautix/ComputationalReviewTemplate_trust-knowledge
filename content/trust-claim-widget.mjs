function badgeClass(score) {
  if (score == null || Number.isNaN(Number(score))) return 'tc-score tc-pending';
  const n = Number(score);
  if (n >= 85) return 'tc-score tc-high';
  if (n >= 70) return 'tc-score tc-moderate';
  if (n >= 50) return 'tc-score tc-low';
  return 'tc-score tc-critical';
}

function escapeHtml(value) {
  return String(value)
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

/** Normalize typography/whitespace while retaining offsets into source text. */
export function normalizeTextWithMap(value) {
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

/** Return raw offsets only when a quote and its context identify one match. */
export function findTextQuote(text, quote, prefix = '', suffix = '') {
  const haystack = normalizeTextWithMap(text);
  const exact = normalizedSelector(quote);
  if (!exact) return null;
  const before = normalizedSelector(prefix);
  const after = normalizedSelector(suffix);
  const matches = [];
  let from = 0;

  while (from <= haystack.text.length - exact.length) {
    const index = haystack.text.indexOf(exact, from);
    if (index === -1) break;
    const prefixMatches = !before || haystack.text.slice(0, index).trimEnd().endsWith(before);
    const suffixMatches = !after || haystack.text.slice(index + exact.length).trimStart().startsWith(after);
    if (prefixMatches && suffixMatches) matches.push(index);
    from = index + 1;
  }

  if (matches.length !== 1) return null;
  const normalizedStart = matches[0];
  return {
    start: haystack.starts[normalizedStart],
    end: haystack.ends[normalizedStart + exact.length - 1],
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

function markTextRange(element, range, anchorName) {
  const doc = element.ownerDocument;
  const textNodes = collectTextNodes(element);
  const segments = [];
  let offset = 0;

  for (const node of textNodes) {
    const nodeStart = offset;
    const nodeEnd = nodeStart + node.data.length;
    const start = Math.max(range.start, nodeStart);
    const end = Math.min(range.end, nodeEnd);
    if (start < end) {
      segments.push({ node, start: start - nodeStart, end: end - nodeStart });
    }
    offset = nodeEnd;
  }

  if (segments.length === 0) return null;
  const marks = [];
  // Reverse processing keeps all offsets valid even when adjacent text nodes
  // share a parent and are normalized during cleanup.
  for (const segment of segments.reverse()) {
    const after = segment.node.splitText(segment.end);
    const selected = segment.node.splitText(segment.start);
    const mark = doc.createElement('mark');
    mark.className = 'tc-runtime-highlight';
    mark.dataset.trustClaimAnchor = anchorName;
    selected.parentNode.replaceChild(mark, selected);
    mark.appendChild(selected);
    marks.push(mark);
    // Retain the split tail in the DOM. `after` is deliberately referenced so
    // linters do not mistake splitText for a discarded mutation.
    void after;
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

function previousContentSibling(el) {
  const aside = el.closest?.('.trust-claim-aside');
  let candidate = aside?.previousElementSibling || null;
  while (candidate?.classList?.contains('trust-claim-aside')) {
    candidate = candidate.previousElementSibling;
  }
  return candidate;
}

/**
 * Highlight the exact build-time anchor or a unique runtime text quote.
 * Explicit target ids may select their entire element; inferred paragraphs may
 * not, which prevents a paraphrased claim from highlighting unrelated prose.
 */
export function activateConcernedText(el, selector = {}) {
  const doc = el.ownerDocument;
  activeHighlights.get(doc)?.();

  const targetAnchor = selector.targetAnchor
    ? doc.getElementById(selector.targetAnchor)
    : null;
  const explicitTarget = selector.targetId
    ? doc.getElementById(selector.targetId)
    : null;
  const scope = selector.scopeAnchor
    ? doc.getElementById(selector.scopeAnchor)
    : null;

  let cleanup = null;
  let highlighted = false;

  if (targetAnchor) {
    targetAnchor.classList.add('tc-is-highlighted');
    cleanup = () => targetAnchor.classList.remove('tc-is-highlighted');
    highlighted = true;
  } else if (explicitTarget && !selector.quote) {
    explicitTarget.classList.add('tc-is-highlighted');
    cleanup = () => explicitTarget.classList.remove('tc-is-highlighted');
    highlighted = true;
  } else {
    const quoteScope = explicitTarget || scope || previousContentSibling(el);
    if (quoteScope && selector.quote) {
      const range = findTextQuote(
        quoteScope.textContent || '',
        selector.quote,
        selector.prefix,
        selector.suffix,
      );
      if (range) {
        cleanup = markTextRange(
          quoteScope,
          range,
          selector.targetAnchor || selector.scopeAnchor || selector.targetId || 'runtime',
        );
        highlighted = Boolean(cleanup);
      }
    }
  }

  if (!cleanup) cleanup = () => {};
  let active = true;
  const coordinatedCleanup = () => {
    if (!active) return;
    active = false;
    cleanup();
    if (activeHighlights.get(doc) === coordinatedCleanup) activeHighlights.delete(doc);
  };
  activeHighlights.set(doc, coordinatedCleanup);
  return { highlighted, cleanup: coordinatedCleanup };
}

export function renderCitationContexts(contexts) {
  if (!Array.isArray(contexts) || contexts.length === 0) {
    return '<div class="tc-empty">No citation contexts available yet.</div>';
  }
  return contexts.map((ctx) => {
    const doi = ctx.doi
      ? `<a href="https://doi.org/${escapeHtml(ctx.doi)}" target="_blank" rel="noopener">${escapeHtml(ctx.doi)}</a>`
      : 'No DOI';
    const citeKey = escapeHtml(ctx.cite_key || 'Unknown key');
    const role = escapeHtml(ctx.role || 'unverified');
    const sourceType = escapeHtml(ctx.source_type || 'unknown');
    const bibliographyStatus = escapeHtml(ctx.bibliography_status || 'unverified');
    const integrityStatus = escapeHtml(ctx.integrity_status || 'not_checked');
    const contextAtoms = Array.isArray(ctx.supports_claim_atoms)
      ? ctx.supports_claim_atoms.map(escapeHtml).join(', ')
      : 'none';
    const passages = Array.isArray(ctx.passages) && ctx.passages.length > 0
      ? ctx.passages
      : (ctx.supporting_passage ? [{
        text: ctx.supporting_passage,
        passage_source: ctx.passage_source || 'unknown',
        locator: ctx.passage_source || 'unknown',
        verification_status: 'legacy',
        supports_claim_atoms: ctx.supports_claim_atoms || [],
      }] : []);
    const passageHtml = passages.length > 0
      ? passages.map((passage) => {
        const atoms = Array.isArray(passage.supports_claim_atoms)
          ? passage.supports_claim_atoms.map(escapeHtml).join(', ')
          : 'none';
        return `
          <div class="tc-passage-record">
            <div class="tc-muted">${escapeHtml(passage.passage_source || 'unknown')} · ${escapeHtml(passage.locator || 'no locator')} · ${escapeHtml(passage.verification_status || 'unverified')} · atoms ${atoms}</div>
            <blockquote class="tc-passage">${escapeHtml(passage.text || 'No passage text captured.')}</blockquote>
          </div>
        `;
      }).join('')
      : '<div class="tc-empty">No supporting passage captured.</div>';
    return `
      <div class="tc-context-row">
        <div><strong>${citeKey}</strong> (${role})</div>
        <div class="tc-muted">${sourceType} · bibliography ${bibliographyStatus} · integrity ${integrityStatus} · direction ${ctx.direction_match === true ? 'match' : 'mismatch'}</div>
        <div class="tc-muted">Attributed claim atoms: ${contextAtoms}</div>
        ${passageHtml}
        <div class="tc-muted tc-doi">${doi}</div>
      </div>
    `;
  }).join('');
}

function renderReferences(citationContexts, cites) {
  const refs = [];
  if (Array.isArray(citationContexts) && citationContexts.length > 0) {
    for (const ctx of citationContexts) {
      refs.push({ key: ctx.cite_key || null, doi: ctx.doi || null });
    }
  } else if (Array.isArray(cites)) {
    for (const key of cites) refs.push({ key, doi: null });
  }

  if (refs.length === 0) return '<div class="tc-empty">No references listed yet.</div>';

  return refs.map((ref) => {
    const key = escapeHtml(ref.key || 'Unknown');
    const doiLink = ref.doi
      ? ` <a href="https://doi.org/${escapeHtml(ref.doi)}" target="_blank" rel="noopener">doi</a>`
      : '';
    return `<li>${key}${doiLink}</li>`;
  }).join('');
}

function renderRationale(components) {
  if (!components || typeof components !== 'object') {
    return '<div class="tc-empty">Why this score was assigned will appear after validator scoring.</div>';
  }

  const labels = [
    ['traceability', 'T (Traceability)'],
    ['robustness', 'R (Robustness)'],
    ['uncertainty_calibration', 'U (Uncertainty)'],
    ['source_integrity', 'S (Source Integrity)'],
    ['transferability_scope_control', 'T (Transferability)'],
  ];

  const rows = [];
  for (const [key, label] of labels) {
    const item = components[key];
    if (!item || typeof item !== 'object') continue;
    const score = Number.isInteger(item.score) ? item.score : 'n/a';
    const rationale = escapeHtml(item.rationale || 'No rationale provided.');
    const ruleId = escapeHtml(item.rule_id || 'unversioned-rule');
    const evidence = Array.isArray(item.evidence) && item.evidence.length > 0
      ? `<ul class="tc-component-evidence">${item.evidence.map((entry) => `<li>${escapeHtml(entry)}</li>`).join('')}</ul>`
      : '<div class="tc-muted">No component evidence references recorded.</div>';
    rows.push(`
      <div class="tc-rationale-row">
        <div class="tc-rationale-head"><strong>${label}</strong> <span class="tc-mini-score">${score}/4</span></div>
        <div class="tc-muted">Rule: ${ruleId}</div>
        <div class="tc-muted">${rationale}</div>
        ${evidence}
      </div>
    `);
  }

  return rows.length > 0
    ? rows.join('')
    : '<div class="tc-empty">Why this score was assigned will appear after validator scoring.</div>';
}

function summaryTitle(score) {
  if (score == null || Number.isNaN(Number(score))) return 'TRUST pending';
  return `TRUST ${Number(score)}`;
}

export function trustBandText(score) {
  if (score == null || Number.isNaN(Number(score))) return 'Pending validation';
  const n = Number(score);
  if (n >= 85) return 'High trust';
  if (n >= 70) return 'Moderate trust';
  if (n >= 50) return 'Low trust';
  return 'Critical / unreliable';
}

function scoreBandClass(score) {
  if (score == null || Number.isNaN(Number(score))) return 'tc-band-pending';
  const n = Number(score);
  if (n >= 85) return 'tc-band-high';
  if (n >= 70) return 'tc-band-moderate';
  return 'tc-band-low';
}

function claimClassLabel(claimType) {
  const t = String(claimType || '').toLowerCase();
  if (t === 'empirical' || t === 'comparative' || t === 'causal') return 'Cited fact';
  if (t === 'methodological' || t === 'definition') return 'Method note';
  if (t === 'review_synthesis' || t === 'speculation') return 'Inference';
  if (t === 'limitation') return 'Limitation';
  return 'Claim';
}

const WIDGET_STYLES = `
  :host {
    display: block;
    width: 14rem;
    max-width: 100%;
    margin: 0;
    padding: 0;
  }

  .tc-root {
    display: block;
    width: 100%;
    margin: 0;
    padding-left: 0.6rem;
    position: relative;
    z-index: 4;
    font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif;
  }

  .tc-root::before {
    content: "";
    position: absolute;
    left: 0;
    top: 0;
    bottom: 0;
    width: 3px;
    border-radius: 999px;
    background: linear-gradient(180deg, #2563eb 0%, #0ea5e9 100%);
  }

  .tc-summary {
    all: unset;
    box-sizing: border-box;
    display: flex;
    align-items: stretch;
    gap: 0.45rem;
    cursor: pointer;
    list-style: none;
    border: 1px solid #cfd8e3;
    border-radius: 0.5rem;
    background: #f5f8fc;
    padding: 0.34rem 0.44rem;
    min-height: 54px;
    max-height: 54px;
  }

  .tc-card-btn {
    all: unset;
    box-sizing: border-box;
    width: 100%;
    text-align: left;
    display: flex;
    align-items: stretch;
    gap: 0.45rem;
    cursor: pointer;
    border: 1px solid #cfd8e3;
    border-radius: 0.5rem;
    background: #f5f8fc;
    padding: 0.34rem 0.44rem;
    min-height: 54px;
    max-height: 54px;
  }

  .tc-card-btn:hover { background: #eef4fb; }
  .tc-summary:focus-visible,
  .tc-card-btn:focus-visible {
    outline: 3px solid #2563eb;
    outline-offset: 2px;
  }
  .tc-summary::-webkit-details-marker { display: none; }

  .tc-rail-line { width: 2px; background: #0284c7; border-radius: 999px; flex: 0 0 auto; }

  .tc-summary-main {
    display: flex;
    flex-direction: column;
    justify-content: center;
    min-width: 0;
  }

  .tc-summary-head {
    font-size: 0.58rem;
    font-weight: 700;
    letter-spacing: 0.03em;
    text-transform: uppercase;
    color: #0f172a;
    line-height: 1.05;
  }

  .tc-summary-sub { font-size: 0.69rem; font-weight: 650; line-height: 1.1; }
  .tc-band-high { color: #005ea8; }
  .tc-band-moderate { color: #8a5a00; }
  .tc-band-low { color: #9f1d1d; }
  .tc-band-pending { color: #475569; }

  .tc-score {
    align-self: center;
    border-radius: 0.32rem;
    padding: 0.18rem 0.42rem;
    font-size: 0.75rem;
    min-width: 2rem;
    text-align: center;
    font-weight: 800;
  }

  .tc-high { background: #0077c8; color: #fff; }
  .tc-moderate { background: #f2a900; color: #1f1500; }
  .tc-low, .tc-critical { background: #d64545; color: #fff; }
  .tc-pending { background: #e5e7eb; color: #374151; }

  .tc-box {
    margin-top: 0.36rem;
    border: 1px solid #d8e3f0;
    border-radius: 0.5rem;
    padding: 0.52rem 0.58rem;
    background: #f7f9fc;
    font-size: 0.78rem;
    color: #111827;
    line-height: 1.42;
  }

  .tc-row { margin-bottom: 0.25rem; }
  .tc-subhead {
    margin: 0.42rem 0 0.3rem;
    font-weight: 700;
    font-size: 0.72rem;
    text-transform: uppercase;
    letter-spacing: 0.02em;
  }
  .tc-list { margin: 0.1rem 0 0.34rem 1rem; padding: 0; }
  .tc-list li { margin: 0.06rem 0; }
  .tc-context-row, .tc-rationale-row {
    border-top: 1px solid #dbeafe;
    padding-top: 0.3rem;
    margin-top: 0.3rem;
  }
  .tc-rationale-head { display: flex; justify-content: space-between; gap: 0.4rem; }
  .tc-mini-score { color: #334155; font-weight: 700; }
  .tc-passage {
    color: #1e293b;
    margin: 0.16rem 0 0;
    padding-left: 0.48rem;
    border-left: 2px solid #bfdbfe;
  }
  .tc-passage-record { margin-top: 0.28rem; }
  .tc-doi { margin-top: 0.28rem; }
  .tc-component-evidence {
    margin: 0.16rem 0 0 1rem;
    padding: 0;
    color: #475569;
    font-size: 0.68rem;
  }
  .tc-component-evidence li { margin: 0.04rem 0; }
  .tc-muted { color: #607083; font-size: 0.68rem; }
  .tc-empty { color: #64748b; }
  .tc-box a { color: #1d4ed8; text-decoration: underline; }
  .tc-sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border: 0;
  }

  .tc-slideout {
    position: absolute;
    top: 0;
    right: calc(100% + 0.7rem);
    width: min(27rem, 50vw);
    background: #fff;
    border: 1px solid #d8e3f0;
    border-radius: 0.55rem;
    box-shadow: 0 16px 28px rgba(2, 12, 24, 0.14);
    padding: 0.4rem;
    opacity: 0;
    transform: translateX(-8px);
    pointer-events: none;
    transition: opacity 160ms ease, transform 160ms ease;
    z-index: 30;
  }

  .tc-slideout-root.is-open .tc-slideout {
    opacity: 1;
    transform: translateX(0);
    pointer-events: auto;
  }

  .tc-slideout-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
    padding: 0.1rem 0.2rem 0.35rem;
    font-size: 0.72rem;
    color: #0f172a;
  }

  .tc-close {
    border: 1px solid #cfd8e3;
    background: #fff;
    color: #334155;
    border-radius: 0.35rem;
    font-size: 0.68rem;
    padding: 0.12rem 0.35rem;
    cursor: pointer;
  }

  .tc-close:hover { background: #f3f6fb; }

  @media (max-width: 1023px) {
    :host {
      width: 100%;
      margin: 0.35rem 0 0.5rem;
    }

    .tc-root {
      width: 100%;
      margin: 0;
    }

    /* On narrow screens the card stacks inline below its paragraph and the
       details expand in-flow on tap (no absolute slideout / margin lane). */
    .tc-slideout {
      position: static;
      width: auto;
      margin-top: 0;
      transform: none;
      box-shadow: none;
      opacity: 0;
      max-height: 0;
      overflow: hidden;
      pointer-events: none;
      transition: none;
    }

    .tc-slideout-root.is-open .tc-slideout {
      opacity: 1;
      max-height: none;
      overflow: visible;
      pointer-events: auto;
      margin-top: 0.4rem;
    }
  }
`;

/**
 * Bind pointer highlighting to the visible score while keeping the complete
 * score control as the keyboard focus target.
 */
export function bindHighlightLifecycle(focusTrigger, hoverTrigger, el, selector, status) {
  let hovered = false;
  let focused = false;
  let activeCleanup = null;
  const pointerTrigger = hoverTrigger || focusTrigger;

  function activate() {
    activeCleanup?.();
    const result = activateConcernedText(el, selector);
    activeCleanup = result.cleanup;
    status.textContent = result.highlighted
      ? 'The exact text scored by this TRUST tag is highlighted.'
      : 'The exact text for this TRUST tag could not be located.';
  }

  function deactivate() {
    if (hovered || focused) return;
    activeCleanup?.();
    activeCleanup = null;
    status.textContent = '';
  }

  function onMouseEnter() {
    hovered = true;
    activate();
  }
  function onMouseLeave() {
    hovered = false;
    deactivate();
  }
  function onFocus() {
    focused = true;
    activate();
  }
  function onBlur() {
    focused = false;
    deactivate();
  }

  pointerTrigger.addEventListener('mouseenter', onMouseEnter);
  pointerTrigger.addEventListener('mouseleave', onMouseLeave);
  focusTrigger.addEventListener('focus', onFocus);
  focusTrigger.addEventListener('blur', onBlur);

  return () => {
    hovered = false;
    focused = false;
    activeCleanup?.();
    activeCleanup = null;
    pointerTrigger.removeEventListener('mouseenter', onMouseEnter);
    pointerTrigger.removeEventListener('mouseleave', onMouseLeave);
    focusTrigger.removeEventListener('focus', onFocus);
    focusTrigger.removeEventListener('blur', onBlur);
  };
}

function render({ model, el }) {
  if (typeof el.__trustClaimCleanup === 'function') el.__trustClaimCleanup();

  const claimId = model.get('claimId');
  const claimText = model.get('claimText') || '';
  const cites = safeJsonParse(model.get('cites'), []);
  const claimType = model.get('claimType') || '';
  const modality = model.get('modality') || '';
  const trustScore = model.get('trustScore');
  const trustLabel = model.get('trustLabel') || 'pending_validation';
  const evidenceRelation = model.get('evidenceRelation') || 'unverified';
  const citationContexts = safeJsonParse(model.get('citationContexts'), []);
  const rationale = safeJsonParse(model.get('rationale'), null);
  const humanReviewRequired = model.get('humanReviewRequired') === true;
  const interactionMode = String(model.get('interactionMode') || 'slideout').toLowerCase();
  const targetSelector = {
    targetAnchor: model.get('targetAnchor') || '',
    scopeAnchor: model.get('scopeAnchor') || '',
    targetId: model.get('targetId') || '',
    quote: model.get('quote') || '',
    prefix: model.get('prefix') || '',
    suffix: model.get('suffix') || '',
  };

  const scoreText = trustScore == null || Number.isNaN(Number(trustScore)) ? '??' : String(Number(trustScore));
  const trustBand = trustBandText(trustScore);
  const bandClass = scoreBandClass(trustScore);
  const classLabel = claimClassLabel(claimType);
  const accessibleSummary = `${summaryTitle(trustScore)}, ${trustBand}. ${classLabel}. Hover or focus to highlight the scored text.`;

  const detailHtml = `
    <div class="tc-row"><strong>Claim ID:</strong> ${escapeHtml(claimId || 'placeholder')}</div>
    <div class="tc-row"><strong>Claim meaning:</strong> ${escapeHtml(claimType || 'unspecified')} | ${escapeHtml(modality || 'unspecified')}</div>
    <div class="tc-row"><strong>Evidence status:</strong> ${escapeHtml(evidenceRelation)}</div>
    <div class="tc-row"><strong>Claim text:</strong> ${escapeHtml(claimText || 'No claim text provided.')}</div>
    <div class="tc-row"><strong>Human review required:</strong> ${humanReviewRequired ? 'yes' : 'no'}</div>
    <div class="tc-subhead">References</div>
    <ul class="tc-list">${renderReferences(citationContexts, cites)}</ul>
    <div class="tc-subhead">Why this score was assigned</div>
    ${renderRationale(rationale)}
    <div class="tc-subhead">Citation contexts</div>
    ${renderCitationContexts(citationContexts)}
    <div class="tc-row tc-muted"><strong>Validator label:</strong> ${escapeHtml(trustLabel)}</div>
  `;

  const cardHtml = `
    <span class="tc-rail-line" aria-hidden="true"></span>
    <span class="${badgeClass(trustScore)}" data-highlight-trigger aria-hidden="true" title="Highlight scored text">${escapeHtml(scoreText)}</span>
    <span class="tc-summary-main">
      <span class="tc-summary-head">${escapeHtml(classLabel)}</span>
      <span class="tc-summary-sub ${bandClass}">${escapeHtml(summaryTitle(trustScore))} - ${escapeHtml(trustBand)}</span>
    </span>
  `;

  const root = el.shadowRoot || el.attachShadow({ mode: 'open' });
  root.innerHTML = '';

  const doc = el.ownerDocument || document;
  const style = doc.createElement('style');
  style.textContent = WIDGET_STYLES;
  root.appendChild(style);

  const status = doc.createElement('span');
  status.className = 'tc-sr-only';
  status.id = 'tc-highlight-status';
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  root.appendChild(status);

  if (interactionMode === 'details') {
    const details = doc.createElement('details');
    details.className = 'tc-root';
    const summary = doc.createElement('summary');
    summary.className = 'tc-summary';
    summary.setAttribute('aria-label', accessibleSummary);
    summary.setAttribute('aria-describedby', status.id);
    summary.innerHTML = cardHtml;
    const box = doc.createElement('div');
    box.className = 'tc-box';
    box.innerHTML = detailHtml;
    details.appendChild(summary);
    details.appendChild(box);
    root.appendChild(details);
    el.__trustClaimCleanup = bindHighlightLifecycle(
      summary,
      summary.querySelector('[data-highlight-trigger]'),
      el,
      targetSelector,
      status,
    );
    return;
  }

  const wrapper = doc.createElement('div');
  wrapper.className = 'tc-root tc-slideout-root';

  const cardButton = doc.createElement('button');
  cardButton.type = 'button';
  cardButton.className = 'tc-summary tc-card-btn';
  cardButton.setAttribute('aria-expanded', 'false');
  cardButton.setAttribute('aria-label', accessibleSummary);
  cardButton.setAttribute('aria-describedby', status.id);
  cardButton.innerHTML = cardHtml;

  const panel = doc.createElement('aside');
  panel.className = 'tc-slideout';
  panel.setAttribute('aria-hidden', 'true');
  const panelId = `tc-panel-${String(claimId || 'claim').replace(/[^a-zA-Z0-9_-]+/g, '-')}`;
  panel.id = panelId;
  cardButton.setAttribute('aria-controls', panelId);
  panel.innerHTML = `
    <div class="tc-slideout-header">
      <strong>Trust claim details</strong>
      <button type="button" class="tc-close" aria-label="Close trust details">Close</button>
    </div>
    <div class="tc-box">${detailHtml}</div>
  `;

  const closeBtn = panel.querySelector('.tc-close');

  function closePanel() {
    wrapper.classList.remove('is-open');
    cardButton.setAttribute('aria-expanded', 'false');
    panel.setAttribute('aria-hidden', 'true');
  }

  cardButton.addEventListener('click', () => {
    const open = wrapper.classList.toggle('is-open');
    cardButton.setAttribute('aria-expanded', open ? 'true' : 'false');
    panel.setAttribute('aria-hidden', open ? 'false' : 'true');
  });

  if (closeBtn) closeBtn.addEventListener('click', closePanel);

  wrapper.appendChild(cardButton);
  wrapper.appendChild(panel);
  root.appendChild(wrapper);
  el.__trustClaimCleanup = bindHighlightLifecycle(
    cardButton,
    cardButton.querySelector('[data-highlight-trigger]'),
    el,
    targetSelector,
    status,
  );
}

export default { render };
