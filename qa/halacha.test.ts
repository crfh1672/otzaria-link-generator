/**
 * קטגוריית הלכה (שולחן ערוך) — בדיקות יחידה וקצה-לקצה על טקסט סינתטי.
 *
 *   node --import tsx qa/halacha.test.ts
 *
 * הבדיקות כאן מכסות את שני חצאי המדיניות: זיהוי המספור (הקלט של הפרופיל) והחלטות הקישור
 * והירושה שנגזרות ממנו (הפלט). הבדיקה ששומרת על ש"ס היא qa/run.ts verify, לא הקובץ הזה.
 */
import {
  hasHalachaNumbering,
  stripHalachaNumbering,
  isNumberedContentHeader,
  isSeifKatanMarkerLine,
  isBareMarkerHeader,
  halachaModeFromConfig,
  profileForConfig,
  HALACHA_PROFILE,
  DEFAULT_PROFILE,
  basePassSpec,
  passSpecsFor
} from '../src/utils/halachaAlgorithm';
import {
  runLinkingParser,
  isHeaderLine,
  isLinkableContentLine,
  extractDiburHamatchil,
  buildLinkUnits,
  windowForUnit,
  pruneConflictingAnchors,
  calculateLinkConfidence
} from '../src/utils/parserAlgorithm';
import { PluginConfig, OtzariaLink } from '../src/types';
import { SYNTHETIC_COMMENTARY, SYNTHETIC_SOURCE } from './halacha.metrics';

let failures = 0;
const eq = (name: string, got: unknown, want: unknown) => {
  const g = JSON.stringify(got);
  const w = JSON.stringify(want);
  if (g === w) {
    console.log(`  ok   ${name}`);
  } else {
    failures++;
    console.log(`  FAIL ${name}\n         got  ${g}\n         want ${w}`);
  }
};

/* ── זיהוי מספור ──────────────────────────────────────────────────────────────────────── */

console.log('\nזיהוי מספור');
eq('צורות מסוגרות מזוהות',
  ['(א) טקסט', '[ב] טקסט', '{ט"ו} טקסט', '(קמ) טקסט'].map(hasHalachaNumbering),
  [true, true, true, true]);
eq('סוגר סוגר ונקודה מזוהים',
  ['א) טקסט', 'ב] טקסט', 'ג. טקסט'].map(hasHalachaNumbering),
  [true, true, true]);
eq('מספור בתוך תגית כותרת מזוהה',
  hasHalachaNumbering('<h4>(ג) ומה שכתב הרב</h4>'),
  true);

/**
 * כותרת שכל תוכנה אות מספור חשופה. `HALACHA_NUMBERING_RE` מדיר את הצורה הזאת בכוונה — בשורת
 * תוכן "א טקסט" חסר הכרעה — אבל בכותרת שאין בה דבר מלבד האותיות אין ספק כלל, וזו הצורה שבה
 * חלק מנושאי הכלים מסמנים את חלוקת הקטעים שלהם. בלי ההכרה הזאת כל כותרת כזאת הופכת
 * לגבול-סגמנט שלעולם לא תימצא לו מקבילה במקור.
 */
console.log('\nסימן ס"ק כאות חשופה בכותרת');
eq('כותרת שכולה אות מספור מזוהה',
  ['<h3>א</h3>', '<h3>טו</h3>', '<h3>ק"ג</h3>', '### ב'].map(isBareMarkerHeader),
  [true, true, true, true]);
eq('אותה אות בשורת תוכן אינה מזוהה — שם ההדרה נשארת',
  ['א', 'א טקסט', 'טו'].map(isBareMarkerHeader),
  [false, false, false]);
eq('כותרת עם טקסט נוסף אינה סימן חשוף',
  ['<h3>א טקסט</h3>', '<h3>סימן א</h3>'].map(isBareMarkerHeader),
  [false, false]);
eq('רצף אותיות שאינו גימטרייה תקינה נפסל',
  ['<h3>אב</h3>', '<h3>שם</h3>'].map(isBareMarkerHeader),
  [false, false]);
eq('היא שורת אסימון ס"ק, ולכן אינה יחידה ואינה גבול-סגמנט',
  [
    isSeifKatanMarkerLine('<h3>א</h3>'),
    isHeaderLine('<h3>א</h3>', HALACHA_PROFILE),
    isLinkableContentLine('<h3>א</h3>', HALACHA_PROFILE)
  ],
  [true, false, false]);
eq('ובש"ס היא נשארת כותרת רגילה',
  isHeaderLine('<h3>א</h3>', DEFAULT_PROFILE),
  true);

eq('מילים רגילות אינן מספור',
  ['כלל. וכן הוא', 'פרק. ראשון', 'סימן. א', 'ובזה יש לומר'].map(hasHalachaNumbering),
  [false, false, false, false]);
eq('צורת הגרש הבודד מודרת בכוונה (ר\' יוחנן)',
  ["ר' יוחנן אומר", "ב' דברים"].map(hasHalachaNumbering),
  [false, false]);
eq('אות בודדת בלי סוגר/נקודה אינה מספור',
  hasHalachaNumbering('א טקסט'),
  false);

console.log('\nחיתוך מספור');
eq('חיתוך משאיר את הטקסט בלבד', stripHalachaNumbering('(א) השכם ללמוד'), 'השכם ללמוד');
eq('חיתוך שומר על עטיפת ה-HTML', stripHalachaNumbering('<h4>(ג) ומה שכתב</h4>'), '<h4>ומה שכתב</h4>');
eq('שורה בלי מספור חוזרת כמות שהיא', stripHalachaNumbering('והנה יש לדקדק'), 'והנה יש לדקדק');

console.log('\nכותרות');
eq('כותרת "סימן" נשארת כותרת גם בפרופיל הלכה',
  isHeaderLine('<h3>סימן א</h3>', HALACHA_PROFILE),
  true);
