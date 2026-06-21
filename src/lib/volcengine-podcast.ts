import { randomUUID } from 'node:crypto';
import WebSocket from 'ws';

const DEFAULT_ENDPOINT = 'wss://openspeech.bytedance.com/api/v3/sami/podcasttts';
const DEFAULT_RESOURCE_ID = 'volc.service_type.10050';
const DEFAULT_APP_KEY = 'aGjiRDfUWi';
const DEFAULT_SPEAKERS = [
  'zh_male_dayixiansheng_v2_saturn_bigtts',
  'zh_female_mizaitongxue_v2_saturn_bigtts',
];

export type VolcenginePodcastConfig = {
  endpoint: string;
  appId: string;
  accessKey: string;
  resourceId: string;
  appKey: string;
  speakers: string[];
  format: string;
  sampleRate: number;
  speechRate: number;
  timeoutMs: number;
  returnAudioUrl: boolean;
};

export type VolcenginePodcastResult = {
  audioUrl?: string;
  audioBuffer?: Buffer;
  format: string;
  sessionId: string;
  taskId: string;
  rounds: Array<{ roundId?: number; speaker?: string; text?: string }>;
  usage?: unknown;
};

export enum VolcenginePodcastEvent {
  StartConnection = 1,
  FinishConnection = 2,
  ConnectionStarted = 50,
  ConnectionFailed = 51,
  ConnectionFinished = 52,
  StartSession = 100,
  FinishSession = 102,
  SessionStarted = 150,
  SessionFinished = 152,
  SessionFailed = 153,
  UsageResponse = 154,
  PodcastRoundStart = 360,
  PodcastRoundResponse = 361,
  PodcastRoundEnd = 362,
  PodcastEnd = 363,
}

export enum VolcenginePodcastMsgType {
  FullClientRequest = 0b1,
  FullServerResponse = 0b1001,
  AudioOnlyServer = 0b1011,
  Error = 0b1111,
}

export enum VolcenginePodcastMsgTypeFlagBits {
  NoSeq = 0,
  PositiveSeq = 0b1,
  NegativeSeq = 0b11,
  WithEvent = 0b100,
}

enum SerializationBits {
  JSON = 0b1,
}

type VolcenginePodcastMessage = {
  type: VolcenginePodcastMsgType;
  flag: VolcenginePodcastMsgTypeFlagBits;
  event?: VolcenginePodcastEvent;
  sessionId?: string;
  connectId?: string;
  sequence?: number;
  errorCode?: number;
  payload: Uint8Array;
};

function readEnv(...names: string[]): string {
  for (const name of names) {
    const value = process.env[name]?.trim();
    if (value) return value;
  }
  return '';
}

function parseSpeakers(value: string): string[] {
  if (!value.trim()) return DEFAULT_SPEAKERS;
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) {
      const speakers = parsed.map(item => String(item).trim()).filter(Boolean);
      if (speakers.length >= 2) return speakers.slice(0, 2);
    }
  } catch {
    // CSV fallback below.
  }
  const speakers = value.split(',').map(item => item.trim()).filter(Boolean);
  return speakers.length >= 2 ? speakers.slice(0, 2) : DEFAULT_SPEAKERS;
}

export function resolveVolcenginePodcastConfig(): VolcenginePodcastConfig {
  const speakers = parseSpeakers(readEnv('VOLCENGINE_PODCAST_SPEAKERS'));
  return {
    endpoint: readEnv('VOLCENGINE_PODCAST_WS_ENDPOINT') || DEFAULT_ENDPOINT,
    appId: readEnv('VOLCENGINE_PODCAST_APP_ID'),
    accessKey: readEnv(
      'VOLCENGINE_PODCAST_ACCESS_KEY',
      'ARK_AGENTPLAN_API_KEY',
    ),
    resourceId: readEnv('VOLCENGINE_PODCAST_RESOURCE_ID') || DEFAULT_RESOURCE_ID,
    appKey: readEnv('VOLCENGINE_PODCAST_APP_KEY') || DEFAULT_APP_KEY,
    speakers,
    format: readEnv('VOLCENGINE_PODCAST_FORMAT') || 'mp3',
    sampleRate: Number(readEnv('VOLCENGINE_PODCAST_SAMPLE_RATE') || 24000),
    speechRate: Number(readEnv('VOLCENGINE_PODCAST_SPEECH_RATE') || 0),
    timeoutMs: Number(readEnv('VOLCENGINE_PODCAST_TIMEOUT_MS') || 180_000),
    returnAudioUrl: readEnv('VOLCENGINE_PODCAST_RETURN_AUDIO_URL') !== 'false',
  };
}

