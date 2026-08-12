/**
 * Cache-cap verification: hammer every memo cache in abbreviations.ts / fuzzyUtils.ts
 * with an unbounded stream of DISTINCT keys and watch where heap settles.
 *
 *   node --max-old-space-size=8192 --expose-gc --import tsx qa/stress/cache-caps.ts [millionsOfKeys]
 *
 * These caches are module-level and live for the whole browser session, so whatever they
 * retain here is retained by the real app forever.
 */
import { cleanAbbrKey, expandAbbreviationsInText } from '../../src/data/abbreviations';
import { stripHebrewPrefixes, getNikudFingerprint, getWordSimilarity } from '../../src/utils/fuzzyUtils';

const gc = () => { const g = (global as any).gc; if (!g) throw new Error('--expose-gc'); for (let i = 0; i < 4; i++) g(); };
const MB = (n: number) => (n / 1024 / 1024).toFixed(1);
const heap = () => { gc(); return process.memoryUsage().heapUsed; };

const HEB = 'אבגדהוזחטיכלמנסעפצקרשת';
let counter = 0;
/** distinct 8-letter Hebrew word */
function uniq(): string {
  let n = counter++, s = '';
  for (let i = 0; i < 8; i++) { s += HEB[n % HEB.length]; n = (n / HEB.length) | 0; }
  return s;
}

const BATCH = 100_000;
const BATCHES = Number(process.argv[2] || 12);

const base = heap();
console.log(`baseline heap ${MB(base)}MB`);
console.log(`\nphase 1: word-keyed caches (stem / fingerprint / skeleton / cleanKey / initials)`);
console.log(`${'keys fed'.padStart(10)}  ${'heapUsed'.padStart(10)}  ${'delta'.padStart(10)}  ${'rss'.padStart(10)}`);

for (let b = 1; b <= BATCHES; b++) {
  for (let i = 0; i < BATCH; i++) {
    const w = uniq();
    stripHebrewPrefixes(w);         // stemCache
    getNikudFingerprint(w);         // fingerprintCache
    getWordSimilarity(w, w + 'ק');  // skeletonCache (via isKtivVariant) + levenshtein
    cleanAbbrKey(w);                // cleanKeyCache
  }
  const h = heap();
  console.log(`${String(b * BATCH).padStart(10)}  ${MB(h).padStart(9)}MB  ${MB(h - base).padStart(9)}MB  ${MB(process.memoryUsage().rss).padStart(9)}MB`);
}

const afterWords = heap();
console.log(`\nphase 2: initialsCache + targetIndexCache + stripNikudCache via expandAbbreviationsInText`);
console.log(`${'calls'.padStart(10)}  ${'heapUsed'.padStart(10)}  ${'delta'.padStart(10)}  ${'rss'.padStart(10)}`);

// Each call feeds: a distinct 3-word source phrase (-> initialsCache + cleanKeyCache)
// and a distinct target context LINE (-> stripNikudCache + targetIndexCache).
const LINE_LEN = 40; // words per context line — realistic book line
for (let b = 1; b <= BATCHES; b++) {
  for (let i = 0; i < BATCH / 10; i++) {
    const src = `${uniq()} ${uniq()} ${uniq()}`;
    const ctxWords: string[] = [];
    for (let k = 0; k < LINE_LEN; k++) ctxWords.push(uniq());
    expandAbbreviationsInText(src, ctxWords.join(' '));
  }
  const h = heap();
  console.log(`${String(b * BATCH / 10).padStart(10)}  ${MB(h).padStart(9)}MB  ${MB(h - afterWords).padStart(9)}MB  ${MB(process.memoryUsage().rss).padStart(9)}MB`);
}

const end = heap();
console.log(`\nTOTAL retained by module caches: ${MB(end - base)}MB heap  (rss ${MB(process.memoryUsage().rss)}MB)`);
console.log(`distinct keys fed: ${counter}`);
