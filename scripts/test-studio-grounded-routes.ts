import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { NextRequest } from 'next/server';
import { ingestExtractedSource } from '../src/lib/ingestion-store';
import { POST as knowledgeCardsPost } from '../src/app/api/ai/knowledge-cards/route';
import { POST as podcastPost } from '../src/app/api/ai/podcast/route';
import { POST as pptPost } from '../src/app/api/ai/ppt/route';
import { POST as pptV2Post } from '../src/app/api/ai/ppt-v2/route';
import { POST as reportPost } from '../src/app/api/ai/report/route';

function jsonRequest(url: string, body: unknown): NextRequest {
  return new NextRequest(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function readJson(response: Response) {
  const text = await response.text();
  return JSON.parse(text) as Record<string, unknown>;
}

async function main() {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'lingbi-studio-grounded-test-'));
  process.env.SOURCE_STORE_PATH = path.join(tmpDir, 'sources.json');
  process.env.ZVEC_STORE_PATH = path.join(tmpDir, 'zvec');

  try {
    await ingestExtractedSource({
      id: 'paper-studio-grounded',
      fileName: 'studio-grounded.txt',
      fileType: 'txt',
      title: 'Studio Grounded Context',
      shortName: 'Studio. 2026',
      content: '右侧 Studio prompt 产物必须复用同一套 grounded context，并保留 sourceId、chunkId 和页码引用。',
      rawContent: '第 3 页：报告、知识卡片和 PPT 应该复用统一检索证据，避免各路由重新拼全文。',
    });

    const papers = [{ id: 'paper-studio-grounded', title: 'Studio Grounded Context' }];

    const cardsResponse = await knowledgeCardsPost(jsonRequest('http://localhost/api/ai/knowledge-cards', {
      papers,
      debugRetrievalOnly: true,
      debugAnswerText: '知识卡片应复用统一检索证据并展示来源编号[1]。',
    }));
    assert.equal(cardsResponse.status, 200);
    const cardsJson = await readJson(cardsResponse);
    assert.equal((cardsJson.retrieval as { mode?: string }).mode, 'persisted-keyword');
    assert.equal((cardsJson.citations as Array<{ sourceId?: string }>)[0].sourceId, 'paper-studio-grounded');
    assert.equal((cardsJson.citationAudit as { status?: string }).status, 'pass');

    const reportResponse = await reportPost(jsonRequest('http://localhost/api/ai/report', {
      papers,
      outline: '统一 grounded context 的工程价值',
      debugRetrievalOnly: true,
    }));
    assert.equal(reportResponse.status, 200);
    const reportJson = await readJson(reportResponse);
    assert.equal((reportJson.retrieval as { mode?: string }).mode, 'persisted-keyword');
    assert.equal((reportJson.citations as Array<{ chunkId?: string }>)[0].chunkId, 'paper-studio-grounded::chunk-1');

    const podcastResponse = await podcastPost(jsonRequest('http://localhost/api/ai/podcast', {
      content: '请生成播客脚本',
      papers,
      debugRetrievalOnly: true,
    }));
    assert.equal(podcastResponse.status, 200);
    const podcastJson = await readJson(podcastResponse);
    assert.equal((podcastJson.retrieval as { mode?: string }).mode, 'persisted-keyword');
    assert.equal((podcastJson.citations as Array<{ sourceId?: string }>)[0].sourceId, 'paper-studio-grounded');

    const pptResponse = await pptPost(jsonRequest('http://localhost/api/ai/ppt', {
      papers,
      debugRetrievalOnly: true,
      pageCount: 4,
      detailLevel: 'concise',
      language: 'zh',
    }));
    assert.equal(pptResponse.status, 200);
    const pptJson = await readJson(pptResponse);
    assert.equal((pptJson.retrieval as { mode?: string }).mode, 'persisted-keyword');
    assert.equal((pptJson.citations as Array<{ chunkId?: string }>)[0].chunkId, 'paper-studio-grounded::chunk-1');

    const pptV2Response = await pptV2Post(jsonRequest('http://localhost/api/ai/ppt-v2', {
      papers,
      debugRetrievalOnly: true,
      duration: 10,
      audience: 'researchers',
    }));
    assert.equal(pptV2Response.status, 200);
    const pptV2Json = await readJson(pptV2Response);
    assert.equal((pptV2Json.retrieval as { mode?: string }).mode, 'persisted-keyword');
    assert.equal((pptV2Json.citations as Array<{ sourceId?: string }>)[0].sourceId, 'paper-studio-grounded');

    const emptyPptResponse = await pptPost(jsonRequest('http://localhost/api/ai/ppt', {
      papers: [],
      debugRetrievalOnly: true,
    }));
    assert.equal(emptyPptResponse.status, 400, 'ppt route should reject empty paper selection');
    const emptyPptJson = await readJson(emptyPptResponse);
    assert.match(String(emptyPptJson.error || ''), /请选择|文献|PPT/, 'ppt empty-selection error should be user-facing');

    const emptyPptV2Response = await pptV2Post(jsonRequest('http://localhost/api/ai/ppt-v2', {
      papers: [],
      debugRetrievalOnly: true,
    }));
    assert.equal(emptyPptV2Response.status, 400, 'ppt-v2 route should reject empty paper selection');

    console.log(JSON.stringify({
      ok: true,
      checked: [
        'knowledge cards route uses grounded retrieval debug path',
        'knowledge cards route audits citation markers in generated card text',
        'report route uses grounded retrieval debug path',
        'podcast route accepts content and uses grounded retrieval debug path',
        'ppt route builds grounded evidence outline debug path',
        'ppt-v2 route builds academic evidence outline debug path',
        'studio routes can scope persisted sources by selected paper id',
        'ppt routes reject empty source selection with user-facing errors',
      ],
      cardsMode: (cardsJson.retrieval as { mode?: string }).mode,
      reportMode: (reportJson.retrieval as { mode?: string }).mode,
      podcastMode: (podcastJson.retrieval as { mode?: string }).mode,
      pptMode: (pptJson.retrieval as { mode?: string }).mode,
      pptV2Mode: (pptV2Json.retrieval as { mode?: string }).mode,
      citationSource: (reportJson.citations as Array<{ sourceId?: string }>)[0].sourceId,
    }, null, 2));
  } finally {
    await rm(tmpDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