export function isVolcenginePodcastConfigured(): boolean {
  const config = resolveVolcenginePodcastConfig();
  return Boolean(config.endpoint && config.appId && config.accessKey && config.resourceId && config.appKey);
}

export function redactVolcenginePodcastSecret(text: string): string {
  let safeText = text;
  for (const secret of [
    readEnv('VOLCENGINE_PODCAST_ACCESS_KEY', 'ARK_AGENTPLAN_API_KEY'),
    readEnv('VOLCENGINE_PODCAST_APP_KEY'),
  ]) {
    if (secret) safeText = safeText.split(secret).join('[REDACTED]');
  }
  return safeText.replace(/(X-Api-Access-Key["':=\s]+)[^"',\s}]+/gi, '$1[REDACTED]');
}

function uint32(value: number): Uint8Array {
  const buffer = new ArrayBuffer(4);
  new DataView(buffer).setUint32(0, value, false);
  return new Uint8Array(buffer);
}

function int32(value: number): Uint8Array {
  const buffer = new ArrayBuffer(4);
  new DataView(buffer).setInt32(0, value, false);
  return new Uint8Array(buffer);
}

function concatBytes(parts: Uint8Array[]): Uint8Array {
  const totalLength = parts.reduce((sum, part) => sum + part.length, 0);
  const output = new Uint8Array(totalLength);
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.length;
  }
  return output;
}

function shouldWriteSessionId(event?: VolcenginePodcastEvent): boolean {
  return event !== undefined
    && event !== VolcenginePodcastEvent.StartConnection
    && event !== VolcenginePodcastEvent.FinishConnection
    && event !== VolcenginePodcastEvent.ConnectionStarted
    && event !== VolcenginePodcastEvent.ConnectionFailed
    && event !== VolcenginePodcastEvent.ConnectionFinished;
}

export function encodeVolcenginePodcastMessage(message: VolcenginePodcastMessage): Uint8Array {
  const header = new Uint8Array(4);
  header[0] = (1 << 4) | 1;
  header[1] = (message.type << 4) | message.flag;
  header[2] = (SerializationBits.JSON << 4) | 0;
  header[3] = 0;

  const parts: Uint8Array[] = [header];
  if (message.flag === VolcenginePodcastMsgTypeFlagBits.WithEvent && message.event !== undefined) {
    parts.push(int32(message.event));
    if (shouldWriteSessionId(message.event)) {
      const sessionId = Buffer.from(message.sessionId || '', 'utf8');
      parts.push(uint32(sessionId.length), sessionId);
    }
    if (
      message.connectId !== undefined
      && (
        message.event === VolcenginePodcastEvent.ConnectionStarted
        || message.event === VolcenginePodcastEvent.ConnectionFailed
        || message.event === VolcenginePodcastEvent.ConnectionFinished
      )
    ) {
      const connectId = Buffer.from(message.connectId, 'utf8');
      parts.push(uint32(connectId.length), connectId);
    }
  }
  if (message.flag === VolcenginePodcastMsgTypeFlagBits.PositiveSeq || message.flag === VolcenginePodcastMsgTypeFlagBits.NegativeSeq) {
    parts.push(int32(message.sequence || 0));
  }
  if (message.type === VolcenginePodcastMsgType.Error) {
    parts.push(uint32(message.errorCode || 0));
  }
  parts.push(uint32(message.payload.length), message.payload);
  return concatBytes(parts);
}

export function decodeVolcenginePodcastMessage(data: Uint8Array): VolcenginePodcastMessage {
  if (data.length < 4) throw new Error(`VolcEngine Podcast frame too short: ${data.length}`);
  let offset = 0;
  const versionAndHeader = data[offset++];
  const typeAndFlag = data[offset++];
  offset++;
  offset++;
  offset = (versionAndHeader & 0b1111) * 4;

  const message: VolcenginePodcastMessage = {
    type: (typeAndFlag >> 4) as VolcenginePodcastMsgType,
    flag: (typeAndFlag & 0b1111) as VolcenginePodcastMsgTypeFlagBits,
    payload: new Uint8Array(0),
  };

  if (message.flag === VolcenginePodcastMsgTypeFlagBits.PositiveSeq || message.flag === VolcenginePodcastMsgTypeFlagBits.NegativeSeq) {
    if (offset + 4 > data.length) throw new Error('VolcEngine Podcast frame missing sequence');
    message.sequence = new DataView(data.buffer, data.byteOffset + offset, 4).getInt32(0, false);
    offset += 4;
  }

  if (message.type === VolcenginePodcastMsgType.Error) {
    if (offset + 4 > data.length) throw new Error('VolcEngine Podcast frame missing error code');
    message.errorCode = new DataView(data.buffer, data.byteOffset + offset, 4).getUint32(0, false);
    offset += 4;
  }

  if (message.flag === VolcenginePodcastMsgTypeFlagBits.WithEvent) {
    if (offset + 4 > data.length) throw new Error('VolcEngine Podcast frame missing event');
    message.event = new DataView(data.buffer, data.byteOffset + offset, 4).getInt32(0, false) as VolcenginePodcastEvent;
    offset += 4;
    if (shouldWriteSessionId(message.event)) {
      if (offset + 4 > data.length) throw new Error('VolcEngine Podcast frame missing session id length');
      const sessionIdLength = new DataView(data.buffer, data.byteOffset + offset, 4).getUint32(0, false);
      offset += 4;
      if (sessionIdLength > 0) {
        if (offset + sessionIdLength > data.length) throw new Error('VolcEngine Podcast frame has truncated session id');
        message.sessionId = Buffer.from(data.slice(offset, offset + sessionIdLength)).toString('utf8');
        offset += sessionIdLength;
      }
    }
    if (
      message.event === VolcenginePodcastEvent.ConnectionStarted
      || message.event === VolcenginePodcastEvent.ConnectionFailed
      || message.event === VolcenginePodcastEvent.ConnectionFinished
    ) {
      if (offset + 4 <= data.length) {
        const connectIdLength = new DataView(data.buffer, data.byteOffset + offset, 4).getUint32(0, false);
        if (offset + 4 + connectIdLength <= data.length) {
          offset += 4;
          if (connectIdLength > 0) {
            message.connectId = Buffer.from(data.slice(offset, offset + connectIdLength)).toString('utf8');
            offset += connectIdLength;
          }
        }
      }
    }
  }

  if (offset + 4 > data.length) throw new Error('VolcEngine Podcast frame missing payload length');
  const payloadLength = new DataView(data.buffer, data.byteOffset + offset, 4).getUint32(0, false);
  offset += 4;
  if (offset + payloadLength > data.length) throw new Error('VolcEngine Podcast frame has truncated payload');
  message.payload = data.slice(offset, offset + payloadLength);
  return message;
}

function jsonBytes(payload: unknown): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(payload));
}

