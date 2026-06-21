'use client';

import { useCallback, useState } from 'react';
import {
  AlertTriangle,
  Check,
  ChevronDown,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  Server,
} from 'lucide-react';
import type { RuntimeAIConfig } from '@/types';
import { buildPendingModelChecks, type ModelCheck } from './modelChecks';

export function AISettingsDialog({
  value,
  onChange,
  onClose,
}: {
  value: RuntimeAIConfig;
  onChange: (config: Partial<RuntimeAIConfig>) => void;
  onClose: () => void;
}) {
  const [showKey, setShowKey] = useState(false);
  const [testState, setTestState] = useState<'idle' | 'testing' | 'success' | 'error'>('idle');
  const [testMessage, setTestMessage] = useState('');
  const [modelChecks, setModelChecks] = useState<ModelCheck[]>([]);
  const configured = Boolean(value.apiBase.trim() && value.apiKey.trim());

  const handleConfigChange = useCallback((config: Partial<RuntimeAIConfig>) => {
    setTestState('idle');
    setTestMessage('');
    setModelChecks([]);
    onChange(config);
  }, [onChange]);

  const handleTestConfig = useCallback(async () => {
    setTestState('testing');
    setTestMessage('正在测试文本、视觉与向量模型，请保持窗口打开。');
    setModelChecks(buildPendingModelChecks(value));
    try {
      const response = await fetch('/api/ai/test-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ aiConfig: value }),
      });
      const data = await response.json() as {
        ok?: boolean;
        error?: string;
        sample?: string;
        model?: string;
        visionModel?: string;
        visionSample?: string;
        embeddingModel?: string;
        embeddingDimension?: number;
        ttsSpeaker?: string;
      };
      if (!response.ok || !data.ok) {
        throw new Error(data.error || '连接测试失败');
      }
      setTestState('success');
      const parts = [`文本模型 ${data.model || value.model || 'default'}`];
      if (data.visionModel) parts.push(`视觉理解模型 ${data.visionModel}`);
      if (data.embeddingModel) parts.push(`向量模型 ${data.embeddingModel}${data.embeddingDimension ? ` (${data.embeddingDimension} 维)` : ''}`);
      setTestMessage(`连接成功，${parts.join('、')} 已响应。`);
      setModelChecks([
        {
          id: 'text',
          label: '文本问答',
          status: 'success',
          detail: `${data.model || value.model || 'default'} 已返回 ${data.sample || 'OK'}。`,
        },
        {
          id: 'vision',
          label: '视觉理解',
          status: data.visionModel ? 'success' : 'skipped',
          detail: data.visionModel
            ? `${data.visionModel} 已通过 image_url 测试。`
            : '未填写视觉模型，本次未单独测试多模态链路。',
        },
        {
          id: 'embedding',
          label: '向量检索',
          status: data.embeddingModel ? 'success' : 'skipped',
          detail: data.embeddingModel
            ? `${data.embeddingModel} 已返回 ${data.embeddingDimension || '未知'} 维向量。`
            : '未填写向量模型，本次未单独测试 embedding 链路。',
        },
        {
          id: 'tts',
          label: '播客音频',
          status: data.ttsSpeaker ? 'success' : 'skipped',
          detail: data.ttsSpeaker
            ? `${data.ttsSpeaker} 将用于豆包语音合成请求。`
            : '未填写播客音色，本次未验证真实 TTS 音频。',
        },
      ]);
    } catch (error: unknown) {
      setTestState('error');
      const message = error instanceof Error ? error.message : '连接测试失败';
      setTestMessage(message);
      setModelChecks((current) => {
        const pending = current.length > 0 ? current : buildPendingModelChecks(value);
        return pending.map((check) => check.status === 'skipped'
          ? check
          : { ...check, status: 'error', detail: `连接失败：${message}` });
      });
    }
  }, [value]);

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/45 backdrop-blur-md px-4 animate-fade-in" onClick={onClose}>
      <div className="liquid-glass-card w-full max-w-[520px] p-6" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-4 mb-5">
          <div>
            <div className="flex items-center gap-2 text-[var(--text-primary)]">
              <KeyRound className="h-4 w-4 text-emerald-400" />
              <h3 className="text-lg font-semibold">模型设置</h3>
            </div>
            <p className="text-xs text-[var(--text-tertiary)] mt-1 leading-relaxed">
              填入兼容 OpenAI 的 API Base 和 API Key。配置保存在本机浏览器，仅随本次请求发送。文本、视觉、向量和播客音色分别用于问答、OCR、资料检索索引与豆包语音合成。
            </p>
          </div>
          <button className="liquid-glass-btn !p-2" onClick={onClose} title="关闭" aria-label="关闭模型设置">
            <ChevronDown className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-4">
          <label className="block">
            <span className="flex items-center gap-2 text-xs font-medium text-[var(--text-secondary)] mb-2">
              <Server className="h-3.5 w-3.5" />
              API Base
            </span>
            <input
              value={value.apiBase}
              onChange={(e) => handleConfigChange({ apiBase: e.target.value })}
              placeholder="https://api.openai.com/v1 或兼容服务地址"
              aria-label="API Base"
              className="liquid-glass-input"
            />
          </label>

          <label className="block">
            <span className="flex items-center gap-2 text-xs font-medium text-[var(--text-secondary)] mb-2">
              <KeyRound className="h-3.5 w-3.5" />
              API Key
            </span>
            <div className="flex gap-2">
              <input
                type={showKey ? 'text' : 'password'}
                value={value.apiKey}
                onChange={(e) => handleConfigChange({ apiKey: e.target.value })}
                placeholder="sk-..."
                aria-label="API Key"
                className="liquid-glass-input flex-1"
                autoComplete="off"
              />
              <button className="liquid-glass-btn !px-3" onClick={() => setShowKey(v => !v)} title={showKey ? '隐藏密钥' : '显示密钥'} aria-label={showKey ? '隐藏 API Key' : '显示 API Key'}>
                {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </label>

          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="text-xs font-medium text-[var(--text-secondary)] mb-2 block">文本模型</span>
              <input
                value={value.model}
                onChange={(e) => handleConfigChange({ model: e.target.value })}
                placeholder="例如 gpt-4o-mini / deepseek-chat"
                aria-label="文本模型"
                className="liquid-glass-input"
              />
            </label>
            <label className="block">
              <span className="text-xs font-medium text-[var(--text-secondary)] mb-2 block">视觉理解模型</span>
              <input
                value={value.visionModel}
                onChange={(e) => handleConfigChange({ visionModel: e.target.value })}
                placeholder="例如 ark-code-latest / auto；可留空跟随文本模型"
                aria-label="视觉理解模型"
                className="liquid-glass-input"
              />
            </label>
            <label className="block">
              <span className="text-xs font-medium text-[var(--text-secondary)] mb-2 block">向量模型</span>
              <input
                value={value.embeddingModel}
                onChange={(e) => handleConfigChange({ embeddingModel: e.target.value })}
                placeholder="例如 doubao-embedding-vision"
                aria-label="向量模型"
                className="liquid-glass-input"
              />
            </label>
            <label className="block">
              <span className="text-xs font-medium text-[var(--text-secondary)] mb-2 block">播客音色</span>
              <input
                value={value.ttsSpeaker}
                onChange={(e) => handleConfigChange({ ttsSpeaker: e.target.value })}
                placeholder="例如豆包语音 speaker id；可留空使用部署默认"
                aria-label="播客音色"
                className="liquid-glass-input"
              />
            </label>
          </div>

          <div className={`rounded-2xl border px-4 py-3 text-xs leading-relaxed ${
            testState === 'success'
              ? 'border-emerald-500/25 bg-emerald-500/10 text-emerald-200'
              : testState === 'error'
                ? 'border-red-500/25 bg-red-500/10 text-red-200'
                : configured
              ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-200'
              : 'border-amber-500/20 bg-amber-500/10 text-amber-200'
          }`}>
            {testMessage || (configured
              ? '已启用自带模型配置。聊天、综述、上传分析和后续向量检索会使用该配置。'
              : '未填写完整配置时，仅可使用部署环境配置的默认模型服务；若部署环境没有默认模型，请先填写 API Base 和 API Key。')}
          </div>

          {modelChecks.length > 0 && (
            <div
              className="rounded-2xl border border-[var(--border-subtle)] bg-black/10 p-3 space-y-2"
              data-testid="model-connection-checklist"
            >
              {modelChecks.map((check) => {
                const tone = check.status === 'success'
                  ? 'text-emerald-200'
                  : check.status === 'error'
                    ? 'text-red-200'
                    : check.status === 'pending'
                      ? 'text-cyan-200'
                      : 'text-[var(--text-tertiary)]';
                const Icon = check.status === 'success'
                  ? Check
                  : check.status === 'error'
                    ? AlertTriangle
                    : check.status === 'pending'
                      ? Loader2
                      : Server;
                return (
                  <div
                    key={check.id}
                    data-testid={`model-check-${check.id}`}
                    className="flex items-start gap-2 rounded-xl border border-white/5 bg-white/[0.03] px-3 py-2"
                  >
                    <Icon className={`mt-0.5 h-3.5 w-3.5 ${tone} ${check.status === 'pending' ? 'animate-spin' : ''}`} />
                    <div className="min-w-0">
                      <div className={`text-xs font-medium ${tone}`}>
                        {check.label}
                        <span className="ml-2 font-normal opacity-75">
                          {check.status === 'success' ? '已通过' : check.status === 'error' ? '失败' : check.status === 'pending' ? '测试中' : '未单独测试'}
                        </span>
                      </div>
                      <div className="mt-1 text-[11px] leading-relaxed text-[var(--text-tertiary)]">
                        {check.detail}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="flex items-center justify-between gap-3 mt-6">
          <button
            className="liquid-glass-btn text-xs"
            onClick={() => handleConfigChange({ apiBase: '', apiKey: '', model: '', visionModel: '', embeddingModel: '', ttsSpeaker: '' })}
            aria-label="清空模型配置"
          >
            清空配置
          </button>
          <div className="flex items-center gap-2">
            <button
              className="liquid-glass-btn text-xs"
              onClick={handleTestConfig}
              disabled={!configured || testState === 'testing'}
              aria-label="测试模型连接"
            >
              {testState === 'testing' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Server className="h-3.5 w-3.5" />}
              测试连接
            </button>
            <button
              className="liquid-glass-btn !bg-gradient-to-r !from-emerald-500 !to-cyan-500 !text-white !border-0 text-xs"
              onClick={onClose}
              aria-label="保存模型配置并返回"
            >
              保存并返回
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
