import { DEFAULT_REPLACEMENTS } from './replacements';

/**
 * Default dictionary of Hebrew/Rabbinic Rashei Teivot (abbreviations) and their possible expansions.
 */
export const DEFAULT_ABBREVIATIONS: Record<string, string[]> = {
  "א\"א": [
    "אי אפשר",
    "אמר אברהם",
    "אריך אנפין",
    "אשת איש",
    "אשל אברהם",
    "אברהם אבינו",
    "אין אומרים",
    "אדוני אבי",
    "אשת אב",
    "אי אמרת",
    "אין אנו",
    "אשת אח",
    "אי אפשי",
    "אשת אביו",
    "אמן אמן",
    "אין אומר",
    "ארך אפים",
    "אגודת איזוב",
    "אומר אמרו",
    "איבעית אימא"
  ],
  "א\"ב": [
    "אין בו",
    "איכא בנייהו",
    "איסורי ביאה",
    "אין ברירה",
    "אין בטל",
    "אין בישול"
  ],
  "א\"ג": [
    "אין גובים",
    "אחר גט",
    "אכילה גסה",
    "איסור גברא",
    "אין גוזרין",
    "אינו גט",
    "ארבע גלויות"
  ],
  "א\"ד": [
    "או דילמא",
    "או דלמא",
    "אינו דוחה",
    "אינו דומה",
    "אלו דברים",
    "איסור דאורייתא",
    "איכא דאמרי",
    "אינו דין",
    "אהל דוד"
  ],
  "א\"ה": [
    "אב הטומאה",
    "אי הכי",
    "אומות העולם",
    "אין הולכין",
    "אין הולכים",
    "אמר הכותב",
    "אבן העזר",
    "איסור הנאה"
  ],
  "א\"ו": [
    "אלא ודאי",
    "איסור והיתר",
    "אדם וחוה",
    "אביו ואמו",
    "אמת ויציב"
  ],
  "א\"וא": [
    "אב ואם",
    "אחד ואחד"
  ],
  "א\"וה": [
    "איסור והיתר"
  ],
  "א\"ז": [
    "אור זרוע",
    "אליה זוטא",
    "אין זה",
    "אין זו",
    "את זה",
    "אין זיקה",
    "אבי זקני",
    "אין זקוק",
    "אינו זבוח",
    "אהל זרוק",
    "איסור זה",
    "אדרא זוטא"
  ],
  "א\"ח": [
    "אורח חיים",
    "אינו חייב",
    "אורחות חיים",
    "אשת חבירו",
    "אינו חוזר",
    "אור חדש",
    "אין חוששין",
    "אנשי חצר",
    "אמרו חכמים",
    "אור חוזר",
    "אשת חיל"
  ],
  "א\"ט": [
    "אלו טריפות",
    "איסור טומאה",
    "אין טעונין",
    "אין טעון",
    "אמרות טהורות",
    "אבנים טובות",
    "אגלי טל"
  ],
  "א\"י": [
    "ארץ ישראל",
    "אינו יהודי",
    "אינו יכול",
    "אינו יוצא",
    "איני יודע",
    "אינם יכולים",
    "אינם יהודים",
    "אינו יודע",
    "אינן יכולות",
    "את ישראל",
    "אינה יכולה",
    "אשר יצר",
    "אינם יוצאים",
    "איני יכול",
    "אלהיך ישראל",
    "אין ידוע",
    "אינם יודעים",
    "אינה יוצאה",
    "אינו ידוע",
    "אינו יורש"
  ],
  "א\"יה": [
    "אם ירצה השם"
  ],
  "א\"כ": [
    "אם כן",
    "אשת כהן",
    "ארבע כנפות",
    "איסור כולל"
  ],
  "א\"כֵּז": [
    "א\"כז"
  ],
  "א\"ל": [
    "אמר ליה",
    "אמר לו",
    "אמר להם",
    "אם לא",
    "אין לומר",
    "אמרו לו",
    "אין להקשות",
    "אמר להו",
    "אומר לו",
    "אין לו",
    "אמר לה",
    "אומרים לו",
    "או לא",
    "אפשר לומר",
    "אמרו ליה",
    "אין לה",
    "אומר להם",
    "אמרי ליה",
    "אמר לי"
  ],
  "א\"מ": [
    "אבינו מלכנו",
    "אין מוציאין",
    "אין מעמידין",
    "איסורי מזבח",
    "אין מערבין",
    "אין מבטלים",
    "אבני מילואים",
    "איסור מוסיף",
    "אין מעבירין",
    "אינו מוחל",
    "אלו מגלחין",
    "אין מעכב",
    "אהל מועד",
    "אבני מלואים",
    "אין מצטרפים",
    "אין מצווין",
    "אינו מברך",
    "אינו מינו",
    "אלו מציאות",
    "אמר מר"
  ],
  "א\"נ": [
    "אי נמי",
    "אינו נאמן",
    "אי נימא",
    "איני ניזונת",
    "אוכל נפש",
    "אינה נאמנת",
    "איזהו נשך",
    "אינו נוהג",
    "איני ניזונית",
    "אינו ניטל",
    "אפילו נימא",
    "אינו נראה"
  ],
  "א\"ס": [
    "אמן סלה",
    "אין סוף",
    "אגב סודר",
    "אנן סהדי",
    "אין סומכין"
  ],
  "א\"ע": [
    "אינו עובר",
    "את עצמו",
    "אמה עבריה",
    "אין עומדין",
    "את עצמם",
    "אבן עזרא",
    "אינו עולה",
    "אחר עיון",
    "אור עליון"
  ],
  "א\"פ": [
    "אכילת פרס",
    "אמרינן פרק",
    "אל פה",
    "אם פרעתיך",
    "אדם פורע",
    "או פסול",
    "אין פודין",
    "אל פרעה",
    "אלף פעמים",
    "אל פנים",
    "אינו פדוי",
    "אחר פטירתו",
    "את פסחו",
    "אין פותחין",
    "אל פתח",
    "אלא פשוט",
    "איכא פסידא",
    "אור פנימי",
    "אין פוסקין",
    "אינה פוסלת"
  ],
  "א\"צ": [
    "אין צריך"
  ],
  "א\"ק": [
    "אמר קרא",
    "אינן קונות",
    "אדם קדמון",
    "אין קץ"
  ],
  "א\"ר": [
    "אמר רבי",
    "אמר רב",
    "אליה רבה",
    "אינו ראוי",
    "אמר ר'",
    "אינה ראויה",
    "אמר רחמנא",
    "אין ראיה",
    "אינו רוצה",
    "אינם ראויים",
    "אמר רבא",
    "אין רצוני",
    "איני רוצה",
    "אינה ראיה",
    "אמר רבה",
    "אליהו רבה",
    "אבק ריבית",
    "אבל רבתי",
    "את רובו"
  ],
  "ע\"ז": [
    "עבודה זרה",
    "על זה",
    "עם זה"
  ],
  "ע\"ש": [
    "עיין שם"
  ],
  "ז\"ל": [
    "זכרונו לברכה",
    "זכרונם לברכה"
  ],
  "ע\"י": [
    "על ידי"
  ],
  "ע\"פ": [
    "על פי"
  ],
  "ע\"ב": [
    "עמוד ב"
  ],
  "ע\"א": [
    "עמוד א"
  ],
  "ת\"ר": [
    "תנו רבנן"
  ],
  "ת\"ש": [
    "תא שמע"
  ],
  "קמ\"ל": [
    "קמשמע לן",
    "קמא משמע לן"
  ],
  "ה\"ק": [
    "הכי קאמר"
  ],
  "ה\"מ": [
    "הני מילי"
  ],
  "ה\"נ": [
    "הכא נמי",
    "הכי נמי"
  ],
  "מ\"ש": [
    "מאי שנא"
  ],
  "אא\"כ": [
    "אלא אם כן"
  ],
  "אעפ\"כ": [
    "אף על פי כן"
  ],
  "ואעפ\"כ": [
    "ואף על פי כן"
  ],
  "אעפ\"י": [
    "אף על פי"
  ],
  "משא\"כ": [
    "מה שאין כן"
  ],
  "וכיוצ\"ב": [
    "וכיוצא בו"
  ],
  "ב\"ה": [
    "בית הלל",
    "ברוך השם"
  ],
  "ב\"ש": [
    "בית שמאי"
  ],
  "ר\"נ": [
    "רב נחמן"
  ],
  "ר\"ה": [
    "ראש השנה"
  ],
  "יו\"ט": [
    "יום טוב"
  ],
  "שנא'": [
    "שנאמר"
  ],
  "ואמרי'": [
    "ואמרינן"
  ],
  "תנא'": [
    "תנא"
  ],
  "רשב\"י'": [
    "רבי שמעון בן יוחי",
    "ר\"ש בן יוחי"
  ]
};

