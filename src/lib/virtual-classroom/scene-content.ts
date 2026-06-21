export interface VirtualClassroomSceneContentInput {
  id: string;
  type: string;
  title: string;
  objective: string;
  plannedActions: string[];
}

export interface VirtualClassroomEvidenceInput {
  sourceId: string;
  sourceTitle: string;
  snippet: string;
}

export interface VirtualClassroomQuizItem {
  question: string;
  options: string[];
  answer: string;
  explanation: string;
}

export interface VirtualClassroomSceneContent {
  summary: string;
  teacherNotes: string[];
  learnerTask: string;
  quizItems: VirtualClassroomQuizItem[];
  projectDeliverables: string[];
  completionChecks: string[];
}

function firstEvidence(evidence: VirtualClassroomEvidenceInput[]): VirtualClassroomEvidenceInput | null {
  return evidence.find(item => item.snippet.trim() && item.sourceTitle.trim()) || evidence[0] || null;
}

function compact(value: string, fallback: string): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (!normalized) return fallback;
  return normalized.length > 88 ? `${normalized.slice(0, 88)}...` : normalized;
}

function quizItems(scene: VirtualClassroomSceneContentInput, evidence: VirtualClassroomEvidenceInput[]): VirtualClassroomQuizItem[] {
  const primary = firstEvidence(evidence);
  const sourceTitle = primary?.sourceTitle || '所选资料';
  const snippet = compact(primary?.snippet || scene.objective, scene.objective);

  return [
    {
      question: `这段资料最适合用来支撑课堂中的哪一类内容？`,
      options: ['核心概念或背景说明', '无关闲聊', '纯视觉装饰', '无法验证的结论'],
      answer: '核心概念或背景说明',
      explanation: `题目依据来自《${sourceTitle}》：${snippet}`,
    },
    {
      question: `学习者完成本场景后，最应该能做到什么？`,
      options: [scene.objective, '只记住资料标题', '跳过证据直接下结论', '只下载文件'],
      answer: scene.objective,
      explanation: '场景目标直接来自已确认的大纲，后续生成应围绕该目标展开。',
    },
    {
      question: `如果需要复核答案，应该优先查看哪里？`,
      options: ['资料证据摘录', '按钮颜色', '页面滚动条', '随机模型参数'],
      answer: '资料证据摘录',
      explanation: '课堂内容需要能够回指资料来源，避免变成无依据讲解。',
    },
  ];
}

export function buildVirtualClassroomSceneContent(
  scene: VirtualClassroomSceneContentInput,
  evidence: VirtualClassroomEvidenceInput[],
): VirtualClassroomSceneContent {
  const primary = firstEvidence(evidence);
  const evidenceLine = primary
    ? `本场景优先围绕《${primary.sourceTitle}》中的证据展开：${compact(primary.snippet, primary.sourceTitle)}`
    : '本场景需要先补充资料证据，再进入课堂讲解。';

  const baseNotes = [
    evidenceLine,
    `先明确目标：${scene.objective}`,
    ...scene.plannedActions.map(action => `课堂动作：${action}`),
  ];

  if (scene.type === 'quiz') {
    return {
      summary: '用问题检查学习者是否真正理解资料中的关键事实，并把答案回指到证据。',
      teacherNotes: baseNotes,
      learnerTask: '先独立作答，再查看解析和资料证据，确认自己不是凭印象回答。',
      quizItems: quizItems(scene, evidence),
      projectDeliverables: [],
      completionChecks: ['完成全部题目', '每题能说出资料依据', '能解释一个容易误判的选项'],
    };
  }

  if (scene.type === 'project') {
    return {
      summary: '把资料观点迁移成一个可执行的小任务，要求产出目标、步骤、检查点和风险说明。',
      teacherNotes: baseNotes,
      learnerTask: '根据资料证据写出一个 3 步执行方案，并标出每一步的验收标准。',
      quizItems: [],
      projectDeliverables: ['任务目标', '执行步骤', '验收标准', '风险与复核点'],
      completionChecks: ['目标能对应资料内容', '步骤可执行', '检查点可验证', '风险不依赖空泛判断'],
    };
  }

  return {
    summary: '先建立资料背景和核心概念，再提示学习者后续会进入测验和项目迁移。',
    teacherNotes: baseNotes,
    learnerTask: '阅读资料证据摘录，写下本场景的一个核心概念和一个待确认问题。',
    quizItems: [],
    projectDeliverables: [],
    completionChecks: ['能复述核心概念', '能指出证据来源', '能提出一个后续问题'],
  };
}
