import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const checkedFiles = [
  'src/app/page.tsx',
  'src/app/virtual-classroom/page.tsx',
  'src/components/studio/StudioPanel.tsx',
  'src/components/studio/StudioToolSwitcher.tsx',
  'src/components/studio/VirtualClassroomPanel.tsx',
  'src/components/studio/VirtualClassroomWorkspace.tsx',
  'src/lib/virtual-classroom/outline-draft.ts',
  'src/lib/virtual-classroom/scene-content.ts',
];

const banned = [
  /\bOpenMAIC\b/i,
  /\bMAIC\b/,
  /\bMagic\b/,
  /\bOpenWork\b/,
  /\bTopicLab\b/,
  /\bAgentScope\b/,
  /\bCoze\b/,
  /\bOpenSpeech\b/,
];

const findings = [];

for (const relativePath of checkedFiles) {
  const fullPath = path.join(root, relativePath);
  if (!existsSync(fullPath)) continue;
  const lines = readFileSync(fullPath, 'utf8').split(/\r?\n/);
  lines.forEach((line, index) => {
    const matched = banned.find(pattern => pattern.test(line));
    if (matched) {
      findings.push({ path: relativePath, line: index + 1, text: line.trim() });
    }
  });
}

const result = {
  ok: findings.length === 0,
  checkedFiles: checkedFiles.length,
  findings,
};

console.log(JSON.stringify(result, null, 2));

if (!result.ok) process.exit(1);