eq('כותרת ממוספרת שאינה "סימן" היא שורת תוכן',
  isHeaderLine('<h4>(ב) ולענין הלכה</h4>', HALACHA_PROFILE),
  false);
eq('אותה כותרת נשארת כותרת בפרופיל ש"ס',
  isHeaderLine('<h4>(ב) ולענין הלכה</h4>', DEFAULT_PROFILE),
  true);
eq('isNumberedContentHeader דורש גם צורת כותרת וגם מספור',
  [
    isNumberedContentHeader('<h4>(ב) ולענין</h4>'),
    isNumberedContentHeader('(ב) ולענין'),
    isNumberedContentHeader('<h3>סימן (ב)</h3>')
  ],
  [true, false, false]);

console.log('\nשורת אסימון ס"ק');
eq('כותרת ממוספרת היא שורת אסימון — גם כשיש בה טקסט',
  ['<h4>(א)</h4>', '<h4>(ג) ומה שכתב הרב</h4>', '# (ב)'].map(isSeifKatanMarkerLine),
  [true, true, true]);
eq('מספור לבדו בשורה הוא שורת אסימון',
  ['(א)', '  ב)  ', '(ט"ו)'].map(isSeifKatanMarkerLine),
  [true, true, true]);
eq('מספור שאחריו טקסט אינו שורת אסימון — הוא הפותח עצמו',
  ['(א) יתגבר כארי', 'ב) ומה שכתב'].map(isSeifKatanMarkerLine),
  [false, false]);
eq('שורה בלי מספור אינה שורת אסימון',
  ['וכבר כתבו הראשונים', '<h3>סימן א</h3>'].map(isSeifKatanMarkerLine),
  [false, false]);

console.log('\nמבנה הקטעים מן האפיון');
eq('ברירת מחדל (שדות ריקים) היא מבנה ס"ק',
  halachaModeFromConfig({}),
  'seif-katan');
eq('כיבוי הקטעים הרב-שורתיים גובר על שאלת הס"ק',
  halachaModeFromConfig({ halachaMultiLinePieces: false, halachaSeifKatan: true }),
  'single-line');
eq('רב-שורתי בלי ס"ק',
  halachaModeFromConfig({ halachaMultiLinePieces: true, halachaSeifKatan: false }),
  'multi-line');
eq('ש"ס אינו מושפע משדות ההלכה',
  profileForConfig({ sourceCategory: 'shas', halachaMultiLinePieces: false }).kind,
  'shas');
eq('שלושת המבנים — מי מחפש ומי יורש',
  (['single-line', 'multi-line', 'seif-katan'] as const).map(mode => {
    const p = profileForConfig({
      sourceCategory: 'halacha',
      halachaMultiLinePieces: mode !== 'single-line',
      halachaSeifKatan: mode === 'seif-katan'
    });
    return [p.numberingDrivesLinking, p.allowsInheritance];
  }),
  [[false, false], [false, true], [true, true]]);

/* ── קצה-לקצה ─────────────────────────────────────────────────────────────────────────── */

const cfg = (over: Partial<PluginConfig> = {}): PluginConfig => ({
  sourceCategory: 'halacha',
  targetBookName: 'שולחן ערוך, אורח חיים',
  ignoreShamInShas: false,
  diburHamatchilDelimiter: '',
  useAbbreviationExpansion: true,
  useFuzzyMatching: true,
  useWordWeighting: true,
  ...over
});

/**
 * שו"ע: כותרת סימן ותשעה סעיפים. המסמך מכוון להיות רחב דיו כדי שמשקלי ה-IDF יהיו בעלי משמעות
 * — על מסמך בן שלוש שורות כל מילה נדירה באותה מידה, והציון מאבד את היכולת להפריד.
 */
const source = [
  '<h3>סימן א</h3>',
  'יתגבר כארי לעמוד בבוקר לעבודת בוראו שיהא הוא מעורר השחר',
  'המשכים לקום קודם אור הבוקר ראוי לו לומר דברי תחנונים',
  'שויתי הוי לנגדי תמיד הוא כלל גדול בתורה ובמעלות הצדיקים',
  'וכן ראוי לאדם להתבונן במעשיו קודם שיתחיל בעבודת היום',
  'טוב מעט תחנונים בכוונה מהרבות בלא כוונה',
  'ויאמר פרשת העקדה ופרשת המן ועשרת הדברות',
  'ולא יסיח דעתו מן הדברים העומדים ברומו של עולם',
  'ויזהר בכבוד הבריות ובנקיות הגוף קודם התפילה',
  'ואם היה לו צער בגופו יקצר בדברי התחנונים'
].join('\n');

/**
 * נושא כלים: שלושה קטעים ממוספרים, כל אחד עם שורת המשך לא ממוספרת, ועוד קטע ממוספר שאין לו
 * שום עוגן בשו"ע — הוא זה שבודק את שני הכללים החדשים (אין לו ירושה, ואינו מנתק את השרשרת).
 */
const commentary = [
  '<h3>סימן א</h3>',
  '(א) יתגבר כארי לעמוד - כלומר שיזרז עצמו ולא יתעצל',
  'וכבר כתבו הראשונים שאין זה חיוב גמור אלא מידת חסידות',
  '(ב) שויתי הוי לנגדי - הוא מיסודי האמונה',
  'ומכאן למדו שצריך אדם לשום דרכיו תמיד',
  '(ג) בענין שאין לו זכר כלל בדברי המחבר ואינו נמצא בשום מקום',
  '(ד) טוב מעט תחנונים - שהכוונה עיקר',
  'ולכן נהגו לקצר בתחנונים'
].join('\n');

const res = runLinkingParser(commentary, source, cfg());
const byLine = new Map(res.links.map(l => [l.line_index_1, l]));
const target = (l: number) => byLine.get(l)?.line_index_2 ?? null;
const inherited = (l: number) => byLine.get(l)?.isInherited ?? null;

