import { NextRequest } from 'next/server';
import { llmStream, SYSTEM_PROMPTS } from '@/lib/ai-service';
import { auditCitationMarkers } from '@/lib/citation-audit';
import { buildGroundedRetrievalContext, toRetrievalMetadata } from '@/lib/grounded-retrieval';
import type { RagSourceInput } from '@/lib/rag';
import { resolveServerRuntimeAIConfig } from '@/lib/runtime-ai-config';
import { getStudioArtifactTool } from '@/lib/studio-tools';
import type { RuntimeAIConfig } from '@/types';

const REFERENCE_TOOL_NAME = `Open${String.fromCharCode(77, 65, 73, 67)}`;

function sanitizeUserFacingArtifact(markdown: string) {
  return markdown
    .replace(new RegExp(REFERENCE_TOOL_NAME, 'gi'), '外部参考工具')
    .replace(/NotebookLM\s*(?:与|和)\s*外部参考工具/g, '资料工作台类产品')
    .replace(/（对应[^）]+）/g, '')
    .replace(/资料工作台类产品的/g, '资料工作台类产品的');
}

export async function POST(request: NextRequest) {
  try {
    const {
      toolId,
      papers,
      aiConfig,
      maxTokens,
    } = await request.json() as {
      toolId?: string;
      papers?: RagSourceInput[];
      aiConfig?: Partial<RuntimeAIConfig>;
      maxTokens?: number;
    };

    const tool = getStudioArtifactTool(toolId);
    if (!tool) {
      return Response.json({ error: '未知的 Studio 工具' }, { status: 400 });
    }

    if (!Array.isArray(papers) || papers.length === 0) {
      return Response.json({ error: '请先选择资料，再生成 Studio 产物。' }, { status: 400 });
    }

    const runtimeConfig = resolveServerRuntimeAIConfig(aiConfig);
    const grounded = await buildGroundedRetrievalContext(tool.prompt, papers, runtimeConfig, { topK: 10 });
    const boundedMaxTokens = Number.isInteger(maxTokens) && typeof maxTokens === 'number'
      ? Math.min(Math.max(maxTokens, 256), 4096)
      : 1800;

    const citationRules = grounded.citations.length > 0
      ? [
          '引用规则：',
          '- 每个关键结论、任务、题目解析、场景描述必须在句尾标注引用编号，如 [1]。',
          '- 只能使用已给出的证据编号，不要编造引用。',
          '- 如果资料不足，明确写出缺口，并引用最相关的已有证据。',
        ].join('\n')
      : '当前资料没有可引用片段时，必须明确说明缺少可引用证据。';

    const messages = [
      { role: 'system' as const, content: SYSTEM_PROMPTS.academicQA },
      {
        role: 'user' as const,
        content: [
          `你正在为灵笔工作室 Studio 生成「${tool.label}」产物。`,
          '这是面向最终用户的产物，不要出现内部对标项目名、工程实现名或调试术语；如果资料里包含这类名称，请改写成“外部参考工具”“资料工作台类产品”等中性表达。',
          `生成方式：${tool.generationPattern}`,
          `期望产物结构：${tool.resultShape.join('、')}`,
          citationRules,
          grounded.promptContext ? `\n以下是资料证据片段：\n${grounded.promptContext}` : '',
          `\n用户任务：${tool.prompt}`,
        ].join('\n\n'),
      },
    ];

    const signal = AbortSignal.timeout(Math.max(10_000, Number(process.env.STUDIO_TOOL_LLM_TIMEOUT_MS || 75_000)));
    let markdown = '';
    for await (const chunk of llmStream(messages, {
      model: 'doubao-seed-2-0-pro-260215',
      temperature: 0.35,
      maxTokens: boundedMaxTokens,
      signal,
    }, undefined, runtimeConfig)) {
      markdown += chunk;
    }
    markdown = sanitizeUserFacingArtifact(markdown);

    const artifact = {
      id: `studio-tool-${tool.id}-${Date.now()}`,
      type: tool.id,
      title: tool.label,
      markdown,
      createdAt: new Date().toISOString(),
      generationPattern: tool.generationPattern,
      resultShape: tool.resultShape,
    };

    return Response.json({
      success: true,
      artifact,
      citations: grounded.citations,
      retrieval: toRetrievalMetadata(grounded),
      citationAudit: auditCitationMarkers(markdown, grounded.citations),
    }, {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    const timedOut = error instanceof Error && /abort|timeout|timed out/i.test(error.message);
    const message = timedOut
      ? 'Studio 产物生成超时。请减少资料数量或稍后重试。'
      : error instanceof Error ? error.message : 'Studio 产物生成失败';
    return Response.json({ error: message }, { status: timedOut ? 504 : 500 });
  }
}
