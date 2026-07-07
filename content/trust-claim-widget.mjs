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

function renderCitationContexts(contexts) {
  if (!Array.isArray(contexts) || contexts.length === 0) {
    return '<div class="tc-empty">No citation contexts available yet.</div>';
  }
  return contexts.map((ctx) => {
    const doi = ctx.doi
      ? `<a href="https://doi.org/${escapeHtml(ctx.doi)}" target="_blank" rel="noopener">${escapeHtml(ctx.doi)}</a>`
      : 'No DOI';
    const passage = escapeHtml(ctx.supporting_passage || 'No supporting passage captured.');
    const citeKey = escapeHtml(ctx.cite_key || 'Unknown key');
    const role = escapeHtml(ctx.role || 'unverified');
    const source = escapeHtml(ctx.passage_source || 'unknown');
    return `
      <div class="tc-context-row">
        <div><strong>${citeKey}</strong> (${role})</div>
        <div class="tc-muted">Source: ${source} | Direction match: ${ctx.direction_match === true ? 'yes' : 'no'}</div>
        <div class="tc-passage">${passage}</div>
        <div class="tc-muted">${doi}</div>
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
    rows.push(`
      <div class="tc-rationale-row">
        <div class="tc-rationale-head"><strong>${label}</strong> <span class="tc-mini-score">${score}/4</span></div>
        <div class="tc-muted">${rationale}</div>
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

function trustBandText(score) {
  if (score == null || Number.isNaN(Number(score))) return 'Pending';
  const n = Number(score);
  if (n >= 85) return 'Very high';
  if (n >= 70) return 'High';
  if (n >= 50) return 'Moderate';
  return 'Low';
}

function scoreBandClass(score) {
  if (score == null || Number.isNaN(Number(score))) return 'tc-band-pending';
  const n = Number(score);
  if (n >= 85) return 'tc-band-high';
  if (n >= 50) return 'tc-band-moderate';
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

function render({ model, el }) {
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

  const scoreText = trustScore == null || Number.isNaN(Number(trustScore)) ? '??' : String(Number(trustScore));
  const trustBand = trustBandText(trustScore);
  const bandClass = scoreBandClass(trustScore);
  const classLabel = claimClassLabel(claimType);

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
    <span class="${badgeClass(trustScore)}">${escapeHtml(scoreText)}</span>
    <span class="tc-summary-main">
      <span class="tc-summary-head">${escapeHtml(classLabel)}</span>
      <span class="tc-summary-sub ${bandClass}">${escapeHtml(summaryTitle(trustScore))} - ${escapeHtml(trustBand)}</span>
    </span>
  `;

  el.innerHTML = '';

  if (interactionMode === 'details') {
    const details = document.createElement('details');
    details.className = 'tc-root';
    const summary = document.createElement('summary');
    summary.className = 'tc-summary';
    summary.innerHTML = cardHtml;
    const box = document.createElement('div');
    box.className = 'tc-box';
    box.innerHTML = detailHtml;
    details.appendChild(summary);
    details.appendChild(box);
    el.appendChild(details);
    return;
  }

  const wrapper = document.createElement('div');
  wrapper.className = 'tc-root tc-slideout-root';

  const cardButton = document.createElement('button');
  cardButton.type = 'button';
  cardButton.className = 'tc-summary tc-card-btn';
  cardButton.setAttribute('aria-expanded', 'false');
  cardButton.innerHTML = cardHtml;

  const panel = document.createElement('aside');
  panel.className = 'tc-slideout';
  panel.setAttribute('aria-hidden', 'true');
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
  el.appendChild(wrapper);
}

export default { render };
