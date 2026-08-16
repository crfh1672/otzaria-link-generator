/**
 * Extracts every COMMENTARY link between the Babylonian Talmud tractates and their
 * Rashi / Tosafot from the local Otzaria library database.
 *
 *   node scripts/extract-shas-commentary-links.mjs [outDir]
 *
 * Default outDir is data/shas-commentary-links (one JSON per tractate + index.json).
 * Set OTZARIA_DB to point at a database other than the default install location.
 * Requires Node 22+ for the built-in node:sqlite module.
 */
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const DB = process.env.OTZARIA_DB
  || path.join(os.homedir(), 'AppData', 'Roaming', 'otzaria', 'books', 'seforim.db');

const outDir = process.argv[2] || path.join(process.cwd(), 'data', 'shas-commentary-links');

/** category ids of the six sedarim — the tractates themselves are the books directly under them */
const SEDER_CATEGORIES = [13, 14, 15, 16, 17, 18];
/** category subtrees holding the two commentary series */
const COMMENTARY_ROOTS = { 'רש"י': 372, 'תוספות': 289 };
/** connection_type.name = 'COMMENTARY' */
const COMMENTARY_TYPE = 1;

if (!fs.existsSync(DB)) {
  console.error(`library database not found at ${DB}\nset OTZARIA_DB to override`);
  process.exit(1);
}

const db = new DatabaseSync(DB, { readOnly: true });

const tractates = db.prepare(`
  SELECT b.id, b.title, b.totalLines, c.title AS seder, b.orderIndex
    FROM book b JOIN category c ON c.id = b.categoryId
   WHERE b.categoryId IN (${SEDER_CATEGORIES.join(',')})
   ORDER BY b.categoryId, b.orderIndex
`).all();

const commentariesFor = db.prepare(`
  SELECT b.id, b.title, b.totalLines
    FROM book b
    JOIN category_closure cc ON cc.descendantId = b.categoryId
   WHERE cc.ancestorId = ? AND b.title = ?
`);

const linksFor = db.prepare(`
  SELECT l.id            AS linkId,
         sl.lineIndex    AS sourceLineIndex,
         sl.heRef        AS sourceRef,
         l.targetLineIndex,
         tl.heRef        AS targetRef,
         l.baseProvenance
    FROM link l
    JOIN line sl ON sl.id = l.sourceLineId
    JOIN line tl ON tl.id = l.targetLineId
   WHERE l.connectionTypeId = ${COMMENTARY_TYPE}
     AND l.sourceBookId = ? AND l.targetBookId = ?
   ORDER BY sl.lineIndex, l.targetLineIndex
`);

// Anchors (dibur-hamatchil offsets) and multi-line ranges are optional per link.
const anchorsFor = db.prepare(`
  SELECT a.linkId, a.side, a.charStart, a.charEnd, a.label
    FROM link_anchor a JOIN link l ON l.id = a.linkId
   WHERE l.connectionTypeId = ${COMMENTARY_TYPE}
     AND l.sourceBookId = ? AND l.targetBookId = ?
`);
const rangesFor = db.prepare(`
  SELECT r.linkId, r.side, r.endLineIndex
    FROM link_range r JOIN link l ON l.id = r.linkId
   WHERE l.connectionTypeId = ${COMMENTARY_TYPE}
     AND l.sourceBookId = ? AND l.targetBookId = ?
`);

/** file-name-safe slug for a Hebrew tractate title */
const slug = (title) => title.replace(/["'׳״]/g, '').replace(/\s+/g, '-');

fs.mkdirSync(outDir, { recursive: true });

const index = [];
let grandTotal = 0;

for (const tractate of tractates) {
  const entry = {
    tractate: tractate.title,
    seder: tractate.seder,
    bookId: tractate.id,
    totalLines: tractate.totalLines,
    commentaries: [],
  };

  for (const [series, root] of Object.entries(COMMENTARY_ROOTS)) {
    const book = commentariesFor.get(root, `${series} על ${tractate.title}`);
    if (!book) continue;

    const links = linksFor.all(tractate.id, book.id);

    const anchors = new Map();
    for (const a of anchorsFor.all(tractate.id, book.id)) {
      if (!anchors.has(a.linkId)) anchors.set(a.linkId, []);
      anchors.get(a.linkId).push({ side: a.side, charStart: a.charStart, charEnd: a.charEnd, label: a.label });
    }
    const ranges = new Map();
    for (const r of rangesFor.all(tractate.id, book.id)) {
      if (!ranges.has(r.linkId)) ranges.set(r.linkId, []);
      ranges.get(r.linkId).push({ side: r.side, endLineIndex: r.endLineIndex });
    }
    for (const l of links) {
      if (anchors.has(l.linkId)) l.anchors = anchors.get(l.linkId);
      if (ranges.has(l.linkId)) l.ranges = ranges.get(l.linkId);
    }

    entry.commentaries.push({
      series,
      title: book.title,
      bookId: book.id,
      totalLines: book.totalLines,
      linkCount: links.length,
      links,
    });
    grandTotal += links.length;
  }

  const file = `${slug(tractate.title)}.json`;
  fs.writeFileSync(path.join(outDir, file), JSON.stringify(entry, null, 1), 'utf8');

  index.push({
    tractate: tractate.title,
    seder: tractate.seder,
    bookId: tractate.id,
    file,
    commentaries: entry.commentaries.map(c => ({
      series: c.series, title: c.title, bookId: c.bookId, linkCount: c.linkCount,
    })),
  });

  const summary = entry.commentaries.map(c => `${c.series}=${c.linkCount}`).join(' ') || '(none)';
  console.log(`  ${tractate.title.padEnd(12)} ${summary}`);
}

fs.writeFileSync(
  path.join(outDir, 'index.json'),
  JSON.stringify({
    source: DB,
    generatedAt: new Date().toISOString(),
    connectionType: 'COMMENTARY',
    direction: 'tractate (source) -> commentary (target)',
    tractateCount: index.length,
    linkCount: grandTotal,
    tractates: index,
  }, null, 2),
  'utf8',
);

console.log(`\n${grandTotal} links across ${index.length} tractates -> ${outDir}`);
