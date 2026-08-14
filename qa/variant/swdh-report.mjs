/**
 * SWDH SIMULATION REPORT — baseline vs. one or more settings of the single-word first-word
 * anchor, over N books, in one page.
 *
 * Reads dumps written by qa/variant/swdh-dump.ts and lists every commentary line whose link
 * changed under ANY of the settings (appeared, disappeared, moved, or stopped being an
 * inherited guess), with an independent verdict on every side.
 *
 *   node qa/variant/swdh-report.mjs <out.html> "<set>:<label>=<off.json>,<on1.json>[,<on2.json>…]" …
 *
 * The verdict is NOT one of the engine's own signals: it re-reads the target book from the
 * fixtures and scores the commentary line's opening quote against every line of the matching
 * daf, exactly as qa/acc-judge.mjs does (judge core copied verbatim below — importing it would
 * run its own main()).
 */
import fs from 'fs';
import path from 'path';

const [outFile, ...specs] = process.argv.slice(2);
const DATA = process.env.QA_DATA || path.join(process.cwd(), 'qa', 'data');
const SETS = {
  'py-berachot': ['gem_berachot', 'rashi_berachot', 'tos_berachot'],
  'py-shabbat': ['gem_shabbat', 'rashi_shabbat', 'tos_shabbat'],
  'by-berachot': ['gem_berachot', 'rashi_berachot', 'tos_berachot'],
};

/* ================= judge core — copied from qa/acc-judge.mjs ================= */
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
    if (m) {
      if (cur) cur.end = i;
      cur = { title: norm(m[1]), start: i + 2, end: lines.length };
      if (!pages.has(cur.title)) pages.set(cur.title, cur);
    }
  });
  if (cur) cur.end = lines.length;
  return { lines, pages };
}

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
function wEq(a, b) {
  if (a === b) return true;
  if (a.length >= 4 && b.length >= 4) {
    if (a.startsWith(b) || b.startsWith(a)) return true;
    if (Math.abs(a.length - b.length) <= 1 && lev(a, b) <= 1) return true;
  }
  return false;
}
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

/* ================= rendering helpers ================= */
const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
/**
 * Book text carries its own markup, and in these books <b> is meaningful — it is how the
 * Dibur Hamatchil is marked. So: keep bold, drop every other tag, escape the rest, and clip on
 * VISIBLE length so a cut can never land inside markup.
 */
const B1 = '', B2 = '';
const rich = (s, n) => {
  let t = String(s ?? '')
    .replace(/<\s*(b|strong)\s*>/gi, B1)
    .replace(/<\s*\/\s*(b|strong)\s*>/gi, B2)
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (t.replace(/[]/g, '').length > n) {
    let out = '', vis = 0;
    for (const ch of t) {
      if (ch !== B1 && ch !== B2) { if (vis >= n) break; vis++; }
      out += ch;
    }
    t = out + '…';
  }
  const html = esc(t).split(B1).join('<b>').split(B2).join('</b>');
  const open = (html.match(/<b>/g) || []).length - (html.match(/<\/b>/g) || []).length;
  return open > 0 ? html + '</b>'.repeat(open) : html;
};

const BOOKNAME = { gemara: 'גמרא', rashi: 'רש״י', tosafot: 'תוספות', primary: 'גמרא' };
const VERD = {
  OK: ['ok', 'נכון'], WRONG: ['bad', 'שגוי'], AMBIG: ['amb', 'דו־משמעי'],
  WEAK: ['weak', 'לא ניתן לאימות'], INHERIT: ['inh', 'ירושה'],
  nopage: ['weak', 'אין דף מקביל'], noquote: ['weak', 'אין ציטוט'], none: ['none', '—'],
};
const RANK = { OK: 3, AMBIG: 2, WEAK: 1, WRONG: 0 };
const judged = v => v in RANK;
const pc = (a, b) => (b ? ((100 * a) / b).toFixed(0) + '%' : '—');
const sameTarget = (x, y) => x.linked === y.linked && x.tgt === y.tgt && x.tgtBook === y.tgtBook;
const settingLabel = m =>
  `${(m.swdhRatio * 100).toFixed(2).replace(/\.?0+$/, '')}%` + (m.swdhUnique ? ' + ייחודיות' : '');

