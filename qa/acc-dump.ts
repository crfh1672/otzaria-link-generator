/**
 * ACCURACY QA — dump full parser output + resolved source text for offline judging.
 *   node --max-old-space-size=8192 --import tsx qa/acc-dump.ts <caseName> <segments|full> <outfile>
 */
import fs from 'fs';
import { runLinkingParser, isHeaderLine, parseDocumentSegments, areHeadersMatching } from '../src/utils/parserAlgorithm';
import { book, firstSegments } from './cases';
import type { PluginConfig } from '../src/types';

const [which = 'py-berachot', segArg = '40', out = 'acc.json'] = process.argv.slice(2);
const N = segArg === 'full' ? 0 : Number(segArg);
const cut = (t: string) => (N ? firstSegments(t, N) : t);

const SETS: Record<string, { c: string; s: string; r: string; t: string; name: string }> = {
  'py-berachot': { c: 'py_berachot', s: 'gem_berachot', r: 'rashi_berachot', t: 'tos_berachot', name: 'ברכות' },
  'py-shabbat': { c: 'py_shabbat', s: 'gem_shabbat', r: 'rashi_shabbat', t: 'tos_shabbat', name: 'שבת' },
  'by-berachot': { c: 'benyehoyada_berachot', s: 'gem_berachot', r: 'rashi_berachot', t: 'tos_berachot', name: 'ברכות' },
};
const S = SETS[which];

const config: PluginConfig = {
  sourceCategory: 'shas',
  targetBookName: S.name,
  ignoreShamInShas: true,
  diburHamatchilDelimiter: '',
  useAbbreviationExpansion: true,
  customAbbreviations: undefined,
  useFuzzyMatching: true,
  useWordWeighting: true,
};

const commentary = cut(book(S.c));
const source = cut(book(S.s));
const rashi = cut(book(S.r));
const tosafot = cut(book(S.t));

const t0 = Date.now();
const res = runLinkingParser(commentary, source, config, rashi, tosafot);
const ms = Date.now() - t0;

// Re-derive segment structure so we can attribute every commentary line to its page header.
const commDoc = parseDocumentSegments(commentary);
const srcDoc = parseDocumentSegments(source);
const rashiDoc = parseDocumentSegments(rashi);
const tosDoc = parseDocumentSegments(tosafot);

const lineToSeg: Record<number, string> = {};
const segHasSrc: Record<string, boolean> = {};
for (const seg of commDoc.segments) {
  const srcSeg = srcDoc.segments.find(s => areHeadersMatching(seg.headerTitle, s.headerTitle));
  const rSeg = rashiDoc.segments.find(s => areHeadersMatching(seg.headerTitle, s.headerTitle));
  const tSeg = tosDoc.segments.find(s => areHeadersMatching(seg.headerTitle, s.headerTitle));
  segHasSrc[seg.headerTitle] = Boolean(srcSeg);
  for (let i = seg.startLine; i <= seg.endLine; i++) {
    lineToSeg[i] = seg.headerTitle;
  }
  (segHasSrc as any)['__r__' + seg.headerTitle] = Boolean(rSeg);
  (segHasSrc as any)['__t__' + seg.headerTitle] = Boolean(tSeg);
}

const linkByLine = new Map<number, any>();
for (const l of res.links) linkByLine.set(l.line_index_1, l);

const rows: any[] = [];
for (let i = 1; i <= res.commentaryLines.length; i++) {
  const raw = res.commentaryLines[i - 1];
  if (!raw || isHeaderLine(raw) || !raw.trim()) continue;
  const l = linkByLine.get(i);
  let targetText = '';
  let targetBook = '';
  if (l) {
    if (l.secondaryTarget === 'rashi') { targetBook = 'rashi'; targetText = res.rashiLines?.[l.line_index_2 - 1] ?? ''; }
    else if (l.secondaryTarget === 'tosafot') { targetBook = 'tosafot'; targetText = res.tosafotLines?.[l.line_index_2 - 1] ?? ''; }
    else { targetBook = 'gemara'; targetText = res.sourceLines[l.line_index_2 - 1] ?? ''; }
  }
  rows.push({
    ci: i,
    seg: lineToSeg[i] ?? '?',
    hasSrcSeg: segHasSrc[lineToSeg[i]] ?? false,
    comm: raw.trim(),
    linked: Boolean(l),
    tgt: l ? l.line_index_2 : null,
    tgtBook: targetBook,
    tgtText: targetText.trim(),
    conf: l?.confidence ?? null,
    st: l?.status ?? null,
    inh: Boolean(l?.isInherited),
    dh: l?.dhText ?? null,
    mr: l?.matchRange ?? null,
    nCand: l?.candidates?.length ?? 0,
  });
}

const meta = {
  which, segArg, ms,
  nCommLines: res.commentaryLines.length,
  nContentLines: rows.length,
  nLinks: res.links.length,
  nCommSegs: commDoc.segments.length,
  nSrcSegs: srcDoc.segments.length,
  nRashiSegs: rashiDoc.segments.length,
  nTosSegs: tosDoc.segments.length,
  commSegTitles: commDoc.segments.map(s => s.headerTitle),
  srcSegTitles: srcDoc.segments.map(s => s.headerTitle),
  unmatchedCommSegs: commDoc.segments.filter(s => !srcDoc.segments.some(x => areHeadersMatching(s.headerTitle, x.headerTitle))).map(s => s.headerTitle),
  unmatchedRashiSegs: commDoc.segments.filter(s => !rashiDoc.segments.some(x => areHeadersMatching(s.headerTitle, x.headerTitle))).map(s => s.headerTitle),
  unmatchedTosSegs: commDoc.segments.filter(s => !tosDoc.segments.some(x => areHeadersMatching(s.headerTitle, x.headerTitle))).map(s => s.headerTitle),
};

fs.writeFileSync(out, JSON.stringify({ meta, rows }), 'utf8');
console.log(JSON.stringify(meta, (k, v) => (Array.isArray(v) && v.length > 8 ? `[${v.length}]` : v), 1));
console.log('rows', rows.length, 'links', res.links.length, `${(ms / 1000).toFixed(1)}s`);
