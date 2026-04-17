// citation-annotation-widget.mjs — Merges CiTO annotations into MyST's existing citation hover popover

function render({ model, el }) {
  const raw = model.get('annotation_data') || '{}';
  const annotations = JSON.parse(raw);

  el.style.display = 'none';

  const citoColors = {
    citesAsEvidence: '#2196F3',
    citesAsAuthority: '#4CAF50',
    discusses: '#FF9800',
    citesForInformation: '#9C27B0',
    qualifies: '#f44336',
    extends: '#009688',
    confirms: '#8BC34A',
    disputes: '#E91E63',
    cites: '#757575',
  };

  const citoLabels = {
    citesAsEvidence: 'Cites as Evidence',
    citesAsAuthority: 'Cites as Authority',
    discusses: 'Discusses',
    citesForInformation: 'Cites for Information',
    qualifies: 'Qualifies',
    extends: 'Extends',
    confirms: 'Confirms',
    disputes: 'Disputes',
    cites: 'Cites',
  };

  if (!document.getElementById('cito-merged-styles')) {
    const style = document.createElement('style');
    style.id = 'cito-merged-styles';
    style.textContent = `
      .cito-banner {
        padding: 10px 12px;
        margin: -8px -12px 10px -12px;
        border-radius: 6px 6px 0 0;
        font-size: 0.82em;
        line-height: 1.4;
        border-bottom: 1px solid #ddd;
      }
      .cito-banner-header {
        display: flex;
        align-items: center;
        gap: 8px;
        margin-bottom: 6px;
      }
      .cito-banner .cito-badge {
        display: inline-block;
        padding: 2px 8px;
        border-radius: 3px;
        font-weight: 600;
        color: #fff;
        white-space: nowrap;
        font-size: 0.85em;
      }
      .cito-banner .cito-agreement-tag {
        font-size: 0.8em;
        color: #555;
      }
      .cito-banner .cito-section-label {
        font-size: 0.72em;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.5px;
        color: #777;
        margin-top: 6px;
        margin-bottom: 2px;
      }
      .cito-banner .cito-claim-text {
        color: #333;
        font-size: 0.9em;
        line-height: 1.35;
        margin-bottom: 2px;
      }
      .cito-banner .cito-source-text {
        color: #555;
        font-style: italic;
        font-size: 0.85em;
        line-height: 1.35;
        border-left: 2px solid #ccc;
        padding-left: 8px;
        margin-top: 4px;
      }
      @media (prefers-color-scheme: dark) {
        .cito-banner { background: #2a2a3e !important; border-bottom-color: #444; }
        .cito-banner .cito-claim-text { color: #ddd; }
        .cito-banner .cito-source-text { color: #aaa; border-left-color: #555; }
        .cito-banner .cito-agreement-tag { color: #aaa; }
        .cito-banner .cito-section-label { color: #888; }
      }
      cite[data-cito] a.hover-link {
        border-bottom: 2px dotted var(--cito-color, #999) !important;
        text-decoration: none !important;
      }
      cite[data-cito] a.hover-link:hover {
        border-bottom-style: solid !important;
      }
    `;
    document.head.appendChild(style);
  }

  function extractDoi(href) {
    if (!href) return null;
    const match = href.match(/doi\.org\/(10\.\d{4,}\/[^\s"#]+)/);
    return match ? decodeURIComponent(match[1]) : null;
  }

  function tagCitations() {
    const cites = document.querySelectorAll('cite:not([data-cito-processed])');
    let tagged = 0;
    cites.forEach(cite => {
      cite.setAttribute('data-cito-processed', 'true');
      const link = cite.querySelector('a.hover-link, a[href*="doi.org"]');
      if (!link) return;
      const doi = extractDoi(link.getAttribute('href'));
      if (!doi || !annotations[doi]) return;
      const ann = annotations[doi];
      const color = citoColors[ann.cito] || citoColors.cites;
      cite.setAttribute('data-cito', ann.cito);
      cite.setAttribute('data-cito-doi', doi);
      cite.style.setProperty('--cito-color', color);
      tagged++;
    });
    return tagged;
  }

  // Track a unique ID per popover augmentation to prevent duplicates
  const augmentedPopovers = new WeakSet();

  function augmentPopover(popoverEl, doi) {
    if (!doi || !annotations[doi]) return;
    // Prevent duplicate injection — check both WeakSet and DOM
    if (augmentedPopovers.has(popoverEl)) return;
    if (popoverEl.querySelector('.cito-banner')) return;
    augmentedPopovers.add(popoverEl);

    const ann = annotations[doi];
    const color = citoColors[ann.cito] || citoColors.cites;
    const label = citoLabels[ann.cito] || ann.cito;

    const banner = document.createElement('div');
    banner.className = 'cito-banner';
    // Solid opaque background — light tinted version of the CiTO color
    banner.style.background = tintColor(color, 0.92);
    banner.style.borderLeft = '3px solid ' + color;

    let html = '<div class="cito-banner-header">';
    html += '<span class="cito-badge" style="background:' + color + '">' + label + '</span>';
    if (ann.agreement) {
      const icon = ann.agreement === 'agrees' ? '✓ agrees' :
                   ann.agreement === 'disagrees' ? '✗ disagrees' :
                   ann.agreement === 'qualifies' ? '~ qualifies' : ann.agreement;
      html += '<span class="cito-agreement-tag">' + icon + '</span>';
    }
    html += '</div>';

    if (ann.claim) {
      html += '<div class="cito-section-label">Review claims</div>';
      html += '<div class="cito-claim-text">' + escapeHtml(ann.claim) + '</div>';
    }

    if (ann.source) {
      html += '<div class="cito-section-label">From the paper</div>';
      html += '<div class="cito-source-text">"' + escapeHtml(ann.source) + '"</div>';
    }

    banner.innerHTML = html;
    popoverEl.insertBefore(banner, popoverEl.firstChild);
  }

  function escapeHtml(str) {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  // Compute a tinted (lightened) version of a hex color for background
  function tintColor(hex, factor) {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    const tr = Math.round(r + (255 - r) * factor);
    const tg = Math.round(g + (255 - g) * factor);
    const tb = Math.round(b + (255 - b) * factor);
    return '#' + [tr, tg, tb].map(c => c.toString(16).padStart(2, '0')).join('');
  }

  let hoveredDoi = null;

  function observeHovers() {
    document.addEventListener('mouseenter', (e) => {
      const cite = e.target.closest('cite[data-cito-doi]');
      if (cite) hoveredDoi = cite.getAttribute('data-cito-doi');
    }, true);
    document.addEventListener('mouseleave', (e) => {
      const cite = e.target.closest('cite[data-cito-doi]');
      if (cite) setTimeout(() => { hoveredDoi = null; }, 500);
    }, true);
  }

  function observePopovers() {
    const observer = new MutationObserver((mutations) => {
      if (!hoveredDoi) return; // No active hover — skip processing
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (!(node instanceof HTMLElement)) continue;
          // Look for Radix popover portals
          const candidates = [];
          if (node.querySelector) {
            const radix = node.querySelector('[data-radix-popper-content-wrapper]');
            if (radix) candidates.push(radix);
            node.querySelectorAll('[data-side]').forEach(el => candidates.push(el));
          }
          if (node.getAttribute && node.getAttribute('data-radix-popper-content-wrapper') !== null) {
            candidates.push(node);
          }
          // Also check the node itself if it looks like a popover
          if (node.innerHTML && node.innerHTML.includes('doi.org')) {
            candidates.push(node);
          }

          for (const target of candidates) {
            if (target.innerHTML &&
                (target.innerHTML.includes('doi.org') || target.innerHTML.includes('myst-bibliography'))) {
              // Use requestAnimationFrame to ensure React is done rendering
              requestAnimationFrame(() => augmentPopover(target, hoveredDoi));
              return; // Only augment once per mutation batch
            }
          }
        }
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  let attempts = 0;
  function tryInit() {
    const tagged = tagCitations();
    attempts++;
    if (tagged === 0 && attempts < 20) {
      setTimeout(tryInit, 500);
    } else {
      observeHovers();
      observePopovers();
    }
  }

  if (document.readyState === 'complete') {
    setTimeout(tryInit, 500);
  } else {
    window.addEventListener('load', () => setTimeout(tryInit, 500));
  }

  const navObserver = new MutationObserver(() => setTimeout(tagCitations, 300));
  navObserver.observe(document.querySelector('main') || document.body, {
    childList: true, subtree: true
  });
}

export default { render };