/* ================= per-book comparison ================= */
const books = [];

for (const spec of specs) {
  const eq = spec.indexOf('=');
  const [setName, label] = spec.slice(0, eq).split(':');
  const files = spec.slice(eq + 1).split(',');
  const dumps = files.map(f => JSON.parse(fs.readFileSync(f, 'utf8')));
  const OFF = dumps[0];
  const ONS = dumps.slice(1);

  const [gemF, rashiF, tosF] = SETS[setName];
  const BOOK = { gemara: pageIndex(gemF), rashi: pageIndex(rashiF), tosafot: pageIndex(tosF) };
  const cacheW = new Map();
  const wordsOf = (bk, ln) => {
    const k = bk + ':' + ln;
    let v = cacheW.get(k);
    if (!v) { v = W(BOOK[bk].lines[ln - 1] || ''); cacheW.set(k, v); }
    return v;
  };
  const judgeCache = new Map();
  function judge(r) {
    if (!r.linked) return { v: 'none', q: quotation(r.comm) };
    if (r.inh) return { v: 'INHERIT', q: quotation(r.comm) };
    const key = r.ci + '|' + r.tgtBook + '|' + r.tgt;
    if (judgeCache.has(key)) return judgeCache.get(key);
    const page = BOOK[r.tgtBook]?.pages.get(norm(r.seg));
    const q = quotation(r.comm);
    const chosen = score(q, wordsOf(r.tgtBook, r.tgt));
    let best = null;
    if (page) {
      let b = { s: -1 };
      for (let ln = page.start; ln <= page.end; ln++) {
        const sc = score(q, wordsOf(r.tgtBook, ln));
        if (sc.s > b.s) b = { ...sc, ln };
      }
      best = b;
    }
    let out;
    if (!best) out = { v: 'nopage', chosen, q };
    else if (q.length < 2) out = { v: 'noquote', chosen, best, q };
    else {
      const strong = chosen.run >= 2 || chosen.hit >= 3;
      const betterExists = best.ln !== r.tgt && best.run >= 2 && best.s - chosen.s >= 3;
      out = { v: betterExists ? (strong ? 'AMBIG' : 'WRONG') : (strong ? 'OK' : 'WEAK'), chosen, best, q };
    }
    judgeCache.set(key, out);
    return out;
  }

  const byCi = dumps.map(d => new Map(d.rows.map(r => [r.ci, r])));
  const cis = [...new Set(dumps.flatMap(d => d.rows.map(r => r.ci)))].sort((a, b) => a - b);

  const diffs = [];
  const tallies = ONS.map(() => ({
    added: 0, lost: 0, moved: 0, confirmed: 0,
    better: 0, worse: 0, neutral: 0, confOk: 0, confBad: 0, cascade: 0,
  }));

  for (const ci of cis) {
    const rows = byCi.map(m => m.get(ci));
    if (rows.some(r => !r)) continue;
    const a = rows[0];
    if (rows.every(r => sameTarget(r, a) && r.inh === a.inh)) continue;

    const js = rows.map(judge);
    const dirs = rows.map((b, i) => {
      if (i === 0) return 'base';
      if (sameTarget(b, a) && b.inh === a.inh) return 'same';
      const T = tallies[i - 1];
      // `confirmed` — the target did not move; the line simply stopped being an inherited
      // guess and became a link resting on its own anchor.
      const kind = !a.linked && b.linked ? 'added' : a.linked && !b.linked ? 'lost'
        : sameTarget(a, b) ? 'confirmed' : 'moved';
      T[kind]++;
      if (!b.swdh) T.cascade++;

      // better/worse compare TARGETS. A `confirmed` row points at the same line as before, so
      // there is nothing to compare — counted separately, because calling it an improvement
      // would be comparing a verdict against no verdict rather than one target against another.
      let d = 'neutral';
      if (kind === 'confirmed') {
        d = judged(js[i].v) ? (RANK[js[i].v] >= 2 ? 'confOk' : RANK[js[i].v] === 0 ? 'confBad' : 'neutral') : 'neutral';
      } else if (judged(js[0].v) && judged(js[i].v)) {
        if (RANK[js[i].v] > RANK[js[0].v]) d = 'better';
        else if (RANK[js[i].v] < RANK[js[0].v]) d = 'worse';
      } else if (!judged(js[0].v) && judged(js[i].v)) {
        d = RANK[js[i].v] >= 2 ? 'better' : RANK[js[i].v] === 0 ? 'worse' : 'neutral';
      } else if (judged(js[0].v) && !judged(js[i].v)) {
        d = RANK[js[0].v] >= 2 ? 'worse' : 'neutral';
      }
      T[d]++;
      return d;
    });

    const nb = dirs.slice(1);
    const rowDir = nb.includes('better') && nb.includes('worse') ? 'mixed'
      : nb.includes('better') || nb.includes('confOk') ? 'better'
      : nb.includes('worse') || nb.includes('confBad') ? 'worse'
      : 'neutral';
    diffs.push({ ci, rows, js, dirs, rowDir });
  }

  // Independent corroboration, per setting: does the judge's own preferred line on that daf
  // agree with the line the anchor picked? Split by how ambiguous the anchor was in the daf.
  const perVariant = ONS.map(ON => {
    const fired = ON.rows.filter(r => r.swdh);
    let agree = 0, disagree = 0, unknown = 0;
    const byCand = { '1': { n: 0, a: 0, d: 0, u: 0 }, '2-3': { n: 0, a: 0, d: 0, u: 0 }, '4+': { n: 0, a: 0, d: 0, u: 0 } };
    for (const r of fired) {
      const j = judge(r);
      const k = r.swdh.candidates === 1 ? '1' : r.swdh.candidates <= 3 ? '2-3' : '4+';
      byCand[k].n++;
      if (!j.best || j.best.run < 2) { unknown++; byCand[k].u++; }
      else if (j.best.ln === r.tgt) { agree++; byCand[k].a++; }
      else { disagree++; byCand[k].d++; }
    }
    return { ON, fired, agree, disagree, unknown, byCand, label: settingLabel(ON.meta) };
  });

  books.push({ setName, label: label || OFF.meta.label, OFF, ONS, BOOK, diffs, tallies, perVariant });
}