console.log('\nקצה-לקצה');
eq('שורה ממוספרת (2) מוצאת את הסעיף שלה', target(2), 2);
eq('שורת המשך (3) יורשת ממנה', [target(3), inherited(3)], [2, true]);
eq('שורה ממוספרת (4) מוצאת את הסעיף שלה', target(4), 4);
eq('שורת המשך (5) יורשת ממנה', [target(5), inherited(5)], [4, true]);
eq('שורה ממוספרת בלי עוגן (6) נשארת בלי קישור', target(6), null);
eq('שורה ממוספרת (7) מוצאת את הסעיף שלה — השרשרת לא נשברה', target(7), 6);
eq('שורת המשך (8) יורשת ממנה', [target(8), inherited(8)], [6, true]);

/**
 * "השרשרת נשמרת": כשקטע ממוספר נכשל, ההמשך שמתחתיו ממשיך לרשת את הקישור המוצלח האחרון
 * במקום להישאר יתום. אותו מסמך, בלי הקטע המוצלח שאחרי הכישלון.
 */
const commentaryOrphan = [
  '<h3>סימן א</h3>',
  '(א) יתגבר כארי לעמוד - כלומר שיזרז עצמו ולא יתעצל',
  '(ב) בענין שאין לו זכר כלל בדברי המחבר ואינו נמצא בשום מקום',
  'והמשך הדיון של אותו קטע שנכשל'
].join('\n');
const resOrphan = runLinkingParser(commentaryOrphan, source, cfg());
const orphanByLine = new Map(resOrphan.links.map(l => [l.line_index_1, l]));
eq('אחרי כישלון של שורה ממוספרת, ההמשך עדיין יורש את הקישור המוצלח האחרון',
  [orphanByLine.get(3)?.line_index_2 ?? null, orphanByLine.get(4)?.line_index_2 ?? null],
  [null, 2]);

/* ── שלושת המבנים על אותו טקסט ────────────────────────────────────────────────────────── */

/**
 * קטע אחד ממוספר ותחתיו שורת המשך שאין לה שום עוגן בשו"ע. שלושת המבנים נבדלים זה מזה בדיוק
 * בשאלה מה קורה לשורה השנייה, ולכן אותו טקסט מספיק לשלושתם.
 */
const twoLinePiece = [
  '<h3>סימן א</h3>',
  '(א) יתגבר כארי לעמוד - כלומר שיזרז עצמו ולא יתעצל',
  'וכבר כתבו הראשונים שאין זה חיוב גמור אלא מידת חסידות'
].join('\n');

const runMode = (mode: 'single-line' | 'multi-line' | 'seif-katan', text = twoLinePiece) =>
  runLinkingParser(text, source, cfg({
    halachaMultiLinePieces: mode !== 'single-line',
    halachaSeifKatan: mode === 'seif-katan'
  }));

const at = (res: { links: any[] }, line: number) => {
  const l = res.links.find(x => x.line_index_1 === line);
  return l ? [l.line_index_2, Boolean(l.isInherited)] : null;
};

console.log('\nמבנה: קטע פירוש = שורה אחת');
{
  const res = runMode('single-line');
  eq('השורה הממוספרת נמצאת בזכות עצמה', at(res, 2), [2, false]);
  eq('השורה שאחריה עומדת בפני עצמה ונשארת בלי קישור — אין ירושה', at(res, 3), null);
}

console.log('\nמבנה: קטעים רב-שורתיים בלי ס"ק');
{
  const res = runMode('multi-line');
  eq('השורה הראשונה נמצאת בזכות עצמה', at(res, 2), [2, false]);
  eq('השורה שלא נמצאה יורשת את השורה שמעליה', at(res, 3), [2, true]);
}

console.log('\nמבנה: ס"ק');
{
  const res = runMode('seif-katan');
  eq('פותח הס"ק נמצא בזכות עצמו', at(res, 2), [2, false]);
  eq('שורת ההמשך יורשת בלי לחפש כלל', at(res, 3), [2, true]);
}

/* ── ס"ק שסימנו עומד בשורה משלו ───────────────────────────────────────────────────────── */

/**
 * שני ס"ק שסימנם כתוב כשורת כותרת נפרדת. הכלל: שורת האסימון אינה מקבלת קישור, והחיפוש נעשה
 * בשורה שאחריה — היא זו שנושאת את הציטוט מלשון השו"ע.
 */
const markerCommentary = [
  '<h3>סימן א</h3>',
  '<h4>(א)</h4>',
  'יתגבר כארי לעמוד - כלומר שיזרז עצמו ולא יתעצל',
  'וכבר כתבו הראשונים שאין זה חיוב גמור אלא מידת חסידות',
  '(ב)',
  'שויתי הוי לנגדי - הוא מיסודי האמונה',
  'ומכאן למדו שצריך אדם לשום דרכיו תמיד'
].join('\n');

console.log('\nס"ק שסימנו בשורה נפרדת');
{
  const res = runMode('seif-katan', markerCommentary);
  eq('שורת האסימון עצמה אינה מקבלת קישור', at(res, 2), null);
  eq('החיפוש נעשה בשורה שאחרי האסימון, והקישור נרשם עליה', at(res, 3), [2, false]);
  eq('שורת ההמשך שאחריה יורשת ממנה', at(res, 4), [2, true]);
  eq('אסימון בלי תגית כותרת מתנהג בדיוק כמוהו', at(res, 5), null);
  eq('הפותח של הס"ק השני נמצא בזכות עצמו', at(res, 6), [4, false]);
  eq('וההמשך שלו יורש ממנו', at(res, 7), [4, true]);
}

/* ── מילוי פערים בין שני עוגנים זהים ──────────────────────────────────────────────────── */

/**
 * שני ס"ק שנמצאו — כל אחד בזכות עצמו — כנגד אותה שורת שו"ע, וביניהם ס"ק שלא נמצא לו דבר.
 * הכליאה היא הראיה: הקטע הכלוא דן באותה שורה, ולכן הוא מקבל אותה בירושה.
 */
