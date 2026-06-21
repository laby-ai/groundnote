import { NextRequest, NextResponse } from 'next/server';
import { buildKnowledgeCardsPayload, type KnowledgeCardRequestInput } from '@/lib/knowledge-card-service';

export async function POST(request: NextRequest) {
  try {
    const result = await buildKnowledgeCardsPayload(await request.json() as KnowledgeCardRequestInput);
    if ('error' in result) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }
    return NextResponse.json(result.body, { status: result.status });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : '生成知识卡片失败';
    console.error('[knowledge-cards] Error:', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
