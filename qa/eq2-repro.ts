import { expandAbbreviationsInText as NEWEXP } from '../src/data/abbreviations';
import { expandAbbreviationsInText as OLDEXP } from './baseline/abbreviations.original';

const src = '<h1>פני יהושע על ברכות</h1>';
const ctx = 'ודוד מי קרי לנפשיה "חסיד" והכתיב "לולא האמנתי לראות בטוב ה\' בארץ חיים" ותנא משמיה דרבי יוסי למה נקוד על לולא עתיד לבוא';

console.log('OLD:', OLDEXP(src, ctx));
console.log('NEW:', NEWEXP(src, ctx));

// minimal
const src2 = 'על';
const ctx2 = 'עתיד לבוא ... על לולא';
console.log('\nmin OLD:', JSON.stringify(OLDEXP(src2, ctx2)));
console.log('min NEW:', JSON.stringify(NEWEXP(src2, ctx2)));

// order sensitivity / cache pollution probe: same ctx, called twice
console.log('\nrepeat NEW:', JSON.stringify(NEWEXP(src2, ctx2)));
console.log('repeat OLD:', JSON.stringify(OLDEXP(src2, ctx2)));
