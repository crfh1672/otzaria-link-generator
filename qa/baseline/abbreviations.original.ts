import { DEFAULT_REPLACEMENTS } from '../../src/data/replacements';

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
export function cleanAbbrKey(key: string): string {
  return key
    .replace(/[\u0591-\u05C7]/g, '') // remove nikud/teamim
    .replace(/[״"׳’‘´']/g, '')       // remove quotes
    .trim();
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

function getInitialLettersFromAbbr(abbr: string): string[] {
  return cleanAbbrKey(abbr)
    .replace(/\s+/g, '')
    .split('')
    .filter(Boolean);
}

function findPhraseByInitials(targetText: string, initials: string[]): string | null {
  if (initials.length === 0) return null;

  const normalizedWords = targetText
    .replace(/[.,:;?!()\[\]"'׳״’‘´]/g, ' ')
    .split(/\s+/)
    .map(word => cleanAbbrKey(word))
    .filter(Boolean);

  for (let i = 0; i + initials.length <= normalizedWords.length; i++) {
    const slice = normalizedWords.slice(i, i + initials.length);
    let matches = true;
    for (let j = 0; j < initials.length; j++) {
      if (!slice[j].startsWith(initials[j])) {
        matches = false;
        break;
      }
    }
    if (matches) {
      return normalizedWords.slice(i, i + initials.length).join(' ');
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
  customReplacements?: Record<string, string[]>
): string {
  if (!sourceText || !sourceText.trim() || !targetContext || !targetContext.trim()) {
    return sourceText;
  }

  const dict = customDict || DEFAULT_ABBREVIATIONS;
  const targetNorm = targetContext.replace(/[\u0591-\u05C7]/g, '');

  // Split sourceText into words/tokens
  const words = sourceText.split(/(\s+)/);

  const nonWsIndices: number[] = [];
  for (let i = 0; i < words.length; i++) {
    if (words[i].trim() !== '') {
      nonWsIndices.push(i);
    }
  }

  for (let idx = 0; idx < nonWsIndices.length; idx++) {
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
      const rawNoSpace = rawJoined.replace(/\s+/g, '').replace(/[״"׳’‘´']/g, '');

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
          const optNorm = opt.replace(/[\u0591-\u05C7]/g, '');
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
      const abbreviationLetters = getInitialLettersFromAbbr(rawJoined);
      if (!options && abbreviationLetters.length > 1) {
        const initialsMatch = findPhraseByInitials(targetNorm, abbreviationLetters);
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
