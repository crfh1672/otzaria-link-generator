/**
 * Regenerates the optimised variant from whatever src/ currently holds.
 *
 * src/ is being edited by another agent while this work is in progress, so the variant is
 * never hand-maintained: it is derived, and every anchor must match EXACTLY ONCE. If the
 * upstream shape moves under an anchor the build aborts loudly rather than silently
 * producing a variant that differs from the control for reasons that have nothing to do
 * with the optimisation being measured.
 *
 *   node qa/perf/build-variant.mjs
 */
import fs from 'fs';
import crypto from 'crypto';
import path from 'path';

const ROOT = path.resolve(import.meta.dirname, '../..');
const OUT = path.join(ROOT, 'qa/perf');

const SRC = {
  abbr: 'src/data/abbreviations.ts',
  fuzzy: 'src/utils/fuzzyUtils.ts',
  parser: 'src/utils/parserAlgorithm.ts',
};

// Line endings are normalised on read: the other agent's rewrite left abbreviations.ts CRLF
// while the parser stayed LF, and anchors must not be sensitive to that.
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8').replace(/\r\n/g, '\n');
const md5 = s => crypto.createHash('md5').update(s).digest('hex');

/** Exactly-once replacement. Anything else is a build failure. */
function sub(text, find, replace, label) {
  const parts = text.split(find);
  if (parts.length !== 2) {
    console.error(`\n✘ anchor ${parts.length === 1 ? 'NOT FOUND' : `matched ${parts.length - 1}x`}: ${label}`);
    console.error(`  upstream changed shape under this patch — re-derive it before measuring.\n`);
    process.exit(1);
  }
  return parts[0] + replace + parts[1];
}

/**
 * Replace everything from `start` through the END of `end`, both unique.
 *
 * Used where the region carries long prose comments that upstream rewrites freely: pinning
 * the two structural boundaries survives comment churn, while still failing loudly if the
 * code shape itself moves.
 */
function subRange(text, start, end, replace, label) {
  const i = text.indexOf(start);
  const iLast = text.lastIndexOf(start);
  if (i === -1 || i !== iLast) {
    console.error(`\n✘ range START ${i === -1 ? 'NOT FOUND' : 'matched more than once'}: ${label}\n`);
    process.exit(1);
  }
  const j = text.indexOf(end, i);
  const jLast = text.lastIndexOf(end);
  if (j === -1 || j !== jLast) {
    console.error(`\n✘ range END ${j === -1 ? 'NOT FOUND' : 'matched more than once'}: ${label}\n`);
    process.exit(1);
  }
  return text.slice(0, i) + replace + text.slice(j + end.length);
}

