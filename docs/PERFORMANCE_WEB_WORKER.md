# הצעה 3 · העברת האלגוריתם לחוט רקע

הרחבה של סעיף "הצעה 3" ב-[`PERFORMANCE_TIER1.md`](PERFORMANCE_TIER1.md): מה בדיוק צריך
לקרות ב-`App.tsx` וב-`SetupMode.tsx`, מה מוכח, מה נמדד — ומה עדיין לא ידוע.

| | |
|---|---|
| **נמדד על** | עותק **קפוא** של `src`, כי `parserAlgorithm.ts` נערך במקביל (ראו למטה) |
| **חתימת המנוע שנמדד** | `4826adf3e67ffe756c166834ae6ca366  src/utils/parserAlgorithm.ts` |
| **הכלים** | `wsim/clone-fidelity.mts`, `wsim/field-loss.mts` (בתיקיית העבודה הזמנית) |
| **תוצאה** | גבול החוטים שקוף: **620 קישורים, פלט זהה בית-בבית**, עלות מסירה 392ms |
| **המחיר** | הקובץ הבנוי גדל מ-1,439,122 ל-**2,364,558 בתים** (+64%) |

---

## עבודה במקביל לסוכן אחר

בזמן המדידות `src/utils/parserAlgorithm.ts` היה **בעריכה פעילה** — הסוכן האחר הכניס אליו
את מנגנון ה-SWDH (דיבור המתחיל בן מילה אחת), 144 שורות שבאותו רגע טרם נכנסו לגיט,
ובמקביל הוקלטו מחדש שלושה מקרי בדיקה:

```
 M src/utils/parserAlgorithm.ts                    +144 שורות (SWDH)
 M qa/snapshots/FULL__py-berachot.json
 M qa/snapshots/FULL__py-shabbat.json
 M qa/snapshots/benyehoyada-berachot__default.json
```

לכן כל המדידות כאן נעשו על **עותק קפוא** של `src`, עם חתימות MD5 שנרשמו לפני ההרצה —
אותה שיטה של [`qa/perf/drift.mjs`](../qa/perf/drift.mjs). שום קובץ ב-`src/` לא שונה לצורך
המסמך הזה.

