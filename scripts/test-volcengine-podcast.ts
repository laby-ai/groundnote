import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { WebSocketServer } from 'ws';
import {
  decodeVolcenginePodcastMessage,
  encodeVolcenginePodcastMessage,
  VolcenginePodcastEvent,
  VolcenginePodcastMsgType,
  VolcenginePodcastMsgTypeFlagBits,
} from '../src/lib/volcengine-podcast';

const mutableEnv = process.env as Record<string, string | undefined>;

function serverMessage(
  type: VolcenginePodcastMsgType,
  event: VolcenginePodcastEvent,
  payload: unknown,
  sessionId?: string,
): Buffer {
  return Buffer.from(encodeVolcenginePodcastMessage({
    type,
    flag: VolcenginePodcastMsgTypeFlagBits.WithEvent,
    event,
    sessionId,
    connectId: (
      event === VolcenginePodcastEvent.ConnectionStarted
      || event === VolcenginePodcastEvent.ConnectionFinished
      || event === VolcenginePodcastEvent.ConnectionFailed
    ) ? 'mock-connect-id' : undefined,
    payload: typeof payload === 'string' ? Buffer.from(payload) : Buffer.from(JSON.stringify(payload)),
  }));
}

async function startPodcastMock() {
  const headersSeen: Record<string, string | string[] | undefined> = {};
  const events: number[] = [];
  let startPayload: Record<string, unknown> | undefined;
  let sessionId = '';

  const server = new WebSocketServer({ host: '127.0.0.1', port: 0 });
  server.on('connection', (socket, request) => {
    for (const [key, value] of Object.entries(request.headers)) headersSeen[key] = value;
    socket.on('message', raw => {
      const message = decodeVolcenginePodcastMessage(new Uint8Array(Buffer.from(raw as Buffer)));
      if (message.event) events.push(message.event);
      if (message.event === VolcenginePodcastEvent.StartConnection) {
        socket.send(serverMessage(VolcenginePodcastMsgType.FullServerResponse, VolcenginePodcastEvent.ConnectionStarted, {}));
      }
      if (message.event === VolcenginePodcastEvent.StartSession) {
        sessionId = message.sessionId || '';
        startPayload = JSON.parse(Buffer.from(message.payload).toString('utf8')) as Record<string, unknown>;
        socket.send(serverMessage(VolcenginePodcastMsgType.FullServerResponse, VolcenginePodcastEvent.SessionStarted, {}, sessionId));
      }
      if (message.event === VolcenginePodcastEvent.FinishSession) {
        socket.send(serverMessage(VolcenginePodcastMsgType.FullServerResponse, VolcenginePodcastEvent.PodcastRoundStart, {
          round_id: 1,
          speaker: 'zh_male_dayixiansheng_v2_saturn_bigtts',
          text: '欢迎收听灵笔播客。',
        }, sessionId));
        socket.send(serverMessage(VolcenginePodcastMsgType.AudioOnlyServer, VolcenginePodcastEvent.PodcastRoundResponse, 'mock-audio', sessionId));
        socket.send(serverMessage(VolcenginePodcastMsgType.FullServerResponse, VolcenginePodcastEvent.PodcastRoundEnd, {
          round_id: 1,
          is_error: false,
        }, sessionId));
        socket.send(serverMessage(VolcenginePodcastMsgType.FullServerResponse, VolcenginePodcastEvent.PodcastEnd, {
          meta_info: {
            audio_url: 'https://cdn.example.com/lingbi-volcengine-podcast.mp3',
          },
        }, sessionId));
        socket.send(serverMessage(VolcenginePodcastMsgType.FullServerResponse, VolcenginePodcastEvent.SessionFinished, {}, sessionId));
      }
      if (message.event === VolcenginePodcastEvent.FinishConnection) {
        socket.send(serverMessage(VolcenginePodcastMsgType.FullServerResponse, VolcenginePodcastEvent.ConnectionFinished, {}));
      }
    });
  });

  await new Promise<void>(resolve => server.once('listening', () => resolve()));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Unable to allocate VolcEngine Podcast mock port.');

  return {
    endpoint: `ws://127.0.0.1:${address.port}/api/v3/sami/podcasttts`,
    getHeaders: () => headersSeen,
    getEvents: () => events,
    getStartPayload: () => startPayload,
    close: () => new Promise<void>(resolve => server.close(() => resolve())),
  };
}