/* ================= HTML ================= */
function cell(r, j, allRows, BOOK) {
  if (!r.linked) return `<div class="tgt none">— ללא קישור —</div>`;
  const diff = allRows.some(o => !sameTarget(o, r));
  const [cls, lab] = VERD[j.v] || ['weak', j.v];
  const better = j.best && j.best.ln !== r.tgt && j.best.run >= 2 && j.v !== 'OK'
    ? `<div class="better"><b>השורה שהשופט מעדיף (${j.best.ln}):</b> ${rich(BOOK[r.tgtBook].lines[j.best.ln - 1], 170)}</div>`
    : '';
  const f = r.swdh
    ? `<div class="fire">עוגן <code>${esc(r.swdh.anchor)}</code> · ${(r.swdh.openingRatio * 100).toFixed(2)}% · ${r.swdh.candidates === 1 ? 'שורה אחת בדף' : r.swdh.candidates + ' שורות בדף'}</div>`
    : '';
  return `<div class="tgt ${diff ? 'diff' : ''}">` +
    `<span class="ref">${BOOKNAME[r.tgtBook] || r.tgtBook} ${r.tgt}</span>` +
    `<span class="v ${cls}">${lab}</span>` +
    (r.inh ? `<span class="tag">ירושה</span>` : '') +
    ` <span class="tag">${r.conf ?? '—'}%</span>${f}` +
    `<div class="src">${rich(r.tgtText, 230)}</div>${better}</div>`;
}

