import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { buildGroundedRetrievalContext } from '../src/lib/grounded-retrieval';
import { ingestExtractedSource } from '../src/lib/ingestion-store';

function deterministicEmbedding(text: string): number[] {
  const lower = text.toLowerCase();
  if (lower.includes('留存') || lower.includes('retention') || lower.includes('30 日')) return [1, 0, 0, 0];
  if (lower.includes('prompt') || lower.includes('studio') || lower.includes('右侧按钮')) return [0, 1, 0, 0];
  return [0, 0, 1, 0];
}

async function main() {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'lingbi-grounded-retrieval-test-'));
  process.env.SOURCE_STORE_PATH = path.join(tmpDir, 'sources.json');
  process.env.ZVEC_STORE_PATH = path.join(tmpDir, 'zvec');

  try {
    await ingestExtractedSource({
      id: 'paper-retention',
      fileName: 'retention.pdf',
      fileType: 'pdf',
      title: 'Retention Cohort Analysis',
      shortName: 'Lingbi. 2026',
      content: '第 7 页：第三次有效使用后，30 日留存率提升 41%。',
    }, {
      embedder: async texts => texts.map(deterministicEmbedding),
    });

    await ingestExtractedSource({
      id: 'paper-studio',
      fileName: 'studio.md',
      fileType: 'md',
      title: 'Prompt Studio',
      shortName: 'Studio. 2026',
      content: '右侧按钮作为 prompt 触发器，中间区域呈现对话产物。',
    });

    const vectorGrounded = await buildGroundedRetrievalContext('30 日留存提升多少？', [], undefined, {
      embedder: async texts => texts.map(deterministicEmbedding),
    });
    assert.equal(vectorGrounded.retrievalMode, 'persisted-vector');
    assert.equal(vectorGrounded.degraded, false);
    assert.match(vectorGrounded.reason || '', /向量索引/);
    assert.equal(vectorGrounded.citations[0].sourceId, 'paper-retention');
    assert.match(vectorGrounded.promptContext, /chunkId: paper-retention::chunk-1/);

    const keywordGrounded = await buildGroundedRetrievalContext('右侧按钮在 Studio 里做什么？', []);
    assert.equal(keywordGrounded.retrievalMode, 'persisted-keyword');
    assert.equal(keywordGrounded.degraded, true);
    assert.match(keywordGrounded.reason || '', /向量模型|持久化文本片段/);
    assert.equal(keywordGrounded.citations[0].sourceId, 'paper-studio');
    assert.match(keywordGrounded.citations[0].excerpt, /prompt 触发器/);

    const requestFallback = await buildGroundedRetrievalContext('方法对比是什么？', [{
      id: 'request-only',
      title: 'Request Only Source',
      shortName: 'Req. 2026',
      content: '方法对比显示，A 方法在成本上低于 B 方法。',
    }]);
    assert.equal(requestFallback.retrievalMode, 'request-keyword');
    assert.equal(requestFallback.degraded, true);
    assert.match(requestFallback.reason || '', /当前请求携带/);
    assert.equal(requestFallback.citations[0].sourceId, 'request-only');

    const scopedFallback = await buildGroundedRetrievalContext('30 日留存提升多少？', [{
      id: 'paper-retention',
      title: 'Retention Cohort Analysis',
    }]);
    assert.notEqual(scopedFallback.citations[0]?.sourceId, 'paper-studio', 'selected source scope should exclude unrelated persisted sources');

    console.log(JSON.stringify({
      ok: true,
      checked: [
        'chat retrieval prefers persisted zvec when query embeddings are available',
        'chat retrieval falls back to persisted keyword chunks without embedding config',
        'chat retrieval falls back to request papers when selected sources are not persisted',
        'retrieval metadata exposes degraded and reason for UI/user-facing fallback copy',
        'selected source scope filters persisted retrieval',
      ],
      vectorMode: vectorGrounded.retrievalMode,
      keywordMode: keywordGrounded.retrievalMode,
      fallbackMode: requestFallback.retrievalMode,
    }, null, 2));
  } finally {
    await rm(tmpDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
