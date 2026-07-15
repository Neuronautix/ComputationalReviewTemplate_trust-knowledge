import { readFileSync, writeFileSync } from 'node:fs';

const input = JSON.parse(readFileSync(new URL('../data/input.json', import.meta.url), 'utf8'));
const mean = input.values.reduce((sum, value) => sum + value, 0) / input.values.length;
writeFileSync(new URL('../output/result.json', import.meta.url), `${JSON.stringify({ mean }, null, 2)}\n`);