> העבודה ההיא נכנסה מאז כקומיט `86272ca` ("עוגן מילה ראשונה — ד"ה בן מילה אחת מקבל
> קישור"), והעותק הקפוא שנמדד כאן זהה לו. כלומר המספרים למטה מתארים את המנוע כפי שהוא
> ב-`main` עכשיו, ולא גרסת ביניים חולפת.

> **הערה על המספרים.** מכיוון שהמנוע שנמדד כולל כבר את שינויי ה-SWDH,
> `FULL/py-berachot` מחזיר כאן **620** קישורים ולא 611/615 כמו ב-`PERFORMANCE_TIER1.md`.
> זה לא רלוונטי לשאלה הנבדקת: ההשוואה כאן היא תמיד של אותו מנוע מול עצמו, משני צדי
> גבול החוטים.

---

## חלק א' · מה נמדד, ומה מעצם טבעו לא ניתן למדוד כאן

הצעה 3 שונה מהצעה 1: היא לא מקצרת חישוב, ולכן "לפני/אחרי" בשניות הוא לא המבחן שלה.
היא מתפרקת לשלוש טענות נפרדות, ורק שתיים מהן ניתנות לבדיקה מחוץ לדפדפן:

| הטענה | ניתן לאמת ב-Node? | מה נעשה |
|---|---|---|
| **הפלט זהה** אחרי המעבר לחוט נפרד | **כן** | נמדד — `worker_threads` משתמש באותו אלגוריתם שכפול מובנה (structured clone) של הדפדפן |
| **המחיר בגודל הקובץ** של הבנייה לקובץ יחיד | **כן** | נמדד — שתי בניות אמיתיות |
| **המסך אכן מגיב** תוך כדי ריצה | **לא** | דורש הרצה באוצריא. מה בדיוק לבדוק — בחלק ז' |

הטענה השלישית היא היחידה שנשארת פתוחה, והיא גם היחידה שהיא **חוויית משתמש ולא נכונות**:
אם היא תיכשל, לא ייווצר קישור שגוי — פשוט לא נרוויח דבר.

---

## חלק ב' · מה קורה היום

### הקפאה

[`src/App.tsx:106`](../src/App.tsx#L106) קורא ל-`runLinkingParser` ישירות. הקריאה הזו היא
משימה סינכרונית אחת של החוט הראשי. כל עוד היא רצה, הדפדפן לא מצייר, לא מגיב ולא מנפיש.

### הספינר שלא יכול להופיע — ולו לרגע

ב-[`SetupMode.tsx:499-506`](../src/components/SetupMode.tsx#L499) יש שכבת המתנה מלאה,
עם ספינר מסתובב והכיתוב "הרצת האלגוריתם...". היא **לעולם אינה נראית**. הסיבה נמצאת
ב-[`handleRun`](../src/components/SetupMode.tsx#L343):

```tsx
setIsProcessing(true);          // ①  בקשת עדכון מצב — עוד לא צויר כלום
try {
  ...
  onRunAlgorithm(...);          // ②  סינכרוני — 11 שניות של חוט תפוס
} finally {
  setIsProcessing(false);       // ③  עדכון מצב שני, באותה משימה בדיוק
}
```

React מאגד את ① ואת ③ לתוך אותו סבב עדכון, ולכן `isProcessing` עולה ויורד בלי שאף פריים
צויר בין לבין. המשתמש רואה מסך קפוא, ואז — מאוחר — מצב עריכה. **זו לא תקלה בעיצוב אלא
תוצאה ישירה של הקריאה הסינכרונית**, וכל תיקון שאינו משחרר את החוט לא יוכל לפתור אותה.

מכאן נובע דבר חשוב: הקוד של שכבת ההמתנה כבר קיים. הצעה 3 לא בונה אותה — היא רק גורמת לה
להיות ניתנת לציור.

---

## חלק ג' · הארכיטקטורה המוצעת

שלושה קבצים נוגעים בשינוי, ואף אחד מהם אינו קובץ המנוע.

```
src/parser.worker.ts        ← חדש · העטיפה שרצה בחוט הרקע
src/utils/runParserAsync.ts ← חדש · הפרוטוקול, הביטול, והנפילה לאחור
src/App.tsx                 ← 30 שורות משתנות
src/components/SetupMode.tsx← 6 שורות משתנות
```

`src/utils/parserAlgorithm.ts`, `src/data/abbreviations.ts` ו-`src/utils/fuzzyUtils.ts`
**אינם נפתחים כלל.** זה חשוב במיוחד השבוע, כשקובץ המנוע נמצא תחת עריכה פעילה: השינוי
הזה לא מתנגש עם עבודת ה-SWDH ולו בשורה אחת.

### הקובץ שרץ בחוט הרקע

```ts
// src/parser.worker.ts
/// <reference lib="webworker" />
import { runLinkingParser } from './utils/parserAlgorithm';
import type { PluginConfig } from './types';

export interface ParserRequest {
  runId: number;
  commentaryText: string;
  sourceText: string;
  config: PluginConfig;
  rashiText?: string;
  tosafotText?: string;
  rashiLinks?: any[];
  tosafotLinks?: any[];
}

export type ParserResult = ReturnType<typeof runLinkingParser>;

self.onmessage = (e: MessageEvent<ParserRequest>) => {
  const req = e.data;
  // אישור קבלה: מפריד בין "החוט לא עלה בכלל" (CSP) לבין "האלגוריתם נכשל".
  (self as any).postMessage({ runId: req.runId, type: 'ack' });
  try {
    const parsed = runLinkingParser(
      req.commentaryText, req.sourceText, req.config,
      req.rashiText, req.tosafotText, req.rashiLinks, req.tosafotLinks
    );
    (self as any).postMessage({ runId: req.runId, type: 'done', parsed });
  } catch (err) {
    (self as any).postMessage({
      runId: req.runId, type: 'error',
      message: err instanceof Error ? err.message : String(err)
    });
  }
};
```

זה כל מה שרץ שם. שימו לב למה שאין בו: אין עיבוד של הקלט, אין בנייה מחדש של האובייקטים,
אין ברירות מחדל. הבקשה מועברת לפונקציה **כפי שהגיעה**. הסיבה בחלק ה'.

### הפרוטוקול והנפילה לאחור

```ts
// src/utils/runParserAsync.ts
import ParserWorker from '../parser.worker?worker&inline';
import { runLinkingParser } from './parserAlgorithm';
import type { ParserRequest, ParserResult } from '../parser.worker';

export const CANCELLED = Symbol('parser-cancelled');
export interface ParserHandle {
  promise: Promise<ParserResult>;
  cancel: () => void;
}

let nextRunId = 1;
type Req = Omit<ParserRequest, 'runId'>;

const runHere = (r: Req): ParserResult => runLinkingParser(
  r.commentaryText, r.sourceText, r.config,
  r.rashiText, r.tosafotText, r.rashiLinks, r.tosafotLinks
);

export function runParserAsync(req: Req): ParserHandle {
  let worker: Worker | null = null;
  try {
    worker = new ParserWorker();
  } catch {
    worker = null;               // אין Worker / חסום — נטפל למטה
  }

  // נתיב הנפילה לאחור: בדיוק ההתנהגות של היום, לא פחות טובה ממנה.
  if (!worker) {
    return { promise: Promise.resolve().then(() => runHere(req)), cancel: () => {} };
  }

  const w = worker;
  const runId = nextRunId++;
  let acked = false;
  let settled = false;

  const promise = new Promise<ParserResult>((resolve, reject) => {
    const finish = (fn: () => void) => { settled = true; w.terminate(); fn(); };

    w.onmessage = (e: MessageEvent<any>) => {
      const msg = e.data;
      if (msg.runId !== runId || settled) return;   // תשובה של ריצה שכבר בוטלה
      if (msg.type === 'ack') { acked = true; return; }
      if (msg.type === 'done') finish(() => resolve(msg.parsed));
      else finish(() => reject(new Error(msg.message)));
    };

    // כשל שאינו בא מהאלגוריתם: החוט לא עלה (CSP חוסם blob:), קובץ פגום וכו'.
    // אם זה קרה לפני שהתקבל ack — לא מציגים שגיאה למשתמש, פשוט מריצים כאן.
    w.onerror = () => {
      if (settled) return;
      if (!acked) finish(() => { try { resolve(runHere(req)); } catch (e) { reject(e); } });
      else finish(() => reject(new Error('שגיאה בחוט הרקע')));
    };

    w.postMessage({ runId, ...req });
  });

  return {
    promise,
    cancel: () => { if (!settled) { settled = true; w.terminate(); } }
  };
}
```

**שלוש החלטות שכדאי לשים לב אליהן:**

1. **חוט חדש לכל ריצה, ו-`terminate()` בסיום.** לא מחזיקים חוט חי. זה נותן ביטול אמיתי
   בחינם, ומשחרר את המטמונים חסרי-החסם של המנוע (`targetIndexCache`,
   `expansionPlanCache`, `cleanKeyCache`) במקום לתת להם להצטבר לאורך כל חיי התוסף.
   העלות — עליית החוט — נמדדה: ראו חלק ה'.
2. **`runId` בכל הודעה.** אם המשתמש חוזר להגדרות ומריץ שוב, התשובה של הריצה הישנה
   עלולה להגיע אחרי החדשה. בלי המזהה, המסך היה מתמלא בתוצאה שהמשתמש כבר נטש.
3. **`ack` מפריד בין שני סוגי כשל.** חוט שלא עלה בכלל → מריצים בחוט הראשי כאילו כלום,
   והמשתמש רואה בדיוק את מה שהוא רואה היום. אלגוריתם שקרס → הודעת שגיאה, כמו היום.

---

## חלק ד' · הממצא שקובע אם זה אפשרי כאן: הבנייה לקובץ יחיד

זה החלק שלא מופיע ב-`PERFORMANCE_TIER1.md`, והוא המכשול האמיתי של ההצעה.

הפרויקט נבנה עם [`viteSingleFile()`](../vite.config.ts), ו-[`pack-plugin.js`](../scripts/pack-plugin.js)
אורז לתוך ה-`.otzplugin` **שני קבצים בלבד**: `manifest.json` ו-`dist/index.html`.

מכאן: הכתיבה הרגילה של Worker —

```ts
new Worker(new URL('./parser.worker.ts', import.meta.url), { type: 'module' })
```

— יוצרת **קובץ נפרד** בזמן בנייה. הוא לא יוטמע ב-HTML, הוא לא ייארז לתוך התוסף, והוא
פשוט לא יימצא אצל המשתמש. הגרוע מכל: **ב-`npm run dev` זה יעבוד מצוין**, כי בפיתוח
Vite מגיש את הקובץ כמודול אמיתי. התקלה תתגלה רק בתוסף הארוז.

### הפתרון: `?worker&inline`

```ts
import ParserWorker from '../parser.worker?worker&inline';
```

בדקתי מה Vite באמת פולט עבור הצורה הזו ([`vite/dist/node/chunks/dep-Dm0c1Wj2.js`](../node_modules/vite/dist/node/chunks/)):

```js
const blob = new Blob([jsContent], { type: "text/javascript;charset=utf-8" });
export default function WorkerWrapper(options) {
  try {
    objURL = (self.URL || self.webkitURL).createObjectURL(blob);
    const worker = new Worker(objURL, { name: options?.name });
    ...
  } catch (e) {
    return new Worker('data:text/javascript;charset=utf-8,' + encodeURIComponent(jsContent), ...);
  }
}
```

שלוש עובדות שנובעות מזה ישירות:

- **הכול נכנס לקובץ אחד.** קוד החוט מוטמע כמחרוזת ונבנה כ-Blob בזמן ריצה. אומת בבנייה
  אמיתית: `dist/` הכיל רק `index.html`, בלי שום נכס נוסף.
- **יש נפילה לאחור מובנית ל-`data:`** אם `createObjectURL` נכשל — עוד שכבת הגנה מעל זו
  שכתבנו.
- **בבנייה זהו Worker קלאסי, לא מודול.** ברירת המחדל של `worker.format` היא `iife`,
  ולכן `type: "module"` לא נפלט. זו דווקא בשורה טובה לתוסף שרץ בתוך WebView: תמיכה
  ב-module workers מאוחרת בהרבה מתמיכה ב-workers רגילים. (בפיתוח, לעומת זאת, זה כן
  module worker — עוד סיבה לא להסתמך על `npm run dev` כהוכחה.)

### המחיר בגודל — נמדד

שתי בניות אמיתיות, אותו מקור, דקה זו מזו:

| | `dist/index.html` | gzip |
|---|---|---|
| היום | 1,439,122 בתים | 340.00 kB |
| עם חוט הרקע | **2,364,558 בתים** | 535.38 kB |
| הפרש | **+925,436 (+64%)** | +195 kB (+57%) |

**למה הכפילות בלתי נמנעת.** המחשבה הראשונה היא "נסיר את `runLinkingParser` מ-`App.tsx`,
והמנוע יישאר רק בחוט". זה לא עוזר, כי המנוע נגרר לחבילה הראשית ממקום אחר:
[`findSourceMatchRange`](../src/utils/parserAlgorithm.ts#L2621) — שבו משתמשים
`EditMode` ו-`inheritanceChain` — קורא ל-`NORMALIZED_ABBREVIATIONS_MAP`, וכך גורר את
`abbreviations.ts` כולו (1.22MB מקור, רוב מוחלט של המשקל). גם `TopToolbar`,
`EditLinkModal` ו-`AbbreviationsModal` נשענים על אותם מודולים. **מצב העריכה זקוק למילון
ראשי התיבות בדיוק כמו המנוע** — ולכן הוא יישאר בחוט הראשי בכל מקרה.

**וזו בדיוק הסיבה שנתיב הנפילה לאחור הוא בחינם.** מכיוון שהמנוע ממילא נמצא בחבילה
הראשית, השארת הקריאה הסינכרונית כרשת ביטחון אינה מוסיפה בתים משמעותיים. המדידה למעלה
נעשתה בדיוק בתצורה המומלצת — עם שני הנתיבים.

### תופעת לוואי על גודל ה-`.otzplugin`

[`pack-plugin.js`](../scripts/pack-plugin.js) קורא ל-`zip.generateAsync({ type: 'nodebuffer' })`
בלי לציין דחיסה, וברירת המחדל של JSZip היא `STORE` — כלומר **בלי דחיסה בכלל**. אפשר
לראות את זה בקבצים עצמם: ה-`.otzplugin` שוקל 1,438,947 בתים וה-HTML שבתוכו 1,439,122.
לכן התוסף יגדל ל-~2.36MB.

תיקון של שורה אחת, שאינו קשור להצעה הזו אבל משנה את התמונה:

```js
await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
```

לפי מדד ה-gzip שלמעלה, זה יביא את התוסף לכ-0.5MB — **קטן משמעותית ממה שהוא היום**, גם
אחרי הוספת חוט הרקע.

---

## חלק ה' · מה עובר בין החוטים — וכמה זה עולה

### הסימולציה

הטענה "הפלט לא ישתנה" מתחלקת לשניים. שהאלגוריתם לא ישתנה — ברור, לא נוגעים בו. החלק
שאינו מובן מאליו הוא **גבול הסריאליזציה**: ההגדרות נכנסות דרכו, התוצאה יוצאת דרכו.

`worker_threads` של Node משתמש באותו אלגוריתם שכפול מובנה של הדפדפן, ולכן אפשר לבדוק את
הגבול הזה במלואו בלי דפדפן. זה מה ש-`clone-fidelity.mts` עושה: מריץ את אותו קלט פעמיים —
פעם בתהליך, ופעם דרך חוט אמיתי — ומשווה.

```
  case: FULL/py-berachot · config = gs-dictionary
  dictionary: 13111 abbreviations, 17 replacements
  payload in: 1664 KB of text + 1.07 MB of dictionary

  A · main thread      links=620  10.86s
  B · worker thread    links=620  11.04s wall  (compute 10.64s · handoff+startup 392ms)

  1. config across the boundary   ✔ every field arrived intact
  2. result deep-compare          ✔ IDENTICAL (undefined / NaN / key-order aware)
  3. serialized byte-compare      ✔ identical (2018 KB of result)
  4. caller's config untouched    ✔ unchanged
  5. per-link landing site        ✔ all 620 links land identically
```

ההשוואה מכוונת לתפוס גם את מה ש-`JSON.stringify` מסתיר: שדה שקיים עם ערך `undefined`
מול שדה חסר, `NaN`, `-0`, וגם **סדר מפתחות**. בדיקה 5 היא זו של
[`qa/perf/shift.ts`](../qa/perf/shift.ts) — ספירה זהה לא מוכיחה כלום, השאלה היא לאן כל
קישור נחת. גם המקרה המהיר (12 מקטעים, 72 קישורים) עבר במלואו.

**עלות המסירה: 392ms** מתוך 11 שניות — וזה כולל את עליית החוט ואת טעינת המודולים,
לא רק את השכפול. שני הכיוונים יחד. אין צורך ב-Transferables: מחרוזות לא ניתנות להעברה
ממילא, והמחיר כאן אינו מצדיק זאת.

### הכלל: להעביר את הבקשה כמות שהיא

[`types.ts:41`](../src/types.ts#L41) מגדיר את `PluginConfig` בלי שני שדות ש-
[`SetupMode.tsx:388-390`](../src/components/SetupMode.tsx#L388) מעביר בפועל:
`gsAbbreviations` ו-`gsReplacements`. הם נקראים ב-`parserAlgorithm.ts` בארבעה מקומות
(שורות 1167, 1190, 1480, 1728-1734). היום הם נוסעים בחינם, כי האובייקט עובר ישירות.

הסכנה ברורה: מי שיבנה את הודעת ה-`postMessage` "כמו שצריך", שדה-שדה לפי הטיפוס
המוצהר — ישמיט אותם, ו-TypeScript יאשר לו. לכן העטיפה בחלק ג' מעבירה את הבקשה כמו
שהיא ולא בונה אותה מחדש.

**כמה זה באמת מסוכן?** מדדתי גם את זה (`field-loss.mts`) — והתשובה מרסנת את האזהרה:

```
  dropping gsAbbreviations + gsReplacements from the worker message
  with them (today)   links=620        without them   links=620
  identical output    ✔ yes            links moved    0
```

בשני המקרים שנבדקו ההשמטה לא שינתה דבר, משום ש-`customAbbreviations` נושא ממילא את אותו
מילון, ו-17 ההחלפות של `gsReplacements` לא נדלקו על ברכות. כלומר: הכלל נכון וכדאי לשמור
עליו — אבל הוא הגנה מפני נזק **אפשרי**, לא מפני נזק שנצפה.

---

## חלק ו' · השינויים המדויקים

### `App.tsx`

```diff
-import { runLinkingParser } from './utils/parserAlgorithm';
+import { runParserAsync, type ParserHandle } from './utils/runParserAsync';
```

```diff
-  const handleRunAlgorithm = (
+  const runRef = useRef<ParserHandle | null>(null);
+
+  const handleRunAlgorithm = async (
     commentaryText: string, commentaryTitle: string, config: PluginConfig,
     sourceText: string, rashiText?: string, tosafotText?: string,
     rashiLinks?: any[], tosafotLinks?: any[]
-  ) => {
+  ): Promise<void> => {
     try {
-      const parsed = runLinkingParser(
-        commentaryText, sourceText, config, rashiText, tosafotText, rashiLinks, tosafotLinks
-      );
+      runRef.current?.cancel();
+      const handle = runParserAsync({
+        commentaryText, sourceText, config, rashiText, tosafotText, rashiLinks, tosafotLinks
+      });
+      runRef.current = handle;
+      const parsed = await handle.promise;
+      runRef.current = null;

       const sessionId = `session_${Date.now()}`;
       ...                                    // ← כל בניית ה-SessionState נשארת מילה במילה
       notifySuccess(`אלגוריתם המיפוי הופעל בהצלחה: נוצרו ${parsed.links.length} קישורים`);
     } catch (e) {
       console.error(e);
       notifyError('אירעה שגיאה בעת הרצת האלגוריתם');
     }
   };
+
+  const handleCancelRun = () => { runRef.current?.cancel(); runRef.current = null; };
```

ובהרכבה:

```diff
-        <SetupMode onRunAlgorithm={handleRunAlgorithm} />
+        <SetupMode onRunAlgorithm={handleRunAlgorithm} onCancelRun={handleCancelRun} />
```

בניית ה-`SessionState`, הודעת ההצלחה, טיפול השגיאה ומעבר המצב — כולם נשארים כפי שהם.
ההבדל היחיד הוא ש-`parsed` מגיע מ-`await` במקום מקריאה ישירה.

### `SetupMode.tsx`

שינוי הטיפוס, ההמתנה, וכפתור הביטול:

```diff
 interface SetupModeProps {
-  onRunAlgorithm: (...) => void;
+  onRunAlgorithm: (...) => void | Promise<void>;
+  onCancelRun?: () => void;
 }
```

```diff
-      onRunAlgorithm(
+      await onRunAlgorithm(
         commentaryContent, selectedBookTitle, config, sourceText,
         rashiText, tosafotText, rashiLinks, tosafotLinks
       );
     } catch (err) { ... } finally {
       setIsProcessing(false);
     }
```

ה-`await` הוא הלב: בלעדיו ה-`finally` יכבה את שכבת ההמתנה מיד, והמסך יישאר ריק בזמן
שהחוט האחורי עובד. איתו — `isProcessing` נשאר `true` לאורך כל הריצה, ובפעם הראשונה
הספינר שכבר קיים בקוד באמת מסתובב.

בתוך שכבת ההמתנה הקיימת ([שורה 499](../src/components/SetupMode.tsx#L499)), אחרי הכיתוב:

```diff
       <span className="text-sm font-bold ...">הרצת האלגוריתם...</span>
+      {onCancelRun && (
+        <button type="button" onClick={() => { onCancelRun(); setIsProcessing(false); }}
+          className="px-4 py-1.5 text-xs font-semibold rounded-[var(--radius-pill)]
+                     border border-[var(--color-outline)] text-[var(--color-on-surface)]
+                     hover:bg-[var(--color-secondary-subtle)] transition-colors">
+          ביטול
+        </button>
+      )}
```

---

## חלק ז' · ביטול, התקדמות, ומה שעדיין יקפיא

### ביטול — בחינם

`worker.terminate()` עוצר את החישוב מיד, באמצע לולאה, בלי שיתוף פעולה מהאלגוריתם. זה
בלתי אפשרי היום בשום צורה. בגרסה הנוכחית זה גם הכרחי מבחינת נכונות: בלי ביטול, הרצה
נטושה תמשיך לצרוך מעבד ותחזיר תוצאה שאיש לא מחכה לה.

### מד התקדמות — לא בשלב הזה

"התוסף עובד, 40% הושלמו" מ-`PERFORMANCE_TIER1.md` דורש **נגיעה בקובץ המנוע**: וו התקדמות
בלולאה הראשית ([`parserAlgorithm.ts:1980`](../src/utils/parserAlgorithm.ts#L1980), בתוך
ה-`forEach` על המקטעים בשורה 1955). זה שינוי זול ובטוח מבחינה לוגית — מונה שקורא ולא
כותב, ושידור מווסת אחת ל-100ms — אבל:

1. הוא **כן** פותח את קובץ המנוע — היחיד שהצעה זו נמנעת מלגעת בו;
2. הוא חייב לעבור את אותן שלוש שכבות אימות כמו כל שינוי במנוע;
3. התקדמות לפי מספר שורות פירוש אינה ליניארית בזמן — שורות נבדלות מאוד בעלותן, והמד
   "יזנק" ו"ייתקע" לסירוגין.

**המלצה:** לשחרר קודם בלי מד התקדמות. מסך שמגיב, ספינר שמסתובב וכפתור ביטול שעובד —
זה כבר כל ההבדל בין "התוסף קרס" לבין "התוסף עובד". מד התקדמות הוא שלב נפרד, שנכון
לעשות בנפרד מהמעבר עצמו כדי ששכבת האימות של המנוע תישאר משמעותית.

### מה עדיין יקפיא את המסך אחרי השינוי

הצעה 3 מסירה את החסימה הגדולה, אבל לא הופכת את הכול לחלק. שני דברים נשארים על החוט הראשי:

- **פענוח התוצאה החוזרת.** 2.0MB של תוצאה מפוענחים בחוט הראשי. חלק מ-392ms שנמדדו.
- **הציור הראשון של `EditMode`.** אלפי שורות פירוש ומקור נכנסות ל-`setSession` והתצוגה
  נבנית — עבודה שכולה על החוט הראשי, ושלא נמדדה כאן כלל. אם אחרי המעבר עדיין יורגש
  "תקיעה" של שנייה-שתיים בסוף הריצה, זה המקום לחפש בו, לא בחוט הרקע.

---

## חלק ח' · איך מאמתים

| שכבה | מה מריצים | מה זה מוכיח |
|---|---|---|
| 1 | `clone-fidelity.mts` (מהיר ו-`--full`) | הגבול שקוף: אותו פלט בדיוק משני צדיו |
| 2 | `qa/run.ts verify` | המנוע לא זז — מוכיח שההצעה באמת לא נגעה בו |
| 3 | דפדפן, ידני | המסך מגיב, הספינר מסתובב, הביטול עוצר |
| 4 | **אוצריא, התוסף הארוז** | ה-Worker בכלל עולה שם |

שכבה 2 היא חשובה מסיבה עדינה: היא לא בודקת את חוט הרקע כלל — וזה הפואנטה. אם היא
משתנה, סימן שההצעה נגעה במשהו שאסור היה לה לגעת בו.

**שכבה 3, מה בדיוק לבדוק:** לפתוח את לשונית Performance, להריץ, ולוודא שאין משימה
ארוכה (>50ms) על החוט הראשי לאורך הריצה. ספינר שמסתובב אינו הוכחה מספקת — אנימציית CSS
עשויה לרוץ על חוט הקומפוזיטור גם כשהחוט הראשי תפוס. המבחן האמיתי הוא **לחיצה שמגיבה**.

**שכבה 4 היא היחידה שיכולה להיכשל בצורה שלא נצפתה כאן.** מדיניות אבטחת תוכן (CSP) של
ה-WebView באוצריא עשויה לחסום `blob:` כמקור ל-Worker. לכן קיימת הנפילה לאחור בחלק ג' —
אם החוט לא עולה, התוסף מריץ בחוט הראשי ומתנהג **בדיוק כמו היום**. הכישלון האפשרי כאן
הוא "לא הרווחנו", לא "נשבר".

### הכלים

שני הסקריפטים יושבים כרגע בתיקיית העבודה הזמנית של הסשן, יחד עם העותק הקפוא של `src`
ועם `FROZEN.md5`. הם לא הוכנסו ל-`qa/` כדי לא להתנגש בעבודה שרצה שם עכשיו. המקום הטבעי
שלהם, כשיתפנה, הוא `qa/worker/` — לצד `qa/perf/`.

---

## חלק ט' · סיכום

| | |
|---|---|
| **מה שמוכח** | הפלט זהה בית-בבית משני צדי הגבול, על מקרה מלא (620 קישורים) ועל מקרה מהיר |
| **מה שנמדד** | עלות מסירה 392ms; גודל הקובץ +925KB (+64%) |
| **מה שהתגלה בדרך** | הספינר הקיים לא יכול היה להופיע אף פעם; הבנייה לקובץ יחיד מחייבת `?worker&inline`; ה-`.otzplugin` נארז ללא דחיסה |
| **מה שנשאר פתוח** | האם ה-WebView של אוצריא מרשה Worker מ-`blob:` |
| **הסיכון אם הכול משתבש** | חזרה להתנהגות של היום, אוטומטית ובלי הודעת שגיאה |

ההצעה לא מקצרת ולו מילישנייה אחת של חישוב. היא לוקחת 11 שניות של מסך מת והופכת אותן
ל-11 שניות של מסך חי שאפשר לבטל. המחיר הוא 925KB בקובץ הבנוי — ואם מוסיפים את שורת
הדחיסה ל-`pack-plugin.js`, התוסף שיגיע למשתמש יהיה **קטן מזה שהוא מקבל היום**.
