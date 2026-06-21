import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { upsertSourceChunks, querySourceChunks, vectorStoreStatus } from '../src/lib/vector-store';

async function main() {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'lingbi-zvec-test-'));
  process.env.ZVEC_STORE_PATH = tmpDir;

  try {
    const status = vectorStoreStatus();
    assert.equal(status.provider, 'zvec');
    assert.equal(status.configured, true);

    const written = await upsertSourceChunks([
      {
        id: 'source-a::chunk-1',
        sourceId: 'source-a',
        sourceIndex: 0,
        chunkIndex: 0,
        sourceTitle: 'Retention Study',
        paperShortName: 'Lingbi. 2026',
        text: '第 7 页：第三次有效使用后，30 日留存率提升 41%。',
        tokenEstimate: 28,
        page: 7,
        embedding: [1, 0, 0, 0],
      },
      {
        id: 'source-b::chunk-1',
        sourceId: 'source-b',
        sourceIndex: 1,
        chunkIndex: 0,
        sourceTitle: 'Prompt Studio',
        paperShortName: 'Studio. 2026',
        text: '右侧按钮作为 prompt 触发器，中间区域呈现对话产物。',
        tokenEstimate: 22,
        embedding: [0, 1, 0, 0],
      },
    ]);

    assert.equal(written.dimension, 4);
    assert.equal(written.count, 2);
    assert.match(written.path, /chunks-d4/);

    const results = await querySourceChunks([1, 0, 0, 0], { topK: 2 });
    assert.equal(results[0].sourceId, 'source-a');
    assert.equal(results[0].chunkId, 'source-a::chunk-1');
    assert.equal(results[0].page, 7);
    assert.match(results[0].excerpt, /留存率提升 41%/);

    console.log(JSON.stringify({
      ok: true,
      checked: [
        'zvec package loads on current platform',
        'collection schema creation',
        'chunk vector upsert',
        'vector query returns citation metadata',
        'WAL-backed collection path by dimension',
      ],
      path: written.path,
      results: results.length,
    }, null, 2));
  } finally {
    await rm(tmpDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