/**
 * Normalizes abbreviation string key for resilient lookup (removing quotes, cantillation, etc.)
 */
/**
 * Perf: cleanAbbrKey is pure and ranges over a tiny vocabulary (the words of the two
 * documents being matched), yet the search loop calls it on the order of 10^8 times per
 * book — a real "פני יהושע על ברכות" run measured 506M calls, each allocating two
 * intermediate strings through regex replace. Memoising turns nearly all of them into a
 * map hit. The cache is bounded: past the cap we simply stop inserting (still correct,
 * just uncached), so a pathological input cannot grow it without limit.
 */
const CLEAN_KEY_CACHE_LIMIT = 250000;
const cleanKeyCache = new Map<string, string>();

/**
 * Nikud/teamim stripping, memoised for the same reason as cleanAbbrKey: it is applied to
 * the target context on every expansion call and to every candidate expansion option of
 * every matched abbreviation, over a small set of recurring strings.
 *
 * Unlike the word-keyed cache above, keys here can be whole document lines (a few KB each),
 * so this one is capped on entry count and cleared wholesale on overflow rather than being
 * allowed to grow to a large multiple of the corpus. A scan reuses the same handful of
 * contexts thousands of times in a row, so a small working set captures essentially all of
 * the benefit at a bounded memory cost.
 */
