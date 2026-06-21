import './lib/load-real-env.mjs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const origin = process.env.STUDIO_TOOLS_SMOKE_ORIGIN || process.env.APP_ORIGIN || 'http://127.0.0.1:5014';
const outputDir = path.join(process.cwd(), '.data', 'studio-tools-smoke');
const defaultTools = ['interactive', 'quiz', 'project'];
const tools = (process.env.STUDIO_TOOLS_SMOKE_TOOL_IDS || '')
  .split(',')
  .map(item => item.trim())
  .filter(Boolean);
const selectedTools = tools.length > 0 ? tools : defaultTools;

function envFirst(...names) {
  for (const name of names) {
    const value = process.env[name]?.trim();
    if (value) return value;
  }
  return '';
}

function buildAiConfig() {
  return {
    apiBase: envFirst('OPENAI_COMPAT_API_BASE', 'ARK_API_BASE', 'OPENAI_API_BASE'),
    apiKey: envFirst('OPENAI_COMPAT_API_KEY', 'ARK_API_KEY', 'OPENAI_API_KEY'),
    model: envFirst('OPENAI_COMPAT_MODEL', 'ARK_MODEL'),
    visionModel: envFirst('OPENAI_COMPAT_VISION_MODEL', 'ARK_VISION_MODEL'),
    embeddingModel: envFirst('OPENAI_COMPAT_EMBEDDING_MODEL', 'ARK_EMBEDDING_MODEL'),
    ttsSpeaker: envFirst('AGENTPLAN_TTS_SPEAKER', 'DOUBAO_TTS_SPEAKER', 'AGENTPLAN_TTS_SPEAKER'),
  };
}

function hasRealAiConfig(aiConfig) {
  return Boolean(aiConfig.apiBase && aiConfig.apiKey && aiConfig.model && aiConfig.embeddingModel);
}

async function requestJson(url, options) {
  const response = await fetch(url, options);
  const text = await response.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = { error: text.slice(0, 500) };
  }
  return { response, body };
}

function normalizeSource(source) {
  return {
    id: source.id,
    title: source.title || source.fileName || 'source',
    fileName: source.fileName,
    fileType: source.fileType,
    shortName: source.shortName,
    vectorIndex: source.vectorIndex,
  };
}

function pickSmokeSource(sources, aiConfig) {
  const preferredId = process.env.STUDIO_TOOLS_SMOKE_SOURCE_ID?.trim();
  if (preferredId) {
    const matched = sources.find(source => source.id === preferredId);
    if (!matched) {
      throw new Error(`STUDIO_TOOLS_SMOKE_SOURCE_ID was set but no source matched: ${preferredId}`);
    }
    return { source: matched, reason: 'explicit-env-source-id' };
  }

  const scored = sources
    .filter(source => source.status === 'succeeded')
    .map(source => {
      const title = `${source.title || ''} ${source.fileName || ''}`.toLowerCase();
      const smokePenalty = title.includes('smoke') ? -30 : 0;
      const productBonus = /灵笔|studio|ppt|资料|产品|路径|自动化/i.test(`${source.title || ''} ${source.fileName || ''}`) ? 20 : 0;
      const vectorBonus = source.vectorIndex?.status === 'succeeded' ? 100 : 0;
      const vectorFailedPenalty = source.vectorIndex?.status === 'failed' ? -25 : 0;
      const modelMatchBonus = source.vectorIndex?.status === 'succeeded' && source.vectorIndex?.model === aiConfig.embeddingModel ? 40 : 0;
      const staleVectorPenalty = source.vectorIndex?.status === 'succeeded' && source.vectorIndex?.model !== aiConfig.embeddingModel ? -15 : 0;
      const chunkScore = Math.min(Number(source.chunkCount || 0), 10);
      return {
        source,
        score: vectorBonus + modelMatchBonus + productBonus + vectorFailedPenalty + staleVectorPenalty + chunkScore + smokePenalty,
      };
    })
    .sort((a, b) => b.score - a.score);

  if (scored[0]) return { source: scored[0].source, reason: `auto-ranked-score-${scored[0].score}` };
  return { source: sources[0], reason: 'fallback-first-source' };
}

