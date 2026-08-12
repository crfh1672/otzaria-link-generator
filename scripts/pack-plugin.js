import fs from 'fs';
import path from 'path';
import JSZip from 'jszip';

async function packPlugin() {
  console.log('📦 Starting Otzaria plugin packaging...');
  const zip = new JSZip();

  // Read manifest.json
  const manifestPath = path.resolve(process.cwd(), 'manifest.json');
  if (!fs.existsSync(manifestPath)) {
    console.error('❌ manifest.json not found!');
    process.exit(1);
  }
  const manifestContent = fs.readFileSync(manifestPath, 'utf-8');
  zip.file('manifest.json', manifestContent);

  // Read built single HTML file from dist/index.html
  const distHtmlPath = path.resolve(process.cwd(), 'dist', 'index.html');
  if (!fs.existsSync(distHtmlPath)) {
    console.error('❌ dist/index.html not found! Please run "npm run build" first.');
    process.exit(1);
  }
  const htmlContent = fs.readFileSync(distHtmlPath, 'utf-8');
  zip.file('index.html', htmlContent);

  // Ensure output dist dir exists
  const outDir = path.resolve(process.cwd(), 'dist');
  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }

  const manifest = JSON.parse(manifestContent);
  const pluginFileName = `${manifest.id || 'com.otzaria.links-generator'}.otzplugin`;
  const outPath = path.join(outDir, pluginFileName);

  const zipContent = await zip.generateAsync({ type: 'nodebuffer' });
  fs.writeFileSync(outPath, zipContent);

  console.log(`✅ Plugin packaged successfully into: ${outPath}`);
  console.log(`📄 Single HTML file ready at: ${distHtmlPath}`);
}

packPlugin().catch((err) => {
  console.error('Packaging failed:', err);
  process.exit(1);
});