async function startRejectingUpgradeMock() {
  const server = createServer();
  server.on('upgrade', (_request, socket) => {
    const body = JSON.stringify({ error: 'load grant: requested grant not found in SaaS storage' });
    socket.write([
      'HTTP/1.1 401 Unauthorized',
      'Content-Type: application/json',
      'X-Tt-Logid: mock-volc-logid',
      `Content-Length: ${Buffer.byteLength(body)}`,
      '',
      body,
    ].join('\r\n'));
    socket.destroy();
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', () => resolve()));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Unable to allocate VolcEngine Podcast rejecting mock port.');
  return {
    endpoint: `ws://127.0.0.1:${address.port}/api/v3/sami/podcasttts`,
    close: () => new Promise<void>(resolve => server.close(() => resolve())),
  };
}

async function main() {
  const mock = await startPodcastMock();
  const originals = {
    endpoint: mutableEnv.VOLCENGINE_PODCAST_WS_ENDPOINT,
    appId: mutableEnv.VOLCENGINE_PODCAST_APP_ID,
    accessKey: mutableEnv.VOLCENGINE_PODCAST_ACCESS_KEY,
    resourceId: mutableEnv.VOLCENGINE_PODCAST_RESOURCE_ID,
    speakers: mutableEnv.VOLCENGINE_PODCAST_SPEAKERS,
    arkAgentPlanKey: mutableEnv.ARK_AGENTPLAN_API_KEY,
    podcastProvider: mutableEnv.PODCAST_AUDIO_PROVIDER,
  };

  try {
    mutableEnv.VOLCENGINE_PODCAST_WS_ENDPOINT = mock.endpoint;
    mutableEnv.VOLCENGINE_PODCAST_APP_ID = '1643679590';
    mutableEnv.VOLCENGINE_PODCAST_ACCESS_KEY = 'test-volcengine-access-key';
    mutableEnv.VOLCENGINE_PODCAST_RESOURCE_ID = 'volc.service_type.10050';
    mutableEnv.VOLCENGINE_PODCAST_SPEAKERS = 'zh_male_dayixiansheng_v2_saturn_bigtts,zh_female_mizaitongxue_v2_saturn_bigtts';
    mutableEnv.PODCAST_AUDIO_PROVIDER = 'volcengine-podcast';
    delete mutableEnv.ARK_AGENTPLAN_API_KEY;

    const { generatePodcast, classifyPodcastGenerationError } = await import('../src/lib/ai-service');
    const result = await generatePodcast('灵笔工作室播客应使用火山豆包播客 WebSocket v3 协议。');

    assert.equal(result.provider, 'volcengine-podcast-ws-v3');
    assert.equal(result.audioUrl, 'https://cdn.example.com/lingbi-volcengine-podcast.mp3');
    assert.ok(result.dialogueText?.includes('灵笔工作室播客'));

    const headers = mock.getHeaders();
    assert.equal(headers['x-api-app-id'], '1643679590');
    assert.equal(headers['x-api-resource-id'], 'volc.service_type.10050');
    assert.equal(headers['x-api-app-key'], 'aGjiRDfUWi');
    assert.equal(headers['x-api-access-key'], 'test-volcengine-access-key');

    const payload = mock.getStartPayload() as {
      action?: number;
      input_text?: string;
      input_info?: { return_audio_url?: boolean };
      audio_config?: { format?: string; sample_rate?: number };
      speaker_info?: { speakers?: string[] };
    };
    assert.equal(payload.action, 0);
    assert.equal(payload.input_info?.return_audio_url, true);
    assert.equal(payload.audio_config?.format, 'mp3');
    assert.equal(payload.audio_config?.sample_rate, 24000);
    assert.equal(payload.speaker_info?.speakers?.length, 2);

    assert.deepEqual(mock.getEvents(), [
      VolcenginePodcastEvent.StartConnection,
      VolcenginePodcastEvent.StartSession,
      VolcenginePodcastEvent.FinishSession,
      VolcenginePodcastEvent.FinishConnection,
    ]);

    const authFailure = classifyPodcastGenerationError(
      new Error('VolcEngine Podcast server error code=401 payload={"message":"invalid access key"}'),
    );
    assert.equal(authFailure.errorType, 'auth');
    assert.equal(authFailure.retryable, false);

    const rejectingMock = await startRejectingUpgradeMock();
    try {
      mutableEnv.VOLCENGINE_PODCAST_WS_ENDPOINT = rejectingMock.endpoint;
      await assert.rejects(
        () => generatePodcast('灵笔工作室播客鉴权失败时应保留火山返回的脱敏 body。'),
        error => {
          assert.ok(error instanceof Error);
          assert.match(error.message, /HTTP 401/);
          assert.match(error.message, /requested grant not found/);
          assert.match(error.message, /mock-volc-logid/);
          return true;
        },
      );
    } finally {
      await rejectingMock.close();
      mutableEnv.VOLCENGINE_PODCAST_WS_ENDPOINT = mock.endpoint;
    }

    console.log(JSON.stringify({
      ok: true,
      checked: [
        'VolcEngine Podcast provider is selected when PODCAST_AUDIO_PROVIDER=volcengine-podcast',
        'WebSocket headers include App ID, fixed App Key, Access Key, Resource-Id and Connect-Id',
        'StartConnection -> StartSession -> FinishSession -> FinishConnection event flow is emitted',
        'Podcast action=0 payload requests return_audio_url and two official speakers',
        'PodcastEnd meta_info.audio_url is returned as audioUrl',
        'VolcEngine invalid access key is classified as non-retryable auth failure',
        'VolcEngine WebSocket 401 response body and logid are preserved for diagnostics',
      ],
      provider: result.provider,
      audioUrl: result.audioUrl,
    }, null, 2));
  } finally {
    const restore = (name: string, value: string | undefined) => {
      if (value === undefined) delete mutableEnv[name];
      else mutableEnv[name] = value;
    };
    restore('VOLCENGINE_PODCAST_WS_ENDPOINT', originals.endpoint);
    restore('VOLCENGINE_PODCAST_APP_ID', originals.appId);
    restore('VOLCENGINE_PODCAST_ACCESS_KEY', originals.accessKey);
    restore('VOLCENGINE_PODCAST_RESOURCE_ID', originals.resourceId);
    restore('VOLCENGINE_PODCAST_SPEAKERS', originals.speakers);
    restore('ARK_AGENTPLAN_API_KEY', originals.arkAgentPlanKey);
    restore('PODCAST_AUDIO_PROVIDER', originals.podcastProvider);
    await mock.close();
  }
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