function clientEvent(event: VolcenginePodcastEvent, payload: unknown, sessionId?: string): Uint8Array {
  return encodeVolcenginePodcastMessage({
    type: VolcenginePodcastMsgType.FullClientRequest,
    flag: VolcenginePodcastMsgTypeFlagBits.WithEvent,
    event,
    sessionId,
    payload: jsonBytes(payload),
  });
}

function sendFrame(ws: WebSocket, frame: Uint8Array): Promise<void> {
  return new Promise((resolve, reject) => {
    ws.send(frame, error => error ? reject(error) : resolve());
  });
}

function openSocket(config: VolcenginePodcastConfig): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finishReject = (error: Error) => {
      if (settled) return;
      settled = true;
      reject(error);
    };
    const ws = new WebSocket(config.endpoint, {
      headers: {
        'X-Api-App-Id': config.appId,
        'X-Api-App-Key': config.appKey,
        'X-Api-Access-Key': config.accessKey,
        'X-Api-Resource-Id': config.resourceId,
        'X-Api-Connect-Id': randomUUID(),
      },
      skipUTF8Validation: true,
    });
    ws.once('open', () => {
      settled = true;
      resolve(ws);
    });
    ws.once('unexpected-response', (_request, response) => {
      const chunks: Buffer[] = [];
      response.on('data', chunk => chunks.push(Buffer.from(chunk)));
      response.on('end', () => {
        const body = redactVolcenginePodcastSecret(Buffer.concat(chunks).toString('utf8').slice(0, 800));
        const logId = response.headers['x-tt-logid'] || response.headers['x-tt-trace-host'];
        finishReject(new Error([
          `VolcEngine Podcast WebSocket auth failed with HTTP ${response.statusCode}`,
          logId ? `logid=${Array.isArray(logId) ? logId.join(',') : logId}` : '',
          body ? `body=${body}` : '',
        ].filter(Boolean).join(' - ')));
      });
    });
    ws.once('error', finishReject);
  });
}