// ─────────────────────────────────────────────────────────────────────────────────────────
// OPT-1 — memoised expansion plan
// ─────────────────────────────────────────────────────────────────────────────────────────
const PLAN_MACHINERY = `
/**
 * ── OPT-1 ────────────────────────────────────────────────────────────────────────────────
 * Per-source-text expansion plan.
 *
 * The scan below splits into two halves that depend on different things:
 *   • WHICH n-grams look like abbreviations and what the dictionary offers for them —
 *     a pure function of \`sourceText\` and the dictionaries, which are fixed across a scan.
 *   • WHICH of the offered options fits — the only half that depends on \`targetContext\`.
 *
 * The first half is the expensive one (five key spellings built and probed per n-gram) and
 * it was recomputed for every candidate line even though the phrase being expanded does not
 * change across a scan. The plan memoises exactly that half, per (idx, len) slot, LAZILY —
 * so the slots built are precisely the ones the inline code would have computed, no more.
 *
 * Why it stays valid though the scan rewrites \`words\` as it goes: on a match the loop sets
 * \`idx = endIdx\`, so it resumes strictly past every token it consumed and never re-reads a
 * cell it wrote. Slices therefore always come from untouched original tokens — which is why
 * the plan holds the ORIGINAL token array and every call clones it before writing.
 */
interface ExpansionSlot {
  /** The n-gram exactly as the inline code joined it — later code still reads this. */
  rawJoined: string;
  /**
   * Final value of the original lookup loop: \`undefined\` when nothing resolved, but
   * possibly an EMPTY array, which is truthy and suppresses the initials fallback exactly
   * as it does upstream.
   */
  options: string[] | undefined;
  /** Geresh/gershayim test — gates the de-quoted indexes and the initials fallback. */
  writtenAsAbbreviation: boolean;
}

interface ExpansionPlan {
  /** Original tokenisation. Never mutated. */
  words: string[];
  nonWsIndices: number[];
  /** slots[idx][len - 1] */
  slots: Array<Array<ExpansionSlot | undefined> | undefined>;
  dict: Record<string, string[]>;
  reps: Record<string, string[]> | undefined;
}

const EXPANSION_PLAN_LIMIT = 8192;
const expansionPlanCache = new Map<string, ExpansionPlan>();

function getExpansionPlan(
  sourceText: string,
  dict: Record<string, string[]>,
  reps: Record<string, string[]> | undefined
): ExpansionPlan {
  const hit = expansionPlanCache.get(sourceText);
  if (hit !== undefined && hit.dict === dict && hit.reps === reps) return hit;

  const words = sourceText.split(/(\\s+)/);
  const nonWsIndices: number[] = [];
  for (let i = 0; i < words.length; i++) {
    if (words[i].trim() !== '') nonWsIndices.push(i);
  }

  const plan: ExpansionPlan = {
    words,
    nonWsIndices,
    slots: new Array(nonWsIndices.length),
    dict,
    reps
  };
  if (expansionPlanCache.size >= EXPANSION_PLAN_LIMIT) expansionPlanCache.clear();
  expansionPlanCache.set(sourceText, plan);
  return plan;
}

/** The context-independent half of the loop body, memoised per slot. */
function getExpansionSlot(plan: ExpansionPlan, idx: number, len: number): ExpansionSlot {
  let row = plan.slots[idx];
  if (row === undefined) {
    row = new Array(3);
    plan.slots[idx] = row;
  }
  const cached = row[len - 1];
  if (cached !== undefined) return cached;

  const { words, nonWsIndices, dict, reps } = plan;
  const iStart = nonWsIndices[idx];
  const iEnd = nonWsIndices[idx + len - 1];

  const sliceWords = words.slice(iStart, iEnd + 1);
  const rawJoined = sliceWords.join('');
  const cleanedJoined = cleanAbbrKey(rawJoined);
  const noSpaceJoined = cleanedJoined.replace(/\\s+/g, '');
  const spaceJoined = sliceWords.map(w => cleanAbbrKey(w)).join(' ');
  const rawNoSpace = rawJoined.replace(/\\s+/g, '').replace(QUOTE_STRIP_RE, '');

  const lookupKeys = [
    rawJoined,
    cleanedJoined,
    noSpaceJoined,
    spaceJoined,
    rawNoSpace
  ];

  const writtenAsAbbreviation = QUOTE_GLYPHS_TEST_RE.test(rawJoined);

  let options: string[] | undefined;
  for (const k of lookupKeys) {
    if (!k) continue;
    options = dict[k]
      || (reps && reps[k])
      || NORMALIZED_REPLACEMENTS_MAP[k]
      || CANONICAL_ABBREVIATIONS_MAP[canonicalAbbrKey(k)];
    if (!options && writtenAsAbbreviation) options = NORMALIZED_ABBREVIATIONS_MAP[k];
    if (options && options.length > 0) break;
  }

  const slot: ExpansionSlot = { rawJoined, options, writtenAsAbbreviation };
  row[len - 1] = slot;
  return slot;
}

/**
 * Searches for potential abbreviation expansions that match words in the target text.`;

const ANCHOR_FN_DOC = `/**
 * Searches for potential abbreviation expansions that match words in the target text.`;

const ANCHOR_TOKENISE = `  // Split sourceText into words/tokens
  const words = sourceText.split(/(\\s+)/);

  const nonWsIndices: number[] = [];
  for (let i = 0; i < words.length; i++) {
    if (words[i].trim() !== '') {
      nonWsIndices.push(i);
    }
  }`;