const gapCommentary = [
  '<h3>סימן א</h3>',
  '(א) יתגבר כארי לעמוד - כלומר שיזרז עצמו ולא יתעצל',
  '(ב) בענין שאין לו זכר כלל בדברי המחבר ואינו נמצא בשום מקום',
  '(ג) לעמוד בבוקר לעבודת בוראו - שזו עיקר העבודה כולה'
].join('\n');

console.log('\nמילוי פערים');
{
  const res = runMode('seif-katan', gapCommentary);
  eq('שני העוגנים מצביעים על אותה שורת מקור',
    [at(res, 2)?.[0], at(res, 4)?.[0]],
    [2, 2]);
  eq('הקטע הכלוא ביניהם קיבל את אותה שורה, מסומן כירושה', at(res, 3), [2, true]);
  eq('הקישורים חוזרים ממוינים לפי סדר השורות',
    res.links.map(l => l.line_index_1),
    [2, 3, 4]);
}

/**
 * הגבול של הכלל: שני עוגנים המצביעים על שורות שונות אינם כולאים דבר, והקטע שביניהם נשאר בלי
 * קישור — זו בדיוק ההבחנה בין "כלוא בין שני דיונים באותה שורה" לבין "לא נמצא".
 */
{
  const res = runMode('seif-katan', commentary);
  eq('עוגנים שונים אינם ממלאים את הפער', at(res, 6), null);
}

/* ── המבחן שהעורך והייצוא עושים ────────────────────────────────────────────────────────── */

/**
 * `isLinkableContentLine` הוא הכלל היחיד שמחליט אילו שורות רואים בעורך, אילו נספרות כ"שורות
 * ללא קישור" ומעל אילו שורות רץ מילוי הפערים. הוא חייב להסכים עם לולאת הקישור עצמה: מה
 * שהמנוע דילג עליו אינו כישלון, ומה שהמנוע חיפש בו חייב להופיע לעריכה.
 */
console.log('\nשורה שמשתתפת בקישור');
{
  const sk = profileForConfig({ sourceCategory: 'halacha' });
  const multi = profileForConfig({ sourceCategory: 'halacha', halachaSeifKatan: false });

  eq('כותרת "סימן" אינה שורת תוכן באף פרופיל',
    [isLinkableContentLine('<h3>סימן א</h3>', sk), isLinkableContentLine('<h3>סימן א</h3>', DEFAULT_PROFILE)],
    [false, false]);
  eq('שורת אסימון ס"ק אינה שורת תוכן במבנה ס"ק',
    [isLinkableContentLine('<h4>(א)</h4>', sk), isLinkableContentLine('(ב)', sk)],
    [false, false]);
  eq('ס"ק שנכתב ככותרת ונושא טקסט הוא שורת תוכן כשהמספור אינו מנהל את הקישור',
    isLinkableContentLine('<h4>(ג) ומה שכתב הרב</h4>', multi),
    true);
  eq('פותח ס"ק רגיל ושורת המשך הן שורות תוכן',
    [isLinkableContentLine('(א) יתגבר כארי', sk), isLinkableContentLine('וכבר כתבו הראשונים', sk)],
    [true, true]);
  eq('בש"ס המבחן זהה לזה שהיה — ריקה או כותרת בלבד',
    [
      isLinkableContentLine('', DEFAULT_PROFILE),
      isLinkableContentLine('<h4>(ב) ולענין הלכה</h4>', DEFAULT_PROFILE),
      isLinkableContentLine('בא"ד וכן נראה', DEFAULT_PROFILE)
    ],
    [false, false, true]);
}

/* ── גבול הד"ה: סימני הפיסוק ───────────────────────────────────────────────────────────── */

/**
 * בספרי הלכה לד"ה יש סוף מודפס, והמנוע חייב לכבד אותו גם כשהמשתמש לא הגדיר דבר. הבדיקות כאן
 * הן על שני צדדיו של הכלל: מה שכן חותך, ובמידה שווה — מה שאסור לו לחתוך.
 * ראו docs/HALACHA_MULTIPASS_PLAN.md סעיף 3.
 */
