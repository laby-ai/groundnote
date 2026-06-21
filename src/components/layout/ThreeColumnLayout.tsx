'use client';

import { useState, useRef, useCallback, useEffect } from 'react';

interface ThreeColumnLayoutProps {
  leftPanel: React.ReactNode;
  centerPanel: React.ReactNode;
  rightPanel: React.ReactNode;
  defaultLeftWidth?: number;
  defaultRightWidth?: number;
  initialMobilePanel?: 'left' | 'center' | 'right';
}

export function ThreeColumnLayout({
  leftPanel,
  centerPanel,
  rightPanel,
  defaultLeftWidth = 280,
  defaultRightWidth = 380,
  initialMobilePanel = 'center',
}: ThreeColumnLayoutProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [leftWidth, setLeftWidth] = useState(defaultLeftWidth);
  const [rightWidth, setRightWidth] = useState(defaultRightWidth);
  const [dragging, setDragging] = useState<'left' | 'right' | null>(null);
  const [isMobile, setIsMobile] = useState(false);
  const [mobilePanel, setMobilePanel] = useState<'left' | 'center' | 'right'>(initialMobilePanel);
  const startXRef = useRef(0);
  const startWidthRef = useRef(0);

  const handleMouseDown = useCallback((side: 'left' | 'right', e: React.MouseEvent) => {
    e.preventDefault();
    setDragging(side);
    startXRef.current = e.clientX;
    startWidthRef.current = side === 'left' ? leftWidth : rightWidth;
  }, [leftWidth, rightWidth]);

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (!dragging) return;
    const delta = e.clientX - startXRef.current;
    if (dragging === 'left') {
      const newWidth = Math.max(220, Math.min(450, startWidthRef.current + delta));
      setLeftWidth(newWidth);
    } else {
      const newWidth = Math.max(280, Math.min(550, startWidthRef.current - delta));
      setRightWidth(newWidth);
    }
  }, [dragging]);

  const handleMouseUp = useCallback(() => {
    setDragging(null);
  }, []);

  useEffect(() => {
    if (dragging) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
    }
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [dragging, handleMouseMove, handleMouseUp]);

  useEffect(() => {
    const updateLayoutMode = () => setIsMobile(window.innerWidth < 768);
    updateLayoutMode();
    window.addEventListener('resize', updateLayoutMode);
    return () => window.removeEventListener('resize', updateLayoutMode);
  }, []);

  useEffect(() => {
    setMobilePanel(initialMobilePanel);
  }, [initialMobilePanel]);

  if (isMobile) {
    const activePanel = mobilePanel === 'left' ? leftPanel : mobilePanel === 'right' ? rightPanel : centerPanel;
    const tabs: Array<{ id: 'left' | 'center' | 'right'; label: string }> = [
      { id: 'left', label: '资料' },
      { id: 'center', label: '对话' },
      { id: 'right', label: 'Studio' },
    ];

    return (
      <div ref={containerRef} className="h-full w-full min-w-0 overflow-hidden flex flex-col">
        <div className="flex-shrink-0 border-b border-[var(--glass-border)] bg-black/25 px-3 py-2">
          <div className="grid grid-cols-3 gap-2 rounded-2xl border border-white/12 bg-white/[0.06] p-1">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setMobilePanel(tab.id)}
                className={`rounded-xl px-3 py-2 text-sm font-medium transition-all ${
                  mobilePanel === tab.id
                    ? 'bg-white text-black shadow-[0_8px_24px_rgba(0,0,0,0.18)]'
                    : 'text-[var(--text-secondary)] hover:bg-white/[0.08] hover:text-white'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-hidden liquid-glass-panel" style={{ borderRight: 'none', borderLeft: 'none' }}>
          {activePanel}
        </div>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="h-full w-full flex"
      style={{ cursor: dragging ? 'col-resize' : undefined }}
    >
      {/* Left Panel — liquid glass */}
      <div
        className="h-full flex-shrink-0 overflow-hidden liquid-glass-panel"
        style={{ width: leftWidth }}
      >
        {leftPanel}
      </div>

      {/* Left Divider */}
      <div
        className="panel-divider flex-shrink-0"
        onMouseDown={(e) => handleMouseDown('left', e)}
      />

      {/* Center Panel — liquid glass */}
      <div className="h-full flex-1 overflow-hidden liquid-glass-panel" style={{ borderRight: 'none', borderLeft: 'none' }}>
        {centerPanel}
      </div>

      {/* Right Divider */}
      <div
        className="panel-divider flex-shrink-0"
        onMouseDown={(e) => handleMouseDown('right', e)}
      />

      {/* Right Panel — liquid glass */}
      <div
        className="h-full flex-shrink-0 overflow-hidden liquid-glass-panel"
        style={{ width: rightWidth, borderRight: 'none', borderLeft: '1px solid var(--glass-border)' }}
      >
        {rightPanel}
      </div>
    </div>
  );
}
