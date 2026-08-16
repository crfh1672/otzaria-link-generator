/**
 * קטגוריית הלכה — מדדי כיסוי, סדר וחלון.
 *
 *   node --import tsx qa/halacha.metrics.ts                          # קורפוס סינתטי מובנה
 *   node --import tsx qa/halacha.metrics.ts --commentary A --source B [--mode M] [--json]
 *
 * שלושה מספרים, כולם מחושבים **בלי ground-truth ובלי רשת** — זו כל הנקודה: אין ואין אמור
 * להיות אוסף קישורים "נכונים" לשו"ע, ולכן המדידה נשענת על תכונות שאפשר לבדוק מן הפלט עצמו.
 *
 *   כיסוי         — כמה יחידות קיבלו קישור, ומאיזה סוג. עולה = טוב.
 *   הפרות סדר     — כמה קישורים יורדים ביחס לקודם להם באותו סימן. זהו הפרוקסי ל-false
 *                   positives: הס"ק רצים לפי סדר הסעיפים, ולכן ירידה היא כמעט תמיד טעות.
 *                   אמור לרדת לאפס כשאילוץ אי-הנסיגה ייכנס (שלב 5 בתוכנית).
 *   רוחב החלון    — לכל יחידה שעדיין לא קושרה בזכות עצמה: כמה שורות מקור אפשריות נשארו לה
 *                   בין שני שכניה המקושרים. זהו האומדן לכמה המעברים ממוקדי-החלון יכולים
 *                   לקנות: יחידה שחלונה ברוחב 1 מוכרעת בלי שום ראיה טקסטואלית.
 *
 * ראו docs/HALACHA_MULTIPASS_PLAN.md שלב 0.
 *
 * ⚠ הרצה על קובצי שו"ע אמיתיים דורשת אישור מפורש של המשתמש — ראו qa/README.md.
 */
import fs from 'fs';
import {
  runLinkingParser,
  buildLinkUnits,
  windowForUnit,
  type LinkUnit
} from '../src/utils/parserAlgorithm';
import {
  profileForConfig,
  stripHalachaNumbering,
  findDhBoundary,
  HalachaPieceMode
} from '../src/utils/halachaAlgorithm';
import { PluginConfig } from '../src/types';

const argv = process.argv.slice(2);
const flag = (name: string): string | undefined => {
  const i = argv.indexOf(name);
  return i !== -1 && argv[i + 1] ? argv[i + 1] : undefined;
};

export interface Metrics {
  units: number;
  /** נמצא בחיפוש עצמאי — אלה היחידות שמשמשות עוגן. */
  own: number;
  inherited: number;
  none: number;
  /** אחוז היחידות שקיבלו קישור כלשהו. */
  coveragePct: number;
  /** אחוז היחידות שקושרו בזכות עצמן. */
  ownPct: number;
  /** קישורים שיורדים ביחס לקודם להם באותו סימן. */
  orderViolations: number;
  orderViolationPct: number;
  /** התפלגות רוחב החלון של היחידות שטרם קושרו בזכות עצמן. */
  windows: { width1: number; width2to3: number; width4to10: number; wider: number; unbounded: number };
  /** חציון רוחב החלון (∞ אינו נספר). */
  windowMedian: number | null;
}

export function measure(units: LinkUnit[]): Metrics {
  const own = units.filter(u => u.target !== null && !u.inherited).length;
  const inherited = units.filter(u => u.target !== null && u.inherited).length;
  const none = units.filter(u => u.target === null).length;

  let orderViolations = 0;
  let ordered = 0;
  let prevSeg = -1;
  let prevTarget: number | null = null;
  for (const u of units) {
    if (u.segment !== prevSeg) { prevSeg = u.segment; prevTarget = null; }
    if (u.target === null) continue;
    if (prevTarget !== null) {
      ordered++;
      if (u.target < prevTarget) orderViolations++;
    }
    prevTarget = u.target;
  }

  const windows = { width1: 0, width2to3: 0, width4to10: 0, wider: 0, unbounded: 0 };
  const widths: number[] = [];
  units.forEach((u, i) => {
    if (u.target !== null && !u.inherited) return; // כבר עוגן — אין לו חלון לפתור
    const w = windowForUnit(units, i).width;
    if (w === null) { windows.unbounded++; return; }
    widths.push(w);
    if (w === 1) windows.width1++;
    else if (w <= 3) windows.width2to3++;
    else if (w <= 10) windows.width4to10++;
    else windows.wider++;
  });
  widths.sort((a, b) => a - b);

  const pct = (n: number) => units.length ? Math.round((n / units.length) * 1000) / 10 : 0;
  return {
    units: units.length,
    own,
    inherited,
    none,
    coveragePct: pct(own + inherited),
    ownPct: pct(own),
    orderViolations,
    orderViolationPct: ordered ? Math.round((orderViolations / ordered) * 1000) / 10 : 0,
    windows,
    windowMedian: widths.length ? widths[Math.floor(widths.length / 2)] : null
  };
}

