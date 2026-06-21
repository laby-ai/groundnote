import { mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import { createHash } from 'crypto';
import type { GroundedCitation, SourceChunk } from '@/lib/rag';

const VECTOR_FIELD = 'embedding';
const DEFAULT_COLLECTION_ROOT = '.data/zvec';

export interface EmbeddedSourceChunk extends SourceChunk {
  embedding: number[];
}

export interface VectorStoreSearchResult extends GroundedCitation {
  distance: number;
}

type ZvecModule = typeof import('@zvec/zvec');

let zvecModulePromise: Promise<ZvecModule> | null = null;

async function loadZvec(): Promise<ZvecModule> {
  zvecModulePromise ||= import('@zvec/zvec');
  return zvecModulePromise;
}

function assertEmbeddingDimension(embedding: number[]): number {
  if (!Array.isArray(embedding) || embedding.length === 0) {
    throw new Error('向量为空，无法写入向量库。');
  }
  for (const value of embedding) {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new Error('向量包含非数值项，无法写入向量库。');
    }
  }
  return embedding.length;
}

function collectionRoot(): string {
  const configured = process.env.ZVEC_STORE_PATH?.trim();
  return path.resolve(process.cwd(), configured || DEFAULT_COLLECTION_ROOT);
}

function collectionPath(dimension: number): string {
  return path.join(collectionRoot(), `chunks-d${dimension}`);
}

function zvecDocId(chunkId: string): string {
  const readable = chunkId.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 80);
  const hash = createHash('sha256').update(chunkId).digest('hex').slice(0, 16);
  return `${readable}_${hash}`;
}

function toCitation(fields: Record<string, unknown>, id: string, distance: number): VectorStoreSearchResult {
  const score = distance === 0 ? 1 : Number((1 / (1 + Math.max(0, distance))).toFixed(6));
  return {
    paperId: String(fields.sourceId || ''),
    paperShortName: String(fields.paperShortName || ''),
    excerpt: String(fields.text || '').slice(0, 320),
    sourceId: String(fields.sourceId || ''),
    chunkId: String(fields.chunkId || id),
    sourceTitle: String(fields.sourceTitle || ''),
    score,
    distance,
    chunkIndex: Number(fields.chunkIndex || 0),
    page: fields.page ? Number(fields.page) : undefined,
  };
}

export async function openChunkVectorStore(dimension: number) {
  if (!Number.isInteger(dimension) || dimension <= 0) {
    throw new Error(`向量维度无效：${dimension}`);
  }

  await mkdir(collectionRoot(), { recursive: true });
  const zvec = await loadZvec();
  const schema = new zvec.ZVecCollectionSchema({
    name: 'lingbi_chunks',
    vectors: {
      name: VECTOR_FIELD,
      dataType: zvec.ZVecDataType.VECTOR_FP32,
      dimension,
      indexParams: {
        indexType: zvec.ZVecIndexType.FLAT,
        metricType: zvec.ZVecMetricType.COSINE,
      },
    },
    fields: [
      { name: 'sourceId', dataType: zvec.ZVecDataType.STRING },
      { name: 'chunkId', dataType: zvec.ZVecDataType.STRING },
      { name: 'sourceTitle', dataType: zvec.ZVecDataType.STRING },
      { name: 'paperShortName', dataType: zvec.ZVecDataType.STRING },
      { name: 'text', dataType: zvec.ZVecDataType.STRING },
      { name: 'chunkIndex', dataType: zvec.ZVecDataType.INT64 },
      { name: 'page', dataType: zvec.ZVecDataType.INT64, nullable: true },
    ],
  });

  const targetPath = collectionPath(dimension);
  return existsSync(targetPath)
    ? zvec.ZVecOpen(targetPath)
    : zvec.ZVecCreateAndOpen(targetPath, schema);
}

export async function upsertSourceChunks(chunks: EmbeddedSourceChunk[]): Promise<{ dimension: number; count: number; path: string }> {
  if (chunks.length === 0) return { dimension: 0, count: 0, path: collectionRoot() };

  const dimension = assertEmbeddingDimension(chunks[0].embedding);
  for (const chunk of chunks) {
    const currentDimension = assertEmbeddingDimension(chunk.embedding);
    if (currentDimension !== dimension) {
      throw new Error(`向量维度不一致：期望 ${dimension}，收到 ${currentDimension}。`);
    }
  }

  const collection = await openChunkVectorStore(dimension);
  try {
    const statuses = collection.upsertSync(chunks.map(chunk => {
      const fields: Record<string, string | number> = {
        sourceId: chunk.sourceId,
        chunkId: chunk.id,
        sourceTitle: chunk.sourceTitle,
        paperShortName: chunk.paperShortName,
        text: chunk.text,
        chunkIndex: chunk.chunkIndex,
      };
      if (typeof chunk.page === 'number') fields.page = chunk.page;
      return {
        id: zvecDocId(chunk.id),
        vectors: { [VECTOR_FIELD]: chunk.embedding },
        fields,
      };
    }));

    const failed = Array.isArray(statuses) ? statuses.filter(status => !status.ok) : [];
    if (failed.length > 0) {
      throw new Error(`向量库写入失败：${failed[0]?.message || failed[0]?.code || 'unknown error'}`);
    }

    return { dimension, count: chunks.length, path: collectionPath(dimension) };
  } finally {
    collection.closeSync();
  }
}

export async function querySourceChunks(
  embedding: number[],
  options?: { topK?: number; outputFields?: string[] },
): Promise<VectorStoreSearchResult[]> {
  const dimension = assertEmbeddingDimension(embedding);
  const collection = await openChunkVectorStore(dimension);
  try {
    const docs = collection.querySync({
      fieldName: VECTOR_FIELD,
      vector: embedding,
      topk: options?.topK || 6,
      outputFields: options?.outputFields || ['sourceId', 'chunkId', 'sourceTitle', 'paperShortName', 'text', 'chunkIndex', 'page'],
    });

    return docs.map(doc => toCitation(doc.fields || {}, doc.id, doc.score));
  } finally {
    collection.closeSync();
  }
}

export function vectorStoreStatus() {
  return {
    provider: 'zvec',
    configured: true,
    path: collectionRoot(),
    package: '@zvec/zvec',
  };
}
