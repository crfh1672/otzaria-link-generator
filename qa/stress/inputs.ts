/**
 * Pathological input generators, shared by the child runner and the driver.
 * Every generator returns a { commentary, source } pair built to a byte budget so
 * cases are comparable against a same-sized slice of real book text.
 */
import { book } from '../cases';
import type { PluginConfig } from '../../src/types';

export const BUDGET = Number(process.env.QA_BUDGET || 200_000); // chars per document

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

/** A realistic-looking Hebrew paragraph line of ~`chars` characters. */
function hebLine(r: () => number, chars: number) {
  const parts: string[] = [];
  let n = 0;
  while (n < chars) {
    const w = hebWord(r, 3 + ((r() * 5) | 0));
    parts.push(w);
    n += w.length + 1;
  }
  return parts.join(' ');
}

function repeatTo(unit: string, budget: number) {
  const out: string[] = [];
  let n = 0;
  while (n < budget) {
    out.push(unit);
    n += unit.length + 1;
  }
  return out.join('\n');
}

/** First `budget` characters of a real book, cut on a line boundary, header preserved. */
export function realSlice(name: string, budget = BUDGET) {
  const t = book(name);
  const lines = t.split(/\r?\n/);
  const out: string[] = [];
  let n = 0;
  for (const l of lines) {
    out.push(l);
    n += l.length + 1;
    if (n >= budget) break;
  }
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
  /** expect a throw rather than a result */
  note?: string;
}

const H = (t: string) => `<h2>${t}</h2>`;

