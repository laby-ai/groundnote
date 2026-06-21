'use client';

import { Check, FileText, GripVertical, RotateCcw } from 'lucide-react';
import type { Paper } from '@/types';
import {
  buildPptOutlineDraft,
  type PptOutlineDraftItem,
} from '@/lib/ppt/outline-draft';

export type StructuredPresentationOutlineItem = PptOutlineDraftItem;

export function buildStructuredPresentationOutlineDraft(
  papers: Paper[],
  duration: number,
): StructuredPresentationOutlineItem[] {
  return buildPptOutlineDraft(papers, duration);
}

export function StructuredPresentationOutlineDraft({
  items,
  confirmed,
  onChange,
  onConfirmChange,
  onReset,
}: {
  items: StructuredPresentationOutlineItem[];
  confirmed: boolean;
  onChange: (items: StructuredPresentationOutlineItem[]) => void;
  onConfirmChange: (confirmed: boolean) => void;
  onReset: () => void;
}) {
  const updateItem = (index: number, updates: Partial<StructuredPresentationOutlineItem>) => {
    const next = [...items];
    next[index] = { ...next[index], ...updates };
    onChange(next);
    onConfirmChange(false);
  };

  const moveItem = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= items.length) return;
    const next = [...items];
    [next[index], next[target]] = [next[target], next[index]];
    onChange(next);
    onConfirmChange(false);
  };

  return (
    <section className="w-full max-w-[420px] rounded-2xl border border-[var(--glass-border)] bg-[var(--glass-subtle)] p-3.5 shadow-[0_16px_40px_rgba(15,23,42,0.08)]" data-testid="academic-ppt-outline-draft">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-sm font-semibold text-[var(--text-primary)]">
            <FileText className="h-4 w-4 text-[var(--accent-blue)]" />
            <span>先确认简报大纲</span>
          </div>
          <p className="mt-1 text-[11px] leading-relaxed text-[var(--text-secondary)]">
            可先改页标题、重点和顺序；确认后才会进入真实 PPTX 生成。
          </p>
        </div>
        <button
          type="button"
          onClick={onReset}
          className="inline-flex shrink-0 items-center gap-1 rounded-full border border-[var(--border-subtle)] px-2 py-1 text-[10px] font-medium text-[var(--text-secondary)] transition hover:border-[var(--border-hover)] hover:text-[var(--text-primary)]"
          data-testid="academic-ppt-outline-reset"
        >
          <RotateCcw className="h-3 w-3" />
          重置
        </button>
      </div>

      <ol className="space-y-2">
        {items.map((item, index) => (
          <li
            key={item.id}
            className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-card)] p-2.5"
            data-testid="academic-ppt-outline-item"
          >
            <div className="mb-2 flex items-center gap-2">
              <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-[var(--glass-hover)] text-[10px] font-semibold text-[var(--text-secondary)]">
                {index + 1}
              </span>
              <span className="min-w-0 flex-1 truncate text-[10px] text-[var(--text-tertiary)]">{item.sourceLabel}</span>
              <button
                type="button"
                onClick={() => moveItem(index, -1)}
                disabled={index === 0}
                className="rounded-md px-1.5 py-1 text-[10px] text-[var(--text-tertiary)] disabled:opacity-30 hover:bg-[var(--glass-hover)]"
                aria-label="上移这一页"
              >
                ↑
              </button>
              <button
                type="button"
                onClick={() => moveItem(index, 1)}
                disabled={index === items.length - 1}
                className="rounded-md px-1.5 py-1 text-[10px] text-[var(--text-tertiary)] disabled:opacity-30 hover:bg-[var(--glass-hover)]"
                aria-label="下移这一页"
              >
                ↓
              </button>
              <GripVertical className="h-3.5 w-3.5 text-[var(--text-quaternary)]" />
            </div>
            <input
              value={item.title}
              onChange={(event) => updateItem(index, { title: event.target.value })}
              className="mb-2 w-full rounded-lg border border-transparent bg-transparent px-2 py-1.5 text-xs font-semibold text-[var(--text-primary)] outline-none transition focus:border-[var(--accent-blue)]/30 focus:bg-[var(--glass-subtle)]"
              aria-label={`第 ${index + 1} 页标题`}
            />
            <textarea
              value={item.focus}
              onChange={(event) => updateItem(index, { focus: event.target.value })}
              rows={2}
              className="w-full resize-none rounded-lg border border-transparent bg-transparent px-2 py-1.5 text-[11px] leading-relaxed text-[var(--text-secondary)] outline-none transition focus:border-[var(--accent-blue)]/30 focus:bg-[var(--glass-subtle)]"
              aria-label={`第 ${index + 1} 页重点`}
            />
          </li>
        ))}
      </ol>

      <button
        type="button"
        onClick={() => onConfirmChange(!confirmed)}
        className={`mt-3 flex w-full items-center justify-center gap-2 rounded-xl border px-3 py-2.5 text-xs font-semibold transition ${
          confirmed
            ? 'border-emerald-400/35 bg-emerald-500/12 text-emerald-600 dark:text-emerald-300'
            : 'border-[var(--border-subtle)] bg-[var(--glass-subtle)] text-[var(--text-secondary)] hover:border-[var(--border-hover)]'
        }`}
        data-testid="academic-ppt-outline-confirm"
      >
        <Check className="h-4 w-4" />
        {confirmed ? '大纲已确认，可以生成 PPTX' : '确认大纲后继续生成'}
      </button>
    </section>
  );
}
