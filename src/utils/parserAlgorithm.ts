import { OtzariaLink, PluginConfig, DHHighlight, SessionState } from '../types';
import { expandAbbreviationsInText, DEFAULT_ABBREVIATIONS, NORMALIZED_ABBREVIATIONS_MAP, ABBR_MARK } from '../data/abbreviations';

/**
 * FIX ח׳ — a resolved abbreviation keeps ONE slot of the maxDhWords cap and bridges the run,
 * but contributes only this share of what the words it opened into would have scored.
 * Proportional rather than flat: a long expansion is still worth more than a short one, so the
 * (globally capped, 1.5) acceptance bar keeps its meaning.
 */
const ABBR_DAMP = 0.6;
import { getWordSimilarity, getNikudFingerprint, levenshteinDistance } from './fuzzyUtils';
import { getCombinedWordWeight, calculateDocumentIdfWeights, HEBREW_STOP_WORDS } from './wordWeights';
import {
  SourceProfile,
  DEFAULT_PROFILE,
  PassSpec,
  basePassSpec,
  passSpecsFor,
  profileForConfig,
  hasHalachaNumbering,
  stripHalachaNumbering,
  stripHalachaLeadIn,
  isNumberedContentHeader,
  isSeifKatanMarkerLine,
  findDhBoundary
} from './halachaAlgorithm';

/**
 * Anchor policy for the TARGET-document side of the matcher (see calcContiguousScore and
 * hasQualifyingOccurrence inside searchLineInDoc).
 *
 * BUG-02: the position at which a match may begin *inside the source line* was hard-capped
 * at the first 3 words. That silently made a whole class of legitimate citations
 * unreachable — any quote that simply starts a few words into the Gemara line. Real case:
 *   commentary  "לכדתניא בשבתך בביתך פרט לעוסק במצוה…"
 *   Gemara      "ההוא מבעי ליה, לכדתניא: בשבתך בביתך — פרט לעוסק במצוה…"
 * "לכדתניא" is target word #3, the first index the cap excluded, so a 10-word verbatim run
 * scored zero and the line got no link at all.
 *
 * Removing the cap outright would reopen exactly the false positive it was added for: a
 * single incidental word matching deep inside a long Gemara line. So the anchor is now
 * unrestricted in POSITION but qualified by EVIDENCE:
 *   • offset 0..shallowAnchorLimit-1 — "shallow": accepted as before, any run length.
 *   • offset >= shallowAnchorLimit   — "deep": accepted only when backed by a contiguous
 *     run of at least deepAnchorMinRun words. A 10-word run at offset 3 is strong
 *     evidence; a lone word at offset 40 is noise.
 *
 * Scope, deliberately narrow — this governs the SOURCE/target line only:
 *   • The commentary-side restriction is untouched: a match must still begin within the
 *     first 3 words of the commentary line (maxStartIdx in calcContiguousScore).
 *   • requireStartAtFirstWord (secondary sources — Rashi/Tosafot) still pins the anchor to
 *     target word 0 exactly, and is unaffected.
 *   • searchPrimaryWithFirstAnchor (the כו' path) never had a positional cap and is unchanged.
 *
 * The change is purely additive: for any given candidate line the best score can only rise
 * or stay equal, so no line that previously matched can stop matching. What can change is
 * which line wins when a deep run on one line now outscores a shallow run on another —
 * which is the point.
 *
 * BOTH BOUNDS NOW COME FROM THE PASS SPEC (`PassSpec.shallowAnchorLimit` /
 * `.deepAnchorMinRun`, halachaAlgorithm.ts). `basePassSpec` returns 3 and 3 — the values
 * that were written here — so nothing about the policy above has changed. What changed is
 * that a later pass over the same book can carry different ones, which is the only way a
 * one- or two-word ד"ה sitting mid-line can ever be scored at all.
 */

/**
 * ── Single-word Dibur Hamatchil: the first-word anchor ────────────────────────────────────
 *
 * A one-word ד"ה could never produce a link, and not because it was judged weak: the
 * acceptance bar is `Math.min(1.5, …)` (computeDynamicMinThreshold) while a single word is
 * worth at most 1.30 (getCombinedWordWeight's ceiling, CONF.MAX_WORD_WEIGHT). 1.30 < 1.5 under
 * every configuration, so the case was arithmetically unreachable rather than merely unlikely.
 * The ordinary scorer cannot be relaxed to admit it — lowering the bar to 1.3 would admit every
 * incidental one-word coincidence in the book. It needs its own evidence instead.
 *
 * WHEN — all of:
 *   1. nothing was found: not by the strict search, not by any rung (A–D) of the flexibility
 *      ladder, and not in the secondary document;
 *   2. the line is not a בא"ד / שם-ibid continuation — those say "same place as above" in their
 *      own words, so there is no quote to anchor;
 *   3. it runs BEFORE both inheritance paths, so a line that would have silently inherited gets
 *      a real anchor instead.
 *
 * THE RULE — the anchor is the FIRST word of the ד"ה (after stripSecondaryPrefix removes the
 * routing label רש"י / תוס' / גמ' / שם, which names the target and is not part of the quote),
 * matched by PLAIN STRING EQUALITY on the normalised form. No prefix-letter (אותיות שימוש)
 * stripping, no Levenshtein, no stems, no ktiv variants — normalizeText removes nikud, quotes
 * and punctuation, and nothing else is forgiven. One word is too little evidence to spend any
 * of it on fuzziness.
 *
 * TWO GATES, one on each side of the match:
 *   • RARITY (commentary side) — the word may open at most SWDH_MAX_OPENING_RATIO of this
 *     commentator's own content lines. A word he habitually opens with (והנה, ובזה, אמנם) is
 *     his discourse, not a lemma. Measured over the book being processed, so it adapts to the
 *     author rather than to a fixed list.
 *   • UNIQUENESS (target side) — the word must occur in exactly ONE line of the parallel daf.
 *     Rarity establishes that the word is quotable; it says nothing about which line it points
 *     at. With several candidates, choosing one is a guess wearing a match's clothes.
 *
 * Search scope is the aligned segment only. In רש"י / תוספות the word must be the line's FIRST
 * word (their lines open with the lemma — the same rule requireStartAtFirstWord applies to the
 * ordinary secondary search); in the גמרא it may sit anywhere in the line.
 *
 * Measured over three full books (פני יהושע on ברכות and on שבת, בן יהוידע on ברכות): 19 links
 * that no configuration of the engine could previously produce, no line lost a link, and of the
 * cases an independent judge could rule on, it picked the same line every time. See
 * docs/SIMULATION_SINGLE_WORD_DH.md and qa/variant/ for the simulation this was derived from.
 *
 * The ratio itself now comes from the source profile (SourceProfile.swdhMaxOpeningRatio):
 * 0.008 for ש"ס/תנ"ך, exactly as measured above, and 0.02 for ספרי הלכה — there only a
 * numbered line ever reaches this stage, so the gate is already narrow by construction.
 */
/** Anchor must have at least this many letters — a 1–2 letter token carries no evidence. */
const SWDH_MIN_LETTERS = 3;

/**
 * How many words of a post-כו' continuation segment are considered.
 *
 * Started at 5 as a blunt guard against the essay tail (BUG-06). That cut real evidence: on
 * פני יהושע ברכות line 292 the identifying phrase "אי משום צינה אפשר במרחצאות א\"ל ר\"ח וכי יש
 * טבילה בחמין" was severed in half and the line lost גמרא 1048. Scoring the continuation as a
 * RUN rather than a bag of words (see scoreContinuationRun) separates quote from essay on its
 * own — prose does not match consecutively — so the window can be this wide again.
 */
const CONTINUATION_SEGMENT_MAX_WORDS = 12;

/**
 * Word-count-aware acceptance threshold for searchLineInDoc.
 *
 * BUG-01: a flat "% of expectedWeight" threshold treats a 2-word value the same as an
 * 8-word one, but a single wrong/unmatched word in a short value swings the resulting
 * percentage far more than the same single miss does in a long one — so a flat percentage
 * is simultaneously too strict for short citations and too loose for long ones.
 *
 * Fix: scale the required fraction down as wordCount shrinks (fewer words → lower bar),
 * and require a stricter fraction for non-explicit values (no ד"ה marker) — those lack the
 * independent "the author told us where to look" signal an explicit citation carries, so a
 * plain textual match needs to be more convincing before it's trusted. The floor (the
 * absolute minimum score regardless of percentage) is tiered the same way, so a short value
 * isn't forced past a floor sized for long ones.
 *
 * `multiplier` (thresholdMultiplier from the caller — 0.65 normally, lower on later rungs
 * of the explicit-reference flexibility ladder) scales the tiered base fraction rather than
 * replacing it, so the ladder's relaxation still applies proportionally at every word count.
 */
function computeDynamicMinThreshold(
  expectedWeight: number,
  wordCount: number,
  isExplicit: boolean,
  multiplier: number,
  minAccept?: number,
  scoreCap: number = 1.5
): number {
  let fraction: number;
  let floor: number;
  if (wordCount <= 2) {
    fraction = 0.55;
    floor = 0.4;
  } else if (wordCount <= 4) {
    fraction = 0.60;
    floor = 0.55;
  } else {
    fraction = 0.65;
    floor = 0.7;
  }

  // Non-explicit values (no ד"ה marker) need a stricter bar.
  if (!isExplicit) fraction += 0.05;

  // multiplier scales the tiered fraction proportionally (0.65 is the normal baseline).
  const scaledFraction = fraction * (multiplier / 0.65);

  // scoreCap comes from PassSpec.scoreCap; basePassSpec returns 1.5 — the constant that was
  // written here — so the bar is unchanged for the single pass that runs today.
  const dynamic = Math.min(scoreCap, Math.max(floor, expectedWeight * scaledFraction));

  /**
   * `minAccept` (SourceProfile.minAcceptScore) is a FLOOR under the dynamic bar, not a
   * replacement for it. In ספרי הלכה the ד"ה now carries an explicit punctuation boundary,
   * so `expectedWeight` is measured over the two-word quote instead of the whole paragraph
   * — which drops this bar from a flat 1.5 to roughly 0.5. That is a real relaxation, and
   * it is only safe inside a narrowed search window; until the window exists the floor pins
   * the bar where it effectively sits today. See docs/HALACHA_MULTIPASS_PLAN.md §3.
   */
  return minAccept === undefined ? dynamic : Math.max(dynamic, minAccept);
}

/**
 * Which rung of the explicit-reference flexibility ladder produced a match
 * (see attemptFlexibleRetry in runLinkingParser).
 */
export type RetryRung = 'A' | 'B' | 'C' | 'D';

/**
 * ── Confidence: what the number means, and why it is shaped like this ────────────────────
 *
 * The percentage shown next to a link is a DISPLAY value. It never feeds back into the
 * matcher: which line a commentary line links to is decided entirely by the search functions
 * and computeDynamicMinThreshold, and nothing below is consulted there. Changing this model
 * changes what the reviewer is told, never what the engine produced or what gets exported
 * (`_links.json` / `_links.csv` carry only the indices and refs).
 *
 * THE OLD MODEL AND WHY IT COLLAPSED
 * It reduced everything to `matchScore / expectedWeight` and cut that into four tiers
 * (96/88/76/60). Those two quantities are not on a common scale:
 *   • matchScore     — weight of the best CONTIGUOUS RUN, bounded by maxDhWords (≤12 words).
 *   • expectedWeight — weight of EVERY word of the commentary phrase, unbounded.
 * Measured over פני יהושע/ברכות the median expectedWeight is 180 against a median matchScore
 * of 25, so the median ratio was 0.14 and 91% of links fell under the lowest tier's 0.55 cut:
 * 77.6% of all links displayed exactly 60%, 20.2% displayed the flat inherited 75%, and the
 * three real tiers shared the remaining 2.2%. The ratio was measuring "what fraction of this
 * paragraph is a quotation" — a property of the commentator's writing style — rather than
 * "how good is this match". Worse, every candidate in a link's top-3 list received an
 * identical percentage (100% of multi-candidate links), so the number could not help a
 * reviewer choose between alternatives at all.
 *
 * THE MODEL
 * Six normalised, independently meaningful signals are combined in LOG-ODDS space and passed
 * through a logistic. Continuity is structural: every input is continuous, so the output is
 * too, and no input can pin the result to a constant.
 *
 *   coverage   matched weight ÷ weight of the words the matcher was ALLOWED to compare (the
 *              first maxDhWords). This is the denominator fix — a number that can actually
 *              reach 1.0 — and on its own it accounts for most of the spread.
 *   runF       contiguous matched word count, saturating (1-e^(-n/k)). Nine verbatim words
 *              are near-proof regardless of how long the surrounding paragraph is; the old
 *              model only had a cliff at ≤2 words and was blind above it.
 *   meanSim    mean per-word similarity across the run. The weighted sum melted exactness
 *              into magnitude, so five verbatim words and five fuzzy ones (0.75 each) were
 *              indistinguishable. Centred on 0.90 because a stem match scores 0.92.
 *   info       mean IDF/stop-word weight of the matched words. Matching "אמר רבי יוחנן"
 *              (three stop-words, 0.35 each) is weak evidence; matching "מרגלא בפומיה" is
 *              strong. Both used to contribute to the same undifferentiated sum.
 *   margin     (winner − runner-up) ÷ winner, from the top-K list that was already being
 *              collected and then discarded. This is the signal the old model lacked
 *              entirely: it separates "this line matches well" from "this line matches
 *              better than every rival". Two lines scoring 8.2 and 8.1 mean the text was
 *              found but the CHOICE is a coin flip — and it is what finally gives the
 *              candidate dropdown three different numbers.
 *   exactPhrase  the search phrase occurred verbatim in the target line.
 *
 * Retry rungs and inheritance became PENALTIES IN LOG-ODDS instead of `Math.min` ceilings.
 * A hard cap is wrong in both directions: it dragged an overwhelming match found on rung C
 * down to exactly 72, and it silently RAISED a threadbare rung-A match up to 82. A penalty
 * preserves the ordering of the underlying evidence.
 *
 * An inherited link (שם / בא"ד) no longer reports a flat 75. It inherits its parent's
 * confidence and decays it once per hop, so a שם sitting six lines below a shaky link is
 * finally distinguishable from one directly under a certain one.
 */

/** Evidence gathered by a search function about the match it returned. Display-only. */
export interface MatchEvidence {
  /** Weight of the matched contiguous run (numerator). */
  matchedWeight: number;
  /** Weight of the words the matcher was allowed to compare — the comparison window. */
  windowWeight: number;
  /** Length in words of the matched contiguous run. */
  runWords: number;
  /** Sum of per-word similarities across that run (÷ runWords = mean exactness). */
  simSum: number;
  /** Ranking score of the winning line. */
  winnerScore: number;
  /** Best ranking score among the rivals that also cleared the acceptance threshold. */
  runnerUpScore: number;
  /** The search phrase was found verbatim in the target line. */
  exactPhrase: boolean;
}

export const EMPTY_EVIDENCE: MatchEvidence = {
  matchedWeight: 0, windowWeight: 0, runWords: 0, simSum: 0,
  winnerScore: 0, runnerUpScore: 0, exactPhrase: false
};

/**
 * Coefficients. Centres are the "neutral" value of each feature — a match sitting exactly at
 * every centre lands on B0. Tuned against the reliability measurement in qa/confidence.ts;
 * see the calibration note there before changing any of them.
 */
const CONF = {
  B0: 0.35,
  W_COVERAGE: 3.20, C_COVERAGE: 0.50,
  W_RUN: 2.40, C_RUN: 0.55,
  W_SIM: 2.60, C_SIM: 0.90,
  W_INFO: 1.10, C_INFO: 0.55,
  W_MARGIN: 1.70, C_MARGIN: 0.35,
  W_EXACT: 1.15,
  W_EXPLICIT: 0.45,
  /** Words of contiguous run at which runF reaches 1-1/e. */
  RUN_SCALE: 3.5,
  /** Maximum per-word combined weight — getCombinedWordWeight's upper bound. */
  MAX_WORD_WEIGHT: 1.30,
  /** Log-odds subtracted per flexibility-ladder rung. */
  RUNG_PENALTY: { A: 0.45, B: 0.80, C: 1.25, D: 1.85 } as Record<RetryRung, number>,

  /**
   * CALIBRATION — the step that makes the percentage a percentage.
   *
   * The weights above express which evidence matters and by how much RELATIVE to the rest;
   * they say nothing about what absolute frequency a given z corresponds to. Uncalibrated,
   * the model was right about the ordering but far too sure of itself: it reported a mean of
   * 93.8% over links that a verbatim check found correct 78.1% of the time, and 30% of all
   * links sat at 99%.
   *
   * These two numbers apply Platt scaling, z' = A·z + B, fitted by gradient descent on 895
   * matched links from three commentary/tractate pairs (פני יהושע on ברכות and on שבת,
   * בן יהוידע on ברכות). The label is deliberately NOT one of the model's own features: it is
   * whether the Dibur Hamatchil and the line it points at share at least three CONSECUTIVE
   * words verbatim — plain string equality, no fuzzy matching, no stems, no weights, no
   * abbreviation expansion. Result: expected calibration error 8.9 → 2.4 points, log-loss
   * 0.492 → 0.426.
   *
   * Only two parameters are fitted, and that is on purpose. They can slide and stretch the
   * scale onto the observed frequencies but cannot re-rank anything, so the domain reasoning
   * in the weights survives intact and there is nothing for the proxy label to overfit.
   *
   * A < 1 means the raw model was over-sharp: it pushed cases to the extremes harder than the
   * evidence justified. To re-fit after changing any weight above, re-run qa/confidence.ts.
   */
  CAL_A: 0.5163,
  CAL_B: 0.1358,

  /**
   * Per-hop retention for inherited links, in probability space.
   *
   * NOT fitted, unlike CAL_A/CAL_B, and the distinction matters. The verbatim judge is
   * structurally unfair to an inherited link: a בא"ד line inherits precisely BECAUSE it
   * carries no quotation of its own, so it fails a "does the quote reappear" test even when
   * the link is perfectly correct. Measured at 21%/30%/35% for depths 1/2/3, those figures are
   * a floor on correctness, not an estimate of it, and calibrating to them would be reading a
   * broken instrument.
   *
   * So this is a reasoned prior: an inherited link is its parent's claim, weakened once per
   * hop by the chance that the reuse itself is wrong. 0.80 puts a first-hop inheritance from a
   * 90% parent at 72% — near the flat 75% the old model gave EVERY inherited link — while
   * finally separating a שם directly under a certain link from one six hops down a shaky
   * chain, which is the part that was actually broken.
   */
  INHERIT_RETENTION: 0.80,
  /** Confidence assumed for an inherited link whose parent's confidence is unknown. */
  INHERIT_FALLBACK: 70,
  /** קנס בלוג-אודס לכל שלב במורד סולם המעברים — ראו passLadderPenalty. */
  PASS_PENALTY_PER_STEP: 0.18,
  /** הזיכוי המרבי על חלון שהוכרע לחלוטין (שורה אחת אפשרית). */
  WINDOW_CREDIT_MAX: 0.9,
  /** מעל כמה שורות בחלון הזיכוי מתאפס. */
  WINDOW_CREDIT_SPAN: 8,
  MIN: 5,
  MAX: 99
} as const;

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
const logistic = (z: number): number => 1 / (1 + Math.exp(-z));

export interface ConfidenceInputs {
  /** Link reuses a previous link's target (שם / בא"ד / cross-reference fallback). */
  isInherited?: boolean;
  /** Hops from the nearest link that was matched on its own evidence. 1 = direct parent. */
  inheritDepth?: number;
  /** Confidence of the link being inherited from, if known. */
  inheritedFrom?: number;
  /** The commentary line named its target explicitly (ד"ה / בד"ה / גמ'). */
  isExplicit?: boolean;
  /** Which flexibility-ladder rung produced the match, if any. */
  retryRung?: RetryRung | null;
  evidence?: MatchEvidence | null;
  /**
   * כמה שלבים במורד סולם המעברים ירד המעבר שייצר את ההתאמה (0 = המעבר הראשון), וכמה שורות
   * מקור היו אפשריות בזמן ההכרעה. ראו `passLadderPenalty`.
   *
   * שני אלה **אינם נשמרים על הקישור ואינם מוצגים** — הם נצרכים כאן ונזרקים. מה שהמשתמש רואה
   * הוא אחוז אחד, וזה כל מה שהוא צריך כדי לדעת במה לפתוח את הבדיקה.
   */
  passIndex?: number;
  searchRangeWidth?: number;
}

/**
 * הקנס בלוג-אודס על מעבר שירד בסולם, בניכוי הזיכוי על חלון צר.
 *
 * שני הגדלים מושכים לכיוונים מנוגדים, וזו הנקודה:
 *
 * • **עומק בסולם מחליש.** מעבר מאוחר הרפה יותר — רף נמוך יותר, רצף קצר יותר, התאמה מטושטשת —
 *   ולכן אותה התאמה עצמה נשענת על פחות.
 * • **חלון צר מחזק.** קישור שהוכרע כשנשארו שתי שורות אפשריות ודאי הרבה יותר מאותה התאמה
 *   בדיוק שהוכרעה על פני סימן בן עשרים סעיפים. זו בדיוק העסקה שהתוכנית עושה — החלון משלם על
 *   ההרפיה — ואם הוודאות לא תשקף אותה, סדר הבדיקה יטעה את הבודק.
 *
 * הזיכוי חסום כך שלא יהפוך לבונוס: הוא מקזז קנס ולעולם אינו מוסיף מעבר לאפס.
 *
 * בש"ס רץ מעבר אחד ואין חלונות, ולכן שני הגדלים אפס והפונקציה מחזירה 0.
 */
function passLadderPenalty(passIndex?: number, searchRangeWidth?: number): number {
  const depth = passIndex ?? 0;
  if (depth <= 0) return 0;
  const penalty = CONF.PASS_PENALTY_PER_STEP * depth;
  const width = searchRangeWidth;
  const credit = width === undefined
    ? 0
    : CONF.WINDOW_CREDIT_MAX * (1 - clamp01((width - 1) / CONF.WINDOW_CREDIT_SPAN));
  return Math.max(0, penalty - credit);
}

/**
 * Calculates the displayed confidence (0-100%) for a generated link.
 * See the model note above. Continuous by construction — no tiers, no hard caps.
 */
export function calculateLinkConfidence(inp: ConfidenceInputs): number {
  const clampPercent = (p: number): number =>
    Math.max(CONF.MIN, Math.min(CONF.MAX, Math.round(100 * p)));
  /** Raw model log-odds → calibrated percentage. */
  const toPercent = (z: number): number =>
    clampPercent(logistic(CONF.CAL_A * z + CONF.CAL_B));

  if (inp.isInherited) {
    // An inherited link asserts its parent's claim, discounted once per hop by the chance
    // that reusing the target is itself wrong. Both terms are already probabilities, so this
    // is a plain product — it must not go through the Platt scaling above, which is defined
    // on the evidence model's raw log-odds and would double-apply here.
    const parent = inp.inheritedFrom && inp.inheritedFrom > 0 ? inp.inheritedFrom : CONF.INHERIT_FALLBACK;
    const depth = Math.max(1, inp.inheritDepth ?? 1);
    return clampPercent((parent / 100) * Math.pow(CONF.INHERIT_RETENTION, depth));
  }

  const ev = inp.evidence;
  if (!ev || ev.runWords <= 0 || ev.windowWeight <= 0) {
    // No usable evidence was recorded — report the model's neutral point rather than
    // inventing a number the signals cannot support.
    return toPercent(
      CONF.B0
      - (inp.retryRung ? CONF.RUNG_PENALTY[inp.retryRung] : 0)
      - passLadderPenalty(inp.passIndex, inp.searchRangeWidth)
    );
  }

  const coverage = clamp01(ev.matchedWeight / ev.windowWeight);
  const runF = 1 - Math.exp(-ev.runWords / CONF.RUN_SCALE);
  const meanSim = clamp01(ev.simSum / ev.runWords);
  const info = clamp01(ev.matchedWeight / ev.runWords / CONF.MAX_WORD_WEIGHT);
  const margin = ev.winnerScore > 0
    ? clamp01((ev.winnerScore - ev.runnerUpScore) / ev.winnerScore)
    : 0;

  let z = CONF.B0
    + CONF.W_COVERAGE * (coverage - CONF.C_COVERAGE)
    + CONF.W_RUN * (runF - CONF.C_RUN)
    + CONF.W_SIM * (meanSim - CONF.C_SIM)
    + CONF.W_INFO * (info - CONF.C_INFO)
    + CONF.W_MARGIN * (margin - CONF.C_MARGIN);

  if (ev.exactPhrase) z += CONF.W_EXACT;
  if (inp.isExplicit) z += CONF.W_EXPLICIT;
  if (inp.retryRung) z -= CONF.RUNG_PENALTY[inp.retryRung];
  z -= passLadderPenalty(inp.passIndex, inp.searchRangeWidth);

  return toPercent(z);
}

/**
 * Normalizes Hebrew text for search/comparison only.
 * Removes Nikud, teamim, HTML tags, and punctuation (except . and : when specified).
 */
export function stripHtmlTags(text: string): string {
  return text.replace(/<[^>]*>/g, ' ');
}

/**
 * A line that carries a heading tag. Deliberately profile-INDEPENDENT, unlike `isHeaderLine`:
 * the halacha profile demotes a numbered `<h2>` to a content line, but the stored text must not
 * depend on which profile happened to parse it — `isHeaderLine` is called elsewhere (export,
 * inheritance chains) with no profile at all, and a line whose `<h2>` had been stripped under
 * one profile would stop reading as a header under the other.
 */
const HEADER_TAG_RE = /<h[1-6][^>]*>[\s\S]*<\/h[1-6]>/i;

