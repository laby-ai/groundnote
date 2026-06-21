import { NextRequest, NextResponse } from 'next/server';
import { embedTexts, llmInvoke } from '@/lib/ai-service';
import { redactRuntimeAISecrets, resolveOpenAIChatEndpoint, resolveOpenAIEmbeddingsEndpoint } from '@/lib/runtime-ai-config';
import type { RuntimeAIConfig } from '@/types';

const VISION_TEST_TIMEOUT_MS = 60000;
const EMBEDDING_TEST_TIMEOUT_MS = 30000;
const TINY_PNG_DATA_URL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAFklEQVR4nGP4TyFgGDVg1IBRA4aLAQBdePwur/3haQAAAABJRU5ErkJggg==';

function readPositiveIntEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

const TEXT_TEST_TIMEOUT_MS = readPositiveIntEnv('AI_TEST_CONFIG_TEXT_TIMEOUT_MS', 45000);
const VISION_TIMEOUT_MS = readPositiveIntEnv('AI_TEST_CONFIG_VISION_TIMEOUT_MS', VISION_TEST_TIMEOUT_MS);
const EMBEDDING_TIMEOUT_MS = readPositiveIntEnv('AI_TEST_CONFIG_EMBEDDING_TIMEOUT_MS', EMBEDDING_TEST_TIMEOUT_MS);

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('连接测试超时，请检查 API Base、网络或模型名。')), timeoutMs);
    promise
      .then((value) => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch((error: unknown) => {
        clearTimeout(timer);
        reject(error);
      });
  });
}

export async function POST(request: NextRequest) {
  let apiKeyForRedaction = '';
  try {
    const { aiConfig } = await request.json() as { aiConfig?: Partial<RuntimeAIConfig> };
    apiKeyForRedaction = aiConfig?.apiKey || '';

    if (!aiConfig?.apiBase?.trim() || !aiConfig.apiKey?.trim()) {
      return NextResponse.json({ ok: false, error: '请先填写 API Base 和 API Key。' }, { status: 400 });
    }

    try {
      resolveOpenAIChatEndpoint(aiConfig);
      if (aiConfig.embeddingModel?.trim()) {
        resolveOpenAIEmbeddingsEndpoint(aiConfig);
      }
    } catch (error: unknown) {
      const message = redactRuntimeAISecrets(
        error instanceof Error ? error.message : 'API Base 配置不正确',
        aiConfig.apiKey,
      );
      return NextResponse.json({ ok: false, error: message }, { status: 400 });
    }

    const content = await withTimeout(
      llmInvoke(
        [
          { role: 'system', content: 'You are a connectivity test endpoint. Reply with exactly OK.' },
          { role: 'user', content: 'Return OK.' },
        ],
        { temperature: 0, model: aiConfig.model?.trim() || undefined },
        undefined,
        aiConfig,
      ),
      TEXT_TEST_TIMEOUT_MS,
    );

    const visionModel = aiConfig.visionModel?.trim();
    let visionSample: string | undefined;
    if (visionModel) {
      visionSample = await withTimeout(
        llmInvoke(
          [
            {
              role: 'user',
              content: [
                { type: 'text', text: 'This is a 1x1 test image. Reply with exactly VISION_OK.' },
                { type: 'image_url', image_url: { url: TINY_PNG_DATA_URL } },
              ],
            },
          ],
          { temperature: 0, model: visionModel, vision: true },
          undefined,
          aiConfig,
        ),
        VISION_TIMEOUT_MS,
      );
    }

    const embeddingModel = aiConfig.embeddingModel?.trim();
    let embeddingDimension: number | undefined;
    if (embeddingModel) {
      const embeddings = await withTimeout(
        embedTexts(['lingbi vector connectivity test'], aiConfig),
        EMBEDDING_TIMEOUT_MS,
      );
      embeddingDimension = embeddings[0]?.length;
    }

    return NextResponse.json({
      ok: true,
      model: aiConfig.model?.trim() || 'default',
      visionModel: visionModel || undefined,
      embeddingModel: embeddingModel || undefined,
      ttsSpeaker: aiConfig.ttsSpeaker?.trim() || undefined,
      sample: content.slice(0, 80),
      visionSample: visionSample?.slice(0, 80),
      embeddingDimension,
    });
  } catch (error: unknown) {
    const message = redactRuntimeAISecrets(
      error instanceof Error ? error.message : '连接测试失败',
      apiKeyForRedaction,
    );
    return NextResponse.json({ ok: false, error: message }, { status: 502 });
  }
}
