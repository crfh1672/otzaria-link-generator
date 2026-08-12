# רשימת בעיות ושיפורים — מחולל קישורים לאוצריא

> **סטטוס:** ממצאי סקירת קוד מלאה | **תאריך:** אוגוסט 2026  
> **כיסוי:** כל קבצי `src/` — אלגוריתם, ממשק, ייצוא, נתונים  
> **סה"כ בעיות:** 41

---

## תוכן עניינים

1. [🔴 קריטי — חייב לטפל לפני release](#קריטי)
2. [🔴 גבוה — משפיע על דיוק ותוצאות](#גבוה)
3. [🟡 בינוני — משפיע על חוויה ועקביות](#בינוני)
4. [🟢 נמוך — שיפורים ונקיון](#נמוך)
5. [טבלת סיכום מהירה](#טבלת-סיכום)

---

---

## 🔴 גבוה — משפיע על דיוק ותוצאות {#גבוה}

---

### BUG-01 | Threshold זהה ל-explicit וללא-explicit

**קובץ:** `src/utils/parserAlgorithm.ts` → `searchLineInDoc`

**תיאור:**  
```ts
const minThreshold = isExplicit 
  ? Math.min(1.5, Math.max(0.7, expectedWeight * 0.65))
  : Math.min(1.5, Math.max(0.7, expectedWeight * 0.65));  // זהה לחלוטין!
```
שני הענפים זהים — אין הבדל בין ד"ה מפורש לד"ה משוער. כשיש תו הפסק מוגדר, הציפייה היא לדיוק גבוה יותר.

**פתרון מוצע:**
```ts
const minThreshold = isExplicit
  ? Math.min(2.0, Math.max(0.9, expectedWeight * 0.80))   // דיוק גבוה יותר
  : Math.min(1.5, Math.max(0.5, expectedWeight * 0.50));  // גמיש יותר ללא delimiter
```

---

### BUG-03 | `כו'` לא מכסה `וגו'` ודומיו (תנ"ך)

**קובץ:** `src/utils/parserAlgorithm.ts` → `extractDiburHamatchil`, `searchPrimaryWithFirstAnchor`

**תיאור:**  
הביטוי `/\bו?כו'/i` לא מכסה את הצורות `וגו'`, `וגומר`, `וכולי` שכיחות מאוד בפירושי תנ"ך.  
כתוצאה, ד"ה בפירושי תנ"ך עם `"וגו'"` לא עוברים דרך מסלול ה-First Anchor Priority.

**פתרון מוצע:**
```ts
const KOO_REGEX = /\b(?:ו?כו'|וגו'|וגומר|וכולי|וכו')\b/i;
```
החלף את כל המקומות שמשתמשים ב-`\bו?כו'` עם ה-regex המאוחד.

---


---

### BUG-28 | ד"ה שכולו מילות stop words עובר את ה-threshold

**קובץ:** `src/utils/wordWeights.ts` + `src/utils/parserAlgorithm.ts`

**תיאור:**  
ד"ה כמו `"אמר רב"` מורכב משתי stop words בלבד — `expectedWeight = 0.35 + 0.35 = 0.70`.  
ה-threshold גם הוא `0.70`, כלומר כל שורה שמכילה אחת מהמילים תעבור את הסף.

**פתרון מוצע:**  
```ts
const allStopWords = searchWords.every(w => HEBREW_STOP_WORDS.has(w));
const minThreshold = allStopWords
  ? expectedWeight * 0.95  // דרוש כמעט התאמה מלאה
  : Math.min(1.5, Math.max(0.7, expectedWeight * 0.65));
```

---

### BUG-37 | `stripSecondaryPrefix` לא מסיר ניקוד לפני ה-regex

**קובץ:** `src/utils/parserAlgorithm.ts` → `stripSecondaryPrefix`

**תיאור:**  
הפונקציה מנרמלת מירכאות אבל לא מסירה ניקוד לפני הפעלת ה-regex.  
טקסט כמו `"רַשִׁ"י ד"ה..."` עם ניקוד לא יתאים לשום pattern ב-regex.

**פתרון מוצע:**  
הוסף בשורה הראשונה של הפונקציה:
```ts
let cleaned = normalizeHebrewQuotes(line.trim());
cleaned = cleaned.replace(/[\u0591-\u05C7]/g, '');  // הסר ניקוד לפני regex
```

---

### BUG-38 | RASHI vs TOSAFOT — `startsWith` לא עקבי

**קובץ:** `src/utils/parserAlgorithm.ts` → לולאת `runLinkingParser`

**תיאור:**  
```ts
// רש"י — בדיקה ישירה ללא נרמול keyword
RASHI_KEYWORDS.some(kw => normalizedPrefixLine.startsWith(kw))

// תוספות — עם נרמול keyword
TOSAFOT_KEYWORDS.some(kw => normalizedPrefixLine.startsWith(normalizeText(kw, false)))
```
חוסר עקביות: `normalizedPrefixLine` עבר `normalizeText` אבל RASHI_KEYWORDS לא — השוואה עם `"` מקורי לא תצליח.

**פתרון מוצע:**  
נרמל את כל ה-keywords פעם אחת בעת הגדרתם:
```ts
const RASHI_KEYWORDS_NORM = RASHI_KEYWORDS.map(kw => normalizeText(kw, false));
const TOSAFOT_KEYWORDS_NORM = TOSAFOT_KEYWORDS.map(kw => normalizeText(kw, false));
```

---

### BUG-12 | Pagination שגוי ב-`fetchBookContent`

**קובץ:** `src/utils/otzariaBridge.ts` → `fetchBookContent`

**תיאור:**  
```ts
offset += res.data.length;  // offset לפי תווים
if (res.data.length < 5000) hasMore = false;
```
אם ה-API מצפה ל-offset לפי **שורות** ולא תווים — כל בקשה שניה תביא טקסט שגוי.  
בנוסף, כשהתוכן בדיוק 5000 תווים — נשלחת בקשה נוספת מיותרת שתחזיר ריק.

**פתרון מוצע:**  
- בדוק את מפרט ה-SDK לגבי unit של `offset`.  
- הוסף: `if (res.data.length === 0) { hasMore = false; break; }` לפני ההוספה לתוכן.


---

### BUG-04 | `distPenalty` חלש מדי — קפיצה לאחור לא נענשת

**קובץ:** `src/utils/parserAlgorithm.ts` → `searchLineInDoc` (מצב ללא explicit)

**תיאור:**  
```ts
distPenalty = Math.max(0.93, 1.0 - Math.abs(diff) * 0.005);  // 0.5% לשורה!
```
קפיצה של 50 שורות לאחור גורמת לירידה של 2.5% בלבד — חסרת משמעות מעשית.  
האלגוריתם ימצא שורות "טובות" הרחק מאוד לאחור ויעדיף אותן על פני שורות קרובות.

**פתרון מוצע:**
```ts
if (diff < 0) {
  distPenalty = Math.max(0.70, 1.0 - Math.abs(diff) * 0.03);  // 3% לשורה לאחור
} else if (diff > 5) {
  distPenalty = Math.max(0.90, 1.0 - (diff - 5) * 0.01);      // 1% לשורה קדימה
}
```

---

### BUG-07 | זיהוי מילות מפתח לרש"י/תוספות — `startsWith` נכשל על פתיחה עם סימן פיסוק

**קובץ:** `src/utils/parserAlgorithm.ts` → לולאת `runLinkingParser`

**תיאור:**  
שורת פירוש שמתחילה ב-`'"רש"י ד"ה...'` (עם מירכאות פתיחה) לא תתאים ל-`startsWith('רש"י')`.  
מקורות דיגיטליים רבים מוסיפים סימן פתיחה לפני שם המפרש.

**פתרון מוצע:**
```ts
const strippedForKeyword = normalizedPrefixLine.replace(/^[\s"'״׳\-–]+/, '');
RASHI_KEYWORDS_NORM.some(kw => strippedForKeyword.startsWith(kw))
```

---


### BUG-09 | `calculateLinkConfidence` — confidence לירושה קשיח תמיד 75

**קובץ:** `src/utils/parserAlgorithm.ts` → `calculateLinkConfidence`

**תיאור:**  
```ts
if (isInherited) {
  return 75;  // תמיד 75, ללא קשר לאיכות הלינק המקורי
}
```
אם הלינק המקורי היה בטחון 95 — הלינק המורש ראוי ל-85, לא ל-75.

**פתרון מוצע:**
```ts
if (isInherited) {
  return Math.max(60, (previousConfidence ?? 85) - 10);
}
```

---

### BUG-10 | IDF — סף downweight גבוה מדי (15%)

**קובץ:** `src/utils/wordWeights.ts` → `calculateDocumentIdfWeights`

**תיאור:**  
```ts
if (ratio > 0.15) {
  idfWeights[word] = Math.max(0.35, 1 - ratio * 2);
}
```
מילה שמופיעה ב-15% מהשורות כבר מקבלת downweight. בגמרא, מילה כמו `"שחיטה"` בפרק שחיטה יכולה להופיע ב-10% מהשורות אך עדיין חיונית לזיהוי.

**פתרון מוצע:**
- שנה סף ל-8% (downweight)
- הגבר boost לנדירים (ratio < 1%) ל-1.5
- חשב IDF גם על שורות הפירוש (לא רק המקור)

---

---

## 🟡 בינוני — משפיע על חוויה ועקביות {#בינוני}

---

### BUG-05 | `expandAbbreviationsInText` רץ בתוך לולאה פנימית

**קובץ:** `src/utils/parserAlgorithm.ts` → `searchLineInDoc`

**תיאור:**  
פענוח ראשי תיבות מתבצע **בתוך** הלולאה שסורקת כל שורת מקור:
```ts
for (let lNum = range.s; lNum <= range.e; lNum++) {
  const expSearchPhrase = expandAbbreviationsInText(searchPhrase, docLineNorm, abbrDict);
  // ...
}
```
על ספר של 5000 שורות — זה  סריקות מלאות של מילון 400+ ערכים לכל שורת פירוש.

**פתרון מוצע:**  
חשב את ה-expansions האפשריים של שורת הפירוש **פעם אחת לפני הלולאה**, ולאחר מכן בדוק רק אם כל expansion קיים בשורת המקור.

---

### BUG-11 | `searchLineInDoc` מוגדרת פעמיים בתוך `runLinkingParser`

**קובץ:** `src/utils/parserAlgorithm.ts`

**תיאור:**  
הפונקציה `searchLineInDoc` מוגדרת פעמיים ברצף כ-closure בתוך הלולאה הראשית — גוף זהה לחלוטין. הגדרה שנייה מחליפה את הראשונה בשקט. נראית שגיאת עריכה שלא נוקתה.

**פתרון מוצע:**  
הוצא את `searchLineInDoc` ו-`searchPrimaryWithFirstAnchor` לרמת המודול — מחוץ ל-`runLinkingParser`. העבר את `config`, `enableWordWeighting`, ו-`srcIdfMap` כפרמטרים.

---5000

### BUG-13 | IDF מחושב על שורות כותרת — מדכא מילות ניווט

**קובץ:** `src/utils/wordWeights.ts` → `calculateDocumentIdfWeights`

**תיאור:**  
הלולאה רצה על כל השורות ללא סינון כותרות. שורות כמו `<h1>פרק א</h1>` גורמות לכך שמילים כמו `"פרק"` מופיעות בכל כותרת ומקבלות IDF נמוך — בדיוק ההפך ממה שרצוי.

**פתרון מוצע:**
```ts
docLines.forEach(line => {
  if (!line || isHeaderLine(line)) return;  // דלג על כותרות
  // ...
});
```

---

### BUG-16 | `handleSaveLink` — `heRef_2` ידני לא בפורמט אוצריא

**קובץ:** `src/components/EditMode.tsx` → `handleSaveLink`

**תיאור:**  
```ts
const heRef_2 = `${headerTitle} - שורה ${newSourceLineIdx}`;
```
אוצריא לא מכירה "שורה 47" — היא מצפה לפורמט כמו `"בראשית א, א"` או `"ברכות דף ב."`.  
קישור שנוצר ידנית יהיה לא שמיש בממשק אוצריא.

**פתרון מוצע:**  
חשב את `heRef_2` מתוך כותרת ה-segment שאליו השורה שייכת, בדיוק כפי שהאלגוריתם האוטומטי עושה.

---

### BUG-17 | `expandAbbreviationsInText` לא מזהה ר"ת מרובי מילים

**קובץ:** `src/data/abbreviations.ts` → `expandAbbreviationsInText`

**תיאור:**  
הפונקציה מחלקת ל-tokens לפי `split(/(\s+)/)` ובודקת מילה בודדת בכל פעם.  
ר"ת כמו `"אאכ"` (`אלא אם כן`) שמוגדרים כמחרוזת אחת — לא ייתפסו.

**פתרון מוצע:**  
הוסף סריקה של bigrams ו-trigrams (זוגות ושלישיות מילים) לפני בדיקת מילה בודדת.

---

### BUG-18 | IDF מחושב מחדש בכל הרצת אלגוריתם

**קובץ:** `src/App.tsx` → `handleRunAlgorithm`

**תיאור:**  
`calculateDocumentIdfWeights` נקרא בתוך `runLinkingParser` בכל הפעלה, גם אם אותו ספר מקור נבחר שוב.

**פתרון מוצע:**  
הוסף `useMemo` ב-`App.tsx` המאחסן את ה-IDF map לפי `config.targetBookName`:
```ts
const cachedIdfMap = useMemo(() => 
  calculateDocumentIdfWeights(sourceLines), 
  [config.targetBookName]
);
```

---

### BUG-19 | `status` — `undefined` מתנהג כ-`approved`, לינק ידני חסר status

**קובץ:** `src/types.ts` + `src/components/EditMode.tsx`

**תיאור:**  
לינקים שנוצרו ידנית ב-`handleSaveLink` לא מקבלים `status` — לכן לא מופיעים בסינון "ממתינים לבדיקה" גם אם הם שגויים. בנוסף, הבדיקה `linkObj.status === 'approved' || !linkObj.status` מסתמכת על `undefined === approved` שהוא התנהגות שבירה.

**פתרון מוצע:**  
בתוך `handleSaveLink`, הגדר תמיד:
```ts
status: 'approved'
```
ושנה את השדה ב-`types.ts` להיות `required` (לא optional).

---

### BUG-24 | `ProjectsModal` — N קריאות סדרתיות לאחסון

**קובץ:** `src/components/ProjectsModal.tsx` → `fetchSavedProjects`

**תיאור:**  
```ts
for (const k of keys) {
  const item = await getFromCache<SessionState>(k);  // סדרתי!
}
```
על 10 פרויקטים — 10 קריאות סדרתיות. כל קריאה מחכה לקודמת. בנוסף, כל מפתחות ה-cache נסרקים — כולל מפתחות שאינם sessions.

**פתרון מוצע:**  
- שמור `session_index` כ-key ייעודי עם רשימת ה-IDs.  
- השתמש ב-`Promise.all` לטעינה מקבילית:
```ts
const items = await Promise.all(sessionIds.map(id => getFromCache<SessionState>(id)));
```

---

### BUG-25 | שורות כותרת ניתנות לבחירה ב-`EditLinkModal`

**קובץ:** `src/components/EditLinkModal.tsx` → `filteredLines`

**תיאור:**  
`getTabLines()` מחזיר את `sourceLines` כולל שורות `<h1>...</h1>`. המשתמש יכול לבחור שורת כותרת כ-line_index_2 — פתיחה באוצריא תנחת על הכותרת ולא על תוכן.

**פתרון מוצע:**
```ts
.filter(item => !isHeaderLine(item.text) && item.text.trim())
```

---

### BUG-26 | `parseDocumentSegments` נקרא בכל render ב-TopToolbar

**קובץ:** `src/components/TopToolbar.tsx`

**תיאור:**  
```tsx
{parseDocumentSegments(session.commentaryLines.join('\n')).segments.length}
```
`join + parse` מחדש בכל render — כולל כל hover, scroll, ולחיצה בממשק.

**פתרון מוצע:**  
חשב ב-`App.tsx` עם `useMemo` ועבור את `segmentCount` כ-prop.

---

### BUG-27 | `links.find(...)` בלולאה — O(n²)

**קובץ:** `src/components/EditMode.tsx` → `filteredCommentaryIndices`

**תיאור:**  
```ts
const link = links.find(l => l.line_index_1 === commLineIdx1);
```
נקרא לכל שורת פירוש בכל render. על 500 שורות ו-400 קישורים — 200,000 השוואות.

**פתרון מוצע:**
```ts
const linksByLine = useMemo(() => {
  const map: Record<number, OtzariaLink> = {};
  links.forEach(l => { map[l.line_index_1] = l; });
  return map;
}, [links]);
```

---

### BUG-30 | `runLinkingParser` חוסם את ה-UI thread

**קובץ:** `src/App.tsx` → `handleRunAlgorithm`

**תיאור:**  
האלגוריתם רץ synchronously — ממשק קופא לחלוטין, ה-spinner לא מתנענע, ואין אינדיקציית קדמה.

**פתרון מוצע:**  
- **מיידי:** הוסף `await new Promise(r => setTimeout(r, 0))` לפני הקריאה לאפשר ל-React לרנדר.  
- **ארוך טווח:** העבר ל-Web Worker.

---

### BUG-32 | Drag-and-drop חלקי — `onDragStart` ללא `onDrop`

**קובץ:** `src/components/EditMode.tsx`

**תיאור:**  
`draggedCommLineIdx` state ו-`handleDragStart` מוגדרים, אבל אין שום `onDrop` handler.  
הפיצ'ר לא הושלם — המשתמש יכול לגרור שורות ללא שום אפקט.

**פתרון מוצע:**  
ממש `onDrop` לשינוי סדר קישורים, **או** הסר `draggable`, `onDragStart` ואת ה-state כולו.

---

### BUG-33 | `newOptionInput` גלובלי לכל כרטיסי ראשי התיבות

**קובץ:** `src/components/AbbreviationsModal.tsx`

**תיאור:**  
כל כרטיסי ר"ת חולקים `useState` אחד. הקלדה בכרטיס אחד "נדבקת" לכרטיס אחר.  
בנוסף, ה-input הוא `uncontrolled` — לא מתרוקן אחרי שמירה.

**פתרון מוצע:**  
- צור רכיב `AbbreviationCard` נפרד עם state מקומי לכל כרטיס.  
- הפוך את ה-input ל-`controlled` עם `value`.

---

### BUG-35 | Mock חלקי — 0 קישורים ללא שגיאה בפיתוח

**קובץ:** `src/data/otzariaLibraryMock.ts` + `src/utils/otzariaBridge.ts`

**תיאור:**  
Mock מכיל רק ברכות ובראשית. כל ספר אחר מחזיר `"לא נמצא תוכן עבור ספר זה"`.  
האלגוריתם רץ על תוכן ריק ומחזיר 0 קישורים ללא שגיאה — נראה כאילו האלגוריתם שבור.

**פתרון מוצע:**  
הוסף בדיקה ב-`handleRun`:
```ts
if (sourceText.includes('לא נמצא תוכן עבור ספר זה')) {
  notifyError(`הספר "${targetBook}" לא נמצא בספרייה. אנא ייבא קובץ TXT חיצוני.`);
  return;
}
```

---

### BUG-36 | Mock links לא תואמים לתוכן המוק

**קובץ:** `src/data/otzariaLibraryMock.ts`

**תיאור:**  
`MOCK_BOOK_LINKS` מכיל ערכים שרירותיים שאינם עולים בקנה אחד עם שורות הטקסט ב-`MOCK_BOOK_CONTENTS`.  
כל test עם secondary source mapping במצב mock יכשל בשקט.

**פתרון מוצע:**  
בנה את `MOCK_BOOK_LINKS` בהתאם לשורות האמיתיות ב-mock — ספור את השורות ב-`MOCK_BOOK_CONTENTS["רש\"י על ברכות"]` ובנה mapping נכון.

---

### BUG-39 | IDF לא מנרמל מירכאות לפני ספירה

**קובץ:** `src/utils/wordWeights.ts` → `calculateDocumentIdfWeights`

**תיאור:**  
`"שמע"` עם גרש ו-`שמע` ללא גרש נחשבים tokens שונים. IDF של כל אחד גבוה מהנדרש.

**פתרון מוצע:**
```ts
const norm = normalizeHebrewQuotes(line)
  .replace(/[\u0591-\u05C7]/g, '')
  .replace(/[^\u05D0-\u05EA0-9\s]+/g, ' ');
```

---

### BUG-41 | `express`, `dotenv`, `@google/genai` — חבילות מיותרות בפרויקט

**קובץ:** `package.json`

**תיאור:**  
שלוש חבילות מוגדרות ב-`dependencies` ואינן בשימוש בשום קובץ `.ts`/`.tsx`:
- `@google/genai` (^2.4.0) — ייתכן שנשאר מגרסה קודמת
- `express` (^4.21.2) — server-side, לא רלוונטי לפרונטאנד
- `dotenv` (^17.2.3) — server-side, לא רלוונטי

כולם נכנסים ל-bundle ומגדילים את גודלו.

**פתרון מוצע:**  
הסר את שלוש החבילות: `npm uninstall @google/genai express dotenv`

---

---

## 🟢 נמוך — שיפורים ונקיון {#נמוך}

---

### BUG-06 | `areHeadersMatching` — `.includes()` על מחרוזת קצרה

**קובץ:** `src/utils/parserAlgorithm.ts` → `areHeadersMatching`

**תיאור:**  
```ts
norm1.includes(norm2) || norm2.includes(norm1)
```
מחרוזת `"ה"` נכלת בכל כותרת — False Positive מיידי.

**פתרון מוצע:**  
הגבל `includes` רק כשאורך המחרוזת הקצרה >= 3 תווים:
```ts
const shorter = norm1.length <= norm2.length ? norm1 : norm2;
const longer = shorter === norm1 ? norm2 : norm1;
return norm1 === norm2 || (shorter.length >= 3 && longer.includes(shorter));
```

---

### BUG-21 | `levenshteinDistance` — early exit מחזיר ערך שגוי סמנטית

**קובץ:** `src/utils/fuzzyUtils.ts` → `levenshteinDistance`

**תיאור:**  
```ts
if (Math.abs(lenA - lenB) > 2) return Math.abs(lenA - lenB);
```
מחזיר את הפרש האורכים כאילו היה המרחק האמיתי — זה לא נכון מתמטית.  
לא גורם לבאג בפועל כי `getWordSimilarity` כבר מפסיק לפני קריאה זו כשיש הפרש > 2, אבל קריאה עתידית ישירה ל-`levenshteinDistance` תחזיר ערך מטעה.

**פתרון מוצע:**  
```ts
if (Math.abs(lenA - lenB) > 2) return 999;  // sentinel — לא ייתכן כמרחק אמיתי
```

---

### BUG-29 | גרשיים נדירים לא מנורמלים

**קובץ:** `src/utils/parserAlgorithm.ts` → `normalizeHebrewQuotes`

**תיאור:**  
חסרים תווי גרש `ʻ` (U+02BB) ו-`ʼ` (U+02BC) שמופיעים בטקסטים דיגיטליים ישנים.  
`"תוסʼ"` לא יזוהה ב-`TOSAFOT_KEYWORDS`.

**פתרון מוצע:**
```ts
.replace(/[\u05F3\u02BB\u02BC'´'']/g, "'")
```

---

### BUG-31 | קובץ TXT ב-ZIP ללא BOM

**קובץ:** `src/components/TopToolbar.tsx` → `handleExportZip`

**תיאור:**  
קובץ ה-CSV מקבל BOM (`\uFEFF`) אבל קובץ ה-TXT לא.  
אקסל Windows ו-Notepad ישנים עלולים לפתוח עברית עם encoding שגוי.

**פתרון מוצע:**
```ts
zip.file(`${cleanFileName}.txt`, '\uFEFF' + txtContent);
```

---

### BUG-34 | `AbbreviationsModal` — input uncontrolled לא מתרוקן

**קובץ:** `src/components/AbbreviationsModal.tsx`

**תיאור:**  
```tsx
onChange={e => setNewOptionInput(e.target.value)}
// אין value={newOptionInput} — uncontrolled!
```
לחיצת Enter קוראת ל-`handleAddOption` שמבצע `setNewOptionInput('')`, אך ה-input לא מתרוקן ויזואלית.

**פתרון מוצע:**  
הוסף `value={newOptionInput}` ל-input (תוך תיקון BUG-33 תחילה).

---

### BUG-40 | `SingleHtmlExporterModal` — ייצוא HTML ידני כפול לעומת `viteSingleFile`

**קובץ:** `src/components/SingleHtmlExporterModal.tsx` → `handleDownloadSingleHtml`

**תיאור:**  
```ts
const docHtml = `<!DOCTYPE html>\n<html lang="he" dir="rtl">\n${document.documentElement.innerHTML}\n</html>`;
```
`document.documentElement.innerHTML` + עטיפה ידנית = כפל ה-`<html>` tag.  
הקובץ יכיל `<html><html lang="he"...>...</html></html>` — HTML לא תקין.

**פתרון מוצע:**
```ts
const docHtml = `<!DOCTYPE html>\n${document.documentElement.outerHTML}`;
```

---

## טבלת סיכום מהירה {#טבלת-סיכום}

| # | קובץ | תיאור קצר | חומרה |
|---|------|------------|-------|
| BUG-22 | SingleHtmlExporterModal | ייצוא otzplugin = DOM חי, לא bundle | 🔴 קריטי |
| BUG-01 | parserAlgorithm | Threshold זהה ל-explicit/implicit | 🔴 גבוה |
| BUG-02 | parserAlgorithm | dhWordCount = ציון float, לא מספר מילים | 🔴 גבוה |
| BUG-03 | parserAlgorithm | כו' לא מכסה וגו' — מחמיץ תנ"ך | 🔴 גבוה |
| BUG-04 | parserAlgorithm | distPenalty 0.5% — קפיצה לאחור לא נענשת | 🔴 גבוה |
| BUG-07 | parserAlgorithm | startsWith נכשל על פתיחה עם פיסוק | 🔴 גבוה |
| BUG-08 | parserAlgorithm | ירושת "שם" ללא בדיקת Header | 🔴 גבוה |
| BUG-09 | parserAlgorithm | confidence ירושה תמיד 75 | 🔴 גבוה |
| BUG-10 | wordWeights | IDF סף 15% — downweight יתר | 🔴 גבוה |
| BUG-12 | otzariaBridge | pagination שגוי — offset לפי תווים | 🔴 גבוה |
| BUG-14 | parserAlgorithm | areHeadersMatching — False Positives | 🔴 גבוה |
| BUG-15 | parserAlgorithm | previousLink לא מתאפס בין segments | 🔴 גבוה |
| BUG-20 | parserAlgorithm | ספרות ערביות vs גימטריה בכותרות | 🔴 גבוה |
| BUG-23 | TopToolbar | ייצוא ZIP כולל קישורים pending | 🔴 גבוה |
| BUG-28 | wordWeights + parserAlgorithm | ד"ה שכולו stop words עובר threshold | 🔴 גבוה |
| BUG-37 | parserAlgorithm | stripSecondaryPrefix לא מסיר ניקוד | 🔴 גבוה |
| BUG-38 | parserAlgorithm | RASHI vs TOSAFOT startsWith לא עקבי | 🔴 גבוה |
| BUG-05 | parserAlgorithm | expandAbbreviations רץ בתוך לולאה | 🟡 בינוני |
| BUG-11 | parserAlgorithm | searchLineInDoc מוגדרת פעמיים | 🟡 בינוני |
| BUG-13 | wordWeights | IDF סורק שורות כותרת | 🟡 בינוני |
| BUG-16 | EditMode | heRef_2 ידני לא בפורמט אוצריא | 🟡 בינוני |
| BUG-17 | abbreviations | ר"ת מרובי מילים לא נתפסים | 🟡 בינוני |
| BUG-18 | App.tsx | IDF מחושב מחדש בכל הרצה | 🟡 בינוני |
| BUG-19 | types + EditMode | status undefined ≠ pending | 🟡 בינוני |
| BUG-24 | ProjectsModal | N קריאות סדרתיות לאחסון | 🟡 בינוני |
| BUG-25 | EditLinkModal | שורות כותרת ניתנות לבחירה | 🟡 בינוני |
| BUG-26 | TopToolbar | parseDocumentSegments בכל render | 🟡 בינוני |
| BUG-27 | EditMode | links.find בלולאה O(n²) | 🟡 בינוני |
| BUG-30 | App.tsx | runLinkingParser חוסם UI thread | 🟡 בינוני |
| BUG-32 | EditMode | drag-and-drop חלקי ללא onDrop | 🟡 בינוני |
| BUG-33 | AbbreviationsModal | newOptionInput גלובלי לכל כרטיסים | 🟡 בינוני |
| BUG-35 | otzariaLibraryMock | Mock חלקי — 0 קישורים ללא שגיאה | 🟡 בינוני |
| BUG-36 | otzariaLibraryMock | Mock links לא תואמים לתוכן | 🟡 בינוני |
| BUG-39 | wordWeights | IDF לא מנרמל מירכאות | 🟡 בינוני |
| BUG-41 | package.json | 3 חבילות מיותרות (express/dotenv/genai) | 🟡 בינוני |
| BUG-06 | parserAlgorithm | includes() על מחרוזת קצרה | 🟢 נמוך |
| BUG-21 | fuzzyUtils | levenshtein early exit — ערך שגוי | 🟢 נמוך |
| BUG-29 | parserAlgorithm | גרשיים נדירים לא מנורמלים | 🟢 נמוך |
| BUG-31 | TopToolbar | TXT ב-ZIP ללא BOM | 🟢 נמוך |
| BUG-34 | AbbreviationsModal | input uncontrolled לא מתרוקן | 🟢 נמוך |
| BUG-40 | SingleHtmlExporterModal | `<html>` כפול בייצוא HTML | 🟢 נמוך |

---

*סה"כ: 41 בעיות | 1 קריטי | 16 גבוה | 18 בינוני | 6 נמוך*
