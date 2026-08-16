/**
 * ── שולחן ערוך: פרופיל המקור ההלכתי ─────────────────────────────────────────────────────────
 *
 * מנוע ההתאמה עצמו (searchLineInDoc, סולם הגמישות, מנוע ה-confidence) זהה בכל הקטגוריות ואינו
 * מוכפל כאן. מה שבאמת שונה בספרי הלכה הוא **מדיניות של שורות** — מי בכלל נכנס לחיפוש, מי יורש
 * הקשר, וכמה קבועים מספריים. כל הידע הזה יושב במודול הזה, ו-parserAlgorithm קורא לו דרך
 * `SourceProfile` יחיד שנבחר פעם אחת בראש הריצה. המודול הזה אינו מייבא דבר מ-parserAlgorithm,
 * כדי שלא ייווצר מעגל ייבוא.
 *
 * ── שלושה מבנים, לא אחד ────────────────────────────────────────────────────────────────────
 * נושאי הכלים על שו"ע אינם כתובים כולם באותו מבנה, והמשתמש הוא שיודע באיזה מבנה הספר שלפניו
 * כתוב. שתי שאלות באפיון קובעות את המבנה (`HalachaPieceMode`):
 *
 *   'single-line'  קטע פירוש = שורה אחת. כל שורה נכנסת לחיפוש ועומדת בפני עצמה; שורה שלא
 *                  נמצאה נשארת בלי קישור. אין ס"ק ואין ירושת הקשר כלל.
 *   'multi-line'   קטע פירוש נפרס על כמה שורות, אך אין מספור ס"ק לזהות בו גבולות. לכן כל שורה
 *                  נכנסת לחיפוש (כמו בש"ס), ושורה שלא נמצאה יורשת את ההקשר של השורה שמעליה.
 *   'seif-katan'   הספר מחולק לס"ק ממוספרים. רק הקטע הראשון בכל ס"ק נכנס לחיפוש; כל השאר הוא
 *                  המשך הדיון של אותו ס"ק ויורש את ההקשר שלו בלי לחפש כלל:
 *
 *                     פותח ס"ק      → חיפוש. נמצא ⇒ קישור משלו. לא נמצא ⇒ אין קישור, ואין ירושה.
 *                     שורת המשך     → בלי חיפוש כלל. יורשת את ההקשר של הס"ק שמעליה.
 *
 *                  כישלון של פותח ס"ק אינו מנתק את השרשרת: previousLink נשאר על הקישור המוצלח
 *                  האחרון, כך שההמשכים שאחריו עדיין יורשים אותו במקום להישאר יתומים.
 *
 * ── סימן הס"ק כשורה נפרדת ──────────────────────────────────────────────────────────────────
 * בחלק מהספרים אסימון המספור אינו יושב בראש הקטע אלא לבדו בשורה משלו — כשורת כותרת
 * (`<h4>(א)</h4>`) או כשורה שאין בה דבר מלבדו. שורה כזאת אינה טקסט שאפשר לחפש אותו, ולכן היא
 * פותחת את הס"ק אך **החיפוש נעשה בשורה שאחריה** (`isSeifKatanMarkerLine`), והקישור נרשם על
 * אותה שורה שאחריה — היא זו שנושאת את הציטוט מלשון השו"ע.
 */

/**
 * אותיות שיכולות להרכיב אסימון מספור: א, טו, ט"ו, קט"ז — עד שלוש אותיות, עם גרש/גרשיים אופציונלי
 * באמצע. הטווח כתוב בקודי יוניקוד כדי שלא יישבר בעריכת קובץ עם כיווניות מעורבת.
 */
const NUM_LETTERS = `[\\u05D0-\\u05EA]{1,3}(?:["'\\u05F3\\u05F4][\\u05D0-\\u05EA]{1,2})?`;

/**
 * מה שמותר להופיע לפני המספור: רווחים, תגיות HTML (כולל <h3>, <b>), וסימני כותרת של Markdown.
 * נשמר בקבוצה 1 כדי ש-`stripHalachaNumbering` יוכל להחזיר את השורה עם העטיפה שלה במקומה.
 */
const LEAD_MARKUP = `((?:\\s|#{1,6}\\s|<[^>]*>)*)`;

/**
 * צורות המספור המוכרות. שתי משפחות:
 *   • סוגריים מלאים — (א) [א] {ט"ו}
 *   • סוגר סוגר בלבד או נקודה — א)  א]  א.
 * צורת הגרש הבודד (א') מודרת בכוונה: "ר' יוחנן", "ב' דברים" ודומיהם פותחים שורות בספרים האלה
 * ואינם מספור, והמחיר של זיהוי שגוי כאן הוא שורה שנכנסת לחיפוש במקום לרשת.
 */
const HALACHA_NUMBERING_RE = new RegExp(
  `^${LEAD_MARKUP}(?:[(\\[{]\\s*(${NUM_LETTERS})\\s*[)\\]}]|(${NUM_LETTERS})\\s*[)\\]}.])\\s*`
);

