/**
 * str2 pathological inputs — second stress wave, aimed at specific loops found by reading
 * the code rather than at generic "big document" shapes.
 *
 * Every generator returns a { commentary, source } pair built to the same BUDGET as
 * qa/stress/inputs.ts so results are directly comparable with that matrix and with
 * ref/real-text.
 */
import { book } from '../cases';
import type { PluginConfig } from '../../src/types';

export const BUDGET = Number(process.env.QA_BUDGET || 200_000);

const HEB = 'אבגדהוזחטיכלמנסעפצקרשת';
function rnd(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}
function hebWord(r: () => number, len: number) {
  let w = '';
  for (let i = 0; i < len; i++) w += HEB[(r() * HEB.length) | 0];
  return w;
}
function hebLine(r: () => number, chars: number) {
  const parts: string[] = [];
  let n = 0;
  while (n < chars) { const w = hebWord(r, 3 + ((r() * 5) | 0)); parts.push(w); n += w.length + 1; }
  return parts.join(' ');
}

export function realSlice(name: string, budget = BUDGET) {
  const t = book(name);
  const lines = t.split(/\r?\n/);
  const out: string[] = [];
  let n = 0;
  for (const l of lines) { out.push(l); n += l.length + 1; if (n >= budget) break; }
  return out.join('\n');
}

export const baseConfig: PluginConfig = {
  sourceCategory: 'shas',
  targetBookName: 'ברכות',
  ignoreShamInShas: true,
  diburHamatchilDelimiter: '',
  useAbbreviationExpansion: true,
  customAbbreviations: undefined,
  useFuzzyMatching: true,
  useWordWeighting: true,
};

export interface Spec {
  commentary: string;
  source: string;
  rashi?: string;
  tosafot?: string;
  config?: Partial<PluginConfig> & Record<string, unknown>;
}

const H = (t: string) => `<h2>${t}</h2>`;

/** N commentary lines that all carry the delimiter, so isExplicit is true for each. */
function delimCommentary(nLines: number, dh: string, delim: string) {
  const out = [H('דף ב.')];
  for (let i = 0; i < nLines; i++) out.push(`${dh} ${delim} המשך הדברים כאן`);
  return out.join('\n');
}

