/**
 * מסנן את העוגנים שהמנוע יצר ומשאיר **רק את החשודים** — אלה שמילות הד"ה שלהם אינן נמצאות
 * במלואן בשורת המקור שאליה קושרו.
 *
 *   node --import tsx qa/halacha.suspects.ts --commentary A --source B [--out FILE] [--mode M]
 *
 * המבחן הוא מילולי בכוונה: כל מילה מן הד"ה מחופשת כמות שהיא בשורת היעד, אחרי נורמליזציה בלבד.
 * זהו **המבחן שהקורא האנושי עושה** — "האם הד"ה באמת כתוב שם" — והוא נבחר מפני שהוא היחיד שאינו
 * נשען על אותו מנגנון שיצר את הקישור מלכתחילה, ולכן הוא יכול לסתור אותו.
 *
 * **מה שהוא אינו:** הוכחה לשגיאה. המנוע מתאים גם בהרחבת ראשי תיבות ובדמיון מטושטש, ולכן עוגן
 * נכון לגמרי יכול להיראות כאן חסר — הפרשן כתב "הרמב"ם" והמקור "הרמב'ם", או ניקד אחרת. לכן
 * הקובץ מסודר מן החשוד ביותר לפחות: קודם מי שאין לו ולו מילה אחת משותפת עם שורת היעד, ובכל
 * קבוצה — הוודאות הגבוהה תחילה, שכן ודאות גבוהה עם חפיפה אפסית היא הצירוף שהכי כדאי לבדוק.
 *
 * לכל חשוד נכתבות שורת המקור **המלאה** (בלי החיתוך שב-halacha.anchors.ts) ורשימת המילים
 * החסרות, שהן שתי העובדות שצריך כדי להכריע בלי לפתוח את הספר.
 */
import fs from 'fs';
import {
  runLinkingParser,
  buildLinkUnits,
  windowForUnit,
  isHeaderLine,
  extractHeaderTitle,
  normalizeText,
  stripHtmlTags
} from '../src/utils/parserAlgorithm';
import { profileForConfig, HalachaPieceMode } from '../src/utils/halachaAlgorithm';
import { PluginConfig } from '../src/types';

const argv = process.argv.slice(2);
const flag = (n: string) => { const i = argv.indexOf(n); return i !== -1 && argv[i + 1] ? argv[i + 1] : undefined; };

const commentaryPath = flag('--commentary');
const sourcePath = flag('--source');
const outPath = flag('--out') || 'qa/data/suspects.txt';
const mode = flag('--mode') as HalachaPieceMode | undefined;

if (!commentaryPath || !sourcePath) {
  console.error('usage: --commentary FILE --source FILE [--out FILE] [--mode M]');
  process.exit(1);
}

const config: PluginConfig = {
  sourceCategory: 'halacha',
  targetBookName: '',
  ignoreShamInShas: false,
  diburHamatchilDelimiter: '',
  useAbbreviationExpansion: true,
  useFuzzyMatching: true,
  useWordWeighting: true,
  ...(mode === 'single-line' ? { halachaMultiLinePieces: false } : {}),
  ...(mode === 'multi-line' ? { halachaSeifKatan: false } : {})
} as PluginConfig;

const res = runLinkingParser(
  fs.readFileSync(commentaryPath, 'utf8'),
  fs.readFileSync(sourcePath, 'utf8'),
  config
);

const profile = profileForConfig(config);
const units = buildLinkUnits(res.commentaryLines, res.links, profile);
const byLine = new Map(res.links.map(l => [l.line_index_1, l]));

/** כותרת הסגמנט שהשורה יושבת בו, לפי הכותרת האחרונה שקדמה לה. */
const headerFor = new Map<number, string>();
{
  let cur = '';
  res.commentaryLines.forEach((l, i) => {
    if (isHeaderLine(l, profile)) cur = extractHeaderTitle(l);
    headerFor.set(i + 1, cur);
  });
}

const clean = (s: string) => (s || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
const words = (s: string) => normalizeText(stripHtmlTags(s || ''), false).split(' ').filter(Boolean);

interface Suspect {
  n: number;
  commLine: number;
  target: number;
  conf: number;
  width: number | null;
  header: string;
  dh: string;
  missing: string[];
  ratio: number;
  srcLine: string;
  commLine_: string;
}

const suspects: Suspect[] = [];
let anchors = 0;

units.forEach((u, i) => {
  if (u.target === null || u.inherited) return;
  anchors++;
  const link = byLine.get(u.lineIdx1)!;
  const dw = words(link.dhText || '');
  if (!dw.length) return;
  const sw = new Set(words(res.sourceLines[u.target - 1] || ''));
  const missing = dw.filter(w => !sw.has(w));
  if (!missing.length) return;
  suspects.push({
    n: anchors,
    commLine: u.lineIdx1,
    target: u.target,
    conf: link.confidence ?? 0,
    width: windowForUnit(units, i).width,
    header: headerFor.get(u.lineIdx1) || '',
    dh: clean(link.dhText || ''),
    missing,
    ratio: (dw.length - missing.length) / dw.length,
    srcLine: clean(res.sourceLines[u.target - 1] || ''),
    commLine_: clean(res.commentaryLines[u.lineIdx1 - 1] || '')
  });
});

/** מן החשוד ביותר לפחות; ובתוך אותה רמת חפיפה — הוודאות הגבוהה קודם. */
suspects.sort((a, b) => a.ratio - b.ratio || b.conf - a.conf);

const bucketOf = (r: number) =>
  r === 0 ? 'אף מילה משותפת' : r < 0.34 ? 'מיעוט המילים' : r < 0.67 ? 'כמחצית המילים' : 'רוב המילים';

const out: string[] = [
  `עוגנים חשודים — ${commentaryPath} → ${sourcePath}`,
  `מבנה: ${mode || 'seif-katan'}`,
  '',
  `${suspects.length} חשודים מתוך ${anchors} עוגנים (${(suspects.length / anchors * 100).toFixed(1)}%).`,
  '',
  'חשוד = מילה אחת או יותר מן הד"ה אינה מופיעה מילולית בשורת המקור שאליה קושר.',
  'זו אינה הוכחה לשגיאה: המנוע מתאים גם בראשי תיבות ובדמיון מטושטש, וכתיב שונה נראה כאן כחסר.',
  'הסדר: מן החפיפה הנמוכה לגבוהה, ובכל רמה — הוודאות הגבוהה תחילה.',
  '='.repeat(100),
  ''
];

let lastBucket = '';
suspects.forEach((s, idx) => {
  const bucket = bucketOf(s.ratio);
  if (bucket !== lastBucket) {
    const count = suspects.filter(x => bucketOf(x.ratio) === bucket).length;
    out.push('', '█'.repeat(3) + ` ${bucket} — ${count} עוגנים ` + '█'.repeat(Math.max(0, 60 - bucket.length)), '');
    lastBucket = bucket;
  }
  out.push(
    `[${String(idx + 1).padStart(4)}]  ${s.header}   |   פירוש ${s.commLine}  →  מקור ${s.target}   ${s.conf}%` +
      (s.width !== null ? `   חלון ${s.width}` : ''),
    `        ד"ה    : ${s.dh}`,
    `        חסרות  : ${s.missing.join(' · ')}`,
    `        מקור   : ${s.srcLine}`,
    `        הפירוש : ${s.commLine_.slice(0, 400)}`,
    ''
  );
});

fs.writeFileSync(outPath, out.join('\n'), 'utf8');
console.log(`wrote ${suspects.length} suspects (of ${anchors} anchors) to ${outPath}`);
