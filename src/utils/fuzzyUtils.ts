/**
 * Utility functions for Fuzzy Matching with slight flexibility (גמישות קלה בלבד)
 * Gives priority to exact matches while allowing small typos / spelling variations.
 *
 * Also handles Hebrew morphological variation:
 *   - Stripping common prefix-letters (אותיות שימוש): ו/ב/ל/מ/ש/כ/ה
 *   - Nikud-fingerprint tie-breaking for source lines that carry full vowel marks
 */

// ── Hebrew prefix letters (אותיות שימוש) ──────────────────────────────────────
// These single letters are prepended to words and are NOT part of the root.
// Stripping them before comparison avoids misses like "בית" ≠ "לבית".
// Safety guard: only strip if the remaining stem is ≥ 3 chars (prevents over-stripping
// short words like "בן" → "ן").
const PREFIX_LETTER_RE = /^[ובלמשכה]+/;

/**
 * Perf note for the memo caches in this module.
 *
 * getWordSimilarity is called once per (commentary word, source word) pair for every
 * candidate line the search scans — tens of millions of times per book. Each call used to
 * run two regex replaces per word (prefix strip + ktiv skeleton), allocating a fresh string
 * every time, even though the words come from a vocabulary of a few tens of thousands that
 * repeats constantly. These maps are keyed on the word, are pure functions of it, and are
 * bounded: past the cap we stop inserting, which leaves the result correct and merely
 * uncached. Memoising the *word* transforms rather than the word *pair* is deliberate —
 * a pair cache has to build a composite key string on every call, which measured slower
 * than just recomputing.
 */
const WORD_CACHE_LIMIT = 200_000;

const stemCache = new Map<string, string>();

/**
 * Strips leading Hebrew prefix-letters (ו/ב/ל/מ/ש/כ/ה) from a word,
 * provided the resulting stem is at least 3 characters long.
 */
export function stripHebrewPrefixes(word: string): string {
  if (!word) return word;
  const hit = stemCache.get(word);
  if (hit !== undefined) return hit;
  const stem = word.replace(PREFIX_LETTER_RE, '');
  const out = stem.length >= 3 ? stem : word;
  if (stemCache.size < WORD_CACHE_LIMIT) stemCache.set(word, out);
  return out;
}

// ── Nikud fingerprint (for source lines that carry vowel marks) ────────────────
// Maps each nikud character to a compact category letter so that two words that
// look identical without nikud but have different vowel patterns score differently.
//   קמץ/פתח   → 'a'   (open/low vowels)
//   צירי/סגול → 'e'   (front vowels)
//   חירק      → 'i'   (high front)
//   חולם/שורוק/קובוץ → 'o' (round/back vowels)
//   שווא/חטפים → 's'  (reduced / shva)
const NIKUD_CATEGORY: Record<string, string> = {
  '\u05B7': 'a', // פתח
  '\u05B8': 'a', // קמץ
  '\u05B0': 's', // שווא
  '\u05B1': 's', // חטף-סגול
  '\u05B2': 's', // חטף-פתח
  '\u05B3': 's', // חטף-קמץ
  '\u05B4': 'i', // חירק
  '\u05B5': 'e', // צירי
  '\u05B6': 'e', // סגול
  '\u05B9': 'o', // חולם
  '\u05BA': 'o', // חולם מלא
  '\u05BB': 'o', // שורוק/קובוץ
  '\u05BC': '',  // דגש — ignored (not a vowel)
  '\u05BD': '',  // מטג — ignored
};

/**
 * Extracts a compact vowel-pattern string from a nikud-bearing Hebrew word.
 * Example: "שְׁמַע" → "sa"   "שָׁמַר" → "aa"   "וַיֹּאמֶר" → "aoe"
 * Returns an empty string for words that carry no nikud (e.g. commentary words).
 */
const fingerprintCache = new Map<string, string>();

export function getNikudFingerprint(word: string): string {
  const hit = fingerprintCache.get(word);
  if (hit !== undefined) return hit;
  let fp = '';
  for (const ch of word) {
    const cat = NIKUD_CATEGORY[ch];
    if (cat !== undefined) fp += cat;
  }
  if (fingerprintCache.size < WORD_CACHE_LIMIT) fingerprintCache.set(word, fp);
  return fp;
}

