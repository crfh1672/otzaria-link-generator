/**
 * QA stress: memory growth across repeated runLinkingParser calls in one process.
 *
 *   node --max-old-space-size=8192 --expose-gc --import tsx qa/stress/memory.ts [rounds]
 *
 * Alternates books / configs so the module-level caches see a varied key stream.
 */
import { runLinkingParser } from '../../src/utils/parserAlgorithm';
import { book, firstSegments } from '../cases';
import type { PluginConfig } from '../../src/types';

const ROUNDS = Number(process.argv[2] || 6);
const N = Number(process.env.QA_SEG || 10);

const gc = () => {
  const g = (global as any).gc;
  if (!g) throw new Error('run with --expose-gc');
  for (let i = 0; i < 4; i++) g();
};

const MB = (n: number) => (n / 1024 / 1024).toFixed(1);

function sample(label: string) {
  gc();
  const m = process.memoryUsage();
  console.log(
    `${label.padEnd(38)} heap=${MB(m.heapUsed).padStart(8)}MB  rss=${MB(m.rss).padStart(8)}MB  ext=${MB(m.external).padStart(7)}MB`
  );
  return m;
}

const base: PluginConfig = {
  sourceCategory: 'shas',
  targetBookName: 'ברכות',
  ignoreShamInShas: true,
  diburHamatchilDelimiter: '',
  useAbbreviationExpansion: true,
  customAbbreviations: undefined,
  useFuzzyMatching: true,
  useWordWeighting: true,
};

const berachot = {
  commentary: firstSegments(book('py_berachot'), N),
  source: firstSegments(book('gem_berachot'), N),
  rashi: firstSegments(book('rashi_berachot'), N),
  tosafot: firstSegments(book('tos_berachot'), N),
  config: { ...base },
};
const shabbat = {
  commentary: firstSegments(book('py_shabbat'), N),
  source: firstSegments(book('gem_shabbat'), N),
  rashi: firstSegments(book('rashi_shabbat'), N),
  tosafot: firstSegments(book('tos_shabbat'), N),
  config: { ...base, targetBookName: 'שבת' },
};
const byB = {
  commentary: firstSegments(book('benyehoyada_berachot'), N),
  source: firstSegments(book('gem_berachot'), N),
  rashi: firstSegments(book('rashi_berachot'), N),
  tosafot: firstSegments(book('tos_berachot'), N),
  config: { ...base },
};

const variants = [
  { name: 'berachot/default', c: berachot },
  { name: 'shabbat/default', c: shabbat },
  { name: 'benyehoyada/default', c: byB },
  { name: 'berachot/no-fuzzy', c: { ...berachot, config: { ...base, useFuzzyMatching: false } } },
  { name: 'shabbat/no-abbrev', c: { ...shabbat, config: { ...base, targetBookName: 'שבת', useAbbreviationExpansion: false } } },
];

console.log(`rounds=${ROUNDS} segments=${N}`);
const baseline = sample('AFTER LOAD (books in cases cache)');

const series: number[] = [];
for (let r = 0; r < ROUNDS; r++) {
  for (const v of variants) {
    const t0 = Date.now();
    const res = runLinkingParser(v.c.commentary, v.c.source, v.c.config as PluginConfig, v.c.rashi, v.c.tosafot);
    const ms = Date.now() - t0;
    void res.links.length;
  }
  const m = sample(`after round ${r + 1}`);
  series.push(m.heapUsed);
}

console.log('\n── cache sizes at steady state ──');
// Re-import the modules to read the private caches indirectly via a probe.
import('../../src/data/abbreviations').then(async () => {
  const growth = series[series.length - 1] - series[0];
  console.log(`heap round1 -> round${ROUNDS}: ${MB(series[0])}MB -> ${MB(series[series.length - 1])}MB  (delta ${MB(growth)}MB)`);
  console.log(`retained over post-load baseline: ${MB(series[series.length - 1] - baseline.heapUsed)}MB`);
});
