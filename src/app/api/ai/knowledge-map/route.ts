import { NextRequest, NextResponse } from 'next/server';
import { buildKnowledgeMapPayload, type KnowledgeMapRequestInput } from '@/lib/knowledge-map-service';

export async function POST(request: NextRequest) {
  try {
    const result = await buildKnowledgeMapPayload(await request.json() as KnowledgeMapRequestInput);
    if ('error' in result) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }
    return NextResponse.json(result.body, { status: result.status });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : '生成资料地图失败';
    console.error('[knowledge-map] Error:', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