const messageQueues = new WeakMap<WebSocket, VolcenginePodcastMessage[]>();
const messageWaiters = new WeakMap<WebSocket, Array<{
  resolve: (message: VolcenginePodcastMessage) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}>>();

function setupMessageQueue(ws: WebSocket) {
  if (messageQueues.has(ws)) return;
  messageQueues.set(ws, []);
  messageWaiters.set(ws, []);
  ws.on('message', data => {
    try {
      const buffer = Buffer.isBuffer(data)
        ? data
        : data instanceof ArrayBuffer
          ? Buffer.from(data)
          : Array.isArray(data)
            ? Buffer.concat(data)
            : Buffer.from(data);
      const message = decodeVolcenginePodcastMessage(new Uint8Array(buffer));
      const waiters = messageWaiters.get(ws) || [];
      const waiter = waiters.shift();
      if (waiter) {
        clearTimeout(waiter.timer);
        waiter.resolve(message);
        return;
      }
      messageQueues.get(ws)?.push(message);
    } catch (error) {
      const waiters = messageWaiters.get(ws) || [];
      while (waiters.length > 0) {
        const waiter = waiters.shift();
        if (!waiter) continue;
        clearTimeout(waiter.timer);
        waiter.reject(error instanceof Error ? error : new Error(String(error)));
      }
    }
  });
  const rejectPending = (error: Error) => {
    const waiters = messageWaiters.get(ws) || [];
    while (waiters.length > 0) {
      const waiter = waiters.shift();
      if (!waiter) continue;
      clearTimeout(waiter.timer);
      waiter.reject(error);
    }
  };
  ws.on('error', error => rejectPending(error));
  ws.on('close', (code, reason) => {
    rejectPending(new Error(`VolcEngine Podcast WebSocket closed before response: ${code} ${reason.toString('utf8')}`.trim()));
  });
}

