/**
 * ACCURACY QA round 2 — stricter, abbreviation-aware independent judge.
 *
 * Difference from qa/acc-judge.mjs: when the commentary quotation contains a
 * gershayim abbreviation (ל"ש, בה"כ, ר"ל) or a numeric apostrophe form (ג'),
 * we allow it to match a run of target words by initial letters. That removes
 * the judge's own abbreviation blindness, so "the quotation is nowhere on the
 * page" becomes a meaningful signal rather than a judge artefact.
 *
 *   node qa/acc2-judge2.mjs <dumpfile> <setName> [mode] [args]
 */
import fs from 'fs';
import path from 'path';

const [dumpFile, setName, mode = 'summary', ...rest] = process.argv.slice(2);
const DATA = process.env.QA_DATA;
const SETS = {
  'py-berachot': ['gem_berachot', 'rashi_berachot', 'tos_berachot'],
  'py-shabbat': ['gem_shabbat', 'rashi_shabbat', 'tos_shabbat'],
  'by-berachot': ['gem_berachot', 'rashi_berachot', 'tos_berachot'],
};
const { meta, rows } = JSON.parse(fs.readFileSync(dumpFile, 'utf8'));

const strip = s => (s || '').replace(/<[^>]*>/g, ' ');
const norm = s =>
  strip(s)
    .replace(/[֑-ׇ]/g, '')
    .replace(/[׳'’‘´]{2}/g, '"')
    .replace(/[׳'’‘´]/g, "'")
    .replace(/[״"“”″‟„]/g, '"')
    .replace(/[^א-ת0-9\s'"]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
const W = s => norm(s).split(' ').filter(Boolean);

function pageIndex(file) {
  const lines = fs.readFileSync(path.join(DATA, file + '.txt'), 'utf8').split(/\r?\n/);
  const pages = new Map();
  let cur = null;
  lines.forEach((l, i) => {
    const m = l.trim().match(/<h2[^>]*>(.*?)<\/h2>/i);
    if (m) { if (cur) cur.end = i; cur = { title: norm(m[1]), start: i + 2, end: lines.length };
      if (!pages.has(cur.title)) pages.set(cur.title, cur); }
  });
  if (cur) cur.end = lines.length;
  return { lines, pages };
}
const [gemF, rashiF, tosF] = SETS[setName];
const BOOK = { gemara: pageIndex(gemF), rashi: pageIndex(rashiF), tosafot: pageIndex(tosF) };

const PREFIX_RE =
  /^(?:בגמרא|גמרא|גמ'|בגמ'|במשנה|משנה|מתניתין|מתני'|פיסקא|בפיסקא|שם|בפירש"י|פירש"י|בפרש"י|פרש"י|ברש"י|רש"י|ברשי|רשי|בתוספות|תוספות|בתוסות|תוסות|בתוס'|תוס'|בתוס|תוס|בתו'|תו'|תוד"ה|בתוד"ה|רשד"ה|ברשד"ה|בד"ה|ד"ה|דה|בא"ד|א"ד|באו"ד|או"ד|אד|באד|בעזרת|ובזה|עוד)(?:\s+|$)/;
function quotation(comm, maxW = 8) {
  let w = W(comm);
  for (let k = 0; k < 5; k++) {
    const j = w.join(' ');
    const m = j.match(PREFIX_RE);
    if (!m) break;
    w = j.slice(m[0].length).split(' ').filter(Boolean);
  }
  const cut = w.findIndex(x => /^ו?כו'?$|^וגו'?$|^וגומר$|^וכולי$/.test(x));
  let q = cut > 0 ? w.slice(0, cut) : w.slice(0, maxW);
  if (q.length > maxW) q = q.slice(0, maxW);
  return q;
}

const NUM = { "א'": ['אחד','אחת','ראשון'], "ב'": ['שנים','שתי','שני','שנים'], "ג'": ['שלשה','שלש','שלושה','שלושה'],
  "ד'": ['ארבעה','ארבע'], "ה'": ['חמשה','חמש'], "ו'": ['ששה','שש'], "ז'": ['שבעה','שבע'],
  "ח'": ['שמנה','שמונה'], "ט'": ['תשעה','תשע'], "י'": ['עשרה','עשר'] };

function lev(a, b) {
  const m = a.length, n = b.length;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) { const cur = [i];
    for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j]+1, cur[j-1]+1, prev[j-1] + (a[i-1]===b[j-1]?0:1));
    prev = cur; }
  return prev[n];
}
const bare = w => w.replace(/["']/g, '');
function wEq(a, b) {
  if (a === b) return true;
  const A = bare(a), B = bare(b);
  if (A === B) return true;
  if (A.length >= 3 && B.length >= 3) {
    if (A.startsWith(B) || B.startsWith(A)) return true;
    if (Math.abs(A.length - B.length) <= 2 && lev(A, B) <= 1) return true;      // דילג/דלג, להם/להן
  }
  if (NUM[a] && NUM[a].some(x => x === B)) return true;
  if (NUM[b] && NUM[b].some(x => x === A)) return true;
  return false;
}
/** match quotation word q against target words starting at index j.
 *  returns how many TARGET words were consumed, or 0 if no match. */
function consume(q, tw, j) {
  if (j >= tw.length) return 0;
  if (wEq(q, tw[j])) return 1;
  if (/"/.test(q)) {                                   // notarikon: ל"ש -> לא שנו
    const letters = q.replace(/"/g, '').split('');
    if (letters.length >= 2 && letters.length <= 4 && j + letters.length <= tw.length) {
      let ok = true;
      for (let k = 0; k < letters.length; k++) if (!tw[j + k] || tw[j + k][0] !== letters[k]) { ok = false; break; }
      if (ok) return letters.length;
    }
  }
  if (NUM[q] && j < tw.length && NUM[q].some(x => x === bare(tw[j]))) return 1;
  return 0;
}
/** longest run of quotation words matched consecutively anywhere in the target line */
function score(q, tw) {
  if (!q.length || !tw.length) return { hit: 0, run: 0, s: 0, at: -1 };
  let hit = 0;
  for (const x of q) { let f = false; for (let j = 0; j < tw.length; j++) if (consume(x, tw, j)) { f = true; break; } if (f) hit++; }
  let run = 0, at = -1;
  for (let i = 0; i < q.length; i++)
    for (let j = 0; j < tw.length; j++) {
      let k = 0, jj = j;
      while (i + k < q.length) { const c = consume(q[i + k], tw, jj); if (!c) break; jj += c; k++; }
      if (k > run) { run = k; at = j; }
    }
  return { hit, run, at, s: hit + 2 * run };
}

const cacheW = new Map();
const wordsOf = (book, ln) => { const k = book + ':' + ln; let v = cacheW.get(k);
  if (!v) { v = W(BOOK[book].lines[ln - 1] || ''); cacheW.set(k, v); } return v; };

const routeOf = c => {
  const s = norm(c).replace(/^(?:בגמרא|גמרא|גמ'|בגמ'|במשנה|משנה|מתניתין|מתני')(?=\s|$)\s*/, '');
  if (/^(?:ב?פירש"י|ב?פרש"י|ב?רש"י|ב?רשי|ב?רשד"ה)(?=\s|$|["'])/.test(s)) return 'rashi';
  if (/^(?:ב?תוספות|ב?תוסות|ב?תוס'|ב?תוס|ב?תו'|ב?תוד"ה)(?=\s|$|["'])/.test(s)) return 'tosafot';
  const w = norm(c);
  if (/^(?:בגמרא|גמרא|גמ'|בגמ'|פיסקא|בפיסקא)(?=\s|$)/.test(w)) return 'gemara';
  if (/^(?:במשנה|משנה|מתניתין|מתני')(?=\s|$)/.test(w)) return 'mishna';
  if (/^(?:בא"ד|א"ד|באו"ד|או"ד|באד|אד)(?=\s|$)/.test(w)) return 'baad';
  if (/^שם(?=\s|$)/.test(w)) return 'sham';
  return null;
};
/* discourse openers = the line continues the previous discussion, it does not quote afresh */
const CONT = /^(?:מיהו|אמנם|אלא|ועוד|נמצא|ובזה|לכך|ונראה|ומתוך|ולולי|ובאמת|ומה|אחר|והשתא|והנלע"ד|ודע|ומכ"ש|ואם|ובר|ולפ"ז|ולפי'|והנראה|ויותר|ועי"ל|וא"כ|ולענ"ד|אך|אכן|וכן|ומעתה|ולפיכך|העולה|סליק|הנה|ומכלל|ואפשר|ואף|וכל|ויש|ובזה|ולכאורה|וא"ת|ולזה)(?=\s|$)/;

for (const r of rows) {
  r.route = routeOf(r.comm);
  r.cont = CONT.test(norm(r.comm));
  r.q = quotation(r.comm);
  if (!r.linked) continue;
  const book = r.tgtBook;
  const page = BOOK[book]?.pages.get(norm(r.seg));
  r.chosen = score(r.q, wordsOf(book, r.tgt));
  r.best = null;
  if (page) {
    let best = { s: -1 };
    for (let ln = page.start; ln <= page.end; ln++) { const sc = score(r.q, wordsOf(book, ln)); if (sc.s > best.s) best = { ...sc, ln }; }
    r.best = best;
  }
}

/* verdicts */
for (const r of rows) {
  if (!r.linked) { r.v = 'none'; continue; }
  if (r.inh) { r.v = 'INHERIT'; continue; }
  if (!r.best) { r.v = 'nopage'; continue; }
  if (r.q.length < 2) { r.v = 'noquote'; continue; }
  const locatable = r.best.run >= 2 || r.best.hit >= 3;          // quotation exists somewhere on the page
  const strong = r.chosen.run >= 2 || r.chosen.hit >= 3;
  if (!locatable) { r.v = 'NOQUOTE-ON-PAGE'; continue; }         // nothing on the page matches -> the line has no quotation
  const better = r.best.ln !== r.tgt && r.best.s - r.chosen.s >= 3;
  if (better) r.v = strong ? 'AMBIG' : 'MISS';                    // MISS = engine picked a line that doesn't match while a matching one exists
  else r.v = strong ? 'OK' : 'WEAK';
}

const pct = (a, b) => (b ? ((100 * a) / b).toFixed(1) + '%' : '-');
const linked = rows.filter(r => r.linked);
const searched = linked.filter(r => !r.inh);

if (mode === 'summary') {
  console.log(`FILE ${path.basename(dumpFile)} set=${setName}`);
  const t = {}; for (const r of rows) t[r.v] = (t[r.v] || 0) + 1;
  console.log(`content lines ${rows.length}  linked ${linked.length} (${pct(linked.length, rows.length)})  searched ${searched.length}  inherited ${linked.length - searched.length}`);
  console.log('VERDICTS', JSON.stringify(t));
  const j = searched.filter(r => ['OK','MISS','AMBIG','WEAK','NOQUOTE-ON-PAGE'].includes(r.v));
  const c = k => j.filter(r => r.v === k).length;
  console.log(`judgeable ${j.length}: OK ${c('OK')} (${pct(c('OK'), j.length)}) | MISS ${c('MISS')} (${pct(c('MISS'), j.length)}) | AMBIG ${c('AMBIG')} | WEAK ${c('WEAK')} | no quotation found on page ${c('NOQUOTE-ON-PAGE')} (${pct(c('NOQUOTE-ON-PAGE'), j.length)})`);
  console.log(`exact-best-line among searched with a page: ${pct(searched.filter(r => r.best && r.tgt === r.best.ln).length, searched.filter(r => r.best).length)}`);

  console.log('\nCONFIDENCE band   n   %MISS  %OK  %NOQUOTE  %exact-best');
  for (const [lo, hi, nm] of [[98,100,'98-100'],[88,97,'88-97'],[76,87,'76-87'],[70,75,'70-75'],[60,69,'60-69'],[0,59,'<60']]) {
    const g = linked.filter(r => r.conf >= lo && r.conf <= hi); if (!g.length) continue;
    const s = g.filter(r => !r.inh);
    console.log(nm.padEnd(15), String(g.length).padStart(4),
      pct(s.filter(r=>r.v==='MISS').length, s.length).padStart(7),
      pct(s.filter(r=>r.v==='OK').length, s.length).padStart(6),
      pct(s.filter(r=>r.v==='NOQUOTE-ON-PAGE').length, s.length).padStart(9),
      pct(g.filter(r=>r.best && r.tgt===r.best.ln).length, g.filter(r=>r.best).length).padStart(11));
  }

  console.log('\nCONTINUATION LINES (open with מיהו/אמנם/אלא/ועוד… = no fresh quotation)');
  const cont = rows.filter(r => r.cont);
  const contS = cont.filter(r => r.linked && !r.inh);
  console.log(`  ${cont.length} such lines; ${cont.filter(r=>r.inh).length} correctly inherited, ${contS.length} were searched afresh, ${cont.filter(r=>!r.linked).length} unlinked`);
  const cn = contS.filter(r => r.v === 'NOQUOTE-ON-PAGE' || r.v === 'MISS' || r.v === 'WEAK').length;
  console.log(`  of the ${contS.length} freshly-searched continuation lines, ${cn} (${pct(cn, contS.length)}) landed on a line that does not contain their opening words`);

  console.log('\nBUCKETS   name                         n   %linked  %MISS  %NOQUOTE  %OK');
  const B = {
    "quotation has כו'": r => /(?:^|\s)ו?כו'/.test(norm(r.comm)),
    'quotation <=2 words': r => r.q.length <= 2,
    'quotation 3-4 words': r => r.q.length >= 3 && r.q.length <= 4,
    'quotation >=5 words': r => r.q.length >= 5,
    'opens שם': r => r.route === 'sham',
    'opens בא"ד': r => r.route === 'baad',
    'opens רש"י': r => r.route === 'rashi',
    "opens תוס'": r => r.route === 'tosafot',
    'opens גמ׳/משנה': r => r.route === 'gemara' || r.route === 'mishna',
    'continuation opener': r => r.cont,
    'no marker, not continuation': r => r.route === null && !r.cont,
    'abbrev-heavy (>=4 ")': r => (norm(r.comm).match(/"/g) || []).length >= 4,
    'page missing in Gemara': r => !r.hasSrcSeg,
    ALL: () => true,
  };
  for (const [nm, f] of Object.entries(B)) {
    const g = rows.filter(f); if (!g.length) continue;
    const s = g.filter(r => r.linked && !r.inh);
    console.log('  ' + nm.padEnd(30), String(g.length).padStart(4),
      pct(g.filter(r=>r.linked).length, g.length).padStart(8),
      pct(s.filter(r=>r.v==='MISS').length, s.length).padStart(6),
      pct(s.filter(r=>r.v==='NOQUOTE-ON-PAGE').length, s.length).padStart(9),
      pct(s.filter(r=>r.v==='OK').length, s.length).padStart(6));
  }
}

if (mode === 'list') {
  const want = rest[0] || 'MISS', n = Number(rest[1] || 20);
  const g = rows.filter(r => r.v === want);
  console.log(`${g.length} rows with verdict ${want}`);
  for (const r of g.slice(0, n)) {
    console.log(`--- L${r.ci} [${r.seg}] conf=${r.conf} route=${r.route}→${r.tgtBook}:${r.tgt} chosen(hit${r.chosen?.hit},run${r.chosen?.run}) best=${r.best?.ln}(hit${r.best?.hit},run${r.best?.run})`);
    console.log('  COMMENTARY OPENS: ' + r.q.join(' '));
    console.log('  LINKED TO       : ' + norm(r.tgtText).slice(0, 160));
    if (r.best && r.best.ln !== r.tgt) console.log('  SHOULD BE       : ' + norm(BOOK[r.tgtBook].lines[r.best.ln - 1] || '').slice(0, 160));
  }
}