/**
 * Removes markup from a CONTENT line, tag and everything inside its angle brackets.
 *
 * The Otzaria corpora — the שולחן ערוך above all, the ש"ס after it — interleave the text with
 * markup that is not text: empty footnote anchors (`<i data-commentator="Mishnah Berurah"
 * data-label="א"></i>`, ~44k of them in או"ח alone), `<small>` around the Rema, `<strong>`/`<big>`
 * around the משנה. None of it is anything the user asked to read or to search, and it leaks into
 * BOTH: the row renderers print raw lines as literal text, and the per-token normalisation in
 * `findSourceMatchRange` splits a tag on its spaces, so `data-label="א"` survives as a bare Hebrew
 * word the Dibur Hamatchil can match against.
 *
 * Stripped ONCE at ingestion (see `parseDocumentSegments`) rather than at each display site, so
 * the word indices in `dhHighlights` — which count tokens of the stored line — are computed over
 * the same words that end up on screen.
 *
 * Deliberately NOT `stripHtmlTags`, which substitutes a space. Every tag these corpora use
 * inside a content line is an INLINE element — `<i> <b> <small> <big> <strong> <img>`, and
 * nothing else — so removing it outright is what a browser renders and what the typesetter
 * meant. A space instead invents word boundaries that are not in the text: `<b>ש</b>שים` is
 * the acrostic markup of בן יהוידע and reads ששים, not "ש שים", and the tag closing before
 * the comma of `הַשַּׁבָּת</strong></big>,` would leave that comma standing as a word of its own.
 * `<br>` is the one exception, being the only break among them.
 *
 * The words in these corpora are separated by real whitespace, never by markup alone, so
 * nothing glues together — and the leading space that `stripHtmlTags` used to leave on a
 * line opening with a tag is gone with it, which is what silently no-opped every `^`-anchored
 * strip in `stripSecondaryPrefix` (BUG-03).
 */
const MARKUP_RUN_RE = /(?:<[^>]*>)+/g;
const LINE_BREAK_TAG_RE = /<\s*br\b[^>]*>/i;

export function stripContentMarkup(line: string): string {
  if (!line || !line.includes('<')) return line;
  const stripped = line.replace(MARKUP_RUN_RE, run => (LINE_BREAK_TAG_RE.test(run) ? ' ' : ''));
  return stripped.replace(/[^\S\n]{2,}/g, ' ').trim();
}

/**
 * Removes the quotation marks that merely WRAP a word, while keeping the gershayim that is
 * an inseparable part of a Hebrew abbreviation.
 *
 * `normalizeText` keeps `"` on purpose \u2014 it is the gershayim of \u05E8\u05D0\u05E9\u05D9 \u05EA\u05D9\u05D1\u05D5\u05EA (\u05E8\u05E9"\u05D9, \u05D3"\u05D4, \u05D0\u05D5"\u05D7)
 * and the abbreviation engine keys on it. But after `normalizeHebrewQuotes` that same `"` is
 * also every ordinary quotation mark in the text, and Steinsaltz-style source lines wrap each
 * quoted lemma in one:  \u05DC\u05B0\u05DB\u05B4\u05D3\u05B0\u05EA\u05B7\u05E0\u05B0\u05D9\u05B8\u05D0: "\u05DB\u05B0\u05BC\u05E9\u05B4\u05C1\u05D1\u05B0\u05EA\u05B0\u05BC\u05DA\u05B8 \u05D1\u05B0\u05BC\u05D1\u05B5\u05D9\u05EA\u05B6\u05DA\u05B8" \u2014 \u05E4\u05B0\u05BC\u05E8\u05B8\u05D8 \u05DC\u05B0\u05E2\u05D5\u05B9\u05E1\u05B5\u05E7 \u05D1\u05B0\u05BC\u05DE\u05B4\u05E6\u05B0\u05D5\u05B8\u05D4.
 * Splitting on whitespace then yields `"\u05DB\u05E9\u05D1\u05EA\u05DA` and `\u05D1\u05D1\u05D9\u05EA\u05DA"`, and the word comparator sees
 * `\u05D1\u05D1\u05D9\u05EA\u05DA" \u2260 \u05D1\u05D1\u05D9\u05EA\u05DA`: getWordSimilarity returns 0, which SEVERS the contiguous run at that word
 * rather than merely lowering its score. On the reference corpus 12% of lines carry such a
 * token and 69% of those occurrences score exactly 0 against their own unquoted form \u2014 so a
 * \u05D3"\u05D4 quoting a phrase the Gemara itself quotes was unlinkable.
 *
 * The rule is purely positional, which is what makes it safe for \u05E8\u05D0\u05E9\u05D9 \u05EA\u05D9\u05D1\u05D5\u05EA:
 *   \u2022 `"` INSIDE a word is gershayim         \u2192 kept     (\u05E8\u05E9"\u05D9, \u05D3"\u05D4, \u05E2"\u05D0, \u05D0\u05D5"\u05D7)
 *   \u2022 `"` at either EDGE is a quotation mark \u2192 removed  ("\u05E9\u05E7\u05D3\u05D5" \u2192 \u05E9\u05E7\u05D3\u05D5)
 *   \u2022 TRAILING `'` is an abbreviation mark   \u2192 kept     (\u05DB\u05D5', \u05DE\u05EA\u05E0\u05D9', \u05EA\u05D5\u05E1', \u05E8', \u05D2\u05DE')
 *   \u2022 LEADING `'` is an opening quote        \u2192 removed  (a geresh always FOLLOWS its letter,
 *                                                        so it is never word-initial)
 *
 * A closing quote may be followed by the `.`/`:` that `normalizeText(_, true)` preserves
 * (`\u05E9\u05D3\u05D4\u05D5".`), so trailing punctuation is allowed to sit between the quote and the boundary.
 *
 * Neutral for abbreviation expansion by construction: `cleanAbbrKey` already strips every
 * quote before a dictionary lookup, and `getTargetIndex` already splits on them \u2014 so the keys
 * and the initials both come out identical to before. The only lookup that sees the raw token
 * is `rawJoined`, and no dictionary key carries an edge quote. What does change is
 * `targetNorm.includes(optNorm)`, which can now match an expansion spanning a quote boundary
 * that the glued `"` used to hide \u2014 strictly more expansions, never fewer.
 *
 * Two deliberate limits, both pre-existing conditions rather than new ones:
 *   \u2022 The rule cannot tell a prefix-letter glued to an opening quote (`\u05dc"\u05d1\u05d9\u05ea`) from a genuine
 *     two-letter acronym (`\u05d1"\u05d1`, `\u05de"\u05de`, `\u05db"\u05e9`) \u2014 both are `letter " letters`. Such a token
 *     scored 0 before this change too, so nothing regresses; it simply is not rescued.
 *   \u2022 The closing rule keeps a TRAILING `'`, so a phrase quoted with single quotes ('\u05e2\u05d5\u05e3')
 *     still carries its closing mark. Removing it unconditionally would destroy every \u05db\u05d5',
 *     \u05ea\u05d5\u05e1', \u05e8' and \u05de\u05ea\u05e0\u05d9' in the corpus, which is the far larger harm.
 *
 * The `(?<!")` on the second replace pins each quote run to a single start offset. Without it
 * the greedy `"+` restarts at every position inside a run and backtracks through the `[.:]*`
 * tail, which is quadratic: a 16k-quote run cost 1.08s. Output is byte-identical either way
 * on all 51,360 corpus lines \u2014 the lookbehind is purely a guard against a pathological input.
 *
 * NOTE on ordering: the `\s` in both regexes only sees ZWSP / RLM / LRM / bidi controls as
 * whitespace because `normalizeText` maps every non-Hebrew character to a space BEFORE
 * calling this. Moving this call earlier would silently break that.
 */
