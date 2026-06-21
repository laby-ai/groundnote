'use client';

import { useState, useCallback } from 'react';
import {
  Image as ImageIcon, Download, Sparkles, Loader2,
  Maximize2,
} from 'lucide-react';
import { useApp } from '@/contexts/AppContext';

type ImageType = 'framework' | 'flowchart' | 'comparison' | 'mechanism' | 'result';

interface GeneratedImage {
  id: string;
  type: ImageType;
  prompt: string;
  url: string;
  citation: string;
  timestamp: string;
}

const IMAGE_TYPES: { key: ImageType; label: string; desc: string }[] = [
  { key: 'framework', label: '框架图', desc: '研究框架与理论模型' },
  { key: 'flowchart', label: '流程图', desc: '实验流程与方法路径' },
  { key: 'comparison', label: '数据对比', desc: '多文献数据对比图表' },
  { key: 'mechanism', label: '机制原理', desc: '作用机制与原理示意' },
  { key: 'result', label: '结果可视化', desc: '实验结果与数据展示' },
];

const FALLBACK_GRADIENTS: Record<ImageType, { gradient: string; symbol: string }> = {
  framework: { gradient: 'from-blue-900/30 via-zinc-900 to-zinc-950', symbol: '🏗' },
  flowchart: { gradient: 'from-purple-900/30 via-zinc-900 to-zinc-950', symbol: '🔀' },
  comparison: { gradient: 'from-emerald-900/30 via-zinc-900 to-zinc-950', symbol: '📊' },
  mechanism: { gradient: 'from-amber-900/30 via-zinc-900 to-zinc-950', symbol: '⚙' },
  result: { gradient: 'from-rose-900/30 via-zinc-900 to-zinc-950', symbol: '📈' },
};

