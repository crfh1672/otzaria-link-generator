import fs from 'fs/promises';
import path from 'path';
import { DEFAULT_ABBREVIATIONS } from '../src/data/abbreviations';
import { DEFAULT_REPLACEMENTS } from '../src/data/replacements';

async function main() {
  const publicDir = path.resolve(process.cwd(), 'public');
  const outputPath = path.join(publicDir, 'gs-dictionary.json');

  await fs.mkdir(publicDir, { recursive: true });

  const payload = {
    abbreviations: DEFAULT_ABBREVIATIONS,
    replacements: DEFAULT_REPLACEMENTS,
  };

  await fs.writeFile(outputPath, JSON.stringify(payload, null, 2) + '\n', 'utf8');
  console.log(`Generated gs-dictionary.json at ${outputPath}`);
}

main().catch((err) => {
  console.error('Failed to generate gs-dictionary.json:', err);
  process.exit(1);
});
