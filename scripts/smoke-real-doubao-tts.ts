import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import './lib/load-real-env.mjs';
import { classifyPodcastGenerationError } from '../src/lib/ai-service';
import { synthesizeDoubaoAgentPlanTts } from '../src/lib/doubao-agentplan-tts';

function envFirst(...names: string[]) {
  for (const name of names) {
    const value = process.env[name]?.trim();
    if (value) return { name, value };
  }
  return { name: '', value: '' };
}

function localUploadPath(audioUri: string) {
  if (!audioUri.startsWith('/uploads/')) return '';
  const relative = audioUri.replace(/^\/+/, '').replace(/\//g, path.sep);
  return path.join(process.cwd(), 'public', relative);
}

function readAudioDurationSeconds(filePath: string): number | undefined {
  if (!filePath) return undefined;
  const result = spawnSync('ffprobe', [
    '-v',
    'error',
    '-show_entries',
    'format=duration',
    '-of',
    'default=noprint_wrappers=1:nokey=1',
    filePath,
  ], { encoding: 'utf8' });
  if (result.status !== 0) return undefined;
  const duration = Number(result.stdout.trim());
  return Number.isFinite(duration) ? duration : undefined;
}

function ttsFixHint(detail: string) {
  if (/55000000|resource.?id.*mismatch|resource id is mismatched with speaker|音色.*Resource-Id|Resource-Id.*音色/i.test(detail)) {
    return 'AGENTPLAN_TTS_SPEAKER must come from the same Agent Plan/Doubao TTS model as AGENTPLAN_TTS_RESOURCE_ID. For seed-tts-2.0, copy a matching speaker from the Doubao speech synthesis 2.0 console.';
  }
  return undefined;
}

async function main() {
  const endpoint = process.env.AGENTPLAN_TTS_ENDPOINT?.trim()
    || process.env.DOUBAO_TTS_ENDPOINT?.trim()
    || process.env.AGENTPLAN_TTS_ENDPOINT?.trim()
    || 'https://openspeech.bytedance.com/api/v3/plan/tts/unidirectional';
  const resourceId = process.env.AGENTPLAN_TTS_RESOURCE_ID?.trim()
    || process.env.DOUBAO_TTS_RESOURCE_ID?.trim()
    || process.env.AGENTPLAN_TTS_RESOURCE_ID?.trim()
    || 'seed-tts-2.0';
  const apiKey = envFirst('AGENTPLAN_TTS_API_KEY', 'DOUBAO_TTS_API_KEY', 'AGENTPLAN_TTS_API_KEY', 'ARK_AGENTPLAN_API_KEY');
  const speaker = envFirst('AGENTPLAN_TTS_SPEAKER', 'DOUBAO_TTS_SPEAKER', 'AGENTPLAN_TTS_SPEAKER', 'ARK_TTS_SPEAKER');

  const missing = [
    endpoint ? '' : 'AGENTPLAN_TTS_ENDPOINT',
    resourceId ? '' : 'AGENTPLAN_TTS_RESOURCE_ID',
    apiKey.value ? '' : 'AGENTPLAN_TTS_API_KEY',
    speaker.value ? '' : 'AGENTPLAN_TTS_SPEAKER or DOUBAO_TTS_SPEAKER',
  ].filter(Boolean);

  if (missing.length > 0) {
    console.log(JSON.stringify({
      ok: true,
      skipped: true,
      realService: false,
      name: 'real Doubao Agent Plan TTS audio generation',
      status: 'SKIP',
      missing,
      reason: 'Missing real Doubao Agent Plan TTS configuration.',
    }, null, 2));
    return;
  }

  const startedAt = Date.now();
  try {
    const result = await synthesizeDoubaoAgentPlanTts(
      '灵笔工作室真实语音摘要 smoke：验证豆包 Agent Plan TTS 能否生成一段短音频。',
      {
        apiKey: apiKey.value,
        speaker: speaker.value,
        filePrefix: 'podcast-smoke',
        maxChars: 120,
      },
    );
    const filePath = localUploadPath(result.audioUri);
    const fileSize = filePath && fs.existsSync(filePath) ? fs.statSync(filePath).size : 0;
    const durationSeconds = filePath ? readAudioDurationSeconds(filePath) : undefined;
    const minDurationSeconds = Number(process.env.REAL_DOUBAO_TTS_MIN_DURATION_SECONDS || 3);
    const durationOk = typeof durationSeconds === 'number' && durationSeconds >= minDurationSeconds;
    const ok = Boolean(result.audioUri) && (!filePath || fileSize > 0) && durationOk;

    console.log(JSON.stringify({
      ok,
      realService: true,
      name: 'real Doubao Agent Plan TTS audio generation',
      status: ok ? 'PASS' : 'FAIL',
      durationMs: Date.now() - startedAt,
      provider: result.provider,
      audioUrl: result.audioUri,
      localPath: filePath || undefined,
      fileSize,
      durationSeconds,
      minDurationSeconds,
      contentType: result.contentType,
      textLength: result.textLength,
      failureReason: durationOk ? undefined : 'Generated audio is too short or ffprobe could not read its duration.',
    }, null, 2));
    if (!ok) {
      process.exitCode = 1;
      return;
    }
  } catch (error) {
    const failure = classifyPodcastGenerationError(error);
    const fixHint = ttsFixHint(`${failure.userMessage}\n${failure.error}`);
    console.log(JSON.stringify({
      ok: false,
      realService: true,
      name: 'real Doubao Agent Plan TTS audio generation',
      status: 'FAIL',
      durationMs: Date.now() - startedAt,
      errorType: failure.errorType,
      retryable: failure.retryable,
      upstreamStatus: failure.upstreamStatus,
      requestId: failure.requestId,
      error: failure.userMessage,
      detail: failure.error,
      fixHint,
    }, null, 2));
    process.exitCode = 1;
  }
}

main().catch(error => {
  const failure = classifyPodcastGenerationError(error);
  console.log(JSON.stringify({
    ok: false,
    realService: true,
    name: 'real Doubao Agent Plan TTS audio generation',
    status: 'FAIL',
    errorType: failure.errorType,
    error: failure.userMessage,
    detail: failure.error,
  }, null, 2));
  process.exitCode = 1;
});
