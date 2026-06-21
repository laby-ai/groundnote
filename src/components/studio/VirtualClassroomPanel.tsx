'use client';

import { useEffect, useState } from 'react';
import { AlertCircle, CheckCircle2, GraduationCap, RefreshCw } from 'lucide-react';
import { useApp } from '@/contexts/AppContext';
import {
  buildVirtualClassroomEntry,
  CLASSROOM_ORIGIN,
} from '@/lib/virtual-classroom/workspace-entry';
import {
  VirtualClassroomOutlineCard,
  type ClassroomOutlineDraft,
  type ConfirmedClassroom,
} from './VirtualClassroomOutlineCard';
import { VirtualClassroomRecentList, type RecentClassroom } from './VirtualClassroomRecentList';

interface ClassroomStatus {
  ok: boolean;
  origin: string;
  recentClassrooms: RecentClassroom[];
}

export function VirtualClassroomPanel() {
  const { getSelectedPapers, openVirtualClassroom, virtualClassroomViewer } = useApp();
  const selectedPapers = getSelectedPapers();
  const [status, setStatus] = useState<ClassroomStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [outlineDraft, setOutlineDraft] = useState<ClassroomOutlineDraft | null>(null);
  const [outlineArtifactPath, setOutlineArtifactPath] = useState<string | null>(null);
  const [outlineLoading, setOutlineLoading] = useState(false);
  const [outlineError, setOutlineError] = useState<string | null>(null);
  const [confirmingOutline, setConfirmingOutline] = useState(false);
  const [confirmedClassroom, setConfirmedClassroom] = useState<ConfirmedClassroom | null>(null);
  const [confirmError, setConfirmError] = useState<string | null>(null);

  const loadStatus = async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/virtual-classroom/status', { cache: 'no-store' });
      const data = (await response.json()) as ClassroomStatus;
      setStatus(data);
    } catch {
      setStatus({ ok: false, origin: CLASSROOM_ORIGIN, recentClassrooms: [] });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadStatus();
  }, []);

  const openFullClassroom = () => {
    openVirtualClassroom(buildVirtualClassroomEntry(selectedPapers));
  };

  useEffect(() => {
    openFullClassroom();
    // Opening the full classroom is the product entry. Source selection changes should not reload it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const generateOutlineDraft = async () => {
    if (selectedPapers.length === 0) {
      setOutlineError('请先在左侧选择资料，再生成课程大纲。');
      return;
    }

    setOutlineLoading(true);
    setOutlineError(null);
    setOutlineDraft(null);
    setOutlineArtifactPath(null);
    setConfirmedClassroom(null);
    setConfirmError(null);

    try {
      const response = await fetch('/api/virtual-classroom/outline', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          papers: selectedPapers.map(paper => ({
            id: paper.id,
            title: paper.title,
            shortName: paper.shortName,
            abstract: paper.abstract,
            content: (paper.rawContent || paper.content || '').slice(0, 8000),
          })),
        }),
      });
      const data = await response.json();
      if (!response.ok || !data.ok) {
        throw new Error(data.error || '课程大纲生成失败');
      }
      setOutlineDraft(data.draft as ClassroomOutlineDraft);
      setOutlineArtifactPath(typeof data.artifactPath === 'string' ? data.artifactPath : null);
    } catch (error) {
      setOutlineError(error instanceof Error ? error.message : '课程大纲生成失败');
    } finally {
      setOutlineLoading(false);
    }
  };

  const confirmOutlineDraft = async () => {
    if (!outlineDraft) {
      setConfirmError('请先生成课程大纲，再确认课堂。');
      return;
    }

    setConfirmingOutline(true);
    setConfirmError(null);

    try {
      const response = await fetch('/api/virtual-classroom/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ draft: outlineDraft }),
      });
      const data = await response.json();
      if (!response.ok || !data.ok) {
        throw new Error(data.error || '确认课堂失败');
      }
      setOutlineDraft(data.confirmed as ClassroomOutlineDraft);
      openVirtualClassroom({
        url: data.classroomUrl,
        title: data.confirmed.title,
        source: 'confirmed',
        sourceCount: data.confirmed.sourceCount,
        sceneCount: data.confirmed.sceneCount,
        actionsCount: data.confirmed.actionsCount,
        scenes: data.confirmed.scenes,
        evidence: data.confirmed.evidence,
      });
      setConfirmedClassroom({
        confirmationStatus: 'confirmed',
        classroomUrl: data.classroomUrl,
        artifactPath: typeof data.artifactPath === 'string' ? data.artifactPath : undefined,
      });
    } catch (error) {
      setConfirmError(error instanceof Error ? error.message : '确认课堂失败');
    } finally {
      setConfirmingOutline(false);
    }
  };

  const openConfirmedClassroom = () => {
    if (!confirmedClassroom || !outlineDraft) return;
    openVirtualClassroom({
      url: confirmedClassroom.classroomUrl,
      title: outlineDraft.title,
      source: 'confirmed',
      sourceCount: outlineDraft.sourceCount,
      sceneCount: outlineDraft.sceneCount,
      actionsCount: outlineDraft.actionsCount,
      scenes: outlineDraft.scenes,
      evidence: outlineDraft.evidence,
    });
  };

  return (
    <div className="space-y-4" data-testid="virtual-classroom-panel">
      <div className="liquid-glass-card p-5">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-[var(--glass-border)] bg-[var(--glass-subtle)]">
            <GraduationCap className="h-5 w-5 text-[var(--accent-blue)]" />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-[var(--text-primary)]">虚拟教室</p>
            <p className="mt-1 text-xs leading-relaxed text-[var(--text-secondary)]">
              从左侧资料生成课程大纲，确认场景后在中间工作区查看课堂内容。
            </p>
          </div>
        </div>

        <div className="mt-4 flex items-center justify-between rounded-2xl border border-[var(--glass-border)] bg-[var(--glass-subtle)] px-3 py-2">
          <div className="flex items-center gap-2 text-xs font-medium">
            {status?.ok ? (
              <CheckCircle2 className="h-4 w-4 text-emerald-500" />
            ) : (
              <AlertCircle className="h-4 w-4 text-amber-500" />
            )}
            <span className="text-[var(--text-primary)]">
              {loading ? '正在检查课堂服务...' : status?.ok ? '课堂服务可用' : '课堂服务未连接'}
            </span>
          </div>
          <button
            type="button"
            onClick={() => void loadStatus()}
            className="rounded-full p-1.5 text-[var(--text-secondary)] transition hover:bg-[var(--glass-hover)] hover:text-[var(--text-primary)]"
            title="刷新课堂状态"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>

        <button
          type="button"
          onClick={openFullClassroom}
          className="liquid-glass-btn mt-4 w-full px-4 py-3 text-xs font-semibold"
          data-testid="virtual-classroom-open"
        >
          <GraduationCap className="h-3.5 w-3.5" />
          打开完整课堂
        </button>

        {virtualClassroomViewer && (
          <div
            className="mt-3 rounded-2xl border border-emerald-400/25 bg-emerald-500/10 px-3 py-3"
            data-testid="virtual-classroom-active-status"
          >
            <div className="flex items-center gap-2 text-[11px] font-semibold text-emerald-200">
              <CheckCircle2 className="h-3.5 w-3.5" />
              课堂已在中间工作区打开
            </div>
            <p className="mt-1 line-clamp-2 text-[11px] leading-relaxed text-[var(--text-secondary)]">
              {virtualClassroomViewer.title || '虚拟教室'}
              {virtualClassroomViewer.sceneCount ? ` · ${virtualClassroomViewer.sceneCount} 个场景` : ''}
              {virtualClassroomViewer.actionsCount ? ` · ${virtualClassroomViewer.actionsCount} 个动作` : ''}
            </p>
            <button
              type="button"
              onClick={() => openVirtualClassroom({
                url: virtualClassroomViewer.url,
                title: virtualClassroomViewer.title,
                source: virtualClassroomViewer.source,
                sourceCount: virtualClassroomViewer.sourceCount,
                sceneCount: virtualClassroomViewer.sceneCount,
                actionsCount: virtualClassroomViewer.actionsCount,
                scenes: virtualClassroomViewer.scenes,
                evidence: virtualClassroomViewer.evidence,
              })}
              className="mt-2 w-full rounded-xl border border-emerald-400/25 bg-emerald-500/10 px-3 py-2 text-[11px] font-semibold text-emerald-100 transition hover:bg-emerald-500/15"
              data-testid="virtual-classroom-return-opened"
            >
              回到已打开课堂
            </button>
          </div>
        )}

        <div className="mt-3 rounded-2xl border border-[var(--glass-border)] bg-[var(--glass-subtle)] px-3 py-3 text-[11px] leading-relaxed text-[var(--text-secondary)]">
          点击后会直接在中间工作区进入课堂；已选资料会带入课堂输入框，后续在课堂内继续生成。
        </div>
      </div>

      <VirtualClassroomOutlineCard
        selectedCount={selectedPapers.length}
        outlineDraft={outlineDraft}
        outlineArtifactPath={outlineArtifactPath}
        outlineLoading={outlineLoading}
        outlineError={outlineError}
        confirmingOutline={confirmingOutline}
        confirmedClassroom={confirmedClassroom}
        confirmError={confirmError}
        onGenerate={() => void generateOutlineDraft()}
        onConfirm={() => void confirmOutlineDraft()}
        onOpenConfirmed={openConfirmedClassroom}
      />

      <div className="liquid-glass-card p-4">
        <div className="mb-3 flex items-center justify-between">
          <p className="text-xs font-semibold text-[var(--text-primary)]">最近课堂</p>
          <span className="text-[11px] text-[var(--text-tertiary)]">
            {status?.recentClassrooms.length ? `${status.recentClassrooms.length} 个可打开结果` : '暂无结果'}
          </span>
        </div>

        <VirtualClassroomRecentList
          origin={status?.origin || CLASSROOM_ORIGIN}
          recentClassrooms={status?.recentClassrooms || []}
          currentViewer={virtualClassroomViewer}
          openVirtualClassroom={openVirtualClassroom}
        />
      </div>
      <div className="rounded-2xl border border-[var(--glass-border)] bg-[var(--glass-subtle)] p-4 text-xs leading-relaxed text-[var(--text-secondary)]">
        右侧面板用于查看状态、生成大纲和确认课堂；打开课堂后会进入中间工作区，避免在窄栏里遮挡内容。
      </div>
    </div>
  );
}
