import { runLinkingParser } from './baseline/parserAlgorithm.original';
import { buildCases } from './cases';
const name = process.argv[2] || 'FULL/py-berachot';
const c = buildCases().find(x => x.name === name)!;
const t0 = Date.now();
const r = runLinkingParser(c.commentary, c.source, c.config, c.rashi, c.tosafot);
console.log('BASELINE', name, ((Date.now() - t0) / 1000).toFixed(1) + 's', 'links=' + r.links.length);