export function report(label: string, m: Metrics): void {
  const bar = (n: number) => '█'.repeat(Math.round(n / 5)).padEnd(20, '·');
  console.log(`\n── ${label} ${'─'.repeat(Math.max(0, 60 - label.length))}`);
  console.log(`  יחידות                ${m.units}`);
  console.log(`  כיסוי                 ${m.coveragePct}%  ${bar(m.coveragePct)}`);
  console.log(`    בזכות עצמן (עוגנים)   ${m.own}  (${m.ownPct}%)`);
  console.log(`    בירושה                ${m.inherited}`);
  console.log(`    בלי קישור             ${m.none}`);
  console.log(`  הפרות סדר             ${m.orderViolations}  (${m.orderViolationPct}% מהקישורים העוקבים)`);
  console.log(`  חלונות של יחידות שאינן עוגן   חציון ${m.windowMedian ?? '—'}`);
  console.log(`    רוחב 1 (מוכרע לוגית)  ${m.windows.width1}`);
  console.log(`    רוחב 2–3              ${m.windows.width2to3}`);
  console.log(`    רוחב 4–10             ${m.windows.width4to10}`);
  console.log(`    רוחב 11+              ${m.windows.wider}`);
  console.log(`    לא חסום               ${m.windows.unbounded}`);
}

/**
 * פירוט יחידה-יחידה. זה הדוח שאומר **אילו** ד"ה נכשלים, ולא רק כמה — ובקטגוריה הזאת השאלה
 * היא כמעט תמיד אורך הד"ה, ולכן הוא מוצג לצד כל שורה.
 */
function reportUnits(units: LinkUnit[], commentaryLines: string[]): void {
  console.log('\n  שורה  יעד  מקור-הקישור  מילות ד"ה  הטקסט');
  units.forEach((u, i) => {
    const raw = commentaryLines[u.lineIdx1 - 1] || '';
    const kind = u.target === null ? 'נכשל ' : u.inherited ? 'ירושה' : 'עוגן ';
    const w = windowForUnit(units, i).width;
    const win = u.target !== null && !u.inherited ? '' : `  [חלון ${w === null ? '∞' : w}]`;
    console.log(
      `  ${String(u.lineIdx1).padStart(4)}  ${String(u.target ?? '—').padStart(3)}  ${kind}` +
      `  ${String(dhWordCount(raw)).padStart(6)}     ${raw.replace(/<[^>]*>/g, '').slice(0, 44)}${win}`
    );
  });
}

/**
 * הדוח שעונה על השאלה "איזו הגמשה תעזור": התפלגות **הכישלונות** לפי אורך הד"ה ולפי רוחב
 * החלון. שתי העמודות יחד מפרידות בין שני סוגי כישלון שהטיפול בהם הפוך:
 *
 *   ד"ה קצר בחלון צר   → אין די ראיה, והחלון כבר עשה את שלו. הרפיה נוספת תעזור.
 *   ד"ה ארוך בחלון רחב → יש ראיה ולא נמצאה התאמה. הרפיה לא תעזור; זו בעיית התאמה.
 */
function reportFailures(units: LinkUnit[], commentaryLines: string[]): void {
  const buckets = new Map<string, { n: number; bounded: number; narrow: number }>();
  let total = 0;

  units.forEach((u, i) => {
    if (u.target !== null) return;
    total++;
    const words = dhWordCount(commentaryLines[u.lineIdx1 - 1] || '');
    const key = words >= 6 ? '6+' : String(words);
    const w = windowForUnit(units, i).width;
    const b = buckets.get(key) || { n: 0, bounded: 0, narrow: 0 };
    b.n++;
    if (w !== null) b.bounded++;
    if (w !== null && w <= 3) b.narrow++;
    buckets.set(key, b);
  });

  if (total === 0) { console.log('\n  אין כישלונות.'); return; }
  console.log(`\n  כישלונות לפי אורך הד"ה  (סה"כ ${total})`);
  console.log('  מילות ד"ה   כמה      חלון חסום   חלון ≤3');
  [...buckets.entries()]
    .sort((a, b) => (a[0] === '6+' ? 99 : +a[0]) - (b[0] === '6+' ? 99 : +b[0]))
    .forEach(([k, b]) => {
      const pct = Math.round((b.n / total) * 1000) / 10;
      console.log(`  ${k.padStart(8)}   ${String(b.n).padStart(5)} (${String(pct).padStart(4)}%)  ${String(b.bounded).padStart(8)}   ${String(b.narrow).padStart(6)}`);
    });
}