async function uploadVectorSmokeSource(aiConfig) {
  if (!hasRealAiConfig(aiConfig)) {
    throw new Error('No vector-indexed source exists and real API config is incomplete; cannot create a real persisted-vector Studio smoke source.');
  }

  const text = [
    '灵笔工作室 Studio 真实向量检索测试资料。',
    '资料工作台必须先上传资料，完成 chunk、embedding 和 zvec 索引，再让右侧 Studio 产物复用同一 grounded context。',
    '互动页面、测验练习和项目研习都应基于引用片段生成，并显示 retrieval mode、citations 和 citation audit。虚拟课程另走独立课程大纲接口。',
    '如果向量索引缺失，系统必须告诉用户检索已降级，不能把关键词 fallback 当成真实通过。',
  ].join('\n');

  const formData = new FormData();
  formData.append('files', new Blob([text], { type: 'text/plain' }), `studio-tools-vector-${Date.now()}.txt`);
  formData.append('aiConfig', JSON.stringify(aiConfig));

  const { response, body } = await requestJson(`${origin}/api/upload`, {
    method: 'POST',
    body: formData,
  });
  if (!response.ok || body.success !== true) {
    throw new Error(`/api/upload could not create vector Studio smoke source: ${JSON.stringify(body).slice(0, 500)}`);
  }
  const uploaded = body.results?.[0];
  if (!uploaded?.id || uploaded.vectorIndex?.status !== 'succeeded') {
    throw new Error(`Uploaded Studio smoke source did not finish vector indexing: ${JSON.stringify({
      id: uploaded?.id,
      ingestionStatus: uploaded?.ingestionStatus,
      vectorIndex: uploaded?.vectorIndex,
    })}`);
  }
  return {
    ...uploaded,
    status: 'succeeded',
    chunkCount: uploaded.ingestionChunkCount,
    vectorIndex: uploaded.vectorIndex,
    selectionReason: 'auto-uploaded-vector-source',
  };
}

function summarizeResult(toolId, payload, status) {
  const markdown = payload.artifact?.markdown || '';
  const userFacingLeak = /OpenMAIC|openmaic|OPENMAIC|对应NotebookLM|对应外部参考工具|（对应[^）]+）/.test(markdown);
  return {
    toolId,
    ok: status === 200 && payload.success === true && markdown.length > 0 && !userFacingLeak,
    status,
    artifactId: payload.artifact?.id,
    artifactTitle: payload.artifact?.title,
    markdownLength: markdown.length,
    markdownPreview: markdown.replace(/\s+/g, ' ').slice(0, 360),
    userFacingLeak,
    retrieval: payload.retrieval,
    citationCount: payload.citations?.length || 0,
    citationAudit: payload.citationAudit,
    error: payload.error || null,
  };
}

async function main() {
  const aiConfig = buildAiConfig();
  const health = await requestJson(`${origin}/api/health`);
  if (!health.response.ok || health.body.ok !== true) {
    throw new Error(`/api/health failed at ${origin}: ${JSON.stringify(health.body).slice(0, 500)}`);
  }

  const sourceList = await requestJson(`${origin}/api/ingestion/sources`);
  if (!sourceList.response.ok) {
    throw new Error(`/api/ingestion/sources failed: ${JSON.stringify(sourceList.body).slice(0, 500)}`);
  }
  const sources = sourceList.body.sources || [];
  let picked;
  if (sources.length === 0 || process.env.STUDIO_TOOLS_SMOKE_FORCE_UPLOAD === '1') {
    const uploaded = await uploadVectorSmokeSource(aiConfig);
    picked = { source: uploaded, reason: uploaded.selectionReason };
  } else {
    picked = pickSmokeSource(sources, aiConfig);
    if (picked.source?.vectorIndex?.status !== 'succeeded') {
      const uploaded = await uploadVectorSmokeSource(aiConfig);
      picked = { source: uploaded, reason: uploaded.selectionReason };
    }
  }
  const papers = [normalizeSource(picked.source)];
  const results = [];
  for (const toolId of selectedTools) {
    const { response, body } = await requestJson(`${origin}/api/ai/studio-tool`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        toolId,
        papers,
        aiConfig,
        maxTokens: Number(process.env.STUDIO_TOOLS_SMOKE_MAX_TOKENS || 760),
      }),
    });
    const summary = summarizeResult(toolId, body, response.status);
    results.push(summary);
    if (body.artifact?.markdown) {
      await mkdir(outputDir, { recursive: true });
      await writeFile(path.join(outputDir, `${toolId}.md`), body.artifact.markdown, 'utf8');
    }
  }

  await mkdir(outputDir, { recursive: true });
  const report = {
    ok: results.every(item => item.ok),
    origin,
    scope: {
      tools: selectedTools,
      fullToolSet: selectedTools.length === defaultTools.length && selectedTools.every((tool, index) => tool === defaultTools[index]),
    },
    source: {
      id: papers[0].id,
      title: papers[0].title,
      fileName: papers[0].fileName,
      selectionReason: picked.reason,
      vectorIndex: papers[0].vectorIndex,
    },
    outputDir,
    results,
    generatedAt: new Date().toISOString(),
  };
  await writeFile(path.join(outputDir, 'latest.json'), JSON.stringify(report, null, 2), 'utf8');

  console.log(JSON.stringify(report, null, 2));
  if (!report.ok) process.exitCode = 1;
}

main().catch(error => {
  console.error(JSON.stringify({
    ok: false,
    origin,
    error: error instanceof Error ? error.message : String(error),
  }, null, 2));
  process.exitCode = 1;
});