const KIND = {
  added: ['add', 'קישור חדש'], lost: ['lost', 'קישור אבד'],
  moved: ['move', 'הוסט'], confirmed: ['add', 'ירושה → עוגן'],
};
const DIR = {
  better: ['better', '▲ שיפור'], worse: ['worse', '▼ הרעה'], neutral: ['neutral', '● שקול'],
  confOk: ['better', '◇ אותו יעד, השופט מאשר'], confBad: ['worse', '◇ אותו יעד, השופט חולק'],
  same: ['neutral', '= ללא שינוי'], base: ['neutral', ''],
};

const sections = books.map(B => {
  const nV = B.ONS.length;
  const rowsHtml = B.diffs.map(d => {
    const anchorNote = d.rows.slice(1).some(r => r.swdh)
      ? ''
      : `<div class="anchor cascade">גרר — השורה עצמה לא הפעילה את המנגנון; היעד שלה זז כי שורה קודמת השתנתה</div>`;
    const cells = d.rows.map((r, i) => {
      const tags = i === 0 ? '' :
        (() => {
          const dd = d.dirs[i];
          if (dd === 'same') return `<div class="k neutral">= כמו לפני</div>`;
          const a = d.rows[0];
          const kind = !a.linked && r.linked ? 'added' : a.linked && !r.linked ? 'lost'
            : sameTarget(a, r) ? 'confirmed' : 'moved';
          const [kc, kl] = KIND[kind];
          const [dc, dl] = DIR[dd] || ['neutral', dd];
          return `<div class="k ${kc}">${kl}</div><div class="k ${dc}">${dl}</div>`;
        })();
      return `<td class="tgt-c">${tags}${cell(r, d.js[i], d.rows, B.BOOK)}</td>`;
    }).join('');
    return `<tr class="d-${d.rowDir}">
      <td class="ci">${d.ci}<div class="tag">${esc(d.rows[0].seg)}</div></td>
      <td class="comm">${rich(d.rows[0].comm, 380)}${anchorNote}</td>
      ${cells}
    </tr>`;
  }).join('\n');

  const variantCards = B.perVariant.map((P, i) => {
    const t = B.tallies[i];
    const cand = Object.entries(P.byCand).filter(([, v]) => v.n)
      .map(([k, v]) => `${k === '1' ? 'שורה אחת' : k + ' שורות'}: <b>${v.n}</b>`).join(' · ') || '—';
    const rej = Object.entries(P.ON.meta.swdhRejects).filter(([k]) => k !== 'FIRED')
      .map(([k, v]) => `${esc(k)}: <b>${v}</b>`).join(' · ') || '—';
    return `<div class="vcard">
      <h3>${esc(P.label)}</h3>
      <p><b>${P.ON.meta.nFired}</b> הפעלות · ${B.OFF.meta.nLinks} → <b>${P.ON.meta.nLinks}</b> קישורים ·
         ירושה ${B.OFF.meta.nInherited} → <b>${P.ON.meta.nInherited}</b></p>
      <p>${t.added} חדשים · ${t.confirmed} ירושה→עוגן · ${t.moved} הוסטו · ${t.lost} אבדו · ${t.cascade} גרר</p>
      <p class="vj">שיפור <b class="ok">${t.better}</b> · הרעה <b class="bad">${t.worse}</b> ·
         אותו יעד: מאושר <b class="ok">${t.confOk}</b> / שנוי <b class="bad">${t.confBad}</b></p>
      <p class="vj">השופט מסכים על היעד <b>${P.agree}/${P.agree + P.disagree}</b> (${pc(P.agree, P.agree + P.disagree)})${P.unknown ? ` · ${P.unknown} לא ניתנים להכרעה` : ''}</p>
      <p class="mut">מועמדים בדף — ${cand}</p>
      <p class="mut">נדחו — ${rej}</p>
    </div>`;
  }).join('');

  return `
<h2>${esc(B.label)}</h2>
<p class="sub">${B.OFF.meta.nContentLines} שורות תוכן · ${B.OFF.meta.nLinks} קישורים בבסיס</p>
<div class="vcards">${variantCards}</div>
${B.diffs.length ? `<div class="scroll"><table>
<thead><tr>
  <th style="width:7%">שורה</th>
  <th style="width:${Math.max(18, 45 - nV * 9)}%">שורת הפרשן</th>
  <th>לפני</th>
  ${B.perVariant.map(P => `<th>${esc(P.label)}</th>`).join('')}
</tr></thead>
<tbody>${rowsHtml}</tbody></table></div>` : `<p class="sub">אין שינויים.</p>`}`;
}).join('\n');

