import { NextRequest, NextResponse } from 'next/server';
import { getIngestionSource, listIngestionSources } from '@/lib/ingestion-store';

export async function GET(request: NextRequest) {
  const sourceId = request.nextUrl.searchParams.get('id')?.trim();

  if (sourceId) {
    const source = await getIngestionSource(sourceId);
    if (!source) {
      return NextResponse.json({ error: 'source not found' }, { status: 404 });
    }
    return NextResponse.json({ source }, { headers: { 'Cache-Control': 'no-store' } });
  }

  const sources = await listIngestionSources();
  return NextResponse.json({
    sources: sources.map(source => ({
      id: source.id,
      fileName: source.fileName,
      fileType: source.fileType,
      fileSize: source.fileSize,
      title: source.title,
      shortName: source.shortName,
      status: source.status,
      createdAt: source.createdAt,
      stages: source.stages,
      chunkCount: source.chunkCount,
      tokenEstimate: source.tokenEstimate,
      vectorIndex: source.vectorIndex,
      mineru: source.mineru,
      updatedAt: source.updatedAt,
      error: source.error,
    })),
  }, {
    headers: { 'Cache-Control': 'no-store' },
  });
}
