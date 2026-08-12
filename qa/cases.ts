/**
 * Shared case matrix for the parser regression / benchmark harness.
 *
 * Book texts are NOT stored in the repo (they are ~10MB extracted from the local
 * Otzaria seforim.db). Point QA_DATA at the directory holding the .txt dumps, or
 * regenerate them with `qa/extract-books.mjs`.
 */
import fs from 'fs';
import path from 'path';
import type { PluginConfig } from '../src/types';

const DATA_DIR = process.env.QA_DATA
  ? process.env.QA_DATA
  : path.join(process.cwd(), 'qa', 'data');

const cache = new Map<string, string>();

export function book(name: string): string {
  let t = cache.get(name);
  if (t === undefined) {
    t = fs.readFileSync(path.join(DATA_DIR, `${name}.txt`), 'utf8');
    cache.set(name, t);
  }
  return t;
}

/** Truncate a document to its first `n` header segments — keeps runs fast. */
export function firstSegments(text: string, n: number): string {
  const lines = text.split(/\r?\n/);
  const out: string[] = [];
  let seen = 0;
  for (const l of lines) {
    if (/^\s*<h2/i.test(l)) {
      seen++;
      if (seen > n) break;
    }
    out.push(l);
  }
  return out.join('\n');
}

/** Mirrors exactly what SetupMode.tsx:382 hands to runLinkingParser. */
const baseConfig: PluginConfig = {
  sourceCategory: 'shas',
  targetBookName: 'ברכות',
  ignoreShamInShas: true,
  diburHamatchilDelimiter: '',
  useAbbreviationExpansion: true,
  customAbbreviations: undefined,
  useFuzzyMatching: true,
  useWordWeighting: true,
};

/** The dictionary the real build ships in public/gs-dictionary.json. */
function gsDict(): { abbreviations?: Record<string, string[]>; replacements?: Record<string, string[]> } {
  const raw = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'public', 'gs-dictionary.json'), 'utf8'));
  return raw;
}

export interface Case {
  name: string;
  commentary: string;
  source: string;
  rashi?: string;
  tosafot?: string;
  config: PluginConfig;
  heavy?: boolean;
}

const cfg = (over: Partial<PluginConfig> & Record<string, unknown>): PluginConfig =>
  ({ ...baseConfig, ...over } as PluginConfig);

export function buildCases(): Case[] {
  const N = 12; // segments used by the fast cases

  const pyB = book('py_berachot');
  const gemB = book('gem_berachot');
  const rashiB = book('rashi_berachot');
  const tosB = book('tos_berachot');

  const pyS = book('py_shabbat');
  const gemS = book('gem_shabbat');
  const rashiS = book('rashi_shabbat');
  const tosS = book('tos_shabbat');

  const byB = book('benyehoyada_berachot');

  const smallB = {
    commentary: firstSegments(pyB, N),
    source: firstSegments(gemB, N),
    rashi: firstSegments(rashiB, N),
    tosafot: firstSegments(tosB, N),
  };

  return [
    // ── fast cases: config matrix over a 12-segment slice ───────────────────
    { name: 'py-berachot/default', ...smallB, config: cfg({}) },
    { name: 'py-berachot/no-fuzzy', ...smallB, config: cfg({ useFuzzyMatching: false }) },
    { name: 'py-berachot/no-abbrev', ...smallB, config: cfg({ useAbbreviationExpansion: false }) },
    { name: 'py-berachot/no-weighting', ...smallB, config: cfg({ useWordWeighting: false }) },
    { name: 'py-berachot/all-off', ...smallB, config: cfg({ useFuzzyMatching: false, useAbbreviationExpansion: false, useWordWeighting: false }) },
    { name: 'py-berachot/delimiter-vav', ...smallB, config: cfg({ diburHamatchilDelimiter: "וכו'" }) },
    { name: 'py-berachot/delimiter-akal', ...smallB, config: cfg({ diburHamatchilDelimiter: 'עכ"ל' }) },
    { name: 'py-berachot/inherit-sham', ...smallB, config: cfg({ inheritOnBareSham: true } as any) },
    { name: 'py-berachot/ignore-sham-off', ...smallB, config: cfg({ ignoreShamInShas: false }) },
    { name: 'py-berachot/gs-dictionary', ...smallB, config: cfg({ customAbbreviations: gsDict().abbreviations, gsAbbreviations: gsDict().abbreviations, gsReplacements: gsDict().replacements } as any) },
    { name: 'py-berachot/tanakh-category', ...smallB, config: cfg({ sourceCategory: 'tanakh' }) },
    { name: 'py-berachot/no-secondary', commentary: smallB.commentary, source: smallB.source, config: cfg({}) },
    { name: 'py-berachot/rashi-only', commentary: smallB.commentary, source: smallB.source, rashi: smallB.rashi, config: cfg({}) },

    // different commentary over the same masechta (different citation style)
    {
      name: 'benyehoyada-berachot/default',
      commentary: firstSegments(byB, N),
      source: firstSegments(gemB, N),
      rashi: firstSegments(rashiB, N),
      tosafot: firstSegments(tosB, N),
      config: cfg({}),
    },

    // different masechta
    {
      name: 'py-shabbat/default',
      commentary: firstSegments(pyS, N),
      source: firstSegments(gemS, N),
      rashi: firstSegments(rashiS, N),
      tosafot: firstSegments(tosS, N),
      config: cfg({ targetBookName: 'שבת' }),
    },

    // ── edge cases ──────────────────────────────────────────────────────────
    { name: 'edge/empty-commentary', commentary: '', source: firstSegments(gemB, 2), config: cfg({}) },
    { name: 'edge/empty-source', commentary: firstSegments(pyB, 2), source: '', config: cfg({}) },
    { name: 'edge/no-headers', commentary: firstSegments(pyB, 3).split('\n').filter(l => !/^<h/.test(l)).join('\n'), source: firstSegments(gemB, 3).split('\n').filter(l => !/^<h/.test(l)).join('\n'), config: cfg({}) },
    { name: 'edge/mismatched-headers', commentary: firstSegments(pyB, 3), source: firstSegments(gemS, 3), config: cfg({ targetBookName: 'שבת' }) },
    { name: 'edge/single-line', commentary: '<h2>דף ב.</h2>\nבמשנה מאימתי קורין את שמע בערבית', source: firstSegments(gemB, 2), config: cfg({}) },

    // ── heavy: the full real-world workload ─────────────────────────────────
    {
      name: 'FULL/py-berachot',
      commentary: pyB, source: gemB, rashi: rashiB, tosafot: tosB,
      config: cfg({}), heavy: true,
    },
    {
      name: 'FULL/py-shabbat',
      commentary: pyS, source: gemS, rashi: rashiS, tosafot: tosS,
      config: cfg({ targetBookName: 'שבת' }), heavy: true,
    },
  ];
}
