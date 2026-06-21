'use client';

import { CheckCircle2 } from 'lucide-react';
import { getVirtualClassroomTypeLabel } from '@/lib/virtual-classroom/workspace-entry';
import type { VirtualClassroomViewer } from '@/types';

export interface RecentClassroom {
  id: string;
  title: string;
  description: string;
  scenesCount: number;
  actionsCount: number;
  sceneTypes: string[];
  updatedAt: string;
  url: string;
  exportUrl?: string;
}

interface VirtualClassroomRecentListProps {
  origin: string;
  recentClassrooms: RecentClassroom[];
  currentViewer: VirtualClassroomViewer | null;
  openVirtualClassroom: (viewer: Omit<VirtualClassroomViewer, 'openedAt'>) => void;
}

function normalizeClassroomUrl(url: string) {
  try {
    const parsed = new URL(url);
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return url;
  }
}

export function VirtualClassroomRecentList({
  origin,
  recentClassrooms,
  currentViewer,
  openVirtualClassroom,
}: VirtualClassroomRecentListProps) {
  const currentUrl = currentViewer ? normalizeClassroomUrl(currentViewer.url) : '';

  if (recentClassrooms.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-[var(--glass-border)] bg-[var(--glass-subtle)] p-4 text-center text-xs leading-relaxed text-[var(--text-secondary)]">
        生成并确认课堂后，这里会显示最近的课堂记录。
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {recentClassrooms.map((item) => {
        const isCurrent = currentUrl === normalizeClassroomUrl(item.url);

        return (
          <div
            key={item.id}
            className="block w-full rounded-2xl border border-[var(--glass-border)] bg-[var(--glass-subtle)] p-3 text-left"
            data-testid={`virtual-classroom-recent-${item.id}`}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate text-xs font-semibold text-[var(--text-primary)]">{item.title}</p>
                <p className="mt-1 line-clamp-2 text-[11px] leading-relaxed text-[var(--text-secondary)]">
                  {item.description || '包含讲解、测验和项目任务的课堂内容。'}
                </p>
              </div>
              {isCurrent ? (
                <span
                  className="mt-0.5 inline-flex shrink-0 items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-1 text-[10px] font-semibold text-emerald-200"
                  data-testid={`virtual-classroom-recent-current-${item.id}`}
                >
                  <CheckCircle2 className="h-3 w-3" />
                  当前
                </span>
              ) : (
                <span className="mt-0.5 shrink-0 rounded-full bg-[var(--glass-hover)] px-2 py-1 text-[10px] text-[var(--text-tertiary)]">
                  记录
                </span>
              )}
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-1.5 text-[10px] text-[var(--text-tertiary)]">
              <span className="rounded-full bg-[var(--glass-hover)] px-2 py-1">{item.scenesCount} 个场景</span>
              <span className="rounded-full bg-[var(--glass-hover)] px-2 py-1">{item.actionsCount} 个动作</span>
              {item.sceneTypes.slice(0, 3).map((type) => (
                <span key={type} className="rounded-full bg-[var(--glass-hover)] px-2 py-1">
                  {getVirtualClassroomTypeLabel(type)}
                </span>
              ))}
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => openVirtualClassroom({
                  url: item.url,
                  title: item.title,
                  source: 'recent',
                  sceneCount: item.scenesCount,
                  actionsCount: item.actionsCount,
                })}
                className="rounded-xl border border-[var(--glass-border)] bg-[var(--glass)] px-3 py-2 text-[11px] font-semibold text-[var(--text-primary)] transition hover:bg-[var(--glass-hover)]"
                data-testid={`virtual-classroom-recent-open-${item.id}`}
              >
                {isCurrent ? '回到课堂' : '打开课堂'}
              </button>
              <a
                href={item.exportUrl || `${origin}/api/classroom?id=${encodeURIComponent(item.id)}`}
                target="_blank"
                rel="noreferrer"
                className="rounded-xl border border-[var(--glass-border)] bg-[var(--glass)] px-3 py-2 text-center text-[11px] font-semibold text-[var(--text-primary)] transition hover:bg-[var(--glass-hover)]"
                data-testid={`virtual-classroom-recent-export-${item.id}`}
              >
                导出数据
              </a>
            </div>
          </div>
        );
      })}
    </div>
  );
}