console.log('\nגבול הד"ה');
{
  const dh = (line: string, profile = HALACHA_PROFILE) =>
    extractDiburHamatchil(line, '', profile.maxDhWords, profile).dhText;
  const explicit = (line: string, profile = HALACHA_PROFILE) =>
    extractDiburHamatchil(line, '', profile.maxDhWords, profile).isExplicitDelimiter;

  eq('ארבע צורות המקף חותכות',
    [
      dh('ולא ישתה - ואפילו מים'),
      dh('ולא ישתה ־ ואפילו מים'),
      dh('ולא ישתה – ואפילו מים'),
      dh('ולא ישתה — ואפילו מים')
    ],
    ['ולא ישתה', 'ולא ישתה', 'ולא ישתה', 'ולא ישתה']);
  eq('מקף בלי רווח לפניו אך עם רווח אחריו חותך', dh('ולא ישתה- ואפילו מים'), 'ולא ישתה');
  eq('נקודה ונקודתיים חותכות',
    [dh('בשבת. ועיין לקמן'), dh('בשבת: ועיין לקמן'), dh('בשבת... ועיין לקמן')],
    ['בשבת', 'בשבת', 'בשבת']);
  eq('החיתוך מסמן את הד"ה כמפורש', explicit('ולא ישתה - ואפילו מים'), true);

  eq('מקף בתוך מילה אינו חותך — הוא מחבר', dh('כל־האדם חייב בכך'), 'כל־האדם חייב בכך');
  eq('גרשיים של ראשי תיבות אינם חותכים', dh('כתב המג"א דהיינו דוקא'), 'כתב המג"א דהיינו דוקא');
  eq('נקודה בלי רווח אחריה אינה חותכת', dh('סימן ר.ד ועיין שם'), 'סימן ר.ד ועיין שם');
  eq('אסימון בראש השורה אינו חותך — ד"ה ריק אינו ד"ה', dh('- ואפילו מים מותרים'), '- ואפילו מים מותרים');
  eq('שורה בלי אסימון סיום נופלת לאחור להתנהגות הרגילה',
    [dh('ואפילו מים אסורים קודם התפילה'), explicit('ואפילו מים אסורים קודם התפילה')],
    ['ואפילו מים אסורים קודם התפילה', false]);

  /**
   * "כו'" בהלכה פירושו קיצור לשון השו"ע — הוא סוגר את הד"ה ומה שלפניו הוא העוגן. בש"ס אותה
   * שורה מפעילה את מנגנון מקטעי ההמשך, שלוקח את השורה כולה. זהו ההבדל בין שתי הקטגוריות.
   */
  eq('כו\' סוגר את הד"ה בהלכה', dh("לא יאכל כו' - קודם שיתפלל"), 'לא יאכל');
  eq('גם בגרש עברי', dh("לא יאכל כו׳ - קודם שיתפלל"), 'לא יאכל');
  eq('האסימון המוקדם מבין השניים הוא שחותך', dh("לא יאכל - וכן כו' לענין שתיה"), 'לא יאכל');
  eq('בש"ס אותה שורה נשארת שלמה למקטעי ההמשך',
    dh("לא יאכל כו' - קודם שיתפלל", DEFAULT_PROFILE),
    "לא יאכל כו' - קודם שיתפלל");

  eq('בש"ס הפיסוק אינו חותך כלל',
    [dh('ולא ישתה - ואפילו מים', DEFAULT_PROFILE), explicit('בשבת. ועיין לקמן', DEFAULT_PROFILE)],
    ['ולא ישתה - ואפילו מים', false]);

  /** תו שהמשתמש הגדיר קודם לכול — הוא יודע על ספרו יותר מן הכלל הגנרי. */
  eq('תו שהמשתמש הגדיר גובר על הפיסוק',
    extractDiburHamatchil('ולא ישתה - ואפילו מים @@ המשך', '@@', 5, HALACHA_PROFILE).dhText,
    'ולא ישתה - ואפילו מים');
}

/**
 * ההדגשה בעורך נגזרת מן הד"ה: משהוא נחתך בפיסוק, ההדגשה מכסה בדיוק את הציטוט — ומתחילה אחרי
 * אסימון המספור, לא עליו.
 */
console.log('\nהדגשת הד"ה');
{
  const res = runLinkingParser(commentary, source, cfg());
  eq('ההדגשה מדלגת על המספור ומכסה את שלוש מילות הד"ה',
    res.dhHighlights[2],
    { wordStart: 1, wordCount: 3 });
  eq('וכך גם בס"ק אחר — ההדגשה נעצרת במקף ואינה בולעת את לשון הפרשן',
    res.dhHighlights[7],
    { wordStart: 1, wordCount: 3 });
}

/** תקרת הד"ה: 5 מילים בהלכה, מול 12 בש"ס. */
console.log('\nקבועי הפרופיל');
eq('maxDhWords', [DEFAULT_PROFILE.maxDhWords, HALACHA_PROFILE.maxDhWords], [12, 5]);
eq('maxDhStartIdx', [DEFAULT_PROFILE.maxDhStartIdx, HALACHA_PROFILE.maxDhStartIdx], [3, 2]);
eq('swdhMaxOpeningRatio', [DEFAULT_PROFILE.swdhMaxOpeningRatio, HALACHA_PROFILE.swdhMaxOpeningRatio], [0.008, 0.02]);

/**
 * הרצפה לרף מקבעת את הרף על הערך האפקטיבי של היום. בלעדיה, חיתוך הד"ה בפיסוק היה מפיל את הרף
 * מ-1.5 לכ-0.5 — הרפיה אמיתית שבטוחה רק בתוך חלון חיפוש מצומצם, שעדיין אינו קיים.
 * ראו docs/HALACHA_MULTIPASS_PLAN.md סעיף 3.
 */
eq('minAcceptScore', [DEFAULT_PROFILE.minAcceptScore, HALACHA_PROFILE.minAcceptScore], [undefined, 1.5]);

/**
 * הרצפה חייבת לחול גם על מסלול ההתאמה המילולית, שמציב ציון `expectedWeight + 10` — מספר
 * שעובר כל רף מעצם הגדרתו. בלי הגבלה, חיתוך הד"ה היה פותח דלת אחורית דווקא למחלקת הראיה
 * החלשה ביותר: ד"ה של מילה אחת שנמצא מילולית בראש שורת מקור כלשהי, כשאותה מילה פותחת עוד
 * שורות בסימן, וההכרעה ביניהן נופלת על שובר-השוויון של המרחק.
 */
{
  // קורפוס בסיס-ההשוואה של כלי המדידה — רחב דיו כדי שמשקלי ה-IDF יהיו בעלי משמעות, ומשותף
  // לשניהם כדי שהבדיקה והמדידה לא יסטו זו מזו.
  const links = new Map(
    runLinkingParser(SYNTHETIC_COMMENTARY, SYNTHETIC_SOURCE, cfg()).links.map(l => [l.line_index_1, l])
  );
  const own = (l: number) => (links.get(l) && !links.get(l)!.isInherited ? links.get(l)!.line_index_2 : null);

  eq('ד"ה של מילה אחת אינו עובר דרך ההתאמה המילולית',
    [own(10), own(11), own(12)],
    [null, null, null]);
  eq('ד"ה של שתי מילות תוכן כן עובר', own(9), 9);
  /**
   * "לא יאכל" — מילת קישור ומילת תוכן — אינו עובר את רף 1.5 של מעבר הבסיס, והוא כן נמצא
   * במעבר ממוקד-חלון שרפו נמוך יותר. זו בדיוק העסקה שהתוכנית עושה: החלון הוא מה שמשלם על
   * ההרפיה. ראו docs/HALACHA_MULTIPASS_PLAN.md סעיף 2.
   */
  eq('ד"ה שאחת משתי מילותיו היא מילת קישור נמצא רק בזכות החלון', own(8), 8);
}
eq('dhTerminatesAtPunctuation',
  [DEFAULT_PROFILE.dhTerminatesAtPunctuation, HALACHA_PROFILE.dhTerminatesAtPunctuation],
  [false, true]);