const STRIP_NIKUD_CACHE_LIMIT = 16384;
const stripNikudCache = new Map<string, string>();

function stripNikud(text: string): string {
  const hit = stripNikudCache.get(text);
  if (hit !== undefined) return hit;
  const out = text.replace(/[\u0591-\u05C7]/g, '');
  if (stripNikudCache.size >= STRIP_NIKUD_CACHE_LIMIT) stripNikudCache.clear();
  stripNikudCache.set(text, out);
  return out;
}

/**
 * Every glyph a text may use for a geresh / gershayim / quotation mark.
 *
 * The abbreviation engine has to treat all of them alike, because an abbreviation is keyed on
 * its letters alone: רש"י, רש״י and “רש"י” are one entry. Two of the four call sites in
 * parserAlgorithm.ts hand this module RAW commentary or document text that never passed
 * through `normalizeHebrewQuotes`, so the typographic forms (U+2018–U+201F, U+2032–U+2033)
 * do reach here — and an unlisted glyph does not merely survive, it becomes part of the
 * lookup key (`“רשי`) or the leading letter of a target word (`“כשבתך`), silently defeating
 * both the dictionary lookup and the initials search. Enumerating them is what makes
 * expansion independent of whichever typographic convention a given book happens to use.
 *
 * Widening this set can only ever expose MORE abbreviations, never fewer: the characters are
 * removed before the key is compared, so every key that resolved before still resolves.
 */
const QUOTE_GLYPHS = '\'"׳״‘’‚‛“”„‟′″´`';
const QUOTE_STRIP_RE = new RegExp(`[${QUOTE_GLYPHS}]`, 'g');
/**
 * Same glyph set, non-global so it can be used as a stateless `.test()` — a global regex
 * carries `lastIndex` between calls and would answer differently on identical input.
 * Used to tell a written abbreviation from an ordinary word (see BUG-07 below).
 */
