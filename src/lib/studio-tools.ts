export type StudioArtifactToolId = 'interactive' | 'quiz' | 'project';

export interface StudioArtifactToolDef {
  id: StudioArtifactToolId;
  label: string;
  desc: string;
  actionLabel: string;
  generationPattern: string;
  resultShape: string[];
  prompt: string;
}

export const STUDIO_ARTIFACT_TOOL_DEFS: StudioArtifactToolDef[] = [
  {
    id: 'interactive',
    label: '互动页面',
    desc: '生成可操作的互动任务',
    actionLabel: '生成互动页面',
    generationPattern: '把资料转成可点击、可选择、可反馈的互动任务，先产出页面结构、交互规则和状态说明。',
    resultShape: ['互动目标', '页面状态', '用户动作', '反馈规则', '素材清单'],
    prompt:
      '请基于我选中的资料设计一个互动页面。要求：1）明确互动目标和适用场景；2）输出页面状态、用户动作、正确反馈、错误反馈和完成条件；3）列出需要的图文素材和数据字段；4）每个关键规则都要标出资料依据；5）当前只生成可检查的互动设计稿，不要声称已经生成可运行网页。',
  },
  {
    id: 'quiz',
    label: '测验练习',
    desc: '生成题目、答案和解析',
    actionLabel: '生成测验练习',
    generationPattern: '先确定练习目标，再生成题目、标准答案、解析反馈和追问建议。',
    resultShape: ['题目', '标准答案', '解析反馈', '来源依据'],
    prompt:
      '请基于我选中的资料生成一套测验练习。要求：1）给出 6 道题，覆盖选择题、判断题、简答题；2）每题提供标准答案和解析；3）标出每题对应的资料依据或引用片段；4）最后给出我还应该追问的 3 个问题。',
  },
  {
    id: 'project',
    label: '项目研习',
    desc: '生成角色、任务和检查点',
    actionLabel: '生成项目研习',
    generationPattern: '把资料组织成项目制研习任务，包含角色、问题板、阶段任务、检查点和验收标准。',
    resultShape: ['项目目标', '角色分工', '问题板', '阶段任务', '验收标准'],
    prompt:
      '请把我选中的资料设计成一个项目研习任务。要求：1）输出项目目标、背景情境、角色分工、问题板、阶段任务、风险和验收标准；2）每个任务都要说明来源依据；3）给出适合个人工作台执行的最小行动；4）用 Markdown 分组，不要泛泛而谈。',
  },
];

export function getStudioArtifactTool(id: unknown): StudioArtifactToolDef | undefined {
  return STUDIO_ARTIFACT_TOOL_DEFS.find(tool => tool.id === id);
}
