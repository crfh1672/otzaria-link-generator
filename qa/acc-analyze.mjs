/** ACCURACY QA analyzer — reads the dump from acc-dump.ts. node qa/acc-analyze.mjs <file> [mode] */
import fs from 'fs';

const file = process.argv[2];
const mode = process.argv[3] || 'summary';
const { meta, rows } = JSON.parse(fs.readFileSync(file, 'utf8'));

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
const words = s => norm(s).split(' ').filter(Boolean);

// leading citation prefixes the engine strips
const PREFIX = /^(?:בגמרא|גמרא|גמ'|במשנה|משנה|מתניתין|מתני'|פיסקא|בפיסקא|שם|בפירש"י|פירש"י|בפרש"י|פרש"י|ברש"י|רש"י|רשי|בתוספות|תוספות|בתוס'|תוס'|בתוס|תוס|בתו'|תו'|תוד"ה|בתוד"ה|רשד"ה|בד"ה|ד"ה|בא"ד|א"ד|באו"ד|או"ד|אד|באד)\s*/;
function dhWords(comm) {
  let w = words(comm);
  // strip up to 3 leading prefix tokens
  for (let k = 0; k < 4; k++) {
    const j = w.join(' ');
    const m = j.match(PREFIX);
    if (!m) break;
    w = j.slice(m[0].length).split(' ').filter(Boolean);
  }
  return w;
}

const STOP = new Set(('של את זה הוא היא הם אם כי לא ולא אבל אלא או גם כן כך כמו על אל מן מ ב ל ו ש כ ה עד אחר לפי מה מי ומה ד דא הא הכא התם ליה לה להו דלא דהא ואם ואין אין יש אשר עם כל וכל אף ואף הך דהך ומה וכן דבר לומר דאמר אמר ואמר הרי והרי בו בה בהם אותו אותה זו זאת אותן וכו כו ה"ה ע"ש וגו').split(/\s+/));
const content = ws => ws.filter(w => w.length > 1 && !STOP.has(w));

function overlapStats(comm, tgt) {
  const d = dhWords(comm);
  const t = new Set(words(tgt));
  const dc = content(d);
  const head = dc.slice(0, 4);
  const headHit = head.filter(w => t.has(w)).length;
  const allHit = dc.filter(w => t.has(w)).length;
  // longest contiguous run of DH words (incl. stopwords) present in target sequence
  const tw = words(tgt);
  let best = 0;
  for (let i = 0; i < d.length; i++) {
    for (let j = 0; j < tw.length; j++) {
      let k = 0;
      while (i + k < d.length && j + k < tw.length && d[i + k] === tw[j + k]) k++;
      if (k > best) best = k;
    }
  }
  return {
    dhLen: dc.length,
    headHit, headLen: head.length,
    allHit,
    frac: dc.length ? allHit / dc.length : 0,
    headFrac: head.length ? headHit / head.length : 0,
    run: best,
  };
}

const routeOf = c => {
  const w = norm(c);
  const s = w.replace(/^(?:בגמרא|גמרא|גמ'|במשנה|משנה|מתניתין|מתני')\s*/, '');
  if (/^(?:ב?פירש"י|ב?פרש"י|ב?רש"י|ב?רשי|רשד"ה|ברשד"ה)\b/.test(s)) return 'rashi';
  if (/^(?:ב?תוספות|ב?תוסות|ב?תוס'|ב?תוס|ב?תו'|ב?תוד"ה)\b/.test(s)) return 'tosafot';
  if (/^(?:בגמרא|גמרא|גמ'|פיסקא|בפיסקא)\b/.test(w)) return 'gemara';
  if (/^(?:במשנה|משנה|מתניתין|מתני')\b/.test(w)) return 'mishna';
  return null;
};

for (const r of rows) {
  r.route = routeOf(r.comm);
  r.o = r.linked ? overlapStats(r.comm, r.tgtText) : null;
  r.nw = words(r.comm).length;
}

const pct = (a, b) => (b ? ((100 * a) / b).toFixed(1) + '%' : '-');
const linked = rows.filter(r => r.linked);
const unlinked = rows.filter(r => !r.linked);

if (mode === 'summary') {
  console.log('META', JSON.stringify({ ...meta, commSegTitles: undefined, srcSegTitles: undefined }));
  console.log(`\ncontent lines ${rows.length}  linked ${linked.length} (${pct(linked.length, rows.length)})  unlinked ${unlinked.length}`);
  const inh = linked.filter(r => r.inh);
  console.log(`inherited ${inh.length} (${pct(inh.length, linked.length)} of links)`);

  // Confidence bands
  const bands = [[98, 100], [88, 97], [76, 87], [70, 75], [60, 69], [0, 59]];
  console.log('\n=== CONFIDENCE BANDS (proxy correctness = DH content-word overlap with target line) ===');
  console.log('band        n     %links  meanFrac  frac>=.6  frac<=.2  run>=3  inherited');
  for (const [lo, hi] of bands) {
    const g = linked.filter(r => r.conf >= lo && r.conf <= hi);
    if (!g.length) continue;
    const mf = g.reduce((s, r) => s + r.o.frac, 0) / g.length;
    console.log(
      `${lo}-${hi}`.padEnd(10),
      String(g.length).padStart(4),
      pct(g.length, linked.length).padStart(8),
      mf.toFixed(2).padStart(8),
      pct(g.filter(r => r.o.frac >= 0.6).length, g.length).padStart(9),
      pct(g.filter(r => r.o.frac <= 0.2).length, g.length).padStart(8),
      pct(g.filter(r => r.o.run >= 3).length, g.length).padStart(7),
      pct(g.filter(r => r.inh).length, g.length).padStart(9)
    );
  }

  console.log('\n=== ROUTING ===');
  for (const rt of ['rashi', 'tosafot', 'gemara', 'mishna', null]) {
    const g = rows.filter(r => r.route === rt);
    if (!g.length) continue;
    const lk = g.filter(r => r.linked);
    const tally = {};
    for (const r of lk) tally[r.tgtBook] = (tally[r.tgtBook] || 0) + 1;
    console.log(`${String(rt)}: ${g.length} lines, linked ${lk.length} → ${JSON.stringify(tally)}`);
  }

  console.log('\n=== COLLISIONS (same target line used by >1 commentary line, same page) ===');
  const byT = new Map();
  for (const r of linked) {
    const k = r.seg + '|' + r.tgtBook + '|' + r.tgt;
    if (!byT.has(k)) byT.set(k, []);
    byT.get(k).push(r);
  }
  const coll = [...byT.values()].filter(v => v.length > 1);
  const collLines = coll.reduce((s, v) => s + v.length, 0);
  console.log(`${coll.length} target lines shared by ${collLines} commentary lines (${pct(collLines, linked.length)} of links)`);
  const collNonInh = coll.filter(v => v.filter(r => !r.inh).length > 1);
  console.log(`  of which ${collNonInh.length} groups have >1 NON-inherited link (real duplicate searches): ${collNonInh.reduce((s, v) => s + v.filter(r => !r.inh).length, 0)} lines`);
  const hist = {};
  for (const v of coll) hist[v.length] = (hist[v.length] || 0) + 1;
  console.log('  group-size histogram', JSON.stringify(hist));

  console.log('\n=== ORDERING (backwards jumps within a page, same target book, non-inherited) ===');
  let back = 0, fwd = 0, bigBack = 0;
  let prev = null;
  for (const r of rows) {
    if (!r.linked || r.inh) { continue; }
    if (prev && prev.seg === r.seg && prev.tgtBook === r.tgtBook) {
      if (r.tgt < prev.tgt) { back++; if (prev.tgt - r.tgt >= 3) bigBack++; } else fwd++;
    }
    prev = r;
  }
  console.log(`forward/equal ${fwd}, backwards ${back} (${pct(back, back + fwd)}), backwards by >=3 lines ${bigBack}`);

  console.log('\n=== FAILURE PATTERN BUCKETS ===');
  const buckets = {
    "has כו'/וכו'": r => /כו'|וכו'|וגו'/.test(norm(r.comm)),
    'short line (<=5 words)': r => r.nw <= 5,
    'starts שם': r => /^שם\b/.test(norm(r.comm)),
    "starts בא\"ד/א\"ד": r => /^(?:בא"ד|א"ד|באו"ד|או"ד)\b/.test(norm(r.comm)),
    'routes rashi': r => r.route === 'rashi',
    'routes tosafot': r => r.route === 'tosafot',
    'routes gemara/mishna': r => r.route === 'gemara' || r.route === 'mishna',
    'no route marker': r => r.route === null,
    'heavy abbrev (>=3 quotes)': r => (norm(r.comm).match(/"/g) || []).length >= 3,
    'page missing in source': r => !r.hasSrcSeg,
    ALL: () => true,
  };
  console.log('bucket                        n   linked  meanFrac  bad(frac<=.2)  %bad');
  for (const [name, f] of Object.entries(buckets)) {
    const g = rows.filter(f);
    const lk = g.filter(r => r.linked);
    if (!g.length) continue;
    const mf = lk.length ? lk.reduce((s, r) => s + r.o.frac, 0) / lk.length : 0;
    const bad = lk.filter(r => r.o.frac <= 0.2).length;
    console.log(
      name.padEnd(28),
      String(g.length).padStart(4),
      pct(lk.length, g.length).padStart(7),
      mf.toFixed(2).padStart(9),
      String(bad).padStart(14),
      pct(bad, lk.length).padStart(6)
    );
  }
}

if (mode === 'sample') {
  const lo = Number(process.argv[4] ?? 0), hi = Number(process.argv[5] ?? 100), n = Number(process.argv[6] ?? 15);
  const g = linked.filter(r => r.conf >= lo && r.conf <= hi);
  const step = Math.max(1, Math.floor(g.length / n));
  for (let i = 0; i < g.length && i / step < n; i += step) {
    const r = g[i];
    console.log(`--- L${r.ci} [${r.seg}] conf=${r.conf} ${r.st} inh=${r.inh} route=${r.route}→${r.tgtBook}:${r.tgt} frac=${r.o.frac.toFixed(2)} run=${r.o.run}`);
    console.log('  COMM: ' + norm(r.comm).slice(0, 190));
    console.log('  TGT : ' + norm(r.tgtText).slice(0, 190));
  }
}

if (mode === 'bad') {
  const n = Number(process.argv[4] ?? 25);
  const g = linked.filter(r => r.o.frac <= 0.25).sort((a, b) => b.conf - a.conf);
  console.log(`${g.length} links with content-word overlap <= 0.25`);
  for (const r of g.slice(0, n)) {
    console.log(`--- L${r.ci} [${r.seg}] conf=${r.conf} ${r.st} inh=${r.inh} route=${r.route}→${r.tgtBook}:${r.tgt} frac=${r.o.frac.toFixed(2)} run=${r.o.run}`);
    console.log('  COMM: ' + norm(r.comm).slice(0, 200));
    console.log('  TGT : ' + norm(r.tgtText).slice(0, 200));
  }
}

if (mode === 'unlinked') {
  const n = Number(process.argv[4] ?? 30);
  console.log(`${unlinked.length} unlinked content lines`);
  for (const r of unlinked.slice(0, n)) {
    console.log(`--- L${r.ci} [${r.seg}] hasSrcSeg=${r.hasSrcSeg} route=${r.route} nw=${r.nw}`);
    console.log('  COMM: ' + norm(r.comm).slice(0, 220));
  }
}

if (mode === 'coll') {
  const byT = new Map();
  for (const r of linked) {
    const k = r.seg + '|' + r.tgtBook + '|' + r.tgt;
    if (!byT.has(k)) byT.set(k, []);
    byT.get(k).push(r);
  }
  const coll = [...byT.values()].filter(v => v.filter(r => !r.inh).length > 1);
  for (const v of coll.slice(0, Number(process.argv[4] ?? 10))) {
    console.log(`=== ${v[0].seg} ${v[0].tgtBook}:${v[0].tgt}  (${v.length} lines)`);
    console.log('  TGT : ' + norm(v[0].tgtText).slice(0, 170));
    for (const r of v) console.log(`   L${r.ci} conf=${r.conf} inh=${r.inh} frac=${r.o.frac.toFixed(2)} :: ` + norm(r.comm).slice(0, 130));
  }
}
