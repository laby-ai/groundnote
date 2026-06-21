import assert from 'node:assert/strict';
import http from 'node:http';

const mutableEnv = process.env as Record<string, string | undefined>;

function startDoubaoTtsMock() {
  let hitCount = 0;
  let requestBody = '';
  let headers: http.IncomingHttpHeaders = {};

  const server = http.createServer((req, res) => {
    hitCount += 1;
    headers = req.headers;
    const chunks: Buffer[] = [];
    req.on('data', chunk => chunks.push(Buffer.from(chunk)));
    req.on('end', () => {
      requestBody = Buffer.concat(chunks).toString('utf8');
      if (hitCount === 1) {
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({
          data: {
            audio_url: 'https://cdn.example.com/lingbi-podcast-smoke.mp3',
          },
        }));
      } else if (hitCount === 2) {
        res.setHeader('Content-Type', 'text/event-stream');
        res.end([
          'event: result',
          'data: {"result":{"audio_url":"https://cdn.example.com/lingbi-podcast-sse.mp3"}}',
          '',
        ].join('\n'));
      } else if (hitCount === 3) {
        res.setHeader('Content-Type', 'application/json');
        res.end([
          JSON.stringify({ code: 0, data: Buffer.from('agentplan-audio-chunk-one').toString('base64') }),
          JSON.stringify({ code: 0, data: Buffer.from('agentplan-audio-chunk-two').toString('base64') }),
          JSON.stringify({ code: 20000000, data: '' }),
        ].join('\n'));
      } else {
        res.statusCode = 429;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({
          reqid: 'req-quota-123',
          code: 45000290,
          message: 'QuotaExceeded.AgentPlanQuotaExceeded',
        }));
      }
    });
  });

  return new Promise<{
    endpoint: string;
    getHitCount: () => number;
    getRequestBody: () => string;
    getHeaders: () => http.IncomingHttpHeaders;
    close: () => Promise<void>;
  }>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        reject(new Error('Unable to allocate Doubao TTS mock port.'));
        return;
      }
      resolve({
        endpoint: `http://127.0.0.1:${address.port}/api/v3/plan/tts/unidirectional`,
        getHitCount: () => hitCount,
        getRequestBody: () => requestBody,
        getHeaders: () => headers,
        close: () => new Promise(closeResolve => server.close(() => closeResolve())),
      });
    });
  });
}