eq('usesContinuationSegments',
  [DEFAULT_PROFILE.usesContinuationSegments, HALACHA_PROFILE.usesContinuationSegments],
  [true, false]);

/**
 * `basePassSpec` הוא ההצהרה שהמעבר היחיד שרץ היום זהה למה שהיה כתוב קשיח במנוע. הבדיקה
 * נועלת את הערכים האלה: שינוי בהם אינו רפקטור אלא שינוי התנהגות, וצריך שייראה ככזה.
 * הטבלה המלאה: docs/HALACHA_MULTIPASS_PLAN.md סעיף 4.
 */
console.log('\nרשומת המעבר');
eq('ש"ס — בדיוק הקבועים שהיו בקוד',
  basePassSpec(DEFAULT_PROFILE, true),
  { name: 'base', scope: 'segment', minScore: undefined, scoreCap: 1.5,
    shallowAnchorLimit: 3, deepAnchorMinRun: 3, maxStartIdx: 3, fuzzy: true,
    mode: 'score', uniqueAnchorMaxWords: 1 });
eq('הלכה — הרצפה ותחילת ההתאמה הם ההבדל היחיד',
  basePassSpec(HALACHA_PROFILE, true),
  { name: 'base', scope: 'segment', minScore: 1.5, scoreCap: 1.5,
    shallowAnchorLimit: 3, deepAnchorMinRun: 3, maxStartIdx: 2, fuzzy: true,
    mode: 'score', uniqueAnchorMaxWords: 1 });
eq('דגל ההתאמה המטושטשת עובר דרך הרשומה', basePassSpec(DEFAULT_PROFILE, false).fuzzy, false);

/**
 * סדר המעברים. שתי התכונות שחייבות להתקיים כדי שההרפיה ההדרגתית תהיה בטוחה: ש"ס מקבל מעבר
 * אחד בדיוק (ולכן זרימתו זהה למה שהייתה), והרפים בהלכה יורדים ממש — מעבר שאינו מרפה ביחס
 * לקודמו הוא סריקה מיותרת של הספר.
 */
console.log('\nסדר המעברים');
{
  const specs = passSpecsFor(HALACHA_PROFILE, true);
  // מעברי הייחודיות אינם נושאים רף כלל — הראיה שלהם היא היקרות יחידה, לא ניקוד.
  const scores = specs.filter(s => s.mode === 'score').map(s => s.minScore!);

  eq('ש"ס מקבל מעבר אחד בדיוק', passSpecsFor(DEFAULT_PROFILE, true).length, 1);
  eq('הרפים יורדים ממש',
    scores.every((s, i) => i === 0 || s < scores[i - 1]),
    true);
  eq('מעבר ייחודיות אינו נושא רף, ומעבר מנוקד כן',
    specs.every(s => (s.mode === 'unique') === (s.minScore === undefined)),
    true);
  /**
   * נתיב הייחודיות **כבוי במעברי העוגן**. עוגן של מילה בודדת על פני סימן שלם הוא בדיוק
   * ההימור שהתוכנית באה למנוע — ואילו הופיע שם, הוא היה קובע את החלון לכל שאר הסימן על סמך
   * הראיה הדקה ביותר שיש.
   */
  eq('נתיב הייחודיות כבוי בכל מעבר שסורק את הסימן כולו',
    specs.filter(s => s.scope === 'segment').every(s => s.uniqueAnchorMaxWords === 0),
    true);

  /**
   * שתי האינווריאנטות שכל התוכנית עומדת עליהן — ולכן הן נבדקות כתכונה ולא כרשימה, שלא
   * תישברנה בשקט כשתיווסף שורה לטבלה.
   *
   * הראשונה: מה שרץ היום עדיין בסולם, ולכן מעברי העוגן שמעליו אינם יכולים לגרוע כיסוי.
   * השנייה, והחשובה: **כל רף שנמוך ממנו מותנה בחלון.** רף כזה מסוכן על פני סימן שלם ובטוח
   * על פני שתי שורות; אילו היה מעבר מרפה שסורק את הסימן כולו, הוא היה מציף את הפלט בקישורים
   * שגויים בדיוק כפי שתואר בסעיף 3 של התוכנית.
   */
  eq('הרף שרץ היום עדיין בסולם', scores.includes(HALACHA_PROFILE.minAcceptScore!), true);
  eq('כל מעבר שמרפה מתחת לרף של היום מוגבל לחלון',
    specs.filter(s => s.minScore! < HALACHA_PROFILE.minAcceptScore!).every(s => s.scope === 'window'),
    true);
  /**
   * M1 רץ פעמיים: לפני המעבר ממוקד-החלון הראשון (ניכוי הסתירות שנוצרו בסריקה החופשית של
   * שלב א׳), ולפני המעבר האחרון (הזדמנות אחרונה לנכות סתירה שנוצרה בשלב ב׳). **לעולם לא
   * אחרי המעבר האחרון** — ניכוי עוגן משנה את ההקשר שהשורות שאחריו יורשות, ולכן חייב לבוא
   * אחריו מעבר שיבנה את הירושה מחדש.
   */
  eq('M1 רץ לפני המעבר ממוקד-החלון הראשון ולפני האחרון, ואף פעם לא בסוף',
    [
      specs.findIndex(s => s.prunesConflictsBefore) === specs.findIndex(s => s.scope === 'window'),
      specs[specs.length - 1].prunesConflictsBefore === true,
      specs.filter(s => s.prunesConflictsBefore).length
    ],
    [true, true, 2]);
  eq('כשההתאמה המטושטשת כבויה — אף מעבר אינו גמיש',
    passSpecsFor(HALACHA_PROFILE, false).some(s => s.fuzzy),
    false);
}

