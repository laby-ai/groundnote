import type { RuntimeAIConfig } from '@/types';

export type ModelCheckStatus = 'pending' | 'success' | 'error' | 'skipped';

export type ModelCheck = {
  id: 'text' | 'vision' | 'embedding' | 'tts';
  label: string;
  status: ModelCheckStatus;
  detail: string;
};

export function buildPendingModelChecks(config: RuntimeAIConfig): ModelCheck[] {
  return [
    {
      id: 'text',
      label: '文本问答',
      status: 'pending',
      detail: `将验证 ${config.model.trim() || '默认文本模型'} 的 chat completions。`,
    },
    {
      id: 'vision',
      label: '视觉理解',
      status: config.visionModel.trim() ? 'pending' : 'skipped',
      detail: config.visionModel.trim()
        ? `将用 16x16 测试图片验证 ${config.visionModel.trim()} 的 image_url 多模态能力。`
        : '未填写视觉模型，图片/PDF OCR 会跟随文本模型或部署默认配置。',
    },
    {
      id: 'embedding',
      label: '向量检索',
      status: config.embeddingModel.trim() ? 'pending' : 'skipped',
      detail: config.embeddingModel.trim()
        ? `将验证 ${config.embeddingModel.trim()} 的 /embeddings 返回向量维度。`
        : '未填写向量模型，资料索引会降级到关键词检索或部署默认配置。',
    },
    {
      id: 'tts',
      label: '播客音频',
      status: config.ttsSpeaker.trim() ? 'pending' : 'skipped',
      detail: config.ttsSpeaker.trim()
        ? `将把 ${config.ttsSpeaker.trim()} 作为豆包语音合成音色随 Studio 请求发送。`
        : '未填写播客音色，真实豆包语音合成会要求部署环境提供 AGENTPLAN_TTS_SPEAKER。',
    },
  ];
}
