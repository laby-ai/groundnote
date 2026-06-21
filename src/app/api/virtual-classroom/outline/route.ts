import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { NextRequest, NextResponse } from 'next/server';
import {
  buildVirtualClassroomOutlineDraft,
  type VirtualClassroomSourceInput,
} from '@/lib/virtual-classroom/outline-draft';

const OUTPUT_DIR = path.join(process.cwd(), 'output', 'virtual-classroom');

function isSourceInput(value: unknown): value is VirtualClassroomSourceInput {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<VirtualClassroomSourceInput>;
  return typeof candidate.id === 'string' && typeof candidate.title === 'string';
}

async function writeEvidenceFile(draft: unknown): Promise<string> {
  await mkdir(OUTPUT_DIR, { recursive: true });
  const fileName = `outline-draft-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
  const fullPath = path.join(OUTPUT_DIR, fileName);
  await writeFile(fullPath, JSON.stringify(draft, null, 2), 'utf8');
  return fullPath;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const rawSources = Array.isArray(body?.sources)
      ? body.sources
      : Array.isArray(body?.papers)
        ? body.papers
        : [];
    const sources = rawSources.filter(isSourceInput);

    const draft = buildVirtualClassroomOutlineDraft(sources);
    const artifactPath = await writeEvidenceFile(draft);

    return NextResponse.json({
      ok: true,
      draft,
      artifactPath,
    }, {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : '课程大纲生成失败';
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}