const QUOTE_GLYPHS_TEST_RE = new RegExp(`[${QUOTE_GLYPHS}]`);

export function cleanAbbrKey(key: string): string {
  const hit = cleanKeyCache.get(key);
  if (hit !== undefined) return hit;
  const out = key
    .replace(/[\u0591-\u05C7]/g, '') // remove nikud/teamim
    .replace(QUOTE_STRIP_RE, '')     // remove quotes/gershayim, in every glyph form
    .trim();
  if (cleanKeyCache.size < CLEAN_KEY_CACHE_LIMIT) cleanKeyCache.set(key, out);
  return out;
}

/**
 * Map indexed by normalized abbreviation keys (e.g. "אא" -> options)
 */
export const NORMALIZED_ABBREVIATIONS_MAP: Record<string, string[]> = {};

// Populate map with abbreviations
Object.entries(DEFAULT_ABBREVIATIONS).forEach(([rawKey, options]) => {
  const cleanedKey = cleanAbbrKey(rawKey);
  if (!NORMALIZED_ABBREVIATIONS_MAP[cleanedKey]) {
    NORMALIZED_ABBREVIATIONS_MAP[cleanedKey] = options;
  } else {
    // Merge options without duplicates
    const combined = new Set([...NORMALIZED_ABBREVIATIONS_MAP[cleanedKey], ...options]);
    NORMALIZED_ABBREVIATIONS_MAP[cleanedKey] = Array.from(combined);
  }

  // Also store exact raw key if different
  if (rawKey !== cleanedKey) {
    NORMALIZED_ABBREVIATIONS_MAP[rawKey] = options;
  }
});

// Populate map with replacements
Object.entries(DEFAULT_REPLACEMENTS).forEach(([rawKey, options]) => {
  const cleanedKey = cleanAbbrKey(rawKey);
  if (!NORMALIZED_ABBREVIATIONS_MAP[cleanedKey]) {
    NORMALIZED_ABBREVIATIONS_MAP[cleanedKey] = options;
  } else {
    // Merge options without duplicates
    const combined = new Set([...NORMALIZED_ABBREVIATIONS_MAP[cleanedKey], ...options]);
    NORMALIZED_ABBREVIATIONS_MAP[cleanedKey] = Array.from(combined);
  }

  // Also store exact raw key if different
  if (rawKey !== cleanedKey) {
    NORMALIZED_ABBREVIATIONS_MAP[rawKey] = options;
  }
});

/**
 * Perf: pure, and called once per candidate n-gram of every scanned line. The returned
 * array is read-only for all callers, so it is safe to hand out the same instance.
 */
const INITIALS_CACHE_LIMIT = 250000;
const initialsCache = new Map<string, string[]>();

function getInitialLettersFromAbbr(abbr: string): string[] {
  const hit = initialsCache.get(abbr);
  if (hit !== undefined) return hit;
  const out = cleanAbbrKey(abbr)
    .replace(/\s+/g, '')
    .split('')
    .filter(Boolean);
  if (initialsCache.size < INITIALS_CACHE_LIMIT) initialsCache.set(abbr, out);
  return out;
}

/**
 * Tokenised view of a target context, plus a string holding the first character of each
 * word at the matching index. Built once per distinct context and reused: the search loop
 * asks the same context about thousands of different abbreviations, and re-splitting and
 * re-cleaning it every time was the single most expensive thing the parser did (446M word
 * normalisations for ~7.5k distinct contexts on a real run).
 */
interface TargetIndex {
  words: string[];
  /** firstChars[i] === words[i].charAt(0) — every word is non-empty by construction. */
  firstChars: string;
}

/**
 * Punctuation that separates words in a target context. Shares {@link QUOTE_GLYPHS} with
 * `cleanAbbrKey` so that a quote is a word boundary here for exactly the same set of glyphs
 * it is erased from a key there — otherwise `“כשבתך` would index under the leading `“` and
 * never be reachable by an initials search for כ.
 */
const TARGET_SPLIT_RE = new RegExp(`[.,:;?!()\\[\\]${QUOTE_GLYPHS}]`, 'g');