export const CASES: Record<string, () => Spec> = {
  // ── reference: real text, same byte budget ───────────────────────────────
  'ref/real-text': () => ({
    commentary: realSlice('py_berachot'),
    source: realSlice('gem_berachot'),
  }),
  'ref/synthetic-normal': () => {
    const r = rnd(1), r2 = rnd(2);
    const mk = (rr: () => number) => {
      const lines = [H('דף ב.')];
      let n = 0;
      while (n < BUDGET) { const l = hebLine(rr, 200); lines.push(l); n += l.length + 1; }
      return lines.join('\n');
    };
    return { commentary: mk(r), source: mk(r2) };
  },

  // ── 1. one enormous line ─────────────────────────────────────────────────
  'long/one-line-100k': () => {
    const r = rnd(3), r2 = rnd(4);
    return {
      commentary: `${H('דף ב.')}\n${hebLine(r, BUDGET)}`,
      source: `${H('דף ב.')}\n${hebLine(r2, BUDGET)}`,
    };
  },
  /** one single token with no whitespace at all — worst case for word-level code */
  'long/one-token-nospace': () => {
    const r = rnd(5), r2 = rnd(6);
    return {
      commentary: `${H('דף ב.')}\n${hebWord(r, BUDGET)}`,
      source: `${H('דף ב.')}\n${hebWord(r2, BUDGET)}`,
    };
  },
  /** two giant tokens of nearly equal length -> levenshtein on 100k x 100k */
  'long/two-near-equal-tokens': () => {
    const r = rnd(7);
    const w = hebWord(r, BUDGET);
    return {
      commentary: `${H('דף ב.')}\n${w}`,
      source: `${H('דף ב.')}\n${w.slice(0, w.length - 1)}ק`,
    };
  },

  // ── 2. many tiny lines ───────────────────────────────────────────────────
  'many/tiny-lines': () => {
    const r = rnd(8), r2 = rnd(9);
    const mk = (rr: () => number) => {
      const lines = [H('דף ב.')];
      let n = 0;
      while (n < BUDGET) { const w = hebWord(rr, 4); lines.push(w); n += 5; }
      return lines.join('\n');
    };
    return { commentary: mk(r), source: mk(r2) };
  },

  // ── 3. all headers ───────────────────────────────────────────────────────
  'many/all-headers': () => {
    const mk = () => repeatTo(H('דף ב.'), BUDGET);
    return { commentary: mk(), source: mk() };
  },
  'many/all-distinct-headers': () => {
    const mk = () => {
      const out: string[] = []; let n = 0, i = 0;
      while (n < BUDGET) { const l = H(`דף ${i++} כותרת`); out.push(l); n += l.length + 1; }
      return out.join('\n');
    };
    return { commentary: mk(), source: mk() };
  },

  // ── 4. deeply repeated identical lines ───────────────────────────────────
  'many/identical-lines': () => {
    const unit = 'ומשום הכי אמרינן דהא מילתא לא שכיחא כלל וכלל בעלמא';
    return {
      commentary: `${H('דף ב.')}\n${repeatTo(unit, BUDGET)}`,
      source: `${H('דף ב.')}\n${repeatTo(unit, BUDGET)}`,
    };
  },

  // ── 5. no Hebrew at all ──────────────────────────────────────────────────
  'text/no-hebrew': () => {
    const unit = 'the quick brown fox jumps over the lazy dog again and again forever';
    return {
      commentary: `${H('page 2a')}\n${repeatTo(unit, BUDGET)}`,
      source: `${H('page 2a')}\n${repeatTo(unit, BUDGET)}`,
    };
  },
  'text/punctuation-only': () => {
    const unit = `"'״׳.,:;()[]{}!?-—…**##$$%%^^&&`.repeat(4);
    return {
      commentary: `${H('דף ב.')}\n${repeatTo(unit, BUDGET)}`,
      source: `${H('דף ב.')}\n${repeatTo(unit, BUDGET)}`,
    };
  },
  'text/quotes-only': () => {
    const unit = `"״'׳’‘´`.repeat(20);
    return {
      commentary: `${H('דף ב.')}\n${repeatTo(unit, BUDGET)}`,
      source: `${H('דף ב.')}\n${repeatTo(unit, BUDGET)}`,
    };
  },

  // ── 6. nikud-heavy ───────────────────────────────────────────────────────
  'text/nikud-heavy': () => {
    const r = rnd(11), r2 = rnd(12);
    const NIK = 'ְֱֲֳִֵֶַָֹֻּ';
    const mk = (rr: () => number) => {
      const lines = [H('דף ב.')];
      let n = 0;
      while (n < BUDGET) {
        let l = '';
        for (let i = 0; i < 40; i++) {
          for (let j = 0; j < 5; j++) l += HEB[(rr() * HEB.length) | 0] + NIK[(rr() * NIK.length) | 0] + NIK[(rr() * NIK.length) | 0];
          l += ' ';
        }
        lines.push(l); n += l.length + 1;
      }
      return lines.join('\n');
    };
    return { commentary: mk(r), source: mk(r2) };
  },

  // ── 7. bidi control characters ───────────────────────────────────────────
  'text/bidi-controls': () => {
    const CTL = '‎‏‪‫‬‭‮⁦⁧⁨⁩؜';
    const r = rnd(13), r2 = rnd(14);
    const mk = (rr: () => number) => {
      const lines = [H('דף ב.')];
      let n = 0;
      while (n < BUDGET) {
        let l = '';
        for (let i = 0; i < 30; i++) l += CTL[(rr() * CTL.length) | 0] + hebWord(rr, 4) + CTL[(rr() * CTL.length) | 0] + ' ';
        lines.push(l); n += l.length + 1;
      }
      return lines.join('\n');
    };
    return { commentary: mk(r), source: mk(r2) };
  },

  // ── 8. lone surrogates + emoji ───────────────────────────────────────────
  'text/lone-surrogates': () => {
    const mk = () => {
      const lines = [H('דף ב.')];
      let n = 0;
      while (n < BUDGET) {
        const l = '\uD800אבגד\uDC00 😀\uD800 שלום\uDFFF עולם🦄';
        lines.push(l); n += l.length + 1;
      }
      return lines.join('\n');
    };
    return { commentary: mk(), source: mk() };
  },
  'text/emoji-heavy': () => {
    const unit = '😀🦄🎉👨‍👩‍👧‍👦🇮🇱 שלום 😀🦄🎉 עולם 👍🏽🏳️‍🌈';
    return {
      commentary: `${H('דף ב.')}\n${repeatTo(unit, BUDGET)}`,
      source: `${H('דף ב.')}\n${repeatTo(unit, BUDGET)}`,
    };
  },
  'text/nul-bytes': () => {
    const unit = 'שלום עולם  אמר רבי יוחנן';
    return {
      commentary: `${H('דף ב.')}\n${repeatTo(unit, BUDGET)}`,
      source: `${H('דף ב.')}\n${repeatTo(unit, BUDGET)}`,
    };
  },

  // ── 9. very many distinct words (defeats the memo caches) ────────────────
  'cache/all-distinct-words': () => {
    // Every word in both documents is unique -> every memo cache miss, max insertions.
    let counter = 0;
    const uniq = () => {
      // base-22 in Hebrew letters, guaranteed distinct, length 6-8
      let n = counter++, s = '';
      for (let i = 0; i < 7; i++) { s += HEB[n % HEB.length]; n = (n / HEB.length) | 0; }
      return s;
    };
    const mk = () => {
      const lines = [H('דף ב.')];
      let n = 0;
      while (n < BUDGET) {
        const parts: string[] = [];
        for (let i = 0; i < 25; i++) parts.push(uniq());
        const l = parts.join(' ');
        lines.push(l); n += l.length + 1;
      }
      return lines.join('\n');
    };
    return { commentary: mk(), source: mk() };
  },

  // ── 10. structural: no headers / mismatched books ────────────────────────
  'struct/no-headers': () => {
    const c = realSlice('py_berachot').split('\n').filter(l => !/^<h/i.test(l)).join('\n');
    const s = realSlice('gem_berachot').split('\n').filter(l => !/^<h/i.test(l)).join('\n');
    return { commentary: c, source: s };
  },
  'struct/mismatched-books': () => ({
    // Berachot commentary against Shabbat gemara: no header ever matches ->
    // every search falls back to scanning the WHOLE source document.
    commentary: realSlice('py_berachot'),
    source: realSlice('gem_shabbat'),
    config: { targetBookName: 'שבת' },
  }),
  'struct/commentary-no-source': () => ({
    commentary: realSlice('py_berachot'),
    source: '',
  }),
  'struct/koo-every-line': () => {
    // every commentary line carries כו' -> forces searchPrimaryWithFirstAnchor,
    // which has an inner +10 / +15 line lookahead per candidate line.
    const r = rnd(21), r2 = rnd(22);
    const mk = (rr: () => number, koo: boolean) => {
      const lines = [H('דף ב.')];
      let n = 0;
      while (n < BUDGET) {
        const l = koo
          ? `${hebLine(rr, 40)} כו' ${hebLine(rr, 40)} כו' ${hebLine(rr, 40)}`
          : hebLine(rr, 130);
        lines.push(l); n += l.length + 1;
      }
      return lines.join('\n');
    };
    return { commentary: mk(r, true), source: mk(r2, false) };
  },

  // ── 11. malformed HTML / header abuse ────────────────────────────────────
  'struct/unclosed-tags': () => {
    const unit = '<h2>דף ב. <b><i>אמר רבי יוחנן <div class="x" שלום עולם <<<>>>';
    return {
      commentary: repeatTo(unit, BUDGET),
      source: repeatTo(unit, BUDGET),
    };
  },
  'struct/giant-header': () => {
    const r = rnd(31);
    return {
      commentary: `<h2>${hebLine(r, BUDGET)}</h2>\nאמר רבי יוחנן שלום`,
      source: `<h2>${hebLine(rnd(32), BUDGET)}</h2>\nאמר רבי יוחנן שלום`,
    };
  },
};

