/**
 * Utility functions for Word Weighting and Stop-Words Filtering (TF-IDF & Preposition Weighting).
 * Specifically tuned for Rabbinic Hebrew (תנא, אמורא, תלמוד, מפרשים, תנ"ך).
 */

/**
 * High frequency Hebrew prepositions, pronouns, conjunctions, and fillers (מילות יחס, קישור ושכיחות גבוהה).
 * Given a reduced weight (e.g. 0.35) so that unique content words dictate matching precision.
 */
export const HEBREW_STOP_WORDS = new Set([
  'של', 'על', 'את', 'אל', 'מן', 'עם', 'בי', 'לי', 'לו', 'לה', 'לנו', 'להם', 'להן',
  'בו', 'בה', 'בנו', 'בהם', 'עליו', 'עליה', 'עליהם', 'עלינו', 'אצלו', 'אצלה', 'בתוך', 'מתוך',
  'מאחר', 'אחר', 'לפני', 'אחרי', 'בין', 'כמו', 'כפי', 'לפי', 'מפני', 'עקב', 'בגלל',
  'למען', 'בעבור', 'אם', 'כי', 'זה', 'זו', 'אלה', 'אלו', 'אשר', 'כל', 'מה', 'מי',
  'הוא', 'היא', 'הם', 'הן', 'אלא', 'אפילו', 'עד', 'אבל', 'כך', 'כאן', 'הכא', 'התם',
  'היה', 'היו', 'יהיה', 'יהיו', 'אמר', 'אמרו', 'אמרת', 'אמרתי', 'נאמר', 'אומר',
  'אומרים', 'שם', 'כו', 'וכו', 'וגו', 'וגומר', 'דהיינו', 'פירוש', 'פירש', 'רב', 'רבי',
  'ר\'', 'בן', 'בר', 'בת', 'לא', 'כן', 'גם', 'אי', 'או', 'אינו', 'אינה', 'אינם',
  'יש', 'אין', 'הנה', 'כבר', 'עוד', 'שוב', 'רק', 'אולי', 'ממש', 'כמעט'
]);

/**
 * Calculates a static weight for a normalized Hebrew word.
 * - Stop words / prepositions: 0.35 (prevents false positives on common phrases)
 * - Short generic words (length <= 2): 0.45
 * - Normal content words (length 3..5): 1.00
 * - Distinct / rare content words (length >= 6): 1.25
 */
export function getHebrewWordWeight(word: string, enableWeighting: boolean = true): number {
  if (!enableWeighting || !word) return 1.0;

  const clean = word.replace(/[\u0591-\u05C7"'״׳]/g, '').trim();
  if (!clean) return 1.0;

  if (HEBREW_STOP_WORDS.has(clean)) {
    return 0.35;
  }

  if (clean.length <= 2) {
    return 0.45;
  }

  if (clean.length >= 6) {
    return 1.25;
  }

  return 1.0;
}

/**
 * Calculates document-wide word frequency weights (IDF factor) across source lines and commentary lines.
 * Words appearing in many lines get lower weights; rare terms in the document get higher weights.
 */
export function calculateDocumentIdfWeights(docLines: string[], commentaryLines?: string[]): Record<string, number> {
  const allLines = [...docLines, ...(commentaryLines || [])];
  const lineCount = allLines.length;
  if (lineCount === 0) return {};

  const docFreq: Record<string, number> = {};
  allLines.forEach(line => {
    if (!line) return;
    const norm = line.replace(/[\u0591-\u05C7]/g, '').replace(/[^\u05D0-\u05EA0-9\s]+/g, ' ');
    const uniqueWordsInLine = new Set(norm.split(/\s+/).filter(Boolean));
    uniqueWordsInLine.forEach(w => {
      docFreq[w] = (docFreq[w] || 0) + 1;
    });
  });

  const idfWeights: Record<string, number> = {};
  Object.entries(docFreq).forEach(([word, freq]) => {
    const ratio = freq / lineCount;
    if (ratio > 0.08) {
      // Frequent in document (>8% of lines) -> downweight
      idfWeights[word] = Math.max(0.35, 1 - ratio * 2);
    } else if (ratio < 0.01) {
      // Rare term in document (<1% of lines) -> boost up to 1.5
      idfWeights[word] = 1.5;
    } else {
      idfWeights[word] = 1.0;
    }
  });

  return idfWeights;
}

/**
 * Returns combined weight for a word (static preposition weight * dynamic IDF factor).
 * Bounded gracefully between 0.25 and 1.30.
 */
export function getCombinedWordWeight(
  word: string,
  enableWeighting: boolean = true,
  idfWeights?: Record<string, number>
): number {
  if (!enableWeighting || !word) return 1.0;

  const baseWeight = getHebrewWordWeight(word, true);
  const idfFactor = idfWeights && idfWeights[word] !== undefined ? idfWeights[word] : 1.0;

  return Math.min(1.30, Math.max(0.25, baseWeight * idfFactor));
}
