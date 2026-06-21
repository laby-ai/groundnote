'use client';

import { useEffect, useRef, useCallback } from 'react';

/**
 * LiquidGlassProvider
 * Provides ambient background blobs and mouse-tracking hover-light
 * for the entire app. Wrap your app content with this component.
 */
export function LiquidGlassProvider({ children }: { children: React.ReactNode }) {
  const containerRef = useRef<HTMLDivElement>(null);

  // Mouse tracking for hover-light on all .liquid-glass-card / .liquid-glass-panel elements
  const handleMouseMove = useCallback((e: MouseEvent) => {
    const root = containerRef.current;
    if (!root) return;

    // Find all glass elements under cursor
    const elements = root.querySelectorAll(
      '.liquid-glass-card, .liquid-glass-panel, .liquid-glass-static, .liquid-glass-btn, .liquid-glass-chip, .liquid-glass-input, [data-liquid-glass]'
    );
    elements.forEach((el) => {
      const rect = (el as HTMLElement).getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      (el as HTMLElement).style.setProperty('--mouse-x', `${x}px`);
      (el as HTMLElement).style.setProperty('--mouse-y', `${y}px`);
    });
  }, []);

  useEffect(() => {
    const root = containerRef.current;
    if (!root) return;
    root.addEventListener('mousemove', handleMouseMove);
    return () => root.removeEventListener('mousemove', handleMouseMove);
  }, [handleMouseMove]);

  return (
    <div ref={containerRef} className="relative w-full min-h-full bg-[var(--bg-primary)]">
      {/* Ambient background is intentionally quiet; content contrast comes first. */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden" aria-hidden="true">
        <div
          className="ambient-blob ambient-blob-purple"
          style={{
            width: '460px',
            height: '460px',
            top: '5%',
            left: '10%',
          }}
        />
        <div
          className="ambient-blob ambient-blob-pink"
          style={{
            width: '520px',
            height: '520px',
            bottom: '0%',
            right: '5%',
          }}
        />
        <div
          className="ambient-blob ambient-blob-cyan"
          style={{
            width: '430px',
            height: '430px',
            top: '45%',
            left: '50%',
          }}
        />
      </div>

      {/* Content */}
      <div className="relative z-10 w-full min-h-full">
        {children}
      </div>
    </div>
  );
}
