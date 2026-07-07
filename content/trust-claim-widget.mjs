function badgeClass(score) {
  if (score == null || Number.isNaN(Number(score))) return 'tc-badge tc-pending';
  const n = Number(score);
  if (n >= 85) return 'tc-badge tc-high';
  if (n >= 70) return 'tc-badge tc-moderate';
  if (n >= 50) return 'tc-badge tc-low';
  return 'tc-badge tc-critical';
}

function renderCitationContexts(contexts) {
  if (!Array.isArray(contexts) || contexts.length === 0) {
    return '<div class="tc-empty">No citation contexts available yet.</div>';
  }
  return contexts.map((ctx) => {
    const doi = ctx.doi ? `<a href="https://doi.org/${ctx.doi}" target="_blank" rel="noopener">${ctx.doi}</a>` : 'No DOI';
    const passage = ctx.supporting_passage || 'No supporting passage captured.';
    return `
      <div class="tc-context-row">
        <div><strong>${ctx.cite_key || 'Unknown key'}</strong> (${ctx.role || 'unverified'})</div>
        <div class="tc-muted">Source: ${ctx.passage_source || 'unknown'} | Direction match: ${ctx.direction_match === true ? 'yes' : 'no'}</div>
        <div class="tc-passage">${passage}</div>
        <div class="tc-muted">${doi}</div>
      </div>
    `;
  }).join('');
}

function render({ model, el }) {
  const claimId = model.get('claimId');
  const claimText = model.get('claimText') || '';
  const cites = JSON.parse(model.get('cites') || '[]');
  const claimType = model.get('claimType') || '';
  const modality = model.get('modality') || '';
  const trustScore = model.get('trustScore');
  const trustLabel = model.get('trustLabel') || 'pending_validation';
  const evidenceRelation = model.get('evidenceRelation') || 'unverified';
  const citationContexts = JSON.parse(model.get('citationContexts') || '[]');
  const humanReviewRequired = model.get('humanReviewRequired') === true;

  const details = document.createElement('details');
  details.className = 'tc-root';

  const summary = document.createElement('summary');
  summary.className = 'tc-summary';
  summary.innerHTML = `
    <span class="tc-line" aria-hidden="true"></span>
    <span class="tc-title">Trust claim-tag</span>
    <span class="${badgeClass(trustScore)}">${trustScore == null ? 'pending' : `TRUST ${trustScore}`}</span>
  `;

  const box = document.createElement('div');
  box.className = 'tc-box';
  box.innerHTML = `
    <div class="tc-row"><strong>Claim ID:</strong> ${claimId || 'placeholder'}</div>
    <div class="tc-row"><strong>Claim:</strong> ${claimText || 'No claim text provided.'}</div>
    <div class="tc-row"><strong>Meaning:</strong> ${claimType || 'unspecified'} | ${modality || 'unspecified'} | ${evidenceRelation}</div>
    <div class="tc-row"><strong>Citation context keys:</strong> ${cites.length ? cites.join(', ') : 'none listed'}</div>
    <div class="tc-row"><strong>Score label:</strong> ${trustLabel}</div>
    <div class="tc-row"><strong>Human review required:</strong> ${humanReviewRequired ? 'yes' : 'no'}</div>
    <div class="tc-subhead">Citation contexts and rationale</div>
    ${renderCitationContexts(citationContexts)}
  `;

  details.appendChild(summary);
  details.appendChild(box);

  el.innerHTML = '';
  el.appendChild(details);
}

export default { render };