/**
 * Strips ktiv-malei vowel-letters (ו / י) to get the consonantal "skeleton"
 * of a word, for bridging full (מלא) vs. deficient (חסר) spelling variants
 * like מצווה/מצוה, כהן/כוהן, עניין/ענין.
 *
 * The skeleton also neutralises the two WORD-FINAL letter alternations that carry no
 * difference of meaning in this corpus. They are not misspellings — they are how the same
 * word is written in different places, and a matcher that treats them as different letters
 * simply cannot see through them:
 *
 *   • final א ↔ ה — the Aramaic ending: פומא/פומיה, מרגלא/מרגלה, מילתא/מילתה. Real case:
 *     the commentary quotes "מרגלא בפומא דרב" and the Gemara reads "מַרְגְּלָא בְּפוּמֵּיהּ דְּרַב".
 *     The stems פומא/פומיה are two edits apart, which the fuzzy layer rejects for a word
 *     this short, and the ו/י-only skeleton gave פמא ≠ פמה — so the run died on word two of
 *     a phrase whose first word appears in 5 lines out of 2875.
 *   • final ן ↔ ם — the Aramaic plural against the Hebrew one: יושבין/יושבים,
 *     מברכין/מברכים, פטורין/פטורים. Pervasive in Talmudic text and its commentaries.
 *
 * Applied only at the END of the skeleton, after the ו/י strip, so an interior א/ה/ן/ם is
 * untouched (an interior ן or ם cannot occur anyway — final forms are word-final by
 * definition). Both members map to one representative, so the relation stays symmetric.
 *
 * MINIMUM LENGTH 3 — this is load-bearing, not a tuning knob. On a two-letter skeleton the
 * final letter IS most of the word, so collapsing it merges words that share nothing but a
 * single opening letter. Without the guard the corpus's two commonest words become
 * indistinguishable: לא ("not") and לה ("to her") both reduce to לה and score 0.90, and with
 * them בן/בם, דן/דם, מן/מם, קן/קם, אן/אם. A run that should break at לא would sail through
 * לה instead — the exact failure this whole mechanism exists to prevent, inverted.
 *
 * Three is enough for every pair the rule is meant to bridge, because the ו/י strip runs
 * first and the endings in question sit on real stems: פומא/פומיה → פמה, מרגלא/מרגלה → מרגלה,
 * יושבין/יושבים → שבם, מברכין/מברכים → מברכם. Only two-letter residues are excluded, and the
 * Aramaic/Hebrew alternation carries no information at that size anyway.
 */
const skeletonCache = new Map<string, string>();

/** Below this many consonants the final letter dominates the word — see the note above. */
const FINAL_LETTER_EQUIV_MIN_LEN = 3;

function ktivSkeleton(word: string): string {
  const hit = skeletonCache.get(word);
  if (hit !== undefined) return hit;
  let out = word.replace(/[וי]/g, '');
  if (out.length >= FINAL_LETTER_EQUIV_MIN_LEN) {
    // word-final alternations → single representative
    out = out.replace(/א$/, 'ה').replace(/ן$/, 'ם');
  }
  if (skeletonCache.size < WORD_CACHE_LIMIT) skeletonCache.set(word, out);
  return out;
}

/**
 * True if two words are plausibly the same word differing only by
 * ktiv-malei / ktiv-chaser spelling (ו/י insertions).
 */
export function isKtivVariant(w1: string, w2: string): boolean {
  if (w1 === w2) return false;
  // Length gate first. It is one of the three ANDed conditions below, it depends only on the
  // inputs, and it rejects the large majority of pairs — so testing it before building the
  // skeletons skips that work without changing which pairs are accepted.
  if (Math.abs(w1.length - w2.length) > 2) return false;
  const skel1 = ktivSkeleton(w1);
  const skel2 = ktivSkeleton(w2);
  return skel1.length >= 2 && skel1 === skel2;
}

/**
 * Computes Levenshtein edit distance between two strings
 */
// Reusable DP row buffers. The original allocated one array per matrix row (plus a fresh
// starting row) on every call; at tens of millions of calls per book that allocation, not
// the arithmetic, was the cost. Two module-level buffers are enough because the algorithm
// only ever needs the previous and current row, and they are swapped rather than copied.
// Safe as shared state: JS is single-threaded here and this function makes no calls that
// could re-enter it.
let levPrevRow = new Int32Array(64);
let levCurrRow = new Int32Array(64);

export function levenshteinDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;

  const lenA = a.length;
  const lenB = b.length;

  if (Math.abs(lenA - lenB) > 2) return Math.abs(lenA - lenB);

  if (levPrevRow.length < lenB + 1) {
    const size = lenB + 1;
    levPrevRow = new Int32Array(size);
    levCurrRow = new Int32Array(size);
  }

  let prev = levPrevRow;
  let curr = levCurrRow;

  for (let j = 0; j <= lenB; j++) prev[j] = j;

  for (let i = 1; i <= lenA; i++) {
    curr[0] = i;
    // charCodeAt avoids materialising a one-character string per comparison; for the code
    // units string indexing yields, it is an exact equivalent of `a[i - 1] === b[j - 1]`.
    const ca = a.charCodeAt(i - 1);
    for (let j = 1; j <= lenB; j++) {
      const cost = ca === b.charCodeAt(j - 1) ? 0 : 1;
      let min = prev[j] + 1;              // deletion
      const insertion = curr[j - 1] + 1;  // insertion
      if (insertion < min) min = insertion;
      const substitution = prev[j - 1] + cost;
      if (substitution < min) min = substitution;
      curr[j] = min;
    }
    const swap = prev;
    prev = curr;
    curr = swap;
  }

  return prev[lenB];
}