/* global roll-up, per setting */
const nV = books[0].ONS.length;
const G = Array.from({ length: nV }, (_, i) => books.reduce((acc, B) => {
  const t = B.tallies[i], P = B.perVariant[i];
  return {
    label: P.label,
    fired: acc.fired + P.ON.meta.nFired,
    added: acc.added + t.added, confirmed: acc.confirmed + t.confirmed,
    moved: acc.moved + t.moved, lost: acc.lost + t.lost, cascade: acc.cascade + t.cascade,
    better: acc.better + t.better, worse: acc.worse + t.worse,
    confOk: acc.confOk + t.confOk, confBad: acc.confBad + t.confBad,
    agree: acc.agree + P.agree, disagree: acc.disagree + P.disagree, unknown: acc.unknown + P.unknown,
    linksOff: acc.linksOff + B.OFF.meta.nLinks, linksOn: acc.linksOn + P.ON.meta.nLinks,
    inhOff: acc.inhOff + B.OFF.meta.nInherited, inhOn: acc.inhOn + P.ON.meta.nInherited,
    lines: acc.lines + B.OFF.meta.nContentLines,
  };
}, {
  label: '', fired: 0, added: 0, confirmed: 0, moved: 0, lost: 0, cascade: 0, better: 0, worse: 0,
  confOk: 0, confBad: 0, agree: 0, disagree: 0, unknown: 0, linksOff: 0, linksOn: 0, inhOff: 0, inhOn: 0, lines: 0,
}));

const summaryTable = `<div class="scroll"><table class="sum">
<thead><tr><th>הגדרה</th><th>הפעלות</th><th>קישורים</th><th>ירושה</th><th>חדשים</th><th>ירושה→עוגן</th><th>הוסטו</th><th>אבדו</th><th>שיפור</th><th>הרעה</th><th>השופט מסכים</th></tr></thead>
<tbody>${G.map(g => `<tr>
<td><b>${esc(g.label)}</b></td><td>${g.fired}</td><td>${g.linksOff} → ${g.linksOn}</td>
<td>${g.inhOff} → ${g.inhOn}</td><td>${g.added}</td><td>${g.confirmed}</td><td>${g.moved}</td><td>${g.lost}</td>
<td class="ok">${g.better + g.confOk}</td><td class="bad">${g.worse + g.confBad}</td>
<td>${g.agree}/${g.agree + g.disagree} (${pc(g.agree, g.agree + g.disagree)})</td></tr>`).join('')}</tbody></table></div>`;

