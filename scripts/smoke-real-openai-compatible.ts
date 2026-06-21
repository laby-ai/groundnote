import './lib/load-real-env.mjs';
import path from 'node:path';
import { embedTexts, llmInvoke } from '../src/lib/ai-service';
import { redactRuntimeAISecrets, resolveOpenAIChatEndpoint, resolveOpenAIEmbeddingsEndpoint } from '../src/lib/runtime-ai-config';
import { querySourceChunks, upsertSourceChunks } from '../src/lib/vector-store';
import type { RuntimeAIConfig } from '../src/types';

type SmokeResult = {
  ok: boolean;
  skipped?: boolean;
  realService: boolean;
  checked: string[];
  missing?: string[];
  model?: string;
  embeddingModel?: string;
  chatEndpoint?: string;
  embeddingsEndpoint?: string;
  chatSampleLength?: number;
  embeddingDimension?: number;
  zvecTopHit?: string;
};

function envFirst(...names: string[]): string {
  for (const name of names) {
    const value = process.env[name]?.trim();
    if (value) return value;
  }
  return '';
}

function endpointLabel(endpoint: string): string {
  try {
    const url = new URL(endpoint);
    return `${url.protocol}//${url.host}${url.pathname}`;
  } catch {
    return '[invalid endpoint]';
  }
}

function buildRuntimeConfigFromEnv(): Partial<RuntimeAIConfig> {
  return {
    apiBase: envFirst('OPENAI_COMPAT_API_BASE', 'ARK_API_BASE', 'OPENAI_API_BASE'),
    apiKey: envFirst('OPENAI_COMPAT_API_KEY', 'ARK_API_KEY', 'OPENAI_API_KEY'),
    model: envFirst('OPENAI_COMPAT_MODEL', 'ARK_MODEL'),
    visionModel: envFirst('OPENAI_COMPAT_VISION_MODEL', 'ARK_VISION_MODEL'),
    embeddingModel: envFirst('OPENAI_COMPAT_EMBEDDING_MODEL', 'ARK_EMBEDDING_MODEL'),
  };
}

function printJson(value: SmokeResult) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

async function main() {
  const aiConfig = buildRuntimeConfigFromEnv();
  const missing = [
    aiConfig.apiBase?.trim() ? '' : 'OPENAI_COMPAT_API_BASE or ARK_API_BASE',
    aiConfig.apiKey?.trim() ? '' : 'OPENAI_COMPAT_API_KEY or ARK_API_KEY',
  ].filter(Boolean);

  if (missing.length > 0) {
    printJson({
      ok: true,
      skipped: true,
      realService: false,
      checked: ['real OpenAI-compatible smoke env contract'],
      missing,
    });
    return;
  }

  process.env.ZVEC_STORE_PATH ||= path.join('.data', 'smoke-real-openai-compatible', 'zvec');

  const checked: string[] = [];
  try {
    const chatEndpoint = resolveOpenAIChatEndpoint(aiConfig);
    checked.push('resolved chat endpoint with production guards');

    const content = await llmInvoke(
      [
        { role: 'system', content: 'You are a tiny production smoke test. Reply with a short confirmation only.' },
        { role: 'user', content: 'Return the phrase LINGBI_REAL_SMOKE_OK.' },
      ],
      { temperature: 0, model: aiConfig.model || undefined, maxTokens: 32 },
      undefined,
      aiConfig,
    );
    if (!content.trim()) {
      throw new Error('真实文本模型返回了空内容。');
    }
    checked.push('real chat completion');

    let embeddingsEndpoint: string | undefined;
    let embeddingDimension: number | undefined;
    let zvecTopHit: string | undefined;
    if (aiConfig.embeddingModel?.trim()) {
      embeddingsEndpoint = resolveOpenAIEmbeddingsEndpoint(aiConfig);
      checked.push('resolved embeddings endpoint with production guards');

      const [embedding] = await embedTexts(['lingbi real embedding smoke source chunk'], aiConfig);
      embeddingDimension = embedding?.length;
      if (!embeddingDimension) throw new Error('真实向量模型没有返回有效向量。');
      checked.push('real embedding generation');

      const chunkId = `real-openai-compatible-smoke::chunk-${embeddingDimension}`;
      await upsertSourceChunks([
        {
          id: chunkId,
          sourceId: 'real-openai-compatible-smoke',
          sourceIndex: 0,
          sourceTitle: 'Real OpenAI-compatible Smoke',
          paperShortName: 'Lingbi Real Smoke',
          chunkIndex: 0,
          page: 1,
          text: 'This chunk validates real embedding generation, zvec persistence, and citation retrieval.',
          tokenEstimate: 16,
          embedding,
        },
      ]);
      checked.push('zvec upsert using real embedding');

      const hits = await querySourceChunks(embedding, { topK: 1 });
      if (hits[0]?.chunkId !== chunkId) {
        throw new Error('zvec 查询没有返回刚写入的真实向量 chunk。');
      }
      zvecTopHit = hits[0].chunkId;
      checked.push('zvec query and citation metadata');
    } else {
      checked.push('embedding/zvec skipped: no embedding model env');
    }

    printJson({
      ok: true,
      realService: true,
      checked,
      model: aiConfig.model || 'default',
      embeddingModel: aiConfig.embeddingModel || undefined,
      chatEndpoint: endpointLabel(chatEndpoint),
      embeddingsEndpoint: embeddingsEndpoint ? endpointLabel(embeddingsEndpoint) : undefined,
      chatSampleLength: content.trim().length,
      embeddingDimension,
      zvecTopHit,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    const safeMessage = redactRuntimeAISecrets(message, aiConfig.apiKey);
    throw new Error(safeMessage);
  }
}

main().catch(error => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