export function ImageGenerator() {
  const { getSelectedPapers } = useApp();
  const [selectedType, setSelectedType] = useState<ImageType>('framework');
  const [prompt, setPrompt] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatedImages, setGeneratedImages] = useState<GeneratedImage[]>([]);
  const [selectedImage, setSelectedImage] = useState<GeneratedImage | null>(null);
  const [citationPosition, setCitationPosition] = useState<'inline' | 'corner'>('inline');
  const [error, setError] = useState<string | null>(null);

  const handleGenerate = useCallback(async () => {
    const selectedPapers = getSelectedPapers();
    if (selectedPapers.length === 0) {
      setError('请先在左侧文献库中选择论文');
      return;
    }

    setIsGenerating(true);
    setError(null);

    const content = selectedPapers.map((p, i) =>
      `[文献${i + 1}] ${p.shortName}: ${p.title}\n${p.abstract || ''}\n${(p.content || '').substring(0, 1000)}`
    ).join('\n\n');

    const imagePrompt = prompt || `生成${IMAGE_TYPES.find(t => t.key === selectedType)?.label}，展示文献中的核心研究内容`;

    try {
      const response = await fetch('/api/ai/image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: imagePrompt,
          type: selectedType,
          content,
          citations: selectedPapers.map(p => p.shortName),
        }),
      });

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData.error || '图片生成失败');
      }

      const data = await response.json();
      const img: GeneratedImage = {
        id: `img-${Date.now()}`,
        type: selectedType,
        prompt: imagePrompt,
        url: data.imageUrl || data.url || '',
        citation: selectedPapers.map(p => `[${p.shortName}]`).join(', '),
        timestamp: new Date().toISOString(),
      };
      setGeneratedImages(prev => [img, ...prev]);
      setPrompt('');
    } catch (err) {
      const message = err instanceof Error ? err.message : '图片生成失败';
      setError(message);
    } finally {
      setIsGenerating(false);
    }
  }, [selectedType, prompt, getSelectedPapers]);

  const handleInsertToReport = useCallback((_image: GeneratedImage) => {
    // TODO: implement insert to report via context
  }, []);

  return (
    <div className="h-full flex flex-col bg-[var(--bg-primary)]">
      {/* Header */}
      <div className="px-5 pt-5 pb-4 border-b border-[var(--border-subtle)]">
        <div className="flex items-center gap-3 mb-3">
          <div className="w-8 h-8 rounded-xl bg-emerald-500/10 flex items-center justify-center">
            <ImageIcon className="h-4 w-4 text-emerald-400" />
          </div>
          <div>
            <h2 className="text-base font-semibold tracking-tight text-[var(--text-primary)]">学术图片生成</h2>
            <p className="text-[11px] text-[var(--text-muted)]">基于文献内容生成可视化图片</p>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
        {/* Type selection */}
        <div className="space-y-2">
          <p className="section-label">图片类型</p>
          <div className="grid grid-cols-2 gap-2">
            {IMAGE_TYPES.map(({ key, label, desc }) => (
              <button
                key={key}
                onClick={() => setSelectedType(key)}
                className={`text-left p-3 rounded-xl transition-all duration-300 ${
                  selectedType === key
                    ? 'bg-emerald-500/[0.08] border border-emerald-500/20'
                    : 'liquid-glass-card'
                }`}
              >
                <p className={`text-xs font-medium ${selectedType === key ? 'text-[var(--accent-emerald)]' : 'text-[var(--text-tertiary)]'}`}>{label}</p>
                <p className="text-[10px] text-[var(--text-muted)] mt-0.5">{desc}</p>
              </button>
            ))}
          </div>
        </div>

        {/* Prompt */}
        <div className="space-y-2">
          <p className="section-label">生成描述</p>
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="描述你想要生成的图片内容，所有结论将标注文献来源..."
            className="apple-textarea"
            rows={3}
          />
        </div>

        {/* Citation position */}
        <div className="space-y-2">
          <p className="section-label">标注位置</p>
          <div className="flex gap-2">
            {([
              { key: 'inline' as const, label: '数据旁' },
              { key: 'corner' as const, label: '右下角' },
            ]).map(({ key, label }) => (
              <button
                key={key}
                onClick={() => setCitationPosition(key)}
                className={`flex-1 py-2 rounded-xl text-[11px] font-medium transition-all ${
                  citationPosition === key
                    ? 'bg-[var(--glass-active)] text-[var(--text-primary)] border border-[var(--border-subtle)]'
                    : 'text-[var(--text-tertiary)] hover:bg-[var(--glass-hover)] border border-transparent'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* Error display */}
        {error && (
          <div className="p-3 rounded-xl bg-red-500/[0.08] border border-red-500/20 text-xs text-red-400">
            {error}
          </div>
        )}

        {/* Generate button */}
        <button onClick={handleGenerate} disabled={isGenerating} className="btn-primary w-full py-3 text-xs">
          {isGenerating ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> AI 生成中...</> : <><Sparkles className="h-3.5 w-3.5" /> 生成图片</>}
        </button>

        {/* Generated images */}
        {generatedImages.length > 0 && (
          <div className="space-y-3">
            <p className="section-label">已生成图片</p>
            {generatedImages.map(img => {
              const fallback = FALLBACK_GRADIENTS[img.type];
              const hasRealImage = img.url && !img.url.startsWith('data:');
              return (
                <div
                  key={img.id}
                  className="liquid-glass-card overflow-hidden group cursor-pointer"
                  onClick={() => setSelectedImage(img)}
                >
                  <div className={`aspect-[16/10] ${hasRealImage ? '' : `bg-gradient-to-br ${fallback.gradient}`} flex items-center justify-center relative overflow-hidden`}>
                    {hasRealImage ? (
                      <img src={img.url} alt={img.prompt} className="w-full h-full object-cover" />
                    ) : (
                      <span className="text-4xl">{fallback.symbol}</span>
                    )}
                    <p className="absolute bottom-2 right-3 text-[10px] text-[var(--text-muted)] font-mono">{img.citation}</p>
                    <div className="absolute inset-0 bg-[var(--bg-base)]/50 opacity-0 group-hover:opacity-100 transition-all duration-500 flex items-center justify-center backdrop-blur-sm">
                      <Maximize2 className="h-6 w-6 text-[var(--text-primary)]" />
                    </div>
                  </div>
                  <div className="p-3">
                    <p className="text-xs text-zinc-300 truncate">{img.prompt}</p>
                    <div className="flex items-center justify-between mt-2">
                      <span className="text-[10px] text-[var(--text-muted)]">{IMAGE_TYPES.find(t => t.key === img.type)?.label}</span>
                      <div className="flex gap-1.5">
                        <button onClick={(e) => { e.stopPropagation(); handleInsertToReport(img); }} className="btn-ghost text-[10px] text-[var(--text-muted)] hover:text-emerald-400 px-2 py-1">
                          插入报告
                        </button>
                        <button className="btn-ghost text-[10px] text-[var(--text-muted)] hover:text-[var(--text-primary)] px-2 py-1">
                          <Download className="h-3 w-3" />
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Image preview modal */}
      {selectedImage && (
        <div className="fixed inset-0 z-[100] bg-[var(--bg-base)]/90 backdrop-blur-xl flex items-center justify-center animate-fade-in" onClick={() => setSelectedImage(null)}>
          <div className="w-[80vw] max-w-3xl liquid-glass-card overflow-hidden animate-scale-in" onClick={e => e.stopPropagation()}>
            <div className={`aspect-[16/10] ${selectedImage.url ? '' : `bg-gradient-to-br ${FALLBACK_GRADIENTS[selectedImage.type].gradient}`} flex items-center justify-center relative overflow-hidden`}>
              {selectedImage.url ? (
                <img src={selectedImage.url} alt={selectedImage.prompt} className="w-full h-full object-contain" />
              ) : (
                <span className="text-6xl">{FALLBACK_GRADIENTS[selectedImage.type].symbol}</span>
              )}
              <p className="absolute bottom-4 right-6 text-sm text-[var(--text-muted)] font-mono">{selectedImage.citation}</p>
            </div>
            <div className="p-6 flex items-center justify-between">
              <div>
                <p className="text-sm text-[var(--text-primary)] font-medium">{selectedImage.prompt}</p>
                <p className="text-xs text-[var(--text-muted)] mt-1">类型: {IMAGE_TYPES.find(t => t.key === selectedImage.type)?.label}</p>
              </div>
              <div className="flex gap-2">
                <button className="btn-primary py-2 px-4 text-xs" onClick={() => { handleInsertToReport(selectedImage); setSelectedImage(null); }}>插入报告</button>
                <button className="btn-secondary py-2 px-4 text-xs" onClick={() => setSelectedImage(null)}>关闭</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
