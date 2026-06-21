import type { GroundedCitation } from '@/lib/rag';

export type CitationAuditStatus = 'none' | 'pass' | 'missing-markers' | 'invalid-markers';

export interface CitationAuditResult {
  status: CitationAuditStatus;
  citedNumbers: number[];
  invalidNumbers: number[];
  uncitedNumbers: number[];
  citationCount: number;
  markerCount: number;
  warning?: string;
}

export function auditCitationMarkers(answer: string, citations: GroundedCitation[]): CitationAuditResult {
  const citationCount = citations.length;
  const citedNumbers = Array.from(
    new Set([...answer.matchAll(/\[(\d{1,3})\]/g)].map(match => Number(match[1]))),
  ).sort((a, b) => a - b);
  const validNumbers = new Set(Array.from({ length: citationCount }, (_, index) => index + 1));
  const invalidNumbers = citedNumbers.filter(number => !validNumbers.has(number));
  const uncitedNumbers = Array.from(validNumbers).filter(number => !citedNumbers.includes(number));

  if (citationCount === 0) {
    return {
      status: 'none',
      citedNumbers,
      invalidNumbers,
      uncitedNumbers: [],
      citationCount,
      markerCount: citedNumbers.length,
    };
  }

  if (citedNumbers.length === 0) {
    return {
      status: 'missing-markers',
      citedNumbers,
      invalidNumbers,
      uncitedNumbers,
      citationCount,
      markerCount: 0,
      warning: '模型输出没有使用任何引用编号，前端应提示用户该回答未完成来源对齐。',
    };
  }

  if (invalidNumbers.length > 0) {
    return {
      status: 'invalid-markers',
      citedNumbers,
      invalidNumbers,
      uncitedNumbers,
      citationCount,
      markerCount: citedNumbers.length,
      warning: `模型输出包含不存在的引用编号：${invalidNumbers.map(number => `[${number}]`).join(', ')}`,
    };
  }

  return {
    status: 'pass',
    citedNumbers,
    invalidNumbers,
    uncitedNumbers,
    citationCount,
    markerCount: citedNumbers.length,
  };
}