/** Crash / malformed-argument probes — small inputs, we only care whether they throw. */
export const CRASH_CASES: Record<string, () => any[]> = {
  'crash/undefined-commentary': () => [undefined, 'שלום', baseConfig],
  'crash/undefined-source': () => ['שלום', undefined, baseConfig],
  'crash/null-commentary': () => [null, 'שלום', baseConfig],
  'crash/null-source': () => ['שלום', null, baseConfig],
  'crash/undefined-config': () => ['שלום', 'שלום', undefined],
  'crash/null-config': () => ['שלום', 'שלום', null],
  'crash/empty-config': () => ['שלום', 'שלום', {}],
  'crash/null-fields-config': () => ['שלום', 'שלום', {
    sourceCategory: null, targetBookName: null, ignoreShamInShas: null,
    diburHamatchilDelimiter: null, useAbbreviationExpansion: null,
    customAbbreviations: null, useFuzzyMatching: null, useWordWeighting: null,
  }],
  'crash/number-inputs': () => [12345, 67890, baseConfig],
  'crash/array-inputs': () => [['a', 'b'], ['c'], baseConfig],
  'crash/object-inputs': () => [{ a: 1 }, { b: 2 }, baseConfig],
  'crash/both-empty': () => ['', '', baseConfig],
  'crash/whitespace-only': () => ['   \n\n\t  ', '  \n ', baseConfig],
  'crash/custom-abbrev-null-values': () => ['א"א שלום', 'אי אפשר שלום', { ...baseConfig, customAbbreviations: { 'א"א': null } }],
  'crash/custom-abbrev-string-value': () => ['א"א שלום', 'אי אפשר שלום', { ...baseConfig, customAbbreviations: { 'א"א': 'אי אפשר' } }],
  'crash/custom-abbrev-not-object': () => ['א"א שלום', 'אי אפשר שלום', { ...baseConfig, customAbbreviations: 'nope' }],
  'crash/delimiter-regex-metachars': () => ['שלום (.*)+ עולם', 'שלום עולם', { ...baseConfig, diburHamatchilDelimiter: '(.*)+' }],
  'crash/delimiter-huge': () => ['שלום עולם', 'שלום עולם', { ...baseConfig, diburHamatchilDelimiter: 'א'.repeat(100000) }],
  'crash/rashi-only-no-source': () => ['רש"י ד"ה שלום', '', baseConfig, 'שלום עולם', undefined],
  'crash/secondary-null': () => ['רש"י ד"ה שלום', 'שלום', baseConfig, null, null],
  'crash/secondary-numbers': () => ['רש"י ד"ה שלום', 'שלום', baseConfig, 42, 43],
  'crash/links-malformed': () => ['רש"י ד"ה שלום', 'שלום', baseConfig, 'שלום עולם', 'שלום', [null, {}], 'notanarray'],
  'crash/config-getter-throws': () => ['שלום', 'שלום', new Proxy({ ...baseConfig }, {
    get(t: any, k) { if (k === 'gsReplacements') throw new Error('boom'); return t[k]; },
  })],
};
