'use client';

import { useState, useCallback } from 'react';
import {
  Globe, Lock, UserCheck,
  FileText, Presentation, Volume2, Video,
  Loader2, Copy, CheckCircle2,
} from 'lucide-react';
import { useApp } from '@/contexts/AppContext';

type AccessLevel = 'public' | 'password' | 'specified';
type ExportFormat = 'word' | 'pdf_report' | 'pptx' | 'pdf_slides' | 'mp3' | 'mp4';

interface ExportOption {
  key: ExportFormat;
  label: string;
  icon: React.ElementType;
  ext: string;
  desc: string;
}

const EXPORT_OPTIONS: ExportOption[] = [
  { key: 'word', label: 'Word 文档', icon: FileText, ext: '.docx', desc: '富文本报告' },
  { key: 'pdf_report', label: 'PDF 报告', icon: FileText, ext: '.pdf', desc: '带引用的报告' },
  { key: 'pptx', label: 'PPT 演示', icon: Presentation, ext: '.pptx', desc: '完整PPT文件' },
  { key: 'pdf_slides', label: 'PDF 幻灯片', icon: Presentation, ext: '.pdf', desc: '幻灯片PDF' },
  { key: 'mp3', label: 'MP3 音频', icon: Volume2, ext: '.mp3', desc: '讲解音频' },
  { key: 'mp4', label: 'MP4 视频', icon: Video, ext: '.mp4', desc: '含音画同步' },
];

export function PublishExport() {
  const { currentReport, slides } = useApp();
  const [accessLevel, setAccessLevel] = useState<AccessLevel>('public');
  const [password, setPassword] = useState('');
  const [isPublishing, setIsPublishing] = useState(false);
  const [isExporting, setIsExporting] = useState<ExportFormat | null>(null);
  const [shareLink, setShareLink] = useState('');
  const [copiedLink, setCopiedLink] = useState(false);

  const handlePublish = useCallback(async () => {
    setIsPublishing(true);
    setTimeout(() => {
      const domain = process.env.NEXT_PUBLIC_DOMAIN || 'evidencetalk.app';
      setShareLink(`https://${domain}/share/${Date.now().toString(36)}`);
      setIsPublishing(false);
    }, 1500);
  }, []);

  const handleExport = useCallback(async (format: ExportFormat) => {
    setIsExporting(format);
    setTimeout(() => {
      setIsExporting(null);
    }, 2000);
  }, []);

  const handleCopyLink = useCallback(() => {
    if (shareLink) {
      navigator.clipboard.writeText(shareLink);
      setCopiedLink(true);
      setTimeout(() => setCopiedLink(false), 2000);
    }
  }, [shareLink]);

  return (
    <div className="h-full flex flex-col bg-[var(--bg-primary)]">
      {/* Header */}
      <div className="px-5 pt-5 pb-4 border-b border-[var(--border-subtle)]">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-xl bg-cyan-500/10 flex items-center justify-center">
            <Globe className="h-4 w-4 text-cyan-400" />
          </div>
          <div>
            <h2 className="text-base font-semibold tracking-tight text-[var(--text-primary)]">发布与导出</h2>
            <p className="text-[11px] text-[var(--text-muted)]">分享链接与多格式导出</p>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-6">
        {/* Publish section */}
        <div className="space-y-4">
          <p className="section-label">一键发布</p>

          {/* Access level */}
          <div className="space-y-2">
            <p className="text-[11px] text-[var(--text-muted)]">访问权限</p>
            <div className="space-y-2">
              {([
                { key: 'public' as const, icon: Globe, label: '公开访问', desc: '任何人可通过链接查看' },
                { key: 'password' as const, icon: Lock, label: '密码保护', desc: '需要输入密码才能查看' },
                { key: 'specified' as const, icon: UserCheck, label: '指定用户', desc: '仅授权用户可查看' },
              ]).map(({ key, icon: Icon, label, desc }) => (
                <button
                  key={key}
                  onClick={() => setAccessLevel(key)}
                  className={`w-full text-left p-3 rounded-xl flex items-center gap-3 transition-all duration-300 ${
                    accessLevel === key
                      ? 'bg-cyan-500/[0.08] border border-cyan-500/20'
                      : 'liquid-glass-card'
                  }`}
                >
                  <Icon className={`h-4 w-4 ${accessLevel === key ? 'text-cyan-400' : 'text-[var(--text-muted)]'}`} />
                  <div>
                    <p className={`text-xs font-medium ${accessLevel === key ? 'text-[var(--accent-cyan)]' : 'text-[var(--text-tertiary)]'}`}>{label}</p>
                    <p className="text-[10px] text-[var(--text-muted)]">{desc}</p>
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Password input */}
          {accessLevel === 'password' && (
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="设置访问密码..."
              className="apple-input"
            />
          )}

          <button onClick={handlePublish} disabled={isPublishing} className="btn-primary w-full py-3 text-xs">
            {isPublishing ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> 发布中...</> : <><Globe className="h-3.5 w-3.5" /> 发布项目</>}
          </button>

          {/* Share link */}
          {shareLink && (
            <div className="liquid-glass-card p-4 animate-fade-in">
              <p className="section-label mb-2">分享链接</p>
              <div className="flex items-center gap-2">
                <div className="flex-1 px-3 py-2 bg-[var(--bg-tertiary)] rounded-xl text-xs text-[var(--text-tertiary)] font-mono truncate border border-[var(--border-subtle)]">
                  {shareLink}
                </div>
                <button onClick={handleCopyLink} className="btn-secondary py-2 px-3 text-xs">
                  {copiedLink ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Divider */}
        <div className="h-px bg-[var(--border-subtle)]" />

        {/* Export section */}
        <div className="space-y-4">
          <p className="section-label">多格式导出</p>

          {(!currentReport && slides.length === 0) && (
            <p className="text-[11px] text-[var(--text-muted)] text-center py-4">请先生成报告或 PPT 后再导出</p>
          )}

          <div className="grid grid-cols-2 gap-2">
            {EXPORT_OPTIONS.map(opt => {
              const Icon = opt.icon;
              const isDisabled = (opt.key.startsWith('word') || opt.key.startsWith('pdf_report')) ? !currentReport : slides.length === 0;
              return (
                <button
                  key={opt.key}
                  onClick={() => !isDisabled && handleExport(opt.key)}
                  disabled={isDisabled || isExporting !== null}
                  className={`text-left p-3 rounded-xl transition-all duration-300 ${
                    isDisabled
                      ? 'opacity-40 cursor-not-allowed liquid-glass-card'
                      : 'liquid-glass-card'
                  }`}
                >
                  <div className="flex items-center gap-2 mb-1.5">
                    {isExporting === opt.key ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin text-cyan-400" />
                    ) : (
                      <Icon className="h-3.5 w-3.5 text-[var(--text-muted)]" />
                    )}
                    <span className="text-[11px] font-medium text-zinc-300">{opt.label}</span>
                  </div>
                  <p className="text-[10px] text-[var(--text-muted)]">{opt.desc}</p>
                  <span className="text-[9px] text-zinc-700 font-mono mt-1 inline-block">{opt.ext}</span>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
