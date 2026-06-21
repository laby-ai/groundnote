import type { Paper } from '@/types';

export type PptOutlineDraftItem = {
  id: string;
  title: string;
  focus: string;
  sourceLabel: string;
};

export type PptOutlineDraftSlideType =
  | 'cover'
  | 'background'
  | 'gap'
  | 'method'
  | 'result'
  | 'discussion'
  | 'conclusion'
  | 'synthesis';

export type PptOutlineDraftStructureItem = {
  type: PptOutlineDraftSlideType;
  title: string;
  discourseRef: string;
};

const MAX_OUTLINE_ITEMS = 18;
const MAX_TITLE_LENGTH = 80;
const MAX_FOCUS_LENGTH = 220;
const MAX_SOURCE_LABEL_LENGTH = 80;

function cleanText(value: unknown, maxLength: number): string {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

export function buildPptOutlineDraft(papers: Paper[], duration: number): PptOutlineDraftItem[] {
  const sourceSlides = papers.slice(0, 4).map((paper, index) => ({
    id: `source-${paper.id || index}`,
    title: index === 0 ? '资料背景与核心问题' : `${paper.shortName || `资料 ${index + 1}`} 的关键发现`,
    focus: (paper.abstract || paper.content || paper.rawContent || '提炼该资料中最适合放入简报的论点、证据和局限。')
      .replace(/\s+/g, ' ')
      .slice(0, 96),
    sourceLabel: paper.shortName || paper.title || `资料 ${index + 1}`,
  }));

  return [
    {
      id: 'opening',
      title: '封面与汇报目标',
      focus: `说明本次简报的范围、受众和预计 ${duration} 分钟讲述节奏。`,
      sourceLabel: '汇报设置',
    },
    ...sourceSlides,
    {
      id: 'synthesis',
      title: '综合判断与行动建议',
      focus: '横向比较资料之间的一致结论、分歧和可落地下一步。',
      sourceLabel: papers.length > 1 ? `${papers.length} 个来源综合` : '资料综合',
    },
  ];
}

export function sanitizePptOutlineDraft(input: unknown): PptOutlineDraftItem[] {
  if (!Array.isArray(input)) return [];

  return input
    .slice(0, MAX_OUTLINE_ITEMS)
    .map((item, index) => {
      const record = item && typeof item === 'object' ? item as Record<string, unknown> : {};
      const title = cleanText(record.title, MAX_TITLE_LENGTH);
      const focus = cleanText(record.focus, MAX_FOCUS_LENGTH);
      if (!title && !focus) return null;

      return {
        id: cleanText(record.id, 64) || `outline-${index + 1}`,
        title: title || `第 ${index + 1} 页`,
        focus: focus || '围绕所选资料提炼可验证内容。',
        sourceLabel: cleanText(record.sourceLabel, MAX_SOURCE_LABEL_LENGTH) || '用户确认大纲',
      };
    })
    .filter((item): item is PptOutlineDraftItem => Boolean(item));
}

export function formatPptOutlineDraftForPrompt(items: PptOutlineDraftItem[]): string {
  if (items.length === 0) return '';

  return items
    .map((item, index) => {
      const source = item.sourceLabel ? ` | 来源: ${item.sourceLabel}` : '';
      return `${index + 1}. ${item.title}${source}\n   重点: ${item.focus}`;
    })
    .join('\n');
}

export function inferPptOutlineDraftSlideType(
  item: PptOutlineDraftItem,
  index: number,
  total: number,
): PptOutlineDraftSlideType {
  const text = `${item.title} ${item.focus}`;
  if (index === 0 || /封面|汇报目标|开场/.test(text)) return 'cover';
  if (index === total - 1 && /综合|判断|建议|总结|结论|下一步/.test(text)) return 'conclusion';
  if (/背景|目标|范围|现状/.test(text)) return 'background';
  if (/风险|局限|挑战|缺口|问题/.test(text)) return 'gap';
  if (/方法|流程|方案|执行|路径|步骤/.test(text)) return 'method';
  if (/结果|发现|数据|指标|证据|表现/.test(text)) return 'result';
  if (/对比|比较|分歧|异同|差异/.test(text)) return 'discussion';
  return 'synthesis';
}

export function buildPptStructureDraftFromOutline(items: PptOutlineDraftItem[]): PptOutlineDraftStructureItem[] {
  return items.map((item, index) => ({
    type: inferPptOutlineDraftSlideType(item, index, items.length),
    title: item.title,
    discourseRef: `user-outline:${index + 1}:${item.sourceLabel}`,
  }));
}