export const CASES: Record<string, () => Spec> = {
  // ── reference points, same budget ─────────────────────────────────────────
  'ref/real-text': () => ({ commentary: realSlice('py_berachot'), source: realSlice('gem_berachot') }),

  // ── A. hasQualifyingOccurrence O(occurrences x lineLength) ────────────────
  // parserAlgorithm.ts:841-849. Every occurrence of the needle is examined, and each one
  // does haystack.slice(0, idx).trim().split(/\s+/) — O(idx) plus an array of idx/6 strings.
  // The early-out only fires when an occurrence is within the first 3 words OR the needle
  // is >= 3 words. A 2-word needle whose first occurrence is deep therefore walks every
  // occurrence at full slice cost.
  'quad/needle-deep-repeat': () => {
    const unit = 'אבגד דהוז';                 // the 2-word needle
    const filler = 'קדם '.repeat(10);          // pushes the first occurrence past word 3
    let line = filler;
    while (line.length < BUDGET) line += unit + ' ';
    return {
      commentary: delimCommentary(40, unit, 'עכ"ל'),
      source: `${H('דף ב.')}\n${line}`,
      config: { diburHamatchilDelimiter: 'עכ"ל' },
    };
  },
  /** Control: same bytes, same needle, but the needle is 3 words -> early-out on occurrence 1. */
  'quad/needle-deep-repeat-3w': () => {
    const unit = 'אבגד דהוז חטיכ';
    const filler = 'קדם '.repeat(10);
    let line = filler;
    while (line.length < BUDGET) line += unit + ' ';
    return {
      commentary: delimCommentary(40, unit, 'עכ"ל'),
      source: `${H('דף ב.')}\n${line}`,
      config: { diburHamatchilDelimiter: 'עכ"ל' },
    };
  },
  /** Control: same needle + same total bytes, but the source is split into normal lines. */
  'quad/needle-repeat-manylines': () => {
    const unit = 'אבגד דהוז';
    const filler = 'קדם '.repeat(10);
    const out = [H('דף ב.')];
    let n = 0;
    while (n < BUDGET) {
      let l = filler;
      for (let i = 0; i < 20; i++) l += unit + ' ';
      out.push(l); n += l.length + 1;
    }
    return {
      commentary: delimCommentary(40, unit, 'עכ"ל'),
      source: out.join('\n'),
      config: { diburHamatchilDelimiter: 'עכ"ל' },
    };
  },

  // ── B. one giant target line vs many normal lines, identical byte budget ──
  // calcContiguousScore sweeps every target word (maxDocWIdx = targetWords.length,
  // parserAlgorithm.ts:870) and findSourceMatchRange (1757) is O(dhWords x targetWords)
  // per LINK — so a single line that every commentary line matches is scored, and then
  // re-scanned for highlighting, once per link.
  'giant/one-source-line': () => {
    const r = rnd(41), r2 = rnd(42);
    const comm = [H('דף ב.')];
    for (let i = 0; i < 300; i++) comm.push(hebLine(r, 120));
    return { commentary: comm.join('\n'), source: `${H('דף ב.')}\n${hebLine(r2, BUDGET)}` };
  },
  'giant/many-source-lines': () => {
    const r = rnd(41), r2 = rnd(42);
    const comm = [H('דף ב.')];
    for (let i = 0; i < 300; i++) comm.push(hebLine(r, 120));
    const src = [H('דף ב.')];
    let n = 0;
    while (n < BUDGET) { const l = hebLine(r2, 200); src.push(l); n += l.length + 1; }
    return { commentary: comm.join('\n'), source: src.join('\n') };
  },
  /** Same as giant/one-source-line but every commentary line is a verbatim copy of the
   *  first 12 words of the giant line, so every line produces a LINK -> findSourceMatchRange
   *  runs 300 times over a 33k-word target line. */
  'giant/one-line-all-match': () => {
    const r2 = rnd(42);
    const giant = hebLine(r2, BUDGET);
    const dh = giant.split(' ').slice(0, 12).join(' ');
    const comm = [H('דף ב.')];
    for (let i = 0; i < 300; i++) comm.push(dh);
    return { commentary: comm.join('\n'), source: `${H('דף ב.')}\n${giant}` };
  },

  // ── C. levenshtein with no length ceiling ─────────────────────────────────
  // fuzzyUtils.ts:134. getWordSimilarity gates on |len difference| <= 2 but not on absolute
  // length, so two same-length mega-tokens run a full O(n*m) DP.
  'lev/equal-length-token-10k': () => {
    const r = rnd(51);
    const w = hebWord(r, 10_000);
    return { commentary: `${H('דף ב.')}\n${w}`, source: `${H('דף ב.')}\n${w.slice(0, w.length - 1)}ק` };
  },
  'lev/equal-length-token-50k': () => {
    const r = rnd(51);
    const w = hebWord(r, 50_000);
    return { commentary: `${H('דף ב.')}\n${w}`, source: `${H('דף ב.')}\n${w.slice(0, w.length - 1)}ק` };
  },
  /** Control: identical bytes, but the two tokens differ in length by 3 -> gate rejects. */
  'lev/unequal-length-token-50k': () => {
    const r = rnd(51);
    const w = hebWord(r, 50_000);
    return { commentary: `${H('דף ב.')}\n${w}`, source: `${H('דף ב.')}\n${w.slice(0, w.length - 3)}` };
  },
  /** Realistic version: a whole document with no spaces at all (broken export / minified
   *  HTML), so every LINE is one mega-token and each pair runs the full DP. */
  'lev/no-spaces-document': () => {
    const r = rnd(53), r2 = rnd(54);
    const mk = (rr: () => number) => {
      const out = [H('דף ב.')];
      for (let i = 0; i < 40; i++) out.push(hebWord(rr, 2000));
      return out.join('\n');
    };
    return { commentary: mk(r), source: mk(r2) };
  },

  // ── D. header-count quadratic in a realistic wrapper ──────────────────────
  // parserAlgorithm.ts:1226-1228: one linear scan of srcDoc.segments per commentary
  // segment, x3 when rashi+tosafot are supplied.
  'hdr/4k-segments-nomatch': () => {
    const mk = (tag: string) => {
      const out: string[] = [];
      for (let i = 0; i < 4000; i++) { out.push(`<h2>${tag} פרק ${i}</h2>`); out.push('אמר רבי יוחנן שלום עולם'); }
      return out.join('\n');
    };
    return { commentary: mk('א'), source: mk('ב') };
  },
  'hdr/4k-segments-nomatch-with-secondary': () => {
    const mk = (tag: string) => {
      const out: string[] = [];
      for (let i = 0; i < 4000; i++) { out.push(`<h2>${tag} פרק ${i}</h2>`); out.push('אמר רבי יוחנן שלום עולם'); }
      return out.join('\n');
    };
    return { commentary: mk('א'), source: mk('ב'), rashi: mk('ג'), tosafot: mk('ד') };
  },

  // ── E. cache pressure: all-distinct words, and the retained-heap question ──
  'cache/distinct-words-200k': () => {
    let counter = 0;
    const uniq = () => { let n = counter++, s = ''; for (let i = 0; i < 7; i++) { s += HEB[n % HEB.length]; n = (n / HEB.length) | 0; } return s; };
    const mk = () => {
      const lines = [H('דף ב.')];
      let n = 0;
      while (n < BUDGET) { const parts: string[] = []; for (let i = 0; i < 25; i++) parts.push(uniq()); const l = parts.join(' '); lines.push(l); n += l.length + 1; }
      return lines.join('\n');
    };
    return { commentary: mk(), source: mk() };
  },
  /** Very long DISTINCT words: the caches cap on entry COUNT, not on bytes, so long keys
   *  multiply what a full cache retains for the rest of the browser session. */
  'cache/distinct-long-words': () => {
    let counter = 0;
    const uniq = () => { let n = counter++, s = ''; for (let i = 0; i < 7; i++) { s += HEB[n % HEB.length]; n = (n / HEB.length) | 0; } return s + 'ק'.repeat(60); };
    const mk = () => {
      const lines = [H('דף ב.')];
      let n = 0;
      while (n < BUDGET) { const parts: string[] = []; for (let i = 0; i < 4; i++) parts.push(uniq()); const l = parts.join(' '); lines.push(l); n += l.length + 1; }
      return lines.join('\n');
    };
    return { commentary: mk(), source: mk() };
  },
  /** stripNikudCache / targetIndexCache are keyed on whole LINES and capped at 16384 / 4096
   *  ENTRIES with no byte ceiling. Feed them big distinct lines. */
  'cache/big-distinct-lines': () => {
    const r = rnd(61), r2 = rnd(62);
    const mk = (rr: () => number) => {
      const lines = [H('דף ב.')];
      for (let i = 0; i < 200; i++) lines.push(hebLine(rr, 4000));
      return lines.join('\n');
    };
    return { commentary: mk(r), source: mk(r2) };
  },
};