/* ── יחידות וחלונות ───────────────────────────────────────────────────────────────────── */

/**
 * החלון הוא הביטוי המעשי של אי-הנסיגה, ולכן שתי המלכודות שלו הן שתי בדיקות: **הגבולות
 * כלולים** (שני ס"ק על אותו סעיף = חלון תקין ברוחב 1, המקרה הנפוץ ביותר בספר), ו**רק עוגן
 * אמיתי סוגר חלון** (קישור מורש אינו ראיה עצמאית, ואילו סגר — החלון היה מודד את הכישלון
 * שהוא אמור לפתור). ראו docs/HALACHA_MULTIPASS_PLAN.md סעיף 2.
 */
console.log('\nיחידות וחלונות');
{
  const u = (lineIdx1: number, segment: number, target: number | null, inherited = false) =>
    ({ lineIdx1, segment, target, inherited });
  const win = (units: ReturnType<typeof u>[], i: number) => {
    const w = windowForUnit(units, i);
    return [w.lo, w.hi, w.width];
  };

  eq('חלון סגור משני צדדיו',
    win([u(1, 0, 4), u(2, 0, null), u(3, 0, 9)], 1),
    [4, 9, 6]);
  eq('שני עוגנים על אותו סעיף — חלון תקין ברוחב 1, לא חלון ריק',
    win([u(1, 0, 4), u(2, 0, null), u(3, 0, 4)], 1),
    [4, 4, 1]);
  eq('קישור מורש אינו סוגר חלון',
    win([u(1, 0, 4), u(2, 0, 4, true), u(3, 0, null), u(4, 0, 9)], 2),
    [4, 9, 6]);
  eq('אין עוגן מלמעלה — חסום מצד אחד בלבד',
    win([u(1, 0, null), u(2, 0, 9)], 0),
    [null, 9, null]);
  eq('אין עוגן מלמטה — חסום מצד אחד בלבד',
    win([u(1, 0, 4), u(2, 0, null)], 1),
    [4, null, null]);
  eq('כותרת "סימן" מנתקת — עוגן בסגמנט אחר אינו גבול',
    win([u(1, 0, 4), u(2, 1, null), u(3, 1, null)], 1),
    [null, null, null]);

  /**
   * רשימת היחידות נגזרת מ-`isLinkableContentLine` — אותו מבחן שהמנוע, העורך והייצוא עושים —
   * ולכן היא משתנה עם המבנה. כותרת ממוספרת היא שורת אסימון במבנה ס"ק (אינה יחידה, והפותח
   * בפועל הוא השורה שאחריה) ושורת תוכן כשהמספור אינו מנהל את הקישור.
   */
  const lines = [
    '<h3>סימן א</h3>',
    '(א) יתגבר כארי לעמוד - כלומר',
    '<h4>(ב) ולענין הלכה</h4>',
    'ומכאן למדו שצריך אדם לשום דרכיו',
    '<h3>סימן ב</h3>',
    '(א) לא יאכל - ואפילו'
  ];
  const seg = (mode: Partial<PluginConfig>) =>
    buildLinkUnits(lines, [], profileForConfig({ sourceCategory: 'halacha', ...mode }))
      .map(x => [x.lineIdx1, x.segment]);

  eq('יחידות במבנה ס"ק: כותרת "סימן" מקדמת סגמנט, כותרת ממוספרת היא אסימון ולא יחידה',
    seg({}),
    [[2, 1], [4, 1], [6, 2]]);
  eq('ובמבנה רב-שורתי אותה כותרת ממוספרת היא יחידה',
    seg({ halachaSeifKatan: false }),
    [[2, 1], [3, 1], [4, 1], [6, 2]]);
}

/* ── עוגן ייחודי בחלון ────────────────────────────────────────────────────────────────── */

/**
 * נתיב הייחודיות אינו שוקל משקלים אלא נשען על היקרות יחידה בתחום החיפוש, ולכן הוא מצליח
 * בדיוק במקום שהרף נכשל בו. "יש אומרים" הוא שתי מילות קישור ששוות יחד 0.70 — הוא נופל בכל
 * מעבר מנוקד — אבל אם הצירוף המדויק מופיע פעם אחת בין שני העוגנים שכולאים אותו, זו ראיה
 * טובה. ראו docs/HALACHA_MULTIPASS_PLAN.md סעיף 4, מעבר "צירוף ייחודי בחלון".
 */
console.log('\nעוגן ייחודי בחלון');
{
  const src = [
    '<h3>סימן א</h3>',
    'יתגבר כארי לעמוד בבוקר לעבודת בוראו שיהא הוא מעורר השחר',
    'המשכים לקום קודם אור הבוקר ראוי לו לומר דברי תחנונים',
    'יש אומרים שמותר לטעום קודם התפילה למי שאין דעתו מיושבת',
    'וכן ראוי לאדם להתבונן במעשיו קודם שיתחיל בעבודת היום',
    'טוב מעט תחנונים בכוונה מהרבות בלא כוונה'
  ].join('\n');
  const comm = [
    '<h3>סימן א</h3>',
    '(א) יתגבר כארי לעמוד - כלומר שיזרז עצמו ולא יתעצל',
    '(ב) יש אומרים - וכן דעת רוב הפוסקים והאחרונים',
    '(ג) טוב מעט תחנונים - שהכוונה עיקר'
  ].join('\n');

  const links = new Map(runLinkingParser(comm, src, cfg()).links.map(l => [l.line_index_1, l]));
  const own = (l: number) => (links.get(l) && !links.get(l)!.isInherited ? links.get(l)!.line_index_2 : null);

  eq('שני העוגנים שכולאים נמצאו בזכות משקלם', [own(2), own(4)], [2, 6]);
  eq('הצירוף שנופל בכל רף נמצא בזכות היותו יחיד בחלון', own(3), 4);
}

