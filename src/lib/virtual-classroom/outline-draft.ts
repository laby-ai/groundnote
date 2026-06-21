import type { Paper } from '@/types';

export type VirtualClassroomSceneType = 'slide' | 'quiz' | 'project';

export interface VirtualClassroomSourceInput {
  id: string;
  title: string;
  shortName?: string;
  content?: string;
  rawContent?: string;
  abstract?: string;
}

export interface VirtualClassroomSceneDraft {
  id: string;
  order: number;
  type: VirtualClassroomSceneType;
  title: string;
  objective: string;
  evidenceSourceIds: string[];
  plannedActions: string[];
}

export interface VirtualClassroomOutlineDraft {
  id: string;
  title: string;
  status: 'draft';
  confirmationStatus: 'unconfirmed';
  sourceCount: number;
  sourceIds: string[];
  sceneCount: number;
  actionsCount: number;
  scenes: VirtualClassroomSceneDraft[];
  evidence: Array<{
    sourceId: string;
    sourceTitle: string;
    snippet: string;
  }>;
  generatedAt: string;
}

export interface VirtualClassroomConfirmedOutline extends Omit<VirtualClassroomOutlineDraft, 'confirmationStatus'> {
  confirmationStatus: 'confirmed';
  confirmedAt: string;
  classroomUrl: string;
}

const SCENE_TYPES: VirtualClassroomSceneType[] = ['slide', 'quiz', 'project'];

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function sourceText(source: VirtualClassroomSourceInput): string {
  return normalizeWhitespace(source.rawContent || source.content || source.abstract || source.title || '');
}

function shortTitle(value: string, fallback: string): string {
  const normalized = normalizeWhitespace(value);
  if (!normalized) return fallback;
  return normalized.length > 42 ? `${normalized.slice(0, 42)}...` : normalized;
}

function evidenceSnippet(source: VirtualClassroomSourceInput): string {
  const text = sourceText(source);
  if (!text) return source.title;
  const sentence = text.split(/[。！？.!?]/).find(part => normalizeWhitespace(part).length >= 12) || text;
  return shortTitle(sentence, source.title);
}

function sourceLabel(source: VirtualClassroomSourceInput, index: number): string {
  return source.shortName || shortTitle(source.title, `资料 ${index + 1}`);
}

export function buildVirtualClassroomOutlineDraft(
  sources: Array<VirtualClassroomSourceInput | Paper>,
): VirtualClassroomOutlineDraft {
  const usableSources = sources.filter(source => source.id && source.title);
  if (usableSources.length === 0) {
    throw new Error('请先选择资料，再生成课程大纲。');
  }

  const primary = usableSources[0];
  const topic = shortTitle(primary.title, '资料主题');
  const sourceIds = usableSources.map(source => source.id);
  const evidence = usableSources.slice(0, 4).map(source => ({
    sourceId: source.id,
    sourceTitle: source.title,
    snippet: evidenceSnippet(source),
  }));

  const sceneSeeds = [
    {
      title: `理解：${topic}`,
      objective: `用 ${sourceLabel(primary, 0)} 建立核心概念、背景和学习目标。`,
      plannedActions: ['展示核心概念', '解释资料背景', '标注证据来源'],
    },
    {
      title: '测验：检查关键理解',
      objective: '把资料中的关键事实转换为选择题或判断题，帮助学习者自检。',
      plannedActions: ['生成 3 道检查题', '给出答案解析', '回指资料证据'],
    },
    {
      title: '项目：迁移到真实任务',
      objective: '把资料观点组织成一个可执行的小任务，产出任务目标、步骤和检查点。',
      plannedActions: ['定义任务目标', '拆分执行步骤', '列出验收标准', '提示风险点'],
    },
  ];

  const scenes = sceneSeeds.map((seed, index) => ({
    id: `scene-${index + 1}`,
    order: index + 1,
    type: SCENE_TYPES[index],
    title: seed.title,
    objective: seed.objective,
    evidenceSourceIds: sourceIds.slice(0, Math.min(sourceIds.length, index + 1)),
    plannedActions: seed.plannedActions,
  }));

  return {
    id: `classroom-outline-${Date.now()}`,
    title: `${topic} · 课程大纲`,
    status: 'draft',
    confirmationStatus: 'unconfirmed',
    sourceCount: usableSources.length,
    sourceIds,
    sceneCount: scenes.length,
    actionsCount: scenes.reduce((sum, scene) => sum + scene.plannedActions.length, 0),
    scenes,
    evidence,
    generatedAt: new Date().toISOString(),
  };
}