/** Contexts are whole document lines; a few thousand is far more than one search needs. */
const TARGET_INDEX_LIMIT = 4096;
const targetIndexCache = new Map<string, TargetIndex>();

function getTargetIndex(targetText: string): TargetIndex {
  const hit = targetIndexCache.get(targetText);
  if (hit !== undefined) return hit;

  const words = targetText
    .replace(TARGET_SPLIT_RE, ' ')
    .split(/\s+/)
    .map(word => cleanAbbrKey(word))
    .filter(Boolean);

  let firstChars = '';
  for (let i = 0; i < words.length; i++) firstChars += words[i].charAt(0);

  const entry: TargetIndex = { words, firstChars };
  // Plain size cap rather than an LRU: a run scans one document at a time, so a clear on
  // overflow costs at most one rebuild per context instead of tracking recency.
  if (targetIndexCache.size >= TARGET_INDEX_LIMIT) targetIndexCache.clear();
  targetIndexCache.set(targetText, entry);
  return entry;
}

function findPhraseByInitials(targetText: string, initials: string[]): string | null {
  const len = initials.length;
  if (len === 0) return null;

  const { words, firstChars } = getTargetIndex(targetText);
  if (len > words.length) return null;

  // Every entry of `initials` is a single character (getInitialLettersFromAbbr splits a
  // cleaned key with .split('')), and every indexed word is non-empty. So
  //   words[i + j].startsWith(initials[j])   ⟺   firstChars[i + j] === initials[j]
  // and locating a run of consecutive matching words is exactly a substring search over
  // firstChars — one native call, no per-position slice allocation. indexOf returns the
  // lowest match, which is the same window the original left-to-right scan returned.
  // Should a caller ever pass a multi-character initial, fall back to the general scan.
  let simple = true;
  for (let j = 0; j < len; j++) {
    if (initials[j].length !== 1) { simple = false; break; }
  }

  if (simple) {
    const i = firstChars.indexOf(len === 1 ? initials[0] : initials.join(''));
    return i === -1 ? null : words.slice(i, i + len).join(' ');
  }

  for (let i = 0; i + len <= words.length; i++) {
    let matches = true;
    for (let j = 0; j < len; j++) {
      if (!words[i + j].startsWith(initials[j])) {
        matches = false;
        break;
      }
    }
    if (matches) {
      return words.slice(i, i + len).join(' ');
    }
  }

  return null;
}

/**
 * Searches for potential abbreviation expansions that match words in the target text.
 * Replaces abbreviations in `sourceText` with the matching option found in `targetContext`.
 */
