// The 14 contributor roles of ANSI/NISO Z39.104-2022 (CRediT), in the standard's order, with the
// standard's labels and term URIs. Nothing outside this list is ever emitted as a CRediT role.

export const CREDIT_STANDARD = 'ANSI/NISO Z39.104-2022';
const URI = 'https://credit.niso.org/contributor-roles/';

export const CREDIT_ROLES = Object.freeze([
  ['conceptualization', 'Conceptualization'],
  ['data-curation', 'Data curation'],
  ['formal-analysis', 'Formal analysis'],
  ['funding-acquisition', 'Funding acquisition'],
  ['investigation', 'Investigation'],
  ['methodology', 'Methodology'],
  ['project-administration', 'Project administration'],
  ['resources', 'Resources'],
  ['software', 'Software'],
  ['supervision', 'Supervision'],
  ['validation', 'Validation'],
  ['visualization', 'Visualization'],
  ['writing-original-draft', 'Writing – original draft'],
  ['writing-review-editing', 'Writing – review & editing'],
].map(([slug, label]) => Object.freeze({ slug, label, uri: `${URI}${slug}/` })));

export const CREDIT_SLUGS = CREDIT_ROLES.map((role) => role.slug);
export const DEGREES = ['lead', 'equal', 'supporting'];
const BY_SLUG = new Map(CREDIT_ROLES.map((role) => [role.slug, role]));

export const creditRole = (slug) => BY_SLUG.get(slug) ?? null;
export const roleOrder = (slug) => CREDIT_SLUGS.indexOf(slug);

// Spelling variants seen in hand-written author files that name a CRediT role unambiguously.
// Anything else (a different role, a free-text duty) stays unmapped rather than guessed.
const ALIASES = new Map([
  ['visualisation', 'visualization'],
  ['writing-original-draft-preparation', 'writing-original-draft'],
  ['writing-review-and-editing', 'writing-review-editing'],
]);

/**
 * Map a legacy free-text role label to a CRediT slug, or null when it does not name exactly one role.
 * Only case, dash/ampersand spelling and spacing are normalised.
 */
export function normalizeLegacyRole(label) {
  if (typeof label !== 'string') return null;
  const key = label
    .normalize('NFKC')
    .toLowerCase()
    .replace(/&/gu, ' and ')
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-+|-+$/gu, '');
  if (BY_SLUG.has(key)) return key;
  return ALIASES.get(key) ?? null;
}

/** ISO 7064 MOD 11-2 check of a bare ORCID iD (`0000-0002-1825-0097`). */
export function isValidOrcid(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{4}-\d{4}-\d{3}[\dX]$/u.test(value)) return false;
  const digits = value.replace(/-/gu, '');
  let total = 0;
  for (const ch of digits.slice(0, 15)) total = (total + Number(ch)) * 2;
  const check = (12 - (total % 11)) % 11;
  return digits[15] === (check === 10 ? 'X' : String(check));
}
