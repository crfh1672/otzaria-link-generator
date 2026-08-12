/**
 * DIAGNOSTIC (dev-only, not part of the build): why did specific commentary lines end up
 * with NO link at all?
 *
 * Reads the manually-curated failure corpus in "ללא קישור/<book>/", where each .txt holds
 *   line 1: "שורה מפרש ללא קישור (שורה N):"
 *   line 2: the commentary line
 *   "כותרת: <daf>"
 *   "--- מקור|רש"י|תוספות ---" followed by the line(s) it SHOULD have linked to.
 *
 * For each case it re-runs the routing/scoring decisions the parser makes and prints where
 * the pipeline lost the match.
 *
 *   node --import tsx qa/nolink-diag.ts "ספר 2"
 */
import fs from 'fs';
import path from 'path';
import {
  runLinkingParser, parseDocumentSegments, areHeadersMatching, normalizeText,
  stripSecondaryPrefix, extractDiburHamatchil, isHeaderLine
} from '../src/utils/parserAlgorithm';
import { getWordSimilarity } from '../src/utils/fuzzyUtils';
import { getCombinedWordWeight, calculateDocumentIdfWeights } from '../src/utils/wordWeights';
import { expandAbbreviationsInText, DEFAULT_ABBREVIATIONS } from '../src/data/abbreviations';
import { book } from './cases';
import type { PluginConfig } from '../src/types';

const BOOK_DIR = process.argv[2] || 'ספר 2';
const USE_GS = process.argv[3] !== 'nogs';

const SETS: Record<string, { c: string; name: string }> = {
  'ספר 1': { c: 'benyehoyada_berachot', name: 'ברכות' },
  'ספר 2': { c: 'py_berachot', name: 'ברכות' },
};
const S = SETS[BOOK_DIR];

const gs = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'public', 'gs-dictionary.json'), 'utf8'));

const config: PluginConfig = {
  sourceCategory: 'shas',
  targetBookName: S.name,
  ignoreShamInShas: true,
  diburHamatchilDelimiter: '',
  useAbbreviationExpansion: true,
  customAbbreviations: USE_GS ? gs.abbreviations : undefined,
  gsAbbreviations: USE_GS ? gs.abbreviations : undefined,
  gsReplacements: USE_GS ? gs.replacements : undefined,
  useFuzzyMatching: true,
  useWordWeighting: true,
} as any;

const commentary = book(S.c);
const source = book('gem_berachot');
const rashi = book('rashi_berachot');
const tosafot = book('tos_berachot');

const t0 = Date.now();
const res = runLinkingParser(commentary, source, config, rashi, tosafot);
console.log(`parser: ${res.links.length} links over ${res.commentaryLines.length} lines in ${((Date.now() - t0) / 1000).toFixed(1)}s\n`);

const linkByLine = new Map<number, any>();
for (const l of res.links) linkByLine.set(l.line_index_1, l);

const commDoc = parseDocumentSegments(commentary);
const srcDoc = parseDocumentSegments(source);
const rashiDoc = parseDocumentSegments(rashi);
const tosDoc = parseDocumentSegments(tosafot);

const idf = {
  gem: calculateDocumentIdfWeights(srcDoc.lines, commDoc.lines),
  rashi: calculateDocumentIdfWeights(rashiDoc.lines, commDoc.lines),
  tos: calculateDocumentIdfWeights(tosDoc.lines, commDoc.lines),
};

// ── replica of the parser's private scorer, for attribution only ────────────
const SHALLOW_ANCHOR_LIMIT = 3;
const DEEP_ANCHOR_MIN_RUN = 3;
function calcContiguousScore(
  sourceWords: string[], targetWords: string[], maxDhWords: number,
  idfMap: Record<string, number> | undefined, requireStartAtFirstWord: boolean
) {
  const maxStartIdx = Math.min(3, sourceWords.length);
  const capped = sourceWords.slice(0, maxDhWords);
  const weights = capped.map(w => getCombinedWordWeight(w, true, idfMap));
  const maxDocWIdx = requireStartAtFirstWord ? 1 : targetWords.length;
  let best = { score: 0, wordCount: 0, si: -1, di: -1 };
  for (let s = 0; s < maxStartIdx; s++) {
    for (let d = 0; d < maxDocWIdx; d++) {
      let k = 0, sc = 0;
      while (s + k < capped.length && d + k < targetWords.length) {
        const sim = getWordSimilarity(capped[s + k], targetWords[d + k], true);
        if (sim <= 0) break;
        sc += sim * weights[s + k];
        k++;
      }
      if (d >= SHALLOW_ANCHOR_LIMIT && k < DEEP_ANCHOR_MIN_RUN) continue;
      if (sc > best.score) best = { score: sc, wordCount: k, si: s, di: d };
    }
  }
  return best;
}
function computeDynamicMinThreshold(expectedWeight: number, wordCount: number, isExplicit: boolean, multiplier: number) {
  let fraction: number, floor: number;
  if (wordCount <= 2) { fraction = 0.55; floor = 0.4; }
  else if (wordCount <= 4) { fraction = 0.60; floor = 0.55; }
  else { fraction = 0.65; floor = 0.7; }
  if (!isExplicit) fraction += 0.05;
  return Math.min(1.5, Math.max(floor, expectedWeight * (fraction * (multiplier / 0.65))));
}

