import type { ComponentType } from 'react';
import {
  BookOpen,
  Lightbulb,
  Scale,
  TrendingUp,
  AlertTriangle,
  FlaskConical,
  GitCompare,
  FileSearch,
} from 'lucide-react';

export interface QuickQuestion {
  label: string;
  icon: ComponentType<{ className?: string }>;
  question: string;
}

export const QUICK_QUESTIONS: QuickQuestion[] = [
  { label: '核心观点', icon: Lightbulb, question: '请总结这些资料的核心观点和主要贡献' },
  { label: '方法对比', icon: Scale, question: '请比较不同资料中的方法、路径和适用场景' },
  { label: '主要发现', icon: TrendingUp, question: '这些资料中最重要、最可引用的发现是什么？' },
  { label: '局限风险', icon: AlertTriangle, question: '请指出资料中的局限、风险和不确定性' },
  { label: '执行方案', icon: FlaskConical, question: '基于这些资料，可以形成什么可执行方案？' },
  { label: '后续方向', icon: BookOpen, question: '后续还应该补充哪些资料或继续研究哪些方向？' },
  { label: '异同对比', icon: GitCompare, question: '请按主题对比这些资料之间的一致点和分歧点' },
  { label: '关键数据', icon: FileSearch, question: '请提取资料中关键数据、指标和可引用证据' },
];
