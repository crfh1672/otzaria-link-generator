/**
 * str2-proto: dictionary lookups in expandAbbreviationsInText use plain-object index
 * access (`dict[k] || customReplacements[k] || NORMALIZED_ABBREVIATIONS_MAP[k]`,
 * src/data/abbreviations.ts:627) on object LITERALS, so every Object.prototype member is a
 * live "key". Any of them whose `.length` is > 0 passes the `options.length > 0` guard and
 * is then iterated with for..of.
 *
 *   node --import tsx qa/stress/str2-proto.ts
 */
import { runLinkingParser } from '../../src/utils/parserAlgorithm';
import { expandAbbreviationsInText } from '../../src/data/abbreviations';
import type { PluginConfig } from '../../src/types';

const cfg: PluginConfig = {
  sourceCategory: 'shas', targetBookName: 'ברכות', ignoreShamInShas: true,
  diburHamatchilDelimiter: '', useAbbreviationExpansion: true,
  customAbbreviations: undefined, useFuzzyMatching: true, useWordWeighting: true,
};

const PROBES = [
  'constructor', 'hasOwnProperty', 'isPrototypeOf', 'propertyIsEnumerable',
  'toString', 'valueOf', 'toLocaleString', '__proto__', '__defineGetter__',
];

console.log('── direct expandAbbreviationsInText probe ──');
for (const p of PROBES) {
  let r = '';
  try { r = 'ok -> ' + JSON.stringify(expandAbbreviationsInText(`${p} שלום`, 'שלום עולם אמר רבי')); }
  catch (e: any) { r = `THREW ${e?.constructor?.name}: ${e?.message}`; }
  console.log(`  ${p.padEnd(22)} ${r}`);
}

console.log('\n── full runLinkingParser, word embedded in a commentary line ──');
for (const p of PROBES) {
  const comm = `<h2>דף ב.</h2>\nאמר רבי יוחנן ${p} שלום עולם`;
  const src = '<h2>דף ב.</h2>\nאמר רבי יוחנן שלום עולם ועוד דברים';
  let r = '';
  try { r = `ok links=${runLinkingParser(comm, src, cfg).links.length}`; }
  catch (e: any) { r = `*** THREW ${e?.constructor?.name}: ${e?.message} ***`; }
  console.log(`  ${p.padEnd(22)} ${r}`);
}

console.log('\n── same word arriving via a user-supplied custom dictionary key ──');
for (const p of ['constructor', 'hasOwnProperty']) {
  const comm = `<h2>דף ב.</h2>\nאמר ${p} שלום`;
  const src = '<h2>דף ב.</h2>\nאמר שלום עולם';
  let r = '';
  try { r = `ok links=${runLinkingParser(comm, src, { ...cfg, customAbbreviations: { 'אא': ['אי אפשר'] } } as any).links.length}`; }
  catch (e: any) { r = `*** THREW ${e?.constructor?.name}: ${e?.message} ***`; }
  console.log(`  customAbbreviations set, word=${p.padEnd(18)} ${r}`);
}