/** אורך הד"ה כפי שהפרופיל ההלכתי רואה אותו — אחרי חיתוך המספור ועד לאסימון הסיום. */
function dhWordCount(raw: string): number {
  const stripped = stripHalachaNumbering(raw).replace(/<[^>]*>/g, '').trim();
  const cut = findDhBoundary(stripped);
  const dh = cut === null ? stripped : stripped.slice(0, cut);
  return dh.trim().split(/\s+/).filter(Boolean).length;
}

export function runOn(
  label: string,
  commentaryRaw: string,
  sourceRaw: string,
  mode?: HalachaPieceMode
): Metrics {
  const config: PluginConfig = {
    sourceCategory: 'halacha',
    targetBookName: 'שולחן ערוך, אורח חיים',
    ignoreShamInShas: false,
    diburHamatchilDelimiter: '',
    useAbbreviationExpansion: true,
    useFuzzyMatching: true,
    useWordWeighting: true,
    ...(mode === 'single-line' ? { halachaMultiLinePieces: false } : {}),
    ...(mode === 'multi-line' ? { halachaSeifKatan: false } : {})
  } as PluginConfig;

  const res = runLinkingParser(commentaryRaw, sourceRaw, config);
  const units = buildLinkUnits(res.commentaryLines, res.links, profileForConfig(config));
  const m = measure(units);
  report(label, m);
  if (argv.includes('--units')) reportUnits(units, res.commentaryLines);
  if (argv.includes('--failures')) reportFailures(units, res.commentaryLines);
  return m;
}

/* ── קורפוס סינתטי ────────────────────────────────────────────────────────────────────────
 *
 * שני סימנים. הראשון "נקי" — כל ס"ק פותח בציטוט מפוסק מלשון השו"ע. השני מדגים בכוונה את
 * המצב שהתוכנית באה לפתור: ד"ה בני מילה ושתיים, שרובם אינם נמצאים היום. שני הסימנים יחד
 * הופכים את הדוח לבסיס-השוואה שאפשר להריץ אחרי כל מעבר שייכנס.
 */
export const SYNTHETIC_SOURCE = [
  '<h3>סימן א</h3>',
  'יתגבר כארי לעמוד בבוקר לעבודת בוראו שיהא הוא מעורר השחר',
  'המשכים לקום קודם אור הבוקר ראוי לו לומר דברי תחנונים',
  'שויתי הוי לנגדי תמיד הוא כלל גדול בתורה ובמעלות הצדיקים',
  'וכן ראוי לאדם להתבונן במעשיו קודם שיתחיל בעבודת היום',
  'טוב מעט תחנונים בכוונה מהרבות בלא כוונה',
  '<h3>סימן ב</h3>',
  'לא יאכל אדם קודם שיתפלל תפילת שחרית ואפילו טעימה בעלמא',
  'ולא ישתה קודם התפילה זולת מים שאין בהם משום גאוה',
  'ומי שהוא חלוש בטבעו מותר לו לטעום קודם התפילה',
  'ובשבת נהגו להקל יותר מפני כבוד היום והשמחה',
  'וכל זה בתפילת שחרית אבל במנחה אין להחמיר כל כך'
].join('\n');

export const SYNTHETIC_COMMENTARY = [
  '<h3>סימן א</h3>',
  '(א) יתגבר כארי לעמוד - כלומר שיזרז עצמו ולא יתעצל',
  'וכבר כתבו הראשונים שאין זה חיוב גמור אלא מידת חסידות',
  '(ב) שויתי הוי לנגדי - הוא מיסודי האמונה',
  'ומכאן למדו שצריך אדם לשום דרכיו תמיד',
  '(ג) טוב מעט תחנונים - שהכוונה עיקר',
  '<h3>סימן ב</h3>',
  '(א) לא יאכל - ואפילו פחות מכשיעור',
  '(ב) ולא ישתה - זולת מים',
  '(ג) חלוש - היינו שאין דעתו מיושבת עליו',
  '(ד) ובשבת - מפני כבוד היום',
  '(ה) במנחה - דלא חמירא כשחרית'
].join('\n');

if (process.argv[1] && process.argv[1].includes('halacha.metrics')) {
  const commentaryPath = flag('--commentary');
  const sourcePath = flag('--source');
  const mode = flag('--mode') as HalachaPieceMode | undefined;

  const m = commentaryPath && sourcePath
    ? runOn(
        `${commentaryPath} → ${sourcePath}`,
        fs.readFileSync(commentaryPath, 'utf8'),
        fs.readFileSync(sourcePath, 'utf8'),
        mode
      )
    : runOn('קורפוס סינתטי', SYNTHETIC_COMMENTARY, SYNTHETIC_SOURCE, mode);

  if (argv.includes('--json')) console.log('\n' + JSON.stringify(m, null, 2));
  console.log('');
}