/** Extra crash probes not covered by qa/stress/inputs.ts. */
export const CRASH_CASES: Record<string, () => any[]> = {
  'crash/config-is-string': () => ['שלום', 'שלום', 'notaconfig'],
  'crash/config-is-array': () => ['שלום', 'שלום', []],
  'crash/rashi-is-object': () => ['רש"י ד"ה שלום', 'שלום', baseConfig, { a: 1 }],
  'crash/tosafot-is-array': () => ['תוס\' ד"ה שלום', 'שלום', baseConfig, undefined, ['x']],
  'crash/links-not-array': () => ['רש"י ד"ה שלום', 'שלום', baseConfig, 'שלום', 'שלום', 42, 42],
  'crash/gsReplacements-string': () => ['א"א שלום', 'אי אפשר שלום', { ...baseConfig, gsReplacements: 'nope' }],
  'crash/gsAbbrev-array': () => ['א"א שלום', 'אי אפשר שלום', { ...baseConfig, gsAbbreviations: ['a'] }],
  'crash/abbrev-value-not-array': () => ['א"א שלום', 'אי אפשר שלום', { ...baseConfig, customAbbreviations: { 'אא': 42 } }],
  'crash/abbrev-value-obj': () => ['א"א שלום', 'אי אפשר שלום', { ...baseConfig, customAbbreviations: { 'אא': { x: 1 } } }],
  'crash/targetBookName-object': () => ['שלום', 'שלום', { ...baseConfig, targetBookName: { a: 1 } }],
  'crash/delimiter-whitespace': () => ['שלום עולם', 'שלום עולם', { ...baseConfig, diburHamatchilDelimiter: '   ' }],
  'crash/crlf-document': () => ['<h2>דף ב.</h2>\r\nשלום עולם\r\n', '<h2>דף ב.</h2>\r\nשלום עולם\r\n', baseConfig],
  'crash/lone-cr-document': () => ['<h2>דף ב.</h2>\rשלום עולם\r', '<h2>דף ב.</h2>\rשלום עולם\r', baseConfig],
  'crash/header-only-no-content': () => ['<h2>דף ב.</h2>', '<h2>דף ב.</h2>', baseConfig],
  'crash/nested-headers': () => ['<h2><h3>דף ב.</h3></h2>\nשלום', '<h2><h3>דף ב.</h3></h2>\nשלום', baseConfig],
  'crash/html-comment-bomb': () => [`<h2>דף ב.</h2>\n${'<!--'.repeat(20000)}שלום`, '<h2>דף ב.</h2>\nשלום', baseConfig],
  'crash/regex-bomb-in-header': () => [`<h2>${'<'.repeat(50000)}</h2>\nשלום`, '<h2>דף ב.</h2>\nשלום', baseConfig],
  'crash/deep-bracket-prefix': () => [`<h2>דף ב.</h2>\n${'('.repeat(50000)}שלום`, '<h2>דף ב.</h2>\nשלום', baseConfig],
  'crash/only-nikud': () => ['<h2>דף ב.</h2>\n' + 'ַ'.repeat(50000), '<h2>דף ב.</h2>\n' + 'ַ'.repeat(50000), baseConfig],
  'crash/proto-pollution-abbrev': () => ['constructor שלום', 'שלום', { ...baseConfig, customAbbreviations: JSON.parse('{"__proto__":{"polluted":true}}') }],
  'crash/dict-lookup-proto': () => ['toString שלום', 'שלום עולם', { ...baseConfig, customAbbreviations: {} }],
};
