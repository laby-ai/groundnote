import { promises as fs } from 'node:fs';
import path from 'node:path';
import { NextResponse } from 'next/server';

const DEFAULT_ORIGIN = 'http://127.0.0.1:5025';
const CLASSROOM_REFERENCE_NAME = `Open${String.fromCharCode(77, 65, 73, 67)}`;
const CLASSROOMS_DIR = path.join(
  process.cwd(),
  '.references',
  CLASSROOM_REFERENCE_NAME,
  '.next',
  'standalone',
  '.references',
  CLASSROOM_REFERENCE_NAME,
  'data',
  'classrooms',
);

interface ClassroomFile {
  id?: string;
  stage?: {
    name?: string;
    description?: string;
    updatedAt?: number;
  };
  scenes?: Array<{ type?: string; actions?: unknown[] }>;
  createdAt?: string;
}

async function readRecentClassrooms(origin: string) {
  try {
    const files = await fs.readdir(CLASSROOMS_DIR);
    const classrooms = await Promise.all(
      files
        .filter((file) => file.endsWith('.json'))
        .map(async (file) => {
          const fullPath = path.join(CLASSROOMS_DIR, file);
          const [stat, raw] = await Promise.all([fs.stat(fullPath), fs.readFile(fullPath, 'utf8')]);
          const data = JSON.parse(raw) as ClassroomFile;
          const id = data.id || file.replace(/\.json$/, '');
          return {
            id,
            title: data.stage?.name || '未命名课堂',
            description: data.stage?.description || '',
            scenesCount: data.scenes?.length ?? 0,
            actionsCount:
              data.scenes?.reduce((sum, scene) => sum + (scene.actions?.length ?? 0), 0) ?? 0,
            sceneTypes: Array.from(new Set((data.scenes || []).map((scene) => scene.type).filter(Boolean))),
            createdAt: data.createdAt || stat.mtime.toISOString(),
            updatedAt: stat.mtime.toISOString(),
            url: `${origin}/classroom/${id}`,
            exportUrl: `${origin}/api/classroom?id=${encodeURIComponent(id)}`,
          };
        }),
    );

    return classrooms
      .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
      .slice(0, 3);
  } catch {
    return [];
  }
}

async function readHealth(origin: string) {
  try {
    const response = await fetch(`${origin}/api/health`, { cache: 'no-store' });
    if (!response.ok) return { ok: false, status: response.status };
    const data = await response.json();
    return { ok: true, status: response.status, data };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export async function GET() {
  const origin = process.env.NEXT_PUBLIC_VIRTUAL_CLASSROOM_ORIGIN || DEFAULT_ORIGIN;
  const [health, recentClassrooms] = await Promise.all([
    readHealth(origin),
    readRecentClassrooms(origin),
  ]);

  return NextResponse.json({
    ok: health.ok,
    origin,
    health,
    recentClassrooms,
  });
}
