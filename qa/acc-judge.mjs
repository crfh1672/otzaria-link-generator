/**
 * ACCURACY QA — independent judge.
 * Re-reads the raw book .txt files, rebuilds the page (daf) index itself, and for every
 * link asks: given the commentary line's opening quotation, is the linked line the best
 * line on that page — or does a clearly better line exist?
 *
 *   node qa/acc-judge.mjs <dumpfile> <gemFile> <rashiFile> <tosFile> [mode] [args...]
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

/* ---------- text normalisation ---------- */
const strip = s => (s || '').replace(/<[^>]*>/g, ' ');
export const norm = s =>
  strip(s)
    .replace(/[֑-ׇ]/g, '')
    .replace(/[׳'’‘´]{2}/g, '"')
    .replace(/[׳'’‘´]/g, "'")
    .replace(/[״"“”″‟„]/g, '"')
    .replace(/[^א-ת0-9\s'"]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
const W = s => norm(s).split(' ').filter(Boolean);

/* ---------- page index straight from the .txt ---------- */
function pageIndex(file) {
  const lines = fs.readFileSync(path.join(DATA, file + '.txt'), 'utf8').split(/\r?\n/);
  const pages = new Map(); // normalized h2 title -> {start,end} 1-based inclusive of content
  let cur = null;
  lines.forEach((l, i) => {
    const m = l.trim().match(/<h2[^>]*>(.*?)<\/h2>/i);
    if (m) {
      if (cur) cur.end = i;
      cur = { title: norm(m[1]), start: i + 2, end: lines.length };
      if (!pages.has(cur.title)) pages.set(cur.title, cur);
    }
  });
  if (cur) cur.end = lines.length;
  return { lines, pages };
}
const [gemF, rashiF, tosF] = SETS[setName];
const BOOK = { gemara: pageIndex(gemF), rashi: pageIndex(rashiF), tosafot: pageIndex(tosF) };

/* ---------- the opening quotation ---------- */
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
  // cut at the first כו'/וכו'/וגו' — everything before it is the verbatim quotation
  const cut = w.findIndex(x => /^ו?כו'?$|^וגו'?$|^וגומר$|^וכולי$/.test(x));
  let q = cut > 0 ? w.slice(0, cut) : w.slice(0, maxW);
  if (q.length > maxW) q = q.slice(0, maxW);
  return q;
}

const STOP = new Set(
  ('של את זה הוא היא הם אם כי לא ולא אבל אלא או גם כן כך כמו על אל מן עד אחר לפי מה מי ומה דא הא הכא התם ליה לה להו דלא דהא ואם ואין אין יש אשר עם כל וכל אף ואף הך ומה וכן בו בה בהם אותו אותה זו זאת אותן וכו כו ה"ה ע"ש וגו הך').split(
    /\s+/
  )
);
const isContent = w => w.length > 1 && !STOP.has(w);

/* fuzzy word equality: handles כתיב חסר/מלא and prefix letters */
function wEq(a, b) {
  if (a === b) return true;
  if (a.length >= 4 && b.length >= 4) {
    if (a.startsWith(b) || b.startsWith(a)) return true;
    if (Math.abs(a.length - b.length) <= 1 && lev(a, b) <= 1) return true;
  }
  return false;
}
function lev(a, b) {
  const m = a.length, n = b.length;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++)
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[n];
}

/** how well quotation q matches candidate line text */
function score(q, tw) {
  if (!q.length || !tw.length) return { hit: 0, run: 0, s: 0, at: -1 };
  let hit = 0;
  for (const x of q) if (tw.some(y => wEq(x, y))) hit++;
  let run = 0, at = -1;
  for (let i = 0; i < q.length; i++)
    for (let j = 0; j < tw.length; j++) {
      let k = 0;
      while (i + k < q.length && j + k < tw.length && wEq(q[i + k], tw[j + k])) k++;
      if (k > run) { run = k; at = j; }
    }
  return { hit, run, at, s: hit + 2 * run };
}

/* ---------- judge every link ---------- */
const cacheW = new Map();
const wordsOf = (book, ln) => {
  const k = book + ':' + ln;
  let v = cacheW.get(k);
  if (!v) { v = W(BOOK[book].lines[ln - 1] || ''); cacheW.set(k, v); }
  return v;
};

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

for (const r of rows) {
  r.route = routeOf(r.comm);
  r.q = quotation(r.comm);
  r.qc = r.q.filter(isContent);
  r.nw = W(r.comm).length;
  if (!r.linked) continue;
  const book = r.tgtBook;
  const page = BOOK[book]?.pages.get(norm(r.seg));
  r.chosen = score(r.q, wordsOf(book, r.tgt));
  r.best = null;
  if (page) {
    let best = { s: -1 };
    for (let ln = page.start; ln <= page.end; ln++) {
      const sc = score(r.q, wordsOf(book, ln));
      if (sc.s > best.s) best = { ...sc, ln };
    }
    r.best = best;
  }
}

/* verdict — only SEARCHED (non-inherited) links can be judged by the quotation.
   INHERIT = carry-over of the previous line's link; no quotation of its own to check. */
for (const r of rows) {
  if (!r.linked) { r.v = 'none'; continue; }
  if (r.inh) { r.v = 'INHERIT'; continue; }
  if (!r.best) { r.v = 'nopage'; continue; }
  if (r.q.length < 2) { r.v = 'noquote'; continue; }
  const strong = r.chosen.run >= 2 || r.chosen.hit >= 3;
  const betterExists = r.best.ln !== r.tgt && r.best.run >= 2 && r.best.s - r.chosen.s >= 3;
  if (betterExists) r.v = strong ? 'AMBIG' : 'WRONG';
  else if (strong) r.v = 'OK';
  else r.v = 'WEAK'; // quotation not literally locatable anywhere on the page
}

const pct = (a, b) => (b ? ((100 * a) / b).toFixed(1) + '%' : '-');
const linked = rows.filter(r => r.linked);

if (mode === 'summary') {
  console.log(`FILE ${path.basename(dumpFile)}  set=${setName}`);
  console.log(`pages(comm)=${meta.nCommSegs} pages(gem)=${meta.nSrcSegs}  content lines=${rows.length}  links=${linked.length} (${pct(linked.length, rows.length)})`);
  const tal = {};
  for (const r of rows) tal[r.v] = (tal[r.v] || 0) + 1;
  console.log('VERDICTS', JSON.stringify(tal));
  const searched = linked.filter(r => !r.inh);
  const judged = searched.filter(r => ['OK','WRONG','AMBIG','WEAK'].includes(r.v));
  const wrong = searched.filter(r => r.v === 'WRONG');
  const amb = searched.filter(r => r.v === 'AMBIG');
  const weak = searched.filter(r => r.v === 'WEAK');
  console.log(`searched links ${searched.length}; inherited ${linked.length - searched.length} (${pct(linked.length - searched.length, linked.length)})`);
  console.log(`  judgeable ${judged.length}: OK ${judged.length - wrong.length - amb.length - weak.length} (${pct(judged.length - wrong.length - amb.length - weak.length, judged.length)}), WRONG ${wrong.length} (${pct(wrong.length, judged.length)}), AMBIG ${amb.length}, WEAK/unverifiable ${weak.length} (${pct(weak.length, judged.length)})`);

  console.log('\n=== CONFIDENCE CALIBRATION ===');
  console.log('band       n    share   %WRONG  %OK   meanRun  %exact-best-line  %inherited');
  for (const [lo, hi, nm] of [[98, 100, '98'], [88, 97, '88-97'], [76, 87, '76-87'], [70, 75, '70-75'], [60, 69, '60-69'], [0, 59, '<60']]) {
    const g = linked.filter(r => r.conf >= lo && r.conf <= hi);
    if (!g.length) continue;
    const jg = g.filter(r => r.best);
    console.log(
      nm.padEnd(9), String(g.length).padStart(4), pct(g.length, linked.length).padStart(7),
      pct(g.filter(r => r.v === 'WRONG').length, Math.max(1,g.filter(r=>!r.inh).length)).padStart(8),
      pct(g.filter(r => r.v === 'OK').length, Math.max(1,g.filter(r=>!r.inh).length)).padStart(6),
      (g.reduce((s, r) => s + (r.chosen?.run || 0), 0) / g.length).toFixed(2).padStart(8),
      pct(jg.filter(r => r.tgt === r.best.ln).length, jg.length).padStart(17),
      pct(g.filter(r => r.inh).length, g.length).padStart(11)
    );
  }

  console.log('\n=== ROUTING (what the line says vs. which book it was linked into) ===');
  for (const rt of ['rashi', 'tosafot', 'gemara', 'mishna', 'baad', 'sham', null]) {
    const g = rows.filter(r => r.route === rt);
    if (!g.length) continue;
    const t = {};
    for (const r of g) t[r.linked ? r.tgtBook : 'NO-LINK'] = (t[r.linked ? r.tgtBook : 'NO-LINK'] || 0) + 1;
    console.log(`${String(rt).padEnd(8)} ${String(g.length).padStart(4)} lines →`, JSON.stringify(t));
  }
  const rMis = rows.filter(r => r.route === 'rashi' && r.linked && r.tgtBook !== 'rashi');
  const tMis = rows.filter(r => r.route === 'tosafot' && r.linked && r.tgtBook !== 'tosafot');
  console.log(`ROUTING ERRORS: רש"י-lines landing outside Rashi: ${rMis.length}; תוס'-lines outside Tosafot: ${tMis.length}`);

  console.log('\n=== PATTERN BUCKETS ===');
  const B = {
    "quotation contains כו'": r => /(?:^|\s)ו?כו'/.test(norm(r.comm)),
    'short quotation (<=2 words)': r => r.q.length <= 2,
    'medium quotation (3-4)': r => r.q.length >= 3 && r.q.length <= 4,
    'long quotation (>=5)': r => r.q.length >= 5,
    'starts שם': r => r.route === 'sham',
    "starts בא\"ד / א\"ד": r => r.route === 'baad',
    'names רש"י': r => r.route === 'rashi',
    "names תוס'": r => r.route === 'tosafot',
    'names גמ׳/משנה': r => r.route === 'gemara' || r.route === 'mishna',
    'no marker at all': r => r.route === null,
    'abbrev-heavy (>=4 gershayim)': r => (norm(r.comm).match(/"/g) || []).length >= 4,
    'page absent from Gemara': r => !r.hasSrcSeg,
    ALL: () => true,
  };
  console.log('bucket                          n  %linked  %WRONG(of searched)  %OK  %searched');
  for (const [nm, f] of Object.entries(B)) {
    const g = rows.filter(f);
    if (!g.length) continue;
    const lk = g.filter(r => r.linked);
    const jg = lk.filter(r => r.best);
    console.log(
      nm.padEnd(30), String(g.length).padStart(4), pct(lk.length, g.length).padStart(8),
      pct(lk.filter(r => r.v === 'WRONG').length, lk.filter(r=>!r.inh).length).padStart(18),
      pct(lk.filter(r => r.v === 'OK').length, lk.filter(r=>!r.inh).length).padStart(6),
      pct(lk.filter(r=>!r.inh).length, lk.length).padStart(11)
    );
  }

  console.log('\n=== COLLISIONS ===');
  const byT = new Map();
  for (const r of linked) {
    const k = r.seg + '|' + r.tgtBook + '|' + r.tgt;
    if (!byT.has(k)) byT.set(k, []);
    byT.get(k).push(r);
  }
  const coll = [...byT.values()].filter(v => v.length > 1);
  console.log(`${coll.length} target lines carry >1 commentary line  (${coll.reduce((s, v) => s + v.length, 0)} links, ${pct(coll.reduce((s, v) => s + v.length, 0), linked.length)})`);
  const real = coll.filter(v => v.filter(r => !r.inh).length > 1);
  console.log(`  ${real.length} groups where >=2 links were SEARCHED (not inherited): ${real.reduce((s, v) => s + v.filter(r => !r.inh).length, 0)} links`);
  const h = {}; for (const v of coll) h[v.length] = (h[v.length] || 0) + 1;
  console.log('  group sizes', JSON.stringify(h));

  console.log('\n=== ORDERING ===');
  let back = 0, fwd = 0, big = 0; let prev = null;
  const backs = [];
  for (const r of rows) {
    if (!r.linked || r.inh) continue;
    if (prev && prev.seg === r.seg && prev.tgtBook === r.tgtBook) {
      if (r.tgt < prev.tgt) { back++; if (prev.tgt - r.tgt >= 3) { big++; backs.push([prev, r]); } } else fwd++;
    }
    prev = r;
  }
  console.log(`consecutive same-page same-book pairs: forward/equal ${fwd}, backwards ${back} (${pct(back, back + fwd)}), backwards by >=3 lines ${big}`);
  const bw = backs.filter(([, b]) => b.v === 'WRONG').length;
  console.log(`  of the ${big} big backwards jumps, ${bw} are also judged WRONG`);
}

if (mode === 'list') {
  const want = rest[0] || 'WRONG';
  const n = Number(rest[1] || 20);
  const g = rows.filter(r => r.v === want);
  console.log(`${g.length} rows with verdict ${want}`);
  for (const r of g.slice(0, n)) {
    console.log(`--- L${r.ci} [${r.seg}] conf=${r.conf} ${r.st} inh=${r.inh} route=${r.route}→${r.tgtBook}:${r.tgt} chosen(hit${r.chosen?.hit},run${r.chosen?.run}) best=line ${r.best?.ln}(hit${r.best?.hit},run${r.best?.run})`);
    console.log('  QUOTE : ' + r.q.join(' '));
    console.log('  LINKED: ' + norm(r.tgtText).slice(0, 165));
    if (r.best && r.best.ln !== r.tgt) console.log('  BETTER: ' + norm(BOOK[r.tgtBook].lines[r.best.ln - 1] || '').slice(0, 165));
  }
}

if (mode === 'unlinked') {
  const n = Number(rest[0] || 30);
  const g = rows.filter(r => !r.linked);
  const t = {}; for (const r of g) t[r.route] = (t[r.route] || 0) + 1;
  console.log(`${g.length} unlinked lines; by marker`, JSON.stringify(t));
  // could a match have been found?
  let couldGem = 0;
  for (const r of g) {
    const pg = BOOK.gemara.pages.get(norm(r.seg));
    if (!pg) continue;
    let best = { s: -1 };
    for (let ln = pg.start; ln <= pg.end; ln++) { const sc = score(r.q, wordsOf('gemara', ln)); if (sc.s > best.s) best = { ...sc, ln }; }
    r.gbest = best;
    if (best.run >= 2) couldGem++;
  }
  console.log(`of these, ${couldGem} have a Gemara line on the same page matching >=2 consecutive quotation words (i.e. a findable match was missed)`);
  for (const r of g.slice(0, n))
    console.log(`--- L${r.ci} [${r.seg}] route=${r.route} q="${r.q.join(' ')}" bestGem=line ${r.gbest?.ln} run=${r.gbest?.run} hit=${r.gbest?.hit}\n  COMM: ${norm(r.comm).slice(0, 170)}${r.gbest?.run >= 2 ? '\n  GEM : ' + norm(BOOK.gemara.lines[r.gbest.ln - 1]).slice(0, 170) : ''}`);
}

if (mode === 'sample') {
  const lo = Number(rest[0] ?? 0), hi = Number(rest[1] ?? 100), n = Number(rest[2] ?? 12);
  const g = linked.filter(r => r.conf >= lo && r.conf <= hi);
  const step = Math.max(1, Math.floor(g.length / n));
  for (let i = 0, c = 0; i < g.length && c < n; i += step, c++) {
    const r = g[i];
    console.log(`--- L${r.ci} [${r.seg}] conf=${r.conf} inh=${r.inh} route=${r.route}→${r.tgtBook}:${r.tgt} v=${r.v} run=${r.chosen.run} hit=${r.chosen.hit}/${r.q.length} best=${r.best?.ln}`);
    console.log('  QUOTE : ' + r.q.join(' '));
    console.log('  LINKED: ' + norm(r.tgtText).slice(0, 175));
  }
}

if (mode === 'coll') {
  const byT = new Map();
  for (const r of linked) { const k = r.seg + '|' + r.tgtBook + '|' + r.tgt; if (!byT.has(k)) byT.set(k, []); byT.get(k).push(r); }
  const coll = [...byT.values()].filter(v => v.filter(r => !r.inh).length > 1);
  for (const v of coll.slice(0, Number(rest[0] || 8))) {
    console.log(`=== ${v[0].seg} ${v[0].tgtBook}:${v[0].tgt}`);
    console.log('  TGT : ' + norm(v[0].tgtText).slice(0, 160));
    for (const r of v) console.log(`   L${r.ci} conf=${r.conf} inh=${r.inh} v=${r.v} q="${r.q.join(' ')}"`);
  }
}
