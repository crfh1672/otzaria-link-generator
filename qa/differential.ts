/**
 * Differential test: the optimised helpers vs. the pristine pre-optimisation code,
 * on real book text. Every optimisation in abbreviations.ts / fuzzyUtils.ts claims to be
 * behaviour-preserving; this proves it output-by-output rather than by inspection.
 *
 *   node --import tsx qa/differential.ts
 *
 * qa/baseline/*.original.ts are verbatim copies of the modules before the perf work.
 */
import * as NEW_ABBR from '../src/data/abbreviations';
import * as OLD_ABBR from './baseline/abbreviations.original';
import * as NEW_FUZZ from '../src/utils/fuzzyUtils';
import * as OLD_FUZZ from './baseline/fuzzyUtils.original';
import { book } from './cases';
import fs from 'fs';
import path from 'path';

let checks = 0;
let failures = 0;

function eq(label: string, expected: unknown, actual: unknown, ctx: string) {
  checks++;
  if (JSON.stringify(expected) !== JSON.stringify(actual)) {
    failures++;
    if (failures <= 12) {
      console.log(`  MISMATCH ${label}`);
      console.log(`    ctx      ${ctx.slice(0, 160)}`);
      console.log(`    expected ${JSON.stringify(expected).slice(0, 200)}`);
      console.log(`    actual   ${JSON.stringify(actual).slice(0, 200)}`);
    }
  }
}

const lines = (name: string) =>
  book(name).split(/\r?\n/).map(l => l.trim()).filter(Boolean);

console.log('── corpus ─────────────────────────────────────────────────────────');
const commLines = [
  ...lines('py_berachot'),
  ...lines('py_shabbat'),
  ...lines('benyehoyada_berachot'),
];
const srcLines = [
  ...lines('gem_berachot'),
  ...lines('gem_shabbat'),
  ...lines('rashi_berachot'),
  ...lines('tos_berachot'),
  ...lines('rashi_shabbat'),
  ...lines('tos_shabbat'),
];
console.log(`commentary lines ${commLines.length}, source lines ${srcLines.length}`);

// ── 1. cleanAbbrKey / stripHebrewPrefixes / ktiv / fingerprint over the whole vocabulary ──
const vocab = new Set<string>();
for (const l of [...commLines, ...srcLines]) {
  for (const w of l.split(/\s+/)) if (w) vocab.add(w);
}
const words = [...vocab];
console.log(`\n── word-level helpers over ${words.length} distinct words ──────────────`);
for (const w of words) {
  eq('cleanAbbrKey', OLD_ABBR.cleanAbbrKey(w), NEW_ABBR.cleanAbbrKey(w), w);
  eq('stripHebrewPrefixes', OLD_FUZZ.stripHebrewPrefixes(w), NEW_FUZZ.stripHebrewPrefixes(w), w);
  eq('getNikudFingerprint', OLD_FUZZ.getNikudFingerprint(w), NEW_FUZZ.getNikudFingerprint(w), w);
}
console.log(`  ${checks} checks, ${failures} failures`);

// ── 2. getWordSimilarity / isKtivVariant / levenshtein over real word pairs ──────
let before = checks;
const sample = words.slice(0, 4000);
const rnd = (() => { let s = 99; return () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; }; })();
for (let i = 0; i < sample.length; i++) {
  for (let k = 0; k < 25; k++) {
    const a = sample[i];
    const b = sample[Math.floor(rnd() * sample.length)];
    eq('getWordSimilarity', OLD_FUZZ.getWordSimilarity(a, b, true), NEW_FUZZ.getWordSimilarity(a, b, true), a + ' | ' + b);
    eq('getWordSimilarity/nofuzzy', OLD_FUZZ.getWordSimilarity(a, b, false), NEW_FUZZ.getWordSimilarity(a, b, false), a + ' | ' + b);
    eq('isKtivVariant', OLD_FUZZ.isKtivVariant(a, b), NEW_FUZZ.isKtivVariant(a, b), a + ' | ' + b);
    eq('levenshtein', OLD_FUZZ.levenshteinDistance(a, b), NEW_FUZZ.levenshteinDistance(a, b), a + ' | ' + b);
  }
}
// near-miss pairs: mutate a word so fuzzy matching actually engages
for (const w of sample) {
  if (w.length < 4) continue;
  const mutations = [
    w.slice(1),
    w.slice(0, -1),
    w + 'ו',
    'ו' + w,
    w.slice(0, 2) + w.slice(3),
    w.replace(/ו/g, ''),
    w.replace(/י/g, 'ו'),
  ];
  for (const m of mutations) {
    eq('getWordSimilarity/mutated', OLD_FUZZ.getWordSimilarity(w, m, true), NEW_FUZZ.getWordSimilarity(w, m, true), w + ' | ' + m);
    eq('levenshtein/mutated', OLD_FUZZ.levenshteinDistance(w, m), NEW_FUZZ.levenshteinDistance(w, m), w + ' | ' + m);
  }
}
console.log(`\n── fuzzy helpers over word pairs ──────────────────────────────────`);
console.log(`  ${checks - before} checks, ${failures} failures`);

