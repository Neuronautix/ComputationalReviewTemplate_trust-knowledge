import crypto from 'node:crypto';

export const sha256 = (data) => `sha256:${crypto.createHash('sha256').update(data).digest('hex')}`;

export function sortKeys(value) {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortKeys(value[key])]));
  }
  return value;
}

/** Compact sorted-key JSON, the contract's JSONL line form. */
export const canonicalLine = (value) => JSON.stringify(sortKeys(value));

/** Pretty sorted-key JSON with a final newline: the form of manifest.json and of every file this importer writes. */
export const prettyJson = (value, indent = 2) => `${JSON.stringify(sortKeys(value), null, indent)}\n`;

/**
 * Replace every number token outside strings with `0`. Python and JavaScript print some
 * floats differently (`12.0` vs `12`); the contract's byte rules concern layout and key
 * order, so number spelling must not make a conforming producer's packet fail here.
 */
export function maskNumbers(text) {
  let out = '';
  for (let i = 0; i < text.length;) {
    const ch = text[i];
    if (ch === '"') {
      let j = i + 1;
      while (j < text.length && text[j] !== '"') j += text[j] === '\\' ? 2 : 1;
      out += text.slice(i, j + 1);
      i = j + 1;
    } else if (ch === '-' || (ch >= '0' && ch <= '9')) {
      let j = i + 1;
      while (j < text.length && /[0-9.eE+-]/u.test(text[j])) j += 1;
      out += '0';
      i = j;
    } else {
      out += ch;
      i += 1;
    }
  }
  return out;
}

export function isCanonicalJsonLine(line, parsed) {
  return maskNumbers(line) === maskNumbers(canonicalLine(parsed));
}

export function isCanonicalManifest(text, parsed) {
  if (!text.endsWith('\n') || text.includes('\r')) return false;
  return [2, 4].some((indent) => maskNumbers(text) === maskNumbers(prettyJson(parsed, indent)));
}
