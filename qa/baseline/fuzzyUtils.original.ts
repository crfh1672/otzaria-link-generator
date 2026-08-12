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
 * Strips leading Hebrew prefix-letters (ו/ב/ל/מ/ש/כ/ה) from a word,
 * provided the resulting stem is at least 3 characters long.
 */
export function stripHebrewPrefixes(word: string): string {
  if (!word) return word;
  const stem = word.replace(PREFIX_LETTER_RE, '');
  return stem.length >= 3 ? stem : word;
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
export function getNikudFingerprint(word: string): string {
  let fp = '';
  for (const ch of word) {
    const cat = NIKUD_CATEGORY[ch];
    if (cat !== undefined) fp += cat;
  }
  return fp;
}

/**
 * Strips ktiv-malei vowel-letters (ו / י) to get the consonantal "skeleton"
 * of a word, for bridging full (מלא) vs. deficient (חסר) spelling variants
 * like מצווה/מצוה, כהן/כוהן, עניין/ענין.
 */
function ktivSkeleton(word: string): string {
  return word.replace(/[וי]/g, '');
}

/**
 * True if two words are plausibly the same word differing only by
 * ktiv-malei / ktiv-chaser spelling (ו/י insertions).
 */
export function isKtivVariant(w1: string, w2: string): boolean {
  if (w1 === w2) return false;
  const skel1 = ktivSkeleton(w1);
  const skel2 = ktivSkeleton(w2);
  return skel1.length >= 2 && skel1 === skel2 && Math.abs(w1.length - w2.length) <= 2;
}

/**
 * Computes Levenshtein edit distance between two strings
 */
export function levenshteinDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;

  const lenA = a.length;
  const lenB = b.length;

  if (Math.abs(lenA - lenB) > 2) return Math.abs(lenA - lenB);

  let row = Array.from({ length: lenB + 1 }, (_, i) => i);
  for (let i = 1; i <= lenA; i++) {
    const nextRow = [i];
    for (let j = 1; j <= lenB; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      nextRow[j] = Math.min(
        row[j] + 1,        // deletion
        nextRow[j - 1] + 1,  // insertion
        row[j - 1] + cost   // substitution
      );
    }
    row = nextRow;
  }
  return row[lenB];
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
  const stem1 = stripHebrewPrefixes(w1);
  const stem2 = stripHebrewPrefixes(w2);
  if (stem1 === stem2 && stem1 !== w1 || stem1 === stem2 && stem2 !== w2) {
    // At least one side had a prefix stripped → root match
    return 0.92;
  }

  // ── Layer 1.5: Ktiv Malei / Chaser match ─────────────────────────────────────
  if (isKtivVariant(stem1, stem2)) {
    return 0.9;
  }

  // ── Layer 2: fuzzy match (Levenshtein) ───────────────────────────────────────
  // Work on the stripped stems so that prefix differences don't inflate distance.
  const s1 = stem1;
  const s2 = stem2;

  const minLen = Math.min(s1.length, s2.length);
  const maxLen = Math.max(s1.length, s2.length);

  // Short stems (<=3) must match exactly
  if (minLen <= 3) return 0;

  const diffLen = maxLen - minLen;
  if (diffLen > 2) return 0;

  const dist = levenshteinDistance(s1, s2);
  const maxAllowedDist = minLen >= 7 ? 2 : 1;

  if (dist <= maxAllowedDist) {
    const sim = 1 - dist / maxLen;
    return sim >= 0.75 ? sim : 0;
  }

  return 0;
}
