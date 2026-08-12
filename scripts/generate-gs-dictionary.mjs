import fs from 'fs/promises';
import path from 'path';

async function extractObjectLiteral(filePath, startMarker) {
  const content = await fs.readFile(filePath, 'utf8');
  const startIndex = content.indexOf(startMarker);
  if (startIndex === -1) {
    throw new Error(`Marker not found: ${startMarker}`);
  }

  const openBrace = content.indexOf('{', startIndex + startMarker.length);
  if (openBrace === -1) {
    throw new Error(`Opening brace not found after marker: ${startMarker}`);
  }

  let depth = 0;
  let endIndex = -1;
  for (let i = openBrace; i < content.length; i++) {
    const ch = content[i];
    if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) {
        endIndex = i;
        break;
      }
    }
  }

  if (endIndex === -1) {
    throw new Error(`Closing brace not found for marker: ${startMarker}`);
  }

  return content.slice(openBrace, endIndex + 1);
}

function parseObjectLiteral(literalText) {
  const js = `return (${literalText});`;
  return new Function(js)();
}

async function main() {
  const projectRoot = process.cwd();
  const abbreviationsPath = path.join(projectRoot, 'src', 'data', 'abbreviations.ts');
  const replacementsPath = path.join(projectRoot, 'src', 'data', 'replacements.ts');
  const publicDir = path.join(projectRoot, 'public');
  const outputPath = path.join(publicDir, 'gs-dictionary.json');

  const abbreviationsLiteral = await extractObjectLiteral(abbreviationsPath, 'export const DEFAULT_ABBREVIATIONS');
  const replacementsLiteral = await extractObjectLiteral(replacementsPath, 'export const DEFAULT_REPLACEMENTS');

  const abbreviations = parseObjectLiteral(abbreviationsLiteral);
  const replacements = parseObjectLiteral(replacementsLiteral);

  await fs.mkdir(publicDir, { recursive: true });
  await fs.writeFile(outputPath, JSON.stringify({ abbreviations, replacements }, null, 2) + '\n', 'utf8');
  console.log(`Generated gs-dictionary.json at ${outputPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
