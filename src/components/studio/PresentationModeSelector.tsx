'use client';

import { Check, FileText, ImageIcon, Presentation } from 'lucide-react';
import type { ElementType } from 'react';

export type PresentationMode = 'image' | 'structured';

type PresentationModeOption = {
  id: PresentationMode;
  label: string;
  badge: string;
  desc: string;
  icon: ElementType;
};

const MODE_OPTIONS: PresentationModeOption[] = [
  {
    id: 'image',
    label: '图片页简报',
    badge: '视觉版',
    desc: '先生成整页图片，再打包 PPTX。适合封面、营销、风格化展示，画面更强但文字编辑性弱。',
    icon: ImageIcon,
  },
  {
    id: 'structured',
    label: '结构化 PPT',
    badge: '可编辑',
    desc: '生成可编辑文本、页标题和版式结构。适合汇报、研究和复用修改，视觉冲击弱于图片版。',
    icon: FileText,
  },
];

export function PresentationModeSelector({
  mode,
  onModeChange,
}: {
  mode: PresentationMode;
  onModeChange: (mode: PresentationMode) => void;
}) {
  return (
    <section className="liquid-glass-card p-4 space-y-3" data-testid="presentation-mode-selector">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-sm font-semibold text-[var(--text-primary)]">
            <Presentation className="h-4 w-4 text-[var(--text-secondary)]" />
            <span>演示文稿生成</span>
          </div>
          <p className="mt-1 text-[11px] leading-relaxed text-[var(--text-tertiary)]">
            同一个 PPT 入口，先选择生成方式；真正生成仍在下方明确按钮触发。
          </p>
        </div>
        <span className="shrink-0 rounded-full border border-[var(--border-subtle)] bg-[var(--glass-subtle)] px-2 py-1 text-[10px] font-medium text-[var(--text-tertiary)]">
          两种产物
        </span>
      </div>

      <div className="grid grid-cols-1 gap-2">
        {MODE_OPTIONS.map(option => {
          const Icon = option.icon;
          const selected = mode === option.id;
          return (
            <button
              key={option.id}
              data-testid={`presentation-mode-${option.id}`}
              aria-pressed={selected}
              onClick={() => onModeChange(option.id)}
              className={`spotlight-glass-card rounded-2xl border px-3.5 py-3 text-left transition-all ${
                selected
                  ? 'border-blue-400/55 bg-blue-500/10 shadow-[0_12px_28px_rgba(37,99,235,0.12)]'
                  : 'border-[var(--glass-border)] bg-[var(--glass-subtle)] hover:border-[var(--border-hover)]'
              }`}
            >
              <span className="flex items-start gap-3">
                <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border ${
                  selected
                    ? 'border-blue-400/40 bg-blue-500/15 text-blue-500 dark:text-blue-300'
                    : 'border-[var(--border-subtle)] bg-[var(--bg-card)] text-[var(--text-secondary)]'
                }`}>
                  <Icon className="h-4 w-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2 text-[13px] font-semibold leading-tight text-[var(--text-primary)]">
                    {option.label}
                    <span className="rounded-full bg-[var(--glass-hover)] px-1.5 py-0.5 text-[9px] font-medium text-[var(--text-tertiary)]">
                      {option.badge}
                    </span>
                    {selected && <Check className="h-3.5 w-3.5 text-blue-500" />}
                  </span>
                  <span className="mt-1 block text-[11px] leading-relaxed text-[var(--text-secondary)]">
                    {option.desc}
                  </span>
                </span>
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
