/**
 * Extracts book text from the local Otzaria library into plain .txt fixtures for the
 * QA harness — one physical line per book line, exactly the shape
 * otzariaBridge.fetchBookContent() hands to runLinkingParser.
 *
 *   node qa/extract-books.mjs [outDir]
 *
 * Default outDir is qa/data (git-ignored; the fixtures are ~10MB and are not committed).
 * Requires Node 22+ for the built-in node:sqlite module.
 */
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const DB = process.env.OTZARIA_DB
  || path.join(os.homedir(), 'AppData', 'Roaming', 'otzaria', 'books', 'seforim.db');

const outDir = process.argv[2] || path.join(process.cwd(), 'qa', 'data');

/** fixture name -> exact book title in the library */
const BOOKS = {
  py_berachot: 'פני יהושע על ברכות',
  gem_berachot: 'ברכות',
  rashi_berachot: 'רש"י על ברכות',
  tos_berachot: 'תוספות על ברכות',
  py_shabbat: 'פני יהושע על שבת',
  gem_shabbat: 'שבת',
  rashi_shabbat: 'רש"י על שבת',
  tos_shabbat: 'תוספות על שבת',
  benyehoyada_berachot: 'בן יהוידע על ברכות',
};

if (!fs.existsSync(DB)) {
  console.error(`library database not found at ${DB}\nset OTZARIA_DB to override`);
  process.exit(1);
}

fs.mkdirSync(outDir, { recursive: true });
const db = new DatabaseSync(DB, { readOnly: true });
const findBook = db.prepare('SELECT id, totalLines FROM book WHERE title = ?');
const readLines = db.prepare('SELECT content FROM line WHERE bookId = ? ORDER BY lineIndex');

let missing = 0;
for (const [name, title] of Object.entries(BOOKS)) {
  const meta = findBook.get(title);
  if (!meta) {
    console.error(`  MISSING  ${title}`);
    missing++;
    continue;
  }
  const rows = readLines.all(meta.id);
  const text = rows.map(r => r.content).join('\n');
  fs.writeFileSync(path.join(outDir, `${name}.txt`), text, 'utf8');
  console.log(`  ${name.padEnd(22)} ${String(rows.length).padStart(5)} lines  ${(text.length / 1024).toFixed(0)}KB`);
}

console.log(`\nwrote ${Object.keys(BOOKS).length - missing} fixtures to ${outDir}`);
if (missing) process.exit(1);