function receiveMessage(ws: WebSocket, timeoutMs: number): Promise<VolcenginePodcastMessage> {
  setupMessageQueue(ws);
  const queue = messageQueues.get(ws) || [];
  const queued = queue.shift();
  if (queued) return Promise.resolve(queued);

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      const waiters = messageWaiters.get(ws) || [];
      const index = waiters.findIndex(waiter => waiter.resolve === resolve);
      if (index !== -1) waiters.splice(index, 1);
      reject(new Error(`VolcEngine Podcast WebSocket receive timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    messageWaiters.get(ws)?.push({ resolve, reject, timer });
  });
}

async function waitForEvent(
  ws: WebSocket,
  type: VolcenginePodcastMsgType,
  event: VolcenginePodcastEvent,
  timeoutMs: number,
): Promise<VolcenginePodcastMessage> {
  const message = await receiveMessage(ws, timeoutMs);
  if (message.type !== type || message.event !== event) {
    throw new Error(`Unexpected VolcEngine Podcast event: type=${message.type}, event=${message.event}, payload=${payloadPreview(message.payload)}`);
  }
  return message;
}

function payloadPreview(payload: Uint8Array): string {
  const text = Buffer.from(payload).toString('utf8');
  return redactVolcenginePodcastSecret(text.slice(0, 600));
}

function parseJsonPayload(payload: Uint8Array): Record<string, unknown> {
  const text = Buffer.from(payload).toString('utf8').trim();
  if (!text) return {};
  return JSON.parse(text) as Record<string, unknown>;
}

function buildRequestPayload(text: string, config: VolcenginePodcastConfig) {
  return {
    input_id: `lingbi-podcast-${Date.now()}`,
    input_text: text,
    action: 0,
    use_head_music: false,
    use_tail_music: false,
    input_info: {
      input_url: '',
      return_audio_url: config.returnAudioUrl,
      only_nlp_text: false,
      input_text_max_length: Number(process.env.VOLCENGINE_PODCAST_INPUT_TEXT_MAX_LENGTH || 12000),
    },
    audio_config: {
      format: config.format,
      sample_rate: config.sampleRate,
      speech_rate: config.speechRate,
    },
    speaker_info: {
      random_order: false,
      speakers: config.speakers,
    },
    aigc_watermark: false,
  };
}

export async function generateVolcenginePodcast(text: string): Promise<VolcenginePodcastResult> {
  const config = resolveVolcenginePodcastConfig();
  const missing = [
    config.appId ? '' : 'VOLCENGINE_PODCAST_APP_ID',
    config.accessKey ? '' : 'VOLCENGINE_PODCAST_ACCESS_KEY',
    config.resourceId ? '' : 'VOLCENGINE_PODCAST_RESOURCE_ID',
  ].filter(Boolean);
  if (missing.length > 0) {
    throw new Error(`VolcEngine Podcast is not configured: missing ${missing.join(', ')}`);
  }

  const timeoutMs = Math.max(10_000, config.timeoutMs);
  const sessionId = randomUUID();
  const taskId = sessionId;
  const audioChunks: Buffer[] = [];
  const rounds: VolcenginePodcastResult['rounds'] = [];
  let audioUrl = '';
  let usage: unknown;
  let ws: WebSocket | undefined;

  const timeout = setTimeout(() => {
    ws?.terminate();
  }, timeoutMs + 5_000);

  try {
    ws = await openSocket(config);
    await sendFrame(ws, clientEvent(VolcenginePodcastEvent.StartConnection, {}));
    await waitForEvent(ws, VolcenginePodcastMsgType.FullServerResponse, VolcenginePodcastEvent.ConnectionStarted, timeoutMs);

    await sendFrame(ws, clientEvent(VolcenginePodcastEvent.StartSession, buildRequestPayload(text, config), sessionId));
    await waitForEvent(ws, VolcenginePodcastMsgType.FullServerResponse, VolcenginePodcastEvent.SessionStarted, timeoutMs);
    await sendFrame(ws, clientEvent(VolcenginePodcastEvent.FinishSession, {}, sessionId));

    while (true) {
      const message = await receiveMessage(ws, timeoutMs);
      if (message.type === VolcenginePodcastMsgType.Error) {
        throw new Error(`VolcEngine Podcast server error code=${message.errorCode || 'unknown'} payload=${payloadPreview(message.payload)}`);
      }
      if (message.type === VolcenginePodcastMsgType.AudioOnlyServer && message.event === VolcenginePodcastEvent.PodcastRoundResponse) {
        if (message.payload.length > 0) audioChunks.push(Buffer.from(message.payload));
      }
      if (message.type === VolcenginePodcastMsgType.FullServerResponse) {
        if (message.event === VolcenginePodcastEvent.PodcastRoundStart) {
          const data = parseJsonPayload(message.payload);
          rounds.push({
            roundId: typeof data.round_id === 'number' ? data.round_id : undefined,
            speaker: typeof data.speaker === 'string' ? data.speaker : undefined,
            text: typeof data.text === 'string' ? data.text : undefined,
          });
        }
        if (message.event === VolcenginePodcastEvent.PodcastRoundEnd) {
          const data = parseJsonPayload(message.payload);
          if (data.is_error) throw new Error(`VolcEngine Podcast round failed: ${payloadPreview(message.payload)}`);
        }
        if (message.event === VolcenginePodcastEvent.PodcastEnd) {
          const data = parseJsonPayload(message.payload);
          const metaInfo = data.meta_info && typeof data.meta_info === 'object'
            ? data.meta_info as Record<string, unknown>
            : undefined;
          if (typeof metaInfo?.audio_url === 'string' && metaInfo.audio_url.trim()) {
            audioUrl = metaInfo.audio_url.trim();
          }
        }
        if (message.event === VolcenginePodcastEvent.UsageResponse) {
          usage = parseJsonPayload(message.payload);
        }
        if (message.event === VolcenginePodcastEvent.SessionFailed) {
          throw new Error(`VolcEngine Podcast session failed: ${payloadPreview(message.payload)}`);
        }
        if (message.event === VolcenginePodcastEvent.SessionFinished) break;
      }
    }

    await sendFrame(ws, clientEvent(VolcenginePodcastEvent.FinishConnection, {}));
    await waitForEvent(ws, VolcenginePodcastMsgType.FullServerResponse, VolcenginePodcastEvent.ConnectionFinished, timeoutMs);

    const audioBuffer = audioChunks.length > 0 ? Buffer.concat(audioChunks) : undefined;
    if (!audioUrl && !audioBuffer) {
      throw new Error('VolcEngine Podcast returned no audio_url and no audio chunks.');
    }

    return {
      audioUrl: audioUrl || undefined,
      audioBuffer,
      format: config.format,
      sessionId,
      taskId,
      rounds,
      usage,
    };
  } finally {
    clearTimeout(timeout);
    if (ws && ws.readyState === WebSocket.OPEN) ws.close();
  }
}