export function buildConfirmedClassroomDraft(draft: VirtualClassroomOutlineDraft): string {
  const scenes = draft.scenes.map(scene => [
    `${scene.order}. ${scene.title}`,
    `类型：${scene.type === 'slide' ? '讲解' : scene.type === 'quiz' ? '测验' : '项目'}`,
    `目标：${scene.objective}`,
    `动作：${scene.plannedActions.join('；')}`,
  ].join('\n')).join('\n\n');
  const evidence = draft.evidence.map((item, index) =>
    `${index + 1}. ${item.sourceTitle}：${item.snippet}`,
  ).join('\n');

  return [
    `请生成一节完整虚拟课堂：${draft.title}`,
    `资料数量：${draft.sourceCount}`,
    `场景数量：${draft.sceneCount}`,
    `计划动作数：${draft.actionsCount}`,
    '',
    '请严格围绕以下已确认课程大纲生成课堂，不要改成普通报告。',
    scenes,
    '',
    '资料证据：',
    evidence || '暂无资料证据。',
  ].join('\n');
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function buildVirtualClassroomPreviewHtml(draft: VirtualClassroomOutlineDraft): string {
  const sceneCards = draft.scenes.map(scene => `
    <article class="scene-card">
      <div class="scene-meta">场景 ${scene.order} · ${scene.type === 'slide' ? '讲解' : scene.type === 'quiz' ? '测验' : '项目'}</div>
      <h2>${escapeHtml(scene.title)}</h2>
      <p>${escapeHtml(scene.objective)}</p>
      <ul>
        ${scene.plannedActions.map(action => `<li>${escapeHtml(action)}</li>`).join('')}
      </ul>
    </article>
  `).join('');
  const evidenceCards = draft.evidence.map(item => `
    <div class="evidence">
      <strong>${escapeHtml(item.sourceTitle)}</strong>
      <span>${escapeHtml(item.snippet)}</span>
    </div>
  `).join('');

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(draft.title)}</title>
  <style>
    :root { color-scheme: light dark; font-family: Inter, "Microsoft YaHei", system-ui, sans-serif; }
    body { margin: 0; background: #f6f8fb; color: #111827; }
    .shell { max-width: 1040px; margin: 0 auto; padding: 44px 24px 64px; }
    .hero { border: 1px solid rgba(148,163,184,.35); border-radius: 24px; background: rgba(255,255,255,.82); padding: 28px; box-shadow: 0 24px 80px rgba(15,23,42,.08); }
    .eyebrow { color: #2563eb; font-size: 13px; font-weight: 700; letter-spacing: .04em; }
    h1 { margin: 10px 0 12px; font-size: clamp(28px, 5vw, 48px); line-height: 1.05; }
    .summary { color: #475569; line-height: 1.8; }
    .stats { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 20px; }
    .pill { border-radius: 999px; background: #e8f1ff; color: #1e40af; padding: 8px 12px; font-size: 13px; font-weight: 700; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 16px; margin-top: 24px; }
    .scene-card, .evidence { border: 1px solid rgba(148,163,184,.35); border-radius: 18px; background: rgba(255,255,255,.9); padding: 20px; }
    .scene-meta { color: #2563eb; font-size: 12px; font-weight: 700; }
    h2 { margin: 8px 0 10px; font-size: 20px; }
    p, li, span { color: #475569; line-height: 1.75; }
    ul { padding-left: 20px; margin-bottom: 0; }
    .evidence-wrap { margin-top: 28px; }
    .evidence { display: grid; gap: 6px; }
    @media (prefers-color-scheme: dark) {
      body { background: #0f172a; color: #f8fafc; }
      .hero, .scene-card, .evidence { background: rgba(15,23,42,.82); border-color: rgba(148,163,184,.28); }
      .summary, p, li, span { color: #cbd5e1; }
      .pill { background: rgba(37,99,235,.22); color: #bfdbfe; }
    }
  </style>
</head>
<body>
  <main class="shell">
    <section class="hero">
      <div class="eyebrow">已确认课堂大纲</div>
      <h1>${escapeHtml(draft.title)}</h1>
      <p class="summary">这是基于所选资料生成并确认的课堂结构。下一步可继续生成完整课堂内容、测验、互动任务和导出产物。</p>
      <div class="stats">
        <span class="pill">${draft.sourceCount} 个资料来源</span>
        <span class="pill">${draft.sceneCount} 个场景</span>
        <span class="pill">${draft.actionsCount} 个计划动作</span>
      </div>
    </section>
    <section class="grid">${sceneCards}</section>
    <section class="evidence-wrap">
      <h2>资料证据</h2>
      <div class="grid">${evidenceCards}</div>
    </section>
  </main>
</body>
</html>`;
}