// ── load the failure corpus ────────────────────────────────────────────────
const dir = path.join(process.cwd(), 'ללא קישור', BOOK_DIR);
const files = fs.readdirSync(dir).filter(f => f.endsWith('.txt'));

interface Case { file: string; ci: number; comm: string; header: string; tgtKind: string; tgtText: string[]; }
const cases: Case[] = files.map(f => {
  const raw = fs.readFileSync(path.join(dir, f), 'utf8').split(/\r?\n/);
  const ci = Number(raw[0].match(/שורה\s+(\d+)/)?.[1]);
  const comm = raw[1] ?? '';
  const header = raw.find(l => l.startsWith('כותרת:'))?.replace('כותרת:', '').trim() ?? '';
  const mi = raw.findIndex(l => /^---\s*(מקור|רש"י|תוספות)\s*---$/.test(l.trim()));
  const kind = mi >= 0 ? raw[mi].replace(/-/g, '').trim() : '?';
  const tgtText = mi >= 0 ? raw.slice(mi + 1).filter(l => l.trim()) : [];
  return { file: f, ci, comm, header, tgtKind: kind, tgtText };
});

const DOCS: Record<string, { doc: typeof srcDoc; idf: Record<string, number>; label: string }> = {
  'מקור': { doc: srcDoc, idf: idf.gem, label: 'gemara' },
  'רש"י': { doc: rashiDoc, idf: idf.rashi, label: 'rashi' },
  'תוספות': { doc: tosDoc, idf: idf.tos, label: 'tosafot' },
};

const RASHI_RE = /^(?:ב?פ?י?ר?ש"?י|ברש"י|רשי)/;
const TOSAFOT_RE = /^(?:ב?תוס|ב?תו')/;
const GEM_RE = /^(?:בגמרא|גמרא|גמ'|פיסקא|בפיסקא)/;
const MISHNA_RE = /^(?:מתני'|מתניתין|מתניתן|במשנה|משנה)/;

const summary: any[] = [];

for (const c of cases.sort((a, b) => a.ci - b.ci)) {
  const link = linkByLine.get(c.ci);
  const D = DOCS[c.tgtKind];
  // locate the expected target line by its normalized text
  const wantNorm = normalizeText(c.tgtText[0] || '');
  let wantLine = -1;
  if (D && wantNorm) {
    for (let i = 0; i < D.doc.lines.length; i++) {
      const n = normalizeText(D.doc.lines[i]);
      if (n && (n === wantNorm || n.includes(wantNorm.slice(0, 60)) || wantNorm.includes(n.slice(0, 60)))) { wantLine = i + 1; break; }
    }
  }

  // replicate routing
  const trimmed = c.comm.trim();
  const npl = normalizeText(trimmed, false);
  const cleanedPrefix = npl.replace(/^(?:\d+[\.\)]|[ א-ת][\.\)]|\([^)]+\)|\[[^\]]+\]|[•\-\*])\s*/, '').trim();
  const stripped = cleanedPrefix.replace(/^(?:בגמרא|גמרא|גמ'|במשנה|משנה|מתניתין|מתניתן|מתני')\s*[:.\-]?\s*/i, '').trim();
  const lfk = stripped || cleanedPrefix || npl;
  const route = RASHI_RE.test(lfk) ? 'rashi' : TOSAFOT_RE.test(lfk) ? 'tosafot'
    : (GEM_RE.test(cleanedPrefix) || MISHNA_RE.test(cleanedPrefix)) ? 'primary-explicit' : 'primary-implicit';

  const lineForDh = stripSecondaryPrefix(trimmed);
  const lfde = lineForDh.trim() ? lineForDh : trimmed;
  const maxDh = route === 'tosafot' ? 7 : 12;
  const { cleanDh, isExplicitDelimiter } = extractDiburHamatchil(lfde, '', maxDh);
  const hasKoo = /(?:^|\s)ו?כו'(?:\s|$|[.,:;])/i.test(lfde) || /(?:^|\s)ו?כו'(?:\s|$|[.,:;])/i.test(trimmed);

  // segment resolution for this commentary line
  const commSeg = commDoc.segments.find(s => c.ci >= s.startLine && c.ci <= s.endLine);
  const tgtSeg = D && commSeg ? D.doc.segments.find(s => areHeadersMatching(commSeg.headerTitle, s.headerTitle)) : undefined;
  const inSeg = tgtSeg && wantLine >= tgtSeg.startLine && wantLine <= tgtSeg.endLine;

  // score the EXPECTED line the way searchLineInDoc would
  const searchWords = cleanDh.split(/\s+/).filter(Boolean);
  const fullWords = normalizeText(lfde).split(/\s+/).filter(Boolean);
  const src = isExplicitDelimiter ? searchWords : fullWords;
  const wordsForWeight = src;
  const expectedWeight = wordsForWeight.reduce((a, w) => a + getCombinedWordWeight(w, true, D?.idf), 0);
  const thr = computeDynamicMinThreshold(expectedWeight, wordsForWeight.length, isExplicitDelimiter, 0.65);

  let scored: any = null;
  if (D && wantLine > 0) {
    const tgtNorm = normalizeText(D.doc.lines[wantLine - 1]);
    const tgtWords = tgtNorm.split(/\s+/).filter(Boolean);
    const dict = (config.customAbbreviations || DEFAULT_ABBREVIATIONS) as any;
    const expSrc = normalizeText(expandAbbreviationsInText(lfde, tgtNorm, dict, (config as any).gsReplacements, 64)).split(/\s+/).filter(Boolean);
    const expTgt = normalizeText(expandAbbreviationsInText(tgtNorm, lfde, dict, (config as any).gsReplacements, 64)).split(/\s+/).filter(Boolean);
    const reqStart = route === 'rashi' || route === 'tosafot';
    const combos = [
      calcContiguousScore(src, tgtWords, maxDh, D.idf, reqStart),
      calcContiguousScore(expSrc, expTgt, maxDh, D.idf, reqStart),
      calcContiguousScore(src, expTgt, maxDh, D.idf, reqStart),
      calcContiguousScore(expSrc, tgtWords, maxDh, D.idf, reqStart),
    ];
    const bestC = combos.reduce((a, b) => (b.score > a.score ? b : a));
    const noAnchorCap = (() => {
      // same but with NO requireStartAtFirstWord and NO 3-word source cap → what's reachable
      const free = (sw: string[], tw: string[]) => {
        const weights = sw.map(w => getCombinedWordWeight(w, true, D.idf));
        let best = { score: 0, wordCount: 0, si: -1, di: -1 };
        for (let s = 0; s < sw.length; s++) for (let d = 0; d < tw.length; d++) {
          let k = 0, sc = 0;
          while (s + k < sw.length && d + k < tw.length) {
            const sim = getWordSimilarity(sw[s + k], tw[d + k], true);
            if (sim <= 0) break;
            sc += sim * weights[s + k]; k++;
          }
          if (sc > best.score) best = { score: sc, wordCount: k, si: s, di: d };
        }
        return best;
      };
      return free(src, tgtWords);
    })();
    scored = { bestC, noAnchorCap, tgtWords: tgtWords.slice(0, 14) };
  }

  console.log('='.repeat(100));
  console.log(`${c.file}  (commentary line ${c.ci}, header "${c.header}")`);
  console.log(`  route=${route}  expectedDoc=${D?.label ?? '?'}  expectedLine=${wantLine}  inMatchedSegment=${inSeg}`);
  console.log(`  linked=${Boolean(link)}${link ? ` → ${link.secondaryTarget || 'gemara'}:${link.line_index_2} conf=${link.confidence}` : ''}`);
  console.log(`  isExplicitDelim=${isExplicitDelimiter} hasKoo=${hasKoo} maxDhWords=${maxDh}`);
  console.log(`  cleanDh(${searchWords.length}w)= ${cleanDh.slice(0, 120)}`);
  console.log(`  srcWords[0..7] = ${src.slice(0, 8).join(' | ')}`);
  if (scored) {
    console.log(`  tgtWords[0..13]= ${scored.tgtWords.join(' | ')}`);
    console.log(`  expectedWeight=${expectedWeight.toFixed(2)} threshold=${thr.toFixed(2)}`);
    console.log(`  bestScore@expectedLine=${scored.bestC.score.toFixed(2)} (run=${scored.bestC.wordCount}w, srcIdx=${scored.bestC.si}, tgtIdx=${scored.bestC.di}) → ${scored.bestC.score >= thr ? 'PASSES' : 'BELOW THRESHOLD'}`);
    console.log(`  bestScore ignoring anchor caps=${scored.noAnchorCap.score.toFixed(2)} (run=${scored.noAnchorCap.wordCount}w, srcIdx=${scored.noAnchorCap.si}, tgtIdx=${scored.noAnchorCap.di})`);
  }
  summary.push({
    file: c.file, ci: c.ci, route, doc: D?.label, wantLine, inSeg, linked: Boolean(link),
    thr: +thr.toFixed(2),
    got: scored ? +scored.bestC.score.toFixed(2) : null,
    free: scored ? +scored.noAnchorCap.score.toFixed(2) : null,
    freeSrcIdx: scored ? scored.noAnchorCap.si : null,
    run: scored ? scored.bestC.wordCount : null,
    hasKoo, expl: isExplicitDelimiter,
  });
}

console.log('\n\n===== SUMMARY =====');
console.table(summary);