const html = `<title>עוגן מילה ראשונה — גרסה מהודקת</title>
<style>
:root{--bg:#fbfaf7;--fg:#1c1a17;--mut:#6b6459;--line:#e0dbd2;--card:#fff;--acc:#8a5a2b;--warn:#b45309;--ok:#15803d;--bad:#b91c1c}
@media (prefers-color-scheme:dark){:root:not([data-theme=light]){--bg:#16150f;--fg:#eae6dd;--mut:#9c9384;--line:#332f27;--card:#1e1c16;--acc:#d9a066;--warn:#eab308;--ok:#4ade80;--bad:#f87171}}
:root[data-theme=dark]{--bg:#16150f;--fg:#eae6dd;--mut:#9c9384;--line:#332f27;--card:#1e1c16;--acc:#d9a066;--warn:#eab308;--ok:#4ade80;--bad:#f87171}
*{box-sizing:border-box}
body{background:var(--bg);color:var(--fg);font-family:"Segoe UI",system-ui,sans-serif;direction:rtl;margin:0;padding:2rem 1.25rem;line-height:1.65}
.wrap{max-width:1650px;margin:0 auto}
h1{font-size:1.6rem;margin:0 0 .3rem}
h2{font-size:1.3rem;margin:2.8rem 0 .3rem;padding-top:1.2rem;border-top:2px solid var(--line)}
h3{font-size:1rem;margin:0 0 .5rem;color:var(--acc)}
.sub{color:var(--mut);margin-bottom:1.2rem}
.legend{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:1rem 1.25rem;margin-bottom:1.5rem}
.legend p{margin:.4rem 0;font-size:.92rem}
.vcards{display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:.85rem;margin:1rem 0 1.5rem}
.vcard{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:.85rem 1rem}
.vcard p{margin:.3rem 0;font-size:.88rem}
.vcard .vj{font-size:.88rem}
.vcard .mut{color:var(--mut);font-size:.82rem}
table{width:100%;border-collapse:collapse;background:var(--card);border:1px solid var(--line);border-radius:10px;overflow:hidden}
th{background:rgba(138,90,43,.09);text-align:right;padding:.7rem .8rem;font-size:.9rem;border-bottom:2px solid var(--line);vertical-align:top}
td{padding:.75rem .8rem;border-bottom:1px solid var(--line);vertical-align:top;font-size:.92rem}
tr:last-child td{border-bottom:none}
table.sum td,table.sum th{white-space:nowrap;font-size:.9rem}
.ci{font-weight:700;color:var(--acc);white-space:nowrap}
.comm{max-width:400px}
.tgt-c{max-width:330px}
.ref{display:inline-block;background:rgba(138,90,43,.13);color:var(--acc);border-radius:5px;padding:.1rem .45rem;font-size:.82rem;font-weight:700}
.tgt.none{color:var(--mut);font-style:italic}
.tgt.diff{border-right:3px solid var(--acc);padding-right:.5rem}
.src{margin-top:.4rem;opacity:.9;font-size:.86rem}
.better{margin-top:.45rem;font-size:.82rem;color:var(--mut);border-right:2px solid var(--line);padding-right:.5rem}
.fire{margin-top:.35rem;font-size:.82rem;color:var(--mut)}
.tag{font-size:.75rem;color:var(--mut);margin-right:.35rem;font-weight:400}
.anchor.cascade{margin-top:.5rem;font-size:.82rem;color:var(--mut);border-right:2px solid var(--line);padding-right:.5rem;font-style:italic}
.v{font-size:.75rem;border-radius:4px;padding:.05rem .35rem;margin-right:.35rem}
.v.ok{background:rgba(21,128,61,.15);color:var(--ok)}
.v.bad{background:rgba(185,28,28,.15);color:var(--bad)}
.v.amb{background:rgba(180,83,9,.15);color:var(--warn)}
.v.weak,.v.inh,.v.none{background:rgba(120,120,120,.15);color:var(--mut)}
.k{font-size:.72rem;font-weight:700;margin-bottom:.25rem}
.k.add{color:var(--ok)}.k.lost{color:var(--bad)}.k.move{color:var(--warn)}
.k.better{color:var(--ok)}.k.worse{color:var(--bad)}.k.neutral{color:var(--mut)}
b.ok,.ok{color:var(--ok)}b.bad,.bad{color:var(--bad)}
.scroll{overflow-x:auto}
code{background:rgba(138,90,43,.1);padding:.05rem .3rem;border-radius:4px;font-size:.92em;font-weight:700;color:var(--fg)}
tr.d-better{background:rgba(21,128,61,.05)}
tr.d-worse{background:rgba(185,28,28,.06)}
tr.d-mixed{background:rgba(180,83,9,.05)}
</style>
<div class="wrap">
<h1>עוגן מילה ראשונה — גרסה מהודקת</h1>
<p class="sub">שער נדירות הדוק יותר במקום 2%, בתוספת דרישת ייחודיות בדף. אותו קוד בכל העמודות; ההבדל היחיד הוא ההגדרה. <b>0.8% + ייחודיות היא ההגדרה שנכנסה למנוע.</b></p>

<div class="legend">
  <p><b>הבעיה.</b> סף הקבלה הוא <code>Math.min(1.5, …)</code> ומשקל מילה בודדת חסום ב־<code>1.30</code>. ד"ה בן מילה אחת לא יכול לעבור את הסף בשום הגדרה — זו אריתמטיקה, לא נדירות.</p>
  <p><b>המנגנון.</b> נכנס רק כאשר <b>לא נמצא שום קישור</b> — לא בחיפוש הרגיל ולא באף שלב של סולם הגמישות — ורק בשורה שאינה בא"ד/שם. רץ <b>לפני שני מסלולי הירושה</b>, ולכן גובר גם על קישור שהשורה הייתה יורשת.</p>
  <p><b>הכלל.</b> העוגן הוא <b>המילה הראשונה</b> של הד"ה (אחרי הסרת תווית הניתוב רש"י/תוס'/גמ' בלבד), בהשוואת <b>שוויון מחרוזות מדויק</b> — <b>ללא הסרת אותיות שימוש</b>, בלי לוינשטיין, בלי שורשים, בלי כתיב מלא/חסר. החיפוש מוגבל לדף המקביל; ברש"י ותוספות המילה חייבת להיות ראשונה בשורה, בגמרא — בכל מקום בשורה.</p>
  <p><b>שני השערים.</b> <span class="ok">(א)</span> המילה פותחת לא יותר מ־0.8% משורות התוכן של ספר הפרשנות — זו תכונה של <b>הפרשן</b>, ומוודאת שהמילה אינה מילת שיח שלו. <span class="ok">(ב)</span> המילה מופיעה ב<b>שורה אחת בלבד</b> בדף המקביל — זו תכונה של <b>המקור</b>, ומוודאת שהעוגן מזהה שורה אחת ולא מנחש בין כמה. בלי (ב) ההכרעה בין מועמדים הייתה ניחוש שנראה כמו התאמה.</p>
  <p><b>השופט.</b> עצמאי מהמנוע: קורא את ספר היעד מחדש ומשווה את פתיחת שורת הפרשן (עד 8 מילים) מול כל שורות הדף. ד"ה בן מילה אחת הוא בדיוק המקרה שהוא לא יכול לאשר בעצמו — לכן חלק מההפעלות מסומנות "לא ניתן לאימות", והמדד המשמעותי הוא כמה מהן <b>השופט עצמו היה בוחר באותה שורה</b>.</p>
</div>

<h2 style="border-top:none;padding-top:0;margin-top:1rem">סיכום — שלושה ספרים מלאים, ${G[0].lines} שורות תוכן</h2>
${summaryTable}

${sections}

<p class="sub" style="margin-top:2.5rem">נוצר ${new Date().toLocaleString('he-IL')} · <code>qa/variant/parserAlgorithm.swdh.ts</code> עם <code>SWDH=1 SWDH_UNIQUE=1 SWDH_RATIO=…</code> מול אותו קובץ בלי הדגל (זהה בית־בית למנוע הייצור, נבדק ב־<code>qa/variant/swdh-parity.ts</code>).</p>
</div>`;

fs.writeFileSync(outFile, html, 'utf8');
console.log(`wrote ${outFile}`);
for (const g of G) {
  console.log(`${g.label.padEnd(18)} fired ${String(g.fired).padStart(3)} · added ${g.added} · conf ${g.confirmed} · moved ${g.moved} · lost ${g.lost} · better ${g.better + g.confOk} · worse ${g.worse + g.confBad} · judge ${g.agree}/${g.agree + g.disagree}`);
}
