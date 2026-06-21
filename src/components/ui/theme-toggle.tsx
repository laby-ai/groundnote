'use client';

import { useState, useEffect, useCallback } from 'react';

/**
 * 昼夜切换滑块组件
 * 纯黑(dark) / 纯白(light) 主题切换
 * 天体滑块：太阳/月亮 + 星星 + 云朵 + 流星
 */
export function ThemeToggle() {
  const [isDark, setIsDark] = useState(true);

  const applyTheme = useCallback((dark: boolean) => {
    const root = document.documentElement;
    if (dark) {
      root.removeAttribute('data-theme');
    } else {
      root.setAttribute('data-theme', 'light');
    }
  }, []);

  // 初始化：从 localStorage 读取，默认深色
  useEffect(() => {
    const saved = localStorage.getItem('theme');
    const dark = saved !== 'light';
    setIsDark(dark);
    applyTheme(dark);
  }, [applyTheme]);

  const handleToggle = useCallback(() => {
    const next = !isDark;
    setIsDark(next);
    applyTheme(next);
    localStorage.setItem('theme', next ? 'dark' : 'light');
  }, [isDark, applyTheme]);

  return (
    <div className="flex items-center">
      <input
        type="checkbox"
        id="theme-toggle"
        className="theme-checkbox"
        checked={isDark}
        onChange={handleToggle}
      />
      <label htmlFor="theme-toggle" className="theme-switch" aria-label="Toggle Dark Mode">
        {/* 星空层 (暗黑模式可见) */}
        <div className="stars-container">
          <div className="star star-1" />
          <div className="star star-2" />
          <div className="star star-3" />
          <div className="star star-4" />
          <div className="star star-5" />
          <div className="shooting-star" />
        </div>

        {/* 云朵层 (明亮模式可见) */}
        <div className="clouds-container">
          <div className="cloud cloud-1" />
          <div className="cloud cloud-2" />
          <div className="cloud cloud-3" />
        </div>

        {/* 核心天体 (太阳/月亮) */}
        <div className="celestial-body">
          <div className="crater crater-1" />
          <div className="crater crater-2" />
          <div className="crater crater-3" />
        </div>
      </label>
    </div>
  );
}
