'use client';

import { Check, CheckCircle2, FileText, GraduationCap, Loader2 } from 'lucide-react';
import type {
  VirtualClassroomConfirmedOutline,
  VirtualClassroomOutlineDraft,
} from '@/lib/virtual-classroom/outline-draft';
import { getVirtualClassroomTypeLabel } from '@/lib/virtual-classroom/workspace-entry';

export type ClassroomOutlineDraft = VirtualClassroomOutlineDraft | VirtualClassroomConfirmedOutline;

export interface ConfirmedClassroom {
  confirmationStatus: 'confirmed';
  classroomUrl: string;
  artifactPath?: string;
}

interface VirtualClassroomOutlineCardProps {
  selectedCount: number;
  outlineDraft: ClassroomOutlineDraft | null;
  outlineArtifactPath: string | null;
  outlineLoading: boolean;
  outlineError: string | null;
  confirmingOutline: boolean;
  confirmedClassroom: ConfirmedClassroom | null;
  confirmError: string | null;
  onGenerate: () => void;
  onConfirm: () => void;
  onOpenConfirmed: () => void;
}

export function VirtualClassroomOutlineCard({
  selectedCount,
  outlineDraft,
  outlineArtifactPath,
  outlineLoading,
  outlineError,
  confirmingOutline,
  confirmedClassroom,
  confirmError,
  onGenerate,
  onConfirm,
  onOpenConfirmed,
}: VirtualClassroomOutlineCardProps) {
  return (
    <div className="liquid-glass-card p-4" data-testid="virtual-classroom-outline">
      <div className="flex items-start gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-[var(--glass-border)] bg-[var(--glass-subtle)]">
          <FileText className="h-4 w-4 text-[var(--accent-blue)]" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-semibold text-[var(--text-primary)]">课程大纲</p>
            <span className="text-[10px] text-[var(--text-tertiary)]">
              已选 {selectedCount} 个资料
            </span>
          </div>
          <p className="mt-1 text-[11px] leading-relaxed text-[var(--text-secondary)]">
            先生成可检查的课程场景草稿，确认后在中间工作区打开课堂。
          </p>
        </div>
      </div>

      <button
        type="button"
        onClick={onGenerate}
        disabled={outlineLoading || selectedCount === 0}
        className="liquid-glass-btn mt-3 w-full px-4 py-3 text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-50"
        data-testid="virtual-classroom-generate-outline"
      >
        {outlineLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileText className="h-3.5 w-3.5" />}
        {outlineLoading ? '正在生成课程大纲...' : selectedCount === 0 ? '先选择资料' : '生成课程大纲'}
      </button>

      {outlineError && (
        <div
          className="mt-3 rounded-xl border border-amber-400/30 bg-amber-500/10 px-3 py-2 text-[11px] leading-relaxed text-amber-200"
          data-testid="virtual-classroom-outline-error"
        >
          {outlineError}
        </div>
      )}

      {outlineDraft && (
        <div className="mt-3 space-y-2" data-testid="virtual-classroom-outline-result">
          <div className="rounded-xl border border-emerald-400/25 bg-emerald-500/10 px-3 py-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] font-semibold text-emerald-200">
                {outlineDraft.confirmationStatus === 'confirmed' ? '已确认课堂' : '待确认大纲'}
              </span>
              <span className="text-[10px] text-emerald-100/80">
                {outlineDraft.sceneCount} 个场景 · {outlineDraft.actionsCount} 个动作
              </span>
            </div>
            <p className="mt-1 text-[11px] leading-relaxed text-[var(--text-secondary)]">
              {outlineDraft.title}
            </p>
          </div>

          {outlineDraft.scenes.map(scene => (
            <div
              key={scene.id}
              className="rounded-xl border border-[var(--glass-border)] bg-[var(--glass-subtle)] px-3 py-2"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-[11px] font-semibold text-[var(--text-primary)]">
                    {scene.order}. {scene.title}
                  </p>
                  <p className="mt-1 text-[10px] leading-relaxed text-[var(--text-secondary)]">
                    {scene.objective}
                  </p>
                </div>
                <span className="shrink-0 rounded-full bg-[var(--glass-hover)] px-2 py-1 text-[10px] text-[var(--text-secondary)]">
                  {getVirtualClassroomTypeLabel(scene.type)}
                </span>
              </div>
            </div>
          ))}

          {outlineArtifactPath && (
            <p className="text-[10px] leading-relaxed text-[var(--text-tertiary)]">
              已保存大纲证据，下一步可确认场景并生成课堂内容。
            </p>
          )}

          {confirmError && (
            <div
              className="rounded-xl border border-amber-400/30 bg-amber-500/10 px-3 py-2 text-[11px] leading-relaxed text-amber-200"
              data-testid="virtual-classroom-confirm-error"
            >
              {confirmError}
            </div>
          )}

          {confirmedClassroom && (
            <div
              className="rounded-xl border border-emerald-400/25 bg-emerald-500/10 px-3 py-2"
              data-testid="virtual-classroom-runtime-confirmed-status"
            >
              <div className="flex items-center gap-2 text-[11px] font-semibold text-emerald-200">
                <CheckCircle2 className="h-3.5 w-3.5" />
                已送入完整课堂
              </div>
              <p className="mt-1 text-[10px] leading-relaxed text-[var(--text-secondary)]">
                中间工作区已打开课堂运行时，可继续生成课堂内容和互动任务。
              </p>
            </div>
          )}

          {confirmedClassroom ? (
            <button
              type="button"
              onClick={onOpenConfirmed}
              className="liquid-glass-btn w-full px-4 py-3 text-xs font-semibold"
              data-testid="virtual-classroom-open-confirmed"
            >
              <GraduationCap className="h-3.5 w-3.5" />
              回到课堂
            </button>
          ) : (
            <button
              type="button"
              onClick={onConfirm}
              disabled={confirmingOutline}
              className="liquid-glass-btn w-full px-4 py-3 text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-50"
              data-testid="virtual-classroom-confirm-outline"
            >
              {confirmingOutline ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
              {confirmingOutline ? '正在确认课堂...' : '确认大纲并生成课堂页'}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