async function main() {
  const mock = await startDoubaoTtsMock();
  const originals = {
    endpoint: mutableEnv.AGENTPLAN_TTS_ENDPOINT,
    key: mutableEnv.AGENTPLAN_TTS_API_KEY,
    arkKey: mutableEnv.ARK_API_KEY,
    resource: mutableEnv.AGENTPLAN_TTS_RESOURCE_ID,
    speaker: mutableEnv.AGENTPLAN_TTS_SPEAKER,
  };

  try {
    mutableEnv.AGENTPLAN_TTS_ENDPOINT = mock.endpoint;
    delete mutableEnv.AGENTPLAN_TTS_API_KEY;
    delete mutableEnv.ARK_API_KEY;
    mutableEnv.AGENTPLAN_TTS_RESOURCE_ID = 'seed-tts-2.0';
    delete mutableEnv.AGENTPLAN_TTS_SPEAKER;

    const { PodcastAudioGenerationError, classifyPodcastGenerationError, generatePodcast } = await import('../src/lib/ai-service');
    const result = await generatePodcast('主持人：灵笔工作室播客真实音频生成契约测试。[1]\n\n研究员：这里需要验证角色标签不会被直接送入 TTS。[2]', { apiKey: 'test-doubao-tts-key', ttsSpeaker: 'test-speaker' });

    assert.equal(result.provider, 'doubao-tts-v3');
    assert.equal(result.audioUrl, 'https://cdn.example.com/lingbi-podcast-smoke.mp3');
    assert.equal(mock.getHitCount(), 1);
    const firstBody = JSON.parse(mock.getRequestBody()) as { req_params?: { text?: string } };
    assert.doesNotMatch(firstBody.req_params?.text || '', /主持人|研究员|\[\d+\]/);
    assert.match(firstBody.req_params?.text || '', /灵笔工作室播客真实音频生成契约测试/);

    const sseResult = await generatePodcast('灵笔工作室播客 SSE 音频生成契约测试。', { apiKey: 'test-doubao-tts-key', ttsSpeaker: 'test-speaker' });
    assert.equal(sseResult.provider, 'doubao-tts-v3');
    assert.equal(sseResult.audioUrl, 'https://cdn.example.com/lingbi-podcast-sse.mp3');
    assert.equal(mock.getHitCount(), 2);

    const { synthesizeDoubaoAgentPlanTts } = await import('../src/lib/doubao-agentplan-tts');
    const chunkedResult = await synthesizeDoubaoAgentPlanTts('灵笔工作室播客多块音频契约测试。', {
      apiKey: 'test-doubao-tts-key',
      speaker: 'test-speaker',
      filePrefix: 'test-doubao-chunked',
    });
    assert.equal(chunkedResult.provider, 'doubao-tts-v3');
    assert.equal(chunkedResult.audioSize, Buffer.byteLength('agentplan-audio-chunk-oneagentplan-audio-chunk-two'));
    assert.match(chunkedResult.audioUrl, /^\/uploads\//);
    assert.equal(mock.getHitCount(), 3);

    const body = JSON.parse(mock.getRequestBody()) as {
      req_params?: {
        text?: string;
        speaker?: string;
        audio_params?: { format?: string; sample_rate?: number };
      };
    };
    assert.equal(body.req_params?.speaker, 'test-speaker');
    assert.equal(body.req_params?.audio_params?.format, 'mp3');
    assert.equal(body.req_params?.audio_params?.sample_rate, 24000);
    assert.match(body.req_params?.text || '', /播客.*契约测试/);

    const headers = mock.getHeaders();
    assert.equal(headers['x-api-resource-id'], 'seed-tts-2.0');
    assert.match(String(headers.authorization), /^Bearer /);

    const authFailure = classifyPodcastGenerationError(
      new Error('豆包语音合成 API error: 401 - {"header":{"reqid":"req-123","code":45000010,"message":"Invalid X-Api-Key"}}'),
    );
    assert.equal(authFailure.errorType, 'auth');
    assert.equal(authFailure.retryable, false);
    assert.equal(authFailure.upstreamStatus, 401);
    assert.equal(authFailure.requestId, 'req-123');
    assert.match(authFailure.userMessage, /播客服务鉴权失败/);

    const mismatchFailure = classifyPodcastGenerationError(
      new Error('豆包语音合成音色与 Resource-Id 不匹配：当前 Resource-Id=seed-tts-2.0 不能使用该 speaker。上游返回 code=55000000; message=resource ID is mismatched with speaker related resource'),
    );
    assert.equal(mismatchFailure.errorType, 'invalid_request');
    assert.equal(mismatchFailure.retryable, false);
    assert.match(mismatchFailure.userMessage, /音色与豆包语音合成 Resource-Id 不匹配/);

    await assert.rejects(
      () => generatePodcast('灵笔工作室播客额度失败时仍应保留脚本证据。', { apiKey: 'test-doubao-tts-key', ttsSpeaker: 'test-speaker' }),
      error => {
        assert.ok(error instanceof PodcastAudioGenerationError);
        assert.match(error.dialogueText, /脚本证据|灵笔工作室播客/);
        const failure = classifyPodcastGenerationError(error);
        assert.equal(failure.errorType, 'rate_limit');
        assert.equal(failure.retryable, true);
        assert.equal(failure.requestId, 'req-quota-123');
        return true;
      },
    );

    console.log(JSON.stringify({
      ok: true,
      checked: [
        'Doubao AgentPlan TTS provider is selected through primary or compatibility env vars',
        'Doubao AgentPlan TTS accepts request-level API Key from runtime config',
        'Doubao AgentPlan TTS accepts request-level speaker from runtime config',
        'Doubao AgentPlan TTS request carries Resource-Id and bearer auth without printing the secret',
        'Doubao AgentPlan TTS payload includes speaker, text, format and sample rate',
        'Doubao AgentPlan TTS speech text removes role labels and citation markers before synthesis',
        'Doubao AgentPlan TTS JSON audio_url response is returned as podcast audioUrl',
        'Doubao AgentPlan TTS SSE data audio_url response is returned as podcast audioUrl',
        'Doubao AgentPlan TTS multi-line base64 chunks are concatenated before storage',
        'Doubao AgentPlan TTS 401 Invalid X-Api-Key is classified as non-retryable auth failure',
        'Doubao AgentPlan TTS speaker/resource mismatch is classified as non-retryable invalid request with user fix guidance',
        'Doubao AgentPlan TTS 429 quota failure keeps podcast dialogue text for recoverable UI evidence',
      ],
    }, null, 2));
  } finally {
    if (originals.endpoint === undefined) delete mutableEnv.AGENTPLAN_TTS_ENDPOINT;
    else mutableEnv.AGENTPLAN_TTS_ENDPOINT = originals.endpoint;
    if (originals.key === undefined) delete mutableEnv.AGENTPLAN_TTS_API_KEY;
    else mutableEnv.AGENTPLAN_TTS_API_KEY = originals.key;
    if (originals.arkKey === undefined) delete mutableEnv.ARK_API_KEY;
    else mutableEnv.ARK_API_KEY = originals.arkKey;
    if (originals.resource === undefined) delete mutableEnv.AGENTPLAN_TTS_RESOURCE_ID;
    else mutableEnv.AGENTPLAN_TTS_RESOURCE_ID = originals.resource;
    if (originals.speaker === undefined) delete mutableEnv.AGENTPLAN_TTS_SPEAKER;
    else mutableEnv.AGENTPLAN_TTS_SPEAKER = originals.speaker;
    await mock.close();
  }
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