const REPLACE_TOKENISE = `  // OPT-1: tokenisation comes from the memoised plan. The array is still cloned per call,
  // because the scan below rewrites it in place.
  const plan = getExpansionPlan(sourceText, dict, customReplacements);
  const words = plan.words.slice();
  const nonWsIndices = plan.nonWsIndices;`;

// Structural range: upstream rewrites the prose inside this block freely (BUG-07 notes, the
// canonical-geresh index), so the two boundaries are pinned rather than the whole text.
const ANCHOR_KEYS_START = `      const sliceWords = words.slice(iStart, iEnd + 1);`;
const ANCHOR_KEYS_END = `        if (options && options.length > 0) break;
      }`;

const REPLACE_KEYS = `      // OPT-1: the context-free half — the key spellings, the geresh test and the dictionary
      // probe — is memoised per (idx, len) instead of being rebuilt for every candidate line.
      const slot = getExpansionSlot(plan, idx, len);
      const rawJoined = slot.rawJoined;
      const options = slot.options;
      const writtenAsAbbreviation = slot.writtenAsAbbreviation;`;

// ─────────────────────────────────────────────────────────────────────────────────────────
// OPT-2 — prepared stems in the hot comparison loop
// ─────────────────────────────────────────────────────────────────────────────────────────
const ANCHOR_WEIGHTS = `      const sourceWeights = cappedSource.map(w => getCombinedWordWeight(w, enableWordWeighting, idfMap));`;

const REPLACE_WEIGHTS = `      const sourceWeights = cappedSource.map(w => getCombinedWordWeight(w, enableWordWeighting, idfMap));

      // OPT-2: a word's prefix-stripped stem is a pure function of the word, but was being
      // re-derived inside the innermost comparison — once per (anchor position × run step).
      // prepareStems / getWordSimilarityPrepared already exist in fuzzyUtils for exactly this
      // and are called from nowhere in the tree.
      const sourceStems = prepareStems(cappedSource);
      const targetStems = prepareStems(targetWords);`;

const ANCHOR_SIM = `            const sim = getWordSimilarity(w1, w2, enableFuzzy);
            if (sim <= 0) break;`;

const REPLACE_SIM = `            const sim = getWordSimilarityPrepared(
              w1, sourceStems[startWIdx + k],
              w2, targetStems[docWIdx + kt],
              enableFuzzy
            );
            if (sim <= 0) break;`;

const ANCHOR_FUZZY_IMPORT = `import { getWordSimilarity, getNikudFingerprint, levenshteinDistance } from './fuzzyUtils';`;
const REPLACE_FUZZY_IMPORT = `import { getWordSimilarity, getNikudFingerprint, levenshteinDistance, prepareStems, getWordSimilarityPrepared } from './fuzzyUtils.opt';`;

// ─────────────────────────────────────────────────────────────────────────────────────────
// build
// ─────────────────────────────────────────────────────────────────────────────────────────
const srcAbbr = read(SRC.abbr);
const srcFuzzy = read(SRC.fuzzy);
const srcParser = read(SRC.parser);

// Which optimisations to include, so each can be attributed on its own:
//   --opts=1,2 (default)   --opts=1   --opts=2   --opts=none
const optsArg = (process.argv.find(a => a.startsWith('--opts=')) || '--opts=1,2').slice(7);
const enabled = new Set(optsArg === 'none' ? [] : optsArg.split(','));
const OPT1 = enabled.has('1');
const OPT2 = enabled.has('2');

// --- abbreviations.opt.ts ---
let abbr = srcAbbr;
abbr = sub(abbr, `from './replacements'`, `from '../../src/data/replacements'`, 'abbr: replacements import');
if (OPT1) {
  abbr = sub(abbr, ANCHOR_FN_DOC, PLAN_MACHINERY, 'abbr: plan machinery insertion point');
  abbr = sub(abbr, ANCHOR_TOKENISE, REPLACE_TOKENISE, 'abbr: tokenisation block');
  abbr = subRange(abbr, ANCHOR_KEYS_START, ANCHOR_KEYS_END, REPLACE_KEYS, 'abbr: key-building + dictionary probe block');
}

