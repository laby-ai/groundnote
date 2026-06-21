'use client';

import { useState } from 'react';
import { KnowledgeMapPanel } from './KnowledgeMapPanel';
import { PresentationWorkspacePanel } from './PresentationPanels';
import { AudioPanel } from './AudioPanel';
import { VirtualClassroomPanel } from './VirtualClassroomPanel';
import {
  STUDIO_ARTIFACT_TOOLS,
  STUDIO_NAV,
  StudioToolSwitcher,
  type StudioNavItem,
  type StudioTab,
} from './StudioToolSwitcher';
import { StudioArtifactToolPanel } from './StudioArtifactToolPanel';

export function StudioPanel() {
  const [activeTab, setActiveTab] = useState<StudioTab>('presentation');
  const activeToolItem = STUDIO_ARTIFACT_TOOLS.find(n => n.id === activeTab);
  const navItem: StudioNavItem =
    STUDIO_NAV.find(n => n.id === activeTab) ??
    (activeToolItem
      ? {
          id: activeToolItem.id,
          label: activeToolItem.label,
          desc: activeToolItem.desc,
          icon: activeToolItem.icon,
          accent: 'from-blue-500/10 to-cyan-500/5',
        }
      : STUDIO_NAV[0]);
  const NavIcon = navItem.icon;

  return (
    <div className="h-full flex flex-col">
      <div className="px-5 pt-5 pb-4 border-b border-[var(--glass-border)]">
        <div className="flex items-center gap-3 mb-4">
          <div className={`w-8 h-8 rounded-xl bg-gradient-to-br ${navItem.accent} flex items-center justify-center border border-[var(--glass-border)]`}>
            <NavIcon className="h-4 w-4 text-[var(--text-secondary)]" />
          </div>
          <div>
            <h2 className="text-base font-semibold tracking-tight text-[var(--text-primary)]">Studio</h2>
            <p className="text-[11px] text-[var(--text-tertiary)]">资料产物中心</p>
          </div>
        </div>

        <StudioToolSwitcher activeTab={activeTab} onSelect={setActiveTab} />
        <p
          data-testid="studio-nav-helper"
          className="mt-3 rounded-xl border border-[var(--glass-border)] bg-[var(--glass-subtle)] px-3 py-2 text-[11px] leading-relaxed text-[var(--text-tertiary)]"
        >
          上方只用于切换工具，不会直接生成。进入下方设置面板后，再点击明确的生成按钮。
        </p>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto px-5 py-4">
        {activeTab === 'presentation' && <PresentationWorkspacePanel />}
        {activeTab === 'presentation2' && <PresentationWorkspacePanel initialMode="structured" />}
        {activeTab === 'audio' && <AudioPanel />}
        {activeTab === 'knowledge' && <KnowledgeMapPanel />}
        {activeTab === 'virtual-classroom' && <VirtualClassroomPanel />}
        {activeTab === 'interactive' && <StudioArtifactToolPanel toolId="interactive" />}
        {activeTab === 'quiz' && <StudioArtifactToolPanel toolId="quiz" />}
        {activeTab === 'project' && <StudioArtifactToolPanel toolId="project" />}
      </div>
    </div>
  );
}
