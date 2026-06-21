import './lib/load-real-env.mjs';
import { classifyPodcastGenerationError, generatePodcast } from '../src/lib/ai-service';

function envFirst(...names: string[]) {
  for (const name of names) {
    const value = process.env[name]?.trim();
    if (value) return { name, value };
  }
  return { name: '', value: '' };
}

async function main() {
  const appId = envFirst('VOLCENGINE_PODCAST_APP_ID');
  const accessKey = envFirst('VOLCENGINE_PODCAST_ACCESS_KEY', 'ARK_AGENTPLAN_API_KEY');
  const resourceId = envFirst('VOLCENGINE_PODCAST_RESOURCE_ID');

  const missing = [
    appId.value ? '' : 'VOLCENGINE_PODCAST_APP_ID',
    accessKey.value ? '' : 'VOLCENGINE_PODCAST_ACCESS_KEY or ARK_AGENTPLAN_API_KEY fallback',
    resourceId.value ? '' : 'VOLCENGINE_PODCAST_RESOURCE_ID',
  ].filter(Boolean);

  if (missing.length > 0) {
    console.log(JSON.stringify({
      ok: true,
      skipped: true,
      realService: false,
      name: 'real VolcEngine Podcast audio generation',
      status: 'SKIP',
      missing,
      reason: 'Missing real VolcEngine Podcast configuration.',
    }, null, 2));
    return;
  }

  const startedAt = Date.now();
  try {
    const result = await generatePodcast(
      '灵笔工作室真实播客大模型 smoke：请生成一段两人对话播客，说明资料源、引用和 Studio 产物为什么必须复用同一 grounded context。',
    );
    const audioUrl = result.audioUrl || '';
    console.log(JSON.stringify({
      ok: Boolean(audioUrl),
      realService: true,
      name: 'real VolcEngine Podcast audio generation',
      status: audioUrl ? 'PASS' : 'FAIL',
      durationMs: Date.now() - startedAt,
      provider: result.provider,
      taskIdPresent: Boolean(result.taskId),
      audioUrlType: audioUrl.startsWith('/uploads/') ? 'local-upload' : audioUrl.startsWith('data:') ? 'data-url' : audioUrl ? 'url' : 'missing',
      audioUrlLength: audioUrl.length,
      dialoguePreview: result.dialogueText?.slice(0, 220),
    }, null, 2));
    if (!audioUrl) process.exit(1);
  } catch (error) {
    const failure = classifyPodcastGenerationError(error);
    console.log(JSON.stringify({
      ok: false,
      realService: true,
      name: 'real VolcEngine Podcast audio generation',
      status: 'FAIL',
      durationMs: Date.now() - startedAt,
      errorType: failure.errorType,
      retryable: failure.retryable,
      upstreamStatus: failure.upstreamStatus,
      requestId: failure.requestId,
      error: failure.userMessage,
      detail: failure.error,
    }, null, 2));
    process.exit(1);
  }
}

main().catch(error => {
  const failure = classifyPodcastGenerationError(error);
  console.log(JSON.stringify({
    ok: false,
    realService: true,
    name: 'real VolcEngine Podcast audio generation',
    status: 'FAIL',
    errorType: failure.errorType,
    error: failure.userMessage,
    detail: failure.error,
  }, null, 2));
  process.exit(1);
});