const GEMATRIA_VALUES: Record<string, number> = {
  'א': 1, 'ב': 2, 'ג': 3, 'ד': 4, 'ה': 5, 'ו': 6, 'ז': 7, 'ח': 8, 'ט': 9,
  'י': 10, 'כ': 20, 'ל': 30, 'מ': 40, 'נ': 50, 'ס': 60, 'ע': 70, 'פ': 80, 'צ': 90,
  'ק': 100, 'ר': 200, 'ש': 300, 'ת': 400
};

/**
 * האם רצף האותיות הוא ייצוג מספרי תקין — ערכי האותיות יורדים ממש משמאל לימין (ת ש ק, אחר כך
 * העשרות, ואז היחידות). זה בדיוק מה שמפריד "(ט"ו)" מ-"כלל." או "פרק." — צירוף מילה אמיתית
 * כמעט תמיד עולה באיזשהו שלב. בלי המבחן הזה הצורה הלא-מסוגרת ("א.") הייתה תופסת כל מילה בת
 * שתיים-שלוש אותיות שאחריה נקודה.
 */
function isCanonicalNumberLetters(letters: string): boolean {
  const clean = letters.replace(/["'׳״]/g, '');
  if (!clean) return false;
  let prev = Infinity;
  for (const ch of clean) {
    const v = GEMATRIA_VALUES[ch];
    if (v === undefined || v >= prev) return false;
    prev = v;
  }
  return true;
}

/** אסימון המספור שבראש השורה, אם יש — כולל אורך הקידומת שיש להסיר יחד איתו. */
export function matchHalachaNumbering(
  rawLine: string
): { marker: string; lead: string; matchLength: number } | null {
  if (!rawLine) return null;
  const m = HALACHA_NUMBERING_RE.exec(rawLine);
  if (!m) return null;
  const letters = m[2] ?? m[3] ?? '';
  if (!isCanonicalNumberLetters(letters)) return null;
  return { marker: letters, lead: m[1] ?? '', matchLength: m[0].length };
}

/** האם השורה נושאת מספור באותיות — התנאי היחיד שמכניס שורה לחיפוש בקטגוריית הלכה. */
export function hasHalachaNumbering(rawLine: string): boolean {
  return matchHalachaNumbering(rawLine) !== null;
}

/**
 * כותרת שכל תוכנה הוא אסימון מספור **חשוף** — אות אחת עד שלוש, בלי סוגר, בלי נקודה ובלי גרש.
 *
 * `HALACHA_NUMBERING_RE` מדיר את הצורה החשופה בכוונה, כי בשורת תוכן היא חסרת הכרעה: "א טקסט"
 * יכול להיות כל דבר, ולכן בלי סוגר או נקודה אין דרך לדעת שמדובר במספור. **בכותרת שאין בה
 * דבר מלבד האותיות אין את הספק הזה כלל** — אין טקסט שאפשר לבלבל איתו, והמבחן הערכי
 * (`isCanonicalNumberLetters`) עדיין דורש רצף גימטרייה תקין. זו הצורה שבה חלק מנושאי הכלים
 * מסמנים את חלוקת הקטעים שלהם, ובלעדיה כל אחת מן הכותרות האלה הופכת לגבול-סגמנט שלעולם לא
 * תימצא לו מקבילה במקור.
 *
 * הצמצום לכותרות בלבד הוא מה שמונע את הרגרסיה שההדרה המקורית באה למנוע.
 */
export function isBareMarkerHeader(rawLine: string): boolean {
  if (!looksLikeHeader(rawLine)) return false;
  const inner = rawLine.replace(/<[^>]*>/g, ' ').replace(/^#{1,6}\s+/, '').trim();
  if (!/^[א-ת]{1,3}(?:["'׳״][א-ת]{1,2})?$/.test(inner)) return false;
  return isCanonicalNumberLetters(inner);
}

/**
 * השורה בלי אסימון המספור, כשעטיפת ה-HTML/Markdown שלה נשארת במקומה — כך ש-stripHtmlTags,
 * stripSecondaryPrefix ו-extractDiburHamatchil שבהמשך הצינור רואים בדיוק את מה שהיו רואים
 * לו השורה נכתבה מלכתחילה בלי המספור.
 */
export function stripHalachaNumbering(rawLine: string): string {
  const m = matchHalachaNumbering(rawLine);
  if (!m) return rawLine;
  return m.lead + rawLine.slice(m.matchLength);
}

/**
 * מילת ההפניה להגהת הרמ"א, אחרי ניקוי גרשיים ופיסוק: `הגה`, `הגהה`, ועם אותיות השימוש
 * שנפוצות לפניה (`בהג"ה`, `ובהגה"ה`, `שבהגה`).
 */
const GLOSS_REFERENCE_WORD = /^[ובשכל]{0,2}הגהה?$/;

/**
 * מילת ההפניה שבראש השורה, אם יש — באותו מבנה שמחזיר `matchHalachaNumbering`.
 *
 * הרמ"א כתוב בתוך לשון השו"ע כהגהה, ונושא הכלים מפנה אליו במילה אחת בראש הקטע: "בהג"ה" ואחריה
 * הציטוט. המילה הזאת היא **מצביע ולא ציטוט** — היא אינה מופיעה בלשון המקור, ולכן כשהיא נספרת
 * כמילה הראשונה של הד"ה היא מרעילה את ההתאמה פעמיים: היא עצמה אינה נמצאת בשורת היעד, והיא
 * דוחקת את המילה שכן נמצאת שם אל מעבר ל-`maxDhStartIdx`.
 *
 * החיתוך מותנה בכך שנשאר טקסט אחריה: שורה שכולה "בהג"ה" אינה קטע שאפשר לחפש בו, והיא נשארת
 * כפי שהיא כדי ש-`isLinkableContentLine` יוסיף לראות אותה כשורה ריקה מציטוט.
 */
export function matchGlossReference(rawLine: string): { lead: string; matchLength: number } | null {
  if (!rawLine) return null;
  const m = new RegExp(`^${LEAD_MARKUP}(\\S+)\\s+(?=\\S)`).exec(rawLine);
  if (!m) return null;
  const bare = (m[2] ?? '').replace(/["'׳״.,:;־–-]/g, '');
  if (!GLOSS_REFERENCE_WORD.test(bare)) return null;
  return { lead: m[1] ?? '', matchLength: m[0].length };
}

/** השורה בלי מילת ההפניה להגהה, כשעטיפת ה-HTML נשארת במקומה — כמו stripHalachaNumbering. */
export function stripGlossReference(rawLine: string): string {
  const m = matchGlossReference(rawLine);
  if (!m) return rawLine;
  return m.lead + rawLine.slice(m.matchLength);
}

/**
 * השורה בלי כל מה שקודם לציטוט — אסימון המספור ומילת ההפניה להגהה — לפי הפרופיל. **זו נקודת
 * הכניסה היחידה**, כדי שספירת האסימונים שנחתכו (`dhWordOffset` ב-parserAlgorithm) תישאר נכונה
 * ולא תיפול על מצב שבו רק חלק מהחיתוכים נעשה.
 */
export function stripHalachaLeadIn(rawLine: string, profile: SourceProfile): string {
  let out = profile.stripsNumbering ? stripHalachaNumbering(rawLine) : rawLine;
  if (profile.stripsGlossReference) out = stripGlossReference(out);
  return out;
}

/** צורת כותרת — אותו מבחן תחבירי בדיוק שעושה isHeaderLine, משוכפל כאן כדי להימנע ממעגל ייבוא. */
function looksLikeHeader(line: string): boolean {
  const trimmed = line.trim();
  return /<h[1-6][^>]*>.*<\/h[1-6]>/i.test(trimmed) || /^#{1,6}\s+/.test(trimmed);
}

/**
 * כותרת שמכילה את המילה "סימן" היא גבול-סגמנט אמיתי, וזה מה שמיישר בין הפירוש לשו"ע. שאר
 * הכותרות אינן חסינות: בספרים האלה נפוץ שכל ס"ק נפתח בשורת כותרת ממוספרת, ואם היא תיחשב
 * כותרת, כל התוכן שלה ייפול מחוץ לסגמנט שאליו הוא שייך.
 */
function containsSiman(line: string): boolean {
  return /סימן/.test(line.replace(/<[^>]*>/g, ' '));
}

/**
 * כותרת ממוספרת שאינה כותרת "סימן" — כלומר שורה שנראית ככותרת אך למעשה היא חלק מגוף הפירוש.
 * `isHeaderLine` בפרופיל הלכה מחזיר עליה false, כך שהיא נכנסת ללולאת השורות כמו כל שורה אחרת.
 *
 * חשוב שלא תיחשב כותרת גם בעיני `parseDocumentSegments`: כותרת יוצרת גבול-סגמנט, וכותרת בשם
 * "(א)" לעולם לא תמצא לה מקבילה בשו"ע — הסגמנט היה נותר בלי מקור, והחיפוש היה נסרק על הספר
 * כולו במקום על הסימן הנוכחי.
 */
export function isNumberedContentHeader(line: string): boolean {
  return looksLikeHeader(line) && !containsSiman(line) &&
    (hasHalachaNumbering(line) || isBareMarkerHeader(line));
}

/**
 * שורה שכל תוכנה הוא אסימון הס"ק — כותרת ממוספרת, או שורה שלא נשאר בה דבר אחרי חיתוך המספור.
 * שורה כזאת פותחת ס"ק אך אין בה מה לחפש, ולכן הפותח בפועל הוא שורת התוכן הבאה אחריה.
 *
 * כותרת ממוספרת נכללת גם כשיש בה טקסט ("<h4>(ג) ומה שכתב הרב</h4>"): בספרים שכותבים כך, שורת
 * הכותרת היא שם הס"ק והציטוט מלשון השו"ע פותח את השורה שאחריה.
 */
export function isSeifKatanMarkerLine(rawLine: string): boolean {
  // כותרת שכל תוכנה אות מספור חשופה — ראו isBareMarkerHeader.
  if (isBareMarkerHeader(rawLine)) return true;
  if (!hasHalachaNumbering(rawLine)) return false;
  if (looksLikeHeader(rawLine)) return true;
  return stripHalachaNumbering(rawLine).replace(/<[^>]*>/g, '').trim() === '';
}

/**
 * ── גבול הד"ה: סימני הפיסוק ─────────────────────────────────────────────────────────────────
 *
 * בספרי הלכה לד"ה יש סוף מודפס. המדפיס שם שם מקף ("ולא ישתה - ואפילו מים"), נקודה או
 * נקודתיים, ומה שבא אחריו הוא לשונו של הפרשן ולא ציטוט מלשון השו"ע. בש"ס אין גבול כזה — שם
 * הציטוט והמסה שזורים זה בזה בלי סימן — ולכן המנוע נבנה מלכתחילה שלא לחתוך בפיסוק, וההחלטה
 * ההיא נשארת בתוקפה שם (`DEFAULT_PROFILE.dhTerminatesAtPunctuation === false`).
 *
 * ארבע צורות המקף מכוסות. **המקף העברי (־, U+05BE) הוא המלכודת:** הוא מה שמופיע בפועל בהרבה
 * מהדורות, ובדיקה של המקף הלטיני בלבד הייתה מחמיצה אותו. מנגד, מקף בתוך מילה ("כל־האדם") הוא
 * מחבר ולא מפריד — ומכאן הדרישה לרווח לפחות מצדו האחד.
 *
 * **פסיק אינו סוגר ד"ה בכוונה:** הוא נפוץ בתוך לשון הפרשן, והחיתוך בו היה אגרסיבי מדי.
 */
const DH_DASHES = '\\u002D\\u05BE\\u2010-\\u2015';

/** מקף שיש רווח לפחות מצדו האחד, או רצף של נקודה/נקודתיים/נקודה-פסיק בסוף מילה. */
const DH_PUNCT_TERMINATOR_RE = new RegExp(
  `\\s[${DH_DASHES}]|[${DH_DASHES}]\\s|[.:;\\u05C3]+(?=\\s|$)`
);

/**
 * "כו'" בתוך הד"ה פירושו קיצור לשון השו"ע — הוא סוגר את הד"ה, ומה שלפניו הוא העוגן.
 * זו הסיבה שגישת מקטעי ההמשך (seg1/seg2/seg3 ב-parserAlgorithm) כבויה בספרי הלכה: היא נבנתה
 * לש"ס, שבו רק ניקוד רצפים מפריד בין הציטוט למסה. כאן הפיסוק כבר הפריד.
 * הגרש העברי (׳, U+05F3) נכלל לצד האפוסטרוף הלטיני.
 */
const DH_ELLIPSIS_TERMINATOR_RE = /(?:^|\s)(?:ו?כו['׳]|וגו['׳]|וגומר|וכולי)(?:\s|$|[.,:;])/;

/**
 * מיקום אסימון הסיום הראשון בשורה, או `null` אם אין.
 *
 * שני סייגים שמחזירים `null` ומחזירים את השורה להתנהגות הרגילה:
 *   • אסימון בראש השורה — ד"ה ריק אינו ד"ה;
 *   • שורה שאין בה אסימון כלל — בספרים שאינם מפסקים, וזה בסדר: השורה תרד בסולם המעברים
 *     עם אות חלשה יותר, בדיוק כפי שהיא עושה היום.
 */
export function findDhBoundary(cleanLine: string): number | null {
  if (!cleanLine) return null;

  let cut = -1;
  const punct = DH_PUNCT_TERMINATOR_RE.exec(cleanLine);
  if (punct) cut = punct.index;
  const ellipsis = DH_ELLIPSIS_TERMINATOR_RE.exec(cleanLine);
  if (ellipsis && (cut === -1 || ellipsis.index < cut)) cut = ellipsis.index;

  if (cut <= 0) return null;
  return cleanLine.slice(0, cut).trim() ? cut : null;
}

/**
 * הקבועים שהפרופיל מחליף במנוע. כל שדה כאן הוא ערך שהיה קבוע קשיח בקוד לפני שהקטגוריה
 * ההלכתית נוספה, וערך ברירת המחדל (`DEFAULT_PROFILE`) זהה לו בדיוק — כך שהתנהגות ש"ס ותנ"ך
 * אינה משתנה כהוא זה.
 */
export interface SourceProfile {
  kind: 'shas' | 'halacha';
  /** תקרת מילות הד"ה למקור הראשי. תוספות ממשיך לקבל 7 דרך קריאת האתר שלו. */
  maxDhWords: number;
  /** כמה מילים אחרי תחילת שורת הפירוש מותר להתאמה להתחיל (maxStartIdx ב-calcContiguousScore). */
  maxDhStartIdx: number;
  /** שער הנדירות של עוגן מילה בודדת — ראו SWDH_MAX_OPENING_RATIO. */
  swdhMaxOpeningRatio: number;
  /** רק פותחי ס"ק נכנסים לחיפוש; כל השאר יורשים. */
  numberingDrivesLinking: boolean;
  /** כותרת ממוספרת (שאינה "סימן") נחשבת חלק מגוף הפירוש ולא גבול-סגמנט. */
  numberedHeadersAreContent: boolean;
  /** יש מקורות משניים לניתוב (רש"י / תוספות). */
  hasSecondarySources: boolean;
  /** אסימון המספור נחתך מראש השורה לפני חילוץ הד"ה. */
  stripsNumbering: boolean;
  /** מילת ההפניה להגהת הרמ"א ("בהג"ה") נחתכת אף היא — ראו matchGlossReference. */
  stripsGlossReference: boolean;
  /** קטע פירוש עשוי להתפרס על כמה שורות, ולכן שורה יכולה לרשת הקשר משורה שמעליה. */
  allowsInheritance: boolean;
  /** אסימון פיסוק סוגר את הד"ה, בלי תלות בהגדרות המשתמש — ראו findDhBoundary. */
  dhTerminatesAtPunctuation: boolean;
  /** גישת מקטעי ההמשך של "כו'" (seg1/seg2/seg3). כבויה בספרי הלכה — ראו findDhBoundary. */
  usesContinuationSegments: boolean;
  /**
   * רצפה לרף הקבלה של `computeDynamicMinThreshold`, או `undefined` לחישוב הדינמי בלבד.
   *
   * קיים כדי להפריד בין שני ברגים שקל לבלבל ביניהם: **היכן נגמר הד"ה** ו**כמה נמוך הרף**.
   * חיתוך הד"ה בפיסוק הופך את השורה ל"מפורשת", וממילא הרף היה נגזר מן הד"ה הקצר במקום מן
   * הפסקה כולה — כלומר צונח מ-1.5 לכ-0.5. זו הרפיה אמיתית, והיא בטוחה רק בתוך חלון חיפוש
   * מצומצם. עד שהחלון קיים, הרצפה מקבעת את הרף על הערך האפקטיבי של היום.
   *
   * בהמשך זהו השדה שטבלת המעברים תדרוס בו `minScore` לכל מעבר בנפרד.
   * ראו docs/HALACHA_MULTIPASS_PLAN.md סעיף 3.
   */
  minAcceptScore?: number;
  /**
   * קטע פירוש שלא נמצא לו קישור, ושתי הקצוות שסביבו קושרו לאותה שורת מקור, מקבל את אותה
   * שורה — ראו fillGapsBetweenEqualAnchors ב-parserAlgorithm.
   */
  fillsGapsBetweenEqualAnchors: boolean;
  /** מבנה הקטעים שנבחר באפיון. רק לספרי הלכה; בש"ס/תנ"ך undefined. */
  pieceMode?: HalachaPieceMode;
}

/** ההתנהגות ההיסטורית — ש"ס ותנ"ך. כל ערך כאן הוא הקבוע שהיה כתוב בקוד. */
export const DEFAULT_PROFILE: SourceProfile = {
  kind: 'shas',
  maxDhWords: 12,
  maxDhStartIdx: 3,
  swdhMaxOpeningRatio: 0.008,
  numberingDrivesLinking: false,
  numberedHeadersAreContent: false,
  hasSecondarySources: true,
  stripsNumbering: false,
  stripsGlossReference: false,
  allowsInheritance: true,
  fillsGapsBetweenEqualAnchors: false,
  dhTerminatesAtPunctuation: false,
  usesContinuationSegments: true,
  minAcceptScore: undefined
};

/** מבנה הקטעים בספר ההלכה, כפי שהמשתמש מצהיר עליו באפיון. ראו ההסבר בראש הקובץ. */
export type HalachaPieceMode = 'single-line' | 'multi-line' | 'seif-katan';

/**
 * שולחן ערוך ונושאי כליו.
 *
 * `maxDhWords: 5` — הציטוט בספרים האלה קצר ומדויק (מילה או שתיים מלשון השו"ע), וחלון של 12
 * מילים גורר לתוך ההשוואה את דברי המחבר עצמו.
 * `maxDhStartIdx: 2` — הד"ה חייב להתחיל לכל היותר מילה אחת אחרי תחילת השורה (אחרי ניקוי
 * המספור), כי המספור הוא הסימן שמה שבא מיד אחריו הוא הלמה.
 * `swdhMaxOpeningRatio: 0.02` — עוגן מילה בודדת נדרש פחות; במבנה ס"ק הגידור כאן חזק ממילא,
 * שכן רק פותח ס"ק מגיע עד לשלב הזה.
 * `dhTerminatesAtPunctuation` / `usesContinuationSegments` / `minAcceptScore` — ראו הערת
 * "גבול הד"ה" למעלה, ו-docs/HALACHA_MULTIPASS_PLAN.md סעיף 3.
 *
 * שלושת השדות שהמבנה קובע — `numberingDrivesLinking`, `allowsInheritance` — הם כל ההבדל בין
 * שלושת המבנים; כל השאר משותף לכל ספרי ההלכה.
 */
export function halachaProfile(mode: HalachaPieceMode = 'seif-katan'): SourceProfile {
  return {
    kind: 'halacha',
    maxDhWords: 5,
    maxDhStartIdx: 2,
    swdhMaxOpeningRatio: 0.02,
    numberedHeadersAreContent: true,
    hasSecondarySources: false,
    stripsNumbering: true,
    stripsGlossReference: true,
    fillsGapsBetweenEqualAnchors: true,
    dhTerminatesAtPunctuation: true,
    usesContinuationSegments: false,
    minAcceptScore: 1.5,
    numberingDrivesLinking: mode === 'seif-katan',
    allowsInheritance: mode !== 'single-line',
    pieceMode: mode
  };
}

/** ברירת המחדל ההלכתית — ספר מחולק לס"ק, וקטעיו נפרסים על כמה שורות. */
export const HALACHA_PROFILE: SourceProfile = halachaProfile('seif-katan');

/**
 * ── מעבר חיפוש אחד ──────────────────────────────────────────────────────────────────────────
 *
 * כל שדה כאן הוא כוונון שהיה עד כה **קבוע קשיח** באמצע מנוע החיפוש. הרשומה הזאת אינה משנה
 * דבר בהתנהגות: `basePassSpec` מחזיר בדיוק את הערכים שהיו כתובים בקוד, והמנוע קורא מהם
 * במקום מהם. מה שהיא כן עושה היא להפוך את הכוונונים לנתון שאפשר להחליף — וזה מה שיאפשר
 * בהמשך להריץ את אותו מנוע כמה פעמים על הספר, מן הראיה החזקה אל החלשה, כשכל מעבר מרפה
 * מעט ומצטמצם לחלון שהמעבר שלפניו הותיר.
 *
 * הטבלה המלאה של המעברים: docs/HALACHA_MULTIPASS_PLAN.md סעיף 4.
 *
 * הרשומה יושבת כאן ולא ב-parserAlgorithm מאותה סיבה ש-`SourceProfile` יושב כאן: היא הצהרה
 * על כוונוני המנוע, לא חלק מן המנוע, והמודול הזה אינו מייבא דבר מ-parserAlgorithm.
 */
export interface PassSpec {
  /** שם קריא, לדוחות ולניפוי שגיאות. */
  name: string;
  /** היקף החיפוש: הסגמנט כולו, או החלון שבין שני השכנים המקושרים. */
  scope: 'segment' | 'window';
  /** רצפה לרף הקבלה, או `undefined` לחישוב הדינמי בלבד. */
  minScore?: number;
  /** תקרת הרף הדינמי — מעליה הרף שטוח ואינו גדל עם אורך הפסקה. */
  scoreCap: number;
  /** עד כמה עמוק בשורת המקור נחשב "רדוד": שם עוגן מתקבל בכל אורך רצף. */
  shallowAnchorLimit: number;
  /** אורך הרצף המינימלי לעוגן שיושב עמוק בשורת המקור. */
  deepAnchorMinRun: number;
  /** כמה מילים אחרי תחילת שורת הפירוש מותר להתאמה להתחיל. */
  maxStartIdx: number;
  /** התאמה מטושטשת (שורשים, כתיב חסר/מלא) או מילולית בלבד. */
  fuzzy: boolean;
  /**
   * מעבר התחזוקה M1 רץ **לפני** המעבר הזה: ניכוי עוגנים שסותרים זה את זה בסדר.
   *
   * הוא רץ לפני מעבר ולא אחריו במכוון — ניכוי עוגן משנה את ההקשר שהשורות שאחריו יורשות,
   * והמעבר שבא מיד אחריו הוא שבונה את הירושה מחדש. M1 בסוף הריצה היה מותיר קישורים מורשים
   * שמצביעים על עוגן שכבר נזרק.
   */
  prunesConflictsBefore?: boolean;
  /**
   * המעבר מטפל רק ביחידות שחלונן צר לפחות כמו זה — יחידה בחלון רחב יותר, או בחלון שאינו
   * חסום משני צדדיו, מדולגת.
   *
   * זהו הבורג שמאפשר לרדת לרפים שאין להם שום הצדקה על פני סימן שלם: מילת קישור בודדת אינה
   * ראיה בסימן בן עשרים סעיפים, והיא ראיה סבירה כשנשארו שתיים-שלוש שורות אפשריות. **החלון
   * הוא מה שמשלם על ההרפיה.**
   */
  maxWindowWidth?: number;
  /**
   * מה המעבר מריץ: `'score'` — מנוע ההתאמה הרגיל, שמנקד רצפים מול הרף; `'unique'` — נתיב
   * העוגן בלבד, שאינו שוקל משקלים אלא נשען על היקרות יחידה בתחום החיפוש.
   *
   * שני סוגי ראיה שונים בתכלית, ולכן מעבר שמריץ רק אחד מהם אינו מבזבז סריקה על השני.
   */
  mode: 'score' | 'unique';
  /**
   * אורך העוגן המרבי לנתיב הייחודיות. `0` = כבוי.
   *
   * הנתיב מנסה מן הארוך אל הקצר, כי יותר מילים הן גם יותר ראיה וגם סיכוי גדול יותר שהצירוף
   * ייחודי. `basePassSpec` מחזיר 1 — בדיוק ההתנהגות ההיסטורית של "עוגן המילה הראשונה".
   */
  uniqueAnchorMaxWords: number;
}

/**
 * המעבר היחיד שרץ היום — ערכיו הם בדיוק הקבועים שהיו כתובים בקוד לפני שהרשומה נוספה.
 * `shallowAnchorLimit` ו-`deepAnchorMinRun` היו `SHALLOW_ANCHOR_LIMIT` ו-`DEEP_ANCHOR_MIN_RUN`
 * ב-parserAlgorithm, ו-`scoreCap` היה ה-1.5 שבתוך `computeDynamicMinThreshold`.
 */
export function basePassSpec(profile: SourceProfile, fuzzy: boolean): PassSpec {
  return {
    name: 'base',
    scope: 'segment',
    minScore: profile.minAcceptScore,
    scoreCap: 1.5,
    shallowAnchorLimit: 3,
    deepAnchorMinRun: 3,
    maxStartIdx: profile.maxDhStartIdx,
    fuzzy,
    mode: 'score',
    uniqueAnchorMaxWords: 1
  };
}

/**
 * סדר המעברים על הספר, מן הראיה החזקה אל החלשה.
 *
 * **ש"ס ותנ"ך מקבלים מעבר אחד בדיוק** — `basePassSpec`, כלומר ההתנהגות שהייתה מאז ומעולם.
 * הלולאה שרצה עליהם פעם אחת זהה בזרימתה למה שהיה לפניה, ולכן הפלט שלהם אינו יכול לזוז.
 *
 * בספרי הלכה: ארבעה מעברי **עוגן** בהיקף הסימן כולו, ואחריהם מעבר הבסיס.
 *
 * שני דברים שראוי לדעת על הטבלה הזאת:
 *
 * • **מעבר הבסיס בסוף אינו חלק מן הטבלה שבתוכנית** — הוא זנב זמני. מעברי העוגן נעצרים ברף
 *   2.0, ואילו המעבר היחיד שרץ היום יורד ל-1.5; בלי הזנב היינו מאבדים כיסוי, ולא היה אפשר
 *   למדוד את מעברי העוגן בבידוד. המעברים ממוקדי-החלון (שלב 6 בתוכנית) יחליפו אותו.
 *   הוא רץ **בהיקף החלון**, וזה מה שהופך את אי-הנסיגה למובטחת מבנית: מעברי העוגן מחפשים
 *   בסימן כולו וללא אילוץ סדר, M1 מנכה את הסתירות שנוצרו ביניהם, ומכאן ואילך אף מעבר אינו
 *   יכול להוסיף נסיגה כי אין לו לאן.
 *
 * • **הרף, ולא ספירת המילים, הוא מה שנאכף.** השמות מתארים את האפקט הצפוי — "אם יש כן" הוא
 *   שלוש מילים ששוות 1.05, ואילו "מסתברא" היא מילה אחת ששווה 1.25, וחלוקה לפי ספירה הייתה
 *   שולחת את הצירוף החלש לשמש עוגן.
 *
 * הטבלה המלאה, על שנים-עשר מעבריה: docs/HALACHA_MULTIPASS_PLAN.md סעיף 4.
 */
export function passSpecsFor(profile: SourceProfile, fuzzy: boolean): PassSpec[] {
  const base = basePassSpec(profile, fuzzy);
  if (profile.kind !== 'halacha') return [base];

  // `fuzzy && !exact` ולא `!exact`: כשהמשתמש כיבה התאמה מטושטשת בכלל, מעבר "גמיש" נשאר
  // מילולי — הוא סתם מריץ שוב את אותו חיפוש ברף נמוך יותר, וזה נכון.
  /**
   * מעבר עוגן: סורק את הסימן כולו ברף גבוה. **נתיב הייחודיות כבוי בהם** — עוגן של מילה
   * בודדת על פני סימן שלם הוא בדיוק ההימור שהתוכנית באה למנוע, ואילו הופיע כאן הוא היה
   * קובע את החלון לכל שאר הסימן על סמך הראיה הדקה ביותר שיש.
   */
  const anchor = (name: string, minScore: number, exact: boolean): PassSpec =>
    ({ ...base, name, minScore, fuzzy: fuzzy && !exact, uniqueAnchorMaxWords: 0 });

  /**
   * שלב ב׳ — בתוך החלון. כאן הרפים יורדים מתחת למה שרץ היום (1.5), וזה בטוח אך ורק משום
   * שתחום החיפוש כבר צומצם: אותו רף עצמו מסוכן על פני סימן שלם ואינו מסוכן על פני שתי שורות.
   */
  const windowed = (
    name: string,
    minScore: number,
    exact: boolean,
    over: Partial<PassSpec> = {}
  ): PassSpec => ({
    ...base, name, minScore, fuzzy: fuzzy && !exact, scope: 'window',
    uniqueAnchorMaxWords: 0, ...over
  });

  /**
   * מעבר ייחודיות: בלי ניקוד ובלי רף, רק היקרות יחידה של הצירוף **בתוך החלון**. זה מה שהופך
   * את הנתיב לשמיש בשו"ע — מילת מפתח חוזרת בסימן שוב ושוב, וייחודיות על פני הסימן כולו
   * כמעט אינה מתקיימת, אך בתוך שתיים-שלוש שורות היא ראיה של ממש.
   */
  const unique = (name: string, maxWords: number): PassSpec => ({
    ...base, name, scope: 'window', mode: 'unique',
    minScore: undefined, fuzzy: false, uniqueAnchorMaxWords: maxWords
  });

  return [
    anchor('ציטוט ארוך מילולי', 3.6, true),
    anchor('ציטוט ארוך גמיש', 3.0, false),
    anchor('שלוש מילים מילולי', 2.4, true),
    anchor('שלוש מילים גמיש', 2.0, false),

    // M1 רץ כאן — בין הסריקה החופשית של הסימן לבין כל מה שנשען על חלונות.
    windowed('שתי מילים מילולי', 1.7, true, { deepAnchorMinRun: 2, prunesConflictsBefore: true }),
    unique('צירוף ייחודי בחלון', 3),
    // מעבר הבסיס: בדיוק הרף שרץ היום, כשורה בטבלה ככל השאר.
    { ...base, scope: 'window' },
    windowed('שתי מילים גמיש', 1.4, false, { deepAnchorMinRun: 2 }),
    unique('מילה נדירה ייחודית בחלון', 1),
    windowed('מילה בודדת', 1.15, true, { deepAnchorMinRun: 1 }),
    windowed('מילה בודדת גמישה', 1.0, false, { deepAnchorMinRun: 1 }),
    // ס"ק שנפתח במילת קישור ("ומ"ש", "ובמה שכתב") — הלמה מתחילה מאוחר יותר בשורה.
    windowed('פתיחה מאוחרת', 0.9, false, { deepAnchorMinRun: 1, maxStartIdx: 4 }),
    // הרף הנמוך ביותר, ורק כשנשארו שלוש שורות אפשריות או פחות.
    // M1 רץ שוב לפניו — הוא המעבר האחרון, ולכן זו ההזדמנות האחרונה לנכות סתירה שנוצרה
    // בשלב ב׳ ועדיין להשאיר מעבר שיבנה אחריה את שרשרת הירושה מחדש.
    windowed('חלון צר בלבד', 0.6, false, {
      deepAnchorMinRun: 1, maxWindowWidth: 3, prunesConflictsBefore: true
    })
  ];
}

/** שדות האפיון שקובעים את מבנה הקטעים. תת-קבוצה של PluginConfig, כדי לא לייבא את types לכאן. */
export interface ProfileConfigFields {
  sourceCategory?: string;
  /** "קטע פירוש מתחלק לפעמים לכמה שורות" — ברירת מחדל: כן. */
  halachaMultiLinePieces?: boolean;
  /** "הספר מחולק לסעיפים קטנים" — נשאל רק כשהקודם נכון. ברירת מחדל: כן. */
  halachaSeifKatan?: boolean;
}

/** המבנה שהאפיון מתאר. ברירות המחדל שומרות על ההתנהגות שהייתה לפני שהשאלות נוספו. */
export function halachaModeFromConfig(config: ProfileConfigFields): HalachaPieceMode {
  if (config.halachaMultiLinePieces === false) return 'single-line';
  return config.halachaSeifKatan === false ? 'multi-line' : 'seif-katan';
}

/** הפרופיל של סשן שלם — נקודת הכניסה היחידה שגם המנוע וגם העורך משתמשים בה. */
export function profileForConfig(config: ProfileConfigFields | undefined): SourceProfile {
  if (!config || config.sourceCategory !== 'halacha') return DEFAULT_PROFILE;
  return halachaProfile(halachaModeFromConfig(config));
}

/** הפרופיל מן הקטגוריה בלבד, לקוראים שאין להם אפיון מלא (בדיקות). */
export function profileForCategory(category: string | undefined): SourceProfile {
  return profileForConfig({ sourceCategory: category });
}

/**
 * האם השורה ממשיכה את השורה שמעליה לפי כללי הפרופיל — לשימוש גם במנוע וגם בשרשראות הירושה
 * של העורך, כדי ששני העותקים של אותו כלל לא יסטו זה מזה.
 *
 * במבנה ס"ק: כל שורת תוכן שאינה פותחת ס"ק. שורה שאין בה מספור פותחת ס"ק כשהיא באה מיד אחרי
 * שורת אסימון (`prevContentLine`) — לכן שורת התוכן שמעליה נדרשת כאן, ולא רק השורה עצמה.
 */
export function continuesByProfile(
  profile: SourceProfile,
  rawLine: string,
  prevContentLine?: string
): boolean {
  if (!profile.numberingDrivesLinking) return false;
  if (hasHalachaNumbering(rawLine)) return false;
  return !(prevContentLine !== undefined && isSeifKatanMarkerLine(prevContentLine));
}