// ── 3. expandAbbreviationsInText over real (source, context) pairs ───────────────
before = checks;
const gs = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'public', 'gs-dictionary.json'), 'utf8'));
const dicts: [string, Record<string, string[]> | undefined, Record<string, string[]> | undefined][] = [
  ['default', undefined, undefined],
  ['gs', gs.abbreviations, gs.replacements],
];

const PAIRS = 60000;
for (const [dictName, dict, repl] of dicts) {
  for (let i = 0; i < PAIRS; i++) {
    const c = commLines[Math.floor(rnd() * commLines.length)];
    const s = srcLines[Math.floor(rnd() * srcLines.length)];
    // both directions — the parser expands commentary-into-source and source-into-commentary
    eq(`expand/${dictName}/fwd`, OLD_ABBR.expandAbbreviationsInText(c, s, dict, repl), NEW_ABBR.expandAbbreviationsInText(c, s, dict, repl), c);
    eq(`expand/${dictName}/rev`, OLD_ABBR.expandAbbreviationsInText(s, c, dict, repl), NEW_ABBR.expandAbbreviationsInText(s, c, dict, repl), s);
    // short DH-sized fragments, which is what the search actually passes most of the time
    const frag = c.split(/\s+/).slice(0, 12).join(' ');
    eq(`expand/${dictName}/frag`, OLD_ABBR.expandAbbreviationsInText(frag, s, dict, repl), NEW_ABBR.expandAbbreviationsInText(frag, s, dict, repl), frag);
  }
}
console.log(`\n── expandAbbreviationsInText over ${PAIRS * dicts.length * 3} real pairs ───`);
console.log(`  ${checks - before} checks, ${failures} failures`);

// ── 4. adversarial / edge inputs ────────────────────────────────────────────────
before = checks;
const edge = [
  '', ' ', '\t', '\n', 'א', 'א"ב', '"', '""', "''", '״', '׳',
  'ר"ת', 'וכו\'', 'עכ"ל', 'ד"ה', 'א"א א"א א"א',
  'מילה עם ניקוד שָׁלוֹם', 'שָׁלוֹם', 'ABC def', '123 456', 'א1ב2',
  'א  ב   ג', '   מרווח בהתחלה', 'מרווח בסוף   ',
  'א"ב ג"ד ה"ו ז"ח', 'ר\'\'ת', 'x'.repeat(500),
  'א'.repeat(300), 'אבג '.repeat(200),
];
for (const a of edge) {
  for (const b of edge) {
    for (const [dictName, dict, repl] of dicts) {
      eq(`expand/edge/${dictName}`, OLD_ABBR.expandAbbreviationsInText(a, b, dict, repl), NEW_ABBR.expandAbbreviationsInText(a, b, dict, repl), JSON.stringify(a) + ' | ' + JSON.stringify(b));
    }
  }
  eq('cleanAbbrKey/edge', OLD_ABBR.cleanAbbrKey(a), NEW_ABBR.cleanAbbrKey(a), a);
  eq('stripHebrewPrefixes/edge', OLD_FUZZ.stripHebrewPrefixes(a), NEW_FUZZ.stripHebrewPrefixes(a), a);
  eq('getNikudFingerprint/edge', OLD_FUZZ.getNikudFingerprint(a), NEW_FUZZ.getNikudFingerprint(a), a);
  for (const b of edge) {
    eq('getWordSimilarity/edge', OLD_FUZZ.getWordSimilarity(a, b, true), NEW_FUZZ.getWordSimilarity(a, b, true), a + ' | ' + b);
    eq('levenshtein/edge', OLD_FUZZ.levenshteinDistance(a, b), NEW_FUZZ.levenshteinDistance(a, b), a + ' | ' + b);
  }
}
console.log(`\n── adversarial / edge inputs ──────────────────────────────────────`);
console.log(`  ${checks - before} checks, ${failures} failures`);

console.log(`\n${'='.repeat(66)}`);
console.log(`${checks.toLocaleString('en-US')} total comparisons — ${failures === 0 ? 'ZERO DIFFERENCES' : failures + ' DIFFERENCES'}`);
process.exit(failures === 0 ? 0 : 1);
