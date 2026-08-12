import fs from 'fs';
const dir = process.argv[2] || './__prof';
const f = fs.readdirSync(dir).filter(x => x.endsWith('.cpuprofile'))[0];
const p = JSON.parse(fs.readFileSync(dir + '/' + f, 'utf8'));
const byId = new Map(p.nodes.map(n => [n.id, n]));
const self = new Map();
for (const id of p.samples) self.set(id, (self.get(id) || 0) + 1);
const total = p.samples.length;

const agg = new Map();
for (const [id, c] of self) {
  const cf = byId.get(id).callFrame;
  const k = (cf.functionName || '(anon)') + ' @ ' + (cf.url || '').split(/[\\/]/).pop() + ':' + (cf.lineNumber + 1);
  agg.set(k, (agg.get(k) || 0) + c);
}
console.log('=== SELF TIME ===  samples=' + total);
[...agg.entries()].sort((a, b) => b[1] - a[1]).slice(0, 22)
  .forEach(([k, c]) => console.log((100 * c / total).toFixed(1).padStart(6) + '%  ' + k));

const children = new Map(p.nodes.map(n => [n.id, n.children || []]));
const memo = new Map();
function inclusive(id) {
  if (memo.has(id)) return memo.get(id);
  let s = self.get(id) || 0;
  for (const c of children.get(id) || []) s += inclusive(c);
  memo.set(id, s);
  return s;
}
const incAgg = new Map();
(function walk(id, seen) {
  const name = byId.get(id).callFrame.functionName || '(anon)';
  if (!seen.has(name)) incAgg.set(name, (incAgg.get(name) || 0) + inclusive(id));
  const s2 = new Set(seen); s2.add(name);
  for (const c of children.get(id) || []) walk(c, s2);
})(p.nodes[0].id, new Set());
console.log('\n=== INCLUSIVE ===');
[...incAgg.entries()].filter(([k]) => k && k !== '(anon)' && k !== '(root)' && k !== '(idle)')
  .sort((a, b) => b[1] - a[1]).slice(0, 16)
  .forEach(([k, c]) => console.log((100 * c / total).toFixed(1).padStart(6) + '%  ' + k));