/**
 * Calculates word similarity score between 0.0 and 1.0.
 * - Exact match: 1.0
 * - Stem match (after stripping Hebrew prefix-letters): 0.92
 * - Slight fuzzy match on stems: 0.75–0.95 depending on distance/length
 * - No match / too loose: 0.0
 *
 * Rules for "slight flexibility" (גמישות קלה בלבד):
 * 1. Short words (length <= 3 Hebrew chars): MUST match exactly.
 * 2. Medium words (length 4..6 chars): Max edit distance = 1.
 * 3. Long words (length >= 7 chars): Max edit distance = 2.
 *
 * Morphological layer (prefix stripping):
 * Before fuzzy comparison, both words are stripped of leading prefix-letters
 * (ו/ב/ל/מ/ש/כ/ה). A stem-level exact match scores 0.92 (slightly below a full
 * exact match but well above a fuzzy match) to reward finding the same root word
 * regardless of the prepended preposition/conjunction.
 */
export function getWordSimilarity(w1: string, w2: string, enableFuzzy: boolean = true): number {
  if (w1 === w2) return 1.0;
  if (!enableFuzzy) return 0;

  // ── Layer 1: stem-level exact match ──────────────────────────────────────────
  // Strip prefix-letters from both sides and compare roots.
  // "לבית" vs "בית" → stem1="בית" stem2="בית" → 0.92
  return similarityOfStems(w1, stripHebrewPrefixes(w1), w2, stripHebrewPrefixes(w2));
}

/**
 * Stems for a whole word list, in one pass.
 *
 * The scorer compares every word of a commentary phrase against every word of a candidate
 * source line, so each individual word's stem gets asked for dozens of times per line. Doing
 * that lookup inside the pair comparison made stem/skeleton retrieval one of the largest
 * single costs in the profile. Callers that scan a list should prepare it once and use
 * {@link getWordSimilarityPrepared}; the result is identical, since the stem is a pure
 * function of the word.
 */
export function prepareStems(words: string[]): string[] {
  const out = new Array<string>(words.length);
  for (let i = 0; i < words.length; i++) out[i] = stripHebrewPrefixes(words[i]);
  return out;
}

/**
 * Same comparison as {@link getWordSimilarity}, for callers that already hold both stems
 * (see {@link prepareStems}). `stem1`/`stem2` MUST be `stripHebrewPrefixes` of `w1`/`w2` —
 * passing anything else changes the result.
 */
export function getWordSimilarityPrepared(
  w1: string,
  stem1: string,
  w2: string,
  stem2: string,
  enableFuzzy: boolean = true
): number {
  if (w1 === w2) return 1.0;
  if (!enableFuzzy) return 0;
  return similarityOfStems(w1, stem1, w2, stem2);
}

/** Layers 1 through 2, shared by both entry points above. */
function similarityOfStems(w1: string, stem1: string, w2: string, stem2: string): number {
  if (stem1 === stem2 && stem1 !== w1 || stem1 === stem2 && stem2 !== w2) {
    // At least one side had a prefix stripped → root match
    return 0.92;
  }

  const s1 = stem1;
  const s2 = stem2;

  const minLen = Math.min(s1.length, s2.length);
  const maxLen = Math.max(s1.length, s2.length);
  const diffLen = maxLen - minLen;

  // Stems more than two characters apart in length can reach neither remaining layer:
  // isKtivVariant requires a length gap of at most 2, and the fuzzy layer below rejects
  // diffLen > 2 outright. Testing it up front skips both. (The `minLen <= 3` rule is NOT
  // hoisted with it — a short stem can still be a legitimate ktiv-malei variant, which the
  // ktiv layer is meant to catch before the length-based fuzzy rules apply.)
  if (diffLen > 2) return 0;

  // ── Layer 1.5: Ktiv Malei / Chaser match ─────────────────────────────────────
  if (isKtivVariant(stem1, stem2)) {
    return 0.9;
  }

  // ── Layer 2: fuzzy match (Levenshtein) ───────────────────────────────────────
  // Work on the stripped stems so that prefix differences don't inflate distance.

  // Short stems (<=3) must match exactly
  if (minLen <= 3) return 0;

  const dist = levenshteinDistance(s1, s2);
  const maxAllowedDist = minLen >= 7 ? 2 : 1;

  if (dist <= maxAllowedDist) {
    const sim = 1 - dist / maxLen;
    return sim >= 0.75 ? sim : 0;
  }

  return 0;
}