export function expandAbbreviationsInText(
  sourceText: string,
  targetContext: string,
  customDict?: Record<string, string[]>,
  customReplacements?: Record<string, string[]>,
  /**
   * Optional ceiling on how many leading tokens of `sourceText` are considered for
   * expansion. Tokens past it are copied through untouched.
   *
   * Callers that only ever read a bounded prefix of the result pass this to avoid
   * rewriting a whole paragraph to use its first dozen words. Expansion is strictly
   * left-to-right and only ever rewrites at or after the token it matched, so skipping
   * later tokens cannot change earlier output. See the derivation at the call sites in
   * parserAlgorithm.ts for how a limit is chosen from the prefix width actually read.
   */
  maxTokens?: number
): string {
  if (!sourceText || !sourceText.trim() || !targetContext || !targetContext.trim()) {
    return sourceText;
  }

  const dict = customDict || DEFAULT_ABBREVIATIONS;
  const targetNorm = stripNikud(targetContext);

  // Split sourceText into words/tokens
  const words = sourceText.split(/(\s+)/);

  const nonWsIndices: number[] = [];
  for (let i = 0; i < words.length; i++) {
    if (words[i].trim() !== '') {
      nonWsIndices.push(i);
    }
  }

  // An n-gram that starts inside the window may still reach one or two tokens past it;
  // that is deliberate, so the window boundary never splits a bigram or trigram.
  const tokenLimit = maxTokens === undefined
    ? nonWsIndices.length
    : Math.min(maxTokens, nonWsIndices.length);

  for (let idx = 0; idx < tokenLimit; idx++) {
    // Try Trigram (3), then Bigram (2), then Single (1)
    for (let len = 3; len >= 1; len--) {
      const endIdx = idx + len - 1;
      if (endIdx >= nonWsIndices.length) continue;

      const iStart = nonWsIndices[idx];
      const iEnd = nonWsIndices[endIdx];
      const sliceWords = words.slice(iStart, iEnd + 1);
      const rawJoined = sliceWords.join('');
      const cleanedJoined = cleanAbbrKey(rawJoined);
      const noSpaceJoined = cleanedJoined.replace(/\s+/g, '');
      const spaceJoined = sliceWords.map(w => cleanAbbrKey(w)).join(' ');
      const rawNoSpace = rawJoined.replace(/\s+/g, '').replace(QUOTE_STRIP_RE, '');

      const lookupKeys = [
        rawJoined,
        cleanedJoined,
        noSpaceJoined,
        spaceJoined,
        rawNoSpace
      ];

      let options: string[] | undefined;
      for (const k of lookupKeys) {
        if (!k) continue;
        options = dict[k] || (customReplacements && customReplacements[k]) || NORMALIZED_ABBREVIATIONS_MAP[k];
        if (options && options.length > 0) break;
      }

      if (options && options.length > 0) {
        let matchedOption: string | null = null;
        for (const opt of options) {
          const optNorm = stripNikud(opt);
          if (targetNorm.includes(optNorm)) {
            matchedOption = opt;
            break;
          }
        }

        if (matchedOption) {
          words[iStart] = matchedOption;
          for (let k = iStart + 1; k <= iEnd; k++) {
            words[k] = '';
          }
          idx = endIdx; // advance past consumed tokens
          break;
        }
      }

      // Fallback: if no dictionary expansion exists, try matching by initials.
      // Guarded on `!options` first: when a dictionary entry already won, these letters
      // were computed and thrown away on every single token.
      if (!options) {
        // BUG-07: only a token actually WRITTEN as an abbreviation may be re-read as one.
        //
        // The fallback below takes a token's letters as initials, looks for that many
        // consecutive words in the CANDIDATE LINE starting with them, and rewrites the quote
        // to contain the words it found there. Guarded only on "has at least 2 letters", that
        // admits essentially every Hebrew word. "ליה" — Aramaic for "to him", among the most
        // common words in the Talmud — becomes ל־י־ה, matches "לרבי יהודה הרהור" in גמרא 1029,
        // and the quote is rewritten to contain that phrase. The matcher then scores the
        // rewritten quote against the very line the words were taken from: the evidence is
        // manufactured out of the thing it is evidence about. On פני יהושע ברכות line 292 this
        // handed גמרא 1029 a score of 3.53 against 2.09 for גמרא 1048, the line actually cited.
        //
        // The effect scales with how many candidate lines get scanned, so it is a systematic
        // false-positive generator rather than an occasional slip.
        //
        // Real abbreviations carry a geresh or gershayim (ר"ה, ק"ש, תוס'), in any of the glyph
        // variants QUOTE_GLYPHS lists — ASCII, Hebrew ׳/״, curly, doubled ''. A token carrying
        // none of them is a word, not an acronym. Dictionary entries are unaffected: they are
        // resolved above and never reach this branch, so a dictionary key without a quote mark
        // still expands normally.
        const writtenAsAbbreviation = QUOTE_GLYPHS_TEST_RE.test(rawJoined);
        const abbreviationLetters = writtenAsAbbreviation ? getInitialLettersFromAbbr(rawJoined) : [];
        const initialsMatch = abbreviationLetters.length > 1
          ? findPhraseByInitials(targetNorm, abbreviationLetters)
          : null;
        if (initialsMatch) {
          words[iStart] = initialsMatch;
          for (let k = iStart + 1; k <= iEnd; k++) {
            words[k] = '';
          }
          idx = endIdx; // advance past consumed tokens
          break;
        }
      }
    }
  }

  return words.join('');
}
