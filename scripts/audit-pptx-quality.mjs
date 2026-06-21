import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import JSZip from 'jszip';

const repoRoot = process.cwd();
const explicitPath = process.argv[2];
const minSlides = Number(process.env.PPTX_AUDIT_MIN_SLIDES || 5);
const minTextChars = Number(process.env.PPTX_AUDIT_MIN_TEXT_CHARS || 80);
const evidenceDir = path.join(repoRoot, '.deploy', 'evidence');

function findLatestPptx() {
  if (explicitPath) return path.resolve(explicitPath);
  const files = fs.existsSync(evidenceDir)
    ? fs.readdirSync(evidenceDir)
        .filter(name => /^real-ppt-v2-.*\.pptx$/i.test(name))
        .map(name => path.join(evidenceDir, name))
        .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)
    : [];
  if (files.length === 0) {
    throw new Error('No real-ppt-v2-*.pptx found under .deploy/evidence. Pass a PPTX path explicitly.');
  }
  return files[0];
}

function decodeXmlText(value) {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

async function main() {
  const file = findLatestPptx();
  const buffer = fs.readFileSync(file);
  const zip = await JSZip.loadAsync(buffer);
  const slideNames = Object.keys(zip.files)
    .filter(name => /^ppt\/slides\/slide\d+\.xml$/i.test(name))
    .sort((a, b) => Number(a.match(/slide(\d+)\.xml/i)?.[1] || 0) - Number(b.match(/slide(\d+)\.xml/i)?.[1] || 0));

  const rows = [];
  const placeholders = [];
  const thinSlides = [];
  for (const slideName of slideNames) {
    const xml = await zip.files[slideName].async('string');
    const text = decodeXmlText([...xml.matchAll(/<a:t>(.*?)<\/a:t>/g)].map(match => match[1]).join(' '));
    const slideNumber = Number(slideName.match(/slide(\d+)\.xml/i)?.[1] || rows.length + 1);
    const isCover = slideNumber === 1;
    const placeholder = /待补充|TODO|占位|placeholder/i.test(text);
    const thin = !isCover && text.length < minTextChars;
    if (placeholder) placeholders.push(slideName);
    if (thin) thinSlides.push(slideName);
    rows.push({
      slide: path.basename(slideName),
      textLength: text.length,
      thin,
      placeholder,
      sample: text.slice(0, 120),
    });
  }

  const ok = slideNames.length >= minSlides && placeholders.length === 0 && thinSlides.length === 0;
  const result = {
    ok,
    file,
    bytes: buffer.length,
    slideCount: slideNames.length,
    minSlides,
    minTextChars,
    placeholderCount: placeholders.length,
    thinSlideCount: thinSlides.length,
    placeholders,
    thinSlides,
    rows,
  };
  console.log(JSON.stringify(result, null, 2));
  if (!ok) process.exitCode = 1;
}

main().catch(error => {
  console.error(JSON.stringify({
    ok: false,
    error: error instanceof Error ? error.message : String(error),
  }, null, 2));
  process.exit(1);
});