function stripEdgeQuotes(text: string): string {
  return text
    .replace(/(^|\s)["']+/g, '$1')             // opening quote at a word start
    .replace(/(?<!")"+(?=[.:]*(?:\s|$))/g, ''); // closing double-quote at a word end
}

export function normalizeText(text: string, keepColonsAndDots: boolean = false): string {
  if (!text) return '';

  // 1. Normalize quotes and remove HTML tags
  let cleaned = normalizeHebrewQuotes(stripHtmlTags(text));

  // 2. Remove Nikud and Cantillation (teamim): U+0591 to U+05C7
  cleaned = cleaned.replace(/[\u0591-\u05C7]/g, '');

  if (keepColonsAndDots) {
    // Keep letters, digits, spaces, ., :, ' and "
    cleaned = cleaned.replace(/[^\u05D0-\u05EA0-9\s.:'"]+/g, ' ');
  } else {
    // Keep letters, digits, spaces, ' and "
    cleaned = cleaned.replace(/[^\u05D0-\u05EA0-9\s'\"]+/g, ' ');
  }

  // 3. Drop word-wrapping quotation marks, keep abbreviation gershayim (see above)
  cleaned = stripEdgeQuotes(cleaned);

  // Normalize spaces
  return cleaned.replace(/\s+/g, ' ').trim();
}

/**
 * Extracts header titles from text line if line is a header tag (e.g. <h1>...</h1>, # ...)
 */
export function isHeaderLine(line: string, profile?: SourceProfile): boolean {
  const trimmed = line.trim();
  const looksLikeHeader = /<h[1-6][^>]*>.*<\/h[1-6]>/i.test(trimmed) || /^#{1,6}\s+/.test(trimmed);
  if (!looksLikeHeader) return false;
  // בפרופיל הלכה כותרת ממוספרת שאינה כותרת "סימן" היא שורת תוכן, לא גבול-סגמנט —
  // ראו isNumberedContentHeader. בכל פרופיל אחר `profile` אינו מועבר וההתנהגות זהה לקודמת.
  if (profile?.numberedHeadersAreContent && isNumberedContentHeader(line)) return false;
  return true;
}

export function extractHeaderTitle(line: string): string {
  const trimmed = line.trim();
  // The heading tag itself is kept on the stored line (it is the segment boundary), so the
  // title extracted from it is the one place a header's own markup can still reach the screen —
  // both the inner markup of a `<h2>ברכות <i …></i>ב א</h2>` and the whole of a bare `# ` line.
  // Comparison is unaffected: normalizeHeaderForComparison strips tags anyway.
  const htmlMatch = trimmed.match(/<h[1-6][^>]*>(.*?)<\/h[1-6]>/i);
  if (htmlMatch) return stripContentMarkup(htmlMatch[1]);
  const mdMatch = trimmed.match(/^#{1,6}\s+(.*)/);
  if (mdMatch) return stripContentMarkup(mdMatch[1]);
  return stripContentMarkup(trimmed);
}

export function normalizeHeaderForComparison(header: string): string {
  if (!header) return '';
  let title = extractHeaderTitle(header);
  title = normalizeHebrewQuotes(title);
  // Normalize Talmudic Daf notation: דף ב. -> דף ב עמוד א, דף ב: -> דף ב עמוד ב
  title = title.replace(/דף\s+([\u05D0-\u05EA]+)\s*\./g, 'דף $1 עמוד א');
  title = title.replace(/דף\s+([\u05D0-\u05EA]+)\s*:/g, 'דף $1 עמוד ב');
  title = title.replace(/דף\s+([\u05D0-\u05EA]+)\s*ע"?א/g, 'דף $1 עמוד א');
  title = title.replace(/דף\s+([\u05D0-\u05EA]+)\s*ע"?ב/g, 'דף $1 עמוד ב');
  
  return normalizeText(title, false);
}

/**
 * האם `haystack` מכיל את `needle` **כרצף מילים שלמות** — לא כרצף תווים.
 *
 * ריפוד ברווחים משני הצדדים הופך את מבחן ההכלה לכזה שקצותיו חייבים ליפול על גבול מילה, ולכן
 * "סימן י" אינו מוכל ב"סימן יא" (אחרי `י` בא `א` ולא רווח) בעוד "ברכות" מוכל ב"פני יהושע על
 * ברכות". `normalizeText` כבר איחד רווחים, כך שדי בהשוואה אחת.
 */
function containsWholeWords(haystack: string, needle: string): boolean {
  return ` ${haystack} `.includes(` ${needle} `);
}

/**
 * Compares two header strings according to SRS rule:
 * Ignore header level, normalize daf/chapter variations, match normalized text.
 *
 * ההתאמה היא זהות, או **הכלה של מילים שלמות** — וההבחנה הזאת היא כל העניין. הכלה ברמת התו
 * שברה את ספרי ההלכה: המספר בכותרת שלהם יושב בסוף המחרוזת ואין אחריו דבר ("סימן יא"), ולכן
 * מספר קצר הוא תחילית מושלמת של הארוך ממנו. "סימן י" תפס את "סימן יא", "סימן יב"…, והבחירה —
 * ההתאמה הראשונה בסדר המסמך — שלחה כל סימן שאחרי מספר עגול להיסרק בתוך העגול שקדם לו. בש"ס
 * הבאג לא צף מפני שהמספר יושב באמצע ואחריו סיומת קבועה (`דף י עמוד א` מול `דף יא עמוד א`).
 *
 * ההכלה עצמה נחוצה ואינה מוותרת עליה: היא מה שמחבר כותרת שנכתבה במלואה לכותרת חשופה — שם הספר
 * ("פני יהושע על ברכות" מול "ברכות"), או כותרת דף שצד אחד מקדים לה את שם המסכת ("ברכות דף ב
 * עמוד א" מול "דף ב עמוד א"). בכל אלה ההשמטה היא של **מילים שלמות**, ולכן גבול המילה מפריד
 * בדיוק בין ההכלה הנחוצה לבין ההתנגשות המקרית.
 */
export function areHeadersMatching(h1: string, h2: string): boolean {
  const norm1 = normalizeHeaderForComparison(h1);
  const norm2 = normalizeHeaderForComparison(h2);
  if (!norm1 || !norm2) return false;
  return norm1 === norm2 || containsWholeWords(norm1, norm2) || containsWholeWords(norm2, norm1);
}

/**
 * Keywords for Secondary Source routing.
 * Raw forms — normalized versions (RASHI_KEYWORDS_NORM / TOSAFOT_KEYWORDS_NORM) are
 * computed once below, sorted longest-first, and used for startsWith matching against
 * the already-normalized `normalizedPrefixLine`.
 */
const RASHI_KEYWORDS = [
  // With ד"ה / בד"ה — longest first
  'פירש"י ד"ה', 'פירש"י בד"ה', 'פרש"י ד"ה', 'פרש"י בד"ה',
  'בפירש"י ד"ה', 'בפירש"י בד"ה', 'בפרש"י ד"ה', 'בפרש"י בד"ה',
  'רש"י ד"ה', 'רש"י בד"ה', 'ברש"י ד"ה', 'ברש"י בד"ה',
  'רשי ד"ה', 'רשי בד"ה', 'ברשי ד"ה', 'ברשי בד"ה',
  'רשד"ה', 'ברשד"ה', 'רשדה', 'ברשדה',
  // Without ד"ה
  'פירש"י', 'פרש"י',
  'בפירש"י', 'בפרש"י',
  // BUG-05: the "פירוש רש\"י" spellings — the two words written separately, with פי'
  // abbreviated or not. This is the form פני יהושע uses ("שם בפי' רש\"י בד\"ה ופליגי רבנן
  // עליה…"), and none of the glued spellings above match it, so such a line was never
  // routed to the Rashi document at all — it was searched in the Gemara, where the ד"ה it
  // quotes does not exist.
  "בפי' רש\"י", "פי' רש\"י", 'בפירוש רש"י', 'פירוש רש"י',
  "בפי' רשי", "פי' רשי",
  'ברש"י', 'רש"י', 'ברשי', 'רשי'
];

const TOSAFOT_KEYWORDS = [
  // With ד"ה / בד"ה — longest first
  'בתוספות ד"ה', 'בתוספות בד"ה', 'תוספות ד"ה', 'תוספות בד"ה',
  // "בתוספת" — פני יהושע's spelling of the name ("בתוספת בד\"ה מפני שמזיז …"). It used to be
  // caught only by accident, as a prefix of the bare 'בתוס' under the old unbounded startsWith;
  // once that became a whole-word test (startsWithSourceKeyword) the spelling had to be named
  // here explicitly. Listed ONLY in its ד"ה forms: bare "בתוספת" is also the ordinary Hebrew
  // word for "in addition", and routing that to Tosafot as an explicit citation would skip the
  // primary-source search for any line that happens to open with it.
  'בתוספת ד"ה', 'בתוספת בד"ה', 'תוספת ד"ה', 'תוספת בד"ה',
  'בתוסות ד"ה',  'בתוסות בד"ה',  'תוסות ד"ה',  'תוסות בד"ה',
  'בתוס\' ד"ה',  'בתוס\' בד"ה',  'תוס\' ד"ה',  'תוס\' בד"ה',
  'בתוס ד"ה',   'בתוס בד"ה',   'תוס ד"ה',   'תוס בד"ה',
  'בתו\' ד"ה',  'בתו\' בד"ה',  'תו\' ד"ה',  'תו\' בד"ה',
  'בתו ד"ה',   'בתו בד"ה',   'תו ד"ה',   'תו בד"ה',
  'בתוד"ה', 'תוד"ה',
  // Without ד"ה
  'בתוספות', 'תוספות',
  'בתוסות',  'תוסות',
  'בתוס\'',  'תוס\'',
  'בתוס',    'תוס',
  'בתו\'',   'תו\'',
  'בתו',     'תו'
];

function toPrefixAlternation(keywords: string[]): string {
  return [...new Set(keywords)]
    .sort((a, b) => b.length - a.length)
    .map(kw => kw.replace(/\s+/g, '\\s+'))
    .join('|');
}

const RASHI_PREFIX_ALTS = toPrefixAlternation(RASHI_KEYWORDS);
const TOSAFOT_PREFIX_ALTS = toPrefixAlternation(TOSAFOT_KEYWORDS);

/**
 * "Not followed by another Hebrew letter" — the word boundary every source-name test needs.
 * See startsWithSourceKeyword below for why; the same assertion is spliced into the strip
 * regex so stripping and routing can never disagree about where a source name ends.
 */
const NOT_HEBREW_LETTER_AHEAD = '(?![\\u05D0-\\u05EA])';

const SECONDARY_PREFIX_STRIP_RE = new RegExp(
  `^(?:${RASHI_PREFIX_ALTS}|${TOSAFOT_PREFIX_ALTS}|שם\\s+ד"ה|או"ד|באו"ד|א"ד|בא"ד|אד|באד|אוד|באוד|בד"ה|בדה)${NOT_HEBREW_LETTER_AHEAD}\\s*[:.\\-]?\\s*`,
  'i'
);

/**
 * Keywords that indicate the commentary is citing the Gemara (primary Talmud source).
 * These are used to route searches explicitly to the Gemara source document.
 */
const GEMARA_KEYWORDS = [
  // "בגמ'" — the abbreviated form WITH the ב prefix — was missing, so a line opening
  // "בגמ' לא עני וכהן חד שיעורא" was neither recognised as a primary-source citation nor
  // had the word stripped, leaving "בגמ'" occupying a source-word slot in the matcher.
  'בגמרא', "בגמ'", "גמ'", 'גמרא', 'פיסקא', 'בפיסקא'
];

/**
 * Keywords that indicate the commentary is citing the Mishna (a separate source text).
 * When detected the search is routed to the Mishna document rather than the Gemara.
 */
const MISHNA_KEYWORDS = [
  "מתני'", 'מתניתין', 'מתניתן', 'במשנה', 'משנה'
];

/**
 * Pre-normalized keyword lists (normalizeText applied, sorted longest-first).
 * Built once at module load — never recalculated inside the hot loop.
 */
const _normalizeKw = (kw: string) =>
  kw.replace(/[\u0591-\u05C7]/g, '')           // strip nikud
    .replace(/[׳''´]/g, "'")                   // normalize single-quotes
    .replace(/[״""]/g, '"')                    // normalize double-quotes
    .replace(/[^\u05D0-\u05EA0-9\s'"]+/g, ' ') // keep only Hebrew + digits + quotes
    .replace(/\s+/g, ' ').trim();

const RASHI_KEYWORDS_NORM: string[] = [...new Set(RASHI_KEYWORDS.map(_normalizeKw))]
  .sort((a, b) => b.length - a.length);   // longest first → no short prefix steals match

const TOSAFOT_KEYWORDS_NORM: string[] = [...new Set(TOSAFOT_KEYWORDS.map(_normalizeKw))]
  .sort((a, b) => b.length - a.length);

const GEMARA_KEYWORDS_NORM: string[] = [...new Set(GEMARA_KEYWORDS.map(_normalizeKw))]
  .sort((a, b) => b.length - a.length);

const MISHNA_KEYWORDS_NORM: string[] = [...new Set(MISHNA_KEYWORDS.map(_normalizeKw))]
  .sort((a, b) => b.length - a.length);

const HEBREW_LETTER_RE = /[א-ת]/;

/**
 * Whether `line` opens with one of `keywords` AS A WHOLE WORD.
 *
 * BUG: the source-name lists contain bare, very short forms ('תו', 'בתו', 'תוס', 'רשי'), and a
 * plain `startsWith` cannot tell a source name from an ordinary word that merely begins with the
 * same letters. A commentary line opening "בתולה נשאת ליום הרביעי" starts with 'בתו', so it was
 * read as an EXPLICIT citation of Tosafot, and every consequence of that verdict followed:
 *   • the primary-source search is skipped outright (the `!explicitSecondaryTarget` gate), so the
 *     Gemara — where the line actually belongs — is never even consulted;
 *   • stripSecondaryPrefix cuts the keyword off mid-word, leaving "לה נשאת ליום הרביעי" as the
 *     Dibur Hamatchil ("תורה" → "רה", "רשימת" → "מת");
 *   • being explicit engages the flexibility ladder meant for real citations, which relaxes the
 *     search until *something* matches — landing on whichever Tosafot line shares a phrase;
 *   • previousSecondaryType is left pointing at Tosafot, so every following ד"ה / בא"ד line
 *     inherits the wrong document too.
 * Requiring that no Hebrew letter follow the keyword is what separates the two. Nothing legitimate
 * is lost: the lists are matched with `.some`, so a form like בתוד"ה is still recognised by its own
 * longer entry even though 'בתו' alone is now rejected in front of the ד.
 */
function startsWithSourceKeyword(line: string, keywords: string[]): boolean {
  return keywords.some(kw => line.startsWith(kw) && !HEBREW_LETTER_RE.test(line.charAt(kw.length)));
}

/**
 * Regex that strips a leading "source context" word (גמרא/גמ'/משנה/מתני' etc.)
 * from the start of a commentary line before checking for secondary-source keywords.
 *
 * Use-case: "בגמרא תוספות ד"ה אמרי" → strip "בגמרא" → "תוספות ד"ה אמרי" → route to Tosafot.
 *           "משנה רש"י ד"ה אמרי" → strip "משנה" → "רש"י ד"ה אמרי" → route to Rashi.
 *           "גמ' ..." (no secondary keyword after) → keep original, route to primary source.
 */
// The trailing "no Hebrew letter ahead" is the same whole-word requirement the source-name lists
// carry (see startsWithSourceKeyword): without it "משנהו של מלך" is stripped down to "ו של מלך",
// exactly as "בתולה" was cut to "לה" by the Tosafot name.
const SOURCE_CONTEXT_STRIP_RE = /^(?:בגמרא|גמרא|בגמ'|גמ'|בפיסקא|פיסקא|במשנה|משנה|מתניתין|מתניתן|מתני')(?![א-ת])\s*[:.\-]?\s*/i;

/** Leading numbering / bullet / bracketed note, e.g. "3." "(א)" "[הגהה]" "•". */
const LEADING_BULLET_STRIP_RE = /^(?:\d+[\.\)]|[ א-ת][\.\)]|\([^)]+\)|\[[^\]]+\]|[•\-\*])\s*/;

/**
 * A BARE leading "שם" — the "ibid" word standing alone, NOT the "שם ד\"ה"/"שם בא\"ד" idioms
 * (those identify a target and are handled by SECONDARY_PREFIX_STRIP_RE / inheritTargetRegex).
 */
const BARE_SHAM_STRIP_RE = /^שם\s*[:.\-]?\s*(?!ד"ה|דה|בד"ה|בדה|א"ד|בא"ד|או"ד|באו"ד|אד|באד|אוד|באוד)/i;

/**
 * Strips every leading "pointer" token that only says WHERE to look, never WHAT to look for:
 * bullets, a source-context word (גמרא / משנה / פיסקא), and a bare "שם".
 *
 * BUG-04: these were applied as a fixed one-shot sequence, so only the FIRST such token was
 * ever removed. פני יהושע routinely stacks two or three of them — "שם בפי' רש\"י בד\"ה …",
 * "שם בגמרא פיסקא על פירות הארץ …", "שם בגמרא וכו' עד חצות" — and the leftovers were fatal
 * in two separate places:
 *   • ROUTING: the keyword test is `startsWith`, so a line beginning "שם בפרש\"י בד\"ה …"
 *     matched neither the Rashi list nor the Gemara list. It was searched only in the Gemara,
 *     where the רש"י ד"ה it quotes cannot be found — and since a bare "שם" line is excluded
 *     from inheritance fallback, the line ended up with no link at all.
 *   • SCORING: every surviving pointer word occupies one of the three source-word slots the
 *     matcher may start a run at (maxStartIdx in calcContiguousScore), pushing the real
 *     Dibur Hamatchil out of reach.
 * Looping to a fixed point is bounded by construction — each pass must consume at least one
 * leading token or it stops.
 */
function stripLeadingMarkers(text: string): string {
  let out = text;
  for (let pass = 0; pass < 4; pass++) {
    const before = out;
    out = out.replace(LEADING_BULLET_STRIP_RE, '')
             .replace(SOURCE_CONTEXT_STRIP_RE, '')
             .replace(BARE_SHAM_STRIP_RE, '')
             .trim();
    if (out === before) break;
  }
  return out;
}

const getSecondaryPath = (targetSecondary: 'rashi' | 'tosafot', targetBookName: string) =>
  targetSecondary === 'rashi'
    ? `רש"י על ${targetBookName}.txt`
    : `תוספות על ${targetBookName}.txt`;

const getSecondaryBookLabel = (targetSecondary: 'rashi' | 'tosafot') =>
  targetSecondary === 'rashi' ? 'רש"י' : 'תוספות';

/**
 * Strips leading secondary source citation prefixes (e.g. רש"י ד"ה, תוספות ד"ה)
 * to leave clean Dibur Hamatchil for searching secondary and primary texts.
 */
export function normalizeHebrewQuotes(text: string): string {
  if (!text) return '';
  return text
    .replace(/[׳'’‘´]{2}/g, '"') // Map consecutive single quotes to double quotes
    .replace(/[׳'’‘´]/g, "'") // Normalize single quotes
    .replace(/[״"“”″‟„]/g, '"'); // Normalize double quotes
}

export function stripSecondaryPrefix(line: string): string {
  if (!line) return '';
  // Step 1: normalize quotes and remove HTML + nikud before regex matching (fixes BUG-37)
  //
  // BUG-03: `stripHtmlTags` replaces each tag with a SPACE, so a line whose opening word is
  // wrapped in markup \u2014 `<b>\u05D1\u05EA\u05D5\u05E1'</b> \u05D1\u05D3"\u05D4 \u05D4\u05D9\u05D4 \u05E7\u05D5\u05E8\u05D0\u2026`, which is how every line of \u05E4\u05E0\u05D9 \u05D9\u05D4\u05D5\u05E9\u05E2
  // (and most printed commentaries) is typeset \u2014 comes back as " \u05D1\u05EA\u05D5\u05E1'  \u05D1\u05D3\"\u05D4 \u2026" with a
  // LEADING SPACE. Every strip below is `^`-anchored, so all of them silently no-op and the
  // function returns the line with its citation prefix still attached. The same line without
  // the markup strips correctly, which is why this never showed up in hand-written tests.
  //
  // The damage is downstream, not here: the un-stripped prefix words ("\u05D1\u05EA\u05D5\u05E1'", "\u05D1\u05D3\"\u05D4",
  // "\u05D1\u05D2\u05DE\u05E8\u05D0", "\u05E9\u05DD") occupy source word slots 0..1, and calcContiguousScore only allows a match
  // to BEGIN within the first 3 words of the commentary line \u2014 so the real Dibur Hamatchil
  // starts at index 2 at best, and any line with a two-word prefix ("\u05E9\u05DD \u05D1\u05E4\u05D9' \u05E8\u05E9\"\u05D9 \u05D1\u05D3\"\u05D4 \u2026")
  // pushes it past the window entirely and scores exactly 0. The prefix words also become
  // segment 1 of the \u05DB\u05D5' first-anchor search ("\u05E9\u05DD \u05D1\u05D2\u05DE\u05E8\u05D0" as the anchor phrase) and inflate
  // expectedWeight with tokens that can never match anything in the target document.
  let cleaned = normalizeHebrewQuotes(stripHtmlTags(line.trim())).trim();
  cleaned = cleaned.replace(/[\u0591-\u05C7]/g, '');

  // Step 1.5: strip every leading pointer token — bullets, source context (גמרא / משנה /
  // פיסקא) and a bare "שם" — to a fixed point, so a stacked prefix like "שם בגמרא פיסקא …"
  // is fully consumed rather than only its first word (see stripLeadingMarkers / BUG-04).
  // A bare "שם" carries no target of its own, so whatever real citation text follows it must
  // be exposed here to be searched like any other line.
  cleaned = stripLeadingMarkers(cleaned);

  // Step 2: strip the secondary-source prefix.
  // Uses dynamically built regex from RASHI_KEYWORDS and TOSAFOT_KEYWORDS.
  // Applied ONCE, deliberately: unlike the pointer tokens above, the source names include
  // bare forms ('תוס', 'רש"י', 'תו') that can legitimately be the first word of a Dibur
  // Hamatchil, so looping here could eat real citation text.
  cleaned = cleaned.replace(SECONDARY_PREFIX_STRIP_RE, '');

  // Step 3: strip a bare ד"ה / בד"ה / דה that may remain after removing only the source name
  // e.g. line was "בפי' רש"י בד"ה ופליגי" — "בפי' רש"י" stripped, "בד"ה" still leads.
  cleaned = cleaned.replace(/^ב?ד"ה\s*[:.\-]?\s*/i, '');
  cleaned = cleaned.replace(/^ב?דה\s+/i, '');

  return cleaned.trim();
}

/**
 * Whether a line is a bare source label — it names רש"י / תוספות and has nothing left of its own
 * once that name is stripped ("פרש"י" on a line by itself, with no ד"ה and no text).
 *
 * runLinkingParser skips such a line outright (`explicitSecondaryTarget && !lineForDh.trim()`),
 * which means it gets no link AND does not sever the inheritance chain — the chain runs straight
 * through it, like a blank line. The editor's chain (src/utils/inheritanceChain.ts) has to skip
 * it for the same reason, or it would read the parser's own output as a broken chain.
 *
 * Only the keyword branch of the parser's test is reproduced here: the other branch ("שם ד"ה"
 * routed to whichever secondary source was active) depends on parser state that no line can
 * carry on its own. A bare "שם" or "גמרא" is deliberately NOT a bare label — the parser searches
 * those lines and severs the chain when the search fails.
 */
export function isBareSourceLabelLine(line: string): boolean {
  if (!line || !line.trim()) return false;

  // Same three steps as the keyword test in runLinkingParser: normalise, strip the pointer
  // tokens in front of the source name, then test the source names themselves.
  const normalized = normalizeText(line.trim(), false);
  const cleanedPrefix = normalized
    .replace(LEADING_BULLET_STRIP_RE, '')
    .replace(BARE_SHAM_STRIP_RE, '')
    .trim();
  const lineForKeywordCheck = stripLeadingMarkers(cleanedPrefix) || cleanedPrefix || normalized;

  const namesSecondary = startsWithSourceKeyword(lineForKeywordCheck, RASHI_KEYWORDS_NORM)
    || startsWithSourceKeyword(lineForKeywordCheck, TOSAFOT_KEYWORDS_NORM);

  return namesSecondary && !stripSecondaryPrefix(line.trim()).trim();
}

/**
 * The "ibid" idiom (בא"ד / א"ד and spelling variants, optionally preceded by "שם") that states
 * in the line's own text that it continues the line above it. Deliberately excludes ד"ה / בד"ה:
 * those name a Dibur Hamatchil of their own and are searched, not inherited.
 *
 * Single definition for the whole codebase — the parser reads it per line, and the editor's
 * inheritance chain (src/utils/inheritanceChain.ts) reproduces the parser's chain from it.
 */
const BAAD_CONTINUATION_RE = /^(?:שם\s+)?(?:או"ד|באו"ד|א"ד|בא"ד|אד|באד|אוד|באוד)(?:\s|$|[:.\-])/i;

/** Whether a commentary line opens with the explicit בא"ד/א"ד continuation idiom. */
export function isBaadContinuationLine(line: string): boolean {
  if (!line || !line.trim()) return false;
  return BAAD_CONTINUATION_RE.test(normalizeText(line.trim(), false));
}

/**
 * Whether the first content line at or after `fromLineIdx1` (blank lines and headers skipped)
 * opens with בא"ד — i.e. whether inheritance carries over the header(s) at that point.
 *
 * A header normally re-initialises the inheritance chain, but a בא"ד line states in its own text
 * that it continues the line above it, and that statement holds across a header just as it holds
 * inside a segment: when it is the first thing a segment says, the previous segment's context is
 * what it continues. Headers are skipped in the scan so an empty segment (header immediately
 * followed by another header) does not hide the בא"ד line behind it.
 */
export function firstContentLineIsBaad(lines: string[], fromLineIdx1: number, profile?: SourceProfile): boolean {
  for (let i = Math.max(1, fromLineIdx1); i <= lines.length; i++) {
    const raw = lines[i - 1] ?? '';
    if (!raw.trim() || isHeaderLine(raw, profile)) continue;
    return isBaadContinuationLine(raw);
  }
  return false;
}

/**
 * המקבילה ההלכתית ל-firstContentLineIsBaad: האם שורת התוכן הראשונה מ-fromLineIdx1 ואילך היא
 * שורה בלי מספור, כלומר המשך של הקטע שמעל הכותרת ולא פתיחה של קטע חדש.
 */
export function firstContentLineIsUnnumbered(
  lines: string[],
  fromLineIdx1: number,
  profile?: SourceProfile
): boolean {
  for (let i = Math.max(1, fromLineIdx1); i <= lines.length; i++) {
    const raw = lines[i - 1] ?? '';
    if (!raw.trim() || isHeaderLine(raw, profile)) continue;
    return !hasHalachaNumbering(raw);
  }
  return false;
}

export interface HeaderSegment {
  headerTitle: string;
  headerLineIndex: number; // 1-based physical line index
  startLine: number;       // First content line after header
  endLine: number;         // Last line in section
}

/**
 * Breaks a full document string into physical lines and header segments.
 * Strictly preserves physical line breaks (\n / \r\n).
 */
export function parseDocumentSegments(rawText: string, profile?: SourceProfile): { lines: string[]; segments: HeaderSegment[] } {
  // Markup is dropped here, at the single point every document passes through, so the stored
  // lines are the ones searched, indexed and displayed alike. Heading tags stay: they are what
  // marks a segment boundary. Idempotent, which is what lets the callers that re-parse an
  // already-parsed session (export, the editor's segment list) hand their lines straight back.
  const lines = rawText.split(/\r?\n/)
    .map(line => (HEADER_TAG_RE.test(line) ? line : stripContentMarkup(line)));
  const segments: HeaderSegment[] = [];

  let currentHeader: HeaderSegment | null = null;

  for (let i = 0; i < lines.length; i++) {
    const lineNum = i + 1; // 1-based
    if (isHeaderLine(lines[i], profile)) {
      if (currentHeader) {
        currentHeader.endLine = i; // Line before current header
        segments.push(currentHeader);
      }
      currentHeader = {
        headerTitle: extractHeaderTitle(lines[i]),
        headerLineIndex: lineNum,
        startLine: lineNum + 1,
        endLine: lines.length
      };
    }
  }

  if (currentHeader) {
    currentHeader.endLine = lines.length;
    segments.push(currentHeader);
  } else if (lines.length > 0) {
    // If no header found, wrap whole document in single general segment
    segments.push({
      headerTitle: "תוכן ראשי",
      headerLineIndex: 0,
      startLine: 1,
      endLine: lines.length
    });
  }

  return { lines, segments };
}

/**
 * הסגמנט בספר היעד שסגמנט הפירוש מיושר אליו, או `undefined` כשאין כזה.
 *
 * **נקודת הכניסה היחידה ליישור סגמנטים** — המנוע, העורך והייצוא קוראים לה כולם, כדי ששלושתם
 * יראו את אותה חלוקה.
 *
 * זהות קודמת להכלה, ולא ההתאמה הראשונה בסדר המסמך. `areHeadersMatching` כבר מונע את ההתנגשות
 * שהייתה כאן (ראו שם), אך שתי הדרכים אינן שוות ערך: כותרת מוכלת היא ראיה חלשה מזהות, ואם שתיהן
 * קיימות במסמך אין סיבה להכריע לפי מי מהן נכתבה קודם.
 */
export function findMatchingSegment(
  segments: HeaderSegment[] | null | undefined,
  commHeaderTitle: string
): HeaderSegment | undefined {
  if (!segments || segments.length === 0) return undefined;
  const norm = normalizeHeaderForComparison(commHeaderTitle);
  return (
    segments.find(s => normalizeHeaderForComparison(s.headerTitle) === norm) ??
    segments.find(s => areHeadersMatching(commHeaderTitle, s.headerTitle))
  );
}

/**
 * Index of the first commentary segment whose header has a counterpart ("כותרת מקבילה") in any
 * of the target documents, or -1 when no commentary header matches anything.
 *
 * Everything before that segment is the commentary's front matter — a title page, an approbation,
 * an author's preface, a general introduction. Such text quotes nothing in particular, yet the
 * search would still run over it: a commentary segment with no matching source segment falls back
 * to scanning the ENTIRE target document (`srcSeg ? srcSeg.startLine : 1`), so the preface was
 * being matched against the whole book and handed whatever line happened to share vocabulary
 * with it. Those links are noise by construction — there is nothing there to link to.
 *
 * -1 (no header matches at all) deliberately means "no front matter": documents with no headers,
 * or whose headers are written in a form the matcher does not recognise, must keep being linked
 * exactly as before rather than being skipped in their entirety.
 */
export function findFirstAlignedSegmentIndex(
  commSegments: HeaderSegment[],
  targetSegmentLists: (HeaderSegment[] | null | undefined)[]
): number {
  return commSegments.findIndex(commSeg =>
    targetSegmentLists.some(list => !!findMatchingSegment(list, commSeg.headerTitle))
  );
}

/**
 * First commentary line (1-based) that takes part in linking — everything above it is front
 * matter, per findFirstAlignedSegmentIndex. Returns 1 when there is no front matter.
 *
 * The editor calls this to reproduce the parser's own boundary, so a front-matter line is not
 * reported as an unlinked line the user still has to deal with.
 */
export function findLinkingStartLine(
  commentaryLines: string[],
  sourceLines: string[],
  rashiLines?: string[],
  tosafotLines?: string[],
  profile?: SourceProfile
): number {
  if (!commentaryLines || commentaryLines.length === 0) return 1;

  const commSegments = parseDocumentSegments(commentaryLines.join('\n'), profile).segments;
  const segmentsOf = (lines?: string[]) =>
    lines && lines.length > 0 ? parseDocumentSegments(lines.join('\n'), profile).segments : null;

  const firstAligned = findFirstAlignedSegmentIndex(commSegments, [
    segmentsOf(sourceLines),
    segmentsOf(rashiLines),
    segmentsOf(tosafotLines)
  ]);
  if (firstAligned <= 0) return 1;

  const seg = commSegments[firstAligned];
  return seg.headerLineIndex > 0 ? seg.headerLineIndex : seg.startLine;
}

/**
 * Extracts potential Dibur Hamatchil search phrase from commentary line.
 *
 * `profile` selects the boundary policy. It is optional, and its absence means
 * `DEFAULT_PROFILE` — so every existing caller keeps the ש"ס behaviour untouched.
 */
export function extractDiburHamatchil(
  line: string,
  delimiter?: string,
  maxWords: number = 12,
  profile: SourceProfile = DEFAULT_PROFILE
): { dhText: string; cleanDh: string; isExplicitDelimiter: boolean } {
  const cleanLine = stripHtmlTags(line);
  const normLine = normalizeText(cleanLine, true);
  if (!normLine) return { dhText: '', cleanDh: '', isExplicitDelimiter: false };

  let dhPart = '';
  let explicit = false;
  // ספרי הלכה בלבד: מקף / נקודה / נקודתיים / "כו'" — ראו findDhBoundary והערת "גבול הד"ה".
  const punctBoundary = profile.dhTerminatesAtPunctuation ? findDhBoundary(cleanLine) : null;

  // 1. If custom delimiter defined, non-empty, and present in line
  if (delimiter && delimiter.trim() && cleanLine.includes(delimiter.trim())) {
    const trimmedDelim = delimiter.trim();
    const idx = cleanLine.indexOf(trimmedDelim);
    dhPart = cleanLine.substring(0, idx);
    explicit = true;
  }
  // 2. ספרי הלכה: אסימון הפיסוק סוגר את הד"ה, בלי תלות בהגדרות המשתמש.
  else if (punctBoundary !== null) {
    dhPart = cleanLine.substring(0, punctBoundary);
    explicit = true;
  }
  // 3. Check for כו' / וכו' / וגו' / וגומר / וכולי — the ש"ס continuation-segment path.
  //    Off in ספרי הלכה, where branch 2 already cut the ד"ה at the כו' itself.
  else if (
    profile.usesContinuationSegments &&
    /(?:^|\s)(?:ו?כו'|וגו'|וגומר|וכולי)(?:\s|$|[.,:;])/i.test(cleanLine)
  ) {
    dhPart = cleanLine;
    explicit = true;
  }
  // 4. Fallback when no delimiter configured: do NOT truncate automatically on '.' or ':'
  else {
    dhPart = cleanLine;
    explicit = false;
  }

  // Limit DH to a maximum number of words to avoid over-matching on long commentary lines.
  // Callers pass a smaller maxWords for Tosafot (e.g. 7) and the default (12) for other sources.
  const dhWords = dhPart.trim().split(/\s+/).filter(Boolean);
  if (dhWords.length > maxWords) {
    dhPart = dhWords.slice(0, maxWords).join(' ');
  }

  const cleanDh = normalizeText(dhPart);
  return { dhText: dhPart.trim(), cleanDh, isExplicitDelimiter: explicit };
}

/**
 * Perf helper (behavior-neutral): precomputes, once per document, the normalized text,
 * word-tokenization, and nikud fingerprint for every physical line. These are pure
 * functions of the raw line text alone (no dependency on which commentary line is being
 * matched), so computing them once up front and reusing them is identical to recomputing
 * normalizeText/getNikudFingerprint on the fly for every single search -- just far fewer
 * redundant calls when the same source line is scanned against many commentary lines.
 */
interface LineCacheEntry {
  norm: string;
  words: string[];
  fp: string;
  /**
   * `normalizeText(norm)` re-split into words — what the abbreviation-expansion path needs
   * for a line whose expansion came back unchanged. Filled lazily on first use so lines that
   * are never scanned cost nothing.
   */
  reNormWords?: string[];
}

/**
 * Words of a line's doubly-normalised form, memoised on the line's cache entry.
 * Only called on the path where expansion was a no-op, so the result is exactly what
 * `normalizeText(expDocLineNorm).split(...)` would have produced.
 */
function reNormalizedWords(entry: LineCacheEntry | undefined, norm: string): string[] {
  if (!entry) {
    const reNorm = normalizeText(norm);
    return reNorm.split(/\s+/).filter(Boolean);
  }
  let words = entry.reNormWords;
  if (words === undefined) {
    const reNorm = normalizeText(norm);
    // Normalising an already-normalised line is usually a fixed point. When it is, the
    // result is term-for-term `entry.words`, so we return that array itself — letting the
    // caller's reference-equality checks recognise the two as the same input.
    words = reNorm === norm ? entry.words : reNorm.split(/\s+/).filter(Boolean);
    entry.reNormWords = words;
  }
  return words;
}

/**
 * How many leading tokens of a line the abbreviation pass needs to consider.
 *
 * Derivation, COMMENTARY side (searchPhrase / fullLineText) — exact:
 *   calcContiguousScore starts at source word ≤ 2 and advances at most maxDhWords (≤ 12)
 *   words, so it reads source words 0..13. The explicit-delimiter branch matches a ≤ 12-word
 *   phrase, so it too stays inside the first ~15 words. Nothing reads further.
 *
 * Expansion can shorten text — a matched trigram collapses to a single dictionary phrase,
 * at worst 3 tokens in for 1 word out — so covering the first 14 output words needs at most
 * the first 42 input tokens. 64 leaves roughly 50% headroom over that worst case, and lines
 * shorter than the window are unaffected. Expanding beyond it cannot change any word that is
 * ever read, because the pass runs left-to-right and only rewrites at or after its match.
 *
 * TARGET side (docLineNorm) — a bounded approximation, not an exact cover. Since the BUG-02
 * anchor fix (see the policy note at the top of this file) a match may begin anywhere in the
 * target line, so the expanded target line is no longer read only through a short prefix.
 * The window is kept deliberately: expanding every candidate line in full would multiply the
 * cost of the hottest loop in the parser, for a strictly second-order gain. Nothing is lost
 * that was previously found — the plain (unexpanded) `calcContiguousScore(source, target)`
 * pairing always scores the whole target line, at any depth. The only thing bounded past
 * token 64 is abbreviation-aware matching, i.e. a deep anchor that would need a ראשי-תיבות
 * expansion inside a 64+ word line to be recognised. If such cases turn up in practice, the
 * fix is to raise this constant for the target-line call site alone (line ~1007), not to
 * reintroduce a positional cap.
 */
const EXPANSION_TOKEN_WINDOW = 64;

function buildLineCache(lines: string[]): LineCacheEntry[] {
  return lines.map(raw => {
    const norm = normalizeText(raw);
    const fp = raw ? raw.split(/\s+/).filter(Boolean).map(w => getNikudFingerprint(w)).join('') : '';
    return { norm, words: norm.split(/\s+/).filter(Boolean), fp };
  });
}

/**
 * Main 5-Step Parser Execution Engine
 */
export function runLinkingParser(
  commentaryRaw: string,
  sourceRaw: string,
  config: PluginConfig,
  rashiRaw?: string,
  tosafotRaw?: string,
  rashiLinks?: any[],
  tosafotLinks?: any[]
): {
  links: OtzariaLink[];
  commentaryLines: string[];
  sourceLines: string[];
  rashiLines?: string[];
  tosafotLines?: string[];
  dhHighlights: Record<number, DHHighlight>;
} {
  // Perf: gate the (very) verbose tracing behind an explicit debug flag.
  // Off by default -> identical return value, just without console I/O overhead.
  const DEBUG = (config as any).debug === true;
  if (DEBUG) console.log(`\n🚀 runLinkingParser START: config.targetBookName='${config.targetBookName}', rashiRaw=${!!rashiRaw}, tosafotRaw=${!!tosafotRaw}`);
  /**
   * מדיניות השורות של קטגוריית המקור ושל מבנה הקטעים שנבחר באפיון — נבחרת פעם אחת ומחליפה
   * קומץ קבועים שהיו קשיחים בקוד. עבור 'shas' ו-'tanakh' הפרופיל הוא DEFAULT_PROFILE, שכל
   * ערכיו זהים לקבועים הקודמים, ולכן הפלט לקטגוריות האלה אינו משתנה.
   * ראו src/utils/halachaAlgorithm.ts.
   */
  const profile = profileForConfig(config);
  /**
   * כוונוני המעבר הנוכחי. היום רץ מעבר אחד בלבד, ו-`basePassSpec` מחזיר בדיוק את הקבועים
   * שהיו כתובים קשיח במנוע — ולכן הפלט אינו משתנה כהוא זה.
   *
   * `let` ולא `const`, ולא פרמטר: פונקציות החיפוש (`searchLineInDoc`,
   * `searchPrimaryWithFirstAnchor`, `attemptFlexibleRetry`) הן סגירות שמוגדרות פעם אחת לפני
   * לולאת השורות, וכולן קוראות מכאן. כשמנוע המעברים ייכנס (שלב 4 בתוכנית) הוא יציב כאן את
   * הרשומה של כל מעבר לפני שהוא מריץ אותו — הרצה סדרתית וסינכרונית, בלי מקביליות. החלופה,
   * להשחיל פרמטר רביעה-עשר דרך שש נקודות קריאה שכבר נושאות שלוש-עשרה, הייתה מסתירה את
   * השינוי בלי לקנות דבר כל עוד יש מעבר אחד.
   */
  let activePass: PassSpec = basePassSpec(profile, config.useFuzzyMatching !== false);
  /** מיקום המעבר הפעיל בסולם — 0 לש"ס, שבו יש מעבר אחד. מזין את הוודאות בלבד. */
  let activePassIndex = 0;
  const commDoc = parseDocumentSegments(commentaryRaw, profile);
  const srcDoc = parseDocumentSegments(sourceRaw, profile);
  const rashiDoc = rashiRaw ? parseDocumentSegments(rashiRaw, profile) : null;
  const tosafotDoc = tosafotRaw ? parseDocumentSegments(tosafotRaw, profile) : null;

  const enableWordWeighting = config.useWordWeighting !== false;
  const srcIdfMap = enableWordWeighting ? calculateDocumentIdfWeights(srcDoc.lines, commDoc.lines) : undefined;
  const rashiIdfMap = (enableWordWeighting && rashiDoc) ? calculateDocumentIdfWeights(rashiDoc.lines, commDoc.lines) : undefined;
  const tosafotIdfMap = (enableWordWeighting && tosafotDoc) ? calculateDocumentIdfWeights(tosafotDoc.lines, commDoc.lines) : undefined;

  // Perf: precompute per-line normalization/tokenization/fingerprint caches once per
  // document (see buildLineCache above) instead of recomputing them on every search.
  const srcLineCache = buildLineCache(srcDoc.lines);
  const rashiLineCache = rashiDoc ? buildLineCache(rashiDoc.lines) : undefined;
  const tosafotLineCache = tosafotDoc ? buildLineCache(tosafotDoc.lines) : undefined;

  /**
   * What both search functions return. `evidence` is display-only: it records how the winner
   * was found so calculateLinkConfidence can describe it, and nothing reads it back.
   */
  interface SearchResult {
    lineNum: number | null;
    matchedCount: number;
    matchedWordCount: number;
    expectedWeight: number;
    topK: { lineNum: number; score: number }[];
    evidence: MatchEvidence;
  }

  // First Anchor Priority search for primary sources containing כו' / וכו'.
  const searchPrimaryWithFirstAnchor = (
    docLines: string[],
    start: number,
    end: number,
    fullLineText: string,
    idfMap?: Record<string, number>,
    prevLineNum?: number | null,
    requireStartAtFirstWord: boolean = false,
    lineCache?: LineCacheEntry[],
    maxDhWords: number = 12,
    excludeLines?: Set<number>
  ): SearchResult => {
    if (!docLines || docLines.length === 0) {
      return { lineNum: null, matchedCount: 0, matchedWordCount: 0, expectedWeight: 0, topK: [], evidence: EMPTY_EVIDENCE };
    }

    const validStart = Math.max(1, Math.min(start, docLines.length));
    const validEnd = Math.max(validStart, Math.min(end, docLines.length));

    const segments = fullLineText.split(/(?:^|\s)ו?כו'(?:\s|$|[.,:;])/i).map(s => s.trim()).filter(Boolean);
    if (segments.length <= 1) {
      const cleanDh = normalizeText(fullLineText);
      return searchLineInDoc(docLines, validStart, validEnd, cleanDh, fullLineText, true, idfMap, prevLineNum, requireStartAtFirstWord, lineCache, maxDhWords, 0.65, excludeLines);
    }

    const seg1 = segments[0];
    const seg2 = segments[1];
    const seg3 = segments[2];

    /**
     * BUG-06: the segments were used at their FULL length, and only the first of them is
     * actually a quotation.
     *
     * "כו'" means "…and so on": the author quotes a few words, elides, resumes for a few more
     * words, and then writes his own essay — all on one physical line. Splitting on כו' yields
     * seg1 = the opening quote, seg2 = the resumed quote *immediately followed by hundreds of
     * words of original prose that quote nothing*. Real case, פני יהושע ברכות line 37:
     *   seg1 = "ר\"נ סבר לה כר\"י"        →  4 words, the actual anchor
     *   seg2 = "ותרתי דיממא אע\"ג דלענין…" → 52 words, of which 2 are the quote
     *
     * scoreSegment is a bag-of-words sum with no length normalisation, so its value grows with
     * the segment's word count: seg1 scored 1.35 (×2.5 = 3.38) on the correct line while seg2
     * scored 8.82 (×1.2 = 10.59) — the "anchor weight bonus" was swamped by the tail, and the
     * ranking was decided by which line happened to share vocabulary with the commentator's
     * own discussion. Line 37 linked to גמרא 75 (a passage about חצות הלילה) instead of גמרא 68,
     * the line it quotes verbatim.
     *
     * Capping the continuation segments keeps the part that is genuinely a quote and drops the
     * essay. seg1 keeps the caller's maxDhWords (the same bound extractDiburHamatchil applies
     * to a Dibur Hamatchil); seg2/seg3 get a tighter one, because a resumed quote after כו' is
     * short by nature — it exists to pin down where the elision ends.
     */
    const seg1Words = normalizeText(seg1).split(/\s+/).filter(Boolean).slice(0, maxDhWords);
    const contWords = (s: string | undefined) =>
      s ? normalizeText(s).split(/\s+/).filter(Boolean).slice(0, CONTINUATION_SEGMENT_MAX_WORDS) : [];
    const seg2Words = contWords(seg2);
    const seg3Words = contWords(seg3);

    const abbrDict = config.customAbbreviations || config.gsAbbreviations || DEFAULT_ABBREVIATIONS;
    // From the pass spec, like the copy in searchLineInDoc — otherwise a pass that turns
    // fuzzy matching off would leave this path fuzzy. Identical value for the single pass
    // that runs today (basePassSpec seeds it from the same config flag).
    const enableFuzzy = activePass.fuzzy;

    // Perf: seg1/seg2/seg3 are fixed for this call while the context line varies, and the
    // seg2/seg3 look-ahead windows re-scan the same lines for every consecutive anchor —
    // so the identical (segment, line) expansion was recomputed 10-15 times over. Cache it
    // per line, one slot per segment.
    //
    // When the expansion leaves the segment unchanged (the common case) we hand back the
    // caller's own unexpanded array: `segWords` is by construction exactly
    // `normalizeText(seg).split(...)`, which is what the expanded path would have produced.
    // Callers then use reference equality to skip a scoring pass over identical input.
    const segExpansionCache: Array<Array<string[] | undefined>> = [[], [], []];
    const expandedSegWords = (
      slot: number,
      seg: string,
      segWords: string[],
      lineIdx: number,
      contextNorm: string
    ): string[] => {
      if (config.useAbbreviationExpansion === false) return segWords;
      const cached = segExpansionCache[slot][lineIdx];
      if (cached !== undefined) return cached;
      const expanded = expandAbbreviationsInText(seg, contextNorm, abbrDict, config.gsReplacements);
      // The expanded form gets the same word cap as its plain counterpart (BUG-06) — an
      // uncapped expansion here would reintroduce the very tail the cap exists to remove.
      const cap = slot === 0 ? maxDhWords : CONTINUATION_SEGMENT_MAX_WORDS;
      const out = expanded === seg
        ? segWords
        : normalizeText(expanded).split(/\s+/).filter(Boolean).slice(0, cap);
      segExpansionCache[slot][lineIdx] = out;
      return out;
    };

    const seg1ExpectedWeight = seg1Words.reduce((sum, w) => sum + getCombinedWordWeight(w, enableWordWeighting, idfMap), 0);
    const fullWords = normalizeText(fullLineText).split(/\s+/).filter(Boolean);
    const expectedWeight = fullWords.reduce((sum, w) => sum + getCombinedWordWeight(w, enableWordWeighting, idfMap), 0);

    // Per-segment weights, for the confidence denominator only. This path's ranking score
    // carries anchor multipliers (×2.5 / ×1.2 / ×1.0) that put it on its own scale, so
    // coverage is measured against the raw segment weights the scorers could actually earn.
    const segExpectedWeight = (words: string[]) =>
      words.reduce((sum, w) => sum + getCombinedWordWeight(w, enableWordWeighting, idfMap), 0);
    const seg2ExpectedWeight = segExpectedWeight(seg2Words);
    const seg3ExpectedWeight = segExpectedWeight(seg3Words);

    let bestLine: number | null = null;
    let maxScore = -Infinity;
    let bestMatchedCount = 0;
    let bestMatchedWordCount = 0;
    // Runner-up ranking score, for the discriminative margin.
    let secondScore = -Infinity;
    // Raw (pre-multiplier) segment scores of the winning line, plus whether segment 1 —
    // the actual quotation — was found verbatim.
    let bestRawMatched = 0;
    let bestRawWindow = 0;
    let bestSeg1Exact = false;

    /**
     * Scorer for a CONTINUATION fragment — the words after a כו'.
     *
     * Segment 1 deliberately stays on scoreSegment (bag of words): measured over the
     * known-target set it ranks the correct line first in 11 of 13 cases, and rescoring it as
     * a run instead dropped the whole engine well below its baseline. The opening of a
     * citation is short and often generic, and a bag of words is the more forgiving read of it.
     *
     * The continuation is the opposite case. It is a brief resumed quote followed immediately
     * by the commentator's own essay, all inside one fragment, and a bag of words cannot tell
     * the two apart — so it was either flooded by the essay (line 37: 52 words of prose
     * outscoring the real anchor by 10.59 to 3.38) or amputated by the word cap that fixed
     * that (line 292). A run separates them for free: the quote matches consecutively, the
     * essay does not.
     *
     * Gaps: up to GAP_LIMIT skipped words, each costing GAP_PENALTY, because one variant
     * reading or an abbreviation that expands to two words must not sever the run — the
     * commentary quotes "אי הכי אימא סיפא" where the Gemara reads "אי הכי סיפא", and a strict
     * run collapses a 4-word match to 2 there. Only the score at the last real match is kept,
     * so a skip that leads nowhere leaves no penalty behind. A single matched word is not a
     * resumed quote, hence the `>= 2` floor.
     */
    const CONT_GAP_LIMIT = 2;
    const CONT_GAP_PENALTY = 0.5;

    const scoreContinuationRun = (segWords: string[], docLineNorm: string, docWords: string[]): number => {
      if (segWords.length === 0) return 0;
      const segPhrase = segWords.join(' ');
      if (docLineNorm.includes(segPhrase)) {
        return segWords.reduce((sum, w) => sum + getCombinedWordWeight(w, enableWordWeighting, idfMap) * 1.5, 5);
      }
      const weights = segWords.map(w => getCombinedWordWeight(w, enableWordWeighting, idfMap));
      let best = 0;
      for (let s = 0; s < segWords.length; s++) {
        for (let d = 0; d < docWords.length; d++) {
          let i = s, j = d, gaps = 0, running = 0, matched = 0;
          let scoreAtLastMatch = 0, matchedAtLast = 0;
          while (i < segWords.length && j < docWords.length) {
            const sim = getWordSimilarity(segWords[i], docWords[j], enableFuzzy);
            if (sim > 0) {
              running += sim * weights[i];
              matched++;
              scoreAtLastMatch = running;
              matchedAtLast = matched;
              i++; j++;
              continue;
            }
            if (gaps >= CONT_GAP_LIMIT) break;
            // Skip whichever side re-synchronises the two sequences.
            const skipSeg  = i + 1 < segWords.length ? getWordSimilarity(segWords[i + 1], docWords[j], enableFuzzy) : 0;
            const skipDoc  = j + 1 < docWords.length ? getWordSimilarity(segWords[i], docWords[j + 1], enableFuzzy) : 0;
            const skipBoth = (i + 1 < segWords.length && j + 1 < docWords.length)
              ? getWordSimilarity(segWords[i + 1], docWords[j + 1], enableFuzzy) : 0;
            const bestSkip = Math.max(skipSeg, skipDoc, skipBoth);
            if (bestSkip <= 0) break;
            gaps++;
            running -= CONT_GAP_PENALTY;
            if (bestSkip === skipBoth) { i++; j++; }
            else if (bestSkip === skipSeg) { i++; }
            else { j++; }
          }
          if (matchedAtLast >= 2 && scoreAtLastMatch > best) best = scoreAtLastMatch;
        }
      }
      return best;
    };

    const scoreSegment = (segWords: string[], docLineNorm: string, docWords: string[]): number => {
      if (segWords.length === 0) return 0;
      const segPhrase = segWords.join(' ');
      if (docLineNorm.includes(segPhrase)) {
        return segWords.reduce((sum, w) => sum + getCombinedWordWeight(w, enableWordWeighting, idfMap) * 1.5, 5);
      }
      let matched = 0;
      segWords.forEach(sw => {
        let maxSim = 0;
        docWords.forEach(dw => {
          const sim = getWordSimilarity(sw, dw, enableFuzzy);
          if (sim > maxSim) maxSim = sim;
        });
        const wWeight = getCombinedWordWeight(sw, enableWordWeighting, idfMap);
        matched += maxSim * wWeight;
      });
      return matched;
    };

    for (let lNum = validStart; lNum <= validEnd; lNum++) {
      // Dedup guard: skip a secondary-source line already claimed by an earlier explicit
      // ד"ה/בד"ה citation in this same commentary segment (see usedSecondaryLines below).
      if (excludeLines && excludeLines.has(lNum)) continue;
      const docLineRaw = docLines[lNum - 1];
      if (!docLineRaw) continue;
      const cachedLine = lineCache?.[lNum - 1];
      const docLineNorm = cachedLine ? cachedLine.norm : normalizeText(docLineRaw);
      if (!docLineNorm) continue;
      const docWords = cachedLine ? cachedLine.words : docLineNorm.split(/\s+/).filter(Boolean);
      if (docWords.length === 0) continue;

      const expSeg1Words = expandedSegWords(0, seg1, seg1Words, lNum, docLineNorm);

      const score1 = expSeg1Words === seg1Words
        ? scoreSegment(seg1Words, docLineNorm, docWords)
        : Math.max(
            scoreSegment(seg1Words, docLineNorm, docWords),
            scoreSegment(expSeg1Words, docLineNorm, docWords)
          );

      const minSeg1Threshold = Math.max(0.4, seg1ExpectedWeight * 0.4);
      if (score1 < minSeg1Threshold) continue;

      let seqScore = score1 * 2.5; // Anchor Weight bonus for First Anchor
      let foundSeq2 = !seg2Words.length;
      let foundSeq3 = !seg3Words.length;
      // Hoisted out of the two blocks below so the winner-recording step can read them as
      // confidence evidence. Same values, same assignments — only the scope changed.
      let bestSeg2Score = 0;
      let bestSeg3Score = 0;

      if (seg2Words.length > 0) {
        for (let nextL = lNum; nextL <= Math.min(docLines.length, lNum + 10); nextL++) {
          const nextRaw = docLines[nextL - 1];
          if (!nextRaw) continue;
          const nextCached = lineCache?.[nextL - 1];
          const nextNorm = nextCached ? nextCached.norm : normalizeText(nextRaw);
          const nextWords = nextCached ? nextCached.words : nextNorm.split(/\s+/).filter(Boolean);
          // Expand abbreviations in segment 2 (context-dependent on the candidate line),
          // same as segment 1 above, so ר"ת inside the middle clause of a כו'-quote resolves too.
          const expSeg2Words = expandedSegWords(1, seg2, seg2Words, nextL, nextNorm);
          const s2 = expSeg2Words === seg2Words
            ? scoreContinuationRun(seg2Words, nextNorm, nextWords)
            : Math.max(
                scoreContinuationRun(seg2Words, nextNorm, nextWords),
                scoreContinuationRun(expSeg2Words, nextNorm, nextWords)
              );
          if (s2 > bestSeg2Score) {
            bestSeg2Score = s2;
            if (s2 >= 0.4) foundSeq2 = true;
          }
        }
        seqScore += bestSeg2Score * 1.2;
      }

      if (seg3Words.length > 0 && foundSeq2) {
        for (let nextL = lNum; nextL <= Math.min(docLines.length, lNum + 15); nextL++) {
          const nextRaw = docLines[nextL - 1];
          if (!nextRaw) continue;
          const nextCached = lineCache?.[nextL - 1];
          const nextNorm = nextCached ? nextCached.norm : normalizeText(nextRaw);
          const nextWords = nextCached ? nextCached.words : nextNorm.split(/\s+/).filter(Boolean);
          // Expand abbreviations in segment 3 as well, for the same reason as segment 2.
          const expSeg3Words = expandedSegWords(2, seg3, seg3Words, nextL, nextNorm);
          const s3 = expSeg3Words === seg3Words
            ? scoreContinuationRun(seg3Words, nextNorm, nextWords)
            : Math.max(
                scoreContinuationRun(seg3Words, nextNorm, nextWords),
                scoreContinuationRun(expSeg3Words, nextNorm, nextWords)
              );
          if (s3 > bestSeg3Score) {
            bestSeg3Score = s3;
            if (s3 >= 0.4) foundSeq3 = true;
          }
        }
        seqScore += bestSeg3Score * 1.0;
      }

      let distPenalty = 0;
      if (prevLineNum !== null && prevLineNum !== undefined && prevLineNum > 0) {
        const diff = lNum - prevLineNum;
        if (diff < 0) {
          distPenalty = Math.abs(diff) * 0.08;
        } else if (diff > 5) {
          distPenalty = (diff - 5) * 0.03;
        }
      }

      const finalCandidateScore = seqScore - distPenalty;

      if (finalCandidateScore > maxScore) {
        secondScore = maxScore;
        maxScore = finalCandidateScore;
        bestLine = lNum;
        // Use the full combined (post-penalty) score, not just segment 1's raw score, so
        // downstream confidence math (which divides by the whole-line expectedWeight) sees
        // all the evidence actually gathered across seg1/seg2/seg3 — not a fraction of it.
        bestMatchedCount = finalCandidateScore;
        bestMatchedWordCount = seg1Words.length
          + (foundSeq2 ? seg2Words.length : 0)
          + (foundSeq3 ? seg3Words.length : 0);
        // Evidence: raw segment scores against the raw segment weights. A continuation that
        // was not found contributes to neither side — an unfound seg2 is usually the
        // commentator's own essay rather than a missed quotation (see the BUG-06 note above),
        // so charging its weight to the denominator would punish sound links.
        bestRawMatched = score1 + (foundSeq2 ? bestSeg2Score : 0) + (foundSeq3 ? bestSeg3Score : 0);
        bestRawWindow = seg1ExpectedWeight
          + (foundSeq2 ? seg2ExpectedWeight : 0)
          + (foundSeq3 ? seg3ExpectedWeight : 0);
        bestSeg1Exact = docLineNorm.includes(seg1Words.join(' '));
      } else if (finalCandidateScore > secondScore) {
        secondScore = finalCandidateScore;
      }
    }

    if (bestLine !== null) {
      return {
        lineNum: bestLine,
        matchedCount: bestMatchedCount,
        matchedWordCount: bestMatchedWordCount,
        expectedWeight,
        topK: [{ lineNum: bestLine, score: bestMatchedCount }],
        evidence: {
          matchedWeight: bestRawMatched,
          windowWeight: bestRawWindow,
          runWords: bestMatchedWordCount,
          // This path scores segments as bags/runs and never retains per-word similarities.
          // Reporting the run as fully exact would overstate it, so mean similarity is set to
          // the stem-match level (0.92) — the model's near-neutral point — which leaves the
          // verdict to coverage, run length, margin and the verbatim flag.
          simSum: bestMatchedWordCount * 0.92,
          winnerScore: bestMatchedCount,
          runnerUpScore: secondScore > 0 ? secondScore : 0,
          exactPhrase: bestSeg1Exact
        }
      };
    }

    const cleanDh = normalizeText(fullLineText);
    return searchLineInDoc(docLines, validStart, validEnd, cleanDh, fullLineText, true, idfMap, prevLineNum, requireStartAtFirstWord, lineCache, maxDhWords, 0.65, excludeLines);
  };

  // Primary search function: matches phrase or finds longest contiguous matching prefix from commentary line
  const searchLineInDoc = (
    docLines: string[],
    start: number,
    end: number,
    searchPhrase: string,
    fullLineText: string,
    isExplicit: boolean,
    idfMap?: Record<string, number>,
    prevLineNum?: number | null,
    requireStartAtFirstWord: boolean = false,
    lineCache?: LineCacheEntry[],
    maxDhWords: number = 12,
    thresholdMultiplier: number = 0.65,
    excludeLines?: Set<number>
  ): SearchResult => {
    if (!docLines || docLines.length === 0) {
      if (DEBUG) console.log(`    ⚠️ searchLineInDoc: docLines is empty!`);
      return { lineNum: null, matchedCount: 0, matchedWordCount: 0, expectedWeight: 0, topK: [], evidence: EMPTY_EVIDENCE };
    }

    const validStart = Math.max(1, Math.min(start, docLines.length));
    const validEnd = Math.max(validStart, Math.min(end, docLines.length));

    const searchWords = searchPhrase.split(/\s+/).filter(Boolean);
    const fullWords = normalizeText(fullLineText).split(/\s+/).filter(Boolean);
    const abbrDict = config.customAbbreviations || config.gsAbbreviations || DEFAULT_ABBREVIATIONS;

    const wordsForWeight = isExplicit ? searchWords : fullWords;
    const expectedWeight = wordsForWeight.reduce(
      (sum, w) => sum + getCombinedWordWeight(w, enableWordWeighting, idfMap),
      0
    );

    // Confidence denominator (display-only, see the model note above calculateLinkConfidence).
    // Deliberately NOT expectedWeight: calcContiguousScore caps its source at maxDhWords, so
    // words past that cap can never contribute to the numerator and counting them here is what
    // made the old ratio unreachable. This is the weight of exactly what the matcher may see.
    const windowWeight = wordsForWeight
      .slice(0, maxDhWords)
      .reduce((sum, w) => sum + getCombinedWordWeight(w, enableWordWeighting, idfMap), 0);

    if (DEBUG) console.log(`    📊 searchLineInDoc: validStart=${validStart}, validEnd=${validEnd}, prevLineNum=${prevLineNum ?? 'none'}, searchWords=[${searchWords.join(',')}], fullWords=[${fullWords.join(',')}], isExplicit=${isExplicit}, expectedWeight=${expectedWeight.toFixed(2)}, requireStartAtFirstWord=${requireStartAtFirstWord}`);

    // Perf (behavior-neutral): these were previously re-declared inside the per-candidate-
    // line loop below, even though none of them depend on the loop's line index or on which
    // search phase/range is being scanned — every input they close over (config,
    // requireStartAtFirstWord, maxDhWords, enableWordWeighting, idfMap) is fixed for the
    // whole searchLineInDoc call. Recreating a function closure on every single scanned line
    // (potentially thousands of times per call, across up to two phases) does no useful work;
    // hoisting them here computes/creates them once instead, with identical results.
    const enableFuzzy = activePass.fuzzy;

    // Exact-substring match for the isExplicit path, under the same target-side anchor policy
    // as calcContiguousScore below (shallowAnchorLimit / deepAnchorMinRun, see the note
    // at the top of this file): a shallow occurrence counts on its own, a deeper one counts
    // when the phrase is at least deepAnchorMinRun words — a multi-word verbatim quote is
    // strong evidence wherever it sits in the line, a one-word one deep inside it is not.
    //
    // Two deliberate details:
    //  • Every occurrence is examined, not just indexOf's first. A phrase can appear late in
    //    the line and again early (or the reverse); only one of them needs to qualify, and
    //    stopping at the first hit made the answer depend on which came first.
    //  • The shallow test keeps its original `<=` (offset 0..3 inclusive) rather than being
    //    aligned to calcContiguousScore's `< 3`. Matching the fuzzy path's exclusive bound
    //    here would *reject* offset-3 short phrases this path accepts today, and this fix is
    //    meant to be purely additive.
    const hasQualifyingOccurrence = (haystack: string, needle: string): boolean => {
      const needleWordCount = needle.split(/\s+/).filter(Boolean).length;
      for (let idx = haystack.indexOf(needle); idx !== -1; idx = haystack.indexOf(needle, idx + 1)) {
        const wordsBefore = haystack.slice(0, idx).trim();
        const offsetWords = wordsBefore ? wordsBefore.split(/\s+/).filter(Boolean).length : 0;
        if (offsetWords <= activePass.shallowAnchorLimit) return true;
        if (needleWordCount >= activePass.deepAnchorMinRun) return true;
      }
      return false;
    };

    const calcContiguousScore = (sourceWords: string[], targetWords: string[]): { score: number; wordCount: number; simSum: number } => {
      // COMMENTARY SIDE — a match must still begin within the first few words of the commentary
      // line; nothing in the BUG-02 anchor fix touches this. The bound is 3 for ש"ס/תנ"ך exactly
      // as before, and 2 in ספרי הלכה — there the מספור already marks where the למה starts, so
      // anything more than one word past it is the מחבר's own prose. It reaches here through
      // PassSpec.maxStartIdx, which basePassSpec seeds from profile.maxDhStartIdx.
      const maxStartIdx = Math.min(activePass.maxStartIdx, sourceWords.length);
      // Cap source to maxDhWords (7 for Tosafot, 12 for other sources by default)
      const cappedSource = sourceWords.slice(0, maxDhWords);

      // Perf (behavior-neutral): the per-word weight is a pure function of the word, but was
      // recomputed in the innermost loop — once per (anchor position × run step). Each call
      // runs a regex replace plus a Set lookup, and now that the anchor sweeps the whole
      // target line that loop body executes far more often. One weight per source word is
      // the identical arithmetic with the redundancy removed.
      const sourceWeights = cappedSource.map(w => getCombinedWordWeight(w, enableWordWeighting, idfMap));

      // TARGET SIDE — see the shallowAnchorLimit / deepAnchorMinRun policy note at the
      // top of this file. requireStartAtFirstWord (secondary sources) still pins the anchor
      // to target word 0 exactly; otherwise every position is reachable, with deep ones
      // gated on run length below. Loop-invariant, so hoisted out of the startWIdx loop.
      const maxDocWIdx = requireStartAtFirstWord ? 1 : targetWords.length;

      let maxSeqScore = 0;
      let bestWordCount = 0;
      // Unweighted similarity total of the winning run. Carried alongside the weighted score
      // purely as confidence evidence (mean exactness); it takes no part in the comparison
      // that picks the run, so the run chosen here is the same one as before.
      let bestSimSum = 0;
      for (let startWIdx = 0; startWIdx < maxStartIdx; startWIdx++) {
        for (let docWIdx = 0; docWIdx < maxDocWIdx; docWIdx++) {
          let k = 0;      // source ITEMS consumed
          let kt = 0;     // target WORDS consumed
          let seqScore = 0;
          let simSum = 0;
          while (
            startWIdx + k < cappedSource.length &&
            docWIdx + kt < targetWords.length
          ) {
            const w1 = cappedSource[startWIdx + k];
            if (w1.indexOf(ABBR_MARK) !== -1) {
              const parts = w1.split(ABBR_MARK);
              const orig = parts[0];
              const exp = parts.slice(1);
              if (exp.length === 0 || docWIdx + kt + exp.length > targetWords.length) break;
              let ok = true;
              let partSim = 0;
              let partWeight = 0;
              for (let j = 0; j < exp.length; j++) {
                const s = getWordSimilarity(exp[j], targetWords[docWIdx + kt + j], enableFuzzy);
                if (s <= 0) { ok = false; break; }
                partSim += s;
                partWeight += s * getCombinedWordWeight(exp[j], enableWordWeighting, idfMap);
              }
              if (!ok) break;
              const ownWeight = getCombinedWordWeight(orig, enableWordWeighting, idfMap);
              seqScore += Math.max(ownWeight, ABBR_DAMP * partWeight);
              simSum += partSim / exp.length;
              kt += exp.length;
              k++;
              continue;
            }
            const w2 = targetWords[docWIdx + kt];
            const sim = getWordSimilarity(w1, w2, enableFuzzy);
            if (sim <= 0) break;
            seqScore += sim * sourceWeights[startWIdx + k];
            simSum += sim;
            kt++;
            k++;
          }
          // FIX ח׳: this guard was written to count WORDS of the target. Once an abbreviation
          // collapses into one source item the two stopped being the same number, so count the
          // target words actually consumed.
          if (docWIdx >= activePass.shallowAnchorLimit && kt < activePass.deepAnchorMinRun) continue;
          if (seqScore > maxSeqScore) {
            maxSeqScore = seqScore;
            bestWordCount = kt;
            bestSimSum = simSum;
          }
        }
      }
      return { score: maxSeqScore, wordCount: bestWordCount, simSum: bestSimSum };
    };

    // Perf (behavior-neutral): searchFp only depends on fullLineText, which is fixed for the
    // whole call — previously recomputed on every phase of the range loop below even though
    // it never changes between phases. Hoisted here so it's computed exactly once.
    const searchFp = fullLineText.split(/\s+/).filter(Boolean)
      .map(w => getNikudFingerprint(w)).join('');

    /**
     * Best of the four (plain/expanded source) × (plain/expanded target) scorings.
     *
     * Semantics are exactly the original
     *   `[c00, c11, c01, c10].reduce((best, c) => c.score > best.score ? c : best)`
     * — strictly-greater, so the earliest of any tie wins. A pairing is skipped only when
     * both of its arrays are the *same objects* as an already-scored pairing, in which case
     * calcContiguousScore is a pure function of identical inputs and would return an equal
     * score, which `>` would never have promoted anyway. With expansion commonly a no-op,
     * that usually leaves a single scoring pass instead of four.
     */
    const bestOfCombos = (
      source: string[],
      expSource: string[],
      target: string[],
      expTarget: string[]
    ): { score: number; wordCount: number; simSum: number } => {
      const sourceChanged = expSource !== source;
      const targetChanged = expTarget !== target;

      let best = calcContiguousScore(source, target);

      // Distinct from the first pairing as soon as either side was rewritten.
      if (sourceChanged || targetChanged) {
        const c = calcContiguousScore(expSource, expTarget);
        if (c.score > best.score) best = c;
      }

      // The two mixed pairings are only new inputs when *both* sides were rewritten;
      // otherwise each is object-identical to one of the two scored above.
      if (sourceChanged && targetChanged) {
        const mixedTarget = calcContiguousScore(source, expTarget);
        if (mixedTarget.score > best.score) best = mixedTarget;

        const mixedSource = calcContiguousScore(expSource, target);
        if (mixedSource.score > best.score) best = mixedSource;
      }

      return best;
    };

    // Perf (behaviour-neutral): the expansion pass below leaves its input untouched for most
    // candidate lines — the commentary phrase simply holds no abbreviation that the candidate
    // line disambiguates. In that case `normalizeText(expX).split(...)` is, term for term, a
    // recomputation of a value that does not depend on the candidate line at all. Precompute
    // the two call-invariant ones here and reuse them by reference when expansion was a no-op;
    // the doc-line side gets the same treatment via reNormalizedWords() on its cache entry.
    // Reference equality then also collapses the four scoring combinations below to the one
    // or two that are genuinely distinct.
    // (`fullWords` above is already exactly normalizeText(fullLineText).split(...), so it
    // doubles as the no-op result for the full-line side.)
    const normSearchWords = normalizeText(searchPhrase).split(/\s+/).filter(Boolean);

    // Phased search: when we have a reliable anchor (prevLineNum), search a narrow window
    // around it first, and only fall back to scanning the full [validStart, validEnd] range
    // if nothing acceptable turned up nearby. This matters most for short DH quotes, where a
    // 1-2 word phrase can coincidentally match many places across a wide range — searching
    // near the anchor first lets the correct nearby line win before the wide scan ever runs.
    const PHASED_SEARCH_WINDOW = 12;
    const searchRanges: { s: number; e: number }[] = [];
    if (prevLineNum !== null && prevLineNum !== undefined && prevLineNum > 0) {
      const narrowStart = Math.max(validStart, prevLineNum - PHASED_SEARCH_WINDOW);
      const narrowEnd = Math.min(validEnd, prevLineNum + PHASED_SEARCH_WINDOW);
      if (narrowStart <= narrowEnd && (narrowStart > validStart || narrowEnd < validEnd)) {
        searchRanges.push({ s: narrowStart, e: narrowEnd });
      }
    }
    searchRanges.push({ s: validStart, e: validEnd });

    for (const range of searchRanges) {
      if (DEBUG) console.log(`    🔍 searchLineInDoc phase: scanning lines ${range.s}-${range.e}`);
      let bestLine: number | null = null;
      let maxMatchedCount = 0;
      let bestMatchedWordCount = 0;
      let minDistance = Infinity;
      let linesChecked = 0;

      let bestLineFpDist = Infinity; // fingerprint distance of current bestLine

      // Confidence evidence for whichever line ends up as bestLine (display-only).
      let bestSimSum = 0;
      let bestMatchedWeight = 0;
      let bestExactPhrase = false;

      // Top-K collection: keeps the best 3 candidates sorted by score descending.
      // Each entry: { lineNum, score, fpDist, dist }
      const TOP_K = 3;
      const topCandidates: { lineNum: number; score: number; dist: number; fpDist: number }[] = [];

      for (let lNum = range.s; lNum <= range.e; lNum++) {
        // Dedup guard: skip a secondary-source line already claimed by an earlier explicit
        // ד"ה/בד"ה citation in this same commentary segment — two distinct explicit DH
        // references should never resolve to the exact same secondary-source line.
        if (excludeLines && excludeLines.has(lNum)) continue;
        const docLineRaw = docLines[lNum - 1];
        if (!docLineRaw) continue;
        const cachedLine = lineCache?.[lNum - 1];
        const docLineNorm = cachedLine ? cachedLine.norm : normalizeText(docLineRaw);
        if (!docLineNorm) continue;

        linesChecked++;
        const docWords = cachedLine ? cachedLine.words : docLineNorm.split(/\s+/).filter(Boolean);
        if (docWords.length === 0) continue;

        // Expand Rashei Teivot (abbreviations) for candidate target line.
        // Bounded by EXPANSION_TOKEN_WINDOW: everything downstream reads at most the first
        // 14 words of either side, and rewriting a 180-word paragraph to consult 14 of its
        // words was a large share of the whole run's cost.
        const expSearchPhrase = config.useAbbreviationExpansion !== false
          ? expandAbbreviationsInText(searchPhrase, docLineNorm, abbrDict, config.gsReplacements, EXPANSION_TOKEN_WINDOW)
          : searchPhrase;
        const expFullLineText = config.useAbbreviationExpansion !== false
          ? expandAbbreviationsInText(fullLineText, docLineNorm, abbrDict, config.gsReplacements, EXPANSION_TOKEN_WINDOW)
          : fullLineText;
        const expDocLineNorm = config.useAbbreviationExpansion !== false
          ? expandAbbreviationsInText(docLineNorm, fullLineText, abbrDict, config.gsReplacements, EXPANSION_TOKEN_WINDOW)
          : docLineNorm;

        // String `===` is a value comparison, and value is exactly the right test here: if
        // expansion produced text equal to its input, normalising it must reproduce words we
        // already hold, so we reuse that array instead of re-deriving it.
        // FIX ו׳: normalise each token on its own so the unit marker survives — normalizeText
        // drops every character outside [Hebrew, digits, space, ' and "].
        const normKeepMark = (t: string): string[] =>
          t.split(/\s+/).filter(Boolean)
            .map(tok => tok.split(ABBR_MARK).map(p => normalizeText(p).replace(/\s+/g, ' ').trim()).filter(Boolean).join(ABBR_MARK))
            .filter(Boolean);
        const expSearchWords = expSearchPhrase === searchPhrase
          ? normSearchWords
          : normKeepMark(expSearchPhrase);
        const expFullWords = expFullLineText === fullLineText
          ? fullWords
          : normKeepMark(expFullLineText);
        const expDocWords = expDocLineNorm === docLineNorm
          ? reNormalizedWords(cachedLine, docLineNorm)
          : normalizeText(expDocLineNorm).split(/\s+/).filter(Boolean);

        let currentMatchCount = 0;
        let currentWordCount = 0;
        // Per-candidate confidence evidence. Written but never read by any acceptance or
        // ranking test below — it only rides along to the winner.
        let currentSimSum = 0;
        let currentMatchedWeight = 0;
        let currentExactPhrase = false;

        if (isExplicit) {
          // Explicit delimiter / כו': search for searchPhrase or expSearchPhrase in docLineNorm / expDocLineNorm
          const matchAtStart = requireStartAtFirstWord
            ? (docLineNorm.indexOf(searchPhrase) === 0 || expDocLineNorm.indexOf(expSearchPhrase) === 0)
            : (hasQualifyingOccurrence(docLineNorm, searchPhrase) || hasQualifyingOccurrence(expDocLineNorm, expSearchPhrase));

          if (matchAtStart) {
            // Perfect exact substring match gets maximum bonus based on expectedWeight
            currentMatchCount = expectedWeight + 10;
            currentWordCount = searchWords.length;
            // Verbatim occurrence: full coverage of the window, every word an exact hit.
            currentExactPhrase = true;
            currentMatchedWeight = windowWeight;
            currentSimSum = currentWordCount;
          } else {
            // Word-by-word matching with fuzzy similarity score and word weighting
            const winningRes = bestOfCombos(searchWords, expSearchWords, docWords, expDocWords);
            currentMatchCount = winningRes.score;
            currentWordCount = winningRes.wordCount;
            currentMatchedWeight = winningRes.score;
            currentSimSum = winningRes.simSum;
          }
        } else {
          // No explicit delimiter: find longest contiguous sequence of matching words.
          // Constraint: the sequence must start within the first 3 words of the commentary
          // line to avoid false positives from incidental word matches deep in the line.
          // Also caps sourceWords to maxDhWords to bound the search space.
          const winningRes = bestOfCombos(fullWords, expFullWords, docWords, expDocWords);
          let rawMatchCount = winningRes.score;
          currentWordCount = winningRes.wordCount;
          // Evidence uses the pre-penalty score: the sequential-distance factor below is a
          // ranking nudge between candidates, not a statement about how well the text matched.
          currentMatchedWeight = winningRes.score;
          currentSimSum = winningRes.simSum;

          // Apply Sequential Monotonicity Penalty if prevLineNum is available
          // Note: Very subtle bias (max 5% - 7%) so that out-of-order commentaries are not penalized
          let distPenalty = 1.0;
          if (prevLineNum !== null && prevLineNum !== undefined && prevLineNum > 0) {
            const diff = lNum - prevLineNum;
            if (diff < 0) {
              // Gentle micro-preference for current/subsequent lines over backward jumps (max 7% drop)
              distPenalty = Math.max(0.93, 1.0 - Math.abs(diff) * 0.005);
            } else if (diff > 5) {
              // Gentle micro-preference for closer lines over far forward jumps (max 5% drop)
              distPenalty = Math.max(0.95, 1.0 - (diff - 5) * 0.002);
            }
          }

          currentMatchCount = rawMatchCount * distPenalty;
        }

      // Note: previously this was written as `isExplicit ? X : X` — an identical value on
      // both branches, so `isExplicit` had no actual effect on the threshold despite the
      // conditional implying it should. Now genuinely word-count- and explicitness-aware —
      // see computeDynamicMinThreshold (BUG-01 fix). thresholdMultiplier (default 0.65) is
      // still threaded through so callers — specifically the explicit-reference flexibility
      // ladder's last rung — can further lower the acceptance bar.
      const minThreshold = computeDynamicMinThreshold(
        expectedWeight, wordsForWeight.length, isExplicit, thresholdMultiplier,
        activePass.minScore, activePass.scoreCap
      );

      /**
       * The acceptance floor has to bite on BOTH scoring routes.
       *
       * An exact-substring hit sets `currentMatchCount` to `expectedWeight + 10` — a RANKING
       * device, so that a verbatim occurrence outranks any fuzzy run no matter how the
       * weights fall. That constant also clears every threshold by construction, which turns
       * the explicit-delimiter route into a way around the floor. For a one-word ד"ה
       * "occurs verbatim within the first words of the line" is not evidence; the same word
       * opens many lines of a סימן, and the winner is then settled by the distance
       * tie-breaker below — a coin flip wearing a match's clothes.
       *
       * So when a profile sets a floor, what must clear it is the match's REAL weight, not
       * the inflated ranking score. On the fuzzy route this is implied by the check below
       * (`currentMatchCount` there is `currentMatchedWeight` times a ≤1 distance penalty),
       * so the guard changes nothing there and constrains only the exact-substring route.
       */
      const clearsFloor =
        activePass.minScore === undefined || currentMatchedWeight >= activePass.minScore;

        if (clearsFloor && currentMatchCount >= minThreshold) {
          const dist = Math.abs(lNum - range.s);

          // Nikud fingerprint tie-breaker:
          // When the source line carries nikud, compute a fingerprint and compare
          // it to the search phrase fingerprint. A closer vowel pattern wins ties.
          const cachedFp = lineCache?.[lNum - 1]?.fp;
          const candidateFp = cachedFp !== undefined
            ? cachedFp
            : (docLines[lNum - 1]
                ? docLines[lNum - 1].split(/\s+/).filter(Boolean).map(w => getNikudFingerprint(w)).join('')
                : '');
          const fpDist = searchFp.length > 0 && candidateFp.length > 0
            ? levenshteinDistance(searchFp, candidateFp)
            : Infinity;

          // Evidence follows the winner. Assigned in the same three places as
          // bestMatchedWordCount and never tested, so the winner itself is unchanged.
          const takeEvidence = () => {
            bestSimSum = currentSimSum;
            bestMatchedWeight = currentMatchedWeight;
            bestExactPhrase = currentExactPhrase;
          };

          if (currentMatchCount > maxMatchedCount) {
            maxMatchedCount = currentMatchCount;
            bestMatchedWordCount = currentWordCount;
            bestLine = lNum;
            minDistance = dist;
            bestLineFpDist = fpDist;
            takeEvidence();
          } else if (currentMatchCount === maxMatchedCount) {
            // Primary tie-break: closer position
            if (dist < minDistance) {
              bestLine = lNum;
              bestMatchedWordCount = currentWordCount;
              minDistance = dist;
              bestLineFpDist = fpDist;
              takeEvidence();
            } else if (dist === minDistance && fpDist < bestLineFpDist) {
              // Secondary tie-break: better nikud fingerprint match
              bestLine = lNum;
              bestMatchedWordCount = currentWordCount;
              bestLineFpDist = fpDist;
              takeEvidence();
            }
          }

          // ── Top-K collection ──────────────────────────────────────────────
          // Insert into topCandidates maintaining sorted order (best score first).
          // Ties broken by dist then fpDist, same as bestLine logic above.
          const insertIdx = topCandidates.findIndex(c =>
            currentMatchCount > c.score ||
            (currentMatchCount === c.score && dist < c.dist) ||
            (currentMatchCount === c.score && dist === c.dist && fpDist < c.fpDist)
          );
          if (insertIdx !== -1) {
            topCandidates.splice(insertIdx, 0, { lineNum: lNum, score: currentMatchCount, dist, fpDist });
          } else if (topCandidates.length < TOP_K) {
            topCandidates.push({ lineNum: lNum, score: currentMatchCount, dist, fpDist });
          }
          // Keep only TOP_K entries
          if (topCandidates.length > TOP_K) topCandidates.length = TOP_K;
        }
      }

      if (DEBUG) console.log(`    ✓ searchLineInDoc checked ${linesChecked} lines, bestLine=${bestLine}, maxMatchedCount=${maxMatchedCount}`);
      if (bestLine !== null) {
        // The runner-up is the best RIVAL — the top-K list is score-ordered and its head is
        // the winner itself, so the discriminative margin is measured against entry 1.
        const runnerUp = topCandidates.find(c => c.lineNum !== bestLine);
        return {
          lineNum: bestLine,
          matchedCount: maxMatchedCount,
          matchedWordCount: bestMatchedWordCount,
          expectedWeight,
          topK: topCandidates.map(c => ({ lineNum: c.lineNum, score: c.score })),
          evidence: {
            matchedWeight: bestMatchedWeight,
            windowWeight,
            runWords: bestMatchedWordCount,
            simSum: bestSimSum,
            winnerScore: maxMatchedCount,
            runnerUpScore: runnerUp ? runnerUp.score : 0,
            exactPhrase: bestExactPhrase
          }
        };
      }
    }

    return { lineNum: null, matchedCount: 0, matchedWordCount: 0, expectedWeight: 0, topK: [], evidence: EMPTY_EVIDENCE };
  };

  // ─── Explicit-Reference Flexibility Ladder ("סולם הגמשה") ─────────────────
  // A commentary line that explicitly names its target ("רש"י ד"ה", "תוס' בא"ד", "גמ'"
  // etc.) is telling us with certainty that a matching line exists somewhere in that
  // target document. If the normal strict search still comes up empty, we shouldn't give
  // up (or silently fall back to unrelated inherited context) — instead retry with
  // progressively more relaxed rules, stopping at the first rung that finds a match:
  //   Rung A — drop the "must start at first word" requirement. DH quotes from Rashi/
  //            Tosafot frequently appear mid-paragraph, not at the very start of a line.
  //   Rung B — also drop IDF word-weighting, so common words (אמר/הוי/רבי) count equally
  //            with rarer ones; this helps fuzzy matching survive heavy abbreviation.
  //   Rung C — also widen the search range to the segment immediately before and after
  //            the current one, in case the citation crosses a דף/פרק boundary.
  //   Rung D — also lower the acceptance threshold (0.4 instead of the normal 0.65) as a
  //            last resort.
  // Returns the rung letter that succeeded alongside the match, so calculateLinkConfidence
  // (via its retryRung param / RETRY_CONFIDENCE_CAPS) can cap confidence to reflect that
  // this was a "harder" textual match found only thanks to the explicit reference.
  const attemptFlexibleRetry = (
    docLines: string[],
    segStart: number,
    segEnd: number,
    allSegments: { startLine: number; endLine: number }[],
    cleanDhText: string,
    fullLineText: string,
    isExplicit: boolean,
    idfMap: Record<string, number> | undefined,
    prevLineNum: number | null | undefined,
    lineCache: LineCacheEntry[] | undefined,
    maxDhWords: number,
    excludeLines?: Set<number>
  ): { result: SearchResult; rung: RetryRung } | null => {
    // Rung A: requireStartAtFirstWord = false
    let res = searchLineInDoc(docLines, segStart, segEnd, cleanDhText, fullLineText, isExplicit, idfMap, prevLineNum, false, lineCache, maxDhWords, 0.65, excludeLines);
    if (res.lineNum) return { result: res, rung: 'A' };

    // Rung B: also drop IDF weighting
    res = searchLineInDoc(docLines, segStart, segEnd, cleanDhText, fullLineText, isExplicit, undefined, prevLineNum, false, lineCache, maxDhWords, 0.65, excludeLines);
    if (res.lineNum) return { result: res, rung: 'B' };

    // Rung C: also widen the range to the neighboring segments (page/perek before & after)
    const segIdx = allSegments.findIndex(s => s.startLine === segStart && s.endLine === segEnd);
    let widenedStart = segStart;
    let widenedEnd = segEnd;
    if (segIdx > 0) widenedStart = allSegments[segIdx - 1].startLine;
    if (segIdx !== -1 && segIdx < allSegments.length - 1) widenedEnd = allSegments[segIdx + 1].endLine;
    if (widenedStart !== segStart || widenedEnd !== segEnd) {
      res = searchLineInDoc(docLines, widenedStart, widenedEnd, cleanDhText, fullLineText, isExplicit, undefined, prevLineNum, false, lineCache, maxDhWords, 0.65, excludeLines);
      if (res.lineNum) return { result: res, rung: 'C' };
    }

    // Rung D: also lower the acceptance threshold (last resort)
    res = searchLineInDoc(docLines, widenedStart, widenedEnd, cleanDhText, fullLineText, isExplicit, undefined, prevLineNum, false, lineCache, maxDhWords, 0.4, excludeLines);
    if (res.lineNum) return { result: res, rung: 'D' };

    return null;
  };

  if (DEBUG) console.log(`  📄 commDoc.segments=${commDoc.segments.length}, srcDoc.segments=${srcDoc.segments.length}, rashiDoc=${rashiDoc ? rashiDoc.segments.length : 'null'}, tosafotDoc=${tosafotDoc ? tosafotDoc.segments.length : 'null'}`);

  const links: OtzariaLink[] = [];
  const dhHighlights: Record<number, DHHighlight> = {};

  /**
   * How often this commentator OPENS a line with each word — the denominator of the first-word
   * anchor's rarity gate (see SWDH_MAX_OPENING_RATIO). Derived exactly the way the anchor
   * itself is, so numerator and denominator measure the same quantity: once over one line,
   * once over the book.
   */
  const swdhOpeningCount = new Map<string, number>();
  let swdhContentLines = 0;
  for (const raw of commDoc.lines) {
    if (!raw || !raw.trim() || isHeaderLine(raw, profile)) continue;
    swdhContentLines++;
    // המספור נחתך לפני הספירה בדיוק כפי שהוא נחתך לפני חילוץ הד"ה, אחרת "פותח את השורה"
    // היה נמדד על אסימון המספור עצמו במקום על המילה הראשונה של הציטוט.
    const t = stripHalachaLeadIn(raw, profile).trim();
    const stripped = stripSecondaryPrefix(t);
    const first = normalizeText(stripped.trim() ? stripped : t).split(/\s+/).filter(Boolean)[0];
    if (first) swdhOpeningCount.set(first, (swdhOpeningCount.get(first) || 0) + 1);
  }
  /** Share of the commentary's content lines this word opens. 1 (i.e. "always") if unknown. */
  const swdhOpeningRatio = (w: string): number =>
    swdhContentLines > 0 ? (swdhOpeningCount.get(w) || 0) / swdhContentLines : 1;

  // Map source header segments to commentary header segments
  let previousSecondaryType: 'rashi' | 'tosafot' | null = null;

  // The inheritance context a segment leaves behind: the last link of the last segment that had
  // any content lines, and its inheritance depth. A segment normally starts from scratch, but a
  // segment whose first content line says בא"ד continues that context across the header — see
  // firstContentLineIsBaad. Carried over only from segments that actually held content, so an
  // empty segment in between does not sever the chain.
  let carriedLink: OtzariaLink | null = null;
  let carriedInheritDepth = 0;

  // Front matter: every commentary segment before the first one whose header has a counterpart in
  // a target document is skipped outright — not searched, not linked, and left out of the
  // inheritance chain (see findFirstAlignedSegmentIndex for why, and what -1 means).
  const firstAlignedSegIdx = findFirstAlignedSegmentIndex(commDoc.segments, [
    srcDoc.segments,
    rashiDoc ? rashiDoc.segments : null,
    tosafotDoc ? tosafotDoc.segments : null
  ]);
  if (DEBUG && firstAlignedSegIdx > 0) {
    console.log(`  ⏭️  Skipping ${firstAlignedSegIdx} front-matter segment(s) before the first matching header '${commDoc.segments[firstAlignedSegIdx].headerTitle}'`);
  }

  /**
   * ── מנוע המעברים ─────────────────────────────────────────────────────────────────────────
   *
   * הספר נסרק כמה פעמים, מן הראיה החזקה אל החלשה (`passSpecsFor`). כל מעבר מטפל **רק ביחידות
   * שטרם קושרו בזכות עצמן**, ולכן הוא יכול להוסיף קישורים אך לא לשנות קישור של מעבר שקדם לו —
   * וההרפיה ההדרגתית בטוחה מעצם המבנה.
   *
   * **ירושה מחושבת מחדש בכל מעבר.** קישור מורש אינו ראיה עצמאית אלא נגזרת של העוגנים שסביבו,
   * ומעבר שהוסיף עוגן משנה את ההקשר שכל השורות שאחריו יורשות. לכן הקישורים המורשים נמחקים
   * בפתח כל מעבר ונבנים מחדש מאוסף העוגנים העדכני. בלי זה, שורה שירשה במעבר הראשון הייתה
   * ננעלת על הקשר מיושן ולא הייתה נחפשת שוב.
   *
   * ש"ס ותנ"ך מקבלים מעבר אחד, ולכן `passIdx > 0` לעולם אינו מתקיים אצלם והזרימה זהה לחלוטין
   * למה שהייתה לפני שהלולאה נוספה.
   */
  const passes = passSpecsFor(profile, config.useFuzzyMatching !== false);
  /** העוגנים שנמצאו עד כה, לפי שורת הפירוש. מפתח לקיצור הדרך של המעבר הבא. */
  let anchorByLine = new Map<number, OtzariaLink>();

  /**
   * החלון של כל יחידה, כפי שהעוגנים הקיימים בפתח המעבר כולאים אותה. מחושב פעם אחת למעבר —
   * הוא נגזר מאוסף העוגנים, שאינו משתנה בתוך מעבר (מעבר רק מוסיף, ומה שהוא מוסיף אינו משנה
   * חלון של יחידה שכבר נסרקה). `null` = בלי אילוץ.
   */
  let windowByLine = new Map<number, UnitWindow>();

  passes.forEach((spec, passIdx) => {
  activePass = spec;
  activePassIndex = passIdx;
  if (passIdx > 0) {
    for (let i = links.length - 1; i >= 0; i--) if (links[i].isInherited) links.splice(i, 1);
  }

  if (spec.prunesConflictsBefore) {
    const dropped = pruneConflictingAnchors(links, buildLinkUnits(commDoc.lines, links, profile));
    if (DEBUG && dropped.length > 0) {
      console.log(`  ✂️  M1: ${dropped.length} עוגנים סותרים נוכו (${dropped.map(l => `${l.line_index_1}→${l.line_index_2}`).join(', ')})`);
    }
  }

  anchorByLine = new Map(links.filter(l => !l.isInherited).map(l => [l.line_index_1, l]));
  windowByLine = new Map();
  if (spec.scope === 'window') {
    const units = buildLinkUnits(commDoc.lines, links, profile);
    units.forEach((u, i) => {
      if (u.target !== null && !u.inherited) return;
      const w = windowForUnit(units, i);
      if (w.lo !== null || w.hi !== null) windowByLine.set(u.lineIdx1, w);
    });
  }

  carriedLink = null;
  carriedInheritDepth = 0;
  previousSecondaryType = null;
  if (DEBUG && passes.length > 1) {
    console.log(`\n🔁 מעבר ${passIdx + 1}/${passes.length}: '${spec.name}' (רף ${spec.minScore ?? '—'}, ${spec.fuzzy ? 'גמיש' : 'מילולי'}, היקף ${spec.scope}) — ${anchorByLine.size} עוגנים, ${windowByLine.size} חלונות`);
  }

  commDoc.segments.forEach((commSeg, segIdx) => {
    if (firstAlignedSegIdx > 0 && segIdx < firstAlignedSegIdx) return;

    // בהלכה "השורה הראשונה אומרת שהיא המשך" נמדד לפי המספור: סגמנט שנפתח בשורה לא ממוספרת
    // ממשיך את הקטע האחרון של הסגמנט הקודם, בדיוק כפי שסגמנט שנפתח בבא"ד ממשיך אותו בש"ס.
    // כשאין ירושה כלל (מבנה 'single-line') אין מה להעביר מעבר לכותרת.
    const opensWithBaad = !profile.allowsInheritance
      ? false
      : profile.numberingDrivesLinking
        ? firstContentLineIsUnnumbered(commDoc.lines, commSeg.startLine, profile)
        : firstContentLineIsBaad(commDoc.lines, commSeg.startLine);
    let previousLink: OtzariaLink | null = opensWithBaad ? carriedLink : null;
    // How many inheritance hops separate previousLink from the last link that was matched on
    // its own textual evidence (0 = previousLink was matched directly). Confidence decays once
    // per hop instead of reporting a flat 75 for the whole chain — display-only, and it does
    // not participate in any inheritance decision.
    let previousInheritDepth = opensWithBaad ? carriedInheritDepth : 0;
    let segmentHadContent = false;

    // Explicit-reference dedup guard (per commentary segment): tracks which secondary-
    // source lines (Rashi / Tosafot) have already been claimed by an explicit ד"ה/בד"ה
    // citation, so a later, different explicit citation in the same segment can never
    // resolve to the exact same line — see excludeLines usage above.
    const usedSecondaryLines: { rashi: Set<number>; tosafot: Set<number> } = { rashi: new Set(), tosafot: new Set() };

    // Find matching source segment
    const srcSeg = findMatchingSegment(srcDoc.segments, commSeg.headerTitle);
    const rashiSeg = rashiDoc ? findMatchingSegment(rashiDoc.segments, commSeg.headerTitle) || null : null;
    const tosafotSeg = tosafotDoc ? findMatchingSegment(tosafotDoc.segments, commSeg.headerTitle) || null : null;

    let lastMatchedSrcLineIndex = srcSeg ? srcSeg.startLine : 1;

    /**
     * שורת אסימון ס"ק — "(א)" לבדו בשורה, או כותרת ממוספרת — פותחת ס"ק אך אין בה טקסט לחפש
     * בו. הדגל מעביר את תפקיד הפותח לשורת התוכן הבאה, שהיא זו שנושאת את הציטוט מלשון השו"ע.
     * מאותחל מחדש בכל סגמנט, שכן ס"ק אינו נמשך מעבר לכותרת "סימן".
     */
    let markerAwaitsOpener = false;

    /**
     * רצפת הסדר בתוך המעבר הנוכחי: היעד של העוגן האחרון שנראה בסגמנט הזה, בין שהיה קיים
     * מקודם ובין שנוצר ברגע זה.
     *
     * `windowByLine` מחושב פעם אחת בפתח המעבר, ולכן הוא אינו יודע על עוגנים שהמעבר עצמו
     * מוסיף תוך כדי. בלי הרצפה הזאת, יחידה שנסרקת אחרי שנוסף עוגן לפניה עדיין עובדת לפי
     * חלון ישן ויכולה להיקשר לשורה שקודמת לו — נסיגה אחורה שנוצרת **בתוך** מעבר. זה נמצא
     * במדידה על ספר אמיתי, אחרי שההערה בקוד טענה שהמקרה אינו אפשרי.
     */
    let orderFloor: number | null = null;

    for (let cLineIdx = commSeg.startLine; cLineIdx <= commSeg.endLine; cLineIdx++) {
      if (cLineIdx > commDoc.lines.length) break;
      const cLineRaw = commDoc.lines[cLineIdx - 1];
      if (!cLineRaw || isHeaderLine(cLineRaw, profile) || !cLineRaw.trim()) continue;
      segmentHadContent = true;

      /**
       * ── מבנה ס"ק: המספור הוא שמחליט מי מחפש ומי יורש ─────────────────────────────────────
       * פותח ס"ק — שורה ממוספרת ("(א)", "ב)"), או השורה שאחרי שורת אסימון — הוא היחיד שנכנס
       * לחיפוש; כל שורה אחרת היא המשך הדיון של אותו ס"ק ויורשת את ההקשר שלו בלי לחפש כלל.
       * בשאר המבנים ובשאר הקטגוריות `numberingDrivesLinking` הוא false והמנגנון כולו מנוטרל.
       */
      const skMode = profile.numberingDrivesLinking;
      // אסימון המספור ומילת ההפניה להגהה נחתכים מהשורה לפני כל שאר הצינור, כך שהמילה הראשונה
      // שהמנוע רואה היא המילה הראשונה של הלמה — זה מה שנותן ל-maxDhStartIdx=2 את המשמעות שלו.
      const trimmedLine = stripHalachaLeadIn(cLineRaw, profile).trim();

      // שורת אסימון אינה קטע פירוש: היא אינה מקבלת קישור, אינה מנתקת את שרשרת הירושה,
      // ומוסרת את תפקיד הפותח לשורה הבאה.
      if (skMode && isSeifKatanMarkerLine(cLineRaw)) {
        markerAwaitsOpener = true;
        if (DEBUG) console.log(`\n🔖 Line ${cLineIdx}: אסימון ס"ק — הפותח הוא השורה הבאה`);
        continue;
      }
      if (profile.stripsNumbering && !trimmedLine) continue;

      /** השורה פותחת ס"ק: היא עצמה ממוספרת, או שהיא שורת התוכן שאחרי שורת אסימון. */
      const isSeifKatanOpener = skMode && (hasHalachaNumbering(cLineRaw) || markerAwaitsOpener);
      markerAwaitsOpener = false;

      /**
       * מעבר שני ואילך: יחידה שכבר יש לה עוגן אינה נחפשת מחדש — מעבר מוסיף ואינו משנה.
       * מה שכן נעשה כאן הוא לקדם את מצב שרשרת הירושה בדיוק כפי שהחיפוש היה מקדם אותו, אחרת
       * השורות שמתחת היו יורשות הקשר של שורה ישנה יותר. הקיצור נמצא **אחרי** הטיפול המבני
       * (שורת אסימון, מספור, `markerAwaitsOpener`), כי אותו טיפול קובע מי הפותח של הס"ק הבא
       * וחייב לרוץ בכל מעבר.
       *
       * `dhHighlights` אינו מחושב כאן במכוון: הערך שנרשם במעבר שמצא את העוגן הוא הנכון.
       */
      const existingAnchor = anchorByLine.get(cLineIdx);
      if (existingAnchor) {
        previousLink = existingAnchor;
        previousInheritDepth = 0;
        previousSecondaryType = existingAnchor.secondaryTarget || null;
        if (!existingAnchor.secondaryTarget) {
          lastMatchedSrcLineIndex = existingAnchor.line_index_2;
          orderFloor = existingAnchor.line_index_2;
        }
        continue;
      }

      /**
       * אילוץ החלון — וזוהי אכיפת אי-הנסיגה עצמה.
       *
       * במעבר בהיקף `window` תחום החיפוש נחתך לטווח שהעוגנים שמסביב מתירים, ולכן **מעבר כזה
       * אינו יכול לייצר נסיגה אחורה — אין לו לאן**. אין צורך בבדיקת מונוטוניות נפרדת בסוף
       * הריצה: החלון הוא הביטוי המעשי של הכלל, ולא אמצעי אכיפה נוסף עליו.
       *
       * הגבולות **כלולים**. סעיף אחד בשו"ע נושא לעיתים קרובות עשרה ס"ק, ולכן חלון ששני
       * קצותיו מצביעים על אותה שורה הוא חלון תקין ברוחב 1 — המקרה הנפוץ ביותר בספר, וגבול
       * בלעדי היה מוחק אותו.
       *
       * מחושב פעם אחת לשורה ומשמש את כל מסלולי החיפוש שמייצרים קישור למקור הראשי — החיפוש
       * הרגיל, מקטעי ההמשך, סולם הגמישות ועוגן המילה הראשונה. מסלול שיישאר בהיקף הסגמנט
       * יוכל לייצר נסיגה בדלת האחורית.
       */
      const segStartLine = srcSeg ? srcSeg.startLine : 1;
      const segEndLine = srcSeg ? srcSeg.endLine : srcDoc.lines.length;
      const unitWindow = activePass.scope === 'window' ? windowByLine.get(cLineIdx) : undefined;
      // הרצפה נאכפת בכל מעבר ממוקד-חלון, גם כשלא נמצא חלון ליחידה הזאת בפתח המעבר: עוגן
      // שנוסף באמצע המעבר הוא בדיוק המקרה שהחלון המוקדם אינו מכיר.
      const floor = activePass.scope === 'window' ? orderFloor : null;
      const lowerBounds = [segStartLine, unitWindow?.lo ?? -Infinity, floor ?? -Infinity];
      const srcStart = Math.max(...lowerBounds);
      const srcEnd = Math.max(srcStart, unitWindow?.hi != null ? Math.min(segEndLine, unitWindow.hi) : segEndLine);
      if (DEBUG && unitWindow) console.log(`  🪟 שורה ${cLineIdx}: חלון [${srcStart}..${srcEnd}] מתוך [${segStartLine}..${segEndLine}]`);

      /**
       * מעבר שמותנה ברוחב חלון מדלג על יחידה שחלונה רחב מדי, או שאינו חסום משני צדדיו.
       *
       * דילוג ולא `continue`: השורה ממשיכה בגוף הלולאה בדיוק כמו שורה שהחיפוש בה נכשל, כדי
       * שהירושה ומצב השרשרת יטופלו באותה דרך אחת. `continue` היה מדלג גם עליהם ומייצר מסלול
       * שני לאותה החלטה.
       */
      /**
       * הרוחב הנמדד הוא של **תחום החיפוש בפועל**, ולא של החלון שהעוגנים לבדם נותנים:
       * גבולות הסימן הם עוגנים בזכות עצמם, ויחידה בסוף סימן שאין אחריה עוגן אינה "לא חסומה"
       * — היא חסומה בכותרת הבאה. `UnitWindow.width` מודד את התרומה של העוגנים בלבד ולכן הוא
       * `null` שם; מה שקובע כאן הוא כמה שורות באמת נשארו.
       */
      const searchRangeWidth = srcEnd - srcStart + 1;
      const skipForWindowWidth =
        activePass.maxWindowWidth !== undefined && searchRangeWidth > activePass.maxWindowWidth;
      /**
       * כמה אסימונים בלע החיתוך שבראש השורה — המספור, ומילת ההפניה להגהה. ההדגשה
       * (dhHighlights) נמדדת מול השורה הגולמית, שבה שניהם עדיין קיימים, ולכן היא מוזזת בדיוק
       * במספר האסימונים שנחתכו — אחרת ההדגשה הייתה נופלת עליהם במקום על הלמה.
       */
      const dhWordOffset = profile.stripsNumbering || profile.stripsGlossReference
        ? Math.max(
            0,
            cLineRaw.trim().split(/\s+/).filter(Boolean).length -
              trimmedLine.split(/\s+/).filter(Boolean).length
          )
        : 0;
      // Normalize the prefix line fully for keyword matching (includes nikud removal, quote normalization)
      const normalizedPrefixLine = normalizeText(trimmedLine, false);

      if (DEBUG) console.log(`\n📝 Line ${cLineIdx}: '${trimmedLine.substring(0, 50)}...' → normalizedPrefixLine='${normalizedPrefixLine.substring(0, 50)}...'`);

      // Check routing to secondary sources (Step 4).
      // First, strip leading numbers/bullets/brackets and source-context prefixes (גמרא / גמ' / משנה / מתני' etc.)
      // Pointer tokens (bullets / גמרא / משנה / פיסקא / bare שם) are stripped to a fixed
      // point before either keyword test, so a stacked prefix can't hide the word that
      // actually names the target — see stripLeadingMarkers (BUG-04). `cleanedPrefix` keeps
      // the source-context word itself, since that word IS the primary-source signal tested
      // below; only the tokens in front of it are removed.
      let cleanedPrefix = normalizedPrefixLine
        .replace(LEADING_BULLET_STRIP_RE, '')
        .replace(BARE_SHAM_STRIP_RE, '')
        .trim();
      const strippedContextLine = stripLeadingMarkers(cleanedPrefix);
      // Use the stripped version for keyword detection; fall back to full line if stripping
      // left the line empty (meaning the whole line was just "גמ'" with no secondary keyword).
      const lineForKeywordCheck = strippedContextLine || cleanedPrefix || normalizedPrefixLine;

      let targetSecondary: 'rashi' | 'tosafot' | null = null;
      let explicitSecondaryTarget = false;

      // בקטגוריית הלכה אין מקורות משניים לנתב אליהם (ראו SourceProfile.hasSecondarySources):
      // כל קישור מצביע על השו"ע עצמו, וכל מנגנון הניתוב לרש"י/תוספות מדולג.
      if (!profile.hasSecondarySources) {
        // אין מה לבדוק — targetSecondary נשאר null ו-explicitSecondaryTarget נשאר false.
      } else if (startsWithSourceKeyword(lineForKeywordCheck, RASHI_KEYWORDS_NORM)) {
        targetSecondary = 'rashi';
        explicitSecondaryTarget = true;
        if (DEBUG) console.log(`  ✅ Detected Rashi keyword. normalizedPrefixLine='${normalizedPrefixLine}'`);
      } else if (startsWithSourceKeyword(lineForKeywordCheck, TOSAFOT_KEYWORDS_NORM)) {
        targetSecondary = 'tosafot';
        explicitSecondaryTarget = true;
        if (DEBUG) console.log(`  ✅ Detected Tosafot keyword. normalizedPrefixLine='${normalizedPrefixLine}'`);
      } else {
        // Only "שם" followed immediately by a real delimiter (ד"ה / בא"ד / א"ד וכו') routes
        // to the same secondary target as before — that's a genuine continuation reference
        // ("שם ד"ה ...", "שם בא"ד"). A BARE "שם" with nothing after it that identifies a
        // target is NOT such a reference: it must not force routing into whichever
        // secondary source (רש"י/תוס') happened to be active, and must not be marked
        // explicit. Previously `|| normalizedPrefixLine.startsWith('שם')` caught every line
        // starting with "שם" — including plain "שם" with no ד"ה/בא"ד marker at all — and
        // forced it into the (often wrong) previous secondary doc as an "explicit" citation.
        // That's exactly what made these lines "get tangled": being marked explicit skips
        // the primary-source search entirely (see the `!explicitSecondaryTarget` gate
        // below) and engages the citation-retry/dedup machinery meant for real ד"ה
        // citations — so a bare "שם" whose real content actually belongs in the Gemara (or
        // nowhere in particular) could never be found there. Removing that clause lets a
        // bare "שם" fall through with targetSecondary=null and be searched as an ordinary
        // line — its real text (already stripped of the leading "שם" by
        // stripSecondaryPrefix below) is what actually gets searched, exactly as if "שם"
        // had been cut off the line entirely.
        const inheritTargetRegex = /^(?:שם\s+)?(?:או"ד|באו"ד|א"ד|בא"ד|אד|באד|אוד|באוד|בד"ה|בדה|ד"ה|דה)(?:\s|$|[:.\-])/i;
        if (normalizedPrefixLine.match(inheritTargetRegex)) {
          targetSecondary = previousSecondaryType;
          if (targetSecondary) explicitSecondaryTarget = true;
        }
      }

      // Detect explicit reference to the PRIMARY source (גמרא / משנה etc.) — used below to
      // suppress silent inheritance when such an explicit reference fails to find a match.
      let explicitPrimaryTarget = false;
      if (!targetSecondary) {
        // Same whole-word requirement as the secondary lists above — "משנהו"/"גמרתי" must not
        // register as an explicit primary citation and pull in the flexibility ladder.
        if (startsWithSourceKeyword(cleanedPrefix, GEMARA_KEYWORDS_NORM) || startsWithSourceKeyword(cleanedPrefix, MISHNA_KEYWORDS_NORM)) {
          explicitPrimaryTarget = true;
          if (DEBUG) console.log(`  ✅ Detected explicit primary-source keyword (Gemara/Mishna). cleanedPrefix='${cleanedPrefix}'`);
        }
      }

      const isBaad = isBaadContinuationLine(trimmedLine);
      const isJustSham = normalizedPrefixLine.startsWith('שם') && !normalizedPrefixLine.match(/^שם\s+(?:ד"ה|דה|בד"ה|בדה)(?:\s|$|[:.\-])/i);

      // Handle Inheritance ("שם" - Step 5)
      // By default, a bare "שם" (without ד"ה, and not part of the א"ד/בא"ד idiom) does NOT
      // auto-inherit the previous link — it's treated as a normal commentary line and its
      // real citation text (after the leading "שם" word, stripped in stripSecondaryPrefix)
      // is searched like any other line. Only the explicit "בא"ד"/"א"ד" idiom (isBaad) always
      // means "ibid" and keeps auto-inheriting. Set config.inheritOnBareSham = true to restore
      // the old behavior where bare "שם" also auto-inherits without searching.
      const shamShouldInherit = isJustSham && (config as any).inheritOnBareSham === true;
      // במבנה ס"ק המספור מחליף לגמרי את שאלת "האם השורה אומרת שהיא המשך": שורה שאינה פותחת
      // ס"ק היא המשך מעצם היעדר המספור, ופותח ס"ק פותח קטע חדש גם אם הוא כתוב בלשון בא"ד.
      // במבנה שבו קטע פירוש הוא שורה אחת אין ירושה כלל — גם לא על בא"ד או "שם".
      const shouldInheritLine = !profile.allowsInheritance
        ? false
        : skMode
          ? !isSeifKatanOpener
          : (isBaad || shamShouldInherit);
      let isInherited = false;

      // Extract DH search text using stripped line if secondary prefix present
      const lineForDh = stripSecondaryPrefix(trimmedLine);
      if (DEBUG) console.log(`  🔍 lineForDh='${lineForDh}' (after stripSecondaryPrefix)`);
      // For secondary target explicit lines, if stripSecondaryPrefix returns empty, skip this line
      if (explicitSecondaryTarget && !lineForDh.trim()) {
        if (DEBUG) console.log(`  ⏭️  SKIP: explicit secondary but no DH text`);
        // Note: skipped BEFORE the link / no-link decision below, so such a line neither takes a
        // link nor severs the inheritance chain. `isBareSourceLabelLine` is the same test in
        // predicate form, for the editor's copy of the chain.
        continue; // No DH text after removing secondary prefix - skip this commentary line
      }
      // For non-explicit lines, use lineForDh or fallback to trimmedLine
      const lineForDhExtraction = lineForDh.trim() ? lineForDh : trimmedLine;
      if (DEBUG) console.log(`  🔎 lineForDhExtraction='${lineForDhExtraction}'`);
      // Tosafot ד"ה is capped to 7 words; every other source (Rashi, Gemara, Mishna, etc.) keeps
      // the profile's cap — 12 for ש"ס/תנ"ך as before, 5 for ספרי הלכה.
      const maxDhWordsForTarget = targetSecondary === 'tosafot' ? 7 : profile.maxDhWords;
      const { dhText, cleanDh, isExplicitDelimiter } = extractDiburHamatchil(lineForDhExtraction, config.diburHamatchilDelimiter, maxDhWordsForTarget, profile);
      if (DEBUG) console.log(`  📌 dhText='${dhText}', cleanDh='${cleanDh}', isExplicitDelimiter=${isExplicitDelimiter}`);

      let matchedSourceLineNum: number | null = null;
      let matchedSecondaryLineNum: number | null = null;
      // Which rung ('A'-'D') of the explicit-reference flexibility ladder produced the
      // final match, if any — feeds calculateLinkConfidence's retryRung param below.
      let secondaryRetryRung: RetryRung | null = null;
      let primaryRetryRung: RetryRung | null = null;

      let srcMatchRes: SearchResult = { lineNum: null, matchedCount: 0, matchedWordCount: 0, expectedWeight: 0, topK: [], evidence: EMPTY_EVIDENCE };
      let secMatchRes: SearchResult = { lineNum: null, matchedCount: 0, matchedWordCount: 0, expectedWeight: 0, topK: [], evidence: EMPTY_EVIDENCE };

      // Bug #1 FIX: Calculate separate "previous line index" for secondary sources.
      // We only want to use the previous line of the SAME secondary document (e.g. Rashi vs Rashi).
      const prevSecondaryLineNum = (previousLink && previousLink.secondaryTarget === targetSecondary)
        ? (previousLink.secondary_line_index || null)
        : null;

      // Bug #2 FIX: DH quotes containing כו' (e.g. "עד סוף כו' ומשם ואילך עבר זמנו כו' ומקמי הכי")
      // are multi-segment quotes with omitted words in between. The plain contiguous matcher
      // in searchLineInDoc breaks as soon as it hits the literal "כו'" token, so these almost
      // always failed to match when routed to a secondary source (Rashi/Tosafot), even though
      // the same DH pattern was already handled correctly for the primary source below via
      // searchPrimaryWithFirstAnchor. We now apply the identical First-Anchor segment search
      // to Rashi/Tosafot as well, so 'כו'-לינק'ing works consistently for every source book.
      const hasKooSecondary = profile.usesContinuationSegments &&
        (/(?:^|\s)ו?כו'(?:\s|$|[.,:;])/i.test(lineForDhExtraction) || /(?:^|\s)ו?כו'(?:\s|$|[.,:;])/i.test(trimmedLine));

      // Search in secondary source if routed (unless it's 'בא"ד', in which case we don't search, we inherit)
      if (!shouldInheritLine && targetSecondary === 'rashi' && rashiDoc) {
        if (DEBUG) console.log(`🔍 Searching for Rashi: keyword='${normalizedPrefixLine}', cleanDh='${cleanDh}', lineForDhExtraction='${lineForDhExtraction}'`);
        if (hasKooSecondary) {
          if (DEBUG) console.log(`  🎯 Applying First Anchor Priority for Rashi with כו' / וכו'`);
          secMatchRes = searchPrimaryWithFirstAnchor(
            rashiDoc.lines,
            rashiSeg ? rashiSeg.startLine : 1,
            rashiSeg ? rashiSeg.endLine : rashiDoc.lines.length,
            lineForDhExtraction,
            rashiIdfMap,
            prevSecondaryLineNum,
            true,
            rashiLineCache,
            12,
            usedSecondaryLines.rashi
          );
        } else {
          secMatchRes = searchLineInDoc(
            rashiDoc.lines,
            rashiSeg ? rashiSeg.startLine : 1,
            rashiSeg ? rashiSeg.endLine : rashiDoc.lines.length,
            cleanDh,
            lineForDhExtraction,
            isExplicitDelimiter,
            rashiIdfMap,
            prevSecondaryLineNum,
            true,
            rashiLineCache,
            12,
            0.65,
            usedSecondaryLines.rashi
          );
        }
        if (DEBUG) console.log(`  → Rashi search result: lineNum=${secMatchRes.lineNum}, matchedCount=${secMatchRes.matchedCount}`);
        matchedSecondaryLineNum = secMatchRes.lineNum;

        // Explicit-reference "stubbornness": if a strict search fails to find a Rashi line
        // despite an explicit רש"י ד"ה/בד"ה citation, retry with the flexibility ladder
        // before giving up (see attemptFlexibleRetry).
        if (explicitSecondaryTarget && !matchedSecondaryLineNum) {
          if (DEBUG) console.log(`  🪜 Rashi strict search failed for explicit citation — trying flexibility ladder`);
          const ladderOutcome = attemptFlexibleRetry(
            rashiDoc.lines,
            rashiSeg ? rashiSeg.startLine : 1,
            rashiSeg ? rashiSeg.endLine : rashiDoc.lines.length,
            rashiDoc.segments,
            cleanDh,
            lineForDhExtraction,
            isExplicitDelimiter,
            rashiIdfMap,
            prevSecondaryLineNum,
            rashiLineCache,
            12,
            usedSecondaryLines.rashi
          );
          if (ladderOutcome) {
            secMatchRes = ladderOutcome.result;
            matchedSecondaryLineNum = secMatchRes.lineNum;
            secondaryRetryRung = ladderOutcome.rung;
            if (DEBUG) console.log(`  🪜 Ladder rung ${ladderOutcome.rung} found Rashi line ${matchedSecondaryLineNum}`);
          }
        }
      } else if (!shouldInheritLine && targetSecondary === 'tosafot' && tosafotDoc) {
        if (DEBUG) console.log(`🔍 Searching for Tosafot: keyword='${normalizedPrefixLine}', cleanDh='${cleanDh}', lineForDhExtraction='${lineForDhExtraction}'`);
        if (hasKooSecondary) {
          if (DEBUG) console.log(`  🎯 Applying First Anchor Priority for Tosafot with כו' / וכו'`);
          secMatchRes = searchPrimaryWithFirstAnchor(
            tosafotDoc.lines,
            tosafotSeg ? tosafotSeg.startLine : 1,
            tosafotSeg ? tosafotSeg.endLine : tosafotDoc.lines.length,
            lineForDhExtraction,
            tosafotIdfMap,
            prevSecondaryLineNum,
            true,
            tosafotLineCache,
            7,
            usedSecondaryLines.tosafot
          );
        } else {
          secMatchRes = searchLineInDoc(
            tosafotDoc.lines,
            tosafotSeg ? tosafotSeg.startLine : 1,
            tosafotSeg ? tosafotSeg.endLine : tosafotDoc.lines.length,
            cleanDh,
            lineForDhExtraction,
            isExplicitDelimiter,
            tosafotIdfMap,
            prevSecondaryLineNum,
            true,
            tosafotLineCache,
            7,
            0.65,
            usedSecondaryLines.tosafot
          );
        }
        if (DEBUG) console.log(`  → Tosafot search result: lineNum=${secMatchRes.lineNum}, matchedCount=${secMatchRes.matchedCount}`);
        matchedSecondaryLineNum = secMatchRes.lineNum;

        // Same "stubbornness" retry as Rashi above.
        if (explicitSecondaryTarget && !matchedSecondaryLineNum) {
          if (DEBUG) console.log(`  🪜 Tosafot strict search failed for explicit citation — trying flexibility ladder`);
          const ladderOutcome = attemptFlexibleRetry(
            tosafotDoc.lines,
            tosafotSeg ? tosafotSeg.startLine : 1,
            tosafotSeg ? tosafotSeg.endLine : tosafotDoc.lines.length,
            tosafotDoc.segments,
            cleanDh,
            lineForDhExtraction,
            isExplicitDelimiter,
            tosafotIdfMap,
            prevSecondaryLineNum,
            tosafotLineCache,
            7,
            usedSecondaryLines.tosafot
          );
          if (ladderOutcome) {
            secMatchRes = ladderOutcome.result;
            matchedSecondaryLineNum = secMatchRes.lineNum;
            secondaryRetryRung = ladderOutcome.rung;
            if (DEBUG) console.log(`  🪜 Ladder rung ${ladderOutcome.rung} found Tosafot line ${matchedSecondaryLineNum}`);
          }
        }
      }

      // Search in primary source segment unless the line explicitly targets a secondary source or is 'בא"ד' (which means inherit previous).
      if (!explicitSecondaryTarget && !shouldInheritLine && !skipForWindowWidth && activePass.mode === 'score') {
        // Bug #1 (Part 2) FIX: Ensure we only use the last PRIMARY source line for distance hint.
        // If previousLink was Rashi/Tosafot, line_index_2 is NOT a primary source index.
        const prevPrimaryLineNum = (previousLink && !previousLink.secondaryTarget)
          ? previousLink.line_index_2
          : (lastMatchedSrcLineIndex || null);

        if (DEBUG) console.log(`🔍 Searching PRIMARY source: lineForDhExtraction='${lineForDhExtraction}', cleanDh='${cleanDh}', isExplicit=${isExplicitDelimiter}`);


        // גישת מקטעי ההמשך כבויה בספרי הלכה: שם "כו'" כבר סגר את הד"ה בחילוץ עצמו, ומה
        // שלפניו הוא העוגן. ראו findDhBoundary ב-halachaAlgorithm.
        const hasKoo = profile.usesContinuationSegments &&
          (/(?:^|\s)ו?כו'(?:\s|$|[.,:;])/i.test(lineForDhExtraction) || /(?:^|\s)ו?כו'(?:\s|$|[.,:;])/i.test(trimmedLine));
        if (hasKoo) {
          if (DEBUG) console.log(`  🎯 Applying First Anchor Priority for primary source with כו' / וכו'`);
          srcMatchRes = searchPrimaryWithFirstAnchor(
            srcDoc.lines,
            srcStart,
            srcEnd,
            lineForDhExtraction,
            srcIdfMap,
            prevPrimaryLineNum,
            false,
            srcLineCache,
            maxDhWordsForTarget
          );
        } else {
          srcMatchRes = searchLineInDoc(
            srcDoc.lines,
            srcStart,
            srcEnd,
            cleanDh,
            lineForDhExtraction,
            isExplicitDelimiter,
            srcIdfMap,
            prevPrimaryLineNum,
            false,
            srcLineCache,
            maxDhWordsForTarget
          );
        }
        if (DEBUG) console.log(`  → PRIMARY source result: lineNum=${srcMatchRes.lineNum}, matchedCount=${srcMatchRes.matchedCount}`);
        matchedSourceLineNum = srcMatchRes.lineNum;

        // Same "stubbornness" retry for an explicit primary-source reference (גמ'/משנה)
        // that the strict search failed to resolve.
        if (explicitPrimaryTarget && !matchedSourceLineNum) {
          if (DEBUG) console.log(`  🪜 Primary-source strict search failed for explicit citation — trying flexibility ladder`);
          const ladderOutcome = attemptFlexibleRetry(
            srcDoc.lines,
            srcStart,
            srcEnd,
            srcDoc.segments,
            cleanDh,
            lineForDhExtraction,
            isExplicitDelimiter,
            srcIdfMap,
            prevPrimaryLineNum,
            srcLineCache,
            maxDhWordsForTarget
          );
          if (ladderOutcome) {
            srcMatchRes = ladderOutcome.result;
            matchedSourceLineNum = srcMatchRes.lineNum;
            primaryRetryRung = ladderOutcome.rung;
            if (DEBUG) console.log(`  🪜 Ladder rung ${ladderOutcome.rung} found primary-source line ${matchedSourceLineNum}`);
          }
        }
      }

      // If secondary source line was found and this is an explicit secondary citation,
      // use the secondary source as the actual target instead of mapping back to the primary source.
      if (explicitSecondaryTarget && matchedSecondaryLineNum) {
        matchedSourceLineNum = matchedSecondaryLineNum;
        // Claim this line so no later explicit ד"ה/בד"ה citation in this same commentary
        // segment can resolve to the exact same secondary-source line (see usedSecondaryLines).
        if (targetSecondary) {
          usedSecondaryLines[targetSecondary].add(matchedSecondaryLineNum);
        }
      }

      // If secondary source line was found, but primary source line wasn't matched directly:
      if (!explicitSecondaryTarget && matchedSecondaryLineNum && !matchedSourceLineNum) {
        let mappedPrimaryLine = (previousLink && !previousLink.secondaryTarget ? previousLink.line_index_2 : null)
          || lastMatchedSrcLineIndex 
          || (srcSeg ? srcSeg.startLine : 1);
        
        if (targetSecondary === 'rashi' && rashiLinks && rashiLinks.length > 0) {
           const link = rashiLinks.find(l => l.line_index_1 === matchedSecondaryLineNum);
           if (link) mappedPrimaryLine = link.line_index_2;
        } else if (targetSecondary === 'tosafot' && tosafotLinks && tosafotLinks.length > 0) {
           const link = tosafotLinks.find(l => l.line_index_1 === matchedSecondaryLineNum);
           if (link) mappedPrimaryLine = link.line_index_2;
        }

        matchedSourceLineNum = mappedPrimaryLine;
        // mark as inherited only when the source is derived due to a cross-reference fallback,
        // not when the line is explicitly a secondary-target citation itself.
        if (!explicitSecondaryTarget) {
          isInherited = true;
        }
      }

      // ── Single-word Dibur Hamatchil: the first-word anchor ───────────────────────────────
      // Last resort before inheritance. Fires only when NOTHING was found above — see the
      // policy note at the top of this file for what it does and why it has to exist.
      if (!matchedSourceLineNum && !matchedSecondaryLineNum && !shouldInheritLine && !skipForWindowWidth) {
        const swTargetDoc: 'rashi' | 'tosafot' | 'primary' =
          targetSecondary === 'rashi' ? 'rashi' : targetSecondary === 'tosafot' ? 'tosafot' : 'primary';
        const swDocLines =
          swTargetDoc === 'rashi' ? rashiDoc?.lines : swTargetDoc === 'tosafot' ? tosafotDoc?.lines : srcDoc.lines;
        const swCache =
          swTargetDoc === 'rashi' ? rashiLineCache : swTargetDoc === 'tosafot' ? tosafotLineCache : srcLineCache;
        // המקור הראשי נסרק בגבולות החלון, כמו כל מסלול אחר שמייצר קישור אליו.
        const swSeg = swTargetDoc === 'rashi' ? rashiSeg : swTargetDoc === 'tosafot' ? tosafotSeg
          : (srcSeg ? { ...srcSeg, startLine: srcStart, endLine: srcEnd } : srcSeg);
        const swIdf = swTargetDoc === 'rashi' ? rashiIdfMap : swTargetDoc === 'tosafot' ? tosafotIdfMap : srcIdfMap;

        // The anchor: the opening of the ד"ה, exactly as written — no prefix letters removed.
        const swWords = (cleanDh || normalizeText(lineForDhExtraction)).split(/\s+/).filter(Boolean);

        /**
         * ── עוגן ייחודי: מילה עד שלוש ────────────────────────────────────────────────────
         *
         * הנתיב הזה אינו שוקל משקלים כלל — הוא נשען על **ייחודיות**, ולכן הוא מצליח בדיוק
         * במקום שהרף נכשל בו. "יש אומרים" מקבל ציון 0.70 ונופל בכל חישוב משקל, אבל אם הצירוף
         * המדויק מופיע פעם אחת בתחום החיפוש — זו ראיה מצוינת.
         *
         * מנסים מן הארוך אל הקצר: יותר מילים = יותר ראיה, וגם סיכוי גדול בהרבה שהצירוף ייחודי.
         *
         * **שער הנדירות חל רק על עוגן של מילה אחת.** הוא קיים כדי לפסול מילה שהמחבר רגיל
         * לפתוח בה שורות ("והנה", "ובזה") — וצירוף בן שתיים-שלוש מילים אינו הרגל לשון אלא
         * ציטוט. זה כלל ולא כוונון, ולכן אינו שדה ברשומה.
         *
         * תחום החיפוש הוא החלון (`swSeg` נחתך אליו למעלה), ולכן "ייחודי" נמדד בתוך מה
         * שהעוגנים שמסביב הותירו — וזה מה שהופך את הנתיב לשמיש בשו"ע, שבו מילת מפתח חוזרת
         * בסימן שוב ושוב וייחודיות על פני הסימן כולו כמעט אינה מתקיימת.
         */
        const maxAnchorWords = Math.min(activePass.uniqueAnchorMaxWords, swWords.length);

        for (let n = maxAnchorWords; n >= 1 && !matchedSourceLineNum; n--) {
          const anchorWords = swWords.slice(0, n);
          const anchor = anchorWords.join(' ');
          const anchorLetters = anchor.replace(/[^א-ת]/g, '');
          if (anchorLetters.length < SWDH_MIN_LETTERS || !swDocLines || !swSeg) continue;
          if (n === 1 && (HEBREW_STOP_WORDS.has(anchorLetters) ||
                          swdhOpeningRatio(anchor) > profile.swdhMaxOpeningRatio)) continue;

          // Plain string equality on the normalised form. Nothing else.
          const to = Math.min(swSeg.endLine, swDocLines.length);
          let hit = 0;
          let hits = 0;
          for (let l = swSeg.startLine; l <= to; l++) {
            const entry = swCache?.[l - 1];
            const words = entry?.words;
            if (!words || words.length === 0) continue;
            const found = n === 1
              ? (swTargetDoc === 'primary' ? words.includes(anchor) : words[0] === anchor)
              // צירוף נבדק כרצף מילים שלמות, כדי ש"מים" לא ייתפס בתוך "מימיו".
              : (swTargetDoc === 'primary'
                  ? ` ${entry!.norm} `.includes(` ${anchor} `)
                  : `${entry!.norm} `.startsWith(`${anchor} `));
            if (found) {
              hits++;
              if (hits === 1) hit = l;
              else break; // a second hit already disqualifies the anchor
            }
          }

          if (hits === 1) {
            const anchorWeight = anchorWords
              .reduce((s, w) => s + getCombinedWordWeight(w, enableWordWeighting, swIdf), 0);
            const windowWeight = swWords
              .slice(0, maxDhWordsForTarget)
              .reduce((s, w) => s + getCombinedWordWeight(w, enableWordWeighting, swIdf), 0);
            const swResult: SearchResult = {
              lineNum: hit,
              matchedCount: n,
              matchedWordCount: n,
              expectedWeight: windowWeight,
              topK: [{ lineNum: hit, score: anchorWeight }],
              evidence: {
                matchedWeight: anchorWeight,
                windowWeight: windowWeight || anchorWeight,
                runWords: n,
                simSum: n,
                winnerScore: anchorWeight,
                // Uniqueness is enforced above, so there is no rival by construction.
                runnerUpScore: 0,
                // מילה בודדת אינה ביטוי, וסימונה כציטוט מילולי היה מנפח את הוודאות המדווחת
                // של הראיה הדקה ביותר שהמנוע מקבל. צירוף בן שתיים ומעלה כן נמצא כלשונו.
                exactPhrase: n > 1
              }
            };
            if (DEBUG) console.log(`  ⚓ עוגן ייחודי (${n} מילים) '${anchor}' → ${swTargetDoc} שורה ${hit}`);

            if (swTargetDoc === 'primary') {
              srcMatchRes = swResult;
              matchedSourceLineNum = hit;
            } else {
              secMatchRes = swResult;
              matchedSecondaryLineNum = hit;
              matchedSourceLineNum = hit;
            }
          }
        }
      }

      // Rule for 'שם' inheritance — applies only when shouldInheritLine is true, i.e. for the
      // explicit "בא"ד"/"א"ד" idiom, or for bare "שם" when config.inheritOnBareSham opts back
      // into the old auto-inherit behavior (see shouldInheritLine above).
      if (shouldInheritLine) {
        if (previousLink) {
          matchedSourceLineNum = previousLink.line_index_2;
          matchedSecondaryLineNum = previousLink.secondary_line_index || null;
          targetSecondary = previousLink.secondaryTarget || null;
          isInherited = true;
        }
      }

      // If no direct match found, check fallback inheritance from previous link under same header.
      // Only inherit when this is not an explicit citation to a source (primary or secondary) —
      // if the line explicitly named its target (רש"י / תוספות / גמרא / משנה) and the search for
      // that target failed, we must NOT silently paper over it with an unrelated previous link.
      // A bare "שם" line (isJustSham, not the א"ד/בא"ד idiom, and not opted back into
      // auto-inherit via config.inheritOnBareSham) is explicitly EXCLUDED from this fallback
      // too: "שם" on its own is not a citation of its own, but it's also not silently ibid —
      // if its own (post-strip) text doesn't find a match, the line should sever the
      // inheritance chain (no link at all) rather than falling back to reuse the previous
      // link, so a later line can't silently inherit through it.
      // בהלכה פותח הס"ק עומד על ראיות משלו בלבד: אם החיפוש שלו נכשל הוא נשאר בלי קישור,
      // ואינו מכסה על הכישלון בירושה מקטע קודם שאין בינו לבינו דבר. במבנה שבו קטע פירוש הוא
      // שורה אחת (allowsInheritance=false) אין ירושה כזאת כלל.
      const isBareShamNoInherit = isJustSham && !shamShouldInherit;
      if (!matchedSourceLineNum && profile.allowsInheritance && !isSeifKatanOpener && !explicitSecondaryTarget && !explicitPrimaryTarget && !isBareShamNoInherit && previousLink && previousLink.line_index_2) {
        matchedSourceLineNum = previousLink.line_index_2;
        matchedSecondaryLineNum = previousLink.secondary_line_index || null;
        targetSecondary = previousLink.secondaryTarget || null;
        isInherited = true;
      }

      // If we got a source line match, create OtzariaLink
      if (matchedSourceLineNum) {
        // Bug #2 FIX: Only update the last matched PRIMARY source index if the match was actually in the primary source.
        if (!targetSecondary) {
          lastMatchedSrcLineIndex = matchedSourceLineNum;
        }
        
        // Fallback for older UI-created links or incomplete inheritance
        if (targetSecondary && !matchedSecondaryLineNum) {
           matchedSecondaryLineNum = matchedSourceLineNum;
        }

        const isSecondaryLink = Boolean(targetSecondary);
        if (isSecondaryLink) {
          if (DEBUG) console.log(`🔗 Line ${cLineIdx}: Creating SECONDARY link: targetSecondary=${targetSecondary}, matchedSecondaryLineNum=${matchedSecondaryLineNum}, matchedSourceLineNum=${matchedSourceLineNum}`);
        }
        
        const headerTitle = isSecondaryLink
          ? (targetSecondary === 'rashi' ? rashiSeg?.headerTitle : tosafotSeg?.headerTitle) || config.targetBookName
          : srcSeg ? srcSeg.headerTitle : config.targetBookName;

        // A line that took its target wholesale from the previous link points at a line in
        // whichever segment that target lives in — this segment's matching source segment in the
        // ordinary case, but the PREVIOUS one when the chain crossed a header (a segment opening
        // with בא"ד). The reference must describe the target line, so it is copied along with the
        // target instead of being recomputed from this segment's header: inside a segment the two
        // produce the same string, across a header they differ by a whole daf.
        const prevForRef = previousLink;
        const inheritsReference = Boolean(
          isInherited && prevForRef &&
          matchedSourceLineNum === prevForRef.line_index_2 &&
          (targetSecondary || null) === (prevForRef.secondaryTarget || null) &&
          (matchedSecondaryLineNum || null) === (prevForRef.secondary_line_index || null)
        );

        const heRef = (inheritsReference && prevForRef)
          ? prevForRef.heRef_2
          : isSecondaryLink
            ? `${getSecondaryBookLabel(targetSecondary!)} - ${headerTitle}`
            : `${config.targetBookName} - ${headerTitle}`;
        const path_2 = (inheritsReference && prevForRef)
          ? prevForRef.path_2
          : isSecondaryLink
            ? getSecondaryPath(targetSecondary!, config.targetBookName)
            : `${config.targetBookName}.txt`;
        const secondaryRef = !isSecondaryLink
          ? undefined
          : (inheritsReference && prevForRef?.secondaryRef)
            ? prevForRef.secondaryRef
            : `${getSecondaryBookLabel(targetSecondary!)} (${headerTitle})`;

        // Which retry-ladder rung (if any) actually produced this link's match — the
        // secondary-source path's rung if this is a secondary link, otherwise the
        // primary-source path's rung.
        const retryRungForConfidence = isSecondaryLink ? secondaryRetryRung : primaryRetryRung;

        // Evidence comes from the search that actually produced this link, taken as one
        // coherent object. (The old code took `matchScore` and `expectedWeight` through two
        // independent Math.max calls, so a ratio could be built from one search's numerator
        // over the other search's denominator.)
        const producingRes = isSecondaryLink
          ? (secMatchRes.lineNum ? secMatchRes : srcMatchRes)
          : (srcMatchRes.lineNum ? srcMatchRes : secMatchRes);

        const confidence = calculateLinkConfidence({
          isInherited: Boolean(isInherited),
          inheritDepth: previousInheritDepth + 1,
          inheritedFrom: previousLink?.confidence,
          isExplicit: isExplicitDelimiter,
          retryRung: retryRungForConfidence,
          evidence: producingRes.evidence,
          passIndex: activePassIndex,
          searchRangeWidth
        });
        // Calibration tap. Inert unless a harness has installed the sink — the optional call
        // costs one property read per link and the array does not exist in the app. It is the
        // only way qa/confidence.ts can see the per-link evidence behind a percentage, which
        // is what the reliability report and the Platt re-fit are computed from. Writes
        // nothing to the link and is never read back by the parser. See CONF.CAL_A/CAL_B.
        (globalThis as any).__CONF_TAP?.push({
          ev: producingRes.evidence, isExplicit: isExplicitDelimiter, rung: retryRungForConfidence,
          inherited: Boolean(isInherited), depth: previousInheritDepth + 1, parent: previousLink?.confidence,
          confidence, cLine: cLineIdx, tLine: matchedSourceLineNum, secLine: matchedSecondaryLineNum,
          sec: targetSecondary, dh: dhText || cleanDh
        });
        const status: 'approved' | 'pending' = confidence >= 85 ? 'approved' : 'pending';

        // Build Top-K candidates list from whichever source produced the match.
        // Each candidate gets its own confidence score so the UI can show it.
        const rawTopK = explicitSecondaryTarget
          ? secMatchRes.topK
          : srcMatchRes.topK.length > 0
            ? srcMatchRes.topK
            : secMatchRes.topK;

        // Each candidate is scored as if it were the chosen one, so the dropdown ranks the
        // alternatives instead of repeating one number three times (which is what it did
        // before: every candidate of every multi-candidate link shared an identical value).
        //
        // Only the winner's evidence was measured in full, so a rival's is derived from it by
        // the ratio of their ranking scores — the quantity that separated them in the first
        // place — holding mean per-word exactness fixed and re-deriving each candidate's own
        // margin against its own best rival. Approximate in magnitude, faithful in ordering.
        const winnerEv = producingRes.evidence;
        const candidateEvidence = (score: number, rivalBest: number): MatchEvidence => {
          const ratio = winnerEv.winnerScore > 0 ? Math.max(0, score / winnerEv.winnerScore) : 1;
          const meanSim = winnerEv.runWords > 0 ? winnerEv.simSum / winnerEv.runWords : 0;
          const runWords = Math.max(1, Math.round(winnerEv.runWords * ratio));
          return {
            matchedWeight: winnerEv.matchedWeight * ratio,
            windowWeight: winnerEv.windowWeight,
            runWords,
            simSum: meanSim * runWords,
            winnerScore: score,
            runnerUpScore: rivalBest,
            // The verbatim flag was established for the winning line only.
            exactPhrase: winnerEv.exactPhrase && score >= winnerEv.winnerScore
          };
        };

        const linkCandidates: import('../types').LinkCandidate[] = rawTopK.map((c, i) => ({
          lineNum: c.lineNum,
          score: c.score,
          confidence: calculateLinkConfidence({
            isExplicit: isExplicitDelimiter,
            retryRung: retryRungForConfidence,
            passIndex: activePassIndex,
            searchRangeWidth,
            evidence: candidateEvidence(
              c.score,
              rawTopK.reduce((best, o, j) => (j === i ? best : Math.max(best, o.score)), 0)
            )
          })
        }));

        const targetDocLines = isSecondaryLink
          ? (targetSecondary === 'rashi' ? rashiDoc?.lines : tosafotDoc?.lines)
          : srcDoc.lines;
        const targetLineText = targetDocLines && targetDocLines[matchedSourceLineNum - 1] ? targetDocLines[matchedSourceLineNum - 1] : '';
        const matchRange = findSourceMatchRange(targetLineText, dhText || cleanDh) || undefined;

        const newLink: OtzariaLink = {
          line_index_1: cLineIdx,
          line_index_2: matchedSourceLineNum,
          heRef_2: heRef,
          path_2,
          connection_type: "commentary",
          secondaryTarget: targetSecondary || undefined,
          secondary_line_index: matchedSecondaryLineNum || undefined,
          secondaryRef,
          isInherited,
          dhText: dhText || cleanDh,
          confidence,
          status,
          matchRange,
          candidates: linkCandidates.length > 0 ? linkCandidates : undefined,
          candidateIndex: 0
        };

        links.push(newLink);
        // מעבר מאוחר עשוי למצוא עוגן לשורה שקיבלה קישור מורש במעבר קודם. הירושה כבר נמחקה
        // בפתח המעבר, ולכן במקרה הזה אין כפילות — אבל השמירה כאן מגנה גם על סדר אחר.
        if (!isInherited) {
          anchorByLine.set(cLineIdx, newLink);
          if (!targetSecondary) orderFloor = matchedSourceLineNum;
        }
        previousLink = newLink;
        // A link matched on its own evidence restarts the chain; an inherited one extends it.
        previousInheritDepth = isInherited ? previousInheritDepth + 1 : 0;
        previousSecondaryType = targetSecondary;
      } else if (skMode) {
        // במבנה ס"ק כישלון של פותח ס"ק אינו מנתק את השרשרת: previousLink נשאר על הקישור
        // המוצלח האחרון, כך שההמשכים שמתחתיו עדיין יורשים אותו במקום להישאר יתומים. הכלל
        // של ש"ס (ניתוק בכל שורה בלי קישור) נשען על כך שכל שורה שם היא מועמדת לחיפוש; כאן
        // רוב השורות ממילא אינן מחפשות, ולכן ניתוק היה מוחק קטעים שלמים בגלל כישלון בודד.
      } else {
        // Rule: a content line that ends up with NO link at all breaks the inheritance chain.
        // Without this, a later line (e.g. line 6) could silently inherit a link from an
        // earlier line (e.g. line 4) by skipping over a linkless line (e.g. line 5) in between.
        previousLink = null;
        previousInheritDepth = 0;
      }

      // Calculate initial DH word highlight range (words count)
      const wordsInLine = trimmedLine.split(/\s+/).filter(Boolean);
      let dhWordCount = 0;
      if (isExplicitDelimiter && dhText) {
        dhWordCount = dhText.split(/\s+/).filter(Boolean).length;
      } else {
        dhWordCount = srcMatchRes.matchedWordCount > 0 
          ? srcMatchRes.matchedWordCount 
          : (secMatchRes.matchedWordCount > 0 ? secMatchRes.matchedWordCount : Math.min(4, wordsInLine.length));
      }

      dhHighlights[cLineIdx] = {
        wordStart: dhWordOffset,
        wordCount: Math.max(1, Math.min(dhWordCount, wordsInLine.length))
      };
    }

    // Hand this segment's tail on to the next one, for the case where the next segment opens
    // with בא"ד. A segment with no content lines of its own has nothing to say about the chain,
    // so it passes the previous segment's tail through untouched.
    if (segmentHadContent) {
      carriedLink = previousLink;
      carriedInheritDepth = previousInheritDepth;
    }
  });

  }); // passes

  /**
   * ── מילוי פערים בין שני עוגנים זהים ────────────────────────────────────────────────────
   * שני קטעי פירוש שנמצאו — כל אחד בזכות עצמו — כנגד אותה שורת מקור, כולאים ביניהם קטע שהחיפוש
   * לא מצא לו דבר. הכליאה עצמה היא הראיה: הפירוש עובר על המקור לפי סדרו, וקטע שיושב בין שני
   * קטעים שדנים באותה שורה דן בה גם הוא. לכן הוא מקבל את אותה שורה, מסומן כירושה (הקישור אינו
   * נשען על ראיות טקסטואליות משלו) ובוודאות שנגזרת מן העוגן שכלא אותו.
   *
   * רק עוגן אמיתי — קישור שלא נורש בעצמו — סוגר פער; שורות שכבר ירשו הקשר אינן משנות דבר,
   * שכן הן ממילא מצביעות על היעד של העוגן שמעליהן. הפער אינו חוצה כותרת "סימן": מעברה מדובר
   * בסימן אחר בשו"ע, ואין שום משמעות לכליאה בין שני צדדיו.
   */
  if (profile.fillsGapsBetweenEqualAnchors) {
    const filled = fillGapsBetweenEqualAnchors({
      links,
      commLines: commDoc.lines,
      segments: commDoc.segments,
      firstSegIdx: Math.max(0, firstAlignedSegIdx),
      sourceLines: srcDoc.lines,
      dhHighlights,
      profile
    });
    if (filled.length > 0) {
      if (DEBUG) console.log(`  🌉 מילוי פערים: ${filled.length} שורות קיבלו קישור מן העוגנים שסביבן`);
      links.push(...filled);
      links.sort((a, b) => a.line_index_1 - b.line_index_1);
    }
  }

  return {
    links,
    commentaryLines: commDoc.lines,
    sourceLines: srcDoc.lines,
    rashiLines: rashiDoc?.lines,
    tosafotLines: tosafotDoc?.lines,
    dhHighlights
  };
}

/**
 * Whether a commentary line takes part in linking at all under `profile` — the same set of
 * skips the linking loop performs before it decides link / no link. Kept next to the loop so a
 * later pass over the same document (the gap filling below) does not count a structural line as
 * a piece that failed to find its source.
 */
export function isLinkableContentLine(rawLine: string, profile: SourceProfile): boolean {
  if (!rawLine || !rawLine.trim()) return false;
  if (isHeaderLine(rawLine, profile)) return false;
  if (profile.numberingDrivesLinking && isSeifKatanMarkerLine(rawLine)) return false;
  if (profile.stripsNumbering && !stripHalachaNumbering(rawLine).trim()) return false;
  return true;
}

/**
 * ── יחידות וחלונות ─────────────────────────────────────────────────────────────────────────
 *
 * **יחידה** היא שורת פירוש שהפרופיל מכניס לחיפוש — במבנה ס"ק פותח ס"ק, ובשאר המבנים כל שורת
 * תוכן. **החלון** של יחידה הוא טווח שורות המקור שעדיין אפשריות עבורה, כפי ששכניה המקושרים
 * כולאים אותו משני צדדיו.
 *
 * שני הכללים שהתוכנית נשענת עליהם הם למעשה כלל אחד: מעבר שמחפש רק בתוך החלון אינו יכול
 * לייצר נסיגה אחורה, ולכן אין צורך בבדיקת מונוטוניות נפרדת בסוף. ראו
 * docs/HALACHA_MULTIPASS_PLAN.md סעיף 2.
 *
 * הקוד הזה הוא **העותק היחיד** של הכלל: גם מנוע המעברים וגם דוח המדידה (qa/halacha.metrics.ts)
 * קוראים לו, מאותו טעם ש-`continuesByProfile` הוא עותק יחיד — שני עותקים של אותו כלל סוטים
 * זה מזה, וכאן הסטייה הייתה מייצרת דוח שמודד ספר אחר מזה שהמנוע עיבד.
 */
export interface LinkUnit {
  /** מספר השורה בקובץ הפירוש (1-based). */
  lineIdx1: number;
  /** מונה הסגמנט. גבול-סגמנט (כותרת "סימן") מאפס את מניית הסדר ואת החלונות. */
  segment: number;
  /** שורת המקור שקושרה, או null. */
  target: number | null;
  /** הקישור נורש (שם / בא"ד / המשך ס"ק / מילוי פער) ולא נמצא בזכות עצמו. */
  inherited: boolean;
}

/** גבולות החיפוש שיחידה ירשה משכניה. `null` בצד כלשהו = אינו חסום. */
export interface UnitWindow {
  /** אין לרדת מתחת לשורה הזאת — העוגן הקרוב שמעל, באותו סגמנט. */
  lo: number | null;
  /** אין לעלות מעליה — העוגן הקרוב שמתחת. */
  hi: number | null;
  /** רוחב בשורות, מוגדר רק כששני הצדדים חסומים. רוחב 1 = הוכרע בלי ראיה טקסטואלית. */
  width: number | null;
}

/** רשימת היחידות של מסמך הפירוש, לפי סדרן, עם התוצאה שכל אחת קיבלה. */
export function buildLinkUnits(
  commentaryLines: string[],
  links: OtzariaLink[],
  profile: SourceProfile
): LinkUnit[] {
  const byLine = new Map(links.map(l => [l.line_index_1, l]));
  const units: LinkUnit[] = [];
  let segment = 0;

  commentaryLines.forEach((raw, i) => {
    // בפרופיל הלכה רק כותרת "סימן" מחזירה true כאן — כותרת ממוספרת היא שורת תוכן.
    if (isHeaderLine(raw, profile)) { segment++; return; }
    if (!isLinkableContentLine(raw, profile)) return;
    const link = byLine.get(i + 1);
    units.push({
      lineIdx1: i + 1,
      segment,
      target: link ? link.line_index_2 : null,
      inherited: Boolean(link?.isInherited)
    });
  });

  return units;
}

/**
 * החלון של היחידה במקום `idx`.
 *
 * **רק עוגן אמיתי סוגר חלון** — קישור שנורש בעצמו אינו ראיה עצמאית, ולכן אינו משמש גבול.
 * זהו אותו סייג שמילוי הפערים כבר עושה (`fillGapsBetweenEqualAnchors`), ומאותה סיבה: בלעדיו
 * הכלל היה מגשים את עצמו — רצף השורות שמתחת לכישלון היה "כלוא" בין שני עותקים של אותו קישור
 * מורש, והחלון היה מודד את הכישלון שהוא אמור לפתור.
 *
 * **הגבולות כלולים.** סעיף אחד בשו"ע נושא לעיתים קרובות עשרה ס"ק, ולכן חלון שקצותיו מצביעים
 * על אותה שורה הוא חלון תקין ברוחב 1 — המקרה הנפוץ ביותר בספר. גבול בלעדי היה מוחק אותו.
 */
export function windowForUnit(units: LinkUnit[], idx: number): UnitWindow {
  const segment = units[idx].segment;
  let lo: number | null = null;
  let hi: number | null = null;

  for (let i = idx - 1; i >= 0 && units[i].segment === segment; i--) {
    if (units[i].target !== null && !units[i].inherited) { lo = units[i].target; break; }
  }
  for (let i = idx + 1; i < units.length && units[i].segment === segment; i++) {
    if (units[i].target !== null && !units[i].inherited) { hi = units[i].target; break; }
  }

  return { lo, hi, width: lo === null || hi === null ? null : Math.max(1, hi - lo + 1) };
}

/**
 * משקל הראיה של עוגן, לצורך M1 — ציון הדירוג של השורה שנבחרה, כפי שהמנוע עצמו חישב אותו.
 *
 * **בכוונה לא `confidence`.** אחוז הוודאות הוא ערך תצוגה שאינו מוזן חזרה למנוע (ראו הערת
 * מודל ה-confidence בראש הקובץ), ושימוש בו כאן היה שובר בדיוק את ההפרדה הזאת.
 */
function anchorEvidenceWeight(link: OtzariaLink): number {
  const cands = link.candidates;
  if (!cands || cands.length === 0) return 1;
  const own = cands.find(c => c.lineNum === link.line_index_2);
  return own ? own.score : cands.reduce((best, c) => Math.max(best, c.score), 0) || 1;
}

/**
 * ── M1: ניכוי עוגנים סותרים ─────────────────────────────────────────────────────────────────
 *
 * מעברי העוגן סורקים את הסימן כולו בלי אילוץ סדר, כי בשלב שהם רצים בו אין עדיין נקודות
 * קבועות שאפשר להיתלות בהן. לכן ייתכן שבסופם עוגן אחד סותר את שכניו — מצביע על שורה הקודמת
 * לזו של הס"ק שלפניו, מה שאינו אפשרי כשהפירוש עובר על השו"ע לפי סדרו.
 *
 * **זהו הצעד הקריטי בכל התוכנית.** עוגן שגוי אינו קישור שגוי אחד: הוא קובע את החלון לכל מה
 * שסביבו ודוחף רצף שלם של ס"ק לטווח הלא נכון. שגיאה אחת הופכת לעשר.
 *
 * הפתרון: בכל סגמנט נשמרת **תת-הסדרה הכבדה ביותר שאינה יורדת**, והשאר נזרק. הבחירה לפי משקל
 * הראיה — ולא לפי סדר הגילוי — היא מה שמבטיח שהעוגן שנזרק הוא החלש מבין הסותרים ולא המאוחר
 * שבהם. `n` הוא מספר היחידות בסימן (עשרות), ולכן DP ריבועי הוא זול לחלוטין.
 *
 * "אינה יורדת" ולא "עולה ממש": סעיף אחד בשו"ע נושא לעיתים קרובות עשרה ס"ק, ודרישת עלייה
 * ממש הייתה מוחקת את המקרה הנפוץ ביותר בספר.
 *
 * מחזיר את הקישורים שנזרקו.
 */
export function pruneConflictingAnchors(links: OtzariaLink[], units: LinkUnit[]): OtzariaLink[] {
  const byLine = new Map(links.map(l => [l.line_index_1, l]));
  const dropped: OtzariaLink[] = [];

  const segments = new Map<number, LinkUnit[]>();
  for (const u of units) {
    if (u.target === null || u.inherited) continue;
    const list = segments.get(u.segment);
    if (list) list.push(u); else segments.set(u.segment, [u]);
  }

  for (const anchors of segments.values()) {
    if (anchors.length < 2) continue;

    const w = anchors.map(a => {
      const link = byLine.get(a.lineIdx1);
      return link ? anchorEvidenceWeight(link) : 1;
    });
    const best = new Array<number>(anchors.length);
    const prev = new Array<number>(anchors.length).fill(-1);
    let endIdx = 0;

    for (let i = 0; i < anchors.length; i++) {
      best[i] = w[i];
      for (let j = 0; j < i; j++) {
        if (anchors[j].target! <= anchors[i].target! && best[j] + w[i] > best[i]) {
          best[i] = best[j] + w[i];
          prev[i] = j;
        }
      }
      if (best[i] > best[endIdx]) endIdx = i;
    }

    const keep = new Set<number>();
    for (let i = endIdx; i !== -1; i = prev[i]) keep.add(i);

    anchors.forEach((a, i) => {
      if (keep.has(i)) return;
      const link = byLine.get(a.lineIdx1);
      if (!link) return;
      const at = links.indexOf(link);
      if (at !== -1) links.splice(at, 1);
      dropped.push(link);
    });
  }

  return dropped;
}

/** The target a link points at, as one comparable value. Two links with the same key agree. */
function linkTargetKey(link: OtzariaLink): string {
  return `${link.line_index_2}|${link.secondaryTarget || ''}|${link.secondary_line_index || ''}`;
}

/**
 * Links for the linkless commentary lines that sit between two links pointing at the SAME target
 * line — see the note at the call site for why such a line belongs to that target. Returns only
 * the new links; nothing already linked is touched.
 *
 * Only a link matched on its own evidence (`isInherited` falsy) can bound a gap. An inherited
 * link merely repeats the anchor above it, so letting one close a gap would make the rule
 * self-fulfilling: the run of lines under a failed piece would be "bounded" by two copies of the
 * same inherited target and swallow the failure instead of reporting it.
 */
function fillGapsBetweenEqualAnchors(params: {
  links: OtzariaLink[];
  commLines: string[];
  segments: HeaderSegment[];
  firstSegIdx: number;
  sourceLines: string[];
  dhHighlights: Record<number, DHHighlight>;
  profile: SourceProfile;
}): OtzariaLink[] {
  const { links, commLines, segments, firstSegIdx, sourceLines, dhHighlights, profile } = params;
  const linkByLine = new Map(links.map(l => [l.line_index_1, l]));
  const created: OtzariaLink[] = [];

  /** The line's own Dibur Hamatchil, as the parser marked it — a gap-filled line still has one. */
  const dhTextOf = (lineIdx1: number): string | undefined => {
    const highlight = dhHighlights[lineIdx1];
    if (!highlight) return undefined;
    const words = (commLines[lineIdx1 - 1] || '').split(/\s+/).filter(Boolean);
    const picked = words.slice(highlight.wordStart, highlight.wordStart + highlight.wordCount);
    return picked.length > 0 ? picked.join(' ') : undefined;
  };

  const fill = (lineIdx1: number, anchor: OtzariaLink): OtzariaLink => {
    const dhText = dhTextOf(lineIdx1);
    // The anchor's target text, so the highlight is re-derived against the line actually linked
    // to rather than copied from the anchor, whose Dibur Hamatchil is a different quote.
    const targetText = anchor.secondaryTarget ? '' : (sourceLines[anchor.line_index_2 - 1] || '');
    const confidence = calculateLinkConfidence({
      isInherited: true,
      inheritDepth: 1,
      inheritedFrom: anchor.confidence
    });
    return {
      line_index_1: lineIdx1,
      line_index_2: anchor.line_index_2,
      heRef_2: anchor.heRef_2,
      path_2: anchor.path_2,
      connection_type: 'commentary',
      secondaryTarget: anchor.secondaryTarget,
      secondary_line_index: anchor.secondary_line_index,
      secondaryRef: anchor.secondaryRef,
      isInherited: true,
      dhText,
      confidence,
      status: confidence >= 85 ? 'approved' : 'pending',
      matchRange: (dhText && targetText) ? (findSourceMatchRange(targetText, dhText) || undefined) : undefined
    };
  };

  segments.forEach((seg, segIdx) => {
    if (segIdx < firstSegIdx) return;

    let anchor: OtzariaLink | null = null;
    let pending: number[] = [];

    for (let lineIdx1 = seg.startLine; lineIdx1 <= Math.min(seg.endLine, commLines.length); lineIdx1++) {
      const raw = commLines[lineIdx1 - 1];
      if (!isLinkableContentLine(raw, profile)) continue;

      const link = linkByLine.get(lineIdx1);
      if (!link) {
        pending.push(lineIdx1);
        continue;
      }
      // A line that inherited its context is neither an anchor nor a gap: it already points
      // where the anchor above it points.
      if (link.isInherited) continue;

      if (anchor && pending.length > 0 && linkTargetKey(link) === linkTargetKey(anchor)) {
        pending.forEach(gapLine => created.push(fill(gapLine, anchor!)));
      }
      anchor = link;
      pending = [];
    }
  });

  return created;
}

/**
 * Formats commentary line text with <b>...</b> applied based on DHHighlight configuration
 */
export function findSourceMatchRange(sourceLine: string, dhText: string): DHHighlight | null {
  if (!sourceLine || !dhText) return null;

  // The indices returned here are consumed by renderers that tokenise the RAW line
  // (`line.split(/(\s+)/)`), so the match has to be resolved back into that same token
  // space. Normalising the whole line first drops punctuation-only, markup-only and
  // Latin-only tokens entirely, which silently shifts every following index — the
  // highlight then lands on the wrong words. Tokenise raw first, normalise per token,
  // and remember which raw token each comparable word came from.
  const rawTokens = sourceLine.split(/\s+/).filter(Boolean);
  const targetWords: string[] = [];
  const targetRawIndex: number[] = [];

  rawTokens.forEach((token, rawIdx) => {
    normalizeText(token).split(/\s+/).filter(Boolean).forEach(word => {
      // Leftovers with no letter or digit (stray quotes from tag attributes, lone
      // punctuation) can never match a Dibur Hamatchil word.
      if (!/[א-ת0-9]/.test(word)) return;
      targetWords.push(word);
      targetRawIndex.push(rawIdx);
    });
  });

  const sourceWords = normalizeText(stripHtmlTags(dhText)).split(/\s+/).filter(Boolean);
  if (targetWords.length === 0 || sourceWords.length === 0) return null;

  /** Indices into the RAW token array, i.e. exactly what the renderers count. */
  const matchedIndices: number[] = [];

  for (let srcIdx = 0; srcIdx < sourceWords.length; srcIdx++) {
    const w1 = sourceWords[srcIdx];
    let bestTgtIdx = -1;
    let bestSim = 0;

    for (let tgtIdx = 0; tgtIdx < targetWords.length; tgtIdx++) {
      const w2 = targetWords[tgtIdx];
      
      // 1. Direct similarity match
      let sim = getWordSimilarity(w1, w2, true);

      // 2. Abbreviation map match
      if (sim <= 0.4) {
        const options1 = NORMALIZED_ABBREVIATIONS_MAP[w1];
        if (options1) {
          for (const opt of options1) {
            if (opt.split(/\s+/).some(optW => getWordSimilarity(optW, w2, true) > 0.6)) {
              sim = 0.8;
              break;
            }
          }
        }
        if (sim <= 0.4) {
          const options2 = NORMALIZED_ABBREVIATIONS_MAP[w2];
          if (options2) {
            for (const opt of options2) {
              if (opt.split(/\s+/).some(optW => getWordSimilarity(optW, w1, true) > 0.6)) {
                sim = 0.8;
                break;
              }
            }
          }
        }
      }

      // 3. Simple character-level prefix/abbreviation heuristic
      if (sim <= 0.4) {
        const clean1 = w1.replace(/['"]/g, '');
        const clean2 = w2.replace(/['"]/g, '');
        if (clean1 && clean2) {
          if (clean1.startsWith(clean2) || clean2.startsWith(clean1)) {
            sim = 0.6;
          }
        }
      }

      if (sim > bestSim) {
        bestSim = sim;
        bestTgtIdx = tgtIdx;
      }
    }

    if (bestSim > 0.4 && bestTgtIdx !== -1) {
      matchedIndices.push(targetRawIndex[bestTgtIdx]);
    }
  }

  if (matchedIndices.length === 0) return null;

  // Sort and de-dupe (two different DH words can independently map to the same target word)
  matchedIndices.sort((a, b) => a - b);
  const uniqueIndices = matchedIndices.filter((idx, i) => i === 0 || idx !== matchedIndices[i - 1]);

  // Group into segments of consecutive target-word indices. An unmatched word sitting
  // between two matched clusters starts a new segment instead of being silently bridged
  // into one continuous highlight.
  const segments: { wordStart: number; wordCount: number }[] = [];
  let segStart = uniqueIndices[0];
  let segEnd = uniqueIndices[0];
  for (let i = 1; i < uniqueIndices.length; i++) {
    const idx = uniqueIndices[i];
    if (idx === segEnd + 1) {
      segEnd = idx;
    } else {
      segments.push({ wordStart: segStart, wordCount: segEnd - segStart + 1 });
      segStart = idx;
      segEnd = idx;
    }
  }
  segments.push({ wordStart: segStart, wordCount: segEnd - segStart + 1 });

  const minIdx = uniqueIndices[0];
  const maxIdx = uniqueIndices[uniqueIndices.length - 1];
  const totalSpan = maxIdx - minIdx + 1;

  // Safeguard: if matches are extremely sparse across a massive line, the overall bounding
  // span (wordStart/wordCount) is meaningless for legacy consumers that don't read `segments`
  // — collapse it to just the first cluster. `segments` itself still lists every real matched
  // cluster with no bridging, for consumers that do read it.
  if (totalSpan > sourceWords.length + 5 && uniqueIndices.length < sourceWords.length / 2) {
    return { wordStart: segments[0].wordStart, wordCount: segments[0].wordCount, segments };
  }

  return { wordStart: minIdx, wordCount: totalSpan, segments };
}

export function formatLineWithDH(line: string, highlight?: DHHighlight, customId?: string, isSource?: boolean, forExport?: boolean): string {
  if (!line || !line.trim()) return line || '';
  if (!highlight || highlight.wordCount <= 0) return line;

  try {
    const words = line.split(/(\s+)/); // Keep spaces preserved
    const actualWords: { text: string; wordIndex: number; arrayIndex: number }[] = [];
    
    let currentWordIdx = 0;
    for (let i = 0; i < words.length; i++) {
      if (words[i].trim().length > 0) {
        actualWords.push({ text: words[i], wordIndex: currentWordIdx, arrayIndex: i });
        currentWordIdx++;
      }
    }

    if (actualWords.length === 0) return line;

    // Use disjoint segments when available so an unmatched word sitting in a gap is
    // never swept into the highlight; otherwise fall back to the single wordStart/wordCount
    // span (older sessions / callers that predate segment support).
    const rangesToHighlight = (highlight.segments && highlight.segments.length > 0)
      ? highlight.segments
      : [{ wordStart: highlight.wordStart, wordCount: highlight.wordCount }];

    rangesToHighlight.forEach((seg, segIdx) => {
      const startWord = Math.max(0, Math.min(seg.wordStart, actualWords.length - 1));
      const count = Math.max(1, seg.wordCount);
      const endWord = Math.min(actualWords.length, startWord + count);

      if (startWord >= actualWords.length || endWord <= 0) return;

      const startArrIdx = actualWords[startWord]?.arrayIndex;
      const endArrIdx = actualWords[Math.max(0, Math.min(actualWords.length - 1, endWord - 1))]?.arrayIndex;

      if (startArrIdx === undefined || endArrIdx === undefined) return;

      if (forExport) {
        words[startArrIdx] = '<b>' + words[startArrIdx];
        words[endArrIdx] = words[endArrIdx] + '</b>';
      } else {
        // Only the first (earliest) segment carries the custom id, so a match split across
        // multiple non-adjacent clusters doesn't produce duplicate DOM ids.
        const spanId = (customId && segIdx === 0) ? ` id="${customId}"` : '';
        const spanClass = isSource
          ? ` class="source-match-highlight bg-yellow-200/60 dark:bg-yellow-500/30 border border-gray-400 dark:border-gray-600 rounded px-0.5 mx-0.5"`
          : ` class="dh-highlight font-bold bg-yellow-200/60 dark:bg-yellow-500/30 border border-gray-400 dark:border-gray-600 rounded px-0.5 mx-0.5"`;

        words[startArrIdx] = `<mark${spanId}${spanClass}>` + words[startArrIdx];
        words[endArrIdx] = words[endArrIdx] + '</mark>';
      }
    });

    return words.join('');
  } catch (e) {
    console.error('Error in formatLineWithDH:', e);
    return line;
  }
}

/** Pulls a stored span back inside a line that lost words to markup stripping. */
function clampHighlight(highlight: DHHighlight, line: string): DHHighlight {
  const lineWordCount = line.split(/\s+/).filter(Boolean).length;
  if (lineWordCount === 0) return { wordStart: 0, wordCount: 0 };
  const wordStart = Math.max(0, Math.min(highlight.wordStart, lineWordCount - 1));
  return {
    wordStart,
    wordCount: Math.max(1, Math.min(highlight.wordCount, lineWordCount - wordStart))
  };
}

/**
 * Brings a session saved BEFORE markup was stripped at ingestion in line with one parsed today.
 *
 * The stored lines can simply be cleaned, but `dhHighlights` and `matchRange` cannot be carried
 * over with them: both are token indices into the stored line, and dropping an
 * `<i data-commentator=…></i>` removes tokens, so every index past one of them shifts. They are
 * re-derived from the ד"ה that produced them in the first place — the same `findSourceMatchRange`
 * call the parser and the manual editor make — rather than dropped, so the editor is not left
 * recomputing every range on every render of a שולחן ערוך-sized document.
 *
 * Returns the session untouched when nothing needed stripping: that is every session parsed
 * after this change (`parseDocumentSegments` cleaned it already) and every corpus that carries
 * no markup, so the re-derivation can never disturb a session that has nothing to migrate.
 */
export function sanitizeSessionMarkup(session: SessionState): SessionState {
  const cleanDoc = (lines: string[]): string[] =>
    lines.map(line => (HEADER_TAG_RE.test(line) ? line : stripContentMarkup(line)));

  const commentaryLines = cleanDoc(session.commentaryLines);
  const sourceLines = cleanDoc(session.sourceLines);
  const rashiLines = session.rashiLines ? cleanDoc(session.rashiLines) : session.rashiLines;
  const tosafotLines = session.tosafotLines ? cleanDoc(session.tosafotLines) : session.tosafotLines;

  const differs = (before?: string[], after?: string[]) =>
    !!before && !!after && before.some((line, i) => line !== after[i]);

  const commentaryChanged = differs(session.commentaryLines, commentaryLines);
  const targetsChanged =
    differs(session.sourceLines, sourceLines) ||
    differs(session.rashiLines, rashiLines) ||
    differs(session.tosafotLines, tosafotLines);

  if (!commentaryChanged && !targetsChanged) return session;

  const links = !targetsChanged ? session.links : session.links.map(link => {
    // A link with no stored range is already recomputed on the fly by the renderer, and one
    // with no ד"ה has nothing to recompute from.
    if (!link.matchRange || !link.dhText) return link;
    const targetLines = link.secondaryTarget
      ? (link.secondaryTarget === 'rashi' ? rashiLines : tosafotLines)
      : sourceLines;
    const targetLineIdx1 = link.secondaryTarget
      ? (link.secondary_line_index ?? link.line_index_2)
      : link.line_index_2;
    const targetText = targetLines?.[targetLineIdx1 - 1] || '';
    return { ...link, matchRange: findSourceMatchRange(targetText, link.dhText) || undefined };
  });

  let dhHighlights = session.dhHighlights;
  if (commentaryChanged && dhHighlights) {
    const dhTextByLine = new Map(session.links.map(link => [link.line_index_1, link.dhText]));
    const remapped: Record<number, DHHighlight> = {};
    for (const [key, highlight] of Object.entries(dhHighlights)) {
      const lineIdx1 = Number(key);
      const line = commentaryLines[lineIdx1 - 1] || '';
      const dhText = dhTextByLine.get(lineIdx1);
      const rederived = dhText ? findSourceMatchRange(line, dhText) : null;
      // A line with no link has no ד"ה to re-find: its span is the parser's opening-words
      // guess, so clamping it to the shortened line keeps it pointing at real words.
      remapped[lineIdx1] = rederived ?? clampHighlight(highlight, line);
    }
    dhHighlights = remapped;
  }

  return { ...session, commentaryLines, sourceLines, rashiLines, tosafotLines, links, dhHighlights };
}