// --- fuzzyUtils.opt.ts (verbatim) ---
const fuzzy = srcFuzzy;

// --- parserAlgorithm.opt.ts ---
let parser = srcParser;
parser = sub(parser, `from '../types'`, `from '../../src/types'`, 'parser: types import');
parser = sub(parser, `from '../data/abbreviations'`, `from './abbreviations.opt'`, 'parser: abbreviations import');
parser = sub(parser, ANCHOR_FUZZY_IMPORT, REPLACE_FUZZY_IMPORT, 'parser: fuzzyUtils import');
parser = sub(parser, `from './wordWeights'`, `from '../../src/utils/wordWeights'`, 'parser: wordWeights import');
if (OPT2) {
  parser = sub(parser, ANCHOR_WEIGHTS, REPLACE_WEIGHTS, 'parser: sourceWeights (prepareStems insertion)');
  parser = sub(parser, ANCHOR_SIM, REPLACE_SIM, 'parser: inner getWordSimilarity call');
}

// ─────────────────────────────────────────────────────────────────────────────────────────
// --write-src — promote OPT-1 into src/data/abbreviations.ts itself
// ─────────────────────────────────────────────────────────────────────────────────────────
// Applies the SAME two anchors that were measured, so what lands in src is byte-for-byte the
// patch that was verified — not a hand-retyped approximation of it.
//
// Two deliberate constraints, because this file is shared with another agent's work:
//   • only the two OPT-1 regions are touched; the other 55k lines are passed through
//     untouched, so the diff stays small and reviewable.
//   • the file's own line endings are preserved. It is CRLF; writing LF would rewrite every
//     line in the file and bury a real change inside a whole-file diff.
if (process.argv.includes('--write-src')) {
  if (!OPT1) {
    console.error('✘ --write-src is for OPT-1; OPT-2 measured at 0% and is not promoted.');
    process.exit(1);
  }

  const raw = fs.readFileSync(path.join(ROOT, SRC.abbr), 'utf8');
  const usesCRLF = raw.includes('\r\n');
  let out = raw.replace(/\r\n/g, '\n');

  // No import rewiring here — this IS src, its relative imports are already correct.
  out = sub(out, ANCHOR_FN_DOC, PLAN_MACHINERY, 'src: plan machinery insertion point');
  out = sub(out, ANCHOR_TOKENISE, REPLACE_TOKENISE, 'src: tokenisation block');
  out = subRange(out, ANCHOR_KEYS_START, ANCHOR_KEYS_END, REPLACE_KEYS, 'src: key-building + dictionary probe block');

  if (usesCRLF) out = out.replace(/\n/g, '\r\n');
  fs.writeFileSync(path.join(ROOT, SRC.abbr), out);

  console.log(`✔ OPT-1 applied to ${SRC.abbr} (${usesCRLF ? 'CRLF' : 'LF'} preserved)`);
  console.log('  the qa/perf variant above is the PRE-patch reference — diff src against it.');
  process.exit(0);
}

fs.writeFileSync(path.join(OUT, 'abbreviations.opt.ts'), abbr);
fs.writeFileSync(path.join(OUT, 'fuzzyUtils.opt.ts'), fuzzy);
fs.writeFileSync(path.join(OUT, 'parserAlgorithm.opt.ts'), parser);

// Hash the RAW bytes, not the newline-normalised text, so a drift check can compare against
// the file on disk directly.
const rawMd5 = f => md5(fs.readFileSync(path.join(ROOT, f)));
const stamp = {
  builtAt: new Date().toISOString(),
  sources: {
    [SRC.abbr]: rawMd5(SRC.abbr),
    [SRC.fuzzy]: rawMd5(SRC.fuzzy),
    [SRC.parser]: rawMd5(SRC.parser),
  },
};
fs.writeFileSync(path.join(OUT, 'SNAPSHOT.json'), JSON.stringify(stamp, null, 2));

console.log('✔ variant rebuilt from current src');
for (const [f, h] of Object.entries(stamp.sources)) console.log(`   ${h}  ${f}`);