/* ── ודאות: עומק בסולם מול רוחב החלון ─────────────────────────────────────────────────── */

/**
 * שני גדלים שמושכים לכיוונים מנוגדים, וזו הנקודה: מעבר מאוחר הרפה יותר ולכן מחליש, וחלון צר
 * מצמצם את מרחב הבחירה ולכן מחזק. אם הוודאות לא תשקף את שניהם, סדר הבדיקה יטעה את הבודק —
 * וסדר הבדיקה הוא המוצר.
 *
 * שני הגדלים **אינם נשמרים על הקישור ואינם מוצגים**; הם נצרכים בחישוב ונזרקים.
 */
console.log('\nודאות');
{
  const ev = { matchedWeight: 2.4, windowWeight: 3.0, runWords: 3, simSum: 3, winnerScore: 2.4, runnerUpScore: 0.5, exactPhrase: false };
  const conf = (passIndex?: number, searchRangeWidth?: number) =>
    calculateLinkConfidence({ isExplicit: true, evidence: ev, passIndex, searchRangeWidth });

  eq('אותה ראיה במעבר מאוחר יותר מדווחת נמוך יותר', conf(8, 40) < conf(0), true);
  eq('ובחלון צר אותו מעבר עצמו מדווח גבוה יותר', conf(8, 2) > conf(8, 40), true);
  eq('חלון של שורה אחת מקזז את הקנס במלואו', conf(4, 1), conf(0));
  eq('הזיכוי מקזז ואינו הופך לבונוס', conf(1, 1), conf(0));
  eq('המעבר הראשון אינו נקנס כלל — וכך ש"ס, שיש בו מעבר אחד', conf(0), conf(undefined, undefined));
}

/* ── M1: ניכוי עוגנים סותרים ──────────────────────────────────────────────────────────── */

/**
 * הצעד הקריטי בתוכנית. עוגן שגוי אינו קישור שגוי אחד — הוא קובע את החלון לכל מה שסביבו
 * ודוחף רצף שלם של ס"ק לטווח הלא נכון. הבחירה **לפי משקל הראיה ולא לפי סדר הגילוי** היא מה
 * שמבטיח שהנזרק הוא החלש מבין הסותרים.
 */
console.log('\nניכוי עוגנים סותרים');
{
  /** קישור מינימלי עם ציון דירוג אחד, שהוא מה ש-M1 שוקל לפיו. */
  const link = (lineIdx1: number, target: number, score: number): OtzariaLink => ({
    line_index_1: lineIdx1,
    line_index_2: target,
    heRef_2: '', path_2: '', connection_type: 'commentary',
    candidates: [{ lineNum: target, score, confidence: 50 }],
    candidateIndex: 0
  } as OtzariaLink);
  const unit = (lineIdx1: number, target: number | null, segment = 0, inherited = false) =>
    ({ lineIdx1, segment, target, inherited });

  /** מריץ את M1 ומחזיר את היעדים ששרדו, לפי סדר השורות. */
  const prune = (rows: [number, number, number][], segs?: number[]) => {
    const links = rows.map(([l, t, s]) => link(l, t, s));
    const units = rows.map(([l, t], i) => unit(l, t, segs ? segs[i] : 0));
    pruneConflictingAnchors(links, units);
    return links.map(l => [l.line_index_1, l.line_index_2]);
  };

  eq('רצף עולה — דבר אינו נזרק',
    prune([[2, 3, 5], [3, 5, 5], [4, 9, 5]]),
    [[2, 3], [3, 5], [4, 9]]);
  eq('שוויון מותר: כמה ס"ק על אותו סעיף',
    prune([[2, 4, 5], [3, 4, 5], [4, 4, 5]]),
    [[2, 4], [3, 4], [4, 4]]);
  eq('עוגן חורג יחיד נזרק, והרוב שנשאר עולה',
    prune([[2, 3, 5], [3, 9, 1], [4, 5, 5]]),
    [[2, 3], [4, 5]]);
  /**
   * שתי הבדיקות האלה יחד הן העיקר: אותה קבוצת יעדים בדיוק, ורק המשקלים מוחלפים — והתוצאה
   * מתהפכת. עוגן כבד גובר על **שני** עוגנים קלים שסותרים אותו, ולא להפך.
   */
  eq('שניים קלים גוברים על אחד כבד כשסכומם גדול יותר',
    prune([[2, 9, 3], [3, 3, 2], [4, 5, 2]]),
    [[3, 3], [4, 5]]);
  eq('ועוגן כבד דיו גובר על שניהם',
    prune([[2, 9, 99], [3, 3, 2], [4, 5, 2]]),
    [[2, 9]]);
  eq('סתירה מעבר לכותרת "סימן" אינה סתירה',
    prune([[2, 9, 5], [4, 3, 5]], [0, 1]),
    [[2, 9], [4, 3]]);

  /** קישור מורש אינו עוגן: הוא נגזרת של העוגן שמעליו, ואינו נשקל ואינו נזרק. */
  {
    const links = [link(2, 3, 5), link(3, 9, 5), link(4, 5, 5)];
    links[1].isInherited = true;
    pruneConflictingAnchors(links, [unit(2, 3), unit(3, 9, 0, true), unit(4, 5)]);
    eq('קישור מורש אינו נשקל ואינו נזרק',
      links.map(l => l.line_index_1),
      [2, 3, 4]);
  }
}

console.log(failures === 0 ? '\nALL HALACHA TESTS PASSED\n' : `\n${failures} FAILURE(S)\n`);
process.exit(failures === 0 ? 0 : 1);
